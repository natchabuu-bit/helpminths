"""Isolated synthetic accounts verify registration and expert-session boundaries."""
from __future__ import annotations

import hashlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Annotated

import pytest
from fastapi import Depends, FastAPI, Request
from fastapi.testclient import TestClient

from backend.platform.auth import COOKIE_NAME, assert_access, require_expert_verification, require_user, router
from backend.platform.store import PlatformStore

PASSWORD = "Synthetic-public-account-2026!"
NEW_PASSWORD = "Synthetic-changed-password-2026!"
ORIGIN = {"Origin": "https://testserver"}
# Deliberately recognizable test fixture, never a production setup credential.
TEST_SETUP_TOKEN = "SYNTHETIC-SETUP-TOKEN-ONLY_not-a-production-secret_2026"


@pytest.fixture
def prepared(tmp_path, monkeypatch):
    monkeypatch.delenv("HELPMINTHS_ADMIN_SETUP_TOKEN", raising=False)
    store = PlatformStore(tmp_path / "private")
    app = FastAPI()
    app.state.platform_store = store
    app.include_router(router)

    @app.get("/test/expert")
    def expert(_user: Annotated[dict, Depends(require_expert_verification)]):
        return {"allowed": True}

    @app.get("/test/clinical/{owner_id}")
    def clinical(owner_id: str, _request: Request, user: Annotated[dict, Depends(require_user)]):
        assert_access(user, {"kind": "analysis", "owner_id": owner_id})
        return {"allowed": True}

    return app, store


def client_for(app):
    return TestClient(app, base_url="https://testserver")


def sign_in(client, username):
    response = client.post("/api/platform/login", json={"username": username, "password": PASSWORD}, headers=ORIGIN)
    assert response.status_code == 200, response.text
    return {**ORIGIN, "X-CSRF-Token": response.json()["csrf_token"]}


def register(client, username="normal_user", account_type="user"):
    response = client.post("/api/platform/register", json={"username": username, "password": PASSWORD, "account_type": account_type}, headers=ORIGIN)
    assert response.status_code == 201, response.text
    return response


def register_and_approve(app, store, client, username="normal_user"):
    """An explicit operator fixture approves through the public owner API."""
    registration = register(client, username).json()
    owner = store.create_user("synthetic_approval_owner", PASSWORD, "admin", is_super_admin=True)
    with client_for(app) as owner_client:
        owner_headers = sign_in(owner_client, owner["username"])
        approved = owner_client.patch(f'/api/platform/users/{registration["user"]["id"]}',
                                      json={"approval_status": "approved"}, headers=owner_headers)
        assert approved.status_code == 200, approved.text
        assert approved.json()["approved_by"] == owner["id"]
    sign_in(client, username)
    return client.get("/api/platform/session").json()


def test_public_registration_chooses_credentials_but_never_privileged_roles(prepared):
    app, store = prepared
    with client_for(app) as client:
        for role in ["admin", "reviewer"]:
            rejected = client.post("/api/platform/register", json={"username": "forged_user", "password": PASSWORD, "role": role}, headers=ORIGIN)
            assert rejected.status_code == 422
        response = register(client)
        body = response.json()
        assert body["user"]["role"] == "lab"
        assert body["registration_enabled"] is True
        assert body["expert_verified_until"] is None
        assert body["bootstrap_required"] is True  # First public user is not an administrator.
        assert "_expert_verified" not in body["user"]
        assert PASSWORD not in response.text
        assert response.headers["cache-control"] == "no-store"
        assert "set-cookie" not in response.headers
        assert body["csrf_token"] is None and body["pending_approval"] is True
        assert body["user"]["approval_status"] == "pending"
        assert body["user"]["requested_role"] == "lab"
        assert body["user"]["is_super_admin"] is False
        assert body["user"]["approved_by"] is None and body["user"]["approved_at"] is None
        assert client.cookies.get(COOKIE_NAME) is None
        assert client.get("/api/platform/session").json()["user"] is None
        assert client.get("/api/platform/users").status_code == 401
        assert client.get("/test/clinical/other").status_code == 401
        assert client.post("/api/platform/expert-login", json={"password": PASSWORD}).status_code == 401
        assert client.post("/api/platform/login", json={"username": "normal_user", "password": PASSWORD}, headers=ORIGIN).status_code == 403
        assert client.post("/api/platform/login", json={"username": "normal_user", "password": "wrong"}, headers=ORIGIN).status_code == 401
        with store.connection() as conn:
            row = conn.execute("SELECT password_hash,role FROM users").fetchone()
        assert row["password_hash"].startswith("scrypt$") and PASSWORD not in row["password_hash"]
        assert row["role"] == "lab"
        assert PASSWORD not in str(store.list_audit("users", body["user"]["id"]))


def test_registration_checks_origin_duplicates_and_current_identity(prepared):
    app, store = prepared
    store.create_user("existing_name", PASSWORD)
    with client_for(app) as client:
        assert client.post("/api/platform/register", json={"username": "new_user", "password": PASSWORD}, headers={"Origin": "https://elsewhere.example"}).status_code == 403
        assert client.post("/api/platform/register", json={"username": "EXISTING_NAME", "password": PASSWORD}, headers=ORIGIN).status_code == 409
        register(client, "another_user")
        sign_in(client, "existing_name")
        assert client.post("/api/platform/register", json={"username": "third_user", "password": PASSWORD}, headers=ORIGIN).status_code == 409
        assert client.get("/api/platform/session").json()["user"]["username"] == "existing_name"


def test_public_registration_uses_real_bounded_rate_limit(prepared):
    app, store = prepared
    store.create_user("taken_name", PASSWORD)
    with client_for(app) as client:
        for _ in range(5):
            assert client.post("/api/platform/register", json={"username": "taken_name", "password": PASSWORD}).status_code == 409
        limited = client.post("/api/platform/register", json={"username": "taken_name", "password": PASSWORD})
        assert limited.status_code == 429
        assert limited.headers["retry-after"] == "60"


def test_self_account_update_requires_password_csrf_and_unique_name(prepared):
    app, store = prepared
    store.create_user("taken_name", PASSWORD)
    with client_for(app) as client:
        current = register_and_approve(app, store, client)
        headers = {**ORIGIN, "X-CSRF-Token": current["csrf_token"]}
        assert client.patch("/api/platform/account", json={"current_password": PASSWORD, "username": "new_name"}).status_code == 403
        wrong = client.patch("/api/platform/account", json={"current_password": "incorrect-password", "username": "new_name"}, headers=headers)
        assert wrong.status_code == 403
        assert client.get("/api/platform/session").json()["user"]["id"] == current["user"]["id"]
        assert client.patch("/api/platform/account", json={"current_password": PASSWORD, "username": "TAKEN_NAME"}, headers=headers).status_code == 409
        assert client.patch("/api/platform/account", json={"current_password": PASSWORD, "username": "Super  Admin"}, headers=headers).status_code == 409
        assert client.patch("/api/platform/account", json={"current_password": PASSWORD, "role": "admin"}, headers=headers).status_code == 422
        assert client.patch("/api/platform/account", json={"current_password": PASSWORD}, headers=headers).status_code == 422
        assert client.get("/api/platform/session").json()["user"]["username"] == "normal_user"


def test_account_changes_rotate_current_cookie_and_revoke_other_sessions(prepared):
    app, store = prepared
    with client_for(app) as client, client_for(app) as other:
        body = register_and_approve(app, store, client)
        old_cookie = client.cookies.get(COOKIE_NAME)
        sign_in(other, "normal_user")
        response = client.patch("/api/platform/account", json={"current_password": PASSWORD, "username": "renamed_user", "new_password": NEW_PASSWORD}, headers={**ORIGIN, "X-CSRF-Token": body["csrf_token"]})
        assert response.status_code == 200, response.text
        updated = response.json()
        assert updated["user"]["id"] == body["user"]["id"]
        assert updated["user"]["username"] == "renamed_user"
        assert updated["user"]["role"] == "lab"
        assert updated["csrf_token"] != body["csrf_token"]
        assert client.cookies.get(COOKIE_NAME) != old_cookie
        assert other.get("/api/platform/session").json()["user"] is None
        assert client.post("/api/platform/logout", headers={"X-CSRF-Token": body["csrf_token"]}).status_code == 403
        assert PASSWORD not in response.text and NEW_PASSWORD not in response.text
        assert store.authenticate("normal_user", PASSWORD) is None
        assert store.authenticate("renamed_user", PASSWORD) is None
        assert store.authenticate("renamed_user", NEW_PASSWORD)["id"] == body["user"]["id"]
        audit = str(store.list_audit("users", body["user"]["id"]))
        assert PASSWORD not in audit and NEW_PASSWORD not in audit and "password_hash" not in audit


def test_expert_requires_reauthentication_without_exposing_internal_gate(prepared):
    app, store = prepared
    user = store.create_user("reviewer_user", PASSWORD, "reviewer")
    owner = store.create_user("owner_user", PASSWORD, "lab")
    with client_for(app) as client:
        headers = sign_in(client, user["username"])
        assert client.get("/test/expert").json()["detail"]["code"] == "expert_verification_required"
        assert client.get(f'/test/clinical/{user["id"]}').status_code == 200
        assert client.get(f'/test/clinical/{owner["id"]}').status_code == 403
        assert client.post("/api/platform/expert-login", json={"password": PASSWORD}).status_code == 403
        assert client.post("/api/platform/expert-login", json={"password": "wrong"}, headers=headers).status_code == 403
        assert client.get("/api/platform/session").json()["user"]["id"] == user["id"]
        assert client.post("/api/platform/expert-login", json={"password": PASSWORD, "username": owner["username"]}, headers=headers).status_code == 403
        approved = client.post("/api/platform/expert-login", json={"password": PASSWORD, "username": user["username"]}, headers=headers)
        assert approved.status_code == 200
        until = approved.json()["verified_until"]
        remaining = datetime.fromisoformat(until.replace("Z", "+00:00")) - datetime.now(timezone.utc)
        assert timedelta(minutes=14) < remaining <= timedelta(minutes=15)
        assert client.get("/test/expert").status_code == 200
        assert client.get(f'/test/clinical/{owner["id"]}').status_code == 200
        public = client.get("/api/platform/session").json()
        assert public["expert_verified_until"] == until
        assert "_expert_verified" not in public["user"]
        assert PASSWORD not in approved.text


def test_expert_gate_is_session_bound_expires_and_can_be_locked(prepared):
    app, store = prepared
    user = store.create_user("reviewer_user", PASSWORD, "reviewer")
    with client_for(app) as first, client_for(app) as second:
        headers = sign_in(first, user["username"])
        second_headers = sign_in(second, user["username"])
        assert first.post("/api/platform/expert-login", json={"password": PASSWORD}, headers=headers).status_code == 200
        assert second.get("/api/platform/expert-session").json()["verified"] is False
        assert second.get("/test/expert").status_code == 403
        assert first.delete("/api/platform/expert-session", headers=headers).json()["verified"] is False
        assert first.get("/test/expert").status_code == 403
        assert first.post("/api/platform/expert-login", json={"password": PASSWORD}, headers=headers).status_code == 200
        identifier = hashlib.sha256(first.cookies.get(COOKIE_NAME).encode()).hexdigest()
        document = store.get_document("expert_session", identifier)
        store.update_document("expert_session", identifier, {**document["data"], "verified_until": "2000-01-01T00:00:00.000Z"}, user["id"], document["revision"])
        assert first.get("/api/platform/expert-session").json()["verified"] is False
        assert first.get("/test/expert").status_code == 403
        assert second.post("/api/platform/expert-login", json={"password": PASSWORD}, headers=second_headers).status_code == 200
        assert second.post("/api/platform/logout", headers=second_headers).status_code == 200
        assert second.get("/test/expert").status_code == 401


def test_expert_gate_never_outlives_base_session_or_role_revocation(prepared):
    app, store = prepared
    user = store.create_user("reviewer_user", PASSWORD, "reviewer")
    admin = store.create_user("admin_user", PASSWORD, "admin", is_super_admin=True)
    with client_for(app) as client, client_for(app) as admin_client:
        headers = sign_in(client, user["username"])
        admin_headers = sign_in(admin_client, admin["username"])
        expires = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        with store.transaction() as conn:
            conn.execute("UPDATE sessions SET expires_at=? WHERE user_id=?", (expires, user["id"]))
        response = client.post("/api/platform/expert-login", json={"password": PASSWORD}, headers=headers)
        assert response.status_code == 200
        assert response.json()["verified_until"] <= expires
        revoked = admin_client.patch(f'/api/platform/users/{user["id"]}', json={"role": "lab"}, headers=admin_headers)
        assert revoked.status_code == 200
        assert client.get("/api/platform/session").json()["user"] is None
        assert client.get("/test/expert").status_code == 401


def test_expert_confirmation_limits_password_guesses_without_logging_out(prepared):
    app, store = prepared
    user = store.create_user("reviewer_user", PASSWORD, "reviewer")
    with client_for(app) as client:
        headers = sign_in(client, user["username"])
        for _ in range(5):
            assert client.post("/api/platform/expert-login", json={"password": "wrong"}, headers=headers).status_code == 403
        assert client.post("/api/platform/expert-login", json={"password": PASSWORD}, headers=headers).status_code == 429
        assert client.get("/api/platform/session").json()["user"]["id"] == user["id"]


def test_account_password_change_clears_expert_gate(prepared):
    app, store = prepared
    user = store.create_user("reviewer_user", PASSWORD, "reviewer")
    with client_for(app) as client:
        headers = sign_in(client, user["username"])
        assert client.post("/api/platform/expert-login", json={"password": PASSWORD}, headers=headers).status_code == 200
        changed = client.patch("/api/platform/account", json={"current_password": PASSWORD, "new_password": NEW_PASSWORD}, headers=headers)
        assert changed.status_code == 200
        assert changed.json()["expert_verified_until"] is None
        assert client.get("/test/expert").status_code == 403


@pytest.mark.parametrize("configured_token", [None, "short", "x" * 31, "x" * 257, " " * 64, "x" * 32 + "\n", "ท" * 32])
def test_optional_web_admin_setup_is_disabled_without_a_valid_host_secret(prepared, monkeypatch, configured_token):
    app, store = prepared
    if configured_token is not None:
        monkeypatch.setenv("HELPMINTHS_ADMIN_SETUP_TOKEN", configured_token)
    with client_for(app) as client:
        assert client.get("/api/platform/session").json()["admin_setup_available"] is False
        response = client.post("/api/platform/admin-setup", json={"setup_token": TEST_SETUP_TOKEN, "username": "Super Admin", "password": PASSWORD}, headers=ORIGIN)
        assert response.status_code == 503
        assert TEST_SETUP_TOKEN not in response.text and PASSWORD not in response.text
        with store.connection() as conn:
            assert conn.execute("SELECT count(*) FROM users").fetchone()[0] == 0


def test_web_admin_setup_checks_secret_origin_and_never_leaks_credentials(prepared, monkeypatch, caplog):
    app, store = prepared
    monkeypatch.setenv("HELPMINTHS_ADMIN_SETUP_TOKEN", TEST_SETUP_TOKEN)
    caplog.set_level("INFO")
    body = {"setup_token": TEST_SETUP_TOKEN, "username": "Super Admin", "password": PASSWORD}
    with client_for(app) as client:
        before = client.get("/api/platform/session")
        assert before.json()["admin_setup_available"] is True
        assert before.json()["owner_username"] == "Super Admin"
        assert TEST_SETUP_TOKEN not in before.text
        assert client.post("/api/platform/admin-setup", json=body, headers={"Origin": "https://elsewhere.example"}).status_code == 403
        for incorrect in ["wrong-token", "ภาษาผิด"]:
            denied = client.post("/api/platform/admin-setup", json={**body, "setup_token": incorrect}, headers=ORIGIN)
            assert denied.status_code == 403
            assert "Super Admin" not in denied.text and TEST_SETUP_TOKEN not in denied.text
        assert client.post("/api/platform/admin-setup", json={**body, "role": "admin"}, headers=ORIGIN).status_code == 422
        with store.connection() as conn:
            assert conn.execute("SELECT count(*) FROM users").fetchone()[0] == 0
        wrong_owner_name = client.post("/api/platform/admin-setup", json={**body, "username": "other_owner"}, headers=ORIGIN)
        assert wrong_owner_name.status_code == 422
        result = client.post("/api/platform/admin-setup", json=body, headers=ORIGIN)
        assert result.status_code == 201, result.text
        session = result.json()
        assert session["user"]["role"] == "admin"
        assert session["user"]["is_super_admin"] is True
        assert session["user"]["approval_status"] == "approved"
        assert session["admin_setup_available"] is False
        assert session["bootstrap_required"] is False
        assert session["expert_verified_until"] is None
        assert session["csrf_token"] and client.cookies.get(COOKIE_NAME)
        assert client.get("/test/expert").status_code == 403, "Admin setup must not also grant expert step-up"
        assert client.get("/api/platform/session").json()["user"]["id"] == session["user"]["id"]
        assert client.get("/api/platform/users").status_code == 200
        status = client.get("/api/platform/status")
        assert status.json()["admin_setup_available"] is False
        audit = str(store.list_audit("users", session["user"]["id"]))
        for secret in [TEST_SETUP_TOKEN, PASSWORD]:
            assert secret not in result.text and secret not in status.text and secret not in audit and secret not in caplog.text


def test_a_second_or_concurrent_web_admin_claim_cannot_create_another_admin(prepared, monkeypatch):
    app, store = prepared
    monkeypatch.setenv("HELPMINTHS_ADMIN_SETUP_TOKEN", TEST_SETUP_TOKEN)

    def claim(index):
        with client_for(app) as client:
            return client.post("/api/platform/admin-setup", json={"setup_token": TEST_SETUP_TOKEN, "username": "Super Admin", "password": PASSWORD}, headers=ORIGIN)

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(claim, [1, 2]))
    assert sorted(response.status_code for response in responses) == [201, 409]
    with store.connection() as conn:
        assert conn.execute("SELECT count(*) FROM users WHERE active=1 AND role='admin'").fetchone()[0] == 1
    with client_for(app) as client:
        assert client.get("/api/platform/session").json()["admin_setup_available"] is False
        repeated = client.post("/api/platform/admin-setup", json={"setup_token": TEST_SETUP_TOKEN, "username": "another_admin", "password": PASSWORD}, headers=ORIGIN)
        assert repeated.status_code == 409
        assert "host_admin_" not in repeated.text


def test_normal_signup_before_admin_setup_cannot_claim_privileges(prepared, monkeypatch):
    app, store = prepared
    monkeypatch.setenv("HELPMINTHS_ADMIN_SETUP_TOKEN", TEST_SETUP_TOKEN)
    with client_for(app) as ordinary, client_for(app) as owner:
        normal = register(ordinary).json()
        assert normal["user"]["role"] == "lab" and normal["admin_setup_available"] is True
        assert ordinary.get("/api/platform/users").status_code == 401
        forged = ordinary.post("/api/platform/register", json={"username": "forged_admin", "password": PASSWORD, "setup_token": TEST_SETUP_TOKEN, "role": "admin"}, headers=ORIGIN)
        assert forged.status_code == 422
        assert ordinary.post("/api/platform/admin-setup", json={"setup_token": "not-the-host-secret", "username": "forged_admin", "password": PASSWORD}, headers=ORIGIN).status_code == 403
        setup = owner.post("/api/platform/admin-setup", json={"setup_token": TEST_SETUP_TOKEN, "username": "Super Admin", "password": PASSWORD}, headers=ORIGIN)
        assert setup.status_code == 201
        assert ordinary.get("/api/platform/session").json()["user"] is None
        assert ordinary.get("/api/platform/users").status_code == 401
        assert store.authenticate("normal_user", PASSWORD)["approval_status"] == "pending"


def test_web_admin_setup_limits_secret_guesses_under_one_fixed_key(prepared, monkeypatch):
    app, _store = prepared
    monkeypatch.setenv("HELPMINTHS_ADMIN_SETUP_TOKEN", TEST_SETUP_TOKEN)
    with client_for(app) as client:
        for index in range(5):
            assert client.post("/api/platform/admin-setup", json={"setup_token": "wrong", "username": f"guess_user_{index}", "password": PASSWORD}, headers=ORIGIN).status_code == 403
        limited = client.post("/api/platform/admin-setup", json={"setup_token": TEST_SETUP_TOKEN, "username": "Super Admin", "password": PASSWORD}, headers=ORIGIN)
        assert limited.status_code == 429
        assert limited.headers["retry-after"] == "60"


def test_admin_setup_validation_uses_production_secret_redaction(tmp_path, monkeypatch):
    from backend.main import create_app
    from backend.model import YOLOModelService

    monkeypatch.setenv("HELPMINTHS_ADMIN_SETUP_TOKEN", TEST_SETUP_TOKEN)
    app = create_app(YOLOModelService(""), platform_dir=tmp_path / "private")
    supplied_secret = TEST_SETUP_TOKEN * 6  # Intentionally over the input bound.
    with client_for(app) as client:
        invalid = client.post("/api/platform/admin-setup", json={"setup_token": supplied_secret, "username": "Super Admin", "password": PASSWORD}, headers=ORIGIN)
        assert invalid.status_code == 422
        assert supplied_secret not in invalid.text and TEST_SETUP_TOKEN not in invalid.text and PASSWORD not in invalid.text


@pytest.mark.parametrize("account_type,requested_role", [("user", "lab"), ("expert", "reviewer")])
def test_owner_approves_each_account_type_before_it_can_sign_in(prepared, account_type, requested_role):
    app, store = prepared
    owner = store.create_user("approval_owner", PASSWORD, "admin", is_super_admin=True)
    with client_for(app) as applicant, client_for(app) as owner_client:
        registration = register(applicant, "applicant", account_type).json()
        user = registration["user"]
        assert user["requested_role"] == requested_role
        assert user["role"] == "lab" and user["approval_status"] == "pending"
        assert user["is_super_admin"] is False
        assert registration["csrf_token"] is None and applicant.cookies.get(COOKIE_NAME) is None
        for endpoint in ["/login", "/expert-signin"]:
            denied = applicant.post("/api/platform" + endpoint, json={"username": "applicant", "password": PASSWORD}, headers=ORIGIN)
            assert denied.status_code == 403
            assert denied.json()["detail"]["code"] == "account_pending"
        assert applicant.get("/test/expert").status_code == 401
        with store.connection() as conn:
            assert conn.execute("SELECT count(*) FROM sessions WHERE user_id=?", (user["id"],)).fetchone()[0] == 0
        owner_headers = sign_in(owner_client, owner["username"])
        listing = owner_client.get("/api/platform/users").json()["items"]
        assert next(item for item in listing if item["id"] == user["id"])["approval_status"] == "pending"
        approved = owner_client.patch(f'/api/platform/users/{user["id"]}', json={"approval_status": "approved"}, headers=owner_headers)
        assert approved.status_code == 200, approved.text
        approved_user = approved.json()
        assert approved_user["role"] == requested_role
        assert approved_user["approval_status"] == "approved"
        assert approved_user["approved_by"] == owner["id"] and approved_user["approved_at"]
        assert approved_user["is_super_admin"] is False
        sign_in(applicant, "applicant")
        assert applicant.get("/api/platform/session").json()["user"]["id"] == user["id"]
        if account_type == "user":
            denied = applicant.post("/api/platform/expert-signin", json={"username": "applicant", "password": PASSWORD}, headers=ORIGIN)
            assert denied.status_code == 403
        else:
            verified = applicant.post("/api/platform/expert-signin", json={"username": "applicant", "password": PASSWORD}, headers=ORIGIN)
            assert verified.status_code == 200, verified.text
            assert verified.json()["expert_verified_until"]
            assert applicant.get("/test/expert").status_code == 200
        audit = store.list_audit("users", user["id"])
        assert any(event["actor_id"] == owner["id"] and event["after_data"].get("approval_status") == "approved" for event in audit)
        assert PASSWORD not in str(audit)


def test_an_admin_role_without_owner_authority_cannot_manage_or_approve_accounts(prepared):
    app, store = prepared
    store.create_user("approval_owner", PASSWORD, "admin", is_super_admin=True)
    ordinary_admin = store.create_user("ordinary_admin", PASSWORD, "admin")
    with client_for(app) as applicant, client_for(app) as admin_client:
        pending = register(applicant).json()["user"]
        headers = sign_in(admin_client, ordinary_admin["username"])
        assert admin_client.get("/api/platform/users").status_code == 403
        assert admin_client.post("/api/platform/users", json={"username": "forged_account", "password": PASSWORD, "role": "admin"}, headers=headers).status_code == 403
        assert admin_client.patch(f'/api/platform/users/{pending["id"]}', json={"approval_status": "approved", "role": "reviewer"}, headers=headers).status_code == 403
        assert admin_client.get(f'/api/platform/audit/users/{pending["id"]}').status_code == 403
        assert store.authenticate(pending["username"], PASSWORD)["approval_status"] == "pending"


def test_rejection_revokes_sessions_and_cannot_be_bypassed_by_old_cookies(prepared):
    app, store = prepared
    owner = store.create_user("approval_owner", PASSWORD, "admin", is_super_admin=True)
    user = store.create_user("approved_reviewer", PASSWORD, "reviewer")
    with client_for(app) as account, client_for(app) as owner_client:
        expert = account.post("/api/platform/expert-signin", json={"username": user["username"], "password": PASSWORD}, headers=ORIGIN)
        assert expert.status_code == 200, expert.text
        assert account.get("/test/expert").status_code == 200
        old_cookie = account.cookies.get(COOKIE_NAME)
        owner_headers = sign_in(owner_client, owner["username"])
        rejected = owner_client.patch(f'/api/platform/users/{user["id"]}', json={"approval_status": "rejected"}, headers=owner_headers)
        assert rejected.status_code == 200, rejected.text
        assert rejected.json()["approval_status"] == "rejected"
        with store.connection() as conn:
            assert conn.execute("SELECT count(*) FROM sessions WHERE user_id=?", (user["id"],)).fetchone()[0] == 0
        assert account.cookies.get(COOKIE_NAME) == old_cookie
        assert account.get("/api/platform/session").json()["user"] is None
        assert account.get("/test/expert").status_code == 401
        for endpoint in ["/login", "/expert-signin"]:
            denied = account.post("/api/platform" + endpoint, json={"username": user["username"], "password": PASSWORD}, headers=ORIGIN)
            assert denied.status_code == 403
            assert denied.json()["detail"]["code"] == "account_rejected"
        reapproved = owner_client.patch(f'/api/platform/users/{user["id"]}', json={"approval_status": "approved"}, headers=owner_headers)
        assert reapproved.status_code == 200
        assert account.get("/test/expert").status_code == 401


def test_current_sessions_check_approval_on_each_request_even_before_session_cleanup(prepared):
    app, store = prepared
    user = store.create_user("initially_approved", PASSWORD, "reviewer")
    with client_for(app) as client:
        sign_in(client, user["username"])
        with store.transaction() as conn:
            conn.execute("UPDATE users SET approval_status='pending' WHERE id=?", (user["id"],))
            assert conn.execute("SELECT count(*) FROM sessions WHERE user_id=?", (user["id"],)).fetchone()[0] == 1
        assert client.get("/api/platform/session").json()["user"] is None
        assert client.get("/test/expert").status_code == 401
        assert client.get(f'/test/clinical/{user["id"]}').status_code == 401


@pytest.mark.parametrize("forged", [{"is_super_admin": True}, {"approval_status": "approved"}, {"requested_role": "admin"}, {"approved_by": "pretend_owner"}, {"account_type": "admin"}])
def test_public_registration_cannot_forge_owner_or_approval_fields(prepared, forged):
    app, store = prepared
    with client_for(app) as client:
        denied = client.post("/api/platform/register", json={"username": "forged_account", "password": PASSWORD, **forged}, headers=ORIGIN)
        assert denied.status_code == 422
        assert client.cookies.get(COOKIE_NAME) is None
        with store.connection() as conn:
            assert conn.execute("SELECT count(*) FROM users").fetchone()[0] == 0


def test_dedicated_expert_signin_creates_its_own_session_and_bounded_gate(prepared):
    app, store = prepared
    user = store.create_user("approved_reviewer", PASSWORD, "reviewer")
    with client_for(app) as expert_client, client_for(app) as other_session:
        sign_in(other_session, user["username"])
        assert expert_client.post("/api/platform/expert-signin", json={"username": user["username"], "password": "wrong"}, headers=ORIGIN).status_code == 401
        assert expert_client.post("/api/platform/expert-signin", json={"username": user["username"], "password": PASSWORD}, headers={"Origin": "https://elsewhere.example"}).status_code == 403
        response = expert_client.post("/api/platform/expert-signin", json={"username": user["username"], "password": PASSWORD}, headers=ORIGIN)
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["user"]["id"] == user["id"] and payload["csrf_token"]
        remaining = datetime.fromisoformat(payload["expert_verified_until"].replace("Z", "+00:00")) - datetime.now(timezone.utc)
        assert timedelta(minutes=14) < remaining <= timedelta(minutes=15)
        assert expert_client.cookies.get(COOKIE_NAME)
        assert expert_client.get("/test/expert").status_code == 200
        assert other_session.get("/test/expert").status_code == 403
        assert PASSWORD not in response.text and "_expert_verified" not in payload["user"]


@pytest.mark.parametrize("username", ["Super Admin", " super admin ", "Super  Admin", "SUPER ADMIN"])
def test_public_registration_reserves_the_host_owned_super_admin_name(prepared, username):
    app, store = prepared
    with client_for(app) as client:
        response = client.post("/api/platform/register", json={"username": username, "password": PASSWORD}, headers=ORIGIN)
        assert response.status_code == 409, response.text
        assert client.get("/api/platform/session").json()["user"] is None
        with store.connection() as conn:
            assert conn.execute("SELECT count(*) FROM users").fetchone()[0] == 0


def test_owner_account_filters_count_and_paginate_current_access_separately_from_applications(prepared):
    app, store = prepared
    owner = store.create_user("filter_owner", PASSWORD, "admin", is_super_admin=True)
    with client_for(app) as applicant, client_for(app) as owner_client:
        pending_general = register(applicant, "pending_general").json()["user"]
        pending_expert = register(applicant, "pending_expert", "expert").json()["user"]
        promoted_general = register(applicant, "promoted_general").json()["user"]
        demoted_expert = register(applicant, "demoted_expert", "expert").json()["user"]
        owner_headers = sign_in(owner_client, owner["username"])
        for user, final_role in [(promoted_general, "reviewer"), (demoted_expert, "lab")]:
            approved = owner_client.patch(f'/api/platform/users/{user["id"]}', json={"approval_status": "approved"}, headers=owner_headers)
            assert approved.status_code == 200, approved.text
            changed = owner_client.patch(f'/api/platform/users/{user["id"]}', json={"role": final_role}, headers=owner_headers)
            assert changed.status_code == 200, changed.text
        student_response = owner_client.post("/api/platform/users", json={"username": "approved_student", "password": PASSWORD, "role": "student"}, headers=owner_headers)
        admin_response = owner_client.post("/api/platform/users", json={"username": "ordinary_admin", "password": PASSWORD, "role": "admin"}, headers=owner_headers)
        assert student_response.status_code == admin_response.status_code == 201
        student, ordinary_admin = student_response.json(), admin_response.json()
        all_users = owner_client.get("/api/platform/users").json()
        assert all_users["total"] == 7
        by_id = {item["id"]: item for item in all_users["items"]}
        for user, role, requested_role, approval in [
            (pending_general, "lab", "lab", "pending"),
            (pending_expert, "lab", "reviewer", "pending"),
            (promoted_general, "reviewer", "lab", "approved"),
            (demoted_expert, "lab", "reviewer", "approved"),
        ]:
            listed = by_id[user["id"]]
            assert listed["role"] == role and listed["requested_role"] == requested_role
            assert listed["approval_status"] == approval and listed["is_super_admin"] is False
            if approval == "approved":
                assert listed["approved_by"] == owner["id"] and listed["approved_at"]
            else:
                assert listed["approved_by"] is None and listed["approved_at"] is None
        assert by_id[owner["id"]]["is_super_admin"] is True
        assert by_id[ordinary_admin["id"]]["is_super_admin"] is False
        assert PASSWORD not in str(all_users) and "password_hash" not in str(all_users)

        cases = [
            ({"approval_status": "pending"}, [pending_general, pending_expert]),
            ({"approval_status": "approved"}, [owner, ordinary_admin, promoted_general, demoted_expert, student]),
            ({"approval_status": "rejected"}, []),
            ({"requested_role": "lab"}, [pending_general, promoted_general]),
            ({"requested_role": "reviewer"}, [pending_expert, demoted_expert]),
            ({"requested_role": "admin"}, [owner, ordinary_admin]),
            ({"account_type": "user"}, [pending_general, demoted_expert, student]),
            ({"account_type": "expert"}, [pending_expert, promoted_general]),
            ({"approval_status": "pending", "account_type": "expert"}, [pending_expert]),
            ({"approval_status": "approved", "account_type": "user"}, [demoted_expert, student]),
            ({"account_type": "expert", "requested_role": "lab"}, [promoted_general]),
            ({"account_type": "user", "requested_role": "reviewer"}, [demoted_expert]),
            ({"approval_status": "approved", "requested_role": "reviewer", "account_type": "expert"}, []),
        ]
        for query, expected in cases:
            result = owner_client.get("/api/platform/users", params=query)
            assert result.status_code == 200, result.text
            result = result.json()
            expected_ids = {item["id"] for item in expected}
            assert result["total"] == len(expected_ids), query
            assert {item["id"] for item in result["items"]} == expected_ids, query
            page_ids = []
            for offset in range(len(expected_ids) + 1):
                page = owner_client.get("/api/platform/users", params={**query, "limit": 1, "offset": offset}).json()
                assert page["total"] == len(expected_ids) and page["limit"] == 1 and page["offset"] == offset
                assert len(page["items"]) == (1 if offset < len(expected_ids) else 0)
                page_ids.extend(item["id"] for item in page["items"])
            assert page_ids == [item["id"] for item in result["items"]], query
        for invalid in [{"approval_status": "unknown"}, {"requested_role": "owner"}, {"account_type": "admin"}, {"limit": 0}, {"offset": -1}]:
            assert owner_client.get("/api/platform/users", params=invalid).status_code == 422

"""Private signup profiles, ten digit phones and non-destructive v2 upgrades."""
from __future__ import annotations

import hashlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.platform.auth import COOKIE_NAME, router
from backend.platform.store import SCHEMA_VERSION, PlatformStore

PASSWORD = "Synthetic-profile-test-only-2026"
PROFILE = {"full_name": "ชื่อ นามสกุลทดสอบ", "workplace": "โรงพยาบาลทดสอบ",
           "affiliation": "หน่วยงานทดสอบ", "phone": "0812345678"}


def app_for(store):
    app = FastAPI()
    app.state.platform_store = store
    app.include_router(router)
    return app


@pytest.fixture
def prepared(tmp_path):
    store = PlatformStore(tmp_path / "private")
    return app_for(store), store


@pytest.mark.parametrize("account_type,requested_role", [("user", "lab"), ("expert", "reviewer")])
def test_signup_persists_trimmed_profile_but_never_approves_or_logs_in(prepared, account_type, requested_role):
    app, store = prepared
    with TestClient(app, base_url="https://testserver") as applicant:
        payload = {"username": "synthetic_profile", "password": PASSWORD, "account_type": account_type,
                   **{key: "  " + value + "  " for key, value in PROFILE.items()}}
        response = applicant.post("/api/platform/register", json=payload)
        assert response.status_code == 201, response.text
        user = response.json()["user"]
        assert {key: user[key] for key in PROFILE} == PROFILE
        assert user["role"] == "lab" and user["requested_role"] == requested_role
        assert user["approval_status"] == "pending" and user["is_super_admin"] is False
        assert applicant.cookies.get(COOKIE_NAME) is None
        assert applicant.get("/api/platform/session").json()["user"] is None
        assert applicant.get("/api/platform/users").status_code == 401
        assert applicant.get("/api/platform/status").text.find(PROFILE["phone"]) == -1
    reopened = PlatformStore(store.data_dir)
    stored = reopened.authenticate("synthetic_profile", PASSWORD)
    assert {key: stored[key] for key in PROFILE} == PROFILE
    owner = reopened.create_user("synthetic_operator", PASSWORD, "admin", is_super_admin=True)
    with TestClient(app_for(reopened), base_url="https://testserver") as operator:
        login = operator.post("/api/platform/login", json={"username": owner["username"], "password": PASSWORD})
        listed = operator.get("/api/platform/users?approval_status=pending").json()["items"]
        assert len(listed) == 1 and listed[0]["id"] == user["id"]
        assert {key: listed[0][key] for key in PROFILE} == PROFILE
        approved = operator.patch(f'/api/platform/users/{user["id"]}', json={"approval_status": "approved"},
                                  headers={"X-CSRF-Token": login.json()["csrf_token"]})
        assert approved.status_code == 200
    with TestClient(app_for(reopened), base_url="https://testserver") as applicant:
        login = applicant.post("/api/platform/login", json={"username": "synthetic_profile", "password": PASSWORD})
        assert login.status_code == 200
        assert {key: login.json()["user"][key] for key in PROFILE} == PROFILE


@pytest.mark.parametrize("account_type", ["user", "expert"])
@pytest.mark.parametrize("field", PROFILE)
@pytest.mark.parametrize("invalid", [None, "", "  "])
def test_both_signup_types_require_every_profile_field(prepared, account_type, field, invalid):
    app, store = prepared
    payload = {"username": "synthetic_incomplete", "password": PASSWORD, "account_type": account_type, **PROFILE}
    if invalid is None:
        payload.pop(field)
    else:
        payload[field] = invalid
    with TestClient(app, base_url="https://testserver") as client:
        assert client.post("/api/platform/register", json=payload).status_code == 422
        assert client.cookies.get(COOKIE_NAME) is None
    with store.connection() as conn:
        assert conn.execute("SELECT count(*) FROM users").fetchone()[0] == 0


@pytest.mark.parametrize("phone", ["081234567", "08123456789", "+66812345678", "081-234567", "081 234567", "๐๘๑๒๓๔๕๖๗๘", 812345678, None])
def test_phone_requires_exactly_ten_ascii_digits(prepared, phone):
    app, store = prepared
    with TestClient(app, base_url="https://testserver") as client:
        response = client.post("/api/platform/register", json={"username": "synthetic_bad_phone", "password": PASSWORD, **PROFILE, "phone": phone})
        assert response.status_code == 422
    with store.connection() as conn:
        assert conn.execute("SELECT count(*) FROM users").fetchone()[0] == 0


@pytest.mark.parametrize("field,limit", [("full_name", 200), ("workplace", 300), ("affiliation", 300)])
def test_profile_text_is_bounded(prepared, field, limit):
    app, _store = prepared
    with TestClient(app, base_url="https://testserver") as client:
        response = client.post("/api/platform/register", json={"username": "synthetic_long_profile", "password": PASSWORD, **PROFILE, field: "ก" * (limit + 1)})
        assert response.status_code == 422


def test_self_profile_changes_require_password_csrf_rotate_sessions_and_cannot_elevate(prepared):
    app, store = prepared
    account = store.create_user("synthetic_existing", PASSWORD, **PROFILE)
    other = store.create_user("synthetic_other", PASSWORD)
    with TestClient(app, base_url="https://testserver") as client, TestClient(app, base_url="https://testserver") as second:
        credentials = {"username": account["username"], "password": PASSWORD}
        login = client.post("/api/platform/login", json=credentials).json()
        second.post("/api/platform/login", json=credentials)
        old_cookie = client.cookies.get(COOKIE_NAME)
        headers = {"X-CSRF-Token": login["csrf_token"]}
        update = {"current_password": PASSWORD, "full_name": "ชื่อใหม่ นามสกุลใหม่", "phone": "0898765432"}
        assert client.patch("/api/platform/account", json=update).status_code == 403
        assert client.patch("/api/platform/account", json={**update, "current_password": "wrong-password"}, headers=headers).status_code == 403
        assert client.patch("/api/platform/account", json={**update, "role": "admin"}, headers=headers).status_code == 422
        assert client.patch("/api/platform/account", json={**update, "phone": "123"}, headers=headers).status_code == 422
        changed = client.patch("/api/platform/account", json=update, headers=headers)
        assert changed.status_code == 200, changed.text
        assert changed.json()["user"]["id"] == account["id"]
        assert changed.json()["user"]["role"] == "lab"
        assert changed.json()["user"]["full_name"] == update["full_name"]
        assert changed.json()["user"]["phone"] == update["phone"]
        assert changed.json()["user"]["workplace"] == PROFILE["workplace"]
        assert client.cookies.get(COOKIE_NAME) != old_cookie
        assert second.get("/api/platform/session").json()["user"] is None
        assert client.get("/api/platform/users").status_code == 403
        assert client.get(f'/api/platform/audit/users/{other["id"]}').status_code == 403
    assert store.authenticate(other["username"], PASSWORD)["phone"] is None


def test_v2_migration_preserves_ids_passwords_sessions_roles_history_and_audit(tmp_path):
    directory = tmp_path / "legacy-v2"
    store = PlatformStore(directory)
    owner = store.create_user("synthetic_legacy_owner", PASSWORD, "admin", is_super_admin=True)
    user = store.create_user("synthetic_legacy_user", PASSWORD)
    pending = store.create_user("synthetic_legacy_pending", PASSWORD, approval_status="pending", requested_role="reviewer")
    record = store.create_document("analysis", {"status": "completed", "sample_code": "SYNTHETIC"}, user["id"], user["id"])
    raw = "Synthetic-v2-session-token-for-tests-only-2026"
    with store.transaction() as conn:
        conn.execute("INSERT INTO sessions VALUES (?,?,?,?)", (hashlib.sha256(raw.encode()).hexdigest(), user["id"], "2026-01-01T00:00:00Z", "2099-01-01T00:00:00Z"))
        before = {row["id"]: dict(row) for row in conn.execute("SELECT * FROM users")}
        audit_count = conn.execute("SELECT count(*) FROM audit_logs").fetchone()[0]
        for key in PROFILE:
            conn.execute(f"ALTER TABLE users DROP COLUMN {key}")
        conn.execute("UPDATE schema_version SET version=2")
    upgraded = PlatformStore(directory)
    with upgraded.connection() as conn:
        assert conn.execute("SELECT version FROM schema_version").fetchone()[0] == SCHEMA_VERSION == 3
        assert conn.execute("SELECT count(*) FROM sessions").fetchone()[0] == 1
        assert conn.execute("SELECT count(*) FROM audit_logs").fetchone()[0] == audit_count
        after = {row["id"]: dict(row) for row in conn.execute("SELECT * FROM users")}
        assert before == after
    assert upgraded.get_document("analysis", record["id"]) == record
    assert upgraded.authenticate(owner["username"], PASSWORD)["is_super_admin"] is True
    assert upgraded.authenticate(pending["username"], PASSWORD)["approval_status"] == "pending"
    with TestClient(app_for(upgraded), base_url="https://testserver") as client:
        client.cookies.set(COOKIE_NAME, raw)
        current = client.get("/api/platform/session").json()["user"]
        assert current["id"] == user["id"] and all(current[key] is None for key in PROFILE)
        login = client.post("/api/platform/login", json={"username": user["username"], "password": PASSWORD})
        assert login.status_code == 200
    # Reopening is idempotent and does not append migration noise or revoke cookies.
    assert PlatformStore(directory).authenticate(user["username"], PASSWORD)["id"] == user["id"]

"""Real HTTP/CLI checks for user-selected short credentials, with no role bypass."""
from __future__ import annotations

import sys

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.platform import bootstrap
from backend.platform.auth import router
from backend.platform.store import PlatformStore, hash_password

ORIGIN = {"Origin": "https://testserver"}
# Test fixture only; this value is never a configured production credential.
SETUP_TOKEN = "SYNTHETIC-POLICY-SETUP-ONLY_not-a-production-token"
LONG_USERNAME = "Synthetic_" + "a" * 140 + "-9"


@pytest.fixture
def prepared(tmp_path, monkeypatch):
    monkeypatch.delenv("HELPMINTHS_ADMIN_SETUP_TOKEN", raising=False)
    store = PlatformStore(tmp_path / "private")
    app = FastAPI()
    app.state.platform_store = store
    app.include_router(router)
    return app, store


def login(client, username, password):
    response = client.post("/api/platform/login", json={"username": username, "password": password}, headers=ORIGIN)
    assert response.status_code == 200, response.text
    return {**ORIGIN, "X-CSRF-Token": response.json()["csrf_token"]}


@pytest.mark.parametrize("username,password", [("a", "abcd"), (LONG_USERNAME, "1234")])
def test_registration_login_and_self_edit_accept_unbounded_name_count_and_four_char_passwords(prepared, username, password):
    app, store = prepared
    with TestClient(app, base_url="https://testserver") as client:
        response = client.post("/api/platform/register", json={"username": username, "password": password}, headers=ORIGIN)
        assert response.status_code == 201, response.text
        created = response.json()
        assert created["user"]["username"] == username and created["user"]["role"] == "lab"
        assert client.get("/api/platform/users").status_code == 403
        assert client.post("/api/platform/logout", headers={**ORIGIN, "X-CSRF-Token": created["csrf_token"]}).status_code == 200
        headers = login(client, "  " + username.upper() + "  ", password)
        changed_name = LONG_USERNAME if username == "a" else "z"
        changed_password = "1234" if password == "abcd" else "abcd"
        updated = client.patch("/api/platform/account", json={"current_password": password, "username": changed_name, "new_password": changed_password}, headers=headers)
        assert updated.status_code == 200, updated.text
        after = updated.json()
        assert after["user"]["id"] == created["user"]["id"]
        assert after["user"]["username"] == changed_name
        assert after["user"]["role"] == "lab"
        assert client.get("/api/platform/users").status_code == 403
        assert client.post("/api/platform/logout", headers={**ORIGIN, "X-CSRF-Token": after["csrf_token"]}).status_code == 200
        login(client, changed_name, changed_password)
        assert store.authenticate(changed_name, changed_password)["id"] == created["user"]["id"]


@pytest.mark.parametrize("bad_username", ["", " ", "_first", ".first", "bad name", "ชื่อไทย"])
def test_no_username_count_rule_does_not_remove_nonempty_or_allowed_character_validation(prepared, bad_username):
    app, store = prepared
    with TestClient(app, base_url="https://testserver") as client:
        for endpoint in ["/register", "/login"]:
            response = client.post("/api/platform" + endpoint, json={"username": bad_username, "password": "abcd"}, headers=ORIGIN)
            assert response.status_code == 422
        with store.connection() as conn:
            assert conn.execute("SELECT count(*) FROM users").fetchone()[0] == 0


def test_admin_setup_create_reset_and_expert_verification_accept_four_char_credentials(prepared, monkeypatch):
    app, store = prepared
    monkeypatch.setenv("HELPMINTHS_ADMIN_SETUP_TOKEN", SETUP_TOKEN)
    with TestClient(app, base_url="https://testserver") as admin, TestClient(app, base_url="https://testserver") as reviewer:
        setup = admin.post("/api/platform/admin-setup", json={"setup_token": SETUP_TOKEN, "username": "r", "password": "abcd"}, headers=ORIGIN)
        assert setup.status_code == 201, setup.text
        assert setup.json()["expert_verified_until"] is None
        admin_headers = {**ORIGIN, "X-CSRF-Token": setup.json()["csrf_token"]}
        assert admin.post("/api/platform/expert-login", json={"username": "r", "password": "abcd"}, headers=admin_headers).status_code == 200
        created = admin.post("/api/platform/users", json={"username": LONG_USERNAME, "password": "1234", "role": "reviewer"}, headers=admin_headers)
        assert created.status_code == 201, created.text
        user = created.json()
        reviewer_headers = login(reviewer, LONG_USERNAME, "1234")
        verified = reviewer.post("/api/platform/expert-login", json={"username": LONG_USERNAME, "password": "1234"}, headers=reviewer_headers)
        assert verified.status_code == 200
        assert verified.json()["verified"] is True
        reset = admin.patch(f'/api/platform/users/{user["id"]}', json={"password": "abcd"}, headers=admin_headers)
        assert reset.status_code == 200
        assert reviewer.get("/api/platform/session").json()["user"] is None
        assert store.authenticate(LONG_USERNAME, "1234") is None
        reviewer_headers = login(reviewer, LONG_USERNAME, "abcd")
        assert reviewer.post("/api/platform/expert-login", json={"password": "abcd"}, headers=reviewer_headers).status_code == 200


@pytest.mark.parametrize("short_password", ["", "a", "12", "abc"])
def test_passwords_shorter_than_four_are_rejected_for_creation_update_and_reset(prepared, monkeypatch, short_password):
    app, store = prepared
    monkeypatch.setenv("HELPMINTHS_ADMIN_SETUP_TOKEN", SETUP_TOKEN)
    with TestClient(app, base_url="https://testserver") as admin, TestClient(app, base_url="https://testserver") as anonymous:
        invalid_setup = anonymous.post("/api/platform/admin-setup", json={"setup_token": SETUP_TOKEN, "username": "a", "password": short_password}, headers=ORIGIN)
        assert invalid_setup.status_code == 422
        invalid_signup = anonymous.post("/api/platform/register", json={"username": "b", "password": short_password}, headers=ORIGIN)
        assert invalid_signup.status_code == 422
        account = store.create_user("a", "abcd", "admin")
        headers = login(admin, "a", "abcd")
        assert admin.post("/api/platform/users", json={"username": "b", "password": short_password, "role": "lab"}, headers=headers).status_code == 422
        assert admin.patch("/api/platform/account", json={"current_password": "abcd", "new_password": short_password}, headers=headers).status_code == 422
        assert admin.patch(f'/api/platform/users/{account["id"]}', json={"password": short_password}, headers=headers).status_code == 422
        assert store.authenticate("a", "abcd")["id"] == account["id"]


def test_short_names_keep_case_insensitive_uniqueness_and_registration_role_limits(prepared):
    app, _store = prepared
    with TestClient(app, base_url="https://testserver") as first, TestClient(app, base_url="https://testserver") as second:
        response = first.post("/api/platform/register", json={"username": "a", "password": "abcd"}, headers=ORIGIN)
        assert response.status_code == 201
        assert second.post("/api/platform/register", json={"username": "A", "password": "1234"}, headers=ORIGIN).status_code == 409
        assert second.post("/api/platform/register", json={"username": "b", "password": "1234", "role": "reviewer"}, headers=ORIGIN).status_code == 422
        assert second.post("/api/platform/login", json={"username": "a", "password": "1234"}, headers=ORIGIN).status_code == 401
        assert first.get("/api/platform/users").status_code == 403


@pytest.mark.parametrize("username,password", [("a", "abcd"), (LONG_USERNAME, "1234")])
def test_cli_bootstrap_uses_the_same_username_and_password_policy(tmp_path, monkeypatch, username, password):
    directory = tmp_path / "cli-private"
    monkeypatch.setenv("HELPMINTHS_DATA_DIR", str(directory))
    monkeypatch.setattr(sys, "argv", ["bootstrap", "--username", username])
    supplied = iter([password, password])
    monkeypatch.setattr(bootstrap.getpass, "getpass", lambda _prompt: next(supplied))
    assert bootstrap.main() == 0
    assert PlatformStore(directory).authenticate(username, password)["role"] == "admin"


def test_password_hash_byte_limit_remains_bounded_without_composition_rules():
    assert hash_password("abcd").startswith("scrypt$")
    assert hash_password("1234").startswith("scrypt$")
    with pytest.raises(HTTPException) as rejected:
        hash_password("a" * 1025)
    assert rejected.value.status_code == 422

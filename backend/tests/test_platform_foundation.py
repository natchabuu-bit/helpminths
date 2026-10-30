"""Synthetic fixtures exercise security/storage behavior, never production users."""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.platform.auth import assert_access, router
from backend.platform.store import PlatformStore, flatten_document

PASSWORD = "Synthetic-test-password-2026!"


def application(store: PlatformStore) -> FastAPI:
    app = FastAPI()
    app.state.platform_store = store
    app.state.model_service = SimpleNamespace(ready=False, name=None, message="Not configured test fixture")
    app.include_router(router)
    return app


@pytest.fixture
def store(tmp_path):
    return PlatformStore(tmp_path / "private")


@pytest.fixture
def prepared(store):
    admin = store.create_user("test_admin", PASSWORD, "admin")
    lab = store.create_user("test_lab", PASSWORD, "lab", actor_id=admin["id"])
    student = store.create_user("test_student", PASSWORD, "student", actor_id=admin["id"])
    return application(store), admin, lab, student


def sign_in(client, name="test_admin"):
    response = client.post("/api/platform/login", json={"username": name, "password": PASSWORD}, headers={"Origin": "https://testserver"})
    assert response.status_code == 200, response.text
    return response.json()["csrf_token"]


def test_unconfigured_storage_does_not_create_data_or_accounts(monkeypatch):
    monkeypatch.delenv("HELPMINTHS_DATA_DIR", raising=False)
    disabled = PlatformStore()
    assert disabled.configured is False
    assert disabled.db_path is None
    with TestClient(application(disabled), base_url="https://testserver") as client:
        assert client.get("/api/platform/session").json() == {"configured": False, "user": None, "csrf_token": None, "bootstrap_required": False}
        status = client.get("/api/platform/status").json()
        assert status["database"] == "not_configured"
        assert status["model"]["ready"] is False
        assert client.post("/api/platform/login", json={"username": "not_configured", "password": PASSWORD}).status_code == 503


def test_passwords_are_salted_and_never_in_public_accounts_or_audits(store):
    one = store.create_user("first_admin", PASSWORD, "admin")
    two = store.create_user("second_admin", PASSWORD, "admin")
    with store.connection() as conn:
        hashes = [row[0] for row in conn.execute("SELECT password_hash FROM users")]
    assert len(set(hashes)) == 2
    assert all(value.startswith("scrypt$") and PASSWORD not in value for value in hashes)
    assert "password" not in str(one).lower()
    assert "password_hash" not in str(store.list_audit("users", two["id"]))
    assert PASSWORD not in str(store.list_audit("users", one["id"]))
    assert store.authenticate("FIRST_ADMIN", PASSWORD)["id"] == one["id"]
    assert store.authenticate("first_admin", "wrong-password") is None
    assert store.authenticate("missing_admin", PASSWORD) is None
    with pytest.raises(HTTPException) as error:
        store.create_user("short_password", "123", "lab")
    assert error.value.status_code == 422
    with pytest.raises(HTTPException) as error:
        store.create_user("first_admin", PASSWORD, "lab")
    assert error.value.status_code == 409


def test_login_cookie_csrf_origin_logout_and_no_store(prepared):
    app, *_ = prepared
    with TestClient(app, base_url="https://testserver") as client:
        assert client.post("/api/platform/login", json={"username": "test_admin", "password": PASSWORD}, headers={"Origin": "https://untrusted.example"}).status_code == 403
        response = client.post("/api/platform/login", json={"username": "test_admin", "password": PASSWORD}, headers={"Origin": "https://testserver"})
        assert response.status_code == 200
        cookie = response.headers["set-cookie"].lower()
        assert "httponly" in cookie and "secure" in cookie and "samesite=lax" in cookie
        csrf = response.json()["csrf_token"]
        session = client.get("/api/platform/session")
        assert session.headers["cache-control"] == "no-store"
        assert session.json()["csrf_token"] == csrf
        assert client.post("/api/platform/logout").status_code == 403
        assert client.post("/api/platform/logout", headers={"X-CSRF-Token": "invalid"}).status_code == 403
        assert client.post("/api/platform/logout", headers={"X-CSRF-Token": csrf, "Origin": "https://untrusted.example"}).status_code == 403
        assert client.post("/api/platform/logout", headers={"X-CSRF-Token": csrf, "Origin": "https://testserver"}).status_code == 200
        assert client.get("/api/platform/session").json()["user"] is None
        assert client.get("/api/platform/users").status_code == 401


def test_role_permissions_revocation_and_last_administrator_guard(prepared):
    app, admin, lab, student = prepared
    with TestClient(app, base_url="https://testserver") as admin_client, TestClient(app, base_url="https://testserver") as lab_client, TestClient(app, base_url="https://testserver") as student_client:
        csrf = sign_in(admin_client)
        sign_in(lab_client, lab["username"])
        sign_in(student_client, student["username"])
        assert lab_client.get("/api/platform/users").status_code == 403
        assert student_client.get("/api/platform/users").status_code == 403
        assert admin_client.post("/api/platform/users", json={"username": "missing_csrf", "password": PASSWORD, "role": "lab"}).status_code == 403
        assert admin_client.get("/api/platform/users").json()["total"] == 3
        headers = {"X-CSRF-Token": csrf}
        assert admin_client.patch(f'/api/platform/users/{admin["id"]}', json={"role": "lab"}, headers=headers).status_code == 409
        assert admin_client.patch(f'/api/platform/users/{admin["id"]}', json={"active": False}, headers=headers).status_code == 409
        assert admin_client.patch(f'/api/platform/users/{lab["id"]}', json={"role": "reviewer"}, headers=headers).status_code == 200
        assert lab_client.get("/api/platform/session").json()["user"] is None
        # Reactivating/changing an account never revives its prior session.
        assert admin_client.patch(f'/api/platform/users/{lab["id"]}', json={"active": False}, headers=headers).status_code == 200
        assert lab_client.post("/api/platform/login", json={"username": lab["username"], "password": PASSWORD}).status_code == 401
        assert student_client.get("/api/platform/session").json()["user"]["id"] == student["id"]
        second = admin_client.post("/api/platform/users", json={"username": "another_admin", "password": PASSWORD, "role": "admin"}, headers=headers)
        assert second.status_code == 201
        assert admin_client.patch(f'/api/platform/users/{admin["id"]}', json={"role": "lab"}, headers=headers).status_code == 200
        assert admin_client.get("/api/platform/session").json()["user"] is None


def test_document_transactions_conflicts_soft_delete_and_immutable_audit(store):
    user = store.create_user("test_owner", PASSWORD, "lab")
    reviewer = store.create_user("test_reviewer", PASSWORD, "reviewer")
    with store.transaction() as conn:
        original = store.create_document("analysis", {"status": "completed", "detections": []}, user["id"], user["id"], conn=conn)
    assert original["revision"] == 1
    assert flatten_document(original)["status"] == "completed"
    assert_access(reviewer, original)
    assert_access(user, original)
    with pytest.raises(HTTPException):
        assert_access({"id": "another-user", "role": "lab"}, original)
    updated = store.update_document("analysis", original["id"], {"status": "completed", "note": "actual test edit", "detections": []}, user["id"], 1)
    assert updated["revision"] == 2
    with pytest.raises(HTTPException) as error:
        store.update_document("analysis", original["id"], {}, user["id"], 1)
    assert error.value.status_code == 409
    deleted = store.soft_delete_document("analysis", original["id"], user["id"], 2)
    assert deleted["deleted_at"]
    assert store.get_document("analysis", original["id"]) is None
    assert store.get_document("analysis", original["id"], include_deleted=True)["revision"] == 3
    audit = store.list_audit("analysis", original["id"])
    assert [event["action"] for event in audit] == ["deleted", "updated", "created"]
    assert audit[1]["before_data"]["detections"] == []
    assert audit[1]["after_data"]["note"] == "actual test edit"
    with store.connection() as conn:
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            conn.execute("DELETE FROM audit_logs")
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            conn.execute("UPDATE audit_logs SET action='changed'")
    with pytest.raises(ValueError):
        with store.transaction() as conn:
            store.create_document("report", {"content": "will roll back"}, user["id"], user["id"], conn=conn)
            raise ValueError("rollback test")
    assert store.count_documents("report") == 0


def test_storage_permissions_idempotent_schema_and_unsafe_location_rejection(store, tmp_path):
    user = store.create_user("private_owner", PASSWORD, "lab")
    doc = store.create_document("report", {"only": "test data"}, user["id"], user["id"])
    reopened = PlatformStore(store.data_dir)
    assert reopened.get_document("report", doc["id"])["data"]["only"] == "test data"
    with reopened.connection() as conn:
        assert conn.execute("SELECT count(*) FROM schema_version").fetchone()[0] == 1
    assert os.stat(store.data_dir).st_mode & 0o777 == 0o700
    assert os.stat(store.image_dir).st_mode & 0o777 == 0o700
    assert os.stat(store.db_path).st_mode & 0o777 == 0o600
    repository = Path(__file__).resolve().parents[2]
    for directory in (repository / "public" / "forbidden-test-data", repository / "dist" / "forbidden-test-data"):
        with pytest.raises(RuntimeError, match="outside public and dist"):
            PlatformStore(directory)
        assert not directory.exists()
    link = tmp_path / "linked-storage"
    link.symlink_to(store.data_dir, target_is_directory=True)
    with pytest.raises(RuntimeError, match="symbolic link"):
        PlatformStore(link)


def test_login_rate_limit_is_real_and_independent_of_password_result(prepared):
    app, *_ = prepared
    with TestClient(app, base_url="https://testserver") as client:
        for _ in range(5):
            assert client.post("/api/platform/login", json={"username": "missing_user", "password": PASSWORD}).status_code == 401
        response = client.post("/api/platform/login", json={"username": "missing_user", "password": PASSWORD})
        assert response.status_code == 429
        assert response.headers["retry-after"] == "60"

"""External persistence regressions use disposable LOCAL PostgreSQL only.

Set HELPMINTHS_TEST_POSTGRES_URL to a local test cluster. Credentials and chart
objects in these cases are synthetic; no production/Supabase project is used.
"""
from __future__ import annotations

import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.platform.persistence import create_platform_store
from backend.platform.store import PlatformStore

PASSWORD = "SYNTHETIC-external-persistence-test-only-2026!"
ORIGIN = {"Origin": "https://testserver"}
PROFILE = {"full_name": "ผู้ใช้ ทดสอบ", "workplace": "สถานที่ทดสอบ", "affiliation": "สังกัดทดสอบ", "phone": "0800000000"}


class SyntheticModel:
    ready = False
    name = "SYNTHETIC-PERSISTENCE-CHART-ONLY"
    version = "synthetic-no-trained-diagnostic-model"
    metadata = {"test_fixture": True}
    message = "SYNTHETIC TEST ONLY"

    def load(self):
        self.ready = True

    def predict(self, image, confidence):
        return []


@pytest.fixture
def local_postgres_url():
    base = os.getenv("HELPMINTHS_TEST_POSTGRES_URL")
    if not base:
        pytest.skip("Set HELPMINTHS_TEST_POSTGRES_URL for disposable local PostgreSQL tests")
    parsed = urlsplit(base)
    if parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        pytest.fail("PostgreSQL integration tests only accept an explicitly local test server")
    psycopg = pytest.importorskip("psycopg")
    from psycopg import sql

    name = "helpminths_accounts_" + uuid.uuid4().hex
    with psycopg.connect(base, autocommit=True) as administrator:
        administrator.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    try:
        yield urlunsplit(parsed._replace(path="/" + name))
    finally:
        with psycopg.connect(base, autocommit=True) as administrator:
            administrator.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))


@pytest.fixture
def external_env(local_postgres_url, monkeypatch):
    monkeypatch.setenv("HELPMINTHS_DATABASE_BACKEND", "postgres")
    monkeypatch.setenv("HELPMINTHS_DATABASE_URL", local_postgres_url)
    monkeypatch.setenv("HELPMINTHS_SUPER_ADMIN_PASSWORD", PASSWORD)
    monkeypatch.delenv("HELPMINTHS_AUTO_STORAGE", raising=False)
    monkeypatch.delenv("HELPMINTHS_STORAGE_DURABLE", raising=False)
    monkeypatch.delenv("HELPMINTHS_ADMIN_SETUP_TOKEN", raising=False)
    return local_postgres_url


def sign_in(client, name="Super Admin"):
    response = client.post("/api/platform/login", json={"username": name, "password": PASSWORD}, headers=ORIGIN)
    assert response.status_code == 200, response.text
    return response.json(), {**ORIGIN, "X-CSRF-Token": response.json()["csrf_token"]}


def test_existing_local_selection_remains_compatible(tmp_path, monkeypatch):
    monkeypatch.delenv("HELPMINTHS_DATABASE_BACKEND", raising=False)
    monkeypatch.delenv("HELPMINTHS_DATABASE_URL", raising=False)
    store = create_platform_store(tmp_path / "private")
    assert type(store) is PlatformStore
    assert store.db_path.is_file()


@pytest.mark.parametrize("backend,url", [
    ("postgres", ""), ("unsupported", ""), ("sqlite", "postgresql://USER:DO-NOT-PRINT@localhost/db"),
])
def test_invalid_external_configuration_never_creates_a_local_database(tmp_path, monkeypatch, backend, url):
    monkeypatch.setenv("HELPMINTHS_DATABASE_BACKEND", backend)
    monkeypatch.setenv("HELPMINTHS_DATABASE_URL", url)
    directory = tmp_path / "must-not-create"
    with pytest.raises(RuntimeError) as error:
        create_platform_store(directory)
    assert "DO-NOT-PRINT" not in str(error.value)
    assert not directory.exists()


def test_accounts_approvals_owner_and_documents_survive_erasing_render_files(external_env, tmp_path):
    directory = tmp_path / "render-instance-one"
    app = create_app(SyntheticModel(), platform_dir=directory)
    with TestClient(app, base_url="https://testserver") as owner, TestClient(app, base_url="https://testserver") as user:
        registered = user.post("/api/platform/register", json={**PROFILE, "username": "SYNTHETIC retained user", "password": PASSWORD}, headers=ORIGIN)
        assert registered.status_code == 201, registered.text
        registered = registered.json()["user"]
        assert registered["approval_status"] == "pending"
        _, owner_headers = sign_in(owner)
        approved = owner.patch(f'/api/platform/users/{registered["id"]}', json={"approval_status": "approved"}, headers=owner_headers)
        assert approved.status_code == 200, approved.text
        identity, _ = sign_in(user, registered["username"])
        assert identity["user"]["id"] == registered["id"]
        store = app.state.platform_store
        saved = store.create_document("analysis", {"status": "completed", "sample_code": "SYNTHETIC saved metadata", "detections": []}, registered["id"], registered["id"])
        with store.transaction() as connection:
            connection.execute("UPDATE sessions SET expires_at=? WHERE user_id=?", ("2000-01-01T00:00:00.000Z", registered["id"]))
            password_hash = connection.execute("SELECT password_hash FROM users WHERE id=?", (registered["id"],)).fetchone()[0]
        assert user.get("/api/platform/session").json()["user"] is None
        status = owner.get("/api/platform/status").json()
        assert status["database_backend"] == "postgres" and status["accounts_persistent"] is True
        assert status["storage"]["mode"] == "mixed"
        assert status["storage"]["database_durable"] is True and status["storage"]["images_durable"] is False
        assert external_env not in json.dumps(status)
        assert not (directory / "helpminths.sqlite3").exists()

    # Simulate replacement of the whole Render Free filesystem, not just an
    # application restart that happens to leave the same local SQLite file.
    shutil.rmtree(directory)
    reopened = create_app(SyntheticModel(), platform_dir=tmp_path / "render-instance-two")
    with TestClient(reopened, base_url="https://testserver") as user, TestClient(reopened, base_url="https://testserver") as owner:
        identity, _ = sign_in(user, registered["username"])
        assert identity["user"]["id"] == registered["id"]
        assert identity["user"]["approval_status"] == "approved"
        assert identity["user"]["full_name"] == PROFILE["full_name"]
        same_name = user.post("/api/platform/register", json={**PROFILE, "username": registered["username"], "password": PASSWORD}, headers=ORIGIN)
        assert same_name.status_code == 409
        store = reopened.state.platform_store
        assert store.get_document("analysis", saved["id"])["data"]["sample_code"] == "SYNTHETIC saved metadata"
        daily = user.get("/api/platform/history/days?referral_state=all")
        assert daily.status_code == 200, daily.text
        daily_counts = daily.json()["items"][0]
        assert type(daily_counts["completed"]) is int and daily_counts["completed"] == 1
        assert type(daily_counts["failed"]) is int and daily_counts["failed"] == 0
        with store.connection() as connection:
            assert connection.execute("SELECT password_hash FROM users WHERE id=?", (registered["id"],)).fetchone()[0] == password_hash
            assert connection.execute("SELECT COUNT(*) FROM users WHERE is_super_admin=1").fetchone()[0] == 1
            assert connection.execute("SELECT COUNT(*) FROM audit_logs WHERE action='owner_host_bootstrapped'").fetchone()[0] == 1
        _, _ = sign_in(owner)
        assert owner.get("/api/platform/users?approval_status=pending").json()["total"] == 0


def test_external_case_insensitive_uniqueness_revision_guards_and_atomic_rollback(external_env, tmp_path):
    store = create_platform_store(tmp_path / "media")
    first = store.create_user("SYNTHETIC Unique Name", PASSWORD)
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as collision:
        store.create_user("synthetic UNIQUE name", PASSWORD)
    assert collision.value.status_code == 409
    assert store.authenticate("synthetic unique NAME", PASSWORD)["id"] == first["id"]
    doc = store.create_document("analysis", {"value": 1}, first["id"], first["id"])
    updated = store.update_document("analysis", doc["id"], {"value": 2}, first["id"], 1)
    assert updated["revision"] == 2
    with pytest.raises(HTTPException) as stale:
        store.update_document("analysis", doc["id"], {"value": 999}, first["id"], 1)
    assert stale.value.status_code == 409
    with pytest.raises(RuntimeError, match="SYNTHETIC rollback"):
        with store.transaction() as connection:
            store.create_user("SYNTHETIC rolled back", PASSWORD, conn=connection)
            raise RuntimeError("SYNTHETIC rollback")
    assert store.authenticate("SYNTHETIC rolled back", PASSWORD) is None
    assert store.get_document("analysis", doc["id"])["data"] == {"value": 2}


def test_expert_verification_remains_15_minutes_after_reopening_app(external_env, tmp_path):
    app = create_app(SyntheticModel(), platform_dir=tmp_path / "media-one")
    expert = app.state.platform_store.create_user("SYNTHETIC retained expert", PASSWORD, "reviewer")
    with TestClient(app, base_url="https://testserver") as client:
        session, headers = sign_in(client, expert["username"])
        assert session["expert_verified_until"] is None
        response = client.post("/api/platform/expert-login", json={"password": PASSWORD}, headers=headers)
        assert response.status_code == 200, response.text
        until = response.json()["verified_until"]
        seconds = (datetime.fromisoformat(until.replace("Z", "+00:00")) - datetime.now(timezone.utc)).total_seconds()
        assert 890 < seconds <= 900
        cookie = client.cookies.get("helpminths_session")
    reopened = create_app(SyntheticModel(), platform_dir=tmp_path / "media-two")
    with TestClient(reopened, base_url="https://testserver") as client:
        client.cookies.set("helpminths_session", cookie)
        state = client.get("/api/platform/session").json()
        assert state["user"]["id"] == expert["id"]
        assert state["expert_verified_until"] == until


def test_postgres_date_filter_excludes_the_next_thai_midnight(external_env, tmp_path):
    app = create_app(SyntheticModel(), platform_dir=tmp_path / "media")
    store = app.state.platform_store
    user = store.create_user("SYNTHETIC Thai-day user", PASSWORD)
    for stamp in ("2026-05-31T17:00:00.000Z", "2026-06-01T16:59:59.999Z", "2026-06-01T17:00:00.000Z"):
        document = store.create_document("analysis", {"status": "completed", "detections": []}, user["id"], user["id"])
        with store.transaction() as connection:
            connection.execute("UPDATE documents SET created_at=? WHERE id=?", (stamp, document["id"]))
    with TestClient(app, base_url="https://testserver") as client:
        sign_in(client, user["username"])
        response = client.get("/api/platform/history/days?date_from=2026-06-01&date_to=2026-06-01&referral_state=all")
        assert response.status_code == 200, response.text
        assert response.json()["total_analyses"] == 2
        assert response.json()["items"] == [{"date": "2026-06-01", "total": 2, "completed": 2, "failed": 0}]

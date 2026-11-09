"""Version 1 upgrades preserve records and require explicit account approval."""
from __future__ import annotations

import hashlib
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.platform.auth import COOKIE_NAME, router
from backend.platform.store import SCHEMA_VERSION, PlatformStore, hash_password


PASSWORD = "Synthetic-migration-only-2026!"
RAW_SESSION = "SYNTHETIC-migration-session-token-never-for-production-2026"


def version_one(directory, accounts):
    directory.mkdir()
    with sqlite3.connect(directory / "helpminths.sqlite3") as conn:
        conn.executescript("""
            CREATE TABLE schema_version(version INTEGER PRIMARY KEY);
            INSERT INTO schema_version VALUES (1);
            CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL, role TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
            CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
                created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
            CREATE TABLE documents(id TEXT PRIMARY KEY, kind TEXT NOT NULL, owner_id TEXT REFERENCES users(id),
                data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT);
            CREATE TABLE audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,
                document_id TEXT NOT NULL, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL,
                created_at TEXT NOT NULL, before_data TEXT, after_data TEXT);
        """)
        for identifier, role, active, created in accounts:
            conn.execute("INSERT INTO users VALUES (?,?,?,?,?,?)",
                         (identifier, identifier, hash_password(PASSWORD), role, active, created))
        conn.execute("INSERT INTO sessions VALUES (?,?,?,?)", (
            hashlib.sha256(RAW_SESSION.encode()).hexdigest(), accounts[-1][0],
            "2026-01-01T00:00:00Z", "2099-01-01T00:00:00Z"))
        conn.execute("INSERT INTO documents VALUES ('legacy-analysis','analysis',?,?,'2025-01-01Z','2025-01-01Z',3,NULL)",
                     (accounts[-1][0], '{"status":"completed","note":"synthetic preserved record"}'))
        conn.execute("INSERT INTO audit_logs(kind,document_id,actor_id,action,created_at,after_data) VALUES ('analysis','legacy-analysis',?,'legacy_created','2025-01-01Z',?)",
                     (accounts[-1][0], '{"note":"synthetic original audit"}'))


def test_v1_migration_preserves_operator_credentials_and_restricts_every_other_account(tmp_path):
    directory = tmp_path / "legacy-private"
    version_one(directory, [
        ("inactive-admin", "admin", 0, "2025-01-01T00:00:00Z"),
        ("established-operator", "admin", 1, "2025-02-01T00:00:00Z"),
        ("later-admin", "admin", 1, "2025-03-01T00:00:00Z"),
        ("existing-expert", "reviewer", 1, "2025-04-01T00:00:00Z"),
        ("existing-general", "lab", 1, "2025-05-01T00:00:00Z"),
    ])
    # The current initializer creates missing storage tables before migration;
    # old account rows and credentials themselves are never rewritten.
    with sqlite3.connect(directory / "helpminths.sqlite3") as conn:
        before_hashes = dict(conn.execute("SELECT id,password_hash FROM users"))
    store = PlatformStore(directory)
    analysis = store.get_document("analysis", "legacy-analysis")
    assert analysis["revision"] == 3 and analysis["owner_id"] == "existing-general"
    assert analysis["data"]["note"] == "synthetic preserved record"
    assert store.list_audit("analysis", "legacy-analysis")[0]["after_data"] == {"note": "synthetic original audit"}
    with store.connection() as conn:
        assert conn.execute("SELECT version FROM schema_version").fetchone()[0] == SCHEMA_VERSION
        rows = {row["id"]: dict(row) for row in conn.execute("SELECT * FROM users")}
        assert conn.execute("SELECT count(*) FROM sessions").fetchone()[0] == 0
    owner = rows["established-operator"]
    assert owner["is_super_admin"] == 1 and owner["approval_status"] == "approved"
    assert owner["approved_by"] == owner["id"] and owner["approved_at"]
    for identifier, row in rows.items():
        assert row["password_hash"] == before_hashes[identifier]
        assert row["requested_role"] == row["role"]
        if identifier != owner["id"]:
            assert row["is_super_admin"] == 0 and row["approval_status"] == "pending"
            assert row["approved_by"] is None and row["approved_at"] is None
    app = FastAPI()
    app.state.platform_store = store
    app.include_router(router)
    with TestClient(app, base_url="https://testserver") as client:
        client.cookies.set(COOKIE_NAME, RAW_SESSION)
        assert client.get("/api/platform/session").json()["user"] is None
        assert client.get("/api/platform/users").status_code == 401
        pending = client.post("/api/platform/login", json={"username": "existing-expert", "password": PASSWORD})
        assert pending.status_code == 403 and pending.json()["detail"]["code"] == "account_pending"
        login = client.post("/api/platform/login", json={"username": owner["username"], "password": PASSWORD})
        assert login.status_code == 200 and login.json()["user"]["is_super_admin"] is True
        headers = {"X-CSRF-Token": login.json()["csrf_token"]}
        approved = client.patch("/api/platform/users/existing-expert", json={"approval_status": "approved"}, headers=headers)
        assert approved.status_code == 200 and approved.json()["role"] == "reviewer"
    reopened = PlatformStore(directory)
    assert reopened.authenticate("existing-expert", PASSWORD)["approval_status"] == "approved"
    events = reopened.list_audit("users", "existing-expert")
    assert sum(event["action"] == "account_approval_migrated" for event in events) == 1
    assert PASSWORD not in str(events) and before_hashes["existing-expert"] not in str(events)


def test_v1_without_an_active_admin_never_elevates_a_public_account(tmp_path, monkeypatch):
    monkeypatch.delenv("HELPMINTHS_ADMIN_SETUP_TOKEN", raising=False)
    directory = tmp_path / "unclaimed-private"
    version_one(directory, [("first-public-user", "lab", 1, "2025-01-01T00:00:00Z")])
    store = PlatformStore(directory)
    user = store.authenticate("first-public-user", PASSWORD)
    assert user["approval_status"] == "pending" and user["is_super_admin"] is False
    assert store.has_users() is False
    with store.connection() as conn:
        assert conn.execute("SELECT count(*) FROM sessions").fetchone()[0] == 0
    # Ownership remains an explicit host operation after an account-only upgrade.
    owner = store.create_user("host-operator", PASSWORD, "admin", is_super_admin=True)
    assert owner["approval_status"] == "approved" and store.has_users() is True


def test_owner_uniqueness_and_required_approval_are_database_invariants(tmp_path):
    store = PlatformStore(tmp_path / "private")
    owner = store.create_user("operator", PASSWORD, "admin", is_super_admin=True)
    ordinary_admin = store.create_user("other-admin", PASSWORD, "admin")
    with store.connection() as conn:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("UPDATE users SET is_super_admin=1 WHERE id=?", (ordinary_admin["id"],))
        for statement in (
            "UPDATE users SET approval_status='pending' WHERE id=?",
            "UPDATE users SET active=0 WHERE id=?",
            "UPDATE users SET role='lab' WHERE id=?",
        ):
            with pytest.raises(sqlite3.IntegrityError, match="owner"):
                conn.execute(statement, (owner["id"],))
    assert PlatformStore(store.data_dir).authenticate("operator", PASSWORD)["is_super_admin"] is True

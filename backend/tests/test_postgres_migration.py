"""Migration safeguards use only explicitly synthetic, private SQLite fixtures.

The transaction/row-copy checks run without a remote service. Real PostgreSQL
integration separately verifies the production adapter and identity sequences.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import uuid
from urllib.parse import urlsplit, urlunsplit

import pytest

from backend.platform.migrate_postgres import MigrationError, inspect_source, main, migrate, source_database
from backend.platform.store import PlatformStore


PASSWORD = "SYNTHETIC-migration-password-not-a-production-credential"


class MigrationTarget(PlatformStore):
    """SQLite updates its own integer sequence after an explicit audit ID."""

    def reset_import_sequences(self, _conn):
        pass


@pytest.fixture
def source(tmp_path):
    store = PlatformStore(tmp_path / "old-private")
    owner = store.create_user("SYNTHETIC Owner", PASSWORD, "admin", is_super_admin=True)
    approved = store.create_user("SYNTHETIC Approved", PASSWORD, "reviewer", actor_id=owner["id"],
                                 full_name="ชื่อ ผู้ทดสอบ", workplace="สถานที่ทดสอบ", affiliation="สังกัดทดสอบ",
                                 phone="0800000000")
    pending = store.create_user("SYNTHETIC Pending", PASSWORD, "lab", approval_status="pending")
    rejected = store.create_user("SYNTHETIC Rejected", PASSWORD, "reviewer", approval_status="rejected")
    store.create_document("analysis", {"note": "SYNTHETIC saved result", "status": "completed"}, approved["id"], approved["id"], "synthetic-analysis")
    store.create_document("owner_bootstrap", {"owner_id": owner["id"], "password_hash": "SYNTHETIC marker"}, None, None, "host_owner_password")
    store.create_document("expert_session", {"verified_until": "2099-01-01T00:00:00Z"}, approved["id"], approved["id"], "synthetic-expert-session")
    retired = store.create_document("analysis", {"note": "SYNTHETIC soft-deleted result"}, approved["id"], approved["id"], "synthetic-deleted-analysis")
    retired = store.update_document("analysis", retired["id"], {"note": "SYNTHETIC revised result"}, approved["id"], 1)
    store.soft_delete_document("analysis", retired["id"], approved["id"], retired["revision"])
    with store.transaction() as connection:
        connection.execute("INSERT INTO sessions VALUES (?,?,?,?)", ("SYNTHETIC old session", approved["id"], "2026-01-01Z", "2099-01-01Z"))
    return store, owner, approved, pending, rejected


def database_rows(store):
    with store.connection() as connection:
        return {table: [dict(row) for row in connection.execute(f"SELECT * FROM {table} ORDER BY id")]
                for table in ("users", "documents", "audit_logs")}


def test_check_source_is_read_only_and_never_needs_postgres_or_secrets(source, monkeypatch, capsys):
    store, *_ = source
    monkeypatch.delenv("HELPMINTHS_DATABASE_URL", raising=False)
    before = hashlib.sha256(store.db_path.read_bytes()).hexdigest()
    assert main(["--source", str(store.db_path), "--check"]) == 0
    assert hashlib.sha256(store.db_path.read_bytes()).hexdigest() == before
    text = capsys.readouterr().out
    summary = json.loads(text.splitlines()[0])
    assert summary["check"] == "passed" and summary["counts"]["users"] == 4
    assert PASSWORD not in text and "SYNTHETIC Approved" not in text


def test_copy_preserves_credentials_approval_profiles_owner_documents_and_audit(source, tmp_path):
    store, owner, approved, pending, rejected = source
    before = database_rows(store)
    target = MigrationTarget(tmp_path / "empty-target")
    with source_database(store.db_path) as connection:
        result = migrate(connection, target)
    assert database_rows(target) == before
    assert result["users"] == 4 and result["row_content_verified"] is True
    assert result["sessions_invalidated"] == 1 and result["media_migrated"] is False
    for user in (owner, approved, pending, rejected):
        returned = target.authenticate(user["username"], PASSWORD)
        assert returned["id"] == user["id"]
        assert returned["approval_status"] == user["approval_status"]
        assert returned["is_super_admin"] == user["is_super_admin"]
    with target.connection() as connection:
        assert connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0
    target.append_audit("users", approved["id"], owner["id"], "after_import")
    with target.connection() as connection:
        assert connection.execute("SELECT MAX(id) FROM audit_logs").fetchone()[0] > before["audit_logs"][-1]["id"]


@pytest.mark.parametrize("occupied", ["users", "sessions", "documents", "audit_logs"])
def test_nonempty_destination_is_never_overwritten(source, tmp_path, occupied):
    source_store, *_ = source
    target = MigrationTarget(tmp_path / "occupied-target")
    owner = target.create_user("SYNTHETIC Existing", PASSWORD, "admin", is_super_admin=True) if occupied in {"users", "sessions"} else None
    # Document/audit-only targets are possible and must be refused even when no
    # accounts exist. Sessions necessarily refer to an existing account.
    with target.transaction() as connection:
        if occupied == "sessions":
            connection.execute("INSERT INTO sessions VALUES (?,?,?,?)", ("existing session", owner["id"], "2026-01-01Z", "2099-01-01Z"))
        elif occupied == "documents":
            target.create_document("analysis", {"existing": True}, None, None, conn=connection)
        elif occupied == "audit_logs":
            target.append_audit("users", "synthetic-old-record", None, "already_here", conn=connection)
    before = database_rows(target)
    with source_database(source_store.db_path) as connection:
        with pytest.raises(MigrationError, match="not empty"):
            migrate(connection, target)
    assert database_rows(target) == before


def test_failure_mid_import_rolls_back_every_new_row(source, tmp_path):
    store, *_ = source
    target = MigrationTarget(tmp_path / "atomic-target")
    with target.connection() as connection:
        connection.execute("CREATE TRIGGER synthetic_failure BEFORE INSERT ON documents BEGIN SELECT RAISE(ABORT,'synthetic failure'); END")
    with source_database(store.db_path) as connection:
        with pytest.raises(sqlite3.IntegrityError, match="synthetic failure"):
            migrate(connection, target)
    with target.connection() as connection:
        for table in ("users", "sessions", "documents", "audit_logs"):
            assert connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0


def test_source_schema_mismatch_is_rejected_without_target_contact(tmp_path, capsys, monkeypatch):
    file = tmp_path / "incompatible.sqlite3"
    with sqlite3.connect(file) as connection:
        connection.execute("CREATE TABLE schema_version(version INTEGER)")
        connection.execute("INSERT INTO schema_version VALUES (2)")
    monkeypatch.setenv("HELPMINTHS_DATABASE_URL", "postgresql://secret-user:DO-NOT-PRINT@invalid.invalid/db")
    assert main(["--source", str(file), "--confirm-source-stopped"]) == 1
    text = capsys.readouterr()
    assert "schema must be version 3" in text.err
    assert "DO-NOT-PRINT" not in text.err + text.out


def test_unacknowledged_source_and_missing_destination_are_rejected(source, monkeypatch):
    store, *_ = source
    with pytest.raises(SystemExit) as error:
        main(["--source", str(store.db_path)])
    assert error.value.code == 2
    monkeypatch.delenv("HELPMINTHS_DATABASE_URL", raising=False)
    with pytest.raises(SystemExit) as error:
        main(["--source", str(store.db_path), "--confirm-source-stopped"])
    assert error.value.code == 2


def test_source_check_rejects_dangling_references(tmp_path):
    store = PlatformStore(tmp_path / "invalid-source")
    store.create_user("SYNTHETIC Owner", PASSWORD, "admin", is_super_admin=True)
    with sqlite3.connect(store.db_path) as connection:
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute("INSERT INTO sessions VALUES ('bad','no-such-user','2026-01-01Z','2099-01-01Z')")
    with source_database(store.db_path) as connection:
        with pytest.raises(MigrationError, match="invalid account/document references"):
            inspect_source(connection)


@pytest.fixture
def postgres_target(tmp_path):
    """Only explicitly supplied disposable local/test databases are contacted."""
    base = os.getenv("HELPMINTHS_TEST_POSTGRES_URL")
    if not base:
        pytest.skip("Set HELPMINTHS_TEST_POSTGRES_URL for real PostgreSQL integration")
    parsed = urlsplit(base)
    if parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        pytest.skip("Migration integration creates disposable databases and only accepts a loopback PostgreSQL test server")
    psycopg = pytest.importorskip("psycopg")
    from psycopg import sql
    from backend.platform.postgres_store import PostgresPlatformStore
    name = "helpminths_migrate_" + uuid.uuid4().hex
    url = urlunsplit(parsed._replace(path="/" + name))
    with psycopg.connect(base, autocommit=True) as administrator:
        administrator.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    try:
        yield PostgresPlatformStore(tmp_path / "pg-image-cache", database_url=url)
    finally:
        with psycopg.connect(base, autocommit=True) as administrator:
            administrator.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))


def test_real_postgres_preserves_rows_and_advances_audit_identity(source, postgres_target):
    store, owner, approved, pending, rejected = source
    before = database_rows(store)
    with source_database(store.db_path) as connection:
        result = migrate(connection, postgres_target)
    assert result["row_content_verified"] is True
    assert database_rows(postgres_target) == before
    for user in (owner, approved, pending, rejected):
        account = postgres_target.authenticate(user["username"], PASSWORD)
        assert account["id"] == user["id"]
        assert account["approval_status"] == user["approval_status"]
    assert postgres_target.get_document("analysis", "synthetic-deleted-analysis") is None
    retained = postgres_target.get_document("analysis", "synthetic-deleted-analysis", include_deleted=True)
    assert retained["revision"] == 3 and retained["deleted_at"]
    with postgres_target.connection() as connection:
        assert connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0
    postgres_target.append_audit("users", approved["id"], owner["id"], "synthetic_after_import")
    with postgres_target.connection() as connection:
        assert connection.execute("SELECT MAX(id) FROM audit_logs").fetchone()[0] > before["audit_logs"][-1]["id"]


def test_real_postgres_nonempty_target_and_reimport_are_refused(source, postgres_target):
    store, *_ = source
    with source_database(store.db_path) as connection:
        migrate(connection, postgres_target)
    before = database_rows(postgres_target)
    with source_database(store.db_path) as connection:
        with pytest.raises(MigrationError, match="not empty"):
            migrate(connection, postgres_target)
    assert database_rows(postgres_target) == before

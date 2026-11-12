"""Explicit, atomic migration of a stopped SQLite store to empty PostgreSQL.

This command is never called by application startup. The destination URL is read
only from HELPMINTHS_DATABASE_URL; no credential is accepted as a command argument
or printed. Images are not part of this database migration.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from .store import SCHEMA_VERSION


TABLE_COLUMNS: dict[str, tuple[str, ...]] = {
    "users": (
        "id", "username", "password_hash", "role", "active", "created_at",
        "approval_status", "requested_role", "approved_by", "approved_at",
        "is_super_admin", "full_name", "workplace", "affiliation", "phone",
    ),
    "documents": (
        "id", "kind", "owner_id", "data", "created_at", "updated_at", "revision", "deleted_at",
    ),
    "audit_logs": (
        "id", "kind", "document_id", "actor_id", "action", "created_at", "before_data", "after_data",
    ),
}
DESTINATION_TABLES = ("users", "sessions", "documents", "audit_logs")


class MigrationError(RuntimeError):
    """A deliberately safe, non-personal error suitable for terminal output."""


@contextmanager
def source_database(filename: str | Path) -> Iterator[sqlite3.Connection]:
    path = Path(filename).expanduser()
    if path.is_symlink() or not path.is_file():
        raise MigrationError("Source must be an existing regular SQLite database file.")
    # mode=ro keeps the source unchanged and reads existing committed WAL entries.
    # immutable=1 must not be used: it can ignore a live database's WAL.
    uri = path.resolve().as_uri() + "?mode=ro"
    connection: sqlite3.Connection | None = None
    try:
        connection = sqlite3.connect(uri, uri=True, timeout=15, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only=ON")
        connection.execute("BEGIN")
        yield connection
    finally:
        if connection is not None:
            connection.rollback()
            connection.close()


def _rows(connection: Any, table: str, *, source_order: bool = False) -> list[dict[str, Any]]:
    columns = TABLE_COLUMNS[table]
    # Table and column identifiers come only from this module's fixed whitelist.
    order = "rowid" if source_order and table != "audit_logs" else "id"
    result = connection.execute(f"SELECT {','.join(columns)} FROM {table} ORDER BY {order}").fetchall()
    return [{column: row[column] for column in columns} for row in result]


def _digest(rows: list[dict[str, Any]]) -> str:
    """Hash every preserved field, including private fields, without printing it."""
    digest = hashlib.sha256()
    for row in sorted(rows, key=lambda item: item["id"]):
        digest.update(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                                 allow_nan=False).encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def inspect_source(connection: sqlite3.Connection) -> dict[str, Any]:
    integrity = connection.execute("PRAGMA integrity_check").fetchall()
    if len(integrity) != 1 or integrity[0][0] != "ok":
        raise MigrationError("Source database failed its integrity check; restore a verified backup first.")
    versions = connection.execute("SELECT version FROM schema_version").fetchall()
    if len(versions) != 1 or versions[0][0] != SCHEMA_VERSION:
        raise MigrationError("Source schema must be version 3. Upgrade an offline copy with a compatible application first.")
    for table, columns in TABLE_COLUMNS.items():
        available = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
        if not set(columns).issubset(available):
            raise MigrationError("Source schema is incomplete or incompatible.")
    if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
        raise MigrationError("Source has invalid account/document references; repair a private copy first.")
    counts = {table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
              for table in DESTINATION_TABLES}
    if not counts["users"]:
        raise MigrationError("Source has no accounts. Use normal first-owner setup for a new installation.")
    return {"schema_version": SCHEMA_VERSION, "counts": counts}


def migrate(source: sqlite3.Connection, target: Any) -> dict[str, Any]:
    """Copy rows to an empty target under its serialized writer transaction.

    All row checks occur before commit. On any failure the transaction rolls back;
    no old target account or document is removed or replaced. Sessions are omitted
    so migration never transfers usable login cookies or expert step-up sessions.
    """
    information = inspect_source(source)
    source_rows = {table: _rows(source, table, source_order=True) for table in TABLE_COLUMNS}
    expected = {table: _digest(rows) for table, rows in source_rows.items()}
    with target.transaction() as destination:
        # Recheck after the writer lock; concurrent first-owner bootstrap cannot
        # make an earlier empty-target check unsafe.
        if any(destination.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
               for table in DESTINATION_TABLES):
            raise MigrationError("Destination is not empty. Migration refused; no existing data was overwritten.")
        version = destination.execute("SELECT version FROM schema_version").fetchall()
        if len(version) != 1 or version[0][0] != SCHEMA_VERSION:
            raise MigrationError("Destination schema is incompatible.")

        columns = TABLE_COLUMNS["users"]
        statement = f"INSERT INTO users({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})"
        for row in source_rows["users"]:
            # approved_by may refer to a later user, or to the owner itself.
            # Insert every identity first, then restore these references.
            destination.execute(statement, tuple(None if key == "approved_by" else row[key] for key in columns))
        for row in source_rows["users"]:
            if row["approved_by"] is not None:
                destination.execute("UPDATE users SET approved_by=? WHERE id=?", (row["approved_by"], row["id"]))

        for table in ("documents", "audit_logs"):
            columns = TABLE_COLUMNS[table]
            statement = f"INSERT INTO {table}({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})"
            for row in source_rows[table]:
                destination.execute(statement, tuple(row[key] for key in columns))

        for table in TABLE_COLUMNS:
            actual = _rows(destination, table)
            if len(actual) != information["counts"][table] or _digest(actual) != expected[table]:
                raise MigrationError("Destination verification failed. All imported rows were rolled back.")
        if destination.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] != 0:
            raise MigrationError("Destination unexpectedly contains login sessions. Import was rolled back.")
        # Explicit audit IDs retain the append-only history's original order.
        # Set the backing sequence after import so future events get fresh IDs.
        target.reset_import_sequences(destination)
    return {
        "schema_version": SCHEMA_VERSION,
        "users": information["counts"]["users"],
        "documents": information["counts"]["documents"],
        "audit_logs": information["counts"]["audit_logs"],
        "sessions_invalidated": information["counts"]["sessions"],
        "row_content_verified": True,
        "media_migrated": False,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Migrate a stopped private SQLite store to an empty external PostgreSQL database.")
    parser.add_argument("--source", required=True, type=Path, help="Existing private helpminths.sqlite3 file; it is opened read-only")
    parser.add_argument("--check", action="store_true", help="Validate and count source rows only; never contacts PostgreSQL")
    parser.add_argument("--confirm-source-stopped", action="store_true", help="Acknowledge that source application writes have been stopped")
    args = parser.parse_args(argv)
    if not args.check and not args.confirm_source_stopped:
        parser.error("Stop source writes and pass --confirm-source-stopped before importing.")
    url = os.getenv("HELPMINTHS_DATABASE_URL", "").strip()
    if not args.check and not url:
        parser.error("Set HELPMINTHS_DATABASE_URL as a private environment secret; never pass it on the command line.")
    try:
        with source_database(args.source) as source:
            if args.check:
                information = inspect_source(source)
                print(json.dumps({"check": "passed", **information}, ensure_ascii=False, sort_keys=True))
                print("Source check is read-only. It does not prove that the source service has stopped.")
                return 0
            # Import only after source validation. No target operation happens in
            # --check mode, including package import or schema initialization.
            inspect_source(source)
            from .postgres_store import PostgresPlatformStore
            with tempfile.TemporaryDirectory(prefix="helpminths-migration-cache-") as cache:
                target = PostgresPlatformStore(Path(cache), database_url=url)
                result = migrate(source, target)
        print(json.dumps({"migration": "committed", **result}, ensure_ascii=False, sort_keys=True))
        print("Sign in again with the existing username/password. Expert password verification must be renewed.")
        print("Image bytes were not copied. Migrate private images separately before relying on historical image links.")
        return 0
    except MigrationError as error:
        print(str(error), file=sys.stderr)
    except Exception:
        # psycopg/SQLite errors can contain hostnames, connection arguments or row
        # values. Never echo them from this operator command.
        print("Migration failed without a committed import. Check the private source, destination access, and schema.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

"""Private PostgreSQL persistence with the existing HelpMinths store contract.

Only the server connects to PostgreSQL. The private ``helpminths`` schema is not
an anonymous Supabase API. Local directories hold image files/cache separately;
a remote database alone does not make those files durable.
"""
from __future__ import annotations

import os
import re
import sqlite3
import tempfile
from contextlib import contextmanager
from dataclasses import replace
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import parse_qs, urlsplit

import psycopg
from fastapi import HTTPException

from .config import PlatformConfig
from .database_diagnostics import connection_failure_message
from .store import PlatformStore, SCHEMA_VERSION

# Shared by every application writer and initializer, including concurrent
# Render processes. This retains SQLite's serialized-write permission checks.
_WRITE_LOCK = 1213022804
_SCHEMA_FILE = Path(__file__).with_name("postgres_schema.sql")


def _code_segments(sql: str) -> Iterator[tuple[bool, str]]:
    """Separate SQL code from quoted literals/comments, retaining exact bytes."""
    start = 0
    index = 0
    length = len(sql)
    while index < length:
        char = sql[index]
        if char in "'\"" or sql.startswith("--", index) or sql.startswith("/*", index):
            if start < index:
                yield True, sql[start:index]
            token_start = index
            if char in "'\"":
                index += 1
                while index < length:
                    if sql[index] == char:
                        index += 1
                        if index < length and sql[index] == char:
                            index += 1
                            continue
                        break
                    index += 1
            elif sql.startswith("--", index):
                end = sql.find("\n", index + 2)
                index = length if end < 0 else end + 1
            else:
                end = sql.find("*/", index + 2)
                index = length if end < 0 else end + 2
            yield False, sql[token_start:index]
            start = index
            continue
        index += 1
    if start < length:
        yield True, sql[start:]


def _matching_close(sql: str, opening: int) -> int:
    depth = 0
    offset = opening
    for code, fragment in _code_segments(sql[opening:]):
        if code:
            for index, char in enumerate(fragment):
                if char == "(":
                    depth += 1
                elif char == ")":
                    depth -= 1
                    if depth == 0:
                        return offset + index
        offset += len(fragment)
    raise sqlite3.OperationalError("Unbalanced internal SQL expression")


def _numeric_aggregates(sql: str) -> str:
    # SQLite gives JSON scalars dynamic numeric types; the compatibility helper
    # must return text for joins/labels. Cast only numeric aggregate arguments.
    spans: list[tuple[int, int]] = []
    offset = 0
    for code, fragment in _code_segments(sql):
        if code:
            for found in re.finditer(r"\b(?:AVG|SUM)\s*\(", fragment, re.I):
                opening = offset + found.end() - 1
                closing = _matching_close(sql, opening)
                argument = sql[opening + 1:closing]
                if re.search(r"\bjson_extract\s*\(", argument, re.I):
                    spans.append((opening + 1, closing))
        offset += len(fragment)
    # Current queries do not nest aggregates. Decreasing positions preserve
    # outer SQL positions and preserve literal content exactly.
    for start, end in reversed(spans):
        sql = sql[:start] + "CAST((" + sql[start:end] + ") AS NUMERIC)" + sql[end:]
    return sql


def translate_sql(sql: str, *, bind: bool = True) -> str:
    """Translate the small SQLite dialect used by the application, not values."""
    rewritten: list[str] = []
    for code, fragment in _code_segments(sql):
        if code:
            fragment = re.sub(r"\b((?:[A-Za-z_][A-Za-z_0-9]*\.)?username)\s*=\s*\?\s+COLLATE\s+NOCASE\b",
                              r"LOWER(\1)=LOWER(?)", fragment, flags=re.I)
            fragment = re.sub(r"\browid\b", "_sequence", fragment, flags=re.I)
            # SQLite LIKE is ASCII-insensitive, as are the existing username
            # constraints. ILIKE preserves that behaviour for legacy searches.
            fragment = re.sub(r"\bLIKE\b", "ILIKE", fragment, flags=re.I)
        rewritten.append(fragment)
    value = _numeric_aggregates("".join(rewritten))
    result: list[str] = []
    for code, fragment in _code_segments(value):
        if bind:
            fragment = fragment.replace("%", "%%")
        if code:
            fragment = fragment.replace("?", "%s")
        result.append(fragment)
    return "".join(result)


class PostgresRow:
    """sqlite3.Row-compatible indexing and mapping without internal identities."""
    __slots__ = ("_keys", "_values", "_indices")

    def __init__(self, keys: list[str], values: tuple[Any, ...]):
        kept = [(key, int(value) if isinstance(value, Decimal) and value == value.to_integral_value()
                 else float(value) if isinstance(value, Decimal) else value)
                for key, value in zip(keys, values) if key != "_sequence"]
        self._keys = tuple(key for key, _ in kept)
        self._values = tuple(value for _, value in kept)
        self._indices: dict[str, int] = {}
        for index, key in enumerate(self._keys):
            self._indices.setdefault(key, index)

    def __getitem__(self, key: int | slice | str):
        if isinstance(key, (int, slice)):
            return self._values[key]
        if key in self._indices:
            return self._values[self._indices[key]]
        raise IndexError("No item with that key")

    def keys(self) -> list[str]:
        return list(self._keys)

    def __iter__(self):
        return iter(self._values)

    def __len__(self):
        return len(self._values)


class PostgresCursor:
    def __init__(self, cursor):
        self._cursor = cursor
        self._keys = [column.name for column in cursor.description] if cursor.description else []

    @property
    def rowcount(self) -> int:
        return self._cursor.rowcount

    @property
    def lastrowid(self):
        return None  # Application IDs are explicit; never infer another row.

    def fetchone(self) -> PostgresRow | None:
        try:
            row = self._cursor.fetchone()
            return PostgresRow(self._keys, row) if row is not None else None
        except psycopg.Error as error:
            _safe_database_error(error)

    def fetchall(self) -> list[PostgresRow]:
        try:
            return [PostgresRow(self._keys, row) for row in self._cursor.fetchall()]
        except psycopg.Error as error:
            _safe_database_error(error)

    def __iter__(self):
        while (row := self.fetchone()) is not None:
            yield row


class _EmptyCursor:
    rowcount = -1
    lastrowid = None

    @staticmethod
    def fetchone():
        return None

    @staticmethod
    def fetchall():
        return []

    def __iter__(self):
        return iter(())


def _safe_database_error(error: psycopg.Error) -> None:
    if isinstance(error, psycopg.IntegrityError):
        # PostgreSQL DETAIL can include credential hashes/private row values.
        raise sqlite3.IntegrityError("Database constraint violation") from None
    code = error.sqlstate if error.sqlstate and re.fullmatch(r"[A-Z0-9]{5}", error.sqlstate) else "unknown"
    raise sqlite3.OperationalError(f"External database operation failed (SQLSTATE {code})") from None


class PostgresConnection:
    """A short server-side transaction; compatible with Supabase poolers.

    Settings are SET LOCAL after BEGIN, never session settings or prepared
    statements that would leak across transaction-pooler clients.
    """
    def __init__(self, raw):
        self.raw = raw
        self._active = False
        self._write_locked = False

    def _begin(self, *, write: bool = False, snapshot: bool = False) -> None:
        if not self._active:
            self.raw.execute("BEGIN ISOLATION LEVEL REPEATABLE READ" if snapshot else "BEGIN")
            self._active = True
            self.raw.execute("SET LOCAL search_path TO helpminths, pg_catalog")
            self.raw.execute("SET LOCAL timezone TO 'UTC'")
            self.raw.execute("SET LOCAL statement_timeout TO '30s'")
            self.raw.execute("SET LOCAL lock_timeout TO '15s'")
            self.raw.execute("SET LOCAL idle_in_transaction_session_timeout TO '30s'")
        if write and not self._write_locked:
            self.raw.execute("SELECT pg_advisory_xact_lock(%s)", (_WRITE_LOCK,))
            self._write_locked = True

    def execute(self, sql: str, parameters=()):
        command = sql.strip().rstrip(";").strip().upper()
        try:
            if command in {"BEGIN", "BEGIN TRANSACTION"}:
                self._begin(snapshot=True)
                return _EmptyCursor()
            if command == "BEGIN IMMEDIATE":
                self._begin(write=True)
                return _EmptyCursor()
            if command.startswith("PRAGMA "):
                raise sqlite3.OperationalError("SQLite PRAGMA is not available for an external database")
            if command in {"COMMIT", "END"}:
                self.commit()
                return _EmptyCursor()
            if command == "ROLLBACK":
                self.rollback()
                return _EmptyCursor()
            write = bool(re.match(r"\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b", sql, re.I))
            self._begin(write=write)
            values = tuple(parameters) if parameters is not None else ()
            translated = translate_sql(sql, bind=bool(values))
            cursor = self.raw.execute(translated, values or None, prepare=False)
            return PostgresCursor(cursor)
        except psycopg.Error as error:
            _safe_database_error(error)

    def executemany(self, sql: str, parameters):
        last = _EmptyCursor()
        for row in parameters:
            last = self.execute(sql, row)
        return last

    def executescript(self, sql: str) -> None:
        try:
            self._begin(write=True)
            # Schema functions contain dollar-quoted bodies and DO blocks.
            self.raw.execute(sql, prepare=False)
        except psycopg.Error as error:
            _safe_database_error(error)

    def commit(self) -> None:
        try:
            self.raw.commit()
        except psycopg.Error as error:
            _safe_database_error(error)
        finally:
            self._active = self._write_locked = False

    def rollback(self) -> None:
        try:
            self.raw.rollback()
        except psycopg.Error as error:
            _safe_database_error(error)
        finally:
            self._active = self._write_locked = False

    def close(self) -> None:
        self.raw.close()


def _connection_settings(database_url: str) -> dict[str, Any]:
    """Require encrypted remote connections without ever exposing the URL."""
    try:
        parsed = urlsplit(database_url)
        if parsed.scheme not in {"postgres", "postgresql"} or not parsed.hostname or not parsed.path.strip("/"):
            raise ValueError
        query = parse_qs(parsed.query, keep_blank_values=True)
        # libpq accepts routing fields in a URI query which override its authority.
        # A localhost-looking authority must not authorize plaintext to a remote
        # query/service destination. Supabase pooler URIs need no such overrides.
        if any(key.lower() in {"host", "hostaddr", "service", "dbname", "user", "password", "passfile"} for key in query):
            raise ValueError
        effective = psycopg.conninfo.conninfo_to_dict(database_url)
        local = effective.get("host", "").lower() in {"localhost", "127.0.0.1", "::1"}
        requested = effective.get("sslmode")
        if not local and requested not in {None, "require", "verify-ca", "verify-full"}:
            raise ValueError
        settings: dict[str, Any] = {
            "sslmode": requested or ("disable" if local else "require"),
            "connect_timeout": 10, "autocommit": True, "prepare_threshold": None,
        }
        if local:
            # Also defeat ambient PGHOSTADDR/service defaults: plaintext local
            # development connects only to a physical loopback address.
            settings["hostaddr"] = "::1" if effective["host"] == "::1" else "127.0.0.1"
        return settings
    except (ValueError, TypeError, psycopg.Error):
        raise RuntimeError("ตั้งค่า HELPMINTHS_DATABASE_URL ให้เป็น PostgreSQL URL ที่ถูกต้องและใช้ TLS สำหรับฐานข้อมูลภายนอก") from None


def _connection_details(database_url: str, database_password: str | None = None) -> tuple[str, dict[str, Any]]:
    """Optionally supply a raw host secret without URI password escaping.

    When the optional secret is present, only the username and destination are
    taken from the URI. Its old/placeholder password is discarded before URI
    parsing; the real password is passed as a libpq keyword argument. Existing
    single-URI deployments keep exactly their previous behaviour.
    """
    if database_password is None:
        return database_url, _connection_settings(database_url)
    if not database_password or "\x00" in database_password:
        raise RuntimeError("[DB_PASSWORD_INPUT] ใส่รหัสผ่านฐานข้อมูลจริงใน HELPMINTHS_DATABASE_PASSWORD หรือเอาตัวแปรนี้ออกเมื่อใช้รหัสผ่านใน URI")
    scheme, delimiter, remainder = database_url.partition("://")
    # Select the user-info delimiter before a host/port/database destination,
    # rather than the last '@' anywhere (which could belong to a query value).
    parts = re.fullmatch(
        r"(?P<credentials>.+?)@(?P<destination>(?:\[[^\]\r\n]+\]|[^/@?#:\s]+)(?::[0-9]+)?/.*)",
        remainder, flags=re.DOTALL,
    )
    username = parts["credentials"].partition(":")[0] if parts else ""
    if not delimiter or scheme.lower() not in {"postgres", "postgresql"} or not username:
        raise RuntimeError("[DB_URL_FORMAT] คัดลอก PostgreSQL URI ที่มีชื่อผู้ใช้ทั้งหมดจาก Supabase Connect > Session pooler")
    connection_url = f"{scheme.lower()}://{username}@{parts['destination']}"
    settings = _connection_settings(connection_url)
    settings["password"] = database_password  # Preserve special characters verbatim.
    return connection_url, settings


class PostgresPlatformStore(PlatformStore):
    database_backend = "postgres"
    database_durable = True

    def __init__(self, data_dir: str | Path | None = None, *, database_url: str) -> None:
        self._database_url, self._connection_kwargs = _connection_details(
            database_url, os.getenv("HELPMINTHS_DATABASE_PASSWORD"),
        )
        self.config = PlatformConfig.from_environment(data_dir)
        if self.config.data_dir is None:
            # External accounts may be enabled without a mounted media volume.
            # This cache is intentionally never described as durable image data.
            selected = Path(tempfile.mkdtemp(prefix="helpminths-media-"))
            self.config = replace(self.config, data_dir=selected, automatic_storage=True, storage_durable=False)
        else:
            selected = self.config.data_dir
        self.db_path = None
        self.data_dir = self.image_dir = None
        self.configured = False
        if selected.is_symlink():
            raise RuntimeError("Private storage cannot be a symbolic link")
        directory = selected.resolve()
        repository = Path(__file__).resolve().parents[2]
        for public in (repository / "public", repository / "dist"):
            if directory == public or public in directory.parents:
                raise RuntimeError("Private storage must be outside public and dist")
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(directory, 0o700)
        images = directory / "images"
        if images.is_symlink():
            raise RuntimeError("Private image storage cannot be a symbolic link")
        images.mkdir(exist_ok=True, mode=0o700)
        os.chmod(images, 0o700)
        self.data_dir, self.image_dir = directory, images
        self.configured = True
        try:
            self._initialize()
        except BaseException:
            self.configured = False
            raise

    def __repr__(self):
        return "<PostgresPlatformStore external private database>"

    def ensure_configured(self) -> None:
        if not self.configured:
            raise HTTPException(503, "ยังเชื่อมต่อฐานข้อมูลภายนอกไม่ได้")

    def _open_connection(self) -> PostgresConnection:
        try:
            raw = psycopg.connect(self._database_url, **self._connection_kwargs)
            return PostgresConnection(raw)
        except psycopg.Error as error:
            # Diagnose using finite static hints; never expose provider text.
            raise sqlite3.OperationalError(connection_failure_message(error)) from None

    @contextmanager
    def connection(self) -> Iterator[PostgresConnection]:
        self.ensure_configured()
        conn = self._open_connection()
        try:
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()

    @contextmanager
    def transaction(self) -> Iterator[PostgresConnection]:
        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            yield conn

    def _restrict_database_files(self) -> None:
        return  # The database lives on PostgreSQL, not in the media directory.

    def _initialize(self) -> None:
        with self.transaction() as conn:
            # Serialize before schema inspection/creation, including startup.
            exists = conn.execute("SELECT to_regclass('helpminths.schema_version')").fetchone()[0]
            if exists is not None:
                versions = conn.execute("SELECT version FROM schema_version").fetchall()
                if len(versions) != 1 or versions[0]["version"] != SCHEMA_VERSION:
                    raise RuntimeError("Unsupported external platform schema version; restore or migrate explicitly first")
            conn.executescript(_SCHEMA_FILE.read_text(encoding="utf-8"))
            versions = conn.execute("SELECT version FROM schema_version").fetchall()
            if not versions:
                conn.execute("INSERT INTO schema_version(version) VALUES (?)", (SCHEMA_VERSION,))
            elif len(versions) != 1 or versions[0]["version"] != SCHEMA_VERSION:
                raise RuntimeError("Unsupported external platform schema version; restore or migrate explicitly first")

    def reset_import_sequences(self, conn: PostgresConnection) -> None:
        """Used only by the explicit offline import after preserving source IDs."""
        for table, column in (("users", "_sequence"), ("documents", "_sequence"), ("audit_logs", "id")):
            # Identifiers are fixed here, never supplied by a web request.
            conn.execute(f"SELECT setval(pg_get_serial_sequence('helpminths.{table}','{column}'), "
                         f"COALESCE((SELECT MAX({column}) FROM {table}),1), "
                         f"EXISTS(SELECT 1 FROM {table}))")

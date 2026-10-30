"""SQLite documents, accounts and append-only audit storage; no production seeds.

The database is deliberately opt-in. A data directory must be configured outside
public/dist. A mounted persistent volume is needed for durable hosted storage.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from fastapi import HTTPException

from .config import PlatformConfig

SCHEMA_VERSION = 1
ROLES = ("admin", "reviewer", "lab", "student")
KINDS = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
USERNAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def flatten_document(document: dict[str, Any]) -> dict[str, Any]:
    return {**document["data"], **{key: value for key, value in document.items() if key != "data"}}


def hash_password(password: str) -> str:
    if not isinstance(password, str) or len(password) < 12 or len(password.encode("utf-8")) > 1024:
        raise HTTPException(422, "รหัสผ่านต้องมีอย่างน้อย 12 ตัวอักษร และไม่เกิน 1,024 ไบต์")
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=32)
    return "scrypt$16384$8$1$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def verify_password(password: str, encoded: str | None) -> bool:
    if not isinstance(password, str) or len(password.encode("utf-8")) > 1024:
        return False
    try:
        algorithm, n, r, p, salt, expected = (encoded or "").split("$")
        if algorithm != "scrypt" or (n, r, p) != ("16384", "8", "1"):
            raise ValueError("Unsupported password parameters")
        digest = hashlib.scrypt(password.encode("utf-8"), salt=base64.b64decode(salt, validate=True), n=16384, r=8, p=1, dklen=32)
        return hmac.compare_digest(digest, base64.b64decode(expected, validate=True))
    except (ValueError, TypeError):
        # Equal-cost work for unknown users; this is not a credential for any account.
        hashlib.scrypt(password.encode("utf-8"), salt=b"HelpMinths-no-user", n=16384, r=8, p=1, dklen=32)
        return False


def public_user(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    return {"id": row["id"], "username": row["username"], "role": row["role"], "active": bool(row["active"]), "created_at": row["created_at"]}


_SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS users(
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','reviewer','lab','student')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS documents(
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, owner_id TEXT REFERENCES users(id),
 data TEXT NOT NULL CHECK(json_valid(data)), created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS documents_kind_created ON documents(kind,created_at DESC);
CREATE INDEX IF NOT EXISTS documents_owner_kind ON documents(owner_id,kind,deleted_at);
CREATE TABLE IF NOT EXISTS audit_logs(
 id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, document_id TEXT NOT NULL,
 actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, created_at TEXT NOT NULL,
 before_data TEXT CHECK(before_data IS NULL OR json_valid(before_data)),
 after_data TEXT CHECK(after_data IS NULL OR json_valid(after_data))
);
CREATE INDEX IF NOT EXISTS audit_document ON audit_logs(kind,document_id,id DESC);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_logs
 BEGIN SELECT RAISE(ABORT,'Audit records are append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_logs
 BEGIN SELECT RAISE(ABORT,'Audit records are append-only'); END;
"""


class PlatformStore:
    def __init__(self, data_dir: str | Path | None = None) -> None:
        self.config = PlatformConfig.from_environment(data_dir)
        self.data_dir: Path | None = None
        self.image_dir: Path | None = None
        self.db_path: Path | None = None
        self.configured = self.config.data_dir is not None
        if not self.configured:
            return
        selected = self.config.data_dir
        assert selected is not None
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
        database = directory / "helpminths.sqlite3"
        if database.is_symlink():
            raise RuntimeError("Private database cannot be a symbolic link")
        self.data_dir, self.image_dir, self.db_path = directory, images, database
        with self.connection() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(_SCHEMA)
            versions = conn.execute("SELECT version FROM schema_version").fetchall()
            if not versions:
                conn.execute("INSERT INTO schema_version(version) VALUES (?) ON CONFLICT(version) DO NOTHING", (SCHEMA_VERSION,))
            elif len(versions) != 1 or versions[0]["version"] != SCHEMA_VERSION:
                raise RuntimeError("Unsupported platform schema version; restore a compatible backup or migrate first")
            conn.commit()
        self._restrict_database_files()

    def _restrict_database_files(self) -> None:
        if self.data_dir:
            for path in self.data_dir.glob("helpminths.sqlite3*"):
                if path.is_file():
                    os.chmod(path, 0o600)

    def ensure_configured(self) -> None:
        if not self.configured or self.db_path is None:
            raise HTTPException(503, "Not configured: ตั้งค่า HELPMINTHS_DATA_DIR บนพื้นที่ส่วนตัวก่อนใช้ฐานข้อมูลและบัญชีผู้ใช้")

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        self.ensure_configured()
        assert self.db_path is not None
        conn = sqlite3.connect(str(self.db_path), timeout=15, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=15000")
        try:
            yield conn
        finally:
            conn.close()
            self._restrict_database_files()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
                conn.commit()
            except BaseException:
                conn.rollback()
                raise

    @contextmanager
    def _use(self, conn: sqlite3.Connection | None, *, write: bool = False) -> Iterator[sqlite3.Connection]:
        if conn is not None:
            self.ensure_configured()
            yield conn
        else:
            with (self.transaction() if write else self.connection()) as opened:
                yield opened

    @staticmethod
    def _kind(kind: str) -> None:
        if not isinstance(kind, str) or not KINDS.fullmatch(kind):
            raise HTTPException(422, "Invalid document kind")

    @staticmethod
    def _document(row: sqlite3.Row) -> dict[str, Any]:
        result = dict(row)
        result["data"] = json.loads(result["data"])
        return result

    def create_document(self, kind: str, data: dict[str, Any], owner_id: str | None, actor_id: str | None, document_id: str | None = None, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
        self._kind(kind)
        if not isinstance(data, dict):
            raise HTTPException(422, "Document data must be an object")
        document_id = document_id or uuid.uuid4().hex
        now = utc_now()
        with self._use(conn, write=True) as db:
            try:
                db.execute("INSERT INTO documents(id,kind,owner_id,data,created_at,updated_at,revision) VALUES (?,?,?,?,?,?,1)", (document_id, kind, owner_id, json_text(data), now, now))
            except sqlite3.IntegrityError:
                raise HTTPException(409, "สร้างรายการไม่ได้ รหัสซ้ำหรือบัญชีผู้ใช้ไม่ถูกต้อง") from None
            result = self.get_document(kind, document_id, conn=db)
            assert result is not None
            self.append_audit(kind, document_id, actor_id, "created", after=flatten_document(result), conn=db)
            return result

    def get_document(self, kind: str, document_id: str, include_deleted: bool = False, conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
        self._kind(kind)
        with self._use(conn) as db:
            row = db.execute("SELECT * FROM documents WHERE kind=? AND id=?" + ("" if include_deleted else " AND deleted_at IS NULL"), (kind, document_id)).fetchone()
            return self._document(row) if row else None

    def list_documents(self, kind: str, owner_id: str | None = None, limit: int = 50, offset: int = 0, include_deleted: bool = False, conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
        self._kind(kind)
        where, values = ["kind=?"], [kind]
        if owner_id is not None:
            where.append("owner_id=?"); values.append(owner_id)
        if not include_deleted:
            where.append("deleted_at IS NULL")
        with self._use(conn) as db:
            rows = db.execute("SELECT * FROM documents WHERE " + " AND ".join(where) + " ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?", (*values, max(1, min(1000, limit)), max(0, offset))).fetchall()
            return [self._document(row) for row in rows]

    def count_documents(self, kind: str, owner_id: str | None = None, conn: sqlite3.Connection | None = None) -> int:
        self._kind(kind)
        query = "SELECT count(*) FROM documents WHERE kind=? AND deleted_at IS NULL"
        values: list[Any] = [kind]
        if owner_id is not None:
            query += " AND owner_id=?"; values.append(owner_id)
        with self._use(conn) as db:
            return int(db.execute(query, values).fetchone()[0])

    def update_document(self, kind: str, document_id: str, data: dict[str, Any], actor_id: str | None, expected_revision: int, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
        self._kind(kind)
        if not isinstance(data, dict) or not isinstance(expected_revision, int) or expected_revision < 1:
            raise HTTPException(422, "Invalid data or revision")
        with self._use(conn, write=True) as db:
            before = self.get_document(kind, document_id, conn=db)
            if before is None:
                raise HTTPException(404, "ไม่พบรายการ")
            if before["revision"] != expected_revision:
                raise HTTPException(409, "รายการถูกแก้ไขแล้ว โปรดโหลดข้อมูลล่าสุดก่อนบันทึก")
            changed = db.execute("UPDATE documents SET data=?,updated_at=?,revision=revision+1 WHERE kind=? AND id=? AND revision=? AND deleted_at IS NULL", (json_text(data), utc_now(), kind, document_id, expected_revision))
            if changed.rowcount != 1:
                raise HTTPException(409, "รายการถูกแก้ไขแล้ว โปรดโหลดข้อมูลล่าสุดก่อนบันทึก")
            after = self.get_document(kind, document_id, conn=db)
            assert after is not None
            self.append_audit(kind, document_id, actor_id, "updated", before=flatten_document(before), after=flatten_document(after), conn=db)
            return after

    def soft_delete_document(self, kind: str, document_id: str, actor_id: str | None, expected_revision: int, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
        with self._use(conn, write=True) as db:
            before = self.get_document(kind, document_id, conn=db)
            if before is None:
                raise HTTPException(404, "ไม่พบรายการ")
            if before["revision"] != expected_revision:
                raise HTTPException(409, "รายการถูกแก้ไขแล้ว โปรดโหลดข้อมูลล่าสุดก่อนลบ")
            now = utc_now()
            changed = db.execute("UPDATE documents SET deleted_at=?,updated_at=?,revision=revision+1 WHERE kind=? AND id=? AND revision=? AND deleted_at IS NULL", (now, now, kind, document_id, expected_revision))
            if changed.rowcount != 1:
                raise HTTPException(409, "รายการถูกแก้ไขแล้ว โปรดโหลดข้อมูลล่าสุดก่อนลบ")
            after = self.get_document(kind, document_id, include_deleted=True, conn=db)
            assert after is not None
            self.append_audit(kind, document_id, actor_id, "deleted", before=flatten_document(before), after=flatten_document(after), conn=db)
            return after

    def append_audit(self, kind: str, document_id: str, actor_id: str | None, action: str, before: Any = None, after: Any = None, conn: sqlite3.Connection | None = None) -> None:
        with self._use(conn, write=True) as db:
            db.execute("INSERT INTO audit_logs(kind,document_id,actor_id,action,created_at,before_data,after_data) VALUES (?,?,?,?,?,?,?)", (kind, document_id, actor_id, action, utc_now(), None if before is None else json_text(before), None if after is None else json_text(after)))

    def list_audit(self, kind: str, document_id: str, limit: int = 100, offset: int = 0, conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
        with self._use(conn) as db:
            rows = db.execute("SELECT a.*,u.username AS actor_username FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.kind=? AND a.document_id=? ORDER BY a.id DESC LIMIT ? OFFSET ?", (kind, document_id, max(1, min(500, limit)), max(0, offset))).fetchall()
            return [{**dict(row), "before_data": json.loads(row["before_data"]) if row["before_data"] else None, "after_data": json.loads(row["after_data"]) if row["after_data"] else None} for row in rows]

    def create_user(self, username: str, password: str, role: str = "lab", actor_id: str | None = None, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
        if not isinstance(username, str) or not USERNAME.fullmatch(username.strip()):
            raise HTTPException(422, "ชื่อผู้ใช้ใช้ A–Z, a–z, 0–9, จุด ขีดกลาง หรือขีดล่าง 3–64 ตัว")
        if role not in ROLES:
            raise HTTPException(422, "Invalid role")
        encoded = hash_password(password)
        user_id = uuid.uuid4().hex
        with self._use(conn, write=True) as db:
            try:
                db.execute("INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES (?,?,?,?,1,?)", (user_id, username.strip(), encoded, role, utc_now()))
            except sqlite3.IntegrityError:
                raise HTTPException(409, "ชื่อผู้ใช้นี้ถูกใช้แล้ว") from None
            row = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
            assert row is not None
            result = public_user(row)
            self.append_audit("users", user_id, actor_id, "user_created", after=result, conn=db)
            return result

    def has_users(self) -> bool:
        if not self.configured:
            return False
        with self.connection() as conn:
            return conn.execute("SELECT 1 FROM users WHERE active=1 AND role='admin' LIMIT 1").fetchone() is not None

    def authenticate(self, username: str, password: str) -> dict[str, Any] | None:
        with self.connection() as conn:
            row = conn.execute("SELECT * FROM users WHERE username=? COLLATE NOCASE", (username,)).fetchone()
            valid = verify_password(password, row["password_hash"] if row else None)
            return public_user(row) if row and valid and row["active"] else None

"""Apply an optional host-owned owner password once per configured value.

This startup-only path never accepts a web request. The private marker contains
a separately salted password hash so a later restart with the same host value
does not overwrite credentials the owner has changed through their account.
"""
from __future__ import annotations

import os
from typing import Any

from .store import PlatformStore, hash_password, json_text, owner_username, public_user, utc_now, verify_password

BOOTSTRAP_DOCUMENT_KIND = "owner_bootstrap"
BOOTSTRAP_DOCUMENT_ID = "host_owner_password"


def configured_owner_username() -> str:
    """Keep public status usable even if the host supplied an invalid name."""
    try:
        return owner_username()
    except RuntimeError:
        return "Super Admin"


def owner_login_username(store: PlatformStore | None) -> str:
    if isinstance(store, PlatformStore) and store.configured:
        with store.connection() as conn:
            row = conn.execute("SELECT username FROM users WHERE is_super_admin=1 LIMIT 1").fetchone()
            if row is not None:
                return row["username"]
    return configured_owner_username()


def bootstrap_owner(store: PlatformStore) -> dict[str, Any]:
    """Create or recover the existing owner atomically, without exposing secrets."""
    password = os.getenv("HELPMINTHS_SUPER_ADMIN_PASSWORD", "")
    configured = bool(password)
    if not configured:
        ready = store.has_users()
        return {"configured": False, "ready": ready,
                "message": "บัญชีเจ้าของระบบพร้อมเข้าสู่ระบบ" if ready else
                "ตั้งค่า HELPMINTHS_SUPER_ADMIN_PASSWORD บนโฮสต์เพื่อเปิดบัญชีเจ้าของระบบ"}
    if not store.configured:
        return {"configured": True, "ready": False,
                "message": "ยังตั้งค่าบัญชีเจ้าของระบบไม่ได้ กรุณาเปิดพื้นที่เก็บข้อมูลส่วนตัวบนโฮสต์"}
    try:
        username = owner_username()
        # Validate before any writes; preserve the supplied password verbatim.
        if len(password) < 4 or len(password.encode("utf-8")) > 1024:
            return {"configured": True, "ready": False,
                    "message": "รหัสผ่านเจ้าของระบบบนโฮสต์ต้องมีอย่างน้อย 4 ตัวอักษร และไม่เกิน 1,024 ไบต์"}
        with store.transaction() as conn:
            owner = conn.execute("SELECT * FROM users WHERE is_super_admin=1 LIMIT 1").fetchone()
            marker_kind = conn.execute("SELECT kind FROM documents WHERE id=?", (BOOTSTRAP_DOCUMENT_ID,)).fetchone()
            if marker_kind is not None and marker_kind["kind"] != BOOTSTRAP_DOCUMENT_KIND:
                raise RuntimeError("Private owner configuration is unavailable")
            marker = store.get_document(BOOTSTRAP_DOCUMENT_KIND, BOOTSTRAP_DOCUMENT_ID,
                                        include_deleted=True, conn=conn)
            if (owner is not None and marker is not None
                    and marker["data"].get("owner_id") == owner["id"]
                    and verify_password(password, marker["data"].get("password_hash"))):
                return {"configured": True, "ready": True, "message": "บัญชีเจ้าของระบบพร้อมเข้าสู่ระบบ"}
            # A reserved name held by another account is never a claim to
            # ownership. Fail the whole operation rather than altering it.
            collision = conn.execute("SELECT id FROM users WHERE username=? COLLATE NOCASE", (username,)).fetchone()
            if collision is not None and (owner is None or collision["id"] != owner["id"]):
                return {"configured": True, "ready": False,
                        "message": "ตั้งค่าบัญชีเจ้าของระบบไม่ได้ เพราะชื่อบัญชีบนโฮสต์ถูกใช้อยู่ กรุณาเลือกชื่อเจ้าของระบบอื่นบนโฮสต์"}
            if owner is None:
                user = store.create_user(username, password, "admin", conn=conn, is_super_admin=True)
                action = "owner_host_bootstrapped"
                before = None
            else:
                before = public_user(owner)
                conn.execute("UPDATE users SET username=?,password_hash=? WHERE id=?",
                             (username, hash_password(password), owner["id"]))
                user = public_user(conn.execute("SELECT * FROM users WHERE id=?", (owner["id"],)).fetchone())
                action = "owner_host_recovered"
            conn.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
            # Session-bound expert verification must not survive host recovery.
            # Soft deletion preserves its history and all clinical documents.
            now = utc_now()
            conn.execute("UPDATE documents SET deleted_at=?,updated_at=?,revision=revision+1 "
                         "WHERE kind='expert_session' AND owner_id=? AND deleted_at IS NULL",
                         (now, now, user["id"]))
            data = json_text({"owner_id": user["id"], "password_hash": hash_password(password)})
            # Do not use the audited document helpers: even administrators must
            # never receive this private password hash from an audit response.
            conn.execute("INSERT INTO documents(id,kind,owner_id,data,created_at,updated_at) VALUES (?,?,NULL,?,?,?) "
                         "ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at,"
                         "revision=documents.revision+1,deleted_at=NULL",
                         (BOOTSTRAP_DOCUMENT_ID, BOOTSTRAP_DOCUMENT_KIND, data, now, now))
            store.append_audit("users", user["id"], user["id"], action, before=before,
                               after={**user, "password_changed": True}, conn=conn)
        return {"configured": True, "ready": True, "message": "บัญชีเจ้าของระบบพร้อมเข้าสู่ระบบ"}
    except Exception:
        # Configuration, hashing, and database failures must not take the public
        # dashboard down. Never copy exception text or host values to the UI/log.
        return {"configured": True, "ready": False,
                "message": "ตั้งค่าบัญชีเจ้าของระบบไม่ได้ กรุณาตรวจสอบชื่อบัญชี รหัสผ่าน และพื้นที่เก็บข้อมูลส่วนตัวบนโฮสต์"}

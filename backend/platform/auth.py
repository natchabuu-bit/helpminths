"""Opaque cookie sessions, CSRF protection and server-side platform permissions."""
from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from .store import ROLES, SCHEMA_VERSION, PlatformStore, hash_password, public_user, utc_now

router = APIRouter(prefix="/api/platform", tags=["Platform accounts and settings"])
COOKIE_NAME = "helpminths_session"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def get_store(request: Request) -> PlatformStore:
    store = getattr(request.app.state, "platform_store", None)
    if not isinstance(store, PlatformStore):
        raise HTTPException(503, "Not configured: ยังไม่ได้ตั้งค่าฐานข้อมูล")
    store.ensure_configured()
    return store


def csrf_token(raw_session: str) -> str:
    return hmac.new(raw_session.encode("utf-8"), b"HelpMinths-CSRF-v1", hashlib.sha256).hexdigest()


def _session_hash(raw_session: str) -> str:
    return hashlib.sha256(raw_session.encode("utf-8")).hexdigest()


def _check_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if not origin:
        return  # Non-browser clients still need a session and CSRF for writes.
    try:
        supplied, target = urlsplit(origin), urlsplit(str(request.base_url))
        store = getattr(request.app.state, "platform_store", None)
        # HTTPS termination may occur at the hosting proxy. Secure-cookie deployments
        # require the browser HTTPS origin even if the internal ASGI transport is HTTP.
        expected_scheme = "https" if isinstance(store, PlatformStore) and store.config.cookie_secure else target.scheme
        if supplied.scheme not in {"http", "https"} or supplied.netloc.lower() != target.netloc.lower() or supplied.scheme != expected_scheme:
            raise ValueError("Cross-origin request")
    except ValueError:
        raise HTTPException(403, "คำขอมาจากเว็บไซต์อื่น กรุณาเปิด HelpMinths โดยตรง") from None


def _current_session(request: Request, store: PlatformStore) -> tuple[dict[str, Any] | None, str | None]:
    raw = request.cookies.get(COOKIE_NAME, "")
    if len(raw) < 32 or len(raw) > 256:
        return None, None
    with store.connection() as conn:
        row = conn.execute("SELECT u.*,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1", (_session_hash(raw), utc_now())).fetchone()
        return (public_user(row), raw) if row else (None, None)


def require_user(request: Request) -> dict[str, Any]:
    store = get_store(request)
    user, raw = _current_session(request, store)
    if user is None or raw is None:
        raise HTTPException(401, "กรุณาเข้าสู่ระบบก่อนใช้งานส่วนนี้")
    if request.method.upper() not in SAFE_METHODS:
        _check_origin(request)
        supplied = request.headers.get("x-csrf-token", "")
        if not supplied or not hmac.compare_digest(supplied, csrf_token(raw)):
            raise HTTPException(403, "การยืนยันคำขอหมดอายุ กรุณาโหลดหน้าแล้วลองอีกครั้ง")
    return user


def require_roles(*roles: str):
    def dependency(user: Annotated[dict[str, Any], Depends(require_user)]) -> dict[str, Any]:
        if user["role"] not in roles:
            raise HTTPException(403, "บัญชีนี้ไม่มีสิทธิ์ใช้งานส่วนนี้")
        return user
    return dependency


def assert_access(user: dict[str, Any], document: dict[str, Any]) -> None:
    if user["role"] not in {"admin", "reviewer"} and document.get("owner_id") != user["id"]:
        raise HTTPException(403, "บัญชีนี้ไม่มีสิทธิ์เข้าถึงรายการนี้")


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=1024)


class CreateUserRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=12, max_length=1024)
    role: str = "lab"


class UpdateUserRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: str | None = None
    active: bool | None = None
    password: str | None = Field(default=None, min_length=12, max_length=1024)


class _LoginLimiter:
    """A bounded per-process limiter; production replicas need a shared gateway limiter."""
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._attempts: dict[str, list[float]] = {}

    def check(self, client: str, username: str) -> None:
        now = time.monotonic()
        keys = [(f"ip:{client}", 30), (f"account:{client}:{username.casefold()}", 5)]
        with self._lock:
            if len(self._attempts) > 5000:
                self._attempts = {key: values for key, values in self._attempts.items() if values and now - values[-1] < 60}
                if len(self._attempts) > 5000:
                    raise HTTPException(429, "มีคำขอเข้าสู่ระบบมากเกินไป กรุณารอหนึ่งนาที", headers={"Retry-After": "60"})
            for key, maximum in keys:
                values = [value for value in self._attempts.get(key, []) if now - value < 60]
                self._attempts[key] = values
                if len(values) >= maximum:
                    raise HTTPException(429, "มีคำขอเข้าสู่ระบบมากเกินไป กรุณารอหนึ่งนาที", headers={"Retry-After": "60"})
            for key, _ in keys:
                self._attempts[key].append(now)


def _limiter(request: Request) -> _LoginLimiter:
    if not hasattr(request.app.state, "platform_login_limiter"):
        request.app.state.platform_login_limiter = _LoginLimiter()
    return request.app.state.platform_login_limiter


@router.get("/session")
def session(request: Request, response: Response) -> dict[str, Any]:
    response.headers["Cache-Control"] = "no-store"
    store = getattr(request.app.state, "platform_store", None)
    if not isinstance(store, PlatformStore) or not store.configured:
        return {"configured": False, "user": None, "csrf_token": None, "bootstrap_required": False}
    user, raw = _current_session(request, store)
    return {"configured": True, "user": user, "csrf_token": csrf_token(raw) if raw else None, "bootstrap_required": not store.has_users()}


@router.get("/status")
def status(request: Request) -> dict[str, Any]:
    store = getattr(request.app.state, "platform_store", None)
    configured = isinstance(store, PlatformStore) and store.configured
    model = getattr(request.app.state, "model_service", None)
    durable = bool(configured and store.config.storage_durable)
    metadata = getattr(model, "metadata", None)
    return {
        "configured": configured,
        "database": "ready" if configured else "not_configured",
        "authentication": ("ready" if store.has_users() else "bootstrap_required") if configured else "not_configured",
        "schema_version": SCHEMA_VERSION if configured else None,
        "roles": list(ROLES),
        "storage": {"configured": configured, "durable": durable, "notice": "ผู้ดูแลระบุว่าเชื่อมพื้นที่เก็บข้อมูลถาวรแล้ว ต้องมีการสำรองแยกต่างหาก" if durable else "ยังไม่ยืนยันพื้นที่เก็บข้อมูลถาวร บริการโฮสต์แบบชั่วคราวอาจลบข้อมูลเมื่อเริ่มระบบใหม่"},
        "model": {"ready": bool(getattr(model, "ready", False)), "name": getattr(model, "name", None), "message": getattr(model, "message", "Not configured"), "version": getattr(model, "version", None), "sha256": metadata.get("sha256") if isinstance(metadata, dict) else None},
    }


@router.post("/login")
def login(body: LoginRequest, request: Request, response: Response) -> dict[str, Any]:
    _check_origin(request)
    store = get_store(request)
    _limiter(request).check(request.client.host if request.client else "unknown", body.username)
    user = store.authenticate(body.username.strip(), body.password)
    if user is None:
        raise HTTPException(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง")
    raw = secrets.token_urlsafe(48)
    now = datetime.now(timezone.utc)
    expires = (now + timedelta(hours=store.config.session_hours)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    with store.transaction() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at<=?", (utc_now(),))
        conn.execute("INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)", (_session_hash(raw), user["id"], utc_now(), expires))
        store.append_audit("users", user["id"], user["id"], "login", after={"expires_at": expires}, conn=conn)
    response.set_cookie(COOKIE_NAME, raw, max_age=store.config.session_hours * 3600, httponly=True, secure=store.config.cookie_secure, samesite="lax", path="/")
    response.headers["Cache-Control"] = "no-store"
    return {"configured": True, "user": user, "csrf_token": csrf_token(raw), "bootstrap_required": False}


@router.post("/logout")
def logout(request: Request, response: Response, user: Annotated[dict[str, Any], Depends(require_user)]) -> dict[str, Any]:
    store = get_store(request)
    response.headers["Cache-Control"] = "no-store"
    with store.transaction() as conn:
        conn.execute("DELETE FROM sessions WHERE token_hash=?", (_session_hash(request.cookies.get(COOKIE_NAME, "")),))
        store.append_audit("users", user["id"], user["id"], "logout", conn=conn)
    response.delete_cookie(COOKIE_NAME, path="/", secure=store.config.cookie_secure, httponly=True, samesite="lax")
    return {"configured": True, "user": None, "csrf_token": None, "bootstrap_required": not store.has_users()}


Admin = Annotated[dict[str, Any], Depends(require_roles("admin"))]
User = Annotated[dict[str, Any], Depends(require_user)]


@router.get("/users")
def users(request: Request, _admin: Admin, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0)) -> dict[str, Any]:
    store = get_store(request)
    with store.connection() as conn:
        count = conn.execute("SELECT count(*) FROM users").fetchone()[0]
        rows = conn.execute("SELECT * FROM users ORDER BY created_at,id LIMIT ? OFFSET ?", (limit, offset)).fetchall()
        return {"items": [public_user(row) for row in rows], "total": count, "limit": limit, "offset": offset}


@router.post("/users", status_code=201)
def create_user(body: CreateUserRequest, request: Request, admin: Admin) -> dict[str, Any]:
    return get_store(request).create_user(body.username, body.password, body.role, actor_id=admin["id"])


@router.patch("/users/{user_id}")
def update_user(user_id: str, body: UpdateUserRequest, request: Request, admin: Admin) -> dict[str, Any]:
    store = get_store(request)
    if body.role is not None and body.role not in ROLES:
        raise HTTPException(422, "Invalid role")
    if not body.model_fields_set or all(getattr(body, field) is None for field in body.model_fields_set):
        raise HTTPException(422, "ระบุรายการที่ต้องการแก้ไข")
    encoded = hash_password(body.password) if body.password is not None else None
    with store.transaction() as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "ไม่พบบัญชีผู้ใช้")
        before = public_user(row)
        role = body.role if body.role is not None else row["role"]
        active = body.active if body.active is not None else bool(row["active"])
        if row["role"] == "admin" and row["active"] and (role != "admin" or not active):
            remaining = conn.execute("SELECT count(*) FROM users WHERE role='admin' AND active=1 AND id<>?", (user_id,)).fetchone()[0]
            if not remaining:
                raise HTTPException(409, "ต้องมีผู้ดูแลระบบที่เปิดใช้งานอย่างน้อยหนึ่งบัญชี")
        conn.execute("UPDATE users SET role=?,active=?,password_hash=? WHERE id=?", (role, int(active), encoded or row["password_hash"], user_id))
        if role != row["role"] or active != bool(row["active"]) or encoded is not None:
            conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        updated = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        assert updated is not None
        after = public_user(updated)
        store.append_audit("users", user_id, admin["id"], "user_updated", before=before, after={**after, "password_changed": encoded is not None}, conn=conn)
        return after


@router.get("/audit/{kind}/{document_id}")
def audit(kind: str, document_id: str, request: Request, user: User, limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)) -> dict[str, Any]:
    store = get_store(request)
    if kind == "users" and user["role"] != "admin":
        raise HTTPException(403, "เฉพาะผู้ดูแลระบบจึงดูประวัติบัญชีผู้ใช้ได้")
    if kind not in {"analysis", "review", "feedback", "report"} and user["role"] not in {"admin", "reviewer"}:
        raise HTTPException(403, "บัญชีนี้ไม่มีสิทธิ์ดูประวัติข้อมูลภายในประเภทนี้")
    document = store.get_document(kind, document_id, include_deleted=True)
    if document is None:
        if kind != "users" or user["role"] != "admin":
            raise HTTPException(404, "ไม่พบรายการ")
        with store.connection() as conn:
            if conn.execute("SELECT 1 FROM users WHERE id=?", (document_id,)).fetchone() is None:
                raise HTTPException(404, "ไม่พบรายการ")
    else:
        assert_access(user, document)
    return {"items": store.list_audit(kind, document_id, limit, offset), "limit": limit, "offset": offset}

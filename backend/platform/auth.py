"""Opaque cookie sessions, CSRF protection and server-side platform permissions."""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from .owner_bootstrap import BOOTSTRAP_DOCUMENT_KIND, configured_owner_username, owner_login_username
from .store import ROLES, SCHEMA_VERSION, USERNAME, USERNAME_MESSAGE, PlatformStore, hash_password, is_reserved_owner_username, json_text, normalize_profile_field, owner_username, public_user, utc_now, verify_password

router = APIRouter(prefix="/api/platform", tags=["Platform accounts and settings"])
COOKIE_NAME = "helpminths_session"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
EXPERT_VERIFICATION_MINUTES = 15


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


def _admin_setup_token() -> str | None:
    """A host-owned setup secret is optional; never generate or disclose one."""
    value = os.getenv("HELPMINTHS_ADMIN_SETUP_TOKEN", "")
    if not 32 <= len(value) <= 256 or any(not 33 <= ord(char) <= 126 for char in value):
        return None
    return value


def _admin_setup_available(store: PlatformStore) -> bool:
    return bool(store.configured and _admin_setup_token() and not store.has_users())


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
        row = conn.execute("SELECT u.*,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1 AND u.approval_status='approved'", (_session_hash(raw), utc_now())).fetchone()
        return (public_user(row), raw) if row else (None, None)


def _expert_verified_until(store: PlatformStore, user: dict[str, Any] | None, raw: str | None) -> str | None:
    if not user or user["role"] not in {"admin", "reviewer"} or not raw:
        return None
    verification = store.get_document("expert_session", _session_hash(raw))
    if verification is None or verification["owner_id"] != user["id"]:
        return None
    data = verification["data"]
    until = data.get("verified_until")
    if not isinstance(until, str) or data.get("role") != user["role"]:
        return None
    try:
        parsed = datetime.fromisoformat(until.replace("Z", "+00:00"))
        return until if parsed.tzinfo is not None and parsed > datetime.now(timezone.utc) else None
    except ValueError:
        return None


def _owner_metadata(request: Request, store: PlatformStore | None) -> dict[str, Any]:
    bootstrap = getattr(request.app.state, "owner_bootstrap", None)
    # Lightweight/unconfigured router hosts predate owner bootstrap and retain
    # their minimal session contract. The real application always sets status.
    if not isinstance(bootstrap, dict) and (not isinstance(store, PlatformStore) or not store.configured):
        return {}
    result: dict[str, Any] = {"owner_login_username": owner_login_username(store)}
    if isinstance(bootstrap, dict):
        result["owner_bootstrap"] = {key: bootstrap[key] for key in ("configured", "ready", "message")}
        if not bootstrap["configured"] and isinstance(store, PlatformStore) and store.has_users():
            result["owner_bootstrap"].update(ready=True, message="บัญชีเจ้าของระบบพร้อมเข้าสู่ระบบ")
    return result


def _session_payload(store: PlatformStore, user: dict[str, Any], raw: str, request: Request) -> dict[str, Any]:
    return {"configured": True, "user": public_user(user), "csrf_token": csrf_token(raw),
            "bootstrap_required": not store.has_users(), "registration_enabled": True,
            "admin_setup_available": _admin_setup_available(store),
            "owner_username": configured_owner_username(), **_owner_metadata(request, store),
            "expert_verified_until": _expert_verified_until(store, user, raw)}


def _create_session(store: PlatformStore, user: dict[str, Any], conn: sqlite3.Connection) -> tuple[str, str]:
    current = conn.execute("SELECT * FROM users WHERE id=? AND active=1", (user["id"],)).fetchone()
    if current is None:
        raise HTTPException(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง")
    _require_approved(public_user(current))
    raw = secrets.token_urlsafe(48)
    now = datetime.now(timezone.utc)
    expires = (now + timedelta(hours=store.config.session_hours)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    conn.execute("DELETE FROM sessions WHERE expires_at<=?", (utc_now(),))
    conn.execute("INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)", (_session_hash(raw), user["id"], utc_now(), expires))
    return raw, expires


def _set_session_cookie(response: Response, store: PlatformStore, raw: str) -> None:
    response.set_cookie(COOKIE_NAME, raw, max_age=store.config.session_hours * 3600, httponly=True,
                        secure=store.config.cookie_secure, samesite="lax", path="/")
    response.headers["Cache-Control"] = "no-store"


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
    return {**user, "_expert_verified": bool(_expert_verified_until(store, user, raw))}


def require_roles(*roles: str):
    def dependency(user: Annotated[dict[str, Any], Depends(require_user)]) -> dict[str, Any]:
        if user["role"] not in roles:
            raise HTTPException(403, "บัญชีนี้ไม่มีสิทธิ์ใช้งานส่วนนี้")
        return user
    return dependency


def require_super_admin(user: Annotated[dict[str, Any], Depends(require_user)]) -> dict[str, Any]:
    if user["role"] != "admin" or user.get("is_super_admin") is not True:
        raise HTTPException(403, "เฉพาะเจ้าของระบบ (Super admin) จึงจัดการและอนุมัติบัญชีได้")
    return user


def _require_approved(user: dict[str, Any]) -> None:
    if user["approval_status"] != "approved":
        status = user["approval_status"]
        message = "บัญชีนี้กำลังรอเจ้าของระบบอนุมัติ" if status == "pending" else "เจ้าของระบบไม่อนุมัติบัญชีนี้ กรุณาติดต่อเจ้าของระบบ"
        raise HTTPException(403, {"code": "account_" + status, "message": message})


def assert_access(user: dict[str, Any], document: dict[str, Any]) -> None:
    if document.get("owner_id") == user["id"]:
        return
    if user["role"] in {"admin", "reviewer"}:
        if document.get("kind") in {None, "analysis", "review", "referral"} and user.get("_expert_verified") is not True:
            raise HTTPException(403, {"code": "expert_verification_required", "message": "กรุณายืนยันรหัสผ่านผู้เชี่ยวชาญอีกครั้งก่อนเข้าถึงภาพของผู้อื่น"})
        return
    raise HTTPException(403, "บัญชีนี้ไม่มีสิทธิ์เข้าถึงรายการนี้")


def require_expert_verification(request: Request, user: Annotated[dict[str, Any], Depends(require_roles("admin", "reviewer"))]) -> dict[str, Any]:
    # The role is granted only by an administrator. Re-entering a password does
    # not change a general account into an expert or unlock another session.
    if not _expert_verified_until(get_store(request), user, request.cookies.get(COOKIE_NAME)):
        raise HTTPException(403, {"code": "expert_verification_required", "message": "กรุณายืนยันรหัสผ่านผู้เชี่ยวชาญอีกครั้ง การยืนยันมีอายุ 15 นาที"})
    return user


def _validate_username(value: str) -> str:
    normalized = value.strip()
    if not USERNAME.fullmatch(normalized):
        raise ValueError(USERNAME_MESSAGE)
    return normalized


# There is deliberately no username length policy beyond nonempty valid syntax;
# the application still bounds the whole HTTP request before parsing it.
Username = Annotated[str, AfterValidator(_validate_username)]
FullName = Annotated[str, AfterValidator(lambda value: normalize_profile_field("full_name", value))]
Workplace = Annotated[str, AfterValidator(lambda value: normalize_profile_field("workplace", value))]
Affiliation = Annotated[str, AfterValidator(lambda value: normalize_profile_field("affiliation", value))]
Phone = Annotated[str, AfterValidator(lambda value: normalize_profile_field("phone", value))]


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: Username
    password: str = Field(min_length=4, max_length=1024)


class CreateUserRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: Username
    password: str = Field(min_length=4, max_length=1024)
    role: str = "lab"


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: Username
    password: str = Field(min_length=4, max_length=1024)
    account_type: Literal["user", "expert"] = "user"
    full_name: FullName
    workplace: Workplace
    affiliation: Affiliation
    phone: Phone


class AdminSetupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    setup_token: str = Field(min_length=1, max_length=256)
    username: Username
    password: str = Field(min_length=4, max_length=1024)


class AccountRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str = Field(min_length=4, max_length=1024)
    username: Username | None = None
    new_password: str | None = Field(default=None, min_length=4, max_length=1024)
    full_name: FullName | None = None
    workplace: Workplace | None = None
    affiliation: Affiliation | None = None
    phone: Phone | None = None


class ExpertLoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: Username | None = None
    password: str = Field(min_length=4, max_length=1024)


class UpdateUserRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: str | None = None
    active: bool | None = None
    password: str | None = Field(default=None, min_length=4, max_length=1024)
    approval_status: Literal["pending", "approved", "rejected"] | None = None


class _LoginLimiter:
    """A bounded per-process limiter; production replicas need a shared gateway limiter."""
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._attempts: dict[str, list[float]] = {}

    def check(self, client: str, username: str) -> None:
        now = time.monotonic()
        account_key = hashlib.sha256(username.casefold().encode("utf-8")).hexdigest()
        keys = [(f"ip:{client}", 30), (f"account:{client}:{account_key}", 5)]
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
        return {"configured": False, "user": None, "csrf_token": None, "bootstrap_required": False,
                **_owner_metadata(request, store)}
    user, raw = _current_session(request, store)
    if user and raw:
        return _session_payload(store, user, raw, request)
    return {"configured": True, "user": None, "csrf_token": None, "bootstrap_required": not store.has_users(),
            "registration_enabled": True, "admin_setup_available": _admin_setup_available(store), "expert_verified_until": None,
            "owner_username": configured_owner_username(), **_owner_metadata(request, store)}


@router.get("/status")
def status(request: Request) -> dict[str, Any]:
    store = getattr(request.app.state, "platform_store", None)
    configured = isinstance(store, PlatformStore) and store.configured
    model = getattr(request.app.state, "model_service", None)
    durable = bool(configured and store.config.storage_durable)
    automatic = bool(configured and store.config.automatic_storage)
    metadata = getattr(model, "metadata", None)
    return {
        "configured": configured,
        "database": "ready" if configured else "not_configured",
        "authentication": "ready" if configured else "not_configured",
        "administrator_setup_pending": bool(configured and not store.has_users()),
        "registration_enabled": configured,
        "admin_setup_available": bool(configured and _admin_setup_available(store)),
        "schema_version": SCHEMA_VERSION if configured else None,
        "roles": list(ROLES),
        "owner_username": configured_owner_username(), **_owner_metadata(request, store),
        "storage": {"configured": configured, "durable": durable, "automatic": automatic,
                    "mode": "durable" if durable else "temporary" if configured else "not_configured",
                    "notice": "เชื่อมพื้นที่เก็บข้อมูลถาวรตามการตั้งค่าของผู้ดูแลแล้ว ควรสำรองข้อมูลแยกต่างหาก" if durable else
                              "บัญชีและผลตรวจใช้งานได้ แต่ข้อมูลบนพื้นที่ชั่วคราวอาจหายเมื่อโฮสต์เริ่มใหม่หรือ deploy" if configured else
                              "ยังไม่ได้เปิดฐานข้อมูลและพื้นที่จัดเก็บข้อมูล"},
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
    _require_approved(user)
    with store.transaction() as conn:
        raw, expires = _create_session(store, user, conn)
        store.append_audit("users", user["id"], user["id"], "login", after={"expires_at": expires}, conn=conn)
    _set_session_cookie(response, store, raw)
    return _session_payload(store, user, raw, request)


@router.post("/owner-signin")
def owner_signin(body: LoginRequest, request: Request, response: Response) -> dict[str, Any]:
    _check_origin(request)
    store = get_store(request)
    _limiter(request).check(request.client.host if request.client else "unknown", body.username)
    # Check the current password and the owner flag within the same serialized
    # transaction that issues the cookie, before any login audit or session.
    with store.transaction() as conn:
        row = conn.execute("SELECT * FROM users WHERE username=? COLLATE NOCASE", (body.username,)).fetchone()
        valid = verify_password(body.password, row["password_hash"] if row else None)
        if row is None or not valid or not row["active"]:
            raise HTTPException(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง")
        user = public_user(row)
        _require_approved(user)
        if user["role"] != "admin" or not user["is_super_admin"]:
            raise HTTPException(403, "เฉพาะบัญชีเจ้าของระบบ (Super Admin) จึงเข้าสู่หลังบ้านได้")
        raw, expires = _create_session(store, user, conn)
        store.append_audit("users", user["id"], user["id"], "owner_signin", after={"expires_at": expires}, conn=conn)
    _set_session_cookie(response, store, raw)
    return _session_payload(store, user, raw, request)


@router.post("/register", status_code=201)
def register(body: RegisterRequest, request: Request, response: Response) -> dict[str, Any]:
    _check_origin(request)
    store = get_store(request)
    _limiter(request).check(request.client.host if request.client else "unknown", "register:" + body.username)
    if _current_session(request, store)[0] is not None:
        raise HTTPException(409, "กรุณาออกจากระบบก่อนสมัครบัญชีใหม่")
    # Requested expertise does not grant it. Every public account needs the
    # owner's decision, and registration cannot issue an authenticated session.
    requested_role = "reviewer" if body.account_type == "expert" else "lab"
    with store.transaction() as conn:
        user = store.create_user(body.username, body.password, "lab", conn=conn,
                                 approval_status="pending", requested_role=requested_role,
                                 full_name=body.full_name, workplace=body.workplace,
                                 affiliation=body.affiliation, phone=body.phone)
        store.append_audit("users", user["id"], user["id"], "self_registered", after=user, conn=conn)
    response.headers["Cache-Control"] = "no-store"
    return {"configured": True, "user": user, "csrf_token": None, "pending_approval": True,
            "message": "สมัครบัญชีแล้ว กรุณารอเจ้าของระบบอนุมัติก่อนเข้าสู่ระบบ",
            "bootstrap_required": not store.has_users(), "registration_enabled": True,
            "admin_setup_available": _admin_setup_available(store), "expert_verified_until": None,
            "owner_username": configured_owner_username(), **_owner_metadata(request, store)}


@router.post("/admin-setup", status_code=201)
def admin_setup(body: AdminSetupRequest, request: Request, response: Response) -> dict[str, Any]:
    _check_origin(request)
    store = get_store(request)
    # One fixed key prevents guessing the host secret under changing usernames.
    _limiter(request).check(request.client.host if request.client else "unknown", "admin-setup")
    token = _admin_setup_token()
    with store.transaction() as conn:
        # Serialize the claim with CLI/bootstrap and competing web requests. An
        # ordinary public signup never participates in this privileged path.
        if conn.execute("SELECT 1 FROM users WHERE is_super_admin=1 LIMIT 1").fetchone() is not None:
            raise HTTPException(409, "มีผู้ดูแลระบบแล้ว ให้เข้าสู่ระบบด้วยบัญชีผู้ดูแลเดิม")
        if token is None:
            raise HTTPException(503, "ยังไม่เปิดการตั้งค่าผู้ดูแลผ่านเว็บ กรุณาตั้งค่าโทเคนผู้ดูแลบนโฮสต์ก่อน")
        if not hmac.compare_digest(body.setup_token.encode("utf-8"), token.encode("ascii")):
            raise HTTPException(403, "โทเคนตั้งค่าผู้ดูแลไม่ถูกต้อง")
        if body.username != owner_username():
            raise HTTPException(422, "กรุณาใช้ชื่อบัญชีเจ้าของระบบที่กำหนดไว้: " + owner_username())
        user = store.create_user(body.username, body.password, "admin", conn=conn, is_super_admin=True)
        raw, expires = _create_session(store, user, conn)
        store.append_audit("users", user["id"], user["id"], "admin_web_bootstrapped",
                           after={"role": "admin", "expires_at": expires}, conn=conn)
    _set_session_cookie(response, store, raw)
    return _session_payload(store, user, raw, request)


@router.post("/logout")
def logout(request: Request, response: Response, user: Annotated[dict[str, Any], Depends(require_user)]) -> dict[str, Any]:
    store = get_store(request)
    response.headers["Cache-Control"] = "no-store"
    with store.transaction() as conn:
        conn.execute("DELETE FROM sessions WHERE token_hash=?", (_session_hash(request.cookies.get(COOKIE_NAME, "")),))
        store.append_audit("users", user["id"], user["id"], "logout", conn=conn)
    response.delete_cookie(COOKIE_NAME, path="/", secure=store.config.cookie_secure, httponly=True, samesite="lax")
    return {"configured": True, "user": None, "csrf_token": None, "bootstrap_required": not store.has_users()}


Admin = Annotated[dict[str, Any], Depends(require_super_admin)]
User = Annotated[dict[str, Any], Depends(require_user)]
Expert = Annotated[dict[str, Any], Depends(require_roles("admin", "reviewer"))]


@router.patch("/account")
def update_account(body: AccountRequest, request: Request, response: Response, user: User) -> dict[str, Any]:
    store = get_store(request)
    _limiter(request).check(request.client.host if request.client else "unknown", "account:" + user["id"])
    username = body.username.strip() if body.username is not None else user["username"]
    if not USERNAME.fullmatch(username):
        raise HTTPException(422, USERNAME_MESSAGE)
    if not user["is_super_admin"] and is_reserved_owner_username(username):
        raise HTTPException(409, "ชื่อบัญชีนี้สงวนไว้สำหรับเจ้าของระบบ")
    profile = {key: getattr(body, key) for key in ("full_name", "workplace", "affiliation", "phone")
               if getattr(body, key) is not None}
    if body.username is None and body.new_password is None and not profile:
        raise HTTPException(422, "ระบุข้อมูลบัญชีที่ต้องการเปลี่ยน")
    encoded = hash_password(body.new_password) if body.new_password is not None else None
    raw_old = request.cookies.get(COOKIE_NAME, "")
    with store.transaction() as conn:
        row = conn.execute("SELECT u.*,s.expires_at AS session_expires_at FROM users u JOIN sessions s ON u.id=s.user_id WHERE u.id=? AND s.token_hash=? AND s.expires_at>? AND u.active=1 AND u.approval_status='approved'",
                           (user["id"], _session_hash(raw_old), utc_now())).fetchone()
        if row is None:
            raise HTTPException(401, "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง")
        if not verify_password(body.current_password, row["password_hash"]):
            raise HTTPException(403, "รหัสผ่านปัจจุบันไม่ถูกต้อง")
        before = public_user(row)
        try:
            conn.execute("UPDATE users SET username=?,password_hash=?,full_name=?,workplace=?,affiliation=?,phone=? WHERE id=?",
                         (username, encoded or row["password_hash"],
                          *(profile.get(key, row[key]) for key in ("full_name", "workplace", "affiliation", "phone")), user["id"]))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "ชื่อผู้ใช้นี้ถูกใช้แล้ว") from None
        # Every old cookie and any expert step-up bound to it stop working. The
        # caller receives a new opaque cookie/CSRF pair after the transaction.
        conn.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
        updated = public_user(conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone())
        raw, _expires = _create_session(store, updated, conn)
        store.append_audit("users", user["id"], user["id"], "self_updated", before=before,
                           after={**updated, "password_changed": encoded is not None}, conn=conn)
    _set_session_cookie(response, store, raw)
    return _session_payload(store, updated, raw, request)


@router.get("/expert-session")
def expert_session(request: Request, response: Response, user: Expert) -> dict[str, Any]:
    until = _expert_verified_until(get_store(request), user, request.cookies.get(COOKIE_NAME))
    response.headers["Cache-Control"] = "no-store"
    return {"verified": bool(until), "verified_until": until}


@router.post("/expert-login")
def expert_login(body: ExpertLoginRequest, request: Request, response: Response, user: Expert) -> dict[str, Any]:
    store = get_store(request)
    _limiter(request).check(request.client.host if request.client else "unknown", "expert:" + user["id"])
    raw = request.cookies.get(COOKIE_NAME, "")
    with store.transaction() as conn:
        row = conn.execute("SELECT u.*,s.expires_at AS session_expires_at FROM users u JOIN sessions s ON u.id=s.user_id WHERE u.id=? AND s.token_hash=? AND s.expires_at>? AND u.active=1 AND u.approval_status='approved'",
                           (user["id"], _session_hash(raw), utc_now())).fetchone()
        if row is None or row["role"] not in {"admin", "reviewer"}:
            raise HTTPException(401, "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง")
        same_username = body.username is None or body.username.strip().casefold() == row["username"].casefold()
        password_matches = verify_password(body.password, row["password_hash"])
        if not same_username or not password_matches:
            raise HTTPException(403, "ข้อมูลยืนยันบัญชีผู้เชี่ยวชาญไม่ถูกต้อง")
        until = _verify_expert_session(store, public_user(row), raw, row["session_expires_at"], conn)
    response.headers["Cache-Control"] = "no-store"
    return {"verified": True, "verified_until": until}


def _verify_expert_session(store: PlatformStore, user: dict[str, Any], raw: str, expires: str, conn: sqlite3.Connection) -> str:
    now = datetime.now(timezone.utc)
    until = min(now + timedelta(minutes=EXPERT_VERIFICATION_MINUTES), datetime.fromisoformat(expires.replace("Z", "+00:00"))).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    identifier = _session_hash(raw)
    prior = store.get_document("expert_session", identifier, include_deleted=True, conn=conn)
    data = {"verified_until": until, "role": user["role"]}
    if prior is None:
        store.create_document("expert_session", data, user["id"], user["id"], document_id=identifier, conn=conn)
    else:
        conn.execute("UPDATE documents SET data=?,updated_at=?,revision=revision+1,deleted_at=NULL WHERE id=? AND kind='expert_session'",
                     (json_text(data), utc_now(), identifier))
    store.append_audit("users", user["id"], user["id"], "expert_verified", after={"verified_until": until}, conn=conn)
    return until


@router.post("/expert-signin")
def expert_signin(body: LoginRequest, request: Request, response: Response) -> dict[str, Any]:
    _check_origin(request)
    store = get_store(request)
    _limiter(request).check(request.client.host if request.client else "unknown", body.username)
    user = store.authenticate(body.username, body.password)
    if user is None:
        raise HTTPException(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง")
    _require_approved(user)
    with store.transaction() as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
        if row is None or row["role"] not in {"admin", "reviewer"}:
            raise HTTPException(403, "บัญชีนี้ยังไม่ได้รับอนุมัติสิทธิ์ผู้เชี่ยวชาญ")
        user = public_user(row)
        raw, expires = _create_session(store, user, conn)
        _verify_expert_session(store, user, raw, expires, conn)
        store.append_audit("users", user["id"], user["id"], "expert_signin", after={"expires_at": expires}, conn=conn)
    _set_session_cookie(response, store, raw)
    return _session_payload(store, user, raw, request)


@router.delete("/expert-session")
def lock_expert_session(request: Request, response: Response, user: Expert) -> dict[str, Any]:
    store = get_store(request)
    with store.transaction() as conn:
        identifier = _session_hash(request.cookies.get(COOKIE_NAME, ""))
        prior = store.get_document("expert_session", identifier, conn=conn)
        if prior is not None:
            store.soft_delete_document("expert_session", identifier, user["id"], prior["revision"], conn=conn)
        store.append_audit("users", user["id"], user["id"], "expert_locked", conn=conn)
    response.headers["Cache-Control"] = "no-store"
    return {"verified": False, "verified_until": None}


@router.get("/users")
def users(request: Request, _admin: Admin, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
          approval_status: Literal["pending", "approved", "rejected"] | None = None,
          requested_role: Literal["admin", "reviewer", "lab", "student"] | None = None,
          account_type: Literal["user", "expert"] | None = None) -> dict[str, Any]:
    store = get_store(request)
    conditions, values = [], []
    if approval_status is not None:
        conditions.append("approval_status=?")
        values.append(approval_status)
    if requested_role is not None:
        conditions.append("requested_role=?")
        values.append(requested_role)
    if account_type is not None:
        # Pending applications reflect the requested access; approved members
        # reflect the owner's current role decision after later role changes.
        roles = "('reviewer')" if account_type == "expert" else "('lab','student')"
        conditions.append(f"((approval_status='approved' AND role IN {roles}) OR (approval_status<>'approved' AND requested_role IN {roles}))")
    where = " WHERE " + " AND ".join(conditions) if conditions else ""
    with store.connection() as conn:
        count = conn.execute("SELECT count(*) FROM users" + where, values).fetchone()[0]
        rows = conn.execute("SELECT * FROM users" + where + " ORDER BY created_at,id LIMIT ? OFFSET ?", (*values, limit, offset)).fetchall()
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
        approval_status = body.approval_status or row["approval_status"]
        first_approval = approval_status == "approved" and row["approval_status"] != "approved"
        role = body.role if body.role is not None else row["requested_role"] if first_approval else row["role"]
        active = body.active if body.active is not None else bool(row["active"])
        if row["is_super_admin"] and (role != "admin" or not active or approval_status != "approved"):
            raise HTTPException(409, "ไม่สามารถลดสิทธิ์ ปิดใช้งาน หรือระงับการอนุมัติบัญชีเจ้าของระบบได้")
        approved_by = admin["id"] if first_approval else row["approved_by"] if approval_status == "approved" else None
        approved_at = utc_now() if first_approval else row["approved_at"] if approval_status == "approved" else None
        conn.execute("UPDATE users SET role=?,active=?,password_hash=?,approval_status=?,approved_by=?,approved_at=? WHERE id=?",
                     (role, int(active), encoded or row["password_hash"], approval_status, approved_by, approved_at, user_id))
        if role != row["role"] or active != bool(row["active"]) or approval_status != row["approval_status"] or encoded is not None:
            conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        updated = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        assert updated is not None
        after = public_user(updated)
        store.append_audit("users", user_id, admin["id"], "user_updated", before=before, after={**after, "password_changed": encoded is not None}, conn=conn)
        return after


@router.get("/audit/{kind}/{document_id}")
def audit(kind: str, document_id: str, request: Request, user: User, limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)) -> dict[str, Any]:
    store = get_store(request)
    if kind == BOOTSTRAP_DOCUMENT_KIND:
        raise HTTPException(404, "ไม่พบรายการ")
    if kind == "users" and not user["is_super_admin"]:
        raise HTTPException(403, "เฉพาะเจ้าของระบบจึงดูประวัติบัญชีผู้ใช้ได้")
    if kind not in {"analysis", "review", "feedback", "report"} and user["role"] not in {"admin", "reviewer"}:
        raise HTTPException(403, "บัญชีนี้ไม่มีสิทธิ์ดูประวัติข้อมูลภายในประเภทนี้")
    document = store.get_document(kind, document_id, include_deleted=True)
    if kind == "notification" and (document is None or document["owner_id"] != user["id"]):
        raise HTTPException(404, "ไม่พบรายการ")
    if document is None:
        if kind != "users" or user["role"] != "admin":
            raise HTTPException(404, "ไม่พบรายการ")
        with store.connection() as conn:
            if conn.execute("SELECT 1 FROM users WHERE id=?", (document_id,)).fetchone() is None:
                raise HTTPException(404, "ไม่พบรายการ")
    else:
        assert_access(user, document)
    return {"items": store.list_audit(kind, document_id, limit, offset), "limit": limit, "offset": offset}

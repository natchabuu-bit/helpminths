"""Owner-only retained copies of accepted diagnostic image submissions.

The clinical record remains the source of AI/review truth. Archival image bytes
live outside the operational image directory and survive history removal.
"""
from __future__ import annotations

import json
import hashlib
import os
import re
import shutil
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse

from .auth import get_store, require_super_admin
from .store import PlatformStore, flatten_document, utc_now

router = APIRouter(prefix="/api/platform/admin/image-archive", tags=["Super Admin image archive"])
ARCHIVE_KIND = "admin_image"
_ID = re.compile(r"^[a-f0-9]{32}$")
_BACKFILL_LOCK = threading.RLock()
THAI_TIME = timezone(timedelta(hours=7))


def _directory(store: PlatformStore) -> Path:
    store.ensure_configured()
    assert store.data_dir is not None
    path = store.data_dir / "archive-images"
    if path.is_symlink():
        raise HTTPException(503, "พื้นที่คลังภาพผู้ดูแลไม่พร้อมใช้งาน")
    path.mkdir(mode=0o700, exist_ok=True)
    if not path.is_dir() or path.resolve().parent != store.data_dir.resolve():
        raise HTTPException(503, "พื้นที่คลังภาพผู้ดูแลไม่พร้อมใช้งาน")
    os.chmod(path, 0o700)
    return path


def _identifier(source_id: str) -> str:
    return uuid.uuid5(uuid.NAMESPACE_URL, f"helpminths:admin-image:{source_id}").hex


def _copy_private(source: Path, destination: Path) -> None:
    """Link immutable normalized PNGs, with a copy fallback across filesystems."""
    if source.is_symlink() or not source.is_file() or destination.is_symlink():
        raise HTTPException(410, "ไม่มีไฟล์ภาพที่ปลอดภัยสำหรับคลังผู้ดูแล")
    try:
        os.link(source, destination)
    except FileExistsError:
        raise HTTPException(409, "รหัสไฟล์คลังภาพนี้ถูกใช้แล้ว") from None
    except OSError:
        created = False
        try:
            with source.open("rb") as original, destination.open("xb") as target:
                created = True
                os.chmod(destination, 0o600)
                shutil.copyfileobj(original, target)
        except BaseException:
            # Only this invocation's newly-created copy may be cleaned up.
            if created and destination.exists() and not destination.is_symlink():
                destination.unlink(missing_ok=True)
            raise
    os.chmod(destination, 0o600)


def create_archive_image(store: PlatformStore, image, user: dict[str, Any], *, source: str,
                         source_document_id: str, sample_code: str = "", analysis_id: str | None = None,
                         referral_id: str | None = None, attachment_id: str | None = None,
                         examined_at: str | None = None) -> dict[str, Any]:
    # Import only when called, after the clinical router has finished importing.
    from .analyses import _save_image
    identifier = _identifier(source_document_id)
    path = _directory(store) / f"{identifier}.png"
    if path.exists() or path.is_symlink():
        raise HTTPException(409, "รหัสไฟล์คลังภาพนี้ถูกใช้แล้ว")
    try:
        _save_image(image, path)
    except OSError:
        if path.exists() and not path.is_symlink():
            path.unlink(missing_ok=True)
        raise HTTPException(503, "พื้นที่คลังภาพผู้ดูแลไม่พร้อมใช้งาน กรุณาลองอีกครั้ง") from None
    try:
        return store.create_document(ARCHIVE_KIND, {
            "source": source, "source_document_id": source_document_id,
            "analysis_id": analysis_id, "referral_id": referral_id, "attachment_id": attachment_id,
            "sample_code": sample_code, "examined_at": examined_at or utc_now(),
            "image_filename": f"{identifier}.png", "width": image.width, "height": image.height,
            "status": "received", "quality": None,
        }, user["id"], user["id"], document_id=identifier)
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def update_archive_image(store: PlatformStore, archive: dict[str, Any], actor_id: str,
                         **changes: Any) -> dict[str, Any]:
    return store.update_document(ARCHIVE_KIND, archive["id"], {**archive["data"], **changes},
                                 actor_id, expected_revision=archive["revision"])


def archive_image_path(store: PlatformStore, archive: dict[str, Any]) -> Path:
    identifier = archive["id"]
    if not _ID.fullmatch(identifier) or archive["data"].get("image_filename") != f"{identifier}.png":
        raise HTTPException(410, "ไม่มีไฟล์ภาพในคลังผู้ดูแล")
    path = _directory(store) / f"{identifier}.png"
    if path.is_symlink() or not path.is_file():
        raise HTTPException(410, "ภาพเดิมไม่มีไฟล์ให้เรียกคืน")
    return path


def link_archived_image(store: PlatformStore, archive: dict[str, Any], destination: Path) -> None:
    _copy_private(archive_image_path(store, archive), destination)


def archive_existing_document(store: PlatformStore, document: dict[str, Any], actor_id: str,
                               *, conn=None) -> dict[str, Any]:
    """Retain legacy bytes before deletion, without changing clinical revisions."""
    identifier = _identifier(document["id"])
    with store._use(conn, write=True) as db:
        existing = store.get_document(ARCHIVE_KIND, identifier, conn=db)
        if existing is not None:
            if existing["owner_id"] != document["owner_id"] or existing["data"].get("source_document_id") != document["id"]:
                raise HTTPException(409, "รหัสคลังภาพไม่ตรงกับรายการเดิม")
            return existing
        data = document["data"]
        source = "supplemental" if document["kind"] == "referral_attachment" else "analysis"
        filename = data.get("image_filename")
        valid_source = _ID.fullmatch(document["id"]) and filename == f"{document['id']}.png"
        original = store.image_dir / filename if valid_source and store.image_dir else None
        available = original is not None and original.is_file() and not original.is_symlink()
        destination = _directory(store) / f"{identifier}.png"
        copied = False
        if available:
            if destination.exists() or destination.is_symlink():
                # A transaction/process may have stopped after retaining bytes
                # but before committing the derived archive document. Reuse
                # only a regular, byte-identical copy of this private source.
                if destination.is_symlink() or not destination.is_file():
                    raise HTTPException(409, "ไฟล์คลังภาพเดิมไม่ตรงกับรายการนี้")
                with original.open("rb") as left, destination.open("rb") as right:
                    same = hashlib.file_digest(left, "sha256").digest() == hashlib.file_digest(right, "sha256").digest()
                if not same:
                    raise HTTPException(409, "ไฟล์คลังภาพเดิมไม่ตรงกับรายการนี้")
                os.chmod(destination, 0o600)
            else:
                _copy_private(original, destination)
                copied = True
        record = {
            "source": source, "source_document_id": document["id"],
            "analysis_id": data.get("analysis_id") if source == "supplemental" else document["id"],
            "referral_id": data.get("referral_id"),
            "attachment_id": document["id"] if source == "supplemental" else None,
            "sample_code": data.get("sample_code", ""), "examined_at": document["created_at"],
            "image_filename": f"{identifier}.png" if available else None,
            "width": data.get("width", 0), "height": data.get("height", 0),
            "status": data.get("status", "completed"), "quality": data.get("quality"),
            "legacy_backfill": True,
        }
        try:
            return store.create_document(ARCHIVE_KIND, record, document["owner_id"], actor_id,
                                          document_id=identifier, conn=db)
        except BaseException:
            if copied:
                destination.unlink(missing_ok=True)
            raise


def ensure_legacy_archive(store: PlatformStore, actor_id: str, *, limit: int = 100) -> int:
    """Bounded, resumable, idempotent materialization; no re-encoding of old files."""
    with _BACKFILL_LOCK, store.transaction() as conn:
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS admin_image_source ON documents(json_extract(data,'$.source_document_id')) WHERE kind='admin_image' AND deleted_at IS NULL")
        missing = (" FROM documents s WHERE s.kind IN ('analysis','referral_attachment') "
                   "AND s.owner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM documents ar "
                   "WHERE ar.kind='admin_image' AND ar.deleted_at IS NULL "
                   "AND json_extract(ar.data,'$.source_document_id')=s.id)")
        rows = conn.execute("SELECT s.*" + missing + " ORDER BY s.created_at DESC,s.id DESC LIMIT ?", (limit,)).fetchall()
        for row in rows:
            archive_existing_document(store, {**dict(row), "data": json.loads(row["data"])}, actor_id, conn=conn)
        return conn.execute("SELECT COUNT(*)" + missing).fetchone()[0]


def _owner(store: PlatformStore, owner_id: str | None, *, conn=None) -> dict[str, Any]:
    with store._use(conn) as db:
        row = db.execute("SELECT id,username,full_name FROM users WHERE id=?", (owner_id,)).fetchone()
    return dict(row) if row else {"id": owner_id, "username": "บัญชีเดิม", "full_name": None}


def _analysis(store: PlatformStore, archive: dict[str, Any], *, conn=None):
    identifier = archive["data"].get("analysis_id")
    analysis = store.get_document("analysis", identifier, include_deleted=True, conn=conn) if identifier else None
    return analysis if analysis and analysis["owner_id"] == archive["owner_id"] else None


def _summary(store: PlatformStore, archive: dict[str, Any], *, conn=None) -> dict[str, Any]:
    data = archive["data"]
    analysis = _analysis(store, archive, conn=conn)
    clinical = analysis["data"] if analysis else data.get("analysis_snapshot") or {}
    examined = data.get("examined_at") or archive["created_at"]
    try:
        day = datetime.fromisoformat(examined.replace("Z", "+00:00")).astimezone(THAI_TIME).date().isoformat()
    except (ValueError, AttributeError):
        day = examined[:10]
    try:
        archive_image_path(store, archive)
        available = True
    except HTTPException as exc:
        if exc.status_code != 410:
            raise
        available = False
    status = data.get("status", "received") if data.get("source") == "supplemental" else clinical.get("status", data.get("status", "received"))
    if not available:
        status = "missing_image"
    return {
        "id": archive["id"], "owner_id": archive["owner_id"], "owner": _owner(store, archive["owner_id"], conn=conn),
        "created_at": archive["created_at"], "examined_at": examined, "examined_date": day,
        "source": data.get("source", "analysis"), "status": status,
        "sample_code": clinical.get("sample_code") or data.get("sample_code") or "ภาพส่งตรวจ",
        "analysis_id": analysis["id"] if analysis else clinical.get("id"), "referral_id": data.get("referral_id") or clinical.get("referral_id"),
        "attachment_id": data.get("attachment_id"), "width": data.get("width", 0), "height": data.get("height", 0),
        "image_url": f"/api/platform/admin/image-archive/{archive['id']}/image" if available else None,
        "image_available": available, "operational_deleted": bool(analysis and analysis["deleted_at"]),
        "review_status": clinical.get("review_status"), "ai_detection_count": len(clinical.get("detections", [])),
    }


def _filters(owner_id, date_from, date_to, status, q, source):
    clauses = ["ar.kind='admin_image'", "ar.deleted_at IS NULL"]
    values = []
    if owner_id:
        clauses.append("ar.owner_id=?"); values.append(owner_id)
    bounds = []
    for value, end in ((date_from, False), (date_to, True)):
        if value:
            try:
                day = datetime.strptime(value, "%Y-%m-%d").date()
                moment = datetime.combine(day + timedelta(days=1) if end else day, datetime.min.time(), tzinfo=THAI_TIME)
            except ValueError:
                raise HTTPException(422, "วันที่ต้องเป็น YYYY-MM-DD") from None
            bounds.append(day)
            clauses.append(f"julianday(json_extract(ar.data,'$.examined_at')) {'<' if end else '>='} julianday(?)")
            values.append(moment.isoformat())
    if len(bounds) == 2 and bounds[0] > bounds[1]:
        raise HTTPException(422, "วันเริ่มต้นต้องไม่อยู่หลังวันสิ้นสุด")
    if status:
        if status == "missing_image":
            clauses.append("json_extract(ar.data,'$.image_filename') IS NULL")
        else:
            clauses.append("CASE WHEN json_extract(ar.data,'$.source')='supplemental' THEN json_extract(ar.data,'$.status') ELSE COALESCE(json_extract(a.data,'$.status'),json_extract(ar.data,'$.analysis_snapshot.status'),json_extract(ar.data,'$.status')) END=?")
            values.append(status)
    if source:
        clauses.append("json_extract(ar.data,'$.source')=?"); values.append(source)
    if q:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        clauses.append("(COALESCE(json_extract(a.data,'$.sample_code'),json_extract(ar.data,'$.sample_code'),'') LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\' OR COALESCE(u.full_name,'') LIKE ? ESCAPE '\\' OR ar.id=?)")
        values.extend([f"%{escaped}%"] * 3 + [q])
    return " AND ".join(clauses), values


_JOIN = (" FROM documents ar LEFT JOIN documents a ON a.id=json_extract(ar.data,'$.analysis_id') AND a.kind='analysis' AND a.owner_id=ar.owner_id "
         "LEFT JOIN users u ON u.id=ar.owner_id WHERE ")


@router.get("")
def archive_list(request: Request, response: Response, user: Annotated[dict[str, Any], Depends(require_super_admin)],
                 owner_id: str | None = None, date_from: str | None = None, date_to: str | None = None,
                 status: str | None = None, q: str | None = Query(None, max_length=200),
                 source: Literal["analysis", "supplemental"] | None = None,
                 limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0)):
    store = get_store(request)
    remaining = ensure_legacy_archive(store, user["id"])
    where, parameters = _filters(owner_id, date_from, date_to, status, q, source)
    with store.connection() as conn:
        total = conn.execute("SELECT COUNT(*)" + _JOIN + where, parameters).fetchone()[0]
        rows = conn.execute("SELECT ar.*" + _JOIN + where + " ORDER BY json_extract(ar.data,'$.examined_at') DESC,ar.id DESC LIMIT ? OFFSET ?", [*parameters, limit, offset]).fetchall()
        items = [_summary(store, {**dict(row), "data": json.loads(row["data"])}, conn=conn) for row in rows]
    response.headers["Cache-Control"] = "private, no-store"
    return {"items": items, "total": total, "limit": limit, "offset": offset, "backfill_remaining": remaining}


@router.get("/accounts")
def archive_accounts(request: Request, response: Response, user: Annotated[dict[str, Any], Depends(require_super_admin)]):
    store = get_store(request)
    remaining = ensure_legacy_archive(store, user["id"])
    with store.connection() as conn:
        rows = conn.execute("SELECT u.id,u.username,u.full_name,COUNT(ar.id) AS image_count FROM users u JOIN documents ar ON ar.owner_id=u.id AND ar.kind='admin_image' AND ar.deleted_at IS NULL GROUP BY u.id ORDER BY COALESCE(u.full_name,u.username),u.id").fetchall()
    response.headers["Cache-Control"] = "private, no-store"
    return {"items": [dict(row) for row in rows], "backfill_remaining": remaining}


@router.get("/days")
def archive_days(request: Request, response: Response, user: Annotated[dict[str, Any], Depends(require_super_admin)],
                 owner_id: str | None = None, date_from: str | None = None, date_to: str | None = None,
                 limit: int = Query(31, ge=1, le=100), offset: int = Query(0, ge=0)):
    store = get_store(request)
    remaining = ensure_legacy_archive(store, user["id"])
    where, parameters = _filters(owner_id, date_from, date_to, None, None, None)
    day = "date(json_extract(ar.data,'$.examined_at'),'+7 hours')"
    with store.connection() as conn:
        total = conn.execute(f"SELECT COUNT(DISTINCT {day})" + _JOIN + where, parameters).fetchone()[0]
        rows = conn.execute(f"SELECT {day} AS date,COUNT(*) AS image_count,COUNT(DISTINCT ar.owner_id) AS account_count" + _JOIN + where + f" GROUP BY {day} ORDER BY {day} DESC LIMIT ? OFFSET ?", [*parameters, limit, offset]).fetchall()
    response.headers["Cache-Control"] = "private, no-store"
    return {"items": [dict(row) for row in rows], "total": total, "limit": limit, "offset": offset, "backfill_remaining": remaining}


def _get_archive(store: PlatformStore, identifier: str, actor_id: str):
    archive = store.get_document(ARCHIVE_KIND, identifier)
    if archive is None:
        ensure_legacy_archive(store, actor_id)
        archive = store.get_document(ARCHIVE_KIND, identifier)
    if archive is None:
        raise HTTPException(404, "ไม่พบภาพในคลังผู้ดูแล")
    return archive


@router.get("/{identifier}/image")
def archive_image(identifier: str, request: Request, user: Annotated[dict[str, Any], Depends(require_super_admin)]):
    store = get_store(request)
    archive = _get_archive(store, identifier, user["id"])
    return FileResponse(archive_image_path(store, archive), media_type="image/png", headers={
        "Cache-Control": "private, no-store", "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff",
    })


@router.get("/{identifier}")
def archive_detail(identifier: str, request: Request, response: Response,
                   user: Annotated[dict[str, Any], Depends(require_super_admin)]):
    from .analyses import present_analysis
    from .reviews import _present_referral
    store = get_store(request)
    archive = _get_archive(store, identifier, user["id"])
    analysis = _analysis(store, archive)
    reviews, referrals = [], []
    if analysis:
        with store.connection() as conn:
            rows = conn.execute("SELECT * FROM documents WHERE kind='review' AND owner_id=? AND json_extract(data,'$.analysis_id')=? ORDER BY created_at DESC,rowid DESC", (analysis["owner_id"], analysis["id"])).fetchall()
            reviews = [flatten_document({**dict(row), "data": json.loads(row["data"])}) for row in rows]
            rows = conn.execute("SELECT * FROM documents WHERE kind='referral' AND owner_id=? AND json_extract(data,'$.analysis_id')=? ORDER BY created_at DESC,rowid DESC", (analysis["owner_id"], analysis["id"])).fetchall()
            for row in rows:
                referral = {**dict(row), "data": json.loads(row["data"])}
                presented = _present_referral(store, referral, analysis, conn=conn)
                messages = conn.execute("SELECT * FROM documents WHERE kind='referral_message' AND owner_id=? AND json_extract(data,'$.referral_id')=? ORDER BY created_at,rowid", (analysis["owner_id"], referral["id"])).fetchall()
                presented["messages"] = [flatten_document({**dict(item), "data": json.loads(item["data"])}) for item in messages]
                attachments = conn.execute("SELECT * FROM documents WHERE kind='referral_attachment' AND owner_id=? AND json_extract(data,'$.referral_id')=? ORDER BY created_at,rowid", (analysis["owner_id"], referral["id"])).fetchall()
                presented["attachments"] = [{**flatten_document({**dict(item), "data": json.loads(item["data"])}), "archive_id": _identifier(item["id"])} for item in attachments]
                for item in presented["attachments"]:
                    item.pop("image_filename", None)
                    item["archive_image_id"] = item["archive_id"]
                referrals.append(presented)
    response.headers["Cache-Control"] = "private, no-store"
    snapshot = archive["data"].get("analysis_snapshot")
    if not analysis and snapshot:
        snapshot = {**snapshot, "owner_id": archive["owner_id"], "latest_review": None,
                    "image_url": f"/api/platform/admin/image-archive/{archive['id']}/image"}
    return {**_summary(store, archive), "analysis": present_analysis(store, analysis) if analysis else snapshot,
            "reviews": reviews, "referrals": referrals, "quality": archive["data"].get("quality")}

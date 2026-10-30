"""Authenticated, durable analysis records with private images and immutable predictions."""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
import threading
import time
import uuid
from collections import Counter
from datetime import datetime, time as daytime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from backend.images import decode_image, read_upload
from backend.model import ModelNotReadyError
from .auth import assert_access, get_store, require_roles, require_user
from .quality import assess_quality, configured_confidence, enforce_quality, image_work_slot
from .store import PlatformStore, flatten_document, utc_now

router = APIRouter(prefix="/api/platform", tags=["Persisted analyses"])
logger = logging.getLogger(__name__)
_CODE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
_IMAGE_ID = re.compile(r"^[a-f0-9]{32}$")
THAI_TIME = timezone(timedelta(hours=7))


class _AnalysisLimiter:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.attempts: dict[str, list[float]] = {}

    def check(self, actor_id: str) -> None:
        now = time.monotonic()
        with self.lock:
            self.attempts = {key: values for key, values in self.attempts.items() if values and now - values[-1] < 60}
            values = [value for value in self.attempts.get(actor_id, []) if now - value < 60]
            if len(values) >= 12:
                raise HTTPException(429, "คำขอตรวจภาพถี่เกินไป โปรดลองอีกครั้งในหนึ่งนาที", headers={"Retry-After": "60"})
            self.attempts[actor_id] = [*values, now]


_limiter = _AnalysisLimiter()


def _date_bound(value: str, *, end: bool = False) -> str:
    try:
        if len(value) == 10:
            day = datetime.fromisoformat(value).date()
            result = datetime.combine(day, daytime.max if end else daytime.min, tzinfo=THAI_TIME)
        else:
            result = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if result.tzinfo is None:
                result = result.replace(tzinfo=THAI_TIME)
        return result.astimezone(timezone.utc).isoformat()
    except (ValueError, TypeError, OverflowError):
        raise HTTPException(422, "รูปแบบวันที่ไม่ถูกต้อง ใช้ YYYY-MM-DD หรือ ISO 8601") from None


def analysis_filter_sql(user: dict[str, Any], filters: dict[str, Any] | None = None, alias: str = "d") -> tuple[str, list[Any]]:
    if not re.fullmatch(r"[a-z][a-z0-9_]*", alias):
        raise ValueError("Invalid internal SQL alias")
    supplied = filters or {}
    clauses, parameters = [f"{alias}.kind='analysis'", f"{alias}.deleted_at IS NULL"], []
    if user["role"] not in {"admin", "reviewer"}:
        clauses.append(f"{alias}.owner_id=?")
        parameters.append(user["id"])
    for key in ("status", "review_status", "model_version", "site_code"):
        value = supplied.get(key)
        if value:
            if not isinstance(value, str) or len(value) > 160:
                raise HTTPException(422, "ตัวกรองไม่ถูกต้อง")
            clauses.append(f"json_extract({alias}.data,'$.{key}')=?")
            parameters.append(value)
    analysis_id = supplied.get("analysis_id")
    if analysis_id:
        clauses.append(f"{alias}.id=?")
        parameters.append(str(analysis_id)[:100])
    q = supplied.get("q")
    if q:
        query = str(q)[:100].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        clauses.append(f"({alias}.id LIKE ? ESCAPE '\\' OR json_extract({alias}.data,'$.sample_code') LIKE ? ESCAPE '\\')")
        parameters.extend([f"%{query}%", f"%{query}%"])
    label = supplied.get("predicted_class")
    if label:
        clauses.append(f"EXISTS (SELECT 1 FROM json_each({alias}.data,'$.detections') p WHERE json_extract(p.value,'$.label')=?)")
        parameters.append(str(label)[:160])
    start, end = supplied.get("start_date") or supplied.get("date_from"), supplied.get("end_date") or supplied.get("date_to")
    if start:
        clauses.append(f"julianday({alias}.created_at)>=julianday(?)")
        parameters.append(_date_bound(start))
    if end:
        clauses.append(f"julianday({alias}.created_at)<=julianday(?)")
        parameters.append(_date_bound(end, end=True))
    if start and end and datetime.fromisoformat(_date_bound(start)) > datetime.fromisoformat(_date_bound(end, end=True)):
        raise HTTPException(422, "วันเริ่มต้นต้องไม่อยู่หลังวันสิ้นสุด")
    return " AND ".join(clauses), parameters


def list_analysis_documents(store: PlatformStore, user: dict[str, Any], filters: dict[str, Any] | None = None, limit: int = 50, offset: int = 0) -> tuple[list[dict[str, Any]], int]:
    where, params = analysis_filter_sql(user, filters)
    with store.connection() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM documents d WHERE {where}", params).fetchone()[0]
        rows = conn.execute(f"SELECT d.* FROM documents d WHERE {where} ORDER BY d.created_at DESC,d.id DESC LIMIT ? OFFSET ?", [*params, limit, offset]).fetchall()
    return [{**dict(row), "data": json.loads(row["data"])} for row in rows], total


def get_analysis(store: PlatformStore, analysis_id: str, user: dict[str, Any], *, conn=None) -> dict[str, Any]:
    document = store.get_document("analysis", analysis_id, conn=conn)
    if document is None:
        raise HTTPException(404, "ไม่พบผลวิเคราะห์นี้ หรือรายการถูกนำออกแล้ว")
    assert_access(user, document)
    return document


def effective_counts(analysis: dict[str, Any], review: dict[str, Any] | None = None) -> dict[str, Any]:
    data = analysis.get("data", analysis)
    review_data = (review or {}).get("data", review or {})
    detections = data.get("detections", [])
    annotations = review_data.get("annotations", [])
    predicted = Counter(str(item["label"]) for item in detections)
    confirmed: Counter[str] = Counter()
    reviewed_ids: set[str] = set()
    uncertain = false_positive = missed = 0
    for annotation in annotations:
        if annotation.get("detection_id") is not None:
            reviewed_ids.add(str(annotation["detection_id"]))
        action = annotation.get("action")
        if action in {"confirm", "correct", "missed"} and annotation.get("label"):
            confirmed[str(annotation["label"])] += 1
        if action in {"uncertain", "request_review"}:
            uncertain += 1
        if action == "false_positive":
            false_positive += 1
        if action == "missed":
            missed += 1
    threshold = data.get("review_confidence_threshold", .5)
    uncertain += sum(1 for item in detections if str(item["id"]) not in reviewed_ids and float(item["confidence"]) < threshold)
    return {"predicted_total": len(detections), "by_predicted_class": dict(predicted), "confirmed_total": sum(confirmed.values()), "by_confirmed_class": dict(confirmed), "uncertain_total": uncertain, "reviewed_original_objects": len(reviewed_ids), "unreviewed_original_objects": max(0, len(detections) - len(reviewed_ids)), "false_positive_total": false_positive, "missed_detection_total": missed}


def present_analysis(store: PlatformStore, document: dict[str, Any]) -> dict[str, Any]:
    result = flatten_document(document)
    result.pop("image_filename", None)
    review_id = document["data"].get("latest_review_id")
    review = store.get_document("review", review_id) if review_id else None
    result["latest_review"] = flatten_document(review) if review else None
    result["counts"] = effective_counts(document, review)
    result["image_url"] = f"/api/platform/analyses/{document['id']}/image" if document["data"].get("image_filename") else None
    result["epg"] = {"available": False, "value": None, "reason": "จำนวนวัตถุในภาพทั่วไปใช้คำนวณ eggs per gram ไม่ได้ ต้องมีวิธีตรวจ มวลตัวอย่าง โปรโตคอลนับ และค่าการแปลงที่ผ่านการตรวจสอบ"}
    result["notice"] = "ผล AI ต้องได้รับการตรวจสอบโดยผู้เชี่ยวชาญ ไม่ใช้จำนวนวัตถุหรือ model confidence สรุปการติดเชื้อหรือความรุนแรง"
    return result


def analysis_image_path(store: PlatformStore, document: dict[str, Any]) -> Path:
    image_id = document["id"]
    filename = document["data"].get("image_filename")
    if not _IMAGE_ID.fullmatch(image_id) or filename != f"{image_id}.png" or store.image_dir is None:
        raise HTTPException(410, "ไม่มีไฟล์ภาพที่เก็บไว้สำหรับรายการนี้")
    path = store.image_dir / filename
    if path.is_symlink() or not path.is_file():
        raise HTTPException(410, "ไฟล์ภาพถูกนำออกตามนโยบายการเก็บรักษา")
    return path


def _save_image(image, path: Path) -> None:
    temporary = path.with_suffix(".tmp")
    try:
        image.info.clear()
        image.getexif().clear()
        with temporary.open("xb") as target:
            os.chmod(temporary, 0o600)
            image.save(target, format="PNG", exif=b"", pnginfo=None, icc_profile=None)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _review_threshold() -> float:
    return configured_confidence("HELPMINTHS_REVIEW_CONFIDENCE", .5)


@router.post("/analyses", status_code=201)
async def create_analysis(
    request: Request,
    user: Annotated[dict[str, Any], Depends(require_roles("admin", "reviewer", "lab"))],
    image: Annotated[UploadFile, File()],
    sample_code: Annotated[str, Form(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")],
    site_code: Annotated[str, Form(max_length=40, pattern=r"^[A-Za-z0-9_-]*$")] = "",
    confidence: Annotated[float | None, Form(ge=.01, le=.99)] = None,
    acknowledge_quality: Annotated[bool, Form()] = False,
    quality_comment: Annotated[str, Form(max_length=1000)] = "",
) -> dict[str, Any]:
    store = get_store(request)
    _limiter.check(user["id"])
    model = request.app.state.model_service
    confidence = confidence if confidence is not None else configured_confidence("HELPMINTHS_CONFIDENCE_THRESHOLD", .15)
    started = time.perf_counter()
    document = None
    decoded = None
    try:
        with image_work_slot():
            decoded = await run_in_threadpool(decode_image, await read_upload(image))
            quality = await run_in_threadpool(assess_quality, decoded)
            try:
                enforce_quality(quality, acknowledge_quality, quality_comment)
            except HTTPException:
                store.create_document("quality_assessment", {"quality": quality, "sample_code": sample_code, "site_code": site_code, "accepted": False, "analysis_id": None}, user["id"], user["id"])
                raise
            analysis_id = uuid.uuid4().hex
            store.create_document("quality_assessment", {"quality": quality, "sample_code": sample_code, "site_code": site_code, "accepted": True, "analysis_id": analysis_id}, user["id"], user["id"])
            metadata = getattr(model, "metadata", None)
            metadata = metadata if isinstance(metadata, dict) else {}
            version = getattr(model, "version", None)
            data = {"status": "processing", "sample_code": sample_code, "site_code": site_code, "filename": f"microscopy-{analysis_id[:8]}.png", "width": decoded.width, "height": decoded.height, "image_filename": f"{analysis_id}.png", "quality": quality, "quality_acknowledged": bool(acknowledge_quality), "quality_comment": quality_comment.strip(), "confidence_threshold": confidence, "review_confidence_threshold": _review_threshold(), "model": model.name, "model_version": str(version) if version else None, "model_metadata": metadata, "duration_ms": None, "total_duration_ms": None, "detections": [], "review_status": "not_available", "latest_review_id": None, "error_code": None, "error_message": None, "inference_started_at": None}
            assert store.image_dir is not None
            path = store.image_dir / f"{analysis_id}.png"
            try:
                await run_in_threadpool(_save_image, decoded, path)
            except OSError:
                raise HTTPException(503, "พื้นที่เก็บภาพส่วนตัวไม่พร้อมใช้งาน กรุณาตรวจการตั้งค่าพื้นที่จัดเก็บ") from None
            try:
                document = store.create_document("analysis", data, user["id"], user["id"], document_id=analysis_id)
            except BaseException:
                path.unlink(missing_ok=True)
                raise
            if not model.ready:
                data.update(status="failed", error_code="model_not_configured", error_message="ยังไม่ได้เชื่อมต่อโมเดลที่พร้อมตรวจจริง", total_duration_ms=round((time.perf_counter() - started) * 1000))
                document = store.update_document("analysis", analysis_id, data, user["id"], expected_revision=document["revision"])
                raise HTTPException(503, {"code": "model_not_configured", "message": "ยังไม่ได้เชื่อมต่อโมเดลที่พร้อมตรวจจริง", "analysis_id": analysis_id})
            data["inference_started_at"] = utc_now()
            inference_started = time.perf_counter()
            try:
                detections = await run_in_threadpool(model.predict, decoded, confidence)
            except Exception:
                data.update(status="failed", error_code="inference_failed", error_message="ประมวลผลภาพไม่สำเร็จ โปรดตรวจโมเดลและลองใหม่", duration_ms=round((time.perf_counter() - inference_started) * 1000), total_duration_ms=round((time.perf_counter() - started) * 1000))
                store.update_document("analysis", analysis_id, data, user["id"], expected_revision=document["revision"])
                logger.warning("Persisted image inference failed")
                raise HTTPException(500, {"code": "inference_failed", "message": data["error_message"], "analysis_id": analysis_id}) from None
            data.update(status="completed", detections=detections, duration_ms=round((time.perf_counter() - inference_started) * 1000), total_duration_ms=round((time.perf_counter() - started) * 1000), review_status="pending")
            document = store.update_document("analysis", analysis_id, data, user["id"], expected_revision=document["revision"])
            return present_analysis(store, document)
    except asyncio.CancelledError:
        if document is not None and document["data"].get("status") == "processing":
            cancelled = {**document["data"], "status": "cancelled", "error_code": "request_cancelled", "error_message": "คำขอสิ้นสุดก่อนส่งผลกลับ การยกเลิกคำขอไม่รับประกันว่าการคำนวณในโมเดลหยุดทันที", "total_duration_ms": round((time.perf_counter() - started) * 1000)}
            store.update_document("analysis", document["id"], cancelled, user["id"], expected_revision=document["revision"])
        raise
    finally:
        if decoded is not None:
            decoded.close()
        await image.close()


@router.get("/analyses")
def analysis_list(request: Request, user: Annotated[dict[str, Any], Depends(require_user)], limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0), analysis_id: str | None = Query(None, max_length=100), q: str | None = Query(None, max_length=100), start_date: str | None = Query(None, max_length=40), end_date: str | None = Query(None, max_length=40), date_from: str | None = Query(None, max_length=40), date_to: str | None = Query(None, max_length=40), predicted_class: str | None = Query(None, max_length=160), status: str | None = Query(None, max_length=40), review_status: str | None = Query(None, max_length=40), model_version: str | None = Query(None, max_length=160), site_code: str | None = Query(None, max_length=40)) -> dict[str, Any]:
    store = get_store(request)
    filters = {key: value for key, value in locals().items() if key in {"analysis_id", "q", "start_date", "end_date", "date_from", "date_to", "predicted_class", "status", "review_status", "model_version", "site_code"} and value is not None}
    documents, total = list_analysis_documents(store, user, filters, limit, offset)
    return {"items": [present_analysis(store, item) for item in documents], "total": total, "limit": limit, "offset": offset}


@router.get("/analyses/{analysis_id}")
def analysis_detail(analysis_id: str, request: Request, user: Annotated[dict[str, Any], Depends(require_user)]) -> dict[str, Any]:
    store = get_store(request)
    return present_analysis(store, get_analysis(store, analysis_id, user))


@router.get("/analyses/{analysis_id}/image")
def analysis_image(analysis_id: str, request: Request, user: Annotated[dict[str, Any], Depends(require_user)]):
    store = get_store(request)
    document = get_analysis(store, analysis_id, user)
    return FileResponse(analysis_image_path(store, document), media_type="image/png", filename=f"{analysis_id}.png", headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline"})


@router.delete("/analyses/{analysis_id}")
def delete_analysis(analysis_id: str, request: Request, user: Annotated[dict[str, Any], Depends(require_user)], expected_revision: int = Query(..., ge=1)) -> dict[str, Any]:
    store = get_store(request)
    with store.transaction() as conn:
        document = get_analysis(store, analysis_id, user, conn=conn)
        if user["role"] != "admin" and document["owner_id"] != user["id"]:
            raise HTTPException(403, "เฉพาะเจ้าของรายการหรือผู้ดูแลจึงจะนำภาพออกได้")
        if document["revision"] != expected_revision:
            raise HTTPException(409, "ผลนี้เปลี่ยนไปแล้ว กรุณาโหลดผลล่าสุดก่อนนำรายการออก")
        if document["data"]["status"] == "processing":
            raise HTTPException(409, "รอให้การประมวลผลสิ้นสุดก่อนนำรายการออก")
        path = None
        try:
            path = analysis_image_path(store, document)
        except HTTPException as exc:
            if exc.status_code != 410:
                raise
        # Delete bytes before committing the tombstone; if this fails no deletion is claimed.
        if path is not None:
            try:
                path.unlink()
            except OSError:
                raise HTTPException(500, "นำไฟล์ภาพออกไม่สำเร็จ กรุณาลองอีกครั้ง") from None
        store.soft_delete_document("analysis", analysis_id, user["id"], expected_revision, conn=conn)
    return {"id": analysis_id, "status": "deleted", "image_removed": True, "audit_retained": True}


@router.get("/analyses/{analysis_id}/audit")
def analysis_audit(analysis_id: str, request: Request, user: Annotated[dict[str, Any], Depends(require_user)], limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0)) -> dict[str, Any]:
    store = get_store(request)
    document = store.get_document("analysis", analysis_id, include_deleted=True)
    if document is None:
        raise HTTPException(404, "ไม่พบประวัติรายการนี้")
    assert_access(user, document)
    items = store.list_audit("analysis", analysis_id, limit=limit, offset=offset)
    with store.connection() as conn:
        total = conn.execute("SELECT COUNT(*) FROM audit_logs WHERE kind='analysis' AND document_id=?", (analysis_id,)).fetchone()[0]
    return {"items": items, "total": total, "limit": limit, "offset": offset}

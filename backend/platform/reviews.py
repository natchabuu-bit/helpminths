"""Expert review snapshots never overwrite the original model detections."""
from __future__ import annotations

import json
import math
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from backend.images import decode_image, read_upload
from .analyses import _date_bound, _limiter, _save_image, analysis_image_path, effective_counts, get_analysis, present_analysis
from .auth import get_store, require_expert_verification, require_roles, require_user
from .quality import image_work_slot
from .store import PlatformStore, flatten_document, utc_now

router = APIRouter(prefix="/api/platform", tags=["Expert verification"])
Action = Literal["confirm", "correct", "correct_class", "false_positive", "missed", "missed_detection", "uncertain", "request_review"]
ReferralStatus = Literal["pending", "in_review", "needs_more", "confirmed"]
OPEN_REFERRAL_STATUSES = ("pending", "in_review", "needs_more")
MAX_REFERRAL_ATTACHMENTS = 50


class ReferralRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=4000)


class ReferralResponseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=1)
    action: Literal["reply", "request_more"]
    comment: str = Field(min_length=1, max_length=4000)


class ReviewAnnotation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    detection_id: str | None = Field(default=None, max_length=100)
    action: Action
    label: str | None = Field(default=None, max_length=160)
    bbox: tuple[float, float, float, float] | None = None
    comment: str = Field(default="", max_length=2000)


class ReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    expected_revision: int = Field(ge=1)
    full_image_reviewed: bool = False
    status: Literal["in_review", "verified", "needs_additional_review"] = "in_review"
    comment: str = Field(default="", max_length=4000, validation_alias=AliasChoices("comment", "comments"))
    annotations: list[ReviewAnnotation] = Field(max_length=2000)


def _box(box: tuple[float, float, float, float] | list[float], width: int, height: int) -> list[float]:
    if len(box) != 4 or not all(math.isfinite(number) for number in box):
        raise HTTPException(422, "พิกัดกรอบต้องเป็นตัวเลขที่ใช้ได้สี่ค่า")
    x1, y1, x2, y2 = box
    if not (0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height):
        raise HTTPException(422, "กรอบต้องมีพื้นที่และอยู่ภายในขอบภาพ")
    return [round(number, 3) for number in box]


def validate_annotations(data: dict[str, Any], request: ReviewRequest) -> list[dict[str, Any]]:
    originals = {str(item["id"]): item for item in data["detections"]}
    reviewed: set[str] = set()
    result = []
    for item in request.annotations:
        action = {"correct_class": "correct", "missed_detection": "missed"}.get(item.action, item.action)
        label = item.label.strip() if item.label else None
        comment = item.comment.strip()
        if action != "confirm" and not (comment or request.comment.strip()):
            raise HTTPException(422, "ระบุข้อสังเกตหรือเหตุผลสำหรับผลที่แก้ไขหรือยังไม่แน่ใจ")
        if action == "missed":
            if item.detection_id is not None or not label or item.bbox is None:
                raise HTTPException(422, "ตำแหน่งที่ AI ตกหล่นต้องมีชื่อชนิดและกรอบใหม่ โดยไม่ใช้รหัสผลตรวจเดิม")
            original = None
            bounds = _box(item.bbox, data["width"], data["height"])
        else:
            if item.detection_id is None or item.detection_id not in originals or item.detection_id in reviewed:
                raise HTTPException(422, "รหัสวัตถุต้องเป็นผลตรวจเดิมและห้ามซ้ำในรายการตรวจทาน")
            reviewed.add(item.detection_id)
            original = originals[item.detection_id]
            bounds = _box(item.bbox if item.bbox is not None else original["bbox"], data["width"], data["height"])
            if action == "confirm":
                if label is not None and label != original["label"]:
                    raise HTTPException(422, "การยืนยันต้องคงชื่อเดิม หากแก้ชนิดให้เลือก Correct predicted class")
                if item.bbox is not None and list(item.bbox) != original["bbox"]:
                    raise HTTPException(422, "การยืนยันต้องคงกรอบเดิม หากแก้กรอบให้ใช้ Correct predicted class")
                label = original["label"]
            elif action == "correct":
                if not label:
                    raise HTTPException(422, "ระบุชื่อชนิดที่ผู้เชี่ยวชาญแก้ไข")
                if label == original["label"] and bounds == [round(float(value), 3) for value in original["bbox"]]:
                    raise HTTPException(422, "ชนิดและกรอบยังเหมือนเดิม โปรดเลือกยืนยันผลแทนการแก้ไข")
            elif action in {"uncertain", "request_review"}:
                label = label or original["label"]
            elif action == "false_positive":
                label = None
        result.append({"id": uuid.uuid4().hex, "detection_id": item.detection_id, "action": action, "label": label, "bbox": bounds, "comment": comment, "original_prediction": dict(original) if original else None})
    if request.status == "verified":
        if not request.full_image_reviewed:
            raise HTTPException(422, "ยืนยันว่าตรวจครบทั้งภาพ รวมถึงวัตถุที่อาจตกหล่น ก่อนยืนยันผล")
        if reviewed != set(originals):
            raise HTTPException(422, "ต้องตรวจวัตถุเดิมครบทุกตำแหน่งก่อนยืนยันผลทั้งภาพ")
        if any(item["action"] in {"uncertain", "request_review"} for item in result):
            raise HTTPException(422, "ยังมีรายการไม่แน่ใจหรือรอตรวจเพิ่ม จึงยืนยันผลทั้งภาพไม่ได้")
    return result


@router.post("/analyses/{analysis_id}/reviews", status_code=201)
def save_review(analysis_id: str, body: ReviewRequest, request: Request, user: Annotated[dict[str, Any], Depends(require_expert_verification)]) -> dict[str, Any]:
    store = get_store(request)
    # A full snapshot with a revision guard makes simultaneous reviews explicit.
    with store.transaction() as conn:
        analysis = get_analysis(store, analysis_id, user, conn=conn)
        if analysis["revision"] != body.expected_revision:
            raise HTTPException(409, "ผลนี้เปลี่ยนไปแล้ว กรุณาโหลดผลล่าสุดก่อนตรวจทานต่อ")
        data = analysis["data"]
        if data.get("status") != "completed":
            raise HTTPException(409, "ตรวจทานได้เฉพาะผลวิเคราะห์ที่ประมวลผลสำเร็จ")
        annotations = validate_annotations(data, body)
        status = body.status
        if status == "in_review" and any(item["action"] == "request_review" for item in annotations):
            status = "needs_additional_review"
        review = store.create_document("review", {"analysis_id": analysis_id, "analysis_revision": analysis["revision"], "reviewer_id": user["id"], "reviewer_username": user["username"], "reviewed_at": utc_now(), "model_version": data.get("model_version"), "status": status, "full_image_reviewed": body.full_image_reviewed, "comment": body.comment.strip(), "annotations": annotations, "previous_review_id": data.get("latest_review_id")}, analysis["owner_id"], user["id"], conn=conn)
        updated = {**data, "review_status": status, "latest_review_id": review["id"]}
        referral_id = data.get("referral_id")
        if referral_id:
            referral = store.get_document("referral", referral_id, conn=conn)
            if referral is None or referral["data"].get("analysis_id") != analysis_id or referral["owner_id"] != analysis["owner_id"]:
                raise HTTPException(409, "รายการส่งต่อนี้ไม่ตรงกับผลวิเคราะห์ กรุณาโหลดข้อมูลล่าสุด")
            referral_status = {"verified": "confirmed", "in_review": "in_review", "needs_additional_review": "needs_more"}[status]
            response_data = {**referral["data"], "status": referral_status,
                             "reviewer_id": user["id"], "reviewer_username": user["username"],
                             "response_comment": body.comment.strip(), "responded_at": utc_now(),
                             "latest_review_id": review["id"]}
            store.update_document("referral", referral_id, response_data, user["id"], expected_revision=referral["revision"], conn=conn)
            _append_referral_message(store, referral, user,
                                     "confirmed" if status == "verified" else "request_more" if status == "needs_additional_review" else "review",
                                     body.comment.strip(), conn=conn, review_id=review["id"], status=referral_status)
            updated["referral_status"] = referral_status
        analysis = store.update_document("analysis", analysis_id, updated, user["id"], expected_revision=body.expected_revision, conn=conn)
    return present_analysis(store, analysis)


@router.get("/analyses/{analysis_id}/reviews")
def review_history(analysis_id: str, request: Request, user: Annotated[dict[str, Any], Depends(require_user)], limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0)) -> dict[str, Any]:
    store = get_store(request)
    get_analysis(store, analysis_id, user)
    with store.connection() as conn:
        total = conn.execute("SELECT COUNT(*) FROM documents WHERE kind='review' AND deleted_at IS NULL AND json_extract(data,'$.analysis_id')=?", (analysis_id,)).fetchone()[0]
        rows = conn.execute("SELECT id FROM documents WHERE kind='review' AND deleted_at IS NULL AND json_extract(data,'$.analysis_id')=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?", (analysis_id, limit, offset)).fetchall()
        items = [flatten_document(store.get_document("review", row["id"], conn=conn)) for row in rows]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


def _present_referral(store: PlatformStore, referral: dict[str, Any], analysis: dict[str, Any], *, conn=None) -> dict[str, Any]:
    """A referral points to one private image; it never creates a public copy."""
    data = analysis["data"]
    latest_review_id = data.get("latest_review_id")
    latest_review = store.get_document("review", latest_review_id, conn=conn) if latest_review_id else None
    return {**flatten_document(referral), "analysis": {
        "id": analysis["id"], "sample_code": data.get("sample_code"),
        "created_at": analysis["created_at"], "revision": analysis["revision"],
        "status": data.get("status"), "review_status": data.get("review_status"),
        "image_url": f"/api/platform/analyses/{analysis['id']}/image" if data.get("image_filename") else None,
        "model_version": data.get("model_version"), "counts": effective_counts(analysis, latest_review),
    }}


def _get_referral(store: PlatformStore, referral_id: str, user: dict[str, Any], *, conn=None) -> tuple[dict[str, Any], dict[str, Any]]:
    referral = store.get_document("referral", referral_id, conn=conn)
    if referral is None:
        raise HTTPException(404, "ไม่พบรายการส่งต่อ")
    analysis = get_analysis(store, referral["data"].get("analysis_id", ""), user, conn=conn)
    if analysis["owner_id"] != referral["owner_id"]:
        raise HTTPException(404, "ไม่พบรายการส่งต่อที่เชื่อมกับผลวิเคราะห์นี้")
    # get_analysis/assert_access enforces owner or freshly verified expert access.
    return referral, analysis


def _append_referral_message(store: PlatformStore, referral: dict[str, Any], user: dict[str, Any],
                             action: str, comment: str, *, conn, **details: Any) -> dict[str, Any]:
    """Create a new conversation event; previous messages are never edited."""
    return store.create_document("referral_message", {
        "referral_id": referral["id"], "analysis_id": referral["data"]["analysis_id"],
        "action": action, "comment": comment, "author_id": user["id"],
        "author_username": user["username"], "author_role": user["role"], **details,
    }, referral["owner_id"], user["id"], conn=conn)


def _require_current_referral(referral: dict[str, Any], analysis: dict[str, Any], expected_revision: int) -> None:
    if referral["revision"] != expected_revision:
        raise HTTPException(409, "รายการส่งต่อนี้เปลี่ยนไปแล้ว กรุณาโหลดข้อมูลล่าสุด")
    if analysis["data"].get("referral_id") != referral["id"] or referral["data"].get("status") not in OPEN_REFERRAL_STATUSES:
        raise HTTPException(409, "รายการส่งต่อนี้สิ้นสุดแล้ว กรุณาโหลดข้อมูลล่าสุด")


def _present_attachment(attachment: dict[str, Any]) -> dict[str, Any]:
    result = flatten_document(attachment)
    result.pop("image_filename", None)
    result["image_url"] = f"/api/platform/referrals/{attachment['data']['referral_id']}/attachments/{attachment['id']}/image"
    return result


@router.post("/analyses/{analysis_id}/referrals", status_code=201)
def refer_analysis(analysis_id: str, body: ReferralRequest, request: Request, response: Response,
                   user: Annotated[dict[str, Any], Depends(require_roles("admin", "reviewer", "lab"))]) -> dict[str, Any]:
    store = get_store(request)
    reason = body.reason.strip()
    if not reason:
        raise HTTPException(422, "ระบุสิ่งที่ไม่มั่นใจหรือคำถามที่ต้องการให้ผู้เชี่ยวชาญตรวจ")
    with store.transaction() as conn:
        analysis = get_analysis(store, analysis_id, user, conn=conn)
        if analysis["owner_id"] != user["id"]:
            raise HTTPException(403, "ส่งต่อได้เฉพาะภาพและผลตรวจของบัญชีตนเอง")
        if analysis["data"].get("status") != "completed":
            raise HTTPException(409, "ส่งต่อได้เฉพาะผลวิเคราะห์ที่ประมวลผลสำเร็จ")
        analysis_image_path(store, analysis)
        # The write transaction serializes retries and concurrent referral clicks.
        existing = conn.execute(
            "SELECT id FROM documents WHERE kind='referral' AND deleted_at IS NULL "
            "AND json_extract(data,'$.analysis_id')=? AND json_extract(data,'$.status') IN ('pending','in_review','needs_more') "
            "ORDER BY created_at DESC,id DESC LIMIT 1", (analysis_id,)).fetchone()
        if existing:
            referral = store.get_document("referral", existing["id"], conn=conn)
            assert referral is not None
            response.status_code = 200
            return _present_referral(store, referral, analysis, conn=conn)
        if analysis["revision"] != body.expected_revision:
            raise HTTPException(409, "ผลนี้เปลี่ยนไปแล้ว กรุณาโหลดผลล่าสุดก่อนส่งต่อ")
        referral = store.create_document("referral", {
            "analysis_id": analysis_id, "analysis_revision_at_referral": analysis["revision"],
            "status": "pending", "reason": reason, "submitted_by": user["id"],
            "submitted_at": utc_now(), "reviewer_id": None, "reviewer_username": None,
            "response_comment": None, "responded_at": None, "latest_review_id": None,
        }, analysis["owner_id"], user["id"], conn=conn)
        _append_referral_message(store, referral, user, "request", reason, conn=conn, status="pending")
        analysis = store.update_document("analysis", analysis_id, {**analysis["data"], "referral_id": referral["id"],
                                                                  "referral_status": "pending"}, user["id"],
                                         expected_revision=body.expected_revision, conn=conn)
        return _present_referral(store, referral, analysis, conn=conn)


@router.get("/referrals")
def list_referrals(request: Request, user: Annotated[dict[str, Any], Depends(require_user)],
                   scope: Literal["mine", "expert"] = "mine", status: ReferralStatus | None = None,
                   state: Literal["all", "pending", "completed"] = "pending",
                   q: str | None = Query(None, max_length=100), date_from: str | None = None, date_to: str | None = None,
                   limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0)) -> dict[str, Any]:
    if scope == "expert":
        require_expert_verification(request, user)
    store = get_store(request)
    clauses = ["r.kind='referral'", "r.deleted_at IS NULL", "a.kind='analysis'", "a.deleted_at IS NULL", "a.owner_id=r.owner_id"]
    parameters: list[Any] = []
    if scope == "mine":
        clauses.append("r.owner_id=?")
        parameters.append(user["id"])
    if status:
        clauses.append("json_extract(r.data,'$.status')=?")
        parameters.append(status)
    elif state == "pending":
        clauses.append("json_extract(r.data,'$.status') IN ('pending','in_review','needs_more')")
    elif state == "completed":
        clauses.append("json_extract(r.data,'$.status')='confirmed'")
    if q:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        clauses.append("(r.id LIKE ? ESCAPE '\\' OR a.id LIKE ? ESCAPE '\\' OR json_extract(a.data,'$.sample_code') LIKE ? ESCAPE '\\')")
        parameters.extend([f"%{escaped}%"] * 3)
    start = _date_bound(date_from) if date_from else None
    end = _date_bound(date_to, end=True) if date_to else None
    if start and end and datetime.fromisoformat(start) > datetime.fromisoformat(end):
        raise HTTPException(422, "วันเริ่มต้นต้องไม่อยู่หลังวันสิ้นสุด")
    if start:
        clauses.append("julianday(r.created_at)>=julianday(?)")
        parameters.append(start)
    if end:
        clauses.append("julianday(r.created_at)<=julianday(?)")
        parameters.append(end)
    where = " AND ".join(clauses)
    joined = " FROM documents r JOIN documents a ON a.id=json_extract(r.data,'$.analysis_id') WHERE " + where
    with store.connection() as conn:
        total = conn.execute("SELECT COUNT(*)" + joined, parameters).fetchone()[0]
        rows = conn.execute("SELECT r.*" + joined + " ORDER BY r.created_at ASC,r.id ASC LIMIT ? OFFSET ?", [*parameters, limit, offset]).fetchall()
        items = []
        for row in rows:
            referral = {**dict(row), "data": json.loads(row["data"])}
            analysis = store.get_document("analysis", referral["data"]["analysis_id"], conn=conn)
            assert analysis is not None
            items.append(_present_referral(store, referral, analysis, conn=conn))
    return {"items": items, "total": total, "limit": limit, "offset": offset, "scope": scope}


@router.post("/referrals/{referral_id}/response")
def respond_to_referral(referral_id: str, body: ReferralResponseRequest, request: Request,
                        user: Annotated[dict[str, Any], Depends(require_expert_verification)]) -> dict[str, Any]:
    store = get_store(request)
    comment = body.comment.strip()
    if not comment:
        raise HTTPException(422, "ระบุข้อความตอบกลับหรือรายละเอียดภาพที่ต้องการเพิ่มเติม")
    with store.transaction() as conn:
        referral, analysis = _get_referral(store, referral_id, user, conn=conn)
        _require_current_referral(referral, analysis, body.expected_revision)
        status = "needs_more" if body.action == "request_more" else "in_review"
        referral = store.update_document("referral", referral_id, {
            **referral["data"], "status": status, "response_comment": comment,
            "reviewer_id": user["id"], "reviewer_username": user["username"], "responded_at": utc_now(),
        }, user["id"], expected_revision=body.expected_revision, conn=conn)
        _append_referral_message(store, referral, user, body.action, comment, conn=conn, status=status)
        analysis = store.update_document("analysis", analysis["id"], {
            **analysis["data"], "referral_status": status,
        }, user["id"], expected_revision=analysis["revision"], conn=conn)
        return _present_referral(store, referral, analysis, conn=conn)


@router.get("/referrals/{referral_id}/messages")
def referral_messages(referral_id: str, request: Request, response: Response,
                      user: Annotated[dict[str, Any], Depends(require_user)],
                      limit: int = Query(100, ge=1, le=100), offset: int = Query(0, ge=0)) -> dict[str, Any]:
    store = get_store(request)
    _get_referral(store, referral_id, user)
    response.headers["Cache-Control"] = "private, no-store"
    with store.connection() as conn:
        total = conn.execute("SELECT COUNT(*) FROM documents WHERE kind='referral_message' AND deleted_at IS NULL AND json_extract(data,'$.referral_id')=?", (referral_id,)).fetchone()[0]
        rows = conn.execute("SELECT * FROM documents WHERE kind='referral_message' AND deleted_at IS NULL AND json_extract(data,'$.referral_id')=? ORDER BY created_at ASC,rowid ASC LIMIT ? OFFSET ?", (referral_id, limit, offset)).fetchall()
    items = [flatten_document({**dict(row), "data": json.loads(row["data"])}) for row in rows]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.post("/referrals/{referral_id}/attachments", status_code=201)
async def upload_referral_attachment(
    referral_id: str, request: Request, response: Response,
    user: Annotated[dict[str, Any], Depends(require_roles("admin", "reviewer", "lab"))],
    image: Annotated[UploadFile, File()],
    expected_revision: Annotated[int, Form(ge=1)],
    comment: Annotated[str, Form(max_length=2000)] = "",
) -> dict[str, Any]:
    store = get_store(request)
    decoded = None
    path = None
    committed = False
    try:
        referral, analysis = _get_referral(store, referral_id, user)
        if referral["owner_id"] != user["id"]:
            raise HTTPException(403, "ส่งภาพเพิ่มเติมได้เฉพาะเจ้าของรายการส่งต่อ")
        _require_current_referral(referral, analysis, expected_revision)
        if referral["data"].get("status") != "needs_more":
            raise HTTPException(409, "ส่งภาพเพิ่มเติมได้เมื่อผู้เชี่ยวชาญร้องขอภาพเท่านั้น")
        _limiter.check(user["id"])
        with image_work_slot():
            decoded = await run_in_threadpool(decode_image, await read_upload(image))
            attachment_id = uuid.uuid4().hex
            assert store.image_dir is not None
            path = store.image_dir / f"{attachment_id}.png"
            try:
                await run_in_threadpool(_save_image, decoded, path)
            except OSError:
                raise HTTPException(503, "พื้นที่เก็บภาพส่วนตัวไม่พร้อมใช้งาน กรุณาลองอีกครั้ง") from None
            with store.transaction() as conn:
                # Image work happens outside the transaction. Recheck both guards
                # so simultaneous uploads cannot answer the same request twice.
                referral, analysis = _get_referral(store, referral_id, user, conn=conn)
                _require_current_referral(referral, analysis, expected_revision)
                if referral["data"].get("status") != "needs_more":
                    raise HTTPException(409, "รายการนี้ได้รับภาพเพิ่มเติมแล้ว กรุณาโหลดข้อมูลล่าสุด")
                total = conn.execute("SELECT COUNT(*) FROM documents WHERE kind='referral_attachment' AND deleted_at IS NULL AND json_extract(data,'$.referral_id')=?", (referral_id,)).fetchone()[0]
                if total >= MAX_REFERRAL_ATTACHMENTS:
                    raise HTTPException(409, "รายการส่งต่อนี้มีภาพเพิ่มเติมครบจำนวนที่รองรับแล้ว")
                attachment = store.create_document("referral_attachment", {
                    "referral_id": referral_id, "analysis_id": analysis["id"],
                    "image_filename": f"{attachment_id}.png", "width": decoded.width, "height": decoded.height,
                    "uploaded_by": user["id"], "uploaded_by_username": user["username"], "uploaded_at": utc_now(),
                    "comment": comment.strip(),
                }, referral["owner_id"], user["id"], document_id=attachment_id, conn=conn)
                referral = store.update_document("referral", referral_id, {
                    **referral["data"], "status": "pending", "latest_attachment_id": attachment_id,
                }, user["id"], expected_revision=expected_revision, conn=conn)
                _append_referral_message(store, referral, user, "attachment", comment.strip(),
                                         conn=conn, attachment_id=attachment_id, status="pending")
                analysis = store.update_document("analysis", analysis["id"], {
                    **analysis["data"], "referral_status": "pending",
                }, user["id"], expected_revision=analysis["revision"], conn=conn)
            committed = True
            response.headers["Cache-Control"] = "private, no-store"
            return {"attachment": _present_attachment(attachment), "referral": _present_referral(store, referral, analysis)}
    finally:
        if path is not None and not committed:
            path.unlink(missing_ok=True)
        if decoded is not None:
            decoded.close()
        await image.close()


@router.get("/referrals/{referral_id}/attachments")
def referral_attachments(referral_id: str, request: Request, response: Response,
                         user: Annotated[dict[str, Any], Depends(require_user)],
                         limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0)) -> dict[str, Any]:
    store = get_store(request)
    _get_referral(store, referral_id, user)
    response.headers["Cache-Control"] = "private, no-store"
    with store.connection() as conn:
        total = conn.execute("SELECT COUNT(*) FROM documents WHERE kind='referral_attachment' AND deleted_at IS NULL AND json_extract(data,'$.referral_id')=?", (referral_id,)).fetchone()[0]
        rows = conn.execute("SELECT * FROM documents WHERE kind='referral_attachment' AND deleted_at IS NULL AND json_extract(data,'$.referral_id')=? ORDER BY created_at ASC,rowid ASC LIMIT ? OFFSET ?", (referral_id, limit, offset)).fetchall()
    items = [_present_attachment({**dict(row), "data": json.loads(row["data"])}) for row in rows]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/referrals/{referral_id}/attachments/{attachment_id}/image")
def referral_attachment_image(referral_id: str, attachment_id: str, request: Request,
                              user: Annotated[dict[str, Any], Depends(require_user)]):
    store = get_store(request)
    referral, analysis = _get_referral(store, referral_id, user)
    attachment = store.get_document("referral_attachment", attachment_id)
    if attachment is None or attachment["owner_id"] != referral["owner_id"] or attachment["data"].get("referral_id") != referral_id or attachment["data"].get("analysis_id") != analysis["id"]:
        raise HTTPException(404, "ไม่พบภาพเพิ่มเติมในรายการส่งต่อนี้")
    return FileResponse(analysis_image_path(store, attachment), media_type="image/png", filename=f"{attachment_id}.png",
                        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline"})


@router.get("/referrals/{referral_id}")
def referral_detail(referral_id: str, request: Request, user: Annotated[dict[str, Any], Depends(require_user)]) -> dict[str, Any]:
    store = get_store(request)
    referral, analysis = _get_referral(store, referral_id, user)
    return _present_referral(store, referral, analysis)


@router.get("/analyses/{analysis_id}/referral")
def analysis_referral(analysis_id: str, request: Request, user: Annotated[dict[str, Any], Depends(require_user)]) -> dict[str, Any]:
    store = get_store(request)
    analysis = get_analysis(store, analysis_id, user)
    referral_id = analysis["data"].get("referral_id")
    if not referral_id:
        return {"referral": None}
    referral, analysis = _get_referral(store, referral_id, user)
    if analysis["id"] != analysis_id:
        raise HTTPException(404, "ไม่พบรายการส่งต่อที่เชื่อมกับผลวิเคราะห์นี้")
    return {"referral": _present_referral(store, referral, analysis)}

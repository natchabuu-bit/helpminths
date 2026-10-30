"""Expert review snapshots never overwrite the original model detections."""
from __future__ import annotations

import math
import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from .analyses import get_analysis, present_analysis
from .auth import get_store, require_roles, require_user
from .store import flatten_document, utc_now

router = APIRouter(prefix="/api/platform", tags=["Expert verification"])
Action = Literal["confirm", "correct", "correct_class", "false_positive", "missed", "missed_detection", "uncertain", "request_review"]


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
def save_review(analysis_id: str, body: ReviewRequest, request: Request, user: Annotated[dict[str, Any], Depends(require_roles("admin", "reviewer"))]) -> dict[str, Any]:
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

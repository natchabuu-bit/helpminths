"""Source-backed teaching library and explicitly approved, authenticated quizzes.

Nothing here turns Atlas source labels, user feedback or model predictions into
expert-approved learning ground truth automatically.
"""
from __future__ import annotations

import hashlib
import json
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field

from backend.platform.auth import assert_access, get_store, require_roles, require_user
from backend.platform.store import flatten_document

router = APIRouter(prefix="/api/platform/learning", tags=["Learning Lab"])
_ROOT = Path(__file__).resolve().parents[2]
_CATALOG = json.loads(Path(__file__).with_name("learning_catalog.json").read_text(encoding="utf-8"))["items"]
_REFERENCES = {item["id"]: item for item in _CATALOG}
_RANDOM = secrets.SystemRandom()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _image_path(reference: dict) -> Path:
    # Paths come only from the checked-in catalogue, never from a request URL.
    relative = reference["src"].lstrip("/")
    for base in (_ROOT / "public", _ROOT / "dist"):
        candidate = (base / relative).resolve()
        if candidate.is_relative_to(base.resolve()) and candidate.is_file():
            return candidate
    raise HTTPException(404, "ภาพอ้างอิงนี้ยังไม่มีไฟล์พร้อมใช้งาน")


def _fingerprint(reference: dict) -> str:
    digest = hashlib.sha256(json.dumps(reference, ensure_ascii=False, sort_keys=True).encode())
    digest.update(_image_path(reference).read_bytes())
    return digest.hexdigest()


def _approval(store, reference_id: str, *, conn=None) -> dict | None:
    return store.get_document("learning_approval", reference_id, conn=conn)


def _is_active(document: dict | None) -> bool:
    if not document or not document["data"].get("approved"):
        return False
    reference = _REFERENCES.get(document["id"])
    if not reference:
        return False
    try:
        return document["data"].get("source_fingerprint") == _fingerprint(reference)
    except HTTPException:
        return False


def _choices() -> list[dict]:
    entries = {}
    for reference in _CATALOG:
        entries.setdefault(reference["species_id"], {"id": reference["species_id"], "label": reference["scientific_name"], "thai_name": reference["thai_name"]})
    return list(entries.values())


@router.get("/catalog")
def catalog(request: Request):
    store = request.app.state.platform_store
    configured = bool(store.configured)
    items = []
    for reference in _CATALOG:
        approval = _approval(store, reference["id"]) if configured else None
        active = _is_active(approval)
        item = dict(reference)
        item["approval"] = None if approval is None else {
            "revision": approval["revision"], "approved": active,
            "reviewer_id": approval["data"].get("reviewer_id"),
            "reviewed_at": approval["data"].get("reviewed_at"),
            "notes": approval["data"].get("notes"),
            "status": "approved" if active else "withdrawn_or_source_changed",
        }
        items.append(item)
    return {"configured": configured, "items": items, "approved_count": sum(bool(item["approval"] and item["approval"]["approved"]) for item in items),
            "notice": "ภาพอ้างอิงอ้างชื่อจากต้นทาง ไม่ใช่การยืนยันโดยผู้เชี่ยวชาญของแอพโดยอัตโนมัติ แบบทดสอบใช้เฉพาะภาพที่มีบันทึกผู้ตรวจยืนยันแล้ว และไม่ใช่การประเมินความแม่นยำ AI หรือการสอบรับรอง"}


class StrictInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ApprovalInput(StrictInput):
    reference_id: str = Field(min_length=1, max_length=120)
    expected_revision: int | None = Field(default=None, ge=1)
    approved: bool = True
    rights_confirmed: Literal[True]
    label_reviewed: Literal[True]
    limitations_reviewed: Literal[True]
    notes: str = Field(min_length=10, max_length=2000)


@router.post("/approvals")
def approve_reference(body: ApprovalInput, request: Request, user: Annotated[dict, Depends(require_roles("admin", "reviewer"))]):
    reference = _REFERENCES.get(body.reference_id)
    if reference is None:
        raise HTTPException(404, "ไม่พบภาพอ้างอิงในคลังที่มีแหล่งที่มา")
    notes = body.notes.strip()
    if len(notes) < 10:
        raise HTTPException(422, "ระบุสิ่งที่ตรวจและข้อจำกัดของภาพอย่างน้อย 10 ตัวอักษร")
    store = get_store(request)
    data = {"reference_id": reference["id"], "species_id": reference["species_id"], "scientific_name": reference["scientific_name"],
            "approved": body.approved, "reviewer_id": user["id"], "reviewed_at": _now(), "notes": notes,
            "rights_confirmed": True, "label_reviewed": True, "limitations_reviewed": True,
            "source_fingerprint": _fingerprint(reference), "source_url": reference["source_url"], "license": reference["license"]}
    with store.transaction() as conn:
        existing = _approval(store, reference["id"], conn=conn)
        if existing:
            if body.expected_revision != existing["revision"]:
                raise HTTPException(409, "ข้อมูลภาพถูกแก้ไขแล้ว กรุณาโหลดรายการใหม่ก่อนตรวจยืนยัน")
            result = store.update_document("learning_approval", reference["id"], data, actor_id=user["id"], expected_revision=body.expected_revision, conn=conn)
        else:
            if body.expected_revision is not None:
                raise HTTPException(409, "ยังไม่มีรายการตรวจยืนยันรุ่นที่ระบุ")
            result = store.create_document("learning_approval", data, owner_id=user["id"], actor_id=user["id"], document_id=reference["id"], conn=conn)
    return flatten_document(result)


class QuizInput(StrictInput):
    mode: Literal["practice", "pretest", "posttest"] = "practice"
    question_count: int = Field(default=5, ge=1, le=10)


def _public_quiz(document: dict) -> dict:
    data = document["data"]
    return {"id": document["id"], "mode": data["mode"], "status": data["status"], "created_at": document["created_at"],
            "notice": "แบบฝึกหัดเพื่อการเรียนรู้ ภาพอ้างอิงเผยแพร่ใน Atlas อยู่แล้ว ไม่ใช่การสอบป้องกันการเปิดเฉลยหรือการประเมิน AI",
            "questions": [{"id": item["id"], "image_url": f'/api/platform/learning/quizzes/{document["id"]}/images/{item["id"]}',
                           "credit": item["credit"], "license": item["license"], "license_url": item["license_url"], "choices": item["choices"]} for item in data["questions"]]}


@router.post("/quizzes")
def create_quiz(body: QuizInput, request: Request, user: Annotated[dict, Depends(require_user)]):
    store = get_store(request)
    approvals = [item for item in store.list_documents("learning_approval", limit=200) if _is_active(item)]
    if not approvals:
        raise HTTPException(409, "ยังไม่มีภาพที่ผู้ตรวจยืนยันสำหรับแบบฝึกหัด เปิดคลังอ้างอิงเพื่อเรียนรู้ได้ก่อน")
    selected = _RANDOM.sample(approvals, min(len(approvals), body.question_count))
    questions = []
    for approval in selected:
        reference = _REFERENCES[approval["id"]]
        choices = _choices()
        _RANDOM.shuffle(choices)
        questions.append({"id": uuid.uuid4().hex, "reference_id": reference["id"], "approval_revision": approval["revision"],
                          "source_fingerprint": approval["data"]["source_fingerprint"], "correct_species_id": reference["species_id"],
                          "credit": reference["credit"], "license": reference["license"], "license_url": reference["license_url"], "choices": choices})
    result = store.create_document("learning_quiz", {"mode": body.mode, "status": "in_progress", "questions": questions}, owner_id=user["id"], actor_id=user["id"])
    return _public_quiz(result)


def _get_quiz(request: Request, quiz_id: str, user: dict, *, conn=None) -> dict:
    document = get_store(request).get_document("learning_quiz", quiz_id, conn=conn)
    if document is None:
        raise HTTPException(404, "ไม่พบชุดแบบฝึกหัด")
    assert_access(user, document)
    return document


@router.get("/quizzes/{quiz_id}")
def get_quiz(quiz_id: str, request: Request, user: Annotated[dict, Depends(require_user)]):
    return _public_quiz(_get_quiz(request, quiz_id, user))


@router.get("/quizzes/{quiz_id}/images/{question_id}")
def quiz_image(quiz_id: str, question_id: str, request: Request, user: Annotated[dict, Depends(require_user)]):
    document = _get_quiz(request, quiz_id, user)
    question = next((item for item in document["data"]["questions"] if item["id"] == question_id), None)
    if question is None:
        raise HTTPException(404, "ไม่พบภาพคำถาม")
    return FileResponse(_image_path(_REFERENCES[question["reference_id"]]), media_type="image/jpeg", headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


class AnswerInput(StrictInput):
    question_id: str = Field(min_length=1, max_length=80)
    species_id: str | None = Field(default=None, max_length=80)


class SubmitInput(StrictInput):
    answers: list[AnswerInput] = Field(min_length=1, max_length=10)


@router.post("/quizzes/{quiz_id}/submit")
def submit_quiz(quiz_id: str, body: SubmitInput, request: Request, user: Annotated[dict, Depends(require_user)]):
    store = get_store(request)
    with store.transaction() as conn:
        quiz = _get_quiz(request, quiz_id, user, conn=conn)
        if quiz["owner_id"] != user["id"]:
            raise HTTPException(403, "บันทึกคำตอบได้เฉพาะแบบฝึกหัดของตนเอง")
        if quiz["data"]["status"] != "in_progress":
            raise HTTPException(409, "แบบฝึกหัดนี้บันทึกคำตอบแล้ว ไม่บันทึกคะแนนซ้ำ")
        questions = quiz["data"]["questions"]
        answers = {answer.question_id: answer.species_id for answer in body.answers}
        if len(answers) != len(body.answers) or set(answers) != {item["id"] for item in questions}:
            raise HTTPException(422, "ตอบให้ครบทุกภาพหนึ่งครั้ง หรือเลือกว่ายังระบุไม่ได้")
        results = []
        for question in questions:
            approval = _approval(store, question["reference_id"], conn=conn)
            if not _is_active(approval) or approval["revision"] != question["approval_revision"] or approval["data"]["source_fingerprint"] != question["source_fingerprint"]:
                raise HTTPException(409, "มีการเปลี่ยนการยืนยันภาพหลังเริ่มชุดนี้ กรุณาเริ่มแบบฝึกหัดใหม่")
            answer = answers[question["id"]]
            if answer is not None and answer not in {choice["id"] for choice in question["choices"]}:
                raise HTTPException(422, "คำตอบไม่อยู่ในตัวเลือกของชุดนี้")
            reference = _REFERENCES[question["reference_id"]]
            results.append({"question_id": question["id"], "reference_id": reference["id"], "species_id": answer,
                            "correct_species_id": question["correct_species_id"], "correct": answer == question["correct_species_id"],
                            "reference": reference, "reviewer_notes": approval["data"]["notes"], "reviewer_id": approval["data"]["reviewer_id"], "approval_revision": approval["revision"]})
        correct = sum(item["correct"] for item in results)
        attempt = store.create_document("learning_attempt", {"quiz_id": quiz["id"], "mode": quiz["data"]["mode"], "correct": correct, "total": len(results),
                     "percentage_correct": round(correct / len(results) * 100, 2), "submitted_at": _now(), "results": results,
                     "notice": "คะแนนการเรียนรู้ ไม่ใช่ความแม่นยำโมเดลหรือผลวินิจฉัย"}, owner_id=user["id"], actor_id=user["id"], conn=conn)
        updated = {**quiz["data"], "status": "completed", "attempt_id": attempt["id"]}
        store.update_document("learning_quiz", quiz["id"], updated, actor_id=user["id"], expected_revision=quiz["revision"], conn=conn)
    return flatten_document(attempt)


@router.get("/attempts")
def list_attempts(request: Request, user: Annotated[dict, Depends(require_user)], limit: Annotated[int, Query(ge=1, le=100)] = 20, offset: Annotated[int, Query(ge=0)] = 0):
    store = get_store(request)
    rows = store.list_documents("learning_attempt", owner_id=user["id"], limit=limit + 1, offset=offset)
    return {"items": [flatten_document(item) for item in rows[:limit]], "limit": limit, "offset": offset, "has_more": len(rows) > limit}


@router.get("/attempts/{attempt_id}")
def get_attempt(attempt_id: str, request: Request, user: Annotated[dict, Depends(require_user)]):
    document = get_store(request).get_document("learning_attempt", attempt_id)
    if document is None:
        raise HTTPException(404, "ไม่พบผลแบบฝึกหัด")
    assert_access(user, document)
    return flatten_document(document)


@router.get("/progress")
def progress(request: Request, user: Annotated[dict, Depends(require_user)]):
    store = get_store(request)
    # SQL aggregation avoids silently truncating progress to one paginated list.
    with store.connection() as conn:
        rows = conn.execute("SELECT json_extract(data,'$.mode') AS mode, COUNT(*) AS attempts, SUM(json_extract(data,'$.correct')) AS correct, SUM(json_extract(data,'$.total')) AS total FROM documents WHERE kind='learning_attempt' AND owner_id=? AND deleted_at IS NULL GROUP BY mode", (user["id"],)).fetchall()
    modes = [{"mode": row["mode"], "attempts": row["attempts"], "correct": row["correct"], "total": row["total"], "percentage_correct": round(row["correct"] / row["total"] * 100, 2) if row["total"] else None} for row in rows]
    recent = store.list_documents("learning_attempt", owner_id=user["id"], limit=20)
    return {"attempt_count": sum(item["attempts"] for item in modes), "modes": modes, "recent": [flatten_document(item) for item in recent],
            "notice": "แสดงเฉพาะคำตอบจริงของบัญชีนี้ คะแนนนี้แยกจากความแม่นยำ YOLO และไม่ใช่การประเมินผลการเรียนแบบควบคุม"}

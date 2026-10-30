"""User feedback and explicit expert triage; never an automatic training source."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from backend.platform.auth import assert_access, get_store, require_roles, require_user
from backend.platform.store import flatten_document
from backend.platform._report_data import latest_review, review_annotations

router = APIRouter(prefix='/api/platform', tags=['Model feedback'])
Category = Literal['correct_prediction', 'incorrect_classification', 'false_positive', 'missed_detection', 'poor_image_quality', 'uncertain_result', 'technical_error', 'other']


class FeedbackInput(BaseModel):
    analysis_id: str | None = Field(default=None, max_length=100)
    object_id: str | None = Field(default=None, max_length=100)
    category: Category
    message: str = Field(min_length=1, max_length=2000)


class FeedbackTriage(BaseModel):
    expected_revision: int = Field(ge=1)
    status: Literal['in_review', 'verified_error', 'resolved', 'rejected']
    verified_category: Category | None = None
    reviewer_comment: str = Field(min_length=1, max_length=2000)


def ensure_feedback_analysis(store, analysis_id: str, user: dict) -> dict:
    from backend.platform.analyses import get_analysis
    return get_analysis(store, analysis_id, user)


@router.post('/feedback', status_code=201)
def submit_feedback(body: FeedbackInput, request: Request, user: Annotated[dict, Depends(require_user)]):
    store = get_store(request)
    message = body.message.replace('\0', '').strip()
    if not message:
        raise HTTPException(422, 'กรุณาเขียนข้อเสนอแนะ')
    if body.analysis_id:
        analysis = ensure_feedback_analysis(store, body.analysis_id, user)
        if body.object_id:
            originals = {str(item['id']) for item in analysis['data'].get('detections', [])}
            added = {str(item['id']) for item in review_annotations(latest_review(store, analysis)) if item.get('action') == 'missed'}
            if body.object_id not in originals | added:
                raise HTTPException(422, 'Object ID ไม่อยู่ในผลวิเคราะห์นี้')
    elif body.object_id or body.category not in ('technical_error', 'other'):
        raise HTTPException(422, 'ข้อเสนอแนะเกี่ยวกับผล AI ต้องเชื่อมกับ Analysis ID ที่เข้าถึงได้')
    item = store.create_document('feedback', {'analysis_id': body.analysis_id, 'object_id': body.object_id,
                 'category': body.category, 'message': message, 'status': 'pending', 'verified_category': None,
                 'reviewer_id': None, 'reviewer_comment': None, 'reviewed_at': None,
                 'training_eligible': False, 'evaluation_eligible': False}, user['id'], user['id'])
    return flatten_document(item)


@router.get('/feedback')
def feedback_list(request: Request, user: Annotated[dict, Depends(require_user)], limit: int = Query(25, ge=1, le=100),
                  offset: int = Query(0, ge=0), status: str | None = None, category: Category | None = None,
                  analysis_id: str | None = None):
    store = get_store(request)
    if analysis_id:
        ensure_feedback_analysis(store, analysis_id, user)
    where, params = ["kind='feedback'", 'deleted_at IS NULL'], []
    if user['role'] not in ('admin', 'reviewer'):
        where.append('owner_id=?'); params.append(user['id'])
    for field, value in [('status', status), ('category', category), ('analysis_id', analysis_id)]:
        if value:
            where.append(f"json_extract(data,'$.{field}')=?"); params.append(value)
    clause = ' AND '.join(where)
    with store.connection() as connection:
        total = connection.execute(f'SELECT COUNT(*) FROM documents WHERE {clause}', params).fetchone()[0]
        rows = connection.execute(f'SELECT id FROM documents WHERE {clause} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?', [*params, limit, offset]).fetchall()
    return {'items': [flatten_document(store.get_document('feedback', row['id'])) for row in rows], 'total': total, 'limit': limit, 'offset': offset}


@router.patch('/feedback/{feedback_id}')
def triage_feedback(feedback_id: str, body: FeedbackTriage, request: Request,
                    user: Annotated[dict, Depends(require_roles('admin', 'reviewer'))]):
    store = get_store(request)
    item = store.get_document('feedback', feedback_id)
    if item is None:
        raise HTTPException(404, 'ไม่พบข้อเสนอแนะ')
    assert_access(user, item)
    data = dict(item['data'])
    evidence_review_id = None
    if body.status == 'verified_error':
        if not data.get('analysis_id'):
            raise HTTPException(422, 'การยืนยันข้อผิดพลาดต้องมี Analysis ID และหลักฐานที่ระบบเก็บจริง')
        analysis = ensure_feedback_analysis(store, data['analysis_id'], user)
        category = body.verified_category or data['category']
        supported = {'incorrect_classification', 'false_positive', 'missed_detection', 'poor_image_quality', 'technical_error'}
        if category not in supported:
            raise HTTPException(422, 'ประเภทนี้ยังยืนยันเป็นข้อผิดพลาดไม่ได้ ให้ใช้สถานะกำลังตรวจหรือปิดเรื่องพร้อมเหตุผล')
        review = latest_review(store, analysis)
        if category == 'technical_error':
            if analysis['data'].get('status') != 'failed' or not analysis['data'].get('error_code'):
                raise HTTPException(422, 'ยังไม่มีสถานะประมวลผลล้มเหลวที่รองรับข้อผิดพลาดทางเทคนิค')
        elif category == 'poor_image_quality':
            if analysis['data'].get('quality', {}).get('status') != 'warning':
                raise HTTPException(422, 'ยังไม่มีผลตรวจคุณภาพภาพที่รองรับการยืนยันนี้')
        else:
            if review is None:
                raise HTTPException(422, 'กรุณาตรวจทานผลใน Expert Verification ก่อนยืนยัน feedback เป็นข้อผิดพลาด')
            required = {'incorrect_classification': 'correct', 'false_positive': 'false_positive', 'missed_detection': 'missed'}[category]
            candidates = [row for row in review_annotations(review) if not data.get('object_id') or str(row.get('detection_id') or row.get('id')) == data['object_id']]
            if category == 'incorrect_classification':
                evidence = any(row.get('action') == required and row.get('label') and row.get('label') != (row.get('original_prediction') or {}).get('label') for row in candidates)
            else:
                evidence = any(row.get('action') == required for row in candidates)
            if not evidence:
                raise HTTPException(422, 'ประเภทข้อผิดพลาดไม่ตรงกับ annotation ที่ผู้เชี่ยวชาญตรวจจริง')
        evidence_review_id = review['id'] if review else None
    data.update(status=body.status, verified_category=body.verified_category or (data['category'] if body.status == 'verified_error' else None),
                reviewer_id=user['id'], reviewer_comment=body.reviewer_comment.replace('\0', '').strip(),
                reviewed_at=datetime.now(timezone.utc).isoformat(), evidence_review_id=evidence_review_id,
                training_eligible=False, evaluation_eligible=False)
    if not data['reviewer_comment']:
        raise HTTPException(422, 'กรุณาระบุเหตุผลการตรวจ feedback')
    return flatten_document(store.update_document('feedback', feedback_id, data, user['id'], body.expected_revision))

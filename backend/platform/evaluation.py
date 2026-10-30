"""Explicit independent ground-truth evaluation, separate from operational feedback.

No benchmark is seeded. AP is 101-point interpolated over saved detections after
inference filtering, not an assertion of equivalence to an official COCO run.
"""
from __future__ import annotations

import hashlib
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from backend.platform.auth import get_store, require_roles, require_user
from backend.platform.store import flatten_document

router = APIRouter(prefix='/api/platform', tags=['Independent model evaluation'])


def intersection_over_union(first, second) -> float:
    x1, y1 = max(first[0], second[0]), max(first[1], second[1])
    x2, y2 = min(first[2], second[2]), min(first[3], second[3])
    intersection = max(0, x2 - x1) * max(0, y2 - y1)
    a = max(0, first[2] - first[0]) * max(0, first[3] - first[1])
    b = max(0, second[2] - second[0]) * max(0, second[3] - second[1])
    union = a + b - intersection
    return intersection / union if union else 0.0


def _match_class(cases: list[dict], label: str, threshold: float, confidence: float) -> tuple[list[int], list[int], int]:
    ground_truth = {case['id']: [item for item in case['ground_truth'] if item['label'] == label] for case in cases}
    total = sum(len(items) for items in ground_truth.values())
    predictions = sorted([(float(item['confidence']), case['id'], item) for case in cases for item in case['predictions']
                          if item['label'] == label and float(item['confidence']) >= confidence], key=lambda item: item[0], reverse=True)
    used = defaultdict(set)
    tp, fp = [], []
    for _, case_id, prediction in predictions:
        candidates = [(intersection_over_union(prediction['bbox'], target['bbox']), index) for index, target in enumerate(ground_truth[case_id]) if index not in used[case_id]]
        overlap, index = max(candidates, default=(0.0, -1))
        matched = index >= 0 and overlap >= threshold
        if matched:
            used[case_id].add(index)
        tp.append(int(matched)); fp.append(int(not matched))
    return tp, fp, total


def _ap(tp: list[int], fp: list[int], total: int) -> float | None:
    if not total:
        return None
    true_sum = false_sum = 0
    points = []
    for true, false in zip(tp, fp, strict=True):
        true_sum += true; false_sum += false
        points.append((true_sum / total, true_sum / (true_sum + false_sum)))
    return sum(max((precision for recall, precision in points if recall >= step / 100), default=0.0) for step in range(101)) / 101


def evaluate_detections(cases: list[dict], *, iou_threshold: float = .5, confidence_threshold: float = .15) -> dict:
    labels = sorted({item['label'] for case in cases for key in ('ground_truth', 'predictions') for item in case[key]})
    tp = fp = fn = 0
    per_class, ap50, ap_mean = [], [], []
    for label in labels:
        matched, rejected, truth_count = _match_class(cases, label, iou_threshold, confidence_threshold)
        class_tp, class_fp = sum(matched), sum(rejected)
        class_fn = truth_count - class_tp
        precision = class_tp / (class_tp + class_fp) if class_tp + class_fp else None
        recall = class_tp / truth_count if truth_count else None
        f1 = 2 * precision * recall / (precision + recall) if precision is not None and recall is not None and precision + recall else 0.0 if truth_count else None
        aps = []
        for step in range(10):
            match, reject, count = _match_class(cases, label, .5 + .05 * step, confidence_threshold)
            value = _ap(match, reject, count)
            if value is not None:
                aps.append(value)
        first = aps[0] if aps else None
        mean = sum(aps) / len(aps) if aps else None
        if first is not None:
            ap50.append(first); ap_mean.append(mean)
        per_class.append({'label': label, 'ground_truth_objects': truth_count, 'tp': class_tp, 'fp': class_fp, 'fn': class_fn,
                          'precision': precision, 'recall': recall, 'f1': f1, 'ap50': first, 'ap50_95': mean})
        tp += class_tp; fp += class_fp; fn += class_fn
    # Classification confusion uses a separate class-agnostic, one-to-one match.
    matrix = Counter()
    for case in cases:
        used = set()
        predictions = sorted((item for item in case['predictions'] if float(item['confidence']) >= confidence_threshold), key=lambda item: float(item['confidence']), reverse=True)
        for prediction in predictions:
            candidates = [(intersection_over_union(prediction['bbox'], target['bbox']), index) for index, target in enumerate(case['ground_truth']) if index not in used]
            overlap, index = max(candidates, default=(0.0, -1))
            if index >= 0 and overlap >= iou_threshold:
                used.add(index); matrix[(case['ground_truth'][index]['label'], prediction['label'])] += 1
            else:
                matrix[('background', prediction['label'])] += 1
        for index, target in enumerate(case['ground_truth']):
            if index not in used:
                matrix[(target['label'], 'background')] += 1
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = 2 * precision * recall / (precision + recall) if precision is not None and recall is not None and precision + recall else 0.0 if tp + fn else None
    return {'sample_size': len(cases), 'ground_truth_objects': tp + fn, 'predicted_objects': tp + fp, 'tp': tp, 'fp': fp, 'fn': fn,
            'precision': precision, 'recall': recall, 'sensitivity': recall, 'f1': f1,
            'map50': sum(ap50) / len(ap50) if ap50 else None, 'map50_95': sum(ap_mean) / len(ap_mean) if ap_mean else None,
            'per_class': per_class, 'confusion_matrix': [{'ground_truth': truth, 'predicted': predicted, 'count': count} for (truth, predicted), count in sorted(matrix.items())],
            'iou_threshold': iou_threshold, 'confidence_threshold': confidence_threshold, 'ap_interpolation': '101-point',
            'matching': 'one-to-one, confidence-ranked, per-class IoU; separate class-agnostic confusion matrix',
            'evaluation_basis': 'Saved model detections after inference filtering; not the official COCO evaluator',
            'maximum_recall_limited_by_saved_inference_thresholds': True}


class GroundTruth(BaseModel):
    label: str = Field(min_length=1, max_length=160)
    bbox: tuple[float, float, float, float]


class EvaluationCase(BaseModel):
    analysis_id: str = Field(min_length=1, max_length=100)
    group_code: str = Field(min_length=1, max_length=80, pattern=r'^[A-Za-z0-9_-]+$')
    ground_truth: list[GroundTruth] = Field(max_length=500)


class DatasetInput(BaseModel):
    dataset_version: str = Field(min_length=1, max_length=160)
    source: str = Field(min_length=1, max_length=2000)
    independence_method: str = Field(min_length=20, max_length=2000)
    independent: bool
    labels_reviewed: bool
    cases: list[EvaluationCase] = Field(min_length=1, max_length=200)


class RunInput(BaseModel):
    dataset_id: str = Field(min_length=1, max_length=100)
    model_version: str = Field(min_length=1, max_length=128)
    iou_threshold: float = Field(default=.5, ge=.1, le=.95)
    confidence_threshold: float = Field(default=.15, ge=0, le=1)


def _prediction_digest(detections: list) -> str:
    return hashlib.sha256(json.dumps(detections, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()).hexdigest()


@router.post('/evaluation/datasets', status_code=201)
def approve_dataset(body: DatasetInput, request: Request, user: Annotated[dict, Depends(require_roles('admin', 'reviewer'))]):
    from backend.platform.analyses import get_analysis
    if not body.independent or not body.labels_reviewed:
        raise HTTPException(422, 'ต้องยืนยันการตรวจฉลากและอธิบายการแยกชุดทดสอบอิสระก่อนสร้างชุดประเมิน')
    store = get_store(request)
    if not body.dataset_version.strip() or not body.source.strip() or len(body.independence_method.strip()) < 20:
        raise HTTPException(422, 'กรอกชื่อรุ่น แหล่งที่มา และคำอธิบายการแยกชุดทดสอบอิสระให้ครบ')
    if len({case.analysis_id for case in body.cases}) != len(body.cases):
        raise HTTPException(422, 'ห้ามนับ Analysis ID เดิมซ้ำในชุดประเมิน')
    with store.connection() as connection:
        duplicate = connection.execute("SELECT id FROM documents WHERE kind='evaluation_dataset' AND json_extract(data,'$.dataset_version')=? AND deleted_at IS NULL", (body.dataset_version.strip(),)).fetchone()
    if duplicate:
        raise HTTPException(409, 'มี dataset version นี้แล้ว ใช้รุ่นใหม่เมื่อแก้ฉลาก')
    if sum(len(case.ground_truth) for case in body.cases) > 5000:
        raise HTTPException(413, 'ชุดประเมินผ่าน API นี้รองรับ ground truth ไม่เกิน 5,000 วัตถุ โปรดแยกชุดหรือใช้ตัวประเมินภายนอก')
    cases = []
    for case in body.cases:
        analysis = get_analysis(store, case.analysis_id, user)
        data = analysis['data']
        if data.get('status') != 'completed' or not data.get('model_version'):
            raise HTTPException(422, 'ชุดประเมินต้องอ้างผลวิเคราะห์ที่สำเร็จและมี model version จริง')
        for target in case.ground_truth:
            x1, y1, x2, y2 = target.bbox
            if not all(math.isfinite(value) for value in target.bbox) or not (0 <= x1 < x2 <= data['width'] and 0 <= y1 < y2 <= data['height']) or not target.label.strip():
                raise HTTPException(422, 'กรอบ ground truth ต้องอยู่ภายในภาพและชื่อชนิดต้องไม่ว่าง')
        cases.append({'analysis_id': case.analysis_id, 'group_code': case.group_code, 'ground_truth': [target.model_dump() for target in case.ground_truth],
                      'model_version': data['model_version'], 'prediction_digest': _prediction_digest(data.get('detections', []))})
    if not any(case['ground_truth'] for case in cases):
        raise HTTPException(422, 'ชุดประเมินต้องมีวัตถุอ้างอิงอย่างน้อยหนึ่งวัตถุ ภาพลบอย่างเดียวคำนวณ recall/mAP ไม่ได้')
    record = {'dataset_version': body.dataset_version.strip(), 'source': body.source.strip(), 'independence_method': body.independence_method.strip(),
              'independent': True, 'labels_reviewed': True, 'approval_source': 'authenticated_expert_declaration',
              'approved_by': user['id'], 'approved_at': datetime.now(timezone.utc).isoformat(), 'cases': cases,
              'feedback_imported_automatically': False, 'sample_size': len(cases), 'group_count': len({case['group_code'] for case in cases})}
    return flatten_document(store.create_document('evaluation_dataset', record, user['id'], user['id']))


@router.post('/evaluation/run', status_code=201)
def run_evaluation(body: RunInput, request: Request, user: Annotated[dict, Depends(require_roles('admin', 'reviewer'))]):
    from backend.platform.analyses import get_analysis
    store = get_store(request)
    dataset = store.get_document('evaluation_dataset', body.dataset_id)
    if dataset is None:
        raise HTTPException(404, 'ไม่พบชุด ground truth ที่อนุมัติ')
    if not dataset['data'].get('independent') or not dataset['data'].get('labels_reviewed'):
        raise HTTPException(422, 'ชุดข้อมูลยังไม่ได้รับการอนุมัติสำหรับการประเมิน')
    cases, thresholds = [], set()
    for case in dataset['data']['cases']:
        analysis = get_analysis(store, case['analysis_id'], user)
        data = analysis['data']
        if data.get('status') != 'completed' or data.get('model_version') != body.model_version or case['model_version'] != body.model_version:
            raise HTTPException(422, 'ทุกภาพในรอบประเมินต้องเป็นผลที่สำเร็จจาก model version เดียวกัน')
        if _prediction_digest(data.get('detections', [])) != case['prediction_digest']:
            raise HTTPException(409, 'prediction เปลี่ยนหลังอนุมัติชุดข้อมูล ต้องสร้าง dataset version ใหม่')
        cases.append({'id': analysis['id'], 'predictions': data.get('detections', []), 'ground_truth': case['ground_truth']})
        thresholds.add(data.get('confidence_threshold', .15))
    if sum(len(case['predictions']) + len(case['ground_truth']) for case in cases) > 5000:
        raise HTTPException(413, 'รอบประเมินผ่าน API นี้รองรับ prediction และ ground truth รวมไม่เกิน 5,000 วัตถุ')
    from backend.platform.quality import image_work_slot
    with image_work_slot():
        metrics = evaluate_detections(cases, iou_threshold=body.iou_threshold, confidence_threshold=body.confidence_threshold)
    metrics['stored_inference_thresholds'] = sorted(thresholds)
    result = {'dataset_id': dataset['id'], 'dataset_version': dataset['data']['dataset_version'], 'model_version': body.model_version,
              'dataset_source': dataset['data']['source'], 'independence_method': dataset['data']['independence_method'],
              'approved_by': dataset['data']['approved_by'], 'metrics': metrics, 'sample_size': len(cases),
              'evaluated_by': user['id'], 'evaluated_at': datetime.now(timezone.utc).isoformat(),
              'ground_truth_provenance': 'explicit expert-approved independent dataset; not raw user feedback'}
    return flatten_document(store.create_document('evaluation_result', result, user['id'], user['id']))


@router.get('/evaluation')
def evaluation_status(request: Request, user: Annotated[dict, Depends(require_user)]):
    store = get_store(request)
    owner = None if user['role'] in ('admin', 'reviewer') else user['id']
    results = store.list_documents('evaluation_result', owner_id=owner, limit=1)
    if not results:
        return {'status': 'unavailable', 'message': 'Model evaluation data unavailable', 'sample_size': 0, 'metrics': None,
                'reason': 'ยังไม่มีผลประเมินจากชุด ground truth อิสระที่ผู้เชี่ยวชาญอนุมัติและคุณมีสิทธิ์เข้าถึง Feedback ไม่กลายเป็น ground truth อัตโนมัติ'}
    result = flatten_document(results[0])
    return {'status': 'available', **result, 'message': 'ผลจากชุดอ้างอิงที่ผู้มีสิทธิ์อนุมัติ ควรพิจารณาขนาดตัวอย่างและเกณฑ์การประเมินร่วมด้วย'}


@router.get('/evaluation/datasets')
def evaluation_datasets(request: Request, user: Annotated[dict, Depends(require_roles('admin', 'reviewer'))], limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0)):
    store = get_store(request)
    items = []
    for document in store.list_documents('evaluation_dataset', limit=limit, offset=offset):
        item = flatten_document(document)
        item.pop('cases', None)
        items.append(item)
    return {'items': items, 'total': store.count_documents('evaluation_dataset'), 'limit': limit, 'offset': offset}

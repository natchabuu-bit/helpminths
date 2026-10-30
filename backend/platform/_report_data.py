"""Authorized report/analytics queries. No UI samples or training assumptions."""
from __future__ import annotations

import json
from typing import Any

from backend.platform.store import flatten_document

FILTER_NAMES = ('date_from', 'date_to', 'predicted_class', 'analysis_status', 'review_status', 'model_version', 'site_code')


def analysis_query(user: dict, filters: dict[str, Any] | None = None) -> tuple[str, list[Any]]:
    # Reuse history's validated filters, including Asia/Bangkok date boundaries.
    from backend.platform.analyses import analysis_filter_sql
    supplied = dict(filters or {})
    if supplied.get('analysis_status'):
        supplied['status'] = supplied.pop('analysis_status')
    return analysis_filter_sql(user, supplied, alias='d')


def row_document(row: Any) -> dict:
    item = dict(row)
    item['data'] = json.loads(item['data']) if isinstance(item['data'], str) else item['data']
    return item


def analysis_documents(store: Any, user: dict, filters: dict | None = None, *, limit: int | None = None, offset: int = 0) -> list[dict]:
    where, parameters = analysis_query(user, filters)
    sql = f'SELECT d.* FROM documents d WHERE {where} ORDER BY d.created_at DESC, d.id DESC'
    if limit is not None:
        sql += ' LIMIT ? OFFSET ?'
        parameters.extend([max(1, min(limit, 1000)), max(0, offset)])
    with store.connection() as connection:
        rows = connection.execute(sql, parameters).fetchall()
    return [row_document(row) for row in rows]


def latest_review(store: Any, analysis: dict) -> dict | None:
    data = analysis.get('data', analysis)
    review_id = data.get('latest_review_id')
    if not review_id:
        return None
    return store.get_document('review', review_id)


def flattened_analysis(analysis: dict) -> dict:
    return flatten_document(analysis) if 'data' in analysis else analysis


def review_annotations(review: dict | None) -> list[dict]:
    return (review.get('data', review) if review else {}).get('annotations', [])


def object_rows(store: Any, analysis: dict) -> list[dict]:
    item = flattened_analysis(analysis)
    review = latest_review(store, analysis)
    review_data = review.get('data', {}) if review else {}
    annotations = review_annotations(review)
    by_id = {str(row.get('detection_id')): row for row in annotations if row.get('detection_id') is not None}
    rows = []
    for detection in item.get('detections', []):
        annotation = by_id.get(str(detection['id']), {})
        predicted_bbox = detection.get('bbox')
        reviewer_bbox = annotation.get('bbox')
        effective_bbox = reviewer_bbox if reviewer_bbox is not None else predicted_bbox
        rows.append({
            'object_id': str(detection['id']), 'origin': 'model', 'predicted_class': detection.get('label', ''),
            'confidence': detection.get('confidence'), 'predicted_bbox': predicted_bbox, 'reviewer_bbox': reviewer_bbox,
            'effective_bbox': effective_bbox, 'bbox': effective_bbox,
            'reviewer_label': annotation.get('label') or (detection.get('label', '') if annotation.get('action') == 'confirm' else ''),
            'review_action': annotation.get('action', 'unreviewed'), 'reviewer_id': review_data.get('reviewer_id', ''),
            'reviewed_at': review_data.get('reviewed_at', ''),
        })
    for annotation in annotations:
        if annotation.get('action') == 'missed':
            rows.append({'object_id': str(annotation.get('id', '')), 'origin': 'expert_added', 'predicted_class': '',
                         'confidence': None, 'predicted_bbox': None, 'reviewer_bbox': annotation.get('bbox'),
                         'effective_bbox': annotation.get('bbox'), 'bbox': annotation.get('bbox'), 'reviewer_label': annotation.get('label', ''),
                         'review_action': 'missed', 'reviewer_id': review_data.get('reviewer_id', ''), 'reviewed_at': review_data.get('reviewed_at', '')})
    return rows

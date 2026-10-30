"""Server-side aggregation of persisted, authorized results only."""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from backend.platform.auth import get_store, require_user
from backend.platform._report_data import analysis_documents, analysis_query, review_annotations, row_document

router = APIRouter(prefix='/api/platform', tags=['Platform analytics'])


def dashboard_data(store, user: dict, filters: dict | None = None) -> dict:
    filters = {key: value for key, value in (filters or {}).items() if value}
    where, parameters = analysis_query(user, filters)
    with store.connection() as connection:
        connection.execute('BEGIN')
        row = connection.execute(f'''SELECT COUNT(*) AS total,
          SUM(CASE WHEN json_extract(d.data,'$.status')='completed' THEN 1 ELSE 0 END) AS successful,
          SUM(CASE WHEN json_extract(d.data,'$.status')='failed' THEN 1 ELSE 0 END) AS failed,
          AVG(CASE WHEN json_extract(d.data,'$.status')='completed' THEN json_extract(d.data,'$.duration_ms') ELSE NULL END) AS latency
          FROM documents d WHERE {where}''', parameters).fetchone()
        predicted = connection.execute(f'''SELECT json_extract(o.value,'$.label') AS label,COUNT(*) AS count
          FROM documents d,json_each(d.data,'$.detections') o WHERE {where}
          GROUP BY json_extract(o.value,'$.label') ORDER BY count DESC,label''', parameters).fetchall()
        by_date = connection.execute(f'''SELECT date(d.created_at,'+7 hours') AS date,COUNT(*) AS count,
          SUM(CASE WHEN json_extract(d.data,'$.status')='completed' THEN 1 ELSE 0 END) AS successful,
          SUM(CASE WHEN json_extract(d.data,'$.status')='failed' THEN 1 ELSE 0 END) AS failed
          FROM documents d WHERE {where} GROUP BY date(d.created_at,'+7 hours') ORDER BY date''', parameters).fetchall()
        latency = connection.execute(f'''SELECT date(d.created_at,'+7 hours') AS date,AVG(json_extract(d.data,'$.duration_ms')) AS mean_ms,COUNT(*) AS sample_size
          FROM documents d WHERE {where} AND json_extract(d.data,'$.status')='completed'
          AND json_type(d.data,'$.duration_ms') IN ('integer','real') GROUP BY date(d.created_at,'+7 hours') ORDER BY date''', parameters).fetchall()
        documents = [row_document(item) for item in connection.execute(f'SELECT d.* FROM documents d WHERE {where}', parameters).fetchall()]
        review_snapshots = {document['id']: store.get_document('review', document['data']['latest_review_id'], conn=connection)
                            for document in documents if document['data'].get('latest_review_id')}
    reviews, quality, confirmed, errors = Counter(), Counter(), Counter(), Counter()
    uncertain, failing, pending, completed = 0, 0, 0, 0
    for document in documents:
        data = document['data']
        status = data.get('review_status', 'not_available')
        reviews[status] += 1
        q = data.get('quality', {})
        qstatus = q.get('overall_status', q.get('status', 'unavailable'))
        quality[qstatus] += 1
        if qstatus in ('fail', 'failed', 'warning', 'poor'):
            failing += 1
        if data.get('status') == 'completed':
            if status == 'verified':
                completed += 1
            else:
                pending += 1
        review = review_snapshots.get(document['id'])
        annotations = review_annotations(review)
        from backend.platform.analyses import effective_counts
        counts = effective_counts(document, review)
        confirmed.update(counts['by_confirmed_class'])
        uncertain += counts['uncertain_total']
        if status == 'verified':
            for annotation in annotations:
                if annotation.get('action') in ('correct', 'false_positive', 'missed'):
                    prediction = annotation.get('original_prediction') or {}
                    label = prediction.get('label') or annotation.get('label') or 'ไม่ระบุชนิด'
                    errors[(label, annotation['action'])] += 1
    average = row['latency']
    return {
        'configured': True, 'scope': 'all' if user['role'] in ('admin', 'reviewer') else 'own', 'sample_size': row['total'],
        'summary': {'total_analyses': row['total'], 'successful_analyses': row['successful'] or 0, 'failed_analyses': row['failed'] or 0,
                    'total_detected_objects': sum(item['count'] for item in predicted), 'confirmed_objects': sum(confirmed.values()),
                    'uncertain_objects': uncertain, 'pending_expert_reviews': pending, 'completed_expert_reviews': completed,
                    'images_failing_quality': failing, 'average_inference_ms': round(average, 2) if average is not None else None},
        'charts': {'analyses_by_date': [dict(item) for item in by_date], 'predicted_classes': [dict(item) for item in predicted],
                   'confirmed_classes': [{'label': label, 'count': count} for label, count in confirmed.most_common()],
                   'review_statuses': [{'status': status, 'count': count} for status, count in sorted(reviews.items())],
                   'quality_statuses': [{'status': status, 'count': count} for status, count in sorted(quality.items())],
                   'latency_by_date': [{'date': item['date'], 'mean_ms': round(item['mean_ms'], 2), 'sample_size': item['sample_size']} for item in latency],
                   'review_errors': [{'label': label, 'action': action, 'count': count} for (label, action), count in sorted(errors.items())]},
        'filters_applied': filters, 'timezone': 'Asia/Bangkok',
        'disclaimer': 'ข้อมูลนี้เป็นการใช้งานระบบตามสิทธิ์ ไม่ใช่ความชุกหรืออุบัติการณ์โรค จำนวน AI แยกจากการตรวจทานรายวัตถุ การตรวจทานบางวัตถุไม่เท่ากับการยืนยันผลทั้งภาพ',
    }


@router.get('/dashboard')
def dashboard(request: Request, user: Annotated[dict, Depends(require_user)], date_from: str | None = None,
              date_to: str | None = None, predicted_class: str | None = None, analysis_status: str | None = None,
              review_status: str | None = None, model_version: str | None = None, site_code: str | None = None):
    return dashboard_data(get_store(request), user, dict(date_from=date_from, date_to=date_to, predicted_class=predicted_class,
                          analysis_status=analysis_status, review_status=review_status, model_version=model_version, site_code=site_code))

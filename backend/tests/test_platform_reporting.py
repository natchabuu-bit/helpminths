"""Temporary synthetic fixtures only: no patient images, benchmark or production seeds."""
from __future__ import annotations

import csv
import io
import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image

from backend.main import create_app
from backend.platform.analytics import dashboard_data
from backend.platform.evaluation import evaluate_detections, intersection_over_union
from backend.platform.feedback import FeedbackTriage, triage_feedback
from backend.platform.modelversions import configured_model
from backend.platform._report_data import flattened_analysis, object_rows
from backend.platform.reporting import _report_images, csv_bytes, make_pdf
from backend.platform.store import PlatformStore


@pytest.fixture
def store_and_users(tmp_path):
    store = PlatformStore(tmp_path / 'private')
    admin = store.create_user('test-admin', 'test-only-password-12', 'admin')
    owner = store.create_user('test-owner', 'test-only-password-12', 'lab', admin['id'])
    other = store.create_user('test-other', 'test-only-password-12', 'lab', admin['id'])
    return store, admin, owner, other


def analysis(store, owner, *, detections=None, status='completed', quality='pass'):
    return store.create_document('analysis', {'sample_code': 'TEST_ONLY', 'site_code': 'TEST', 'status': status,
        'model': 'synthetic-test-only.pt', 'model_version': 'test-fixture-only', 'width': 100, 'height': 80,
        'quality': {'status': quality, 'checks': []}, 'review_status': 'pending', 'latest_review_id': None,
        'confidence_threshold': .15, 'review_confidence_threshold': .5, 'duration_ms': 12 if status == 'completed' else None,
        'detections': detections if detections is not None else [{'id': 'd1', 'label': 'TEST_CLASS_A', 'confidence': .9, 'bbox': [5, 5, 30, 30]}]}, owner['id'], owner['id'])


def test_class_aware_one_to_one_metrics_do_not_double_count_or_hide_wrong_classes():
    cases = [{'id': 'test-only-image', 'ground_truth': [{'label': 'A', 'bbox': [0, 0, 20, 20]}, {'label': 'B', 'bbox': [30, 30, 50, 50]}],
              'predictions': [{'label': 'A', 'confidence': .9, 'bbox': [0, 0, 20, 20]}, {'label': 'A', 'confidence': .8, 'bbox': [0, 0, 20, 20]}, {'label': 'C', 'confidence': .7, 'bbox': [30, 30, 50, 50]}]}]
    result = evaluate_detections(cases, iou_threshold=.5, confidence_threshold=.15)
    assert (result['tp'], result['fp'], result['fn']) == (1, 2, 1)
    assert result['precision'] == pytest.approx(1 / 3)
    assert result['recall'] == .5
    assert result['f1'] == pytest.approx(.4)
    assert result['map50'] == .5
    assert result['map50_95'] == .5
    assert {'ground_truth': 'B', 'predicted': 'C', 'count': 1} in result['confusion_matrix']
    assert result['maximum_recall_limited_by_saved_inference_thresholds'] is True
    assert intersection_over_union([0, 0, 10, 10], [10, 10, 20, 20]) == 0
    assert intersection_over_union([0, 0, 10, 10], [0, 0, 10, 10]) == 1


def test_csv_keeps_real_zero_object_records_and_escapes_spreadsheet_formulas(store_and_users):
    store, admin, owner, _ = store_and_users
    first = analysis(store, owner, detections=[{'id': 'x', 'label': ' =1+2,\nไข่ทดสอบ', 'confidence': .4, 'bbox': [1, 2, 4, 6]}])
    second = analysis(store, owner, detections=[], status='failed')
    encoded = csv_bytes(store, [first, second])
    assert encoded.startswith(b'\xef\xbb\xbf')
    rows = list(csv.DictReader(io.StringIO(encoded.decode('utf-8-sig'))))
    assert len(rows) == 2
    assert rows[0]['predicted_class'] == "' =1+2,\nไข่ทดสอบ"
    assert rows[0]['confidence'] == '0.4'
    assert json.loads(rows[0]['predicted_bbox']) == [1, 2, 4, 6]
    assert rows[0]['reviewer_bbox'] == ''
    assert json.loads(rows[0]['effective_bbox']) == [1, 2, 4, 6]
    assert rows[1]['analysis_id'] == second['id']
    assert rows[1]['object_id'] == ''
    assert rows[1]['confidence'] == ''
    assert rows[1]['analysis_status'] == 'failed'


def test_reviewed_coordinates_export_separately_and_pdf_uses_corrected_box(store_and_users, tmp_path):
    store, admin, owner, _ = store_and_users
    predicted_bbox, corrected_bbox = [5, 5, 30, 30], [55, 45, 85, 70]
    first = analysis(store, owner)
    review = store.create_document('review', {'analysis_id': first['id'], 'status': 'verified', 'reviewer_id': admin['id'],
        'annotations': [{'id': 'r1', 'detection_id': 'd1', 'action': 'correct', 'label': 'TEST_CLASS_A',
                         'bbox': corrected_bbox, 'original_prediction': first['data']['detections'][0]}]}, owner['id'], admin['id'])
    first = store.update_document('analysis', first['id'], {**first['data'], 'latest_review_id': review['id'], 'review_status': 'verified'}, admin['id'], first['revision'])
    rows = object_rows(store, first)
    assert rows[0]['predicted_bbox'] == predicted_bbox
    assert rows[0]['reviewer_bbox'] == corrected_bbox
    assert rows[0]['effective_bbox'] == rows[0]['bbox'] == corrected_bbox
    assert store.get_document('analysis', first['id'])['data']['detections'][0]['bbox'] == predicted_bbox
    exported = next(csv.DictReader(io.StringIO(csv_bytes(store, [first]).decode('utf-8-sig'))))
    assert json.loads(exported['predicted_bbox']) == predicted_bbox
    assert json.loads(exported['reviewer_bbox']) == json.loads(exported['effective_bbox']) == corrected_bbox
    original = tmp_path / 'synthetic-corrected-test-only.png'
    Image.new('RGB', (100, 80), '#a9bec7').save(original)
    _, annotated, _ = _report_images(original, rows)
    with Image.open(io.BytesIO(annotated)) as overlay:
        assert overlay.getpixel((85, 65)) == (179, 92, 0)  # corrected rectangle, orange
        assert overlay.getpixel((5, 20)) == (169, 190, 199)  # original prediction is not drawn
    encoded = make_pdf(flattened_analysis(first), review, rows, original, 'corrected-bbox-test-only', '2026-10-29T10:35:00Z')
    assert encoded.startswith(b'%PDF')
    if shutil.which('pdftotext'):
        output = tmp_path / 'corrected.pdf'; output.write_bytes(encoded)
        extracted = subprocess.run(['pdftotext', str(output), '-'], check=True, text=True, capture_output=True).stdout
        assert 'AI bbox' in extracted and 'Reviewer bbox' in extracted and 'Effective bbox' in extracted
        assert str(predicted_bbox) in extracted and str(corrected_bbox) in extracted


def test_dashboard_uses_owner_scope_shared_bangkok_dates_and_partial_object_decisions(store_and_users):
    store, admin, owner, other = store_and_users
    first = analysis(store, owner)
    analysis(store, other)
    review = store.create_document('review', {'analysis_id': first['id'], 'status': 'in_review', 'reviewer_id': admin['id'],
        'annotations': [{'id': 'r1', 'detection_id': 'd1', 'action': 'confirm', 'label': 'TEST_CLASS_A', 'bbox': [5, 5, 30, 30]}]}, owner['id'], admin['id'])
    data = {**first['data'], 'latest_review_id': review['id'], 'review_status': 'in_review'}
    store.update_document('analysis', first['id'], data, admin['id'], first['revision'])
    with store.connection() as connection:
        connection.execute("UPDATE documents SET created_at='2026-10-28T18:00:00Z' WHERE id=?", (first['id'],))
    own = dashboard_data(store, owner)
    assert own['summary']['total_analyses'] == 1
    assert own['summary']['total_detected_objects'] == 1
    assert own['summary']['confirmed_objects'] == 1
    assert own['summary']['completed_expert_reviews'] == 0
    assert own['charts']['review_errors'] == []
    assert dashboard_data(store, admin)['summary']['total_analyses'] == 2
    filtered = dashboard_data(store, owner, {'date_from': '2026-10-29', 'date_to': '2026-10-29'})
    assert filtered['sample_size'] == 1
    assert filtered['charts']['analyses_by_date'][0]['date'] == '2026-10-29'
    assert dashboard_data(store, owner, {'analysis_status': 'failed'})['sample_size'] == 0
    with pytest.raises(HTTPException) as problem:
        dashboard_data(store, owner, {'date_from': 'bad-date'})
    assert problem.value.status_code == 422


def test_pdf_contains_real_images_unicode_fonts_and_unambiguous_false_positive_label(tmp_path):
    original = tmp_path / 'synthetic-test-only.png'
    Image.new('RGB', (100, 80), '#a9bec7').save(original)
    document = {'id': 'synthetic-report-test-only', 'created_at': '2026-10-29T10:30:00Z', 'revision': 2,
                'status': 'completed', 'sample_code': 'TEST_ONLY', 'model': 'test-only.pt', 'model_version': 'test-only',
                'duration_ms': 10, 'quality': {'status': 'pass', 'checks': []}, 'review_status': 'verified',
                'detections': [{'id': 'd1', 'label': 'ไข่ทดสอบเท่านั้น', 'bbox': [10, 10, 30, 30], 'confidence': .8}]}
    review = {'status': 'verified', 'reviewer_id': 'test-only-reviewer', 'annotations': [{'id': 'r1', 'detection_id': 'd1', 'action': 'false_positive', 'bbox': [10, 10, 30, 30]}]}
    rows = [{'object_id': 'd1', 'origin': 'model', 'predicted_class': 'ไข่ทดสอบเท่านั้น', 'confidence': .8,
             'predicted_bbox': [10, 10, 30, 30], 'reviewer_bbox': [10, 10, 30, 30], 'effective_bbox': [10, 10, 30, 30],
             'bbox': [10, 10, 30, 30], 'review_action': 'false_positive', 'reviewer_label': ''}]
    encoded = make_pdf(document, review, rows, original, 'test-report-id', '2026-10-29T10:35:00Z')
    assert encoded.startswith(b'%PDF') and len(encoded) > 10000
    assert b'/ToUnicode' in encoded and b'/FontFile2' in encoded
    output = tmp_path / 'report.pdf'; output.write_bytes(encoded)
    if shutil.which('pdftotext'):
        extracted = subprocess.run(['pdftotext', str(output), '-'], check=True, text=True, capture_output=True).stdout
        assert 'รายงาน' in extracted
        assert 'false positive' in extracted
        assert 'test-report-id' in extracted
    assert Image.open(original).size == (100, 80)


def test_bbox_only_correction_is_not_classification_error_evidence(store_and_users):
    store, admin, owner, _ = store_and_users
    first = analysis(store, owner)
    review = store.create_document('review', {'analysis_id': first['id'], 'status': 'verified', 'reviewer_id': admin['id'],
        'annotations': [{'id': 'r1', 'detection_id': 'd1', 'action': 'correct', 'label': 'TEST_CLASS_A', 'bbox': [6, 6, 30, 30],
                         'original_prediction': first['data']['detections'][0]}]}, owner['id'], admin['id'])
    store.update_document('analysis', first['id'], {**first['data'], 'latest_review_id': review['id'], 'review_status': 'verified'}, admin['id'], first['revision'])
    feedback = store.create_document('feedback', {'analysis_id': first['id'], 'object_id': 'd1', 'category': 'incorrect_classification', 'message': 'test-only review', 'status': 'pending'}, owner['id'], owner['id'])
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(platform_store=store)))
    with pytest.raises(HTTPException) as problem:
        triage_feedback(feedback['id'], FeedbackTriage(expected_revision=1, status='verified_error', reviewer_comment='test-only evidence review'), request, admin)
    assert problem.value.status_code == 422
    assert store.get_document('feedback', feedback['id'])['revision'] == 1


def test_independent_evaluation_requires_explicit_approval_and_actual_model_version(tmp_path):
    app = create_app(platform_dir=tmp_path / 'private-evaluation')
    store = app.state.platform_store
    admin = store.create_user('evaluation-admin', 'test-only-password-12', 'admin')
    record = analysis(store, admin)
    with TestClient(app, base_url='https://testserver') as client:
        login = client.post('/api/platform/login', json={'username': admin['username'], 'password': 'test-only-password-12'})
        assert login.status_code == 200
        headers = {'X-CSRF-Token': login.json()['csrf_token']}
        initial = client.get('/api/platform/evaluation').json()
        assert initial['status'] == 'unavailable' and initial['metrics'] is None
        payload = {'dataset_version': 'TEST_ONLY_V1', 'source': 'Synthetic unit-test fixture only', 'independence_method': 'Explicit temporary test data; not a clinical benchmark',
                   'independent': False, 'labels_reviewed': True, 'cases': [{'analysis_id': record['id'], 'group_code': 'TEST_GROUP', 'ground_truth': [{'label': 'TEST_CLASS_A', 'bbox': [5, 5, 30, 30]}]}]}
        assert client.post('/api/platform/evaluation/datasets', json=payload, headers=headers).status_code == 422
        payload['independent'] = True
        response = client.post('/api/platform/evaluation/datasets', json=payload, headers=headers)
        assert response.status_code == 201, response.text
        dataset_id = response.json()['id']
        result = client.post('/api/platform/evaluation/run', json={'dataset_id': dataset_id, 'model_version': 'test-fixture-only'}, headers=headers)
        assert result.status_code == 201, result.text
        assert result.json()['metrics']['precision'] == 1
        assert result.json()['metrics']['recall'] == 1
        assert result.json()['sample_size'] == 1
        assert client.get('/api/platform/evaluation').json()['status'] == 'available'
        assert client.post('/api/platform/evaluation/run', json={'dataset_id': dataset_id, 'model_version': 'different-test-version'}, headers=headers).status_code == 422


def test_configured_model_never_returns_private_paths_or_undeclared_metrics():
    service = SimpleNamespace(ready=True, name='test-only.pt', message='unit-test only', metadata={'version': 'test-sha', 'sha256': 'a' * 64, 'path': '/private/do-not-expose', 'api_key': 'not-a-real-key',
        'training_dataset_version': 'operator-declared-test-only', 'validation_dataset': None, 'dataset_metadata_status': 'operator_declared', 'evaluation_metrics': {'precision': .999}})
    value = configured_model(SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(model_service=service))))
    assert value['version'] == 'test-sha'
    assert value['metadata']['sha256'] == 'a' * 64
    assert value['metadata']['training_dataset_version'] == 'operator-declared-test-only'
    assert value['metadata']['dataset_metadata_status'] == 'operator_declared'
    assert 'evaluation_metrics' not in value['metadata']
    assert 'path' not in value['metadata'] and 'api_key' not in value['metadata']

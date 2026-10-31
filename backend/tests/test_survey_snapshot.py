"""Aggregate-only snapshot behavior; synthetic fixtures are never project evidence."""
from __future__ import annotations

import copy
import csv
import io
import json

import pytest
from fastapi import HTTPException

from backend.platform import survey_snapshot as snapshot


def cube(province, district, affiliation, status, units, enrolled, tested, infected, positive_units=0, mixed=None):
    cells = {key: {'reported': None if status == 'pending' else 0,
                   'consistent': None if status == 'pending' else 0,
                   'conflicting': 0, 'missing': 0, 'tested_missing': 0} for key, _ in snapshot.PARASITES}
    return {'province': province, 'district': district, 'affiliation': affiliation, 'status': status,
            'school_count': units, 'positive_school_count': positive_units, 'enrolled': enrolled,
            'tested': tested, 'infected': infected, 'coinfection': mixed, 'parasites': cells}


@pytest.fixture
def dataset():
    rows = [cube('ตาก', 'อำเภอA', 'สังกัดA', 'tested', 2, 100, 80, 8, 1, 2),
            cube('พิษณุโลก', 'อำเภอB', 'สังกัดB', 'tested', 1, 100, 50, 1, 1, 0),
            cube('ตาก', 'อำเภอC', 'สังกัดA', 'zero_tested', 1, 0, 0, 0, 0, 0),
            cube('ตาก', 'อำเภอD', 'สังกัดC', 'pending', 1, None, None, None)]
    rows[0]['parasites']['ascaris'].update(reported=6, consistent=6)
    rows[0]['parasites']['hookworm'].update(reported=3, consistent=3)
    rows[1]['parasites']['hookworm'].update(reported=1, consistent=1)
    rows[1]['parasites']['tapeworm'].update(reported=None, consistent=None, missing=1, tested_missing=1)
    rows[2]['parasites']['pinworm'].update(reported=1, consistent=0, conflicting=1)
    rows[2]['parasites']['ascaris'].update(reported=None, consistent=None, missing=1)
    return {'schema_version': 1, 'dataset': {'id': 'SYNTHETIC_TEST', 'version': 'test-only-v1',
            'file_name': 'SYNTHETIC_TEST.xlsx', 'worksheet': 'SYNTHETIC_TEST_TAB', 'year': 2569,
            'year_basis': 'filename', 'imported_at': '2026-10-30T00:00:00Z'},
            'cubes': rows, 'issues': [
                {'id': 'conflict', 'code': 'source_count_conflict', 'severity': 'warning',
                 'province': 'ตาก', 'district': 'อำเภอC', 'affiliation': 'สังกัดA', 'status': 'zero_tested',
                 'parasite': 'pinworm', 'cell_refs': ['S10'], 'message': 'SYNTHETIC: รายงาน1ในแถวส่งตรวจ0'},
                {'id': 'zero-formula', 'code': 'formula_error', 'severity': 'info',
                 'province': 'ตาก', 'district': 'อำเภอC', 'affiliation': 'สังกัดA', 'status': 'zero_tested',
                 'cell_refs': ['H10'], 'count': 11, 'message': 'SYNTHETIC: ไม่คำนวณ0/0'},
                {'id': 'pending-formula', 'code': 'formula_error', 'severity': 'info',
                 'province': 'ตาก', 'district': 'อำเภอD', 'affiliation': 'สังกัดC', 'status': 'pending',
                 'cell_refs': ['H11'], 'count': 11, 'message': 'SYNTHETIC: ยังไม่มีตัวหาร'}],
            'audit': {'summary_reconciled': True}}


def test_snapshot_metadata_and_real_denominators_are_distinct_from_live_or_population_claims(dataset):
    meta = snapshot.metadata(dataset)
    assert meta['source']['provider'] == 'uploaded_workbook'
    assert meta['source']['year_basis'] == 'filename' and meta['source']['data_status'] == 'imported_snapshot'
    assert meta['refresh_seconds'] == 0 and meta['access'] == 'public_aggregates'
    result = snapshot.dashboard(dataset=dataset)
    summary = result['data']['summary']
    assert result['fetched_at'] == dataset['dataset']['imported_at'] and result['last_attempt_at'] is None
    assert summary['school_count'] == 5 and summary['reported_school_count'] == 4
    assert summary['tested_school_count'] == 3 and summary['pending_school_count'] == 1
    assert summary['zero_tested_school_count'] == 1 and summary['positive_school_count'] == 2
    assert summary['negative_school_count'] == 1
    assert summary['total_students_known'] == 200 and summary['tested_count'] == 130
    assert summary['infected_count'] == 9 and summary['negative_count'] == 121
    assert summary['coverage_percent'] == 65 and summary['infection_rate_percent'] == 6.9231
    assert summary['unsubmitted_known_count'] == 70
    assert result['data']['trend'] == []
    assert any('หน่วยรอข้อมูลไม่ถูกแทนเป็น 0' in warning for warning in result['warnings'])


def test_pending_and_zero_tested_scopes_preserve_unknowns_and_undefined_ratios(dataset):
    pending = snapshot.dashboard({'record_status': 'pending'}, dataset)['data']
    assert pending['summary']['school_count'] == 1 and pending['summary']['pending_school_count'] == 1
    assert pending['summary']['tested_count'] is None and pending['summary']['total_students_known'] is None
    assert pending['summary']['infected_count'] is None and pending['summary']['infection_rate_percent'] is None
    assert all(row['count'] is None for row in pending['by_parasite'])
    zero = snapshot.dashboard({'record_status': 'zero_tested'}, dataset)['data']
    assert zero['summary']['tested_count'] == zero['summary']['infected_count'] == 0
    assert zero['summary']['coverage_percent'] is None and zero['summary']['infection_rate_percent'] is None
    assert zero['quality']['formula_error_count'] == 11
    assert snapshot.dashboard({'record_status': 'reported'}, dataset)['data']['summary']['pending_school_count'] == 0


def test_parasite_reported_and_consistent_values_are_not_silently_corrected_or_summed_as_people(dataset):
    data = snapshot.dashboard(dataset=dataset)['data']
    values = {row['key']: row for row in data['by_parasite']}
    pin = values['pinworm']
    assert pin['count'] == pin['reported_count'] == 1
    assert pin['validated_count'] == 0 and pin['flagged_count'] == 1 and pin['rate_percent'] is None
    assert values['ascaris']['missing_school_count'] == 1
    assert values['ascaris']['tested_missing_school_count'] == 0
    assert values['tapeworm']['missing_school_count'] == values['tapeworm']['tested_missing_school_count'] == 1
    assert values['tapeworm']['rate_percent'] is None
    assert data['summary']['infected_count'] == 9
    assert data['summary']['reported_findings_count'] == 11
    assert data['summary']['consistent_findings_count'] == 10
    assert data['summary']['multiple_infections_count'] == 2
    assert data['quality']['formula_error_count'] == 22 and data['quality']['missing_count_cells'] == 2


def test_scoped_groups_options_issues_and_descriptive_insights_recalculate(dataset):
    data = snapshot.dashboard({'province': 'พิษณุโลก'}, dataset)['data']
    assert data['summary']['school_count'] == 1 and data['summary']['tested_count'] == 50
    assert data['summary']['infected_count'] == 1 and data['summary']['coverage_percent'] == 50
    assert data['quality']['issues'] == [] and data['quality']['formula_error_count'] == 0
    assert data['available_provinces'] == ['ตาก', 'พิษณุโลก']
    assert data['available_districts'] == ['อำเภอB'] and data['available_affiliations'] == ['สังกัดB']
    assert all('ตาก' not in value for value in data['insights'])
    by_affiliation = snapshot.dashboard({'affiliation': 'สังกัดA'}, dataset)['data']
    assert by_affiliation['summary']['school_count'] == 3 and by_affiliation['summary']['tested_count'] == 80
    assert by_affiliation['quality']['formula_error_count'] == 11
    assert [row['district'] for row in by_affiliation['by_district']] == ['อำเภอA', 'อำเภอC']
    assert snapshot.dashboard({'year': 2026}, dataset)['data']['summary']['school_count'] == 5
    for filters in ({'province': 'PRIVATE_PERSON'}, {'year': 2568}, {'record_status': 'fake'}, {'from_date': '2026-01-01'}):
        with pytest.raises(HTTPException) as caught:
            snapshot.dashboard(filters, dataset)
        assert caught.value.status_code == 422


def test_district_names_are_qualified_by_province(dataset):
    changed = copy.deepcopy(dataset)
    changed['cubes'][1]['district'] = 'อำเภอA'
    groups = snapshot.dashboard(dataset=changed)['data']['by_district']
    duplicate_labels = [row for row in groups if row['district'] == 'อำเภอA']
    assert len(duplicate_labels) == 2 and {row['province'] for row in duplicate_labels} == {'ตาก', 'พิษณุโลก'}


def test_api_projection_and_csv_never_expose_private_raw_fields_and_escape_formula_labels(dataset):
    changed = copy.deepcopy(dataset)
    changed['cubes'][0]['school_name'] = 'PRIVATE_SCHOOL_MUST_NOT_LEAK'
    changed['cubes'][0]['person_name'] = 'PRIVATE_PERSON_MUST_NOT_LEAK'
    changed['cubes'][0]['affiliation'] = '=SYNTHETIC_TEST_LABEL'
    result = snapshot.dashboard(dataset=changed)
    assert 'PRIVATE_' not in json.dumps(result)
    content = snapshot.export_csv(dataset=changed)
    assert content.startswith(b'\xef\xbb\xbf')
    rows = list(csv.reader(io.StringIO(content.decode('utf-8-sig'))))
    assert len(rows) > 3
    assert any("'=SYNTHETIC_TEST_LABEL" in row for row in rows)
    assert b'PRIVATE_' not in content
    assert 'reported_positive_people' in rows[0]


def test_disk_loader_rejects_bad_schema_or_counts_and_private_path_is_not_in_error(tmp_path, dataset):
    path = tmp_path / 'snapshot.json'
    path.write_text(json.dumps(dataset), encoding='utf-8')
    assert snapshot.available(path)
    assert snapshot.load_dataset(path)['dataset']['version'] == 'test-only-v1'
    changed = copy.deepcopy(dataset)
    changed['cubes'][0]['infected'] = 1000
    path.write_text(json.dumps(changed), encoding='utf-8')
    with pytest.raises(HTTPException) as caught:
        snapshot.load_dataset(path)
    assert caught.value.status_code == 503 and str(path) not in str(caught.value.detail)
    path.write_text('{not valid JSON', encoding='utf-8')
    with pytest.raises(HTTPException):
        snapshot.load_dataset(path)
    with pytest.raises(HTTPException):
        snapshot.load_dataset(tmp_path / 'missing.json')


def test_imported_project_snapshot_matches_independent_audit_when_available():
    if not snapshot.available():
        pytest.skip('Actual aggregate snapshot is generated by the import task before final integrated run')
    result = snapshot.dashboard()
    data = result['data']
    summary = data['summary']
    assert summary['school_count'] == 174 and summary['reported_school_count'] == 172
    assert summary['tested_school_count'] == 170 and summary['zero_tested_school_count'] == 2
    assert summary['pending_school_count'] == 2 and summary['positive_school_count'] == 109
    assert summary['negative_school_count'] == 61
    assert summary['total_students_known'] == 17122 and summary['tested_count'] == 15888
    assert summary['infected_count'] == 698 and summary['negative_count'] == 15190
    assert summary['unsubmitted_known_count'] == 1234
    assert summary['multiple_infections_count'] == 17
    assert summary['reported_findings_count'] == 716 and summary['consistent_findings_count'] == 715
    assert len(data['by_province']) == 4 and 'สุโขทัย' not in data['available_provinces']
    assert data['quality']['formula_error_count'] == 44 and data['quality']['missing_count_cells'] == 2
    pin = next(row for row in data['by_parasite'] if row['key'] == 'pinworm')
    assert pin['count'] == 7 and pin['validated_count'] == 6 and pin['flagged_count'] == 1
    assert pin['rate_percent'] is None
    for province, enrolled, tested, positive in [('อุตรดิตถ์', 262, 262, 0), ('เพชรบูรณ์', 49, 49, 0), ('พิษณุโลก', 934, 441, 1), ('ตาก', 15877, 15136, 697)]:
        selected = snapshot.dashboard({'province': province})['data']['summary']
        assert (selected['total_students_known'], selected['tested_count'], selected['infected_count']) == (enrolled, tested, positive)


def test_actual_positivity_distribution_and_cross_filters_do_not_reclassify_untested_or_pending():
    data = snapshot.dashboard()['data']
    bands = {row['key']: row for row in data['by_positivity_band']}
    assert {key: row['school_count'] for key, row in bands.items()} == {
        'none': 61, 'under5': 51, '5to10': 32, '10to20': 15, '20plus': 11,
    }
    assert sum(row['school_count'] for row in bands.values()) == 170
    assert sum(row['tested_count'] for row in bands.values()) == 15888
    assert sum(row['infected_count'] for row in bands.values()) == 698
    # The categorical count distribution excludes schools without a denominator.
    for status in ('zero_tested', 'pending'):
        empty_bands = snapshot.dashboard({'record_status': status})['data']['by_positivity_band']
        assert sum(row['school_count'] for row in empty_bands) == 0
    selected = snapshot.dashboard({'positivity_band': '20plus'})['data']
    assert selected['summary']['school_count'] == selected['summary']['tested_school_count'] == 11
    assert selected['summary']['pending_school_count'] == selected['summary']['zero_tested_school_count'] == 0
    assert len(selected['by_positivity_band']) == 5, 'Band chips must remain switchable while one band is selected'
    assert selected['summary']['infected_count'] == bands['20plus']['infected_count']
    assert selected['summary']['tested_count'] == bands['20plus']['tested_count']
    no_detections = snapshot.dashboard({'positivity_band': 'none', 'province': 'พิษณุโลก'})['data']
    assert no_detections['summary']['school_count'] == 4 and no_detections['summary']['infected_count'] == 0
    with pytest.raises(HTTPException) as caught:
        snapshot.dashboard({'positivity_band': 'fake'})
    assert caught.value.status_code == 422

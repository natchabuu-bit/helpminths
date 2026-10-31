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


def named_school(name, *, tested, infected, province='ตาก', district='อำเภอA', affiliation='สังกัดA'):
    import hashlib
    band = ('none' if infected == 0 else 'under5' if infected * 100 < tested * 5
            else '5to10' if infected * 100 < tested * 10 else '10to20' if infected * 100 < tested * 20 else '20plus')
    return {'school_id': hashlib.sha256(f'{name}:{affiliation}'.encode()).hexdigest()[:24], 'school': name,
            'province': province, 'district': district, 'affiliation': affiliation, 'status': 'tested',
            'positivity_band': band, 'enrolled': tested, 'tested': tested, 'infected': infected, 'coinfection': 0}


def named_dataset(dataset, schools):
    result = copy.deepcopy(dataset)
    result['dataset'].update(named_school_statistics=True, publication_scope='named_tested_school_statistics',
                             band_partitioned=True)
    result['schools'] = schools
    result['cubes'] = []
    for school in schools:
        row = cube(school['province'], school['district'], school['affiliation'], 'tested', 1,
                   school['enrolled'], school['tested'], school['infected'], int(school['infected'] > 0), school['coinfection'])
        row['positivity_band'] = school['positivity_band']
        result['cubes'].append(row)
    result['issues'] = []
    return result


def test_named_school_ranking_uses_exact_ratios_minimum_thirty_and_explicit_zero_inclusion(dataset):
    schools = [named_school('UNDER_CUTOFF', tested=29, infected=29),
               named_school('EXACT_THIRTY', tested=30, infected=15),
               named_school('SAME_RATE_MORE_POSITIVES', tested=60, infected=30),
               named_school('EXACT_RATE_HIGHER', tested=10000000, infected=100001),
               named_school('ROUNDED_RATE_TIE_MORE_POSITIVES', tested=50000000, infected=500000),
               named_school('ZERO_POSITIVE_ELIGIBLE', tested=30, infected=0),
               named_school('SMALL_HUNDRED_PERCENT', tested=1, infected=1)]
    result = snapshot.dashboard(dataset=named_dataset(dataset, schools))['data']
    assert result['named_school_statistics'] is True
    assert len(result['by_school']) == 7
    assert result['followup_min_tested'] == 30 and result['followup_eligible_school_count'] == 5
    ranked = result['followup_schools']
    assert [row['school'] for row in ranked] == ['SAME_RATE_MORE_POSITIVES', 'EXACT_THIRTY', 'EXACT_RATE_HIGHER',
                                               'ROUNDED_RATE_TIE_MORE_POSITIVES', 'ZERO_POSITIVE_ELIGIBLE']
    assert all(row['tested_count'] >= 30 for row in ranked)
    exact = next(row for row in ranked if row['school'] == 'EXACT_RATE_HIGHER')
    rounded = next(row for row in ranked if row['school'] == 'ROUNDED_RATE_TIE_MORE_POSITIVES')
    assert exact['infection_rate_percent'] == rounded['infection_rate_percent'], 'Order must use raw ratios before percentage rounding'


def test_named_followup_is_limited_to_eight_while_full_eligible_and_school_counts_remain_available(dataset):
    schools = [named_school(f'RANK_{number:02}', tested=100, infected=number) for number in range(1, 13)]
    result = snapshot.dashboard(dataset=named_dataset(dataset, schools))['data']
    assert len(result['by_school']) == 12 and result['followup_eligible_school_count'] == 12
    assert len(result['followup_schools']) == 8
    assert [row['infected_count'] for row in result['followup_schools']] == list(range(12, 4, -1))


def test_school_details_do_not_leak_without_opt_in_and_projection_strips_unrelated_fields(dataset):
    schools = [named_school('AUTHORIZED_SCHOOL', tested=30, infected=3)]
    dataset['schools'] = schools
    result = snapshot.dashboard(dataset=dataset)['data']
    assert not result['named_school_statistics'] and result['by_school'] == [] and result['followup_schools'] == []
    assert 'AUTHORIZED_SCHOOL' not in json.dumps(result)
    selected = named_dataset(dataset, schools)
    selected['schools'][0].update(notes='PRIVATE_NOTE_MUST_NOT_LEAK', person_name='PRIVATE_PERSON_MUST_NOT_LEAK', tambon='PRIVATE_TAMBON')
    result = snapshot.dashboard(dataset=selected)
    assert 'AUTHORIZED_SCHOOL' in json.dumps(result)
    assert 'PRIVATE_' not in json.dumps(result)
    assert all(not ({'notes', 'person_name', 'tambon', 'parasites'} & row.keys()) for row in result['data']['by_school'])


def test_named_school_loader_rejects_duplicates_inconsistent_counts_and_unreconciled_lists(tmp_path, dataset):
    selected = named_dataset(dataset, [named_school('AUTHORIZED_SCHOOL', tested=30, infected=3)])
    path = tmp_path / 'named.json'
    path.write_text(json.dumps(selected), encoding='utf-8')
    assert snapshot.load_dataset(path)['dataset']['named_school_statistics'] is True
    for mutate in ('duplicate', 'unreconciled', 'invalid_counts'):
        broken = copy.deepcopy(selected)
        if mutate == 'duplicate':
            broken['schools'].append(copy.deepcopy(broken['schools'][0]))
        elif mutate == 'unreconciled':
            broken['schools'][0]['tested'] = broken['schools'][0]['enrolled'] = 31
        else:
            broken['schools'][0]['infected'] = 1000
        path.write_text(json.dumps(broken), encoding='utf-8')
        with pytest.raises(HTTPException) as caught:
            snapshot.load_dataset(path)
        assert caught.value.status_code == 503 and str(path) not in str(caught.value.detail)


def test_actual_named_school_publication_and_followup_match_independent_workbook_audit():
    artifact = snapshot.load_dataset()
    data = snapshot.dashboard(dataset=artifact)['data']
    assert data['named_school_statistics'] is True and data['published_school_count'] == 170
    schools = data['by_school']
    assert len(schools) == len({row['school_id'] for row in schools}) == 170
    assert all(row['tested_count'] > 0 for row in schools)
    assert sum(row['total_students_known'] for row in schools) == 17122
    assert sum(row['tested_count'] for row in schools) == 15888
    assert sum(row['infected_count'] for row in schools) == 698
    assert sum(row['multiple_infections_count'] for row in schools) == 17
    assert sum(row['infected_count'] > 0 for row in schools) == 109
    assert data['followup_eligible_school_count'] == 108
    assert sum(row['tested_count'] == 30 for row in schools) == 4
    expected = [('บ้านแม่อมกิ(บ้านเคาะทีโคะ)', 35, 23), ('บ้านมอกูตู้หลวง', 31, 17),
                ('บ้านแม่เหว่ยทะ', 90, 41), ('ชช.บ้านท่าสองยาง(ทีซอเม)*', 41, 15),
                ('บ้านแม่อมกิ(บ้านวะหย่าโจ)', 55, 18), ('บ้านห้วยขี้หมี', 38, 12),
                ('ศกร.ตชด.บ้านแม่ละนา', 132, 23), ('บ้านอุระโกร', 88, 11)]
    assert [(row['school'], row['tested_count'], row['infected_count']) for row in data['followup_schools']] == expected
    for filters in ({'province': 'พิษณุโลก'}, {'district': 'แม่สอด'}, {'affiliation': 'ตชด.34'},
                    {'positivity_band': '20plus'}, {'record_status': 'pending'}, {'record_status': 'zero_tested'}):
        scoped = snapshot.dashboard(filters, artifact)['data']
        expected_rows = [row for row in artifact['schools'] if all(
            (row['status'] == value if key == 'record_status' else row[key] == value) for key, value in filters.items())]
        assert {row['school_id'] for row in scoped['by_school']} == {row['school_id'] for row in expected_rows}
        assert all(row['tested_count'] >= 30 for row in scoped['followup_schools'])
        if expected_rows:
            assert sum(row['tested_count'] for row in scoped['by_school']) == scoped['summary']['tested_count']
            assert sum(row['infected_count'] for row in scoped['by_school']) == scoped['summary']['infected_count']
        else:
            assert scoped['followup_schools'] == []

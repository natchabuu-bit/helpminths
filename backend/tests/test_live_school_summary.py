"""Synthetic live school reports verify source refresh and published aggregates."""
from __future__ import annotations

import copy
import json
from dataclasses import replace
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient

from backend.platform import sheets_dashboard as sheets
from backend.tests.test_sheets_dashboard import application, school_table

NEW_SHEET_ID = '1pvGSBJEykTf5NUEsd3SqVdOqpYbpibTj07p23yJ5o-8'
PRESET = {'preset': 'health2-kpd-school-v1'}


@pytest.fixture(autouse=True)
def live_school_configuration(monkeypatch):
    import os
    for name in list(os.environ):
        if name.startswith('HELPMINTHS_SHEETS_') or name == 'HELPMINTHS_GOOGLE_SERVICE_ACCOUNT_JSON':
            monkeypatch.delenv(name)
    monkeypatch.setenv('HELPMINTHS_DASHBOARD_SOURCE', 'google_sheets')
    monkeypatch.setenv('HELPMINTHS_SHEETS_ID', NEW_SHEET_ID)
    monkeypatch.setenv('HELPMINTHS_SHEETS_GID', '')
    monkeypatch.setenv('HELPMINTHS_SHEETS_PUBLIC_AGGREGATES', '1')
    monkeypatch.setenv('HELPMINTHS_SHEETS_REFRESH_SECONDS', '30')
    monkeypatch.setenv('HELPMINTHS_SHEETS_COLUMN_MAPPING', json.dumps(PRESET))


def row(name, *, province='ตาก', district='อำเภอหนึ่ง', affiliation='สังกัดหนึ่ง',
        enrolled=100, tested=50, infected=5, hookworm=2):
    result = school_table()[3].copy()
    result[0:6] = [name, 'ตำบลหนึ่ง', district, province, str(enrolled), str(tested)]
    result[7] = str(infected)
    for index, _ in sheets.SCHOOL_PARASITES:
        result[index] = '0'
    result[9] = str(hookworm)
    result[25] = '' if enrolled == tested == infected == '' else '0'
    result[27] = affiliation
    return result


def report():
    return [*copy.deepcopy(school_table()[:3]),
            row('โรงเรียนหนึ่ง'),
            row('โรงเรียนสอง', province='พิษณุโลก', district='อำเภอสอง', affiliation='สังกัดสอง',
                enrolled=200, tested=100, infected=20, hookworm=10),
            row('โรงเรียนรอข้อมูล', enrolled='', tested='', infected='', hookworm=''),
            row('โรงเรียนส่งตรวจศูนย์', enrolled=40, tested=0, infected=0, hookworm=0)]


def test_explicit_live_preset_exposes_rich_school_statistics_without_snapshot_history(monkeypatch):
    source = report()
    source[0].extend(['ชื่อผู้ป่วย', 'หมายเหตุ'])
    for record in source[3:]:
        record.extend(['PERSON_NAME_MUST_STAY_PRIVATE', 'SOURCE_NOTES_MUST_STAY_PRIVATE'])
    monkeypatch.setattr(sheets, 'fetch_table', Mock(return_value=source))
    with TestClient(application()) as client:
        metadata = client.get('/api/platform/operations/status').json()
        assert metadata['source']['provider'] == 'google_sheets'
        assert metadata['source']['spreadsheet_id'] == NEW_SHEET_ID
        assert metadata['capabilities']['named_school_statistics'] is True
        assert metadata['capabilities']['school_details_extended'] is True
        assert metadata['capabilities']['person_records_exposed'] is False
        assert {'district', 'affiliation', 'record_status', 'positivity_band', 'school_search'} <= set(metadata['capabilities']['filters'])
        response = client.get('/api/platform/operations/dashboard')
    assert response.status_code == 200
    payload = response.json()
    assert payload['status'] == 'ready'
    assert payload['source']['provider'] == 'google_sheets'
    assert payload['source'].get('year') is None
    data = payload['data']
    assert data['schema_id'] == 'health2-kpd-school-v1'
    assert data['available_years'] == []
    assert not data.get('history')
    assert not data.get('comparison', {}).get('available')
    summary = data['summary']
    assert summary['school_count'] == 4
    assert summary['tested_school_count'] == 2
    assert summary['zero_tested_school_count'] == 1
    assert summary['pending_school_count'] == 1
    assert data['published_school_count'] == len(data['by_school']) == 2
    assert {entry['school'] for entry in data['by_school']} == {'โรงเรียนหนึ่ง', 'โรงเรียนสอง'}
    assert {entry['district'] for entry in data['by_district']} == {'อำเภอหนึ่ง', 'อำเภอสอง'}
    assert data['options']['affiliations'] == ['สังกัดสอง', 'สังกัดหนึ่ง']
    serialized = json.dumps(payload, ensure_ascii=False)
    assert 'PERSON_NAME_MUST_STAY_PRIVATE' not in serialized
    assert 'SOURCE_NOTES_MUST_STAY_PRIVATE' not in serialized
    assert 'cubes' not in data and 'schools' not in data


def test_live_filters_share_denominators_and_exclude_untested_from_positivity_bands(monkeypatch):
    monkeypatch.setattr(sheets, 'fetch_table', Mock(return_value=report()))
    with TestClient(application()) as client:
        selected = client.get('/api/platform/operations/dashboard', params={
            'province': 'พิษณุโลก', 'district': 'อำเภอสอง', 'affiliation': 'สังกัดสอง',
            'record_status': 'tested', 'positivity_band': '20plus', 'school_search': 'โรงเรียนสอง',
        })
        assert selected.status_code == 200
        data = selected.json()['data']
        assert data['summary']['school_count'] == 1
        assert data['summary']['tested_count'] == 100
        assert data['summary']['infected_count'] == 20
        assert data['summary']['infection_rate_percent'] == 20
        assert data['summary']['coverage_percent'] == 50
        assert len(data['by_school']) == 1 and data['by_school'][0]['school'] == 'โรงเรียนสอง'
        assert data['by_school'][0]['parasite_counts']['hookworm'] == 10
        hookworm = next(item for item in data['by_parasite'] if item['key'] == 'hookworm')
        assert hookworm['count'] == 10 and hookworm['rate_percent'] == 10
        pending = client.get('/api/platform/operations/dashboard', params={'record_status': 'pending'}).json()['data']
        assert pending['summary']['school_count'] == 1
        assert pending['summary']['tested_count'] is None
        assert pending['summary']['infection_rate_percent'] is None
        assert pending['by_school'] == [] and pending['followup_schools'] == []
        zero = client.get('/api/platform/operations/dashboard', params={'record_status': 'zero_tested'}).json()['data']
        assert zero['summary']['school_count'] == 1 and zero['summary']['tested_count'] == 0
        assert zero['summary']['infection_rate_percent'] is None
        all_data = client.get('/api/platform/operations/dashboard').json()['data']
        assert sum(item['school_count'] for item in all_data['by_positivity_band']) == 2
        for params in ({'district': 'missing'}, {'affiliation': 'missing'}, {'record_status': 'unknown'},
                       {'positivity_band': 'unknown'}, {'year': 2569}, {'from_date': '2026-10-01'}):
            assert client.get('/api/platform/operations/dashboard', params=params).status_code == 422


def test_live_followup_uses_exact_prevalence_and_minimum_tested(monkeypatch):
    source = [*copy.deepcopy(school_table()[:3]),
              row('A lower exact prevalence', enrolled=40000, tested=30001, infected=1, hookworm=0),
              row('Z higher exact prevalence', enrolled=40000, tested=30000, infected=1, hookworm=0),
              row('Excluded small denominator', enrolled=100, tested=29, infected=20, hookworm=0),
              row('Eligible threshold', enrolled=100, tested=30, infected=0, hookworm=0)]
    monkeypatch.setattr(sheets, 'fetch_table', Mock(return_value=source))
    with TestClient(application()) as client:
        payload = client.get('/api/platform/operations/dashboard').json()
    data = payload['data']
    assert data['followup_min_tested'] == 30 and data['followup_eligible_school_count'] == 3
    assert [item['school'] for item in data['followup_schools']] == [
        'Z higher exact prevalence', 'A lower exact prevalence', 'Eligible threshold']
    assert len(data['by_school']) == data['published_school_count'] == 4


def test_live_upstream_change_appears_after_cache_expiry_and_school_count_is_dynamic(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(sheets.time, 'monotonic', lambda: clock[0])
    initial = report()
    changed = copy.deepcopy(initial)
    changed[3][5] = '60'
    changed[3][7] = '6'
    changed.append(row('โรงเรียนเพิ่มใหม่', tested=40, infected=4))
    fetch = Mock(side_effect=[initial, changed])
    monkeypatch.setattr(sheets, 'fetch_table', fetch)
    with TestClient(application()) as client:
        first = client.get('/api/platform/operations/dashboard').json()
        clock[0] += 29
        cached = client.get('/api/platform/operations/dashboard').json()
        assert fetch.call_count == 1
        assert cached['data'] == first['data'] and cached['fetched_at'] == first['fetched_at']
        clock[0] += 1
        latest = client.get('/api/platform/operations/dashboard').json()
    assert fetch.call_count == 2 and latest['status'] == 'ready'
    assert latest['data']['summary']['school_count'] == 5
    assert latest['data']['published_school_count'] == 3
    assert latest['data']['summary']['tested_count'] - first['data']['summary']['tested_count'] == 50
    assert latest['data']['summary']['infected_count'] - first['data']['summary']['infected_count'] == 5


def test_schema_failure_preserves_last_good_same_source_and_new_source_never_reuses_it(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(sheets.time, 'monotonic', lambda: clock[0])
    invalid = report()
    invalid[1][9] = 'changed header cannot be parsed by position'
    fetch = Mock(side_effect=[report(), invalid, sheets.SourceError('access_denied', 'Read permission denied')])
    monkeypatch.setattr(sheets, 'fetch_table', fetch)
    with TestClient(application()) as client:
        first = client.get('/api/platform/operations/dashboard').json()
        clock[0] += 30
        stale = client.get('/api/platform/operations/dashboard').json()
        assert stale['status'] == 'stale' and stale['error']
        assert stale['data'] == first['data'] and stale['fetched_at'] == first['fetched_at']
        monkeypatch.setenv('HELPMINTHS_SHEETS_ID', 'DIFFERENT_LIVE_SOURCE_2026')
        unavailable = client.get('/api/platform/operations/dashboard').json()
    assert unavailable['status'] == 'unavailable'
    assert unavailable['data'] is None and unavailable['fetched_at'] is None
    assert unavailable['source']['spreadsheet_id'] == 'DIFFERENT_LIVE_SOURCE_2026'
    assert unavailable['error']['code'] == 'access_denied'


def test_initial_live_header_failure_has_no_imported_fallback(monkeypatch):
    source = report()
    source[1][9] = 'invalid header'
    monkeypatch.setattr(sheets, 'fetch_table', Mock(return_value=source))
    with TestClient(application()) as client:
        payload = client.get('/api/platform/operations/dashboard').json()
    assert payload['status'] == 'unavailable' and payload['error']
    assert payload['source']['provider'] == 'google_sheets'
    assert payload['data'] is None and payload['fetched_at'] is None


def test_first_tab_export_omits_gid_but_explicit_zero_is_preserved(monkeypatch):
    fetch = Mock(return_value=(b'a,b\n1,2\n', 'text/csv'))
    monkeypatch.setattr(sheets, 'fetch_bytes', fetch)
    config = sheets.SheetsConfig.from_environment()
    assert config.gid == ''
    sheets.fetch_table(config)
    url = fetch.call_args.args[0]
    assert NEW_SHEET_ID in url
    assert parse_qs(urlsplit(url).query) == {'format': ['csv']}
    sheets.fetch_table(replace(config, gid='0'))
    assert parse_qs(urlsplit(fetch.call_args.args[0]).query) == {'format': ['csv'], 'gid': ['0']}


def test_named_school_capabilities_require_school_preset_on_custom_sources(monkeypatch):
    monkeypatch.setenv('HELPMINTHS_SHEETS_COLUMN_MAPPING', '{}')
    with TestClient(application()) as client:
        metadata = client.get('/api/platform/operations/status').json()
    assert metadata['capabilities'].get('named_school_statistics', False) is False
    assert metadata['capabilities'].get('school_details_extended', False) is False
    assert 'school_search' not in metadata['capabilities']['filters']


def test_live_explicit_year_is_used_without_importing_historical_comparison(monkeypatch):
    monkeypatch.setenv('HELPMINTHS_SHEETS_COLUMN_MAPPING', json.dumps({**PRESET, 'year': 2569}))
    monkeypatch.setattr(sheets, 'fetch_table', Mock(return_value=report()))
    with TestClient(application()) as client:
        payload = client.get('/api/platform/operations/dashboard', params={'year': 2026}).json()
    assert payload['status'] == 'ready'
    assert payload['source']['year'] == 2569
    assert payload['data']['available_years'] == [2569]
    assert payload['data']['filters_applied']['year'] == 2569
    assert not payload['data'].get('comparison', {}).get('available')
    assert not payload['data'].get('history')


def test_live_total_rows_and_identical_duplicates_do_not_inflate_published_schools(monkeypatch):
    source = report()
    source.append(source[3].copy())
    total = source[3].copy()
    total[0], total[4], total[5], total[7] = 'รวม 4 โรงเรียน', '99999', '99999', '99999'
    source.append(total)
    monkeypatch.setattr(sheets, 'fetch_table', Mock(return_value=source))
    with TestClient(application()) as client:
        payload = client.get('/api/platform/operations/dashboard').json()
    assert payload['status'] == 'ready'
    data = payload['data']
    assert data['summary']['school_count'] == 4
    assert data['summary']['tested_count'] == 150 and data['summary']['infected_count'] == 25
    assert data['published_school_count'] == len(data['by_school']) == 2
    assert any('ซ้ำ' in warning for warning in payload['warnings'])
    assert any('แถวสรุป' in warning for warning in payload['warnings'])
    assert all(item['school'] != 'รวม 4 โรงเรียน' for item in data['by_school'])


def test_private_school_preset_still_requires_auth_and_denied_public_source_has_no_data(monkeypatch, tmp_path):
    fetch = Mock(side_effect=sheets.SourceError('access_denied', 'Google denied read permission'))
    monkeypatch.setattr(sheets, 'fetch_table', fetch)
    monkeypatch.setenv('HELPMINTHS_SHEETS_PUBLIC_AGGREGATES', '0')
    with TestClient(application(tmp_path)) as client:
        assert client.get('/api/platform/operations/dashboard').status_code == 401
        fetch.assert_not_called()
        monkeypatch.setenv('HELPMINTHS_SHEETS_PUBLIC_AGGREGATES', '1')
        payload = client.get('/api/platform/operations/dashboard').json()
    assert payload['status'] == 'unavailable' and payload['error']['code'] == 'access_denied'
    assert payload['data'] is None and payload['fetched_at'] is None


def test_live_year_can_come_from_an_explicit_source_title_without_old_artifacts(monkeypatch):
    source = [['รายงานประจำปีงบประมาณ 2569'], *report()]
    monkeypatch.setattr(sheets, 'fetch_table', Mock(return_value=source))
    with TestClient(application()) as client:
        payload = client.get('/api/platform/operations/dashboard', params={'year': 2569}).json()
    assert payload['status'] == 'ready'
    assert payload['source']['year'] == 2569
    assert payload['source']['year_basis'] == 'source_header'
    assert payload['data']['available_years'] == [2569]
    assert not payload['data'].get('history')


def test_live_invalid_denominators_stay_unknown_and_are_excluded_from_named_tested_subset(monkeypatch):
    source = [*copy.deepcopy(school_table()[:3]),
              row('Valid school'), row('Invalid denominator school', enrolled=100, tested=50, infected=51)]
    monkeypatch.setattr(sheets, 'fetch_table', Mock(return_value=source))
    with TestClient(application()) as client:
        payload = client.get('/api/platform/operations/dashboard').json()
    data = payload['data']
    assert data['summary']['school_count'] == 2
    assert data['summary']['tested_count'] is None and data['summary']['infected_count'] is None
    assert data['summary']['infection_rate_percent'] is None and data['summary']['coverage_percent'] is None
    assert [item['school'] for item in data['by_school']] == ['Valid school']
    assert data['quality']['conflicting_count'] >= 1
    assert any('ขัด' in warning for warning in payload['warnings'])


def test_duplicate_affiliation_conflict_does_not_publish_arbitrary_first_affiliation(monkeypatch):
    source = [*copy.deepcopy(school_table()[:3]),
              row('One school with conflicting affiliation', affiliation='Affiliation A'),
              row('One school with conflicting affiliation', affiliation='Affiliation B')]
    monkeypatch.setattr(sheets, 'fetch_table', Mock(return_value=source))
    with TestClient(application()) as client:
        payload = client.get('/api/platform/operations/dashboard').json()
    data = payload['data']
    assert data['summary']['school_count'] == 1
    assert data['summary']['tested_count'] is None and data['summary']['infected_count'] is None
    assert data['summary']['infection_rate_percent'] is None
    assert data['by_school'] == [] and data['published_school_count'] == 0
    assert 'Affiliation A' not in data['available_affiliations']
    assert 'Affiliation B' not in data['available_affiliations']
    assert all(item['affiliation'] not in {'Affiliation A', 'Affiliation B'} for item in data['by_affiliation'])
    assert data['quality']['conflicting_count'] >= 1
    assert any('ไม่ตรงกัน' in warning for warning in payload['warnings'])

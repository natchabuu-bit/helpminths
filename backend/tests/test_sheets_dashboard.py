"""Synthetic worksheet fixtures test read-only statistics, never project evidence."""
from __future__ import annotations

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.platform import sheets_dashboard as sheets
from backend.platform.auth import router as auth_router
from backend.platform.store import PlatformStore


@pytest.fixture(autouse=True)
def clean_configuration(monkeypatch):
    import os
    for name in list(os.environ):
        if name.startswith('HELPMINTHS_SHEETS_') or name == 'HELPMINTHS_GOOGLE_SERVICE_ACCOUNT_JSON':
            monkeypatch.delenv(name)


def application(tmp_path=None):
    app = FastAPI()
    app.state.platform_store = PlatformStore(tmp_path / 'private' if tmp_path else None)
    app.include_router(auth_router)
    app.include_router(sheets.router)
    return app


def mapping():
    return {'date': 'วันที่', 'year': 'ปีงบประมาณ', 'province': 'จังหวัด', 'tested': 'ผู้ตรวจ', 'infected': 'ผลบวก',
            'parasite': 'ชนิด', 'count': 'จำนวน', 'row_granularity': 'aggregate', 'rows_disjoint': True,
            'population_unit': 'people', 'parasite_counts_unit': 'positive_tests'}


def table():
    return [['ชื่อผู้ป่วย', 'วันที่', 'ปีงบประมาณ', 'จังหวัด', 'ผู้ตรวจ', 'ผลบวก', 'ชนิด', 'จำนวน', 'สถานะ'],
            ['PRIVATE_PERSON_A', '30/10/2569', '2569', 'จ.พิษณุโลก', '100', '10', 'OV', '10', 'สำเร็จ'],
            ['PRIVATE_PERSON_B', '2026-11-01', '2569', 'Sukhothai', '80', '4', 'Hookworm', '4', 'กำลังดำเนินการ'],
            ['PRIVATE_PERSON_C', '2025-12-01', '2568', 'ตาก', '20', '2', 'PRIVATE_PERSON_SECRET', '2', 'PRIVATE_STATUS_SECRET'],
            ['not a person', '', '2569', 'รวม', '200', '16', 'Total', '16', '']]


def test_provided_source_is_public_aggregate_but_never_fabricates_failed_source(monkeypatch):
    monkeypatch.setattr(sheets, 'fetch_table', Mock(side_effect=sheets.SourceError('connection_failed', 'เชื่อมต่อไม่ได้')))
    with TestClient(application()) as client:
        status = client.get('/api/platform/operations/status').json()
        assert status['source']['spreadsheet_id'] == sheets.PROJECT_SHEET_ID
        assert status['configured'] is True and status['access'] == 'public_aggregates'
        result = client.get('/api/platform/operations/dashboard')
        assert result.status_code == 200
        assert result.json()['status'] == 'unavailable'
        assert result.json()['data'] is None and result.json()['fetched_at'] is None
        assert result.json()['error']['code'] == 'connection_failed'
        client.get('/api/platform/operations/dashboard')
        assert sheets.fetch_table.call_count == 1, 'Polling must respect source retry/cache interval'


def test_rows_are_not_assumed_people_and_no_free_text_is_exposed(monkeypatch):
    monkeypatch.setattr(sheets, 'fetch_table', lambda _: table())
    with TestClient(application()) as client:
        result = client.get('/api/platform/operations/dashboard').json()
        assert result['status'] == 'mapping_required'
        assert result['data']['row_count'] == 4
        assert result['data']['tested_count'] is None
        assert result['data']['infected_count'] is None
        assert result['data']['infection_rate_percent'] is None
        assert result['data']['by_parasite'] == []
        assert any(item['key'] == 'completed' and item['count'] == 1 for item in result['data']['statuses'])
        assert {item['province'] for item in result['data']['by_province']} == {'พิษณุโลก', 'สุโขทัย', 'ตาก'}
        assert 'PRIVATE_' not in json.dumps(result), 'Names and unrecognized status/category text must never leave the server'


def test_explicit_reviewed_schema_counts_filters_years_and_total_rows_without_double_count(monkeypatch):
    monkeypatch.setenv('HELPMINTHS_SHEETS_COLUMN_MAPPING', json.dumps(mapping(), ensure_ascii=False))
    monkeypatch.setattr(sheets, 'fetch_table', Mock(return_value=table()))
    with TestClient(application()) as client:
        result = client.get('/api/platform/operations/dashboard').json()
        data = result['data']
        assert result['status'] == 'ready'
        assert data['tested_count'] == 200 and data['infected_count'] == 16
        assert data['infection_rate_percent'] == 8.0
        assert data['available_years'] == [2568, 2569]
        assert data['by_parasite'] == [{'parasite': 'Hookworm', 'count': 4, 'unit': 'positive_tests'}, {'parasite': 'Opisthorchis viverrini', 'count': 10, 'unit': 'positive_tests'}]
        selected = client.get('/api/platform/operations/dashboard?year=2026&province=พิษณุโลก').json()
        assert selected['data']['tested_count'] == 100 and selected['data']['infected_count'] == 10
        assert selected['data']['filters_applied']['year'] == 2569
        assert selected['fetched_at'] == result['fetched_at']
        assert sheets.fetch_table.call_count == 1
        dated = client.get('/api/platform/operations/dashboard?from_date=2026-11-01&to_date=2026-11-30').json()
        assert dated['data']['tested_count'] == 80
        assert client.get('/api/platform/operations/dashboard?province=PRIVATE_PERSON_A').status_code == 422
        assert client.get('/api/platform/operations/dashboard?from_date=2026-12-01&to_date=2026-01-01').status_code == 422
        assert client.get('/api/platform/operations/dashboard?status=invalid').status_code == 422


def test_missing_or_inconsistent_denominators_do_not_produce_infection_rate():
    config = replace(sheets.SheetsConfig.from_environment(), mapping=mapping())
    source = table()
    source[1][5] = '200'
    rows, info, _ = sheets.parse_table(source, config)
    data, warning = sheets.aggregate(rows, info, config, {})
    assert data['tested_count'] is None and data['infected_count'] is None
    assert data['infection_rate_percent'] is None and warning
    source[1][5] = ''
    rows, info, _ = sheets.parse_table(source, config)
    data, _ = sheets.aggregate(rows, info, config, {})
    assert data['tested_count'] == 200 and data['infected_count'] is None
    assert data['infection_rate_percent'] is None
    config = replace(config, mapping={**mapping(), 'rows_disjoint': False})
    rows, info, _ = sheets.parse_table(table(), config)
    data, _ = sheets.aggregate(rows, info, config, {})
    assert data['tested_count'] is None and data['by_parasite'] == []


def test_person_rows_require_actual_test_and_result_flags():
    config = replace(sheets.SheetsConfig.from_environment(), mapping={**mapping(), 'row_granularity': 'person'})
    source = [['วันที่', 'จังหวัด', 'ผู้ตรวจ', 'ผลบวก'], ['๓๐/๑๐/๒๕๖๙', 'ตาก', 'ตรวจแล้ว', 'พบเชื้อ'], ['2026-10-30', 'ตาก', 'ตรวจแล้ว', 'ไม่พบเชื้อ']]
    rows, info, _ = sheets.parse_table(source, config)
    data, _ = sheets.aggregate(rows, info, config, {})
    assert data['tested_count'] == 2 and data['infected_count'] == 1 and data['infection_rate_percent'] == 50
    assert data['trend'] == [{'date': '2026-10-30', 'count': 2}]


def test_header_offset_ambiguous_mapping_empty_sheet_and_limits():
    config = replace(sheets.SheetsConfig.from_environment(), mapping={**mapping(), 'header_row': 2})
    rows, info, _ = sheets.parse_table([['รายงานทดสอบสังเคราะห์'], *table()], config)
    assert len(rows) == 4 and info['schema_valid'] is True
    rows, info, _ = sheets.parse_table([], config)
    data, _ = sheets.aggregate(rows, info, config, {})
    assert data['row_count'] == 0 and data['tested_count'] is None
    assert next(item for item in data['metrics'] if item['key'] == 'province_count')['value'] is None
    with pytest.raises(sheets.SourceError):
        sheets.parse_table([['header']] * (sheets.MAX_ROWS + 3), config)
    with pytest.raises(sheets.SourceError):
        sheets.parse_table([['header'] * 201], config)


def test_cached_success_time_is_preserved_on_failure_and_refresh_is_single_flight(monkeypatch):
    config = sheets.SheetsConfig.from_environment()
    cache = sheets.SheetsCache()
    fake = Mock(return_value=table())
    monkeypatch.setattr(sheets, 'fetch_table', fake)
    first = cache.snapshot(config, {})
    assert first['status'] == 'mapping_required' and first['fetched_at']
    cache.next_attempt = 0
    fake.side_effect = sheets.SourceError('connection_failed', 'ขัดข้อง')
    stale = cache.snapshot(config, {})
    assert stale['status'] == 'stale' and stale['fetched_at'] == first['fetched_at']
    assert stale['data'] == first['data']
    fresh = sheets.SheetsCache()
    calls = 0
    def slow(_):
        nonlocal calls
        calls += 1
        time.sleep(.03)  # Deterministic test contention, not a production wait.
        return table()
    monkeypatch.setattr(sheets, 'fetch_table', slow)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: fresh.snapshot(config, {}), range(4)))
    assert calls == 1 and len({item['fetched_at'] for item in results}) == 1


def test_custom_source_authentication_and_explicit_public_opt_in(tmp_path, monkeypatch):
    monkeypatch.setenv('HELPMINTHS_SHEETS_ID', 'CUSTOM_TEST_SHEET_2026')
    monkeypatch.setattr(sheets, 'fetch_table', lambda _: table())
    app = application(tmp_path)
    password = 'Synthetic-sheet-test-only-2026!'
    app.state.platform_store.create_user('sheet_student', password, 'student')
    with TestClient(app, base_url='https://testserver') as client:
        assert client.get('/api/platform/operations/status').json()['access'] == 'authenticated'
        assert client.get('/api/platform/operations/dashboard').status_code == 401
        assert client.post('/api/platform/login', json={'username': 'sheet_student', 'password': password}).status_code == 200
        assert client.get('/api/platform/operations/dashboard').status_code == 200
        monkeypatch.setenv('HELPMINTHS_SHEETS_PUBLIC_AGGREGATES', '1')
        client.cookies.clear()
        assert client.get('/api/platform/operations/dashboard').status_code == 200


def test_disabled_invalid_config_and_safe_fetch_errors(monkeypatch):
    monkeypatch.setenv('HELPMINTHS_SHEETS_ENABLED', '0')
    with TestClient(application()) as client:
        assert client.get('/api/platform/operations/dashboard').json()['status'] == 'not_configured'
        monkeypatch.setenv('HELPMINTHS_SHEETS_REFRESH_SECONDS', '1')
        assert client.get('/api/platform/operations/status').status_code == 503
    monkeypatch.setenv('HELPMINTHS_SHEETS_REFRESH_SECONDS', '30')
    handler = sheets.SafeRedirects()
    request = sheets.urllib.request.Request('https://docs.google.com/source')
    with pytest.raises(sheets.SourceError):
        handler.redirect_request(request, None, 302, 'redirect', {}, 'http://169.254.169.254/private')
    protected = sheets.urllib.request.Request('https://sheets.googleapis.com/source', headers={'Authorization': 'Bearer SYNTHETIC_SECRET'})
    with pytest.raises(sheets.SourceError):
        handler.redirect_request(protected, None, 302, 'redirect', {}, 'https://docs.google.com/source')
    monkeypatch.setattr(sheets, 'fetch_bytes', lambda *_args: (b'<html>login</html>', 'text/html'))
    # Real fetch_bytes detects HTML; fetch_table independently rejects JSON error payloads.
    monkeypatch.setattr(sheets, 'fetch_bytes', lambda *_args: (b'{"error":"private"}', 'application/json'))
    with pytest.raises(sheets.SourceError, match='CSV'):
        sheets.fetch_table(replace(sheets.SheetsConfig.from_environment(), data_format='csv'))


def school_table():
    """Header transcribed from user; every numeric row/name is a synthetic fixture."""
    main = ['โรงเรียน', 'ตำบล', 'อำเภอ', 'จังหวัด', 'จำนวนนักเรียนทั้งหมด (คน)', 'จำนวนนักเรียนส่งตรวจ (คน)',
            'ความครอบคลุม (%)', 'ตรวจพบพยาธิ จำนวน (คน)', 'ร้อยละ', *([''] * 18), 'สังกัด']
    groups = [''] * 28
    counts = [''] * 28
    for index, label in [(9, 'ปากขอ'), (11, 'ไส้เดือน'), (13, 'แส้ม้า'), (15, 'ใบไม้ตับ'), (17, 'เข็มหมุด'),
                         (19, 'ตืด'), (21, 'ลำไส้ขนาดกลาง'), (23, 'สตรองจิลอย'), (25, 'มากกว่า 1 ชนิด')]:
        groups[index] = label
        counts[index], counts[index + 1] = 'จำนวน (คน)', 'ร้อยละ'
    def row(school, province, total, tested, positive, parasite_counts, mixed):
        result = [school, 'PRIVATE_TAMBON', 'PRIVATE_DISTRICT', province, str(total), str(tested), '99', str(positive), '99']
        for number in [*parasite_counts, mixed]:
            result.extend([str(number), '99'])
        return [*result, 'PRIVATE_AFFILIATION']
    return [main, groups, counts,
            row('รวมไทยพัฒนา1', 'ตาก', 100, 50, 5, [2, 1, 1, 1, 0, 0, 0, 0], 1),
            row('PRIVATE_SCHOOL_B', 'พิษณุโลก', 300, 250, 25, [10, 5, 4, 3, 1, 1, 1, 0], 3),
            row('รวมจังหวัดตาก', 'ตาก', 10000, 5000, 1000, [1000] * 8, 1000)]


def test_user_school_header_preset_uses_matched_denominators_and_not_reported_percentages(monkeypatch):
    monkeypatch.setattr(sheets, 'fetch_table', lambda _: school_table())
    with TestClient(application()) as client:
        result = client.get('/api/platform/operations/dashboard').json()
        data = result['data']
        assert result['status'] == 'ready' and data['schema_id'] == 'health2-kpd-school-v1'
        assert data['row_count'] == data['school_count'] == 2
        assert data['total_students'] == 400 and data['tested_count'] == 300
        assert data['coverage_percent'] == 75 and data['infected_count'] == 30
        assert data['infection_rate_percent'] == 10 and data['multiple_infections_count'] == 4
        assert len(data['by_parasite']) == 8
        assert data['by_parasite'][0] == {'parasite': 'พยาธิปากขอ', 'count': 12, 'unit': 'people'}
        assert all(item['parasite'] != 'มากกว่า 1 ชนิด' for item in data['by_parasite'])
        assert data['available_years'] == [] and data['trend'] == []
        assert 'PRIVATE_' not in json.dumps(result) and 'รวมไทยพัฒนา' not in json.dumps(result, ensure_ascii=False)
        selected = client.get('/api/platform/operations/dashboard?province=ตาก').json()['data']
        assert selected['school_count'] == 1 and selected['tested_count'] == 50
        assert selected['infection_rate_percent'] == 10


def test_school_header_is_strict_and_never_assigns_species_or_counts_by_position_only():
    config = sheets.SheetsConfig.from_environment()
    source = school_table()
    source[1][9] = 'UNKNOWN_GROUP'
    rows, info, _ = sheets.parse_table(source, config)
    data, _ = sheets.aggregate(rows, info, config, {})
    assert info.get('schema_id') is None
    assert data['tested_count'] is None and data['by_parasite'] == []


def test_school_duplicates_missing_cells_and_bad_count_relationships_are_explicit():
    config = sheets.SheetsConfig.from_environment()
    source = school_table()
    source.append(source[3].copy())
    rows, info, warnings = sheets.parse_table(source, config)
    data, _ = sheets.aggregate(rows, info, config, {})
    assert data['school_count'] == 2 and data['tested_count'] == 300
    assert any('ซ้ำ' in warning for warning in warnings)
    source[-1][5] = '60'
    rows, info, warnings = sheets.parse_table(source, config)
    data, _ = sheets.aggregate(rows, info, config, {})
    assert data['school_count'] == 2 and data['tested_count'] is None and data['infection_rate_percent'] is None
    assert any('ไม่ตรงกัน' in warning for warning in warnings)
    source = school_table()
    source[3][5] = '101'  # Tested exceeds total100: not a valid denominator.
    rows, info, warnings = sheets.parse_table(source, config)
    data, _ = sheets.aggregate(rows, info, config, {})
    assert data['tested_count'] is None and data['infected_count'] is None and data['coverage_percent'] is None
    source = school_table()
    source[3][25] = '-'
    rows, info, _ = sheets.parse_table(source, config)
    data, _ = sheets.aggregate(rows, info, config, {})
    assert data['multiple_infections_count'] is None and data['tested_count'] == 300
    source[3][3] = 'UNKNOWN_PRIVATE_PROVINCE'
    rows, info, _ = sheets.parse_table(source, config)
    all_data, _ = sheets.aggregate(rows, info, config, {})
    known_data, _ = sheets.aggregate(rows, info, config, {'province': 'พิษณุโลก'})
    assert all_data['tested_count'] is None and known_data['tested_count'] == 250
    assert 'UNKNOWN_PRIVATE' not in json.dumps(all_data)


def test_school_subtotal_count_labels_do_not_double_count_real_schools():
    """Summary labels contain counts; the legitimate รวมไทยพัฒนา school stays."""
    config = sheets.SheetsConfig.from_environment()
    source = school_table()
    for label in ('รวม 2 โรงเรียน', 'Total (2 schools)', 'Subtotal 2 schools', 'รวมทั้งจังหวัดตาก'):
        summary = source[3].copy()
        summary[0] = label
        source.append(summary)
    rows, info, warnings = sheets.parse_table(source, config)
    data, _ = sheets.aggregate(rows, info, config, {})
    assert data['school_count'] == 2
    assert data['total_students'] == 400 and data['tested_count'] == 300
    assert data['infected_count'] == 30 and data['infection_rate_percent'] == 10
    assert any('แถวสรุป' in warning for warning in warnings)


def test_distinct_thai_school_names_keep_tone_marks_in_private_dedup_identity():
    """Tone marks distinguish actual Thai words, even within one location."""
    config = sheets.SheetsConfig.from_environment()
    source = school_table()[:3]
    original = school_table()[3]
    for label in ('โรงเรียนบ้านป่า', 'โรงเรียนบ้านปา'):
        row = original.copy()
        row[0] = label
        source.append(row)
    rows, info, warnings = sheets.parse_table(source, config)
    data, _ = sheets.aggregate(rows, info, config, {})
    assert data['school_count'] == 2
    assert data['total_students'] == 200 and data['tested_count'] == 100
    assert data['infected_count'] == 10
    assert not any('โรงเรียนซ้ำ' in warning for warning in warnings)
    serialized = json.dumps(data, ensure_ascii=False)
    assert 'โรงเรียนบ้านป่า' not in serialized and 'โรงเรียนบ้านปา' not in serialized


def test_private_reader_uses_readonly_scope_bounded_refresh_and_actual_first_tab(monkeypatch):
    """A synthetic OAuth transport checks the adapter contract, not live Google access."""
    import sys
    from types import ModuleType
    from urllib.parse import unquote

    for name in ('google', 'google.auth', 'google.auth.transport', 'google.oauth2'):
        package = ModuleType(name)
        package.__path__ = []
        monkeypatch.setitem(sys.modules, name, package)
    request_module = ModuleType('google.auth.transport.requests')
    account_module = ModuleType('google.oauth2.service_account')
    refresh_calls = []

    class SyntheticRequest:
        def __call__(self, *args, **kwargs):
            assert 0 < kwargs['timeout'] <= 12
            refresh_calls.append(kwargs)
            return None

    class SyntheticCredentials:
        token = 'SYNTHETIC_TEST_TOKEN_NOT_A_CREDENTIAL'

        @classmethod
        def from_service_account_info(cls, info, scopes):
            assert info['token_uri'] == 'https://oauth2.googleapis.com/token'
            assert scopes == ['https://www.googleapis.com/auth/spreadsheets.readonly']
            return cls()

        def refresh(self, request):
            request('https://oauth2.googleapis.com/token', method='POST')

    request_module.Request = SyntheticRequest
    account_module.Credentials = SyntheticCredentials
    monkeypatch.setitem(sys.modules, request_module.__name__, request_module)
    monkeypatch.setitem(sys.modules, account_module.__name__, account_module)
    monkeypatch.setattr(sys.modules['google.oauth2'], 'service_account', account_module, raising=False)
    monkeypatch.setenv('HELPMINTHS_GOOGLE_SERVICE_ACCOUNT_JSON', json.dumps({'token_uri': 'https://oauth2.googleapis.com/token'}))
    responses = Mock(side_effect=[
        (json.dumps({'sheets': [{'properties': {'title': "สำรวจ กพด. '69"}}]}).encode(), 'application/json'),
        (json.dumps({'values': school_table()}, ensure_ascii=False).encode(), 'application/json'),
    ])
    monkeypatch.setattr(sheets, 'fetch_bytes', responses)
    result = sheets.fetch_table(sheets.SheetsConfig.from_environment())
    assert result == school_table()
    assert len(refresh_calls) == 1 and responses.call_count == 2
    assert 'fields=sheets.properties.title' in responses.call_args_list[0].args[0]
    decoded = unquote(responses.call_args_list[1].args[0])
    assert "/values/'สำรวจ กพด. ''69'" in decoded
    assert 'Sheet1' not in decoded
    assert all(call.args[1] == SyntheticCredentials.token for call in responses.call_args_list)


def test_broad_source_parasite_categories_are_not_relabelled_as_unproven_species():
    config = replace(sheets.SheetsConfig.from_environment(), mapping=mapping())
    source = table()[:3]
    source[1][6] = 'พยาธิใบไม้ตับ'
    source[2][6] = 'พยาธิตืด'
    rows, info, _ = sheets.parse_table(source, config)
    data, _ = sheets.aggregate(rows, info, config, {})
    labels = {row['parasite'] for row in data['by_parasite']}
    assert labels == {'พยาธิใบไม้ตับ', 'พยาธิตืด'}
    assert 'Opisthorchis viverrini' not in labels and 'Taenia spp.' not in labels


def excel_bytes(*, formula=False):
    import io
    from openpyxl import Workbook
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = 'SYNTHETIC SCHOOL REPORT'
    for row in school_table():
        worksheet.append(row)
    if formula:
        worksheet['F4'] = '=25+25'  # No cached result: the reader must not evaluate it.
    output = io.BytesIO()
    workbook.save(output)
    workbook.close()
    return output.getvalue()


def test_office_editing_link_retries_same_file_as_excel_and_publishes_only_aggregates(monkeypatch):
    payload = excel_bytes()
    calls = []
    def fetch(url, token=None):
        calls.append(url)
        assert token is None
        if '/export?' in url:
            raise sheets.SourceError('invalid_sheet_data', 'Synthetic Office file is not a native Sheet')
        assert url.startswith('https://drive.usercontent.google.com/download?')
        assert sheets.PROJECT_SHEET_ID in url
        return payload, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    monkeypatch.setattr(sheets, 'fetch_bytes', fetch)
    with TestClient(application()) as client:
        result = client.get('/api/platform/operations/dashboard').json()
    assert result['status'] == 'ready' and len(calls) == 2
    assert result['data']['school_count'] == 2 and result['data']['tested_count'] == 300
    assert result['data']['infected_count'] == 30 and result['data']['infection_rate_percent'] == 10
    assert 'PRIVATE_' not in json.dumps(result)


def test_excel_reader_never_evaluates_formulas_and_rejects_bad_or_oversized_workbooks(monkeypatch):
    config = replace(sheets.SheetsConfig.from_environment(), data_format='xlsx')
    table = sheets.read_excel(excel_bytes(formula=True), config)
    rows, info, _ = sheets.parse_table(table, config)
    data, _ = sheets.aggregate(rows, info, config, {})
    assert data['tested_count'] is None and data['infection_rate_percent'] is None
    with pytest.raises(sheets.SourceError, match='แท็บ'):
        sheets.read_excel(excel_bytes(), replace(config, worksheet='MISSING_TEST_TAB'))
    with pytest.raises(sheets.SourceError, match='Excel'):
        sheets.read_excel(b'not an Excel file', config)
    import io
    import zipfile
    oversized = io.BytesIO()
    with zipfile.ZipFile(oversized, 'w') as archive:
        for index in range(2001):
            archive.writestr(f'test-{index}', b'')
    with pytest.raises(sheets.SourceError, match='ขยายใหญ่'):
        sheets.read_excel(oversized.getvalue(), config)

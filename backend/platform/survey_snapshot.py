"""Public statistics from an imported, versioned, aggregate-only workbook snapshot.

The original workbook and institution-level records are not exposed by this API.
A snapshot is a dated import, not a live Google Sheets connection. Missing counts
remain unknown; source arithmetic consistency is not clinical verification.
"""
from __future__ import annotations

import csv
import io
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

from fastapi import HTTPException

DATASET_PATH = Path(__file__).resolve().parents[1] / 'data' / 'health-survey-2569.json'
PARASITES = (
    ('hookworm', 'พยาธิปากขอ'), ('ascaris', 'พยาธิไส้เดือน'),
    ('trichuris', 'พยาธิแส้ม้า'), ('liver_fluke', 'พยาธิใบไม้ตับ'),
    ('pinworm', 'พยาธิเข็มหมุด'), ('tapeworm', 'พยาธิตืด'),
    ('medium_intestinal', 'พยาธิใบไม้ลำไส้ขนาดกลาง'), ('strongyloides', 'สตรองจิลอย'),
)
STATUS_OPTIONS = (
    {'key': 'tested', 'label': 'ส่งตรวจมากกว่า 0 คน'},
    {'key': 'zero_tested', 'label': 'รายงานส่งตรวจ 0 คน'},
    {'key': 'pending', 'label': 'รอข้อมูลจำนวน'},
)
POSITIVITY_BANDS = (
    {'key': 'none', 'label': 'ไม่พบ (0%)'},
    {'key': 'under5', 'label': 'มากกว่า 0 ถึงน้อยกว่า 5%'},
    {'key': '5to10', 'label': '5 ถึงน้อยกว่า 10%'},
    {'key': '10to20', 'label': '10 ถึงน้อยกว่า 20%'},
    {'key': '20plus', 'label': '20% ขึ้นไป'},
)
BAND_KEYS = {item['key'] for item in POSITIVITY_BANDS}
FILTERS = {'year', 'province', 'district', 'affiliation', 'record_status', 'positivity_band'}


def available(path: str | Path | None = None) -> bool:
    return (Path(path) if path is not None else DATASET_PATH).is_file()


def _number(value: Any, *, nullable: bool = True) -> bool:
    return (value is None and nullable) or (type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 10**12)


def load_dataset(path: str | Path | None = None) -> dict:
    selected = Path(path) if path is not None else DATASET_PATH
    try:
        if selected.is_symlink() or selected.stat().st_size > 5 * 1024 * 1024:
            raise ValueError
        snapshot = json.loads(selected.read_text(encoding='utf-8'))
        if snapshot.get('schema_version') != 1 or not isinstance(snapshot.get('dataset'), dict):
            raise ValueError
        dataset = snapshot['dataset']
        if not all(isinstance(dataset.get(key), str) and dataset[key] for key in ('id', 'version', 'file_name', 'worksheet', 'imported_at')):
            raise ValueError
        if type(dataset.get('year')) is not int or not 2400 <= dataset['year'] <= 2743:
            raise ValueError
        cubes = snapshot.get('cubes')
        if not isinstance(cubes, list) or len(cubes) > 10000 or not isinstance(snapshot.get('issues', []), list):
            raise ValueError
        for row in cubes:
            if not isinstance(row, dict) or row.get('status') not in {'tested', 'zero_tested', 'pending'}:
                raise ValueError
            if dataset.get('band_partitioned'):
                band = row.get('positivity_band')
                if row['status'] == 'tested':
                    if band not in BAND_KEYS:
                        raise ValueError
                elif band is not None:
                    raise ValueError
            if not all(isinstance(row.get(key), str) and 0 < len(row[key]) <= 160 for key in ('province', 'district', 'affiliation')):
                raise ValueError
            if not all(_number(row.get(key), nullable=False) for key in ('school_count', 'positive_school_count')):
                raise ValueError
            if not all(_number(row.get(key)) for key in ('enrolled', 'tested', 'infected', 'coinfection')):
                raise ValueError
            if row['positive_school_count'] > row['school_count']:
                raise ValueError
            if row.get('infected') is not None and row.get('tested') is not None and row['infected'] > row['tested']:
                raise ValueError
            if row.get('tested') is not None and row.get('enrolled') is not None and row['tested'] > row['enrolled']:
                raise ValueError
            types = row.get('parasites')
            if not isinstance(types, dict):
                raise ValueError
            for key, _ in PARASITES:
                values = types.get(key)
                if not isinstance(values, dict) or not all(_number(values.get(field)) for field in ('reported', 'consistent')):
                    raise ValueError
                if not all(_number(values.get(field), nullable=False) for field in ('conflicting', 'missing', 'tested_missing')):
                    raise ValueError
        return snapshot
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        raise HTTPException(503, 'ชุดข้อมูลสรุปที่นำเข้ายังไม่พร้อมใช้งาน กรุณาตรวจไฟล์ข้อมูลบนเซิร์ฟเวอร์') from None


def _source(snapshot: dict) -> dict:
    dataset = snapshot['dataset']
    return {
        'provider': 'uploaded_workbook', 'spreadsheet_id': dataset['id'], 'id': dataset['id'],
        'url': None, 'format': 'snapshot', 'file_name': dataset['file_name'], 'worksheet': dataset['worksheet'],
        'version': dataset['version'], 'imported_at': dataset['imported_at'], 'year': dataset['year'],
        'year_basis': dataset.get('year_basis', 'filename'), 'data_status': 'imported_snapshot',
    }


def metadata(dataset: dict | None = None) -> dict:
    snapshot = dataset if dataset is not None else load_dataset()
    return {
        'configured': True, 'source': _source(snapshot), 'refresh_seconds': 0,
        'access': 'public_aggregates', 'mapping_configured': True,
        'capabilities': {'read_only': True, 'raw_rows_exposed': False, 'mode': 'snapshot',
                         'filters': ['year', 'province', 'district', 'affiliation', 'record_status']
                                    + (['positivity_band'] if snapshot['dataset'].get('band_partitioned') else []),
                         'clinical_validation_claimed': False},
    }


def _sum_known(rows: list[dict], key: str) -> int | float | None:
    values = [row[key] for row in rows if row.get(key) is not None]
    return sum(values) if values else None


def _ratio(numerator: int | float | None, denominator: int | float | None) -> float | None:
    return round(numerator / denominator * 100, 4) if numerator is not None and denominator is not None and denominator > 0 else None


def _summary(rows: list[dict]) -> dict:
    school_count = sum(row['school_count'] for row in rows)
    tested_schools = sum(row['school_count'] for row in rows if row['status'] == 'tested')
    zero_schools = sum(row['school_count'] for row in rows if row['status'] == 'zero_tested')
    pending = sum(row['school_count'] for row in rows if row['status'] == 'pending')
    positive_schools = sum(row['positive_school_count'] for row in rows)
    enrolled, tested, infected, mixed = (_sum_known(rows, key) for key in ('enrolled', 'tested', 'infected', 'coinfection'))
    return {
        'school_count': school_count, 'reported_school_count': tested_schools + zero_schools,
        'tested_school_count': tested_schools, 'zero_tested_school_count': zero_schools,
        'pending_school_count': pending, 'positive_school_count': positive_schools,
        'negative_school_count': max(0, tested_schools - positive_schools),
        'total_students_known': enrolled, 'tested_count': tested, 'infected_count': infected,
        'negative_count': tested - infected if tested is not None and infected is not None else None,
        'coverage_percent': _ratio(tested, enrolled), 'infection_rate_percent': _ratio(infected, tested),
        'multiple_infections_count': mixed,
        'unsubmitted_known_count': enrolled - tested if enrolled is not None and tested is not None else None,
        'province_count': len({row['province'] for row in rows}),
        'district_count': len({(row['province'], row['district']) for row in rows}),
        'affiliation_count': len({row['affiliation'] for row in rows}),
    }


def _clean_filters(filters: dict | None, snapshot: dict) -> dict:
    supplied = {key: value for key, value in (filters or {}).items() if value is not None and value != ''}
    if set(supplied) - FILTERS:
        raise HTTPException(422, 'ชุดข้อมูลไฟล์นี้รองรับตัวกรองจังหวัด อำเภอ สังกัด สถานะข้อมูล ช่วงร้อยละตรวจพบ และปีชุดข้อมูลเท่านั้น')
    for key in ('province', 'district', 'affiliation'):
        if key in supplied and (not isinstance(supplied[key], str) or len(supplied[key]) > 160):
            raise HTTPException(422, 'ตัวกรองข้อมูลไม่ถูกต้อง')
    if 'year' in supplied:
        try:
            year = int(supplied['year'])
            if 1900 <= year <= 2200:
                year += 543
            if year != snapshot['dataset']['year']:
                raise ValueError
            supplied['year'] = year
        except (ValueError, TypeError):
            raise HTTPException(422, 'ไม่มีปีชุดข้อมูลที่เลือกในไฟล์นำเข้านี้') from None
    if supplied.get('record_status') == 'all':
        supplied.pop('record_status')
    if supplied.get('record_status') not in {None, 'tested', 'zero_tested', 'pending', 'reported'}:
        raise HTTPException(422, 'สถานะข้อมูลที่เลือกไม่ถูกต้อง')
    if 'positivity_band' in supplied:
        if supplied['positivity_band'] not in BAND_KEYS or not snapshot['dataset'].get('band_partitioned'):
            raise HTTPException(422, 'ช่วงร้อยละตรวจพบที่เลือกไม่ถูกต้องหรือชุดข้อมูลยังไม่รองรับ')
    rows = snapshot['cubes']
    for key in ('province', 'district', 'affiliation'):
        if key in supplied and supplied[key] not in {row[key] for row in rows}:
            raise HTTPException(422, f'ไม่พบตัวกรอง{dict(province="จังหวัด", district="อำเภอ", affiliation="สังกัด")[key]}ที่เลือกในชุดข้อมูล')
    return supplied


def _select(rows: list[dict], filters: dict, omit: str | None = None) -> list[dict]:
    selected = rows
    for key in ('province', 'district', 'affiliation'):
        if key != omit and filters.get(key):
            selected = [row for row in selected if row[key] == filters[key]]
    status = filters.get('record_status')
    if status == 'reported':
        selected = [row for row in selected if row['status'] != 'pending']
    elif status:
        selected = [row for row in selected if row['status'] == status]
    band = filters.get('positivity_band')
    if band and omit != 'positivity_band':
        selected = [row for row in selected if row.get('positivity_band') == band]
    return selected


def _group(rows: list[dict], dimension: str) -> list[dict]:
    grouped = defaultdict(list)
    for row in rows:
        key = (row['province'], row['district']) if dimension == 'district' else (row[dimension],)
        grouped[key].append(row)
    output = []
    for key, group in sorted(grouped.items()):
        name = key[-1]
        fields = {'label': name, dimension: name}
        if dimension == 'district':
            fields['province'] = key[0]
        summary = _summary(group)
        output.append({**fields, **summary, 'records': summary['school_count']})
    return output


def _parasites(rows: list[dict], tested: int | float | None) -> list[dict]:
    output = []
    for key, label in PARASITES:
        groups = [row['parasites'][key] for row in rows]
        reported = _sum_known(groups, 'reported')
        consistent = _sum_known(groups, 'consistent')
        flagged = sum(row['conflicting'] for row in groups)
        missing = sum(row['missing'] for row in groups)
        tested_missing = sum(row['tested_missing'] for row in groups)
        rate = _ratio(reported, tested) if not flagged and not tested_missing else None
        output.append({'key': key, 'parasite': label, 'unit': 'people', 'count': reported,
                       'reported_count': reported, 'validated_count': consistent, 'flagged_count': flagged,
                       'missing_school_count': missing, 'tested_missing_school_count': tested_missing,
                       'rate_percent': rate, 'rate_basis': 'reported_counts_among_tested'})
    return output


def _positivity_bands(rows: list[dict]) -> list[dict]:
    """Count only tested units. Unknown/zero denominators have no percentage."""
    return [{**band, **_summary([row for row in rows if row.get('positivity_band') == band['key']])}
            for band in POSITIVITY_BANDS]


def _quality(snapshot: dict, filters: dict, rows: list[dict], parasites: list[dict]) -> dict:
    output = []
    dimensions = ('province', 'district', 'affiliation')
    selected_groups = {tuple(row[key] for key in dimensions) for row in rows}
    for issue in snapshot.get('issues', []):
        if not isinstance(issue, dict):
            continue
        if any(filters.get(key) and issue.get(key) and filters[key] != issue[key] for key in dimensions):
            continue
        scoped = all(issue.get(key) for key in dimensions)
        if scoped and tuple(issue[key] for key in dimensions) not in selected_groups:
            continue
        if filters.get('record_status') and issue.get('status') and issue['status'] != filters['record_status'] and not (filters['record_status'] == 'reported' and issue['status'] != 'pending'):
            continue
        if filters.get('positivity_band') and issue.get('positivity_band') != filters['positivity_band']:
            continue
        # Project only documented, aggregate-safe values; no source school names.
        entry = {key: issue[key] for key in ('id', 'code', 'severity', 'province', 'district', 'affiliation', 'parasite', 'positivity_band') if isinstance(issue.get(key), str)}
        entry['title'] = issue.get('title') or {'source_count_conflict': 'ตัวเลขต้นทางขัดกัน', 'missing_parasite_count': 'บางช่องจำนวนยังไม่ระบุ', 'formula_error': 'สูตรร้อยละต้นทางคำนวณไม่ได้'}.get(issue.get('code'), 'ข้อควรทราบของข้อมูล')
        entry['message'] = str(issue.get('message', ''))
        entry['count'] = issue.get('count', 1) if _number(issue.get('count', 1), nullable=False) else 1
        refs = issue.get('cell_refs', issue.get('cells', []))
        entry['cells'] = [str(ref) for ref in refs if isinstance(ref, str) and len(ref) <= 80] if isinstance(refs, list) else []
        output.append(entry)
    formula = sum(issue['count'] for issue in output if issue.get('code') in {'formula_error', 'percentage_formula_error'})
    return {'issues': output, 'issue_count': len(output),
            'warning_count': sum(issue.get('severity', 'warning') == 'warning' for issue in output),
            'source_summary_matches': snapshot.get('audit', {}).get('summary_reconciled'),
            'formula_error_count': formula, 'missing_count_cells': sum(item['missing_school_count'] for item in parasites),
            'conflicting_count': sum(item['flagged_count'] for item in parasites)}


def _insights(summary: dict, provinces: list[dict], parasites: list[dict]) -> list[str]:
    number = lambda value: f'{value:,.0f}'
    insights = []
    if summary['tested_count'] is None:
        return ['ตัวกรองนี้มีเฉพาะหน่วยที่ยังไม่มีจำนวนคน จึงยังคำนวณผู้ส่งตรวจ ผลตรวจ และร้อยละไม่ได้'] if summary['school_count'] else ['ไม่มีหน่วยรายงานในเงื่อนไขที่เลือก']
    if summary['pending_school_count']:
        insights.append(f"ยอดคนคำนวณจาก {number(summary['reported_school_count'])} หน่วยที่รายงานตัวเลข ยังมี {number(summary['pending_school_count'])} หน่วยรอข้อมูลจำนวนนักเรียนและผลตรวจ")
    if summary['zero_tested_school_count']:
        insights.append(f"มี {number(summary['zero_tested_school_count'])} หน่วยรายงานส่งตรวจ 0 คน แยกจาก {number(summary['tested_school_count'])} หน่วยที่ส่งตรวจจริง")
    positive = summary['infected_count']
    tested = summary['tested_count']
    if positive is not None and tested:
        insights.append(f"ตรวจพบ {number(positive)} คน จากผู้ส่งตรวจ {number(tested)} คน ({summary['infection_rate_percent']:.2f}%) เป็นผลในกลุ่มส่งตรวจของข้อมูลที่เลือก")
    if len(provinces) > 1 and positive:
        dominant = max(provinces, key=lambda row: row['infected_count'] or 0)
        if dominant['tested_count'] is not None and dominant['infected_count'] is not None:
            insights.append(f"{dominant['province']}มีผู้ตรวจพบ {number(dominant['infected_count'])} คน คิดเป็น {dominant['infected_count'] / positive * 100:.1f}% ของผลบวกในชุดที่เลือก และมีผู้ส่งตรวจ {dominant['tested_count'] / tested * 100:.1f}% ของชุดเดียวกัน")
        known = [row for row in provinces if row['coverage_percent'] is not None]
        if known:
            low = min(known, key=lambda row: row['coverage_percent'])
            insights.append(f"{low['province']}มีความครอบคลุมต่ำสุดในจังหวัดที่มีตัวหาร ({low['coverage_percent']:.2f}%) คำนวณจากผู้ส่งตรวจและจำนวนนักเรียนที่ระบุไว้")
    counted = [row for row in parasites if row['reported_count'] is not None]
    if counted and max(row['reported_count'] for row in counted):
        highest = max(counted, key=lambda row: row['reported_count'])
        insights.append(f"{highest['parasite']}มีจำนวนที่รายงานสูงสุด {number(highest['reported_count'])} คน การติดร่วมทำให้ไม่ควรบวกยอดแต่ละกลุ่มเป็นจำนวนคนทั้งหมด")
    return insights


def dashboard(filters: dict | None = None, dataset: dict | None = None) -> dict:
    snapshot = dataset if dataset is not None else load_dataset()
    selected_filters = _clean_filters(filters, snapshot)
    all_rows = snapshot['cubes']
    rows = _select(all_rows, selected_filters)
    summary = _summary(rows)
    parasites = _parasites(rows, summary['tested_count'])
    provinces, districts, affiliations = (_group(rows, key) for key in ('province', 'district', 'affiliation'))
    quality = _quality(snapshot, selected_filters, rows, parasites)
    summary['reported_findings_count'] = _sum_known(parasites, 'reported_count')
    summary['consistent_findings_count'] = _sum_known(parasites, 'validated_count')
    warnings = []
    if summary['pending_school_count']:
        warnings.append('จำนวนนักเรียนและร้อยละครอบคลุมอ้างเฉพาะหน่วยที่รายงานจำนวน หน่วยรอข้อมูลไม่ถูกแทนเป็น 0 คน')
    if quality['conflicting_count']:
        warnings.append('พบตัวเลขแยกชนิดที่ขัดกับจำนวนผู้ส่งตรวจ แสดงค่าตามต้นฉบับพร้อมระบุรายการที่ต้องตรวจทาน ไม่แก้ยอดแทนผู้รายงาน')
    if quality['missing_count_cells']:
        warnings.append('บางช่องจำนวนแยกชนิดไม่มีค่า จึงเป็นผลรวมเฉพาะค่าที่ระบุ ช่องว่างไม่ใช่การยืนยัน 0 คน')
    imported = snapshot['dataset']['imported_at']
    metrics = [
        {'key': 'total_students', 'label': 'นักเรียนที่ระบุจำนวน', 'value': summary['total_students_known'], 'unit': 'คน'},
        {'key': 'tested_count', 'label': 'นักเรียนส่งตรวจ', 'value': summary['tested_count'], 'unit': 'คน'},
        {'key': 'infected_count', 'label': 'ผู้ตรวจพบพยาธิ', 'value': summary['infected_count'], 'unit': 'คน'},
        {'key': 'coverage_percent', 'label': 'ความครอบคลุมจากจำนวนที่ระบุ', 'value': summary['coverage_percent'], 'unit': '%'},
        {'key': 'infection_rate_percent', 'label': 'ร้อยละตรวจพบในกลุ่มส่งตรวจ', 'value': summary['infection_rate_percent'], 'unit': '%'},
        {'key': 'multiple_infections_count', 'label': 'ตรวจพบมากกว่า 1 ชนิด', 'value': summary['multiple_infections_count'], 'unit': 'คน'},
        {'key': 'school_count', 'label': 'หน่วยรายงานในรายการ', 'value': summary['school_count'], 'unit': 'แห่ง'},
        {'key': 'province_count', 'label': 'จังหวัดที่มีข้อมูล', 'value': summary['province_count'], 'unit': 'จังหวัด'},
    ]
    # Options cascade by other dimensions, allowing a selected control to switch
    # without first clearing itself. Only values actually present are returned.
    options = {key + 's': sorted({row[key] for row in _select(all_rows, selected_filters, omit=key)})
               for key in ('province', 'district', 'affiliation')}
    options['provinces'] = sorted({row['province'] for row in all_rows})
    options['statuses'] = [dict(item) for item in STATUS_OPTIONS]
    options['positivity_bands'] = [dict(item) for item in POSITIVITY_BANDS] if snapshot['dataset'].get('band_partitioned') else []
    data = {
        'schema_id': 'imported-health-survey-v1', 'summary': summary, 'metrics': metrics,
        'school_count': summary['school_count'], 'total_students': summary['total_students_known'],
        'tested_count': summary['tested_count'], 'infected_count': summary['infected_count'],
        'coverage_percent': summary['coverage_percent'], 'infection_rate_percent': summary['infection_rate_percent'],
        'multiple_infections_count': summary['multiple_infections_count'], 'row_count': summary['school_count'],
        'by_province': provinces, 'by_district': districts, 'by_affiliation': affiliations, 'by_parasite': parasites,
        'by_positivity_band': _positivity_bands(_select(all_rows, selected_filters, omit='positivity_band'))
                              if snapshot['dataset'].get('band_partitioned') else [],
        'quality': quality, 'insights': _insights(summary, provinces, parasites),
        'available_years': [snapshot['dataset']['year']], 'available_provinces': options['provinces'],
        'available_districts': options['districts'], 'available_affiliations': options['affiliations'],
        'options': options, 'filters_applied': selected_filters, 'trend': [], 'statuses': [],
        'coverage': {'dated_rows': 0, 'status_rows': summary['reported_school_count']},
        'disclaimer': 'ข้อมูลนำเข้าตามไฟล์ ไม่ใช่การติดตามสด ผลเป็นกลุ่มผู้ส่งตรวจ ไม่ใช่ความชุกประชากรทั้งหมด ค่าที่ผ่านเงื่อนไขตรวจตัวเลขไม่ใช่การยืนยันผลทางคลินิก',
    }
    return {'status': 'ready' if rows else 'empty', 'source': _source(snapshot), 'refresh_seconds': 0,
            'fetched_at': imported, 'last_attempt_at': None, 'error': None, 'warnings': warnings, 'data': data}


def _csv_safe(value: Any) -> str:
    text = '' if value is None else str(value)
    if text.lstrip().startswith(('=', '+', '-', '@')) or text.startswith(('\t', '\r', '\n')):
        return "'" + text
    return text


def export_csv(filters: dict | None = None, dataset: dict | None = None) -> bytes:
    response = dashboard(filters, dataset)
    data = response['data']
    output = io.StringIO(newline='')
    writer = csv.writer(output)
    writer.writerow(['dataset_version', 'year_from_filename', 'dimension', 'province', 'district', 'affiliation',
                     'reporting_units', 'reported_units', 'tested_units', 'pending_units', 'known_enrolled',
                     'tested_people', 'reported_positive_people', 'coverage_percent_known_cohort',
                     'positive_percent_among_tested', 'reported_multiple_infections', 'selected_positivity_band'])
    for dimension in ('province', 'district', 'affiliation'):
        for row in data['by_' + dimension]:
            values = [response['source']['version'], response['source']['year'], dimension,
                      row.get('province', ''), row.get('district', ''), row.get('affiliation', ''),
                      row['school_count'], row['reported_school_count'], row['tested_school_count'], row['pending_school_count'],
                      row['total_students_known'], row['tested_count'], row['infected_count'], row['coverage_percent'],
                      row['infection_rate_percent'], row['multiple_infections_count'],
                      data['filters_applied'].get('positivity_band', '')]
            writer.writerow([_csv_safe(value) for value in values])
    return ('\ufeff' + output.getvalue()).encode('utf-8')

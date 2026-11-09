"""Public projections of the explicitly approved live school-summary schema.

Only school statistics from the reviewed three-row header enter this module.
Missing values stay unknown, and no snapshot, source notes, or individual records
are used to fill a live response.
"""
from __future__ import annotations

import unicodedata
from collections import defaultdict
from fractions import Fraction

from fastapi import HTTPException

from .survey_snapshot import PARASITES, POSITIVITY_BANDS, STATUS_OPTIONS, FOLLOWUP_MIN_TESTED, FOLLOWUP_LIMIT


def _ratio(numerator, denominator):
    return round(numerator / denominator * 100, 4) if numerator is not None and denominator and denominator > 0 else None


def _band(infected, tested):
    if infected is None or not tested:
        return None
    if infected == 0:
        return 'none'
    return next((key for threshold, key in ((5, 'under5'), (10, '5to10'), (20, '10to20'))
                 if infected * 100 < threshold * tested), '20plus')


def _records(source_rows):
    records = []
    for row in source_rows:
        tested, infected = row['tested'], row['infected']
        status = ('tested' if tested and infected is not None else
                  'zero_tested' if tested == 0 and infected == 0 else 'pending')
        records.append({**row, 'province': row['province'] or 'ไม่ระบุจังหวัด',
                        'district': row['district'] or 'ไม่ระบุอำเภอ',
                        'affiliation': row['affiliation'] or 'ไม่ระบุสังกัด',
                        '_unknown_province': row['province'] is None,
                        'status': status, 'positivity_band': _band(infected, tested)})
    return records


def _select(rows, filters, omit=None):
    selected = rows
    for key in ('province', 'district', 'affiliation'):
        if key != omit and filters.get(key):
            selected = [row for row in selected if row[key] == filters[key]]
    status = filters.get('record_status')
    if status:
        selected = [row for row in selected if row['status'] != 'pending'] if status == 'reported' else [row for row in selected if row['status'] == status]
    if filters.get('positivity_band') and omit != 'positivity_band':
        selected = [row for row in selected if row['positivity_band'] == filters['positivity_band']]
    if filters.get('school_search'):
        needle = unicodedata.normalize('NFC', filters['school_search']).casefold()
        # The published named subset is tested schools with a known province.
        selected = [row for row in selected if row['status'] == 'tested' and not row['_unknown_province']
                    and needle in unicodedata.normalize('NFC', row['school'] + ' ' + row['tambon']).casefold()]
    return selected


def _clean_filters(filters, rows, info):
    selected = {key: value for key, value in filters.items() if value not in (None, '')}
    allowed = {'year', 'province', 'district', 'affiliation', 'record_status', 'positivity_band', 'school_search'}
    if selected.keys() - allowed:
        raise HTTPException(422, 'สรุปโรงเรียนรองรับตัวกรองปี จังหวัด อำเภอ สังกัด สถานะข้อมูล ช่วงร้อยละ และคำค้นโรงเรียน')
    if 'year' in selected and selected['year'] != info.get('dataset_year'):
        raise HTTPException(422, 'ต้นทางไม่ระบุปีที่เลือก จึงไม่สามารถกรองปีนี้ได้')
    for key in ('province', 'district', 'affiliation'):
        if key in selected and selected[key] not in {row[key] for row in rows}:
            raise HTTPException(422, 'ไม่พบค่าตัวกรองที่เลือกในข้อมูลต้นทาง')
    if selected.get('record_status') == 'all':
        selected.pop('record_status')
    if selected.get('record_status') not in {None, 'tested', 'zero_tested', 'pending', 'reported'}:
        raise HTTPException(422, 'สถานะข้อมูลที่เลือกไม่ถูกต้อง')
    if selected.get('positivity_band') not in {None, *(item['key'] for item in POSITIVITY_BANDS)}:
        raise HTTPException(422, 'ช่วงร้อยละตรวจพบที่เลือกไม่ถูกต้อง')
    if 'school_search' in selected:
        selected['school_search'] = unicodedata.normalize('NFC', selected['school_search']).strip()
        if not selected['school_search']:
            selected.pop('school_search')
    return selected


def _strict_sum(rows, key):
    # Entirely unreported units do not turn known reporting cohorts into zeros.
    cohort = [row for row in rows if not row['_pending_counts']]
    if not cohort or any(row['_unknown_province'] for row in rows) or any(row[key] is None for row in cohort):
        return None
    return sum(row[key] for row in cohort)


def _summary(rows):
    total, tested, infected, multiple = (_strict_sum(rows, key) for key in ('total_students', 'tested', 'infected', 'multiple_infections'))
    statuses = {key: sum(row['status'] == key for row in rows) for key in ('tested', 'zero_tested', 'pending')}
    positive = sum(row['status'] == 'tested' and row['infected'] > 0 for row in rows)
    return {'school_count': len(rows), 'reported_school_count': statuses['tested'] + statuses['zero_tested'],
            'tested_school_count': statuses['tested'], 'zero_tested_school_count': statuses['zero_tested'],
            'pending_school_count': statuses['pending'], 'positive_school_count': positive,
            'negative_school_count': statuses['tested'] - positive,
            'total_students_known': total, 'tested_count': tested, 'infected_count': infected,
            'negative_count': tested - infected if tested is not None and infected is not None else None,
            'coverage_percent': _ratio(tested, total), 'infection_rate_percent': _ratio(infected, tested),
            'multiple_infections_count': multiple,
            'unsubmitted_known_count': total - tested if total is not None and tested is not None else None,
            'province_count': len({row['province'] for row in rows if not row['_unknown_province']}),
            'district_count': len({(row['province'], row['district']) for row in rows}),
            'affiliation_count': len({row['affiliation'] for row in rows})}


def _groups(rows, dimension):
    grouped = defaultdict(list)
    for row in rows:
        grouped[(row['province'], row['district']) if dimension == 'district' else (row[dimension],)].append(row)
    return [{dimension: key[-1], 'label': key[-1],
             **({'province': key[0]} if dimension == 'district' else {}),
             **_summary(group), 'records': len(group)} for key, group in sorted(grouped.items())]


def _parasites(rows, tested):
    output = []
    cohort = [row for row in rows if not row['_pending_counts']]
    for key, label in PARASITES:
        counts = [row['school_parasites'][label] for row in cohort]
        missing = sum(value is None for value in counts)
        flagged = sum(row['_parasite_conflicts'][label] for row in rows)
        count = sum(counts) if counts and not missing and not any(row['_unknown_province'] for row in cohort) else None
        output.append({'key': key, 'parasite': label, 'unit': 'people', 'count': count,
                       'reported_count': count, 'validated_count': count, 'flagged_count': flagged,
                       'missing_school_count': missing,
                       'tested_missing_school_count': sum(row['status'] == 'tested' and row['school_parasites'][label] is None for row in cohort),
                       'rate_percent': _ratio(count, tested), 'rate_basis': 'reported_counts_among_tested'})
    return output


def _schools(rows):
    return [{'school_id': row['school_id'], 'school': row['school'], 'label': row['school'],
             **{key: row[key] for key in ('province', 'district', 'affiliation', 'status', 'positivity_band', 'tambon')},
             'total_students_known': row['total_students'], 'tested_count': row['tested'], 'infected_count': row['infected'],
             'coverage_percent': _ratio(row['tested'], row['total_students']),
             'infection_rate_percent': _ratio(row['infected'], row['tested']),
             'multiple_infections_count': row['multiple_infections'],
             'parasite_counts': {key: row['school_parasites'][label] for key, label in PARASITES}}
            for row in sorted(rows, key=lambda row: (row['school'], row['province'], row['district'], row['school_id']))
            if row['status'] == 'tested' and not row['_unknown_province']]


def aggregate_school_summary(source_rows, info, filters):
    all_rows = _records(source_rows)
    selected_filters = _clean_filters(filters, all_rows, info)
    rows = _select(all_rows, selected_filters)
    summary = _summary(rows)
    parasites = _parasites(rows, summary['tested_count'])
    schools = _schools(rows)
    eligible = sorted([row for row in schools if row['tested_count'] >= FOLLOWUP_MIN_TESTED],
                      key=lambda row: (-Fraction(row['infected_count'], row['tested_count']), -row['infected_count'], row['school'], row['school_id']))
    known_findings = [item['count'] for item in parasites if item['count'] is not None]
    summary['reported_findings_count'] = sum(known_findings) if known_findings else None
    summary['consistent_findings_count'] = summary['reported_findings_count']
    options = {key + 's': sorted({row[key] for row in _select(all_rows, selected_filters, omit=key)})
               for key in ('province', 'district', 'affiliation')}
    options['provinces'] = sorted({row['province'] for row in all_rows if not row['_unknown_province']})
    options['statuses'] = [dict(item) for item in STATUS_OPTIONS]
    options['positivity_bands'] = [dict(item) for item in POSITIVITY_BANDS]
    quality = {'issues': [], 'issue_count': 0, 'warning_count': 0, 'source_summary_matches': None,
               'formula_error_count': sum(row['_formula_errors'] for row in rows),
               'missing_count_cells': sum(item['missing_school_count'] for item in parasites),
               'conflicting_count': sum(row['_invalid_counts'] for row in rows) + sum(item['flagged_count'] for item in parasites)}
    for code, key, title, message, severity in (
        ('source_count_conflict', 'conflicting_count', 'ตัวเลขต้นทางขัดกัน', 'ช่องจำนวนที่ไม่ผ่านเงื่อนไขไม่ถูกใช้แทนเป็นศูนย์ กรุณาตรวจต้นทาง', 'warning'),
        ('missing_parasite_count', 'missing_count_cells', 'บางช่องจำนวนแยกชนิดยังไม่พร้อม', 'ผลรวมชนิดที่มีช่องไม่พร้อมจะไม่ถูกคำนวณจากข้อมูลเพียงบางส่วน', 'warning'),
        ('formula_error', 'formula_error_count', 'สูตรร้อยละต้นทางคำนวณไม่ได้', 'คำนวณร้อยละใหม่จากจำนวนที่มีตัวหารรองรับ', 'info')):
        if quality[key]:
            quality['issues'].append({'id': code, 'code': code, 'severity': severity, 'title': title,
                                      'message': message, 'count': quality[key], 'cells': []})
    quality['issue_count'] = len(quality['issues'])
    quality['warning_count'] = sum(issue['severity'] == 'warning' for issue in quality['issues'])
    warnings = ['จำนวนแยกชนิดอาจมีการติดเชื้อร่วม ไม่นำมาบวกแทนจำนวนผู้ตรวจพบพยาธิทั้งหมด; มากกว่า 1 ชนิดแสดงแยกจากชนิดพยาธิ']
    if summary['pending_school_count']:
        warnings.append('หน่วยที่ยังไม่รายงานจำนวนไม่ถูกแทนเป็น 0 คน; คำนวณจากจำนวนที่ยืนยันได้ในกลุ่มที่รายงาน')
    if rows and (summary['tested_count'] is None or summary['infected_count'] is None):
        warnings.append('ข้อมูลจำนวนคนขาดหาย ขัดกัน หรือมีจังหวัดที่อ่านไม่ได้ จึงไม่แสดงยอดรวมที่อาจคลาดเคลื่อน')
    metrics = [{'key': key, 'label': label, 'value': summary[field], 'unit': unit} for key, field, label, unit in (
        ('total_students', 'total_students_known', 'นักเรียนที่ระบุจำนวน', 'คน'),
        ('tested_count', 'tested_count', 'นักเรียนส่งตรวจ', 'คน'),
        ('infected_count', 'infected_count', 'ผู้ตรวจพบพยาธิ', 'คน'),
        ('coverage_percent', 'coverage_percent', 'ความครอบคลุมจากจำนวนที่ระบุ', '%'),
        ('infection_rate_percent', 'infection_rate_percent', 'ร้อยละตรวจพบในกลุ่มส่งตรวจ', '%'),
        ('multiple_infections_count', 'multiple_infections_count', 'ตรวจพบมากกว่า 1 ชนิด', 'คน'),
        ('school_count', 'school_count', 'หน่วยรายงานในรายการ', 'แห่ง'),
        ('province_count', 'province_count', 'จังหวัดที่มีข้อมูล', 'จังหวัด'))]
    data = {'schema_id': 'health2-kpd-school-v1', 'summary': summary, 'metrics': metrics,
            'school_count': summary['school_count'], 'total_students': summary['total_students_known'],
            **{key: summary[key] for key in ('tested_count', 'infected_count', 'coverage_percent', 'infection_rate_percent', 'multiple_infections_count')},
            'row_count': len(rows), **{'by_' + key: _groups(rows, key) for key in ('province', 'district', 'affiliation')},
            'by_parasite': parasites, 'by_school': schools, 'followup_schools': eligible[:FOLLOWUP_LIMIT],
            'followup_eligible_school_count': len(eligible), 'followup_min_tested': FOLLOWUP_MIN_TESTED,
            'named_school_statistics': True, 'published_school_count': len(_schools(all_rows)),
            'by_positivity_band': [{**band, **_summary([row for row in _select(all_rows, selected_filters, omit='positivity_band') if row['positivity_band'] == band['key']])} for band in POSITIVITY_BANDS],
            'quality': quality, 'options': options, 'filters_applied': selected_filters,
            'available_years': [info['dataset_year']] if info.get('dataset_year') is not None else [],
            'available_provinces': options['provinces'], 'available_districts': options['districts'],
            'available_affiliations': options['affiliations'], 'trend': [],
            'statuses': [{**option, 'count': sum(row['status'] == option['key'] for row in rows)} for option in STATUS_OPTIONS],
            'coverage': {'dated_rows': 0, 'status_rows': summary['reported_school_count']},
            'insights': ([f"ตรวจพบ {summary['infected_count']:,} คน จากผู้ส่งตรวจ {summary['tested_count']:,} คน ({summary['infection_rate_percent']:.2f}%) ในข้อมูลที่เลือก"]
                         if summary['infection_rate_percent'] is not None else []),
            'disclaimer': 'ข้อมูลสรุปโรงเรียนจาก Google Sheets แบบอ่านอย่างเดียว ผลเป็นกลุ่มผู้ส่งตรวจ ไม่ใช่ความชุกประชากรทั้งหมด และไม่ใช่การยืนยันผลทางคลินิก'}
    return data, warnings

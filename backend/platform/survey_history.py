"""Descriptive comparisons and reported annual survey series.

Annual percentages supplied in an archive are not reconstructed patient counts.
The last school-data years are recomputed from their count snapshots; older
percentages retain their source limitations and missing observations.
"""
from __future__ import annotations

import math
import unicodedata
from collections import defaultdict
from fractions import Fraction
from typing import Any


CHANGE_THRESHOLD_PP = Fraction(1, 2)
MIN_MATCHED_TESTED = 30
LARGEST_CHANGE_LIMIT = 5


def _text(value: Any) -> str:
    return unicodedata.normalize('NFC', str(value or '')).strip()


def _rate(numerator, denominator):
    return numerator / denominator * 100 if numerator is not None and denominator is not None and denominator > 0 else None


def _delta(previous, current):
    return round(current - previous, 4) if previous is not None and current is not None else None


def _rows(snapshot: dict, filters: dict) -> list[dict]:
    from . import survey_snapshot as api
    if hasattr(api, '_rows_for_filters'):
        return api._rows_for_filters(snapshot, filters)
    return api._select(snapshot['cubes'], filters)


def _affiliation(value: str) -> str:
    name = _text(value)
    if name.startswith('ตชด.'):
        return 'ตชด.'
    if name.startswith(('สพฐ.', 'สพม.')):
        return 'สพฐ.'
    if name.startswith('ศศช.'):
        return 'ศศช.'
    if name in {'ศูนย์เด็กวันเตาะแตะ', 'ศูนย์เด็กวัยเตาะแตะ'}:
        return 'ศูนย์เด็กวัยเตาะแตะ'
    return name


def _match_key(row: dict) -> tuple[str, str, str]:
    # District is intentionally absent: a source institution changed district.
    # Province avoids equating unrelated institutions with common Thai names.
    return _text(row.get('province')), _text(row.get('school')), _text(row.get('tambon'))


def _match_schools(previous: list[dict], current: list[dict]) -> tuple[list[tuple[dict, dict]], int]:
    old, new = defaultdict(list), defaultdict(list)
    for row in previous:
        old[_match_key(row)].append(row)
    for row in current:
        new[_match_key(row)].append(row)
    pairs, ambiguous = [], 0
    for identity in sorted(old.keys() & new.keys()):
        left, right = old[identity], new[identity]
        if len(left) == len(right) == 1:
            pairs.append((left[0], right[0]))
            continue
        # An exact secondary affiliation can disambiguate co-located centres.
        # Repeated records within the same affiliation remain unmatched.
        older, newer = defaultdict(list), defaultdict(list)
        for row in left:
            older[_affiliation(row.get('affiliation', ''))].append(row)
        for row in right:
            newer[_affiliation(row.get('affiliation', ''))].append(row)
        for agency in sorted(older.keys() & newer.keys()):
            if len(older[agency]) == len(newer[agency]) == 1:
                pairs.append((older[agency][0], newer[agency][0]))
            else:
                ambiguous += max(len(older[agency]), len(newer[agency]))
    return pairs, ambiguous


def compare_years(previous_snapshot: dict | None, current_snapshot: dict, filters: dict | None = None) -> dict:
    """Compare two independently filtered reporting cohorts, not the same people."""
    from . import survey_snapshot as api
    year = current_snapshot['dataset']['year']
    if previous_snapshot is None:
        return {'available': False, 'year': year, 'previous_year': None,
                'notes': ['ไม่มีชุดข้อมูลรายโรงเรียนของปีก่อนหน้าสำหรับเปรียบเทียบปีที่เลือก']}
    previous_year = previous_snapshot['dataset']['year']
    scope = {key: value for key, value in (filters or {}).items() if key != 'year' and value not in (None, '')}
    previous_rows, current_rows = _rows(previous_snapshot, scope), _rows(current_snapshot, scope)
    previous_summary, current_summary = api._summary(previous_rows), api._summary(current_rows)
    definitions = (
        ('infection_rate_percent', 'ร้อยละตรวจพบ', 'percent'),
        ('infected_count', 'ผู้ตรวจพบพยาธิ', 'people'),
        ('tested_count', 'ผู้ส่งตรวจ', 'people'),
        ('coverage_percent', 'ความครอบคลุมส่งตรวจ', 'percent'),
        ('negative_school_count', 'หน่วยที่ส่งตรวจแล้วไม่พบ', 'schools'),
    )
    kpis = []
    for key, label, unit in definitions:
        if key == 'infection_rate_percent':
            before = _rate(previous_summary['infected_count'], previous_summary['tested_count'])
            after = _rate(current_summary['infected_count'], current_summary['tested_count'])
        elif key == 'coverage_percent':
            before = _rate(previous_summary['tested_count'], previous_summary['total_students_known'])
            after = _rate(current_summary['tested_count'], current_summary['total_students_known'])
        else:
            before, after = previous_summary[key], current_summary[key]
        kpis.append({'key': key, 'label': label, 'previous': previous_summary[key], 'current': current_summary[key],
                     'delta': _delta(before, after), 'unit': unit,
                     'delta_unit': 'percentage_points' if unit == 'percent' else unit})
    a_districts = {(row['province'], row['district']): row for row in api._group(previous_rows, 'district')}
    b_districts = {(row['province'], row['district']): row for row in api._group(current_rows, 'district')}
    districts = []
    for province, district in sorted(a_districts.keys() | b_districts.keys()):
        old, new = a_districts.get((province, district), {}), b_districts.get((province, district), {})
        districts.append({'province': province, 'district': district,
                          'previous_tested': old.get('tested_count'), 'current_tested': new.get('tested_count'),
                          'previous_infected': old.get('infected_count'), 'current_infected': new.get('infected_count'),
                          'previous_rate_percent': old.get('infection_rate_percent'), 'current_rate_percent': new.get('infection_rate_percent'),
                          'previous_coverage_percent': old.get('coverage_percent'), 'current_coverage_percent': new.get('coverage_percent'),
                          'delta_pp': _delta(old.get('infection_rate_percent'), new.get('infection_rate_percent'))})
    old_species = {row['key']: row for row in api._parasites(previous_rows, previous_summary['tested_count'])}
    new_species = {row['key']: row for row in api._parasites(current_rows, current_summary['tested_count'])}
    species = []
    for key, label in api.PARASITES:
        old, new = old_species[key], new_species[key]
        species.append({'key': key, 'parasite': label, 'previous_count': old['count'], 'current_count': new['count'],
                        'previous_rate_percent': old['rate_percent'], 'current_rate_percent': new['rate_percent'],
                        'previous_flagged_count': old['flagged_count'], 'current_flagged_count': new['flagged_count'],
                        'previous_missing_count': old['missing_school_count'], 'current_missing_count': new['missing_school_count'],
                        'delta_pp': _delta(old['rate_percent'], new['rate_percent']), 'rate_basis': 'reported_among_tested'})
    old_schools = api._select(api._school_records(previous_snapshot), scope)
    new_schools = api._select(api._school_records(current_snapshot), scope)
    pairs, ambiguous_count = _match_schools(old_schools, new_schools)
    matched = []
    fractions = {}
    for old, new in pairs:
        before = Fraction(old['infected'] * 100, old['tested'])
        after = Fraction(new['infected'] * 100, new['tested'])
        difference = after - before
        row = {'school_id': new['school_id'], 'previous_school_id': old['school_id'], 'school': new['school'],
               'province': new['province'], 'district': new['district'], 'previous_district': old['district'],
               'tambon': new.get('tambon', '') if current_snapshot['dataset'].get('school_details_extended') else '',
               'affiliation': new['affiliation'],
               'previous_tested': old['tested'], 'current_tested': new['tested'],
               'previous_infected': old['infected'], 'current_infected': new['infected'],
               'previous_rate_percent': round(float(before), 4), 'current_rate_percent': round(float(after), 4),
               'delta_pp': round(float(difference), 4),
               'eligible_large_change': old['tested'] >= MIN_MATCHED_TESTED and new['tested'] >= MIN_MATCHED_TESTED}
        matched.append(row)
        fractions[row['school_id']] = difference
    matched.sort(key=lambda row: (row['school'], row['province'], row['school_id']))
    eligible = [row for row in matched if row['eligible_large_change']]
    decreases = sorted([row for row in eligible if fractions[row['school_id']] < 0],
                       key=lambda row: (fractions[row['school_id']], row['school'], row['school_id']))[:LARGEST_CHANGE_LIMIT]
    increases = sorted([row for row in eligible if fractions[row['school_id']] > 0],
                       key=lambda row: (-fractions[row['school_id']], row['school'], row['school_id']))[:LARGEST_CHANGE_LIMIT]
    decreased = sum(value < -CHANGE_THRESHOLD_PP for value in fractions.values())
    increased = sum(value > CHANGE_THRESHOLD_PP for value in fractions.values())
    notes = [
        'ร้อยละแต่ละปีใช้ผู้ส่งตรวจของปีนั้นเป็นตัวหาร กลุ่มที่ไม่มีข้อมูลแสดงเป็นช่องว่าง ไม่แทนด้วยศูนย์',
        'ผลต่างของร้อยละเป็นจุดร้อยละ ไม่ใช่ร้อยละการเปลี่ยนแปลงสัมพัทธ์ และไม่ได้ยืนยันการติดตามบุคคลเดิม',
        'จับคู่ชื่อโรงเรียนและตำบลภายในจังหวัดเดียวกัน หากซ้ำใช้สังกัดแยก และไม่จับคู่กรณียังคลุมเครือ อำเภออาจเปลี่ยนระหว่างปี',
        f'จัดอันดับเปลี่ยนแปลงเฉพาะแห่งที่ส่งตรวจตั้งแต่ {MIN_MATCHED_TESTED} คนทั้งสองปี; สรุปลดลง/เพิ่มขึ้นใช้การขยับเกิน 0.5 จุดร้อยละ',
    ]
    return {'available': True, 'previous_year': previous_year, 'year': year, 'filters_applied': scope,
            'previous_summary': previous_summary, 'current_summary': current_summary, 'kpis': kpis,
            'by_district': districts, 'by_parasite': species, 'matched_schools': matched,
            'largest_decreases': decreases, 'largest_increases': increases,
            'matched_count': len(matched), 'eligible_large_change_count': len(eligible),
            'decreased_count': decreased, 'increased_count': increased, 'stable_count': len(matched) - decreased - increased,
            'unmatched_previous_count': len(old_schools) - len(matched), 'unmatched_current_count': len(new_schools) - len(matched),
            'ambiguous_match_count': ambiguous_count, 'change_threshold_pp': .5, 'min_tested_both_years': MIN_MATCHED_TESTED,
            'minimum_tested_both_years': MIN_MATCHED_TESTED,
            'previous_source': api._source(previous_snapshot), 'current_source': api._source(current_snapshot), 'notes': notes}


def _safe_percent(value):
    return value if type(value) in (int, float) and math.isfinite(value) and value >= 0 else None


def _reported_dimension(key: str, label: str, report: dict, years: list[int], province: str | None = None) -> dict:
    found, sent = report.get('found', {}), report.get('send', {})
    names = sorted(set(found) | set(sent), key=lambda name: (name == 'รวม', name))
    series = []
    for name in names:
        if not isinstance(name, str) or not name or len(name) > 160:
            continue
        infection, coverage = found.get(name, []), sent.get(name, [])
        infection = [_safe_percent(infection[i]) if i < len(infection) else None for i in range(len(years))]
        coverage = [_safe_percent(coverage[i]) if i < len(coverage) else None for i in range(len(years))]
        # The uploaded series explicitly uses coverage zero for no reporting
        # units, rather than a measured infection-free sample.
        infection = [None if coverage[i] == 0 else value for i, value in enumerate(infection)]
        coverage = [None if value == 0 else value for value in coverage]
        series.append({'key': name, 'name': name, 'is_total': name == 'รวม',
                       'coverage_percent': coverage, 'infection_rate_percent': infection,
                       'reported_coverage_percent': [_safe_percent(sent.get(name, [])[i]) if i < len(sent.get(name, [])) else None for i in range(len(years))],
                       'reported_infection_rate_percent': [_safe_percent(found.get(name, [])[i]) if i < len(found.get(name, [])) else None for i in range(len(years))]})
    return {'key': key, 'label': label, **({'province': province} if province else {}), 'series': series}


def _issue(code: str, message: str, *, year: int | None = None, dimension: str | None = None, series: str | None = None, reported=None, computed=None) -> dict:
    return {'code': code, 'severity': 'warning', 'message': message,
            **({'year': year} if year is not None else {}), **({'dimension': dimension} if dimension else {}),
            **({'series': series} if series else {}),
            **({'reported_value': reported} if reported is not None else {}), **({'computed_value': computed} if computed is not None else {})}


def _history_groups(snapshot: dict, dimension: dict) -> dict[str, dict]:
    from . import survey_snapshot as api
    rows = snapshot['cubes']
    groups = defaultdict(list)
    if dimension['key'] == 'province':
        for row in rows:
            groups[row['province']].append(row)
    elif dimension['key'] == 'affiliation':
        for row in rows:
            groups[_affiliation(row['affiliation'])].append(row)
    else:
        rows = [row for row in rows if row['province'] == dimension.get('province')]
        for row in rows:
            groups[row['district']].append(row)
    # Every reported dimension is a partition of its selected reporting cohort.
    groups['รวม'] = rows
    return {name: api._summary(group) for name, group in groups.items()}


def _history_insights(dimensions: list[dict], species_series: list[dict], years: list[int], snapshots: dict[int, dict]) -> list[str]:
    from . import survey_snapshot as api
    if not years:
        return []
    output = []
    province = next((item for item in dimensions if item['key'] == 'province'), None)
    total = next((item for item in (province or {}).get('series', []) if item['is_total']), None)
    if total:
        values = total['infection_rate_percent']
        known = [(year, value) for year, value in zip(years, values) if value is not None]
        if known:
            peak = max(known, key=lambda item: item[1])
            latest = known[-1]
            output.append(f'ร้อยละตรวจพบรวมตามรายงานสูงสุดในช่วงที่มีข้อมูลคือปี {peak[0]} ({peak[1]:.2f}%) ส่วนปี {latest[0]} เท่ากับ {latest[1]:.2f}% ต่างกัน {peak[1] - latest[1]:.2f} จุดร้อยละ')
            changes = [(years[i], values[i - 1], values[i]) for i in range(1, len(years)) if values[i] is not None and values[i - 1] is not None and values[i] > values[i - 1]]
            if changes:
                year, before, after = changes[-1]
                output.append(f'ช่วงนี้ไม่ได้ลดลงทุกปี: ปี {year} มีรายงานเพิ่มจาก {before:.2f}% เป็น {after:.2f}% ควรดูจำนวนและความครอบคลุมของแต่ละปีก่อนเปรียบเทียบ')
        coverage = [(year, value) for year, value in zip(years, total['coverage_percent']) if value is not None]
        if coverage:
            low, latest = min(coverage, key=lambda item: item[1]), coverage[-1]
            output.append(f'ความครอบคลุมรวมปี {latest[0]} เท่ากับ {latest[1]:.2f}% ขณะที่ค่าต่ำสุดที่มีรายงานในช่วงนี้คือปี {low[0]} ({low[1]:.2f}%) ตัวหารของการตรวจพบจึงต่างกันได้ระหว่างปี')
    for dimension_key, label in (('province', 'จังหวัด'), ('affiliation', 'สังกัด')):
        dimension = next((item for item in dimensions if item['key'] == dimension_key), None)
        rows = [item for item in (dimension or {}).get('series', []) if not item['is_total'] and item['infection_rate_percent'][-1] is not None]
        if rows:
            maximum = max(rows, key=lambda item: item['infection_rate_percent'][-1])
            output.append(f'ปี {years[-1]} {label}ที่มีร้อยละตรวจพบสูงสุดในข้อมูลที่มีคือ {maximum["name"]} ({maximum["infection_rate_percent"][-1]:.2f}%) เป็นผลในผู้ส่งตรวจตามรายงาน')
    district_rows = [(dimension.get('province', ''), item)
                     for dimension in dimensions if dimension['key'].startswith('district:')
                     for item in dimension['series']
                     if not item['is_total'] and item['infection_rate_percent'][-1] is not None]
    if district_rows:
        province, maximum = max(district_rows, key=lambda pair: pair[1]['infection_rate_percent'][-1])
        output.append(f'ปี {years[-1]} อำเภอที่มีร้อยละตรวจพบสูงสุดในอำเภอที่มีรายงานคือ {maximum["name"]} จ.{province} ({maximum["infection_rate_percent"][-1]:.2f}%) เป็นผลในกลุ่มผู้ส่งตรวจของปีนั้น')
    present_species = [item for item in species_series if item['key'] != 'coinfection' and item['positive_share_percent'][-1] is not None]
    if present_species:
        dominant = max(present_species, key=lambda item: item['positive_share_percent'][-1])
        output.append(f'ปี {years[-1]} กลุ่มที่รายงานมากที่สุดคือ {dominant["name"]} ({dominant["positive_share_percent"][-1]:.2f}% ของผู้ตรวจพบ) ผู้ติดร่วมอาจอยู่หลายกลุ่ม จึงไม่บวกส่วนแบ่งรายชนิดเป็นจำนวนคน')
    if len(years) >= 3:
        changed_species = [item for item in present_species if item['positive_share_percent'][-3] is not None
                           and item['positive_share_percent'][-1] > item['positive_share_percent'][-3]]
        if changed_species:
            largest = max(changed_species, key=lambda item: item['positive_share_percent'][-1] - item['positive_share_percent'][-3])
            before, after = largest['positive_share_percent'][-3], largest['positive_share_percent'][-1]
            output.append(f'ส่วนแบ่งชนิดที่รายงานเพิ่มขึ้นมากที่สุดเมื่อเทียบปี {years[-3]} กับ {years[-1]} คือ {largest["name"]}: {before:.2f}% → {after:.2f}% (+{after - before:.2f} จุดร้อยละ) ใช้ผู้ตรวจพบของแต่ละปีเป็นตัวหาร')
    current = snapshots.get(years[-1])
    previous = snapshots.get(years[-2]) if len(years) > 1 else None
    if current:
        school_rows = api._school_records(current)
        if previous:
            old_negative = sum(row['infected'] == 0 for row in api._school_records(previous))
            current_negative = sum(row['infected'] == 0 for row in school_rows)
            output.append(f'หน่วยที่มีผู้ส่งตรวจและรายงานไม่พบพยาธิ: ปี {previous["dataset"]["year"]} มี {old_negative} แห่ง และปี {years[-1]} มี {current_negative} แห่ง จำนวนหน่วยและผู้ส่งตรวจของสองปีไม่เท่ากัน')
        total_positive = sum(row['infected'] for row in school_rows)
        first_ten = sum(row['infected'] for row in sorted(school_rows, key=lambda row: row['infected'], reverse=True)[:10])
        if total_positive:
            output.append(f'ปี {years[-1]} ยอดผู้ตรวจพบของ 10 หน่วยที่มีจำนวนรายงานสูงสุดรวม {first_ten:,} จาก {total_positive:,} คน ({first_ten / total_positive * 100:.2f}%) ข้อมูลนี้ยังไม่อธิบายสาเหตุหรือยืนยันความเสี่ยงประชากร')
    return output


def history_dashboard(snapshots: dict[int, dict], history_artifact: dict | None, filters: dict | None = None) -> dict:
    """Project all-year reports with independent controls and explicit provenance."""
    from . import survey_snapshot as api
    if not history_artifact:
        return {'available': False, 'years': [], 'dimensions': [], 'species_series': [], 'quality': {'issues': []}, 'insights': []}
    reported = history_artifact.get('reported', {})
    years = reported.get('years', [])
    if not isinstance(years, list) or not years or len(years) > 100 or any(type(year) is not int or not 2400 <= year <= 2743 for year in years) or years != sorted(set(years)):
        return {'available': False, 'years': [], 'dimensions': [], 'species_series': [], 'quality': {'issues': []}, 'insights': []}
    dimensions = [_reported_dimension('province', 'จังหวัด', reported.get('prov', {}), years),
                  _reported_dimension('affiliation', 'สังกัด', reported.get('agency', {}), years)]
    for province, values in sorted(reported.get('amp', {}).items()):
        if isinstance(province, str) and isinstance(values, dict):
            dimensions.append(_reported_dimension(f'district:{province}', f'อำเภอ จ.{province}', values, years, province))
    issues = []
    totals = {}
    for dimension in dimensions:
        if dimension['key'] in {'province', 'affiliation'}:
            totals[dimension['key']] = next((item for item in dimension['series'] if item['is_total']), None)
    if totals.get('province') and totals.get('affiliation'):
        for index, year in enumerate(years):
            for metric in ('coverage_percent', 'infection_rate_percent'):
                provincial = totals['province'][f'reported_{metric}'][index]
                affiliation = totals['affiliation'][f'reported_{metric}'][index]
                if provincial is not None and affiliation is not None and abs(provincial - affiliation) > .011:
                    issue = _issue('reported_dimension_total_difference',
                                   f'ปี {year} ยอดรวมร้อยละจากตารางจังหวัด ({provincial:.2f}%) และสังกัด ({affiliation:.2f}%) ไม่ตรงกัน คงค่าที่รายงานของแต่ละตารางไว้ให้ตรวจเทียบต้นฉบับ',
                                   year=year, dimension='province|affiliation', series='รวม')
                    issue['metric'] = metric
                    issue['reported_values'] = {'province': provincial, 'affiliation': affiliation}
                    issues.append(issue)
    for dimension in dimensions:
        for item in dimension['series']:
            for index, coverage in enumerate(item['coverage_percent']):
                if coverage is not None and coverage > 100:
                    issues.append(_issue('reported_coverage_above_100', f'{item["name"]} ปี {years[index]} รายงานความครอบคลุม {coverage:.2f}% เกิน 100% คงค่าต้นทางไว้ให้ตรวจสอบ', year=years[index], dimension=dimension['key'], series=item['name'], reported=coverage))
        for year, snapshot in sorted(snapshots.items()):
            if year not in years:
                continue
            index = years.index(year)
            computed = _history_groups(snapshot, dimension)
            lookup = {item['name']: item for item in dimension['series']}
            for name in computed.keys() - lookup.keys():
                item = {'key': name, 'name': name, 'is_total': name == 'รวม',
                        'coverage_percent': [None] * len(years), 'infection_rate_percent': [None] * len(years),
                        'reported_coverage_percent': [None] * len(years), 'reported_infection_rate_percent': [None] * len(years)}
                dimension['series'].append(item)
                lookup[name] = item
            for name, item in lookup.items():
                summary = computed.get(name)
                for metric in ('coverage_percent', 'infection_rate_percent'):
                    derived = summary[metric] if summary is not None else None
                    raw = item[f'reported_{metric}'][index]
                    metric_label = 'ความครอบคลุมส่งตรวจ' if metric == 'coverage_percent' else 'ร้อยละตรวจพบ'
                    if raw is not None and derived is not None and abs(raw - derived) > .011:
                        issue = _issue('recent_series_recomputed', f'{name} ปี {year}: {metric_label}ในไฟล์สรุปต่างจากยอดคน จึงแสดงค่าที่คำนวณใหม่จากชุดรายงานรายโรงเรียน', year=year, dimension=dimension['key'], series=name, reported=raw, computed=derived)
                        issue['metric'] = metric
                        issues.append(issue)
                    elif raw is not None and derived is None:
                        issue = _issue('recent_series_no_denominator', f'{name} ปี {year}: {metric_label}ยังไม่มีตัวหารจากข้อมูลรายโรงเรียน จึงแสดงช่องว่างแทนค่าร้อยละสรุป', year=year, dimension=dimension['key'], series=name, reported=raw)
                        issue['metric'] = metric
                        issues.append(issue)
                    item[metric][index] = derived
            dimension['series'].sort(key=lambda item: (item['is_total'], item['name']))
    parasite_names = list(api.PARASITES) + [('coinfection', 'พบมากกว่า 1 ชนิด')]
    species_values = reported.get('species', {}).get('v', {})
    species_series = []
    for species_index, (key, name) in enumerate(parasite_names):
        original = []
        for year in years:
            values = species_values.get(str(year), [])
            original.append(_safe_percent(values[species_index]) if species_index < len(values) else None)
        values = list(original)
        flagged_years = []
        for year, snapshot in sorted(snapshots.items()):
            if year not in years:
                continue
            index = years.index(year)
            summary = api._summary(snapshot['cubes'])
            if key == 'coinfection':
                count, flagged = summary['multiple_infections_count'], 0
            else:
                species = next(item for item in api._parasites(snapshot['cubes'], summary['tested_count']) if item['key'] == key)
                count, flagged = species['reported_count'], species['flagged_count']
            values[index] = round(_rate(count, summary['infected_count']), 4) if _rate(count, summary['infected_count']) is not None else None
            if flagged:
                flagged_years.append(year)
                issues.append(_issue('species_count_conflict', f'{name} ปี {year} มีจำนวนตามรายงาน {count} คน โดยมี {flagged} รายที่ตัวเลขขัดกัน กราฟส่วนแบ่งคงยอดรายงานและต้องอ่านร่วมกับข้อสังเกต', year=year, dimension='species', series=name, reported=count))
            if original[index] is not None and values[index] is not None and abs(original[index] - values[index]) > .011:
                issues.append(_issue('recent_species_recomputed', f'{name} ปี {year}: คำนวณส่วนแบ่งใหม่จากยอดรายงานและยอดผู้ตรวจพบ', year=year, dimension='species', series=name, reported=original[index], computed=values[index]))
        species_series.append({'key': key, 'name': name, 'positive_share_percent': values,
                               'reported_positive_share_percent': original, 'flagged_years': flagged_years,
                               'denominator': 'reported_positive_people', 'overlap_possible': True})
    source = history_artifact.get('source', history_artifact.get('dataset', {}))
    source = {key: source[key] for key in ('file_name', 'archive_file_name', 'archive_sha256', 'version', 'imported_at', 'note', 'verification_status', 'source_kind') if key in source}
    source['note'] = reported.get('note', source.get('note', ''))
    source['historical_counts_available'] = False
    source['recent_years_recomputed'] = sorted(year for year in snapshots if year in years)
    return {'available': True, 'years': years, 'source': source, 'dimensions': dimensions,
            'species_series': species_series, 'quality': {'issues': issues, 'issue_count': len(issues)},
            'insights': _history_insights(dimensions, species_series, years, snapshots),
            'scope': 'independent_historical_controls',
            'notes': ['กราฟย้อนหลังใช้ตัวเลือกพื้นที่/ตัวชี้วัดภายในส่วนนี้ แยกจากตัวกรองโรงเรียนของปีที่เลือก เพราะปีก่อน 2568 มีเพียงร้อยละสรุป ไม่มีจำนวนคนรายโรงเรียนให้รวมใหม่',
                      'ปี 2557–2567 ใช้ค่าร้อยละจากไฟล์สรุปที่แนบ ยังไม่ได้ตรวจเทียบสมุดงานต้นฉบับ ส่วนปี 2568–2569 คำนวณใหม่จากจำนวนตามรายงานรายโรงเรียน',
                      'ช่องว่างคือไม่มีข้อมูลหรือไม่มีตัวหาร ไม่เชื่อมเส้นข้ามช่องว่าง และไม่ตีความว่าเป็นศูนย์หรือไม่มีการติดเชื้อ',
                      'ส่วนแบ่งชนิดพยาธิใช้ผู้ตรวจพบเป็นตัวหาร ต่างจากกราฟแยกชนิดด้านบนที่ใช้ผู้ส่งตรวจ และผู้ติดร่วมอาจอยู่หลายชนิด']}

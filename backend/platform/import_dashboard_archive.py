"""Import data supplied with the owner's multi-year dashboard, without running it.

The 2568 workbook is not bundled. Its provided JSON counts are retained with
explicit provenance and zero-imputation limitations. The independently audited
2569 workbook snapshot remains authoritative for that year.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from .import_survey import TYPE_COLUMNS, _positivity_band, _sum_known, _text

TRANSFORM_VERSION = 'kpd-dashboard-archive-v1'
ARCHIVE_TYPES = {'hookworm': 'hookworm', 'ascaris': 'ascaris', 'whipworm': 'trichuris',
                 'liver_fluke': 'liver_fluke', 'pinworm': 'pinworm', 'tapeworm': 'tapeworm',
                 'mif': 'medium_intestinal', 'strongyloides': 'strongyloides'}
CORE = ('enrolled', 'tested', 'infected', 'coinfection')
DIMENSIONS = ('province', 'district', 'affiliation', 'status', 'positivity_band')


def _load(path: Path):
    if path.is_symlink() or path.stat().st_size > 10 * 1024 * 1024:
        raise ValueError('ไฟล์ข้อมูลที่แนบใหญ่เกินขอบเขตหรือเป็นลิงก์')
    return json.loads(path.read_text(encoding='utf-8'))


def _count(value):
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 10**12 or int(value) != value:
        raise ValueError('จำนวนในข้อมูลแนบต้องเป็นจำนวนเต็มไม่ติดลบ')
    return int(value)


def canonical_affiliation(value: str) -> str:
    return 'ศูนย์เด็กวัยเตาะแตะ' if value == 'ศูนย์เด็กวันเตาะแตะ' else value


def _identity(row):
    return tuple(row[key] for key in ('school', 'tambon', 'province', 'affiliation'))


def _record(source: dict, year: int) -> dict:
    if not isinstance(source, dict) or source.get('year') != year or source.get('status') not in {'ok', 'pending', 'excluded'}:
        raise ValueError('สถานะหรือปีรายโรงเรียนในไฟล์แนบไม่ถูกต้อง')
    if not all(isinstance(source.get(field), str) for field in ('school', 'tambon', 'province', 'amphoe', 'affil')):
        raise ValueError('ชื่อและพื้นที่รายโรงเรียนต้องเป็นข้อความ')
    name, tambon = _text(source.get('school')), _text(source.get('tambon'))
    province, district = _text(source.get('province')), _text(source.get('amphoe'))
    original_affiliation = _text(source.get('affil'))
    if not name or len(name) > 400 or any(not v or len(v) > 160 for v in (province, district, original_affiliation)) or len(tambon) > 160:
        raise ValueError('ชื่อหรือพื้นที่รายโรงเรียนในข้อมูลแนบไม่ถูกต้อง')
    pending = source['status'] == 'pending'
    counts = {key: None if pending else _count(source.get(field)) for key, field in zip(CORE, ('total', 'sent', 'pos', 'multi'))}
    status = 'pending' if pending else 'tested' if counts['tested'] > 0 else 'zero_tested'
    if not pending and not (counts['coinfection'] <= counts['infected'] <= counts['tested'] <= counts['enrolled']):
        raise ValueError('จำนวนหลักในข้อมูลแนบขัดกัน')
    if source['status'] == 'ok' and status != 'tested':
        raise ValueError('สถานะส่งตรวจจริงในไฟล์แนบไม่มีผู้ส่งตรวจ')
    if source['status'] == 'excluded' and any(counts.values()):
        raise ValueError('รายการที่ไฟล์แนบตัดออกมีจำนวนคน ต้องตรวจต้นทางก่อนเผยแพร่')
    types = source.get('sp')
    if not isinstance(types, dict) or not all(key in types for key in ARCHIVE_TYPES):
        raise ValueError('หมวดชนิดพยาธิในข้อมูลแนบไม่ครบ')
    parasites = {}
    for raw, key in ARCHIVE_TYPES.items():
        value = None if pending else _count(types[raw])
        conflict = value is not None and value > counts['infected']
        parasites[key] = {'reported': value, 'consistent': 0 if conflict else value,
                          'conflicting': value if conflict else 0, 'missing': 0, 'tested_missing': 0}
    row = {'school': name, 'tambon': tambon, 'province': province, 'district': district,
           'affiliation': canonical_affiliation(original_affiliation), 'status': status,
           'positivity_band': _positivity_band(counts['infected'], counts['tested']), **counts, 'parasites': parasites}
    basis = json.dumps([year, *_identity(row), district], ensure_ascii=False)
    row['school_id'] = 'school-' + hashlib.sha256(basis.encode()).hexdigest()[:20]
    return row


def _check_current(records: list[dict], trusted_current: dict):
    provided = {_identity(row): row for row in records if row['status'] == 'tested'}
    trusted = {_identity(row): row for row in trusted_current.get('schools', [])}
    if len(provided) != sum(row['status'] == 'tested' for row in records) or len(trusted) != len(trusted_current.get('schools', [])) or set(provided) != set(trusted):
        raise ValueError('รายชื่อปีล่าสุดในไฟล์แนบไม่ตรงกับชุดข้อมูลจาก Excel ที่ตรวจแล้ว')
    for key, row in provided.items():
        expected = trusted[key]
        if row['district'] != expected['district'] or any(row[field] != expected[field] for field in CORE):
            raise ValueError('จำนวนหรือพื้นที่ปีล่าสุดในไฟล์แนบไม่ตรงกับชุดข้อมูลที่ตรวจแล้ว')
        for kind, values in row['parasites'].items():
            known = expected.get('parasites', {}).get(kind, {}).get('reported')
            if known is not None and values['reported'] != known:
                raise ValueError('จำนวนแยกชนิดปีล่าสุดไม่ตรงกับ Excel ที่ตรวจแล้ว')


def _history_validate(reported):
    if not isinstance(reported, dict) or not isinstance(reported.get('years'), list):
        raise ValueError('ชุดข้อมูลแนวโน้มไม่ถูกต้อง')
    years = reported['years']
    if not years or len(years) > 100 or any(type(y) is not int or not 2400 <= y <= 2743 for y in years) or years != sorted(set(years)):
        raise ValueError('ปีแนวโน้มไม่ถูกต้อง')
    if not isinstance(reported.get('amp'), dict):
        raise ValueError('กลุ่มอำเภอในชุดแนวโน้มไม่ถูกต้อง')
    groups = [reported.get('prov'), reported.get('agency'), *reported['amp'].values()]
    for group in groups:
        if not isinstance(group, dict) or set(group) != {'found', 'send'} or not all(isinstance(group[k], dict) for k in group):
            raise ValueError('โครงสร้างเปอร์เซ็นต์ย้อนหลังไม่ถูกต้อง')
        if set(group['found']) != set(group['send']):
            raise ValueError('ชื่อกลุ่มร้อยละตรวจพบและส่งตรวจไม่ตรงกัน')
        for metric in group.values():
            for name, values in metric.items():
                if not isinstance(name, str) or not 0 < len(name) <= 160 or not isinstance(values, list) or len(values) != len(years):
                    raise ValueError('ชุดร้อยละย้อนหลังมีความยาวหรือชื่อกลุ่มไม่ถูกต้อง')
                if any(v is not None and (type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1000) for v in values):
                    raise ValueError('ร้อยละย้อนหลังต้องเป็นค่าจำกัดที่ไม่ติดลบ หรือว่าง')
    species = reported.get('species')
    if not isinstance(species, dict) or not isinstance(species.get('names'), list) or len(species['names']) != 9 or not isinstance(species.get('v'), dict):
        raise ValueError('ข้อมูลชนิดพยาธิย้อนหลังไม่ถูกต้อง')
    for year, values in species['v'].items():
        if not str(year).isdigit() or int(year) not in years or not isinstance(values, list) or len(values) != 9:
            raise ValueError('ข้อมูลชนิดพยาธิย้อนหลังมีปีหรือความยาวไม่ถูกต้อง')
        if any(v is not None and (type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1000) for v in values):
            raise ValueError('ค่าชนิดพยาธิย้อนหลังไม่ถูกต้อง')


def import_archive(directory: str | Path, *, archive_sha256: str, imported_at: str | None = None,
                   trusted_current: dict | None = None) -> dict:
    if not isinstance(archive_sha256, str) or re.fullmatch(r'[a-f0-9]{64}', archive_sha256) is None:
        raise ValueError('ต้องระบุ SHA-256 ของไฟล์แนบ')
    root = Path(directory)
    data_path, history_path = root / 'data' / 'data.json', root / 'data' / 'timeseries.json'
    source, reported = _load(data_path), _load(history_path)
    _history_validate(reported)
    # Only documented percent-series fields belong in the public artifact;
    # unrelated properties or raw notes in the supplied JSON are not copied.
    reported = {'years': reported['years'],
                'prov': {key: reported['prov'][key] for key in ('send', 'found')},
                'agency': {key: reported['agency'][key] for key in ('send', 'found')},
                'amp': {province: {key: values[key] for key in ('send', 'found')} for province, values in reported['amp'].items()},
                'species': {key: reported['species'][key] for key in ('names', 'v')}}
    if not isinstance(source, dict) or not isinstance(source.get('meta'), dict) or not isinstance(source.get('schools'), list) or len(source['schools']) > 10000:
        raise ValueError('ชุดรายโรงเรียนในไฟล์แนบไม่ถูกต้อง')
    years = source['meta'].get('years')
    if not isinstance(years, list) or len(years) != 2 or any(type(y) is not int for y in years) or years != sorted(set(years)):
        raise ValueError('ตัวนำเข้านี้รองรับไฟล์แนบรายโรงเรียนสองปีเรียงจากเก่าไปใหม่')
    records = {year: [_record(row, year) for row in source['schools'] if row.get('year') == year] for year in years}
    if any(not rows for rows in records.values()) or sum(map(len, records.values())) != len(source['schools']):
        raise ValueError('ปีรายโรงเรียนไม่ตรงกับ metadata')
    for rows in records.values():
        identities = [_identity(row) for row in rows]
        if len(set(identities)) != len(identities):
            raise ValueError('มีรายชื่อและพื้นที่ซ้ำกำกวมในปีเดียวกัน')
    if trusted_current is not None:
        if trusted_current.get('dataset', {}).get('year') != years[-1]:
            raise ValueError('ปีชุดข้อมูลอ้างอิงล่าสุดไม่ตรงกัน')
        _check_current(records[years[-1]], trusted_current)
    stamp = imported_at or datetime.now(timezone.utc).isoformat(timespec='seconds')
    data_digest = hashlib.sha256(data_path.read_bytes()).hexdigest()
    history_digest = hashlib.sha256(history_path.read_bytes()).hexdigest()
    version = hashlib.sha256(json.dumps([archive_sha256, TRANSFORM_VERSION, years, data_digest, history_digest], ensure_ascii=False).encode()).hexdigest()[:16]
    previous_year = years[0]
    old = records[previous_year]
    groups = defaultdict(list)
    for row in old:
        groups[tuple(row[key] for key in DIMENSIONS)].append(row)
    cubes = [{**dict(zip(DIMENSIONS, key)), 'school_count': len(rows),
              'positive_school_count': sum(bool(row['infected']) for row in rows),
              **{field: _sum_known([row[field] for row in rows]) for field in CORE},
              'parasites': {kind: {field: _sum_known([row['parasites'][kind][field] for row in rows]) for field in ('reported', 'consistent', 'conflicting', 'missing', 'tested_missing')} for kind, _, _ in TYPE_COLUMNS}}
             for key, rows in sorted(groups.items())]
    common_issues = [
        {'id': 'archive-provenance', 'code': 'archive_workbook_unverified', 'severity': 'info', 'title': 'ข้อมูลจากไฟล์ Dashboard ที่แนบ',
         'message': 'ข้อมูลปี 2568 และร้อยละย้อนหลังมาจากไฟล์ JSON ที่แนบ ยังไม่ได้ตรวจเทียบ Excel ต้นฉบับย้อนหลัง', 'count': 1},
        {'id': 'archive-zero-imputation', 'code': 'archive_zero_imputation', 'severity': 'warning', 'title': 'ข้อจำกัดช่องว่างของข้อมูลปี 2568',
         'message': 'ไฟล์แนบเดิมแปลงช่องจำนวนว่างเป็นศูนย์ จึงไม่สามารถย้อนแยกศูนย์ที่รายงานจริงกับช่องว่างของต้นฉบับได้ จำนวนปี 2568 แสดงตาม JSON ที่ได้รับ โดยหน่วยรอข้อมูลยังคงเป็นไม่ทราบ', 'count': 1},
    ]
    snapshot = {'schema_version': 1,
                'dataset': {'id': f'kpd-{previous_year}', 'version': version, 'transform_version': TRANSFORM_VERSION,
                            'file_name': f'ข้อมูลรายโรงเรียนปี {previous_year} จาก helminth-dashboard (1).zip', 'worksheet': 'data/data.json',
                            'year': previous_year, 'year_basis': 'archive_year_field', 'band_partitioned': True,
                            'named_school_statistics': True, 'school_details_extended': True,
                            'publication_scope': 'named_tested_school_statistics', 'input_sha256': hashlib.sha256(data_path.read_bytes()).hexdigest(),
                            'archive_sha256': archive_sha256, 'verification_status': 'provided_archive_not_workbook_verified', 'imported_at': stamp},
                'cubes': cubes, 'schools': [row for row in old if row['status'] == 'tested'],
                'issues': copy.deepcopy(common_issues),
                'audit': {'source_detail_rows': len(old), 'summary_reconciled': None, 'formula_error_count': 0, 'missing_count_cells': 0,
                          'public_dimensions': list(DIMENSIONS), 'archive_json_only': True}}
    if any(row.get('affil') == 'ศูนย์เด็กวันเตาะแตะ' and row.get('year') == previous_year for row in source['schools']):
        snapshot['issues'].append({'id': 'archive-affiliation-alias', 'code': 'affiliation_alias', 'severity': 'info', 'title': 'ชื่อสังกัดสะกดต่างกันระหว่างปี',
                                   'message': 'รวมหมวดศูนย์เด็กวันเตาะแตะของปี 2568 กับศูนย์เด็กวัยเตาะแตะ เพื่อให้เปรียบเทียบกลุ่มเดียวกัน โดยคงชื่อโรงเรียนตามต้นทาง', 'count': 1})
    history = {'schema_version': 1, 'source': {'file_name': 'helminth-dashboard (1).zip', 'archive_sha256': archive_sha256,
                    'version': version, 'imported_at': stamp, 'note': 'ปี 2557–2567 เป็นร้อยละสรุปที่แนบ อ้างว่ามาจากไฟล์ sumall; ปี 2568–2569 คำนวณใหม่จากจำนวนคนรายโรงเรียนที่นำเข้า',
                    'verification_status': 'historical_summary_supplied_original_workbooks_not_verified'},
               'reported': reported, 'issues': copy.deepcopy(common_issues)}
    return {'previous_snapshot': snapshot, 'history_artifact': history}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--archive-sha256', required=True)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--trusted-current', type=Path)
    args = parser.parse_args()
    try:
        trusted = _load(args.trusted_current) if args.trusted_current else None
        result = import_archive(args.directory, archive_sha256=args.archive_sha256, trusted_current=trusted)
        args.output_dir.mkdir(parents=True, exist_ok=True)
        for key, name in (('previous_snapshot', f'health-survey-{result["previous_snapshot"]["dataset"]["year"]}.json'), ('history_artifact', 'health-survey-history.json')):
            target = args.output_dir / name
            if target.exists():
                previous = json.loads(target.read_text(encoding='utf-8'))
                meta_key = 'dataset' if key == 'previous_snapshot' else 'source'
                if previous.get(meta_key, {}).get('version') == result[key][meta_key]['version']:
                    result[key][meta_key]['imported_at'] = previous[meta_key]['imported_at']
            temporary = target.with_suffix('.json.tmp')
            temporary.write_text(json.dumps(result[key], ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            temporary.replace(target)
    except (OSError, ValueError, TypeError, KeyError) as exc:
        parser.exit(1, f'นำเข้าไม่สำเร็จ: {exc}\n')
    print('Imported archive summaries and previous-year school statistics; original latest-year workbook snapshot preserved.')


if __name__ == '__main__':
    main()

"""Synthetic archive JSON verifies safe import; no attached programs are run."""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from backend.platform import import_dashboard_archive as importer
from backend.platform import survey_snapshot as snapshot

STAMP = '2026-10-31T00:00:00Z'
SHA = 'a' * 64


def source_row(year, name, *, status='ok', tested=50, infected=5):
    types = {key: 0 for key in importer.ARCHIVE_TYPES}
    types['ascaris'] = infected
    return {'year': year, 'no': 1, 'school': name, 'tambon': 'ตำบล A', 'amphoe': 'อำเภอ A',
            'province': 'ตาก', 'affil': 'หน่วยงาน A', 'total': tested, 'sent': tested,
            'pos': infected, 'multi': 0, 'sp': types, 'status': status,
            'reason': 'PRIVATE_SOURCE_NOTE', 'person_name': 'PRIVATE_PERSON_FIELD'}


def make_archive(directory: Path):
    data = {'meta': {'years': [2568, 2569], 'private_key': 'PRIVATE_META_SECRET'},
            'schools': [source_row(2568, 'AUTHORIZED_PREVIOUS', infected=10),
                        source_row(2568, 'UNPUBLISHED_PENDING', status='pending', tested=0, infected=0),
                        source_row(2569, 'AUTHORIZED_CURRENT'),
                        source_row(2569, 'UNPUBLISHED_ZERO', status='excluded', tested=0, infected=0)]}
    report = {'years': [2568, 2569], 'note': 'PRIVATE_UNAPPROVED_NOTE',
              'prov': {'found': {'รวม': [20, 10]}, 'send': {'รวม': [100, 100]}},
              'agency': {'found': {'รวม': [20, 10]}, 'send': {'รวม': [100, 100]}},
              'amp': {}, 'species': {'names': list(importer.ARCHIVE_TYPES) + ['mixed'],
                                     'v': {'2568': [0] * 9, '2569': [0] * 9},
                                     'private_key': 'PRIVATE_SPECIES_SECRET'},
              'person_records': ['PRIVATE_PERSON_FIELD']}
    folder = directory / 'data'
    folder.mkdir(parents=True)
    (folder / 'data.json').write_text(json.dumps(data), encoding='utf-8')
    (folder / 'timeseries.json').write_text(json.dumps(report), encoding='utf-8')
    # Import must only parse data; these files are deliberately not importable.
    (directory / 'app.js').write_text('throw new Error("ATTACHED_PROGRAM_MUST_NOT_RUN")')
    return data, report


def save(directory, data, report):
    (directory / 'data' / 'data.json').write_text(json.dumps(data), encoding='utf-8')
    (directory / 'data' / 'timeseries.json').write_text(json.dumps(report), encoding='utf-8')


def run(directory, **kwargs):
    return importer.import_archive(directory, archive_sha256=SHA, imported_at=STAMP, **kwargs)


def test_archive_import_preserves_pending_unknowns_and_provenance_and_only_projects_documented_public_data(tmp_path):
    make_archive(tmp_path)
    result = run(tmp_path)
    old, report = result['previous_snapshot'], result['history_artifact']
    assert old['dataset']['year'] == 2568
    assert old['dataset']['year_basis'] == 'archive_year_field'
    assert old['dataset']['verification_status'] == 'provided_archive_not_workbook_verified'
    assert old['dataset']['named_school_statistics'] and old['dataset']['school_details_extended']
    assert len(old['schools']) == 1 and old['schools'][0]['school'] == 'AUTHORIZED_PREVIOUS'
    assert old['schools'][0]['tambon'] == 'ตำบล A'
    pending = next(row for row in old['cubes'] if row['status'] == 'pending')
    assert pending['tested'] is None and pending['infected'] is None and pending['enrolled'] is None
    assert 'UNPUBLISHED_PENDING' not in json.dumps(result)
    assert 'UNPUBLISHED_ZERO' not in json.dumps(result)
    assert 'PRIVATE_' not in json.dumps(result)
    assert set(report['reported']) == {'years', 'prov', 'agency', 'amp', 'species'}
    assert set(report['reported']['species']) == {'names', 'v'}
    codes = {issue['code'] for issue in old['issues']}
    assert {'archive_workbook_unverified', 'archive_zero_imputation'} <= codes
    assert old['audit']['summary_reconciled'] is None
    assert run(tmp_path) == result


def test_archive_version_includes_actual_json_content_even_if_archive_hash_was_accidentally_reused(tmp_path):
    data, report = make_archive(tmp_path)
    before = run(tmp_path)
    data['schools'][0]['pos'] = data['schools'][0]['sp']['ascaris'] = 11
    save(tmp_path, data, report)
    changed_counts = run(tmp_path)
    assert changed_counts['previous_snapshot']['dataset']['version'] != before['previous_snapshot']['dataset']['version']
    report['prov']['found']['รวม'][0] = 22
    save(tmp_path, data, report)
    changed_history = run(tmp_path)
    assert changed_history['history_artifact']['source']['version'] != changed_counts['history_artifact']['source']['version']


def test_archive_import_rejects_changed_trusted_current_counts_or_species_and_duplicate_or_nonzero_excluded_rows(tmp_path):
    data, report = make_archive(tmp_path)
    current = copy.deepcopy(run(tmp_path)['previous_snapshot'])
    current['dataset']['year'] = 2569
    current['schools'][0].update(school='AUTHORIZED_CURRENT', infected=5)
    current['schools'][0]['parasites']['ascaris'].update(reported=5, consistent=5)
    assert run(tmp_path, trusted_current=current)['previous_snapshot']['schools'][0]['infected'] == 10
    for mutation in ('count', 'species', 'duplicate', 'excluded'):
        changed = copy.deepcopy(data)
        if mutation == 'count':
            changed['schools'][2]['total'] = changed['schools'][2]['sent'] = 51
        elif mutation == 'species':
            changed['schools'][2]['sp']['ascaris'] = 4
        elif mutation == 'duplicate':
            changed['schools'].append(copy.deepcopy(changed['schools'][0]))
        else:
            changed['schools'][3].update(total=30, sent=30, pos=0)
        save(tmp_path, changed, report)
        with pytest.raises(ValueError):
            run(tmp_path, trusted_current=current)


def test_archive_import_validates_percentage_lengths_types_and_finite_numbers_before_output(tmp_path):
    data, report = make_archive(tmp_path)
    for bad in ('length', 'negative', 'infinite', 'boolean', 'year', 'bad_group'):
        changed = copy.deepcopy(report)
        if bad == 'length':
            changed['prov']['send']['รวม'].append(50)
        elif bad == 'negative':
            changed['prov']['found']['รวม'][0] = -1
        elif bad == 'infinite':
            changed['prov']['found']['รวม'][0] = float('inf')
        elif bad == 'boolean':
            changed['prov']['found']['รวม'][0] = True
        elif bad == 'year':
            changed['years'] = [2569, 2568]
        else:
            changed['amp'] = []
        save(tmp_path, data, changed)
        with pytest.raises(ValueError):
            run(tmp_path)
    with pytest.raises(ValueError):
        importer.import_archive(tmp_path, archive_sha256='not-a-sha')


def test_extended_school_fields_do_not_weaken_notes_projection_and_unknown_species_counts_remain_unknown():
    actual = snapshot.dashboard({'school_search': 'บ้านแม่อมกิ(บ้านเคาะทีโคะ)'})['data']
    school = actual['by_school'][0]
    assert school['tambon'] == 'แม่วะหลวง'
    assert school['parasite_counts']['ascaris'] == 14 and school['parasite_counts']['trichuris'] == 19
    assert school['parasite_counts']['medium_intestinal'] == 0
    assert not {'reason', 'notes', 'person_name', 'patient_name', 'no'} & school.keys()
    all_rows = snapshot.dashboard()['data']['by_school']
    assert sum(row['parasite_counts']['tapeworm'] is None for row in all_rows) == 1
    assert all('mif' not in row['parasite_counts'] for row in all_rows), 'Archive alias mif means medium intestinal in this source, not MIF diagnosis'

"""Descriptive multi-year statistics: fixtures are software tests, not evidence."""
from __future__ import annotations

import copy
import hashlib
import json
from fractions import Fraction

import pytest

from backend.platform import survey_history as history
from backend.platform import survey_snapshot as snapshot


def school(name, tested=100, infected=0, *, district='อำเภอเดิม', province='ตาก', affiliation='หน่วยงาน A', tambon='ตำบล A'):
    band = 'none' if infected == 0 else 'under5' if infected * 100 < tested * 5 else '5to10' if infected * 100 < tested * 10 else '10to20' if infected * 100 < tested * 20 else '20plus'
    types = {key: {'reported': 0, 'consistent': 0, 'conflicting': 0, 'missing': 0, 'tested_missing': 0} for key, _ in snapshot.PARASITES}
    types['ascaris'].update(reported=infected, consistent=infected)
    return {'school_id': hashlib.sha256(f'{name}:{province}:{affiliation}'.encode()).hexdigest()[:24],
            'school': name, 'tambon': tambon, 'province': province, 'district': district, 'affiliation': affiliation,
            'status': 'tested', 'positivity_band': band, 'enrolled': tested, 'tested': tested,
            'infected': infected, 'coinfection': 0, 'parasites': types}


def fixture_snapshot(year, records):
    records = copy.deepcopy(records)
    for index, row in enumerate(records):
        row['school_id'] += f'-{year}-{index}'
    cubes = [{key: copy.deepcopy(row[key]) for key in ('province', 'district', 'affiliation', 'status', 'positivity_band', 'enrolled', 'tested', 'infected', 'coinfection', 'parasites')} for row in records]
    for cube, row in zip(cubes, records):
        cube.update(school_count=1, positive_school_count=int(row['infected'] > 0))
    return {'schema_version': 1,
            'dataset': {'id': f'SYNTHETIC_{year}', 'version': f'SYNTHETIC_{year}', 'year': year,
                        'file_name': f'SYNTHETIC_{year}.xlsx', 'worksheet': 'SYNTHETIC',
                        'imported_at': '2026-10-31T00:00:00Z', 'year_basis': 'filename',
                        'named_school_statistics': True, 'school_details_extended': True, 'band_partitioned': True},
            'schools': copy.deepcopy(records), 'cubes': cubes, 'issues': [], 'audit': {'summary_reconciled': True}}


def test_school_pairing_ignores_district_move_but_does_not_merge_common_names_across_provinces_or_ambiguous_rows():
    old = fixture_snapshot(2568, [school('MOVED', district='อำเภอเก่า'), school('COMMON', province='ตาก'),
                                  school('COMMON', province='พิษณุโลก'), school('AMBIGUOUS'), school('AMBIGUOUS')])
    current = fixture_snapshot(2569, [school('MOVED', district='อำเภอใหม่', infected=2), school('COMMON', province='ตาก'),
                                      school('COMMON', province='พิษณุโลก'), school('AMBIGUOUS')])
    result = history.compare_years(old, current)
    assert result['matched_count'] == 3
    assert result['ambiguous_match_count'] > 0
    assert not any(row['school'] == 'AMBIGUOUS' for row in result['matched_schools'])
    moved = next(row for row in result['matched_schools'] if row['school'] == 'MOVED')
    assert moved['previous_district'] == 'อำเภอเก่า' and moved['district'] == 'อำเภอใหม่'
    assert {row['province'] for row in result['matched_schools'] if row['school'] == 'COMMON'} == {'ตาก', 'พิษณุโลก'}
    assert result['unmatched_previous_count'] == 2 and result['unmatched_current_count'] == 1


def test_largest_changes_require_thirty_in_both_years_and_half_point_threshold_is_strict():
    old = fixture_snapshot(2568, [school('LOW_PREVIOUS', tested=29), school('LOW_CURRENT', tested=30),
                                  school('EXACT_THIRTY', tested=30), school('HALF_UP', tested=200, infected=1),
                                  school('HALF_DOWN', tested=200, infected=1), school('OVER_HALF_UP'), school('OVER_HALF_DOWN', infected=1)])
    current = fixture_snapshot(2569, [school('LOW_PREVIOUS', tested=30, infected=30), school('LOW_CURRENT', tested=29, infected=29),
                                      school('EXACT_THIRTY', tested=30, infected=3), school('HALF_UP', tested=200, infected=2),
                                      school('HALF_DOWN', tested=200), school('OVER_HALF_UP', infected=1), school('OVER_HALF_DOWN')])
    result = history.compare_years(old, current)
    assert result['matched_count'] == 7 and result['eligible_large_change_count'] == 5
    assert result['min_tested_both_years'] == 30
    assert {'LOW_PREVIOUS', 'LOW_CURRENT'}.isdisjoint(row['school'] for row in result['largest_increases'])
    assert next(row for row in result['matched_schools'] if row['school'] == 'EXACT_THIRTY')['eligible_large_change']
    assert result['stable_count'] == 2, 'Exactly +/-0.5 points remain in the stable descriptive category'
    assert result['increased_count'] == 4 and result['decreased_count'] == 1
    assert result['change_threshold_pp'] == .5
    assert all(row['previous_tested'] >= 30 and row['current_tested'] >= 30 for row in result['largest_increases'] + result['largest_decreases'])


def test_unavailable_prior_year_and_missing_district_cohort_never_manufacture_zero_rates_or_private_fields():
    current = fixture_snapshot(2569, [school('CURRENT_ONLY', district='ใหม่', infected=10)])
    prior = fixture_snapshot(2568, [school('PREVIOUS_ONLY', district='เก่า', infected=20)])
    prior['schools'][0]['notes'] = 'PRIVATE_PATIENT_SECRET'
    current['schools'][0]['person_name'] = 'PRIVATE_PATIENT_SECRET'
    unavailable = history.compare_years(None, current)
    assert not unavailable['available'] and unavailable['previous_year'] is None
    assert 'matched_schools' not in unavailable
    result = history.compare_years(prior, current)
    new = next(row for row in result['by_district'] if row['district'] == 'ใหม่')
    assert new['previous_tested'] is None and new['previous_rate_percent'] is None and new['delta_pp'] is None
    old = next(row for row in result['by_district'] if row['district'] == 'เก่า')
    assert old['current_tested'] is None and old['current_rate_percent'] is None and old['delta_pp'] is None
    assert result['matched_count'] == 0
    assert 'PRIVATE_PATIENT_SECRET' not in json.dumps(result)
    assert any('บุคคลเดิม' in note for note in result['notes'])


def test_historical_report_disagreements_above_100_and_absent_denominators_remain_explicit():
    report = {'years': [2566, 2567],
              'prov': {'found': {'รวม': [None, 5.42]}, 'send': {'รวม': [0, 83.31]}},
              'agency': {'found': {'รวม': [0, 5.45]}, 'send': {'รวม': [0, 82.73]}},
              'amp': {'ตาก': {'found': {'พบพระ': [2.63, 1.93]}, 'send': {'พบพระ': [115.43, 100]}}},
              'species': {'v': {}}}
    result = history.history_dashboard({}, {'reported': report, 'source': {'file_name': 'SYNTHETIC.json', 'private_key': 'PRIVATE_SECRET'}})
    assert result['available'] and result['years'] == [2566, 2567]
    dimensions = {row['key']: row for row in result['dimensions']}
    prov = dimensions['province']['series'][0]
    agency = dimensions['affiliation']['series'][0]
    assert prov['coverage_percent'] == [None, 83.31]
    assert agency['infection_rate_percent'] == [None, 5.45]
    assert prov['reported_coverage_percent'] == [0, 83.31]
    assert agency['reported_coverage_percent'] == [0, 82.73]
    district = dimensions['district:ตาก']['series'][0]
    assert district['coverage_percent'][0] == 115.43, 'An outlier is flagged, not silently clipped to100'
    issues = result['quality']['issues']
    assert any(row['code'] == 'reported_coverage_above_100' and row['reported_value'] == 115.43 for row in issues)
    disagreements = [row for row in issues if row['code'] == 'reported_dimension_total_difference']
    assert len(disagreements) == 2
    assert {row['metric'] for row in disagreements} == {'coverage_percent', 'infection_rate_percent'}
    assert 'PRIVATE_SECRET' not in json.dumps(result)
    assert result['source']['historical_counts_available'] is False
    assert result['scope'] == 'independent_historical_controls'


def test_recent_history_uses_count_weighted_rates_and_positive_species_denominator_instead_of_reported_false_zero():
    old = fixture_snapshot(2568, [school('CENTER', tested=100, infected=10, affiliation='ศูนย์เด็กวันเตาะแตะ')])
    current = fixture_snapshot(2569, [school('CENTER', tested=200, infected=30, affiliation='ศูนย์เด็กวัยเตาะแตะ')])
    old['schools'][0]['enrolled'] = old['cubes'][0]['enrolled'] = 200
    current['schools'][0]['enrolled'] = current['cubes'][0]['enrolled'] = 400
    report = {'years': [2568, 2569], 'prov': {'found': {'รวม': [99, 99]}, 'send': {'รวม': [99, 99]}},
              'agency': {'found': {'ศูนย์เด็กวัยเตาะแตะ': [10, 0]}, 'send': {'ศูนย์เด็กวัยเตาะแตะ': [50, 0]}},
              'amp': {}, 'species': {'v': {'2568': [0] * 9, '2569': [0] * 9}}}
    result = history.history_dashboard({2568: old, 2569: current}, {'reported': report})
    agency = next(row for row in result['dimensions'] if row['key'] == 'affiliation')
    center = next(row for row in agency['series'] if row['name'] == 'ศูนย์เด็กวัยเตาะแตะ')
    assert center['coverage_percent'] == [50, 50] and center['infection_rate_percent'] == [10, 15]
    assert center['reported_coverage_percent'] == [50, 0]
    species = next(row for row in result['species_series'] if row['key'] == 'ascaris')
    assert species['positive_share_percent'] == [100, 100]
    assert species['denominator'] == 'reported_positive_people' and species['overlap_possible'] is True
    assert species['reported_positive_share_percent'] == [0, 0]
    assert any(row['code'] == 'recent_series_recomputed' and row['reported_value'] == 0 and row['computed_value'] == 50 for row in result['quality']['issues'])
    assert result['source']['recent_years_recomputed'] == [2568, 2569]


def test_actual_two_school_years_and_matched_change_ranking_match_independent_archive_audit():
    old, current = snapshot.load_year_dataset(2568), snapshot.load_year_dataset(2569)
    result = history.compare_years(old, current)
    assert result['available'] and result['previous_year'] == 2568 and result['year'] == 2569
    assert result['previous_summary']['total_students_known'] == 16799
    assert result['previous_summary']['tested_count'] == 15106 and result['previous_summary']['infected_count'] == 974
    assert result['current_summary']['tested_count'] == 15888 and result['current_summary']['infected_count'] == 698
    assert result['matched_count'] == 167 and result['eligible_large_change_count'] == 102
    assert (result['decreased_count'], result['increased_count'], result['stable_count']) == (92, 44, 31)
    assert result['ambiguous_match_count'] == 0
    assert result['unmatched_previous_count'] == 2 and result['unmatched_current_count'] == 3
    changed = {row['key']: row for row in result['kpis']}
    assert changed['infection_rate_percent']['delta'] == pytest.approx(-2.0545)
    assert changed['infection_rate_percent']['unit'] == 'percent'
    assert changed['infection_rate_percent']['delta_unit'] == 'percentage_points'
    assert changed['tested_count']['delta'] == 782 and changed['infected_count']['delta'] == -276
    assert changed['negative_school_count']['previous'] == 33 and changed['negative_school_count']['current'] == 61
    assert [row['school'] for row in result['largest_decreases']] == ['บ้านมอโจ', 'บ้านทีกอโกล', 'บ้านตะโก๊ะคี', 'บ้านแม่อมกิ(บ้านวะหย่าโจ)', 'บ้านห้วยขี้หมี']
    assert [row['school'] for row in result['largest_increases']] == ['บ้านมอกูตู้หลวง', 'บ้านแม่อมกิ(บ้านเคาะทีโคะ)', 'บ้านแม่เหว่ยทะ', 'ตชด.บ้านกามาผาโต้', 'ชช.บ้านท่าสองยาง(ทีซอเม)*']
    moved = next(row for row in result['matched_schools'] if row['school'] == 'ราชประชานุเคราะห์ที่ 13')
    assert moved['previous_district'] == 'ท่าปลา' and moved['district'] == 'น้ำปาด'
    assert moved['previous_tested'] == moved['current_tested'] == 147
    assert moved['previous_infected'] == 4 and moved['current_infected'] == 0
    for row in result['largest_decreases'] + result['largest_increases']:
        exact = Fraction(row['current_infected'] * 100, row['current_tested']) - Fraction(row['previous_infected'] * 100, row['previous_tested'])
        assert row['delta_pp'] == round(float(exact), 4)


def test_actual_history_preserves_reported_sources_and_flags_while_recomputing_recent_years_from_counts():
    response = snapshot.dashboard()
    result = response['data']['history']
    assert result['available'] and result['years'] == list(range(2557, 2570))
    assert result['source']['verification_status'] == 'historical_summary_supplied_original_workbooks_not_verified'
    assert result['source']['historical_counts_available'] is False
    assert result['source']['recent_years_recomputed'] == [2568, 2569]
    assert result['scope'] == 'independent_historical_controls'
    dimensions = {row['key']: row for row in result['dimensions']}
    assert len(dimensions) == 6
    series = lambda dimension, name: next(row for row in dimensions[dimension]['series'] if row['name'] == name)
    total = series('province', 'รวม')
    assert total['coverage_percent'][0] is None and total['infection_rate_percent'][0] is None
    assert series('province', 'ตาก')['infection_rate_percent'][0] == 36.75
    center = series('affiliation', 'ศูนย์เด็กวัยเตาะแตะ')
    assert center['reported_coverage_percent'][-1] == center['reported_infection_rate_percent'][-1] == 0
    assert center['coverage_percent'][-1] == pytest.approx(110 / 162 * 100, abs=.0001)
    assert center['infection_rate_percent'][-1] == pytest.approx(6 / 110 * 100, abs=.0001)
    index = result['years'].index(2567)
    assert total['reported_coverage_percent'][index] == total['coverage_percent'][index] == 83.31
    agency = series('affiliation', 'รวม')
    assert agency['reported_coverage_percent'][index] == agency['coverage_percent'][index] == 82.73
    index = result['years'].index(2565)
    assert series('district:ตาก', 'พบพระ')['coverage_percent'][index] == 115.43
    issues = result['quality']['issues']
    assert any(row['code'] == 'reported_dimension_total_difference' and row['year'] == 2567 for row in issues)
    assert any(row['code'] == 'reported_coverage_above_100' and row['year'] == 2565 for row in issues)
    assert any(row['code'] == 'recent_series_recomputed' and row['series'] == 'ศูนย์เด็กวัยเตาะแตะ' and row['year'] == 2569 for row in issues)
    species = {row['key']: row for row in result['species_series']}
    assert len(species) == 9
    assert species['ascaris']['positive_share_percent'][-2] == pytest.approx(781 / 974 * 100, abs=.0001)
    assert species['ascaris']['positive_share_percent'][-1] == pytest.approx(496 / 698 * 100, abs=.0001)
    assert species['ascaris']['positive_share_percent'][0] is None
    assert all(row['denominator'] == 'reported_positive_people' and row['overlap_possible'] for row in species.values())
    assert species['pinworm']['flagged_years'] == [2569]
    assert species['pinworm']['reported_positive_share_percent'][-1] == 1
    assert species['pinworm']['positive_share_percent'][-1] == pytest.approx(7 / 698 * 100, abs=.0001)
    main_rate = next(row for row in response['data']['by_parasite'] if row['key'] == 'ascaris')['rate_percent']
    assert main_rate == pytest.approx(496 / 15888 * 100, abs=.0001)
    assert species['ascaris']['positive_share_percent'][-1] != main_rate


def test_actual_year_selector_and_global_school_or_tambon_search_do_not_sum_years_or_impute_pending_zero():
    latest = snapshot.dashboard()['data']
    old = snapshot.dashboard({'year': 2568})['data']
    assert latest['available_years'] == old['available_years'] == [2568, 2569]
    assert len(old['by_school']) == 169 and len(latest['by_school']) == 170
    assert old['summary']['school_count'] == 174 and old['summary']['reported_school_count'] == 171
    assert old['summary']['tested_school_count'] == 169 and old['summary']['pending_school_count'] == 3
    assert old['summary']['zero_tested_school_count'] == 2
    assert old['summary']['total_students_known'] == 16799
    assert old['summary']['tested_count'] == 15106 and old['summary']['infected_count'] == 974
    assert old['summary']['multiple_infections_count'] == 91
    assert old['summary']['negative_school_count'] == 33 and old['summary']['positive_school_count'] == 136
    assert not old['comparison']['available'], 'Historical percentage tables do not supply prior-year school records'
    pending = snapshot.dashboard({'year': 2568, 'record_status': 'pending'})['data']
    assert pending['summary']['school_count'] == 3
    assert pending['summary']['tested_count'] is None and pending['summary']['infected_count'] is None
    assert pending['by_school'] == []
    one = snapshot.dashboard({'school_search': 'บ้านแม่อมกิ(บ้านเคาะทีโคะ)'})['data']
    assert one['summary']['school_count'] == 1 and one['summary']['tested_count'] == 35 and one['summary']['infected_count'] == 23
    assert len(one['by_school']) == len(one['comparison']['matched_schools']) == 1
    assert one['comparison']['previous_summary']['tested_count'] == 35 and one['comparison']['previous_summary']['infected_count'] == 7
    assert one['comparison']['current_summary']['infected_count'] == 23
    tambon = snapshot.dashboard({'school_search': 'แม่วะหลวง'})['data']
    assert tambon['by_school'] and all('แม่วะหลวง' in row['tambon'] or 'แม่วะหลวง' in row['school'] for row in tambon['by_school'])
    assert sum(row['tested_count'] for row in tambon['by_school']) == tambon['summary']['tested_count']
    assert sum(row['infected_count'] for row in tambon['by_school']) == tambon['summary']['infected_count']
    previous = snapshot.dashboard({'year': 2568, 'school_search': 'ราชประชานุเคราะห์ที่ 13'})
    assert previous['source']['verification_status'] == 'provided_archive_not_workbook_verified'
    assert previous['source']['year_basis'] == 'archive_year_field'
    assert previous['data']['summary']['tested_count'] == 147 and previous['data']['summary']['infected_count'] == 4
    assert len(previous['data']['by_school']) == 1
    assert {'archive_workbook_unverified', 'archive_zero_imputation'} <= {row['code'] for row in previous['data']['quality']['issues']}, 'Global provenance issues must survive a school-name search'
    empty = snapshot.dashboard({'year': 2568, 'school_search': 'DOES_NOT_EXIST'})['data']
    assert empty['summary']['school_count'] == 0 and empty['summary']['tested_count'] is None
    assert empty['by_school'] == []
    assert empty['history']['scope'] == 'independent_historical_controls'
    for year in (2567, 2570):
        with pytest.raises(Exception) as caught:
            snapshot.dashboard({'year': year})
        assert caught.value.status_code == 422


def test_comparison_rate_deltas_are_calculated_before_display_rounding():
    old = fixture_snapshot(2568, [school('ROUNDING', tested=3, infected=1)])
    current = fixture_snapshot(2569, [school('ROUNDING', tested=6, infected=1)])
    result = history.compare_years(old, current)
    rate = next(row for row in result['kpis'] if row['key'] == 'infection_rate_percent')
    assert rate['previous'] == 33.3333 and rate['current'] == 16.6667
    assert rate['delta'] == -16.6667, 'Subtract raw proportions before rounding; rounded displayed inputs would give -16.6666'
    assert rate['unit'] == 'percent' and rate['delta_unit'] == 'percentage_points'

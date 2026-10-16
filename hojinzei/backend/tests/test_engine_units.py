"""月数・端数処理・ルールの版選択の単体テスト。"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from taxengine.money import apply_rate, ceil_ratio, floor_unit, opt_sum, pct, prorate
from taxengine.periods import add_months, filing_deadline, months_in_period
from taxengine.rules.registry import RuleRegistry


@pytest.mark.parametrize('start,end,months', [
    (date(2026, 4, 1), date(2027, 3, 31), 12),
    (date(2026, 4, 15), date(2027, 3, 31), 12),  # 11か月と17日 → 12
    (date(2026, 6, 10), date(2027, 3, 31), 10),  # 9か月と22日 → 10
    (date(2026, 1, 1), date(2026, 1, 1), 1),  # 1日でも1か月
    (date(2026, 1, 31), date(2026, 2, 28), 1),  # 応当日のない月は月末で満了
    (date(2026, 1, 31), date(2026, 3, 1), 2),
    (date(2026, 10, 1), date(2027, 3, 31), 6),
    (date(2027, 4, 1), date(2028, 3, 31), 12),  # うるう年をまたぐ
])
def test_months_in_period(start, end, months):
    assert months_in_period(start, end) == months


def test_add_months_clips_to_month_end():
    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert add_months(date(2028, 1, 31), 1) == date(2028, 2, 29)


@pytest.mark.parametrize('fy_end,deadline', [
    (date(2027, 3, 31), date(2027, 5, 31)),
    (date(2026, 9, 30), date(2026, 11, 30)),
    (date(2026, 8, 31), date(2026, 10, 31)),
    (date(2026, 2, 28), date(2026, 4, 30)),
    (date(2026, 9, 15), date(2026, 11, 15)),
])
def test_filing_deadline(fy_end, deadline):
    assert filing_deadline(fy_end) == deadline


def test_filing_deadline_extension():
    assert filing_deadline(date(2027, 3, 31), 1) == date(2027, 6, 30)


def test_rounding():
    assert floor_unit(5_935_315, 1000) == 5_935_000
    assert floor_unit(874_935, 100) == 874_900
    with pytest.raises(ValueError):
        floor_unit(-1, 100)
    assert apply_rate(5_920_000, Decimal('0.15')) == (888_000, False)
    assert apply_rate(888_000, Decimal('0.103')) == (91_464, False)
    assert apply_rate(1_001, Decimal('0.15')) == (150, True)
    assert prorate(8_000_000, 10, 1000) == 6_666_000
    assert prorate(8_000_000, 7) == 4_666_666
    assert ceil_ratio(7, 12) == Decimal('0.584')
    assert ceil_ratio(13, 12) == Decimal(1)
    assert opt_sum([1, None, 2]) is None
    assert pct(Decimal('0.232')) == '23.2' and pct(Decimal('0.15')) == '15' and pct(Decimal('0.103')) == '10.3'


def test_rule_selection_by_basis():
    reg = RuleRegistry()
    assert reg.for_period('corporate_tax_rate', date(2025, 3, 1), date(2026, 2, 28)).version == '2019-04'
    assert reg.for_period('corporate_tax_rate', date(2025, 4, 1), date(2026, 3, 31)).version == '2025-04'
    assert reg.for_period('corporate_tax_rate', date(2027, 4, 1), date(2028, 3, 31)).status == 'unverified'
    # 様式は終了日で選ぶ
    assert reg.for_period('return_forms', date(2025, 10, 1), date(2026, 9, 30)).version == 'R8.4.1以後終了'
    assert reg.for_period('return_forms', date(2025, 4, 1), date(2026, 3, 31)).status == 'unverified'
    # 支出日で選ぶルール
    assert reg.find('meal_expense_threshold', date(2024, 4, 1)).values['per_person_limit'] == 10_000
    with pytest.raises(ValueError):
        reg.for_period('meal_expense_threshold', date(2024, 4, 1), date(2025, 3, 31))


def test_every_usable_rule_has_sources(tmp_path):
    reg = RuleRegistry()
    for rid in reg.ids():
        for rv in reg.versions(rid):
            if rv.status == 'source_checked':
                assert rv.sources, rv.ref
                assert all(s.url.startswith('https://') for s in rv.sources), rv.ref
                assert rv.checked_at and rv.checked_by, rv.ref


def test_overlapping_versions_are_rejected(tmp_path):
    bad = {'id': 'x', 'title': 'x', 'basis': 'fy_start', 'versions': [
        {'version': 'a', 'valid_from': '2020-01-01', 'valid_to': '2021-01-01', 'status': 'unverified'},
        {'version': 'b', 'valid_from': '2020-06-01', 'valid_to': None, 'status': 'unverified'}]}
    (tmp_path / 'x.json').write_text(json.dumps(bad), encoding='utf-8')
    with pytest.raises(ValueError):
        RuleRegistry(tmp_path)

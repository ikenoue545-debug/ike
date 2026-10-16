"""回帰テスト：一度確認した計算結果（全欄の値と指摘のコード）が、変更後も変わらないこと。

ゴールデンファイルは tests/golden/*.json。計算を意図して変えたときだけ、
  UPDATE_GOLDEN=1 .venv/bin/python -m pytest tests/test_engine_regression.py
で作り直し、差分を人が確認してからコミットする。
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

import test_engine_cases as cases
from factories import base_input
from taxengine.engine import compute_return
from taxengine.model import EntertainmentInput, EntertainmentRow, LossCarryforward, WithholdingItem, Adjustment
from datetime import date

GOLDEN = Path(__file__).resolve().parent / 'golden'


def _scenarios():
    yield 'profit_no_adjustments', base_input()
    yield 'deficit', cases.deficit_input()
    inp = base_input()
    inp.opening.losses = [LossCarryforward(date(2019, 4, 1), date(2020, 3, 31), 1_000_000),
                          LossCarryforward(date(2025, 4, 1), date(2026, 3, 31), 3_000_000)]
    yield 'loss_carryforward', inp
    yield 'entertainment', base_input(entertainment=EntertainmentInput(
        rows=[EntertainmentRow('交際費', 9_500_000, 0, 4_000_000)], reviewed_small_meals=True))
    yield 'mixed', base_input(
        adjustments=[Adjustment('a1', '減価償却の償却超過額', '6', 'add', 'ryuho', 450_000, five1_key='depreciation_excess',
                                five1_name='減価償却超過額', confirmed=True),
                     Adjustment('a2', '役員給与の損金不算入額', '7', 'add', 'sonota', 600_000, confirmed=True)],
        withholding=[WithholdingItem('interest', '架空銀行', 100_000, 15_315)])
    yield 'short_period', cases.short_input()
    yield 'defense', cases.big_income_input(60_000_000)


def snapshot(result) -> dict:
    return {
        'cells': {k: c['value'] if c['unit'] == 'yen' else c['text'] for k, c in sorted(result.cells.items())},
        'findings': sorted(f['code'] for f in result.findings),
        'summary': result.summary,
    }


@pytest.mark.parametrize('name,inp', list(_scenarios()), ids=[n for n, _ in _scenarios()])
def test_golden(name, inp):
    snap = snapshot(compute_return(inp))
    path = GOLDEN / f'{name}.json'
    if os.environ.get('UPDATE_GOLDEN') == '1' or not path.exists():
        GOLDEN.mkdir(exist_ok=True)
        path.write_text(json.dumps(snap, ensure_ascii=False, indent=1, sort_keys=True), encoding='utf-8')
        if os.environ.get('UPDATE_GOLDEN') != '1':
            pytest.fail(f'ゴールデンファイルがなかったので作りました: {path.name}（内容を確認してコミット）')
    expected = json.loads(path.read_text(encoding='utf-8'))
    assert snap == expected

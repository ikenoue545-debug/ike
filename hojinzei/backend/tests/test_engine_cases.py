"""計算エンジンの事例テスト（指示書16の12ケース）。

期待値はすべて、法令・様式の記載要領に従った手計算（コメントに計算過程）。
国税庁の記載例との照合はまだしていない（docs/03_検証結果.md に記載）。
"""
from __future__ import annotations

from dataclasses import replace
from datetime import date

import pytest

from factories import (Adjustment, EntertainmentInput, EntertainmentRow, LossCarryforward, OpeningRetainedItem,
                       TaxPayment, WithholdingItem, base_input)
from taxengine.cells import Override
from taxengine.engine import compute_return
from taxengine.model import Financials, Opening, Profile, ReserveRow, TaxInputs


def v(result, key):
    return result.cells[key]['value']


def codes(result, severity=None):
    return {f['code'] for f in result.findings if severity is None or f['severity'] == severity}


def assert_balanced(r):
    """別表間の検算が合っていること。"""
    assert v(r, 'b5_1:check:value') == 0
    assert 'B5_1_CHECK' not in codes(r)
    assert 'B4_ROW_BALANCE' not in codes(r)


# ---------------------------------------------------------------- 1 税務調整がない黒字法人
def test_01_profit_no_adjustments():
    r = compute_return(base_input())
    # 別表四：1 当期利益 4,500,000 ＋ 4 納税充当金 1,500,000 − 13 充当金から支出した事業税 80,000 ＝ 5,920,000
    assert v(r, 'b4:1:total') == 4_500_000
    assert v(r, 'b4:4:total') == 1_500_000
    assert v(r, 'b4:13:total') == 80_000
    assert v(r, 'b4:52:total') == 5_920_000
    assert v(r, 'b4:52:ryuho') == 5_920_000
    # 別表一：所得 5,920,000（年800万円以下）× 15% ＝ 888,000
    assert v(r, 'b1n2:74:value') == 5_920_000
    assert v(r, 'b1n2:76:value') == 0
    assert v(r, 'b1n2:77:value') == 888_000
    assert v(r, 'b1:2:value') == 888_000
    assert v(r, 'b1:13:value') == 888_000
    assert v(r, 'b1:15:value') == 888_000
    # 地方法人税：888,000 × 10.3% ＝ 91,464 → 100円未満切捨て 91,400
    assert v(r, 'b1:30:value') == 888_000
    assert v(r, 'b1n2:82:value') == 91_464
    assert v(r, 'b1:38:value') == 91_400
    assert v(r, 'b1:40:value') == 91_400
    # 防衛特別法人税：基準法人税額 888,000 − 基礎控除 5,000,000 < 0 → 0。申告は必要
    assert v(r, 'b1:45:value') == 888_000
    assert v(r, 'b1:47:value') == 5_000_000
    assert v(r, 'b1:67:value') == 0
    assert v(r, 'b1:59:value') == 0
    assert 'B1_DEFENSE_FILING' in codes(r, 'info')
    # 別表五(二)：当期確定 888,000 ＋ 91,400 ＋ 0 ＝ 979,400、納税充当金 550,000 ＋ 1,500,000 − 550,000 ＝ 1,500,000
    assert v(r, 'b5_2:4:2') == 979_400
    assert v(r, 'b5_2:5:6') == 979_400
    assert v(r, 'b5_2:41:value') == 1_500_000
    assert 'B5_2_PROVISION_MISMATCH' not in codes(r)
    # 別表五(一)：期首 10,000,000＋550,000−300,000−50,000−120,000 ＝ 10,080,000
    #            期末 14,500,000＋1,500,000−979,400−28,800−103,200 ＝ 14,888,600
    assert v(r, 'b5_1:31:1') == 10_080_000
    assert v(r, 'b5_1:31:4') == 14_888_600
    assert v(r, 'b5_1:27:4') == -979_400
    assert_balanced(r)
    assert 'B5_1_CONTINUITY' not in codes(r)
    assert r.critical_count == 0
    assert r.summary['filing_deadline'] == '2027-05-31'


# ---------------------------------------------------------------- 2 赤字法人
def deficit_input():
    inp = base_input()
    # 税引前 △2,000,000、均等割 70,000（道府県 20,000・市町村 50,000）を未払計上 → 当期純損失 △2,070,000
    inp.financials = replace(inp.financials, net_income=-2_070_000, retained_earnings_open=3_000_000,
                             retained_earnings_close=930_000, tax_provision_open=70_000, tax_provision_close=70_000)
    inp.taxes = TaxInputs(payments=[
        TaxPayment('prefectural', 'prior', '前期確定分', opening_unpaid=20_000, paid_provision=20_000),
        TaxPayment('municipal', 'prior', '前期確定分', opening_unpaid=50_000, paid_provision=50_000),
    ], provision_charged=70_000, final_prefectural=20_000, final_municipal=50_000, final_enterprise=0)
    inp.opening = Opening(prior_retained_total=3_000_000, prior_unpaid_national=None, losses_confirmed=True)
    return inp


def test_02_deficit():
    r = compute_return(deficit_input())
    # 別表四：△2,070,000 ＋ 70,000 ＝ △2,000,000
    assert v(r, 'b4:23:total') == -2_000_000
    assert v(r, 'b4:44:total') == 0
    assert v(r, 'b4:52:total') == -2_000_000
    # 別表七(一)：当期の青色欠損金 2,000,000 を翌期へ
    assert v(r, 'b7_1:2:value') == 0
    assert v(r, 'b7_1:cur:5') == 2_000_000
    assert v(r, 'b7_1:5:total') == 2_000_000
    assert v(r, 'b1:27:value') == 2_000_000
    # 税額はすべて0（防衛特別法人税も0だが申告は必要）
    for k in ('b1:2:value', 'b1:13:value', 'b1:15:value', 'b1:30:value', 'b1:38:value', 'b1:40:value', 'b1:59:value'):
        assert v(r, k) == 0, k
    assert v(r, 'b1:48:value') == 5_000_000
    # 別表五(一)：期首 3,000,000＋70,000−20,000−50,000 ＝ 3,000,000、期末 930,000＋70,000−20,000−50,000 ＝ 930,000
    assert v(r, 'b5_1:31:1') == 3_000_000
    assert v(r, 'b5_1:31:4') == 930_000
    assert_balanced(r)
    assert r.critical_count == 0


# ---------------------------------------------------------------- 3 繰越欠損金がある法人
def test_03_loss_carryforward():
    inp = base_input()
    inp.opening.losses = [
        LossCarryforward(date(2016, 4, 1), date(2017, 3, 31), 500_000),  # 平成30年4月前開始：9年 → 当期は期限切れ
        LossCarryforward(date(2019, 4, 1), date(2020, 3, 31), 1_000_000),
        LossCarryforward(date(2025, 4, 1), date(2026, 3, 31), 3_000_000),
    ]
    r = compute_return(inp)
    # 控除前所得 5,920,000、限度額 100%（中小法人等）
    assert v(r, 'b7_1:1:value') == 5_920_000
    assert v(r, 'b7_1:2:value') == 5_920_000
    assert v(r, 'b7_1:r1:4') == 0 and v(r, 'b7_1:r1:5') == 0
    assert 'B7_1_EXPIRED' in codes(r, 'info')
    assert v(r, 'b7_1:r2:4') == 1_000_000 and v(r, 'b7_1:r2:5') == 0
    assert v(r, 'b7_1:r3:4') == 3_000_000 and v(r, 'b7_1:r3:5') == 0
    assert v(r, 'b7_1:4:total') == 4_000_000
    assert v(r, 'b4:44:total') == -4_000_000
    assert v(r, 'b4:44:kome') == -4_000_000
    assert v(r, 'b4:52:total') == 1_920_000
    # ②留保は欠損金控除の影響を受けない（※）
    assert v(r, 'b4:52:ryuho') == 5_920_000
    # 1,920,000 × 15% ＝ 288,000、地方法人税 288,000 × 10.3% ＝ 29,664 → 29,600
    assert v(r, 'b1:13:value') == 288_000
    assert v(r, 'b1:38:value') == 29_600
    assert v(r, 'b1:26:value') == 4_000_000
    assert_balanced(r)


def test_03b_loss_partially_used_and_limit():
    inp = base_input()
    inp.opening.losses = [LossCarryforward(date(2024, 4, 1), date(2025, 3, 31), 8_000_000)]
    r = compute_return(inp)
    assert v(r, 'b7_1:r1:4') == 5_920_000
    assert v(r, 'b7_1:r1:5') == 2_080_000
    assert v(r, 'b4:52:total') == 0
    assert v(r, 'b1:15:value') == 0
    assert v(r, 'b1:27:value') == 2_080_000


def test_03c_non_sme_50_percent_limit_and_rate():
    """資本金1億円以下でも大法人の100%子会社は中小法人等に当たらない：欠損金50%、税率23.2%。"""
    inp = base_input()
    inp.profile = Profile(capital_end=10_000_000, large_corp_subsidiary=True, tekiyo_jogai=False)
    inp.opening.losses = [LossCarryforward(date(2024, 4, 1), date(2025, 3, 31), 8_000_000)]
    r = compute_return(inp)
    assert r.sme is False
    assert v(r, 'b7_1:2:value') == 2_960_000  # 5,920,000 × 50%
    assert v(r, 'b4:52:total') == 2_960_000
    assert v(r, 'b1n2:74:value') == 0
    assert v(r, 'b1n2:79:value') == 686_720  # 2,960,000 × 23.2%
    assert v(r, 'b1:13:value') == 686_700


# ---------------------------------------------------------------- 4 交際費の損金不算入がある法人
def test_04_entertainment_fixed_deduction():
    inp = base_input(entertainment=EntertainmentInput(
        rows=[EntertainmentRow('交際費', 9_500_000, 0, 4_000_000)], reviewed_small_meals=True))
    r = compute_return(inp)
    # 定額控除限度額 min(9,500,000, 8,000,000) ＝ 8,000,000 ＞ 接待飲食費 4,000,000 × 50% ＝ 2,000,000
    assert v(r, 'b15:1:value') == 9_500_000
    assert v(r, 'b15:2:value') == 2_000_000
    assert v(r, 'b15:3:value') == 8_000_000
    assert v(r, 'b15:4:value') == 8_000_000
    assert v(r, 'b15:5:value') == 1_500_000
    assert v(r, 'b4:8:total') == 1_500_000
    assert v(r, 'b4:8:sonota') == 1_500_000
    assert v(r, 'b4:52:total') == 7_420_000
    assert v(r, 'b4:52:ryuho') == 5_920_000
    # 7,420,000 × 15% ＝ 1,113,000、地方法人税 1,113,000 × 10.3% ＝ 114,639 → 114,600
    assert v(r, 'b1:13:value') == 1_113_000
    assert v(r, 'b1:38:value') == 114_600
    assert_balanced(r)
    assert 'B15_SMALL_MEALS' not in codes(r)


def test_04b_entertainment_food_half_is_better():
    inp = base_input(entertainment=EntertainmentInput(
        rows=[EntertainmentRow('交際費', 20_000_000, 0, 18_000_000)], reviewed_small_meals=False))
    r = compute_return(inp)
    assert v(r, 'b15:2:value') == 9_000_000
    assert v(r, 'b15:4:value') == 9_000_000
    assert v(r, 'b15:5:value') == 11_000_000
    assert 'B15_SMALL_MEALS' in codes(r, 'warning')


def test_04c_entertainment_food_exceeds_is_critical():
    inp = base_input(entertainment=EntertainmentInput(rows=[EntertainmentRow('交際費', 100, 0, 200)], reviewed_small_meals=True))
    r = compute_return(inp)
    assert 'B15_FOOD_EXCEEDS' in codes(r, 'critical')


# ---------------------------------------------------------------- 5 減価償却超過額がある法人
def test_05_depreciation_excess():
    inp = base_input(adjustments=[Adjustment('a1', '減価償却の償却超過額', '6', 'add', 'ryuho', 450_000, status='review',
                                             five1_key='depreciation_excess', five1_name='減価償却超過額', confirmed=True)])
    r = compute_return(inp)
    assert v(r, 'b4:6:total') == 450_000
    assert v(r, 'b4:6:ryuho') == 450_000
    assert v(r, 'b4:52:total') == 6_370_000
    assert v(r, 'b4:52:ryuho') == 6_370_000
    # 6,370,000 × 15% ＝ 955,500。地方法人税 955,000 × 10.3% ＝ 98,365 → 98,300
    assert v(r, 'b1:13:value') == 955_500
    assert v(r, 'b1:30:value') == 955_000
    assert v(r, 'b1:38:value') == 98_300
    # 別表五(一)に減価償却超過額 450,000（③増）
    rows = {row['label']: row for row in next(s for s in r.schedules if s['id'] == 'b5_1')['rows']}
    line = rows['減価償却超過額']['line']
    assert v(r, f'b5_1:{line}:3') == 450_000
    assert v(r, f'b5_1:{line}:4') == 450_000
    assert_balanced(r)
    assert r.critical_count == 0


# ---------------------------------------------------------------- 6 役員給与に税務上の問題がある法人
def test_06_officer_compensation():
    inp = base_input(adjustments=[Adjustment('a1', '役員給与の損金不算入額（定期同額給与に当たらない増額分）', '7', 'add',
                                             'sonota', 600_000, status='review', confirmed=False,
                                             basis=('法人税法第34条第1項',))])
    r = compute_return(inp)
    assert v(r, 'b4:7:total') == 600_000
    assert v(r, 'b4:7:sonota') == 600_000
    assert v(r, 'b4:52:total') == 6_520_000
    assert v(r, 'b4:52:ryuho') == 5_920_000
    assert v(r, 'b4:52:sonota') == 600_000
    assert 'B4_ADJ_REVIEW' in codes(r, 'warning')  # 未確認の調整は要確認
    assert_balanced(r)


def test_06b_wrong_disposition_is_critical():
    inp = base_input(adjustments=[Adjustment('a1', '役員給与', '7', 'add', 'ryuho', 600_000, five1_key='x', confirmed=True)])
    r = compute_return(inp)
    assert 'B4_ADJ_DISPOSITION' in codes(r, 'critical')


# ---------------------------------------------------------------- 7 受取利息の源泉所得税がある法人
def test_07_withholding_on_interest():
    inp = base_input(withholding=[WithholdingItem('interest', '架空銀行', 100_000, 15_315, booking='expense')])
    r = compute_return(inp)
    assert v(r, 'b6_1:1:3') == 15_315
    assert v(r, 'b6_1:6:3') == 15_315
    assert v(r, 'b4:29:total') == 15_315
    assert v(r, 'b4:29:sonota') == 15_315
    # 所得 5,935,315 → 課税標準 5,935,000 × 15% ＝ 890,250
    assert v(r, 'b4:52:total') == 5_935_315
    assert v(r, 'b1n2:74:value') == 5_935_000
    assert v(r, 'b1:2:value') == 890_250
    assert v(r, 'b1:12:value') == 15_315
    # 差引所得に対する法人税額 890,250 − 15,315 ＝ 874,935 → 874,900
    assert v(r, 'b1:13:value') == 874_900
    # 地方法人税は所得税額控除前の法人税額が基礎：890,000 × 10.3% ＝ 91,670 → 91,600
    assert v(r, 'b1:38:value') == 91_600
    assert_balanced(r)


def test_07b_withholding_refund_when_deficit():
    inp = deficit_input()
    inp.withholding = [WithholdingItem('interest', '架空銀行', 100_000, 15_315)]
    r = compute_return(inp)
    assert v(r, 'b1:12:value') == 0
    assert v(r, 'b1:20:value') == 15_315
    assert v(r, 'b1:21:value') == 15_315
    assert 'B1_REFUND' in codes(r, 'info')
    assert_balanced(r)


def test_07c_withholding_booked_as_suspense():
    inp = base_input(withholding=[WithholdingItem('interest', '架空銀行', 100_000, 15_315, booking='suspense')])
    r = compute_return(inp)
    # 減算（留保）15,315 と加算（社外流出）15,315 で所得は変わらない
    assert v(r, 'b4:52:total') == 5_920_000
    assert v(r, 'b4:52:ryuho') == 5_920_000 - 15_315
    assert_balanced(r)


def test_07d_dividend_individual_method():
    inp = base_input(withholding=[WithholdingItem('dividend', '架空工業株式会社', 50_000, 10_210, method='individual',
                                                  calc_months=12, owned_months=7)])
    r = compute_return(inp)
    # 所有期間割合 7/12 ＝ 0.58333… → 小数点以下3位未満切上げ 0.584。10,210 × 0.584 ＝ 5,962.64 → 5,962
    assert r.cells['b6_1:ind1:11']['text'] == '0.584'
    assert v(r, 'b6_1:2:3') == 5_962


# ---------------------------------------------------------------- 8 前期の税務調整項目を繰り越す法人
def test_08_prior_adjustment_reversal():
    inp = base_input(adjustments=[Adjustment('a1', '減価償却超過額の当期認容額', '12', 'deduct', 'ryuho', 100_000,
                                             status='review', five1_key='depreciation_excess', five1_name='減価償却超過額',
                                             five1_column='decrease', confirmed=True)])
    inp.opening.retained_items = [OpeningRetainedItem('depreciation_excess', '減価償却超過額', 300_000)]
    inp.opening.prior_retained_total = 10_380_000
    r = compute_return(inp)
    assert v(r, 'b4:12:total') == 100_000
    assert v(r, 'b4:52:total') == 5_820_000
    rows = {row['label']: row for row in next(s for s in r.schedules if s['id'] == 'b5_1')['rows']}
    line = rows['減価償却超過額']['line']
    assert (v(r, f'b5_1:{line}:1'), v(r, f'b5_1:{line}:2'), v(r, f'b5_1:{line}:4')) == (300_000, 100_000, 200_000)
    # 5,820,000 × 15% ＝ 873,000、地方法人税 873,000 × 10.3% ＝ 89,919 → 89,900
    assert v(r, 'b1:13:value') == 873_000
    assert v(r, 'b1:38:value') == 89_900
    # 期末 31④ ＝ 10,380,000 ＋ 5,820,000 − (962,900 ＋ 28,800 ＋ 103,200) ＝ 15,105,100
    assert v(r, 'b5_1:31:1') == 10_380_000
    assert v(r, 'b5_1:31:4') == 15_105_100
    assert_balanced(r)
    assert 'B5_1_CONTINUITY' not in codes(r)


def test_08b_continuity_mismatch_is_critical():
    inp = base_input()
    inp.opening.prior_retained_total = 9_999_999
    r = compute_return(inp)
    assert 'B5_1_CONTINUITY' in codes(r, 'critical')


# ---------------------------------------------------------------- 9 事業年度が12か月未満の法人
def short_input():
    inp = base_input(start=date(2026, 6, 10), end=date(2027, 3, 31))
    inp.financials = Financials(net_income=7_000_000, retained_earnings_open=0, retained_earnings_close=7_000_000,
                                tax_provision_open=0, tax_provision_close=0,
                                capital_rows=[ReserveRow('資本金又は出資金', 0, 3_000_000)])
    inp.taxes = TaxInputs(provision_charged=0, final_prefectural=30_000, final_municipal=110_000)
    inp.opening = Opening(prior_retained_total=0, losses_confirmed=True)
    return inp


def test_09_short_period():
    r = compute_return(short_input())
    # 令和8年6月10日〜令和9年3月31日：9か月と22日 → 10か月
    assert r.months == 10
    # 800万円 × 10/12 ＝ 6,666,666 → 千円未満切捨て 6,666,000
    assert v(r, 'b1n2:74:value') == 6_666_000
    assert v(r, 'b1n2:76:value') == 334_000
    assert v(r, 'b1n2:77:value') == 999_900
    assert v(r, 'b1n2:79:value') == 77_488  # 334,000 × 23.2%
    assert v(r, 'b1:2:value') == 1_077_388
    assert v(r, 'b1:13:value') == 1_077_300
    # 地方法人税 1,077,000 × 10.3% ＝ 110,931 → 110,900
    assert v(r, 'b1:38:value') == 110_900
    # 防衛特別法人税の基礎控除 500万円 × 10/12 ＝ 4,166,666
    assert v(r, 'b1:47:value') == 4_166_666
    assert v(r, 'b1:59:value') == 0
    assert 'B1_DEFENSE_SHORT' in codes(r, 'info')
    assert_balanced(r)
    assert r.summary['filing_deadline'] == '2027-05-31'


def test_09b_short_period_entertainment_limit():
    inp = short_input()
    inp.entertainment = EntertainmentInput(rows=[EntertainmentRow('交際費', 5_000_000, 0, 0)], reviewed_small_meals=True)
    r = compute_return(inp)
    # 800万円 × 10/12 ＝ 6,666,666（1円未満切捨て）。支出 5,000,000 の方が少ない
    assert v(r, 'b15:3:value') == 5_000_000
    assert v(r, 'b15:5:value') == 0
    inp.entertainment = EntertainmentInput(rows=[EntertainmentRow('交際費', 7_000_000, 0, 0)], reviewed_small_meals=True)
    r = compute_return(inp)
    assert v(r, 'b15:3:value') == 6_666_666
    assert v(r, 'b15:5:value') == 333_334


# ---------------------------------------------------------------- 10 法人税ゼロでも地方税均等割が発生する法人
def test_10_zero_corporate_tax_but_per_capita_levy():
    r = compute_return(deficit_input())
    assert v(r, 'b1:15:value') == 0
    # 均等割は入力値として別表五(二)・五(一)に反映（地方税の計算そのものは Phase 3）
    assert v(r, 'b5_2:9:2') == 20_000
    assert v(r, 'b5_2:14:2') == 50_000
    assert v(r, 'b5_1:29:3') == -20_000
    assert v(r, 'b5_1:30:3') == -50_000
    assert 'B5_2_LOCAL_MANUAL_PREFECTURAL' in codes(r, 'warning')


def test_10b_missing_local_tax_is_critical():
    inp = deficit_input()
    inp.taxes.final_municipal = None
    r = compute_return(inp)
    assert 'B5_2_LOCAL_MUNICIPAL' in codes(r, 'critical')
    assert v(r, 'b5_1:31:4') is None  # 0円で埋めない


# ---------------------------------------------------------------- 11 防衛特別法人税の適用がある法人
def big_income_input(net_income: int):
    inp = base_input()
    inp.financials = replace(inp.financials, net_income=net_income, retained_earnings_close=10_000_000 + net_income,
                             tax_provision_open=0, tax_provision_close=0)
    inp.taxes = TaxInputs(provision_charged=0, final_prefectural=0, final_municipal=0)
    inp.opening = Opening(prior_retained_total=10_000_000, losses_confirmed=True)
    return inp


def test_11_defense_special_corporate_tax():
    r = compute_return(big_income_input(60_000_000))
    # 8,000,000 × 15% ＋ 52,000,000 × 23.2% ＝ 1,200,000 ＋ 12,064,000 ＝ 13,264,000
    assert v(r, 'b1:2:value') == 13_264_000
    # 防衛：(13,264,000 − 5,000,000) ＝ 8,264,000 × 4% ＝ 330,560 → 330,500
    assert v(r, 'b1:45:value') == 13_264_000
    assert v(r, 'b1:67:value') == 8_264_000
    assert v(r, 'b1:68:value') == 330_560
    assert v(r, 'b1:57:value') == 330_500
    assert v(r, 'b1:59:value') == 330_500
    # 地方法人税：13,264,000 × 10.3% ＝ 1,366,192 → 1,366,100
    assert v(r, 'b1:38:value') == 1_366_100
    assert v(r, 'b5_2:4:2') == 13_264_000 + 1_366_100 + 330_500
    assert_balanced(r)


def test_11b_defense_not_applicable_before_2026_04():
    inp = big_income_input(60_000_000)
    inp.period.start, inp.period.end = date(2025, 10, 1), date(2026, 9, 30)
    r = compute_return(inp)
    b1n1 = next(s for s in r.schedules if s['id'] == 'b1n1')
    assert b1n1['status'] == 'not_applicable'
    assert v(r, 'b1:59:value') == 0
    assert 'b1:45:value' not in r.cells
    assert v(r, 'b1:2:value') == 13_264_000


def test_11c_sme_rate_17_percent_over_1bn():
    r = compute_return(big_income_input(1_200_000_000))
    assert v(r, 'b1n2:77:value') == 1_360_000  # 8,000,000 × 17%


def test_11d_tekiyo_jogai_19_percent():
    inp = big_income_input(60_000_000)
    inp.profile.tekiyo_jogai = True
    r = compute_return(inp)
    assert v(r, 'b1n2:77:value') == 1_520_000  # 8,000,000 × 19%


def test_11e_fy_before_2025_04_has_no_17_percent_tier():
    inp = big_income_input(1_200_000_000)
    inp.period.start, inp.period.end = date(2025, 4, 1), date(2026, 3, 31)
    r = compute_return(inp)
    # 令和8年3月31日終了は旧様式のため確定不可（重大エラー）。税率は令和7年4月1日以後開始の版（17%）
    assert 'FORM_VERSION' in codes(r, 'critical')
    assert v(r, 'b1n2:77:value') == 1_360_000


# ---------------------------------------------------------------- 12 必要資料が不足している法人
def test_12_missing_documents_stay_unknown():
    inp = base_input()
    inp.financials = replace(inp.financials, net_income=None)
    inp.taxes.provision_charged = None
    r = compute_return(inp)
    assert {'B4_NET_INCOME', 'B5_2_PROVISION_CHARGED'} <= codes(r, 'critical')
    # 未確定は0円にならない
    for k in ('b4:1:total', 'b4:52:total', 'b1:1:value', 'b1:2:value', 'b1:15:value', 'b1:40:value', 'b5_1:31:4'):
        assert v(r, k) is None, k


def test_12b_unknown_sme_status():
    inp = base_input()
    inp.profile = Profile(capital_end=None)
    r = compute_return(inp)
    assert 'SME_CAPITAL_UNKNOWN' in codes(r, 'critical')
    assert v(r, 'b1:2:value') is None


def test_12c_unknown_adjustment_amount():
    inp = base_input(adjustments=[Adjustment('a1', '寄附金の損金不算入額', '27', 'add', 'sonota', None, status='missing')])
    r = compute_return(inp)
    assert {'B4_ADJ_AMOUNT_UNKNOWN', 'B4_ADJ_MISSING_DOCS'} <= codes(r, 'critical')
    assert v(r, 'b4:52:total') is None


# ---------------------------------------------------------------- 範囲外・ルール・上書き
@pytest.mark.parametrize('feature', ['foreign_tax_credit', 'special_tax_credit', 'multi_jurisdiction'])
def test_unsupported_feature_blocks(feature):
    inp = base_input()
    inp.profile.unsupported_features = [feature]
    r = compute_return(inp)
    assert any(c.startswith('SCOPE_FEATURE_') for c in codes(r, 'critical'))


def test_large_capital_out_of_scope():
    inp = base_input()
    inp.profile.capital_end = 200_000_000
    r = compute_return(inp)
    assert 'SCOPE_LARGE_CAPITAL' in codes(r, 'critical')


def test_rate_rule_after_expiry_blocks():
    inp = base_input(start=date(2027, 4, 1), end=date(2028, 3, 31))
    r = compute_return(inp)
    assert 'B1_RATE_RULE' in codes(r, 'critical')
    assert v(r, 'b1:2:value') is None


def test_override_is_used_and_flagged():
    inp = base_input()
    inp.overrides = {'b1:14:value': Override(100_000, '中間申告書の控えで確認')}
    r = compute_return(inp)
    assert v(r, 'b1:14:value') == 100_000
    assert r.cells['b1:14:value']['source'] == 'override'
    assert v(r, 'b1:15:value') == 788_000
    assert 'OVERRIDE_USED' in codes(r, 'warning')


def test_rules_used_are_recorded():
    r = compute_return(base_input())
    refs = {f"{x['rule_id']}@{x['version']}" for x in r.rules_used}
    assert {'corporate_tax_rate@2025-04', 'local_corporate_tax@2019-10', 'defense_special_corporate_tax@2026-04',
            'return_forms@R8.4.1以後終了'} <= refs

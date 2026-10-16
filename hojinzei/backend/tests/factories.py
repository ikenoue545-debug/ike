"""テスト用の入力を作る。数値はすべて架空。"""
from __future__ import annotations

from datetime import date

from taxengine.model import (EntertainmentInput, EntertainmentRow, Financials, LossCarryforward, Opening,
                             OpeningRetainedItem, Period, Profile, ReserveRow, ReturnInput, TaxInputs, TaxPayment,
                             WithholdingItem, Adjustment)


def base_input(**kw) -> ReturnInput:
    """黒字・税務調整なしの中小法人（令和8年4月1日〜令和9年3月31日、12か月）。

    税引前利益 6,000,000、未払法人税等の計上 1,500,000 → 当期純利益 4,500,000。
    前期確定分の法人税等 300,000・道府県民税 50,000・市町村民税 120,000・事業税 80,000 を納税充当金から納付。
    """
    start = kw.pop('start', date(2026, 4, 1))
    end = kw.pop('end', date(2027, 3, 31))
    fin = Financials(
        net_income=4_500_000, dividends=0,
        retained_earnings_open=10_000_000, retained_earnings_close=14_500_000,
        tax_provision_open=550_000, tax_provision_close=1_500_000,
        capital_rows=[ReserveRow('資本金又は出資金', 10_000_000, 10_000_000)],
    )
    taxes = TaxInputs(
        payments=[
            TaxPayment('national', 'prior', '前期確定分', opening_unpaid=300_000, paid_provision=300_000),
            TaxPayment('prefectural', 'prior', '前期確定分', opening_unpaid=50_000, paid_provision=50_000),
            TaxPayment('municipal', 'prior', '前期確定分', opening_unpaid=120_000, paid_provision=120_000),
            TaxPayment('enterprise', 'prior', '前期確定分', opening_unpaid=80_000, paid_provision=80_000),
        ],
        provision_charged=1_500_000,
        final_prefectural=28_800, final_municipal=103_200, final_enterprise=300_000,
    )
    inp = ReturnInput(
        company_name='テスト商事株式会社（架空）',
        period=Period(start, end),
        profile=Profile(capital_end=10_000_000, large_corp_subsidiary=False, tekiyo_jogai=False),
        financials=fin, taxes=taxes,
        opening=Opening(prior_retained_total=10_080_000, prior_unpaid_national=300_000, losses_confirmed=True),
    )
    for k, v in kw.items():
        setattr(inp, k, v)
    return inp


__all__ = ['base_input', 'Adjustment', 'EntertainmentInput', 'EntertainmentRow', 'LossCarryforward',
           'OpeningRetainedItem', 'TaxPayment', 'WithholdingItem', 'ReserveRow', 'Period', 'Financials', 'Opening',
           'TaxInputs', 'Profile']

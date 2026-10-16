"""翌期への引継ぎ：承認した計算結果から、翌事業年度の期首情報を作る。

引き継ぐもの：別表五(一)の各行の④、利益積立金額の合計、繰越欠損金（別表七(一)の翌期繰越額と当期の欠損金）、
別表五(二)の期末未納税額（翌期の「前期以前」の行の①）、期末納税充当金、資本金の額。
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import CarryforwardItem, FiscalYear, InputSection, ReturnSnapshot
from ..periods_compat import add_years_minus_one_day


def next_period(fy: FiscalYear) -> tuple[date, date]:
    start = fy.end_date + timedelta(days=1)
    return start, add_years_minus_one_day(start)


def create_next_year(db: Session, fy: FiscalYear, snapshot: ReturnSnapshot, user_id: int | None) -> FiscalYear:
    start, end = next_period(fy)
    exists = db.scalar(select(FiscalYear).where(FiscalYear.company_id == fy.company_id, FiscalYear.start_date == start))
    if exists:
        raise ValueError('翌事業年度はすでにあります')
    cf = snapshot.result.get('carryforward') or {}
    nxt = FiscalYear(company_id=fy.company_id, start_date=start, end_date=end, return_kind='final', blue_return=fy.blue_return,
                     capital_end=None, large_corp_subsidiary=fy.large_corp_subsidiary, tekiyo_jogai=None,
                     group_tsusan=fy.group_tsusan, dividends=None, unsupported_features=[], status='not_started',
                     previous_id=fy.id)
    db.add(nxt)
    db.flush()
    for it in cf.get('retained_items', []):
        db.add(CarryforwardItem(fiscal_year_id=nxt.id, kind='retained', key=it['key'], name=it['name'], amount=it['amount'],
                                source='carryover', confirmed=True, confirmed_by=user_id))
    for l in cf.get('losses', []):
        db.add(CarryforwardItem(fiscal_year_id=nxt.id, kind='loss', key=None,
                                name=f'{l["fy_start"]}〜{l["fy_end"]} の欠損金', amount=l['amount'],
                                loss_fy_start=date.fromisoformat(l['fy_start']), loss_fy_end=date.fromisoformat(l['fy_end']),
                                source='carryover', confirmed=True, confirmed_by=user_id))
    unpaid = cf.get('unpaid', {})
    label = f'{fy.start_date.isoformat()}〜{fy.end_date.isoformat()}'
    payments = []
    for tax in ('national', 'prefectural', 'municipal'):
        if unpaid.get(tax):
            payments.append({'tax': tax, 'period': 'prior', 'label': label, 'other_kind': '', 'opening_unpaid': unpaid[tax],
                             'accrued': 0, 'paid_provision': 0, 'paid_suspense': 0, 'paid_expense': 0})
    if unpaid.get('enterprise_final'):
        payments.append({'tax': 'enterprise', 'period': 'prior', 'label': label, 'other_kind': '',
                         'opening_unpaid': unpaid['enterprise_final'], 'accrued': 0, 'paid_provision': 0,
                         'paid_suspense': 0, 'paid_expense': 0})
    db.add(InputSection(fiscal_year_id=nxt.id, section='tax_payments', updated_by=user_id,
                        data={'payments': payments, 'interim_corporate_tax': 0, 'interim_local_corporate_tax': 0,
                              'interim_defense_tax': 0}))
    db.add(InputSection(fiscal_year_id=nxt.id, section='opening_meta', updated_by=user_id,
                        data={'losses_confirmed': True, 'prior_retained_total': cf.get('retained_total'),
                              'prior_unpaid_national': unpaid.get('national'), 'first_year': False,
                              'prior_provision_close': cf.get('provision_close')}))
    return nxt

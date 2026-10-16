"""DB の値から計算エンジンの入力を組み立て、計算し、アプリ側の指摘と合わせる。"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from taxengine.cells import Finding, Override
from taxengine.engine import compute_return
from taxengine.model import (Adjustment, EntertainmentInput, EntertainmentRow, LossCarryforward, Opening,
                             OpeningRetainedItem, Period, Profile, ReturnInput, TaxInputs, TaxPayment, WithholdingItem)

from ..models import CarryforwardItem, CellOverride, FindingAck, FiscalYear, InputSection, TaxAdjustment
from .documents import checklist
from .inputs import SECTIONS, default_section
from .suggestions import journal_findings
from .trial_balance import TBAnalysis, analyze, journal_check


def load_sections(db: Session, fy_id: int) -> dict[str, dict]:
    rows = {r.section: r.data for r in db.scalars(select(InputSection).where(InputSection.fiscal_year_id == fy_id))}
    return {k: rows.get(k) or default_section(k) for k in SECTIONS}


def adopted_adjustments(db: Session, fy_id: int) -> list[TaxAdjustment]:
    return list(db.scalars(select(TaxAdjustment).where(TaxAdjustment.fiscal_year_id == fy_id,
                                                       TaxAdjustment.decision == 'adopted').order_by(TaxAdjustment.id)))


@dataclass
class Built:
    input: ReturnInput
    analysis: TBAnalysis
    sections: dict[str, dict]
    app_findings: list[Finding]


def build_input(db: Session, fy: FiscalYear) -> Built:
    company = fy.company
    analysis = analyze(db, fy.id, fy.dividends)
    sec = load_sections(db, fy.id)
    findings: list[Finding] = list(analysis.findings)
    findings += journal_check(db, fy.id, analysis)
    findings += journal_findings(db, fy, analysis)

    profile = Profile(corp_kind=company.corp_kind, ordinary=company.corp_category == 'ordinary', capital_end=fy.capital_end,
                      large_corp_subsidiary=fy.large_corp_subsidiary, tekiyo_jogai=fy.tekiyo_jogai,
                      group_tsusan=fy.group_tsusan, blue_return=fy.blue_return, return_kind=fy.return_kind,
                      unsupported_features=list(fy.unsupported_features or []))
    if fy.dividends is None:
        findings.append(Finding('FY_DIVIDENDS_UNKNOWN', 'critical', '資料不足', '当期に効力が生じた剰余金の配当の額が未入力です',
                                '別表四「1」の③配当に使います（なければ0円）。', '年度の基本情報で入力してください。',
                                [{'type': 'page', 'page': 'company'}]))

    adjustments = [Adjustment(id=str(a.id), name=a.name, line=a.line, direction=a.direction, disposition=a.disposition,
                              amount=a.amount, status=a.status, five1_key=a.five1_key, five1_name=a.five1_name,
                              five1_column=a.five1_column, basis=tuple(a.basis or []), origin='user', note=a.reason or '',
                              confirmed=a.confirmed)
                   for a in adopted_adjustments(db, fy.id)]
    pending = list(db.scalars(select(TaxAdjustment).where(TaxAdjustment.fiscal_year_id == fy.id,
                                                          TaxAdjustment.decision == 'pending')))
    for a in pending:
        findings.append(Finding('ADJ_PENDING', 'critical' if a.status in ('missing', 'unsupported') else 'warning', '税務調整',
                                f'税務調整の候補「{a.name}」が未判断です',
                                (a.reason or '') + ' 採用するか、調整不要と判断した理由を記録してください。',
                                '税務調整一覧で詳細を開き、「採用」又は「調整不要」を選んでください。',
                                [{'type': 'adjustment', 'id': str(a.id)}]))

    tp = sec['tax_payments']
    pv = sec['provision']
    lt = sec['local_taxes']
    provision_charged = pv.get('provision_charged')
    if provision_charged is None and analysis.provision_charged_hint is not None and analysis.has_bs:
        findings.append(Finding('PROVISION_HINT', 'warning', '入力', '損金経理をした納税充当金が未入力です',
                                f'試算表の未払法人税等の貸方は {analysis.provision_charged_hint:,} 円です。'
                                '当期に法人税等として費用計上した額であれば、これを入力します。',
                                '「税額の基礎」→「納税充当金」で確認して入力してください。',
                                [{'type': 'page', 'page': 'tax-inputs', 'section': 'provision'}]))
    taxes = TaxInputs(
        payments=[TaxPayment(tax=p['tax'], period=p['period'], label=p.get('label', ''), other_kind=p.get('other_kind', ''),
                             opening_unpaid=p.get('opening_unpaid'), accrued=p.get('accrued'),
                             paid_provision=p.get('paid_provision'), paid_suspense=p.get('paid_suspense'),
                             paid_expense=p.get('paid_expense'))
                  for p in tp.get('payments', [])],
        interim_corporate_tax=tp.get('interim_corporate_tax'), interim_local_corporate_tax=tp.get('interim_local_corporate_tax'),
        interim_defense_tax=tp.get('interim_defense_tax'),
        provision_charged=provision_charged, provision_other_charged=pv.get('provision_other_charged'),
        provision_suspense_cleared=pv.get('provision_suspense_cleared'),
        final_prefectural=lt.get('final_prefectural'), final_municipal=lt.get('final_municipal'),
        final_enterprise=lt.get('final_enterprise'),
    )

    wh = sec['withholding']
    withholding = [WithholdingItem(category=w['category'], payer=w['payer'], gross_income=w.get('gross_income'),
                                   tax_withheld=w.get('tax_withheld'), booking=w.get('booking', 'expense'),
                                   method=w.get('method', 'full'), calc_months=w.get('calc_months'),
                                   owned_months=w.get('owned_months'),
                                   received_on=date.fromisoformat(w['received_on']) if w.get('received_on') else None)
                   for w in wh.get('items', [])]
    if analysis.hints.get('has_interest_income') and not withholding and not wh.get('none_confirmed'):
        findings.append(Finding('WITHHOLDING_NOT_ENTERED', 'warning', '税務調整', '受取利息がありますが、源泉所得税が未入力です',
                                '預金利子などから源泉徴収された所得税（復興特別所得税を含む）は法人税額から控除できます（別表六(一)）。',
                                '「税額の基礎」→「源泉所得税」で入力するか、源泉徴収がないことを確認してください。',
                                [{'type': 'page', 'page': 'tax-inputs', 'section': 'withholding'}]))

    en = sec['entertainment']
    entertainment = None
    if en.get('rows'):
        entertainment = EntertainmentInput(rows=[EntertainmentRow(r['account'], r.get('spent'), r.get('excluded'), r.get('food'))
                                                 for r in en['rows']], reviewed_small_meals=en.get('reviewed_small_meals', False))

    cf = list(db.scalars(select(CarryforwardItem).where(CarryforwardItem.fiscal_year_id == fy.id).order_by(CarryforwardItem.id)))
    om = sec['opening_meta']
    opening = Opening(
        retained_items=[OpeningRetainedItem(c.key or f'item-{c.id}', c.name, c.amount) for c in cf if c.kind == 'retained'],
        prior_retained_total=om.get('prior_retained_total'), prior_unpaid_national=om.get('prior_unpaid_national'),
        losses=[LossCarryforward(c.loss_fy_start, c.loss_fy_end, c.amount) for c in cf
                if c.kind == 'loss' and c.loss_fy_start and c.loss_fy_end],
        losses_confirmed=bool(om.get('losses_confirmed')),
    )
    unconfirmed = [c for c in cf if not c.confirmed]
    if unconfirmed:
        findings.append(Finding('OPENING_UNCONFIRMED', 'warning', '期首情報', f'確認していない期首情報が{len(unconfirmed)}件あります',
                                '前期から引き継いだ金額（または手入力・PDF読取の金額）を、前期の申告書と照合していません。',
                                '「期首情報」で前期の別表と照合し、確認済みにしてください。', [{'type': 'page', 'page': 'opening'}]))

    overrides = {o.cell_key: Override(o.value, o.reason, str(o.created_by or ''))
                 for o in db.scalars(select(CellOverride).where(CellOverride.fiscal_year_id == fy.id, CellOverride.active))}

    inp = ReturnInput(company_name=company.name, period=Period(fy.start_date, fy.end_date), profile=profile,
                      financials=analysis.financials, adjustments=adjustments, taxes=taxes, withholding=withholding,
                      entertainment=entertainment, opening=opening, overrides=overrides, hints=analysis.hints)
    return Built(inp, analysis, sec, findings)


def compute_for(db: Session, fy: FiscalYear) -> dict[str, Any]:
    """計算して、画面に返す形にする。指摘の件数を年度に記録する。"""
    built = build_input(db, fy)
    result = compute_return(built.input)
    data = result.to_dict()
    # アプリ側の指摘を先頭に合わせる（同じ指摘は1件）
    seen = {f['fingerprint'] for f in data['findings']}
    app = [f.to_dict() for f in built.app_findings]
    merged = [f for f in app if f['fingerprint'] not in seen] + data['findings']
    sev = {'critical': 0, 'warning': 1, 'info': 2}
    merged.sort(key=lambda f: sev[f['severity']])
    acks = {a.fingerprint: a for a in db.scalars(select(FindingAck).where(FindingAck.fiscal_year_id == fy.id))}
    for f in merged:
        a = acks.get(f['fingerprint'])
        f['acknowledged'] = bool(a) and f['severity'] != 'critical'
        f['ack_note'] = a.note if a else None
    data['documents'] = checklist(db, fy, built.analysis, built.sections)
    for d in data['documents']:
        if d['status'] == 'missing':
            f = Finding('DOC_MISSING', 'warning', '資料不足', f'必要な資料「{d["label"]}」がまだありません',
                        f'用途：{d["need_reason"]}。', '「資料」でアップロードしてください（PDF・画像・CSVなど）。',
                        [{'type': 'page', 'page': 'documents', 'section': d['kind']}]).to_dict()
            a = acks.get(f['fingerprint'])
            f['acknowledged'], f['ack_note'] = bool(a), (a.note if a else None)
            merged.append(f)
    merged.sort(key=lambda f: sev[f['severity']])
    data['findings'] = merged
    data['counts'] = {s: sum(1 for f in merged if f['severity'] == s) for s in ('critical', 'warning', 'info')}
    data['counts']['warning_open'] = sum(1 for f in merged if f['severity'] == 'warning' and not f['acknowledged'])
    data['tb_totals'] = built.analysis.totals
    data['provision_charged_hint'] = built.analysis.provision_charged_hint
    fy.last_computed_at = datetime.now(timezone.utc)
    fy.critical_count = data['counts']['critical']
    fy.warning_count = data['counts']['warning_open']
    return data

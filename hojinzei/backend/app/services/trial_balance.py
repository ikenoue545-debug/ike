"""試算表の検証と、試算表から決算の数値（当期純利益・利益剰余金・未払法人税等など）を作る。"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from taxengine.cells import Finding
from taxengine.model import Financials, ReserveRow

from ..models import Account, JournalLine, TrialBalanceLine
from .accounts_master import DEBIT_NORMAL


@dataclass
class TBRow:
    account: Account
    line: TrialBalanceLine


@dataclass
class TBAnalysis:
    rows: list[TBRow]
    has_bs: bool
    has_pl: bool
    net_income: Optional[int]
    re_includes_current_profit: Optional[bool]
    financials: Financials
    provision_charged_hint: Optional[int]
    hints: dict[str, bool]
    findings: list[Finding] = field(default_factory=list)
    totals: dict[str, Optional[int]] = field(default_factory=dict)


def load_rows(db: Session, fy_id: int) -> list[TBRow]:
    q = (select(Account, TrialBalanceLine).join(TrialBalanceLine, TrialBalanceLine.account_id == Account.id)
         .where(Account.fiscal_year_id == fy_id).order_by(Account.sort_order, Account.id))
    return [TBRow(a, l) for a, l in db.execute(q).all()]


def _sum(rows, pred, attr) -> Optional[int]:
    total = 0
    for r in rows:
        if pred(r):
            v = getattr(r.line, attr)
            total += v or 0
    return total


def analyze(db: Session, fy_id: int, dividends: Optional[int] = 0) -> TBAnalysis:
    rows = load_rows(db, fy_id)
    findings: list[Finding] = []
    tgt = [{'type': 'page', 'page': 'trial-balance'}]
    sec = lambda s: (lambda r: r.account.section == s)  # noqa: E731
    cat = lambda c: (lambda r: r.account.category == c)  # noqa: E731
    has_bs = any(r.account.statement == 'BS' for r in rows)
    has_pl = any(r.account.statement == 'PL' for r in rows)

    if not rows:
        findings.append(Finding('TB_MISSING', 'critical', '資料不足', '試算表が取り込まれていません',
                                '当期純利益・利益剰余金・未払法人税等など、申告書の基礎になる数値がありません。',
                                '「資料」で試算表（貸借対照表・損益計算書）の CSV か Excel を取り込んでください。',
                                [{'type': 'page', 'page': 'documents'}]))
    else:
        if not has_bs:
            findings.append(Finding('TB_NO_BS', 'critical', '資料不足', '貸借対照表の科目がありません', '',
                                    '貸借対照表の試算表を取り込んでください。', [{'type': 'page', 'page': 'documents'}]))
        if not has_pl:
            findings.append(Finding('TB_NO_PL', 'critical', '資料不足', '損益計算書の科目がありません', '',
                                    '損益計算書の試算表を取り込んでください。', [{'type': 'page', 'page': 'documents'}]))

    unknown = [r.account for r in rows if r.account.classification == 'unknown' or r.account.section is None]
    if unknown:
        findings.append(Finding('TB_UNCLASSIFIED', 'critical', '科目分類', f'分類が決まっていない科目が{len(unknown)}件あります',
                                '、'.join(a.name for a in unknown[:10]) + ('…' if len(unknown) > 10 else '') +
                                '。資産・負債・純資産・収益・費用のどれかが決まらないと、利益や残高を計算できません。',
                                '試算表の画面で各科目の分類を選んでください。',
                                tgt + [{'type': 'account', 'id': a.id} for a in unknown[:20]]))

    # 各科目：期首＋借方−貸方＝期末（借方残の科目）、期首−借方＋貸方＝期末（貸方残の科目）
    for r in rows:
        a, l = r.account, r.line
        if a.section is None or l.closing is None or l.debit is None or l.credit is None:
            continue
        opening = l.opening or 0
        expect = opening + l.debit - l.credit if a.section in DEBIT_NORMAL else opening - l.debit + l.credit
        if expect != l.closing:
            findings.append(Finding('TB_ROW_MOVEMENT', 'critical', '試算表', f'「{a.name}」の残高が増減と合いません',
                                    f'期首 {opening:,} ＋/− 借方 {l.debit:,}・貸方 {l.credit:,} から計算すると {expect:,} 円ですが、'
                                    f'期末残高は {l.closing:,} 円です（差 {l.closing - expect:,} 円）。',
                                    '取り込んだ試算表の列（期首・借方・貸方・期末）の対応か、元の試算表を確認してください。',
                                    [{'type': 'account', 'id': a.id}]))
        if a.section in ('asset', 'liability') and l.closing < 0 and a.category not in (
                'accumulated_depreciation', 'allowance_bad_debt', 'treasury_stock'):
            findings.append(Finding('TB_NEGATIVE', 'warning', '試算表', f'「{a.name}」の残高がマイナスです',
                                    f'期末残高 {l.closing:,} 円。現金・預金のマイナスや、債権・債務の付け間違いの可能性があります。',
                                    '仕訳を確認してください。', [{'type': 'account', 'id': a.id}]))
    missing_closing = [r.account.name for r in rows if r.line.closing is None]
    if missing_closing:
        findings.append(Finding('TB_NO_CLOSING', 'critical', '試算表', f'期末残高のない科目が{len(missing_closing)}件あります',
                                '、'.join(missing_closing[:10]), '列の対応（期末残高）を確認して取り込み直してください。', tgt))

    # 合計
    def total(s):
        return _sum(rows, sec(s), 'closing')
    assets = total('asset')
    liabilities = total('liability')
    equity = total('equity')
    revenue = total('revenue')
    expense = total('expense')
    net_income = (revenue - expense) if has_pl else None

    # 貸借の一致：試算表全体で借方合計＝貸方合計
    if rows and has_bs and has_pl:
        dr = _sum(rows, lambda r: True, 'debit')
        cr = _sum(rows, lambda r: True, 'credit')
        if dr != cr:
            findings.append(Finding('TB_DEBIT_CREDIT', 'critical', '試算表', '試算表の借方合計と貸方合計が一致しません',
                                    f'借方 {dr:,} 円、貸方 {cr:,} 円（差 {dr - cr:,} 円）。',
                                    '取り込み漏れの科目がないか、BS と PL の両方を取り込んだか確認してください。', tgt))

    # 貸借対照表の一致と、繰越利益剰余金に当期純利益が含まれているか
    re_incl: Optional[bool] = None
    if has_bs and net_income is not None:
        if assets == liabilities + equity:
            re_incl = True
        elif assets == liabilities + equity + net_income:
            re_incl = False
        else:
            findings.append(Finding('TB_BS_BALANCE', 'critical', '試算表', '貸借対照表の資産と負債・純資産が一致しません',
                                    f'資産 {assets:,} 円、負債 {liabilities:,} 円、純資産 {equity:,} 円、当期純利益 {net_income:,} 円。'
                                    '資産 ＝ 負債 ＋ 純資産（当期純利益を含む）になりません。',
                                    '科目の分類（資産・負債・純資産）と取り込み漏れを確認してください。', tgt))

    def bal(c, attr):
        rs = [r for r in rows if r.account.category == c]
        if not rs:
            return None
        return sum((getattr(r.line, attr) or 0) for r in rs)

    re_open = bal('retained_earnings', 'opening')
    re_close = bal('retained_earnings', 'closing')
    if re_close is not None and re_incl is False and net_income is not None:
        re_close = re_close + net_income
    if has_bs and re_open is None:
        re_open, re_close = 0, (net_income if re_incl is False else 0)
        findings.append(Finding('TB_NO_RE', 'warning', '試算表', '繰越利益剰余金の科目がありません',
                                '設立初年度でなければ、繰越利益剰余金が取り込まれていない可能性があります。',
                                '貸借対照表の純資産の部を確認してください。', tgt))

    reserves = [ReserveRow(r.account.name, r.line.opening or 0, r.line.closing or 0)
                for r in rows if r.account.category == 'voluntary_reserve']
    capital_rows = [ReserveRow({'capital': '資本金又は出資金', 'capital_reserve': '資本準備金'}.get(r.account.category, r.account.name),
                               r.line.opening or 0, r.line.closing or 0)
                    for r in rows if r.account.category in ('capital', 'capital_reserve', 'other_capital_surplus')]
    tp_open = bal('income_taxes_payable', 'opening') if has_bs else None
    tp_close = bal('income_taxes_payable', 'closing') if has_bs else None
    if has_bs and tp_open is None:
        tp_open, tp_close = 0, 0
    provision_hint = bal('income_taxes_payable', 'credit')

    fin = Financials(
        net_income=net_income, dividends=dividends,
        retained_earnings_open=re_open if has_bs else None, retained_earnings_close=re_close if has_bs else None,
        legal_reserve_open=bal('legal_reserve', 'opening') or 0, legal_reserve_close=bal('legal_reserve', 'closing') or 0,
        reserves=reserves, tax_provision_open=tp_open, tax_provision_close=tp_close, capital_rows=capital_rows,
    )
    nz = lambda c: any(r.account.category == c and (r.line.closing or 0) != 0 for r in rows)  # noqa: E731
    hints = {
        'has_depreciation': nz('depreciation'),
        'has_donations': nz('donations'),
        'has_dividend_income': nz('dividend_income'),
        'has_entertainment_account': nz('entertainment'),
        'has_interest_income': nz('interest_income'),
        'has_officer_compensation': nz('officer_compensation'),
        'has_officer_bonus': nz('officer_bonus'),
        'has_corporate_taxes': nz('corporate_taxes'),
        'has_penalties': nz('penalties'),
        'has_suspense_tax': nz('suspense_tax'),
    }
    if has_pl and not hints['has_corporate_taxes']:
        findings.append(Finding('TB_NO_TAX_EXPENSE', 'info', '試算表', '「法人税、住民税及び事業税」の計上がありません',
                                '決算で当期の法人税等（均等割を含む）を未払計上していない可能性があります。',
                                '申告書の計算後に表示される「計上すべき未払法人税等」を参考に、決算整理仕訳を確認してください。', tgt))
    return TBAnalysis(rows=rows, has_bs=has_bs, has_pl=has_pl, net_income=net_income, re_includes_current_profit=re_incl,
                      financials=fin, provision_charged_hint=provision_hint, hints=hints, findings=findings,
                      totals={'assets': assets, 'liabilities': liabilities, 'equity': equity, 'revenue': revenue,
                              'expense': expense, 'net_income': net_income})


def journal_check(db: Session, fy_id: int, analysis: TBAnalysis) -> list[Finding]:
    """仕訳帳の科目別合計と試算表の借方・貸方を照合する。"""
    q = (select(JournalLine.account_name, JournalLine.side, func.sum(JournalLine.amount))
         .where(JournalLine.fiscal_year_id == fy_id).group_by(JournalLine.account_name, JournalLine.side))
    sums: dict[str, dict[str, int]] = {}
    for name, side, total in db.execute(q).all():
        sums.setdefault(name, {})[side] = int(total or 0)
    if not sums:
        return []
    out = []
    tb_names = {r.account.name for r in analysis.rows}
    for r in analysis.rows:
        j = sums.get(r.account.name, {})
        for side, attr, label in (('debit', 'debit', '借方'), ('credit', 'credit', '貸方')):
            tb = getattr(r.line, attr) or 0
            jv = j.get(side, 0)
            if tb != jv:
                out.append(Finding('TB_JOURNAL_MISMATCH', 'warning', '試算表', f'「{r.account.name}」の{label}が仕訳帳と一致しません',
                                   f'試算表 {tb:,} 円、仕訳帳の合計 {jv:,} 円（差 {tb - jv:,} 円）。',
                                   '出力した期間・時点が同じか（決算整理仕訳を含むか）確認してください。',
                                   [{'type': 'account', 'id': r.account.id}]))
    extra = sorted(set(sums) - tb_names)
    if extra:
        out.append(Finding('TB_JOURNAL_EXTRA', 'warning', '試算表', f'仕訳帳にあって試算表にない科目が{len(extra)}件あります',
                           '、'.join(extra[:10]), '試算表の取り込み漏れを確認してください。', [{'type': 'page', 'page': 'trial-balance'}]))
    return out[:50]

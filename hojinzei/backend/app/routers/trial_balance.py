"""試算表の表示・科目分類の修正・仕訳の確認。"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import audit
from ..models import Account, JournalLine, TrialBalanceLine, User
from ..security import current_user, get_db, get_fy_for
from ..services.accounts_master import CATEGORIES, SECTIONS, STATEMENT_OF
from ..services.suggestions import TAX_FLAGS
from ..services.trial_balance import analyze, journal_check
from .common import iso

router = APIRouter()


@router.get('/fiscal-years/{fid}/trial-balance')
def get_tb(fid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    an = analyze(db, fy.id, fy.dividends)
    findings = [f.to_dict() for f in an.findings + journal_check(db, fy.id, an)]
    flagged = {}
    for f in findings:
        for t in f['targets']:
            if t.get('type') == 'account':
                flagged.setdefault(t['id'], []).append({'severity': f['severity'], 'title': f['title']})
    has_journal = db.scalar(select(JournalLine.id).where(JournalLine.fiscal_year_id == fy.id).limit(1)) is not None
    rows = []
    for r in an.rows:
        a, l = r.account, r.line
        rows.append({
            'account_id': a.id, 'code': a.code, 'name': a.name, 'statement': a.statement, 'section': a.section,
            'section_label': SECTIONS.get(a.section or '', '未分類'), 'category': a.category,
            'category_label': CATEGORIES.get(a.category or '', ('', ''))[1] if a.category else None,
            'classification': a.classification, 'heading': a.heading,
            'opening': l.opening, 'debit': l.debit, 'credit': l.credit, 'closing': l.closing,
            'tax_flag': TAX_FLAGS.get(a.category or ''), 'issues': flagged.get(a.id, []),
        })
    return {'fiscal_year_id': fy.id, 'rows': rows, 'totals': an.totals, 'has_bs': an.has_bs, 'has_pl': an.has_pl,
            're_includes_current_profit': an.re_includes_current_profit, 'findings': findings, 'has_journal': has_journal,
            'financials': {'net_income': an.financials.net_income,
                           'retained_earnings_open': an.financials.retained_earnings_open,
                           'retained_earnings_close': an.financials.retained_earnings_close,
                           'tax_provision_open': an.financials.tax_provision_open,
                           'tax_provision_close': an.financials.tax_provision_close,
                           'provision_charged_hint': an.provision_charged_hint},
            'hints': an.hints}


class AccountPatch(BaseModel):
    section: Optional[str] = None
    category: Optional[str] = None


@router.patch('/accounts/{aid}')
def update_account(aid: int, body: AccountPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = db.get(Account, aid)
    if a is None:
        raise HTTPException(404, '科目が見つかりません')
    fy = get_fy_for(db, user, a.fiscal_year_id)
    if fy.status in ('approved', 'filed'):
        raise HTTPException(409, '承認済の年度は変更できません')
    if body.category:
        if body.category not in CATEGORIES:
            raise HTTPException(422, '分類が不正です')
        a.category = body.category
        a.section = CATEGORIES[body.category][0]
    elif body.section:
        if body.section not in SECTIONS:
            raise HTTPException(422, '区分が不正です')
        a.section = body.section
        a.category = None if a.category and CATEGORIES[a.category][0] != body.section else a.category
    a.statement = STATEMENT_OF.get(a.section or '')
    a.classification = 'confirmed' if a.section else 'unknown'
    audit.log(db, user, 'account_classify', 'account', a.id, fiscal_year_id=fy.id, section=a.section, category=a.category)
    db.commit()
    return {'id': a.id, 'section': a.section, 'category': a.category, 'statement': a.statement,
            'classification': a.classification}


@router.get('/accounts/{aid}/journal')
def account_journal(aid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = db.get(Account, aid)
    if a is None:
        raise HTTPException(404, '科目が見つかりません')
    get_fy_for(db, user, a.fiscal_year_id)
    q = (select(JournalLine).where(JournalLine.fiscal_year_id == a.fiscal_year_id, JournalLine.account_name == a.name)
         .order_by(JournalLine.entry_date, JournalLine.id).limit(2000))
    lines = list(db.scalars(q))
    return {'account': {'id': a.id, 'name': a.name}, 'count': len(lines), 'lines': [
        {'id': j.id, 'date': iso(j.entry_date), 'entry_no': j.entry_no, 'side': j.side, 'amount': j.amount,
         'counter_account': j.counter_account, 'partner': j.partner, 'item': j.item, 'department': j.department,
         'tax_category': j.tax_category, 'memo': j.memo} for j in lines]}


@router.get('/journal-lines/{jid}')
def journal_line(jid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    j = db.get(JournalLine, jid)
    if j is None:
        raise HTTPException(404, '仕訳が見つかりません')
    get_fy_for(db, user, j.fiscal_year_id)
    acc = db.scalar(select(Account).where(Account.fiscal_year_id == j.fiscal_year_id, Account.name == j.account_name))
    return {'id': j.id, 'date': iso(j.entry_date), 'entry_no': j.entry_no, 'side': j.side, 'account_name': j.account_name,
            'account_id': acc.id if acc else None, 'amount': j.amount, 'counter_account': j.counter_account, 'memo': j.memo,
            'partner': j.partner}

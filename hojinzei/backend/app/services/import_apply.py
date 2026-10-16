"""取込の反映：読み取った試算表・仕訳帳を DB に入れる。"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models import Account, FiscalYear, JournalLine, TrialBalanceLine
from .accounts_master import classify, normalize


def apply_trial_balance(db: Session, fy: FiscalYear, batch_id: Optional[int], parsed: dict) -> int:
    """試算表を取り込む。同じ科目の行は置き換える（BS だけ・PL だけの取込も可能）。"""
    existing = {normalize(a.name): a for a in db.scalars(select(Account).where(Account.fiscal_year_id == fy.id))}
    order = max([a.sort_order for a in existing.values()], default=0)
    # 同じ帳票（BS／PL）を取り込み直したときは、新しいファイルにない科目の行を消す
    new_names = {normalize(a['name']) for a in parsed['accounts']}
    stmts = {(existing.get(normalize(a['name'])) and existing[normalize(a['name'])].statement)
             or classify(a['name'], a['heading'])['statement'] for a in parsed['accounts']} - {None}
    for key, acc in existing.items():
        if acc.statement in stmts and key not in new_names:
            db.execute(delete(TrialBalanceLine).where(TrialBalanceLine.account_id == acc.id))
    for a in parsed['accounts']:
        acc = existing.get(normalize(a['name']))
        if acc is None:
            cls = classify(a['name'], a['heading'])
            order += 1
            acc = Account(fiscal_year_id=fy.id, name=a['name'], code=a['code'], heading=a['heading'], sort_order=order,
                          statement=cls['statement'], section=cls['section'], category=cls['category'],
                          classification=cls['classification'])
            db.add(acc)
            db.flush()
            existing[normalize(a['name'])] = acc
        line = db.scalar(select(TrialBalanceLine).where(TrialBalanceLine.fiscal_year_id == fy.id,
                                                        TrialBalanceLine.account_id == acc.id))
        if line is None:
            line = TrialBalanceLine(fiscal_year_id=fy.id, account_id=acc.id)
            db.add(line)
        line.opening = a['opening'] if a['opening'] is not None else 0
        line.debit = a['debit'] if a['debit'] is not None else 0
        line.credit = a['credit'] if a['credit'] is not None else 0
        line.closing = a['closing']
        line.import_batch_id = batch_id
    db.flush()
    # 期末資本金が未入力なら、試算表の資本金を候補として入れる（年度の基本情報で確認する）
    if fy.capital_end is None:
        cap = db.execute(select(TrialBalanceLine.closing).join(Account, Account.id == TrialBalanceLine.account_id)
                         .where(Account.fiscal_year_id == fy.id, Account.category == 'capital')).scalars().all()
        if cap:
            fy.capital_end = sum(v or 0 for v in cap)
    return len(parsed['accounts'])


def apply_journal(db: Session, fy: FiscalYear, batch_id: Optional[int], parsed: dict) -> int:
    db.execute(delete(JournalLine).where(JournalLine.fiscal_year_id == fy.id))
    for l in parsed['lines']:
        db.add(JournalLine(fiscal_year_id=fy.id, import_batch_id=batch_id, entry_date=l['entry_date'], entry_no=l['entry_no'],
                           side=l['side'], account_name=l['account_name'], counter_account=l['counter_account'],
                           amount=l['amount'], tax_category=l['tax_category'], partner=l['partner'], item=l['item'],
                           department=l['department'], memo=l['memo']))
    return len(parsed['lines'])

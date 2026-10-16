"""税額の基礎（別表五(二)の納付・納税充当金・地方税・源泉所得税・交際費）と期首情報。"""
from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..models import CarryforwardItem, FiscalYear, InputSection, InputSectionHistory, User
from ..security import current_user, get_db, get_fy_for
from ..services.inputs import SECTIONS, validate_section
from ..services.return_builder import load_sections
from ..services.trial_balance import analyze
from .common import iso, user_dict

router = APIRouter()


def _editable(fy: FiscalYear) -> None:
    if fy.status in ('approved', 'filed'):
        raise HTTPException(409, '承認済の年度は変更できません（承認を取り消してから変更してください）')


@router.get('/fiscal-years/{fid}/inputs')
def get_inputs(fid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    sec = load_sections(db, fy.id)
    an = analyze(db, fy.id, fy.dividends)
    ent_accounts = [{'name': r.account.name, 'closing': r.line.closing} for r in an.rows
                    if r.account.category in ('entertainment',)]
    meeting_accounts = [{'name': r.account.name, 'closing': r.line.closing} for r in an.rows if r.account.category == 'meeting']
    interest = [{'name': r.account.name, 'closing': r.line.closing, 'category': r.account.category} for r in an.rows
                if r.account.category in ('interest_income', 'dividend_income')]
    return {'sections': sec, 'hints': {
        'provision_charged_hint': an.provision_charged_hint,
        'tax_provision_open': an.financials.tax_provision_open,
        'tax_provision_close': an.financials.tax_provision_close,
        'entertainment_accounts': ent_accounts, 'meeting_accounts': meeting_accounts, 'income_accounts': interest,
        'has_corporate_taxes': an.hints.get('has_corporate_taxes'),
    }}


@router.put('/fiscal-years/{fid}/inputs/{section}')
def put_input(fid: int, section: str, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    _editable(fy)
    if section not in SECTIONS:
        raise HTTPException(404, '入力の区分が見つかりません')
    try:
        data = validate_section(section, body)
    except ValidationError as e:
        raise HTTPException(422, [{'loc': x['loc'], 'msg': x['msg']} for x in e.errors()]) from e
    row = db.scalar(select(InputSection).where(InputSection.fiscal_year_id == fy.id, InputSection.section == section))
    if row is None:
        row = InputSection(fiscal_year_id=fy.id, section=section, data=data, updated_by=user.id)
        db.add(row)
        db.flush()
    else:
        row.data = data
        row.updated_by = user.id
    db.add(InputSectionHistory(input_section_id=row.id, data=data, updated_by=user.id))
    audit.log(db, user, 'input_update', 'input_section', row.id, company_id=fy.company_id, fiscal_year_id=fy.id,
              section=section)
    db.commit()
    return {'section': section, 'data': data}


@router.get('/fiscal-years/{fid}/inputs/{section}/history')
def input_history(fid: int, section: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    row = db.scalar(select(InputSection).where(InputSection.fiscal_year_id == fy.id, InputSection.section == section))
    if row is None:
        return []
    hist = db.scalars(select(InputSectionHistory).where(InputSectionHistory.input_section_id == row.id)
                      .order_by(InputSectionHistory.updated_at.desc()))
    return [{'data': h.data, 'by': user_dict(db.get(User, h.updated_by)), 'at': iso(h.updated_at)} for h in hist]


# ---------------------------------------------------------------- 期首情報
class CarryIn(BaseModel):
    kind: Literal['retained', 'loss']
    key: Optional[str] = None
    name: str = Field(min_length=1, max_length=200)
    amount: Optional[int] = None
    loss_fy_start: Optional[date] = None
    loss_fy_end: Optional[date] = None
    source: Literal['manual', 'pdf', 'carryover'] = 'manual'
    confirmed: bool = False


def _carry_dict(c: CarryforwardItem) -> dict:
    return {'id': c.id, 'kind': c.kind, 'key': c.key, 'name': c.name, 'amount': c.amount,
            'loss_fy_start': iso(c.loss_fy_start), 'loss_fy_end': iso(c.loss_fy_end), 'source': c.source,
            'confirmed': c.confirmed, 'confirmed_by': c.confirmed_by, 'updated_at': iso(c.updated_at)}


@router.get('/fiscal-years/{fid}/carryforward')
def list_carry(fid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    rows = db.scalars(select(CarryforwardItem).where(CarryforwardItem.fiscal_year_id == fy.id).order_by(CarryforwardItem.id))
    return [_carry_dict(c) for c in rows]


def _check_carry(body: CarryIn) -> None:
    if body.kind == 'loss':
        if not body.loss_fy_start or not body.loss_fy_end:
            raise HTTPException(422, '欠損金が生じた事業年度（開始日・終了日）を入力してください')
        if body.amount is not None and body.amount < 0:
            raise HTTPException(422, '欠損金額は0以上です')


@router.post('/fiscal-years/{fid}/carryforward')
def add_carry(fid: int, body: CarryIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    _editable(fy)
    _check_carry(body)
    data = body.model_dump()
    if body.kind == 'retained' and not data.get('key'):
        data['key'] = f'custom:{body.name}'
    c = CarryforwardItem(fiscal_year_id=fy.id, **data, confirmed_by=user.id if body.confirmed else None)
    db.add(c)
    db.flush()
    audit.log(db, user, 'carry_create', 'carryforward_item', c.id, fiscal_year_id=fy.id, kind=body.kind)
    db.commit()
    return _carry_dict(c)


@router.put('/carryforward/{cid}')
def update_carry(cid: int, body: CarryIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(CarryforwardItem, cid)
    if c is None:
        raise HTTPException(404, '期首情報が見つかりません')
    fy = get_fy_for(db, user, c.fiscal_year_id)
    _editable(fy)
    _check_carry(body)
    for k, v in body.model_dump().items():
        if k == 'key' and not v:
            continue
        setattr(c, k, v)
    c.confirmed_by = user.id if body.confirmed else None
    audit.log(db, user, 'carry_update', 'carryforward_item', c.id, fiscal_year_id=fy.id)
    db.commit()
    return _carry_dict(c)


@router.delete('/carryforward/{cid}')
def delete_carry(cid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(CarryforwardItem, cid)
    if c is None:
        raise HTTPException(404, '期首情報が見つかりません')
    fy = get_fy_for(db, user, c.fiscal_year_id)
    _editable(fy)
    db.delete(c)
    audit.log(db, user, 'carry_delete', 'carryforward_item', cid, fiscal_year_id=fy.id)
    db.commit()
    return {'ok': True}

"""税務調整：一覧・追加・修正・採用／不要の判断・確認済み、候補の抽出。"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from taxengine.model import ADJ_STATUSES, B4_ENGINE_LINES, B4_LINES, DISPOSITIONS

from .. import audit
from ..models import FiscalYear, TaxAdjustment, User
from ..security import current_user, get_db, get_fy_for
from ..services.suggestions import sync_candidates
from ..services.trial_balance import analyze
from ..services.workflow import advance_on
from .common import adjustment_dict

router = APIRouter()


def _editable(fy: FiscalYear) -> None:
    if fy.status in ('approved', 'filed'):
        raise HTTPException(409, '承認済の年度は変更できません（承認を取り消してから変更してください）')


class AdjustmentIn(BaseModel):
    kind: str = 'manual'
    name: str = Field(min_length=1, max_length=200)
    line: str
    direction: Literal['add', 'deduct']
    disposition: Literal['ryuho', 'sonota', 'haitou', 'kome']
    amount: Optional[int] = Field(default=None, ge=0)
    target_amount: Optional[int] = None
    status: Literal['auto', 'review', 'missing', 'unsupported'] = 'review'
    five1_key: Optional[str] = None
    five1_name: Optional[str] = None
    five1_column: Literal['increase', 'decrease'] = 'increase'
    account_names: list[str] = Field(default_factory=list)
    reason: Optional[str] = None
    basis: list[str] = Field(default_factory=list)
    evidence: list[dict] = Field(default_factory=list)
    questions: list[str] = Field(default_factory=list)


class AdjustmentPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    line: Optional[str] = None
    direction: Optional[Literal['add', 'deduct']] = None
    disposition: Optional[Literal['ryuho', 'sonota', 'haitou', 'kome']] = None
    amount: Optional[int] = Field(default=None, ge=0)
    clear_amount: bool = False
    status: Optional[Literal['auto', 'review', 'missing', 'unsupported']] = None
    five1_key: Optional[str] = None
    five1_name: Optional[str] = None
    five1_column: Optional[Literal['increase', 'decrease']] = None
    reason: Optional[str] = None
    basis: Optional[list[str]] = None
    questions: Optional[list[str]] = None


def _validate(line: str, direction: str, disposition: str, five1_key: Optional[str]) -> None:
    if line in B4_ENGINE_LINES:
        raise HTTPException(422, f'別表四「{line}」は別表五(二)・六(一)・十五の入力から自動で作ります。'
                                 '「税額の基礎」で入力してください')
    spec = B4_LINES.get(line)
    if spec is None:
        raise HTTPException(422, f'別表四の行「{line}」は選べません')
    if spec['direction'] != direction:
        raise HTTPException(422, f'別表四「{line}」は{"加算" if spec["direction"] == "add" else "減算"}の行です')
    if disposition not in spec['dispositions']:
        raise HTTPException(422, f'別表四「{line}」の処分は {"・".join(DISPOSITIONS[d] for d in spec["dispositions"])} です')


@router.get('/fiscal-years/{fid}/adjustments')
def list_adjustments(fid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    rows = db.scalars(select(TaxAdjustment).where(TaxAdjustment.fiscal_year_id == fy.id).order_by(TaxAdjustment.id))
    return {'adjustments': [adjustment_dict(a) for a in rows], 'statuses': ADJ_STATUSES}


@router.post('/fiscal-years/{fid}/adjustments')
def create_adjustment(fid: int, body: AdjustmentIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    _editable(fy)
    _validate(body.line, body.direction, body.disposition, body.five1_key)
    a = TaxAdjustment(fiscal_year_id=fy.id, **body.model_dump(), decision='adopted', origin='user', created_by=user.id,
                      updated_by=user.id)
    if a.disposition == 'ryuho' and not a.five1_key:
        a.five1_key = f'custom:{a.name}'
        a.five1_name = a.five1_name or a.name
    db.add(a)
    fy.status = advance_on(fy.status, 'adjustment')
    db.flush()
    audit.log(db, user, 'adjustment_create', 'tax_adjustment', a.id, company_id=fy.company_id, fiscal_year_id=fy.id,
              line=a.line)
    db.commit()
    return adjustment_dict(a)


def _get(db: Session, user: User, aid: int) -> tuple[TaxAdjustment, FiscalYear]:
    a = db.get(TaxAdjustment, aid)
    if a is None:
        raise HTTPException(404, '税務調整が見つかりません')
    return a, get_fy_for(db, user, a.fiscal_year_id)


@router.patch('/adjustments/{aid}')
def update_adjustment(aid: int, body: AdjustmentPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, fy = _get(db, user, aid)
    _editable(fy)
    data = body.model_dump(exclude_unset=True)
    clear = data.pop('clear_amount', False)
    for k, v in data.items():
        setattr(a, k, v)
    if clear:
        a.amount = None
    _validate(a.line, a.direction, a.disposition, a.five1_key)
    if a.disposition == 'ryuho' and not a.five1_key:
        a.five1_key = f'custom:{a.name}'
        a.five1_name = a.five1_name or a.name
    # 内容が変わったら確認をやり直す
    a.confirmed, a.confirmed_by, a.confirmed_at = False, None, None
    a.updated_by = user.id
    audit.log(db, user, 'adjustment_update', 'tax_adjustment', a.id, fiscal_year_id=fy.id, fields=sorted(data))
    db.commit()
    return adjustment_dict(a)


class DecisionIn(BaseModel):
    decision: Literal['adopted', 'dismissed', 'pending']
    dismiss_reason: Optional[str] = None


@router.post('/adjustments/{aid}/decision')
def decide(aid: int, body: DecisionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, fy = _get(db, user, aid)
    _editable(fy)
    if body.decision == 'dismissed' and not (body.dismiss_reason or '').strip():
        raise HTTPException(422, '調整不要と判断した理由を書いてください')
    if body.decision == 'adopted':
        _validate(a.line, a.direction, a.disposition, a.five1_key)
    a.decision = body.decision
    a.dismiss_reason = body.dismiss_reason if body.decision == 'dismissed' else None
    a.confirmed = body.decision == 'dismissed'
    a.confirmed_by = user.id if a.confirmed else None
    a.confirmed_at = datetime.now(timezone.utc) if a.confirmed else None
    a.updated_by = user.id
    fy.status = advance_on(fy.status, 'adjustment')
    audit.log(db, user, 'adjustment_decision', 'tax_adjustment', a.id, fiscal_year_id=fy.id, decision=body.decision)
    db.commit()
    return adjustment_dict(a)


class ConfirmIn(BaseModel):
    confirmed: bool


@router.post('/adjustments/{aid}/confirm')
def confirm(aid: int, body: ConfirmIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, fy = _get(db, user, aid)
    _editable(fy)
    if body.confirmed and a.amount is None and a.decision == 'adopted':
        raise HTTPException(422, '金額が未確定のままでは確認済みにできません')
    a.confirmed = body.confirmed
    a.confirmed_by = user.id if body.confirmed else None
    a.confirmed_at = datetime.now(timezone.utc) if body.confirmed else None
    audit.log(db, user, 'adjustment_confirm', 'tax_adjustment', a.id, fiscal_year_id=fy.id, confirmed=body.confirmed)
    db.commit()
    return adjustment_dict(a)


@router.delete('/adjustments/{aid}')
def delete_adjustment(aid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, fy = _get(db, user, aid)
    _editable(fy)
    if a.origin == 'suggestion':
        raise HTTPException(409, '候補は削除せず「調整不要」と理由を記録してください')
    db.delete(a)
    audit.log(db, user, 'adjustment_delete', 'tax_adjustment', aid, fiscal_year_id=fy.id)
    db.commit()
    return {'ok': True}


@router.post('/fiscal-years/{fid}/suggestions/refresh')
def refresh_suggestions(fid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    _editable(fy)
    n = sync_candidates(db, fy, analyze(db, fy.id, fy.dividends), user.id)
    audit.log(db, user, 'suggestions_refresh', 'fiscal_year', fy.id, fiscal_year_id=fy.id, added=n)
    db.commit()
    return {'added': n}

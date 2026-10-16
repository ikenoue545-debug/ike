"""申告書の計算・プレビュー・上書き・指摘の確認・承認・出力・翌期への引継ぎ。"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..models import CellOverride, FindingAck, FiscalYear, ReturnSnapshot, StatusHistory, User
from ..security import current_user, get_db, get_fy_for, require_role
from ..services.carryover import create_next_year
from ..services.exporter import to_csv, to_xlsx
from ..services.return_builder import compute_for
from .common import fy_dict, iso, user_dict

router = APIRouter()


def _editable(fy: FiscalYear) -> None:
    if fy.status in ('approved', 'filed'):
        raise HTTPException(409, '承認済の年度は変更できません（承認を取り消してから変更してください）')


@router.get('/fiscal-years/{fid}/return')
def get_return(fid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    data = compute_for(db, fy)
    db.commit()
    approved = db.scalar(select(ReturnSnapshot).where(ReturnSnapshot.fiscal_year_id == fy.id, ReturnSnapshot.kind == 'approved')
                         .order_by(ReturnSnapshot.created_at.desc()))
    data['fiscal_year'] = fy_dict(fy)
    data['approved_snapshot'] = ({'id': approved.id, 'input_hash': approved.input_hash, 'created_at': iso(approved.created_at),
                                  'matches_current': approved.input_hash == data['input_hash']} if approved else None)
    return data


class OverrideIn(BaseModel):
    cell_key: str = Field(min_length=3, max_length=80)
    value: Optional[int] = None
    reason: str = Field(min_length=2)


@router.get('/fiscal-years/{fid}/overrides')
def list_overrides(fid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    rows = db.scalars(select(CellOverride).where(CellOverride.fiscal_year_id == fy.id).order_by(CellOverride.created_at.desc()))
    return [{'id': o.id, 'cell_key': o.cell_key, 'value': o.value, 'reason': o.reason, 'active': o.active,
             'created_by': user_dict(db.get(User, o.created_by)), 'created_at': iso(o.created_at),
             'revoked_at': iso(o.revoked_at)} for o in rows]


@router.post('/fiscal-years/{fid}/overrides')
def add_override(fid: int, body: OverrideIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    _editable(fy)
    now = datetime.now(timezone.utc)
    for o in db.scalars(select(CellOverride).where(CellOverride.fiscal_year_id == fy.id, CellOverride.cell_key == body.cell_key,
                                                   CellOverride.active)):
        o.active, o.revoked_by, o.revoked_at = False, user.id, now
    o = CellOverride(fiscal_year_id=fy.id, cell_key=body.cell_key, value=body.value, reason=body.reason, created_by=user.id)
    db.add(o)
    db.flush()
    audit.log(db, user, 'override_create', 'cell_override', o.id, fiscal_year_id=fy.id, cell=body.cell_key)
    db.commit()
    return {'id': o.id}


@router.delete('/overrides/{oid}')
def revoke_override(oid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    o = db.get(CellOverride, oid)
    if o is None:
        raise HTTPException(404, '上書きが見つかりません')
    fy = get_fy_for(db, user, o.fiscal_year_id)
    _editable(fy)
    o.active, o.revoked_by, o.revoked_at = False, user.id, datetime.now(timezone.utc)
    audit.log(db, user, 'override_revoke', 'cell_override', o.id, fiscal_year_id=fy.id)
    db.commit()
    return {'ok': True}


class AckIn(BaseModel):
    fingerprint: str
    code: str
    note: Optional[str] = None


@router.post('/fiscal-years/{fid}/acks')
def ack_finding(fid: int, body: AckIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    data = compute_for(db, fy)
    f = next((x for x in data['findings'] if x['fingerprint'] == body.fingerprint), None)
    if f is None:
        raise HTTPException(404, 'その指摘は現在の計算結果にありません')
    if f['severity'] == 'critical':
        raise HTTPException(409, '重大エラーは確認済みにできません。原因を直してください')
    if not db.scalar(select(FindingAck).where(FindingAck.fiscal_year_id == fy.id, FindingAck.fingerprint == body.fingerprint)):
        db.add(FindingAck(fiscal_year_id=fy.id, fingerprint=body.fingerprint, code=body.code, note=body.note, created_by=user.id))
    audit.log(db, user, 'finding_ack', 'fiscal_year', fy.id, fiscal_year_id=fy.id, code=body.code)
    db.commit()
    return {'ok': True}


@router.delete('/fiscal-years/{fid}/acks/{fingerprint}')
def unack_finding(fid: int, fingerprint: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    for a in db.scalars(select(FindingAck).where(FindingAck.fiscal_year_id == fy.id, FindingAck.fingerprint == fingerprint)):
        db.delete(a)
    db.commit()
    return {'ok': True}


def _snapshot(db: Session, fy: FiscalYear, data: dict, kind: str, user: User) -> ReturnSnapshot:
    snap = ReturnSnapshot(fiscal_year_id=fy.id, kind=kind, engine_version=data['engine_version'], input_hash=data['input_hash'],
                          rules_used=[{'rule_id': r['rule_id'], 'version': r['version']} for r in data['rules_used']],
                          result=data, critical_count=data['counts']['critical'], warning_count=data['counts']['warning'],
                          created_by=user.id)
    db.add(snap)
    db.flush()
    return snap


@router.post('/fiscal-years/{fid}/snapshots')
def save_snapshot(fid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    data = compute_for(db, fy)
    snap = _snapshot(db, fy, data, 'draft', user)
    audit.log(db, user, 'snapshot_save', 'return_snapshot', snap.id, fiscal_year_id=fy.id)
    db.commit()
    return {'id': snap.id, 'created_at': iso(snap.created_at)}


@router.get('/fiscal-years/{fid}/snapshots')
def list_snapshots(fid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    rows = db.scalars(select(ReturnSnapshot).where(ReturnSnapshot.fiscal_year_id == fy.id)
                      .order_by(ReturnSnapshot.created_at.desc()))
    return [{'id': s.id, 'kind': s.kind, 'engine_version': s.engine_version, 'input_hash': s.input_hash,
             'rules_used': s.rules_used, 'critical_count': s.critical_count, 'warning_count': s.warning_count,
             'created_by': user_dict(db.get(User, s.created_by)), 'created_at': iso(s.created_at),
             'summary': s.result.get('summary')} for s in rows]


class ApproveIn(BaseModel):
    note: Optional[str] = None


@router.post('/fiscal-years/{fid}/approve')
def approve(fid: int, body: ApproveIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """承認：レビュー担当者・管理者だけ。重大エラーが1件でもあれば承認できない。"""
    require_role(user, 'admin', 'reviewer')
    fy = get_fy_for(db, user, fid)
    if fy.status in ('approved', 'filed'):
        raise HTTPException(409, 'すでに承認済です')
    data = compute_for(db, fy)
    if data['counts']['critical']:
        db.commit()
        raise HTTPException(409, {'message': f'重大エラーが{data["counts"]["critical"]}件あるため承認できません',
                                  'critical': [f['title'] for f in data['findings'] if f['severity'] == 'critical']})
    snap = _snapshot(db, fy, data, 'approved', user)
    db.add(StatusHistory(fiscal_year_id=fy.id, from_status=fy.status, to_status='approved', note=body.note, changed_by=user.id))
    fy.status, fy.approved_by, fy.approved_at = 'approved', user.id, datetime.now(timezone.utc)
    audit.log(db, user, 'approve', 'fiscal_year', fy.id, company_id=fy.company_id, fiscal_year_id=fy.id, snapshot=snap.id)
    db.commit()
    return {'ok': True, 'snapshot_id': snap.id}


@router.post('/fiscal-years/{fid}/unapprove')
def unapprove(fid: int, body: ApproveIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_role(user, 'admin', 'reviewer')
    fy = get_fy_for(db, user, fid)
    if fy.status not in ('approved', 'filed'):
        raise HTTPException(409, '承認済ではありません')
    if not (body.note or '').strip():
        raise HTTPException(422, '取り消す理由を書いてください')
    db.add(StatusHistory(fiscal_year_id=fy.id, from_status=fy.status, to_status='in_review', note=body.note, changed_by=user.id))
    fy.status, fy.approved_by, fy.approved_at = 'in_review', None, None
    audit.log(db, user, 'unapprove', 'fiscal_year', fy.id, company_id=fy.company_id, fiscal_year_id=fy.id)
    db.commit()
    return {'ok': True}


@router.post('/fiscal-years/{fid}/next-year')
def next_year(fid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    if fy.status not in ('approved', 'filed'):
        raise HTTPException(409, '翌期への引継ぎは、承認済の年度から行います')
    snap = db.scalar(select(ReturnSnapshot).where(ReturnSnapshot.fiscal_year_id == fy.id, ReturnSnapshot.kind == 'approved')
                     .order_by(ReturnSnapshot.created_at.desc()))
    if snap is None:
        raise HTTPException(409, '承認時の計算結果がありません')
    try:
        nxt = create_next_year(db, fy, snap, user.id)
    except ValueError as e:
        raise HTTPException(409, str(e)) from e
    audit.log(db, user, 'next_year', 'fiscal_year', nxt.id, company_id=fy.company_id, fiscal_year_id=nxt.id, source=fy.id)
    db.commit()
    return fy_dict(nxt)


def _period(fy: FiscalYear) -> str:
    return f'{fy.start_date.isoformat()}〜{fy.end_date.isoformat()}'


@router.get('/fiscal-years/{fid}/export.xlsx')
def export_xlsx(fid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    data = compute_for(db, fy)
    body = to_xlsx(fy.company.name, _period(fy), data)
    audit.log(db, user, 'export_xlsx', 'fiscal_year', fy.id, fiscal_year_id=fy.id)
    db.commit()
    fname = f'houjinzei-draft-{fy.id}-{fy.end_date.isoformat()}.xlsx'
    return Response(body, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    headers={'Content-Disposition': f'attachment; filename="{fname}"'})


@router.get('/fiscal-years/{fid}/export.csv')
def export_csv(fid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    data = compute_for(db, fy)
    audit.log(db, user, 'export_csv', 'fiscal_year', fy.id, fiscal_year_id=fy.id)
    db.commit()
    fname = f'houjinzei-draft-{fy.id}-{fy.end_date.isoformat()}.csv'
    return Response(to_csv(data), media_type='text/csv; charset=utf-8',
                    headers={'Content-Disposition': f'attachment; filename="{fname}"'})

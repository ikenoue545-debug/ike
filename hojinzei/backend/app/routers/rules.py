"""税率・法令（ルールデータ）の一覧と、専門家による確認の記録。監査ログの閲覧。"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from taxengine.rules.registry import default_registry

from .. import audit
from ..models import AuditLog, RuleReview, User
from ..security import current_user, get_db, require_role
from .common import iso, user_dict

router = APIRouter()


@router.get('/rules')
def list_rules(user: User = Depends(current_user), db: Session = Depends(get_db)):
    reg = default_registry()
    reviews: dict[tuple[str, str], list] = {}
    for r in db.scalars(select(RuleReview).order_by(RuleReview.reviewed_at.desc())):
        reviews.setdefault((r.rule_id, r.version), []).append(
            {'reviewer_name': r.reviewer_name, 'note': r.note, 'reviewed_at': iso(r.reviewed_at)})
    out = []
    for rid in reg.ids():
        m = reg.meta(rid)
        out.append({**m, 'versions': [{**v.to_dict(), 'reviews': reviews.get((rid, v.version), [])} for v in reg.versions(rid)]})
    return out


class ReviewIn(BaseModel):
    reviewer_name: str = Field(min_length=1, max_length=100)
    note: Optional[str] = None


@router.post('/rules/{rule_id}/{version}/reviews')
def add_review(rule_id: str, version: str, body: ReviewIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_role(user, 'admin', 'reviewer')
    reg = default_registry()
    if rule_id not in reg.ids() or version not in {v.version for v in reg.versions(rule_id)}:
        raise HTTPException(404, 'ルールの版が見つかりません')
    db.add(RuleReview(rule_id=rule_id, version=version, reviewer_name=body.reviewer_name, note=body.note, created_by=user.id))
    audit.log(db, user, 'rule_review', 'rule', None, rule=rule_id, version=version)
    db.commit()
    return {'ok': True}


@router.get('/audit')
def audit_logs(company_id: Optional[int] = None, fiscal_year_id: Optional[int] = None, limit: int = 200,
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_role(user, 'admin')
    q = select(AuditLog).order_by(AuditLog.at.desc()).limit(min(limit, 1000))
    if company_id:
        q = q.where(AuditLog.company_id == company_id)
    if fiscal_year_id:
        q = q.where(AuditLog.fiscal_year_id == fiscal_year_id)
    return [{'id': a.id, 'at': iso(a.at), 'user': user_dict(db.get(User, a.user_id)) if a.user_id else None, 'action': a.action,
             'entity': a.entity, 'entity_id': a.entity_id, 'company_id': a.company_id, 'fiscal_year_id': a.fiscal_year_id,
             'detail': a.detail} for a in db.scalars(q)]

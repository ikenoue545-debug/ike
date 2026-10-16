"""顧問先（会社）と事業年度。"""
from __future__ import annotations

import shutil
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from taxengine.model import B4_LINES, DISPOSITIONS, ADJ_STATUSES
from taxengine.periods import filing_deadline, months_in_period
from taxengine.scope import UNSUPPORTED_FEATURES

from .. import audit
from ..models import Company, CompanyMember, FiscalYear, StatusHistory, User
from ..security import ROLES, current_user, get_company_for, get_db, get_fy_for, require_role
from ..services.accounts_master import category_options
from ..services.company_info import check_corporate_number, local_tax_candidates, split_address
from ..services.documents import DOC_KINDS
from ..services.suggestions import TAX_FLAGS
from ..services.workflow import STATUSES, STATUS_LABELS, can_set_manually
from .common import company_dict, fy_dict, iso, user_dict

router = APIRouter()


@router.get('/meta')
def meta(user: User = Depends(current_user)):
    return {
        'statuses': [{'key': k, 'label': l} for k, l in STATUSES],
        'roles': ROLES,
        'categories': category_options(),
        'b4_lines': [{'line': k, **v} for k, v in B4_LINES.items()],
        'dispositions': DISPOSITIONS,
        'adjustment_statuses': ADJ_STATUSES,
        'doc_kinds': DOC_KINDS,
        'unsupported_features': [{'key': k, 'label': v[0], 'note': v[1]} for k, v in UNSUPPORTED_FEATURES.items()],
        'tax_flags': TAX_FLAGS,
        'adjustment_templates': ADJUSTMENT_TEMPLATES,
    }


ADJUSTMENT_TEMPLATES = [
    {'kind': 'officer_compensation', 'name': '役員給与の損金不算入額', 'line': '7', 'direction': 'add', 'disposition': 'sonota',
     'basis': ['法人税法第34条第1項']},
    {'kind': 'depreciation_excess', 'name': '減価償却の償却超過額', 'line': '6', 'direction': 'add', 'disposition': 'ryuho',
     'five1_key': 'depreciation_excess', 'five1_name': '減価償却超過額', 'basis': ['法人税法第31条']},
    {'kind': 'depreciation_reversal', 'name': '減価償却超過額の当期認容額', 'line': '12', 'direction': 'deduct',
     'disposition': 'ryuho', 'five1_key': 'depreciation_excess', 'five1_name': '減価償却超過額', 'five1_column': 'decrease',
     'basis': ['法人税法第31条']},
    {'kind': 'donations', 'name': '寄附金の損金不算入額', 'line': '27', 'direction': 'add', 'disposition': 'sonota',
     'basis': ['法人税法第37条']},
    {'kind': 'dividend_exclusion', 'name': '受取配当等の益金不算入額', 'line': '14', 'direction': 'deduct', 'disposition': 'kome',
     'basis': ['法人税法第23条']},
    {'kind': 'penalties', 'name': '罰金・科料等の損金不算入額', 'line': '10', 'direction': 'add', 'disposition': 'sonota',
     'basis': ['法人税法第55条']},
    {'kind': 'refund_income', 'name': '法人税等の中間納付額及び過誤納に係る還付金額', 'line': '18', 'direction': 'deduct',
     'disposition': 'ryuho', 'five1_key': 'refund_national', 'five1_name': '未収還付法人税等', 'five1_column': 'decrease',
     'basis': ['法人税法第26条']},
    {'kind': 'income_tax_refund', 'name': '所得税額等の還付金額', 'line': '19', 'direction': 'deduct', 'disposition': 'kome',
     'basis': ['法人税法第26条']},
    {'kind': 'manual_add', 'name': '', 'line': '10', 'direction': 'add', 'disposition': 'ryuho', 'basis': []},
    {'kind': 'manual_deduct', 'name': '', 'line': '21', 'direction': 'deduct', 'disposition': 'ryuho', 'basis': []},
]


# ---------------------------------------------------------------- 会社
class CompanyIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    name_kana: Optional[str] = None
    corporate_number: Optional[str] = None
    corp_kind: str = 'kabushiki'
    corp_category: str = 'ordinary'
    head_office_address: Optional[str] = None
    prefecture: Optional[str] = None
    municipality: Optional[str] = None
    phone: Optional[str] = None
    representative: Optional[str] = None
    tax_office: Optional[str] = None
    local_tax_offices: Optional[str] = None
    industry: Optional[str] = None
    business_description: Optional[str] = None
    established_on: Optional[date] = None
    fiscal_year_end_month: Optional[int] = Field(default=None, ge=1, le=12)
    filing_extension_months: int = Field(default=0, ge=0, le=4)
    assigned_user_id: Optional[int] = None
    notes: Optional[str] = None


class CompanyPatch(CompanyIn):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)


def _validate_company(data: dict) -> list[str]:
    warnings = []
    if data.get('corporate_number'):
        ok, msg = check_corporate_number(data['corporate_number'])
        if not ok:
            raise HTTPException(422, msg)
    if data.get('corp_kind') not in (None, 'kabushiki', 'godo', 'other'):
        raise HTTPException(422, '法人の種類が不正です')
    return warnings


@router.get('/companies')
def list_companies(user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(Company).order_by(Company.name)
    if user.role != 'admin':
        q = q.join(CompanyMember, CompanyMember.company_id == Company.id).where(CompanyMember.user_id == user.id)
    out = []
    for c in db.scalars(q):
        fys = sorted(c.fiscal_years, key=lambda f: f.start_date)
        cur = fys[-1] if fys else None
        out.append({
            **company_dict(c, db),
            'current_year': fy_dict(cur, c) if cur else None,
            'fiscal_year_count': len(fys),
            'last_updated': iso(max([c.updated_at] + [f.updated_at for f in fys])),
        })
    return out


@router.post('/companies')
def create_company(body: CompanyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    data = body.model_dump()
    _validate_company(data)
    if data.get('head_office_address') and not data.get('prefecture'):
        parts = split_address(data['head_office_address'])
        data['prefecture'] = data.get('prefecture') or parts['prefecture']
        data['municipality'] = data.get('municipality') or parts['municipality']
    c = Company(**data)
    if c.assigned_user_id is None:
        c.assigned_user_id = user.id
    db.add(c)
    db.flush()
    for uid in {user.id, c.assigned_user_id}:
        if uid and db.get(CompanyMember, (c.id, uid)) is None:
            db.add(CompanyMember(company_id=c.id, user_id=uid))
    audit.log(db, user, 'company_create', 'company', c.id, company_id=c.id)
    db.commit()
    return company_dict(c, db, with_members=True)


@router.get('/companies/{cid}')
def get_company(cid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = get_company_for(db, user, cid)
    d = company_dict(c, db, with_members=True)
    d['fiscal_years'] = [fy_dict(f, c) for f in sorted(c.fiscal_years, key=lambda f: f.start_date, reverse=True)]
    parts = split_address(c.head_office_address or '')
    d['address_candidates'] = parts
    d['local_tax_candidates'] = local_tax_candidates(c.prefecture or parts['prefecture'], c.municipality or parts['municipality'])
    d['tax_office_note'] = ('所轄税務署は本店所在地から決まりますが、本システムには税務署の管轄の一覧がありません。'
                            '国税庁「税務署の所在地などを知りたい方」で確認して入力してください。')
    d['tax_office_url'] = 'https://www.nta.go.jp/about/organization/access/map.htm'
    return d


@router.patch('/companies/{cid}')
def update_company(cid: int, body: CompanyPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = get_company_for(db, user, cid)
    data = body.model_dump(exclude_unset=True)
    _validate_company({**{'corp_kind': c.corp_kind}, **data})
    for k, v in data.items():
        setattr(c, k, v)
    if 'assigned_user_id' in data and data['assigned_user_id'] and db.get(CompanyMember, (c.id, data['assigned_user_id'])) is None:
        db.add(CompanyMember(company_id=c.id, user_id=data['assigned_user_id']))
    audit.log(db, user, 'company_update', 'company', c.id, company_id=c.id, fields=sorted(data))
    db.commit()
    return get_company(cid, user, db)


class MembersIn(BaseModel):
    user_ids: list[int]


@router.put('/companies/{cid}/members')
def set_members(cid: int, body: MembersIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_role(user, 'admin')
    c = get_company_for(db, user, cid)
    for m in db.scalars(select(CompanyMember).where(CompanyMember.company_id == c.id)):
        db.delete(m)
    db.flush()
    for uid in set(body.user_ids):
        if db.get(User, uid):
            db.add(CompanyMember(company_id=c.id, user_id=uid))
    audit.log(db, user, 'company_members', 'company', c.id, company_id=c.id, count=len(set(body.user_ids)))
    db.commit()
    return {'member_ids': sorted(set(body.user_ids))}


@router.delete('/companies/{cid}')
def delete_company(cid: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """会社と、その年度のデータ・アップロードしたファイルをすべて削除する（管理者のみ・元に戻せない）。"""
    require_role(user, 'admin')
    c = get_company_for(db, user, cid)
    folder = request.app.state.settings.data_dir / 'files' / f'company-{c.id}'
    db.delete(c)
    audit.log(db, user, 'company_delete', 'company', cid, company_id=cid)
    db.commit()
    shutil.rmtree(folder, ignore_errors=True)
    return {'ok': True}


@router.post('/tools/corporate-number')
def tool_corporate_number(body: dict, user: User = Depends(current_user)):
    ok, msg = check_corporate_number(str(body.get('number', '')))
    return {'ok': ok, 'message': msg}


@router.post('/tools/address')
def tool_address(body: dict, user: User = Depends(current_user)):
    parts = split_address(str(body.get('address', '')))
    return {**parts, 'local_tax_candidates': local_tax_candidates(parts['prefecture'], parts['municipality'])}


# ---------------------------------------------------------------- 年度
class FiscalYearIn(BaseModel):
    start_date: date
    end_date: date
    return_kind: str = 'final'
    blue_return: bool = True
    capital_end: Optional[int] = Field(default=None, ge=0)
    large_corp_subsidiary: Optional[bool] = None
    tekiyo_jogai: Optional[bool] = None
    group_tsusan: bool = False
    dividends: Optional[int] = Field(default=0, ge=0)
    unsupported_features: list[str] = Field(default_factory=list)


class FiscalYearPatch(BaseModel):
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    return_kind: Optional[str] = None
    blue_return: Optional[bool] = None
    capital_end: Optional[int] = Field(default=None, ge=0)
    large_corp_subsidiary: Optional[bool] = None
    tekiyo_jogai: Optional[bool] = None
    group_tsusan: Optional[bool] = None
    dividends: Optional[int] = Field(default=None, ge=0)
    unsupported_features: Optional[list[str]] = None
    reviewer_id: Optional[int] = None


def _check_period(start: date, end: date) -> None:
    if end < start:
        raise HTTPException(422, '終了日が開始日より前です')
    if months_in_period(start, end) > 12:
        raise HTTPException(422, '事業年度は1年以内です')


@router.post('/companies/{cid}/fiscal-years')
def create_fy(cid: int, body: FiscalYearIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = get_company_for(db, user, cid)
    _check_period(body.start_date, body.end_date)
    if db.scalar(select(FiscalYear).where(FiscalYear.company_id == c.id, FiscalYear.start_date == body.start_date)):
        raise HTTPException(409, 'この開始日の事業年度はすでにあります')
    unknown = [k for k in body.unsupported_features if k not in UNSUPPORTED_FEATURES]
    if unknown:
        raise HTTPException(422, f'不明な論点：{unknown}')
    prev = db.scalar(select(FiscalYear).where(FiscalYear.company_id == c.id, FiscalYear.end_date < body.start_date)
                     .order_by(FiscalYear.end_date.desc()))
    fy = FiscalYear(company_id=c.id, previous_id=prev.id if prev else None, **body.model_dump())
    db.add(fy)
    db.flush()
    db.add(StatusHistory(fiscal_year_id=fy.id, from_status=None, to_status=fy.status, changed_by=user.id))
    audit.log(db, user, 'fy_create', 'fiscal_year', fy.id, company_id=c.id, fiscal_year_id=fy.id)
    db.commit()
    return fy_dict(fy, c)


@router.get('/fiscal-years/{fid}')
def get_fy(fid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    c = fy.company
    d = fy_dict(fy, c)
    d['company'] = company_dict(c, db)
    d['months'] = months_in_period(fy.start_date, fy.end_date)
    d['history'] = [{'from': h.from_status, 'to': h.to_status, 'note': h.note, 'by': user_dict(db.get(User, h.changed_by)),
                     'at': iso(h.changed_at)}
                    for h in db.scalars(select(StatusHistory).where(StatusHistory.fiscal_year_id == fy.id)
                                        .order_by(StatusHistory.changed_at))]
    d['reviewer'] = user_dict(db.get(User, fy.reviewer_id)) if fy.reviewer_id else None
    d['approver'] = user_dict(db.get(User, fy.approved_by)) if fy.approved_by else None
    return d


@router.patch('/fiscal-years/{fid}')
def update_fy(fid: int, body: FiscalYearPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    if fy.status in ('approved', 'filed'):
        raise HTTPException(409, '承認済の年度は変更できません（承認を取り消してから変更してください）')
    data = body.model_dump(exclude_unset=True)
    if 'unsupported_features' in data:
        unknown = [k for k in data['unsupported_features'] or [] if k not in UNSUPPORTED_FEATURES]
        if unknown:
            raise HTTPException(422, f'不明な論点：{unknown}')
    if data.get('reviewer_id'):
        rv = db.get(User, data['reviewer_id'])
        if rv is None or rv.role not in ('reviewer', 'admin'):
            raise HTTPException(422, 'レビュー担当者には、レビュー担当者か管理者を選んでください')
        if db.get(CompanyMember, (fy.company_id, rv.id)) is None:
            db.add(CompanyMember(company_id=fy.company_id, user_id=rv.id))
    for k, v in data.items():
        setattr(fy, k, v)
    _check_period(fy.start_date, fy.end_date)
    audit.log(db, user, 'fy_update', 'fiscal_year', fy.id, company_id=fy.company_id, fiscal_year_id=fy.id, fields=sorted(data))
    db.commit()
    return get_fy(fid, user, db)


class StatusIn(BaseModel):
    status: str
    note: Optional[str] = None


@router.post('/fiscal-years/{fid}/status')
def set_status(fid: int, body: StatusIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    ok, msg = can_set_manually(fy.status, body.status)
    if not ok:
        raise HTTPException(409, msg)
    if body.status == 'filed':
        require_role(user, 'admin', 'reviewer')
    db.add(StatusHistory(fiscal_year_id=fy.id, from_status=fy.status, to_status=body.status, note=body.note, changed_by=user.id))
    fy.status = body.status
    audit.log(db, user, 'fy_status', 'fiscal_year', fy.id, company_id=fy.company_id, fiscal_year_id=fy.id, to=body.status)
    db.commit()
    return get_fy(fid, user, db)


@router.delete('/fiscal-years/{fid}')
def delete_fy(fid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_role(user, 'admin')
    fy = get_fy_for(db, user, fid)
    cid = fy.company_id
    db.delete(fy)
    audit.log(db, user, 'fy_delete', 'fiscal_year', fid, company_id=cid, fiscal_year_id=fid)
    db.commit()
    return {'ok': True}

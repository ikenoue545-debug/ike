"""ルーター共通：ORM から JSON への変換。"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from taxengine.periods import filing_deadline

from ..models import Company, CompanyMember, FiscalYear, TaxAdjustment, User
from ..services.workflow import STATUS_LABELS


def iso(v: Any) -> Any:
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v


def user_dict(u: Optional[User]) -> Optional[dict]:
    if u is None:
        return None
    return {'id': u.id, 'email': u.email, 'display_name': u.display_name, 'role': u.role, 'is_active': u.is_active}


def fy_dict(fy: FiscalYear, company: Optional[Company] = None) -> dict:
    company = company or fy.company
    return {
        'id': fy.id, 'company_id': fy.company_id, 'start_date': iso(fy.start_date), 'end_date': iso(fy.end_date),
        'label': f'{fy.start_date.isoformat()}〜{fy.end_date.isoformat()}',
        'return_kind': fy.return_kind, 'blue_return': fy.blue_return, 'capital_end': fy.capital_end,
        'large_corp_subsidiary': fy.large_corp_subsidiary, 'tekiyo_jogai': fy.tekiyo_jogai, 'group_tsusan': fy.group_tsusan,
        'dividends': fy.dividends, 'unsupported_features': fy.unsupported_features or [],
        'status': fy.status, 'status_label': STATUS_LABELS.get(fy.status, fy.status),
        'reviewer_id': fy.reviewer_id, 'approved_by': fy.approved_by, 'approved_at': iso(fy.approved_at),
        'previous_id': fy.previous_id,
        'filing_deadline': iso(filing_deadline(fy.end_date, company.filing_extension_months or 0)),
        'last_computed_at': iso(fy.last_computed_at), 'critical_count': fy.critical_count, 'warning_count': fy.warning_count,
        'updated_at': iso(fy.updated_at),
    }


def company_dict(c: Company, db: Session, with_members: bool = False) -> dict:
    d = {
        'id': c.id, 'name': c.name, 'name_kana': c.name_kana, 'corporate_number': c.corporate_number,
        'corp_kind': c.corp_kind, 'corp_category': c.corp_category, 'head_office_address': c.head_office_address,
        'prefecture': c.prefecture, 'municipality': c.municipality, 'phone': c.phone, 'representative': c.representative,
        'tax_office': c.tax_office, 'local_tax_offices': c.local_tax_offices, 'industry': c.industry,
        'business_description': c.business_description, 'established_on': iso(c.established_on),
        'fiscal_year_end_month': c.fiscal_year_end_month, 'filing_extension_months': c.filing_extension_months,
        'assigned_user_id': c.assigned_user_id, 'notes': c.notes, 'updated_at': iso(c.updated_at),
        'assigned_user': user_dict(db.get(User, c.assigned_user_id)) if c.assigned_user_id else None,
    }
    if with_members:
        d['member_ids'] = [m.user_id for m in db.scalars(select(CompanyMember).where(CompanyMember.company_id == c.id))]
    return d


def adjustment_dict(a: TaxAdjustment) -> dict:
    return {
        'id': a.id, 'fiscal_year_id': a.fiscal_year_id, 'kind': a.kind, 'name': a.name, 'line': a.line,
        'direction': a.direction, 'disposition': a.disposition, 'amount': a.amount, 'target_amount': a.target_amount,
        'status': a.status, 'decision': a.decision, 'confirmed': a.confirmed, 'confirmed_by': a.confirmed_by,
        'confirmed_at': iso(a.confirmed_at), 'five1_key': a.five1_key, 'five1_name': a.five1_name,
        'five1_column': a.five1_column, 'account_names': a.account_names or [], 'reason': a.reason, 'basis': a.basis or [],
        'evidence': a.evidence or [], 'questions': a.questions or [], 'dismiss_reason': a.dismiss_reason,
        'origin': a.origin, 'suggestion_key': a.suggestion_key, 'created_at': iso(a.created_at),
        'updated_at': iso(a.updated_at),
    }

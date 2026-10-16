"""DB のテーブル定義（SQLAlchemy 2.0）。

- 会社の情報（companies）と、年度ごとの申告データ（fiscal_year_id を持つテーブル）を分ける。
- 金額は BigInteger の整数円。NULL は「未確定」。
- 監査ログには金額や個人情報を入れない。
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Optional

from sqlalchemy import JSON, BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


# ---------------------------------------------------------------- 利用者・権限
class User(TimestampMixin, Base):
    __tablename__ = 'users'
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    display_name: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(20))  # admin | reviewer | staff
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class AuthToken(Base):
    __tablename__ = 'auth_tokens'
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------- 会社
class Company(TimestampMixin, Base):
    __tablename__ = 'companies'
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    name_kana: Mapped[Optional[str]] = mapped_column(String(200))
    corporate_number: Mapped[Optional[str]] = mapped_column(String(13))
    corp_kind: Mapped[str] = mapped_column(String(20), default='kabushiki')  # kabushiki | godo | other
    corp_category: Mapped[str] = mapped_column(String(20), default='ordinary')  # ordinary 普通法人 | other
    head_office_address: Mapped[Optional[str]] = mapped_column(String(300))
    prefecture: Mapped[Optional[str]] = mapped_column(String(10))
    municipality: Mapped[Optional[str]] = mapped_column(String(50))
    phone: Mapped[Optional[str]] = mapped_column(String(30))
    representative: Mapped[Optional[str]] = mapped_column(String(100))
    tax_office: Mapped[Optional[str]] = mapped_column(String(50))
    local_tax_offices: Mapped[Optional[str]] = mapped_column(String(300))  # 地方税の提出先（確認済みの値）
    industry: Mapped[Optional[str]] = mapped_column(String(100))
    business_description: Mapped[Optional[str]] = mapped_column(Text)
    established_on: Mapped[Optional[date]] = mapped_column(Date)
    fiscal_year_end_month: Mapped[Optional[int]] = mapped_column(Integer)
    filing_extension_months: Mapped[int] = mapped_column(Integer, default=0)  # 申告期限の延長の特例（月数）
    assigned_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    notes: Mapped[Optional[str]] = mapped_column(Text)

    fiscal_years: Mapped[list['FiscalYear']] = relationship(back_populates='company', cascade='all, delete-orphan',
                                                            passive_deletes=True, order_by='FiscalYear.start_date')
    offices: Mapped[list['CompanyOffice']] = relationship(cascade='all, delete-orphan', passive_deletes=True)


class CompanyOffice(Base):
    __tablename__ = 'company_offices'
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey('companies.id', ondelete='CASCADE'))
    name: Mapped[str] = mapped_column(String(100))
    kind: Mapped[str] = mapped_column(String(20), default='branch')  # head | branch
    address: Mapped[Optional[str]] = mapped_column(String(300))
    prefecture: Mapped[Optional[str]] = mapped_column(String(10))
    municipality: Mapped[Optional[str]] = mapped_column(String(50))
    employees: Mapped[Optional[int]] = mapped_column(Integer)


class CompanyMember(Base):
    __tablename__ = 'company_members'
    company_id: Mapped[int] = mapped_column(ForeignKey('companies.id', ondelete='CASCADE'), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)


# ---------------------------------------------------------------- 年度
class FiscalYear(TimestampMixin, Base):
    __tablename__ = 'fiscal_years'
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey('companies.id', ondelete='CASCADE'))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    return_kind: Mapped[str] = mapped_column(String(20), default='final')  # final | amended | interim
    blue_return: Mapped[bool] = mapped_column(Boolean, default=True)
    capital_end: Mapped[Optional[int]] = mapped_column(BigInteger)
    large_corp_subsidiary: Mapped[Optional[bool]] = mapped_column(Boolean)
    tekiyo_jogai: Mapped[Optional[bool]] = mapped_column(Boolean)
    group_tsusan: Mapped[bool] = mapped_column(Boolean, default=False)
    dividends: Mapped[Optional[int]] = mapped_column(BigInteger, default=0)
    unsupported_features: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(20), default='not_started')
    reviewer_id: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    approved_by: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    previous_id: Mapped[Optional[int]] = mapped_column(ForeignKey('fiscal_years.id', ondelete='SET NULL'))
    # 最後に計算したときの指摘の件数（顧問先一覧用）
    last_computed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    critical_count: Mapped[Optional[int]] = mapped_column(Integer)
    warning_count: Mapped[Optional[int]] = mapped_column(Integer)

    company: Mapped[Company] = relationship(back_populates='fiscal_years')
    __table_args__ = (UniqueConstraint('company_id', 'start_date', name='uq_fy_company_start'),)


class Shareholder(Base):
    __tablename__ = 'shareholders'
    id: Mapped[int] = mapped_column(primary_key=True)
    fiscal_year_id: Mapped[int] = mapped_column(ForeignKey('fiscal_years.id', ondelete='CASCADE'))
    name: Mapped[str] = mapped_column(String(200))
    address: Mapped[Optional[str]] = mapped_column(String(300))
    relation: Mapped[Optional[str]] = mapped_column(String(30))
    shares: Mapped[Optional[int]] = mapped_column(BigInteger)
    voting_rights: Mapped[Optional[int]] = mapped_column(BigInteger)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Document(Base):
    __tablename__ = 'documents'
    id: Mapped[int] = mapped_column(primary_key=True)
    fiscal_year_id: Mapped[int] = mapped_column(ForeignKey('fiscal_years.id', ondelete='CASCADE'))
    kind: Mapped[str] = mapped_column(String(40))
    filename: Mapped[str] = mapped_column(String(300))
    content_type: Mapped[Optional[str]] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    storage_path: Mapped[str] = mapped_column(String(500))
    uploaded_by: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ImportBatch(Base):
    __tablename__ = 'import_batches'
    id: Mapped[int] = mapped_column(primary_key=True)
    fiscal_year_id: Mapped[int] = mapped_column(ForeignKey('fiscal_years.id', ondelete='CASCADE'))
    document_id: Mapped[Optional[int]] = mapped_column(ForeignKey('documents.id', ondelete='SET NULL'))
    kind: Mapped[str] = mapped_column(String(30))  # trial_balance | journal
    status: Mapped[str] = mapped_column(String(20), default='pending')  # pending | imported | discarded | error
    detected: Mapped[dict] = mapped_column(JSON, default=dict)
    mapping: Mapped[dict] = mapped_column(JSON, default=dict)
    row_count: Mapped[Optional[int]] = mapped_column(Integer)
    error: Mapped[Optional[str]] = mapped_column(Text)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    imported_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class Account(Base):
    __tablename__ = 'accounts'
    id: Mapped[int] = mapped_column(primary_key=True)
    fiscal_year_id: Mapped[int] = mapped_column(ForeignKey('fiscal_years.id', ondelete='CASCADE'))
    code: Mapped[Optional[str]] = mapped_column(String(30))
    name: Mapped[str] = mapped_column(String(100))
    statement: Mapped[Optional[str]] = mapped_column(String(2))  # BS | PL
    section: Mapped[Optional[str]] = mapped_column(String(20))  # asset | liability | equity | revenue | expense
    category: Mapped[Optional[str]] = mapped_column(String(40))
    classification: Mapped[str] = mapped_column(String(20), default='auto')  # auto | confirmed | unknown
    heading: Mapped[Optional[str]] = mapped_column(String(100))  # 取込時の見出し（流動資産など）
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    __table_args__ = (UniqueConstraint('fiscal_year_id', 'name', name='uq_account_fy_name'),)


class TrialBalanceLine(Base):
    __tablename__ = 'trial_balance_lines'
    id: Mapped[int] = mapped_column(primary_key=True)
    fiscal_year_id: Mapped[int] = mapped_column(ForeignKey('fiscal_years.id', ondelete='CASCADE'))
    account_id: Mapped[int] = mapped_column(ForeignKey('accounts.id', ondelete='CASCADE'))
    opening: Mapped[Optional[int]] = mapped_column(BigInteger)
    debit: Mapped[Optional[int]] = mapped_column(BigInteger)
    credit: Mapped[Optional[int]] = mapped_column(BigInteger)
    closing: Mapped[Optional[int]] = mapped_column(BigInteger)
    import_batch_id: Mapped[Optional[int]] = mapped_column(ForeignKey('import_batches.id', ondelete='SET NULL'))
    __table_args__ = (UniqueConstraint('fiscal_year_id', 'account_id', name='uq_tb_fy_account'),)


class JournalLine(Base):
    __tablename__ = 'journal_lines'
    id: Mapped[int] = mapped_column(primary_key=True)
    fiscal_year_id: Mapped[int] = mapped_column(ForeignKey('fiscal_years.id', ondelete='CASCADE'))
    import_batch_id: Mapped[Optional[int]] = mapped_column(ForeignKey('import_batches.id', ondelete='CASCADE'))
    entry_date: Mapped[Optional[date]] = mapped_column(Date)
    entry_no: Mapped[Optional[str]] = mapped_column(String(50))
    side: Mapped[str] = mapped_column(String(6))  # debit | credit
    account_name: Mapped[str] = mapped_column(String(100))
    counter_account: Mapped[Optional[str]] = mapped_column(String(100))
    amount: Mapped[int] = mapped_column(BigInteger)
    tax_category: Mapped[Optional[str]] = mapped_column(String(50))
    partner: Mapped[Optional[str]] = mapped_column(String(200))
    item: Mapped[Optional[str]] = mapped_column(String(200))
    department: Mapped[Optional[str]] = mapped_column(String(100))
    memo: Mapped[Optional[str]] = mapped_column(Text)
    __table_args__ = (Index('ix_journal_fy_account', 'fiscal_year_id', 'account_name'),)


# ---------------------------------------------------------------- 税務調整・入力
class TaxAdjustment(TimestampMixin, Base):
    __tablename__ = 'tax_adjustments'
    id: Mapped[int] = mapped_column(primary_key=True)
    fiscal_year_id: Mapped[int] = mapped_column(ForeignKey('fiscal_years.id', ondelete='CASCADE'))
    kind: Mapped[str] = mapped_column(String(50))
    name: Mapped[str] = mapped_column(String(200))
    line: Mapped[str] = mapped_column(String(10))
    direction: Mapped[str] = mapped_column(String(10))
    disposition: Mapped[str] = mapped_column(String(10))
    amount: Mapped[Optional[int]] = mapped_column(BigInteger)
    target_amount: Mapped[Optional[int]] = mapped_column(BigInteger)  # 対象額（科目の金額など）
    status: Mapped[str] = mapped_column(String(20), default='review')  # auto | review | missing | unsupported
    decision: Mapped[str] = mapped_column(String(20), default='adopted')  # pending | adopted | dismissed
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    confirmed_by: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    five1_key: Mapped[Optional[str]] = mapped_column(String(80))
    five1_name: Mapped[Optional[str]] = mapped_column(String(200))
    five1_column: Mapped[str] = mapped_column(String(10), default='increase')
    account_names: Mapped[list] = mapped_column(JSON, default=list)
    reason: Mapped[Optional[str]] = mapped_column(Text)
    basis: Mapped[list] = mapped_column(JSON, default=list)
    evidence: Mapped[list] = mapped_column(JSON, default=list)
    questions: Mapped[list] = mapped_column(JSON, default=list)
    dismiss_reason: Mapped[Optional[str]] = mapped_column(Text)
    origin: Mapped[str] = mapped_column(String(20), default='user')  # user | suggestion | carryover
    suggestion_key: Mapped[Optional[str]] = mapped_column(String(80))
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    updated_by: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))


class CarryforwardItem(TimestampMixin, Base):
    """前期から引き継ぐ期首情報（別表五(一)の各行、繰越欠損金）。"""
    __tablename__ = 'carryforward_items'
    id: Mapped[int] = mapped_column(primary_key=True)
    fiscal_year_id: Mapped[int] = mapped_column(ForeignKey('fiscal_years.id', ondelete='CASCADE'))
    kind: Mapped[str] = mapped_column(String(20))  # retained | loss
    key: Mapped[Optional[str]] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(200))
    amount: Mapped[Optional[int]] = mapped_column(BigInteger)
    loss_fy_start: Mapped[Optional[date]] = mapped_column(Date)
    loss_fy_end: Mapped[Optional[date]] = mapped_column(Date)
    source: Mapped[str] = mapped_column(String(20), default='manual')  # carryover | manual | pdf
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    confirmed_by: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))


class InputSection(Base):
    """税額の基礎の入力（JSON。Pydantic で検証）。保存のたびに履歴を残す。"""
    __tablename__ = 'input_sections'
    id: Mapped[int] = mapped_column(primary_key=True)
    fiscal_year_id: Mapped[int] = mapped_column(ForeignKey('fiscal_years.id', ondelete='CASCADE'))
    section: Mapped[str] = mapped_column(String(40))
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_by: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    __table_args__ = (UniqueConstraint('fiscal_year_id', 'section', name='uq_input_fy_section'),)


class InputSectionHistory(Base):
    __tablename__ = 'input_section_history'
    id: Mapped[int] = mapped_column(primary_key=True)
    input_section_id: Mapped[int] = mapped_column(ForeignKey('input_sections.id', ondelete='CASCADE'))
    data: Mapped[dict] = mapped_column(JSON)
    updated_by: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CellOverride(Base):
    __tablename__ = 'cell_overrides'
    id: Mapped[int] = mapped_column(primary_key=True)
    fiscal_year_id: Mapped[int] = mapped_column(ForeignKey('fiscal_years.id', ondelete='CASCADE'))
    cell_key: Mapped[str] = mapped_column(String(80))
    value: Mapped[Optional[int]] = mapped_column(BigInteger)
    reason: Mapped[str] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    revoked_by: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class ReturnSnapshot(Base):
    __tablename__ = 'return_snapshots'
    id: Mapped[int] = mapped_column(primary_key=True)
    fiscal_year_id: Mapped[int] = mapped_column(ForeignKey('fiscal_years.id', ondelete='CASCADE'))
    kind: Mapped[str] = mapped_column(String(20), default='draft')  # draft | approved
    engine_version: Mapped[str] = mapped_column(String(20))
    input_hash: Mapped[str] = mapped_column(String(64))
    rules_used: Mapped[list] = mapped_column(JSON)
    result: Mapped[dict] = mapped_column(JSON)
    critical_count: Mapped[int] = mapped_column(Integer)
    warning_count: Mapped[int] = mapped_column(Integer)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FindingAck(Base):
    __tablename__ = 'finding_acks'
    id: Mapped[int] = mapped_column(primary_key=True)
    fiscal_year_id: Mapped[int] = mapped_column(ForeignKey('fiscal_years.id', ondelete='CASCADE'))
    fingerprint: Mapped[str] = mapped_column(String(32))
    code: Mapped[str] = mapped_column(String(80))
    note: Mapped[Optional[str]] = mapped_column(Text)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (UniqueConstraint('fiscal_year_id', 'fingerprint', name='uq_ack_fy_fp'),)


class StatusHistory(Base):
    __tablename__ = 'status_history'
    id: Mapped[int] = mapped_column(primary_key=True)
    fiscal_year_id: Mapped[int] = mapped_column(ForeignKey('fiscal_years.id', ondelete='CASCADE'))
    from_status: Mapped[Optional[str]] = mapped_column(String(20))
    to_status: Mapped[str] = mapped_column(String(20))
    note: Mapped[Optional[str]] = mapped_column(Text)
    changed_by: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RuleReview(Base):
    """ルールの版を税理士等が確認した記録。"""
    __tablename__ = 'rule_reviews'
    id: Mapped[int] = mapped_column(primary_key=True)
    rule_id: Mapped[str] = mapped_column(String(60))
    version: Mapped[str] = mapped_column(String(40))
    reviewer_name: Mapped[str] = mapped_column(String(100))
    note: Mapped[Optional[str]] = mapped_column(Text)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditLog(Base):
    __tablename__ = 'audit_logs'
    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    action: Mapped[str] = mapped_column(String(60))
    entity: Mapped[Optional[str]] = mapped_column(String(40))
    entity_id: Mapped[Optional[int]] = mapped_column(Integer)
    company_id: Mapped[Optional[int]] = mapped_column(Integer)  # 会社を消しても記録は残すため外部キーにしない
    fiscal_year_id: Mapped[Optional[int]] = mapped_column(Integer)
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

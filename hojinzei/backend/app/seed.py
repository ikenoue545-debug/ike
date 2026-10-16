"""開発・デモ用のデータ（すべて架空）を入れる。画面と同じ取込の処理を通す。

利用者（パスワードは環境変数 HOJINZEI_DEMO_PASSWORD、未設定なら demo-pass-2026）：
  admin@example.com（管理者） / reviewer@example.com（レビュー担当者） / staff@example.com（担当者）
本番（HOJINZEI_ENV=prod）では入れない。
"""
from __future__ import annotations

import hashlib
import os
from datetime import date
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings
from .models import (CarryforwardItem, Company, CompanyMember, Document, FiscalYear, ImportBatch, InputSection, StatusHistory,
                     TaxAdjustment, User)
from .security import hash_password
from .services import importer
from .services.import_apply import apply_journal, apply_trial_balance
from .services.inputs import validate_section
from .services.suggestions import sync_candidates
from .services.trial_balance import analyze

SAMPLES = Path(__file__).resolve().parents[2] / 'samples'


def _users(db: Session) -> dict[str, User]:
    pw = os.environ.get('HOJINZEI_DEMO_PASSWORD', 'demo-pass-2026')
    out = {}
    for email, name, role in (('admin@example.com', '管理者 山田（架空）', 'admin'),
                              ('reviewer@example.com', '税理士 佐藤（架空）', 'reviewer'),
                              ('staff@example.com', '担当 鈴木（架空）', 'staff')):
        u = db.scalar(select(User).where(User.email == email))
        if u is None:
            u = User(email=email, display_name=name, role=role, password_hash=hash_password(pw))
            db.add(u)
            db.flush()
        out[role] = u
    return out


def _store(settings: Settings, db: Session, fy: FiscalYear, kind: str, path: Path, user: User) -> Document:
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    rel = Path('files') / f'company-{fy.company_id}' / f'fy-{fy.id}' / f'{digest[:12]}-{path.name}'
    (settings.data_dir / rel).parent.mkdir(parents=True, exist_ok=True)
    (settings.data_dir / rel).write_bytes(raw)
    doc = Document(fiscal_year_id=fy.id, kind=kind, filename=path.name, content_type=None, size=len(raw), sha256=digest,
                   storage_path=str(rel), uploaded_by=user.id)
    db.add(doc)
    db.flush()
    return doc


def _import(settings: Settings, db: Session, fy: FiscalYear, kind: str, path: Path, user: User) -> None:
    doc = _store(settings, db, fy, kind, path, user)
    rows, info = importer.read_table(path.name, path.read_bytes())
    det = importer.detect(kind, rows)
    batch = ImportBatch(fiscal_year_id=fy.id, document_id=doc.id, kind=kind, detected={**det, 'file': info},
                        mapping=det['mapping'], created_by=user.id)
    db.add(batch)
    db.flush()
    if kind == 'trial_balance':
        parsed = importer.parse_trial_balance(rows, det['header_row'], det['mapping'])
        n = apply_trial_balance(db, fy, batch.id, parsed)
    else:
        parsed = importer.parse_journal(rows, det['header_row'], det['mapping'])
        n = apply_journal(db, fy, batch.id, parsed)
    batch.status, batch.row_count = 'imported', n


def _section(db: Session, fy: FiscalYear, section: str, data: dict, user: User) -> None:
    db.add(InputSection(fiscal_year_id=fy.id, section=section, data=validate_section(section, data), updated_by=user.id))


def _company(db: Session, users: dict[str, User], **kw) -> Company:
    c = Company(assigned_user_id=users['staff'].id, **kw)
    db.add(c)
    db.flush()
    for u in users.values():
        if u.role != 'admin':
            db.add(CompanyMember(company_id=c.id, user_id=u.id))
    return c


def seed_demo(db: Session, settings: Settings) -> None:
    users = _users(db)
    if db.scalar(select(Company.id).limit(1)) is not None:
        db.commit()
        return
    staff = users['staff']

    # 1 株式会社みなと企画（架空）：9月決算、黒字、税務調整・繰越欠損金・源泉所得税・延滞税あり
    c = _company(db, users, name='株式会社みなと企画（架空）', name_kana='ミナトキカク', corp_kind='kabushiki',
                 head_office_address='東京都港区芝浦一丁目（架空）', prefecture='東京都', municipality='港区',
                 representative='港 太郎（架空）', industry='広告企画', business_description='販促物の企画・制作（架空）',
                 established_on=date(2015, 10, 1), fiscal_year_end_month=9)
    fy = FiscalYear(company_id=c.id, start_date=date(2025, 10, 1), end_date=date(2026, 9, 30), capital_end=5_000_000,
                    large_corp_subsidiary=False, tekiyo_jogai=False, dividends=0, status='adjusting', reviewer_id=users['reviewer'].id)
    db.add(fy)
    db.flush()
    d = SAMPLES / 'minato'
    _import(settings, db, fy, 'trial_balance', d / '試算表_貸借対照表_2026-09.csv', staff)
    _import(settings, db, fy, 'trial_balance', d / '試算表_損益計算書_2026-09.csv', staff)
    _import(settings, db, fy, 'journal', d / '仕訳帳_2025-10_2026-09.csv', staff)
    prior = '2024-10-01〜2025-09-30'
    _section(db, fy, 'tax_payments', {
        'payments': [
            {'tax': 'national', 'period': 'prior', 'label': prior, 'opening_unpaid': 463_200, 'paid_provision': 463_200},
            {'tax': 'prefectural', 'period': 'prior', 'label': prior, 'opening_unpaid': 105_000, 'paid_provision': 105_000},
            {'tax': 'enterprise', 'period': 'prior', 'label': prior, 'opening_unpaid': 180_000, 'paid_provision': 180_000},
            {'tax': 'national', 'period': 'interim', 'paid_expense': 231_600},
            {'tax': 'prefectural', 'period': 'interim', 'accrued': 52_500, 'paid_expense': 52_500},
            {'tax': 'enterprise', 'period': 'interim', 'accrued': 90_000, 'paid_expense': 90_000},
            {'tax': 'other', 'period': 'other', 'label': '延滞税', 'other_kind': 'nondeductible', 'opening_unpaid': 0,
             'accrued': 12_000, 'paid_expense': 12_000},
        ],
        'interim_corporate_tax': 210_000, 'interim_local_corporate_tax': 21_600, 'interim_defense_tax': 0}, staff)
    _section(db, fy, 'provision', {'provision_charged': 400_000, 'confirmed': True}, staff)
    _section(db, fy, 'local_taxes', {'final_prefectural': 57_100, 'final_municipal': 0, 'final_enterprise': None,
                                      'source_note': 'サンプル用の仮の金額（地方税の計算は Phase 3 で実装予定）'}, staff)
    _section(db, fy, 'withholding', {'items': [{'category': 'interest', 'payer': '架空銀行', 'gross_income': 20_000,
                                                'tax_withheld': 3_063, 'booking': 'expense', 'received_on': '2026-03-20'}]}, staff)
    _section(db, fy, 'entertainment', {'rows': [{'account': '交際費', 'spent': 1_500_000, 'excluded': 0, 'food': 900_000}],
                                       'reviewed_small_meals': False}, staff)
    _section(db, fy, 'opening_meta', {'losses_confirmed': True, 'prior_retained_total': 8_271_800,
                                      'prior_unpaid_national': 463_200}, staff)
    db.add(CarryforwardItem(fiscal_year_id=fy.id, kind='retained', key='depreciation_excess', name='減価償却超過額',
                            amount=150_000, source='manual', confirmed=True, confirmed_by=staff.id))
    db.add(CarryforwardItem(fiscal_year_id=fy.id, kind='loss', name='2021-10-01〜2022-09-30 の欠損金', amount=500_000,
                            loss_fy_start=date(2021, 10, 1), loss_fy_end=date(2022, 9, 30), source='manual', confirmed=True,
                            confirmed_by=staff.id))
    db.add(TaxAdjustment(fiscal_year_id=fy.id, kind='depreciation_reversal', name='減価償却超過額の当期認容額', line='12',
                         direction='deduct', disposition='ryuho', amount=50_000, status='review', decision='adopted',
                         five1_key='depreciation_excess', five1_name='減価償却超過額', five1_column='decrease',
                         reason='前期以前の償却超過額150,000円のうち、当期の償却不足額の範囲で認容（サンプル。固定資産台帳で要確認）',
                         basis=['法人税法第31条'], origin='user', created_by=staff.id, updated_by=staff.id))
    db.flush()
    sync_candidates(db, fy, analyze(db, fy.id, fy.dividends), staff.id)
    db.add(StatusHistory(fiscal_year_id=fy.id, from_status=None, to_status='adjusting', changed_by=staff.id))

    # 2 合同会社さくら研究所（架空）：設立初年度（6か月）、防衛特別法人税の課税事業年度、税額の計上前
    c2 = _company(db, users, name='合同会社さくら研究所（架空）', name_kana='サクラケンキュウジョ', corp_kind='godo',
                  head_office_address='神奈川県川崎市中原区（架空）', prefecture='神奈川県', municipality='川崎市',
                  representative='桜 花子（架空）', industry='学術研究', business_description='材料の分析受託（架空）',
                  established_on=date(2026, 4, 1), fiscal_year_end_month=9)
    fy2 = FiscalYear(company_id=c2.id, start_date=date(2026, 4, 1), end_date=date(2026, 9, 30), capital_end=3_000_000,
                     large_corp_subsidiary=False, tekiyo_jogai=False, dividends=0, status='data_loaded')
    db.add(fy2)
    db.flush()
    d2 = SAMPLES / 'sakura'
    _import(settings, db, fy2, 'trial_balance', d2 / '残高試算表_2026-09.xlsx', staff)
    _import(settings, db, fy2, 'journal', d2 / '仕訳帳_2026-04_2026-09_sjis.csv', staff)
    _section(db, fy2, 'provision', {'provision_charged': 0, 'confirmed': True}, staff)
    _section(db, fy2, 'local_taxes', {'final_prefectural': 41_500, 'final_municipal': 214_100,
                                       'source_note': 'サンプル用の仮の金額（地方税の計算は Phase 3 で実装予定）'}, staff)
    _section(db, fy2, 'withholding', {'items': [], 'none_confirmed': True}, staff)
    _section(db, fy2, 'opening_meta', {'losses_confirmed': True, 'first_year': True, 'prior_retained_total': 0}, staff)
    db.flush()
    sync_candidates(db, fy2, analyze(db, fy2.id, fy2.dividends), staff.id)
    db.add(StatusHistory(fiscal_year_id=fy2.id, from_status=None, to_status='data_loaded', changed_by=staff.id))

    # 3 株式会社やまびこ商店（架空）：未着手（資料なし）
    c3 = _company(db, users, name='株式会社やまびこ商店（架空）', name_kana='ヤマビコショウテン', corp_kind='kabushiki',
                  head_office_address='長野県大町市（架空）', prefecture='長野県', municipality='大町市',
                  industry='小売', fiscal_year_end_month=6)
    fy3 = FiscalYear(company_id=c3.id, start_date=date(2025, 7, 1), end_date=date(2026, 6, 30), status='not_started')
    db.add(fy3)
    db.flush()
    db.add(StatusHistory(fiscal_year_id=fy3.id, from_status=None, to_status='not_started', changed_by=staff.id))
    db.commit()

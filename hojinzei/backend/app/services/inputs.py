"""「税額の基礎」の入力（input_sections の JSON）の形と検証。"""
from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

Yen = Optional[int]


class TaxPaymentIn(BaseModel):
    tax: Literal['national', 'prefectural', 'municipal', 'enterprise', 'other']
    period: Literal['prior', 'interim', 'other'] = 'prior'
    label: str = ''
    other_kind: Literal['', 'deductible', 'nondeductible'] = ''
    opening_unpaid: Yen = 0
    accrued: Yen = 0
    paid_provision: Yen = 0
    paid_suspense: Yen = 0
    paid_expense: Yen = 0


class TaxPaymentsSection(BaseModel):
    """別表五(二)：前期分・当期中間分・その他の租税公課の納付。"""
    payments: list[TaxPaymentIn] = Field(default_factory=list)
    interim_corporate_tax: Yen = 0
    interim_local_corporate_tax: Yen = 0
    interim_defense_tax: Yen = 0


class ProvisionSection(BaseModel):
    """納税充当金。"""
    provision_charged: Yen = None  # 損金経理をした納税充当金（31）
    provision_other_charged: Yen = 0
    provision_suspense_cleared: Yen = 0
    confirmed: bool = False


class LocalTaxesSection(BaseModel):
    """当期確定分の地方税（Phase 2 は手入力）。"""
    final_prefectural: Yen = None
    final_municipal: Yen = None
    final_enterprise: Yen = None
    source_note: str = ''


class WithholdingIn(BaseModel):
    category: Literal['interest', 'dividend', 'investment_trust', 'discount_bond', 'other']
    payer: str
    gross_income: Yen = None
    tax_withheld: Yen = None
    booking: Literal['expense', 'net', 'suspense'] = 'expense'
    method: Literal['full', 'individual', 'simplified'] = 'full'
    calc_months: Optional[int] = None
    owned_months: Optional[int] = None
    received_on: Optional[date] = None


class WithholdingSection(BaseModel):
    items: list[WithholdingIn] = Field(default_factory=list)
    none_confirmed: bool = False  # 源泉徴収された所得税はないことを確認した


class EntertainmentRowIn(BaseModel):
    account: str
    spent: Yen = None
    excluded: Yen = 0
    food: Yen = None


class EntertainmentSection(BaseModel):
    rows: list[EntertainmentRowIn] = Field(default_factory=list)
    reviewed_small_meals: bool = False


class OpeningMetaSection(BaseModel):
    """期首情報の確認。"""
    losses_confirmed: bool = False
    prior_retained_total: Yen = None  # 前期の別表五(一)「31④」
    prior_unpaid_national: Yen = None  # 前期の別表五(二)「5⑥」
    first_year: bool = False  # 設立初年度（前期がない）
    prior_provision_close: Yen = None  # 前期の別表五(二)「41」（期首の未払法人税等との照合）


SECTIONS: dict[str, type[BaseModel]] = {
    'tax_payments': TaxPaymentsSection,
    'provision': ProvisionSection,
    'local_taxes': LocalTaxesSection,
    'withholding': WithholdingSection,
    'entertainment': EntertainmentSection,
    'opening_meta': OpeningMetaSection,
}


def validate_section(section: str, data: dict) -> dict:
    model = SECTIONS.get(section)
    if model is None:
        raise ValueError(f'不明な入力区分：{section}')
    return model.model_validate(data).model_dump(mode='json')


def default_section(section: str) -> dict:
    return SECTIONS[section]().model_dump(mode='json')

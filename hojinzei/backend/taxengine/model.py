"""計算エンジンの入力。DB や画面に依存しない dataclass。

金額は整数円。None は「未確定」（資料がない・判断できない）で、0円とは区別する。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Optional

from .cells import Override
from .money import Yen

# 別表四の行と、その行で使える処分（様式の「③社外流出」欄の区分）
B4_LINES: dict[str, dict] = {
    '6': {'label': '減価償却の償却超過額', 'direction': 'add', 'dispositions': ('ryuho',)},
    '7': {'label': '役員給与の損金不算入額', 'direction': 'add', 'dispositions': ('sonota',)},
    '8': {'label': '交際費等の損金不算入額', 'direction': 'add', 'dispositions': ('sonota',)},
    '10': {'label': 'その他の加算', 'direction': 'add', 'dispositions': ('ryuho', 'sonota', 'haitou', 'kome')},
    '12': {'label': '減価償却超過額の当期認容額', 'direction': 'deduct', 'dispositions': ('ryuho',)},
    '14': {'label': '受取配当等の益金不算入額', 'direction': 'deduct', 'dispositions': ('kome',)},
    '16': {'label': '受贈益の益金不算入額', 'direction': 'deduct', 'dispositions': ('kome',)},
    '18': {'label': '法人税等の中間納付額及び過誤納に係る還付金額', 'direction': 'deduct', 'dispositions': ('ryuho',)},
    '19': {'label': '所得税額等及び欠損金の繰戻しによる還付金額等', 'direction': 'deduct', 'dispositions': ('kome',)},
    '21': {'label': 'その他の減算', 'direction': 'deduct', 'dispositions': ('ryuho', 'sonota', 'kome')},
    '27': {'label': '寄附金の損金不算入額', 'direction': 'add', 'dispositions': ('sonota',)},
}
# エンジンが別表五(二)・六(一)・十五から作る行（利用者の税務調整では使わない）
B4_ENGINE_LINES = {'2', '3', '4', '5', '8', '13', '29'}
DISPOSITIONS = {'ryuho': '留保', 'sonota': '社外流出（その他）', 'haitou': '社外流出（配当）', 'kome': '社外流出（※）'}
ADJ_STATUSES = {'auto': '自動確定可能', 'review': '要確認', 'missing': '資料不足', 'unsupported': '対象外・未対応'}


@dataclass
class Period:
    start: date
    end: date


@dataclass
class Profile:
    corp_kind: str = 'kabushiki'  # kabushiki 株式会社 | godo 合同会社 | other
    ordinary: bool = True  # 普通法人
    capital_end: Yen = None  # 期末資本金の額又は出資金の額
    large_corp_subsidiary: Optional[bool] = None  # 大法人による完全支配関係等（法人税法第66条第5項第2号・第3号）
    tekiyo_jogai: Optional[bool] = None  # 適用除外事業者（租税特別措置法第42条の4第19項第8号）
    group_tsusan: bool = False
    blue_return: bool = True
    return_kind: str = 'final'  # final 確定 | amended 修正 | interim 中間
    # 当期にあると利用者が答えた、未対応の論点のキー（foreign_tax_credit など）
    unsupported_features: list[str] = field(default_factory=list)


@dataclass
class ReserveRow:
    name: str
    open: Yen
    close: Yen


@dataclass
class Financials:
    net_income: Yen  # 損益計算書の当期純利益（税引後。損失はマイナス）
    dividends: Yen = 0  # 当期に効力が生じた剰余金の配当（別表四「1」③配当）
    retained_earnings_open: Yen = None  # 繰越利益剰余金 期首
    retained_earnings_close: Yen = None  # 繰越利益剰余金 期末（当期純損益を含む）
    legal_reserve_open: Yen = 0  # 利益準備金
    legal_reserve_close: Yen = 0
    reserves: list[ReserveRow] = field(default_factory=list)  # 別途積立金など
    tax_provision_open: Yen = None  # 未払法人税等（納税充当金）期首
    tax_provision_close: Yen = None  # 未払法人税等 期末（照合用）
    capital_rows: list[ReserveRow] = field(default_factory=list)  # 資本金・資本準備金など（別表五(一)Ⅱ）


@dataclass
class Adjustment:
    id: str
    name: str
    line: str  # 別表四の行
    direction: str  # add | deduct
    disposition: str  # ryuho | sonota | haitou | kome
    amount: Yen
    status: str = 'review'
    five1_key: Optional[str] = None  # 留保のとき別表五(一)の行
    five1_name: Optional[str] = None
    five1_column: str = 'increase'  # increase ③増 | decrease ②減
    basis: tuple[str, ...] = ()
    origin: str = 'user'  # user | engine
    note: str = ''
    confirmed: bool = False  # 担当者が内容を確認した


@dataclass
class TaxPayment:
    """別表五(二)の1行。"""
    tax: str  # national | prefectural | municipal | enterprise | other
    period: str  # prior 前期以前 | interim 当期中間 | final 当期確定 | other
    label: str = ''  # 事業年度の表示、その他の税目の名称
    other_kind: str = ''  # tax=other のとき deductible 損金算入 | nondeductible 損金不算入
    opening_unpaid: Yen = 0  # ① 期首現在未納税額
    accrued: Yen = 0  # ② 当期発生税額（当期中間・その他）
    paid_provision: Yen = 0  # ③ 充当金取崩しによる納付
    paid_suspense: Yen = 0  # ④ 仮払経理による納付
    paid_expense: Yen = 0  # ⑤ 損金経理による納付


@dataclass
class TaxInputs:
    payments: list[TaxPayment] = field(default_factory=list)
    interim_corporate_tax: Yen = 0  # 別表一「14」中間申告分の法人税額
    interim_local_corporate_tax: Yen = 0  # 「39」
    interim_defense_tax: Yen = 0  # 次葉一「58」
    provision_charged: Yen = None  # 五(二)「31」損金経理をした納税充当金
    provision_other_charged: Yen = 0  # 「32」
    provision_suspense_cleared: Yen = 0  # 「39」仮払税金消却
    final_prefectural: Yen = None  # 当期確定の道府県民税（Phase 2 は入力）
    final_municipal: Yen = None  # 当期確定の市町村民税（Phase 2 は入力）
    final_enterprise: Yen = None  # 当期確定の事業税・特別法人事業税（参考：翌期に損金）


@dataclass
class WithholdingItem:
    """別表六(一)の1件。"""
    category: str  # interest 1 | dividend 2 | investment_trust 3 | discount_bond 4 | other 5
    payer: str
    gross_income: Yen  # ① 収入金額
    tax_withheld: Yen  # ② 所得税額（復興特別所得税を含む）
    booking: str = 'expense'  # expense 費用計上 | net 受取額から差引 | suspense 仮払経理
    method: str = 'full'  # full 全額 | individual 個別法 | simplified 銘柄別簡便法（未対応）
    calc_months: Optional[int] = None  # 配当等の計算期間（月）
    owned_months: Optional[int] = None  # うち元本所有期間（月）
    received_on: Optional[date] = None


@dataclass
class EntertainmentRow:
    account: str
    spent: Yen  # 6 支出額
    excluded: Yen = 0  # 7 交際費等の額から控除される費用の額
    food: Yen = 0  # 9 (8)のうち接待飲食費の額


@dataclass
class EntertainmentInput:
    rows: list[EntertainmentRow] = field(default_factory=list)
    reviewed_small_meals: bool = False  # 1人10,000円以下の飲食費を除いたか確認した


@dataclass
class OpeningRetainedItem:
    key: str
    name: str
    amount: Yen  # 別表五(一) 期首①


@dataclass
class LossCarryforward:
    fy_start: date
    fy_end: date
    amount: Yen  # 控除未済欠損金額
    kind: str = 'blue'  # blue 青色欠損金 | disaster 災害損失（未対応）


@dataclass
class Opening:
    retained_items: list[OpeningRetainedItem] = field(default_factory=list)  # 五(一)の3〜24行の期首
    prior_retained_total: Yen = None  # 前期の別表五(一)「31④」（連続性の確認）
    prior_unpaid_national: Yen = None  # 前期の五(二)⑥（連続性の確認）
    losses: list[LossCarryforward] = field(default_factory=list)
    losses_confirmed: bool = False  # 期首の繰越欠損金を確認した（ない場合も含む）


@dataclass
class ReturnInput:
    company_name: str
    period: Period
    profile: Profile
    financials: Financials
    adjustments: list[Adjustment] = field(default_factory=list)
    taxes: TaxInputs = field(default_factory=TaxInputs)
    withholding: list[WithholdingItem] = field(default_factory=list)
    entertainment: Optional[EntertainmentInput] = None
    opening: Opening = field(default_factory=Opening)
    overrides: dict[str, Override] = field(default_factory=dict)
    # 試算表などから分かる手がかり（必要な別表の判定に使う）
    # has_depreciation, has_donations, has_dividend_income, has_entertainment_account など
    hints: dict[str, bool] = field(default_factory=dict)

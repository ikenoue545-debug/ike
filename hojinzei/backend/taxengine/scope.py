"""対象範囲の判定と、中小法人の判定。

初期対応の範囲外は自動計算をせず、重大エラー（対象外・未対応）として確定を止める。
"""
from __future__ import annotations

from typing import Optional

from .cells import Ctx
from .model import ReturnInput

SME_CAPITAL_LIMIT = 100_000_000  # 法人税法第66条第2項・第5項

# 利用者が「当期にある」と答えたら止める論点
UNSUPPORTED_FEATURES: dict[str, tuple[str, str]] = {
    'foreign_tax_credit': ('外国税額控除', '別表六(二)以下が必要です。'),
    'special_tax_credit': ('法人税額の特別控除（賃上げ促進税制・研究開発税制など）', '別表六(六)以下が必要です。'),
    'land_transfer': ('土地譲渡利益金額に対する税額', '別表三(二)以下が必要です。'),
    'retained_earnings_tax': ('特定同族会社の留保金課税', '別表三(一)が必要です。'),
    'multi_jurisdiction': ('複数の都道府県・市町村にある事務所・事業所', '地方税の分割基準の自動計算は未対応です。'),
    'loss_carryback': ('欠損金の繰戻しによる還付', '別表七(一)の繰戻し欄・還付請求書が必要です。'),
    'disaster_loss': ('災害損失欠損金', '別表七(一)の災害損失の欄が必要です。'),
    'reorganization': ('合併・分割などの組織再編', '欠損金の引継ぎ等の計算が必要です。'),
    'dividend_simplified': ('受取配当等の所得税額の銘柄別簡便法', '別表六(一)の簡便法の欄が必要です。'),
}


def check_scope(ctx: Ctx, inp: ReturnInput) -> None:
    p = inp.profile
    tgt = [{'type': 'page', 'page': 'company'}]
    if not p.ordinary:
        ctx.finding('SCOPE_NOT_ORDINARY', 'critical', '対象範囲', '普通法人以外は未対応です',
                    '公益法人等・協同組合等・人格のない社団等の計算は実装していません。',
                    '本システムでは確定できません。別の方法で作成してください。', tgt)
    if p.group_tsusan:
        ctx.finding('SCOPE_TSUSAN', 'critical', '対象範囲', 'グループ通算制度は未対応です',
                    '通算法人は別表一付表・別表四付表・別表七(二)などが必要です。',
                    '本システムでは確定できません。', tgt)
    if p.return_kind != 'final':
        ctx.finding('SCOPE_RETURN_KIND', 'critical', '対象範囲', '確定申告以外は未対応です',
                    '修正申告・中間申告（仮決算）の計算は実装していません。',
                    '申告区分を「確定」にするか、別の方法で作成してください。', tgt)
    if not p.blue_return:
        ctx.finding('SCOPE_WHITE', 'critical', '対象範囲', '白色申告は未対応です',
                    '白色申告は欠損金の繰越しの扱いと別表一の様式が異なります。', '本システムでは確定できません。', tgt)
    for key in p.unsupported_features:
        title, why = UNSUPPORTED_FEATURES.get(key, (key, ''))
        ctx.finding(f'SCOPE_FEATURE_{key.upper()}', 'critical', '対象範囲', f'{title}は未対応です',
                    f'当期に「{title}」があると入力されています。{why}',
                    '本システムでは確定できません。該当がない場合は会社情報の「対象外の論点」を直してください。', tgt)
    if p.capital_end is not None and p.capital_end > SME_CAPITAL_LIMIT:
        ctx.finding('SCOPE_LARGE_CAPITAL', 'critical', '対象範囲', '期末資本金1億円超の法人は初期対応の範囲外です',
                    '外形標準課税・留保金課税・欠損金の控除限度などの扱いが変わります。',
                    '本システムでは確定できません。', tgt)


def is_sme(ctx: Ctx, inp: ReturnInput) -> Optional[bool]:
    """中小法人（法人税法第66条第2項・第5項）か。判断できなければ None。"""
    p = inp.profile
    tgt = [{'type': 'page', 'page': 'company'}]
    if p.capital_end is None:
        ctx.finding('SME_CAPITAL_UNKNOWN', 'critical', '資料不足', '期末資本金の額が未入力です',
                    '中小法人の判定（軽減税率・交際費・欠損金の控除限度）に必要です。',
                    '年度の基本情報に期末資本金の額を入力してください。', tgt)
        return None
    if p.capital_end > SME_CAPITAL_LIMIT:
        return False
    if p.large_corp_subsidiary is None:
        ctx.finding('SME_LARGE_PARENT_UNKNOWN', 'critical', '資料不足', '大法人の100%子会社等に当たるか未確認です',
                    '資本金5億円以上の法人などに発行済株式の全部を直接・間接に保有されていると、資本金1億円以下でも中小法人になりません'
                    '（法人税法第66条第5項第2号・第3号）。',
                    '株主構成を確認し、年度の基本情報で「該当しない／該当する」を選んでください。', tgt)
        return None
    return not p.large_corp_subsidiary

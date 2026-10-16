"""別表間の整合性チェックと、必要な別表の判定。"""
from __future__ import annotations

from .cells import Ctx
from .model import ReturnInput

B4_DISP = ('ryuho', 'haitou', 'sonota', 'kome')


def cross_checks(ctx: Ctx, inp: ReturnInput) -> None:
    # 別表四：各行で ① ＝ ② ＋ ③（配当・その他・※）
    for key, cell in list(ctx.cells.items()):
        if cell.schedule != 'b4' or cell.col != 'total' or cell.value is None:
            continue
        parts = [ctx.cells.get(f'b4:{cell.line}:{c}') for c in B4_DISP]
        vals = [p.value for p in parts if p is not None]
        if any(p is not None and p.value is None for p in parts):
            continue
        if vals and sum(vals) != cell.value:
            ctx.finding('B4_ROW_BALANCE', 'critical', '数値', f'別表四「{cell.line}」の①と②＋③が一致しません',
                        f'①総額 {cell.value:,} 円、②＋③ {sum(vals):,} 円。',
                        '上書きした欄がないか確認してください。', [{'type': 'cell', 'key': key}])

    # 別表四「52」と別表一「1」
    b4_52, b1_1 = ctx.val('b4:52:total'), ctx.val('b1:1:value')
    if b4_52 is not None and b1_1 is not None and b4_52 != b1_1:
        ctx.finding('B1_B4_INCOME', 'critical', '数値', '別表一「1」と別表四「52の①」が一致しません',
                    f'別表一 {b1_1:,} 円、別表四 {b4_52:,} 円。', '上書きを確認してください。',
                    [{'type': 'cell', 'key': 'b1:1:value'}])

    # 別表六(一)「6の③」と別表四「29」・別表一「16」
    c6 = ctx.val('b6_1:6:3')
    for key, name in (('b4:29:total', '別表四「29」'), ('b1:16:value', '別表一「16」')):
        v = ctx.val(key)
        if c6 is not None and v is not None and v != c6:
            ctx.finding('B6_1_LINK', 'critical', '数値', f'{name}と別表六(一)「6の③」が一致しません',
                        f'{name} {v:,} 円、別表六(一) {c6:,} 円。', '上書きを確認してください。', [{'type': 'cell', 'key': key}])

    # 別表十五「5」と別表四「8」
    e5, b8 = ctx.val('b15:5:value'), ctx.val('b4:8:total')
    if e5 is not None and b8 is not None and e5 != b8:
        ctx.finding('B15_LINK', 'critical', '数値', '別表四「8」と別表十五「5」が一致しません',
                    f'別表四 {b8:,} 円、別表十五 {e5:,} 円。', '上書きを確認してください。', [{'type': 'cell', 'key': 'b4:8:total'}])

    # 別表七(一) と別表四「44」
    l44, l4 = ctx.val('b4:44:total'), ctx.val('b7_1:4:total')
    if l44 is not None and l4 is not None and -l44 != l4:
        ctx.finding('B7_1_LINK', 'critical', '数値', '別表四「44」と別表七(一)「4の計」が一致しません',
                    f'別表四 {l44:,} 円、別表七(一) {l4:,} 円。', '上書きを確認してください。', [{'type': 'cell', 'key': 'b4:44:total'}])

    # 損益計算書と貸借対照表（繰越利益剰余金の増減）
    f = inp.financials
    if None not in (f.net_income, f.retained_earnings_open, f.retained_earnings_close, f.dividends):
        reserves_delta = (f.legal_reserve_close or 0) - (f.legal_reserve_open or 0) + sum(
            (r.close or 0) - (r.open or 0) for r in f.reserves)
        expected = f.retained_earnings_open + f.net_income - f.dividends - reserves_delta
        if expected != f.retained_earnings_close:
            ctx.finding('FIN_RE_MOVEMENT', 'warning', '数値', '繰越利益剰余金の増減が当期純利益・配当と合いません',
                        f'期首 {f.retained_earnings_open:,} ＋ 当期純利益 {f.net_income:,} − 配当 {f.dividends:,} − 利益準備金等の積立 '
                        f'{reserves_delta:,} ＝ {expected:,} 円ですが、期末は {f.retained_earnings_close:,} 円です。',
                        '株主資本等変動計算書（配当・積立金の取崩しなど）を確認し、配当の額を入力してください。',
                        [{'type': 'page', 'page': 'trial-balance'}])

    # 期首の未納法人税等と前期の期末
    prior = inp.opening.prior_unpaid_national
    cur = ctx.val('b5_2:5:1') if ctx.has('b5_2:5:1') else None
    if prior is not None and cur is not None and prior != cur:
        ctx.finding('B5_2_CONTINUITY', 'critical', '期首情報', '期首の未納法人税等が前期の期末と一致しません',
                    f'前期の別表五(二)「5の⑥」{prior:,} 円、当期の期首未納 {cur:,} 円。',
                    '前期確定分の法人税等の額を確認してください。', [{'type': 'page', 'page': 'tax-inputs', 'section': 'payments'}])

    # 還付
    refund = ctx.val('b1:24:value')
    if refund:
        ctx.finding('B1_REFUND', 'info', '申告', f'法人税の還付金額が {refund:,} 円あります',
                    '所得税額控除の控除しきれない額、または中間納付額の還付です。',
                    '別表一の「還付を受けようとする金融機関等」の欄を記入してください（本システムでは未入力）。'
                    '会計上の未収還付法人税等の計上と、翌期の別表四の減算（「18」「19」）に注意してください。',
                    [{'type': 'cell', 'key': 'b1:24:value'}])


def required_schedules(ctx: Ctx, inp: ReturnInput, defense_applicable: bool) -> list[dict]:
    """必要な別表と、このシステムでの対応状況。"""
    h = inp.hints
    out = []

    def add(form, name, needed, implemented, reason, view=None):
        out.append({'form': form, 'name': name, 'needed': needed, 'implemented': implemented,
                    'reason': reason, 'view': view})

    add('別表一', '各事業年度の所得に係る申告書', True, True, '確定申告書', 'b1')
    add('別表一次葉一', '防衛特別法人税額の計算', defense_applicable, True,
        '令和8年4月1日以後開始事業年度は税額0円でも提出' if defense_applicable else '課税事業年度に当たらない', 'b1n1')
    add('別表一次葉二', '法人税額の計算・地方法人税額の計算', True, True, '税率ごとの法人税額の計算', 'b1n2')
    add('別表二', '同族会社等の判定に関する明細書', True, False, '株式会社・合同会社は株主等の状況を記載（Phase 3 で実装予定）')
    add('別表四', '所得の金額の計算に関する明細書', True, True, '所得金額の計算', 'b4')
    add('別表五(一)', '利益積立金額及び資本金等の額の計算に関する明細書', True, True, '利益積立金額', 'b5_1')
    add('別表五(二)', '租税公課の納付状況等に関する明細書', True, True, '租税公課の納付状況', 'b5_2')
    add('別表六(一)', '所得税額の控除に関する明細書', bool(inp.withholding), True,
        '源泉所得税の控除を受ける' if inp.withholding else '源泉所得税の入力なし', 'b6_1')
    has_loss = bool(inp.opening.losses) or (ctx.val('b4:52:total') or 0) < 0
    add('別表七(一)', '欠損金の損金算入等に関する明細書', has_loss, True,
        '繰越欠損金又は当期の欠損金がある' if has_loss else '欠損金なし', 'b7_1')
    has_ent = bool(inp.entertainment and inp.entertainment.rows)
    add('別表十五', '交際費等の損金算入に関する明細書', has_ent or bool(h.get('has_entertainment_account')), True,
        '交際費等の支出がある' if has_ent else ('試算表に交際費の科目がある（内訳未入力）' if h.get('has_entertainment_account') else '交際費等なし'),
        'b15')
    add('別表八(一)', '受取配当等の益金不算入に関する明細書', bool(h.get('has_dividend_income')), False,
        '受取配当金の科目がある（益金不算入の計算は Phase 3）' if h.get('has_dividend_income') else '受取配当金なし')
    add('別表十四(二)', '寄附金の損金算入に関する明細書', bool(h.get('has_donations')), False,
        '寄附金の科目がある（Phase 3）' if h.get('has_donations') else '寄附金なし')
    add('別表十六関係', '減価償却資産の償却額の計算に関する明細書', bool(h.get('has_depreciation')), False,
        '減価償却費の計上がある（償却限度額の計算は Phase 3）' if h.get('has_depreciation') else '減価償却費なし')
    sme = ctx.val('b1n2:74:value')
    add('適用額明細書', '租税特別措置法の適用額明細書', bool(sme), False,
        '中小企業者等の法人税率の特例（措法42の3の2）を適用（作成は未対応）' if sme else '租税特別措置の適用なし')
    add('地方税', '法人住民税・事業税の申告書', True, False, '本システムは地方税の申告書を作成しない（Phase 3）')

    for r in out:
        if r['needed'] and not r['implemented']:
            ctx.finding(f'REQ_{r["form"]}', 'warning', '必要書類', f'{r["form"]}が必要ですが、本システムでは作成していません',
                        f'{r["name"]}：{r["reason"]}。', '別の方法で作成して添付してください。',
                        [{'type': 'page', 'page': 'review', 'section': 'required'}])
    return out

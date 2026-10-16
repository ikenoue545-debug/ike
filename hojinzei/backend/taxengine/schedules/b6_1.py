"""別表六(一) 所得税額の控除に関する明細書。

- 1 預貯金の利子等、4 割引債の償還差益、5 その他：控除を受ける所得税額③＝②（全額）
- 2 剰余金の配当等、3 集団投資信託の収益の分配：元本の所有期間で按分（個別法：所有期間割合は
  小数点以下3位未満切上げ、1を超えるときは1）
- 6 計 ③ → 別表一「16」、別表四「29」
所得税額には復興特別所得税を含む（記載の仕方 2）。
"""
from __future__ import annotations

from decimal import Decimal, ROUND_DOWN

from ..cells import Ctx
from ..model import ReturnInput
from ..money import Yen, ceil_ratio, opt_sum

LINES = {
    'interest': ('1', '公社債及び預貯金の利子、合同運用信託、公社債投資信託及び公社債等運用投資信託の収益の分配等'),
    'dividend': ('2', '剰余金の配当、利益の配当、剰余金の分配及び金銭の分配（みなし配当等を除く）'),
    'investment_trust': ('3', '集団投資信託の収益の分配'),
    'discount_bond': ('4', '割引債の償還差益'),
    'other': ('5', 'その他'),
}
BASIS = ['法人税法第68条第1項', '復興財確法第33条第2項', '別表六(一)の記載の仕方']
COLUMNS = [('1', '①収入金額'), ('2', '②①について課される所得税額'), ('3', '③②のうち控除を受ける所得税額')]


def compute(ctx: Ctx, inp: ReturnInput) -> dict:
    """戻り値：credit（6③）、suspense_withheld（仮払経理した源泉所得税）。"""
    view = ctx.view('b6_1', '別表六(一)', '所得税額の控除に関する明細書', COLUMNS)
    items = inp.withholding
    if not items:
        view.status = 'not_required'
        view.status_note = '源泉所得税の入力がありません（受取利息・配当がなければ不要です）。'
        ctx.put('b6_1:6:3', 0, label='控除を受ける所得税額 計', formula='入力なし', basis=BASIS)
        return {'credit': 0, 'suspense_withheld': 0}

    per_line: dict[str, list[tuple[Yen, Yen, Yen]]] = {k: [] for k in LINES}
    detail_rows = []
    suspense = 0
    for i, it in enumerate(items, start=1):
        tgt = [{'type': 'page', 'page': 'tax-inputs', 'section': 'withholding'}]
        if it.category not in LINES:
            ctx.finding('B6_1_CATEGORY', 'critical', '入力', f'源泉所得税の区分が不正です（{it.payer}）',
                        f'区分「{it.category}」は別表六(一)の区分に当たりません。', '区分を選び直してください。', tgt)
            per_line['other'].append((it.gross_income, it.tax_withheld, None))
            continue
        if it.gross_income is None or it.tax_withheld is None:
            ctx.finding('B6_1_MISSING', 'critical', '資料不足', f'源泉所得税の金額が未入力です（{it.payer}）',
                        '収入金額と源泉徴収された所得税額（復興特別所得税を含む）の両方が必要です。',
                        '支払通知書・通帳で確認して入力してください。', tgt)
        credit: Yen
        if it.category in ('interest', 'discount_bond', 'other'):
            credit = it.tax_withheld
        elif it.method == 'simplified':
            ctx.finding('B6_1_SIMPLIFIED', 'critical', '対象範囲', '銘柄別簡便法は未対応です',
                        f'{it.payer} の配当等を銘柄別簡便法で計算する欄は実装していません。',
                        '個別法で計算するか、別の方法で作成してください。', tgt)
            credit = None
        elif it.method == 'individual' or it.method == 'full':
            if not it.calc_months or it.owned_months is None or it.tax_withheld is None:
                ctx.finding('B6_1_PERIOD_MISSING', 'critical', '資料不足', f'配当等の元本所有期間が未入力です（{it.payer}）',
                            '剰余金の配当等の所得税額は、配当計算期間のうち元本を所有していた期間で按分して控除します'
                            '（法人税法第68条第2項、法人税法施行令第140条の2）。',
                            '配当計算期間の月数と、そのうち株式を所有していた月数を入力してください。', tgt)
                credit = None
            else:
                ratio = ceil_ratio(it.owned_months, it.calc_months, 3)
                credit = int((Decimal(it.tax_withheld) * ratio).to_integral_value(rounding=ROUND_DOWN))
                n = len(detail_rows) + 1
                k = f'b6_1:ind{n}'
                ctx.text(f'{k}:name', it.payer, label='銘柄')
                ctx.put(f'{k}:7', it.gross_income, label='収入金額', source='input')
                ctx.put(f'{k}:8', it.tax_withheld, label='所得税額', source='input')
                ctx.put(f'{k}:9', it.calc_months, label='配当等の計算期間（月）', source='input', overridable=False)
                ctx.put(f'{k}:10', it.owned_months, label='(9)のうち元本所有期間（月）', source='input', overridable=False)
                ctx.text(f'{k}:11', str(ratio), label='所有期間割合', formula='(10)/(9)（小数点以下3位未満切上げ）', unit='rate')
                ctx.put(f'{k}:12', credit, label='控除を受ける所得税額', formula='(8)×(11)（1円未満切捨て）',
                        refs=[f'{k}:8', f'{k}:11'], basis=['法人税法施行令第140条の2'])
                detail_rows.append(k)
        else:
            credit = None
        if it.booking == 'suspense' and it.tax_withheld is not None:
            suspense += it.tax_withheld
        per_line[it.category].append((it.gross_income, it.tax_withheld, credit))

    for cat, (line, label) in LINES.items():
        rows = per_line[cat]
        income = opt_sum(r[0] for r in rows)
        tax = opt_sum(r[1] for r in rows)
        credit = opt_sum(r[2] for r in rows)
        ctx.put(f'b6_1:{line}:1', income, label=f'{label} 収入金額', source='input')
        ctx.put(f'b6_1:{line}:2', tax, label=f'{label} 所得税額', source='input')
        formula = '②の全額' if cat in ('interest', 'discount_bond', 'other') else '個別法による按分額の合計'
        ctx.put(f'b6_1:{line}:3', credit, label=f'{label} 控除を受ける所得税額', formula=formula,
                refs=[f'b6_1:{line}:2'] + ([f'{k}:12' for k in detail_rows] if cat == 'dividend' else []), basis=BASIS)
        view.row(line, label, {c: f'b6_1:{line}:{c}' for c, _ in COLUMNS})
    for c, name in COLUMNS:
        ctx.put(f'b6_1:6:{c}', opt_sum(ctx.val(f'b6_1:{LINES[k][0]}:{c}') for k in LINES), label=f'計 {name}',
                formula='(1)+(2)+(3)+(4)+(5)', refs=[f'b6_1:{LINES[k][0]}:{c}' for k in LINES], basis=BASIS)
    view.row('6', '計', {c: f'b6_1:6:{c}' for c, _ in COLUMNS}, kind='total')
    for k in detail_rows:
        view.row(k.split(':')[1], '個別法', {'name': f'{k}:name', '7': f'{k}:7', '8': f'{k}:8', '9': f'{k}:9',
                                            '10': f'{k}:10', '11': f'{k}:11', '12': f'{k}:12'}, kind='detail')
    return {'credit': ctx.val('b6_1:6:3'), 'suspense_withheld': suspense}

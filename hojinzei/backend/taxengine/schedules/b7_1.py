"""別表七(一) 欠損金の損金算入等に関する明細書（青色欠損金の繰越控除のみ）。

1 控除前所得金額 ＝ 別表四「43の①」
2 損金算入限度額 ＝ (1) × 50又は100/100
3 控除未済欠損金額、4 当期控除額（古い事業年度から順に、(3) と ((2) − それより前の(4)の合計) の少ない方）
5 翌期繰越額 ＝ (3) − (4)。繰越期間を過ぎるものは翌期へ繰り越さない。
当期分：別表四「52の①」が欠損なら青色欠損金額として翌期へ。
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal, ROUND_DOWN

from ..cells import Ctx
from ..model import LossCarryforward, ReturnInput
from ..money import Yen, opt_sum
from ..periods import add_years
from ..rules.registry import RuleVersion

BASIS = ['法人税法第57条第1項', '別表七(一)の記載の仕方']
COLS = [('fy', '事業年度'), ('kind', '区分'), ('3', '3 控除未済欠損金額'), ('4', '4 当期控除額'), ('5', '5 翌期繰越額')]


def _k(line: str, col: str) -> str:
    return f'b7_1:{line}:{col}'


def _carry_years(rule: RuleVersion, loss: LossCarryforward) -> int:
    if loss.fy_start >= date.fromisoformat(rule.get('losses_new_period_from')):
        return int(rule.get('years_for_losses_from_2018_04'))
    return int(rule.get('years_for_losses_before_2018_04'))


def eligible(rule: RuleVersion, loss: LossCarryforward, fy_start: date) -> bool:
    """fy_start に開始する事業年度で控除できるか（開始の日前10年（9年）以内に開始した事業年度の欠損金）。"""
    return loss.fy_start >= add_years(fy_start, -_carry_years(rule, loss)) and loss.fy_start < fy_start


def part_a(ctx: Ctx, inp: ReturnInput, rule: RuleVersion | None, sme: bool | None) -> Yen:
    """戻り値：当期控除額（4の計）。"""
    view = ctx.view('b7_1', '別表七(一)', '欠損金の損金算入等に関する明細書', COLS)
    tgt = [{'type': 'page', 'page': 'opening', 'section': 'losses'}]
    losses = sorted(inp.opening.losses, key=lambda l: l.fy_start)
    if not inp.opening.losses_confirmed:
        ctx.finding('B7_1_NOT_CONFIRMED', 'warning', '期首情報', '期首の繰越欠損金の有無が未確認です',
                    '前期の別表七(一)「5」の翌期繰越額（ない場合は「なし」）を確認していません。',
                    '「期首情報」で繰越欠損金を入力するか「繰越欠損金はない」を確認してください。', tgt)
    l1 = ctx.put(_k('1', 'value'), ctx.val('b4:43:total'), label='控除前所得金額', formula='別表四「43の①」',
                 refs=['b4:43:total'], basis=BASIS)
    if rule is None or not rule.usable:
        ctx.finding('B7_1_RULE', 'critical', 'ルール', '欠損金の繰越控除のルールがこの事業年度に未登録です', '',
                    'ルールデータを確認してください。', [{'type': 'page', 'page': 'rules'}])
        ratio = None
    else:
        ctx.use_rule(rule)
        ratio = None if sme is None else Decimal(rule.get('sme_limit_ratio' if sme else 'non_sme_limit_ratio'))
    if l1 is None or ratio is None:
        l2 = None
    else:
        l2 = int((Decimal(max(l1, 0)) * ratio).to_integral_value(rounding=ROUND_DOWN))
    ctx.put(_k('2', 'value'), l2, label='損金算入限度額',
            formula='(1)×100/100（中小法人等）' if sme else '(1)×50/100', refs=[_k('1', 'value')], basis=BASIS)
    view.row('1', '控除前所得金額（別表四「43の①」）', {'3': _k('1', 'value')})
    view.row('2', '損金算入限度額 (1)×50又は100/100', {'3': _k('2', 'value')})

    if losses and not inp.profile.blue_return:
        ctx.finding('B7_1_WHITE', 'critical', '対象範囲', '白色申告の事業年度は青色欠損金の繰越控除を受けられません', '',
                    '申告区分を確認してください。', tgt)
    used: Yen = 0
    next_start = inp.period.end + timedelta(days=1)
    rows = []
    for i, loss in enumerate(losses, start=1):
        line = f'r{i}'
        label = f'{loss.fy_start.isoformat()}〜{loss.fy_end.isoformat()}'
        ctx.text(_k(line, 'fy'), label, label='事業年度')
        ctx.text(_k(line, 'kind'), '青色欠損' if loss.kind == 'blue' else '災害損失', label='区分')
        if loss.kind != 'blue':
            ctx.finding('B7_1_KIND', 'critical', '対象範囲', '災害損失欠損金は未対応です', '', '別の方法で計算してください。', tgt)
        ok_now = rule is not None and eligible(rule, loss, inp.period.start)
        l3 = ctx.put(_k(line, '3'), loss.amount, label=f'{label} 控除未済欠損金額', source='input',
                     basis=BASIS, notes=[] if ok_now else ['繰越期間を過ぎているため当期は控除できません'])
        if loss.amount is None:
            ctx.finding('B7_1_AMOUNT', 'critical', '資料不足', f'{label}の控除未済欠損金額が未確定です', '',
                        '前期の別表七(一)「5」で確認して入力してください。', tgt)
        if not ok_now:
            ctx.finding('B7_1_EXPIRED', 'info', '期首情報', f'{label}の欠損金は繰越期間を過ぎています',
                        '当期の控除はできません。前期で控除しきれなかった額は切り捨てられています。',
                        '前期の別表七(一)の翌期繰越額に含めていないか確認してください。', tgt)
        if l3 is None or l2 is None or used is None:
            l4 = None
        elif not ok_now:
            l4 = 0
        else:
            l4 = max(0, min(l3, l2 - used))
        ctx.put(_k(line, '4'), l4, label=f'{label} 当期控除額',
                formula='当該事業年度の(3)と((2)−当該事業年度前の(4)の合計額)のうち少ない金額',
                refs=[_k(line, '3'), _k('2', 'value')] + [_k(r, '4') for r in rows], basis=BASIS)
        used = None if used is None or l4 is None else used + l4
        ok_next = rule is not None and eligible(rule, loss, next_start)
        l5 = None if l3 is None or l4 is None else (l3 - l4 if ok_next else 0)
        ctx.put(_k(line, '5'), l5, label=f'{label} 翌期繰越額', formula='(3)−(4)' if ok_next else '繰越期間の満了により0',
                refs=[_k(line, '3'), _k(line, '4')], basis=BASIS)
        rows.append(line)
        view.row(line, label, {c: _k(line, c) for c, _ in COLS})
    for c in ('3', '4', '5'):
        ctx.put(_k('sum', c), opt_sum(ctx.val(_k(r, c)) for r in rows), label=f'計 {dict(COLS)[c]}',
                formula='各事業年度の合計', refs=[_k(r, c) for r in rows], basis=BASIS)
    ctx.put(_k('4', 'total'), ctx.val(_k('sum', '4')), label='当期控除額 計（4の計）', formula='4の計',
            refs=[_k('sum', '4')], basis=BASIS)
    view.row('計', '計', {c: _k('sum', c) for c in ('3', '4', '5')}, kind='subtotal')
    return ctx.val(_k('4', 'total'))


def part_b(ctx: Ctx, inp: ReturnInput) -> Yen:
    """当期分の欠損金と翌期繰越額の合計。戻り値：翌期へ繰り越す欠損金額（5の合計）。"""
    view = ctx.views['b7_1']
    income = ctx.val('b4:52:total')
    loss = None if income is None else max(-income, 0)
    ctx.put(_k('cur', '3'), loss, label='当期分 欠損金額（別表四「52の①」）', formula='別表四「52の①」が欠損のときその額',
            refs=['b4:52:total'], basis=BASIS)
    blue = loss if inp.profile.blue_return else 0
    ctx.put(_k('cur', '5'), blue, label='当期分 青色欠損金額（翌期繰越額）', formula='青色申告のとき当期の欠損金額',
            refs=[_k('cur', '3')], basis=BASIS)
    view.row('当期分', '当期分 欠損金額（同上のうち青色欠損金額）', {'3': _k('cur', '3'), '5': _k('cur', '5')})
    total5 = None if blue is None or ctx.val(_k('sum', '5')) is None else ctx.val(_k('sum', '5')) + blue
    ctx.put(_k('5', 'total'), total5, label='翌期繰越額 合計', formula='5の計＋当期分',
            refs=[_k('sum', '5'), _k('cur', '5')], basis=BASIS)
    view.row('合計', '合計', {'5': _k('5', 'total')}, kind='total')
    return total5

"""別表十五 交際費等の損金算入に関する明細書（租税特別措置法第61条の4）。

1 支出交際費等の額（8の計）
2 支出接待飲食費損金算入基準額 ＝ (9の計) × 50/100
3 中小法人等の定額控除限度額 ＝ (1) と 800万円×月数/12 のうち少ない金額
4 損金算入限度額 ＝ (2) 又は (3)
5 損金不算入額 ＝ (1) − (4) → 別表四「8」
"""
from __future__ import annotations

from ..cells import Ctx
from ..model import ReturnInput
from ..money import Yen, apply_rate, opt_sub, opt_sum, prorate
from ..rules.registry import RuleRegistry

BASIS = ['租税特別措置法第61条の4第1項・第2項', '別表十五の記載の仕方']
DETAIL_COLS = [('name', '科目'), ('6', '支出額'), ('7', '交際費等の額から控除される費用の額'),
               ('8', '差引交際費等の額'), ('9', '(8)のうち接待飲食費の額')]


def compute(ctx: Ctx, inp: ReturnInput, reg: RuleRegistry, months: int, sme: bool | None) -> Yen:
    view = ctx.view('b15', '別表十五', '交際費等の損金算入に関する明細書', [('value', '金額')])
    ent = inp.entertainment
    tgt = [{'type': 'page', 'page': 'tax-inputs', 'section': 'entertainment'}]
    if ent is None or not ent.rows:
        view.status = 'not_required'
        view.status_note = '交際費等の入力がありません。'
        ctx.put('b15:5:value', 0, label='損金不算入額', formula='交際費等の支出なし', basis=BASIS)
        if inp.hints.get('has_entertainment_account'):
            ctx.finding('B15_NOT_ENTERED', 'warning', '税務調整', '交際費の科目に計上がありますが、別表十五の内訳が未入力です',
                        '試算表に交際費等の科目があります。交際費等の損金不算入額を計算するには内訳が必要です。',
                        '「税額の基礎」→「交際費等」で、科目ごとの支出額と接待飲食費の額を入力してください。', tgt)
        return 0

    rule = reg.for_period('entertainment_expenses', inp.period.start, inp.period.end)
    if rule is None or not rule.usable:
        ctx.finding('B15_RULE', 'critical', 'ルール', '交際費等の損金不算入のルールがこの事業年度に未登録・未確認です',
                    '租税特別措置法第61条の4の適用期限（令和9年3月31日までに開始する事業年度）の後か、登録前の年度です。',
                    '一次資料で制度を確認し、ルールデータの版を追加してください。', [{'type': 'page', 'page': 'rules'}])
        ctx.put('b15:5:value', None, label='損金不算入額', formula='ルール未確認のため計算しない', basis=BASIS)
        return None
    ctx.use_rule(rule)

    for i, r in enumerate(ent.rows, start=1):
        k = f'b15:d{i}'
        ctx.text(f'{k}:name', r.account, label='科目')
        ctx.put(f'{k}:6', r.spent, label=f'{r.account} 支出額', source='input')
        ctx.put(f'{k}:7', r.excluded, label=f'{r.account} 控除される費用の額', source='input')
        ctx.put(f'{k}:8', opt_sub(r.spent, r.excluded), label=f'{r.account} 差引交際費等の額', formula='(6)−(7)',
                refs=[f'{k}:6', f'{k}:7'])
        ctx.put(f'{k}:9', r.food, label=f'{r.account} 接待飲食費の額', source='input')
        if r.spent is None or r.excluded is None or r.food is None:
            ctx.finding('B15_MISSING', 'critical', '資料不足', f'交際費等の内訳が未確定です（{r.account}）',
                        '支出額・控除される費用・接待飲食費の額がそろわないと損金不算入額を計算できません。',
                        '仕訳と領収書で確認して入力してください。', tgt)
        elif r.food > r.spent - r.excluded:
            ctx.finding('B15_FOOD_EXCEEDS', 'critical', '入力', f'接待飲食費が差引交際費等の額を超えています（{r.account}）',
                        '「(8)のうち接待飲食費の額」は (8) 以下です。', '金額を確認してください。',
                        tgt + [{'type': 'cell', 'key': f'{k}:9'}])
    n = len(ent.rows)
    d_refs = lambda c: [f'b15:d{i}:{c}' for i in range(1, n + 1)]  # noqa: E731
    total8 = ctx.put('b15:8:total', opt_sum(ctx.val(k) for k in d_refs('8')), label='差引交際費等の額 計',
                     formula='各科目の(8)の合計', refs=d_refs('8'))
    total9 = ctx.put('b15:9:total', opt_sum(ctx.val(k) for k in d_refs('9')), label='接待飲食費の額 計',
                     formula='各科目の(9)の合計', refs=d_refs('9'))

    capital = inp.profile.capital_end
    l1 = ctx.put('b15:1:value', total8, label='支出交際費等の額', formula='(8の計)', refs=['b15:8:total'], basis=BASIS)
    food_ok = capital is not None and capital <= rule.yen('food_ratio_capital_limit')
    if total9 is None:
        l2 = None
    elif food_ok:
        l2, _ = apply_rate(total9, rule.dec('food_deductible_ratio'))
    else:
        l2 = 0
    ctx.put('b15:2:value', l2, label='支出接待飲食費損金算入基準額', formula='(9の計)×50/100（1円未満切捨て）'
            if food_ok else '資本金100億円超のため0', refs=['b15:9:total'], basis=BASIS)
    if sme is None:
        l3 = None
    elif sme:
        limit = prorate(rule.yen('sme_fixed_deduction_annual'), months)
        l3 = None if l1 is None else min(l1, limit)
        ctx.put('b15:3:value', l3, label='中小法人等の定額控除限度額',
                formula=f'(1)と800万円×{months}/12（={limit:,}円）のうち少ない金額', refs=['b15:1:value'], basis=BASIS,
                notes=['月数按分の1円未満は切捨て'] if months != 12 else [])
    else:
        l3 = 0
        ctx.put('b15:3:value', 0, label='中小法人等の定額控除限度額', formula='中小法人等に当たらないため0', basis=BASIS)
    if l2 is None or l3 is None:
        l4 = None
        formula = '(2)又は(3)'
    elif sme:
        l4 = max(l2, l3)
        formula = '(2)又は(3)のうち有利な方（' + ('定額控除限度額' if l3 >= l2 else '接待飲食費の50%') + 'を選択）'
    else:
        l4 = l2
        formula = '(2)'
    ctx.put('b15:4:value', l4, label='損金算入限度額', formula=formula, refs=['b15:2:value', 'b15:3:value'], basis=BASIS)
    l5 = None if l1 is None or l4 is None else max(l1 - l4, 0)
    ctx.put('b15:5:value', l5, label='損金不算入額', formula='(1)−(4)', refs=['b15:1:value', 'b15:4:value'], basis=BASIS)

    for line, label in (('1', '支出交際費等の額（8の計）'), ('2', '支出接待飲食費損金算入基準額（9の計）×50/100'),
                        ('3', '中小法人等の定額控除限度額'), ('4', '損金算入限度額 (2)又は(3)'), ('5', '損金不算入額 (1)−(4)')):
        view.row(line, label, {'value': f'b15:{line}:value'}, kind='total' if line == '5' else 'row')
    for i in range(1, n + 1):
        view.row(f'd{i}', '支出交際費等の額の明細', {c: f'b15:d{i}:{c}' for c, _ in DETAIL_COLS}, kind='detail')
    view.row('計', '支出交際費等の額の明細 計', {'8': 'b15:8:total', '9': 'b15:9:total'}, kind='detail')

    if not ent.reviewed_small_meals:
        ctx.finding('B15_SMALL_MEALS', 'warning', '税務調整', '1人10,000円以下の飲食費を交際費等から除いたか未確認です',
                    '令和6年4月1日以後に支出する飲食費で、参加者1人当たり10,000円以下のもの（社内飲食費を除く）は、'
                    '一定の事項を記載した書類を保存すれば交際費等に含めません（措法61の4、措令37の5。タックスアンサーNo.5265）。',
                    '仕訳の摘要・領収書で確認し、除いた後の額を入力して「確認した」に印を付けてください。', tgt)
    return l5

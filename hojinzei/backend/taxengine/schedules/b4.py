"""別表四 所得の金額の計算に関する明細書（令和8年4月1日以後終了事業年度分）。

列：①総額 ②留保 ③社外流出（配当・その他・※）。各行で ① ＝ ② ＋ ③ となる。
※ は益金不算入・欠損金の控除など、実際には社外に流出しない税務上の加減算（様式の注意書き）。

part_a：1〜43（欠損金控除前）。part_b：44〜52。
"""
from __future__ import annotations

from typing import Optional

from ..cells import Ctx
from ..model import DISPOSITIONS, Adjustment, ReturnInput
from ..money import Yen, opt_add, opt_neg, opt_sub, opt_sum

BASIS = ['法人税法第22条', '別表四の記載の仕方']
COLS = [('total', '①総額'), ('ryuho', '②留保'), ('haitou', '③社外流出 配当'), ('sonota', '③社外流出 その他'),
        ('kome', '③社外流出 ※')]
DISP_COLS = ('ryuho', 'haitou', 'sonota', 'kome')

ADD_FIXED = [
    ('2', '損金経理をした法人税、地方法人税及び防衛特別法人税（附帯税を除く。）', 'ryuho'),
    ('3', '損金経理をした道府県民税及び市町村民税', 'ryuho'),
    ('4', '損金経理をした納税充当金', 'ryuho'),
    ('5', '損金経理をした附帯税（利子税を除く。）、加算金、延滞金（延納分を除く。）及び過怠税', 'sonota'),
    ('6', '減価償却の償却超過額', 'ryuho'),
    ('7', '役員給与の損金不算入額', 'sonota'),
    ('8', '交際費等の損金不算入額', 'sonota'),
]
DEDUCT_FIXED = [
    ('12', '減価償却超過額の当期認容額', 'ryuho'),
    ('13', '納税充当金から支出した事業税等の金額', 'ryuho'),
    ('14', '受取配当等の益金不算入額（別表八(一)「5」）', 'kome'),
    ('16', '受贈益の益金不算入額', 'kome'),
    ('18', '法人税等の中間納付額及び過誤納に係る還付金額', 'ryuho'),
    ('19', '所得税額等及び欠損金の繰戻しによる還付金額等', 'kome'),
]
AFTER_FIXED = [
    ('27', '寄附金の損金不算入額（別表十四(二)「26」又は「42」）', 'sonota'),
    ('29', '法人税額から控除される所得税額（別表六(一)「6の③」）', 'sonota'),
]
FIXED_DISP = {line: disp for line, _, disp in ADD_FIXED + DEDUCT_FIXED + AFTER_FIXED}


def _k(line: str, col: str) -> str:
    return f'b4:{line}:{col}'


def _put_row(ctx: Ctx, line: str, label: str, items: list[Adjustment], disp: Optional[str]) -> list[str]:
    """1行分の欄を作る。戻り値は作った列。"""
    refs = [f'adj:{a.id}' for a in items]
    total = opt_sum(a.amount for a in items)
    notes = [f'{a.name}：{"未確定" if a.amount is None else f"{a.amount:,}円"}（{DISPOSITIONS.get(a.disposition, a.disposition)}）'
             for a in items]
    basis = sorted({b for a in items for b in a.basis}) + BASIS
    formula = '税務調整の合計' if items else '該当なし'
    ctx.put(_k(line, 'total'), total, label=f'{label} ①総額', formula=formula, refs=refs, basis=basis, notes=notes)
    cols = ['total']
    disps = {disp} if disp else {a.disposition for a in items} or {'ryuho'}
    for c in DISP_COLS:
        if c in disps:
            v = opt_sum(a.amount for a in items if (disp or a.disposition) == c) if not disp else total
            ctx.put(_k(line, c), v, label=f'{label} {dict(COLS)[c]}', formula=formula, refs=refs, basis=basis)
            cols.append(c)
    return cols


def _sum_rows(ctx: Ctx, line: str, label: str, parts: list[tuple[int, str]]) -> None:
    """parts：(符号, 行) の並び。各列ごとに加減算する（その行にない列は0）。"""
    for c, cname in COLS:
        vals: list[Yen] = []
        refs = []
        for sign, ln in parts:
            key = _k(ln, c)
            if ctx.has(key):
                v = ctx.val(key)
                vals.append(None if v is None else sign * v)
                refs.append(key)
        formula = ' '.join(('＋' if s > 0 else '−') + f'({ln})' for s, ln in parts).lstrip('＋')
        ctx.put(_k(line, c), opt_sum(vals), label=f'{label} {cname}', formula=formula, refs=refs, basis=BASIS)


def part_a(ctx: Ctx, inp: ReturnInput, adjustments: list[Adjustment]) -> None:
    view = ctx.view('b4', '別表四', '所得の金額の計算に関する明細書', COLS)
    tgt_adj = lambda a: [{'type': 'adjustment', 'id': a.id}]  # noqa: E731

    # 調整の検証
    for a in adjustments:
        if a.amount is None:
            ctx.finding('B4_ADJ_AMOUNT_UNKNOWN', 'critical', '税務調整', f'税務調整「{a.name}」の金額が未確定です',
                        '金額が決まらないと所得金額を計算できません（0円では埋めません）。',
                        '根拠資料を確認して金額を入力するか、調整が不要なら削除してください。', tgt_adj(a))
        if a.status == 'missing':
            ctx.finding('B4_ADJ_MISSING_DOCS', 'critical', '資料不足', f'税務調整「{a.name}」は資料不足です',
                        a.note or '判断に必要な資料がそろっていません。', '必要な資料をそろえて判定を更新してください。', tgt_adj(a))
        elif a.status == 'unsupported':
            ctx.finding('B4_ADJ_UNSUPPORTED', 'critical', '対象範囲', f'税務調整「{a.name}」は未対応の処理です',
                        a.note or '現在の機能では計算できません。', '別の方法で計算し、専門家の確認を受けてください。', tgt_adj(a))
        elif a.status == 'review' and not a.confirmed:
            ctx.finding('B4_ADJ_REVIEW', 'warning', '税務調整', f'税務調整「{a.name}」は担当者の確認待ちです',
                        a.note or '処理案を人が確認していません。', '理由・根拠・金額を確認し「確認済み」にしてください。', tgt_adj(a))
        fixed = FIXED_DISP.get(a.line)
        if fixed and a.disposition != fixed:
            ctx.finding('B4_ADJ_DISPOSITION', 'critical', '税務調整', f'税務調整「{a.name}」の処分が様式と合いません',
                        f'別表四「{a.line}」の処分は「{DISPOSITIONS[fixed]}」です（入力：{DISPOSITIONS.get(a.disposition, a.disposition)}）。',
                        '処分を直してください。', tgt_adj(a))
        # 「2」「3」「4」「13」は別表五(一)の納税充当金・未納法人税等の行に反映するので個別の行は不要
        if a.disposition == 'ryuho' and not a.five1_key and a.line not in ('2', '3', '4', '13'):
            ctx.finding('B4_ADJ_NO_FIVE1', 'critical', '税務調整', f'留保の税務調整「{a.name}」に別表五(一)の行がありません',
                        '留保した調整は別表五(一)の利益積立金額に記載します。', '別表五(一)の行（名称）を指定してください。', tgt_adj(a))

    # 1 当期利益
    f = inp.financials
    ni = f.net_income
    if ni is None:
        ctx.finding('B4_NET_INCOME', 'critical', '資料不足', '当期純利益が不明です',
                    '別表四「1」の当期利益又は当期欠損の額に使います。', '試算表（損益計算書）を取り込んでください。',
                    [{'type': 'page', 'page': 'trial-balance'}])
    ctx.put(_k('1', 'total'), ni, label='当期利益又は当期欠損の額 ①総額', formula='損益計算書の当期純利益（税引後）',
            source='input', basis=BASIS + ['別表四の記載の仕方2'])
    ctx.put(_k('1', 'haitou'), f.dividends, label='当期利益 ③社外流出 配当',
            formula='当期に効力が生じた剰余金の配当', source='input', basis=['別表四の記載の仕方3'])
    ctx.put(_k('1', 'sonota'), 0, label='当期利益 ③社外流出 その他', formula='該当なし')
    ctx.put(_k('1', 'ryuho'), opt_sub(ni, f.dividends), label='当期利益 ②留保', formula='①−③',
            refs=[_k('1', 'total'), _k('1', 'haitou')], basis=BASIS)
    view.row('1', '当期利益又は当期欠損の額', {c: _k('1', c) for c in ('total', 'ryuho', 'haitou', 'sonota')})

    # 加算
    add_lines = []
    for line, label, disp in ADD_FIXED:
        items = [a for a in adjustments if a.line == line]
        cols = _put_row(ctx, line, label, items, disp)
        view.row(line, label, {c: _k(line, c) for c in cols}, indent=1)
        add_lines.append(line)
    for i, a in enumerate([a for a in adjustments if a.line == '10'], start=1):
        line = f'10-{i}'
        cols = _put_row(ctx, line, a.name, [a], None)
        view.row('10', a.name, {c: _k(line, c) for c in cols}, indent=1)
        add_lines.append(line)
    _sum_rows(ctx, '11', '加算 小計', [(1, ln) for ln in add_lines])
    view.row('11', '加算 小計', {c: _k('11', c) for c, _ in COLS}, kind='subtotal')

    # 減算
    ded_lines = []
    for line, label, disp in DEDUCT_FIXED:
        items = [a for a in adjustments if a.line == line]
        cols = _put_row(ctx, line, label, items, disp)
        view.row(line, label, {c: _k(line, c) for c in cols}, indent=1)
        ded_lines.append(line)
    for i, a in enumerate([a for a in adjustments if a.line == '21'], start=1):
        line = f'21-{i}'
        cols = _put_row(ctx, line, a.name, [a], None)
        view.row('21', a.name, {c: _k(line, c) for c in cols}, indent=1)
        ded_lines.append(line)
    _sum_rows(ctx, '22', '減算 小計', [(1, ln) for ln in ded_lines])
    view.row('22', '減算 小計', {c: _k('22', c) for c, _ in COLS}, kind='subtotal')

    _sum_rows(ctx, '23', '仮計', [(1, '1'), (1, '11'), (-1, '22')])
    view.row('23', '仮計 (1)+(11)−(22)', {c: _k('23', c) for c, _ in COLS}, kind='subtotal')
    _sum_rows(ctx, '26', '仮計', [(1, '23')])
    ctx.note(_k('26', 'total'), '対象純支払利子等の損金不算入額（24）・超過利子額の損金算入額（25）は対象外のため0')
    view.row('26', '仮計 ((23)から(25)までの計)', {c: _k('26', c) for c, _ in COLS}, kind='subtotal')

    after = []
    for line, label, disp in AFTER_FIXED:
        items = [a for a in adjustments if a.line == line]
        cols = _put_row(ctx, line, label, items, disp)
        view.row(line, label, {c: _k(line, c) for c in cols}, indent=1)
        after.append(line)
    _sum_rows(ctx, '34', '合計', [(1, '26')] + [(1, ln) for ln in after])
    view.row('34', '合計 (26)+(27)±(28)+(29)+(30)+(31)+(32)±(33)', {c: _k('34', c) for c, _ in COLS}, kind='subtotal')
    _sum_rows(ctx, '39', '差引計', [(1, '34')])
    view.row('39', '差引計 ((34)から(38)までの計)', {c: _k('39', c) for c, _ in COLS}, kind='subtotal')
    _sum_rows(ctx, '43', '差引計', [(1, '39')])
    view.row('43', '差引計 (39)+(40)±(41)+(42)', {c: _k('43', c) for c, _ in COLS}, kind='subtotal')

    known = {line for line, _, _ in ADD_FIXED + DEDUCT_FIXED + AFTER_FIXED} | {'10', '21'}
    for a in adjustments:
        if a.line not in known:
            ctx.finding('B4_ADJ_LINE', 'critical', '税務調整', f'税務調整「{a.name}」の別表四の行（{a.line}）は未対応です',
                        '対応している行：2〜8・10・12〜14・16・18・19・21・27・29。', '行を選び直してください。', tgt_adj(a))


def part_b(ctx: Ctx, loss_deduction: Yen) -> None:
    view = ctx.views['b4']
    ctx.put(_k('44', 'total'), opt_neg(loss_deduction), label='欠損金等の当期控除額 ①総額',
            formula='△ 別表七(一)「4の計」', refs=['b7_1:4:total'], basis=['法人税法第57条第1項'] + BASIS)
    ctx.put(_k('44', 'kome'), opt_neg(loss_deduction), label='欠損金等の当期控除額 ③※', formula='△ 別表七(一)「4の計」',
            refs=['b7_1:4:total'], basis=['法人税法第57条第1項'])
    view.row('44', '欠損金等の当期控除額（別表七(一)「4の計」）', {'total': _k('44', 'total'), 'kome': _k('44', 'kome')}, indent=1)
    _sum_rows(ctx, '45', '総計', [(1, '43'), (1, '44')])
    view.row('45', '総計 (43)+(44)', {c: _k('45', c) for c, _ in COLS}, kind='subtotal')
    _sum_rows(ctx, '52', '所得金額又は欠損金額', [(1, '45')])
    ctx.note(_k('52', 'total'), '「46」〜「51」（新鉱床探鉱費の特別控除など）は対象外のため0')
    view.row('52', '所得金額又は欠損金額', {c: _k('52', c) for c, _ in COLS}, kind='total')

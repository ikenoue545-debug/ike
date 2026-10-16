"""別表五(二) 租税公課の納付状況等に関する明細書。

列：①期首現在未納税額 ②当期発生税額 ③充当金取崩しによる納付 ④仮払経理による納付
    ⑤損金経理による納付 ⑥期末現在未納税額（①＋②−③−④−⑤）

計算は2段階：
- part_a：前期分・当期中間分・その他・納税充当金（30〜41）。別表四の加算・減算の材料を返す。
- part_b：当期確定分（4・9・14）の②と、計の行（5・10・15）。法人税額の計算の後に行う。
"""
from __future__ import annotations

from dataclasses import dataclass, field

from ..cells import Ctx, ViewRow
from ..model import ReturnInput, TaxPayment
from ..money import Yen, opt_add, opt_sub, opt_sum

BASIS = ['別表五(二)の記載の仕方']
COLS = [('1', '①期首現在未納税額'), ('2', '②当期発生税額'), ('3', '③充当金取崩しによる納付'),
        ('4', '④仮払経理による納付'), ('5', '⑤損金経理による納付'), ('6', '⑥期末現在未納税額')]

GROUPS = {
    # tax: (前期以前の行, 当期中間の行, 当期確定の行, 計の行, 名称)
    'national': (('1', '2'), '3', '4', '5', '法人税・地方法人税及び防衛特別法人税'),
    'prefectural': (('6', '7'), '8', '9', '10', '道府県民税'),
    'municipal': (('11', '12'), '13', '14', '15', '市町村民税'),
    'enterprise': (('16', '17'), '18', None, '19', '事業税及び特別法人事業税'),
}
INCOME_TAXES = ('national', 'prefectural', 'municipal')
OTHER_FIXED = {
    'deductible': {'利子税': '20', '延滞金（延納に係るもの）': '21'},
    'nondeductible': {'加算税及び加算金': '24', '延滞税': '25', '延滞金（延納を除く）': '26', '過怠税': '27'},
}
OTHER_FREE = {'deductible': ['22', '23'], 'nondeductible': ['28', '29']}


@dataclass
class Derived:
    """別表四・別表五(一)の材料。"""
    national_expense: Yen = 0  # 5⑤ → 別表四「2」
    resident_expense: Yen = 0  # 10⑤＋15⑤ → 別表四「3」
    provision_charged: Yen = 0  # 31 → 別表四「4」
    nondeductible_expense: Yen = 0  # 24〜29の⑤ → 別表四「5」
    from_provision_deductible: Yen = 0  # 35＋36 → 別表四「13」
    nondeductible_from_provision: Yen = 0  # 37 → 別表四で減算・留保と加算・社外流出を両建て
    suspense_income_taxes: Yen = 0  # 法人税・住民税の④ → 五(一)「仮払税金」
    suspense_enterprise: Yen = 0  # 事業税の④ → 別表四で減算（認定損）
    suspense_other: Yen = 0  # その他の④
    suspense_cleared: Yen = 0  # 39 仮払税金消却
    paid: dict[str, Yen] = field(default_factory=dict)  # 税目ごとの③＋④＋⑤
    opening: dict[str, Yen] = field(default_factory=dict)  # 税目ごとの期首未納①
    interim: dict[str, Yen] = field(default_factory=dict)  # 税目ごとの当期中間②
    lines: dict[str, list[str]] = field(default_factory=dict)  # 税目ごとの前期・中間の行
    provision_open: Yen = None  # 30
    provision_in: Yen = None  # 33
    provision_out: Yen = None  # 40
    provision_close: Yen = None  # 41


def _k(line: str, col: str) -> str:
    return f'b5_2:{line}:{col}'


def _prior_line(tax: str, i: int) -> str:
    lines = GROUPS[tax][0]
    return lines[i] if i < len(lines) else f'{lines[-1]}-{i}'


def _row(ctx: Ctx, line: str, label: str, p: TaxPayment, kind: str) -> None:
    """kind：prior（②なし）／interim（①なし）／other（全列）"""
    refs6 = []
    if kind in ('prior', 'other'):
        ctx.put(_k(line, '1'), p.opening_unpaid, label=f'{label} 期首現在未納税額', source='input')
        refs6.append(_k(line, '1'))
    if kind in ('interim', 'other'):
        if not ctx.has(_k(line, '2')):
            ctx.put(_k(line, '2'), p.accrued, label=f'{label} 当期発生税額', source='input')
        refs6.append(_k(line, '2'))
    ctx.put(_k(line, '3'), p.paid_provision, label=f'{label} 充当金取崩しによる納付', source='input')
    ctx.put(_k(line, '4'), p.paid_suspense, label=f'{label} 仮払経理による納付', source='input')
    ctx.put(_k(line, '5'), p.paid_expense, label=f'{label} 損金経理による納付', source='input')
    plus = opt_sum(ctx.val(r) for r in refs6)
    minus = opt_sum(ctx.val(_k(line, c)) for c in '345')
    ctx.put(_k(line, '6'), opt_sub(plus, minus), label=f'{label} 期末現在未納税額', formula='①＋②−③−④−⑤',
            refs=refs6 + [_k(line, c) for c in '345'], basis=BASIS)


def part_a(ctx: Ctx, inp: ReturnInput) -> Derived:
    view = ctx.view('b5_2', '別表五(二)', '租税公課の納付状況等に関する明細書', COLS)
    t = inp.taxes
    d = Derived()
    tgt = [{'type': 'page', 'page': 'tax-inputs', 'section': 'payments'}]
    by_tax: dict[str, list[TaxPayment]] = {k: [] for k in (*GROUPS, 'other')}
    for p in t.payments:
        if p.tax not in by_tax:
            ctx.finding('B5_2_TAX', 'critical', '入力', f'税目が不正です（{p.tax}）', '', '税目を選び直してください。', tgt)
            continue
        by_tax[p.tax].append(p)

    for tax, (prior_lines, interim_line, _final, total_line, gname) in GROUPS.items():
        rows = by_tax[tax]
        priors = [p for p in rows if p.period == 'prior']
        interims = [p for p in rows if p.period == 'interim']
        if any(p.period not in ('prior', 'interim') for p in rows):
            ctx.finding('B5_2_PERIOD', 'critical', '入力', f'{gname}に「前期以前」「当期中間」以外の行があります',
                        '当期確定分は法人税額の計算から自動で作ります（住民税は「地方税」に入力）。', '行を確認してください。', tgt)
        if len(priors) > len(prior_lines):
            ctx.finding('B5_2_TOO_MANY_PRIOR', 'warning', '入力', f'{gname}の前期以前の行が多すぎます',
                        f'様式の前期以前の欄は{len(prior_lines)}行です。', '同じ事業年度の行をまとめてください。', tgt)
        lines = []
        for i, p in enumerate(priors):
            line = _prior_line(tax, i)
            _row(ctx, line, f'{gname}（{p.label or "前期以前"}）', p, 'prior')
            view.row(line, f'{gname} {p.label or "前期以前"}', {c: _k(line, c) for c, _ in COLS if c != '2'})
            lines.append(line)
            if (p.opening_unpaid or 0) > 0 and (p.paid_provision or 0) + (p.paid_suspense or 0) + (p.paid_expense or 0) == 0:
                ctx.finding('B5_2_PRIOR_UNPAID', 'warning', '数値', f'{gname}の前期分が当期に納付されていません',
                            f'期首の未納税額 {p.opening_unpaid:,} 円に対する当期の納付がありません。',
                            '前期確定分の納付（通常は申告期限までに納付）の記帳を確認してください。', tgt)
        if len(interims) > 1:
            ctx.finding('B5_2_TOO_MANY_INTERIM', 'warning', '入力', f'{gname}の当期中間分が複数あります',
                        '当期中間分は1行にまとめます。', '入力を確認してください。', tgt)
        interim = interims[0] if interims else TaxPayment(tax=tax, period='interim')
        if tax == 'national':
            ctx.put(_k(interim_line, '2'), opt_sum([t.interim_corporate_tax, t.interim_local_corporate_tax, t.interim_defense_tax]),
                    label='法人税等 当期中間 当期発生税額', source='input', basis=BASIS,
                    formula='中間申告分の法人税額（別表一「14」）＋地方法人税額（「39」）＋防衛特別法人税額（次葉一「58」）')
        _row(ctx, interim_line, f'{gname}（当期中間）', interim, 'interim')
        view.row(interim_line, f'{gname} 当期分 中間', {c: _k(interim_line, c) for c, _ in COLS if c != '1'})
        lines.append(interim_line)
        d.lines[tax] = lines
        d.opening[tax] = opt_sum(ctx.val(_k(ln, '1')) for ln in lines if ctx.has(_k(ln, '1')))
        d.interim[tax] = ctx.val(_k(interim_line, '2'))
        d.paid[tax] = opt_sum(ctx.val(_k(ln, c)) for ln in lines for c in '345')
        suspense = opt_sum(ctx.val(_k(ln, '4')) for ln in lines)
        expense = opt_sum(ctx.val(_k(ln, '5')) for ln in lines)
        if tax == 'national':
            d.national_expense = expense
            d.suspense_income_taxes = opt_add(d.suspense_income_taxes, suspense)
        elif tax in ('prefectural', 'municipal'):
            d.resident_expense = opt_add(d.resident_expense, expense)
            d.suspense_income_taxes = opt_add(d.suspense_income_taxes, suspense)
        else:
            d.suspense_enterprise = suspense
            # 事業税は当期確定分の行がないので、計（19）をここで作る
            for c, name in COLS:
                keys = [_k(ln, c) for ln in lines if ctx.has(_k(ln, c))]
                ctx.put(_k(total_line, c), opt_sum(ctx.val(k) for k in keys), label=f'{gname} 計 {name}',
                        formula='各行の合計', refs=keys, basis=BASIS)
            view.row(total_line, f'{gname} 計', {c: _k(total_line, c) for c, _ in COLS}, kind='subtotal')

    # その他の租税公課
    other_lines: dict[str, list[str]] = {'deductible': [], 'nondeductible': []}
    free = {k: list(v) for k, v in OTHER_FREE.items()}
    used: set[str] = set()
    for p in by_tax['other']:
        kind = p.other_kind
        if kind not in ('deductible', 'nondeductible'):
            ctx.finding('B5_2_OTHER_KIND', 'critical', '入力', f'その他の租税公課「{p.label}」の損金算入・不算入が未選択です',
                        '加算税・延滞税・延滞金（延納分を除く）・過怠税は損金不算入です（法人税法第55条）。',
                        '区分を選んでください。', tgt)
            continue
        line = OTHER_FIXED[kind].get(p.label)
        if line is None or line in used:
            line = free[kind].pop(0) if free[kind] else f'{OTHER_FREE[kind][-1]}-{len(used)}'
        used.add(line)
        _row(ctx, line, f'その他 {p.label}', p, 'other')
        other_lines[kind].append(line)
        view.row(line, f'その他（{"損金算入" if kind == "deductible" else "損金不算入"}） {p.label}',
                 {c: _k(line, c) for c, _ in COLS})
    d.nondeductible_expense = opt_sum(ctx.val(_k(ln, '5')) for ln in other_lines['nondeductible'])
    d.suspense_other = opt_sum(ctx.val(_k(ln, '4')) for ln in other_lines['deductible'] + other_lines['nondeductible'])

    # 納税充当金の計算（30〜41）
    ptgt = [{'type': 'page', 'page': 'tax-inputs', 'section': 'provision'}]
    l30 = ctx.put(_k('30', 'value'), inp.financials.tax_provision_open, label='期首納税充当金',
                  formula='貸借対照表の未払法人税等（期首）', source='input', basis=BASIS)
    if l30 is None:
        ctx.finding('B5_2_PROVISION_OPEN', 'critical', '資料不足', '期首の納税充当金（未払法人税等）が不明です',
                    '別表五(二)「30」と別表五(一)「26」①に使います。',
                    '試算表を取り込むか、期首の未払法人税等を入力してください（なければ0円）。', ptgt)
    l31 = ctx.put(_k('31', 'value'), t.provision_charged, label='損金経理をした納税充当金',
                  formula='当期に費用（法人税、住民税及び事業税）として未払法人税等に計上した額', source='input', basis=BASIS)
    if l31 is None:
        ctx.finding('B5_2_PROVISION_CHARGED', 'critical', '資料不足', '損金経理をした納税充当金（当期の未払法人税等の計上額）が不明です',
                    '別表四「4」で加算する額です。決算で未払法人税等を計上していなければ0円です。',
                    '「税額の基礎」→「納税充当金」で入力してください（試算表の未払法人税等の貸方の額を参考にできます）。', ptgt)
    l32 = ctx.put(_k('32', 'value'), t.provision_other_charged, label='その他の繰入額', source='input', basis=BASIS)
    l33 = ctx.put(_k('33', 'value'), opt_add(l31, l32), label='繰入額 計', formula='(31)+(32)',
                  refs=[_k('31', 'value'), _k('32', 'value')], basis=BASIS)
    inc_lines = [ln for tax in INCOME_TAXES for ln in d.lines[tax]]
    l34 = ctx.put(_k('34', 'value'), opt_sum(ctx.val(_k(ln, '3')) for ln in inc_lines), label='取崩額 法人税額等',
                  formula='(5の③)+(10の③)+(15の③)', refs=[_k(ln, '3') for ln in inc_lines], basis=BASIS)
    l35 = ctx.put(_k('35', 'value'), ctx.val(_k('19', '3')), label='取崩額 事業税及び特別法人事業税',
                  formula='(19の③)', refs=[_k('19', '3')], basis=BASIS)
    l36 = ctx.put(_k('36', 'value'), opt_sum(ctx.val(_k(ln, '3')) for ln in other_lines['deductible']),
                  label='取崩額 その他 損金算入のもの', formula='その他（損金算入）の③',
                  refs=[_k(ln, '3') for ln in other_lines['deductible']], basis=BASIS)
    l37 = ctx.put(_k('37', 'value'), opt_sum(ctx.val(_k(ln, '3')) for ln in other_lines['nondeductible']),
                  label='取崩額 その他 損金不算入のもの', formula='その他（損金不算入）の③',
                  refs=[_k(ln, '3') for ln in other_lines['nondeductible']], basis=BASIS)
    l39 = ctx.put(_k('39', 'value'), t.provision_suspense_cleared, label='取崩額 仮払税金消却', source='input', basis=BASIS)
    l40 = ctx.put(_k('40', 'value'), opt_sum([l34, l35, l36, l37, l39]), label='取崩額 計',
                  formula='(34)+(35)+(36)+(37)+(38)+(39)',
                  refs=[_k(x, 'value') for x in ('34', '35', '36', '37', '39')], basis=BASIS)
    l41 = ctx.put(_k('41', 'value'), opt_sub(opt_add(l30, l33), l40), label='期末納税充当金', formula='(30)+(33)−(40)',
                  refs=[_k('30', 'value'), _k('33', 'value'), _k('40', 'value')], basis=BASIS)
    for line, label in (('30', '期首納税充当金'), ('31', '繰入額 損金経理をした納税充当金'), ('32', '繰入額 その他'),
                        ('33', '繰入額 計'), ('34', '取崩額 法人税額等'), ('35', '取崩額 事業税及び特別法人事業税'),
                        ('36', '取崩額 その他 損金算入のもの'), ('37', '取崩額 その他 損金不算入のもの'),
                        ('39', '取崩額 仮払税金消却'), ('40', '取崩額 計'), ('41', '期末納税充当金')):
        view.row(line, f'納税充当金 {label}', {'value': _k(line, 'value')}, kind='provision')

    close = inp.financials.tax_provision_close
    if l41 is not None and close is not None and l41 != close:
        ctx.finding('B5_2_PROVISION_MISMATCH', 'warning', '数値', '期末納税充当金が貸借対照表の未払法人税等と一致しません',
                    f'別表五(二)「41」{l41:,} 円、試算表の未払法人税等（期末）{close:,} 円（差 {l41 - close:,} 円）。',
                    '納付の区分（③充当金取崩し／⑤損金経理）と、損金経理をした納税充当金「31」の額を確認してください。',
                    [{'type': 'cell', 'key': _k('41', 'value')}] + ptgt)

    d.provision_charged = l31
    d.from_provision_deductible = opt_add(l35, l36)
    d.nondeductible_from_provision = l37
    d.suspense_cleared = l39
    d.provision_open, d.provision_in, d.provision_out, d.provision_close = l30, l33, l40, l41
    return d


def part_b(ctx: Ctx, inp: ReturnInput, d: Derived, final_national: Yen) -> dict[str, Yen]:
    """当期確定分と計の行。戻り値：税目ごとの当期確定額。"""
    view = ctx.views['b5_2']
    t = inp.taxes
    finals = {'national': final_national, 'prefectural': t.final_prefectural, 'municipal': t.final_municipal}
    tgt = [{'type': 'page', 'page': 'tax-inputs', 'section': 'local'}]
    inserted: dict[str, list[ViewRow]] = {}
    for tax in INCOME_TAXES:
        _prior, interim_line, final_line, total_line, gname = GROUPS[tax]
        if tax == 'national':
            ctx.put(_k(final_line, '2'), final_national, label=f'{gname} 当期確定 当期発生税額',
                    formula='差引確定法人税額（別表一「15」）＋差引確定地方法人税額（「40」）＋差引確定防衛特別法人税額（次葉一「59」）',
                    refs=['b1:15:value', 'b1:40:value', 'b1:59:value'], basis=BASIS)
        else:
            ctx.put(_k(final_line, '2'), finals[tax], label=f'{gname} 当期確定 当期発生税額',
                    formula='地方税の申告書の確定税額（Phase 2 は入力値）', source='input', basis=BASIS)
            if finals[tax] is None:
                ctx.finding(f'B5_2_LOCAL_{tax.upper()}', 'critical', '資料不足', f'当期確定分の{gname}が未入力です',
                            '別表五(二)と別表五(一)の未納住民税に必要です（均等割を含みます。法人税額が0円でも均等割はかかります）。'
                            '地方税の自動計算は Phase 3 で実装予定です。',
                            '地方税の申告書（または見込額）の税額を「税額の基礎」→「地方税」に入力してください。', tgt)
            else:
                ctx.finding(f'B5_2_LOCAL_MANUAL_{tax.upper()}', 'warning', '手入力', f'当期確定分の{gname}は手入力の値です',
                            '本システムは地方税（住民税・事業税）の税額を計算していません。入力された値をそのまま使っています。',
                            '地方税の申告書の税額と一致しているか確認してください。', tgt)
        ctx.put(_k(final_line, '6'), ctx.val(_k(final_line, '2')), label=f'{gname} 当期確定 期末現在未納税額',
                formula='②', refs=[_k(final_line, '2')], basis=BASIS)
        lines = d.lines[tax] + [final_line]
        for c, name in COLS:
            keys = [_k(ln, c) for ln in lines if ctx.has(_k(ln, c))]
            ctx.put(_k(total_line, c), opt_sum(ctx.val(k) for k in keys), label=f'{gname} 計 {name}',
                    formula='各行の合計', refs=keys, basis=BASIS)
        inserted[interim_line] = [
            ViewRow(final_line, f'{gname} 当期分 確定', {'2': _k(final_line, '2'), '6': _k(final_line, '6')}),
            ViewRow(total_line, f'{gname} 計', {c: _k(total_line, c) for c, _ in COLS}, kind='subtotal'),
        ]
    rows = []
    for r in view.rows:
        rows.append(r)
        rows.extend(inserted.get(r.line, []))
    view.rows = rows
    return finals

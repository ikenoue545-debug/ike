"""別表五(一) 利益積立金額及び資本金等の額の計算に関する明細書。

Ⅰ 利益積立金額：①期首現在 ②当期の減 ③当期の増 ④差引翌期首現在（①−②＋③）
Ⅱ 資本金等の額：同じ列

検算（様式の注意書き）：
  期首現在利益積立金額合計「31」① ＋ 別表四留保所得金額又は欠損金額「52」②
  − 中間分・確定分の法人税等、道府県民税及び市町村民税の合計額 ＝ 差引翌期首現在利益積立金額合計「31」④
"""
from __future__ import annotations

from collections import OrderedDict

from ..cells import Ctx
from ..model import Adjustment, ReturnInput
from ..money import Yen, opt_add, opt_neg, opt_sub, opt_sum
from .b5_2 import Derived

BASIS = ['法人税法第2条第18号', '法人税法施行令第9条', '別表五(一)の記載の仕方']
COLS = [('1', '①期首現在利益積立金額'), ('2', '②当期の減'), ('3', '③当期の増'), ('4', '④差引翌期首現在利益積立金額')]
FIXED_KEYS = {'refund_national': ('22', '未収還付法人税等'), 'refund_prefectural': ('23', '未収還付道府県民税'),
              'refund_municipal': ('24', '未収還付市町村民税')}


def _k(line: str, col: str) -> str:
    return f'b5_1:{line}:{col}'


def _put4(ctx: Ctx, line: str, label: str, v1: Yen, v2: Yen, v3: Yen, notes: dict[str, str] | None = None,
          refs: dict[str, list[str]] | None = None) -> None:
    notes = notes or {}
    refs = refs or {}
    ctx.put(_k(line, '1'), v1, label=f'{label} ①期首現在', formula=notes.get('1', ''), refs=refs.get('1', []), basis=BASIS)
    ctx.put(_k(line, '2'), v2, label=f'{label} ②当期の減', formula=notes.get('2', ''), refs=refs.get('2', []), basis=BASIS)
    ctx.put(_k(line, '3'), v3, label=f'{label} ③当期の増', formula=notes.get('3', ''), refs=refs.get('3', []), basis=BASIS)
    ctx.put(_k(line, '4'), opt_add(opt_sub(v1, v2), v3), label=f'{label} ④差引翌期首現在', formula='①−②＋③',
            refs=[_k(line, c) for c in '123'], basis=BASIS)


def _movement(open_: Yen, close: Yen) -> tuple[Yen, Yen]:
    """BS の期首・期末から ②減・③増 を作る。"""
    if open_ is None or close is None:
        return None, None
    return (open_ - close, 0) if close < open_ else (0, close - open_)


def compute(ctx: Ctx, inp: ReturnInput, adjustments: list[Adjustment], d: Derived, finals: dict[str, Yen]) -> dict:
    view = ctx.view('b5_1', '別表五(一)', '利益積立金額及び資本金等の額の計算に関する明細書', COLS)
    f = inp.financials
    tgt_tb = [{'type': 'page', 'page': 'trial-balance'}]

    # 1 利益準備金、2 積立金
    dec, inc = _movement(f.legal_reserve_open, f.legal_reserve_close)
    _put4(ctx, '1', '利益準備金', f.legal_reserve_open, dec, inc, {'1': '貸借対照表（期首）', '2': '貸借対照表の増減', '3': '貸借対照表の増減'})
    view.row('1', '利益準備金', {c: _k('1', c) for c, _ in COLS})
    for i, r in enumerate(f.reserves, start=1):
        line = '2' if i == 1 else f'2-{i}'
        dec, inc = _movement(r.open, r.close)
        _put4(ctx, line, r.name, r.open, dec, inc, {'1': '貸借対照表（期首）', '2': '貸借対照表の増減', '3': '貸借対照表の増減'})
        view.row('2', r.name, {c: _k(line, c) for c, _ in COLS})

    # 3〜24：期首の項目と、別表四の留保の調整
    items: 'OrderedDict[str, dict]' = OrderedDict()
    for it in inp.opening.retained_items:
        items.setdefault(it.key, {'name': it.name, 'open': 0, 'dec': [], 'inc': [], 'open_refs': []})
        cur = items[it.key]
        cur['open'] = opt_add(cur['open'], it.amount)
    for a in adjustments:
        if a.disposition != 'ryuho' or not a.five1_key:
            continue
        cur = items.setdefault(a.five1_key, {'name': a.five1_name or a.name, 'open': 0, 'dec': [], 'inc': [], 'open_refs': []})
        signed = None if a.amount is None else (a.amount if a.direction == 'add' else -a.amount)
        if a.five1_column == 'decrease':
            cur['dec'].append((opt_neg(signed), a))
        else:
            cur['inc'].append((signed, a))
    free_no = 3
    item_lines = []
    item_keys: list[tuple[str, str, str]] = []  # (key, 名称, 行)
    for key, it in items.items():
        if key in FIXED_KEYS:
            line, name = FIXED_KEYS[key]
        else:
            line, name = (str(free_no) if free_no <= 21 else f'21-{free_no - 21}'), it['name']
            free_no += 1
        refs2 = [f'adj:{a.id}' for _, a in it['dec']]
        refs3 = [f'adj:{a.id}' for _, a in it['inc']]
        _put4(ctx, line, name, it['open'], opt_sum(v for v, _ in it['dec']), opt_sum(v for v, _ in it['inc']),
              {'1': '前期の別表五(一)④（期首情報）', '2': '別表四の留保の調整（解消）', '3': '別表四の留保の調整（発生）'},
              {'2': refs2, '3': refs3})
        for c, adjs in (('2', it['dec']), ('3', it['inc'])):
            for v, a in adjs:
                ctx.note(_k(line, c), f'{a.name}（別表四「{a.line}」）')
        view.row(line, name, {c: _k(line, c) for c, _ in COLS})
        item_lines.append(line)
        item_keys.append((key, name, line))
        v4 = ctx.val(_k(line, '4'))
        if key == 'depreciation_excess' and v4 is not None and v4 < 0:
            ctx.finding('B5_1_NEGATIVE_DEPR', 'warning', '数値', '減価償却超過額の期末残高がマイナスです',
                        f'別表五(一)「{name}」④が {v4:,} 円です。認容額が超過額の残高を超えています。',
                        '減価償却超過額の当期認容額を確認してください。', [{'type': 'cell', 'key': _k(line, '4')}])

    # 25 繰越損益金
    _put4(ctx, '25', '繰越損益金', f.retained_earnings_open, f.retained_earnings_open, f.retained_earnings_close,
          {'1': '貸借対照表の繰越利益剰余金（期首）', '2': '期首の額', '3': '貸借対照表の繰越利益剰余金（期末）'})
    if f.retained_earnings_open is None or f.retained_earnings_close is None:
        ctx.finding('B5_1_RE_UNKNOWN', 'critical', '資料不足', '繰越利益剰余金の期首・期末が不明です',
                    '別表五(一)「25」繰越損益金に使います。', '試算表（貸借対照表）を取り込んでください。', tgt_tb)
    view.row('25', '繰越損益金（損は赤）', {c: _k('25', c) for c, _ in COLS})

    # 26 納税充当金
    _put4(ctx, '26', '納税充当金', d.provision_open, d.provision_out, d.provision_in,
          {'1': '別表五(二)「30」', '2': '別表五(二)「40」', '3': '別表五(二)「33」'},
          {'1': ['b5_2:30:value'], '2': ['b5_2:40:value'], '3': ['b5_2:33:value']})
    view.row('26', '納税充当金', {c: _k('26', c) for c, _ in COLS})

    # 27・29・30 未納法人税等（△で記載）
    unpaid = {}
    for line, tax, label, l5 in (('27', 'national', '未納法人税、未納地方法人税及び未納防衛特別法人税', '5'),
                                 ('29', 'prefectural', '未納道府県民税（均等割を含む）', '10'),
                                 ('30', 'municipal', '未納市町村民税（均等割を含む）', '15')):
        v1 = opt_neg(d.opening.get(tax))
        v2 = opt_neg(d.paid.get(tax))
        v3i = opt_neg(d.interim.get(tax))
        v3f = opt_neg(finals.get(tax))
        ctx.put(_k(line, '3i'), v3i, label=f'{label} ③当期の増 中間', formula=f'△別表五(二)当期中間の②',
                refs=[f'b5_2:{ {"27": "3", "29": "8", "30": "13"}[line]}:2'], basis=BASIS)
        ctx.put(_k(line, '3f'), v3f, label=f'{label} ③当期の増 確定', formula=f'△別表五(二)当期確定の②',
                refs=[f'b5_2:{ {"27": "4", "29": "9", "30": "14"}[line]}:2'], basis=BASIS)
        _put4(ctx, line, label, v1, v2, opt_add(v3i, v3f),
              {'1': f'△別表五(二)前期以前の①', '2': f'△別表五(二)「{l5}」の③＋④＋⑤（当期の納付額）', '3': '中間＋確定'},
              {'2': [f'b5_2:{l5}:{c}' for c in '345'], '3': [_k(line, '3i'), _k(line, '3f')]})
        view.row(line, label, {'1': _k(line, '1'), '2': _k(line, '2'), '3i': _k(line, '3i'), '3f': _k(line, '3f'),
                               '3': _k(line, '3'), '4': _k(line, '4')})
        unpaid[tax] = ctx.val(_k(line, '4'))
        v4 = ctx.val(_k(line, '4'))
        b6 = ctx.val(f'b5_2:{l5}:6') if ctx.has(f'b5_2:{l5}:6') else None
        if v4 is not None and b6 is not None and v4 != -b6:
            ctx.finding('B5_1_UNPAID_MISMATCH', 'critical', '数値', f'別表五(一)「{line}」と別表五(二)の期末未納税額が一致しません',
                        f'別表五(一)④ {v4:,} 円、別表五(二)「{l5}」⑥ {b6:,} 円。',
                        '別表五(二)の納付の入力を確認してください。', [{'type': 'cell', 'key': _k(line, '4')}])

    # 31 差引合計額
    lines = ['1'] + [f'2-{i}' if i > 1 else '2' for i in range(1, len(f.reserves) + 1)] + item_lines + ['25', '26', '27', '29', '30']
    for c, name in COLS:
        ctx.put(_k('31', c), opt_sum(ctx.val(_k(ln, c)) for ln in lines), label=f'差引合計額 {name}', formula='各行の合計',
                refs=[_k(ln, c) for ln in lines], basis=BASIS)
    view.row('31', '差引合計額', {c: _k('31', c) for c, _ in COLS}, kind='total')

    # 検算
    taxes = opt_neg(opt_sum(ctx.val(_k(ln, '3')) for ln in ('27', '29', '30')))
    lhs = opt_sub(opt_add(ctx.val(_k('31', '1')), ctx.val('b4:52:ryuho')), taxes)
    rhs = ctx.val(_k('31', '4'))
    ctx.put('b5_1:check:value', None if lhs is None or rhs is None else lhs - rhs, label='検算の差額',
            formula='「31」①＋別表四「52」②−中間分・確定分の法人税等・住民税の合計−「31」④（0になる）',
            refs=[_k('31', '1'), 'b4:52:ryuho', _k('27', '3'), _k('29', '3'), _k('30', '3'), _k('31', '4')], basis=BASIS)
    if lhs is not None and rhs is not None and lhs != rhs:
        ctx.finding('B5_1_CHECK', 'critical', '数値', '別表四と別表五(一)の検算が合いません',
                    f'期首「31」①＋別表四「52」②−法人税等・住民税（中間・確定）＝ {lhs:,} 円、「31」④ ＝ {rhs:,} 円（差 {lhs - rhs:,} 円）。',
                    '留保の税務調整に別表五(一)の行が付いているか、貸借対照表の利益剰余金と当期純利益が合っているかを確認してください。',
                    [{'type': 'cell', 'key': _k('31', '4')}, {'type': 'cell', 'key': 'b4:52:ryuho'}])

    # 前期との連続性
    prior = inp.opening.prior_retained_total
    v31_1 = ctx.val(_k('31', '1'))
    if prior is not None and v31_1 is not None and prior != v31_1:
        ctx.finding('B5_1_CONTINUITY', 'critical', '期首情報', '期首の利益積立金額が前期の期末と一致しません',
                    f'前期の別表五(一)「31」④ {prior:,} 円、当期の「31」① {v31_1:,} 円（差 {v31_1 - prior:,} 円）。',
                    '期首情報（前期から引き継いだ項目）と、貸借対照表の期首残高を確認してください。',
                    [{'type': 'page', 'page': 'opening'}, {'type': 'cell', 'key': _k('31', '1')}])

    # Ⅱ 資本金等の額
    cap_lines = []
    for i, r in enumerate(f.capital_rows, start=1):
        line = {1: '32', 2: '33', 3: '34', 4: '35'}.get(i, f'35-{i - 4}')
        dec, inc = _movement(r.open, r.close)
        _put4(ctx, line, r.name, r.open, dec, inc, {'1': '貸借対照表（期首）', '2': '増減', '3': '増減'})
        view.row(line, r.name, {c: _k(line, c) for c, _ in COLS})
        cap_lines.append(line)
    for c, name in COLS:
        ctx.put(_k('36', c), opt_sum(ctx.val(_k(ln, c)) for ln in cap_lines), label=f'資本金等の額 差引合計額 {name}',
                formula='各行の合計', refs=[_k(ln, c) for ln in cap_lines], basis=['法人税法第2条第16号'])
    view.row('36', '資本金等の額 差引合計額', {c: _k('36', c) for c, _ in COLS}, kind='total')
    if not f.capital_rows:
        ctx.finding('B5_1_CAPITAL', 'warning', '資料不足', '資本金等の額（別表五(一)Ⅱ）の行がありません',
                    '資本金・資本準備金などの期首・期末が試算表から読めていません。', '試算表の純資産の部を確認してください。', tgt_tb)
    return {'total_close': ctx.val(_k('31', '4')), 'unpaid': unpaid,
            'items': [{'key': k, 'name': n, 'line': ln, 'amount': ctx.val(_k(ln, '4'))} for k, n, ln in item_keys]}

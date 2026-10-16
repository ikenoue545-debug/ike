"""別表一（本表・次葉一・次葉二）：法人税額・地方法人税額・防衛特別法人税額の計算。

様式：令和8年4月1日以後終了事業年度等分。行番号は様式どおり。
- 法人税：本表 1〜27、次葉二 74〜79
- 地方法人税：本表 28〜44、次葉二 80〜83
- 防衛特別法人税：次葉一 45〜73（令和8年4月1日以後に開始する事業年度のみ）
"""
from __future__ import annotations

from decimal import Decimal

from ..cells import Ctx
from ..model import ReturnInput
from ..money import Yen, apply_rate, floor_unit, opt_add, opt_sub, pct, prorate
from ..rules.registry import RuleRegistry, RuleVersion

TAX_BASE_UNIT = 1000  # 国税通則法第118条第1項（様式の「000」欄）
TAX_AMOUNT_UNIT = 100  # 国税通則法第119条第1項（様式の「00」欄）
B_CORP = ['法人税法第66条', '租税特別措置法第42条の3の2', '別表一の記載の仕方']
B_LOCAL = ['地方法人税法第9条・第10条', '別表一の記載の仕方5']
B_DEF = ['防確法第10条・第13条〜第15条', '別表一の記載の仕方6']
B_ROUND_BASE = '国税通則法第118条第1項（1,000円未満切捨て）'
B_ROUND_AMT = '国税通則法第119条第1項（100円未満切捨て）'


def _k(line: str) -> str:
    return f'b1:{line}:value'


def _rate(ctx: Ctx, key: str, base: Yen, rate: Decimal, *, label: str, formula: str, refs: list[str], basis: list[str]) -> Yen:
    if base is None:
        return ctx.put(key, None, label=label, formula=formula, refs=refs, basis=basis)
    v, frac = apply_rate(base, rate)
    if frac:
        ctx.finding('B1_RATE_FRACTION', 'warning', '数値', f'{label}の計算で1円未満の端数が出ました',
                    f'{base:,} × {rate} の端数を切り捨てています。通常は千円単位の金額に税率を掛けるため端数は出ません。',
                    '課税標準の端数処理を確認してください。', [{'type': 'cell', 'key': key}])
    return ctx.put(key, v, label=label, formula=formula, refs=refs, basis=basis)


def compute(ctx: Ctx, inp: ReturnInput, reg: RuleRegistry, months: int, sme: bool | None,
            credit_income_tax: Yen, loss_deduction: Yen, loss_carry: Yen) -> dict[str, Yen]:
    p = inp.period
    t = inp.taxes
    tgt_rules = [{'type': 'page', 'page': 'rules'}]

    # ------------------------------------------------------------ 法人税
    v_main = ctx.view('b1', '別表一', '各事業年度の所得に係る申告書（内国法人の分）', [('value', '金額')])
    v_n2 = ctx.view('b1n2', '別表一次葉二', '法人税額の計算・地方法人税額の計算', [('value', '金額')])
    rule: RuleVersion | None = reg.for_period('corporate_tax_rate', p.start, p.end)
    if rule is None or not rule.usable:
        ctx.finding('B1_RATE_RULE', 'critical', 'ルール', 'この事業年度に使える法人税率のルールがありません',
                    ('中小法人の軽減税率の特例（租税特別措置法第42条の3の2）の適用期限後の事業年度で、延長の有無を確認していません。'
                     if rule is not None else '登録済みのルールより前の事業年度です。'),
                    '一次資料で税率を確認し、ルールデータに版を追加してください。確認するまで申告書は確定できません。', tgt_rules)
        rule = None
    else:
        ctx.use_rule(rule)

    income = ctx.val('b4:52:total')
    l1 = ctx.put(_k('1'), income, label='所得金額又は欠損金額', formula='別表四「52の①」', refs=['b4:52:total'], basis=B_CORP)
    taxable = None if income is None else floor_unit(max(income, 0), TAX_BASE_UNIT)
    if rule is None or taxable is None or sme is None:
        l74 = l76 = None
    else:
        threshold = prorate(rule.yen('sme_threshold_annual'), months, TAX_BASE_UNIT) if sme else 0
        l74 = min(taxable, threshold)
        l76 = taxable - l74
    ctx.put('b1n2:74:value', l74, label='(1)のうち中小法人等の年800万円相当額以下の金額',
            formula=(f'(1)（1,000円未満切捨て）と800万円×{months}/12のうち少ない金額' if sme else '中小法人等に当たらないため0'),
            refs=[_k('1')], basis=B_CORP + [B_ROUND_BASE])
    ctx.put('b1n2:76:value', l76, label='その他の所得金額', formula='(1)−(74)−(75)（1,000円未満切捨て）',
            refs=[_k('1'), 'b1n2:74:value'], basis=B_CORP + [B_ROUND_BASE])
    rate77 = None
    rate_note = ''
    if rule is not None and sme is not None and sme:
        if inp.profile.tekiyo_jogai is None:
            ctx.finding('B1_TEKIYO_JOGAI_UNKNOWN', 'critical', '資料不足', '適用除外事業者に当たるか未確認です',
                        '前3事業年度の所得金額の平均額が年15億円を超える法人は、軽減税率15%ではなく19%です（租税特別措置法第42条の3の2）。',
                        '年度の基本情報で「適用除外事業者に該当しない／する」を選んでください。', [{'type': 'page', 'page': 'company'}])
        elif inp.profile.tekiyo_jogai:
            rate77, rate_note = rule.dec('sme_rate_tekiyo_jogai'), '適用除外事業者'
        else:
            hi = rule.get('sme_high_income_annual')
            if hi is not None and income is not None and Decimal(income) * 12 > Decimal(hi) * months:
                rate77, rate_note = rule.dec('sme_high_income_rate'), f'所得金額が年10億円（×{months}/12）超'
            else:
                rate77, rate_note = rule.dec('sme_rate'), '中小法人の軽減税率'
    elif rule is not None and sme is False:
        rate77, rate_note = rule.dec('standard_rate'), '中小法人に当たらない'
    l77 = _rate(ctx, 'b1n2:77:value', l74 if rate77 is not None else None, rate77 or Decimal(0),
                label='(74)の15%、17%又は19%相当額', formula=f'(74)×{pct(rate77) if rate77 else "—"}%（{rate_note}）',
                refs=['b1n2:74:value'], basis=B_CORP)
    std = rule.dec('standard_rate') if rule else None
    l79 = _rate(ctx, 'b1n2:79:value', l76 if std is not None else None, std or Decimal(0),
                label='(76)の19%又は23.2%相当額', formula=f'(76)×{pct(std) if std else "—"}%', refs=['b1n2:76:value'], basis=B_CORP)
    l2 = ctx.put(_k('2'), opt_add(l77, l79), label='法人税額', formula='(77)+(78)+(79)',
                 refs=['b1n2:77:value', 'b1n2:79:value'], basis=B_CORP)
    l3 = ctx.put(_k('3'), 0, label='法人税額の特別控除額', formula='別表六(六)「5」（未対応のため0。該当があれば確定不可）',
                 basis=['別表六(六)'])
    l4 = ctx.put(_k('4'), 0, label='税額控除超過額相当額等の加算額', formula='該当なし（対象外）')
    l6 = ctx.put(_k('6'), 0, label='土地譲渡利益金額に対する税額', formula='該当なし（対象外）')
    l8 = ctx.put(_k('8'), 0, label='課税留保金額に対する税額', formula='該当なし（中小法人は特定同族会社の留保金課税の対象外）')
    l9 = ctx.put(_k('9'), opt_add(opt_sub(l2, l3), l4, l6, l8), label='法人税額計', formula='(2)−(3)+(4)+(6)+(8)',
                 refs=[_k(x) for x in ('2', '3', '4', '6', '8')], basis=B_CORP)
    l10 = ctx.put(_k('10'), 0, label='分配時調整外国税相当額等の控除額', formula='該当なし（対象外）')
    l11 = ctx.put(_k('11'), 0, label='仮装経理に基づく過大申告の更正に伴う控除法人税額', formula='該当なし（対象外）')
    l16 = ctx.put(_k('16'), credit_income_tax, label='控除税額の計算 所得税の額', formula='別表六(一)「6の③」',
                  refs=['b6_1:6:3'], basis=['法人税法第68条'])
    l17 = ctx.put(_k('17'), 0, label='控除税額の計算 外国税額', formula='該当なし（外国税額控除は未対応）')
    l18 = ctx.put(_k('18'), opt_add(l16, l17), label='控除税額の計算 計', formula='(16)+(17)', refs=[_k('16'), _k('17')])
    avail = opt_sub(opt_sub(l9, l10), l11)
    l12 = ctx.put(_k('12'), None if avail is None or l18 is None else min(avail, l18), label='控除税額',
                  formula='((9)−(10)−(11))と(18)のうち少ない金額', refs=[_k('9'), _k('10'), _k('11'), _k('18')], basis=B_CORP)
    raw13 = opt_sub(avail, l12)
    l13 = ctx.put(_k('13'), None if raw13 is None else floor_unit(raw13, TAX_AMOUNT_UNIT), label='差引所得に対する法人税額',
                  formula='(9)−(10)−(11)−(12)（100円未満切捨て）', refs=[_k('9'), _k('12')], basis=B_CORP + [B_ROUND_AMT])
    l14 = ctx.put(_k('14'), t.interim_corporate_tax, label='中間申告分の法人税額', source='input', basis=B_CORP)
    diff15 = opt_sub(l13, l14)
    l15 = ctx.put(_k('15'), None if diff15 is None else max(diff15, 0), label='差引確定法人税額',
                  formula='(13)−(14)（マイナスの場合は(22)へ）', refs=[_k('13'), _k('14')], basis=B_CORP)
    l19 = ctx.put(_k('19'), l12, label='控除した金額', formula='(12)', refs=[_k('12')])
    l20 = ctx.put(_k('20'), opt_sub(l18, l19), label='控除しきれなかった金額', formula='(18)−(19)', refs=[_k('18'), _k('19')])
    l21 = ctx.put(_k('21'), l20, label='所得税額等の還付金額', formula='(20)', refs=[_k('20')], basis=['法人税法第78条'])
    l22 = ctx.put(_k('22'), None if diff15 is None else max(-diff15, 0), label='中間納付額', formula='(14)−(13)',
                  refs=[_k('13'), _k('14')])
    l23 = ctx.put(_k('23'), 0, label='欠損金の繰戻しによる還付請求税額', formula='該当なし（未対応）')
    l24 = ctx.put(_k('24'), opt_add(l21, l22, l23), label='還付金額 計', formula='(21)+(22)+(23)',
                  refs=[_k('21'), _k('22'), _k('23')])
    ctx.put(_k('26'), loss_deduction, label='欠損金等の当期控除額', formula='別表七(一)「4の計」', refs=['b7_1:4:total'])
    ctx.put(_k('27'), loss_carry, label='翌期へ繰り越す欠損金額', formula='別表七(一)「5の合計」', refs=['b7_1:5:total'])

    # ------------------------------------------------------------ 地方法人税
    lrule = reg.for_period('local_corporate_tax', p.start, p.end)
    if lrule is None or not lrule.usable:
        ctx.finding('B1_LOCAL_RULE', 'critical', 'ルール', 'この事業年度に使える地方法人税率のルールがありません', '',
                    'ルールデータを確認してください。', tgt_rules)
        lrate = None
    else:
        ctx.use_rule(lrule)
        lrate = lrule.dec('rate')
    l28 = ctx.put(_k('28'), opt_add(opt_sub(l2, l3), l4, l6), label='所得の金額に対する法人税額',
                  formula='(2)−(3)+(4)+(6)+(9の外書)', refs=[_k('2'), _k('3'), _k('4'), _k('6')], basis=B_LOCAL)
    l29 = ctx.put(_k('29'), l8, label='課税留保金額に対する法人税額', formula='(8)', refs=[_k('8')], basis=B_LOCAL)
    l30 = ctx.put(_k('30'), None if l28 is None else floor_unit(max(l28 + l29, 0), TAX_BASE_UNIT), label='課税標準法人税額',
                  formula='(28)+(29)（1,000円未満切捨て）', refs=[_k('28'), _k('29')], basis=B_LOCAL + [B_ROUND_BASE])
    l80 = ctx.put('b1n2:80:value', None if l28 is None else floor_unit(max(l28, 0), TAX_BASE_UNIT),
                  label='所得の金額に対する法人税額（千円未満切捨て）', formula='(28)', refs=[_k('28')], basis=B_LOCAL + [B_ROUND_BASE])
    l81 = ctx.put('b1n2:81:value', floor_unit(max(l29, 0), TAX_BASE_UNIT), label='課税留保金額に対する法人税額', formula='(29)',
                  refs=[_k('29')], basis=B_LOCAL)
    l82 = _rate(ctx, 'b1n2:82:value', l80 if lrate is not None else None, lrate or Decimal(0), label='(80)の10.3%相当額',
                formula=f'(80)×{pct(lrate) if lrate else "—"}%', refs=['b1n2:80:value'], basis=B_LOCAL)
    l83 = _rate(ctx, 'b1n2:83:value', l81 if lrate is not None else None, lrate or Decimal(0), label='(81)の10.3%相当額',
                formula=f'(81)×{pct(lrate) if lrate else "—"}%', refs=['b1n2:81:value'], basis=B_LOCAL)
    l31 = ctx.put(_k('31'), l82, label='地方法人税額', formula='(82)', refs=['b1n2:82:value'], basis=B_LOCAL)
    l32 = ctx.put(_k('32'), 0, label='税額控除超過額相当額の加算額', formula='該当なし（対象外）')
    l33 = ctx.put(_k('33'), l83, label='課税留保金額に係る地方法人税額', formula='(83)', refs=['b1n2:83:value'])
    l34 = ctx.put(_k('34'), opt_add(l31, l32, l33), label='所得地方法人税額', formula='(31)+(32)+(33)',
                  refs=[_k('31'), _k('32'), _k('33')], basis=B_LOCAL)
    l35 = ctx.put(_k('35'), 0, label='分配時調整外国税相当額等の控除額', formula='該当なし（対象外）')
    l36 = ctx.put(_k('36'), 0, label='仮装経理に基づく過大申告の更正に伴う控除地方法人税額', formula='該当なし（対象外）')
    l37 = ctx.put(_k('37'), 0, label='外国税額の控除額', formula='該当なし（外国税額控除は未対応）')
    raw38 = opt_sub(opt_sub(opt_sub(l34, l35), l36), l37)
    l38 = ctx.put(_k('38'), None if raw38 is None else floor_unit(max(raw38, 0), TAX_AMOUNT_UNIT), label='差引地方法人税額',
                  formula='(34)−(35)−(36)−(37)（100円未満切捨て）', refs=[_k('34'), _k('35'), _k('36'), _k('37')],
                  basis=B_LOCAL + [B_ROUND_AMT])
    l39 = ctx.put(_k('39'), t.interim_local_corporate_tax, label='中間申告分の地方法人税額', source='input', basis=B_LOCAL)
    diff40 = opt_sub(l38, l39)
    l40 = ctx.put(_k('40'), None if diff40 is None else max(diff40, 0), label='差引確定地方法人税額',
                  formula='(38)−(39)（マイナスの場合は(42)へ）', refs=[_k('38'), _k('39')], basis=B_LOCAL)
    l41 = ctx.put(_k('41'), 0, label='外国税額の還付金額', formula='該当なし')
    l42 = ctx.put(_k('42'), None if diff40 is None else max(-diff40, 0), label='中間納付額', formula='(39)−(38)',
                  refs=[_k('38'), _k('39')])
    ctx.put(_k('43'), opt_add(l41, l42), label='還付金額 計', formula='(41)+(42)', refs=[_k('41'), _k('42')])

    # ------------------------------------------------------------ 防衛特別法人税
    v_n1 = ctx.view('b1n1', '別表一次葉一', '防衛特別法人税額の計算', [('value', '金額')])
    drule = reg.for_period('defense_special_corporate_tax', p.start, p.end)
    l59: Yen = 0
    defense = {'applicable': False}
    if drule is None or drule.status == 'not_applicable':
        v_n1.status = 'not_applicable'
        v_n1.status_note = '令和8年3月31日以前に開始した事業年度は、防衛特別法人税の課税事業年度に当たりません（防確法第11条、改正法附則第62条）。'
        ctx.put(_k('59'), 0, label='差引確定防衛特別法人税額', formula='課税事業年度に当たらないため0',
                basis=['防確法第11条'])
        if t.interim_defense_tax:
            ctx.finding('B1_DEFENSE_INTERIM', 'critical', '入力', '防衛特別法人税の中間納付が入力されていますが、課税事業年度に当たりません',
                        '', '入力を確認してください。', [{'type': 'page', 'page': 'tax-inputs', 'section': 'payments'}])
    elif not drule.usable:
        ctx.finding('B1_DEFENSE_RULE', 'critical', 'ルール', '防衛特別法人税のルールが未確認です', '', 'ルールデータを確認してください。', tgt_rules)
        ctx.put(_k('59'), None, label='差引確定防衛特別法人税額', formula='ルール未確認')
        l59 = None
    else:
        ctx.use_rule(drule)
        defense['applicable'] = True
        drate = drule.dec('rate')
        l45 = ctx.put(_k('45'), opt_add(opt_sub(l2, l3), l4, l6), label='基準法人税額 所得の金額に対する法人税額',
                      formula='(2)−(3)+(4)+(6)+(9の外書)−…（所得税額控除等を適用しない法人税額）',
                      refs=[_k('2'), _k('3'), _k('4'), _k('6')], basis=B_DEF)
        l46 = ctx.put(_k('46'), l8, label='基準法人税額 課税留保金額に対する法人税額', formula='(8)', refs=[_k('8')], basis=B_DEF)
        l47 = ctx.put(_k('47'), prorate(drule.yen('basic_deduction_annual'), months), label='基礎控除額',
                      formula=f'500万円×{months}/12', basis=B_DEF,
                      notes=['1円未満の端数は切り捨てて表示（法令上の端数処理は未確認）'] if months != 12 else [])
        if months != 12:
            ctx.finding('B1_DEFENSE_SHORT', 'info', 'ルール', '短い事業年度の防衛特別法人税の基礎控除額',
                        f'基礎控除額を500万円×{months}/12で計算し、1円未満を切り捨てています。'
                        '課税標準法人税額は千円未満切捨てのため通常は影響しませんが、法令上の端数処理は確認していません。',
                        '境目の金額のときは専門家に確認してください。', [{'type': 'cell', 'key': _k('47')}])
        l48 = ctx.put(_k('48'), None if l45 is None else max(l47 - l45, 0), label='基礎控除残額',
                      formula='(47)−(45)（マイナスの場合は0）', refs=[_k('47'), _k('45')], basis=B_DEF)
        l67 = ctx.put(_k('67'), None if l45 is None else floor_unit(max(l45 - l47, 0), TAX_BASE_UNIT),
                      label='所得の金額に対する法人税額に係る課税標準法人税額', formula='(45)−(47)（マイナスの場合は0、1,000円未満切捨て）',
                      refs=[_k('45'), _k('47')], basis=B_DEF + [B_ROUND_BASE])
        l68 = _rate(ctx, _k('68'), l67, drate, label='同上の4%相当額', formula='(67)×4%', refs=[_k('67')], basis=B_DEF)
        l69 = ctx.put(_k('69'), None if l48 is None else floor_unit(max(l46 - l48, 0), TAX_BASE_UNIT),
                      label='課税留保金額に対する法人税額に係る課税標準法人税額', formula='(46)−(48)（マイナスの場合は0）',
                      refs=[_k('46'), _k('48')], basis=B_DEF + [B_ROUND_BASE])
        l70 = _rate(ctx, _k('70'), l69, drate, label='同上の4%相当額', formula='(69)×4%', refs=[_k('69')], basis=B_DEF)
        ctx.put(_k('49'), opt_add(l67, l69), label='課税標準法人税額', formula='(67)+(69)', refs=[_k('67'), _k('69')], basis=B_DEF)
        l50 = ctx.put(_k('50'), l68, label='防衛特別法人税額', formula='(68)', refs=[_k('68')], basis=B_DEF)
        l51 = ctx.put(_k('51'), 0, label='税額控除超過額相当額の加算額', formula='該当なし（対象外）')
        l52 = ctx.put(_k('52'), l70, label='課税留保金額に係る防衛特別法人税額', formula='(70)', refs=[_k('70')])
        l53 = ctx.put(_k('53'), opt_add(l50, l51, l52), label='防衛特別法人税額計', formula='(50)+(51)+(52)',
                      refs=[_k('50'), _k('51'), _k('52')], basis=B_DEF)
        l54 = ctx.put(_k('54'), 0, label='分配時調整外国税相当額等の控除額', formula='該当なし（対象外）')
        l55 = ctx.put(_k('55'), 0, label='仮装経理に基づく過大申告の更正に伴う控除防衛特別法人税額', formula='該当なし（対象外）')
        l56 = ctx.put(_k('56'), 0, label='外国税額の控除額', formula='該当なし（外国税額控除は未対応）')
        raw57 = opt_sub(opt_sub(opt_sub(l53, l54), l55), l56)
        l57 = ctx.put(_k('57'), None if raw57 is None else floor_unit(max(raw57, 0), TAX_AMOUNT_UNIT), label='差引防衛特別法人税額',
                      formula='(53)−(54)−(55)−(56)（100円未満切捨て）', refs=[_k('53'), _k('54'), _k('55'), _k('56')],
                      basis=B_DEF + [B_ROUND_AMT])
        l58 = ctx.put(_k('58'), t.interim_defense_tax, label='中間申告分の防衛特別法人税額', source='input', basis=B_DEF)
        interim_from = drule.get('interim_filing_from_fy_start')
        if t.interim_defense_tax and interim_from and p.start.isoformat() < interim_from:
            ctx.finding('B1_DEFENSE_INTERIM_EARLY', 'warning', '入力', '防衛特別法人税の中間申告分が入力されています',
                        '中間申告は令和9年4月1日以後に開始する事業年度からです。', '入力を確認してください。',
                        [{'type': 'cell', 'key': _k('58')}])
        diff59 = opt_sub(l57, l58)
        l59 = ctx.put(_k('59'), None if diff59 is None else max(diff59, 0), label='差引確定防衛特別法人税額',
                      formula='(57)−(58)（マイナスの場合は(61)へ）', refs=[_k('57'), _k('58')], basis=B_DEF)
        ctx.put(_k('60'), 0, label='外国税額の還付金額', formula='該当なし')
        ctx.put(_k('61'), None if diff59 is None else max(-diff59, 0), label='中間納付額', formula='(58)−(57)',
                refs=[_k('57'), _k('58')])
        ctx.finding('B1_DEFENSE_FILING', 'info', '申告', '防衛特別法人税の確定申告が必要です',
                    '令和8年4月1日以後に開始する事業年度は、税額が0円でも防衛特別法人税の確定申告書（別表一次葉一）の提出が必要です'
                    '（国税庁「防衛特別法人税に関するQ&A」）。',
                    '別表一次葉一を添付してください。', [{'type': 'schedule', 'key': 'b1n1'}])
        for line, label in (('45', '基準法人税額 所得の金額に対する法人税額'), ('46', '基準法人税額 課税留保金額に対する法人税額'),
                            ('47', '基礎控除額'), ('48', '基礎控除残額'), ('49', '課税標準法人税額 (67)+(69)'),
                            ('50', '防衛特別法人税額 (68)'), ('51', '税額控除超過額相当額の加算額'), ('52', '課税留保金額に係る防衛特別法人税額 (70)'),
                            ('53', '防衛特別法人税額計'), ('54', '分配時調整外国税相当額等の控除額'), ('55', '仮装経理に基づく控除防衛特別法人税額'),
                            ('56', '外国税額の控除額'), ('57', '差引防衛特別法人税額'), ('58', '中間申告分の防衛特別法人税額'),
                            ('59', '差引確定防衛特別法人税額'), ('60', '外国税額の還付金額'), ('61', '中間納付額'),
                            ('67', '所得の金額に対する法人税額に係る課税標準法人税額'), ('68', '同上の4%相当額'),
                            ('69', '課税留保金額に対する法人税額に係る課税標準法人税額'), ('70', '同上の4%相当額')):
            v_n1.row(line, label, {'value': _k(line)}, kind='total' if line == '59' else 'row')
    defense['final'] = l59

    for line, label in (('1', '所得金額又は欠損金額'), ('2', '法人税額'), ('3', '法人税額の特別控除額'),
                        ('4', '税額控除超過額相当額等の加算額'), ('6', '土地譲渡利益金額に対する税額'), ('8', '課税留保金額に対する税額'),
                        ('9', '法人税額計'), ('10', '分配時調整外国税相当額等の控除額'), ('11', '仮装経理に基づく控除法人税額'),
                        ('12', '控除税額'), ('13', '差引所得に対する法人税額'), ('14', '中間申告分の法人税額'),
                        ('15', '差引確定法人税額'), ('16', '控除税額の計算 所得税の額'), ('17', '控除税額の計算 外国税額'),
                        ('18', '控除税額の計算 計'), ('19', '控除した金額'), ('20', '控除しきれなかった金額'),
                        ('21', '所得税額等の還付金額'), ('22', '中間納付額'), ('23', '欠損金の繰戻しによる還付請求税額'),
                        ('24', '還付金額 計'), ('26', '欠損金等の当期控除額'), ('27', '翌期へ繰り越す欠損金額'),
                        ('28', '所得の金額に対する法人税額'), ('29', '課税留保金額に対する法人税額'), ('30', '課税標準法人税額'),
                        ('31', '地方法人税額'), ('32', '税額控除超過額相当額の加算額'), ('33', '課税留保金額に係る地方法人税額'),
                        ('34', '所得地方法人税額'), ('35', '分配時調整外国税相当額等の控除額'), ('36', '仮装経理に基づく控除地方法人税額'),
                        ('37', '外国税額の控除額'), ('38', '差引地方法人税額'), ('39', '中間申告分の地方法人税額'),
                        ('40', '差引確定地方法人税額'), ('41', '外国税額の還付金額'), ('42', '中間納付額'), ('43', '還付金額 計')):
        v_main.row(line, label, {'value': _k(line)}, kind='total' if line in ('15', '40') else 'row')
    for line, label in (('74', '(1)のうち中小法人等の年800万円相当額以下の金額'), ('76', 'その他の所得金額'),
                        ('77', '(74)の15%、17%又は19%相当額'), ('79', '(76)の19%又は23.2%相当額'),
                        ('80', '所得の金額に対する法人税額 (28)'), ('81', '課税留保金額に対する法人税額 (29)'),
                        ('82', '(80)の10.3%相当額'), ('83', '(81)の10.3%相当額')):
        v_n2.row(line, label, {'value': f'b1n2:{line}:value'})

    return {'corporate_final': l15, 'local_final': l40, 'defense_final': l59, 'corporate_refund': opt_add(l21, l22),
            'local_refund': l42, 'defense_applicable': defense['applicable'], 'income': l1, 'corporate_tax': l13}

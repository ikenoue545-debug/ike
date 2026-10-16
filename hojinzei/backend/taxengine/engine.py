"""計算エンジン：入力から別表を依存関係の順に計算する。

順序（反復計算はしない。理由は設計書6「循環参照について」）：
  1. 対象範囲・中小法人の判定
  2. 別表六(一) 所得税額控除      → 別表四「29」、別表一「16」
  3. 別表十五 交際費等             → 別表四「8」
  4. 別表五(二) 納付状況・納税充当金 → 別表四「2」「3」「4」「5」「13」
  5. 別表四「1」〜「43」
  6. 別表七(一) 欠損金の当期控除額  → 別表四「44」
  7. 別表四「44」〜「52」、別表七(一) 当期分
  8. 別表一 法人税・地方法人税・防衛特別法人税
  9. 別表五(二) 当期確定分
 10. 別表五(一) 利益積立金額（検算）
 11. 別表間の整合性チェック・必要な別表の判定
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import date
from typing import Any, Optional

from . import __version__
from .cells import Ctx, Finding
from .checks import cross_checks, required_schedules
from .model import Adjustment, ReturnInput
from .money import Yen, opt_add
from .periods import filing_deadline, months_in_period
from .rules.registry import RuleRegistry, default_registry
from .schedules import b1, b4, b5_1, b5_2, b6_1, b7_1, b15
from .scope import check_scope, is_sme

SCHEDULE_ORDER = ['b1', 'b1n1', 'b1n2', 'b4', 'b5_1', 'b5_2', 'b6_1', 'b7_1', 'b15']


@dataclass
class ReturnResult:
    engine_version: str
    input_hash: str
    months: int
    sme: Optional[bool]
    cells: dict[str, dict]
    schedules: list[dict]
    findings: list[dict]
    rules_used: list[dict]
    required: list[dict]
    summary: dict[str, Any]
    adjustments: list[dict] = field(default_factory=list)
    carryforward: dict[str, Any] = field(default_factory=dict)

    @property
    def critical_count(self) -> int:
        return sum(1 for f in self.findings if f['severity'] == 'critical')

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _json_default(o: Any) -> Any:
    if isinstance(o, date):
        return o.isoformat()
    raise TypeError(type(o))


def input_hash(inp: ReturnInput) -> str:
    raw = json.dumps(asdict(inp), default=_json_default, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()


def engine_adjustments(inp: ReturnInput, d: b5_2.Derived, credit: Yen, suspense_withheld: Yen,
                       ent_nondeductible: Yen) -> list[Adjustment]:
    """別表五(二)・六(一)・十五から自動で作る税務調整。"""
    out: list[Adjustment] = []

    def add(id_, name, line, direction, disp, amount, basis, five1=None, col='increase', note=''):
        out.append(Adjustment(id=id_, name=name, line=line, direction=direction, disposition=disp, amount=amount,
                              status='auto', five1_key=five1[0] if five1 else None, five1_name=five1[1] if five1 else None,
                              five1_column=col, basis=tuple(basis), origin='engine', note=note, confirmed=True))

    add('engine-b4-2', '損金経理をした法人税、地方法人税及び防衛特別法人税', '2', 'add', 'ryuho', d.national_expense,
        ['法人税法第38条第1項', '別表五(二)「5の⑤」'])
    add('engine-b4-3', '損金経理をした道府県民税及び市町村民税', '3', 'add', 'ryuho', d.resident_expense,
        ['法人税法第38条第2項', '別表五(二)「10の⑤」＋「15の⑤」'])
    add('engine-b4-4', '損金経理をした納税充当金', '4', 'add', 'ryuho', d.provision_charged,
        ['別表五(二)「31」'])
    add('engine-b4-5', '損金経理をした附帯税・加算金・延滞金・過怠税', '5', 'add', 'sonota', d.nondeductible_expense,
        ['法人税法第55条', '別表五(二) その他（損金不算入）の⑤'])
    add('engine-b4-13', '納税充当金から支出した事業税等の金額', '13', 'deduct', 'ryuho', d.from_provision_deductible,
        ['別表五(二)「35」＋「36」'])
    add('engine-b4-8', '交際費等の損金不算入額', '8', 'add', 'sonota', ent_nondeductible,
        ['租税特別措置法第61条の4', '別表十五「5」'])
    add('engine-b4-29', '法人税額から控除される所得税額', '29', 'add', 'sonota', credit,
        ['法人税法第40条', '法人税法第68条', '別表六(一)「6の③」'])
    if d.suspense_enterprise:
        add('engine-suspense-enterprise', '仮払経理した事業税等（認定損）', '21', 'deduct', 'ryuho', d.suspense_enterprise,
            ['別表五(二)「19の④」'], five1=('suspense_tax', '仮払税金'),
            note='事業税等を仮払経理で納付し費用にしていないため、当期の損金として減算します。')
    if suspense_withheld:
        add('engine-suspense-withholding', '仮払経理した源泉所得税（認定損）', '21', 'deduct', 'ryuho', suspense_withheld,
            ['別表六(一)'], five1=('suspense_tax', '仮払税金'),
            note='源泉所得税を仮払経理しているため減算し、控除を受ける額は「29」で加算します。')
    if d.suspense_other:
        out.append(Adjustment(id='engine-suspense-other', name='仮払経理したその他の租税公課', line='21', direction='deduct',
                              disposition='ryuho', amount=d.suspense_other, status='review', five1_key='suspense_tax',
                              five1_name='仮払税金', origin='engine',
                              note='損金不算入の附帯税を仮払経理した場合は、減算せず社外流出の処理が必要です。内容を確認してください。'))
    if d.nondeductible_from_provision:
        add('engine-provision-nd-ded', '納税充当金から支出した損金不算入の附帯税等', '21', 'deduct', 'ryuho',
            d.nondeductible_from_provision, ['別表五(二)「37」'], five1=('provision_nd', '納税充当金から支出した附帯税等'),
            note='納税充当金（利益積立金）が減少した分を留保で減算し、同額を社外流出で加算します。')
        add('engine-provision-nd-add', '納税充当金から支出した損金不算入の附帯税等', '10', 'add', 'sonota',
            d.nondeductible_from_provision, ['法人税法第55条', '別表五(二)「37」'])
    return out


def compute_return(inp: ReturnInput, registry: Optional[RuleRegistry] = None) -> ReturnResult:
    reg = registry or default_registry()
    ctx = Ctx(inp.overrides)
    p = inp.period
    months = months_in_period(p.start, p.end)
    if months > 12:
        ctx.finding('PERIOD_TOO_LONG', 'critical', '入力', '事業年度が1年を超えています', f'月数が {months} か月です。',
                    '事業年度の開始日・終了日を確認してください。', [{'type': 'page', 'page': 'company'}])

    form = reg.for_period('return_forms', p.start, p.end)
    if form is None or not form.usable:
        ctx.finding('FORM_VERSION', 'critical', 'ルール', 'この事業年度の申告書様式は未対応です',
                    '本システムの別表は「令和8年4月1日以後終了事業年度等分」の様式に合わせています。'
                    'これより前に終了した事業年度は、行番号の対応を確認していません。',
                    '別の方法で作成してください。', [{'type': 'page', 'page': 'rules'}])
    else:
        ctx.use_rule(form)
    rounding = reg.for_period('national_tax_rounding', p.start, p.end)
    if rounding:
        ctx.use_rule(rounding)

    check_scope(ctx, inp)
    sme = is_sme(ctx, inp)

    w = b6_1.compute(ctx, inp)
    ent = b15.compute(ctx, inp, reg, months, sme)
    d = b5_2.part_a(ctx, inp)
    adjustments = engine_adjustments(inp, d, w['credit'], w['suspense_withheld'], ent) + list(inp.adjustments)

    b4.part_a(ctx, inp, adjustments)
    loss_rule = reg.for_period('loss_carryforward', p.start, p.end)
    loss_ded = b7_1.part_a(ctx, inp, loss_rule, sme)
    b4.part_b(ctx, loss_ded)
    loss_carry = b7_1.part_b(ctx, inp)

    taxes = b1.compute(ctx, inp, reg, months, sme, w['credit'], loss_ded, loss_carry)
    final_national = opt_add(taxes['corporate_final'], taxes['local_final'], taxes['defense_final'])
    finals = b5_2.part_b(ctx, inp, d, final_national)
    b5 = b5_1.compute(ctx, inp, adjustments, d, finals)

    cross_checks(ctx, inp)
    required = required_schedules(ctx, inp, taxes['defense_applicable'])

    for key in ctx.unused_overrides():
        ctx.finding('OVERRIDE_UNUSED', 'warning', '手入力', '使われていない上書きがあります',
                    f'欄 {key} の上書きは、現在の計算に該当する欄がないため使われていません。',
                    '不要なら上書きを取り消してください。', [{'type': 'cell', 'key': key}])

    local_final = opt_add(inp.taxes.final_prefectural, inp.taxes.final_municipal, inp.taxes.final_enterprise or 0)
    provision_note = '当期確定分の法人税・地方法人税・防衛特別法人税（計算値）＋住民税・事業税等（入力値）'
    if inp.taxes.final_enterprise is None:
        provision_note += '。事業税・特別法人事業税は未入力のため含めていません'
    summary = {
        'company_name': inp.company_name,
        'period_start': p.start.isoformat(), 'period_end': p.end.isoformat(), 'months': months,
        'filing_deadline': filing_deadline(p.end).isoformat(),
        'sme': sme,
        'income': taxes['income'],
        'corporate_tax': taxes['corporate_tax'],
        'corporate_final': taxes['corporate_final'],
        'local_corporate_final': taxes['local_final'],
        'defense_applicable': taxes['defense_applicable'],
        'defense_final': taxes['defense_final'],
        'national_final_total': final_national,
        'corporate_refund': taxes['corporate_refund'],
        'local_refund': taxes['local_refund'],
        'loss_deduction': loss_ded,
        'loss_carryforward': loss_carry,
        'retained_earnings_close': b5['total_close'],
        'recommended_tax_provision': opt_add(final_national, local_final),
        'recommended_tax_provision_note': provision_note,
    }
    carry = {
        'retained_items': [i for i in b5['items'] if i['amount']],
        'retained_total': b5['total_close'],
        'losses': [{'fy_start': l.fy_start.isoformat(), 'fy_end': l.fy_end.isoformat(),
                    'amount': ctx.val(f'b7_1:r{i}:5')}
                   for i, l in enumerate(sorted(inp.opening.losses, key=lambda x: x.fy_start), start=1)
                   if ctx.val(f'b7_1:r{i}:5')]
                  + ([{'fy_start': p.start.isoformat(), 'fy_end': p.end.isoformat(), 'amount': ctx.val('b7_1:cur:5')}]
                     if ctx.val('b7_1:cur:5') else []),
        'unpaid': {'national': ctx.val('b5_2:5:6'), 'prefectural': ctx.val('b5_2:10:6'),
                   'municipal': ctx.val('b5_2:15:6'), 'enterprise_final': inp.taxes.final_enterprise},
        'unpaid_detail': {'corporate': taxes['corporate_final'], 'local_corporate': taxes['local_final'],
                          'defense': taxes['defense_final']},
        'provision_close': ctx.val('b5_2:41:value'),
    }
    order = {k: i for i, k in enumerate(SCHEDULE_ORDER)}
    views = sorted(ctx.views.values(), key=lambda v: order.get(v.id, 99))
    sev = {'critical': 0, 'warning': 1, 'info': 2}
    findings = sorted(ctx.findings, key=lambda f: sev[f.severity])
    return ReturnResult(
        engine_version=__version__, input_hash=input_hash(inp), months=months, sme=sme,
        cells={k: c.to_dict() for k, c in ctx.cells.items()},
        schedules=[v.to_dict() for v in views],
        findings=[_dedupe_key(f) for f in _dedupe(findings)],
        rules_used=[rv.to_dict() for rv in ctx.rules_used.values()],
        required=required, summary=summary,
        adjustments=[{**asdict(a), 'basis': list(a.basis)} for a in adjustments],
        carryforward=carry,
    )


def _dedupe(findings: list[Finding]) -> list[Finding]:
    seen, out = set(), []
    for f in findings:
        if f.fingerprint in seen:
            continue
        seen.add(f.fingerprint)
        out.append(f)
    return out


def _dedupe_key(f: Finding) -> dict:
    return f.to_dict()

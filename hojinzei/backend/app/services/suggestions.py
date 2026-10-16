"""税務調整の候補の抽出（規則による。生成AIは使わない）。

科目名だけで課税関係を確定しない：候補は「要確認」「資料不足」「対象外・未対応」の判定で作り、
金額が決まらないものは空欄（未確定）のまま、担当者の採用・不要の判断を待つ。
"""
from __future__ import annotations

from collections import defaultdict
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from taxengine.cells import Finding

from ..models import FiscalYear, JournalLine, TaxAdjustment
from .trial_balance import TBAnalysis

PENALTY_WORDS = ('延滞税', '加算税', '延滞金', '重加算', '過少申告', '無申告', '不納付', '過怠税', '加算金')

# 試算表の画面で科目に付ける印
TAX_FLAGS: dict[str, str] = {
    'entertainment': '交際費等の損金不算入（別表十五）の確認',
    'meeting': '会議費に交際費等が含まれていないかの確認',
    'officer_compensation': '役員給与（定期同額給与など）の確認',
    'officer_bonus': '役員賞与：事前確定届出給与でなければ損金不算入',
    'donations': '寄附金の損金算入限度額（別表十四(二)）',
    'taxes_and_dues': '租税公課の損金算入・不算入の区分（別表五(二)）',
    'depreciation': '減価償却の償却限度額（別表十六）',
    'penalties': '罰金・科料等は損金不算入',
    'dividend_income': '受取配当等の益金不算入（別表八(一)）',
    'interest_income': '源泉所得税の所得税額控除（別表六(一)）',
    'corporate_taxes': '法人税等の納付状況（別表五(二)）',
    'income_taxes_payable': '納税充当金（別表五(二)）',
    'suspense_tax': '仮払税金の処理（別表四・五(一)・五(二)）',
    'bad_debt': '貸倒損失・貸倒引当金の要件',
    'refund_receivable': '還付金の益金不算入（別表四）',
}


def _amount(analysis: TBAnalysis, category: str) -> Optional[int]:
    vals = [r.line.closing for r in analysis.rows if r.account.category == category]
    return sum(v or 0 for v in vals) if vals else None


def _names(analysis: TBAnalysis, category: str) -> list[str]:
    return [r.account.name for r in analysis.rows if r.account.category == category]


def monthly_amounts(db: Session, fy_id: int, account_names: list[str]) -> dict[str, int]:
    q = select(JournalLine).where(JournalLine.fiscal_year_id == fy_id, JournalLine.account_name.in_(account_names))
    out: dict[str, int] = defaultdict(int)
    for jl in db.scalars(q):
        if jl.entry_date is None:
            continue
        sign = 1 if jl.side == 'debit' else -1
        out[jl.entry_date.strftime('%Y-%m')] += sign * jl.amount
    return dict(sorted(out.items()))


def candidates(db: Session, fy: FiscalYear, analysis: TBAnalysis) -> list[dict]:
    """作るべき候補の一覧（suggestion_key ごと）。"""
    out: list[dict] = []
    has_journal = db.scalar(select(JournalLine.id).where(JournalLine.fiscal_year_id == fy.id).limit(1)) is not None

    if analysis.hints.get('has_officer_compensation'):
        names = _names(analysis, 'officer_compensation')
        total = _amount(analysis, 'officer_compensation')
        base = dict(key='officer_compensation', kind='officer_compensation', name='役員給与の損金不算入額', line='7',
                    direction='add', disposition='sonota', target_amount=total, account_names=names,
                    basis=['法人税法第34条第1項'],
                    questions=['役員ごとに毎月同じ額を支給しているか（定期同額給与）',
                               '改定は事業年度開始から3か月以内の通常改定か、臨時改定事由・業績悪化改定事由に当たるか',
                               '株主総会等の議事録で支給額を決議しているか'])
        if not has_journal:
            out.append({**base, 'status': 'missing',
                        'reason': '仕訳帳がないため、月ごとの支給額を確認できません。定期同額給与に当たらない支給は損金不算入になる可能性があります。',
                        'evidence': []})
        else:
            months = monthly_amounts(db, fy.id, names)
            distinct = sorted({v for v in months.values() if v})
            if len(distinct) > 1:
                out.append({**base, 'status': 'review',
                            'reason': f'月ごとの支給額が一定ではありません（{len(distinct)}通りの額）。改定の時期と理由によっては、'
                                      '増額分などが損金不算入になります。',
                            'evidence': [{'type': 'monthly', 'account_names': names, 'months': months}]})
    if analysis.hints.get('has_officer_bonus'):
        out.append(dict(key='officer_bonus', kind='officer_bonus', name='役員給与の損金不算入額（役員賞与）', line='7',
                        direction='add', disposition='sonota', target_amount=_amount(analysis, 'officer_bonus'),
                        account_names=_names(analysis, 'officer_bonus'), status='review', basis=['法人税法第34条第1項'],
                        reason='役員への賞与は、事前確定届出給与として所轄税務署へ届け出て、届出どおりに支給した場合を除き損金不算入です。',
                        questions=['事前確定届出給与に関する届出書を期限内に提出したか', '届出額と支給額・支給日が一致しているか'],
                        evidence=[]))
    if analysis.hints.get('has_donations'):
        out.append(dict(key='donations', kind='donations', name='寄附金の損金不算入額', line='27', direction='add',
                        disposition='sonota', target_amount=_amount(analysis, 'donations'),
                        account_names=_names(analysis, 'donations'), status='unsupported', basis=['法人税法第37条'],
                        reason='寄附金は、国・地方公共団体に対するもの、指定寄附金、特定公益増進法人に対するもの、一般の寄附金で'
                               '損金算入限度額が異なります。別表十四(二)の計算は本システムで未実装です（Phase 3）。',
                        questions=['寄附先と寄附の種類', '受領書などの証明書類'], evidence=[]))
    if analysis.hints.get('has_depreciation'):
        out.append(dict(key='depreciation', kind='depreciation_excess', name='減価償却の償却超過額', line='6',
                        direction='add', disposition='ryuho', five1_key='depreciation_excess', five1_name='減価償却超過額',
                        target_amount=_amount(analysis, 'depreciation'), account_names=_names(analysis, 'depreciation'),
                        status='missing', basis=['法人税法第31条'],
                        reason='会計上の減価償却費が税務上の償却限度額を超えると、超過額は損金不算入です。固定資産台帳（取得価額・'
                               '取得日・耐用年数・償却方法）と別表十六の計算が必要です（別表十六の計算は Phase 3）。',
                        questions=['固定資産台帳', '償却方法の届出', '少額減価償却資産の特例（令和8年4月1日以後の取得は40万円未満）の適用'],
                        evidence=[]))
    if analysis.hints.get('has_dividend_income'):
        out.append(dict(key='dividend_income', kind='dividend_exclusion', name='受取配当等の益金不算入額', line='14',
                        direction='deduct', disposition='kome', target_amount=_amount(analysis, 'dividend_income'),
                        account_names=_names(analysis, 'dividend_income'), status='unsupported', basis=['法人税法第23条'],
                        reason='受取配当等は株式等の区分（完全子法人株式等・関連法人株式等・その他・非支配目的）により益金不算入額が'
                               '異なります。別表八(一)の計算は本システムで未実装です（Phase 3）。',
                        questions=['配当の支払法人と持株比率', '配当計算期間と保有期間'], evidence=[]))
    if analysis.hints.get('has_penalties'):
        out.append(dict(key='penalties', kind='penalties', name='罰金・科料等の損金不算入額', line='10', direction='add',
                        disposition='sonota', target_amount=_amount(analysis, 'penalties'), amount=_amount(analysis, 'penalties'),
                        account_names=_names(analysis, 'penalties'), status='review', basis=['法人税法第55条'],
                        reason='罰金・科料・過料・交通反則金は損金不算入です。', questions=['支払の内容（領収書・通知書）'], evidence=[]))
    return out


def sync_candidates(db: Session, fy: FiscalYear, analysis: TBAnalysis, user_id: Optional[int]) -> int:
    """まだない候補を追加する（担当者が判断済みのものは触らない）。戻り値は追加件数。"""
    existing = {a.suggestion_key for a in db.scalars(select(TaxAdjustment).where(
        TaxAdjustment.fiscal_year_id == fy.id, TaxAdjustment.suggestion_key.is_not(None)))}
    n = 0
    for c in candidates(db, fy, analysis):
        if c['key'] in existing:
            continue
        db.add(TaxAdjustment(
            fiscal_year_id=fy.id, kind=c['kind'], name=c['name'], line=c['line'], direction=c['direction'],
            disposition=c['disposition'], amount=c.get('amount'), target_amount=c.get('target_amount'), status=c['status'],
            decision='pending', five1_key=c.get('five1_key'), five1_name=c.get('five1_name'),
            account_names=c.get('account_names', []), reason=c['reason'], basis=c['basis'], evidence=c.get('evidence', []),
            questions=c.get('questions', []), origin='suggestion', suggestion_key=c['key'], created_by=user_id,
            updated_by=user_id))
        n += 1
    return n


def journal_findings(db: Session, fy: FiscalYear, analysis: TBAnalysis) -> list[Finding]:
    """仕訳の摘要から気付く点（延滞税・加算税など）。"""
    out: list[Finding] = []
    names = _names(analysis, 'taxes_and_dues')
    if not names:
        return out
    q = select(JournalLine).where(JournalLine.fiscal_year_id == fy.id, JournalLine.account_name.in_(names),
                                  JournalLine.side == 'debit')
    hits = [jl for jl in db.scalars(q) if jl.memo and any(w in jl.memo for w in PENALTY_WORDS)]
    if hits:
        total = sum(h.amount for h in hits)
        out.append(Finding('JOURNAL_PENALTY_TAX', 'warning', '税務調整',
                           f'租税公課に延滞税・加算税などの支払が{len(hits)}件あります（計 {total:,} 円）',
                           '延滞税・加算税・延滞金（延納分を除く）・過怠税は損金不算入です（法人税法第55条）。',
                           '「税額の基礎」→「租税公課の納付」で「その他（損金不算入）」として入力してください。'
                           '損金経理していれば別表四「5」で加算されます。',
                           [{'type': 'page', 'page': 'tax-inputs', 'section': 'payments'}] +
                           [{'type': 'journal', 'id': h.id} for h in hits[:10]]))
    return out

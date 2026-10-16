"""必要資料のチェックリストと、不足の判定。"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Document, FiscalYear, ImportBatch, JournalLine
from .trial_balance import TBAnalysis

DOC_KINDS = {
    'trial_balance': '試算表（貸借対照表・損益計算書）',
    'journal': '仕訳帳',
    'financial_statements': '決算書',
    'prior_return': '前期の法人税申告書',
    'fixed_assets': '固定資産台帳',
    'shareholders': '株主名簿',
    'interim_return': '中間申告書の控え',
    'local_tax_return': '地方税の申告書（又は税額の計算資料）',
    'withholding_docs': '受取利息・配当の支払通知書',
    'entertainment_detail': '交際費の明細',
    'other': 'その他',
}


def checklist(db: Session, fy: FiscalYear, analysis: TBAnalysis, sections: dict) -> list[dict]:
    docs: dict[str, int] = dict(db.execute(select(Document.kind, func.count()).where(Document.fiscal_year_id == fy.id)
                                           .group_by(Document.kind)).all())
    imported = {k for (k,) in db.execute(select(ImportBatch.kind).where(ImportBatch.fiscal_year_id == fy.id,
                                                                       ImportBatch.status == 'imported')).all()}
    has_journal = db.scalar(select(JournalLine.id).where(JournalLine.fiscal_year_id == fy.id).limit(1)) is not None
    h = analysis.hints
    tp = sections.get('tax_payments', {})
    interim = any(tp.get(k) for k in ('interim_corporate_tax', 'interim_local_corporate_tax', 'interim_defense_tax'))
    first_year = sections.get('opening_meta', {}).get('first_year', False)

    def item(kind, need, need_reason, ok, how=''):
        status = 'ok' if ok else ('missing' if need == 'required' else 'recommended' if need == 'recommended' else 'not_needed')
        return {'kind': kind, 'label': DOC_KINDS[kind], 'need': need, 'need_reason': need_reason, 'status': status,
                'uploaded': docs.get(kind, 0), 'how': how}

    out = [
        item('trial_balance', 'required', '申告書の基礎になる数値', analysis.has_bs and analysis.has_pl,
             'freee会計：レポート →「試算表」→ 貸借対照表・損益計算書をそれぞれ CSV 出力'),
        item('journal', 'recommended', '科目ごとの仕訳の確認、役員給与・租税公課などの確認', has_journal or 'journal' in imported,
             'freee会計：「仕訳帳」→ CSV 出力（全件）'),
        item('financial_statements', 'recommended', '株主資本等変動計算書（配当など）の確認', docs.get('financial_statements', 0) > 0),
        item('prior_return', 'not_needed' if first_year else 'required', '期首の利益積立金・繰越欠損金・未納税額の確認',
             first_year or docs.get('prior_return', 0) > 0, '前期の別表一・四・五(一)・五(二)・七(一)の PDF'),
        item('fixed_assets', 'required' if h.get('has_depreciation') else 'not_needed', '減価償却の償却限度額の確認',
             docs.get('fixed_assets', 0) > 0),
        item('shareholders', 'required', '別表二（同族会社等の判定）', docs.get('shareholders', 0) > 0),
        item('interim_return', 'required' if interim else 'not_needed', '中間納付額の確認', docs.get('interim_return', 0) > 0),
        item('local_tax_return', 'required', '当期確定分の住民税・事業税（Phase 2 は手入力）', docs.get('local_tax_return', 0) > 0),
        item('withholding_docs', 'required' if (h.get('has_interest_income') or h.get('has_dividend_income')) else 'not_needed',
             '源泉所得税の所得税額控除（別表六(一)）', docs.get('withholding_docs', 0) > 0),
        item('entertainment_detail', 'required' if h.get('has_entertainment_account') else 'not_needed',
             '接待飲食費・1人10,000円以下の飲食費の区分（別表十五）', docs.get('entertainment_detail', 0) > 0),
    ]
    return out

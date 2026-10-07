"""base の単一HTMLを <script> ブロック単位で扱う共通処理（build.py・extract.py から使う）。"""
import re

SCRIPT = re.compile(r'<script>(.*?)</script>', re.S)

# src/ のファイル名 → base の中でそのブロックだけに含まれる目印
MODULES = {
    'variance.js': 'root.ReviewVariance=',
    'settlement.js': 'root.ReviewSettlement=',
    'monthly-page.js': 'F.page=page;',
    'treasury-ui.js': 'root.ReviewTreasuryUI=',
    'engine.js': 'root.ReviewEngine=',
    'financial.js': 'root.ReviewFinancial=',
    'audit-ui.js': 'root.ReviewAuditUI=',
    'app.js': 'window.LedgerApp=',
}


def find_block(html, marker):
    hits = [m for m in SCRIPT.finditer(html) if marker in m.group(1)]
    if len(hits) != 1:
        raise SystemExit(f'marker {marker!r}: expected 1 script block, found {len(hits)}')
    return hits[0]

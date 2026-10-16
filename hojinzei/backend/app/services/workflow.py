"""進捗の管理と承認。"""
from __future__ import annotations

STATUSES: list[tuple[str, str]] = [
    ('not_started', '未着手'), ('collecting', '資料収集中'), ('data_loaded', 'データ読込済'), ('adjusting', '税務調整中'),
    ('drafted', '申告書作成済'), ('in_review', 'レビュー待ち'), ('approved', '承認済'), ('filed', '申告済'),
]
STATUS_LABELS = dict(STATUSES)
ORDER = {k: i for i, (k, _) in enumerate(STATUSES)}
MANUAL = {'not_started', 'collecting', 'data_loaded', 'adjusting', 'drafted', 'in_review'}


def can_set_manually(current: str, target: str) -> tuple[bool, str]:
    if target not in STATUS_LABELS:
        return False, '不明な進捗です'
    if target == 'approved':
        return False, '承認は「最終チェック」の承認ボタンから行います（重大エラーがないことを確認します）'
    if target == 'filed' and current != 'approved':
        return False, '申告済にできるのは承認済の年度だけです'
    if current in ('approved', 'filed') and target in MANUAL:
        return False, '承認済の年度を戻すには「承認の取消し」を使ってください'
    return True, ''


def advance_on(current: str, event: str) -> str:
    """作業に応じて進捗を自動で進める（後戻りはしない）。"""
    target = {'document': 'collecting', 'import': 'data_loaded', 'adjustment': 'adjusting', 'compute': None}.get(event)
    if target and ORDER.get(current, 0) < ORDER[target] and current not in ('approved', 'filed'):
        return target
    return current

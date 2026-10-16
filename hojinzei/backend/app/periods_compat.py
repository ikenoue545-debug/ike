"""日付の小さな補助。"""
from __future__ import annotations

from datetime import date, timedelta

from taxengine.periods import add_months


def add_years_minus_one_day(start: date) -> date:
    """start から1年の期間の末日（例：4月1日 → 翌年3月31日）。"""
    return add_months(start, 12) - timedelta(days=1)

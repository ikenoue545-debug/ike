"""事業年度の月数・期間の計算。

法人税法の「月数は、暦に従って計算し、一月に満たない端数を生じたときは、これを一月とする」
（法人税法第66条第4項ほか）に従う。暦による計算は民法第143条（月の初日から起算しないときは、
最後の月の起算日に応当する日の前日に満了。応当日がなければその月の末日に満了）による。
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta


def add_months(d: date, n: int) -> date:
    """d の n か月後の応当日。応当日がない月は月末（例：1月31日の1か月後は2月末日）。"""
    y, m = divmod(d.month - 1 + n, 12)
    year, month = d.year + y, m + 1
    last = calendar.monthrange(year, month)[1]
    return date(year, month, min(d.day, last))


def add_years(d: date, n: int) -> date:
    return add_months(d, 12 * n)


def _end_of_full_months(start: date, n: int) -> date:
    """start から数えて n か月の期間が満了する日。"""
    if start.day == 1:
        return add_months(start, n) - timedelta(days=1)
    y, m = divmod(start.month - 1 + n, 12)
    year, month = start.year + y, m + 1
    last = calendar.monthrange(year, month)[1]
    if start.day > last:
        # 応当日がない月：その月の末日に満了
        return date(year, month, last)
    return date(year, month, start.day) - timedelta(days=1)


def months_in_period(start: date, end: date) -> int:
    """事業年度の月数（1か月未満の端数は1か月）。"""
    if end < start:
        raise ValueError('months_in_period: 終了日が開始日より前')
    n = 0
    while _end_of_full_months(start, n + 1) <= end:
        n += 1
    full_end = start - timedelta(days=1) if n == 0 else _end_of_full_months(start, n)
    if full_end < end:
        n += 1  # 1か月に満たない端数
    return n


def filing_deadline(fy_end: date, extension_months: int = 0) -> date:
    """確定申告書の提出期限：事業年度終了の日の翌日から2か月以内（法人税法第74条第1項）。
    申告期限の延長の特例（同法第75条の2）を受けている場合は extension_months を加える。
    期限が休日等に当たる場合の翌日への延長（国税通則法第10条第2項）は反映しない。"""
    next_day = fy_end + timedelta(days=1)
    return _end_of_full_months(next_day, 2 + extension_months)

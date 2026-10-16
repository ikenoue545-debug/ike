"""金額の計算。金額はすべて整数円（int）、税率は Decimal で扱い、浮動小数点は使わない。

未確定の金額は None で表す。None を含む計算の結果は None（0円で埋めない）。
"""
from __future__ import annotations

from decimal import Decimal, ROUND_DOWN, ROUND_CEILING
from typing import Iterable, Optional

Yen = Optional[int]


def floor_unit(amount: int, unit: int) -> int:
    """unit 円未満を切り捨てる（0 以上の金額のみ。課税標準は 1,000、確定税額は 100）。"""
    if amount < 0:
        raise ValueError(f'floor_unit: 負の金額は切り捨てない: {amount}')
    return amount - amount % unit


def opt_floor_unit(amount: Yen, unit: int) -> Yen:
    if amount is None:
        return None
    return floor_unit(max(amount, 0), unit)


def apply_rate(amount: int, rate: Decimal) -> tuple[int, bool]:
    """amount × rate。端数が出たら 1 円未満を切り捨て、端数が出たかを返す。"""
    exact = Decimal(amount) * rate
    rounded = exact.to_integral_value(rounding=ROUND_DOWN)
    return int(rounded), rounded != exact


def prorate(annual: int, months: int, unit: int = 1) -> int:
    """年額 × 月数 / 12 を unit 円未満切捨て。"""
    exact = Decimal(annual) * Decimal(months) / Decimal(12)
    value = int(exact.to_integral_value(rounding=ROUND_DOWN))
    return value - value % unit


def ceil_ratio(numerator: int, denominator: int, places: int = 3) -> Decimal:
    """割合を小数点以下 places 位未満切上げ（別表六(一)の所有期間割合）。1 を超えるときは 1。"""
    if denominator <= 0:
        raise ValueError('ceil_ratio: 分母が 0 以下')
    q = Decimal(10) ** -places
    r = (Decimal(numerator) / Decimal(denominator)).quantize(q, rounding=ROUND_CEILING)
    return min(r, Decimal(1))


def opt_sum(values: Iterable[Yen]) -> Yen:
    total = 0
    for v in values:
        if v is None:
            return None
        total += v
    return total


def opt_add(*values: Yen) -> Yen:
    return opt_sum(values)


def opt_sub(a: Yen, b: Yen) -> Yen:
    if a is None or b is None:
        return None
    return a - b


def opt_neg(a: Yen) -> Yen:
    return None if a is None else -a


def opt_min(*values: Yen) -> Yen:
    if any(v is None for v in values):
        return None
    return min(values)  # type: ignore[type-var]


def opt_max0(a: Yen) -> Yen:
    return None if a is None else max(a, 0)


def fmt_yen(v: Yen) -> str:
    if v is None:
        return '未確定'
    if v < 0:
        return f'△{-v:,}'
    return f'{v:,}'


def pct(rate) -> str:
    """Decimal の税率を「15」「23.2」のような百分率の文字列にする。"""
    s = format(rate * 100, 'f')
    return s.rstrip('0').rstrip('.') if '.' in s else s

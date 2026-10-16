"""年度別の税率・ルールの読み込みと選択。

ルールは rules/data/*.json に、ルールごと・版ごとに保存する。版は削除せず追加する運用とし、
過年度の申告を当時の版で再計算できるようにする。

- basis：どの日付で版を選ぶか。fy_start＝事業年度開始日、fy_end＝終了日、expense_date＝支出日。
- status：source_checked＝一次資料と照合済み（専門家レビューは別）、unverified＝未確認（使うと確定不可）、
  not_applicable＝その期間は制度の対象外（例：防衛特別法人税の創設前）。
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any, Optional

DATA_DIR = Path(__file__).resolve().parent / 'data'
BASES = {'fy_start': '事業年度開始日', 'fy_end': '事業年度終了日', 'expense_date': '支出日', 'filing': '提出日'}
STATUSES = {'source_checked': '一次資料と照合済み', 'unverified': '未確認', 'not_applicable': '制度の対象外の期間'}


@dataclass(frozen=True)
class Source:
    title: str
    url: str
    provisions: str = ''
    checked: str = ''


@dataclass(frozen=True)
class RuleVersion:
    rule_id: str
    title: str
    basis: str
    version: str
    valid_from: date
    valid_to: Optional[date]
    applies_to: str
    conditions: str
    values: dict[str, Any]
    sources: tuple[Source, ...]
    status: str
    checked_by: str
    checked_at: str
    expert_review: str
    notes: tuple[str, ...] = field(default_factory=tuple)

    @property
    def ref(self) -> str:
        return f'{self.rule_id}@{self.version}'

    @property
    def usable(self) -> bool:
        return self.status == 'source_checked'

    def dec(self, key: str) -> Decimal:
        v = self.values[key]
        if not isinstance(v, str):
            raise TypeError(f'{self.ref}: {key} は税率（文字列）で定義する')
        return Decimal(v)

    def yen(self, key: str) -> int:
        v = self.values[key]
        if not isinstance(v, int) or isinstance(v, bool):
            raise TypeError(f'{self.ref}: {key} は整数円で定義する')
        return v

    def get(self, key: str, default: Any = None) -> Any:
        return self.values.get(key, default)

    def covers(self, d: date) -> bool:
        return self.valid_from <= d and (self.valid_to is None or d <= self.valid_to)

    def to_dict(self) -> dict[str, Any]:
        return {
            'rule_id': self.rule_id, 'title': self.title, 'basis': self.basis,
            'basis_label': BASES.get(self.basis, self.basis), 'version': self.version,
            'valid_from': self.valid_from.isoformat(),
            'valid_to': self.valid_to.isoformat() if self.valid_to else None,
            'applies_to': self.applies_to, 'conditions': self.conditions, 'values': self.values,
            'sources': [s.__dict__ for s in self.sources], 'status': self.status,
            'status_label': STATUSES.get(self.status, self.status), 'checked_by': self.checked_by,
            'checked_at': self.checked_at, 'expert_review': self.expert_review, 'notes': list(self.notes),
        }


def _parse_date(s: Optional[str]) -> Optional[date]:
    return date.fromisoformat(s) if s else None


class RuleRegistry:
    def __init__(self, data_dir: Path = DATA_DIR):
        self._rules: dict[str, list[RuleVersion]] = {}
        self._meta: dict[str, dict[str, Any]] = {}
        for path in sorted(Path(data_dir).glob('*.json')):
            self._load(path)

    def _load(self, path: Path) -> None:
        raw = json.loads(path.read_text(encoding='utf-8'))
        rid, basis = raw['id'], raw['basis']
        if basis not in BASES:
            raise ValueError(f'{path.name}: basis が不正: {basis}')
        versions = []
        for v in raw['versions']:
            if v['status'] not in STATUSES:
                raise ValueError(f'{path.name}: status が不正: {v["status"]}')
            versions.append(RuleVersion(
                rule_id=rid, title=raw['title'], basis=basis, version=v['version'],
                valid_from=_parse_date(v['valid_from']), valid_to=_parse_date(v.get('valid_to')),
                applies_to=v.get('applies_to', ''), conditions=v.get('conditions', ''),
                values=v.get('values', {}),
                sources=tuple(Source(**s) for s in v.get('sources', [])),
                status=v['status'], checked_by=v.get('checked_by', ''), checked_at=v.get('checked_at', ''),
                expert_review=v.get('expert_review', '未'), notes=tuple(v.get('notes', [])),
            ))
        versions.sort(key=lambda r: r.valid_from)
        for a, b in zip(versions, versions[1:]):
            if a.valid_to is None or a.valid_to >= b.valid_from:
                raise ValueError(f'{path.name}: 版 {a.version} と {b.version} の適用期間が重なる')
        self._rules[rid] = versions
        self._meta[rid] = {'id': rid, 'title': raw['title'], 'basis': basis, 'description': raw.get('description', '')}

    def ids(self) -> list[str]:
        return list(self._rules)

    def meta(self, rule_id: str) -> dict[str, Any]:
        return self._meta[rule_id]

    def versions(self, rule_id: str) -> list[RuleVersion]:
        return list(self._rules[rule_id])

    def find(self, rule_id: str, on: date) -> Optional[RuleVersion]:
        for v in self._rules.get(rule_id, []):
            if v.covers(on):
                return v
        return None

    def for_period(self, rule_id: str, start: date, end: date) -> Optional[RuleVersion]:
        basis = self._meta[rule_id]['basis']
        if basis == 'fy_start':
            return self.find(rule_id, start)
        if basis == 'fy_end':
            return self.find(rule_id, end)
        raise ValueError(f'{rule_id} は事業年度で選ぶルールではない（basis={basis}）')


_default: Optional[RuleRegistry] = None


def default_registry() -> RuleRegistry:
    global _default
    if _default is None:
        _default = RuleRegistry()
    return _default

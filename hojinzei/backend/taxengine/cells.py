"""計算結果の記録：欄（Cell）、指摘（Finding）、別表の表示順（ScheduleView）。

すべての欄は、値・計算式・参照した欄・根拠条文・出所（入力／計算／上書き）を持つ。
画面の「計算過程」はこの記録をたどって表示する。
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field, asdict
from typing import Any, Iterable, Optional

from .money import Yen, fmt_yen
from .rules.registry import RuleVersion

SEVERITIES = ('critical', 'warning', 'info')
SEVERITY_LABELS = {'critical': '重大エラー', 'warning': '要確認', 'info': '参考情報'}


@dataclass
class Cell:
    key: str
    schedule: str
    line: str
    col: str
    label: str
    value: Yen = None
    formula: str = ''
    refs: list[str] = field(default_factory=list)
    basis: list[str] = field(default_factory=list)
    source: str = 'computed'  # input | computed | override | rule
    computed_value: Yen = None
    override_reason: str = ''
    notes: list[str] = field(default_factory=list)
    unit: str = 'yen'  # yen | text | months | rate
    text: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Finding:
    code: str
    severity: str
    category: str
    title: str
    message: str
    action: str
    targets: list[dict[str, Any]] = field(default_factory=list)

    @property
    def fingerprint(self) -> str:
        t = '|'.join(sorted(f'{d.get("type")}:{d.get("key") or d.get("id") or d.get("page")}' for d in self.targets))
        return hashlib.sha256(f'{self.code}|{t}'.encode()).hexdigest()[:16]

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d['severity_label'] = SEVERITY_LABELS[self.severity]
        d['fingerprint'] = self.fingerprint
        return d


@dataclass
class Override:
    value: Yen
    reason: str
    by: str = ''


@dataclass
class ViewRow:
    line: str
    label: str
    cells: dict[str, str]  # 列 → セルのキー
    kind: str = 'row'  # row | subtotal | total | header | note
    indent: int = 0


@dataclass
class ScheduleView:
    id: str
    title: str
    form_name: str
    columns: list[tuple[str, str]]  # (列ID, 見出し)
    rows: list[ViewRow] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    status: str = 'computed'  # computed | not_applicable | not_required
    status_note: str = ''

    def row(self, line: str, label: str, cells: dict[str, str], kind: str = 'row', indent: int = 0) -> None:
        self.rows.append(ViewRow(line, label, cells, kind, indent))

    def to_dict(self) -> dict[str, Any]:
        return {
            'id': self.id, 'title': self.title, 'form_name': self.form_name,
            'columns': [{'id': c, 'label': l} for c, l in self.columns],
            'rows': [asdict(r) for r in self.rows], 'notes': self.notes,
            'status': self.status, 'status_note': self.status_note,
        }


class Ctx:
    """1回の計算の作業領域。"""

    def __init__(self, overrides: Optional[dict[str, Override]] = None):
        self.cells: dict[str, Cell] = {}
        self.findings: list[Finding] = []
        self.rules_used: dict[str, RuleVersion] = {}
        self.views: dict[str, ScheduleView] = {}
        self.overrides = dict(overrides or {})
        self._used_overrides: set[str] = set()

    # --- 欄 ---------------------------------------------------------------
    def put(self, key: str, value: Yen, *, label: str, formula: str = '', refs: Iterable[str] = (),
            basis: Iterable[str] = (), source: str = 'computed', notes: Iterable[str] = (),
            overridable: bool = True) -> Yen:
        if key in self.cells:
            raise KeyError(f'欄 {key} を二度計算しようとした')
        schedule, line, col = key.split(':', 2)
        cell = Cell(key=key, schedule=schedule, line=line, col=col, label=label, value=value,
                    formula=formula, refs=list(refs), basis=list(basis), source=source, notes=list(notes))
        ov = self.overrides.get(key)
        if ov is not None and overridable:
            self._used_overrides.add(key)
            cell.computed_value = value
            cell.value = ov.value
            cell.source = 'override'
            cell.override_reason = ov.reason
            self.finding('OVERRIDE_USED', 'warning', '手入力', f'{label}を手入力で上書きしています',
                         f'計算値 {fmt_yen(value)} 円を {fmt_yen(ov.value)} 円に上書き（理由：{ov.reason}）。'
                         'これを使って後の計算をしています。',
                         '上書きが必要か、計算の元になる入力を直せないか確認してください。',
                         [{'type': 'cell', 'key': key}])
        self.cells[key] = cell
        return cell.value

    def text(self, key: str, text: str, *, label: str, formula: str = '', basis: Iterable[str] = (),
             notes: Iterable[str] = (), unit: str = 'text') -> None:
        schedule, line, col = key.split(':', 2)
        self.cells[key] = Cell(key=key, schedule=schedule, line=line, col=col, label=label, value=None,
                               formula=formula, basis=list(basis), source='computed', notes=list(notes),
                               unit=unit, text=text)

    def val(self, key: str) -> Yen:
        return self.cells[key].value

    def has(self, key: str) -> bool:
        return key in self.cells

    def note(self, key: str, message: str) -> None:
        self.cells[key].notes.append(message)

    # --- 指摘 ---------------------------------------------------------------
    def finding(self, code: str, severity: str, category: str, title: str, message: str, action: str,
                targets: Optional[list[dict[str, Any]]] = None) -> Finding:
        if severity not in SEVERITIES:
            raise ValueError(severity)
        f = Finding(code, severity, category, title, message, action, targets or [])
        self.findings.append(f)
        return f

    # --- ルール -------------------------------------------------------------
    def use_rule(self, rv: RuleVersion) -> RuleVersion:
        self.rules_used[rv.ref] = rv
        return rv

    # --- 表示 ---------------------------------------------------------------
    def view(self, vid: str, title: str = '', form_name: str = '', columns: Optional[list[tuple[str, str]]] = None) -> ScheduleView:
        if vid not in self.views:
            self.views[vid] = ScheduleView(vid, title, form_name, columns or [])
        return self.views[vid]

    def unused_overrides(self) -> list[str]:
        return [k for k in self.overrides if k not in self._used_overrides]

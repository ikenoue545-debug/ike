"""監査ログ。金額・個人情報・ファイルの中身は記録しない（項目名や ID だけ）。"""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.orm import Session

from .models import AuditLog, User

_FORBIDDEN = ('amount', 'value', 'password', 'token', 'name', 'address', 'phone', 'representative')


def log(db: Session, user: Optional[User], action: str, entity: str | None = None, entity_id: int | None = None,
        company_id: int | None = None, fiscal_year_id: int | None = None, **detail: Any) -> None:
    for k in detail:
        if any(f in k.lower() for f in _FORBIDDEN):
            raise ValueError(f'監査ログに {k} を記録しない')
    db.add(AuditLog(user_id=user.id if user else None, action=action, entity=entity, entity_id=entity_id,
                    company_id=company_id, fiscal_year_id=fiscal_year_id, detail=detail))

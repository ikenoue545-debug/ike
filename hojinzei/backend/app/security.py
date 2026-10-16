"""認証と権限。

- パスワード：scrypt（標準ライブラリ hashlib）でハッシュ化。
- トークン：ランダム32バイト。DB には SHA-256 のハッシュだけを保存し、期限を付ける。
- 役割：admin（管理者）／reviewer（レビュー担当者）／staff（担当者）。
- 会社単位のアクセス権：admin はすべて、それ以外は company_members に登録された会社だけ。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AuthToken, Company, CompanyMember, FiscalYear, User

ROLES = {'admin': '管理者', 'reviewer': 'レビュー担当者', 'staff': '担当者'}
_N, _R, _P = 2 ** 14, 8, 1


def hash_password(password: str) -> str:
    if len(password) < 8:
        raise ValueError('パスワードは8文字以上にしてください')
    salt = os.urandom(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f'scrypt${_N}${_R}${_P}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}'


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, dk = stored.split('$')
        if algo != 'scrypt':
            return False
        got = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p),
                             dklen=len(base64.b64decode(dk)))
        return hmac.compare_digest(got, base64.b64decode(dk))
    except Exception:
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_token(db: Session, user: User, hours: int) -> str:
    token = secrets.token_urlsafe(32)
    db.add(AuthToken(user_id=user.id, token_hash=_token_hash(token),
                     expires_at=datetime.now(timezone.utc) + timedelta(hours=hours)))
    return token


def revoke_token(db: Session, token: str) -> None:
    row = db.scalar(select(AuthToken).where(AuthToken.token_hash == _token_hash(token)))
    if row:
        db.delete(row)


def get_db(request: Request):
    yield from request.app.state.db.session()


def _bearer(request: Request) -> Optional[str]:
    auth = request.headers.get('authorization', '')
    if auth.lower().startswith('bearer '):
        return auth[7:].strip()
    return None


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = _bearer(request)
    if not token:
        raise HTTPException(401, 'ログインしてください')
    row = db.scalar(select(AuthToken).where(AuthToken.token_hash == _token_hash(token)))
    if row is None:
        raise HTTPException(401, 'ログインの有効期限が切れました。もう一度ログインしてください')
    exp = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
    if exp < datetime.now(timezone.utc):
        db.delete(row)
        db.commit()
        raise HTTPException(401, 'ログインの有効期限が切れました。もう一度ログインしてください')
    user = db.get(User, row.user_id)
    if user is None or not user.is_active:
        raise HTTPException(401, '利用できないアカウントです')
    return user


def require_role(user: User, *roles: str) -> None:
    if user.role not in roles:
        raise HTTPException(403, f'この操作は{"・".join(ROLES[r] for r in roles)}だけができます')


def can_access_company(db: Session, user: User, company_id: int) -> bool:
    if user.role == 'admin':
        return True
    return db.get(CompanyMember, (company_id, user.id)) is not None


def get_company_for(db: Session, user: User, company_id: int) -> Company:
    company = db.get(Company, company_id)
    if company is None or not can_access_company(db, user, company_id):
        # 権限のない会社は存在も知らせない
        raise HTTPException(404, '会社が見つかりません')
    return company


def get_fy_for(db: Session, user: User, fy_id: int) -> FiscalYear:
    fy = db.get(FiscalYear, fy_id)
    if fy is None or not can_access_company(db, user, fy.company_id):
        raise HTTPException(404, '事業年度が見つかりません')
    return fy

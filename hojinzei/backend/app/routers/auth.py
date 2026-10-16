"""ログイン・利用者の管理。"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..models import User
from ..security import ROLES, _bearer, current_user, get_db, hash_password, issue_token, require_role, revoke_token, verify_password
from .common import user_dict

router = APIRouter()


class LoginIn(BaseModel):
    email: str
    password: str


@router.post('/auth/login')
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        audit.log(db, None, 'login_failed')
        db.commit()
        raise HTTPException(401, 'メールアドレスかパスワードが違います')
    token = issue_token(db, user, request.app.state.settings.token_hours)
    audit.log(db, user, 'login')
    db.commit()
    return {'token': token, 'user': user_dict(user)}


@router.post('/auth/logout')
def logout(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    token = _bearer(request)
    if token:
        revoke_token(db, token)
    audit.log(db, user, 'logout')
    db.commit()
    return {'ok': True}


@router.get('/auth/me')
def me(user: User = Depends(current_user)):
    return user_dict(user)


class UserIn(BaseModel):
    email: str
    display_name: str = Field(min_length=1, max_length=100)
    role: str
    password: str = Field(min_length=8)


class UserPatch(BaseModel):
    display_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=8)


@router.get('/users')
def list_users(user: User = Depends(current_user), db: Session = Depends(get_db)):
    # 担当者の選択に使うので、全員が一覧を見られる（メールと表示名・役割のみ）
    return [user_dict(u) for u in db.scalars(select(User).order_by(User.id))]


@router.post('/users')
def create_user(body: UserIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_role(user, 'admin')
    if body.role not in ROLES:
        raise HTTPException(422, '役割が不正です')
    email = body.email.strip().lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, 'このメールアドレスはすでに登録されています')
    u = User(email=email, display_name=body.display_name, role=body.role, password_hash=hash_password(body.password))
    db.add(u)
    db.flush()
    audit.log(db, user, 'user_create', 'user', u.id)
    db.commit()
    return user_dict(u)


@router.patch('/users/{uid}')
def update_user(uid: int, body: UserPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_role(user, 'admin')
    u = db.get(User, uid)
    if u is None:
        raise HTTPException(404, '利用者が見つかりません')
    if body.role is not None:
        if body.role not in ROLES:
            raise HTTPException(422, '役割が不正です')
        u.role = body.role
    if body.display_name is not None:
        u.display_name = body.display_name
    if body.is_active is not None:
        u.is_active = body.is_active
    if body.password:
        u.password_hash = hash_password(body.password)
    audit.log(db, user, 'user_update', 'user', u.id, fields=[k for k, v in body.model_dump().items() if v is not None])
    db.commit()
    return user_dict(u)

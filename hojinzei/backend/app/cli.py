"""管理用のコマンド。

  .venv/bin/python -m app.cli create-user --email admin@example.jp --name "管理者" --role admin
  .venv/bin/python -m app.cli init-db      # テーブルを作る（DDL は db/dump_schema.py で db/schema.sql に出力）
"""
from __future__ import annotations

import argparse
import getpass
import sys

from sqlalchemy import select

from .config import load_settings
from .db import Database
from .models import User
from .security import ROLES, hash_password


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog='python -m app.cli')
    sub = p.add_subparsers(dest='cmd', required=True)
    cu = sub.add_parser('create-user', help='利用者を作る（パスワードは画面に表示せずに入力）')
    cu.add_argument('--email', required=True)
    cu.add_argument('--name', required=True)
    cu.add_argument('--role', choices=sorted(ROLES), default='staff')
    sub.add_parser('init-db', help='テーブルを作る')
    args = p.parse_args(argv)

    db = Database(load_settings().database_url)
    db.create_all()
    if args.cmd == 'init-db':
        print('テーブルを作りました')
        return 0
    with db.SessionLocal() as s:
        email = args.email.strip().lower()
        if s.scalar(select(User).where(User.email == email)):
            print('このメールアドレスはすでに登録されています', file=sys.stderr)
            return 1
        pw = getpass.getpass('パスワード（8文字以上）：')
        if pw != getpass.getpass('もう一度：'):
            print('パスワードが一致しません', file=sys.stderr)
            return 1
        s.add(User(email=email, display_name=args.name, role=args.role, password_hash=hash_password(pw)))
        s.commit()
    print(f'{ROLES[args.role]}「{args.name}」を作りました')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

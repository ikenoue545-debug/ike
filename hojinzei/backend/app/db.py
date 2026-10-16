"""DB 接続。PostgreSQL（本番）と SQLite（開発・テスト）の両方で動く書き方にする。"""
from __future__ import annotations

from typing import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


def make_engine(url: str):
    kwargs = {'future': True}
    if url.startswith('sqlite'):
        kwargs['connect_args'] = {'check_same_thread': False}
    eng = create_engine(url, **kwargs)
    if url.startswith('sqlite'):
        @event.listens_for(eng, 'connect')
        def _fk_on(dbapi_conn, _):  # SQLite でも外部キー制約を効かせる
            dbapi_conn.execute('PRAGMA foreign_keys=ON')
    return eng


class Database:
    def __init__(self, url: str):
        self.url = url
        self.engine = make_engine(url)
        self.SessionLocal = sessionmaker(bind=self.engine, autoflush=False, expire_on_commit=False)

    def create_all(self) -> None:
        from . import models  # noqa: F401
        Base.metadata.create_all(self.engine)

    def drop_all(self) -> None:
        from . import models  # noqa: F401
        Base.metadata.drop_all(self.engine)

    def session(self) -> Iterator[Session]:
        s = self.SessionLocal()
        try:
            yield s
        finally:
            s.close()

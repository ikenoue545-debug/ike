"""PostgreSQL 用の DDL（db/schema.sql）を SQLAlchemy のモデルから作る。

  .venv/bin/python db/dump_schema.py
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy.dialects import postgresql  # noqa: E402
from sqlalchemy.schema import CreateIndex, CreateTable  # noqa: E402

from app import models  # noqa: E402,F401
from app.db import Base  # noqa: E402

out = ['-- 法人税申告書AIアシスタント DB定義（PostgreSQL）', '-- 生成：backend/db/dump_schema.py（app/models.py から）', '']
for table in Base.metadata.sorted_tables:
    out.append(str(CreateTable(table).compile(dialect=postgresql.dialect())).strip() + ';')
    for idx in table.indexes:
        out.append(str(CreateIndex(idx).compile(dialect=postgresql.dialect())).strip() + ';')
    out.append('')
Path(__file__).with_name('schema.sql').write_text('\n'.join(out), encoding='utf-8')
print(f'{len(Base.metadata.sorted_tables)} tables')

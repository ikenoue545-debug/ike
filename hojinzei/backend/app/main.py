"""FastAPI アプリ。

  .venv/bin/uvicorn app.main:create_app --factory --reload     # 開発（SQLite、デモ用の架空データを投入）
  DATABASE_URL=postgresql+psycopg://... HOJINZEI_ENV=prod .venv/bin/uvicorn app.main:create_app --factory
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from .config import Settings, load_settings
from .db import Database
from .routers import adjustments, auth, companies, imports, inputs, returns, rules, trial_balance

log = logging.getLogger('hojinzei')


def create_app(settings: Optional[Settings] = None, seed: Optional[bool] = None) -> FastAPI:
    settings = settings or load_settings()
    app = FastAPI(title='法人税申告書AIアシスタント API', version='0.2.0',
                  description='法人税申告書のドラフト作成を支援する API。最終的な確認・承認は税理士等が行う前提です。')
    app.state.settings = settings
    app.state.db = Database(settings.database_url)
    app.state.db.create_all()
    settings.data_dir.mkdir(parents=True, exist_ok=True)

    for r in (auth.router, companies.router, imports.router, trial_balance.router, adjustments.router, inputs.router,
              returns.router, rules.router):
        app.include_router(r, prefix='/api')

    @app.get('/api/health')
    def health():
        return {'ok': True, 'env': settings.env}

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):  # noqa: ARG001
        # 中身（金額・会社名など）をログに出さない：例外の種類と場所だけ
        log.error('unhandled error: %s at %s', type(exc).__name__, request.url.path)
        return JSONResponse({'detail': 'サーバーで問題が起きました。もう一度お試しください。'}, status_code=500)

    if seed if seed is not None else settings.seed_demo:
        from .seed import seed_demo
        with app.state.db.SessionLocal() as db:
            seed_demo(db, settings)
    return app


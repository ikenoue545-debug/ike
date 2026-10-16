"""設定（環境変数）。"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Settings:
    database_url: str
    data_dir: Path
    env: str  # dev | test | prod
    token_hours: int
    max_upload_mb: int
    seed_demo: bool

    @property
    def is_dev(self) -> bool:
        return self.env in ('dev', 'test')


def load_settings() -> Settings:
    env = os.environ.get('HOJINZEI_ENV', 'dev')
    return Settings(
        database_url=os.environ.get('DATABASE_URL', f'sqlite:///{BACKEND_DIR / "hojinzei-dev.db"}'),
        data_dir=Path(os.environ.get('HOJINZEI_DATA_DIR', BACKEND_DIR / 'data')),
        env=env,
        token_hours=int(os.environ.get('HOJINZEI_TOKEN_HOURS', '12')),
        max_upload_mb=int(os.environ.get('HOJINZEI_MAX_UPLOAD_MB', '20')),
        seed_demo=os.environ.get('HOJINZEI_SEED_DEMO', '1' if env == 'dev' else '0') == '1',
    )


settings = load_settings()

"""配布用（Windows）のバックエンドの起動口。PyInstaller でまとめて houjinzei-backend.exe にする。

データは exe のあるフォルダの隣の data\\ に保存する（環境変数 HOJINZEI_HOME で変更可）。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def main() -> None:
    frozen = getattr(sys, 'frozen', False)
    if frozen:
        home = Path(os.environ.get('HOJINZEI_HOME') or Path(sys.executable).resolve().parent.parent)
        os.environ.setdefault('HOJINZEI_SAMPLES_DIR', str(Path(getattr(sys, '_MEIPASS', '.')) / 'samples'))
    else:
        home = Path(os.environ.get('HOJINZEI_HOME') or Path(__file__).resolve().parent)
    data = home / 'data'
    data.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault('DATABASE_URL', f"sqlite:///{(data / 'houjinzei.db').as_posix()}")
    os.environ.setdefault('HOJINZEI_DATA_DIR', str(data / 'files'))
    os.environ.setdefault('HOJINZEI_ENV', 'dev')

    import uvicorn

    from app.main import create_app

    port = int(os.environ.get('HOJINZEI_BACKEND_PORT', '8000'))
    uvicorn.run(create_app(), host='127.0.0.1', port=port, log_level='warning')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""base の各ブロックを src/ に書き出す（土台の版を差し替えたときに1回だけ使う）。

  python3 tools/extract.py            # まだ無いファイルだけ書き出す
  python3 tools/extract.py --force    # 上書き
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from blocks import MODULES, find_block  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / 'base' / 'jikeika-review-v3.6.html'
html = BASE.read_text(encoding='utf-8')
for name, marker in MODULES.items():
    out = ROOT / 'src' / name
    if out.exists() and '--force' not in sys.argv:
        print('skip', out.relative_to(ROOT))
        continue
    out.write_text(find_block(html, marker).group(1), encoding='utf-8')
    print('wrote', out.relative_to(ROOT))

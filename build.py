#!/usr/bin/env python3
"""土台（base/ の v3.6 単一HTML）に src/ の変更を組み込み、dist/ に配布用の1ファイルを作る。

  python3 build.py            # dist/自計化レビュー_v3.6.html を作る
  python3 build.py --check    # src/ を変更していなければ base と同じになることを確かめる

- src/ の既存モジュール（tools/blocks.py の MODULES）は、base の同じ <script> ブロックと置き換える。
- 新しいモジュール（NEW_SCRIPTS）は、指定したブロックの直後に追加する。
- 文字列の置き換え（PATCHES）は、元の文字列がちょうど1か所あることを確かめてから行う。
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'tools'))
from blocks import MODULES, find_block  # noqa: E402

BASE = ROOT / 'base' / 'jikeika-review-v3.6.html'
OUT = ROOT / 'dist' / '自計化レビュー_v3.6.html'
VERSION = '3.6.0'

# (src のファイル, このブロックの直後に置く目印)
NEW_SCRIPTS = []
# 追加のスタイル（最初の <style> の末尾に足す）
STYLES = []
# (説明, 元の文字列, 新しい文字列)
PATCHES = []


def read(p):
    return Path(p).read_text(encoding='utf-8')


def replace_once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        raise SystemExit(f'build: {label}: expected 1 match, found {n}')
    return text.replace(old, new)


def check_src(name, src):
    if '</script' in src.lower():
        raise SystemExit(f'build: {name} must not contain </script')


def assemble(html, with_changes=True):
    for name, marker in MODULES.items():
        src = read(ROOT / 'src' / name)
        check_src(name, src)
        m = find_block(html, marker)
        html = html[:m.start(1)] + src + html[m.end(1):]
    if not with_changes:
        return html
    for name, after in NEW_SCRIPTS:
        src = read(ROOT / 'src' / name)
        check_src(name, src)
        m = find_block(html, after)
        html = html[:m.end()] + '\n<script>\n' + src + '</script>' + html[m.end():]
    if STYLES:
        css = '\n'.join(read(ROOT / 'src' / name) for name in STYLES)
        i = html.index('</style>')
        html = html[:i] + '\n' + css + html[i:]
    for label, old, new in PATCHES:
        html = replace_once(html, old, new, label)
    return html


def main():
    base = read(BASE)
    if '--check' in sys.argv:
        same = assemble(base, with_changes=False) == base
        print('src matches base' if same else 'src differs from base (expected after edits)')
        return
    html = assemble(base)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding='utf-8')
    print(f'wrote {OUT.relative_to(ROOT)} ({len(html.encode("utf-8")):,} bytes)')


if __name__ == '__main__':
    main()

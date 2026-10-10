#!/usr/bin/env python3
"""v4.4 系の配布ファイルを作る。土台は base/ の v4.3（単一HTML）で、土台そのものは変えない。

  python3 build44.py            # dist/自計化レビュー_v4.4a_受信トレイ.html を作る
  python3 build44.py --check    # 変更を入れない組み立てが土台と同じになることを確かめる

- 新しいモジュール（NEW_SCRIPTS）は、目印を含む <script> ブロックの直後に追加する。
- 文字列の置き換え（PATCHES）は、元の文字列がちょうど1か所あることを確かめてから行う。
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'tools'))
from blocks import find_block  # noqa: E402

BASE = ROOT / 'base' / 'jikeika-review-v4.3.html'
OUT = ROOT / 'dist' / '自計化レビュー_v4.4a_受信トレイ.html'
VERSION = '4.4a'

# (src のファイル, このブロックの直後に置く目印)
NEW_SCRIPTS = [
    ('v44/inbox.js', 'async function commitImport('),
]
STYLES = ['v44/inbox.css']

# 本体（v4.3 の最後のアプリ処理）は即時関数の中にあるため、外から呼べる窓口を1つだけ足す。
BRIDGE = (
    "// v4.4a 受信トレイ：種類を指定せずに入れたCSVは受信トレイで確認してから、既存の取込処理（commitImport）で反映する。\n"
    "function routeFiles(list){const inbox=window.ReviewInbox;if(!forceType&&inbox&&inbox.accepts(session))return inbox.receive(list);return queueFiles(list);}\n"
    "window.ReviewAppBridge=Object.freeze({session:()=>session,workspace:()=>workspace,revision:()=>revision,loading:()=>loading,"
    "replaceSession:s=>{session=s;selected=null;monthlyFocus=null;},"
    "legacyQueue:list=>{forceType=null;return queueFiles(list);},"
    "resetImportQueue:()=>{window.ReviewAnalysisRuntime?.cancelImport();importQueueRevision++;files=[];pending=null;nativeImportBatch=null;importBatchRecords=[];if($('#importDialog').open)$('#importDialog').close();return importQueueRevision;},"
    "importQueueRevision:()=>importQueueRevision,"
    "commit:async p=>{pending=p;try{await commitImport(true);}finally{if(pending===p)pending=null;}},"
    "journalImportPeriod,recompute,render,save,syncActive,toast,"
    "shareJournals:(list,company,type,mode)=>KH?kubunShareJournals(list,company,{prefix:KUBUN_PREFIX[type],replace:mode==='replace'}):Promise.resolve(null),"
    "hasKubun:()=>!!KH});\n"
)

# (説明, 元の文字列, 新しい文字列)
PATCHES = [
    ('version label', '<span class="version">MULTI-COMPANY · 4.3.0</span>',
     f'<span class="version">MULTI-COMPANY · {VERSION}</span>'),
    ('drop → inbox', "forceType=null;queueFiles([...e.dataTransfer.files]);",
     "forceType=null;routeFiles([...e.dataTransfer.files]);"),
    ('file input → inbox', "$('#fileInput').addEventListener('change',e=>queueFiles([...e.target.files]));",
     "$('#fileInput').addEventListener('change',e=>routeFiles([...e.target.files]));"),
    ('bridge', "render();initDB().then(()=>{if(KH)setTimeout(()=>KH.ensure(),400);});",
     BRIDGE + "render();initDB().then(()=>{if(KH)setTimeout(()=>KH.ensure(),400);});"),
]


def read(p):
    return Path(p).read_text(encoding='utf-8')


def replace_once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        raise SystemExit(f'build44: {label}: expected 1 match, found {n}')
    return text.replace(old, new)


def check_src(name, src):
    if '</script' in src.lower():
        raise SystemExit(f'build44: {name} must not contain </script')


def assemble(html, with_changes=True):
    if not with_changes:
        return html
    for label, old, new in PATCHES:
        html = replace_once(html, old, new, label)
    for name, after in NEW_SCRIPTS:
        src = read(ROOT / 'src' / name)
        check_src(name, src)
        m = find_block(html, after)
        html = html[:m.end()] + '\n<script>\n' + src + '</script>' + html[m.end():]
    if STYLES:
        css = '\n'.join(read(ROOT / 'src' / name) for name in STYLES)
        i = html.index('</style>')
        html = html[:i] + '\n' + css + html[i:]
    return html


def main():
    base = read(BASE)
    if '--check' in sys.argv:
        same = assemble(base, with_changes=False) == base
        print('base reproduced' if same else 'base NOT reproduced')
        sys.exit(0 if same else 1)
    html = assemble(base)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding='utf-8')
    print(f'wrote {OUT.relative_to(ROOT)} ({len(html.encode("utf-8")):,} bytes)')


if __name__ == '__main__':
    main()

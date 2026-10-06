#!/usr/bin/env python3
"""v3.0（Claude版）の単一HTMLに、月次PL・BSの階層表示と変動分析を組み込んで dist/ に出力する。

  python3 build.py

置き換え・挿入はすべて「元の文字列がちょうど1か所ある」ことを確認してから行う。
base/ の版が変わって一致しなくなったら、ここで止まる。
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
BASE = ROOT / 'base' / 'jikeika-review-v3.0.html'
OUT = ROOT / 'dist' / '自計化レビュー_v3.3.html'
VERSION = '3.3.0'


def read(p):
    return Path(p).read_text(encoding='utf-8')


def replace_once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        sys.exit(f'build: {label}: expected 1 match, found {n}')
    return text.replace(old, new)


def script_block(text, marker):
    """marker を含む <script>…</script> の範囲を返す。"""
    i = text.index(marker)
    start = text.rindex('<script>', 0, i)
    end = text.index('</script>', i) + len('</script>')
    if text.count(marker) != 1:
        sys.exit(f'build: marker {marker!r} is not unique')
    return start, end


def main():
    html = read(BASE)
    variance = read(ROOT / 'src' / 'variance.js')
    page = read(ROOT / 'src' / 'monthly-page.js')
    css = read(ROOT / 'src' / 'monthly-page.css')
    for name, src in (('variance.js', variance), ('monthly-page.js', page)):
        if '</script' in src.lower():
            sys.exit(f'build: {name} must not contain </script')

    # 1) 月次PL・BS画面のモジュールを差し替え、その前に変動分析エンジンを置く
    start, end = script_block(html, 'F.page=page;F.chart=chart;')
    html = html[:start] + '<script>\n' + variance + '</script>\n<script>\n' + page + '</script>' + html[end:]

    # 2) スタイル（最初の <style> の末尾）
    i = html.index('</style>')
    html = html[:i] + '\n' + css + html[i:]

    # 3) 版の表示
    html = replace_once(html, '<span class="version">MULTI-COMPANY · 3.0.0</span>',
                        f'<span class="version">MULTI-COMPANY · {VERSION}</span>', 'version label')

    # 4) 確認キュー：「前月から大きく変動」の候補に、仕訳から見た理由を表示・メモへ転記
    html = replace_once(html, "${balanceSummary(f)}${INS?INS.panel(f):''}",
                        "${balanceSummary(f)}${window.ReviewVariance?window.ReviewVariance.findingHTML(f,session,result):''}${INS?INS.panel(f):''}",
                        'finding detail')
    html = replace_once(html, "気になる理由：${f.reason}\\n${INS?INS.memo(f):''}",
                        "気になる理由：${f.reason}\\n${window.ReviewVariance?window.ReviewVariance.findingText(f,session,result):''}${INS?INS.memo(f):''}",
                        'finding memo')

    # 5) 使い方（2.5 月次PL・BS）
    old_help = html[html.index('function monthlyHelp(){'):]
    old_help = old_help[:old_help.index('\n')]
    new_help = ("function monthlyHelp(){return `<section class=\"panel monthly-panel\"><div class=\"panelhead\"><h2>2.5：月次PL・BSから確認する</h2>"
                "<button class=\"btn small\" data-view=\"monthly\">月次画面へ</button></div><div class=\"panelbody\"><ol class=\"steps\">"
                "<li>会社を選び、月次PL・BS画面で対象期間を設定。</li>"
                "<li>freeeの仕訳帳を、借方・貸方の取引先・品目・部門の列を含めて全件読込。単月PLと月末BS（円単位・年付き年月・内訳を閉じたCSV）も読み込むと、帳票の金額と照合しながら分析できます。BSが未読込でも、仕訳から各月の増減を表示します。</li>"
                "<li>帳票形式の表は freee の月次推移と同じ階層です。科目名の▶を押すと「取引先別・品目別・部門別」が開き、さらに▶で「未選択」と各タグの月別金額が出ます。BSの内訳は「月末残高」（期首残高の内訳は別の行）と「当月の増減」を切り替えられます。</li>"
                "<li>科目を開くと「変動の理由（仕訳から推測）」に、月ごとの前月差と主な内訳・推測が並びます。色付きの金額は前月から大きく動いた月です。</li>"
                "<li>金額・内訳・理由の行・「大きく動いた科目と理由」のカードを押すと、右側にその月の分析が開きます。「取引から分かること」（前月→当月、主な取引先・品目、相手科目、最大の取引）と「理由の推測」（確からしさ 高・中・低）を分けて表示し、根拠の仕訳を金額の大きい順に確認できます。◀▶で前後の月へ移れます。</li>"
                "<li>推測の例：個人名の取引先への送金による事業主貸の増加、カード利用と口座引落しの差、引落し・給与・家賃の計上月のずれ（2か月分）、隔月の取引、自動車税など例年の時期の税金、年払い、新規の取引先、入金の遅れ。「AIに相談する文章をコピー」で、根拠の仕訳付きの質問文も作れます。</li>"
                "<li>売掛金の未決済一覧を追加し、実際に確認できた残額の基準日・全件の範囲を記録。銀行入金と請求書を照合し、メモに残します。</li></ol>"
                "<p style=\"margin-top:16px\">推測は仕訳の科目・取引先・品目・摘要・相手科目・前年同月から作った候補で、事実ではありません。証憑・通帳・お客様への確認で確かめてからメモに残してください。千円・累計PL・期首残高の不足では、正確な照合はできません。</p></div></section>`;}")
    html = replace_once(html, old_help, new_help, 'monthly help')

    # 6) 復元：v3.2（統合版）の「全体バックアップ」も読み込めるようにする
    old_restore = "const x=JSON.parse(await f.text());kubunData=x&&x.kubunChecker&&x.kubunChecker.app==='kubun-kenin'?x.kubunChecker:null;"
    new_restore = ("const x=JSON.parse(await f.text());"
                   "if(x&&x.kind==='ashita-unified-backup'&&x.review&&typeof x.review==='object'){const u=fromUnifiedBackup(x);kubunData=u.kubun;return W.validate(u.workspace);}"
                   "kubunData=x&&x.kubunChecker&&x.kubunChecker.app==='kubun-kenin'?x.kubunChecker:null;")
    html = replace_once(html, old_restore, new_restore, 'restore unified backup')
    helper = ("// v3.2（統合版）の全体バックアップ：レビュー側は会社一覧として、消費税側は会社の対応を付けて取り込む。\n"
              "// v3.2の「修正済み」「修正不要」は、この版の「確認済み」にしてメモの先頭に元の状態を残す。\n"
              "function fromUnifiedBackup(x){const w=JSON.parse(JSON.stringify(x.review));for(const c of Array.isArray(w.companies)?w.companies:[]){const ds=c&&c.session&&c.session.decisions;if(ds&&typeof ds==='object')for(const d of Object.values(ds)){if(d&&(d.status==='fixed'||d.status==='unnecessary')){d.note=(d.status==='fixed'?'【v3.2で修正済み】':'【v3.2で修正不要と確認】')+(typeof d.note==='string'?d.note:'');d.status='resolved';}}}"
              "let kubun=null;if(x.vat&&x.vat.app==='kubun-kenin'&&Array.isArray(x.vat.companies)){kubun=JSON.parse(JSON.stringify(x.vat));for(const l of Array.isArray(x.links)?x.links:[]){const v=kubun.companies.find(c=>c&&c.id===l.vatId);if(v&&!v.jikoId)v.jikoId=l.reviewId;}}"
              "return {workspace:w,kubun};}\n")
    anchor = "$('#restoreInput').addEventListener('change',async e=>{"
    html = replace_once(html, anchor, helper + anchor, 'restore helper')

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding='utf-8')
    print(f'wrote {OUT.relative_to(ROOT)} ({len(html.encode("utf-8")):,} bytes)')


if __name__ == '__main__':
    main()

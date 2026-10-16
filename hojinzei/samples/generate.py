"""サンプル法人（すべて架空）の試算表・仕訳帳を作る。

  hojinzei/backend/.venv/bin/python hojinzei/samples/generate.py

仕訳を1件ずつ作り、期首残高＋仕訳から試算表を集計するので、試算表と仕訳帳は必ず一致する。
会社名・住所・取引先はすべて架空。実在の会社・個人とは関係ありません。
"""
from __future__ import annotations

import csv
from collections import OrderedDict
from datetime import date, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parent

# 科目：(区分, 見出し)
ACCOUNTS: 'OrderedDict[str, tuple[str, str]]' = OrderedDict([
    ('現金', ('asset', '流動資産')), ('普通預金', ('asset', '流動資産')), ('売掛金', ('asset', '流動資産')),
    ('商品', ('asset', '流動資産')), ('前払費用', ('asset', '流動資産')),
    ('工具器具備品', ('asset', '有形固定資産')), ('減価償却累計額', ('asset', '有形固定資産')),
    ('敷金', ('asset', '投資その他の資産')),
    ('買掛金', ('liability', '流動負債')), ('未払金', ('liability', '流動負債')), ('未払法人税等', ('liability', '流動負債')),
    ('預り金', ('liability', '流動負債')), ('長期借入金', ('liability', '固定負債')),
    ('資本金', ('equity', '株主資本')), ('繰越利益剰余金', ('equity', '株主資本')),
    ('売上高', ('revenue', '売上高')),
    ('仕入高', ('expense', '売上原価')),
    ('役員報酬', ('expense', '販売管理費')), ('給料手当', ('expense', '販売管理費')), ('法定福利費', ('expense', '販売管理費')),
    ('交際費', ('expense', '販売管理費')), ('会議費', ('expense', '販売管理費')), ('旅費交通費', ('expense', '販売管理費')),
    ('通信費', ('expense', '販売管理費')), ('地代家賃', ('expense', '販売管理費')), ('減価償却費', ('expense', '販売管理費')),
    ('租税公課', ('expense', '販売管理費')), ('支払手数料', ('expense', '販売管理費')), ('消耗品費', ('expense', '販売管理費')),
    ('水道光熱費', ('expense', '販売管理費')), ('支払報酬', ('expense', '販売管理費')), ('外注費', ('expense', '販売管理費')),
    ('雑費', ('expense', '販売管理費')),
    ('受取利息', ('revenue', '営業外収益')), ('雑収入', ('revenue', '営業外収益')),
    ('支払利息', ('expense', '営業外費用')),
    ('法人税、住民税及び事業税', ('expense', '法人税等')),
])
DEBIT_NORMAL = {'asset', 'expense'}


class Book:
    def __init__(self, opening: dict[str, int]):
        self.opening = dict(opening)
        self.debit: dict[str, int] = {}
        self.credit: dict[str, int] = {}
        self.journal: list[list] = []
        self.no = 0

    def entry(self, d: date, debit: str, credit: str, amount: int, memo: str, partner: str = '', lines=None):
        """1件の仕訳（借方1行・貸方1行）。lines を渡すと複合仕訳（[(借方, 金額), ...], [(貸方, 金額), ...]）。"""
        self.no += 1
        if lines:
            drs, crs = lines
        else:
            drs, crs = [(debit, amount)], [(credit, amount)]
        assert sum(a for _, a in drs) == sum(a for _, a in crs), memo
        for i in range(max(len(drs), len(crs))):
            dn, da = drs[i] if i < len(drs) else ('', '')
            cn, ca = crs[i] if i < len(crs) else ('', '')
            if dn:
                self.debit[dn] = self.debit.get(dn, 0) + da
            if cn:
                self.credit[cn] = self.credit.get(cn, 0) + ca
            self.journal.append([d.strftime('%Y/%m/%d'), self.no, dn, da, '', partner if dn else '', '', '',
                                 cn, ca, '', partner if cn else '', '', '', memo])

    def balance(self, name: str) -> tuple[int, int, int, int]:
        sec = ACCOUNTS[name][0]
        o, dr, cr = self.opening.get(name, 0), self.debit.get(name, 0), self.credit.get(name, 0)
        c = o + dr - cr if sec in DEBIT_NORMAL else o - dr + cr
        return o, dr, cr, c


def months(start: date, n: int = 12):
    y, m = start.year, start.month
    for _ in range(n):
        yield y, m
        m += 1
        if m > 12:
            y, m = y + 1, 1


def eom(y: int, m: int) -> date:
    nxt = date(y + (m // 12), m % 12 + 1, 1)
    return nxt - timedelta(days=1)


def write_tb(book: Book, path_bs: Path, path_pl: Path, title: str, period: str):
    used = [n for n in ACCOUNTS if any(book.balance(n)) or n in book.opening]
    for path, stmt in ((path_bs, {'asset', 'liability', 'equity'}), (path_pl, {'revenue', 'expense'})):
        rows = [[f'試算表（{"貸借対照表" if "asset" in stmt else "損益計算書"}）_{title}（期間：{period}、表示単位：円）'],
                ['勘定科目', '期首残高', '借方金額', '貸方金額', '期末残高', '構成比']]
        heading = None
        sec_labels = {'asset': '資産の部', 'liability': '負債の部', 'equity': '純資産の部'}
        cur_sec = None
        totals: dict[str, int] = {}
        for n in used:
            sec, head = ACCOUNTS[n]
            if sec not in stmt:
                continue
            if head != heading and heading is not None and heading in totals:
                rows.append([f'{heading} 計', '', '', '', totals[heading], ''])
            if sec != cur_sec and sec in sec_labels:
                rows.append([sec_labels[sec], '', '', '', '', ''])
                cur_sec = sec
            if head != heading:
                rows.append([head, '', '', '', '', ''])
                heading = head
            o, dr, cr, c = book.balance(n)
            if 'asset' in stmt:
                rows.append([n, o, dr, cr, c, ''])
            else:
                rows.append([n, '', dr, cr, c, ''])
            totals[head] = totals.get(head, 0) + c
        if heading is not None:
            rows.append([f'{heading} 計', '', '', '', totals[heading], ''])
        with path.open('w', encoding='utf-8-sig', newline='') as f:
            csv.writer(f, quoting=csv.QUOTE_ALL).writerows(rows)


def write_journal(book: Book, path: Path, encoding='utf-8-sig'):
    with path.open('w', encoding=encoding, newline='') as f:
        w = csv.writer(f)
        w.writerow(['取引日', '伝票番号', '借方勘定科目', '借方金額', '借方税区分', '借方取引先', '借方品目', '借方部門',
                    '貸方勘定科目', '貸方金額', '貸方税区分', '貸方取引先', '貸方品目', '貸方部門', '摘要'])
        w.writerows(book.journal)


# ------------------------------------------------------------------ 株式会社みなと企画（架空）
def minato():
    """令和7年10月1日〜令和8年9月30日（9月決算、12か月）。"""
    opening = {'現金': 150_000, '普通預金': 12_000_000, '売掛金': 5_200_000, '商品': 1_800_000, '前払費用': 240_000,
               '工具器具備品': 3_600_000, '減価償却累計額': -1_400_000, '敷金': 1_200_000,
               '買掛金': 2_100_000, '未払金': 680_000, '未払法人税等': 748_200, '預り金': 320_000, '長期借入金': 6_000_000,
               '資本金': 5_000_000, '繰越利益剰余金': 7_941_800}
    b = Book(opening)
    start = date(2025, 10, 1)
    prev_sales, prev_purchase = 5_200_000, 2_100_000
    for i, (y, m) in enumerate(months(start)):
        d1, d10, d25, end = date(y, m, 1), date(y, m, 10), date(y, m, 25), eom(y, m)
        b.entry(d10, '普通預金', '売掛金', prev_sales, '売掛金の回収', '株式会社ひかり商事（架空）')
        b.entry(d10, '買掛金', '普通預金', prev_purchase, '買掛金の支払', '有限会社みどり物産（架空）')
        b.entry(end, '売掛金', '売上高', 4_000_000, f'{m}月分 売上', '株式会社ひかり商事（架空）')
        b.entry(end, '仕入高', '買掛金', 1_500_000, f'{m}月分 仕入', '有限会社みどり物産（架空）')
        prev_sales, prev_purchase = 4_000_000, 1_500_000
        officer = 500_000 if i < 6 else 550_000
        b.entry(d25, '役員報酬', '普通預金', officer, f'{m}月分 役員報酬（代表取締役）')
        b.entry(d25, '給料手当', '普通預金', 800_000, f'{m}月分 給与')
        b.entry(d25, '法定福利費', '普通預金', 150_000, f'{m}月分 社会保険料')
        b.entry(d1, '地代家賃', '普通預金', 200_000, f'{m}月分 事務所家賃', '芝浦ビル管理株式会社（架空）')
        b.entry(date(y, m, 15), '交際費', '普通預金', 75_000, '取引先との会食（6名）', '料亭うみかぜ（架空）')
        b.entry(date(y, m, 18), '交際費', '普通預金', 50_000, '取引先への贈答品', 'ギフトショップそら（架空）')
        b.entry(date(y, m, 12), '会議費', '普通預金', 20_000, '打合せ時の飲食（社内外4名・1人5,000円）')
        b.entry(date(y, m, 20), '旅費交通費', '普通預金', 57_000, '出張旅費・交通費')
        b.entry(date(y, m, 5), '通信費', '普通預金', 30_000, '電話・インターネット')
        b.entry(date(y, m, 27), '支払手数料', '普通預金', 35_000, '振込手数料・システム利用料')
        b.entry(date(y, m, 22), '消耗品費', '普通預金', 45_000, '事務用品')
        b.entry(date(y, m, 26), '水道光熱費', '普通預金', 25_000, '電気・水道')
        b.entry(date(y, m, 28), '雑費', '普通預金', 11_000, '雑費')
        b.entry(date(y, m, 8), '租税公課', '普通預金', 20_000, '印紙税・登録免許税など')
        b.entry(date(y, m, 27), '支払利息', '普通預金', 15_000, '借入金利息', '架空信用金庫')
        b.entry(date(y, m, 27), '長期借入金', '普通預金', 100_000, '借入金返済', '架空信用金庫')
    b.entry(date(2025, 11, 28), '未払法人税等', '普通預金', 748_200,
            '前期確定分 法人税420,000・地方法人税43,200・都民税105,000・事業税等180,000')
    b.entry(date(2026, 1, 15), '工具器具備品', '普通預金', 500_000, 'パソコン・複合機の購入', '株式会社でんき堂（架空）')
    b.entry(date(2026, 3, 20), '', '', 0, '普通預金利息（源泉所得税3,063円を差引）', '架空銀行',
            lines=([('普通預金', 16_937), ('法人税、住民税及び事業税', 3_063)], [('受取利息', 20_000)]))
    b.entry(date(2026, 4, 30), '租税公課', '普通預金', 58_000, '償却資産税')
    b.entry(date(2026, 4, 30), '租税公課', '普通預金', 12_000, '延滞税（前期の法人税の納付遅れ）')
    b.entry(date(2026, 5, 29), '法人税、住民税及び事業税', '普通預金', 374_100,
            '中間申告分 法人税210,000・地方法人税21,600・都民税52,500・事業税等90,000')
    b.entry(date(2026, 6, 30), '普通預金', '雑収入', 150_000, '雇用関係の助成金')
    b.entry(date(2026, 9, 30), '減価償却費', '減価償却累計額', 820_000, '当期の減価償却費')
    b.entry(date(2026, 9, 30), '法人税、住民税及び事業税', '未払法人税等', 400_000, '当期の法人税等の未払計上（見込み）')
    d = OUT / 'minato'
    d.mkdir(exist_ok=True)
    write_tb(b, d / '試算表_貸借対照表_2026-09.csv', d / '試算表_損益計算書_2026-09.csv', '株式会社みなと企画（架空）',
             '2025年10月〜2026年09月')
    write_journal(b, d / '仕訳帳_2025-10_2026-09.csv')
    return b


# ------------------------------------------------------------------ 合同会社さくら研究所（架空）
def sakura():
    """設立初年度：令和8年4月1日〜令和8年9月30日（6か月）。防衛特別法人税の課税事業年度。税額の計上前。"""
    b = Book({})
    b.entry(date(2026, 4, 1), '普通預金', '資本金', 3_000_000, '設立時の出資（業務執行社員）')
    for y, m in months(date(2026, 4, 1), 6):
        end = eom(y, m)
        b.entry(end, '売掛金', '売上高', 5_000_000, f'{m}月分 研究受託料', '株式会社つばさ製作所（架空）')
        if m > 4:
            b.entry(date(y, m, 20), '普通預金', '売掛金', 5_000_000, '研究受託料の入金', '株式会社つばさ製作所（架空）')
        b.entry(date(y, m, 25), '役員報酬', '普通預金', 600_000, f'{m}月分 役員報酬（業務執行社員）')
        b.entry(date(y, m, 25), '給料手当', '普通預金', 900_000, f'{m}月分 給与')
        b.entry(date(y, m, 25), '外注費', '普通預金', 700_000, f'{m}月分 分析の外注', '株式会社ななつ分析（架空）')
        b.entry(date(y, m, 1), '地代家賃', '普通預金', 150_000, f'{m}月分 研究室の家賃')
        b.entry(date(y, m, 28), '支払報酬', '普通預金', 100_000, '専門家への報酬')
        b.entry(date(y, m, 28), '消耗品費', '普通預金', 50_000, '研究用の消耗品')
    d = OUT / 'sakura'
    d.mkdir(exist_ok=True)
    # Excel（列名が freee と違う形）で出す
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = '残高試算表'
    ws.append(['合同会社さくら研究所（架空） 残高試算表 自 2026/04/01 至 2026/09/30'])
    ws.append([])
    ws.append(['科目コード', '科目名', '前期繰越', '借方発生', '貸方発生', '残高'])
    code = 100
    for n in ACCOUNTS:
        o, dr, cr, c = b.balance(n)
        if not (o or dr or cr or c):
            continue
        code += 1
        ws.append([code, n, o, dr, cr, c])
    wb.save(d / '残高試算表_2026-09.xlsx')
    write_journal(b, d / '仕訳帳_2026-04_2026-09_sjis.csv', encoding='cp932')
    return b


def main():
    for f in (minato, sakura):
        b = f()
        # 自己検査：借方合計＝貸方合計、資産＝負債＋純資産＋当期純利益
        dr, cr = sum(b.debit.values()), sum(b.credit.values())
        assert dr == cr, (f.__name__, dr, cr)
        bal = {n: b.balance(n)[3] for n in ACCOUNTS}
        a = sum(v for n, v in bal.items() if ACCOUNTS[n][0] == 'asset')
        l = sum(v for n, v in bal.items() if ACCOUNTS[n][0] == 'liability')
        e = sum(v for n, v in bal.items() if ACCOUNTS[n][0] == 'equity')
        ni = sum(v for n, v in bal.items() if ACCOUNTS[n][0] == 'revenue') - sum(v for n, v in bal.items() if ACCOUNTS[n][0] == 'expense')
        assert a == l + e + ni, (f.__name__, a, l, e, ni)
        print(f'{f.__name__}: 仕訳 {len(b.journal)} 行、当期純利益 {ni:,} 円、資産 {a:,} 円')


if __name__ == '__main__':
    main()

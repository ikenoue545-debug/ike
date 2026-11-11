// 記帳レビュー：匿名のサンプルデータ（すべて架空）。実データと同じ取込処理を通すため、CSVの文字列として作る
// 2026-05〜2026-09 は正常な取引だけ。2026-10 に、問題候補と「指摘してはいけない正常な取引」を混ぜてある
(function (root) {
  'use strict';
  const KR = root.KR = root.KR || {};
  const U = KR.util;
  const IN = '課対仕入10%', OUT = '課税売上10%', NA = '対象外', IN80 = '課対仕入（控80）10%';
  const HEADER = ['取引日', '伝票番号', '借方勘定科目', '借方金額', '借方税区分', '借方取引先', '貸方勘定科目', '貸方金額', '貸方税区分', '貸方取引先', '摘要'];
  const vary = (base, m, spread, step) => base + ((m * 7919 + base) % spread) * (step || 10);

  function monthRows(ym, problems) {
    const m = +ym.slice(5), rows = [], d = n => ym + '-' + U.pad(n), prev = U.pad(m - 1) + '月分', cur = U.pad(m) + '月分';
    const r = (day, dAcc, dAmt, dTax, dP, cAcc, cAmt, cTax, cP, desc) => rows.push([d(day), '', dAcc, dAmt, dTax, dP, cAcc, cAmt, cTax, cP, desc]);
    const simple = (day, acc, amt, tax, partner, pay, desc) => r(day, acc, amt, tax, partner, pay, amt, '', partner, desc);
    const P = problems;
    // カード払い
    simple(3, '通信費', vary(11800, m, 90), IN, '', '法人カード', 'AMAZON WEB SERVICES');
    simple(5, '通信費', 7780, P ? NA : IN, 'アドビ(株)', '法人カード', 'Creative Cloud ' + cur);
    simple(7, P ? '雑費' : '消耗品費', vary(4200, m, 60), IN, '', '法人カード', 'ASKUL オフィス用品');
    simple(8, '消耗品費', P ? 32780 : vary(28000, m, 70, 100), IN, '(株)オフィスサプライ', '法人カード', 'コピー用紙・トナー');
    simple(10, '通信費', P ? 65780 : 6578, IN, 'NTT東日本', '法人カード', '電話・回線料 ' + prev);
    if (P) simple(14, '雑費', 5630, IN, '', '法人カード', 'ASKUL オフィス用品');
    simple(21, P ? '雑費' : '消耗品費', vary(3900, m, 50), IN, '', '法人カード', 'ASKUL オフィス用品');
    // 現金
    if (P) simple(2, '接待交際費', 62000, IN, '鮨かねこ', '現金', '取引先接待 3名');
    if (P) { r(5, '現金', 50000, '', '', '普通預金', 50000, '', '', 'ATM引出'); r(5, '現金', 50000, '', '', '普通預金', 50000, '', '', 'ATM引出'); }
    else { r(5, '現金', 50000, '', '', '普通預金', 50000, '', '', 'ATM引出'); r(20, '現金', 50000, '', '', '普通預金', 50000, '', '', 'ATM引出'); }
    simple(8, '会議費', 12400, IN, '', '現金', '打合せ 飲食代');
    if (P) simple(9, '雑費', 30000, IN, '', '現金', '');
    simple(12, '旅費交通費', 480, IN, '', '現金', '電車代'); simple(12, '旅費交通費', 480, IN, '', '現金', '電車代');
    simple(16, '接待交際費', 38000, IN, '割烹さくら', '現金', '取引先接待');
    simple(18, '消耗品費', 9640, IN, '', '現金', '文具');
    simple(22, '旅費交通費', 6200, IN, '', '現金', 'タクシー代');
    simple(26, '福利厚生費', 27800, IN, '', '現金', '従業員 昼食会');
    // 預金
    r(10, '預り金', 115000, '', '税務署', '普通預金', 115000, '', '税務署', '源泉所得税 ' + prev);
    simple(10, '支払手数料', 11000, IN, '社労士法人みらい', '普通預金', '顧問料 ' + cur);
    if (P) simple(10, '消耗品費', 32780, IN, '(株)オフィスサプライ', '未払金', '請求書 コピー用紙・トナー');
    simple(14, '広告宣伝費', 55000, IN, '(株)アドワークス', '普通預金', 'Web広告運用 ' + cur);
    if (P) simple(14, '広告宣伝費', 55000, IN, '(株)アドワークス', '普通預金', 'Web広告運用 ' + cur);
    if (P) simple(17, '修繕費', 180000, IN, '(株)クリーン設備', '普通預金', 'エアコン修理');
    if (P) r(23, '役員貸付金', 200000, '', '', '普通預金', 200000, '', '', '社長 仮払');
    simple(15, P ? '通信費' : '水道光熱費', vary(16400, m, 40, 100), IN, '東京電力EP', '普通預金', '電気料金 ' + prev);
    r(20, '普通預金', 330000, '', '(株)エース企画', '売掛金', 330000, '', '(株)エース企画', '入金 ' + prev);
    r(20, '普通預金', vary(205000, m - 1, 50, 1000), '', 'ビーライン(株)', '売掛金', vary(205000, m - 1, 50, 1000), '', 'ビーライン(株)', '入金 ' + prev);
    r(22, '普通預金', 88000, '', '(株)デルタ工業', '売掛金', 88000, '', '(株)デルタ工業', '入金 保守料 ' + prev);
    r(22, '普通預金', 55000, '', '(株)デルタ工業', '売掛金', 55000, '', '(株)デルタ工業', '入金 ライセンス料 ' + prev);
    // 売上（月末締め・翌月入金）
    r(25, '売掛金', 330000, '', '(株)エース企画', '売上高', 330000, OUT, '(株)エース企画', 'サイト運用 ' + cur);
    const bSales = P ? 82000 : vary(205000, m, 50, 1000);
    r(25, '売掛金', bSales, '', 'ビーライン(株)', '売上高', bSales, OUT, 'ビーライン(株)', '制作費 ' + cur);
    r(25, '売掛金', 88000, '', '(株)デルタ工業', '売上高', 88000, OUT, '(株)デルタ工業', '保守料 ' + cur);
    r(25, '売掛金', 55000, '', '(株)デルタ工業', '売上高', 55000, OUT, '(株)デルタ工業', 'ライセンス料 ' + cur);
    if (m === 5 || m === 8) r(25, '売掛金', 550000, '', 'シーウェーブ(同)', '売上高', 550000, OUT, 'シーウェーブ(同)', '四半期レポート');
    // 給与（複合仕訳：伝票番号でまとめる）
    const yaku = P ? 550000 : 500000;
    rows.push([d(25), 'S' + m + '1', '役員報酬', yaku, NA, '', '普通預金', yaku - 70000, '', '', '役員報酬 ' + cur]);
    rows.push([d(25), 'S' + m + '1', '', '', '', '', '預り金', 70000, '', '', '役員報酬 ' + cur]);
    rows.push([d(25), 'S' + m + '2', '給料手当', 300000, NA, '', '普通預金', 255000, '', '', '給料 ' + cur]);
    rows.push([d(25), 'S' + m + '2', '', '', '', '', '預り金', 45000, '', '', '給料 ' + cur]);
    simple(27, '地代家賃', 165000, IN, '(株)山田不動産', '普通預金', '事務所家賃 翌月分');
    simple(27, '地代家賃', 22000, IN, '(株)山田不動産', '普通預金', '駐車場代'); simple(27, '地代家賃', 22000, IN, '(株)山田不動産', '普通預金', '駐車場代');
    r(27, '法人カード', vary(58000, m, 80, 100), '', '', '普通預金', vary(58000, m, 80, 100), '', '', 'カード利用代金 引落');
    if (!P) simple(30, '法定福利費', 118000, NA, '年金事務所', '普通預金', '社会保険料 ' + prev);
    simple(30, '外注費', 110000, IN80, '佐藤デザイン', '普通預金', 'デザイン制作 ' + cur);
    return rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  }
  function journalCSV(months, problems) {
    let n = 0;
    const rows = months.flatMap(ym => monthRows(ym, problems)).map(r => { r[0] = r[0].replace(/-/g, '/'); if (!r[1]) r[1] = String(++n); return r; });
    return KR.csv.toCSV([HEADER].concat(rows)).replace(/^﻿/, '');
  }
  // 10月の普通預金の明細。帳簿から作り、照合の4区分が出るように一部を変える
  function statementCSV() {
    const out = [], add = (date, desc, amount) => out.push({ date, desc, amount });
    for (const r of monthRows('2026-10', true)) {
      const [date, , dAcc, dAmt, , dP, cAcc, cAmt, , , desc] = r;
      if (dAcc === '普通預金') add(date, 'フリコミ ' + (dP || ''), dAmt);
      else if (cAcc === '普通預金') add(date, desc || dAcc, -cAmt);
    }
    const find = (pred) => out.findIndex(pred), del = i => out.splice(i, 1)[0];
    const b = out[find(x => /ビーライン/.test(x.desc))]; b.date = '2026-10-21'; b.amount -= 660;                 // 手数料控除 → 差額あり
    del(find(x => /デルタ/.test(x.desc) && x.amount === 55000)); out[find(x => /デルタ/.test(x.desc))].amount = 143000; // 合算入金
    out[find(x => /事務所家賃/.test(x.desc))].date = '2026-10-28';                                              // 日付ずれ
    del(find(x => /Web広告/.test(x.desc)));                                                                     // 帳簿は2件、明細は1件 → 帳簿のみ
    const k = out[find(x => /顧問料/.test(x.desc))]; k.date = '2026-10-09'; add('2026-10-11', '口座振替 ミライ', -11000); // 同額が2件 → 要確認
    add('2026-10-29', 'フリコミテスウリヨウ', -4400);                                                             // 明細のみ
    out.sort((a, b2) => a.date < b2.date ? -1 : a.date > b2.date ? 1 : 0);
    let bal = 2400000;
    const rows = out.map(x => { bal += x.amount; return [x.date.replace(/-/g, '/'), x.desc, x.amount < 0 ? -x.amount : '', x.amount > 0 ? x.amount : '', bal]; });
    return KR.csv.toCSV([['日付', '摘要', 'お支払金額', 'お預り金額', '残高']].concat(rows)).replace(/^﻿/, '');
  }
  // 取込開始時点（2026-05-01）の残高。月次推移BSのサンプルと、会社ルールの取引先別残高の両方に使う
  const OPEN = { '現金': 30000, '普通預金': 3000000, '売掛金': 330000 + vary(205000, 4, 50, 1000) + 143000, '仮払金': 80000, '役員貸付金': 0, '法人カード': 60000, '未払金': 0, '預り金': 115000 };
  const MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  // 月次推移（貸借対照表）。仕訳から作り、10月の売掛金だけ 110,000円多くする（仕訳帳CSVより後に出力し、その間に売上が1件登録された想定）
  function bsCSV() {
    const cols = ['2026-04'].concat(MONTHS, ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03']), bal = Object.assign({}, OPEN), rows = {};
    for (const a of Object.keys(OPEN)) rows[a] = [OPEN[a], OPEN[a]];
    for (const ym of MONTHS) {
      for (const r of monthRows(ym, ym === '2026-10')) for (const [acc, amt, side] of [[r[2], r[3], 'D'], [r[6], r[7], 'C']]) if (acc in bal) bal[acc] += (KR.model.normalSide(acc) === side ? 1 : -1) * amt;
      for (const a of Object.keys(OPEN)) rows[a].push(bal[a] + (a === '売掛金' && ym === '2026-10' ? 110000 : 0));
    }
    for (const a of Object.keys(OPEN)) while (rows[a].length < cols.length + 1) rows[a].push(rows[a][rows[a].length - 1]);
    const line = (name, vals) => ['', name].concat(vals || cols.map(() => '').concat(['']));
    const out = [['月次推移：貸借対照表_株式会社サンプル商会（架空）（期間：2026年04月～2027年03月、表示単位：円）'], ['勘定科目コード', '', '期首'].concat(cols), line('資産の部'), line('流動資産')];
    for (const a of ['現金', '普通預金', '売掛金', '仮払金', '役員貸付金']) out.push(line(a, rows[a]));
    out.push(line('負債の部'), line('流動負債'));
    for (const a of ['法人カード', '未払金', '預り金']) out.push(line(a, rows[a]));
    return KR.csv.toCSV(out).replace(/^\ufeff/, '');
  }
  // 請求一覧（9月・10月）。取引先名は帳簿と表記を変えてある（株式会社／(株)）
  function invoicesCSV() {
    const rows = [['請求日', '請求書番号', '取引先', '件名', '請求金額', '入金期日'],
      ['2026/09/25', 'INV-0901', '株式会社エース企画', 'サイト運用 09月分', 330000, '2026/10/20'], ['2026/09/25', 'INV-0902', 'ビーライン株式会社', '制作費 09月分', vary(205000, 9, 50, 1000), '2026/10/20'],
      ['2026/09/25', 'INV-0903', '株式会社デルタ工業', '保守料 09月分', 88000, '2026/10/22'], ['2026/09/25', 'INV-0904', '株式会社デルタ工業', 'ライセンス料 09月分', 55000, '2026/10/22'], ['2026/09/25', 'INV-0905', '株式会社デルタ工業', '追加作業', 33000, '2026/10/20'],
      ['2026/10/25', 'INV-1001', '株式会社エース企画', 'サイト運用 10月分', 363000, '2026/11/20'], ['2026/10/25', 'INV-1002', 'ビーライン株式会社', '制作費 10月分', 82000, '2026/11/20'],
      ['2026/10/25', 'INV-1003', '株式会社デルタ工業', '保守料 10月分', 88000, '2026/11/22'], ['2026/10/25', 'INV-1004', '株式会社デルタ工業', 'ライセンス料 10月分', 55000, '2026/11/22'], ['2026/10/31', 'INV-1005', 'シーウェーブ合同会社', 'スポット調査', 110000, '2026/11/30']];
    return KR.csv.toCSV(rows).replace(/^\ufeff/, '');
  }
  function payrollCSV() {
    return KR.csv.toCSV([['支給日', '氏名', '区分', '総支給額', '控除合計', '差引支給額'], ['2026/10/25', '山田 太郎（架空）', '役員', 500000, 70000, 430000], ['2026/10/25', '鈴木 花子（架空）', '従業員', 300000, 45000, 255000]]).replace(/^\ufeff/, '');
  }
  function company() {
    const c = KR.model.newCompany('株式会社サンプル商会（架空）');
    Object.assign(c, {
      id: 'sample', business: 'Web制作・保守（架空のサンプル）', fiscalEndMonth: 3,
      tax: { status: 'general', accounting: 'inclusive', note: '' },
      recurring: [
        { id: 'r1', name: '役員報酬', account: '役員報酬', partner: '', keyword: '', amount: 500000, tolerancePct: 0, note: '定期同額' },
        { id: 'r2', name: '事務所家賃', account: '地代家賃', partner: '(株)山田不動産', keyword: '事務所家賃', amount: 165000, tolerancePct: 0, note: '' },
      ],
      partnerRules: [{ id: 'p1', partner: '佐藤デザイン', account: '外注費', tax: '', note: '免税事業者（登録番号なし）' }],
      cashOpening: { date: '2026-05-01', amount: 30000 },
      opening: { date: '2026-05-01', balances: [{ id: 'o1', account: '売掛金', partner: '(株)エース企画', amount: 330000 }, { id: 'o2', account: '売掛金', partner: 'ビーライン(株)', amount: vary(205000, 4, 50, 1000) }, { id: 'o3', account: '売掛金', partner: '(株)デルタ工業', amount: 143000 }] },
      notes: '駐車場は2区画を同額で毎月支払い。',
    });
    return c;
  }
  function build() {
    return {
      company: company(), month: '2026-10',
      journals: [
        { name: 'サンプル_仕訳帳_2026-05〜09.csv', text: journalCSV(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'], false) },
        { name: 'サンプル_仕訳帳_2026-10.csv', text: journalCSV(['2026-10'], true) },
      ],
      statement: { name: 'サンプル_普通預金明細_2026-10.csv', text: statementCSV(), account: '普通預金' },
      bs: { name: 'サンプル_月次推移_貸借対照表.csv', text: bsCSV() },
      invoices: { name: 'サンプル_請求一覧_2026-09〜10.csv', text: invoicesCSV() },
      payroll: { name: 'サンプル_給与一覧_2026-10.csv', text: payrollCSV() },
    };
  }
  KR.sample = { build, journalCSV, statementCSV, bsCSV, invoicesCSV, payrollCSV, company };
  if (typeof module !== 'undefined' && module.exports) module.exports = KR;
})(typeof globalThis !== 'undefined' ? globalThis : this);

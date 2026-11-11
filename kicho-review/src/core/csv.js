// 記帳レビュー：CSVの読み取り（文字コードの判定、仕訳帳・明細の列の対応づけと行ごとの検証）
(function (root) {
  'use strict';
  const KR = root.KR = root.KR || {};
  const U = KR.util;

  // UTF-8 として正しく読めなければ Shift_JIS とみなす（freee の既定は Shift_JIS）
  function decode(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(u8);
      return { text: text.replace(/^﻿/, ''), encoding: 'UTF-8' };
    } catch (e) {
      const text = new TextDecoder('shift_jis').decode(u8);
      const bad = (text.match(/�/g) || []).length;
      return { text, encoding: 'Shift_JIS', badChars: bad };
    }
  }

  // RFC4180 相当（引用符内の改行・カンマ、"" のエスケープ）。区切りはカンマかタブ
  function parse(text) {
    const first = text.slice(0, text.indexOf('\n') < 0 ? text.length : text.indexOf('\n'));
    const sep = (first.split('\t').length > first.split(',').length) ? '\t' : ',';
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"' && cell === '') q = true;
      else if (c === sep) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  // 列名の候補。freee の仕訳帳CSV（新・旧）で使われる名前と、よくある別名
  const JOURNAL_FIELDS = {
    date: ['取引日', '日付', '発生日', '仕訳日'],
    slip: ['伝票番号', '仕訳番号', 'No.', 'No', '取引番号', '番号'],
    ref: ['管理番号'],
    dAcc: ['借方勘定科目', '借方科目'], dAmt: ['借方金額'], dTax: ['借方税区分'],
    dTaxAmt: ['借方税金額', '借方税額', '借方消費税額'], dPartner: ['借方取引先', '借方取引先名'],
    dItem: ['借方品目'], dDept: ['借方部門'], dNote: ['借方備考', '借方メモ'],
    cAcc: ['貸方勘定科目', '貸方科目'], cAmt: ['貸方金額'], cTax: ['貸方税区分'],
    cTaxAmt: ['貸方税金額', '貸方税額', '貸方消費税額'], cPartner: ['貸方取引先', '貸方取引先名'],
    cItem: ['貸方品目'], cDept: ['貸方部門'], cNote: ['貸方備考', '貸方メモ'],
    partner: ['取引先', '取引先名'],
    desc: ['摘要', '取引内容', '備考'],
    adj: ['決算整理仕訳'],
  };
  const JOURNAL_LABEL = {
    date: '取引日', slip: '伝票番号', ref: '管理番号', dAcc: '借方勘定科目', dAmt: '借方金額', dTax: '借方税区分', dTaxAmt: '借方税額',
    dPartner: '借方取引先', dItem: '借方品目', dDept: '借方部門', dNote: '借方備考', cAcc: '貸方勘定科目', cAmt: '貸方金額', cTax: '貸方税区分',
    cTaxAmt: '貸方税額', cPartner: '貸方取引先', cItem: '貸方品目', cDept: '貸方部門', cNote: '貸方備考', partner: '取引先', desc: '摘要', adj: '決算整理仕訳',
  };
  const STATEMENT_FIELDS = {
    date: ['日付', '取引日', '年月日', '利用日', 'ご利用日', 'お取引日'],
    desc: ['摘要', '内容', 'お取引内容', '取引内容', '利用店名', 'ご利用先', '備考'],
    out: ['出金', '出金額', 'お支払金額', '支払金額', 'お引出し', 'お引出金額', '利用金額', 'ご利用金額'],
    inn: ['入金', '入金額', 'お預り金額', '預り金額', 'お預入れ', 'お預入金額'],
    amount: ['金額', '取引金額'],
    balance: ['残高', '差引残高'],
  };

  function mapHeader(header, fields) {
    const map = {}, used = new Set();
    const names = header.map(h => U.clean(h));
    for (const [key, aliases] of Object.entries(fields)) {
      for (const a of aliases) {
        const i = names.findIndex((n, idx) => !used.has(idx) && n === a);
        if (i >= 0) { map[key] = i; used.add(i); break; }
      }
    }
    return { map, unmapped: names.filter((n, i) => n && !used.has(i)) };
  }
  // 先頭10行のうち、列名の候補にいちばん多く当たる行を見出しとする
  function findHeader(rows, fields) {
    let best = -1, bestHits = 0;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const hits = Object.keys(mapHeader(rows[i], fields).map).length;
      if (hits > bestHits) { best = i; bestHits = hits; }
    }
    return { index: best, hits: bestHits };
  }

  // 仕訳帳CSV → 行データ。読めない行は捨てずに理由を付けて返す
  function readJournal(text, fileName) {
    const rows = parse(text);
    const out = { kind: 'journal', fileName: fileName || '', lines: [], rejected: [], warnings: [], columns: [], unmapped: [], stats: null, fatal: null };
    const h = findHeader(rows, JOURNAL_FIELDS);
    if (h.index < 0 || h.hits < 3) { out.fatal = '見出し行が見つかりません。freee の仕訳帳CSV（取引日・借方勘定科目・借方金額・貸方勘定科目・貸方金額の列）を選んでください。'; return out; }
    const { map, unmapped } = mapHeader(rows[h.index], JOURNAL_FIELDS);
    const miss = [];
    if (map.date == null) miss.push('取引日');
    if (map.dAcc == null && map.cAcc == null) miss.push('借方勘定科目／貸方勘定科目');
    if (map.dAmt == null && map.cAmt == null) miss.push('借方金額／貸方金額');
    if (miss.length) { out.fatal = '必要な列がありません：' + miss.join('、') + '。見つかった列：' + rows[h.index].map(U.clean).filter(Boolean).join('、'); return out; }
    out.columns = Object.keys(map).map(k => ({ key: k, label: JOURNAL_LABEL[k], header: U.clean(rows[h.index][map[k]]) }));
    out.unmapped = unmapped;
    const get = (r, k) => map[k] == null ? '' : U.trim(r[map[k]]);
    let blank = 0, dTotal = 0, cTotal = 0, min = null, max = null;
    for (let i = h.index + 1; i < rows.length; i++) {
      const r = rows[i], rowNo = i + 1;
      if (!r.some(c => U.clean(c) !== '')) { blank++; continue; }
      const reasons = [];
      const date = U.parseDate(get(r, 'date'));
      if (!date) reasons.push('取引日を読めません（「' + get(r, 'date') + '」）');
      const side = p => {
        const acc = get(r, p + 'Acc'), raw = get(r, p + 'Amt'), amt = U.parseAmount(raw), name = p === 'd' ? '借方' : '貸方';
        if (!acc && (amt == null || amt === 0)) return null;
        if (!acc) { reasons.push(name + '金額があるのに' + name + '勘定科目が空です'); return null; }
        if (amt == null) { reasons.push(name + '勘定科目があるのに' + name + '金額が空です'); return null; }
        if (isNaN(amt)) { reasons.push(name + '金額を読めません（「' + raw + '」）'); return null; }
        const taxAmt = U.parseAmount(get(r, p + 'TaxAmt'));
        return { acc, amt, tax: get(r, p + 'Tax'), taxAmt: (taxAmt == null || isNaN(taxAmt)) ? null : taxAmt, partner: get(r, p + 'Partner') || get(r, 'partner'), item: get(r, p + 'Item'), dept: get(r, p + 'Dept'), note: get(r, p + 'Note') };
      };
      const d = side('d'), c = side('c');
      if (!reasons.length && !d && !c) reasons.push('借方・貸方とも勘定科目と金額がありません');
      if (reasons.length) { out.rejected.push({ row: rowNo, reasons, raw: r.map(U.clean).join(' | ').slice(0, 300) }); continue; }
      if ((d && d.amt < 0) || (c && c.amt < 0)) out.warnings.push({ row: rowNo, text: 'マイナスの金額があります（そのまま取り込みます）' });
      const line = { row: rowNo, date, slip: get(r, 'slip'), ref: get(r, 'ref'), desc: get(r, 'desc'), adj: /^(1|true|はい|○|決算整理)/i.test(get(r, 'adj')) };
      if (d) Object.assign(line, { dAcc: d.acc, dAmt: d.amt, dTax: d.tax, dTaxAmt: d.taxAmt, dPartner: d.partner, dItem: d.item, dDept: d.dept, dNote: d.note });
      if (c) Object.assign(line, { cAcc: c.acc, cAmt: c.amt, cTax: c.tax, cTaxAmt: c.taxAmt, cPartner: c.partner, cItem: c.item, cDept: c.dept, cNote: c.note });
      out.lines.push(line);
      dTotal += d ? d.amt : 0; cTotal += c ? c.amt : 0;
      if (!min || date < min) min = date; if (!max || date > max) max = date;
    }
    // 借方・貸方の一致：伝票番号があれば伝票ごと、なければ行ごとに確かめる
    const groups = U.groupBy(out.lines, l => l.slip ? l.date + '|' + l.slip : 'row' + l.row);
    for (const [k, ls] of groups) {
      const ds = ls.reduce((s, l) => s + (l.dAmt || 0), 0), cs = ls.reduce((s, l) => s + (l.cAmt || 0), 0);
      if (ds !== cs) out.warnings.push({ row: ls[0].row, text: (ls[0].slip ? '伝票番号 ' + ls[0].slip : 'この行') + '：借方合計 ' + U.yen(ds) + ' と貸方合計 ' + U.yen(cs) + ' が一致しません' });
    }
    out.stats = { rows: out.lines.length, blank, rejected: out.rejected.length, debitTotal: dTotal, creditTotal: cTotal, from: min, to: max, months: [...new Set(out.lines.map(l => l.date.slice(0, 7)))].sort(), hasSlip: out.lines.some(l => l.slip), hasTax: out.lines.some(l => l.dTax || l.cTax), hasPartner: out.lines.some(l => l.dPartner || l.cPartner) };
    out.hash = U.hash(out.lines.map(l => [l.date, l.slip, l.dAcc, l.dAmt, l.dTax, l.dPartner, l.cAcc, l.cAmt, l.cTax, l.cPartner, l.desc].join('\u0001')).join('\u0002'));
    return out;
  }

  // 銀行・カード明細、現金出納帳 → 明細行（入金は＋、出金は−）
  function readStatement(text, fileName) {
    const rows = parse(text);
    const out = { kind: 'statement', fileName: fileName || '', lines: [], rejected: [], warnings: [], columns: [], unmapped: [], stats: null, fatal: null };
    const h = findHeader(rows, STATEMENT_FIELDS);
    const m0 = h.index >= 0 ? mapHeader(rows[h.index], STATEMENT_FIELDS) : { map: {}, unmapped: [] };
    const map = m0.map;
    if (h.index < 0 || map.date == null || (map.out == null && map.inn == null && map.amount == null)) {
      out.fatal = '見出し行が見つかりません。日付と、出金・入金（または金額）の列がある明細CSVを選んでください。' + (h.index >= 0 ? '見つかった列：' + rows[h.index].map(U.clean).filter(Boolean).join('、') : '');
      return out;
    }
    out.columns = Object.keys(map).map(k => ({ key: k, header: U.clean(rows[h.index][map[k]]) }));
    out.unmapped = m0.unmapped;
    const get = (r, k) => map[k] == null ? '' : U.trim(r[map[k]]);
    let blank = 0, min = null, max = null;
    const seen = new Map();
    for (let i = h.index + 1; i < rows.length; i++) {
      const r = rows[i], rowNo = i + 1;
      if (!r.some(c => U.clean(c) !== '')) { blank++; continue; }
      const reasons = [];
      const date = U.parseDate(get(r, 'date'));
      if (!date) reasons.push('日付を読めません（「' + get(r, 'date') + '」）');
      const o = U.parseAmount(get(r, 'out')), n = U.parseAmount(get(r, 'inn')), a = U.parseAmount(get(r, 'amount'));
      for (const [v, name, k] of [[o, '出金', 'out'], [n, '入金', 'inn'], [a, '金額', 'amount']]) if (v != null && isNaN(v)) reasons.push(name + 'を読めません（「' + get(r, k) + '」）');
      let amount = null;
      if (!reasons.length) {
        if (o && n) reasons.push('出金と入金の両方に金額があります');
        else if (o) amount = -Math.abs(o); else if (n) amount = Math.abs(n); else if (a) amount = a;
        else reasons.push('金額がありません');
      }
      if (reasons.length) { out.rejected.push({ row: rowNo, reasons, raw: r.map(U.clean).join(' | ').slice(0, 300) }); continue; }
      const bal = U.parseAmount(get(r, 'balance'));
      const line = { row: rowNo, date, desc: get(r, 'desc'), amount, balance: (bal == null || isNaN(bal)) ? null : bal };
      // 残高まで同じ行が2回あれば、資料の中での重複（二重に貼り付けた等）の可能性
      if (line.balance != null) {
        const k = [date, amount, line.desc, line.balance].join('|');
        if (seen.has(k)) out.warnings.push({ row: rowNo, text: seen.get(k) + '行目と日付・金額・摘要・残高がすべて同じです（資料の中の重複の可能性）' }); else seen.set(k, rowNo);
      }
      out.lines.push(line);
      if (!min || date < min) min = date; if (!max || date > max) max = date;
    }
    out.stats = { rows: out.lines.length, blank, rejected: out.rejected.length, from: min, to: max, inTotal: out.lines.filter(l => l.amount > 0).reduce((s, l) => s + l.amount, 0), outTotal: -out.lines.filter(l => l.amount < 0).reduce((s, l) => s + l.amount, 0), hasBalance: out.lines.some(l => l.balance != null) };
    out.hash = U.hash(out.lines.map(l => [l.date, l.amount, l.desc, l.balance].join('\u0001')).join('\u0002'));
    return out;
  }

  // 月次推移（貸借対照表）CSV → 科目ごとの期首残高と月末残高。タグ別（取引先など）の内訳行は使わず、科目の合計行だけを読む
  function readBS(text, fileName) {
    const rows = parse(text), out = { kind: 'bs', fileName: fileName || '', opening: {}, balances: {}, months: [], warnings: [], fatal: null };
    const ym = v => { const m = U.clean(v).match(/^(\d{4})[-\/年](\d{1,2})月?$/); return m ? m[1] + '-' + U.pad(+m[2]) : null; };
    const hi = rows.slice(0, 10).findIndex(r => r.some(c => U.clean(c) === '期首') && r.some(c => ym(c)));
    if (hi < 0) { out.fatal = '見出し行（「期首」と「2026-04」のような月の列）が見つかりません。freee の［月次推移］→［貸借対照表］のCSVを選んでください。'; return out; }
    if (rows.slice(0, hi + 1).some(r => r.some(c => /単位[：:]\s*(千円|百万円)/.test(U.nfkc(c))))) { out.fatal = '表示単位が円ではありません。円単位で出力したCSVを選んでください。'; return out; }
    const head = rows[hi].map(U.clean), openIdx = head.indexOf('期首'), tagIdx = head.findIndex(h => /^(取引先|品目|部門|メモタグ|セグメント\d?)$/.test(h));
    let nameIdx = head.indexOf('勘定科目'); if (nameIdx < 0) nameIdx = head.findIndex((h, i) => i < openIdx && h === ''); if (nameIdx < 0) nameIdx = 0;
    const cols = head.map((h, i) => ({ i, m: ym(h) })).filter(c => c.m);
    out.months = cols.map(c => c.m);
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i], name = U.trim(r[nameIdx]);
      if (!name || (tagIdx >= 0 && U.clean(r[tagIdx]) !== '')) continue;
      const op = U.parseAmount(r[openIdx]), vals = cols.map(c => U.parseAmount(r[c.i]));
      if ((op == null || isNaN(op)) && vals.every(v => v == null || isNaN(v))) continue;   // 区分の見出し行
      if (out.balances[name]) { out.warnings.push({ row: i + 1, text: '「' + name + '」が2回あります。最初の行を使います' }); continue; }
      out.opening[name] = (op == null || isNaN(op)) ? 0 : op;
      out.balances[name] = {}; cols.forEach((c, k) => { if (vals[k] != null && !isNaN(vals[k])) out.balances[name][c.m] = vals[k]; });
    }
    out.stats = { accounts: Object.keys(out.balances).length, from: out.months[0], to: out.months[out.months.length - 1], tagged: tagIdx >= 0 };
    if (!out.stats.accounts) out.fatal = '残高のある科目の行を読めませんでした。';
    out.hash = U.hash(JSON.stringify([out.opening, out.balances]));
    return out;
  }

  // 一覧形式の資料（請求一覧・給与一覧）を読む共通処理。読めない行は理由つきで返す
  function readTable(text, fileName, kind, fields, required, labels, rowFn) {
    const rows = parse(text), out = { kind, fileName: fileName || '', lines: [], rejected: [], warnings: [], columns: [], unmapped: [], stats: null, fatal: null };
    const h = findHeader(rows, fields), m0 = h.index >= 0 ? mapHeader(rows[h.index], fields) : { map: {}, unmapped: [] }, map = m0.map;
    const miss = required.filter(k => map[k] == null);
    if (h.index < 0 || miss.length) { out.fatal = '必要な列がありません：' + miss.map(k => labels[k] + '（' + fields[k].join('・') + ' のいずれか）').join('、') + (h.index >= 0 ? '。見つかった列：' + rows[h.index].map(U.clean).filter(Boolean).join('、') : ''); return out; }
    out.columns = Object.keys(map).map(k => ({ key: k, header: U.clean(rows[h.index][map[k]]) })); out.unmapped = m0.unmapped;
    const get = (r, k) => map[k] == null ? '' : U.trim(r[map[k]]);
    let blank = 0, min = null, max = null;
    for (let i = h.index + 1; i < rows.length; i++) {
      const r = rows[i]; if (!r.some(c => U.clean(c) !== '')) { blank++; continue; }
      const reasons = [], num = (k, need) => { if (map[k] == null) return null; const v = U.parseAmount(get(r, k)); if (v != null && isNaN(v)) { reasons.push(labels[k] + 'を読めません（「' + get(r, k) + '」）'); return null; } if (v == null && need) reasons.push(labels[k] + 'が空です'); return v; };
      const date = U.parseDate(get(r, 'date')); if (!date) reasons.push(labels.date + 'を読めません（「' + get(r, 'date') + '」）');
      const line = rowFn(r, get, num, reasons, i + 1);
      if (reasons.length) { out.rejected.push({ row: i + 1, reasons, raw: r.map(U.clean).join(' | ').slice(0, 300) }); continue; }
      line.row = i + 1; line.date = date; out.lines.push(line);
      if (!min || date < min) min = date; if (!max || date > max) max = date;
    }
    out.stats = { rows: out.lines.length, blank, rejected: out.rejected.length, from: min, to: max };
    out.hash = U.hash(JSON.stringify(out.lines));
    return out;
  }
  const INVOICE_FIELDS = { date: ['請求日', '発行日', '売上日', '取引日', '日付'], partner: ['取引先', '取引先名', '請求先', '顧客名', '得意先', '得意先名'], amount: ['請求金額', '請求額', '合計金額', '税込金額', '金額', '合計'], no: ['請求書番号', '請求番号', '番号', 'No.', 'No'], due: ['入金期日', '支払期日', '入金予定日', '支払期限', '期日'], item: ['件名', '品目', '内容', '摘要'] };
  const INVOICE_LABEL = { date: '請求日', partner: '取引先', amount: '請求金額', no: '請求書番号', due: '入金期日', item: '件名' };
  function readInvoices(text, fileName) {
    return readTable(text, fileName, 'invoices', INVOICE_FIELDS, ['date', 'partner', 'amount'], INVOICE_LABEL, (r, get, num, reasons) => {
      const amount = num('amount', true), partner = get(r, 'partner'), dueRaw = get(r, 'due'), due = dueRaw ? U.parseDate(dueRaw) : null;
      if (!partner) reasons.push('取引先が空です'); if (dueRaw && !due) reasons.push('入金期日を読めません（「' + dueRaw + '」）'); if (amount === 0) reasons.push('請求金額が0です');
      return { partner, amount, no: get(r, 'no'), due, item: get(r, 'item') };
    });
  }
  const PAYROLL_FIELDS = { date: ['支給日', '支払日', '日付'], name: ['氏名', '従業員名', '社員名', '名前'], cls: ['区分', '役員区分', '役職区分'], gross: ['総支給額', '総支給', '支給合計', '支給額合計'], deduct: ['控除合計', '控除額合計', '控除計'], net: ['差引支給額', '差引支給', '手取額', '振込額'] };
  const PAYROLL_LABEL = { date: '支給日', name: '氏名', cls: '区分', gross: '総支給額', deduct: '控除合計', net: '差引支給額' };
  function readPayroll(text, fileName) {
    const res = readTable(text, fileName, 'payroll', PAYROLL_FIELDS, ['date', 'gross'], PAYROLL_LABEL, (r, get, num) => ({ name: get(r, 'name'), officer: /役員/.test(U.nfkc(get(r, 'cls'))), gross: num('gross', true), deduct: num('deduct', false), net: num('net', false) }));
    if (!res.fatal) { const has = k => res.columns.some(c => c.key === k); res.has = { cls: has('cls'), deduct: has('deduct'), net: has('net') }; }
    return res;
  }

  // 書き出し用。Excel で数式として扱われないよう、= + - @ で始まる文字列には ' を付ける
  function toCSV(rows) {
    return '﻿' + rows.map(r => r.map(v => {
      let s = v == null ? '' : String(v);
      if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n') + '\r\n';
  }

  KR.csv = { decode, parse, readJournal, readStatement, readBS, readInvoices, readPayroll, toCSV, JOURNAL_FIELDS, STATEMENT_FIELDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = KR;
})(typeof globalThis !== 'undefined' ? globalThis : this);

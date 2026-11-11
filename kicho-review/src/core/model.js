// 記帳レビュー：会社の設定の初期値、勘定科目の種類、仕訳のまとめ方、制度ルール表（出典つき）
(function (root) {
  'use strict';
  const KR = root.KR = root.KR || {};
  const U = KR.util;

  const STATUS = { open: '未確認', working: '確認中', waiting: '先方確認待ち', fixed: '修正済み', ok: '問題なし' };
  const UNRESOLVED = ['open', 'working', 'waiting'];
  const SEVERITY = { high: '高', mid: '中', low: '低' };
  // 指摘の根拠の種類。利用者が「何に基づく指摘か」を区別できるようにする
  const BASIS = {
    data: 'データ上の一致・不一致',      // 取り込んだデータ同士を突き合わせた結果（重複候補・照合差異など）
    rule: 'ルール上の不整合',            // 会社別ルール、または制度（出典つき）との不整合
    trend: '過去傾向との違い',           // その会社の過去の処理と違う
    evidence: '資料不足による確認依頼',  // データだけでは判定できず、資料の確認が要る
  };
  const CHECKS = { DUP: '重複候補', ACCOUNT: '勘定科目の不一致', TAX: '税区分の不一致', RECUR: '定期取引の計上漏れ', AMOUNT: '金額の違い', DESC: '摘要・取引先の不足', TAXRULE: '税区分と制度の適用時期', CASH: '現金残高', RECON: '明細との照合' };
  const TAX_STATUS = { unknown: '未登録', general: '課税事業者（本則課税）', simplified: '課税事業者（簡易課税）', special20: '課税事業者（2割特例）', exempt: '免税事業者' };

  function newCompany(name) {
    return {
      id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name || '', type: 'corp', business: '', fiscalEndMonth: 3,
      tax: { status: 'unknown', accounting: 'unknown', note: '' },
      thresholds: { high: 100000, mid: 10000, min: 1000, dateWindow: 3 },
      accountKinds: {},      // 科目名 → 'fund'（現金・預金・カード等の口座）| 'bs' | 'pl'
      partnerRules: [],      // { id, partner, account, tax, note }
      recurring: [],         // { id, name, account, partner, keyword, amount, tolerancePct, note }
      exceptions: [],        // 確認済みルール { id, check, partner, account, keyword, amountMin, amountMax, from, to, reason, by, at }
      cashOpening: { date: '', amount: null },
      notes: '',             // 特有の取引・例外処理のメモ（判定には使わない。引継ぎに出す）
      createdAt: new Date().toISOString(),
    };
  }
  function thresholds(company) {
    const t = Object.assign({ high: 100000, mid: 10000, min: 1000, dateWindow: 3 }, company && company.thresholds);
    for (const k of Object.keys(t)) t[k] = Math.max(0, Number(t[k]) || 0);
    return t;
  }

  // 科目の種類。CSVには区分がないため名前から推定する。会社別の指定（accountKinds）が優先
  const FUND_RE = /現金|預金|銀行|信用金庫|信金|信用組合|労働金庫|ゆうちょ|カード|CARD|PAYPAY|SUICA|PASMO|電子マネー/i;
  const BS_RE = /^(売掛金|買掛金|未払金|未払費用|前払費用|前払金|前渡金|前受金|前受収益|仮払金|仮受金|立替金|預り金|未収入金|未収金|未収収益|短期貸付金|長期貸付金|役員貸付金|役員借入金|短期借入金|長期借入金|事業主貸|事業主借|元入金|資本金|資本準備金|商品|製品|仕掛品|原材料|貯蔵品|棚卸資産|仮払消費税|仮受消費税|未払消費税|未収消費税|未払法人税等|貸倒引当金|敷金|差入保証金|預け金|工具器具備品|車両運搬具|建物|建物附属設備|構築物|機械装置|ソフトウェア|土地|一括償却資産|繰越利益剰余金|受取手形|支払手形|電子記録債権|電子記録債務|有価証券|投資有価証券|出資金|保険積立金|長期前払費用|リース債務|賞与引当金|退職給付引当金)|減価償却累計額$/;
  function accountKind(company, name) {
    const o = company && company.accountKinds && company.accountKinds[name];
    if (o) return o;
    const n = U.nfkc(name);
    if (FUND_RE.test(n)) return 'fund';
    if (BS_RE.test(n)) return 'bs';
    return 'pl';
  }

  // 行 → 仕訳（伝票番号が同じ行をまとめる）→ 借方・貸方それぞれの記入（posting）
  function buildEntries(company, lines) {
    const groups = U.groupBy(lines, l => l.slip ? l.src + '|' + l.date + '|' + l.slip : 'L|' + l.id);
    const entries = [];
    for (const ls of groups.values()) {
      const e = { id: ls[0].id, date: ls[0].date, month: ls[0].date.slice(0, 7), slip: ls[0].slip || '', lines: ls, postings: [], partner: '', desc: '' };
      for (const l of ls) {
        e.partner = e.partner || l.dPartner || l.cPartner || '';
        e.desc = e.desc || l.desc || '';
      }
      for (const l of ls) {
        for (const [side, p] of [['D', 'd'], ['C', 'c']]) {
          const acc = l[p + 'Acc']; if (!acc) continue;
          const partner = l[p + 'Partner'] || l[(p === 'd' ? 'c' : 'd') + 'Partner'] || e.partner;
          e.postings.push({ entry: e, line: l, side, account: acc, amount: l[p + 'Amt'], tax: l[p + 'Tax'] || '', partner, pkey: U.normPartner(partner), desc: l.desc || e.desc, dkey: U.normDesc(l.desc || e.desc), note: l[p + 'Note'] || '', kind: accountKind(company, acc) });
        }
      }
      e.isTransfer = e.postings.length > 0 && e.postings.every(p => p.kind === 'fund');
      for (const p of e.postings) p.route = [...new Set(e.postings.filter(q => q.side !== p.side).map(q => q.account))].sort().join('・');
      entries.push(e);
    }
    entries.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    return entries;
  }
  // 画面・保存用の仕訳の写し（循環参照なし）
  function entryView(e, files) {
    return {
      date: e.date, slip: e.slip, partner: e.partner, desc: e.desc,
      rows: e.lines.map(l => ({ row: l.row, file: (files && files[l.src]) || '', dAcc: l.dAcc || '', dAmt: l.dAmt == null ? null : l.dAmt, dTax: l.dTax || '', cAcc: l.cAcc || '', cAmt: l.cAmt == null ? null : l.cAmt, cTax: l.cTax || '', partner: l.dPartner || l.cPartner || '', desc: l.desc || '' })),
    };
  }

  // ---- 制度ルール表（判定に使うものだけ。確認日と出典を必ず持つ）----
  const SOURCES = {
    invoiceReview: { title: '国税庁「令和8年度 税制改正特集（インボイス関係）」', url: 'https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice-review/index.htm', checked: '2026-11-11' },
    ta6498: { title: '国税庁タックスアンサー No.6498 適格請求書等保存方式（インボイス制度）（令和8年4月1日現在法令等）', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6498.htm', checked: '2026-11-11' },
    ta6496: { title: '国税庁タックスアンサー No.6496 仕入税額控除をするための帳簿及び請求書等の保存（令和8年4月1日現在法令等）', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6496.htm', checked: '2026-11-11' },
    ta6505: { title: '国税庁タックスアンサー No.6505 簡易課税制度（令和8年4月1日現在法令等）', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6505.htm', checked: '2026-11-11' },
  };
  // 適格請求書発行事業者以外からの課税仕入れに係る経過措置の控除割合
  const INVOICE_RATIO = [
    { from: '2023-10-01', to: '2026-09-30', pct: 80 },
    { from: '2026-10-01', to: '2028-09-30', pct: 70 },
    { from: '2028-10-01', to: '2030-09-30', pct: 50 },
    { from: '2030-10-01', to: '2031-09-30', pct: 30 },
  ];
  function invoiceRatioOn(date) { const r = INVOICE_RATIO.find(x => date >= x.from && date <= x.to); return r ? r.pct : (date > '2031-09-30' ? 0 : null); }
  function ratioInTax(tax) { const m = U.nfkc(tax).match(/控\s*(\d{2})/); return m ? +m[1] : null; }
  // 比較用の税区分名：経過措置の割合（控80・控70…）は時期で正しく変わるため、比較からは外す
  function taxBase(tax) { return U.nfkc(tax).replace(/控\s*\d{2}/, '控').replace(/\s/g, ''); }

  // 税区分の違いが、その会社の消費税の納付税額に影響するか。side は 'sales' | 'purchase'
  function taxImpact(company, side) {
    const st = (company && company.tax && company.tax.status) || 'unknown';
    if (st === 'exempt') return { affects: false, text: 'この会社は免税事業者として登録されているため、税区分の違いは消費税の納付税額には影響しません（課税売上高を集計して納税義務を判定する資料に使う場合は、売上側の区分を確認してください）。', sources: [] };
    if (st === 'simplified' || st === 'special20') {
      if (side === 'purchase') return { affects: false, text: 'この会社は' + TAX_STATUS[st] + 'として登録されています。納付税額は売上に係る消費税額から計算するため、仕入側の税区分の違いは原則として納付税額に影響しません（本則課税と比べて有利不利を検討する場合を除く）。', sources: [SOURCES.ta6505, SOURCES.invoiceReview] };
      return { affects: true, text: 'この会社は' + TAX_STATUS[st] + 'として登録されています。売上側の税区分は納付税額に影響します。', sources: [SOURCES.ta6505] };
    }
    if (st === 'general') return { affects: true, text: 'この会社は本則課税として登録されているため、税区分の違いは納付税額に影響します。', sources: [] };
    return { affects: null, text: '会社の消費税の処理方針が未登録のため、納付税額への影響は判定していません（会社ルールで登録してください）。', sources: [] };
  }

  KR.model = { STATUS, UNRESOLVED, SEVERITY, BASIS, CHECKS, TAX_STATUS, SOURCES, INVOICE_RATIO, newCompany, thresholds, accountKind, buildEntries, entryView, invoiceRatioOn, ratioInTax, taxBase, taxImpact };
  if (typeof module !== 'undefined' && module.exports) module.exports = KR;
})(typeof globalThis !== 'undefined' ? globalThis : this);

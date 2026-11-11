// 記帳レビュー：資料との照合（売上資料・請求一覧 ⇔ 売上・入金、給与資料 ⇔ 給与・預り金・支払）
// 区分は口座明細の照合と同じ「一致」「差額あり」「片側のみ」「同一取引か要確認」
(function (root) {
  'use strict';
  const KR = root.KR = root.KR || {};
  const U = KR.util, M = KR.model, RC = KR.reconcile;
  const PAY_RE = /役員報酬|役員給与|給料|給与|賃金|賞与|雑給/, OFFICER_PAY_RE = /役員/;
  const sevOf = (a, t) => Math.abs(a) >= t.high ? 'high' : Math.abs(a) >= t.mid ? 'mid' : 'low';

  // ---------- 売上資料 ----------
  function matchSales(company, lines, invoices, month, opts) {
    const o = Object.assign({ window: 3, feeMax: 1000, graceDays: 60, files: {} }, opts), mEnd = U.monthEnd(month);
    const entries = M.buildEntries(company, lines), view = e => M.entryView(e, o.files);
    const inv = invoices.map((l, i) => Object.assign({ i, pkey: U.normPartner(l.partner) }, l));
    // 売上の計上：対象月の請求 ⇔ 対象月の収益科目の貸方
    const sInv = inv.filter(l => l.date.slice(0, 7) === month);
    const book = entries.filter(e => e.month === month).flatMap(e => e.postings.filter(p => p.kind === 'pl' && p.side === 'C' && M.plClass(company, p.account) === 'rev').map(p => ({ date: e.date, amount: p.amount, partner: p.partner, pkey: p.pkey, desc: p.desc, counter: p.account, entry: view(e) })));
    const results = [], left = { s: [], b: [] };
    for (const pk of new Set(sInv.map(l => l.pkey).concat(book.map(b => b.pkey)))) {
      const S = sInv.filter(l => l.pkey === pk), B = book.filter(b => b.pkey === pk);
      const rec = RC.reconcile(S, B, { window: o.window, comboWindow: o.window, feeMax: 0 });
      for (const r of rec.results) {
        if (r.category === 'single') { (r.side === 'statement' ? left.s : left.b).push(r.side === 'statement' ? r.statement[0] : r.book[0]); continue; }
        results.push({ category: r.category, invoices: r.statement, book: r.book, note: r.note.replace(/明細/g, '請求') });
      }
    }
    // 同じ取引先で請求・帳簿が1件ずつ残り、日付が近ければ「差額あり」
    for (const pk of new Set(left.s.map(l => l.pkey))) {
      const S = left.s.filter(l => l.pkey === pk), B = left.b.filter(b => b.pkey === pk);
      if (pk && S.length === 1 && B.length === 1 && Math.abs(U.dayDiff(S[0].date, B[0].date)) <= o.window) {
        const d = S[0].amount - B[0].amount, ratio = S[0].amount / B[0].amount;
        results.push({ category: 'diff', invoices: S, book: B, diff: d, taxGuess: Math.abs(ratio - 1.1) < 0.001 || Math.abs(ratio - 1.08) < 0.001, note: '請求 ' + U.yen(S[0].amount) + ' − 帳簿 ' + U.yen(B[0].amount) + ' ＝ ' + U.yen(d) });
        left.s = left.s.filter(x => x !== S[0]); left.b = left.b.filter(x => x !== B[0]);
      }
    }
    // 取引先名が違うが金額と日付が合うもの：同じ取引の可能性
    for (const s of left.s.slice()) {
      const cs = left.b.filter(b => b.amount === s.amount && Math.abs(U.dayDiff(s.date, b.date)) <= o.window);
      if (!cs.length) continue;
      results.push({ category: 'unsure', invoices: [s], book: cs, note: '金額と日付は合いますが、取引先名が違います（請求「' + s.partner + '」／帳簿「' + cs.map(b => b.partner || '空欄').join('・') + '」）' });
      left.s = left.s.filter(x => x !== s); left.b = left.b.filter(b => !cs.includes(b));
    }
    for (const s of left.s) results.push({ category: 'single', side: 'invoice', invoices: [s], book: [], note: '請求にあり、帳簿の売上にない' });
    for (const b of left.b) results.push({ category: 'single', side: 'book', invoices: [], book: [b], note: '帳簿の売上にあり、請求にない' });
    const counts = { match: 0, diff: 0, single: 0, unsure: 0 }; results.forEach(r => counts[r.category]++);

    // 入金：資料のすべての請求（対象月末まで）⇔ 帳簿の入金（口座の借方で、相手が同じ取引先の債権・売上）
    const receipts = entries.filter(e => e.date <= mEnd).flatMap(e => {
      const cr = e.postings.find(p => p.side === 'C' && p.pkey && (p.kind === 'bs' ? /売掛金|未収/.test(p.account) : M.plClass(company, p.account) === 'rev'));
      return cr ? e.postings.filter(p => p.side === 'D' && p.kind === 'fund').map(p => ({ date: e.date, amount: p.amount, pkey: cr.pkey, partner: cr.partner, used: false, entry: view(e) })) : [];
    });
    const pay = [];
    for (const pk of new Set(inv.map(l => l.pkey))) {
      const I = inv.filter(l => l.pkey === pk && l.date <= mEnd).sort((a, b) => a.date < b.date ? -1 : 1).map(l => ({ inv: l, status: null })), Rc = receipts.filter(r => r.pkey === pk).sort((a, b) => a.date < b.date ? -1 : 1);
      const open = () => I.filter(x => !x.status), free = () => Rc.filter(r => !r.used);
      for (const x of open()) { const r = free().find(r => r.amount === x.inv.amount && r.date >= x.inv.date); if (r) { r.used = true; Object.assign(x, { status: 'paid', receipts: [r], note: r.date + ' に同額の入金' }); } }
      for (const r of free()) {   // 1回の入金 ＝ 複数の請求の合計
        const pool = open().filter(x => x.inv.date <= r.date && x.inv.amount < r.amount);
        const sets = pool.length >= 2 ? RC.subsets(pool.map(x => ({ amount: x.inv.amount, x })), r.amount, 4) : [];
        if (sets.length === 1) { r.used = true; sets[0].forEach(s => Object.assign(s.x, { status: 'paid', receipts: [r], note: r.date + ' の入金 ' + U.yen(r.amount) + ' に合算（' + sets[0].length + '件分）' })); }
      }
      for (const x of open()) {   // 手数料程度の差額
        const cs = free().filter(r => r.date >= x.inv.date && x.inv.amount - r.amount > 0 && x.inv.amount - r.amount <= o.feeMax);
        if (cs.length === 1) { cs[0].used = true; Object.assign(x, { status: 'paidDiff', receipts: [cs[0]], diff: x.inv.amount - cs[0].amount, note: cs[0].date + ' の入金 ' + U.yen(cs[0].amount) + '（差額 ' + U.yen(x.inv.amount - cs[0].amount) + '）' }); }
      }
      for (const x of open()) {
        const due = x.inv.due, limit = due || U.addDays(x.inv.date, o.graceDays);
        if (limit < mEnd) Object.assign(x, { status: 'overdue', note: due ? '入金期日 ' + due + ' を過ぎても、帳簿に入金が見当たりません' : '入金期日の記載がなく、請求から ' + o.graceDays + '日を過ぎても帳簿に入金が見当たりません' });
        else Object.assign(x, { status: 'notDue', note: due ? '入金期日 ' + due + '（対象月末より後）' : '入金期日の記載なし（請求から ' + o.graceDays + '日以内）' });
      }
      pay.push(...I);
    }
    const payCounts = { paid: 0, paidDiff: 0, overdue: 0, notDue: 0 }; pay.forEach(x => payCounts[x.status]++);
    return { results, counts, pay, payCounts, options: o, stats: { invoices: sInv.length, book: book.length, all: inv.length } };
  }
  function salesFindings(res, ctx) {
    const t = M.thresholds(ctx.company), out = [];
    const invRows = l => l.map(s => ({ row: s.row, date: s.date, desc: [s.partner, s.no ? '請求書 ' + s.no : '', s.item, s.due ? '期日 ' + s.due : ''].filter(Boolean).join('／'), amount: s.amount, balance: null }));
    const base = (r, key) => ({ key: 'SLS|' + U.hash(ctx.month + '|' + key), check: 'SALES', month: ctx.month, entries: (r.book || []).map(b => b.entry), entriesLabel: '帳簿側', statementRows: invRows(r.invoices || []), statementFile: ctx.fileName, statementLabel: '請求一覧', comparison: null, sources: [], fix: null, inference: [], calc: [] });
    const invKey = l => l.map(s => [s.date, s.pkey, s.amount, s.no].join('~')).join(','), bookKey = l => l.map(b => [b.date, b.pkey, b.amount].join('~')).join(',');
    for (const r of res.results) {
      if (r.category === 'match') continue;
      const first = r.invoices[0] || r.book[0], partner = first.partner || '', amount = r.category === 'diff' ? Math.abs(r.diff) : Math.abs(first.amount);
      const f = Object.assign(base(r, r.category + invKey(r.invoices) + '|' + bookKey(r.book)), { date: first.date, partner, account: '売上高', amount, reconCategory: RC.CATEGORY[r.category], match: { partner, account: '売上高', amount, text: first.item || first.desc || '' } });
      if (r.category === 'diff') Object.assign(f, { basis: 'data', severity: sevOf(r.diff, t), title: '売上資料：差額あり ' + partner + ' ' + U.yen(r.diff) + '（請求 ' + U.yen(r.invoices[0].amount) + '／帳簿 ' + U.yen(r.book[0].amount) + '）', reason: partner + ' の請求額と、帳簿の売上の金額が違います。', calc: [r.note], inference: [r.taxGuess ? '請求額が帳簿のちょうど1.1倍（または1.08倍）のため、税込と税抜の違いの可能性があります（帳簿が税抜経理か、請求一覧が税込かを確認してください）。' : '請求の修正・値引、計上金額の入力誤り、請求一覧と帳簿で税込・税抜が違う、のいずれかの可能性があります。'], documents: ['請求書の控え', '見積・契約（金額の根拠）'], nextAction: 'どちらの金額が正しいかを請求書で確認してください。', fixNote: '正とする資料（' + (ctx.truth === 'book' ? '帳簿' : '請求一覧') + '）は利用者の指定です。金額の違いの理由が分からないため、修正案は示していません。', question: partner + ' 様あての ' + first.date + ' の請求について、請求額（' + U.yen(r.invoices[0].amount) + '）が確定額かを教えてください。' });
      else if (r.category === 'unsure') Object.assign(f, { basis: 'evidence', severity: 'low', title: '売上資料：同一取引か要確認 ' + U.yen(first.amount) + '（' + r.note.replace(/^.*?（|）$/g, '') + '）', reason: r.note + '。', documents: ['請求書の控え', '取引先の正式名称'], nextAction: '同じ取引かどうかを確認し、同じなら取引先名をそろえてください（名前がそろうと次回から一致になります）。', fixNote: '同じ取引かどうかが決まらないため、修正案は示していません。', question: first.date + ' の ' + U.yen(first.amount) + ' の請求先の正式名称を教えてください。' });
      else if (r.side === 'invoice') Object.assign(f, { basis: 'data', severity: sevOf(amount, t), title: '売上資料：請求のみ（売上の計上が見当たらない）' + partner + ' ' + first.date + ' ' + U.yen(first.amount), reason: '請求一覧の ' + partner + ' ' + first.date + ' ' + U.yen(first.amount) + ' に対応する売上が、対象月の帳簿に見つかりません。', inference: ['売上の計上漏れ、別の月への計上、別の取引先名・科目での計上、請求の取消のいずれかの可能性があります。'], documents: ['請求書の控え', '納品・検収の記録（売上の計上日）'], nextAction: ctx.truth === 'book' ? '帳簿を正とする指定のため、請求一覧の誤り・取消がないかを先に確認してください。' : '請求が有効かを確認し、未計上であれば売上の登録を検討してください。', fixNote: '計上日・税区分は取引の内容で決まるため、修正案は示していません。', question: partner + ' 様あての ' + first.date + ' の請求（' + U.yen(first.amount) + '）は有効でしょうか。納品・作業完了の日もあわせて教えてください。' });
      else Object.assign(f, { basis: 'data', severity: sevOf(amount, t), title: '売上資料：帳簿のみ（請求一覧にない売上）' + partner + ' ' + first.date + ' ' + U.yen(first.amount), reason: '帳簿の売上 ' + partner + ' ' + first.date + ' ' + U.yen(first.amount) + ' に対応する請求が、請求一覧に見つかりません。', inference: ['請求一覧の対象期間・出力条件から漏れている、請求書を別の方法で発行した、売上の二重計上・計上月の誤りのいずれかの可能性があります。'], documents: ['請求書の控え', '請求一覧の出力条件'], nextAction: '請求書が発行されているかを確認してください。', fixNote: '請求の有無がデータからは分からないため、修正案は示していません。', question: partner + ' 様への ' + first.date + ' の売上（' + U.yen(first.amount) + '）について、請求書の控えをご共有ください。' });
      out.push(f);
    }
    for (const x of res.pay) {
      if (x.status !== 'overdue' && x.status !== 'paidDiff') continue;
      const s = x.inv, r = { invoices: [s], book: (x.receipts || []) };
      const f = Object.assign(base(r, 'pay' + x.status + invKey([s])), { date: s.date, partner: s.partner, account: '売掛金', match: { partner: s.partner, account: '売掛金', amount: s.amount, text: s.item || '' } });
      if (x.status === 'overdue') Object.assign(f, { basis: s.due ? 'data' : 'evidence', severity: sevOf(s.amount, t), amount: s.amount, reconCategory: '片側のみ', title: '入金が見当たらない請求：' + s.partner + ' ' + s.date + ' ' + U.yen(s.amount) + (s.due ? '（期日 ' + s.due + '）' : ''), reason: x.note + '（対象月末 ' + U.monthEnd(ctx.month) + ' まで、同じ取引先の入金を、同額・複数請求の合算・' + U.yen(res.options.feeMax) + ' 以内の差額で探した結果）。', inference: ['入金の遅れ、入金を別の取引先名・別の科目で登録、値引・相殺、請求の取消のいずれかの可能性があります。'], documents: ['通帳（対象の入金）', '請求書の控え・入金の通知'], nextAction: '通帳で入金の有無を確認してください。入金済みなら、帳簿の登録内容（取引先・科目）を確認します。', fixNote: '入金の有無がデータからは分からないため、修正案は示していません。', question: s.partner + ' 様あての ' + s.date + ' の請求（' + U.yen(s.amount) + (s.due ? '、期日 ' + s.due : '') + '）について、ご入金の状況を教えてください。' });
      else Object.assign(f, { basis: 'data', severity: 'low', amount: x.diff, reconCategory: '差額あり', title: '入金の差額：' + s.partner + ' 請求 ' + U.yen(s.amount) + ' に対し入金 ' + U.yen(s.amount - x.diff) + '（差 ' + U.yen(x.diff) + '）', reason: x.note + '。', inference: ['振込手数料の控除の可能性があります。値引・相殺の可能性もあります。'], documents: ['入金の通知', '手数料負担の取決め'], nextAction: '差額の理由を確認し、売掛金に残っている差額の処理（支払手数料など）を検討してください。', fixNote: '差額の理由がデータからは分からないため、修正案は示していません。', question: s.partner + ' 様からのご入金が請求額より ' + U.yen(x.diff) + ' 少なくなっています。振込手数料の控除でしょうか。' });
      out.push(f);
    }
    return out;
  }

  // ---------- 給与資料 ----------
  function matchPayroll(company, lines, rows, month, opts) {
    const files = (opts && opts.files) || {}, R = rows.filter(r => r.date.slice(0, 7) === month), has = (opts && opts.has) || { cls: true, deduct: true, net: true };
    const es = M.buildEntries(company, lines).filter(e => e.month === month && e.postings.some(p => p.side === 'D' && PAY_RE.test(p.account)));
    const sumP = f => es.reduce((s, e) => s + e.postings.filter(f).reduce((x, p) => x + p.amount, 0), 0), sumR = f => R.reduce((s, r) => s + (f(r) || 0), 0);
    const gross = p => p.side === 'D' && PAY_RE.test(p.account), items = [];
    const push = (id, label, doc, book, hint) => items.push({ id, label, doc, book, diff: doc - book, category: doc === book ? 'match' : (!es.length || !R.length) ? 'single' : 'diff', hint });
    if (has.cls) { push('gross-officer', '総支給額（役員）', sumR(r => r.officer ? r.gross : 0), sumP(p => gross(p) && OFFICER_PAY_RE.test(p.account)), '帳簿は「役員」を含む給与科目の借方'); push('gross-staff', '総支給額（従業員）', sumR(r => r.officer ? 0 : r.gross), sumP(p => gross(p) && !OFFICER_PAY_RE.test(p.account)), '帳簿は役員以外の給与科目の借方'); }
    else push('gross', '総支給額', sumR(r => r.gross), sumP(gross), '帳簿は給与科目（役員報酬・給料手当・賞与など）の借方');
    if (has.deduct) push('deduct', '控除合計（預り金）', sumR(r => r.deduct), sumP(p => p.side === 'C' && /預り金/.test(p.account)), '帳簿は給与の仕訳の貸方「預り金」');
    if (has.net) push('net', '差引支給額（支払）', sumR(r => r.net), sumP(p => p.side === 'C' && (p.kind === 'fund' || /未払金|未払費用/.test(p.account))), '帳簿は給与の仕訳の貸方（口座、または未払金・未払費用）');
    const counts = { match: 0, diff: 0, single: 0, unsure: 0 }; items.forEach(i => counts[i.category]++);
    return { items, counts, rows: R, entries: es.map(e => M.entryView(e, files)), stats: { people: R.length, entries: es.length } };
  }
  function payrollFindings(res, ctx) {
    const t = M.thresholds(ctx.company), out = [];
    for (const i of res.items) {
      if (i.category === 'match') continue;
      const amount = Math.abs(i.diff);
      out.push({
        key: 'PAY|' + U.hash(ctx.month + '|' + i.id), check: 'PAY', month: ctx.month, basis: 'data', severity: sevOf(amount, t), reconCategory: RC.CATEGORY[i.category], date: (res.rows[0] || {}).date || ctx.month + '-01', partner: '', account: '給与', amount,
        title: '給与資料：' + RC.CATEGORY[i.category] + ' ' + i.label + ' ' + U.yen(i.diff) + '（資料 ' + U.yen(i.doc) + '／帳簿 ' + U.yen(i.book) + '）',
        reason: i.label + 'が、給与資料の合計 ' + U.yen(i.doc) + ' と、帳簿の合計 ' + U.yen(i.book) + ' で ' + U.yen(Math.abs(i.diff)) + ' 違います' + (i.category === 'single' ? '（' + (res.stats.entries ? '給与資料に対象月の行がありません' : '帳簿に対象月の給与の仕訳がありません') + '）' : '') + '。',
        entries: res.entries, entriesLabel: '帳簿側（対象月の給与の仕訳）',
        statementRows: res.rows.map(r => ({ row: r.row, date: r.date, desc: [r.name, r.officer ? '役員' : '', '総支給 ' + U.yen(r.gross), r.deduct != null ? '控除 ' + U.yen(r.deduct) : '', r.net != null ? '差引 ' + U.yen(r.net) : ''].filter(Boolean).join('／'), amount: -(r.net != null ? r.net : r.gross), balance: null })), statementFile: ctx.fileName, statementLabel: '給与資料',
        comparison: null, sources: [], fix: null, calc: ['資料 ' + U.yen(i.doc) + ' − 帳簿 ' + U.yen(i.book) + ' ＝ ' + U.yen(i.diff), i.hint, '給与資料 ' + res.stats.people + '人分、帳簿の給与の仕訳 ' + res.stats.entries + '件（支給日が対象月のもの）'],
        inference: ['支給額の改定・入力誤り、支給月と計上月のずれ、賞与・手当を別の科目で計上、控除の一部（社会保険料の本人負担分など）を預り金以外で処理、のいずれかの可能性があります。'],
        documents: ['給与台帳・賃金台帳・給与明細', '通帳（振込額）', '役員の場合は報酬を決めた議事録'], nextAction: '人ごとに、給与資料と帳簿の金額を照合してください（この版の比較は月の合計どうしです）。',
        fixNote: '正とする資料（' + (ctx.truth === 'book' ? '帳簿' : '給与資料') + '）は利用者の指定です。人ごとの内訳が帳簿にないため、修正案は示していません。', question: ctx.month.replace('-', '年') + '月支給分の' + i.label.replace(/（.*）/, '') + 'について、給与台帳をご共有ください（帳簿の金額と ' + U.yen(Math.abs(i.diff)) + ' の差があります）。',
        match: { partner: '', account: '給与', amount, text: i.label },
      });
    }
    return out;
  }

  KR.docs = { matchSales, salesFindings, matchPayroll, payrollFindings };
  if (typeof module !== 'undefined' && module.exports) module.exports = KR;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// 記帳レビュー：明細（銀行・カード・現金出納帳）と帳簿の照合
// 結果は「一致」「差額あり」「片側のみ」「同一取引か要確認」の4つ。組合せの探索も含めすべて決まった手順で行う
(function (root) {
  'use strict';
  const KR = root.KR = root.KR || {};
  const U = KR.util, M = KR.model;
  const CATEGORY = { match: '一致', diff: '差額あり', single: '片側のみ', unsure: '同一取引か要確認' };

  // 帳簿側：指定した口座科目の記入を、明細と同じ向き（口座が増える＝＋）にそろえる
  // kind: 'asset'（預金・現金。借方が＋） | 'card'（カード等の負債。明細の「利用」＝貸方を − とする）
  function bookLines(company, lines, account, from, to, files) {
    const out = [];
    for (const e of M.buildEntries(company, lines)) {
      if (e.date < from || e.date > to) continue;
      for (const p of e.postings) {
        if (p.account !== account) continue;
        out.push({ date: e.date, amount: p.side === 'D' ? p.amount : -p.amount, desc: p.desc, partner: p.partner, counter: p.route, entry: M.entryView(e, files) });
      }
    }
    return out;
  }

  // 合計が target になる組（2〜4件）をすべて探す。候補は最大12件まで
  function subsets(items, target, maxSize) {
    const res = [], n = Math.min(items.length, 12);
    (function rec(start, left, pick) {
      if (pick.length >= 2 && left === 0) { res.push(pick.slice()); return; }
      if (pick.length >= maxSize || res.length > 5) return;
      for (let i = start; i < n; i++) {
        const a = Math.abs(items[i].amount);
        if (a > left) continue;
        pick.push(items[i]); rec(i + 1, left - a, pick); pick.pop();
      }
    })(0, Math.abs(target), []);
    return res;
  }

  function reconcile(statement, book, opts) {
    const o = Object.assign({ window: 3, comboWindow: 5, feeMax: 1000, truth: 'statement' }, opts);
    const S = statement.map((l, i) => Object.assign({ i, used: false }, l)), B = book.map((l, i) => Object.assign({ i, used: false }, l));
    const results = [];
    const near = (a, b, w) => Math.abs(U.dayDiff(a.date, b.date)) <= w;
    const take = (cat, ss, bs, note, extra) => { ss.forEach(x => x.used = true); bs.forEach(x => x.used = true); results.push(Object.assign({ category: cat, statement: ss, book: bs, note, sTotal: ss.reduce((t, x) => t + x.amount, 0), bTotal: bs.reduce((t, x) => t + x.amount, 0) }, extra)); };
    const free = list => list.filter(x => !x.used);

    // 1. 日付・金額とも同じ（同じ日に同額が複数あっても、件数が合う分は順に対応させる）
    for (const s of S) { const b = B.find(x => !x.used && x.date === s.date && x.amount === s.amount); if (b) take('match', [s], [b], '日付・金額が一致'); }
    // 2. 金額が同じで日付が近い。相手が1つに決まるときだけ一致にする
    const pend = new Map();
    for (const s of free(S)) {
      const cs = free(B).filter(b => b.amount === s.amount && near(s, b, o.window));
      if (!cs.length) continue;
      const rivals = free(S).filter(x => x !== s && x.amount === s.amount && cs.some(b => near(x, b, o.window)));
      if (cs.length === 1 && !rivals.length) take('match', [s], [cs[0]], '金額が一致、日付が ' + Math.abs(U.dayDiff(s.date, cs[0].date)) + '日ずれ', { dateShift: U.dayDiff(cs[0].date, s.date) });
      else pend.set(s, cs);
    }
    // 相手が1つに決まらないもの：まとめて「要確認」
    for (const s of free(S)) {
      if (!pend.has(s)) continue;
      const ss = free(S).filter(x => x.amount === s.amount && free(B).some(b => b.amount === x.amount && near(x, b, o.window)));
      const bs = free(B).filter(b => b.amount === s.amount && ss.some(x => near(x, b, o.window)));
      if (ss.length && bs.length) take('unsure', ss, bs, '同じ金額で日付の近い取引が、明細 ' + ss.length + '件・帳簿 ' + bs.length + '件あり、対応を1つに決められません');
    }
    // 3. 合算・分割：明細1件 ＝ 帳簿の複数件、または 帳簿1件 ＝ 明細の複数件
    const combo = (ones, manys, oneIsStatement) => {
      for (const one of free(ones)) {
        const pool = free(manys).filter(m => Math.sign(m.amount) === Math.sign(one.amount) && Math.abs(m.amount) < Math.abs(one.amount) && near(one, m, o.comboWindow)).sort((a, b) => Math.abs(U.dayDiff(one.date, a.date)) - Math.abs(U.dayDiff(one.date, b.date)));
        if (pool.length < 2) continue;
        const sets = subsets(pool, one.amount, 4);
        if (!sets.length) continue;
        const kind = oneIsStatement ? (one.amount > 0 ? '合算入金' : '合算出金') : (one.amount > 0 ? '分割入金' : '分割出金');
        const what = oneIsStatement ? '明細1件 ＝ 帳簿 ' : '帳簿1件 ＝ 明細 ';
        if (sets.length === 1) take('match', oneIsStatement ? [one] : sets[0], oneIsStatement ? sets[0] : [one], kind + '：' + what + sets[0].length + '件の合計（' + sets[0].map(x => U.yen(Math.abs(x.amount))).join(' ＋ ') + '）', { combo: kind });
        else { const uni = [...new Set(sets.flat())]; take('unsure', oneIsStatement ? [one] : uni, oneIsStatement ? uni : [one], kind + 'の可能性：合計が一致する組合せが複数あり、対応を1つに決められません'); }
      }
    };
    combo(S, B, true); combo(B, S, false);
    // 4. 差額が小さい（振込手数料の控除など）。入金は明細が少ない側、出金は明細が多い側だけを見る
    for (const s of free(S)) {
      const cs = free(B).filter(b => Math.sign(b.amount) === Math.sign(s.amount) && near(s, b, o.window) && b.amount - s.amount > 0 && b.amount - s.amount <= o.feeMax);
      if (cs.length !== 1) continue;
      if (free(S).some(x => x !== s && Math.sign(x.amount) === Math.sign(s.amount) && near(x, cs[0], o.window) && cs[0].amount - x.amount > 0 && cs[0].amount - x.amount <= o.feeMax)) continue;
      const d = cs[0].amount - s.amount;
      take('diff', [s], [cs[0]], '差額 ' + U.yen(d) + '（帳簿 ' + U.yen(Math.abs(cs[0].amount)) + ' − 明細 ' + U.yen(Math.abs(s.amount)) + (s.amount < 0 ? '、出金は明細の方が多い' : '') + '）', { diff: d, feeGuess: true });
    }
    // 5. 残り：片側のみ
    for (const s of free(S)) take('single', [s], [], '明細にあり、帳簿にない', { side: 'statement' });
    for (const b of free(B)) take('single', [], [b], '帳簿にあり、明細にない', { side: 'book' });

    const sum = l => l.reduce((t, x) => t + x.amount, 0);
    const counts = { match: 0, diff: 0, single: 0, unsure: 0 };
    results.forEach(r => counts[r.category]++);
    results.sort((a, b) => { const da = (a.statement[0] || a.book[0]).date, db = (b.statement[0] || b.book[0]).date; return da < db ? -1 : da > db ? 1 : 0; });
    return { results, counts, totals: { statement: sum(statement), book: sum(book), diff: sum(statement) - sum(book), statementCount: statement.length, bookCount: book.length }, options: o };
  }

  // 一致以外を、レビュー一覧の確認事項にする
  function toFindings(rec, ctx) {
    const t = M.thresholds(ctx.company), truthName = rec.options.truth === 'statement' ? '明細' : '帳簿';
    const sevOf = a => Math.abs(a) >= t.high ? 'high' : Math.abs(a) >= t.mid ? 'mid' : 'low';
    const sLine = s => s.date + ' ' + (s.amount > 0 ? '入金 ' : '出金 ') + U.yen(Math.abs(s.amount)) + (s.desc ? ' ' + s.desc : '');
    const out = [];
    for (const r of rec.results) {
      if (r.category === 'match') continue;
      const first = r.statement[0] || r.book[0], amount = Math.abs(r.category === 'diff' ? r.diff : (r.statement.length ? r.sTotal : r.bTotal));
      const base = {
        key: 'RCN|' + U.hash([ctx.account, r.category, r.statement.map(s => s.date + s.amount + s.desc).join(','), r.book.map(b => b.date + b.amount + b.partner).join(',')].join('|')),
        check: 'RECON', month: ctx.month, date: first.date, account: ctx.account, partner: (r.book[0] && r.book[0].partner) || '', amount,
        entries: r.book.map(b => b.entry), entriesLabel: '帳簿側（' + ctx.account + '）',
        statementRows: r.statement.map(s => ({ row: s.row, date: s.date, desc: s.desc, amount: s.amount, balance: s.balance })), statementFile: ctx.fileName,
        comparison: null, sources: [], fix: null, inference: [], reconCategory: CATEGORY[r.category],
        calc: ['照合の条件：日付の差 ' + rec.options.window + '日以内（合算・分割は ' + rec.options.comboWindow + '日以内）、差額の上限 ' + U.yen(rec.options.feeMax), '正とする資料（利用者の指定）：' + truthName],
        match: { partner: (r.book[0] && r.book[0].partner) || '', account: ctx.account, amount, text: (r.statement[0] && r.statement[0].desc) || '' },
      };
      if (r.category === 'diff') out.push(Object.assign(base, {
        basis: 'data', severity: 'low', title: '照合：差額あり ' + U.yen(r.diff) + '（' + ctx.account + ' ' + sLine(r.statement[0]) + '）',
        reason: '明細 ' + U.yen(Math.abs(r.sTotal)) + ' と帳簿 ' + U.yen(Math.abs(r.bTotal)) + ' に ' + U.yen(r.diff) + ' の差があります。',
        calc: [r.note].concat(base.calc), inference: ['振込手数料が差し引かれて入金された（または上乗せして支払った）可能性があります。値引・相殺・源泉徴収の可能性もあります。'],
        documents: ['請求書（請求額）', '入金・支払の通知', '取引先との手数料負担の取決め'], nextAction: '差額の理由を確認してください。手数料なら、負担する側に応じて支払手数料などへの振替を検討します。',
        fixNote: '差額の理由（手数料・値引・相殺など）がデータからは分からないため、修正案は示していません。',
        question: first.date + ' の ' + U.yen(Math.abs(r.sTotal)) + ' について、請求額 ' + U.yen(Math.abs(r.bTotal)) + ' との差額 ' + U.yen(r.diff) + ' の理由（振込手数料・値引等）を教えてください。',
      }));
      else if (r.category === 'unsure') out.push(Object.assign(base, {
        basis: 'evidence', severity: sevOf(amount) === 'high' ? 'mid' : 'low', title: '照合：同一取引か要確認（' + ctx.account + ' ' + U.yen(Math.abs(first.amount)) + '、明細 ' + r.statement.length + '件・帳簿 ' + r.book.length + '件）',
        reason: r.note + '。', documents: ['請求書・領収書', '通帳・カード明細の摘要'], nextAction: '明細の摘要と証憑から、どの明細がどの仕訳に当たるかを確認してください。件数が合わない分は、未記帳または二重計上の可能性があります。',
        fixNote: '対応が決まらないため、修正案は示していません。', question: first.date + ' 前後の ' + U.yen(Math.abs(first.amount)) + ' の取引（' + (r.statement.length + r.book.length) + '件）について、それぞれの内容が分かる資料をご共有ください。',
      }));
      else if (r.side === 'statement') out.push(Object.assign(base, {
        basis: 'data', severity: sevOf(amount), title: '照合：明細のみ（帳簿にない）' + ctx.account + ' ' + sLine(r.statement[0]),
        reason: '明細の ' + sLine(r.statement[0]) + ' に対応する仕訳が、帳簿の「' + ctx.account + '」に見つかりません（金額が同じで日付が ' + rec.options.window + '日以内のもの、合算・分割、少額の差額を探した結果）。',
        inference: ['未記帳、別の口座科目で登録されている、日付が大きく違う、のいずれかの可能性があります。'],
        documents: ['通帳・カード明細の原本', '請求書・領収書'], nextAction: rec.options.truth === 'statement' ? '取引の内容を確認し、未記帳であれば登録を検討してください。' : '帳簿を正とする指定のため、明細（資料）側の誤り・重複がないかを先に確認してください。',
        fixNote: '相手科目・税区分は取引の内容で決まるため、修正案は示していません。', question: sLine(r.statement[0]) + ' の内容（相手先・目的）を教えてください。',
      }));
      else out.push(Object.assign(base, {
        basis: 'data', severity: sevOf(amount), title: '照合：帳簿のみ（明細にない）' + ctx.account + ' ' + first.date + ' ' + U.yen(Math.abs(first.amount)) + (first.partner ? ' ' + first.partner : ''),
        reason: '帳簿の「' + ctx.account + '」' + first.date + ' ' + U.yen(Math.abs(first.amount)) + ' に対応する行が、明細に見つかりません。',
        inference: ['二重計上、口座科目の選び間違い、日付の誤り、明細の対象期間の外、のいずれかの可能性があります。'],
        documents: ['通帳・カード明細の原本（対象期間・口座）', 'この仕訳の元資料'], nextAction: rec.options.truth === 'statement' ? '明細に本当にないかを原本で確認してください。なければ、この仕訳の取消・口座や日付の訂正を検討します。重複候補に同じ取引が出ていないかも確認してください。' : '帳簿を正とする指定のため、明細（資料）の不足がないかを確認してください。',
        fixNote: '取消か訂正かはデータだけでは判断できないため、修正案は示していません。', question: first.date + ' の ' + U.yen(Math.abs(first.amount)) + (first.partner ? '（' + first.partner + '）' : '') + ' について、実際にお支払い（ご入金）があったか確認できる資料をご共有ください。',
      }));
    }
    return out;
  }

  KR.reconcile = { CATEGORY, bookLines, reconcile, toFindings, subsets };
  if (typeof module !== 'undefined' && module.exports) module.exports = KR;
})(typeof globalThis !== 'undefined' ? globalThis : this);

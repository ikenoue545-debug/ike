// 記帳レビュー：確認事項の状態（対応状況・メモ・履歴）、確認済みルールの適用、翌月への引継ぎ、上席への引継ぎ出力
(function (root) {
  'use strict';
  const KR = root.KR = root.KR || {};
  const U = KR.util, M = KR.model;

  const emptyReview = () => ({ states: {}, runs: {}, recon: {} });

  // レビューの実行結果を保存データに反映する。対応状況・メモ・履歴は key が同じなら引き継ぐ
  // inScope：今回の実行が担当する範囲（この範囲で、今回検出されなかったものに「検出されなくなった」印を付ける）
  function applyRun(review, month, findings, inScope, now) {
    const seen = new Set();
    for (const f of findings) {
      seen.add(f.key);
      const st = review.states[f.key] || (review.states[f.key] = { status: 'open', memo: '', reviewer: '', history: [], firstSeen: now });
      // 月をまたいで続く事項（滞留など）：解決済みにしたものが後の月にも検出されたら、未確認に戻して記録を残す
      if (st.month && st.month < f.month && !M.UNRESOLVED.includes(st.status)) { st.history.push({ at: now, by: '（自動）', from: st.status, to: 'open', memo: f.month + ' のレビューでも検出されたため、未確認に戻しました' }); st.status = 'open'; }
      st.finding = f; st.month = f.month; st.gone = false; st.lastSeen = now;
    }
    for (const [k, st] of Object.entries(review.states)) {
      if (seen.has(k) || !inScope(st.finding) || !(st.month === month || (st.finding.rolling && st.month < month))) continue;
      if (st.status === 'open' && !st.history.length && !st.memo) delete review.states[k];   // 一度も触っていないものは残さない
      else st.gone = true;
    }
    return review;
  }

  // 確認済みルール：会社・チェックの種類・期間・条件を限定したものだけを受け付ける
  function validateException(ex) {
    const errs = [];
    if (!ex.check || !M.CHECKS[ex.check]) errs.push('チェックの種類を選んでください');
    if (!/^\d{4}-\d{2}$/.test(ex.from || '') || !/^\d{4}-\d{2}$/.test(ex.to || '')) errs.push('適用する期間（開始月・終了月）を指定してください');
    else if (ex.from > ex.to) errs.push('終了月は開始月以後にしてください');
    if (!U.clean(ex.partner) && !U.clean(ex.account) && !U.clean(ex.keyword)) errs.push('取引先・勘定科目・摘要の語句のうち、少なくとも1つを条件にしてください（条件のない一括除外はできません）');
    if (!U.clean(ex.reason)) errs.push('問題なしとした理由を入力してください');
    return errs;
  }
  function matchException(company, f) {
    const m = f.match || {};
    return (company.exceptions || []).find(ex => {
      if (ex.check !== f.check || f.month < ex.from || f.month > ex.to) return false;
      if (U.clean(ex.partner) && U.normPartner(ex.partner) !== U.normPartner(m.partner || '')) return false;
      if (U.clean(ex.account) && U.clean(ex.account) !== U.clean(m.account || '')) return false;
      if (U.clean(ex.keyword) && !U.nfkc((m.text || '') + ' ' + (f.title || '')).includes(U.nfkc(ex.keyword))) return false;
      if (ex.amountMin != null && ex.amountMin !== '' && (m.amount || 0) < Number(ex.amountMin)) return false;
      if (ex.amountMax != null && ex.amountMax !== '' && (m.amount || 0) > Number(ex.amountMax)) return false;
      return true;
    }) || null;
  }

  // 対象月の一覧。current＝対象月の確認事項、carried＝前月以前から未解決のまま繰り越したもの
  function list(review, company, month) {
    const current = [], carried = [];
    for (const [key, st] of Object.entries(review.states)) {
      if (!st.finding) continue;
      const ex = st.status === 'open' ? matchException(company, st.finding) : null;
      const item = { key, f: st.finding, status: ex ? 'ok' : st.status, auto: ex, memo: st.memo, reviewer: st.reviewer, history: st.history, gone: !!st.gone, month: st.month };
      if (st.month === month) current.push(item);
      else if (st.month < month && M.UNRESOLVED.includes(item.status)) { item.carried = true; carried.push(item); }
    }
    return { current, carried };
  }
  function summary(items) {
    const s = { total: items.length, open: 0, working: 0, waiting: 0, fixed: 0, ok: 0, unresolved: 0, highUnresolved: 0, auto: 0, gone: 0 };
    for (const it of items) {
      s[it.status]++;
      if (M.UNRESOLVED.includes(it.status)) { s.unresolved++; if (it.f.severity === 'high') s.highUnresolved++; }
      if (it.auto) s.auto++; if (it.gone) s.gone++;
    }
    return s;
  }

  function setState(review, key, patch, by, now) {
    const st = review.states[key]; if (!st) return null;
    const from = st.status, to = patch.status || from, memo = patch.memo != null ? patch.memo : st.memo;
    if (to === from && memo === st.memo) return st;
    st.history.push({ at: now, by: by || '', from, to, memo: memo !== st.memo ? memo : '' });
    st.status = to; st.memo = memo; st.reviewer = by || st.reviewer;
    return st;
  }

  // ---- 上席への引継ぎ ----
  const rowText = r => [r.dAcc ? '（借）' + r.dAcc + ' ' + U.yen(r.dAmt) + (r.dTax ? '［' + r.dTax + '］' : '') : '', r.cAcc ? '（貸）' + r.cAcc + ' ' + U.yen(r.cAmt) + (r.cTax ? '［' + r.cTax + '］' : '') : ''].filter(Boolean).join(' ／ ');
  function handoffItems(items) {
    const order = { high: 0, mid: 1, low: 2 };
    return items.filter(it => M.UNRESOLVED.includes(it.status)).sort((a, b) => order[a.f.severity] - order[b.f.severity] || (a.month < b.month ? -1 : a.month > b.month ? 1 : 0) || b.f.amount - a.f.amount);
  }
  function handoffMarkdown(company, month, items, meta) {
    const hs = handoffItems(items), L = [];
    L.push('# 記帳レビュー 引継ぎ：' + company.name + '　' + month);
    L.push('');
    L.push('- 作成：' + (meta.by || '（担当者名 未入力）') + '　' + meta.at.slice(0, 16).replace('T', ' '));
    L.push('- 未解決：' + hs.length + '件（重要度 高 ' + hs.filter(i => i.f.severity === 'high').length + '件、前月以前からの繰越 ' + hs.filter(i => i.carried).length + '件）');
    L.push('- 対象月の確認事項：全 ' + items.filter(i => !i.carried).length + '件、うち解決済み（修正済み・問題なし）' + items.filter(i => !i.carried && !M.UNRESOLVED.includes(i.status)).length + '件');
    L.push('- 消費税：' + M.TAX_STATUS[(company.tax && company.tax.status) || 'unknown'] + (company.notes ? '　／　会社メモ：' + company.notes.replace(/\s+/g, ' ') : ''));
    L.push('- この資料の指摘は、取り込んだ仕訳帳CSV・明細CSVから機械的に抽出した候補です。「推測」と書いた部分はデータから確定していません。');
    if (meta.notes && meta.notes.length) { L.push(''); L.push('## 判定していない項目'); meta.notes.forEach(n => L.push('- ' + n)); }
    L.push(''); L.push('## 未解決の確認事項');
    if (!hs.length) L.push('未解決の確認事項はありません。');
    hs.forEach((it, i) => {
      const f = it.f;
      L.push(''); L.push('### ' + (i + 1) + '. ［' + M.SEVERITY[f.severity] + '］' + f.title);
      L.push('- 状況：' + M.STATUS[it.status] + (it.carried ? '（' + it.month + ' から繰越）' : '') + (it.gone ? '（再実行では検出されず）' : '') + '　／　根拠の種類：' + M.BASIS[f.basis] + '　／　チェック：' + M.CHECKS[f.check]);
      L.push('- 指摘理由（データから確認できる事実）：' + f.reason);
      (f.entries || []).forEach(e => e.rows.forEach(r => L.push('  - ' + e.date + (e.slip ? ' 伝票' + e.slip : '') + ' ' + rowText(r) + (r.partner ? ' ' + r.partner : '') + (r.desc ? ' 「' + r.desc + '」' : '') + (r.file ? '（' + r.file + ' ' + r.row + '行目）' : ''))));
      (f.statementRows || []).forEach(s => L.push('  - ' + (f.statementLabel || '明細') + ' ' + s.date + ' ' + (f.statementLabel ? '' : (s.amount > 0 ? '入金 ' : '出金 ')) + U.yen(Math.abs(s.amount)) + ' ' + (s.desc || '') + '（' + (f.statementFile || '') + ' ' + s.row + '行目）'));
      if (f.calc && f.calc.length) L.push('- 計算・比較：' + f.calc.join(' ／ '));
      if (f.inference && f.inference.length) L.push('- 推測（未確定）：' + f.inference.join(' '));
      if (f.impact) L.push('- 消費税への影響：' + f.impact);
      L.push('- 確認する資料：' + (f.documents || []).join('、'));
      L.push('- 次の対応：' + f.nextAction);
      L.push('- 修正案：' + (f.fix ? f.fix.text : (f.fixNote || 'なし')));
      if (it.memo) L.push('- 担当者メモ：' + it.memo.replace(/\n/g, ' '));
      if (it.history.length) L.push('- 履歴：' + it.history.map(h => h.at.slice(0, 10) + ' ' + (h.by || '') + ' ' + M.STATUS[h.from] + '→' + M.STATUS[h.to]).join('、'));
      if (f.sources && f.sources.length) L.push('- 出典：' + f.sources.map(s => s.title + ' ' + s.url + '（' + s.checked + ' 確認）').join('、'));
    });
    return L.join('\n') + '\n';
  }
  function handoffRows(items) {
    const rows = [['重要度', '状況', '対象月', 'チェック', '根拠の種類', '件名', '日付', '金額', '取引先', '勘定科目', '指摘理由', '推測（未確定）', '確認する資料', '次の対応', '修正案', '担当者メモ', '確認者', '最終更新']];
    for (const it of handoffItems(items)) {
      const f = it.f, last = it.history[it.history.length - 1];
      rows.push([M.SEVERITY[f.severity], M.STATUS[it.status], it.month, M.CHECKS[f.check], M.BASIS[f.basis], f.title, f.date, f.amount, f.partner, f.account, f.reason, (f.inference || []).join(' '), (f.documents || []).join('、'), f.nextAction, f.fix ? f.fix.text : (f.fixNote || ''), it.memo, it.reviewer, last ? last.at.slice(0, 16).replace('T', ' ') : '']);
    }
    return rows;
  }

  KR.review = { emptyReview, applyRun, validateException, matchException, list, summary, setState, handoffItems, handoffMarkdown, handoffRows, rowText };
  if (typeof module !== 'undefined' && module.exports) module.exports = KR;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// 記帳レビュー：画面。取り込んだ文字列はすべて esc() を通して表示する（資料の中の文章を命令として扱わない）
(function () {
  'use strict';
  const KR = window.KR, U = KR.util, M = KR.model, R = KR.review, S = KR.store, RC = KR.reconcile;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => new Date().toISOString();
  const TABS = [['review', 'レビュー一覧'], ['import', 'データ取込'], ['recon', '明細との照合'], ['rules', '会社ルール'], ['handoff', '引継ぎ'], ['data', 'データと安全性']];
  const st = { companies: [], company: null, data: null, review: null, month: '', tab: 'review', sel: null, user: '', pending: null, reconPending: null,
    filter: { status: 'unresolved', severity: '', basis: '', check: '', q: '', sort: 'severity', carried: true },
    recon: { account: '', truth: 'statement', window: 3, show: 'issues' } };

  // ---------- 保存 ----------
  const saveCompany = () => { st.company.updatedAt = now(); return S.saveCompany(st.company); };
  const saveData = () => S.saveData(st.company.id, st.data);
  const saveReview = () => S.saveReview(st.company.id, st.review);
  const filesMap = () => Object.fromEntries(st.data.imports.map(i => [i.id, i.name]));
  const dataMonths = () => [...new Set(st.data.lines.map(l => l.date.slice(0, 7)))].sort();
  function monthOptions() {
    const ms = new Set(dataMonths()); Object.values(st.review.states).forEach(s => ms.add(s.month));
    if (st.month) ms.add(st.month);
    return [...ms].sort().reverse();
  }
  function toast(text, bad) { const t = $('#toast'); t.textContent = text; t.className = 'toast show' + (bad ? ' bad' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => t.className = 'toast', 3500); }

  async function selectCompany(id) {
    st.company = id ? await S.getCompany(id) : null;
    if (!st.company) { st.data = null; st.review = null; return; }
    st.data = await S.getData(id); st.review = await S.getReview(id);
    const ms = dataMonths(); const saved = await S.getSetting('month:' + id);
    st.month = saved && (ms.includes(saved) || !ms.length) ? saved : (ms[ms.length - 1] || '');
    st.sel = null; st.pending = null; st.reconPending = null; st.recon.account = '';
    await S.setSetting('lastCompany', id);
  }
  async function reloadCompanies() { st.companies = await S.listCompanies(); }

  // ---------- 取込 ----------
  async function readFile(file) { const d = KR.csv.decode(new Uint8Array(await file.arrayBuffer())); return d; }
  async function previewJournal(file) {
    const d = await readFile(file), res = KR.csv.readJournal(d.text, file.name);
    res.encoding = d.encoding; res.badChars = d.badChars || 0;
    if (!res.fatal) {
      res.same = st.data.imports.find(i => i.hash === res.hash) || null;
      const months = new Set(res.stats.months);
      res.replace = st.data.lines.filter(l => months.has(l.date.slice(0, 7))).length;
    }
    st.pending = res; render();
  }
  // 同じ月の行は、新しいファイルの内容で置き換える（同じ資料を2回取り込んでも二重にならない）
  function commitJournal(res) {
    const d = st.data, id = 'i' + (++d.seq), months = new Set(res.stats.months);
    d.lines = d.lines.filter(l => !months.has(l.date.slice(0, 7))).concat(res.lines.map(l => Object.assign({ id: id + ':' + l.row, src: id }, l)));
    const alive = new Set(d.lines.map(l => l.src));
    d.imports = d.imports.filter(i => alive.has(i.id));
    d.imports.push({ id, name: res.fileName, hash: res.hash, at: now(), encoding: res.encoding, rows: res.lines.length, from: res.stats.from, to: res.stats.to, months: res.stats.months, rejected: res.rejected.slice(0, 500), rejectedCount: res.rejected.length, warnings: res.warnings.slice(0, 200), unmapped: res.unmapped });
    d.changedAt = now();
  }
  async function runReview() {
    if (!st.month) return toast('対象月を選んでください', true);
    const run = KR.checks.runReview(st.company, st.data.lines, st.month, filesMap());
    R.applyRun(st.review, st.month, run.findings, f => f.check !== 'RECON', now());
    st.data.runs[st.month] = { at: now(), notes: run.notes, suppressed: run.suppressed, stats: run.stats, by: st.user };
    await saveReview(); await saveData();
    if (st.sel && !st.review.states[st.sel]) st.sel = null;
    toast('レビューを実行しました：' + run.findings.length + '件の確認事項');
  }
  async function loadSample() {
    const s = KR.sample.build();
    if (await S.getCompany('sample') && !confirm('サンプルの会社がすでにあります。サンプルのデータと確認結果を最初の状態に戻しますか？')) return;
    await S.deleteCompany('sample'); await S.saveCompany(s.company); await reloadCompanies(); await selectCompany('sample');
    for (const j of s.journals) { const res = KR.csv.readJournal(j.text, j.name); res.encoding = 'UTF-8'; commitJournal(res); }
    st.month = s.month; await S.setSetting('month:sample', st.month); await saveData(); await runReview(); st.tab = 'review'; render();
  }

  // ---------- 照合 ----------
  const fundAccounts = () => [...new Set(st.data.lines.flatMap(l => [l.dAcc, l.cAcc]).filter(a => a && M.accountKind(st.company, a) === 'fund'))].sort();
  const reconKey = () => st.recon.account + '|' + st.month;
  function reconCompute(saved) {
    const from = st.month + '-01', to = U.monthEnd(st.month);
    const sl = saved.lines.filter(l => l.date >= from && l.date <= to);
    const book = RC.bookLines(st.company, st.data.lines, saved.account, from, to, filesMap());
    return { rec: RC.reconcile(sl, book, { window: Number(saved.window) || 3, truth: saved.truth }), outside: saved.lines.length - sl.length };
  }
  async function commitStatement(res) {
    const saved = { account: st.recon.account, name: res.fileName, hash: res.hash, at: now(), lines: res.lines, rejected: res.rejected.slice(0, 500), rejectedCount: res.rejected.length, warnings: res.warnings, truth: st.recon.truth, window: st.recon.window, month: st.month };
    st.data.statements[reconKey()] = saved;
    await applyRecon(saved); st.reconPending = null;
  }
  async function applyRecon(saved) {
    const { rec } = reconCompute(saved);
    const fs = RC.toFindings(rec, { company: st.company, account: saved.account, month: st.month, fileName: saved.name });
    R.applyRun(st.review, st.month, fs, f => f.check === 'RECON' && f.account === saved.account, now());
    await saveData(); await saveReview();
    toast('照合しました：一致 ' + rec.counts.match + '、差額あり ' + rec.counts.diff + '、片側のみ ' + rec.counts.single + '、要確認 ' + rec.counts.unsure);
  }

  // ---------- 部品 ----------
  const sevBadge = s => '<span class="badge sev-' + s + '">' + M.SEVERITY[s] + '</span>';
  const stBadge = (s, auto) => '<span class="badge st-' + s + '">' + M.STATUS[s] + (auto ? '（確認済みルール）' : '') + '</span>';
  const opt = (v, label, cur) => '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(label) + '</option>';
  function entryTable(entries, label) {
    if (!entries || !entries.length) return '';
    let h = '<div class="tblwrap"><table class="entries"><thead><tr><th>日付</th><th>伝票</th><th>借方科目</th><th class="num">借方金額</th><th>借方税区分</th><th>貸方科目</th><th class="num">貸方金額</th><th>貸方税区分</th><th>取引先</th><th>摘要</th><th>元データ</th></tr></thead><tbody>';
    entries.forEach((e, i) => e.rows.forEach((r, j) => {
      h += '<tr class="' + (j === 0 && i > 0 ? 'sep' : '') + '"><td>' + (j === 0 ? esc(e.date) : '') + '</td><td>' + (j === 0 ? esc(e.slip) : '') + '</td><td>' + esc(r.dAcc) + '</td><td class="num">' + (r.dAmt == null ? '' : r.dAmt.toLocaleString('ja-JP')) + '</td><td>' + esc(r.dTax) + '</td><td>' + esc(r.cAcc) + '</td><td class="num">' + (r.cAmt == null ? '' : r.cAmt.toLocaleString('ja-JP')) + '</td><td>' + esc(r.cTax) + '</td><td>' + esc(r.partner) + '</td><td>' + esc(r.desc) + '</td><td class="src">' + esc(r.file) + ' ' + r.row + '行目</td></tr>';
    }));
    return (label ? '<h4>' + esc(label) + '</h4>' : '') + h + '</tbody></table></div>';
  }
  function statementTable(rows, file) {
    if (!rows || !rows.length) return '';
    return '<h4>明細側（' + esc(file) + '）</h4><div class="tblwrap"><table class="entries"><thead><tr><th>日付</th><th>摘要</th><th class="num">出金</th><th class="num">入金</th><th class="num">残高</th><th>元データ</th></tr></thead><tbody>' +
      rows.map(s => '<tr><td>' + esc(s.date) + '</td><td>' + esc(s.desc) + '</td><td class="num">' + (s.amount < 0 ? (-s.amount).toLocaleString('ja-JP') : '') + '</td><td class="num">' + (s.amount > 0 ? s.amount.toLocaleString('ja-JP') : '') + '</td><td class="num">' + (s.balance == null ? '' : s.balance.toLocaleString('ja-JP')) + '</td><td class="src">' + s.row + '行目</td></tr>').join('') + '</tbody></table></div>';
  }
  const ul = a => '<ul>' + a.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
  function rejectedBlock(res) {
    let h = '';
    if (res.rejected.length) h += '<div class="warnbox"><b>読めなかった行：' + (res.rejectedCount || res.rejected.length) + '行（取り込まれません）</b><div class="tblwrap small"><table><thead><tr><th>行</th><th>理由</th><th>内容</th></tr></thead><tbody>' + res.rejected.slice(0, 100).map(r => '<tr><td>' + r.row + '</td><td>' + esc(r.reasons.join('／')) + '</td><td class="src">' + esc(r.raw) + '</td></tr>').join('') + '</tbody></table></div>' + (res.rejected.length > 100 ? '<p class="muted">先頭100行を表示しています。</p>' : '') + '</div>';
    if (res.warnings && res.warnings.length) h += '<div class="notebox"><b>注意：' + res.warnings.length + '件（取り込みます）</b>' + ul(res.warnings.slice(0, 30).map(w => w.row + '行目：' + w.text)) + '</div>';
    return h;
  }

  // ---------- 画面：レビュー一覧 ----------
  function reviewItems() {
    const { current, carried } = R.list(st.review, st.company, st.month);
    return { current, carried, all: current.concat(st.filter.carried ? carried : []) };
  }
  function filtered(items) {
    const f = st.filter, q = U.nfkc(f.q).toLowerCase();
    const out = items.filter(it => (f.status === 'all' || (f.status === 'unresolved' ? M.UNRESOLVED.includes(it.status) : f.status === 'resolved' ? !M.UNRESOLVED.includes(it.status) : it.status === f.status))
      && (!f.severity || it.f.severity === f.severity) && (!f.basis || it.f.basis === f.basis) && (!f.check || it.f.check === f.check)
      && (!q || U.nfkc([it.f.title, it.f.partner, it.f.account, it.memo, it.f.reason].join(' ')).toLowerCase().includes(q)));
    const so = { high: 0, mid: 1, low: 2 }, sto = { open: 0, working: 1, waiting: 2, fixed: 3, ok: 4 };
    const cmp = { severity: (a, b) => so[a.f.severity] - so[b.f.severity] || b.f.amount - a.f.amount, amount: (a, b) => b.f.amount - a.f.amount, date: (a, b) => (a.f.date < b.f.date ? -1 : a.f.date > b.f.date ? 1 : 0), status: (a, b) => sto[a.status] - sto[b.status] || so[a.f.severity] - so[b.f.severity] }[f.sort];
    return out.sort(cmp);
  }
  function stale() {
    const run = st.data.runs[st.month]; if (!run) return st.data.lines.length ? 'この月のレビューはまだ実行していません。' : '';
    if (st.data.changedAt > run.at) return '前回の実行のあとに仕訳データが変わっています。';
    if ((st.company.updatedAt || '') > run.at) return '前回の実行のあとに会社ルールが変わっています。';
    return '';
  }
  function viewReview() {
    if (!st.data.lines.length) return '<div class="empty"><h2>まず仕訳帳CSVを取り込んでください</h2><p>「データ取込」で freee の仕訳帳CSVを選びます。対象月より前の月（3か月以上）も取り込むと、過去の処理との比較ができます。</p><button class="primary" data-act="tab" data-tab="import">データ取込へ</button></div>';
    const { current, carried, all } = reviewItems(), sum = R.summary(current), run = st.data.runs[st.month], sm = stale(), list = filtered(all);
    let h = '<div class="summary"><div class="card big"><div class="n">' + sum.open + '</div><div>未確認</div></div><div class="card' + (sum.highUnresolved ? ' alert' : '') + '"><div class="n">' + sum.highUnresolved + '</div><div>重要度 高（未解決）</div></div><div class="card"><div class="n">' + sum.working + '</div><div>確認中</div></div><div class="card"><div class="n">' + sum.waiting + '</div><div>先方確認待ち</div></div><div class="card"><div class="n">' + (sum.fixed + sum.ok) + '<small> / ' + sum.total + '</small></div><div>解決済み</div></div><div class="card"><div class="n">' + carried.length + '</div><div>前月以前からの繰越</div></div>'
      + '<div class="runbox"><button class="primary" data-act="run">レビューを実行</button><div class="muted">' + (run ? '前回：' + esc(run.at.slice(0, 16).replace('T', ' ')) + '　対象月の仕訳 ' + run.stats.entries + '件　比較に使った過去の月：' + (run.stats.priorMonths.length ? esc(run.stats.priorMonths[0] + '〜' + run.stats.priorMonths[run.stats.priorMonths.length - 1]) : 'なし') : '未実行') + '</div></div></div>';
    if (sm) h += '<div class="warnbox">' + esc(sm) + '「レビューを実行」を押すと最新の内容で判定します（対応状況・メモは引き継がれます）。</div>';
    if (run) h += '<details class="notes"><summary>判定していない項目・前提（' + run.notes.length + '件）／指摘から外した候補（' + run.suppressed.length + '件）</summary><h4>判定していない項目・前提</h4>' + ul(run.notes) + '<h4>指摘から外した候補（その会社の通常の処理とみなしたもの等）</h4>' + (run.suppressed.length ? ul(run.suppressed.map(s => '［' + M.CHECKS[s.check] + '］' + s.text)) : '<p class="muted">ありません。</p>') + '</details>';
    const f = st.filter;
    h += '<div class="filters"><select data-f="status">' + [['unresolved', '未解決のみ'], ['all', 'すべての状況'], ['resolved', '解決済みのみ']].concat(Object.entries(M.STATUS)).map(([v, l]) => opt(v, l, f.status)).join('') + '</select>'
      + '<select data-f="severity">' + opt('', '重要度：すべて', f.severity) + Object.entries(M.SEVERITY).map(([v, l]) => opt(v, '重要度：' + l, f.severity)).join('') + '</select>'
      + '<select data-f="basis">' + opt('', '根拠の種類：すべて', f.basis) + Object.entries(M.BASIS).map(([v, l]) => opt(v, l, f.basis)).join('') + '</select>'
      + '<select data-f="check">' + opt('', 'チェック：すべて', f.check) + Object.entries(M.CHECKS).map(([v, l]) => opt(v, l, f.check)).join('') + '</select>'
      + '<input type="search" data-f="q" placeholder="取引先・科目・メモで絞込" value="' + esc(f.q) + '">'
      + '<select data-f="sort">' + [['severity', '重要度順'], ['amount', '金額の大きい順'], ['date', '日付順'], ['status', '状況順']].map(([v, l]) => opt(v, l, f.sort)).join('') + '</select>'
      + '<label class="chk"><input type="checkbox" data-f="carried"' + (f.carried ? ' checked' : '') + '>繰越を含む</label><span class="muted">' + list.length + '件を表示</span></div>';
    h += '<div class="split"><div class="list" id="list">' + (list.length ? list.map(it => '<button class="row' + (it.key === st.sel ? ' on' : '') + '" data-act="sel" data-key="' + esc(it.key) + '">' + sevBadge(it.f.severity) + '<span class="ttl">' + esc(it.f.title) + '</span><span class="meta"><span class="basis b-' + it.f.basis + '">' + M.BASIS[it.f.basis] + '</span>' + esc(it.f.date) + '　' + esc(U.yen(it.f.amount)) + (it.carried ? '　<span class="tag">' + esc(it.month) + ' から繰越</span>' : '') + (it.gone ? '　<span class="tag">再実行で検出されず</span>' : '') + '</span>' + stBadge(it.status, it.auto) + '</button>').join('') : '<p class="muted pad">' + (all.length ? '条件に合う確認事項はありません。' : (run ? 'この月の確認事項はありません。' : '「レビューを実行」を押してください。')) + '</p>') + '</div>';
    const it = all.find(x => x.key === st.sel);
    h += '<div class="detail" id="detail">' + (it ? viewDetail(it) : '<p class="muted pad">左の一覧から確認事項を選ぶと、対象の取引・比較対象・計算の過程・次の対応が表示されます。</p>') + '</div></div>';
    return h;
  }
  function viewDetail(it) {
    const f = it.f, fy = fiscalEnd();
    let h = '<div class="dhead">' + sevBadge(f.severity) + stBadge(it.status, it.auto) + '<span class="basis b-' + f.basis + '">' + M.BASIS[f.basis] + '</span><span class="tag">' + M.CHECKS[f.check] + (f.reconCategory ? '：' + esc(f.reconCategory) : '') + '</span>' + (it.carried ? '<span class="tag">' + esc(it.month) + ' から繰越</span>' : '') + '</div><h3>' + esc(f.title) + '</h3>';
    if (it.gone) h += '<div class="notebox">最新のデータでの再実行では、この指摘は検出されませんでした（帳簿が修正された、またはデータ・ルールが変わった可能性があります）。記録は残しています。</div>';
    if (it.auto) h += '<div class="notebox">確認済みルール「' + esc(it.auto.reason) + '」（' + esc(it.auto.from) + '〜' + esc(it.auto.to) + '、登録：' + esc(it.auto.by || '') + '）に当たるため「問題なし」と表示しています。ルールは「会社ルール」で変更・削除できます。</div>';
    h += '<section><h4>指摘理由 <span class="fact">データから確認できる事実</span></h4><p>' + esc(f.reason) + '</p></section>';
    h += '<section>' + entryTable(f.entries, f.entriesLabel || '対象の取引') + statementTable(f.statementRows, f.statementFile) + (f.comparison && f.comparison.entries.length ? entryTable(f.comparison.entries, '比較対象：' + f.comparison.label) : (f.comparison ? '<h4>比較対象：' + esc(f.comparison.label) + '</h4><p class="muted">該当する過去の仕訳はありません。</p>' : '')) + '</section>';
    if (f.calc.length) h += '<section><h4>判定に使った条件・計算</h4>' + ul(f.calc) + '</section>';
    if (f.inference.length) h += '<section class="infer"><h4>推測 <span class="guess">データからは確定できません</span></h4>' + ul(f.inference) + '</section>';
    if (f.impact) h += '<section><h4>消費税への影響</h4><p>' + esc(f.impact) + '</p></section>';
    h += '<section><h4>確認すべき資料</h4>' + ul(f.documents || []) + '<h4>推奨する次の対応</h4><p>' + esc(f.nextAction) + '</p><h4>修正案</h4><p>' + (f.fix ? (f.fix.conditional ? '<span class="guess">条件つき</span> ' : '') + esc(f.fix.text) : '<span class="muted">' + esc(f.fixNote || '修正案はありません。') + '</span>') + '</p></section>';
    if (f.sources.length) h += '<section><h4>出典（公的資料）</h4><ul>' + f.sources.map(s => '<li>' + esc(s.title) + '<br><span class="src">' + esc(s.url) + '（' + esc(s.checked) + ' 確認）</span></li>').join('') + '</ul></section>';
    const search = '取引日 ' + f.date + '／金額 ' + f.amount + (f.partner ? '／取引先 ' + f.partner : '') + '／勘定科目 ' + f.account;
    h += '<section><h4>freee で探すときの条件</h4><p class="copyline"><code id="searchText">' + esc(search) + '</code> <button data-act="copy" data-from="searchText">コピー</button></p><p class="muted">freee の該当画面へのリンクは設けていません（仕訳帳CSVに取引IDがなく、公式に確認できたURL形式もないため）。</p>'
      + '<h4>先方への質問文案 <span class="guess">定型文から作成。送る前に必ず確認</span></h4><p class="copyline"><span id="qText">' + esc(f.question) + '</span> <button data-act="copy" data-from="qText">コピー</button></p></section>';
    h += '<section class="act"><h4>対応の記録</h4><div class="stbtns">' + Object.entries(M.STATUS).map(([v, l]) => '<button data-act="status" data-status="' + v + '" class="' + (it.status === v && !it.auto ? 'on st-' + v : '') + '">' + l + '</button>').join('') + '</div><textarea id="memo" rows="3" placeholder="担当者メモ（確認した資料、判断の理由、先方への依頼内容など）">' + esc(it.memo) + '</textarea><div class="rowbtns"><button data-act="memo">メモを保存</button><span class="muted">確認者：' + esc(it.reviewer || '—') + '</span></div>';
    h += '<details class="exform"' + (it.status === 'ok' && !it.auto ? ' open' : '') + '><summary>同じ条件の指摘を、今後も「問題なし」として扱う（確認済みルール）</summary><p class="muted">この会社・このチェックの種類に限り、下の条件と期間に当たる指摘を「問題なし（確認済みルール）」と表示します。一覧からは消えません。</p><div class="grid">'
      + '<label>取引先<input id="exPartner" value="' + esc((f.match && f.match.partner) || '') + '"></label><label>勘定科目<input id="exAccount" value="' + esc((f.match && f.match.account) || '') + '"></label><label>摘要・件名に含む語句<input id="exKeyword"></label><label>金額（下限）<input id="exMin" type="number"></label><label>金額（上限）<input id="exMax" type="number"></label><label>開始月<input id="exFrom" type="month" value="' + esc(f.month) + '"></label><label>終了月<input id="exTo" type="month" value="' + esc(fy) + '"></label></div><label>理由（必須）<input id="exReason" class="wide" value="' + esc(it.memo.split('\n')[0] || '') + '"></label><div class="rowbtns"><button data-act="addException">確認済みルールを登録</button></div></details>';
    h += '<h4>更新履歴</h4>' + (it.history.length ? '<ul class="hist">' + it.history.slice().reverse().map(x => '<li>' + esc(x.at.slice(0, 16).replace('T', ' ')) + '　' + esc(x.by || '（担当者名なし）') + '　' + M.STATUS[x.from] + ' → ' + M.STATUS[x.to] + (x.memo ? '　メモ：' + esc(x.memo) : '') + '</li>').join('') + '</ul>' : '<p class="muted">まだ更新はありません。</p>') + '</section>';
    return h;
  }
  // 確認済みルールの終了月の初期値：対象月を含む事業年度の末月
  function fiscalEnd() { const fm = Number(st.company.fiscalEndMonth) || 12, y = +st.month.slice(0, 4), m = +st.month.slice(5, 7); return (m <= fm ? y : y + 1) + '-' + U.pad(fm); }

  // ---------- 画面：データ取込 ----------
  function viewImport() {
    const d = st.data, p = st.pending;
    let h = '<h2>仕訳帳CSVの取込</h2><p>freee の［会計帳簿］→［仕訳帳］から出力したCSV（Shift_JIS・UTF-8 のどちらでも可）を選びます。対象月だけでなく、前の月（3か月以上）も取り込むと過去の処理と比較できます。同じ月のデータを取り込み直すと、その月の行を新しい内容で置き換えます。</p>'
      + '<div class="drop" id="drop"><input type="file" id="jfile" accept=".csv,.txt,text/csv"><p class="muted">ここにCSVをドロップしても選べます。ファイルはこのブラウザの中だけで読み取り、外部には送信しません。</p></div>';
    if (p) {
      h += '<div class="preview"><h3>取込前の確認：' + esc(p.fileName) + '</h3>';
      if (p.fatal) h += '<div class="warnbox"><b>取り込めません。</b>' + esc(p.fatal) + '</div><div class="rowbtns"><button data-act="cancelImport">閉じる</button></div>';
      else {
        h += '<table class="kv"><tr><th>文字コード</th><td>' + esc(p.encoding) + (p.badChars ? '（読めない文字が ' + p.badChars + ' 個あります）' : '') + '</td></tr><tr><th>読めた行</th><td>' + p.stats.rows + '行（' + esc(p.stats.from) + ' 〜 ' + esc(p.stats.to) + '）　空行 ' + p.stats.blank + '</td></tr><tr><th>読めなかった行</th><td>' + p.rejected.length + '行</td></tr><tr><th>借方合計／貸方合計</th><td>' + esc(U.yen(p.stats.debitTotal)) + '／' + esc(U.yen(p.stats.creditTotal)) + (p.stats.debitTotal === p.stats.creditTotal ? '（一致）' : '（<b>不一致</b>）') + '</td></tr><tr><th>読み取った列</th><td>' + p.columns.map(c => esc(c.header) + (c.header !== c.label ? '→' + esc(c.label) : '')).join('、') + '</td></tr><tr><th>使わなかった列</th><td>' + (p.unmapped.length ? esc(p.unmapped.join('、')) : 'なし') + '</td></tr></table>';
        if (!p.stats.hasTax) h += '<div class="notebox">税区分の列がありません。税区分のチェックは行えません。</div>';
        if (!p.stats.hasPartner) h += '<div class="notebox">取引先の列がありません。取引先ごとの比較は、摘要を手がかりにした範囲に限られます。</div>';
        if (p.same) h += '<div class="warnbox">同じ内容のファイルを取込済みです（' + esc(p.same.name) + '、' + esc(p.same.at.slice(0, 10)) + '）。取り込んでも内容は変わりません。</div>';
        if (p.replace) h += '<div class="notebox">取込済みの ' + esc(p.stats.months.join('・')) + ' の ' + p.replace + '行を、このファイルの内容で置き換えます（二重にはなりません）。</div>';
        h += rejectedBlock(p) + '<div class="rowbtns"><button class="primary" data-act="commitImport"' + (p.stats.rows ? '' : ' disabled') + '>' + p.stats.rows + '行を取り込む</button><button data-act="cancelImport">やめる</button></div>';
      }
      h += '</div>';
    }
    h += '<h3>取込済みのデータ</h3>' + (d.imports.length ? '<div class="tblwrap"><table><thead><tr><th>ファイル</th><th>期間</th><th class="num">行数</th><th class="num">読めなかった行</th><th>文字コード</th><th>取込日時</th><th></th></tr></thead><tbody>' + d.imports.map(i => '<tr><td>' + esc(i.name) + '</td><td>' + esc(i.from) + ' 〜 ' + esc(i.to) + '</td><td class="num">' + d.lines.filter(l => l.src === i.id).length + '</td><td class="num">' + (i.rejectedCount ? '<button class="link" data-act="showRejected" data-id="' + i.id + '">' + i.rejectedCount + '行を見る</button>' : '0') + '</td><td>' + esc(i.encoding) + '</td><td>' + esc(i.at.slice(0, 16).replace('T', ' ')) + '</td><td><button data-act="delImport" data-id="' + i.id + '">削除</button></td></tr>').join('') + '</tbody></table></div><p class="muted">取込済みの月：' + esc(dataMonths().join('、')) + '</p>' : '<p class="muted">まだありません。</p>');
    if (st.shown) { const i = d.imports.find(x => x.id === st.shown); if (i) h += '<h3>' + esc(i.name) + ' の読めなかった行・注意</h3>' + rejectedBlock(i); }
    return h;
  }

  // ---------- 画面：明細との照合 ----------
  function viewRecon() {
    const accs = fundAccounts(); if (!st.recon.account || !accs.includes(st.recon.account)) st.recon.account = accs[0] || '';
    if (!accs.length) return '<div class="empty"><h2>照合できる口座がありません</h2><p>仕訳帳CSVを取り込むと、現金・預金・カードなどの口座科目を選べます。口座として扱う科目は「会社ルール」で変更できます。</p></div>';
    const saved = st.data.statements[reconKey()], p = st.reconPending;
    let h = '<h2>明細との照合（' + esc(st.month) + '）</h2><p>銀行・カードの明細CSV、または現金出納帳のCSV（日付・摘要・出金・入金の列）を、帳簿の口座科目と突き合わせます。結果は「一致」「差額あり」「片側のみ」「同一取引か要確認」に分け、一致以外をレビュー一覧に追加します。</p>'
      + '<div class="filters"><label>帳簿の口座科目 <select data-r="account">' + accs.map(a => opt(a, a, st.recon.account)).join('') + '</select></label><label>正とする資料 <select data-r="truth">' + opt('statement', '明細（通帳・カード明細）', st.recon.truth) + opt('book', '帳簿', st.recon.truth) + '</select></label><label>日付のずれの許容 <select data-r="window">' + [0, 1, 2, 3, 5, 7].map(n => opt(n, n + '日', st.recon.window)).join('') + '</select></label></div>'
      + '<div class="drop"><input type="file" id="sfile" accept=".csv,.txt,text/csv">' + (st.company.id === 'sample' ? ' <button data-act="sampleStatement">サンプルの普通預金明細で試す</button>' : '') + '<p class="muted">カード明細の「利用金額」は出金として読みます。帳簿側のカード代金の引落しは、カード明細にないため「片側のみ」に出ます。</p></div>';
    if (p) {
      h += '<div class="preview"><h3>取込前の確認：' + esc(p.fileName) + '</h3>';
      if (p.fatal) h += '<div class="warnbox"><b>取り込めません。</b>' + esc(p.fatal) + '</div><div class="rowbtns"><button data-act="cancelStatement">閉じる</button></div>';
      else {
        const inM = p.lines.filter(l => l.date.slice(0, 7) === st.month).length, dup = Object.values(st.data.statements).find(s => s.hash === p.hash && (s.account !== st.recon.account || s.month !== st.month));
        h += '<table class="kv"><tr><th>文字コード</th><td>' + esc(p.encoding) + '</td></tr><tr><th>読めた行</th><td>' + p.stats.rows + '行（' + esc(p.stats.from) + ' 〜 ' + esc(p.stats.to) + '）　うち対象月 ' + inM + '行</td></tr><tr><th>入金合計／出金合計</th><td>' + esc(U.yen(p.stats.inTotal)) + '／' + esc(U.yen(p.stats.outTotal)) + '</td></tr><tr><th>読み取った列</th><td>' + esc(p.columns.map(c => c.header).join('、')) + '</td></tr></table>';
        if (dup) h += '<div class="warnbox">同じ内容の明細を、別の口座・月（' + esc(dup.account) + '、' + esc(dup.month) + '）の照合に取込済みです。口座の選び間違いでないか確認してください。</div>';
        if (inM < p.stats.rows) h += '<div class="notebox">対象月（' + esc(st.month) + '）以外の ' + (p.stats.rows - inM) + '行は照合に使いません。</div>';
        h += rejectedBlock(p) + '<div class="rowbtns"><button class="primary" data-act="commitStatement"' + (inM ? '' : ' disabled') + '>「' + esc(st.recon.account) + '」と照合する</button><button data-act="cancelStatement">やめる</button></div>';
      }
      h += '</div>';
    }
    if (saved) {
      const { rec } = reconCompute(saved), c = rec.counts, show = st.recon.show;
      h += '<h3>照合結果：' + esc(saved.account) + ' × ' + esc(saved.name) + '</h3><div class="summary"><div class="card"><div class="n">' + c.match + '</div><div>一致</div></div><div class="card"><div class="n">' + c.diff + '</div><div>差額あり</div></div><div class="card"><div class="n">' + c.single + '</div><div>片側のみ</div></div><div class="card"><div class="n">' + c.unsure + '</div><div>同一取引か要確認</div></div><div class="runbox"><div class="muted">明細 ' + rec.totals.statementCount + '行（増減 ' + esc(U.yen(rec.totals.statement)) + '）　帳簿 ' + rec.totals.bookCount + '行（増減 ' + esc(U.yen(rec.totals.book)) + '）　差 ' + esc(U.yen(rec.totals.diff)) + '<br>正とする資料：' + (saved.truth === 'statement' ? '明細' : '帳簿') + '　日付のずれ：' + saved.window + '日まで　照合日時：' + esc(saved.at.slice(0, 16).replace('T', ' ')) + '</div><button data-act="rerunRecon">この設定で照合し直す</button> <button data-act="delRecon">照合を削除</button></div></div>'
        + '<div class="filters"><select data-r="show">' + opt('issues', '一致以外を表示', show) + opt('all', 'すべて表示', show) + '</select></div><div class="tblwrap"><table class="recon"><thead><tr><th>区分</th><th>明細（日付・摘要・金額）</th><th>帳簿（日付・相手科目・取引先・金額）</th><th>内容</th></tr></thead><tbody>'
        + rec.results.filter(r => show === 'all' || r.category !== 'match').map(r => '<tr class="rc-' + r.category + '"><td><span class="badge rc">' + RC.CATEGORY[r.category] + '</span></td><td>' + (r.statement.map(s => esc(s.date) + ' ' + esc(s.desc) + ' <b>' + (s.amount > 0 ? '+' : '−') + Math.abs(s.amount).toLocaleString('ja-JP') + '</b>').join('<br>') || '<span class="muted">なし</span>') + '</td><td>' + (r.book.map(b => esc(b.date) + ' ' + esc(b.counter) + ' ' + esc(b.partner) + ' <b>' + (b.amount > 0 ? '+' : '−') + Math.abs(b.amount).toLocaleString('ja-JP') + '</b>').join('<br>') || '<span class="muted">なし</span>') + '</td><td>' + esc(r.note) + (r.feeGuess ? '<br><span class="guess">推測</span> 振込手数料の控除の可能性' : '') + '</td></tr>').join('') + '</tbody></table></div><p class="muted">一致以外の ' + (c.diff + c.single + c.unsure) + '件は、レビュー一覧（チェック：明細との照合）で対応状況を記録できます。</p>' + rejectedBlock(saved);
    }
    return h + '<p class="muted">この版で照合できるのは、口座の明細（銀行・カード・現金出納帳）と帳簿です。売上資料・請求書と売上・入金、給与資料と給与・預り金の照合は未対応です。</p>';
  }

  // ---------- 画面：会社ルール ----------
  function viewRules() {
    const c = st.company, t = M.thresholds(c), accs = [...U.countBy(st.data.lines.flatMap(l => [l.dAcc, l.cAcc]).filter(Boolean), a => a)].sort((a, b) => b[1] - a[1]);
    const inp = (path, val, type, extra) => '<input data-c="' + path + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '"' + (extra || '') + '>';
    const kinds = { fund: '口座（現金・預金・カード）', bs: '貸借科目', pl: '損益科目' };
    const delBtn = (list, id) => '<button data-act="delRule" data-list="' + list + '" data-id="' + esc(id) + '">削除</button>';
    let h = '<h2>会社ルール：' + esc(c.name) + '</h2><p class="muted">ここで登録した内容は、この会社のレビューにだけ使います。変更したら「レビューを実行」で再判定してください。</p>';
    h += '<h3>基本情報</h3><div class="grid"><label>会社名' + inp('name', c.name) + '</label><label>区分<select data-c="type">' + opt('corp', '法人', c.type) + opt('individual', '個人事業主', c.type) + '</select></label><label>決算月<select data-c="fiscalEndMonth" data-num="1">' + Array.from({ length: 12 }, (_, i) => opt(i + 1, (i + 1) + '月', c.fiscalEndMonth)).join('') + '</select></label><label class="span2">事業内容' + inp('business', c.business) + '</label></div>';
    h += '<h3>消費税の処理方針</h3><div class="grid"><label>課税の状況<select data-c="tax.status">' + Object.entries(M.TAX_STATUS).map(([v, l]) => opt(v, l, c.tax.status)).join('') + '</select></label><label>経理方式<select data-c="tax.accounting">' + opt('unknown', '未登録', c.tax.accounting) + opt('inclusive', '税込経理', c.tax.accounting) + opt('exclusive', '税抜経理', c.tax.accounting) + '</select></label><label class="span2">補足（課税期間、届出の状況など）' + inp('tax.note', c.tax.note) + '</label></div><p class="muted">課税の状況は、税区分の違いが納付税額に影響するかの表示と、経過措置の控除割合のチェックを行うかどうかに使います。未登録のときは影響を判定しません。</p>';
    h += '<h3>レビューの重要性基準</h3><div class="grid"><label>重要度「高」とする金額（円以上）' + inp('thresholds.high', t.high, 'number', ' data-num="1"') + '</label><label>重要度「中」とする金額（円以上）' + inp('thresholds.mid', t.mid, 'number', ' data-num="1"') + '</label><label>重複候補の対象とする最小金額' + inp('thresholds.min', t.min, 'number', ' data-num="1"') + '</label><label>重複とみる日付の差（日以内）' + inp('thresholds.dateWindow', t.dateWindow, 'number', ' data-num="1"') + '</label></div>';
    h += '<h3>現金の期首残高</h3><div class="grid"><label>基準日（この日の開始時点）' + inp('cashOpening.date', c.cashOpening.date, 'date') + '</label><label>残高（円）' + inp('cashOpening.amount', c.cashOpening.amount, 'number', ' data-num="1"') + '</label></div><p class="muted">基準日から対象月までの仕訳がすべて取り込まれているときだけ、現金残高のマイナスを判定します。未登録のときは「資料不足による確認依頼」として示します。</p>';
    h += '<h3>取引先ごとの通常の勘定科目・税区分</h3><div class="tblwrap"><table><thead><tr><th>取引先</th><th>通常の勘定科目（複数は「、」区切り）</th><th>通常の税区分（任意）</th><th>メモ</th><th></th></tr></thead><tbody>' + c.partnerRules.map(r => '<tr><td>' + esc(r.partner) + '</td><td>' + esc(r.account) + '</td><td>' + esc(r.tax) + '</td><td>' + esc(r.note) + '</td><td>' + delBtn('partnerRules', r.id) + '</td></tr>').join('') + '<tr><td><input id="prPartner"></td><td><input id="prAccount"></td><td><input id="prTax"></td><td><input id="prNote"></td><td><button data-act="addPartnerRule">追加</button></td></tr></tbody></table></div>';
    h += '<h3>毎月発生する取引と金額の許容範囲</h3><div class="tblwrap"><table><thead><tr><th>名前</th><th>勘定科目（必須）</th><th>取引先</th><th>摘要に含む語句</th><th class="num">金額</th><th class="num">許容（±%）</th><th>メモ</th><th></th></tr></thead><tbody>' + c.recurring.map(r => '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.account) + '</td><td>' + esc(r.partner) + '</td><td>' + esc(r.keyword) + '</td><td class="num">' + (r.amount ? Number(r.amount).toLocaleString('ja-JP') : '') + '</td><td class="num">' + esc(r.tolerancePct == null ? '' : r.tolerancePct) + '</td><td>' + esc(r.note) + '</td><td>' + delBtn('recurring', r.id) + '</td></tr>').join('') + '<tr><td><input id="rcName"></td><td><input id="rcAccount"></td><td><input id="rcPartner"></td><td><input id="rcKeyword"></td><td><input id="rcAmount" type="number"></td><td><input id="rcTol" type="number" value="0"></td><td><input id="rcNote"></td><td><button data-act="addRecurring">追加</button></td></tr></tbody></table></div><p class="muted">金額を空欄にすると、計上の有無だけを確認します。</p>';
    h += '<h3>確認済みルール（過去に「問題なし」とした条件）</h3>' + (c.exceptions.length ? '<div class="tblwrap"><table><thead><tr><th>チェック</th><th>取引先</th><th>勘定科目</th><th>語句</th><th>金額</th><th>期間</th><th>理由</th><th>登録</th><th></th></tr></thead><tbody>' + c.exceptions.map(e => '<tr><td>' + M.CHECKS[e.check] + '</td><td>' + esc(e.partner) + '</td><td>' + esc(e.account) + '</td><td>' + esc(e.keyword) + '</td><td>' + esc((e.amountMin || '') + (e.amountMin || e.amountMax ? '〜' : '') + (e.amountMax || '')) + '</td><td>' + esc(e.from) + '〜' + esc(e.to) + '</td><td>' + esc(e.reason) + '</td><td>' + esc(e.by) + ' ' + esc((e.at || '').slice(0, 10)) + '</td><td>' + delBtn('exceptions', e.id) + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="muted">まだありません。レビュー一覧の詳細で「問題なし」としたあと、条件と期間を指定して登録できます。</p>');
    h += '<h3>特有の取引・例外処理のメモ</h3><textarea data-c="notes" rows="3">' + esc(c.notes) + '</textarea><p class="muted">判定には使いません。引継ぎの出力に載せます。</p>';
    h += '<h3>勘定科目の種類</h3><p class="muted">仕訳帳CSVには科目の区分がないため、名前から推定しています。違うものは変更してください（口座どうしの仕訳は振替として扱い、重複候補にしません）。</p>' + (accs.length ? '<div class="tblwrap small"><table><thead><tr><th>勘定科目</th><th class="num">行数</th><th>種類</th></tr></thead><tbody>' + accs.map(([a, n]) => { const auto = M.accountKind({ accountKinds: {} }, a), cur = c.accountKinds[a] || ''; return '<tr><td>' + esc(a) + '</td><td class="num">' + n + '</td><td><select data-kind="' + esc(a) + '">' + opt('', '自動（' + kinds[auto] + '）', cur) + Object.entries(kinds).map(([v, l]) => opt(v, l, cur)).join('') + '</select></td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted">仕訳帳CSVを取り込むと表示されます。</p>');
    return h;
  }

  // ---------- 画面：引継ぎ ----------
  function handoffText() { const { all } = reviewItems(), run = st.data.runs[st.month]; return R.handoffMarkdown(st.company, st.month, all, { by: st.user, at: now(), notes: run ? run.notes : [] }); }
  function viewHandoff() {
    const { all } = reviewItems(), n = R.handoffItems(all).length;
    return '<h2>上席への引継ぎ（' + esc(st.month) + '）</h2><p>未解決（未確認・確認中・先方確認待ち）の ' + n + '件を、重要度順にまとめます。' + (st.filter.carried ? '前月以前からの繰越を含みます。' : '') + '</p><div class="rowbtns noprint"><button class="primary" data-act="copyHandoff">テキストをコピー</button><button data-act="dlHandoffMd">テキスト（.md）で保存</button><button data-act="dlHandoffCsv">一覧（CSV）で保存</button><button data-act="print">印刷</button></div><pre class="handoff" id="handoff">' + esc(handoffText()) + '</pre>';
  }

  // ---------- 画面：データと安全性 ----------
  function viewData() {
    const d = st.data;
    return '<h2>データと安全性</h2><h3>保存先と外部送信</h3><ul><li>取り込んだCSV・会社ルール・確認結果は、<b>このパソコンのこのブラウザの中（IndexedDB「kicho-review」）だけ</b>に保存します。</li><li>このアプリは外部と通信しません（配布ファイルは通信を禁止する設定にしてあります）。AIサービスへの送信もしていません。</li><li>freee の帳簿は変更しません（CSVを読むだけです）。</li><li>指摘・質問文案は、取り込んだデータと決まった手順から作っています。元データにない取引・金額は作りません。</li><li>ブラウザの閲覧データを消去すると、保存内容も消えます。下のバックアップを保管してください。別のパソコン・ブラウザとは共有されません。</li></ul>'
      + '<h3>この会社のデータ</h3><p>' + esc(st.company.name) + '：仕訳 ' + d.lines.length + '行、照合 ' + Object.keys(d.statements).length + '件、確認事項の記録 ' + Object.keys(st.review.states).length + '件</p><div class="rowbtns"><button data-act="backup">この会社のバックアップを保存（JSON）</button><label class="filebtn">バックアップから復元<input type="file" id="restore" accept=".json,application/json"></label><button class="danger" data-act="delCompany">この会社のデータをすべて削除</button><button class="danger" data-act="delAll">全会社のデータを削除</button></div><p class="muted">バックアップには顧客の仕訳データが含まれます。保管場所に注意してください。</p>'
      + '<h3>この版でできること・できないこと</h3><table class="kv"><tr><th>できること</th><td>仕訳帳CSVの取込と検証／重複候補／勘定科目・税区分の不一致（会社ルール・過去傾向）／定期取引の計上漏れ／通常と異なる金額／摘要・取引先の不足／経過措置の控除割合と取引日／現金残高のマイナス／口座明細との照合／対応状況・メモ・履歴の保存／確認済みルール／翌月への繰越／引継ぎの出力</td></tr><tr><th>未対応</th><td>freee API・ブラウザ拡張による取込（CSVのみ）／登録経路（自動登録ルール等）の取得／freee 画面へのリンク／売上資料・請求書・給与資料との照合／売掛金・買掛金などの滞留、期首・期末残高の整合性／前月比・前年同月比、売上区分別の変動／AIによる摘要の解釈・文案作成（質問文案は定型文）／複数人での同時利用・共有</td></tr></table>';
  }

  // ---------- 全体 ----------
  function render() {
    const app = $('#app'), keep = { list: ($('#list') || {}).scrollTop, detail: ($('#detail') || {}).scrollTop };
    let h = '<header><h1>記帳レビュー <small>v' + (window.KR_VERSION || 'dev') + '</small></h1>';
    if (st.company) h += '<label>会社 <select id="company">' + st.companies.map(c => opt(c.id, c.name, st.company.id)).join('') + '</select></label><button data-act="newCompany">＋会社を追加</button><label>対象月 <select id="month">' + (monthOptions().map(m => opt(m, m, st.month)).join('') || '<option value="">（データなし）</option>') + '</select></label>';
    h += '<label>担当者 <input id="user" value="' + esc(st.user) + '" placeholder="名前" size="8"></label><span class="local">このPC内だけで動作・外部送信なし・freeeは変更しません</span></header>';
    if (!st.company) h += '<main><div class="empty"><h2>記帳後の確認を、取引ごとに「なぜ・何と照合し・どう対応するか」まで</h2><p>freee の仕訳帳CSVを取り込み、重複候補、勘定科目・税区分の不一致、定期取引の計上漏れなどを会社ごとのルールと過去の処理に照らして抽出します。</p><div class="rowbtns center"><button class="primary" data-act="sample">サンプルデータで試す（架空の会社）</button><button data-act="newCompany">会社を追加して始める</button></div></div></main>';
    else {
      const un = st.review ? R.summary(R.list(st.review, st.company, st.month).current).unresolved : 0;
      h += '<nav>' + TABS.map(([k, l]) => '<button data-act="tab" data-tab="' + k + '" class="' + (st.tab === k ? 'on' : '') + '">' + l + (k === 'review' && un ? ' <span class="cnt">' + un + '</span>' : '') + '</button>').join('') + '</nav><main class="tab-' + st.tab + '">' + ({ review: viewReview, import: viewImport, recon: viewRecon, rules: viewRules, handoff: viewHandoff, data: viewData }[st.tab])() + '</main>';
    }
    app.innerHTML = h;
    if ($('#list') && keep.list) $('#list').scrollTop = keep.list;
    if ($('#detail') && keep.detail && st.keepDetail) $('#detail').scrollTop = keep.detail;
    st.keepDetail = false;
  }
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain;charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  async function copyText(text) { try { await navigator.clipboard.writeText(text); } catch (e) { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); } toast('コピーしました'); }
  const val = id => ($('#' + id) ? $('#' + id).value.trim() : '');
  const rid = () => 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  function setPath(obj, path, v) { const ks = path.split('.'); let o = obj; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]] = o[ks[i]] || {}; o[ks[ks.length - 1]] = v; }

  const actions = {
    tab: el => { st.tab = el.dataset.tab; },
    sel: el => { st.sel = el.dataset.key; },
    run: runReview,
    sample: loadSample,
    newCompany: async () => { const name = (prompt('会社名（顧問先名）を入力してください') || '').trim(); if (!name) return; const c = M.newCompany(name); await S.saveCompany(c); await reloadCompanies(); await selectCompany(c.id); st.tab = 'rules'; toast('会社を追加しました。基本情報と消費税の処理方針を登録してください'); },
    // 取り込んだファイルの最後の月を対象月にする（上の選択で変えられる）
    commitImport: async () => { const p = st.pending; commitJournal(p); st.pending = null; st.month = p.stats.months[p.stats.months.length - 1]; await S.setSetting('month:' + st.company.id, st.month); await saveData(); toast(p.lines.length + '行を取り込みました。対象月を ' + st.month + ' にしました。「レビュー一覧」で実行してください'); },
    cancelImport: () => { st.pending = null; },
    showRejected: el => { st.shown = el.dataset.id; },
    delImport: async el => { const i = st.data.imports.find(x => x.id === el.dataset.id); if (!i || !confirm('「' + i.name + '」から取り込んだ仕訳を削除しますか？（確認結果の記録は残ります）')) return; st.data.lines = st.data.lines.filter(l => l.src !== i.id); st.data.imports = st.data.imports.filter(x => x !== i); st.data.changedAt = now(); await saveData(); },
    status: async el => { const s = R.setState(st.review, st.sel, { status: el.dataset.status, memo: $('#memo').value }, st.user, now()); if (s) { await saveReview(); st.keepDetail = true; toast('「' + M.STATUS[el.dataset.status] + '」で保存しました' + (st.user ? '' : '（担当者名が未入力です）')); } },
    memo: async () => { R.setState(st.review, st.sel, { memo: $('#memo').value }, st.user, now()); await saveReview(); st.keepDetail = true; toast('メモを保存しました'); },
    addException: async () => {
      const f = st.review.states[st.sel].finding, ex = { id: rid(), check: f.check, partner: val('exPartner'), account: val('exAccount'), keyword: val('exKeyword'), amountMin: val('exMin'), amountMax: val('exMax'), from: val('exFrom'), to: val('exTo'), reason: val('exReason'), by: st.user, at: now() };
      const errs = R.validateException(ex); if (errs.length) return toast(errs[0], true);
      st.company.exceptions.push(ex); await saveCompany();
      // 登録のきっかけになった指摘は、利用者が自分で「問題なし」にした記録を残す
      R.setState(st.review, st.sel, { status: 'ok', memo: $('#memo').value }, st.user, now()); await saveReview(); toast('確認済みルールを登録しました（' + ex.from + '〜' + ex.to + '）');
    },
    copy: el => copyText($('#' + el.dataset.from).textContent),
    addPartnerRule: async () => { if (!val('prPartner') || (!val('prAccount') && !val('prTax'))) return toast('取引先と、勘定科目または税区分を入力してください', true); st.company.partnerRules.push({ id: rid(), partner: val('prPartner'), account: val('prAccount'), tax: val('prTax'), note: val('prNote') }); await saveCompany(); },
    addRecurring: async () => { if (!val('rcAccount')) return toast('勘定科目を入力してください', true); st.company.recurring.push({ id: rid(), name: val('rcName') || val('rcAccount'), account: val('rcAccount'), partner: val('rcPartner'), keyword: val('rcKeyword'), amount: Number(val('rcAmount')) || 0, tolerancePct: Number(val('rcTol')) || 0, note: val('rcNote') }); await saveCompany(); },
    delRule: async el => { const l = el.dataset.list; st.company[l] = st.company[l].filter(r => r.id !== el.dataset.id); await saveCompany(); },
    sampleStatement: () => { const s = KR.sample.build().statement; st.recon.account = s.account; const res = KR.csv.readStatement(s.text, s.name); res.encoding = 'UTF-8'; st.reconPending = res; },
    commitStatement: () => commitStatement(st.reconPending),
    cancelStatement: () => { st.reconPending = null; },
    rerunRecon: async () => { const s = st.data.statements[reconKey()]; s.truth = st.recon.truth; s.window = st.recon.window; s.at = now(); await applyRecon(s); },
    delRecon: async () => { const s = st.data.statements[reconKey()]; if (!confirm('この照合を削除しますか？（対応を記録した確認事項は「検出されず」として残ります）')) return; delete st.data.statements[reconKey()]; R.applyRun(st.review, st.month, [], f => f.check === 'RECON' && f.account === s.account, now()); await saveData(); await saveReview(); },
    copyHandoff: () => copyText(handoffText()),
    dlHandoffMd: () => download('記帳レビュー引継ぎ_' + st.company.name + '_' + st.month + '.md', handoffText()),
    dlHandoffCsv: () => download('記帳レビュー引継ぎ_' + st.company.name + '_' + st.month + '.csv', KR.csv.toCSV(R.handoffRows(reviewItems().all)), 'text/csv;charset=utf-8'),
    print: () => window.print(),
    backup: async () => download('記帳レビュー_バックアップ_' + st.company.name + '_' + now().slice(0, 10) + '.json', JSON.stringify(await S.exportCompany(st.company.id)), 'application/json'),
    delCompany: async () => { if (!confirm('「' + st.company.name + '」の会社ルール・取込データ・確認結果をすべて削除します。元に戻せません。よろしいですか？')) return; await S.deleteCompany(st.company.id); await reloadCompanies(); await selectCompany(st.companies[0] && st.companies[0].id); toast('削除しました'); },
    delAll: async () => { if (!confirm('すべての会社のデータを削除します。元に戻せません。よろしいですか？')) return; await S.deleteAll(); await reloadCompanies(); await selectCompany(null); toast('すべて削除しました'); },
  };

  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
    try { await actions[el.dataset.act](el); } catch (err) { console.error(err); toast('エラー：' + err.message, true); }
    render();
  });
  document.addEventListener('change', async e => {
    const el = e.target;
    try {
      if (el.id === 'company') { await selectCompany(el.value); }
      else if (el.id === 'month') { st.month = el.value; st.sel = null; st.reconPending = null; await S.setSetting('month:' + st.company.id, st.month); }
      else if (el.id === 'user') { st.user = el.value.trim(); await S.setSetting('user', st.user); return; }
      else if (el.id === 'jfile') { if (el.files[0]) await previewJournal(el.files[0]); return; }
      else if (el.id === 'sfile') { if (el.files[0]) { const d = await readFile(el.files[0]); const res = KR.csv.readStatement(d.text, el.files[0].name); res.encoding = d.encoding; st.reconPending = res; } }
      else if (el.id === 'restore') { if (el.files[0]) { const id = await S.importBackup(JSON.parse(await el.files[0].text())); await reloadCompanies(); await selectCompany(id); toast('復元しました'); } }
      else if (el.dataset.f) { st.filter[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value; if (el.dataset.f === 'q') { render(); const q = $('[data-f="q"]'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); return; } }
      else if (el.dataset.r) { st.recon[el.dataset.r] = el.dataset.r === 'window' ? Number(el.value) : el.value; if (el.dataset.r === 'account') st.reconPending = null; }
      else if (el.dataset.c) { setPath(st.company, el.dataset.c, el.dataset.num ? (el.value === '' ? null : Number(el.value)) : el.value); await saveCompany(); if (el.dataset.c === 'name') await reloadCompanies(); if (el.tagName !== 'SELECT') { toast('保存しました'); return; } }
      else if (el.dataset.kind != null) { if (el.value) st.company.accountKinds[el.dataset.kind] = el.value; else delete st.company.accountKinds[el.dataset.kind]; await saveCompany(); }
      else return;
    } catch (err) { console.error(err); toast('エラー：' + err.message, true); }
    render();
  });
  document.addEventListener('dragover', e => { if (e.target.closest('.drop')) e.preventDefault(); });
  document.addEventListener('drop', async e => { const z = e.target.closest('#drop'); if (!z) return; e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) await previewJournal(f); });

  (async function init() {
    try {
      await S.open(); await reloadCompanies();
      st.user = (await S.getSetting('user')) || '';
      const last = await S.getSetting('lastCompany');
      await selectCompany(st.companies.find(c => c.id === last) ? last : (st.companies[0] && st.companies[0].id));
    } catch (err) { $('#app').innerHTML = '<p class="warnbox">保存領域（IndexedDB）を開けませんでした：' + esc(err.message) + '。プライベートブラウズでは保存できないことがあります。</p>'; return; }
    render();
    window.KRApp = { state: st, render };
  })();
})();

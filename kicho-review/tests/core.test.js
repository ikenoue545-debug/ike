'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
const { KR, importJournals, sampleRun } = require('./load.js');
const U = KR.util, HEAD = '取引日,伝票番号,借方勘定科目,借方金額,借方税区分,借方取引先,貸方勘定科目,貸方金額,貸方税区分,貸方取引先,摘要\n';
const titles = run => run.findings.map(f => f.check + ':' + f.title);

test('日付と金額の読み取り', () => {
  for (const [v, e] of [['2026/10/1', '2026-10-01'], ['2026-10-01', '2026-10-01'], ['2026年10月1日', '2026-10-01'], ['20261001', '2026-10-01'], ['R8.10.1', '2026-10-01'], ['令和8年10月1日', '2026-10-01'], ['2026/02/30', null], ['10/1', null], ['', null]]) assert.equal(U.parseDate(v), e, v);
  for (const [v, e] of [['1,234', 1234], ['１２３４', 1234], ['¥1,234円', 1234], ['-500', -500], ['△500', -500], ['1234.00', 1234], ['', null]]) assert.equal(U.parseAmount(v), e, v);
  assert.ok(Number.isNaN(U.parseAmount('12a'))); assert.ok(Number.isNaN(U.parseAmount('12.5')));
});

test('Shift_JIS と UTF-8（BOMつき）を判定して読む', () => {
  const dir = path.join(__dirname, '..', '..', 'tests', 'fixtures');
  const sjis = KR.csv.decode(fs.readFileSync(path.join(dir, 'journal-2026-sjis.csv'))), utf = KR.csv.decode(fs.readFileSync(path.join(dir, 'journal-2026.csv')));
  assert.equal(sjis.encoding, 'Shift_JIS'); assert.equal(utf.encoding, 'UTF-8');
  const a = KR.csv.readJournal(sjis.text), b = KR.csv.readJournal(utf.text);
  assert.equal(a.fatal, null); assert.ok(a.lines.length > 100);
  assert.equal(a.lines.length, b.lines.length); assert.equal(a.hash, b.hash);
  assert.ok(a.lines.some(l => l.dAcc === '広告宣伝費'));
});

test('読めない行は理由つきで示し、読める行だけ取り込む', () => {
  const res = KR.csv.readJournal(HEAD + [
    '2026/10/01,1,消耗品費,1000,課対仕入10%,A商店,現金,1000,,,文具',
    '2026/13/01,2,消耗品費,1000,,,現金,1000,,,日付が不正',
    '2026/10/02,3,消耗品費,千円,,,現金,1000,,,金額が不正',
    '2026/10/03,4,,500,,,現金,500,,,借方科目なし',
    '2026/10/04,5,消耗品費,,,,現金,700,,,借方金額なし',
    ',,,,,,,,,,',
    '2026/10/05,6,消耗品費,800,,,現金,900,,,貸借不一致',
    '2026/10/06,7,"=cmd|x",300,,,現金,300,,,"改行を含む\n摘要, カンマ"',
  ].join('\n'));
  assert.equal(res.lines.length, 3);
  assert.deepEqual(res.rejected.map(r => r.row), [3, 4, 5, 6]);
  assert.match(res.rejected[0].reasons[0], /取引日を読めません/); assert.match(res.rejected[1].reasons[0], /借方金額を読めません/);
  assert.match(res.rejected[2].reasons[0], /借方勘定科目が空/); assert.match(res.rejected[3].reasons[0], /借方金額が空/);
  assert.equal(res.stats.blank, 1);
  assert.equal(res.warnings.length, 1); assert.match(res.warnings[0].text, /一致しません/);
  assert.equal(res.lines[2].desc, '改行を含む\n摘要, カンマ');
});

test('必要な列がないCSVは取り込まない', () => {
  assert.match(KR.csv.readJournal('日付,金額,メモ\n2026/10/1,100,x').fatal, /見出し行が見つかりません|必要な列がありません/);
  assert.match(KR.csv.readJournal('取引日,借方勘定科目,摘要,貸方勘定科目\n2026/10/1,現金,x,売上高').fatal, /必要な列がありません：借方金額/);
});

test('サンプル：問題候補をすべて検出し、理由を追跡できる', () => {
  const { run } = sampleRun(), ts = titles(run);
  const expect = [/^DUP:.*広告宣伝費 55,000円/, /^DUP:.*消耗品費 32,780円 \(株\)オフィスサプライ/, /^ACCOUNT:.*東京電力EP 水道光熱費 → 通信費/, /^ACCOUNT:.*ASKUL.*消耗品費 → 雑費（3件）/, /^TAX:.*アドビ.*課対仕入10% → 対象外/,
    /^RECUR:.*法定福利費 年金事務所/, /^AMOUNT:.*役員報酬 550,000円/, /^AMOUNT:.*NTT東日本 65,780円/, /^DESC:.*1件/, /^TAXRULE:.*佐藤デザイン/, /^CASH:現金残高がマイナス/];
  for (const re of expect) assert.ok(ts.some(t => re.test(t)), '未検出: ' + re);
  assert.equal(run.findings.length, expect.length, ts.join('\n'));
  for (const f of run.findings) {
    assert.ok(f.key && f.reason && f.nextAction && f.documents.length && f.question, f.title);
    assert.ok(KR.model.BASIS[f.basis] && KR.model.SEVERITY[f.severity]);
    assert.ok(f.fix || f.fixNote, '修正案か、示さない理由のどちらかが必要: ' + f.title);
    for (const e of f.entries) for (const r of e.rows) assert.ok(r.file && r.row > 1, '元データの位置がない: ' + f.title);
  }
  const dup = run.findings.find(f => /オフィスサプライ/.test(f.title));
  assert.equal(dup.entries.length, 2); assert.match(dup.inference[0], /法人カード と 未払金/);
  const askul = run.findings.find(f => /ASKUL/.test(f.title));
  assert.ok(askul.inference.some(t => /自動登録ルール.*未確認/.test(t)), '自動登録ルールは推測として示す');
  const txr = run.findings.find(f => f.check === 'TAXRULE');
  assert.ok(txr.sources.length && txr.sources.every(s => /^https:\/\/www\.nta\.go\.jp\//.test(s.url) && s.checked));
});

test('サンプル：正常な取引を指摘しない', () => {
  const { run, sample, lines, files } = sampleRun(), all = JSON.stringify(run.findings.map(f => [f.title, f.reason]));
  for (const w of ['駐車場', '電車代', 'ATM', '山田不動産', 'デルタ工業', 'エース企画', '給料手当', '割烹さくら']) assert.ok(!all.includes(w), w + ' が指摘に含まれている');
  assert.ok(run.suppressed.some(s => /地代家賃 22,000円.*通常の処理/.test(s.text)), '抑制した候補は記録する');
  // 正常な取引だけの月は0件
  for (const m of ['2026-08', '2026-09']) assert.deepEqual(titles(KR.checks.runReview(sample.company, lines, m, files)), [], m);
});

test('同じ入力なら同じ結果（再現性）', () => {
  const a = sampleRun().run, b = sampleRun().run;
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('税区分：経過措置の割合は時期で判定し、正しい切替を不一致にしない', () => {
  const s = KR.sample.build(), c = s.company;
  const oct = s.journals[1].text.replace('課対仕入（控80）10%', '課対仕入（控70）10%');
  let imp = importJournals([s.journals[0], { name: 'oct', text: oct }]);
  let run = KR.checks.runReview(c, imp.lines, '2026-10', imp.files);
  assert.ok(!run.findings.some(f => f.check === 'TAXRULE' || (f.check === 'TAX' && /佐藤/.test(f.title))));
  // 9月（控80が正しい時期）は指摘しない
  assert.ok(!KR.checks.runReview(c, imp.lines, '2026-09', imp.files).findings.length);
  // 免税事業者：適用時期のチェックは行わず、税区分の不一致は重要度を下げて影響なしと示す
  c.tax.status = 'exempt'; imp = importJournals(s.journals); run = KR.checks.runReview(c, imp.lines, '2026-10', imp.files);
  assert.ok(!run.findings.some(f => f.check === 'TAXRULE')); assert.ok(run.notes.some(n => /免税事業者.*行っていません/.test(n)));
  const tax = run.findings.find(f => f.check === 'TAX'); assert.equal(tax.severity, 'low'); assert.match(tax.impact, /影響しません/);
  // 簡易課税：仕入側は影響なし、出典つき
  c.tax.status = 'simplified'; const t2 = KR.checks.runReview(c, imp.lines, '2026-10', imp.files).findings.find(f => f.check === 'TAX');
  assert.match(t2.impact, /簡易課税/); assert.ok(t2.sources.length);
  assert.equal(KR.model.invoiceRatioOn('2026-09-30'), 80); assert.equal(KR.model.invoiceRatioOn('2026-10-01'), 70); assert.equal(KR.model.invoiceRatioOn('2028-10-01'), 50); assert.equal(KR.model.invoiceRatioOn('2031-10-01'), 0);
});

test('会社ルール：取引先の通常科目・定期取引。履歴がなくても登録した定期取引は確認する', () => {
  const s = KR.sample.build(), imp = importJournals([s.journals[1]]);
  const run = KR.checks.runReview(s.company, imp.lines, '2026-10', imp.files);
  assert.ok(run.notes.some(n => /自動検出は行っていません/.test(n)));
  assert.ok(run.findings.some(f => f.check === 'AMOUNT' && f.basis === 'rule' && /役員報酬/.test(f.title)));
  assert.ok(!run.findings.some(f => f.basis === 'trend'), '履歴がないのに過去傾向で指摘している');
  s.company.recurring.push({ id: 'r3', name: '社会保険料', account: '法定福利費', partner: '年金事務所', amount: 118000, tolerancePct: 5 });
  s.company.partnerRules.push({ id: 'p2', partner: '東京電力ＥＰ', account: '水道光熱費', tax: '' });
  const run2 = KR.checks.runReview(s.company, imp.lines, '2026-10', imp.files);
  assert.ok(run2.findings.some(f => f.check === 'RECUR' && f.basis === 'rule' && /社会保険料/.test(f.title)));
  assert.ok(run2.findings.some(f => f.check === 'ACCOUNT' && f.basis === 'rule' && /東京電力/.test(f.title)), '全角・半角の違う取引先名でも会社ルールが当たる');
});

test('現金残高：期首残高がなければ断定せず、資料不足として示す', () => {
  const s = KR.sample.build(), imp = importJournals(s.journals);
  s.company.cashOpening = { date: '', amount: null };
  const f = KR.checks.runReview(s.company, imp.lines, '2026-10', imp.files).findings.find(x => x.check === 'CASH');
  assert.equal(f.basis, 'evidence'); assert.match(f.title, /期首残高が .* 以上ないとマイナス/);
  s.company.cashOpening = { date: '2026-01-01', amount: 30000 };
  const run = KR.checks.runReview(s.company, imp.lines, '2026-10', imp.files);
  assert.ok(!run.findings.some(x => x.check === 'CASH')); assert.ok(run.notes.some(n => /現金残高.*判定していません/.test(n)));
});

test('対応状況の保存・再実行での引継ぎ・検出されなくなった指摘', () => {
  const { run, sample, lines, files } = sampleRun(), R = KR.review, rv = R.emptyReview(), scope = f => f.check !== 'RECON';
  R.applyRun(rv, '2026-10', run.findings, scope, '2026-11-11T01:00:00Z');
  const dup = run.findings.find(f => /アドワークス/.test(f.title)), acc = run.findings.find(f => /東京電力/.test(f.title));
  R.setState(rv, dup.key, { status: 'waiting', memo: '請求書を依頼' }, '山田', '2026-11-11T02:00:00Z');
  R.setState(rv, acc.key, { status: 'fixed', memo: '水道光熱費に修正' }, '山田', '2026-11-11T02:10:00Z');
  // 保存データは JSON にして戻しても同じ
  const saved = JSON.parse(JSON.stringify(rv));
  // 修正後のCSVで再実行：広告の重複はそのまま、東京電力は直っている
  const fixed = lines.map(l => l.dPartner === '東京電力EP' ? Object.assign({}, l, { dAcc: '水道光熱費' }) : l);
  R.applyRun(saved, '2026-10', KR.checks.runReview(sample.company, fixed, '2026-10', files).findings, scope, '2026-11-12T01:00:00Z');
  const cur = R.list(saved, sample.company, '2026-10').current, get = k => cur.find(i => i.key === k);
  assert.equal(get(dup.key).status, 'waiting'); assert.equal(get(dup.key).memo, '請求書を依頼'); assert.equal(get(dup.key).history.length, 1); assert.equal(get(dup.key).history[0].by, '山田');
  assert.equal(get(acc.key).status, 'fixed'); assert.equal(get(acc.key).gone, true, '検出されなくなった指摘は記録を残して印を付ける');
  assert.equal(cur.length, run.findings.length);
  // 翌月：未解決だけが繰越に出る
  const nov = R.list(saved, sample.company, '2026-11');
  assert.equal(nov.current.length, 0); assert.ok(nov.carried.some(i => i.key === dup.key)); assert.ok(!nov.carried.some(i => i.key === acc.key));
  const sum = R.summary(cur); assert.equal(sum.waiting, 1); assert.equal(sum.fixed, 1); assert.equal(sum.unresolved, cur.length - 1);
});

test('確認済みルール：条件・期間・会社を限定し、無条件の除外はできない', () => {
  const { run, sample } = sampleRun(), R = KR.review, rv = R.emptyReview();
  R.applyRun(rv, '2026-10', run.findings, () => true, 'now');
  assert.ok(R.validateException({ check: 'DUP', from: '2026-10', to: '2027-03', reason: 'x' }).some(e => /少なくとも1つ/.test(e)));
  assert.ok(R.validateException({ check: 'DUP', partner: 'A', from: '2026-10', to: '2027-03', reason: '' }).some(e => /理由/.test(e)));
  assert.ok(R.validateException({ check: 'DUP', partner: 'A', reason: 'x' }).some(e => /期間/.test(e)));
  const ex = { id: 'e1', check: 'DUP', partner: '㈱アドワークス', account: '広告宣伝費', from: '2026-10', to: '2026-12', reason: '2媒体分を同額で支払う契約' };
  assert.deepEqual(R.validateException(ex), []);
  sample.company.exceptions.push(ex);
  const cur = R.list(rv, sample.company, '2026-10').current, ad = cur.find(i => /アドワークス/.test(i.f.title)), os = cur.find(i => /オフィスサプライ/.test(i.f.title));
  assert.equal(ad.status, 'ok'); assert.equal(ad.auto.id, 'e1'); assert.equal(os.status, 'open', '別の取引先の重複候補には適用しない');
  assert.equal(cur.length, run.findings.length, '確認済みルールに当たっても一覧からは消さない');
  // 期間外・別会社には適用しない
  ex.to = '2026-09'; assert.equal(R.list(rv, sample.company, '2026-10').current.find(i => i.key === ad.key).status, 'open');
  assert.equal(R.matchException(KR.sample.company(), ad.f), null);
});

test('明細との照合：4つの区分と、日付ずれ・合算・手数料控除', () => {
  const { sample, lines, files } = sampleRun(), RC = KR.reconcile;
  const st = KR.csv.readStatement(sample.statement.text, sample.statement.name);
  assert.equal(st.fatal, null); assert.equal(st.rejected.length, 0);
  const book = RC.bookLines(sample.company, lines, '普通預金', '2026-10-01', '2026-10-31', files);
  const rec = RC.reconcile(st.lines, book, {});
  assert.deepEqual(rec.counts, { match: 14, diff: 1, single: 2, unsure: 1 });
  assert.ok(rec.results.some(r => r.category === 'match' && r.combo === '合算入金' && r.book.length === 2 && r.sTotal === 143000));
  assert.ok(rec.results.some(r => r.category === 'match' && r.dateShift === 1 && r.sTotal === -165000));
  assert.ok(rec.results.some(r => r.category === 'diff' && r.diff === 660));
  assert.ok(rec.results.some(r => r.category === 'single' && r.side === 'book' && r.bTotal === -55000), '二重計上の片方は帳簿のみになる');
  assert.ok(rec.results.some(r => r.category === 'single' && r.side === 'statement' && r.sTotal === -4400));
  assert.ok(rec.results.some(r => r.category === 'unsure' && r.statement.length === 2 && r.book.length === 1));
  // ATM引出し2件（同日同額の口座間振替）は、明細にも2件あり一致。重複候補にもしていない
  assert.equal(rec.results.filter(r => r.category === 'match' && r.sTotal === -50000).length, 2);
  // すべての行がどれか1つの結果に入る
  assert.equal(rec.results.reduce((n, r) => n + r.statement.length, 0), st.lines.length); assert.equal(rec.results.reduce((n, r) => n + r.book.length, 0), book.length);
  const fs2 = RC.toFindings(rec, { company: sample.company, account: '普通預金', month: '2026-10', fileName: 'x.csv' });
  assert.equal(fs2.length, 4); assert.ok(fs2.every(f => f.fix === null && f.fixNote), '照合の差異では修正を断定しない');
  assert.ok(fs2.find(f => /差額あり/.test(f.title)).inference[0].includes('可能性'));
});

test('明細CSV：読めない行と、資料の中の重複行を示す', () => {
  const res = KR.csv.readStatement('日付,摘要,お支払金額,お預り金額,残高\n2026/10/1,A,1000,,9000\n2026/10/1,A,1000,,9000\nx,B,1,,\n2026/10/2,C,100,200,\n2026/10/3,D,,,\n');
  assert.equal(res.lines.length, 2); assert.equal(res.rejected.length, 3); assert.equal(res.warnings.length, 1); assert.match(res.warnings[0].text, /重複の可能性/);
});

test('引継ぎ出力：未解決だけを重要度順に。CSVは数式として扱われない', () => {
  const { run, sample } = sampleRun(), R = KR.review, rv = R.emptyReview();
  R.applyRun(rv, '2026-10', run.findings, () => true, '2026-11-11T01:00:00Z');
  R.setState(rv, run.findings[0].key, { status: 'ok', memo: '確認済み' }, '山田', '2026-11-11T02:00:00Z');
  const items = R.list(rv, sample.company, '2026-10').current;
  const md = R.handoffMarkdown(sample.company, '2026-10', items, { by: '山田', at: '2026-11-11T03:00:00Z', notes: run.notes });
  assert.match(md, new RegExp('未解決：' + (run.findings.length - 1) + '件')); assert.ok(!md.includes(run.findings[0].title)); assert.match(md, /推測（未確定）/); assert.match(md, /判定していない項目/);
  const csv = KR.csv.toCSV([['=1+1', '-5', -5, '+x', '普通']]);
  assert.ok(csv.includes("'=1+1,'-5,-5,'+x,普通"));
  assert.equal(R.handoffRows(items).length, run.findings.length);
});

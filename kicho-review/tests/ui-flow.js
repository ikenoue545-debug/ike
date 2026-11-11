// 配布ファイル（dist）を Chromium で開き、取込 → レビュー → 対応の保存 → 再読込 → 照合 → 引継ぎ までを通す
'use strict';
const path = require('path'), assert = require('node:assert/strict'), { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..'), VERSION = require('../package.json').version;
const FILE = 'file://' + path.join(ROOT, 'dist', '記帳レビュー_v' + VERSION + '.html'), S = n => ({ name: n, mimeType: 'text/csv', buffer: require('fs').readFileSync(path.join(ROOT, 'samples', n)) });   // この環境のブラウザは日本語パスを選べないため、内容を渡す
const SHOT = process.env.SHOT_DIR;
(async () => {
  const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [], external = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => { if (!r.url().startsWith('file://') && !r.url().startsWith('blob:')) external.push(r.url()); });
  page.on('dialog', d => d.type() === 'prompt' ? d.accept('テスト商店（架空）') : d.accept());
  const step = async (name, fn) => { await fn(); console.log('ok  ' + name); };
  const tab = name => page.click('nav button:has-text("' + name + '")');
  const shot = async n => { if (SHOT) await page.screenshot({ path: path.join(SHOT, n + '.png'), fullPage: false }); };

  await page.goto(FILE);
  await step('最初の画面：会社がなく、サンプルと会社追加を案内する', async () => {
    await page.waitForSelector('.empty'); assert.match(await page.textContent('.empty'), /サンプルデータで試す/);
  });
  await step('会社を追加し、担当者名を入れる', async () => {
    await page.click('.empty button:has-text("会社を追加")'); await page.waitForSelector('main.tab-rules');
    assert.match(await page.textContent('h2'), /テスト商店（架空）/);
    await page.fill('#user', '山田'); await page.dispatchEvent('#user', 'change');
  });
  await step('読めない行を含むCSV：理由つきで示し、読めた行だけ取り込める', async () => {
    await tab('データ取込'); await page.setInputFiles('#jfile', S('サンプル_読めない行を含む仕訳帳.csv')); await page.waitForSelector('.preview');
    const t = await page.textContent('.preview');
    assert.match(t, /読めなかった行：3行/); assert.match(t, /取引日を読めません/); assert.match(t, /借方金額を読めません/); assert.match(t, /借方勘定科目が空/); assert.match(t, /1行を取り込む/);
    await shot('01-import-preview');
    await page.click('button:has-text("やめる")');
  });
  await step('仕訳帳CSVを2ファイル取り込む（過去5か月＋対象月）', async () => {
    for (const f of ['サンプル_仕訳帳_2026-05〜09.csv', 'サンプル_仕訳帳_2026-10.csv']) { await page.setInputFiles('#jfile', S(f)); await page.waitForSelector('.preview'); assert.match(await page.textContent('.preview'), /読めなかった行<\/th>|読めなかった行/); await page.click('[data-act="commitImport"]'); await page.waitForSelector('.preview', { state: 'detached' }); }
    assert.equal(await page.inputValue('#month'), '2026-10');
    assert.equal(await page.locator('main table tbody tr').count(), 2);
  });
  await step('同じファイルの再取込：取込済みと知らせ、行は二重にならない', async () => {
    await page.setInputFiles('#jfile', S('サンプル_仕訳帳_2026-10.csv')); await page.waitForSelector('.preview');
    const t = await page.textContent('.preview'); assert.match(t, /同じ内容のファイルを取込済み/); assert.match(t, /43行を、このファイルの内容で置き換えます/);
    await page.click('[data-act="commitImport"]'); await page.waitForSelector('.preview', { state: 'detached' });
    assert.equal(await page.evaluate(() => window.KRApp.state.data.lines.length), 230);
  });
  await step('レビューを実行：重要度順に確認事項が並ぶ', async () => {
    await tab('レビュー一覧'); assert.match(await page.textContent('main'), /まだ実行していません/);
    await page.click('[data-act="run"]'); await page.waitForSelector('.list .row');
    const rows = await page.locator('.list .row').allTextContents();
    assert.equal(rows.length, 14, rows.join('\n'));   // 会社ルール・試算表が未登録のため、役員報酬（会社ルール）・残高の整合性・仮払金は出ない
    for (const re of [/重複候補：広告宣伝費 55,000円/, /重複候補：消耗品費 32,780円/, /東京電力EP 水道光熱費 → 通信費/, /定期取引の計上漏れ候補：法定福利費/, /アドビ.*対象外/, /期首残高が .* 以上ないとマイナス/, /滞留の可能性：売掛金 シーウェーブ/, /役員貸付金の増減/, /月次の変動：修繕費/, /売上の内訳の変動：取引先「ビーライン/]) assert.ok(rows.some(r => re.test(r)), String(re));
    assert.ok(!rows.some(r => /駐車場|電車代|ATM/.test(r)));
    assert.match(rows[0], /^高/);
  });
  await step('詳細：対象取引・比較対象・計算・推測・資料・次の対応が出る', async () => {
    await page.click('.list .row:has-text("東京電力EP")'); await page.waitForSelector('.detail h3');
    const t = await page.textContent('.detail');
    for (const w of ['指摘理由', 'データから確認できる事実', '対象の取引', '比較対象：過去の直近の処理', '過去の内訳', '推測', 'データからは確定できません', '確認すべき資料', '推奨する次の対応', '修正案', '条件つき', 'freee で探すときの条件', '先方への質問文案', '更新履歴', 'サンプル_仕訳帳_2026-10.csv']) assert.ok(t.includes(w), w);
    assert.equal(await page.locator('.detail a[href]').count(), 0, 'freee へのリンクは設けない');
    await shot('02-review-detail');
  });
  let dupKey;
  await step('対応状況とメモを保存し、再読込しても残る', async () => {
    await page.click('.list .row:has-text("広告宣伝費 55,000円")'); await page.fill('#memo', '請求書を先方に依頼（11/11）');
    await page.click('.stbtns button:has-text("先方確認待ち")'); await page.waitForSelector('.list .row.on .st-waiting');
    dupKey = await page.evaluate(() => window.KRApp.state.sel);
    await page.reload(); await page.waitForSelector('.list .row');
    assert.equal(await page.inputValue('#user'), '山田'); assert.equal(await page.inputValue('#month'), '2026-10');
    await page.click('.list .row:has-text("広告宣伝費 55,000円")');
    assert.equal(await page.inputValue('#memo'), '請求書を先方に依頼（11/11）');
    assert.match(await page.textContent('.hist'), /山田.*未確認 → 先方確認待ち/);
    assert.match(await page.textContent('.summary'), /1先方確認待ち/);
  });
  await step('再実行しても対応状況は引き継がれる', async () => {
    await page.click('[data-act="run"]'); await page.waitForSelector('.list .row .st-waiting');
    assert.equal(await page.locator('.list .row').count(), 14);
  });
  await step('月次推移（貸借対照表）CSV：取り込むと再実行を促し、残高の整合性と、仕訳に動きのない仮払金の滞留が出る', async () => {
    await tab('データ取込'); await page.setInputFiles('#bsfile', S('サンプル_読めない行を含む仕訳帳.csv')); await page.waitForSelector('.warnbox:has-text("見出し行")');
    await page.setInputFiles('#bsfile', S('サンプル_月次推移_貸借対照表.csv')); await page.waitForSelector('table.kv:has-text("8科目")');
    await tab('レビュー一覧'); assert.match(await page.textContent('main'), /仕訳データが変わっています/);
    await page.click('[data-act="run"]'); await page.waitForSelector('.list .row:has-text("残高の整合性：売掛金")');
    assert.equal(await page.locator('.list .row').count(), 16); assert.equal(await page.locator('.list .row:has-text("仮払金（科目全体） 80,000円")').count(), 1);
    await page.click('.list .row:has-text("残高の整合性：売掛金")'); const t = await page.textContent('.detail'); assert.match(t, /試算表：前月末/); assert.match(t, /出力した時点が違う/);
  });
  await step('会社ルール：定期取引を登録すると再実行を促し、会社ルールとして指摘する', async () => {
    await tab('会社ルール'); await page.selectOption('[data-c="tax.status"]', 'general');
    await page.fill('#rcName', '役員報酬'); await page.fill('#rcAccount', '役員報酬'); await page.fill('#rcAmount', '500000'); await page.click('[data-act="addRecurring"]');
    await tab('レビュー一覧'); assert.match(await page.textContent('main'), /会社ルールが変わっています/);
    await page.click('[data-act="run"]'); await page.waitForSelector('.list .row:has-text("役員報酬 550,000円")');
    assert.match(await page.textContent('.list .row:has-text("役員報酬 550,000円")'), /ルール上の不整合/);
  });
  await step('確認済みルール：条件なしは登録できず、条件・期間つきで登録すると「問題なし（確認済みルール）」になる', async () => {
    await page.click('.list .row:has-text("通信費 NTT東日本")'); await page.click('.stbtns button:has-text("問題なし")'); await page.waitForSelector('.exform[open]');
    await page.fill('#exPartner', ''); await page.fill('#exAccount', ''); await page.fill('#exReason', '年払いに変更'); await page.click('[data-act="addException"]');
    assert.match(await page.textContent('#toast'), /少なくとも1つ/);
    await page.fill('#exPartner', 'NTT東日本'); await page.fill('#exReason', '年払いに変更'); await page.click('[data-act="addException"]');
    await tab('会社ルール'); assert.match(await page.textContent('main'), /年払いに変更/); assert.match(await page.textContent('main'), /2026-10〜2027-03/);
  });
  await step('サンプルの会社を読み込む：別の会社としてデータが分かれる', async () => {
    await page.evaluate(() => { document.querySelector('#app').insertAdjacentHTML('beforeend', '<button id="t-sample" data-act="sample">s</button>'); }); await page.click('#t-sample');
    await page.waitForSelector('.list .row'); assert.equal(await page.locator('.list .row').count(), 17);
    assert.equal(await page.locator('.list .row .st-waiting').count(), 0, '別の会社の対応状況が混ざっていない');
    assert.equal(await page.evaluate(() => window.KRApp.state.company.exceptions.length), 0);
    assert.match(await page.textContent('.list'), /現金残高がマイナス/);
  });
  await step('明細との照合：4区分に分け、一致以外をレビュー一覧に追加する', async () => {
    await tab('資料との照合'); await page.click('[data-act="sampleStatement"]'); await page.waitForSelector('.preview'); await page.click('[data-act="commitStatement"]'); await page.waitForSelector('table.recon');
    const s = await page.textContent('.summary'); assert.match(s, /16一致/); assert.match(s, /1差額あり/); assert.match(s, /2片側のみ/); assert.match(s, /1同一取引か要確認/);
    await shot('03-recon');
    await tab('レビュー一覧'); await page.selectOption('[data-f="check"]', 'RECON'); assert.equal(await page.locator('.list .row').count(), 4);
    await page.click('.list .row:has-text("差額あり")'); const t = await page.textContent('.detail'); assert.match(t, /明細側/); assert.match(t, /帳簿側/); assert.match(t, /振込手数料/);
    await page.selectOption('[data-f="check"]', '');
  });
  await step('売上資料との照合：計上の差異と、入金が見当たらない請求を請求書単位で示す', async () => {
    await tab('資料との照合'); await page.click('[data-act="reconKind"][data-k="sales"]'); await page.click('[data-act="sampleDoc"]'); await page.waitForSelector('.preview');
    assert.match(await page.textContent('.preview'), /10行.*うち対象月 5行/); await page.click('[data-act="commitDoc"]'); await page.waitForSelector('table.recon');
    const s = await page.textContent('.summary'); assert.match(s, /3一致/); assert.match(s, /1差額あり/); assert.match(s, /1片側のみ/); assert.match(s, /1入金が見当たらない請求/);
    const m = await page.textContent('main'); assert.match(m, /税込・税抜の違いの可能性/); assert.match(m, /INV-0905.*入金期日 2026-10-20 を過ぎても/);
    await shot('05-sales');
  });
  await step('給与資料との照合：総支給・控除・差引支給を帳簿の合計と比べる', async () => {
    await page.click('[data-act="reconKind"][data-k="pay"]'); await page.click('[data-act="sampleDoc"]'); await page.waitForSelector('.preview'); await page.click('[data-act="commitDoc"]'); await page.waitForSelector('table.recon');
    const s = await page.textContent('.summary'); assert.match(s, /2一致/); assert.match(s, /2差額あり/);
    assert.match(await page.textContent('table.recon'), /総支給額（役員）500,000550,000-50,000/);
    await tab('レビュー一覧'); assert.equal(await page.locator('.list .row').count(), 26);
    await page.selectOption('[data-f="check"]', 'SALES'); assert.equal(await page.locator('.list .row').count(), 3);
    await page.click('.list .row:has-text("入金が見当たらない請求")'); assert.match(await page.textContent('.detail'), /請求一覧側/);
    await page.selectOption('[data-f="check"]', ''); await shot('06-review-all');
    await page.reload(); await page.waitForSelector('.list .row'); assert.equal(await page.locator('.list .row').count(), 26, '再読込しても照合の結果が残る');
  });
  await step('会社を切り替えても記録が保たれ、引継ぎを出力できる', async () => {
    await page.selectOption('#company', { label: 'テスト商店（架空）' }); await page.waitForSelector('.list .row');
    const st = await page.evaluate(k => { const s = window.KRApp.state; return [s.review.states[k].status, s.company.exceptions.length]; }, dupKey); assert.deepEqual(st, ['waiting', 1]);
    assert.equal(await page.locator('.list .row:has-text("通信費 NTT東日本")').count(), 0, '既定の絞込（未解決のみ）では解決済みを出さない');
    await page.selectOption('[data-f="status"]', 'all'); assert.match(await page.textContent('.list .row:has-text("通信費 NTT東日本")'), /問題なし/); await page.selectOption('[data-f="status"]', 'unresolved');
    await tab('引継ぎ'); const h = await page.textContent('#handoff');
    assert.match(h, /記帳レビュー 引継ぎ：テスト商店（架空）　2026-10/); assert.match(h, /作成：山田/); assert.match(h, /先方確認待ち/); assert.match(h, /請求書を先方に依頼/); assert.match(h, /推測（未確定）/); assert.ok(!/NTT東日本 65,780/.test(h), '解決済みは引継ぎに出さない');
    await shot('04-handoff');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="dlHandoffCsv"]')]); const csv = require('fs').readFileSync(await dl.path(), 'utf8');   // この環境のブラウザは日本語のファイル名を報告しないため、内容で確かめる
    assert.match(csv, /^\ufeff重要度,状況,対象月/); assert.match(csv, /先方確認待ち,2026-10,重複候補/);
  });
  await step('会社の削除：その会社のデータだけが消える', async () => {
    await tab('データと安全性'); assert.match(await page.textContent('main'), /外部と通信しません/);
    await page.click('[data-act="delCompany"]'); await page.waitForFunction(() => window.KRApp.state.company && window.KRApp.state.company.id === 'sample');
    assert.equal(await page.locator('#company option').count(), 1);
    await tab('レビュー一覧'); assert.equal(await page.locator('.list .row').count(), 26);
  });
  await step('外部への通信・画面のエラーがない', async () => { assert.deepEqual(external, []); assert.deepEqual(errors, []); });
  await browser.close();
  console.log('ui-flow: all passed');
})().catch(e => { console.error(e); process.exit(1); });

// 判定エンジン（src/core）を Node に読み込む。サンプルデータを実データと同じ取込処理に通す
'use strict';
const path = require('path');
for (const f of ['util', 'csv', 'model', 'checks', 'reconcile', 'review', 'sample']) require(path.join(__dirname, '..', 'src', 'core', f + '.js'));
const KR = globalThis.KR;
// 画面の取込処理（app.js の importJournal）と同じ：同じ月の行は新しいファイルで置き換える
function importJournals(journals) {
  let lines = []; const files = {}, parsed = [];
  journals.forEach((j, i) => {
    const res = KR.csv.readJournal(j.text, j.name), src = 'i' + i;
    parsed.push(res); files[src] = j.name;
    const months = new Set(res.stats.months);
    lines = lines.filter(l => !months.has(l.date.slice(0, 7))).concat(res.lines.map(l => Object.assign({ id: src + ':' + l.row, src }, l)));
  });
  return { lines, files, parsed };
}
function sampleRun() {
  const s = KR.sample.build(), imp = importJournals(s.journals);
  return Object.assign({ sample: s, run: KR.checks.runReview(s.company, imp.lines, s.month, imp.files) }, imp);
}
module.exports = { KR, importJournals, sampleRun };

// サンプルのCSVを samples/ に書き出す（画面の「データ取込」から実ファイルとして取り込んで試せる）
'use strict';
const fs = require('fs'), path = require('path'), { KR } = require('./load.js');
const dir = path.join(__dirname, '..', 'samples'), s = KR.sample.build();
fs.mkdirSync(dir, { recursive: true });
for (const f of s.journals.concat([s.statement])) fs.writeFileSync(path.join(dir, f.name), '﻿' + f.text);
fs.writeFileSync(path.join(dir, 'サンプル_読めない行を含む仕訳帳.csv'), '﻿取引日,伝票番号,借方勘定科目,借方金額,借方税区分,借方取引先,貸方勘定科目,貸方金額,貸方税区分,貸方取引先,摘要\r\n2026/11/01,1,消耗品費,1200,課対仕入10%,A商店,現金,1200,,,文具\r\n2026/11/31,2,消耗品費,800,,,現金,800,,,日付が存在しない\r\n2026/11/02,3,会議費,三千円,,,現金,3000,,,金額が数字でない\r\n2026/11/03,4,,500,,,現金,500,,,借方科目がない\r\n');
console.log('wrote', fs.readdirSync(dir).join(', '));

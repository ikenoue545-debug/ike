#!/usr/bin/env node
// src/index.html が読み込む CSS・JS を1つのHTMLにまとめ、dist/ に配布ファイルを作る。
// 配布ファイルには、外部との通信を禁止する設定（Content-Security-Policy）を入れる。
'use strict';
const fs = require('fs'), path = require('path');
const VERSION = require('./package.json').version;
const SRC = path.join(__dirname, 'src'), OUT = path.join(__dirname, 'dist', '記帳レビュー_v' + VERSION + '.html');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
let html = read('index.html');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/, (_, f) => '<style>\n' + read(f) + '</style>');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, f) => {
  const js = read(f);
  if (/<\/script/i.test(js)) throw new Error(f + ' に </script を含めないでください');
  return '<script>\n' + js + '</script>';
});
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="' + CSP + '">\n<script>window.KR_VERSION=' + JSON.stringify(VERSION) + ';</script>');
if (/<script src=|<link rel="stylesheet"/.test(html)) throw new Error('外部ファイルの参照が残っています');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log('wrote ' + path.relative(__dirname, OUT) + ' (' + Buffer.byteLength(html).toLocaleString() + ' bytes)');

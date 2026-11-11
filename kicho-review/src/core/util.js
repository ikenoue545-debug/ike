// 記帳レビュー：共通の小さな関数（文字の正規化・日付・金額・ハッシュ）
(function (root) {
  'use strict';
  const KR = root.KR = root.KR || {};

  const nfkc = s => String(s == null ? '' : s).normalize('NFKC');
  // 値の保持用：前後の空白と不可視文字だけ除く（全角・半角は変えない）
  const trim = s => String(s == null ? '' : s).replace(/[\u200b\ufeff]/g, '').trim();
  const clean = s => nfkc(s).replace(/[​﻿]/g, '').replace(/\s+/g, ' ').trim();
  // 取引先名の比較用：法人格・空白・記号を落とす（表示には使わない）
  const normPartner = s => clean(s).toUpperCase()
    .replace(/株式会社|有限会社|合同会社|\(株\)|\(有\)|\(同\)|㈱|㈲/g, '')
    .replace(/[\s\-‐ー・.,、。()（）]/g, '');
  // 摘要の比較用：数字・日付・記号を落として「同じ種類の摘要」をまとめる
  const normDesc = s => clean(s).toUpperCase()
    .replace(/[0-9]+/g, '').replace(/[年月日分号回第\/\-‐ー:：.,、。()（）\[\]#＃*＊\s]/g, '');

  function pad(n) { return String(n).padStart(2, '0'); }
  function validYMD(y, m, d) {
    if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return y + '-' + pad(m) + '-' + pad(d);
  }
  const ERA = { R: 2018, 令和: 2018, H: 1988, 平成: 1988 };
  // 読める形式：2026/10/1、2026-10-01、2026.10.1、2026年10月1日、20261001、R8.10.1、令和8年10月1日
  function parseDate(v) {
    const s = clean(v);
    if (!s) return null;
    let m = s.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/);
    if (m) return validYMD(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return validYMD(+m[1], +m[2], +m[3]);
    m = s.match(/^(R|H|令和|平成)\s?(\d{1,2}|元)[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/i);
    if (m) { const base = ERA[m[1].toUpperCase()] || ERA[m[1]]; return validYMD(base + (m[2] === '元' ? 1 : +m[2]), +m[3], +m[4]); }
    return null;
  }
  // 金額：カンマ・円記号・全角を許す。小数（.00 以外）や文字が混じるものは読めないとして null ではなく NaN を返す
  function parseAmount(v) {
    let s = clean(v);
    if (s === '') return null;
    let neg = false;
    if (/^[△▲]/.test(s) || /^\(.*\)$/.test(s)) { neg = true; s = s.replace(/^[△▲]/, '').replace(/^\((.*)\)$/, '$1'); }
    s = s.replace(/[¥￥,円\s]/g, '');
    if (/^-/.test(s)) { neg = !neg; s = s.slice(1); }
    if (!/^\d+(\.0+)?$/.test(s)) return NaN;
    const n = Math.round(parseFloat(s));
    return neg ? -n : n;
  }
  const yen = n => (n == null || isNaN(n)) ? '' : (n < 0 ? '-' : '') + Math.abs(Math.round(n)).toLocaleString('ja-JP') + '円';
  const monthOf = d => d.slice(0, 7);
  function addMonths(ym, k) {
    const y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + k;
    return (y + Math.floor(m / 12)) + '-' + pad(((m % 12) + 12) % 12 + 1);
  }
  function monthEnd(ym) { const y = +ym.slice(0, 4), m = +ym.slice(5, 7); return ym + '-' + pad(new Date(Date.UTC(y, m, 0)).getUTCDate()); }
  function dayDiff(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
  function addDays(d, k) { return new Date(Date.parse(d + 'T00:00:00Z') + k * 86400000).toISOString().slice(0, 10); }
  function median(a) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : Math.round((s[h - 1] + s[h]) / 2); }
  // 内容から作る安定した短い識別子（FNV-1a 2本）。同じ内容なら再取込しても同じ値になる
  function hash(str) {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0; h2 ^= h2 >>> 13;
    }
    return h1.toString(36) + (h2 >>> 0).toString(36);
  }
  function groupBy(list, fn) { const m = new Map(); for (const x of list) { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }
  function countBy(list, fn) { const m = new Map(); for (const x of list) { const k = fn(x); m.set(k, (m.get(k) || 0) + 1); } return m; }

  KR.util = { nfkc, trim, clean, normPartner, normDesc, parseDate, parseAmount, yen, monthOf, addMonths, monthEnd, dayDiff, addDays, median, hash, groupBy, countBy, pad };
  if (typeof module !== 'undefined' && module.exports) module.exports = KR;
})(typeof globalThis !== 'undefined' ? globalThis : this);

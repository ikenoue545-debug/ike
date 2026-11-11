// 記帳レビュー：保存（このブラウザの IndexedDB のみ）。会社ごとに別のレコードに分け、必ず会社IDを指定して読み書きする
(function (root) {
  'use strict';
  const KR = root.KR = root.KR || {};
  const DB_NAME = 'kicho-review', STORES = ['companies', 'data', 'reviews', 'settings'];
  let db = null;
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  function open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => { for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
      r.onsuccess = () => { db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  }
  const tx = (store, mode) => db.transaction(store, mode || 'readonly').objectStore(store);
  const get = (store, key) => req(tx(store).get(key));
  const put = (store, key, val) => req(tx(store, 'readwrite').put(val, key));
  const del = (store, key) => req(tx(store, 'readwrite').delete(key));
  const emptyData = () => ({ imports: [], lines: [], seq: 0, statements: {}, runs: {}, changedAt: '' });

  const api = {
    open,
    listCompanies: () => req(tx('companies').getAll()).then(l => l.sort((a, b) => a.name.localeCompare(b.name, 'ja'))),
    getCompany: id => get('companies', id),
    saveCompany: c => put('companies', c.id, c),
    getData: id => get('data', id).then(d => d || emptyData()),
    saveData: (id, d) => put('data', id, d),
    getReview: id => get('reviews', id).then(r => r || KR.review.emptyReview()),
    saveReview: (id, r) => put('reviews', id, r),
    getSetting: k => get('settings', k),
    setSetting: (k, v) => put('settings', k, v),
    // 会社の削除：設定・取込データ・確認結果をまとめて消す
    deleteCompany: id => Promise.all([del('companies', id), del('data', id), del('reviews', id)]),
    deleteAll: () => { if (db) db.close(); db = null; return req(indexedDB.deleteDatabase(DB_NAME)).then(open); },
    exportCompany: async id => ({ format: 'kicho-review-backup', version: 1, exportedAt: new Date().toISOString(), company: await api.getCompany(id), data: await api.getData(id), review: await api.getReview(id) }),
    importBackup: async b => {
      if (!b || b.format !== 'kicho-review-backup' || !b.company || !b.company.id) throw new Error('記帳レビューのバックアップファイルではありません');
      await api.saveCompany(b.company); await api.saveData(b.company.id, b.data || emptyData()); await api.saveReview(b.company.id, b.review || KR.review.emptyReview());
      return b.company.id;
    },
    emptyData,
  };
  KR.store = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

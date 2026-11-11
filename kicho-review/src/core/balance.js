// 記帳レビュー：残高・月次推移のチェック。checks.runReview の最後に呼ばれる
// 残高は「取込開始時点の残高（会社ルール or 月次推移BSのCSV）＋仕訳の増減」で計算する。開始時点の残高が分からないものは断定しない
(function (root) {
  'use strict';
  const KR = root.KR = root.KR || {};
  const U = KR.util, M = KR.model;
  const WATCH = [
    { re: /^(売掛金|未収入金|未収金|受取手形)/, what: '回収', docs: ['請求書・入金の記録（どの請求が未回収か）', '取引先への残高確認'] },
    { re: /^(買掛金|未払金|未払費用)/, what: '支払', docs: ['請求書・支払の記録（どの請求が未払か）', '取引先からの残高の通知'] },
    { re: /^(仮払金|立替金|前払金|前渡金|仮受金|預り金|前受金)/, what: '精算', docs: ['精算書・領収書', '相手先・内容が分かる資料'] },
  ];
  const OFFICER_RE = /役員.*(貸付金|借入金)|^(短期|長期)?貸付金.*役員/;
  const sev = (a, t) => Math.abs(a) >= t.high ? 'high' : Math.abs(a) >= t.mid ? 'mid' : 'low';
  const monthsBetween = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
  const signed = (p, side) => (p.side === side ? p.amount : -p.amount);

  function run(ctx) {
    const { company, entries, all, month, t, view, add, suppressed, notes, findings } = ctx, bs = ctx.bs || null;
    if (!entries.length) return;
    const mEnd = U.monthEnd(month), first = entries[0].date, firstM = first.slice(0, 7);
    const upto = all.filter(p => p.entry.date <= mEnd);
    const dataMonths = new Set(entries.map(e => e.month));
    const span = []; for (let m = firstM; m <= month; m = U.addMonths(m, 1)) span.push(m);
    const gaps = span.filter(m => !dataMonths.has(m));
    const byAcc = U.groupBy(upto, p => p.account);

    // ---- 取込開始時点の残高 ----
    const op = company.opening || { date: '', balances: [] }, opRows = (op.balances || []).filter(r => r.account && r.amount !== '' && r.amount != null);
    const opUsable = !!op.date && op.date <= first && op.date.slice(0, 7) === firstM;
    if (opRows.length && !opUsable) notes.push('会社ルールの「取込開始時点の残高」（基準日 ' + (op.date || '未入力') + '）は、取り込んだ仕訳の最初の月（' + firstM + '）と合わないため使っていません。基準日を仕訳の最初の月の初日にしてください。');
    const manual = opUsable ? opRows : [];
    const bsOpen = name => { if (!bs || !bs.balances[name]) return null; if (bs.months[0] === firstM) return bs.opening[name]; const v = bs.balances[name][U.addMonths(firstM, -1)]; return v == null ? null : v; };

    // ---- 滞留・マイナス残高 ----
    if (gaps.length) notes.push('残高の確認：取り込んだ仕訳に抜けている月（' + gaps.join('・') + '）があるため、滞留・マイナス残高は判定していません。');
    else {
      const names = new Set([...byAcc.keys()].concat(manual.map(r => r.account)).concat(bs ? Object.keys(bs.balances) : []));
      let unknownNeg = 0;
      for (const acc of names) {
        const w = WATCH.find(x => x.re.test(U.nfkc(acc))); if (!w) continue;
        const side = M.normalSide(acc), ps = byAcc.get(acc) || [], man = manual.filter(r => r.account === acc);
        // 取引先の空欄が1行でもある科目は、取引先別にすると相手が合わなくなるため科目全体で見る
        const perPartner = ps.length > 0 && ps.every(p => p.pkey) && man.every(r => U.clean(r.partner));
        const keys = new Map();
        const key = (pkey, label) => { if (!keys.has(pkey)) keys.set(pkey, { label, ps: [], opening: null }); return keys.get(pkey); };
        for (const p of ps) key(perPartner ? p.pkey : '', perPartner ? p.partner : '').ps.push(p);
        if (perPartner) { for (const k of keys.values()) k.opening = man.length ? 0 : null; for (const r of man) key(U.normPartner(r.partner), r.partner).opening = Number(r.amount); }
        else { const k = key('', ''), m0 = man.find(r => !U.clean(r.partner)), b = bsOpen(acc); k.opening = m0 ? Number(m0.amount) : (man.length ? man.reduce((s, r) => s + Number(r.amount), 0) : b); k.openSrc = m0 || man.length ? '会社ルール' : (b != null ? '月次推移BS' : null); }
        for (const [pkey, k] of keys) {
          const known = k.opening != null, name = acc + (perPartner ? ' ' + k.label : '（科目全体）');
          // 先入先出：減少は古い増加から順に消し込む（請求書単位のデータがないための仮定）
          const lots = []; let carry = 0;
          if (known && k.opening > 0) lots.push({ date: null, amount: k.opening }); else if (known) carry = -k.opening;
          for (const p of k.ps.slice().sort((a, b) => a.entry.date < b.entry.date ? -1 : a.entry.date > b.entry.date ? 1 : 0)) {
            let v = signed(p, side);
            if (v > 0) { const c = Math.min(carry, v); carry -= c; v -= c; if (v > 0) lots.push({ date: p.entry.date, amount: v, p }); }
            else { v = -v; while (v > 0 && lots.length) { const c = Math.min(lots[0].amount, v); lots[0].amount -= c; v -= c; if (!lots[0].amount) lots.shift(); } if (known) carry += v; }
          }
          const net = k.ps.reduce((s, p) => s + signed(p, side), 0), balance = known ? k.opening + net : null, remain = lots.reduce((s, l) => s + l.amount, 0);
          const age = l => l.date ? monthsBetween(l.date.slice(0, 7), month) : monthsBetween(firstM, month) + 1;
          const old = lots.filter(l => age(l) >= t.staleMonths), oldAmt = old.reduce((s, l) => s + l.amount, 0);
          const perMonth = span.slice(-6).map(m => { const x = k.ps.filter(p => p.entry.month === m); return m + ' 増 ' + U.yen(x.filter(p => p.side === side).reduce((s, p) => s + p.amount, 0)) + '／減 ' + U.yen(x.filter(p => p.side !== side).reduce((s, p) => s + p.amount, 0)); });
          const m = { partner: perPartner ? k.label : '', account: acc, amount: oldAmt, text: name };
          if (old.length && oldAmt >= t.mid) {
            const oldest = old[0];
            add({
              key: 'STALE|' + U.hash(acc + '|' + pkey + '|' + (oldest.date || 'open')), rolling: true, check: 'STALE', basis: 'data', severity: sev(oldAmt, t),
              title: '滞留の可能性：' + name + ' ' + U.yen(oldAmt) + '（' + (oldest.date ? oldest.date + ' の計上分から' : '取込開始前から') + '未' + w.what + '）', amount: oldAmt, partner: m.partner, account: acc, date: oldest.date || first,
              reason: name + ' のうち ' + U.yen(oldAmt) + ' が、' + t.staleMonths + 'か月以上' + w.what + 'されていません（古い計上から順に消し込んだ場合）。' + (known ? '対象月末の残高は ' + U.yen(balance) + ' です。' : '取込開始時点の残高が未登録のため、月末残高は確定していません（取込期間の未' + w.what + '額 ' + U.yen(remain) + '）。'),
              entries: old.filter(l => l.p).map(l => view(l.p.entry)), entriesLabel: '未' + w.what + 'とみられる計上（' + t.staleMonths + 'か月以上前）',
              calc: ['先入先出で消込：' + old.map(l => (l.date || '取込開始前（' + (k.openSrc || '会社ルール') + 'の残高）') + ' ' + U.yen(l.amount)).join('、'), '直近の月別の増減：' + perMonth.join('、'), known ? '月末残高 ＝ 開始時点 ' + U.yen(k.opening) + ' ＋ 増減 ' + U.yen(net) + ' ＝ ' + U.yen(balance) : '開始時点の残高：未登録'],
              inference: ['請求書単位のデータがないため、どの計上が未' + w.what + 'かは先入先出の仮定による推定です。実際には新しい分が残り、古い分は' + w.what + '済みの可能性があります。', w.what === '回収' ? '入金の遅れ、入金を別の取引先名・別の科目で登録、値引・相殺の未処理、売上の二重計上のいずれかの可能性があります。' : w.what === '支払' ? '支払の遅れ、支払を別の取引先名・費用科目で直接登録（二重計上）、計上の誤りのいずれかの可能性があります。' : '精算の漏れ、精算を別の科目で登録、相手先の付け間違いのいずれかの可能性があります。'],
              documents: w.docs.concat(['総勘定元帳（' + acc + '）']), nextAction: '元帳で計上と' + w.what + 'の対応を確認し、残っている理由を確かめてください。「売上資料との照合」に請求一覧を取り込むと、請求書単位で入金を確認できます。',
              fixNote: '残っている理由がデータからは分からないため、修正案は示していません。',
              question: (perPartner ? k.label + ' の' : '') + acc + ' ' + U.yen(oldAmt) + '（' + (oldest.date || '以前') + ' 計上分）について、' + w.what + 'の状況を教えてください。', match: m,
            });
          }
          if (known && balance < 0 && -balance >= t.min) {
            add({
              key: 'NEG|' + month + '|' + U.hash(acc + '|' + pkey), check: 'NEGBAL', basis: 'data', severity: sev(balance, t),
              title: 'マイナス残高：' + name + ' ' + U.yen(balance), amount: -balance, partner: m.partner, account: acc, date: mEnd,
              reason: name + ' の対象月末の残高が ' + U.yen(balance) + ' です（通常は' + (side === 'D' ? '借方' : '貸方') + 'に残る科目）。',
              entries: k.ps.filter(p => p.side !== side).slice(-3).map(p => view(p.entry)), entriesLabel: '直近の減少（最大3件）',
              calc: ['開始時点 ' + U.yen(k.opening) + '（' + (k.openSrc || '会社ルール' + (perPartner && !man.some(r => U.normPartner(r.partner) === pkey) ? '。この取引先は登録がないため0円とみなす' : '')) + '）＋ 増減 ' + U.yen(net) + ' ＝ ' + U.yen(balance), '直近の月別の増減：' + perMonth.join('、')],
              inference: [w.what === '回収' ? '入金に対応する売上の計上漏れ、過入金・二重入金、別の取引先の入金の付け間違い、開始時点の残高の登録漏れのいずれかの可能性があります。' : w.what === '支払' ? '支払に対応する仕入・経費の計上漏れ、二重払い、取引先の付け間違い、開始時点の残高の登録漏れのいずれかの可能性があります。' : '計上と精算の科目・相手先の食い違い、開始時点の残高の登録漏れの可能性があります。'],
              documents: w.docs.concat(['総勘定元帳（' + acc + '）']), nextAction: '減少（入金・支払・精算）に対応する計上があるかを確認してください。',
              fixNote: '原因がデータからは分からないため、修正案は示していません。', question: (perPartner ? k.label + ' の' : '') + acc + ' について、直近の' + (w.what === '回収' ? 'ご入金' : 'お支払い') + 'の内容（対象の請求）を教えてください。', match: Object.assign({}, m, { amount: -balance }),
            });
          } else if (!known && net < 0 && -net >= t.mid) unknownNeg++;
        }
      }
      if (unknownNeg) notes.push('取込期間の増減がマイナスの債権債務・仮勘定が ' + unknownNeg + '件ありますが、取込開始時点の残高が未登録のため、マイナス残高かどうかは判定していません（会社ルールで登録できます）。');
      notes.push('滞留の判定は、請求書単位のデータがないため「古い計上から順に消し込む」仮定による推定です。');
    }

    // ---- 役員貸付金・役員借入金の増減 ----
    for (const [acc, ps] of byAcc) {
      if (!OFFICER_RE.test(U.nfkc(acc))) continue;
      const side = M.normalSide(acc), cur = ps.filter(p => p.entry.month === month); if (!cur.length) continue;
      const inc = cur.filter(p => p.side === side).reduce((s, p) => s + p.amount, 0), dec = cur.filter(p => p.side !== side).reduce((s, p) => s + p.amount, 0);
      const man = manual.find(r => r.account === acc), o = man ? Number(man.amount) : bsOpen(acc), bal = (o != null && !gaps.length) ? o + ps.reduce((s, p) => s + signed(p, side), 0) : null, loan = /貸付/.test(acc);
      add({
        key: 'OFF|' + month + '|' + U.hash(acc), check: 'OFFICER', basis: 'evidence', severity: sev(Math.max(inc, dec), t),
        title: acc + 'の増減：増加 ' + U.yen(inc) + '／減少 ' + U.yen(dec) + (bal != null ? '（月末残高 ' + U.yen(bal) + '）' : ''), amount: Math.max(inc, dec), partner: '', account: acc, date: cur[0].entry.date,
        reason: '対象月に「' + acc + '」が動いています（増加 ' + U.yen(inc) + '、減少 ' + U.yen(dec) + '）。会社と役員の間の貸借は、契約・利息・返済の取決めの確認が必要になる取引です。',
        entries: cur.map(p => view(p.entry)),
        calc: ['直近の月別の増減：' + span.slice(-6).map(m => { const x = ps.filter(p => p.entry.month === m); return m + ' ' + U.yen(x.reduce((s, p) => s + signed(p, side), 0)); }).join('、'), bal != null ? '月末残高 ＝ 開始時点 ' + U.yen(o) + ' ＋ 増減' : '月末残高：開始時点の残高が未登録（または仕訳に抜けている月がある）ため計算していません'],
        inference: [loan ? '役員の個人的な支出の立替、仮払の未精算、資金の貸付のいずれかの可能性があります。貸付の場合、利息を受け取っていないと給与として課税される場合があります。' : '役員からの資金の借入、役員が立て替えた経費の計上、返済のいずれかの可能性があります。'],
        sources: loan ? [M.SOURCES.ta2606] : [],
        documents: ['金銭消費貸借契約書・返済予定', '取締役会・株主総会の議事録', '通帳（資金の移動）', '立替の場合は領収書'], nextAction: '取引の内容（貸付・借入・立替・返済）を確認し、契約と利息の取決めがあるかを確かめてください。',
        fixNote: '取引の内容がデータからは分からないため、修正案は示していません。', question: cur.map(p => p.entry.date + ' ' + U.yen(p.amount)).join('、') + ' の「' + acc + '」について、内容（貸付・借入・立替・返済の別）と、契約書の有無を教えてください。',
        match: { partner: '', account: acc, amount: Math.max(inc, dec), text: acc },
      });
    }

    // ---- 期首残高・当期増減・期末残高の整合性（月次推移BSのCSVがあるとき）----
    if (!bs) notes.push('残高の整合性（開始残高＋増減＝月末残高）：月次推移（貸借対照表）のCSVが取り込まれていないため判定していません。');
    else if (!bs.months.includes(month)) notes.push('残高の整合性：月次推移（貸借対照表）のCSVに対象月（' + month + '）の列がないため判定していません。');
    else {
      const earlier = [];
      for (const [acc, ps] of U.groupBy(all, p => p.account)) {
        const b = bs.balances[acc]; if (!b) continue;
        const rows = [];
        for (const m of span) {
          if (!bs.months.includes(m) || b[m] == null || !dataMonths.has(m)) continue;
          const prev = m === bs.months[0] ? bs.opening[acc] : b[U.addMonths(m, -1)]; if (prev == null) continue;
          rows.push({ m, prev, end: b[m], d: b[m] - prev, net: ps.filter(p => p.entry.month === m).reduce((s, p) => s + signed(p, 'D'), 0) });
        }
        if (!rows.length) continue;
        // 残高の向き（借方残・貸方残）は、合う月が多い方とする。どちらも合わなければ名前から推定
        const okD = rows.filter(r => r.d === r.net).length, okC = rows.filter(r => r.d === -r.net).length;
        const sgn = okD > okC ? 1 : okC > okD ? -1 : (M.normalSide(acc) === 'D' ? 1 : -1);
        for (const r of rows) {
          const diff = r.d - sgn * r.net; if (!diff) continue;
          if (r.m !== month) { earlier.push(acc + ' ' + r.m + '（差 ' + U.yen(diff) + '）'); continue; }
          add({
            key: 'INTEG|' + month + '|' + U.hash(acc), check: 'INTEG', basis: 'data', severity: sev(diff, t) === 'low' ? 'mid' : 'high',
            title: '残高の整合性：' + acc + ' 仕訳帳の増減と試算表の差 ' + U.yen(diff), amount: Math.abs(diff), partner: '', account: acc, date: mEnd,
            reason: '月次推移（貸借対照表）では「' + acc + '」が対象月に ' + U.yen(r.d) + ' 動いていますが、取り込んだ仕訳帳の増減は ' + U.yen(sgn * r.net) + ' で、' + U.yen(diff) + ' の差があります。',
            calc: ['試算表：前月末 ' + U.yen(r.prev) + ' → 対象月末 ' + U.yen(r.end) + '（増減 ' + U.yen(r.d) + '）', '仕訳帳：対象月の' + (sgn > 0 ? '借方−貸方' : '貸方−借方') + ' ＝ ' + U.yen(sgn * r.net), '差 ＝ ' + U.yen(r.d) + ' − ' + U.yen(sgn * r.net) + ' ＝ ' + U.yen(diff)],
            inference: ['仕訳帳CSVと月次推移CSVの出力した時点が違う（その間に登録・修正・削除があった）、仕訳帳CSVの出力条件（期間・絞込み）で一部が漏れている、のいずれかの可能性があります。', 'この差がある間は、この科目に関する他の指摘（重複・滞留など）も古いデータに基づいている可能性があります。'],
            documents: ['freee の総勘定元帳（' + acc + '、対象月）', '仕訳帳CSV・月次推移CSVの出力日時と条件'], nextAction: '仕訳帳CSVと月次推移CSVを同じ時点で出力し直して取り込み、レビューを再実行してください。差が残る場合は、元帳で差額と同じ金額の取引を探します。',
            fixNote: 'データの取り直しで解消するかを先に確認するため、修正案は示していません。', question: '（先方への質問は不要です。事務所内で、仕訳帳CSVと月次推移CSVを同じ時点で出力し直してください）', match: { partner: '', account: acc, amount: Math.abs(diff), text: acc },
          });
        }
      }
      if (earlier.length) notes.push('残高の整合性：対象月より前の月に、仕訳帳と試算表が合わない科目があります（' + earlier.slice(0, 8).join('、') + (earlier.length > 8 ? ' ほか' + (earlier.length - 8) + '件' : '') + '）。過去の月との比較は、この差の影響を受けている可能性があります。');
    }

    // ---- 月次の変動（前3か月・過去の範囲・前年同月との比較）と、売上の内訳に偏った変動 ----
    const prev3 = [1, 2, 3].map(k => U.addMonths(month, -k));
    if (!prev3.every(m => dataMonths.has(m))) { notes.push('月次の変動・売上の内訳：対象月の前3か月の仕訳がそろっていないため判定していません。'); return; }
    const priorM = [...dataMonths].filter(m => m < month).sort(), lastYear = U.addMonths(month, -12), hasLY = dataMonths.has(lastYear);
    if (!hasLY) notes.push('前年同月（' + lastYear + '）の仕訳が取り込まれていないため、前年同月比較は行っていません。季節による変動は、取込済みの月の範囲（' + priorM[0] + '〜）だけで見ています。');
    const pl = all.filter(p => p.kind === 'pl');
    const cls = new Map(); const clsOf = a => { if (!cls.has(a)) cls.set(a, M.plClass(company, a)); return cls.get(a); };
    const val = p => clsOf(p.account) === 'rev' ? signed(p, 'C') : signed(p, 'D');
    const series = (ps, m) => ps.filter(p => p.entry.month === m).reduce((s, p) => s + val(p), 0);
    const judge = (ps, ratio) => {
      const cur = series(ps, month), prior = priorM.map(m => series(ps, m)), med = U.median(prev3.map(m => series(ps, m))), delta = cur - med;
      const out = cur > Math.max(...prior) || cur < Math.min(...prior), ly = hasLY ? series(ps, lastYear) : null;
      const flag = Math.abs(delta) >= t.high && Math.abs(delta) >= Math.abs(med) * ratio && out;
      const seasonal = flag && ly != null && ly !== 0 && Math.abs(cur - ly) <= Math.abs(ly) * 0.2;
      return { cur, prior, med, delta, flag: flag && !seasonal, seasonal, ly };
    };
    const calcOf = j => ['対象月 ' + U.yen(j.cur) + '、前3か月の中央値 ' + U.yen(j.med) + '（差 ' + (j.delta > 0 ? '+' : '') + U.yen(j.delta) + '）', '取込済みの過去の月：' + priorM.slice(-6).map((m, i, a) => m + ' ' + U.yen(j.prior[j.prior.length - a.length + i])).join('、') + '（最小 ' + U.yen(Math.min(...j.prior)) + '〜最大 ' + U.yen(Math.max(...j.prior)) + '）', '前年同月：' + (j.ly != null ? U.yen(j.ly) : 'データなし'), '判定の条件：前3か月の中央値との差が ' + U.yen(t.high) + ' 以上、かつ過去の月の範囲の外'];
    const trend = (id, label, ps, ratio, isTotal) => {
      const j = judge(ps, ratio);
      if (j.seasonal) { suppressed.push({ check: 'TREND', text: label + '：前3か月とは差がありますが、前年同月（' + U.yen(j.ly) + '）と同程度のため、季節による変動とみなし指摘していません' }); return; }
      if (!j.flag) return;
      if (!isTotal) {
        const explained = findings.filter(f => ['RECUR', 'AMOUNT', 'ACCOUNT', 'DUP'].includes(f.check) && f.account === label).reduce((s, f) => s + f.amount, 0);
        if (explained >= Math.abs(j.delta) * 0.5) { suppressed.push({ check: 'TREND', text: label + '：前3か月の中央値との差 ' + U.yen(j.delta) + ' は、個別の指摘（計上漏れ・金額・科目・重複）で説明がつくため、月次の変動としては指摘していません' }); return; }
      }
      const cur = ps.filter(p => p.entry.month === month), by = [...U.groupBy(cur, p => p.partner || p.desc || '（取引先・摘要なし）')].map(([k, x]) => [k, x.reduce((s, p) => s + val(p), 0), x]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3);
      add({
        key: 'TREND|' + month + '|' + U.hash(id), check: 'TREND', basis: 'trend', severity: sev(j.delta, t) === 'high' ? 'mid' : 'low',
        title: '月次の変動：' + label + ' ' + U.yen(j.cur) + '（前3か月の中央値 ' + U.yen(j.med) + '、' + (j.delta > 0 ? '+' : '') + U.yen(j.delta) + '）', amount: Math.abs(j.delta), partner: '', account: label, date: mEnd,
        reason: label + ' の対象月の金額が、前3か月の中央値から ' + U.yen(Math.abs(j.delta)) + ' ' + (j.delta > 0 ? '増えて' : '減って') + 'おり、取込済みの過去の月の範囲も外れています。変動があること自体は誤りを意味しません。',
        entries: isTotal ? [] : by.flatMap(b => b[2]).slice(0, 5).map(p => view(p.entry)), entriesLabel: '対象月の主な取引（最大5件）',
        calc: calcOf(j).concat(isTotal ? [] : ['対象月の内訳（上位3）：' + (by.map(b => b[0] + ' ' + U.yen(b[1])).join('、') || 'なし')]),
        inference: ['季節による変動、事業の拡大・縮小、臨時の取引、計上月のずれ、計上漏れ・二重計上、科目の変更のいずれの可能性もあります。' + (hasLY ? '' : '前年同月のデータがないため、季節性は判断できていません。')],
        documents: ['総勘定元帳（' + (isTotal ? '該当する科目' : label) + '、対象月と前月）', '変動の理由が分かる資料（契約・請求書など）'], nextAction: '内訳を見て、変動の理由が説明できるかを確認してください。説明がつけば「問題なし」とし、理由をメモに残します。',
        fixNote: '変動だけでは誤りと判断できないため、修正案は示していません。', question: month.replace('-', '年') + '月の「' + label + '」が、これまでの月と比べて ' + U.yen(Math.abs(j.delta)) + ' ' + (j.delta > 0 ? '多く' : '少なく') + 'なっています。理由として思い当たることがあれば教えてください。',
        match: { partner: '', account: label, amount: Math.abs(j.delta), text: label },
      });
    };
    const rev = pl.filter(p => clsOf(p.account) === 'rev'), cogs = pl.filter(p => clsOf(p.account) === 'cogs'), exp = pl.filter(p => clsOf(p.account) === 'exp');
    trend('T:rev', '売上高の合計', rev, 0.3, true);
    if (cogs.length && rev.length) trend('T:gross', '粗利（売上高−売上原価）', rev.concat(cogs.map(p => Object.assign({}, p, { account: rev[0].account }))), 0.3, true);   // 原価を収益科目として扱う＝借方がマイナスになる
    else if (!cogs.length) notes.push('粗利：売上原価に当たる科目（仕入高など）が見当たらないため、粗利の比較は行っていません（科目の種類は会社ルールで変更できます）。');
    trend('T:exp', '経費の合計', exp, 0.3, true);
    for (const [acc, ps] of U.groupBy(pl, p => p.account)) trend('A:' + acc, acc, ps, 0.5, false);

    // 売上の内訳：ある区分だけが大きく減り、ほかは減っていないとき
    const revCur = rev.filter(p => p.entry.month === month || prev3.includes(p.entry.month));
    for (const [dim, label, fn] of [['partner', '取引先', p => p.partner], ['item', '品目', p => p.item], ['dept', '部門', p => p.dept]]) {
      if (!revCur.length || revCur.filter(p => fn(p)).length < revCur.length * 0.8) { if (dim === 'partner' && revCur.length) notes.push('売上の内訳（取引先別）：売上の仕訳の2割以上で取引先が空欄のため判定していません。'); continue; }
      const groups = U.groupBy(revCur, p => dim === 'partner' ? p.pkey : U.clean(fn(p)));
      for (const [g, ps] of groups) {
        if (!g) continue;
        const cur = series(ps, month), med = U.median(prev3.map(m => series(ps, m))), drop = med - cur;
        const others = revCur.filter(p => !ps.includes(p)), oCur = series(others, month), oMed = U.median(prev3.map(m => series(others, m)));
        if (!(med >= t.mid && cur < med * 0.5 && drop >= t.high && oCur >= oMed * 0.8)) continue;
        const name = fn(ps[0]);
        if (dim === 'partner' && cur === 0 && findings.some(f => f.check === 'RECUR' && U.normPartner(f.partner) === g)) continue;
        add({
          key: 'MIX|' + month + '|' + U.hash(dim + '|' + g), check: 'MIX', basis: 'trend', severity: sev(drop, t) === 'high' ? 'mid' : 'low',
          title: '売上の内訳の変動：' + label + '「' + name + '」 ' + U.yen(cur) + '（前3か月の中央値 ' + U.yen(med) + '）', amount: drop, partner: dim === 'partner' ? name : '', account: ps[0].account, date: mEnd,
          reason: label + '「' + name + '」の売上が、前3か月の中央値 ' + U.yen(med) + ' から ' + U.yen(cur) + ' に減っています。ほかの' + label + 'の売上（' + U.yen(oCur) + '、前3か月の中央値 ' + U.yen(oMed) + '）は同じようには減っていません。',
          entries: ps.filter(p => p.entry.month === month).map(p => view(p.entry)), comparison: { label: '前3か月のこの' + label + 'の売上', entries: ps.filter(p => p.entry.month !== month).sort((a, b) => a.entry.date < b.entry.date ? -1 : 1).map(p => view(p.entry)) },
          calc: [prev3.slice().reverse().map(m => m + ' ' + U.yen(series(ps, m))).join('、') + ' → 対象月 ' + U.yen(cur), '判定の条件：前3か月の中央値の半分未満、減少額 ' + U.yen(t.high) + ' 以上、ほかの' + label + 'は中央値の8割以上'],
          inference: ['取引の縮小・終了、請求月のずれ、計上漏れ、別の' + label + '・別の科目での計上のいずれかの可能性があります。'],
          documents: ['請求書の控え・売上の集計資料', '契約の状況が分かる資料'], nextAction: '対象月の請求の状況を確認してください。「売上資料との照合」に請求一覧を取り込むと、計上漏れを請求書単位で確認できます。',
          fixNote: '減少の理由がデータからは分からないため、修正案は示していません。', question: name + ' 向けの ' + month.replace('-', '年') + '月の売上が、これまでより少なくなっています（' + U.yen(med) + ' 前後 → ' + U.yen(cur) + '）。請求の状況を教えてください。',
          match: { partner: dim === 'partner' ? name : '', account: ps[0].account, amount: drop, text: name },
        });
      }
    }
  }

  KR.balance = { run };
  if (typeof module !== 'undefined' && module.exports) module.exports = KR;
})(typeof globalThis !== 'undefined' ? globalThis : this);

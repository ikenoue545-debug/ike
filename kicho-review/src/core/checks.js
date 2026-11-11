// 記帳レビュー：取引単位のチェック。すべて取り込んだデータだけから計算する（同じ入力なら同じ結果）
// 各指摘は、事実（facts・calc）と推測（inference）を別の欄に分けて持つ
(function (root) {
  'use strict';
  const KR = root.KR = root.KR || {};
  const U = KR.util, M = KR.model;

  function sev(amount, t) { const a = Math.abs(amount); return a >= t.high ? 'high' : a >= t.mid ? 'mid' : 'low'; }
  const bump = s => s === 'low' ? 'mid' : 'high';
  const who = p => p.partner || (p.desc ? '摘要「' + p.desc + '」' : '（取引先・摘要なし）');
  const sideName = s => s === 'D' ? '借方' : '貸方';
  function top(map) { let k = null, c = 0, n = 0; for (const [key, v] of map) { n += v; if (v > c) { c = v; k = key; } } return { key: k, count: c, total: n, share: n ? c / n : 0 }; }
  const pct = x => Math.round(x * 100) + '%';
  const distText = map => [...map].sort((a, b) => b[1] - a[1]).map(([k, v]) => (k || '（空欄）') + ' ' + v + '件').join('、');

  function runReview(company, lines, month, files) {
    const t = M.thresholds(company);
    const entries = M.buildEntries(company, lines);
    const all = entries.flatMap(e => e.postings);
    const mStart = month + '-01', mEnd = U.monthEnd(month);
    const cur = all.filter(p => p.entry.month === month);
    const prior = all.filter(p => p.entry.date < mStart);
    const dataMonths = new Set(entries.map(e => e.month));
    const prev3 = [1, 2, 3].map(k => U.addMonths(month, -k));
    const hasPrev3 = prev3.every(m => dataMonths.has(m));
    const view = e => M.entryView(e, files);
    const findings = [], suppressed = [], notes = [];
    const add = f => { f.month = month; f.entries = f.entries || []; f.comparison = f.comparison || null; f.calc = f.calc || []; f.inference = f.inference || []; f.sources = f.sources || []; f.fix = f.fix || null; findings.push(f); };
    const ruleFor = p => (company.partnerRules || []).find(r => r.partner && U.normPartner(r.partner) === p.pkey);
    const recurRules = company.recurring || [];
    const recurMatch = (r, p) => r.account === p.account && (!r.partner || U.normPartner(r.partner) === p.pkey) && (!r.keyword || U.nfkc(p.desc).includes(U.nfkc(r.keyword)));

    if (!cur.length) notes.push('対象月（' + month + '）の仕訳が取り込まれていません。');
    if (!hasPrev3) notes.push('対象月の前3か月（' + prev3.slice().reverse().join('・') + '）のうち、仕訳がない月があります。「定期取引の計上漏れ」の自動検出は行っていません（会社ルールに登録した定期取引だけを確認しています）。');
    if (!prior.length) notes.push('対象月より前の仕訳がないため、「過去傾向との違い」（勘定科目・税区分・金額）は判定していません。');
    if (!all.some(p => p.tax)) notes.push('税区分の列がない、またはすべて空欄のため、税区分のチェックは行っていません。');
    if (!all.some(p => p.pkey)) notes.push('取引先の列がない、またはすべて空欄のため、取引先ごとの比較は摘要を手がかりにした範囲に限られます。');
    notes.push('登録経路（自動登録ルール・明細同期・手入力など）は仕訳帳CSVに含まれないため取得していません。自動登録ルールに関する記述はすべて推測です。');
    notes.push('売掛金・買掛金などの滞留、期首・期末残高の整合性、前月・前年同月比較は、この版では行っていません（未対応事項を参照）。');

    // ---------- 1. 重複候補 ----------
    {
      const w = t.dateWindow;
      const cands = all.filter(p => p.kind !== 'fund' && !p.entry.isTransfer && Math.abs(p.amount) >= t.min && (p.pkey || p.dkey));
      const groups = U.groupBy(cands, p => [p.side, p.account, p.amount, p.pkey || 'D:' + p.dkey].join('|'));
      const seen = new Set();
      for (const [K, ps0] of groups) {
        // 1つの仕訳からは1つだけ
        const ps = [...new Map(ps0.map(p => [p.entry.id, p])).values()].sort((a, b) => a.entry.date < b.entry.date ? -1 : 1);
        if (ps.length < 2) continue;
        const clusters = []; let c = [ps[0]];
        for (let i = 1; i < ps.length; i++) { if (U.dayDiff(ps[i - 1].entry.date, ps[i].entry.date) <= w) c.push(ps[i]); else { clusters.push(c); c = [ps[i]]; } }
        clusters.push(c);
        for (const cl of clusters) {
          if (cl.length < 2 || !cl.some(p => p.entry.month === month)) continue;
          const id = cl.map(p => p.entry.id).sort().join(',');
          if (seen.has(id)) continue; seen.add(id);
          const p0 = cl[0], amount = Math.abs(p0.amount);
          const sameDay = cl.every(p => p.entry.date === p0.entry.date);
          const routes = new Set(cl.map(p => p.route)), sameRoute = routes.size === 1;
          const label = p0.account + ' ' + U.yen(amount) + ' ' + who(p0);
          if (!sameDay && sameRoute && (!p0.pkey || amount < t.mid)) { suppressed.push({ check: 'DUP', text: label + '：日付が違い決済経路が同じ' + (p0.pkey ? '少額の' : '（取引先なしの）') + '取引のため、重複候補にしていません（' + cl.map(p => p.entry.date).join('・') + '）' }); continue; }
          // 過去も同じ形（同じ内容が近い日付に同じ件数）で計上されているなら、その会社の通常の処理とみなす
          const hist = prev3.filter(m => clusters.some(o => o !== cl && o.length >= cl.length && o.every(p => p.entry.month === m)));
          if (hist.length >= 2) { suppressed.push({ check: 'DUP', text: label + '：' + hist.slice().reverse().join('・') + ' にも同じ内容が' + cl.length + '件ずつ計上されているため、通常の処理とみなし重複候補にしていません' }); continue; }
          const months = new Set(cl.map(p => p.entry.month));
          if (!sameDay && sameRoute && months.size === cl.length && prev3.filter(m => ps.filter(p => p.entry.month === m).length === 1).length >= 2) { suppressed.push({ check: 'DUP', text: label + '：毎月1件ずつ計上されている取引が月をまたいで近い日付になったもののため、重複候補にしていません' }); continue; }
          let s = sev(amount, t); if (sameDay && sameRoute) s = bump(s);
          const inference = [];
          if (!sameRoute) inference.push('相手科目が違うため（' + [...routes].join(' と ') + '）、同じ支払いを「明細の同期」と「手入力・請求書からの登録」で二重に計上した可能性があります。');
          else if (sameDay) inference.push('同じ内容を2回登録した、またはCSVを二重に取り込んだ可能性があります。同じ日に同額の取引が実際に複数あった可能性もあります。');
          inference.push('登録経路はCSVに含まれないため、どちらが元の登録かは判定できません。');
          add({
            key: 'DUP|' + U.hash(K + '|' + cl.map(p => p.entry.date).join(',')), check: 'DUP', basis: 'data', severity: s,
            title: '重複候補：' + label + '（' + cl.length + '件）', amount, partner: p0.partner, account: p0.account, date: cl.find(p => p.entry.month === month).entry.date,
            reason: sideName(p0.side) + '「' + p0.account + '」' + U.yen(amount) + '（' + who(p0) + '）が、' + (sameDay ? '同じ日（' + p0.entry.date + '）' : t.dateWindow + '日以内（' + cl.map(p => p.entry.date).join('・') + '）') + 'に' + cl.length + '件あります。',
            entries: cl.map(p => view(p.entry)),
            calc: ['一致の条件：' + sideName(p0.side) + '科目・金額・' + (p0.pkey ? '取引先' : '摘要（数字と記号を除いて比較）') + 'が同じ、日付の差が' + w + '日以内', '相手科目：' + cl.map(p => p.entry.date + ' ' + (p.route || '（なし）')).join(' ／ '), '過去3か月に同じ形の複数計上：' + (hist.length ? hist.join('・') : 'なし')],
            inference,
            documents: ['請求書・領収書（同じ請求が1件か複数件か）', sameRoute ? '通帳・カード明細（同額の引落しが実際に何回あるか）' : '通帳・カード明細と、未払金・現金で登録した取引の元資料'],
            nextAction: '証憑で実際の取引件数を確認してください。1件だけなら、決済の事実と合う側を残し、もう一方の取消を検討します。',
            fix: null, fixNote: 'どちらを残すかはデータだけでは判断できないため、修正案は示していません。',
            question: (p0.partner || 'お取引先') + ' への ' + U.yen(amount) + '（' + p0.account + '）が ' + cl.map(p => p.entry.date).join(' と ') + ' に計上されています。実際のお支払い（ご入金）は何回でしたでしょうか。請求書・領収書があればあわせてご共有ください。',
            match: { partner: p0.partner, account: p0.account, amount, text: p0.desc },
          });
        }
      }
    }

    // ---------- 2. 勘定科目・税区分の不一致 ----------
    {
      const keyOf = p => p.pkey ? 'P:' + p.pkey : (p.dkey.length >= 3 ? 'D:' + p.dkey : null);
      const accStat = new Map(), taxStat = new Map();
      const inc = (map, k, v) => { if (!map.has(k)) map.set(k, new Map()); const m = map.get(k); m.set(v, (m.get(v) || 0) + 1); };
      for (const p of prior) { if (p.kind !== 'pl') continue; const k = keyOf(p); if (!k) continue; inc(accStat, p.side + '|' + k, p.account); inc(taxStat, p.side + '|' + k + '|' + p.account, M.taxBase(p.tax)); }
      const devs = new Map();
      const push = (id, d, p) => { if (!devs.has(id)) devs.set(id, Object.assign(d, { ps: [] })); devs.get(id).ps.push(p); };
      for (const p of cur) {
        if (p.kind !== 'pl') continue; const k = keyOf(p); if (!k) continue;
        const r = p.pkey ? ruleFor(p) : null;
        const ruleAccounts = r && r.account ? r.account.split(/[、,]/).map(s => s.trim()).filter(Boolean) : null;
        if (ruleAccounts) {
          if (!ruleAccounts.includes(p.account)) push('ACCOUNT|R|' + k + '|' + p.account, { type: 'ACCOUNT', basis: 'rule', expected: ruleAccounts.join('、'), actual: p.account, ruleNote: r.note }, p);
        } else {
          const st = accStat.get(p.side + '|' + k);
          if (st) { const tp = top(st); if (tp.total >= 3 && tp.share >= 0.8 && tp.key !== p.account) push('ACCOUNT|T|' + k + '|' + p.account, { type: 'ACCOUNT', basis: 'trend', expected: tp.key, actual: p.account, stat: st, tp }, p); }
        }
        if (r && r.tax && (!ruleAccounts || ruleAccounts.includes(p.account))) {
          if (M.taxBase(r.tax) !== M.taxBase(p.tax)) push('TAX|R|' + k + '|' + p.account + '|' + p.tax, { type: 'TAX', basis: 'rule', expected: r.tax, actual: p.tax, ruleNote: r.note }, p);
        } else {
          const st = taxStat.get(p.side + '|' + k + '|' + p.account);
          if (st) { const tp = top(st); if (tp.total >= 3 && tp.share >= 0.8 && tp.key !== M.taxBase(p.tax)) push('TAX|T|' + k + '|' + p.account + '|' + p.tax, { type: 'TAX', basis: 'trend', expected: tp.key, actual: p.tax, stat: st, tp }, p); }
        }
      }
      for (const [id, d] of devs) {
        const p0 = d.ps[0], amount = d.ps.reduce((s, p) => s + Math.abs(p.amount), 0), isTax = d.type === 'TAX';
        const what = isTax ? '税区分' : '勘定科目', exp = d.expected || '（空欄）', act = d.actual || '（空欄）';
        const k = keyOf(p0), sideKey = p0.side + '|' + k;
        const refs = prior.filter(p => p.kind === 'pl' && p.side === p0.side && keyOf(p) === k && (!isTax || p.account === p0.account)).slice(-5);
        const inference = [];
        const sameDesc = d.ps.length >= 3 && new Set(d.ps.map(p => p.dkey)).size === 1;
        if (sameDesc) inference.push('同じ摘要の取引が' + d.ps.length + '件とも同じ処理になっているため、自動登録ルールの設定によって登録された可能性があります（登録経路はCSVに含まれないため未確認。freee の「自動登録ルール」で該当の条件を確認してください）。');
        if (!isTax) inference.push('過去と取引の内容が違う（別の種類の購入・サービス）ために科目が違う可能性もあります。'); else inference.push('取引の内容や請求書の記載（軽減税率・非課税・国外取引など）が過去と違う可能性もあります。');
        let s = sev(amount, t), impact = null;
        if (isTax) { impact = M.taxImpact(company, p0.side === 'C' ? 'sales' : 'purchase'); if (impact.affects === false) s = 'low'; }
        add({
          key: (isTax ? 'TAX|' : 'ACC|') + month + '|' + U.hash(id), check: d.type, basis: d.basis, severity: s,
          title: what + 'の不一致：' + who(p0) + (isTax ? '（' + p0.account + '）' : '') + ' ' + exp + ' → ' + act + (d.ps.length > 1 ? '（' + d.ps.length + '件）' : ''),
          amount, partner: p0.partner, account: p0.account, date: p0.entry.date,
          reason: d.basis === 'rule'
            ? '会社ルールでは ' + who(p0) + ' の' + what + 'は「' + exp + '」ですが、対象月は「' + act + '」で登録されています。'
            : who(p0) + ' の' + (isTax ? '「' + p0.account + '」の' : '') + what + 'は、過去 ' + d.tp.total + '件中 ' + d.tp.count + '件（' + pct(d.tp.share) + '）が「' + exp + '」ですが、対象月は「' + act + '」で登録されています。',
          entries: d.ps.map(p => view(p.entry)),
          comparison: { label: d.basis === 'rule' ? '会社ルール' + (d.ruleNote ? '（' + d.ruleNote + '）' : '') + '／過去の直近の処理' : '過去の直近の処理（最大5件）', entries: refs.map(p => view(p.entry)) },
          calc: d.basis === 'rule' ? ['会社ルール：' + who(p0) + ' → ' + what + '「' + exp + '」'] : ['過去の内訳（対象月より前、' + (p0.pkey ? '同じ取引先' : '同じ摘要') + '・' + sideName(p0.side) + (isTax ? '・同じ科目' : '') + '）：' + distText(d.stat), '判定の条件：過去3件以上、かつ最も多い' + what + 'が80%以上'].concat(isTax ? ['経過措置の控除割合（控80・控70など）の違いは、比較から除いています'] : []),
          inference, impact: impact ? impact.text : null, sources: impact ? impact.sources : [],
          documents: ['請求書・領収書（取引の内容' + (isTax ? '、税率・登録番号の記載' : '') + '）', '過去の同じ取引先の処理（総勘定元帳）'].concat(sameDesc ? ['freee の自動登録ルールの設定'] : []),
          nextAction: '証憑で取引の内容を確認し、過去と同じ内容か、今回だけ内容が違うのかを判断してください。' + (d.basis === 'trend' ? '今後この処理が正しい場合は、会社ルールに登録すると次回から指摘されません。' : ''),
          fix: { conditional: true, text: '取引の内容が過去と同じであれば、' + what + 'を「' + exp + '」に変更する' + (isTax && impact && impact.affects === false ? '（納付税額への影響はない見込み）' : '') + '。内容が違う場合は修正不要です。' },
          question: (p0.partner || '摘要「' + p0.desc + '」') + ' の ' + d.ps.map(p => p.entry.date + ' ' + U.yen(Math.abs(p.amount))).join('、') + ' について、取引の内容を教えてください（これまでは「' + exp + '」として処理しており、今回は内容が異なるかを確認したいためです）。',
          match: { partner: p0.partner, account: p0.account, amount, text: p0.desc },
        });
      }
    }

    // ---------- 3. 定期取引の計上漏れ・金額（会社ルール） ----------
    for (const r of recurRules) {
      if (!r.account) continue;
      const hits = cur.filter(p => recurMatch(r, p));
      const name = r.name || (r.account + (r.partner ? ' ' + r.partner : ''));
      const refs = prior.filter(p => recurMatch(r, p)).slice(-3);
      if (!hits.length) {
        add({
          key: 'RECR|' + month + '|' + r.id, check: 'RECUR', basis: 'rule', severity: sev(r.amount || t.mid, t),
          title: '定期取引の計上漏れ候補：' + name + (r.amount ? ' ' + U.yen(r.amount) : ''), amount: r.amount || 0, partner: r.partner || '', account: r.account, date: mEnd,
          reason: '会社ルールに登録された定期取引「' + name + '」に当たる仕訳が、対象月（' + month + '）にありません。',
          comparison: { label: '過去の計上（最大3件）', entries: refs.map(p => view(p.entry)) },
          calc: ['条件：科目「' + r.account + '」' + (r.partner ? '・取引先「' + r.partner + '」' : '') + (r.keyword ? '・摘要に「' + r.keyword + '」を含む' : ''), '対象月の該当件数：0件'],
          inference: ['支払日・計上日が翌月にずれている、対象月のデータが月末まで取り込まれていない、取引そのものが終了した、のいずれかの可能性があります。'],
          documents: ['通帳・カード明細（対象月の支払の有無）', '契約書・請求書'], nextAction: '対象月の支払・請求の有無を確認し、未計上なら登録、終了・変更なら会社ルールを更新してください。',
          fixNote: '計上が必要かどうかは資料の確認後に判断するため、修正案は示していません。',
          question: '毎月の「' + name + '」について、' + month.replace('-', '年') + '月分のお支払い（ご請求）は発生していますでしょうか。発生している場合は、日付と金額が分かる資料をご共有ください。',
          match: { partner: r.partner || '', account: r.account, amount: r.amount || 0, text: name },
        });
      } else if (r.amount) {
        const tol = Math.abs(r.amount) * (Number(r.tolerancePct) || 0) / 100;
        for (const p of hits) {
          const diff = Math.abs(p.amount) - r.amount;
          if (Math.abs(diff) <= tol) continue;
          add({
            key: 'AMTR|' + r.id + '|' + p.entry.date + '|' + p.amount, check: 'AMOUNT', basis: 'rule', severity: sev(Math.max(Math.abs(diff), t.mid), t),
            title: '金額が会社ルールの範囲外：' + name + ' ' + U.yen(Math.abs(p.amount)) + '（通常 ' + U.yen(r.amount) + '）', amount: Math.abs(p.amount), partner: p.partner, account: p.account, date: p.entry.date,
            reason: '定期取引「' + name + '」の金額が、会社ルールの許容範囲（' + U.yen(r.amount) + ' ± ' + (Number(r.tolerancePct) || 0) + '%）を外れています。',
            entries: [view(p.entry)], comparison: { label: '過去の計上（最大3件）', entries: refs.map(q => view(q.entry)) },
            calc: [U.yen(Math.abs(p.amount)) + ' − ' + U.yen(r.amount) + ' ＝ ' + (diff > 0 ? '+' : '') + U.yen(diff), '許容範囲：' + U.yen(r.amount - tol) + ' 〜 ' + U.yen(r.amount + tol)],
            inference: /役員報酬|役員給与/.test(r.account) ? ['役員報酬の改定であれば、改定の時期と決議（議事録）の確認が必要になる場合があります。金額の入力誤りの可能性もあります。'] : ['契約の改定、複数月分のまとめ払い、入力誤りのいずれかの可能性があります。'],
            documents: /役員報酬|役員給与|給料|給与/.test(r.account) ? ['給与台帳・賃金台帳', '株主総会・取締役会の議事録（改定の場合）'] : ['請求書・契約書'],
            nextAction: '金額が変わった理由を確認してください。改定の場合は会社ルールの金額を更新します。',
            fixNote: '正しい金額はデータだけでは判断できないため、修正案は示していません。',
            question: '「' + name + '」の ' + p.entry.date + ' の金額が ' + U.yen(Math.abs(p.amount)) + '（これまでは ' + U.yen(r.amount) + '）となっています。変更の理由（改定・まとめ払い等）を教えてください。',
            match: { partner: p.partner, account: p.account, amount: Math.abs(p.amount), text: p.desc },
          });
        }
      }
    }

    // ---------- 4. 定期取引の計上漏れ（過去3か月から自動検出） ----------
    if (hasPrev3) {
      const rk = p => p.side + '|' + p.account + '|' + (p.pkey ? 'P:' + p.pkey : 'D:' + p.dkey);
      const usable = p => (p.kind === 'pl' || (p.kind === 'bs' && p.pkey)) && !p.entry.isTransfer;
      const byKey = U.groupBy(all.filter(p => usable(p) && (p.entry.month === month || prev3.includes(p.entry.month))), rk);
      const missing = [];
      for (const [k, ps] of byKey) {
        if (ps.some(p => p.entry.month === month)) continue;
        const perMonth = prev3.map(m => ps.filter(p => p.entry.month === m));
        if (perMonth.some(x => !x.length)) continue;
        const p0 = perMonth[0][0];
        if (recurRules.some(r => recurMatch(r, p0))) continue;
        const sums = perMonth.map(x => x.reduce((s, p) => s + Math.abs(p.amount), 0)), med = U.median(sums);
        const stable = Math.max(...sums) <= Math.min(...sums) * 1.2;
        if (med < t.min || (!stable && med < t.mid) || (!p0.pkey && !stable)) continue;
        missing.push({ k, ps, p0, sums, med, stable, last: perMonth[0] });
      }
      const plEntryIds = new Set(missing.filter(x => x.p0.kind === 'pl').flatMap(x => x.last.map(p => p.entry.id)));
      for (const x of missing) {
        const p0 = x.p0;
        // 同じ仕訳の相手側（未払金など）で二重に出さない
        if (p0.kind === 'bs' && x.last.every(p => plEntryIds.has(p.entry.id))) continue;
        // 同じ取引先（摘要）が対象月は別の科目で計上されているなら、漏れではなく「勘定科目の不一致」の側で扱う
        const moved = cur.filter(p => p.kind === 'pl' && p.side === p0.side && p.account !== p0.account && (p0.pkey ? p.pkey === p0.pkey : (!p.pkey && p.dkey === p0.dkey)));
        if (moved.length && moved.reduce((s, p) => s + Math.abs(p.amount), 0) >= x.med * 0.5) { suppressed.push({ check: 'RECUR', text: p0.account + ' ' + who(p0) + '：対象月は別の科目（' + [...new Set(moved.map(p => p.account))].join('・') + '）で計上されているため、計上漏れ候補にしていません（勘定科目の不一致を参照）' }); continue; }
        const similar = cur.filter(p => p.side === p0.side && p.account === p0.account && Math.abs(Math.abs(p.amount) - x.med) <= x.med * 0.1);
        const lastMonthCount = x.ps.filter(p => p.entry.month === prev3[0]).length, usual = x.ps.filter(p => p.entry.month === prev3[1]).length;
        const inference = ['支払日・計上日が翌月にずれている、対象月のデータが月末まで取り込まれていない、取引が終了した、のいずれかの可能性があります。'];
        if (lastMonthCount > usual) inference.push('前月（' + prev3[0] + '）は' + lastMonthCount + '件（その前の月は' + usual + '件）計上されています。対象月の分が前月に計上されている可能性があります。');
        if (similar.length) inference.push('対象月に、同じ科目で近い金額の取引があります（取引先・摘要が違うもの）。同じ取引が別の取引先名・摘要で登録された可能性があります。');
        add({
          key: 'REC|' + month + '|' + U.hash(x.k), check: 'RECUR', basis: 'trend', severity: similar.length ? 'low' : sev(x.med, t),
          title: '定期取引の計上漏れ候補：' + p0.account + ' ' + who(p0) + '（月 ' + U.yen(x.med) + ' 前後）', amount: x.med, partner: p0.partner, account: p0.account, date: mEnd,
          reason: sideName(p0.side) + '「' + p0.account + '」（' + who(p0) + '）は、前3か月（' + prev3.slice().reverse().join('・') + '）は毎月計上されていますが、対象月（' + month + '）にはありません。',
          entries: similar.map(p => view(p.entry)), entriesLabel: similar.length ? '対象月の、同じ科目で近い金額の取引（同一取引か要確認）' : null,
          comparison: { label: '前3か月の計上', entries: x.ps.filter(p => p.entry.month !== month).sort((a, b) => a.entry.date < b.entry.date ? -1 : 1).map(p => view(p.entry)) },
          calc: ['前3か月の月合計：' + prev3.slice().reverse().map((m, i) => m + ' ' + U.yen(x.sums[2 - i])).join('、') + '（中央値 ' + U.yen(x.med) + '）', '対象月の該当件数：0件（' + (p0.pkey ? '同じ取引先' : '同じ摘要') + '・同じ科目）'],
          inference, documents: ['通帳・カード明細（対象月の支払・入金の有無）', '請求書・契約書・給与資料など、この取引の元資料'],
          nextAction: '対象月に発生しているかを確認し、未計上なら登録してください。毎月発生する取引なら、会社ルールの「定期取引」に登録すると金額の範囲も確認できます。',
          fixNote: '計上が必要かどうかは資料の確認後に判断するため、修正案は示していません。',
          question: '毎月計上している「' + p0.account + '」（' + who(p0) + '、月 ' + U.yen(x.med) + ' 前後）について、' + month.replace('-', '年') + '月分は発生していますでしょうか。発生している場合は、日付と金額が分かる資料をご共有ください。',
          match: { partner: p0.partner, account: p0.account, amount: x.med, text: p0.desc },
        });
      }
    }

    // ---------- 5. 通常と異なる金額（過去傾向） ----------
    {
      const key = p => p.side + '|' + p.account + '|' + p.pkey;
      const hist = U.groupBy(prior.filter(p => p.kind === 'pl' && p.pkey), key);
      for (const p of cur) {
        if (p.kind !== 'pl' || !p.pkey || recurRules.some(r => recurMatch(r, p))) continue;
        const h = hist.get(key(p)); if (!h || h.length < 4) continue;
        const amts = h.map(q => Math.abs(q.amount)), a = Math.abs(p.amount), med = U.median(amts), max = Math.max(...amts), min = Math.min(...amts);
        const fixed = max === min;
        const flag = fixed ? a !== med && Math.abs(a - med) >= t.min : (a > max * 1.5 && a > med * 2 && a - med >= t.mid);
        if (!flag) continue;
        const ratio = a / med, inference = [];
        if (ratio > 9.5 && ratio < 10.5) inference.push('過去の金額のほぼ10倍のため、桁の入力誤りの可能性があります。');
        inference.push('年払い・複数月分のまとめ払い・契約の変更・臨時の取引の可能性があります。');
        add({
          key: 'AMT|' + U.hash(key(p) + '|' + p.entry.date + '|' + p.amount), check: 'AMOUNT', basis: 'trend', severity: sev(Math.abs(a - med), t),
          title: '通常と異なる金額：' + p.account + ' ' + who(p) + ' ' + U.yen(a) + '（過去の中央値 ' + U.yen(med) + '）', amount: a, partner: p.partner, account: p.account, date: p.entry.date,
          reason: who(p) + ' の「' + p.account + '」は、過去 ' + h.length + '件が ' + (fixed ? 'すべて ' + U.yen(med) : U.yen(min) + ' 〜 ' + U.yen(max)) + ' ですが、' + p.entry.date + ' は ' + U.yen(a) + ' です。',
          entries: [view(p.entry)], comparison: { label: '過去の直近の計上（最大5件）', entries: h.slice(-5).map(q => view(q.entry)) },
          calc: ['過去 ' + h.length + '件：最小 ' + U.yen(min) + '、中央値 ' + U.yen(med) + '、最大 ' + U.yen(max), '今回 ÷ 中央値 ＝ ' + ratio.toFixed(2) + '倍', '判定の条件：' + (fixed ? '過去がすべて同額で、今回だけ違う' : '過去の最大の1.5倍を超え、かつ中央値の2倍を超える')],
          inference, documents: ['請求書・領収書（請求金額・対象期間）', '通帳・カード明細（実際の決済額）'],
          nextAction: '請求書と決済額を照合してください。まとめ払いなら、期間按分（前払費用など）が必要かも検討します。',
          fixNote: '正しい金額はデータだけでは判断できないため、修正案は示していません。',
          question: (p.partner || '') + ' への ' + p.entry.date + ' の ' + U.yen(a) + ' について、請求書をご共有ください（これまでは ' + U.yen(med) + ' 前後のため、内容を確認したいものです）。',
          match: { partner: p.partner, account: p.account, amount: a, text: p.desc },
        });
      }
    }

    // ---------- 6. 摘要・取引先の不足 ----------
    {
      const ps = cur.filter(p => p.kind === 'pl' && !p.pkey && !U.clean(p.desc) && !U.clean(p.note) && Math.abs(p.amount) >= t.mid);
      if (ps.length) {
        const amount = ps.reduce((s, p) => s + Math.abs(p.amount), 0), mx = Math.max(...ps.map(p => Math.abs(p.amount)));
        add({
          key: 'DESC|' + month, check: 'DESC', basis: 'evidence', severity: sev(mx, t) === 'high' ? 'mid' : 'low',
          title: '摘要・取引先のない取引：' + ps.length + '件（合計 ' + U.yen(amount) + '）', amount, partner: '', account: [...new Set(ps.map(p => p.account))].join('・'), date: ps[0].entry.date,
          reason: '取引先・摘要・備考がすべて空欄の損益科目の取引が ' + ps.length + '件あります（' + U.yen(t.mid) + ' 以上）。内容を確認できないため、他のチェック（重複・科目の一貫性）の対象にもなっていません。',
          entries: ps.map(p => view(p.entry)), calc: ['条件：損益科目、取引先・摘要・備考が空欄、金額 ' + U.yen(t.mid) + ' 以上'],
          documents: ['領収書・請求書', '通帳・カード明細の摘要'], nextAction: '証憑で内容を確認し、取引先と摘要を補ってください。',
          fixNote: '内容が分からないため、修正案は示していません。',
          question: '次の取引の内容（支払先・目的）を教えてください：' + ps.map(p => p.entry.date + ' ' + p.account + ' ' + U.yen(Math.abs(p.amount))).join('、'),
          match: { partner: '', account: ps[0].account, amount, text: '' },
        });
      }
    }

    // ---------- 7. 税区分と制度の適用時期（インボイス経過措置の控除割合） ----------
    {
      const st = (company.tax && company.tax.status) || 'unknown';
      const ps = cur.filter(p => M.ratioInTax(p.tax) != null);
      if (ps.length && (st === 'exempt' || st === 'simplified' || st === 'special20')) notes.push('経過措置の控除割合（控80・控70など）の税区分が ' + ps.length + '件ありますが、この会社は' + M.TAX_STATUS[st] + 'として登録されているため、適用時期のチェックは行っていません（納付税額に影響しないため）。');
      else for (const p of ps) {
        const used = M.ratioInTax(p.tax), exp = M.invoiceRatioOn(p.entry.date);
        if (exp == null || used === exp) continue;
        const a = Math.abs(p.amount);
        add({
          key: 'TXR|' + U.hash([p.entry.date, p.account, p.amount, p.pkey, p.tax].join('|')), check: 'TAXRULE', basis: 'rule', severity: st === 'general' ? sev(a, t) : 'low',
          title: '経過措置の控除割合と取引日：' + who(p) + ' ' + U.yen(a) + '（税区分「' + p.tax + '」、取引日 ' + p.entry.date + '）', amount: a, partner: p.partner, account: p.account, date: p.entry.date,
          reason: '税区分は控除割合 ' + used + '% ですが、取引日 ' + p.entry.date + ' の時点の経過措置の控除割合は ' + (exp ? exp + '%' : 'なし（経過措置の終了後）') + ' です。',
          entries: [view(p.entry)],
          calc: ['経過措置の控除割合：' + M.INVOICE_RATIO.map(r => r.from + '〜' + r.to + ' ' + r.pct + '%').join('、') + '、2031-10-01以後 なし', '仕訳の取引日 ' + p.entry.date + ' → ' + (exp ? exp + '%' : 'なし') + '、税区分の表記 → ' + used + '%'],
          inference: ['控除割合は「課税仕入れを行った日」（商品の引渡し・役務の完了の日）で決まります。仕訳の日付が支払日・請求日の場合、実際の仕入れの日が切替日より前で、この税区分が正しい可能性があります。', '自動登録ルールや前月の仕訳の複製で、以前の税区分がそのまま使われた可能性があります（登録経路は未確認）。'],
          impact: st === 'general' ? 'この会社は本則課税として登録されているため、控除できる税額が変わります。' : '会社の消費税の処理方針が未登録のため、納付税額への影響は判定していません。',
          sources: [M.SOURCES.invoiceReview, M.SOURCES.ta6498],
          documents: ['請求書・納品書（役務の提供日・納品日）', '取引先の登録番号の有無（適格請求書発行事業者公表サイト）'],
          nextAction: '請求書で「課税仕入れを行った日」を確認し、切替日（2026-10-01 など）以後であれば税区分の変更を検討してください。',
          fix: exp ? { conditional: true, text: '課税仕入れを行った日が ' + M.INVOICE_RATIO.find(r => r.pct === exp).from + ' 以後であれば、税区分を控除割合 ' + exp + '% のものに変更する。それより前の仕入れであれば修正不要です。' } : null,
          question: (p.partner || '') + ' の ' + p.entry.date + ' ' + U.yen(a) + ' について、作業の完了日（納品日）が分かる請求書・納品書をご共有ください。',
          match: { partner: p.partner, account: p.account, amount: a, text: p.desc },
        });
      }
    }

    // ---------- 8. 現金残高のマイナス ----------
    {
      const cash = all.filter(p => /^(現金|小口現金)$/.test(U.nfkc(p.account)));
      if (cash.length) {
        const op = company.cashOpening || {}, hasOpen = !!(op.date && op.amount != null && op.amount !== '');
        const firstData = entries[0].date, start = hasOpen ? op.date : firstData;
        const need = []; for (let m = start.slice(0, 7); m <= month; m = U.addMonths(m, 1)) need.push(m);
        const gaps = need.filter(m => !dataMonths.has(m));
        if (hasOpen && (gaps.length || firstData > U.monthEnd(op.date.slice(0, 7)))) notes.push('現金残高：期首残高の基準日（' + op.date + '）から対象月までの仕訳に、取り込まれていない月があります（' + (gaps.join('・') || op.date.slice(0, 7)) + '）。残高は計算できないため判定していません。');
        else {
          const days = U.groupBy(cash.filter(p => p.entry.date >= start && p.entry.date <= mEnd), p => p.entry.date);
          let bal = hasOpen ? Number(op.amount) : 0, worst = null; const neg = [];
          for (const d of [...days.keys()].sort()) {
            const net = days.get(d).reduce((s, p) => s + (p.side === 'D' ? p.amount : -p.amount), 0);
            bal += net;
            if (d >= mStart && bal < 0) { neg.push({ date: d, balance: bal, net }); if (!worst || bal < worst.balance) worst = { date: d, balance: bal, ps: days.get(d) }; }
          }
          if (worst) {
            const w = Math.abs(worst.balance);
            add({
              key: 'CASH|' + month, check: 'CASH', basis: hasOpen ? 'data' : 'evidence', severity: hasOpen ? bump(sev(w, t)) : sev(w, t),
              title: hasOpen ? '現金残高がマイナス：' + worst.date + ' に ' + U.yen(worst.balance) + '（' + neg.length + '日）' : '現金残高の確認：期首残高が ' + U.yen(w) + ' 以上ないとマイナスになります', amount: w, partner: '', account: '現金', date: worst.date,
              reason: hasOpen ? '会社ルールの期首残高（' + op.date + ' 時点 ' + U.yen(Number(op.amount)) + '）から日ごとに計算すると、対象月の ' + neg.length + '日で現金残高がマイナスになります。' : '現金の期首残高が登録されていないため残高は確定できませんが、取込済みの期間（' + firstData + ' 以降）の増減だけで、対象月に最大 ' + U.yen(w) + ' のマイナスになります。',
              entries: worst.ps.map(p => view(p.entry)), entriesLabel: '最もマイナスが大きい日（' + worst.date + '）の現金の取引',
              calc: [(hasOpen ? '期首残高 ' + U.yen(Number(op.amount)) + '（' + op.date + '）' : '期首残高 0円と仮定（未登録）') + ' ＋ ' + start + ' 以降の日ごとの増減'].concat(neg.slice(0, 10).map(n => n.date + '：当日の増減 ' + U.yen(n.net) + ' → 残高 ' + U.yen(n.balance))).concat(neg.length > 10 ? ['（ほか ' + (neg.length - 10) + '日）'] : []),
              inference: ['現金での支払として登録した取引が、実際は個人の立替・カード・口座振替だった、預金からの引出しや売上の入金が未計上、日付の前後、のいずれかの可能性があります。'],
              documents: ['現金出納帳・レジの記録', '通帳（現金の引出し）', '領収書（支払方法）'], nextAction: hasOpen ? 'マイナスになる日の前後の取引について、支払方法と日付を確認してください。' : '現金の期首残高（基準日と金額）を会社ルールに登録すると、残高を確定して判定できます。あわせて、マイナスになる日の前後の取引を確認してください。',
              fixNote: 'どの取引に原因があるかはデータだけでは判断できないため、修正案は示していません。',
              question: worst.date + ' 前後の現金でのお支払いについて、実際の支払方法（現金・個人の立替・カード等）を教えてください。現金出納帳があればあわせてご共有ください。',
              match: { partner: '', account: '現金', amount: w, text: '' },
            });
          }
        }
      }
    }

    const order = { high: 0, mid: 1, low: 2 };
    findings.sort((a, b) => order[a.severity] - order[b.severity] || b.amount - a.amount || (a.key < b.key ? -1 : 1));
    return { month, findings, suppressed, notes, stats: { entries: entries.filter(e => e.month === month).length, lines: lines.filter(l => l.date.slice(0, 7) === month).length, priorMonths: [...dataMonths].filter(m => m < month).sort() } };
  }

  KR.checks = { runReview };
  if (typeof module !== 'undefined' && module.exports) module.exports = KR;
})(typeof globalThis !== 'undefined' ? globalThis : this);

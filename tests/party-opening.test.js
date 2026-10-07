// node --test tests/party-opening.test.js
// 過去の仕訳帳からの取引先別期首の推定（ReviewPartyOpening）を、架空データの「正解」と照合する。
// 正解（tests/make-fixtures.js）：2025年12月末の売掛金 ブルースカイ 900,000・レッドストーン 220,000（2025年8月分が未回収）、
// 買掛金 ミドリ印刷 165,000・クロダ製版 55,000（2025年10月分が未払い）、未払金 オフィスサプライ 44,000。
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const H=require('./harness.js');
const ctx=H.load(),E=ctx.ReviewEngine;
const analyze=s=>E.analyze(s);
const po=r=>r.financial.partyOpening;
const acct=(r,a)=>po(r).accounts.find(x=>x.account===a);
const party=(r,a,label)=>acct(r,a).parties.find(p=>p.label===label);
const fresh=(o)=>H.session(ctx,o);
// vm の中で作られた値は、JSON を通して普通の値にしてから比べる
const plain=v=>JSON.parse(JSON.stringify(v));

test('売掛金・買掛金・未払金の取引先別期首が正解と一致し、BSの期首とも一致する',()=>{
 const r=analyze(fresh());
 const ar=acct(r,'売掛金'),ap=acct(r,'買掛金'),ac=acct(r,'未払金');
 assert.deepEqual(plain(po(r).window),{start:'2025-01',end:'2025-12',months:12,stopMonth:'2024-12',stopReason:'仕訳が読み込まれていません。'});
 for(const a of [ar,ap,ac]){assert.equal(a.status,'matched',a.account);assert.equal(a.residual,0);assert.equal(a.confidence,a.matches.length?'中':'高',a.account+'：未選択の金額一致を使う推定は確からしさを下げる');assert.equal(a.closingResidual,0,'当期末の取引先別残高の合計もBSと一致');}
 assert.ok(ar.matches.length>0&&ap.matches.length===0,'売掛金はグリーンリーフの未選択入金を金額一致で当てている');
 assert.equal(party(r,'売掛金','(株)ブルースカイ').opening,900000);
 assert.equal(party(r,'売掛金','(株)レッドストーン').opening,220000);
 assert.equal(party(r,'売掛金','合同会社グリーンリーフ').opening,0,'取引先が未選択の入金を金額一致で当てる');
 assert.equal(party(r,'買掛金','(株)ミドリ印刷').opening,165000,'期首直後の支払は読込範囲より前の仕入の分とみなす');
 assert.equal(party(r,'買掛金','(有)クロダ製版').opening,55000);
 assert.equal(party(r,'未払金','(株)オフィスサプライ').opening,44000);
 assert.equal(party(r,'売掛金','(株)ブルースカイ').preWindow,850000);
 assert.equal(ar.matches.length,1);assert.equal(ar.matches[0].label,'合同会社グリーンリーフ');assert.equal(ar.matches[0].amount,447540);
});
test('回収・支払が止まっている取引先を見つけ、ふだんの取引先は通常の範囲とする',()=>{
 const r=analyze(fresh());
 const red=party(r,'売掛金','(株)レッドストーン'),kuro=party(r,'買掛金','(有)クロダ製版'),blue=party(r,'売掛金','(株)ブルースカイ');
 assert.equal(red.status,'long');assert.equal(red.statusLabel,'長く未回収の可能性');assert.equal(red.oldestDate,'2025-08-28');assert.equal(red.closing,220000);
 assert.equal(kuro.status,'long');assert.equal(kuro.oldestDate,'2025-10-15');
 assert.equal(blue.status,'normal');assert.ok(blue.major);assert.ok(blue.share>0.6);
 assert.ok(Math.abs(blue.lagMedian-28)<=3,'ふだんの回収日数は約1か月');
 const alerts=plain(po(r).alerts.map(a=>a.label));assert.deepEqual(alerts.sort(),['(有)クロダ製版','(株)レッドストーン'].sort());
 assert.match(po(r).alerts.find(a=>a.label==='(株)レッドストーン').text,/2025-08-28の請求・売上 220,000円がまだ回収されていない可能性/);
});
test('確認キューに、科目ごとの候補として出る',()=>{
 const r=analyze(fresh());
 const fs_=r.findings.filter(f=>f.partyOpeningCheck);
 assert.equal(fs_.length,2);
 assert.ok(fs_.some(f=>/売掛金：回収が止まっている可能性のある取引先/.test(f.title)&&f.amount===220000));
});
test('BSの取引先別内訳（参考推計）は推定期首から繰り越し、帳票の残高と一致する',()=>{
 const s=fresh(),r=analyze(s),V=ctx.ReviewVariance;
 for(const a of ['売掛金','買掛金','未払金']){
  const t=V.tagRows(s,r,'monthlyBS',a,'party','estimate');
  assert.equal(t.mode,'estimated',a);assert.equal(t.hasDiff,false,a);assert.equal(t.opening,0,a+'：未配賦なし');
 }
 const t=V.tagRows(s,r,'monthlyBS','売掛金','party','estimate');
 assert.equal(t.rows.find(x=>x.label==='(株)レッドストーン').values['2026-09'],220000,'当期に動きのない取引先も表示する');
});
test('過去の仕訳帳がないと推定しない',()=>{
 const r=analyze(fresh({prior:false}));
 for(const a of po(r).accounts){assert.equal(a.status,'no_history');assert.equal(a.residual,null);}
 assert.equal(po(r).alerts.length,0);
 assert.ok(po(r).accounts[0].parties.every(p=>p.status==='unknown'));
});
test('期首の前月までの仕訳が途切れていると推定しない（gap）',()=>{
 const s=fresh();s.datasets.prior=s.datasets.prior.filter(x=>x.date<'2025-11-01');
 const r=analyze(s);
 assert.equal(po(r).window.start,null);
 for(const a of po(r).accounts)assert.equal(a.status,'gap');
});
test('読込範囲が短いと、範囲より前からの残高は「内訳不明」に残る',()=>{
 const s=fresh();s.datasets.prior=s.datasets.prior.filter(x=>x.date>='2025-09-01');
 const r=analyze(s),ar=acct(r,'売掛金');
 assert.equal(po(r).window.start,'2025-09');
 assert.equal(ar.status,'unexplained');assert.equal(ar.residual,220000,'2025年8月のレッドストーンの売上は読込範囲の外');
 assert.equal(ar.confidence,'中');
 assert.ok(!ar.parties.some(p=>p.label==='(株)レッドストーン'&&p.opening>0));
});
test('同じ過去の仕訳を別の名前で2回読み込むと、重なった月は使わない',()=>{
 const s=fresh(),dup=s.datasets.prior.filter(x=>x.date>='2025-12-01').map(x=>({...x,source:'copy.csv',importSource:'csv:copy',historySource:'hsrc:copy'}));
 s.datasets.prior=[...s.datasets.prior,...dup];
 const r=analyze(s);
 assert.equal(po(r).window.start,null,'期首の前月（2025-12）が重複で使えない');
});
test('参照から除外した過去資料は使わない',()=>{
 const s=fresh();const src=s.datasets.prior[0].historySource;s.history.sources[src]={name:'2025',status:'exclude',note:''};
 const r=analyze(s);
 assert.equal(po(r).window.start,null);
});
test('金額の一致しない未選択の入金は取引先に配分せず、推定が多い分を示す',()=>{
 const s=fresh();
 const i=s.datasets.prior.findIndex(x=>x.credit==='売掛金'&&!x.creditParty&&x.date==='2025-12-25');assert.ok(i>=0);
 s.datasets.prior[i]={...s.datasets.prior[i],debitAmount:400000,creditAmount:400000};
 // 預金の差額は別の入金とする（仕訳の借貸は一致させる）
 s.datasets.prior.push({...s.datasets.prior[i],id:'X1',journalId:'X1',line:9999,debit:'普通預金',credit:'雑収入',debitAmount:47540,creditAmount:47540,creditParty:'',debitParty:''});
 const r=analyze(s),ar=acct(r,'売掛金');
 assert.equal(ar.matches.length,0);
 const un=ar.parties.find(p=>p.untagged);assert.equal(un.opening,-400000);
 assert.equal(party(r,'売掛金','合同会社グリーンリーフ').opening,447540);
 assert.equal(ar.status,'over');assert.equal(ar.residual,-47540);
});
test('取引先内訳つきBSの期首がある取引先は、推定ではなく確定値を使う',()=>{
 const s=fresh(),fx=path.join(__dirname,'fixtures','monthly-bs-2026.csv');
 const lines=fs.readFileSync(fx,'utf8').replace(/^﻿/,'').trim().split(/\r?\n/);
 const head=lines[2].split(','),idx=lines.findIndex(l=>l.startsWith('売掛金,'));
 const withParty=[lines[0],lines[1],[head[0],'取引先',...head.slice(1)].join(','),...lines.slice(3).map(l=>{const c=l.split(',');return [c[0],'',...c.slice(1)].join(',');})];
 const blank=n=>Array(n).fill('').join(',');
 withParty.splice(idx+1,0,`売掛金,(株)ブルースカイ,900000,${blank(12)}`,`売掛金,(株)レッドストーン,220000,${blank(12)}`);
 const tmp=path.join(__dirname,'fixtures','.tmp-bs-party.csv');fs.writeFileSync(tmp,'﻿'+withParty.join('\r\n')+'\r\n');
 try{s.datasets.monthlyBS=H.readCSV(ctx,tmp,'monthlyBS',s.project);}finally{fs.unlinkSync(tmp);}
 const r=analyze(s);
 assert.equal(party(r,'売掛金','(株)ブルースカイ').openingBasis,'exact');
 assert.equal(party(r,'売掛金','(株)ブルースカイ').opening,900000);
 assert.equal(party(r,'売掛金','合同会社グリーンリーフ').openingBasis,'estimate');
 assert.equal(acct(r,'売掛金').residual,0);
});
test('月次画面に欄と目次の項目が出る',()=>{
 const s=fresh(),r=analyze(s),html=ctx.ReviewFinancial.page(s,r,null);
 assert.match(html,/id="partyBalances"/);
 assert.ok(html.indexOf('id="treasuryReview"')<html.indexOf('id="partyBalances"')&&html.indexOf('id="partyBalances"')<html.indexOf('id="vtChanges"'));
 const toc=plain(ctx.ReviewMonthlyToc.entries(html).map(e=>e.title));
 assert.deepEqual(toc.slice(0,4),['資料の読込範囲と数値照合','資金の動きと、回収・支払の残り','取引先別の残高と回収・支払の状況','大きく動いた科目と理由']);
 assert.ok(toc.includes('月次PL')&&toc.includes('月次BS'));
 assert.match(html,/id="monthlyToc"/);
});

test('期首の推定は、当期の入金で消し込まれたかも示す（推定の裏付け）',()=>{
 const r=analyze(fresh()),blue=party(r,'売掛金','(株)ブルースカイ'),red=party(r,'売掛金','(株)レッドストーン');
 assert.equal(blue.openingSettled,900000);assert.equal(blue.openingRemaining,0);
 assert.ok(blue.reasons.some(t=>/すべて消し込まれています/.test(t)));
 assert.equal(red.openingRemaining,220000);
 const green=party(r,'売掛金','合同会社グリーンリーフ');assert.equal(green.openingWithoutMatching,447540,'金額一致で当てない場合の値も残す');
});
test('支払の多くに取引先が付いていない科目（カード払いの未払金）は、取引先別の残りを判定しない',()=>{
 const s=fresh();let n=90000;const row=(date,debit,credit,amount,party)=>({date,id:String(n),hasId:true,journalId:String(n++),journalIdKind:'journal',debit,credit,debitAmount:amount,creditAmount:amount,party:'',debitParty:debit==='未払金'?'':party,creditParty:credit==='未払金'?party:'',description:'',source:'card.csv',importSource:'csv:card',importErrors:0,line:n,fieldOrigins:{debitParty:6,creditParty:12}});
 for(const [m,amt] of [['01',30000],['02',40000],['03',50000]]){s.datasets.current.push(row(`2026-${m}-05`,'通信費','未払金',amt*0.4,'(株)ショップA'),row(`2026-${m}-06`,'消耗品費','未払金',amt*0.6,'(株)ショップB'));s.datasets.current.push(row(`2026-${m}-27`,'未払金','普通預金',amt,''));}
 // 通常の未払金（取引先つきの支払）と混ざっている場合：カード利用先だけ判定を保留する
 const r=analyze(s),ac=acct(r,'未払金');
 assert.equal(ac.untaggedDominant,false);
 for(const l of ['(株)ショップA','(株)ショップB'])assert.equal(party(r,'未払金',l).status,'unknown',l);
 assert.equal(party(r,'未払金','(株)オフィスサプライ').status,'normal');
 assert.ok(!po(r).alerts.some(a=>a.account==='未払金'));
 // カード払いだけの未払金：科目全体で取引先別の残りを判定しない
 const only=fresh(),drop=x=>x.debit!=='未払金'&&x.credit!=='未払金';only.datasets.current=only.datasets.current.filter(drop);only.datasets.prior=only.datasets.prior.filter(drop);
 only.datasets.current.push(...s.datasets.current.filter(x=>x.importSource==='csv:card'));
 const r2=analyze(only),ac2=acct(r2,'未払金');
 assert.equal(ac2.untaggedDominant,true);assert.equal(ac2.status,'untagged');
 assert.ok(ac2.parties.every(p=>p.status==='unknown'||p.untagged));
});
test('仕訳が1件もない月でも、同じCSVの期間の内側なら「取引のない月」として続けて読む',()=>{
 const s=fresh();s.datasets.prior=s.datasets.prior.filter(x=>x.date.slice(0,7)!=='2025-06');
 assert.equal(analyze(s).financial.partyOpening.window.start,'2025-07','記録がなければ途切れる');
 const src=s.datasets.prior[0].importSource;s.imports.push({type:'prior',name:'journal-2025.csv',importSource:src,count:s.datasets.prior.length,errors:0,minDate:'2025-01-10',maxDate:'2025-12-31',at:'2026-10-06T00:00:00.000Z'});
 assert.equal(analyze(s).financial.partyOpening.window.start,'2025-01');
});

// ---- レビューで見つかった誤りの再発防止（すべて架空の取引先・金額）
// 過去の仕訳帳と同じ資料として、未収入金の仕訳を足す（1行＝1仕訳。parts を渡すと同じ仕訳の複数行）
function priorJournal(s,id,date,parts){
 const base=s.datasets.prior[0];
 for(const [i,[debit,credit,amount,party]] of parts.entries())s.datasets.prior.push({...base,line:90000+id*10+i,date,id:'P'+id,journalId:'P'+id,debit,credit,debitAmount:amount,creditAmount:amount,party:'',debitParty:debit==='未収入金'?party:'',creditParty:credit==='未収入金'?party:'',description:'テスト（架空）',sourceFields:[]});
}
test('取引先内訳つきBSの確定期首も消込で繰り越し、当期に回収された分を「長く未回収」と誤って出さない',()=>{
 const s=fresh(),fx=path.join(__dirname,'fixtures','monthly-bs-2026.csv');
 const lines=fs.readFileSync(fx,'utf8').replace(/^﻿/,'').trim().split(/\r?\n/);
 const head=lines[2].split(','),idx=lines.findIndex(l=>l.startsWith('売掛金,'));
 const withParty=[lines[0],lines[1],[head[0],'取引先',...head.slice(1)].join(','),...lines.slice(3).map(l=>{const c=l.split(',');return [c[0],'',...c.slice(1)].join(',');})];
 const blank=n=>Array(n).fill('').join(',');
 withParty.splice(idx+1,0,`売掛金,(株)ブルースカイ,900000,${blank(12)}`,`売掛金,(株)レッドストーン,220000,${blank(12)}`);
 const tmp=path.join(__dirname,'fixtures','.tmp-bs-party2.csv');fs.writeFileSync(tmp,'﻿'+withParty.join('\r\n')+'\r\n');
 try{s.datasets.monthlyBS=H.readCSV(ctx,tmp,'monthlyBS',s.project);}finally{fs.unlinkSync(tmp);}
 const r=analyze(s),blue=party(r,'売掛金','(株)ブルースカイ'),red=party(r,'売掛金','(株)レッドストーン');
 assert.equal(blue.openingBasis,'exact');assert.equal(blue.openingSettled,900000,'確定期首は当期の入金で消し込まれる');
 assert.ok(!blue.openItems.some(i=>i.exactAdjust),'期首の残りはない');
 assert.ok(['normal','settled'].includes(blue.status),blue.status);
 assert.ok(!po(r).alerts.some(a=>a.label==='(株)ブルースカイ'));
 assert.equal(red.openingBasis,'exact');assert.equal(red.status,'long');
 // 推定と確定が同じなら、推定の日付つきの内訳（2025-08-28の請求）をそのまま使う
 const alert=po(r).alerts.find(a=>a.label==='(株)レッドストーン');assert.match(alert.text,/2025-08-28の請求・売上 220,000円/);
 // 過去の仕訳がなく確定値だけの取引先は、期首時点の1件として示す
 const s2=fresh({prior:false});s2.datasets.monthlyBS=s.datasets.monthlyBS;
 const r2=analyze(s2),red2=po(r2).alerts.find(a=>a.label==='(株)レッドストーン');
 assert.equal(party(r2,'売掛金','(株)ブルースカイ').status,'normal','内訳の分からない期首は古いものから消し込む');
 assert.match(red2.text,/期首時点の残高（BS内訳） 220,000円/);
});
test('読込範囲の始めの入金でも、手数料の別行・分割入金は読込範囲より前の分とみなさない',()=>{
 const s=fresh();
 // P1：手数料を別行にした入金（同じ仕訳）／P2：分割入金／P3：相手のない入金（範囲より前の分）／P4：後で同額が入金される請求があるときの入金
 priorJournal(s,1,'2025-01-10',[['未収入金','雑収入',100000,'(株)テストP1']]);
 priorJournal(s,2,'2025-02-10',[['普通預金','未収入金',98000,'(株)テストP1'],['支払手数料','未収入金',2000,'(株)テストP1']]);
 priorJournal(s,3,'2025-01-15',[['未収入金','雑収入',100000,'(株)テストP2']]);
 priorJournal(s,4,'2025-02-15',[['普通預金','未収入金',60000,'(株)テストP2']]);
 priorJournal(s,5,'2025-04-15',[['普通預金','未収入金',40000,'(株)テストP2']]);
 priorJournal(s,6,'2025-01-20',[['普通預金','未収入金',50000,'(株)テストP3']]);
 priorJournal(s,7,'2025-03-01',[['未収入金','雑収入',70000,'(株)テストP3']]);
 priorJournal(s,8,'2025-04-30',[['普通預金','未収入金',70000,'(株)テストP3']]);
 priorJournal(s,9,'2025-01-05',[['未収入金','雑収入',80000,'(株)テストP4']]);
 priorJournal(s,10,'2025-01-25',[['普通預金','未収入金',30000,'(株)テストP4']]);
 priorJournal(s,11,'2025-02-25',[['普通預金','未収入金',80000,'(株)テストP4']]);
 const r=analyze(s),a=acct(r,'未収入金');assert.ok(a,'未収入金も対象');
 const p=l=>a.parties.find(x=>x.label===l);
 assert.equal(p('(株)テストP1').preWindow,0);assert.equal(p('(株)テストP1').opening,0);
 assert.equal(p('(株)テストP2').preWindow,0);assert.equal(p('(株)テストP2').opening,0);
 assert.equal(p('(株)テストP3').preWindow,50000);assert.equal(p('(株)テストP3').opening,0);
 assert.equal(p('(株)テストP4').preWindow,30000);assert.equal(p('(株)テストP4').opening,0);
});
test('読込範囲の始めを過ぎた、請求のない入金は前受（マイナス）として次の請求に当てる',()=>{
 const s=fresh();
 priorJournal(s,21,'2025-02-10',[['未収入金','雑収入',50000,'(株)テストP5']]);
 priorJournal(s,22,'2025-03-10',[['普通預金','未収入金',50000,'(株)テストP5']]);
 priorJournal(s,23,'2025-07-10',[['普通預金','未収入金',30000,'(株)テストP5']]);
 priorJournal(s,24,'2025-08-10',[['未収入金','雑収入',30000,'(株)テストP5']]);
 // P6：読込範囲の中で初めて出てくる取引先の入金は、範囲より前の請求の分
 priorJournal(s,25,'2025-06-10',[['普通預金','未収入金',20000,'(株)テストP6']]);
 const r=analyze(s),a=acct(r,'未収入金'),p=l=>a.parties.find(x=>x.label===l);
 assert.equal(p('(株)テストP5').opening,0,'前受30,000円は8月の請求に当たる');assert.equal(p('(株)テストP5').preWindow,0);
 assert.equal(p('(株)テストP6').opening,0);assert.equal(p('(株)テストP6').preWindow,20000);
});
test('空白だけ違う取引先タグ（同じ取引先）に、推定期首を二重に置かない',()=>{
 const s=fresh();let n=0;
 s.datasets.current=s.datasets.current.map(x=>x.debit==='売掛金'&&x.debitParty==='(株)ブルースカイ'&&n++%2===0?{...x,debitParty:'(株)ブルー スカイ'}:x);
 assert.ok(n>1);
 const r=analyze(s),t=ctx.ReviewVariance.tagRows(s,r,'monthlyBS','売掛金','party','estimate');
 const total=t.rows.reduce((m,x)=>m+(x.opening||0),0);
 assert.equal(total,acct(r,'売掛金').estimatedTotal,'期首の合計は推定の合計と同じ');
 assert.equal(t.hasDiff,false,'各月の合計もBSと一致');
});
test('BS推計の内訳は、未選択の入金を金額一致で当てた付け替えも反映し、欄の残高と一致する',()=>{
 const s=fresh(),r=analyze(s),t=ctx.ReviewVariance.tagRows(s,r,'monthlyBS','売掛金','party','estimate'),a=acct(r,'売掛金');
 for(const p of a.parties){const row=t.rows.find(x=>p.untagged?x.missing:x.label===p.label);if(!row)continue;assert.equal(row.values[a.through],p.closing,p.label);}
});
test('過去の仕訳帳がないとき、期首と残高は「—」で、合計の一致とは言わない',()=>{
 const s=fresh({prior:false}),r=analyze(s),ar=acct(r,'売掛金');
 assert.ok(ar.parties.every(p=>p.opening===null&&p.closing===null));
 assert.equal(ar.estimatedTotal,null);assert.equal(ar.closingTotal,null);assert.equal(ar.closingResidual,null);
 const html=ctx.ReviewPartyOpeningUI.panel(s,r.financial);
 assert.doesNotMatch(html,/取引先別の残高の合計と一致/);
 assert.match(html,/照合できません（取引先別の期首が不明）/);
 assert.doesNotMatch(html,/見つかりませんでした/);
 assert.equal(ctx.ReviewPartyOpening.openingValues(r.financial,'売掛金'),null,'BSの推計も出さない');
});
test('前期BSと当期BSの期首が食い違うときは「確定できません」とし、照合しない',()=>{
 const s=fresh(),open=s.datasets.monthlyBS.find(x=>x.account==='売掛金'&&x.opening);
 s.datasets.priorBS=[{...open,amount:1000000,opening:undefined,source:'prior-bs.csv',importSource:'csv:pbs'}];
 s.imports.push({type:'priorBS',name:'prior-bs.csv',count:1,errors:0,at:'2026-10-06T00:00:00.000Z'});
 const r=analyze(s),ar=acct(r,'売掛金');
 assert.equal(ar.status,'opening_unconfirmed');assert.equal(ar.residual,null);
 const html=ctx.ReviewPartyOpeningUI.panel(s,r.financial);
 assert.match(html,/確定できません/);assert.doesNotMatch(html,/>conflict</);
});
test('推定の途中でエラーが起きたら、欄にそのことを出す（黙って消さない）',()=>{
 const html=ctx.ReviewPartyOpeningUI.panel({},{partyOpening:{version:1,error:'テストのエラー',accounts:[],alerts:[],notes:[]}});
 assert.match(html,/エラーが起きたため/);assert.match(html,/テストのエラー/);
});
test('前期BS（取引先内訳つき）を追記で読み込んでも、次の分析ですぐ確定値として使う',()=>{
 const s=fresh();s.datasets.priorBS=[];analyze(s);
 const open=s.datasets.monthlyBS.find(x=>x.account==='売掛金'&&x.opening);
 const row=(tagValue,amount)=>({...open,date:'2025-12',amount,opening:undefined,openingRaw:undefined,reportStart:'2025-01',reportEnd:'2025-12',source:'prior-bs.csv',importSource:'csv:pbs',...(tagValue?{tagDimension:'party',tagValue}:{})});
 // 画面の「追記」と同じく、同じ配列に足す
 s.datasets.priorBS.push(row(null,1120000),row('(株)ブルースカイ',900000),row('(株)レッドストーン',220000));
 s.imports.push({type:'priorBS',name:'prior-bs.csv',count:3,errors:0,at:'2026-10-06T00:00:00.000Z'});
 const r=analyze(s);
 assert.equal(party(r,'売掛金','(株)ブルースカイ').openingBasis,'exact');
 assert.equal(party(r,'売掛金','(株)レッドストーン').opening,220000);
 // 月次BSを同じ配列に追記した月も、その場で照合に使う
 const s2=fresh(),keep=s2.datasets.monthlyBS.filter(x=>x.date<'2026-09'),late=s2.datasets.monthlyBS.filter(x=>x.date>='2026-09');
 s2.datasets.monthlyBS=keep;assert.equal(acct(analyze(s2),'売掛金').reportedClosing,null);
 s2.datasets.monthlyBS.push(...late);assert.equal(acct(analyze(s2),'売掛金').reportedClosing,1931750);
});
test('未選択の入金1件で、払いきれない複数の取引先の判定まで止めない（1円ずつ1回だけ使う）',()=>{
 const s=fresh(),base=s.datasets.prior.find(x=>x.debit==='売掛金'),cur=s.datasets.current.find(x=>x.credit==='売掛金');
 const sale=(id,date,party,amount)=>({...base,id,journalId:id,line:80000+Number(id.slice(1)),date,debit:'売掛金',credit:'売上高',debitAmount:amount,creditAmount:amount,debitParty:party,creditParty:party,party:'',sourceFields:[]});
 s.datasets.prior.push(sale('Q1','2025-09-10','(株)テストエー',120000),sale('Q2','2025-10-10','(株)テストビー',150000));
 s.datasets.current.push({...cur,id:'Q3',journalId:'Q3',line:80003,date:'2026-03-25',debit:'普通預金',credit:'売掛金',debitAmount:230000,creditAmount:230000,debitParty:'',creditParty:'',party:'',sourceFields:[]});
 // BSの期首・各月末も同じだけ動かして、科目は「一致」のままにする
 for(const x of s.datasets.monthlyBS)if(x.account==='売掛金'&&!x.tagDimension)x.amount+=270000-(x.date>='2026-03'?230000:0);
 const r=analyze(s),ar=acct(r,'売掛金');
 assert.equal(ar.status,'matched');
 assert.equal(ar.held,1,'230,000円で払いきれるのは、いちばん古いレッドストーン（220,000円）だけ');
 assert.equal(party(r,'売掛金','(株)レッドストーン').status,'unknown');
 for(const l of ['(株)テストエー','(株)テストビー'])assert.equal(party(r,'売掛金',l).status,'long',l);
 assert.match(ar.heldText,/1社（220,000円）の判定を保留/);
 const items=[];ctx.ReviewFinancial.addFindings(r.financial,s,(...a)=>items.push(a));
 assert.ok(items.some(a=>/1社の回収の状況を判定できません/.test(a[1])&&a[5].level==='info'),'保留したことも確認キューに残す');
});
test('他の科目だけに触れる仕訳の金額の誤りでは、売掛金などの読込範囲を止めない',()=>{
 const s=fresh(),base=s.datasets.prior.find(x=>x.date.startsWith('2025-12'));
 s.datasets.prior.push({...base,id:'N1',journalId:'N1',line:85001,date:'2025-12-15',debit:'普通預金',credit:'雑収入',debitAmount:-100,creditAmount:-100,debitParty:'',creditParty:'',party:'',sourceFields:[]});
 const r=analyze(s);
 assert.equal(po(r).window.start,'2025-01');
 for(const a of ['売掛金','買掛金','未払金'])assert.equal(acct(r,a).status,'matched',a);
 // 売掛金に触れる仕訳の誤りなら、売掛金だけ止まり、理由も正しく出る
 const s2=fresh(),b2=s2.datasets.prior.find(x=>x.debit==='売掛金'&&x.date.startsWith('2025-12'));
 s2.datasets.prior.push({...b2,id:'N2',journalId:'N2',line:85002,date:'2025-12-16',debitAmount:-100,creditAmount:-100,sourceFields:[]});
 const r2=analyze(s2);
 assert.equal(acct(r2,'売掛金').status,'gap');assert.match(acct(r2,'売掛金').statusText,/マイナス金額の仕訳があります/);
 assert.equal(acct(r2,'買掛金').status,'matched');
 assert.ok(po(r2).notes.some(n=>/^売掛金は、この科目に触れる仕訳に金額・借貸の誤り/.test(n)));
});
test('止まっている可能性の金額は、残高全体ではなく、ふだんより長く残っている分だけ',()=>{
 const s=fresh(),base=s.datasets.prior.find(x=>x.debit==='売掛金');
 s.datasets.prior.push({...base,id:'S1',journalId:'S1',line:86001,date:'2025-04-15',debit:'売掛金',credit:'売上高',debitAmount:123456,creditAmount:123456,debitParty:'(株)ブルースカイ',creditParty:'(株)ブルースカイ',party:'',sourceFields:[]});
 for(const x of s.datasets.monthlyBS)if(x.account==='売掛金'&&!x.tagDimension)x.amount+=123456;
 const r=analyze(s),blue=po(r).alerts.find(a=>a.label==='(株)ブルースカイ');
 assert.equal(acct(r,'売掛金').status,'matched');
 assert.equal(blue.amount,123456);assert.ok(blue.balance>blue.amount,'残高は別に示す');
 assert.match(blue.text,/2025-04-15の請求・売上 123,456円/);
 assert.deepEqual(plain(po(r).alerts.filter(a=>a.account==='売掛金').map(a=>a.label)),['(株)レッドストーン','(株)ブルースカイ'],'止まっている額の大きい順');
 const items=[];ctx.ReviewFinancial.addFindings(r.financial,s,(...a)=>items.push(a));
 const f=items.find(a=>/^売掛金：回収が止まっている/.test(a[1]));assert.equal(f[3],343456);
 assert.ok(f[4].every(row=>['2025-04-15','2025-08-28'].includes(row.date)),'根拠の行は止まっている請求だけ');
});
test('変動の理由の欄では、取引先別の未回収は推定の基準月（観測の最後の月）にだけ参考として出す',()=>{
 const s=fresh(),r=analyze(s),V=ctx.ReviewVariance,has=m=>V.explain(s,r,'monthlyBS','売掛金',m).inferences.some(x=>/レッドストーン/.test(x.short||''));
 assert.equal(has('2026-01'),false);assert.equal(has('2026-09'),true);
});
test('過去の仕訳帳がないとき、欄の見出しで推定したとは言わない',()=>{
 const s=fresh({prior:false}),r=analyze(s),html=ctx.ReviewPartyOpeningUI.panel(s,r.financial);
 assert.match(html,/取引先別の期首は推定していません/);assert.doesNotMatch(html,/取引先別の期首を求め/);
});
test('毎月同じ金額の請求で、一部入金・まとめ入金があっても、読込範囲より前の分と取り違えない',()=>{
 const s=fresh();
 // 毎月 100,000円の顧問料。2月は50,000円だけ入金し、3月に残り50,000円と2月分をまとめて150,000円入金。以後は翌月に100,000円。
 let id=40;for(let m=1;m<=12;m++){const mm=String(m).padStart(2,'0');priorJournal(s,id++,`2025-${mm}-01`,[['未収入金','雑収入',100000,'(株)テストR']]);}
 priorJournal(s,id++,'2025-02-10',[['普通預金','未収入金',50000,'(株)テストR']]);
 priorJournal(s,id++,'2025-03-10',[['普通預金','未収入金',150000,'(株)テストR']]);
 for(let m=4;m<=12;m++){const mm=String(m).padStart(2,'0');priorJournal(s,id++,`2025-${mm}-10`,[['普通預金','未収入金',100000,'(株)テストR']]);}
 // 1月分の請求を2回に分けて入金（40,000円・60,000円）し、後の8月の請求はちょうど入金される取引先
 priorJournal(s,id++,'2025-01-10',[['未収入金','雑収入',100000,'(株)テストQ']]);
 priorJournal(s,id++,'2025-02-12',[['普通預金','未収入金',40000,'(株)テストQ']]);
 priorJournal(s,id++,'2025-04-12',[['普通預金','未収入金',60000,'(株)テストQ']]);
 priorJournal(s,id++,'2025-08-12',[['未収入金','雑収入',100000,'(株)テストQ']]);
 priorJournal(s,id++,'2025-09-12',[['普通預金','未収入金',100000,'(株)テストQ']]);
 const r=analyze(s),a=acct(r,'未収入金'),p=l=>a.parties.find(x=>x.label===l);
 assert.equal(p('(株)テストR').preWindow,0);assert.equal(p('(株)テストR').opening,100000,'12月分だけが期首に残る');
 assert.ok(p('(株)テストR').lagMedian<=41,'ふだんの回収日数も歪まない（請求の翌月10日に入金＝約40日）:'+p('(株)テストR').lagMedian);
 assert.equal(p('(株)テストQ').preWindow,0);assert.equal(p('(株)テストQ').opening,0);
});
test('前受・前払は、次の請求・仕入に当て、長く未回収・未払と誤って出さない',()=>{
 const s=fresh();
 // 前受：10月20日に入金、11月10日に同額を請求（売掛金のBSはない科目で確かめるため未収入金を使う）
 priorJournal(s,70,'2025-10-20',[['普通預金','未収入金',300000,'(株)テスト前受']]);
 priorJournal(s,71,'2025-11-10',[['未収入金','雑収入',300000,'(株)テスト前受']]);
 const r=analyze(s),a=acct(r,'未収入金'),p=a.parties.find(x=>x.label==='(株)テスト前受');
 assert.equal(p.opening,0);assert.equal(p.preWindow,0);
 assert.ok(!po(r).alerts.some(x=>x.label==='(株)テスト前受'));
 // 前払（買掛金）：9月に200,000円を前払、期首BSは −200,000円、2月に500,000円の仕入・3月に300,000円の支払
 const s2=fresh(),b=s2.datasets.prior.find(x=>x.credit==='買掛金'),c=s2.datasets.current.find(x=>x.debit==='買掛金');
 s2.datasets.prior.push({...b,id:'V1',journalId:'V1',line:87001,date:'2025-09-30',debit:'買掛金',credit:'普通預金',debitAmount:200000,creditAmount:200000,debitParty:'(株)テスト前払',creditParty:'',party:'',sourceFields:[]});
 s2.datasets.current.push({...c,id:'V2',journalId:'V2',line:87002,date:'2026-02-15',debit:'外注費',credit:'買掛金',debitAmount:500000,creditAmount:500000,debitParty:'',creditParty:'(株)テスト前払',party:'',sourceFields:[]},
  {...c,id:'V3',journalId:'V3',line:87003,date:'2026-03-31',debit:'買掛金',credit:'普通預金',debitAmount:300000,creditAmount:300000,debitParty:'(株)テスト前払',creditParty:'',party:'',sourceFields:[]});
 for(const x of s2.datasets.monthlyBS)if(x.account==='買掛金'&&!x.tagDimension)x.amount+=x.opening||x.date<'2026-02'?-200000:0;
 const r2=analyze(s2);
 assert.ok(!po(r2).alerts.some(x=>x.label==='(株)テスト前払'),'推定がBSより多い科目で、読込範囲より前の仮定に頼る取引先は判定しない');
});
test('毎月同じ金額の請求がある取引先に確定期首（BS内訳）があっても、ふだん通りの回収を長く未回収にしない',()=>{
 const s=fresh(),base=s.datasets.prior.find(x=>x.debit==='売掛金'),cur=s.datasets.current.find(x=>x.credit==='売掛金');
 const row=(src,id,date,debit,credit,amount)=>({...src,id,journalId:id,line:88000+Number(id.slice(1)),date,debit,credit,debitAmount:amount,creditAmount:amount,debitParty:'(株)テスト顧問先',creditParty:'(株)テスト顧問先',party:'',sourceFields:[]});
 // 毎月5日に500,000円を請求し、2か月後の10日に入金（期首には11月・12月分の2件が残る）
 let n=1;for(let m=9;m<=12;m++){const mm=String(m).padStart(2,'0');s.datasets.prior.push(row(base,'T'+n++,`2025-${mm}-05`,'売掛金','売上高',500000));}
 for(const d of ['2025-11-10','2025-12-10'])s.datasets.prior.push(row(base,'T'+n++,d,'普通預金','売掛金',500000));
 for(let m=1;m<=9;m++){const mm=String(m).padStart(2,'0');s.datasets.current.push(row(cur,'T'+n++,`2026-${mm}-05`,'売掛金','売上高',500000),row(cur,'T'+n++,`2026-${mm}-10`,'普通預金','売掛金',500000));}
 for(const x of s.datasets.monthlyBS)if(x.account==='売掛金'&&!x.tagDimension)x.amount+=1000000;
 const open=s.datasets.monthlyBS.find(x=>x.account==='売掛金'&&x.opening);
 s.datasets.monthlyBS.push({...open,tagDimension:'party',tagValue:'(株)テスト顧問先',amount:1000000});
 const r=analyze(s),p=party(r,'売掛金','(株)テスト顧問先');
 assert.equal(p.openingBasis,'exact');assert.equal(p.opening,1000000);
 assert.equal(p.status,'normal');assert.ok(!po(r).alerts.some(a=>a.label==='(株)テスト顧問先'));
});
test('重なった過去資料の片方を参照から除外すると、残った資料だけで推定に戻る',()=>{
 const s=fresh(),dup=s.datasets.prior.filter(x=>x.date>='2025-07-01').map(x=>({...x,id:String(5000+Number(x.id)),journalId:String(5000+Number(x.journalId)),source:'copy.csv',importSource:'csv:copy',historySource:'hsrc:copy'}));
 s.datasets.prior=[...s.datasets.prior,...dup];
 assert.equal(analyze(s).financial.partyOpening.window.start,null,'重なっている間は使わない');
 s.history.sources['hsrc:copy']={name:'copy',status:'exclude',note:''};
 const r=analyze(s);
 assert.equal(po(r).window.start,'2025-01');assert.equal(acct(r,'売掛金').status,'matched');
});

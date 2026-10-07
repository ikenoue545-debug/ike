
(function(root){
'use strict';
// Observed settlement candidates and exact BS party balances. This module does
// not pair invoices with payments, invent contractual terms, or forecast cash.
// Load after treasury. F.build preserves its previous model and adds settlement.
const E=root.ReviewEngine,F=root.ReviewFinancial;
if(!E||!F)throw Error('ReviewSettlement requires ReviewEngine and ReviewFinancial.');
const originalBuild=F.build,clean=v=>String(v??'').normalize('NFKC').trim(),key=v=>clean(v).replace(/[\s　]/g,''),finite=Number.isSafeInteger;
const subtract=(a,b)=>finite(a)&&finite(b)&&finite(a-b)?a-b:null;
const sum=xs=>xs.reduce((n,v)=>finite(n)&&finite(v)&&finite(n+v)?n+v:NaN,0),uniq=xs=>[...new Set(xs)],month=r=>clean(r.date).slice(0,7),source=r=>r.importSource||r.historySource||r.source||'memory';
const median=xs=>{const a=xs.filter(Number.isFinite).slice().sort((a,b)=>a-b),n=a.length;return n?n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2:null;};
const days=(a,b)=>Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);
const nextMonth=m=>{const [y,n]=m.split('-').map(Number);return new Date(Date.UTC(y,n,1)).toISOString().slice(0,7);};
const endDay=m=>F.endDay?F.endDay(m):new Date(Date.UTC(+m.slice(0,4),+m.slice(5),0)).toISOString().slice(0,10);
const target=a=>/^(?:売掛金|買掛金|未払金|未払費用)$/.test(key(a)),direction=a=>key(a)==='売掛金'?'receipt':'payment';
const signedMovement=(r,a)=>direction(a)==='receipt'?((key(r.debit)===key(a)?r.debitAmount:0)-(key(r.credit)===key(a)?r.creditAmount:0)):((key(r.credit)===key(a)?r.creditAmount:0)-(key(r.debit)===key(a)?r.debitAmount:0));
function partyOf(r,side){
 const field=side+'Party',v=clean(r[field]);if(v)return v;
 if(r.fieldOrigins&&Object.hasOwn(r.fieldOrigins,field)&&r.fieldOrigins[field]>=0)return '';
 return clean(r.party);
}
function sourceStatus(session,r){
 const id=r.historySource||(root.ReviewHistory?.sourceKey?root.ReviewHistory.sourceKey(r):source(r));return session.history?.sources?.[id]?.status||'reference';
}
function importErrors(session,type,r){
 if(r?.importErrors>0)return true;
 return (session.imports||[]).some(i=>i.type===type&&i.errors>0&&(!i.name&&!i.importSource||i.name===r?.source||i.importSource===r?.importSource));
}
function signature(rs){return JSON.stringify(rs.map(r=>['date','debit','credit','debitAmount','creditAmount','debitParty','creditParty','party','description','debitTax','creditTax','debitItem','creditItem','debitDepartment','creditDepartment'].map(k=>typeof r[k]==='number'?r[k]:key(r[k]))).map(x=>JSON.stringify(x)).sort());}
function journals(session){
 const raw=[];for(const type of ['prior','current'])for(const rs of E.journalGroups(session.datasets?.[type]||[]))raw.push({type,rows:rs,date:rs[0]?.date,journalKey:E.journalKey(rs[0]),source:source(rs[0]),reasons:[]});
 const content=new Map();for(const g of raw){const s=signature(g.rows),gs=content.get(s)||[];gs.push(g);content.set(s,gs);}
 // 参照から除外した過去資料は、重なりの判定に入れない（除外したあとに残った資料を重なりとして止めない）
 const excluded=g=>g.type==='prior'&&g.rows.some(r=>sourceStatus(session,r)==='exclude');
 for(const gs of content.values()){const live=gs.filter(g=>!excluded(g));if(new Set(live.map(g=>g.source)).size>1)for(const g of live)g.reasons.push('資料間で同内容の仕訳が重なっています。');}
 for(const g of raw){
  const rs=g.rows,net=sum(rs.map(r=>r.debitAmount-r.creditAmount));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(g.date||'')||!Number.isFinite(Date.parse(g.date+'T00:00:00Z')))g.reasons.push('取引日が未確定です。');
  if(rs.some(r=>!r.hasId||r.journalAmbiguous))g.reasons.push('仕訳番号・複合仕訳のまとまりが未確定です。');
  if(rs.some(r=>r.debitAmount<0||r.creditAmount<0))g.reasons.push('マイナス金額の仕訳があります。');
  else if(rs.some(r=>!finite(r.debitAmount)||!finite(r.creditAmount))||!finite(sum(rs.map(r=>r.debitAmount)))||!finite(sum(rs.map(r=>r.creditAmount))))g.reasons.push('借貸金額が円単位の安全な整数として確定できません。');
  if(!finite(net)||net!==0)g.reasons.push('仕訳全体の借貸が一致しません。');
  if(rs.some(r=>importErrors(session,g.type,r)))g.reasons.push('CSVに読取エラー・除外行があります。');
  if(g.type==='prior'&&month(rs[0])>=session.project.start)g.reasons.push('過去仕訳の読込先に当期以降の取引日が含まれています。');
  if(g.type==='prior'&&rs.some(r=>sourceStatus(session,r)==='exclude'))g.reasons.push('参照から除外された過去資料です。');
  g.valid=!g.reasons.length;
 }
 return {all:raw,valid:raw.filter(g=>g.valid),invalid:raw.filter(g=>!g.valid)};
}
function coverage(session,model,js){
 const map=new Map(),audit=new Map((model.audit?.coverage||[]).map(c=>[c.month,c]));
 for(const g of js.all){const m=month(g.rows[0]),c=map.get(m)||{month:m,rowCount:0,available:true,rows:[],reasons:[]};c.rowCount+=g.rows.length;c.rows.push(...g.rows);if(!g.valid){c.available=false;c.reasons.push(...g.reasons);}map.set(m,c);}
 for(const c of map.values()){
  const a=audit.get(c.month);if(a&&!a.available){c.available=false;c.reasons.push(...(a.reasons||[]));}
  c.reasons=uniq(c.reasons);c.scopeConfirmed=!!session.project.complete&&!!session.financial?.comparisonConfirmed;
 }
 for(const m of model.months||E.monthRange(session.project.start,session.project.end))if(!map.has(m))map.set(m,{month:m,rowCount:0,available:false,rows:[],reasons:['当月の仕訳は未読込です。0円とは扱いません。'],scopeConfirmed:false});
 return map;
}
function continuous(cov,start,end){if(!start||!end)return false;for(let m=start;m<=end;m=nextMonth(m))if(!cov.get(m)?.available)return false;return true;}
function role(model,a){return model.cfg?.accountRoles?.['monthlyBS:'+a]||model.bs?.find(g=>key(g.account)===key(a))?.role||F.inferRole(a,'monthlyBS');}
function isCash(model,a){return !!a&&role(model,a)==='cash';}
function extractEvents(session,model,js){
 const out=[];for(const g of js.valid){
  if(g.date>endDay(session.project.end)||g.type==='prior'&&month(g.rows[0])>=session.project.start)continue;
  const cashNet=sum(g.rows.map(r=>(isCash(model,r.debit)?r.debitAmount:0)-(isCash(model,r.credit)?r.creditAmount:0)));
  if(!finite(cashNet))continue;
  const targets=new Map();
  for(const r of g.rows)for(const side of ['debit','credit']){
   const account=r[side];if(!target(account))continue;const amount=r[side+'Amount'];if(!amount)continue;
   const label=partyOf(r,side),id=key(account)+'\u0001'+key(label),normal=direction(account)==='receipt'?(side==='debit'?1:-1):(side==='credit'?1:-1);
   const t=targets.get(id)||{account,party:key(label),label:label||'未選択',movement:0};t.movement+=normal*amount;targets.set(id,t);
  }
  const description=g.rows.map(r=>r.description||'').join(' '),cashTargets=[...targets.values()].filter(t=>t.movement<0&&((direction(t.account)==='receipt'&&cashNet>0)||(direction(t.account)==='payment'&&cashNet<0)));
  for(const t of targets.values())if(finite(t.movement)&&t.movement<0){
   const dir=direction(t.account),linked=dir==='receipt'?cashNet>0:cashNet<0,classification=/取消|取り消|返金|返品|値引|貸倒|戻入|キャンセル/.test(description)?'cancellation':linked?'cash_linked':'transfer_or_offset';
   out.push({date:g.date,month:month(g.rows[0]),account:t.account,party:t.party,label:t.label,direction:dir,amount:-t.movement,actualCashAmount:Math.abs(cashNet),actualCashNet:cashNet,classification,current:g.type==='current'&&month(g.rows[0])>=session.project.start,rows:g.rows,journalKey:g.journalKey,scope:'settlement_candidate',allocationKnown:linked&&cashTargets.length===1&&Math.abs(cashNet)===-t.movement,note:linked?'対象科目の減少と現預金の純増減が同じ仕訳にあります。請求書への紐付けと複数内訳への現預金配分は未確定です。':'対象方向の現預金純増減との対応を確定できない減少、または取消等の記載があります。相殺・振替・取消・複合取引等を確認します。'});
  }
 }
 return out.sort((a,b)=>a.date.localeCompare(b.date)||a.account.localeCompare(b.account)||a.party.localeCompare(b.party));
}
function interval(events,asOf,cov){
 const dates=uniq(events.filter(e=>e.classification==='cash_linked').map(e=>e.date)).sort(),gapRecords=dates.slice(1).map((d,i)=>({from:dates[i],to:d,days:days(dates[i],d),covered:!cov||continuous(cov,dates[i].slice(0,7),d.slice(0,7))})),gaps=gapRecords.filter(g=>g.covered).map(g=>g.days),med=dates.length>=3&&gaps.length>=2?median(gaps):null,spread=gaps.length?Math.max(...gaps)-Math.min(...gaps):null,dom=dates.map(d=>+d.slice(8)),tolerance=med===null?null:Math.max(7,med*.3),regular=med!==null&&gaps.every(g=>Math.abs(g-med)<=tolerance);
 const monthly=dates.length>=3&&med>=24&&med<=38,monthEnd=monthly&&dates.every(d=>days(d,endDay(d.slice(0,7)))<=5);
 return {dateCount:dates.length,dates,gaps,gapRecords,uncoveredGapCount:gapRecords.filter(g=>!g.covered).length,median:med,spread,lastDate:dates.at(-1)||null,daysSinceLast:dates.length&&asOf?days(dates.at(-1),asOf):null,dayOfMonth:{median:dates.length>=3?median(dom):null,spread:dom.length?Math.max(...dom)-Math.min(...dom):null,monthEnd},regularity:med===null?'insufficient':regular||monthEnd?'regular':'variable',scope:'observed_cash_candidates',asOf};
}
function reportReasons(session,type,r){
 const reasons=[];
 if(!finite(r.amount))reasons.push('帳票残高が円単位の安全な整数として未確定です。');
 if(r.unit!==1||r.approximate)reasons.push('帳票が円単位の確定値ではありません。');
 if(importErrors(session,type,r)||(session.imports||[]).some(i=>i.type===type&&i.errors>0)||(session.datasets?.[type]||[]).some(x=>x.importErrors>0))reasons.push('帳票に読取エラー・除外行があります。');
 if(sourceStatus(session,r)==='exclude')reasons.push('参照から除外された帳票です。');
 if(r.basis&&r.basis!=='closing')reasons.push('BSの月末残高の集計方法ではありません。');
 const m=month(r);if(r.reportStart!==undefined||r.reportEnd!==undefined){const st=r.reportStart,en=r.reportEnd;if(!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(st||'')||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(en||'')||st>en||!(st<=m&&m<=en)&&!(r.opening&&m===F.prevMonth(st)))reasons.push('帳票残高の年月が記載された対象期間と一致しません。');}
 return reasons;
}
function validReport(session,type,r){return !reportReasons(session,type,r).length;}
// 帳票セルの索引（科目×年月×取引先）。取引先ごとに帳票全体を読み直さないよう、1回の分析（F.build）の間だけ使い回す。
// 資料の追記は datasets の配列をその場で増やすので、分析をまたいでは使わない（epoch と件数が変われば作り直す）。
let epoch=0;
const cellIndexes=new WeakMap(),EMPTY=[];
function cellIndex(list){
 const c=cellIndexes.get(list);if(c&&c.epoch===epoch&&c.length===list.length)return c.ix;const ix=new Map();
 for(const r of list){const id=key(r.account)+'\u0001'+month(r)+'\u0001'+(!r.tagDimension?'\u0000':r.tagDimension==='party'?'p:'+key(r.tagValue):'x');let l=ix.get(id);if(!l)ix.set(id,l=[]);l.push(r);}
 cellIndexes.set(list,{epoch,length:list.length,ix});return ix;
}
const entityCache=new WeakMap();
function entityConflict(session){
 const a=session.datasets?.monthlyBS||EMPTY,b=session.datasets?.priorBS||EMPTY,c=entityCache.get(a);
 if(c&&c.epoch===epoch&&c.b===b&&c.la===a.length&&c.lb===b.length)return c.v;
 const v=uniq([a,b].flatMap(list=>list.map(r=>key(r.reportEntity))).filter(Boolean)).length>1;entityCache.set(a,{epoch,b,la:a.length,lb:b.length,v});return v;
}
function reportCell(session,type,account,m,party){
 const rs=(cellIndex(session.datasets?.[type]||EMPTY).get(key(account)+'\u0001'+m+'\u0001'+(party===undefined?'\u0000':'p:'+party))||[]).slice();
 const reasons=[];if(rs.length>1)reasons.push('同じ月・科目・取引先の帳票セルが重複しています。');if(rs.length===1)reasons.push(...reportReasons(session,type,rs[0]));
 if(entityConflict(session))reasons.push('BSの事業者名が一致しません。');
 return {amount:rs.length===1&&!reasons.length?rs[0].amount:null,rows:rs,reasons,source:type,present:rs.length>0,date:m};
}
function exactOpening(session,account,m,party){
 const current=reportCell(session,'monthlyBS',account,m,party),prior=reportCell(session,'priorBS',account,m,party),rows=uniq([...current.rows,...prior.rows]);
 if(current.present&&current.amount===null)return {...current,rows};
 if(prior.present&&prior.amount===null)return {...prior,rows};
 if(current.amount!==null&&prior.amount!==null&&current.amount!==prior.amount)return {amount:null,rows,reasons:['前期末BSと当期BSの同じ基準日の残高が一致しません。'],source:'conflict',present:true,date:m};
 const best=current.amount!==null?current:prior.amount!==null?prior:null;
 return best?{...best,rows}:{amount:null,rows,reasons:[],source:'unknown',present:current.present||prior.present,date:m};
}
// 科目×取引先ごとの仕訳を一度だけ索引する（取引先ごとに全仕訳を読み直すと、取引先数×仕訳数で遅くなるため）。
// 結果の並び・対象は、索引なしで全仕訳を順に絞り込んだ場合と同じ。
const movementIndexes=new WeakMap();
function movementIndex(js){
 let ix=movementIndexes.get(js);if(ix)return ix;
 ix={entries:new Map(),groups:new Map()};
 for(const g of js.valid){const m=month(g.rows[0]),touched=new Set();
  for(const r of g.rows)for(const side of ['debit','credit']){
   const id=key(r[side])+'\u0001'+key(partyOf(r,side));let l=ix.entries.get(id);if(!l)ix.entries.set(id,l=[]);l.push({m,r,side});
   if(r[side+'Amount']!==0&&!touched.has(id)){touched.add(id);let gl=ix.groups.get(id);if(!gl)ix.groups.set(id,gl=[]);gl.push({m,g});}
  }}
 movementIndexes.set(js,ix);return ix;
}
function movements(js,account,party,start,end){
 const list=movementIndex(js).entries.get(key(account)+'\u0001'+party)||[];
 return list.filter(e=>e.m>=start&&e.m<=end).map(e=>(direction(account)==='receipt'?(e.side==='debit'?1:-1):(e.side==='credit'?1:-1))*e.r[e.side+'Amount']);
}
function movementRows(js,account,party,start,end){
 const list=movementIndex(js).groups.get(key(account)+'\u0001'+party)||[];
 return uniq(list.filter(x=>x.m>=start&&x.m<=end).flatMap(x=>x.g.rows));
}
function openingForParty(session,account,party,prev,cov,js){
 const exact=exactOpening(session,account,prev,party);if(exact.present)return exact;
 // A dated earlier native party balance can reach the display baseline only
 // through every intervening numerically valid journal month.
 const dates=uniq(['monthlyBS','priorBS'].flatMap(t=>(session.datasets?.[t]||[]).filter(r=>key(r.account)===key(account)&&r.tagDimension==='party'&&key(r.tagValue)===party&&month(r)<prev).map(month))).sort().reverse();
 for(const d of dates){const c=exactOpening(session,account,d,party);if(c.amount===null)continue;const from=nextMonth(d),proof=uniq([...c.rows,...movementRows(js,account,party,from,prev)]);if(!continuous(cov,from,prev))return {amount:null,rows:proof,reasons:['既知の取引先残高から表示前月末までの仕訳が連続して揃っていません。'],source:'unknown',present:true,date:prev,referenceDate:d};const delta=sum(movements(js,account,party,from,prev)),n=finite(delta)&&finite(c.amount+delta)?c.amount+delta:null;return {amount:n,rows:proof,reasons:n===null?['取引先繰越の合計が安全な整数の範囲を超えます。']:[],source:c.source+'+journal',present:true,date:prev,referenceDate:d};}
 return exact;
}
function partyIdentity(js,session,account){
 const map=new Map();for(const g of js.all)for(const r of g.rows)for(const side of ['debit','credit'])if(key(r[side])===key(account)){const label=partyOf(r,side),p=key(label);if(!map.has(p))map.set(p,label||'未選択');}
 for(const type of ['monthlyBS','priorBS'])for(const r of session.datasets?.[type]||[])if(key(r.account)===key(account)&&r.tagDimension==='party'){const p=key(r.tagValue);if(!map.has(p))map.set(p,clean(r.tagValue)||'未選択');}
 return map;
}
function patternReasons(p,asOf,cov,start,end,session){
 const out=[],i=p.interval,cash=p.events.filter(e=>e.classification==='cash_linked'),dates=i.dates;
 if(i.gaps.length>=3){const baseline=median(i.gaps.slice(0,-1)),lastGap=i.gapRecords.at(-1),latest=lastGap?.days;if(baseline>0&&lastGap?.covered&&latest-baseline>=7&&latest>baseline*1.5)out.push({kind:'interval_change',text:`直近の観測間隔${latest}日が、それ以前の中央値${baseline}日より長くなっています。約定期日や請求書の回収日数を示すものではありません。`});}
 if(end&&finite(p.analysisClosing)&&p.analysisClosing>0&&continuous(cov,start,end)){
  const loadedMonths=E.monthRange(start,end),currentDecrease=p.events.filter(e=>e.current).concat(p.nonCashEvents.filter(e=>e.current));
  if(loadedMonths.length>=3&&!currentDecrease.length&&p.observedUnchanged)out.push({kind:'no_movement',text:`${p.analysisClosingAsOf}の残高${p.analysisClosing.toLocaleString('ja-JP')}円があり、読込済み${loadedMonths.length}か月に対象科目の減少仕訳がありません。動きなしの確認候補で、期日超過とは判定しません。`});
  if(i.regularity==='regular'&&i.median>0&&i.daysSinceLast>i.median*1.75&&i.daysSinceLast-i.median>=7&&session.project.complete&&session.financial?.comparisonConfirmed)out.push({kind:'observed_gap',text:`最後の決済候補から${i.daysSinceLast}日経過し、観測間隔の中央値${i.median}日より長くなっています。請求・支払条件や今回の予定を確認します。延滞とは確定しません。`});
 }
 if(p.nonCashEvents.some(e=>e.current))out.push({kind:'noncash_decrease',text:'対象方向の現預金純増減との対応を確定できない減少、または取消等の記載があります。相殺・振替・取消・複合取引等の理由を確認します。'});
 return out;
}
function build(session,model){
 const months=model.months||E.monthRange(session.project.start,session.project.end),start=months[0]||session.project.start,end=months.at(-1)||session.project.end,prev=F.prevMonth(start),js=journals(session),cov=coverage(session,model,js),events=extractEvents(session,model,js),validCurrentDates=js.valid.filter(g=>g.type==='current'&&month(g.rows[0])>=start&&month(g.rows[0])<=end).map(g=>g.date).sort(),asOf=validCurrentDates.at(-1)||null,analysisMonth=asOf?.slice(0,7)||null,accounts=[],parties=[],alerts=[],notes=[];
 const names=new Map();for(const g of model.bs||[])if(target(g.account))names.set(key(g.account),g.account);for(const g of js.all)for(const r of g.rows)for(const a of [r.debit,r.credit])if(target(a)&&!names.has(key(a)))names.set(key(a),a);for(const t of ['monthlyBS','priorBS'])for(const r of session.datasets?.[t]||[])if(target(r.account)&&!names.has(key(r.account)))names.set(key(r.account),r.account);
 // 取引先ごとの決済候補を一度だけ振り分ける（並びは events と同じ）
 const eventsBy=new Map();for(const e of events){const id=key(e.account)+'\u0001'+e.party;let l=eventsBy.get(id);if(!l)eventsBy.set(id,l=[]);l.push(e);}
 for(const account of names.values()){
  const totalOpening=exactOpening(session,account,prev),totalClosing=reportCell(session,'monthlyBS',account,end),accountParties=[];
  for(const [party,label] of partyIdentity(js,session,account)){
   const op=openingForParty(session,account,party,prev,cov,js),closingReport=reportCell(session,'monthlyBS',account,end,party),changeValues=movements(js,account,party,start,end),periodChange=continuous(cov,start,end)?sum(changeValues):null,observedChange=analysisMonth&&continuous(cov,start,analysisMonth)?sum(movements(js,account,party,start,analysisMonth)):null,change=observedChange;
   const partyEvents=eventsBy.get(key(account)+'\u0001'+party)||[],cash=partyEvents.filter(e=>e.classification==='cash_linked'),nonCash=partyEvents.filter(e=>e.classification!=='cash_linked');
   const computed=finite(op.amount)&&finite(periodChange)&&finite(op.amount+periodChange)?op.amount+periodChange:null,analysisReport=analysisMonth?reportCell(session,'monthlyBS',account,analysisMonth,party):{amount:null},analysisComputed=finite(op.amount)&&finite(observedChange)&&finite(op.amount+observedChange)?op.amount+observedChange:null,analysisClosing=analysisReport.amount!==null?analysisReport.amount:analysisComputed,analysisDifference=subtract(analysisComputed,analysisReport.amount),periodDifference=subtract(computed,closingReport.amount);
   let closing=closingReport.amount,closingBasis=closing!==null?'report':computed!==null?'rollforward':'unknown';if(closing===null)closing=computed;
   const reviewReasons=uniq([...op.reasons,...closingReport.reasons]);if(op.amount===null)reviewReasons.push('取引先別期首残高が未確定です。累計増減を残高とは扱いません。');if(!continuous(cov,start,end))reviewReasons.push('対象期間の仕訳に未読込月・未確定のまとまりがあります。残高の繰越計算は保留します。');
   if(periodDifference!==null&&periodDifference!==0)reviewReasons.push(`帳票の取引先残高と期首＋仕訳増減に${periodDifference.toLocaleString('ja-JP')}円の差があります。`);
   if(analysisDifference!==null&&analysisDifference!==0&&analysisMonth!==end)reviewReasons.push(`読込済み${analysisMonth}の取引先BSと期首＋仕訳増減に${analysisDifference.toLocaleString('ja-JP')}円の差があります。`);
   const p={account,party,label,direction:direction(account),opening:op.amount,openingSource:op.source,openingDate:op.date,openingReferenceDate:op.referenceDate||op.date,closing,closingBasis,change:finite(change)?change:null,computedClosing:computed,interval:interval(cash,asOf,cov),analysisThrough:asOf,analysisClosingAsOf:analysisMonth?endDay(analysisMonth):null,analysisComputedClosing:analysisComputed,analysisDifference,analysisRows:analysisReport.rows||[],analysisClosing,analysisClosingBasis:analysisReport.amount!==null?'report':analysisComputed!==null?'rollforward':'unknown',asOf:endDay(end),periodChange,changeThrough:asOf,changeScope:'observed_journal_range',events:cash,nonCashEvents:nonCash,reviewReasons,status:closingBasis==='unknown'?'unknown':reviewReasons.length?'review':closingBasis==='report'?'reported':'rolled_forward',rows:uniq([...op.rows,...closingReport.rows,...(analysisReport.rows||[]),...partyEvents.flatMap(e=>e.rows)])};
   const observedBalances=analysisMonth?E.monthRange(start,analysisMonth).map(m=>reportCell(session,'monthlyBS',account,m,party).amount):[];p.observedUnchanged=finite(op.amount)&&op.amount>0&&observedChange===0&&analysisClosing===op.amount||observedBalances.length>=3&&observedBalances.every(n=>finite(n)&&n>0&&n===observedBalances[0]);
   p.patternReasons=patternReasons(p,asOf,cov,start,analysisMonth,session);p.reviewReasons.push(...p.patternReasons.map(x=>x.text));if(p.patternReasons.length&&p.status!=='unknown')p.status='review';
   for(const x of p.patternReasons)alerts.push({kind:x.kind,title:account+'／'+label+'：'+({no_movement:'動きなし',observed_gap:'決済候補の観測間隔を確認',interval_change:'直近の観測間隔が変化',noncash_decrease:'入出金以外の減少を確認'}[x.kind]||'確認候補'),reason:x.text,account,party,amount:closing,rows:p.rows});
   if(periodDifference!==null&&periodDifference!==0)alerts.push({kind:'party_reconciliation',title:account+'／'+label+'の帳票と仕訳増減に差',reason:p.reviewReasons.find(t=>t.startsWith('帳票の取引先残高')),account,party,amount:periodDifference,rows:p.rows});
   if(analysisDifference!==null&&analysisDifference!==0&&analysisMonth!==end)alerts.push({kind:'party_reconciliation',title:account+'／'+label+'の読込済月BSと仕訳増減に差',reason:p.reviewReasons.find(t=>t.startsWith('読込済み')),account,party,amount:analysisDifference,rows:p.rows});
   accountParties.push(p);parties.push(p);
  }
  const knownParties=accountParties.filter(p=>finite(p.closing)),unknownParties=accountParties.filter(p=>!finite(p.closing)),knownClosingTotal=sum(knownParties.map(p=>p.closing)),knownOpeningTotal=sum(accountParties.filter(p=>finite(p.opening)).map(p=>p.opening));
  const analysisTotal=analysisMonth?reportCell(session,'monthlyBS',account,analysisMonth):{amount:null,rows:[]},analysisKnownTotal=sum(accountParties.filter(p=>finite(p.analysisClosing)).map(p=>p.analysisClosing));
  accounts.push({account,direction:direction(account),asOf:endDay(end),analysisAsOf:asOf,analysisClosingAsOf:analysisMonth?endDay(analysisMonth):null,analysisClosingTotal:analysisTotal.amount,analysisUnallocatedClosing:subtract(analysisTotal.amount,analysisKnownTotal),totalOpening:totalOpening.amount,totalClosing:totalClosing.amount,openingSource:totalOpening.source,knownParties,unknownParties,knownClosingTotal:finite(knownClosingTotal)?knownClosingTotal:null,knownOpeningTotal:finite(knownOpeningTotal)?knownOpeningTotal:null,unallocatedOpening:subtract(totalOpening.amount,knownOpeningTotal),unallocatedClosing:subtract(totalClosing.amount,knownClosingTotal),openingReasons:totalOpening.reasons,closingReasons:totalClosing.reasons,rows:uniq([...totalOpening.rows,...totalClosing.rows,...analysisTotal.rows])});
  if(totalOpening.reasons.length)alerts.push({kind:'opening_conflict',title:account+'の期首・前月末残高を確認',reason:totalOpening.reasons.join(' '),account,party:null,amount:null,rows:totalOpening.rows});
 }
 const liquidity=liquiditySnapshot(session,model,accounts,cov),ratios=[];
 if(liquidity.ready&&liquidity.cash<liquidity.outstandingPayables)alerts.push({kind:'liquidity_snapshot',title:'現預金と債務残高の差を確認',reason:`${liquidity.asOf}の現預金は対象債務残高を下回ります。すべて即時支払と仮定した差引参考額は${liquidity.netAfterPayables.toLocaleString('ja-JP')}円です。支払期日・入金予定・利用可能額を示す資金繰り予測ではありません。`,account:null,party:null,amount:liquidity.netAfterPayables,rows:liquidity.rows});
 if(js.invalid.length)notes.push('番号不明・貸借不一致・読取エラー・参照除外・資料間重複の仕訳を、決済周期の観測から除外しています。');
 notes.push('間隔は現預金を伴う対象科目の減少候補の観測値です。請求書への紐付け、約定回収・支払日、期日超過は確定しません。','期首内訳がない取引先の残高は不明です。前期仕訳の純増や推計を確定期首には使いません。過去の仕訳からの参考推計は「取引先別の残高と回収・支払の状況」に分けて表示します。','売上・仕入の税込／税抜、掛取引の範囲が確定していないため、回収・支払日数の比率は自動算定していません。');
 const out={accounts,parties,events,alerts,liquidity,ratios,notes,coverage:[...cov.values()].filter(c=>c.month>=start&&c.month<=end).sort((a,b)=>a.month.localeCompare(b.month)),observationEnd:asOf,analysisThrough:asOf,scopeEnd:endDay(end),scope:'observed_settlement_candidates',version:1};
 // 同じ build の中で後続のモジュール（取引先別の期首推定）が仕訳のまとまりを作り直さないよう、表に出さずに渡す
 Object.defineProperty(out,'journals',{value:js,enumerable:false});
 return out;
}
function liquiditySnapshot(session,model,accounts,cov){
 const end=model.months?.at(-1)||session.project.end,start=model.months?.[0]||session.project.start,usable=(model.months||E.monthRange(start,end)).filter(m=>cov.get(m)?.available).reverse();
 const cashAccounts=(model.bs||[]).filter(g=>role(model,g.account)==='cash'),paymentAccounts=accounts.filter(a=>a.direction==='payment');
 let chosen=end,cashCells=[],debtCells=[],ready=false;
 for(const m of usable){const cash=cashAccounts.map(g=>reportCell(session,'monthlyBS',g.account,m)),debt=paymentAccounts.map(g=>reportCell(session,'monthlyBS',g.account,m));if(cash.length&&debt.length&&cash.every(c=>finite(c.amount))&&debt.every(c=>finite(c.amount))){chosen=m;cashCells=cash;debtCells=debt;ready=true;break;}}
 if(!cashCells.length)cashCells=cashAccounts.map(g=>reportCell(session,'monthlyBS',g.account,chosen));if(!debtCells.length)debtCells=paymentAccounts.map(g=>reportCell(session,'monthlyBS',g.account,chosen));
 const cash=cashCells.length&&cashCells.every(c=>finite(c.amount))?sum(cashCells.map(c=>c.amount)):null,outstandingPayables=debtCells.length&&debtCells.every(c=>finite(c.amount))?sum(debtCells.map(c=>Math.max(c.amount,0))):null;
 const net=finite(cash)&&finite(outstandingPayables)&&finite(cash-outstandingPayables)?cash-outstandingPayables:null,reasons=[];if(!ready)reasons.push('同じ月の現預金・対象債務BSと有効な仕訳の読込範囲が揃っていません。');if(chosen!==end)reasons.push('設定末月は仕訳未読込のため、'+chosen+'の読込済みBSを使用しています。');if(!paymentAccounts.length)reasons.push('対象債務科目が未読込です。未読込を0円とは扱いません。');if(cashCells.some(c=>finite(c.amount)&&c.amount<0)){ready=false;reasons.push('現預金に負残高の科目があります。当座貸越・仕訳・利用可能額の確認前に、表示合計を支払可能額とは扱いません。');}if(debtCells.some(c=>finite(c.amount)&&c.amount<0)){ready=false;reasons.push('対象債務に負残高の科目があります。前払・振替等の確認前に、負数で他の債務を相殺しません。');}
 return {asOf:endDay(chosen),configuredAsOf:endDay(end),cash:finite(cash)?cash:null,knownCashAccounts:cashAccounts.map((g,i)=>({account:g.account,amount:cashCells[i]?.amount??null})),outstandingPayables:finite(outstandingPayables)?outstandingPayables:null,netAfterPayables:net,ready:ready&&net!==null,kind:'snapshot',notes:[...reasons,'買掛金・未払金・未払費用の帳票残高だけを比較。独自名のカード残高・税金・借入返済・将来売上等を含む予定表ではありません。'],rows:uniq([...cashCells,...debtCells].flatMap(c=>c.rows))};
}
const S={build,journals,extractEvents,interval,exactOpening,reportCell,version:1};
root.ReviewSettlement=S;
F.build=function(session,current,months){epoch++;const model=originalBuild(session,current,months);model.settlement=build(session,model);return model;};
})(typeof window!=='undefined'?window:globalThis);

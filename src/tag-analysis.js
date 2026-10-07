(function(root){
'use strict';
// ReviewTagAnalysis：freeeの「表示するタグ」別の月次PL・BS（取引先・品目・部門など）から、
// 収益・費用の内訳の構成、取引先の集中、部門別損益、残高の内訳で気になるもの（精算されずに残る仮勘定・マイナスの債権債務）を求める。
// 計算だけを持ち、表示は ReviewTagAnalysisUI。model.tagAnalysis に置き、科目合計・確定値には書き込まない。
// - PLのタグ別の金額は月ごとの発生額で、内訳の合計は科目合計と一致する（取込時に照合済み）。
// - BSのタグ別の金額はタグごとの累計。未選択が0でない科目は、未選択に相殺額があり、タグ別の値は残高ではない（動きとして見る）。
// - 現金・預金・カードのタグ別の値は、相手ごとの入出金の累計で残高ではないため、残高の確認に使わない。
const E=root.ReviewEngine,F=root.ReviewFinancial,T=root.ReviewTagReports;
if(!E||!F||!T||typeof F.build!=='function')throw Error('ReviewTagAnalysis requires ReviewEngine, ReviewFinancial and ReviewTagReports.');
const originalBuild=F.build,originalFindings=F.addFindings,DIMS=T.DIMS;
const clean=v=>String(v??'').normalize('NFKC').trim(),key=v=>clean(v).replace(/[\s　]/g,''),finite=Number.isSafeInteger;
const UNSEL=/^(?:未選択|取引先未選択)$/,isUnsel=t=>UNSEL.test(key(t));
const total=xs=>xs.reduce((n,v)=>n+(finite(v)?v:0),0);
const yen=n=>Number(n).toLocaleString('ja-JP');
const pct=v=>Number.isFinite(v)?Math.round(v*100)+'%':'—';
const shiftYear=(m,d)=>String(+m.slice(0,4)+d).padStart(4,'0')+m.slice(4);
const share=(a,b)=>finite(a)&&finite(b)&&b>0?a/b:null;
// 精算されるはずの科目（タグごとに残り続けるのは精算漏れ・タグの付け違いの候補）。消費税の仮払・仮受は含めない
const CLEARING=/^(?:立替金|立替経費|仮払金|仮受金|預り金|預かり金|仮払経費|未確定勘定|仮勘定|未決算)/;
// 取引先ごとに残高を見る債権債務（マイナスは過入金・二重払い・消込ミスの候補）
const SETTLE=/^(?:売掛金|未収入金|未収金|買掛金|未払金|未払費用)$/;
const OTHER_INCOME=/雑収入|雑益|受取利息|受取配当|その他収益|為替差益|償却債権取立益/;
// 月末の残高が4回続けて同じ＝3か月以上動いていない
const UNSEL_SHARE=0.3,UNSEL_MIN=10000,STATIC_POINTS=4;
// 預り金・立替経費の取引先別は、預かる（立て替える）相手と納める（精算する）相手が違うので、0円に戻らないのがふつう
const PARTY_SKIP=/^(?:預り金|預かり金|立替経費)/;
const JOURNAL_FIELDS={party:['debitParty','creditParty','party'],item:['debitItem','creditItem','item'],department:['debitDepartment','creditDepartment','department']};
const dimsOf=(session,type)=>Object.keys(DIMS).filter(d=>T.has(session,type,d));

// 科目の分類（利用者の設定 → 帳票の科目合計 → 科目名からの推定）
function context(session,model){
 const cfg=model.cfg||{},maps={};
 for(const [type,list] of [['monthlyPL',model.plReference||[]],['monthlyBS',model.bs||[]]])maps[type]=new Map(list.map(g=>[key(g.account),g]));
 const meta={monthlyPL:new Map(),monthlyBS:new Map()};
 const note=(type,r)=>{const t=E.reportType(type),m=meta[t];if(!m)return;const k=key(r.account);if(!m.has(k))m.set(k,{category:r.category||'',code:r.accountCode||'',role:r.role||''});const x=m.get(k);if(!x.code&&r.accountCode)x.code=r.accountCode;};
 for(const r of session.tagReports||[])note(r.type,r);
 for(const r of session.datasets?.monthlyBS||[])note('monthlyBS',r);
 for(const r of session.datasets?.monthlyPL||[])note('monthlyPL',r);
 const role=(type,account)=>{const o=cfg.accountRoles?.[type+':'+account];if(o)return o;const g=maps[type].get(key(account));if(g?.role&&g.role!=='unknown')return g.role;const m=meta[type].get(key(account));return m?.role&&m.role!=='unknown'?m.role:F.inferRole(account,type,m?.category||'');};
 const hasCodes=[...meta.monthlyBS.values()].some(m=>m.code);
 // 現金・預金・カード（freeeの口座）：タグ別の値は相手ごとの入出金の累計
 // 勘定科目コードのない資産・負債は freee の口座（銀行・カードなど）。立替経費は事業主借の欄の口座だが、精算の確認に使う
 const flow=account=>{const r=role('monthlyBS',account),m=meta.monthlyBS.get(key(account));return r==='cash'||/カード|クレジット/.test(key(account))||hasCodes&&!!m&&!m.code&&['asset','liability','unknown'].includes(r)&&!/^(?:事業主[貸借]|立替経費)/.test(key(account));};
 const index=new Map();
 // 根拠として添える元の行（読み込んだCSVの行番号つき）
 const raw=(type,dim,account,tag,month)=>{const k=type+'\u0001'+dim;let ix=index.get(k);if(!ix){ix=new Map();const src=dim==='party'&&E.reportType(type)==='monthlyBS'?(session.datasets?.[type]||[]).filter(r=>r.tagDimension==='party'):(session.tagReports||[]).filter(r=>r.type===type&&r.tagDimension===dim);for(const r of src)if(!r.opening)ix.set(key(r.account)+'\u0001'+key(r.tagValue)+'\u0001'+r.date,r);index.set(k,ix);}return ix.get(key(account)+'\u0001'+key(tag)+'\u0001'+month)||null;};
 const files=new Map((session.imports||[]).filter(i=>i.importSource).map(i=>[i.importSource,i.name]));
 return {cfg,role,flow,raw,files,maps};
}
function evidence(ctx,type,dim,account,tag,month,amount){
 const r=ctx.raw(type,dim,account,tag,month);
 return {date:month,statement:E.reportType(type)==='monthlyPL'?'PL':'BS',account:`${account}（${DIMS[dim]||dim}：${tag}）`,amount:finite(r?.amount)?r.amount:amount,source:r?.source||ctx.files.get(r?.importSource)||'',line:Number.isInteger(r?.line)?r.line:'—',tagDimension:dim,tagValue:tag,importSource:r?.importSource||''};
}

// ---- PL：タグ別の収益・費用の構成
// 前年同月：前期PLの同じタグ別の帳票（または当期の帳票に含まれる前年の月）、なければ前年の仕訳（参考）
function priorValues(session,model,dim,ctx,upto){
 const pm=m=>shiftYear(m,-1),want=new Set(upto.map(pm)),out=new Map();
 const put=(account,tag,m,v)=>{const k=key(account)+'\u0001'+key(tag);let g=out.get(k);if(!g)out.set(k,g={account,tag,values:{}});g.values[m]=(g.values[m]||0)+v;};
 const reportRows=[...T.rows(session,'priorPL',dim),...T.rows(session,'monthlyPL',dim)];
 const covered=new Set();
 for(const r of reportRows)for(const [m,v] of Object.entries(r.values))if(want.has(m)&&finite(v)){covered.add(m);}
 if(covered.size){
  const seen=new Set();
  for(const r of reportRows)for(const [m,v] of Object.entries(r.values)){if(!want.has(m)||!finite(v))continue;const id=key(r.account)+'\u0001'+r.tagKey+'\u0001'+m;if(seen.has(id))continue;seen.add(id);put(r.account,r.tag,m,v);}
  return {source:'report',label:'前期のPL（'+DIMS[dim]+'別）',months:upto.filter(m=>covered.has(pm(m))),values:out};
 }
 const fields=JOURNAL_FIELDS[dim];if(!fields)return null;
 const ex=session.history?.sources||{};
 const rows=(session.datasets?.prior||[]).filter(r=>want.has(String(r.date||'').slice(0,7))&&ex[r.historySource]?.status!=='exclude');
 if(!rows.length)return null;
 const plRole=a=>a?ctx.role('monthlyPL',a):'';
 const sides=[];
 for(const r of rows){const m=r.date.slice(0,7);covered.add(m);for(const [side,i] of [['debit',0],['credit',1]]){const a=r[side],amt=r[side+'Amount'];if(!a||!finite(amt)||!amt)continue;const role=plRole(a);if(role!=='income'&&role!=='expense')continue;const tag=clean(r[fields[i]]||r[fields[2]]);sides.push({a,m,tag,v:(role==='income')===(side==='credit')?amt:-amt});}}
 // 前年の仕訳にこのタグが1件も付いていなければ比べない（列がないCSVと区別できない）
 if(!sides.some(s=>s.tag))return null;
 // 科目ごとに、前年の仕訳でこのタグを使っていたか（使っていない科目はタグ別に比べず、科目の合計だけ比べる）
 const tagged=new Set(sides.filter(s=>s.tag).map(s=>key(s.a))),accounts=new Map();
 for(const s of sides){put(s.a,s.tag||'未選択',s.m,s.v);const k=key(s.a);const g=accounts.get(k)||{};g[s.m]=(g[s.m]||0)+s.v;accounts.set(k,g);}
 return {source:'journal',label:'前年の仕訳からの集計（参考）',months:upto.filter(m=>covered.has(pm(m))),values:out,tagged,accounts};
}
function plDim(session,model,dim,ctx){
 const rows=T.rows(session,'monthlyPL',dim).filter(r=>{const role=ctx.role('monthlyPL',r.account);return role==='income'||role==='expense';});
 if(!rows.length)return null;
 const months=model.months||[],has=m=>rows.some(r=>finite(r.values[m])),nz=m=>rows.some(r=>finite(r.values[m])&&r.values[m]!==0);
 // 帳票に含まれる未経過の月（freeeは0円で出す）を最新の月にしない
 const latest=[...months].reverse().find(nz)||[...months].reverse().find(has)||null;
 const upto=latest?months.filter(m=>m<=latest&&has(m)):[],prevMonth=latest?F.prevMonth(latest):null,prev=upto.includes(prevMonth)?prevMonth:null;
 const prior=upto.length?priorValues(session,model,dim,ctx,upto):null,cmp=prior?.months||[];
 const sumOf=values=>total(upto.map(m=>values[m])),cmpOf=values=>total(cmp.map(m=>values[m])),priorOf=values=>total(cmp.map(m=>values[shiftYear(m,-1)]));
 const accounts=new Map();
 for(const r of rows){const k=key(r.account);let a=accounts.get(k);if(!a)accounts.set(k,a={account:r.account,role:ctx.role('monthlyPL',r.account),tags:[],approximate:false});a.approximate||=!!r.approximate;a.tags.push({tag:r.tag,tagKey:r.tagKey,unselected:r.unselected,values:r.values});}
 const byTagOK=k=>!!prior&&(!prior.tagged||prior.tagged.has(k));
 if(prior)for(const p of prior.values.values()){const a=accounts.get(key(p.account));if(!a||!byTagOK(key(p.account)))continue;let t=a.tags.find(t=>t.tagKey===key(p.tag));if(!t)a.tags.push(t={tag:p.tag,tagKey:key(p.tag),unselected:isUnsel(p.tag),values:{},priorOnly:true});t.priorValues=p.values;}
 const groups={income:{ytd:0,latest:0,prev:0,prior:0,current:0},expense:{ytd:0,latest:0,prev:0,prior:0,current:0}};
 const list=[...accounts.values()].map(a=>{
  const ok=byTagOK(key(a.account));
  const tags=a.tags.map(t=>{const ytd=sumOf(t.values),l=latest?t.values[latest]:null,p=prev?t.values[prev]:null,first=upto.find(m=>finite(t.values[m])&&t.values[m]!==0)||null,last=[...upto].reverse().find(m=>finite(t.values[m])&&t.values[m]!==0)||null;
   const pr=ok?priorOf(t.priorValues||{}):null,cur=prior?cmpOf(t.values):null;
   return {tag:t.tag,tagKey:t.tagKey,unselected:t.unselected,priorOnly:!!t.priorOnly,ytd,latest:finite(l)?l:null,prev:finite(p)?p:null,change:finite(l)&&finite(p)?l-p:null,prior:pr,compared:cur,yoy:ok?cur-pr:null,first,last,values:t.values};});
  const ytd=total(tags.map(t=>t.ytd)),lat=latest?total(tags.map(t=>t.latest)):null,pv=prev?total(tags.map(t=>t.prev)):null,cur=prior?total(tags.map(t=>t.compared)):null;
  const pr=!prior?null:ok?total(tags.map(t=>t.prior)):priorOf(prior.accounts?.get(key(a.account))||{});
  for(const t of tags)t.share=share(t.ytd,ytd);
  const g=groups[a.role];g.ytd+=ytd;g.latest+=lat||0;g.prev+=pv||0;if(prior){g.prior+=pr;g.current+=cur;}
  const un=tags.find(t=>t.unselected),others=tags.filter(t=>!t.unselected&&!t.priorOnly&&upto.some(m=>finite(t.values[m])&&t.values[m]!==0));
  tags.sort((x,y)=>(y.ytd-x.ytd)||(x.unselected-y.unselected)||x.tagKey.localeCompare(y.tagKey));
  return {account:a.account,role:a.role,approximate:a.approximate,priorByTag:ok,ytd,latest:lat,prev:pv,change:finite(lat)&&finite(pv)&&prev?lat-pv:null,prior:pr,compared:cur,yoy:prior?cur-pr:null,unselected:{ytd:un?un.ytd:0,share:un?share(un.ytd,ytd):0},tagsInUse:others.length,tags};
 });
 for(const a of list){const g=groups[a.role];for(const t of a.tags)t.groupShare=share(t.ytd,g.ytd);}
 list.sort((x,y)=>(x.role===y.role?0:x.role==='income'?-1:1)||Math.abs(y.ytd)-Math.abs(x.ytd));
 // タグごとに、収益・費用の科目をまとめる
 const byTag=new Map();
 for(const a of list)for(const t of a.tags){let b=byTag.get(t.tagKey);if(!b)byTag.set(t.tagKey,b={tag:t.tag,tagKey:t.tagKey,unselected:t.unselected,income:0,expense:0,sales:0,incomeLatest:0,expenseLatest:0,incomePrior:0,expensePrior:0,salesPrior:0,salesCompared:0,salesValues:{},accounts:[]});
  b[a.role]+=t.ytd;b[a.role+'Latest']+=t.latest||0;if(prior)b[a.role+'Prior']+=t.prior||0;b.accounts.push(a.account);
  if(a.role==='income'&&!OTHER_INCOME.test(key(a.account))){b.sales+=t.ytd;if(prior){b.salesPrior+=t.prior||0;b.salesCompared+=t.compared||0;}for(const m of upto)if(finite(t.values[m]))b.salesValues[m]=(b.salesValues[m]||0)+t.values[m];}}
 const tags=[...byTag.values()].map(b=>({...b,incomeShare:share(b.income,groups.income.ytd),expenseShare:share(b.expense,groups.expense.ytd),accounts:[...new Set(b.accounts)]})).sort((x,y)=>(y.income-x.income)||(y.expense-x.expense)||x.tagKey.localeCompare(y.tagKey));
 const out={dim,label:DIMS[dim]||dim,months:upto,latest,prev,prior:prior?{source:prior.source,label:prior.label,months:cmp,priorMonths:cmp.map(m=>shiftYear(m,-1))}:null,groups,accounts:list,tags,approximate:list.some(a=>a.approximate)};
 if(dim==='party')out.customers=customers(out,upto,prior);
 if(dim==='department')out.departments=departments(out,list,upto,model,ctx);
 return out;
}
// 取引先：売上の集中と、新しい・取引がなくなった取引先
function customers(pl,upto,prior){
 const salesAccounts=pl.accounts.filter(a=>a.role==='income'&&!OTHER_INCOME.test(key(a.account))).map(a=>a.account);
 const base=total(pl.tags.map(t=>t.sales)),named=pl.tags.filter(t=>!t.unselected&&t.sales>0).sort((x,y)=>y.sales-x.sales||x.tagKey.localeCompare(y.tagKey));
 const top=named.slice(0,10).map(t=>({tag:t.tag,ytd:t.sales,share:share(t.sales,base)}));
 const un=pl.tags.find(t=>t.unselected);
 const out={accounts:salesAccounts,base,count:named.length,top,top1Share:share(named[0]?.sales??0,base),top3Share:share(total(named.slice(0,3).map(t=>t.sales)),base),unselected:un?un.sales:0,unselectedShare:share(un?un.sales:0,base)};
 // 前年の売上に取引先が付いていないと、新しい・なくなった取引先は判定できない
 if(prior&&prior.months.length&&pl.accounts.filter(a=>salesAccounts.includes(a.account)).every(a=>a.priorByTag)){
  out.basis='prior';out.compareMonths=prior.months;
  out.added=pl.tags.filter(t=>!t.unselected&&t.salesCompared>0&&t.salesPrior<=0).map(t=>({tag:t.tag,ytd:t.salesCompared})).sort((x,y)=>y.ytd-x.ytd);
  out.lost=pl.tags.filter(t=>!t.unselected&&t.salesPrior>0&&t.salesCompared<=0).map(t=>({tag:t.tag,prior:t.salesPrior})).sort((x,y)=>y.prior-x.prior);
 }else if(upto.length>=4){
  // 前年の資料がないときは、当期の中で見る（直近3か月）
  const recent=upto.slice(-3),earlier=upto.slice(0,-3),on=(t,ms)=>ms.some(m=>(t.salesValues[m]||0)>0);
  out.basis='period';out.recentMonths=recent;
  out.added=pl.tags.filter(t=>!t.unselected&&on(t,recent)&&!on(t,earlier)).map(t=>({tag:t.tag,ytd:t.sales,first:recent.find(m=>(t.salesValues[m]||0)>0)})).sort((x,y)=>y.ytd-x.ytd);
  out.lost=pl.tags.filter(t=>!t.unselected&&on(t,earlier)&&!on(t,recent)).map(t=>({tag:t.tag,ytd:t.sales,last:[...earlier].reverse().find(m=>(t.salesValues[m]||0)>0)})).sort((x,y)=>y.ytd-x.ytd);
 }else{out.basis=null;out.added=[];out.lost=[];}
 return out;
}
// 部門別損益：部門ごとの収益 − 費用。未選択には部門を付けていない金額（共通費など）が入る
function departments(pl,list,upto,model,ctx){
 const by=new Map(),zero=()=>({income:0,expense:0});
 for(const a of list)for(const t of a.tags){if(t.priorOnly)continue;let d=by.get(t.tagKey);if(!d)by.set(t.tagKey,d={tag:t.tag,tagKey:t.tagKey,unselected:t.unselected,values:{}});for(const m of upto){if(!finite(t.values[m]))continue;const v=d.values[m]||(d.values[m]=zero());v[a.role]+=t.values[m];}}
 const fin=d=>{let inc=0,exp=0;for(const m of upto){const v=d.values[m];if(!v)continue;v.profit=v.income-v.expense;inc+=v.income;exp+=v.expense;}d.ytd={income:inc,expense:exp,profit:inc-exp,margin:inc>0?(inc-exp)/inc:null};return d;};
 const rows=[...by.values()].map(fin).sort((x,y)=>(x.unselected-y.unselected)||(y.ytd.income-x.ytd.income)||(y.ytd.profit-x.ytd.profit)||x.tagKey.localeCompare(y.tagKey));
 const sumRow={tag:'合計',values:{}};for(const m of upto){const v=zero();for(const d of rows){const x=d.values[m];if(x){v.income+=x.income;v.expense+=x.expense;}}sumRow.values[m]=v;}fin(sumRow);
 const tagged=new Set(list.map(a=>key(a.account)));
 const missing=(model.plReference||[]).filter(g=>{const r=ctx.role('monthlyPL',g.account);return (r==='income'||r==='expense')&&!tagged.has(key(g.account))&&upto.some(m=>finite(g.values[m])&&g.values[m]!==0);}).map(g=>g.account);
 const un=rows.find(d=>d.unselected);
 return {rows,total:sumRow,unselected:un?un.ytd:null,missingAccounts:missing};
}

// ---- BS：タグ別の残高の分類と、気になるもの
function bsAsOf(model){
 // 帳票に含まれる未経過の月（freeeは最後の月の残高を繰り返す）は数えない：どの科目も前月から動いていない月が続く末尾を除く
 const months=(model.months||[]).filter(m=>(model.bs||[]).some(g=>finite(g.values[m])));
 let i=months.length-1;
 while(i>0){const m=months[i],p=months[i-1];if((model.bs||[]).some(g=>['summary'].includes(g.role)?false:finite(g.values[m])&&g.values[m]!==g.values[p]))break;i--;}
 return months[i]||null;
}
function bsDim(session,model,dim,ctx,asOf){
 const rows=T.rows(session,'monthlyBS',dim);if(!rows.length||!asOf)return null;
 const months=(model.months||[]).filter(m=>m<=asOf);
 const by=new Map();for(const r of rows){const k=key(r.account);let a=by.get(k);if(!a)by.set(k,a={account:r.account,rows:[]});a.rows.push(r);}
 const accounts=[];
 for(const a of by.values()){
  const role=ctx.role('monthlyBS',a.account);if(role==='summary')continue;
  const flow=ctx.flow(a.account),un=a.rows.find(r=>r.unselected),others=a.rows.filter(r=>!r.unselected);
  const nonzero=v=>finite(v)&&v!==0,unNonzero=!!un&&(nonzero(un.opening)||Object.values(un.values).some(nonzero));
  const state=!others.length?'untagged':unNonzero?'residual':'clean';
  const points=r=>{const ps=[];if(finite(r.opening))ps.push({m:'',v:r.opening});for(const m of months)if(finite(r.values[m]))ps.push({m,v:r.values[m]});return ps;};
  const at=r=>finite(r.values[asOf])?r.values[asOf]:null;
  const clearing=CLEARING.test(key(a.account))&&!flow&&!(dim==='party'&&PARTY_SKIP.test(key(a.account))),settle=SETTLE.test(key(a.account))&&!flow;
  const stat=[],neg=[];
  if(clearing&&state!=='untagged')for(const r of others){const ps=points(r),last=ps.at(-1);if(!last||last.m!==asOf||last.v===0)continue;let i=ps.length-1;while(i>0&&ps[i-1].v===last.v)i--;const n=ps.length-i;if(n>=STATIC_POINTS)stat.push({tag:r.tag,tagKey:r.tagKey,amount:last.v,since:ps[i].m||'期首',fromOpening:!ps[i].m,points:n,months:n-1});}
  if(settle&&state==='clean')for(const r of others){const ps=points(r),last=ps.at(-1);if(!last||last.m!==asOf||last.v>=0)continue;let i=ps.length-1;while(i>0&&ps[i-1].v<0)i--;neg.push({tag:r.tag,tagKey:r.tagKey,amount:last.v,since:ps[i].m||'期首',points:ps.length-i,months:ps.length-i});}
  stat.sort((x,y)=>Math.abs(y.amount)-Math.abs(x.amount)||x.tagKey.localeCompare(y.tagKey));neg.sort((x,y)=>x.amount-y.amount||x.tagKey.localeCompare(y.tagKey));
  const g=ctx.maps.monthlyBS.get(key(a.account)),bal=g&&finite(g.values[asOf])?g.values[asOf]:null;
  const tagAt=others.map(r=>at(r)).filter(finite);
  accounts.push({account:a.account,role,flow,state,clearing,settle,balance:bal,unselected:un?at(un):null,tags:others.length,nonzeroTags:tagAt.filter(v=>v!==0).length,absTotal:total(tagAt.map(Math.abs)),approximate:a.rows.some(r=>r.approximate),static:stat,negative:neg});
 }
 const order=new Map((model.bs||[]).map((g,i)=>[key(g.account),i]));
 accounts.sort((x,y)=>(order.get(key(x.account))??1e9)-(order.get(key(y.account))??1e9)||key(x.account).localeCompare(key(y.account)));
 return {dim,label:DIMS[dim]||dim,asOf,accounts,clearing:accounts.filter(a=>a.static.length),negative:accounts.filter(a=>a.negative.length)};
}

// ---- 資料の確認：内訳の合計が合わない・帳票どうしの食い違い
function checks(session){
 const mismatch=[],conflict=[];
 for(const i of session.imports||[]){
  const dim=T.slotOf(i);if(!dim)continue;const tc=i.reportStats?.tagCheck;
  if(tc?.dropped?.length)mismatch.push({type:i.type,dim,label:DIMS[dim]||dim,file:i.name||'',importSource:i.importSource||'',accounts:tc.dropped.slice(),mismatches:(tc.mismatches||[]).slice(0,6)});
  // 後から取り込んだ帳票と科目合計が合わず、外れた内訳（取込時の件数より少ない）
  const expected=i.reportStats?.tagRows;if(!i.importSource||!finite(expected)||expected<=0)continue;
  const src=dim==='party'&&E.reportType(i.type)==='monthlyBS'?(session.datasets?.[i.type]||[]).filter(r=>r.tagDimension==='party'):(session.tagReports||[]).filter(r=>r.type===i.type&&r.tagDimension===dim);
  if(src.length&&!src.some(r=>r.importSource))continue;
  const mine=src.filter(r=>r.importSource===i.importSource);
  if(mine.length<expected){
   const present=new Set(mine.map(r=>key(r.account))),before=[...new Set((i.reportStats.detailReportedTotals||[]).map(x=>x.account))].filter(a=>!present.has(key(a)));
   conflict.push({kind:'removed',type:i.type,dim,label:DIMS[dim]||dim,file:i.name||'',importSource:i.importSource,removed:expected-mine.length,kept:mine.length,accounts:before});
  }
 }
 // いま持っている内訳の合計と科目合計の照合（追加読込・古い保存データの食い違いを拾う）
 for(const type of T.REPORT_TYPES)for(const dim of dimsOf(session,type)){
  const totals=new Map(),dup=new Set();
  for(const r of session.datasets?.[type]||[]){if(r.tagDimension)continue;const k=key(r.account)+'\u0001'+r.date+(r.opening?'\u0001o':'');if(totals.has(k)&&totals.get(k)!==r.amount)dup.add(k);totals.set(k,r.amount);}
  const sums=new Map(),src=dim==='party'&&E.reportType(type)==='monthlyBS'?(session.datasets?.[type]||[]).filter(r=>r.tagDimension==='party'):(session.tagReports||[]).filter(r=>r.type===type&&r.tagDimension===dim);
  for(const r of src){const k=key(r.account)+'\u0001'+r.date+(r.opening?'\u0001o':'');let g=sums.get(k);if(!g)sums.set(k,g={account:r.account,date:r.date,sum:0,n:0,bad:false,approx:false});if(finite(r.amount)){g.sum+=r.amount;g.n++;}else g.bad=true;g.approx||=r.unit===1000;}
  const diffs=[];
  for(const [k,g] of sums){if(g.bad||!g.n||dup.has(k)||!totals.has(k))continue;const t=totals.get(k);if(!finite(t))continue;const tol=g.approx?g.n*1000:0;if(Math.abs(t-g.sum)>tol)diffs.push({account:g.account,month:g.date,total:t,sum:g.sum,diff:t-g.sum});}
  if(diffs.length){diffs.sort((x,y)=>x.account.localeCompare(y.account)||x.month.localeCompare(y.month));conflict.push({kind:'live',type,dim,label:DIMS[dim]||dim,accounts:[...new Set(diffs.map(d=>d.account))],mismatches:diffs.slice(0,6),count:diffs.length});}
 }
 return {mismatch,conflict};
}

function build(session,model){
 const materials=T.materials(session),any=(session.tagReports||[]).length>0||T.REPORT_TYPES.some(t=>T.has(session,t,'party'));
 // 科目合計の月（読込の記録に月がない古い保存データでも表示できるように、行から求める）
 const totalsMonths=Object.fromEntries(T.REPORT_TYPES.map(t=>[t,[...new Set((session.datasets?.[t]||[]).filter(r=>!r.tagDimension&&!r.opening&&r.date).map(r=>r.date))].sort()]));
 const out={version:1,materials,totalsMonths,any,pl:{},bs:{},plDims:[],bsDims:[],asOf:null,notes:[],checks:{mismatch:[],conflict:[]},unselected:[]};
 if(!any)return out;
 const ctx=context(session,model);
 for(const dim of dimsOf(session,'monthlyPL')){const r=plDim(session,model,dim,ctx);if(r){out.pl[dim]=r;out.plDims.push(dim);}}
 out.asOf=bsAsOf(model);
 for(const dim of dimsOf(session,'monthlyBS')){const r=bsDim(session,model,dim,ctx,out.asOf);if(r){out.bs[dim]=r;out.bsDims.push(dim);}}
 out.checks=checks(session);
 // 付け漏れの候補：他のタグを使っている科目で、未選択の割合が大きいもの
 for(const dim of out.plDims){const p=out.pl[dim];for(const a of p.accounts)if(a.tagsInUse&&a.ytd>0&&a.unselected.ytd>=UNSEL_MIN&&a.unselected.share>=UNSEL_SHARE)out.unselected.push({dim,label:p.label,account:a.account,role:a.role,ytd:a.ytd,amount:a.unselected.ytd,share:a.unselected.share,months:p.months,latest:p.latest});}
 if([...Object.values(out.pl),...Object.values(out.bs)].some(x=>x.approximate))out.notes.push('千円単位の帳票は切り捨て済みの概数です。円単位で出力すると、内訳の確認が正確になります。');
 // 関数を含むので、保存・複製（JSON・structuredClone）の対象にしない
 Object.defineProperty(out,'ctx',{value:ctx,enumerable:false});
 return out;
}

// ---- 確認キュー
function addFindings(model,session,add){
 const ta=model.tagAnalysis;if(!ta||!ta.any)return;const ctx=ta.ctx||context(session,model);
 const typeName=t=>E.TYPES[t]?.name||t,period=ms=>ms.length?ms[0]+'〜'+ms.at(-1):'';
 const opts=(kind,type,dim,account,tag,extra)=>({monthlyCheck:true,sources:['monthly','freee'],reviewContext:JSON.stringify(['tag-report',kind,type,dim,account||'',tag||'']),tagReportCheck:kind,...(account?{account}:{}),...extra});
 for(const x of ta.checks.mismatch){
  const ex=x.mismatches.slice(0,3).map(m=>`${m.account} ${m.month}：科目合計 ${yen(m.total)}円／内訳の合計 ${yen(m.sum)}円（差 ${yen(m.diff)}円）`).join('、');
  add('monthly',`${typeName(x.type)}（${x.label}別）：内訳の合計が科目合計と合わない科目があります（${x.accounts.length}科目）`,`「${x.file}」の${x.label}別の内訳を足すと、${ex}${x.mismatches.length>3?' ほか':''}。合わない ${x.accounts.join('・')} の内訳は取り込まず、科目合計だけを使っています。`,total(x.mismatches.map(m=>Math.abs(m.diff))),[],opts('tag-mismatch',x.type,x.dim,'','',{level:'candidate',dataReview:true,
   basis:'取込時に、科目ごと・月ごとに「内訳の合計＝科目合計」を照合した結果（円単位は一致、千円単位は内訳の数×1,000円まで許容）。',
   lesson:'freeeの同じ帳票なら、内訳の合計は科目合計と一致します。合わないときは、出力の途中で仕訳が変わった、千円単位で出力した、別の条件（期間・部門の絞り込み）で出力した、などが考えられます。',
   steps:['freeeの月次推移で、同じ期間・円単位・「表示するタグ」を選び直してCSVを出力する。','この画面で同じ帳票の「CSV読込」から置き換えて取り込む。','それでも合わない場合は、該当の科目・月の仕訳をfreeeで確認する。']}));
 }
 for(const x of ta.checks.conflict){
  if(x.kind==='removed'){
   add('monthly',`${typeName(x.type)}（${x.label}別）：他の帳票と科目合計が合わず、内訳の一部を外しました`,`「${x.file}」の${x.label}別の内訳 ${yen(x.removed)}件を外しています${x.accounts.length?`（${x.accounts.slice(0,8).join('・')}${x.accounts.length>8?' ほか':''}）`:''}。後から取り込んだ帳票と、同じ科目・同じ月の科目合計が違ったためです。`,0,[],opts('tag-conflict',x.type,x.dim,'','',{level:'candidate',dataReview:true,
    basis:'帳票の取込時に、読込済みの科目合計と新しい帳票の科目合計を科目・月ごとに比べた結果。',
    lesson:'帳票を出力した時点の間に仕訳が変わると、タグ別の帳票どうしで科目合計が食い違います。新しい帳票の科目合計を使い、合わない古い内訳は外しています。',
    steps:[`freeeで${x.label}別の${typeName(x.type)}を出力し直す。`,'この画面の「CSV読込」から置き換えて取り込む（他のタグ別の帳票と同じ日に出力すると食い違いません）。']}));
  }else{
   const ex=x.mismatches.slice(0,3).map(m=>`${m.account} ${m.month}：科目合計 ${yen(m.total)}円／内訳の合計 ${yen(m.sum)}円`).join('、');
   add('monthly',`${typeName(x.type)}（${x.label}別）：保存されている内訳が科目合計と合いません（${x.accounts.length}科目）`,`${ex}${x.count>3?' ほか':''}。追加で読み込んだ帳票や、以前の保存データとの組み合わせで食い違っています。`,total(x.mismatches.map(m=>Math.abs(m.diff))),[],opts('tag-conflict',x.type,x.dim,'','',{level:'candidate',dataReview:true,
    basis:'保存されている科目合計と、タグ別の内訳の合計を科目・月ごとに照合した結果。',
    lesson:'内訳と科目合計が合わない状態では、内訳の割合や残高を正しく読めません。同じ時点で出力した帳票にそろえます。',
    steps:['科目合計の帳票（タグなし）と、タグ別の帳票を同じ日にfreeeから出力する。','「CSV読込」でそれぞれ置き換えて取り込む。']}));
  }
 }
 for(const u of ta.unselected){
  const dept=u.dim==='department',words=u.role==='income'?'売上・収益':'費用';
  const r=evidence(ctx,'monthlyPL',u.dim,u.account,'未選択',u.latest,null);
  add('monthly',`${u.account}：${u.label}が付いていない金額が ${pct(u.share)}あります`,`${period(u.months)}の${u.account} ${yen(u.ytd)}円のうち、${u.label}が「未選択」の金額が ${yen(u.amount)}円（${pct(u.share)}）。この科目では他の${u.label}も使っているため、付け漏れの可能性があります。`,u.amount,r.line!=='—'?[r]:[],opts('tag-unselected','monthlyPL',u.dim,u.account,'未選択',{level:dept?'info':'candidate',dataReview:false,months:u.months,
   basis:`${u.label}別の月次PLで、${u.label}が未選択の金額が科目の${Math.round(UNSEL_SHARE*100)}%以上（${yen(UNSEL_MIN)}円以上）の科目。`,
   lesson:dept?`部門を付けていない${words}は、部門別の損益に入りません。共通費として部門を付けない運用なら問題ありませんが、特定の部門の${words}なら部門を付けると部門別の損益が正しくなります。`:`${u.label}が付いていない${words}は、${u.label}ごとの集計・前年比較・${u.dim==='party'?'回収や支払の確認':'構成の分析'}から漏れます。自計化では、登録のルール（自動登録ルール・取引の入力画面）で付け忘れが起きやすいところです。`,
   steps:[`freeeの仕訳帳で${u.account}を${u.label}「未選択」で絞り込む。`,`内容から${u.label}が分かるものは付け直す（自動登録ルールにも${u.label}を設定する）。`,dept?'共通費として部門を付けない方針なら、その旨をメモに残す。':'付けられないもの（少額・まとめ払いなど）は、理由をメモに残す。']}));
 }
 for(const dim of ta.bsDims){const b=ta.bs[dim];
  for(const a of b.clearing){
   const xs=a.static,amount=total(xs.map(x=>Math.abs(x.amount))),list=xs.slice(0,5).map(x=>`${x.tag} ${yen(x.amount)}円（${x.fromOpening?'期首':x.since+'末'}から変わらず）`).join('、');
   const rows=xs.slice(0,3).map(x=>evidence(ctx,'monthlyBS',dim,a.account,x.tag,b.asOf,x.amount));
   add('monthly',`${a.account}：${b.label}ごとに見ると、精算されずに残っている金額があります（${xs.length}件）`,`${b.asOf}末の${b.label}別の${a.account}で、${list}${xs.length>5?` ほか${xs.length-5}件`:''}。${a.state==='residual'?`科目の残高は ${finite(a.balance)?yen(a.balance)+'円':'—'}で、${b.label}が未選択の金額（${finite(a.unselected)?yen(a.unselected)+'円':'—'}）と相殺されています。`:''}`,amount,rows,opts('tag-clearing','monthlyBS',dim,a.account,'',{level:'candidate',dataReview:false,months:[b.asOf],
    basis:`${b.label}別の月次BSで、精算される科目の${b.label}ごとの累計が0円でなく、${STATIC_POINTS-1}か月以上動いていないもの（月末の残高が${STATIC_POINTS}回以上続けて同じ）。預り金・立替経費の取引先別は、相手が入れ替わるため対象外。`,
    lesson:a.state==='residual'?`立替・仮払・預りは、発生と精算の両方に同じ${b.label}が付けば0円に戻ります。科目の残高が合っていても${b.label}ごとに残るのは、精算の仕訳に${b.label}を付けていない（未選択で相殺）か、付け違い、または精算漏れのためです。`:`立替・仮払・預りは、精算されると0円に戻ります。${b.label}ごとに同じ金額が残り続けるのは、精算漏れ、または精算の仕訳の${b.label}の付け違いの可能性があります。`,
    steps:[`freeeの仕訳帳で${a.account}を${b.label}で絞り込み、発生と精算の仕訳を並べる。`,`精算の仕訳に${b.label}が付いていない・違う${b.label}が付いているものは付け直す。`,'精算されていないものは、精算の予定と相手をお客様に確認する。']}));
  }
  for(const a of b.negative){
   const xs=a.negative,receipt=/^(?:売掛金|未収入金|未収金)$/.test(key(a.account)),amount=total(xs.map(x=>x.amount)),list=xs.slice(0,5).map(x=>`${x.tag} ${yen(x.amount)}円（${x.since==='期首'?'期首':x.since+'末'}から）`).join('、');
   const rows=xs.slice(0,3).map(x=>evidence(ctx,'monthlyBS',dim,a.account,x.tag,b.asOf,x.amount));
   add('monthly',`${a.account}：${b.label}別の残高がマイナスのものがあります（${xs.length}件）`,`${b.asOf}末の${b.label}別の${a.account}で、${list}${xs.length>5?` ほか${xs.length-5}件`:''}。${receipt?'請求より入金が多い状態です。':'計上より支払が多い状態です。'}`,amount,rows,opts('tag-negative','monthlyBS',dim,a.account,'',{level:'candidate',dataReview:false,months:[b.asOf],
    basis:`${b.label}別の月次BSで、未選択に相殺額がない（${b.label}ごとの値が残高と読める）${a.account}のうち、${b.asOf}末の残高がマイナスのもの。`,
    lesson:receipt?'売掛金・未収入金のマイナスは、過入金（二重入金・前受）、入金の取引先の付け違い、請求の計上漏れ、消込の誤りで起こります。前受なら前受金への振替も検討します。':'買掛金・未払金のマイナスは、二重払い、支払の取引先の付け違い、請求書の計上漏れ、前払で起こります。前払なら前払金への振替も検討します。',
    steps:[`freeeの仕訳帳で${a.account}を該当の${b.label}で絞り込み、${receipt?'請求と入金':'計上と支払'}を並べる。`,receipt?'通帳と請求書で、入金の相手と金額を確認する。':'通帳と請求書で、支払の相手と金額を確認する。','付け違い・計上漏れは修正し、過入金・過払いならお客様に返金・相殺の予定を確認する。']}));
  }
 }
}
F.addFindings=function(model,session,add){originalFindings(model,session,add);try{addFindings(model,session,add);}catch(err){if(typeof console!=='undefined')console.warn('ReviewTagAnalysis findings',err);}};
F.build=function(session,current,months){
 const model=originalBuild(session,current,months);
 try{model.tagAnalysis=build(session,model);}catch(err){model.tagAnalysis={version:1,error:String(err?.message||err),any:false,materials:[],pl:{},bs:{},plDims:[],bsDims:[],checks:{mismatch:[],conflict:[]},unselected:[],notes:[]};if(typeof console!=='undefined')console.warn('ReviewTagAnalysis',err);}
 return model;
};
root.ReviewTagAnalysis={build,addFindings,checks,CLEARING,SETTLE,version:1};
})(typeof window!=='undefined'?window:globalThis);

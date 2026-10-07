(function(root){
'use strict';
// ReviewPartyOpening：売掛金・未収入金・買掛金・未払金・未払費用の「取引先別の期首残高」を、
// 読み込んだ過去の仕訳帳から推定し、当期の回収・支払の状況（残っている未回収・未払、主要な取引先）を出す。
// 取引先内訳つきのBS（当期BS・前期BS、またはそこから連続する仕訳で繰り越した値）がある取引先は、その確定値を使う。
// 確定値（settlement.parties の opening・closing など）には書き込まず、model.partyOpening に分けて置く。
//
// 推定の方法（科目ごと・取引先ごと）
//  1. 期首の前月末から過去へ、仕訳を連続して読める月（読取エラー・資料間の重複・参照除外がない月）だけを使う。
//     仕訳が1件もない月は、同じCSVの期間（最初〜最後の取引日）の内側にあるときだけ「取引のない月」として続けて読む。
//  2. 同じ仕訳の中の同じ取引先・同じ向きの行はまとめて1件とし、日付順に、増えた分（請求・仕入）を積み、減った分
//     （入金・支払）で消し込む。同じ金額の請求（または続いた請求の合計がちょうど一致するもの）があればそれを、なければ
//     古いものから消し込む（先入先出）。
//  3. 読込範囲の始め（3か月）で、消し込む相手がない減少、または残っている請求が後で同じ金額で入金されている減少は、
//     読込範囲より前からの残高の回収・支払とみなす（それ以上の残高はないとした最小額）。
//     それ以外で消し込む相手がない減少は、前受・過入金（マイナスの残高）として次の請求に当てる。
//  4. 取引先が未選択の減少は、同じ金額の未消込が1社だけにあればその取引先に当てる（候補として記録し、当てない値も残す）。
//  5. 推定の合計をBSの期首と比べ、差は「内訳不明」として残し、取引先には配分しない。合計の一致は内訳の証明ではない。
//  6. 支払・入金の多くに取引先が付いていない科目（カード払いの未払金など）は、取引先別の状態を判定しない。
// 推定はあくまで仮定に基づく参考値で、請求書・入金明細との消込の確認結果ではない。延滞・期日超過も確定しない。
const E=root.ReviewEngine,F=root.ReviewFinancial,S=root.ReviewSettlement;
if(!E||!F||!S||typeof F.build!=='function')throw Error('ReviewPartyOpening requires ReviewEngine, ReviewFinancial and ReviewSettlement.');
const originalBuild=F.build,originalFindings=F.addFindings;
const clean=v=>String(v??'').normalize('NFKC').trim(),key=v=>clean(v).replace(/[\s　]/g,''),finite=Number.isSafeInteger;
const month=d=>clean(d).slice(0,7),uniq=xs=>[...new Set(xs)];
const nextMonth=m=>{const [y,n]=m.split('-').map(Number);return new Date(Date.UTC(y,n,1)).toISOString().slice(0,7);};
const prevMonth=m=>F.prevMonth(m);
const endDay=m=>new Date(Date.UTC(+m.slice(0,4),+m.slice(5),0)).toISOString().slice(0,10);
const days=(a,b)=>Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);
const median=xs=>{const a=xs.filter(Number.isFinite).sort((x,y)=>x-y),n=a.length;return n?n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2:null;};
const total=xs=>xs.reduce((n,v)=>n+v,0);
const yen=n=>Number(n).toLocaleString('ja-JP');
const RECEIPT=/^(?:売掛金|未収入金|未収金)$/,PAYMENT=/^(?:買掛金|未払金|未払費用)$/;
function kindOf(account){const k=key(account);return RECEIPT.test(k)?'receipt':PAYMENT.test(k)?'payment':null;}
// 対象科目と同じ側の取引先。CSVに借貸別の列があれば、空欄は「未選択」のまま（反対側から借りない）。
function partyOf(r,side){
 const field=side+'Party',v=clean(r[field]);if(v)return v;
 if(r.fieldOrigins&&Object.hasOwn(r.fieldOrigins,field)&&r.fieldOrigins[field]>=0)return '';
 return clean(r.party);
}
const WORDS={
 receipt:{settled:'残高なし',credit:'入金が請求を上回る',normal:'未回収（ふだんの範囲）',late:'ふだんより回収が遅い可能性',long:'長く未回収の可能性',unknown:'判定できません',inc:'請求・売上',dec:'入金・回収',open:'未回収',act:'回収'},
 payment:{settled:'残高なし',credit:'支払が計上を上回る',normal:'未払（ふだんの範囲）',late:'ふだんより支払が遅い可能性',long:'長く未払の可能性',unknown:'判定できません',inc:'仕入・計上',dec:'支払',open:'未払',act:'支払'}
};
const SEVERITY={long:0,late:1,credit:2,normal:3,settled:4,unknown:5};

// ---- 仕訳の読込状態（月ごと）
// 金額・借貸の誤りは、その仕訳が触れる科目だけを止める（他の科目の行を隠すことはないため）。
// 読取エラー・資料間の重複・参照除外・番号の未確定などは、その月のすべての科目を止める。
const LOCAL=new Set(['借貸金額が円単位の安全な整数として確定できません。','仕訳全体の借貸が一致しません。','マイナス金額の仕訳があります。']);
function monthStates(session,js){
 const present=new Set(),bad=new Map(),local=new Map(),quiet=new Set();
 for(const g of js.all){const m=month(g.date);if(!/^\d{4}-\d{2}$/.test(m))continue;present.add(m);if(g.valid)continue;
  if(g.reasons.every(r=>LOCAL.has(r))){const l=local.get(m)||[];l.push({accounts:new Set(g.rows.flatMap(r=>[key(r.debit),key(r.credit)])),reasons:g.reasons});local.set(m,l);}
  else{const l=bad.get(m)||[];l.push(...g.reasons);bad.set(m,l);}}
 for(const i of session.imports||[]){
  if(!['prior','current'].includes(i.type)||i.errors>0||!/^\d{4}-\d{2}/.test(i.minDate||'')||!/^\d{4}-\d{2}/.test(i.maxDate||''))continue;
  const src=i.importSource?'hsrc:'+String(i.importSource).slice(4):null;if(src&&session.history?.sources?.[src]?.status==='exclude')continue;
  for(let m=nextMonth(month(i.minDate)),n=0;m<month(i.maxDate)&&n<600;m=nextMonth(m),n++)if(!present.has(m))quiet.add(m);
 }
 // account を渡すと、その科目に触れる金額・借貸の誤りも止める月に入れる（null は全科目に共通の理由だけ）
 const forAccount=account=>{
  const k=account==null?null:key(account),b=new Map(bad);
  if(k!==null)for(const [m,l] of local)for(const x of l)if(x.accounts.has(k))b.set(m,[...(b.get(m)||[]),...x.reasons]);
  return {usable:m=>!b.has(m)&&(present.has(m)||quiet.has(m)),bad:b,present,quiet};
 };
 return {forAccount};
}
function stopReason(ms,m){return ms.bad.has(m)?uniq(ms.bad.get(m)).join(' '):ms.present.has(m)||ms.quiet.has(m)?'':'仕訳が読み込まれていません。';}
// 期首の前月末から過去へ連続して読める範囲。途切れた月と理由も返す。
function historyWindow(ms,prev){
 let from=null,n=0,m=prev;
 for(let i=0;i<600&&ms.usable(m);i++){from=m;n++;m=prevMonth(m);}
 return {start:from,end:from?prev:null,months:n,stopMonth:from?m:prev,stopReason:stopReason(ms,from?m:prev)};
}
// 当期：期首月から連続して読める最後の月（読めない最初の月と理由も返す）
function observedThrough(ms,months){let t=null;for(const m of months){if(!ms.usable(m))return {through:t,stop:m,reason:stopReason(ms,m)};t=m;}return {through:t,stop:null,reason:''};}

// ---- 1科目の消込シミュレーション
// opt.matchUntagged：未選択の減少を金額一致で取引先に当てるか／opt.override：確定期首（取引先 → {amount,label}）／opt.openingDate：期首日
function simulate(js,account,kind,win,through,start,opt={}){
 const matchUntagged=opt.matchUntagged!==false,override=opt.override||new Map(),openingDate=opt.openingDate;
 const leadEnd=win.start?nextMonth(nextMonth(win.start)):null,sign=side=>kind==='receipt'?(side==='debit'?1:-1):(side==='credit'?1:-1);
 // 同じ仕訳の同じ取引先・同じ向きの行はまとめる（手数料を別行にした入金、明細ごとの請求行など）
 const merged=new Map();
 for(const g of js.valid){
  const m=month(g.date);if(win.start?m<win.start:m<start)continue;if(through?m>through:m>=start)continue;
  for(const r of g.rows)for(const side of ['debit','credit']){
   if(key(r[side])!==key(account))continue;const raw=r[side+'Amount'];if(!finite(raw)||raw===0)continue;
   const label=partyOf(r,side),amount=sign(side)*raw,id=g.journalKey+'\u0001'+key(label)+'\u0001'+(amount>0?'+':'-');
   const e=merged.get(id);if(e){e.amount+=amount;e.rows.push(r);}else merged.set(id,{date:g.date,month:m,party:key(label),label:label||'未選択',amount,row:r,rows:[r],journalKey:g.journalKey,current:m>=start});
  }
 }
 const events=[...merged.values()].filter(e=>e.amount!==0);
 // 同じ日は増加を先に（同日の請求と入金を消し込めるように）、その後は仕訳の順
 events.sort((a,b)=>a.date.localeCompare(b.date)||(b.amount>0)-(a.amount>0)||String(a.journalKey).localeCompare(String(b.journalKey)));
 // 取引先ごとの増減の並び（読込範囲の始めで、残っている請求が後で同額入金されるかを見るため）
 const byParty=new Map();events.forEach((e,i)=>{let l=byParty.get(e.party);if(!l)byParty.set(e.party,l=[]);l.push({i,amount:e.amount});});
 const parties=new Map();let openingTaken=false,index=0;
 const state=(k,label)=>{let p=parties.get(k);if(!p)parties.set(k,p={party:k,label:k?label:'未選択',untagged:!k,queue:[],credit:0,preWindow:0,preWindowRows:[],lags:[],matchedIn:[],matchedOut:[],exactMatches:0,hadIncrease:false,openingSettled:0,unmatchedDecrease:0,unmatchedEvents:[],totalDecrease:0,flows:{},increase:0,decrease:0,histIncrease:0,rows:[],opening:openingTaken?0:null,openItemsAtOpening:openingTaken?[]:null,creditAtOpening:0,firstDate:null,lastDate:null,currentEvents:0,openingBasis:null});else if(k&&label&&p.label==='未選択')p.label=label;return p;};
 const takeOpening=()=>{
  if(openingTaken)return;openingTaken=true;
  // 確定期首のある取引先は、その金額を期首時点の1件として置き直す（推定の積み上げは使わない）
  for(const [k,x] of override){const p=state(k,x.label);p.estimatedOpening=total(p.queue.map(i=>i.amount))-p.credit;p.queue=x.amount>0?[{date:openingDate,amount:x.amount,original:x.amount,preWindow:false,exactAdjust:true,row:null}]:[];p.credit=x.amount<0?-x.amount:0;p.preWindow=0;p.openingBasis='exact';p.exactSource=x.source;}
  for(const p of parties.values()){p.opening=total(p.queue.map(i=>i.amount))-p.credit;p.openItemsAtOpening=p.queue.map(i=>({...i}));p.creditAtOpening=p.credit;for(const i of p.queue)i.atOpening=true;}
 };
 const add=(p,e,amount)=>{
  p.hadIncrease=true;let a=amount;if(p.credit>0){const use=Math.min(p.credit,a);p.credit-=use;a-=use;}
  if(a>0)p.queue.push({date:e.date,amount:a,original:amount,preWindow:false,row:e.row});
 };
 const settle=(p,it,e)=>{if(!it.preWindow&&!it.exactAdjust&&it.date)p.lags.push(days(it.date,e.date));};
 // 期首に残っていた分が当期に消し込まれた額（期首の推定が当期の入金・支払で裏付けられたか）
 const used=(p,it,amount,e)=>{if(it.atOpening&&e.current)p.openingSettled+=amount;};
 const take=(p,i,e)=>{const it=p.queue.splice(i,1)[0];used(p,it,it.amount,e);settle(p,it,e);return it;};
 const consume=(p,e,amount,history)=>{
  const lead=history&&!!leadEnd&&e.month<=leadEnd;
  if(!p.untagged){
   // 同じ金額の未消込（古い順）
   const i=p.queue.findIndex(it=>it.amount===amount);
   if(i>=0){take(p,i,e);p.exactMatches++;return;}
   // 続いた未消込（最大6件）の合計がちょうど一致（まとめ払い）
   for(let s=0;s<p.queue.length;s++){let acc=0;for(let k=s;k<p.queue.length&&k<s+6&&acc<amount;k++){acc+=p.queue[k].amount;if(acc===amount&&k>s){for(let n=k;n>=s;n--)take(p,n,e);p.exactMatches++;return;}}}
   // 読込範囲の始めで金額の一致する消込がまだない：消し込む相手がない、または残っている請求が後で同じ金額で
   // 入金・支払されているなら、読込範囲より前の残高の回収・支払とみなす
   // 「後で同額入金される」は、同じ金額の後の請求の分を除いても、残っている請求の数だけ同額の入金があるときだけ
   // （毎月同じ金額の請求で一部入金・まとめ入金がある取引先を、読込範囲より前の分と取り違えないため）
   if(lead&&!p.exactMatches){
    const later=(byParty.get(p.party)||[]).filter(x=>x.i>index),count=(a,sign)=>later.filter(x=>x.amount===sign*a).length;
    const reserved=it=>count(it.amount,-1)>=p.queue.filter(j=>j.amount===it.amount).length+count(it.amount,1);
    if(!p.queue.length||p.queue.some(reserved)){p.preWindow+=amount;p.preWindowRows.push(e.row);return;}
   }
  }
  let a=amount;
  while(a>0&&p.queue.length){const it=p.queue[0],use=Math.min(it.amount,a);it.amount-=use;a-=use;used(p,it,use,e);if(it.amount===0){p.queue.shift();settle(p,it,e);}}
  if(a>0){
   // 読込範囲の始めを過ぎて初めて出てくる取引先の減少は、読込範囲より前の分とみなす。ただし、90日以内の次の動きが
   // それを上回る増加なら、前受・前払（マイナスの残高）として次の請求・仕入に当てる
   const next=(byParty.get(p.party)||[]).find(x=>x.i>index),advance=!!next&&next.amount>=a&&days(e.date,events[next.i].date)<=90;
   if(!p.untagged&&history&&(lead||!p.hadIncrease&&!advance)){p.preWindow+=a;p.preWindowRows.push(e.row);}
   else{p.credit+=a;if(p.untagged){p.unmatchedDecrease+=a;p.unmatchedEvents.push({date:e.date,amount:a,row:e.row});}}
  }
 };
 const matches=[];
 for(;index<events.length;index++){
  const e=events[index];
  if(e.current)takeOpening();
  const p=state(e.party,e.label);p.firstDate??=e.date;p.lastDate=e.date;p.rows.push(...e.rows);if(p.rows.length>240)p.rows.splice(0,p.rows.length-200);
  if(e.current){p.currentEvents++;p.flows[e.month]=(p.flows[e.month]||0)+e.amount;if(e.amount>0)p.increase+=e.amount;else p.decrease-=e.amount;}
  else if(e.amount>0)p.histIncrease+=e.amount;
  if(e.amount>0){add(p,e,e.amount);continue;}
  const amount=-e.amount;p.totalDecrease+=amount;
  if(!p.untagged){consume(p,e,amount,!e.current);continue;}
  // 取引先が未選択の減少：未選択の未消込に同額がなく、同じ金額の未消込が1社だけにあれば、その取引先の候補として当てる
  const own=p.queue.some(i=>i.amount===amount);
  const hits=matchUntagged&&!own?[...parties.values()].filter(q=>!q.untagged&&q.queue.some(i=>i.amount===amount&&!i.preWindow&&i.date<=e.date)):[];
  if(hits.length===1){
   const q=hits[0],it=take(q,q.queue.findIndex(x=>x.amount===amount&&!x.preWindow&&x.date<=e.date),e);
   matches.push({date:e.date,month:e.month,amount,party:q.party,label:q.label,itemDate:it.date,row:e.row,itemRow:it.row,current:e.current});q.matchedIn.push(e.row);p.matchedOut.push(e.row);
   if(e.current){p.flows[e.month]-=e.amount;p.decrease-=amount;q.flows[e.month]=(q.flows[e.month]||0)+e.amount;q.decrease+=amount;q.currentEvents++;}
   continue;
  }
  consume(p,e,amount,!e.current);
 }
 takeOpening();
 for(const p of parties.values()){p.closing=total(p.queue.map(i=>i.amount))-p.credit;p.openItems=p.queue.map(i=>({...i}));p.openingRemaining=total(p.queue.filter(i=>i.atOpening).map(i=>i.amount));}
 const unmatched=parties.get('')?.unmatchedDecrease||0;
 return {parties,matches,events:events.length,totalDecrease:total([...parties.values()].map(p=>p.totalDecrease)),unmatchedUntagged:unmatched,untaggedEvents:parties.get('')?.unmatchedEvents||[]};
}

function classify(p,kind,asOf){
 const w=WORDS[kind];
 if(p.closing===0)return {status:'settled',label:w.settled};
 if(p.closing<0)return {status:'credit',label:w.credit};
 const oldest=p.openItems.find(i=>i.amount>0);
 const age=oldest?.preWindow?null:oldest?.date?days(oldest.date,asOf):null;
 p.oldestDate=oldest?.preWindow?null:oldest?.date||null;p.oldestAge=age;p.oldestPreWindow=!!oldest?.preWindow;p.oldestExact=!!oldest?.exactAdjust;p.oldestAtOpening=!!oldest?.atOpening;
 const lag=p.lagMedian,limit=Number.isFinite(lag)?Math.max(lag*1.5,lag+30):60;p.lateLimit=Math.min(limit,180);
 if(oldest?.preWindow||age>180)return {status:'long',label:w.long};
 if(age>limit)return {status:'late',label:w.late};
 return {status:'normal',label:w.normal};
}

function accountNames(session,model,js){
 const names=new Map();
 for(const g of model.bs||[])if(kindOf(g.account))names.set(key(g.account),g.account);
 for(const g of js.valid)for(const r of g.rows)for(const a of [r.debit,r.credit])if(kindOf(a)&&!names.has(key(a)))names.set(key(a),a);
 return [...names.values()];
}
function reportedOpening(session,model,account,prev){
 const exact=S.exactOpening(session,account,prev);
 if(exact.amount!==null)return {amount:exact.amount,source:exact.source==='priorBS'?'前期BSの期末':'当期BSの期首',reasons:[]};
 if(exact.present)return {amount:null,source:'conflict',reasons:exact.reasons?.length?exact.reasons:['BSの期首を確定できません。']};
 // 期首列の年月を確定できない帳票でも、期首の原文が数値なら使う（空欄は0円にしない）
 const g=(model.bs||[]).find(x=>key(x.account)===key(account)),r=(g?.rows||[]).find(r=>r.openingRaw!==undefined&&String(r.openingRaw).trim()!=='');
 const n=r?E.number(r.openingRaw):null;
 return Number.isFinite(n)?{amount:Math.round(n*(r.unit||1)),source:'当期BSの期首列',reasons:r.unit===1000?['千円単位の概数です。']:[]}:{amount:null,source:'unknown',reasons:[]};
}
// 取引先内訳つきBSの確定期首（決済モジュールの繰越を含む）。決済の対象外の科目（未収入金など）はBSの取引先セルを直接読む。
function exactParties(session,model,account,prev){
 const map=new Map();
 for(const x of model.settlement?.parties||[])if(key(x.account)===key(account)&&finite(x.opening)&&/BS/.test(String(x.openingSource||'')))map.set(x.party,{amount:x.opening,label:x.label,source:x.openingSource});
 for(const t of ['monthlyBS','priorBS'])for(const r of session.datasets?.[t]||[]){
  if(key(r.account)!==key(account)||r.tagDimension!=='party'||month(r.date)!==prev)continue;const k=key(r.tagValue);if(map.has(k))continue;
  const c=S.exactOpening(session,account,prev,k);if(c.amount!==null)map.set(k,{amount:c.amount,label:clean(r.tagValue),source:c.source});
 }
 return map;
}

function build(session,model){
 const months=model.months||[];if(!months.length)return null;
 const start=months[0],end=months.at(-1),prev=prevMonth(start),js=model.settlement?.journals||S.journals(session),ms=monthStates(session,js);
 // 全科目に共通の読込範囲（見出し・注記用）。科目ごとに、その科目に触れる仕訳の誤りがあればさらに短くなる。
 const ms0=ms.forAccount(null),win0=historyWindow(ms0,prev),obs0=observedThrough(ms0,months);
 const accounts=[],alerts=[],notes=[],priorRows=(session.datasets?.prior||[]).length;
 for(const account of accountNames(session,model,js)){
  const ams=ms.forAccount(account),win=historyWindow(ams,prev),obs=observedThrough(ams,months),through=obs.through,asOf=through?endDay(through):null;
  const kind=kindOf(account),w=WORDS[kind],rep=reportedOpening(session,model,account,prev),override=exactParties(session,model,account,prev);
  const base={override,openingDate:endDay(prev)};
  const sim=simulate(js,account,kind,win,through,start,base),strict=sim.matches.length?simulate(js,account,kind,win,through,start,{...base,matchUntagged:false}):null;
  const parties=[...sim.parties.values()];
  // 取引先が未選択の減少（金額一致でも当てられないもの）が多い科目は、取引先別の残りを判定しない
  const untaggedShare=sim.totalDecrease?sim.unmatchedUntagged/sim.totalDecrease:0,untaggedDominant=untaggedShare>0.2;
  for(const p of parties){
   p.reasons=[];p.lagMedian=median(p.lags);p.lagSamples=p.lags.length;
   if(p.openingBasis!=='exact'){
    p.openingBasis=win.start?'estimate':'none';
    // 期首が分からない取引先は、期首・残高を空欄にする（当期の増減だけを残高と見せない）
    if(!win.start){p.opening=null;p.closing=null;p.openItems=[];p.openItemsAtOpening=[];p.openingRemaining=null;}
   }
   if(strict&&p.openingBasis==='estimate'){const q=strict.parties.get(p.party);p.openingWithoutMatching=q?q.opening??0:0;}
  }
  const estimatedTotal=win.start||override.size?total(parties.map(p=>p.opening||0)):null;
  const residual=finite(rep.amount)&&finite(estimatedTotal)&&(win.start||override.size&&parties.every(p=>p.openingBasis==='exact'))?rep.amount-estimatedTotal:null;
  // 期首が分からない取引先が残る（読込範囲がなく、確定値でない取引先がある）ときは照合しない
  const allExact=!!override.size&&parties.every(p=>p.openingBasis==='exact');
  const status=rep.source==='conflict'?'opening_unconfirmed':!win.start&&!allExact?(priorRows?'gap':'no_history'):untaggedDominant?'untagged':rep.amount===null||residual===null?'no_report':Math.abs(residual)<1?'matched':residual>0?'unexplained':'over';
  const closingReport=through?S.reportCell(session,'monthlyBS',account,through):{amount:null};
  const closingKnown=parties.every(p=>p.closing!==null),closingTotal=closingKnown?total(parties.map(p=>p.closing||0)):null;
  const closingResidual=closingReport.amount!==null&&finite(closingTotal)&&finite(residual)?closingReport.amount-closingTotal-residual:null;
  const periodIncrease=total(parties.map(p=>p.increase)),span=through?days(start+'-01',endDay(through))+1:null;
  // 主要な取引先：当期の請求・仕入の多い順に、合計の8割に届くまで（最大5社）。当期の仕訳から分かる事実。
  const ranked=parties.filter(p=>!p.untagged&&p.increase>0).sort((a,b)=>b.increase-a.increase);let acc=0;
  ranked.forEach((p,i)=>{p.share=periodIncrease?p.increase/periodIncrease:0;if(acc<periodIncrease*0.8&&i<5){p.major=true;acc+=p.increase;}});
  const cls=new Map();
  for(const p of parties){
   let c=p.opening===null||p.closing===null?{status:'unknown',label:w.unknown}:untaggedDominant&&p.openingBasis!=='exact'?{status:'unknown',label:w.unknown}:asOf?classify(p,kind,asOf):{status:'unknown',label:w.unknown};
   // 未選択は取引先ではないので、回収・支払の遅れは判定しない（残高なし・マイナスだけ示す）
   if(p.untagged&&!['settled','credit'].includes(c.status))c={status:'unknown',label:w.unknown};
   cls.set(p,c);
  }
  // 取引先が未選択の減少（どの取引先にも当てられなかった分）は、1円ずつ1回だけ使う：いちばん古い未消込から順に、
  // その日以後の未選択の減少で払いきれる取引先だけを「払われた可能性があり判定しない」とする
  const budget=sim.untaggedEvents.map(x=>({date:x.date,left:x.amount})),oldestKey=p=>p.oldestPreWindow?'':p.oldestDate||'';
  let held=0,heldAmount=0;
  for(const p of parties.filter(p=>!p.untagged&&['late','long'].includes(cls.get(p).status)).sort((a,b)=>oldestKey(a).localeCompare(oldestKey(b))||a.label.localeCompare(b.label,'ja'))){
   const first=p.openItems.find(i=>i.amount>0);if(!first)continue;
   const pool=budget.filter(x=>x.date>=oldestKey(p)&&x.left>0);
   if(total(pool.map(x=>x.left))>=first.amount){
    let need=first.amount;for(const x of pool){const use=Math.min(x.left,need);x.left-=use;need-=use;if(!need)break;}
    cls.set(p,{status:'unknown',label:w.unknown});held++;heldAmount+=first.amount;
    p.reasons.push(`いちばん古い${w.open}（${yen(first.amount)}円）は、その後の取引先が未選択の${w.dec}で${w.act}済みの可能性があるため、${w.open}かどうかは判定しません。freeeで${w.dec}の取引先を確認してください。`);
    continue;
   }
   // 名前の違う同じ取引先（名称変更・付け違い）：同じ科目に同額以上のマイナス残高がある
   const twin=parties.find(q=>q!==p&&!q.untagged&&q.closing!==null&&q.closing<0&&-q.closing>=first.amount);
   if(twin){cls.set(p,{status:'unknown',label:w.unknown});p.reasons.push(`同じ科目の「${twin.label}」に ${yen(-twin.closing)}円のマイナス残高があります。名称変更や取引先の付け違いの可能性があるため、${w.open}かどうかは判定しません。`);}
   else if((p.oldestAtOpening||p.preWindow>0)&&p.openingBasis==='estimate'&&status==='over'){cls.set(p,{status:'unknown',label:w.unknown});p.reasons.push(`推定の合計がBSの期首より多く、期首の推定に誤りがある可能性があるため判定しません。`);}
  }
  const heldText=held?`取引先が未選択の${w.dec}（どの取引先にも当てられなかった分 ${yen(total(sim.untaggedEvents.map(x=>x.amount)))}円）で${w.act}済みの可能性があるため、${held}社（${yen(heldAmount)}円）の判定を保留しました。freeeで${w.dec}の取引先を確認してください。`:'';
  for(const p of parties){
   const c=cls.get(p);
   p.status=c.status;p.statusLabel=c.label;
   p.daysOfVolume=span&&p.increase>0&&p.closing>0?Math.round(p.closing/(p.increase/span)):null;
   if(p.openingBasis==='exact')p.reasons.unshift(`期首は取引先内訳つきBSの確定値です（${String(p.exactSource||'').includes('journal')?'前の時点のBS内訳から連続する仕訳で繰り越した値':'BS内訳'}）。`);
   if(p.openingBasis==='none')p.reasons.unshift('期首の前月まで連続した過去の仕訳がないため、期首と残高は分かりません。当期の請求・入金だけを表示しています。');
   if(p.preWindow>0)p.reasons.push(`読込範囲（${win.start}〜）で、それより前の${w.inc}の分とみなした${w.dec}があります（${yen(p.preWindow)}円）。`);
   if(p.matchedIn.length)p.reasons.push(`取引先が未選択の${w.dec}${p.matchedIn.length}件を、金額が一致するこの取引先の${w.open}に当てています（候補）。`);
   if(p.untagged)p.reasons.push(`取引先が未選択の${w.inc}・${w.dec}です。金額の一致する相手が見つからない分は、取引先に配分していません。`);
   if(p.openingBasis!=='none'&&p.opening>0&&p.currentEvents)p.reasons.push(p.openingRemaining===0?`期首の${w.open} ${yen(p.opening)}円は、当期の${w.dec}ですべて消し込まれています（推定の裏付け）。`:p.openingSettled>0?`期首の${w.open}のうち ${yen(p.openingSettled)}円は当期に消し込まれ、${yen(p.openingRemaining)}円が残っています。`:`期首の${w.open} ${yen(p.opening)}円は、当期の${w.dec}でまだ消し込まれていません。`);
   if(Number.isFinite(p.openingWithoutMatching)&&p.openingWithoutMatching!==p.opening)p.reasons.push(`金額一致で当てない場合の期首は ${yen(p.openingWithoutMatching)}円です。`);
   if(p.status==='credit')p.reasons.push(kind==='receipt'?'入金が請求を上回っています。前受・過入金、取引先の付け違い、期首の内訳不明分の回収の可能性があります。':'支払が計上を上回っています。前払・過払い、取引先の付け違い、期首の内訳不明分の支払の可能性があります。');
   if(['late','long'].includes(p.status)&&!p.untagged){
    // 見出しの金額は、ふだんより長く残っている分だけ（残高全体ではない）。並べ替え・確認キューの金額も同じ。
    const stuck=p.openItems.filter(i=>i.amount>0&&(i.preWindow||i.date&&days(i.date,asOf)>p.lateLimit)),stuckAmount=total(stuck.map(i=>i.amount));
    const what=p.oldestPreWindow?`読込範囲より前（${win.start}より前）の${w.inc}`:p.oldestExact?`期首時点の残高（BS内訳）`:`${p.oldestDate}の${w.inc}`;
    alerts.push({account,kind,party:p.party,label:p.label,status:p.status,statusLabel:p.statusLabel,amount:stuckAmount,balance:p.closing,items:stuck.length,oldestDate:p.oldestDate,oldestAge:p.oldestAge,preWindow:p.oldestPreWindow,lag:p.lagMedian,accountStatus:status,basis:p.openingBasis,
     text:`${account}／${p.label}：${what}${stuck.length>1?`など${stuck.length}件`:''} ${yen(stuckAmount)}円が${kind==='receipt'?'まだ回収されていない':'まだ支払われていない'}可能性があります（残高 ${yen(p.closing)}円${p.oldestAge!=null?'・いちばん古いものは経過 約'+Math.max(1,Math.round(p.oldestAge/30))+'か月':''}${Number.isFinite(p.lagMedian)?'・ふだんは約'+Math.round(p.lagMedian)+'日で'+w.act:''}）。`,
     rows:(()=>{const r=stuck.map(i=>i.row).filter(Boolean);return r.length?uniq(r):p.rows.slice(-6);})()});
   }
  }
  const statusText={
   opening_unconfirmed:`BSの期首を確定できないため、推定の合計を照合できません。${rep.reasons.join(' ')}`,
   no_history:'過去の仕訳帳が未読込のため、取引先別の期首は推定できません。当期の請求・入金だけを表示しています。',
   gap:`期首の前月（${prev}）まで連続した過去の仕訳がないため、取引先別の期首は推定できません。${win.stopReason||''}`,
   untagged:`${w.dec}の約${Math.round(untaggedShare*100)}%に取引先が付いていないため（カード払いの${account}など）、取引先別の状態は判定しません。金額は参考に表示します。`,
   no_report:'BSの期首が未読込のため、推定の合計を帳票と照合できません。',
   matched:'推定の合計がBSの期首と一致しました。読込範囲より前の残高は残っていないとみなした推定で、合計の一致は取引先別の内訳の証明ではありません。',
   unexplained:`推定の合計がBSの期首より ${finite(residual)?yen(residual):''}円少なく、その分は内訳不明です。読込範囲（${win.start}〜）より前からの残高、または読み込んでいない仕訳がある可能性があります。`,
   over:`推定の合計がBSの期首より ${finite(residual)?yen(-residual):''}円多くなっています。前受・過入金、取引先の付け違い、未選択の${w.dec}、期首の推定の誤りを確認してください。`
  }[status];
  const assumed=sim.matches.length>0;
  parties.sort((a,b)=>(SEVERITY[a.status]??9)-(SEVERITY[b.status]??9)||Math.abs(b.closing||0)-Math.abs(a.closing||0)||a.label.localeCompare(b.label,'ja'));
  accounts.push({account,kind,words:w,reportedOpening:rep.amount,openingSource:rep.source,openingReasons:rep.reasons,estimatedTotal,residual,status,statusText,window:win,through,asOf,observedStop:obs.stop,observedStopReason:obs.reason,parties,matches:sim.matches,
   reportedClosing:closingReport.amount,closingTotal,closingResidual,periodIncrease,untaggedShare,untaggedDominant,exactCount:override.size,held,heldAmount,heldText,
   confidence:status==='matched'&&win.months>=6&&!assumed?'高':['matched','unexplained'].includes(status)&&win.months>=3?'中':'低'});
 }
 if(!win0.start)notes.push(priorRows?`期首の前月（${prev}）まで連続した過去の仕訳がありません。${win0.stopReason||''}`:'過去の仕訳帳を「前期・過去の仕訳帳（複数年）」として読み込むと、取引先別の期首を推定できます。');
 if(!obs0.through)notes.push(`当期の仕訳を期首月から連続して読めないため、残高と状態は判定しません。${obs0.stop?obs0.stop+'：'+obs0.reason:''}`);
 else if(obs0.stop)notes.push(`残高は ${obs0.through} 末までです（${obs0.stop} の仕訳を読めないため：${obs0.reason}）。`);
 for(const a of accounts)if(a.window.start!==win0.start||a.through!==obs0.through)notes.push(`${a.account}は、この科目に触れる仕訳に金額・借貸の誤りがあるため、読込範囲が ${a.window.start||'—'}〜${a.window.end||'—'}、残高が ${a.through||'—'} 末までです。`);
 alerts.sort((a,b)=>(SEVERITY[a.status]-SEVERITY[b.status])||b.amount-a.amount);
 return {version:1,prev,start,end,through:obs0.through,asOf:obs0.through?endDay(obs0.through):null,window:win0,accounts,alerts,notes};
}

// 月次BSの内訳（取引先別）に使う：取引先 → 推定・確定期首、当期の金額一致による付け替え、未配賦の差
function openingValues(model,account){
 const a=model?.partyOpening?.accounts?.find(x=>key(x.account)===key(account));
 if(!a||a.parties.some(p=>p.opening===null))return null;
 const values=new Map();for(const p of a.parties)values.set(p.party,p.opening||0);
 // 当期の未選択の減少を金額一致で取引先に当てた分：取引先 → 月 → 増減の付け替え
 const adjust=new Map(),put=(k,m,v)=>{let x=adjust.get(k);if(!x)adjust.set(k,x={});x[m]=(x[m]||0)+v;};
 for(const m of a.matches)if(m.current){put('',m.month,m.amount);put(m.party,m.month,-m.amount);}
 return {values,byKey:k=>values.get(key(k))??0,adjust,adjustByKey:k=>adjust.get(key(k))||null,start:a.window.start,end:a.window.end,allocated:a.estimatedTotal,unallocated:finite(a.residual)?a.residual:null,status:a.status,statusText:a.statusText,account:a};
}

// 確認キュー：回収・支払が止まっている可能性のある取引先を、科目ごとに1件の確認候補にまとめる。
// BSと照合できない・推定が多い・確からしさが低い科目は「資料確認」の参考情報にする。
function addFindings(model,session,add){
 const po=model.partyOpening;if(!po)return;
 for(const a of po.accounts){
  // 未選択の入金・支払で判定を保留した取引先は、黙って消さず「資料確認」の参考情報にする
  if(a.held){const un=a.parties.find(p=>p.untagged),rows=(un?.rows||[]).slice(-12);
   add('monthly',`${a.account}：取引先が未選択の${a.words.dec}があり、${a.held}社の${a.words.act}の状況を判定できません`,a.heldText,a.heldAmount,rows,{level:'info',dataReview:true,monthlyCheck:true,partyOpeningCheck:true,account:a.account,months:uniq(rows.map(r=>month(r.date)).filter(Boolean)),reviewContext:'party-opening-held:'+JSON.stringify([a.account,a.held,a.heldAmount]),
    basis:'過去の仕訳と当期の仕訳を取引先ごとに消し込んだ推定。取引先が未選択の減少は、金額の一致する未消込が1社だけにあるときしか取引先に当てません。',
    lesson:`取引先が未選択の${a.words.dec}は、どの取引先の分か仕訳から分かりません。取引先を付けると、${a.words.act}の状況を取引先ごとに確認できます。`,
    steps:[`取引先が未選択の${a.words.dec}を、通帳・明細で相手を確認する。`,'freeeで取引先を付け、もう一度読み込む。'],sources:['monthly','freee']});}
  const xs=po.alerts.filter(x=>key(x.account)===key(a.account));if(!xs.length)continue;
  const w=a.words,rows=uniq(xs.flatMap(x=>x.rows||[])),weak=a.status!=='matched'||a.confidence==='低';
  add('monthly',`${a.account}：${a.kind==='receipt'?'回収':'支払'}が止まっている可能性のある取引先（${xs.length}先・過去の仕訳からの推定）`,xs.map(x=>x.text.replace(/^[^／]*／/,'')).join('／'),xs.reduce((n,x)=>n+x.amount,0),rows,{level:weak?'info':'candidate',dataReview:weak,monthlyCheck:true,partyOpeningCheck:true,account:a.account,months:uniq(rows.map(r=>month(r.date)).filter(Boolean)),reviewContext:'party-opening:'+JSON.stringify([a.account,a.status,xs.map(x=>[x.party,x.amount,x.oldestDate])]),
   basis:`過去の仕訳（${a.window.start||'—'}〜${a.window.end||'—'}）と当期の仕訳を取引先ごとに消し込んだ推定。推定の確からしさ ${a.confidence}（${a.statusText}）`,
   lesson:`取引先別の期首は推定です。${w.open}が残って見えるのは、実際の${a.kind==='receipt'?'未回収':'未払'}のほか、取引先の付け違い・相殺・値引・貸倒・別科目での処理でも起こります。延滞や期日超過を確定するものではありません。請求書・通帳・取引先への確認で事実を確かめます。`,
   steps:[`対象の取引先の${w.inc}と${w.dec}の仕訳を、元帳・請求書・通帳で照合する。`,`${a.kind==='receipt'?'入金予定・督促の状況・貸倒の要否':'支払予定・請求書の受領・相殺の有無'}をお客様に確認する。`,'取引先の付け忘れ・付け違いがあればfreeeで修正し、確認結果をメモに残す。'],sources:['monthly','freee']});
 }
}
F.addFindings=function(model,session,add){originalFindings(model,session,add);try{addFindings(model,session,add);}catch(err){if(typeof console!=='undefined')console.warn('ReviewPartyOpening findings',err);}};
F.build=function(session,current,months){
 const model=originalBuild(session,current,months);
 try{model.partyOpening=build(session,model);}catch(err){model.partyOpening={version:1,error:String(err?.message||err),accounts:[],alerts:[],notes:[]};if(typeof console!=='undefined')console.warn('ReviewPartyOpening',err);}
 return model;
};
root.ReviewPartyOpening={build,openingValues,addFindings,kindOf,WORDS,version:1};
})(typeof window!=='undefined'?window:globalThis);

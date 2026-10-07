(function(root){
'use strict';
// 確認キューの「対応の順番」。指摘を6つの段階・誰が動くか・優先度で並べ、同じ論点を1つの対応項目にまとめる。
// 判断（session.decisions）の状態はそのまま使い、新しい状態は足さない（旧バックアップと互換）。
const E=root.ReviewEngine;
const STAGES=[
 {no:1,name:'資料をそろえる',purpose:'読込不足・読取エラー・帳票と仕訳の不一致・タグ内訳の不一致を解消します。',why:'ここが崩れていると、後ろの判定がすべて変わります。'},
 {no:2,name:'残高を確定する',purpose:'現預金・期首のつながり・残高一覧との差・マイナス残高を確かめます。',why:'残高が確定しないと、回収・支払や損益の判定ができません。'},
 {no:3,name:'回収・支払と仮勘定',purpose:'回収・支払の停滞、債権債務の年齢、仮払・立替・仮受の未精算、未登録明細を確かめます。',why:'残高の中身（誰の分か）を確かめます。'},
 {no:4,name:'売上・経費の計上',purpose:'月ズレ・計上漏れ・重複・大きな変動・資産計上・前払を確かめます。',why:'残高が固まった上で損益を見ます。'},
 {no:5,name:'税金と区分',purpose:'消費税区分・源泉・私的支出・交際費・給与の預り金を確かめます。',why:'金額が固まってから税務の判断をします。'},
 {no:6,name:'記帳のしかた（次回から）',purpose:'タグの付け漏れ、記帳ルール、過去との書き方の違いをお伝えします。',why:'今回の数字は変わりませんが、次回の手間が減ります。'}];
const ACTORS={request:'資料の依頼',office:'事務所で確認',ask:'お客様に質問',fix:'お客様に修正依頼',note:'記録のみ'};
const ACTOR_DO={request:'お客様に資料をお願いする',office:'事務所で帳票・元帳を照合して判断する',ask:'お客様に取引の内容をうかがう',fix:'お客様にfreeeの入力の見直しをお願いする',note:'記録に残す（お客様への連絡は不要）'};
const STATUS={open:'未対応',asking:'確認中',done:'完了'};
const S2=new Set(['balance','cash','loan','opening']),S3=new Set(['ar','ap','aging','temp','unreg','settlement']);
const S4=new Set(['monthly','duplicate','sales','rent','salary','evidence','asset','interest','prepaid','assetbook','stock','misc']);
const S5=new Set(['vat','paytax','outsourcetax','taxes','personal','entertain','withholding','tps']),S6=new Set(['rules','other','context']);
const GROUP={'事前確認':1,'残高':2,'経費':4,'給与':5,'推移':4,'税金':5,'履歴':6};
// 段階4の中で、事務所が処理を判断するもの（資産計上・前払など）
const OFFICE4=new Set(['asset','prepaid','assetbook','interest']);
// 段階1のうち、資料が足りないもの（お客様に依頼する）
const MISSING=/未読込|読込範囲|読み込まれて|不足|足りな|必要な資料|資料・条件|取引先別期首|期間が/;
const MATERIALS=[['current','当期の仕訳帳（CSV）'],['monthlyPL','月次推移の損益計算書（CSV）'],['monthlyBS','月次推移の貸借対照表（CSV）']];
const nkey=s=>String(s??'').normalize('NFKC').replace(/\s+/g,'');
function ctx(f){const s=String(f?.reviewContext||'');if(s[0]!=='[')return [];try{const a=JSON.parse(s);return Array.isArray(a)?a:[];}catch{return [];}}
function prefixed(f,p){const s=String(f?.reviewContext||'');if(!s.startsWith(p+':'))return null;try{return JSON.parse(s.slice(p.length+1));}catch{return s.slice(p.length+1);}}
const tagKind=f=>{const c=ctx(f);return c[0]==='tag-report'?String(c[1]||''):'';};
function monthsOf(f){
 const ms=new Set();for(const m of f?.months||[])if(/^\d{4}-\d{2}/.test(m))ms.add(String(m).slice(0,7));
 for(const r of f?.rows||[]){const d=r&&r.date;if(typeof d==='string'&&/^\d{4}-\d{2}/.test(d))ms.add(d.slice(0,7));}
 return [...ms].sort();
}
function accountOf(f){
 if(f?.account)return String(f.account);const c=ctx(f);if(c[0]==='tag-report'&&c[4])return String(c[4]);
 const n=new Map();for(const r of f?.rows||[])if(r&&r.account)n.set(r.account,(n.get(r.account)||0)+1);
 let best='',k=0;for(const [a,c] of n)if(c>k){best=a;k=c;}return best;
}
// 画面・文面に出す科目：複数の科目にまたがる月次の指摘（資金・期首など）には付けない
function shownAccount(f){if(f?.account)return String(f.account);const c=ctx(f);if(c[0]==='tag-report')return String(c[4]||'');return f?.check==='monthly'?'':accountOf(f);}
// 段階（先に一致した規則を使う）
function stageOf(f){
 if(!f)return 4;
 if(f.materials)return 1;
 const kind=tagKind(f),text=String(f.title||'')+' '+String(f.reason||''),c=ctx(f);
 if(f.integrityCheck||f.check==='sync'||kind==='tag-mismatch'||kind==='tag-conflict')return 1;
 if(f.check==='monthly'&&/帳票と仕訳|帳票との照合|読込|読取|未読込|照合できません/.test(text))return 1;
 if(f.check!=='unreg'&&f.dataReview&&f.level==='info')return 1;
 if(f.level==='difference'||f.balanceCheck||S2.has(f.check)||c[0]==='continuity')return 2;
 if(f.check==='monthly'&&/マイナス/.test(f.title||'')&&/現金|預金|借入|リース債務/.test(accountOf(f)))return 2;
 if(f.partyOpeningCheck||f.treasuryCheck||S3.has(f.check)||kind==='tag-negative'||kind==='tag-clearing')return 3;
 if(kind==='tag-unselected')return 6;
 // 「その他経費」のうち金額の変動・計上漏れ・マイナスは計上の問題（段階4）。過去にない組み合わせなどは書き方の問題（段階6）
 if(f.check==='other'&&/通常月から|計上のない月|マイナス|大きく変/.test(f.title||''))return 4;
 if(S4.has(f.check))return 4;
 if(S5.has(f.check))return 5;
 if(S6.has(f.check))return 6;
 const g=E?.CHECKS?.find(x=>x.key===f.check)?.group;return GROUP[g]||4;
}
// 誰が動くか
function actorOf(f){
 if(!f)return 'note';
 if(f.materials)return 'request';
 const st=stageOf(f),kind=tagKind(f),text=String(f.title||'')+' '+String(f.reason||'');
 if(st===1)return MISSING.test(text)&&!/読取エラー|重複/.test(f.title||'')?'request':'office';
 if(st===2)return 'office';
 if(kind==='tag-clearing')return 'fix';
 if(st===6)return kind||f.level!=='info'?'fix':'note';
 // 前月からの大きな変動は、まず事務所で元帳の増減を比べる（説明できないものだけお客様に聞く）
 if(st===4&&(OFFICE4.has(f.check)||family(f)==='swing'))return 'office';
 if(f.level==='candidate'||f.level==='difference')return 'ask';
 return 'note';
}
function scoreOf(f,session){
 const w={difference:3,candidate:2,info:.5}[f?.level]||1,large=Number(session?.project?.large)>0?Number(session.project.large):100000;
 const m=f?.dataReview?1:Math.min(3,Math.max(.2,Math.abs(Number(f?.amount)||0)/large));
 const r=monthsOf(f).length>=2?1.3:1,t=(f?.why?.impact||[]).some(x=>x&&(x.area==='税金'||x.area==='消費税'))?1.2:1;
 return w*m*r*t;
}
// 指摘の系統。check:'monthly' は寄せ集めなので、旗と reviewContext で見分ける
function family(f){
 const kind=tagKind(f),c=ctx(f);
 if(kind)return 'tag-report:'+kind;
 if(f.check!=='monthly')return String(f.check||'');
 if(c[0]==='continuity')return 'continuity:'+String(c[1]||'');
 if(f.partyOpeningCheck||prefixed(f,'party-opening')!=null||prefixed(f,'party-opening-held')!=null)return 'party-opening';
 const st=prefixed(f,'settlement');if(st!=null)return 'settlement:'+(Array.isArray(st)?String(st[0]||''):'');
 if(f.treasuryCheck){const t=prefixed(f,'treasury');return 'treasury:'+(typeof t==='string'?t:'');}
 if(f.integrityCheck){const a=prefixed(f,'audit');return 'integrity:'+(typeof a==='string'?a:'diff');}
 const t=String(f.title||'');
 if(/マイナス/.test(t))return 'negative';if(/前月から大きく変動/.test(t))return 'swing';if(/帳票と仕訳|帳票との照合/.test(t))return 'report-match';
 return 'monthly';
}
// 取引先・タグ（reviewContext から）
function partOf(f){
 const c=ctx(f);
 if(c[0]==='tag-report')return [c[2],c[3],c[5]].map(x=>nkey(x)).join('/');
 if(c[0]==='continuity')return [c[3],c[4]].map(x=>nkey(x)).join('/');
 const po=prefixed(f,'party-opening')??prefixed(f,'party-opening-held');
 if(Array.isArray(po)&&Array.isArray(po[2]))return po[2].map(x=>nkey(Array.isArray(x)?x[0]:x)).filter(Boolean).sort().join('、');
 return '';
}
// 同じ論点の鍵。行の署名や設定値を含めないので、設定を変えて再分析しても変わらない
function topicKey(f){
 if(f?.materials)return '1|materials|'+f.materials;
 return [stageOf(f),family(f),nkey(accountOf(f)),partOf(f)].join('|');
}
function partyLabel(f){
 const c=ctx(f);if(c[0]==='tag-report')return c[5]&&c[5]!=='未選択'?String(c[5]):'';
 if(c[0]==='continuity')return String(c[4]||'');
 const po=prefixed(f,'party-opening')??prefixed(f,'party-opening-held');
 if(Array.isArray(po)&&Array.isArray(po[2]))return po[2].map(x=>Array.isArray(x)?x[0]:x).filter(Boolean).join('・');
 const ps=new Set();for(const r of f?.rows||[]){const p=r&&(r.partner||r.party);if(p)ps.add(p);if(ps.size>1)return '';}
 return [...ps][0]||'';
}
const STATUS_DONE=new Set(['resolved','defer']);
function itemStatus(fs,dec){
 if(!fs.length)return 'open';let ask=false,done=0;
 for(const f of fs){const s=dec[f.id]?.status||'open';if(s==='ask')ask=true;else if(STATUS_DONE.has(s))done++;}
 return done===fs.length?'done':ask?'asking':'open';
}
function dataSig(session){
 const ds=session?.datasets||{},imp=(session?.imports||[]).map(i=>[i.type,i.at,i.count,i.name].join('~')).join('|');
 return E.hash(JSON.stringify([imp,Object.keys(ds).sort().map(k=>k+':'+(ds[k]||[]).length),(session?.tagReports||[]).length]));
}
function materialsItems(session){
 const ds=session?.datasets||{},p=session?.project||{},out=[];
 // 何も読み込んでいない会社では、仕訳帳から始める（帳票の依頼は仕訳帳のあと）
 const list=(ds.current||[]).length?MATERIALS.slice(1):MATERIALS;
 for(const [type,name] of list){if((ds[type]||[]).length)continue;
  const f={id:'materials:'+type,materials:type,check:'',level:'info',dataReview:true,title:name+'が読み込まれていません',reason:`${name}がないため、この資料を使う確認ができません。`,amount:0,rows:[],months:[],steps:['freeeから書き出したCSVを「資料の読込」で読み込む。']};
  out.push({topic:topicKey(f),stage:1,actor:'request',score:2,amount:0,months:p.start&&p.end?[p.start,p.end]:[],findings:[],status:'open',lead:null,materials:type,materialName:name,title:f.title,reason:f.reason,steps:f.steps,account:'',party:'',provisional:null,carried:null});
 }
 return out;
}
// 項目の金額：明細が重ならない指摘は合計、増減や重なる明細は最大（同じ取引を二重に数えない）
const rowKey=r=>[r.date,r.id??r.line??'',r.side||'',r.account||'',r.amount??r.debitAmount??r.creditAmount??''].join('\u0001');
function amountOf(fs){
 const xs=fs.filter(f=>!f.dataReview),abs=f=>Math.abs(Number(f.amount)||0);if(!xs.length)return {amount:0,amountMode:'single'};
 if(xs.length===1)return {amount:abs(xs[0]),amountMode:'single'};
 let overlap=xs.some(f=>['swing','negative'].includes(family(f)));const seen=new Set();
 for(const f of xs){if(overlap)break;for(const r of f.rows||[]){const k=rowKey(r||{});if(seen.has(k)){overlap=true;break;}}for(const r of f.rows||[])seen.add(rowKey(r||{}));}
 return overlap?{amount:Math.max(...xs.map(abs)),amountMode:'max'}:{amount:xs.reduce((s,f)=>s+abs(f),0),amountMode:'sum'};
}
const cache=new WeakMap();
function decKey(fs,dec){let s='';for(const f of fs)s+=(dec[f.id]?.status||'')[0]||'-';return s+'|'+Object.keys(dec).length;}
// 対応の順番を組み立てる
function build(session,result){
 const fs=result?.findings||[],dec=session?.decisions||{},pj=session?.project||{},key=[decKey(fs,dec),dataSig(session),pj.large,pj.start,pj.end].join('|');
 if(result&&typeof result==='object'){const c=cache.get(result);if(c&&c.key===key)return c.built;}
 const groups=new Map();
 for(const f of fs){const topic=topicKey(f);let g=groups.get(topic);if(!g){g={topic,stage:stageOf(f),list:[]};groups.set(topic,g);}g.list.push({f,score:scoreOf(f,session)});}
 const items=materialsItems(session);
 for(const g of groups.values()){
  g.list.sort((a,b)=>b.score-a.score||Math.abs(b.f.amount||0)-Math.abs(a.f.amount||0));
  const findings=g.list.map(x=>x.f),lead=findings[0],months=[...new Set(findings.flatMap(monthsOf))].sort();
  const {amount,amountMode}=amountOf(findings);
  const title=String(lead.title||'').replace(/（\d+件）$/,'');
  items.push({topic:g.topic,stage:g.stage,actor:actorOf(lead),score:g.list[0].score,amount,amountMode,months,findings,status:itemStatus(findings,dec),lead,title,reason:lead.reason,steps:lead.steps||[],account:shownAccount(lead),party:partyLabel(lead),provisional:null,carried:null,blocking:findings.some(f=>f.level==='difference'||f.dataReview)});
 }
 for(const it of items)if(it.materials)it.blocking=true;
 items.sort((a,b)=>a.stage-b.stage||b.score-a.score||b.amount-a.amount||String(a.topic).localeCompare(String(b.topic)));
 // 先に片付ける段階の注意：前の段階に、差額・判定保留を含む未完了の項目があるとき
 const blockers=new Map();for(const it of items)if(it.blocking&&it.status!=='done')blockers.set(it.stage,(blockers.get(it.stage)||0)+1);
 const firstBlock=[...blockers.keys()].sort((a,b)=>a-b)[0];
 if(firstBlock)for(const it of items)if(it.stage>firstBlock&&it.status!=='done')it.provisional={stage:firstBlock,name:STAGES[firstBlock-1].name,count:blockers.get(firstBlock)};
 // 前回の判断：今の指摘にない id の判断で、同じ論点（topic）のもの
 const ids=new Set(fs.map(f=>f.id)),prev=new Map();
 for(const [id,d] of Object.entries(dec)){
  if(ids.has(id)||!d||typeof d!=='object'||!d.topic||!d.status||d.status==='open')continue;
  const p=prev.get(d.topic);if(!p||String(d.at||'')>=String(p.at||''))prev.set(d.topic,{id,status:d.status,note:String(d.note||''),label:d.reviewLabel||'',period:d.reviewPeriod||'',at:d.at||''});
 }
 for(const it of items){const p=prev.get(it.topic);if(p&&it.findings.some(f=>(dec[f.id]?.status||'open')==='open'))it.carried=p;}
 const stages=STAGES.map(s=>{const xs=items.filter(i=>i.stage===s.no);return {...s,items:xs,open:xs.filter(i=>i.status!=='done').length,total:xs.length};});
 const next=items.find(i=>i.status==='open')||items.find(i=>i.status==='asking')||null;
 const byId=new Map();for(const it of items)for(const f of it.findings)byId.set(f.id,it);
 const clientList=items.filter(i=>(i.actor==='ask'||i.actor==='fix'||i.actor==='request')&&i.status!=='done').map(i=>entry(i,session));
 const officeList=items.filter(i=>i.actor==='office'&&i.status!=='done').map(i=>entry(i,session));
 const built={stages,items,next,byId,clientList,officeList,order:items.flatMap(i=>i.findings.map(f=>f.id))};
 if(result&&typeof result==='object')cache.set(result,{key,built});
 return built;
}
// ---- 書き出し
const yen=n=>new Intl.NumberFormat('ja-JP').format(Math.round(n||0))+'円';
function ym(m){const x=/^(\d{4})-(\d{2})/.exec(m||'');return x?`${x[1]}年${+x[2]}月`:'';}
function monthSpan(ms){
 if(!ms?.length)return '';const a=ms[0],b=ms.at(-1);if(a===b)return ym(a);
 return a.slice(0,4)===b.slice(0,4)?`${ym(a)}〜${+b.slice(5,7)}月`:`${ym(a)}〜${ym(b)}`;
}
const DIM_LABEL={party:'取引先',item:'品目',department:'部門',segment1:'セグメント1',segment2:'セグメント2',segment3:'セグメント3'};
function summary(it){
 const t=String(it.title||'').replace(new RegExp('^'+String(it.account||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'：'),'');
 return t+(it.findings.length>1?`・関連${it.findings.length}件`:'');
}
const amountLabel=it=>(it.amountMode==='sum'?'計 ':it.amountMode==='max'?'最大 ':'')+yen(it.amount);
function entryText(it,session){
 const p=session?.project||{},span=monthSpan(it.months),acct=it.account||'',party=it.party?`（${it.party}）`:'',amt=it.amount?' '+(it.amountMode==='sum'?'計 ':'')+yen(it.amount):'';
 if(it.actor==='request'){
  if(it.materials)return `${it.materialName}をお送りください（${monthSpan([p.start,p.end].filter(Boolean))||'対象期間'}）。`;
  return `次の確認に必要な資料をお送りください（${span||monthSpan([p.start,p.end].filter(Boolean))||'対象期間'}）。（${summary(it)}）`;
 }
 if(it.actor==='fix'){
  const c=ctx(it.lead),dim=c[0]==='tag-report'?DIM_LABEL[c[3]]||'':'';
  return `freeeで${acct||'該当の科目'}${party}の${dim?dim+'の':''}入力をご確認ください。${summary(it)}。`;
 }
 if(it.actor==='ask'){
  if(/計上のない月/.test(it.title))return `${span?span+'の':''}${acct||'該当の取引'}${party}について、計上のない月の取引の有無を教えてください。（${summary(it)}）`;
  return `${span?span+'の':''}${acct||'該当の取引'}${party}${amt}について、取引の内容を教えてください。（${summary(it)}）`;
 }
 return `${acct?acct+party+'：':''}${summary(it)}${amt?'（'+amt.trim()+'）':''}`;
}
function entry(it,session){
 const st=STAGES[it.stage-1];
 return {topic:it.topic,stage:it.stage,stageName:st.name,actor:it.actor,actorLabel:ACTORS[it.actor],status:it.status,statusLabel:STATUS[it.status],account:it.account,party:it.party,months:it.months,monthLabel:monthSpan(it.months),amount:it.amount,amountMode:it.amountMode,amountLabel:it.amount?amountLabel(it):'',title:it.title,count:it.findings.length,ids:it.findings.map(f=>f.id),text:entryText(it,session),step:(it.steps||[])[0]||''};
}
const KIND_TAG={request:'資料',ask:'ご質問',fix:'入力の確認'};
function clientText(list,meta={}){
 const head=['お客様への確認のお願い',[meta.name,meta.period].filter(Boolean).join('　')].filter(Boolean);
 const body=(list||[]).map((x,i)=>`${i+1}. 【${KIND_TAG[x.actor]||x.actorLabel}】${x.text}`);
 return head.join('\n')+'\n\n'+(body.length?body.join('\n'):'現在、お客様に確認する項目はありません。')+'\n';
}
function officeText(list,meta={}){
 const head=['事務所の作業リスト',[meta.name,meta.period].filter(Boolean).join('　')].filter(Boolean);
 const body=(list||[]).map((x,i)=>`${i+1}. [${x.stage} ${x.stageName}] ${x.account?x.account+(x.party?'（'+x.party+'）':'')+'：':''}${x.title}${x.amount?'（'+x.amountLabel+'）':''}${x.monthLabel?' '+x.monthLabel:''}${x.count>1?' 関連'+x.count+'件':''}${x.step?'\n   次に確認すること：'+x.step:''}`);
 return head.join('\n')+'\n\n'+(body.length?body.join('\n'):'現在、事務所で確認する項目はありません。')+'\n';
}
// CSVのセル：式として読まれる文字（= + - @ タブ CR）で始まるときは先頭に ' を付ける
function cell(v){let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function csv(list){
 const head=['番号','段階','誰が','状況','科目','取引先・タグ','対象月','金額（円）','内容','指摘','関連件数'];
 const rows=(list||[]).map((x,i)=>[i+1,`${x.stage} ${x.stageName}`,x.actorLabel,x.statusLabel,x.account,x.party,x.monthLabel,x.amount?Math.round(x.amount):'',x.text,x.title,x.count]);
 return '﻿'+[head,...rows].map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
}
// ---- 再確認の流れ：直前の未対応・確認中の論点を覚えておき、資料を読み直したあとに比べる
function snapshot(built,sig,at){
 return {at:at||new Date().toISOString(),sig:sig||'',topics:built.items.filter(i=>i.lead&&i.status!=='done').map(i=>({topic:i.topic,status:i.status==='asking'?'ask':'open',label:(i.account&&!String(i.title).startsWith(i.account)?i.account+'：':'')+i.title}))};
}
function compare(prev,built){
 const have=new Set(built.items.map(i=>i.topic)),gone=[],kept=[];
 for(const t of prev?.topics||[])(have.has(t.topic)?kept:gone).push(t);
 return {gone,kept};
}
// 画面を描くたびに呼ぶ。読込（資料）が変わっていれば前回と比べ、消えた論点を gone に残す。変わったら true
function reconcile(session,built,now){
 if(!session||typeof session!=='object')return false;if(!session.manual||typeof session.manual!=='object')session.manual={};
 const sig=dataSig(session),old=session.manual.feedbackSnapshot,snap=snapshot(built,sig,now);
 if(!old||typeof old!=='object'||!Array.isArray(old.topics)){session.manual.feedbackSnapshot={...snap,gone:[]};return true;}
 if(old.sig!==sig){
  const have=new Set(built.items.map(i=>i.topic)),{gone}=compare(old,built);
  const keep=(Array.isArray(old.gone)?old.gone:[]).filter(t=>!have.has(t.topic)&&!gone.some(g=>g.topic===t.topic));
  session.manual.feedbackSnapshot={...snap,gone:[...keep,...gone.map(t=>({...t,since:old.at||''}))]};return true;
 }
 if(JSON.stringify(old.topics)===JSON.stringify(snap.topics))return false;
 session.manual.feedbackSnapshot={...snap,gone:Array.isArray(old.gone)?old.gone:[]};return true;
}
function clearGone(session){const s=session?.manual?.feedbackSnapshot;if(!s||!s.gone?.length)return false;s.gone=[];return true;}
// 前回の判断を、同じ論点のまだ未確認の指摘に引き継ぐ（自動では引き継がない）。引き継いだ件数を返す
function usePrevious(session,result,topic,now){
 const b=build(session,result),it=b.items.find(i=>i.topic===topic);if(!it||!it.carried)return 0;
 const p=session.project||{},at=now||new Date().toISOString();let n=0;
 for(const f of it.findings){if((session.decisions[f.id]?.status||'open')!=='open')continue;
  session.decisions[f.id]={status:it.carried.status,note:it.carried.note,topic,reviewLabel:f.title,reviewPeriod:p.start+'〜'+p.end,at,carriedFrom:it.carried.id};n++;}
 return n;
}
root.ReviewFeedbackOrder={STAGES,ACTORS,ACTOR_DO,STATUS,amountLabel,stageOf,actorOf,scoreOf,topicKey,monthsOf,monthSpan,build,entryText,clientText,officeText,csv,cell,snapshot,compare,reconcile,clearGone,usePrevious,dataSig,version:1};
})(typeof window!=='undefined'?window:globalThis);

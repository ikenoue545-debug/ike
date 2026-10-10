/* v4.4a 受信トレイ：まとめて入れたCSVを、種類・期間・会社・前回との違いを確かめてから一括で反映する。
   - 反映は v4.3 の取込処理（commitImport）をそのまま使う。保存されるデータの形は、1ファイルずつ読み込んだ場合と同じ。
   - 中身が前回と同じCSVは反映しない。反映しないので、確認済みの記録も変わらない。
   - 自動で反映するのは、当期・前期の仕訳帳と、freee の当期の月次BS・PL（円・単月・読取エラーなし）だけ。
     それ以外は「要確認」として、従来の1ファイルずつの画面で読み込む。
   - 反映前の状態を1世代だけメモリに残し、ほかの操作をする前なら戻せる。
   - 外部への送信はしない。 */
(function(root){
'use strict';
const E=root.ReviewEngine,F=root.ReviewFinancial,A=root.ReviewAppBridge,W=root.ReviewWorkspace,RV=root.ReviewReportViews,RM=root.ReviewMaterials,RI=root.ReviewIntake;
if(!E||!F||!A||!W||!root.document)return;
const doc=root.document,$=s=>doc.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const count=n=>Number(n||0).toLocaleString('ja-JP');
const yen=n=>(n>0?'+':n<0?'−':'')+Math.abs(Number(n)||0).toLocaleString('ja-JP')+'円';
const MAX_FILES=10,MAX_BYTES=12*1024*1024,TOP=8;
const AUTO_TYPES=['current','prior','monthlyBS','monthlyPL'];
const BASIC=[['current','当期の仕訳帳'],['prior','前期の仕訳帳'],['monthlyBS','当期の月次BS'],['monthlyPL','当期の月次PL']];
const DIM={total:'科目合計',party:'取引先別',item:'品目別',department:'部門別'};
const STATUS={apply:'反映する',same:'変更なし',dup:'重複',check:'要確認',blocked:'反映できない'};
const KIND={new:'新規',update:'更新',add:'追加'};
// 中身の比較に使う項目（行番号・列の位置・ファイル名など、出力のたびに変わり得るものは使わない）
const JOURNAL_FIELDS=['date','id','debit','credit','debitAmount','creditAmount','party','debitParty','creditParty','description','debitTax','creditTax','item','debitItem','creditItem','department','debitDepartment','creditDepartment','memo','debitMemo','creditMemo','memoTags','debitMemoTags','creditMemoTags','note','managementNo','adjustmentRaw','isAdjustment','debitCode','creditCode'];
const keyText=v=>String(v??'').normalize('NFKC').replace(/[\s　]/g,'');
const entityKey=v=>keyText(v).toLowerCase();
// v4.3 の取込は、帳票の事業者名が会社の設定名と違うと注意を出す。受信トレイでは、この注意だけは会社の確認と一緒に1回で確かめる。
const ENTITY_WARN=/^帳票に記載された事業者は「(.*)」、現在の設定名は「(.*)」です。/;

// tray：受信トレイ（まだ反映していないCSV）。last：直前の反映の結果。undo：反映前の状態（1世代、メモリだけ）。view：画面に出している内容。
let tray=null,last=null,undo=null,view='list',seq=0,input=null;

/* ---------- 読込（v4.3 の nextFile・showImport と同じ判定） ---------- */
async function normalize(p,options){
 return p.rows.length>=5000&&root.ReviewAnalysisRuntime?await root.ReviewAnalysisRuntime.normalizeRowsAsync({rows:p.rows,type:p.type,mapping:p.mapping,headerIndex:p.headerIndex,options}):E.normalizeRows(p.rows,p.type,p.mapping,p.headerIndex,options);
}
async function preview(p,project){
 const normalizeOptions={project,unit:p.unit,basis:p.basis,requireReportYear:!!p.autoReport};
 let pv=await normalize(p,normalizeOptions);if(!pv)return null;
 if(p.autoJournal&&['current','prior'].includes(p.type)){
  const detected=E.journalPeriod(pv.items,project).recommended;
  if(detected&&detected!==p.type){p.type=detected;p.mode=detected==='prior'?'append':'replace';p.scopeAcknowledged=false;pv=await normalize(p,{project,unit:p.unit,basis:p.basis});if(!pv)return null;}
 }
 if(p.autoReport&&E.reportType(p.type)){
  const detected=E.reportPeriod(pv.items,p.type,project,pv.reportStats||{}).recommended;
  if(detected&&detected!==p.type){p.type=detected;p.mode=['priorPL','priorBS'].includes(detected)?'append':'replace';pv=await normalize(p,normalizeOptions);if(!pv)return null;}
 }
 if(pv.reportStats?.nativeHierarchy&&!p.nativeModeSet){if(!['priorBS','priorPL'].includes(p.type))p.mode='replace';p.nativeModeSet=true;}
 p.preview=pv;const period=A.journalImportPeriod(p,pv);p.periodValid=period.valid;p.periodMessage=period.message||'';
 return pv;
}
async function readItem(file,companyId){
 const it={id:'inbox'+(++seq),file,name:file.name,size:file.size,excluded:false,status:'check',reasons:[],notes:[]};
 if(file.size>MAX_BYTES){it.status='blocked';it.reasons.push('12MBを超えているため読み込めません');return it;}
 try{
  const bytes=await file.arrayBuffer();let encoding='utf-8',text;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{encoding='shift_jis';text=new TextDecoder('shift_jis').decode(bytes);}
  const rows=E.parseCSV(text),project=A.session().project;
  let type,detectedReport=E.detectReportHeader(rows,project);
  if(detectedReport)type=detectedReport.type;
  else{const scores=Object.keys(E.TYPES).filter(k=>k!=='prior'&&!E.reportType(k)).map(k=>{const i=E.headerRow(rows,k);return [k,E.TYPES[k].required.filter(f=>E.guessMapping(rows[i],k)[f]>=0).length/E.TYPES[k].required.length];}).sort((a,b)=>b[1]-a[1]);type=scores[0][0];}
  const h=E.headerRow(rows,type,project);
  const p={file,bytes,rows,encoding,type,queueRevision:0,autoJournal:true,autoReport:!!detectedReport,companyId,headerIndex:h,mapping:E.importMapping(rows,type,h,project),unit:F.detectUnit(rows,h),basis:F.detectBasis(rows,h),fingerprint:E.hash(text),mode:['prior','priorPL','priorBS'].includes(type)?'append':'replace',skip:false,scopeAcknowledged:false,historyStatus:'reference',shareKubun:false};
  it.p=p;
  if(!await preview(p,project)){it.status='blocked';it.reasons.push('集計が中断されました。もう一度入れてください');}
 }catch(err){it.status='blocked';it.reasons.push('CSVを読めません：'+(err&&err.message||err));}
 return it;
}

/* ---------- 種類・期間の表示 ---------- */
function dimensionOf(p){if(!E.reportType(p.type))return null;try{return RV?.dimension(p.preview.items,p.preview.reportStats||{})||null;}catch{return null;}}
function typeLabel(it){if(!it.p)return '判定できません';const t=E.TYPES[it.p.type];return (t?.name||it.p.type)+(it.dimension?'（'+(DIM[it.dimension]||it.dimension)+'）':'');}
function periodLabel(it){
 const pv=it.p?.preview;if(!pv)return '';const s=pv.reportStats;
 if(s?.sourcePeriod?.start)return s.sourcePeriod.start.replace('-','/')+'〜'+s.sourcePeriod.end.replace('-','/');
 const ds=pv.items.map(r=>r.date).filter(d=>typeof d==='string'&&d).sort();return ds.length?ds[0].replace(/-/g,'/')+'〜'+ds.at(-1).replace(/-/g,'/'):'';
}
function sizeLabel(it){const pv=it.p?.preview;if(!pv)return '';return E.reportType(it.p.type)?count(pv.items.length)+'セル':count(pv.items.length)+'行';}

/* ---------- 1ファイルの判定 ---------- */
function classify(it){
 if(!it.p||!it.p.preview){it.status='blocked';return;}
 it.reasons=[];it.notes=[];it.kind=null;it.diff=null;it.conflict='';it.dupOf='';it.entityWarn=null;it.needsEntityConfirm=false;
 const p=it.p,pv=p.preview,t=E.TYPES[p.type];it.dimension=dimensionOf(p);
 if(!AUTO_TYPES.includes(p.type))it.reasons.push(`${t?.name||'この資料'}は、1ファイルずつ内容を確認して読み込みます`);
 if(!t||!t.required.every(k=>p.mapping[k]>=0))it.reasons.push('必要な列（日付・科目・金額など）を自動で特定できません');
 if(!pv.items.length)it.reasons.push('読み込める行がありません');
 if(pv.errors.length)it.reasons.push(`読取エラーが${count(pv.errors.length)}行あります。除外するかを確認してください`);
 if(p.periodValid===false)it.reasons.push(p.periodMessage||'対象期間と、CSVの期間が合いません');
 if(E.reportType(p.type)&&AUTO_TYPES.includes(p.type)){
  if(!p.autoReport)it.reasons.push('帳票の種類・年度を本文から確定できません');
  else if(RM?.batchEligibility){
   const m=(pv.warnings||[]).map(w=>ENTITY_WARN.exec(w)).find(Boolean);it.entityWarn=m?{entity:m[1],name:m[2]}:null;
   const x=RM.batchEligibility(p,m?{...pv,warnings:pv.warnings.filter(w=>!ENTITY_WARN.test(w))}:pv);if(!x.eligible)it.reasons.push('自動で反映できない帳票です：'+x.reason);
  }
 }
 if(pv.journalStats?.ambiguous)it.notes.push(`番号の対応が不明な仕訳のまとまりが${count(pv.journalStats.ambiguous)}件あります（読込後の画面で確認できます）`);
 it.status=it.reasons.length?'check':'apply';
}

/* ---------- 中身の比較 ---------- */
function journalSig(r){return JSON.stringify(JOURNAL_FIELDS.map(f=>r[f]??null));}
function journalEntry(r){return {sig:journalSig(r),date:String(r.date||''),id:r.hasId?String(r.id||''):'',debit:r.debit||'',credit:r.credit||'',debitAmount:Number(r.debitAmount)||0,creditAmount:Number(r.creditAmount)||0};}
function reportCell(r){return JSON.stringify([String(r.date||''),keyText(r.account),r.tagDimension||'',keyText(r.tagValue),r.opening?1:0]);}
function reportCells(rows){const m=new Map();for(const r of rows){if(!Number.isSafeInteger(r.amount))continue;const k=reportCell(r);m.set(k,(m.get(k)||0)+r.amount);}return m;}
function contentSig(it){
 if(it.sig)return it.sig;const p=it.p,items=p.preview.items;
 it.sig=E.reportType(p.type)?E.hash(JSON.stringify([...reportCells(items)].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0))):E.hash(JSON.stringify(items.map(journalSig).sort()));
 return it.sig;
}
const validDim=d=>['total','party','item','department'].includes(d);
function existingReportRows(s,type,dimension){
 const imports=(s.imports||[]).filter(i=>i.type===type),byId=new Map(imports.filter(i=>i.importSource).map(i=>[i.importSource,i]));
 const rowDim=r=>validDim(r.reportViewDimension)?r.reportViewDimension:r.tagDimension&&r.tagDimension!=='total'?r.tagDimension:validDim(byId.get(r.importSource)?.reportViewDimension)?byId.get(r.importSource).reportViewDimension:'total';
 return (s.datasets?.[type]||[]).filter(r=>rowDim(r)===dimension);
}
function multisetDiff(oldList,newList){
 const left=new Map();for(const e of oldList){const a=left.get(e.sig)||[];a.push(e);left.set(e.sig,a);}
 const added=[];for(const e of newList){const a=left.get(e.sig);if(a&&a.length)a.pop();else added.push(e);}
 const removed=[];for(const a of left.values())removed.push(...a);
 return {added,removed};
}
function journalDiff(oldRows,newRows){
 const {added,removed}=multisetDiff(oldRows.map(journalEntry),newRows.map(journalEntry));
 const totals=new Map(),bump=(account,month,side,amount,sign)=>{if(!account||!amount)return;const k=JSON.stringify([account,month,side]);totals.set(k,(totals.get(k)||0)+sign*amount);};
 for(const [list,sign]of [[added,1],[removed,-1]])for(const e of list){const m=e.date.slice(0,7);bump(e.debit,m,'借方',e.debitAmount,sign);bump(e.credit,m,'貸方',e.creditAmount,sign);}
 const changes=[...totals].filter(([,v])=>v!==0).map(([k,v])=>{const [account,month,side]=JSON.parse(k);return {account,month,side,delta:v};}).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));
 const months=[...new Set([...added,...removed].map(e=>e.date.slice(0,7)).filter(Boolean))].sort();
 return {kind:'journal',added:added.length,removed:removed.length,months,changes:changes.slice(0,TOP),moreChanges:Math.max(0,changes.length-TOP)};
}
function reportDiff(oldRows,newRows){
 const a=reportCells(oldRows),b=reportCells(newRows),changes=[];let added=0,removed=0,changed=0;
 for(const [k,v]of b){if(!a.has(k)){added++;changes.push([k,v,null]);}else if(a.get(k)!==v){changed++;changes.push([k,v,a.get(k)]);}}
 for(const [k,v]of a)if(!b.has(k)){removed++;changes.push([k,null,v]);}
 const rows=changes.map(([k,next,prev])=>{const [month,account,dimension,tag,opening]=JSON.parse(k);return {month:opening?'期首':month,account,tag:dimension?(tag||'未選択'):'',next,prev,delta:(next||0)-(prev||0)};}).sort((x,y)=>Math.abs(y.delta)-Math.abs(x.delta));
 const months=[...new Set(rows.map(r=>r.month))].sort();
 return {kind:'report',added,removed,changed,months,changes:rows.slice(0,TOP),moreChanges:Math.max(0,rows.length-TOP)};
}
function compareExisting(s,it){
 const p=it.p,items=p.preview.items,type=p.type,imports=(s.imports||[]).filter(i=>i.type===type);
 if(E.reportType(type)){
  const old=existingReportRows(s,type,it.dimension);
  if(imports.some(i=>i.fingerprint===p.fingerprint&&(i.reportViewDimension??'total')===it.dimension)){it.status='same';it.notes.push('読込済みのCSVと同じファイルです');return;}
  const diff=reportDiff(old,items);
  if(old.length&&!diff.added&&!diff.removed&&!diff.changed){it.status='same';it.notes.push('読込済みの帳票と金額がすべて同じです（ファイル名や出力日時だけの違い）');return;}
  it.kind=old.length?'update':'new';it.diff=old.length?diff:null;
  try{RV?.prepare(s,type,items,{reportStats:p.preview.reportStats,fingerprint:p.fingerprint,errors:p.preview.errors.length,entity:p.preview.reportStats?.entity,sourcePeriod:p.preview.reportStats?.sourcePeriod},{mode:p.mode});}
  catch(err){it.status='check';it.reasons.push(String(err&&err.message||err));}
  return;
 }
 const old=s.datasets?.[type]||[];
 if(imports.some(i=>i.fingerprint===p.fingerprint)){it.status='same';it.notes.push('読込済みのCSVと同じファイルです');return;}
 if(type==='prior'){
  const {added}=multisetDiff(old.map(journalEntry),items.map(journalEntry));
  if(old.length&&!added.length){it.status='same';it.notes.push('すべての行が、読込済みの前期仕訳に含まれています');return;}
  const ids=new Set(old.filter(r=>r.hasId).map(r=>r.date+'|'+r.id));
  if(items.some(r=>r.hasId&&ids.has(r.date+'|'+r.id))){it.status='check';it.reasons.push('読込済みの前期仕訳と、同じ日付・仕訳番号の行が重なっています。置き換えるかを1ファイルずつ確認してください');return;}
  it.kind=old.length?'add':'new';it.diff=null;return;
 }
 const diff=journalDiff(old,items);
 if(old.length&&!diff.added&&!diff.removed){it.status='same';it.notes.push('読込済みの仕訳と中身がすべて同じです（ファイル名や出力日時だけの違い）');return;}
 it.kind=old.length?'update':'new';it.diff=old.length?diff:null;
}

/* ---------- 受信トレイ全体の判定 ---------- */
const included=it=>it.status==='apply'&&!it.excluded;
function evaluate(){
 if(!tray)return;const s=A.session();
 for(const it of tray.items)if(it.p)classify(it);
 const seen=new Map();
 for(const it of tray.items){
  if(!it.p||it.status==='blocked')continue;
  const k=it.p.type+'|'+(it.dimension||'')+'|'+contentSig(it);
  if(seen.has(k)){it.status='dup';it.dupOf=seen.get(k).name;it.reasons=[];continue;}
  seen.set(k,it);
 }
 for(const it of tray.items)if(it.status==='apply')compareExisting(s,it);
 // 事業者名：読込済みの帳票、受信トレイの帳票どうし
 const reportItems=tray.items.filter(it=>['apply','same'].includes(it.status)&&it.p&&E.reportType(it.p.type));
 const known=[...new Set((s.imports||[]).filter(i=>E.reportType(i.type)&&i.entity).map(i=>String(i.entity)))];
 const trayEntities=[...new Set(reportItems.map(it=>String(it.p.preview.reportStats?.entity||'')).filter(Boolean))];
 tray.entityMismatch=trayEntities.length>1?trayEntities:null;
 for(const it of reportItems){
  const e=String(it.p.preview.reportStats?.entity||'');
  const other=known.find(k=>e&&entityKey(k)!==entityKey(e));
  if(other){it.status='blocked';it.reasons=[`読込済みの帳票と事業者名が違います（読込済み：${other}／このCSV：${e}）。別の会社のCSVの可能性があります`];}
  else if(tray.entityMismatch&&it.status==='apply'){it.status='check';it.reasons.push('受信トレイの帳票に、事業者名が違うものがあります');}
  else if(it.status==='apply'&&it.entityWarn){if(known.some(k=>entityKey(k)===entityKey(it.entityWarn.entity)))it.notes.push(`帳票の事業者名「${it.entityWarn.entity}」は、前回読み込んだ帳票と同じです`);else it.needsEntityConfirm=true;}
 }
 // 帳票の期間（同じ会社・同じ年度でそろっているか）
 const periods=[...new Set(tray.items.filter(it=>it.status==='apply'&&it.p&&E.reportType(it.p.type)).map(it=>JSON.stringify(it.p.preview.reportStats?.sourcePeriod||null)))];
 tray.periodMismatch=periods.length>1;
 if(tray.periodMismatch)for(const it of tray.items){if(it.status!=='apply'||!E.reportType(it.p.type))continue;it.reasons.push('受信トレイのBS・PLで、帳票の期間がそろっていません');it.status='check';}
 // 同じ種類・切り口のCSVが複数ある場合は、1つを選んでもらう（前期の仕訳帳は複数を追加できる）
 const slots=new Map();
 for(const it of tray.items){if(!included(it))continue;const k=it.p.type==='prior'?'prior|'+it.id:it.p.type+'|'+(it.dimension||'');const a=slots.get(k)||[];a.push(it);slots.set(k,a);}
 for(const group of slots.values())if(group.length>1)for(const it of group)it.conflict=`同じ種類（${typeLabel(it)}）のCSVが${group.length}つあります。反映するものを1つだけ選んでください`;
 const priors=tray.items.filter(it=>included(it)&&it.p.type==='prior'),seenIds=new Map();
 for(const it of priors)for(const r of it.p.preview.items){if(!r.hasId)continue;const k=r.date+'|'+r.id,o=seenIds.get(k);if(o&&o!==it){it.conflict=`前期の仕訳帳どうしで、同じ日付・仕訳番号の行が重なっています（${o.name}）`;o.conflict=`前期の仕訳帳どうしで、同じ日付・仕訳番号の行が重なっています（${it.name}）`;}else seenIds.set(k,it);}
 const ready=type=>(s.datasets?.[type]||[]).length>0||tray.items.some(it=>it.p&&it.p.type===type&&(it.status==='same'||included(it)));
 tray.missing=BASIC.filter(([type])=>!ready(type)).map(([,label])=>label);
}
function completedCount(s){
 let n=0;const tasks=s.responseWorkflow?.tasks||{},done=new Set();
 for(const [id,t]of Object.entries(tasks))if(t&&t.stage==='complete'){n++;done.add(id);}
 for(const [id,d]of Object.entries(s.decisions||{}))if(d&&d.status==='resolved'&&!done.has(id))n++;
 for(const m of Object.values(s.manual||{}))if(m&&(m.status==='done'||m.status==='na'))n++;
 return n;
}

/* ---------- 画面 ---------- */
function dialog(){
 let d=$('#inboxDialog');
 if(!d){doc.body.insertAdjacentHTML('beforeend','<dialog id="inboxDialog" class="inbox-dialog" aria-labelledby="inboxTitle"></dialog>');d=$('#inboxDialog');d.addEventListener('click',onClick);d.addEventListener('change',onChange);d.addEventListener('cancel',e=>{if(tray?.busy)e.preventDefault();});}
 if(!input){doc.body.insertAdjacentHTML('beforeend','<input id="inboxInput" type="file" accept=".csv,.tsv,.txt" multiple hidden>');input=$('#inboxInput');input.addEventListener('change',e=>{const list=[...e.target.files];input.value='';if(list.length)receive(list);});}
 return d;
}
function diffHTML(it){
 const d=it.diff;if(!d)return '';
 const head=d.kind==='journal'?`追加 ${count(d.added)}行・削除 ${count(d.removed)}行（変わった月：${esc(d.months.map(m=>m.replace('-','/')).join('、')||'なし')}）`:`金額が変わったセル ${count(d.changed)}・新しいセル ${count(d.added)}・なくなったセル ${count(d.removed)}`;
 const rows=d.kind==='journal'?d.changes.map(c=>`<tr><td>${esc(c.account)}</td><td>${esc(c.month.replace('-','/'))}</td><td>${c.side}</td><td class="num">${esc(yen(c.delta))}</td></tr>`).join(''):d.changes.map(c=>`<tr><td>${esc(c.account)}${c.tag?'／'+esc(c.tag):''}</td><td>${esc(String(c.month).replace('-','/'))}</td><td class="num">${c.prev===null?'なし':esc(count(c.prev))}</td><td class="num">${c.next===null?'なし':esc(count(c.next))}</td><td class="num">${esc(yen(c.delta))}</td></tr>`).join('');
 const thead=d.kind==='journal'?'<tr><th>科目</th><th>月</th><th>側</th><th>合計の増減</th></tr>':'<tr><th>科目／内訳</th><th>月</th><th>前回</th><th>今回</th><th>差</th></tr>';
 return `<details class="inbox-diff"><summary>${head}</summary>${rows?`<table class="datatable"><thead>${thead}</thead><tbody>${rows}</tbody></table>`:''}${d.moreChanges?`<p class="small">ほか ${count(d.moreChanges)}件。金額の差が大きい順に${TOP}件を表示しています。</p>`:''}<p class="small">${d.kind==='journal'?'前回読み込んだ仕訳と、今回のCSVの仕訳を行ごとに照らし合わせた結果です。修正された仕訳は「削除」と「追加」の両方に数えます。':'前回読み込んだ同じ切り口の帳票と、科目・内訳・月ごとの金額を比べた結果です。'}</p></details>`;
}
function itemRow(it){
 const status=it.status,badge=`<span class="inbox-badge inbox-${status}">${esc(STATUS[status]||status)}${status==='apply'&&it.kind?'：'+esc(KIND[it.kind]):''}</span>`;
 const check=status==='apply'?`<input type="checkbox" data-inbox-include="${it.id}" ${it.excluded?'':'checked'} aria-label="${esc(it.name)}を反映する">`:'';
 const messages=[...it.reasons.map(r=>`<li>${esc(r)}</li>`),...(it.conflict?[`<li class="inbox-warn">${esc(it.conflict)}</li>`]:[]),...(it.dupOf?[`<li>${esc(it.dupOf)} と同じ内容のため、反映しません</li>`]:[]),...it.notes.map(n=>`<li class="small">${esc(n)}</li>`)].join('');
 const action=['check'].includes(status)?`<button class="btn small" data-inbox-legacy="${it.id}">1ファイルずつ確認して読み込む</button>`:'';
 const remove=`<button class="btn small inbox-remove" data-inbox-remove="${it.id}" aria-label="${esc(it.name)}を受信トレイから外す">外す</button>`;
 return `<tr class="inbox-row inbox-row-${status}"><td class="inbox-pick">${check}</td><td><strong class="inbox-name">${esc(it.name)}</strong><div class="small">${esc(typeLabel(it))}</div></td><td><div>${esc(periodLabel(it))}</div><div class="small">${esc(sizeLabel(it))}${it.p&&E.reportType(it.p.type)?'・'+(it.p.unit===1000?'千円':'円'):''}${it.p?.encoding==='shift_jis'?'・Shift_JIS':''}</div></td><td>${badge}${messages?`<ul class="inbox-msg">${messages}</ul>`:''}${diffHTML(it)}${action?`<div class="actions">${action}</div>`:''}</td><td class="inbox-rm">${tray.busy?'':remove}</td></tr>`;
}
function listHTML(){
 const s=A.session(),c=W.current(A.workspace()),items=tray.items,applyList=items.filter(included),n=k=>items.filter(it=>it.status===k).length;
 const conflicts=applyList.some(it=>it.conflict),reset=completedCount(s);
 const chips=`<div class="inbox-chips"><span class="inbox-badge inbox-apply">反映する ${applyList.length}</span><span class="inbox-badge inbox-same">変更なし ${n('same')}</span><span class="inbox-badge inbox-check">要確認 ${n('check')}</span>${n('dup')?`<span class="inbox-badge inbox-dup">重複 ${n('dup')}</span>`:''}${n('blocked')?`<span class="inbox-badge inbox-blocked">反映できない ${n('blocked')}</span>`:''}</div>`;
 const notices=[
  tray.reading?`<div class="notice" role="status">CSVを読み込んで判定しています…（${count(tray.reading.done)} / ${count(tray.reading.total)}）</div>`:'',
  tray.message?`<div class="notice amber">${esc(tray.message)}</div>`:'',
  tray.error?`<div class="notice error" role="alert">${esc(tray.error)}</div>`:'',
  tray.missing?.length?`<div class="notice amber"><strong>まだない基本資料：${esc(tray.missing.join('、'))}</strong><br><span class="small">必要なら freee から出力して、この受信トレイに追加してください。ないままでも、ほかの資料は反映できます。</span></div>`:'',
  tray.entityMismatch?`<div class="notice error">事業者名が違う帳票が混ざっています：${esc(tray.entityMismatch.join('、'))}。別の会社のCSVを外してください。</div>`:'',
  !applyList.length&&items.length&&!tray.reading?`<div class="notice">${n('same')===items.length?'すべて前回と同じ内容です。反映するものはありません。確認済みの記録はそのままです。':'自動で反映できるCSVがありません。「要確認」のCSVは、1ファイルずつ確認して読み込めます。'}</div>`:''
 ].join('');
 const table=items.length?`<div class="tablewrap"><table class="datatable inbox-table"><thead><tr><th><span class="sr-only">反映</span></th><th>ファイル・判定した種類</th><th>期間・件数</th><th>判定と前回との違い</th><th><span class="sr-only">外す</span></th></tr></thead><tbody>${items.map(itemRow).join('')}</tbody></table></div>`:'';
 const entities=[...new Set(applyList.filter(it=>it.needsEntityConfirm).map(it=>it.entityWarn.entity))];
 const confirm=applyList.length?`<label class="checklabel checkbox-row inbox-confirm"><input type="checkbox" id="inboxConfirm" ${tray.confirmed?'checked':''}><span><strong>反映するCSVは、すべて「${esc(c?.name||s.project.name||'')}」の資料です</strong>${entities.length?`<br><span class="small">BS・PLに書かれた事業者名「${esc(entities.join('」「'))}」も、この会社のことです（同じ事業者名なら、次回からは確認しません）。</span>`:''}${applyList.some(it=>it.p.type==='prior')?'<br><span class="small">前期の仕訳帳を含みます。同じ顧客の過去の仕訳帳であることを確認してください。</span>':''}</span></label>`:'';
 const resetNote=applyList.length&&reset?`<p class="notice amber small">反映すると、確認済みの記録 ${count(reset)}件が「再確認」に戻ります（1ファイルずつ読み込む場合と同じ動きです）。変更なしのCSVは反映しないため、記録に影響しません。反映後は、ほかの操作をする前なら反映前に戻せます。</p>`:'';
 const canApply=applyList.length&&!conflicts&&tray.confirmed&&!tray.busy&&!tray.reading&&!tray.entityMismatch;
 return `<div class="dialoghead"><div><div class="eyebrow">受信トレイ</div><h2 id="inboxTitle">入れたCSVを確認して反映</h2></div><button class="close" data-inbox="close" aria-label="閉じる" ${tray.busy?'disabled':''}>×</button></div>
<div class="dialogbody"><p class="inbox-scope">読込先：<strong>${esc(c?.name||'')}</strong>　対象期間：${esc(s.project.start)}〜${esc(s.project.end)}</p>${chips}${notices}${table}${confirm}${resetNote}</div>
<div class="dialogfoot"><button class="btn" data-inbox="clear" ${tray.busy||!items.length?'disabled':''}>すべて外す</button><button class="btn" data-inbox="add" ${tray.busy||items.length>=MAX_FILES?'disabled':''}>CSVを追加</button><button class="btn" data-inbox="legacyAll" ${tray.busy||!items.length?'disabled':''}>1ファイルずつ確認する（従来の方法）</button><button class="btn" data-inbox="close" ${tray.busy?'disabled':''}>閉じる</button><button class="btn primary" data-inbox="apply" ${canApply?'':'disabled'}>${tray.busy?'反映しています…':applyList.length?applyList.length+'件を反映':'反映するものはありません'}</button></div>`;
}
function resultHTML(){
 const r=last.result,can=undoAvailable(),confirmUndo=!!undo?.confirm;
 const list=(items,extra)=>items.length?`<ul class="inbox-result">${items.map(it=>`<li><strong>${esc(it.name)}</strong> ${esc(typeLabel(it))}${extra(it)}</li>`).join('')}</ul>`:'';
 const leftLabel=it=>it.status==='apply'&&it.excluded?'外したもの':STATUS[it.status]||'';
 const remaining=tray&&tray.companyId===A.workspace().activeId?tray.items.length:0;
 return `<div class="dialoghead"><div><div class="eyebrow">受信トレイ</div><h2 id="inboxTitle">反映しました</h2></div><button class="close" data-inbox="close" aria-label="閉じる">×</button></div>
<div class="dialogbody"><p><strong>反映した資料 ${r.applied.length}件</strong></p>${list(r.applied,it=>'（'+(KIND[it.kind]||'反映')+'）'+(it.diff?'<div class="small">'+(it.diff.kind==='journal'?`追加 ${count(it.diff.added)}行・削除 ${count(it.diff.removed)}行`:`金額が変わったセル ${count(it.diff.changed)}・新しいセル ${count(it.diff.added)}・なくなったセル ${count(it.diff.removed)}`)+'</div>':''))}
${r.same.length?`<p><strong>変更なしのため反映しなかった資料 ${r.same.length}件</strong>（確認済みの記録はそのままです）</p>${list(r.same,()=>'')}`:''}
${r.left.length?`<p><strong>まだ反映していない資料 ${r.left.length}件</strong></p>${list(r.left,it=>'：'+esc(leftLabel(it)))}`:''}
${r.resetCount?`<p class="notice amber small">確認済みだった記録 ${count(r.resetCount)}件は「再確認」に戻りました。</p>`:''}
${r.missing.length?`<p class="notice amber small">まだない基本資料：${esc(r.missing.join('、'))}</p>`:''}
${r.kubun.length?`<p class="small">消費税区分チェック：${r.kubun.map(k=>esc(k.name)+(k.ok?'を追加':'は'+esc(k.message))).join('、')}。${r.kubun.some(k=>k.ok)?'反映前に戻しても、消費税区分チェックに追加した分は戻りません。':''}</p>`:''}
<div class="inbox-undo"><p class="small">${can?'反映前の状態（資料と確認の記録）をこの画面に保持しています。ほかの操作をする前なら戻せます。ページを閉じる・会社を切り替えると、戻せなくなります。':'反映後に記録が変わったため、ここからは戻せません。必要ならバックアップから復元してください。'}</p></div></div>
<div class="dialogfoot">${can?`<button class="btn" data-inbox="${confirmUndo?'undoConfirmed':'undo'}">${confirmUndo?'本当に戻す（反映した'+r.applied.length+'件を取り消す）':'反映前に戻す'}</button>`:''}${remaining?`<button class="btn" data-inbox="openList">残りのCSVを確認する（${remaining}件）</button>`:''}<button class="btn primary" data-inbox="close">閉じる</button></div>`;
}
function draw(){
 const d=dialog();
 if(view==='result'&&last)d.innerHTML=resultHTML();
 else if(tray){view='list';d.innerHTML=listHTML();}
 else{if(d.open)d.close();return;}
 if(!d.open)d.showModal();
}
function close(){
 const d=$('#inboxDialog');if(d?.open)d.close();
 if(view==='result'){view='list';if(!undoAvailable())last=null;}
 else if(tray){tray.items=tray.items.filter(it=>['apply','check'].includes(it.status));tray.confirmed=false;if(!tray.items.length)tray=null;}
 A.render();
}
function undoAvailable(){if(!undo)return false;const ws=A.workspace();if(undo.companyId!==ws.activeId||undo.revision!==A.revision()){undo=null;return false;}return true;}

/* ---------- 操作 ---------- */
async function receive(list){
 const ws=A.workspace(),c=W.current(ws);
 if(!c)return A.toast('会社一覧で対象の会社を選んでから、CSVを入れてください');
 if(!c.entityType)return A.toast('先に個人／法人の区分を設定してください');
 const picked=[...list].filter(f=>/\.(csv|tsv|txt)$/i.test(f.name));
 if(!picked.length)return A.toast('CSV・TSV・テキスト形式を選んでください');
 if(tray?.busy||tray?.reading)return A.toast('受信トレイの処理が終わるまでお待ちください');
 if(!tray||tray.companyId!==c.id)tray={companyId:c.id,items:[],confirmed:false};
 view='list';tray.error='';tray.message='';
 const room=MAX_FILES-tray.items.length,accepted=picked.slice(0,Math.max(0,room));
 if(picked.length>accepted.length)tray.message=`受信トレイに入れられるのは${MAX_FILES}ファイルまでです。${picked.slice(accepted.length).map(f=>f.name).join('、')} は入れていません。`;
 A.resetImportQueue();
 tray.reading={done:0,total:accepted.length};draw();
 for(const f of accepted){
  const it=await readItem(f,c.id);
  if(!tray||tray.companyId!==A.workspace().activeId){tray=null;const d=$('#inboxDialog');if(d?.open)d.close();return A.toast('会社が切り替わったため、受信トレイへの読込を止めました');}
  tray.items.push(it);tray.reading.done++;draw();
 }
 tray.reading=null;evaluate();draw();
}
async function apply(){
 if(!tray||tray.busy)return;const ws=A.workspace();
 if(tray.companyId!==ws.activeId)return A.toast('会社が切り替わりました。受信トレイを閉じて、対象の会社で入れ直してください');
 evaluate();const list=tray.items.filter(included);
 if(!list.length||list.some(it=>it.conflict)||tray.entityMismatch){draw();return;}
 if(!tray.confirmed)return A.toast('「この会社の資料です」を確認してください');
 tray.busy=true;tray.error='';draw();
 const before=A.session();let snapshot;try{snapshot=structuredClone(before);}catch{snapshot=JSON.parse(JSON.stringify(before));}
 const resetCount=completedCount(before),applied=[];let failed=null;
 try{
  for(const it of list){
   A.resetImportQueue();const p=it.p;Object.assign(p,{companyId:ws.activeId,queueRevision:A.importQueueRevision(),committing:false,skip:false,shareKubun:false});if(p.type==='prior')p.scopeAcknowledged=true;
   const s=A.session(),ref=s.datasets[p.type],n=(s.imports||[]).length;
   await A.commit(p);
   const after=A.session();if(after!==s||after.datasets[p.type]===ref&&(after.imports||[]).length===n){failed=it;break;}
   applied.push(it);
  }
 }catch(err){failed=failed||{name:'受信トレイの処理',error:err};}
 if(failed){
  A.replaceSession(snapshot);A.syncActive();A.recompute();A.save();A.render();
  tray.busy=false;tray.error=`${failed.name} を反映できなかったため、この受信トレイからの反映をすべて取り消し、反映前の状態に戻しました。このCSVは「1ファイルずつ確認して読み込む」で内容を確認してください。`;evaluate();draw();return;
 }
 // 1ファイルずつの取込と同じく、仕訳帳は消費税区分チェックにも渡す（すべての反映が終わってから）
 const kubun=[];
 if(A.hasKubun()){const co=W.current(A.workspace());for(const it of applied)if(['current','prior'].includes(it.p.type)){try{const r=await A.shareJournals([{name:it.file.name,buffer:await it.file.arrayBuffer()}],co,it.p.type,it.p.mode);kubun.push({name:it.name,ok:!!(r&&r.read),message:r&&r.read?'':'読めない形式のため追加なし'});}catch(err){kubun.push({name:it.name,ok:false,message:'追加できませんでした：'+(err&&err.message||err)});}}}
 const s=A.session(),ready=type=>(s.datasets?.[type]||[]).length>0;
 const left=tray.items.filter(it=>!applied.includes(it)&&it.status!=='same');
 last={companyId:ws.activeId,result:{applied,same:tray.items.filter(it=>it.status==='same'),left,resetCount,missing:BASIC.filter(([type])=>!ready(type)).map(([,l])=>l),kubun}};
 undo={companyId:ws.activeId,snapshot,at:new Date().toISOString(),revision:A.revision(),confirm:false};
 // 反映しなかったCSVのうち、まだ扱えるもの（要確認・外したもの）は受信トレイに残す
 tray.items=left.filter(it=>it.status==='check'||it.status==='apply');tray.busy=false;tray.confirmed=false;if(!tray.items.length)tray=null;
 view='result';draw();
 A.toast(`受信トレイから${applied.length}件を反映しました`);
}
function restore(){
 if(!undoAvailable()){draw();return A.toast('戻せる状態がありません');}
 const snap=undo.snapshot;undo=null;last=null;view='list';A.resetImportQueue();A.replaceSession(snap);A.syncActive();A.recompute();A.save();A.render();
 const d=$('#inboxDialog');if(d?.open)d.close();
 A.toast('反映前の状態に戻しました（資料と確認の記録を、反映前に戻しました）');
}
function legacy(items){
 // 渡したCSVと、何もすることがないCSV（変更なし・重複）は受信トレイから外す
 if(!tray)return;const files=items.map(it=>it.file);tray.items=tray.items.filter(it=>!items.includes(it)&&!['same','dup'].includes(it.status));
 const d=$('#inboxDialog');if(d?.open)d.close();if(!tray.items.length)tray=null;
 A.legacyQueue(files);
}
function onClick(e){
 const b=e.target.closest('button');if(!b||b.disabled)return;
 const a=b.dataset.inbox;
 if(a==='close')return close();
 if(a==='undo'){if(undo)undo.confirm=true;return draw();}
 if(a==='undoConfirmed')return restore();
 if(a==='openList'){view='list';if(tray)evaluate();return draw();}
 if(!tray)return;
 if(a==='add'){dialog();input.click();return;}
 if(a==='apply')return apply();
 if(a==='clear'){if(tray.busy)return;tray=null;const d=$('#inboxDialog');if(d?.open)d.close();A.render();return;}
 // 「変更なし」「重複」のCSVは、従来の方法でも読み込まない（読み込むと確認済みの記録が再確認に戻るため）
 if(a==='legacyAll'){if(tray.busy)return;const items=tray.items.filter(it=>!['same','dup'].includes(it.status));if(!items.length)return A.toast('1ファイルずつ確認するCSVはありません（すべて変更なし・重複です）');legacy(items);return;}
 if(b.dataset.inboxLegacy){const it=tray.items.find(x=>x.id===b.dataset.inboxLegacy);if(it&&!tray.busy)legacy([it]);return;}
 if(b.dataset.inboxRemove){if(tray.busy)return;tray.items=tray.items.filter(x=>x.id!==b.dataset.inboxRemove);evaluate();return draw();}
}
function onChange(e){
 if(!tray||tray.busy)return;const t=e.target;
 if(t.id==='inboxConfirm'){tray.confirmed=t.checked;return draw();}
 if(t.dataset.inboxInclude){const it=tray.items.find(x=>x.id===t.dataset.inboxInclude);if(it){it.excluded=!t.checked;evaluate();draw();}}
}

/* ---------- 資料ページの案内 ---------- */
function banner(options){
 const id=options?.companyId||'',parts=[];
 if(tray&&tray.companyId===id&&tray.items.length)parts.push(`<p>受信トレイに、まだ反映していないCSVが${count(tray.items.length)}件あります。</p><button class="btn small" data-inbox-open="list">受信トレイを開く</button>`);
 if(last&&last.companyId===id&&undo&&undo.companyId===id&&undoAvailable())parts.push(`<p>受信トレイからの反映（${esc(new Date(undo.at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}))}）を、反映前に戻せます。</p><button class="btn small" data-inbox-open="result">内容を見る・戻す</button>`);
 return parts.length?`<section class="panel inbox-banner" id="inboxBanner" aria-label="受信トレイ">${parts.join('')}</section>`:'';
}
if(RI&&typeof RI.page==='function'){
 const basePage=RI.page;
 RI.page=function(session,result,options){
  let html=basePage.apply(this,arguments);
  html=html.replace('当期・前期、BS・PL、表示タグを自動判定します。','まとめて入れると、受信トレイで種類・期間・前回との違いを確かめてから反映します。');
  const b=banner(options),i=html.indexOf('<div class="intake-section-heading">');
  return b&&i>=0?html.slice(0,i)+b+html.slice(i):html;
 };
}
doc.addEventListener('click',e=>{
 const b=e.target.closest?.('[data-inbox-open]');if(!b)return;e.preventDefault();
 if(b.dataset.inboxOpen==='result'){if(last&&undoAvailable()){view='result';undo.confirm=false;draw();}else{last=null;A.render();A.toast('反映前に戻せる状態はありません');}return;}
 if(tray){view='list';evaluate();draw();}
});

root.ReviewInbox={
 accepts:s=>!!s&&!s.demo,
 receive,
 // テスト・診断用（読み取りだけ）
 state:()=>{
  const items=tray?tray.items.map(it=>({name:it.name,type:it.p?.type||null,dimension:it.dimension||null,status:it.status,kind:it.kind||null,excluded:!!it.excluded,reasons:it.reasons.slice(),notes:it.notes.slice(),needsEntityConfirm:!!it.needsEntityConfirm,warnings:(it.p?.preview?.warnings||[]).slice(),conflict:it.conflict||'',diff:it.diff?{kind:it.diff.kind,added:it.diff.added,removed:it.diff.removed,changed:it.diff.changed??null}:null})):[];
  if(view==='result'&&last)return {view:'result',companyId:last.companyId,busy:false,reading:false,error:'',confirmed:false,missing:last.result.missing.slice(),applied:last.result.applied.map(it=>it.name),items};
  return tray?{view:'list',companyId:tray.companyId,busy:!!tray.busy,reading:!!tray.reading,error:tray.error||'',confirmed:!!tray.confirmed,missing:tray.missing||[],items}:null;
 },
 canUndo:()=>undoAvailable()
};
})(typeof window!=='undefined'?window:globalThis);

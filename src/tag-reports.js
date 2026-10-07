/* 月次PL・BSの「表示するタグ」別の帳票（取引先・品目・部門・セグメント）を、科目合計と分けて持つ。
   - 科目合計（タグ欄が空の行）は datasets.monthlyBS / monthlyPL / priorBS / priorPL に1組だけ置く。
   - BSの取引先別は従来どおり datasets.monthlyBS / priorBS（回収・支払の確認に使う確定残高）。
   - それ以外のタグ別の行は session.tagReports（科目合計には足さない）。
   取り込みは「同じ帳票・同じタグ」の枠だけを置き換え、他のタグ別の内訳は残す。 */
(function(root){
'use strict';
const E=root.ReviewEngine,F=root.ReviewFinancial;
const clean=s=>String(s??'').normalize('NFKC').trim(),key=s=>clean(s).replace(/[\s　]/g,'');
const DIMS=F.TAG_DIMS;
const REPORT_TYPES=['monthlyBS','monthlyPL','priorBS','priorPL'];
const isBS=type=>E.reportType(type)==='monthlyBS';
// BSの取引先別だけは datasets に残す（既存の回収・支払の分析が読む）
const inDataset=(type,r)=>!r.tagDimension||isBS(type)&&r.tagDimension==='party';
function slotOf(i){
 if(!i||!REPORT_TYPES.includes(i.type))return null;
 if(typeof i.tagDimension==='string')return i.tagDimension;
 // v3.7 までの読込履歴：BSの取引先内訳つきは取引先の枠
 return isBS(i.type)&&i.reportStats?.tagRows>0?'party':'';
}
function compact(type,r,importSource){
 return {type,tagDimension:r.tagDimension,tagValue:r.tagValue,account:r.account,...(r.accountCode?{accountCode:r.accountCode}:{}),...(r.category?{category:r.category}:{}),...(r.role?{role:r.role}:{}),date:r.date,amount:r.amount,unit:r.unit,...(r.opening?{opening:true}:{}),...(Number.isInteger(r.line)?{line:r.line}:{}),importSource};
}
// 帳票のセル：科目・年月・期首かどうか。置き換えは新しい帳票が含むセル（年月・期首）だけにとどめる。
const cov=r=>r.date+(r.opening?'#期首':'');
function cellKey(r){return key(r.account)+'\u0001'+cov(r);}
// 千円の帳票は千円未満を切り捨てるため、円の値との差が1,000円未満なら同じ値とみなす
function sameAmount(a,b){
 if(!Number.isSafeInteger(a.amount)||!Number.isSafeInteger(b.amount))return a.amount===b.amount;
 if(a.unit===b.unit)return a.amount===b.amount;
 return Math.abs(a.amount-b.amount)<1000;
}
// 取り込む前に、読込済みの帳票との関係を調べる（ダイアログの注意と、確定時の処理で同じ結果を使う）
function plan(session,type,items,{importSource='',mode='replace'}={}){
 const dim=items.find(r=>r.tagDimension)?.tagDimension||'';
 const old=session.datasets?.[type]||[],oldTags=(session.tagReports||[]);
 const newParents=items.filter(r=>!r.tagDimension),newDetail=items.filter(r=>r.tagDimension);
 const covered=new Set(items.map(cov)),inside=r=>covered.has(cov(r));
 const newAccounts=new Set(newParents.map(r=>key(r.account))),newCells=new Map(newParents.map(r=>[cellKey(r),r]));
 const oldParents=old.filter(r=>!r.tagDimension&&inside(r));
 // 科目合計の食い違い（同じ科目・同じ月で金額が違う。円と千円の端数差は除く）
 const conflicts=[];
 for(const r of oldParents){const n=newCells.get(cellKey(r));if(n&&!sameAmount(r,n))conflicts.push({account:r.account,date:r.date,...(r.opening?{opening:true}:{}),old:r.amount,new:n.amount,source:r.source||''});}
 const conflictAccounts=new Set(conflicts.map(c=>key(c.account)));
 // 新しい帳票にない科目（同じ月の分）：すべて0円なら残す（品目別・部門別は合計0の科目を省くため）。0円でなければ外して知らせる
 const absent=new Map();for(const r of oldParents){const k=key(r.account);if(newAccounts.has(k))continue;const g=absent.get(k)||{account:r.account,zero:true};if(Number.isSafeInteger(r.amount)&&r.amount!==0)g.zero=false;absent.set(k,g);}
 const droppedAccounts=[...absent.values()].filter(g=>!g.zero).map(g=>g.account),droppedKeys=new Set(droppedAccounts.map(key));
 // 置き換えで外れる他のタグ別の内訳：科目合計が食い違う科目・外れる科目の、同じ月の分
 const staleKey=r=>inside(r)&&(conflictAccounts.has(key(r.account))||droppedKeys.has(key(r.account)));
 const otherDims=new Map();
 const noteStale=(d,r)=>{if(!staleKey(r))return;const g=otherDims.get(d)||new Set();g.add(r.account);otherDims.set(d,g);};
 for(const r of old)if(r.tagDimension&&r.tagDimension!==dim)noteStale(r.tagDimension,r);
 for(const r of oldTags)if(r.type===type&&r.tagDimension!==dim)noteStale(r.tagDimension,r);
 const stale=[...otherDims].map(([d,set])=>({dim:d,label:DIMS[d]||d,accounts:[...set]}));
 const overlap=mode==='append'?appendOverlap(session,type,items):0;
 // 新しい帳票の期間の外にある読込済みの行は残る（別の年度・期首など）
 const outside=old.filter(r=>!r.tagDimension&&!inside(r)).length;
 return {type,dim,mode,parents:newParents.length,details:newDetail.length,detailAccounts:new Set(newDetail.map(r=>key(r.account))).size,conflicts,droppedAccounts,stale,overlap,outside,months:[...covered].sort(),importSource};
}
function appendOverlap(session,type,items){
 const k=r=>JSON.stringify([cov(r),key(r.account),r.tagDimension||'',key(r.tagValue)]);
 const keys=new Set([...(session.datasets?.[type]||[]),...(session.tagReports||[]).filter(r=>r.type===type)].map(k));
 return items.filter(r=>keys.has(k(r))).length;
}
// 確定後の行数（上限の確認用）。session は変えない。
function preview(session,type,items,opt={}){
 const copy={datasets:{...session.datasets,[type]:(session.datasets?.[type]||[]).slice()},tagReports:(session.tagReports||[]).slice(),imports:(session.imports||[]).slice()};
 apply(copy,type,items,opt);
 return {dataset:copy.datasets[type].length,tagReports:copy.tagReports.length};
}
// 確定：session を書き換える（datasets[type] と tagReports と imports の該当の枠）
function apply(session,type,items,{importSource,mode='replace',record}={}){
 const p=plan(session,type,items,{importSource,mode}),dim=p.dim;
 const datasetRows=items.filter(r=>inDataset(type,r)),tagRows=items.filter(r=>!inDataset(type,r)).map(r=>compact(type,r,importSource));
 if(!Array.isArray(session.tagReports))session.tagReports=[];
 if(mode==='append'){
  session.datasets[type]=session.datasets[type].concat(datasetRows);
  if(tagRows.length)session.tagReports=session.tagReports.concat(tagRows);
 }else{
  const covered=new Set(items.map(cov)),inside=r=>covered.has(cov(r));
  const conflictKeys=new Set(p.conflicts.map(c=>key(c.account))),dropKeys=new Set(p.droppedAccounts.map(key)),newAccounts=new Set(items.filter(r=>!r.tagDimension).map(r=>key(r.account)));
  const stale=r=>inside(r)&&(conflictKeys.has(key(r.account))||dropKeys.has(key(r.account)));
  const old=session.datasets[type];
  const keep=old.filter(r=>{
   if(!inside(r))return true;
   if(!r.tagDimension)return !newAccounts.has(key(r.account))&&!dropKeys.has(key(r.account));
   if(r.tagDimension===dim)return false;
   return !stale(r);
  });
  const freshRows=reuse(old.filter(inside),datasetRows),oldSame=session.tagReports.filter(r=>r.type===type&&r.tagDimension===dim&&inside(r)),freshTags=reuseTags(oldSame,tagRows);
  session.datasets[type]=ordered(old,keep,freshRows);
  session.tagReports=session.tagReports.filter(r=>r.type!==type||!inside(r)||r.tagDimension!==dim&&!stale(r)).concat(freshTags);
  // 同じ値の内訳は読込済みの行を残すので、その読込元もこの読込の分として記録する
  const adopted=[...new Set([...freshRows.filter(r=>r.tagDimension),...freshTags].map(r=>r.importSource).filter(x=>x&&x!==importSource))];
  if(record&&adopted.length)record={...record,reusedSources:adopted};
  // 同じ枠の読込履歴は、新しい帳票の期間にすべて含まれるものだけ外す（別の年度の履歴は残す）
  const months=i=>[...(i.reportStats?.months||i.months||[]),...(i.reportStats?.openingMonth?[i.reportStats.openingMonth+'#期首']:[])];
  session.imports=(session.imports||[]).filter(i=>i.type!==type||slotOf(i)!==dim||!months(i).length||months(i).some(m=>!covered.has(m)));
 }
 if(record)session.imports.push({...record,tagDimension:dim});
 return p;
}
// 読込済みと同じ値の科目は、読込済みの行をそのまま使う（確認結果のIDは行のファイル名・行番号から作るため、
// 別のタグの帳票を足しただけ・同じCSVを別名で読み直しただけでIDを変えない）。円の値は千円の値で上書きしない。
function reuse(old,fresh){
 const group=rows=>{const m=new Map();for(const r of rows){const k=key(r.account)+'\u0001'+(r.tagDimension?r.tagDimension+'\u0001'+key(r.tagValue):'');if(!m.has(k))m.set(k,[]);m.get(k).push(r);}return m;};
 const before=group(old),same=new Set();
 for(const [k,b] of group(fresh)){
  const a=before.get(k);if(!a||a.length!==b.length)continue;
  const byCell=new Map(a.map(r=>[cov(r),r]));
  if(byCell.size===a.length&&b.every(r=>{const o=byCell.get(cov(r));return o&&sameAmount(o,r)&&(o.unit===r.unit||o.unit===1);}))same.add(k);
 }
 if(!same.size)return fresh;
 const done=new Set();
 return fresh.flatMap(r=>{const k=key(r.account)+'\u0001'+(r.tagDimension?r.tagDimension+'\u0001'+key(r.tagValue):'');if(!same.has(k))return [r];if(done.has(k))return [];done.add(k);return before.get(k);});
}
function reuseTags(old,fresh){
 if(!old.length)return fresh;
 const id=r=>[key(r.account),key(r.tagValue),cov(r),r.amount,r.unit].join('\u0001'),map=new Map(old.map(r=>[id(r),r]));
 return fresh.map(r=>map.get(id(r))||r);
}
// 科目の並びは新しい帳票の順。新しい帳票にない科目は、前の帳票で直前にあった科目の後ろに置く。
// 科目ごとに合計の行を先、タグの行を後にする（科目の並びは最初に出た行で決まるため）。
function ordered(old,keep,fresh){
 const order=[],seen=new Set(),push=k=>{if(!seen.has(k)){seen.add(k);order.push(k);}};
 for(const r of fresh)push(key(r.account));
 const keepKeys=new Set(keep.map(x=>key(x.account)));
 let prev=null;for(const r of old){const k=key(r.account);if(!seen.has(k)&&keepKeys.has(k)){const at=prev===null?0:order.indexOf(prev)+1;order.splice(at,0,k);seen.add(k);}if(seen.has(k))prev=k;}
 for(const r of keep)push(key(r.account));
 const by=new Map(order.map(k=>[k,{parents:[],tags:[]}]));
 for(const r of [...fresh,...keep])by.get(key(r.account))[r.tagDimension?'tags':'parents'].push(r);
 return order.flatMap(k=>[...by.get(k).parents,...by.get(k).tags]);
}
// 読込状況：帳票ごと・タグごと
function materials(session){
 const out=[];
 for(const type of REPORT_TYPES){
  const imports=(session.imports||[]).filter(i=>i.type===type);
  const slots=new Map();for(const i of imports){const d=slotOf(i);const list=slots.get(d)||[];list.push(i);slots.set(d,list);}
  const parentCount=(session.datasets?.[type]||[]).filter(r=>!r.tagDimension).length;
  const count=d=>d==='party'&&isBS(type)?(session.datasets?.[type]||[]).filter(r=>r.tagDimension==='party').length:(session.tagReports||[]).filter(r=>r.type===type&&r.tagDimension===d).length;
  const dims=['party','item','department',...['segment1','segment2','segment3'].filter(d=>slots.has(d)||count(d))];
  out.push({type,name:E.TYPES[type]?.name||type,totals:parentCount,plain:slots.get('')||[],dims:dims.map(d=>{const list=slots.get(d)||[];const last=list.at(-1);return {dim:d,label:DIMS[d],loaded:count(d)>0,rows:count(d),file:last?.name||'',at:last?.at||'',months:last?.reportStats?.months||last?.months||[],check:last?.reportStats?.tagCheck||null,imports:list};})});
 }
 return out;
}
// 帳票のタグ別の行（科目・タグごとに月の値をまとめる）
function rows(session,type,dim,account){
 const src=dim==='party'&&isBS(type)?(session.datasets?.[type]||[]).filter(r=>r.tagDimension==='party'):(session.tagReports||[]).filter(r=>r.type===type&&r.tagDimension===dim);
 const a=account==null?null:key(account),by=new Map();
 for(const r of src){if(a!==null&&key(r.account)!==a)continue;const k=key(r.account)+'\u0001'+key(r.tagValue);let g=by.get(k);if(!g)by.set(k,g={account:r.account,tag:r.tagValue,tagKey:key(r.tagValue),unselected:/^(?:未選択|取引先未選択)$/.test(key(r.tagValue)),values:{},opening:null,unit:r.unit,approximate:r.unit===1000});if(r.opening)g.opening=r.amount;else g.values[r.date]=r.amount;}
 return [...by.values()];
}
function has(session,type,dim){return dim==='party'&&isBS(type)?(session.datasets?.[type]||[]).some(r=>r.tagDimension==='party'):(session.tagReports||[]).some(r=>r.type===type&&r.tagDimension===dim);}
root.ReviewTagReports={DIMS,REPORT_TYPES,slotOf,plan,apply,preview,materials,rows,has,inDataset};
})(typeof window!=='undefined'?window:globalThis);

(function(root){
'use strict';
const E=root.ReviewEngine;
const clean=s=>String(s??'').normalize('NFKC').trim();
const key=s=>clean(s).replace(/[\s　]/g,'');
const roles={expense:'費用',income:'収益',asset:'資産',cash:'現預金',liability:'負債',equity:'純資産',contra:'控除科目',summary:'合計・利益行',unknown:'分類を確認'};
const defaults=()=>({comparisonConfirmed:false,agingAsOf:'',agingComplete:false,accountRoles:{}});
const indexes=new WeakMap();
function ledgerIndex(current){
 if(indexes.has(current))return indexes.get(current);const map=new Map();
 for(const r of current)for(const account of new Set([r.debit,r.credit].filter(Boolean))){const k=JSON.stringify([account,r.date.slice(0,7)]),g=map.get(k)||{debit:0,credit:0,rows:[]};if(r.debit===account)g.debit+=r.debitAmount;if(r.credit===account)g.credit+=r.creditAmount;g.rows.push(r);map.set(k,g);}
 indexes.set(current,map);return map;
}
function settings(session){return {...defaults(),...(session.financial||{}),accountRoles:session.financial?.accountRoles||{}};}
function prevMonth(m){const [y,n]=m.split('-').map(Number),d=new Date(Date.UTC(y,n-2,1));return d.toISOString().slice(0,7);}
function endDay(m){const [y,n]=m.split('-').map(Number);return new Date(Date.UTC(y,n,0)).toISOString().slice(0,10);}
function period(value,cfg){
 const s=clean(value),dt=E.date(s,true);if(dt)return dt;
 const m=s.match(/^(\d{1,2})月$/);if(!m||+m[1]<1||+m[1]>12)return null;
 const months=E.monthRange(cfg.start,cfg.end),matches=months.filter(x=>+x.slice(5)===+m[1]);
 if(matches.length===1)return matches[0];
 return null;
}
function monthColumns(headers,cfg){return headers.map((h,index)=>({index,month:/^(?:\d{4}[年\/\-.]\d{1,2}月?|\d{1,2}月)$/.test(clean(h))?period(h,cfg):null})).filter(x=>x.month);}
function guessMapping(headers,type,cfg){
 const m={};for(const [k,aliases]of Object.entries(E.TYPES[type].fields)){m[k]=-1;for(const a of aliases){const i=headers.findIndex(h=>key(h)===key(a));if(i>=0){m[k]=i;break;}}}
 const cols=monthColumns(headers,cfg);
 if(m.account<0&&cols.length){
  // freee exports an unnamed account column between the code and opening balance.
  // An unknown named column or multiple blank hierarchy columns cannot prove
  // which column is the account. Require an explicit mapping in that case.
  const candidates=headers.slice(0,cols[0].index).map((h,index)=>({h:key(h),index})).filter(x=>!x.h&&x.index!==m.accountCode&&x.index!==m.category&&x.index!==m.party);
  if(candidates.length===1)m.account=candidates[0].index;
 }
 return m;
}
function headerRow(rows,type,cfg){
 let best=0,score=-1;for(let i=0;i<Math.min(25,rows.length-1);i++){
  const meta=reportMetadata(rows,i),datedCfg=meta.periodValid?{...cfg,start:meta.start,end:meta.end}:cfg,m=guessMapping(rows[i],type,datedCfg),cols=monthColumns(rows[i],datedCfg);
  const s=(m.account>=0?3:0)+(cols.length?5+cols.length:m.date>=0&&m.amount>=0?5:0);
  if(s>score){score=s;best=i;}
 }return best;
}
function reportMetadata(rows,h){
 const title=clean(rows.slice(0,h).flat().join(' ')),m=title.match(/(?:対象)?期間\s*:\s*(\d{4})[年\/\-.](\d{1,2})月?\s*[~〜～]\s*(\d{4})[年\/\-.](\d{1,2})月?/);
 const start=m?E.date(m[1]+'-'+m[2],true):null,end=m?E.date(m[3]+'-'+m[4],true):null;
 const entity=title.match(/(?:損益計算書|貸借対照表)[_＿](.+?)\s*\((?:対象)?期間\s*:/)?.[1]?.trim()||title.match(/(?:会社名|事業者名)\s*:\s*([^,，;；]+)/)?.[1]?.trim()||'';
 const unitLabel=title.match(/(?:表示)?単位\s*:\s*(百万円|千円|万円|円)/)?.[1]||'';
 return {title,start,end,entity,unitLabel,periodValid:!!(start&&end&&start<=end&&E.monthRange(start,end).at(-1)===end),periodDeclared:!!m};
}
function detectUnit(rows,h){return reportMetadata(rows,h).unitLabel==='千円'?1000:1;}
function detectBasis(rows,h){
 // A final "期間累計" column is a total of monthly values, not cumulative months.
 // Detect a cumulative display only from explicit titles or display settings.
 const meta=clean(rows.slice(0,h).flat().join(' '));
 return /累計(?:損益計算書|PL)|(?:損益計算書|月次PL|PL)\s*[:(\[]?\s*累計|(?:表示方法|表示形式|集計方法|PLの表示)\s*:\s*累計|\(累計\)/i.test(meta)?'cumulative':'monthly';
}
function openingMonth(rows,h){
 // Only a full 12-month reporting year supplies an opening-month reference.
 // A filtered display period may start later than the fiscal year's opening.
 const meta=reportMetadata(rows,h);
 return meta.periodValid&&E.monthRange(meta.start,meta.end).length===12?prevMonth(meta.start):null;
}
function inferRole(account,type,category=''){
 const a=key(account),c=key(category);
 if(/(?:合計|計)$/.test(a)||/^(?:売上総利益|営業利益|営業損益|経常利益|経常損益|税引前.*利益|税引前.*損益|税引後.*利益|税引後.*損益|差引損益(?:計算)?(?:\([^)]*\))?|所得金額|青色申告特別控除前.*)$/.test(a))return 'summary';
 if(type==='monthlyPL'){
  if(/^(?:当期純利益|当期純損益|当期利益|当期損益)$/.test(a))return 'summary';
  if(/^(?:長期)?(?:前払|仮払|未払|未収|預り|仮受|前受|立替)/.test(a))return 'unknown';
  if(/^(?:売上|営業収益|報酬売上|雑収入|受取利息|受取配当|その他収益)/.test(a)||/収入金額|営業外収益|特別利益/.test(c))return 'income';
  if(E.plKind(a)||/^支払利息|^支払利子|^法人税|^法人住民税|^法人事業税/.test(a)||/経費|費用|原価|販売費|一般管理費|営業外費用|特別損失/.test(c))return 'expense';
  return 'unknown';
 }
 if(/減価償却累計|貸倒引当|評価引当/.test(a))return 'contra';
 if(/^事業主借$/.test(c))return 'liability';if(/^事業主貸$/.test(c))return 'asset';
 if(/現金|預金|当座|銀行|信用金庫|ゆうちょ|UFJ|SMBC|みずほ|りそな/.test(a)||/^ジャパンネット(?:銀行)?(?:\(|$)/.test(a))return 'cash';
 if(/^事業主貸/.test(a))return 'asset';if(/^事業主借/.test(a))return 'liability';
 if(/^預託金/.test(a))return 'asset';
 if(/売掛|未収|前払|仮払|立替|棚卸|商品|製品|原材料|建物|機械|工具|器具|備品|土地|敷金|保証金|貸付|有価証券|車両|構築物|ソフトウェア|電話加入権|建設仮勘定|開業費|創立費|繰延税金資産/.test(a))return 'asset';
 if(/未払|買掛|預り|仮受|前受|借入|リース債務/.test(a))return 'liability';
 if(/資本金|資本準備|利益剰余|元入金|当期.*利益|当期.*損益/.test(a))return 'equity';
 if(/純資産|資本/.test(c))return 'equity';if(/負債/.test(c))return 'liability';if(/資産/.test(c)||/^投資等$/.test(c))return 'asset';
 return 'unknown';
}
function isSection(a){return /^(?:収入金額|売上原価|経費|販売費及び一般管理費|営業外収益|営業外費用|特別利益|特別損失|繰戻額等|繰入額等|資産|資産の部|流動資産|固定資産|有形固定資産|無形固定資産|投資等|繰延資産|負債|負債の部|流動負債|固定負債|純資産|純資産の部|資本|資本の部|事業主貸|事業主借|未設定)$/.test(key(a));}
function reportMoney(value,unit){
 // Exact decimal arithmetic prevents a large fractional value from being
 // rounded into a seemingly valid yen integer by Number().
 const n=E.monetary(value,unit);return {value:n,valid:n===null||Number.isSafeInteger(n)};
}
function reportSum(values){if(!values.every(Number.isSafeInteger))return null;const n=Number(values.reduce((s,v)=>s+BigInt(v),0n));return Number.isSafeInteger(n)?n:null;}
// freee の月次推移で「表示するタグ」を選んだときの見出し（3列目）。1ファイルに1種類。
const TAG_DIMS=Object.freeze({party:'取引先',item:'品目',department:'部門',segment1:'セグメント1',segment2:'セグメント2',segment3:'セグメント3'});
function tagDimensionOf(label){const k=key(label);if(/^取引先(?:名)?$/.test(k))return 'party';if(k==='品目')return 'item';if(k==='部門')return 'department';const m=k.match(/^セグメント([1-3])$/);return m?'segment'+m[1]:null;}
function tagColumn(headers,mapping,cols){
 const limit=cols.length?cols[0].index:headers.length,found=headers.slice(0,limit).map((x,index)=>({index,dim:tagDimensionOf(x)})).filter(x=>x.dim);
 if(mapping.party>=0&&!found.some(x=>x.index===mapping.party))found.push({index:mapping.party,dim:'party'});
 return found;
}
// 科目ごと・月ごとに「内訳の合計＝科目合計」を確かめる。千円の帳票は行ごとの切捨てがあるので、内訳の件数×1,000円まで許す。
function reconcileTags(items,type,unit){
 const by=new Map();
 for(const r of items){const a=key(r.account);let g=by.get(a);if(!g)by.set(a,g={account:r.account,parent:new Map(),tags:new Map(),names:new Set(),unselected:false,role:r.role,code:r.accountCode});
  if(r.tagDimension){const m=g.tags.get(r.date)||[];m.push(r.amount);g.tags.set(r.date,m);g.names.add(key(r.tagValue));if(/^(?:未選択|取引先未選択)$/.test(key(r.tagValue))&&r.amount)g.unselected=true;}
  else g.parent.set(r.date,r.amount);}
 const mismatches=[],dropped=new Set(),residual=[],untagged=[],missing=[];let checked=0,partial=0;
 for(const [a,g] of by){
  if(!g.tags.size){if(g.parent.size&&g.code&&g.role!=='summary')missing.push(g.account);continue;}
  if(!g.parent.size)continue;checked++;const tol=unit===1000?g.names.size*1000:0;
  // 空欄（未読込）を含む月は0円とみなさず、照合しない
  for(const [m,total] of g.parent){if(!Number.isSafeInteger(total))continue;const vs=g.tags.get(m)||[];if(!vs.length||vs.some(v=>!Number.isSafeInteger(v))){if(vs.some(Number.isSafeInteger))partial++;continue;}const sum=reportSum(vs);if(sum===null)continue;const diff=reportSum([total,-sum]);if(diff!==null&&Math.abs(diff)>tol){mismatches.push({account:g.account,month:m,total,sum,diff});dropped.add(a);}}
  if(g.names.size===1&&[...g.names][0].match(/^(?:未選択|取引先未選択)$/))untagged.push(g.account);
  else if(type==='monthlyBS'&&g.unselected)residual.push(g.account);
 }
 return {checked,mismatches,dropped,residual,untagged,missing,partial};
}
function normalizeReports(rows,type,mapping,h,cfg,options={}){
 const items=[],errors=[],warnings=[],reportedTotals=[],detailReportedTotals=[],headers=rows[h],seen=new Set(),meta=reportMetadata(rows,h),datedCfg=meta.periodValid?{...cfg,start:meta.start,end:meta.end}:options.priorReport||options.requireReportYear?{...cfg,start:'',end:''}:cfg,cols=monthColumns(headers,datedCfg);let section='';
 const get=(r,k)=>mapping[k]>=0?clean(r[mapping[k]]):'';
 const unit=options.unit===1000?1000:1;
 const totalIndex=type==='monthlyPL'&&cols.length?(mapping.reportedTotal??-1):-1;
 const openingIndex=type==='monthlyBS'?(mapping.opening??-1):-1,openingDate=openingIndex>=0?openingMonth(rows,h):null;
 const fatal=message=>({items:[],errors:[{line:h+1,fields:[message]}],headers,warnings,fatal:true});
 if(meta.unitLabel&&!['円','千円'].includes(meta.unitLabel))return fatal('帳票の表示単位「'+meta.unitLabel+'」には対応していません。freeeで円単位の月次推移を再出力してください。');
 if(meta.periodDeclared&&!meta.periodValid)return fatal('帳票に記載された期間が不正です。期間を確認して月次推移を再出力してください。');
 if(type==='monthlyPL'&&/貸借対照表/.test(meta.title)||type==='monthlyBS'&&/損益計算書/.test(meta.title))return fatal('帳票のタイトルと資料の種類が一致しません。月次PL／月次BSの選択を修正してください。');
 if(meta.periodValid&&cols.some(c=>c.month<meta.start||c.month>meta.end))return fatal('帳票の期間と月見出しが一致しません。期間と年付き見出しを確認して再出力してください。');
 if(meta.entity&&cfg.name&&!/^(?:新しい自計化レビュー|実データ|操作サンプル)/.test(clean(cfg.name))&&key(meta.entity)!==key(cfg.name))warnings.push('帳票に記載された事業者は「'+meta.entity+'」、現在の設定名は「'+clean(cfg.name)+'」です。同じ顧客の資料であることを確認してください。');
 if(openingIndex>=0&&!openingDate)warnings.push('期首列はありますが帳票の12か月の年度範囲を確定できないため、期首残高の年月対応は保留します。表示期間の開始月を会計年度の開始月とは扱わず、期首の原文は保持します。');
 const uncertain=headers.filter(h=>/^\d{1,2}月$/.test(clean(h))&&!period(h,datedCfg));if(uncertain.length)return fatal('年度を確定できない月列：'+uncertain.join('・')+'。前期・当期の年月を取り違えないよう、期間の年度が記載された帳票か、年付きの年月で出力してください。');
 if((options.priorReport||options.requireReportYear)&&!meta.periodValid&&mapping.date>=0&&rows.slice(h+1).some(r=>/^\d{1,2}月$/.test(get(r,'date'))))return fatal('月の列に年度がありません。前期・当期の年月を取り違えないよう、期間の年度が記載された帳票か、年付きの年月で出力してください。');
 if(type==='monthlyPL'&&(options.basis||detectBasis(rows,h))==='cumulative')return {items,errors:[{line:h+1,fields:['累計PLは単月PLとして取り込めません。単月の月次推移を出力してください']}],headers,warnings};
 if(mapping.account<0||(!cols.length&&(mapping.date<0||mapping.amount<0)))return {items,errors:[{line:h+1,fields:['科目列と年月の見出し、または月・金額列を指定してください']}],headers,warnings};
 if([...cols.map(c=>c.index),mapping.accountCode,mapping.opening,mapping.date,mapping.amount,mapping.reportedTotal].filter(i=>i>=0).includes(mapping.account))return fatal('勘定科目列に年月・金額・科目コードの列が指定されています。勘定科目名の列を選択してください。');
 if(new Set(cols.map(x=>x.month)).size!==cols.length)return {items,errors:[{line:h+1,fields:['同じ年月の列が複数あります。年度・月の見出しを確認してください']}],headers,warnings};
 const mapped=new Set([...Object.values(mapping),...cols.map(c=>c.index)].filter(i=>i>=0));
 const tagCols=tagColumn(headers,mapping,cols);
 if(tagCols.length>1)return fatal('「表示するタグ」の列が複数あります（'+tagCols.map(x=>TAG_DIMS[x.dim]).join('・')+'）。freeeで表示するタグを1種類ずつ選んで、別々のCSVに出力してください。');
 const tagIndex=tagCols.length?tagCols[0].index:-1,tagDim=tagCols.length?tagCols[0].dim:null;
 const detailColumns=headers.map((x,index)=>({name:key(x),index})).filter(x=>x.index!==tagIndex&&/^(?:取引先(?:名)?|品目|部門|メモタグ|タグ|セグメント\d?|内訳|補助科目)$/.test(x.name));
 const unknownColumns=cols.length?headers.slice(0,cols[0].index).map((x,index)=>index).filter(i=>!mapped.has(i)):[];
 // Explicit account + party columns identify an authoritative BS detail.
 // Unlabeled native hierarchy and all other detail dimensions are ambiguous.
 const unknownTag=unknownColumns.filter(i=>i!==tagIndex);
 const expanded=rows.slice(h+1).some(raw=>detailColumns.some(c=>clean(raw[c.index]))||unknownTag.some(i=>clean(raw[i]))||/^(?:🏷|\[?(?:取引先|品目|部門|メモタグ)\]?\s*[:：])/.test(get(raw,'account')));
 if(expanded)return fatal(detailColumns.some(c=>/^(?:メモタグ|タグ)$/.test(c.name))?'メモタグ別の帳票は、1つの仕訳に複数のメモタグが付くと科目合計と合わないため取り込めません。「表示するタグ」を取引先・品目・部門のいずれかにして出力してください。':'取り込めない内訳・階層の列があります。freeeの月次推移で「分類と勘定科目」を「同じ列にする（一列）」、「表示するタグ」を なし・取引先・品目・部門 のいずれか1つにして、円単位で再出力してください。');
 const hasBare=cols.some(x=>/^\d{1,2}月$/.test(clean(headers[x.index])));if(hasBare)warnings.push(meta.periodValid?'年のない月見出しは、帳票タイトルに記載された期間から年度を対応しました。プレビューの年月を確認してください。':'年のない月見出しは、設定した対象期間から年度を対応しました。プレビューの年月を確認してください。');
 if(unit===1000)warnings.push('千円の帳票です。円換算して表示しますが、切捨て済みの概数なので仕訳との厳密な金額照合は保留します。');
 for(let i=h+1;i<rows.length;i++){
  const raw=rows[i];if(raw.every(x=>!clean(x)))continue;
  let account=get(raw,'account').replace(/^[▶▷►▸▼▽◆■●\s]+/,'');
  const accountCode=get(raw,'accountCode'),openingRaw=openingIndex>=0?String(raw[openingIndex]??''):'',tagValue=tagIndex>=0?clean(raw[tagIndex]):'';
  const reportedTotalRaw=totalIndex>=0?String(raw[totalIndex]??''):'',hasTotal=!!clean(reportedTotalRaw);
  const category=get(raw,'category')||section;
  const amounts=cols.length?cols.map(x=>({date:x.month,value:raw[x.index]})):[{date:period(get(raw,'date'),datedCfg),value:get(raw,'amount')}];
  if(openingDate)amounts.unshift({date:openingDate,value:openingRaw,opening:true});
  if(isSection(account)&&amounts.every(x=>!clean(x.value))&&!hasTotal){section=account;continue;}
  if(!account){if(amounts.some(x=>clean(x.value))||hasTotal)errors.push({line:i+1,fields:['勘定科目']});continue;}
  if(isSection(account)&&!/^事業主[貸借]$/.test(key(account))&&amounts.some(x=>clean(x.value))){section=account;account+=' 計';}
  const parsedTotal=reportMoney(reportedTotalRaw,unit),reportedTotal=hasTotal?parsedTotal.value:null;
  if(hasTotal&&!parsedTotal.valid){errors.push({line:i+1,fields:['期間累計の金額（正確な円整数と桁区切りを確認）']});continue;}
  // 千円の帳票は月ごと・期間累計ごとに千円未満を切り捨てるため、月数×1,000円までの差は注意にしない
  if(totalIndex>=0){
   const ns=cols.map(c=>reportMoney(raw[c.index],unit)),complete=ns.every(n=>n.valid&&Number.isSafeInteger(n.value)),calculated=complete?reportSum(ns.map(n=>n.value)):null,reported=reportedTotal;
   if(complete&&calculated===null)errors.push({line:i+1,fields:['月別合計が正確に計算できる円整数の上限を超えています']});
   const difference=Number.isSafeInteger(calculated)&&Number.isSafeInteger(reported)?reportSum([calculated,-reported]):null;
   if(Number.isSafeInteger(calculated)&&Number.isSafeInteger(reported)&&difference===null)errors.push({line:i+1,fields:['期間累計差額が正確に計算できる円整数の上限を超えています']});
   (tagValue?detailReportedTotals:reportedTotals).push({account,months:cols.map(c=>c.month),reported,calculated,difference,...(tagValue?{tagDimension:tagDim,tagValue}:{})});
   if(difference!==null&&Math.abs(difference)>(unit===1000?cols.length*1000:.01))warnings.push(account+(tagValue?' / '+tagValue:'')+'の期間累計とCSVの月別合計に差額 '+difference.toLocaleString()+'円があります。帳票の表示方法と読込範囲を確認してください。');
  }
  for(const cell of amounts){
   if(!cell.date){errors.push({line:i+1,fields:['年付きの月']});continue;}
   const parsed=reportMoney(cell.value,unit),n=parsed.value;
   if(!parsed.valid){errors.push({line:i+1,fields:[`${cell.date} の金額（正確な円整数と桁区切りを確認）`]});continue;}
   const id=JSON.stringify([cell.date,key(account),tagValue?tagDim:'',key(tagValue)]);if(seen.has(id)){errors.push({line:i+1,fields:[`${cell.date} ${account}${tagValue?' / '+tagValue:''} の重複（合計と内訳を確認）`]});continue;}seen.add(id);
   items.push({date:cell.date,account,accountCode,category,amount:n,role:inferRole(account,type,category),statement:type==='monthlyPL'?'PL':'BS',unit,approximate:unit===1000,basis:type==='monthlyPL'?'monthly':'closing',line:i+1,...(tagValue?{tagDimension:tagDim,tagValue}:{}),...(cell.opening?{opening:true}:{}),...(openingIndex>=0?{openingRaw}:{}),...(meta.periodValid?{reportStart:meta.start,reportEnd:meta.end}:{}),...(meta.entity?{reportEntity:meta.entity}:{}),...(totalIndex>=0?{reportedTotal,reportedTotalRaw,reportedTotalMonths:cols.map(c=>c.month)}:{})});
  }
 }
 if(items.some(r=>r.amount===null))warnings.push('空欄は0円にせず「未読込」として残します。');
 const tagCheck=tagDim?reconcileTags(items,type,unit):null;
 if(tagCheck?.dropped.size){
  const ex=tagCheck.mismatches.slice(0,4).map(x=>x.account+' '+x.month+'：科目合計 '+x.total.toLocaleString()+'円／'+TAG_DIMS[tagDim]+'別の合計 '+x.sum.toLocaleString()+'円（差 '+x.diff.toLocaleString()+'円）').join('、');
  warnings.push(TAG_DIMS[tagDim]+'別の内訳の合計が科目合計と合わない科目が '+tagCheck.dropped.size+' 科目あります（'+ex+(tagCheck.mismatches.length>4?' ほか':'')+'）。この科目の内訳は取り込まず、科目合計だけを取り込みます。内訳の行を削除・編集していないか、円単位で出力したかを確認してください。');
  for(let i=items.length-1;i>=0;i--)if(items[i].tagDimension&&tagCheck.dropped.has(key(items[i].account)))items.splice(i,1);
 }
 const referenceMonth=prevMonth(cfg.start),parentItems=items.filter(r=>!r.tagDimension),detailItems=items.filter(r=>r.tagDimension),openingMissingAccounts=type==='monthlyBS'?[...new Set(items.filter(r=>r.role!=='summary').map(r=>r.account))].filter(a=>!parentItems.some(r=>r.account===a&&r.date===referenceMonth&&Number.isFinite(r.amount))):[];
 // 内訳を別に保存すること・照合の結果は、注意ではないので取込画面の「表示するタグ」の案内（reportStats.tagCheck）で示す
 if(detailItems.length){const missing=[...new Set(detailItems.map(r=>r.account))].filter(a=>!parentItems.some(r=>r.account===a));if(missing.length)warnings.push('科目合計の行がない科目があります（'+missing.join('・')+'）。'+TAG_DIMS[tagDim]+'別の内訳を足して科目合計とはしないため、この科目の'+(type==='monthlyBS'?'残高とBS全体の一致':'金額')+'の確認は保留します。');}
 if(openingMissingAccounts.length)warnings.push('レビュー開始月の前月末（'+referenceMonth+'）の確定残高が '+openingMissingAccounts.length+'科目で不足しています。初月の増減照合は保留します。期首付きの通期BS、または前月末を含む月次BSを取り込んでください。');
 if(meta.periodValid&&cols.length&&E.monthRange(meta.start,meta.end).some(m=>!cols.some(c=>c.month===m)))warnings.push('帳票タイトルの期間に対して月見出しが不足しています。表示していない月を0円とは扱いません。');
 const declaredMonths=[...new Set(cols.length?cols.map(c=>c.month):rows.slice(h+1).map(r=>period(get(r,'date'),datedCfg)).filter(Boolean))].sort();
 return {items,errors,headers,warnings,reportStats:{months:[...new Set(items.filter(r=>!r.opening).map(r=>r.date))].sort(),declaredMonths,accounts:new Set(items.map(r=>r.account)).size,tagRows:detailItems.length,unit,openingMonth:openingDate,openingMissingAccounts,sourcePeriod:meta.periodValid?{start:meta.start,end:meta.end}:null,entity:meta.entity,reportedTotals,...(tagDim?{tagDimension:tagDim,detailReportedTotals,tagCheck:tagCheck&&{checked:tagCheck.checked,dropped:[...tagCheck.dropped],mismatches:tagCheck.mismatches.slice(0,50),residual:tagCheck.residual,untagged:tagCheck.untagged,missing:tagCheck.missing,partial:tagCheck.partial}}:{})}};
}
function effectiveRole(row,type,cfg){const override=cfg.accountRoles[type+':'+row.account];if(override)return override;const inferred=inferRole(row.account,type,row.category);return row.role==='asset'&&inferred==='cash'?'cash':row.role&&row.role!=='unknown'?row.role:inferred;}
function matrix(rows,type,months,cfg){
 const map=new Map();for(const r of rows){const k=key(r.account),g=map.get(k)||{account:r.account,category:r.category||'',role:effectiveRole(r,type,cfg),values:{},rows:[],tagReports:[],source:r.source||'仕訳からの参考集計',approximate:false,importConflicts:[]};g.approximate||=!!r.approximate||r.unit===1000;
  if(r.tagDimension){g.tagReports.push(r);map.set(k,g);continue;}g.rows.push(r);
  if(Object.hasOwn(g.values,r.date)){g.values[r.date]=null;let conflict=g.importConflicts.find(c=>c.month===r.date);if(!conflict){conflict={month:r.date,lines:[],sources:[],amounts:[]};g.importConflicts.push(conflict);}const entries=g.rows.filter(x=>x.date===r.date);conflict.lines=entries.map(x=>x.line??null);conflict.sources=entries.map(x=>x.source||'保存データ');conflict.amounts=entries.map(x=>x.amount);}else g.values[r.date]=r.amount;map.set(k,g);
 }return [...map.values()].map(g=>({...g,months,periodTotal:type==='monthlyPL'?reportSum(months.map(m=>g.values[m])):null,endBalance:Number.isSafeInteger(g.values[months.at(-1)])?g.values[months.at(-1)]:null}));
}
function ledgerPL(current,months,cfg,reference){
 const byName=new Map(reference.map(r=>[r.account,r])),map=new Map();
 for(const r of current)for(const side of ['debit','credit']){
  const a=r[side];if(!a)continue;
  const ref=byName.get(a),role=cfg.accountRoles['monthlyPL:'+a]||ref?.role||inferRole(a,'monthlyPL');if(!['expense','income'].includes(role))continue;
  const g=map.get(a)||{account:a,role,values:Object.fromEntries(months.map(m=>[m,0])),rows:[],source:'仕訳からの参考集計',category:'',approximate:false};
  g.values[r.date.slice(0,7)]+=(role==='income'?(side==='credit'?1:-1):(side==='debit'?1:-1))*r[side+'Amount'];g.rows.push(r);map.set(a,g);
 }return [...map.values()].map(g=>({...g,months,periodTotal:months.reduce((n,m)=>n+g.values[m],0),endBalance:null}));
}
function ledgerMovement(current,account,month,role){const normalCredit=['liability','equity'].includes(role),g=ledgerIndex(current).get(JSON.stringify([account,month]));return g?(normalCredit?-1:1)*(g.debit-g.credit):0;}
function sourceRows(row,current,months){const index=ledgerIndex(current),rs=months.flatMap(m=>index.get(JSON.stringify([row.account,m]))?.rows||[]);return rs.length?rs:row.rows.filter(r=>months.includes(r.date));}
function trendFindings(model,session,add){
 const cfg=session.project,current=model.current,months=model.months;
 const limitedLedger=!model.plReference.length&&(!cfg.complete||current.some(r=>r.importErrors>0)||(session.imports||[]).some(i=>i.type==='current'&&i.errors>0));
 for(const type of ['monthlyPL','monthlyBS'])for(const g of type==='monthlyPL'?model.pl:model.bs){
  if(['summary','unknown','contra'].includes(g.role))continue;
  const negatives=months.filter(m=>Number.isFinite(g.values[m])&&g.values[m]<0);
  if(negatives.length&&(type==='monthlyPL'||['asset','cash','liability'].includes(g.role))){
   const total=negatives.reduce((n,m)=>n+g.values[m],0),social=/法定福利費/.test(g.account);
   const check=type==='monthlyBS'?'monthly':social?'salary':g.role==='income'?'sales':'other';
   const lesson=(type==='monthlyPL'&&limitedLedger?'部分的な仕訳CSVからの参考集計です。月次PLか全件仕訳で、科目合計が実際に負数かを先に確認します。':'')+(social?'従業員負担分を給与仕訳で法定福利費の貸方に計上し、保険料の納付を別の月に計上している可能性があります。誤りとは断定せず、給与台帳の控除額、保険料の納付・未払計上、年度更新資料を突き合わせます。会社負担分の月次計上方針と整合するかも確認します。':type==='monthlyPL'?'返金・取消・科目振替でも月次金額はマイナスになります。継続しているか、対応する元の計上と証憑があるかを確認します。':'残高の符号・当座貸越・相殺・振替・前受を確認します。マイナスだけで修正を確定しません。');
   add(check,`${g.account}が${negatives.length}か月マイナスになっている`,`${negatives.map(m=>m+' '+g.values[m].toLocaleString()+'円').join('／')}。${type==='monthlyPL'?'該当月の合計 '+total.toLocaleString()+'円。':'各月末残高です。月末残高は合計しません。'}`,type==='monthlyPL'?total:g.values[negatives.at(-1)],sourceRows(g,current,negatives),{level:type==='monthlyPL'&&limitedLedger?'info':'candidate',dataReview:type==='monthlyPL'&&limitedLedger,monthlyCheck:true,account:g.account,months:negatives,lesson,steps:['該当月・科目の総勘定元帳を開く。',social?'給与台帳の従業員負担額と、労働保険・社会保険の納付資料を照合する。':'返金・取消・振替の相手科目と元の計上を照合する。','過去の処理方針と今回の実態を確認し、理由・追加資料をメモする。'],basis:'対象期間の科目合計が負数の月。高額のしきい値にかかわらず抽出',sources:social?['monthly','labor','sheet']:['monthly','sheet']});
  }
  for(let i=1;i<months.length;i++){
   const month=months[i],before=g.values[months[i-1]],now=g.values[month];if(!Number.isFinite(before)||!Number.isFinite(now)||before===now)continue;
   const delta=now-before,base=Math.abs(before),large=Math.abs(delta)>=cfg.large;
   if(!large||base&&Math.abs(delta)/base<cfg.variance)continue;
   add('monthly',`${g.account}の${type==='monthlyPL'?'月次金額':'月末残高'}が前月から大きく変動`,`${months[i-1]} ${before.toLocaleString()}円 → ${month} ${now.toLocaleString()}円（差額 ${delta.toLocaleString()}円）。`,delta,sourceRows(g,current,[months[i-1],month]),{level:type==='monthlyPL'&&limitedLedger?'info':'candidate',dataReview:type==='monthlyPL'&&limitedLedger,monthlyCheck:true,account:g.account,months:[months[i-1],month],lesson:type==='monthlyPL'?'年払い・賞与・季節性・契約変更・取消でも変動します。負数・ゼロからの変化も含めて、前月と当月の科目合計を照合しました。':'月末残高の増減です。資産の取得・返済・売掛金の発生と消込・科目振替など、増減を説明する仕訳を確認します。',basis:`前月差${cfg.large.toLocaleString()}円以上、変動${Math.round(cfg.variance*100)}%以上。前月0円の場合は差額のみ`,sources:['monthly'],steps:['前月と当月の元帳で増減の内訳を比較する。','年払い・新規契約・資産取得・返済・取消などの理由を証憑で確認する。','説明できない増減と必要資料をメモする。']});
  }
 }
}
function build(session,current,months){
 const cfg=settings(session),plReference=matrix(session.datasets.monthlyPL||[],'monthlyPL',months,cfg),bs=matrix(session.datasets.monthlyBS||[],'monthlyBS',months,cfg),calculated=ledgerPL(current,months,cfg,plReference);
 const ledgerReady=current.length>0&&!!cfg.comparisonConfirmed&&!!session.project.complete&&!current.some(r=>r.importErrors>0)&&!(session.imports||[]).some(i=>i.type==='current'&&i.errors>0);
 const model={cfg,months,current,pl:plReference.length?plReference:calculated,plReference,calculated,bs,comparisons:[],receivables:null,notes:[]};
 if(!plReference.length)model.notes.push('PLは仕訳からの参考集計です。科目名の分類とCSVの網羅性に依存します。freeeの月次PLを取り込んで照合できます。');
 if(!bs.length)model.notes.push('月次BSが未読込です。期首残高のない仕訳CSVから月末残高を作成しません。');
 for(const g of plReference)if(['income','expense'].includes(g.role))for(const m of months){
  const row=calculated.find(x=>x.account===g.account),actual=g.values[m];if(!Number.isFinite(actual))continue;
  const value=row?.values[m]??0;model.comparisons.push({type:'PL',account:g.account,month:m,reference:actual,calculated:value,difference:value-actual,ready:ledgerReady&&!g.approximate&&!g.rows.some(r=>r.importErrors>0),rows:sourceRows(g,current,[m])});
 }
 for(const g of bs)if(['asset','cash','liability','equity'].includes(g.role))for(const m of months){
  const previous=g.values[prevMonth(m)],actual=g.values[m];if(!Number.isFinite(previous)||!Number.isFinite(actual))continue;
  const value=previous+ledgerMovement(current,g.account,m,g.role);model.comparisons.push({type:'BS',account:g.account,month:m,reference:actual,calculated:value,difference:value-actual,ready:ledgerReady&&!g.approximate&&!g.rows.some(r=>r.importErrors>0),rows:sourceRows(g,current,[m])});
 }
 model.receivables=receivables(session,model);return model;
}
function receivables(session,model){
 const cfg=model.cfg,end=endDay(session.project.end),bsRows=model.bs.filter(g=>/^売掛金$/.test(key(g.account))),closing=bsRows.length===1?bsRows[0].endBalance:null;
 const flows=model.months.map(month=>({month,increase:0,decrease:0,bankLinked:0,other:0,otherIncomplete:false,rows:[]}));const byMonth=new Map(flows.map(g=>[g.month,g]));
 for(const rows of E.journalGroups(model.current)){
  const g=byMonth.get(rows[0].date.slice(0,7));if(!g)continue;
  const ar=rows.filter(r=>/^売掛金$/.test(key(r.debit))||/^売掛金$/.test(key(r.credit)));if(!ar.length)continue;
  const debit=ar.reduce((n,r)=>n+(/^売掛金$/.test(key(r.debit))?r.debitAmount:0),0),credit=ar.reduce((n,r)=>n+(/^売掛金$/.test(key(r.credit))?r.creditAmount:0),0);
  const bank=rows.some(r=>r.debitAmount>0&&(cfg.accountRoles['monthlyBS:'+r.debit]==='cash'||inferRole(r.debit,'monthlyBS')==='cash'));
  if(credit>0&&!bank&&(!session.project.complete||rows.some(r=>!r.hasId||r.journalAmbiguous||r.importErrors>0)||(session.imports||[]).some(i=>i.type==='current'&&i.errors>0)))g.otherIncomplete=true;
  g.increase+=debit;g.decrease+=credit;g.bankLinked+=bank?credit:0;g.other+=bank?0:credit;g.rows.push(...rows);
 }
 const aging=(session.datasets.aging||[]).filter(r=>/^売掛金$/.test(key(r.account))&&(!r.date||r.date<=end)).map(r=>({...r,asOf:r.asOf||cfg.agingAsOf||'',basisConfirmed:(r.asOf||cfg.agingAsOf)===end,days:r.due<end?Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(r.due+'T00:00:00Z'))/86400000):0}));
 const confirmed=aging.length>0&&aging.every(r=>r.basisConfirmed)&&cfg.agingComplete&&!aging.some(r=>r.importErrors>0),total=aging.length?aging.reduce((n,r)=>n+r.amount,0):null;
 return {end,closing,flows,aging,total,confirmed,overdue:aging.filter(r=>r.basisConfirmed&&r.amount>0&&r.days>0),difference:confirmed&&Number.isFinite(closing)?total-closing:null};
}
function addFindings(model,session,add){
 const put=add;add=(check,title,reason,amount,rows,opts)=>put(check,title,reason,amount,rows,{...opts,reviewContext:E.hash(JSON.stringify([reason,amount,opts?.level||'candidate',!!opts?.dataReview]))});
 trendFindings(model,session,add);
 for(const c of model.comparisons)if(Math.abs(c.difference)>.01)add('monthly',c.ready?`${c.type}帳票と仕訳集計の金額が異なる`:`${c.type}帳票との照合条件を確認`,`${c.month} ${c.account}：帳票 ${c.reference.toLocaleString()}円／${c.type==='BS'?'前月末＋当月増減':'仕訳集計'} ${c.calculated.toLocaleString()}円。`,c.difference,c.rows,{level:c.ready?'difference':'info',dataReview:!c.ready,monthlyCheck:true,account:c.account,months:[c.month],lesson:c.ready?'同じ範囲・会計設定と利用者が確認した資料で差が残っています。帳票の集計完了、科目の表示名、税込／税抜、決算整理、CSV欠落を確認します。':'帳票と仕訳の科目範囲、単位、税込／税抜、レポートの更新状態、全件読込の確認が必要です。条件がそろうまで仕訳の誤りと判定しません。',steps:['freeeのレポート集計が完了しているか確認する。','対象期間・科目・タグの絞込・税込／税抜・単位をそろえる。','全件読込と照合条件を確認して再集計し、残る差を元帳で調べる。'],basis:'独立して取り込んだ帳票と、仕訳の科目合計／前月末残高からの増減の比較',sources:['monthly','freee']});
 const ar=model.receivables;
 if(ar.difference!==null&&Math.abs(ar.difference)>.01)add('ar','売掛金の期末残高と未決済一覧の合計が異なる',`${ar.end}：BS売掛金 ${ar.closing.toLocaleString()}円／未決済一覧 ${ar.total.toLocaleString()}円。`,ar.difference,ar.aging,{level:'difference',monthlyCheck:true,account:'売掛金',lesson:'同じ基準日・全件と確認した一覧を比較しました。未決済登録をしていない振替伝票、集計の絞込、消込漏れ、二重登録、科目振替を確認します。差額だけで実際の未回収と断定しません。',steps:['BSと一覧が同じ基準日・同じ勘定科目・全取引先かを再確認する。','振替伝票・期首残高・ファクタリング・相殺・消込漏れを照合する。','銀行入金と請求書の対応を確認してメモする。'],sources:['monthly','receivable']});
 for(const flow of ar.flows)if(flow.other>0)add('ar',flow.otherIncomplete?'売掛金の減少仕訳の全行・預金科目を確認':'売掛金の減少に預金等を伴わない仕訳がある',`${flow.month}：売掛金の減少 ${flow.decrease.toLocaleString()}円のうち、預金等を借方に含まないまとまり ${flow.other.toLocaleString()}円。`,flow.other,flow.rows,{level:flow.otherIncomplete?'info':'candidate',dataReview:flow.otherIncomplete,monthlyCheck:true,account:'売掛金',months:[flow.month],lesson:(flow.otherIncomplete?'CSVの全行・仕訳番号・読取エラーが未確認です。預金行がCSVから欠けていないか、全件仕訳で確認してください。':'')+'売掛金の貸方計上には、銀行入金のほか相殺・ファクタリング・値引・取消・振替などがあります。売掛金が減っただけで回収済みとは判断せず、実際の減少理由を確認します。独自名の銀行科目は現預金の分類を設定してください。',steps:['売掛金の貸方仕訳を開いて、相手科目と請求書を確認する。','相殺・譲渡・値引・取消なのか、銀行科目の未分類なのかを確認する。','回収・消込の根拠と残る未決済をメモする。'],basis:'複合仕訳の全行で預金等の借方があるかを確認。入金の実在・請求書との紐付けは未確定',sources:['receivable']});
}
function validateSettings(value){
 if(value!==undefined&&(!value||typeof value!=='object'||Array.isArray(value)))throw Error('月次レビューの設定が不正です。');
 const out={...defaults(),...(value||{})};if(typeof out.comparisonConfirmed!=='boolean'||typeof out.agingComplete!=='boolean'||out.agingAsOf&&!E.date(out.agingAsOf)||!out.accountRoles||typeof out.accountRoles!=='object'||Array.isArray(out.accountRoles))throw Error('月次レビューの設定が不正です。');
 for(const v of Object.values(out.accountRoles))if(!Object.hasOwn(roles,v))throw Error('科目分類が不正です。');return out;
}
const F={roles,defaults,settings,prevMonth,endDay,period,monthColumns,guessMapping,headerRow,reportMetadata,detectUnit,detectBasis,inferRole,normalizeReports,matrix,build,addFindings,receivables,validateSettings,TAG_DIMS,tagDimensionOf,reconcileTags};
root.ReviewFinancial=F;E.Financial=F;if(typeof module!=='undefined')module.exports=F;
})(typeof window!=='undefined'?window:globalThis);

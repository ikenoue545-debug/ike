
(function(root){
'use strict';
// ReviewVariance: 月次PL・BSの科目の動きを、仕訳帳の取引から分解して「なぜ変動したか」を説明する。
// 帳票の数値は書き換えない。取引先・品目・部門の内訳、相手科目、摘要・メモ、前年同月の仕訳を読み、
// 「取引から分かること（事実）」と「理由の推測」を分けて返す。外部通信・AIモデルは使わない。
const E=root.ReviewEngine,F=root.ReviewFinancial;
const clean=v=>String(v??'').normalize('NFKC').trim();
const key=s=>clean(s).replace(/\s/g,'');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DIMS=Object.freeze({party:'取引先別',item:'品目別',department:'部門別'});
const NOUN=Object.freeze({party:'取引先',item:'品目',department:'部門',counter:'相手科目',desc:'摘要'});
// 摘要の表記ゆれ（日付・月・番号）を除いてまとめる
const descKey=e=>clean(e.row.description).replace(/\d{1,4}[\/年.\-]\d{1,2}([\/月.\-]\d{1,2}日?)?/g,'').replace(/[0-9０-９]+[月日回期]分?|第[0-9０-９]+期|[0-9０-９]+/g,'').replace(/[\s　・]+/g,' ').trim();
const CAP={party:'Party',item:'Item',department:'Department'};
const EPS=0.5;
const NF=new Intl.NumberFormat('ja-JP',{maximumFractionDigits:20});
const fmt=n=>Number.isFinite(n)?NF.format(n+0):'—';
const yen=n=>Number.isFinite(n)?fmt(n)+'円':'—';
const signed=n=>{if(!Number.isFinite(n))return '—';return (n>0?'+':n<0?'−':'±')+fmt(Math.abs(n))+'円';};
const ml=m=>m?(+m.slice(5))+'月':'';
const yml=m=>m?m.slice(0,4)+'年'+(+m.slice(5))+'月':'';
const sum=(xs,f=x=>x)=>xs.reduce((n,x)=>n+(f(x)||0),0);
const median=xs=>{const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const i=a.length>>1;return a.length%2?a[i]:(a[i-1]+a[i])/2;};
const near=(a,b,tol)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(b)>EPS&&Math.abs(a-b)<=Math.abs(b)*tol;
const PM=new Map(),NM=new Map();
const prevMonth=m=>{let v=PM.get(m);if(v===undefined){v=F.prevMonth(m);PM.set(m,v);}return v;};
const nextMonth=m=>{let v=NM.get(m);if(v===undefined){const [y,n]=m.split('-').map(Number);v=new Date(Date.UTC(y,n,1)).toISOString().slice(0,7);NM.set(m,v);}return v;};
const lastYear=m=>(+m.slice(0,4)-1)+m.slice(4);
const jcount=list=>new Set(list.map(e=>e.jk)).size;
const md=d=>d?(+d.slice(5,7))+'/'+(+d.slice(8,10)):'';

// ---- タグ（取引先・品目・部門）：対象科目と同じ側の値を使う。CSVに借貸別の列があれば、空欄は「未選択」のまま。
function tag(row,side,dim){
 const k=side+CAP[dim],v=clean(row[k]);if(v)return v;
 if(row.fieldOrigins&&row.fieldOrigins[k])return '';
 return clean(dim==='party'?row.party:row[dim]);
}
function narrative(e){const r=e.row,s=e.side;return [r.description,r[s+'Item'],r.item,r[s+'Memo'],r.memo,r[s+'MemoTags'],r.memoTags,r.note].map(clean).filter(Boolean).join(' ');}

// ---- 科目の性質
const CARD=/カード|クレジット|card|セゾン|amex|アメックス|jcb|visa|ダイナース|diners|mastercard/i;
const CASHNAME=/現金|預金|当座|銀行|信用金庫|信金|ゆうちょ|口座|bank/i;
function roleOf(model,type,account){
 const set=model.cfg.accountRoles[type+':'+account];if(set)return set;
 const g=(type==='monthlyPL'?model.pl:model.bs).find(x=>x.account===account);
 let r=g?.role||F.inferRole(account,type);
 if(r==='unknown'&&type==='monthlyBS'&&CARD.test(key(account)))r='liability';
 return r;
}
const creditNormal=r=>['income','liability','equity'].includes(r);
function isPLAccount(model,account){
 if(model.pl.some(g=>g.account===account&&['income','expense'].includes(g.role)))return true;
 if(model.bs.some(g=>g.account===account))return false;
 const set=model.cfg.accountRoles['monthlyPL:'+account];if(set)return ['income','expense'].includes(set);
 const r=F.inferRole(account,'monthlyPL');return r==='income'||r==='expense';
}
function isCash(c,a){if(!a)return false;const r=c.model.cfg.accountRoles['monthlyBS:'+a];if(r)return r==='cash';const reported=c.model.bs.find(g=>g.account===a);if(reported&&['cash','liability','equity','contra'].includes(reported.role))return reported.role==='cash';return F.inferRole(a,'monthlyBS')==='cash'||CASHNAME.test(key(a))&&!CARD.test(key(a));}
function family(type,account,role){
 const a=key(account);
 if(type==='monthlyPL'){
  if(/給料|給与|賃金|賞与|役員報酬|雑給|専従者給与/.test(a))return 'salary';
  if(/法定福利/.test(a))return 'social';
  if(/租税公課/.test(a))return 'tax';
  if(/地代家賃|家賃|賃借料/.test(a))return 'rent';
  if(/保険料/.test(a))return 'insurance';
  if(/減価償却/.test(a))return 'depreciation';
  if(role==='income')return /売上|営業収益|報酬/.test(a)?'sales':'income';
  if(/広告|販売促進/.test(a))return 'ads';
  if(/支払利息|利子割引/.test(a))return 'interest';
  return 'expense';
 }
 if(/^事業主貸/.test(a))return 'ownerDraw';
 if(/^事業主借/.test(a))return 'ownerContribution';
 if(role==='cash')return 'cash';
 if(CARD.test(a))return 'card';
 if(/売掛|未収/.test(a))return 'receivable';
 if(/未払消費税|未払法人税|未払事業税|未払住民税|未払所得税/.test(a))return 'taxPayable';
 if(/預り金/.test(a))return 'withholding';
 if(/借入/.test(a))return 'loan';
 if(/未払金|未払費用|買掛/.test(a))return 'payable';
 if(/前受/.test(a))return 'advanceReceived';
 if(/前払|仮払|立替/.test(a))return 'prepaid';
 if(/建物|車両|工具|器具|備品|機械|構築物|ソフトウェア|土地|一括償却/.test(a))return 'fixedAsset';
 if(/仮受消費税|仮払消費税/.test(a))return 'vat';
 if(/元入金|資本金/.test(a))return 'capital';
 if(/減価償却累計/.test(a))return 'accumulated';
 return role==='liability'?'payable':role==='cash'?'cash':'asset';
}
// 個人名らしい取引先（会社・役所・店舗を示す語がなく、カナ・漢字の姓名に近い形）
const ORG=/株式会社|有限会社|合同会社|合資会社|社団|財団|法人|NPO|\(株\)|\(有\)|㈱|㈲|inc|ltd|llc|corp|co\.|銀行|信金|信用金庫|組合|カード|税務署|役所|役場|市$|区$|町$|村$|県$|都$|府$|協会|機構|センター|事務所|ストア|ショップ|商店|商事|産業|工業|サービス|販売|不動産|電力|ガス|水道|通信|保険|証券|クリニック|病院|医院|薬局|ホテル|旅館|鉄道|タクシー|google|amazon|apple|microsoft|facebook|line|yahoo|ヤフー|ntt|kddi|ドコモ|ソフトバンク|楽天|メルカリ|paypay|freee|openai|dropbox|マイクロソフト|アマゾン|グーグル|アップル|サーバー|システム|ネット|ジャパン|マート|クラブ|スタジオ|オフィス|ホールディングス|トラベル|エナジー|コンテンツ|ソリューション|コンサル|デザイン|ラボ|カンパニー|コーポレーション|グループ|エージェンシー|モバイル|コム$|ドットコム|出版|印刷|運輸|運送|急便|郵便|電気|設備|建設|工務店|会$|部$|課$|局$|署$|所$|館$|院$|店$|堂$|屋$|社$/i;
function looksPerson(label){
 const s=clean(label),t=s.replace(/[\s・　]/g,'');
 if(!t||ORG.test(s)||/\d/.test(t))return false;
 if(/^[ァ-ヶー]+$/.test(t))return t.length>=4&&t.length<=12;
 if(/^[一-龠々]{1,4}[ぁ-んァ-ヶ一-龠々]{1,5}$/.test(t))return t.length>=2&&t.length<=7&&/[\s　]/.test(s)||t.length>=3&&t.length<=5;
 return false;
}

// ---- 読込データの索引（結果オブジェクトごとに1回）
const ctxCache=new WeakMap();
function context(session,result){
 if(!session||!result?.financial||!result.financial.months?.length)return null;
 const hit=ctxCache.get(result);if(hit&&hit.session===session)return hit;
 const model=result.financial,months=model.months,groups=new Map(),byAccount=new Map(),loaded=new Set(),prior=new Map(),priorRaw=new Map();
 const index=(rows,target,withGroups)=>{
  for(const r of rows){if(!r||typeof r.date!=='string'||r.date.length<7)continue;const jk=E.journalKey(r),month=r.date.slice(0,7);
   if(withGroups){let g=groups.get(jk);if(!g)groups.set(jk,g=[]);g.push(r);loaded.add(month);}
   for(const side of ['debit','credit']){const account=r[side],raw=r[side+'Amount'];if(!account||!Number.isFinite(raw)||raw===0)continue;let l=target.get(account);if(!l)target.set(account,l=[]);l.push({row:r,side,raw,month,account,jk,counter:null});}}
 };
 index(session.datasets?.current||[],byAccount,true);
 index(session.datasets?.prior||[],priorRaw,false);
 index(result.history?.rows||(session.datasets?.prior||[]).filter(r=>r.date?.slice(0,7)<session.project.start),prior,false);
 // 相手科目：同じ行の反対側。空欄なら同じ仕訳（複合仕訳）の反対側の科目。
 for(const list of byAccount.values())for(const e of list){
  const other=e.side==='debit'?'credit':'debit',direct=e.row[other];
  if(direct&&e.row[other+'Amount']===e.raw)e.counter=[direct===e.account?'（同じ科目内の振替）':direct];
  else e.counter=[...new Set((groups.get(e.jk)||[]).map(r=>r[other]).filter(a=>a&&a!==e.account))];
 }
 const loadedList=[...loaded].sort();
 const c={session,result,model,months,inPeriod:new Set(months),loaded,loadedList,firstLoaded:loadedList[0]||'',groups,byAccount,prior,priorRaw,series:new Map(),tags:new Map(),memo:new Map(),ledgerBS:null,cfg:session.project||{}};
 ctxCache.set(result,c);return c;
}
function threshold(c){return Math.max(10000,Math.round((c.cfg.large||100000)*0.3));}

// 月次BSが未読込のとき：仕訳から科目ごとの「当月の増減」だけを作る（残高ではない）。
const BS_ORDER={cash:0,receivable:1,prepaid:2,asset:3,fixedAsset:4,accumulated:5,vat:6,ownerDraw:7,card:8,payable:9,taxPayable:10,withholding:11,advanceReceived:12,loan:13,ownerContribution:14,capital:15};
function ledgerBS(c){
 if(c.ledgerBS)return c.ledgerBS;const out=[];
 if(!c.model.bs.length)for(const [account,list] of c.byAccount){
  if(isPLAccount(c.model,account)||!list.some(e=>c.inPeriod.has(e.month)))continue;
  const role=roleOf(c.model,'monthlyBS',account),sign=creditNormal(role)?-1:1,values=Object.fromEntries(c.months.map(m=>[m,0]));
  for(const e of list)if(Object.hasOwn(values,e.month))values[e.month]+=sign*(e.side==='debit'?1:-1)*e.raw;
  for(const m of c.months)if(!ledgerAvailable(c,m))values[m]=null;
  out.push({account,role,category:'',values,rows:[],flowOnly:true,fam:family('monthlyBS',account,role)});
 }
 out.sort((a,b)=>(BS_ORDER[a.fam]??20)-(BS_ORDER[b.fam]??20)||a.account.localeCompare(b.account,'ja'));
 c.ledgerBS=out;return out;
}
function openingOf(g,months){
 const p=prevMonth(months[0]);return Number.isFinite(g.values?.[p])?g.values[p]:null;
}
function groupOf(c,type,account){return (type==='monthlyPL'?c.model.pl:c.model.bs).find(x=>x.account===account)||(type==='monthlyBS'?ledgerBS(c).find(x=>x.account===account):null);}
function series(c,type,account){
 const id=type+'\u0001'+account;if(c.series.has(id))return c.series.get(id);
 const g=groupOf(c,type,account),role=roleOf(c.model,type,account),sign=creditNormal(role)?-1:1;
 const entries=(c.byAccount.get(account)||[]).map(e=>({...e,amount:sign*(e.side==='debit'?1:-1)*e.raw}));
 const ledger={};for(const e of entries)ledger[e.month]=(ledger[e.month]||0)+e.amount;
 const flowOnly=type==='monthlyBS'&&(!g||!!g.flowOnly);
 const s={type,account,role,sign,g,entries,ledger,flowOnly,fam:family(type,account,role),
  opening:type==='monthlyBS'&&g&&!flowOnly?openingOf(g,c.months):null,
  reported:type==='monthlyPL'?c.model.plReference.some(x=>x.account===account):!!g&&!flowOnly};
 c.series.set(id,s);return s;
}
function ledgerAvailable(c,m){
 const coverage=c.model.audit?.coverage,entry=Array.isArray(coverage)?coverage.find(x=>x.month===m):coverage?.[m];
 return entry?!!entry.available:c.loaded.has(m);
}
function ledgerAt(c,s,m){if(!ledgerAvailable(c,m))return null;return Object.hasOwn(s.ledger,m)?s.ledger[m]:0;}
function valueAt(c,s,m){
 if(s.type==='monthlyPL'){const v=s.g?.values?.[m];if(Number.isFinite(v))return v;if(s.reported&&c.inPeriod.has(m))return null;return ledgerAt(c,s,m);}
 if(s.flowOnly)return ledgerAt(c,s,m);
 const v=s.g?.values?.[m];if(Number.isFinite(v))return v;
 return m===prevMonth(c.months[0])&&Number.isFinite(s.opening)?s.opening:null;
}
function deltaAt(c,s,m){if(s.flowOnly)return ledgerAt(c,s,m);const a=valueAt(c,s,m),b=valueAt(c,s,prevMonth(m));return Number.isFinite(a)&&Number.isFinite(b)?a-b:null;}
function ledgerDeltaAt(c,s,m){if(s.type==='monthlyBS')return ledgerAt(c,s,m);const a=ledgerAt(c,s,m),b=ledgerAt(c,s,prevMonth(m));return Number.isFinite(a)&&Number.isFinite(b)?a-b:null;}

// ---- 内訳（取引先別・品目別・部門別・相手科目別・摘要別）：月ごとの仕訳を索引しておく
const keyFnOf=dim=>dim==='counter'?e=>(e.counter||[]).join('・'):dim==='desc'?descKey:e=>tag(e.row,e.side,dim);
const labelOf=(dim,k)=>dim==='counter'?(k||'（相手科目なし）'):dim==='desc'?(k?'「'+k+'」':'（摘要なし）'):(k||'未選択');
function indexGroups(entries,dim){
 const keyFn=keyFnOf(dim),map=new Map();
 for(const e of entries){const k=keyFn(e);let g=map.get(k);if(!g)map.set(k,g={key:k,label:labelOf(dim,k),missing:Object.hasOwn(DIMS,dim)&&!k,dim,flow:{},count:{},byMonth:new Map(),entries:[],first:e.month});
  g.entries.push(e);g.flow[e.month]=(g.flow[e.month]||0)+e.amount;g.count[e.month]=(g.count[e.month]||0)+1;let l=g.byMonth.get(e.month);if(!l)g.byMonth.set(e.month,l=[]);l.push(e);if(e.month<g.first)g.first=e.month;}
 return map;
}
function tags(c,type,account,dim){
 const id=type+'\u0001'+account+'\u0001'+dim;if(c.tags.has(id))return c.tags.get(id);
 const s=series(c,type,account),map=indexGroups(s.entries,dim);
 for(const t of map.values()){let n=0,any=false;for(const [m,l] of t.byMonth)if(c.inPeriod.has(m)){any=true;for(const e of l)n+=Math.abs(e.amount);}t.activity=any?n+1e-9:0;}
 const list=[...map.values()].filter(t=>t.activity>0).sort((a,b)=>(b.missing-a.missing)||b.activity-a.activity||a.label.localeCompare(b.label,'ja'));
 const out={list,map,named:list.some(t=>!t.missing)};c.tags.set(id,out);return out;
}

// ---- 1つの内訳（ドライバー）の当月・前月。通常月・周期などの統計は推測に使う上位の内訳だけ計算する。
function driver(c,s,m,g){
 const p=prevMonth(m),cur=g.byMonth.get(m)||[],prev=g.byMonth.get(p)||[],curV=ledgerAvailable(c,m)?g.flow[m]||0:null,prevV=ledgerAvailable(c,p)?g.flow[p]||0:null;
 let plus=0,minus=0;for(const e of cur){if(e.amount>0)plus+=e.amount;else minus-=e.amount;}
 return {dim:g.dim,key:g.key,label:g.label,missing:g.missing,cur:curV,prev:prevV,diff:s.type==='monthlyPL'?(Number.isFinite(curV)&&Number.isFinite(prevV)?curV-prevV:null):curV,plus,minus,curEntries:cur,prevEntries:prev,curCount:jcount(cur),prevCount:jcount(prev),
  isNew:cur.length>0&&g.first===m&&c.firstLoaded<m,byMonth:g.flow,entries:g.entries,month:m};
}
function stats(c,d){
 if(d.statsDone)return d;const m=d.month,n=nextMonth(m),others=c.loadedList.filter(x=>x!==m&&ledgerAvailable(c,x)),present=others.filter(x=>Math.abs(d.byMonth[x]||0)>EPS);
 return Object.assign(d,{typical:median(present.map(x=>d.byMonth[x])),presentMonths:present.length,recurring:present.length>=3&&present.length>=others.length*0.6,cycle:cycleOf([...present,...(d.curEntries.length?[m]:[])]),next:ledgerAvailable(c,n)?d.byMonth[n]||0:null,nextLoaded:ledgerAvailable(c,n),prevLoaded:ledgerAvailable(c,prevMonth(m)),statsDone:true});
}
function driversOf(c,s,m,groups){if(!ledgerAvailable(c,m))return [];const p=prevMonth(m),out=[];for(const g of groups)if(g.byMonth.has(m)||g.byMonth.has(p))out.push(driver(c,s,m,g));return rank(out,s.type);}
function monthIndex(m){return (+m.slice(0,4))*12+(+m.slice(5))-1;}
// 計上のある月の間隔がすべて同じ（2〜3か月ごと）なら、その周期を返す
function cycleOf(ms){const xs=[...new Set(ms)].map(monthIndex).sort((a,b)=>a-b);if(xs.length<3)return 0;const gaps=xs.slice(1).map((x,i)=>x-xs[i]);return gaps.every(g=>g===gaps[0])&&gaps[0]>=2&&gaps[0]<=3?gaps[0]:0;}
function rank(list,type){return list.filter(d=>d.curCount||(type==='monthlyPL'&&d.prevCount)).sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff)||Math.abs(b.cur)-Math.abs(a.cur));}
function pickDim(dims){
 let best=null,score=0;
 for(const d of Object.keys(DIMS)){const list=dims[d]||[],total=sum(list,x=>Math.abs(x.diff)),named=sum(list,x=>x.missing?0:Math.abs(x.diff));const v=total?named/total:0;if(v>score+1e-9){score=v;best=d;}}
 return best;
}
function counterSummary(list){const m=new Map();for(const e of list){const names=e.counter?.length?e.counter:['（相手科目なし）'],a=names.join('・'),x=m.get(a)||{account:a,amount:0,count:new Set(),compound:names.length>1};x.amount+=e.amount;x.count.add(e.jk);m.set(a,x);}return [...m.values()].map(x=>({account:x.account,amount:x.amount,count:x.count.size,compound:x.compound})).sort((a,b)=>Math.abs(b.amount)-Math.abs(a.amount));}
function largest(list){return list.reduce((b,e)=>!b||Math.abs(e.amount)>Math.abs(b.amount)?e:b,null);}
function entryText(e){if(!e)return '';const party=tag(e.row,e.side,'party'),item=tag(e.row,e.side,'item'),desc=clean(e.row.description);return `${md(e.row.date)} ${party?party+' ':''}${yen(Math.abs(e.amount))}（相手科目：${(e.counter||[]).join('・')||'なし'}${item?'・品目：'+item:''}）${desc?'「'+desc.slice(0,40)+'」':''}`;}

// ---- 推測ルール
const KEYWORDS=[
 [/年会費|年払|年間|1年分|12[かヶケカ]月|annual|年額|更新料|年契約/i,'annual','年払い・年会費・更新料など、1年分をまとめて支払った取引が含まれます。毎月の費用ではないため、前月比が大きくなります。','年払い・年会費'],
 [/賞与|ボーナス|bonus/i,'bonus','賞与（ボーナス）の支給・計上が含まれます。','賞与の支給'],
 [/返金|返品|返戻|取消|取り消し|キャンセル|戻入|払戻|払い戻し|refund|赤伝/i,'refund','返金・取消・払戻しの処理が含まれ、通常の取引とは逆向きの金額が計上されています。','返金・取消'],
 [/決算|整理|家事按分|按分/,'adjust','決算整理・按分の仕訳が含まれます。月次の取引とは別の調整です。','決算整理・按分'],
 [/修理|修繕|工事|リフォーム|交換/,'repair','修理・工事などの単発の支出が含まれます。','修理・工事'],
 [/パソコン|ノートPC|PC購入|iPad|iPhone|Mac|カメラ|プリンタ|モニター|ディスプレイ|机|デスク|椅子|チェア/i,'equipment','備品・機器の購入が含まれます。1点10万円以上なら固定資産（または一括償却資産・少額減価償却資産の特例）として処理するかを確認してください。','備品・機器の購入'],
 [/引越|移転|入居|敷金|礼金|仲介手数料/,'move','引越し・事務所移転や入居時の費用が含まれます。','移転・入居費用'],
 [/キャンペーン|セール|スポット|一括/,'campaign','キャンペーン・スポット・一括での支払いなど、単発の大きな取引が含まれます。','単発・一括の取引'],
 [/前払|前受|立替|仮払/,'advance','前払・立替・仮払の精算が含まれる可能性があります。','前払・立替の精算'],
];
const TAXES=[
 [/自動車税|軽自動車税/,'自動車税・軽自動車税は毎年5月（地域により6月）に納付する税金で、この時期だけ大きく増えます。','自動車税の納付'],
 [/固定資産税|都市計画税|償却資産税/,'固定資産税・償却資産税は年4回（概ね4・7・12・2月）の納期の月に計上されます。','固定資産税の納付'],
 [/事業税/,'個人事業税は8月・11月が納期です（法人は申告時）。','事業税の納付'],
 [/印紙/,'収入印紙の購入です。契約書・領収書の作成が多い月に増えます。','収入印紙の購入'],
 [/住民票|印鑑証明|証明書|登記簿|謄本|手数料/,'証明書などの発行手数料です。','証明書等の手数料'],
 [/消費税/,'消費税の納付（税込経理）です。確定申告・中間申告の納付月に増えます。','消費税の納付'],
 [/延滞|加算税/,'延滞税・加算税などの附帯税は、所得の計算上、必要経費（損金）になりません。処理を確認してください。','延滞税・加算税'],
 [/登録免許税/,'登記の際の登録免許税です。','登録免許税'],
 [/重量税|自賠責/,'車検時の自動車重量税などです。車検の月に増えます。','車検時の税金'],
];
const PERSONAL=[
 [/所得税|住民税|国民健康保険|国保|国民年金|介護保険|後期高齢/,'事業主個人の税金・社会保険料'],
 [/生命保険|医療保険|学資|学費|授業料|保育/,'個人の保険料・教育費'],
 [/生活費|食費|仕送り|小遣い/,'生活費'],
 [/ATM|出金|引出|引き出し/,'現金の引出し（生活費などへの充当）'],
 [/クレジット|カード/,'個人のカード代金の支払い'],
 [/家賃|住宅ローン/,'自宅の家賃・住宅ローン'],
];
function keywordHits(text){return KEYWORDS.filter(([re])=>re.test(text));}

function inferDriver(c,s,ex,d,push0){
 stats(c,d);
 const push=(level,short,text,kind)=>push0(level,short,text,kind,d.label);
 const L=d.missing?(NOUN[d.dim]||'')+'が未選択の取引':d.label;
 const text=d.curEntries.map(narrative).join(' ');
 const cps=counterSummary(d.curEntries),cpNames=cps.map(x=>x.account);
 const cashCP=cps.filter(x=>isCash(c,x.account)),cardCP=cps.filter(x=>CARD.test(key(x.account)));
 const person=d.dim==='party'&&!d.missing&&looksPerson(d.label);
 const n=d.curCount,T=d.typical;
 // 科目別の意味づけ
 if(s.fam==='ownerDraw'&&d.plus>0){
  const personal=PERSONAL.find(([re])=>re.test(text+' '+d.label));
  const via=cashCP.length?cashCP.map(x=>x.account).join('・'):cardCP.length?cardCP.map(x=>x.account).join('・'):cpNames.join('・');
  if(person)push('中',`${d.label}（個人名）への支払い`,`${d.label}は個人名と思われる取引先です。当月 ${n}件・${yen(d.plus)}を${via||'事業用の口座等'}から支払い、事業主貸に計上しています。事業主本人・家族への送金や生活費など、事業とは別の個人的な支出のための資金移動と考えられます。${d.presentMonths>=3&&Number.isFinite(T)&&T>EPS&&d.plus>T*1.5?`この取引先への支払いは通常月 約${yen(T)}のため、当月は多めです。`:d.isNew?'この取引先への支払いは当月が初めてです。':''}`,'owner');
  else if(personal)push('中',personal[1],`摘要・品目から${personal[1]}と読み取れる支出（${yen(d.plus)}、${n}件）を事業主貸に計上しています。事業の経費ではない個人負担の支払いを事業用の資金から支払ったものと考えられます。`,'owner');
  else if(cardCP.length&&!cashCP.length)push('中','カードでの個人的な利用',`${via}で支払った${L}（${yen(d.plus)}）を事業主貸に計上しています。事業用カードでの個人的な買い物などと考えられます。`,'owner');
  else if(cashCP.length)push('中',`口座・現金から${L}への個人的な支出`,`${via}から${L}に当月 ${n}件・${yen(d.plus)}を支出し、事業主貸に計上しています。事業と関係のない個人の支払い・引出しと考えられます。`,'owner');
  else if(cpNames.some(a=>isPLAccount(c.model,a)))push('中','経費からの振替（私用分の除外）',`経費科目（${cpNames.filter(a=>isPLAccount(c.model,a)).join('・')}）から事業主貸へ振り替えています。家事按分や私用分を経費から除いた処理と考えられます。`,'owner');
 }
 if(s.fam==='ownerDraw'&&d.minus>0&&d.plus<EPS)push('低','事業主貸の減少（相殺・訂正）',`${L}で事業主貸が ${yen(d.minus)} 減っています。期首の元入金への振替、事業主借との相殺、科目の訂正などが考えられます。`,'owner');
 if(s.fam==='ownerContribution'&&d.plus>0){
  const expenseCP=cpNames.filter(a=>isPLAccount(c.model,a));
  if(cashCP.length)push('中','個人資金の入金',`${cashCP.map(x=>x.account).join('・')}への入金 ${yen(d.plus)}（${L}）を事業主借に計上しています。事業主の個人資金を事業用口座へ入れた（資金の補填）と考えられます。`,'owner');
  else if(expenseCP.length)push('中','個人のお金で経費を立替',`${expenseCP.join('・')}を事業主借で計上しています（${yen(d.plus)}）。個人の財布・個人カードで事業の経費を支払った分と考えられます。`,'owner');
 }
 if(['card','payable'].includes(s.fam)&&!d.missing&&d.dim==='party'&&d.plus>EPS){
  const prevUse=sum(d.prevEntries,e=>e.amount>0?e.amount:0),diffUse=d.plus-prevUse;
  if(Math.abs(diffUse)>=threshold(c)*0.3||d.isNew)push('中',`${d.label}の${s.fam==='card'?'利用':'計上'}が${diffUse>=0?'増加':'減少'}`,`${d.label}の${s.fam==='card'?'カード利用':'計上'}は前月 ${yen(prevUse)} → 当月 ${yen(d.plus)}（${signed(diffUse)}）です。${cpNames.filter(a=>!isCash(c,a)).length?'計上先の科目は'+cpNames.filter(a=>!isCash(c,a)).slice(0,3).join('・')+'で、':''}${s.fam==='card'?'利用額（請求額）の増減が残高を動かしています。':'未払計上の増減が残高を動かしています。'}`,'usage');
 }
 if(s.fam==='receivable'&&d.dim==='party'&&!d.missing){
  const prevIncrease=sum(d.prevEntries,e=>e.amount>0?e.amount:0),bankDecrease=es=>-sum(es.filter(e=>e.amount<0&&(e.counter||[]).some(a=>isCash(c,a))),e=>e.amount),candidate=bankDecrease(d.curEntries),hist=c.loadedList.filter(m=>m<ex.prevMonth&&ledgerAvailable(c,m)).some(m=>bankDecrease(d.entries.filter(e=>e.month===m))>EPS);
  if(ledgerAvailable(c,ex.prevMonth)&&prevIncrease>EPS&&candidate<EPS&&hist)push('低',`${d.label}の預金等を含む減少候補が当月見当たらない`,`${d.label}の前月の売掛増加は ${yen(prevIncrease)} ですが、読込仕訳では当月に預金等を含む減少候補が見当たりません。支払条件・入金明細・消込・取消の有無を確認してください。期日と請求書対応がないため、延滞とは判定しません。`,'ar');
  else if(ledgerAvailable(c,ex.prevMonth)&&candidate>EPS&&prevIncrease>EPS&&candidate>prevIncrease*1.5)push('低',`${d.label}の預金等を含む減少候補が前月増加を上回る`,`${d.label}の当月の売掛減少候補 ${yen(candidate)} は前月増加 ${yen(prevIncrease)} を上回ります。過去請求分の決済・手数料差引・相殺・振替などの可能性を確認してください。この金額は売掛金側の金額で、入金額・入金遅延・請求書対応は未確定です。`,'ar');
 }
 if(s.fam==='cash'&&person&&d.minus>EPS){const to=cps.filter(x=>x.amount<0).map(x=>x.account).join('・');if(/給料|給与|賃金|賞与|役員報酬|外注|報酬|預り金|法定福利/.test(to))push('低',`${d.label}への給与・報酬の支払い`,`${d.label}への支払い ${yen(d.minus)}（相手科目：${to}）は、給与・報酬の支払いです。`,'pay');else push('中',`${d.label}（個人名）への送金`,`${d.label}は個人名と思われる取引先で、当月 ${yen(d.minus)} を送金しています${to?'（相手科目：'+to+'）':''}。${/事業主貸/.test(to)?'事業主貸で処理しているため、事業主本人・家族への資金移動など個人的な支出と考えられます。':'給与・報酬・立替精算などの支払いか、個人的な送金かを確認してください。'}`,'owner');}
 if(s.fam==='tax'&&d.curEntries.length&&!(d.dim==='party'&&d.missing)){
  const hit=TAXES.find(([re])=>re.test(text+' '+d.label));
  if(hit){push('高',hit[2],`${L}（${yen(d.cur)}）：${hit[1]}`,'tax');}
  if(/住民税|所得税|復興特別所得税|国民健康保険|国民年金/.test(text+' '+d.label)&&c.cfg.type==='individual')push('高','個人の税金が経費に計上',`${L}に住民税・所得税・国民健康保険などの記載があります。これらは事業主個人の負担のため、個人事業では租税公課（経費）ではなく事業主貸で処理するのが一般的です。処理を確認してください。`,'tax');
 }
 // 繰り返し取引の欠落・2か月分・急増・周期
 const label=d.dim==='counter'?`相手科目「${d.label}」の取引`:d.dim==='desc'?`摘要${d.label}の取引`:L,th=threshold(c);
 const A=x=>yen(Math.abs(x)),flowsCovered=s.type==='monthlyBS'&&!['ownerDraw','ownerContribution','asset','prepaid','advanceReceived'].includes(s.fam);
 if(d.cycle){
  const every=d.cycle===2?'2か月ごと（隔月）':'3か月ごと';
  if(Math.abs(d.cur)<EPS&&Math.abs(d.prev)>EPS)push('高',`${every}の取引で当月は計上のない月`,`${label}は${every}に計上される取引（通常 約${A(T)}）で、当月は計上のない月です。前月比の減少はこの周期によるもので、異常ではないと考えられます。`,'cycle');
  else if(Math.abs(d.cur)>EPS&&Math.abs(d.prev)<EPS)push('高',`${every}の取引の計上月`,`${label}は${every}に計上される取引で、当月はその計上月です（${A(d.cur)}）。前月比の増加はこの周期によるものと考えられます。`,'cycle');
 }else if(d.recurring&&!flowsCovered&&Number.isFinite(T)&&Math.abs(T)>EPS){
  if(Math.abs(d.cur)<EPS&&Math.abs(d.prev)>EPS){
   if(d.nextLoaded&&near(d.next,2*T,0.3))push('高','翌月に2か月分を計上',`${label}は通常毎月 約${A(T)}ありますが当月はなく、翌月（${ml(nextMonth(ex.month))}）に約2倍の${A(d.next)}が計上されています。当月分が翌月にまとめて計上された（計上月のずれ）と考えられます。`,'timing');
   else push('中','毎月の取引が当月はない',`${label}は通常毎月 約${A(T)}計上されていますが、当月は計上がありません。支払日・請求月のずれ、解約、または計上漏れの可能性があります。`,'timing');
  }else if(near(d.cur,2*T,0.25)&&Math.abs(d.prev)<EPS&&d.prevLoaded)push('高','前月分を当月にまとめて計上',`${label}は通常 約${A(T)}/月のところ、前月は計上がなく当月は約2倍の${A(d.cur)}です。前月分が当月にずれ込んでまとめて計上されたと考えられます。`,'timing');
  else if(near(d.prev,2*T,0.25)&&near(d.cur,T,0.25))push('高','前月の2か月分計上の反動',`${label}は前月に約2倍の${A(d.prev)}（2か月分）が計上されていたため、通常の${A(d.cur)}に戻った当月は前月比で減って見えます。`,'timing');
  else if(Math.abs(d.prev)<EPS&&d.prevLoaded&&near(d.cur,T,0.25)&&!(d.nextLoaded&&Math.abs(d.next)<EPS))push('中','前月に計上がなかった反動',`${label}は前月に計上がなく、当月は通常どおり${A(d.cur)}が計上されています。前月の計上漏れ・計上月のずれを確認してください。`,'timing');
  else if(near(d.cur,2*T,0.25))push('中','2か月分の計上の可能性',`${label}は通常 約${A(T)}/月のところ、当月は約2倍の${A(d.cur)}（${n}件）です。2か月分がまとめて計上された可能性があります。`,'timing');
  else if(Math.abs(d.cur)>Math.abs(T)*1.5&&Math.abs(d.cur-T)>=th*0.5)push('中','通常月より多い',`${label}は通常 約${A(T)}/月のところ、当月は${A(d.cur)}${d.cur*T>0?'（約'+(d.cur/T).toFixed(1)+'倍）':''}と多くなっています。`,'level');
  else if(Math.abs(d.cur)>EPS&&Math.abs(d.cur)<Math.abs(T)*0.7&&Math.abs(d.cur-T)>=th*0.5)push('低','通常月より少ない',`${label}は通常 約${A(T)}/月のところ、当月は${A(d.cur)}と少なくなっています。${s.fam==='sales'||s.fam==='income'?'受注・請求額の減少、請求月のずれ、計上漏れを確認してください。':'一部の計上漏れ・取消・請求月のずれを確認してください。'}`,'level');
 }
 let seasonal=false;
 // 前年同月
 if(d.dim!=='counter'&&c.prior.size){
  const ly=lastYear(ex.month),list=(c.prior.get(s.account)||[]).filter(e=>e.month===ly&&tag(e.row,e.side,d.dim)===d.key);
  if(list.length){const v=sum(list,e=>s.sign*(e.side==='debit'?1:-1)*e.raw);if(Math.abs(d.cur)>EPS&&near(d.cur,v,0.5)){seasonal=true;push('中','前年同月にも計上',`${label}は前年の同じ月（${yml(ly)}）にも${yen(v)}の計上があります。前年同月との共通点はありますが、1年分の比較だけでは毎年の季節性は確定できません。`,'season');}}
 }
 const newOK=!seasonal&&(s.type==='monthlyPL'?d.diff>EPS:['receivable','ownerContribution','fixedAsset','prepaid'].includes(s.fam)&&d.plus>EPS);
 if(d.isNew&&d.curCount&&newOK)push('中',`新しい${NOUN[d.dim]||'取引'}`,`${label}は、読み込んだ仕訳の中で当月が初めての計上です。${s.fam==='sales'||s.fam==='income'||s.fam==='receivable'?'新しい取引先・案件の売上が増加の要因と考えられます。':'新規の取引・スポットの支払いが増加の要因と考えられます。'}`,'new');
 // 件数・単価（複数件の取引だけ）
 if(s.type==='monthlyPL'&&d.prevCount>=2&&d.curCount>=2&&Math.abs(d.diff)>=th*0.3){
  const a=d.prev/d.prevCount,b=d.cur/d.curCount;
  if(d.curCount>=d.prevCount+2&&near(b,a,0.35))push('中','取引回数の増加',`${label}は件数が${d.prevCount}件→${d.curCount}件に増えており、1件あたりの金額（約${yen(b)}）は前月並みです。取引回数（利用・受注）の増加が変動の要因です。`,'count');
  else if(d.curCount<=d.prevCount-2&&near(b,a,0.35))push('中','取引回数の減少',`${label}は件数が${d.prevCount}件→${d.curCount}件に減っており、1件あたりの金額（約${yen(b)}）は前月並みです。取引回数の減少が変動の要因です。`,'count');
  else if(d.curCount===d.prevCount&&!near(b,a,0.2))push('中','1件あたりの金額が変化',`${label}は件数が同じ${d.curCount}件で、1件あたり 約${yen(a)} → 約${yen(b)}に変わっています。単価・契約金額・数量の変更が考えられます。`,'price');
 }
 // 大口の1件
 const big=largest(d.curEntries);
 if(big&&!flowsCovered&&d.curCount>=3&&Math.abs(big.amount)>=Math.abs(d.cur)*0.6&&Math.abs(big.amount)>=th)push('中','大口の1件が大部分',`${label}のうち ${entryText(big)} の1件が当月の大部分を占めます。`,'big');
 // 前月が特に多かった反動（スポット案件・一時的な増加）
 if(s.type==='monthlyPL'&&!d.recurring&&!d.cycle&&Math.abs(d.prev)>EPS&&Math.abs(d.cur)>EPS&&d.diff*Math.sign(d.prev)<0&&Math.abs(d.diff)>=th*0.5){
  const rest=Object.entries(d.byMonth).filter(([m,v])=>m!==ex.prevMonth&&m!==ex.month&&Math.abs(v)>EPS).map(([,v])=>v),T2=median(rest);
  if(Number.isFinite(T2)&&Math.abs(d.prev)>=Math.abs(T2)*1.8)push('中','前月が特に多かった反動',`${label}は前月 ${A(d.prev)} と、ほかの月（約${A(T2)}）より多かったため、当月（${A(d.cur)}）は前月比で減っています。前月の大口・スポットの取引の反動と考えられます。`,'rebound');
 }
 // 前月だけの一時的な取引がなくなった（PL）
 if(s.type==='monthlyPL'&&Math.abs(d.cur)<EPS&&Math.abs(d.prev)>EPS&&!d.recurring&&!d.cycle){
  const was=TAXES.find(([re])=>re.test(d.prevEntries.map(narrative).join(' ')+' '+d.label))?.[2]||keywordHits(d.prevEntries.map(narrative).join(' '))[0]?.[3]||'';
  push('高',`前月の${d.missing?'一時的な取引':d.label}がなくなった`,`前月に計上された${label}（${A(d.prev)}${was?'・'+was:''}）は毎月の取引ではなく、当月は計上がないため${s.role==='income'?'収益':'費用'}が減っています。`,'oneoff');
 }
 // 摘要・品目・メモのキーワード
 for(const [,kind,msg,short] of keywordHits(text))push('中',short,`${label}：${msg}`,kind);

}
function inferAccount(c,s,ex,push){
 const T=median(c.months.filter(m=>m!==ex.month&&m!==ex.prevMonth).map(m=>valueAt(c,s,m)).filter(Number.isFinite));
 const th=threshold(c);
 if(!s.entries.length){push('低','仕訳が見当たらない','この科目の仕訳が読み込んだ仕訳帳に見当たりません。帳票と仕訳帳の科目名の違い、仕訳帳の読込範囲を確認してください。','data');return;}
 if(!ex.curEntries.length&&s.type==='monthlyPL'&&Math.abs(ex.cur||0)<EPS&&Number.isFinite(T)&&Math.abs(T)>=th*0.3&&!ex.inferences.some(x=>x.kind==='timing'||x.kind==='cycle')){
  const what=s.fam==='salary'?'給与':s.fam==='rent'?'家賃':s.fam==='sales'?'売上':'この科目';
  push('中',`${what}の計上がない`,`当月は${what}の計上がありません（通常 約${yen(T)}/月）。${s.fam==='salary'?'給与の支払日・計上月のずれ（翌月にまとめて計上）、または計上漏れの可能性があります。':s.fam==='rent'?'家賃の引落日のずれ（翌月に2か月分）や計上漏れの可能性があります。':'計上月のずれ・計上漏れの可能性があります。'}`,'timing');
 }
 if(s.type==='monthlyPL'&&Number.isFinite(ex.prev)&&Number.isFinite(ex.cur)&&Number.isFinite(T)){
  const pd=Math.abs(ex.prev-T),cd=Math.abs(ex.cur-T);
  if(pd>=th&&pd>2*cd&&Math.abs(ex.delta)>=th&&!ex.inferences.some(x=>x.kind==='timing'&&x.level==='高'))push('中','前月が特殊だった反動',`前月（${yen(ex.prev)}）が通常の水準（約${yen(T)}）から外れていたため、前月比では${ex.delta>0?'増加':'減少'}して見えますが、当月（${yen(ex.cur)}）は通常の水準に近い金額です。`,'rebound');
 }
 if(s.fam==='salary'&&Number.isFinite(T)&&T>EPS&&near(ex.cur,2*T,0.25)&&!ex.inferences.some(x=>x.kind==='timing'))push('中','給与2か月分の可能性',`給与が通常（約${yen(T)}）の約2倍です。前月分の給与が当月に計上されたか、賞与の支給が考えられます。`,'timing');
 if(s.fam==='social'&&Number.isFinite(ex.cur)&&ex.cur<0)push('中','法定福利費のマイナス','法定福利費がマイナスです。給与から天引きした従業員負担分を法定福利費の貸方で処理し、保険料の納付が別の月に計上されていると、月によってマイナスになります。給与台帳と納付月を照合してください。','social');
 if(s.fam==='social'&&[6,7].includes(+ex.month.slice(5))&&ex.delta>th)push('低','労働保険の年度更新','6〜7月は労働保険の年度更新（概算・確定保険料の納付）の時期で、法定福利費が増えやすい月です。','season');
 if(s.fam==='insurance'&&ex.delta>th&&!ex.inferences.some(x=>x.kind==='annual'||x.kind==='season'))push('低','年払い保険料の可能性','保険料が大きく増えています。年払い・更新時の一括払いの可能性があります。複数年分の前払いなら前払費用への振替も確認してください。','annual');
 if(s.fam==='depreciation'&&ex.delta>th)push('中','減価償却費の計上','減価償却費は決算月や四半期にまとめて計上されることが多く、その月だけ大きくなります。','adjust');
 // BS：当月の増加・減少の中身（相手科目）から科目ごとの説明
 if(s.type==='monthlyBS'){
  const inc=ex.curEntries.filter(e=>e.amount>0),dec=ex.curEntries.filter(e=>e.amount<0),incV=sum(inc,e=>e.amount),decV=-sum(dec,e=>e.amount);
  const cashOut=dec.filter(e=>(e.counter||[]).some(a=>isCash(c,a))),cashIn=inc.filter(e=>(e.counter||[]).some(a=>isCash(c,a)));
  const payV=-sum(cashOut,e=>e.amount);
  const pays=m=>-sum(s.entries.filter(e=>e.month===m&&e.amount<0&&(e.counter||[]).some(a=>isCash(c,a))),e=>e.amount);
  const payT=median([...c.loaded].filter(m=>m!==ex.month).map(pays).filter(v=>v>EPS));
  if(s.fam==='card'||s.fam==='payable'){
   const noun=s.fam==='card'?'カード利用':'計上',payNoun=s.fam==='card'?'口座からの引落し':'支払';
   push('高',`${noun}${yen(incV)}・${payNoun}${yen(payV)}`,`当月の${noun}は ${yen(incV)}（${jcount(inc)}件）、${payNoun}は ${yen(payV)}（${jcount(cashOut)}件）です。${incV>decV?`${noun}が${payNoun}を上回ったため残高が増えています。`:incV<decV?`${payNoun}が${noun}を上回ったため残高が減っています。`:''}`,'flow');
   if(payT&&payV<EPS&&ex.delta>0)push('中',`${payNoun}が当月はない`,`通常は毎月 約${yen(payT)}の${payNoun}がありますが、当月は計上がありません。そのため${noun}がそのまま残高に積み上がっています。引落日が月をまたいだ、口座明細が未登録の可能性があります。`,'timing');
   else{const payN=m=>jcount(s.entries.filter(e=>e.month===m&&e.amount<0&&(e.counter||[]).some(a=>isCash(c,a))));const usual=median([...c.loaded].filter(m=>m!==ex.month).map(payN).filter(n=>n>0));if(payT&&usual===1&&jcount(cashOut)>=2)push('中',`${payNoun}が2回分`,`通常は月1回の${payNoun}が、当月は${jcount(cashOut)}回（合計 ${yen(payV)}）計上されています。前月に引き落とされなかった分が当月にまとめて計上された可能性があります。`,'timing');}
   if(s.fam==='card'&&ex.dims?.party&&ex.dims.party.some(d=>d.missing&&d.minus>EPS)&&ex.dims.party.some(d=>!d.missing&&d.plus>EPS))push('低','引落しは取引先が未選択',`引落しの仕訳に取引先が付いていないため、取引先別では「未選択」がマイナス、各利用先がプラスで積み上がります（freeeの表示と同じ動き）。取引先別の残高は利用先ごとの未払額を表しません。`,'note');
  }else if(s.fam==='receivable'){
   push('高',`売掛金の増加${yen(incV)}・減少${yen(decV)}`,`仕訳上の売掛金の増加は ${yen(incV)}（${jcount(inc)}件）、減少は ${yen(decV)}（${jcount(dec)}件）です。減少には入金・取消・値引・相殺・科目振替が含まれるため、回収額とは区別します。`,'flow');
   if(cashOut.length)push('中','預金等を伴う減少候補',`減少仕訳のうち預金等を相手科目に含むまとまりは ${yen(payV)} です。複合仕訳の手数料や他の債権が含まれる場合があり、請求書ごとの入金額・消込は確定していません。`,'receivableCash');
  }else if(s.fam==='cash'){
   const others=[...c.loaded].filter(m=>m!==ex.month),missIn=[],missOut=[],dbl=[];
   for(const tg of tags(c,s.type,s.account,'party').list){if(tg.missing)continue;
    for(const [dir,list] of [[1,missIn],[-1,missOut]]){const f=m=>sum(tg.byMonth.get(m)||[],e=>e.amount*dir>0?Math.abs(e.amount):0),pres=others.filter(m=>f(m)>EPS);if(pres.length<3||pres.length<others.length*0.6)continue;const T=median(pres.map(f)),now=f(ex.month);if(T>=th&&now<EPS)list.push(tg.label+'（通常 約'+yen(T)+'）');else if(dir>0&&now-T>=th&&near(now,2*T,0.25))dbl.push(tg.label+'（'+yen(now)+'）');}}
   if(missIn.length)push('中','通常ある入金がない',`毎月ある${missIn.slice(0,3).join('、')}からの入金が当月はありません。入金の遅れ、入金の計上漏れ、口座明細の未登録の可能性があります。`,'timing');
   if(dbl.length)push('中','2か月分の入金',`${dbl.slice(0,3).join('、')}は通常の約2倍の入金です。遅れていた前月分がまとめて入金されたと考えられます。`,'timing');
   if(missOut.length)push('低','通常ある支払がない',`毎月ある${missOut.slice(0,3).join('、')}への支払が当月はありません。支払日・引落日のずれや計上漏れを確認してください。`,'timing');
   const ins=counterSummary(inc).slice(0,2).map(x=>`${x.account} ${yen(x.amount)}`).join('、'),outs=counterSummary(dec).slice(0,3).map(x=>`${x.account} ${yen(-x.amount)}`).join('、');
   push('高',`入金${yen(incV)}・出金${yen(decV)}`,`当月の入金は ${yen(incV)}${ins?'（主な相手科目：'+ins+'）':''}、出金は ${yen(decV)}${outs?'（主な相手科目：'+outs+'）':''}です。`,'flow');
  }else if(s.fam==='taxPayable'||s.fam==='withholding'){
   if(payV>EPS){const via=[...new Set(cashOut.flatMap(e=>e.counter||[]).filter(a=>isCash(c,a)))].join('・')||'口座等',what=/消費税/.test(s.account)?'消費税':/法人税/.test(s.account)?'法人税等':/事業税/.test(s.account)?'事業税':/住民税/.test(s.account)?'住民税':'';push('高',s.fam==='withholding'?'源泉所得税等の納付':`${what||'税金'}の納付`,`${ml(ex.month)}に${s.account} ${yen(payV)} を${via}から納付しています${s.fam==='withholding'?'（給与・報酬から預かった源泉所得税・住民税の納付。納期の特例なら1月・7月に半年分をまとめて納付）':''}。そのため残高が減っています。`,'tax');}
   if(incV>EPS)push('中',s.fam==='withholding'?'給与等からの預り':'税額の計上',s.fam==='withholding'?`給与・報酬の支払時に源泉所得税などを ${yen(incV)} 預かっています。`:`決算・申告に伴う税額 ${yen(incV)} を計上しています。`,'tax');
  }else if(s.fam==='loan'){
   if(payV>EPS)push('高','借入金の返済',`借入金を ${yen(payV)} 返済しています（${jcount(cashOut)}件）。`,'loan');
   if(cashIn.length)push('高','新規の借入',`新たに ${yen(sum(cashIn,e=>e.amount))} を借り入れています。`,'loan');
  }else if(s.fam==='fixedAsset'){
   if(incV>EPS)push('中','資産の取得',`当月 ${yen(incV)} の資産を取得しています（${entryText(largest(inc))}）。`,'asset');
   if(dec.some(e=>(e.counter||[]).some(a=>/減価償却/.test(a))))push('中','減価償却','減価償却費の計上で帳簿価額が減っています。','asset');
  }else if(s.fam==='ownerDraw'||s.fam==='ownerContribution'){
   if(incV>EPS){const T2=median([...c.loaded].filter(m=>m!==ex.month).map(m=>sum(s.entries.filter(e=>e.month===m&&e.amount>0),e=>e.amount)).filter(v=>v>EPS));if(T2&&incV>T2*1.5&&incV-T2>=th)push('中','通常月より多い',`当月の${s.account}の増加 ${yen(incV)} は、通常月（約${yen(T2)}）の約${(incV/T2).toFixed(1)}倍です。`,'level');}
  }
 }
 // 取引先別の期首推定（ReviewPartyOpening）から、残高に残っている古い未回収・未払を補足する
 // 残高・経過は推定の基準月（当期の仕訳を連続して読めた最後の月）時点の値なので、その月の説明にだけ出す
 if(s.type==='monthlyBS'&&!ex.scoped){const po=c.model.partyOpening,k=v=>clean(v).replace(/[\s　]/g,''),a=po?.accounts?.find(x=>k(x.account)===k(s.account));if(a&&a.through===ex.month)for(const x of (po?.alerts||[]).filter(x=>k(x.account)===k(s.account)).slice(0,2))push('低',`参考：${x.label}の${x.kind==='receipt'?'未回収':'未払'}が残っている可能性`,x.text.replace(/^[^／]*／/,'')+'（過去の仕訳からの推定。「取引先別の残高と回収・支払の状況」を参照）','party');}
 if(Number.isFinite(ex.unexplained)&&Math.abs(ex.unexplained)>=1)push('低','仕訳で説明できない差',`帳票の${s.type==='monthlyPL'?'前月差':'残高の増減'}のうち ${signed(ex.unexplained)} は、読み込んだ仕訳では説明できません。仕訳帳の読込範囲（全件・期間外）、帳票と仕訳帳の科目名、税込／税抜の設定を確認してください。`,'data');
}

// ---- 変動の説明
function explain(session,result,type,account,month,opt={}){
 const c=context(session,result);if(!c||!month)return null;
 const scopeDim=Object.hasOwn(DIMS,opt.dim)?opt.dim:null,scoped=scopeDim!==null&&typeof opt.tag==='string';
 const id=[type,account,month,scoped?scopeDim:'',scoped?opt.tag:'\u0000'].join('\u0001');if(c.memo.has(id))return c.memo.get(id);
 const s=series(c,type,account),p=prevMonth(month);
 const scopeEntries=scoped?(tags(c,type,account,scopeDim).map.get(opt.tag)?.entries||[]):s.entries;
 let cur,prev,delta,ledgerDelta;
 if(scoped){const f=m=>ledgerAvailable(c,m)?sum(scopeEntries.filter(e=>e.month===m),e=>e.amount):null;cur=f(month);prev=f(p);
  delta=type==='monthlyPL'?(Number.isFinite(cur)&&Number.isFinite(prev)?cur-prev:null):cur;ledgerDelta=delta;}
 else{cur=valueAt(c,s,month);prev=s.flowOnly?ledgerAt(c,s,p):valueAt(c,s,p);delta=deltaAt(c,s,month);ledgerDelta=ledgerDeltaAt(c,s,month);}
 const unexplained=!scoped&&Number.isFinite(delta)&&Number.isFinite(ledgerDelta)&&Math.abs(delta-ledgerDelta)>=1?delta-ledgerDelta:null;
 const dims={};
 const groupsOf=d=>scoped?[...indexGroups(scopeEntries,d).values()]:[...tags(c,type,account,d).map.values()];
 for(const d of Object.keys(DIMS)){if(scoped&&d===scopeDim)continue;dims[d]=driversOf(c,s,month,groupsOf(d));}
 const counters=driversOf(c,s,month,groupsOf('counter')),descs=driversOf(c,s,month,groupsOf('desc'));
 const bestDim=pickDim(dims),useDesc=!bestDim&&descs.length&&descs.some(d=>d.key)&&descs.length<=Math.max(3,scopeEntries.filter(e=>e.month===month).length*0.8);
 const dir=Math.sign(Number.isFinite(ledgerDelta)&&Math.abs(ledgerDelta)>EPS?ledgerDelta:delta||0),aligned=d=>dir!==0&&Math.sign(d.diff)===dir?0:1;
 const drivers=(bestDim?dims[bestDim]:useDesc?descs:counters).slice().sort((a,b)=>aligned(a)-aligned(b)||Math.abs(b.diff)-Math.abs(a.diff)).slice(0,5);
 const curEntries=scopeEntries.filter(e=>e.month===month),prevEntries=scopeEntries.filter(e=>e.month===p);
 const ex={type,account,month,prevMonth:p,scoped,dim:scopeDim,tag:scoped?opt.tag:null,tagLabel:scoped?(opt.tag||'未選択'):null,
  cur,prev,delta,ledgerDelta,unexplained,reported:s.reported,flowOnly:s.flowOnly,role:s.role,family:s.fam,
  dims,counters,bestDim,drivers,curEntries,prevEntries,facts:[],inferences:[]};
 const seen=new Set(),push=(level,short,text,kind,about)=>{const k=kind+'|'+short;if(seen.has(k)||!text)return;seen.add(k);ex.inferences.push({level,short,text,kind,...(about?{about}:{})});};
 // 事実
 const unit=s.type==='monthlyPL'?'':'末';
 if(scoped)ex.facts.push(type==='monthlyPL'?`${NOUN[scopeDim]}「${ex.tagLabel}」：${ml(p)} ${yen(prev)} → ${ml(month)} ${yen(cur)}（${signed(delta)}）`:`${NOUN[scopeDim]}「${ex.tagLabel}」の当月の増減：${signed(cur)}（前月の増減 ${signed(prev)}）`);
 else if(s.flowOnly)ex.facts.push(`${ml(month)}の増減 ${signed(delta)}（月次BSが未読込のため、仕訳から集計した増減です）`);
 else ex.facts.push(`${ml(p)}${unit} ${yen(prev)} → ${ml(month)}${unit} ${yen(cur)}（${signed(delta)}）${s.reported||type==='monthlyBS'?'':'　※仕訳からの参考集計'}`);
 if(scoped&&type==='monthlyBS'){
  const tr=tagRows(session,result,type,account,scopeDim,'balance'),r=tr?.rows.find(r=>r.key===opt.tag);
  if(r?.reported){ex.facts.push(`BSの取引先内訳：期首・表示開始前月末 ${yen(r.opening)} ／ ${ml(month)}末 ${yen(r.values[month])}${r.valuesBasis?.[month]==='rollforward'?'（確認できた残高＋連続する読込仕訳の増減で計算）':'（帳票数値）'}。当月の増減と月末残高を区別します。`);
   if(r.openingConflict)ex.facts.push('前期末と当期首の取引先別残高に差があり、期首からの計算を保留しています。');
   if(!Number.isFinite(r.opening))ex.facts.push('この取引先の期首・前月末は未読込または重複等で未確定です。');}
  else ex.facts.push('この内訳には確定した期首残高がありません。当期の増減と月末残高を区別してください。');
  if(!ledgerAvailable(c,month))ex.facts.push('この月は当期仕訳が未読込または条件不足です。内訳の残高・入金がないとは判定できません。');
 }
 if(type==='monthlyBS'&&ledgerAvailable(c,month)){const inc=sum(curEntries,e=>e.amount>0?e.amount:0),dec=-sum(curEntries,e=>e.amount<0?e.amount:0);ex.facts.push(`読込仕訳での当月増加 ${yen(inc)}（${jcount(curEntries.filter(e=>e.amount>0))}件）／減少 ${yen(dec)}（${jcount(curEntries.filter(e=>e.amount<0))}件）`);}
 const share=d=>Number.isFinite(ledgerDelta)&&Math.abs(ledgerDelta)>EPS&&Math.sign(d.diff)===Math.sign(ledgerDelta)&&Math.abs(d.diff)<=Math.abs(ledgerDelta)+EPS?`、変動の${Math.min(999,Math.round(Math.abs(d.diff/ledgerDelta)*100))}%`:'';
 const dl=d=>type==='monthlyPL'?`${d.label}：${ml(p)} ${yen(d.prev)}（${d.prevCount}件）→ ${ml(month)} ${yen(d.cur)}（${d.curCount}件）　${signed(d.diff)}${share(d)}`:`${d.label}：増加 ${yen(d.plus)}・減少 ${yen(d.minus)}（${d.curCount}件）　純額 ${signed(d.diff)}${share(d)}`;
 if(drivers.length)ex.facts.push(`${bestDim?NOUN[bestDim]+'別':useDesc?'摘要別':'相手科目別'}の主な内訳`,...drivers.slice(0,3).map(d=>'・'+dl(d)));
 const cps=counterSummary(curEntries).slice(0,3);if(cps.length&&bestDim)ex.facts.push('相手科目：'+cps.map(x=>`${x.account}${x.compound?'（複合仕訳の候補・科目別金額は未配分）':''} ${signed(x.amount)}（${x.count}件）`).join('、'));
 const big=largest(curEntries);if(big)ex.facts.push('当月で最大の取引：'+entryText(big));
 if(Number.isFinite(unexplained))ex.facts.push(`帳票の増減と仕訳の集計の差：${signed(unexplained)}`);
 // 推測：主な内訳ごと → 科目全体。確からしさ（高・中・低）→ 科目固有の説明 → 一般的なパターンの順に並べる。
 const base=Number.isFinite(ledgerDelta)?Math.abs(ledgerDelta):Math.abs(delta||0),th=threshold(c);
 const lead=drivers.filter((d,i)=>(Math.abs(d.diff)>EPS||d.curCount)&&(i===0||Math.abs(d.diff)>=Math.max(th*0.3,base*0.15))).slice(0,3);
 const evidenceAvailable=ledgerAvailable(c,month)&&s.role!=='unknown';
 if(evidenceAvailable){
  for(const d of lead)inferDriver(c,s,ex,d,push);
  if(bestDim&&bestDim!=='party'&&dims.party?.length)for(const d of dims.party.slice(0,1))if(!d.missing&&Math.abs(d.diff)>=th*0.3)inferDriver(c,s,ex,d,push);
  if(!scoped)inferAccount(c,s,ex,push);
 }else{
  ex.facts.push(s.role==='unknown'?'科目の通常方向が未確認のため、増減の原因判定を保留しています。':'この月の仕訳が未読込または集計不可のため、0円・計上なし・入金なしとは扱いません。');
  push('低','原因分析は資料確認待ち','帳票の金額は表示しています。対象月の仕訳と科目分類を確認してから、取引による変動の分析を行います。','data');
 }
 if(!ex.inferences.length&&lead.length){const d=lead[0];push('低',`${d.label}の${d.diff>=0?'増加':'減少'}`,`${d.dim==='counter'?'相手科目「'+d.label+'」の取引':d.label}の${type==='monthlyPL'?'計上額':'増減'}が${signed(d.diff)}で、変動の主な要因です。仕訳の摘要・証憑で内容を確認してください。`,'driver');}
 if(!curEntries.length&&!prevEntries.length&&!ex.inferences.length)push('低','当月・前月とも仕訳なし','当月・前月ともこの範囲の仕訳はありません。','data');
 const order={'高':0,'中':1,'低':2},generic=new Set(['level','new','count','price','big','rebound','data','note','driver','advance','campaign']);
 ex.inferences=ex.inferences.map((x,i)=>({...x,i})).sort((a,b)=>order[a.level]-order[b.level]||generic.has(a.kind)-generic.has(b.kind)||a.i-b.i).map(({i,...x})=>x);
 const top=drivers.find(d=>Math.abs(d.diff)>EPS);
 const payOnly=top&&top.missing&&top.curEntries.length&&top.curEntries.every(e=>e.amount<0&&(e.counter||[]).some(a=>isCash(c,a)));
 ex.headline=top?`${top.dim==='counter'?'相手科目 ':''}${payOnly&&['card','payable'].includes(s.fam)?(s.fam==='card'?'口座引落し':'支払')+'（'+NOUN[top.dim]+'未選択）':top.label} ${signed(top.diff)}`:'';
 const acctFirst=['cash','card','payable','receivable','taxPayable','withholding','loan'].includes(s.fam);
 const pick=(acctFirst&&ex.inferences.find(x=>!x.about&&x.level!=='低'&&!['flow','data','note'].includes(x.kind)))||(top&&ex.inferences.find(x=>x.about===top.label))||(acctFirst&&ex.inferences.find(x=>x.kind==='flow'))||ex.inferences.find(x=>!x.about&&x.level!=='低')||(top?{level:'低',short:`${top.dim==='counter'?'相手科目「'+top.label+'」':top.label}の${top.diff>=0?'増加':'減少'}`,kind:'driver'}:ex.inferences[0]||null);
 ex.reasonItem=pick;ex.reason=pick?.short||'';
 ex.summary=[Number.isFinite(delta)?signed(delta):'',ex.headline?'主因：'+ex.headline:'',ex.reason].filter(Boolean).join('　');
 c.memo.set(id,ex);return ex;
}

// ---- 全科目から大きな変動を拾う
// 前月から「いつもと違う」動きか：PLは金額の変化率、BSは残高の増減がふだんの月の増減と違うか（毎月同じように増える科目は除く）
function notableAt(c,s,m){
 const th=threshold(c),d=deltaAt(c,s,m);if(!Number.isFinite(d)||Math.abs(d)<th)return null;
 const large=c.cfg.large||100000;let rel;
 if(s.type==='monthlyPL'){const base=Math.abs(valueAt(c,s,prevMonth(m))||0);rel=base>EPS?Math.abs(d)/base:3;if(rel<0.2&&Math.abs(d)<large)return null;}
 else{
  if(!s.usualMove){const ds=c.months.map(x=>deltaAt(c,s,x)).filter(Number.isFinite);s.usualMove=new Map(c.months.map(x=>[x,median(c.months.filter(y=>y!==x).map(y=>deltaAt(c,s,y)).filter(Number.isFinite))]));s.usualMove.set('*',median(ds));}
  const usual=s.usualMove.get(m)??0,gap=Math.abs(d-(usual||0));if(gap<th)return null;
  const base=Math.abs(s.flowOnly?median(c.months.map(x=>Math.abs(ledgerAt(c,s,x)||0))):valueAt(c,s,prevMonth(m))||0);rel=base>EPS?gap/base:3;
  if(!s.flowOnly&&rel<0.1&&gap<large)return null;
 }
 return {delta:d,score:Math.abs(d)/th*(1+Math.min(rel,3))*(s.fam==='cash'?0.6:1)};
}
function isHot(session,result,type,account,month){const c=context(session,result);if(!c)return false;return !!notableAt(c,series(c,type,account),month);}
function notable(session,result,opt={}){
 const c=context(session,result);if(!c)return [];
 const out=[];
 for(const type of ['monthlyPL','monthlyBS']){
  const groups=type==='monthlyPL'?c.model.pl:(c.model.bs.length?c.model.bs:ledgerBS(c));
  for(const g of groups){
   if(g.computed||['summary','unknown'].includes(g.role))continue;
   const s=series(c,type,g.account);
   for(const m of c.months){if(opt.month&&m!==opt.month)continue;const n=notableAt(c,s,m);if(n)out.push({type,account:g.account,month:m,...n});}
  }
 }
 return out.sort((a,b)=>b.score-a.score).slice(0,opt.limit||40);
}
function monthReasons(session,result,type,account){
 const c=context(session,result);if(!c)return [];
 const s=series(c,type,account),th=threshold(c);
 return c.months.map(m=>{const d=deltaAt(c,s,m);if(!Number.isFinite(d)||Math.abs(d)<EPS)return null;const ex=explain(session,result,type,account,m);return {month:m,delta:d,notable:!!notableAt(c,s,m),ex};}).filter(Boolean);
}
// 売掛金の取引先期首を前期仕訳から推計。同日は借貸を相殺し、CSV行順を決済順と扱わない。
// 前期開始前の債権が前期中に回収されたという仮定。BSとの差を特定の取引先へ割り当てない。
// 取引先別の期首の参考推計（売掛金・未収入金・買掛金・未払金・未払費用）。計算は ReviewPartyOpening が行う。
// 取引先の表示名ごとに推定期首を返す。BSの期首との差は unallocated（未配賦）として別行に出す。
function estimatedReceivableOpening(c,s){
 if(Object.hasOwn(s,'estimatedOpening'))return s.estimatedOpening;
 const po=s.type==='monthlyBS'&&!s.flowOnly&&!s.g?.approximate?root.ReviewPartyOpening?.openingValues(c.model,s.account):null;
 if(!po)return s.estimatedOpening=null;
 // 空白の違うタグ（「ブルー スカイ」と「ブルースカイ」）は同じ取引先：期首と付け替えは最初のタグだけに置き、二重に数えない
 const values=new Map(),adjust=new Map(),used=new Set(),k=v=>clean(v).replace(/[\s　]/g,'');
 for(const t of tags(c,s.type,s.account,'party').map.keys()){if(used.has(k(t))){values.set(t,0);continue;}values.set(t,po.byKey(t));const a=po.adjustByKey?.(t);if(a)adjust.set(t,a);used.add(k(t));}
 for(const p of po.account.parties)if(!used.has(p.party)){const t=p.untagged?'':p.label;values.set(t,p.opening||0);const a=po.adjustByKey?.(p.party);if(a)adjust.set(t,a);used.add(p.party);}
 return s.estimatedOpening={values,adjust,start:po.start,end:po.end,allocated:po.allocated,unallocated:po.unallocated,status:po.status,statusText:po.statusText};
}

// BSの内訳期首が無い資料から確定残高を作らない。推計は明示的な参考表示だけ。
function reportedTagRows(c,s,t,dim){
 if(dim!=='party'||!s.g?.tagReports?.length)return null;
 const details=s.g.tagReports.filter(r=>r.tagDimension===dim),list=t.list.slice(),keys=new Set(list.map(g=>g.key));
 const detailKey=r=>['未選択','取引先未選択'].includes(clean(r.tagValue))?'':clean(r.tagValue);
 for(const r of details){const k=detailKey(r);if(!keys.has(k)){keys.add(k);list.push({key:k,label:labelOf(dim,k),missing:!k,count:{}});}}
 const valid=r=>Number.isSafeInteger(r.amount)&&!r.approximate&&r.unit!==1000&&!(r.importErrors>0)&&!(c.session.imports||[]).some(i=>i.type===(r.bridgedFrom==='priorBS'?'priorBS':'monthlyBS')&&i.errors>0);
 const cell=(k,m)=>{const matches=details.filter(r=>detailKey(r)===k&&r.date===m);return {value:matches.length===1&&valid(matches[0])?matches[0].amount:null,present:matches.length>0,rows:matches};};
 const p=prevMonth(c.months[0]),mayDerive=/^(?:売掛金|買掛金|未払金|未払費用)$/.test(key(s.account))&&['asset','liability'].includes(s.role);
 const rows=list.map(tg=>{
  const base=cell(tg.key,p),prior=(c.session.datasets?.priorBS||[]).filter(r=>r.date===p&&key(r.account)===key(s.account)&&r.tagDimension===dim&&detailKey(r)===tg.key);
  const priorValid=r=>Number.isSafeInteger(r.amount)&&!r.approximate&&r.unit===1&&!(r.importErrors>0)&&!(c.session.imports||[]).some(i=>i.type==='priorBS'&&i.errors>0);
  const openingConflict=Number.isSafeInteger(base.value)&&prior.length===1&&priorValid(prior[0])&&base.value!==prior[0].amount;
  const opening=openingConflict?null:base.value,values={},valuesBasis={};let run=opening;
  for(const m of c.months){const source=cell(tg.key,m);
   if(Number.isSafeInteger(source.value)){run=source.value;values[m]=run;valuesBasis[m]='report';}
   else if(!source.present&&mayDerive&&ledgerAvailable(c,m)&&Number.isSafeInteger(run)){const next=run+(tg.flow?.[m]||0);run=Number.isSafeInteger(next)?next:null;values[m]=run;valuesBasis[m]=Number.isSafeInteger(run)?'rollforward':'unknown';}
   else{run=null;values[m]=null;valuesBasis[m]='unknown';}
  }
  return {key:tg.key,label:tg.label,missing:tg.missing,opening,openingConflict,reported:true,derived:Object.values(valuesBasis).includes('rollforward'),values,valuesBasis,count:sum(c.months,m=>tg.count?.[m]||0)};
 });
 const exactSum=values=>{if(!values.length||!values.every(Number.isSafeInteger))return null;const n=Number(values.reduce((a,v)=>a+BigInt(v),0n));return Number.isSafeInteger(n)?n:null;};
 const total=Object.fromEntries(c.months.map(m=>[m,exactSum(rows.map(r=>r.values[m]))]));
 const diff=Object.fromEntries(c.months.map(m=>{const r=valueAt(c,s,m),n=Number.isSafeInteger(total[m])&&Number.isSafeInteger(r)?r-total[m]:null;return [m,Number.isSafeInteger(n)?n:null];}));
 const reportedOpening=exactSum(rows.map(r=>r.opening));
 return {rows,total,diff,hasDiff:Object.values(diff).some(v=>Number.isFinite(v)&&Math.abs(v)>=1),opening:s.opening,reportedOpening,estimate:null,mode:'reported',flowOnly:false,named:rows.some(r=>!r.missing),available:m=>Number.isFinite(total[m]),unknown:false};
}
function tagRows(session,result,type,account,dim,mode='balance'){
 const c=context(session,result);if(!c)return null;
 const s=series(c,type,account),t=tags(c,type,account,dim),months=c.months;
 const bs=type==='monthlyBS'&&!s.flowOnly,cumulative=bs&&['estimate','cumulative'].includes(mode);
 if(bs&&mode==='balance'){const reported=reportedTagRows(c,s,t,dim);if(reported)return reported;}
 const estimate=bs&&mode==='estimate'&&dim==='party'?estimatedReceivableOpening(c,s):null;
 const unknown=bs&&(mode==='balance'||mode==='estimate'&&!estimate)||s.role==='unknown';
 const list=t.list.slice();if(estimate)for(const [k] of estimate.values)if(!list.some(g=>g.key===k))list.push(t.map.get(k)||{key:k,label:labelOf(dim,k),missing:!k,flow:{},count:{}});
 const coverage=new Map();let continuous=true;
 for(const m of months){const covered=ledgerAvailable(c,m);continuous&&=covered;coverage.set(m,cumulative?continuous:covered);}
 const available=m=>!!coverage.get(m);
 // 推計では、未選択の入金・支払を金額一致で取引先に当てた分（取引先別の残高の欄と同じ付け替え）も月の増減に入れる
 const vals=tg=>{let run=estimate?.values.get(tg.key)||0;const adj=estimate?.adjust?.get(tg.key)||{};return Object.fromEntries(months.map(m=>{const v=(tg.flow[m]||0)+(adj[m]||0);run+=v;return [m,!available(m)||unknown?null:cumulative?run:v];}));};
 const rows=list.map(tg=>({key:tg.key,label:tg.label,missing:tg.missing,opening:estimate?(estimate.values.get(tg.key)||0):null,estimated:!!estimate,values:vals(tg),count:sum(months,m=>tg.count[m]||0)}));
 const total=Object.fromEntries(months.map(m=>[m,!available(m)||unknown?null:sum(rows,r=>r.values[m])]));
 const report=Object.fromEntries(months.map(m=>[m,valueAt(c,s,m)]));
 const opening=bs&&mode!=='flow'?(estimate?estimate.unallocated:s.opening):null;
 const diff=Object.fromEntries(months.map(m=>{const r=report[m];if(!Number.isFinite(r)||!Number.isFinite(total[m])||cumulative&&!Number.isFinite(opening))return [m,null];const v=r-total[m]-(cumulative?opening:0);return [m,bs&&mode==='flow'?(Number.isFinite(deltaAt(c,s,m))?deltaAt(c,s,m)-total[m]:null):v];}));
 return {rows,total,opening,estimate,diff,hasDiff:Object.values(diff).some(v=>Number.isFinite(v)&&Math.abs(v)>=1),named:rows.some(r=>!r.missing),flowOnly:s.flowOnly,mode:unknown?'unknown':bs?(estimate?'estimated':mode==='cumulative'?'cumulative':'flow'):'flow',available,unknown};
}

// ---- 表示（説明パネル・確認キュー）
const LEVEL={'高':'ok','中':'warn','低':''};
function html(ex,opt={}){
 if(!ex)return '';
 const head=opt.compact?'':`<div class="vx-numbers">${ex.scoped?'':`<div><span>${ml(ex.prevMonth)}${ex.type==='monthlyPL'?'':'末'}</span><strong>${ex.flowOnly?signed(ex.prev):yen(ex.prev)}</strong></div><div><span>${ml(ex.month)}${ex.type==='monthlyPL'?'':'末'}</span><strong>${ex.flowOnly?signed(ex.cur):yen(ex.cur)}</strong></div>`}<div class="vx-delta ${ex.delta>0?'up':ex.delta<0?'down':''}"><span>${ex.type==='monthlyPL'||ex.scoped&&ex.type==='monthlyPL'?'前月差':'当月の増減'}</span><strong>${signed(ex.delta)}</strong></div></div>`;
 const facts=`<h4>取引から分かること</h4><ul class="vx-facts">${ex.facts.map(f=>`<li${/^・/.test(f)?' class="vx-sub"':''}>${esc(f.replace(/^・/,''))}</li>`).join('')}</ul>`;
 const inf=`<h4>理由の推測</h4>${ex.inferences.length?`<ul class="vx-infer">${ex.inferences.slice(0,opt.compact?3:8).map(x=>`<li><span class="badge ${LEVEL[x.level]}" title="推測の確からしさ">${x.level}</span><div><strong>${esc(x.short)}</strong><p>${esc(x.text)}</p></div></li>`).join('')}</ul>`:'<p class="small">取引から理由を推測できる手がかりがありません。</p>'}`;
 return `<section class="vx-explain${opt.compact?' compact':''}">${head}${facts}${inf}<p class="small vx-scope">推測は仕訳の科目・取引先・品目・摘要・相手科目・前年同月から作った候補です。実際の理由は証憑・通帳・お客様への確認で確かめてください。</p></section>`;
}
function text(ex){
 if(!ex)return '';
 return `【${ex.month} ${ex.account}${ex.scoped?'／'+NOUN[ex.dim]+'「'+ex.tagLabel+'」':''}の変動分析（仕訳から）】\n${ex.facts.join('\n')}\n理由の推測：\n${ex.inferences.slice(0,5).map(x=>`・[${x.level}] ${x.short}：${x.text}`).join('\n')||'・手がかりなし'}\n`;
}
function forFinding(f,session,result){
 if(!f?.monthlyCheck||!f.account||!/前月から大きく変動/.test(f.title||'')||!result?.financial)return null;
 const type=/月末残高/.test(f.title)?'monthlyBS':'monthlyPL',month=f.months?.at(-1);
 const c=context(session,result);if(!c||!month||!groupOf(c,type,f.account))return null;
 return explain(session,result,type,f.account,month);
}
function findingHTML(f,session,result){const ex=forFinding(f,session,result);return ex?`<div class="teachsection"><h3>仕訳から見た変動の理由</h3>${html(ex,{compact:false})}</div>`:'';}
function findingText(f,session,result){const ex=forFinding(f,session,result);return ex?'\n'+text(ex):'';}
function promptText(ex,session){
 if(!ex)return '';
 const rows=ex.curEntries.slice().sort((a,b)=>Math.abs(b.amount)-Math.abs(a.amount)).slice(0,40).map(e=>`${e.row.date}\t${e.side==='debit'?'借方':'貸方'}\t${fmt(e.raw)}\t相手:${(e.counter||[]).join('・')}\t取引先:${tag(e.row,e.side,'party')||'未選択'}\t品目:${tag(e.row,e.side,'item')||'未選択'}\t部門:${tag(e.row,e.side,'department')||'未選択'}\t摘要:${clean(e.row.description)}`);
 const prevRows=ex.prevEntries.slice().sort((a,b)=>Math.abs(b.amount)-Math.abs(a.amount)).slice(0,20).map(e=>`${e.row.date}\t${fmt(e.amount)}\t取引先:${tag(e.row,e.side,'party')||'未選択'}\t品目:${tag(e.row,e.side,'item')||'未選択'}\t摘要:${clean(e.row.description)}`);
 return `あなたは会計事務所の記帳チェック担当です。次の科目が${ml(ex.month)}にこれだけ変動した理由を、仕訳を根拠に説明してください。断定できない点は「推測」と明記し、お客様に確認すべき質問も挙げてください。\n\n会社：${session?.project?.name||''}（${session?.project?.type==='corp'?'法人':'個人事業'}）\n科目：${ex.account}${ex.scoped?'／'+NOUN[ex.dim]+'「'+ex.tagLabel+'」':''}\n${ex.facts.join('\n')}\n\nこのツールの推測：\n${ex.inferences.map(x=>`・${x.short}：${x.text}`).join('\n')||'なし'}\n\n当月の仕訳（金額の大きい順・最大40件）：\n日付\t借貸\t金額\t相手科目\t取引先\t品目\t部門\t摘要\n${rows.join('\n')||'なし'}\n\n前月の仕訳（比較用・最大20件）：\n${prevRows.join('\n')||'なし'}\n`;
}
const V={DIMS,NOUN,isHot,tag,looksPerson,family,context,series,valueAt,deltaAt,tags,tagRows,explain,notable,monthReasons,ledgerBS,threshold,html,text,findingHTML,findingText,promptText,signed,yen,fmt,ml,yml};
root.ReviewVariance=V;if(typeof module!=='undefined')module.exports=V;
})(typeof window!=='undefined'?window:globalThis);

(function(root){
'use strict';
// 月次PL・BS画面。v3.0の帳票形式・推移グラフ・売掛金・照合はそのまま残し、
// 帳票形式を freee の月次推移と同じ階層（▶科目 → 取引先別・品目別・部門別 → 未選択・各タグ）にした。
// 金額を押すと、右側のパネルで「なぜこの月にこれだけ変動したか」を仕訳から説明する（ReviewVariance）。
const F=root.ReviewFinancial,E=root.ReviewEngine,D=root.ReviewDetails,V=root.ReviewVariance;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const amount=n=>Number.isFinite(n)?new Intl.NumberFormat('ja-JP').format(n):'—';
function chart(values,months){
 const ns=months.map(m=>values[m]),max=Math.max(...ns.filter(Number.isFinite).map(Math.abs),1),width=132,step=width/Math.max(months.length,1);
 return `<svg class="monthly-spark" viewBox="0 0 136 48" role="img" aria-label="月次金額の正負と推移"><path d="M2 24H134" class="spark-axis"/>${ns.map((n,i)=>{if(!Number.isFinite(n))return '';const h=Math.max(Math.abs(n)/max*20,n===0?0:1);return `<rect x="${2+i*step+1}" y="${n>=0?24-h:24}" width="${Math.max(step-3,1)}" height="${n===0?1:h}" rx="1.5" class="${n<0?'spark-negative':'spark-positive'}"/>`;}).join('')}</svg>`;
}
function classification(g,type,cfg){const allowed=type==='monthlyPL'?['expense','income','summary','unknown']:['asset','cash','liability','equity','contra','summary','unknown'];return `<select class="monthly-role" aria-label="${esc(g.account)}の分類" data-financial-role="${esc(type+':'+g.account)}">${allowed.map(k=>`<option value="${k}" ${g.role===k?'selected':''}>${F.roles[k]}</option>`).join('')}</select>`;}
// ---- 月次推移（帳票形式）
const stmtView={monthlyPL:'statement',monthlyBS:'statement'};let lastRender=null;
const keyName=s=>String(s??'').normalize('NFKC').replace(/\s+/g,'');
const tri=n=>Number.isFinite(n)?(n<0?'△':'')+new Intl.NumberFormat('ja-JP').format(Math.abs(Math.round(n))+0):'—';
const MAJOR={monthlyPL:/^(売上総利益|売上総損益|営業利益|営業損益|経常利益|経常損益|税引前.*|税引後.*|当期純.*|差引損益計算|差引損益|所得金額|青色申告特別控除前.*)$/,monthlyBS:/^(流動資産合計|固定資産合計|繰延資産合計|事業主貸合計|資産(の部)?合計|流動負債合計|固定負債合計|事業主借合計|負債(の部)?合計|純資産(の部)?合計|資本合計|負債(及び|・)?純資産(の部)?合計)$/};
function level(g,type){const k=keyName(g.account);if(MAJOR[type].test(k))return 'major';if(g.role==='summary'&&!(type==='monthlyBS'&&/^差引損益/.test(k)))return 'sub';return 'item';}
const PL_ORDER=['売上','雑収入','受取利息','仕入','租税公課','荷造運賃','水道光熱','旅費交通','通信','広告宣伝','交際','保険','修繕','消耗品','減価償却','福利厚生','給料','給与','賃金','賞与','法定福利','外注','支払利息','利子割引','地代家賃','家賃','貸倒'];
function orderOf(a){const k=keyName(a);if(/^雑費|^雑損/.test(k))return 900;const i=PL_ORDER.findIndex(x=>k.includes(x));return i<0?500:i;}
function statementRows(model,type){
 const groups=type==='monthlyPL'?model.pl:model.bs;
 if(type!=='monthlyPL'||model.plReference.length)return groups.map(g=>({g,level:level(g,type)}));
 // 仕訳からの参考集計：収益→費用の順に並べ、参考の合計行を付ける（合計は表示だけ。チェックには使わない）
 const months=model.months,by=r=>groups.map((g,i)=>({g,i})).filter(x=>x.g.role===r).sort((a,b)=>orderOf(a.g.account)-orderOf(b.g.account)||a.i-b.i).map(x=>x.g);
 const sum=(list,label,cls)=>{const values=Object.fromEntries(months.map(m=>[m,list.every(g=>Number.isFinite(g.values[m]))?list.reduce((n,g)=>n+g.values[m],0):null]));return {g:{account:label,values,periodTotal:months.every(m=>Number.isFinite(values[m]))?months.reduce((n,m)=>n+values[m],0):null,computed:true},level:cls};};
 const inc=by('income'),exp=by('expense'),out=[];
 out.push(...inc.map(g=>({g,level:'item'})),sum(inc,'収益計（参考）','sub'),...exp.map(g=>({g,level:'item'})),sum(exp,'経費計（参考）','sub'));
 const diff=sum([],'差引損益（参考）','major');for(const m of months){const a=out.find(x=>x.g.account==='収益計（参考）').g.values[m],b=out.find(x=>x.g.account==='経費計（参考）').g.values[m];diff.g.values[m]=Number.isFinite(a)&&Number.isFinite(b)?a-b:null;}
 diff.g.periodTotal=months.every(m=>Number.isFinite(diff.g.values[m]))?months.reduce((n,m)=>n+diff.g.values[m],0):null;out.push(diff);
 return out;
}
function taxBasis(session){const c={};for(const r of session?.datasets?.current||[]){const v=(r.sourceFields||[]).find(x=>/消費税経理処理方法/.test(x.header))?.value;if(v)c[v]=(c[v]||0)+1;}const top=Object.entries(c).sort((a,b)=>b[1]-a[1])[0]?.[0]||'';return /税抜/.test(top)?'【税抜】':/税込/.test(top)?'【税込】':'';}
function periodText(months){if(!months.length)return '';const [y1,m1]=months[0].split('-'),[y2,m2]=months.at(-1).split('-'),last=new Date(Date.UTC(+y2,+m2,0)).getUTCDate();return `${y1}年${m1}月01日〜${y2}年${m2}月${String(last).padStart(2,'0')}日`;}

// ---- 階層表示の状態（会社のセッションごと。画面を開いている間だけ保持）
const states=new WeakMap();
function uiState(session){let s=states.get(session);if(!s){s={open:new Set(),dims:new Set(),reasons:new Set(),more:new Set(),bsMode:'balance',focusMonth:null,cardsAll:false};states.set(session,s);}return s;}
// 押せるセルの参照（属性に科目名を直接入れない）
const refs={monthlyPL:[],monthlyBS:[],cards:[],alerts:[]};
function ref(kind,obj){refs[kind].push(obj);return kind+':'+(refs[kind].length-1);}
function getRef(v){const i=String(v).lastIndexOf(':'),kind=String(v).slice(0,i);return refs[kind]?.[+String(v).slice(i+1)]||null;}
const TAG_ICON='<svg class="vt-tagicon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2h6l6 6-6 6-6-6z"/><circle cx="5.5" cy="5.5" r="1.3"/></svg>';
const DIM_HELP={party:'取引先',item:'品目',department:'部門'};
function cellButton(kind,r,val,cls='',title=''){return `<button class="monthly-value stmt-num ${cls}" data-vt-ref="${ref(kind,r)}"${title?` title="${esc(title)}"`:''} aria-label="${esc(r.account+(r.dim?' '+DIM_HELP[r.dim]+' '+(r.tag||'未選択'):'')+' '+r.month+' の変動理由と仕訳を見る')}">${tri(val)}</button>`;}
function statementBody(model,type,session,result){
 const st=uiState(session),ctx=V?.context(session,result),ledgerOnly=type==='monthlyBS'&&!model.bs.length;refs[type]=[];
 const months=model.months,rows=ledgerOnly?(ctx?V.ledgerBS(ctx):[]).map(g=>({g,level:'item'})):statementRows(model,type),prev=F.prevMonth(months[0]);
 const groups=type==='monthlyPL'?model.pl:model.bs,openingFlag=groups.some(g=>g.rows?.some(r=>r.opening&&r.date===prev));
 const rawOpen=g=>{const r=(g.rows||[]).find(r=>r.openingRaw!==undefined&&String(r.openingRaw).trim()!=='');return r?E.number(r.openingRaw)*(r.unit||1):null;};
 const hasRaw=type==='monthlyBS'&&!openingFlag&&groups.some(g=>Number.isFinite(rawOpen(g)));
 const showOpening=type==='monthlyBS'&&!ledgerOnly&&(openingFlag||hasRaw||groups.some(g=>Number.isFinite(g.values[prev])));
 const openVal=g=>g.computed?null:openingFlag?g.values[prev]:hasRaw?rawOpen(g):g.values[prev];
 const cols=1+(showOpening?1:0)+months.length+(type==='monthlyPL'?1:0),blank=n=>'<td class="vt-blank"></td>'.repeat(n);
 const head=`<tr><th class="stmt-acct">勘　定　科　目</th>${showOpening?`<th>${openingFlag||hasRaw?'期　首':'前月末<br><span>'+prev+'</span>'}</th>`:''}${months.map(m=>`<th>${m}</th>`).join('')}${type==='monthlyPL'?'<th class="stmt-total">期 間 累 計</th>':''}</tr>`;
 const accountCells=(g,s)=>months.map(m=>{
  const v=g.values[m],neg=Number.isFinite(v)&&v<0;
  if(g.computed||!s)return `<td class="${neg?'monthly-negative':''}"><span class="stmt-num">${tri(v)}</span></td>`;
  const d=V.deltaAt(ctx,s,m),hot=V.isHot(session,result,type,g.account,m),title=Number.isFinite(d)?`${s.flowOnly?'当月の増減':type==='monthlyPL'?'前月比':'前月末比'} ${V.signed(d)}`:'';
  return `<td class="${neg?'monthly-negative':''}${hot?' vt-hot '+(d>0?'up':'down'):''}">${cellButton(type,{type,account:g.account,month:m,hot},v,'',title)}</td>`;
 }).join('');
 const body=rows.map(({g,level})=>{
  const can=!!ctx&&!g.computed&&g.role!=='summary',id=type+'|'+g.account,open=can&&st.open.has(id),s=can?V.series(ctx,type,g.account):null,total=type==='monthlyPL'?g.periodTotal:null;
  const label=`<span class="stmt-label${/[A-Za-z0-9()（）・\-]/.test(g.account)||[...g.account].length>9?' plain':''}${[...g.account].length>12?' long':''}">${esc(g.account)}</span>`;
  const acct=can?`<button class="vt-toggle" data-vt-acct="${ref(type,{type,account:g.account})}" aria-expanded="${open}"><span class="vt-tri" aria-hidden="true">${open?'▼':'▶'}</span>${label}</button>`:label;
  let html=`<tr class="stmt-${level}${g.role==='unknown'?' stmt-unknown':''}${open?' vt-open':''}"><th class="stmt-acct" title="${esc(g.account)}"><div class="stmt-acctin">${acct}${g.role==='unknown'?'<span class="stmt-flag" title="科目の分類を確認してください">分類?</span>':''}${g.approximate?'<span class="stmt-flag">概数</span>':''}</div></th>${showOpening?`<td class="stmt-open">${tri(openVal(g))}</td>`:''}${accountCells(g,s)}${type==='monthlyPL'?`<td class="stmt-total ${Number.isFinite(total)&&total<0?'monthly-negative':''}"><span class="stmt-num">${tri(total)}</span></td>`:''}</tr>`;
  if(open)html+=expanded(type,g,s,session,result,st,{months,cols,showOpening,blank});
  return html;
 }).join('');
 const name=session?.project?.name||'',basis=taxBasis(session);
 const modeBar=type==='monthlyBS'&&!ledgerOnly?`<div class="vt-modebar" role="group" aria-label="BSの内訳の表示"><span class="small">内訳の表示</span><button class="btn small" data-vt-bsmode="balance" aria-pressed="${st.bsMode==='balance'}">月末残高</button><button class="btn small" data-vt-bsmode="flow" aria-pressed="${st.bsMode==='flow'}">当月の増減</button></div>`:'';
 return `<div class="stmt"><div class="stmt-head"><div class="stmt-title">月 次 推 移</div><div class="stmt-subtitle">${type==='monthlyPL'?'損 益 計 算 書':ledgerOnly?'貸 借 対 照 表 科 目 の 増 減':'貸 借 対 照 表'}</div><div class="stmt-meta"><div><strong>${esc(name)}</strong><span>${periodText(months)}</span></div><span>${basis}（単位：円）</span></div></div><div class="vt-hint"><span>▶ 科目名を押すと「取引先別・品目別・部門別」の内訳と月ごとの変動理由を開きます。金額を押すと、その月の変動理由と根拠の仕訳を右側に表示します。<span class="vt-hotlegend">色付きの金額</span>は前月から大きく動いた月です。</span>${modeBar}</div>${ledgerOnly?'<div class="notice vt-ledgeronly">月次BSが未読込のため、仕訳帳から集計した<strong>各月の増減</strong>を表示しています（月末残高ではありません）。freeeの月次推移（貸借対照表）CSVを読み込むと月末残高で表示します。</div>':''}<div class="tablewrap stmt-wrap"><table class="stmt-table vt-table"><thead>${head}</thead><tbody>${body}</tbody></table></div></div>`;
}
function expanded(type,g,s,session,result,st,o){
 const id=type+'|'+g.account,months=o.months,out=[];
 for(const dim of Object.keys(V.DIMS)){
  const did=id+'|'+dim,open=st.dims.has(did),tr=V.tagRows(session,result,type,g.account,dim,st.bsMode);
  const n=tr?.rows.length||0,named=tr?.rows.filter(r=>!r.missing).length||0;
  out.push(`<tr class="vt-dim"><th class="stmt-acct"><button class="vt-toggle vt-dimtoggle" data-vt-dim="${ref(type,{type,account:g.account,dim})}" aria-expanded="${open}"><span class="vt-tri" aria-hidden="true">${open?'▼':'▶'}</span><span>${V.DIMS[dim]}</span><span class="vt-count">${named?named+'件':'入力なし'}</span></button></th>${o.blank(o.cols-1)}</tr>`);
  if(!open||!tr)continue;
  const limit=st.more.has(did)?Infinity:30;
  for(const r of tr.rows.slice(0,limit)){
   const total=type==='monthlyPL'?months.reduce((a,m)=>a+(r.values[m]||0),0):null;
   out.push(`<tr class="vt-tag${r.missing?' vt-missing':''}"><th class="stmt-acct" title="${esc(r.label)}"><div class="vt-taglabel">${TAG_ICON}<span>${esc(r.label)}</span></div></th>${o.showOpening?'<td class="stmt-open vt-blank"></td>':''}${months.map(m=>{const v=r.values[m];return `<td class="${v<0?'monthly-negative':''}">${cellButton(type,{type,account:g.account,month:m,dim,tag:r.key},v)}</td>`;}).join('')}${type==='monthlyPL'?`<td class="stmt-total"><span class="stmt-num">${tri(total)}</span></td>`:''}</tr>`);
  }
  if(tr.rows.length>limit)out.push(`<tr class="vt-tag"><th class="stmt-acct" colspan="${o.cols}"><button class="btn small vt-more" data-vt-more="${ref(type,{type,account:g.account,dim})}">残り${tr.rows.length-limit}件の${DIM_HELP[dim]}を表示</button></th></tr>`);
  if(tr.mode==='balance'&&Number.isFinite(tr.opening)&&Math.abs(tr.opening)>=1)out.push(`<tr class="vt-tag vt-note"><th class="stmt-acct" title="仕訳帳には期首残高の内訳がないため、別の行に表示します"><div class="vt-taglabel"><span>期首残高（内訳なし）</span></div></th>${o.showOpening?`<td class="stmt-open">${tri(tr.opening)}</td>`:''}${months.map(()=>`<td><span class="stmt-num">${tri(tr.opening)}</span></td>`).join('')}</tr>`);
  if(tr.hasDiff)out.push(`<tr class="vt-tag vt-note vt-diff"><th class="stmt-acct" title="帳票の金額と、仕訳から集計した内訳の合計の差です"><div class="vt-taglabel"><span>帳票との差額（仕訳で未説明）</span></div></th>${o.showOpening?'<td class="stmt-open vt-blank"></td>':''}${months.map(m=>`<td><span class="stmt-num">${Number.isFinite(tr.diff[m])&&Math.abs(tr.diff[m])>=1?tri(tr.diff[m]):''}</span></td>`).join('')}${type==='monthlyPL'?'<td class="stmt-total vt-blank"></td>':''}</tr>`);
 }
 const rid=id+'|reasons',ropen=!st.reasons.has(rid+'|closed');
 out.push(`<tr class="vt-dim vt-reasonhead"><th class="stmt-acct"><button class="vt-toggle vt-dimtoggle" data-vt-reasons="${ref(type,{type,account:g.account})}" aria-expanded="${ropen}"><span class="vt-tri" aria-hidden="true">${ropen?'▼':'▶'}</span><span>変動の理由（仕訳から推測）</span></button></th>${o.blank(o.cols-1)}</tr>`);
 if(ropen){
  const list=V.monthReasons(session,result,type,g.account);
  out.push(`<tr class="vt-reasons"><td colspan="${o.cols}"><div class="vt-reasonlist">${list.length?list.map(x=>`<button class="vt-reason${x.notable?' hot':''}" data-vt-ref="${ref(type,{type,account:g.account,month:x.month})}"><span class="vt-rm">${esc(V.yml(x.month))}</span><span class="vt-rd ${x.delta>0?'up':'down'}">${esc(V.signed(x.delta))}</span><span class="vt-rt">${x.ex.headline?`<strong>${esc(x.ex.headline)}</strong>`:''}${x.ex.reason?`<span>${esc(x.ex.reason)}</span>`:''}</span><span class="vt-rl">理由と仕訳 →</span></button>`).join(''):'<p class="small">対象期間に前月から変動した月はありません（前月の金額が未読込の月は比較できません）。</p>'}</div></td></tr>`);
 }
 return out.join('');
}
function rolesPanel(model,type,cfg){
 const groups=type==='monthlyPL'?model.pl:model.bs,unknown=groups.filter(g=>g.role==='unknown').length;
 return `<details class="stmt-roles" ${unknown?'open':''}><summary>科目の分類（チェックに使う設定）${unknown?`<span class="badge warn">分類を確認 ${unknown}科目</span>`:''}</summary><div class="stmt-rolegrid">${groups.map(g=>`<label><span>${esc(g.account)}</span>${classification(g,type,cfg)}</label>`).join('')}</div></details>`;
}
function gridBody(model,type,cfg){
 const groups=type==='monthlyPL'?model.pl:model.bs;refs[type]=[];
 return `<div class="tablewrap"><table class="datatable monthly-table"><thead><tr><th>科目・分類</th><th>推移</th>${model.months.map(m=>`<th>${m}</th>`).join('')}<th>${type==='monthlyPL'?'対象期間合計':'対象末月の残高'}</th></tr></thead><tbody>${groups.map(g=>`<tr class="${g.role==='summary'?'monthly-summary':''}"><th><strong>${esc(g.account)}</strong>${g.approximate?'<span class="badge">千円から換算・概数</span>':''}<div>${classification(g,type,cfg)}</div><span class="small">${esc(g.category)}</span></th><td>${chart(g.values,model.months)}</td>${model.months.map(m=>`<td class="${Number.isFinite(g.values[m])&&g.values[m]<0?'monthly-negative':''}">${g.role==='summary'?amount(g.values[m]):`<button class="monthly-value" data-vt-ref="${ref(type,{type,account:g.account,month:m})}" aria-label="${esc(g.account)} ${m} の変動理由と仕訳を見る">${amount(g.values[m])}</button>`}</td>`).join('')}<td class="${(type==='monthlyPL'?g.periodTotal:g.endBalance)<0?'monthly-negative':''}">${amount(type==='monthlyPL'?g.periodTotal:g.endBalance)}</td></tr>`).join('')}</tbody></table></div>`;
}
function matrixTable(model,type,cfg,session,result){
 const groups=type==='monthlyPL'?model.pl:model.bs,title=type==='monthlyPL'?'月次PL':'月次BS',ctx=V&&result?V.context(session,result):null,ledgerOnly=type==='monthlyBS'&&!groups.length&&!!ctx&&V.ledgerBS(ctx).length>0;
 const source=type==='monthlyPL'?(model.plReference.length?'freee帳票の単月金額':'仕訳からの参考集計'):ledgerOnly?'仕訳から集計した各月の増減':'freee帳票の月末残高';
 if(!groups.length&&!ledgerOnly)return `<section class="panel monthly-panel"><div class="panelhead"><h2>${title}</h2><button class="btn small" data-action="import" data-type="${type}">CSV読込</button></div><div class="empty"><h3>${title}を取り込む</h3><p>${type==='monthlyBS'?'各月末残高を基準に、科目の推移と前月末からの増減を確認します。':'freeeの月次推移CSVを使って、各科目のマイナスと前月差を確認します。'}</p></div></section>`;
 lastRender={...(lastRender||{}),model,cfg,session,result};const mode=ledgerOnly?'statement':stmtView[type];
 return `<section class="panel monthly-panel" data-stmt="${type}"><div class="panelhead"><div><h2>${title}</h2><span class="small">${source} ／ 円。—は未読込、△はマイナス。</span></div><div class="stmt-actions">${ledgerOnly?'':`<div class="stmt-toggle" role="group" aria-label="${title}の表示形式"><button class="btn small" data-stmt-view="${type}:statement" aria-pressed="${mode==='statement'}">帳票形式（内訳・理由）</button><button class="btn small" data-stmt-view="${type}:grid" aria-pressed="${mode==='grid'}">推移グラフ</button></div>`}${mode==='statement'?`<button class="btn small" data-vt-expand="${type}:open">すべて開く</button><button class="btn small" data-vt-expand="${type}:close">すべて閉じる</button><button class="btn small" data-stmt-print="${type}">印刷</button>`:''}<button class="btn small" data-action="import" data-type="${type}">CSVを更新</button></div></div>${mode==='statement'?statementBody(model,type,session,result)+(ledgerOnly?'':rolesPanel(model,type,cfg)):gridBody(model,type,cfg)}<div class="review-footer">${type==='monthlyPL'?(model.plReference.length?'合計・利益行は元帳の費用科目と重ねて合計しません。':'freeeの月次PLが未読込のため、仕訳から集計した参考表です。「（参考）」の合計行は表示用で、チェックには使いません。')+'単月の負数は返金・取消・給与控除などの理由を確認します。':ledgerOnly?'期首残高のない仕訳から月末残高は作りません。各月の増減と、その理由の分析に使えます。':'BSの月末残高は月ごとに合算しません。控除科目・純資産の負数は、それだけで誤りと判定しません。BSの取引先別などの内訳は仕訳から集計し、期首残高の内訳は「期首残高（内訳なし）」の行に分けます。'} 内訳は仕訳帳の対象科目と同じ側の取引先・品目・部門で集計し、記載がない仕訳は「未選択」に入れます。</div></section>`;
}

// ---- 主な変動（全科目）：今月どこが動き、なぜ動いたか
function changesPanel(session,result){
 const ctx=V?.context(session,result);if(!ctx)return '';
 const st=uiState(session),months=result.financial.months,sel=months.includes(st.focusMonth)?st.focusMonth:null;refs.cards=[];
 const list=V.notable(session,result,{month:sel,limit:sel?30:40}),shown=st.cardsAll?list:list.slice(0,9);
 const chips=`<div class="vt-chips" role="group" aria-label="対象月"><button class="btn small" data-vt-focus-month="" aria-pressed="${!sel}">全期間</button>${months.map(m=>`<button class="btn small" data-vt-focus-month="${m}" aria-pressed="${sel===m}">${esc(V.ml(m))}</button>`).join('')}</div>`;
 const cards=shown.map(n=>{const ex=V.explain(session,result,n.type,n.account,n.month);return `<button class="vt-card" data-vt-ref="${ref('cards',{type:n.type,account:n.account,month:n.month})}"><span class="vt-cardtop"><span class="badge">${n.type==='monthlyPL'?'PL':'BS'}</span><span class="small">${esc(V.yml(n.month))}</span><span class="vt-rd ${n.delta>0?'up':'down'}">${esc(V.signed(n.delta))}</span></span><strong>${esc(n.account)}</strong>${ex?.headline?`<span class="vt-cardhead">主因：${esc(ex.headline)}</span>`:''}${ex?.reasonItem?`<span class="vt-cardwhy"><span class="badge ${ex.reasonItem.level==='高'?'ok':ex.reasonItem.level==='中'?'warn':''}" title="推測の確からしさ">${ex.reasonItem.level}</span>${esc(ex.reason)}</span>`:''}<span class="vt-cardlink">理由と仕訳を見る →</span></button>`;}).join('');
 return `<section class="panel monthly-panel" id="vtChanges"><div class="panelhead"><div><h2>大きく動いた科目と理由</h2><span class="small">前月差${V.yen(V.threshold(ctx))}以上の動きを、仕訳の取引先・品目・相手科目・摘要から説明します。推測は候補で、事実の確認は証憑・通帳で行います。</span></div></div><div class="panelbody">${chips}${list.length?`<div class="vt-cards">${cards}</div>${list.length>9?`<div class="vt-cardsmore"><button class="btn small" data-vt-cards-all="1">${st.cardsAll?'上位9件だけ表示':'残り'+(list.length-9)+'件も表示'}</button></div>`:''}`:`<p class="small">${sel?V.yml(sel)+'に':''}大きく動いた科目はありません。前月の帳票・仕訳が未読込の月は比較できません。</p>`}</div></section>`;
}

// ---- 右側の分析パネル
let drawer=null;
function drawerEl(){let el=document.getElementById('vtDrawer');if(!el){el=document.createElement('aside');el.id='vtDrawer';el.className='vt-drawer';el.setAttribute('role','dialog');el.setAttribute('aria-modal','false');el.setAttribute('aria-labelledby','vtDrawerTitle');el.hidden=true;document.body.appendChild(el);}return el;}
function openDrawer(r){if(!lastRender?.result||!r)return;drawer={session:lastRender.session,result:lastRender.result,type:r.type,account:r.account,month:r.month,dim:r.dim||null,tag:r.dim?(r.tag??''):null,tab:null,limit:50};renderDrawer(true);}
function closeDrawer(){const el=document.getElementById('vtDrawer');if(el){el.hidden=true;el.innerHTML='';}document.documentElement.classList.remove('vt-drawer-open');const back=drawer?.returnFocus;drawer=null;if(back&&document.contains(back))back.focus();}
function breakdownTable(ex,tab){
 const list=tab==='counter'?ex.counters:ex.dims[tab]||[],bs=ex.type==='monthlyBS';
 if(!list.length)return '<p class="small">この月の内訳はありません。</p>';
 return `<div class="tablewrap"><table class="datatable vt-break"><thead><tr><th>${tab==='counter'?'相手科目':DIM_HELP[tab]}</th>${bs?'<th class="num">増加</th><th class="num">減少</th><th class="num">当月の増減</th>':`<th class="num">${esc(V.ml(ex.prevMonth))}</th><th class="num">${esc(V.ml(ex.month))}</th><th class="num">前月差</th>`}<th class="num">件数</th></tr></thead><tbody>${list.slice(0,40).map(d=>`<tr${d.missing?' class="vt-missing"':''}><td>${esc(d.label)}${d.isNew?' <span class="badge warn">新規</span>':''}</td>${bs?`<td class="num">${V.yen(d.plus)}</td><td class="num">${V.yen(d.minus)}</td>`:`<td class="num">${V.yen(d.prev)}</td><td class="num">${V.yen(d.cur)}</td>`}<td class="num ${d.diff>0?'vt-up':d.diff<0?'vt-down':''}">${esc(V.signed(d.diff))}</td><td class="num">${d.curCount}${bs?'':' / 前月'+d.prevCount}</td></tr>`).join('')}</tbody></table></div>${list.length>40?`<p class="small">上位40件を表示（全${list.length}件）。</p>`:''}`;
}
function evidenceRows(list,limit){
 const tag=(e,dim)=>V.tag(e.row,e.side,dim);
 return list.slice(0,limit).map(e=>`<tr><td>${esc(e.row.date)}<br><span class="small">仕訳 ${esc(e.row.id)}</span></td><td class="num ${e.amount>0?'vt-up':'vt-down'}">${esc(V.signed(e.amount))}<br><span class="small">${e.side==='debit'?'借方':'貸方'} ${V.yen(e.raw)}</span></td><td>${esc((e.counter||[]).join('・')||'—')}</td><td><strong>${esc(tag(e,'party')||'取引先：未選択')}</strong><br><span class="small">品目：${esc(tag(e,'item')||'未選択')}／部門：${esc(tag(e,'department')||'未選択')}</span>${e.row.description?`<p>${esc(e.row.description)}</p>`:''}${D?.evidenceText(e.row)?`<details><summary class="small">タグ・メモ</summary><pre class="evidence">${esc(D.evidenceText(e.row))}</pre></details>`:''}</td></tr>`).join('');
}
function renderDrawer(focus){
 const el=drawerEl(),d=drawer;if(!d)return;
 const ex=V.explain(d.session,d.result,d.type,d.account,d.month,{dim:d.dim,tag:d.tag});if(!ex){closeDrawer();return;}
 const months=d.result.financial.months,i=months.indexOf(d.month);
 const tabs=[...Object.keys(V.DIMS).filter(k=>!(ex.scoped&&k===ex.dim)),'counter'];
 const tab=tabs.includes(d.tab)?d.tab:(ex.bestDim&&tabs.includes(ex.bestDim)?ex.bestDim:tabs.includes('party')?'party':'counter');
 const sorted=ex.curEntries.slice().sort((a,b)=>Math.abs(b.amount)-Math.abs(a.amount)),prevSorted=ex.prevEntries.slice().sort((a,b)=>Math.abs(b.amount)-Math.abs(a.amount));
 const scope=ex.scoped?`${DIM_HELP[ex.dim]}「${esc(ex.tagLabel)}」`:'科目全体';
 el.innerHTML=`<div class="vt-dhead"><div><div class="eyebrow">WHY IT CHANGED</div><h2 id="vtDrawerTitle">${esc(d.account)}<small>${esc(V.yml(d.month))}</small></h2><p class="small">${d.type==='monthlyPL'?'損益計算書':'貸借対照表'} ／ ${scope}${ex.scoped?` <button class="linkbtn" data-vt-scope-all="1">科目全体を見る</button>`:''}</p></div><div class="vt-dnav"><button class="btn small" data-vt-step="-1" ${i<=0?'disabled':''} aria-label="前の月">◀ ${i>0?esc(V.ml(months[i-1])):''}</button><button class="btn small" data-vt-step="1" ${i>=months.length-1?'disabled':''} aria-label="次の月">${i<months.length-1?esc(V.ml(months[i+1])):''} ▶</button><button class="btn small vt-close" data-vt-close="1" aria-label="閉じる">×</button></div></div>
 <div class="vt-dbody">${V.html(ex)}
 <div class="vt-actions"><button class="btn small" data-vt-copy="memo">分析をコピー（メモ用）</button><button class="btn small" data-vt-copy="prompt" title="Claudeなどに貼り付けて、さらに詳しく聞くための文章">AIに相談する文章をコピー</button></div>
 <h3>内訳</h3><div class="vt-tabs" role="tablist">${tabs.map(t=>`<button class="btn small" role="tab" data-vt-tab="${t}" aria-selected="${t===tab}">${t==='counter'?'相手科目別':V.DIMS[t]}</button>`).join('')}</div>${breakdownTable(ex,tab)}
 <h3>${esc(V.ml(d.month))}の仕訳 <span class="small">${ex.curEntries.length}行・金額の大きい順</span></h3>${sorted.length?`<div class="tablewrap"><table class="datatable vt-evidence"><thead><tr><th>日付</th><th class="num">増減</th><th>相手科目</th><th>取引先・品目・部門・摘要</th></tr></thead><tbody>${evidenceRows(sorted,d.limit)}</tbody></table></div>${sorted.length>d.limit?`<button class="btn small" data-vt-more-evidence="1">さらに50行を表示（残り${sorted.length-d.limit}行）</button>`:''}`:'<p class="small">この月の仕訳はありません。計上漏れ・計上月のずれ・仕訳帳の読込範囲を確認してください。</p>'}
 <details class="vt-prev"><summary>${esc(V.ml(ex.prevMonth))}の仕訳（比較用・${ex.prevEntries.length}行）</summary>${prevSorted.length?`<div class="tablewrap"><table class="datatable vt-evidence"><thead><tr><th>日付</th><th class="num">増減</th><th>相手科目</th><th>取引先・品目・部門・摘要</th></tr></thead><tbody>${evidenceRows(prevSorted,50)}</tbody></table></div>`:'<p class="small">前月の仕訳はありません（未読込の場合もあります）。</p>'}</details>
 <p class="small vt-foot">内訳は対象科目と同じ側（借方・貸方）の取引先・品目・部門で集計しています。複合仕訳は仕訳番号で元CSV・freeeの全行も確認してください。</p></div>`;
 el.hidden=false;document.documentElement.classList.add('vt-drawer-open');
 if(focus){d.returnFocus=d.returnFocus||document.activeElement;el.querySelector('.vt-close')?.focus({preventScroll:true});}
 el.scrollTop=focus?0:el.scrollTop;
}
function copyText(text){
 const done=()=>{const t=document.getElementById('toast');if(t){t.textContent='コピーしました';t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1800);}};
 if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(done).catch(()=>fallback());else fallback();
 function fallback(){const ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');done();}catch(e){}ta.remove();}
}
function rerender(type){
 if(!lastRender)return;const sec=document.querySelector(`.monthly-panel[data-stmt="${type}"]`);if(!sec)return;
 const wrap=sec.querySelector('.stmt-wrap'),x=wrap?wrap.scrollLeft:0,t=document.createElement('div');
 t.innerHTML=matrixTable(lastRender.model,type,lastRender.cfg,lastRender.session,lastRender.result);sec.replaceWith(t.firstElementChild);
 const w2=document.querySelector(`.monthly-panel[data-stmt="${type}"] .stmt-wrap`);if(w2)w2.scrollLeft=x;
}
if(typeof document!=='undefined'){
 document.addEventListener('click',e=>{
  const v=e.target.closest?.('[data-stmt-view]');
  if(v&&lastRender){const [type,mode]=v.dataset.stmtView.split(':');if(!stmtView[type]||!['statement','grid'].includes(mode))return;stmtView[type]=mode;rerender(type);return;}
  const p=e.target.closest?.('[data-stmt-print]');
  if(p){const st=p.closest('.monthly-panel')?.querySelector('.stmt');if(!st)return;document.getElementById('stmtPrint')?.remove();const box=document.createElement('div');box.id='stmtPrint';box.innerHTML=st.outerHTML;document.body.appendChild(box);document.documentElement.classList.add('printing-stmt');const done=()=>{document.documentElement.classList.remove('printing-stmt');box.remove();window.removeEventListener('afterprint',done);};window.addEventListener('afterprint',done);window.print();return;}
  if(!lastRender)return;
  const b=e.target.closest?.('button');if(!b)return;const ds=b.dataset,st=uiState(lastRender.session);
  if(ds.vtAcct){const r=getRef(ds.vtAcct);if(!r)return;const id=r.type+'|'+r.account;if(st.open.has(id))st.open.delete(id);else{st.open.add(id);if(![...st.dims].some(x=>x.startsWith(id+'|')))st.dims.add(id+'|party');}rerender(r.type);return;}
  if(ds.vtDim){const r=getRef(ds.vtDim);if(!r)return;const id=r.type+'|'+r.account+'|'+r.dim;if(st.dims.has(id))st.dims.delete(id);else st.dims.add(id);rerender(r.type);return;}
  if(ds.vtReasons){const r=getRef(ds.vtReasons);if(!r)return;const id=r.type+'|'+r.account+'|reasons|closed';if(st.reasons.has(id))st.reasons.delete(id);else st.reasons.add(id);rerender(r.type);return;}
  if(ds.vtMore){const r=getRef(ds.vtMore);if(!r)return;st.more.add(r.type+'|'+r.account+'|'+r.dim);rerender(r.type);return;}
  if(ds.vtBsmode){if(!['balance','flow'].includes(ds.vtBsmode))return;st.bsMode=ds.vtBsmode;rerender('monthlyBS');return;}
  if(ds.vtExpand){const [type,how]=ds.vtExpand.split(':');const groups=type==='monthlyPL'?lastRender.model.pl:(lastRender.model.bs.length?lastRender.model.bs:V.ledgerBS(V.context(lastRender.session,lastRender.result)));for(const g of groups){if(g.computed||g.role==='summary')continue;const id=type+'|'+g.account;if(how==='open'){st.open.add(id);if(![...st.dims].some(x=>x.startsWith(id+'|')))st.dims.add(id+'|party');}else st.open.delete(id);}rerender(type);return;}
  if(Object.hasOwn(ds,'vtFocusMonth')){const m=ds.vtFocusMonth;st.focusMonth=lastRender.result.financial.months.includes(m)?m:null;const sec=document.getElementById('vtChanges');if(sec){const t=document.createElement('div');t.innerHTML=changesPanel(lastRender.session,lastRender.result);sec.replaceWith(t.firstElementChild);}return;}
  if(ds.vtCardsAll){st.cardsAll=!st.cardsAll;const sec=document.getElementById('vtChanges');if(sec){const t=document.createElement('div');t.innerHTML=changesPanel(lastRender.session,lastRender.result);sec.replaceWith(t.firstElementChild);}return;}
  if(ds.vtRef){const r=getRef(ds.vtRef);if(r){drawer=null;openDrawer(r);if(drawer)drawer.returnFocus=b;}return;}
  if(!drawer)return;
  if(ds.vtClose){closeDrawer();return;}
  if(ds.vtStep){const ms=drawer.result.financial.months,i=ms.indexOf(drawer.month)+(+ds.vtStep);if(i>=0&&i<ms.length){drawer.month=ms[i];drawer.limit=50;renderDrawer(false);}return;}
  if(ds.vtTab){drawer.tab=ds.vtTab;renderDrawer(false);return;}
  if(ds.vtScopeAll){drawer.dim=null;drawer.tag=null;drawer.tab=null;renderDrawer(false);return;}
  if(ds.vtMoreEvidence){drawer.limit+=50;renderDrawer(false);return;}
  if(ds.vtCopy){const ex=V.explain(drawer.session,drawer.result,drawer.type,drawer.account,drawer.month,{dim:drawer.dim,tag:drawer.tag});copyText(ds.vtCopy==='prompt'?V.promptText(ex,drawer.session):V.text(ex));return;}
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&drawer){closeDrawer();}});
 // 大きく動いた月の金額：マウスを乗せたときに理由の要約を作って表示する（描画を軽くするため）
 const tip=e=>{const b=e.target.closest?.('td.vt-hot>button[data-vt-ref]');if(!b||b.dataset.vtTip||!lastRender)return;const r=getRef(b.dataset.vtRef);if(!r)return;b.dataset.vtTip='1';const ex=V.explain(lastRender.session,lastRender.result,r.type,r.account,r.month);if(ex?.summary)b.title=ex.summary;};
 document.addEventListener('mouseover',tip);document.addEventListener('focusin',tip);
}

function drill(model,focus){
 if(!focus?.account)return '';
 const rows=model.current.filter(r=>r.date.slice(0,7)===focus.month&&(r.debit===focus.account||r.credit===focus.account));
 return `<section class="panel monthly-panel"><div class="panelhead"><div><h2>${esc(focus.account)}の元帳確認</h2><span class="small">${esc(focus.month)} ／ 対象科目を含む仕訳行</span></div><button class="btn small" data-action="closeMonthlyDrill">閉じる</button></div>${rows.length?`<div class="tablewrap"><table class="datatable"><thead><tr><th>日付・仕訳番号</th><th>借方</th><th>貸方</th><th>取引先・摘要</th><th>元CSV</th></tr></thead><tbody>${rows.slice(0,150).map(r=>`<tr><td>${r.date}<br><span class="small">${esc(r.id)}</span></td><td>${esc(r.debit)}<br>${amount(r.debitAmount)}円</td><td>${esc(r.credit)}<br>${amount(r.creditAmount)}円</td><td>${esc(r.party||r.debitParty||r.creditParty||'')}<br><span class="small">${esc(r.description)}</span>${D?.evidenceText(r)?`<pre class="ledgerlines small">${esc(D.evidenceText(r))}</pre>`:''}</td><td>${esc(r.source||'')} ${r.line}行</td></tr>`).join('')}</tbody></table></div><div class="review-footer">${rows.length}行中${Math.min(150,rows.length)}行を表示。複合仕訳全体の確認は仕訳番号で元CSV・freeeも照合してください。</div>`:`<div class="panelbody"><p>この月・科目に対応する仕訳が未読込です。対象期間の全件仕訳帳CSVを取り込むと内訳を確認できます。</p></div>`}</section>`;
}
function arTable(model,session){
 const ar=model.receivables,cfg=model.cfg;
 const rows=ar.aging;
 return `<section class="panel monthly-panel"><div class="panelhead"><div><h2>売掛金の回収・消込</h2><span class="small">対象末日 ${ar.end}。帳簿残高と銀行入金、請求書の対応を確認。</span></div><button class="btn small" data-action="import" data-type="aging">未決済一覧CSV</button></div><div class="panelbody"><div class="monthly-ar-totals"><div><span class="small">BSの期末売掛金</span><strong>${amount(ar.closing)}<small> 円</small></strong></div><div><span class="small">一覧の未決済額</span><strong>${amount(ar.total)}<small> 円</small></strong><span class="small">${ar.confirmed?'基準日・全件を指定済み':'基準日・全件の確認待ち'}</span></div><div><span class="small">同じ基準日での差額</span><strong>${amount(ar.difference)}<small> 円</small></strong></div></div><div class="monthly-controls"><div class="field"><label for="financialAgingAsOf">未決済額を確認した基準日</label><input type="date" id="financialAgingAsOf" value="${esc(cfg.agingAsOf)}"><span class="small">出力日と残高の基準日は区別。CSVに基準日がある行はその日付を優先。</span></div><label class="checklabel"><input type="checkbox" id="financialAgingComplete" ${cfg.agingComplete?'checked':''}><span>この売掛金の未決済一覧は、全取引先・全件を含む<br><span class="small">振替伝票の売掛金や、期首残高の管理方法も確認してください。</span></span></label></div></div><div class="tablewrap"><table class="datatable monthly-table"><thead><tr><th>月</th><th>売掛金の借方増加</th><th>貸方減少<br><span class="small">入金・相殺・取消等</span></th><th>預金等を含む減少候補</th><th>預金等を伴わない減少</th></tr></thead><tbody>${ar.flows.map(g=>`<tr><th>${g.month}</th><td>${amount(model.current.length?g.increase:null)}</td><td>${amount(model.current.length?g.decrease:null)}</td><td>${amount(model.current.length?g.bankLinked:null)}</td><td>${amount(model.current.length?g.other:null)}</td></tr>`).join('')}</tbody></table></div><div class="review-footer">${model.current.length?'仕訳CSVの読込範囲内の金額です。':'仕訳CSVが未読込のため、増減は未集計です。'}預金等を含む減少も、実際の入金と請求書の対応は未確定。手数料差引・ファクタリング・相殺を含む場合があります。</div><div class="panelhead"><h3>取引先・期日別の未決済</h3><span class="small">基準日が一致する行のみ期日超過を判定</span></div><div class="tablewrap"><table class="datatable"><thead><tr><th>取引先・番号</th><th>期日</th><th>決済残額</th><th>基準日</th><th>確認事項</th></tr></thead><tbody>${rows.length?rows.map(r=>`<tr><td>${esc(r.party||'取引先未設定')}<br><span class="small">${esc(r.invoice||'')}</span></td><td>${r.due}</td><td>${amount(r.amount)}円</td><td>${esc(r.asOf||'未設定')}</td><td><span class="badge ${r.basisConfirmed&&r.amount>0&&r.days>0?'warn':''}">${!r.basisConfirmed?'基準日を確認':r.amount===0?'帳簿上の残額0':r.amount<0?'残額の符号を確認':r.days>0?'期日超過 '+r.days+'日':'期日内'}</span></td></tr>`).join(''):'<tr><td colspan="5">未決済一覧が未読込です。未読込を「回収済み」と扱いません。</td></tr>'}</tbody></table></div></section>`;
}
function comparisonTable(model){
 const rows=model.comparisons.filter(r=>Math.abs(r.difference)>.01);return `<section class="panel monthly-panel"><div class="panelhead"><h2>帳票と仕訳の照合</h2><span class="small">BSは前月末残高がある月のみ照合</span></div><div class="panelbody"><label class="checklabel"><input type="checkbox" id="financialComparisonConfirmed" ${model.cfg.comparisonConfirmed?'checked':''}><span>帳票と仕訳の期間・科目・タグ範囲、円単位、税込／税抜設定が一致し、レポート集計が完了している<br><span class="small">「資料の読込」で仕訳の全件指定も必要です。条件確認前の差は判定を保留します。</span></span></label></div><div class="tablewrap"><table class="datatable"><thead><tr><th>帳票・月</th><th>科目</th><th>帳票</th><th>仕訳集計／前月末＋増減</th><th>差額</th><th>状態</th></tr></thead><tbody>${rows.length?rows.slice(0,120).map(r=>`<tr><td>${r.type} ${r.month}</td><td>${esc(r.account)}</td><td>${amount(r.reference)}</td><td>${amount(r.calculated)}</td><td>${amount(r.difference)}</td><td><span class="badge ${r.ready?'warn':''}">${r.ready?'差額を確認':'照合条件の確認待ち'}</span></td></tr>`).join(''):`<tr><td colspan="6">${model.comparisons.length?'比較できた範囲では差額がありません。未読込月・分類不明・初月BSは別途確認してください。':'照合に必要な月次帳票と仕訳、または前月末残高が未読込です。'}</td></tr>`}</tbody></table></div></section>`;
}
function alertReason(f,session,result){
 if(!V||!/前月から大きく変動/.test(f.title))return '';
 const month=f.months?.at(-1),ex=f.account&&month?V.explain(session,result,/月末残高/.test(f.title)?'monthlyBS':'monthlyPL',f.account,month):null;
 return ex&&(ex.headline||ex.reason)?`<span class="vt-alertwhy"><strong>仕訳からの推測</strong>${esc([ex.headline?'主因：'+ex.headline:'',ex.reason].filter(Boolean).join('／'))}</span>`:'';
}
function page(session,result,focus){
 const m=result.financial;if(!m)return '<div class="notice">対象期間を設定してください。</div>';
 if(drawer&&(drawer.result!==result||drawer.session!==session))closeDrawer();
 lastRender={model:m,cfg:m.cfg,session,result};
 const findings=result.findings.filter(f=>f.monthlyCheck),negative=findings.filter(f=>f.title.includes('マイナス')),cfg=m.cfg;
 return `<div class="monthly-hero panel"><div><div class="eyebrow">MONTHLY REVIEW</div><h2>科目の動きを、取引から説明する</h2><p class="subtitle">freeeと同じ▶の階層で、科目を取引先別・品目別・部門別に開けます。各月の変動は、仕訳の取引先・品目・相手科目・摘要・前年同月から理由を推測します。</p></div><div class="monthly-hero-number"><strong>${findings.length}</strong><span>月次の確認候補</span></div></div><div class="monthly-overview"><div class="panel"><span class="small">PLの基準</span><strong>${m.plReference.length?'freee月次PL':'仕訳からの参考集計'}</strong></div><div class="panel"><span class="small">BSの基準</span><strong>${m.bs.length?'freee月末残高':m.current.length?'仕訳からの各月の増減':'帳票の取込待ち'}</strong></div><div class="panel"><span class="small">負数を確認する科目</span><strong>${negative.length}科目</strong></div></div>${m.notes.map(n=>`<div class="notice monthly-notice">${esc(n)}</div>`).join('')}${changesPanel(session,result)}<section class="panel monthly-panel"><div class="panelhead"><h2>今見るべき科目</h2><button class="btn small" data-view="review">確認キューへ</button></div><div class="monthly-alerts">${findings.length?findings.slice(0,12).map(f=>`<button class="monthly-alert" data-month-finding="${f.id}"><span class="badge ${f.dataReview?'':f.level==='difference'?'red':'warn'}">${f.dataReview?'資料確認':f.level==='difference'?'金額差':'確認候補'}</span><strong>${esc(f.title)}</strong><span class="small">${esc(f.reason)}</span>${alertReason(f,session,result)}<span>理由と次の確認を見る →</span></button>`).join(''):'<div class="panelbody">現在の読込範囲・抽出条件では月次候補がありません。帳票未読込や回収の確認待ちは残ります。</div>'}</div></section>${drill(m,focus)}${matrixTable(m,'monthlyPL',cfg,session,result)}${matrixTable(m,'monthlyBS',cfg,session,result)}${arTable(m,session)}${comparisonTable(m)}<section class="panel monthly-panel"><div class="panelhead"><h2>取り込む資料</h2></div><div class="monthly-materials">${[['monthlyPL','月次PL','単月・円単位の損益計算書'],['monthlyBS','月次BS','各月末残高。前月末も含めると増減を照合'],['current','仕訳帳','対象期間の全科目・全行（取引先・品目・部門の列も）'],['aging','未決済一覧','売掛金の取引先・期日・決済残額']].map(([type,title,desc])=>`<button class="monthly-material" data-action="import" data-type="${type}"><strong>${title}</strong><span class="small">${desc}</span><span>CSV読込</span></button>`).join('')}</div><div class="review-footer">freeeの月次推移は円単位、分類と勘定科目を「同じ列」、内訳を閉じてCSV出力。取引先・品目・部門の内訳は仕訳帳から作るため、仕訳帳は借方・貸方の取引先・品目・部門の列を含めて出力してください。科目・年月・数値を読めない場合や重複行は、読取エラーを表示します。</div></section>`;
}
F.page=page;F.chart=chart;
})(typeof window!=='undefined'?window:globalThis);

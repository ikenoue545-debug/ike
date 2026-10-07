(function(root){
'use strict';
// 月次PL・BS画面の「取引先・品目・部門別の帳票」。計算は ReviewTagAnalysis、ここは表示だけ。
// 取引先別の残高の欄（なければ「大きく動いた科目」の欄の前）に置く。閉じた欄の中身は開いたときに作る。
const F=root.ReviewFinancial,TA=root.ReviewTagAnalysis,T=root.ReviewTagReports,E=root.ReviewEngine;
if(!F||!TA||!T||typeof F.page!=='function')throw Error('ReviewTagAnalysisUI requires the monthly page and ReviewTagAnalysis.');
const originalPage=F.page,finite=Number.isSafeInteger,nf=new Intl.NumberFormat('ja-JP'),PAGE=25;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>finite(v)?nf.format(v===0?0:v):'—',pct=v=>Number.isFinite(v)?Math.round(v*1000)/10+'%':'—';
const yen=v=>`<span class="ts-money${finite(v)&&v<0?' ts-negative':''}">${num(v)}</span>`;
const signed=v=>finite(v)?`<span class="ts-money${v<0?' ts-negative':''}">${v>0?'+':''}${num(v)}</span>`:'—';
const norm=s=>String(s??'').normalize('NFKC').toLocaleLowerCase().replace(/[\s　]/g,'');
const mlabel=m=>m?`${+m.slice(0,4)}年${+m.slice(5)}月`:'—',span=ms=>ms?.length?`${mlabel(ms[0])}〜${mlabel(ms.at(-1))}`:'—';
const TYPE_LABEL={monthlyBS:'月次BS',monthlyPL:'月次PL',priorBS:'前期BS',priorPL:'前期PL'};
const STATE={clean:['ok','残高として読めます'],residual:['warn','累計の動き（未選択に相殺額あり）'],untagged:['','タグなし（未選択のみ）'],flow:['','相手ごとの入出金の累計（残高ではありません）']};
const LEVEL={difference:['red','差額'],candidate:['warn','確認候補'],info:['','参考']};
const states=new WeakMap(),bodies=new Map();let active=null,composing=null,timer=null;
function state(s){let v=states.get(s);if(!v){v={tab:null,query:'',pages:{},open:new Set()};states.set(s,v);}return v;}
const lazyKey=parts=>JSON.stringify(parts);
function pageOf(st,k,rows){const last=Math.max(0,Math.ceil(rows.length/PAGE)-1),p=Math.min(Math.max(0,st.pages[k]||0),last);st.pages[k]=p;return {rows:rows.slice(p*PAGE,(p+1)*PAGE),p,total:rows.length};}
function pager(pg,k){return pg.total>PAGE?`<div class="ta-pager"><span class="small">${pg.p*PAGE+1}〜${Math.min((pg.p+1)*PAGE,pg.total)}件 ／ ${pg.total}件（全件はCSVに保存できます）</span><button type="button" class="btn small" data-ta-page="${esc(k)}" data-ta-step="-1" ${pg.p===0?'disabled':''}>前へ</button><button type="button" class="btn small" data-ta-page="${esc(k)}" data-ta-step="1" ${(pg.p+1)*PAGE>=pg.total?'disabled':''}>次へ</button></div>`:'';}
// 閉じた欄は見出しだけを作り、開いたとき（または前に開いていたとき）に中身を作る
function lazy(st,k,summary,body,cls='',force=false){const open=force||st.open.has(k);bodies.set(k,body);return `<details class="ta-lazy ${cls}" data-ta-lazy="${esc(k)}"${open?' open':''}><summary>${summary}</summary><div class="ta-lazybody">${open?body():''}</div></details>`;}

// ---- 読込状況
function checkText(d){
 const c=d.check;if(!d.loaded)return '';if(!c)return '<span class="small">照合の記録なし</span>';
 if(c.dropped?.length)return `<span class="badge warn">${c.dropped.length}科目は合わないため内訳を除外</span>`;
 return `<span class="badge ok">内訳の合計＝科目合計</span><span class="small">${c.checked}科目を照合</span>`;
}
function materials(ta){
 const ms=ta.materials||[],dims=['party','item','department',...['segment1','segment2','segment3'].filter(d=>ms.some(m=>m.dims.some(x=>x.dim===d&&x.loaded)))];
 const head=`<tr><th scope="col">帳票</th><th scope="col">科目合計（タグなし）</th>${dims.map(d=>`<th scope="col">${esc(T.DIMS[d])}別</th>`).join('')}<th scope="col"><span class="sr-only">読込</span></th></tr>`;
 const body=ms.map(m=>{
  const plain=m.plain.at(-1),tot=m.totals>0;
  const totCell=`<td data-label="科目合計（タグなし）">${tot?`<span class="ta-yes" aria-label="読込済み">✓</span> <span class="small">${esc(span(ta.totalsMonths?.[m.type]||plain?.reportStats?.months||monthsOfDims(m)))}</span>${plain?`<span class="ta-file">${esc(plain.name)}</span>`:'<span class="ta-file">タグ別の帳票に含まれる科目合計</span>'}`:'<span class="ta-no">—</span>'}</td>`;
  const cells=dims.map(d=>{const x=m.dims.find(y=>y.dim===d);if(!x||!x.loaded)return `<td data-label="${esc(T.DIMS[d])}別"><span class="ta-no" aria-label="未読込">—</span></td>`;return `<td data-label="${esc(T.DIMS[d])}別"><span class="ta-yes" aria-label="読込済み">✓</span> <span class="small">${esc(span(x.months))}</span>${x.file?`<span class="ta-file">${esc(x.file)}</span>`:''}${checkText(x)}</td>`;}).join('');
  return `<tr><th scope="row">${esc(TYPE_LABEL[m.type]||m.name)}</th>${totCell}${cells}<td class="ta-act"><button type="button" class="btn small" data-action="import" data-type="${esc(m.type)}">CSV読込</button></td></tr>`;
 }).join('');
 return `<div class="ta-block"><h3>読み込んだ帳票</h3><div class="tablewrap"><table class="datatable ta-table ta-materials"><thead>${head}</thead><tbody>${body}</tbody></table></div>
 <details class="ta-howto"><summary>freeeでの出し方</summary><ol class="small"><li>freeeの「レポート」→「月次推移」を開き、貸借対照表（または損益計算書）を選びます。</li><li>「表示するタグ」で取引先・品目・部門のいずれか1つを選びます（1種類ずつ別のCSVにします）。</li><li>表示単位は「円」、「分類と勘定科目」は「同じ列にする」にして、CSVで出力します。</li><li>この表の「CSV読込」から取り込みます。同じ帳票・同じタグの読込は置き換え、他のタグ別の内訳は残ります。科目合計は1組だけ使い、内訳を足して二重にすることはありません。</li></ol></details></div>`;
}
function monthsOfDims(m){const x=m.dims.find(d=>d.loaded&&d.months?.length);return x?x.months:[];}

// ---- 損益の内訳
function stat(label,value,sub=''){return `<div class="ta-stat"><span>${esc(label)}</span><strong>${value}</strong>${sub?`<small>${sub}</small>`:''}</div>`;}
function plSummary(p){
 const g=p.groups,un=p.accounts.filter(a=>a.role==='income').reduce((n,a)=>n+(a.unselected.ytd||0),0);
 return `<div class="ta-stats">${stat('収益の合計',yen(g.income.ytd),esc(span(p.months)))}${stat('費用の合計',yen(g.expense.ytd),esc(span(p.months)))}${stat(`${mlabel(p.latest)}の収益`,yen(g.income.latest),p.prev?`前月差 ${signed(g.income.latest-g.income.prev)}`:'')}${stat(`収益のうち${p.label}が未選択`,pct(g.income.ytd>0?un/g.income.ytd:null),yen(un)+'円')}${p.prior?stat('収益の前年同期との差',signed(g.income.current-g.income.prior),esc(`${p.prior.label}・${span(p.prior.months)}`)):''}</div>`;
}
function bars(list,base,label){
 if(!list.length)return '';const max=Math.max(...list.map(x=>Math.abs(x.v)),1);
 return `<ol class="ta-bars" aria-label="${esc(label)}">${list.map(x=>`<li><span class="ta-barname">${esc(x.name)}</span><span class="ta-bar" style="--w:${Math.max(2,Math.round(Math.abs(x.v)/max*100))}%"></span><span class="ta-barval">${yen(x.v)}<small>${pct(base>0?x.v/base:null)}</small></span></li>`).join('')}</ol>`;
}
function partyView(p){
 const c=p.customers;if(!c)return '';
 const cards=`<div class="ta-stats">${stat('売上のある取引先',`${c.count}社`,c.accounts.length?esc(c.accounts.join('・')):'')}${stat('上位1社の割合',pct(c.top1Share),c.top[0]?esc(c.top[0].tag):'')}${stat('上位3社の割合',pct(c.top3Share))}${c.unselected?stat('取引先が未選択の売上',yen(c.unselected),pct(c.unselectedShare)):''}</div>`;
 const conc=c.top1Share>=0.5?`<div class="notice">売上の ${pct(c.top1Share)} が1社（${esc(c.top[0].tag)}）に集中しています。取引の継続・入金の状況を気にかけておくと安心です。</div>`:'';
 const list=(xs,f)=>xs.length?`<ul class="ta-list">${xs.slice(0,12).map(f).join('')}${xs.length>12?`<li class="small">ほか ${xs.length-12}社</li>`:''}</ul>`:'<p class="small">ありません。</p>';
 const nl=c.basis==='prior'?`<div class="ta-two"><div><h4>前年同期になかった取引先（${c.added.length}社）</h4>${list(c.added,x=>`<li>${esc(x.tag)} ${yen(x.ytd)}円</li>`)}</div><div><h4>前年同期にあって当期にない取引先（${c.lost.length}社）</h4>${list(c.lost,x=>`<li>${esc(x.tag)} 前年 ${yen(x.prior)}円</li>`)}</div></div><p class="small">比べた月：${esc(span(c.compareMonths))}と前年の同じ月（${esc(p.prior.label)}）。</p>`
  :c.basis==='period'?`<div class="ta-two"><div><h4>直近3か月に取引が始まった取引先（${c.added.length}社）</h4>${list(c.added,x=>`<li>${esc(x.tag)} ${yen(x.ytd)}円（${esc(mlabel(x.first))}から）</li>`)}</div><div><h4>直近3か月に売上がない取引先（${c.lost.length}社）</h4>${list(c.lost,x=>`<li>${esc(x.tag)} 当期 ${yen(x.ytd)}円（最後は${esc(mlabel(x.last))}）</li>`)}</div></div><p class="small">前年の帳票・仕訳がないため、当期の中で比べています（直近3か月：${esc(span(c.recentMonths))}）。</p>`:'';
 return `<div class="ta-sub"><h4>売上の取引先</h4>${cards}${conc}${bars(c.top.map(x=>({name:x.tag,v:x.ytd})),c.base,'売上の多い取引先')}${nl}</div>`;
}
function deptView(st,p){
 const d=p.departments;if(!d)return '';
 const name=x=>x.unselected?'未選択（部門なし・共通費など）':x.tag;
 const row=(x,cls='')=>`<tr class="${cls}"><th scope="row">${esc(name(x))}</th><td class="num" data-label="収益">${yen(x.ytd.income)}</td><td class="num" data-label="費用">${yen(x.ytd.expense)}</td><td class="num" data-label="損益">${yen(x.ytd.profit)}</td><td class="num" data-label="利益率">${pct(x.ytd.margin)}</td><td class="num" data-label="${esc(mlabel(p.latest))}の損益">${yen(x.values[p.latest]?.profit)}</td></tr>`;
 const k=lazyKey(['dept-monthly',p.dim]);
 const monthly=()=>`<div class="tablewrap"><table class="datatable ta-grid"><thead><tr><th scope="col">部門</th>${p.months.map(m=>`<th scope="col" class="num">${esc(mlabel(m))}</th>`).join('')}</tr></thead><tbody>${[...d.rows,d.total].map(x=>`<tr${x===d.total?' class="ta-total"':''}><th scope="row">${esc(x===d.total?'合計':name(x))}</th>${p.months.map(m=>`<td class="num">${yen(x.values[m]?.profit)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
 return `<div class="ta-sub"><h4>部門別損益（${esc(span(p.months))}）</h4><div class="tablewrap"><table class="datatable ta-table"><thead><tr><th scope="col">部門</th><th scope="col" class="num">収益</th><th scope="col" class="num">費用</th><th scope="col" class="num">損益</th><th scope="col" class="num">利益率</th><th scope="col" class="num">${esc(mlabel(p.latest))}の損益</th></tr></thead><tbody>${d.rows.map(x=>row(x,x.unselected?'ta-unsel':'')).join('')}${row(d.total,'ta-total')}</tbody></table></div>
 <p class="small">部門を付けていない収益・費用は「未選択」に入ります。部門の損益は共通費を配る前の金額です。${d.missingAccounts.length?`部門別の帳票にない科目（${esc(d.missingAccounts.join('・'))}）は含みません。`:''}</p>${lazy(st,k,'月ごとの部門別損益',monthly)}</div>`;
}
function itemView(p){
 const inc=p.tags.filter(t=>t.income),exp=p.tags.filter(t=>t.expense).sort((x,y)=>y.expense-x.expense);
 return `<div class="ta-sub ta-two"><div><h4>${esc(p.label)}別の売上・収益</h4>${bars(inc.slice(0,10).map(t=>({name:t.unselected?'未選択':t.tag,v:t.income})),p.groups.income.ytd,'収益の内訳')||'<p class="small">ありません。</p>'}</div><div><h4>${esc(p.label)}別の費用</h4>${bars(exp.slice(0,10).map(t=>({name:t.unselected?'未選択':t.tag,v:t.expense})),p.groups.expense.ytd,'費用の内訳')||'<p class="small">ありません。</p>'}</div></div>`;
}
function tagTable(st,p,a,q){
 const k=lazyKey(['pl',p.dim,a.account]),tags=q?a.tags.filter(t=>norm(t.tag).includes(q)||norm(a.account).includes(q)):a.tags.filter(t=>!t.priorOnly||t.prior);
 const pg=pageOf(st,k,tags);
 return `<div class="tablewrap"><table class="datatable ta-table"><thead><tr><th scope="col">${esc(p.label)}</th><th scope="col" class="num">当期累計</th><th scope="col" class="num">科目内の割合</th><th scope="col" class="num">${esc(mlabel(p.latest))}</th><th scope="col" class="num">前月差</th>${p.prior?'<th scope="col" class="num">前年同期</th><th scope="col" class="num">前年差</th>':''}</tr></thead><tbody>${pg.rows.map(t=>`<tr class="${t.unselected?'ta-unsel':''}"><th scope="row">${esc(t.unselected?'未選択':t.tag)}</th><td class="num" data-label="当期累計">${yen(t.ytd)}</td><td class="num" data-label="科目内の割合">${pct(t.share)}</td><td class="num" data-label="${esc(mlabel(p.latest))}">${yen(t.latest)}</td><td class="num" data-label="前月差">${signed(t.change)}</td>${p.prior?`<td class="num" data-label="前年同期">${yen(t.prior)}</td><td class="num" data-label="前年差">${signed(t.yoy)}</td>`:''}</tr>`).join('')}</tbody></table></div>${pager(pg,k)}`;
}
function accountsView(st,p){
 const q=norm(st.query),list=q?p.accounts.filter(a=>norm(a.account).includes(q)||a.tags.some(t=>norm(t.tag).includes(q))):p.accounts;
 const items=list.map(a=>{
  const k=lazyKey(['pl',p.dim,a.account]),warn=a.tagsInUse&&a.unselected.share>=0.3&&a.unselected.ytd>0;
  const sum=`<span class="ta-acctname">${esc(a.account)}</span><span class="badge">${a.role==='income'?'収益':'費用'}</span><span class="ta-acctnum">${yen(a.ytd)}円</span><span class="small">${a.tags.filter(t=>!t.priorOnly).length}件${a.unselected.ytd?`・未選択 ${pct(a.unselected.share)}`:''}</span>${warn?'<span class="badge warn">付け漏れ？</span>':''}`;
  return lazy(st,k,sum,()=>tagTable(st,p,a,q),'ta-acct',!!q);
 }).join('');
 return `<div class="ta-sub"><div class="ta-searchrow"><h4>科目ごとの内訳</h4><label class="ta-search"><span class="sr-only">科目・${esc(p.label)}を検索</span><input type="search" data-ta-query placeholder="科目・${esc(p.label)}で検索" value="${esc(st.query)}" autocomplete="off"></label></div>${items||'<p class="small">該当する科目・タグはありません。</p>'}</div>`;
}
function plBlock(st,ta){
 if(!ta.plDims.length)return '';
 if(!ta.plDims.includes(st.tab))st.tab=ta.plDims[0];
 const p=ta.pl[st.tab];
 const tabs=`<div class="ta-tabs" role="tablist" aria-label="損益の内訳のタグ">${ta.plDims.map(d=>`<button type="button" role="tab" class="ta-tab" data-ta-tab="${esc(d)}" aria-selected="${d===st.tab}">${esc(ta.pl[d].label)}別</button>`).join('')}</div>`;
 const extra=p.dim==='party'?partyView(p):p.dim==='department'?deptView(st,p):itemView(p);
 return `<div class="ta-block"><h3>損益の内訳</h3>${tabs}<div class="ta-tabpanel" role="tabpanel">${plSummary(p)}${p.prior?'':`<p class="small">前年の${esc(p.label)}別の帳票（前期PL）や前年の仕訳がないため、前年同期とは比べていません。</p>`}${extra}${accountsView(st,p)}</div></div>`;
}

// ---- 残高の内訳
function bsBlock(st,ta){
 if(!ta.bsDims.length)return '';
 const notable=[];
 for(const d of ta.bsDims){const b=ta.bs[d];for(const a of b.clearing)notable.push({b,a,kind:'clearing',xs:a.static});for(const a of b.negative)notable.push({b,a,kind:'negative',xs:a.negative});}
 const card=n=>{const k=lazyKey(['bs',n.kind,n.b.dim,n.a.account]),amt=n.xs.reduce((s,x)=>s+(n.kind==='clearing'?Math.abs(x.amount):x.amount),0);
  const full=()=>{const pg=pageOf(st,k,n.xs);return `<div class="tablewrap"><table class="datatable ta-table"><thead><tr><th scope="col">${esc(n.b.label)}</th><th scope="col" class="num">${esc(mlabel(n.b.asOf))}末</th><th scope="col">${n.kind==='clearing'?'変わっていない期間':'マイナスの期間'}</th></tr></thead><tbody>${pg.rows.map(x=>`<tr><th scope="row">${esc(x.tag)}</th><td class="num" data-label="${esc(mlabel(n.b.asOf))}末">${yen(x.amount)}</td><td data-label="${n.kind==='clearing'?'変わっていない期間':'マイナスの期間'}">${x.since==='期首'?'期首から':esc(mlabel(x.since))+'末から'}（${n.kind==='clearing'?x.months+'か月動きなし':'月末 '+x.months+'回'}）</td></tr>`).join('')}</tbody></table></div>${pager(pg,k)}`;};
  return `<article class="ta-card ta-${n.kind}"><div class="ta-cardtop"><span class="badge warn">${n.kind==='clearing'?'精算されずに残る':'マイナスの残高'}</span><span class="small">${esc(n.b.label)}別</span></div><strong>${esc(n.a.account)}</strong><span class="ta-cardamt">${yen(amt)}円</span><p class="small">${n.kind==='clearing'?`${n.xs.length}件の${esc(n.b.label)}で、3か月以上動かずに残っています。${n.a.state==='residual'?`科目の残高は ${num(n.a.balance)}円で、未選択の金額と相殺されています（精算の仕訳に${esc(n.b.label)}が付いていない可能性）。`:''}`:`${n.xs.length}件の${esc(n.b.label)}で残高がマイナスです（過入金・二重払い・消込ミスの候補）。`}</p><p class="small">${n.xs.slice(0,3).map(x=>`${esc(x.tag)} ${num(x.amount)}円`).join('、')}${n.xs.length>3?' ほか':''}</p>${lazy(st,k,'すべて表示',full,'ta-more')}</article>`;};
 const cls=d=>{const b=ta.bs[d],k=lazyKey(['bs-class',d]);return lazy(st,k,`${esc(b.label)}別の月次BS：科目ごとの見方（${b.accounts.length}科目）`,()=>`<div class="tablewrap"><table class="datatable ta-table"><thead><tr><th scope="col">科目</th><th scope="col">${esc(b.label)}別の値の見方</th><th scope="col" class="num">${esc(b.label)}の数</th><th scope="col" class="num">0円でないもの</th><th scope="col" class="num">科目の残高</th><th scope="col" class="num">うち未選択</th></tr></thead><tbody>${b.accounts.map(a=>{const s=STATE[a.flow?'flow':a.state];return `<tr><th scope="row">${esc(a.account)}</th><td data-label="見方"><span class="badge ${s[0]}">${esc(s[1])}</span></td><td class="num" data-label="${esc(b.label)}の数">${num(a.tags)}</td><td class="num" data-label="0円でないもの">${num(a.nonzeroTags)}</td><td class="num" data-label="科目の残高">${yen(a.balance)}</td><td class="num" data-label="うち未選択">${yen(a.unselected)}</td></tr>`;}).join('')}</tbody></table></div><p class="small">未選択に金額がある科目では、タグ別の値は残高ではなく「タグを付けた仕訳の累計」です（年度締めや、タグを付けずに精算した分が未選択に入ります）。現金・預金・カードは相手ごとの入出金の累計です。</p>`,'ta-class');};
 return `<div class="ta-block"><h3>残高の内訳で気になるもの</h3><p class="small">${esc(mlabel(ta.asOf))}末の残高で判定しています。</p>${notable.length?`<div class="ta-cards">${notable.map(card).join('')}</div>`:'<p class="small">精算されずに残る仮勘定・マイナスの債権債務は見つかりませんでした（判定できる科目のみ）。</p>'}${ta.bsDims.map(cls).join('')}</div>`;
}
function findingsBlock(result){
 const fs=(result?.findings||[]).filter(f=>String(f.reviewContext||'').startsWith('["tag-report"'));
 if(!fs.length)return '';
 return `<div class="ta-block"><h3>確認キューに入れた項目（${fs.length}件）</h3><ul class="ta-findings">${fs.map(f=>{const l=LEVEL[f.level]||LEVEL.info;return `<li><span class="badge ${l[0]}">${l[1]}</span><span class="ta-ftitle">${esc(f.title)}</span>${f.amount?`<span class="ts-money">${num(f.amount)}円</span>`:''}<button type="button" class="btn small" data-month-finding="${esc(f.id)}">確認する</button></li>`;}).join('')}</ul></div>`;
}
function notices(ta){
 const out=[...(ta.notes||[])];
 for(const x of ta.checks?.mismatch||[])out.push(`${TYPE_LABEL[x.type]||x.type}（${x.label}別）：内訳の合計が科目合計と合わない ${x.accounts.length}科目（${x.accounts.slice(0,5).join('・')}${x.accounts.length>5?' ほか':''}）は、内訳を取り込まずに科目合計だけを使っています。`);
 for(const x of ta.checks?.conflict||[])out.push(x.kind==='removed'?`${TYPE_LABEL[x.type]||x.type}（${x.label}別）：後から取り込んだ帳票と科目合計が合わず、内訳 ${x.removed}件を外しています。出し直して取り込むと元に戻ります。`:`${TYPE_LABEL[x.type]||x.type}（${x.label}別）：保存されている内訳が科目合計と合わない科目があります（${x.accounts.slice(0,5).join('・')}）。`);
 return out.map(t=>`<div class="notice">${esc(t)}</div>`).join('');
}
function panel(session,result){
 // タグ別の帳票がなければ欄を出さない（帳票の取込は「資料」画面と各欄の「CSV読込」から）
 const model=result?.financial,ta=model?.tagAnalysis;if(!ta||!ta.any&&!ta.error)return '';const st=state(session);bodies.clear();
 const head=`<section class="panel monthly-panel ta-panel" id="tagReports" aria-labelledby="tagReportsTitle"><div class="panelhead"><div><h2 id="tagReportsTitle">取引先・品目・部門別の帳票</h2><span class="small">freeeの月次推移で「表示するタグ」を選んで出力した帳票から、収益・費用の内訳と、残高の内訳で気になるものを見ます。科目合計には足しません。</span></div>${ta.any?'<button type="button" class="btn small" data-ta-export>CSVに保存</button>':''}</div><div class="panelbody">`;
 if(ta.error)return `${head}<div class="notice">タグ別の帳票を集計する途中でエラーが起きたため、この欄は表示できません（${esc(ta.error)}）。他の欄の数値には影響しません。</div></div></section>`;
 return `${head}${materials(ta)}${notices(ta)}${plBlock(st,ta)}${bsBlock(st,ta)}${findingsBlock(result)}</div></section>`;
}

// ---- CSV（表計算ソフトで式として読まれないように、先頭の = + - @ には ' を付ける）
function csv(session,result){
 const ta=result?.financial?.tagAnalysis;if(!ta)return '';
 const q=v=>{if(typeof v==='number'&&Number.isFinite(v))return String(v);const t=String(v??''),s=/^[=+\-@\t\r＝＋－＠]/.test(t)?"'"+t:t;return '"'+s.replace(/"/g,'""')+'"';};
 const rows=[['区分','タグの種類','科目','タグ','金額（円）','月','その月の金額（円）','前月差（円）','割合','前年同期（円）','前年差（円）','備考']];
 for(const d of ta.plDims){const p=ta.pl[d];
  for(const a of p.accounts)for(const t of a.tags)rows.push(['PLの内訳（当期累計）',p.label,a.account,t.unselected?'未選択':t.tag,t.ytd,p.latest||'',t.latest??'',t.change??'',t.share==null?'':Math.round(t.share*1000)/10+'%',t.prior??'',t.yoy??'',`${a.role==='income'?'収益':'費用'}・${span(p.months)}`]);
  if(p.departments)for(const x of [...p.departments.rows,p.departments.total])rows.push(['部門別損益（当期累計）',p.label,'収益−費用',x.unselected?'未選択':x.tag,x.ytd.profit,p.latest||'',x.values[p.latest]?.profit??'','',x.ytd.margin==null?'':Math.round(x.ytd.margin*1000)/10+'%','','',`収益 ${x.ytd.income}／費用 ${x.ytd.expense}`]);
 }
 for(const d of ta.bsDims){const b=ta.bs[d];
  for(const a of b.accounts)rows.push(['BSの見方',b.label,a.account,'',a.balance??'',b.asOf||'','','','','','',STATE[a.flow?'flow':a.state][1]]);
  for(const a of b.clearing)for(const x of a.static)rows.push(['BS：精算されずに残る',b.label,a.account,x.tag,x.amount,b.asOf||'','','','','','',`${x.fromOpening?'期首':x.since+'末'}から変わらず（${x.months}か月動きなし）`]);
  for(const a of b.negative)for(const x of a.negative)rows.push(['BS：マイナスの残高',b.label,a.account,x.tag,x.amount,b.asOf||'','','','','','',`${x.since==='期首'?'期首':x.since+'末'}から（月末 ${x.months}回）`]);
 }
 return '\uFEFF'+rows.map(r=>r.map(q).join(',')).join('\r\n');
}

F.page=function(session,result,focus){
 const html=originalPage.call(this,session,result,focus);if(!result?.financial)return html;
 active={session,result};const add=panel(session,result);if(!add)return html;
 const marker='<section class="panel monthly-panel" id="vtChanges"',at=html.indexOf(marker);
 if(at>=0)return html.slice(0,at)+add+html.slice(at);
 const t=html.indexOf('id="treasuryReview"'),after=t<0?-1:html.indexOf('</section>',t);
 return after<0?html+add:html.slice(0,after+10)+add+html.slice(after+10);
};
function refresh(){
 if(!active)return;const el=document.getElementById('tagReports');if(!el)return;
 const f=document.activeElement,sel=f?.hasAttribute?.('data-ta-query')?'[data-ta-query]':f?.dataset?.taPage?`[data-ta-page="${CSS.escape(f.dataset.taPage)}"][data-ta-step="${f.dataset.taStep}"]`:f?.dataset?.taTab?`[data-ta-tab="${CSS.escape(f.dataset.taTab)}"]`:null,s=f?.selectionStart,e=f?.selectionEnd;
 const box=document.createElement('div');box.innerHTML=panel(active.session,active.result);const next=box.firstElementChild;if(!next)return;el.replaceWith(next);
 if(sel){let x=next.querySelector(sel);if(x?.disabled&&f?.dataset?.taPage)x=[...next.querySelectorAll('[data-ta-page]')].find(b=>b.dataset.taPage===f.dataset.taPage&&!b.disabled);x?.focus({preventScroll:true});if(x?.type==='search'&&typeof s==='number')x.setSelectionRange(s,e);}
}
// 閉じた欄を開いたときに中身を作る（同じ欄は描き直しても開いたまま）
function fill(d){
 const k=d.dataset.taLazy;if(!active||!k)return;const st=state(active.session);
 if(!d.open){st.open.delete(k);return;}st.open.add(k);
 const body=d.querySelector(':scope>.ta-lazybody'),make=bodies.get(k);if(!body||body.childElementCount||!make)return;
 body.innerHTML=make();
}
if(typeof document!=='undefined'){
 document.addEventListener('toggle',e=>{const d=e.target;if(d?.matches?.('#tagReports details[data-ta-lazy]'))fill(d);},true);
 document.addEventListener('compositionstart',e=>{if(e.target.matches?.('[data-ta-query]')){composing=e.target;clearTimeout(timer);}});
 document.addEventListener('compositionend',e=>{if(e.target.matches?.('[data-ta-query]')&&active){composing=null;const st=state(active.session);st.query=e.target.value;st.pages={};clearTimeout(timer);refresh();}});
 document.addEventListener('input',e=>{if(!e.target.matches?.('[data-ta-query]')||!active||e.isComposing||composing===e.target)return;const st=state(active.session);st.query=e.target.value;st.pages={};clearTimeout(timer);timer=setTimeout(()=>{if(!composing)refresh();},150);});
 document.addEventListener('click',e=>{
  const b=e.target.closest?.('#tagReports [data-ta-tab],#tagReports [data-ta-page],#tagReports [data-ta-export]');if(!b||!active)return;const st=state(active.session);
  if(b.dataset.taTab){st.tab=b.dataset.taTab;st.query='';refresh();return;}
  if(b.dataset.taPage){st.pages[b.dataset.taPage]=Math.max(0,(st.pages[b.dataset.taPage]||0)+Number(b.dataset.taStep||0));refresh();return;}
  const blob=new Blob([csv(active.session,active.result)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`タグ別帳票_${active.session.project.start}_${active.session.project.end}.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
}
root.ReviewTagAnalysisUI={panel,csv,version:1};
})(typeof window!=='undefined'?window:globalThis);

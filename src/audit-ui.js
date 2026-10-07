
(function(root){
'use strict';
// Read-only monthly UI for the independent checks in ReviewAudit.
const F=root.ReviewFinancial,A=root.ReviewAudit;
if(!F||!A||typeof F.page!=='function')throw Error('ReviewAuditUI requires the monthly page and ReviewAudit.');
const originalPage=F.page,finite=Number.isFinite,nf=new Intl.NumberFormat('ja-JP',{maximumFractionDigits:20});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>finite(v)?nf.format(v===0?0:v):'—',unique=xs=>[...new Set(xs.filter(x=>x!==null&&x!==undefined&&String(x).trim()!==''))];
const TYPES={current:'当期仕訳帳',prior:'前期仕訳帳',monthlyBS:'当期月次BS',monthlyPL:'当期月次PL',priorBS:'前期月次BS',priorPL:'前期月次PL',aging:'未決済一覧',balances:'残高資料',payroll:'給与資料',sales:'売上資料',assets:'固定資産資料'};
const statusLabel=s=>A.statusNames[s]||'判定保留';
const badge=s=>`<span class="badge ${s==='difference'?'red':s==='pending'?'warn':''}">${esc(statusLabel(s))}</span>`;
const evidence=rows=>unique((rows||[]).map(r=>`${r.source||'元CSV名未保存'}${r.line?' '+r.line+'行':''}${r.journalId||r.id?'（仕訳 '+(r.journalId||r.id)+'）':''}`));
const PAGE_SIZE=50,PROOF_SIZE=20,states=new WeakMap();let printing=false;
function bounds(total,page,size=PAGE_SIZE){const last=Math.max(0,Math.ceil(total/size)-1),index=Math.min(last,Math.max(0,Number.isSafeInteger(page)?page:0)),start=index*size;return printing?{page:index,start:0,end:total,last}:{page:index,start,end:Math.min(total,start+size),last};}
function stateFor(session,model,audit){
 let s=states.get(session);if(!s||s.model!==model||s.audit!==audit){s={model,audit,pages:{checks:0,transfers:0,comparisons:0,sources:0},proofPages:new Map(),proofRows:new Map(),checks:audit.checks.filter(c=>c.status!=='agree').sort((a,b)=>(a.status==='difference'?0:1)-(b.status==='difference'?0:1)||String(a.month||'').localeCompare(String(b.month||'')))};states.set(session,s);}return s;
}
function auditFor(session,model){const state=states.get(session);return model.audit||(state?.model===model?state.audit:A.inspect(session,model));}
function pager(kind,total,page,label,size=PAGE_SIZE,token=''){
 const b=bounds(total,page,size),attrs=token?` data-audit-proof-key="${esc(token)}"`:'';
 return `<div class="audit-pagination"><p class="small" data-audit-range="${kind}" tabindex="-1" aria-live="polite">${esc(label)} ${num(total)}件中 ${total?num(b.start+1):'0'}〜${num(b.end)}件を表示${total>size&&!printing?` ／ ${num(size)}件ずつ`:''}</p>${total>size&&!printing?`<div class="audit-page-buttons"><button class="btn small" data-audit-page="${kind}" data-audit-direction="prev" data-audit-target-page="${b.page-1}"${attrs}${b.page===0?' disabled':''} aria-label="${esc(label)}の前の${size}件">前へ</button><button class="btn small" data-audit-page="${kind}" data-audit-direction="next" data-audit-target-page="${b.page+1}"${attrs}${b.page===b.last?' disabled':''} aria-label="${esc(label)}の次の${size}件">次へ</button></div>`:''}</div>`;
}
function proofsHTML(rows,state,token,open=false){
 const refs=evidence(rows),page=bounds(refs.length,state?.proofPages.get(token)||0,PROOF_SIZE);if(state)state.proofRows.set(token,rows||[]);
 if(!refs.length)return '<span class="small">対応する元CSVの行は未確定です。</span>';
 return `<details class="audit-evidence" data-audit-proof="${esc(token)}"${open?' open':''}><summary>根拠の元CSV・行番号（${num(refs.length)}件）</summary>${pager('proof',refs.length,page.page,'出典',PROOF_SIZE,token)}<ul>${refs.slice(page.start,page.end).map(s=>`<li>${esc(s)}</li>`).join('')}</ul>${refs.length>PROOF_SIZE&&!printing?'<p class="small">表示は20件ずつです。照合結果CSVには各確認項目の全出典を保存します。</p>':''}</details>`;
}
function clearProofs(state,prefix){for(const token of state.proofRows.keys())if(token.startsWith(prefix))state.proofRows.delete(token);}
function sourceFiles(session){
 const groups=[];
 for(const [type,rows]of Object.entries(session.datasets||{})){
  const map=new Map();
  for(const r of rows){const id=r.importSource||r.source||'memory';let g=map.get(id);if(!g){g={type,id,name:r.source||'元CSV名未保存',rows:[]};map.set(id,g);}g.rows.push(r);}
  const logs=(session.imports||[]).filter(i=>i.type===type);
  for(const log of logs){
   const g=[...map.values()].find(g=>log.importSource?g.id===log.importSource:g.name===log.name);
   if(g){g.log=log;if(log.name)g.name=log.name;}
   else if(log.count===0&&log.errors>0)map.set(log.importSource||'errors:'+log.name,{type,id:log.importSource||'',name:log.name||'元CSV名未保存',rows:[],log});
  }
  for(const g of map.values()){
   const dates=unique(g.rows.map(r=>r.date)).sort(),reports=unique(g.rows.filter(r=>r.reportStart&&r.reportEnd).map(r=>r.reportStart+'〜'+r.reportEnd));
   g.period=dates.length?dates[0]+'〜'+dates.at(-1):'—';
   g.sourcePeriod=reports.length?reports.join('／'):'資料内の期間情報なし';
   g.entities=unique(g.rows.map(r=>r.reportEntity));
   g.count=g.rows.length;g.errors=g.rows.reduce((n,r)=>Math.max(n,r.importErrors||0),g.log?.errors||0);
   groups.push(g);
  }
 }
 return groups;
}
function coverageHTML(audit){
 return `<div class="tablewrap"><table class="datatable audit-coverage"><caption>月別の読込範囲</caption><thead><tr><th scope="col">月</th><th scope="col" class="num">当期仕訳行</th><th scope="col">単月PL</th><th scope="col">月末BS</th><th scope="col">期首・前月末BS</th><th scope="col">照合条件・次の確認</th></tr></thead><tbody>${audit.coverage.map(c=>`<tr><th scope="row">${esc(c.month)}</th><td class="num">${num(c.rowCount)}</td><td>${c.plPresent?'値あり':'未読込／空欄'}</td><td>${c.bsPresent?'値あり':'未読込／空欄'}</td><td>${c.bsOpeningPresent?'値あり':'未読込／空欄'}</td><td><span class="badge ${c.ready?'':'warn'}">${c.ready?'照合条件確認済み':'判定保留'}</span>${c.reasons?.length?`<p class="small">${esc(c.reasons.join(' '))}</p>`:''}</td></tr>`).join('')}</tbody></table></div><p class="small audit-readnote">「値あり」は金額を読めたセルがあることを示します。科目ごとの欠損は下の詳細で確認します。仕訳が未読込の月を取引なしの0円と扱いません。</p>`;
}
function checkHTML(check,state,index){
 const reason=check.reason||check.reasons?.join(' ')|| (check.status==='difference'?'帳票と計算の金額差を確認します。':'計算に必要な資料・照合条件を確認します。');
 return `<tr data-audit-check="${esc(check.id)}"><td>${esc(check.month||'期間全体')}<br>${badge(check.status)}</td><th scope="row">${esc(check.label)}${check.basis?`<p class="small">計算根拠：${esc(check.basis)}</p>`:''}</th><td class="num">${num(check.reference)}</td><td class="num">${num(check.calculated)}</td><td class="num${finite(check.difference)&&check.difference!==0?' audit-difference':''}">${num(check.difference)}</td><td><p>${esc(reason)}</p>${check.periodBasis?`<p class="small">利益累計の期間：${esc(check.periodBasis.start||'未確定')}〜${esc(check.periodBasis.end||'未確定')} ／ BS期首月 ${esc(check.periodBasis.openingMonth||'未確定')}</p>`:''}${proofsHTML(check.rows,state,'check:'+index)}</td></tr>`;
}
function checksHTML(audit,state,open=!!audit.summary.difference){
 const selected=state.checks,page=bounds(selected.length,state.pages.checks);state.pages.checks=page.page;clearProofs(state,'check:');
 return `<details class="audit-details" data-audit-block="checks"${open?' open':''}><summary>差額・判定保留の詳細（${num(selected.length)}件）</summary><p class="small">金額は円単位。—は金額未確定です。判定保留の数値差は、資料や条件を確定してから評価します。画面は50件ずつ表示し、照合結果CSVは一致を含む全件を保存します。</p>${selected.length?`${pager('checks',selected.length,page.page,'確認項目')}<div class="tablewrap"><table class="datatable audit-checks"><thead><tr><th scope="col">月・状態</th><th scope="col">確認内容</th><th scope="col" class="num">帳票・基準</th><th scope="col" class="num">照合計算</th><th scope="col" class="num">計算−基準</th><th scope="col">理由・根拠・次の確認</th></tr></thead><tbody>${selected.slice(page.start,page.end).map((c,i)=>checkHTML(c,state,page.start+i)).join('')}</tbody></table></div>`:'<p>読込範囲内の算術・照合条件では差額や判定保留がありません。資料の実在性・全取引の網羅性は別途確認します。</p>'}</details>`;
}
function comparisonsHTML(state){
 const comparisons=state.comparisons,page=bounds(comparisons.length,state.pages.comparisons);state.pages.comparisons=page.page;if(!comparisons.length)return '';
 return `<div data-audit-block="comparisons">${pager('comparisons',comparisons.length,page.page,'振替候補の照合')}<div class="tablewrap"><table class="datatable"><caption>振替の扱いによる照合計算の違い（候補・円）</caption><thead><tr><th scope="col">月・科目</th><th scope="col" class="num">BS帳票</th><th scope="col" class="num">期首＋全仕訳</th><th scope="col" class="num">振替の影響</th><th scope="col" class="num">振替を含めない候補計算</th><th scope="col">状態</th></tr></thead><tbody>${comparisons.slice(page.start,page.end).map(c=>`<tr><th scope="row">${esc(c.month)} ${esc(c.account)}</th><td class="num">${num(c.reference)}</td><td class="num">${num(c.openingTransfer.rawCalculated)}</td><td class="num">${num(c.openingTransfer.movement)}</td><td class="num">${num(c.openingTransfer.withoutTransfer)}</td><td><span class="badge warn">基準確認待ち</span><p class="small">${c.openingTransfer.candidateMatched?'振替を含めない候補計算は帳票に一致。BS期首の基準を確認します。':'候補計算も含め、BS期首の基準を確認します。'}</p></td></tr>`).join('')}</tbody></table></div></div>`;
}
function transfersHTML(audit,model,state,open=true){
 if(!audit.openingTransfers?.length)return '';
 if(!state.comparisons)state.comparisons=(model.comparisons||[]).filter(c=>c.openingTransfer);
 const rows=audit.openingTransfers,page=bounds(rows.length,state.pages.transfers);state.pages.transfers=page.page;clearProofs(state,'transfer:');
 return `<details class="audit-details audit-transfers" data-audit-block="transfers"${open?' open':''}><summary>期首振替とBS期首の基準（${num(rows.length)}仕訳）</summary><p class="small">BS期首が元入金・事業主勘定等の振替の前／後かを確認します。候補の仕訳と計算を残し、確認するまで判定を保留します。</p>${pager('transfers',rows.length,page.page,'期首振替仕訳')}<div class="tablewrap"><table class="datatable"><thead><tr><th scope="col">日付・仕訳番号</th><th scope="col">科目と増減（円）</th><th scope="col">確認理由・元CSV</th></tr></thead><tbody>${rows.slice(page.start,page.end).map((t,i)=>`<tr><th scope="row">${esc(t.date)}<br>仕訳 ${esc(t.id||'未確定')}</th><td>${Object.entries(t.movements||{}).map(([a,v])=>`${esc(a)}：${num(v)}円`).join('<br>')}</td><td>${esc(t.reason)}${proofsHTML(t.rows,state,'transfer:'+(page.start+i))}</td></tr>`).join('')}</tbody></table></div>${comparisonsHTML(state)}</details>`;
}
function sourcesHTML(session,state,open=false){
 const files=state.files||(state.files=sourceFiles(session)),page=bounds(files.length,state.pages.sources);state.pages.sources=page.page;
 return `<details class="audit-details audit-sources" data-audit-block="sources"${open?' open':''}><summary>読込資料と対象期間（${num(files.length)}資料）</summary>${pager('sources',files.length,page.page,'資料')}<div class="tablewrap"><table class="datatable"><thead><tr><th scope="col">資料・取込先</th><th scope="col" class="num">読込データ行</th><th scope="col" class="num">読取エラー・除外行</th><th scope="col">読込データの期間</th><th scope="col">資料に記載された期間・事業者</th></tr></thead><tbody>${files.length?files.slice(page.start,page.end).map(g=>`<tr><th scope="row">${esc(g.name)}<br><span class="small">${esc(TYPES[g.type]||g.type)}</span></th><td class="num">${num(g.count)}</td><td class="num">${num(g.errors)}</td><td>${esc(g.period)}</td><td>${esc(g.sourcePeriod)}<br><span class="small">事業者：${esc(g.entities.length?g.entities.join('／'):'資料内の事業者情報なし')}</span></td></tr>`).join(''):'<tr><td colspan="5">資料が未読込です。当期仕訳帳とBS・PLを読み込みます。</td></tr>'}</tbody></table></div><p class="small">BS・PLの読込データ行は「科目×月」の金額セルを含み、元CSVの物理行数とは異なります。期間情報・事業者が資料にない場合は、会社設定やファイル名から確定しません。</p></details>`;
}
function panel(session,model){
 const audit=auditFor(session,model),state=stateFor(session,model,audit),s=audit.summary,bsRows=(model.bs||[]).flatMap(g=>g.tagReports||[]),hasPartyOpening=bsRows.some(r=>r.date===F.prevMonth(model.months[0])&&r.tagDimension==='party'&&Number.isSafeInteger(r.amount)&&r.unit===1&&!r.importErrors);
 return `<section class="panel monthly-panel audit-panel" id="auditIntegrity" aria-labelledby="auditIntegrityTitle"><div class="panelhead"><div><h2 id="auditIntegrityTitle">資料の読込範囲と数値照合</h2><span class="small">未読込・条件不足・数値差を、根拠の資料に戻って確認します。</span></div><button class="btn small" data-audit-export="1">照合結果CSV</button></div><div class="panelbody"><div class="audit-summary"><div><span>一致（読込範囲内）</span><strong>${num(s.agree)}<small> 件</small></strong></div><div class="${s.difference?'audit-summary-difference':''}"><span>差額あり</span><strong>${num(s.difference)}<small> 件</small></strong></div><div class="${s.pending?'audit-summary-pending':''}"><span>判定保留</span><strong>${num(s.pending)}<small> 件</small></strong></div></div><p class="small audit-scope">${esc(audit.scope||'数値一致は、読込資料内の算術と指定条件の照合結果です。')}</p>${audit.outsideRows?`<p class="notice">対象期間外の当期仕訳 ${num(audit.outsideRows)}行（${esc((audit.outsideMonths||[]).join('・'))}）。取込先と対象期間を確認してください。</p>`:''}${coverageHTML(audit)}<div class="notice audit-opening-note"><strong>科目合計の期首と、取引先別の期首は別の情報です。</strong><p>BSに科目の期首残高があれば、科目全体の月末残高・仕訳増減の照合に使います。${hasPartyOpening?'一部の取引先に対応する期首・前期末の内訳があります。内訳のない取引先は未確定のまま扱い、確認できる期首と連続する仕訳から月末残高を計算します。':'取引先別の期首がないBSからは、科目の残高を取引先ごとに分けることはできません。'}前期仕訳からの推計は仮定を含むため、確定残高とは区別します。当月増減・累計増減・期首の未配賦を表示して確認できます。</p></div>${transfersHTML(audit,model,state)}${checksHTML(audit,state)}${sourcesHTML(session,state)}</div></section>`;
}
function csv(audit){
 const q=v=>{if(finite(v))return String(v);const s=v===null||v===undefined?'':String(v),safe=/^[=+\-@\t\r]/.test(s)?"'"+s:s;return '"'+safe.replace(/"/g,'""')+'"';};
 const rows=[['月','確認種別','確認内容','状態','帳票・基準（円）','照合計算（円）','計算−基準（円）','理由','計算根拠','元CSV・行番号']];
 for(const c of audit.checks)rows.push([c.month||'',c.kind,c.label,statusLabel(c.status),c.reference,c.calculated,c.difference,c.reason||(c.reasons||[]).join(' '),c.basis||'',evidence(c.rows).join('／')]);
 return '\uFEFF'+rows.map(row=>row.map(q).join(',')).join('\r\n');
}
function pageFor(session,model,kind,page,token='',open){
 const audit=auditFor(session,model),state=stateFor(session,model,audit);if(!Number.isSafeInteger(page))return '';
 if(kind==='proof'){if(!state.proofRows.has(token))return '';state.proofPages.set(token,Math.max(0,page));return proofsHTML(state.proofRows.get(token),state,token,open!==false);}
 if(!Object.hasOwn(state.pages,kind))return '';state.pages[kind]=Math.max(0,page);
 if(kind==='checks')return checksHTML(audit,state,open);
 if(kind==='transfers')return transfersHTML(audit,model,state,open);
 if(kind==='comparisons'){if(!state.comparisons)state.comparisons=(model.comparisons||[]).filter(c=>c.openingTransfer);return comparisonsHTML(state);}
 return sourcesHTML(session,state,open);
}
let current=null;
F.page=function(session,result,focus){
 const html=originalPage.call(this,session,result,focus),model=result?.financial;
 current=model?{session,model}:null;if(!model)return html;
 const add=panel(session,model),at=html.indexOf('<section class="panel monthly-panel"');
 return at<0?html+add:html.slice(0,at)+add+html.slice(at);
};
// 印刷では、ページ分けした一覧を全件で出す（開いていた根拠の欄は開いたまま）。終われば表示中のページに戻す。
function printMode(on){
 const c=document.getElementById('auditIntegrity');if(!c||!current||on===printing||on&&document.documentElement.classList.contains('printing-stmt'))return;
 printing=on;const st=stateFor(current.session,current.model,auditFor(current.session,current.model)),open=[...c.querySelectorAll('details[data-audit-proof][open]')].map(d=>d.dataset.auditProof);
 for(const kind of ['checks','transfers','comparisons','sources']){const node=c.querySelector(`[data-audit-block="${kind}"]`);if(!node)continue;const html=pageFor(current.session,current.model,kind,st.pages[kind]||0,'',node.tagName==='DETAILS'?node.open:undefined);if(html)node.outerHTML=html;}
 for(const t of open){const d=c.querySelector(`details[data-audit-proof="${CSS.escape(t)}"]`);if(d)d.open=true;}
}
if(typeof document!=='undefined'){root.addEventListener?.('beforeprint',()=>printMode(true));root.addEventListener?.('afterprint',()=>printMode(false));}
if(typeof document!=='undefined')document.addEventListener('click',e=>{
 const pageButton=e.target.closest?.('[data-audit-page]');
 if(pageButton&&current){
  const kind=pageButton.dataset.auditPage,page=Number(pageButton.dataset.auditTargetPage),token=pageButton.dataset.auditProofKey||'',container=document.getElementById('auditIntegrity');
  if(pageButton.disabled||!container||!Number.isSafeInteger(page))return;
  const selector=kind==='proof'?/^(?:check|transfer):\d+$/.test(token)?`details[data-audit-proof="${token}"]`:null:['checks','transfers','comparisons','sources'].includes(kind)?`[data-audit-block="${kind}"]`:null;
  if(!selector)return;const node=container.querySelector(selector);if(!node)return;
  const html=pageFor(current.session,current.model,kind,page,token,node.tagName==='DETAILS'?node.open:undefined);if(!html)return;
  const scroll=[...node.querySelectorAll('.tablewrap')].map(n=>({left:n.scrollLeft,top:n.scrollTop})),direction=pageButton.dataset.auditDirection;
  node.outerHTML=html;const replacement=container.querySelector(selector);if(!replacement)return;
  [...replacement.querySelectorAll('.tablewrap')].forEach((n,i)=>{if(scroll[i]){n.scrollLeft=scroll[i].left;n.scrollTop=scroll[i].top;}});
  const focus=direction==='prev'||direction==='next'?replacement.querySelector(`[data-audit-page="${kind}"][data-audit-direction="${direction}"]:not([disabled])`):null;
  (focus||replacement.querySelector(`[data-audit-range="${kind}"]`)||replacement.querySelector('summary'))?.focus({preventScroll:true});
  return;
 }
 const b=e.target.closest?.('[data-audit-export]');if(!b||!current)return;
 const audit=auditFor(current.session,current.model),blob=new Blob([csv(audit)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download='数値照合_'+current.session.project.start+'_'+current.session.project.end+'.csv';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
root.ReviewAuditUI={panel,sourceFiles,csv,pageFor,version:3};
})(typeof window!=='undefined'?window:globalThis);

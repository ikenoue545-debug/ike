
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
function checkHTML(check){
 const refs=evidence(check.rows),reason=check.reason||check.reasons?.join(' ')|| (check.status==='difference'?'帳票と計算の金額差を確認します。':'計算に必要な資料・照合条件を確認します。');
 return `<tr data-audit-check="${esc(check.id)}"><td>${esc(check.month||'期間全体')}<br>${badge(check.status)}</td><th scope="row">${esc(check.label)}${check.basis?`<p class="small">計算根拠：${esc(check.basis)}</p>`:''}</th><td class="num">${num(check.reference)}</td><td class="num">${num(check.calculated)}</td><td class="num${finite(check.difference)&&check.difference!==0?' audit-difference':''}">${num(check.difference)}</td><td><p>${esc(reason)}</p>${check.periodBasis?`<p class="small">利益累計の期間：${esc(check.periodBasis.start||'未確定')}〜${esc(check.periodBasis.end||'未確定')} ／ BS期首月 ${esc(check.periodBasis.openingMonth||'未確定')}</p>`:''}${refs.length?`<details class="audit-evidence"><summary>根拠の元CSV・行番号（${refs.length}件）</summary><ul>${refs.map(s=>`<li>${esc(s)}</li>`).join('')}</ul></details>`:'<span class="small">対応する元CSVの行は未確定です。</span>'}</td></tr>`;
}
function checksHTML(audit){
 const selected=audit.checks.filter(c=>c.status!=='agree').sort((a,b)=>(a.status==='difference'?0:1)-(b.status==='difference'?0:1)||String(a.month||'').localeCompare(String(b.month||'')));
 return `<details class="audit-details"${audit.summary.difference?' open':''}><summary>差額・判定保留の詳細（${selected.length}件）</summary><p class="small">金額は円単位。—は金額未確定です。判定保留の数値差は、資料や条件を確定してから評価します。</p>${selected.length?`<div class="tablewrap"><table class="datatable audit-checks"><thead><tr><th scope="col">月・状態</th><th scope="col">確認内容</th><th scope="col" class="num">帳票・基準</th><th scope="col" class="num">照合計算</th><th scope="col" class="num">計算−基準</th><th scope="col">理由・根拠・次の確認</th></tr></thead><tbody>${selected.map(checkHTML).join('')}</tbody></table></div>`:'<p>読込範囲内の算術・照合条件では差額や判定保留がありません。資料の実在性・全取引の網羅性は別途確認します。</p>'}</details>`;
}
function transfersHTML(audit,model){
 if(!audit.openingTransfers?.length)return '';
 const comparisons=(model.comparisons||[]).filter(c=>c.openingTransfer);
 return `<details class="audit-details audit-transfers" open><summary>期首振替とBS期首の基準（${audit.openingTransfers.length}仕訳）</summary><p class="small">BS期首が元入金・事業主勘定等の振替の前／後かを確認します。候補の仕訳と計算を残し、確認するまで判定を保留します。</p><div class="tablewrap"><table class="datatable"><thead><tr><th scope="col">日付・仕訳番号</th><th scope="col">科目と増減（円）</th><th scope="col">確認理由・元CSV</th></tr></thead><tbody>${audit.openingTransfers.map(t=>`<tr><th scope="row">${esc(t.date)}<br>仕訳 ${esc(t.id||'未確定')}</th><td>${Object.entries(t.movements||{}).map(([a,v])=>`${esc(a)}：${num(v)}円`).join('<br>')}</td><td>${esc(t.reason)}<p class="small">${evidence(t.rows).map(esc).join('<br>')||'元CSVの行は未確定です。'}</p></td></tr>`).join('')}</tbody></table></div>${comparisons.length?`<div class="tablewrap"><table class="datatable"><caption>振替の扱いによる照合計算の違い（候補・円）</caption><thead><tr><th scope="col">月・科目</th><th scope="col" class="num">BS帳票</th><th scope="col" class="num">期首＋全仕訳</th><th scope="col" class="num">振替の影響</th><th scope="col" class="num">振替を含めない候補計算</th><th scope="col">状態</th></tr></thead><tbody>${comparisons.map(c=>`<tr><th scope="row">${esc(c.month)} ${esc(c.account)}</th><td class="num">${num(c.reference)}</td><td class="num">${num(c.openingTransfer.rawCalculated)}</td><td class="num">${num(c.openingTransfer.movement)}</td><td class="num">${num(c.openingTransfer.withoutTransfer)}</td><td><span class="badge warn">基準確認待ち</span><p class="small">${c.openingTransfer.candidateMatched?'振替を含めない候補計算は帳票に一致。BS期首の基準を確認します。':'候補計算も含め、BS期首の基準を確認します。'}</p></td></tr>`).join('')}</tbody></table></div>`:''}</details>`;
}
function sourcesHTML(session){
 const files=sourceFiles(session);
 return `<details class="audit-details audit-sources"><summary>読込資料と対象期間（${files.length}資料）</summary><div class="tablewrap"><table class="datatable"><thead><tr><th scope="col">資料・取込先</th><th scope="col" class="num">読込データ行</th><th scope="col" class="num">読取エラー・除外行</th><th scope="col">読込データの期間</th><th scope="col">資料に記載された期間・事業者</th></tr></thead><tbody>${files.length?files.map(g=>`<tr><th scope="row">${esc(g.name)}<br><span class="small">${esc(TYPES[g.type]||g.type)}</span></th><td class="num">${num(g.count)}</td><td class="num">${num(g.errors)}</td><td>${esc(g.period)}</td><td>${esc(g.sourcePeriod)}<br><span class="small">事業者：${esc(g.entities.length?g.entities.join('／'):'資料内の事業者情報なし')}</span></td></tr>`).join(''):'<tr><td colspan="5">資料が未読込です。当期仕訳帳とBS・PLを読み込みます。</td></tr>'}</tbody></table></div><p class="small">BS・PLの読込データ行は「科目×月」の金額セルを含み、元CSVの物理行数とは異なります。期間情報・事業者が資料にない場合は、会社設定やファイル名から確定しません。</p></details>`;
}
function panel(session,model){
 const audit=model.audit||A.inspect(session,model),s=audit.summary,bsRows=(model.bs||[]).flatMap(g=>g.tagReports||[]),hasPartyOpening=bsRows.some(r=>r.date===F.prevMonth(model.months[0])&&r.tagDimension==='party'&&Number.isSafeInteger(r.amount)&&r.unit===1&&!r.importErrors);
 return `<section class="panel monthly-panel audit-panel" id="auditIntegrity" aria-labelledby="auditIntegrityTitle"><div class="panelhead"><div><h2 id="auditIntegrityTitle">資料の読込範囲と数値照合</h2><span class="small">未読込・条件不足・数値差を、根拠の資料に戻って確認します。</span></div><button class="btn small" data-audit-export="1">照合結果CSV</button></div><div class="panelbody"><div class="audit-summary"><div><span>一致（読込範囲内）</span><strong>${num(s.agree)}<small> 件</small></strong></div><div class="${s.difference?'audit-summary-difference':''}"><span>差額あり</span><strong>${num(s.difference)}<small> 件</small></strong></div><div class="${s.pending?'audit-summary-pending':''}"><span>判定保留</span><strong>${num(s.pending)}<small> 件</small></strong></div></div><p class="small audit-scope">${esc(audit.scope||'数値一致は、読込資料内の算術と指定条件の照合結果です。')}</p>${audit.outsideRows?`<p class="notice">対象期間外の当期仕訳 ${num(audit.outsideRows)}行（${esc((audit.outsideMonths||[]).join('・'))}）。取込先と対象期間を確認してください。</p>`:''}${coverageHTML(audit)}<div class="notice audit-opening-note"><strong>科目合計の期首と、取引先別の期首は別の情報です。</strong><p>BSに科目の期首残高があれば、科目全体の月末残高・仕訳増減の照合に使います。${hasPartyOpening?'一部の取引先に対応する期首・前期末の内訳があります。内訳のない取引先は未確定のまま扱い、確認できる期首と連続する仕訳から月末残高を計算します。':'取引先別の期首がないBSから、AYA等の取引先への配分は確定できません。'}前期仕訳からの推計は仮定を含むため、確定残高とは区別します。当月増減・累計増減・期首の未配賦を表示して確認できます。</p></div>${transfersHTML(audit,model)}${checksHTML(audit)}${sourcesHTML(session)}</div></section>`;
}
function csv(audit){
 const q=v=>{if(finite(v))return String(v);const s=v===null||v===undefined?'':String(v),safe=/^[=+\-@\t\r]/.test(s)?"'"+s:s;return '"'+safe.replace(/"/g,'""')+'"';};
 const rows=[['月','確認種別','確認内容','状態','帳票・基準（円）','照合計算（円）','計算−基準（円）','理由','計算根拠','元CSV・行番号']];
 for(const c of audit.checks)rows.push([c.month||'',c.kind,c.label,statusLabel(c.status),c.reference,c.calculated,c.difference,c.reason||(c.reasons||[]).join(' '),c.basis||'',evidence(c.rows).join('／')]);
 return '\uFEFF'+rows.map(row=>row.map(q).join(',')).join('\r\n');
}
let current=null;
F.page=function(session,result,focus){
 const html=originalPage.call(this,session,result,focus),model=result?.financial;
 current=model?{session,model}:null;if(!model)return html;
 const add=panel(session,model),at=html.indexOf('<section class="panel monthly-panel"');
 return at<0?html+add:html.slice(0,at)+add+html.slice(at);
};
if(typeof document!=='undefined')document.addEventListener('click',e=>{
 const b=e.target.closest?.('[data-audit-export]');if(!b||!current)return;
 const audit=current.model.audit||A.inspect(current.session,current.model),blob=new Blob([csv(audit)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download='数値照合_'+current.session.project.start+'_'+current.session.project.end+'.csv';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
root.ReviewAuditUI={panel,sourceFiles,csv,version:1};
})(typeof window!=='undefined'?window:globalThis);

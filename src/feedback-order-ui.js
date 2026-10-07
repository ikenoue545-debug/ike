(function(root){
'use strict';
// 「対応の順番」の画面：確認キューの上の段階表示・次にやること・段階ごとの一覧、月次画面の小さな欄、書き出し（コピー・CSV・印刷）。
const FO=root.ReviewFeedbackOrder,F=root.ReviewFinancial;
if(!FO)throw Error('ReviewFeedbackOrderUI requires ReviewFeedbackOrder.');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf=new Intl.NumberFormat('ja-JP'),yen=n=>nf.format(Math.round(n||0))+'円';
const DEC={resolved:'確認済み',ask:'お客様・上司へ確認',defer:'今回深追いせず'};
const KEY='jikeika-review:feedback-order';
const state={ordered:true,open:{}};
try{const v=root.localStorage?.getItem(KEY);if(v==='flat')state.ordered=false;}catch{}
function ordered(){return state.ordered;}
function setOrdered(v){state.ordered=!!v;try{root.localStorage?.setItem(KEY,state.ordered?'ordered':'flat');}catch{}}
const actorBadge=a=>`<span class="fo-actor fo-actor-${esc(a)}">${esc(FO.ACTORS[a]||'')}</span>`;
const statusBadge=s=>`<span class="badge ${s==='done'?'ok':s==='asking'?'warn':''}">${esc(FO.STATUS[s]||'')}</span>`;
const meta=session=>({name:session?.project?.name||'',period:session?.project?.start?`${FO.monthSpan([session.project.start,session.project.end])}`:''});
function amountText(it){
 if(it.materials)return '';const parts=[];
 if(it.amount)parts.push(FO.amountLabel(it));
 const span=FO.monthSpan(it.months);if(span)parts.push(span);
 return parts.join('・');
}
// ---- 確認キューの上：段階表示と「次にやること」
function steps(b){
 const cur=b.stages.find(s=>s.open)?.no||0;
 return `<ol class="fo-steps">${b.stages.map(s=>{const done=s.total-s.open,pct=s.total?Math.round(done/s.total*100):0,cls=[s.no===cur?'is-current':'',s.total&&!s.open?'is-done':'',!s.total?'is-empty':''].filter(Boolean).join(' ');
  return `<li><button type="button" class="fo-step ${cls}" data-action="foStage" data-stage="${s.no}" title="${esc(s.purpose)}" aria-label="段階${s.no} ${esc(s.name)}：未対応 ${s.open}件／全 ${s.total}件"${s.no===cur?' aria-current="step"':''}><span class="fo-no">${s.total&&!s.open?'✓':s.no}</span><span class="fo-stepname">${esc(s.name)}</span><span class="fo-count"><strong>${s.open}</strong> / ${s.total}<span class="fo-unit">件</span></span><span class="fo-bar" aria-hidden="true"><span style="width:${pct}%"></span></span></button></li>`;}).join('')}</ol>`;
}
function nextCard(b){
 const it=b.next;
 if(!it)return `<div class="fo-next is-empty"><div class="fo-nextlabel">次にやること</div><p class="fo-nextdo">${b.items.length?'すべての項目に対応しました。確認中の項目は、お客様の回答を待っています。':'いまの資料と条件では、対応する項目はありません。'}</p></div>`;
 const st=FO.STAGES[it.stage-1],amt=amountText(it),step=(it.steps||[])[0]||'';
 const btn=it.materials?`<button class="btn primary small" data-view="data">資料の読込へ</button>`:`<button class="btn primary small" data-finding="${esc(it.lead.id)}">この指摘を開く</button>`;
 return `<div class="fo-next"><div class="fo-nextlabel">次にやること</div><div class="fo-nextbody"><div class="fo-nextmeta"><span class="fo-stagechip">段階${it.stage}　${esc(st.name)}</span>${actorBadge(it.actor)}${it.status==='asking'?statusBadge('asking'):''}</div><strong class="fo-nexttitle">${esc(it.account&&!String(it.title).startsWith(it.account)?it.account+'：':'')}${esc(it.title)}</strong><p class="fo-nextdo">${esc(FO.ACTOR_DO[it.actor]||'')}。${step?`<span class="fo-nextstep">最初に確認すること：${esc(step)}</span>`:''}</p><div class="fo-nextfoot"><span class="small">${esc(amt)}${it.findings.length>1?`${amt?'・':''}関連${it.findings.length}件`:''}</span>${btn}</div></div></div>`;
}
function goneNotice(session){
 const gone=session?.manual?.feedbackSnapshot?.gone;if(!Array.isArray(gone)||!gone.length)return '';
 const asked=gone.filter(t=>t.status==='ask'),other=gone.length-asked.length;
 const list=(asked.length?asked:gone).slice(0,8);
 return `<div class="notice fo-gone"><strong>${asked.length?`前回お客様に確認していた ${asked.length}件`:`前回未対応だった ${gone.length}件`}が、資料を読み直したあとの分析では出てきません。解消した可能性があります。</strong><ul>${list.map(t=>`<li>${esc(t.label||t.topic)}</li>`).join('')}${(asked.length?asked:gone).length>list.length?`<li>ほか ${(asked.length?asked:gone).length-list.length}件</li>`:''}</ul>${asked.length&&other?`<p class="small">ほかに、未対応だった ${other}件も出てきませんでした。</p>`:''}<button class="btn small" data-action="foClearGone">確認しました（表示を消す）</button></div>`;
}
function exportBox(kind,b,session){
 const list=kind==='client'?b.clientList:b.officeList,title=kind==='client'?'お客様への確認リスト':'事務所の作業リスト';
 const note=kind==='client'?'資料の依頼・お客様への質問・修正のお願いを、対応の順番に並べています（完了した項目は除きます）。':'事務所で照合・判断する項目です（完了した項目は除きます）。';
 const text=kind==='client'?FO.clientText(list,meta(session)):FO.officeText(list,meta(session));
 return `<details class="fo-export" data-fo-export="${kind}"${state.open[kind]?' open':''}><summary>${esc(title)}<span class="fo-exportn">${list.length}件</span></summary><div class="fo-exportbody"><p class="small">${esc(note)}</p><pre class="fo-preview" tabindex="0" aria-label="${esc(title)}の内容">${esc(text)}</pre><div class="fo-exportacts"><button class="btn small" data-action="foCopy" data-kind="${kind}">コピー</button><button class="btn small" data-action="foCsv" data-kind="${kind}">CSVで保存</button><button class="btn small" data-action="foPrint" data-kind="${kind}">印刷</button></div></div></details>`;
}
function header(session,result){
 const b=FO.build(session,result),open=b.items.filter(i=>i.status!=='done').length;
 return `<section class="panel fo-order" aria-labelledby="foTitle"><div class="panelhead"><h2 id="foTitle">対応の順番</h2><span class="small">未対応 ${open}件／全 ${b.items.length}件（同じ論点はまとめて数えています）</span></div><div class="fo-orderbody">${steps(b)}${nextCard(b)}${goneNotice(session)}<div class="fo-exports">${exportBox('client',b,session)}${exportBox('office',b,session)}</div></div></section>`;
}
function toggle(){return `<button type="button" class="fo-toggle" data-action="foToggle" aria-pressed="${state.ordered}"><span class="fo-switch" aria-hidden="true"></span>順番どおりに並べる</button>`;}
// 指摘の行に足す札（誰が動くか・関連件数）
function rowBadges(it){if(!it)return '';return actorBadge(it.actor)+(it.provisional?`<span class="fo-provtag" title="${esc(provText(it.provisional))}">暫定</span>`:'')+(it.findings.length>1?`<span class="fo-rel">関連${it.findings.length}件</span>`:'');}
const provText=p=>`先に「${p.name}」の ${p.count}件を片付けると、結果が変わる可能性があります。`;
function carryHTML(it){
 const p=it?.carried;if(!p)return '';const note=p.note.trim().replace(/\s+/g,' ');
 return `<div class="fo-carry"><span>前回：${esc(DEC[p.status]||p.status)}${note?`（${esc(note.length>60?note.slice(0,60)+'…':note)}）`:''}${p.period?`<span class="small">　${esc(p.period)}</span>`:''}</span><button class="btn small" data-action="foUsePrev" data-topic="${esc(it.topic)}">前回の判断を使う</button></div>`;
}
function carryFor(session,result,f){const it=FO.build(session,result).byId.get(f.id);return it&&it.lead===f?carryHTML(it):'';}
function materialRow(it){
 return `<div class="finding fo-material"><span class="flag info">?</span><span class="findingbody"><span class="findingtitle">${esc(it.title)}</span><span class="findingmeta">${actorBadge(it.actor)}${statusBadge(it.status)}</span><span class="findingtext">${esc(it.reason)}</span></span><span class="findingamount"><button class="btn small" data-view="data">資料の読込へ</button></span></div>`;
}
// 段階ごとの一覧。rows は絞り込み・検索を通った指摘、rowFn(f,item) は確認キューの行
function list(session,result,rows,rowFn,opt={}){
 const b=FO.build(session,result),show=new Set(rows.map(f=>f.id)),limit=opt.limit||200;let n=0,out='';
 const q=String(opt.search||''),mat=it=>(opt.filter==='all'||opt.filter==='open'||opt.filter==='info'||!opt.filter)&&(!q||`${it.title} ${it.reason}`.includes(q));
 for(const s of b.stages){
  const xs=[];for(const it of s.items){if(n>=limit)break;if(it.materials?mat(it):it.findings.some(f=>show.has(f.id))){xs.push(it);n++;}}
  if(!xs.length)continue;
  out+=`<div class="fo-stage" id="foStage${s.no}"><div class="fo-stagehead"><span class="fo-no">${s.no}</span><div class="fo-stagetitle"><h3>${esc(s.name)}</h3><p>${esc(s.purpose)}</p></div><span class="fo-stagecount">未対応 <strong>${s.open}</strong> / ${s.total}</span></div>`;
  // 先に片付ける段階の注意は、段階の見出しに1回だけ出す（項目には「暫定」の札）
  const pv=xs.find(i=>i.provisional)?.provisional;if(pv)out+=`<p class="fo-stageprov">暫定：${esc(provText(pv))}</p>`;
  for(const it of xs){
   if(it.materials){out+=`<div class="fo-item">${materialRow(it)}</div>`;continue;}
   const fs=it.findings.filter(f=>show.has(f.id)),lead=fs[0],rest=fs.slice(1);
   out+=`<div class="fo-item${it.status==='done'?' is-done':''}">${rowFn(lead,it)}${carryHTML(it)}${rest.length?`<details class="fo-related"${rest.some(f=>f.id===opt.selected)?' open':''}><summary>同じ論点の指摘をあと ${rest.length}件表示</summary>${rest.map(f=>rowFn(f,null)).join('')}</details>`:''}</div>`;
  }
  out+='</div>';
 }
 return out;
}
function scrollToStage(no){const el=root.document?.getElementById('foStage'+no);if(!el)return false;el.scrollIntoView({block:'start',behavior:root.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});return true;}
// ---- 書き出し
function exportList(kind,session,result){const b=FO.build(session,result);return kind==='office'?b.officeList:b.clientList;}
function exportText(kind,session,result){const l=exportList(kind,session,result);return kind==='office'?FO.officeText(l,meta(session)):FO.clientText(l,meta(session));}
function exportCSV(kind,session,result){return FO.csv(exportList(kind,session,result));}
function fileName(kind,session){const p=session?.project||{};return `${kind==='office'?'事務所の作業リスト':'お客様への確認リスト'}_${p.start||''}_${p.end||''}.csv`;}
function printHTML(kind,session,result){
 const l=exportList(kind,session,result),m=meta(session),client=kind!=='office',title=client?'お客様への確認のお願い':'事務所の作業リスト';
 const today=new Date(),d=`${today.getFullYear()}年${today.getMonth()+1}月${today.getDate()}日`;
 const rows=l.map((x,i)=>client?`<tr><td class="num">${i+1}</td><td>${esc(x.text)}</td><td class="fo-answer"></td></tr>`:`<tr><td class="num">${i+1}</td><td>${x.stage} ${esc(x.stageName)}</td><td>${esc(x.account)}${x.party?'<br>'+esc(x.party):''}</td><td>${esc(x.title)}${x.step?`<br><span>次に確認すること：${esc(x.step)}</span>`:''}</td><td class="num">${esc(x.amountLabel||'')}</td><td class="fo-answer"></td></tr>`).join('');
 const head=client?'<tr><th>番号</th><th>確認したいこと</th><th>ご回答</th></tr>':'<tr><th>番号</th><th>段階</th><th>科目・相手</th><th>内容</th><th>金額</th><th>済</th></tr>';
 return `<h1>${esc(title)}</h1><p>${esc([m.name,m.period].filter(Boolean).join('　'))}　${esc(d)}作成</p>${l.length?`<table>${'<thead>'+head+'</thead>'}<tbody>${rows}</tbody></table>`:'<p>現在、該当する項目はありません。</p>'}`;
}
function print(kind,session,result,opt={}){
 const doc=root.document;if(!doc)return;doc.getElementById('foPrint')?.remove();
 const host=doc.createElement('div');host.id='foPrint';host.className=kind==='office'?'fo-print-office':'fo-print-client';host.innerHTML=printHTML(kind,session,result);doc.body.appendChild(host);
 doc.documentElement.classList.add('fo-printing');
 const done=()=>{doc.documentElement.classList.remove('fo-printing');host.remove();root.removeEventListener?.('afterprint',done);};
 if(opt.dryRun)return done;
 root.addEventListener?.('afterprint',done);root.print?.();
}
// ---- 月次PL・BS画面の欄
function panel(session,result){
 const b=FO.build(session,result),cur=b.stages.find(s=>s.open)?.no||0;
 const next=b.items.filter(i=>i.status==='open').slice(0,3);
 const counts=`<ol class="fo-mini">${b.stages.map(s=>`<li class="${s.no===cur?'is-current':''}${s.total&&!s.open?' is-done':''}"><span class="fo-no">${s.no}</span><span class="fo-mininame">${esc(s.name)}</span><span class="fo-minicount"><strong>${s.open}</strong>/${s.total}</span></li>`).join('')}</ol>`;
 const rows=next.map((it,i)=>{const label=`${it.account&&!String(it.title).startsWith(it.account)?it.account+'：':''}${it.title}`,amt=amountText(it);
  const attr=it.materials?'data-view="data"':`data-month-finding="${esc(it.lead.id)}"`;
  return `<button class="fo-nextrow" ${attr}><span class="fo-nextno">${i+1}</span><span class="fo-nextmain"><span class="fo-nextmeta"><span class="fo-stagechip">段階${it.stage}</span>${actorBadge(it.actor)}</span><strong>${esc(label)}</strong>${amt?`<span class="small">${esc(amt)}</span>`:''}</span></button>`;}).join('');
 return `<section class="panel monthly-panel fo-mpanel" id="feedbackOrder" aria-labelledby="feedbackOrderTitle"><div class="panelhead"><h2 id="feedbackOrderTitle">対応の順番</h2><button class="btn small" data-view="review">確認キューで開く</button></div><div class="panelbody"><p class="small fo-mlead">確認候補を「資料をそろえる」から順に片付けます。数字は未対応／全体（同じ論点はまとめて数えています）。</p>${counts}<h3 class="fo-mh">次にやること</h3>${rows?`<div class="fo-next3">${rows}</div>`:`<p class="small">${b.items.length?'未対応の項目はありません。':'いまの資料と条件では、対応する項目はありません。'}</p>`}</div></section>`;
}
if(F&&typeof F.page==='function'){
 const originalPage=F.page;
 F.page=function(session,result,focus){
  const html=originalPage.call(this,session,result,focus);if(!result?.financial)return html;
  // 「今見るべき科目」（月次の確認候補）の直前に置く。見つからなければ月次PLの前、それもなければ末尾
  const add=panel(session,result),h=html.indexOf('<h2>今見るべき科目</h2>');
  let at=h<0?-1:html.lastIndexOf('<section',h);if(at<0)at=html.indexOf('<section class="panel monthly-panel" data-stmt=');
  return at<0?html+add:html.slice(0,at)+add+html.slice(at);
 };
}
if(typeof document!=='undefined'){
 // 書き出しの開閉は、画面を描き直しても保つ
 document.addEventListener('toggle',e=>{const d=e.target;if(d?.matches?.('details[data-fo-export]'))state.open[d.dataset.foExport]=d.open;},true);
}
root.ReviewFeedbackOrderUI={header,toggle,list,rowBadges,carryHTML,carryFor,panel,ordered,setOrdered,scrollToStage,exportText,exportCSV,fileName,printHTML,print,version:1};
})(typeof window!=='undefined'?window:globalThis);

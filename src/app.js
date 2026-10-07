(function(){
'use strict';
const E=window.ReviewEngine,$=s=>document.querySelector(s),money=n=>new Intl.NumberFormat('ja-JP').format(n||0)+' 円';
const INS=window.ReviewInsight,W=window.ReviewWorkspace,P=window.ReviewPortfolio,M=window.ReviewMotion,F=window.ReviewFinancial,D=window.ReviewDetails;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let workspace=W.fresh(),session=E.newSession(),result=E.analyze(session),view='companies',filter='all',search='',historySearch='',contextSearch='',contextOffset=0,companySearch='',companyFilter='all',selected=null,pending=null,files=[],queueTotal=0,queueLog=null,forceType=null,saveTimer=null,db=null,loading=true,saveState='loading',writeQueue=Promise.resolve(),revision=0,bulkPlan=null,importCompanyId=null,loadError='',monthlyFocus=null;
const ICONS={context:'M4 4h16v16H4z M8 8h8 M8 12h8 M8 16h5',review:'M4 5h16v14H4z M8 10h8 M8 14h5',data:'M4 8h16v12H4z M4 8l3-4h5l2 4 M9 13h6',check:'M9 5h11 M9 12h11 M9 19h11 M3 5l1 1 2-3 M3 12l1 1 2-3 M3 19l1 1 2-3',memo:'M5 3h11l3 3v15H5z M9 10h6 M9 14h6 M9 18h3',book:'M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3z M12 6v16',upload:'M12 16V3 M7 8l5-5 5 5 M4 16v5h16v-5',download:'M12 3v13 M7 11l5 5 5-5 M4 17v4h16v-4',shield:'M12 3l8 4v5c0 5-8 9-8 9s-8-4-8-9V7z M8 12l3 3 5-6',spark:'M12 3l2 6 6 3-6 2-2 7-2-7-6-2 6-3z',plus:'M12 5v14 M5 12h14',copy:'M8 8h12v13H8z M4 16V3h12',chevron:'M8 5l7 7-7 7',info:'M12 11v6 M12 7h.01 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',trash:'M3 6h18 M8 6V3h8v3 M6 6l1 15h10l1-15',clock:'M12 7v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',checkmark:'M5 12l4 4L19 6',refresh:'M20 4v6h-6 M4 20v-6h6 M6 7a8 8 0 0 1 14 3 M18 17a8 8 0 0 1-14-3'};
const icon=n=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[n]||ICONS.info}"/></svg>`;
// ---- 消費税区分（同じアプリ内の区分チェック）との連携 ----
const KH=window.KubunHost||null;let lastView=null;
function rowDates(f){
 const all=(f.rows||[]).map(r=>r&&r.date).filter(d=>typeof d==='string'),ds=[...new Set(all.filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
 if(!ds.length){const ms=[...new Set(all.filter(d=>/^\d{4}-\d{2}$/.test(d)))].sort();return ms.length?'対象月 '+ms.map(m=>m.replace('-','/')).join('・'):'';}
 const fmt=(d,i)=>i&&d.slice(0,4)===ds[0].slice(0,4)?d.slice(5).replace('-','/'):d.replace(/-/g,'/');
 return ds.length<=5?'取引日 '+ds.map(fmt).join('・'):`取引日 ${fmt(ds[0],0)}〜${fmt(ds.at(-1),1)}（${ds.length}日）`;
}
function mainRow(f){let rs=(f.rows||[]).filter(r=>r.debit!==undefined&&/^\d{4}-\d{2}-\d{2}$/.test(r.date||''));if(rs.length<2)return '';if(/前月から/.test(f.title)){const last=rs.map(r=>r.date.slice(0,7)).sort().at(-1);rs=rs.filter(r=>r.date.startsWith(last));if(!rs.length)return '';}const amt=r=>Math.max(r.debitAmount||0,r.creditAmount||0),m=rs.reduce((a,b)=>amt(b)>amt(a)?b:a);return `${/前月から/.test(f.title)?'変動月の最大':'最大'} ${m.date.slice(5).replace('-','/')} ${money(amt(m))}（${m.debit||'―'}／${m.credit||'―'}）`;}
function topRows(f){
 const rs=(f.rows||[]).filter(r=>r.debit!==undefined);if(rs.length<4)return '';
 const amt=r=>Math.max(r.debitAmount||0,r.creditAmount||0),top=rs.slice().sort((a,b)=>amt(b)-amt(a)||String(a.date).localeCompare(String(b.date))).slice(0,5);
 return `<div class="teachsection"><h3>主な取引（金額の大きい順・上位${top.length}件／全${rs.length}行）</h3><div class="tablewrap"><table class="datatable toprows"><thead><tr><th>取引日</th><th>借方 ／ 貸方・取引先</th><th class="num">金額</th></tr></thead><tbody>${top.map(r=>`<tr><td>${esc(r.date)}</td><td>${esc(r.debit||'―')} ／ ${esc(r.credit||'―')}<br><span class="small">${esc([r.party||r.debitParty||r.creditParty||'',String(r.description||'').slice(0,28)].filter(Boolean).join('　'))}</span></td><td class="num">${money(amt(r))}</td></tr>`).join('')}</tbody></table></div></div>`;
}
// レビューに読み込んだ仕訳帳を、元のCSVの列のまま組み立て直す（取込時に保存した原文の列を使用）
function journalCSV(rows){
 const groups=new Map();for(const r of rows){const k=r.source||'仕訳帳.csv';if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
 const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"',out=[];
 for(const [name,list] of groups){
  if(!list.every(r=>Array.isArray(r.sourceFields)&&r.sourceFields.length))continue;
  const cols=new Map();for(const r of list)for(const x of r.sourceFields)if(!cols.has(x.column))cols.set(x.column,x.header);
  const order=[...cols.keys()].sort((a,b)=>a-b),seen=new Set(),lines=[order.map(c=>q(cols.get(c))).join(',')];
  for(const r of list.slice().sort((a,b)=>(a.line||0)-(b.line||0))){const k=r.line+'|'+(r.importSource||'');if(seen.has(k))continue;seen.add(k);const m=new Map(r.sourceFields.map(x=>[x.column,x.value]));lines.push(order.map(c=>q(m.get(c))).join(','));}
  out.push({name:/\.(csv|tsv|txt)$/i.test(name)?name:name+'.csv',text:lines.join('\r\n')});
 }
 return out;
}
const KUBUN_PREFIX={current:'【当期】',prior:'【過去】'};
function kubunJournals(){return [...journalCSV(session.datasets.current||[]).map(x=>({...x,type:'current'})),...journalCSV(session.datasets.prior||[]).map(x=>({...x,type:'prior'}))];}
function kubunJournalCount(){let n=0;for(const type of ['current','prior']){const seen=new Set();for(const r of session.datasets[type]||[]){const k=r.source||'';if(seen.has(k))continue;seen.add(k);if(Array.isArray(r.sourceFields)&&r.sourceFields.length)n++;}}return n;}
function kubunPage(company){
 return heading('TAX CLASSIFICATION','消費税区分','仕訳帳の「科目×税区分」から違和感を見つけ、取引ごとにOK・修正・保留を記録する。',`<button class="btn" data-action="kubunHome">全社の進み具合・判定ルール</button><button class="btn primary" data-action="kubunOpen">${icon('kubun')}この会社の区分チェック</button>`)+`<div class="kubunbar" id="kubunBar" aria-live="polite">${kubunBarHTML(company)}</div><div id="kubunSlot" class="kubunslot"><div class="kubunloading"><span class="activityspinner" aria-hidden="true"></span>消費税区分チェックを準備しています…</div></div>`;
}
function kubunBarHTML(company){
 if(!KH)return '<span class="small">この版では消費税区分チェックを読み込めません。</span>';
 if(KH.failed&&!KH.bridge)return '<div class="kbcell" style="grid-column:1/-1"><strong>消費税区分チェックを準備できませんでした</strong><span class="small">ページを再読み込みしてください。自計化レビューのチェック・バックアップはそのまま使えます。</span></div>';
 const st=KH.last,s=KH.statusText(company),p=session.project,journalN=kubunJournalCount(),cells=[];
 const showing=!st?'準備中':st.home?'区分チェックの全社一覧を表示中':st.sample?'サンプル会社（架空）を表示中':st.name;
 const same=st&&!st.home&&(company.session?.demo?st.sample:(st.jikoId===company.id||KH.nameKey(st.name)===KH.nameKey(company.name)));
 cells.push(`<div class="kbcell"><span class="small">区分チェックで開いている会社</span><strong>${esc(showing)}</strong>${st&&!same?`<button class="btn small" data-action="kubunOpen">「${esc(company.name)}」に戻る</button>`:''}</div>`);
 cells.push(`<div class="kbcell"><span class="small">進み具合</span><strong><span class="badge ${s.state==='done'?'ok':s.state==='doing'?'warn':''}">${esc(s.text)}</span></strong><span class="small">${esc(s.detail||'')}</span></div>`);
 const kp=same&&st.period?st.period:null,rp={from:p.start,to:p.end};
 cells.push(`<div class="kbcell"><span class="small">対象期間</span><strong>レビュー ${esc(rp.from)}〜${esc(rp.to)}</strong><span class="small">区分チェック ${kp?esc(kp.from+'〜'+kp.to):'（CSV読込後に設定）'}</span>${kp&&(kp.from!==rp.from||kp.to!==rp.to)?`<button class="btn small" data-action="kubunPeriod">区分チェックをレビューの期間に合わせる</button>`:''}</div>`);
 const haveFiles=same?st.nFiles:0;
 const share=journalN&&same&&!st.sample?`<button class="btn small" data-action="kubunShare">レビューの仕訳帳を区分チェックに${haveFiles?'入れ直す':'入れる'}（${journalN}ファイル）</button>`:'';
 cells.push(`<div class="kbcell"><span class="small">仕訳帳</span><strong>レビュー 当期 ${result.current.length.toLocaleString()}行／区分チェック ${haveFiles}ファイル</strong>${share}${!haveFiles&&!journalN&&same&&!st.sample?'<span class="small">資料の読込で仕訳帳を入れるとき「区分チェックにも入れる」を選ぶと、両方が同じ仕訳帳になります。</span>':''}</div>`);
 return cells.join('');
}
function kubunCheckBox(){const c=W.current(workspace),st=KH.statusText(c);return `<div class="kubuncheck"><span class="small">この会社の消費税区分チェック</span><strong><span class="badge ${st.state==='done'?'ok':st.state==='doing'?'warn':''}">${esc(st.text)}</span> ${esc(st.detail||'')}</strong><button class="btn small" data-view="kubun">${icon('kubun')}消費税区分を開く</button></div>`;}
function kubunMemo(){if(!KH)return '';const c=W.current(workspace),st=KH.statusText(c),e=st.entry,s=e&&e.stats||{};return `\n【消費税区分チェック】\n状態：${st.text}${e&&e.done?'（完了 '+e.done+'）':''}\n${s.nFiles?`違和感 高 ${s.hi||0}・中 ${s.mid||0}／取引の判断 ${s.judged||0}/${s.cand||0}（修正 ${s.fix||0}・保留 ${s.hold||0}）／対象 ${s.from||''}〜${s.to||''}`:'区分チェック用のCSVは未読込'}\n詳しいメモ下書きは「消費税区分」画面の「06 出力」にあります。\n`;}
function updateKubunBar(){const el=$('#kubunBar'),c=W.current(workspace);if(el&&c)el.innerHTML=kubunBarHTML(c);}
async function kubunShareJournals(list,company,opt){
 const c=company||W.current(workspace);if(!c||!KH||!list.length)return null;
 const enc=new TextEncoder(),r=await KH.addFiles(c,list.map(x=>({name:x.name,buffer:x.buffer||enc.encode(x.text).buffer})),opt||{});
 updateKubunBar();return r;
}
async function kubunShareAll(company){
 const list=kubunJournals();let added=0,read=false;
 for(const type of ['current','prior']){const part=list.filter(x=>x.type===type);if(!part.length)continue;const r=await kubunShareJournals(part,company,{prefix:KUBUN_PREFIX[type],replace:true});if(r){added+=r.added;read=read||r.read;}}
 return {added,read};
}
if(KH){
 KH.on('change',()=>{if(view==='kubun')updateKubunBar();});
 KH.on('home',()=>{if(view==='kubun')updateKubunBar();});
 KH.on('ready',()=>{try{KH.syncCompanies(workspace.companies);}catch{}if(loading)return;if(['companies','check'].includes(view))render();else if(view==='memo'){const t=$('#memoText');if(t&&document.activeElement!==t)t.value=allMemo();}else if(view==='kubun')updateKubunBar();});
 KH.on('list',()=>{if(view==='kubun')updateKubunBar();});
 KH.on('company',st=>{
  if(view!=='kubun'||!st||st.home)return;const cur=W.current(workspace);let target=null;
  if(st.sample)target=workspace.companies.find(c=>!c.archived&&c.session?.demo)||null;
  else{const k=KH.nameKey(st.name);target=workspace.companies.find(c=>c.id===st.jikoId)||workspace.companies.find(c=>!c.archived&&KH.nameKey(c.name)===k)||workspace.companies.find(c=>c.archived&&KH.nameKey(c.name)===k)||null;}
  if(target&&target.archived){toast(`「${target.name}」は保管中です。会社一覧の「保管中」から戻すと、両方で開けます`);updateKubunBar();return;}
  if(!target&&!st.sample){try{target=W.add(workspace,{name:W.uniqueName(workspace,st.name),closingMonth:st.fyEnd||null,owner:st.staff||'',note:st.memo||''});applyAutoPeriod(target);KH.linkHint[target.id]=st.id;save();toast(`「${target.name}」を会社一覧に追加しました（区分チェックから）`);}catch(err){toast(err.message);return;}}
  if(!target){updateKubunBar();return;}
  if(target.id!==cur?.id){KH.openedFor=null;KH.linkHint[target.id]=KH.linkHint[target.id]||st.id;openCompany(target.id,'kubun');requestAnimationFrame(()=>KH.scrollIntoPlace());}else{KH.open(target).catch(()=>{});updateKubunBar();}
 });
}
Object.assign(ICONS,{kubun:'M4 4h16v16H4z M8 16l8-8 M8.5 8.5h.01 M15.5 15.5h.01',calendar:'M4 6h16v14H4z M4 10h16 M8 3v5 M16 3v5',monthly:'M4 4v16h16 M7 15l4-5 4 3 5-7',companies:'M3 21V6l9-3v18 M12 9h9v12 M6 8h2 M6 12h2 M6 16h2 M16 12h2 M16 16h2 M2 21h20',history:'M4 4v6h6 M4 10a8 8 0 1 1 1 8 M12 7v5l3 2',teacher:'M4 5h16v12H9l-5 4z M8 9h8 M8 13h5'});
const decisionNames={open:'未確認',resolved:'確認済み',ask:'お客様・上司へ確認',defer:'今回深追いせず'};
function decision(id){return session.decisions[id]||{status:'open',note:''};}
function invalidateChecks(target=session){if(target.financial)target.financial.comparisonConfirmed=false;for(const m of Object.values(target.manual))if(m.status==='done'||m.status==='na'){m.status='todo';m.note='【資料・条件更新につき再確認】\n'+(m.note||'');}for(const t of target.teacher.turns)t.stale=true;}
function toast(t){$('#toast').textContent=t;$('#toast').classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3500);}
function recompute(){result=E.analyze(session);if(!selected||!result.findings.some(f=>f.id===selected))selected=result.findings[0]?.id||null;}
function syncActive(){const c=W.current(workspace);if(c){c.session=session;c.name=session.project.name;c.summary={findings:result.findings.length,open:result.findings.filter(f=>decision(f.id).status==='open').length};}}
function saveLabel(){return {loading:'保存データを読込中',pending:'保存中…',saved:'このブラウザに保存済み',unavailable:'自動保存不可：JSONで保存',failed:'保存失敗：JSONで保存'}[saveState]||'このブラウザに自動保存';}
function updateSaveIndicator(){const el=$('#saveStatus');if(el){el.textContent=saveLabel();el.setAttribute('data-save-state',saveState);}}
function persist(){
 if(!db)return Promise.resolve();const snapshot=JSON.parse(JSON.stringify(workspace)),r=revision;
 writeQueue=writeQueue.catch(()=>{}).then(()=>new Promise((res,rej)=>{const tx=db.transaction('sessions','readwrite');tx.objectStore('sessions').put(snapshot,'workspace');tx.oncomplete=res;tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error);})).then(()=>{if(r===revision){saveState='saved';updateSaveIndicator();}}).catch(()=>{if(r===revision){saveState='failed';updateSaveIndicator();}});return writeQueue;
}
function save(){session.updatedAt=new Date().toISOString();syncActive();workspace.updatedAt=session.updatedAt;revision++;saveState=db?'pending':'unavailable';clearTimeout(saveTimer);saveTimer=setTimeout(persist,250);updateSaveIndicator();}
function setTheme(theme){
 if(!['light','future'].includes(theme))return;
 workspace.preferences.theme=theme;KH?.setTheme(theme);document.documentElement.dataset.theme=theme;
 for(const value of ['light','future']){const button=$(`[data-theme-choice="${value}"]`);if(button)button.setAttribute('aria-pressed',String(value===theme));}
 workspace.updatedAt=new Date().toISOString();syncActive();revision++;saveState=db?'pending':'unavailable';clearTimeout(saveTimer);persist();updateSaveIndicator();M.themeChanged();
}
function themeControl(){return `<div class="themecontrol" role="group" aria-label="デザイン切替"><button type="button" data-theme-choice="light" aria-pressed="${workspace.preferences.theme==='light'}" title="明るいデザインに切り替える">明るめ</button><button type="button" data-theme-choice="future" aria-pressed="${workspace.preferences.theme==='future'}" title="近未来のデザインに切り替える">近未来</button></div>`;}
function flush(){clearTimeout(saveTimer);syncActive();return persist();}
async function initDB(){
 const end=M.busy('保存したデータを読み込み中…');
 try{
  db=await new Promise((res,rej)=>{const q=indexedDB.open('ledger-atelier-review',1);q.onupgradeneeded=()=>q.result.createObjectStore('sessions');q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);});
  const get=key=>new Promise((res,rej)=>{const q=db.transaction('sessions').objectStore('sessions').get(key);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);});
  const stored=await get('workspace');if(stored)workspace=W.validate(stored);else{const legacy=await get('active');if(legacy)workspace=W.migrate(legacy);}
  session=W.current(workspace)?.session||E.newSession();recompute();syncActive();loading=false;saveState='saved';if(!stored&&workspace.companies.length){revision++;await persist();}render();
 }catch{db=null;loading=false;saveState='unavailable';loadError='保存データを読めませんでした。旧データは上書きしていません。JSONから復元するか、この画面で全社バックアップを使ってください。';render();}finally{end();}
}
function openCompany(key,to='review'){syncActive();try{session=W.activate(workspace,key);}catch(err){return toast(err.message);}selected=null;monthlyFocus=null;filter='all';search='';historySearch='';contextSearch='';contextOffset=0;files=[];pending=null;importCompanyId=null;$('#importDialog').close();view=to;recompute();save();flush();render();window.scrollTo(0,0);}
function navigate(to){if(!['companies','review','monthly','kubun','data','context','history','teacher','check','memo','book'].includes(to))throw Error('Invalid section');if(!W.current(workspace)&&!['companies','book'].includes(to)){view='companies';render();return toast('会社一覧で対象の会社を選んでください');}syncActive();view=to;render();window.scrollTo(0,0);}
function showCompanyDialog(key=null){const c=key?workspace.companies.find(x=>x.id===key):null;$('#companyDialog').innerHTML=P.companyDialog(c).replace('</select></div></div><div class="field"><label for="companyNote">','</select><span class="small">選ぶと、対象期間を期首からそろえます（自分で決めた期間は変えません）</span></div></div><div class="field"><label for="companyNote">');$('#companyDialog').showModal();}
function showBulkDialog(){bulkPlan=null;$('#bulkDialog').innerHTML=P.bulkDialog();$('#bulkDialog').showModal();}
function previewCompanies(){try{bulkPlan=W.planImport(workspace,W.parseList($('#bulkText').value));$('#bulkPreview').innerHTML=P.preview(bulkPlan);const button=$('#bulkDialog [data-action="commitCompanies"]');if(button)button.disabled=!bulkPlan.items.length||!!bulkPlan.errors.length;}catch(err){bulkPlan=null;$('#bulkPreview').innerHTML=`<div class="notice error">${esc(err.message)}</div>`;const button=$('#bulkDialog [data-action="commitCompanies"]');if(button)button.disabled=true;}}
function loadDemoCompany(){const s=E.demoSession(),c=W.add(workspace,{name:W.uniqueName(workspace,'操作サンプル（架空）'),entityType:s.project.type},s);openCompany(c.id);}
function download(name,text,type='text/plain;charset=utf-8'){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function backup(){syncActive();const c=W.current(workspace);if(!c)return backupAll();let k=null;try{k=KH?await KH.exportAll(c.id):null;}catch{k=null;}if(k&&!k.companies?.length)k=null;download('自計化レビュー_バックアップ.json',JSON.stringify({kind:'ledger-atelier-company',schema:1,company:c,...(k?{kubunChecker:k}:{})},null,2),'application/json');toast(c.name+'のバックアップをダウンロードしました'+(k?'（消費税区分の記録を含む）':KH&&KH.failed?'（消費税区分チェックを準備できなかったため、その記録は含みません）':KH?'（消費税区分の記録はありません）':''));}
async function backupAll(){syncActive();let k=null;try{k=KH?await KH.exportAll():null;}catch{k=null;}if(k&&!k.companies?.length)k=null;download('自計化レビュー_全社バックアップ.json',JSON.stringify(k?{...workspace,kubunChecker:k}:workspace,null,2),'application/json');toast('全社バックアップをダウンロードしました'+(k?'（消費税区分の記録を含む）':KH&&KH.failed?'（消費税区分チェックを準備できなかったため、その記録は含みません）':''));}
async function copy(text){try{await navigator.clipboard.writeText(text);toast('コピーしました');}catch{const t=document.createElement('textarea');t.value=text;t.style.position='fixed';t.style.opacity='0';document.body.append(t);t.select();const ok=document.execCommand('copy');t.remove();toast(ok?'コピーしました':'コピーできません。メモ欄を選択してコピーしてください');}}
function render(){
 document.documentElement.dataset.theme=workspace.preferences.theme;KH?.setTheme(workspace.preferences.theme);
 const unresolved=result.findings.filter(f=>decision(f.id).status==='open').length;
 const company=W.current(workspace),navs=[['companies','会社一覧'],['review','レビュー'],['monthly','月次PL・BS'],['kubun','消費税区分'],['data','資料の読込'],['context','取引の情報'],['history','過去の仕訳帳'],['teacher','先生デスク'],['check','チェックシート'],['memo','引継ぎメモ'],['book','根拠と使い方']];
 if(!company&&!['companies','book'].includes(view))view='companies';
 let page=view==='companies'?P.page(workspace,companySearch,companyFilter):view==='history'?window.ReviewDesk.historyPage(session,result,historySearch):view==='teacher'?window.ReviewDesk.teacherPage(session,result,selected):view==='review'?reviewPage():view==='monthly'?heading('MONTHLY FINANCIALS','月次PL・BS','対象期間の科目残高から、次に見る元帳を選ぶ。')+settings()+F.page(session,result,monthlyFocus):view==='kubun'?kubunPage(company):view==='context'?D.page(session,result,contextSearch,contextOffset):view==='data'?dataPage():view==='check'?checkPage():view==='memo'?memoPage():helpPage()+detailsHelp()+monthlyHelp()+historyHelp();
 page=page.replace('>新規案件<','>会社を追加<').replace('<li>「新規案件」は現在のデータを消します。ダウンロード済みのバックアップから復元できます。</li>','<li>会社の追加・復元は別の会社として登録。現在の会社の記録を保持します。</li>');
 if(view==='review'||view==='monthly'){page=page.replace('>案件名<','>会社名<');if(!company.entityType)page=page.replace(/(<option value="(?:corp|individual)") selected/g,'$1').replace('<select id="entityType" name="type">','<select id="entityType" name="type" required><option value="" selected>区分を選択</option>');}
 $('#app').innerHTML=`<div class="shell">
 <header class="sidebar"><div class="firmintro"><span>あしたの会計事務所｜自計化チェックの作業スペース</span><span class="version">MULTI-COMPANY · 3.6.0</span></div>
 <div class="firmmasthead"><div class="brand"><svg class="firmmark" viewBox="0 0 66 66" aria-hidden="true"><path class="mark-outline" d="M33 5 51 11 61 29 55 49 36 61 15 55 5 37 11 16Z"/><path class="mark-inner" d="M29 9 49 15 56 34 49 53 29 57 12 46 10 26Z"/><text x="33" y="30">ashita</text><text x="33" y="39">accounting</text></svg><div><strong>あしたの会計事務所</strong><span>自計化レビュー</span></div></div>
 <div class="sidebarcompany"><span class="small">選択中の会社</span><strong>${esc(company?.name||'会社を選んで開始')}</strong><button class="btn small" data-view="companies">会社を切り替える</button></div>
 <div class="firmtools">${themeControl()}<div class="sidefoot"><strong><i class="statusdot"></i>端末内で完結</strong><br>読込データの外部送信なし</div></div></div></header>
 <nav class="nav" aria-label="メインメニュー">${navs.map(([k,t])=>`<button class="navbutton ${view===k?'active':''}" data-view="${k}" ${view===k?'aria-current="page"':''} ${loading||!company&&!['companies','book'].includes(k)?'disabled':''}>${icon(k)}${t}${k==='review'&&unresolved&&company?`<span class="navcount">${unresolved}</span>`:''}</button>`).join('')}</nav>
 <main class="main"><header class="topbar"><div class="breadcrumb"><span class="workspacebadge">作業スペース</span>${company&&view!=='companies'?`<button data-view="companies" class="crumbback">会社一覧</button><span class="crumbslash">/</span><strong class="activecompany">${esc(company.name)}</strong><span class="crumbslash">/</span>`:''}<strong>${esc(navs.find(x=>x[0]===view)?.[1]||'会社一覧')}</strong></div><div class="flex"><span id="saveStatus" class="small saveindicator" data-save-state="${saveState}" aria-live="polite">${saveLabel()}</span><span class="localpill">LOCAL · API料金 0円</span></div></header>
 <div class="content">${loadError?`<div class="notice error">${esc(loadError)}</div>`:''}${company&&session.demo&&view!=='companies'?'<div class="notice amber">操作サンプルです。金額・取引先・指摘はすべて架空。実データのチェック結果ではありません。 <button class="btn small" data-action="new">実データ用の会社を追加</button></div>':''}${view==='review'?P.coach(company,result):''}${page}</div></main>
 <footer class="firmfooter"><strong>あしたの会計事務所 · 自計化レビュー</strong><span>資料とチェック記録は会社別に保存 · AI API・課金機能なし</span></footer></div>`;
 if(view==='review'){
   bindReview();
   if(selected){
     const f=result.findings.find(x=>x.id===selected),c=E.History.contextFor(result.history,f);
     const historyBlock=`<div class="teachsection"><h3>過去の仕訳との照合（詳細）</h3><pre class="evidence">${esc(E.History.contextText(c))}</pre><button class="btn" data-view="teacher">先生に質問する</button></div>`;
     $('#teacherPanel').innerHTML=teacherPanel().replace(/<\/div>$/, historyBlock+'<div class="teachsection"><h3>自由な相談をしたいとき</h3><p class="small">相談文をこのチャットなどに貼り付けて使えます。共有前に顧客名などの機密情報を伏せてください。このアプリから送信はしません。</p><button class="btn" data-action="copyConsult">相談文をコピー</button></div></div>');
   }
 }
 if(view==='monthly')bindSettings();if(view==='data')bindDropzone();if(view==='memo')$('#memoText').value=allMemo();
 if(KH){if(view==='kubun'&&company){KH.show($('#kubunSlot'));if(lastView!=='kubun'||KH.openedFor!==company.id){try{KH.syncCompanies(workspace.companies);}catch{}KH.open(company).catch(err=>toast('消費税区分を開けません：'+err.message));if(lastView!=='kubun')requestAnimationFrame(()=>KH.scrollIntoPlace());}updateKubunBar();}else KH.hide();}
 lastView=view;
 const answer=session.teacher.turns.at(-1);M.afterRender(`${view}:${workspace.activeId||''}:${loading?'loading':'ready'}`,view==='review'?selected:null,view==='teacher'&&answer?answer.at+'|'+answer.question+'|'+session.teacher.turns.length:null);window.ReviewScroll?.afterRender(view,workspace.activeId||'',selected);
}
function heading(eyebrow,title,subtitle,buttons=''){return `<div class="heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="actions">${buttons}</div></div>`;}
function detailsHelp(){return `<section class="panel monthly-panel"><div class="panelhead"><h2>2.6：品目・メモを含めて確認する</h2><button class="btn small" data-view="context">取引の情報へ</button></div><div class="panelbody"><ol class="steps"><li>「当期の仕訳帳」から、品目・部門・メモ等を含めたCSVを置き換え読込。プレビューで各列の対応と件数を確認。</li><li>「取引の情報」で借方・貸方を分けて表示。品目・メモ・管理番号で検索し、各行の元CSV全列を開けます。</li><li>確認候補では「この指摘に使った記載」と元の列名を参照。科目・金額に加え、用途・負担者・契約の記載と過去処理を照合します。</li><li>タグや承認状態だけで正誤を確定せず、確認した事実をメモ。外部送信・有料API・自動修正はありません。</li></ol><p class="small" style="margin-top:14px">旧版で読込済みのCSVは、一部の項目の原文が保存されていません。新しい版で元CSVを置き換え読込すると全列を保持できます。更新時は確認済みの項目を再確認に戻し、記入したメモを保持します。空欄やCSVに出ていない証憑の内容は推測で補いません。</p></div></section>`;}
function monthlyHelp(){return `<section class="panel monthly-panel"><div class="panelhead"><h2>2.5：月次PL・BSから確認する</h2><button class="btn small" data-view="monthly">月次画面へ</button></div><div class="panelbody"><ol class="steps"><li>会社を選び、月次PL・BS画面で対象期間を確認します（決算月を設定していれば期首から自動でそろいます）。画面上の「目次」（メニューの下に固定）を押すと、数値照合・資金・取引先別の残高・大きな変動・月次PL・月次BSなどの欄へすぐ移動できます。いま見ている欄は目次で色が変わります。</li><li>freeeの仕訳帳を、借方・貸方の取引先・品目・部門の列を含めて全件読込。月次BS・単月PLは「表示するタグ」を取引先・品目・部門にして1つずつ出力します（円単位、「分類と勘定科目」は同じ列）。タグ別のCSVには科目の合計も入っているので、タグなしのBS・PLは要りません。読込のとき、タグ別の金額の合計が科目の合計と月ごとに一致するかを確かめ、合わない科目の内訳は使いません。BSが未読込でも、仕訳から各月の増減を表示します。</li><li>科目名の▶から取引先別・品目別・部門別の内訳を開きます。BSの科目期首と取引先別期首は別の情報です。取引先が明記されたBS内訳がない場合、確定残高は「—」。当月増減・当期累計増減へ切り替えられます。タグ別のBSで「未選択」がない科目は、取引先・品目・部門ごとの金額をその月末の残高として使います。「未選択」に相殺する金額がある科目は残高ではなく「累計の動き」として、月ごとの増減を表示します（現金・預金・カードのタグ別は取引の累計で、残高ではありません）。取引先別の参考推計（売掛金・未収入金・買掛金・未払金・未払費用）は明示的に選んだ場合だけ表示し、BS総額との一致を配分の証明とは扱いません。</li><li>「取引先別の残高と回収・支払の状況」では、読み込んだ過去の仕訳帳から取引先別の期首を推定し、当期の仕訳で月末まで繰り越します。取引先ごとに、増えた分（請求・仕入）を同じ金額のもの、なければ古いものから入金・支払で消し込み（先入先出）、読込範囲の始めで当てる相手のない入金・支払は、それより前からの残高の分とみなします。推定の合計とBSの期首の差は「内訳不明」に残し、取引先には配分しません。いちばん古い未回収・未払の経過と、その取引先のふだんの回収・支払日数を比べて「長く未回収の可能性」などを示し、主要な取引先（当期の請求・仕入の多い順）も表示します。取引先が未選択の入金・支払が多い科目（カード払いの未払金など）は判定しません。推定は参考値で、延滞・期日超過を確定するものではありません。</li><li>科目を開くと「変動の理由（仕訳から推測）」に、月ごとの前月差と主な内訳・推測が並びます。色付きの金額は前月から大きく動いた月です。</li><li>金額・内訳・理由の行・「大きく動いた科目と理由」のカードを押すと、右側にその月の分析が開きます。「取引から分かること」（前月→当月、主な取引先・品目、相手科目、最大の取引）と「理由の推測」（確からしさ 高・中・低）を分けて表示し、根拠の仕訳を金額の大きい順に確認できます。◀▶で前後の月へ移れます。</li><li>推測の例：個人名の取引先への送金による事業主貸の増加、カード利用と口座引落しの差、引落し・給与・家賃の計上月のずれ（2か月分）、隔月の取引、自動車税など例年の時期の税金、年払い、新規の取引先、入金の遅れ。「AIに相談する文章をコピー」で、根拠の仕訳付きの質問文も作れます。</li><li>基本の資料は、当期・前期の仕訳帳と、取引先・品目・部門別の月次BS・単月PL（あわせて8ファイル）です。「資料の読込」の各カードで、どのタグ別を読み込んだか（✓・ファイル名・月）を確かめられます。前期BS・前期PL・未登録明細などは「追加資料（必要な分析だけ）」から任意で追加します。資料・照合点検で、未読込月・BS貸借・PL利益・BSへの損益連携・科目分類・期首振替の候補を確認してください。</li><li>資金繰りでは、前期末と当期期首の残高、前年同期間の利益、参考キャッシュフローと現預金増減の差、売掛金・買掛金・未払金・未払費用の残高と入出金候補の観測間隔を確認します。期首内訳が確認できる取引先は、連続する仕訳から月末残高を計算できます。期日や請求書との対応がない資料から延滞・実際の回収日数を確定しません。</li></ol><p style="margin-top:16px">推測は仕訳の科目・取引先・品目・摘要・相手科目・前年同月から作った候補で、事実ではありません。証憑・通帳・お客様への確認で確かめてからメモに残してください。千円・累計PL・期首残高の不足では、正確な照合はできません。</p></div></section>`;}
function historyHelp(){return `<section class="panel" style="margin-top:20px"><div class="panelhead"><h2>1.1：過去履歴と先生デスク</h2></div><div class="panelbody"><p>「過去の仕訳帳」から同一顧客の複数年CSVを追加。標準は蓄積で、対象開始月より前を参照します。旧版の前期データと確認メモもバックアップから引き継げます。</p><p style="margin-top:12px">取引先＋摘要・用途メモの正規化／3文字列の類似度50%以上を照合。双方に品目・部門がある場合、相違があれば弱い一致にとどめます。仕訳番号があり、過去3仕訳以上・最多科目80%以上で、過去にない科目差を候補にします。索引ごとに直近300件が上限です。これは統計的な処理パターン集計で、AIモデルの再学習ではありません。</p><p style="margin-top:12px">「先生デスク」は過去の仕訳例・検証したルール・確認手順を使う案内型Q&A。外部AI・API料金はありません。自由な文脈理解、税務条件の自動判定、修正仕訳の自動作成は含みません。決算整理の指定・摘要・負の金額による除外にも見落としがあり、過去に一致してもチェックを自動完了にしません。</p></div></section>`;}
function settings(){const p=session.project;return `<form id="settings" class="panel settings"><div class="field grow"><label for="projectName">案件名</label><input id="projectName" name="name" value="${esc(p.name)}" maxlength="100"></div><div class="field"><label for="entityType">事業者</label><select id="entityType" name="type"><option value="individual" ${p.type==='individual'?'selected':''}>個人事業主</option><option value="corp" ${p.type==='corp'?'selected':''}>法人</option></select></div><div class="field"><label for="periodStart">対象開始月</label><input id="periodStart" name="start" type="month" value="${p.start}" required></div><div class="field"><label for="periodEnd">対象終了月</label><input id="periodEnd" name="end" type="month" value="${p.end}" required></div><button class="btn primary" type="submit">再チェック</button></form>`;}
// 対応の順番（ReviewFeedbackOrder）。並べ方の切替は FOU が持つ
const FO=window.ReviewFeedbackOrder,FOU=window.ReviewFeedbackOrderUI;
function queueRows(){return result.findings.filter(f=>(filter==='all'||filter==='open'&&decision(f.id).status==='open'||filter==='difference'&&f.level==='difference'||filter==='info'&&f.level==='info')&&(!search||`${f.title} ${f.reason} ${E.CHECKS.find(c=>c.key===f.check)?.title} ${(f.why?.tags||[]).join(' ')}`.includes(search)));}
function queueList(rows){
 const fs=result.findings;if(!result.current.length&&!session.imports.length&&!fs.length)return emptyReview();
 if(FOU&&FOU.ordered()){const html=FOU.list(session,result,rows,findingRow,{filter,search,selected});if(html)return html;}
 else if(rows.length)return rows.slice(0,200).map(f=>findingRow(f)+(FOU?FOU.carryFor(session,result,f):'')).join('');
 return `<div class="empty"><div class="emptyicon">${icon('checkmark')}</div><h2>${fs.length?'条件に一致する候補がありません':'抽出条件に該当する候補はありません'}</h2><p>読み込んだ範囲と現在のルールでの結果です。資料未読込・手動確認の項目はチェックシートに残っています。</p><button class="btn" data-view="check">チェックシートを確認</button></div>`;
}
function reviewPage(){
 const fs=result.findings,open=fs.filter(f=>decision(f.id).status==='open').length,manual=result.coverage.filter(c=>!c.disabled&&(c.state==='手動確認'||c.state==='資料未読込')).length,matched=result.coverage.filter(c=>!c.disabled&&!['手動確認','資料未読込'].includes(c.state)).length,total=result.coverage.filter(c=>!c.disabled).length;
 const rows=queueRows(),hasData=result.current.length||session.imports.length||fs.length;
 // 資料を読み直したあとの比較（消えた論点）。保存は次の保存操作にまかせる
 if(FO&&hasData)FO.reconcile(session,FO.build(session,result));
 return heading('REVIEW WORKSPACE','自計化レビュー','確認候補を見つけ、根拠を読んで、メモに残す。',`<button class="btn" data-action="backup">${icon('download')}バックアップ</button><button class="btn primary" data-view="data">${icon('plus')}資料を読み込む</button>`)+settings()+`<div class="stats"><div class="stat"><div class="statlabel">${icon('data')}対象の仕訳行</div><div class="statvalue">${result.current.length.toLocaleString()}<small>行</small></div><div class="statnote">${session.project.start} — ${session.project.end}</div></div><div class="stat gold"><div class="statlabel">${icon('review')}未確認の候補</div><div class="statvalue">${open}<small>件</small></div><div class="statnote">候補数 ≠ 誤りの数</div></div><div class="stat"><div class="statlabel">${icon('check')}抽出を実行した項目</div><div class="statvalue">${matched}<small>/ ${total}</small></div><div class="statnote">実施数 ≠ 正しさの保証</div></div><div class="stat"><div class="statlabel">${icon('book')}資料・手動確認が必要</div><div class="statvalue">${manual}<small>項目</small></div><div class="statnote">チェックシートで確認状況を記録</div></div></div>${!session.project.complete&&result.current.length?'<div class="notice">このCSVの網羅性は未指定です。貸借差額は読込内容の確認として表示し、欠落月の検出は停止中。 <button class="btn small" data-view="data">資料の設定を確認</button></div>':''}${FOU&&hasData?FOU.header(session,result):''}<div class="reviewgrid"><section class="panel"><div class="panelhead"><h2>確認キュー</h2><span class="small">${fs.length}件の候補</span></div><div class="filters">${[['all','すべて'],['open','未確認'],['difference','残高・金額差'],['info','ヒント・資料確認']].map(([k,t])=>`<button class="chip ${filter===k?'active':''}" data-filter="${k}">${t}</button>`).join('')}${FOU&&hasData?FOU.toggle():''}<input id="search" class="search" placeholder="科目・取引先で検索" aria-label="確認候補を検索" value="${esc(search)}"></div><div id="findingList">${queueList(rows)}</div><div class="review-footer">表示は最大200件（順番どおりのときは200項目）。抽出・メモ出力は全候補が対象。税区分の全件判定は含みません。</div></section><aside id="teacherPanel" class="panel teacher">${teacherPanel()}</aside></div><section class="panel coverage"><div class="panelhead"><h2>チェックの見通し</h2><button class="btn small" data-view="check">全項目を確認</button></div><div class="tablewrap"><table class="datatable"><thead><tr><th>項目</th><th>実行状況</th><th>追加で必要な資料</th></tr></thead><tbody>${result.coverage.filter(c=>!c.disabled).slice(0,7).map(c=>`<tr><td><span class="checkcode">${c.code}</span><br>${c.title}</td><td><span class="badge ${c.count?'warn':''}">${c.state}</span></td><td>${c.needs}</td></tr>`).join('')}</tbody></table></div></section>`;
}
function emptyReview(){return `<div class="empty"><div class="emptyicon">${icon('upload')}</div><h2>仕訳帳CSVから始めよう</h2><p>一度読み込むと、重複候補・高額支出・月次変動・私的支出の候補をまとめて確認できます。</p><div class="actions"><button class="btn primary" data-action="import" data-type="current">${icon('upload')}CSVを読み込む</button><button class="btn" data-action="demo">操作サンプルを試す</button></div><p class="tinyline">全処理は端末内。freeeへの接続・自動修正は行いません。</p></div>`;}
function findingRow(f,item){const c=E.CHECKS.find(c=>c.key===f.check),d=decision(f.id);return `<button class="finding ${selected===f.id?'selected':''}" data-finding="${f.id}"><span class="flag ${f.level==='difference'?'diff':f.level==='info'?'info':''}">${f.level==='difference'?'≠':f.level==='info'?(f.dataReview?'?':'+'):'!'}</span><span class="findingbody"><span class="findingtitle">${esc(f.title)}</span><span class="findingmeta">${item&&FOU?FOU.rowBadges(item):''}<span>${c?.code||''} · ${c?.title||''}</span><span class="badge ${d.status==='resolved'?'ok':d.status==='ask'?'warn':''}">${decisionNames[d.status]||'未確認'}</span>${(f.why?.tags||[]).filter(t=>t!=='高額').slice(0,3).map(t=>`<span class="ftag">${esc(t)}</span>`).join('')}</span>${rowDates(f)?`<span class="finddates">${icon('calendar')}<span>${esc(rowDates(f))}${mainRow(f)?`<span class="findmain">${esc(mainRow(f))}</span>`:''}</span></span>`:''}<span class="findingtext">${esc(f.reason)}</span></span><span class="findingamount">${f.dataReview?'判定保留':money(f.amount)}<br><span class="small">${f.rows.length}行</span></span></button>`;}
function teacherPanel(){const f=result.findings.find(x=>x.id===selected);const header=`<div class="teacherhead"><div class="teacheravatar">L</div><div><h2>レビュー・ガイド</h2><div class="small">チェック理由と次の一手</div></div></div>`;if(!f)return header+`<div class="teacherbody"><p>左の確認候補を選ぶと、なぜ気になるのか、何を確認すれば判断できるかを説明します。</p><div class="teachsection"><h3>この先生の仕組み</h3><p>チェックシートと公開資料に基づくルールの解説です。外部AIの自由回答ではありません。</p></div></div>`;const d=decision(f.id),sources=f.sources.map(id=>E.SOURCES.find(s=>s.id===id)).filter(Boolean);return header+`<div class="teacherbody"><div class="badge ${f.level==='difference'?'red':f.level==='info'?'':'warn'}">${f.level==='difference'?'数値の差額を検出':f.level==='info'?(f.dataReview?'読込内容の確認':'効率化のヒント'):'確認候補・誤り未確定'}</div><h2 class="detailtitle" style="margin-top:11px">${esc(f.title)}</h2>${balanceSummary(f)}${window.ReviewVariance?window.ReviewVariance.findingHTML(f,session,result):''}${INS?INS.panel(f):''}<div class="teachsection"><h3>${f.why?'判断するときの注意':'なぜ気になる？'}</h3><p>${esc(f.lesson)}</p></div><div class="teachsection"><h3>次に確認すること</h3><ol class="steps">${f.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol></div>${topRows(f)}<div class="teachsection"><h3>検出した明細</h3><div class="evidence">${esc(evidenceText(f,8))}${f.rows.length>8?`\n…ほか ${f.rows.length-8}行（全行をメモ出力）`:''}</div></div>${D.panel(f)}<div class="teachsection"><h3>抽出の根拠</h3><p class="small">${esc(f.basis)}</p>${sources.map(s=>s.url?`<a href="${s.url}" target="_blank" rel="noopener noreferrer" class="small">${esc(s.name)}</a><br>`:`<span class="small">${s.name}</span><br>`).join('')}${INS?INS.glossaryHTML(f):''}</div><label class="small" for="decisionStatus">確認状況</label><select id="decisionStatus">${Object.entries(decisionNames).map(([k,t])=>`<option value="${k}" ${d.status===k?'selected':''}>${t}</option>`).join('')}</select><label class="small" for="decisionNote" style="display:block;margin-top:10px">確認した事実・質問</label><textarea id="decisionNote" placeholder="例：3月分は4月に登録。契約書の月額と一致。">${esc(d.note)}</textarea><button class="btn primary" data-action="saveDecision">${icon('checkmark')}確認記録を保存</button><button class="btn" data-action="copyFinding">${icon('copy')}この候補のメモをコピー</button></div>`;}
function evidenceText(f,limit=Infinity){return f.rows.slice(0,limit).map(r=>{if(r.statement)return `${r.date}｜${r.statement} ${r.account}\n${r.amount===null?'未読込':money(r.amount)}｜${r.source||''} ${r.line}行`;if(r.balance!==undefined)return `${r.date}｜${r.account} ${r.party||''}\n帳簿 ${money(r.balance)}${r.expected!==null?`／資料 ${money(r.expected)}`:''}｜元CSV ${r.line}行`;if(r.due)return `${r.date||'発生日なし'}｜${r.account} ${r.party||''}\n期日 ${r.due}｜未決済 ${money(r.amount)}｜基準日 ${r.asOf||session.financial.agingAsOf||'未確認'}｜元CSV ${r.line}行`;if(r.debit!==undefined)return `${r.date}｜仕訳 ${r.id}｜${r.party||r.debitParty||r.creditParty||'取引先なし'}\n${r.debit} ${money(r.debitAmount)} ／ ${r.credit} ${money(r.creditAmount)}\n${r.description||'摘要なし'}｜${r.source||''} ${r.line}行${D.evidenceText(r,r.side)?'\n'+D.evidenceText(r,r.side):''}`;return `${r.date}｜${r.description||r.party||'内容なし'}｜${money(r.amount)}｜元CSV ${r.line}行`;}).join('\n\n');}
// ---- 資料の読込：基本の8ファイル（仕訳帳2つ＋月次BS・PLのタグ別）と、必要な分析だけの追加資料 ----
const PRIMARY_TYPES=['current','prior','monthlyBS','monthlyPL'],MAIN_DIMS=['party','item','department'];
const PRIMARY_DESC={current:'freee の仕訳帳CSV。取引先・品目・部門・メモの列を含む全件。',prior:'前期（できれば2〜3期分）の仕訳帳。過去の処理との比較や、取引先別の期首の推定に使います。',monthlyBS:'月次推移の貸借対照表。「表示するタグ」を取引先・品目・部門にして各1つ。',monthlyPL:'月次推移の損益計算書（単月）。「表示するタグ」を取引先・品目・部門にして各1つ。'};
function monthSpan(ms){return !ms.length?'':ms.length===1?ms[0]:`${ms[0]}〜${ms.at(-1)}（${ms.length}か月）`;}
// 帳票で金額の入っている月（freeeが出す空欄の月は数えない）。タグなし＝''
function filledMonths(type){
 const out={},add=(k,d)=>{(out[k]||(out[k]=new Set())).add(String(d).slice(0,7));};
 for(const r of session.datasets[type]||[])if(!r.opening&&r.date&&r.amount!==null&&r.amount!==undefined)add(r.tagDimension||'',r.date);
 for(const r of session.tagReports||[])if(r.type===type&&!r.opening&&r.date&&r.amount!==null&&r.amount!==undefined)add(r.tagDimension,r.date);
 for(const k of Object.keys(out))out[k]=[...out[k]].sort();return out;
}
function materialsOf(type){const T=window.ReviewTagReports;return T?T.materials(session).find(m=>m.type===type)||null:null;}
// 基本の8ファイルのうち読込済みの数
function primaryProgress(){let n=0;for(const k of ['current','prior'])if(session.datasets[k].length)n++;for(const k of ['monthlyBS','monthlyPL']){const m=materialsOf(k);if(m)n+=m.dims.filter(d=>MAIN_DIMS.includes(d.dim)&&d.loaded).length;}return n;}
function tagChecklist(type){
 const m=materialsOf(type);if(!m)return '';const fm=filledMonths(type),plain=m.plain.at(-1),period=E.monthRange(session.project.start,session.project.end);
 const li=(ok,label,file,note='',cls='')=>`<li class="dp-tag ${ok?'ok':''} ${cls}"><span class="dp-mark" aria-hidden="true">${ok?'✓':''}</span><span class="dp-tagname">${esc(label)}<span class="dp-sr">${ok?'：読込済み':'：未読込'}</span></span><span class="dp-tagfile">${file}</span>${note?`<span class="dp-tagnote small">${note}</span>`:''}</li>`;
 // 読み込んだ月と、対象期間のうち足りない月
 const span=ms=>{const have=new Set(ms),miss=period.filter(x=>!have.has(x));return esc(monthSpan(ms))+(miss.length?` <span class="dp-warn">対象期間のうち ${esc(miss.length===1?miss[0]:miss[0]+'〜'+miss.at(-1))} がありません</span>`:'');};
 const rows=[plain?li(true,'なし',esc(plain.name),span(fm['']||[]),'dp-plain'):li(false,'なし',m.totals?'<span class="small">不要（タグ別のCSVに科目の合計が入っています）</span>':'<span class="small">未読込（任意）</span>','','dp-plain')];
 for(const d of m.dims.filter(d=>MAIN_DIMS.includes(d.dim)||d.loaded)){
  const dropped=d.check?.dropped?.length||0,notes=d.loaded?[span(fm[d.dim]||[])]:[];
  if(dropped)notes.push(`<span class="dp-warn">科目の合計と合わない ${dropped}科目の内訳は使っていません</span>`);
  rows.push(li(d.loaded,d.label,d.loaded?esc(d.file||'（ファイル名なし）'):'<span class="small">未読込</span>',notes.join(' ')));
 }
 return `<ul class="dp-tags" aria-label="表示するタグ別の読込状況">${rows.join('')}</ul>`;
}
function reportCard(type){
 const t=E.TYPES[type],m=materialsOf(type),totals=m?m.totals:session.datasets[type].filter(r=>!r.tagDimension).length,tagRows=(session.tagReports||[]).some(r=>r.type===type),any=session.datasets[type].length||tagRows;
 return `<section class="panel dataset dp-card" data-dp-type="${type}"><div class="datasetrow"><h3>${esc(t.name)}</h3><span class="badge ${totals?'ok':''}">${totals?'科目合計 '+totals.toLocaleString()+'行':'未読込'}</span></div><p>${PRIMARY_DESC[type]}</p>${tagChecklist(type)}<div class="rowactions"><button class="btn small" data-action="import" data-type="${type}">${icon('upload')}CSV読込</button>${any?`<button class="btn small danger" data-action="removeDataset" data-type="${type}">削除</button>`:''}</div></section>`;
}
function closingOf(c){return c?.closingMonth||(c?.entityType==='individual'?12:null);}
// ---- 対象期間：決算月から決める（利用者が決めた期間は変えない） ----
const ymOf=(y,m)=>`${y}-${String(m).padStart(2,'0')}`,shiftMonth=(s,n)=>{const [y,m]=s.split('-').map(Number),k=y*12+m-1+n;return ymOf(Math.floor(k/12),k%12+1);};
const fiscalEnd=(closing,month)=>{const [y,m]=month.split('-').map(Number);return ymOf(m<=closing?y:y+1,closing);};
// 決算月の会計年度の期首〜直近の月（当期の仕訳帳があればその最終月、なければ先月）
function autoPeriod(c,s){
 const closing=closingOf(c);if(!closing)return null;
 const last=(s.datasets.current||[]).reduce((m,r)=>{const d=String(r.date||'').slice(0,7);return /^\d{4}-\d{2}$/.test(d)&&d>m?d:m;},''),now=new Date(),ref=last||shiftMonth(ymOf(now.getFullYear(),now.getMonth()+1),-1),end=fiscalEnd(closing,ref);
 return {start:shiftMonth(end,-11),end:ref<end?ref:end,closing};
}
const DEFAULT_PERIOD=(({start,end})=>({start,end}))(E.newSession().project);
// 旧版で作った会社は、初期値の期間のままで当期の仕訳帳もなければ自動とみなす
function periodIsAuto(s){const p=s.project;return p.periodSource==='auto'||!p.periodSource&&p.start===DEFAULT_PERIOD.start&&p.end===DEFAULT_PERIOD.end&&!(s.datasets.current||[]).length;}
function setPeriod(s,start,end,source){
 const changed=s.project.start!==start||s.project.end!==end;s.project={...s.project,start,end,periodSource:source};
 if(changed){invalidateChecks(s);s.financial.agingComplete=false;if(s===session){monthlyFocus=null;recompute();}}
 return changed;
}
function applyAutoPeriod(c){if(!c?.session||!periodIsAuto(c.session))return null;const a=autoPeriod(c,c.session);if(!a){c.session.project.periodSource='auto';return null;}return setPeriod(c.session,a.start,a.end,'auto')?a:null;}
function periodNote(){
 const c=W.current(workspace),p=session.project,closing=closingOf(c);
 if(p.periodSource==='auto'&&closing)return `決算月（${closing}月）から、期首〜${(session.datasets.current||[]).length?'仕訳帳の最終月':'先月'}にしています`;
 if(!closing&&c)return `決算月が未設定です。<button class="btn small" data-edit-company="${esc(c.id)}">決算月を設定</button>`;
 return '自分で設定した期間です';
}
function queueText(q){
 const read=q.total-q.skipped.length-q.failed.length-q.cancelled.length,rest=[q.skipped.length&&`${q.skipped.length}件はとばしました`,q.failed.length&&`${q.failed.length}件は読めませんでした`,q.cancelled.length&&`${q.cancelled.length}件は中止しました`].filter(Boolean);
 return read===q.total?`${q.total}件すべて読み込みました`:`${q.total}件中${read}件を読み込みました${rest.length?'（'+rest.join('、')+'）':''}`;
}
function queueSummaryHTML(){
 const q=queueLog;if(!q||!q.done||q.total<2)return '';
 const list=(label,names)=>names.length?`<br><span class="small">${label}：${names.map(esc).join('、')}</span>`:'';
 return `<div class="notice ${q.skipped.length||q.failed.length||q.cancelled.length?'amber':''} dp-queue"><strong>まとめて読込：${esc(queueText(q))}</strong>${list('とばした資料',q.skipped)}${list('読めなかった資料',q.failed)}${list('中止した資料',q.cancelled)}</div>`;
}
function queueStart(n){queueLog={total:n,skipped:[],failed:[],cancelled:[],done:false};}
// 最後のファイルを読み込む・とばす・中止したときに、全体の結果を知らせる
function queueFinish(){const q=queueLog;if(!q||q.done)return;q.done=true;if(q.total<2)return;toast(queueText(q));const el=$('#queueSummary');if(el)el.innerHTML=queueSummaryHTML();}
function queueCancel(){if(queueLog&&!queueLog.done&&pending)queueLog.cancelled.push(pending.file.name,...files.map(f=>f.name));files=[];pending=null;queueFinish();}
function dataPage(){const p=session.project,done=primaryProgress(),T=window.ReviewTagReports;return heading('SOURCE MATERIAL','資料の読込','CSVの列を確認してから取り込む。データはこのブラウザに保存。',`<button class="btn" data-action="restore">${icon('refresh')}バックアップ復元</button><button class="btn" data-action="backup">${icon('download')}バックアップ</button><button class="btn danger" data-action="new">新規案件</button>`)+`<div id="queueSummary" aria-live="polite">${queueSummaryHTML()}</div><section class="panel dp-guide" id="materialsGuide"><div class="panelhead"><h2>そろえる資料（freee から CSV で出力）</h2><span class="badge ${done===8?'ok':''}">8ファイル中 ${done} 読込済み</span></div><div class="panelbody"><ol class="steps"><li><strong>当期・前期の仕訳帳</strong>：freee の「仕訳帳」CSV。取引先・品目・部門の列を含む全件を、当期と前期に分けて出力します。</li><li><strong>月次BS と 月次PL</strong>：「表示するタグ」を 取引先・品目・部門 にして、それぞれ1つずつ出力します（BS 3つ・PL 3つ）。金額は円単位、「分類と勘定科目」は同じ列にします。</li></ol><p class="small">タグ別のCSVには科目の合計も入っているので、タグなしのBS・PLは要りません。下のボタンで8ファイルをまとめて選べます。種類は中身から判定し、1ファイルずつ内容を確認してから読み込みます。</p></div></section><div class="dropzone dp-drop" id="dropzone" tabindex="0" role="button" aria-label="CSVファイルを選択"><div>${icon('upload')}</div><h2>CSVをここにドロップ</h2><p>何ファイルでもまとめて入れられます（一度に12ファイルまで）。仕訳帳は取引日と対象期間から当期／前期・過去を、BS・PLは帳票の形式と「表示するタグ」から判定します。freee の CSV（UTF-8・Shift_JIS）に対応しています。</p><div class="actions" style="justify-content:center"><button class="btn primary dp-bulk" data-action="import">${icon('upload')}CSVをまとめて選ぶ（自動判定）</button></div></div><div class="panel panelbody dp-scope"><div class="dp-period"><span class="small">対象期間</span><strong>${esc(p.start)}〜${esc(p.end)}</strong><span class="small">${periodNote()}</span><button class="btn small" data-view="monthly">期間を変える</button></div><label class="checklabel"><input type="checkbox" id="completeData" ${p.complete?'checked':''}><span><strong>当期の仕訳帳は、対象期間の全取引・全口座を含む</strong><br><span class="small">仕訳の全行・全科目を含むと確認した場合に、貸借差額と「計上のない月」を抽出します。読取エラーや番号不明は判定を保留します。未登録取引の影響は別途確認してください。</span></span></label><div class="tinyline">期間外の行はレビュー対象に含めません。読み込んだ行数と対象行数を照合してください。</div></div><div class="datasetcards dp-primary">${PRIMARY_TYPES.map(key=>E.reportType(key)?reportCard(key):datasetCard(key,E.TYPES[key],PRIMARY_DESC[key])).join('')}</div><details class="panel dp-more"${Object.keys(E.TYPES).some(k=>!PRIMARY_TYPES.includes(k)&&session.datasets[k].length)?' open':''}><summary>追加資料（必要な分析だけ）<span class="small">未登録明細・月末残高・債権債務・前期のPL／BS</span></summary><div class="datasetcards">${Object.entries(E.TYPES).filter(([key])=>!PRIMARY_TYPES.includes(key)).map(([key,t])=>datasetCard(key,t,'',true)).join('')}</div></details><section class="panel" style="margin-top:20px"><div class="panelhead"><h2>元資料との残高照合</h2><span class="small">1件ずつ追加できる</span></div><form id="balanceForm" class="panelbody"><div class="balanceform"><div class="field"><label for="balanceAccount">科目・口座</label><input id="balanceAccount" name="account" placeholder="例：普通預金" required></div><div class="field"><label for="balanceMonth">基準月</label><input id="balanceMonth" name="month" type="month" value="${p.end}" required></div><div class="field"><label for="balanceParty">口座・契約名</label><input id="balanceParty" name="party" placeholder="例：A信金 事業口座"></div><div class="field"><label for="balanceBook">freeeの月末残高</label><input id="balanceBook" name="balance" inputmode="decimal" placeholder="1,000,000" required></div><div class="field"><label for="balanceActual">通帳・返済表の残高</label><input id="balanceActual" name="expected" inputmode="decimal" placeholder="未確認なら空欄"></div><div><button class="btn primary full" type="submit">照合を追加</button></div></div></form></section><div class="notice" style="margin-top:20px">残高CSVは「月・勘定科目・取引先・帳簿残高・資料残高」の縦形式。PDFの残高照合には、上の入力欄か残高テンプレートを使います。残高は科目の通常方向を正として入力します。</div>${session.imports.length?`<section class="panel"><div class="panelhead"><h2>読込履歴</h2></div><div class="tablewrap"><table class="datatable"><thead><tr><th>資料</th><th>ファイル</th><th>行数</th><th>読込日時</th></tr></thead><tbody>${session.imports.map(i=>`<tr><td>${E.TYPES[i.type]?.name||esc(i.type)}${i.tagDimension&&T?.DIMS[i.tagDimension]?`<span class="small">（${esc(T.DIMS[i.tagDimension])}別）</span>`:''}</td><td>${esc(i.name)}</td><td>${Number(i.count).toLocaleString()}</td><td>${esc(i.at?.slice(0,16).replace('T',' '))}</td></tr>`).join('')}</tbody></table></div></section>`:''}`;}
function datasetCard(key,t,desc='',optional=false){const count=session.datasets[key].length;const meta=session.imports.filter(i=>i.type===key).at(-1);const dates=session.datasets[key].map(r=>r.date).filter(Boolean).sort();return `<section class="panel dataset" data-dp-type="${key}"><div class="datasetrow"><h3>${esc(t.name)}${optional?'<span class="dp-optional">（任意）</span>':''}</h3><span class="badge ${count?'ok':''}">${count?count.toLocaleString()+'行':'未読込'}</span></div><p>${desc||t.desc}</p><div class="rowactions"><button class="btn small" data-action="import" data-type="${key}">${icon('upload')}CSV読込</button><button class="btn small" data-action="template" data-type="${key}">テンプレート</button>${count?`<button class="btn small danger" data-action="removeDataset" data-type="${key}">削除</button>`:''}</div><div class="datasetstatus">${dates.length?`${dates[0]}〜${dates.at(-1)}`:'資料を読み込むと件数・期間を表示'}${meta?`<br>${esc(meta.name)}`:''}</div></section>`;}
function checkPage(){const completed=Object.values(session.manual).filter(x=>x.status==='done'||x.status==='na').length;return heading('REVIEW CHECKLIST','チェックシート','自動抽出と、資料を見て判断する項目を区別して記録。',`<button class="btn" data-action="backup">${icon('download')}記録を保存</button><button class="btn primary" data-view="memo">引継ぎメモを見る</button>`)+`<div class="notice">このシートには <strong>${E.CHECKS.length}項目</strong>。消費税チェックは手動記録として含めています。「抽出条件に該当なし」は確認完了ではありません。</div><div class="checkgrid">${result.coverage.map(c=>{const m=session.manual[c.key]||{status:'todo',note:''};return `<section class="panel checkcard"><header><span class="checkcode">${c.code}</span><span class="badge ${c.disabled?'':c.count?'warn':''}">${c.state}</span></header><h3>${c.title}</h3><p>${c.method}</p><div class="tinyline"><strong>必要な資料</strong>　${c.needs}</div>${c.key==='vat'&&KH?kubunCheckBox():''}${c.count?`<button class="btn small" style="margin-top:9px" data-action="showCheck" data-check="${c.key}">${c.count}件の候補を確認</button>`:''}<label for="manual_${c.key}" class="small" style="display:block;margin-top:12px">確認状況（人の判断）</label><select id="manual_${c.key}" data-manual-status="${c.key}"><option value="todo" ${m.status==='todo'?'selected':''}>未確認</option><option value="done" ${m.status==='done'?'selected':''}>確認済み</option><option value="ask" ${m.status==='ask'?'selected':''}>上司・お客様へ確認</option><option value="na" ${m.status==='na'?'selected':''}>該当なし（確認済み）</option><option value="defer" ${m.status==='defer'?'selected':''}>今回深追いせず</option></select><textarea aria-label="${c.title}の確認メモ" data-manual-note="${c.key}" placeholder="確認した資料・根拠・質問を記録">${esc(m.note)}</textarea></section>`;}).join('')}</div>`;}
function memoFor(f){const d=decision(f.id),c=E.CHECKS.find(c=>c.key===f.check),h=E.History.contextFor(result.history,f);return `【${c?.code} ${c?.title}】\n確認状況：${decisionNames[d.status]||'未確認'}\n候補：${f.title}\n気になる理由：${f.reason}\n${window.ReviewVariance?window.ReviewVariance.findingText(f,session,result):''}${INS?INS.memo(f):''}確認の観点：${f.lesson}\n${f.decisionEvidence?.length?'指摘に使った記載：'+f.decisionEvidence.join('／')+'\n':''}${f.contextNotes?.length?'取引情報を踏まえた確認：'+f.contextNotes.join('／')+'\n':''}明細：\n${evidenceText(f)}\n${h?.matches.length?'過去照合（候補の先頭仕訳）：\n'+E.History.contextText(h)+'\n':''}${d.note?'確認した事実・質問：'+d.note:'次の確認：'+f.steps.join(' → ')}\n対応：メモ記録のみ。修正仕訳未作成。`;}
function allMemo(){
 const p=session.project;
 const imports=session.imports.map(i=>`${E.TYPES[i.type]?.name||i.type} ${i.count}行${i.errors?'（読取エラー '+i.errors+'行を利用者指定で除外）':''}`).join('／')||'未読込';
 let txt=`${session.demo?'【操作サンプル・架空データ】\n':''}【自計化チェック 引継ぎメモ】\n案件：${p.name}\n対象期間：${p.start}〜${p.end}\n事業者：${p.type==='corp'?'法人':'個人事業主'}\n読込資料：${imports}\n対象仕訳：${result.current.length}行\nデータ範囲：${p.complete?'対象期間の全取引を含むと利用者指定':'網羅性未指定・欠落月抽出なし'}\n判定範囲：ルールによる確認候補の抽出。証憑の確認・税務判断は別途。\n修正仕訳：未作成\n\n`;
 const manualStatuses={todo:'未確認',done:'確認済み',ask:'確認依頼',na:'該当なし（確認済み）',defer:'今回深追いせず'};
 if(result.history)txt+=`過去履歴：蓄積 ${result.history.stats.uploaded}行／参照 ${result.history.stats.journals}仕訳（${session.project.start}より前）。過去の処理は正解の保証ではありません。\n\n`;
 txt+=result.findings.length?result.findings.map(memoFor).join('\n\n────────────\n\n'):'現在の抽出条件では候補なし。未読込・手動確認の項目は下記参照。';
 const currentIds=new Set(result.findings.map(f=>f.id)),oldNotes=Object.entries(session.decisions).filter(([id,d])=>!currentIds.has(id)&&typeof d?.note==='string'&&d.note.trim());
 if(oldNotes.length)txt+='\n\n【資料更新前などの確認メモ：現在の候補には未適用】\n'+oldNotes.map(([id,d])=>`${d.reviewLabel||'旧候補 '+id}${d.reviewPeriod?'／'+d.reviewPeriod:''}\n当時の記録：${decisionNames[d.status]||'未確認'}\n${d.note}`).join('\n\n');
 txt+='\n\n【チェックシート・確認範囲】\n'+result.coverage.map(c=>{const m=session.manual[c.key]||{status:'todo',note:''};return `${c.code} ${c.title}：${c.state}／人の確認：${manualStatuses[m.status]||'未確認'}${m.note?'\n  メモ：'+m.note:''}`;}).join('\n');
 txt+=kubunMemo();
 if(session.teacher.turns.length)txt+='\n\n【先生デスクの回答記録】\n'+teacherText();
 return txt;
}
function memoPage(){return heading('HANDOVER NOTES','引継ぎメモ','自計化アプリへ貼り付ける記録。読込範囲と未確認事項も残す。',`<button class="btn" data-action="downloadMemo">${icon('download')}テキスト保存</button><button class="btn primary" data-action="copyAll">${icon('copy')}メモをコピー</button>`)+`<section class="panel"><div class="notesummary">${session.project.start}〜${session.project.end}　·　${result.findings.length}件の確認候補　·　修正仕訳未作成</div><textarea id="memoText" class="memoarea" aria-label="引継ぎメモ（編集可能）"></textarea></section><p class="tinyline">この欄の直接編集は保存されません。各候補・チェックシートのメモ欄で記録するとバックアップにも残ります。</p>`;}
function helpPage(){return heading('REFERENCE LIBRARY','根拠と使い方','2026年10月2日確認。内部手順と税務の要件を分けて実装。')+`<div class="helpgrid"><section class="panel"><div class="panelhead"><h2>最初の3ステップ</h2></div><div class="panelbody"><ol class="steps"><li>会社を追加し、個人／法人と決算月を設定。対象期間は決算月から「期首〜先月」に自動でそろいます（月次PL・BS画面でいつでも変更できます）。</li><li>freeeから、当期・前期の仕訳帳と、「表示するタグ」を取引先・品目・部門にした月次BS・月次PL（各3つ）をCSVで出力し、「資料の読込」の「CSVをまとめて選ぶ」で一度に読み込みます。1ファイルずつ列と読込先を確認できます。</li><li>確認キューの候補を選び、解説・元資料を確認してメモを保存。月次PL・BS画面では、上の目次から見たい欄へ移動できます。</li></ol><p style="margin-top:15px">試算表・通帳・返済表の残高は「元資料との残高照合」に入力。未登録明細と期日一覧はテンプレートで追加できます。</p><button class="btn" style="margin-top:17px" data-action="demo">操作サンプルを試す</button></div></section><section class="panel"><div class="panelhead"><h2>消費税区分（同じアプリ内）</h2></div><div class="panelbody"><ul><li>左のメニュー「消費税区分」で、消費税区分別チェッカーをそのまま使えます。判定の仕組み・画面・保存は単体版と同じです。</li><li>会社の選択とテーマは自計化レビューと共通。区分チェックの中で別の会社を開くと、こちらもその会社に切り替わります。</li><li>資料の読込で仕訳帳を入れるとき「消費税区分チェックにも同じCSVを入れる」を選ぶと、両方が同じ仕訳帳で動きます。読込済みの仕訳帳は「消費税区分」画面のボタンから後で入れることもできます。</li><li>全社バックアップ・会社のバックアップには、区分チェックの判断・学習ルール・取引先の登録状況・取り込んだCSVも含まれます（判定ルールの設定は含みません）。復元では今の記録を優先し、足りない分だけを補います。</li><li>区分チェックに入れた仕訳帳は「【当期】」「【過去】」の印付きの名前で保存します。資料の読込で「置き換える」を選ぶと、区分チェック側の同じ印のファイルも入れ替わります。</li><li>インボイスのない仕入の控除割合は、2026年10月1日〜2028年9月30日は7割（控70）として判定します（令和8年度改正）。</li></ul></div></section><section class="panel"><div class="panelhead"><h2>料金・データ・保存</h2></div><div class="panelbody"><ul><li>ネットワーク接続、外部AI API、決済処理、広告はありません。ローカル版の利用料は0円です。</li><li>CSVはブラウザの中で解析。読み込んだデータを外部へ送信しません。</li><li>データはこのブラウザのIndexedDBに自動保存。ブラウザデータ削除・別端末・ファイル移動で読めなくなる場合があります。</li><li>節目にJSONバックアップをダウンロード。復元で続きから再開できます。</li><li>「新規案件」は現在のデータを消します。保存したバックアップから復元できます。</li></ul></div></section><section class="panel"><div class="panelhead"><h2>できること・確認が必要なこと</h2></div><div class="panelbody"><p>重複候補、借貸差額、高額消耗品・修繕費、月次変動、私的支出らしい摘要、期日超過、残高差、自動登録ルールの候補を抽出します。確認キューは、資料をそろえる → 残高を確定する → 回収・支払と仮勘定 → 売上・経費の計上 → 税金と区分 → 記帳のしかた の順に、上から片付けられるように並べられます。</p><p style="margin-top:12px">請求書の内容、税務の特例、取引先の法人／個人、源泉徴収の義務、適格請求書の有効性、実際の入金・支払は自動確定できません。</p><p style="margin-top:12px">PDF・画像・Excelの解析、freeeの画面読取、修正、自由なAI相談はこの版の対象外。解説は検証したルールに対応する文章です。</p></div></section><section class="panel"><div class="panelhead"><h2>確認候補の抽出設定</h2></div><form id="thresholdForm" class="panelbody"><div class="field"><label for="largeThreshold">高額・変動差額の目安（円）</label><input id="largeThreshold" name="large" type="number" min="1" max="1000000000" step="1" value="${session.project.large}" required></div><div class="field" style="margin-top:12px"><label for="varianceThreshold">月次変動の目安（％）</label><input id="varianceThreshold" name="variance" type="number" min="1" max="1000" step="1" value="${Math.round(session.project.variance*100)}" required></div><p class="small" style="margin:15px 0">高額の金額は事務所の確定基準ではありません。初期値は10万円、月次変動50%。消耗品10万円・修繕費20万円はチェックシートの固定抽出条件です。</p><button class="btn primary" type="submit">設定を保存・再チェック</button></form></section></div><section class="panel" style="margin-top:20px"><div class="panelhead"><h2>ファクトチェックと参照元</h2><span class="small">確認日：2026-10-02</span></div><div class="panelbody"><div class="factcheck">高額修繕＝資産計上、預り金残高＝未納、法定福利費＝給与の一定割合、同額仕訳＝重複、といった断定は組み込んでいません。抽出した事実と、追加確認が必要な判断を分けています。</div>${E.SOURCES.map(s=>`<div class="sourceitem">${s.url?`<a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.name}</a>`:`<strong>${s.name}</strong>`}<p>${s.note}</p></div>`).join('')}</div></section>`;}
function bindSettings(){
 const form=$('#settings');form.addEventListener('submit',e=>{
   e.preventDefault();const d=new FormData(form),start=d.get('start'),end=d.get('end'),months=E.monthRange(start,end);
   if(!months.length||months.at(-1)!==end)return toast('対象期間は開始〜終了の順で、36か月以内にしてください');
   const conditionsChanged=session.project.type!==d.get('type')||session.project.start!==start||session.project.end!==end;
   if(!['individual','corp'].includes(d.get('type')))return toast('個人事業主か法人かを選択してください');
   const company=W.current(workspace);try{W.update(workspace,company.id,{...company,name:d.get('name')||company.name,entityType:d.get('type')});}catch(err){return toast(err.message);}
   if(conditionsChanged){invalidateChecks();monthlyFocus=null;session.financial.agingComplete=false;}
   session.project={...session.project,type:d.get('type'),start,end,...(session.project.start!==start||session.project.end!==end?{periodSource:'user'}:{})};
   recompute();save();render();toast('対象期間で再チェックしました');
 });
}
function bindReview(){
 bindSettings();
 $('#search').addEventListener('input',e=>{search=e.target.value;$('#findingList').innerHTML=queueList(queueRows());});
}
function bindDropzone(){const z=$('#dropzone');z.addEventListener('dragover',e=>{e.preventDefault();z.classList.add('drag');});z.addEventListener('dragleave',()=>z.classList.remove('drag'));z.addEventListener('drop',e=>{e.preventDefault();z.classList.remove('drag');forceType=null;queueFiles([...e.dataTransfer.files]);});z.addEventListener('keydown',e=>{if(e.target!==z)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();chooseFiles(null);}});}
function chooseFiles(type){const c=W.current(workspace);if(!c)return toast('会社一覧で対象の会社を選んでください');if(!c.entityType){showCompanyDialog(c.id);return toast('読込前に個人／法人の区分を設定してください');}forceType=type||null;importCompanyId=c.id;$('#fileInput').value='';$('#fileInput').click();}
async function queueFiles(list){const c=W.current(workspace);if(!c)return toast('会社を選んでから資料を読み込んでください');if(!c.entityType)return toast('先に個人／法人の区分を設定してください');importCompanyId=c.id;files=list.filter(f=>/\.(csv|tsv|txt)$/i.test(f.name));if(!files.length)return toast('CSV・TSV・テキスト形式を選んでください');if(files.length>12){files=[];return toast('一度に選ぶファイルは12個以内にしてください');}queueTotal=files.length;queueStart(files.length);await nextFile();}
async function nextFile(){
 if(!files.length){pending=null;queueFinish();return;}const file=files.shift(),failed=msg=>{toast(msg);queueLog?.failed.push(file.name);return nextFile();};if(file.size>12*1024*1024)return failed('12MB以内のCSVにしてください');
 const end=M.busy('CSVを読み込み中…');try{
 const target=importCompanyId,bytes=await file.arrayBuffer();if(target!==workspace.activeId){files=[];queueLog=null;return toast('会社が切り替わったため読込を停止しました');}let encoding='utf-8',text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{encoding='shift_jis';text=new TextDecoder('shift_jis').decode(bytes);}
 let rows;try{rows=E.parseCSV(text);}catch(err){return failed(err.message);}
 let type=forceType,detectedReport=null;if(!type){detectedReport=E.detectReportType(rows,session.project);if(detectedReport)type=detectedReport.type;else{const scores=Object.keys(E.TYPES).filter(k=>k!=='prior'&&!E.reportType(k)).map(k=>{const i=E.headerRow(rows,k);return [k,E.TYPES[k].required.filter(f=>E.guessMapping(rows[i],k)[f]>=0).length/E.TYPES[k].required.length];}).sort((a,b)=>b[1]-a[1]);type=scores[0][0];}}
 const h=E.headerRow(rows,type,session.project);pending={file,bytes,rows,encoding,type,autoJournal:!forceType,autoReport:!forceType&&!!detectedReport,companyId:target,headerIndex:h,mapping:E.importMapping(rows,type,h,session.project),unit:F.detectUnit(rows,h),basis:F.detectBasis(rows,h),fingerprint:E.hash(text),mode:['prior','priorPL','priorBS'].includes(type)?'append':'replace',skip:false,scopeAcknowledged:false,historyStatus:'reference'};
 showImport();decorateHistoryImport();
 }catch(err){return failed('CSVを読み込めません：'+err.message);}finally{end();}
}
function decorateHistoryImport(){
 const p=pending;if(!p)return;const dlg=$('#importDialog');let html=dlg.innerHTML.replace(/<section id="historyImportOptions"[^>]*>[\s\S]*?<\/section>/g,'').replace(/<p id="importCompanyScope"[^>]*>[\s\S]*?<\/p>/g,'');
 html=html.replace('<p class="importname">',`<p id="importCompanyScope" class="notice">読込先：<strong>${esc(W.current(workspace)?.name||'')}</strong>。この会社の資料か確認してください。</p><p class="importname">`);
 if(p.type==='prior'){
   const extra=`<section id="historyImportOptions" class="panelbody"><div class="notice amber">案件：${esc(session.project.name)}。同じ顧客の資料だけを蓄積します。標準は既存履歴に追加。過去の処理を正解とは自動認定しません。</div><label class="checklabel"><input type="checkbox" id="historySameClient" ${p.scopeAcknowledged?'checked':''}>このCSVは、現在の案件と同じ顧客の過去仕訳帳です</label><div class="field" style="margin-top:12px"><label for="historyImportStatus">資料の確認状態</label><select id="historyImportStatus">${Object.entries(E.History.statusNames).map(([k,t])=>`<option value="${k}" ${p.historyStatus===k?'selected':''}>${t}</option>`).join('')}</select></div></section>`;
   html=html.replace('<div class="dialogfoot">',extra+'<div class="dialogfoot">');
 }
 const t=E.TYPES[p.type],valid=t.required.every(k=>p.mapping[k]>=0)&&p.preview.items.length&&(!p.preview.errors.length||p.skip)&&p.periodValid!==false&&(p.type!=='prior'||p.scopeAcknowledged);
 dlg.innerHTML=html.replace(/<button class="btn primary" data-action="commitImport"[^>]*>/,`<button class="btn primary" data-action="commitImport" ${valid?'':'disabled'}>`);
}
function journalImportPeriod(p,preview){
 if(E.reportType(p.type))return reportImportPeriod(p,preview);
 if(!['current','prior'].includes(p.type))return {valid:true,html:''};
 const period=E.journalPeriod(preview.items,session.project),valid=period.recommended===p.type;
 let message;
 if(period.kind==='invalid')message='対象期間を確認してください。開始月と終了月の設定後に読み込めます。';
 else if(period.kind==='empty')message='取引日を読み取れません。見出し行と日付列の対応を確認してください。';
 else if(period.kind==='mixed')message='対象開始月より前の仕訳と、当期以降の仕訳が混在しています。freeeで期間を分けてCSV出力し、それぞれ当期／前期・過去として読み込んでください。';
 else if(period.kind==='future')message='CSVの取引日はすべて対象終了月より後です。対象期間とファイルを確認してください。';
 else if(!valid)message=period.kind==='prior'?'このCSVは対象開始月より前の仕訳帳です。「資料の種類」を「前期・過去の仕訳帳」に変更してください。':'このCSVは当期の仕訳を含みます。「資料の種類」を「当期の仕訳帳」に変更してください。';
 else message=period.kind==='prior'?'対象開始月より前の仕訳帳です。前期・過去の資料として取り込みます。':`当期の仕訳帳です。対象期間内の${period.current.toLocaleString()}行をレビューします。${period.future?'対象終了月より後の行も保存しますが、現在のレビュー対象には含めません。':''}`;
 const label=p.autoJournal?'取引日による自動判定':'取引日と読込先の確認';
 return {valid,message,html:`<div id="journalPeriodNotice" class="notice ${valid?'':'error'}" style="margin-top:12px"><strong>${label}：${valid?esc(E.TYPES[p.type].name):'読込先・期間の確認が必要'}</strong><br>${esc(message)}<br><span class="small">対象期間 ${esc(session.project.start)}〜${esc(session.project.end)} ／ 当期 ${period.current.toLocaleString()}行 ／ 前期・過去 ${period.prior.toLocaleString()}行 ／ 対象終了月後 ${period.future.toLocaleString()}行</span>${extendPeriodButton(p,preview,period)}</div>`};
}
// 当期の仕訳帳が対象終了月より後まであるとき、ワンクリックで期間を広げる（押すまでは変えない）
function extendPeriodButton(p,preview,period){
 if(p.type!=='current'||!period.future||!['current','future'].includes(period.kind))return '';
 const ms=preview.items.map(r=>String(r.date||'').slice(0,7)).filter(m=>/^\d{4}-\d{2}$/.test(m)).sort(),first=ms[0],last=ms.at(-1);if(!last)return '';
 const closing=closingOf(W.current(workspace)),start=period.kind==='current'?session.project.start:closing?shiftMonth(fiscalEnd(closing,first),-11):first,months=E.monthRange(start,last);
 if(!months.length||months.at(-1)!==last)return `<br><span class="small">CSVの最終月 ${esc(last)} まで広げると36か月を超えるため、対象期間を見直してください。</span>`;
 const text=period.kind==='current'?`対象期間を ${last} まで広げる`:`対象期間を ${start}〜${last} に変える`;
 return `<div class="dp-extend"><button type="button" class="btn small primary" data-action="extendPeriod" data-start="${esc(start)}" data-end="${esc(last)}">${esc(text)}</button><span class="small">${period.kind==='current'?`対象終了月より後の ${period.future.toLocaleString()}行もレビューに含めます。`:'CSVの取引日に合わせます。'}</span></div>`;
}
function reportImportPeriod(p,preview){
 const period=E.reportPeriod(preview.items,p.type,session.project,preview.reportStats||{}),valid=period.recommended===p.type;
 let message;if(period.kind==='invalid')message='対象期間の開始月と終了月を確認してください。';
 else if(period.kind==='empty')message='帳票の年月を確定できません。年度付きの期間・月見出しと、読取エラーを確認してください。';
 else if(period.kind==='future')message='帳票の月はすべて対象終了月より後です。対象期間と資料を確認してください。';
 else if(period.kind==='mixed')message='当期と過去の帳票月が混在し、同じ年度の表示範囲を確定できません。年度ごとにPL／BSを分けて再出力してください。';
 else if(!valid)message='この帳票は「'+E.TYPES[period.recommended].name+'」に対応する期間です。「資料の種類」を変更してください。前期資料で当期を上書きしません。';
 else message=period.kind==='prior'?'対象開始月より前の帳票です。前期・過去の資料として分けて保存し、当期のPL／BSを保持します。':'当期の帳票です。BSの期首・前月末と対象期間外の月も保存し、選択した対象期間をレビューします。';
 const source=preview.reportStats?.sourcePeriod,range=source?source.start+'〜'+source.end:period.start&&period.end?period.start+'〜'+period.end:'未確定';
 return {valid,message,html:`<div id="reportPeriodNotice" class="notice ${valid?'':'error'}" style="margin-top:12px"><strong>${p.autoReport?'帳票の年月による自動判定':'帳票の年月と読込先の確認'}：${valid?esc(E.TYPES[p.type].name):'読込先・期間の確認が必要'}</strong><br>${esc(message)}<br><span class="small">帳票期間 ${esc(range)} ／ 対象期間 ${esc(session.project.start)}〜${esc(session.project.end)} ／ 当期 ${period.current}か月 ／ 対象開始月前 ${period.prior}か月</span></div>`};
}
function showImport(){const p=pending,normalizeOptions={project:session.project,unit:p.unit,basis:p.basis,requireReportYear:!!p.autoReport};let t=E.TYPES[p.type],preview=E.normalizeRows(p.rows,p.type,p.mapping,p.headerIndex,normalizeOptions);
 if(p.autoJournal&&['current','prior'].includes(p.type)){
  const detected=E.journalPeriod(preview.items,session.project).recommended;
  if(detected&&detected!==p.type){p.type=detected;p.mode=detected==='prior'?'append':'replace';p.scopeAcknowledged=false;t=E.TYPES[p.type];preview=E.normalizeRows(p.rows,p.type,p.mapping,p.headerIndex,{project:session.project,unit:p.unit,basis:p.basis});}
 }
 if(p.autoReport&&E.reportType(p.type)){
  const detected=E.reportPeriod(preview.items,p.type,session.project,preview.reportStats||{}).recommended;
  if(detected&&detected!==p.type){p.type=detected;p.mode=['priorPL','priorBS'].includes(detected)?'append':'replace';t=E.TYPES[p.type];preview=E.normalizeRows(p.rows,p.type,p.mapping,p.headerIndex,normalizeOptions);}
 }
 p.preview=preview;const period=journalImportPeriod(p,preview);p.periodValid=period.valid;const mapped=t.required.every(k=>p.mapping[k]>=0),valid=mapped&&preview.items.length&&(!preview.errors.length||p.skip)&&period.valid;const dates=preview.items.map(r=>r.date).filter(Boolean).sort();$('#importDialog').innerHTML=`<div class="dialoghead"><div><div class="eyebrow">IMPORT PREVIEW</div><h2 id="importTitle">列の対応を確認</h2></div><button class="close" data-action="closeImport" aria-label="閉じる">×</button></div><div class="dialogbody"><p class="importname"><strong>${esc(p.file.name)}</strong>${queueTotal>1?`<span class="small queue-step">　${queueTotal-files.length}／${queueTotal}件目</span>`:''}</p><div class="mapping"><div class="field"><label for="importType">資料の種類</label><select id="importType">${Object.entries(E.TYPES).map(([k,x])=>`<option value="${k}" ${k===p.type?'selected':''}>${x.name}</option>`).join('')}</select></div><div class="field"><label for="encoding">文字コード</label><select id="encoding"><option value="utf-8" ${p.encoding==='utf-8'?'selected':''}>UTF-8</option><option value="shift_jis" ${p.encoding==='shift_jis'?'selected':''}>Shift_JIS</option></select></div><div class="field"><label for="headerIndex">見出し行</label><select id="headerIndex">${p.rows.slice(0,Math.min(25,p.rows.length-1)).map((r,i)=>`<option value="${i}" ${i===p.headerIndex?'selected':''}>${i+1}行目：${esc(r.slice(0,3).join(' / ').slice(0,60))}</option>`).join('')}</select></div><div class="field"><label for="importMode">既存データへの反映</label><select id="importMode"><option value="replace" ${p.mode==='replace'?'selected':''}>${E.reportType(p.type)?'同じ帳票・同じタグの分を置き換える（他のタグ別は残す）':'同じ種類の資料を置き換える'}</option><option value="append" ${p.mode==='append'?'selected':''}>既存資料に追加する</option></select></div></div><details ${mapped?'':'open'}><summary>列の対応 ${mapped?'（必須列を検出）':'（必須列の指定が必要）'}</summary><div class="mapping">${Object.keys(t.fields).map(k=>`<div class="field"><label for="map_${k}">${E.LABELS[k]} ${t.required.includes(k)?'＊':''}</label><select id="map_${k}" data-map="${k}"><option value="-1">指定なし</option>${p.rows[p.headerIndex].map((h,i)=>`<option value="${i}" ${p.mapping[k]===i?'selected':''}>${i+1}列：${esc(D.headerLabel(p.rows[p.headerIndex],i))}</option>`).join('')}</select></div>`).join('')}</div></details><p class="previewrange">有効 ${preview.items.length.toLocaleString()}行 ／ 読取エラー ${preview.errors.length}行${dates.length?`　期間 ${dates[0]}〜${dates.at(-1)}`:''}</p>${period.html}${preview.errors.length?`<div class="notice error" style="margin-top:12px">読取エラー：${preview.errors.slice(0,6).map(e=>`${e.line}行目 ${esc(e.fields.join('・'))}`).join('／')}${preview.errors.length>6?' ほか':''}<br>日付は年付き、金額は数字が必要です。列の対応と原CSVを確認してください。<label class="checklabel checkbox-row"><input id="skipErrors" type="checkbox" ${p.skip?'checked':''}>エラー行を除外して取り込む（除外件数を記録）</label></div>`:''}${financialImportOptions(p,preview)}${KH&&['current','prior'].includes(p.type)?`<label class="checklabel checkbox-row kubunshare"><input id="shareKubun" type="checkbox" ${p.shareKubun!==false?'checked':''}><span>消費税区分チェックにも同じCSVを入れる<br><span class="small">同じ会社の「消費税区分」画面で、科目×税区分の違和感チェックに使います。freeeの仕訳帳・総勘定元帳の形式だけ読み取ります。</span></span></label>`:''}${reportTotalsPreview(preview)}${journalImportSummary(preview)}${D.importSummary(preview)}<div class="previewtable" style="margin-top:15px"><table class="datatable"><thead><tr>${p.rows[p.headerIndex].slice(0,8).map((h,i)=>`<th>${esc(D.headerLabel(p.rows[p.headerIndex],i))}</th>`).join('')}</tr></thead><tbody>${p.rows.slice(p.headerIndex+1,p.headerIndex+5).map(r=>`<tr>${r.slice(0,8).map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="small" style="margin-top:12px">月次PL・BSは横形式にも対応。月・科目・金額のプレビューと、列の対応を確認してから取り込んでください。</p></div><div class="dialogfoot"><button class="btn" data-action="closeImport">${files.length?'残りもすべて中止':'キャンセル'}</button>${files.length?`<button class="btn" data-action="skipImport">この資料をとばして次へ</button>`:''}<button class="btn primary" data-action="commitImport" ${!valid?'disabled':''}>${preview.items.length.toLocaleString()}行を読み込む${files.length?'（次へ）':''}</button></div>`;if(!$('#importDialog').open)$('#importDialog').showModal();}
function tagVariantNotice(p,preview){
 const T=window.ReviewTagReports;if(!T||!E.reportType(p.type)||!preview.items.length)return '';
 const pl=T.plan(session,p.type,preview.items,{mode:p.mode}),label=pl.dim?T.DIMS[pl.dim]:'',out=[];
 const others=T.materials(session).find(m=>m.type===p.type)?.dims.filter(d=>d.loaded&&d.dim!==pl.dim).map(d=>d.label)||[];
 out.push(pl.dim?`<strong>表示するタグ：${esc(label)}</strong>　${esc(label)}別の内訳 ${pl.details.toLocaleString()}行（${pl.detailAccounts}科目）と、科目合計 ${pl.parents.toLocaleString()}行を分けて保存します。内訳は科目合計に足しません。`:`<strong>表示するタグ：なし</strong>　科目合計 ${pl.parents.toLocaleString()}行を保存します。`);
 if(p.mode==='replace')out.push(others.length?`読込済みの ${esc(others.join('・'))}別 の内訳は残します（置き換えるのは${pl.dim?'同じ「'+esc(label)+'別」':'科目合計'}だけです）。`:'');
 if(pl.conflicts.length){const c=pl.conflicts[0];out.push(`読込済みの帳票と科目合計が ${pl.conflicts.length}か所 違います（例：${esc(c.account)} ${esc(c.date)} ${money(c.old)} → ${money(c.new)}）。この帳票の値を使います。freeeの出力時点が違う可能性があります。`);}
 if(pl.droppedAccounts.length)out.push(`読込済みの帳票にあってこの帳票にない科目（${esc(pl.droppedAccounts.slice(0,4).join('・'))}${pl.droppedAccounts.length>4?' ほか':''}）は、0円でないため外します。`);
 for(const st of pl.stale)out.push(`科目合計が違う科目の ${esc(st.label)}別 の内訳（${esc(st.accounts.slice(0,3).join('・'))}${st.accounts.length>3?' ほか':''}）は外れます。同じ時点で出力したCSVをそろえて読み込むと、すべて残ります。`);
 if(pl.overlap)out.push(`同じ月・科目・内訳の行が ${pl.overlap.toLocaleString()}行 重なっています。「置き換える」を選ぶか、重ならない月の帳票を追加してください。`);
 const warn=pl.conflicts.length||pl.stale.length||pl.droppedAccounts.length||pl.overlap;
 return `<div id="tagVariantNotice" class="notice ${warn?'amber':''}" style="margin-top:10px">${out.filter(Boolean).join('<br>')}</div>`;
}
function financialImportOptions(p,preview){
 if(!E.reportType(p.type))return '';
 return `<section class="panelbody"><div class="mapping"><div class="field"><label for="financialImportUnit">帳票の金額単位</label><select id="financialImportUnit"><option value="1" ${p.unit!==1000?'selected':''}>円（正確な照合用）</option><option value="1000" ${p.unit===1000?'selected':''}>千円（概数・照合保留）</option></select></div>${E.reportType(p.type)==='monthlyPL'?`<div class="field"><label for="financialImportBasis">PLの表示方法</label><select id="financialImportBasis"><option value="monthly" ${p.basis!=='cumulative'?'selected':''}>単月の金額</option><option value="cumulative" ${p.basis==='cumulative'?'selected':''}>累計（取込不可・単月で再出力）</option></select></div>`:'<div class="field"><label>BSの表示方法</label><p>各月末残高。合算しません。</p></div>'}</div><div class="notice">${preview.reportStats?`${preview.reportStats.accounts}科目・表示行 ／ ${preview.reportStats.months.join('・')} ／ ${p.unit===1000?'千円から円に換算':'円単位'}${preview.reportStats.openingMonth?'<br>期首残高は '+preview.reportStats.openingMonth+' 末の残高として保持し、最初の月の増減照合に使います。':''}`:'科目と年月の列を確認してください。'}<br>合計・利益行はそのまま表示し、科目合計に重ねません。${['priorPL','priorBS'].includes(p.type)?'前期・過去の資料として保存し、当期の資料を保持します。':'対象期間外の列は保持しますが、レビュー対象に含めません。'}</div>${tagVariantNotice(p,preview)}${(preview.warnings||[]).map(w=>`<div class="notice amber" style="margin-top:10px">${esc(w)}</div>`).join('')}</section>`;
}
function reportTotalsPreview(preview){
 const rows=preview.reportStats?.reportedTotals||[];if(!rows.length)return '';
 const value=n=>Number.isFinite(n)?money(n):'未読込';
 return `<details class="panelbody"><summary>CSVの期間累計を確認（${rows.length}科目・表示行）</summary><p class="small" style="margin:12px 0">期間累計はCSVに含まれる月全体の合計として保存します。レビューの対象期間合計は、選択した月の金額から別に計算します。</p><div class="tablewrap"><table class="datatable"><thead><tr><th>科目</th><th>CSVの期間累計</th><th>CSVの月別合計</th><th>差額</th></tr></thead><tbody>${rows.slice(0,100).map(r=>`<tr><td>${esc(r.account)}</td><td>${value(r.reported)}</td><td>${value(r.calculated)}</td><td>${value(r.difference)}</td></tr>`).join('')}</tbody></table></div>${rows.length>100?'<p class="small">先頭100行を表示。全件の期間累計は保存データに保持します。</p>':''}</details>`;
}
function journalImportSummary(preview){
 const s=preview.journalStats;if(!s)return '';
 return `<div class="notice" style="margin-top:12px"><strong>複合仕訳は全行をまとめて確認</strong><br>CSV内のまとまり ${s.groups}件 ／ 読込行の貸借一致 ${s.balanced}件${s.inherited?` ／ 日付・番号を引き継いだ行 ${s.inherited}行`:''}${s.ambiguous?`<br>番号の対応が不明なまとまり ${s.ambiguous}件。仕訳番号とNo.の列を確認してください。`:''}<br><span class="small">元CSVに含まれない行は補えません。科目で絞り込んだCSVでは、貸借判定を保留します。</span></div>`;
}
function balanceSummary(f){
 if(!f.balanceTotals)return '';
 return `<div class="teachsection"><h3>今回の集計範囲</h3><p>読込 ${f.rows.length}行<br>借方合計：${money(f.balanceTotals.debit)}<br>貸方合計：${money(f.balanceTotals.credit)}<br>${f.dataReview?'仕訳全体の貸借判定は保留しています。':'全行指定済みの資料内で差額を確認しています。'}</p></div>`;
}
async function commitImport(){
 const p=pending;if(!p)return;const t=E.TYPES[p.type];
 if(p.companyId!==workspace.activeId)return toast('会社が切り替わりました。対象会社で資料を選び直してください');
 const period=journalImportPeriod(p,p.preview);if(!period.valid)return toast(period.message);
 if(p.type==='prior'&&!p.scopeAcknowledged)return toast('同じ顧客の資料であることを確認してください');
 if(!t.required.every(k=>p.mapping[k]>=0)||!p.preview.items.length||p.preview.errors.length&&!p.skip)return;
 const duplicate=session.imports.some(i=>i.type===p.type&&i.fingerprint===p.fingerprint);
 if(duplicate&&p.mode==='append')return toast('同じファイルは読込済みです。重複追加を止めました');
 const T=window.ReviewTagReports,datasetItems=E.reportType(p.type)?p.preview.items.filter(r=>T.inDataset(p.type,r)):p.preview.items;
 if(datasetItems.length+(p.mode==='append'?session.datasets[p.type].length:0)>100000)return toast('資料1種類につき10万行以内にしてください');
 if(E.reportType(p.type)&&p.preview.items.length-datasetItems.length+(session.tagReports||[]).length>300000)return toast('タグ別の帳票は合わせて30万行以内にしてください');
 if(p.mode==='append'&&!session.demo&&(p.type==='current'||p.type==='prior')){
   const ids=new Set(session.datasets[p.type].filter(r=>r.hasId).map(r=>r.date+'|'+r.id));
   if(p.preview.items.some(r=>r.hasId&&ids.has(r.date+'|'+r.id)))return toast('同じ日付・仕訳番号の資料が重なっています。「置き換える」か、重ならない期間のCSVを選んでください');
 }
 if(p.mode==='append'&&!session.demo&&E.reportType(p.type)&&T.plan(session,p.type,p.preview.items,{mode:'append'}).overlap)return toast('同じ月・科目・内訳の帳票が重なっています。置き換えるか、重ならない月の帳票を追加してください');
 if(session.demo){const old=session.project;syncActive();const c=W.add(workspace,{name:W.uniqueName(workspace,'実データ（会社名を設定）'),entityType:old.type});session=W.activate(workspace,c.id);session.project={...session.project,type:old.type,start:old.start,end:old.end,large:old.large,variance:old.variance};importCompanyId=c.id;selected=null;}
 for(const f of result.findings){const d=session.decisions[f.id];if(d?.note){d.reviewLabel=d.reviewLabel||f.title;d.reviewPeriod=d.reviewPeriod||session.project.start+'〜'+session.project.end;}}
 const importSource='csv:'+E.hash(p.fingerprint+'|'+p.file.name),historySource='hsrc:'+E.hash(p.fingerprint+'|'+p.file.name);
 const normalized=p.preview.items.map(r=>({...r,source:p.file.name,importSource,importErrors:p.preview.errors.length,...(p.type==='prior'?{historySource}:{})}));
 if(p.type==='prior')session.history.sources[historySource]={name:p.file.name,status:p.historyStatus||'reference',note:''};
 const importedDates=normalized.map(r=>r.date).filter(Boolean).sort(),monthCounts={};for(const r of normalized)if(!r.opening&&r.date){const m=r.date.slice(0,7);monthCounts[m]=(monthCounts[m]||0)+1;}
 const reportStats=p.preview.reportStats?JSON.parse(JSON.stringify(p.preview.reportStats)):null;
 const record={type:p.type,name:p.file.name,importSource,count:normalized.length,errors:p.preview.errors.length,encoding:p.encoding,fingerprint:p.fingerprint,at:new Date().toISOString(),minDate:importedDates[0]||null,maxDate:importedDates.at(-1)||null,months:Object.keys(monthCounts).sort(),monthCounts,...(reportStats?{reportStats,sourcePeriod:reportStats.sourcePeriod,entity:reportStats.entity}:{}),...(p.preview.journalStats?{journalStats:{...p.preview.journalStats}}:{})};
 if(E.reportType(p.type))T.apply(session,p.type,normalized,{importSource,mode:p.mode,record});
 else{if(p.mode==='replace'){session.datasets[p.type]=normalized;session.imports=session.imports.filter(i=>i.type!==p.type);}else session.datasets[p.type]=session.datasets[p.type].concat(normalized);session.imports.push(record);}
 if(p.type==='current')session.project.complete=false;if(p.type==='aging'){session.financial.agingComplete=false;session.financial.agingAsOf='';}monthlyFocus=null;contextOffset=0;session.demo=false;invalidateChecks();
 $('#importDialog').close();recompute();save();render();toast(`${E.TYPES[p.type].name}を読み込みました${p.preview.errors.length?`（${p.preview.errors.length}行を除外）`:''}`);
 if(KH&&['current','prior'].includes(p.type)&&p.shareKubun!==false){const shareCo=W.current(workspace),label=E.TYPES[p.type].name,file=p.file,opt={prefix:KUBUN_PREFIX[p.type],replace:p.mode==='replace'};file.arrayBuffer().then(buffer=>kubunShareJournals([{name:file.name,buffer}],shareCo,opt)).then(r=>toast(`${label}を読み込みました${r&&r.read?'（消費税区分チェックにも追加）':'（消費税区分チェックでは読めない形式のため追加なし）'}`)).catch(err=>toast('消費税区分チェックへの追加はできませんでした：'+err.message));}
 await nextFile();
}
function template(type){const templates={current:'No.,取引日,借方勘定科目,借方金額,借方税区分,貸方勘定科目,貸方金額,貸方税区分,取引先,摘要\n1,2026/01/15,通信費,11000,課対仕入10%,普通預金,11000,対象外,通信会社,月額通信費\n',prior:'No.,取引日,借方勘定科目,借方金額,貸方勘定科目,貸方金額,取引先,摘要\n1,2025/01/15,通信費,11000,普通預金,11000,通信会社,月額通信費\n',unregistered:'取引日,金額,取引先,摘要\n2026/01/15,-1000,サンプル取引先,未登録出金の内容\n',balances:'月,勘定科目,取引先,帳簿残高,資料残高\n2026-06,普通預金,事業口座,1000000,1000000\n2026-06,借入金,A信金,2000000,2000000\n',aging:'発生日,勘定科目,取引先,期日,決済残額,基準日,管理番号\n2026/01/31,売掛金,サンプル取引先,2026/02/28,100000,2026/06/30,EXAMPLE-001\n',monthlyPL:'月,勘定科目,金額,分類\n2026-01,法定福利費,-1000,経費\n2026-02,法定福利費,-1000,経費\n',monthlyBS:'月,勘定科目,月末残高,分類\n2025-12,売掛金,100000,流動資産\n2026-01,売掛金,200000,流動資産\n',priorPL:'月,勘定科目,金額,分類\n2025-01,売上高,100000,収入金額\n2025-12,売上高,200000,収入金額\n',priorBS:'月,勘定科目,月末残高,分類\n2024-12,売掛金,100000,流動資産\n2025-12,売掛金,200000,流動資産\n'};download(E.TYPES[type].name+'_テンプレート.csv','\uFEFF'+templates[type],'text/csv;charset=utf-8');toast('テンプレートの例を実データに置き換えてください');}
function confirmAction(title,text,fn){const dlg=$('#confirmDialog');dlg.innerHTML=`<div class="dialoghead"><h2>${esc(title)}</h2><button class="close" id="cancelConfirm" aria-label="閉じる">×</button></div><div class="dialogbody"><p>${esc(text)}</p></div><div class="dialogfoot"><button class="btn" id="cancelAction">キャンセル</button><button class="btn primary" id="confirmAction">実行する</button></div>`;dlg.showModal();$('#cancelConfirm').onclick=$('#cancelAction').onclick=()=>dlg.close();$('#confirmAction').onclick=()=>{dlg.close();fn();};}
function askTeacher(question){
 const q=String(question||'').trim();if(!q)return toast('質問を入力してください');
 const context=$('#teacherContext').value||null;const a=E.History.answer(session,result,q,context);a.period=session.project.start+'〜'+session.project.end;
 session.teacher.turns.push(a);session.teacher.turns=session.teacher.turns.slice(-20);if(context)selected=context;view='teacher';save();render();
}
function teacherText(){return session.teacher.turns.map(a=>`${a.stale?'【資料更新後：再確認が必要】\n':''}質問：${a.question}\n${a.title}\n${a.paragraphs.join('\n')}\n${a.steps.join('\n')}\n${a.references.join('\n\n')}\n${a.scope}`).join('\n\n────────\n\n');}
document.addEventListener('click',async e=>{const el=e.target.closest('button');if(!el)return;if(loading)return toast('保存データの読込が終わるまでお待ちください');if(el.dataset.view){navigate(el.dataset.view);return;}if(el.dataset.companyFilter){companyFilter=el.dataset.companyFilter;$('#companyRows').innerHTML=P.companyRows(workspace,companySearch,companyFilter);render();return;}if(el.dataset.openCompany){openCompany(el.dataset.openCompany);return;}if(el.dataset.editCompany){showCompanyDialog(el.dataset.editCompany);return;}if(el.dataset.unarchiveCompany){W.archive(workspace,el.dataset.unarchiveCompany,false);save();render();return;}if(el.dataset.archiveCompany){const c=workspace.companies.find(c=>c.id===el.dataset.archiveCompany);if(!c)return;syncActive();W.archive(workspace,c.id,!c.archived);$('#companyDialog').close();session=W.current(workspace)?.session||E.newSession();recompute();view='companies';save();render();return;}if(el.dataset.monthFinding){selected=el.dataset.monthFinding;view='review';filter='all';search='';render();return;}if(el.dataset.monthAccount){monthlyFocus={account:el.dataset.monthAccount,month:el.dataset.monthPeriod};render();return;}if(el.dataset.action==='closeMonthlyDrill'){monthlyFocus=null;render();return;}if(el.dataset.filter){filter=el.dataset.filter;render();return;}if(el.dataset.finding){selected=el.dataset.finding;render();if(innerWidth<960)$('#teacherPanel').scrollIntoView({behavior:M.prefersReduced()?'auto':'smooth'});return;}const a=el.dataset.action;
 if(a==='kubunOpen'){const c=W.current(workspace);if(c&&KH){KH.openedFor=null;KH.open(c).then(updateKubunBar).catch(err=>toast('消費税区分を開けません：'+err.message));}return;}
 if(a==='kubunHome'){if(KH)KH.home().catch(err=>toast(err.message));return;}
 if(a==='kubunPeriod'){if(KH)KH.setPeriod(session.project.start,session.project.end).then(ok=>{toast(ok?'区分チェックの対象期間をレビューに合わせました':'区分チェックのCSVにその期間の月がありません。CSVの期間を確認してください');updateKubunBar();}).catch(err=>toast(err.message));return;}
 if(a==='kubunShare'){if(!kubunJournalCount())return toast('組み立てられる仕訳帳がありません。資料の読込からCSVを入れてください');el.disabled=true;kubunShareAll(W.current(workspace)).then(r=>{toast(r&&r.read?`区分チェックに仕訳帳を入れました（${r.added}ファイル）`:'区分チェックでは読み取れない形式でした。freeeの仕訳帳CSVを区分チェックに直接入れてください');}).catch(err=>{toast('区分チェックに入れられません：'+err.message);updateKubunBar();});return;}
 if(a==='contextNext'||a==='contextPrev'){contextOffset=Math.max(0,contextOffset+(a==='contextNext'?50:-50));$('#contextRows').innerHTML=D.rowsHTML(result.current,contextSearch,contextOffset);window.scrollTo(0,0);return;}
 if(el.dataset.themeChoice){setTheme(el.dataset.themeChoice);return;}
 if(a==='addCompany'||a==='new'){showCompanyDialog();return;}
 if(a==='closeCompanyDialog'){$('#companyDialog').close();return;}
 if(a==='bulkCompanies'){showBulkDialog();return;}
 if(a==='closeBulkDialog'){$('#bulkDialog').close();bulkPlan=null;return;}
 if(a==='previewCompanies'){previewCompanies();return;}
 if(a==='commitCompanies'){if(!bulkPlan||bulkPlan.errors.length||!bulkPlan.items.length)return toast('追加内容を確認してください');try{const added=W.importList(workspace,bulkPlan);for(const c of added)applyAutoPeriod(c);$('#bulkDialog').close();bulkPlan=null;save();render();toast(added.length+'社を追加しました');}catch(err){toast(err.message);}return;}
 if(a==='companyCSV'){$('#companyCSVInput').value='';$('#companyCSVInput').click();return;}
 if(a==='companyTemplate'){download('会社一覧_テンプレート.csv','\uFEFF会社名,担当者,区分,決算月,メモ\n架空のサンプル会社,担当者名,法人,3,例を実際の会社に置き換えてください\n','text/csv;charset=utf-8');return;}
 if(a==='backupAll'){backupAll();return;}
 if(el.dataset.teacherQuestion){askTeacher(el.dataset.teacherQuestion);return;}
 if(a==='copyTeacher'){if(!session.teacher.turns.length)return toast('回答記録がまだありません');copy(teacherText());}
 if(a==='import')chooseFiles(el.dataset.type);if(a==='backup')backup();if(a==='restore'){$('#restoreInput').value='';$('#restoreInput').click();}
 if(a==='demo')confirmAction('操作サンプルを開く','架空の仕訳と残高を、独立したサンプル会社として追加します。',loadDemoCompany);
 if(a==='saveDecision'){if(!selected)return;const note=$('#decisionNote').value,status=$('#decisionStatus').value;if(status==='resolved'&&!note.trim())return toast('確認済みにする場合は、確認した根拠を記録してください');const f=result.findings.find(f=>f.id===selected);session.decisions[selected]={status,note,reviewLabel:f?.title||selected,reviewPeriod:session.project.start+'〜'+session.project.end,...(FO&&f?{topic:FO.topicKey(f)}:{}),at:new Date().toISOString()};save();render();toast('確認記録を保存しました');}
 if(FOU&&a&&a.startsWith('fo')){const k=el.dataset.kind;
  if(a==='foToggle'){FOU.setOrdered(!FOU.ordered());render();}
  else if(a==='foStage'){if(!FOU.ordered())FOU.setOrdered(true);render();if(!FOU.scrollToStage(el.dataset.stage))toast('この段階の項目は、いまの絞り込み・検索では表示されていません');}
  else if(a==='foUsePrev'){const n=FO.usePrevious(session,result,el.dataset.topic);if(n){save();render();toast(`前回の判断を ${n}件に引き継ぎました`);}}
  else if(a==='foClearGone'){if(FO.clearGone(session)){save();render();}}
  else if(a==='foCopy')copy(FOU.exportText(k,session,result));
  else if(a==='foCsv')download(FOU.fileName(k,session),FOU.exportCSV(k,session,result),'text/csv;charset=utf-8');
  else if(a==='foPrint')FOU.print(k,session,result);
  return;}
 if(a==='copyFinding'){const f=result.findings.find(x=>x.id===selected);if(f)copy(memoFor(f));}
 if(a==='copyConsult'){const f=result.findings.find(x=>x.id===selected);if(f)copy('自計化チェックの相談です。修正仕訳は作らず、確認すべき事実と資料、判断を保留すべき点を説明してください。次の記録はルールによる確認候補で、誤りは確定していません。\n\n'+memoFor(f));}
 if(a==='copyAll')copy($('#memoText').value);if(a==='downloadMemo')download('自計化チェック_引継ぎメモ.txt',$('#memoText').value);
 if(a==='template')template(el.dataset.type);
 if(a==='removeDataset'){const type=el.dataset.type;confirmAction('読込資料を削除',`${E.TYPES[type].name}を削除します${E.reportType(type)?'（取引先・品目・部門別の内訳も含む）':''}。元のCSVファイルは削除されません。`,()=>{session.datasets[type]=[];session.imports=session.imports.filter(i=>i.type!==type);if(Array.isArray(session.tagReports))session.tagReports=session.tagReports.filter(r=>r.type!==type);if(type==='current')session.project.complete=false;invalidateChecks();recompute();save();render();toast('読込資料を削除しました');});}
 if(a==='showCheck'){const f=result.findings.find(x=>x.check===el.dataset.check);if(f){selected=f.id;view='review';filter='all';search='';render();}}
 if(a==='extendPeriod'){if(!pending)return;const start=el.dataset.start,end=el.dataset.end,m=E.monthRange(start,end);if(!m.length||m.at(-1)!==end)return toast('対象期間は36か月以内にしてください');setPeriod(session,start,end,'user');save();render();showImport();decorateHistoryImport();toast(`対象期間を${start}〜${end}にしました`);return;}
 if(a==='closeImport'){$('#importDialog').close();queueCancel();}if(a==='skipImport'){$('#importDialog').close();if(pending)queueLog?.skipped.push(pending.file.name);pending=null;await nextFile();}if(a==='commitImport')await commitImport();
});
document.addEventListener('change',e=>{
 if(e.target.dataset.financialRole){const key=e.target.dataset.financialRole;if(!/^(monthlyPL|monthlyBS):/.test(key)||!Object.hasOwn(F.roles,e.target.value))return;invalidateChecks();session.financial.accountRoles[key]=e.target.value;recompute();save();render();return;}
 if(['financialAgingAsOf','financialAgingComplete','financialComparisonConfirmed'].includes(e.target.id)){
   const cfg=session.financial;if(e.target.id==='financialAgingAsOf'&&e.target.value&&!E.date(e.target.value))return toast('基準日を確認してください');
   invalidateChecks();if(e.target.id==='financialAgingAsOf'){cfg.agingAsOf=e.target.value;cfg.agingComplete=false;}if(e.target.id==='financialAgingComplete')cfg.agingComplete=e.target.checked;if(e.target.id==='financialComparisonConfirmed')cfg.comparisonConfirmed=e.target.checked;
   recompute();save();render();return;
 }
 if(pending&&e.target.id==='financialImportUnit'){pending.unit=+e.target.value;showImport();decorateHistoryImport();return;}
 if(pending&&e.target.id==='financialImportBasis'){pending.basis=e.target.value;showImport();decorateHistoryImport();return;}
 if(e.target.id==='completeData'){session.project.complete=e.target.checked;invalidateChecks();recompute();save();render();}
 if(e.target.dataset.manualStatus){const key=e.target.dataset.manualStatus;session.manual[key]={...(session.manual[key]||{}),status:e.target.value};save();}
 if(e.target.id==='shareKubun'){if(pending)pending.shareKubun=e.target.checked;return;}
 if(e.target.id==='importType'){pending.autoJournal=false;pending.autoReport=false;pending.type=e.target.value;pending.headerIndex=E.headerRow(pending.rows,pending.type,session.project);pending.mapping=E.importMapping(pending.rows,pending.type,pending.headerIndex,session.project);pending.skip=false;pending.mode=['prior','priorPL','priorBS'].includes(pending.type)?'append':'replace';pending.scopeAcknowledged=false;pending.unit=F.detectUnit(pending.rows,pending.headerIndex);pending.basis=F.detectBasis(pending.rows,pending.headerIndex);showImport();}
 if(e.target.id==='headerIndex'){pending.headerIndex=+e.target.value;pending.mapping=E.importMapping(pending.rows,pending.type,pending.headerIndex,session.project);pending.skip=false;showImport();}
 if(e.target.id==='encoding'){pending.encoding=e.target.value;try{pending.rows=E.parseCSV(new TextDecoder(pending.encoding).decode(pending.bytes));pending.headerIndex=E.headerRow(pending.rows,pending.type,session.project);pending.mapping=E.importMapping(pending.rows,pending.type,pending.headerIndex,session.project);showImport();}catch(err){toast(err.message);}}
 if(e.target.dataset.map){pending.mapping[e.target.dataset.map]=+e.target.value;showImport();}
 if(e.target.id==='skipErrors'){pending.skip=e.target.checked;showImport();}if(e.target.id==='importMode')pending.mode=e.target.value;
 if(e.target.id==='historySameClient')pending.scopeAcknowledged=e.target.checked;
 if(e.target.id==='historyImportStatus')pending.historyStatus=e.target.value;
 if(pending&&['importType','headerIndex','encoding','skipErrors','importMode','historySameClient','historyImportStatus'].includes(e.target.id)||pending&&e.target.dataset.map)decorateHistoryImport();
 if(e.target.id==='excludeAdjustments'){session.history.excludeAdjustments=e.target.checked;invalidateChecks();recompute();save();render();}
 if(e.target.dataset.historyStatus){const k=e.target.dataset.historyStatus,m=result.history.sources.find(x=>x.key===k);if(!m||!Object.hasOwn(E.History.statusNames,e.target.value))return;session.history.sources[k]={name:m.name,note:m.note,status:e.target.value};invalidateChecks();recompute();save();render();}
});
document.addEventListener('input',e=>{
 if(e.target.id==='companySearch'){companySearch=e.target.value;$('#companyRows').innerHTML=P.companyRows(workspace,companySearch,companyFilter);}
 if(e.target.id==='bulkText'){bulkPlan=null;$('#bulkPreview').innerHTML='<p class="small">内容を変更しました。「追加内容を確認」を押してください。</p>';const button=$('#bulkDialog [data-action="commitCompanies"]');if(button)button.disabled=true;}
 if(e.target.dataset.manualNote){const key=e.target.dataset.manualNote;session.manual[key]={status:'todo',...(session.manual[key]||{}),note:e.target.value};save();}
 if(e.target.id==='contextSearch'){contextSearch=e.target.value;contextOffset=0;$('#contextRows').innerHTML=D.rowsHTML(result.current,contextSearch);}
 if(e.target.id==='historySearch'){historySearch=e.target.value;$('#historyRows').innerHTML=window.ReviewDesk.historyRows(result.history,historySearch);}
 if(e.target.dataset.historyNote){const k=e.target.dataset.historyNote,m=result.history.sources.find(x=>x.key===k);if(!m)return;m.note=e.target.value.slice(0,5000);session.history.sources[k]={name:m.name,status:m.status,note:m.note};for(const j of result.history.journals)if(E.History.sourceKey(j.rows[0])===k)j.sourceNote=m.note;for(const t of session.teacher.turns)t.stale=true;save();}
});
document.addEventListener('submit',e=>{
 if(e.target.id==='companyForm'){
  e.preventDefault();if(loading)return;const fd=new FormData(e.target),key=e.target.dataset.companyId,meta={name:fd.get('name'),owner:fd.get('owner'),entityType:fd.get('entityType'),closingMonth:fd.get('closingMonth'),note:fd.get('note')};
  let periodMsg='';try{let c;if(key){c=workspace.companies.find(x=>x.id===key);const oldType=c.session.project.type;const oldClosing=closingOf(c);c=W.update(workspace,key,meta);if(c.session.project.type!==oldType)invalidateChecks(c.session);const moved=closingOf(c)!==oldClosing?applyAutoPeriod(c):null,pp=c.session.project;periodMsg=moved?`。対象期間を${moved.start}〜${moved.end}にしました（決算月から）`:closingOf(c)!==oldClosing&&closingOf(c)?`。対象期間（${pp.start}〜${pp.end}）は設定済みのため変えていません`:'';if(workspace.activeId===key){session=c.session;recompute();}}else{if(workspace.companies.some(x=>W.nameKey(x.name)===W.nameKey(meta.name)))throw Error('同じ会社名があります。既存の会社を開くか、支店名などで区別してください。');c=W.add(workspace,meta);applyAutoPeriod(c);}$('#companyDialog').close();if(!key)openCompany(c.id);else{save();render();toast('会社の設定を保存しました'+periodMsg);}}catch(err){$('#companyError').textContent=err.message;$('#companyError').classList.remove('hidden');}return;
 }
 if(e.target.id==='teacherForm'){e.preventDefault();askTeacher(new FormData(e.target).get('question'));}
 if(e.target.id==='thresholdForm'){e.preventDefault();const fd=new FormData(e.target),large=+fd.get('large'),variance=+fd.get('variance')/100;if(!Number.isFinite(large)||large<1||large>1000000000||!Number.isFinite(variance)||variance<=0||variance>10)return toast('正しい設定値を入力してください');session.project.large=large;session.project.variance=variance;invalidateChecks();recompute();save();render();toast('抽出設定を更新しました');}
 if(e.target.id==='balanceForm'){e.preventDefault();const fd=new FormData(e.target),balance=E.monetary(fd.get('balance')),expected=E.monetary(fd.get('expected')),dt=E.date(fd.get('month'),true);if(!dt||!fd.get('account').trim()||!Number.isSafeInteger(balance)||(expected!==null&&!Number.isSafeInteger(expected)))return toast('月・科目・金額を確認してください。金額は正確な円整数で入力してください');const r={date:dt,account:fd.get('account').trim(),party:fd.get('party').trim(),balance,expected,source:'残高手入力',line:session.datasets.balances.length+1};const idx=session.datasets.balances.findIndex(x=>x.date===r.date&&x.account===r.account&&x.party===r.party);if(idx>=0)session.datasets.balances[idx]=r;else session.datasets.balances.push(r);session.imports=session.imports.filter(i=>!(i.type==='balances'&&i.name==='手入力'));session.imports.push({type:'balances',name:'手入力',count:session.datasets.balances.filter(x=>x.source==='残高手入力').length,at:new Date().toISOString()});invalidateChecks();recompute();save();render();toast('残高照合を追加しました');}
});
$('#fileInput').addEventListener('change',e=>queueFiles([...e.target.files]));
// v3.2（統合版）の全体バックアップ：レビュー側は会社一覧として、消費税側は会社の対応を付けて取り込む。
// v3.2の「修正済み」「修正不要」は、この版の「確認済み」にしてメモの先頭に元の状態を残す。
function fromUnifiedBackup(x){const w=JSON.parse(JSON.stringify(x.review));for(const c of Array.isArray(w.companies)?w.companies:[]){const ds=c&&c.session&&c.session.decisions;if(ds&&typeof ds==='object')for(const d of Object.values(ds)){if(d&&(d.status==='fixed'||d.status==='unnecessary')){d.note=(d.status==='fixed'?'【v3.2で修正済み】':'【v3.2で修正不要と確認】')+(typeof d.note==='string'?d.note:'');d.status='resolved';}}}let kubun=null;if(x.vat&&x.vat.app==='kubun-kenin'&&Array.isArray(x.vat.companies)){kubun=JSON.parse(JSON.stringify(x.vat));for(const l of Array.isArray(x.links)?x.links:[]){const v=kubun.companies.find(c=>c&&c.id===l.vatId);if(v&&!v.jikoId)v.jikoId=l.reviewId;}}return {workspace:w,kubun};}
$('#restoreInput').addEventListener('change',async e=>{
 const f=e.target.files[0];if(!f||loading)return;if(f.size>100*1024*1024)return toast('全社バックアップは100MB以内にしてください');let incoming;
 let kubunData=null;
 try{incoming=await M.during('バックアップを確認中…',async()=>{const x=JSON.parse(await f.text());if(x&&x.kind==='ashita-unified-backup'&&x.review&&typeof x.review==='object'){const u=fromUnifiedBackup(x);kubunData=u.kubun;return W.validate(u.workspace);}kubunData=x&&x.kubunChecker&&x.kubunChecker.app==='kubun-kenin'?x.kubunChecker:null;if(x.kind==='ledger-atelier-workspace')return W.validate(x);if(x.kind==='ledger-atelier-company')return W.validate({kind:'ledger-atelier-workspace',schema:2,companies:[x.company],activeId:x.company?.id});return W.migrate(E.validateSession(x));});}catch(err){return toast('復元できません：'+err.message);}
 confirmAction('バックアップを追加して復元',`${incoming.companies.length}社分を追加します。同名や同じ識別情報で内容が違う会社は、別の会社として復元し、現在の資料・メモを保持します。`,()=>{try{syncActive();const merged=W.merge(workspace,incoming),first=merged.added.find(c=>!c.archived);if(first)openCompany(first.id);else{save();view='companies';render();}const msg=merged.added.length+'社を復元／同じ内容 '+merged.skipped+'社は追加なし';if(kubunData&&KH){toast(msg+'。消費税区分の記録を確認中…');KH.importAll(kubunData,merged.idMap).then(n=>toast(msg+'。消費税区分は今の記録を残し、足りない分を補いました（新しい会社 '+n+'社）')).catch(()=>toast(msg+'。消費税区分の記録は復元できませんでした'));}else toast(msg);}catch(err){toast(err.message);}});
});
$('#companyCSVInput').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;if(f.size>1024*1024)return toast('会社一覧CSVは1MB以内にしてください');const end=M.busy('会社一覧を読み込み中…');try{const bytes=await f.arrayBuffer();let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('shift_jis').decode(bytes);}$('#bulkText').value=text;previewCompanies();}catch(err){toast(err.message);}finally{end();}});
$('#importDialog').addEventListener('cancel',()=>queueCancel());
// Same product actions, exposed only in browsers supporting the optional standard.
if(document.modelContext?.registerTool){for(const tool of [{name:'read_review_summary',title:'レビューの確認状況',description:'選択中の会社の対象期間、抽出件数、未確認件数を読む。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>({companyId:workspace.activeId,name:W.current(workspace)?.name||null,start:session.project.start,end:session.project.end,rows:result.current.length,findings:result.findings.length,unresolved:result.findings.filter(f=>decision(f.id).status==='open').length})},{name:'navigate_review_section',title:'レビュー画面を開く',description:'会社一覧、レビュー、月次PL・BS、消費税区分、資料、取引の情報、過去履歴、先生、チェックシート、メモ、根拠の画面へ移動する。資料と記録は変更しない。',inputSchema:{type:'object',properties:{section:{type:'string',enum:['companies','review','monthly','kubun','data','context','history','teacher','check','memo','book']}},required:['section'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:input=>{navigate(input?.section);return {section:view};}}])try{Promise.resolve(document.modelContext.registerTool(tool)).catch(()=>{});}catch{}}
window.LedgerApp={getSession:()=>session,getResult:()=>result,getWorkspace:()=>workspace,openCompany,loadDemo:loadDemoCompany,setSession:x=>{monthlyFocus=null;session=E.validateSession(x);let c=W.current(workspace);if(!c){c=W.add(workspace,{name:session.project.name,entityType:session.project.type},session);workspace.activeId=c.id;session=c.session;}else{c.session=session;c.name=session.project.name;c.entityType=session.project.type;}recompute();syncActive();view='review';render();}};
render();initDB().then(()=>{if(KH)setTimeout(()=>KH.ensure(),400);});
})();

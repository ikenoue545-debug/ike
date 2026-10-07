// 資料の読込画面：決算月からの対象期間、CSVのまとめて読込（とばす・まとめの表示）、タグ別の読込状況、
// 「対象期間を広げる」ボタンを、画面の操作で確かめる。
//   node tests/ui-data.js [スクリーンショットの出力先]
'use strict';
const path=require('path'),fs=require('fs');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'/opt/node22/lib/node_modules/playwright');
const ROOT=path.join(__dirname,'..'),FX=path.join(__dirname,'fixtures');
const fail=[];const check=(ok,label,detail)=>{if(!ok)fail.push(label+(detail!==undefined?'：'+JSON.stringify(detail):''));};
(async()=>{
 const out=process.argv[2];if(out)fs.mkdirSync(out,{recursive:true});
 const b=await chromium.launch({executablePath:process.env.CHROME||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
 const p=await b.newPage({viewport:{width:1440,height:960}});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 // 「今日」を固定（決算月からの期間は、今日の前の月までになる）
 await p.clock.setFixedTime(new Date('2026-10-07T10:00:00+09:00'));
 await p.goto('file://'+path.join(ROOT,'dist','自計化レビュー_v3.9.html'));
 await p.waitForFunction(()=>window.LedgerApp&&document.querySelector('[data-view]')&&document.querySelector('[data-action="addCompany"]'));
 await p.waitForTimeout(500);
 const project=()=>p.evaluate(()=>{const x=window.LedgerApp.getSession().project;return {start:x.start,end:x.end,source:x.periodSource||''};});
 const companyForm=async({name,type,closing})=>{
  await p.waitForSelector('#companyDialog[open] #companyForm');
  await p.evaluate(({name,type,closing})=>{const f=document.getElementById('companyForm');if(name!==undefined)f.elements.name.value=name;if(type!==undefined)f.elements.entityType.value=type;if(closing!==undefined)f.elements.closingMonth.value=closing;},{name,type,closing});
  await p.click('#companyForm [type=submit]');await p.waitForFunction(()=>!document.querySelector('#companyDialog[open]'));await p.waitForTimeout(150);
 };
 const toastText=()=>p.evaluate(()=>document.getElementById('toast').textContent);
 // 1) 3月決算の法人：期首 2026-04 〜 先月 2026-09
 await p.evaluate(()=>document.querySelector('[data-action="addCompany"]').click());
 await companyForm({name:'三月決算の会社（架空）',type:'corp',closing:'3'});
 const corp=await project();check(corp.start==='2026-04'&&corp.end==='2026-09'&&corp.source==='auto','3月決算の既定の期間',corp);
 // 決算月を変えると、自動の期間はついてくる
 const corpId=await p.evaluate(()=>window.LedgerApp.getWorkspace().activeId);
 await p.click('[data-view="companies"]');await p.evaluate(id=>document.querySelector(`[data-edit-company="${id}"]`).click(),corpId);
 await companyForm({closing:'6'});
 const corp6=await project();check(corp6.start==='2026-07'&&corp6.end==='2026-09','決算月を6月に変えたときの期間',corp6);
 // 自分で期間を決めたあとは、決算月を変えても期間は変えない
 await p.click('[data-view="monthly"]');await p.waitForSelector('#settings');
 await p.fill('#periodStart','2026-01');await p.fill('#periodEnd','2026-06');await p.click('#settings [type=submit]');await p.waitForTimeout(200);
 await p.click('[data-view="companies"]');await p.evaluate(id=>document.querySelector(`[data-edit-company="${id}"]`).click(),corpId);
 await companyForm({closing:'12'});
 const corpUser=await project(),corpToast=await toastText();
 check(corpUser.start==='2026-01'&&corpUser.end==='2026-06'&&corpUser.source==='user','自分で決めた期間は変えない',corpUser);
 check(/設定済みのため変えていません/.test(corpToast),'期間を変えなかったことを知らせる',corpToast);
 // 2) 個人事業主（決算月は12月）：2026-01 〜 2026-09
 await p.click('[data-view="companies"]');await p.evaluate(()=>document.querySelector('[data-action="addCompany"]').click());
 await companyForm({name:'やまだデザイン事務所（架空）',type:'individual'});
 const ind=await project();check(ind.start==='2026-01'&&ind.end==='2026-09','個人事業主の既定の期間',ind);
 // 3) 資料の読込：基本の4枚のカードと、追加資料（任意）
 await p.click('[data-view="data"]');await p.waitForSelector('#materialsGuide');
 const layout=await p.evaluate(()=>({primary:[...document.querySelectorAll('.dp-primary > section')].map(s=>s.dataset.dpType),more:[...document.querySelectorAll('details.dp-more .dataset h3')].map(h=>h.textContent),moreOpen:document.querySelector('details.dp-more').open,period:document.querySelector('.dp-period').innerText,bulk:document.querySelector('.dp-bulk')?.textContent}));
 check(layout.primary.join()==='current,prior,monthlyBS,monthlyPL','基本の4枚',layout.primary);
 check(layout.more.length===5&&layout.more.every(t=>/（任意）$/.test(t))&&!layout.moreOpen,'追加資料は（任意）で畳む',layout.more);
 check(/2026-01〜2026-09/.test(layout.period)&&/決算月（12月）/.test(layout.period),'対象期間の表示',layout.period);
 check(/CSVをまとめて選ぶ（自動判定）/.test(layout.bulk||''),'まとめて選ぶボタン',layout.bulk);
 // 4) 6ファイルをまとめて選び、タグなしのPLだけとばす
 const list=['journal-2026.csv','journal-2025.csv','freee/bs-party-2026.csv','freee/bs-item-2026.csv','freee/pl-none-2026.csv','freee/pl-department-2026.csv'];
 const [chooser]=await Promise.all([p.waitForEvent('filechooser'),p.click('.dp-bulk')]);
 await chooser.setFiles(list.map(f=>path.join(FX,f)));
 const steps=[];let prev='';
 for(let i=0;i<list.length;i++){
  await p.waitForFunction(prev=>{const d=document.querySelector('#importDialog[open] .importname strong');return d&&d.textContent!==prev;},prev,{timeout:10000});
  const info=await p.evaluate(()=>({name:document.querySelector('#importDialog .importname strong').textContent,step:document.querySelector('#importDialog .queue-step')?.textContent.trim()||'',type:document.getElementById('importType').value,skip:!!document.querySelector('#importDialog [data-action="skipImport"]')}));
  steps.push(info);prev=info.name;
  if(info.name==='pl-none-2026.csv'){
   if(out&&i===4)await p.screenshot({path:path.join(out,'data-queue-dialog-1440.png')});
   await p.click('#importDialog [data-action="skipImport"]');continue;
  }
  await p.evaluate(()=>{const c=document.querySelector('#importDialog #historySameClient');if(c&&!c.checked)c.click();});
  await p.waitForSelector('#importDialog[open] [data-action="commitImport"]:not([disabled])',{timeout:8000});
  await p.click('#importDialog [data-action="commitImport"]');
 }
 await p.waitForFunction(()=>!document.querySelector('#importDialog[open]'),{timeout:10000});
 await p.waitForTimeout(100);
 const summaryToast=await toastText();
 check(steps.map(s=>s.step).join()==='1／6件目,2／6件目,3／6件目,4／6件目,5／6件目,6／6件目','n／N件目',steps.map(s=>s.step));
 check(steps.slice(0,5).every(s=>s.skip)&&!steps[5].skip,'とばすボタンは最後の1件以外',steps.map(s=>s.skip));
 check(summaryToast==='6件中5件を読み込みました（1件はとばしました）','まとめの通知',summaryToast);
 const data=await p.evaluate(()=>{
  const s=window.LedgerApp.getSession(),tags=t=>[...document.querySelectorAll(`[data-dp-type="${t}"] .dp-tag`)].map(li=>({ok:li.classList.contains('ok'),name:li.querySelector('.dp-tagname').firstChild.textContent,text:li.innerText.replace(/\s+/g,' ').trim()}));
  return {current:s.datasets.current.length,prior:s.datasets.prior.length,bs:tags('monthlyBS'),pl:tags('monthlyPL'),guide:document.querySelector('#materialsGuide .badge').textContent,queue:document.getElementById('queueSummary').innerText,end:s.project.end};
 });
 check(data.current>0&&data.prior>0,'仕訳帳の読込',{current:data.current,prior:data.prior});
 const row=(rows,label)=>rows.find(r=>r.name===label)||{};
 check(row(data.bs,'取引先').ok&&/bs-party-2026\.csv/.test(row(data.bs,'取引先').text)&&/2026-01〜2026-12（12か月）/.test(row(data.bs,'取引先').text),'BS：取引先 ✓・ファイル名・月',row(data.bs,'取引先'));
 check(row(data.bs,'品目').ok&&/bs-item-2026\.csv/.test(row(data.bs,'品目').text),'BS：品目 ✓',row(data.bs,'品目'));
 check(!row(data.bs,'部門').ok&&/未読込/.test(row(data.bs,'部門').text),'BS：部門は未読込',row(data.bs,'部門'));
 check(row(data.pl,'部門').ok&&/pl-department-2026\.csv/.test(row(data.pl,'部門').text),'PL：部門 ✓',row(data.pl,'部門'));
 check(!row(data.pl,'なし').ok&&/不要/.test(row(data.pl,'なし').text),'PL：タグなしは不要と表示',row(data.pl,'なし'));
 check(!row(data.pl,'取引先').ok&&!row(data.pl,'品目').ok,'PL：取引先・品目は未読込',data.pl);
 check(/8ファイル中 5 読込済み/.test(data.guide),'8ファイル中の読込数',data.guide);
 check(/6件中5件/.test(data.queue)&&/pl-none-2026\.csv/.test(data.queue),'画面に残るまとめ',data.queue);
 const wide=await p.evaluate(()=>document.documentElement.scrollWidth);
 if(out){await p.evaluate(()=>window.scrollTo(0,0));await p.screenshot({path:path.join(out,'data-1440.png'),fullPage:true});}
 // 5) スマホ幅：横にはみ出さない
 await p.setViewportSize({width:390,height:844});await p.waitForTimeout(250);
 const narrow=await p.evaluate(()=>({scroll:document.documentElement.scrollWidth,cards:[...document.querySelectorAll('.dp-card')].map(c=>Math.round(c.getBoundingClientRect().right))}));
 check(narrow.scroll<=390&&narrow.cards.every(r=>r<=390),'390pxで横スクロールなし',narrow);
 if(out){await p.evaluate(()=>document.querySelector('[data-dp-type="monthlyBS"]').scrollIntoView());await p.screenshot({path:path.join(out,'data-390-bs.png')});await p.evaluate(()=>window.scrollTo(0,0));await p.screenshot({path:path.join(out,'data-390-top.png')});}
 await p.setViewportSize({width:1440,height:960});
 // 6) 対象期間を 2026-06 までにしてから当期の仕訳帳を読むと「対象期間を 2026-09 まで広げる」が出る
 await p.click('[data-view="monthly"]');await p.waitForSelector('#settings');
 await p.fill('#periodEnd','2026-06');await p.click('#settings [type=submit]');await p.waitForTimeout(200);
 await p.click('[data-view="data"]');await p.waitForSelector('#materialsGuide');
 const [ch2]=await Promise.all([p.waitForEvent('filechooser'),p.click('[data-dp-type="current"] [data-action="import"]')]);
 await ch2.setFiles(path.join(FX,'journal-2026.csv'));
 await p.waitForSelector('#importDialog[open] [data-action="extendPeriod"]',{timeout:8000});
 const before=await p.evaluate(()=>({notice:document.getElementById('journalPeriodNotice').innerText,button:document.querySelector('[data-action="extendPeriod"]').textContent}));
 check(/対象終了月後 [1-9][\d,]*行/.test(before.notice)&&before.button==='対象期間を 2026-09 まで広げる','広げるボタン',before);
 if(out)await p.screenshot({path:path.join(out,'data-extend-1440.png')});
 await p.click('[data-action="extendPeriod"]');
 await p.waitForFunction(()=>/対象終了月後 0行/.test(document.getElementById('journalPeriodNotice')?.innerText||''));
 const after=await p.evaluate(()=>({end:window.LedgerApp.getSession().project.end,source:window.LedgerApp.getSession().project.periodSource,button:!!document.querySelector('[data-action="extendPeriod"]'),open:!!document.querySelector('#importDialog[open]'),commit:!document.querySelector('#importDialog [data-action="commitImport"]').disabled}));
 check(after.end==='2026-09'&&after.source==='user'&&!after.button&&after.open&&after.commit,'広げたあと',after);
 await p.click('#importDialog [data-action="closeImport"]');
 const result={errors,wide,layout,steps:steps.map(s=>s.name+':'+s.type),summaryToast,data:{guide:data.guide,bs:data.bs.map(r=>(r.ok?'✓ ':'  ')+r.text),pl:data.pl.map(r=>(r.ok?'✓ ':'  ')+r.text)},narrow:narrow.scroll,extend:before.button,fail};
 console.log(JSON.stringify(result,null,1));
 await b.close();
 if(errors.length||fail.length||wide>1440)process.exit(1);
})().catch(e=>{console.error(e);process.exit(1);});

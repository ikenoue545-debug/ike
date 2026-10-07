// 「CSVをまとめて選ぶ」で、仕訳帳2つ・freee形式の月次PL／BS 8つ（なし・取引先・品目・部門）・取り込めないCSV 1つを
// 一度に選び、1件ずつ確認して取り込む（取り込めないものはとばす）。保存データと、取込画面の「表示するタグ」の案内を確かめる。
//   node tests/ui-tags-import.js [スクリーンショットの出力先]
'use strict';
const path=require('path'),fs=require('fs'),os=require('os');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'/opt/node22/lib/node_modules/playwright');
const ROOT=path.join(__dirname,'..'),FX=path.join(__dirname,'fixtures');
const fail=[];const check=(ok,label,detail)=>{if(!ok)fail.push(label+(detail!==undefined?'：'+JSON.stringify(detail):''));};
(async()=>{
 const out=process.argv[2];if(out)fs.mkdirSync(out,{recursive:true});
 // 取り込めないCSV：「表示するタグ」の列が2つ（取引先・品目）ある月次BS
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jikeika-ui-tags-')),broken=path.join(tmp,'bs-two-tags-broken.csv');
 fs.writeFileSync(broken,fs.readFileSync(path.join(FX,'freee','bs-party-2026.csv'),'utf8').split('\n').map((l,i)=>{if(!i||!l)return l;const c=l.slice(1,-1).split('","');c.splice(3,0,i===1?'品目':'');return '"'+c.join('","')+'"';}).join('\n'));
 const list=['journal-2026.csv','journal-2025.csv','freee/bs-party-2026.csv','freee/pl-party-2026.csv',broken,'freee/bs-item-2026.csv','freee/pl-item-2026.csv','freee/bs-department-2026.csv','freee/pl-department-2026.csv','freee/bs-none-2026.csv','freee/pl-none-2026.csv'];
 const b=await chromium.launch({executablePath:process.env.CHROME||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
 const p=await b.newPage({viewport:{width:1440,height:960}});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await p.goto('file://'+path.join(ROOT,'dist','自計化レビュー_v3.9.html'));
 await p.waitForFunction(()=>window.LedgerApp&&document.querySelector('[data-view]'));
 await p.evaluate(()=>{const E=window.ReviewEngine,s=E.newSession();Object.assign(s.project,{name:'やまだデザイン事務所（架空）',type:'individual',start:'2026-01',end:'2026-09'});window.LedgerApp.setSession(s);});
 await p.click('[data-view="data"]');await p.waitForSelector('.dp-bulk');
 const [chooser]=await Promise.all([p.waitForEvent('filechooser'),p.click('.dp-bulk')]);
 await chooser.setFiles(list.map(f=>path.isAbsolute(f)?f:path.join(FX,f)));
 const steps=[];let prev='';
 for(let i=0;i<list.length;i++){
  await p.waitForFunction(prev=>{const d=document.querySelector('#importDialog[open] .importname strong');return d&&d.textContent!==prev;},prev,{timeout:10000});
  const info=await p.evaluate(()=>{const d=document.getElementById('importDialog'),n=d.querySelector('#tagVariantNotice');return {name:d.querySelector('.importname strong').textContent,step:d.querySelector('.queue-step')?.textContent.trim()||'',type:document.getElementById('importType').value,skip:!!d.querySelector('[data-action="skipImport"]'),disabled:!!d.querySelector('[data-action="commitImport"]')?.disabled,notice:n?n.innerText.replace(/\s+/g,' ').trim():null,amber:!!n?.classList.contains('amber'),error:[...d.querySelectorAll('.notice.error')].map(x=>x.innerText).join('\n'),warnings:[...d.querySelectorAll('.notice.amber')].map(x=>x.innerText)};});
  steps.push(info);prev=info.name;
  if(info.name===path.basename(broken)){
   check(info.disabled,'取り込めないCSVは「読み込む」を押せない',info);
   check(/「表示するタグ」の列が複数あります（取引先・品目）/.test(info.error),'取り込めない理由を表示',info.error);
   await p.click('#importDialog [data-action="skipImport"]');continue;
  }
  if(info.name==='bs-item-2026.csv'&&out){
   await p.evaluate(()=>document.getElementById('tagVariantNotice').scrollIntoView({block:'center'}));
   await p.screenshot({path:path.join(out,'tags-import-dialog-1440.png')});
   await p.setViewportSize({width:390,height:844});await p.waitForTimeout(200);
   await p.evaluate(()=>document.getElementById('tagVariantNotice').scrollIntoView({block:'center'}));
   const narrow=await p.evaluate(()=>{const d=document.getElementById('importDialog'),r=d.getBoundingClientRect();return {left:Math.round(r.left),right:Math.round(r.right),page:document.documentElement.scrollWidth,notice:Math.round(document.getElementById('tagVariantNotice').getBoundingClientRect().right)};});
   check(narrow.left>=0&&narrow.right<=390&&narrow.page<=390&&narrow.notice<=390,'390pxで取込画面が横にはみ出さない',narrow);
   await p.screenshot({path:path.join(out,'tags-import-dialog-390.png')});
   await p.setViewportSize({width:1440,height:960});await p.waitForTimeout(100);
  }
  await p.evaluate(()=>{const c=document.querySelector('#importDialog #historySameClient');if(c&&!c.checked)c.click();});
  await p.waitForSelector('#importDialog[open] [data-action="commitImport"]:not([disabled])',{timeout:8000});
  await p.click('#importDialog [data-action="commitImport"]');
 }
 await p.waitForFunction(()=>!document.querySelector('#importDialog[open]'),{timeout:10000});
 await p.waitForTimeout(150);
 const toast=await p.evaluate(()=>document.getElementById('toast').textContent);
 const byName=n=>steps.find(s=>s.name===n)||{};
 check(steps.map(s=>s.step).join()===list.map((_,i)=>`${i+1}／${list.length}件目`).join(),'n／N件目',steps.map(s=>s.step));
 check(steps.slice(0,-1).every(s=>s.skip)&&!steps.at(-1).skip,'とばすボタンは最後の1件以外',steps.map(s=>s.skip));
 check(steps.filter(s=>/^(?:bs|pl)-/.test(s.name)&&s.name!==path.basename(broken)).every(s=>s.notice&&!s.amber&&s.type===(s.name.startsWith('bs')?'monthlyBS':'monthlyPL')),'月次PL／BSは自動判定され、すべて表示するタグの案内つき（食い違いなし）',steps.map(s=>[s.name,s.type,!!s.notice,s.amber]));
 check(steps.filter(s=>/^journal/.test(s.name)).every(s=>s.notice===null),'仕訳帳には表示するタグの案内を出さない');
 const item=byName('bs-item-2026.csv').notice||'';
 check(/表示するタグ：品目 品目別の内訳 156行（11科目・2件）と、科目合計 247行を分けて保存します。内訳は科目合計に足しません。内訳の合計は 11科目すべての月で科目合計と照合しました。/.test(item),'BS×品目の案内',item);
 check(steps.filter(s=>/^(?:bs|pl)-.*-2026\.csv$/.test(s.name)).every(s=>!s.warnings.length),'freee形式の帳票は注意（黄色）なしで取り込める',steps.map(s=>[s.name,s.warnings]));
 check(/取引先別の残高は確定した残高として、回収・支払の確認に使います。/.test(byName('bs-party-2026.csv').notice||''),'BS×取引先の使い道',byName('bs-party-2026.csv').notice);
 check(/読込済みの 取引先別 の内訳は残します（置き換えるのは同じ「品目別」だけです）。/.test(item),'読込済みの取引先別は残すと案内',item);
 const none=byName('bs-none-2026.csv').notice||'';
 check(/表示するタグ：なし 科目合計 247行を保存します。/.test(none)&&/読込済みの 取引先・品目・部門別 の内訳は残します（置き換えるのは科目合計だけです）。/.test(none),'タグなしは科目合計だけを置き換えると案内',none);
 const plParty=byName('pl-party-2026.csv').notice||'';
 check(/表示するタグ：取引先 取引先別の内訳 240行（15科目・19件）と、科目合計 276行を分けて保存します。/.test(plParty)&&!/読込済み/.test(plParty),'最初のPL（取引先）',plParty);
 check(toast==='11件中10件を読み込みました（1件はとばしました）','まとめの通知',toast);
 const data=await p.evaluate(()=>{
  const s=window.LedgerApp.getSession(),T=window.ReviewTagReports,count=(type,dim)=>T.rows(s,type,dim).reduce((n,g)=>n+Object.keys(g.values).length+(g.opening===null?0:1),0);
  const dup=t=>{const seen=new Set();let d=0;for(const r of s.datasets[t].filter(r=>!r.tagDimension)){const k=r.account+'|'+r.date+'|'+!!r.opening;if(seen.has(k))d++;seen.add(k);}return d;};
  return {current:s.datasets.current.length,prior:s.datasets.prior.length,bsTotals:s.datasets.monthlyBS.filter(r=>!r.tagDimension).length,bsParty:s.datasets.monthlyBS.filter(r=>r.tagDimension==='party').length,plTotals:s.datasets.monthlyPL.length,plTagged:s.datasets.monthlyPL.filter(r=>r.tagDimension).length,dup:[dup('monthlyBS'),dup('monthlyPL')],
   tags:{bsItem:count('monthlyBS','item'),bsDept:count('monthlyBS','department'),plParty:count('monthlyPL','party'),plItem:count('monthlyPL','item'),plDept:count('monthlyPL','department')},tagReports:s.tagReports.length,
   imports:s.imports.map(i=>[i.type,T.slotOf(i),i.name]),queue:document.getElementById('queueSummary')?.innerText||'',
   ok:[...document.querySelectorAll('.dp-tag.ok .dp-tagname')].map(x=>x.closest('[data-dp-type]').dataset.dpType+':'+x.firstChild.textContent).sort()};
 });
 check(data.current>0&&data.prior>0,'仕訳帳（当期・過去）',[data.current,data.prior]);
 check(data.bsTotals===247&&data.plTotals===276&&data.plTagged===0&&data.dup.join()==='0,0','科目合計は1組だけ（BS 247行・PL 276行）',data);
 check(data.bsParty===494,'BS×取引先は datasets に残る',data.bsParty);
 check(JSON.stringify(data.tags)===JSON.stringify({bsItem:156,bsDept:169,plParty:240,plItem:276,plDept:204})&&data.tagReports===1045,'タグ別の内訳（tagReports）',data.tags);
 const reports=data.imports.filter(x=>/^monthly/.test(x[0])).map(x=>x.join('|')).sort();
 check(reports.join()===['monthlyBS||bs-none-2026.csv','monthlyBS|party|bs-party-2026.csv','monthlyBS|item|bs-item-2026.csv','monthlyBS|department|bs-department-2026.csv','monthlyPL||pl-none-2026.csv','monthlyPL|party|pl-party-2026.csv','monthlyPL|item|pl-item-2026.csv','monthlyPL|department|pl-department-2026.csv'].sort().join(),'読込の記録（帳票×タグごとに1つ）',reports);
 check(!data.imports.some(x=>x[2]===path.basename(broken)),'とばしたCSVは記録しない');
 check(/11件中10件/.test(data.queue)&&new RegExp(path.basename(broken).replace(/\./g,'\\.')).test(data.queue),'画面に残るまとめ',data.queue);
 check(['取引先','品目','部門'].every(t=>data.ok.includes('monthlyBS:'+t)&&data.ok.includes('monthlyPL:'+t)),'読込状況：BS・PLの取引先・品目・部門に ✓',data.ok);
 check(!errors.length,'画面のエラーなし',errors);
 console.log(JSON.stringify({steps:steps.map(s=>[s.step,s.name,s.type,s.disabled?'disabled':'',s.amber?'amber':'']),data:{...data,imports:undefined,ok:undefined}},null,1));
 await b.close();fs.rmSync(tmp,{recursive:true,force:true});
 if(fail.length){console.error('NG\n'+fail.join('\n'));process.exit(1);}
 console.log('OK ui-tags-import');
})().catch(e=>{console.error(e);process.exit(1);});

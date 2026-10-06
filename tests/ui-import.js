// 実際の操作と同じく、画面の「CSV読込」から freee 形式のCSVを取り込み、月次PL・BSの階層表示と理由を確認する。
//   node tests/ui-import.js [スクリーンショットの出力先]
'use strict';
const path=require('path'),fs=require('fs');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'/opt/node22/lib/node_modules/playwright');
const ROOT=path.join(__dirname,'..'),FX=path.join(__dirname,'fixtures');
(async()=>{
 const out=process.argv[2];if(out)fs.mkdirSync(out,{recursive:true});
 const b=await chromium.launch({executablePath:process.env.CHROME||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
 const p=await b.newPage({viewport:{width:1440,height:960}});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await p.goto('file://'+path.join(ROOT,'dist','自計化レビュー_v3.3.html'));
 await p.waitForFunction(()=>window.LedgerApp&&document.querySelector('[data-view]'));
 // 空の会社（個人・2026-01〜09）を用意
 await p.evaluate(()=>{const E=window.ReviewEngine,s=E.newSession();Object.assign(s.project,{name:'取込テスト（架空）',type:'individual',start:'2026-01',end:'2026-09'});window.LedgerApp.setSession(s);});
 await p.click('[data-view="monthly"]');
 const load=async(type,file)=>{
  const [chooser]=await Promise.all([p.waitForEvent('filechooser'),p.evaluate(t=>document.querySelector(`[data-action="import"][data-type="${t}"]`).click(),type)]);
  await chooser.setFiles(path.join(FX,file));
  await p.waitForSelector('#importDialog[open] [data-action="commitImport"]:not([disabled])',{timeout:8000});
  const scope=await p.$('#importDialog input[type=checkbox]#completeLoad, #importDialog input[type=checkbox][id*="omplete"]');if(scope)await scope.check();
  await p.click('#importDialog [data-action="commitImport"]');
  await p.waitForFunction(()=>!document.querySelector('#importDialog[open]'),{timeout:8000}).catch(()=>{});
  await p.waitForTimeout(300);
 };
 await load('current','journal-2026.csv');
 await p.click('[data-view="monthly"]').catch(()=>{});
 await load('monthlyPL','monthly-pl-2026.csv');
 await p.click('[data-view="monthly"]').catch(()=>{});
 await load('monthlyBS','monthly-bs-2026.csv');
 await p.click('[data-view="monthly"]').catch(()=>{});
 await p.waitForSelector('#vtChanges');
 const info=await p.evaluate(()=>{const s=window.LedgerApp.getSession();return {current:s.datasets.current.length,pl:s.datasets.monthlyPL.length,bs:s.datasets.monthlyBS.length,fieldOrigins:!!s.datasets.current[0]?.fieldOrigins?.debitParty};});
 // 事業主貸を開いて、3月の理由を右側に表示
 await p.evaluate(()=>{const sec=document.querySelector('.monthly-panel[data-stmt="monthlyBS"]');[...sec.querySelectorAll('[data-vt-acct]')].find(b=>b.textContent.includes('事業主貸')).click();});
 await p.waitForTimeout(200);
 await p.evaluate(()=>{const sec=document.querySelector('.monthly-panel[data-stmt="monthlyBS"]');const r=[...sec.querySelectorAll('.vt-reason')].find(b=>b.textContent.includes('2026年3月'));r.scrollIntoView({block:'center'});r.click();});
 await p.waitForSelector('#vtDrawer:not([hidden])');
 const drawer=await p.evaluate(()=>document.getElementById('vtDrawer').innerText);
 if(out)await p.screenshot({path:path.join(out,'import-drawer.png')});
 // 取引先タブ以外も切り替えられる
 await p.click('#vtDrawer [data-vt-tab="counter"]');
 const counterTab=await p.evaluate(()=>document.querySelector('#vtDrawer .vt-break')?.innerText||'');
 const result={errors,info,person:/ヤマダタロウ（個人名）/.test(drawer),counterTab:/普通預金/.test(counterTab)};
 console.log(JSON.stringify(result,null,1));
 await b.close();
 if(errors.length||!info.current||!info.pl||!info.bs||!info.fieldOrigins||!result.person||!result.counterTab)process.exit(1);
})().catch(e=>{console.error(e);process.exit(1);});

// dist のHTMLを Chromium で開き、架空データで月次PL・BS画面を操作してスクリーンショットを撮る。
//   node tests/ui-smoke.js [出力フォルダ] [light|dark]
'use strict';
const path=require('path'),fs=require('fs');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'/opt/node22/lib/node_modules/playwright');
const H=require('./harness.js');
(async()=>{
 const out=process.argv[2]||path.join(__dirname,'..','tmp-shots'),theme=process.argv[3]||'light';fs.mkdirSync(out,{recursive:true});
 const ctx=H.load();const session=JSON.parse(JSON.stringify(H.session(ctx)));
 const b=await chromium.launch({executablePath:process.env.CHROME||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
 const p=await b.newPage({viewport:{width:1440,height:960}});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await p.goto('file://'+path.join(H.ROOT,'dist','自計化レビュー_v3.7.html'));
 await p.waitForFunction(()=>window.LedgerApp&&document.querySelector('[data-view]'));
 await p.waitForTimeout(600);
 await p.evaluate(t=>{const b=document.querySelector(`[data-theme-choice="${t}"]`);if(b)b.click();},theme);
 await p.evaluate(s=>window.LedgerApp.setSession(s),session);
 await p.waitForTimeout(400);
 await p.click('nav [data-view="monthly"], [data-view="monthly"]');
 await p.waitForSelector('#vtChanges');
 const shot=async name=>{await p.waitForTimeout(250);await p.screenshot({path:path.join(out,name+'.png')});};
 await p.locator('#vtChanges').scrollIntoViewIfNeeded();await p.evaluate(()=>document.getElementById('vtChanges').scrollIntoView());await shot('01-changes');
 const openAcct=async(type,name)=>{await p.evaluate(([type,name])=>{const sec=document.querySelector(`.monthly-panel[data-stmt="${type}"]`);const btn=[...sec.querySelectorAll('[data-vt-acct]')].find(b=>b.textContent.trim().replace(/^[▶▼]/,'').trim()===name);btn.click();},[type,name]);await p.waitForTimeout(150);};
 await openAcct('monthlyPL','租税公課');
 await p.evaluate(()=>{const sec=document.querySelector('.monthly-panel[data-stmt="monthlyPL"]');const b=[...sec.querySelectorAll('[data-vt-dim]')].find(b=>b.textContent.includes('品目別'));b.click();});
 await p.waitForTimeout(150);
 await p.evaluate(()=>{const sec=document.querySelector('.monthly-panel[data-stmt="monthlyPL"]');[...sec.querySelectorAll('[data-vt-acct]')].find(b=>b.textContent.includes('租税公課')).scrollIntoView({block:'start'});window.scrollBy(0,-120);});
 await shot('02-pl-tax-expanded');
 await openAcct('monthlyBS','事業主貸');
 await p.evaluate(()=>{const sec=document.querySelector('.monthly-panel[data-stmt="monthlyBS"]');[...sec.querySelectorAll('[data-vt-acct]')].find(b=>b.textContent.includes('事業主貸')).scrollIntoView({block:'start'});window.scrollBy(0,-120);});
 await shot('03-bs-owner-expanded');
 await openAcct('monthlyBS','セゾンカード');
 await p.evaluate(()=>{const sec=document.querySelector('.monthly-panel[data-stmt="monthlyBS"]');[...sec.querySelectorAll('[data-vt-acct]')].find(b=>b.textContent.includes('セゾンカード')).scrollIntoView({block:'start'});window.scrollBy(0,-120);});
 await shot('04-bs-card-expanded');
 // 事業主貸 3月の理由を開く
 await p.evaluate(()=>{const sec=document.querySelector('.monthly-panel[data-stmt="monthlyBS"]');const b=[...sec.querySelectorAll('.vt-reason')].find(b=>b.textContent.includes('2026年3月')&&b.closest('tr').previousElementSibling);b.click();});
 await p.waitForSelector('#vtDrawer:not([hidden])');await shot('05-drawer-owner');
 const txt=await p.evaluate(()=>document.getElementById('vtDrawer').innerText);
 await p.click('[data-vt-step="1"]');await shot('06-drawer-next-month');
 await p.keyboard.press('Escape');
 const state=await p.evaluate(()=>({drawerHidden:document.getElementById('vtDrawer').hidden,cards:document.querySelectorAll('.vt-card').length,hot:document.querySelectorAll('td.vt-hot').length,toggles:document.querySelectorAll('[data-vt-acct]').length,alertReasons:document.querySelectorAll('.vt-alertwhy').length}));
 // 月の絞り込み・推移グラフ表示からも理由を開ける
 await p.click('[data-vt-focus-month="2026-03"]');
 state.marchCards=await p.evaluate(()=>[...document.querySelectorAll('.vt-card')].every(c=>c.textContent.includes('2026年3月')));
 await p.click('[data-stmt-view="monthlyPL:grid"]');
 await p.evaluate(()=>document.querySelector('.monthly-panel[data-stmt="monthlyPL"] .monthly-table [data-vt-ref]').click());
 await p.waitForSelector('#vtDrawer:not([hidden])');state.gridDrawer=true;await p.keyboard.press('Escape');
 await p.click('[data-stmt-view="monthlyPL:statement"]');
 // 確認キュー：変動の候補に理由が付く
 await p.evaluate(()=>{const a=[...document.querySelectorAll('[data-month-finding]')].find(b=>b.textContent.includes('前月から大きく変動'));if(a)a.click();});
 await p.waitForTimeout(400);await shot('07-review-finding');
 const finding=await p.evaluate(()=>document.body.innerText.includes('仕訳から見た変動の理由'));
 console.log(JSON.stringify({errors,state,finding,drawerHasPerson:txt.includes('ヤマダタロウ（個人名）')},null,1));
 await b.close();
 if(errors.length||!state.drawerHidden||!state.cards||!state.hot||!state.alertReasons||!state.marchCards||!state.gridDrawer||!finding)process.exit(1);
})().catch(e=>{console.error(e);process.exit(1);});

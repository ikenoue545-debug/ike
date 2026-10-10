// 受信トレイの処理時間（架空データを複製して大きくする）。
//   node tests/perf-inbox.js [倍率...]   例：node tests/perf-inbox.js 25 100
// 当期の仕訳帳を倍率分に複製（伝票番号を変える）し、受信トレイでの判定・反映・入れ直し（変更なし）の時間と、
// 同じCSVを従来の1ファイルずつの画面で読み込む時間を比べる。数値は参考値（実行環境で変わる）。
'use strict';
const path=require('path'),fs=require('fs');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'/opt/node22/lib/node_modules/playwright');
const ROOT=path.join(__dirname,'..'),FX=path.join(__dirname,'fixtures');
const DIST=path.join(ROOT,'dist','自計化レビュー_v4.4a_受信トレイ.html');
const J26=fs.readFileSync(path.join(FX,'journal-2026.csv'),'utf8');
function scaled(k){
 const lines=J26.split(/\r?\n/).filter(Boolean),head=lines[0],idx=head.split(',').findIndex(h=>/伝票番号/.test(h)),out=[head];
 for(let n=0;n<k;n++)for(const l of lines.slice(1)){const c=l.split(',');c[idx]='"'+(Number(c[idx].replace(/"/g,''))+n*100000)+'"';out.push(c.join(','));}
 return out.join('\n');
}
(async()=>{
 const factors=process.argv.slice(2).map(Number).filter(Boolean);if(!factors.length)factors.push(25);
 const b=await chromium.launch({executablePath:process.env.CHROME||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
 for(const k of factors){
  const text=scaled(k),rows=text.split('\n').length-1;
  const ctx=await b.newContext();const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto('file://'+DIST);await p.waitForFunction(()=>window.LedgerApp&&window.ReviewAppBridge&&!window.ReviewAppBridge.loading()&&window.ReviewInbox,{timeout:30000});
  const company=async name=>p.evaluate(name=>{const E=window.ReviewEngine,W=window.ReviewWorkspace,s=E.newSession();Object.assign(s.project,{name,type:'individual',start:'2026-01',end:'2026-09'});const c=W.add(window.LedgerApp.getWorkspace(),{name,entityType:'individual'},s);window.LedgerApp.openCompany(c.id,'data');},name);
  const file={name:'journal-x'+k+'.csv',mimeType:'text/csv',buffer:Buffer.from(text)};
  const idle=()=>p.waitForFunction(()=>!window.LedgerApp.isAnalyzing(),null,{timeout:600000});
  await company('性能（受信トレイ）');
  let t=Date.now();await p.setInputFiles('#fileInput',[file]);await p.waitForFunction(()=>{const s=window.ReviewInbox.state();return s&&!s.reading&&s.items.length;},null,{timeout:600000});const read=Date.now()-t;
  t=Date.now();await p.check('#inboxConfirm');await p.click('#inboxDialog [data-inbox="apply"]');await p.waitForFunction(()=>{const s=window.ReviewInbox.state();return s&&s.view==='result';},null,{timeout:600000});await idle();const apply=Date.now()-t;
  await p.click('#inboxDialog .dialogfoot [data-inbox="close"]');
  t=Date.now();await p.setInputFiles('#fileInput',[{...file,name:'journal-x'+k+'_再出力.csv',buffer:Buffer.from(text.replace(/\n/g,'\r\n'))}]);await p.waitForFunction(()=>{const s=window.ReviewInbox.state();return s&&!s.reading&&s.items.length;},null,{timeout:600000});const again=Date.now()-t;
  const status=await p.evaluate(()=>window.ReviewInbox.state().items[0].status);await p.click('#inboxDialog [data-inbox="clear"]');
  await company('性能（従来）');
  t=Date.now();await p.evaluate(t=>window.ReviewAppBridge.legacyQueue([new File([t],'journal-legacy.csv')]),text);await p.waitForSelector('#importDialog[open] [data-action="commitImport"]:not([disabled])',{timeout:600000});await p.click('#importDialog [data-action="commitImport"]');await p.waitForFunction(()=>!document.querySelector('#importDialog[open]'),null,{timeout:600000});await idle();const legacy=Date.now()-t;
  const mem=await p.evaluate(()=>performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null);
  console.log(JSON.stringify({倍率:k,仕訳行:rows,受信トレイ_判定ms:read,受信トレイ_反映ms:apply,入れ直し_判定ms:again,入れ直しの判定:status,従来の取込ms:legacy,JSヒープMB:mem,エラー:errors}));
  await ctx.close();
 }
 await b.close();
})().catch(e=>{console.error(e);process.exit(1);});

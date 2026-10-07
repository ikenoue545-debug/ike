// 取引先が多い事業者でも月次画面が重くならないこと（閉じた欄は開いたときに作る・25社ずつ表示）と、
// 取引先別の残高の欄が、仕訳だけ／取引先内訳つきBSだけ／両方 のどれでも矛盾した説明をしないことを確かめる。
'use strict';
const test=require('node:test'),assert=require('node:assert'),path=require('path'),fs=require('fs');
const H=require('./harness.js');
const ctx=H.load(),E=ctx.ReviewEngine,fx=path.join(__dirname,'fixtures');
const plain=h=>h.replace(/<[^>]+>/g,' ').replace(/&[a-z#0-9]+;/g,' ').replace(/\s+/g,' ');
// 架空の大量データ：取引先 N 社、当期・前期の仕訳を毎月 rows 行（乱数は固定）
function big({parties:N=800,rows=300,prefix='取引先'}={}){
 const s=E.newSession();Object.assign(s.project,{name:'大量テスト（架空）',type:'corp',start:'2026-01',end:'2026-12',complete:true});s.financial.comparisonConfirmed=true;
 let seed=7,id=1;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647,names=Array.from({length:N},(_,i)=>prefix+i);
 const push=(arr,date,debit,credit,amt,p,src)=>arr.push({date,id:String(id),hasId:true,journalId:String(id++),journalIdKind:'journal',debit,credit,debitAmount:amt,creditAmount:amt,party:'',debitParty:p,creditParty:p,description:'テスト',source:src,importSource:'csv:'+src,importErrors:0,line:id,fieldOrigins:{debitParty:5,creditParty:10}});
 for(const [arr,y,src] of [[s.datasets.prior,2025,'p.csv'],[s.datasets.current,2026,'c.csv']])for(let m=1;m<=12;m++){const mm=String(m).padStart(2,'0');
  for(let k=0;k<rows;k++){const p=names[Math.floor(rnd()**2*N)],amt=Math.round(rnd()*90000)+1000,d=`${y}-${mm}-${String(1+Math.floor(rnd()*27)).padStart(2,'0')}`,t=rnd();
   if(t<0.35)push(arr,d,'売掛金','売上高',amt,p,src);else if(t<0.6)push(arr,d,'普通預金','売掛金',amt,p,src);else if(t<0.8)push(arr,d,'外注費','買掛金',amt,p,src);else push(arr,d,'買掛金','普通預金',amt,p,src);}}
 s.imports=[{type:'current',name:'c.csv',count:s.datasets.current.length,errors:0,minDate:'2026-01-01',maxDate:'2026-12-31',importSource:'csv:c'},{type:'prior',name:'p.csv',count:s.datasets.prior.length,errors:0,minDate:'2025-01-01',maxDate:'2025-12-31',importSource:'csv:p'}];
 return s;
}
function bsParty(s){
 s.datasets.monthlyBS=H.readCSV(ctx,path.join(fx,'freee','bs-party-2026.csv'),'monthlyBS',s.project);
 s.imports=Object.keys(s.datasets).filter(k=>s.datasets[k].length).map(k=>({type:k,name:k,count:s.datasets[k].length,errors:0,at:'2026-10-06T00:00:00.000Z'}));
 return s;
}
function bsOnly(){const s=E.newSession();Object.assign(s.project,{name:'やまだデザイン事務所（架空）',type:'individual',start:'2026-01',end:'2026-09',complete:true});s.financial.comparisonConfirmed=true;return bsParty(s);}
const acct=(r,a)=>r.financial.partyOpening.accounts.find(x=>x.account===a);

test('800社の大量データでも、月次画面のHTMLは1MB未満で、取引先の表は科目ごとに25社まで',()=>{
 const s=big(),r=E.analyze(s),t=Date.now(),html=ctx.ReviewFinancial.page(s,r,null),ms=Date.now()-t;
 const bytes=Buffer.byteLength(html);
 assert.ok(bytes<1024*1024,`月次画面 ${bytes} bytes`);
 assert.ok(r.financial.partyOpening.accounts.find(a=>a.account==='売掛金').parties.length>=700);
 const po=html.slice(html.indexOf('id="partyBalances"'),html.indexOf('id="vtChanges"'));
 assert.ok((po.match(/class="po-row/g)||[]).length<=50,'売掛金・買掛金で各25社まで');
 assert.match(po,/1〜25社 ／ [\d,]+社/);
 // 内訳と根拠は開いたときに作る（最初は空）
 assert.ok(!/data-po-content="1">[^<]/.test(po));assert.doesNotMatch(po,/根拠の仕訳（\d/);
 const ts=html.slice(html.indexOf('id="treasuryReview"'),html.indexOf('id="partyBalances"'));
 assert.ok(Buffer.byteLength(ts)<20000,`資金の動きの欄 ${Buffer.byteLength(ts)} bytes`);
 assert.ok(ms<5000,`描画 ${ms}ms`);
});

test('取引先別の残高CSV：全取引先を出し、= + - @ で始まる文字は式にならないよう \' を付ける',()=>{
 const s=big({parties:40,rows:40}),evil=['=HYPERLINK("http://x")','+81-3','-ABC','@SUM(A1)'];
 let n=900000;for(const [i,p] of evil.entries())s.datasets.current.push({date:`2026-0${i+1}-10`,id:String(n),hasId:true,journalId:String(n++),journalIdKind:'journal',debit:'売掛金',credit:'売上高',debitAmount:1000,creditAmount:1000,party:'',debitParty:p,creditParty:p,description:'x',source:'c.csv',importSource:'csv:c.csv',importErrors:0,line:n,fieldOrigins:{debitParty:5,creditParty:10}});
 const r=E.analyze(s),csv=ctx.ReviewPartyOpeningUI.csv(r.financial),lines=csv.replace(/^﻿/,'').trim().split('\r\n');
 assert.ok(csv.startsWith('﻿"科目","区分","取引先","状態","期首（円）"'));
 const all=r.financial.partyOpening.accounts.reduce((k,a)=>k+a.parties.length+(Number.isSafeInteger(a.residual)&&a.residual!==0?1:0),0);
 assert.equal(lines.length-1,all,'検索や非表示にかかわらず全取引先');
 for(const p of evil){const cell='"\''+p.replace(/"/g,'""')+'"';assert.ok(csv.includes(','+cell+','),p);}
 assert.ok(!/,"[=+\-@\t]/.test(csv),'危険な先頭文字のままのセルがない');
 assert.match(lines.find(l=>l.includes('HYPERLINK')),/,1000,/,'金額は数値のまま');
});

test('取引先内訳つきBSだけ（仕訳なし）：BSの値を表示し、推定・繰越・「期首が分からない」とは言わない',()=>{
 const s=bsOnly(),r=E.analyze(s),po=r.financial.partyOpening,ar=acct(r,'売掛金');
 assert.equal(ar.status,'bs_only');assert.equal(ar.mode,'bs');assert.equal(po.journals,false);assert.equal(po.partyBS,true);assert.equal(po.estimated,false);
 const blue=ar.parties.find(p=>p.label==='(株)ブルースカイ');
 assert.equal(blue.opening,900000);assert.equal(blue.closing,995760,'残高は取引先内訳つきBSの最終月の値（期首のままにしない）');
 assert.equal(blue.increase,null);
 const html=ctx.ReviewPartyOpeningUI.panel(s,r.financial),text=plain(html);
 assert.match(text,/取引先別の期首と残高は、取引先内訳つきBSの値です（2026-09末時点）/);
 for(const bad of [/繰り越しました/,/—末/,/—まで/,/推定の合計/,/取引先別の期首が分からない/,/過去の仕訳帳を「前期・過去の仕訳帳/,/0か月/,/推定の確からしさ/,/見つかりませんでした/])assert.doesNotMatch(text,bad);
 assert.match(text,/期首 2025-12末 ／ 残高 2026-09末時点（取引先内訳つきBS）/);
 assert.match(text,/当期の仕訳帳が未読込のため、請求・入金の動きと、回収・支払が止まっていないかは表示していません/);
 assert.equal((text.match(/当期の仕訳帳が未読込のため/g)||[]).length,1,'同じ説明を2度書かない');
 assert.match(text,/取引先別の残高の合計と一致/);
});

test('仕訳と取引先内訳つきBSの両方：確定値だけの科目は「推定」と言わず、見出しは両方を説明する',()=>{
 const s=bsParty(H.session(ctx,{bs:false})),r=E.analyze(s),po=r.financial.partyOpening,ap=acct(r,'買掛金');
 assert.equal(ap.status,'exact');assert.equal(ap.estimated,false);assert.match(ap.statusText,/すべて取引先内訳つきBSの確定値/);
 const html=ctx.ReviewPartyOpeningUI.panel(s,r.financial),text=plain(html);
 assert.match(text,po.estimated?/取引先内訳つきBS（確定値）と過去の仕訳帳（推定）から求め、当期の仕訳で2026-09-30まで繰り越しました/:/取引先内訳つきBSの期首（確定値）を、当期の仕訳で2026-09-30まで繰り越しました/);
 const apBlock=text.slice(text.indexOf('買掛金 支払を確認'));
 assert.doesNotMatch(apBlock.slice(0,600),/推定の確からしさ|推定の合計/);
 // 確認キューの説明も「推定」としない
 const f=r.findings.filter(x=>x.partyOpeningCheck&&/買掛金/.test(x.title||''));
 for(const x of f)assert.doesNotMatch(x.title,/過去の仕訳からの推定/);
});

test('仕訳だけ（過去の仕訳帳あり）：これまでどおり推定として説明する',()=>{
 const s=H.session(ctx),r=E.analyze(s),text=plain(ctx.ReviewPartyOpeningUI.panel(s,r.financial));
 assert.match(text,/過去の仕訳帳から取引先別の期首を推定し、当期の仕訳で2026-09-30まで繰り越しました/);
 assert.match(text,/推定の合計がBSの期首と一致しました/);
 assert.doesNotMatch(text,/取引先内訳つきBSの値です/);
});

test('数値照合の欄に特定の取引先名を書かない',()=>{
 const src=fs.readFileSync(path.join(H.ROOT,'src','audit-ui.js'),'utf8');
 assert.doesNotMatch(src,/AYA/);
 const s=H.session(ctx),r=E.analyze(s),html=ctx.ReviewAuditUI.panel(s,r.financial);
 assert.match(html,/科目の残高を取引先ごとに分けることはできません/);
});

test('資金の動き：前期PL・BSは任意と表示し、閉じた欄は開くまで中身を作らない',()=>{
 const s=big({parties:120,rows:120}),r=E.analyze(s),html=ctx.ReviewTreasuryUI.panel(s,r.financial);
 assert.match(html,/前期PL（任意）/);assert.match(html,/前期BS（任意）/);
 assert.match(html,/data-ts-query="1"/);
 assert.ok((html.match(/data-ts-lazy=/g)||[]).length>0);
 assert.ok(!/data-ts-content="1">[^<]/.test(html.replace(/<details[^>]* open>[\s\S]*?<\/details>/g,'')),'閉じた欄は空');
});

// ブラウザでの操作：検索（日本語入力の変換中は絞り込まない）・ページ送り・開いたときの描画・印刷時の全件表示
let chromium=null;try{({chromium}=require(process.env.PLAYWRIGHT_PATH||'/opt/node22/lib/node_modules/playwright'));}catch{}
test('ブラウザ：取引先の検索・残高0の非表示・ページ送り・印刷時の全件表示',{skip:!chromium||!fs.existsSync(process.env.CHROME||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')},async()=>{
 const session=JSON.parse(JSON.stringify(big({parties:120,rows:120})));
 const b=await chromium.launch({executablePath:process.env.CHROME||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
 try{
  const p=await b.newPage({viewport:{width:1280,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto('file://'+path.join(H.ROOT,'dist','自計化レビュー_v3.9.html'));
  await p.waitForFunction(()=>window.LedgerApp&&document.querySelector('[data-view]'));
  await p.evaluate(s=>window.LedgerApp.setSession(s),session);await p.waitForTimeout(300);
  await p.click('[data-view="monthly"]');await p.waitForSelector('#partyBalances');
  const rows=()=>p.evaluate(()=>document.querySelectorAll('#partyBalances .po-account:first-of-type .po-row').length);
  const first=()=>p.evaluate(()=>document.querySelector('#partyBalances .po-account .po-row th strong')?.textContent);
  assert.equal(await rows(),25);
  // 次へ
  const before=await first();await p.click('#partyBalances .po-account [data-po-page="party"][data-po-step="1"]');
  assert.notEqual(await first(),before);assert.match(await p.evaluate(()=>document.querySelector('#partyBalances .po-pager').textContent),/26〜50社/);
  // 内訳と根拠：開いたときに作る。資金の動きの検索で再描画しても消えない
  await p.evaluate(()=>{document.querySelector('#partyBalances .po-why').open=true;});await p.waitForTimeout(100);
  await p.evaluate(()=>{document.querySelector('#partyBalances .po-why[open] .po-evidence').open=true;});await p.waitForTimeout(100);
  const ev=()=>p.evaluate(()=>document.querySelector('#partyBalances .po-why[open] .po-evidence [data-po-content]')?.querySelectorAll('tbody tr').length||0);
  assert.ok(await ev()>0);
  await p.fill('#treasuryReview [data-ts-query]','取引先1');await p.waitForTimeout(400);
  assert.ok(await ev()>0,'資金の動きの検索のあとも根拠が残る');
  await p.evaluate(()=>{const d=[...document.querySelectorAll('#partyBalances .po-why')].find(x=>!x.open);d.open=true;});await p.waitForTimeout(100);
  assert.ok(await p.evaluate(()=>[...document.querySelectorAll('#partyBalances .po-why[open]>[data-po-content]')].every(c=>c.innerHTML.length>0)),'別の取引先の内訳も開ける');
  // 日本語入力：変換中は絞り込まず、確定で絞り込む
  const input='#partyBalances [data-po-query]';
  await p.evaluate(sel=>{const i=document.querySelector(sel);i.focus();i.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));i.value='とりひき';i.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));},input);
  await p.waitForTimeout(300);assert.equal(await rows(),25,'変換中は絞り込まない');
  await p.evaluate(sel=>{const i=document.querySelector(sel);i.value='取引先11';i.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'取引先11'}));},input);
  await p.waitForTimeout(100);
  const hit=await p.evaluate(()=>[...document.querySelectorAll('#partyBalances .po-account:first-of-type .po-row th strong')].map(x=>x.textContent));
  assert.ok(hit.length>0&&hit.every(x=>x.includes('取引先11')),hit.join(','));
  assert.equal(await p.evaluate(sel=>document.activeElement===document.querySelector(sel),input),true,'入力欄にフォーカスが残る');
  // 残高0の取引先を隠す（既定）→ 外すと増える
  await p.fill(input,'');await p.waitForTimeout(300);
  const hiddenText=await p.evaluate(()=>document.querySelector('#partyBalances .po-pager')?.textContent||'');
  const zeroCount=await p.evaluate(()=>{const m=/残高0の(\d+)社/.exec(document.querySelector('#partyBalances .po-pager')?.textContent||'');return m?+m[1]:0;});
  const total=async()=>p.evaluate(()=>+(/／ ([\d,]+)社/.exec(document.querySelector('#partyBalances .po-pager').textContent)[1].replace(/,/g,'')));
  const shownWithHide=await total();
  await p.click('#partyBalances [data-po-zero]');await p.waitForTimeout(100);
  assert.equal(await total(),shownWithHide+zeroCount,hiddenText);
  await p.click('#partyBalances [data-po-zero]');await p.waitForTimeout(100);
  // 印刷：全件を出し、終わればページ分けに戻す
  await p.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
  assert.equal(await rows(),shownWithHide,'印刷では全件');
  const tsPrint=await p.evaluate(()=>[...document.querySelectorAll('#treasuryReview details[data-ts-print]')].every(d=>d.open&&d.querySelector('[data-ts-content]').innerHTML.length>0));
  assert.ok(tsPrint,'資金の動き：科目ごとの取引先残高を開いて印刷');
  await p.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
  assert.equal(await rows(),25);
  assert.ok(await p.evaluate(()=>[...document.querySelectorAll('#treasuryReview details[data-ts-print]')].every(d=>!d.open)));
  assert.deepEqual(errors,[]);
 }finally{await b.close();}
});

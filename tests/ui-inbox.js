// v4.4a 受信トレイの動作確認（架空データだけを使う）。
//   node tests/ui-inbox.js [スクリーンショットの出力先]
// 画面の CSV 選択（#fileInput）からまとめて入れ、判定・反映・変更なし・差分・重複・同種の衝突・
// 事業者名の不一致・要確認・反映の取消（自動の巻き戻しと手動の「反映前に戻す」）・従来の取込・保存・v4.3 での読込を確かめる。
'use strict';
const path=require('path'),fs=require('fs'),assert=require('assert');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'/opt/node22/lib/node_modules/playwright');
const ROOT=path.join(__dirname,'..'),FX=path.join(__dirname,'fixtures');
const DIST=path.join(ROOT,'dist','自計化レビュー_v4.4a_受信トレイ.html'),BASE=path.join(ROOT,'base','jikeika-review-v4.3.html');
const read=f=>fs.readFileSync(path.join(FX,f),'utf8');
const J26=read('journal-2026.csv'),J25=read('journal-2025.csv'),BS=read('freee/bs-party-2026.csv'),PL=read('freee/pl-party-2026.csv'),BSI=read('freee/bs-item-2026.csv');
const EIGHT=()=>[csv('journal-2026.csv',J26),csv('journal-2025.csv',J25),...['bs','pl'].flatMap(k=>['party','item','department'].map(d=>csv(`${k}-${d}-2026.csv`,read(`freee/${k}-${d}-2026.csv`))))];
// 取引先別BSの「現金」の2026-01の残高を1円だけ変える（科目合計と、その内訳「未選択」の両方）
function changedBS(){const lines=BS.split(/\r?\n/);for(const [i,l]of lines.entries()){if(!/^"","現金",/.test(l))continue;const cells=l.split(',');cells[4]='"'+(Number(cells[4].replace(/"/g,''))+1)+'"';lines[i]=cells.join(',');}return lines.join('\n');}
const csv=(name,text)=>({name,mimeType:'text/csv',buffer:Buffer.from(text,'utf8')});
const results=[];const crypto=require('crypto'),digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,16);
// 大きなデータは中身の要約（ハッシュ）で比べる（assert の差分表示はメモリを大量に使うため）
const same=(a,b,what)=>{if(digest(a)!==digest(b))throw Error(what+'が一致しません');};
const brief=v=>JSON.stringify(v,(k,x)=>k==='warnings'?undefined:x).slice(0,600);
const check=(label,fn,info)=>{try{fn();results.push(['OK',label]);}catch(e){results.push(['NG',label+'：'+String(e.message).split('\n')[0]+(info!==undefined?' ／ '+brief(info):'')]);}if(process.env.VERBOSE)console.log(results.at(-1).join(' '));};
// 当期の仕訳帳を少しだけ変える：最初の仕訳の金額を変え、行を1つ足す
function changedJournal(){
 const lines=J26.split(/\r?\n/);const head=lines[0].split(',');const ai=head.findIndex(h=>/借方金額/.test(h)),bi=head.findIndex(h=>/貸方金額/.test(h));
 const cells=lines[1].split(',');const v=Number(cells[ai].replace(/"/g,''));cells[ai]=String(v+1000);cells[bi]=String(v+1000);lines[1]=cells.join(',');
 const extra=lines[2].split(',');extra[1]='"99999"';lines.splice(3,0,extra.join(','));
 return lines.join('\n');
}
(async()=>{
 const out=process.argv[2];if(out)fs.mkdirSync(out,{recursive:true});
 const b=await chromium.launch({executablePath:process.env.CHROME||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
 const ctx=await b.newContext({viewport:{width:1360,height:940}});
 const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await p.goto('file://'+DIST);
 await p.waitForFunction(()=>window.LedgerApp&&window.ReviewAppBridge&&!window.ReviewAppBridge.loading()&&window.ReviewInbox,{timeout:30000});
 const newCompany=async name=>p.evaluate(name=>{const E=window.ReviewEngine,W=window.ReviewWorkspace,s=E.newSession();Object.assign(s.project,{name,type:'individual',start:'2026-01',end:'2026-09'});const ws=window.LedgerApp.getWorkspace();const c=W.add(ws,{name,entityType:'individual'},s);window.LedgerApp.openCompany(c.id,'data');return c.id;},name);
 // 利用者と同じく、資料ページの「CSVをまとめて選ぶ」から選ぶ（種類を指定しない）
 const drop=async list=>{if(!await p.$('#dropzone'))await p.evaluate(()=>document.querySelector('[data-view="data"]')?.click());const [chooser]=await Promise.all([p.waitForEvent('filechooser',{timeout:10000}),p.evaluate(()=>document.querySelector('#dropzone [data-action="import"]').click())]);await chooser.setFiles(list);try{await p.waitForFunction(n=>{const s=window.ReviewInbox.state();return s&&!s.reading&&s.items.length>=n&&document.querySelector('#inboxDialog[open]');},list.length,{timeout:30000});}catch(e){throw Error('受信トレイが開きません：'+JSON.stringify(await p.evaluate(()=>({state:window.ReviewInbox.state(),dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.id),toast:document.querySelector('#toast')?.textContent}))).slice(0,800));}return p.evaluate(()=>window.ReviewInbox.state());};
 const confirmAndApply=async()=>{await p.check('#inboxConfirm');await p.click('#inboxDialog [data-inbox="apply"]');await p.waitForFunction(()=>{const s=window.ReviewInbox.state();return s&&!s.busy&&(s.view==='result'||s.error);},null,{timeout:60000});await p.waitForFunction(()=>!window.LedgerApp.isAnalyzing(),null,{timeout:60000});return p.evaluate(()=>window.ReviewInbox.state());};
 const closeInbox=async()=>{await p.click('#inboxDialog .dialogfoot [data-inbox="close"]');await p.waitForFunction(()=>!document.querySelector('#inboxDialog[open]'));};
 // 受信トレイを空にする（次の確認に前の確認のCSVを持ち込まない）
 const clearInbox=async()=>{if(await p.$('#inboxDialog[open] [data-inbox="clear"]:not([disabled])'))await p.click('#inboxDialog [data-inbox="clear"]');await p.waitForFunction(()=>!document.querySelector('#inboxDialog[open]')&&!window.ReviewInbox.state());};
 const snapshot=()=>p.evaluate(()=>{const s=window.LedgerApp.getSession();return JSON.parse(JSON.stringify({datasets:s.datasets,imports:s.imports.map(i=>({...i,at:null})),decisions:s.decisions,manual:s.manual,responseWorkflow:s.responseWorkflow||null}));});

 // 1. 空の会社に基本の4資料をまとめて入れる
 const coA=await newCompany('受信トレイA（架空）');
 let st=await drop([csv('journal-2026.csv',J26),csv('journal-2025.csv',J25),csv('bs-party-2026.csv',BS),csv('pl-party-2026.csv',PL)]);
 check('1. 4ファイルの種類を自動判定',()=>assert.deepStrictEqual(st.items.map(i=>[i.type,i.status,i.kind]),[['current','apply','new'],['prior','apply','new'],['monthlyBS','apply','new'],['monthlyPL','apply','new']]));
 check('1. 不足資料なし',()=>assert.deepStrictEqual(st.missing,[]));
 const disabledBefore=await p.$eval('#inboxDialog [data-inbox="apply"]',b=>b.disabled);check('1. 確認の前は反映ボタンが押せない',()=>assert.strictEqual(disabledBefore,true));
 if(out)await p.screenshot({path:path.join(out,'inbox-1-list.png'),fullPage:false});
 st=await confirmAndApply();
 check('1. 4件を反映',()=>{assert.strictEqual(st.view,'result');assert.strictEqual(st.error,'');});
 if(out)await p.screenshot({path:path.join(out,'inbox-2-result.png')});
 await closeInbox();
 const afterInbox=await snapshot();
 check('1. データが入った',()=>{assert.ok(afterInbox.datasets.current.length>0);assert.ok(afterInbox.datasets.prior.length>0);assert.ok(afterInbox.datasets.monthlyBS.length>0);assert.ok(afterInbox.datasets.monthlyPL.length>0);assert.strictEqual(afterInbox.imports.length,4);});

 // 2. 同じ4資料を従来の方法（1ファイルずつ）で別の会社に入れ、保存されるデータが同じか比べる
 const coB=await newCompany('従来の取込B（架空）');
 await p.evaluate(files=>{window.ReviewAppBridge.legacyQueue(files.map(f=>new File([f.text],f.name,{type:'text/csv'})));},[{name:'journal-2026.csv',text:J26},{name:'journal-2025.csv',text:J25},{name:'bs-party-2026.csv',text:BS},{name:'pl-party-2026.csv',text:PL}]);
 for(let i=0;i<4;i++){
  await p.waitForSelector('#importDialog[open] [data-action="commitImport"]',{timeout:30000});
  await p.evaluate(()=>{const c=document.querySelector('#importDialog #historySameClient');if(c&&!c.checked)c.click();});
  await p.waitForSelector('#importDialog[open] [data-action="commitImport"]:not([disabled])',{timeout:30000});
  await p.click('#importDialog [data-action="commitImport"]');
  await p.waitForTimeout(400);
 }
 await p.waitForFunction(()=>!document.querySelector('#importDialog[open]')&&!window.LedgerApp.isAnalyzing(),null,{timeout:60000});
 const legacy=await snapshot();
 check('2. 受信トレイと従来の取込で、保存データが同じ',()=>{same(afterInbox.datasets,legacy.datasets,'資料の行');same(afterInbox.imports,legacy.imports,'読込の記録');});

 // 3. 確認の記録を付けてから、同じCSV（改行コードだけ変えたものを含む）を入れ直す → すべて「変更なし」、記録はそのまま
 await p.evaluate(id=>window.LedgerApp.openCompany(id,'data'),coA);
 await p.waitForFunction(()=>!window.LedgerApp.isAnalyzing(),null,{timeout:60000});
 await p.evaluate(()=>{const s=window.LedgerApp.getSession(),r=window.LedgerApp.getResult();const f=r.findings.slice(0,3);for(const x of f)s.decisions[x.id]={status:'resolved',note:'架空の確認メモ'};const m=Object.keys(s.manual)[0];if(m){s.manual[m].status='done';s.manual[m].note='架空のメモ';}window.ReviewAppBridge.save();});
 const marked=await snapshot();
 st=await drop([csv('journal-2026_再出力.csv',J26.replace(/\n/g,'\r\n')),csv('journal-2025.csv',J25),csv('bs-party-2026.csv',BS),csv('pl-party-2026.csv',PL)]);
 check('3. 同じ内容はすべて「変更なし」',()=>assert.deepStrictEqual(st.items.map(i=>i.status),['same','same','same','same']));
 const applyDisabled=await p.$eval('#inboxDialog [data-inbox="apply"]',b=>b.disabled);check('3. 反映するものがないとき反映ボタンは押せない',()=>assert.strictEqual(applyDisabled,true));
 await closeInbox();
 const leftAfterClose=await p.evaluate(()=>window.ReviewInbox.state());
 check('3. 閉じると「変更なし」のCSVは受信トレイから外れる',()=>assert.strictEqual(leftAfterClose,null),leftAfterClose);
 const unchanged=await snapshot();
 check('3. 確認の記録・資料が変わらない',()=>same(unchanged,marked,'資料と記録'));
 check('3. 記録が実際に付いている（テストの前提）',()=>assert.ok(Object.values(marked.decisions).some(d=>d.status==='resolved')));

 // 4. 当期の仕訳帳だけ変えたものを入れる → 差分を表示 → 反映 → 「反映前に戻す」で記録ごと戻る
 st=await drop([csv('journal-2026_修正後.csv',changedJournal())]);
 const it4=st.items[0];
 check('4. 変更ありは「反映する：更新」',()=>{assert.strictEqual(it4.status,'apply');assert.strictEqual(it4.kind,'update');},it4);
 check('4. 差分の件数（変更1行＝削除1・追加1、追加の行1）',()=>{assert.strictEqual(it4.diff.kind,'journal');assert.strictEqual(it4.diff.added,2);assert.strictEqual(it4.diff.removed,1);});
 await p.click('#inboxDialog .inbox-diff summary');
 if(out)await p.screenshot({path:path.join(out,'inbox-3-diff.png')});
 const resetText=await p.$eval('#inboxDialog .dialogbody',d=>d.textContent);
 check('4. 反映前に「再確認に戻る記録の件数」を表示',()=>assert.match(resetText,/確認済みの記録 \d+件が「再確認」に戻ります/));
 st=await confirmAndApply();
 const changed=await snapshot();
 check('4. 反映で当期の仕訳が変わる',()=>assert.notStrictEqual(digest(changed.datasets.current),digest(marked.datasets.current)));
 const can=await p.evaluate(()=>window.ReviewInbox.canUndo());check('4. 反映直後は戻せる',()=>assert.strictEqual(can,true));
 await p.click('#inboxDialog [data-inbox="undo"]');await p.click('#inboxDialog [data-inbox="undoConfirmed"]');
 await p.waitForFunction(()=>!document.querySelector('#inboxDialog[open]')&&!window.LedgerApp.isAnalyzing(),null,{timeout:60000});
 const restored=await snapshot();
 check('4. 「反映前に戻す」で資料と記録が反映前と同じ',()=>same(restored,marked,'資料と記録'));

 // 5. ほかの操作（記録の保存）をした後は戻せない
 st=await drop([csv('journal-2026_修正後.csv',changedJournal())]);st=await confirmAndApply();await closeInbox();
 const bannerUndo=await p.evaluate(()=>!!document.querySelector('#inboxBanner [data-inbox-open="result"]'));
 check('5. 資料ページに「内容を見る・戻す」の案内',()=>assert.strictEqual(bannerUndo,true));
 if(out)await p.screenshot({path:path.join(out,'inbox-4-banner.png')});
 await p.evaluate(()=>{const s=window.LedgerApp.getSession();s.memo=(s.memo||'')+'x';window.ReviewAppBridge.save();});
 const canAfter=await p.evaluate(()=>window.ReviewInbox.canUndo());check('5. 反映後に保存が起きたら戻せない',()=>assert.strictEqual(canAfter,false));

 // 6. 同じ内容のファイル2つ（重複）と、同じ種類で中身が違うファイル2つ（衝突）
 st=await drop([csv('bs-item-2026.csv',BSI),csv('bs-item-2026_コピー.csv',BSI)]);
 check('6. 重複は2つ目を反映しない',()=>assert.deepStrictEqual(st.items.map(i=>i.status),['apply','dup']),st.items);
 await clearInbox();
 st=await drop([csv('journal-2026_A.csv',J26.replace('Google広告','Google広告A')),csv('journal-2026_B.csv',J26.replace('Google広告','Google広告B'))]);
 check('6. 同じ種類が2つあると衝突として止める',()=>assert.ok(st.items.every(i=>i.status==='apply'&&i.conflict)),st.items);
 await p.check('#inboxConfirm');
 const blocked=await p.$eval('#inboxDialog [data-inbox="apply"]',b=>b.disabled);check('6. 衝突中は反映できない',()=>assert.strictEqual(blocked,true));
 await p.uncheck(`#inboxDialog [data-inbox-include]`);await p.waitForTimeout(100);
 st=await p.evaluate(()=>window.ReviewInbox.state());
 check('6. 片方を外すと衝突が解ける',()=>assert.ok(st.items.every(i=>!i.conflict)),st.items);
 await clearInbox();

 // 7. 事業者名が違う帳票は反映しない
 st=await drop([csv('bs-party-別会社.csv',BS.replace('やまだデザイン事務所（架空）','かわさき商店（架空）'))]);
 check('7. 読込済みと事業者名が違うと「反映できない」',()=>{assert.strictEqual(st.items[0].status,'blocked');assert.match(st.items[0].reasons.join(''),/事業者名が違います/);},st.items[0]);
 await clearInbox();

 // 8. 自動では反映しない種類（売掛金の期日一覧）は「要確認」→ 従来の画面で読み込む
 st=await drop([csv('aging.csv','発生日,勘定科目,取引先,期日,決済残額,基準日,管理番号\n2026/01/31,売掛金,サンプル取引先,2026/02/28,100000,2026/06/30,EXAMPLE-001\n')]);
 check('8. 期日一覧は「要確認」',()=>{assert.strictEqual(st.items[0].type,'aging');assert.strictEqual(st.items[0].status,'check');},st.items[0]);
 await p.click('#inboxDialog [data-inbox-legacy]');
 await p.waitForSelector('#importDialog[open]',{timeout:30000});
 check('8. 従来の確認画面が開く',()=>assert.ok(true));
 await p.click('#importDialog [data-action="closeImport"]').catch(()=>{});await p.keyboard.press('Escape').catch(()=>{});
 await p.waitForTimeout(300);

 // 8b. 「1ファイルずつ確認する（従来の方法）」は、変更なしのCSVを渡さない
 st=await drop([csv('journal-2025.csv',J25),csv('aging.csv','発生日,勘定科目,取引先,期日,決済残額,基準日,管理番号\n2026/01/31,売掛金,サンプル取引先,2026/02/28,100000,2026/06/30,EXAMPLE-001\n')]);
 check('8b. 前期の仕訳帳は変更なし、期日一覧は要確認',()=>assert.deepStrictEqual(st.items.map(i=>i.status),['same','check']),st.items);
 await p.click('#inboxDialog [data-inbox="legacyAll"]');
 await p.waitForSelector('#importDialog[open]',{timeout:30000});
 const legacyName=await p.$eval('#importDialog .importname',e=>e.textContent).catch(()=>'');
 const queued=await p.evaluate(()=>window.ReviewInbox.state());
 check('8b. 従来の画面には期日一覧だけを渡す',()=>{assert.match(legacyName,/aging\.csv/);assert.strictEqual(queued,null);},{legacyName,queued});
 await p.keyboard.press('Escape').catch(()=>{});await p.waitForTimeout(300);

 // 8c. 反映しなかった「要確認」のCSVは、反映後も受信トレイに残る
 st=await drop([csv('journal-2026_修正後2.csv',changedJournal().replace('Google広告','Google広告（修正）')),csv('aging.csv','発生日,勘定科目,取引先,期日,決済残額,基準日,管理番号\n2026/01/31,売掛金,サンプル取引先,2026/02/28,100000,2026/06/30,EXAMPLE-001\n')]);
 check('8c. 仕訳帳は反映する、期日一覧は要確認',()=>assert.deepStrictEqual(st.items.map(i=>i.status),['apply','check']),st.items);
 st=await confirmAndApply();
 const rest=await p.$('#inboxDialog [data-inbox="openList"]');
 check('8c. 結果の画面に「残りのCSVを確認する」',()=>assert.ok(rest));
 await closeInbox();
 const pend=await p.evaluate(()=>({state:window.ReviewInbox.state(),banner:!!document.querySelector('#inboxBanner [data-inbox-open="list"]'),undo:!!document.querySelector('#inboxBanner [data-inbox-open="result"]')}));
 check('8c. 閉じた後も要確認のCSVが残り、資料ページに「受信トレイを開く」と「内容を見る・戻す」',()=>{assert.deepStrictEqual(pend.state.items.map(i=>i.name),['aging.csv']);assert.ok(pend.banner);assert.ok(pend.undo);},pend);
 await p.click('#inboxBanner [data-inbox-open="list"]');await p.waitForSelector('#inboxDialog[open]');
 await clearInbox();

 // 9. 途中で反映に失敗したら、すべて取り消して反映前に戻る
 const co9=await newCompany('巻き戻しC（架空）');
 st=await drop([csv('journal-2026.csv',J26),csv('pl-party-2026.csv',PL)]);
 const before9=await snapshot();
 // 受信トレイの事前確認（1回目の呼び出し）は通し、反映（2回目）で失敗させる
 await p.evaluate(()=>{const RV=window.ReviewReportViews,orig=RV.prepare;let n=0;RV.__orig=orig;RV.prepare=function(){if(++n>=2)throw Error('テスト用の失敗');return orig.apply(this,arguments);};});
 st=await confirmAndApply();
 await p.evaluate(()=>{const RV=window.ReviewReportViews;RV.prepare=RV.__orig;delete RV.__orig;});
 const after9=await snapshot();
 check('9. 失敗を表示',()=>assert.match(st.error,/すべて取り消し/),st);
 check('9. 先に反映した当期の仕訳も取り消される',()=>same(after9,before9,'資料と記録'));
 await clearInbox();

 // 10. 不足資料の表示、種類を指定したボタンは従来どおり
 const co10=await newCompany('不足D（架空）');
 st=await drop([csv('journal-2026.csv',J26)]);
 check('10. 不足資料を表示',()=>assert.deepStrictEqual(st.missing,['前期の仕訳帳','当期の月次BS','当期の月次PL']));
 await closeInbox();
 const bannerPending=await p.evaluate(()=>!!document.querySelector('#inboxBanner [data-inbox-open="list"]'));
 check('10. 未反映のCSVがあると資料ページに案内',()=>assert.strictEqual(bannerPending,true));
 await p.evaluate(()=>document.querySelector('[data-action="import"][data-type="monthlyPL"]')?.click());
 const [chooser]=await Promise.all([p.waitForEvent('filechooser',{timeout:5000}).catch(()=>null),p.evaluate(()=>{const b=document.querySelector('[data-action="import"][data-type]');if(b)b.click();})]);
 if(chooser){await chooser.setFiles({name:'journal-2026.csv',mimeType:'text/csv',buffer:Buffer.from(J26)});await p.waitForSelector('#importDialog[open]',{timeout:30000});}
 check('10. 種類を指定したボタンは従来の確認画面',()=>assert.ok(chooser));
 await p.keyboard.press('Escape').catch(()=>{});await p.waitForTimeout(300);

 // 13. ドラッグ＆ドロップでも受信トレイに入る（種類を指定したボタンを使った後でも）
 await p.evaluate(()=>document.querySelector('[data-view="data"]')?.click());await p.waitForSelector('#dropzone');
 await p.evaluate(text=>{const dt=new DataTransfer();dt.items.add(new File([text],'ドロップ.csv',{type:'text/csv'}));document.querySelector('#dropzone').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));},J26);
 await p.waitForFunction(()=>{const s=window.ReviewInbox.state();return s&&!s.reading&&s.items.some(i=>i.name==='ドロップ.csv')&&document.querySelector('#inboxDialog[open]');},null,{timeout:30000}).then(()=>check('13. ドロップしたCSVは受信トレイに入る',()=>assert.ok(true)),e=>check('13. ドロップしたCSVは受信トレイに入る',()=>{throw e;}));
 await clearInbox();

 // 12. 8ファイル（仕訳帳2つ＋BS・PLの取引先・品目・部門）をまとめて入れる → 入れ直すとすべて変更なし → BSを1か所変えると、その帳票だけ更新
 await p.bringToFront();
 const co12=await newCompany('8ファイルE（架空）');
 st=await drop(EIGHT());
 check('12. 8ファイルをすべて自動で反映対象にする',()=>assert.deepStrictEqual(st.items.map(i=>i.status),Array(8).fill('apply')),st.items.map(i=>[i.name,i.status,i.reasons]));
 check('12. 初回はBS・PLの事業者名の確認を求める',()=>assert.ok(st.items.filter(i=>/bs|pl/.test(i.name)).every(i=>i.needsEntityConfirm)));
 const t12=Date.now();st=await confirmAndApply();const ms12=Date.now()-t12;await closeInbox();
 check('12. 8件を反映',()=>assert.strictEqual(st.error,''),st);
 const kubunText=await p.evaluate(()=>document.querySelector('#inboxDialog')?.textContent||'');
 st=await drop(EIGHT());
 check('12. 入れ直すとすべて「変更なし」',()=>assert.deepStrictEqual(st.items.map(i=>i.status),Array(8).fill('same')),st.items.map(i=>[i.name,i.status,i.reasons]));
 await clearInbox();
 st=await drop([csv('bs-party-2026_修正後.csv',changedBS())]);
 check('12. 変えたBSだけ「更新」、変わったセルは2つ（科目合計と内訳）',()=>{assert.strictEqual(st.items[0].status,'apply');assert.strictEqual(st.items[0].kind,'update');assert.strictEqual(st.items[0].diff.changed,2);assert.strictEqual(st.items[0].diff.added,0);assert.strictEqual(st.items[0].diff.removed,0);},st.items[0]);
 check('12. 2回目は事業者名の確認を求めない',()=>assert.strictEqual(st.items[0].needsEntityConfirm,false),st.items[0]);
 if(out&&await p.$('#inboxDialog .inbox-diff summary')){await p.click('#inboxDialog .inbox-diff summary');await p.screenshot({path:path.join(out,'inbox-5-bsdiff.png')});}
 await clearInbox();
 console.log(`（参考）8ファイルの反映：${ms12}ミリ秒`);
 // 11. 再読込で残る。v4.3 で同じ保存データを開いてもエラーにならない
 await p.evaluate(()=>window.ReviewAppBridge.save());await p.waitForTimeout(800);
 await p.reload();await p.waitForFunction(()=>window.LedgerApp&&window.ReviewAppBridge&&!window.ReviewAppBridge.loading(),{timeout:30000});
 const names=await p.evaluate(()=>window.LedgerApp.getWorkspace().companies.map(c=>c.name));
 const nk=v=>String(v).normalize('NFKC');
 check('11. 再読込後も会社が残る',()=>['受信トレイA（架空）','従来の取込B（架空）'].forEach(n=>assert.ok(names.map(nk).includes(nk(n)))),names);
 const coE=await p.evaluate(()=>window.LedgerApp.getWorkspace().companies.find(c=>c.name.normalize('NFKC').startsWith('8ファイルE')).id);
 await p.evaluate(id=>window.LedgerApp.openCompany(id,'data'),coE);await p.waitForFunction(()=>!window.LedgerApp.isAnalyzing(),null,{timeout:60000});
 st=await drop(EIGHT().map(f=>({...f,name:f.name.replace('.csv','_再出力.csv'),buffer:Buffer.from(f.buffer.toString('utf8').replace(/\r?\n/g,'\r\n'))})));
 check('11. 再読込の後も、改行コードだけ違う8ファイルはすべて「変更なし」',()=>assert.deepStrictEqual(st.items.map(i=>i.status),Array(8).fill('same')),st.items.map(i=>[i.name,i.status]));
 await clearInbox();
 st=await drop([{name:'journal-2026-sjis.csv',mimeType:'text/csv',buffer:fs.readFileSync(path.join(FX,'journal-2026-sjis.csv'))}]);
 const sjisRow=await p.$eval('#inboxDialog .inbox-row',r=>r.textContent);
 check('11. Shift_JIS の同じ仕訳帳は「変更なし」、文字コードを表示',()=>{assert.strictEqual(st.items[0].status,'same');assert.match(sjisRow,/Shift_JIS/);},st.items[0]);
 await clearInbox();
 const p43=await ctx.newPage();const e43=[];p43.on('pageerror',e=>e43.push(e.message));
 await p43.goto('file://'+BASE);await p43.waitForFunction(()=>window.LedgerApp&&document.querySelector('[data-view]'),{timeout:30000});await p43.waitForTimeout(1500);
 const v43=await p43.evaluate(()=>({companies:window.LedgerApp.getWorkspace().companies.map(c=>c.name.normalize('NFKC')),text:document.body.innerText.includes('保存データを読めませんでした')}));
 check('11. v4.3 で開いても読める',()=>{assert.ok(v43.companies.includes(nk('受信トレイA（架空）')));assert.strictEqual(v43.text,false);assert.deepStrictEqual(e43,[]);},{v43,e43});

 check('ページのエラーなし',()=>assert.deepStrictEqual(errors,[]),errors);
 await b.close();
 for(const [r,l]of results)console.log(r,l);
 const ng=results.filter(r=>r[0]==='NG').length;console.log(ng?`NG ${ng}件`:`すべてOK（${results.length}件）`);process.exit(ng?1:0);
})().catch(e=>{console.error(e);process.exit(1);});

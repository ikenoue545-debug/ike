// node --test tests/feedback-order.test.js
// 確認キューの「対応の順番」（ReviewFeedbackOrder）：段階・誰が動くか・まとめ方・前回の判断・書き出し、月次画面の欄と確認キューの画面。
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const H=require('./harness.js');
const ctx=H.load(),E=ctx.ReviewEngine,F=ctx.ReviewFinancial,T=ctx.ReviewTagReports,FO=ctx.ReviewFeedbackOrder,UI=ctx.ReviewFeedbackOrderUI;
const plain=v=>JSON.parse(JSON.stringify(v));
const FX=path.join(__dirname,'fixtures','freee'),read=f=>fs.readFileSync(path.join(FX,f),'utf8');
const itemOf=(b,f)=>b.byId.get(f.id);

test('フィクスチャの67件：すべてどこかの段階に入り、6段階の名前と順番が仕様どおり',()=>{
 const s=H.session(ctx),r=E.analyze(s),b=FO.build(s,r);
 assert.equal(r.findings.length,67);
 assert.deepEqual(plain(b.stages.map(x=>x.name)),['資料をそろえる','残高を確定する','回収・支払と仮勘定','売上・経費の計上','税金と区分','記帳のしかた（次回から）']);
 for(const f of r.findings){const it=itemOf(b,f);assert.ok(it,'未分類：'+f.title);assert.ok(it.stage>=1&&it.stage<=6);assert.ok(FO.ACTORS[it.actor]);}
 assert.equal(b.stages.reduce((n,x)=>n+x.items.reduce((m,i)=>m+i.findings.length,0),0),67,'重複なく全件');
 assert.ok(b.items.length<r.findings.length,'同じ論点はまとまる');
 // 並び：段階の昇順、段階内は優先度の降順
 for(let i=1;i<b.items.length;i++){const a=b.items[i-1],c=b.items[i];assert.ok(a.stage<c.stage||a.stage===c.stage&&a.score>=c.score);}
 assert.deepEqual(plain(b.order.slice().sort()),plain(r.findings.map(f=>f.id).sort()));
});

test('取引先別の回収・支払の停滞（レッドストーン・クロダ製版）は段階3・お客様に質問',()=>{
 const s=H.session(ctx),r=E.analyze(s),b=FO.build(s,r);
 const po=r.findings.filter(f=>f.partyOpeningCheck);
 assert.equal(po.length,2);
 for(const f of po){assert.equal(FO.stageOf(f),3);assert.equal(FO.actorOf(f),'ask');}
 const red=itemOf(b,po.find(f=>/レッドストーン/.test(f.reviewContext)));assert.equal(red.party,'(株)レッドストーン');assert.equal(red.account,'売掛金');
 const line=b.clientList.find(x=>x.topic===red.topic);assert.ok(line);assert.match(line.text,/^2025年8月の売掛金（\(株\)レッドストーン） 220,000円について、取引の内容を教えてください。/);
});

test('給料手当の「源泉・住民税 預り」8件は、1つの対応項目（関連8件）として段階5に入る',()=>{
 const s=H.session(ctx),r=E.analyze(s),b=FO.build(s,r);
 const ps=r.findings.filter(f=>f.check==='personal'&&f.rows.some(x=>x.account==='給料手当'));
 assert.equal(ps.length,8);
 const its=new Set(ps.map(f=>itemOf(b,f)));assert.equal(its.size,1);
 const it=[...its][0];assert.equal(it.findings.length,8);assert.equal(it.stage,5);assert.equal(it.actor,'ask');
 assert.equal(it.amount,200000);assert.equal(it.amountMode,'sum','明細が重ならないので合計');
 assert.match(FO.entryText(it,s),/計 200,000円/);
 // 1件だけの租税公課（住民税）は別の項目
 const tax=r.findings.find(f=>f.check==='personal'&&f.amount===58000);assert.notEqual(itemOf(b,tax),it);
});

test('自動登録ルールの候補（参考）は段階6・記録のみ、過去にない組み合わせは段階6・修正依頼',()=>{
 const s=H.session(ctx),r=E.analyze(s),b=FO.build(s,r);
 const rules=r.findings.filter(f=>f.check==='rules');assert.equal(rules.length,11);
 for(const f of rules){assert.equal(FO.stageOf(f),6);assert.ok(['note','fix'].includes(FO.actorOf(f)));}
 assert.ok(b.clientList.every(x=>!rules.some(f=>x.ids.includes(f.id))),'記録のみはお客様への確認リストに入れない');
 const other=r.findings.find(f=>f.check==='other'&&/過去資料にない/.test(f.title));assert.equal(FO.stageOf(other),6);assert.equal(FO.actorOf(other),'fix');
 // 変動・計上漏れは計上の問題（段階4）
 const gap=r.findings.find(f=>f.check==='other'&&/計上のない月/.test(f.title));assert.equal(FO.stageOf(gap),4);
 const swing=r.findings.find(f=>/前月から大きく変動/.test(f.title));assert.equal(FO.stageOf(swing),4);assert.equal(FO.actorOf(swing),'office','増減はまず元帳で比べる');
 assert.equal(FO.actorOf(r.findings.find(f=>f.check==='asset')),'office');
});

test('月次PL・BSが未読込のときは、段階1に資料の依頼が入り、後の段階は暫定になる',()=>{
 const s=H.session(ctx,{pl:false,bs:false}),r=E.analyze(s),b=FO.build(s,r);
 const req=b.stages[0].items.filter(i=>i.materials);
 assert.deepEqual(plain(req.map(i=>i.materials).sort()),['monthlyBS','monthlyPL']);
 for(const i of req){assert.equal(i.actor,'request');assert.equal(i.status,'open');}
 assert.equal(b.next.stage,1);
 const lines=b.clientList.filter(x=>x.actor==='request').map(x=>x.text);
 assert.ok(lines.includes('月次推移の損益計算書（CSV）をお送りください（2026年1月〜9月）。'));
 const later=b.items.filter(i=>i.stage>1&&i.status!=='done');assert.ok(later.length);
 for(const i of later){assert.equal(i.provisional.stage,1);assert.equal(i.provisional.name,'資料をそろえる');assert.ok(i.provisional.count>=2);}
 // 一覧：注意は段階の見出しに1回、項目には「暫定」の札。資料の依頼の行は読込画面へ
 const html=UI.list(s,r,r.findings,(f,it)=>`<b data-id="${f.id}">${UI.rowBadges(it)}</b>`,{filter:'all'});
 assert.equal((html.match(/class="fo-stageprov">暫定：先に「資料をそろえる」の \d+件を片付けると/g)||[]).length,b.stages.filter(x=>x.no>1&&x.items.some(i=>i.status!=='done')).length);
 assert.ok((html.match(/class="fo-provtag"/g)||[]).length>=later.length);assert.equal((html.match(/fo-material/g)||[]).length,2);assert.match(html,/data-view="data">資料の読込へ/);
 assert.equal(UI.list(s,r,[],()=>'',{filter:'difference'}),'','絞り込みで該当がなければ空（資料の依頼も出さない）');
 // 両方あるときは資料の依頼は出ない
 const s2=H.session(ctx),b2=FO.build(s2,E.analyze(s2));assert.equal(b2.items.filter(i=>i.materials).length,0);
});

test('論点の鍵（topic）は、設定（変動の基準）を変えて id が変わっても同じ',()=>{
 const s1=H.session(ctx),r1=E.analyze(s1),s2=H.session(ctx);s2.project.variance=.6;const r2=E.analyze(s2);
 const sig=f=>[f.check,f.title,f.account||'',(f.months||[]).join(),f.amount,f.rows.length].join('|');
 const m2=new Map(r2.findings.map(f=>[sig(f),f]));let same=0,changed=0;
 for(const f of r1.findings){const g=m2.get(sig(f));if(!g)continue;same++;if(f.id!==g.id)changed++;assert.equal(FO.topicKey(f),FO.topicKey(g),f.title);}
 assert.ok(same>=40,'比べられる指摘が十分ある：'+same);assert.equal(changed,same,'id はすべて変わる（だから topic が要る）');
 assert.ok(r1.findings.every(f=>!/review-evidence|0\.5|0\.6/.test(FO.topicKey(f))));
});

test('判断に topic を残すと、再分析で id が変わっても「前回の判断」を表示し、ワンクリックで引き継げる',()=>{
 const s=H.session(ctx),r=E.analyze(s),b=FO.build(s,r);
 const it=b.items.find(i=>i.findings.length===8),f=it.findings[0];
 for(const x of it.findings)s.decisions[x.id]={status:'resolved',note:'従業員の源泉・住民税の預り。給与台帳と一致。',topic:FO.topicKey(x),reviewLabel:x.title,reviewPeriod:'2026-01〜2026-09',at:'2026-10-01T00:00:00.000Z'};
 assert.equal(FO.build(s,r).byId.get(f.id).status,'done');
 // 設定を変えて再分析：id が変わり、判断は今の指摘には付かない
 s.project.variance=.6;const r2=E.analyze(s),b2=FO.build(s,r2),it2=b2.items.find(i=>i.topic===it.topic);
 assert.ok(it2);assert.equal(it2.status,'open');assert.ok(it2.findings.every(x=>!s.decisions[x.id]),'自動では引き継がない');
 assert.equal(it2.carried.status,'resolved');assert.match(it2.carried.note,/給与台帳と一致/);
 const html=UI.carryHTML(it2);assert.match(html,/前回：確認済み（従業員の源泉・住民税の預り。給与台帳と一致。）/);assert.match(html,/data-action="foUsePrev"/);
 assert.equal(FO.usePrevious(s,r2,it.topic,'2026-10-07T00:00:00.000Z'),8);
 const d=s.decisions[it2.findings[0].id];assert.equal(d.status,'resolved');assert.equal(d.topic,it.topic);assert.equal(d.carriedFrom.length>0,true);
 const b3=FO.build(s,r2),it3=b3.items.find(i=>i.topic===it.topic);assert.equal(it3.status,'done');assert.equal(it3.carried,null);
 assert.ok(!b3.clientList.some(x=>x.topic===it.topic),'完了した項目はお客様への確認リストから外れる');
});

test('状態：確認中（ask）を含む項目は確認中、すべて確認済み・見送りなら完了。次にやることは未対応の先頭',()=>{
 const s=H.session(ctx),r=E.analyze(s),b=FO.build(s,r),first=b.next;
 assert.equal(first.stage,b.items.find(i=>i.status==='open').stage);
 s.decisions[first.findings[0].id]={status:'ask',note:'お客様に依頼済み'};
 const b2=FO.build(s,r);assert.equal(b2.byId.get(first.findings[0].id).status,'asking');assert.notEqual(b2.next.topic,first.topic);
 assert.ok(b2.stages[first.stage-1].asking>=1,'確認中は未対応とは別に数える（未完了）');
 const it=b2.items.find(i=>i.findings.length>1);for(const f of it.findings)s.decisions[f.id]={status:'defer',note:''};
 assert.equal(FO.build(s,r).byId.get(it.findings[0].id).status,'done');
});

test('再確認：前回お客様に確認していた論点が、資料の読み直し後に出てこなければ「解消した可能性」に残る',()=>{
 const s=H.session(ctx),r=E.analyze(s),b=FO.build(s,r);
 const red=b.items.find(i=>/レッドストーン/.test(i.party));s.decisions[red.findings[0].id]={status:'ask',note:'入金予定を確認中',topic:red.topic};
 assert.equal(FO.reconcile(s,FO.build(s,r),'2026-10-01T00:00:00.000Z'),true);
 const snap=s.manual.feedbackSnapshot;assert.ok(snap.topics.some(t=>t.topic===red.topic&&t.status==='ask'));assert.deepEqual(plain(snap.gone),[]);
 assert.equal(FO.reconcile(s,FO.build(s,r)),false,'同じ資料・同じ状態では変わらない');
 // 当期の仕訳を読み直した（レッドストーンの入金が登録された）想定：該当の論点が消える
 const r2={...r,findings:r.findings.filter(f=>!red.findings.includes(f))};
 s.imports=s.imports.map(i=>i.type==='current'?{...i,at:'2026-10-07T00:00:00.000Z'}:i);
 assert.equal(FO.reconcile(s,FO.build(s,r2),'2026-10-07T00:00:00.000Z'),true);
 const gone=s.manual.feedbackSnapshot.gone;assert.equal(gone.length,1);assert.equal(gone[0].topic,red.topic);assert.equal(gone[0].status,'ask');
 const html=UI.header(s,r2);assert.match(html,/前回お客様に確認していた 1件/);assert.match(html,/data-action="foClearGone"/);
 assert.equal(FO.clearGone(s),true);assert.equal(s.manual.feedbackSnapshot.gone.length,0);
 // 保存して読み直しても残る（validateSession は manual をそのまま保つ）
 const v=E.validateSession(JSON.parse(JSON.stringify(s)));assert.equal(v.manual.feedbackSnapshot.sig,s.manual.feedbackSnapshot.sig);
});

test('CSVの書き出し：式として読まれる文字で始まるセルは先頭に \' を付ける',()=>{
 for(const [v,w] of [['=1+1',"'=1+1"],['+81-3','\'+81-3'],['-5','\'-5'],['@SUM(A1)','\'@SUM(A1)'],['\tx','\'\tx']])assert.equal(FO.cell(v),w);
 assert.equal(FO.cell('\rx'),'"\'\rx"');assert.equal(FO.cell('a,"b"'),'"a,""b"""');assert.equal(FO.cell('普通の文'),'普通の文');
 const list=[{stage:5,stageName:'税金と区分',actorLabel:'お客様に質問',statusLabel:'未対応',account:'=1+1',party:'@x',monthLabel:'2026年3月',amount:1000,text:'=1+1',title:'-t',count:1}];
 const csv=FO.csv(list),lines=csv.replace(/^﻿/,'').trim().split('\r\n');
 assert.ok(csv.startsWith('﻿'));assert.equal(lines[0],'番号,段階,誰が,状況,科目,取引先・タグ,対象月,金額（円）,内容,指摘,関連件数');
 assert.equal(lines[1],"1,5 税金と区分,お客様に質問,未対応,'=1+1,'@x,2026年3月,1000,'=1+1,'-t,1");
 // 実際の書き出し
 const s=H.session(ctx),r=E.analyze(s),c=UI.exportCSV('client',s,r),o=UI.exportCSV('office',s,r);
 assert.equal(c.trim().split('\r\n').length-1,FO.build(s,r).clientList.length);assert.match(o,/消耗品の高額な明細/);
 assert.match(UI.exportText('client',s,r),/^お客様への確認のお願い\nやまだデザイン事務所（架空）　2026年1月〜9月/);
 assert.match(UI.printHTML('office',s,r),/<table>/);assert.match(UI.fileName('client',s),/^お客様への確認リスト_2026-01_2026-09\.csv$/);
});

test('月次画面：「対応の順番」の欄が「今見るべき科目」の直前にあり、目次に短い名前で出る',()=>{
 const s=H.session(ctx),r=E.analyze(s),html=F.page(s,r,null);
 const at=html.indexOf('id="feedbackOrder"'),now=html.indexOf('<h2>今見るべき科目</h2>');
 assert.ok(at>0&&at<now&&html.indexOf('id="vtChanges"')<at);
 const panel=html.slice(html.lastIndexOf('<section',at),now);
 assert.equal((panel.match(/class="fo-nextrow"/g)||[]).length,3);assert.match(panel,/data-view="review"/);assert.equal((panel.match(/<li/g)||[]).length,6);
 const e=ctx.ReviewMonthlyToc.entries(html).find(x=>x.title==='対応の順番');assert.equal(e.short,'対応順');
});

// ---- freee のタグ別帳票（取引先・品目・部門）を読み込んだときの指摘
function importText(s,text,name,type){
 const rows=E.parseCSV(text),h=E.headerRow(rows,type,s.project),mapping=E.guessMapping(rows[h],type,s.project);
 const res=E.normalizeRows(rows,type,mapping,h,{project:s.project,unit:F.detectUnit(rows,h),basis:F.detectBasis(rows,h)});
 assert.equal(res.errors.length,0,name);
 const importSource='csv:'+E.hash(name),items=res.items.map(r=>({...r,source:name,importSource,importErrors:0}));
 return T.apply(s,type,items,{importSource,mode:'replace',record:{type,name,importSource,count:items.length,errors:0,at:'2026-10-06T00:00:00.000Z',months:res.reportStats.months,reportStats:res.reportStats}});
}
function edit(text,fn){return text.split('\n').map(l=>{if(!l.startsWith('"'))return l;const cells=l.slice(1,-1).split('","'),out=fn(cells);return out===null?null:Array.isArray(out[0])?out.map(c=>'"'+c.join('","')+'"').join('\n'):'"'+out.join('","')+'"';}).filter(l=>l!==null).join('\n');}
function all8(){const s=H.session(ctx,{pl:false,bs:false});s.imports=s.imports.filter(i=>!/^monthly/.test(i.type));for(const st of ['pl','bs'])for(const d of ['none','party','item','department'])importText(s,read(`${st}-${d}-2026.csv`),`${st}-${d}-2026.csv`,st==='pl'?'monthlyPL':'monthlyBS');return s;}
const kindOf=f=>{try{const c=JSON.parse(f.reviewContext);return c[0]==='tag-report'?c[1]:'';}catch{return '';}};
const EXPECT={'tag-mismatch':[1,'office'],'tag-conflict':[1,'office'],'tag-negative':[3,'ask'],'tag-clearing':[3,'fix'],'tag-unselected':[6,'fix']};

test('タグ別帳票の指摘：内訳の不一致は段階1、マイナス・精算漏れは段階3、未選択は段階6',()=>{
 const s=all8();
 importText(s,edit(read('pl-item-2026.csv'),c=>c[1]==='通信費'&&c[2]==='クラウド'?c.map((v,i)=>i===5?String(+v+1000):v):c),'pl-item-bad.csv','monthlyPL');
 importText(s,edit(read('bs-department-2026.csv'),c=>{if(c[1]!=='売掛金'||c[2]!=='デザイン部')return c;const z=c.map((v,i)=>i<3?v:'0');
  return [c,['150','立替金','',...z.slice(3)],['150','立替金','未選択','80000',...z.slice(4).map(()=>'230000')],['150','立替金','デザイン部','20000',...z.slice(4).map(()=>'20000')],['150','立替金','Web制作部','-100000',...z.slice(4).map(()=>'-250000')]];}),'bs-department-tatekae.csv','monthlyBS');
 importText(s,edit(read('bs-party-2026.csv'),c=>{if(c[1]!=='売掛金'||c[2]!=='合同会社グリーンリーフ')return c;const v=x=>c.map((y,i)=>i<3?y:i>=10?x:'0');
  return [c,v('-55000').map((x,i)=>i===2?'(株)テスト過入金':x),v('55000').map((x,i)=>i===2?'(株)テスト前受':x)];}),'bs-party-negative.csv','monthlyBS');
 const r=E.analyze(s),b=FO.build(s,r),tags=r.findings.filter(kindOf);
 const seen=new Set(tags.map(kindOf));for(const k of ['tag-mismatch','tag-negative','tag-clearing','tag-unselected'])assert.ok(seen.has(k),k);
 for(const f of tags){const [st,actor]=EXPECT[kindOf(f)];assert.equal(FO.stageOf(f),st,kindOf(f));assert.equal(FO.actorOf(f),actor,kindOf(f));assert.equal(itemOf(b,f).stage,st);}
 // 内訳の不一致（判定保留）があるので、後の段階は暫定
 const mm=tags.find(f=>kindOf(f)==='tag-mismatch');assert.equal(itemOf(b,mm).blocking,true);
 assert.ok(b.items.filter(i=>i.stage>1&&i.status!=='done').every(i=>i.provisional&&i.provisional.stage===1));
 // 修正のお願いの文面に、タグの種類（部門）が入る
 const un=b.clientList.find(x=>x.ids.some(id=>kindOf(r.findings.find(f=>f.id===id))==='tag-unselected'));
 assert.match(un.text,/^freeeで広告宣伝費の部門の入力をご確認ください。/);
 const cl=b.clientList.find(x=>x.ids.some(id=>kindOf(r.findings.find(f=>f.id===id))==='tag-clearing'));assert.match(cl.text,/^freeeで立替金の部門の入力をご確認ください。/);
 // 論点の鍵はタグの種類・帳票ごとに分かれる
 const keys=new Set(tags.map(f=>FO.topicKey(f)));assert.equal(keys.size,tags.length);
});

test('タグ別帳票：後から読んだ帳票と科目合計が合わず内訳を外したとき（tag-conflict）は段階1・事務所で確認',()=>{
 const s=all8();
 importText(s,edit(read('pl-department-2026.csv'),c=>(c[1]==='広告宣伝費'&&(c[2]===''||c[2]==='Web制作部'))||/^(?:経費 計|差引損益計算)$/.test(c[1])?c.map((v,i)=>i===11||i===15?String(+v+(c[1]==='差引損益計算'?-1000:1000)):v):c),'pl-department-later.csv','monthlyPL');
 const r=E.analyze(s),b=FO.build(s,r),ks=r.findings.filter(f=>kindOf(f)==='tag-conflict');
 assert.ok(ks.length>=1);for(const f of ks){assert.equal(itemOf(b,f).stage,1);assert.equal(itemOf(b,f).actor,'office');}
 assert.ok(b.officeList.some(x=>ks.some(f=>x.ids.includes(f.id))));
});

// ---- 画面（Chromium）。Playwright とブラウザがない環境では飛ばす
const PW=process.env.PLAYWRIGHT_PATH||'/opt/node22/lib/node_modules/playwright',CHROME=process.env.CHROME||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const canBrowse=fs.existsSync(CHROME)&&(()=>{try{require.resolve(PW);return true;}catch{return false;}})();
test('画面：確認キューの段階表示・次にやること・並べ方の切替・CSVの書き出し（1440px／390px）',{skip:!canBrowse&&'Playwright がありません',timeout:120000},async()=>{
 const {chromium}=require(PW),shots=process.env.FO_SHOTS||'';if(shots)fs.mkdirSync(shots,{recursive:true});
 const b=await chromium.launch({executablePath:CHROME});
 try{
  const p=await b.newPage({viewport:{width:1440,height:960},acceptDownloads:true});
  await p.emulateMedia({reducedMotion:'reduce'});
  const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await p.goto('file://'+path.join(H.ROOT,'dist','自計化レビュー_v3.9.html'));
  await p.waitForFunction(()=>window.LedgerApp&&document.querySelector('[data-view]'));await p.waitForTimeout(500);
  if(process.env.FO_THEME)await p.evaluate(t=>document.querySelector(`[data-theme-choice="${t}"]`)?.click(),process.env.FO_THEME);
  await p.evaluate(s=>window.LedgerApp.setSession(s),JSON.parse(JSON.stringify(H.session(ctx))));
  await p.waitForSelector('.fo-order');
  assert.equal(await p.locator('.fo-step').count(),6);
  const step1=await p.locator('.fo-step').first().innerText();assert.match(step1,/資料をそろえる/);
  const next=await p.locator('.fo-next').innerText();assert.match(next,/次にやること/);assert.match(next,/段階1/);
  assert.equal(await p.locator('#findingList .fo-stage').count()>=4,true);
  assert.ok(await p.locator('#findingList .fo-actor').count()>10);
  if(shots){await p.evaluate(()=>{document.querySelector('.fo-order').scrollIntoView();window.scrollBy(0,-20);});await p.waitForTimeout(700);await p.screenshot({path:path.join(shots,'queue-1440.png')});}
  // 次にやること → その指摘を選ぶ
  await p.click('.fo-next [data-finding]');await p.waitForTimeout(150);
  assert.match(await p.locator('#teacherPanel .detailtitle').innerText(),/取引先別期首/);
  // CSV（お客様への確認リスト）
  await p.click('details[data-fo-export="client"] summary');
  const [dl]=await Promise.all([p.waitForEvent('download'),p.click('[data-action="foCsv"][data-kind="client"]')]);
  // 日本語のファイル名は、ヘッドレスのChromiumでは "download" になることがある（ファイル名は Node 側の試験で確かめる）
  assert.ok(/^お客様への確認リスト_2026-01_2026-09\.csv$|^download$/.test(dl.suggestedFilename()),dl.suggestedFilename());
  const csv=fs.readFileSync(await dl.path(),'utf8');assert.ok(csv.startsWith('﻿番号,段階,誰が'));assert.match(csv,/レッドストーン/);
  if(shots)await p.locator('.fo-order').screenshot({path:path.join(shots,'order-export-1440.png')});
  // 印刷の見え方：リストだけ
  await p.evaluate(()=>{const s=window.LedgerApp.getSession(),r=window.LedgerApp.getResult();window.__foDone=window.ReviewFeedbackOrderUI.print('client',s,r,{dryRun:true});});
  await p.emulateMedia({media:'print'});
  assert.equal(await p.evaluate(()=>getComputedStyle(document.getElementById('foPrint')).display),'block');
  assert.equal(await p.evaluate(()=>[...document.body.children].filter(e=>e.id!=='foPrint'&&getComputedStyle(e).display!=='none').length),0);
  if(shots)await p.screenshot({path:path.join(shots,'print-client.png')});
  await p.evaluate(()=>window.__foDone());await p.emulateMedia({media:'screen'});
  // 並べ方を切り替える（従来の一覧）→ 戻す。検索も効く
  await p.click('[data-action="foToggle"]');await p.waitForTimeout(100);
  assert.equal(await p.locator('#findingList .fo-stage').count(),0);assert.equal(await p.locator('#findingList > .finding').count(),67);
  await p.click('[data-action="foToggle"]');await p.waitForTimeout(100);
  await p.fill('#search','私的支出');await p.waitForTimeout(100);
  assert.deepEqual(await p.locator('#findingList .fo-stage h3').allInnerTexts(),['税金と区分']);
  assert.match(await p.locator('#findingList').innerText(),/関連8件/);
  await p.fill('#search','');
  // 390px：横にはみ出さない
  await p.setViewportSize({width:390,height:844});await p.evaluate(()=>window.scrollTo(0,0));await p.waitForTimeout(200);
  await p.evaluate(()=>document.querySelector('.fo-order').scrollIntoView());await p.waitForTimeout(700);
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'390pxで横スクロールしない');
  if(shots)await p.screenshot({path:path.join(shots,'queue-390.png')});
  // 月次画面の欄
  await p.setViewportSize({width:1440,height:960});await p.click('[data-view="monthly"]');await p.waitForSelector('#feedbackOrder');
  assert.equal(await p.locator('#feedbackOrder .fo-nextrow').count(),3);
  if(shots){await p.evaluate(()=>{document.getElementById('feedbackOrder').scrollIntoView();window.scrollBy(0,-130);});await p.waitForTimeout(150);await p.screenshot({path:path.join(shots,'monthly-1440.png')});}
  await p.setViewportSize({width:390,height:844});await p.waitForTimeout(150);
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'月次画面も390pxで横スクロールしない');
  if(shots){await p.evaluate(()=>{document.getElementById('feedbackOrder').scrollIntoView();window.scrollBy(0,-150);});await p.waitForTimeout(150);await p.screenshot({path:path.join(shots,'monthly-390.png')});}
  await p.click('#feedbackOrder [data-view="review"]');await p.waitForSelector('.fo-order');
  assert.deepEqual(errors,[]);
 }finally{await b.close();}
});

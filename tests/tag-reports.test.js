// node --test tests/tag-reports.test.js
// 月次PL・BSの「表示するタグ」別CSVの取込（ReviewFinancial.normalizeReports）と、帳票の置き換え（ReviewTagReports.plan/apply）。
// tests/fixtures/freee の8つの帳票と、それを書き換えた一時ファイル（OSの一時フォルダ）で確かめる。
'use strict';
const test=require('node:test'),{after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const H=require('./harness.js');
const ctx=H.load(),E=ctx.ReviewEngine,F=ctx.ReviewFinancial,T=ctx.ReviewTagReports;
const FX=path.join(__dirname,'fixtures'),FREEE=path.join(FX,'freee');
const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'jikeika-tags-'));after(()=>fs.rmSync(TMP,{recursive:true,force:true}));
const PROJECT={name:'やまだデザイン事務所（架空）',type:'individual',start:'2026-01',end:'2026-09'};
const VARIANTS=['none','party','item','department'],LABEL={party:'取引先',item:'品目',department:'部門'};
const typeOf=f=>/^pl-/.test(path.basename(f))?'monthlyPL':'monthlyBS';
const read=f=>fs.readFileSync(path.join(FREEE,f),'utf8');
const plain=v=>JSON.parse(JSON.stringify(v));
// 書き換えたCSVは一時フォルダに保存してから読む（画面の取込と同じく、ファイルの文字列から始める）
let seq=0;function temp(name,text){const file=path.join(TMP,(++seq)+'-'+name);fs.writeFileSync(file,text);return file;}
// 画面の取込と同じ手順：見出し行・列の対応・単位を推定して normalizeRows
function normalize(text,type,project=PROJECT){
 const rows=E.parseCSV(text),h=E.headerRow(rows,type,project),mapping=E.importMapping(rows,type,h,project);
 return E.normalizeRows(rows,type,mapping,h,{project,unit:F.detectUnit(rows,h),basis:F.detectBasis(rows,h)});
}
// 画面の「取り込む」と同じ（取込の記録つき）。戻り値は plan の結果
function importText(s,text,name,type=typeOf(name),mode='replace'){
 const res=normalize(text,type,s.project);
 assert.equal(res.errors.length,0,name+': '+JSON.stringify(res.errors.slice(0,2)));
 const importSource='csv:'+E.hash(name),items=res.items.map(r=>({...r,source:name,importSource,importErrors:0}));
 return T.apply(s,type,items,{importSource,mode,record:{type,name,importSource,count:items.length,errors:0,at:'2026-10-06T00:00:00.000Z',months:res.reportStats.months,reportStats:plain(res.reportStats)}});
}
const itemsOf=(s,text,name,type=typeOf(name))=>normalize(text,type,s.project).items.map(r=>({...r,source:name,importSource:'csv:'+E.hash(name),importErrors:0}));
const load=(s,f)=>importText(s,read(f),f);
// 全セルを引用符で囲んだ freee の行を、セルの配列として書き換える（null で行を消す・配列の配列で行を足す）
function edit(text,fn){return text.split('\n').map((l,i)=>{if(!l.startsWith('"'))return l;const cells=l.slice(1,-1).split('","'),out=fn(cells,i);return out===null?null:Array.isArray(out[0])?out.map(c=>'"'+c.join('","')+'"').join('\n'):'"'+out.join('","')+'"';}).filter(l=>l!==null).join('\n');}
const cells=text=>text.trim().split('\n').map(l=>l.slice(1,-1).split('","'));
function base(){const s=H.session(ctx,{pl:false,bs:false});s.imports=s.imports.filter(i=>!/^monthly/.test(i.type));return s;}
const files=(dims=VARIANTS)=>dims.flatMap(d=>[`bs-${d}-2026.csv`,`pl-${d}-2026.csv`]);
function sessionWith(list){const s=base();for(const f of list)load(s,f);return s;}
const parents=rows=>rows.filter(r=>!r.tagDimension);
// 保存データの中身（どのファイルから来たかは除く）
const shape=r=>[r.account,r.date,r.amount,!!r.opening,r.tagDimension||'',r.tagValue||'',r.unit,r.role||'',r.accountCode||''];
const tagShape=r=>JSON.stringify([r.type,...shape(r)]);

// ---- (a) normalizeReports
test('freee形式の8つの帳票：行数・表示するタグ・内訳の照合（残高／累計の動き／タグなし）',()=>{
 // 期待値はテスト側でCSVを素朴に数える
 const expected={
  'bs-party-2026.csv':{residual:['普通預金','事業主貸','セゾンカード','預り金','未払消費税'],untagged:['現金','元入金']},
  'bs-item-2026.csv':{residual:['事業主貸'],untagged:['現金','普通預金','売掛金','買掛金','未払金','セゾンカード','預り金','未払消費税','事業主借','元入金']},
  'bs-department-2026.csv':{residual:['売掛金'],untagged:['現金','普通預金','事業主貸','買掛金','未払金','セゾンカード','預り金','未払消費税','事業主借','元入金']},
  'pl-party-2026.csv':{residual:[],untagged:['租税公課']},
  'pl-item-2026.csv':{residual:[],untagged:['法定福利費']},
  'pl-department-2026.csv':{residual:[],untagged:['租税公課','水道光熱費','旅費交通費','通信費','保険料','消耗品費','事務用品費','法定福利費','給料手当','支払手数料','会議費','地代家賃']},
 };
 for(const f of files()){
  const type=typeOf(f),dim=f.split('-')[1],lines=cells(read(f)),head=lines[1];
  const valueCols=head.map((h,i)=>/^\d{4}-\d{2}$|^期首$/.test(h)?i:-1).filter(i=>i>=0),tagCol=dim==='none'?-1:head.indexOf(LABEL[dim]);
  const data=lines.slice(2).filter(c=>c[1]&&valueCols.some(i=>c[i]!==''));
  const tagLines=data.filter(c=>tagCol>=0&&c[tagCol]),parentLines=data.filter(c=>!(tagCol>=0&&c[tagCol]));
  const r=normalize(read(f),type),st=r.reportStats;
  assert.equal(r.fatal,undefined,f);assert.deepEqual(plain(r.errors),[],f);
  assert.equal(parents(r.items).length,parentLines.length*valueCols.length,f+' 科目合計の行数');
  assert.equal(r.items.filter(x=>x.tagDimension).length,tagLines.length*valueCols.length,f+' 内訳の行数');
  assert.equal(st.tagRows,tagLines.length*valueCols.length,f);
  assert.equal(st.accounts,new Set(parentLines.map(c=>c[1])).size,f);
  assert.equal(r.items.filter(x=>x.opening).length,type==='monthlyBS'?data.length:0,f+' 期首');
  assert.ok(r.items.every(x=>x.unit===1&&Number.isSafeInteger(x.amount)),f);
  if(dim==='none'){assert.equal(st.tagDimension,undefined,f);assert.equal(st.tagCheck,undefined,f);assert.deepEqual(plain(r.warnings),[],f);continue;}
  assert.equal(st.tagDimension,dim,f);
  assert.ok(r.items.filter(x=>x.tagDimension).every(x=>x.tagDimension===dim&&x.tagValue),f);
  const tc=st.tagCheck,coded=new Set(parentLines.filter(c=>c[0]&&tagLines.some(t=>t[1]===c[1])).map(c=>c[1]));
  assert.equal(tc.checked,coded.size+parentLines.filter(c=>!c[0]&&tagLines.some(t=>t[1]===c[1])).length,f+' 照合した科目');
  assert.deepEqual(plain(tc.dropped),[],f);assert.deepEqual(plain(tc.mismatches),[],f);assert.deepEqual(plain(tc.missing),[],f);assert.equal(tc.partial,0,f);
  assert.deepEqual(plain(tc.residual),expected[f].residual,f+' 未選択に相殺額');
  assert.deepEqual(plain(tc.untagged),expected[f].untagged,f+' 未選択だけ');
  // 内訳を別に保存すること・照合できたことは注意ではない（取込画面の「表示するタグ」の案内で示す）
  assert.deepEqual(plain(r.warnings),[],f);
  if(type==='monthlyPL'){assert.equal(st.detailReportedTotals.length,tagLines.length,f);assert.ok(st.detailReportedTotals.every(t=>t.difference===0&&t.tagDimension===dim),f+' 期間累計');}
 }
 // 帳票の種類の自動判定
 for(const f of files())assert.equal(E.detectReportType(E.parseCSV(read(f)),PROJECT)?.type,typeOf(f),f);
});

test('内訳の行を1つ消したCSV：その科目の内訳だけ取り込まず、科目合計は残して知らせる',()=>{
 const text=edit(read('bs-party-2026.csv'),c=>c[1]==='買掛金'&&c[2]==='(株)ミドリ印刷'?null:c),ok=normalize(read('bs-party-2026.csv'),'monthlyBS');
 const r=normalize(fs.readFileSync(temp('bs-party-cut.csv',text),'utf8'),'monthlyBS'),tc=r.reportStats.tagCheck;
 assert.equal(r.errors.length,0);assert.deepEqual(plain(tc.dropped),['買掛金']);
 assert.equal(tc.mismatches.length,13,'期首と12か月');assert.deepEqual(plain(tc.mismatches[0]),{account:'買掛金',month:'2025-12',total:220000,sum:55000,diff:165000});
 assert.match(r.warnings[0],/^取引先別の内訳の合計が科目合計と合わない科目が 1 科目あります（買掛金 2025-12：科目合計 220,000円／取引先別の合計 55,000円（差 165,000円）、/);
 assert.match(r.warnings[0],/この科目の内訳は取り込まず、科目合計だけを取り込みます。/);
 assert.equal(r.items.filter(x=>x.account==='買掛金'&&x.tagDimension).length,0);
 assert.deepEqual(parents(r.items).map(shape),parents(ok.items).map(shape),'科目合計はそのまま');
 assert.equal(r.items.filter(x=>x.tagDimension).length,ok.items.filter(x=>x.tagDimension).length-2*13,'他の科目の内訳は残る');
 assert.equal(r.reportStats.tagRows,r.items.filter(x=>x.tagDimension).length);
 // PL：品目の行を1つ消す
 const pl=normalize(fs.readFileSync(temp('pl-item-cut.csv',edit(read('pl-item-2026.csv'),c=>c[1]==='通信費'&&c[2]==='クラウド'?null:c)),'utf8'),'monthlyPL');
 assert.deepEqual(plain(pl.reportStats.tagCheck.dropped),['通信費']);assert.match(pl.warnings[0],/^品目別の内訳の合計が科目合計と合わない科目が 1 科目あります（通信費 2026-01/);
 assert.equal(pl.items.filter(x=>x.account==='通信費'&&x.tagDimension).length,0);assert.equal(pl.items.filter(x=>x.account==='通信費'&&!x.tagDimension).length,12);
 // 科目合計の行を消したCSV：内訳を足して合計にはせず、確認を保留すると知らせる
 const noTotal=normalize(fs.readFileSync(temp('pl-item-nototal.csv',edit(read('pl-item-2026.csv'),c=>c[1]==='通信費'&&c[2]===''?null:c)),'utf8'),'monthlyPL');
 assert.equal(noTotal.errors.length,0);assert.ok(noTotal.warnings.includes('科目合計の行がない科目があります（通信費）。品目別の内訳を足して科目合計とはしないため、この科目の金額の確認は保留します。'),JSON.stringify(noTotal.warnings));
 assert.equal(noTotal.items.filter(x=>x.account==='通信費'&&!x.tagDimension).length,0);assert.ok(noTotal.items.some(x=>x.account==='通信費'&&x.tagDimension));
 const bsNoTotal=normalize(fs.readFileSync(temp('bs-party-nototal.csv',edit(read('bs-party-2026.csv'),c=>c[1]==='買掛金'&&c[2]===''?null:c)),'utf8'),'monthlyBS');
 assert.ok(bsNoTotal.warnings.includes('科目合計の行がない科目があります（買掛金）。取引先別の内訳を足して科目合計とはしないため、この科目の残高とBS全体の一致の確認は保留します。'),JSON.stringify(bsNoTotal.warnings));
});

test('千円の帳票：行ごとの切捨てによる差は内訳の件数×1,000円まで許し、それを超える科目だけ外す',()=>{
 const k=v=>/^-?\d+$/.test(v)?String(Math.trunc(Number(v)/1000)):v;
 const thousand=edit(read('bs-party-2026.csv').replace('表示単位：円','表示単位：千円'),(c,i)=>i<2?c:c.map((v,j)=>j>=3?k(v):v));
 const r=normalize(fs.readFileSync(temp('bs-party-thousand.csv',thousand),'utf8'),'monthlyBS'),tc=r.reportStats.tagCheck;
 assert.equal(r.errors.length,0);assert.equal(r.reportStats.unit,1000);
 assert.ok(r.items.every(x=>x.unit===1000&&x.approximate&&x.amount%1000===0));
 assert.ok(r.warnings.some(w=>/^千円の帳票です。円換算して表示しますが、切捨て済みの概数/.test(w)));
 assert.deepEqual(plain(tc.dropped),[]);assert.deepEqual(plain(tc.mismatches),[]);
 assert.equal(parents(r.items).find(x=>x.account==='売掛金'&&x.date==='2026-01').amount,1523000);
 // 切捨てで実際に合計が合わない月がある（許容の範囲が効いている）
 const diffs=[];for(const p of parents(r.items)){const ts=r.items.filter(x=>x.tagDimension&&x.account===p.account&&x.date===p.date&&!!x.opening===!!p.opening);if(!ts.length)continue;const d=p.amount-ts.reduce((a,x)=>a+x.amount,0);if(d)diffs.push({d,n:ts.length});}
 assert.ok(diffs.length>0);assert.ok(diffs.every(x=>Math.abs(x.d)<=x.n*1000));
 // 売掛金（取引先4件）の3月を5千円ずらす → 許容（4,000円）を超えるので売掛金の内訳だけ外す
 const off=edit(thousand,c=>c[1]==='売掛金'&&c[2]==='(株)ブルースカイ'?c.map((v,j)=>j===6?String(+v+5):v):c);
 const r2=normalize(fs.readFileSync(temp('bs-party-thousand-off.csv',off),'utf8'),'monthlyBS');
 assert.deepEqual(plain(r2.reportStats.tagCheck.dropped),['売掛金']);assert.equal(r2.reportStats.tagCheck.mismatches[0].month,'2026-03');
 assert.equal(r2.items.filter(x=>x.tagDimension).length,r.items.filter(x=>x.tagDimension).length-4*13);
 // 千円のPL：月ごとの切捨てで期間累計と月の合計がずれても注意にしない（月数×1,000円まで）。それを超える差は知らせる
 const plk=edit(read('pl-item-2026.csv').replace('表示単位：円','表示単位：千円'),(c,i)=>i<2?c:c.map((v,j)=>j>=3?k(v):v));
 const p1=normalize(fs.readFileSync(temp('pl-item-thousand.csv',plk),'utf8'),'monthlyPL');
 assert.equal(p1.errors.length,0);assert.deepEqual(plain(p1.reportStats.tagCheck.dropped),[]);
 assert.ok(p1.reportStats.reportedTotals.some(t=>t.difference!==0),'切捨てによる差はある');
 assert.deepEqual(plain(p1.warnings).filter(w=>!/^千円の帳票です/.test(w)),[]);
 const p2=normalize(fs.readFileSync(temp('pl-item-thousand-off.csv',edit(plk,c=>c[1]==='売上高'&&c[2]===''?c.map((v,j)=>j===c.length-1?String(+v+20):v):c)),'utf8'),'monthlyPL');
 assert.deepEqual(plain(p2.warnings).filter(w=>!/^千円の帳票です/.test(w)).map(w=>w.replace(/差額 -?[\d,]+円/,'差額')),['売上高の期間累計とCSVの月別合計に差額があります。帳票の表示方法と読込範囲を確認してください。']);
});

test('取り込めないCSV：タグの列が2つ・メモタグ・帳票の種類の取り違え',()=>{
 const two=edit(read('bs-party-2026.csv'),(c,i)=>i===0?c:[...c.slice(0,3),i===1?'品目':'',...c.slice(3)]);
 const r=normalize(fs.readFileSync(temp('bs-two-tags.csv',two),'utf8'),'monthlyBS');
 assert.equal(r.fatal,true);assert.equal(r.items.length,0);
 assert.equal(r.errors[0].fields[0],'「表示するタグ」の列が複数あります（取引先・品目）。freeeで表示するタグを1種類ずつ選んで、別々のCSVに出力してください。');
 const memo=edit(read('pl-party-2026.csv'),(c,i)=>i===1?c.map(v=>v==='取引先'?'メモタグ':v):c);
 const m=normalize(fs.readFileSync(temp('pl-memo.csv',memo),'utf8'),'monthlyPL');
 assert.equal(m.fatal,true);assert.equal(m.items.length,0);
 assert.equal(m.errors[0].fields[0],'メモタグ別の帳票は、1つの仕訳に複数のメモタグが付くと科目合計と合わないため取り込めません。「表示するタグ」を取引先・品目・部門のいずれかにして出力してください。');
 for(const [f,wrong] of [['bs-item-2026.csv','monthlyPL'],['pl-department-2026.csv','monthlyBS'],['bs-none-2026.csv','priorPL'],['pl-none-2026.csv','priorBS']]){
  const x=normalize(read(f),wrong);assert.equal(x.fatal,true,f);assert.equal(x.items.length,0,f);
  assert.equal(x.errors[0].fields[0],'帳票のタイトルと資料の種類が一致しません。月次PL／月次BSの選択を修正してください。',f);
 }
});

test('従来形式のBS×取引先：取引先は期首だけ・月は空欄でも、内訳を外さない',()=>{
 // 「勘定科目,取引先,期首,2026/01,…」の形。取引先の行は期首だけ（各月は空欄＝未読込）
 const lines=fs.readFileSync(path.join(FX,'monthly-bs-2026.csv'),'utf8').replace(/^﻿/,'').split('\n'),out=[];
 for(const l of lines){
  const c=l.split(',');
  if(c[0]==='勘定科目'){out.push([c[0],'取引先',...c.slice(1)].join(','));continue;}
  if(c.length<3){out.push(l);continue;}
  out.push([c[0],'',...c.slice(1)].join(','));
  if(c[0]==='売掛金')for(const [p,n] of [['(株)ブルースカイ',900000],['(株)レッドストーン',220000]])out.push(['売掛金',p,n,...c.slice(2).map(()=>'')].join(','));
 }
 const text=fs.readFileSync(temp('legacy-bs-party.csv','﻿'+out.join('\n')),'utf8'),r=normalize(text,'monthlyBS'),tc=r.reportStats.tagCheck;
 assert.deepEqual(plain(r.errors),[]);assert.equal(r.reportStats.tagDimension,'party');
 assert.deepEqual(plain(tc.dropped),[]);assert.deepEqual(plain(tc.mismatches),[]);assert.equal(tc.checked,1);
 const party=r.items.filter(x=>x.tagDimension==='party');
 assert.equal(party.length,2*13);
 assert.deepEqual(plain(party.filter(x=>x.opening).map(x=>[x.tagValue,x.date,x.amount])),[['(株)ブルースカイ','2025-12',900000],['(株)レッドストーン','2025-12',220000]]);
 assert.ok(party.filter(x=>!x.opening).every(x=>x.amount===null),'空欄は0円にしない');
 // 取り込むと BS の取引先別（確定残高）として datasets に残る
 const s=base(),items=r.items.map(x=>({...x,source:'legacy.csv',importSource:'csv:legacy'}));
 T.apply(s,'monthlyBS',items,{importSource:'csv:legacy',mode:'replace',record:{type:'monthlyBS',name:'legacy.csv',importSource:'csv:legacy',count:items.length,errors:0,at:'2026-10-06T00:00:00.000Z',reportStats:plain(r.reportStats)}});
 assert.equal(s.datasets.monthlyBS.filter(x=>x.tagDimension==='party').length,26);assert.equal(s.tagReports.length,0);
 assert.deepEqual(plain(T.rows(s,'monthlyBS','party','売掛金').map(g=>[g.tag,g.opening])),[['(株)ブルースカイ',900000],['(株)レッドストーン',220000]]);
});

// ---- (b) 帳票の置き換え（plan / apply）
function uniqueTotals(s){
 for(const type of T.REPORT_TYPES){const seen=new Set();for(const r of parents(s.datasets[type])){const k=JSON.stringify([r.account,r.date,!!r.opening]);assert.ok(!seen.has(k),type+' 科目合計の重複 '+k);seen.add(k);}}
}
const slots=s=>s.imports.filter(i=>T.REPORT_TYPES.includes(i.type)).map(i=>i.type+'|'+T.slotOf(i)+'|'+i.name).sort();
test('8つの帳票は読む順番を変えても同じ保存データになり、科目合計は1組だけ',()=>{
 const orders=[files(),files().reverse(),['pl-item-2026.csv','bs-department-2026.csv','bs-none-2026.csv','pl-party-2026.csv','bs-party-2026.csv','pl-none-2026.csv','bs-item-2026.csv','pl-department-2026.csv']];
 const ss=orders.map(sessionWith),[a]=ss;
 assert.equal(parents(a.datasets.monthlyBS).length,247);assert.equal(parents(a.datasets.monthlyPL).length,276);
 assert.equal(a.datasets.monthlyBS.filter(r=>r.tagDimension==='party').length,494);assert.ok(a.datasets.monthlyPL.every(r=>!r.tagDimension));
 assert.equal(a.tagReports.length,156+169+240+276+204);
 for(const s of ss){
  uniqueTotals(s);
  for(const type of ['monthlyBS','monthlyPL'])assert.deepEqual(s.datasets[type].map(shape),a.datasets[type].map(shape),type+'：行と並び');
  assert.deepEqual(s.tagReports.map(tagShape).sort(),a.tagReports.map(tagShape).sort());
  assert.deepEqual(slots(s),slots(a));assert.equal(s.imports.filter(i=>T.REPORT_TYPES.includes(i.type)).length,8);
  // 科目ごとに行がまとまり、合計の行が先・内訳の行が後
  for(const type of ['monthlyBS','monthlyPL']){const seen=new Set();let last=null,tags=false;for(const r of s.datasets[type]){if(r.account!==last){assert.ok(!seen.has(r.account),'科目の行がまとまっている '+r.account);seen.add(r.account);last=r.account;tags=false;}if(r.tagDimension)tags=true;else assert.ok(!tags,'合計の行が先 '+r.account);}}
 }
 // 指摘の件名・金額も読む順番に左右されない
 const titles=s=>E.analyze(s).findings.map(f=>f.check+'|'+f.title+'|'+f.amount).sort();
 assert.deepEqual(titles(ss[1]),titles(a));assert.deepEqual(titles(ss[2]),titles(a));
});

test('同じ帳票・同じタグを読み直すと、その枠だけ置き換わる',()=>{
 const s=sessionWith(files()),before=plain(s);
 const renamed=edit(read('bs-item-2026.csv'),c=>c[2]==='国民健康保険'?c.map((v,j)=>j===2?'国民健康保険(新)':v):c);
 const p=importText(s,renamed,'bs-item-again.csv');
 assert.equal(p.dim,'item');assert.deepEqual(plain(p.conflicts),[]);assert.deepEqual(plain(p.stale),[]);assert.deepEqual(plain(p.droppedAccounts),[]);
 assert.equal(s.tagReports.length,before.tagReports.length);
 assert.deepEqual(plain(T.rows(s,'monthlyBS','item','事業主貸').map(g=>g.tag)),['未選択','国民健康保険(新)'],'前の品目名は残らない');
 assert.ok(slots(s).includes('monthlyBS|item|bs-item-again.csv')&&!slots(s).includes('monthlyBS|item|bs-item-2026.csv'));assert.equal(slots(s).length,8);
 assert.deepEqual(plain(s.tagReports.filter(r=>r.tagDimension!=='item'||r.type!=='monthlyBS').map(tagShape).sort()),before.tagReports.filter(r=>r.tagDimension!=='item'||r.type!=='monthlyBS').map(tagShape).sort(),'他の枠はそのまま');
 assert.deepEqual(plain(s.datasets.monthlyBS.map(shape)),before.datasets.monthlyBS.map(shape));
 // 同じファイルをもう一度：何も増えない。科目合計は読込済みの行をそのまま使う
 const again=sessionWith(files());load(again,'pl-party-2026.csv');load(again,'bs-party-2026.csv');
 assert.deepEqual(plain(again.datasets.monthlyPL),plain(sessionWith(files()).datasets.monthlyPL));
 assert.equal(again.tagReports.length,before.tagReports.length);uniqueTotals(again);
});

test('科目合計が違う帳票：食い違いと外れる内訳を事前に示し、その科目の他のタグ別だけ外す',()=>{
 const s=sessionWith(['bs-none-2026.csv','bs-party-2026.csv','bs-department-2026.csv']);
 // 品目別BS：事業主貸の3月を1,000円増やす（合計と未選択を同じだけ変え、ファイルの中では合う）
 const changed=edit(read('bs-item-2026.csv'),c=>c[1]==='事業主貸'&&['','未選択'].includes(c[2])&&c[0]==='291'?c.map((v,j)=>j===6?String(+v+1000):v):c);
 const items=itemsOf(s,changed,'bs-item-later.csv'),beforeParty=s.datasets.monthlyBS.filter(r=>r.tagDimension==='party').length,beforeDept=s.tagReports.length;
 const pl=T.plan(s,'monthlyBS',items);
 assert.equal(pl.dim,'item');
 // 科目合計が同じ帳票は読込済みの行を使うので、食い違いの相手は最初に読んだタグなしのBS
 assert.deepEqual(plain(pl.conflicts),[{account:'事業主貸',date:'2026-03',old:950000,new:951000,source:'bs-none-2026.csv'}]);
 assert.deepEqual(plain(pl.stale),[{dim:'party',label:'取引先',accounts:['事業主貸']},{dim:'department',label:'部門',accounts:['事業主貸']}]);
 assert.deepEqual(plain(pl.droppedAccounts),[]);
 const p=importText(s,changed,'bs-item-later.csv');assert.deepEqual(plain(p.stale),plain(pl.stale));
 uniqueTotals(s);
 assert.equal(parents(s.datasets.monthlyBS).find(r=>r.account==='事業主貸'&&r.date==='2026-03').amount,951000);
 assert.equal(T.rows(s,'monthlyBS','party','事業主貸').length,0);assert.equal(T.rows(s,'monthlyBS','department','事業主貸').length,0);
 assert.deepEqual(plain(T.rows(s,'monthlyBS','item','事業主貸').map(g=>g.tag)),['未選択','国民健康保険']);
 assert.equal(s.datasets.monthlyBS.filter(r=>r.tagDimension==='party').length,beforeParty-2*13,'取引先別は事業主貸の分だけ外れる');
 assert.equal(s.tagReports.filter(r=>r.tagDimension==='department').length,beforeDept-13,'部門別は事業主貸の分だけ外れる');
 assert.equal(T.rows(s,'monthlyBS','party','売掛金').length,4);assert.equal(T.rows(s,'monthlyBS','department','売掛金').length,3);
 // 取引先別・部門別の取込の記録は残す（取込時より件数が減ったことを後で知らせるため）
 const m=T.materials(s).find(x=>x.type==='monthlyBS'),party=m.dims.find(d=>d.dim==='party'),dept=m.dims.find(d=>d.dim==='department');
 assert.equal(party.file,'bs-party-2026.csv');assert.equal(party.rows,494-26);assert.equal(party.imports[0].reportStats.tagRows,494);
 assert.equal(dept.file,'bs-department-2026.csv');assert.equal(dept.rows,169-13);
 const conflict=E.analyze(s).findings.filter(f=>/^\["tag-report","tag-conflict"/.test(f.reviewContext||''));
 assert.deepEqual(plain(conflict.map(f=>f.title).sort()),['月次BS（月末残高）（取引先別）：他の帳票と科目合計が合わず、内訳の一部を外しました','月次BS（月末残高）（部門別）：他の帳票と科目合計が合わず、内訳の一部を外しました'].sort());
});

test('タグなしの帳票を後から読んでも、タグ別の内訳は残る',()=>{
 const s=sessionWith(['bs-party-2026.csv','bs-item-2026.csv','pl-department-2026.csv']),before=plain(s);
 const a=importText(s,read('bs-none-2026.csv'),'bs-none-2026.csv'),b=importText(s,read('pl-none-2026.csv'),'pl-none-2026.csv');
 for(const p of [a,b]){assert.equal(p.dim,'');assert.deepEqual(plain(p.conflicts),[]);assert.deepEqual(plain(p.stale),[]);assert.deepEqual(plain(p.droppedAccounts),[]);}
 assert.deepEqual(plain(s.datasets.monthlyBS.filter(r=>r.tagDimension)),before.datasets.monthlyBS.filter(r=>r.tagDimension));
 assert.deepEqual(plain(s.tagReports),before.tagReports);
 assert.deepEqual(plain(s.datasets.monthlyBS.map(shape)),before.datasets.monthlyBS.map(shape));uniqueTotals(s);
 assert.deepEqual(slots(s),['monthlyBS||bs-none-2026.csv','monthlyBS|item|bs-item-2026.csv','monthlyBS|party|bs-party-2026.csv','monthlyPL||pl-none-2026.csv','monthlyPL|department|pl-department-2026.csv'].sort());
});

test('前に読んだ帳票にだけある科目：すべて0円なら残し、0円でなければ外す（その科目の他のタグ別も）',()=>{
 // 古い部門別BS：売掛金の後に 仮払金（0円でない）と 長期前払費用（すべて0円）がある
 const months=13,row=(code,name,tag,v)=>[code,name,tag,...Array(months).fill(String(v))];
 const older=edit(read('bs-department-2026.csv'),c=>c[1]==='売掛金'&&c[2]==='デザイン部'?[c,row('150','仮払金','',10000),row('150','仮払金','未選択',10000),row('160','長期前払費用','',0),row('160','長期前払費用','未選択',0)]:c);
 const s=base();importText(s,fs.readFileSync(temp('bs-department-older.csv',older),'utf8'),'bs-department-older.csv');
 assert.equal(parents(s.datasets.monthlyBS).length,247+2*13);
 const items=itemsOf(s,read('bs-party-2026.csv'),'bs-party-2026.csv'),pl=T.plan(s,'monthlyBS',items);
 assert.deepEqual(plain(pl.droppedAccounts),['仮払金']);assert.deepEqual(plain(pl.conflicts),[]);
 assert.deepEqual(plain(pl.stale),[{dim:'department',label:'部門',accounts:['仮払金']}]);
 load(s,'bs-party-2026.csv');uniqueTotals(s);
 const accounts=[...new Set(s.datasets.monthlyBS.map(r=>r.account))];
 assert.ok(!accounts.includes('仮払金'));assert.equal(T.rows(s,'monthlyBS','department','仮払金').length,0);
 assert.equal(parents(s.datasets.monthlyBS).filter(r=>r.account==='長期前払費用').length,13);
 assert.equal(T.rows(s,'monthlyBS','department','長期前払費用').length,1,'0円の科目の内訳も残る');
 assert.equal(accounts.indexOf('長期前払費用'),accounts.indexOf('売掛金')+1,'前の帳票と同じ位置（売掛金の後）');
 assert.ok(accounts.indexOf('長期前払費用')<accounts.indexOf('流動資産 計'));
});

test('追加（append）：同じ月・科目・内訳の重なりを数え、重ならない年度は足す',()=>{
 const s=base();Object.assign(s.project,{start:'2026-01',end:'2026-09'});
 // タイトルと見出しの年だけ変える（金額の数字は変えない）
 const y=(text,year)=>text.split('\n').map((l,i)=>i<2?l.replaceAll('2026',year):l).join('\n');
 importText(s,y(read('pl-none-2026.csv'),'2025'),'pl-none-2025.csv','priorPL','append');
 assert.equal(s.datasets.priorPL.length,276);
 const same=itemsOf(s,y(read('pl-none-2026.csv'),'2025'),'pl-none-2025b.csv','priorPL');
 assert.equal(T.plan(s,'priorPL',same,{mode:'append'}).overlap,276);
 const variant=itemsOf(s,y(read('pl-item-2026.csv'),'2025'),'pl-item-2025.csv','priorPL');
 assert.equal(T.plan(s,'priorPL',variant,{mode:'append'}).overlap,276,'科目合計の行が重なる');
 const older=itemsOf(s,y(read('pl-item-2026.csv'),'2024'),'pl-item-2024.csv','priorPL');
 assert.equal(T.plan(s,'priorPL',older,{mode:'append'}).overlap,0);
 importText(s,y(read('pl-item-2026.csv'),'2024'),'pl-item-2024.csv','priorPL','append');
 assert.equal(s.datasets.priorPL.length,276*2);assert.equal(s.tagReports.filter(r=>r.type==='priorPL').length,276);
 assert.ok(s.tagReports.every(r=>r.date.startsWith('2024-')));uniqueTotals(s);
 assert.equal(s.imports.filter(i=>i.type==='priorPL').length,2);
 // 当期の帳票は「置き換え」が標準。追加なら重なりを示す
 load(s,'pl-none-2026.csv');assert.equal(T.plan(s,'monthlyPL',itemsOf(s,read('pl-party-2026.csv'),'pl-party-2026.csv'),{mode:'append'}).overlap,276);
});

test('保存データの書き出し・読み戻し：タグ別の内訳を保ち、不正な行は受け付けない',()=>{
 const s=sessionWith(files()),json=JSON.parse(JSON.stringify(s)),v=E.validateSession(json);
 for(const type of T.REPORT_TYPES)assert.deepEqual(plain(v.datasets[type]),plain(s.datasets[type]),type);
 assert.deepEqual(plain(v.tagReports),plain(s.tagReports));assert.deepEqual(plain(v.imports),plain(s.imports));
 assert.deepEqual(slots(v),slots(s));
 const bad=(fn,msg)=>{const x=JSON.parse(JSON.stringify(s));fn(x);assert.throws(()=>E.validateSession(x),msg);};
 bad(x=>{x.tagReports[0].tagDimension='memo';},/タグ別の帳票データが不正です/);
 bad(x=>{x.tagReports[0].amount=1.5;},/タグ別の帳票データが不正です/);
 bad(x=>{x.tagReports[0].amount='1000';},/タグ別の帳票データが不正です/);
 bad(x=>{x.tagReports[0].tagValue=' ';},/タグ別の帳票データが不正です/);
 bad(x=>{x.tagReports.push({...x.tagReports[0],type:'monthlyBS',tagDimension:'party'});},/タグ別の帳票データが不正です/);
 bad(x=>{x.tagReports=[{...x.tagReports[0],unit:10}];},/タグ別の帳票データが不正です/);
 bad(x=>{x.tagReports={};},/タグ別の帳票データが不正です/);
 bad(x=>{const r=x.datasets.monthlyPL[0];x.datasets.monthlyPL.push({...r,tagDimension:'party',tagValue:'(株)ブルースカイ'});},/BSの取引先内訳情報が不正です/);
 bad(x=>{const r=x.datasets.monthlyBS[0];x.datasets.monthlyBS.push({...r,tagDimension:'item',tagValue:'デザイン'});},/BSの取引先内訳情報が不正です/);
 bad(x=>{x.datasets.monthlyBS[0].amount=0.5;},/月次帳票データが不正です/);
});

test('v3.7 の保存データ：BSの取引先内訳つきの記録は「取引先」の枠として読める',()=>{
 const s=sessionWith(['bs-none-2026.csv','bs-party-2026.csv','pl-none-2026.csv']),old=JSON.parse(JSON.stringify(s));
 delete old.tagReports;for(const i of old.imports){delete i.tagDimension;if(i.reportStats){delete i.reportStats.tagDimension;delete i.reportStats.tagCheck;delete i.reportStats.detailReportedTotals;}}
 const v=E.validateSession(old);
 assert.deepEqual(plain(v.tagReports),[]);
 const rec=v.imports.find(i=>i.name==='bs-party-2026.csv');assert.equal(rec.tagDimension,undefined);assert.equal(rec.reportStats.tagRows,494);
 assert.equal(T.slotOf(rec),'party');assert.equal(T.slotOf(v.imports.find(i=>i.name==='bs-none-2026.csv')),'');assert.equal(T.slotOf(v.imports.find(i=>i.name==='pl-none-2026.csv')),'');
 assert.equal(T.slotOf(v.imports.find(i=>i.type==='current')),null);
 assert.ok(T.has(v,'monthlyBS','party'));assert.equal(T.rows(v,'monthlyBS','party','売掛金').length,4);
 const party=T.materials(v).find(m=>m.type==='monthlyBS').dims.find(d=>d.dim==='party');assert.equal(party.loaded,true);assert.equal(party.rows,494);assert.equal(party.file,'bs-party-2026.csv');
 // そのあと品目別を読んでも、取引先別は残り、取引先の枠の記録も1つのまま
 load(v,'bs-item-2026.csv');assert.equal(v.datasets.monthlyBS.filter(r=>r.tagDimension==='party').length,494);
 assert.deepEqual(slots(v).filter(x=>x.startsWith('monthlyBS')),['monthlyBS||bs-none-2026.csv','monthlyBS|item|bs-item-2026.csv','monthlyBS|party|bs-party-2026.csv'].sort());
 // 取引先別BSを読み直すと、v3.7 の記録も置き換わる
 load(v,'bs-party-2026.csv');assert.equal(v.imports.filter(i=>i.type==='monthlyBS'&&T.slotOf(i)==='party').length,1);
});

// ---- (c) タグ別の帳票を足しても、既存のチェックと月次PL・BSは変わらない
test('タグ別の帳票を足しても、既存のチェックの指摘（ID）と月次PL・BSの科目・並び・金額は変わらない',()=>{
 const tagF=f=>String(f.reviewContext||'').startsWith('["tag-report"');
 const ids=r=>r.findings.filter(f=>!tagF(f)).map(f=>f.id).sort();
 const plainOnly=sessionWith(files(['none'])),five=sessionWith([...files(['none']),'pl-party-2026.csv',...files(['item','department'])]);
 const withParty=sessionWith([...files(['none']),'bs-party-2026.csv']),all=sessionWith(files());
 const [r0,r5,rp,ra]=[plainOnly,five,withParty,all].map(s=>E.analyze(s));
 assert.ok(r0.findings.length>20);
 assert.deepEqual(ids(r5),ids(r0),'BS×取引先以外の6つ（PL×取引先・品目・部門、BS×品目・部門）は指摘を変えない');
 // BS×取引先は確定した取引先別の残高として、回収・支払の確認に使う（指摘が増える）。それ以外のタグ別を足しても変わらない
 assert.deepEqual(ids(ra),ids(rp),'BS×取引先のあとに他のタグ別を足しても指摘は変わらない');
 assert.ok(ra.findings.some(tagF),'タグ別の分析の指摘は別にある');
 for(const r of [r5,rp,ra])for(const t of ['pl','bs']){
  assert.deepEqual(r.financial[t].map(g=>g.account),r0.financial[t].map(g=>g.account),t+'：科目と並び');
  for(const g of r0.financial[t]){const h=r.financial[t].find(x=>x.account===g.account);assert.deepEqual(plain(h.values),plain(g.values),t+' '+g.account);assert.equal(h.periodTotal,g.periodTotal);assert.equal(h.endBalance,g.endBalance);assert.deepEqual(plain(h.importConflicts),[],g.account);}
 }
 // 先にタグ別を読み、最後にタグなしを読んだ場合も、科目の並びは同じ
 const late=sessionWith([...files(['party','item','department']),...files(['none'])]),rl=E.analyze(late);
 for(const t of ['pl','bs'])assert.deepEqual(rl.financial[t].map(g=>g.account),r0.financial[t].map(g=>g.account),t);
});
test('同じCSVを別のファイル名で読み直しても、確認結果のIDと「外した内訳」の判定は変わらない',()=>{
 for(const f of ['pl-department-2026.csv','bs-party-2026.csv','bs-item-2026.csv']){
  const type=f.startsWith('bs')?'monthlyBS':'monthlyPL',s=H.session(ctx);
  const imp=name=>{const text=fs.readFileSync(path.join(__dirname,'fixtures','freee',f),'utf8'),rows=E.parseCSV(text),h=E.headerRow(rows,type,s.project),m=E.importMapping(rows,type,h,s.project),res=E.normalizeRows(rows,type,m,h,{project:s.project,unit:ctx.ReviewFinancial.detectUnit(rows,h),basis:ctx.ReviewFinancial.detectBasis(rows,h)}),src='csv:'+name;T.apply(s,type,res.items.map(r=>({...r,source:name,importSource:src,importErrors:0})),{importSource:src,mode:'replace',record:{type,name,importSource:src,count:res.items.length,errors:0,reportStats:res.reportStats}});};
  imp('A.csv');const a=new Set(E.analyze(s).findings.map(x=>x.id));
  imp('B.csv');const b=E.analyze(s).findings;
  const changed=[...b.filter(x=>!a.has(x.id)).map(x=>x.title)];assert.equal(changed.length,0,f+'：'+changed.join('、'));
 }
});
test('置き換えは新しい帳票の月・期首だけ：期間の短い帳票や別の年度の帳票で、ほかの月の科目合計を消さない',()=>{
 const s=H.session(ctx),type='monthlyBS',dir=path.join(__dirname,'fixtures','freee');
 const imp=(text,name)=>{const rows=E.parseCSV(text),h=E.headerRow(rows,type,s.project),m=E.importMapping(rows,type,h,s.project),res=E.normalizeRows(rows,type,m,h,{project:s.project,unit:1,basis:'monthly'}),src='csv:'+name;T.apply(s,type,res.items.map(r=>({...r,source:name,importSource:src,importErrors:0})),{importSource:src,mode:'replace',record:{type,name,importSource:src,count:res.items.length,errors:0,reportStats:res.reportStats}});};
 imp(fs.readFileSync(path.join(dir,'bs-none-2026.csv'),'utf8'),'none.csv');
 // 品目別を 2026-01〜09 だけに切った帳票（期首・10〜12月の列なし）
 const short=fs.readFileSync(path.join(dir,'bs-item-2026.csv'),'utf8').split('\n').filter(Boolean).map((l,i)=>{const c=l.split('","');if(i===0)return l.replace('2026年12月','2026年09月');return [...c.slice(0,3),...c.slice(4,13)].join('","')+'"';});
 imp(short.join('\n')+'\n','short.csv');
 const ar=s.datasets.monthlyBS.filter(r=>!r.tagDimension&&r.account==='売掛金');
 assert.ok(ar.some(r=>r.opening),'期首は残る');assert.ok(ar.some(r=>r.date==='2026-12'),'10〜12月は残る');
 assert.equal(ar.length,new Set(ar.map(r=>r.date+(r.opening?'o':''))).size,'重複しない');
});

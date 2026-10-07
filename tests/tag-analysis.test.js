// node --test tests/tag-analysis.test.js
// タグ別の月次PL・BS（取引先・品目・部門）の分析（ReviewTagAnalysis）と、月次画面の欄（ReviewTagAnalysisUI）。
// tests/fixtures/freee の8つの帳票（なし・取引先・品目・部門 × BS・PL）を、画面の取込と同じ手順で読み込んで確かめる。
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const H=require('./harness.js');
const ctx=H.load(),E=ctx.ReviewEngine,F=ctx.ReviewFinancial,T=ctx.ReviewTagReports,UI=ctx.ReviewTagAnalysisUI;
const FX=path.join(__dirname,'fixtures','freee');
const plain=v=>JSON.parse(JSON.stringify(v));
const read=f=>fs.readFileSync(path.join(FX,f),'utf8');
// 画面の「CSV読込」→「取り込む」と同じ（置き換え・取込の記録つき）
function importText(s,text,name,type){
 const rows=E.parseCSV(text),h=E.headerRow(rows,type,s.project),mapping=E.guessMapping(rows[h],type,s.project);
 const res=E.normalizeRows(rows,type,mapping,h,{project:s.project,unit:F.detectUnit(rows,h),basis:F.detectBasis(rows,h)});
 assert.equal(res.errors.length,0,name+': '+JSON.stringify(res.errors.slice(0,2)));
 const importSource='csv:'+E.hash(name),items=res.items.map(r=>({...r,source:name,importSource,importErrors:0}));
 return T.apply(s,type,items,{importSource,mode:'replace',record:{type,name,importSource,count:items.length,errors:0,at:'2026-10-06T00:00:00.000Z',months:res.reportStats.months,reportStats:res.reportStats}});
}
const load=(s,f,type)=>importText(s,read(f),f,type);
// 全セルを引用符で囲んだ freee の行を、セルの配列として書き換える
function edit(text,fn){return text.split('\n').map(l=>{if(!l.startsWith('"'))return l;const cells=l.slice(1,-1).split('","'),out=fn(cells);return out===null?null:Array.isArray(out[0])?out.map(c=>'"'+c.join('","')+'"').join('\n'):'"'+out.join('","')+'"';}).filter(l=>l!==null).join('\n');}
function base(){const s=H.session(ctx,{pl:false,bs:false});s.imports=s.imports.filter(i=>!/^monthly/.test(i.type));return s;}
function all8(){const s=base();for(const st of ['pl','bs'])for(const d of ['none','party','item','department'])load(s,`${st}-${d}-2026.csv`,st==='pl'?'monthlyPL':'monthlyBS');return s;}
const tagFindings=r=>r.findings.filter(f=>String(f.reviewContext||'').startsWith('["tag-report"'));
const kindOf=f=>JSON.parse(f.reviewContext)[1];

test('8つの帳票：PLの取引先・品目・部門別の構成が科目合計と一致し、前年の仕訳と比べる',()=>{
 const s=all8(),r=E.analyze(s),ta=r.financial.tagAnalysis;
 assert.equal(ta.error,undefined);
 assert.deepEqual(plain(ta.plDims),['party','item','department']);assert.deepEqual(plain(ta.bsDims),['party','item','department']);
 const pl=r.financial.plReference,acct=n=>pl.find(g=>g.account===n);
 for(const d of ta.plDims){const p=ta.pl[d];
  assert.equal(p.latest,'2026-09',d+'：未経過の月（10〜12月の0円）を最新の月にしない');assert.equal(p.prev,'2026-08');assert.equal(p.months.length,9);
  for(const a of p.accounts){assert.equal(a.ytd,acct(a.account).periodTotal,d+' '+a.account+'：内訳の合計＝科目合計');assert.equal(a.latest,acct(a.account).values['2026-09']);}
 }
 const party=ta.pl.party,sales=party.accounts.find(a=>a.account==='売上高');
 assert.equal(sales.ytd,12534750);assert.equal(sales.tags[0].tag,'(株)ブルースカイ');assert.equal(sales.tags[0].ytd,8554820);
 assert.ok(Math.abs(sales.tags[0].share-0.6825)<0.001);
 assert.equal(party.prior.source,'journal','前期PLのタグ別がないので前年の仕訳（参考）');assert.equal(party.prior.months.length,9);
 assert.equal(sales.tags[0].prior,8154800);assert.equal(sales.tags[0].yoy,400020);
 const c=party.customers;
 assert.equal(c.count,3);assert.equal(c.top[0].tag,'(株)ブルースカイ');assert.ok(c.top1Share>0.68&&c.top1Share<0.69);assert.equal(c.top3Share,1);
 assert.equal(c.basis,'prior');assert.deepEqual(plain(c.added.map(x=>x.tag)),['(株)オレンジデザイン']);assert.deepEqual(plain(c.lost.map(x=>x.tag)),['(株)レッドストーン']);
 // 前年の仕訳の売上に品目が付いていない：品目別には比べず、科目の合計だけ比べる
 const item=ta.pl.item.accounts.find(a=>a.account==='売上高');
 assert.equal(item.priorByTag,false);assert.equal(item.tags.every(t=>t.prior===null),true);assert.equal(item.prior,10831060);
 // 部門別損益：部門ごとの収益−費用。合計はPLの収益−費用、部門なしは未選択
 const d=ta.pl.department.departments,row=n=>d.rows.find(x=>x.tag===n);
 assert.equal(row('デザイン部').ytd.income,10323490);assert.equal(row('デザイン部').ytd.expense,1351690);assert.equal(row('デザイン部').ytd.profit,8971800);
 assert.equal(row('Web制作部').ytd.profit,2211260-540050);
 assert.equal(d.rows.at(-1).unselected,true,'未選択は最後');assert.equal(d.total.ytd.profit,ta.pl.department.groups.income.ytd-ta.pl.department.groups.expense.ytd);
 assert.equal(d.total.ytd.income,12534750);assert.deepEqual(plain(d.missingAccounts),[]);
 assert.equal(ta.pl.department.prior,null,'前年の仕訳に部門がないので比べない');
});

test('8つの帳票：BSの見方（残高・累計の動き・タグなし・口座）と、確認キュー',()=>{
 const s=all8(),r=E.analyze(s),ta=r.financial.tagAnalysis,st=(d,a)=>{const x=ta.bs[d].accounts.find(y=>y.account===a);return x.flow?'flow':x.state;};
 assert.equal(ta.asOf,'2026-09');
 assert.equal(st('party','売掛金'),'clean');assert.equal(st('party','買掛金'),'clean');assert.equal(st('party','普通預金'),'flow');assert.equal(st('party','セゾンカード'),'flow');
 assert.equal(st('party','預り金'),'residual');assert.equal(st('party','元入金'),'untagged');
 assert.equal(st('department','売掛金'),'residual');assert.equal(st('item','売掛金'),'untagged');
 assert.equal(ta.bs.party.clearing.length,0,'預り金の取引先別（預かる相手と納める相手が違う）は精算漏れにしない');
 assert.equal(ta.bs.party.negative.length,0);
 const fs_=tagFindings(r);
 assert.deepEqual(plain(fs_.map(kindOf)),['tag-unselected']);
 const f=fs_[0];assert.equal(f.account,'広告宣伝費');assert.equal(f.amount,366220);assert.equal(f.level,'info','部門の未選択は共通費のこともあるので参考');
 assert.equal(f.monthlyCheck,true);assert.deepEqual(plain(f.sources),['monthly','freee']);
 assert.deepEqual(plain(JSON.parse(f.reviewContext)),['tag-report','tag-unselected','monthlyPL','department','広告宣伝費','未選択']);
 assert.equal(f.rows.length,1);assert.equal(f.rows[0].statement,'PL');assert.equal(f.rows[0].source,'月次PL（単月）（部門別）','根拠は帳票名（ファイル名を変えて読み直しても確認結果のIDが変わらない）');assert.ok(Number.isInteger(f.rows[0].line));
 // 同じ資料なら同じID（確認結果が引き継がれる）
 assert.equal(tagFindings(E.analyze(s))[0].id,f.id);
 assert.equal(ta.checks.mismatch.length,0);assert.equal(ta.checks.conflict.length,0);
});

test('タグ別の帳票がない：欄を出さず、確認キューにも出さない',()=>{
 const s=H.session(ctx),r=E.analyze(s),ta=r.financial.tagAnalysis;
 assert.equal(ta.any,false);assert.equal(tagFindings(r).length,0);
 assert.equal(UI.panel(s,r),'');assert.doesNotMatch(F.page(s,r,null),/id="tagReports"/);
});

test('月次画面の欄：取引先別の残高の欄の後ろ・大きく動いた科目の前に、読込状況と取込ボタンを出す',()=>{
 const s=all8(),r=E.analyze(s),page=F.page(s,r,null),at=page.indexOf('id="tagReports"');
 assert.ok(at>0);assert.ok(at<page.indexOf('id="vtChanges"'));const pb=page.indexOf('id="partyBalances"');assert.ok(pb>=0&&pb<at);
 const html=UI.panel(s,r);
 assert.match(html,/<h3>読み込んだ帳票/);for(const t of ['monthlyBS','monthlyPL','priorBS','priorPL'])assert.match(html,new RegExp('data-action="import" data-type="'+t+'"'));
 assert.match(html,/2026年1月〜2026年12月/,'帳票の月');assert.match(html,/bs-item-2026\.csv/);assert.match(html,/内訳の合計＝科目合計/);
 assert.match(html,/<h3>損益の内訳/);assert.match(html,/<h3>残高の内訳で気になるもの/);assert.match(html,/data-ta-export/);
 // 閉じた欄の中身は開くまで作らない
 assert.match(html,/data-ta-lazy="[^"]*売上高[^"]*"><summary>/);assert.doesNotMatch(html,/<th scope="row">\(株\)ブルースカイ<\/th><td class="num" data-label="当期累計">/);
 const toc=plain(ctx.ReviewMonthlyToc.entries(page).map(e=>e.title));assert.ok(toc.includes('取引先・品目・部門別の帳票'));
});

test('精算科目：タグごとに動かずに残る立替金（科目の残高は0円）を精算漏れの候補にする',()=>{
 const s=all8();
 // 部門別BSに、科目合計0円・未選択と2部門が相殺し合う立替金を足す（実データと同じ形）
 const bs=edit(read('bs-department-2026.csv'),c=>{if(c[1]!=='売掛金'||c[2]!=='デザイン部')return c;const z=c.map((v,i)=>i<3?v:'0');
  return [c,['150','立替金','',...z.slice(3)],['150','立替金','未選択','80000',...z.slice(4).map(()=>'230000')],['150','立替金','デザイン部','20000',...z.slice(4).map(()=>'20000')],['150','立替金','Web制作部','-100000',...z.slice(4).map(()=>'-250000')]];});
 load(s,'bs-department-2026.csv',  'monthlyBS');importText(s,bs,'bs-department-tatekae.csv','monthlyBS');
 const r=E.analyze(s),b=r.financial.tagAnalysis.bs.department,a=b.clearing.find(x=>x.account==='立替金');
 assert.ok(a,'立替金が出る');assert.equal(a.state,'residual');assert.equal(a.balance,0);
 assert.deepEqual(plain(a.static.map(x=>[x.tag,x.amount,x.since,x.months])),[['Web制作部',-250000,'2026-01',8],['デザイン部',20000,'期首',9]]);
 const f=tagFindings(r).find(f=>kindOf(f)==='tag-clearing');
 assert.ok(f);assert.equal(f.level,'candidate');assert.equal(f.amount,270000);assert.match(f.title,/立替金：部門ごとに見ると、精算されずに残っている金額があります（2件）/);
 assert.match(f.reason,/未選択の金額（230,000円）と相殺/);assert.equal(f.rows.length,2);assert.equal(f.rows[0].source,'月次BS（月末残高）（部門別）');
 assert.deepEqual(plain(JSON.parse(f.reviewContext)),['tag-report','tag-clearing','monthlyBS','department','立替金','']);
});

test('債権債務：未選択のない売掛金で、取引先別の残高がマイナスのものを候補にする',()=>{
 const s=all8();
 const bs=edit(read('bs-party-2026.csv'),c=>{if(c[1]!=='売掛金'||c[2]!=='合同会社グリーンリーフ')return c;const v=(m,x)=>c.map((y,i)=>i<3?y:i>=10?x:'0');
  return [c,v(0,'-55000').map((x,i)=>i===2?'(株)テスト過入金':x),v(0,'55000').map((x,i)=>i===2?'(株)テスト前受':x)];});
 importText(s,bs,'bs-party-negative.csv','monthlyBS');
 const r=E.analyze(s),b=r.financial.tagAnalysis.bs.party,a=b.negative.find(x=>x.account==='売掛金');
 assert.ok(a);assert.equal(a.state,'clean');assert.deepEqual(plain(a.negative.map(x=>[x.tag,x.amount,x.since,x.months])),[['(株)テスト過入金',-55000,'2026-07',3]]);
 const f=tagFindings(r).find(f=>kindOf(f)==='tag-negative');
 assert.ok(f);assert.equal(f.amount,-55000);assert.match(f.title,/売掛金：取引先別の残高がマイナスのものがあります（1件）/);assert.match(f.reason,/請求より入金が多い/);
 // 回収が止まっている取引先（取引先別の残高の欄が扱う）は、ここでは重ねて出さない
 assert.equal(tagFindings(r).some(f=>/レッドストーン/.test(f.reason)),false);
});

test('資料の確認：内訳の合計が合わない帳票、後から取り込んだ帳票と合わず外れた内訳',()=>{
 const s=all8();
 // 品目別PL：通信費のクラウドだけ3月を1,000円増やす（科目合計と合わない）
 const bad=edit(read('pl-item-2026.csv'),c=>c[1]==='通信費'&&c[2]==='クラウド'?c.map((v,i)=>i===5?String(+v+1000):v):c);
 importText(s,bad,'pl-item-bad.csv','monthlyPL');
 let r=E.analyze(s),fs_=tagFindings(r),m=fs_.find(f=>kindOf(f)==='tag-mismatch');
 assert.ok(m);assert.equal(m.dataReview,true);assert.equal(m.level,'candidate');assert.match(m.title,/月次PL（単月）（品目別）：内訳の合計が科目合計と合わない科目があります（1科目）/);
 assert.match(m.reason,/通信費 2026-03：科目合計 17,290円／内訳の合計 18,290円/);
 assert.equal(T.rows(s,'monthlyPL','item','通信費').length,0,'合わない科目の内訳は取り込まない');
 // 部門別PL：広告宣伝費の9月を後から変えた帳票 → 科目合計が置き換わり、品目別の広告宣伝費の内訳は外れる
 const s2=all8();
 const changed=edit(read('pl-department-2026.csv'),c=>(c[1]==='広告宣伝費'&&(c[2]===''||c[2]==='Web制作部'))||/^(?:経費 計|差引損益計算)$/.test(c[1])?c.map((v,i)=>i===11||i===15?String(+v+(c[1]==='差引損益計算'?-1000:1000)):v):c);
 importText(s2,changed,'pl-department-later.csv','monthlyPL');
 r=E.analyze(s2);const ks=tagFindings(r).filter(f=>kindOf(f)==='tag-conflict'),k=ks.find(f=>/品目別/.test(f.title));
 assert.ok(k,'外れた内訳を知らせる');assert.equal(k.dataReview,true);assert.match(k.title,/品目別）：他の帳票と科目合計が合わず、内訳の一部を外しました/);assert.match(k.reason,/広告宣伝費/);
 assert.equal(T.rows(s2,'monthlyPL','item','広告宣伝費').length,0);assert.ok(ks.some(f=>/取引先別/.test(f.title)),'取引先別の内訳も外れる');assert.equal(ks.every(f=>JSON.parse(f.reviewContext)[2]==='monthlyPL'),true);
});

test('CSVの保存：式として読まれる文字を無害にし、取引先名をそのまま出す',()=>{
 const s=all8();
 const evil=edit(read('pl-party-2026.csv'),c=>c[2]==='(株)オレンジデザイン'?c.map((v,i)=>i===2?'=HYPERLINK(1)<b>':v):c);
 importText(s,evil,'pl-party-evil.csv','monthlyPL');
 const r=E.analyze(s),csv=UI.csv(s,r);
 assert.ok(csv.startsWith('\uFEFF"区分"'));assert.match(csv,/"'=HYPERLINK\(1\)<b>"/);assert.doesNotMatch(csv,/,"=HYPERLINK/);
 const html=UI.panel(s,r);
 assert.doesNotMatch(html,/HYPERLINK\(1\)<b>/,'HTMLでもエスケープする');assert.match(html,/=HYPERLINK\(1\)&lt;b&gt;/);
 assert.match(html,/data-ta-tab="party"/);assert.match(html,/部門別損益|売上の取引先/);assert.match(html,/確認キューに入れた項目/);
});

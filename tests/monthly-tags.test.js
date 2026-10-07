// 月次PL・BSの「表示するタグ」：freee形式のタグ別の帳票（tests/fixtures/freee）を読み込んだときの内訳と画面
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path');
const H=require('./harness.js');
const ctx=H.load(),E=ctx.ReviewEngine,V=ctx.ReviewVariance,T=ctx.ReviewTagReports,F=ctx.ReviewFinancial,M=ctx.ReviewMonthlyPage;
const FX=path.join(__dirname,'fixtures','freee'),MONTHS=['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09'];
const DIMS=['party','item','department'];
// 期待値はテスト側でCSVを直接読む（読込処理とは別の素朴な読み方）
function raw(file){
 const lines=fs.readFileSync(path.join(FX,file),'utf8').trim().split('\n').map(l=>l.slice(1,-1).split('","'));
 const head=lines[1],out=new Map();
 for(const c of lines.slice(2)){if(!c[2])continue;const k=c[1]+'|'+c[2],v={};head.forEach((h,i)=>{if(/^\d{4}-\d{2}$|^期首$/.test(h))v[h]=Number(c[i]);});out.set(k,v);}
 return out;
}
function make({dims=DIMS,journal=true}={}){
 const s=H.session(ctx,{pl:false,bs:false});if(!journal)s.datasets.current=[];
 for(const d of ['none',...dims])for(const [type,f] of [['monthlyPL','pl'],['monthlyBS','bs']]){
  const file=`${f}-${d}-2026.csv`,items=H.readCSV(ctx,path.join(FX,file),type,s.project);
  T.apply(s,type,items,{importSource:items[0].importSource,mode:'replace',record:{type,name:file,count:items.length,errors:0,at:'2026-10-06T00:00:00.000Z'}});
 }
 return s;
}
const full=make(),fullResult=E.analyze(full);
const rowOf=(t,label)=>t.rows.find(r=>r.label===label);

test('PL：取引先・品目・部門のどれも、内訳は帳票の月額をそのまま使う',()=>{
 for(const dim of DIMS){
  const want=raw(`pl-${dim}-2026.csv`);let checked=0;
  for(const [k,v] of want){
   const [account,tagName]=k.split('|'),t=V.tagRows(full,fullResult,'monthlyPL',account,dim);
   if(t.mode==='untagged'){assert.equal(tagName,'未選択',`${dim} ${account}`);continue;}
   assert.equal(t.source,'report');assert.equal(t.mode,'reported');
   const r=rowOf(t,tagName);assert.ok(r,`${dim} ${account} ${tagName}`);
   for(const m of MONTHS)assert.equal(r.values[m],v[m],`${dim} ${account} ${tagName} ${m}`);
   assert.ok(!r.jdiff,'同じ仕訳から作った帳票なので仕訳との差はない');checked++;
  }
  assert.ok(checked>=3,dim);
  // 公開の reportedTagRows も同じ値
  const viaExport=V.reportedTagRows(full,fullResult,'monthlyPL','売上高',dim);
  assert.deepEqual(viaExport.rows.map(r=>r.values),V.tagRows(full,fullResult,'monthlyPL','売上高',dim).rows.map(r=>r.values));
 }
});

test('BS：未選択のない科目（売掛金×取引先）は帳票の月末残高、期首は期首列',()=>{
 const want=raw('bs-party-2026.csv'),t=V.tagRows(full,fullResult,'monthlyBS','売掛金','party','balance');
 assert.equal(t.mode,'reported');assert.equal(t.semantic,'clean');assert.equal(t.basis,'balance');
 for(const [k,v] of want){const [a,tg]=k.split('|');if(a!=='売掛金')continue;const r=rowOf(t,tg);assert.equal(r.opening,v['期首'],tg);for(const m of MONTHS)assert.equal(r.values[m],v[m],tg+' '+m);}
 assert.equal(t.hasDiff,false);
 assert.equal(t.total['2026-09'],fullResult.financial.bs.find(g=>g.account==='売掛金').values['2026-09']);
});

test('BS：未選択に相殺額がある科目は残高でなく累計の前月差（事業主貸×品目・取引先、売掛金×部門）',()=>{
 for(const [dim,account] of [['item','事業主貸'],['department','売掛金'],['party','事業主貸']]){
  const want=raw(`bs-${dim}-2026.csv`),t=V.tagRows(full,fullResult,'monthlyBS',account,dim,'balance');
  assert.equal(t.semantic,'residual',dim);assert.equal(t.mode,'movement');
  for(const [k,v] of want){const [a,tg]=k.split('|');if(a!==account)continue;const r=rowOf(t,tg);assert.ok(r,dim+' '+tg);
   let prev=v['期首'];for(const m of MONTHS){assert.equal(r.values[m],v[m]-prev,`${dim} ${tg} ${m}`);prev=v[m];}
   assert.equal(r.opening,null,'動きの表示に期首残高は出さない');}
  // 動きの合計は科目の増減と一致
  for(const m of MONTHS)assert.equal(t.diff[m],0,dim+' '+m);
 }
});

test('BS：預金・カードのタグ別は相手先ごとの入出金の累計として扱い、残高にしない',()=>{
 for(const account of ['普通預金','セゾンカード']){
  const t=V.tagRows(full,fullResult,'monthlyBS',account,'party','balance');
  assert.equal(t.semantic,'cash',account);assert.equal(t.mode,'movement');
  assert.ok(t.rows.every(r=>r.opening===null));
 }
 const b=V.tagRows(full,fullResult,'monthlyBS','普通預金','party','balance'),blue=rowOf(b,'(株)ブルースカイ');
 assert.equal(blue.values['2026-01'],900000);assert.equal(blue.values['2026-02'],850010);
});

test('BS・PL：未選択だけの科目は「入力なし」1行（行を作らない）',()=>{
 const t=V.tagRows(full,fullResult,'monthlyBS','未払金','department','balance');
 assert.equal(t.mode,'untagged');assert.equal(t.rows.length,0);
 assert.deepEqual({...V.tagCount(full,fullResult,'monthlyBS','未払金','department')},{n:0,source:'report',untagged:true});
 assert.equal(V.tagRows(full,fullResult,'monthlyPL','地代家賃','department').mode,'untagged');
});

test('タグ別の帳票を読み込んでも、PL・BSの科目合計は変わらない',()=>{
 const plain=make({dims:[]}),pr=E.analyze(plain);
 for(const type of ['pl','bs']){
  const a=pr.financial[type],b=fullResult.financial[type];
  assert.deepEqual(b.map(g=>g.account).sort(),a.map(g=>g.account).sort());
  for(const g of a){const h=b.find(x=>x.account===g.account);for(const m of MONTHS)assert.equal(h.values[m],g.values[m],`${type} ${g.account} ${m}`);if(type==='pl')assert.equal(h.periodTotal,g.periodTotal);}
 }
 // 科目合計の置き場所には取引先別BS以外のタグ行を入れない
 assert.ok(full.datasets.monthlyPL.every(r=>!r.tagDimension));
 assert.ok(full.datasets.monthlyBS.every(r=>!r.tagDimension||r.tagDimension==='party'));
 assert.ok(full.tagReports.length>0);
});

test('月次BSの帳票形式：タグ別の帳票を読み込んでも科目の並び（小計の位置）は帳票どおり',()=>{
 const html=F.page(full,fullResult,null),bs=html.slice(html.indexOf('data-stmt="monthlyBS"'));
 const order=['売掛金','流動資産 計','事業主貸','事業主貸 計','資産 計','買掛金'].map(a=>bs.indexOf('title="'+a+'"'));
 assert.ok(order.every(i=>i>0),JSON.stringify(order));assert.deepEqual(order,[...order].sort((x,y)=>x-y));
});

test('PL：帳票の金額が仕訳から集計した金額と違う月は「仕訳との差」として印を付ける',()=>{
 const s=make({dims:['item']}),hit=s.tagReports.find(r=>r.type==='monthlyPL'&&r.account==='売上高'&&r.tagValue==='デザイン制作'&&r.date==='2026-03');
 hit.amount+=1000;
 const r=E.analyze(s),t=V.tagRows(s,r,'monthlyPL','売上高','item'),row=rowOf(t,'デザイン制作');
 assert.equal(row.jdiff,true);assert.deepEqual({...row.journalDiff},{'2026-03':1000});
 assert.equal(row.journal['2026-03'],row.values['2026-03']-1000);
 assert.ok(!rowOf(t,'Web更新').jdiff);
 assert.equal(t.diff['2026-03'],-1000,'科目合計との差も出す');
 // 仕訳が無ければ比べない
 const nj=make({dims:['item'],journal:false}),rn=E.analyze(nj);
 assert.ok(V.tagRows(nj,rn,'monthlyPL','売上高','item').rows.every(x=>!x.jdiff));
});

test('帳票が無いタグは仕訳から集計した内訳のまま（表示するタグの選択肢は 帳票／仕訳）',()=>{
 const s=make({dims:['item']}),r=E.analyze(s);
 assert.deepEqual({...V.tagSources(s,r,'monthlyPL')},{party:'journal',item:'report',department:'journal'});
 const t=V.tagRows(s,r,'monthlyPL','売上高','party');
 assert.notEqual(t.source,'report');assert.equal(t.mode,'flow');
 assert.equal(V.tagCount(s,r,'monthlyPL','売上高','party').source,'journal');
 assert.equal(V.tagCount(s,r,'monthlyPL','売上高','item').source,'report');
});

test('セグメント別の帳票も内訳として読める（仕訳にはないタグ）',()=>{
 const s=make({dims:[]});
 for(const [tag,a] of [['東京',800000],['大阪',503670]])s.tagReports.push({type:'monthlyPL',tagDimension:'segment1',tagValue:tag,account:'売上高',date:'2026-01',amount:a,unit:1,importSource:'x'});
 const r=E.analyze(s);
 assert.equal(V.tagSources(s,r,'monthlyPL').segment1,'report');
 const t=V.tagRows(s,r,'monthlyPL','売上高','segment1');
 assert.equal(rowOf(t,'東京').values['2026-01'],800000);assert.equal(t.diff['2026-01'],0);
});

test('画面：表示するタグで全科目の下に内訳、0円の行を隠す・検索・30件ずつ',()=>{
 const s=make(),r=E.analyze(s);
 let html=F.page(s,r,null);
 assert.match(html,/data-vt-tagdim="monthlyPL:item"[^>]*>品目<small class="vt-src report">帳票<\/small>/);
 assert.ok(!/vt-inline/.test(html),'既定は「なし」');
 M.tagState(s,'monthlyBS',{dim:'item'});html=F.page(s,r,null);
 assert.match(html,/累計の動き（未選択に相殺額あり）/);
 assert.match(html,/品目の入力なし/);
 // 0円だけの行（freeeは同じ月に請求・回収した取引先などを0円の行で出す）は既定で隠す
 for(const m of MONTHS)s.tagReports.push({type:'monthlyPL',tagDimension:'item',tagValue:'ゼロの品目',account:'売上高',date:m,amount:0,unit:1,importSource:'x'});
 const r2=E.analyze(s);
 M.tagState(s,'monthlyPL',{dim:'item'});html=F.page(s,r2,null);
 assert.match(html,/0円だけの品目 1件を省略/);assert.ok(!/ゼロの品目/.test(html));
 M.tagState(s,'monthlyPL',{hideZero:false});const html2=F.page(s,r2,null);assert.match(html2,/ゼロの品目/);
 assert.ok((html2.match(/vt-inline/g)||[]).length>(html.match(/vt-inline/g)||[]).length);
 M.tagState(s,'monthlyPL',{query:'ﾃﾞｻﾞｲﾝ'});const html3=F.page(s,r2,null);
 assert.match(html3,/デザイン制作/);assert.ok(!/>Web更新</.test(html3.slice(html3.indexOf('data-stmt="monthlyPL"'),html3.indexOf('data-stmt="monthlyBS"'))));
 // 30件を超える内訳はページ送り（左端の列に置く）
 const big=make({dims:[]});
 for(let i=0;i<45;i++)big.tagReports.push({type:'monthlyPL',tagDimension:'item',tagValue:'品目'+String(i).padStart(2,'0'),account:'売上高',date:'2026-01',amount:1000+i,unit:1,importSource:'x'});
 const br=E.analyze(big);M.tagState(big,'monthlyPL',{dim:'item'});
 const h4=F.page(big,br,null),pl=h4.slice(h4.indexOf('data-stmt="monthlyPL"'),h4.indexOf('data-stmt="monthlyBS"'));
 assert.equal((pl.match(/品目\d\d</g)||[]).length,30);
 assert.match(pl,/<tr class="vt-tag vt-pager"><th class="stmt-acct"><div class="vt-pagerin"><button type="button" class="btn small vt-more" data-vt-more="[^"]+">すべて表示（残り(\d+)件）<\/button>/);
 const n=V.tagRows(big,br,'monthlyPL','売上高','item').rows.length;assert.equal(n,48,'帳票の45件＋仕訳だけにある3件');
 // 仕訳だけにある「ブランディング」は1月が0円（2026-06から計上）なので0円だけの行として省く
 assert.equal(+pl.match(/すべて表示（残り(\d+)件）/)[1],n-1-30);assert.match(pl,/0円だけの品目 1件を省略/);
 M.tagState(big,'monthlyPL',{all:[['売上高','item']],sort:'size'});
 const h5=F.page(big,br,null),pl5=h5.slice(h5.indexOf('data-stmt="monthlyPL"'),h5.indexOf('data-stmt="monthlyBS"')),names=[...pl5.matchAll(/(品目\d\d)</g)].map(m=>m[1]);
 assert.equal(names.length,45);assert.match(pl5,/>Web更新<\/span><small class="stmt-flag">仕訳のみ<\/small>/);assert.equal(names[0],'品目44','金額の大きい順');
 assert.match(pl5,/30件に戻す/);
});

test('仕訳が無いとき、変動の理由は「資料確認待ち」を並べず1行だけ',()=>{
 const s=make({journal:false}),r=E.analyze(s);
 assert.ok(V.monthReasons(s,r,'monthlyBS','事業主貸').every(x=>x.ex===null&&x.ready===false));
 M.tagState(s,'monthlyBS',{open:['事業主貸']});
 const html=F.page(s,r,null);
 assert.equal((html.match(/仕訳が未読込のため、変動の理由はまだ推測できません/g)||[]).length,1);
 assert.ok(!/原因分析は資料確認待ち/.test(html));
 // 仕訳があれば従来どおり月ごとの理由
 assert.ok(V.monthReasons(full,fullResult,'monthlyBS','事業主貸').some(x=>x.ex&&x.ex.headline));
});

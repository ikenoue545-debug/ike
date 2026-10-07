// node --test tests/
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const H=require('./harness.js');
const ctx=H.load(),V=ctx.ReviewVariance,E=ctx.ReviewEngine;
// v3.6 の言い回し（延滞と断定しない）に合わせて確認する
const full=H.session(ctx),fullResult=E.analyze(full);
const journalOnly=H.session(ctx,{pl:false,bs:false}),journalResult=E.analyze(journalOnly);
const ex=(type,account,month,opt,s=full,r=fullResult)=>V.explain(s,r,type,account,month,opt);
const has=(e,re)=>e.inferences.some(x=>re.test(x.short+x.text));

test('事業主貸：個人名の取引先への送金で増えたと説明する',()=>{
 const e=ex('monthlyBS','事業主貸','2026-03');
 assert.equal(e.delta,850000);
 assert.equal(e.bestDim,'party');
 assert.equal(e.drivers[0].label,'ヤマダタロウ');
 assert.equal(e.drivers[0].diff,800000);
 assert.match(e.headline,/ヤマダタロウ \+800,000円/);
 assert.ok(has(e,/ヤマダタロウ（個人名）/));
 assert.ok(has(e,/事業主本人・家族への送金/));
});
test('事業主貸：品目から個人の社会保険料と読む',()=>{
 const e=ex('monthlyBS','事業主貸','2026-06');
 assert.ok(has(e,/事業主個人の税金・社会保険料/));
});
test('セゾンカード：利用先ごとの増減と引落しの有無を説明する',()=>{
 const mar=ex('monthlyBS','セゾンカード','2026-03');
 assert.equal(mar.delta,359200);
 assert.ok(has(mar,/\(株\)ビックカメラの利用が増加/));
 assert.ok(has(mar,/FaceBookの利用が増加/));
 const may=ex('monthlyBS','セゾンカード','2026-05');
 assert.ok(has(may,/口座からの引落しが当月はない/));
 const jun=ex('monthlyBS','セゾンカード','2026-06');
 assert.ok(has(jun,/引落しが2回分/));
 const feb=ex('monthlyBS','セゾンカード','2026-02');
 assert.ok(!has(feb,/2回分/),'引落しが1回の月を2回分と言わない');
 assert.match(feb.headline,/口座引落し（取引先未選択）/);
});
test('セゾンカード：取引先別の累計増減は freee と同じく未選択がマイナス、期首は別行（取引先別の残高は確定しない）',()=>{
 const t=V.tagRows(full,fullResult,'monthlyBS','セゾンカード','party','cumulative');
 assert.equal(t.opening,922658);
 assert.ok(t.rows.find(r=>r.missing).values['2026-03']<0);
 assert.ok(t.rows.find(r=>r.label==='Google Japan G.K.').values['2026-03']>0);
 assert.equal(t.hasDiff,false,'期首＋内訳の合計が帳票の残高と一致する');
 const b=V.tagRows(full,fullResult,'monthlyBS','セゾンカード','party','balance');
 assert.equal(b.mode,'unknown','取引先内訳つきBSがないカードは残高を確定しない');
});
test('租税公課：品目別で自動車税・前年同月・個人の税金を説明する',()=>{
 const jun=ex('monthlyPL','租税公課','2026-06');
 assert.equal(jun.bestDim,'item');
 assert.ok(has(jun,/自動車税の納付/));
 assert.ok(has(jun,/前年の同じ月（2025年6月）/));
 assert.ok(!has(jun,/新しい品目/),'例年の取引を新規と言わない');
 const mar=ex('monthlyPL','租税公課','2026-03');
 assert.ok(has(mar,/個人の税金が経費に計上/));
 const apr=ex('monthlyPL','租税公課','2026-04');
 assert.ok(has(apr,/前月の住民税がなくなった/));
});
test('給料・家賃：計上月のずれ（翌月に2か月分）を見つける',()=>{
 assert.ok(has(ex('monthlyPL','給料手当','2026-06'),/翌月に2か月分を計上/));
 assert.ok(has(ex('monthlyPL','給料手当','2026-07'),/前月分を当月にまとめて計上/));
 assert.ok(has(ex('monthlyPL','給料手当','2026-08'),/前月の2か月分計上の反動/));
 assert.ok(has(ex('monthlyPL','地代家賃','2026-09'),/前月分を当月にまとめて計上/));
});
test('売上：隔月の取引先・新規の取引先・スポット案件の反動',()=>{
 assert.ok(has(ex('monthlyPL','売上高','2026-04'),/2か月ごと（隔月）の取引で当月は計上のない月/));
 assert.ok(has(ex('monthlyPL','売上高','2026-06'),/新しい取引先/));
 assert.ok(has(ex('monthlyPL','売上高','2026-07'),/前月が特に多かった反動/));
});
test('売掛金・預金：入金の候補が無い月・前月を上回る月と、2か月分の入金',()=>{
 assert.ok(has(ex('monthlyBS','売掛金','2026-05'),/預金等を含む減少候補が当月見当たらない/));
 assert.ok(has(ex('monthlyBS','売掛金','2026-06'),/預金等を含む減少候補が前月増加を上回る/));
 assert.ok(has(ex('monthlyBS','普通預金','2026-05'),/通常ある入金がない/));
 assert.ok(has(ex('monthlyBS','普通預金','2026-06'),/2か月分の入金/));
 const mar=ex('monthlyBS','普通預金','2026-03');
 assert.equal(mar.drivers[0].label,'ヤマダタロウ','減少の月は減少方向の内訳を主因にする');
});
test('未払消費税：納付で残高がなくなった',()=>{
 const e=ex('monthlyBS','未払消費税','2026-03');
 assert.equal(e.delta,-620300);
 assert.ok(has(e,/消費税の納付/));
});
test('保険料：前年同月と年払いの記載',()=>{
 const e=ex('monthlyPL','保険料','2026-07');
 assert.ok(has(e,/前年同月にも計上/));
 assert.ok(has(e,/年払い/));
});
test('内訳の金額は仕訳の合計と一致し、帳票との差もない',()=>{
 for(const [type,account] of [['monthlyPL','広告宣伝費'],['monthlyPL','売上高'],['monthlyBS','普通預金'],['monthlyBS','事業主貸']])
  for(const dim of ['party','item','department']){
   const t=V.tagRows(full,fullResult,type,account,dim,'flow');
   assert.equal(t.hasDiff,false,`${account} ${dim}`);
  }
});
test('タグ：対象科目と同じ側の列を使い、空欄は他の側から借りない',()=>{
 const row={debit:'セゾンカード',credit:'普通預金',debitParty:'',creditParty:'銀行',fieldOrigins:{debitParty:4,creditParty:9}};
 assert.equal(V.tag(row,'debit','party'),'');
 assert.equal(V.tag(row,'credit','party'),'銀行');
 assert.equal(V.tag({party:'共通',debitParty:''},'debit','party'),'共通','借貸別の列がない旧形式は共通の取引先');
});
test('個人名の判定',()=>{
 for(const n of ['ヤマダタロウ','サイトウタカシ','サイトウ タカシ','山田 太郎','斉藤隆'])assert.ok(V.looksPerson(n),n);
 for(const n of ['マイクロソフト','(株)ブルースカイ','税務署','宇都宮市','Google Japan G.K.','東京電力エナジーパートナー(株)','民事法務協会','JR東日本'])assert.ok(!V.looksPerson(n),n);
});
test('月次BSが未読込でも、仕訳から各月の増減と理由を出す',()=>{
 const bs=V.ledgerBS(V.context(journalOnly,journalResult)).map(g=>g.account);
 for(const a of ['普通預金','売掛金','事業主貸','セゾンカード','未払消費税'])assert.ok(bs.includes(a),a);
 const e=ex('monthlyBS','事業主貸','2026-03',{},journalOnly,journalResult);
 assert.equal(e.flowOnly,true);
 assert.equal(e.delta,850000);
 assert.ok(has(e,/ヤマダタロウ（個人名）/));
});
test('内訳を指定した分析（取引先「FaceBook」）',()=>{
 const e=ex('monthlyBS','セゾンカード','2026-03',{dim:'party',tag:'FaceBook'});
 assert.equal(e.scoped,true);
 assert.equal(e.delta,186000);
 assert.ok(e.curEntries.every(x=>V.tag(x.row,x.side,'party')==='FaceBook'));
});
test('大きく動いた科目の一覧',()=>{
 const list=V.notable(full,fullResult,{limit:50});
 assert.ok(list.length>5);
 assert.ok(list.some(n=>n.account==='事業主貸'&&n.month==='2026-03'));
 const mar=V.notable(full,fullResult,{month:'2026-03'});
 assert.ok(mar.every(n=>n.month==='2026-03'));
});
test('確認キューの「前月から大きく変動」に理由が付く',()=>{
 const f=fullResult.findings.find(f=>f.monthlyCheck&&/前月から大きく変動/.test(f.title)&&f.account==='事業主貸');
 assert.ok(f,'事業主貸の変動候補');
 assert.match(V.findingHTML(f,full,fullResult),/仕訳から見た変動の理由/);
 assert.match(V.findingText(f,full,fullResult),/ヤマダタロウ/);
});
test('AIに相談する文章に根拠の仕訳を含める',()=>{
 const t=V.promptText(ex('monthlyBS','事業主貸','2026-03'),full);
 assert.match(t,/振込 ヤマダタロウ/);
 assert.match(t,/事業主貸/);
});

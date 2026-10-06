// 架空の個人事業「やまだデザイン事務所」の freee 形式CSV（仕訳帳・月次PL・月次BS）を作る。
// 実在の会社・個人とは関係ありません。月次分析の動作確認用。
'use strict';
const fs=require('fs'),path=require('path');
const out=path.join(__dirname,'fixtures');fs.mkdirSync(out,{recursive:true});
let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
const months=Array.from({length:9},(_,i)=>`2026-${String(i+1).padStart(2,'0')}`);
const J=[];let no=1;
// side tags: [party,item,dept,memo]
function add(date,debit,credit,amount,o={}){
 J.push({date,no:no++,debit,credit,amount,dp:o.dp??o.party??'',cp:o.cp??o.party??'',di:o.di??o.item??'',ci:o.ci??'',dd:o.dept??'',cd:'',desc:o.desc||''});
}
const d=(m,day)=>`${m}-${String(day).padStart(2,'0')}`;
const r=(base,spread)=>Math.round((base+(rnd()-.5)*spread)/10)*10;
// 前年（2025年）の同じ時期の仕訳：過去の仕訳帳として使う
const P=[];let pno=1;function addPrior(date,debit,credit,amount,o={}){P.push({date,no:pno++,debit,credit,amount,dp:o.party||'',cp:o.party||'',di:o.item||'',ci:'',dd:'',cd:'',desc:o.desc||''});}
addPrior('2025-06-02','租税公課','普通預金',39900,{party:'',item:'自動車税',desc:'自動車税 納付'});
addPrior('2025-07-10','保険料','普通預金',96000,{party:'東西損害保険(株)',item:'損害保険料',desc:'事業用火災保険 年払い'});
months.forEach((m,i)=>{
 const mo=i+1;
 // 売上（売掛金計上 → 翌月25日入金）
 const blue=mo===4?620000:r(980000,260000);add(d(m,28),'売掛金','売上高',blue,{party:'(株)ブルースカイ',ci:'デザイン制作',desc:`${mo}月分 デザイン制作`});
 if(mo%2===1)add(d(m,28),'売掛金','売上高',r(420000,80000),{party:'合同会社グリーンリーフ',desc:'Web更新業務'});
 if(mo>=6)add(d(m,28),'売掛金','売上高',mo===6?880000:r(300000,60000),{party:'(株)オレンジデザイン',desc:'新規 ブランディング案件'});
 // 前月の売掛金の入金
 if(mo>1){for(const x of J.filter(x=>x.debit==='売掛金'&&x.date.slice(0,7)===months[i-1])){if(mo===5&&x.dp==='(株)ブルースカイ')continue;add(d(m,25),'普通預金','売掛金',x.amount,{party:x.dp,desc:'売掛金 入金'});}}
 else{add(d(m,25),'普通預金','売掛金',900000,{party:'(株)ブルースカイ',desc:'前期末売掛金 入金'});}
 if(mo===6){const x=J.find(x=>x.debit==='売掛金'&&x.date.slice(0,7)==='2026-04'&&x.dp==='(株)ブルースカイ');add(d(m,10),'普通預金','売掛金',x.amount,{party:'(株)ブルースカイ',desc:'4月分 入金（遅延分）'});}
 // 家賃：8月は引落しなし、9月に2か月分
 if(mo!==8)add(d(m,27),'地代家賃','普通預金',mo===9?149000:74500,{party:'青葉不動産(株)',item:'事務所家賃',desc:mo===9?'事務所家賃 8・9月分':'事務所家賃'});
 // 給料：6月は計上なし、7月に2か月分
 if(mo!==6){const amt=mo===7?490000:245000;add(d(m,25),'給料手当','普通預金',amt-25000,{party:'スズキハナコ',item:'給与',desc:mo===7?'6・7月分 給与':`${mo}月分 給与`});add(d(m,25),'給料手当','預り金',25000,{party:'スズキハナコ',item:'給与',desc:'源泉・住民税 預り'});}
 if(mo===1||mo===7)add(d(m,10),'預り金','普通預金',mo===1?140000:150000,{party:'税務署',desc:'源泉所得税 納付（納期の特例）'});
 // 法定福利費：給与からの控除（貸方）と納付（借方）がずれる
 if(mo!==6)add(d(m,25),'普通預金','法定福利費',mo===7?36000:18000,{party:'スズキハナコ',desc:'社会保険料 本人負担分 控除'});
 if(mo>=2)add(d(m,28),'法定福利費','普通預金',mo===7?72000:36000,{party:'日本年金機構',desc:'社会保険料 納付'});
 // 租税公課
 if(mo===1){add(d(m,12),'租税公課','現金',1000,{item:'印紙代',desc:'収入印紙'});add(d(m,20),'租税公課','現金',1200,{item:'住民票等',desc:'住民票の写し'});}
 if(mo===3)add(d(m,31),'租税公課','普通預金',58000,{party:'',item:'住民税',desc:'住民税 第4期'});
 if(mo===4||mo===7)add(d(m,30),'租税公課','普通預金',28300,{item:'固定資産税',desc:'固定資産税（償却資産）'});
 if(mo===6)add(d(m,2),'租税公課','普通預金',39900,{item:'自動車税',desc:'自動車税 納付'});
 if(mo===8)add(d(m,31),'租税公課','普通預金',41200,{item:'事業税',desc:'個人事業税 第1期'});
 // カード利用（セゾンカード）：取引先は貸方（カード）側にも付く
 const card=(day,acct,party,amt,item,desc)=>add(d(m,day),acct,'セゾンカード',amt,{party,item,desc});
 card(5,'広告宣伝費','Google Japan G.K.',r(48000+mo*2500,6000),'広告費','Google広告');
 card(8,'広告宣伝費','FaceBook',mo===3?186000:r(22000,8000),'広告費',mo===3?'春キャンペーン広告 一括':'Facebook広告');
 card(12,'通信費','(株)NTTドコモ',r(11500,1200),'携帯電話','携帯電話料金');
 card(15,'支払手数料','フリー(株)',mo===1?39336:3278,'会計ソフト',mo===1?'freee 年額プラン 更新':'freee 追加オプション');
 card(18,'通信費','dropbox',mo===1?71280:5940,'クラウド',mo===1?'Dropbox 年払い':'Dropbox 追加容量');
 if(mo===3)card(20,'消耗品費','(株)ビックカメラ',198000,'パソコン','ノートPC 購入（業務用）');
 if(mo===5)card(22,'旅費交通費','JR東日本',64380,'新幹線','大阪出張 新幹線往復');
 // カード代金の引落し：取引先なし。5月は引落しがなく、6月に2回
 if(mo!==5){const usage=J.filter(x=>x.credit==='セゾンカード'&&x.date.slice(0,7)===(mo===1?'2026-01':months[i-1])).reduce((n,x)=>n+x.amount,0);const pay=mo===1?922658:usage;add(d(m,27),'セゾンカード','普通預金',pay,{party:'',desc:'セゾンカード 口座振替'});
  if(mo===6){const u2=J.filter(x=>x.credit==='セゾンカード'&&x.date.slice(0,7)==='2026-04').reduce((n,x)=>n+x.amount,0);add(d(m,10),'セゾンカード','普通預金',u2,{party:'',desc:'セゾンカード 口座振替（5月引落し分）'});}}
 // 水道光熱費
 add(d(m,20),'水道光熱費','普通預金',r(mo<=3?16000:mo>=7?18000:12000,3000),{party:'東京電力エナジーパートナー(株)',item:'電気代',desc:'電気料金'});
 // 保険料：7月に年払い
 if(mo===7)add(d(m,10),'保険料','普通預金',98400,{party:'東西損害保険(株)',item:'損害保険料',desc:'事業用火災保険 年払い'});
 // 事業主貸：毎月ATMで生活費を引出し。3月はヤマダタロウへ4回送金。6月は国民健康保険。
 add(d(m,3),'事業主貸','普通預金',50000,{party:'',desc:'ATM 引出し 生活費'});
 if(mo===3)[5,12,19,26].forEach(day=>add(d(m,day),'事業主貸','普通預金',200000,{party:'ヤマダタロウ',desc:'振込 ヤマダタロウ'}));
 if(mo===8)add(d(m,14),'事業主貸','普通預金',120000,{party:'ヤマダタロウ',desc:'振込 ヤマダタロウ'});
 if(mo===6)add(d(m,30),'事業主貸','普通預金',62400,{party:'',item:'国民健康保険',desc:'国民健康保険料 第1期'});
 // 事業主借：個人カードで経費を立替
 if(mo===4)add(d(m,9),'会議費','事業主借',8800,{party:'カフェ・ド・パリ',item:'打合せ',desc:'打合せ 喫茶 個人カードで立替'});
 // 未払消費税：3月に納付
 if(mo===3)add(d(m,15),'未払消費税','普通預金',620300,{party:'税務署',desc:'消費税 確定申告分 納付'});
});
// ---- CSV 出力
const q=v=>{const s=String(v??'');return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
const line=a=>a.map(q).join(',');
function journalCSV(rows){
 const h=['取引日','伝票番号','借方勘定科目','借方金額','借方税区分','借方取引先','借方品目','借方部門','貸方勘定科目','貸方金額','貸方税区分','貸方取引先','貸方品目','貸方部門','摘要'];
 return '﻿'+[line(h),...rows.map(x=>line([x.date.replace(/-/g,'/'),x.no,x.debit,x.amount,'',x.dp,x.di,x.dd,x.credit,x.amount,'',x.cp,x.ci,x.cd,x.desc]))].join('\r\n')+'\r\n';
}
fs.writeFileSync(path.join(out,'journal-2026.csv'),journalCSV(J));
fs.writeFileSync(path.join(out,'journal-2025.csv'),journalCSV(P));
// ---- 月次PL・BS（仕訳から作る帳票。freeeの月次推移CSVに近い横形式）
const PL_INCOME=['売上高'],PL_EXP=['租税公課','水道光熱費','旅費交通費','通信費','広告宣伝費','保険料','消耗品費','法定福利費','給料手当','支払手数料','会議費','地代家賃'];
const BS_ASSET=['普通預金','現金','売掛金'],BS_LIAB=['セゾンカード','預り金','未払消費税'],OWNER_DRAW=['事業主貸'],OWNER_CONTRIB=['事業主借'],EQUITY=['元入金'];
const opening={'普通預金':3000000,'現金':50000,'売掛金':900000,'セゾンカード':922658,'預り金':140000,'未払消費税':620300,'事業主貸':0,'事業主借':0};
opening['元入金']=opening['普通預金']+opening['現金']+opening['売掛金']-opening['セゾンカード']-opening['預り金']-opening['未払消費税'];
const net=(a,m)=>J.filter(x=>x.date.slice(0,7)===m).reduce((n,x)=>n+(x.debit===a?x.amount:0)-(x.credit===a?x.amount:0),0);
const plv=(a,m)=>PL_INCOME.includes(a)?-net(a,m):net(a,m);
const head=['勘定科目',...months.map(m=>m.replace('-','/')),'期間累計'];
const row=(name,vals)=>line([name,...vals,vals.every(Number.isFinite)?vals.reduce((a,b)=>a+b,0):'']);
const pl=[line(['[月次推移：損益計算書]']),line(['期間: 2026年01月〜2026年09月','（単位：円）']),line(head),line(['収入金額'])];
const inc=months.map(m=>PL_INCOME.reduce((n,a)=>n+plv(a,m),0)),exp=months.map(m=>PL_EXP.reduce((n,a)=>n+plv(a,m),0));
for(const a of PL_INCOME)pl.push(row(a,months.map(m=>plv(a,m))));
pl.push(row('収入金額 計',inc),line(['経費']));
for(const a of PL_EXP)pl.push(row(a,months.map(m=>plv(a,m))));
pl.push(row('経費 計',exp),row('差引損益計算',months.map((m,i)=>inc[i]-exp[i])));
fs.writeFileSync(path.join(out,'monthly-pl-2026.csv'),'﻿'+pl.join('\r\n')+'\r\n');
const bal=(a,m)=>{const sign=[...BS_LIAB,...OWNER_CONTRIB,...EQUITY].includes(a)?-1:1;let v=opening[a]||0;for(const x of months){if(x>m)break;v+=sign*net(a,x);}return v;};
const months12=Array.from({length:12},(_,i)=>`2026-${String(i+1).padStart(2,'0')}`);
const bsHead=['勘定科目','期首',...months12.map(m=>m.replace('-','/'))];
const bsRow=a=>line([a,opening[a]||0,...months12.map(m=>months.includes(m)?bal(a,m):'')]);
const pli=months.map((m,i)=>inc[i]-exp[i]);
const bs=[line(['[月次推移：貸借対照表]']),line(['期間: 2026年01月〜2026年12月','（単位：円）']),line(bsHead),line(['流動資産']),...BS_ASSET.map(bsRow),line(['事業主貸']),...OWNER_DRAW.map(bsRow),line(['流動負債']),...BS_LIAB.map(bsRow),line(['事業主借']),...OWNER_CONTRIB.map(bsRow),line(['純資産']),...EQUITY.map(bsRow)];
fs.writeFileSync(path.join(out,'monthly-bs-2026.csv'),'﻿'+bs.join('\r\n')+'\r\n');
console.log('journal rows',J.length,'prior rows',P.length);

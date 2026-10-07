(function(root){
'use strict';
// 月次PL・BS画面の「取引先別の残高と回収・支払の状況」。計算は ReviewPartyOpening が持ち、ここは表示だけ。
// 資金の動きの欄のすぐ後ろに置く。推定は確定値（取引先内訳つきBS）と区別して表示する。
// 取引先が数百〜数千社でも画面が固まらないよう、表は科目ごとに25社ずつ、内訳と根拠は開いたときに作る（印刷では全件）。
const F=root.ReviewFinancial,PO=root.ReviewPartyOpening;
if(!F||!PO||typeof F.page!=='function')throw Error('ReviewPartyOpeningUI requires the monthly page and ReviewPartyOpening.');
const originalPage=F.page,finite=Number.isSafeInteger,nf=new Intl.NumberFormat('ja-JP');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>finite(v)?nf.format(v===0?0:v):'—';
const yen=v=>`<span class="ts-money${finite(v)&&v<0?' ts-negative':''}">${num(v)}</span>`;
const months=d=>Number.isFinite(d)?d<45?`${d}日`:`約${Math.round(d/30)}か月`:'—';
const norm=v=>String(v??'').normalize('NFKC').toLocaleLowerCase().replace(/[\s　]/g,'');
const sumOf=(xs,f)=>xs.some(p=>!finite(f(p)))?null:xs.reduce((n,p)=>n+f(p),0);
const BADGE={long:'red',late:'warn',credit:'warn',normal:'',settled:'ok',unknown:''};
const CONF={'高':'ok','中':'warn','低':''};
const PAGE=25,EVIDENCE=30,states=new WeakMap();
let view=null,viewSeq=0,current=null,printing=false,queryTimer=null,composing=null;
function stateOf(session){let s=states.get(session);if(!s)states.set(session,s={query:'',hideZero:true,pages:new Map(),evPages:new Map()});return s;}
// 開いたときに中身を作る欄・ページ分けした表は、この画面の描画ごとの登録簿に置く（資金の動きの欄とは別）
function lazy(cls,summary,render,key=''){
 const id=view.id+'-'+(++view.seq);view.lazy.set(id,{render,loaded:false});
 return `<details class="${cls}" data-po-lazy="${id}"${key?` data-po-key="${esc(key)}"`:''}><summary>${summary}</summary><div data-po-content="1"></div></details>`;
}
function list(render){const id=view.id+'-'+(++view.seq);view.lists.set(id,render);return `<div data-po-list="${id}">${render()}</div>`;}
function pager(kind,key,page,size,total,unit,extra=''){
 if(printing||total<=size)return extra?`<div class="po-pager"><span class="small">${extra}</span></div>`:'';
 const last=Math.ceil(total/size)-1;
 return `<div class="po-pager"><span class="small">${num(page*size+1)}〜${num(Math.min(total,(page+1)*size))}${unit} ／ ${num(total)}${unit}${extra?'。'+extra:''}</span><span class="po-pagebtns"><button type="button" class="btn small" data-po-page="${kind}" data-po-pkey="${esc(key)}" data-po-step="-1"${page===0?' disabled':''}>前へ</button><button type="button" class="btn small" data-po-page="${kind}" data-po-pkey="${esc(key)}" data-po-step="1"${page>=last?' disabled':''}>次へ</button></span></div>`;
}
const clampPage=(map,key,total,size)=>{const p=Math.max(0,Math.min(map.get(key)||0,Math.ceil(total/size)-1));map.set(key,p);return p;};
function rowList(rows){const seen=new Set();return (rows||[]).filter(r=>{const id=JSON.stringify([r.source,r.line,r.date,r.journalId||r.id,r.debit,r.credit]);if(seen.has(id))return false;seen.add(id);return true;});}
// 根拠の仕訳：新しい順に30行ずつ
function evidence(key,rows){
 const rs=rowList(rows).reverse();if(!rs.length)return '';
 return lazy('ts-evidence po-evidence',`根拠の仕訳（${num(rs.length)}行）`,()=>list(()=>{
  const st=view.state,page=printing?0:clampPage(st.evPages,key,rs.length,EVIDENCE),shown=printing?rs:rs.slice(page*EVIDENCE,(page+1)*EVIDENCE);
  return `<div class="tablewrap"><table class="datatable"><thead><tr><th scope="col">日付・仕訳番号</th><th scope="col">借方 ／ 貸方（円）</th><th scope="col">摘要・元CSV</th></tr></thead><tbody>${shown.map(r=>`<tr><td>${esc(r.date||'')}<p class="small">${esc(r.journalId||r.id||'')}</p></td><td>${esc(r.debit||'—')} ${num(r.debitAmount)}<br>${esc(r.credit||'—')} ${num(r.creditAmount)}</td><td>${esc(r.description||'')}<p class="small">${esc(r.source||'元CSV名未保存')}${r.line?' '+num(r.line)+'行':''}</p></td></tr>`).join('')}</tbody></table></div>${pager('ev',key,page,EVIDENCE,rs.length,'行')}`;
 }));
}
function itemText(i,w){return `${i.preWindow?'読込範囲より前の'+w.inc:i.exactAdjust?'期首時点の残高（BS内訳）':esc(i.date)+'の'+w.inc} ${num(i.amount)}円`;}
function whyHTML(a,p){
 const w=a.words,open=(p.openItems||[]).filter(i=>i.amount>0),atOpening=(p.openItemsAtOpening||[]).filter(i=>i.amount>0);
 const items=a.mode==='bs'?'':p.closing===null?`<p class="small">期首が分からないため、${w.open}の内訳は出せません。</p>`:open.length?`<p class="small">${esc(a.asOf)}時点の${w.open}（古い順）</p><ul>${open.slice(0,12).map(i=>`<li>${itemText(i,w)}</li>`).join('')}${open.length>12?`<li>ほか${open.length-12}件</li>`:''}</ul>`:`<p class="small">${esc(a.asOf)}時点の${w.open}はありません。</p>`;
 return `${items}${atOpening.length&&a.mode!=='bs'?`<p class="small">期首（${esc(a.openingMonth||a.window.end)}末）の内訳：${atOpening.map(i=>itemText(i,w)).join('、')}</p>`:''}${(p.reasons||[]).map(t=>`<p class="small">${esc(t)}</p>`).join('')}${evidence(a.account+'|'+p.party,p.rows)}`;
}
function partyRow(a,p){
 const w=a.words,bs=a.mode==='bs';
 const basis=p.openingBasis==='exact'?'<span class="badge ok" title="取引先内訳つきBSの確定値">確定</span>':p.openingBasis==='estimate'?'<span class="badge" title="過去の仕訳からの推定">推定</span>':'';
 const oldest=p.oldestPreWindow?`<span class="po-old">${esc(a.window.start)}より前</span>`:p.oldestDate?`${esc(p.oldestDate)}<p class="small">経過 ${months(p.oldestAge)}</p>`:'—';
 return `<tr class="po-row po-${p.status}${p.untagged?' po-untagged':''}"><th scope="row"><strong>${esc(p.label)}</strong>${p.major?`<span class="badge po-major" title="当期の${w.inc}の多い取引先">主要 ${Math.round(p.share*100)}%</span>`:''}</th><td data-label="状態"><span class="badge ${BADGE[p.status]||''}">${esc(p.statusLabel)}</span></td><td class="num" data-label="期首（円）">${yen(p.opening)} ${basis}</td><td class="num" data-label="当期の${w.inc}">${yen(p.increase)}</td><td class="num" data-label="当期の${w.dec}">${yen(p.decrease)}</td><td class="num" data-label="残高（円）"><strong>${yen(p.closing)}</strong>${bs&&finite(p.closing)?'<p class="small">BS内訳</p>':''}${Number.isFinite(p.daysOfVolume)?`<p class="small">${w.inc}の約${p.daysOfVolume}日分</p>`:''}</td><td data-label="いちばん古い${w.open}">${oldest}</td><td class="num" data-label="ふだんの${w.act}日数">${Number.isFinite(p.lagMedian)?Math.round(p.lagMedian)+'日':'—'}${p.lagSamples?`<p class="small">${p.lagSamples}件から</p>`:''}</td><td class="po-wide">${lazy('po-why','内訳と根拠',()=>whyHTML(a,p),a.account+'|'+p.party)}</td></tr>`;
}
const baseParties=a=>a.parties.filter(p=>!(p.untagged&&!p.opening&&!p.closing&&!p.increase&&!p.decrease));
const isZero=p=>p.closing===0;
function shownParties(a){
 const st=view.state,q=norm(st.query),all=baseParties(a);
 const hits=q?all.filter(p=>norm(p.label).includes(q)):all,hidden=st.hideZero?hits.filter(isZero).length:0;
 return {all,hits,shown:st.hideZero?hits.filter(p=>!isZero(p)):hits,hidden};
}
function tableHTML(a){
 const w=a.words,{all,shown,hidden}=shownParties(a),st=view.state;
 if(!all.length)return `<p class="small">${a.mode==='bs'?'取引先内訳つきBSに、この科目の取引先がありません。':'この科目の仕訳がありません。'}</p>`;
 const page=printing?0:clampPage(st.pages,a.account,shown.length,PAGE),rows=printing?shown:shown.slice(page*PAGE,(page+1)*PAGE);
 const note=[st.query?`「${esc(st.query)}」に合う取引先`:'',hidden?`残高0の${num(hidden)}社を隠しています`:''].filter(Boolean).join('・');
 const residual=finite(a.residual)&&a.residual!==0?`<tr class="po-residual"><th scope="row">内訳不明（BSの期首との差）</th><td></td><td class="num" data-label="期首（円）">${yen(a.residual)}</td><td></td><td></td><td class="num" data-label="残高（円）">${yen(a.residual)}</td><td colspan="3" class="po-wide"><p class="small">取引先に配分できない期首の残りです。当期の${w.dec}で減ったかどうかは分かりません。</p></td></tr>`:'';
 // 合計は検索・非表示にかかわらず科目の全取引先。期首（残高）が分からない取引先が1社でもあれば出さない（0円として足さない）
 const total=f=>{const v=sumOf(all,f);return v===null?null:v+(finite(a.residual)?a.residual:0);};
 const body=rows.length?rows.map(p=>partyRow(a,p)).join(''):`<tr><td colspan="9"><p class="small">${st.query?'検索条件に合う取引先はありません。':'表示する取引先はありません。'}</p></td></tr>`;
 return `<div class="tablewrap"><table class="datatable po-table"><thead><tr><th scope="col">取引先</th><th scope="col">状態</th><th scope="col" class="num">期首（円）</th><th scope="col" class="num">当期の${w.inc}</th><th scope="col" class="num">当期の${w.dec}</th><th scope="col" class="num">残高（円）</th><th scope="col">いちばん古い${w.open}</th><th scope="col" class="num">ふだんの${w.act}日数</th><th scope="col">内訳・根拠</th></tr></thead><tbody>${body}${residual}<tr class="ts-subtotal"><th scope="row">合計（全${num(all.length)}社）</th><td></td><td class="num" data-label="期首（円）">${yen(total(p=>p.opening))}</td><td class="num" data-label="当期の${w.inc}">${yen(sumOf(all,p=>p.increase))}</td><td class="num" data-label="当期の${w.dec}">${yen(sumOf(all,p=>p.decrease))}</td><td class="num" data-label="残高（円）">${yen(total(p=>p.closing))}</td><td colspan="3"></td></tr></tbody></table></div>${pager('party',a.account,page,PAGE,shown.length,'社',note)}`;
}
function accountHTML(a){
 const w=a.words,DIFF={matched:'一致',unexplained:'推定が少ない',over:'推定が多い'};
 const source=a.openingSource==='unknown'?'未読込':a.openingSource==='conflict'?'確定できません':a.openingSource;
 const closingNote=!finite(a.closingTotal)?`照合できません（取引先別の${a.mode==='bs'?'残高':'期首'}が不明）`:!finite(a.closingResidual)?'照合できません':a.closingResidual!==0?'取引先別の残高の合計との差 '+num(a.closingResidual)+'円':'取引先別の残高の合計と一致';
 const basis=[a.estimated&&a.window.start?`過去の仕訳 ${esc(a.window.start)}〜${esc(a.window.end)}（${a.window.months}か月）から推定`:'',a.exactCount?`確定値 ${num(a.exactCount)}社（BS内訳）`:''].filter(Boolean).join('・')||'期首の分からない取引先があります';
 const diff=DIFF[a.status]||(['exact','bs_only'].includes(a.status)&&finite(a.residual)?a.residual===0?'一致':'内訳不明':finite(a.residual)?'参考（状態は判定しません）':'照合できません');
 const asOf=a.mode==='bs'?`${esc(a.bsThrough||'—')}末時点（取引先内訳つきBS）`:a.mode==='journal'?`${esc(a.asOf)}時点（当期の仕訳を連続して読めた月まで）`:'—（当期の仕訳を期首月から読めないため）';
 const badge=a.estimated?`<span class="badge ${CONF[a.confidence]||''}" title="推定の確からしさ">推定の確からしさ ${esc(a.confidence)}</span>`:a.exactCount?'<span class="badge ok" title="取引先内訳つきBSの確定値">期首は確定値</span>':'';
 const closingMonth=a.through||a.bsThrough;
 return `<article class="po-account"><header class="po-head"><div><h3>${esc(a.account)} <span class="small">${a.kind==='receipt'?'回収を確認':'支払を確認'}</span></h3><p class="small">期首 ${esc(a.openingMonth||a.window.end||'—')}末 ／ 残高 ${asOf}</p></div>${badge}</header>
 <div class="po-recon"><div><span>BSの期首</span><strong>${yen(a.reportedOpening)}</strong><small>${esc(source)}</small></div><div><span>取引先別の期首の合計</span><strong>${yen(a.estimatedTotal)}</strong><small>${basis}</small></div><div><span>差（内訳不明）</span><strong>${yen(a.residual)}</strong><small>${diff}</small></div>${finite(a.reportedClosing)?`<div><span>BSの残高（${esc(closingMonth||'')}）</span><strong>${yen(a.reportedClosing)}</strong><small>${esc(closingNote)}</small></div>`:''}</div>
 <p class="small po-status">${esc(a.statusText)}</p>${a.heldText?`<p class="small po-status">${esc(a.heldText)}</p>`:''}
 ${list(()=>tableHTML(a))}
 ${a.matches.length?lazy('po-matches',`取引先が未選択の${w.dec}を、金額の一致で取引先に当てたもの（${num(a.matches.length)}件）`,()=>`<ul>${a.matches.map(m=>`<li>${esc(m.date)} ${num(m.amount)}円 → ${esc(m.label)}（${esc(m.itemDate)}の${w.inc}と同額）</li>`).join('')}</ul><p class="small">金額の一致だけで当てた候補です。freeeで取引先を付け直すと、この推定は確定に近づきます。</p>`):''}
 </article>`;
}
// 見出しの説明：仕訳だけ／取引先内訳つきBSだけ／両方 で言い分ける（推定していないのに「推定」と言わない）
function lead(po){
 const accounts=po.accounts,bsThrough=accounts.find(a=>a.bsThrough)?.bsThrough;
 if(!po.journals)return po.partyBS?`取引先別の期首と残高は、取引先内訳つきBSの値です（${esc(bsThrough||'—')}末時点）。当期の仕訳帳が未読込のため、請求・入金の動きと、回収・支払が止まっていないかは表示していません。`:'当期の仕訳帳が未読込のため、取引先別の動きは表示できません。仕訳帳か、取引先内訳つきBS（表示するタグ：取引先）を読み込むと確認できます。';
 if(!po.through)return `当期の仕訳を期首月から連続して読めないため、取引先別の残高は仕訳から求めていません。${po.partyBS?'取引先内訳つきBSのある科目は、BSの値を表示します。':''}`;
 const asOf=esc(po.asOf||'—'),caveat='推定は参考値で、請求書・入金明細との消込の確認結果ではありません。';
 if(po.estimated&&po.partyBS)return `取引先別の期首を、取引先内訳つきBS（確定値）と過去の仕訳帳（推定）から求め、当期の仕訳で${asOf}まで繰り越しました。${caveat}`;
 if(po.estimated)return `過去の仕訳帳から取引先別の期首を推定し、当期の仕訳で${asOf}まで繰り越しました。${caveat}`;
 if(po.partyBS)return `取引先内訳つきBSの期首（確定値）を、当期の仕訳で${asOf}まで繰り越しました。どの請求に入金が当たるかは仕訳からの推測で、請求書・入金明細との消込の確認結果ではありません。`;
 return '過去の仕訳帳が未読込（または期首の前月まで続いていない）ため、取引先別の期首は推定していません。当期の請求・入金の動きだけを表示します。';
}
function noneText(po){
 const ja=po.accounts.filter(a=>a.mode==='journal');
 // 1社でも状態を判定できたときだけ「見つかりませんでした」と言う（判定できないのに見つからないとは言わない）
 if(ja.some(a=>a.parties.some(p=>!p.untagged&&p.status!=='unknown')))return '回収・支払が止まっている可能性のある取引先は見つかりませんでした。';
 // 仕訳がないときは見出しの説明で足りる（同じことを2度書かない）
 if(!ja.length)return po.journals?'当期の仕訳を期首月から連続して読めないため、回収・支払が止まっているかは判定していません。':'';
 const why=[ja.some(a=>a.parties.some(p=>p.opening===null))?'取引先別の期首が分からない':'',ja.some(a=>a.untaggedDominant)?'取引先が未選択の入金・支払が多い':''].filter(Boolean).join('、または')||'残高と状態を確定できない';
 return `${why}ため、回収・支払が止まっているかは判定できませんでした。`;
}
function panel(session,model){
 const po=model.partyOpening;if(!po)return '';
 view={id:'po'+(++viewSeq),seq:0,lazy:new Map(),lists:new Map(),state:stateOf(session)};
 const head=`<section class="panel monthly-panel po-panel" id="partyBalances" aria-labelledby="partyBalancesTitle"><div class="panelhead"><div><h2 id="partyBalancesTitle">取引先別の残高と回収・支払の状況</h2>`;
 if(po.error)return `${head}</div></div><div class="panelbody"><div class="notice">取引先別の期首を推定する途中でエラーが起きたため、この欄は表示できません（${esc(po.error)}）。他の欄の数値には影響しません。</div></div></section>`;
 const accounts=po.accounts||[];if(!accounts.length)return '';
 const alerts=po.alerts||[],st=view.state,many=accounts.some(a=>baseParties(a).length>8);
 return `${head}<span class="small">${lead(po)}</span></div><div class="po-actions"><button type="button" class="btn small" data-po-export="1">取引先別の残高CSV</button></div></div><div class="panelbody">
 ${alerts.length?`<div class="po-alerts"><h3>回収・支払が止まっている可能性のある取引先</h3><div class="po-cards">${alerts.slice(0,8).map(x=>`<article class="po-card po-${x.status}"><div class="po-cardtop"><span class="badge ${BADGE[x.status]||''}">${esc(x.statusLabel)}</span><span class="small">${esc(x.account)}</span></div><strong>${esc(x.label)}</strong><span class="po-cardamt">${num(x.amount)}円</span><span class="small">ふだんより長く残っている分${x.items>1?`（${x.items}件）`:''}・残高 ${num(x.balance)}円</span><p class="small">${esc(x.text.replace(/^[^：]*：/,''))}</p></article>`).join('')}</div>${alerts.length>8?`<p class="small">ほか${alerts.length-8}件は下の表で確認できます。</p>`:''}</div>`:noneText(po)?`<p class="small po-none">${noneText(po)}</p>`:''}
 ${(po.notes||[]).filter(n=>!/^推定は/.test(n)).map(n=>`<div class="notice">${esc(n)}</div>`).join('')}
 <div class="po-tools"><label class="po-search">取引先を検索<input type="search" data-po-query="1" value="${esc(st.query)}" placeholder="会社名・氏名" autocomplete="off"></label><label class="po-zero"><input type="checkbox" data-po-zero="1"${st.hideZero?' checked':''}> 残高0の取引先を隠す</label>${many?'<span class="small">表は科目ごとに25社ずつ表示します。全社の一覧は「取引先別の残高CSV」に保存できます。</span>':''}</div>
 ${accounts.map(accountHTML).join('')}
 ${po.journals?`<details class="po-method"><summary>推定のしかた</summary><ol class="small"><li>期首の前月末から過去へ、仕訳を連続して読める月（読取エラー・資料間の重複・参照除外のない月）だけを使います。</li><li>同じ仕訳の同じ取引先・同じ向きの行は1件にまとめ、取引先ごとに日付順で、増えた分（請求・仕入）を積み、減った分（入金・支払）を同じ金額の請求・仕入（または続いた請求・仕入の合計が一致するもの）、なければ古いものから消し込みます。</li><li>読込範囲の始め（3か月）で、消し込む相手のない減少や、残っている請求が後で同じ金額で入金されている減少は、それより前からの残高の回収・支払とみなします（それ以上はないとした最小額）。読込範囲の途中で初めて出てくる取引先の減少も同じとみなします（90日以内にそれを上回る請求・仕入が続けば前受・前払）。それ以外で相手のない減少は、前受・過入金（マイナスの残高）として扱います。</li><li>取引先が未選択の減少は、同じ金額の未消込が1社だけにあればその取引先に当てます（候補）。</li><li>推定の合計をBSの期首と比べ、差は「内訳不明」に残し、取引先には配分しません。合計の一致は取引先別の内訳の証明ではありません。</li><li>取引先内訳つきのBS（当期・前期）がある取引先は、その確定値を期首として当期の仕訳で繰り越します。</li><li>状態は、いちばん古い未消込の経過日数を、その取引先のふだんの回収・支払日数（なければ60日）と比べて判定します。180日を超えるものは長期としています。</li></ol></details>`:''}
 </div></section>`;
}
// 取引先別の残高CSV（全取引先・検索や非表示にかかわらず）。表計算ソフトで式として動かないよう、= + - @ などで始まる文字は ' を付ける。
function csv(model){
 const po=model?.partyOpening||{},cell=v=>{if(typeof v==='number'&&Number.isFinite(v))return String(v);const s=v==null?'':String(v),safe=/^[=+\-@\t\r]/.test(s)?"'"+s:s;return '"'+safe.replace(/"/g,'""')+'"';};
 const out=[['科目','区分','取引先','状態','期首（円）','期首の根拠','当期の増加（円）','当期の減少（円）','残高（円）','残高の時点','いちばん古い未回収・未払','経過日数','ふだんの回収・支払日数','確認事項']];
 for(const a of po.accounts||[]){
  const asOf=a.mode==='bs'?(a.bsThrough||'')+'末（BS内訳）':a.asOf||'',kind=a.kind==='receipt'?'回収':'支払';
  for(const p of a.parties)out.push([a.account,kind,p.label,p.statusLabel,p.opening,p.openingBasis==='exact'?'確定（BS内訳）':p.openingBasis==='estimate'?'推定（過去の仕訳）':'不明',p.increase,p.decrease,p.closing,asOf,p.oldestPreWindow?(a.window.start||'')+'より前':p.oldestDate||'',p.oldestAge,Number.isFinite(p.lagMedian)?Math.round(p.lagMedian):null,(p.reasons||[]).join(' ')]);
  if(finite(a.residual)&&a.residual!==0)out.push([a.account,kind,'内訳不明（BSの期首との差）','',a.residual,'BSの期首との差',null,null,a.residual,asOf,'',null,null,'取引先に配分できない期首の残りです。']);
 }
 return '﻿'+out.map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
}
F.page=function(session,result,focus){
 const html=originalPage.call(this,session,result,focus),model=result?.financial;current=model?{session,model}:null;if(!model)return html;
 const add=panel(session,model);if(!add)return html;
 const marker='<section class="panel monthly-panel" id="vtChanges"',at=html.indexOf(marker);
 if(at>=0)return html.slice(0,at)+add+html.slice(at);
 const t=html.indexOf('id="treasuryReview"'),after=t<0?-1:html.indexOf('</section>',t);
 return after<0?html+add:html.slice(0,after+10)+add+html.slice(after+10);
};
function hydrate(d){
 const e=view?.lazy.get(d.dataset.poLazy);if(!d.open||!e||e.loaded)return;
 const c=[...d.children].find(x=>x.hasAttribute('data-po-content'));if(!c)return;e.loaded=true;c.innerHTML=e.render();
}
// 表を作り直す（検索・ページ送り・印刷）。中の登録を消し、開いていた「内訳と根拠」は開いたままにする。
function redraw(el){
 const fn=view?.lists.get(el.dataset.poList);if(!fn||!el.isConnected)return;
 const open=new Set([...el.querySelectorAll('details[data-po-key][open]')].map(d=>d.dataset.poKey));
 for(const x of el.querySelectorAll('[data-po-lazy]'))view.lazy.delete(x.dataset.poLazy);
 for(const x of el.querySelectorAll('[data-po-list]'))view.lists.delete(x.dataset.poList);
 el.innerHTML=fn();
 for(const d of el.querySelectorAll('details[data-po-key]'))if(open.has(d.dataset.poKey)){d.open=true;hydrate(d);}
}
const tables=()=>[...document.querySelectorAll('#partyBalances .po-account>[data-po-list]')];
function refresh(){view.state.pages.clear();for(const el of tables())redraw(el);}
function download(){
 if(!current)return;const p=current.session.project||{},blob=new Blob([csv(current.model)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='取引先別残高_'+(p.start||'')+'_'+(p.end||'')+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
if(typeof document!=='undefined'){
 document.addEventListener('toggle',e=>{if(e.target.matches?.('details[data-po-lazy]'))hydrate(e.target);},true);
 // 日本語入力の変換中は絞り込まない（確定してから）
 document.addEventListener('compositionstart',e=>{if(e.target.matches?.('[data-po-query]')){composing=e.target;clearTimeout(queryTimer);}});
 document.addEventListener('compositionend',e=>{if(e.target.matches?.('[data-po-query]')&&view){composing=null;view.state.query=e.target.value;refresh();}});
 document.addEventListener('input',e=>{if(!e.target.matches?.('[data-po-query]')||!view||e.isComposing||composing===e.target)return;view.state.query=e.target.value;clearTimeout(queryTimer);queryTimer=setTimeout(()=>{if(!composing)refresh();},120);});
 document.addEventListener('change',e=>{if(e.target.matches?.('[data-po-zero]')&&view){view.state.hideZero=e.target.checked;refresh();}});
 document.addEventListener('click',e=>{
  const b=e.target.closest?.('[data-po-page],[data-po-export]');if(!b||!view)return;
  if(b.dataset.poExport){download();return;}
  const st=view.state,map=b.dataset.poPage==='ev'?st.evPages:st.pages,key=b.dataset.poPkey,step=Number(b.dataset.poStep)||0,el=b.closest('[data-po-list]');if(!el)return;
  map.set(key,Math.max(0,(map.get(key)||0)+step));redraw(el);
  const btns=[...el.querySelectorAll(`[data-po-page="${b.dataset.poPage}"]`)].filter(x=>x.closest('[data-po-list]')===el);(btns.find(x=>x.dataset.poStep===String(step)&&!x.disabled)||btns.find(x=>!x.disabled))?.focus({preventScroll:true});
 });
 // 印刷では、絞り込みはそのままで全件を出す（ページ分けしない）。終われば表示中のページに戻す。
 const printMode=on=>{if(!view||on===printing||on&&document.documentElement.classList.contains('printing-stmt')||!document.getElementById('partyBalances'))return;printing=on;for(const el of tables())redraw(el);};
 root.addEventListener?.('beforeprint',()=>printMode(true));root.addEventListener?.('afterprint',()=>printMode(false));
}
root.ReviewPartyOpeningUI={panel,csv,version:2};
})(typeof window!=='undefined'?window:globalThis);

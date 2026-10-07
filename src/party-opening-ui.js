(function(root){
'use strict';
// 月次PL・BS画面の「取引先別の残高と回収・支払の状況」。計算は ReviewPartyOpening が持ち、ここは表示だけ。
// 資金の動きの欄のすぐ後ろに置く。推定は確定値（取引先内訳つきBS）と区別して表示する。
const F=root.ReviewFinancial,PO=root.ReviewPartyOpening;
if(!F||!PO||typeof F.page!=='function')throw Error('ReviewPartyOpeningUI requires the monthly page and ReviewPartyOpening.');
const originalPage=F.page,finite=Number.isSafeInteger,nf=new Intl.NumberFormat('ja-JP');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>finite(v)?nf.format(v===0?0:v):'—';
const yen=v=>`<span class="ts-money${finite(v)&&v<0?' ts-negative':''}">${num(v)}</span>`;
const months=d=>Number.isFinite(d)?d<45?`${d}日`:`約${Math.round(d/30)}か月`:'—';
const BADGE={long:'red',late:'warn',credit:'warn',normal:'',settled:'ok',unknown:''};
const CONF={'高':'ok','中':'warn','低':''};
function itemText(i,w){return `${i.preWindow?'読込範囲より前の'+w.inc:i.exactAdjust?'期首時点の残高（BS内訳）':esc(i.date)+'の'+w.inc} ${num(i.amount)}円`;}
function partyRow(a,p){
 const w=a.words,open=(p.openItems||[]).filter(i=>i.amount>0);
 const basis=p.openingBasis==='exact'?'<span class="badge ok" title="取引先内訳つきBSの確定値">確定</span>':p.openingBasis==='estimate'?'<span class="badge" title="過去の仕訳からの推定">推定</span>':'';
 const oldest=p.oldestPreWindow?`<span class="po-old">${esc(a.window.start)}より前</span>`:p.oldestDate?`${esc(p.oldestDate)}<p class="small">経過 ${months(p.oldestAge)}</p>`:'—';
 const why=[...(p.reasons||[])];
 return `<tr class="po-row po-${p.status}${p.untagged?' po-untagged':''}"><th scope="row"><strong>${esc(p.label)}</strong>${p.major?`<span class="badge po-major" title="当期の${w.inc}の多い取引先">主要 ${Math.round(p.share*100)}%</span>`:''}</th><td data-label="状態"><span class="badge ${BADGE[p.status]||''}">${esc(p.statusLabel)}</span></td><td class="num" data-label="期首（円）">${yen(p.opening)} ${basis}</td><td class="num" data-label="当期の${w.inc}">${yen(p.increase)}</td><td class="num" data-label="当期の${w.dec}">${yen(p.decrease)}</td><td class="num" data-label="残高（円）"><strong>${yen(p.closing)}</strong>${Number.isFinite(p.daysOfVolume)?`<p class="small">${w.inc}の約${p.daysOfVolume}日分</p>`:''}</td><td data-label="いちばん古い${w.open}">${oldest}</td><td class="num" data-label="ふだんの${w.act}日数">${Number.isFinite(p.lagMedian)?Math.round(p.lagMedian)+'日':'—'}${p.lagSamples?`<p class="small">${p.lagSamples}件から</p>`:''}</td><td class="po-wide"><details class="po-why"><summary>内訳と根拠</summary>${p.closing===null?`<p class="small">期首が分からないため、${w.open}の内訳は出せません。</p>`:open.length?`<p class="small">${esc(a.asOf)}時点の${w.open}（古い順）</p><ul>${open.slice(0,12).map(i=>`<li>${itemText(i,w)}</li>`).join('')}${open.length>12?`<li>ほか${open.length-12}件</li>`:''}</ul>`:`<p class="small">${esc(a.asOf)}時点の${w.open}はありません。</p>`}${(p.openItemsAtOpening||[]).filter(i=>i.amount>0).length?`<p class="small">期首（${esc(a.window.end)}末）の内訳：${p.openItemsAtOpening.filter(i=>i.amount>0).map(i=>itemText(i,w)).join('、')}</p>`:''}${why.map(t=>`<p class="small">${esc(t)}</p>`).join('')}${root.ReviewTreasuryUI?.evidenceHTML?root.ReviewTreasuryUI.evidenceHTML(p.rows.slice(-30)):''}</details></td></tr>`;
}
function accountHTML(a){
 const w=a.words,parties=a.parties.filter(p=>!(p.untagged&&!p.opening&&!p.closing&&!p.increase&&!p.decrease));
 const residualRow=finite(a.residual)&&a.residual!==0?`<tr class="po-residual"><th scope="row">内訳不明（BSの期首との差）</th><td></td><td class="num" data-label="期首（円）">${yen(a.residual)}</td><td></td><td></td><td class="num" data-label="残高（円）">${yen(a.residual)}</td><td colspan="3" class="po-wide"><p class="small">取引先に配分できない期首の残りです。当期の${w.dec}で減ったかどうかは分かりません。</p></td></tr>`:'';
 // 期首（残高）が分からない取引先が1社でもあれば、合計は出さない（0円として足さない）
 const sum=f=>parties.some(p=>f(p)===null)?null:parties.reduce((n,p)=>n+(f(p)||0),0)+(finite(a.residual)?a.residual:0);
 const DIFF={matched:'一致',unexplained:'推定が少ない',over:'推定が多い'};
 const source=a.openingSource==='unknown'?'未読込':a.openingSource==='conflict'?'確定できません':a.openingSource;
 const closingNote=!finite(a.closingTotal)?'照合できません（取引先別の期首が不明）':!finite(a.closingResidual)?'照合できません':a.closingResidual!==0?'取引先別の残高の合計との差 '+num(a.closingResidual)+'円':'取引先別の残高の合計と一致';
 return `<article class="po-account"><header class="po-head"><div><h3>${esc(a.account)} <span class="small">${a.kind==='receipt'?'回収を確認':'支払を確認'}</span></h3><p class="small">期首 ${esc(a.window.end||'—')}末 ／ 残高 ${esc(a.asOf||'—')}時点（当期の仕訳を連続して読めた月まで）</p></div><span class="badge ${CONF[a.confidence]||''}" title="推定の確からしさ">推定の確からしさ ${a.confidence}</span></header>
 <div class="po-recon"><div><span>BSの期首</span><strong>${yen(a.reportedOpening)}</strong><small>${esc(source)}</small></div><div><span>取引先別の期首の合計</span><strong>${yen(a.estimatedTotal)}</strong><small>過去の仕訳 ${esc(a.window.start||'—')}〜${esc(a.window.end||'—')}（${a.window.months}か月）${a.exactCount?`・確定値 ${a.exactCount}社`:''}</small></div><div><span>差（内訳不明）</span><strong>${yen(a.residual)}</strong><small>${DIFF[a.status]||(finite(a.residual)?'参考（状態は判定しません）':'照合できません')}</small></div>${finite(a.reportedClosing)?`<div><span>BSの残高（${esc(a.through||'')}）</span><strong>${yen(a.reportedClosing)}</strong><small>${esc(closingNote)}</small></div>`:''}</div>
 <p class="small po-status">${esc(a.statusText)}</p>${a.heldText?`<p class="small po-status">${esc(a.heldText)}</p>`:''}
 ${parties.length?`<div class="tablewrap"><table class="datatable po-table"><thead><tr><th scope="col">取引先</th><th scope="col">状態</th><th scope="col" class="num">期首（円）</th><th scope="col" class="num">当期の${w.inc}</th><th scope="col" class="num">当期の${w.dec}</th><th scope="col" class="num">残高（円）</th><th scope="col">いちばん古い${w.open}</th><th scope="col" class="num">ふだんの${a.kind==='receipt'?'回収':'支払'}日数</th><th scope="col">内訳・根拠</th></tr></thead><tbody>${parties.map(p=>partyRow(a,p)).join('')}${residualRow}<tr class="ts-subtotal"><th scope="row">合計</th><td></td><td class="num" data-label="期首（円）">${yen(sum(p=>p.opening))}</td><td class="num" data-label="当期の${w.inc}">${yen(parties.reduce((n,p)=>n+p.increase,0))}</td><td class="num" data-label="当期の${w.dec}">${yen(parties.reduce((n,p)=>n+p.decrease,0))}</td><td class="num" data-label="残高（円）">${yen(sum(p=>p.closing))}</td><td colspan="3"></td></tr></tbody></table></div>`:'<p class="small">この科目の仕訳がありません。</p>'}
 ${a.matches.length?`<details class="po-matches"><summary>取引先が未選択の${w.dec}を、金額の一致で取引先に当てたもの（${a.matches.length}件）</summary><ul>${a.matches.map(m=>`<li>${esc(m.date)} ${num(m.amount)}円 → ${esc(m.label)}（${esc(m.itemDate)}の${w.inc}と同額）</li>`).join('')}</ul><p class="small">金額の一致だけで当てた候補です。freeeで取引先を付け直すと、この推定は確定に近づきます。</p></details>`:''}
 </article>`;
}
function panel(session,model){
 const po=model.partyOpening;if(!po)return '';
 const head=`<section class="panel monthly-panel po-panel" id="partyBalances" aria-labelledby="partyBalancesTitle"><div class="panelhead"><div><h2 id="partyBalancesTitle">取引先別の残高と回収・支払の状況</h2>`;
 if(po.error)return `${head}</div></div><div class="panelbody"><div class="notice">取引先別の期首を推定する途中でエラーが起きたため、この欄は表示できません（${esc(po.error)}）。他の欄の数値には影響しません。</div></div></section>`;
 const accounts=po.accounts||[];if(!accounts.length)return '';
 const alerts=po.alerts||[];
 // 1社でも状態を判定できたときだけ「見つかりませんでした」と言う（判定できないのに見つからないとは言わない）
 const judged=accounts.some(a=>a.parties.some(p=>!p.untagged&&p.status!=='unknown'));
 return `${head}<span class="small">${accounts.some(a=>a.window.start||a.exactCount)?`過去の仕訳帳（または取引先内訳つきBS）から取引先別の期首を求め、当期の仕訳で${esc(po.asOf||'—')}まで繰り越しました。推定は参考値で、請求書・入金明細との消込の確認結果ではありません。`:'過去の仕訳帳が未読込（または期首の前月まで続いていない）ため、取引先別の期首は推定していません。当期の請求・入金の動きだけを表示します。'}</span></div></div><div class="panelbody">
 ${alerts.length?`<div class="po-alerts"><h3>回収・支払が止まっている可能性のある取引先</h3><div class="po-cards">${alerts.slice(0,8).map(x=>`<article class="po-card po-${x.status}"><div class="po-cardtop"><span class="badge ${BADGE[x.status]||''}">${esc(x.statusLabel)}</span><span class="small">${esc(x.account)}</span></div><strong>${esc(x.label)}</strong><span class="po-cardamt">${num(x.amount)}円</span><span class="small">ふだんより長く残っている分${x.items>1?`（${x.items}件）`:''}・残高 ${num(x.balance)}円</span><p class="small">${esc(x.text.replace(/^[^：]*：/,''))}</p></article>`).join('')}</div>${alerts.length>8?`<p class="small">ほか${alerts.length-8}件は下の表で確認できます。</p>`:''}</div>`:`<p class="small po-none">${judged?'回収・支払が止まっている可能性のある取引先は見つかりませんでした。':'取引先別の期首が分からない、または取引先が未選択の入金・支払が多いため、回収・支払が止まっているかは判定できませんでした。'}</p>`}
 ${po.notes.filter(n=>!/^推定は/.test(n)).map(n=>`<div class="notice">${esc(n)}</div>`).join('')}
 ${accounts.map(accountHTML).join('')}
 <details class="po-method"><summary>推定のしかた</summary><ol class="small"><li>期首の前月末から過去へ、仕訳を連続して読める月（読取エラー・資料間の重複・参照除外のない月）だけを使います。</li><li>同じ仕訳の同じ取引先・同じ向きの行は1件にまとめ、取引先ごとに日付順で、増えた分（請求・仕入）を積み、減った分（入金・支払）を同じ金額の請求・仕入（または続いた請求・仕入の合計が一致するもの）、なければ古いものから消し込みます。</li><li>読込範囲の始め（3か月）で、消し込む相手のない減少や、残っている請求が後で同じ金額で入金されている減少は、それより前からの残高の回収・支払とみなします（それ以上はないとした最小額）。読込範囲の途中で初めて出てくる取引先の減少も同じとみなします（90日以内にそれを上回る請求・仕入が続けば前受・前払）。それ以外で相手のない減少は、前受・過入金（マイナスの残高）として扱います。</li><li>取引先が未選択の減少は、同じ金額の未消込が1社だけにあればその取引先に当てます（候補）。</li><li>推定の合計をBSの期首と比べ、差は「内訳不明」に残し、取引先には配分しません。合計の一致は取引先別の内訳の証明ではありません。</li><li>取引先内訳つきのBS（当期・前期）がある取引先は、その確定値を期首として当期の仕訳で繰り越します。</li><li>状態は、いちばん古い未消込の経過日数を、その取引先のふだんの回収・支払日数（なければ60日）と比べて判定します。180日を超えるものは長期としています。</li></ol></details>
 </div></section>`;
}
F.page=function(session,result,focus){
 const html=originalPage.call(this,session,result,focus),model=result?.financial;if(!model)return html;
 const add=panel(session,model);if(!add)return html;
 const marker='<section class="panel monthly-panel" id="vtChanges"',at=html.indexOf(marker);
 if(at>=0)return html.slice(0,at)+add+html.slice(at);
 const t=html.indexOf('id="treasuryReview"'),after=t<0?-1:html.indexOf('</section>',t);
 return after<0?html+add:html.slice(0,after+10)+add+html.slice(after+10);
};
root.ReviewPartyOpeningUI={panel,version:1};
})(typeof window!=='undefined'?window:globalThis);

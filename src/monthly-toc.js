(function(root){
'use strict';
// 月次PL・BS画面の目次。画面の上（メニューの下）に固定し、押すとその欄へ移動する。
// 欄は見出しの文字で探す。▶の開閉などで欄が描き直されても、目次の行き先は変わらない。
const F=root.ReviewFinancial;
if(!F||typeof F.page!=='function')throw Error('ReviewMonthlyToc requires the monthly page.');
const originalPage=F.page,esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// 見出し → 目次での短い名前（スマホで1行に収めるため）。載っていない見出しはそのまま使う。
const SHORT={'対応の順番':'対応順','取引先・品目・部門別の帳票':'タグ別帳票','資料の読込範囲と数値照合':'数値照合','資金の動きと、回収・支払の残り':'資金・回収','取引先別の残高と回収・支払の状況':'取引先別の残高','大きく動いた科目と理由':'大きな変動','今見るべき科目':'確認候補','月次PL':'月次PL','月次BS':'月次BS','売掛金の残高と増減':'売掛金','帳票と仕訳の照合':'帳票照合','取り込む資料':'資料'};
// 正式な名前が入りきらない広さの画面で使う、少し短い名前
const MID={'対応の順番':'対応の順番','取引先・品目・部門別の帳票':'タグ別の帳票','資料の読込範囲と数値照合':'読込範囲と数値照合','資金の動きと、回収・支払の残り':'資金の動きと回収・支払','取引先別の残高と回収・支払の状況':'取引先別の残高','大きく動いた科目と理由':'大きく動いた科目','売掛金の残高と増減':'売掛金の残高'};
const plain=s=>String(s).replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
// 描画済みのHTMLから、月次の欄（section.monthly-panel）の見出しを順に拾う
function entries(html){
 const out=[],seen=new Set(),re=/<section class="panel monthly-panel[^"]*"[^>]*>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/g;let m;
 while((m=re.exec(html))){const title=plain(m[1]);if(!title||seen.has(title))continue;seen.add(title);out.push({title,mid:MID[title]||title,short:SHORT[title]||title});}
 return out;
}
function nav(list){
 if(list.length<2)return '';
 return `<nav class="mtoc" id="monthlyToc" aria-label="月次PL・BSの目次"><span class="mtoc-label" aria-hidden="true">目次</span><ol class="mtoc-list">${list.map((e,i)=>`<li><button type="button" class="mtoc-link" data-mtoc="${i}" data-mtoc-title="${esc(e.title)}" title="${esc(e.title)}へ移動"><span class="mtoc-full">${esc(e.title)}</span><span class="mtoc-mid" aria-hidden="true">${esc(e.mid)}</span><span class="mtoc-short" aria-hidden="true">${esc(e.short)}</span></button></li>`).join('')}</ol><button type="button" class="mtoc-top" data-mtoc-top="1" title="ページの先頭へ" aria-label="ページの先頭へ">▲</button></nav>`;
}
F.page=function(session,result,focus){
 const html=originalPage.call(this,session,result,focus);
 if(!result?.financial)return html;
 root.queueMicrotask?.(arm);
 return nav(entries(html))+html;
};
// ---- 移動と、いま見ている欄の表示
const doc=typeof document!=='undefined'?document:null;
function headerHeight(){const n=doc.querySelector('nav.nav');return n?Math.ceil(n.getBoundingClientRect().height):0;}
function tocHeight(){const t=doc.getElementById('monthlyToc');return t?Math.ceil(t.getBoundingClientRect().height):0;}
function sections(){return [...doc.querySelectorAll('section.monthly-panel')].map(s=>({s,title:plain(s.querySelector('h2')?.textContent||'')}));}
function find(title){return sections().find(x=>x.title===title)?.s||null;}
function offset(){return headerHeight()+tocHeight()+10;}
// 目次で押した欄。自分でスクロールするまでは、ページの最後に着いてもこの欄を「いま見ている欄」にする
let pinned=null;
function jump(title){
 const target=find(title);if(!target)return;pinned=title;
 const reduce=root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 root.scrollTo({top:Math.max(0,target.getBoundingClientRect().top+root.scrollY-offset()),behavior:reduce?'auto':'smooth'});
 const h=target.querySelector('h2');if(h){h.setAttribute('tabindex','-1');h.focus({preventScroll:true});}
 mark(title);
}
function mark(title){
 const toc=doc.getElementById('monthlyToc');if(!toc)return;
 for(const b of toc.querySelectorAll('.mtoc-link')){const on=b.dataset.mtocTitle===title;b.classList.toggle('current',on);if(on){b.setAttribute('aria-current','location');const list=toc.querySelector('.mtoc-list'),r=b.getBoundingClientRect(),lr=list.getBoundingClientRect();if(r.left<lr.left||r.right>lr.right)list.scrollTo({left:b.offsetLeft-list.clientWidth/2+b.clientWidth/2,behavior:'auto'});}else b.removeAttribute('aria-current');}
}
let ticking=false;
function spy(){
 ticking=false;const toc=doc.getElementById('monthlyToc');if(!toc)return;
 toc.style.setProperty('--mtoc-top',headerHeight()+'px');
 const line=offset()+40;let current=null;
 const all=sections();for(const x of all){if(x.s.getBoundingClientRect().top<=line)current=x.title;else break;}
 const pin=pinned&&all.find(x=>x.title===pinned);
 if(pin){const r=pin.s.getBoundingClientRect();if(r.top<root.innerHeight&&r.bottom>offset())current=pinned;}
 // ページの最後まで来たら、最後の欄を「いま見ている欄」にする（目次で押した欄が見えている間は除く）
 else if(root.innerHeight+root.scrollY>=doc.documentElement.scrollHeight-2&&all.length)current=all.at(-1).title;
 const titles=[...toc.querySelectorAll('.mtoc-link')].map(b=>b.dataset.mtocTitle);
 mark(titles.includes(current)?current:null);
}
// 正式な名前が入りきらなければ少し短い名前、それでも入らなければ短い名前にする（隠れた項目を横スクロールで探させない）
function fit(toc){const list=toc.querySelector('.mtoc-list');if(!list)return;const over=()=>list.scrollWidth>list.clientWidth+1;toc.classList.remove('mid','compact');if(!over())return;toc.classList.add('mid');if(!over())return;toc.classList.replace('mid','compact');}
function arm(){if(!doc)return;const toc=doc.getElementById('monthlyToc');if(toc){fit(toc);toc.style.setProperty('--mtoc-top',headerHeight()+'px');doc.documentElement.style.setProperty('--mtoc-offset',offset()+'px');spy();}}
if(doc){
 doc.addEventListener('click',e=>{
  const b=e.target.closest?.('#monthlyToc button');if(!b)return;
  if(b.dataset.mtocTop){root.scrollTo({top:0,behavior:root.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});return;}
  if(b.dataset.mtocTitle)jump(b.dataset.mtocTitle);
 });
 // 自分で操作したら、目次で押した欄の固定をやめる
 for(const t of ['wheel','touchmove','keydown','mousedown'])root.addEventListener(t,e=>{if(!e.target?.closest?.('#monthlyToc'))pinned=null;},{passive:true});
 root.addEventListener('scroll',()=>{if(!ticking){ticking=true;root.requestAnimationFrame(spy);}},{passive:true});
 root.addEventListener('resize',()=>{if(!ticking){ticking=true;root.requestAnimationFrame(()=>{arm();ticking=false;});}});
}
root.ReviewMonthlyToc={entries,nav,jump,version:1};
})(typeof window!=='undefined'?window:globalThis);

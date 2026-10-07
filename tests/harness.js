// 配布ファイル（dist）の判定エンジン・月次モジュールを Node で読み込み、
// tests/fixtures の freee 形式CSVからセッションを組み立てる。
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.join(__dirname,'..');
function scripts(html){return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);}
// 既定では dist の配布ファイル（build.py の出力）から、画面以外のモジュールと月次画面を読み込む。
const DIST=path.join(ROOT,'dist','自計化レビュー_v3.7.html');
function load(htmlPath=DIST){
 const ctx={console,Intl,Date,Math,JSON,Map,Set,WeakMap,WeakSet,Promise,TextDecoder,setTimeout,clearTimeout,Number,String,Array,Object,Error,RegExp,Symbol};ctx.globalThis=ctx;vm.createContext(ctx);
 const html=fs.readFileSync(htmlPath,'utf8');
 for(const src of scripts(html)){
  if(src.startsWith('window.__KUBUN_SRC')||/window\.LedgerApp\s*=|KubunHost/.test(src))continue;
  if(!/root\.Review\w+\s*=|F\.page=page/.test(src)||/root\.Review(Scroll|Motion)=/.test(src))continue;
  vm.runInContext(src,ctx,{filename:path.basename(htmlPath)});
 }
 return ctx;
}
function readCSV(ctx,file,type,project){
 const E=ctx.ReviewEngine,F=ctx.ReviewFinancial;
 const text=fs.readFileSync(file,'utf8'),rows=E.parseCSV(text),h=E.headerRow(rows,type,project),mapping=E.guessMapping(rows[h],type,project);
 const res=E.normalizeRows(rows,type,mapping,h,{project,unit:F.detectUnit(rows,h),basis:F.detectBasis(rows,h)});
 if(res.errors.length)throw Error(path.basename(file)+': '+JSON.stringify(res.errors.slice(0,3)));
 const name=path.basename(file),importSource='csv:'+E.hash(name);
 return res.items.map(r=>({...r,source:name,importSource,importErrors:0,...(type==='prior'?{historySource:'hsrc:'+E.hash(name)}:{})}));
}
function session(ctx,{pl=true,bs=true,prior=true}={}){
 const E=ctx.ReviewEngine,s=E.newSession(),fx=path.join(__dirname,'fixtures');
 Object.assign(s.project,{name:'やまだデザイン事務所（架空）',type:'individual',start:'2026-01',end:'2026-09',complete:true});
 s.financial.comparisonConfirmed=true;
 s.datasets.current=readCSV(ctx,path.join(fx,'journal-2026.csv'),'current',s.project);
 if(prior)s.datasets.prior=readCSV(ctx,path.join(fx,'journal-2025.csv'),'prior',s.project);
 if(pl)s.datasets.monthlyPL=readCSV(ctx,path.join(fx,'monthly-pl-2026.csv'),'monthlyPL',s.project);
 if(bs)s.datasets.monthlyBS=readCSV(ctx,path.join(fx,'monthly-bs-2026.csv'),'monthlyBS',s.project);
 s.imports=Object.keys(s.datasets).filter(k=>s.datasets[k].length).map(k=>({type:k,name:k,count:s.datasets[k].length,errors:0,at:'2026-10-06T00:00:00.000Z'}));
 return s;
}
module.exports={load,session,readCSV,ROOT};

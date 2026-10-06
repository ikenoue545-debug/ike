// 本体HTMLの判定エンジン（ReviewEngine など）と src/variance.js を Node で読み込み、
// tests/fixtures の freee 形式CSVからセッションを組み立てる。
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.join(__dirname,'..');
function scripts(html){return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);}
function load(htmlPath=path.join(ROOT,'base','jikeika-review-v3.0.html'),extra=[path.join(ROOT,'src','variance.js')]){
 const ctx={console,Intl,Date,Math,JSON,Map,Set,WeakMap,Promise,TextDecoder,setTimeout,clearTimeout};ctx.globalThis=ctx;vm.createContext(ctx);
 const html=fs.readFileSync(htmlPath,'utf8');
 const want=/root\.Review(Engine|Details|History|Financial|Insight)=/;
 for(const src of scripts(html))if(want.test(src)&&!/root\.ReviewVariance=/.test(src))vm.runInContext(src,ctx,{filename:'base.html'});
 for(const f of extra)vm.runInContext(fs.readFileSync(f,'utf8'),ctx,{filename:f});
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

const {chromium}=require('playwright');const fs=require('fs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
global.__ok=ok;global.__fails=()=>fails;
async function boot(browser,opts={}){
  const ctx=opts.ctx||await browser.newContext({viewport:{width:1100,height:800}});
  const p=await ctx.newPage();if(opts.onPage)opts.onPage(p);const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());
  await p.route('http://app.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="root"></div></body></html>'}));await p.goto('http://app.test/');
  await p.addScriptTag({content:fs.readFileSync(__dirname+'/tst-shim.js','utf8')});
  await p.addScriptTag({content:fs.readFileSync(__dirname+'/tst-fake.js','utf8')});
  if(opts.kv){await p.evaluate((kv)=>{window.__srv.kv=kv;},opts.kv);}
  if(opts.pageInit){await p.evaluate(opts.pageInit);}
  await p.evaluate((seed)=>{const S=window.__srv;
    if(seed.skipSeed)return;
    S.setCat('products',seed.products);S.setCat('settings',seed.settings);Object.entries(seed.cats||{}).forEach(([k,v])=>S.setCat(k,v));if(seed.primary)S.tables.company_members[0].is_primary_admin=true;
    window.__today=null;
  },{products:[{id:1700000000001,code:"R1",name:"Riz",type:"marchandise",price:100,costPrice:60,tva:0,account:"707",stock:10,seuil:2},{id:1700000000002,code:"C1",name:"Conseil",type:"service",price:500,tva:0,account:"706"}],settings:opts.settings||{},cats:opts.cats||{},primary:!!opts.primary,skipSeed:!!opts.kv});
  await p.addScriptTag({content:fs.readFileSync(process.env.APP_JS||(require('fs').existsSync(__dirname+'/../docs/app.min.js')?__dirname+'/../docs/app.min.js':__dirname+'/docs/app.min.js'),'utf8')});
  await p.waitForTimeout(2500);
  return {ctx,p,errs};
}
module.exports={boot};
if(require.main===module)(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const {p,errs}=await boot(b);
console.log('ERRS',errs.slice(0,3));console.log((await p.evaluate(()=>document.body.innerText)).slice(0,600));
await p.screenshot({path:'full1.png'});await b.close()})();

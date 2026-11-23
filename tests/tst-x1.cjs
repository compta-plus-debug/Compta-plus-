// v344 — exports Excel et Word des dossiers import-export : le module Office se charge à la demande (chunk « office »).
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');const fs=require('fs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const iso=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const jours=(n)=>{const d=new Date();d.setHours(12);d.setDate(d.getDate()+n);return iso(d)};
const init=new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var c=window.__srv.tables.companies[0];c.plan_tier='assisted';c.sectors=['import_export'];c.sectors_locked=true;})()");
const impex=[
 {type:'imp',id:'i1',number:'IMP-2026-001',supplier:'Acme Miami',country:'États-Unis',ref:'A-1',rate:130,date:jours(-3),status:'commande',etaDate:jours(10),portDate:'',docs:{},lines:[{id:'l1',desc:'Riz',productId:'',qty:100,unitUSD:2}],freightUSD:20,insuranceUSD:0,charges:[],payments:[],invoiceEntryId:'e1',invoiceHTG:28600}];
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const {p,errs}=await boot(b,{settings:{companyName:'Négoce Test',currency:'HTG'},primary:true,cats:{impex},pageInit:init});await p.waitForTimeout(1200);
await g(p,'ie-afaire-ouvrir').first().click();await p.waitForTimeout(400);
for (const [id,ext] of [['ie-imp-excel','xlsx'],['ie-imp-word','docx']]) {
  const n=await g(p,id).count(); ok(id+' présent',n===1,n);
  if(!n) continue;
  const [dl]=await Promise.all([p.waitForEvent('download',{timeout:20000}),g(p,id).click()]);
  const f='/tmp/x1-'+ext+'.'+ext; await dl.saveAs(f);
  const buf=fs.readFileSync(f);
  ok(id+' : fichier '+ext+' en archive ZIP valide', buf.slice(0,2).toString()==='PK' && buf.length>2000, buf.length);
  ok(id+' : nom de fichier '+ext, dl.suggestedFilename().endsWith('.'+ext), dl.suggestedFilename());
}
ok('aucune erreur JS (chargement à la demande compris)',errs.length===0,errs);
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

// v349 — export Word et Excel du journal des ventes (restauration) sur la période choisie.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');const fs=require('fs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const init=new Function("(function(){try{localStorage.clear()}catch(e){}var c=window.__srv.tables.companies[0];c.plan_tier='assisted';c.sectors=['restauration'];c.sectors_locked=true;})();");
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const {p,errs}=await boot(b,{settings:{companyName:'Chez Test',currency:'HTG'},primary:true,pageInit:init});
await p.getByText('Restauration',{exact:true}).last().click();await p.waitForTimeout(800);
await g(p,'resto-tab-rapports').click();await p.waitForTimeout(400);
for (const [id,ext] of [['resto-journal-excel','xlsx'],['resto-journal-word','docx']]) {
  const n=await g(p,id).count(); ok(id+' présent',n===1,n); if(!n) continue;
  const [dl]=await Promise.all([p.waitForEvent('download',{timeout:20000}).catch(()=>null),g(p,id).click()]);
  if(!dl){ ok(id+' : téléchargement déclenché',false,'aucun'); continue; }
  const f='/tmp/x4-'+ext+'.'+ext; await dl.saveAs(f); const buf=fs.readFileSync(f);
  ok(id+' : archive '+ext+' valide', buf.slice(0,2).toString()==='PK' && buf.length>2000, buf.length);
}
ok('aucune erreur JS',errs.length===0,errs);
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

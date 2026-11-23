// v352 — export Word et Excel du rapport de la période (bloc Services et prestations).
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');const fs=require('fs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const mk=(sec,role)=>new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors="+JSON.stringify(sec)+";S.tables.companies[0].sectors_locked=true;S.tables.company_members[0].role="+JSON.stringify(role)+";})()");
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const {p,errs}=await boot(b,{settings:{companyName:'Sécurité Plus',currency:'HTG',taxRate:10},primary:true,cats:{services:[]},pageInit:mk(['services'],'Administrateur')});
await p.waitForTimeout(1200);
await g(p,'sv-tab-prestations').click();await p.waitForTimeout(300);
await g(p,'sv-prest-nom').fill('Gardiennage de nuit');await g(p,'sv-prest-prix').fill('45000');await g(p,'sv-prest-ajouter').click();await p.waitForTimeout(300);
await g(p,'sv-tab-clients').click();await p.waitForTimeout(300);
await g(p,'sv-client-nom').fill('Résidence Les Palmes');await g(p,'sv-client-ajouter').click();await p.waitForTimeout(300);
await g(p,'sv-tab-ventes').click();await p.waitForTimeout(300);
await g(p,'sv-ligne-prest').first().selectOption({index:1});await g(p,'sv-ligne-qte').first().fill('2');await p.waitForTimeout(200);
await g(p,'sv-vente-enregistrer').click();await p.waitForTimeout(450);
await g(p,'sv-apercu-fermer').click();await p.waitForTimeout(300);
await g(p,'sv-tab-rapports').click();await p.waitForTimeout(400);
for (const [id,ext] of [['sv-rap-excel','xlsx'],['sv-rap-word','docx']]) {
  ok(id+' présent',(await g(p,id).count())===1);
  const [dl]=await Promise.all([p.waitForEvent('download',{timeout:20000}).catch(()=>null),g(p,id).click()]);
  if(!dl){ok(id+' : téléchargement',false,'aucun');continue;}
  const f='/tmp/x8-'+ext+'.'+ext; await dl.saveAs(f); const buf=fs.readFileSync(f);
  ok(id+' : archive '+ext+' valide',buf.slice(0,2).toString()==='PK'&&buf.length>2000,buf.length);
}
ok('aucune erreur JS',errs.length===0,errs);
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

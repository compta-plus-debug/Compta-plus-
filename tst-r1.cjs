// Règles serveur (v228) : un refus de la base doit afficher un message clair, annuler la modification et ne pas déclencher d'alerte de connexion.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const idbKeys=(p)=>p.evaluate(()=>new Promise(r=>{const rq=indexedDB.open('compta-plus-offline-v1');rq.onsuccess=()=>{const g=rq.result.transaction('kv').objectStore('kv').getAllKeys();g.onsuccess=()=>r(g.result)};rq.onerror=()=>r([])}));
const supNames=(p)=>p.evaluate(()=>{const v=window.__srv.getCat('suppliers');return (v||[]).map(x=>x.name)});
const addSupplier=async(p,name)=>{await p.getByText('Achat et fournisseurs',{exact:true}).first().click();await p.waitForTimeout(400);await p.getByRole('button',{name:'Fournisseurs',exact:true}).first().click();await p.waitForTimeout(300);
 await p.locator('input').first().fill(name);await p.getByRole('button',{name:'Ajouter',exact:true}).first().click();await p.waitForTimeout(1800)};
const init=(refuse)=>()=>{try{localStorage.removeItem('compta-plus-active-tab')}catch(e){}};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const MSG="La période comptable est clôturée jusqu'au 2025-12-31 inclus : impossible d'enregistrer cette opération.";
// A) refus par la base
{const {p,errs}=await boot(b,{cats:{suppliers:[{id:'s1',name:'Alpha',contact:''}]},settings:{companyName:"Lakay SA",currency:"HTG"},primary:true,pageInit:init()});
 await p.evaluate((m)=>{window.__srv.ruleRefuse={'compta-suppliers':m}},MSG);
 await addSupplier(p,'Beta');
 const txt=await p.evaluate(()=>document.body.innerText);
 ok('A : message clair affiché',txt.includes("période comptable est clôturée")&&txt.includes("modification a été annulée"),txt.slice(0,300));
 ok('A : serveur inchangé',(await supNames(p)).join()==='Alpha');
 ok('A : modification retirée de l\'écran (Beta absent)',!/Beta/.test(txt));
 ok('A : aucune alerte « connexion interrompue »',!/connexion (est )?interrompue|non enregistr/i.test(txt),txt.slice(0,200));
 ok('A : rien en attente de renvoi',!(await idbKeys(p)).includes('pend:c1:suppliers'),await idbKeys(p));
 await p.waitForTimeout(22000);
 ok('A : toujours inchangé et sans alerte après 22 s',(await supNames(p)).join()==='Alpha'&&!/connexion (est )?interrompue/i.test(await p.evaluate(()=>document.body.innerText)),await supNames(p));
 ok('A : aucune erreur JS',errs.length===0,errs.slice(0,3));await p.close();}
// B) sans refus : enregistrement normal
{const {p,errs}=await boot(b,{cats:{suppliers:[{id:'s1',name:'Alpha',contact:''}]},settings:{companyName:"Lakay SA",currency:"HTG"},primary:true,pageInit:init()});
 await addSupplier(p,'Beta');
 ok('B : enregistré normalement',(await supNames(p)).join()==='Alpha,Beta',await supNames(p));
 ok('B : aucune erreur JS',errs.length===0,errs.slice(0,3));await p.close();}
await b.close();console.log(fails?'ECHECS '+fails:'OK');process.exit(fails?1:0)})();

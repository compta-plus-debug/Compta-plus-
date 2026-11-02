// v317 — Réinitialisation : les ventes hors ligne en attente sur l'appareil sont supprimées et ne reviennent pas.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const go=async(p)=>{await p.getByText('Administration',{exact:false}).first().click();await p.waitForTimeout(800);await p.getByRole('button',{name:/^Données/}).first().click();await p.waitForTimeout(500);
 await p.getByText('Réinitialiser…').last().click();await p.waitForTimeout(300);await p.getByText('Tout cocher (complète)').click();
 p.removeAllListeners('dialog');p.on('dialog',d=>{d.type()==='prompt'?d.accept('RÉINITIALISER'):d.accept()});
 await p.getByText(/Réinitialiser la sélection/).click();await p.waitForTimeout(16000)};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
 const {p}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,cats:{invoices:[{id:'i1',number:'F1',date:'2026-03-12',items:[],total:100}],entries:[]}});
 await p.waitForTimeout(1500);
 // vente hors ligne en attente (hors réseau : synchronisation impossible tant qu'elle n'est pas rejouée)
 await p.evaluate(()=>{localStorage.setItem('compta-plus-offline-sales-c1',JSON.stringify([{qid:'q1',invId:'old1',number:'HL-X-0001',provNumber:'HL-X-0001',numberReal:false,date:'2026-03-01',invoice:{id:'old1',number:'HL-X-0001',date:'2026-03-01',items:[],total:50},entries:[],stockLines:[],queuedAt:Date.now()-3600000}]))});
 await go(p);
 ok('file hors ligne vidée',await p.evaluate(()=>JSON.parse(localStorage.getItem('compta-plus-offline-sales-c1')||'[]').length)===0);
 await p.waitForTimeout(45000);
 const r=await p.evaluate(()=>({i:(window.__srv.getCat('invoices')||[]).map(x=>x.id),e:(window.__srv.getCat('entries')||[]).length}));
 ok('aucune facture ne revient',r.i.length===0&&r.e===0,r);
 // appareil resté périmé : file antérieure à la réinitialisation, elle est écartée à la synchronisation
 await p.evaluate(()=>{localStorage.setItem('compta-plus-offline-sales-c1',JSON.stringify([{qid:'q2',invId:'old2',number:'HL-X-0002',provNumber:'HL-X-0002',numberReal:false,date:'2026-03-01',invoice:{id:'old2',number:'HL-X-0002',date:'2026-03-01',items:[],total:50},entries:[],stockLines:[],queuedAt:Date.now()-7200000}]));window.dispatchEvent(new Event('compta-plus-ofl-change'))});
 await p.waitForTimeout(40000);
 const r2=await p.evaluate(()=>({q:JSON.parse(localStorage.getItem('compta-plus-offline-sales-c1')||'[]').length,i:(window.__srv.getCat('invoices')||[]).length}));
 ok('vente périmée écartée, rien sur le serveur',r2.q===0&&r2.i===0,r2);
 await b.close();console.log(fails?('ÉCHECS '+fails):'TOUT PASSE');process.exit(fails?1:0)})();

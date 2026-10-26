// v277 — assistant : contrôles propres aux blocs Éducation, Import-export, Santé.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const d=(n)=>{const x=new Date(Date.now()+n*86400000);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0')};
const ecole=[{type:'etab',id:'etab',kind:'ecole'},{type:'family',id:'f1',name:'Famille Joseph'},{type:'family',id:'f2',name:'Famille Paul'},
 {type:'fee',id:'fe1',label:'Scolarité',amount:1000,nb:1,firstDue:d(-100)},
 {type:'student',id:'s1',matricule:'M1',firstName:'Jean',lastName:'Joseph',familyId:'f1',status:'actif'},
 {type:'student',id:'s2',matricule:'M2',firstName:'Marie',lastName:'Paul',familyId:'f2',status:'actif'},
 {type:'charge',id:'s1:fe1:1',studentId:'s1',familyId:'f1',amount:1000,paid:0,dueDate:d(-100),status:'ok'}];
const impex=[{type:'imp',id:'i1',number:'IMP-1',supplier:'Acme',rate:130,date:d(-50),status:'port',portDate:d(-30),lines:[],payments:[],charges:[]},
 {type:'imp',id:'i2',number:'IMP-2',supplier:'Beta',rate:131,date:d(-80),status:'livre',invoiceEntryId:'e1',lines:[{qty:2,unitUSD:100}],freightUSD:0,insuranceUSD:0,payments:[{usd:50,status:'valide'}],charges:[]},
 {type:'exp',id:'x1',number:'EXP-1',customer:'Client',rate:130,date:d(-100),status:'livre',invoiceEntryId:'e2',lines:[{qty:1,unitUSD:300}],receipts:[{usd:100,status:'valide'}],costs:[]},
 {type:'imp',id:'i3',number:'IMP-3',supplier:'Gamma',rate:900,date:d(-5),status:'commande',lines:[],payments:[],charges:[]}];
const sante=[{type:'etab',id:'etab',kind:'cabinet'},{type:'insurer',id:'a1',name:'AssurPlus'},{type:'practitioner',id:'p1',name:'Dr Louis',share:50},
 {type:'invoice',id:'v1',number:'F1',date:d(-70),practitionerId:'p1',insurerId:'a1',insurerAmount:800,patientAmount:200,honoraires:400,status:'emise',payments:[],claims:[],adjusts:[]},
 {type:'lot',id:'l1',name:'Amoxicilline',lot:'A1',expiry:d(-10),qty:5},{type:'lot',id:'l2',name:'Paracétamol',lot:'B2',expiry:d(15),qty:9}];
const pageInit=(secteurs)=>new Function("(function(){try{localStorage.removeItem('compta-plus-active-tab')}catch(e){}var c=window.__srv.tables.companies[0];c.plan_tier='assisted';c.sectors="+JSON.stringify(secteurs)+";})();");
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p,errs}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,cats:{ecole,impex,sante},pageInit:pageInit(['ecoles','import_export','sante'])});
 await p.getByText('Comptabilité',{exact:false}).first().click();await p.waitForTimeout(700);
 await p.getByText(/Assistant de contrôle/).first().click();await p.waitForTimeout(700);
 const keys=await p.locator('[data-as="finding"]').evaluateAll(e=>e.map(x=>x.getAttribute('data-rule')));
 const need=['ecole-sansfrais','ecole-impaye','impex-port','impex-impaye','impex-recev','impex-taux','sante-assureur','sante-lot-perime','sante-lot-proche','sante-hono'];
 ok('A : les 10 contrôles apparaissent',need.every(r=>keys.includes(r)),keys);
 const n=await p.locator('[data-as="finding"]').count(),h=await p.locator('[data-as="howto"]').count();
 ok('A : un guide par constat',n===h,{n,h});
 const t=await p.evaluate(()=>document.body.innerText);
 ok('A : textes précis (famille, assureur, lot)',/Famille Joseph/.test(t)&&/AssurPlus/.test(t)&&/Amoxicilline/.test(t)&&/Dr Louis/.test(t),t.slice(0,200));
 ok('A : filtres Éducation / Import-export / Santé',await p.getByRole('button',{name:/Éducation/}).count()>0&&await p.getByRole('button',{name:/Import-export/}).count()>0&&await p.getByRole('button',{name:/Santé/}).count()>0);
 ok('A : aucune erreur JS',errs.length===0,errs.slice(0,3));await p.close();}
{const {p}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,cats:{ecole,impex,sante},pageInit:pageInit(['ecoles'])});
 await p.getByText('Comptabilité',{exact:false}).first().click();await p.waitForTimeout(700);
 await p.getByText(/Assistant de contrôle/).first().click();await p.waitForTimeout(700);
 const keys=await p.locator('[data-as="finding"]').evaluateAll(e=>e.map(x=>x.getAttribute('data-rule')));
 ok('B : bloc non actif = aucun contrôle (Éducation seulement)',keys.some(k=>k.startsWith('ecole'))&&!keys.some(k=>k.startsWith('impex')||k.startsWith('sante')),keys);await p.close();}
await b.close();console.log(fails?'ÉCHEC u27':'OK u27');process.exit(fails?1:0)})();

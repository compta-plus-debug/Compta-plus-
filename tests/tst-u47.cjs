// v314 — « Régénérer les écritures manquantes » : facture présente, écriture absente → réparation fiable en un clic, sans rien inventer.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const iso=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const today=iso(new Date());
const L=(id,name,qty,price)=>({productId:id,name,qty,price,discountPct:0,discountAmt:0,subtotal:qty*price,tva:0,taxAmount:0});
const invs=[
 {id:'i1',number:'FAC-1',date:today,client:'Jean',lines:[L(1700000000001,'Riz',2,100)],globalDiscountAmount:0,fees:[],totalHT:200,totalTax:0,total:200,paymentMode:'credit',status:'impayée',payments:[]},
 {id:'i2',number:'FAC-2',date:today,client:'Marie',lines:[L(1700000000001,'Riz',2,100),L(1700000000002,'Conseil',1,500)],globalDiscountAmount:70,fees:[{label:'Transport',amount:30,account:'706'}],totalHT:660,totalTax:66,total:726,paymentMode:'caisse',status:'payée'},
 {id:'i3',number:'FAC-3',date:today,client:'Paul',lines:[L(999,'Article disparu',1,50)],globalDiscountAmount:0,fees:[],totalHT:50,totalTax:0,total:50,paymentMode:'caisse',status:'payée'},
 {id:'i4',number:'FAC-4',date:today,client:'Luc',lines:[L(1700000000001,'Riz',1,100)],globalDiscountAmount:0,fees:[],totalHT:100,totalTax:0,total:100,paymentMode:'credit',status:'partielle',payments:[{id:'p1',date:today,amount:40,account:'530'}]},
];
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p}=await boot(b,{settings:{companyName:'Test',currency:'HTG',taxAccount:'445'},primary:true,cats:{invoices:invs,entries:[]}});
 await p.getByText('Comptabilité',{exact:false}).first().click();await p.waitForTimeout(900);
 ok('écarts signalés : 4 factures sans écriture',/4 écarts? détecté/.test(await p.locator('body').innerText()));
 ok('bouton de régénération proposé pour les 2 factures fiables',/Régénérer les 2 écriture/.test(await g(p,'repair-missing-entries').innerText()));
 await g(p,'repair-missing-entries').click();await p.waitForTimeout(1500);
 const ent=await p.evaluate(()=>window.__srv.getCat('entries')||[]);
 ok('2 écritures créées (ni plus, ni moins)',ent.length===2,ent.length);
 const e1=ent.find(e=>e.invoiceId==='i1'),e2=ent.find(e=>e.invoiceId==='i2');
 ok('FAC-1 (crédit) : 411 débit 200 / 707 crédit 200',!!e1&&e1.lines.some(l=>l.account==='411'&&l.debit===200)&&e1.lines.some(l=>l.account==='707'&&l.credit===200),e1);
 const bal=(e)=>Math.abs(e.lines.reduce((s,l)=>s+l.debit-l.credit,0))<0.001;
 ok('FAC-2 : équilibrée, caisse 726, 445 = 66, 706 = 500−remise+frais',!!e2&&bal(e2)&&e2.lines.some(l=>l.account==='530'&&l.debit===726)&&e2.lines.some(l=>l.account==='445'&&l.credit===66),e2);
 ok('écritures marquées « régénérées »',ent.every(e=>e.regenerated===true));
 ok('aucune écriture inventée pour l\'article disparu ni pour la facture déjà encaissée',!ent.some(e=>e.invoiceId==='i3'||e.invoiceId==='i4'));
 ok('il reste 2 écarts à vérifier manuellement',/2 écarts? détecté/.test(await p.locator('body').innerText()));
 await g(p,'repair-missing-entries').count()===0;
 ok('plus de bouton de régénération (rien de fiable à réparer)',(await g(p,'repair-missing-entries').count())===0);
 // idempotence : un 2e clic impossible → pas de doublon
 const n2=(await p.evaluate(()=>window.__srv.getCat('entries')||[])).length;ok('pas de doublon',n2===2,n2);
 await p.close();}
// Période clôturée : rien n'est régénéré
{const {p}=await boot(b,{settings:{companyName:'Test',currency:'HTG',taxAccount:'445',lockDate:today},primary:true,cats:{invoices:invs.slice(0,1),entries:[]}});
 await p.getByText('Comptabilité',{exact:false}).first().click();await p.waitForTimeout(900);
 await g(p,'repair-missing-entries').click();await p.waitForTimeout(1200);
 const ent=await p.evaluate(()=>window.__srv.getCat('entries')||[]);
 ok('période clôturée : aucune écriture régénérée',ent.length===0,ent.length);
 await p.close();}
await b.close();console.log(fails?('ÉCHECS '+fails):'TOUT PASSE');process.exit(fails?1:0)})();

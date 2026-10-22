// v249 — aperçu de la facture dans Comptes clients, tel qu'elle sort de l'imprimante.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const mod=async(p,n)=>{await p.getByText(n,{exact:true}).first().click();await p.waitForTimeout(900)};
const inv=(id,st,pay)=>({id,number:'F000'+id,date:'2026-10-01',client:'Marie',lines:[{productId:1,name:'Riz 25kg',qty:2,price:500,subtotal:1000,taxAmount:100,discountPct:0,discountAmt:0}],totalHT:1000,totalTax:100,total:1100,taxLabel:'TCA',paymentMode:'credit',status:st,payments:pay,createdAt:'2026-10-01T10:00:00Z'});
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
for(const fmt of ['a4','ticket80']){
 const invs=[inv(1,'impayée',[]),inv(2,'payée',[{id:1,amount:1100,date:'2026-10-02',mode:'caisse'}])];
 const {p,errs}=await boot(b,{settings:{companyName:'Lakay SA',currency:'HTG',receiptFormat:fmt,companyNIF:'123-456-789-0',tcaFranchise:false},primary:true,cats:{invoices:invs},pageInit:()=>{try{sessionStorage.clear();window.print=()=>{window.__printed=(window.__printed||0)+1}}catch(e){}}});
 await mod(p,'Comptes clients (CRM)');
 await p.getByText('Clients dûs',{exact:false}).first().click();await p.waitForTimeout(500);
 await p.getByText('1 facture',{exact:true}).first().click().catch(()=>{});await p.waitForTimeout(400);
 const voir=p.locator('[data-testid="facture-voir"]').first();
 ok(fmt+' : bouton « Voir la facture » présent (impayées)',(await voir.count())>=1);
 await voir.click();await p.waitForTimeout(400);
 const ap=p.locator('[data-testid="facture-apercu"]');const t=await ap.innerText();
 ok(fmt+' : aperçu affiche numéro, client, total et NIF',/F0001/.test(t)&&/Marie/.test(t)&&/1.?100/.test(t.replace(/\s/g,''))&&/123-456-789-0/.test(t),t.slice(0,200));
 ok(fmt+' : mise en page '+(fmt==='a4'?'A4 (zone de signature)':'ticket'),fmt==='a4'?/Visa de l'entreprise/.test(t):(await p.locator('[data-testid="apercu-ticket"]').count())===1);
 await p.locator('[data-testid="facture-imprimer"]').click();await p.waitForTimeout(700);
 ok(fmt+' : impression déclenchée',(await p.evaluate(()=>window.__printed||0))>=1);
 ok(fmt+' : aucune erreur JS',errs.length===0,errs.slice(0,3));await p.close();}
{const invs=[inv(2,'payée',[{id:1,amount:1100,date:'2026-10-02',mode:'caisse'}])];
 const {p,errs}=await boot(b,{settings:{companyName:'Lakay SA',currency:'HTG',receiptFormat:'a4'},primary:true,cats:{invoices:invs},pageInit:()=>{try{sessionStorage.clear()}catch(e){}}});
 await mod(p,'Comptes clients (CRM)');await p.getByText('Clients payés',{exact:false}).first().click();await p.waitForTimeout(500);
 const v=p.locator('[data-testid="facture-voir-payee"]').first();
 ok('clients payés : bouton présent',(await v.count())===1);await v.click();await p.waitForTimeout(300);
 ok('facture payée : statut « Payée » dans l\'aperçu',/Payée/.test(await p.locator('[data-testid="facture-apercu"]').innerText()));
 await p.locator('[data-testid="facture-fermer"]').click();await p.waitForTimeout(200);
 ok('fermeture de l\'aperçu',(await p.locator('[data-testid="facture-apercu"]').count())===0);
 ok('aucune erreur JS (payées)',errs.length===0,errs.slice(0,3));await p.close();}
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

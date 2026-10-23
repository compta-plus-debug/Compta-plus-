// v252 — adresse du client sur la facture (reprise de la fiche client) et préfixe de la série de numérotation.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const mod=async(p,n)=>{await p.getByText(n,{exact:true}).first().click();await p.waitForTimeout(900)};
const VENTE='Vente (POS / Facturation)';
const base={companyName:'Lakay SA',currency:'HTG'};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// A) vente : adresse reprise de la fiche client + préfixe
{const {p,errs}=await boot(b,{settings:{...base,invoicePrefix:'FA-'},primary:true,cats:{clients:[{id:'c1',name:'Marie Joseph',address:'12 rue Capois, Delmas'}]},pageInit:()=>{try{sessionStorage.clear()}catch(e){}}});
 await mod(p,VENTE);
 await p.getByText('Riz',{exact:true}).first().click();await p.waitForTimeout(300);
 await p.locator('input[placeholder*="Nom du client"]').first().fill('Marie Joseph');await p.waitForTimeout(400);
 ok('adresse reprise de la fiche client',(await p.locator('[data-testid="vente-adresse-client"]').inputValue())==='12 rue Capois, Delmas');
 await p.locator('[data-pos="validate"]').click();await p.waitForTimeout(1500);
 const inv=await p.evaluate(()=>(window.__srv.getCat('invoices')||[])[0]||{});
 ok('facture : adresse enregistrée',inv.clientAddress==='12 rue Capois, Delmas',inv);
 ok('facture : numéro avec le préfixe FA-',/^FA-\d{4}$/.test(inv.number||''),inv.number);
 ok('aucune erreur JS (vente)',errs.length===0,errs.slice(0,3));await p.close();}
// B) préfixe par défaut
{const {p}=await boot(b,{settings:base,primary:true,pageInit:()=>{try{sessionStorage.clear()}catch(e){}}});
 await mod(p,VENTE);await p.getByText('Riz',{exact:true}).first().click();await p.waitForTimeout(300);
 await p.locator('[data-pos="validate"]').click();await p.waitForTimeout(1500);
 const inv=await p.evaluate(()=>(window.__srv.getCat('invoices')||[])[0]||{});
 ok('sans réglage : préfixe F',/^F\d{4}$/.test(inv.number||''),inv.number);await p.close();}
// C) aperçu Comptes clients : adresse de la fiche si absente de la facture
{const inv={id:1,number:'F0001',date:'2026-10-01',client:'Marie',lines:[{productId:1,name:'Riz',qty:1,price:100,subtotal:100,taxAmount:10,discountPct:0,discountAmt:0}],totalHT:100,totalTax:10,total:110,taxLabel:'TCA',paymentMode:'credit',status:'impayée',payments:[],createdAt:'2026-10-01T10:00:00Z'};
 const {p,errs}=await boot(b,{settings:{...base,receiptFormat:'a4'},primary:true,cats:{invoices:[inv],clients:[{id:'c1',name:'Marie',address:'5 avenue Christophe'}]},pageInit:()=>{try{sessionStorage.clear()}catch(e){}}});
 await mod(p,'Comptes clients (CRM)');await p.getByText('Clients dûs',{exact:false}).first().click();await p.waitForTimeout(400);
 await p.getByText('1 facture',{exact:true}).first().click();await p.waitForTimeout(300);
 await p.locator('[data-testid="facture-voir"]').first().click();await p.waitForTimeout(400);
 ok('aperçu : adresse du client affichée',/5 avenue Christophe/.test(await p.locator('[data-testid="facture-apercu"]').innerText()));
 ok('aucune erreur JS (aperçu)',errs.length===0,errs.slice(0,3));await p.close();}
// D) fiche client : adresse saisie
{const {p,errs}=await boot(b,{settings:base,primary:true,pageInit:()=>{try{sessionStorage.clear()}catch(e){}}});
 await mod(p,'Comptes clients (CRM)');
 await p.locator('input[placeholder*="correspondre"]').first().fill('Paul');
 await p.locator('[data-testid="client-adresse"]').fill('8 rue Pavée');
 await p.getByRole('button',{name:'Enregistrer',exact:true}).first().click();await p.waitForTimeout(700);
 const c=await p.evaluate(()=>(window.__srv.getCat('clients')||[]).find(x=>x.name==='Paul')||{});
 ok('fiche client : adresse enregistrée',c.address==='8 rue Pavée',c);
 ok('aucune erreur JS (fiche)',errs.length===0,errs.slice(0,3));await p.close();}
// E) option désactivée par l'administrateur : plus de champ, plus d'adresse imprimée
{const inv={id:1,number:'F0001',date:'2026-10-01',client:'Marie',clientAddress:'5 avenue Christophe',lines:[{productId:1,name:'Riz',qty:1,price:100,subtotal:100,taxAmount:10,discountPct:0,discountAmt:0}],totalHT:100,totalTax:10,total:110,taxLabel:'TCA',paymentMode:'credit',status:'impayée',payments:[],createdAt:'2026-10-01T10:00:00Z'};
 const {p,errs}=await boot(b,{settings:{...base,receiptFormat:'a4',clientAddressOnInvoice:false},primary:true,cats:{invoices:[inv],clients:[{id:'c1',name:'Marie',address:'5 avenue Christophe'}]},pageInit:()=>{try{sessionStorage.clear()}catch(e){}}});
 await mod(p,VENTE);await p.getByText('Riz',{exact:true}).first().click();await p.waitForTimeout(300);
 await p.locator('input[placeholder*="Nom du client"]').first().fill('Marie');await p.waitForTimeout(400);
 ok('option désactivée : champ adresse absent de la caisse',(await p.locator('[data-testid="vente-adresse-client"]').count())===0);
 await p.locator('[data-pos="validate"]').click();await p.waitForTimeout(1500);
 const nv=await p.evaluate(()=>(window.__srv.getCat('invoices')||[]).find(i=>i.id!==1)||{});
 ok('option désactivée : adresse non enregistrée sur la nouvelle facture',!nv.clientAddress,nv);
 await mod(p,'Comptes clients (CRM)');await p.getByText('Clients dûs',{exact:false}).first().click();await p.waitForTimeout(400);
 await p.getByText('1 facture',{exact:true}).first().click();await p.waitForTimeout(300);
 await p.locator('[data-testid="facture-voir"]').first().click();await p.waitForTimeout(400);
 ok('option désactivée : aperçu sans adresse même si la facture en porte une',!/5 avenue Christophe/.test(await p.locator('[data-testid="facture-apercu"]').innerText()));
 ok('aucune erreur JS (option désactivée)',errs.length===0,errs.slice(0,3));await p.close();}
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

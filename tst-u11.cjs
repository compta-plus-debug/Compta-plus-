// v258 — ticket de caisse (date/heure, logo, colonnes, gros total), téléphone et liste des clients au panier,
// brouillons de formulaires conservés entre modules, texte de l'écran non sélectionnable.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const mod=async(p,n)=>{await p.getByText(n,{exact:true}).first().click();await p.waitForTimeout(900)};
const VENTE='Vente (POS / Facturation)';
const base={companyName:'Piou Piou Import Export',currency:'HTG',companyPhone:'+509 3809-8176 / +509 3247-1092',companyAddress:'Rue Merisier, Delmas 48'};
const LOGO='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// A) panier : liste des anciens clients, téléphone repris de la fiche, enregistré sur la facture et la fiche
{const {p,errs}=await boot(b,{settings:base,primary:true,cats:{clients:[{id:'c1',name:'Marie Joseph',phone:'3456-7890'},{id:'c2',name:'Eddy Paul'}],invoices:[{id:9,number:'F0009',date:'2026-10-01',client:'Jean Robert',clientPhone:'4000-1111',lines:[],total:0,payments:[],status:'payée',createdAt:'2026-10-01T10:00:00Z'}]},pageInit:()=>{try{sessionStorage.clear()}catch(e){}}});
 await mod(p,VENTE);
 await p.getByText('Riz',{exact:true}).first().click();await p.waitForTimeout(300);
 ok('liste fermée tant qu\'on ne clique pas',(await p.locator('[data-testid="vente-clients-liste"]').count())===0);
 await p.locator('[data-testid="vente-clients-fleche"]').click();await p.waitForTimeout(300);
 const opts=await p.locator('[data-testid="vente-client-option"]').allInnerTexts();
 ok('flèche : la liste s\'ouvre avec fiches clients + noms déjà facturés',['Marie Joseph','Eddy Paul','Jean Robert'].every(n=>opts.some(o=>o.includes(n))),opts);
 ok('la liste montre le téléphone',opts.some(o=>/3456-7890/.test(o)));
 await p.locator('[data-testid="vente-client-nom"]').fill('edd');await p.waitForTimeout(300);
 ok('saisie des premières lettres : liste filtrée',(await p.locator('[data-testid="vente-client-option"]').count())===1);
 await p.locator('[data-testid="vente-client-option"]').first().dispatchEvent('mousedown');await p.waitForTimeout(300);
 ok('choix dans la liste : nom rempli et liste fermée',(await p.locator('[data-testid="vente-client-nom"]').inputValue())==='Eddy Paul'&&(await p.locator('[data-testid="vente-clients-liste"]').count())===0);
 await p.locator('[data-testid="vente-client-nom"]').fill('');await p.waitForTimeout(200);
 ok('pas de champ téléphone tant qu\'aucun nom',(await p.locator('[data-testid="vente-telephone-client"]').count())===0);
 await p.locator('[data-testid="vente-client-nom"]').fill('Marie Joseph');await p.waitForTimeout(400);
 ok('téléphone repris de la fiche client',(await p.locator('[data-testid="vente-telephone-client"]').inputValue())==='3456-7890');
 await p.locator('[data-testid="vente-client-nom"]').fill('Jean Robert');await p.waitForTimeout(400);
 ok('téléphone repris de la dernière facture',(await p.locator('[data-testid="vente-telephone-client"]').inputValue())==='4000-1111');
 await p.locator('[data-testid="vente-client-nom"]').fill('Eddy Paul');await p.waitForTimeout(300);
 await p.locator('[data-testid="vente-telephone-client"]').fill('3456-8890');
 await p.locator('[data-pos="validate"]').click();await p.waitForTimeout(1500);
 const inv=await p.evaluate(()=>(window.__srv.getCat('invoices')||[]).find(i=>i.client==='Eddy Paul')||{});
 ok('facture : téléphone enregistré',inv.clientPhone==='3456-8890',inv);
 const cl=await p.evaluate(()=>(window.__srv.getCat('clients')||[]).find(c=>c.name==='Eddy Paul')||{});
 ok('fiche client : téléphone conservé',cl.phone==='3456-8890',cl);
 // nouveau client avec téléphone => fiche créée
 await p.getByText('Riz',{exact:true}).first().click();await p.waitForTimeout(300);
 await p.locator('[data-testid="vente-client-nom"]').fill('Nouveau Client');await p.waitForTimeout(300);
 await p.locator('[data-testid="vente-telephone-client"]').fill('3999-0000');
 await p.locator('[data-pos="validate"]').click();await p.waitForTimeout(1500);
 const cl2=await p.evaluate(()=>(window.__srv.getCat('clients')||[]).find(c=>c.name==='Nouveau Client')||{});
 ok('nouveau client : fiche créée avec son téléphone',cl2.phone==='3999-0000',cl2);
 ok('aucune erreur JS (panier)',errs.length===0,errs.slice(0,3));await p.close();}
// B) aperçu du ticket et de l'A4 : date + heure, logo, téléphone, colonnes, gros total, détails de paiement
for(const fmt of ['ticket80','a4']){
 const created=new Date(2026,9,23,13,15).toISOString();
 const inv={id:1,number:'BJ-3490',date:'2026-10-23',createdAt:created,client:'Eddy',clientPhone:'3456-8890',lines:[{productId:1,name:'Ti Bout Amick 10 Lbs - Sachets',qty:1,price:300,subtotal:300,taxAmount:0,discountPct:0,discountAmt:0}],totalHT:300,totalTax:0,total:300,taxLabel:'TCA',paymentMode:'caisse',status:'payée',payments:[{id:1,amount:300,date:'2026-10-23'}]};
 const {p,errs}=await boot(b,{settings:{...base,companyLogo:LOGO,receiptFormat:fmt},primary:true,cats:{invoices:[inv]},pageInit:()=>{try{sessionStorage.clear()}catch(e){}}});
 await mod(p,'Comptes clients (CRM)');await p.getByText('Clients payés',{exact:false}).first().click();await p.waitForTimeout(500);
 await p.locator('[data-testid="facture-voir-payee"]').first().click();await p.waitForTimeout(400);
 const t=await p.locator('[data-testid="facture-apercu"]').innerText();
 ok(fmt+' : date et heure exactes (23/10/2026 13:15)',/23\/10\/2026 13:15/.test(t),t.slice(0,300));
 ok(fmt+' : téléphone du client',/3456-8890/.test(t));
 ok(fmt+' : logo affiché',(await p.locator('[data-testid="apercu-logo"]').count())===1);
 if(fmt==='ticket80'){
  ok('ticket : colonnes Article / Qté / Montant',/Article/.test(t)&&/Qté/.test(t)&&/Montant/.test(t),t);
  ok('ticket : « Articles au total » et « Montant total »',/Articles au total/.test(t)&&/Montant total/.test(t));
  ok('ticket : « Détails de paiement » avec Espèces',/Détails de paiement/.test(t)&&/Espèces/.test(t));
  ok('ticket : numéro de facture',/BJ-3490/.test(t));
  const fs=await p.locator('[data-testid="apercu-total"]').evaluate(e=>parseFloat(getComputedStyle(e).fontSize));
  ok('ticket : total en grand',fs>=18,fs);
 }
 ok(fmt+' : aucune erreur JS',errs.length===0,errs.slice(0,3));await p.close();}
// C) brouillons : un achat en cours de saisie est retrouvé après un passage par un autre module
{const {p,errs}=await boot(b,{settings:base,primary:true,pageInit:()=>{try{sessionStorage.clear()}catch(e){}}});
 await mod(p,'Achat et fournisseurs');
 await p.locator('input[placeholder="Ex : Achat fournitures de bureau"]').fill('Sacs de riz importés');await p.waitForTimeout(200);
 await mod(p,VENTE);await mod(p,'Achat et fournisseurs');
 ok('achat en cours : libellé retrouvé au retour',(await p.locator('input[placeholder="Ex : Achat fournitures de bureau"]').inputValue())==='Sacs de riz importés');
 ok('aucune erreur JS (brouillon)',errs.length===0,errs.slice(0,3));await p.close();}
// D) texte non sélectionnable, champs de saisie éditables
{const {p}=await boot(b,{settings:base,primary:true,pageInit:()=>{try{sessionStorage.clear()}catch(e){}}});
 await mod(p,VENTE);
 const us=await p.evaluate(()=>getComputedStyle(document.body).userSelect||getComputedStyle(document.body).webkitUserSelect);
 ok('texte de l\'écran : sélection désactivée',us==='none',us);
 const ui=await p.locator('[data-testid="vente-client-nom"]').evaluate(e=>getComputedStyle(e).userSelect||getComputedStyle(e).webkitUserSelect);
 ok('champs de saisie : texte sélectionnable',ui==='text',ui);
 const drop=await p.evaluate(()=>{const inp=document.querySelector('[data-testid="vente-client-nom"]');const dt=new DataTransfer();dt.setData('text/plain','piraté');const ev=new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true});inp.dispatchEvent(ev);return ev.defaultPrevented});
 ok('dépôt de texte dans un champ : bloqué',drop===true);
 await p.close();}
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

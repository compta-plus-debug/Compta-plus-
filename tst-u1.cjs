// v246 — mises à jour fiscales : barème d'impôt sur le revenu (ancien / nouveau Code fiscal), NIF du vendeur et
// mention de franchise de TCA sur la facture, retenue d'impôt sur les primes dans la paie.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const txt=p=>p.evaluate(()=>document.body.innerText);
const mod=async(p,n)=>{await p.getByText(n,{exact:true}).first().click();await p.waitForTimeout(900)};
const num=s=>String(s).replace(/[\s  .,]/g,'');
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// A) barème
{const {p,errs}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,pageInit:()=>{try{sessionStorage.clear()}catch(e){}}});
 await mod(p,'Rapports et analyse');await p.getByText('Déclarations fiscales',{exact:true}).first().click();await p.waitForTimeout(400);await p.getByText('Impôt sur le Revenu',{exact:true}).first().click();await p.waitForTimeout(700);
 await p.getByText('Réel (barème progressif)').first().click();await p.waitForTimeout(300);
 const yr=p.locator('input[type=number]').first();await yr.fill('2026');await p.waitForTimeout(200);
 const rev=p.getByText('Revenu global',{exact:true}).locator('xpath=following-sibling::input[1]');await rev.fill('600000');await p.waitForTimeout(300);
 ok('année 2026 : le nouveau barème est choisi par défaut',(await p.locator('[data-testid="ir-bareme"]').inputValue())==='nouveau');
 let t=await txt(p);
 ok('nouveau barème : 600 000 → impôt brut 32 400',/Impôt brut\s*32.?400/.test(t.replace(/[  ]/g,' ').replace(/(\d) (\d{3})/g,'$1$2').replace(/(\d)[.,](\d{3})/g,'$1$2').replace(/32400/,'32.400')) || num(t.slice(t.indexOf('Impôt brut'),t.indexOf('Impôt brut')+40)).includes('32400'),t.slice(t.indexOf('Impôt brut'),t.indexOf('Impôt brut')+50));
 ok('la première tranche à 0 % va jusqu\'à 360 000',/360.?000/.test(t.replace(/[   ]/g,'')));
 await p.locator('[data-testid="ir-bareme"]').selectOption('ancien');await p.waitForTimeout(300);
 t=await txt(p);const i=t.indexOf('Impôt brut');
 ok('ancien barème : 600 000 → impôt brut 84 000',num(t.slice(i,i+40)).includes('84000'),t.slice(i,i+50));
 await yr.fill('2025');await p.waitForTimeout(300);
 ok('l\'ancien choix manuel reste appliqué (le choix de l\'utilisateur prime)',(await p.locator('[data-testid="ir-bareme"]').inputValue())==='ancien');
 ok('aucune erreur JS (barème)',errs.length===0,errs.slice(0,3));await p.close();}
// B) facture : NIF + franchise
for(const [fr,label] of [[true,'franchise'],[false,'sans franchise']]){
 const inv={id:1,number:'F0001',date:'2026-10-01',client:'Marie',lines:[{productId:1700000000001,name:'Riz',qty:1,price:100,subtotal:100,taxAmount:0,discountPct:0,discountAmt:0}],totalHT:100,totalTax:0,total:100,taxLabel:'TCA',paymentMode:'caisse',status:'payée',payments:[],createdAt:'2026-10-01T10:00:00Z'};
 const {p,errs}=await boot(b,{settings:{companyName:'Lakay SA',currency:'HTG',companyNIF:'001-234-567-8',tcaFranchise:fr,receiptFormat:'a4'},primary:true,cats:{invoices:[inv]},pageInit:()=>{try{sessionStorage.clear();window.print=()=>{}}catch(e){}}});
 await mod(p,'Vente (POS / Facturation)');
 let btn=p.locator('button[title="Imprimer"]').first();
 if(!(await btn.count())){const f=p.getByText(/Factures|Historique/).first();if(await f.count()){await f.click();await p.waitForTimeout(600)}btn=p.locator('button[title="Imprimer"]').first()}
 if(!(await btn.count()))btn=p.getByText('Imprimer',{exact:false}).first();
 await btn.click();await p.waitForTimeout(500);
 ok(label+' : le NIF du vendeur figure sur la facture imprimée',(await p.locator('[data-testid="print-nif"]').count())>=1&&/001-234-567-8/.test(await p.locator('[data-testid="print-nif"]').first().innerText()));
 ok(label+' : mention « article 193 » '+(fr?'présente':'absente'),(await p.locator('[data-testid="print-franchise"]').count()>0)===fr);
 ok('aucune erreur JS ('+label+')',errs.length===0,errs.slice(0,3));await p.close();}
// B2) réglage de franchise dans l'administration
{const {p,errs}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,pageInit:()=>{try{sessionStorage.clear()}catch(e){}}});
 await mod(p,'Administration');await p.waitForTimeout(500);
 ok('l\'option « franchise de TCA » est proposée dans l\'administration',(await p.locator('[data-testid="tca-franchise"]').count())===1,(await txt(p)).slice(0,200));
 ok('aucune erreur JS (administration)',errs.length===0,errs.slice(0,3));await p.close();}
// C) paie : retenue sur prime
{const {p,errs}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,cats:{employees:[{id:1,name:'Jean',position:'Vendeur',baseSalary:10000,payFrequency:'mensuelle',overtimeRate:0,active:true,createdAt:'2026-01-01T00:00:00Z'}]},pageInit:()=>{try{sessionStorage.clear()}catch(e){}}});
 await mod(p,'Salaires (RH)');await p.getByText('Bulletins de paie',{exact:true}).first().click();await p.waitForTimeout(500);
 await p.locator('select').first().selectOption({label:'Jean'});await p.waitForTimeout(200);
 ok('sans prime : aucune retenue sur prime',(await p.locator('[data-testid="pay-line-prime-wh"]').count())===0);
 await p.getByText('Prime / bonus',{exact:true}).locator('xpath=following-sibling::input[1]').fill('2000');await p.waitForTimeout(300);
 let t=await p.locator('[data-testid="pay-line-prime-wh"]').first().innerText().catch(()=>'');
 ok('prime de 2 000 à 15 % : retenue 300',/15 %/.test(t)&&num(t).includes('300'),t);
 ok('net à payer = 12 000 − 300 = 11 700',num(await p.locator('[data-testid="pay-net"]').innerText()).includes('11700'),await p.locator('[data-testid="pay-net"]').innerText());
 await p.locator('[data-testid="pay-prime-rate"]').fill('10');await p.waitForTimeout(250);
 ok('taux modifiable : 10 % → 200 retenus, net 11 800',num(await p.locator('[data-testid="pay-line-prime-wh"]').first().innerText()).includes('200')&&num(await p.locator('[data-testid="pay-net"]').innerText()).includes('11800'));
 await p.locator('[data-testid="pay-prime-wh"]').uncheck();await p.waitForTimeout(250);
 ok('case décochée : plus de retenue, net 12 000',(await p.locator('[data-testid="pay-line-prime-wh"]').count())===0&&num(await p.locator('[data-testid="pay-net"]').innerText()).includes('12000'));
 ok('aucune erreur JS (paie)',errs.length===0,errs.slice(0,3));await p.close();}
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

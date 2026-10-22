// v248 — alignement sur le texte officiel du Code fiscal (Moniteur spécial 48-A du 30 septembre 2026) :
// régime forfaitaire (art. 62 à 66), impôt sur les sociétés (art. 137), TCA sans abattement (art. 186),
// retenues sur boni 10 % / autres 15 % (art. 103), retenue mensuelle sur salaire (art. 100), mentions de facture (art. 191).
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const txt=p=>p.evaluate(()=>document.body.innerText);
const mod=async(p,n)=>{await p.getByText(n,{exact:true}).first().click();await p.waitForTimeout(900)};
const num=s=>String(s).replace(/[\s  .,]/g,'');
const after=(t,k,n=60)=>{const i=t.indexOf(k);return i<0?'':t.slice(i,i+n)};
const base={settings:{companyName:'X',currency:'HTG'},primary:true,pageInit:()=>{try{sessionStorage.clear()}catch(e){}}};
const toIR=async p=>{await mod(p,'Rapports et analyse');await p.getByText('Déclarations fiscales',{exact:true}).first().click();await p.waitForTimeout(400);await p.getByText('Impôt sur le Revenu',{exact:true}).first().click();await p.waitForTimeout(600)};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// A) forfaitaire
{const {p,errs}=await boot(b,base);await toIR(p);
 await p.getByText('Forfaitaire (CA < 10 M)').first().click();await p.waitForTimeout(300);
 await p.getByText("Chiffre d'affaires de l'exercice précédent (recettes globales)",{exact:true}).locator('xpath=following-sibling::input[1]').fill('5000000');await p.waitForTimeout(300);
 let t=await txt(p);
 ok('services : (5 000 000 − 1 000 000) × 5 % = 200 000',num(after(t,'IMPÔT FORFAITAIRE À PAYER',90)).includes('200000'),after(t,'IMPÔT FORFAITAIRE',90));
 await p.locator('[data-testid="forf-type"]').selectOption('autres');await p.waitForTimeout(250);t=await txt(p);
 ok('autres activités : 4 000 000 × 2 % = 80 000',num(after(t,'IMPÔT FORFAITAIRE À PAYER',90)).includes('80000'),after(t,'IMPÔT FORFAITAIRE',90));
 await p.getByText("Chiffre d'affaires de l'exercice précédent (recettes globales)",{exact:true}).locator('xpath=following-sibling::input[1]').fill('1200000');await p.waitForTimeout(250);t=await txt(p);
 ok('petit chiffre d\'affaires : minimum de 25 000 appliqué',num(after(t,'IMPÔT FORFAITAIRE À PAYER',90)).includes('25000'),after(t,'IMPÔT FORFAITAIRE',90));
 await p.getByText("Chiffre d'affaires de l'exercice précédent (recettes globales)",{exact:true}).locator('xpath=following-sibling::input[1]').fill('12000000');await p.waitForTimeout(250);t=await txt(p);
 ok('12 millions : non éligible au forfaitaire (seuil de 10 millions)',/10 000 000 HTG/.test(t.replace(/[  ]/g,' '))&&/pas éligible/.test(t),t.slice(0,200));
 ok('aucune erreur JS (forfaitaire)',errs.length===0,errs.slice(0,3));await p.close();}
// B) sociétés
{const {p,errs}=await boot(b,base);await toIR(p);
 await p.getByText('Réel (bénéfice réel)').first().click();await p.waitForTimeout(300);
 await p.getByText('Revenu global',{exact:true}).locator('xpath=following-sibling::input[1]').fill('1000000');await p.waitForTimeout(250);
 await p.locator('[data-testid="ir-entite"]').selectOption('societe');await p.waitForTimeout(300);
 let t=await txt(p);
 ok('société : 1 000 000 × 30 % = 300 000',num(after(t,'Impôt brut',40)).includes('300000'),after(t,'Impôt brut',50));
 ok('société : le choix du barème des personnes physiques est masqué',(await p.locator('[data-testid="ir-bareme"]').count())===0);
 await p.locator('[data-testid="ir-entite"]').selectOption('cooperative');await p.waitForTimeout(250);t=await txt(p);
 ok('coopérative d\'épargne et de crédit : 10 % = 100 000',num(after(t,'Impôt brut',40)).includes('100000'),after(t,'Impôt brut',50));
 await p.locator('[data-testid="ir-entite"]').selectOption('physique');await p.waitForTimeout(250);t=await txt(p);
 ok('personne physique : barème progressif (1 000 000 → 21 600 + 82 800 = 104 400)',num(after(t,'Impôt brut',40)).includes('104400'),after(t,'Impôt brut',50));
 ok('aucune erreur JS (sociétés)',errs.length===0,errs.slice(0,3));await p.close();}
// C) TCA sans abattement
{const inv={id:1,number:'F0001',date:'2026-10-05',client:'M',lines:[],totalHT:100000,totalTax:10000,total:110000,taxLabel:'TCA',paymentMode:'caisse',status:'payée',payments:[],createdAt:'2026-10-05T10:00:00Z'};
 const {p,errs}=await boot(b,{...base,cats:{invoices:[inv]}});
 await mod(p,'Rapports et analyse');await p.getByText('Déclarations fiscales',{exact:true}).first().click();await p.waitForTimeout(400);await p.getByText('Déclaration TCA',{exact:true}).first().click();await p.waitForTimeout(500);
 const sel=p.locator('select').first();await p.locator('input[type=number]').first().fill('2026');await p.locator('select').filter({hasText:'Octobre'}).first().selectOption('10');await p.waitForTimeout(300);
 let t=await txt(p);
 ok('TCA : 100 000 de chiffre d\'affaires → 10 000 (10 %, sans abattement ni minimum)',num(after(t,'L4 — Montant de la TCA',140)).includes('10000'),after(t,'L4 — Montant',140));
 await p.locator('[data-testid="tca-abattement"]').fill('50000');await p.waitForTimeout(250);t=await txt(p);
 ok('l\'abattement reste saisissable : 50 000 → TCA 5 000',num(after(t,'L4 — Montant de la TCA',140)).includes('5000')&&!num(after(t,'L4 — Montant de la TCA',140)).includes('10000'),after(t,'L4 — Montant',140));
 ok('aucune erreur JS (TCA)',errs.length===0,errs.slice(0,3));await p.close();}
// D) paie : boni 10 %, autres 15 %, retenue sur salaire
{const {p,errs}=await boot(b,{...base,cats:{employees:[{id:1,name:'Jean',position:'V',baseSalary:50000,payFrequency:'mensuelle',overtimeRate:0,active:true,createdAt:'2026-01-01T00:00:00Z'}]}});
 await mod(p,'Salaires (RH)');await p.getByText('Bulletins de paie',{exact:true}).first().click();await p.waitForTimeout(500);
 await p.locator('select').first().selectOption({label:'Jean'});await p.waitForTimeout(250);
 ok('salaire de 50 000 : la retenue sur salaire est proposée (non cochée par défaut)',(await p.locator('[data-testid="pay-salary-wh"]').count())===1&&!(await p.locator('[data-testid="pay-salary-wh"]').isChecked()));
 await p.locator('[data-testid="pay-salary-wh"]').check();await p.waitForTimeout(250);
 ok('retenue sur salaire : (600 000 → 32 400) / 12 = 2 700',num(await p.locator('[data-testid="pay-line-salary-wh"]').innerText()).includes('2700'),await p.locator('[data-testid="pay-line-salary-wh"]').innerText());
 ok('net = 50 000 − 2 700 = 47 300',num(await p.locator('[data-testid="pay-net"]').innerText()).includes('47300'));
 await p.getByText('Prime / bonus',{exact:true}).locator('xpath=following-sibling::input[1]').fill('2000');await p.waitForTimeout(300);
 ok('prime ou autre rémunération : 15 % → 300',num(await p.locator('[data-testid="pay-line-prime-wh"]').innerText()).includes('300'));
 await p.locator('[data-testid="pay-bonus-kind"]').selectOption('boni');await p.waitForTimeout(300);
 ok('boni : 10 % → 200',/10 %/.test(await p.locator('[data-testid="pay-line-prime-wh"]').innerText())&&num(await p.locator('[data-testid="pay-line-prime-wh"]').innerText()).includes('200'),await p.locator('[data-testid="pay-line-prime-wh"]').innerText());
 ok('net = 52 000 − 2 700 − 200 = 49 100',num(await p.locator('[data-testid="pay-net"]').innerText()).includes('49100'),await p.locator('[data-testid="pay-net"]').innerText());
 ok('aucune erreur JS (paie)',errs.length===0,errs.slice(0,3));await p.close();}
// E) facture : taux appliqué + visa
{const inv={id:1,number:'F0001',date:'2026-10-01',client:'Marie',lines:[{productId:1700000000001,name:'Riz',qty:1,price:100,subtotal:100,taxAmount:10,discountPct:0,discountAmt:0}],totalHT:100,totalTax:10,total:110,taxLabel:'TCA',paymentMode:'caisse',status:'payée',payments:[],createdAt:'2026-10-01T10:00:00Z'};
 const {p,errs}=await boot(b,{settings:{companyName:'Lakay SA',currency:'HTG',receiptFormat:'a4'},primary:true,cats:{invoices:[inv]},pageInit:()=>{try{sessionStorage.clear();window.print=()=>{}}catch(e){}}});
 await mod(p,'Vente (POS / Facturation)');
 let btn=p.locator('button[title="Imprimer"]').first();
 if(!(await btn.count())){const f=p.getByText(/Factures|Historique/).first();if(await f.count()){await f.click();await p.waitForTimeout(600)}btn=p.locator('button[title="Imprimer"]').first()}
 if(!(await btn.count()))btn=p.getByText('Imprimer',{exact:false}).first();
 await btn.click();await p.waitForTimeout(500);
 ok('la facture affiche le taux appliqué (10 %)',/10 %/.test(await p.locator('[data-testid="print-taux"]').first().innerText()),await p.locator('[data-testid="print-taux"]').count());
 ok('la facture A4 comporte la zone de visa et signature (article 191)',(await p.locator('[data-testid="print-visa"]').count())>=1);
 ok('aucune erreur JS (facture)',errs.length===0,errs.slice(0,3));await p.close();}
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

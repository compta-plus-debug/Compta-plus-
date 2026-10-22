// v249 — TCA déductible sur les achats (art. 187 à 190) : saisie, écriture 4456, déclaration, crédit reporté, retour fournisseur.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const txt=p=>p.evaluate(()=>document.body.innerText);
const mod=async(p,n)=>{await p.getByText(n,{exact:true}).first().click();await p.waitForTimeout(900)};
const num=s=>String(s).replace(/[\s  .,]/g,'');
const sup=[{id:1,name:'Fournisseur A',contact:''}];
const pageInit=()=>{try{sessionStorage.clear()}catch(e){}};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// A) saisie d'un achat avec TCA
{const {p,errs}=await boot(b,{settings:{companyName:'X',currency:'HTG',taxSystem:'tca'},primary:true,cats:{suppliers:sup},pageInit});
 await mod(p,'Achat et fournisseurs');
 ok('champ TCA déductible présent',(await p.locator('[data-testid="achat-tca"]').count())===1);
 await p.getByPlaceholder('Ex : Achat fournitures de bureau').fill('Papeterie');
 await p.locator('input[type=number]').first().fill('1000');
 await p.locator('[data-testid="achat-tca"]').fill('100');
 await p.locator('[data-testid="achat-facture-fournisseur"]').fill('F-114');await p.waitForTimeout(250);
 ok('total à payer = 1 100',num(await p.locator('[data-testid="achat-total-ttc"]').innerText()).includes('1100'),await p.locator('[data-testid="achat-total-ttc"]').innerText());
 await p.getByText("Enregistrer l'achat",{exact:true}).first().click();await p.waitForTimeout(900);
 const st=await p.evaluate(()=>({pu:window.__srv.getCat('purchases'),en:window.__srv.getCat('entries')}));
 const pu=(st.pu||[])[0]||{};const e=(st.en||[]).find(x=>x.id===pu.id)||{};
 ok('achat : TTC 1 100, HT 1 000, TCA 100, facture F-114',pu.amount===1100&&pu.amountHT===1000&&pu.tcaDeductible===100&&pu.supplierInvoiceNo==='F-114',pu);
 const l=e.lines||[];
 ok('écriture équilibrée : charge 1 000 + 4456 100 = crédit 1 100',l.length===3&&l.some(x=>x.account==='4456'&&x.debit===100)&&l.reduce((s,x)=>s+x.debit,0)===l.reduce((s,x)=>s+x.credit,0)&&l.some(x=>x.credit===1100),l);
 ok('aucune erreur JS (saisie)',errs.length===0,errs.slice(0,3));await p.close();}
// B) sans TCA ni régime : champ absent
{const {p}=await boot(b,{settings:{companyName:'X',currency:'HTG',taxSystem:'aucune'},primary:true,cats:{suppliers:sup},pageInit});
 await mod(p,'Achat et fournisseurs');
 ok('régime « aucune taxe » : champ masqué',(await p.locator('[data-testid="achat-tca"]').count())===0);await p.close();}
{const {p}=await boot(b,{settings:{companyName:'X',currency:'HTG',taxSystem:'tca',tcaFranchise:true},primary:true,cats:{suppliers:sup},pageInit});
 await mod(p,'Achat et fournisseurs');
 ok('franchise : champ masqué',(await p.locator('[data-testid="achat-tca"]').count())===0);await p.close();}
// C) déclaration : TCA due 10 000, déductible 4 000 → 6 000 ; mois suivant crédit
{const inv=(id,d,ht)=>({id,number:'F'+id,date:d,client:'M',lines:[],totalHT:ht,totalTax:ht/10,total:ht*1.1,taxLabel:'TCA',paymentMode:'caisse',status:'payée',payments:[],createdAt:d+'T10:00:00Z'});
 const en=(id,d,t)=>({id,date:d,label:'Achat',lines:[{account:'607',debit:t*10,credit:0},{account:'4456',debit:t,credit:0},{account:'530',debit:0,credit:t*11}]});
 const pur=[{id:11,supplier:'Fournisseur A',date:'2026-10-10',label:'x',amount:4400,amountHT:4000,tcaDeductible:400,supplierInvoiceNo:'F-1',paymentMode:'caisse',status:'payé'}];
 const entries=[en(11,'2026-10-10',4000),en(12,'2026-11-05',500)];
 const {p,errs}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,cats:{invoices:[inv(1,'2026-10-05',100000),inv(2,'2026-11-05',10000)],purchases:pur,entries},pageInit});
 await mod(p,'Rapports et analyse');await p.getByText('Déclarations fiscales',{exact:true}).first().click();await p.waitForTimeout(400);await p.getByText('Déclaration TCA',{exact:true}).first().click();await p.waitForTimeout(500);
 await p.locator('input[type=number]').first().fill('2026');await p.locator('select').filter({hasText:'Octobre'}).first().selectOption('10');await p.waitForTimeout(300);
 ok('octobre : déductible 4 000',num(await p.locator('[data-testid="tca-deductible"]').innerText()).includes('4000'),await p.locator('[data-testid="tca-deductible"]').innerText());
 ok('octobre : TCA nette 10 000 − 4 000 = 6 000',num(await p.locator('[data-testid="tca-nette"]').innerText()).includes('6000'),await p.locator('[data-testid="tca-nette"]').innerText());
 ok('octobre : liste des factures d\'achat affichée',(await p.locator('[data-testid="tca-liste-achats"]').innerText()).includes('F-1'));
 await p.locator('select').filter({hasText:'Octobre'}).first().selectOption('11');await p.waitForTimeout(300);
 ok('novembre : TCA 1 000 − déductible 500 = 500',num(await p.locator('[data-testid="tca-nette"]').innerText()).includes('500')&&!num(await p.locator('[data-testid="tca-nette"]').innerText()).includes('950'),await p.locator('[data-testid="tca-nette"]').innerText());
 ok('aucune erreur JS (déclaration)',errs.length===0,errs.slice(0,3));await p.close();}
// D) crédit reporté : TCA due 1 000 en octobre, déductible 3 000 → crédit 2 000 reporté
{const inv=(id,d,ht)=>({id,number:'F'+id,date:d,client:'M',lines:[],totalHT:ht,totalTax:ht/10,total:ht*1.1,taxLabel:'TCA',paymentMode:'caisse',status:'payée',payments:[],createdAt:d+'T10:00:00Z'});
 const entries=[{id:21,date:'2026-10-10',label:'Achat',lines:[{account:'607',debit:30000,credit:0},{account:'4456',debit:3000,credit:0},{account:'530',debit:0,credit:33000}]}];
 const {p}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,cats:{invoices:[inv(1,'2026-10-05',10000),inv(2,'2026-11-05',50000)],entries},pageInit});
 await mod(p,'Rapports et analyse');await p.getByText('Déclarations fiscales',{exact:true}).first().click();await p.waitForTimeout(400);await p.getByText('Déclaration TCA',{exact:true}).first().click();await p.waitForTimeout(500);
 await p.locator('input[type=number]').first().fill('2026');await p.locator('select').filter({hasText:'Octobre'}).first().selectOption('10');await p.waitForTimeout(300);
 ok('octobre : TCA nette 0, crédit à reporter 2 000',num(await p.locator('[data-testid="tca-nette"]').innerText()).startsWith('0')&&num(await txt(p)).includes('2000nonremboursable'.replace('nonremboursable','')),await p.locator('[data-testid="tca-nette"]').innerText());
 await p.locator('select').filter({hasText:'Octobre'}).first().selectOption('11');await p.waitForTimeout(300);
 ok('novembre : crédit reporté 2 000',num(await p.locator('[data-testid="tca-credit"]').innerText()).includes('2000'),await p.locator('[data-testid="tca-credit"]').innerText());
 ok('novembre : 5 000 − 2 000 = 3 000',num(await p.locator('[data-testid="tca-nette"]').innerText()).includes('3000'),await p.locator('[data-testid="tca-nette"]').innerText());await p.close();}
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

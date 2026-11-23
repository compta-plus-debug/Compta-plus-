// v256 — retenues à la source sur les prestataires (articles 96 et 97) : saisie dans Achats, écriture, état mensuel, liste annuelle.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const mod=async(p,n)=>{await p.getByText(n,{exact:true}).first().click();await p.waitForTimeout(900)};
const num=s=>String(s).replace(/[\s  .,]/g,'');
const pageInit=()=>{try{sessionStorage.clear()}catch(e){}};
const sup=[{id:1,name:'Consultant A',contact:'',nif:'555-1'}];
const toRap=async(p,tab)=>{await mod(p,'Rapports et analyse');await p.getByText('Déclarations fiscales',{exact:true}).first().click();await p.waitForTimeout(400);await p.getByText(tab,{exact:true}).first().click();await p.waitForTimeout(600)};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// A) saisie : 10 000 HT, retenue 10 % = 1 000, net 9 000
{const {p,errs}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,cats:{suppliers:sup},pageInit});
 await mod(p,'Achat et fournisseurs');
 await p.getByPlaceholder('Ex : Achat fournitures de bureau').fill('Honoraires conseil');
 await p.locator('input[type=number]').first().fill('10000');
 await p.locator('[data-testid="achat-retenue-type"]').selectOption('service');await p.waitForTimeout(250);
 ok('retenue affichée : 1 000',num(await p.locator('[data-testid="achat-retenue-montant"]').innerText()).includes('1000'),await p.locator('[data-testid="achat-retenue-montant"]').innerText());
 ok('net à payer : 9 000',num(await p.locator('[data-testid="achat-retenue-net"]').innerText()).includes('9000'));
 await p.getByText("Enregistrer l'achat",{exact:true}).first().click();await p.waitForTimeout(900);
 const st=await p.evaluate(()=>({pu:window.__srv.getCat('purchases'),en:window.__srv.getCat('entries')}));
 const pu=(st.pu||[])[0]||{};const e=(st.en||[]).find(x=>x.id===pu.id)||{};const l=e.lines||[];
 ok('fiche : net 9 000, HT 10 000, retenue 1 000 (10 %)',pu.amount===9000&&pu.amountHT===10000&&pu.retenueSource===1000&&pu.retenueRate===10,pu);
 ok('écriture équilibrée : charge 10 000 = crédit 9 000 + 431 1 000',l.reduce((s,x)=>s+x.debit,0)===10000&&l.reduce((s,x)=>s+x.credit,0)===10000&&l.some(x=>x.account==='431'&&x.credit===1000),l);
 ok('compte 431 présent au plan comptable',await p.evaluate(()=>(window.__srv.getCat('accounts')||[]).some(a=>a.code==='431')));
 ok('aucune erreur JS (saisie)',errs.length===0,errs.slice(0,3));await p.close();}
// B) état mensuel et liste annuelle
{const d='2026-03-12';
 const purchases=[{id:31,supplier:'Consultant A',date:d,label:'x',amount:9000,amountHT:10000,retenueType:'service',retenueRate:10,retenueSource:1000,paymentMode:'banque',status:'payé'},
  {id:32,supplier:'Consultant A',date:d,label:'Licence',amount:8000,amountHT:10000,retenueType:'licence',retenueRate:20,retenueSource:2000,paymentMode:'banque',status:'payé'},
  {id:33,supplier:'Consultant A',date:d,label:'annulé',amount:900,amountHT:1000,retenueType:'service',retenueRate:10,retenueSource:100,paymentMode:'banque',status:'annulé'}];
 const entries=purchases.map(x=>({id:x.id,date:d,label:'a',lines:[{account:'622',debit:x.amountHT,credit:0},{account:'512',debit:0,credit:x.amount},{account:'431',debit:0,credit:x.retenueSource}]}));
 const {p,errs}=await boot(b,{settings:{companyName:'X',currency:'HTG',companyNIF:'123'},primary:true,cats:{suppliers:sup,purchases,entries},pageInit});
 await toRap(p,'Retenues sur prestations');
 await p.locator('[data-testid="retprest-annee"]').fill('2026');await p.locator('[data-testid="retprest-mois"]').selectOption('3');await p.waitForTimeout(400);
 ok('mars : 2 lignes (annulé exclu)',(await p.locator('[data-testid="retprest-ligne"]').count())===2);
 ok('total à verser : 3 000',num(await p.locator('[data-testid="retprest-total"]').innerText()).includes('3000'),await p.locator('[data-testid="retprest-total"]').innerText());
 ok('échéance : 1er au 15 avril 2026',/15 avril 2026/.test(await p.evaluate(()=>document.body.innerText)));
 await p.locator('[data-testid="retprest-mois"]').selectOption('5');await p.waitForTimeout(300);
 ok('autre mois : message vide',(await p.locator('[data-testid="retprest-vide"]').count())===1);
 await toRap(p,'Liste annuelle des versements');await p.locator('[data-testid="versements-annee"]').fill('2026');await p.waitForTimeout(400);
 ok('liste annuelle : 2 lignes (honoraires, redevances)',(await p.locator('[data-testid="versements-ligne"]').count())===2,await p.locator('[data-testid="versements-ligne"]').count());
 ok('liste annuelle : total 20 000 et retenues 3 000',num(await p.locator('[data-testid="versements-total"]').innerText()).includes('20000')&&num(await p.locator('[data-testid="versements-retenues"]').innerText()).includes('3000'),await p.locator('[data-testid="versements-total"]').innerText());
 ok('aucune erreur JS (états)',errs.length===0,errs.slice(0,3));await p.close();}
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

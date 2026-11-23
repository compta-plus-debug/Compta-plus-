// v255 — acomptes provisionnels (article 81) et liste annuelle des versements (article 95).
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const txt=p=>p.evaluate(()=>document.body.innerText);
const mod=async(p,n)=>{await p.getByText(n,{exact:true}).first().click();await p.waitForTimeout(900)};
const num=s=>String(s).replace(/[\s  .,]/g,'');
const pageInit=()=>{try{sessionStorage.clear()}catch(e){}};
const ps=(id,name,date,gross,sal,bonus,kind,pw,status)=>({id,employeeId:id,employeeName:name,periodStart:date.slice(0,8)+'01',periodEnd:date,date,createdAt:date+'T10:00:00Z',baseSalary:gross-bonus,bonusAmount:bonus,bonusKind:kind,bonusWithholding:pw,bonusWithholdingRate:10,salaryWithholding:sal,grossTotal:gross,netTotal:gross-sal,status:status||'payé',paymentMode:'caisse'});
const toRap=async(p,tab)=>{await mod(p,'Rapports et analyse');await p.getByText('Déclarations fiscales',{exact:true}).first().click();await p.waitForTimeout(400);await p.getByText(tab,{exact:true}).first().click();await p.waitForTimeout(600)};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// A) acomptes provisionnels
{const {p,errs}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,pageInit});
 await toRap(p,'Impôt sur le Revenu');await p.getByText('Réel (bénéfice réel)').first().click();await p.waitForTimeout(300);
 await p.locator('[data-testid="ir-impot-n2"]').fill('1000000');await p.waitForTimeout(300);
 ok('acompte annuel : 60 % de 1 000 000 = 600 000',num(await p.locator('[data-testid="ir-acompte-annuel"]').innerText()).includes('600000'));
 ok('tranche 1 = 300 000',num(await p.locator('[data-testid="ir-acompte-t1"]').innerText()).includes('300000'));
 ok('tranche 2 = 300 000',num(await p.locator('[data-testid="ir-acompte-t2"]').innerText()).includes('300000'));
 await p.locator('[data-testid="ir-acomptes-verses"]').fill('50000');await p.waitForTimeout(300);
 ok('acomptes versés > impôt : crédit signalé',(await p.locator('[data-testid="ir-credit-acomptes"]').count())===1);
 ok('aucune erreur JS (acomptes)',errs.length===0,errs.slice(0,3));await p.close();}
// B) liste annuelle des versements
{const employees=[{id:1,name:'Jean',nif:'111-222'},{id:2,name:'Marie'}];
 const payslips=[ps(1,'Jean','2026-03-28',50000,2700,0,'prime',0),ps(1,'Jean','2026-05-28',52000,2700,2000,'prime',300),ps(2,'Marie','2026-04-28',40000,1000,0,'prime',0),ps(3,'Paul','2026-04-28',9000,0,0,'prime',0,'annulé'),ps(4,'Luc','2025-08-28',9999,0,0,'prime',0)];
 const suppliers=[{id:1,name:'Proprio',nif:'999'}];
 const purchases=[{id:21,supplier:'Proprio',date:'2026-02-10',label:'Loyer',amount:30000,status:'payé'},{id:22,supplier:'Proprio',date:'2026-03-10',label:'Loyer',amount:30000,status:'payé'},{id:23,supplier:'Autre',date:'2026-03-10',label:'Papier',amount:500,status:'payé'}];
 const entries=[21,22].map(id=>({id,date:'2026-02-10',label:'Loyer',lines:[{account:'613',debit:30000,credit:0},{account:'530',debit:0,credit:30000}]})).concat([{id:23,date:'2026-03-10',label:'Papier',lines:[{account:'607',debit:500,credit:0},{account:'530',debit:0,credit:500}]}]);
 const {p,errs}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,cats:{payslips,employees,suppliers,purchases,entries},pageInit});
 await toRap(p,'Liste annuelle des versements');
 await p.locator('[data-testid="versements-annee"]').fill('2026');await p.waitForTimeout(400);
 const n=await p.locator('[data-testid="versements-ligne"]').count();
 ok('lignes : Jean salaires, Jean primes, Marie salaires, Proprio loyers = 4',n===4,n);
 ok('total versé : 100 000 + 2 000 + 40 000 + 60 000 = 202 000',num(await p.locator('[data-testid="versements-total"]').innerText()).includes('202000'),await p.locator('[data-testid="versements-total"]').innerText());
 ok('total des retenues : 5 400 + 300 + 1 000 = 6 700',num(await p.locator('[data-testid="versements-retenues"]').innerText()).includes('6700'),await p.locator('[data-testid="versements-retenues"]').innerText());
 ok('Marie sans NIF : avertissement',(await p.locator('[data-testid="versements-sans-nif"]').count())===1);
 ok('échéance : octobre 2026',/octobre 2026/.test(await txt(p)));
 await p.locator('[data-testid="versements-annee"]').fill('2030');await p.waitForTimeout(400);
 ok('période sans versement : message vide',(await p.locator('[data-testid="versements-vide"]').count())===1);
 ok('aucune erreur JS (versements)',errs.length===0,errs.slice(0,3));await p.close();}
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

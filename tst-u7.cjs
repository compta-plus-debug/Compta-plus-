// v254 — état mensuel des retenues à verser à la DGI (articles 100 et 103), lu des bulletins de paie.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const mod=async(p,n)=>{await p.getByText(n,{exact:true}).first().click();await p.waitForTimeout(900)};
const num=s=>String(s).replace(/[\s  .,]/g,'');
const ps=(id,name,date,sal,pw,rate,kind,status,bonus)=>({id,employeeId:id,employeeName:name,periodStart:date.slice(0,8)+'01',periodEnd:date,date,createdAt:date+'T10:00:00Z',baseSalary:50000,bonusAmount:bonus||0,bonusWithholding:pw,bonusWithholdingRate:rate,bonusKind:kind,salaryWithholding:sal,grossTotal:50000+(bonus||0),netTotal:45000,status:status||'payé',paymentMode:'caisse'});
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const payslips=[
 ps(1,'Jean','2026-10-28',2700,300,15,'prime','payé',2000),
 ps(2,'Marie','2026-10-28',1000,200,10,'boni','payé',2000),
 ps(3,'Paul','2026-10-28',5000,0,0,'prime','annulé'),
 ps(4,'Luc','2026-10-28',0,0,0,'prime','payé'),
 ps(5,'Anne','2026-09-28',9999,0,0,'prime','payé')];
const {p,errs}=await boot(b,{settings:{companyName:'X',currency:'HTG',companyNIF:'123'},primary:true,cats:{payslips},pageInit:()=>{try{sessionStorage.clear()}catch(e){}}});
await mod(p,'Salaires (RH)');await p.getByText('Retenues DGI',{exact:true}).first().click();await p.waitForTimeout(500);
await p.locator('input[type=number]').first().fill('2026');await p.locator('[data-testid="retenues-mois"]').selectOption('10');await p.waitForTimeout(400);
ok('octobre : 2 lignes (annulé, sans retenue et autre mois exclus)',(await p.locator('[data-testid="retenues-ligne"]').count())===2,await p.locator('[data-testid="retenues-ligne"]').count());
ok('retenue sur salaires : 2 700 + 1 000 = 3 700',num(await p.locator('[data-testid="retenues-sal"]').innerText()).includes('3700'),await p.locator('[data-testid="retenues-sal"]').innerText());
ok('retenue sur primes et boni : 300 + 200 = 500',num(await p.locator('[data-testid="retenues-prime"]').innerText()).includes('500'),await p.locator('[data-testid="retenues-prime"]').innerText());
ok('total à verser : 4 200',num(await p.locator('[data-testid="retenues-total"]').innerText()).includes('4200'),await p.locator('[data-testid="retenues-total"]').innerText());
ok('échéance : 15 novembre 2026',/15 novembre 2026/.test(await p.evaluate(()=>document.body.innerText)));
await p.locator('[data-testid="retenues-mois"]').selectOption('8');await p.waitForTimeout(300);
ok('mois sans retenue : message vide',(await p.locator('[data-testid="retenues-vide"]').count())===1);
await p.locator('[data-testid="retenues-mois"]').selectOption('12');await p.waitForTimeout(300);
ok('décembre : échéance 15 janvier 2027',/15 janvier 2027/.test(await p.evaluate(()=>document.body.innerText)));
ok('aucune erreur JS',errs.length===0,errs.slice(0,3));
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

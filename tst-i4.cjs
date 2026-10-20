// Import d'un fichier dont les données sont identiques à celles de l'entreprise, et re-sélection du même fichier (v232).
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');const fs=require('fs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const init={settings:{companyName:"Lakay SA",currency:"HTG"},primary:true,pageInit:()=>{try{localStorage.removeItem('compta-plus-active-tab')}catch(e){}}};
const go=async(P)=>{await P.getByText('Administration',{exact:true}).first().click();await P.waitForTimeout(500);await P.getByRole('button',{name:'Données & Suivi'}).click();await P.waitForTimeout(300);await P.getByRole('button',{name:'Données',exact:true}).click();await P.waitForTimeout(500)};
const A=await boot(b,init);await go(A.p);
const [dl]=await Promise.all([A.p.waitForEvent('download'),A.p.getByRole('button',{name:'Exporter',exact:true}).click()]);await dl.saveAs('/tmp/i4.json');
// importer le fichier DANS LA MÊME entreprise (données identiques)
const inp=A.p.locator('[data-testid="backup-file"]');
await inp.setInputFiles('/tmp/i4.json');await A.p.waitForTimeout(1200);
ok('mêmes données : fenêtre ouverte',(await A.p.locator('[data-testid="restore-modal"]').count())===1,await A.p.evaluate(()=>document.body.innerText.slice(-300)));
await A.p.locator('[data-testid="restore-cancel"]').click();await A.p.waitForTimeout(300);
await inp.setInputFiles('/tmp/i4.json');await A.p.waitForTimeout(1200);
ok('2e sélection du même fichier : fenêtre ouverte',(await A.p.locator('[data-testid="restore-modal"]').count())===1);
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

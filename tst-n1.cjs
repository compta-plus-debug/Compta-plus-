// v241 : chargement à la demande des écrans lourds (chantier 8).
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');const fs=require('fs'),path=require('path');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const appJs=process.env.APP_JS||[path.join(__dirname,'..','docs','app.min.js'),path.join(__dirname,'docs','app.min.js')].find(f=>fs.existsSync(f));
const cdir=path.join(path.dirname(appJs),'chunks');
const pageInit=(delay)=>new Function("try{localStorage.removeItem('compta-plus-active-tab')}catch(e){};window.__CP_PREFETCH_DELAY="+delay+";");
const menu=async(P,label)=>{await P.getByText(label,{exact:true}).first().click();await P.waitForTimeout(700);};
(async()=>{
  const core=fs.readFileSync(appJs,'utf8');
  ok('l\'application de départ ne contient pas le code de la comptabilité (onglet « Exercices clos »)',!core.includes('exercices-panel')&&fs.readFileSync(path.join(cdir,'compta.js'),'utf8').includes('exercices-panel'));
  const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
  const base={settings:{companyName:'Chunk SA',currency:'HTG'},primary:true};
  // 1) ouverture à la demande
  {
    const reqs=[];
    const A=await boot(b,{...base,pageInit:pageInit(600000),onPage:(p)=>p.on('request',r=>{const u=r.url();if(u.includes('/chunks/'))reqs.push(u.split('/chunks/')[1]);})});
    const P=A.p;
    ok('au démarrage, aucun écran lourd n\'est demandé',reqs.length===0,reqs);
    ok('aucune erreur au démarrage',A.errs.length===0,A.errs.slice(0,2));
    await menu(P,'Comptabilité');
    ok('l\'écran Comptabilité est demandé une seule fois',reqs.filter(x=>x.startsWith('compta.js')).length===1,reqs);
    ok('la Comptabilité s\'affiche (onglet Clôture)',(await P.getByRole('button',{name:'Clôture',exact:true}).count())>0);
    ok('plus de message d\'attente',(await P.locator('[data-testid="chunk-loading"]').count())===0);
    await menu(P,'Stock et inventaire');
    ok('Stock : demandé puis affiché',reqs.some(x=>x.startsWith('stock.js'))&&(await P.locator('[data-testid="chunk-error"]').count())===0,reqs);
    await menu(P,'Salaires (RH)');
    ok('Salaires : demandé',reqs.some(x=>x.startsWith('paie.js')),reqs);
    await menu(P,'Comptabilité');
    ok('retour à la Comptabilité : pas de nouvelle demande',reqs.filter(x=>x.startsWith('compta.js')).length===1,reqs);
    ok('aucune erreur de script pendant la navigation',A.errs.length===0,A.errs.slice(0,3));
    await A.ctx.close();
  }
  // 2) échec de chargement puis nouvel essai
  {
    let casse=true;const reqs=[];
    const A=await boot(b,{...base,pageInit:pageInit(600000),chunkFail:(f)=>casse&&f.endsWith('stock.js')});
    const P=A.p;
    await menu(P,'Stock et inventaire');
    ok('échec : message clair avec bouton Réessayer',(await P.locator('[data-testid="chunk-error"]').count())===1&&(await P.locator('[data-testid="chunk-retry"]').innerText()).trim()==='Réessayer');
    const msg=await P.locator('[data-testid="chunk-error"]').innerText();
    ok('échec : aucun détail technique affiché',!/chunk|script|undefined|null|TypeError|Error|http|\.js/i.test(msg),msg);
    casse=false;await P.locator('[data-testid="chunk-retry"]').click();await P.waitForTimeout(900);
    ok('nouvel essai réussi : l\'écran s\'ouvre',(await P.locator('[data-testid="chunk-error"]').count())===0&&(await P.locator('[data-testid="chunk-loading"]').count())===0);
    await A.ctx.close();
  }
  // 3) fichier d'une autre version : demande de recharger la page
  {
    const A=await boot(b,{...base,pageInit:pageInit(600000)});
    const P=A.p;
    await P.route('http://app.test/chunks/creances.js**',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(cdir,'creances.js'),'utf8').replace(/v:"20\d{6}-\d{3}"/,'v:"20000101-001"')}));
    await menu(P,'Comptes clients (CRM)');
    ok('autre version : invitation à recharger',(await P.locator('[data-testid="chunk-stale"]').count())===1&&/Recharger la page/.test(await P.locator('[data-testid="chunk-retry"]').innerText()));
    await A.ctx.close();
  }
  // 4) préchargement en arrière-plan puis utilisation hors ligne
  {
    const reqs=[];
    const A=await boot(b,{...base,pageInit:pageInit(200),onPage:(p)=>p.on('request',r=>{const u=r.url();if(u.includes('/chunks/'))reqs.push(u.split('/chunks/')[1].split('?')[0]);})});
    const P=A.p;
    await P.waitForTimeout(9000);
    const n=await P.evaluate(()=>Object.keys(window.__cpc||{}).length);
    ok('préchargement : les 15 fichiers sont arrivés',n===15,{n,reqs});
    await A.ctx.setOffline(true);
    await menu(P,'Stock et inventaire');
    ok('hors ligne : l\'écran Stock s\'ouvre quand même',(await P.locator('[data-testid="chunk-error"]').count())===0&&(await P.locator('[data-testid="chunk-loading"]').count())===0);
    await menu(P,'Salaires (RH)');
    ok('hors ligne : l\'écran Salaires s\'ouvre quand même',(await P.locator('[data-testid="chunk-error"]').count())===0);
    await A.ctx.setOffline(false);
    await A.ctx.close();
  }
  await b.close();
  console.log('fails='+fails);process.exit(fails?1:0);
})();

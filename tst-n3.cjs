// v242 : mesures de performance (collecte, envoi, onglet Super admin).
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');const fs=require('fs'),path=require('path');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const appJs=process.env.APP_JS||[path.join(__dirname,'..','docs','app.min.js'),path.join(__dirname,'docs','app.min.js')].find(f=>fs.existsSync(f));
const VER=(fs.readFileSync(appJs,'utf8').match(/APP_VERSION="(20\d{6}-\d{3})"/)||[])[1];
const init=(extra)=>new Function("try{localStorage.removeItem('compta-plus-active-tab')}catch(e){};window.__PERF_SEND_DELAY=3500;"+(extra||''));
(async()=>{
  const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
  const base={settings:{companyName:'Perf SA',currency:'HTG'},primary:true};
  // 1) collecte et envoi
  {
    const A=await boot(b,{...base,pageInit:init()});const P=A.p;
    await P.getByText('Comptabilité',{exact:true}).first().click();await P.waitForTimeout(700);
    await P.waitForTimeout(4500);
    const rows=await P.evaluate(()=>window.__srv.tables.perf_metrics||[]);
    ok('une seule mesure envoyée',rows.length===1,rows.length);
    const r=rows[0]||{};
    ok('version de l\'application enregistrée',r.app_version===VER,r.app_version);
    ok('durées numériques cohérentes',Number.isInteger(r.ready_ms)&&r.ready_ms>=0&&r.ready_ms<60000&&Number.isInteger(r.load_ms)&&r.load_ms>=r.ready_ms,r);
    ok('durée de l\'écran Comptabilité chargé à la demande enregistrée',r.chunks&&typeof r.chunks.compta==='number'&&r.chunks.compta>=0,r.chunks);
    ok('aucun échec de chargement',r.chunk_failures===0&&r.slow===false,r);
    ok('aucune adresse e-mail ni donnée comptable dans la mesure',!JSON.stringify(r).includes('@')&&!('user_email' in r),Object.keys(r));
    ok('type d\'appareil limité à 160 caractères',typeof r.ua==='string'&&r.ua.length<=160);
    ok('aucune erreur JS',A.errs.length===0,A.errs.slice(0,2));
    await A.ctx.close();
  }
  // 2) table absente : l'application n'est pas gênée
  {
    const A=await boot(b,{...base,pageInit:init("window.__srv.tableMissing={perf_metrics:true};")});const P=A.p;
    await P.waitForTimeout(5000);
    ok('table absente : aucune erreur et application affichée',A.errs.length===0&&(await P.getByText('Comptabilité',{exact:true}).count())>0,A.errs.slice(0,2));
    await A.ctx.close();
  }
  // 3) échec de chargement d'un écran => mesure marquée lente
  {
    const A=await boot(b,{...base,pageInit:init(),chunkFail:(f)=>f.endsWith('stock.js')});const P=A.p;
    await P.getByText('Stock et inventaire',{exact:true}).first().click();await P.waitForTimeout(900);
    await P.waitForTimeout(4500);
    const r=(await P.evaluate(()=>window.__srv.tables.perf_metrics||[]))[0]||{};
    ok('échec de chargement : compté et mesure marquée lente',r.chunk_failures===1&&r.slow===true,r);
    await A.ctx.close();
  }
  // 4) onglet Performances du Super admin
  const sa=(rpc)=>new Function("try{localStorage.removeItem('compta-plus-active-tab')}catch(e){};const S=window.__srv;S.tables.platform_admins=[{email:'a@x.com'}];S.rpcH={perf_summary:"+rpc+"};");
  const dataset="(a)=>({data:{days:a.p_days,total:42,slow:4,failures:3,p50:2400,p90:7800,by_version:[{app_version:'20260830-242',n:30,p50:2200,p90:6000,slow:1},{app_version:'20260830-241',n:12,p50:3100,p90:11000,slow:3}],by_net:[{net:'4g',n:35,p50:2100,p90:5000},{net:null,n:7,p50:4000,p90:12000}],chunks:[{id:'compta',n:20,p50:240,p90:900},{id:'paie',n:5,p50:180,p90:400}],daily:[{day:'2026-10-21',n:20,p50:2300,p90:7000},{day:'2026-10-20',n:22,p50:2500,p90:8000}]},error:null})";
  const open=async(P)=>{await P.waitForTimeout(800);await P.getByText('Plateforme — Super Admin').first().click();await P.waitForTimeout(1200);await P.locator('[data-testid="sa-group-controle"]').click();await P.locator('[data-testid="sa-tab-perf"]').click();await P.waitForTimeout(900);};
  {
    const A=await boot(b,{...base,pageInit:sa(dataset)});const P=A.p;await open(P);
    const T=(id)=>P.locator(`[data-testid="${id}"]`);
    ok('onglet Performances affiché',(await T('perf-panel').count())===1);
    const cards=await T('perf-cards').innerText();
    ok('cartes : 42 mesures, médian 2,4 s, 9 sur 10 sous 7,8 s, 10 % lentes',/42/.test(cards)&&/2,4 s/.test(cards)&&/7,8 s/.test(cards)&&/10 %/.test(cards),cards);
    ok('avertissement sur les 3 écrans non chargés',/3 écran/.test(await T('perf-failures').innerText()));
    ok('tableau par version : deux versions',(await T('perf-versions').locator('tbody tr').count())===2);
    ok('connexion inconnue nommée en français',/inconnue/.test(await T('perf-net').innerText()));
    ok('écrans nommés en français (Comptabilité, Salaires)',/Comptabilité/.test(await T('perf-chunks').innerText())&&/Salaires/.test(await T('perf-chunks').innerText()));
    ok('par jour : deux lignes',(await T('perf-daily').locator('tbody tr').count())===2);
    await T('perf-days').selectOption('30');await P.waitForTimeout(700);
    ok('changement de période : nouvel appel',(await P.evaluate(()=>window.__srv.calls.filter(c=>c==='rpc perf_summary').length))>=2);
    const ov=await P.evaluate(()=>{const de=document.documentElement;return de.scrollWidth-de.clientWidth});
    ok('pas de défilement horizontal de la page',ov<=0,ov);
    ok('aucune erreur JS',A.errs.length===0,A.errs.slice(0,2));
    await A.ctx.close();
  }
  {
    const A=await boot(b,{...base,pageInit:sa("()=>({data:{total:0},error:null})")});const P=A.p;await open(P);
    ok('aucune mesure : message clair',(await P.locator('[data-testid="perf-empty"]').count())===1);
    await A.ctx.close();
  }
  {
    const A=await boot(b,{...base,pageInit:sa("()=>({data:null,error:{message:'function perf_summary does not exist'}})")});const P=A.p;await open(P);
    const t=await P.locator('[data-testid="perf-unavailable"]').innerText();
    ok('fonction absente : message sans détail technique',/pas encore disponibles/.test(t)&&!/function|perf_summary|exist/.test(t),t);
    await A.ctx.close();
  }
  await b.close();
  console.log('fails='+fails);process.exit(fails?1:0);
})();

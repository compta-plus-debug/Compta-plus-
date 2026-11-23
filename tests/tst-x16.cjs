// v360 — accueil lot A et 2c : bandeau, anneau des charges, dernières écritures, à traiter, trésorerie, ventes par jour.
// Les feuilles sont injectées comme le fait la page publiée (la harnais ne charge pas les liens CSS).
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');const fs=require('fs');const path=require('path');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const init=new Function("(function(){try{localStorage.clear()}catch(e){}var c=window.__srv.tables.companies[0];c.plan_tier='assisted';})();");
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const {p,errs}=await boot(b,{settings:{companyName:'Test Refonte',currency:'HTG'},primary:true,cats:{},pageInit:init});
const css=['refonte-lot1.css','refonte-lot2.css','refonte-lot2b.css'].map(f=>fs.readFileSync(path.join(__dirname,'docs',f),'utf8')).join('\n');
await p.locator('button',{hasText:'Tableau de bord'}).first().click();
await p.waitForTimeout(600);
await p.addStyleTag({content:css});
await p.setViewportSize({width:390,height:844});
await p.waitForTimeout(800);
ok('la page contient le conteneur du tableau de bord',(await p.locator('.compta-accueil').count())===1);
const r=await p.evaluate(()=>{const t=document.querySelector('.compta-accueil .grid.grid-cols-2.md\\:grid-cols-4 > div');if(!t)return null;const cs=getComputedStyle(t);return {top:cs.borderTopColor,radius:cs.borderTopLeftRadius,shadow:cs.boxShadow}});
ok('tuiles : filet coloré et coins arrondis appliqués',!!r&&r.top==='rgb(15, 107, 92)'&&r.radius==='16px'&&r.shadow!=='none',r);
const sw=await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
const txt=await p.evaluate(()=>document.body.innerText);
for (const m of ['À la une','Répartition des charges','Dernières écritures','À traiter','Évolution de la trésorerie','Ventes par jour']) ok('section présente : '+m, txt.includes(m));
ok('aucun débordement horizontal à 390 px',sw<=1,{sw});
ok('aucune erreur JS',errs.length===0,errs);
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

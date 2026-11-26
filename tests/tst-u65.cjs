// v364 — refonte visuelle de l'espace multi-entreprises (maquette C) : appliquée au tableau de bord du groupe, propriétaire seulement.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const initGroupe=()=>{const S=window.__srv;S.tables.platform_admins=[];S.tables.superadmin_log=[];S.tables.billing_settings=[];
 S.tables.company_groups=[{id:'g1',name:'Groupe Lakay',plan_status:'active',trial_ends_at:null,max_companies:5,owner_user_id:'u1'}];
 S.tables.companies=[{id:'c1',name:'Lakay SA',plan_status:'active',plan_tier:'group',trial_ends_at:null,created_at:'2025-01-01T00:00:00Z',sectors:[],extra_blocks:[],group_id:'g1'},];
 S.tables.company_members=[{id:7,company_id:'c1',email:'a@x.com',role:'Administrateur',user_id:'u1',is_primary_admin:true,created_at:'2026-01-01'}];
};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const sortie=process.env.SORTIE_CAPTURE||require('path').join(require('os').tmpdir(),'groupe');
for(const w of [1280,390]){
 const {p,errs}=await boot(b,{ctx:await b.newContext({viewport:{width:w,height:900}}),skipSeed:true,pageInit:new Function('('+initGroupe.toString()+')()'),settings:{companyName:'Lakay SA'}});
 await p.waitForTimeout(1500);
 const bouton=p.locator('button:has-text("consolidée")').first();
 await bouton.waitFor({timeout:8000}).catch(()=>{});const visible=await bouton.isVisible().catch(()=>false);
 ok('bouton « Tableau de bord du groupe » visible ('+w+'px)',visible);
 if(visible){await bouton.click();await p.waitForTimeout(1800);}
 // Le bac à sable n'a pas la feuille Tailwind : on ajoute seulement la règle « overflow-x-auto » qu'elle fournit.
 await p.addStyleTag({content:'.overflow-x-auto{overflow-x:auto}.w-full{width:100%}'});await p.waitForTimeout(300);
 const m=await p.evaluate(()=>{const z=document.querySelector('.compta-groupe');
   const th=document.querySelector('.compta-groupe table thead tr');
   return {conteneur:!!z,styleGroupe:[...document.querySelectorAll('style')].some(s=>/compta-groupe/.test(s.textContent)),
     fondEntete:th?getComputedStyle(th).backgroundColor:null,docW:document.documentElement.scrollWidth,vw:innerWidth};});
 console.log('mesures',w,JSON.stringify(m));
 ok('conteneur .compta-groupe présent ('+w+'px)',m.conteneur&&m.styleGroupe,m);
 ok('pas de défilement horizontal ('+w+'px)',m.docW<=m.vw,m);
 ok('aucune erreur JS ('+w+'px)',errs.length===0,errs.slice(0,3));
 await p.screenshot({path:sortie+'-'+w+'.png',fullPage:true});
 await p.context().close();
}
await b.close();console.log(fails?fails+' échec(s)':'TOUT PASSE');process.exit(fails?1:0);})().catch(e=>{console.error(e);process.exit(1)});

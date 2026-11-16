// v337 — tableau de bord général (téléphone) : les cartes ne débordent plus, même avec un email long dans le nom d'entreprise.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const initSA=()=>{const S=window.__srv;S.tables.platform_admins=[{email:'a@x.com'}];S.tables.superadmin_log=[];S.tables.billing_invoices=[];S.tables.billing_settings=[];S.tables.company_groups=[];
 S.tables.company_members=[{id:7,company_id:'c1',email:'a@x.com',role:'Administrateur',user_id:'u1',is_primary_admin:true,created_at:'2026-01-01'}];
 S.tables.companies=[{id:'c1',name:'Comptedetest1comptaplus@gmail.com',plan_status:'trial',plan_tier:'standard',trial_ends_at:null,group_id:null}];};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
for(const w of [390,320]){
 const {p,errs}=await boot(b,{ctx:await b.newContext({viewport:{width:w,height:800}}),skipSeed:true,pageInit:new Function('('+initSA.toString()+')()'),settings:{companyName:'Comptedetest1comptaplus@gmail.com'}});
 await p.waitForTimeout(1500);
 const m=await p.evaluate(()=>{const t=[...document.querySelectorAll('div')].find(d=>d.childElementCount===0&&/Tableau de bord général/.test(d.textContent));
   const cards=[...document.querySelectorAll('button')].filter(x=>/Plateforme|Ouvrir mon entreprise|Créer une nouvelle|Centre de gestion/.test(x.textContent));
   return {titre:!!t,docW:document.documentElement.scrollWidth,vw:innerWidth,
     cartes:cards.map(c=>({txt:c.textContent.trim().slice(0,40),right:Math.round(c.getBoundingClientRect().right),left:Math.round(c.getBoundingClientRect().left)}))};});
 console.log('largeur',w,JSON.stringify(m));
 ok('titre du tableau de bord affiché ('+w+'px)',m.titre,m);
 ok('pas de défilement horizontal ('+w+'px)',m.docW<=m.vw,m);
 ok('cartes dans l\'écran ('+w+'px)',m.cartes.length>0&&m.cartes.every(c=>c.right<=m.vw-8&&c.left>=0),m);
 ok('aucune erreur JS ('+w+'px)',errs.length===0,errs);
 await p.context().close();
}
await b.close();console.log(fails?fails+' échec(s)':'tous PASS');process.exit(fails?1:0);})().catch(e=>{console.error(e);process.exit(1)});

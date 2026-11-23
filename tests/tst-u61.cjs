// v338 — « Créer une nouvelle entreprise » (tableau de bord) passe par create-company ; refus de nom affiché, sans rechargement.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const initSA=()=>{const S=window.__srv;S.tables.platform_admins=[{email:'a@x.com'}];S.tables.superadmin_log=[];S.tables.billing_invoices=[];S.tables.billing_settings=[];S.tables.company_groups=[];
 S.tables.company_members=[{id:7,company_id:'c1',email:'a@x.com',role:'Administrateur',user_id:'u1',is_primary_admin:true,created_at:'2026-01-01'}];
 S.tables.companies=[{id:'c1',name:'Ma Boutique',plan_status:'trial',plan_tier:'standard',trial_ends_at:null,group_id:null}];
 S.fnH={'create-company':async function(o){sessionStorage.setItem('rec',JSON.stringify(o.body));
   if(/@/.test(o.body.companyName||'')) return {data:null,error:{message:'x',context:{json:async()=>({error:'Le nom de l\'entreprise ne peut pas être une adresse email. Indiquez le nom de votre commerce ou de votre entreprise.'})}}};
   return {data:{success:true,alreadyExisted:false,companyId:'c2',companyName:o.body.companyName},error:null};}};};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p,errs}=await boot(b,{ctx:await b.newContext({viewport:{width:390,height:800}}),skipSeed:true,pageInit:new Function('('+initSA.toString()+')()')});
 await p.waitForTimeout(1200);
 await p.getByText('Créer une nouvelle entreprise').first().click();
 await p.getByPlaceholder("Nom de l'entreprise").fill('Boutique Nord');
 await p.getByRole('button',{name:'Créer',exact:true}).click();
 await p.waitForTimeout(1500);
 const rec=await p.evaluate(()=>sessionStorage.getItem('rec'));
 const body=rec?JSON.parse(rec):null;
 ok('le bouton appelle create-company',!!body,rec);
 ok('avec le drapeau entreprise supplémentaire',body&&body.additional===true&&body.companyName==='Boutique Nord',body);
 ok('aucune erreur JavaScript',errs.length===0,errs);
 await p.context().close();}
{const {p,errs}=await boot(b,{ctx:await b.newContext({viewport:{width:390,height:800}}),skipSeed:true,pageInit:new Function('('+initSA.toString()+')()')});
 await p.waitForTimeout(1200);
 const msgs=[];p.on('dialog',d=>msgs.push(d.message()));
 await p.getByText('Créer une nouvelle entreprise').first().click();
 await p.getByPlaceholder("Nom de l'entreprise").fill('jean@gmail.com');
 await p.getByRole('button',{name:'Créer',exact:true}).click();
 await p.waitForTimeout(1200);
 const txt=await p.evaluate(()=>document.body.innerText);
 ok('refus de nom affiché à l\'utilisateur (alerte)',msgs.some(m=>/ne peut pas être une adresse email/.test(m)),msgs);
 ok('pas de rechargement après refus (saisie conservée)',(await p.getByPlaceholder("Nom de l'entreprise").count())===1,txt.slice(0,80));
 ok('aucune erreur JavaScript (refus)',errs.length===0,errs);
 await p.context().close();}
await b.close();console.log(fails?fails+' échec(s)':'tous PASS');process.exit(fails?1:0);})().catch(e=>{console.error(e);process.exit(1)});

// v339 — Super Admin > Entreprises : « Créer un groupe multi-entreprises » passe par la fonction serveur create-group
// (action create-for-company) ; le groupe apparaît, l'entreprise est rattachée, et un échec serveur est affiché sans rien créer.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const initSA=(echec)=>{const S=window.__srv;S.tables.platform_admins=[{email:'a@x.com'}];S.tables.superadmin_log=[];S.tables.billing_invoices=[];S.tables.billing_settings=[];
 S.tables.company_groups=[];
 S.tables.company_members=[{id:7,company_id:'c1',email:'a@x.com',role:'Administrateur',user_id:'u1',is_primary_admin:true,created_at:'2026-01-01'}];
 S.tables.companies=[{id:'c1',name:'Ma Boutique',plan_status:'trial',plan_tier:'standard',trial_ends_at:null,group_id:null}];
 window.__calls=[];
 S.fnH={'create-group':async function(o){window.__calls.push(o.body);
   if(echec) return {data:null,error:{message:'x',context:{json:async()=>({error:'Administrateur principal introuvable pour cette entreprise — impossible de définir le propriétaire du groupe.'})}}};
   var id='g1';S.tables.company_groups.push({id:id,owner_user_id:'u1',name:o.body.name,plan_status:'active'});
   S.tables.companies[0].group_id=id;
   return {data:{success:true,groupId:id,groupName:o.body.name,groupMaxCompanies:5},error:null};}};
};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// A) succès
{const {p,errs}=await boot(b,{settings:{companyName:'X'},primary:true,pageInit:new Function('('+initSA.toString()+')(false)')});
 await p.waitForTimeout(900);
 await p.getByText('Super Admin',{exact:false}).first().click();await p.waitForTimeout(900);
 await g(p,'sa-group-activite').click();await g(p,'sa-tab-entreprises').click();await p.waitForTimeout(900);await p.locator('button:has-text("Ma Boutique")').first().click();await p.waitForTimeout(500);
 await p.evaluate(()=>{window.prompt=()=>'Groupe Test';});
 await p.getByText('Créer un groupe multi-entreprises',{exact:false}).first().click();await p.waitForTimeout(1200);
 const calls=await p.evaluate(()=>window.__calls);
 ok('appel create-group, action create-for-company, entreprise c1',calls.length===1&&calls[0].action==='create-for-company'&&calls[0].companyId==='c1'&&calls[0].name==='Groupe Test',calls);
 const groups=await p.evaluate(()=>window.__srv.tables.company_groups.length);
 ok('un seul groupe créé côté serveur',groups===1,groups);
 const txt=await p.evaluate(()=>document.body.innerText);
 ok('message de confirmation affiché',/Groupe « Groupe Test » créé pour Ma Boutique/.test(txt));
 ok('aucune erreur de page',errs.length===0,errs);
 await p.close();}
// B) refus serveur : rien créé, message affiché
{const {p,errs}=await boot(b,{settings:{companyName:'X'},primary:true,pageInit:new Function('('+initSA.toString()+')(true)')});
 await p.waitForTimeout(900);
 await p.getByText('Super Admin',{exact:false}).first().click();await p.waitForTimeout(900);
 await g(p,'sa-group-activite').click();await g(p,'sa-tab-entreprises').click();await p.waitForTimeout(900);await p.locator('button:has-text("Ma Boutique")').first().click();await p.waitForTimeout(500);
 await p.evaluate(()=>{window.prompt=()=>'Groupe Test';});
 await p.getByText('Créer un groupe multi-entreprises',{exact:false}).first().click();await p.waitForTimeout(1200);
 const groups=await p.evaluate(()=>window.__srv.tables.company_groups.length);
 ok('refus serveur : aucun groupe créé',groups===0,groups);
 const txt=await p.evaluate(()=>document.body.innerText);
 ok('refus serveur : message affiché',/Administrateur principal introuvable/.test(txt));
 await p.close();}
console.log(fails===0?'TOUT PASSE fails=0':'fails='+fails);process.exit(fails?1:0);
})().catch(e=>{console.log('FAIL exception '+e);process.exit(1)});

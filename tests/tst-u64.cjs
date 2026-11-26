// v364 — groupes : liste dans le Centre de gestion (nom, entreprises, comptes, forfait) ; suppression d'un groupe depuis le Super admin (confirmation par le nom, entreprises détachées).
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const init=()=>{const S=window.__srv;
 S.tables.platform_admins=[{email:'a@x.com'}];S.tables.superadmin_log=[];S.tables.billing_settings=[];
 S.tables.companies=[
  {id:'c1',name:'Lakay SA',plan_status:'active',plan_tier:'standard',trial_ends_at:null,created_at:'2025-01-01T00:00:00Z',sectors:[],extra_blocks:[],group_id:'g1'},
  {id:'c2',name:'Boutique Sœurs',plan_status:'active',plan_tier:'standard',trial_ends_at:null,created_at:'2025-01-01T00:00:00Z',sectors:[],extra_blocks:[],group_id:'g1'},
  {id:'c3',name:'Seule SARL',plan_status:'active',plan_tier:'standard',trial_ends_at:null,created_at:'2025-01-01T00:00:00Z',sectors:[],extra_blocks:[]}];
 S.tables.company_groups=[{id:'g1',name:'Groupe Lakay',plan_status:'active',trial_ends_at:null,max_companies:5,owner_user_id:'u1'}];
 S.tables.company_members=[
  {id:7,company_id:'c1',email:'a@x.com',role:'Administrateur',user_id:'u1',is_primary_admin:true,created_at:'2026-01-01'},
  {id:8,company_id:'c2',email:'b@x.com',role:'Vendeur',user_id:'u2',is_primary_admin:true,created_at:'2026-01-01'},
  {id:9,company_id:'c3',email:'c@x.com',role:'Administrateur',user_id:'u3',is_primary_admin:true,created_at:'2026-01-01'}];
 window.__rpcAppels=[];
 S.rpcH={
  company_activity_summary:()=>({data:[],error:null}),
  delete_group_detach:(a)=>{window.__rpcAppels.push(a);
   S.tables.companies.forEach(c=>{if(c.group_id===a.target_group_id){c.group_id=null;c.plan_tier='standard';}});
   S.tables.company_groups=S.tables.company_groups.filter(x=>x.id!==a.target_group_id);
   return {data:null,error:null};}};
};
const mk=(f)=>new Function('const init='+init.toString()+';('+f.toString()+')()');
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// 1. Centre de gestion : onglet Groupes
{const {p,errs}=await boot(b,{settings:{companyName:'X'},primary:true,pageInit:mk(init)});
 await p.getByText('Centre de gestion',{exact:false}).first().click();await p.waitForTimeout(1000);
 await p.locator('button:has-text("Groupes")').first().click();await p.waitForTimeout(700);
 const lignes=g(p,'groupe-ligne');
 ok('Centre de gestion : un groupe listé',await lignes.count()===1,await lignes.count());
 const t=await lignes.first().innerText().catch(()=>'');
 ok('nom du groupe affiché',/Groupe Lakay/.test(t),t);
 ok('nombre d\'entreprises affiché (2)',/2 entreprises/.test(t),t);
 ok('comptes rattachés listés (a@x.com, b@x.com)',/a@x\.com/.test(t)&&/b@x\.com/.test(t)&&!/c@x\.com/.test(t),t);
 ok('forfait Extension avec prix 230 $',/Extension/.test(t)&&/230/.test(t),t);
 ok('aucune erreur JS (Centre de gestion, Groupes)',errs.length===0,errs.slice(0,3));
 await p.close();}
// 2. Super admin : suppression annulée (nom incorrect) puis confirmée
{const {p,errs}=await boot(b,{settings:{companyName:'X'},primary:true,pageInit:mk(init)});
 await p.getByText('Super Admin',{exact:false}).first().click();await p.waitForTimeout(900);
 await g(p,'sa-group-activite').click();await g(p,'sa-tab-entreprises').click();await p.waitForTimeout(900);
 await p.locator('button:has-text("Lakay SA")').first().click();await p.waitForTimeout(500);
 await p.evaluate(()=>{window.prompt=()=>'mauvais nom';});
 await g(p,'sa-group-delete').first().click();await p.waitForTimeout(500);
 ok('nom incorrect : aucun appel au serveur',(await p.evaluate(()=>window.__rpcAppels.length))===0);
 ok('nom incorrect : groupe toujours présent',(await p.evaluate(()=>window.__srv.tables.company_groups.length))===1);
 await p.evaluate(()=>{window.prompt=()=>'Groupe Lakay';});
 await g(p,'sa-group-delete').first().click();await p.waitForTimeout(800);
 ok('nom exact : une seule suppression envoyée',(await p.evaluate(()=>window.__rpcAppels.length))===1,await p.evaluate(()=>window.__rpcAppels));
 const etat=await p.evaluate(()=>({groupes:window.__srv.tables.company_groups.length,c1:window.__srv.tables.companies.find(c=>c.id==='c1'),c2:window.__srv.tables.companies.find(c=>c.id==='c2'),c3:window.__srv.tables.companies.find(c=>c.id==='c3')}));
 ok('groupe supprimé',etat.groupes===0,etat);
 ok('entreprises détachées et conservées',etat.c1&&etat.c1.group_id===null&&etat.c2.group_id===null&&etat.c1.name==='Lakay SA',etat);
 ok('aucune autre entreprise touchée',etat.c3.group_id===undefined||etat.c3.group_id===null,etat.c3);
 ok('aucune erreur JS (Super admin, suppression de groupe)',errs.length===0,errs.slice(0,3));
 await p.close();}
console.log(fails?('fails='+fails):'TOUT PASSE');process.exit(fails?1:0);
})();

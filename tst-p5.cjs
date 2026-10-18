const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const txt=p=>p.evaluate(()=>document.body.innerText);
const init=()=>{const S=window.__srv;const day=(n)=>new Date(Date.now()+n*86400000);const iso=(n)=>day(n).toISOString();const d=(n)=>iso(n).slice(0,10);
 S.tables.platform_admins=[{email:'a@x.com'}];S.tables.superadmin_log=[];
 S.tables.companies=[{id:'c1',name:'Lakay SA',plan_status:'active',plan_tier:'standard',trial_ends_at:null,created_at:iso(-300)},
  {id:'e1',name:'FinProche',plan_status:'trial',trial_ends_at:d(3),created_at:iso(-27)},
  {id:'e2',name:'Expire',plan_status:'trial',trial_ends_at:d(-4),created_at:iso(-34)},
  {id:'e3',name:'Dormante',plan_status:'trial',trial_ends_at:d(20),created_at:iso(-10)},
  {id:'e4',name:'PayanteMorte',plan_status:'active',trial_ends_at:d(10),created_at:iso(-90)},
  {id:'e5',name:'PayanteVive',plan_status:'active',trial_ends_at:d(10),created_at:iso(-90)},
  {id:'e6',name:'Neuve',plan_status:'trial',trial_ends_at:d(29),created_at:iso(-1)}];
 S.tables.company_members=[
  {id:1,company_id:'e1',email:'fin@x.com',role:'Administrateur',user_id:'uf',is_primary_admin:true},
  {id:2,company_id:'e2',email:'exp@x.com',role:'Administrateur',user_id:'u2',is_primary_admin:true},
  {id:3,company_id:'e3',email:'dor@x.com',role:'Administrateur',user_id:'u3',is_primary_admin:true},
  {id:4,company_id:'e4',email:'pm@x.com',role:'Administrateur',user_id:'u4',is_primary_admin:true},
  {id:5,company_id:'e5',email:'pv@x.com',role:'Administrateur',user_id:'u5',is_primary_admin:true},
  {id:6,company_id:'e6',email:'neu@x.com',role:'Administrateur',user_id:'u6',is_primary_admin:true},
  {id:7,company_id:'c1',email:'a@x.com',role:'Administrateur',user_id:'u1',is_primary_admin:true,created_at:'2026-01-01'}];
 const A=(id,n,la)=>({company_id:id,invoices_count:n,entries_count:0,products_count:0,clients_count:0,purchases_count:0,last_activity:la});
 S.rpcH={company_activity_summary:()=>({data:[A('e1',5,iso(-1)),A('e2',2,iso(-20)),A('e3',0,null),A('e4',3,iso(-60)),A('e5',9,iso(-2)),A('e6',0,null)],error:null})};};
const goSA=async p=>{await p.getByText('Super Admin',{exact:false}).first().click();await p.waitForTimeout(900);};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p,errs}=await boot(b,{settings:{companyName:'X'},primary:true,pageInit:new Function('('+init.toString()+')()')});
 await goSA(p);
 await p.locator('[data-testid="sa-group-essais"]').click();await p.locator('[data-testid="sa-tab-suivi"]').click();await p.waitForTimeout(1000);
 const cnt=async id=>(await p.locator('[data-testid="suivi-count-'+id+'"]').innerText()).replace(/\D/g,'');
 ok('fin proche : 1 (FinProche)',await cnt('bientot')==='1',await cnt('bientot'));
 ok('expirés : 1 (Expire)',await cnt('expires')==='1',await cnt('expires'));
 ok('inactifs : 1 (Dormante, pas Neuve)',await cnt('inactifs')==='1',await cnt('inactifs'));
 ok('payantes inactives : 1 (PayanteMorte)',await cnt('payantes')==='1',await cnt('payantes'));
 const t=await txt(p);
 ok('entonnoir 30 jours : 3 inscrites',/30 derniers jours/.test(t)&&(await p.locator('[data-testid="funnel-30"]').innerText()).includes('3'),await p.locator('[data-testid="funnel-30"]').innerText());
 ok('entonnoir global : 3 payantes',/3\s*\n?payantes/.test((await p.locator('[data-testid="funnel-all"]').innerText()).replace(/\n+/g,'\n')),await p.locator('[data-testid="funnel-all"]').innerText());
 const href=await p.locator('[data-testid="suivi-bientot"] [data-testid="suivi-row"]',{hasText:'FinProche'}).locator('[data-testid="suivi-relance"]').getAttribute('href');
 ok('relance : mailto vers le propriétaire',/^mailto:fin@x\.com\?subject=/.test(href)&&/3%20jour/.test(href),href);
 // prolonger Expire
 await p.locator('[data-testid="suivi-expires"] [data-testid="suivi-prolonger"]').first().click();await p.waitForTimeout(800);
 const co=await p.evaluate(()=>window.__srv.tables.companies.find(c=>c.id==='e2'));
 ok('prolongation : essai actif +7 j',co.plan_status==='trial'&&Math.round((new Date(co.trial_ends_at)-Date.now())/86400000)>=6,co);
 ok('prolongation journalisée',await p.evaluate(()=>window.__srv.tables.superadmin_log.some(l=>l.action_type==='essai_prolonge'&&l.target_description==='Expire'&&l.actor_email==='a@x.com')));
 ok('liste expirés vidée après prolongation',await cnt('expires')==='0',await cnt('expires'));
 // relance journalisée (sans quitter la page)
 await p.evaluate(()=>{document.querySelectorAll('a[data-testid="suivi-relance"]').forEach(a=>a.addEventListener('click',e=>e.preventDefault()))});
 await p.locator('[data-testid="suivi-bientot"] [data-testid="suivi-row"]',{hasText:'FinProche'}).locator('[data-testid="suivi-relance"]').click();await p.waitForTimeout(600);
 ok('relance journalisée',await p.evaluate(()=>window.__srv.tables.superadmin_log.some(l=>l.action_type==='relance'&&l.target_description==='FinProche')));
 ok('« relancé il y a » affiché',/relancé il y a 0 j/.test(await txt(p)),(await txt(p)).slice(0,100));
 // Journal
 await p.locator('[data-testid="sa-group-controle"]').click();await p.locator('[data-testid="sa-tab-journal"]').click();await p.waitForTimeout(800);
 ok('journal : 2 lignes',await p.locator('[data-testid="journal-row"]').count()===2,await p.locator('[data-testid="journal-row"]').count());
 await p.locator('[data-testid="journal-filter"]').selectOption('relance');await p.waitForTimeout(300);
 ok('journal : filtre relance = 1',await p.locator('[data-testid="journal-row"]').count()===1);
 await p.locator('[data-testid="journal-filter"]').selectOption('');await p.locator('[data-testid="journal-search"]').fill('expire');await p.waitForTimeout(300);
 ok('journal : recherche',await p.locator('[data-testid="journal-row"]').count()===1);
 ok('aucune erreur JS',errs.length===0,errs.slice(0,3));await p.close();}
// table absente : pas de plantage
{const {p,errs}=await boot(b,{settings:{companyName:'X'},primary:true,pageInit:new Function('('+init.toString()+')();window.__srv.tableMissing={superadmin_log:true};')});
 await goSA(p);await p.locator('[data-testid="sa-group-controle"]').click();await p.locator('[data-testid="sa-tab-journal"]').click();await p.waitForTimeout(900);
 ok('table absente : journal vide, pas d\'erreur',/Aucune action enregistrée/.test(await txt(p))&&errs.length===0,errs.slice(0,2));
 await p.locator('[data-testid="sa-group-essais"]').click();await p.locator('[data-testid="sa-tab-suivi"]').click();await p.waitForTimeout(800);
 ok('table absente : suivi s\'affiche',await p.locator('[data-testid="suivi-panel"]').count()===1);await p.close();}
console.log('fails='+fails);await b.close();process.exit(fails?1:0)})();

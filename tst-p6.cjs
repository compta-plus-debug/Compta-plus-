const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const txt=p=>p.evaluate(()=>document.body.innerText);
const noMember=(extra)=>new Function("(function(){if(!crypto.randomUUID)crypto.randomUUID=function(){return 'g'+Math.random().toString(36).slice(2)};var S=window.__srv;S.tables.company_members=[];S.tables.companies=[];"+(extra||"")+"})();");
const blockedFn="S.fnH={'create-company':async function(o){return {data:null,error:{message:'x',context:{json:async function(){return {error:'Cette adresse email a déjà bénéficié de 2 essais gratuits. Pour continuer, choisissez un forfait ou écrivez-nous à support@comptaplus.app : nous vous aiderons.',code:'trial_limit'}}}}}}};";
const allowFn="S.fnH={'create-company':async function(o){S.lastCheck=o.body;return {data:{success:true,allowed:true},error:null}}};";
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// A) Groupe : refus serveur -> bannière, aucun groupe créé
{const {p,errs}=await boot(b,{skipSeed:true,pageInit:noMember(blockedFn+"S.tables.company_groups=[];")});
 await p.locator('input[placeholder*="Nom de l\'entreprise"]').fill('Mon Groupe');
 await p.getByText('Extension',{exact:false}).first().click();
 await p.getByRole('button',{name:'Commencer'}).click();await p.waitForTimeout(1200);
 ok('A : refus affiché',/2 essais gratuits/.test(await p.locator('[data-testid="welcome-error"]').innerText().catch(()=>'')));
 ok('A : aucun groupe créé',await p.evaluate(()=>window.__srv.tables.company_groups.length)===0);
 ok('A : aucune erreur JS',errs.length===0,errs.slice(0,3));await p.close();}
// B) Groupe : autorisé -> vérification envoyée avec checkOnly puis groupe créé
{const {p,errs}=await boot(b,{skipSeed:true,pageInit:noMember(allowFn+"S.tables.company_groups=[];")});
 await p.locator('input[placeholder*="Nom de l\'entreprise"]').fill('Mon Groupe');
 await p.getByText('Extension',{exact:false}).first().click();
 await p.getByRole('button',{name:'Commencer'}).click();await p.waitForTimeout(1500);
 const chk=await p.evaluate(()=>window.__srv.lastCheck);
 ok('B : vérification checkOnly envoyée',chk&&chk.checkOnly===true&&chk.companyName==='Mon Groupe',chk);
 ok('B : groupe créé après accord',await p.evaluate(()=>window.__srv.tables.company_groups.length)===1);
 ok('B : aucune erreur JS',errs.length===0,errs.slice(0,3));await p.close();}
// B2) Groupe : réponse inattendue (ancienne fonction) -> pas de groupe
{const {p,errs}=await boot(b,{skipSeed:true,pageInit:noMember("S.fnH={'create-company':async function(){return {data:{success:true,companyId:'z'},error:null}}};S.tables.company_groups=[];")});
 await p.locator('input[placeholder*="Nom de l\'entreprise"]').fill('Mon Groupe');
 await p.getByText('Extension',{exact:false}).first().click();
 await p.getByRole('button',{name:'Commencer'}).click();await p.waitForTimeout(1200);
 ok('B2 : pas de groupe sans accord explicite',await p.evaluate(()=>window.__srv.tables.company_groups.length)===0);await p.close();}
// C) Cabinet : inscription -> écran « validation en cours »
{const {p,errs}=await boot(b,{skipSeed:true,pageInit:noMember("S.tables.cabinets=[];")});
 await p.locator('[data-testid="go-cabinet"]').click();await p.waitForTimeout(300);
 ok('C : formulaire cabinet',await p.locator('[data-testid="cabinet-form"]').count()===1);
 await p.locator('[data-testid="cab-submit"]').click();await p.waitForTimeout(400);
 ok('C : nom obligatoire (rien créé)',await p.evaluate(()=>window.__srv.tables.cabinets.length)===0);
 await p.locator('[data-testid="cab-name"]').fill('Cabinet Dupont');await p.locator('[data-testid="cab-phone"]').fill('+509 1234 5678');
 await p.locator('[data-testid="cab-submit"]').click();await p.waitForTimeout(900);
 const row=await p.evaluate(()=>window.__srv.tables.cabinets[0]);
 ok('C : demande en attente enregistrée',row&&row.status==='pending'&&row.owner_email==='a@x.com'&&row.name==='Cabinet Dupont',row);
 ok('C : aucune entreprise créée',await p.evaluate(()=>window.__srv.tables.companies.length)===0&&!(await p.evaluate(()=>window.__srv.calls.includes('fn create-company'))));
 ok('C : écran validation en cours',await p.locator('[data-testid="cabinet-status"][data-status="pending"]').count()===1&&/validation en cours/.test(await txt(p)));
 ok('C : aucune erreur JS',errs.length===0,errs.slice(0,3));await p.close();}
// D) Cabinet déjà inscrit : écrans selon le statut
for(const [st,re] of [['active',/cabinet est validé/],['refused',/n'a pas pu être acceptée/],['suspended',/suspendu/]]){
 const {p,errs}=await boot(b,{skipSeed:true,pageInit:noMember("S.tables.cabinets=[{id:'k1',name:'Cab X',owner_email:'A@x.com',status:'"+st+"',created_at:'2026-10-01'}];")});
 ok('D '+st+' : écran adapté',await p.locator('[data-testid="cabinet-status"][data-status="'+st+'"]').count()===1&&re.test(await txt(p)),(await txt(p)).slice(0,200));
 ok('D '+st+' : pas de formulaire entreprise',!/Bienvenue sur Compta\+/.test(await txt(p)));
 ok('D '+st+' : aucune erreur JS',errs.length===0,errs.slice(0,3));await p.close();}
// E) Table absente : écran entreprise habituel, bouton cabinet sans plantage
{const {p,errs}=await boot(b,{skipSeed:true,pageInit:noMember("S.tableMissing={cabinets:true};")});
 ok('E : écran d\'accueil habituel',/Bienvenue sur Compta\+/.test(await txt(p)));
 await p.locator('[data-testid="go-cabinet"]').click();await p.waitForTimeout(200);
 await p.locator('[data-testid="cab-name"]').fill('Cab');await p.locator('[data-testid="cab-submit"]').click();await p.waitForTimeout(900);
 ok('E : pas de plantage, toujours le formulaire',await p.locator('[data-testid="cabinet-form"]').count()===1&&errs.length===0,errs.slice(0,2));await p.close();}
// F) Centre de gestion : valider / refuser
{const init=()=>{if(!crypto.randomUUID)crypto.randomUUID=function(){return 'g'+Math.random().toString(36).slice(2)};const S=window.__srv;S.tables.platform_admins=[];S.tables.management_collaborators=[{id:'m1',email:'a@x.com',role:'gestionnaire',permissions:{entreprises:true,offres:true,cabinets:true}}];
 S.tables.cabinet_billing=[];S.tables.cabinet_invoices=[];S.tables.management_activity_log=[];
 S.tables.cabinets=[{id:'k1',name:'Cab Un',owner_email:'un@x.com',phone:'111',status:'pending',created_at:'2026-10-01'},{id:'k2',name:'Cab Deux',owner_email:'deux@x.com',status:'pending',created_at:'2026-10-02'},{id:'k3',name:'Cab Trois',owner_email:'trois@x.com',status:'active',created_at:'2026-09-01'}];
 S.rpcH={company_activity_summary:()=>({data:[],error:null}),cabinet_overview:()=>({data:[],error:null})};};
 const {p,errs}=await boot(b,{kv:{},pageInit:new Function('return ('+init.toString()+')()')});
 await p.getByText('Centre de gestion',{exact:true}).first().click({timeout:4000}).catch(()=>{});await p.waitForTimeout(1200);
 await p.getByText('Campagnes',{exact:true}).first().click();await p.waitForTimeout(300);await p.getByText('Cabinets',{exact:true}).first().click();await p.waitForTimeout(1000);
 ok('F : 2 demandes à valider',/2 à valider/.test(await p.locator('[data-testid="cabreq-pending-count"]').innerText().catch(()=>'')),await txt(p).then(t=>t.slice(0,200)));
 await p.locator('[data-testid="cabreq-row"][data-status="pending"]').first().locator('[data-testid="cabreq-valider"]').click();await p.waitForTimeout(900);
 const cabs=await p.evaluate(()=>window.__srv.tables.cabinets);
 ok('F : Cab Un validé avec décideur',cabs.find(c=>c.id==='k1').status==='active'&&cabs.find(c=>c.id==='k1').decided_by==='a@x.com',cabs);
 ok('F : forfait pilote créé',await p.evaluate(()=>window.__srv.tables.cabinet_billing.some(r=>r.cabinet_email==='un@x.com'&&r.status==='pilote')));
 await p.locator('[data-testid="cabreq-row"][data-status="pending"]').first().locator('[data-testid="cabreq-refuser"]').click();await p.waitForTimeout(900);
 ok('F : Cab Deux refusé',await p.evaluate(()=>window.__srv.tables.cabinets.find(c=>c.id==='k2').status)==='refused');
 ok('F : plus de demande en attente',/0 à valider/.test(await p.locator('[data-testid="cabreq-pending-count"]').innerText()));
 {const lg=await p.evaluate(()=>window.__srv.tables.management_activity_log.map(l=>l.action_type));ok('F : actions journalisées',lg.filter(x=>/^cabinet_/.test(x)).length===2,lg);}
 ok('F : aucune erreur JS',errs.length===0,errs.slice(0,3));await p.close();}
// G) Table absente côté Centre
{const init=()=>{if(!crypto.randomUUID)crypto.randomUUID=function(){return 'g'+Math.random().toString(36).slice(2)};const S=window.__srv;S.tables.platform_admins=[];S.tables.management_collaborators=[{id:'m1',email:'a@x.com',role:'gestionnaire',permissions:{entreprises:true,offres:true,cabinets:true}}];S.tableMissing={cabinets:true};S.rpcH={company_activity_summary:()=>({data:[],error:null}),cabinet_overview:()=>({data:[],error:null})};};
 const {p,errs}=await boot(b,{kv:{},pageInit:new Function('return ('+init.toString()+')()')});
 await p.getByText('Centre de gestion',{exact:true}).first().click({timeout:4000}).catch(()=>{});await p.waitForTimeout(1200);
 await p.getByText('Campagnes',{exact:true}).first().click();await p.waitForTimeout(300);await p.getByText('Cabinets',{exact:true}).first().click();await p.waitForTimeout(900);
 ok('G : message table absente, pas d\'erreur',await p.locator('[data-testid="cabreq-missing"]').count()===1&&errs.length===0,errs.slice(0,2));await p.close();}
console.log('fails='+fails);await b.close();process.exit(fails?1:0)})();

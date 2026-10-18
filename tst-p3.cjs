const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const txt=p=>p.evaluate(()=>document.body.innerText);
// --- A) Assistant : guide « Comment corriger » sur chaque constat
const ents=[
 {id:6001,date:"2026-01-05",createdAt:"2026-01-05T10:00:00Z",label:"Écriture bancale",lines:[{account:"512",debit:100,credit:0},{account:"707",debit:0,credit:90}]},
 {id:6002,date:"2026-01-06",createdAt:"2026-01-06T10:00:00Z",label:"Loyer",lines:[{account:"999",debit:50,credit:0},{account:"530",debit:0,credit:50}]},
 {id:6003,date:"2026-01-07",createdAt:"2026-01-07T10:00:00Z",label:"Dep",lines:[{account:"606",debit:20,credit:0},{account:"530",debit:0,credit:20}]},
 {id:6004,date:"2026-01-07",createdAt:"2026-01-07T11:00:00Z",label:"Dep",lines:[{account:"606",debit:20,credit:0},{account:"530",debit:0,credit:20}]},
];
const mk=()=>new Function("(function(){try{localStorage.removeItem('compta-plus-active-tab')}catch(e){}window.__srv.tables.companies[0].plan_tier='assisted';})();");
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p,errs}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,cats:{entries:ents},pageInit:mk()});
 await p.getByText('Comptabilité',{exact:false}).first().click();await p.waitForTimeout(700);
 await p.getByText(/Assistant de contrôle/).first().click();await p.waitForTimeout(600);
 const n=await p.locator('[data-as="finding"]').count();
 const h=await p.locator('[data-as="howto"]').count();
 ok('A : constats présents',n>=3,n);
 ok('A : un guide par constat',h===n,{n,h});
 const rules=await p.locator('[data-as="finding"]').evaluateAll(els=>els.map(e=>e.getAttribute('data-rule')));
 ok('A : règles attendues',['desequilibre','compte','doublon'].every(r=>rules.includes(r)),rules);
 const t=await txt(p);
 ok('A : texte guide déséquilibre',/Comment corriger/.test(t)&&/Pourquoi c'est un problème/.test(t));
 const hi=await p.locator('[data-as="finding"][data-sev="high"] details[data-as="howto"]').first().getAttribute('open');
 ok('A : guide ouvert pour un constat important',hi!==null,hi);
 ok('A : aucune erreur JS',errs.length===0,errs.slice(0,3));await p.close();}
// --- B) Bienvenue : refus serveur affiché durablement
const noMember=(fn)=>new Function("(function(){var S=window.__srv;S.tables.company_members=[];S.tables.companies=[];S.fnH={'create-company':"+fn+"};})();");
const blocked="async function(o){return {data:null,error:{message:'Edge Function returned a non-2xx status code',context:{json:async function(){return {error:\"Cette adresse email a déjà bénéficié de 2 essais gratuits. Pour continuer, choisissez un forfait ou écrivez-nous à support@comptaplus.app : nous vous aiderons.\",code:'trial_limit'}}}}}}";
const okfn="async function(o){return {data:{success:true,alreadyExisted:false,companyId:'c9',companyName:o.body.companyName,role:'Administrateur',email:'a@x.com',trialEndsAt:'2026-12-01'},error:null}}";
{const {p,errs}=await boot(b,{skipSeed:true,pageInit:noMember(blocked)});
 const t0=await txt(p);
 ok('B : écran de bienvenue',/Bienvenue sur Compta\+/.test(t0),t0.slice(0,200));
 await p.locator('input[placeholder*="Nom de l\'entreprise"]').fill('Ma Boutique');
 await p.getByRole('button',{name:'Commencer'}).click();await p.waitForTimeout(1200);
 const e=p.locator('[data-testid="welcome-error"]');
 ok('B : message de refus affiché',await e.count()===1&&/2 essais gratuits/.test(await e.innerText()),await e.count());
 ok('B : appel serveur avec nom',await p.evaluate(()=>window.__srv.lastFn&&window.__srv.lastFn.name==='create-company'&&window.__srv.lastFn.body.companyName==='Ma Boutique'));
 ok('B : pas de message réseau générique',!/connexion|réseau/i.test(await e.innerText()));
 ok('B : aucune erreur JS',errs.length===0,errs.slice(0,3));await p.close();}
// --- C) Plus de blocage par appareil : ancien marqueur ignoré, création acceptée
{const {p,errs}=await boot(b,{skipSeed:true,pageInit:new Function("(function(){localStorage.setItem('compta-plus-trial-used','2026-01-01');var S=window.__srv;S.tables.company_members=[];S.tables.companies=[];S.fnH={'create-company':"+okfn+"};})();")});
 const t0=await txt(p);
 ok('C : bienvenue malgré ancien marqueur appareil',/Bienvenue sur Compta\+/.test(t0)&&!/déjà été utilisé depuis cet appareil/.test(t0),t0.slice(0,200));
 await p.locator('input[placeholder*="Nom de l\'entreprise"]').fill('Seconde Boutique');
 await p.getByRole('button',{name:'Commencer'}).click();await p.waitForTimeout(1500);
 ok('C : bienvenue fermé après création',!/Bienvenue sur Compta\+/.test(await txt(p)),(await txt(p)).slice(0,200));
 ok('C : aucune erreur JS',errs.length===0,errs.slice(0,3));await p.close();}
// --- D) Super Admin : liste des essais + Oublier
{const rows=[{id:1,email_normalized:'a@b.c',email_raw:'a@b.c',outcome:'created',company_name:'E1',created_at:'2026-09-01T10:00:00Z'},{id:2,email_normalized:'a@b.c',email_raw:'a@b.c',outcome:'created',company_name:'E2',created_at:'2026-09-10T10:00:00Z'},{id:3,email_normalized:'a@b.c',email_raw:'a@b.c',outcome:'blocked_email',created_at:'2026-09-20T10:00:00Z'}];
 const {p,errs}=await boot(b,{settings:{companyName:'X'},primary:true,cats:{},pageInit:new Function("(function(){var S=window.__srv;S.tables.platform_admins=[{email:'a@x.com'}];S.tables.trial_signups="+JSON.stringify(rows)+";})();")});
 const visible=await p.getByText('Super Admin',{exact:false}).count();
 if(visible){await p.getByText('Super Admin',{exact:false}).first().click();await p.waitForTimeout(800);
  await p.locator('[data-testid="sa-group-essais"]').click();await p.locator('[data-testid="sa-tab-inscriptions"]').click();await p.waitForTimeout(800);
  ok('D : 3 lignes',await p.locator('[data-testid="trial-row"]').count()===3,await p.locator('[data-testid="trial-row"]').count());
  ok('D : refus visible',await p.locator('[data-testid="trial-row"][data-outcome="blocked_email"]').count()===1);
  ok('D : compteur 2 essais',/2 essai\(s\) pour cet email/.test(await txt(p)));
  await p.locator('[data-testid="trials-only-blocked"]').check();await p.waitForTimeout(200);
  ok('D : filtre refus',await p.locator('[data-testid="trial-row"]').count()===1);
  await p.locator('[data-testid="trials-only-blocked"]').uncheck();
  await p.locator('[data-testid="trial-forget"]').first().click();await p.waitForTimeout(600);
  ok('D : oubli supprime la ligne',await p.evaluate(()=>window.__srv.tables.trial_signups.length)===2);
 } else ok('D : accès Super Admin',false,'menu absent');
 ok('aucune erreur JS (D)',errs.length===0,errs.slice(0,3));await p.close();}
console.log('fails='+fails);await b.close();process.exit(fails?1:0)})();

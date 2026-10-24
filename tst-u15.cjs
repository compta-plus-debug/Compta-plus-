// v262 — libellés de rôles adaptés à l'école (Secrétaire-caissier(ère), Directeur, Suppléant).
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const base={companyName:'École Test',currency:'HTG'};
const mk=(role,sect)=>new Function("(function(){const S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors="+JSON.stringify(sect)+";S.tables.companies[0].sectors_locked=true;S.tables.company_members[0].role="+JSON.stringify(role)+";try{sessionStorage.clear();localStorage.removeItem('compta-plus-espace')}catch(e){}})();");
const side=(p)=>p.locator('aside, nav').first().evaluate(()=>document.body.innerText);
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p,errs}=await boot(b,{settings:base,primary:false,pageInit:mk('Vendeur',['ecoles'])});await p.waitForTimeout(1000);
 const t=await side(p);ok('Vendeur d\'une école : « Rôle : Secrétaire-caissier(ère) »',/Rôle : Secrétaire-caissier\(ère\)/.test(t));await p.close();}
{const {p,errs}=await boot(b,{settings:base,primary:false,pageInit:mk('Éditeur',['ecoles'])});await p.waitForTimeout(1000);
 ok('Gestionnaire d\'une école : « Rôle : Directeur »',/Rôle : Directeur/.test(await side(p)));await p.close();}
{const {p,errs}=await boot(b,{settings:base,primary:false,pageInit:mk('Lecture seule',['ecoles'])});await p.waitForTimeout(1000);
 ok('Consultant d\'une école : Suppléant',/Suppléant/.test(await side(p)));await p.close();}
{const {p,errs}=await boot(b,{settings:base,primary:true,pageInit:mk('Administrateur',['ecoles','commerce'])});await p.waitForTimeout(1000);
 ok('Administrateur : rôle inchangé',/Rôle : Administrateur/.test(await side(p)));
 await p.getByText('Administration',{exact:true}).first().click();await p.waitForTimeout(800);await p.getByRole('button',{name:'Accès',exact:true}).click();await p.waitForTimeout(300);await p.getByRole('button',{name:'Utilisateurs',exact:true}).click();await p.waitForTimeout(800);
 const html=await p.content();
 ok('Administration (espace École) : Directeur (Gestionnaire), Suppléant (Consultant), Secrétaire-caissier(ère) (Vendeur)',/>Directeur \(Gestionnaire\)</.test(html)&&/>Suppléant \(Consultant\)</.test(html)&&/>Secrétaire-caissier\(ère\) \(Vendeur\)</.test(html));
 await p.locator('[data-testid="espace-commerce"]').click();await p.waitForTimeout(700);
 await p.getByText('Administration',{exact:true}).first().click();await p.waitForTimeout(800);await p.getByRole('button',{name:'Accès',exact:true}).click();await p.waitForTimeout(300);await p.getByRole('button',{name:'Utilisateurs',exact:true}).click();await p.waitForTimeout(800);
 const h2=await p.content();
 ok('Administration (espace Commerce, école active) : mêmes noms avec le rôle réel',/>Directeur \(Gestionnaire\)</.test(h2)&&/>Secrétaire-caissier\(ère\) \(Vendeur\)</.test(h2));
 ok('aucune erreur de page',errs.length===0,errs.slice(0,3));await p.close();}
{const {p}=await boot(b,{settings:base,primary:false,pageInit:mk('Vendeur',['commerce'])});await p.waitForTimeout(800);
 ok('sans secteur Écoles : « Rôle : Vendeur » inchangé',/Rôle : Vendeur/.test(await side(p)));await p.close();}
await b.close();console.log('fails='+fails);process.exit(fails?1:0);})();

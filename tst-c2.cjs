// Double authentification obligatoire pour les administrateurs (v229).
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const init=(v)=>()=>{try{localStorage.removeItem('compta-plus-active-tab')}catch(e){}};
const has=(p)=>p.evaluate(()=>!!document.querySelector('[data-testid="mfa-forced-note"]'));
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const st=(on)=>({companyName:"Lakay SA",currency:"HTG",requireAdminMfa:on});
// A) exigée, pas de 2FA → écran forcé
{const {p,errs}=await boot(b,{settings:st(true),primary:true,pageInit:init()});await p.waitForTimeout(1500);
 ok('A : écran d\'activation affiché',await has(p));
 ok('A : pas de bouton de fermeture ni désactivation',!(await p.evaluate(()=>/Désactiver la double/.test(document.body.innerText))));
 ok('A : aucune erreur JS',errs.length===0,errs.slice(0,3));await p.close();}
// B) non exigée → rien
{const {p,errs}=await boot(b,{settings:st(false),primary:true,pageInit:init()});await p.waitForTimeout(1500);
 ok('B : aucun écran forcé',!(await has(p)));ok('B : aucune erreur JS',errs.length===0,errs.slice(0,3));await p.close();}
// C) exigée mais 2FA déjà active → rien
{const {p,errs}=await boot(b,{settings:st(true),primary:true,pageInit:()=>{localStorage.setItem('t-mfa','1')}});await p.reload();await p.waitForTimeout(2500);
 ok('C : 2FA déjà active, pas d\'écran forcé',!(await has(p)));await p.close();}
await b.close();console.log(fails?'ECHECS '+fails:'OK');process.exit(fails?1:0)})();

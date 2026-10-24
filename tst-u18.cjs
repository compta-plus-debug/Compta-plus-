// v267 — Éducation : données séparées par type d'établissement, suppression, rôles par type, mots du métier, cours, crédits et réinscription.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const base={companyName:'Éducation Test',currency:'HTG'};
const mk=(role)=>new Function("(function(){const S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors=['ecoles'];S.tables.companies[0].sectors_locked=true;S.tables.company_members[0].role="+JSON.stringify(role)+";try{sessionStorage.clear();localStorage.removeItem('compta-plus-espace')}catch(e){}})();");
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const tab=async(p,id)=>{await g(p,'ecole-tab-'+id).click();await p.waitForTimeout(300)};
const eco=(p)=>p.evaluate(()=>window.__srv.getCat('ecole')||[]);
const jours=(n)=>{const d=new Date();d.setDate(d.getDate()+n);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const mod=async(p)=>(await g(p,'ecoles-module').innerText());
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const {p,errs}=await boot(b,{settings:base,primary:true,pageInit:mk('Administrateur')});await p.waitForTimeout(1200);
// 1) école : une classe
await tab(p,'annees');
await g(p,'ecole-annee-nom').fill('2026-2027');await g(p,'ecole-annee-ajouter').click();await p.waitForTimeout(400);
await g(p,'ecole-classe-nom').fill('7e année fondamentale');await g(p,'ecole-classe-ajouter').click();await p.waitForTimeout(300);
ok('école : classe créée',(await g(p,'ecole-classe-ligne').count())===1);
// 2) formation professionnelle : données séparées
await g(p,'ecole-etab-type').selectOption('pro');await p.waitForTimeout(500);
ok('formation pro : la classe de l\'école n\'apparaît pas',(await g(p,'ecole-classe-ligne').count())===0&&!/7e année/.test(await mod(p)));
await g(p,'ecole-annee-nom').fill('Formation 2026');await g(p,'ecole-annee-ajouter').click();await p.waitForTimeout(400);
await g(p,'ecole-classe-nom').fill('Électricité');await g(p,'ecole-classe-ajouter').click();await p.waitForTimeout(300);
ok('formation pro : filière Électricité seule',(await g(p,'ecole-classe-ligne').count())===1&&/Électricité/.test(await mod(p)));
let e=await eco(p);
ok('enregistrements marqués par type',e.filter(r=>r.type==='class').some(r=>r.etab==='pro'&&r.name==='Électricité')&&e.filter(r=>r.type==='class').some(r=>r.name==='7e année fondamentale'&&(r.etab||'ecole')==='ecole'));
ok('chaque type garde sa propre année active',e.filter(r=>r.type==='year'&&r.active).length===2,e.filter(r=>r.type==='year').map(r=>[r.label,r.active,r.etab]));
// retour école
await g(p,'ecole-etab-type').selectOption('ecole');await p.waitForTimeout(500);
ok('retour école : 7e année présente, Électricité absente',/7e année/.test(await mod(p))&&!/Électricité/.test(await mod(p)));
// 3) suppression : élève sans trace
await tab(p,'eleves');
await g(p,'ecole-famille-nom').fill('Famille Paul');await g(p,'ecole-famille-ajouter').click();await p.waitForTimeout(300);
await g(p,'ecole-eleve-prenom').fill('Jean');await g(p,'ecole-eleve-nom').fill('Paul');await g(p,'ecole-eleve-famille').selectOption({label:'Famille Paul'});await g(p,'ecole-eleve-classe').selectOption({label:'7e année fondamentale'});await g(p,'ecole-eleve-ajouter').click();await p.waitForTimeout(400);
ok('élève inscrit',(await g(p,'ecole-eleve-ligne').count())===1);
await tab(p,'annees');await g(p,'ecole-classe-ligne').locator('button').first().click();await p.waitForTimeout(300);
ok('classe avec élève : suppression refusée',(await g(p,'ecole-classe-ligne').count())===1);
await tab(p,'eleves');await g(p,'ecole-eleve-supprimer').click();await p.waitForTimeout(400);
ok('élève sans trace comptable : supprimé',(await g(p,'ecole-eleve-ligne').count())===0&&!(await eco(p)).some(r=>r.type==='student'));
await tab(p,'annees');await g(p,'ecole-classe-ligne').locator('button').first().click();await p.waitForTimeout(300);
ok('classe vide : supprimée',(await g(p,'ecole-classe-ligne').count())===0);
// 4) université : cours, crédits, réinscription
await g(p,'ecole-etab-type').selectOption('univ');await p.waitForTimeout(500);
await g(p,'ecole-annee-nom').fill('2026-2027');await g(p,'ecole-annee-ajouter').click();await p.waitForTimeout(400);
await g(p,'ecole-classe-nom').fill('Gestion');await g(p,'ecole-classe-ajouter').click();await p.waitForTimeout(300);
await g(p,'ecole-classe-credits-requis').fill('12');await p.waitForTimeout(200);
await g(p,'ecole-semestre-nom').fill('Semestre 1');await g(p,'ecole-semestre-ajouter').click();await p.waitForTimeout(300);
await g(p,'ecole-semestre-nom').fill('Semestre 2');await g(p,'ecole-semestre-ajouter').click();await p.waitForTimeout(300);
await tab(p,'frais');
await g(p,'ecole-frais-nom').fill('Écolage');await g(p,'ecole-frais-montant').fill('1000');await g(p,'ecole-frais-nb').fill('1');await g(p,'ecole-frais-date').fill(jours(-5));await g(p,'ecole-frais-par-credit').check();await g(p,'ecole-frais-ajouter').click();await p.waitForTimeout(400);
await tab(p,'eleves');
await g(p,'ecole-famille-nom').fill('Marc Joseph');await g(p,'ecole-famille-ajouter').click();await p.waitForTimeout(300);
await g(p,'ecole-eleve-prenom').fill('Anne');await g(p,'ecole-eleve-nom').fill('Joseph');await g(p,'ecole-eleve-famille').selectOption({label:'Marc Joseph'});await g(p,'ecole-eleve-classe').selectOption({label:'Gestion'});await g(p,'ecole-eleve-ajouter').click();await p.waitForTimeout(400);
await tab(p,'cours');
await g(p,'ecole-cours-nom').fill('Introduction à la gestion');await g(p,'ecole-cours-credits').fill('4');await g(p,'ecole-cours-ajouter').click();await p.waitForTimeout(300);
ok('cours créé avec 4 crédits',(await g(p,'ecole-cours-ligne').count())===1);
await g(p,'ecole-inscr-eleve').selectOption({label:'Anne Joseph'});await g(p,'ecole-inscr-cours').selectOption({index:1});await g(p,'ecole-inscr-semestre').selectOption({label:'Semestre 1'});await g(p,'ecole-inscr-valider').click();await p.waitForTimeout(500);
e=await eco(p);let ch=e.filter(r=>r.type==='charge');
ok('inscription au cours : échéance 4 000 (1 000 × 4 crédits)',ch.length===1&&ch[0].amount===4000&&/Introduction à la gestion/.test(ch[0].label),ch);
await g(p,'ecole-inscr-statut').selectOption('reprendre');await p.waitForTimeout(300);
let prog=await g(p,'ecole-progression-ligne').innerText();
ok('progression : 12 crédits requis, il manque 12',/12/.test(prog)&&/Il manque 12/.test(prog),prog);
await g(p,'ecole-inscr-reinscrire').click();await p.waitForTimeout(500);
e=await eco(p);ch=e.filter(r=>r.type==='charge');
ok('réinscription : nouvelle échéance de 4 000, ancienne inscription « repris »',ch.length===2&&ch.every(c=>c.amount===4000)&&e.filter(r=>r.type==='enroll').some(r=>r.status==='repris')&&e.filter(r=>r.type==='enroll').some(r=>r.retakeOf),[ch.length,e.filter(r=>r.type==='enroll').map(r=>r.status)]);
const nouvelle=await g(p,'ecole-inscr-statut').first();await nouvelle.selectOption('valide');await p.waitForTimeout(300);
prog=await g(p,'ecole-progression-ligne').innerText();ok('cours validé : 4 crédits validés',/\b4\b/.test(prog),prog);
ok('inscription avec échéances non payées : suppression possible',(await g(p,'ecole-inscr-supprimer').count())>=1);
// vocabulaire université
await tab(p,'relances');
ok('relances : mots université (Payeur, étudiants)',/Payeur/.test(await mod(p))||/payeur/.test(await mod(p)));
await tab(p,'rapports');
const rp=await mod(p);ok('rapports : Situation par filière, Payeurs, Étudiants',/Situation par filière/i.test(rp)&&/Payeurs/i.test(rp)&&/Étudiants/i.test(rp),rp.slice(200,600));
await tab(p,'relances');
ok('message de relance par défaut : l\'université',/l'université/.test(await g(p,'ecole-relance-message').inputValue()),await g(p,'ecole-relance-message').inputValue());
ok('aucune erreur de page',errs.length===0,errs.slice(0,3));await p.close();
// 5) rôles par type
{const {p:q}=await boot(b,{settings:base,primary:true,cats:{ecole:[{type:'etab',id:'etab',kind:'univ'}]},pageInit:mk('Éditeur')});await q.waitForTimeout(1200);
 ok('université : « Rôle : Doyen » dans le menu',/Rôle : Doyen/.test(await q.locator('aside, nav').first().innerText()),(await q.locator('aside, nav').first().innerText()).slice(-300));await q.close();}
{const {p:q}=await boot(b,{settings:base,primary:true,cats:{ecole:[{type:'etab',id:'etab',kind:'univ'}]},pageInit:mk('Administrateur')});await q.waitForTimeout(1200);
 await q.getByText('Administration',{exact:true}).first().click();await q.waitForTimeout(800);await q.getByRole('button',{name:'Accès',exact:true}).click();await q.waitForTimeout(300);await q.getByRole('button',{name:'Utilisateurs',exact:true}).click();await q.waitForTimeout(800);
 const h=await q.content();ok('université : Administration propose Doyen (Gestionnaire) et Vice-doyen (Consultant)',/>Doyen \(Gestionnaire\)</.test(h)&&/>Vice-doyen \(Consultant\)</.test(h));await q.close();}
await b.close();console.log('fails='+fails);process.exit(fails?1:0);})();

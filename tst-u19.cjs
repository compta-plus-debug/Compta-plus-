// v268 — Éducation : année modifiable par l'administrateur principal seulement, renvoi motivé (classe et semestre), rôles de l'université.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const base={companyName:'Éducation Test',currency:'HTG'};
const mk=(role)=>new Function("(function(){const S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors=['ecoles'];S.tables.companies[0].sectors_locked=true;S.tables.company_members[0].role="+JSON.stringify(role)+";try{sessionStorage.clear();localStorage.removeItem('compta-plus-espace')}catch(e){}})();");
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const tab=async(p,id)=>{await g(p,'ecole-tab-'+id).click();await p.waitForTimeout(300)};
const eco=(p)=>p.evaluate(()=>window.__srv.getCat('ecole')||[]);
const jours=(n)=>{const d=new Date();d.setDate(d.getDate()+n);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// A) administrateur principal
{const {p,errs}=await boot(b,{settings:base,primary:true,pageInit:mk('Administrateur')});await p.waitForTimeout(1500);
 await g(p,'ecole-etab-type').count();
 await tab(p,'annees');
 await g(p,'ecole-annee-nom').fill('2026-2027');await g(p,'ecole-annee-ajouter').click();await p.waitForTimeout(400);
 await g(p,'ecole-annee-nom').fill('2027-2028');await g(p,'ecole-annee-ajouter').click();await p.waitForTimeout(400);
 ok('administrateur principal : boutons Modifier et Activer',(await g(p,'ecole-annee-modifier').count())===2&&(await g(p,'ecole-annee-activer').count())===1);
 await g(p,'ecole-annee-modifier').first().click();await p.waitForTimeout(200);
 await g(p,'ecole-annee-edit-nom').fill('2026-2027 (révisée)');await g(p,'ecole-annee-enregistrer').click();await p.waitForTimeout(400);
 ok('année renommée',(await eco(p)).some(r=>r.type==='year'&&/révisée/.test(r.label)));
 // élève, renvoi motivé
 await g(p,'ecole-classe-nom').fill('7e A');await g(p,'ecole-classe-ajouter').click();await p.waitForTimeout(300);
 await tab(p,'frais');
 await g(p,'ecole-frais-nom').fill('Écolage');await g(p,'ecole-frais-montant').fill('3000');await g(p,'ecole-frais-nb').fill('3');await g(p,'ecole-frais-date').fill(jours(30));await g(p,'ecole-frais-ajouter').click();await p.waitForTimeout(300);
 await tab(p,'eleves');
 await g(p,'ecole-famille-nom').fill('Famille Paul');await g(p,'ecole-famille-ajouter').click();await p.waitForTimeout(300);
 await g(p,'ecole-eleve-prenom').fill('Jean');await g(p,'ecole-eleve-nom').fill('Paul');await g(p,'ecole-eleve-famille').selectOption({label:'Famille Paul'});await g(p,'ecole-eleve-classe').selectOption({label:'7e A'});await g(p,'ecole-eleve-ajouter').click();await p.waitForTimeout(500);
 ok('3 échéances créées',(await eco(p)).filter(r=>r.type==='charge').length===3);
 await g(p,'ecole-eleve-renvoyer').click();await p.waitForTimeout(200);
 await g(p,'ecole-renvoi-valider').click();await p.waitForTimeout(300);
 ok('renvoi sans motif refusé',(await eco(p)).find(r=>r.type==='student').status==='actif');
 await g(p,'ecole-renvoi-motif').fill('Indiscipline grave répétée');await g(p,'ecole-renvoi-valider').click();await p.waitForTimeout(500);
 let e=await eco(p);const st=e.find(r=>r.type==='student');
 ok('renvoi avec motif : élève sorti, motif conservé',st.status==='sorti'&&st.renvoi&&/Indiscipline/.test(st.renvoi.motif),st);
 ok('échéances à venir annulées',e.filter(r=>r.type==='charge').every(c=>c.status==='annulée'));
 ok('le motif est affiché dans la liste',/renvoyé le/.test(await g(p,'ecole-eleve-ligne').innerText()));
 ok('aucune erreur de page',errs.length===0,errs.slice(0,3));await p.close();}
// B) gestionnaire (non principal) : pas de modification d'année
{const {p}=await boot(b,{settings:base,primary:false,pageInit:mk('Éditeur')});await p.waitForTimeout(1500);
 await tab(p,'annees');
 await g(p,'ecole-annee-nom').fill('2026-2027');await g(p,'ecole-annee-ajouter').click();await p.waitForTimeout(400);
 await g(p,'ecole-annee-nom').fill('2027-2028');await g(p,'ecole-annee-ajouter').click();await p.waitForTimeout(400);
 ok('gestionnaire : ni Modifier ni Activer',(await g(p,'ecole-annee-modifier').count())===0&&(await g(p,'ecole-annee-activer').count())===0);await p.close();}
// C) université : renvoi d'un semestre
{const {p}=await boot(b,{settings:base,primary:true,cats:{ecole:[{type:'etab',id:'etab',kind:'univ'}]},pageInit:mk('Administrateur')});await p.waitForTimeout(1500);
 await tab(p,'annees');
 await g(p,'ecole-annee-nom').fill('2026-2027');await g(p,'ecole-annee-ajouter').click();await p.waitForTimeout(400);
 await g(p,'ecole-classe-nom').fill('Gestion');await g(p,'ecole-classe-ajouter').click();await p.waitForTimeout(300);
 await g(p,'ecole-semestre-nom').fill('Semestre 1');await g(p,'ecole-semestre-ajouter').click();await p.waitForTimeout(300);
 await tab(p,'frais');
 await g(p,'ecole-frais-nom').fill('Écolage');await g(p,'ecole-frais-montant').fill('1000');await g(p,'ecole-frais-nb').fill('1');await g(p,'ecole-frais-date').fill(jours(20));await g(p,'ecole-frais-par-credit').check();await g(p,'ecole-frais-ajouter').click();await p.waitForTimeout(300);
 await tab(p,'eleves');
 await g(p,'ecole-famille-nom').fill('Marc Joseph');await g(p,'ecole-famille-ajouter').click();await p.waitForTimeout(300);
 await g(p,'ecole-eleve-prenom').fill('Anne');await g(p,'ecole-eleve-nom').fill('Joseph');await g(p,'ecole-eleve-famille').selectOption({label:'Marc Joseph'});await g(p,'ecole-eleve-classe').selectOption({label:'Gestion'});await g(p,'ecole-eleve-ajouter').click();await p.waitForTimeout(400);
 await tab(p,'cours');
 await g(p,'ecole-cours-nom').fill('Comptabilité générale');await g(p,'ecole-cours-credits').fill('3');await g(p,'ecole-cours-ajouter').click();await p.waitForTimeout(300);
 await g(p,'ecole-inscr-eleve').selectOption({label:'Anne Joseph'});await g(p,'ecole-inscr-cours').selectOption({index:1});await g(p,'ecole-inscr-semestre').selectOption({label:'Semestre 1'});await g(p,'ecole-inscr-valider').click();await p.waitForTimeout(500);
 ok('inscription : échéance 3 000',(await eco(p)).filter(r=>r.type==='charge'&&r.amount===3000).length===1);
 await g(p,'ecole-renvoi-sem-eleve').selectOption({label:'Anne Joseph'});await g(p,'ecole-renvoi-sem-semestre').selectOption({label:'Semestre 1'});await g(p,'ecole-renvoi-sem-valider').click();await p.waitForTimeout(300);
 ok('renvoi du semestre sans motif refusé',(await eco(p)).filter(r=>r.type==='renvoi').length===0);
 await g(p,'ecole-renvoi-sem-motif').fill('Fraude à l\'examen');await g(p,'ecole-renvoi-sem-valider').click();await p.waitForTimeout(500);
 const e=await eco(p);
 ok('renvoi du semestre : inscription « renvoye », échéance annulée, motif enregistré, étudiant toujours dans sa filière',e.filter(r=>r.type==='enroll').every(r=>r.status==='renvoye')&&e.filter(r=>r.type==='charge').every(c=>c.status==='annulée')&&e.some(r=>r.type==='renvoi'&&/Fraude/.test(r.motif))&&e.find(r=>r.type==='student').status==='actif',e.map(r=>[r.type,r.status]));
 ok('historique des renvois affiché',(await g(p,'ecole-renvoi-sem-ligne').count())===1);
 await p.close();}
// D) rôles université : Doyen, Vice-doyen, Secrétaire général(e)
{const {p}=await boot(b,{settings:base,primary:true,cats:{ecole:[{type:'etab',id:'etab',kind:'univ'}]},pageInit:mk('Vendeur')});await p.waitForTimeout(1200);
 ok('université : Vendeur = « Secrétaire général(e) »',/Rôle : Secrétaire général\(e\)/.test(await p.locator('aside, nav').first().innerText()));await p.close();}
{const {p}=await boot(b,{settings:base,primary:true,cats:{ecole:[{type:'etab',id:'etab',kind:'univ'}]},pageInit:mk('Administrateur')});await p.waitForTimeout(1200);
 await p.getByText('Administration',{exact:true}).first().click();await p.waitForTimeout(800);await p.getByRole('button',{name:'Accès',exact:true}).click();await p.waitForTimeout(300);await p.getByRole('button',{name:'Utilisateurs',exact:true}).click();await p.waitForTimeout(800);
 const h=await p.content();ok('Administration : Secrétaire général(e) (Vendeur), Doyen (Gestionnaire), Vice-doyen (Consultant)',/>Secrétaire général\(e\) \(Vendeur\)</.test(h)&&/>Doyen \(Gestionnaire\)</.test(h)&&/>Vice-doyen \(Consultant\)</.test(h));await p.close();}
await b.close();console.log('fails='+fails);process.exit(fails?1:0);})();

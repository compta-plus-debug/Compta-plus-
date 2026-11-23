// v261 — espace de travail École / Commerce et secrétaire-caissier(ère).
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const iso=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const jours=(n)=>{const d=new Date();d.setDate(d.getDate()+n);return iso(d)};
const base={companyName:'École Test',currency:'HTG',companyPhone:'3800-0000'};
const mk=(role,sect)=>new Function("(function(){const S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors="+JSON.stringify(sect)+";S.tables.companies[0].sectors_locked=true;S.tables.company_members[0].role="+JSON.stringify(role)+";try{sessionStorage.clear();localStorage.removeItem('compta-plus-espace')}catch(e){}})();");
const menu=(p)=>p.locator('nav').first().innerText();
const eco=(p)=>p.evaluate(()=>window.__srv.getCat('ecole')||[]);
const seed=()=>{const y='y1',c='c1',f='f1',s='s1';return [
 {type:'year',id:y,label:'2026-2027',active:true},{type:'class',id:c,yearId:y,name:'6e A'},{type:'family',id:f,name:'Famille Paul',phone:'3456-7890',email:'',address:''},
 {type:'student',id:s,matricule:'2026-0001',firstName:'Jean',lastName:'Paul',familyId:f,yearId:y,classId:c,status:'actif'},
 {type:'fee',id:'fe1',yearId:y,label:'Écolage',amount:3000,nb:3,firstDue:jours(-40),account:'7061',classIds:[],tcaRate:0},
 ...[0,1,2].map(i=>({type:'charge',id:s+':fe1:'+(i+1),studentId:s,familyId:f,yearId:y,feeId:'fe1',label:'Écolage '+(i+1)+'/3',amount:1000,dueDate:jours(-40+30*i),account:'7061',tcaRate:0,recognized:false,advance:0,paid:0,status:'ok'}))];};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// A) administrateur, secteur Écoles : espace École par défaut
{const {p,errs}=await boot(b,{settings:base,primary:true,cats:{ecole:seed()},pageInit:mk('Administrateur',['ecoles','import_export'])});
 await p.waitForTimeout(800);
 ok('sélecteur d\'espace présent',(await p.locator('[data-testid="espace-selecteur"]').count())===1);
 let m=await menu(p);
 ok('espace École : Écoles présent, Vente et Comptes clients repliés',/Éducation/.test(m)&&!/Vente \(POS/.test(m)&&!/Comptes clients/.test(m)&&!/Stock et inventaire/.test(m),m);
 ok('libellés adaptés (Dépenses et fournisseurs, Salaires du personnel)',/Dépenses et fournisseurs/.test(m)&&/Salaires du personnel/.test(m),m);
 ok('accueil = module Écoles',(await p.locator('[data-testid="ecoles-module"]').count())===1);
 ok('bouton tableau de bord de l\'établissement',/Tableau de bord de l'établissement/.test(m));
 await p.locator('[data-testid="espace-commerce"]').click();await p.waitForTimeout(700);
 m=await menu(p);
 ok('espace Commerce : Vente et Stock présents, Écoles masqué',/Vente \(POS/.test(m)&&/Stock et inventaire/.test(m)&&!/Éducation/.test(m.replace(/Espace de travail[\s\S]*?Commerce/,'')),m);
 ok('quitter l\'espace école ramène hors du module Écoles',(await p.locator('[data-testid="ecoles-module"]').count())===0);
 ok('choix mémorisé sur l\'appareil',(await p.evaluate(()=>localStorage.getItem('compta-plus-espace')))==='commerce');
 await p.locator('[data-testid="espace-ecole"]').click();await p.waitForTimeout(700);
 ok('retour espace École',(await p.locator('[data-testid="ecoles-module"]').count())===1);
 const acc=await p.evaluate(()=>window.__srv.getCat('accounts')||[]);
 ok('comptes de l\'école créés à l\'ouverture par la direction',['4111','7061','7062','7068','709'].every(c=>acc.some(a=>a.code===c)),acc.length);
 ok('aucune erreur de page',errs.length===0,errs.slice(0,3));
 await p.close();}
// B) sans secteur Écoles : pas de sélecteur, menu inchangé
{const {p}=await boot(b,{settings:base,primary:true,pageInit:mk('Administrateur',['commerce'])});
 await p.waitForTimeout(600);
 ok('sans secteur Écoles : pas de sélecteur',(await p.locator('[data-testid="espace-selecteur"]').count())===0);
 ok('sans secteur Écoles : Vente présent',/Vente \(POS/.test(await menu(p)));
 await p.close();}
// C) secrétaire-caissière (Vendeur) dans une école
{const {p,errs}=await boot(b,{settings:base,primary:false,cats:{ecole:seed()},pageInit:mk('Vendeur',['ecoles'])});
 await p.waitForTimeout(1000);
 const m=await menu(p);
 ok('secrétaire : voit Écoles, pas Comptabilité ni Administration',/Éducation/.test(m)&&!/Comptabilité/.test(m)&&!/Administration/.test(m),m);
 ok('secrétaire : arrive dans le module Écoles',(await p.locator('[data-testid="ecoles-module"]').count())===1);
 ok('secrétaire : bandeau explicatif',(await p.locator('[data-testid="ecole-secretaire"]').count())===1);
 ok('secrétaire : 3 onglets seulement',(await p.locator('[data-testid^="ecole-tab-"]').count())===3);
 ok('secrétaire : formulaire d\'encaissement disponible',(await p.locator('[data-testid="ecole-paie-valider"]').count())===1);
 await p.locator('[data-testid="ecole-paie-famille"]').selectOption({label:'Famille Paul'});await p.locator('[data-testid="ecole-paie-montant"]').fill('500');
 await p.locator('[data-testid="ecole-paie-valider"]').click();await p.waitForTimeout(800);
 ok('secrétaire : reçu édité',(await p.locator('[data-testid="ecole-recu-apercu"]').count())===1);
 await p.locator('[data-testid="ecole-recu-fermer"]').click();await p.waitForTimeout(300);
 ok('secrétaire : pas de bouton Annuler le reçu',(await p.locator('[data-testid="ecole-recu-annuler"]').count())===0);
 const e=await p.evaluate(()=>window.__srv.getCat('entries')||[]);
 ok('écritures passées et équilibrées',e.length>=1&&e.every(x=>Math.abs(x.lines.reduce((s,l)=>s+l.debit-l.credit,0))<0.005),e);
 const E=await eco(p);
 ok('reçu mémorise l\'auteur',E.some(x=>x.type==='receipt'&&x.by&&x.by.length>3),E.filter(x=>x.type==='receipt'));
 await p.locator('[data-testid="ecole-tab-relances"]').click();await p.waitForTimeout(300);
 ok('secrétaire : relances accessibles',(await p.locator('[data-testid="ecole-relance-copier"]').count())>=1);
 await p.locator('[data-testid="ecole-tab-eleves"]').click();await p.waitForTimeout(300);
 ok('secrétaire : pas de formulaire d\'inscription',(await p.locator('[data-testid="ecole-eleve-ajouter"]').count())===0);
 ok('aucune erreur de page',errs.length===0,errs.slice(0,3));
 await p.close();}
await b.close();console.log('fails='+fails);process.exit(fails?1:0);})();

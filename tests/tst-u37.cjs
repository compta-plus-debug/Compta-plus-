// v297 — BTP, main-d'œuvre : grille salariale, plan d'effectifs réparti dans le temps, ouvriers affectés, pointage, paie reliée au module Salaires.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const iso=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const jours=(n)=>{const d=new Date();d.setHours(12);d.setDate(d.getDate()+n);return iso(d)};
const S='[\\s\\u202f\\u00a0]?';const re=(a,b)=>new RegExp('^'+a+S+b);
const mk=(role)=>new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors=['btp'];S.tables.companies[0].sectors_locked=true;S.tables.company_members[0].role="+JSON.stringify(role)+";})()");
const sub=async(p,id)=>{await g(p,'bt-sub-'+id).click();await p.waitForTimeout(250)};
const mo=async(p,id)=>{await g(p,'bt-mo-'+id).click();await p.waitForTimeout(250)};
const tab=async(p,id)=>{await g(p,'bt-tab-'+id).click();await p.waitForTimeout(350)};
const cat=(p,c)=>p.evaluate((c)=>window.__srv.getCat(c)||[],c);
const an=new Date().getFullYear();
const ouvrir=async(p)=>{await tab(p,'chantiers');if((await g(p,'bt-ch-detail').count())===0)await p.locator('[data-testid="bt-ch-ligne"]:has-text("Villa") [data-testid="bt-ch-ouvrir"]').click();await p.waitForTimeout(300)};
const site=(over)=>({type:'site',id:'s1',number:'CH-'+an+'-0001',name:'Villa',clientId:'c1',address:'',start:jours(-40),end:jours(50),retPct:5,budget:0,status:'encours',lines:[{id:'l1',label:'Maçonnerie',unit:'m²',qty:100,pu:500}],avances:[],staff:[],...over});
const base=[{type:'client',id:'c1',name:'Société Delmas',phone:'',address:''},site({})];
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// parcours complet de l'administrateur
{const {p,errs}=await boot(b,{settings:{companyName:'BTP Test',currency:'HTG',taxRate:10},primary:true,cats:{btp:base},pageInit:mk('Administrateur')});await p.waitForTimeout(1200);
 await ouvrir(p);await sub(p,'mo');
 ok('onglet Main-d\'œuvre ouvert sur la grille',(await g(p,'bt-grille').count())===1);
 await g(p,'bt-gr-nom').fill('Maçon');await g(p,'bt-gr-taux').fill('2000');await g(p,'bt-gr-ajouter').click();await p.waitForTimeout(300);
 await g(p,'bt-gr-nom').fill('maçon');await g(p,'bt-gr-taux').fill('2500');await g(p,'bt-gr-ajouter').click();await p.waitForTimeout(250);
 await g(p,'bt-gr-nom').fill('Sans taux');await g(p,'bt-gr-taux').fill('0');await g(p,'bt-gr-ajouter').click();await p.waitForTimeout(250);
 await g(p,'bt-gr-nom').fill('Manœuvre');await g(p,'bt-gr-taux').fill('1000');await g(p,'bt-gr-ajouter').click();await p.waitForTimeout(300);
 ok('grille : 2 qualifications (doublon et taux nul refusés)',(await g(p,'bt-gr-ligne').count())===2,await g(p,'bt-gr-ligne').count());
 await mo(p,'plan');
 ok('plan vide : aucune ligne',(await g(p,'bt-pl-ligne').count())===0);
 await g(p,'bt-pl-grade').selectOption({label:'Maçon (2 000 G/jour)'}).catch(async()=>{await g(p,'bt-pl-grade').selectOption({index:1})});
 await g(p,'bt-pl-effectif').fill('2');await g(p,'bt-pl-jours').fill('10');await g(p,'bt-pl-ajouter').click();await p.waitForTimeout(300);
 await g(p,'bt-pl-grade').selectOption({index:2});await g(p,'bt-pl-effectif').fill('4');await g(p,'bt-pl-jours').fill('10');await g(p,'bt-pl-ajouter').click();await p.waitForTimeout(300);
 ok('plan : 2 lignes, 60 jours-homme, coût 80 000',(await g(p,'bt-pl-ligne').count())===2&&/^60/.test((await g(p,'bt-pl-tot-jh').innerText()).trim())&&re('80','000').test(await g(p,'bt-pl-tot-cout').innerText()),[await g(p,'bt-pl-tot-jh').innerText(),await g(p,'bt-pl-tot-cout').innerText()]);
 const mois=await g(p,'bt-pl-mois').count();
 ok('plan réparti sur les mois entre début et fin',mois>=3,mois);
 await g(p,'bt-pl-reporter').click();await p.waitForTimeout(400);
 await sub(p,'budget');
 ok('budget de main-d\'œuvre reporté : 80 000',re('80','000').test(await g(p,'bt-bud-maindoeuvre').inputValue().then(v=>Number(v).toLocaleString('fr-FR'))),await g(p,'bt-bud-maindoeuvre').inputValue());
 await sub(p,'mo');await mo(p,'equipe');
 await g(p,'bt-cr-ajouter').click();await p.waitForTimeout(250);
 ok('affectation sans nom refusée',(await g(p,'bt-cr-ligne').count())===0);
 await g(p,'bt-cr-nom').fill('Paul Joseph');await g(p,'bt-cr-ajouter').click();await p.waitForTimeout(250);
 ok('nouvel ouvrier sans qualification refusé',(await g(p,'bt-cr-ligne').count())===0);
 await g(p,'bt-cr-grade').selectOption({index:1});await g(p,'bt-cr-ajouter').click();await p.waitForTimeout(350);
 await g(p,'bt-cr-nom').fill('paul joseph');await g(p,'bt-cr-ajouter').click();await p.waitForTimeout(300);
 ok('un ouvrier affecté, doublon refusé',(await g(p,'bt-cr-ligne').count())===1,await g(p,'bt-cr-ligne').count());
 await g(p,'bt-cr-nom').fill('Rose Marc');await g(p,'bt-cr-grade').selectOption({index:2});await g(p,'bt-cr-ajouter').click();await p.waitForTimeout(350);
 ok('2 ouvriers affectés',(await g(p,'bt-cr-ligne').count())===2);
 await mo(p,'pointage');
 await g(p,'bt-pt-tous').click();await p.waitForTimeout(400);
 ok('tous présents : coût du jour 3 000',re('3','000').test(await g(p,'bt-pt-cout-jour').innerText()),await g(p,'bt-pt-cout-jour').innerText());
 await g(p,'bt-pt-presence').nth(1).selectOption('0.5');await p.waitForTimeout(350);
 ok('demi-journée : coût du jour 2 500',re('2','500').test(await g(p,'bt-pt-cout-jour').innerText()),await g(p,'bt-pt-cout-jour').innerText());
 await g(p,'bt-pt-date').fill(jours(2));await p.waitForTimeout(300);
 await g(p,'bt-pt-presence').first().selectOption('1').catch(()=>{});await p.waitForTimeout(300);
 const futur=(await cat(p,'btp')).filter(r=>r.type==='pt'&&r.date>jours(0)).length;
 ok('pointage à une date future refusé',futur===0,futur);
 await g(p,'bt-pt-date').fill(jours(0));await p.waitForTimeout(250);
 await mo(p,'equipe');
 ok('ouvriers : 1,5 jour pointé au total, 2 500',/1[.,]5/.test(await g(p,'bt-cr-total').innerText())&&re('2','500').test((await g(p,'bt-cr-total').locator('td').nth(2).innerText())),await g(p,'bt-cr-total').innerText());
 await g(p,'bt-cr-lier').first().click();await p.waitForTimeout(500);
 let emp=await cat(p,'employees');
 ok('Lier à Salaires : fiche employé créée, hebdomadaire',emp.length===1&&emp[0].name==='Paul Joseph'&&emp[0].payFrequency==='hebdomadaire'&&!!emp[0].btpWorkerId,emp);
 await mo(p,'paie');
 ok('paie : brut du mois (jours pointés × taux)',re('2','500').test(await g(p,'bt-pa-tot').innerText()),await g(p,'bt-pa-tot').innerText());
 await g(p,'bt-pa-preparer').first().click();await p.waitForTimeout(500);
 emp=await cat(p,'employees');
 ok('Préparer dans Salaires : salaire de base = 2 000 (1 jour × 2 000)',emp[0].baseSalary===2000,emp[0].baseSalary);
 await mo(p,'equipe');
 await g(p,'bt-cr-retirer').first().click();await p.waitForTimeout(300);
 ok('retrait refusé quand des jours sont pointés',(await g(p,'bt-cr-ligne').count())===2);
 await g(p,'bt-cr-terminer').first().click();await p.waitForTimeout(300);
 ok('affectation terminée (plus de bouton Terminer sur la 1re ligne)',(await g(p,'bt-cr-terminer').count())===1);
 await mo(p,'grille');
 await g(p,'bt-gr-retirer').first().click();await p.waitForTimeout(300);
 ok('qualification utilisée : retrait refusé',(await g(p,'bt-gr-ligne').count())===2);
 ok('aucune erreur JS',errs.length===0,errs.slice(0,2));
 await p.close()}
// salaires déjà versés affectés au chantier au prorata des jours pointés
{const D=base.concat([
 {type:'grade',id:'g1',label:'Maçon',rate:2000},
 {type:'worker',id:'w1',name:'Paul Joseph',gradeId:'g1',phone:'',nif:'',employeeId:'e1',active:true},
 {type:'site',...site({id:'s2',number:'CH-'+an+'-0002',name:'Entrepôt'})},
 {type:'pt',id:'t1',siteId:'s1',workerId:'w1',date:jours(-3),units:1,rate:2000},
 {type:'pt',id:'t2',siteId:'s1',workerId:'w1',date:jours(-2),units:1,rate:2000},
 {type:'pt',id:'t3',siteId:'s1',workerId:'w1',date:jours(-1),units:1,rate:2000},
 {type:'pt',id:'t4',siteId:'s2',workerId:'w1',date:jours(-4),units:1,rate:2000}]);
 const emps=[{id:'e1',name:'Paul Joseph',position:'Maçon',baseSalary:8000,payFrequency:'hebdomadaire',overtimeRate:0,active:true,createdAt:'2026-01-01T00:00:00Z',btpWorkerId:'w1'}];
 const pays=[{id:'p1',employeeId:'e1',employeeName:'Paul Joseph',periodStart:jours(-5),periodEnd:jours(0),date:jours(0),baseSalary:8000,grossTotal:8000,netTotal:7500,employerTotal:400,status:'payé'},
  {id:'p2',employeeId:'e1',employeeName:'Paul Joseph',periodStart:jours(-5),periodEnd:jours(0),date:jours(0),baseSalary:9999,grossTotal:9999,netTotal:9000,status:'annulé'}];
 const {p}=await boot(b,{settings:{companyName:'BTP Test',currency:'HTG'},primary:true,cats:{btp:D,employees:emps,payslips:pays},pageInit:mk('Administrateur')});await p.waitForTimeout(1200);
 await ouvrir(p);
 await sub(p,'mo');await mo(p,'paie');
 const t=await g(p,'bt-pa-sal').innerText().catch(()=>'');
 ok('salaires affectés : 3 jours sur 4 → 8 400 × 3/4 = 6 300 (bulletin annulé ignoré)',re('','').test(t)&&/6[\s  ]?300/.test(t),t);
 await sub(p,'budget');
 ok('budget : main-d\'œuvre dépensée = 6 300',/6[\s  ]?300/.test(await g(p,'bt-bud-ligne').nth(1).innerText()),await g(p,'bt-bud-ligne').nth(1).innerText());
 await p.close()}
// consultation : pas de saisie
{const {p}=await boot(b,{settings:{companyName:'BTP Test',currency:'HTG'},primary:true,cats:{btp:base.concat([{type:'grade',id:'g1',label:'Maçon',rate:2000}])},pageInit:mk('Lecteur')});await p.waitForTimeout(1200);
 await ouvrir(p);await sub(p,'mo');
 ok('lecture seule : grille visible sans formulaire',(await g(p,'bt-gr-ligne').count())===1&&(await g(p,'bt-gr-ajouter').count())===0);
 await p.close()}
await b.close();console.log(fails?('ÉCHEC : '+fails):'OK');process.exit(fails?1:0)})();

// v259 — bloc Écoles, première version : accès par secteur, années, classes, familles, élèves, frais, échéances, encaissements, reçus, écritures.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const iso=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const jours=(n)=>{const d=new Date();d.setDate(d.getDate()+n);return iso(d)};
const base={companyName:'École Test',currency:'HTG',companyPhone:'3800-0000'};
const initEcoles=()=>{const S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors=['ecoles','sante'];S.tables.companies[0].sectors_locked=true;try{sessionStorage.clear()}catch(e){}};
const initNone=()=>{try{sessionStorage.clear()}catch(e){}};
const mod=async(p,n)=>{await p.getByText(n,{exact:true}).first().click();await p.waitForTimeout(700)};
const tab=async(p,id)=>{await p.locator('[data-testid="ecole-tab-'+id+'"]').click();await p.waitForTimeout(300)};
const ent=(p)=>p.evaluate(()=>window.__srv.getCat('entries')||[]);
const bal=(e)=>e.every(x=>Math.abs(x.lines.reduce((s,l)=>s+l.debit-l.credit,0))<0.005);
const ligne=(e,acc)=>e.lines.filter(l=>l.account===acc).reduce((s,l)=>s+l.debit-l.credit,0);
const fn=f=>new Function('('+f.toString()+')()');
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// A) sans le secteur Écoles : pas de module
{const {p,errs}=await boot(b,{settings:base,primary:true,pageInit:fn(initNone)});
 ok('sans secteur : pas de module Éducation dans le menu',(await p.getByText('Éducation',{exact:true}).count())===0);
 await p.close();}
// B) parcours complet
{const {p,errs}=await boot(b,{settings:base,primary:true,pageInit:fn(initEcoles)});
 ok('secteur actif : module Éducation dans le menu',(await p.getByText('Éducation',{exact:true}).count())>=1);
 await mod(p,'Éducation');
 ok('écran vide : message de démarrage',(await p.locator('[data-testid="ecole-vide"]').count())===1);
 await tab(p,'annees');
 await p.locator('[data-testid="ecole-annee-nom"]').fill('2026-2027');await p.locator('[data-testid="ecole-annee-ajouter"]').click();await p.waitForTimeout(400);
 ok('année créée',(await p.locator('[data-testid="ecole-annee-ligne"]').count())===1);
 await p.locator('[data-testid="ecole-classe-nom"]').fill('6e A');await p.locator('[data-testid="ecole-classe-ajouter"]').click();await p.waitForTimeout(300);
 ok('classe créée',(await p.locator('[data-testid="ecole-classe-ligne"]').count())===1);
 await tab(p,'eleves');
 await p.locator('[data-testid="ecole-famille-nom"]').fill('Famille Paul');await p.locator('[data-testid="ecole-famille-tel"]').fill('3456-7890');await p.locator('[data-testid="ecole-famille-ajouter"]').click();await p.waitForTimeout(300);
 await p.locator('[data-testid="ecole-eleve-prenom"]').fill('Jean');await p.locator('[data-testid="ecole-eleve-nom"]').fill('Paul');
 await p.locator('[data-testid="ecole-eleve-classe"]').selectOption({label:'6e A'});
 await p.locator('[data-testid="ecole-eleve-ajouter"]').click();await p.waitForTimeout(400);
 ok('élève inscrit avec matricule',(await p.locator('[data-testid="ecole-eleve-ligne"]').count())===1&&/2026-0001/.test(await p.locator('[data-testid="ecole-eleve-ligne"]').innerText()));
 await tab(p,'frais');
 await p.locator('[data-testid="ecole-frais-nom"]').fill('Écolage');await p.locator('[data-testid="ecole-frais-montant"]').fill('3000');await p.locator('[data-testid="ecole-frais-nb"]').fill('3');await p.locator('[data-testid="ecole-frais-date"]').fill(jours(-40));
 await p.locator('[data-testid="ecole-frais-ajouter"]').click();await p.waitForTimeout(300);
 ok('frais ajouté à la grille',(await p.locator('[data-testid="ecole-frais-ligne"]').count())===1);
 await p.locator('[data-testid="ecole-appliquer"]').click();await p.waitForTimeout(400);
 await tab(p,'echeances');
 ok('3 échéances créées',(await p.locator('[data-testid="ecole-echeance-ligne"]').count())===3);
 ok('2 échéances échues à constater',(await p.locator('[data-testid="ecole-nb-aconstater"]').innerText())==='2');
 // premier paiement : 1500 (solde la 1re échéance et une partie de la 2e, toutes deux échues → constatées d'abord)
 await tab(p,'recus');
 await p.locator('[data-testid="ecole-paie-famille"]').selectOption({label:'Famille Paul'});await p.locator('[data-testid="ecole-paie-montant"]').fill('1500');
 ok('reste à payer affiché (3 000)',/3.?000/.test((await p.locator('[data-testid="ecole-paie-reste"]').innerText()).replace(/\s/g,'')));
 await p.locator('[data-testid="ecole-paie-valider"]').click();await p.waitForTimeout(700);
 ok('reçu affiché après encaissement',(await p.locator('[data-testid="ecole-recu-apercu"]').count())===1&&/RE-\d{4}-0001/.test(await p.locator('[data-testid="ecole-recu-feuille"]').first().innerText()));
 await p.locator('[data-testid="ecole-recu-fermer"]').click();await p.waitForTimeout(300);
 let e=await ent(p);
 ok('2 écritures (constatation + encaissement), équilibrées',e.length===2&&bal(e),e);
 const rc=e.find(x=>/échéances échues/.test(x.label)),en=e.find(x=>/Encaissement/.test(x.label));
 ok('constatation : Débit 4111 2 000 / Crédit 7061 2 000',rc&&ligne(rc,'4111')===2000&&ligne(rc,'7061')===-2000,rc);
 ok('encaissement : Débit caisse 1 500 / Crédit 4111 1 500',en&&ligne(en,'530')===1500&&ligne(en,'4111')===-1500,en);
 const acc=await p.evaluate(()=>window.__srv.getCat('accounts')||[]);
 ok('comptes scolaires créés (4111, 7061)',acc.some(a=>a.code==='4111')&&acc.some(a=>a.code==='7061'));
 // second paiement : 1500 = solde de la 2e (500, échue) + 1000 en avance sur la 3e
 await p.locator('[data-testid="ecole-paie-montant"]').fill('1500');await p.locator('[data-testid="ecole-paie-valider"]').click();await p.waitForTimeout(700);
 await p.locator('[data-testid="ecole-recu-fermer"]').click();await p.waitForTimeout(300);
 e=await ent(p);const en2=e.find(x=>/RE-\d{4}-0002/.test(x.label));
 ok('2e encaissement : 500 sur 4111 et 1 000 en avance (487)',en2&&ligne(en2,'530')===1500&&ligne(en2,'4111')===-500&&ligne(en2,'487')===-1000,en2);
 ok('toutes écritures équilibrées',bal(e)&&e.length===3);
 await tab(p,'apercu');
 ok('aperçu : encaissé 3 000',/3.?000/.test((await p.locator('[data-testid="ecole-kpi-encaisse"]').innerText()).replace(/\s/g,'')));
 ok('aperçu : avances 1 000',/1.?000/.test((await p.locator('[data-testid="ecole-kpi-avances"]').innerText()).replace(/\s/g,'')));
 ok('aucun impayé échu',(await p.locator('[data-testid="ecole-impaye-ligne"]').count())===0);
 // trop-perçu refusé
 await tab(p,'recus');await p.locator('[data-testid="ecole-paie-montant"]').fill('999');await p.locator('[data-testid="ecole-paie-valider"]').click();await p.waitForTimeout(400);
 ok('trop-perçu refusé (rien de plus enregistré)',(await ent(p)).length===3);
 // annulation du 2e reçu
 await p.locator('[data-testid="ecole-recu-annuler"]').first().click();await p.waitForTimeout(600);
 e=await ent(p);const rev=e.find(x=>/Annulation du reçu/.test(x.label));
 ok('annulation : écriture inverse (4111 500, 487 1 000, caisse 1 500)',rev&&ligne(rev,'4111')===500&&ligne(rev,'487')===1000&&ligne(rev,'530')===-1500&&bal(e),rev);
 await tab(p,'echeances');
 const t=await p.locator('[data-testid="ecole-echeance-ligne"]').allInnerTexts();
 ok('après annulation : 2e échéance de nouveau échue et impayée (500), 3e sans avance',/Partiellement payée — échue/.test(t[1])&&/À venir/.test(t[2]),t);
 ok('aucune erreur JS (parcours)',errs.length===0,errs.slice(0,3));await p.close();}
// C) avance puis échéance : l'avance devient produit ; TCA ventilée
{const seed=[
 {type:'year',id:'y1',label:'2026-2027',active:true},{type:'class',id:'c1',yearId:'y1',name:'CE1'},{type:'family',id:'f1',name:'Famille Marc',phone:'3000-1111'},
 {type:'student',id:'s1',matricule:'2026-0001',firstName:'Luc',lastName:'Marc',familyId:'f1',yearId:'y1',classId:'c1',status:'actif'},
 {type:'charge',id:'s1:fa:1',studentId:'s1',familyId:'f1',yearId:'y1',feeId:'fa',label:'Écolage',amount:1000,dueDate:jours(-1),account:'7061',tcaRate:0,recognized:false,advance:600,paid:600,status:'ok'},
 {type:'charge',id:'s1:fb:1',studentId:'s1',familyId:'f1',yearId:'y1',feeId:'fb',label:'Cantine',amount:1100,dueDate:jours(-1),account:'7068',tcaRate:10,recognized:false,advance:0,paid:0,status:'ok'},
];
 const {p,errs}=await boot(b,{settings:{...base,taxRate:10},primary:true,cats:{ecole:seed},pageInit:fn(initEcoles)});
 await mod(p,'Éducation');await tab(p,'apercu');
 ok('impayés échus affichés (famille Marc)',(await p.locator('[data-testid="ecole-impaye-ligne"]').count())===1);
 await tab(p,'echeances');
 await p.locator('[data-testid="ecole-constater"]').click();await p.waitForTimeout(600);
 const e=await ent(p);
 ok('une écriture de constatation équilibrée',e.length===1&&bal(e),e);
 const x=e[0]||{lines:[]};
 ok('avance transformée en produit : Débit 487 600',ligne(x,'487')===600,x);
 ok('créance : Débit 4111 1 500 (400 + 1 100)',ligne(x,'4111')===1500,x);
 ok('produits : 7061 1 000 et 7068 1 000 ; TCA 445 : 100',ligne(x,'7061')===-1000&&ligne(x,'7068')===-1000&&ligne(x,'445')===-100,x);
 ok('plus rien à constater',(await p.locator('[data-testid="ecole-nb-aconstater"]').innerText())==='0');
 ok('aucune erreur JS (constatation)',errs.length===0,errs.slice(0,3));await p.close();}
// D) sauvegarde : les données de l'école font partie de l'export
{const seed=[{type:'year',id:'y1',label:'2026-2027',active:true}];
 const {p}=await boot(b,{settings:base,primary:true,cats:{ecole:seed},pageInit:fn(initEcoles)});
 ok('catégorie « ecole » chargée depuis le serveur',await p.evaluate(()=>!!window.__srv.getCat('ecole')));
 await p.close();}
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

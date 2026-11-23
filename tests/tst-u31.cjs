// v284 — bloc Éducation refondu : tableau de bord et guide de démarrage, familles en tableau (modifier, relevé de compte), filtres et totaux, encaissements, rapports, assistant, petits écrans.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const iso=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const jours=(n)=>{const d=new Date();d.setHours(12);d.setDate(d.getDate()+n);return iso(d)};
const S='[\\s\\u202f\\u00a0]?';const re=(a,b)=>new RegExp(a+S+b);
const msg=async(p,t)=>{try{await p.getByText(t,{exact:false}).first().waitFor({timeout:6000});return true}catch(e){return false}};
const init=new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var c=window.__srv.tables.companies[0];c.plan_tier='assisted';c.sectors=['ecoles'];c.sectors_locked=true;})();");
const tab=async(p,id)=>{await g(p,'ecole-tab-'+id).click();await p.waitForTimeout(350)};
const ouvrir=async(p)=>{await p.getByText('Éducation',{exact:true}).first().click();await p.waitForTimeout(900)};
const ch=(sid,fid,n,due,paid,rec)=>({type:'charge',id:sid+':fe1:'+n,studentId:sid,familyId:fid,yearId:'y1',feeId:'fe1',label:'Écolage '+n+'/3',amount:1000,dueDate:due,account:'7061',tcaRate:0,recognized:!!rec,advance:0,paid:paid||0,status:'ok'});
const ecole=[{type:'year',id:'y1',label:'2026-2027',active:true},{type:'class',id:'c1',yearId:'y1',name:'6e'},
 {type:'family',id:'f1',name:'Famille Joseph',phone:'3700-1111',email:''},{type:'family',id:'f2',name:'Famille Paul',phone:'3700-2222',email:''},
 {type:'student',id:'s1',matricule:'2026-0001',firstName:'Marc',lastName:'Joseph',familyId:'f1',yearId:'y1',classId:'c1',status:'actif'},
 {type:'student',id:'s2',matricule:'2026-0002',firstName:'Lia',lastName:'Paul',familyId:'f2',yearId:'y1',classId:'c1',status:'actif'},
 {type:'fee',id:'fe1',yearId:'y1',label:'Écolage',amount:3000,nb:3,firstDue:jours(-70),account:'7061',classIds:[],tcaRate:0},
 ch('s1','f1',1,jours(-70)),ch('s1','f1',2,jours(-40)),ch('s1','f1',3,jours(20)),
 ch('s2','f2',1,jours(-70),1000,true),ch('s2','f2',2,jours(-40)),ch('s2','f2',3,jours(20)),
 {type:'receipt',id:'r0',number:'RE-2026-0001',familyId:'f2',studentId:'',date:jours(-60),createdAt:new Date().toISOString(),amount:1000,mode:'caisse',payer:'',allocations:[{chargeId:'s2:fe1:1',amount:1000,toAdvance:false}],status:'valide',by:'x'}];
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// A) école vide : guide de démarrage en 7 étapes
{const {p}=await boot(b,{settings:{companyName:'École Test',currency:'HTG'},primary:true,pageInit:init});await ouvrir(p);
 const tabs=await p.locator('[data-testid^="ecole-tab-"]').evaluateAll(e=>e.map(x=>x.innerText));
 ok('premier onglet : Tableau de bord',tabs[0]==='Tableau de bord',tabs);
 ok('guide : 7 étapes, aucune cochée',(await g(p,'ecole-etape').count())===7&&(await p.locator('[data-testid="ecole-etape"]:has-text("✓")').count())===0);
 await g(p,'ecole-etape-ouvrir').first().click();await p.waitForTimeout(400);
 ok('« Ouvrir » mène à l\'onglet Années et classes',(await p.getByText(/Années scolaires|Année scolaire/).count())>0);
 await p.close();}
// B) école avec données
{const {p}=await boot(b,{settings:{companyName:'École Test',currency:'HTG'},primary:true,cats:{ecole},pageInit:init});await ouvrir(p);
 ok('guide masqué quand tout est fait',(await g(p,'ecole-vide').count())===0);
 const t=async(id)=>await g(p,id).innerText();
 ok('attendu 6 000, encaissé 1 000, taux 17 %',re('6','000').test(await t('ecole-kpi-attendu'))&&re('1','000').test(await t('ecole-kpi-encaisse'))&&/17 %/.test(await t('ecole-kpi-taux')),[await t('ecole-kpi-attendu'),await t('ecole-kpi-taux')]);
 ok('impayés échus 3 000 pour 2 familles',re('3','000').test(await t('ecole-kpi-impayes'))&&(await t('ecole-kpi-nbimpayes')).trim()==='2');
 ok('total des impayés 3 000',re('3','000').test(await t('ecole-impaye-total-montant')));
 ok('échéances à venir : 2 lignes, total 2 000',(await g(p,'ecole-avenir-ligne').count())===2&&re('2','000').test(await t('ecole-avenir-total-montant')));
 ok('effectif : 2 élèves en 6e',(await t('ecole-effectif-total')).trim()==='2');
 // familles
 await tab(p,'eleves');
 ok('2 familles en tableau, reste total 5 000',(await g(p,'ecole-famille-ligne').count())===2&&re('5','000').test(await t('ecole-familles-total-reste')));
 await g(p,'ecole-famille-modifier').first().click();await g(p,'ecole-famille-edit-tel').fill('3799-9999');await g(p,'ecole-famille-edit-ok').click();await p.waitForTimeout(400);
 ok('téléphone de la famille modifié',(await p.evaluate(()=>window.__srv.getCat('ecole'))).some(r=>r.type==='family'&&r.phone==='3799-9999'));
 await g(p,'ecole-releve-voir').first().click();await p.waitForTimeout(400);
 const rel=await g(p,'ecole-releve-feuille').first().innerText();
 ok('relevé : famille, élève, reste à payer 3 000',/Famille Joseph/.test(rel)&&/Marc Joseph/.test(rel)&&re('3','000').test(await g(p,'ecole-releve-reste').first().innerText()),rel.slice(0,200));
 await g(p,'ecole-releve-format').click();await p.waitForTimeout(250);
 ok('relevé : bascule en ticket',/Passer en A4/.test(await g(p,'ecole-releve-format').innerText()));
 await g(p,'ecole-releve-fermer').click();await p.waitForTimeout(250);
 await g(p,'ecole-eleve-recherche').fill('Lia');await p.waitForTimeout(250);
 ok('recherche élève : 1 ligne',(await g(p,'ecole-eleve-ligne').count())===1);
 await g(p,'ecole-eleve-recherche').fill('');
 // échéances
 await tab(p,'echeances');
 await g(p,'ecole-ech-etat').selectOption('echue');await p.waitForTimeout(250);
 ok('filtre échues : 3 lignes, reste 3 000',(await g(p,'ecole-echeance-ligne').count())===3&&re('3','000').test(await t('ecole-ech-total-reste')));
 await g(p,'ecole-ech-etat').selectOption('');await g(p,'ecole-ech-recherche').fill('Lia');await p.waitForTimeout(250);
 ok('recherche : 3 échéances de Lia, total 3 000',(await g(p,'ecole-echeance-ligne').count())===3&&re('3','000').test(await t('ecole-ech-total-montant')));
 await g(p,'ecole-ech-recherche').fill('');
 // frais : aperçu avant d'appliquer
 await tab(p,'frais');
 ok('toutes les échéances déjà créées',/déjà créées/.test(await g(p,'ecole-appliquer-info').innerText())&&await g(p,'ecole-appliquer').isDisabled());
 await g(p,'ecole-frais-nom').fill('Cantine');await g(p,'ecole-frais-montant').fill('600');await g(p,'ecole-frais-nb').fill('1');await g(p,'ecole-frais-date').fill(jours(-5));await g(p,'ecole-frais-ajouter').click();await p.waitForTimeout(400);
 ok('aperçu : 2 échéances à créer pour 2 élèves',/2<\/b> échéance|2 échéance/.test(await g(p,'ecole-appliquer-info').innerHTML())&&!(await g(p,'ecole-appliquer').isDisabled()),await g(p,'ecole-appliquer-info').innerText());
 await g(p,'ecole-appliquer').click();await p.waitForTimeout(400);
 ok('après application : plus rien à créer',/déjà créées/.test(await g(p,'ecole-appliquer-info').innerText()));
 // encaissements
 await tab(p,'recus');
 await g(p,'ecole-paie-famille').selectOption({label:'Famille Joseph'});await g(p,'ecole-paie-montant').fill('500');await g(p,'ecole-paie-valider').click();await p.waitForTimeout(600);
 ok('reçu imprimable ouvert',(await g(p,'ecole-recu-feuille').count())>=1);
 await g(p,'ecole-recu-format').click();await p.waitForTimeout(250);
 ok('reçu : bascule A4 / ticket',/Passer en A4/.test(await g(p,'ecole-recu-format').innerText()));
 await g(p,'ecole-recu-fermer').click();await p.waitForTimeout(250);
 ok('liste des encaissements : 2 reçus, total 1 500',(await g(p,'ecole-recu-ligne').count())===2&&re('1','500').test(await t('ecole-rec-total-montant')));
 await g(p,'ecole-rec-du').fill(jours(-1));await p.waitForTimeout(250);
 ok('filtre par date : 1 reçu, total 500',(await g(p,'ecole-recu-ligne').count())===1&&re('500','').test(await t('ecole-rec-total-montant')));
 // rapports
 await tab(p,'rapports');
 ok('rapport : total attendu par classe = 6 000 + 1 200 (cantine)',re('7','200').test(await t('ecole-rapport-total-attendu')));
 ok('rapport : tranches avec total',(await g(p,'ecole-rapport-tranche-total').count())===1);
 await g(p,'ecole-journal-du').fill(jours(-90));await p.waitForTimeout(250);
 ok('rapport : encaissé par type de frais = total du journal',re('1','500').test(await t('ecole-rapport-parfrais-montant'))&&re('1','500').test(await t('ecole-journal-total')));
 await tab(p,'stats');ok('statistiques affichées',(await g(p,'stats-bloc').count())===1);
 const cartes=await g(p,'stats-repartition').allInnerTexts();const eff=cartes.find(x=>/par 6e|Élèves par/.test(x))||'';
 ok('élèves par classe : en nombres, pas en gourdes',/Élèves par/.test(eff)&&!/ G\b|HTG|gourde/i.test(eff)&&/2 \(100%\)/.test(eff),eff);
 await p.close();}
// C) assistant : échéances jamais constatées
{const {p}=await boot(b,{settings:{companyName:'École Test',currency:'HTG'},primary:true,cats:{ecole},pageInit:init});
 await p.getByText('Comptabilité',{exact:false}).first().click();await p.waitForTimeout(700);
 await p.getByText(/Assistant de contrôle/).first().click();await p.waitForTimeout(700);
 const keys=await p.locator('[data-as="finding"]').evaluateAll(e=>e.map(x=>x.getAttribute('data-rule')));
 const n=await p.locator('[data-as="finding"]').count(),h=await p.locator('[data-as="howto"]').count();
 ok('assistant : échéances non constatées signalées avec guide',keys.includes('ecole-constater')&&n===h,{keys,n,h});
 await p.close();}
// D) petit écran
{const {p}=await boot(b,{settings:{companyName:'École Test',currency:'HTG'},primary:true,cats:{ecole},pageInit:init});
 await p.addStyleTag({content:'.grid{display:grid}.gap-4{gap:1rem}.gap-3{gap:.75rem}.gap-2{gap:.5rem}.grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.mb-4{margin-bottom:1rem}.mb-5{margin-bottom:1.25rem}.p-4{padding:1rem}.p-3{padding:.75rem}'});
 await p.setViewportSize({width:390,height:800});await ouvrir(p);
 for(const id of ['apercu','eleves','echeances','recus','rapports','stats']){await tab(p,id);const w=await p.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}));ok('390 px : onglet '+id+' sans débordement',w.sw<=w.cw+1,w);}
 await p.close();}
// E) secrétaire : 3 onglets
{const {p}=await boot(b,{settings:{companyName:'École Test',currency:'HTG'},primary:false,cats:{ecole},pageInit:new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var S=window.__srv;var c=S.tables.companies[0];c.plan_tier='assisted';c.sectors=['ecoles'];c.sectors_locked=true;S.tables.company_members[0].role='Vendeur';})();")});
 await p.waitForTimeout(500);
 if(await p.getByText('Éducation',{exact:true}).count()){await ouvrir(p);const tabs=await p.locator('[data-testid^="ecole-tab-"]').evaluateAll(e=>e.map(x=>x.innerText));
  ok('secrétaire : 3 onglets',tabs.length===3,tabs);
  await tab(p,'eleves');ok('secrétaire : pas de bouton Modifier la famille, mais le relevé',(await g(p,'ecole-famille-modifier').count())===0&&(await g(p,'ecole-releve-voir').count())===2);}
 else ok('secrétaire : module accessible',false,'absent');
 await p.close();}
await b.close();console.log(fails?'ÉCHEC u31':'OK u31');process.exit(fails?1:0)})();

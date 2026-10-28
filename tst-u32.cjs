// v286 — bloc Import-export refondu : tableau de bord guidé, à faire, filtres et totaux, listes de noms, fiche de coût de revient et facture d'exportation imprimables, rapports par période, statistiques, petits écrans.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const iso=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const jours=(n)=>{const d=new Date();d.setHours(12);d.setDate(d.getDate()+n);return iso(d)};
const usd=(n)=>new RegExp('^'+n+',00');const S='[\\s\\u202f\\u00a0]?';const re=(a,b)=>new RegExp(a+S+b);
const init=new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var c=window.__srv.tables.companies[0];c.plan_tier='assisted';c.sectors=['import_export'];c.sectors_locked=true;})()");
const tab=async(p,id)=>{await g(p,'ie-tab-'+id).click();await p.waitForTimeout(350)};
const impex=[
 {type:'imp',id:'i1',number:'IMP-2026-001',supplier:'Acme Miami',country:'États-Unis',ref:'A-1',rate:130,date:jours(-3),status:'commande',etaDate:jours(10),portDate:'',docs:{},lines:[{id:'l1',desc:'Riz',productId:'',qty:100,unitUSD:2}],freightUSD:20,insuranceUSD:0,charges:[],payments:[],invoiceEntryId:'e1',invoiceHTG:28600},
 {type:'imp',id:'i2',number:'IMP-2026-002',supplier:'Beta Panama',country:'Panama',ref:'',rate:130,date:jours(-20),status:'port',etaDate:'',portDate:jours(-10),docs:{},lines:[],freightUSD:0,insuranceUSD:0,charges:[],payments:[],invoiceEntryId:''},
 {type:'exp',id:'x1',number:'EXP-2026-001',customer:'Client New York',country:'États-Unis',ref:'',rate:130,date:jours(-2),status:'expedie',tcaRate:0,docs:{},lines:[{id:'m1',desc:'Café',productId:'',qty:10,unitUSD:50,unitCostHTG:3000}],costs:[],receipts:[{id:'r1',date:jours(-1),usd:200,rate:130,htg:26000,creance:26000,ecart:0,mode:'banque',entryId:'e3',status:'valide'}],invoiceEntryId:'e2',invoiceHTG:65000,stockOut:false}
];
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p,errs}=await boot(b,{settings:{companyName:'Négoce Test',currency:'HTG'},primary:true,pageInit:init});await p.waitForTimeout(1200);
 const tabs=await p.locator('[data-testid^="ie-tab-"]').evaluateAll(e=>e.map(x=>x.innerText));
 ok('premier onglet : Tableau de bord',tabs[0]==='Tableau de bord',tabs);
 ok('guide en 7 étapes',(await g(p,'ie-etape').count())===7);
 ok('message de départ quand aucun dossier',(await g(p,'ie-vide').count())===1);
 ok('aucune erreur JS',errs.length===0,errs);await p.close();}
{const {p,errs}=await boot(b,{settings:{companyName:'Négoce Test',currency:'HTG'},primary:true,cats:{impex},pageInit:init});await p.waitForTimeout(1200);
 const t=async(id)=>await g(p,id).innerText();
 ok('plus de message de départ',(await g(p,'ie-vide').count())===0);
 ok('4 choses à faire',(await t('ie-kpi-afaire')).trim()==='4'&&(await g(p,'ie-afaire-ligne').count())===4,[await t('ie-kpi-afaire')]);
 ok('dû aux fournisseurs 220 USD',usd(220).test(await t('ie-kpi-dettes')),await t('ie-kpi-dettes'));
 ok('à recevoir des clients 300 USD',usd(300).test(await t('ie-kpi-creances')),await t('ie-kpi-creances'));
 ok('arrivée prévue dans 10 jours listée',(await g(p,'ie-arrivee-ligne').count())===1);
 ok('un dossier au port depuis plus de 7 jours',(await g(p,'ie-retard-ligne').count())===1);
 await g(p,'ie-afaire-ouvrir').first().click();await p.waitForTimeout(400);
 ok('« Ouvrir » mène au dossier',(await g(p,'ie-imp-detail').count())===1||(await g(p,'ie-exp-detail').count())===1);
 // importations : filtres et totaux
 await tab(p,'imports');
 ok('2 dossiers, total facture 220 USD',(await g(p,'ie-imp-ligne').count())===2&&usd(220).test(await t('ie-imp-tot-facture')),await t('ie-imp-tot-facture'));
 ok('total reste dû 220 USD',usd(220).test(await t('ie-imp-tot-reste')));
 await g(p,'ie-imp-recherche').fill('Beta');await p.waitForTimeout(250);
 ok('recherche : 1 dossier, total 0',(await g(p,'ie-imp-ligne').count())===1&&usd(0).test(await t('ie-imp-tot-facture')));
 await g(p,'ie-imp-recherche').fill('');await g(p,'ie-imp-filtre-etape').selectOption('port');await p.waitForTimeout(250);
 ok('filtre étape « au port » : 1 dossier',(await g(p,'ie-imp-ligne').count())===1);
 await g(p,'ie-imp-filtre-etape').selectOption('');
 const opts=await p.locator('#ie-dl-fourn option').evaluateAll(e=>e.map(x=>x.value));
 ok('liste déroulante des fournisseurs connus',opts.includes('Acme Miami')&&opts.includes('Beta Panama'),opts);
 // fiche imprimable
 await g(p,'ie-imp-ouvrir').first().click();await p.waitForTimeout(300);
 const nOuv=await g(p,'ie-imp-detail').innerText();
 await g(p,'ie-imp-imprimer').click();await p.waitForTimeout(400);
 ok('aperçu de la fiche de coût de revient (écran + impression)',(await g(p,'ie-apercu').count())===1&&(await g(p,'ie-fiche').count())===2);
 const fiche=(await g(p,'ie-fiche').first().innerText());
 ok('fiche : numéro, nom de l\'entreprise, coût de revient',/Fiche de coût de revient/.test(fiche)&&/Négoce Test/.test(fiche)&&/Coût de revient total/.test(fiche),fiche.slice(0,300));
 ok('module masqué à l\'impression',(await p.locator('[data-testid="importexport-module"].no-print').count())===1);
 await g(p,'ie-apercu-fermer').click();await p.waitForTimeout(250);
 ok('aperçu fermé',(await g(p,'ie-apercu').count())===0);
 // exportations
 await tab(p,'exports');
 ok('export : total facture 500 USD, reste 300 USD',usd(500).test(await t('ie-exp-tot-facture'))&&usd(300).test(await t('ie-exp-tot-reste')),[await t('ie-exp-tot-facture'),await t('ie-exp-tot-reste')]);
 await g(p,'ie-exp-recherche').fill('zzz');await p.waitForTimeout(250);
 ok('recherche sans résultat',(await g(p,'ie-exp-ligne').count())===0);
 await g(p,'ie-exp-recherche').fill('');await p.waitForTimeout(250);
 await g(p,'ie-exp-ouvrir').first().click();await p.waitForTimeout(300);
 await g(p,'ie-exp-imprimer').click();await p.waitForTimeout(400);
 const fx=(await g(p,'ie-facture-exp').first().innerText());
 ok('facture d\'exportation : client, total et reste à payer',/Client New York/.test(fx)&&/Reste à payer/.test(fx)&&/300/.test(fx.replace(/[\s  ]/g,'')),fx.slice(0,400));
 await g(p,'ie-apercu-fermer').click();await p.waitForTimeout(250);
 // rapports
 await tab(p,'rapports');
 ok('rapports : totaux dû fournisseurs 220 et clients 300',usd(220).test(await t('ie-rapport-fourn-tot-reste'))&&usd(300).test(await t('ie-rapport-client-tot-reste')));
 ok('rapports : total du coût de revient présent',(await g(p,'ie-rapport-imp-total').count())===1);
 await g(p,'ie-rapport-du').fill(jours(5));await p.waitForTimeout(300);
 ok('filtre de période futur : plus aucun dossier',(await g(p,'ie-rapport-imp').count())===0&&(await g(p,'ie-rapport-exp').count())===0);
 await g(p,'ie-rapport-du').fill('');await p.waitForTimeout(300);
 ok('sans filtre : 2 importations et 1 exportation',(await g(p,'ie-rapport-imp').count())===2&&(await g(p,'ie-rapport-exp').count())===1);
 // statistiques
 await tab(p,'stats');
 const st=await g(p,'stats-bloc').innerText();
 ok('statistiques : répartition par pays et par fournisseur',/pays d'origine/.test(st)&&/par fournisseur/.test(st),st.slice(0,200));
 ok('statistiques : pays en nombre, pas en gourdes',!/\d\s*G\b/.test(await p.locator('text=Importations par pays').first().locator('xpath=ancestor::div[1]').innerText().catch(()=>'')));
 // petit écran
 await p.setViewportSize({width:390,height:800});
 for(const id of ['apercu','imports','exports','rapports']){await tab(p,id);const w=await p.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);ok('390 px sans débordement : '+id,w<=2,w);}
 ok('aucune erreur JS',errs.length===0,errs);await p.close();}
// lecture seule
{const {p}=await boot(b,{settings:{companyName:'Négoce Test',currency:'HTG'},primary:true,cats:{impex},pageInit:new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors=['import_export'];S.tables.companies[0].sectors_locked=true;S.tables.company_members[0].role='Lecteur';})()")});await p.waitForTimeout(1200);
 await tab(p,'imports');await g(p,'ie-imp-ouvrir').first().click();await p.waitForTimeout(300);
 ok('lecture seule : impression possible, pas de formulaire de création',(await g(p,'ie-imp-imprimer').count())===1&&(await g(p,'ie-imp-creer').count())===0);await p.close();}
await b.close();console.log(fails?('ÉCHEC : '+fails):'OK');process.exit(fails?1:0)})();

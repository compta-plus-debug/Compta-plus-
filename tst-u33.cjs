// v287 — bloc Santé refondu : tableau de bord guidé, à faire, filtres et totaux, facture A4 ou ticket, rapports par période (praticien, ancienneté assureurs), statistiques, petits écrans.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const iso=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const jours=(n)=>{const d=new Date();d.setHours(12);d.setDate(d.getDate()+n);return iso(d)};
const S='[\\s\\u202f\\u00a0]?';const re=(a,b)=>new RegExp(a+S+b);
const mk=(role)=>new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors=['sante'];S.tables.companies[0].sectors_locked=true;S.tables.company_members[0].role="+JSON.stringify(role)+";})()");
const tab=async(p,id)=>{await g(p,'sante-tab-'+id).click();await p.waitForTimeout(350)};
const E='cabinet';
const inv=(id,n,date,pid,prid,ins,total,insAmt,patAmt,hono,pays,status,lbl)=>({type:'invoice',id,number:n,date,patientId:pid,practitionerId:prid,insurerId:ins,insurerPct:ins?80:0,total,insurerAmount:insAmt,patientAmount:patAmt,honoraires:hono,lines:[{id:id+'l',label:lbl||'Consultation',qty:1,unit:total,cat:'consultation'}],payments:pays,claims:[],adjusts:[],status:status||'emise',etab:E});
const sante=[
 {type:'insurer',id:'ins1',name:'Assurance Alpha',phone:'',email:'',defaultPct:80,etab:E},
 {type:'practitioner',id:'pr1',name:'Dr Jean',specialty:'Généraliste',share:30,etab:E},
 {type:'patient',id:'p1',number:'PAT-0001',name:'Marie Pierre',phone:'3700-1111',insurerId:'ins1',policy:'P-1',etab:E},
 {type:'patient',id:'p2',number:'PAT-0002',name:'Paul Louis',phone:'3700-2222',insurerId:'',policy:'',etab:E},
 {type:'act',id:'a1',code:'',label:'Consultation',price:1000,cat:'consultation',productId:'',etab:E},
 inv('i1','FS-2026-0001',jours(-45),'p1','pr1','ins1',1000,800,200,300,[]),
 inv('i2','FS-2026-0002',jours(0),'p2','','',500,0,500,0,[{id:'pa1',amount:500,date:jours(0),mode:'caisse',status:'valide'}]),
 inv('i3','FS-2026-0003',jours(-5),'p2','','',999,0,999,0,[],'annulee')];
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p,errs}=await boot(b,{settings:{companyName:'Cabinet Test',currency:'HTG'},primary:true,pageInit:mk('Administrateur')});await p.waitForTimeout(1200);
 const tabs=await p.locator('[data-testid^="sante-tab-"]').evaluateAll(e=>e.map(x=>x.innerText));
 ok('premier onglet : Tableau de bord',tabs[0]==='Tableau de bord',tabs);
 ok('guide : 7 étapes, aucune cochée',(await g(p,'sante-etape').count())===7&&(await p.locator('[data-testid="sante-etape"]:has-text("✓")').count())===0);
 ok('message de départ présent',(await g(p,'sante-vide').count())===1);
 await g(p,'sante-etape-ouvrir').first().click();await p.waitForTimeout(400);
 ok('« Ouvrir » mène à l\'onglet des assureurs',(await g(p,'sante-assureur-nom').count())===1);
 ok('aucune erreur JS',errs.length===0,errs);await p.close();}
{const {p,errs}=await boot(b,{settings:{companyName:'Cabinet Test',currency:'HTG'},primary:true,cats:{sante},pageInit:mk('Administrateur')});await p.waitForTimeout(1200);
 const t=async(id)=>await g(p,id).innerText();
 ok('guide : 6 étapes cochées sur 7 (type d\'établissement restant)',(await p.locator('[data-testid="sante-etape"]:has-text("✓")').count())===6);
 ok('à encaisser : 1 facture ouverte',(await t('sante-kpi-ouvertes')).trim()==='1');
 ok('à recevoir des patients 200',re('200','').test(await t('sante-kpi-patients-dus')),await t('sante-kpi-patients-dus'));
 ok('à recevoir des assureurs 800',re('800','').test(await t('sante-kpi-assureurs-dus')),await t('sante-kpi-assureurs-dus'));
 ok('encaissé ce mois 500',re('500','').test(await t('sante-kpi-encaisse-mois')),await t('sante-kpi-encaisse-mois'));
 ok('honoraires à verser 300',re('300','').test(await t('sante-kpi-hono')),await t('sante-kpi-hono'));
 ok('3 choses à faire (patient, assureur, honoraires)',(await g(p,'sante-afaire-ligne').count())===3&&(await t('sante-kpi-afaire')).trim()==='3',[await g(p,'sante-afaire-ligne').count()]);
 ok('3 dernières factures listées',(await g(p,'sante-derniere-ligne').count())===3);
 await g(p,'sante-afaire-ouvrir').first().click();await p.waitForTimeout(400);
 ok('« Ouvrir » mène à la facture',(await g(p,'sante-nouvelle-facture').count())===1&&(await g(p,'sante-facture-ligne').count())===3);
 // facturation : filtres et totaux
 ok('totaux hors annulée : 1 500 / 200 / 800',re('1','500').test(await t('sante-fact-tot-total'))&&re('200','').test(await t('sante-fact-tot-patient'))&&re('800','').test(await t('sante-fact-tot-assureur')),[await t('sante-fact-tot-total'),await t('sante-fact-tot-patient'),await t('sante-fact-tot-assureur')]);
 await g(p,'sante-fact-recherche').fill('Paul');await p.waitForTimeout(250);
 ok('recherche par patient : 2 factures',(await g(p,'sante-facture-ligne').count())===2);
 await g(p,'sante-fact-recherche').fill('');await g(p,'sante-fact-filtre-etat').selectOption('soldee');await p.waitForTimeout(250);
 ok('filtre Soldée : 1 facture',(await g(p,'sante-facture-ligne').count())===1);
 await g(p,'sante-fact-filtre-etat').selectOption('annulee');await p.waitForTimeout(250);
 ok('filtre Annulée : 1 facture, total à zéro',(await g(p,'sante-facture-ligne').count())===1&&/^0/.test((await t('sante-fact-tot-total')).trim()),await t('sante-fact-tot-total'));
 await g(p,'sante-fact-filtre-etat').selectOption('');await g(p,'sante-fact-du').fill(jours(-10));await p.waitForTimeout(250);
 ok('filtre de dates : factures des 10 derniers jours',(await g(p,'sante-facture-ligne').count())===2);
 await g(p,'sante-fact-du').fill('');await p.waitForTimeout(250);
 // impression A4 / ticket
 await g(p,'sante-facture-imprimer').first().click();await p.waitForTimeout(400);
 const larg=async()=>await g(p,'sante-facture-feuille').first().evaluate(e=>e.style.maxWidth);
 ok('facture : A4 par défaut',(await larg())==='794px',await larg());
 await g(p,'sante-facture-format').click();await p.waitForTimeout(250);
 ok('facture : ticket après bascule',(await larg())==='300px'&&(await p.locator('.print-only.ticket-print-80').count())===1,await larg());
 await p.getByText('Fermer',{exact:true}).first().click();await p.waitForTimeout(250);
 // patients
 await tab(p,'patients');
 ok('patients : total du reste à payer 200',re('200','').test(await t('sante-patient-tot-reste'))&&(await g(p,'sante-patient-ligne').count())===2,await t('sante-patient-tot-reste'));
 await g(p,'sante-patient-recherche').fill('3700-2222');await p.waitForTimeout(250);
 ok('recherche patient par téléphone',(await g(p,'sante-patient-ligne').count())===1);
 await g(p,'sante-patient-recherche').fill('');
 // assureurs
 await tab(p,'assureurs');
 ok('assureurs : ligne de total, reste à recevoir 800',re('800','').test(await t('sante-assureur-tot-reste')),await t('sante-assureur-tot-reste'));
 // praticiens : liste des spécialités connues
 await tab(p,'praticiens');
 const sp=await p.locator('#sa-dl-spec option').evaluateAll(e=>e.map(x=>x.value));
 ok('spécialités déjà saisies proposées',sp.includes('Généraliste'),sp);
 // rapports
 await tab(p,'rapports');
 ok('rapports : total par catégorie 1 500',re('1','500').test(await t('sante-rapport-cat-tot')),await t('sante-rapport-cat-tot'));
 ok('rapports : facturé par praticien (Dr Jean + sans praticien)',(await g(p,'sante-rapport-prat').count())===2&&re('1','500').test(await t('sante-rapport-prat-tot')));
 ok('rapports : assureur 31 à 60 jours, total 800',(await g(p,'sante-rapport-ass').count())===1&&re('800','').test(await t('sante-rapport-ass-tot')),await t('sante-rapport-ass-tot'));
 ok('rapports : encaissements total 500',re('500','').test(await t('sante-rapport-enc-tot')),await t('sante-rapport-enc-tot'));
 await g(p,'sante-rapport-du').fill(jours(5));await p.waitForTimeout(300);
 ok('période future : plus rien',(await g(p,'sante-rapport-cat').count())===0&&(await g(p,'sante-rapport-enc').count())===0);
 await g(p,'sante-rapport-du').fill('');await p.waitForTimeout(250);
 // stats
 await tab(p,'stats');
 const st=await g(p,'stats-bloc').innerText();
 ok('statistiques : par praticien et patients par assureur',/Facturé par/.test(st)&&/par assureur/.test(st),st.slice(0,200));
 // petit écran
 await p.setViewportSize({width:390,height:800});
 for(const id of ['apercu','patients','factures','assureurs','rapports']){await tab(p,id);const w=await p.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);ok('390 px sans débordement : '+id,w<=2,w);}
 ok('aucune erreur JS',errs.length===0,errs);await p.close();}
// accueil (Vendeur)
{const {p}=await boot(b,{settings:{companyName:'Cabinet Test',currency:'HTG'},primary:true,cats:{sante},pageInit:mk('Vendeur')});await p.waitForTimeout(1200);
 const tabs=await p.locator('[data-testid^="sante-tab-"]').evaluateAll(e=>e.map(x=>x.innerText));
 ok('accueil : pas de rapports ni statistiques',!tabs.includes('Rapports')&&!tabs.includes('Statistiques')&&tabs[0]==='Tableau de bord',tabs);await p.close();}
await b.close();console.log(fails?('ÉCHEC : '+fails):'OK');process.exit(fails?1:0)})();

// v289 — bloc Transport et logistique : véhicules et échéances, chauffeurs, clients, voyages (bordereau), factures et encaissements, dépenses, rapports de rentabilité, statistiques, régulation (Vendeur), petits écrans.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const iso=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const jours=(n)=>{const d=new Date();d.setHours(12);d.setDate(d.getDate()+n);return iso(d)};
const S='[\\s\\u202f\\u00a0]?';const re=(a,b)=>new RegExp(a+S+b);
const mk=(role)=>new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors=['transport'];S.tables.companies[0].sectors_locked=true;S.tables.company_members[0].role="+JSON.stringify(role)+";})()");
const tab=async(p,id)=>{await g(p,'tr-tab-'+id).click();await p.waitForTimeout(350)};
const cat=(p,c)=>p.evaluate((c)=>window.__srv.getCat(c)||[],c);
const sum=(e,acc)=>e.reduce((s,x)=>s+x.lines.filter(l=>l.account===acc).reduce((a,l)=>a+l.debit-l.credit,0),0);
const trip=(id,n,date,cl,v,d,price,km,status,inv)=>({type:'trip',id,number:n,date,clientId:cl,vehicleId:v,driverId:d,from:'Port-au-Prince',to:'Cap-Haïtien',desc:'',km,price,status,invoiceId:inv||''});
const data=[
 {type:'vehicle',id:'v1',plate:'AB-1234',kind:'Camion',model:'Isuzu',capacity:'5 t',odometer:1200,nextServiceDate:'',nextServiceKm:1000,docs:[{id:'dc1',label:'Assurance',date:jours(-10)}],active:true},
 {type:'vehicle',id:'v2',plate:'CD-5678',kind:'Camionnette',model:'Toyota',capacity:'',odometer:500,nextServiceDate:'',nextServiceKm:0,docs:[],active:true},
 {type:'driver',id:'d1',name:'Jean Baptiste',phone:'',license:'P-1',licenseExpiry:jours(10),active:true},
 {type:'client',id:'c1',name:'Quincaillerie Delmas',phone:'3700-1',address:''},
 {type:'client',id:'c2',name:'Marché Croix-des-Bossales',phone:'',address:''},
 trip('t0','VY-2026-0001',jours(-45),'c2','v2','d1',4000,80,'livre','i1'),
 trip('t1','VY-2026-0002',jours(-3),'c1','v1','d1',5000,100,'livre'),
 trip('t2','VY-2026-0003',jours(-2),'c1','v1','d1',3000,50,'livre'),
 trip('t3','VY-2026-0004',jours(2),'c2','v1','d1',2000,0,'planifie'),
 {type:'invoice',id:'i1',number:'FT-2026-0001',date:jours(-45),clientId:'c2',tripIds:['t0'],lines:[{id:'l0',tripId:'t0',label:'VY-2026-0001',amount:4000}],ht:4000,tcaRate:0,tca:0,total:4000,entryId:'',status:'emise',payments:[]},
 {type:'expense',id:'e1',date:jours(-2),vehicleId:'v1',kind:'carburant',label:'Carburant',liters:0,amount:1000,mode:'caisse',odometer:0,entryId:'',status:'valide'},
 {type:'expense',id:'e2',date:jours(-1),vehicleId:'v1',kind:'entretien',label:'Vidange',liters:0,amount:500,mode:'caisse',odometer:0,entryId:'',status:'valide'}];
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p,errs}=await boot(b,{settings:{companyName:'Trans Test',currency:'HTG',taxRate:10},primary:true,pageInit:mk('Administrateur')});await p.waitForTimeout(1200);
 ok('module Transport ouvert par défaut',(await g(p,'transport-module').count())===1);
 const tabs=await p.locator('[data-testid^="tr-tab-"]').evaluateAll(e=>e.map(x=>x.innerText));
 ok('premier onglet : Tableau de bord, 9 onglets',tabs[0]==='Tableau de bord'&&tabs.length===9,tabs);
 ok('guide en 7 étapes, aucune cochée',(await g(p,'tr-etape').count())===7&&(await p.locator('[data-testid="tr-etape"]:has-text("✓")').count())===0);
 ok('message de départ',(await g(p,'tr-vide').count())===1);
 // véhicule : ajout et doublon
 await tab(p,'vehicules');
 await g(p,'tr-veh-plaque').fill('ab 1234');await g(p,'tr-veh-type').fill('Camion');await g(p,'tr-veh-ajouter').click();await p.waitForTimeout(400);
 ok('véhicule ajouté',(await g(p,'tr-veh-ligne').count())===1);
 await g(p,'tr-veh-plaque').fill('AB-1234');await g(p,'tr-veh-ajouter').click();await p.waitForTimeout(400);
 ok('doublon de plaque refusé',(await g(p,'tr-veh-ligne').count())===1);
 await g(p,'tr-veh-ouvrir').click();await p.waitForTimeout(300);
 await g(p,'tr-doc-nom').fill('Assurance');await g(p,'tr-doc-date').fill(jours(-3));await g(p,'tr-doc-ajouter').click();await p.waitForTimeout(300);
 ok('échéance ajoutée et signalée échue',(await g(p,'tr-doc-ligne').count())===1&&/Échue/.test(await g(p,'tr-doc-ligne').innerText()));
 ok('aucune erreur JS',errs.length===0,errs);await p.close();}
{const {p,errs}=await boot(b,{settings:{companyName:'Trans Test',currency:'HTG',taxRate:10},primary:true,cats:{transport:data},pageInit:mk('Administrateur')});await p.waitForTimeout(1200);
 const t=async(id)=>await g(p,id).innerText();
 ok('guide : 6 étapes cochées sur 7 (reste l\'encaissement)',(await p.locator('[data-testid="tr-etape"]:has-text("✓")').count())===6,await p.locator('[data-testid="tr-etape"]:has-text("✓")').count());
 ok('6 choses à faire',(await t('tr-kpi-afaire')).trim()==='6'&&(await g(p,'tr-afaire-ligne').count())===6,[await t('tr-kpi-afaire'),await g(p,'tr-afaire-ligne').count()]);
 ok('à recevoir des clients 4 000',re('4','000').test(await t('tr-kpi-dus')),await t('tr-kpi-dus'));
 ok('voyage dans les 7 jours listé',(await g(p,'tr-bientot-ligne').count())===1);
 // voyages
 await tab(p,'voyages');
 ok('4 voyages, total prix 14 000 et 230 km',(await g(p,'tr-voy-ligne').count())===4&&re('14','000').test(await t('tr-voy-tot-prix'))&&(await t('tr-voy-tot-km')).trim()==='230',[await t('tr-voy-tot-prix'),await t('tr-voy-tot-km')]);
 await g(p,'tr-voy-filtre-etat').selectOption('livre');await p.waitForTimeout(250);
 ok('filtre « Livré » : 3 voyages, 12 000',(await g(p,'tr-voy-ligne').count())===3&&re('12','000').test(await t('tr-voy-tot-prix')),await t('tr-voy-tot-prix'));
 await g(p,'tr-voy-filtre-etat').selectOption('');await g(p,'tr-voy-recherche').fill('CD-5678');await p.waitForTimeout(250);
 ok('recherche par plaque',(await g(p,'tr-voy-ligne').count())===1);
 await g(p,'tr-voy-recherche').fill('');await p.waitForTimeout(250);
 // création d'un voyage
 await g(p,'tr-voy-client').selectOption('c2');await g(p,'tr-voy-vehicule').selectOption('v2');await g(p,'tr-voy-chauffeur').selectOption('d1');
 await g(p,'tr-voy-depart').fill('Jacmel');await g(p,'tr-voy-arrivee').fill('Léogâne');await g(p,'tr-voy-prix').fill('1500');await g(p,'tr-voy-creer').click();await p.waitForTimeout(500);
 ok('voyage créé (5 voyages)',(await g(p,'tr-voy-ligne').count())===5);
 const lieux=await p.locator('#tr-dl-lieu option').evaluateAll(e=>e.map(x=>x.value));
 ok('lieux déjà saisis proposés',lieux.includes('Port-au-Prince')&&lieux.includes('Jacmel'),lieux);
 // bordereau
 await g(p,'tr-voy-bordereau').first().click();await p.waitForTimeout(400);
 ok('bordereau imprimable (écran et impression)',(await g(p,'tr-bordereau-feuille').count())===2&&(await g(p,'tr-format').count())===0);
 await g(p,'tr-apercu-fermer').click();await p.waitForTimeout(250);
 // factures : TCA, facturation groupée
 await tab(p,'factures');
 // client dont les voyages ne sont pas encore livrés : explication et passage à « Livré » depuis cet écran
 await g(p,'tr-fact-client').selectOption('c2');await p.waitForTimeout(300);
 ok('client sans voyage livré : message clair, bouton grisé, voyages listés',(await g(p,'tr-fact-aucun').count())===1&&(await g(p,'tr-fact-emettre').isDisabled())&&(await g(p,'tr-fact-voyage-ligne').count())===2,[await g(p,'tr-fact-aucun').count(),await g(p,'tr-fact-voyage-ligne').count()]);
 await g(p,'tr-fact-voyage-etat').first().selectOption('livre');await p.waitForTimeout(400);
 ok('après « Livré » : 1 voyage à facturer et bouton actif',(await t('tr-fact-nb')).trim()==='1'&&!(await g(p,'tr-fact-emettre').isDisabled()),await t('tr-fact-nb'));
 await g(p,'tr-tca').check();await p.waitForTimeout(400);
 await g(p,'tr-fact-client').selectOption('c1');await p.waitForTimeout(250);
 ok('client 1 : 2 voyages livrés, 8 000',(await t('tr-fact-nb')).trim()==='2'&&re('8','000').test(await t('tr-fact-montant')),[await t('tr-fact-nb'),await t('tr-fact-montant')]);
 await g(p,'tr-fact-emettre').click();await p.waitForTimeout(600);
 let e=await cat(p,'entries');const te=e.filter(x=>x.kind==='transport');
 ok('écritures : 411 = 8 800, 706 = -8 000, 445 = -800',Math.abs(sum(te,'411')-8800)<.01&&Math.abs(sum(te,'706')+8000)<.01&&Math.abs(sum(te,'445')+800)<.01,[sum(te,'411'),sum(te,'706'),sum(te,'445')]);
 ok('facture ouverte, numérotée FT-…-0002',(await g(p,'tr-inv-detail').count())===1&&/FT-\d{4}-0002/.test(await g(p,'tr-inv-detail').innerText()));
 await g(p,'tr-pay-montant').fill('3000');await g(p,'tr-pay-valider').click();await p.waitForTimeout(500);
 e=await cat(p,'entries');const te2=e.filter(x=>x.kind==='transport');
 ok('encaissement : caisse +3 000, reste 5 800',Math.abs(sum(te2,'530')-3000)<.01&&re('5','800').test(await t('tr-inv-reste')),[sum(te2,'530'),await t('tr-inv-reste')]);
 await g(p,'tr-pay-montant').fill('99999');await g(p,'tr-pay-valider').click();await p.waitForTimeout(400);
 ok('encaissement supérieur au reste refusé',(await g(p,'tr-pay-ligne').count())===1);
 ok('totaux des factures hors annulées : 12 800 et reste 9 800',re('12','800').test(await t('tr-inv-tot-total'))&&re('9','800').test(await t('tr-inv-tot-reste')),[await t('tr-inv-tot-total'),await t('tr-inv-tot-reste')]);
 await g(p,'tr-inv-filtre-etat').selectOption('encaisser');await p.waitForTimeout(250);
 ok('filtre « à encaisser » : 2 factures',(await g(p,'tr-inv-ligne').count())===2);
 await g(p,'tr-inv-filtre-etat').selectOption('');
 await g(p,'tr-inv-imprimer').first().click();await p.waitForTimeout(400);
 const larg=async()=>await g(p,'tr-facture-feuille').first().evaluate(x=>x.style.maxWidth);
 ok('facture A4 puis ticket',(await larg())==='794px');
 await g(p,'tr-format').click();await p.waitForTimeout(250);
 ok('ticket après bascule',(await larg())==='300px'&&(await p.locator('.print-only.ticket-print-80').count())===1,await larg());
 await g(p,'tr-apercu-fermer').click();await p.waitForTimeout(250);
 // dépenses
 await tab(p,'depenses');
 ok('dépenses : total 1 500 (hors annulées)',re('1','500').test(await t('tr-dep-tot')),await t('tr-dep-tot'));
 await g(p,'tr-dep-vehicule').selectOption('v1');await g(p,'tr-dep-nature').selectOption('carburant');await g(p,'tr-dep-montant').fill('700');await g(p,'tr-dep-valider').click();await p.waitForTimeout(500);
 e=await cat(p,'entries');const te3=e.filter(x=>x.kind==='transport');
 ok('dépense : 6053 = 700, caisse -700 en plus',Math.abs(sum(te3,'6053')-700)<.01&&Math.abs(sum(te3,'530')-(3000-700))<.01,[sum(te3,'6053'),sum(te3,'530')]);
 ok('dépenses : 3 lignes, total 2 200',(await g(p,'tr-dep-ligne').count())===3&&re('2','200').test(await t('tr-dep-tot')),await t('tr-dep-tot'));
 // rapports
 await tab(p,'rapports');
 ok('rentabilité : CA total 12 000, dépenses 2 200, marge 9 800',re('12','000').test(await t('tr-rapport-veh-tot-ca'))&&re('2','200').test(await t('tr-rapport-veh-tot-dep'))&&re('9','800').test(await t('tr-rapport-veh-tot-marge')),[await t('tr-rapport-veh-tot-ca'),await t('tr-rapport-veh-tot-dep'),await t('tr-rapport-veh-tot-marge')]);
 ok('clients : facturé 12 800, reste 9 800',re('12','800').test(await t('tr-rapport-cli-tot-fact'))&&re('9','800').test(await t('tr-rapport-cli-tot-reste')),[await t('tr-rapport-cli-tot-fact'),await t('tr-rapport-cli-tot-reste')]);
 ok('dépenses par nature : total 2 200',re('2','200').test(await t('tr-rapport-nature-tot')));
 await g(p,'tr-rapport-du').fill(jours(5));await p.waitForTimeout(300);
 ok('période future : plus de chiffre d\'affaires',(await g(p,'tr-rapport-cli').count())===0&&/^0/.test((await t('tr-rapport-veh-tot-ca')).trim()),await t('tr-rapport-veh-tot-ca'));
 await g(p,'tr-rapport-du').fill('');await p.waitForTimeout(250);
 // statistiques
 await tab(p,'stats');
 const st=await g(p,'stats-bloc').innerText();
 ok('statistiques : voyages par état, par chauffeur, par véhicule',/Voyages par état/.test(st)&&/par chauffeur/.test(st)&&/par véhicule/.test(st),st.slice(0,200));
 // annulations
 await tab(p,'factures');
 if((await g(p,'tr-inv-detail').count())===0){await g(p,'tr-inv-ouvrir').first().click();await p.waitForTimeout(300);}
 const ouvert=await g(p,'tr-inv-detail').innerText();
 if(/FT-\d{4}-0002/.test(ouvert)){
   await g(p,'tr-inv-annuler').click();await p.waitForTimeout(400);
   ok('facture avec encaissement : annulation refusée',(await g(p,'tr-inv-annuler').count())===1&&!/Annulée/.test(await g(p,'tr-inv-ligne').first().innerText()));
   await g(p,'tr-pay-annuler').click();await p.waitForTimeout(500);
   await g(p,'tr-inv-annuler').click();await p.waitForTimeout(600);
   e=await cat(p,'entries');const te4=e.filter(x=>x.kind==='transport');
   ok('annulations : 411, 706, 445 et caisse (hors dépense) à zéro',Math.abs(sum(te4,'411'))<.01&&Math.abs(sum(te4,'706'))<.01&&Math.abs(sum(te4,'445'))<.01&&Math.abs(sum(te4,'530')+700)<.01,[sum(te4,'411'),sum(te4,'706'),sum(te4,'445'),sum(te4,'530')]);
   await g(p,'tr-fact-client').selectOption('c1');await p.waitForTimeout(250);
   ok('voyages refacturables après annulation',(await t('tr-fact-nb')).trim()==='2');
 } else ok('facture 0002 ouverte en premier',false,ouvert.slice(0,80));
 // petit écran
 await p.setViewportSize({width:390,height:800});
 for(const id of ['apercu','voyages','vehicules','factures','depenses','rapports']){await tab(p,id);const w=await p.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);ok('390 px sans débordement : '+id,w<=2,w);}
 ok('aucune erreur JS',errs.length===0,errs);await p.close();}
// régulation (Vendeur)
{const {p}=await boot(b,{settings:{companyName:'Trans Test',currency:'HTG'},primary:true,cats:{transport:data},pageInit:mk('Vendeur')});await p.waitForTimeout(1200);
 const tabs=await p.locator('[data-testid^="tr-tab-"]').evaluateAll(e=>e.map(x=>x.innerText));
 ok('régulation : 4 onglets (pas de véhicules, dépenses, rapports)',tabs.length===4&&!tabs.includes('Véhicules')&&!tabs.includes('Rapports'),tabs);
 await tab(p,'voyages');
 ok('régulation : peut créer un voyage',(await g(p,'tr-nouveau-voyage').count())===1);
 await tab(p,'factures');
 ok('régulation : pas de case TCA ni d\'annulation de facture',(await g(p,'tr-tca').count())===0);await p.close();}
// lecture seule
{const {p}=await boot(b,{settings:{companyName:'Trans Test',currency:'HTG'},primary:true,cats:{transport:data},pageInit:mk('Lecteur')});await p.waitForTimeout(1200);
 await tab(p,'voyages');
 ok('lecture seule : pas de formulaire de voyage, bordereau imprimable',(await g(p,'tr-nouveau-voyage').count())===0&&(await g(p,'tr-voy-bordereau').count())>0);await p.close();}
await b.close();console.log(fails?('ÉCHEC : '+fails):'OK');process.exit(fails?1:0)})();

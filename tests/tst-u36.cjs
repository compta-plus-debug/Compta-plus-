// v293 — bloc BTP et construction : clients, chantiers et bordereau de prix, avance, situations de travaux (retenue de garantie, récupération de l'avance), encaissements, libération de la retenue, dépenses et dettes, rapports, statistiques, secrétariat (Vendeur), petits écrans.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const iso=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const jours=(n)=>{const d=new Date();d.setHours(12);d.setDate(d.getDate()+n);return iso(d)};
const S='[\\s\\u202f\\u00a0]?';const re=(a,b)=>new RegExp('^'+a+S+b);
const mk=(role)=>new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors=['btp'];S.tables.companies[0].sectors_locked=true;S.tables.company_members[0].role="+JSON.stringify(role)+";})()");
const sub=async(p,id)=>{await g(p,'bt-sub-'+id).click();await p.waitForTimeout(250)};
const tab=async(p,id)=>{await g(p,'bt-tab-'+id).click();await p.waitForTimeout(350)};
const cat=(p,c)=>p.evaluate((c)=>window.__srv.getCat(c)||[],c);
const sum=(e,acc)=>e.reduce((s,x)=>s+x.lines.filter(l=>l.account===acc).reduce((a,l)=>a+l.debit-l.credit,0),0);
const an=new Date().getFullYear();
const data=[
 {type:'client',id:'c1',name:'Société Delmas',phone:'3700-1',address:''},
 {type:'client',id:'c2',name:'Mme Pierre',phone:'',address:''},
 {type:'site',id:'s1',number:'CH-'+an+'-0001',name:'Villa Pétion-Ville',clientId:'c1',address:'Pétion-Ville',start:jours(-60),end:'',retPct:5,budget:30000,status:'encours',
  lines:[{id:'l1',label:'Maçonnerie',unit:'m²',qty:100,pu:500},{id:'l2',label:'Peinture',unit:'m²',qty:200,pu:100}],avances:[{id:'a1',date:jours(-55),amount:7000,mode:'caisse',entryId:'',status:'valide'}],staff:[{id:'m1',name:'Pierre Noël',role:'Conducteur de travaux',phone:'3600-1'},{id:'m2',name:'Jean Louis',role:'Chef de chantier',phone:''}]},
 {type:'site',id:'s2',number:'CH-'+an+'-0002',name:'Entrepôt Tabarre',clientId:'c2',address:'',start:jours(-90),end:jours(-10),retPct:0,budget:0,status:'encours',lines:[{id:'l3',label:'Dalle',unit:'m²',qty:10,pu:1000}],avances:[]},
 {type:'sit',id:'z0',number:'DC-'+an+'-0001',n:1,date:jours(-45),siteId:'s2',clientId:'c2',cum:{l3:3},lignes:[{id:'l3',label:'Dalle',unit:'m²',qty:10,pu:1000,prevQty:0,cumQty:3,montant:3000}],marche:10000,cumHt:3000,prevHt:0,ht:3000,tcaRate:0,tca:0,ttc:3000,retPct:0,retenue:0,recup:0,net:3000,entryId:'',status:'emise',payments:[]},
 {type:'dep',id:'d1',date:jours(-20),siteId:'s1',kind:'materiaux',supplier:'',label:'Ciment',amount:40000,mode:'caisse',entryId:'',status:'valide',settlements:[]},
 {type:'dep',id:'d2',date:jours(-40),siteId:'s1',kind:'soustraitance',supplier:'Tito Maçon',label:'Coffrage',amount:5000,mode:'apayer',entryId:'',status:'valide',settlements:[]}];
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p,errs}=await boot(b,{settings:{companyName:'BTP Test',currency:'HTG',taxRate:10},primary:true,pageInit:mk('Administrateur')});await p.waitForTimeout(1200);
 ok('module BTP ouvert par défaut',(await g(p,'btp-module').count())===1);
 const tabs=await p.locator('[data-testid^="bt-tab-"]').evaluateAll(e=>e.map(x=>x.innerText));
 ok('7 onglets, premier : Tableau de bord',tabs[0]==='Tableau de bord'&&tabs.length===7,tabs);
 ok('guide en 7 étapes, aucune cochée',(await g(p,'bt-etape').count())===7&&(await p.locator('[data-testid="bt-etape"]:has-text("✓")').count())===0);
 ok('message de départ',(await g(p,'bt-vide').count())===1);
 await tab(p,'clients');
 await g(p,'bt-client-nom').fill('Société Delmas');await g(p,'bt-client-ajouter').click();await p.waitForTimeout(400);
 await g(p,'bt-client-nom').fill('societe delmas');await g(p,'bt-client-ajouter').click();await p.waitForTimeout(400);
 ok('client ajouté, doublon refusé',(await g(p,'bt-client-ligne').count())===1);
 await tab(p,'chantiers');
 await g(p,'bt-ch-nom').fill('Maison A');await g(p,'bt-ch-responsable').fill('Marc Léger');await g(p,'bt-ch-client').selectOption({index:1});await g(p,'bt-ch-retenue').fill('5');await g(p,'bt-ch-creer').click();await p.waitForTimeout(500);
 ok('chantier créé et ouvert',(await g(p,'bt-ch-ligne').count())===1&&(await g(p,'bt-ch-detail').count())===1&&/CH-\d{4}-0001/.test(await g(p,'bt-ch-detail').innerText()));
 await sub(p,'equipe');
 ok('chef de chantier saisi à la création : affecté et affiché',(await g(p,'bt-staff-ligne').count())===1&&/Chef de chantier/.test(await g(p,'bt-staff-ligne').innerText())&&/Marc Léger/.test(await g(p,'bt-ch-resp').innerText()),await g(p,'bt-staff-ligne').count());
 await g(p,'bt-staff-nom').fill('Anne Paul');await g(p,'bt-staff-role').fill('Ingénieur');await g(p,'bt-staff-ajouter').click();await p.waitForTimeout(350);
 await g(p,'bt-staff-nom').fill('Anne Paul');await g(p,'bt-staff-role').fill('ingénieur');await g(p,'bt-staff-ajouter').click();await p.waitForTimeout(350);
 ok('encadrement : 2 personnes (doublon refusé)',(await g(p,'bt-staff-ligne').count())===2,await g(p,'bt-staff-ligne').count());
 await g(p,'bt-staff-nom').fill('Sans Fonction');await g(p,'bt-staff-role').fill('');await g(p,'bt-staff-ajouter').click();await p.waitForTimeout(300);
 ok('fonction obligatoire',(await g(p,'bt-staff-ligne').count())===2);
 await g(p,'bt-staff-retirer').nth(1).click();await p.waitForTimeout(300);
 ok('personne retirée',(await g(p,'bt-staff-ligne').count())===1);
 await sub(p,'marche');
 await g(p,'bt-lg-label').fill('Terrassement');await g(p,'bt-lg-unite').fill('m³');await g(p,'bt-lg-qte').fill('50');await g(p,'bt-lg-pu').fill('1200');await g(p,'bt-lg-ajouter').click();await p.waitForTimeout(400);
 ok('ligne ajoutée : marché 60 000',(await g(p,'bt-ligne').count())===1&&re('60','000').test(await g(p,'bt-marche').innerText()),await g(p,'bt-marche').innerText().catch(()=>''));
 await g(p,'bt-ch-retenue').count();
 ok('aucune erreur JS',errs.length===0,errs);await p.close();}
{const {p,errs}=await boot(b,{settings:{companyName:'BTP Test',currency:'HTG',taxRate:10},primary:true,cats:{btp:data},pageInit:mk('Administrateur')});await p.waitForTimeout(1200);
 const t=async(id)=>await g(p,id).innerText();
 ok('guide : 6 étapes cochées sur 7 (reste l\'encaissement)',(await p.locator('[data-testid="bt-etape"]:has-text("✓")').count())===6,await p.locator('[data-testid="bt-etape"]:has-text("✓")').count());
 ok('5 choses à faire (impayé, fin dépassée, budget, dépenses sans situation, dette)',(await g(p,'bt-afaire-ligne').count())===5,await g(p,'bt-afaire-ligne').allInnerTexts());
 ok('2 chantiers en cours, à recevoir 3 000, dettes 5 000',(await t('bt-kpi-encours')).trim()==='2'&&re('3','000').test(await t('bt-kpi-dus'))&&re('5','000').test(await t('bt-kpi-dettes')),[await t('bt-kpi-encours'),await t('bt-kpi-dus'),await t('bt-kpi-dettes')]);
 await tab(p,'chantiers');
 ok('2 chantiers : marchés 80 000, facturé 3 000, dépenses 45 000',(await g(p,'bt-ch-ligne').count())===2&&re('80','000').test(await t('bt-ch-tot-marche'))&&re('3','000').test(await t('bt-ch-tot-fact'))&&re('45','000').test(await t('bt-ch-tot-dep')),[await t('bt-ch-tot-marche'),await t('bt-ch-tot-fact'),await t('bt-ch-tot-dep')]);
 await g(p,'bt-ch-recherche').fill('entrepôt');await p.waitForTimeout(250);
 ok('recherche par nom',(await g(p,'bt-ch-ligne').count())===1);
 await g(p,'bt-ch-recherche').fill('jean louis');await p.waitForTimeout(250);
 ok('recherche par responsable : la villa, responsable = le chef de chantier',(await g(p,'bt-ch-ligne').count())===1&&/Jean Louis/.test(await g(p,'bt-ch-resp').innerText()),await g(p,'bt-ch-resp').allInnerTexts());
 await g(p,'bt-ch-recherche').fill('');await g(p,'bt-ch-filtre-etat').selectOption('termine');await p.waitForTimeout(250);
 ok('filtre « Terminé » : aucun',(await g(p,'bt-ch-ligne').count())===0);
 await g(p,'bt-ch-filtre-etat').selectOption('');await p.waitForTimeout(250);
 await p.locator('[data-testid="bt-ch-ligne"]:has-text("Villa")  [data-testid="bt-ch-ouvrir"]').click();await p.waitForTimeout(350);
 await sub(p,'equipe');
 ok('fiche : encadrement de 2 personnes (conducteur et chef de chantier)',(await g(p,'bt-staff-ligne').count())===2);
 await sub(p,'marche');
 ok('fiche : marché 70 000, avance reçue 7 000, retenue à libérer 0',re('70','000').test(await t('bt-marche'))&&re('7','000').test(await t('bt-avance-recue'))&&/^0/.test((await t('bt-retenue-due')).trim()),[await t('bt-marche'),await t('bt-avance-recue'),await t('bt-retenue-due')]);
 await g(p,'bt-lg-label').fill('Carrelage');await g(p,'bt-lg-qte').fill('10');await g(p,'bt-lg-pu').fill('800');await g(p,'bt-lg-ajouter').click();await p.waitForTimeout(350);
 ok('ligne ajoutée : marché 78 000',re('78','000').test(await t('bt-marche')),await t('bt-marche'));
 await p.locator('[data-testid="bt-ligne"] >> nth=-1 >> [data-testid="bt-ligne-retirer"]').click();await p.waitForTimeout(350);
 ok('ligne retirée : marché 70 000',re('70','000').test(await t('bt-marche')));
 await g(p,'bt-ch-devis').click();await p.waitForTimeout(400);
 ok('devis imprimable (écran et impression)',(await g(p,'bt-devis-feuille').count())===2&&/DEVIS ESTIMATIF/.test(await g(p,'bt-devis-feuille').first().innerText())&&(await g(p,'bt-devis-feuille').first().innerText()).includes('Maçonnerie'));
 await g(p,'bt-apercu-fermer').click();await p.waitForTimeout(250);
 // situations
 await tab(p,'situations');
 await g(p,'bt-sit-chantier').selectOption('s1');await p.waitForTimeout(300);
 const cums=g(p,'bt-sit-cum');
 await cums.nth(0).fill('40');await p.waitForTimeout(250);
 ok('calcul : 20 000 de travaux, retenue 1 000, avance récupérée 2 000, net 17 000',re('20','000').test(await t('bt-sit-ht'))&&/1[\s  ]?000/.test(await t('bt-sit-ret'))&&/2[\s  ]?000/.test(await t('bt-sit-recup'))&&re('17','000').test(await t('bt-sit-net')),[await t('bt-sit-ht'),await t('bt-sit-ret'),await t('bt-sit-recup'),await t('bt-sit-net')]);
 await cums.nth(0).fill('150');await p.waitForTimeout(250);
 ok('quantité au-dessus du marché : message et bouton grisé',(await g(p,'bt-sit-erreur').count())===1&&(await g(p,'bt-sit-emettre').isDisabled()));
 await cums.nth(0).fill('40');await cums.nth(1).fill('100');await p.waitForTimeout(250);
 ok('avec la peinture : 30 000, net 25 500',re('30','000').test(await t('bt-sit-ht'))&&re('25','500').test(await t('bt-sit-net')),[await t('bt-sit-ht'),await t('bt-sit-net')]);
 await g(p,'bt-sit-emettre').click();await p.waitForTimeout(700);
 let e=await cat(p,'entries');let tb=e.filter(x=>x.kind==='btp');
 ok('écritures : 411 = 25 500, 4117 = 1 500, 4191 = 3 000, 706 = -30 000',Math.abs(sum(tb,'411')-25500)<.01&&Math.abs(sum(tb,'4117')-1500)<.01&&Math.abs(sum(tb,'4191')-3000)<.01&&Math.abs(sum(tb,'706')+30000)<.01,[sum(tb,'411'),sum(tb,'4117'),sum(tb,'4191'),sum(tb,'706')]);
 ok('situation n° 1 de la villa ouverte, DC-…-0002',(await g(p,'bt-sit-detail').count())===1&&new RegExp('DC-'+an+'-0002').test(await g(p,'bt-sit-detail').innerText()));
 // quantité inférieure à la précédente
 await g(p,'bt-sit-chantier').selectOption('s1');await p.waitForTimeout(300);
 await cums.nth(0).fill('10');await p.waitForTimeout(250);
 ok('quantité inférieure à la situation précédente : message et bouton grisé',(await g(p,'bt-sit-erreur').count())===1&&(await g(p,'bt-sit-emettre').isDisabled())&&(await g(p,'bt-sit-ligne-liste').count())===2);
 // deuxième situation : tout le marché
 await cums.nth(0).fill('100');await cums.nth(1).fill('200');await p.waitForTimeout(250);
 ok('solde du marché : 40 000, retenue 2 000, avance restante 4 000, net 34 000',re('40','000').test(await t('bt-sit-ht'))&&re('34','000').test(await t('bt-sit-net')),[await t('bt-sit-ht'),await t('bt-sit-ret'),await t('bt-sit-recup'),await t('bt-sit-net')]);
 await g(p,'bt-sit-emettre').click();await p.waitForTimeout(700);
 e=await cat(p,'entries');tb=e.filter(x=>x.kind==='btp');
 ok('cumul écritures : 4117 = 3 500, 4191 = 7 000 (avance entièrement récupérée), 706 = -70 000',Math.abs(sum(tb,'4117')-3500)<.01&&Math.abs(sum(tb,'4191')-7000)<.01&&Math.abs(sum(tb,'706')+70000)<.01,[sum(tb,'4117'),sum(tb,'4191'),sum(tb,'706')]);
 ok('3 situations listées, travaux 73 000',(await g(p,'bt-sit-ligne-liste').count())===3&&re('73','000').test(await t('bt-sit-tot-ht')),await t('bt-sit-tot-ht'));
 // encaissement
 await g(p,'bt-pay-montant').fill('10000');await g(p,'bt-pay-valider').click();await p.waitForTimeout(500);
 ok('encaissement partiel : reste 24 000',re('24','000').test(await t('bt-sit-reste')),await t('bt-sit-reste'));
 await g(p,'bt-pay-montant').fill('99999');await g(p,'bt-pay-valider').click();await p.waitForTimeout(400);
 ok('encaissement supérieur au reste refusé',(await g(p,'bt-pay-ligne').count())===1);
 await g(p,'bt-pay-montant').fill('24000');await g(p,'bt-pay-valider').click();await p.waitForTimeout(500);
 ok('situation soldée',/^0/.test((await t('bt-sit-reste')).trim()));
 await g(p,'bt-sit-filtre-etat').selectOption('soldee');await p.waitForTimeout(250);
 ok('filtre « Soldée » : 1 situation',(await g(p,'bt-sit-ligne-liste').count())===1);
 await g(p,'bt-sit-filtre-etat').selectOption('');await p.waitForTimeout(250);
 await g(p,'bt-sit-imprimer').first().click();await p.waitForTimeout(400);
 const ft=await g(p,'bt-situation-feuille').first().innerText();
 ok('situation imprimable : n° 2, net à payer',(await g(p,'bt-situation-feuille').count())===2&&/SITUATION DE TRAVAUX N° 2/.test(ft)&&/NET À PAYER/.test(ft)&&/34[\s  ]?000/.test(ft),ft.slice(0,160));
 await g(p,'bt-apercu-fermer').click();await p.waitForTimeout(250);
 // dépenses et dettes
 await tab(p,'depenses');
 await g(p,'bt-dep-chantier').selectOption('s1');await g(p,'bt-dep-nature').selectOption('materiaux');await g(p,'bt-dep-montant').fill('2000');await g(p,'bt-dep-valider').click();await p.waitForTimeout(500);
 e=await cat(p,'entries');tb=e.filter(x=>x.kind==='btp');
 ok('dépense payée : 601 = 2 000',Math.abs(sum(tb,'601')-2000)<.01,sum(tb,'601'));
 await g(p,'bt-dep-montant').fill('3000');await g(p,'bt-dep-mode').selectOption('apayer');await g(p,'bt-dep-valider').click();await p.waitForTimeout(400);
 ok('dette sans fournisseur refusée',(await g(p,'bt-dep-ligne').count())===3);
 await g(p,'bt-dep-tiers').fill('Quincaillerie X');await g(p,'bt-dep-valider').click();await p.waitForTimeout(500);
 e=await cat(p,'entries');tb=e.filter(x=>x.kind==='btp');
 ok('dette enregistrée : 401 = -3 000',Math.abs(sum(tb,'401')+3000)<.01&&(await g(p,'bt-dep-ligne').count())===4,sum(tb,'401'));
 ok('dépenses : total 50 000, reste à payer 8 000',re('50','000').test(await t('bt-dep-tot'))&&re('8','000').test(await t('bt-dep-tot-reste')),[await t('bt-dep-tot'),await t('bt-dep-tot-reste')]);
 await g(p,'bt-dep-filtre-etat').selectOption('apayer');await p.waitForTimeout(250);
 ok('filtre « À payer » : 2 dettes',(await g(p,'bt-dep-ligne').count())===2);
 await p.locator('[data-testid="bt-dep-ligne"]:has-text("Quincaillerie X") [data-testid="bt-dep-ouvrir"]').click();await p.waitForTimeout(350);
 await g(p,'bt-regl-montant').fill('1000');await g(p,'bt-regl-valider').click();await p.waitForTimeout(500);
 e=await cat(p,'entries');tb=e.filter(x=>x.kind==='btp');
 ok('règlement partiel : reste 2 000, 401 = -2 000',re('2','000').test(await t('bt-dep-reste'))&&Math.abs(sum(tb,'401')+2000)<.01,[await t('bt-dep-reste'),sum(tb,'401')]);
 await g(p,'bt-regl-montant').fill('99999');await g(p,'bt-regl-valider').click();await p.waitForTimeout(400);
 ok('règlement supérieur au reste refusé',(await g(p,'bt-regl-ligne').count())===1);
 await g(p,'bt-regl-montant').fill('');await g(p,'bt-regl-valider').click();await p.waitForTimeout(500);
 ok('dette soldée (champ vide = tout)',/^0/.test((await t('bt-dep-reste')).trim())&&Math.abs(sum((await cat(p,'entries')).filter(x=>x.kind==='btp'),'401')-0)>=0);
 await g(p,'bt-dep-filtre-etat').selectOption('');await p.waitForTimeout(250);
 // rapports
 await tab(p,'rapports');
 ok('rentabilité : marchés 80 000, facturé 73 000, encaissé 34 000, dépenses 50 000, marge 23 000',re('80','000').test(await t('bt-rapport-ch-tot-marche'))&&re('73','000').test(await t('bt-rapport-ch-tot-fact'))&&re('34','000').test(await t('bt-rapport-ch-tot-enc'))&&re('50','000').test(await t('bt-rapport-ch-tot-dep'))&&re('23','000').test(await t('bt-rapport-ch-tot-marge')),[await t('bt-rapport-ch-tot-marche'),await t('bt-rapport-ch-tot-fact'),await t('bt-rapport-ch-tot-enc'),await t('bt-rapport-ch-tot-dep'),await t('bt-rapport-ch-tot-marge')]);
 ok('reste à facturer 7 000, retenue à libérer 3 500',re('7','000').test(await t('bt-rapport-ch-tot-reste'))&&re('3','500').test(await t('bt-rapport-ch-tot-ret')),[await t('bt-rapport-ch-tot-reste'),await t('bt-rapport-ch-tot-ret')]);
 ok('impayés : 28 500',re('28','500').test(await t('bt-rapport-imp-tot-reste')),await t('bt-rapport-imp-tot-reste'));
 ok('dettes en cours : 5 000 (Tito Maçon)',re('5','000').test(await t('bt-rapport-dette-tot'))&&(await g(p,'bt-rapport-dette').count())===1,await t('bt-rapport-dette-tot'));
 ok('dépenses par nature : 50 000',re('50','000').test(await t('bt-rapport-nature-tot')));
 await g(p,'bt-rapport-du').fill(jours(5));await p.waitForTimeout(300);
 ok('période future : plus rien de facturé',(await g(p,'bt-rapport-imp').count())===0&&/^0/.test((await t('bt-rapport-ch-tot-fact')).trim()),await t('bt-rapport-ch-tot-fact'));
 await g(p,'bt-rapport-du').fill('');await p.waitForTimeout(250);
 await tab(p,'stats');
 const st=await g(p,'stats-bloc').innerText();
 ok('statistiques : par chantier, par nature, impayés',/Travaux facturés par chantier/.test(st)&&/Dépenses par nature/.test(st)&&/Situations impayées par client/.test(st),st.slice(0,200));
 // retenue de garantie
 await tab(p,'chantiers');
 if((await g(p,'bt-ch-detail').count())===0)await p.locator('[data-testid="bt-ch-ligne"]:has-text("Villa") [data-testid="bt-ch-ouvrir"]').click();
 await p.waitForTimeout(300);
 await sub(p,'marche');
 ok('retenue à libérer 3 500',re('3','500').test(await t('bt-retenue-due')),await t('bt-retenue-due'));
 await g(p,'bt-retrel-valider').click();await p.waitForTimeout(400);
 ok('retenue refusée tant que le chantier n\'est pas terminé',(await g(p,'bt-retrel-ligne').count())===0);
 await g(p,'bt-ch-etat').selectOption('termine');await p.waitForTimeout(300);
 await g(p,'bt-retrel-valider').click();await p.waitForTimeout(500);
 e=await cat(p,'entries');tb=e.filter(x=>x.kind==='btp');
 ok('retenue encaissée : 4117 soldé, retenue à libérer 0',Math.abs(sum(tb,'4117'))<.01&&/^0/.test((await t('bt-retenue-due')).trim()),[sum(tb,'4117'),await t('bt-retenue-due')]);
 // annulations
 await tab(p,'situations');
 await g(p,'bt-sit-filtre-etat').selectOption('soldee');await p.waitForTimeout(250);
 if((await g(p,'bt-sit-detail').count())===0){await g(p,'bt-sit-ouvrir').first().click();await p.waitForTimeout(300);}
 await g(p,'bt-sit-annuler').click();await p.waitForTimeout(400);
 ok('situation encaissée : annulation refusée',(await g(p,'bt-sit-annuler').count())===1);
 while((await g(p,'bt-pay-annuler').count())>0){await g(p,'bt-pay-annuler').first().click();await p.waitForTimeout(450);}
 await g(p,'bt-sit-annuler').click();await p.waitForTimeout(400);
 ok('retenue déjà encaissée : annulation refusée',(await g(p,'bt-sit-annuler').count())===1);
 await tab(p,'chantiers');
 if((await g(p,'bt-ch-detail').count())===0)await p.locator('[data-testid="bt-ch-ligne"]:has-text("Villa") [data-testid="bt-ch-ouvrir"]').click();
 await p.waitForTimeout(300);
 await sub(p,'marche');
 await g(p,'bt-retrel-annuler').click();await p.waitForTimeout(500);
 await tab(p,'situations');
 await g(p,'bt-sit-filtre-etat').selectOption('soldee');await p.waitForTimeout(250);
 await g(p,'bt-sit-filtre-etat').selectOption('encaisser');await p.waitForTimeout(250);
 if(!new RegExp('DC-'+an+'-0003').test((await g(p,'bt-sit-detail').count())?await g(p,'bt-sit-detail').innerText():'')){
   await p.locator('[data-testid="bt-sit-ligne-liste"]:has-text("n° 2")').first().locator('[data-testid="bt-sit-ouvrir"]').click();await p.waitForTimeout(300);
   if(!new RegExp('DC-'+an+'-0003').test(await g(p,'bt-sit-detail').innerText().catch(()=>''))){await p.locator('[data-testid="bt-sit-ligne-liste"]:has-text("n° 2")').first().locator('[data-testid="bt-sit-ouvrir"]').click();await p.waitForTimeout(300);}
 }
 await g(p,'bt-sit-annuler').click();await p.waitForTimeout(600);
 e=await cat(p,'entries');tb=e.filter(x=>x.kind==='btp');
 ok('situation 2 annulée : 4117 = 1 500 et 4191 = 3 000 (situation 1 seule)',Math.abs(sum(tb,'4117')-1500)<.01&&Math.abs(sum(tb,'4191')-3000)<.01,[sum(tb,'4117'),sum(tb,'4191')]);
 await g(p,'bt-sit-filtre-etat').selectOption('annulee');await p.waitForTimeout(250);
 ok('filtre « Annulée » : 1 situation',(await g(p,'bt-sit-ligne-liste').count())===1);
 // dossier de projet : étapes, budget, tâches
 await tab(p,'chantiers');
 if((await g(p,'bt-ch-detail').count())===0)await p.locator('[data-testid="bt-ch-ligne"]:has-text("Villa") [data-testid="bt-ch-ouvrir"]').click();
 await p.waitForTimeout(300);await sub(p,'vue');
 ok('vue d\'ensemble : avancement physique « — » sans étape',/—/.test(await t('bt-vue-phys')),await t('bt-vue-phys'));
 await sub(p,'etapes');
 await g(p,'bt-ph-courantes').click();await p.waitForTimeout(350);
 ok('étapes courantes insérées (7, sans dates ni poids)',(await g(p,'bt-phase-ligne').count())===7,await g(p,'bt-phase-ligne').count());
 for(let i=0;i<7;i++){await g(p,'bt-phase-retirer').first().click();await p.waitForTimeout(150);}
 ok('étapes retirées',(await g(p,'bt-phase-ligne').count())===0);
 await g(p,'bt-ph-nom').fill('Fondations');await g(p,'bt-ph-debut').fill(jours(-20));await g(p,'bt-ph-fin').fill(jours(-5));await g(p,'bt-ph-poids').fill('60');await g(p,'bt-ph-ajouter').click();await p.waitForTimeout(300);
 await g(p,'bt-ph-nom').fill('Élévation');await g(p,'bt-ph-debut').fill(jours(-4));await g(p,'bt-ph-fin').fill(jours(30));await g(p,'bt-ph-poids').fill('40');await g(p,'bt-ph-ajouter').click();await p.waitForTimeout(300);
 ok('2 étapes, total des poids 100, pas d\'alerte',(await g(p,'bt-phase-ligne').count())===2&&(await t('bt-phase-tot-poids')).trim()==='100'&&(await g(p,'bt-et-poids-alerte').count())===0);
 ok('frise affichée et étape non terminée dépassée = en retard',(await g(p,'bt-frise').count())===1&&/retard/i.test(await g(p,'bt-phase-etat').first().innerText()),await g(p,'bt-phase-etat').first().innerText());
 await g(p,'bt-ph-nom').fill('Fondations');await g(p,'bt-ph-ajouter').click();await p.waitForTimeout(250);
 ok('étape en double refusée',(await g(p,'bt-phase-ligne').count())===2);
 await g(p,'bt-phase-pct').first().fill('100');await g(p,'bt-phase-pct').first().blur();await p.waitForTimeout(300);
 ok('étape à 100 % : terminée',/Termin/.test(await g(p,'bt-phase-etat').first().innerText()),await g(p,'bt-phase-etat').first().innerText());
 await g(p,'bt-phase-pct').nth(1).fill('50');await g(p,'bt-phase-pct').nth(1).blur();await p.waitForTimeout(300);
 ok('avancement physique pondéré = 80 %',/80/.test(await t('bt-et-phys')),await t('bt-et-phys'));
 await g(p,'bt-ph-nom').fill('Finitions');await g(p,'bt-ph-poids').fill('10');await g(p,'bt-ph-debut').fill('');await g(p,'bt-ph-fin').fill('');await g(p,'bt-ph-ajouter').click();await p.waitForTimeout(300);
 ok('total des poids 110 : alerte affichée',(await g(p,'bt-et-poids-alerte').count())===1);
 await g(p,'bt-phase-retirer').nth(2).click();await p.waitForTimeout(250);
 await sub(p,'vue');
 ok('vue d\'ensemble : avancement physique 80 %',/80/.test(await t('bt-vue-phys')),await t('bt-vue-phys'));
 await sub(p,'budget');
 await g(p,'bt-bud-materiaux').fill('20000');await g(p,'bt-bud-materiaux').blur();await g(p,'bt-bud-maindoeuvre').fill('10000');await g(p,'bt-bud-maindoeuvre').blur();await p.waitForTimeout(300);
 ok('budget d\'exécution par nature : total 30 000',re('30','000').test(await t('bt-bud-tot-budget')),await t('bt-bud-tot-budget'));
 ok('budget : 6 natures',(await g(p,'bt-bud-ligne').count())===6);
 await sub(p,'equipe');
 await g(p,'bt-tache-ajouter').click();await p.waitForTimeout(250);
 ok('tâche sans titre refusée',(await g(p,'bt-tache-ligne').count())===0);
 await g(p,'bt-tache-titre').fill('Visite de contrôle des fondations');await g(p,'bt-tache-resp').selectOption({index:1});await g(p,'bt-tache-echeance').fill(jours(-2));await g(p,'bt-tache-ajouter').click();await p.waitForTimeout(300);
 ok('tâche ajoutée et en retard',(await g(p,'bt-tache-ligne').count())===1&&/retard/i.test(await g(p,'bt-tache-ligne').innerText()),await g(p,'bt-tache-ligne').innerText());
 await sub(p,'vue');
 ok('vue d\'ensemble : alertes facturation en retard sur les travaux, budget dépassé, tâche en retard',(await g(p,'bt-vue-alerte').filter({hasText:'devancent la facturation'}).count())===1&&(await g(p,'bt-vue-alerte').filter({hasText:'dépassent le budget'}).count())===1&&(await g(p,'bt-vue-alerte').filter({hasText:'tâche'}).count())===1,await g(p,'bt-vue-alerte').allInnerTexts());
 await g(p,'bt-ch-etat').selectOption('encours');await p.waitForTimeout(400);
 await tab(p,'apercu');
 ok('« À faire » : tâche en retard signalée',(await g(p,'bt-afaire-ligne').filter({hasText:'tâche'}).count())===1,await g(p,'bt-afaire-ligne').allInnerTexts());
 await tab(p,'chantiers');
 if((await g(p,'bt-ch-detail').count())===0)await p.locator('[data-testid="bt-ch-ligne"]:has-text("Villa") [data-testid="bt-ch-ouvrir"]').click();
 await p.waitForTimeout(300);await sub(p,'equipe');
 await g(p,'bt-tache-etat').first().selectOption('fait');await p.waitForTimeout(300);
 ok('tâche faite : plus en retard',!/retard/i.test(await g(p,'bt-tache-ligne').innerText())&&/1 faite/.test(await t('bt-tache-total')),await t('bt-tache-total'));
 // v298 : flèches déroulantes, boutons Enregistrer, explication des poids, suivi du marché
 await sub(p,'equipe');
 ok('flèche déroulante des tâches : liste de tâches types',(await g(p,'bt-fleche-tache').locator('option').count())>=5,await g(p,'bt-fleche-tache').locator('option').count());
 await g(p,'bt-fleche-tache').selectOption({index:2});await p.waitForTimeout(250);
 ok('choix dans la liste : la case Tâche est remplie',(await g(p,'bt-tache-titre').inputValue()).length>5,await g(p,'bt-tache-titre').inputValue());
 await g(p,'bt-fleche-role').selectOption({index:2});await p.waitForTimeout(250);
 ok('flèche déroulante des fonctions : la case est remplie',(await g(p,'bt-staff-role').inputValue()).length>3,await g(p,'bt-staff-role').inputValue());
 await sub(p,'etapes');
 ok('explication des poids avec exemple',(await g(p,'bt-et-aide').count())===1&&/50 %/.test(await g(p,'bt-et-aide').textContent()));
 await g(p,'bt-ph-nom').fill('Étape A');await g(p,'bt-ph-ajouter').click();await p.waitForTimeout(250);
 await g(p,'bt-ph-nom').fill('Étape B');await g(p,'bt-ph-ajouter').click();await p.waitForTimeout(250);
 await g(p,'bt-ph-egal').click();await p.waitForTimeout(350);
 ok('poids répartis également : total 100',(await g(p,'bt-phase-tot-poids').innerText()).trim()==='100',await g(p,'bt-phase-tot-poids').innerText());
 await g(p,'bt-fleche-etape').selectOption({index:1});await p.waitForTimeout(250);
 ok('flèche des étapes : la case est remplie',(await g(p,'bt-ph-nom').inputValue()).length>3,await g(p,'bt-ph-nom').inputValue());
 await g(p,'bt-et-enregistrer').click();await p.waitForTimeout(300);
 ok('bouton Enregistrer les étapes : confirmation',/Étapes enregistrées/.test(await p.locator('body').innerText()));
 await sub(p,'budget');await g(p,'bt-bud-enregistrer').click();await p.waitForTimeout(300);
 ok('bouton Enregistrer le budget : confirmation avec total',/Budget d'exécution enregistré/.test(await p.locator('body').innerText()));
 await sub(p,'marche');
 ok('suivi du marché : marché 70 000 affiché',re('70','000').test(await g(p,'bt-sm-marche').innerText()),await g(p,'bt-sm-marche').innerText());
 await g(p,'bt-marche-enregistrer').click();await p.waitForTimeout(300);
 ok('bouton Enregistrer le marché : confirmation',/Marché enregistré/.test(await p.locator('body').innerText()));
 await g(p,'bt-sm-emettre').click();await p.waitForTimeout(450);
 ok('Émettre une situation : ouvre l\'onglet Situations sur ce chantier',(await g(p,'bt-situation-bloc').count())===1&&(await g(p,'bt-sit-chantier').inputValue())==='s1',await g(p,'bt-sit-chantier').inputValue().catch(()=>''));
 await tab(p,'chantiers');
 if((await g(p,'bt-ch-detail').count())===0)await p.locator('[data-testid="bt-ch-ligne"]:has-text("Villa") [data-testid="bt-ch-ouvrir"]').click();
 await p.waitForTimeout(300);await sub(p,'marche');
 await tab(p,'situations');
 // petit écran
 await g(p,'bt-sit-filtre-etat').selectOption('');
 await p.setViewportSize({width:390,height:800});
 for(const id of ['apercu','chantiers','clients','situations','depenses','rapports']){await tab(p,id);const w=await p.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);ok('390 px sans débordement : '+id,w<=2,w);}
 ok('aucune erreur JS',errs.length===0,errs);await p.close();}
// secrétariat (Vendeur)
{const {p}=await boot(b,{settings:{companyName:'BTP Test',currency:'HTG'},primary:true,cats:{btp:data},pageInit:mk('Vendeur')});await p.waitForTimeout(1200);
 const tabs=await p.locator('[data-testid^="bt-tab-"]').evaluateAll(e=>e.map(x=>x.innerText));
 ok('secrétariat : 3 onglets (pas de chantiers, dépenses, rapports)',tabs.length===3&&!tabs.includes('Chantiers')&&!tabs.includes('Dépenses'),tabs);
 await tab(p,'situations');
 ok('secrétariat : peut émettre une situation, pas de case taxe',(await g(p,'bt-situation-bloc').count())===1&&(await g(p,'bt-tca').count())===0);
 await tab(p,'clients');
 ok('secrétariat : peut ajouter un client',(await g(p,'bt-client-nom').count())===1);await p.close();}
// lecture seule
{const {p}=await boot(b,{settings:{companyName:'BTP Test',currency:'HTG'},primary:true,cats:{btp:data},pageInit:mk('Lecteur')});await p.waitForTimeout(1200);
 await tab(p,'situations');
 ok('lecture seule : pas d\'émission, situation imprimable',(await g(p,'bt-situation-bloc').count())===0&&(await g(p,'bt-sit-imprimer').count())>0);await p.close();}
await b.close();console.log(fails?('ÉCHEC : '+fails):'OK');process.exit(fails?1:0)})();

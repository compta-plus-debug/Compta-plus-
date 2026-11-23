// v291 — bloc Immobilier et location : biens, locataires, baux (dépôt de garantie), loyers (émission, encaissement, retards), avis et quittances, dépenses, rapports, statistiques, accueil (Vendeur), petits écrans.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const iso=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const jours=(n)=>{const d=new Date();d.setHours(12);d.setDate(d.getDate()+n);return iso(d)};
const S='[\\s\\u202f\\u00a0]?';const re=(a,b)=>new RegExp(a+S+b);
const mk=(role)=>new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors=['immobilier'];S.tables.companies[0].sectors_locked=true;S.tables.company_members[0].role="+JSON.stringify(role)+";})()");
const tab=async(p,id)=>{await g(p,'im-tab-'+id).click();await p.waitForTimeout(350)};
const cat=(p,c)=>p.evaluate((c)=>window.__srv.getCat(c)||[],c);
const sum=(e,acc)=>e.reduce((s,x)=>s+x.lines.filter(l=>l.account===acc).reduce((a,l)=>a+l.debit-l.credit,0),0);
const an=new Date().getFullYear();
const mois=(n)=>jours(n).slice(0,7);
const data=[
 {type:'property',id:'p1',name:'Appartement 2B',kind:'Appartement',address:'Delmas 33',notes:'',active:true},
 {type:'property',id:'p2',name:'Local commercial 1',kind:'Local commercial',address:'Pétion-Ville',notes:'',active:true},
 {type:'property',id:'p3',name:'Studio 5',kind:'Studio',address:'Tabarre',notes:'',active:true},
 {type:'tenant',id:'t1',name:'Marie Joseph',phone:'3700-1',address:''},
 {type:'tenant',id:'t2',name:'Paul Étienne',phone:'',address:''},
 {type:'lease',id:'b1',number:'BA-'+an+'-0001',propertyId:'p1',tenantId:'t1',start:jours(-200),end:'',rent:10000,charges:1000,dueDay:5,deposit:20000,depositStatus:'',status:'actif'},
 {type:'lease',id:'b2',number:'BA-'+an+'-0002',propertyId:'p2',tenantId:'t2',start:jours(-300),end:jours(-100),rent:15000,charges:0,dueDay:1,deposit:0,depositStatus:'',status:'actif'},
 {type:'rent',id:'r0',number:'LY-'+an+'-0001',date:jours(-70),period:mois(-70),dueDate:mois(-70)+'-05',leaseId:'b1',propertyId:'p1',tenantId:'t1',rent:10000,charges:1000,ht:11000,tcaRate:0,tca:0,total:11000,entryId:'',status:'emise',payments:[]}];
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p,errs}=await boot(b,{settings:{companyName:'Immo Test',currency:'HTG',taxRate:10},primary:true,pageInit:mk('Administrateur')});await p.waitForTimeout(1200);
 ok('module Immobilier ouvert par défaut',(await g(p,'immobilier-module').count())===1);
 const tabs=await p.locator('[data-testid^="im-tab-"]').evaluateAll(e=>e.map(x=>x.innerText));
 ok('8 onglets, premier : Tableau de bord',tabs[0]==='Tableau de bord'&&tabs.length===8,tabs);
 ok('guide en 7 étapes, aucune cochée',(await g(p,'im-etape').count())===7&&(await p.locator('[data-testid="im-etape"]:has-text("✓")').count())===0);
 ok('message de départ',(await g(p,'im-vide').count())===1);
 await tab(p,'biens');
 await g(p,'im-bien-nom').fill('Maison A');await g(p,'im-bien-type').fill('Maison');await g(p,'im-bien-ajouter').click();await p.waitForTimeout(400);
 ok('bien ajouté',(await g(p,'im-bien-ligne').count())===1);
 await g(p,'im-bien-nom').fill('maison a');await g(p,'im-bien-ajouter').click();await p.waitForTimeout(400);
 ok('doublon refusé',(await g(p,'im-bien-ligne').count())===1);
 ok('aucune erreur JS',errs.length===0,errs);await p.close();}
{const {p,errs}=await boot(b,{settings:{companyName:'Immo Test',currency:'HTG',taxRate:10},primary:true,cats:{immo:data},pageInit:mk('Administrateur')});await p.waitForTimeout(1200);
 const t=async(id)=>await g(p,id).innerText();
 ok('guide : 4 étapes cochées sur 7',(await p.locator('[data-testid="im-etape"]:has-text("✓")').count())===4,await p.locator('[data-testid="im-etape"]:has-text("✓")').count());
 ok('biens loués 2 / 3, occupation 67 %',(await t('im-kpi-biens')).trim()==='2 / 3'&&/67/.test(await t('im-kpi-taux')),[await t('im-kpi-biens'),await t('im-kpi-taux')]);
 ok('à recevoir 11 000, 1 retard',re('11','000').test(await t('im-kpi-dus'))&&(await t('im-kpi-retards')).trim()==='1',[await t('im-kpi-dus'),await t('im-kpi-retards')]);
 ok('4 choses à faire (retard, loyers à émettre, bail échu, dépôt)',(await t('im-kpi-afaire')).trim()==='4'&&(await g(p,'im-afaire-ligne').count())===4,[await t('im-kpi-afaire'),await g(p,'im-afaire-ligne').count()]);
 ok('bien libre listé',(await g(p,'im-libre-ligne').count())===1);
 // biens
 await tab(p,'biens');
 ok('3 biens, loyers mensuels 26 000',(await g(p,'im-bien-ligne').count())===3&&re('26','000').test(await t('im-bien-tot-loyer')),await t('im-bien-tot-loyer'));
 await g(p,'im-bien-filtre-etat').selectOption('libre');await p.waitForTimeout(250);
 ok('filtre « Libre » : 1 bien',(await g(p,'im-bien-ligne').count())===1);
 await g(p,'im-bien-filtre-etat').selectOption('');await g(p,'im-bien-recherche').fill('marie');await p.waitForTimeout(250);
 ok('recherche par locataire',(await g(p,'im-bien-ligne').count())===1);
 await g(p,'im-bien-recherche').fill('');await p.waitForTimeout(250);
 // locataires
 await tab(p,'locataires');
 ok('2 locataires, reste à payer total 11 000',(await g(p,'im-loc-ligne').count())===2&&re('11','000').test(await t('im-loc-tot-reste')),await t('im-loc-tot-reste'));
 // bail
 await tab(p,'baux');
 const opts=await p.locator('[data-testid="im-bail-bien"] option').evaluateAll(e=>e.map(x=>x.innerText));
 const dis=await p.locator('[data-testid="im-bail-bien"] option').evaluateAll(e=>e.map(x=>x.disabled));
 ok('tous les biens listés : occupés grisés avec le locataire, seul le libre est choisissable',opts.length===4&&dis.join()==='false,true,true,false'&&/loué à Marie/.test(opts[1])&&/Studio 5/.test(opts[3]),[opts,dis]);
 ok('pas de message « aucun bien libre » quand un bien est libre',(await g(p,'im-bail-aucun-libre').count())===0);
 await g(p,'im-bail-bien').selectOption('p3');await g(p,'im-bail-locataire').selectOption('t2');await g(p,'im-bail-loyer').fill('5000');await g(p,'im-bail-jour').selectOption('28');await g(p,'im-bail-depot').fill('5000');await g(p,'im-bail-creer').click();await p.waitForTimeout(500);
 ok('bail créé et ouvert',(await g(p,'im-bail-ligne').count())===3&&(await g(p,'im-bail-detail').count())===1&&/BA-\d{4}-0003/.test(await g(p,'im-bail-detail').innerText()));
 // dépôt de garantie
 await g(p,'im-depot-recevoir').click();await p.waitForTimeout(500);
 let e=await cat(p,'entries');let ti=e.filter(x=>x.kind==='immo');
 ok('dépôt reçu : caisse +5 000, 165 = -5 000',Math.abs(sum(ti,'530')-5000)<.01&&Math.abs(sum(ti,'165')+5000)<.01,[sum(ti,'530'),sum(ti,'165')]);
 ok('dépôt indiqué « En garde »',/En garde/.test(await t('im-depot-etat')));
 // loyers du mois
 await tab(p,'loyers');
 ok('2 loyers à émettre ce mois (b1 et le nouveau bail ; b2 est échu)',(await t('im-gen-nb')).trim()==='2',await t('im-gen-nb'));
 await g(p,'im-gen-emettre').click();await p.waitForTimeout(700);
 e=await cat(p,'entries');ti=e.filter(x=>x.kind==='immo');
 ok('loyers émis : 411 = 16 000 + dépôt, 706 = -15 000, 708 = -1 000',Math.abs(sum(ti,'411')-16000)<.01&&Math.abs(sum(ti,'706')+15000)<.01&&Math.abs(sum(ti,'708')+1000)<.01,[sum(ti,'411'),sum(ti,'706'),sum(ti,'708')]);
 const nums=(await cat(p,'immo')).filter(x=>x.type==='rent').map(x=>x.number).sort();
 ok('numéros LY- uniques et consécutifs',nums.join()===['LY-'+an+'-0001','LY-'+an+'-0002','LY-'+an+'-0003'].join(),nums);
 ok('plus rien à émettre',(await t('im-gen-nb')).trim()==='0'&&(await g(p,'im-gen-emettre').isDisabled()));
 await g(p,'im-gen-mois').fill(mois(60));await p.waitForTimeout(250);
 await g(p,'im-gen-emettre').click();await p.waitForTimeout(400);
 ok('mois à venir refusé',(await g(p,'im-loy-ligne').count())===3);
 await g(p,'im-gen-mois').fill(jours(0).slice(0,7));await p.waitForTimeout(250);
 // loyer isolé (premier mois au prorata)
 await g(p,'im-un-bail').selectOption('b1');await g(p,'im-un-mois').fill(mois(-35));await g(p,'im-un-loyer').fill('6000');await g(p,'im-un-charges').fill('0');await g(p,'im-un-emettre').click();await p.waitForTimeout(600);
 ok('loyer isolé de 6 000 émis',(await g(p,'im-loy-ligne').count())===4&&re('6','000').test(await t('im-loy-detail')),await g(p,'im-loy-ligne').count());
 await g(p,'im-un-mois').fill(mois(-35));await g(p,'im-un-emettre').click();await p.waitForTimeout(400);
 ok('doublon de mois refusé',(await g(p,'im-loy-ligne').count())===4);
 ok('totaux : 4 loyers, 33 000 (hors annulés)',re('33','000').test(await t('im-loy-tot-total')),await t('im-loy-tot-total'));
 await g(p,'im-loy-filtre-etat').selectOption('retard');await p.waitForTimeout(250);
 ok('filtre « En retard » : au moins 2 (anciens loyers)',(await g(p,'im-loy-ligne').count())>=2,await g(p,'im-loy-ligne').count());
 await g(p,'im-loy-filtre-etat').selectOption('');await g(p,'im-loy-recherche').fill('Studio');await p.waitForTimeout(250);
 ok('recherche par bien : 1 loyer',(await g(p,'im-loy-ligne').count())===1);
 await g(p,'im-loy-recherche').fill('Appartement');await p.waitForTimeout(250);
 // encaissement du loyer courant de b1 (11 000)
 const cible=p.locator('[data-testid="im-loy-ligne"]:has-text("'+['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'][new Date().getMonth()]+'")').first();
 await cible.locator('[data-testid="im-loy-ouvrir"]').click();await p.waitForTimeout(350);
 await g(p,'im-pay-montant').fill('4000');await g(p,'im-pay-valider').click();await p.waitForTimeout(500);
 e=await cat(p,'entries');ti=e.filter(x=>x.kind==='immo');
 ok('encaissement partiel : reste 7 000, caisse +4 000 en plus du dépôt',re('7','000').test(await t('im-loy-reste'))&&Math.abs(sum(ti,'530')-9000)<.01,[await t('im-loy-reste'),sum(ti,'530')]);
 await g(p,'im-pay-montant').fill('99999');await g(p,'im-pay-valider').click();await p.waitForTimeout(400);
 ok('encaissement supérieur au reste refusé',(await g(p,'im-pay-ligne').count())===1);
 await cible.locator('[data-testid="im-loy-imprimer"]').click();await p.waitForTimeout(400);
 ok('loyer non soldé : avis d\'échéance',/AVIS D'ÉCHÉANCE/.test(await g(p,'im-loyer-feuille').first().innerText()));
 await g(p,'im-apercu-fermer').click();await p.waitForTimeout(250);
 await g(p,'im-pay-montant').fill('7000');await g(p,'im-pay-valider').click();await p.waitForTimeout(500);
 ok('loyer soldé : bouton « Quittance »',/Quittance/.test(await cible.locator('[data-testid="im-loy-imprimer"]').innerText()),await cible.innerText());
 await cible.locator('[data-testid="im-loy-imprimer"]').click();await p.waitForTimeout(400);
 const ft=await g(p,'im-loyer-feuille').first().innerText();
 ok('quittance de loyer imprimable (écran et impression), 11 000 reçus',(await g(p,'im-loyer-feuille').count())===2&&/QUITTANCE DE LOYER/.test(ft)&&/11[\s  ]?000/.test(ft),ft.slice(0,200));
 const larg=async()=>await g(p,'im-loyer-feuille').first().evaluate(x=>x.style.maxWidth);
 ok('A4 puis ticket',(await larg())==='794px');
 await g(p,'im-format').click();await p.waitForTimeout(250);
 ok('ticket après bascule',(await larg())==='300px'&&(await p.locator('.print-only.ticket-print-80').count())===1,await larg());
 await g(p,'im-apercu-fermer').click();await p.waitForTimeout(250);
 await g(p,'im-loy-recherche').fill('');await g(p,'im-loy-filtre-etat').selectOption('soldee');await p.waitForTimeout(250);
 ok('filtre « Soldé » : 1 loyer',(await g(p,'im-loy-ligne').count())===1);
 await g(p,'im-loy-filtre-etat').selectOption('');
 // dépenses
 await tab(p,'depenses');
 await g(p,'im-dep-bien').selectOption('p1');await g(p,'im-dep-nature').selectOption('entretien');await g(p,'im-dep-montant').fill('2000');await g(p,'im-dep-valider').click();await p.waitForTimeout(500);
 e=await cat(p,'entries');ti=e.filter(x=>x.kind==='immo');
 ok('dépense : 6152 = 2 000, caisse 9 000 + 7 000 - 2 000',Math.abs(sum(ti,'6152')-2000)<.01&&Math.abs(sum(ti,'530')-14000)<.01,[sum(ti,'6152'),sum(ti,'530')]);
 ok('dépenses : 1 ligne, total 2 000',(await g(p,'im-dep-ligne').count())===1&&re('2','000').test(await t('im-dep-tot')),await t('im-dep-tot'));
 // rapports
 await tab(p,'rapports');
 ok('rentabilité : facturé 33 000, encaissé 11 000, dépenses 2 000, résultat 31 000',re('33','000').test(await t('im-rapport-bien-tot-fact'))&&re('11','000').test(await t('im-rapport-bien-tot-enc'))&&re('2','000').test(await t('im-rapport-bien-tot-dep'))&&re('31','000').test(await t('im-rapport-bien-tot-res')),[await t('im-rapport-bien-tot-fact'),await t('im-rapport-bien-tot-enc'),await t('im-rapport-bien-tot-dep'),await t('im-rapport-bien-tot-res')]);
 ok('impayés : reste 22 000',re('22','000').test(await t('im-rapport-imp-tot-reste')),await t('im-rapport-imp-tot-reste'));
 ok('dépenses par nature : 2 000',re('2','000').test(await t('im-rapport-nature-tot')));
 await g(p,'im-rapport-du').fill(jours(5));await p.waitForTimeout(300);
 ok('période future : plus de loyers facturés',(await g(p,'im-rapport-imp').count())===0&&/^0/.test((await t('im-rapport-bien-tot-fact')).trim()),await t('im-rapport-bien-tot-fact'));
 await g(p,'im-rapport-du').fill('');await p.waitForTimeout(250);
 // statistiques
 await tab(p,'stats');
 const st=await g(p,'stats-bloc').innerText();
 ok('statistiques : par bien, impayés, biens loués et libres',/Loyers facturés par bien/.test(st)&&/impayés par locataire/.test(st)&&/Biens loués et libres/.test(st),st.slice(0,200));
 // fin de bail et restitution du dépôt
 await tab(p,'baux');
 await g(p,'im-bail-filtre-etat').selectOption('actif');await p.waitForTimeout(250);
 if((await g(p,'im-bail-detail').count())===0){await p.locator('[data-testid="im-bail-ligne"]:has-text("Studio 5") [data-testid="im-bail-ouvrir"]').click();await p.waitForTimeout(350);}
 ok('restitution impossible avant la fin du bail',(await g(p,'im-depot-rendu').count())===0);
 await g(p,'im-bail-terminer').click();await p.waitForTimeout(500);
 await g(p,'im-bail-filtre-etat').selectOption('');await p.waitForTimeout(250);
 if((await g(p,'im-bail-detail').count())===0){await p.locator('[data-testid="im-bail-ligne"]:has-text("Studio 5") [data-testid="im-bail-ouvrir"]').click();await p.waitForTimeout(300);}
 await g(p,'im-depot-rendu').fill('4000');await g(p,'im-depot-rendre').click();await p.waitForTimeout(600);
 e=await cat(p,'entries');ti=e.filter(x=>x.kind==='immo');
 ok('restitution : 165 soldé, caisse -4 000, retenue 1 000 en 708',Math.abs(sum(ti,'165'))<.01&&Math.abs(sum(ti,'708')+2000)<.01&&Math.abs(sum(ti,'530')-10000)<.01,[sum(ti,'165'),sum(ti,'708'),sum(ti,'530')]);
 ok('dépôt indiqué « Restitué » avec retenue',/Restitué/.test(await t('im-depot-etat'))&&/retenue/.test(await t('im-depot-etat')),await t('im-depot-etat'));
 await tab(p,'biens');
 ok('Studio de nouveau libre',(await p.locator('[data-testid="im-bien-ligne"]:has-text("Studio 5"):has-text("Libre")').count())===1);
 // annulations
 await tab(p,'loyers');
 await g(p,'im-loy-filtre-etat').selectOption('soldee');await p.waitForTimeout(250);
 if((await g(p,'im-loy-detail').count())===0){await g(p,'im-loy-ouvrir').first().click();await p.waitForTimeout(350);}
 await g(p,'im-loy-annuler').click();await p.waitForTimeout(400);
 ok('loyer encaissé : annulation refusée',(await g(p,'im-loy-ligne').count())===1);
 while((await g(p,'im-pay-annuler').count())>0){await g(p,'im-pay-annuler').first().click();await p.waitForTimeout(450);}
 await g(p,'im-loy-annuler').click();await p.waitForTimeout(600);
 await g(p,'im-loy-filtre-etat').selectOption('');await p.waitForTimeout(250);
 e=await cat(p,'entries');ti=e.filter(x=>x.kind==='immo');
 ok('annulation : 411 ne garde que les loyers du studio et le loyer isolé (11 000)',Math.abs(sum(ti,'411')-11000)<.01,sum(ti,'411'));
 ok('loyer réémettable après annulation',(await t('im-gen-nb')).trim()==='1',await t('im-gen-nb'));
 // petit écran
 await p.setViewportSize({width:390,height:800});
 for(const id of ['apercu','biens','locataires','baux','loyers','depenses','rapports']){await tab(p,id);const w=await p.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);ok('390 px sans débordement : '+id,w<=2,w);}
 ok('aucune erreur JS',errs.length===0,errs);await p.close();}
// tous les biens loués : liste grisée et message explicatif
{const tous=data.map(x=>x.id==='p3'?x:x);const occ=data.concat([{type:'lease',id:'b3',number:'BA-'+an+'-0003',propertyId:'p3',tenantId:'t2',start:jours(-5),end:'',rent:5000,charges:0,dueDay:5,deposit:0,depositStatus:'',status:'actif'}]);
 const {p}=await boot(b,{settings:{companyName:'Immo Test',currency:'HTG'},primary:true,cats:{immo:occ},pageInit:mk('Administrateur')});await p.waitForTimeout(1200);
 await tab(p,'baux');
 const dis=await p.locator('[data-testid="im-bail-bien"] option').evaluateAll(e=>e.map(x=>x.disabled));
 ok('tous loués : options grisées et message explicatif',dis.slice(1).every(Boolean)&&(await g(p,'im-bail-aucun-libre').count())===1&&/Mettre fin/.test(await g(p,'im-bail-aucun-libre').innerText()),dis);await p.close();}
// accueil (Vendeur)
{const {p}=await boot(b,{settings:{companyName:'Immo Test',currency:'HTG'},primary:true,cats:{immo:data},pageInit:mk('Vendeur')});await p.waitForTimeout(1200);
 const tabs=await p.locator('[data-testid^="im-tab-"]').evaluateAll(e=>e.map(x=>x.innerText));
 ok('accueil : 3 onglets (pas de biens, baux, dépenses, rapports)',tabs.length===3&&!tabs.includes('Baux')&&!tabs.includes('Biens'),tabs);
 await tab(p,'loyers');
 ok('accueil : peut émettre les loyers, pas de case taxe',(await g(p,'im-emettre-bloc').count())===1&&(await g(p,'im-tca').count())===0);
 await tab(p,'locataires');
 ok('accueil : peut ajouter un locataire',(await g(p,'im-loc-nom').count())===1);await p.close();}
// lecture seule
{const {p}=await boot(b,{settings:{companyName:'Immo Test',currency:'HTG'},primary:true,cats:{immo:data},pageInit:mk('Lecteur')});await p.waitForTimeout(1200);
 await tab(p,'loyers');
 ok('lecture seule : pas d\'émission, avis imprimable',(await g(p,'im-emettre-bloc').count())===0&&(await g(p,'im-loy-imprimer').count())>0);await p.close();}
await b.close();console.log(fails?('ÉCHEC : '+fails):'OK');process.exit(fails?1:0)})();

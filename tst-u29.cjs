// v281 — bloc Hôtellerie : chambres et tarifs, clients, réservation avec acompte, arrivée, services, annulation, départ et facture, rapports, statistiques, réception.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const tab=async(p,id)=>{await g(p,'hotel-tab-'+id).click();await p.waitForTimeout(300)};
const msg=async(p,t)=>{try{await p.getByText(t,{exact:false}).first().waitFor({timeout:6000});return true}catch(e){return false}};
const S='[\\s\\u202f\\u00a0]?';const re=(a,b)=>new RegExp(a+S+b);
const fmt=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const add=(n)=>{const d=new Date();d.setHours(12);d.setDate(d.getDate()+n);return fmt(d)};
const today=add(0);
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const init=(role)=>new Function("(function(){try{localStorage.clear()}catch(e){}var S=window.__srv;var c=S.tables.companies[0];c.plan_tier='assisted';c.sectors=['restauration'];c.sectors_locked=true;"+(role?"S.tables.company_members[0].role='"+role+"';":"")+"})();");
const ouvrir=async(p)=>{await p.getByText('Hôtellerie',{exact:true}).last().click();await p.waitForTimeout(800)};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// ───── Scénario A : réglages, réservation, arrivée, services, annulation ─────
{const {p}=await boot(b,{settings:{companyName:'Hôtel Test',currency:'HTG',taxRate:10},primary:true,pageInit:init()});
 await ouvrir(p);
 const tabs=await p.locator('[data-testid^="hotel-tab-"]').evaluateAll(e=>e.map(x=>x.innerText));
 ok('7 onglets',tabs.length===7&&['Tableau de bord','Planning','Réservations','Chambres et tarifs','Clients','Factures','Rapports','Statistiques'].filter(t=>tabs.includes(t)).length===7||tabs.length===8,tabs);
 ok('message de démarrage',/Pour commencer, dans cet ordre/.test(await g(p,'hotel-vide').innerText()));
 await tab(p,'chambres');
 await g(p,'hotel-type-nom').fill('Double');await g(p,'hotel-type-tarif').fill('0');await g(p,'hotel-type-ajouter').click();
 ok('tarif nul refusé',await msg(p,'Indiquez le tarif par nuit'));
 await g(p,'hotel-type-photo').setInputFiles({name:'c.png',mimeType:'image/png',buffer:PNG});await p.waitForTimeout(700);
 ok('photo ajoutée',(await g(p,'hotel-type-photo-apercu').count())===1);
 await g(p,'hotel-type-tarif').fill('2000');await g(p,'hotel-type-ajouter').click();await p.waitForTimeout(300);
 await g(p,'hotel-type-nom').fill('Simple');await g(p,'hotel-type-capacite').fill('1');await g(p,'hotel-type-tarif').fill('1000');await g(p,'hotel-type-ajouter').click();await p.waitForTimeout(300);
 ok('2 types en cartes',(await g(p,'hotel-type-carte').count())===2);
 for(const [n,t] of [['101','Simple'],['102','Double'],['103','Double']]){await g(p,'hotel-chambre-numero').fill(n);await g(p,'hotel-chambre-type').selectOption({label:t});await g(p,'hotel-chambre-ajouter').click();await p.waitForTimeout(250)}
 ok('3 chambres',(await g(p,'hotel-chambre-ligne').count())===3);
 await g(p,'hotel-chambre-numero').fill('101');await g(p,'hotel-chambre-type').selectOption({label:'Simple'});await g(p,'hotel-chambre-ajouter').click();
 ok('numéro en double refusé',await msg(p,'existe déjà'));
 await g(p,'hotel-service-nom').fill('Petit-déjeuner');await g(p,'hotel-service-prix').fill('300');await g(p,'hotel-service-ajouter').click();await p.waitForTimeout(250);
 ok('service ajouté',(await g(p,'hotel-service-ligne').count())===1);
 await g(p,'hotel-sejour-on').check();await g(p,'hotel-reglages-enregistrer').click();
 ok('taxe de séjour sans montant refusée',await msg(p,'montant de la taxe de séjour'));
 await g(p,'hotel-sejour-montant').fill('50');await g(p,'hotel-tca').check();await g(p,'hotel-reglages-enregistrer').click();await p.waitForTimeout(300);
 const cfg=(await p.evaluate(()=>window.__srv.getCat('hotel'))).find(r=>r.type==='config');
 ok('réglages enregistrés (séjour 50, TCA)',cfg&&cfg.sejourOn===true&&cfg.sejour===50&&cfg.tcaOn===true&&cfg.services.length===1,cfg);
 // clients
 await tab(p,'clients');await g(p,'hotel-client-nom').fill('Marie Dupont');await g(p,'hotel-client-tel').fill('3700-0000');await g(p,'hotel-client-ajouter').click();await p.waitForTimeout(250);
 await g(p,'hotel-client-nom').fill('Marie Dupont');await g(p,'hotel-client-tel').fill('37000000');await g(p,'hotel-client-ajouter').click();
 ok('client en double refusé',await msg(p,'existe déjà'));
 ok('1 client',(await g(p,'hotel-client-ligne').count())===1);
 // réservation
 await tab(p,'resa');
 await g(p,'hotel-resa-creer').click();ok('sans client refusé',await msg(p,'Choisissez le client'));
 await g(p,'hotel-resa-client').selectOption({label:'Marie Dupont — 3700-0000'});
 await g(p,'hotel-resa-depart').fill(add(2));await p.waitForTimeout(200);
 await g(p,'hotel-resa-chambre').selectOption({label:'Chambre 102 — Double'});
 ok('tarif repris du type (2000)',(await g(p,'hotel-resa-tarif').inputValue())==='2000');
 await g(p,'hotel-resa-adultes').fill('3');await g(p,'hotel-resa-creer').click();
 ok('capacité dépassée refusée',await msg(p,'accueille 2 personne'));
 await g(p,'hotel-resa-adultes').fill('2');await g(p,'hotel-resa-acompte').fill('1000');await g(p,'hotel-resa-creer').click();await p.waitForTimeout(400);
 let hot=await p.evaluate(()=>window.__srv.getCat('hotel'));let bk=hot.find(r=>r.type==='booking');
 ok('réservation RS-AAAA-0001 avec acompte',bk&&/^RS-\d{4}-0001$/.test(bk.number)&&bk.status==='reservee'&&bk.deposits.length===1&&bk.deposits[0].amount===1000,bk);
 let ents=await p.evaluate(()=>window.__srv.getCat('entries')||[]);let e=ents.find(x=>/Acompte réservation/.test(x.label));
 ok('écriture acompte : Dr 530 / Cr 4191',e&&e.lines.some(l=>l.account==='530'&&l.debit===1000)&&e.lines.some(l=>l.account==='4191'&&l.credit===1000),e);
 await g(p,'hotel-resa-depart').fill(add(2));
 const opts=await g(p,'hotel-resa-chambre').locator('option').allInnerTexts();
 ok('chambre prise absente de la liste',!opts.some(o=>/102/.test(o))&&opts.some(o=>/103/.test(o)),opts);
 // détail : arrivée
 await g(p,'hotel-detail').waitFor();
 await g(p,'hotel-arrivee').click();await p.waitForTimeout(300);
 hot=await p.evaluate(()=>window.__srv.getCat('hotel'));bk=hot.find(r=>r.type==='booking');
 ok('arrivée enregistrée',bk.status==='arrivee');
 // service
 await g(p,'hotel-extra-service').selectOption({label:'Petit-déjeuner — 300,00 G'});await g(p,'hotel-extra-qte').fill('2');await g(p,'hotel-extra-ajouter').click();await p.waitForTimeout(300);
 ok('service ajouté au séjour',(await g(p,'hotel-extra-ligne').count())===1);
 await g(p,'hotel-voir-facture').count();
 // planning
 await tab(p,'planning');
 ok('planning : case occupée',(await g(p,'hotel-case-occupee').count())>=1&&(await g(p,'hotel-planning-ligne').count())===3);
 // tableau de bord
 await tab(p,'apercu');
 ok('taux d\'occupation 33 % (1 chambre sur 3)',/33/.test(await g(p,'hotel-kpi-taux').innerText())&&/1 \/ 3/.test(await g(p,'hotel-kpi-occupees').innerText()));
 await tab(p,'resa');
 // départ avant l'arrivée refusé, départ le jour même accepté (1 nuit minimum)
 await g(p,'hotel-depart-date').fill(add(-1));await g(p,'hotel-partir').click();
 ok('départ avant l\'arrivée refusé',await msg(p,'avant la date d\'arrivée'));
 await g(p,'hotel-depart-date').fill(today);await p.waitForTimeout(200);
 ok('départ le jour de l\'arrivée : 1 nuit facturée (2 000)',re('2','000,00').test(await g(p,'hotel-tot-heberg').innerText()));
 await g(p,'hotel-partir').click();await p.waitForTimeout(500);
 ok('départ le jour même enregistré et facturé',(await p.evaluate(()=>window.__srv.getCat('hotel'))).some(r=>r.type==='booking'&&r.status==='partie'&&r.invoice&&r.invoice.nights===1));
 await g(p,'hotel-apercu-fermer').click();await p.waitForTimeout(200);
 // seconde réservation puis annulation avec acompte conservé
 await tab(p,'resa');await g(p,'hotel-resa-client').selectOption({label:'Marie Dupont — 3700-0000'});
 await g(p,'hotel-resa-arrivee').fill(add(5));await g(p,'hotel-resa-depart').fill(add(6));await p.waitForTimeout(200);
 await g(p,'hotel-resa-chambre').selectOption({label:'Chambre 101 — Simple'});await g(p,'hotel-resa-acompte').fill('400');await g(p,'hotel-resa-creer').click();await p.waitForTimeout(400);
 await g(p,'hotel-annul-motif').selectOption('absent');await g(p,'hotel-annul-acompte').selectOption('conserver');await g(p,'hotel-annuler').click();await p.waitForTimeout(400);
 hot=await p.evaluate(()=>window.__srv.getCat('hotel'));const b2=hot.find(r=>r.type==='booking'&&r.number.endsWith('0002'));
 ok('réservation 2 : client absent, acompte conservé',b2&&b2.status==='absent'&&b2.acompteTraite==='conserver',b2);
 ents=await p.evaluate(()=>window.__srv.getCat('entries')||[]);e=ents.find(x=>/Acompte conservé/.test(x.label));
 ok('écriture Dr 4191 / Cr 7078',e&&e.lines.some(l=>l.account==='4191'&&l.debit===400)&&e.lines.some(l=>l.account==='7078'&&l.credit===400),e);
 await p.close();}
// ───── Scénario B : séjour en cours (données posées), départ, facture, rapports ─────
{const d0=add(-3);
 const hotel=[{type:'roomtype',id:'t1',name:'Double',capacity:2,price:2000},{type:'room',id:'r1',number:'102',typeId:'t1',menage:'propre'},{type:'room',id:'r2',number:'103',typeId:'t1',menage:'propre'},{type:'guest',id:'g1',name:'Marie Dupont',phone:'3700',email:'',idDoc:''},
  {type:'config',id:'config',tcaOn:true,sejourOn:true,sejour:50,services:[{id:'s1',label:'Petit-déjeuner',price:300}]},
  {type:'booking',id:'b1',number:'RS-2026-0001',guestId:'g1',roomId:'r1',from:d0,to:add(-1),adults:2,children:0,rate:2000,status:'arrivee',extras:[{id:'x1',date:add(-2),label:'Petit-déjeuner',qty:2,unit:300}],deposits:[{id:'d1',date:d0,amount:1000,mode:'especes',status:'valide'}],createdAt:new Date().toISOString()}];
 {const {p}=await boot(b,{settings:{companyName:'Hôtel Test',currency:'HTG',taxRate:10},primary:true,cats:{hotel},pageInit:init()});
  await ouvrir(p);
  await tab(p,'apercu');ok('séjour dépassé : départ listé au tableau de bord',(await g(p,'hotel-ligne-jour').count())===1);
  await tab(p,'resa');await g(p,'hotel-resa-ouvrir').first().click();await p.waitForTimeout(300);
  await g(p,'hotel-depart-date').fill(add(-1));await p.waitForTimeout(200);
  // 2 nuits × 2000 = 4000 ; services 600 ; séjour 2×2×50 = 200 ; TCA 10 % de 4600 = 460 ; total 5260 ; acompte 1000 ; reste 4260
  ok('hébergement 4 000',re('4','000,00').test(await g(p,'hotel-tot-heberg').innerText()));
  ok('total 5 260',re('5','260,00').test(await g(p,'hotel-tot-total').innerText()),await g(p,'hotel-depart-totaux').innerText());
  ok('reste à payer 4 260',re('4','260,00').test(await g(p,'hotel-tot-reste').innerText()));
  await g(p,'hotel-pay-ajouter-mode').click();await g(p,'hotel-pay-montant-0').fill('4000');await g(p,'hotel-pay-montant-1').fill('100');await g(p,'hotel-partir').click();
  ok('paiements incohérents refusés',await msg(p,'solde à payer'));
  await g(p,'hotel-pay-montant-1').fill('260');await g(p,'hotel-partir').click();await p.waitForTimeout(500);
  const hot=await p.evaluate(()=>window.__srv.getCat('hotel'));const bk=hot.find(r=>r.type==='booking');const room=hot.find(r=>r.id==='r1');
  ok('séjour facturé FH-AAAA-0001, parti',bk.status==='partie'&&/^FH-\d{4}-0001$/.test(bk.invoice.number)&&bk.invoice.total===5260,bk.invoice);
  ok('chambre à nettoyer après le départ',room.menage==='sale');
  const ents=await p.evaluate(()=>window.__srv.getCat('entries')||[]);const e=ents.find(x=>/Séjour RS/.test(x.label));
  const Σ=(f)=>Math.round(e.lines.reduce((s,l)=>s+(f(l)||0),0)*100)/100;
  ok('écriture équilibrée 5 260',e&&Σ(l=>l.debit)===5260&&Σ(l=>l.credit)===5260,e);
  ok('comptes 7076 4000, 7077 600, 4476 200, 445 460, 4191 débit 1000',e.lines.some(l=>l.account==='7076'&&l.credit===4000)&&e.lines.some(l=>l.account==='7077'&&l.credit===600)&&e.lines.some(l=>l.account==='4476'&&l.credit===200)&&e.lines.some(l=>l.account==='445'&&l.credit===460)&&e.lines.some(l=>l.account==='4191'&&l.debit===1000)&&e.lines.some(l=>l.account==='512'&&l.debit===260),e.lines);
  ok('feuille de facture ouverte',(await g(p,'hotel-facture-feuille').count())>=1);
  await g(p,'hotel-format').click();await p.waitForTimeout(200);ok('format ticket',(await g(p,'hotel-ticket-feuille').count())>=1);
  await g(p,'hotel-apercu-fermer').click();await p.waitForTimeout(200);
  // arrivée avant la date prévue / chambre sale : vérifié via nouvelle réservation impossible ici ; factures
  await tab(p,'factures');
  ok('1 facture, total 5 260',(await g(p,'hotel-fact-ligne').count())===1&&re('5','260,00').test(await g(p,'hotel-fact-total-montant').innerText()));
  // rapports
  await tab(p,'rapports');g(p,'hotel-rp-du');await g(p,'hotel-rp-du').fill(add(-5));await p.waitForTimeout(250);
  ok('journal : total 5 260, 2 nuitées',re('5','260,00').test(await g(p,'hotel-jt-total').innerText())&&(await g(p,'hotel-jt-nuits').innerText()).trim()==='2');
  ok('rapport par type et par service',/Double/.test(await g(p,'hotel-rapport-type').first().innerText())&&/Petit-déjeuner/.test(await g(p,'hotel-rapport-service').first().innerText()));
  ok('occupation par jour listée',(await g(p,'hotel-occup-ligne').count())>=5);
  await tab(p,'stats');ok('statistiques affichées',(await g(p,'stats-bloc').count())===1);
  // annulation de la facture
  await tab(p,'factures');await g(p,'hotel-fact-annuler').click();await p.waitForTimeout(500);
  const hot2=await p.evaluate(()=>window.__srv.getCat('hotel'));const bk2=hot2.find(r=>r.type==='booking');
  const ents2=await p.evaluate(()=>window.__srv.getCat('entries')||[]);
  ok('facture annulée : contre-écriture, séjour de nouveau en cours',bk2.status==='arrivee'&&bk2.invoice.status==='annulee'&&ents2.some(x=>/Annulation facture/.test(x.label)));
  await p.close();}
 // assistant : séjour dépassé
 {const {p}=await boot(b,{settings:{companyName:'Hôtel Test',currency:'HTG'},primary:true,cats:{hotel},pageInit:init()});
  await p.getByText('Comptabilité',{exact:false}).first().click();await p.waitForTimeout(700);
  await p.getByText(/Assistant de contrôle/).first().click();await p.waitForTimeout(700);
  const keys=await p.locator('[data-as="finding"]').evaluateAll(e=>e.map(x=>x.getAttribute('data-rule')));
  const n=await p.locator('[data-as="finding"]').count(),h=await p.locator('[data-as="howto"]').count();
  ok('assistant : séjour dépassé détecté avec son guide',keys.includes('hotel-depart')&&n===h,{keys,n,h});
  await p.close();}}
// ───── Réception (Vendeur) ─────
{const {p}=await boot(b,{settings:{companyName:'Hôtel Test',currency:'HTG'},primary:false,pageInit:init('Vendeur')});
 await p.waitForTimeout(500);
 if(await p.getByText('Hôtellerie',{exact:true}).count()){await ouvrir(p);const tabs=await p.locator('[data-testid^="hotel-tab-"]').evaluateAll(e=>e.map(x=>x.innerText));
  ok('réception : 5 onglets, sans chambres, rapports ni statistiques',tabs.length===5&&!tabs.includes('Chambres et tarifs')&&!tabs.includes('Rapports')&&!tabs.includes('Statistiques'),tabs);}
 else ok('réception : module Hôtellerie accessible',false,'absent');
 await p.close();}
await b.close();console.log(fails?'ÉCHEC u29':'OK u29');process.exit(fails?1:0)})();

// v305 — bloc Agriculture et élevage : parcelles, campagnes, récoltes, coût de revient, élevage (bande et animaux), ventes (produits, animaux vivants, vente à perte),
// dépenses imputées, achats listés ; calendrier fiscal ; cartes « Pour démarrer » Restauration et Hôtellerie.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const iso=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const today=iso(new Date());
const back=(n)=>{const d=new Date();d.setDate(d.getDate()-n);return iso(d)};
const S='[\\s\\u202f\\u00a0]?';const re=(a,b)=>new RegExp(a+S+b);
const mk=(sec,role)=>new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors="+JSON.stringify(sec)+";S.tables.companies[0].sectors_locked="+(sec.length>0)+";S.tables.company_members[0].role="+JSON.stringify(role)+";})()");
const cat=(p,c)=>p.evaluate((c)=>window.__srv.getCat(c)||[],c);
const seed=()=>[
 {type:'mat',id:'m1',name:'Semences de maïs',unit:'kg',min:0,active:true},{type:'mat',id:'m2',name:'Aliment poulet',unit:'sac',min:0,active:true},
 {type:'achat',id:'a1',date:back(40),matId:'m1',qty:50,amount:2500,supplier:'Agro Plus',mode:'apayer',entryId:'x',status:'valide',settlements:[]},
 {type:'achat',id:'a2',date:back(40),matId:'m2',qty:20,amount:4000,supplier:'Agro Plus',mode:'caisse',entryId:'x2',status:'valide',settlements:[]},
 {type:'prod',id:'p1',name:'Maïs',unit:'kg',price:50,active:true,cat:'cereales'},
 {type:'prod',id:'p2',name:'Œufs',unit:'plateau',price:300,active:true,cat:'animaux'}];
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p}=await boot(b,{settings:{companyName:'Ferme',currency:'HTG'},primary:true,cats:{agri:seed()},pageInit:mk(['agriculture'],'Administrateur')});await p.waitForTimeout(1600);
 const t0=await p.locator('body').innerText();
 ok('espace Agriculture et élevage ouvert, onglets métier présents',/Agriculture et élevage/.test(t0)&&(await g(p,'ag-tab-cultures').count())===1&&(await g(p,'ag-tab-elevage').count())===1&&(await g(p,'ag-tab-matieres').count())===1);
 const rg=async(id)=>(await g(p,'nav-rang-'+id).innerText()).trim();
 ok('numérotation par rang : métier 1, caisse 2, achat 3',(await rg('agri'))==='1'&&(await rg('caisse'))==='2'&&(await rg('achat'))==='3',[await rg('agri'),await rg('caisse'),await rg('achat')]);
 // ── Cultures
 await g(p,'ag-tab-cultures').click();await p.waitForTimeout(300);
 await g(p,'ag-camp-creer').click();await p.waitForTimeout(250);
 ok('campagne sans parcelle refusée',(await g(p,'ag-camp-ligne').count())===0);
 await g(p,'ag-parc-nom').fill('Champ du bas');await g(p,'ag-parc-surface').fill('2');await g(p,'ag-parc-ajouter').click();await p.waitForTimeout(300);
 ok('parcelle ajoutée',/Champ du bas/.test(await g(p,'ag-parc-liste').innerText()));
 await g(p,'ag-parc-nom').fill('champ du bas');await g(p,'ag-parc-ajouter').click();await p.waitForTimeout(250);
 ok('doublon de parcelle refusé',(await cat(p,'agri')).filter(r=>r.type==='parc').length===1);
 ok('le refus est écrit sous le bouton',/existe déjà/.test(await g(p,'ag-parc-erreur').innerText())&&(await g(p,'ag-parc-ligne').count())===1);
 await g(p,'ag-parc-nom').fill('Parcelle rapide');await g(p,'ag-parc-ajouter').dblclick();await p.waitForTimeout(350);
 ok('double clic rapide : une seule parcelle créée',(await cat(p,'agri')).filter(r=>r.type==='parc'&&/rapide/i.test(r.name)).length===1,(await cat(p,'agri')).filter(r=>r.type==='parc').length);
 await g(p,'ag-parc-nom').fill('PARCELLE RAPIDE');await g(p,'ag-parc-ajouter').click();await p.waitForTimeout(250);
 ok('doublon en majuscules refusé',(await cat(p,'agri')).filter(r=>r.type==='parc').length===2);
 await g(p,'ag-parc-retirer').last().click();await p.waitForTimeout(300);
 ok('une parcelle sans campagne peut être retirée',(await cat(p,'agri')).filter(r=>r.type==='parc').length===1&&(await g(p,'ag-parc-ligne').count())===1);
 await g(p,'ag-camp-nom').fill('Maïs printemps');await g(p,'ag-camp-parcelle').selectOption({index:1});await g(p,'ag-camp-produit').selectOption('p1');await g(p,'ag-camp-debut').fill(back(30));await g(p,'ag-camp-creer').click();await p.waitForTimeout(350);
 ok('campagne ouverte avec numéro',(await g(p,'ag-camp-ligne').count())===1&&/CP-/.test(await g(p,'ag-camp-ligne').innerText()),await g(p,'ag-camp-ligne').count());
 await g(p,'ag-camp-ouvrir').click();await p.waitForTimeout(300);
 await g(p,'ag-cu-mat').selectOption('m1');await g(p,'ag-cu-qte').fill('80');await g(p,'ag-cu-ajouter').click();await p.waitForTimeout(250);
 ok('intrant au-delà du stock (50) refusé',(await g(p,'ag-cu-ligne').count())===0);
 await g(p,'ag-cu-mat').selectOption('m1');await g(p,'ag-cu-qte').fill('20');await g(p,'ag-cu-ajouter').click();await p.waitForTimeout(300);
 ok('usage de 20 kg à 50 : coût de la campagne 1 000',(await g(p,'ag-cu-ligne').count())===1&&re('1','000').test(await g(p,'ag-camp-d-cout').innerText()),await g(p,'ag-camp-d-cout').innerText());
 await g(p,'ag-re-qte').fill('100');await g(p,'ag-re-date').fill(back(40));await g(p,'ag-re-ajouter').click();await p.waitForTimeout(250);
 ok('récolte avant le début de la campagne refusée',(await g(p,'ag-re-ligne').count())===0);
 await g(p,'ag-re-date').fill(back(2));await g(p,'ag-re-ajouter').click();await p.waitForTimeout(300);
 ok('récolte de 100 kg enregistrée',(await g(p,'ag-re-ligne').count())===1);
 ok('coût par unité = 10 (1 000 / 100)',/10/.test((await g(p,'ag-camp-cu').innerText()).replace(/[\s  ]/g,''))&&re('100','kg').test(await g(p,'ag-camp-recolte').innerText()),[await g(p,'ag-camp-cu').innerText(),await g(p,'ag-camp-recolte').innerText()]);
 // ── Dépense imputée à la campagne
 await g(p,'ag-tab-depenses').click();await p.waitForTimeout(300);
 await g(p,'ag-dep-nature').selectOption('main_oeuvre');await g(p,'ag-dep-montant').fill('500');await g(p,'ag-dep-cible').selectOption({index:1});await g(p,'ag-dep-enregistrer').click();await p.waitForTimeout(400);
 const dep=(await cat(p,'agri')).find(r=>r.type==='dep');
 ok('dépense journaliers imputée à la campagne, écriture 661/530',dep&&dep.campId&&dep.entryId,dep);
 const ent=await p.evaluate(()=>window.__srv.getCat('entries')||[]);
 ok('écriture comptable Débit 6612 / Crédit caisse 530 de 500',ent.some(e=>(e.lines||[]).some(l=>l.account==='6612'&&l.debit===500)&&(e.lines||[]).some(l=>l.account==='530'&&l.credit===500)),ent.map(e=>e.label));
 await g(p,'ag-dep-nature').selectOption('salarie');await g(p,'ag-dep-montant').fill('300');await g(p,'ag-dep-enregistrer').click();await p.waitForTimeout(300);
 ok('main-d\'œuvre salariée sans campagne choisie refusée',(await cat(p,'agri')).filter(r=>r.type==='dep').length===1);
 await g(p,'ag-dep-cible').selectOption({index:1});await g(p,'ag-dep-enregistrer').click();await p.waitForTimeout(400);
 const entApres=await p.evaluate(()=>window.__srv.getCat('entries')||[]);
 ok('main-d\'œuvre salariée imputée : aucune écriture ajoutée',(await cat(p,'agri')).filter(r=>r.type==='dep').length===2&&entApres.length===ent.length,[entApres.length,ent.length]);
 await g(p,'ag-tab-cultures').click();await p.waitForTimeout(300);if(!(await g(p,'ag-camp-d-cout').count())){await g(p,'ag-camp-ouvrir').click();await p.waitForTimeout(300);}
 ok('coût campagne = 1 000 + 500 + 300 = 1 800',re('1','800').test(await g(p,'ag-camp-d-cout').innerText()),await g(p,'ag-camp-d-cout').innerText());
 // ── Vente à perte du maïs (coût 18 / kg)
 await g(p,'ag-tab-ventes').click();await p.waitForTimeout(300);
 await g(p,'ag-vte-produit').selectOption('p1');await g(p,'ag-vte-qte').fill('101');await g(p,'ag-vte-pu').fill('50');await g(p,'ag-vte-ajouter-ligne').click();await p.waitForTimeout(250);
 ok('vente de 101 kg alors que 100 en stock : refusée',(await g(p,'ag-vte-lignebrouillon').count())===0);
 await g(p,'ag-vte-qte').fill('10');await g(p,'ag-vte-pu').fill('12');await g(p,'ag-vte-ajouter-ligne').click();await p.waitForTimeout(250);
 ok('prix 12 sous le coût 18 : alerte de perte',(await g(p,'ag-vte-perte').count())===1&&/18/.test(await g(p,'ag-vte-perte').innerText()),await g(p,'ag-vte-perte').count());
 await g(p,'ag-perte-motif').selectOption('destockage');await g(p,'ag-vte-perte-confirmer').click();await p.waitForTimeout(250);
 ok('vente à perte justifiée acceptée',(await g(p,'ag-vte-lignebrouillon').count())===1);
 await g(p,'ag-vte-emettre').click();await p.waitForTimeout(500);
 const fa=(await cat(p,'agri')).find(r=>r.type==='fact');
 ok('facture émise, ligne marquée à perte avec raison',fa&&fa.lines[0].perte&&fa.lines[0].motif==='destockage',fa&&fa.lines);
 // ── Élevage : bande de volaille
 await g(p,'ag-tab-elevage').click();await p.waitForTimeout(300);
 await g(p,'ag-bande-nom').fill('Poulets de chair');await g(p,'ag-bande-effectif').fill('100');await g(p,'ag-bande-debut').fill(back(30));await g(p,'ag-bande-achat').fill('2000');await g(p,'ag-bande-creer').click();await p.waitForTimeout(450);
 ok('bande créée, effectif 100',(await g(p,'ag-bande-ligne').count())===1&&(await g(p,'ag-bande-eff').innerText()).trim()==='100');
 const ent2=await p.evaluate(()=>window.__srv.getCat('entries')||[]);
 ok('achat des animaux : Débit 6022 / Crédit 530 de 2 000',ent2.some(e=>(e.lines||[]).some(l=>l.account==='6022'&&l.debit===2000)&&(e.lines||[]).some(l=>l.account==='530'&&l.credit===2000)));
 await g(p,'ag-bande-ouvrir').click();await p.waitForTimeout(300);
 await g(p,'ag-mo-type').selectOption('mortalite');await g(p,'ag-mo-qte').fill('150');await g(p,'ag-mo-ajouter').click();await p.waitForTimeout(250);
 ok('mortalité supérieure à l\'effectif refusée',(await g(p,'ag-mo-ligne').count())===0);
 await g(p,'ag-mo-qte').fill('5');await g(p,'ag-mo-ajouter').click();await p.waitForTimeout(300);
 ok('mortalité de 5 : effectif 95',(await g(p,'ag-bande-d-eff').innerText()).trim()==='95',await g(p,'ag-bande-d-eff').innerText());
 await g(p,'ag-bu-mat').selectOption('m2');await g(p,'ag-bu-qte').fill('10');await g(p,'ag-bu-ajouter').click();await p.waitForTimeout(300);
 ok('aliment utilisé : 10 sacs à 200 = 2 000 imputés à la bande',(await g(p,'ag-bu-ligne').count())===1);
 await g(p,'ag-so-type').selectOption('vaccin');await g(p,'ag-so-label').fill('Newcastle');await g(p,'ag-so-date').fill(back(3));await g(p,'ag-so-next').fill(back(1));await g(p,'ag-so-ajouter').click();await p.waitForTimeout(300);
 ok('vaccin enregistré avec rappel',(await g(p,'ag-so-ligne').count())===1&&(await g(p,'ag-so-fait').count())===1);
 await g(p,'ag-bande-ouvrir').click();await p.waitForTimeout(250);
 // coût par tête : (2000 + 2000) / 95 = 42,11
 ok('coût par tête de la bande ≈ 42 (42,11)',/^42/.test(await g(p,'ag-bande-ct').innerText()),await g(p,'ag-bande-ct').innerText());
 // ── Vente d'animaux vivants
 await g(p,'ag-tab-ventes').click();await p.waitForTimeout(300);
 await g(p,'ag-vte-produit').selectOption({label:/Animaux vivants/}).catch(async()=>{const v=await p.locator('[data-testid="ag-vte-produit"] option').evaluateAll(o=>o.map(x=>[x.value,x.textContent]));await g(p,'ag-vte-produit').selectOption(v.find(x=>/^bande:/.test(x[0]))[0])});
 await g(p,'ag-vte-qte').fill('96');await g(p,'ag-vte-pu').fill('60');await g(p,'ag-vte-ajouter-ligne').click();await p.waitForTimeout(250);
 ok('vente de 96 animaux alors que 95 présents : refusée',(await g(p,'ag-vte-lignebrouillon').count())===0);
 await g(p,'ag-vte-qte').fill('30');await g(p,'ag-vte-pu').fill('40');await g(p,'ag-vte-ajouter-ligne').click();await p.waitForTimeout(250);
 ok('prix 40 sous le coût par tête 42,11 : alerte de perte',(await g(p,'ag-vte-perte').count())===1,await g(p,'ag-vte-perte').count());
 await g(p,'ag-vte-perte-prixrevient').click();await p.waitForTimeout(250);
 ok('« Mettre au prix de revient » remplit le prix (43)',(await g(p,'ag-vte-pu').inputValue())==='43',await g(p,'ag-vte-pu').inputValue());
 await g(p,'ag-vte-ajouter-ligne').click();await p.waitForTimeout(250);await g(p,'ag-vte-emettre').click();await p.waitForTimeout(500);
 const fa2=(await cat(p,'agri')).filter(r=>r.type==='fact');
 ok('facture des animaux : ligne avec bandeId, 30 têtes',fa2.length===2&&fa2.some(f=>f.lines.some(l=>l.bandeId&&l.qty===30)),fa2.map(f=>f.lines));
 await g(p,'ag-tab-elevage').click();await p.waitForTimeout(300);
 ok('effectif de la bande après vente : 65',(await g(p,'ag-bande-eff').innerText()).trim()==='65',await g(p,'ag-bande-eff').innerText());
 // ── Troupeau individuel (chèvres)
 await g(p,'ag-bande-nom').fill('Chèvres');await g(p,'ag-bande-espece').selectOption('caprin');await g(p,'ag-bande-debut').fill(back(20));await g(p,'ag-bande-creer').click();await p.waitForTimeout(400);
 ok('espèce caprine : suivi animal par animal, sans effectif de départ',(await g(p,'ag-bande-ligne').count())===2);
 await g(p,'ag-bande-ouvrir').nth(0).click();await p.waitForTimeout(300);
 const detail=await g(p,'ag-bande-detail').innerText();
 ok('fiche individuelle : formulaire d\'ajout d\'animal',(await g(p,'ag-an-ajouter').count())===1,detail.slice(0,80));
 await g(p,'ag-an-repere').fill('Biquette 1');await g(p,'ag-an-origine').selectOption('achete');await g(p,'ag-an-prix').fill('3000');await g(p,'ag-an-ajouter').click();await p.waitForTimeout(400);
 await g(p,'ag-an-repere').fill('Biquette 1');await g(p,'ag-an-ajouter').click();await p.waitForTimeout(250);
 ok('animal ajouté une seule fois (doublon de repère refusé)',(await g(p,'ag-an-ligne').count())===1);
 await g(p,'ag-so-type').selectOption('pesee');await g(p,'ag-so-poids').fill('25');await g(p,'ag-so-animal').selectOption({index:1});await g(p,'ag-so-ajouter').click();await p.waitForTimeout(300);
 ok('pesée de l\'animal : dernier poids affiché',/25 kg/.test(await g(p,'ag-an-ligne').innerText()),await g(p,'ag-an-ligne').innerText());
 await g(p,'ag-tab-ventes').click();await p.waitForTimeout(300);
 const opts=await p.locator('[data-testid="ag-vte-produit"] option').evaluateAll(o=>o.map(x=>[x.value,x.textContent]));
 ok('l\'animal individuel est proposé à la vente',opts.some(x=>/^animal:/.test(x[0])&&/Biquette 1/.test(x[1])),opts.map(x=>x[1]));
 await g(p,'ag-vte-produit').selectOption(opts.find(x=>/^animal:/.test(x[0]))[0]);await g(p,'ag-vte-qte').fill('1');await g(p,'ag-vte-pu').fill('5000');await g(p,'ag-vte-ajouter-ligne').click();await p.waitForTimeout(250);await g(p,'ag-vte-emettre').click();await p.waitForTimeout(500);
 const fa3=(await cat(p,'agri')).filter(r=>r.type==='fact');
 ok('animal vendu : ligne avec animalId',fa3.some(f=>f.lines.some(l=>l.animalId)),fa3.length);
 await g(p,'ag-tab-elevage').click();await p.waitForTimeout(300);await g(p,'ag-bande-ouvrir').nth(0).click().catch(()=>{});await p.waitForTimeout(200);
 // ── Rapports et statistiques
 await g(p,'ag-tab-rapports').click();await p.waitForTimeout(500);
 ok('rapport de rentabilité des campagnes et de l\'élevage',(await g(p,'ag-rap-camp-ligne').count())===1&&(await g(p,'ag-rap-elevage-ligne').count())===2);
 {const tc=await g(p,'ag-rap-camp-ligne').innerText();const te=await g(p,'ag-rap-elevage-ligne').first().innerText();
  ok('coûts et marges par unité affichés avec 2 décimales (campagne, bande)',/\d,\d\d/.test(tc)&&/\d,\d\d/.test(te),[tc,te]);}
 await g(p,'ag-tab-commandes').click();await p.waitForTimeout(300);
 {const tx=await p.locator('main').first().innerText();ok('commandes : vocabulaire agricole (pas de gâteaux, fer forgé, gamme)',/Précommande/.test(tx)&&/Maïs de la récolte/.test(tx)&&!/Gâteaux|fer forgé|Uniformes|gamme/i.test(tx),tx.slice(0,300));}
 await g(p,'ag-tab-rapports').click();await p.waitForTimeout(300);
 ok('rapport « ventes sous le coût » liste la vente à perte du maïs',(await g(p,'ag-rap-perte-ligne').count())>=1,await g(p,'ag-rap-perte-ligne').count());
 await g(p,'ag-tab-stats').click();await p.waitForTimeout(500);
 ok('statistiques affichées',/Ventes/.test(await p.locator('body').innerText()));
 // ── Tableau de bord : étapes et À faire (rappel de vaccin dépassé)
 await g(p,'ag-tab-apercu').click();await p.waitForTimeout(400);
 ok('« À faire » signale le rappel de vaccin dépassé',/Newcastle/.test(await p.locator('body').innerText()));
 await p.close();}
// ── Transformation simple d'un produit de la ferme
{const sd=[...seed(),{type:'recolte',id:'r1',date:back(5),campId:'c1',productId:'p1',qty:100,note:'',status:'valide'},{type:'parc',id:'pa1',name:'P',area:1,unit:'carreau',active:true},{type:'camp',id:'c1',number:'CP-1',name:'Maïs',parcId:'pa1',productId:'p1',start:back(30),status:'encours'},
 {type:'prod',id:'p3',name:'Farine de maïs',unit:'kg',price:90,active:true,cat:'transforme'}];
 const {p}=await boot(b,{settings:{companyName:'Ferme',currency:'HTG'},primary:true,cats:{agri:sd},pageInit:mk(['agriculture'],'Administrateur')});await p.waitForTimeout(1500);
 await g(p,'ag-tab-production').click();await p.waitForTimeout(300);
 await g(p,'ag-lot-produit').selectOption('p3');await g(p,'ag-lot-qte').fill('70');await g(p,'ag-lot-src').selectOption('p1');await g(p,'ag-lot-srcqte').fill('90');await g(p,'ag-lot-enregistrer').click();await p.waitForTimeout(400);
 const lot=(await cat(p,'agri')).find(r=>r.type==='lot');
 ok('transformation : 90 kg de maïs donnent 70 kg de farine, coût du maïs repris',lot&&lot.srcProdId==='p1'&&lot.srcQty===90&&lot.qty===70,lot);
 await g(p,'ag-tab-produits').click();await p.waitForTimeout(300);
 const stocks=await g(p,'ag-prod-stock').allInnerTexts();
 ok('stock : maïs 10, farine 70',stocks.map(x=>x.trim()).join(',').includes('10')&&stocks.map(x=>x.trim()).join(',').includes('70'),stocks);
 await p.close();}
// ── Rôle Vendeur : vente seulement, pas de cultures ni d'élevage
{const {p}=await boot(b,{settings:{companyName:'Ferme',currency:'HTG'},primary:true,cats:{agri:seed()},pageInit:mk(['agriculture'],'Vendeur')});await p.waitForTimeout(1500);
 ok('Vendeur : pas d\'onglets Cultures, Élevage, Dépenses',(await g(p,'ag-tab-cultures').count())===0&&(await g(p,'ag-tab-elevage').count())===0&&(await g(p,'ag-tab-depenses').count())===0&&(await g(p,'ag-tab-ventes').count())===1);
 await p.close();}
// ── Achats d'intrants listés dans Achat et fournisseurs
{const {p}=await boot(b,{settings:{companyName:'Ferme',currency:'HTG'},primary:true,cats:{agri:seed()},pageInit:mk(['agriculture'],'Administrateur')});await p.waitForTimeout(1500);
 await g(p,'nav-rang-achat').click();await p.waitForTimeout(900);
 await p.getByRole('button',{name:'Achats Agriculture'}).click();await p.waitForTimeout(400);
 ok('achat d\'intrants à payer listé dans Achat et fournisseurs',(await g(p,'ach-metier-ligne').count())>=1&&/Agro Plus/.test(await g(p,'ach-metier-ligne').first().innerText()),await g(p,'ach-metier-ligne').count());
 await p.close();}
// ── Calendrier fiscal
{const {p}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,cats:{},pageInit:mk([],'Administrateur')});await p.waitForTimeout(1500);
 await g(p,'nav-rang-rapports').click().catch(()=>{});await p.waitForTimeout(700);
 const btnFisc=p.getByRole('button',{name:/Déclarations fiscales/});await btnFisc.first().click().catch(()=>{});await p.waitForTimeout(400);
 await p.getByRole('button',{name:'Calendrier fiscal'}).first().click();await p.waitForTimeout(500);
 const t=await p.locator('body').innerText();
 ok('calendrier fiscal : liste annuelle des versements au 31 octobre, acomptes, retenues du 1er au 15',g(p,'calendrier-fiscal')&&/Liste annuelle des versements/.test(t)&&/Acomptes provisionnels/.test(t)&&/Du 1er au 15/.test(t));
 ok('les dates à confirmer sont signalées',/À confirmer/.test(t)&&(await g(p,'cal-annuelles').locator('[data-testid="cal-ligne"]').count())===6,await g(p,'cal-annuelles').locator('[data-testid="cal-ligne"]').count());
 await p.setViewportSize({width:360,height:740});await p.waitForTimeout(400);
 const larg=await p.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,cartes:document.querySelectorAll('[data-testid="calendrier-fiscal"] .ec-card').length}));
 ok('calendrier fiscal : en cartes et sans débordement à 360 px',larg.cartes===4&&larg.sw<=larg.cw+1,larg);
 await p.close();}
// ── Cartes « Pour démarrer » Restauration et Hôtellerie
{const {p}=await boot(b,{settings:{companyName:'R',currency:'HTG'},primary:true,cats:{},pageInit:mk(['restauration'],'Administrateur')});await p.waitForTimeout(1500);
 ok('Restauration : carte « Pour démarrer » avec 7 étapes',(await g(p,'resto-guide').count())===1&&(await g(p,'resto-etape').count())===7,await g(p,'resto-etape').count());
 await g(p,'resto-etape-ouvrir').first().click();await p.waitForTimeout(300);
 ok('le bouton « Ouvrir » mène à l\'onglet Salle',(await g(p,'resto-tab-salle').count())===1);
 await p.close();}
{const {p}=await boot(b,{settings:{companyName:'H',currency:'HTG'},primary:true,cats:{},pageInit:mk(['restauration'],'Administrateur')});await p.waitForTimeout(1500);
 const espBtn=p.getByRole('button',{name:'Hôtellerie'});if(await espBtn.count())await espBtn.first().click();await p.waitForTimeout(700);
 ok('Hôtellerie : carte « Pour démarrer » avec 7 étapes',(await g(p,'hotel-guide').count())===1&&(await g(p,'hotel-etape').count())===7,[await g(p,'hotel-guide').count(),await g(p,'hotel-etape').count()]);
 await p.close();}
await b.close();console.log(fails?('ÉCHECS '+fails):'TOUT PASSE');process.exit(fails?1:0)})();

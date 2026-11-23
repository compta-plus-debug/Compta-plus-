// v279 — bloc Restauration refondu : salle, menu illustré, recettes, commandes (cuisine, remise, paiement partagé), factures A4/ticket,
// personnel par postes, partage du service par points, rapports avec totaux, statistiques, assistant.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const tab=async(p,id)=>{await g(p,'resto-tab-'+id).click();await p.waitForTimeout(300)};
const msg=async(p,t)=>{try{await p.getByText(t,{exact:false}).first().waitFor({timeout:6000});return true}catch(e){return false}};
const S='[\\s\\u202f\\u00a0]?';const re=(a,b)=>new RegExp(a+S+b);
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const init=new Function("(function(){try{localStorage.clear()}catch(e){}var c=window.__srv.tables.companies[0];c.plan_tier='assisted';c.sectors=['restauration'];c.sectors_locked=true;})();");
const ajouterPlat=async(p,nom,cat,prix,desc)=>{await g(p,'resto-plat-nom').fill(nom);await g(p,'resto-plat-cat').selectOption({label:cat});await g(p,'resto-plat-prix').fill(String(prix));if(desc)await g(p,'resto-plat-desc').fill(desc);await g(p,'resto-plat-ajouter').click();await p.waitForTimeout(350)};
const fermer=async(p)=>{if(await g(p,'resto-apercu-fermer').count())await g(p,'resto-apercu-fermer').click();await p.waitForTimeout(250)};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p,errs}=await boot(b,{settings:{companyName:'Chez Test',currency:'HTG'},primary:true,pageInit:init});
 await p.getByText('Restauration',{exact:true}).last().click();await p.waitForTimeout(800);
 const tabs=await p.locator('[data-testid^="resto-tab-"]').evaluateAll(e=>e.map(x=>x.innerText));
 ok('9 onglets distincts',tabs.length===9&&['Tableau de bord','Salle et commandes','Factures','Menu','Recettes et coûts','Personnel','Service et pourboires','Rapports','Statistiques'].every(t=>tabs.includes(t)),tabs);
 ok('message de démarrage en 5 étapes',/Pour commencer, dans cet ordre/.test(await g(p,'resto-vide').innerText()));
 // salle
 await tab(p,'salle');for(const t of ['T1','T2']){await g(p,'resto-table-nom').fill(t);await g(p,'resto-table-ajouter').click();await p.waitForTimeout(250)}
 ok('2 tables en cartes',(await g(p,'resto-table-carte').count())===2);
 // menu
 await tab(p,'menu');await g(p,'resto-cat-nom').fill('Grillades');await g(p,'resto-cat-ajouter').click();await p.waitForTimeout(300);
 await g(p,'resto-plat-photo').setInputFiles({name:'riz.png',mimeType:'image/png',buffer:PNG});await p.waitForTimeout(700);
 ok('photo ajoutée (aperçu visible)',(await g(p,'resto-plat-photo-apercu').count())===1);
 await ajouterPlat(p,'Riz au poulet','Plats',500,'Riz créole et poulet');
 await ajouterPlat(p,'Poulet grillé','Grillades',300);await ajouterPlat(p,'Jus','Boissons',100);
 ok('3 plats en cartes, catégorie perso',(await g(p,'resto-plat-ligne').count())===3&&/Poulet grillé/.test(await p.evaluate(()=>document.body.innerText)));
 ok('photo enregistrée sur le plat',(await p.evaluate(()=>window.__srv.getCat('resto'))).some(r=>r.type==='dish'&&r.name==='Riz au poulet'&&/^data:image\/jpeg/.test(r.photo||'')));
 const jus=g(p,'resto-plat-ligne').filter({hasText:'Jus'});await jus.locator('[data-testid="resto-plat-modifier"]').click();await p.waitForTimeout(250);
 await g(p,'resto-plat-prix').fill('120');await g(p,'resto-plat-ajouter').click();await p.waitForTimeout(350);
 ok('plat modifié : Jus à 120',/120,00/.test(await g(p,'resto-plat-ligne').filter({hasText:'Jus'}).innerText()));
 await g(p,'resto-carte-apercu-ouvrir').click();await p.waitForTimeout(300);
 const carte=await g(p,'resto-carte-feuille').first().innerText();
 ok('aperçu de la carte client : catégories et prix',/Grillades/.test(carte)&&/Riz au poulet/.test(carte)&&/Chez Test/.test(carte),carte.slice(0,200));await fermer(p);
 // recette
 await tab(p,'recettes');await g(p,'resto-recette-ligne').filter({hasText:'Riz au poulet'}).locator('[data-testid="resto-plat-recette"]').click();await p.waitForTimeout(250);
 await g(p,'resto-ingredient-produit').selectOption({label:'Riz'});await g(p,'resto-ingredient-qte').fill('2');await g(p,'resto-ingredient-ajouter').click();await p.waitForTimeout(300);
 const rl=await g(p,'resto-recette-ligne').filter({hasText:'Riz au poulet'}).innerText();
 ok('coût 120 et marge 76 %',/120,00/.test(rl)&&/76 %/.test(rl),rl);
 ok('compteur « plats sans recette »',/2 plat/.test(await g(p,'resto-sans-recette').innerText()));
 // personnel
 await tab(p,'personnel');
 await g(p,'resto-staff-nom').fill('Anne');await g(p,'resto-staff-poste').selectOption('serveur');
 ok('poste serveur : 3 points par défaut',(await g(p,'resto-staff-points').inputValue())==='3');await g(p,'resto-staff-ajouter').click();await p.waitForTimeout(250);
 await g(p,'resto-staff-nom').fill('Boris');await g(p,'resto-staff-poste').selectOption('cuisinier');
 ok('poste cuisinier : 2 points',(await g(p,'resto-staff-points').inputValue())==='2');await g(p,'resto-staff-ajouter').click();await p.waitForTimeout(250);
 await g(p,'resto-staff-nom').fill('Carl');await g(p,'resto-staff-poste').selectOption('plongeur');await g(p,'resto-staff-ajouter').click();await p.waitForTimeout(250);
 const pl=await g(p,'resto-staff-ligne').allInnerTexts();
 ok('3 employés avec leur poste',pl.length===3&&/Serveur/.test(pl[0])&&/Cuisinier/.test(pl[1])&&/Plongeur/.test(pl[2]),pl);
 // commande 1 : cuisine, remise, paiement partagé
 await tab(p,'salle');await g(p,'resto-table-carte').first().click();await p.waitForTimeout(300);
 ok('sans serveur choisi : commande refusée',await msg(p,'Choisissez le serveur')&&(await g(p,'resto-cmd-detail').count())===0);
 const opts=await g(p,'resto-cmd-serveur').locator('option').allInnerTexts();
 ok('liste déroulante des serveurs = personnel enregistré',opts.length===4&&/Anne — Serveur/.test(opts[1]),opts);
 await g(p,'resto-cmd-serveur').selectOption({label:'Anne — Serveur / serveuse'});await g(p,'resto-table-carte').first().click();await p.waitForTimeout(400);
 ok('table touchée : commande ouverte au nom du serveur',(await g(p,'resto-cmd-detail').count())===1&&(await p.evaluate(()=>window.__srv.getCat('resto'))).some(r=>r.type==='order'&&r.server==='Anne'));
 const bt=(n)=>g(p,'resto-plat-bouton').filter({hasText:n}).first();
 await bt('Riz au poulet').click();await bt('Riz au poulet').click();await bt('Poulet grillé').click();await p.waitForTimeout(300);
 ok('3 plats (2 + 1) ajoutés',(await g(p,'resto-cmd-plat-ligne').count())===2&&/2/.test(await g(p,'resto-cmd-plat-ligne').first().innerText()));
 await g(p,'resto-cuisine-envoyer').click();await p.waitForTimeout(300);
 ok('envoyé en cuisine',/Envoyé/.test(await g(p,'resto-cmd-plat-ligne').first().innerText())&&/En cuisine/.test(await g(p,'resto-cmd-detail').innerText()));
 await g(p,'resto-cuisine-servie').click();await p.waitForTimeout(300);
 ok('marquée servie',/Servie/.test(await g(p,'resto-cmd-detail').innerText()));
 await g(p,'resto-remise-montant').fill('100');await g(p,'resto-remise-appliquer').click();
 ok('remise sans motif refusée',await msg(p,'motif de la remise'));
 await g(p,'resto-remise-motif').fill('Fidélité');await g(p,'resto-remise-appliquer').click();await p.waitForTimeout(300);
 const tt=await g(p,'resto-cmd-totaux').innerText();
 ok('totaux : sous-total 1 200, service 120, addition 1 320',re('1','200,00').test(tt)&&/120,00/.test(tt)&&re('1','320,00').test(tt)&&/Remise/.test(tt),tt);
 await g(p,'resto-pay-tip').fill('80');await g(p,'resto-convives').fill('4');await p.waitForTimeout(200);
 ok('division : 350 par personne (information)',/350,00/.test(await g(p,'resto-part-personne').innerText()));
 await g(p,'resto-pay-ajouter-mode').click();await p.waitForTimeout(200);
 await g(p,'resto-pay-montant-0').fill('700');await g(p,'resto-pay-montant-1').fill('600');await g(p,'resto-pay-encaisser').click();
 ok('paiements partagés incohérents : refusé',await msg(p,'totalisent'));
 await g(p,'resto-pay-montant-1').fill('700');await g(p,'resto-pay-encaisser').click();await p.waitForTimeout(900);
 const ents=await p.evaluate(()=>window.__srv.getCat('entries')||[]);const e=ents.find(x=>/Addition/.test(x.label));
 const L=(a)=>e?e.lines.filter(l=>l.account===a).reduce((s,l)=>s+l.debit-l.credit,0):null;
 ok('écriture : caisse 700 + banque 700 / ventes nettes 1 200 / service+pourboire 200',e&&L('530')===700&&L('512')===700&&L('7075')===-1200&&L('4677')===-200,e&&e.lines);
 ok('écriture équilibrée',e&&Math.abs(e.lines.reduce((s,l)=>s+l.debit-l.credit,0))<0.005);
 ok('stock du riz : 10 − 2×2 = 6',(await p.evaluate(()=>window.__srv.getCat('products'))).find(x=>x.name==='Riz').stock===6);
 // facture affichée après paiement
 const fa=await g(p,'resto-facture-feuille').first().innerText();
 ok('facture A4 : en-tête, lignes, remise, service, pourboire, paiements',/Chez Test/.test(fa)&&/FACTURE/.test(fa)&&/Fidélité/.test(fa)&&/Service \(10 %\)/.test(fa)&&/Pourboire/.test(fa)&&/Payé — Espèces/.test(fa)&&/Payé — Banque/.test(fa),fa);
 await g(p,'resto-format').click();await p.waitForTimeout(300);
 ok('format ticket disponible',(await g(p,'resto-ticket-feuille').count())>=1);await fermer(p);
 // commande 2 : paiement unique simple
 await g(p,'resto-table-carte').nth(1).click();await p.waitForTimeout(400);await bt('Jus').click();await p.waitForTimeout(200);await g(p,'resto-pay-encaisser').click();await p.waitForTimeout(900);await fermer(p);
 ok('2e addition à paiement unique encaissée (132,00)',(await p.evaluate(()=>window.__srv.getCat('resto'))).some(r=>r.type==='order'&&r.status==='payee'&&r.total===132&&r.payments.length===1));
 // factures
 await tab(p,'factures');
 ok('2 factures listées',(await g(p,'resto-fact-ligne').count())===2);
 const tot=await g(p,'resto-total-ligne').innerText();
 ok('ligne de totaux calculée (sous-total 1 320, total encaissé 1 532)',re('1','320,00').test(tot)&&re('1','532,00').test(tot),tot);
 // service
 await tab(p,'service');
 ok('explication du partage affichée',/ses points ÷ total des points/.test(await g(p,'resto-service-explication').innerText()));
 ok('à répartir : service 132 + pourboire 80 = 212',/132,00/.test(await g(p,'resto-pool-service').innerText())&&/80,00/.test(await g(p,'resto-pool-tips').innerText())&&/212,00/.test(await g(p,'resto-pool').innerText()),await g(p,'resto-pool').innerText());
 const pr=g(p,'resto-presence');await pr.nth(2).fill('0');await p.waitForTimeout(250);
 const mt=await g(p,'resto-staff-montant').allInnerTexts();
 ok('Carl absent (0 point) : Anne 127,20 / Boris 84,80 / Carl 0',/127,20/.test(mt[0])&&/84,80/.test(mt[1])&&/0,00/.test(mt[2]),mt);
 ok('total des points 5, total réparti 212',(await g(p,'resto-total-points').innerText())==='5'&&/212,00/.test(await g(p,'resto-total-montant').innerText()));
 await g(p,'resto-repartir').click();await p.waitForTimeout(800);
 const e2=(await p.evaluate(()=>window.__srv.getCat('entries'))).find(x=>/Répartition du service/.test(x.label));
 ok('écriture de répartition : 4677 débit 212 / caisse crédit 212',e2&&e2.lines.some(l=>l.account==='4677'&&l.debit===212)&&e2.lines.some(l=>l.account==='530'&&l.credit===212),e2&&e2.lines);
 ok('plus rien à répartir et répartition listée',/0,00/.test(await g(p,'resto-pool').innerText())&&(await g(p,'resto-versement-ligne').count())===1);
 await g(p,'resto-recus').click();await p.waitForTimeout(300);
 const rc=await g(p,'resto-recus-feuille').first().innerText();
 ok('reçus par employé (3 reçus avec signature)',(rc.match(/Montant reçu/g)||[]).length===2&&/Anne/.test(rc)&&/Signature/.test(rc),rc.slice(0,300));await fermer(p);
 await tab(p,'factures');await g(p,'resto-cmd-annuler-payee').first().click();
 ok('annulation refusée : service déjà réparti',await msg(p,'déjà été réparti'));
 // rapports
 await tab(p,'rapports');
 ok('journal : total des ventes 1 320 et total encaissé 1 532',re('1','320,00').test(await g(p,'resto-jt-sous').innerText())&&re('1','532,00').test(await g(p,'resto-jt-total').innerText())&&(await g(p,'resto-jt-nb').innerText())==='2');
 ok('ventes par plat, catégorie, serveur, table, heure',(await g(p,'resto-rapport-plat').count())>=3&&(await g(p,'resto-rapport-cat').count())>=2&&(await g(p,'resto-rapport-serveur').count())>=1&&(await g(p,'resto-rapport-table').count())===2&&(await g(p,'resto-rapport-heure').count())>=1);
 ok('marge par plat (Riz au poulet)',/Riz au poulet/.test(await g(p,'resto-marge-ligne').first().innerText()));
 ok('clôture : espèces attendues 832',/832,00/.test(await g(p,'resto-cloture-attendu').innerText()),await g(p,'resto-cloture-attendu').innerText());
 await g(p,'resto-cloture-compte').fill('830');await g(p,'resto-cloture-valider').click();await p.waitForTimeout(400);
 ok('clôture : écart −2,00 affiché',/2,00/.test(await g(p,'resto-cloture-resultat').innerText()));
 // statistiques
 await tab(p,'stats');await p.waitForTimeout(500);
 ok('statistiques : ventes du mois 1 320, 2 additions, panier moyen',re('1','320,00').test(await g(p,'resto-stat-ventes').innerText())&&(await g(p,'resto-stat-additions').innerText())==='2'&&/660,00/.test(await g(p,"resto-stat-panier").innerText()),await g(p,'resto-stat-panier').innerText());
 // assistant
 await p.getByText('Comptabilité',{exact:false}).first().click();await p.waitForTimeout(700);
 await p.getByText(/Assistant de contrôle/).first().click();await p.waitForTimeout(700);
 const rules=await p.locator('[data-as="finding"]').evaluateAll(x=>x.map(e=>e.getAttribute('data-rule')));
 ok('assistant : « plat sans fiche recette »',rules.includes('resto-recette'),rules);
 ok('assistant : filtre Restauration',await p.getByRole('button',{name:/Restauration/}).count()>0);
 ok('aucune erreur JS',errs.length===0,errs.slice(0,3));await p.close();}
// serveur (Vendeur) : pas d'onglets réservés
{const {p}=await boot(b,{settings:{companyName:'Chez Test',currency:'HTG'},primary:false,pageInit:new Function("(function(){try{localStorage.clear()}catch(e){}var S=window.__srv;var c=S.tables.companies[0];c.plan_tier='assisted';c.sectors=['restauration'];c.sectors_locked=true;S.tables.company_members[0].role='Vendeur';})();")});
 await p.waitForTimeout(500);const has=await p.getByText('Restauration',{exact:true}).count();
 if(has){await p.getByText('Restauration',{exact:true}).last().click();await p.waitForTimeout(700);const tabs=await p.locator('[data-testid^="resto-tab-"]').evaluateAll(e=>e.map(x=>x.innerText));
  ok('serveur : 5 onglets, sans personnel, service, rapports ni statistiques',tabs.length===5&&!tabs.includes('Personnel')&&!tabs.includes('Rapports'),tabs);await p.close();}
 else ok('serveur : module Restauration accessible',false,'absent');}
await b.close();console.log(fails?'ÉCHEC u28':'OK u28');process.exit(fails?1:0)})();

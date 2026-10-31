// v301 — Industries artisanales : matières et achats, produits et recettes, lots avec coût de revient, commandes avec acompte, ventes, stock, rôles.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const iso=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const jours=(n)=>{const d=new Date();d.setHours(12);d.setDate(d.getDate()+n);return iso(d)};
const S='[\\s\\u202f\\u00a0]?';const re=(a,b)=>new RegExp('^'+a+S+b);
const mk=(role)=>new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors=['industrie'];S.tables.companies[0].sectors_locked=true;S.tables.company_members[0].role="+JSON.stringify(role)+";})()");
const sub=async(p,id)=>{await g(p,'bt-sub-'+id).click();await p.waitForTimeout(250)};
const tab=async(p,id)=>{await g(p,'bt-tab-'+id).click();await p.waitForTimeout(350)};
const cat=(p,c)=>p.evaluate((c)=>window.__srv.getCat(c)||[],c);
const an=new Date().getFullYear();
const _unused=async(p)=>{await tab(p,'chantiers');if((await g(p,'bt-ch-detail').count())===0)await p.locator('[data-testid="bt-ch-ligne"]:has-text("Villa") [data-testid="bt-ch-ouvrir"]').click();await p.waitForTimeout(300)};

const to=async(p,id)=>{await g(p,'in-tab-'+id).click();await p.waitForTimeout(300)};
const ent=async(p)=>(await cat(p,'entries')).filter(x=>x.kind==='indus');
const sold=(e,a)=>e.flatMap(x=>x.lines).filter(l=>l.account===a).reduce((s,l)=>s+l.debit-l.credit,0);
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p}=await boot(b,{settings:{companyName:'Atelier Test',currency:'HTG'},primary:true,cats:{indus:[]},pageInit:mk('Administrateur')});await p.waitForTimeout(1500);
 ok('module Industries ouvert',(await g(p,'indus-module').count())===1);
 const tabs=await p.locator('[data-testid^="in-tab-"]').evaluateAll(e=>e.map(x=>x.innerText));
 ok('11 onglets pour le responsable (dont Catalogue)',tabs.length===11,tabs);
 ok('guide en 7 étapes et message de départ',(await g(p,'in-etape').count())===7&&(await g(p,'in-vide').count())===1);
 // matières
 await to(p,'matieres');
 await g(p,'in-mat-nom').fill('Farine');await g(p,'in-mat-ajouter').click();await p.waitForTimeout(250);
 ok('matière sans unité refusée',(await g(p,'in-mat-ligne').count())===0);
 await g(p,'in-mat-unite').fill('kg');await g(p,'in-mat-seuil').fill('10');await g(p,'in-mat-ajouter').click();await p.waitForTimeout(300);
 await g(p,'in-mat-nom').fill('farine');await g(p,'in-mat-unite').fill('kg');await g(p,'in-mat-ajouter').click();await p.waitForTimeout(250);
 ok('doublon de matière refusé',(await g(p,'in-mat-ligne').count())===1);
 await g(p,'in-mat-nom').fill('Levure');await g(p,'in-mat-unite').fill('g');await g(p,'in-mat-ajouter').click();await p.waitForTimeout(300);
 ok('2 matières',(await g(p,'in-mat-ligne').count())===2);
 // achats
 const farine=await p.evaluate(()=>window.__srv.getCat('indus').find(r=>r.type==='mat'&&r.name==='Farine').id);
 await g(p,'in-ach-mat').selectOption(farine);await g(p,'in-ach-qte').fill('50');await g(p,'in-ach-enregistrer').click();await p.waitForTimeout(250);
 ok('achat sans montant refusé',(await cat(p,'indus')).filter(r=>r.type==='achat').length===0);
 await g(p,'in-ach-montant').fill('2500');await g(p,'in-ach-enregistrer').click();await p.waitForTimeout(350);
 let e=await ent(p);
 ok('achat : 601 débit 2500 / caisse 530 crédit',sold(e,'601')===2500&&sold(e,'530')===-2500,e);
 await g(p,'in-mat-ligne').first().locator('[data-testid="in-mat-ouvrir"]').click();await p.waitForTimeout(250);
 ok('stock farine 50 et prix moyen 50',/^50$/.test((await g(p,'in-mat-stock').first().innerText()).trim())&&/50/.test(await g(p,'in-mat-ligne').first().innerText()));
 await g(p,'in-ach-qte').fill('10');await g(p,'in-ach-montant').fill('600');await g(p,'in-ach-mode').selectOption('apayer');await g(p,'in-ach-enregistrer').click();await p.waitForTimeout(250);
 ok('achat à payer sans fournisseur refusé',(await cat(p,'indus')).filter(r=>r.type==='achat').length===1);
 await g(p,'in-ach-fournisseur').fill('Moulin Dupont');await g(p,'in-ach-enregistrer').click();await p.waitForTimeout(350);
 e=await ent(p);
 ok('achat à payer : crédit 401',sold(e,'401')===-600&&sold(e,'601')===3100,e);
 await g(p,'in-ach-ligne').nth(1).locator('[data-testid="in-ach-regler"]').click();await p.waitForTimeout(250);
 await g(p,'in-reg-montant').fill('200');await g(p,'in-reg-valider').click();await p.waitForTimeout(350);
 e=await ent(p);
 ok('règlement partiel : 401 solde −400',sold(e,'401')===-400,sold(e,'401'));
 await g(p,'in-reg-montant').fill('900');await g(p,'in-reg-valider').click();await p.waitForTimeout(250);
 ok('règlement supérieur au reste refusé',sold(await ent(p),'401')===-400);
 await g(p,'in-reg-montant').fill('');await g(p,'in-reg-valider').click();await p.waitForTimeout(350);
 ok('règlement du solde : 401 soldé',sold(await ent(p),'401')===0,sold(await ent(p),'401'));
 // stock = 60, prix moyen = 3100/60
 ok('stock farine 60',(await g(p,'in-mat-d-stock').innerText()).trim()==='60');
 await g(p,'in-adj-qte').fill('-100');await g(p,'in-adj-motif').fill('test');await g(p,'in-adj-ok').click();await p.waitForTimeout(250);
 ok('ajustement rendant le stock négatif refusé',(await g(p,'in-mat-d-stock').innerText()).trim()==='60');
 await g(p,'in-adj-qte').fill('-10');await g(p,'in-adj-motif').fill('Casse de sacs');await g(p,'in-adj-ok').click();await p.waitForTimeout(300);
 ok('ajustement −10 : stock 50',(await g(p,'in-mat-d-stock').innerText()).trim()==='50');
 // produits et recettes
 await to(p,'produits');
 await g(p,'in-prod-nom').fill('Pain');await g(p,'in-prod-unite').fill('pièce');await g(p,'in-prod-prix').fill('25');await g(p,'in-prod-ajouter').click();await p.waitForTimeout(300);
 ok('produit ajouté',(await g(p,'in-prod-ligne').count())===1);
 await g(p,'in-prod-ouvrir').first().click();await p.waitForTimeout(250);
 await g(p,'in-rec-mat').selectOption(farine);await g(p,'in-rec-qte').fill('10');await g(p,'in-rec-ajouter').click();await p.waitForTimeout(250);
 ok('recette sans quantité de sortie refusée',(await g(p,'in-rec-ligne').count())===0);
 await g(p,'in-rec-sortie').fill('40');await g(p,'in-rec-ajouter').click();await p.waitForTimeout(300);
 ok('recette créée',(await g(p,'in-rec-ligne').count())===1&&/40/.test(await g(p,'in-rec-resume').innerText()));
 // production
 await to(p,'production');
 const pain=await p.evaluate(()=>window.__srv.getCat('indus').find(r=>r.type==='prod').id);
 await g(p,'in-lot-produit').selectOption(pain);await g(p,'in-lot-qte').fill('400');await g(p,'in-lot-recette').click();await p.waitForTimeout(250);
 await g(p,'in-lot-enregistrer').click();await p.waitForTimeout(300);
 ok('lot dépassant le stock de matière refusé',(await g(p,'in-lot-ligne').count())===0);
 await g(p,'in-lot-qte').fill('40');await g(p,'in-lot-recette').click();await p.waitForTimeout(250);
 ok('recette appliquée : 10 kg de farine',(await g(p,'in-lot-mqte').inputValue())==='10');
 await g(p,'in-lot-heures').fill('2');await g(p,'in-lot-taux').fill('100');await g(p,'in-lot-frais').fill('50');await p.waitForTimeout(200);
 const pm=(await cat(p,'indus')).filter(r=>r.type==='achat');const prixM=(2500+600)/60;
 ok('aperçu du coût affiché',/Coût estimé/.test(await g(p,'in-lot-apercu-cout').innerText()));
 await g(p,'in-lot-enregistrer').click();await p.waitForTimeout(400);
 let lot=(await cat(p,'indus')).find(r=>r.type==='lot');
 const coutM=Math.round(10*prixM*100)/100;
 ok('lot enregistré : coût matières au prix moyen',lot&&Math.abs(lot.lines[0].cost-coutM)<0.011&&lot.qty===40&&lot.hours===2&&lot.rate===100&&lot.frais===50,lot);
 ok('liste des lots avec total',(await g(p,'in-lot-ligne').count())===1&&/Total/.test(await g(p,'in-lot-total-ligne').innerText()));
 await to(p,'produits');
 ok('stock du pain : 40',(await g(p,'in-prod-stock').first().innerText()).trim()==='40');
 await to(p,'matieres');
 ok('stock de farine après fabrication : 40',(await g(p,'in-mat-stock').first().innerText()).trim()==='40');
 await to(p,'production');
 await g(p,'in-lot-ouvrir').first().click();await p.waitForTimeout(250);
 await g(p,'in-lot-imprimer').click();await p.waitForTimeout(400);
 ok('fiche de fabrication imprimable',(await g(p,'in-lot-feuille').count())===2&&/FICHE DE FABRICATION/.test(await g(p,'in-lot-feuille').first().innerText()));
 await g(p,'in-apercu-fermer').click();await p.waitForTimeout(250);
 // clients et commande
 await to(p,'clients');
 await g(p,'in-cl-nom').fill('Hôtel Bon Accueil');await g(p,'in-cl-ajouter').click();await p.waitForTimeout(300);
 await to(p,'commandes');
 await g(p,'in-cmd-creer').click();await p.waitForTimeout(250);
 ok('commande sans client refusée',(await g(p,'in-cmd-ligne').count())===0);
 await g(p,'in-cmd-client').selectOption({index:1});
 await g(p,'in-cmd-produit').selectOption(pain);await g(p,'in-cmd-qte').fill('10');await g(p,'in-cmd-ajouter-ligne').click();await p.waitForTimeout(250);
 await g(p,'in-cmd-type').selectOption('mesure');
 await g(p,'in-cmd-designation').fill('Gâteau de mariage 3 étages');await g(p,'in-cmd-qte').fill('1');await g(p,'in-cmd-pu').fill('1500');await g(p,'in-cmd-ajouter-ligne').click();await p.waitForTimeout(250);
 ok('total du brouillon 250 + 1500',/1[\s  ,.]?750/.test(await g(p,'in-cmd-brouillon-total').innerText()),await g(p,'in-cmd-brouillon-total').innerText());
 await g(p,'in-cmd-creer').click();await p.waitForTimeout(350);
 ok('commande créée en devis',(await g(p,'in-cmd-ligne').count())===1&&/Devis/.test(await g(p,'in-cmd-ligne').first().innerText()));
 await g(p,'in-cmd-ouvrir').first().click();await p.waitForTimeout(250);
 await g(p,'in-cmd-facturer').count().then(n=>ok('facturation impossible avant confirmation',n===0));
 await g(p,'in-cmd-devis').click();await p.waitForTimeout(400);
 ok('devis imprimable',(await g(p,'in-devis-feuille').count())===2&&/Gâteau de mariage/.test(await g(p,'in-devis-feuille').first().innerText()));
 await g(p,'in-apercu-fermer').click();await p.waitForTimeout(250);
 await g(p,'in-cmd-confirmer').click();await p.waitForTimeout(300);
 await g(p,'in-ac-montant').fill('500');await g(p,'in-ac-ok').click();await p.waitForTimeout(350);
 e=await ent(p);
 ok('acompte : caisse débit 500 / 4191 crédit 500',sold(e,'4191')===-500,sold(e,'4191'));
 await g(p,'in-ac-montant').fill('5000');await g(p,'in-ac-ok').click();await p.waitForTimeout(250);
 ok('acompte supérieur au total refusé',(await g(p,'in-ac-ligne').count())===1);
 await g(p,'in-cmd-facturer').click();await p.waitForTimeout(450);
 let fa=(await cat(p,'indus')).find(r=>r.type==='fact');
 ok('facture émise : HT 1750, acompte 500 déduit, net 1250',fa&&fa.ht===1750&&fa.recup===500&&fa.net===1250,fa);
 e=await ent(p);
 ok('écriture de facture : 411 débit 1250, 4191 soldé, 701 crédit 1750',sold(e,'411')===1250&&sold(e,'4191')===0&&sold(e,'701')===-1750,[sold(e,'411'),sold(e,'4191'),sold(e,'701')]);
 ok('commande livrée et facturée',/Livrée/.test(await g(p,'in-cmd-ligne').first().innerText()));
 // ventes
 await to(p,'ventes');
 ok('facture dans la liste',(await g(p,'in-vte-ligne').count())===1);
 await g(p,'in-vte-ouvrir').first().click();await p.waitForTimeout(250);
 await g(p,'in-pay-ok').click();await p.waitForTimeout(350);
 ok('encaissement du reste : facture soldée',/Soldée/.test(await g(p,'in-vte-ligne').first().innerText()));
 e=await ent(p);
 ok('encaissement : 411 soldé',sold(e,'411')===0,sold(e,'411'));
 await g(p,'in-vte-imprimer').click();await p.waitForTimeout(400);
 ok('facture imprimable A4 puis ticket',(await g(p,'in-facture-feuille').count())===2&&/NET À PAYER/.test(await g(p,'in-facture-feuille').first().innerText()));
 await g(p,'in-format').click();await p.waitForTimeout(250);
 ok('format ticket',(await g(p,'in-facture-feuille').first().innerText()).includes('FACTURE'));
 await g(p,'in-apercu-fermer').click();await p.waitForTimeout(250);
 // vente au comptoir
 await g(p,'in-vte-produit').selectOption(pain);await g(p,'in-vte-qte').fill('100');await g(p,'in-vte-ajouter-ligne').click();await g(p,'in-vte-emettre').click();await p.waitForTimeout(300);
 ok('vente supérieure au stock refusée dès l\'ajout de la ligne',(await g(p,'in-vte-ligne').count())===1&&(await g(p,'in-vte-lignebrouillon').count())===0);
 await g(p,'in-vte-produit').selectOption(pain);await g(p,'in-vte-qte').fill('5');await g(p,'in-vte-ajouter-ligne').click();await p.waitForTimeout(200);
 await g(p,'in-vte-emettre').click();await p.waitForTimeout(450);
 ok('vente comptoir encaissée : 2 factures, 2e soldée',(await g(p,'in-vte-ligne').count())===2&&/Soldée/.test(await g(p,'in-vte-ligne').first().innerText()));
 ok('totaux de la liste : HT 1875',/1[\s  ,.]?875/.test(await g(p,'in-vte-tot-ht').innerText()),await g(p,'in-vte-tot-ht').innerText());
 await g(p,'in-vte-filtre-etat').selectOption('encaisser');await p.waitForTimeout(200);
 ok('filtre « À encaisser » : aucune',(await g(p,'in-vte-ligne').count())===0);
 await g(p,'in-vte-filtre-etat').selectOption('');
 // stock pain 40-10-5 = 25 ; annuler le lot refusé
 await to(p,'production');
 await g(p,'in-lot-ouvrir').first().click();await p.waitForTimeout(250);
 await g(p,'in-lot-annuler').click().catch(()=>{});await p.waitForTimeout(300);
 lot=(await cat(p,'indus')).find(r=>r.type==='lot');
 ok('annulation du lot refusée (produits déjà vendus)',lot.status==='valide',lot.status);
 // dépenses
 await to(p,'depenses');
 await g(p,'in-dep-enregistrer').click();await p.waitForTimeout(250);
 ok('dépense sans montant refusée',(await g(p,'in-dep-ligne').count())===0);
 await g(p,'in-dep-nature').selectOption('energie');await g(p,'in-dep-montant').fill('300');await g(p,'in-dep-enregistrer').click();await p.waitForTimeout(350);
 e=await ent(p);
 ok('dépense : 605 débit 300',sold(e,'605')===300,sold(e,'605'));
 ok('total des dépenses',/300/.test(await g(p,'in-dep-tot').innerText()));
 // rapports
 await to(p,'rapports');
 ok('marge par produit : pain vendu 15 pour 375',/15/.test(await g(p,'in-rap-prod-ligne').first().innerText())&&/375/.test(await g(p,'in-rap-prod-ligne').first().innerText().then(t=>t.replace(/[\s  ,]/g,''))),await g(p,'in-rap-prod-ligne').first().innerText());
 ok('marge par commande listée',(await g(p,'in-rap-cmd-ligne').count())===1);
 // tableau de bord
 await to(p,'apercu');
 ok('tableau de bord : indicateurs',(await p.locator('.ec-kpi').count())===8);
 await to(p,'stats');await p.waitForTimeout(300);
 ok('statistiques affichées',/Ventes/.test(await g(p,'indus-module').innerText()));
}
// Vendeur
{const {p}=await boot(b,{settings:{companyName:'Atelier Test',currency:'HTG'},primary:true,cats:{indus:[{type:'client',id:'c1',name:'Client A'}]},pageInit:mk('Vendeur')});await p.waitForTimeout(1500);
 const tabs=await p.locator('[data-testid^="in-tab-"]').evaluateAll(e=>e.map(x=>x.innerText));
 ok('Vendeur : 5 onglets seulement (dont Catalogue)',tabs.length===5&&!tabs.includes('Production'),tabs);
 ok('Vendeur : note d\'accueil',(await g(p,'in-accueil-note').count())===1);
}
// Lecteur
{const {p}=await boot(b,{settings:{companyName:'Atelier Test',currency:'HTG'},primary:true,cats:{indus:[{type:'client',id:'c1',name:'Client A'}]},pageInit:mk('Lecteur')});await p.waitForTimeout(1500);
 await to(p,'clients');
 ok('Lecteur : pas de formulaire client',(await g(p,'in-cl-ajouter').count())===0);
 await to(p,'ventes');
 ok('Lecteur : pas de vente directe',(await g(p,'in-vte-emettre').count())===0);
}
await b.close();console.log(fails?('ÉCHECS '+fails):'TOUT PASSE');process.exit(fails?1:0)})();

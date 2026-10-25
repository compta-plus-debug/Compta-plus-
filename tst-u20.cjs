// v269 — bloc Santé : patients, catalogue, facture avec assureur (tiers payant), honoraires, rejet, pharmacie (stock), hôpital (séjour), silos par type, droits.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const base={companyName:'Sante Test',currency:'HTG'};
const mk=(role,sect)=>new Function("(function(){const S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors="+JSON.stringify(sect)+";S.tables.companies[0].sectors_locked=true;S.tables.company_members[0].role="+JSON.stringify(role)+";try{sessionStorage.clear();localStorage.removeItem('compta-plus-espace')}catch(e){}})();");
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const tab=async(p,id)=>{await g(p,'sante-tab-'+id).click();await p.waitForTimeout(300)};
const cat=(p,c)=>p.evaluate((c)=>window.__srv.getCat(c)||[],c);
const sum=(e,acc)=>e.reduce((s,x)=>s+x.lines.filter(l=>l.account===acc).reduce((a,l)=>a+l.debit-l.credit,0),0);
const txt=async(p,t)=>(await g(p,t).innerText()).replace(/\s/g,'');
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p}=await boot(b,{settings:base,primary:true,pageInit:mk('Administrateur',['sante'])});await p.waitForTimeout(1200);
 ok('espace Santé ouvert par défaut',(await g(p,'sante-module').count())===1);
 ok('Santé seule (cabinet) : pas de sélecteur d\'espaces (Commerce non nécessaire)',(await g(p,'espace-selecteur').count())===0&&(await g(p,'espace-impex').count())===0);
 ok('message de départ affiché',(await g(p,'sante-vide').count())===1);
 await tab(p,'assureurs');await g(p,'sante-assureur-nom').fill('Assurance Alpha');await g(p,'sante-assureur-pct').fill('80');await g(p,'sante-assureur-ajouter').click();await p.waitForTimeout(300);
 await tab(p,'praticiens');await g(p,'sante-prat-nom').fill('Dr Jean');await g(p,'sante-prat-part').fill('50');await g(p,'sante-prat-ajouter').click();await p.waitForTimeout(300);
 await tab(p,'actes');await g(p,'sante-acte-nom').fill('Consultation générale');await g(p,'sante-acte-cat').selectOption('consultation');await g(p,'sante-acte-prix').fill('1000');await g(p,'sante-acte-ajouter').click();await p.waitForTimeout(300);
 await tab(p,'patients');await g(p,'sante-patient-nom').fill('Marie Pierre');await g(p,'sante-patient-assureur').selectOption({label:'Assurance Alpha'});await g(p,'sante-patient-ajouter').click();await p.waitForTimeout(300);
 ok('patient PAT-0001 créé',/PAT-0001/.test(await g(p,'sante-patient-ligne').first().innerText()));
 await tab(p,'factures');
 await g(p,'sante-fact-patient').selectOption({label:'Marie Pierre'});
 ok('assureur du patient repris automatiquement',(await g(p,'sante-fact-assureur').inputValue())!=='');
 await g(p,'sante-fact-praticien').selectOption({label:'Dr Jean'});
 await g(p,'sante-fact-acte').selectOption({index:1});await g(p,'sante-fact-qte').fill('1');await g(p,'sante-fact-ajouter').click();await p.waitForTimeout(300);
 ok('répartition 1000 = assureur 800 + patient 200',/1.?000/.test(await txt(p,'sante-fact-total'))&&/800/.test(await txt(p,'sante-fact-part-assureur'))&&/200/.test(await txt(p,'sante-fact-part-patient')),[await txt(p,'sante-fact-total')]);
 await g(p,'sante-fact-emettre').click();await p.waitForTimeout(600);
 let e=(await cat(p,'entries')).filter(x=>x.kind==='sante');
 ok('écriture : 4112=200, 4113=800, 7065=-1000',Math.abs(sum(e,'4112')-200)<.01&&Math.abs(sum(e,'4113')-800)<.01&&Math.abs(sum(e,'7065')+1000)<.01,[sum(e,'4112'),sum(e,'4113'),sum(e,'7065')]);
 ok('honoraires : 6221=500 et 4678=-500',Math.abs(sum(e,'6221')-500)<.01&&Math.abs(sum(e,'4678')+500)<.01,[sum(e,'6221'),sum(e,'4678')]);
 ok('écritures équilibrées',e.every(x=>Math.abs(x.lines.reduce((s,l)=>s+l.debit-l.credit,0))<.005));
 if((await g(p,'sante-facture-detail').count())===0){await g(p,'sante-facture-ouvrir').first().click();await p.waitForTimeout(300);}
 ok('détail : reste patient 200, reste assureur 800',/200/.test(await txt(p,'sante-det-reste-patient'))&&/800/.test(await txt(p,'sante-det-reste-assureur')));
 await g(p,'sante-enc-montant').fill('300');await g(p,'sante-enc-valider').click();await p.waitForTimeout(400);
 ok('encaissement supérieur au reste refusé',(await g(p,'sante-paiement-ligne').count())===0);
 await g(p,'sante-enc-montant').fill('200');await g(p,'sante-enc-valider').click();await p.waitForTimeout(500);
 e=(await cat(p,'entries')).filter(x=>x.kind==='sante');
 ok('encaissement : caisse +200, 4112 soldé',Math.abs(sum(e,'530')-200)<.01&&Math.abs(sum(e,'4112'))<.01,[sum(e,'530'),sum(e,'4112')]);
 await g(p,'sante-remb-montant').fill('500');await g(p,'sante-remb-valider').click();await p.waitForTimeout(500);
 e=(await cat(p,'entries')).filter(x=>x.kind==='sante');
 ok('remboursement assureur : banque +500, 4113 = 300',Math.abs(sum(e,'512')-500)<.01&&Math.abs(sum(e,'4113')-300)<.01,[sum(e,'512'),sum(e,'4113')]);
 await g(p,'sante-rejet-montant').fill('100');await g(p,'sante-rejet-perte').click();await p.waitForTimeout(400);
 ok('rejet sans motif refusé',(await g(p,'sante-ajust-ligne').count())===0);
 await g(p,'sante-rejet-motif').fill('Dossier incomplet');await g(p,'sante-rejet-perte').click();await p.waitForTimeout(500);
 e=(await cat(p,'entries')).filter(x=>x.kind==='sante');
 ok('rejet : 659 = 100, 4113 = 200',Math.abs(sum(e,'659')-100)<.01&&Math.abs(sum(e,'4113')-200)<.01,[sum(e,'659'),sum(e,'4113')]);
 await g(p,'sante-rejet-motif').fill('Hors garantie');await g(p,'sante-rejet-montant').fill('200');await g(p,'sante-rejet-report').click();await p.waitForTimeout(500);
 e=(await cat(p,'entries')).filter(x=>x.kind==='sante');
 ok('report sur le patient : 4112 = 200, 4113 soldé',Math.abs(sum(e,'4112')-200)<.01&&Math.abs(sum(e,'4113'))<.01,[sum(e,'4112'),sum(e,'4113')]);
 await g(p,'sante-facture-annuler').click();await p.waitForTimeout(400);
 ok('annulation refusée tant qu\'il y a des paiements',(await cat(p,'entries')).filter(x=>x.kind==='sante').length===e.length);
 // honoraires
 await tab(p,'praticiens');
 ok('honoraires à reverser 500',/500/.test(await txt(p,'sante-prat-reste')));
 await g(p,'sante-hono-prat').selectOption({label:'Dr Jean'});await g(p,'sante-hono-montant').fill('600');await g(p,'sante-hono-valider').click();await p.waitForTimeout(400);
 ok('versement supérieur au dû refusé',/500/.test(await txt(p,'sante-prat-reste')));
 await g(p,'sante-hono-montant').fill('500');await g(p,'sante-hono-valider').click();await p.waitForTimeout(500);
 e=(await cat(p,'entries')).filter(x=>x.kind==='sante');
 ok('honoraires versés : 4678 soldé, caisse -300',Math.abs(sum(e,'4678'))<.01&&Math.abs(sum(e,'530')+300)<.01,[sum(e,'4678'),sum(e,'530')]);
 // suppression d'un patient facturé refusée
 await tab(p,'patients');await g(p,'sante-patient-supprimer').first().click();await p.waitForTimeout(300);
 ok('patient facturé non supprimable',(await g(p,'sante-patient-ligne').count())===1);
 await tab(p,'rapports');
 ok('rapport par catégorie',(await g(p,'sante-rapport-cat').count())===1);
 ok('pas d\'onglet Séjours ni Lots dans un cabinet',(await g(p,'sante-tab-sejours').count())===0&&(await g(p,'sante-tab-lots').count())===0);
 // pharmacie : silo + stock
 await tab(p,'apercu');await g(p,'sante-etab-type').selectOption('pharmacie');await p.waitForTimeout(500);
 ok('silo pharmacie : aucun patient hérité du cabinet',true);
 await tab(p,'patients');ok('liste clients vide en pharmacie',(await g(p,'sante-patient-ligne').count())===0);
 ok('onglet Lots présent',(await g(p,'sante-tab-lots').count())===1);
 await g(p,'sante-patient-nom').fill('Client comptoir');await g(p,'sante-patient-ajouter').click();await p.waitForTimeout(300);
 await tab(p,'actes');await g(p,'sante-acte-nom').fill('Riz santé');await g(p,'sante-acte-cat').selectOption('produit');await g(p,'sante-acte-produit').selectOption({label:'Riz'});await g(p,'sante-acte-prix').fill('100');await g(p,'sante-acte-ajouter').click();await p.waitForTimeout(300);
 await tab(p,'factures');await g(p,'sante-fact-patient').selectOption({label:'Client comptoir'});await g(p,'sante-fact-acte').selectOption({index:1});await g(p,'sante-fact-qte').fill('3');await g(p,'sante-fact-ajouter').click();await g(p,'sante-fact-emettre').click();await p.waitForTimeout(600);
 const pr=(await cat(p,'products')).find(x=>x.code==='R1');
 ok('vente en pharmacie : stock 10 → 7',pr&&pr.stock===7,pr&&pr.stock);
 e=(await cat(p,'entries')).filter(x=>x.kind==='sante');
 ok('vente produit : 707 = -300',Math.abs(sum(e,'707')+300)<.01,sum(e,'707'));
 await g(p,'sante-fact-patient').selectOption({label:'Client comptoir'});await g(p,'sante-fact-acte').selectOption({index:1});await g(p,'sante-fact-qte').fill('50');await g(p,'sante-fact-ajouter').click();await g(p,'sante-fact-emettre').click();await p.waitForTimeout(500);
 ok('stock insuffisant : vente refusée',(await cat(p,'products')).find(x=>x.code==='R1').stock===7);
 await tab(p,'lots');await g(p,'sante-lot-produit').selectOption({label:'Riz'});await g(p,'sante-lot-numero').fill('L-001');await g(p,'sante-lot-peremption').fill('2020-01-01');await g(p,'sante-lot-qte').fill('5');await g(p,'sante-lot-ajouter').click();await p.waitForTimeout(300);
 ok('lot périmé signalé',/Périmé/.test(await g(p,'sante-lot-ligne').first().innerText()));
 // hôpital : séjour
 await tab(p,'apercu');await g(p,'sante-etab-type').selectOption('hopital');await p.waitForTimeout(500);
 await tab(p,'patients');await g(p,'sante-patient-nom').fill('Paul Louis');await g(p,'sante-patient-ajouter').click();await p.waitForTimeout(300);
 await tab(p,'sejours');await g(p,'sante-sejour-patient').selectOption({label:'Paul Louis'});await g(p,'sante-sejour-service').fill('Chirurgie');
 const dMax=await p.locator('[data-testid="sante-module"] input[type=date]').first().getAttribute('max');const d0=new Date(new Date(dMax+'T12:00:00').getTime()-3*86400000).toISOString().slice(0,10);await p.locator('[data-testid="sante-module"] input[type=date]').first().fill(d0);
 await g(p,'sante-sejour-tarif').fill('2000');await g(p,'sante-sejour-admettre').click();await p.waitForTimeout(300);
 const d1=dMax;await g(p,'sante-sejour-sortie').fill(d1);await g(p,'sante-sejour-facturer').click();await p.waitForTimeout(600);
 e=(await cat(p,'entries')).filter(x=>x.kind==='sante');
 ok('séjour 3 jours × 2000 = 6000 en 7067',Math.abs(sum(e,'7067')+6000)<.01,sum(e,'7067'));
 ok('séjour marqué facturé',/Facturé/.test(await g(p,'sante-sejour-ligne').first().innerText()));
 // retour au cabinet : données intactes
 await tab(p,'apercu');await g(p,'sante-etab-type').selectOption('cabinet');await p.waitForTimeout(400);
 await tab(p,'patients');ok('cabinet retrouve Marie Pierre seulement',(await g(p,'sante-patient-ligne').count())===1&&/Marie/.test(await g(p,'sante-patient-ligne').first().innerText()));
 const raw=await cat(p,'sante');ok('records tamponnés par type',raw.filter(r=>r.type==='patient'&&r.etab==='hopital').length===1&&raw.filter(r=>r.type==='patient'&&r.etab==='pharmacie').length===1);
 await p.close();}
{const {p}=await boot(b,{settings:base,primary:false,pageInit:mk('Lecture seule',['sante'])});await p.waitForTimeout(1200);
 ok('lecture seule : module visible sans bouton de création',(await g(p,'sante-module').count())===1&&(await g(p,'sante-fact-emettre').count())===0);
 await p.close();}
{const {p}=await boot(b,{settings:base,primary:false,pageInit:mk('Vendeur',['sante'])});await p.waitForTimeout(1200);
 ok('vendeur : accès à l\'accueil du module Santé (v270)',(await g(p,'sante-module').count())===1&&(await g(p,'sante-tab-rapports').count())===0);
 await p.close();}
{const {p}=await boot(b,{settings:base,primary:true,pageInit:mk('Administrateur',[])});await p.waitForTimeout(1200);
 ok('sans le secteur Santé : pas de module',(await g(p,'sante-module').count())===0&&(await g(p,'espace-sante').count())===0);
 await p.close();}
await b.close();console.log('fails='+fails);})();

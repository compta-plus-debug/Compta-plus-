// v313 — bloc Services et prestations : activité, catalogue, clients, factures (comptant et crédit), encaissements, taxe, contrats mensuels,
// dépenses, rapports, impression, période clôturée, montants hostiles, rôle Vendeur, achats listés, mention « ne remplace pas l'expert-comptable ».
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const iso=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const today=iso(new Date());
const back=(n)=>{const d=new Date();d.setDate(d.getDate()-n);return iso(d)};
const mk=(sec,role)=>new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors="+JSON.stringify(sec)+";S.tables.companies[0].sectors_locked="+(sec.length>0)+";S.tables.company_members[0].role="+JSON.stringify(role)+";})()");
const cat=(p,c)=>p.evaluate((c)=>window.__srv.getCat(c)||[],c);
const seed=()=>[{type:'client',id:'k1',name:'Résidence Les Palmes',kind:'entreprise',phone:'',email:'',address:'Pétion-Ville'}];
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p}=await boot(b,{settings:{companyName:'Sécurité Plus',currency:'HTG',taxRate:10},primary:true,cats:{services:seed()},pageInit:mk(['services'],'Administrateur')});
await p.waitForTimeout(1600);
 ok('espace Services ouvert avec ses onglets',(await g(p,'services-module').count())===1&&(await g(p,'sv-tab-ventes').count())===1&&(await g(p,'sv-tab-contrats').count())===1&&(await g(p,'sv-tab-rapports').count())===1);
 ok('carte « activité » proposée au départ',(await g(p,'sv-type-carte').count())===1);
 ok('guide de démarrage : 6 étapes',(await g(p,'sv-etape').count())===6,await g(p,'sv-etape').count());
 ok('mention « ne remplace pas votre expert-comptable » visible',/ne remplace pas votre expert-comptable/.test(await g(p,'sv-mention').innerText()));
 await g(p,'sv-type-securite').click();await p.waitForTimeout(400);
 ok('activité choisie : carte disparue et mémorisée',(await g(p,'sv-type-carte').count())===0&&(await cat(p,'services')).some(r=>r.type==='config'&&r.svType==='securite'));
 // ── Catalogue
 await g(p,'sv-tab-prestations').click();await p.waitForTimeout(300);
 await g(p,'sv-prest-nom').fill('Gardiennage de nuit');await g(p,'sv-prest-prix').fill('45000');await g(p,'sv-prest-ajouter').click();await p.waitForTimeout(300);
 ok('prestation ajoutée',(await cat(p,'services')).filter(r=>r.type==='prest').length===1&&(await g(p,'sv-prest-ligne').count())===1);
 await g(p,'sv-prest-nom').fill('GARDIENNAGE DE NUIT');await g(p,'sv-prest-prix').fill('1');await g(p,'sv-prest-ajouter').click();await p.waitForTimeout(300);
 ok('doublon de prestation refusé',(await cat(p,'services')).filter(r=>r.type==='prest').length===1);
 await g(p,'sv-prest-nom').fill('Hostile');await g(p,'sv-prest-prix').fill('1e308');await g(p,'sv-prest-ajouter').click();await p.waitForTimeout(300);
 ok('prix démesuré refusé',(await cat(p,'services')).filter(r=>r.type==='prest').length===1);
 await g(p,'sv-prest-nom').fill('Patrouille');await g(p,'sv-prest-prix').fill('5000');await g(p,'sv-prest-ajouter').click();await p.waitForTimeout(300);
 // ── Clients
 await g(p,'sv-tab-clients').click();await p.waitForTimeout(300);
 await g(p,'sv-client-nom').fill('résidence les palmes');await g(p,'sv-client-ajouter').click();await p.waitForTimeout(300);
 ok('doublon de client refusé',(await cat(p,'services')).filter(r=>r.type==='client').length===1);
 await g(p,'sv-client-nom').fill('Boutique Soleil');await g(p,'sv-client-ajouter').click();await p.waitForTimeout(300);
 ok('client ajouté',(await cat(p,'services')).filter(r=>r.type==='client').length===2);
 // ── Facture au comptant
 await g(p,'sv-tab-ventes').click();await p.waitForTimeout(300);
 await g(p,'sv-ligne-prest').first().selectOption({index:1});await g(p,'sv-ligne-qte').first().fill('2');await p.waitForTimeout(200);
 ok('le prix de la prestation est repris et le total calculé',/90[\s  ]?000/.test(await g(p,'sv-vente-total').innerText()),await g(p,'sv-vente-total').innerText());
 await g(p,'sv-vente-enregistrer').click();await p.waitForTimeout(450);
 ok('facture FS-année-0001 affichée',/FS-\d{4}-0001/.test(await g(p,'sv-facture-feuille').first().innerText()),await g(p,'sv-facture-feuille').count());
 await g(p,'sv-apercu-fermer').click();await p.waitForTimeout(300);
 let ent=await cat(p,'entries');let e1=ent.find(e=>(e.lines||[]).some(l=>l.account==='706'));
 ok('écriture comptant : caisse 530 au débit, 706 au crédit',!!e1&&e1.lines.some(l=>l.account==='530'&&l.debit===90000)&&e1.lines.some(l=>l.account==='706'&&l.credit===90000),e1);
 // facture à crédit sans client refusée
 await g(p,'sv-ligne-libelle').first().fill('Surveillance événement');await g(p,'sv-ligne-pu').first().fill('20000');await g(p,'sv-ligne-qte').first().fill('1');await g(p,'sv-vente-mode').selectOption('credit');await g(p,'sv-vente-enregistrer').click();await p.waitForTimeout(350);
 ok('facture à crédit sans client enregistré refusée',(await cat(p,'services')).filter(r=>r.type==='vente').length===1);
 await g(p,'sv-vente-client').selectOption('c:k1');await g(p,'sv-vente-interv').fill('Équipe A');await g(p,'sv-vente-enregistrer').click();await p.waitForTimeout(450);
 ok('facture à crédit : numéro 0002, débit 411',/FS-\d{4}-0002/.test(await g(p,'sv-facture-feuille').first().innerText())&&(await cat(p,'entries')).some(e=>(e.lines||[]).some(l=>l.account==='411'&&l.debit===20000)));
 await g(p,'sv-apercu-fermer').click();await p.waitForTimeout(300);
 // montant hostile
 await g(p,'sv-ligne-pu').first().fill('1e308');await g(p,'sv-vente-mode').selectOption('caisse');await g(p,'sv-vente-enregistrer').click();await p.waitForTimeout(350);
 ok('prix démesuré refusé sur une facture',(await cat(p,'services')).filter(r=>r.type==='vente').length===2);
 await g(p,'sv-ligne-pu').first().fill('0');await g(p,'sv-vente-enregistrer').click();await p.waitForTimeout(300);
 ok('prix nul refusé',(await cat(p,'services')).filter(r=>r.type==='vente').length===2);
 // ── Encaissement
 await g(p,'sv-vente-ouvrir').first().click();await p.waitForTimeout(300);
 await g(p,'sv-enc-montant').fill('30000');await g(p,'sv-enc-ok').click();await p.waitForTimeout(300);
 ok('encaissement supérieur au reste refusé',(await cat(p,'services')).find(r=>r.type==='vente'&&r.mode==='credit').settlements.length===0);
 await g(p,'sv-enc-montant').fill('5000');await g(p,'sv-enc-ok').click();await p.waitForTimeout(400);
 const vc=(await cat(p,'services')).find(r=>r.type==='vente'&&r.mode==='credit');
 ok('encaissement partiel enregistré, écriture 530/411',vc.settlements.length===1&&(await cat(p,'entries')).some(e=>(e.lines||[]).some(l=>l.account==='411'&&l.credit===5000)&&(e.lines||[]).some(l=>l.account==='530'&&l.debit===5000)));
 await g(p,'sv-vente-annuler').first().click();await p.waitForTimeout(300);
 ok('annulation d\'une facture encaissée refusée',(await cat(p,'services')).find(r=>r.id===vc.id).status!=='annulé');
 // ── Taxe
 await g(p,'sv-tab-apercu').click();await p.waitForTimeout(300);
 await g(p,'sv-tca').click();await p.waitForTimeout(300);
 ok('taxe activée dans la configuration',(await cat(p,'services')).some(r=>r.type==='config'&&r.tcaOn===true));
 await g(p,'sv-tab-ventes').click();await p.waitForTimeout(300);
 await g(p,'sv-ligne-libelle').first().fill('Formation');await g(p,'sv-ligne-pu').first().fill('1000');await g(p,'sv-ligne-qte').first().fill('1');await p.waitForTimeout(200);
 ok('avec taxe 10 % : total 1 100',/1[\s  ]?100/.test(await g(p,'sv-vente-total').innerText()),await g(p,'sv-vente-total').innerText());
 await g(p,'sv-vente-enregistrer').click();await p.waitForTimeout(450);
 ok('écriture avec taxe : 706 crédit 1000 et 445 crédit 100',(await cat(p,'entries')).some(e=>(e.lines||[]).some(l=>l.account==='706'&&l.credit===1000)&&(e.lines||[]).some(l=>l.account==='445'&&l.credit===100)));
 await g(p,'sv-apercu-fermer').click();await p.waitForTimeout(300);
 // annulation d'une facture comptant → écriture inverse
 const rowsV=g(p,'sv-vente-annuler');const nAvant=(await cat(p,'entries')).length;
 await rowsV.first().click();await p.waitForTimeout(400);
 ok('annulation : écriture inverse passée',(await cat(p,'entries')).length===nAvant+1&&(await cat(p,'services')).filter(r=>r.type==='vente'&&r.status==='annulé').length===1);
 // ── Contrats
 await g(p,'sv-tab-contrats').click();await p.waitForTimeout(300);
 await g(p,'sv-contrat-client').selectOption('c:k1');await g(p,'sv-contrat-libelle').fill('Gardiennage mensuel');await g(p,'sv-contrat-montant').fill('60000');
 const d0=new Date();d0.setMonth(d0.getMonth()-2);d0.setDate(1);await g(p,'sv-contrat-debut').fill(iso(d0));await g(p,'sv-contrat-ajouter').click();await p.waitForTimeout(350);
 ok('contrat enregistré avec 3 mois à facturer',(await cat(p,'services')).filter(r=>r.type==='contrat').length===1&&(await g(p,'sv-contrat-facturer').count())===3,await g(p,'sv-contrat-facturer').count());
 await g(p,'sv-contrat-facturer').first().click();await p.waitForTimeout(450);
 const venteK=(await cat(p,'services')).filter(r=>r.type==='vente'&&r.contratId);
 ok('un clic : facture du mois créée, à crédit, avec période',venteK.length===1&&venteK[0].mode==='credit'&&/^\d{4}-\d{2}$/.test(venteK[0].periode)&&venteK[0].ht===60000,venteK);
 ok('le même mois ne se refacture pas',(await g(p,'sv-contrat-facturer').count())===2);
 await g(p,'sv-contrat-suspendre').click();await p.waitForTimeout(300);
 ok('contrat suspendu : plus de mois à facturer',(await g(p,'sv-contrat-facturer').count())===0);
 await g(p,'sv-contrat-suspendre').click();await p.waitForTimeout(300);
 // ── Dépenses
 await g(p,'sv-tab-depenses').click();await p.waitForTimeout(300);
 await g(p,'sv-dep-montant').fill('3000');await g(p,'sv-dep-enregistrer').click();await p.waitForTimeout(400);
 ok('dépense comptant : 601 au débit, caisse au crédit',(await cat(p,'entries')).some(e=>(e.lines||[]).some(l=>l.account==='601'&&l.debit===3000)&&(e.lines||[]).some(l=>l.account==='530'&&l.credit===3000)));
 const nat=await g(p,'sv-dep-nature').locator('option').allInnerTexts();
 ok('vocabulaire sécurité : uniformes et agents partenaires',nat.some(x=>/Uniformes/.test(x))&&nat.some(x=>/Agents ou sociétés partenaires/.test(x)),nat);
 await g(p,'sv-dep-mode').selectOption('apayer');await g(p,'sv-dep-montant').fill('800');await g(p,'sv-dep-enregistrer').click();await p.waitForTimeout(300);
 ok('dépense à payer sans fournisseur refusée',(await cat(p,'services')).filter(r=>r.type==='dep').length===1);
 await g(p,'sv-dep-fournisseur').fill('Uniformes Express');await g(p,'sv-dep-enregistrer').click();await p.waitForTimeout(400);
 ok('dépense à payer enregistrée : 401 au crédit',(await cat(p,'services')).filter(r=>r.type==='dep').length===2&&(await cat(p,'entries')).some(e=>(e.lines||[]).some(l=>l.account==='401'&&l.credit===800)));
 await g(p,'sv-dep-ouvrir').first().click();await p.waitForTimeout(300);
 await g(p,'sv-reg-montant').fill('300');await g(p,'sv-reg-ok').click();await p.waitForTimeout(400);
 ok('règlement partiel : 401 au débit',(await cat(p,'entries')).some(e=>(e.lines||[]).some(l=>l.account==='401'&&l.debit===300)));
 // ── Rapports
 await g(p,'sv-tab-rapports').click();await p.waitForTimeout(400);
 ok('rapport : chiffre d\'affaires, dépenses et résultat cohérents',(await g(p,'sv-rap-resultat').count())===1&&/\d/.test(await g(p,'sv-rap-ca').innerText()));
 const caTxt=(await g(p,'sv-rap-ca').innerText()).replace(/[^\d]/g,'');
 // factures valides : 90000 + 20000 + 60000 (contrat) = 170000 ; la facture avec taxe de 1000 est annulée
 ok('chiffre d\'affaires hors taxe = 170 000 (facture annulée exclue)',caTxt==='170000',caTxt);
 ok('créances âgées affichées',(await g(p,'sv-rap-ages').count())===1);
 ok('répartition par intervenant listée',(await g(p,'sv-rap-interv').count())>=1);
 // ── Assistant / à faire
 await g(p,'sv-tab-apercu').click();await p.waitForTimeout(300);
 ok('tableau de bord : KPI et « à faire » (contrats à facturer)',(await g(p,'sv-kpi-ca').count())===1&&(await g(p,'sv-afaire-ligne').count())>=1);
 await p.close();}
// ── Période clôturée
{const {p}=await boot(b,{settings:{companyName:'A',currency:'HTG',lockDate:today},primary:true,cats:{services:[{type:'config',id:'cf',svType:'conseil'},...seed()]},pageInit:mk(['services'],'Administrateur')});await p.waitForTimeout(1500);
 await g(p,'sv-tab-ventes').click();await p.waitForTimeout(300);
 await g(p,'sv-ligne-libelle').first().fill('Consultation');await g(p,'sv-ligne-pu').first().fill('500');await g(p,'sv-vente-date').fill(back(1));await g(p,'sv-vente-enregistrer').click();await p.waitForTimeout(350);
 ok('période clôturée : facture refusée',(await cat(p,'services')).filter(r=>r.type==='vente').length===0);
 await p.close();}
// ── Rôle Vendeur
{const {p}=await boot(b,{settings:{companyName:'A',currency:'HTG'},primary:true,cats:{services:[{type:'config',id:'cf',svType:'beaute'},...seed()]},pageInit:mk(['services'],'Vendeur')});await p.waitForTimeout(1500);
 ok('Vendeur : seulement tableau de bord, factures et clients',(await g(p,'sv-tab-ventes').count())===1&&(await g(p,'sv-tab-clients').count())===1&&(await g(p,'sv-tab-depenses').count())===0&&(await g(p,'sv-tab-contrats').count())===0&&(await g(p,'sv-tab-rapports').count())===0&&(await g(p,'sv-tab-prestations').count())===0);
 await g(p,'sv-tab-ventes').click();await p.waitForTimeout(300);
 await g(p,'sv-ligne-libelle').first().fill('Coupe');await g(p,'sv-ligne-pu').first().fill('800');await g(p,'sv-vente-enregistrer').click();await p.waitForTimeout(450);
 ok('Vendeur : peut faire une facture',(await g(p,'sv-facture-feuille').count())>=1);
 await g(p,'sv-apercu-fermer').click();await p.waitForTimeout(250);
 ok('Vendeur : ne peut pas annuler',(await g(p,'sv-vente-annuler').count())===0);
 await p.close();}
// ── Achats des services listés
{const dep={type:'dep',id:'d1',date:back(40),kind:'fournitures',label:'Produits',supplier:'Grossiste Nord',amount:900,mode:'apayer',entryId:'x',status:'valide',settlements:[]};
 const {p}=await boot(b,{settings:{companyName:'A',currency:'HTG'},primary:true,cats:{services:[dep,{type:'config',id:'cf',svType:'nettoyage'}]},pageInit:mk(['services'],'Administrateur')});await p.waitForTimeout(1500);
 await g(p,'nav-rang-achat').click();await p.waitForTimeout(900);
 await p.getByRole('button',{name:'Achats Services'}).click();await p.waitForTimeout(400);
 ok('dépense à payer listée dans Achat et fournisseurs',(await g(p,'ach-metier-ligne').count())>=1&&/Grossiste Nord/.test(await g(p,'ach-metier-ligne').first().innerText()));
 await p.close();}
// ── Sans secteur dédié : le socle Commerce reste l'espace de travail
{const {p}=await boot(b,{settings:{companyName:'A',currency:'HTG'},primary:true,cats:{},pageInit:mk([],'Administrateur')});await p.waitForTimeout(1500);
 ok('sans secteur : pas d\'espace Services, le socle Commerce est là',(await g(p,'services-module').count())===0&&(await g(p,'nav-rang-vente').count())>=1);
 await p.close();}
// ── Mention de précision sur les états et la clôture
{const {p}=await boot(b,{settings:{companyName:'A',currency:'HTG'},primary:true,cats:{},pageInit:mk([],'Administrateur')});await p.waitForTimeout(1500);
 await g(p,'nav-rang-rapports').click();await p.waitForTimeout(900);
 ok('Rapports : la mention « ne remplace pas un expert-comptable » est affichée',(await g(p,'mention-expert-rapports').count())===1&&/ne remplace ni un cabinet comptable ni un expert-comptable/.test(await g(p,'mention-expert-rapports').innerText()));
 await p.close();}
await b.close();console.log(fails?('ÉCHECS '+fails):'TOUT PASSE');process.exit(fails?1:0)})();

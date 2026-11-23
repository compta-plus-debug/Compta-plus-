// v303 — numérotation de la barre latérale par rang ; Industries : catalogue, stock dès l'ajout, texte libre limité, alerte sous le coût ; achats des métiers visibles dans Achat et fournisseurs.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const iso=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const today=iso(new Date());
const S='[\\s\\u202f\\u00a0]?';const re=(a,b)=>new RegExp(a+S+b);
const mk=(sec,role)=>new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors="+JSON.stringify(sec)+";S.tables.companies[0].sectors_locked="+(sec.length>0)+";S.tables.company_members[0].role="+JSON.stringify(role)+";})()");
const rang=async(p,id)=>(await g(p,'nav-rang-'+id).innerText()).trim();
const cat=(p,c)=>p.evaluate((c)=>window.__srv.getCat(c)||[],c);
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// 1. numérotation — espace BTP
{const dep={type:'dep',id:'d1',date:today,siteId:'s1',kind:'materiaux',supplier:'Quincaillerie X',label:'Ciment',amount:3000,mode:'apayer',status:'valide',settlements:[],entryId:'e1'};
 const {p}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,cats:{btp:[{type:'site',id:'s1',name:'Villa',status:'encours',lines:[]},dep]},pageInit:mk(['btp'],'Administrateur')});await p.waitForTimeout(1500);
 const r={};for(const id of ['btp','caisse','achat','rh','compta','rapports','gestion','admin'])r[id]=await rang(p,id);
 ok('espace BTP : métier 1, caisse 2, dépenses et fournisseurs 3, salaires 4, comptabilité 5, rapports 6, gestion 7, administration 8',JSON.stringify(r)===JSON.stringify({btp:'1',caisse:'2',achat:'3',rh:'4',compta:'5',rapports:'6',gestion:'7',admin:'8'}),r);
 await g(p,'nav-rang-achat').click();await p.waitForTimeout(900);
 ok('en-tête du module Achat : « Module 3 » comme dans la barre',/Module 3/.test(await p.locator('body').innerText()));
 // achats des métiers
 await p.getByRole('button',{name:'Achats BTP'}).click();await p.waitForTimeout(400);
 ok('la dépense BTP apparaît dans Achat et fournisseurs',(await g(p,'ach-metier-ligne').count())===1&&/Quincaillerie X/.test(await g(p,'ach-metier-ligne').innerText())&&/BTP/.test(await g(p,'ach-metier-ligne').innerText()));
 ok('reste à payer 3 000',re('3','000').test(await g(p,'ach-metiers-reste').innerText()),await g(p,'ach-metiers-reste').innerText());
 await p.getByRole('button',{name:'Fournisseurs',exact:true}).click();await p.waitForTimeout(500);
 ok('le fournisseur rejoint la liste commune avec sa dette',/Quincaillerie X/.test(await p.locator('body').innerText())&&re('3','000').test(await p.locator('tr:has-text("Quincaillerie X") [data-testid="ach-four-du"]').innerText()),await g(p,'ach-four-du').count());
 ok('fournisseur enregistré une seule fois',(await cat(p,'suppliers')).filter(x=>x.name==='Quincaillerie X').length===1,(await cat(p,'suppliers')).map(x=>x.name));
 await p.close();}
// numérotation — commerce inchangé
{const {p}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,cats:{},pageInit:mk([],'Administrateur')});await p.waitForTimeout(1500);
 ok('commerce : comptabilité 1, achat 4',(await rang(p,'compta'))==='1'&&(await rang(p,'achat'))==='4',[await rang(p,'compta'),await rang(p,'achat')]);
 await p.close();}
// 2-3. Industries
{const seed=[{type:'mat',id:'m1',name:'Farine',unit:'kg',min:0,active:true},
 {type:'achat',id:'a1',date:today,matId:'m1',qty:100,amount:1000,supplier:'Moulin A',mode:'caisse',entryId:'x',status:'valide',settlements:[]},
 {type:'prod',id:'p1',name:'Pain',unit:'pièce',price:25,active:true},{type:'prod',id:'p2',name:'Gâteau',unit:'pièce',price:100,active:true},{type:'prod',id:'p3',name:'Biscuit',unit:'pièce',price:5,active:true},
 {type:'lot',id:'l1',number:'LT-1',date:today,productId:'p1',label:'',qty:10,lines:[{matId:'m1',qty:10,pu:10,cost:100}],hours:0,rate:0,frais:0,expire:'',orderId:'',notes:'',status:'valide'},
 {type:'lot',id:'l2',number:'LT-2',date:today,productId:'p2',label:'',qty:2,lines:[{matId:'m1',qty:20,pu:10,cost:200}],hours:0,rate:0,frais:0,expire:'',orderId:'',notes:'',status:'valide'}];
 const {p}=await boot(b,{settings:{companyName:'Atelier',currency:'HTG'},primary:true,cats:{indus:seed},pageInit:mk(['industrie'],'Administrateur')});await p.waitForTimeout(1500);
 await g(p,'in-tab-ventes').click();await p.waitForTimeout(400);
 ok('catalogue de vente en cartes : 3 produits, rupture signalée pour le produit sans lot',(await g(p,'in-cat-carte').count())===3&&/Rupture/.test(await g(p,'in-vte-catalogue').innerText()));
 await g(p,'in-vte-ajouter-ligne').click();await p.waitForTimeout(250);
 ok('ligne sans produit ni « service » refusée',(await g(p,'in-vte-lignebrouillon').count())===0);
 await g(p,'in-vte-produit').selectOption('__service');await g(p,'in-vte-designation').fill('Livraison');await g(p,'in-vte-qte').fill('1');await g(p,'in-vte-pu').fill('50');await g(p,'in-vte-ajouter-ligne').click();await p.waitForTimeout(250);
 ok('service hors stock accepté',(await g(p,'in-vte-lignebrouillon').count())===1);
 await g(p,'in-vte-produit').selectOption('p1');await g(p,'in-vte-qte').fill('11');await g(p,'in-vte-ajouter-ligne').click();await p.waitForTimeout(250);
 ok('quantité supérieure au stock (10) refusée dès l\'ajout',(await g(p,'in-vte-lignebrouillon').count())===1);
 await g(p,'in-vte-qte').fill('4');await g(p,'in-vte-pu').fill('5');await g(p,'in-vte-ajouter-ligne').click();await p.waitForTimeout(250);
 ok('prix 5 sous le coût 10 : alerte, ligne pas encore ajoutée',(await g(p,'in-vte-perte').count())===1&&(await g(p,'in-vte-lignebrouillon').count())===1&&/10/.test(await g(p,'in-vte-perte').innerText()),await g(p,'in-vte-perte').count());
 await g(p,'in-vte-perte-confirmer').click();await p.waitForTimeout(250);
 ok('confirmation sans raison refusée',(await g(p,'in-vte-lignebrouillon').count())===1&&(await g(p,'in-vte-perte').count())===1);
 await g(p,'in-perte-motif').selectOption('destockage');await g(p,'in-vte-perte-confirmer').click();await p.waitForTimeout(250);
 ok('confirmation : ligne ajoutée, alerte fermée',(await g(p,'in-vte-lignebrouillon').count())===2&&(await g(p,'in-vte-perte').count())===0);
 await g(p,'in-vte-produit').selectOption('p1');await g(p,'in-vte-qte').fill('7');await g(p,'in-vte-pu').fill('25');await g(p,'in-vte-ajouter-ligne').click();await p.waitForTimeout(250);
 ok('4 déjà dans la facture + 7 > 10 : refusé (cumul des lignes)',(await g(p,'in-vte-lignebrouillon').count())===2);
 await g(p,'in-vte-produit').selectOption('p2');await g(p,'in-vte-qte').fill('1');await g(p,'in-vte-pu').fill('100');await g(p,'in-vte-ajouter-ligne').click();await p.waitForTimeout(250);
 ok('prix égal au coût : pas d\'alerte',(await g(p,'in-vte-perte').count())===0&&(await g(p,'in-vte-lignebrouillon').count())===3);
 await g(p,'in-vte-emettre').click();await p.waitForTimeout(500);
 const f=(await cat(p,'indus')).find(r=>r.type==='fact');
 ok('facture émise avec drapeaux : 1 ligne à perte, 1 service',f&&f.lines.filter(l=>l.perte).length===1&&f.lines.filter(l=>l.service).length===1,f&&f.lines);
 await g(p,'in-tab-rapports').click();await p.waitForTimeout(500);
 ok('rapport « Ventes sous le coût » : 1 ligne, perte 20, raison indiquée',(await g(p,'in-rap-perte-ligne').count())===1&&re('20','').test(await g(p,'in-rap-perte-total').innerText())&&/Déstockage/.test(await g(p,'in-rap-perte-motif').innerText()),await g(p,'in-rap-perte-motif').innerText());
 await g(p,'in-tab-apercu').click();await p.waitForTimeout(500);
 ok('« À faire » signale la vente à perte',/Ventes à perte/.test(await p.locator('body').innerText()));
 await p.close();}
// 4. commande dont le coût de revient dépasse le montant facturé
{const seed=[{type:'mat',id:'m1',name:'Farine',unit:'kg',min:0,active:true},{type:'client',id:'c1',name:'Mme Paul',phone:'',address:''},
 {type:'achat',id:'a1',date:today,matId:'m1',qty:100,amount:1000,supplier:'',mode:'caisse',entryId:'x',status:'valide',settlements:[]},
 {type:'cmd',id:'o1',number:'CD-1',date:today,clientId:'c1',kind:'surmesure',subject:'Buffet',lines:[{id:'k1',label:'Buffet',productId:'',unit:'forfait',qty:1,pu:500}],due:'',status:'confirmee',specs:'',acomptes:[],factId:''},
 {type:'lot',id:'l1',number:'LT-1',date:today,productId:'',label:'Buffet',qty:1,lines:[{matId:'m1',qty:50,pu:10,cost:500}],hours:10,rate:50,frais:0,expire:'',orderId:'o1',notes:'',status:'valide'}];
 const {p}=await boot(b,{settings:{companyName:'Atelier',currency:'HTG'},primary:true,cats:{indus:seed},pageInit:mk(['industrie'],'Administrateur')});await p.waitForTimeout(1500);
 await g(p,'in-tab-commandes').click();await p.waitForTimeout(400);
 await g(p,'in-cmd-ouvrir').first().click();await p.waitForTimeout(300);
 await g(p,'in-cmd-facturer').click();await p.waitForTimeout(400);
 ok('coût 1 000 > 500 facturés : première demande refusée, bouton change',(await cat(p,'indus')).filter(r=>r.type==='fact').length===0&&/quand même/.test(await g(p,'in-cmd-facturer').innerText()));
 await g(p,'in-cmd-facturer').click();await p.waitForTimeout(400);
 ok('seconde demande sans raison : refusée',(await cat(p,'indus')).filter(r=>r.type==='fact').length===0);
 await g(p,'in-cmd-fact-motif').selectOption('geste');await g(p,'in-cmd-facturer').click();await p.waitForTimeout(500);
 ok('avec une raison : facture émise',(await cat(p,'indus')).filter(r=>r.type==='fact').length===1);
 await p.close();}
// 5. Catalogue illustré, redressement du prix, rôle Vendeur
{const seed=[{type:'mat',id:'m1',name:'Farine',unit:'kg',min:0,active:true},
 {type:'achat',id:'a1',date:today,matId:'m1',qty:100,amount:1000,supplier:'',mode:'caisse',entryId:'x',status:'valide',settlements:[]},
 {type:'prod',id:'p1',name:'Pain',unit:'pièce',price:25,cat:'alimentaire',desc:'Pain frais',active:true},{type:'prod',id:'p2',name:'Table',unit:'pièce',price:900,cat:'bois',active:true},{type:'prod',id:'p4',name:'Savon',unit:'pièce',price:8,cat:'entretien',active:true},
 {type:'lot',id:'l1',number:'LT-1',date:today,productId:'p1',label:'',qty:10,lines:[{matId:'m1',qty:10,pu:10,cost:100}],hours:0,rate:0,frais:0,expire:'',orderId:'',notes:'',status:'valide'},
 {type:'lot',id:'l2',number:'LT-2',date:today,productId:'p2',label:'',qty:2,lines:[{matId:'m1',qty:20,pu:10,cost:200}],hours:0,rate:0,frais:0,expire:'',orderId:'',notes:'',status:'valide'},
 {type:'lot',id:'l4',number:'LT-3',date:today,productId:'p4',label:'',qty:10,lines:[{matId:'m1',qty:10,pu:10,cost:100}],hours:0,rate:0,frais:0,expire:'',orderId:'',notes:'',status:'valide'}];
 const {p}=await boot(b,{settings:{companyName:'Atelier',currency:'HTG'},primary:true,cats:{indus:seed},pageInit:mk(['industrie'],'Administrateur')});await p.waitForTimeout(1500);
 await g(p,'in-tab-catalogue').click();await p.waitForTimeout(400);
 ok('onglet Catalogue : 3 catégories en cartes',(await g(p,'in-cat-groupe').count())===3&&(await g(p,'in-cat-carte').count())===3);
 ok('carte avec description, prix et stock',/Pain frais/.test(await p.locator('[data-testid="in-cat-carte"]:has-text("Pain")').innerText())&&/10 pièce disponibles/.test(await p.locator('[data-testid="in-cat-carte"]:has-text("Pain")').innerText()));
 ok('carte « Savon » signale le prix sous le coût',/prix sous le coût/.test(await p.locator('[data-testid="in-cat-carte"]:has-text("Savon")').innerText()));
 await g(p,'in-cat-nom').fill('Savons artisanaux');await g(p,'in-cat-ajouter').click();await p.waitForTimeout(300);
 ok('catégorie personnalisée ajoutée (sans produit : pas de groupe vide)',(await cat(p,'indus')).some(r=>r.type==='cat'&&r.label==='Savons artisanaux')&&(await g(p,'in-cat-groupe').count())===3);
 await g(p,'in-catalogue-apercu').click();await p.waitForTimeout(500);
 ok('aperçu client : feuille avec les produits, sans coût',(await g(p,'in-catalogue-feuille').count())>=1&&/Pain/.test(await g(p,'in-catalogue-feuille').first().innerText())&&!/coût/.test(await g(p,'in-catalogue-feuille').first().innerText()));
 await g(p,'in-imprimer-ok').count();await p.keyboard.press('Escape');
 const fermer=p.getByRole('button',{name:/Fermer/});if(await fermer.count())await fermer.first().click();await p.waitForTimeout(300);
 // retirer du catalogue
 if(!(await g(p,'in-tab-catalogue').count()))await p.reload();
 await g(p,'in-tab-catalogue').click();await p.waitForTimeout(300);
 await p.locator('[data-testid="in-cat-carte"]:has-text("Table") [data-testid="in-cat-retirer"]').click();await p.waitForTimeout(300);
 await g(p,'in-tab-ventes').click();await p.waitForTimeout(400);
 ok('produit retiré : absent des cartes de vente',(await g(p,'in-cat-carte').count())===2);
 // vente rapide « + 1 »
 await p.locator('[data-testid="in-cat-carte"]:has-text("Pain") [data-testid="in-cat-plus1"]').click();await p.waitForTimeout(300);
 ok('« + 1 » ajoute 1 pain au prix du catalogue',(await g(p,'in-vte-lignebrouillon').count())===1&&/25/.test(await g(p,'in-vte-lignebrouillon').first().innerText()));
 await p.locator('[data-testid="in-cat-carte"]:has-text("Savon") [data-testid="in-cat-plus1"]').click();await p.waitForTimeout(300);
 ok('« + 1 » sur un produit au prix sous le coût : alerte, pas d\'ajout',(await g(p,'in-vte-perte').count())===1&&(await g(p,'in-vte-lignebrouillon').count())===1);
 await g(p,'in-vte-perte-prixrevient').click();await p.waitForTimeout(300);
 ok('« prix de revient » met 10 dans le formulaire',(await g(p,'in-vte-pu').inputValue())==='10');
 // redressement du prix
 await g(p,'in-tab-produits').click();await p.waitForTimeout(300);
 await p.locator('[data-testid="in-prod-ligne"]:has-text("Savon") [data-testid="in-prod-ouvrir"]').click();await p.waitForTimeout(300);
 ok('bloc de redressement : perte signalée',/perte de/.test(await g(p,'in-prod-redress').innerText()));
 await g(p,'in-prod-redress-prix').fill('14');await g(p,'in-prod-redress-ok').click();await p.waitForTimeout(300);
 ok('prix redressé à 14',(await cat(p,'indus')).find(r=>r.id==='p4').price===14);
 await g(p,'in-tab-apercu').click();await p.waitForTimeout(400);
 ok('plus de rappel « prix sous le coût » après redressement',!/Prix du catalogue/.test(await p.locator('body').innerText()));
 await p.close();}
{const seed=[{type:'mat',id:'m1',name:'Farine',unit:'kg',min:0,active:true},{type:'achat',id:'a1',date:today,matId:'m1',qty:100,amount:1000,supplier:'',mode:'caisse',entryId:'x',status:'valide',settlements:[]},
 {type:'prod',id:'p4',name:'Savon',unit:'pièce',price:8,cat:'entretien',active:true},{type:'lot',id:'l4',number:'LT-3',date:today,productId:'p4',label:'',qty:10,lines:[{matId:'m1',qty:10,pu:10,cost:100}],hours:0,rate:0,frais:0,expire:'',orderId:'',notes:'',status:'valide'}];
 const {p}=await boot(b,{settings:{companyName:'Atelier',currency:'HTG'},primary:true,cats:{indus:seed},pageInit:mk(['industrie'],'Vendeur')});await p.waitForTimeout(1500);
 await g(p,'in-tab-ventes').click();await p.waitForTimeout(400);
 await p.locator('[data-testid="in-cat-carte"]:has-text("Savon") [data-testid="in-cat-plus1"]').click();await p.waitForTimeout(300);
 ok('Vendeur : alerte sans bouton de confirmation (gestionnaire requis)',(await g(p,'in-vte-perte').count())===1&&(await g(p,'in-vte-perte-confirmer').count())===0&&(await g(p,'in-perte-gestionnaire').count())===1);
 await p.close();}
// 6. Transport et Immobilier : fournisseur, règlement, visibilité dans Achat et fournisseurs
for(const [sec,pre,tabId,seedRow,label] of [['transport','tr','depenses',{type:'vehicle',id:'v1',plate:'AA-1234',kind:'Camion',model:'',capacity:'',odometer:0,active:true},'Transport'],['immobilier','im','depenses',{type:'property',id:'b1',name:'Immeuble A',kind:'Immeuble',address:'',notes:'',active:true},'Immobilier']]){
 const key=sec==='transport'?'transport':'immo';
 const {p}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,cats:{[key]:[seedRow]},pageInit:mk([sec],'Administrateur')});await p.waitForTimeout(1500);
 await g(p,pre+'-tab-'+tabId).click();await p.waitForTimeout(400);
 await g(p,pre+'-dep-'+(sec==='transport'?'vehicule':'bien')).selectOption(sec==='transport'?'v1':'b1');
 await p.locator('[data-testid="'+pre+'-nouvelle-depense"] select').nth(2).selectOption('apayer');
 await g(p,pre+'-dep-montant').fill('3000');await g(p,pre+'-dep-valider').click();await p.waitForTimeout(400);
 ok(label+' : dette sans fournisseur refusée',(await g(p,pre+'-dep-ligne').count())===0);
 await g(p,pre+'-dep-fournisseur').fill('Garage Z');await g(p,pre+'-dep-valider').click();await p.waitForTimeout(500);
 ok(label+' : dette enregistrée avec fournisseur',(await g(p,pre+'-dep-ligne').count())===1&&/Garage Z/.test(await g(p,pre+'-dep-ligne').innerText())&&/À payer/.test(await g(p,pre+'-dep-ligne').innerText()));
 await g(p,pre+'-dep-ouvrir').click();await p.waitForTimeout(300);
 await g(p,pre+'-reg-montant').fill('1000');await g(p,pre+'-reg-valider').click();await p.waitForTimeout(500);
 ok(label+' : règlement partiel, reste 2 000',re('2','000').test(await g(p,pre+'-dep-reste').innerText()),await g(p,pre+'-dep-reste').innerText());
 const ents=(await cat(p,'entries')).flatMap(x=>x.lines);const b401=ents.filter(l=>l.account==='401').reduce((t,l)=>t+l.credit-l.debit,0);
 ok(label+' : compte 401 = 2 000 dus',Math.abs(b401-2000)<.01,b401);
 await g(p,'nav-rang-achat').click();await p.waitForTimeout(900);
 await p.getByRole('button',{name:'Achats '+label}).click();await p.waitForTimeout(400);
 ok(label+' : visible dans « Achat et fournisseurs » (reste 2 000)',(await g(p,'ach-metier-ligne').count())===1&&re('2','000').test(await g(p,'ach-metiers-reste').innerText()),await g(p,'ach-metiers-reste').innerText());
 await p.close();}
// 7. onglet des métiers masqué dans un espace sans achats propres
{const {p}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,cats:{btp:[{type:'site',id:'s1',name:'Villa',status:'encours',lines:[]},{type:'dep',id:'d1',date:today,siteId:'s1',kind:'materiaux',supplier:'Q',label:'Ciment',amount:100,mode:'apayer',status:'valide',settlements:[],entryId:'e1'}]},pageInit:mk(['restauration'],'Administrateur')});await p.waitForTimeout(1500);
 await g(p,'nav-rang-achat').click();await p.waitForTimeout(900);
 ok('espace Restauration : pas d\'onglet « Achats » des autres métiers',(await p.getByRole('button',{name:/^Achats (BTP|des métiers|Industries|Transport|Immobilier)/}).count())===0);
 await p.close();}
// 8. Gestion avancée : outils du commerce masqués dans les espaces de métier, présents en commerce
for(const [sec,att] of [[['btp'],false],[[],true]]){
 const {p}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,cats:{},pageInit:mk(sec,'Administrateur')});await p.waitForTimeout(1500);
 await g(p,'nav-rang-gestion').click();await p.waitForTimeout(900);
 const t=await p.locator('body').innerText();
 ok((att?'commerce':'BTP')+' : « Devis & commandes » / « Import POS » '+(att?'présents':'masqués')+', « Échéances » toujours là',(/Devis & commandes/.test(t)&&/Import POS/.test(t))===att&&/Échéances/.test(t));
 await p.close();}
await b.close();console.log(fails?('ÉCHECS '+fails):'TOUT PASSE');process.exit(fails?1:0)})();

// v265 — bloc Import-export : dossier d'importation (coût de revient, frais, TCA, change), stock, exportation, droits des rôles.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const base={companyName:'Import Test',currency:'HTG'};
const mk=(role,sect)=>new Function("(function(){const S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors="+JSON.stringify(sect)+";S.tables.companies[0].sectors_locked=true;S.tables.company_members[0].role="+JSON.stringify(role)+";try{sessionStorage.clear();localStorage.removeItem('compta-plus-espace')}catch(e){}})();");
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const tab=async(p,id)=>{await g(p,'ie-tab-'+id).click();await p.waitForTimeout(300)};
const cat=(p,c)=>p.evaluate((c)=>window.__srv.getCat(c)||[],c);
const sum=(e,acc)=>e.reduce((s,x)=>s+x.lines.filter(l=>l.account===acc).reduce((a,l)=>a+l.debit-l.credit,0),0);
const num=async(p,t)=>{const s=(await g(p,t).innerText());return s};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p,errs}=await boot(b,{settings:base,primary:true,pageInit:mk('Administrateur',['import_export'])});await p.waitForTimeout(1200);
 ok('espace import-export ouvert par défaut',(await g(p,'importexport-module').count())===1);
 ok('sélecteur d\'espace avec Import-export et Commerce',(await g(p,'espace-impex').count())===1&&(await g(p,'espace-commerce').count())===1&&(await g(p,'espace-ecole').count())===0);
 await tab(p,'imports');
 await g(p,'ie-imp-fournisseur').fill('Acme Miami');await g(p,'ie-imp-taux').fill('130');await g(p,'ie-imp-creer').click();await p.waitForTimeout(500);
 ok('dossier IMP créé et ouvert',(await g(p,'ie-imp-detail').count())===1&&/IMP-\d{4}-001/.test(await g(p,'ie-imp-detail').innerText()));
 await g(p,'ie-imp-ligne-produit').selectOption({label:'Riz'});await g(p,'ie-imp-ligne-qte').fill('100');await g(p,'ie-imp-ligne-prix').fill('2');await g(p,'ie-imp-ligne-ajouter').click();await p.waitForTimeout(300);
 await g(p,'ie-imp-fret').fill('20');await p.waitForTimeout(300);
 const tot=(await num(p,'ie-imp-total')).replace(/\s/g,'');ok('total facture 220 USD = 28600 G',/220,00USD=28/.test(tot)&&/600/.test(tot),tot);
 ok('estimation des droits 2860 et TCA 3289',/2.?860/.test((await num(p,'ie-est-duty')).replace(/\s/g,''))&&/3.?289/.test((await num(p,'ie-est-tca')).replace(/\s/g,'')),[await num(p,'ie-est-duty'),await num(p,'ie-est-tca')]);
 await g(p,'ie-imp-comptabiliser').click();await p.waitForTimeout(600);
 let e=await cat(p,'entries');const ie=e.filter(x=>x.kind==='impex');
 ok('facture : 607=26000, 608=2600, 401=-28600',Math.abs(sum(ie,'607')-26000)<.01&&Math.abs(sum(ie,'608')-2600)<.01&&Math.abs(sum(ie,'401')+28600)<.01,[sum(ie,'607'),sum(ie,'608'),sum(ie,'401')]);
 // frais : droits 2860 en caisse
 await g(p,'ie-frais-nature').selectOption('duty');await g(p,'ie-frais-montant').fill('2860');await g(p,'ie-frais-mode').selectOption('caisse');await g(p,'ie-frais-ajouter').click();await p.waitForTimeout(500);
 // TCA 3289 banque
 await g(p,'ie-frais-nature').selectOption('tca');await g(p,'ie-frais-montant').fill('3289');await g(p,'ie-frais-mode').selectOption('banque');await g(p,'ie-frais-ajouter').click();await p.waitForTimeout(500);
 const rev=(await num(p,'ie-imp-revient')).replace(/\s/g,'');ok('coût de revient = 31460 (la TCA récupérable en est exclue)',/31.?460/.test(rev),rev);
 e=await cat(p,'entries');const ie2=e.filter(x=>x.kind==='impex');
 ok('droits en 608 (+2860), TCA en 4456 = 3289, caisse -2860, banque -3289',Math.abs(sum(ie2,'608')-5460)<.01&&Math.abs(sum(ie2,'4456')-3289)<.01&&Math.abs(sum(ie2,'530')+2860)<.01&&Math.abs(sum(ie2,'512')+3289)<.01,[sum(ie2,'608'),sum(ie2,'4456'),sum(ie2,'530'),sum(ie2,'512')]);
 // règlement 220 USD à 135
 await g(p,'ie-paie-usd').fill('220');await g(p,'ie-paie-taux').fill('135');await g(p,'ie-paie-valider').click();await p.waitForTimeout(600);
 e=await cat(p,'entries');const ie3=e.filter(x=>x.kind==='impex');
 ok('règlement : 401 soldé, banque -29700 -3289, perte de change 666 = 1100',Math.abs(sum(ie3,'401'))<.01&&Math.abs(sum(ie3,'666')-1100)<.01,[sum(ie3,'401'),sum(ie3,'666')]);
 ok('toutes les écritures équilibrées',ie3.every(x=>Math.abs(x.lines.reduce((s,l)=>s+l.debit-l.credit,0))<.005));
 ok('reste dû nul',/0,00/.test(await num(p,'ie-imp-reste')),await num(p,'ie-imp-reste'));
 // annulation du frais de droits : écriture inverse
 await g(p,'ie-imp-frais-annuler').first().click();await p.waitForTimeout(600);
 e=await cat(p,'entries');const ie4=e.filter(x=>x.kind==='impex');
 ok('annulation du frais : écriture inverse (608 revient à 2600)',Math.abs(sum(ie4,'608')-2600)<.01&&ie4.length===ie3.length+1,[sum(ie4,'608'),ie4.length]);
 await p.screenshot({path:'/tmp/ie-detail.png'}).catch(()=>{});
 // réception en stock
 await g(p,'ie-imp-stock').click();await p.waitForTimeout(600);
 const pr=(await cat(p,'products')).find(x=>x.code==='R1');const mv=await cat(p,'movements');
 ok('stock Riz 110 et un mouvement d\'entrée',pr&&pr.stock===110&&mv.some(m=>m.type==='entree'&&m.qty===100),[pr&&pr.stock,mv.length]);
 ok('coût moyen pondéré recalculé (≈ 250,91 : (10×60 + 100×coût de revient)/110)',pr&&pr.costPrice>200&&pr.costPrice<300,pr&&pr.costPrice);
 ok('bouton réception disparu',(await g(p,'ie-imp-stock').count())===0&&(await g(p,'ie-imp-recu-stock').count())===1);
 // exportation
 await tab(p,'exports');
 await g(p,'ie-exp-client').fill('Cliente Miami');await g(p,'ie-exp-taux').fill('130');await g(p,'ie-exp-creer').click();await p.waitForTimeout(500);
 await g(p,'ie-exp-ligne-produit').selectOption({label:'Riz'});await g(p,'ie-exp-ligne-qte').fill('5');await g(p,'ie-exp-ligne-prix').fill('10');await g(p,'ie-exp-ligne-ajouter').click();await p.waitForTimeout(300);
 await g(p,'ie-exp-comptabiliser').click();await p.waitForTimeout(600);
 e=await cat(p,'entries');let ix=e.filter(x=>x.kind==='impex'&&/Exportation/.test(x.label));
 ok('facture export : 411 +6500, 707 -6500',Math.abs(sum(ix,'411')-6500)<.01&&Math.abs(sum(ix,'707')+6500)<.01,[sum(ix,'411'),sum(ix,'707')]);
 await g(p,'ie-expfrais-montant').fill('300');await g(p,'ie-expfrais-ajouter').click();await p.waitForTimeout(500);
 await g(p,'ie-enc-usd').fill('50');await g(p,'ie-enc-taux').fill('128');await g(p,'ie-enc-valider').click();await p.waitForTimeout(600);
 e=await cat(p,'entries');ix=e.filter(x=>x.kind==='impex'&&/Exportation/.test(x.label));
 ok('encaissement : 411 soldé, perte de change 100, frais 624 = 300',Math.abs(sum(ix,'411'))<.01&&Math.abs(sum(ix,'666')-100)<.01&&Math.abs(sum(ix,'624')-300)<.01,[sum(ix,'411'),sum(ix,'666'),sum(ix,'624')]);
 await g(p,'ie-exp-stock').click();await p.waitForTimeout(600);
 const pr2=(await cat(p,'products')).find(x=>x.code==='R1');
 ok('sortie du stock : 105',pr2.stock===105,pr2.stock);
 await tab(p,'rapports');
 ok('rapports : une ligne par dossier',(await g(p,'ie-rapport-imp').count())===1&&(await g(p,'ie-rapport-exp').count())===1);
 await tab(p,'reglages');await g(p,'ie-reglage-duty').fill('12');await g(p,'ie-reglage-enregistrer').click();await p.waitForTimeout(500);
 ok('réglage enregistré',(await cat(p,'impex')).some(x=>x.type==='config'&&x.rates.duty===12));
 ok('aucune erreur de page',errs.length===0,errs.slice(0,3));await p.close();}
{const {p}=await boot(b,{settings:base,primary:false,pageInit:mk('Lecture seule',['import_export'])});await p.waitForTimeout(1200);
 await tab(p,'imports');ok('consultant : pas de création de dossier',(await g(p,'ie-imp-creer').count())===0);await p.close();}
{const {p}=await boot(b,{settings:base,primary:false,pageInit:mk('Vendeur',['import_export'])});await p.waitForTimeout(1200);
 ok('vendeur : pas de module Import-export',(await g(p,'importexport-module').count())===0);await p.close();}
{const {p}=await boot(b,{settings:base,primary:false,pageInit:mk('Administrateur',['commerce'])});await p.waitForTimeout(1000);
 ok('sans le secteur : aucun module ni sélecteur',(await g(p,'importexport-module').count())===0&&(await g(p,'espace-impex').count())===0);await p.close();}
await b.close();console.log('fails='+fails);process.exit(fails?1:0);})();

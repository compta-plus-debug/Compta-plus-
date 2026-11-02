// v310 — bloc ONG, associations, églises : type d'organisation, fonds, dons et reçus numérotés, dépassement avec justification,
// virements, clôture, membres et cotisations, rapports, impressions, achats listés, assistant, rôle Vendeur.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const iso=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const today=iso(new Date());const yr=new Date().getFullYear();const janv=today.slice(5,7)==='01';
const back=(n)=>{const d=new Date();d.setDate(d.getDate()-n);return iso(d)};
const S='[\\s\\u202f\\u00a0]?';const re=(a,b)=>new RegExp(a+S+b);
const mk=(sec,role)=>new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors="+JSON.stringify(sec)+";S.tables.companies[0].sectors_locked="+(sec.length>0)+";S.tables.company_members[0].role="+JSON.stringify(role)+";})()");
const cat=(p,c)=>p.evaluate((c)=>window.__srv.getCat(c)||[],c);
const seed=()=>[
 {type:'contact',id:'c1',name:'UNICEF Haïti',kind:'bailleur',phone:'',email:'',address:'Port-au-Prince'},
 {type:'membre',id:'m1',number:'MB-'+(yr-1)+'-0001',name:'Marie Joseph',phone:'',address:'',joined:(yr-1)+'-01-01',cotis:500,period:'annuelle',status:'actif'}];
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p}=await boot(b,{settings:{companyName:'Association Espoir',currency:'HTG'},primary:true,cats:{ong:seed()},pageInit:mk(['ong'],'Administrateur')});
await p.waitForTimeout(1600);
 ok('espace ONG ouvert avec ses onglets',(await g(p,'ong-module').count())===1&&(await g(p,'og-tab-fonds').count())===1&&(await g(p,'og-tab-dons').count())===1&&(await g(p,'og-tab-rapports').count())===1);
 ok('carte « type d\'organisation » proposée au départ',(await g(p,'og-type-carte').count())===1);
 ok('guide de démarrage : 7 étapes',(await g(p,'og-guide').count())===1&&(await g(p,'og-etape').count())===7,await g(p,'og-etape').count());
 await g(p,'og-type-ong').click();await p.waitForTimeout(400);
 ok('type choisi : la carte disparaît, le type est mémorisé',(await g(p,'og-type-carte').count())===0&&(await cat(p,'ong')).some(r=>r.type==='config'&&r.orgType==='ong'));
 // ── Fonds
 await g(p,'og-tab-fonds').click();await p.waitForTimeout(300);
 await g(p,'og-fonds-nom').fill('Projet eau');await g(p,'og-fonds-budget').fill('1000');await g(p,'og-fonds-bailleur').selectOption('c1');await g(p,'og-fonds-creer').click();await p.waitForTimeout(350);
 ok('fonds créé avec numéro et budget',(await cat(p,'ong')).filter(r=>r.type==='fonds').length===1&&/FD-/.test((await cat(p,'ong')).find(r=>r.type==='fonds').number));
 await g(p,'og-fonds-nom').fill('PROJET EAU');await g(p,'og-fonds-creer').click();await p.waitForTimeout(300);
 ok('doublon de fonds refusé (même nom en majuscules)',(await cat(p,'ong')).filter(r=>r.type==='fonds').length===1);
 await g(p,'og-fonds-nom').fill('Salle communautaire');await g(p,'og-fonds-creer').click();await p.waitForTimeout(300);
 ok('deuxième fonds créé',(await cat(p,'ong')).filter(r=>r.type==='fonds').length===2);
 // ── Dons
 await g(p,'og-tab-dons').click();await p.waitForTimeout(300);
 const noms=await g(p,'og-don-nature').locator('option').allInnerTexts();
 ok('ONG : la subvention est proposée, pas la dîme',noms.some(x=>/ubvention/.test(x))&&!noms.some(x=>/îme/.test(x)),noms);
 await g(p,'og-don-nature').selectOption('subvention');await g(p,'og-don-donateur').selectOption('c:c1');await g(p,'og-don-fonds').selectOption({index:1});await g(p,'og-don-montant').fill('1200');await g(p,'og-don-mode').selectOption('banque');await g(p,'og-don-enregistrer').click();await p.waitForTimeout(500);
 ok('reçu numéroté RC-année-0001 affiché',/RC-\d{4}-0001/.test(await g(p,'og-recu-feuille').first().innerText()),await g(p,'og-recu-feuille').count());
 ok('le reçu indique le montant en lettres',/mille deux cent/i.test(await g(p,'og-recu-lettres').first().innerText()),await g(p,'og-recu-lettres').first().innerText());
 ok('le reçu précise qu\'il n\'est pas un reçu fiscal sans autorisation',/reçu fiscal/.test(await g(p,'og-recu-feuille').first().innerText()));
 await g(p,'og-apercu-fermer').click();await p.waitForTimeout(300);
 const ent=await cat(p,'entries');const e1=ent.find(e=>(e.lines||[]).some(l=>l.account==='7582'));
 ok('écriture : banque 512 au débit, subventions 7582 au crédit',!!e1&&e1.lines.some(l=>l.account==='512'&&l.debit===1200)&&e1.lines.some(l=>l.account==='7582'&&l.credit===1200),e1);
 await g(p,'og-don-nature').selectOption('don');await g(p,'og-don-fonds').selectOption('');await g(p,'og-don-montant').fill('500');await g(p,'og-don-nomlibre').fill('Un ami');await g(p,'og-don-enregistrer').click();await p.waitForTimeout(450);
 ok('deuxième reçu : numéro 0002, don au fonds général',/RC-\d{4}-0002/.test(await g(p,'og-recu-feuille').first().innerText()));
 await g(p,'og-apercu-fermer').click();await p.waitForTimeout(250);
 await g(p,'og-don-montant').fill('0');await g(p,'og-don-enregistrer').click();await p.waitForTimeout(300);
 ok('montant nul refusé',(await cat(p,'ong')).filter(r=>r.type==='don').length===2);
 // ── Dépenses et dépassement
 await g(p,'og-tab-depenses').click();await p.waitForTimeout(300);
 await g(p,'og-dep-fonds').selectOption({index:1});await g(p,'og-dep-montant').fill('300');await g(p,'og-dep-enregistrer').click();await p.waitForTimeout(400);
 ok('dépense dans le solde : enregistrée sans alerte',(await cat(p,'ong')).filter(r=>r.type==='dep').length===1&&(await g(p,'og-dep-alerte').count())===0);
 await g(p,'og-dep-montant').fill('800');await g(p,'og-dep-enregistrer').click();await p.waitForTimeout(400);
 ok('dépassement du budget : alerte, rien d\'enregistré',(await g(p,'og-dep-alerte').count())===1&&(await cat(p,'ong')).filter(r=>r.type==='dep').length===1);
 await g(p,'og-dep-confirmer').click();await p.waitForTimeout(300);
 ok('sans raison : refusé',(await cat(p,'ong')).filter(r=>r.type==='dep').length===1);
 await g(p,'og-dep-motif').selectOption('accord');await g(p,'og-dep-confirmer').click();await p.waitForTimeout(450);
 const dps=(await cat(p,'ong')).filter(r=>r.type==='dep');
 ok('avec raison : enregistrée et tracée',dps.length===2&&dps.some(d=>d.depassement&&d.depassement.motif==='accord'),dps);
 // dépense à payer sans fournisseur
 await g(p,'og-dep-fonds').selectOption({index:0});await g(p,'og-dep-nature').selectOption('loyer').catch(()=>{});await g(p,'og-dep-mode').selectOption('apayer').catch(()=>{});await g(p,'og-dep-montant').fill('50');await g(p,'og-dep-enregistrer').click();await p.waitForTimeout(300);
 ok('dépense à payer sans fournisseur refusée',(await cat(p,'ong')).filter(r=>r.type==='dep').length===2);
 // ── Virements et clôture
 await g(p,'og-tab-fonds').click();await p.waitForTimeout(300);
 await g(p,'og-vire-de').selectOption('');await g(p,'og-vire-vers').selectOption({index:2});await g(p,'og-vire-montant').fill('900');await g(p,'og-vire-motif').fill('Test');await g(p,'og-vire-ok').click();await p.waitForTimeout(300);
 ok('virement au-delà du disponible refusé',(await cat(p,'ong')).filter(r=>r.type==='vire').length===0);
 await g(p,'og-vire-montant').fill('200');await g(p,'og-vire-motif').fill('');await g(p,'og-vire-ok').click();await p.waitForTimeout(300);
 ok('virement sans raison refusé',(await cat(p,'ong')).filter(r=>r.type==='vire').length===0);
 await g(p,'og-vire-motif').fill('Appui à la salle');await g(p,'og-vire-ok').click();await p.waitForTimeout(400);
 ok('virement enregistré',(await cat(p,'ong')).filter(r=>r.type==='vire').length===1&&(await g(p,'og-vire-ligne').count())===1,(await p.locator('body').innerText()).match(/(Choisissez|Indiquez|Le fonds|Ce fonds)[^\n]*/g));
 if((await g(p,'og-fonds-detail').count())===0){await g(p,'og-fonds-ouvrir').nth(2).click();await p.waitForTimeout(300);}
 await g(p,'og-fonds-cloturer').click();await p.waitForTimeout(300);
 ok('clôture refusée tant que le fonds a un solde',(await cat(p,'ong')).filter(r=>r.type==='fonds'&&r.status==='clos').length===0);
 await g(p,'og-fonds-retirer').click();await p.waitForTimeout(300);
 ok('fonds avec mouvements : retrait refusé',(await cat(p,'ong')).filter(r=>r.type==='fonds').length===2);
 // ── Annulation d'un don
 await g(p,'og-tab-dons').click();await p.waitForTimeout(300);
 await g(p,'og-don-montant').fill('50');await g(p,'og-don-nomlibre').fill('Petit don');await g(p,'og-don-enregistrer').click();await p.waitForTimeout(450);await g(p,'og-apercu-fermer').click();await p.waitForTimeout(250);
 const avant=(await cat(p,'entries')).length;
 await g(p,'og-don-ligne').first().locator('[data-testid="og-don-annuler"]').click();await p.waitForTimeout(450);
 const apres=await cat(p,'entries');
 ok('don annulé : écriture inverse passée et reçu marqué annulé',apres.length===avant+1&&(await cat(p,'ong')).filter(r=>r.type==='don'&&r.status==='annulé').length===1,[avant,apres.length]);
 const dnl=(await cat(p,'ong')).filter(r=>r.type==='don'&&r.fondId&&r.status!=='annulé');
 await g(p,'og-don-ligne').filter({hasText:'RC-'+yr+'-0001'}).locator('[data-testid="og-don-annuler"]').click().catch(()=>{});await p.waitForTimeout(400);
 ok('don dont l\'argent est dépensé : annulation refusée',(await cat(p,'ong')).filter(r=>r.type==='don'&&r.status==='annulé').length===1,dnl.length);
 // ── Membres et cotisations
 await g(p,'og-tab-membres').click();await p.waitForTimeout(300);
 ok('membre seedé listé',(await g(p,'og-membre-ligne').count())===1);
 await g(p,'og-membre-nom').fill('marie joseph');await g(p,'og-membre-ajouter').click();await p.waitForTimeout(300);
 ok('doublon de membre refusé',(await cat(p,'ong')).filter(r=>r.type==='membre').length===1);
 await g(p,'og-membre-cotiser').first().click();await p.waitForTimeout(300);
 await g(p,'og-cotis-enregistrer').click();await p.waitForTimeout(450);
 ok('cotisation : reçu RC- émis, titre « reçu de cotisation »',/REÇU DE COTISATION/.test(await g(p,'og-recu-feuille').first().innerText()));
 await g(p,'og-apercu-fermer').click();await p.waitForTimeout(250);
 const c7=(await cat(p,'entries')).find(e=>(e.lines||[]).some(l=>l.account==='7583'&&l.credit===500));
 ok('écriture de cotisation sur 7583',!!c7,c7);
 if((await g(p,'og-cotis-panneau').count())===0){await g(p,'og-membre-cotiser').first().click();await p.waitForTimeout(300);}
 ok('période payée : plus rien à encaisser, pas de second reçu possible',(await g(p,'og-cotis-enregistrer').count())===0&&/sont payées/.test(await g(p,'og-cotis-panneau').innerText())&&(await cat(p,'ong')).filter(r=>r.type==='don'&&r.kind==='cotisation').length===1,await g(p,'og-cotis-panneau').innerText());
 // ── Rapports
 await g(p,'og-tab-rapports').click();await p.waitForTimeout(400);
 ok('rapport annuel : total des dons valides (1 200 + 500 + 500 cotisation = 2 200)',re('2','200').test(await g(p,'og-rap-annuel-total').innerText()),await g(p,'og-rap-annuel-total').innerText());
 ok('rapport par fonds : 3 lignes (général + 2 projets)',(await g(p,'og-rap-fonds-ligne').count())===3,await g(p,'og-rap-fonds-ligne').count());
 await g(p,'og-rap-annuel-imprimer').click();await p.waitForTimeout(400);
 ok('rapport annuel imprimable',/RAPPORT ANNUEL DES DONS/.test(await g(p,'og-annuel-feuille').first().innerText()));
 await g(p,'og-apercu-fermer').click();await p.waitForTimeout(250);
 await g(p,'og-rap-fonds-imprimer').nth(1).click();await p.waitForTimeout(450);
 const ft=await g(p,'og-fonds-feuille').first().innerText();
 ok('rapport financier du projet : bailleur, budget et dépassement justifié',/UNICEF/.test(ft)&&/dépassement justifié/.test(ft)&&/Solde du fonds/.test(ft),ft.slice(0,300));
 await g(p,'og-apercu-fermer').click();await p.waitForTimeout(250);
 // ── Tableau de bord
 await g(p,'og-tab-apercu').click();await p.waitForTimeout(400);
 ok('tableau de bord : alerte « budget dépassé » dans À faire',/Budget dépassé/.test(await p.locator('body').innerText()));
 ok('guide : étape rapport financier cochée après ouverture du rapport',(await g(p,'og-guide').innerText()).includes('✓'));
 // ── Statistiques
 await g(p,'og-tab-stats').click();await p.waitForTimeout(500);
 ok('statistiques affichées',(await g(p,'og-stat-recu').count())===1);
 await p.close();}
// ── Association : collecte (jamais offrande) ; ONG : pas de dîme ni d'offrande ; vocabulaire propre à chaque type
for(const [typ,att,interdit,titre] of [['association',/ollecte/,/ffrande|îme/,/Dons, collectes et reçus/],['ong',/ubvention/,/ffrande|îme/,/Dons, subventions et reçus/],['fondation',/arrain/,/ffrande|îme/,/Dons, subventions et reçus/],['eglise',/ffrande/,/ubvention/,/Dîmes, offrandes et reçus/]]){
 const {p}=await boot(b,{settings:{companyName:'T',currency:'HTG'},primary:true,cats:{ong:[{type:'config',id:'cf',orgType:typ},...seed()]},pageInit:mk(['ong'],'Administrateur')});await p.waitForTimeout(1500);
 await g(p,'og-tab-dons').click();await p.waitForTimeout(300);
 const nn=(await g(p,'og-don-nature').locator('option').allInnerTexts()).join(' | ');
 const corps=await g(p,'og-don-form').innerText();
 ok(typ+' : natures de recettes adaptées',att.test(nn)&&!interdit.test(nn+' '+corps),nn+' || '+corps.slice(0,90));
 ok(typ+' : onglet et titre de la liste adaptés',titre.test(await g(p,'og-tab-dons').innerText())&&!interdit.test(await g(p,'og-tab-dons').innerText()),await g(p,'og-tab-dons').innerText());
 await g(p,'og-tab-depenses').click();await p.waitForTimeout(250);
 const dn=(await g(p,'og-dep-nature').locator('option').allInnerTexts()).join(' | ');
 ok(typ+' : natures de dépenses adaptées',typ==='eglise'?/Œuvres sociales/.test(dn)&&!/bénéficiaires/.test(dn):typ==='association'?/aux membres/.test(dn):typ==='fondation'?/Bourses/.test(dn):/bénéficiaires/.test(dn),dn);
 await g(p,'og-tab-contacts').click();await p.waitForTimeout(250);
 const sorts=(await g(p,'og-contact-sorte').locator('option').allInnerTexts()).join(' | ');
 ok(typ+' : sortes de donateurs adaptées',typ==='eglise'?!/ailleur/.test(sorts):typ==='association'?/Financeur/.test(sorts):/ailleur/.test(sorts),sorts);
 await p.close();}
// ── Petit écran (360 px) : aucun onglet ni document imprimé ne déborde
{const long={type:'fonds',id:'f1',number:'FD-1',name:"Projet d'adduction d'eau potable et d'assainissement des quartiers de Port-au-Prince 2026",bailleurId:'c1',budget:1500000,start:(yr)+'-01-01',end:(yr)+'-12-31',status:'actif'};
 const {p}=await boot(b,{settings:{companyName:'T',currency:'HTG'},primary:true,cats:{ong:[{type:'config',id:'cf',orgType:'ong'},{type:'contact',id:'c1',name:'Programme des Nations Unies pour le développement Haïti',kind:'bailleur'},long,{type:'don',id:'d1',number:'RC-'+yr+'-0001',date:today,kind:'subvention',donorId:'c1',fondId:'f1',amount:1200000.5,mode:'banque',entryId:'x',status:'valide'},{type:'dep',id:'e1',date:today,kind:'activites',label:'x',supplier:'Fournisseur avec un nom très long SARL',amount:300000,mode:'caisse',fondId:'f1',status:'valide',settlements:[]}]},pageInit:mk(['ong'],'Administrateur')});
 await p.setViewportSize({width:360,height:740});await p.waitForTimeout(1500);
 const larg=()=>p.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}));
 let pire=0;for(const t of ['apercu','fonds','dons','contacts','membres','depenses','rapports','stats']){await g(p,'og-tab-'+t).click();await p.waitForTimeout(350);const w=await larg();pire=Math.max(pire,w.sw-w.cw);}
 ok('360 px : aucun onglet ne déborde',pire<=1,pire);
 await g(p,'og-tab-rapports').click();await p.waitForTimeout(300);
 await g(p,'og-rap-fonds-imprimer').nth(1).click();await p.waitForTimeout(450);
 const ov=await p.evaluate(()=>{const o=document.querySelector('[data-testid="og-apercu-impression"]');return {s:o.scrollWidth,c:o.clientWidth}});
 ok('360 px : le rapport financier ne déborde pas',ov.s<=ov.c+1,ov);
 await p.close();}
// ── Sécurité : export CSV sans formule exécutable, montants démesurés refusés, noms piégés sans effet
{const {p}=await boot(b,{settings:{companyName:'T',currency:'HTG'},primary:true,cats:{ong:[{type:'config',id:'cf',orgType:'ong'},{type:'contact',id:'c1',name:'=HYPERLINK("http://x","y")',kind:'particulier'},{type:'don',id:'d1',number:'RC-1',date:today,kind:'don',donorId:'c1',fondId:'',amount:7,mode:'caisse',entryId:'x',status:'valide'}]},pageInit:mk(['ong'],'Administrateur')});await p.waitForTimeout(1500);
 await g(p,'og-tab-dons').click();await p.waitForTimeout(300);
 const dl=p.waitForEvent('download',{timeout:5000}).catch(()=>null);await p.getByRole('button',{name:/Exporter \(CSV\)/}).first().click();const d=await dl;
 const txt=d?require('fs').readFileSync(await d.path(),'utf8'):'';
 ok('export CSV : un nom commençant par = est neutralisé (pas de formule Excel)',/"'=HYPERLINK/.test(txt)&&!/"=HYPERLINK/.test(txt),txt.slice(0,200));
 for(const v of ['1e308','999999999999999999999','-5']){await g(p,'og-don-montant').fill(v);await g(p,'og-don-nomlibre').fill('<img src=x onerror="window.__xss=1">');await g(p,'og-don-enregistrer').click();await p.waitForTimeout(250);}
 ok('montants démesurés ou négatifs refusés',(await cat(p,'ong')).filter(r=>r.type==='don').length===1,(await cat(p,'ong')).filter(r=>r.type==='don').map(r=>r.amount));
 await g(p,'og-don-montant').fill('12');await g(p,'og-don-enregistrer').click();await p.waitForTimeout(450);
 ok('nom piégé (balise HTML) : affiché comme texte, aucun script exécuté',(await p.evaluate(()=>window.__xss||0))===0&&/<img src=x/.test(await g(p,'og-recu-feuille').first().innerText()));
 await p.close();}
// ── Petit écran : les montants à 9 ou 11 chiffres restent dans leur carte (cartes du tableau de bord)
{const gros=(n)=>({type:'don',id:'d'+n,number:'RC-'+n,date:today,kind:'subvention',donorName:'X',fondId:'',amount:98765432109.55,mode:'banque',entryId:'x'+n,status:'valide'});
 const {p}=await boot(b,{settings:{companyName:'T',currency:'HTG'},primary:true,cats:{ong:[{type:'config',id:'cf',orgType:'ong'},gros(1),{type:'dep',id:'e1',date:today,kind:'activites',label:'x',supplier:'F',amount:45678901234.25,mode:'caisse',fondId:'',status:'valide',settlements:[]}]},pageInit:mk(['ong'],'Administrateur')});
 await p.setViewportSize({width:360,height:740});
 const modele=require('fs').readFileSync(require('path').join(__dirname,'..','src','parties','index.modele.html'),'utf8');
 const css=(modele.match(/<style>([\s\S]*?)<\/style>/)||[0,''])[1].replace(/@font-face[^}]*}/g,'')+'.grid{display:grid}.grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.gap-3{gap:12px}.tabular{font-variant-numeric:tabular-nums}.text-lg{font-size:18px}';
 await p.addStyleTag({content:css});await p.waitForTimeout(1500);
 const r=await p.evaluate(()=>[...document.querySelectorAll('.ec-kpi .tabular')].map(v=>({t:v.textContent,o:v.scrollWidth>v.clientWidth+1})));
 ok('360 px : 8 cartes du tableau de bord ONG, montants de 11 chiffres sans débordement',r.length===8&&r.every(x=>!x.o),r.filter(x=>x.o));
 await p.close();}
// ── Église : mots et natures de recettes
{const {p}=await boot(b,{settings:{companyName:'Église',currency:'HTG'},primary:true,cats:{ong:[{type:'config',id:'cf',orgType:'eglise'},...seed()]},pageInit:mk(['ong'],'Administrateur')});await p.waitForTimeout(1600);
 await g(p,'og-tab-dons').click();await p.waitForTimeout(300);
 const nn=await g(p,'og-don-nature').locator('option').allInnerTexts();
 ok('Église : dîmes et offrandes proposées, pas de subvention en tête',nn.some(x=>/îme/.test(x))&&nn.some(x=>/ffrande/.test(x))&&!/ubvention/.test(nn[0]),nn);
 await g(p,'og-don-nature').selectOption('dime');await g(p,'og-don-montant').fill('250');await g(p,'og-don-enregistrer').click();await p.waitForTimeout(450);
 ok('reçu de dîme intitulé en conséquence',/DÎME|DIME|Dîme/i.test(await g(p,'og-recu-feuille').first().innerText()));
 const e=(await cat(p,'entries')).find(x=>(x.lines||[]).some(l=>l.account==='7584'&&l.credit===250));
 ok('dîme comptabilisée au compte 7584',!!e);
 await g(p,'og-apercu-fermer').click();await p.waitForTimeout(250);
 await g(p,'og-tab-membres').click().catch(()=>{});await p.waitForTimeout(300);
 ok('vocabulaire église : « Fidèles et membres »',/Fidèles et membres/.test(await p.locator('body').innerText()));
 await p.close();}
// ── Retard de cotisation (hors janvier : la période de l'année doit avoir commencé il y a plus de 30 jours)
if(!janv){const {p}=await boot(b,{settings:{companyName:'A',currency:'HTG'},primary:true,cats:{ong:seed()},pageInit:mk(['ong'],'Administrateur')});await p.waitForTimeout(1600);
 const t=await p.locator('body').innerText();
 ok('membre en retard signalé dans À faire',/Cotisation en retard/.test(t)&&re('1','').test(await g(p,'og-kpi-retard').innerText()),await g(p,'og-kpi-retard').innerText());
 await p.close();}
// ── Rôle Vendeur : accueil seulement
{const {p}=await boot(b,{settings:{companyName:'A',currency:'HTG'},primary:true,cats:{ong:[{type:'config',id:'cf',orgType:'ong'},...seed()]},pageInit:mk(['ong'],'Vendeur')});await p.waitForTimeout(1600);
 ok('Vendeur : pas de Fonds, Dépenses, Rapports ni Statistiques',(await g(p,'og-tab-fonds').count())===0&&(await g(p,'og-tab-depenses').count())===0&&(await g(p,'og-tab-rapports').count())===0&&(await g(p,'og-tab-stats').count())===0&&(await g(p,'og-tab-dons').count())===1&&(await g(p,'og-tab-membres').count())===1);
 await g(p,'og-tab-dons').click();await p.waitForTimeout(300);
 await g(p,'og-don-montant').fill('100');await g(p,'og-don-enregistrer').click();await p.waitForTimeout(450);
 ok('Vendeur : peut enregistrer un don et imprimer le reçu',(await g(p,'og-recu-feuille').count())>=1);
 await g(p,'og-apercu-fermer').click();await p.waitForTimeout(250);
 ok('Vendeur : ne peut pas annuler un don',(await g(p,'og-don-annuler').count())===0);
 await p.close();}
// ── Achats de l'ONG listés dans Achat et fournisseurs
{const dep={type:'dep',id:'d1',date:back(40),kind:'activites',label:'Cahiers',supplier:'Librairie Centrale',amount:900,mode:'apayer',entryId:'x',fondId:'',status:'valide',settlements:[]};
 const {p}=await boot(b,{settings:{companyName:'A',currency:'HTG'},primary:true,cats:{ong:[dep,...seed()]},pageInit:mk(['ong'],'Administrateur')});await p.waitForTimeout(1500);
 await g(p,'nav-rang-achat').click();await p.waitForTimeout(900);
 await p.getByRole('button',{name:'Achats ONG'}).click();await p.waitForTimeout(400);
 ok('dépense à payer listée dans Achat et fournisseurs',(await g(p,'ach-metier-ligne').count())>=1&&/Librairie Centrale/.test(await g(p,'ach-metier-ligne').first().innerText()));
 await p.close();}
await b.close();console.log(fails?('ÉCHECS '+fails):'TOUT PASSE');process.exit(fails?1:0)})();

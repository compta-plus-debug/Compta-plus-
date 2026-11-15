// v334 — tarif unique (réglages de facturation) pour les paiements MonCash + espace de comparaison des taux (appliqué / marché / BRH).
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const mk=(f,a)=>new Function('('+f.toString()+')('+JSON.stringify(a||null)+')');
const marche=(p,rate)=>p.route('https://open.er-api.com/**',r=>rate?r.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({rates:{HTG:rate}})}):r.abort());
const capter=(p,calls)=>p.route('**/functions/v1/moncash**',r=>{calls.push({url:r.request().url(),body:JSON.parse(r.request().postData()||'{}')});r.fulfill({status:400,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({error:'test : paiement non créé'})});});
const initSA=(bs)=>{const S=window.__srv;S.tables.platform_admins=[{email:'a@x.com'}];S.tables.superadmin_log=[];S.tables.billing_invoices=[];S.tables.billing_settings=bs?[bs]:[];S.tables.company_groups=[];
 S.tables.company_members=[{id:7,company_id:'c1',email:'a@x.com',role:'Administrateur',user_id:'u1',is_primary_admin:true,created_at:'2026-01-01'}];};
const initCo=(o)=>{const S=window.__srv;S.tables.billing_settings=o.bs?[o.bs]:[];S.tables.companies=[{id:'c1',name:'Lakay SA',plan_status:o.status,plan_tier:o.tier,trial_ends_at:null,security_pin_hash:null,group_id:null}];};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// A — Super Admin > Facturation > Réglages : espace de comparaison
{const {p,errs}=await boot(b,{settings:{companyName:'X'},primary:true,pageInit:mk(initSA,{id:1,rate_htg_per_usd:140,prices:{standard:20,assisted:80,group:350}}),onPage:(pg)=>marche(pg,132)});
 await p.getByText('Super Admin',{exact:false}).first().click();await p.waitForTimeout(900);await g(p,'sa-group-facturation').click();await g(p,'sa-tab-fact_reglages').click();await p.waitForTimeout(900);
 const t1=await g(p,'fb-taux-compare').innerText();
 ok('comparaison : taux appliqué 140 affiché',/140,00/.test(await g(p,'fb-taux-applique').innerText()),t1);
 ok('comparaison : taux du marché 132 et écart +6,1 %',/132,00/.test(await g(p,'fb-taux-marche').innerText())&&/\+6,1 %/.test(await g(p,'fb-taux-marche').innerText()),t1);
 ok('comparaison : BRH non renseigné',/non renseigné/.test(await g(p,'fb-taux-brh').innerText()),t1);
 ok('alerte d\'écart supérieur à 2 % affichée',await g(p,'fb-taux-alerte').count()===1);
 await g(p,'fb-reg-brh_rate').fill('131.5');await p.waitForTimeout(200);
 ok('BRH saisi : écart +6,5 % affiché',/131,50/.test(await g(p,'fb-taux-brh').innerText())&&/\+6,5 %/.test(await g(p,'fb-taux-brh').innerText()),await g(p,'fb-taux-brh').innerText());
 ok('date du taux BRH préremplie à aujourd\'hui',(await g(p,'fb-reg-brh_rate_date').inputValue()).length===10);
 await g(p,'fb-reg-brh-appliquer').click();await p.waitForTimeout(200);
 ok('« Appliquer le taux BRH » reprend 131,5 comme taux appliqué',(await g(p,'fb-reg-rate_htg_per_usd').inputValue())==='131.5');
 ok('alerte disparue une fois les taux alignés',await g(p,'fb-taux-alerte').count()===0,await g(p,'fb-taux-compare').innerText());
 await g(p,'fb-reg-enregistrer').click();await p.waitForTimeout(600);
 const all=await p.evaluate(()=>window.__srv.tables.billing_settings);const row=all[all.length-1];
 ok('enregistrement : taux appliqué 131,5, BRH 131,5 et sa date',row&&row.rate_htg_per_usd===131.5&&row.brh_rate===131.5&&/^\d{4}-\d\d-\d\d$/.test(row.brh_rate_date||''),row);
 await g(p,'fb-reg-taux-auto').click();await p.waitForTimeout(400);
 ok('« Taux du marché du jour » reprend 132',(await g(p,'fb-reg-rate_htg_per_usd').inputValue())==='132');
 ok('aucune erreur de page (réglages)',errs.length===0,errs.slice(0,2));await p.context().close();}
// B — réglages sans taux : avertissement
{const {p}=await boot(b,{settings:{companyName:'X'},primary:true,pageInit:mk(initSA,null),onPage:(pg)=>marche(pg,132)});
 await p.getByText('Super Admin',{exact:false}).first().click();await p.waitForTimeout(900);await g(p,'sa-group-facturation').click();await g(p,'sa-tab-fact_reglages').click();await p.waitForTimeout(900);
 ok('sans taux appliqué : avertissement « taux du marché utilisé »',await g(p,'fb-taux-vide').count()===1);await p.context().close();}
// C — entreprise Assistée suspendue : renouvellement au prix Assisté et au taux des réglages
{const calls=[];const {p,errs}=await boot(b,{settings:{companyName:'X'},pageInit:mk(initCo,{status:'suspended',tier:'assisted',bs:{id:1,rate_htg_per_usd:140,prices:{standard:20,assisted:85,group:350}}}),onPage:(pg)=>{marche(pg,132);capter(pg,calls);}});
 await p.waitForTimeout(800);const txt=await p.evaluate(()=>document.body.innerText);
 ok('écran de blocage : bouton « Payer 11 900 HTG » (85 USD × 140)',/Payer 11\s900 HTG avec MonCash/.test(txt),txt.slice(0,500));
 ok('écran de blocage : « Équivalent de 85 USD (1 USD = 140.00 G) »',/Équivalent de 85 USD \(1 USD = 140\.00 G\)/.test(txt));
 await p.getByText(/Payer 11\s900 HTG avec MonCash/).first().click();await p.waitForTimeout(800);
 ok('demande envoyée au serveur : montant 11900, sans forfait cible',calls.length===1&&calls[0].body.amount===11900&&calls[0].body.targetTier===undefined&&/action=create/.test(calls[0].url),calls);
 ok('aucune erreur de page (blocage)',errs.length===0,errs.slice(0,2));await p.context().close();}
// D — aucun réglage : repli sur le taux du marché et le prix intégré
{const calls=[];const {p}=await boot(b,{settings:{companyName:'X'},pageInit:mk(initCo,{status:'suspended',tier:'standard',bs:null}),onPage:(pg)=>{marche(pg,132);capter(pg,calls);}});
 await p.waitForTimeout(800);const txt=await p.evaluate(()=>document.body.innerText);
 ok('sans réglage : « Payer 2 640 HTG » (20 USD × 132, taux du marché)',/Payer 2\s640 HTG avec MonCash/.test(txt),txt.slice(0,400));
 await p.getByText(/Payer 2\s640 HTG avec MonCash/).first().click();await p.waitForTimeout(800);
 ok('sans réglage : montant envoyé 2640',calls.length===1&&calls[0].body.amount===2640,calls);await p.context().close();}
// E — ni réglage ni réseau : repli fixe
{const {p}=await boot(b,{settings:{companyName:'X'},pageInit:mk(initCo,{status:'suspended',tier:'standard',bs:null}),onPage:(pg)=>marche(pg,0)});
 await p.waitForTimeout(800);const txt=await p.evaluate(()=>document.body.innerText);
 ok('sans réglage ni réseau : repli 130,53 → « Payer 2 610 HTG »',/Payer 2\s610 HTG avec MonCash/.test(txt),txt.slice(0,400));await p.context().close();}
// F — mise à niveau (fenêtre « Mise à niveau de forfait ») : prix et taux des réglages
{const calls=[];const {p,errs}=await boot(b,{settings:{companyName:'X'},pageInit:mk(initCo,{status:'active',tier:'standard',bs:{id:1,rate_htg_per_usd:140,prices:{standard:20,assisted:85,group:350}}}),onPage:(pg)=>{marche(pg,132);capter(pg,calls);}});
 await p.waitForTimeout(600);const lien=p.getByText('Mise à niveau',{exact:true}).first();
 if(await lien.count()){await lien.click();await p.waitForTimeout(700);
  const txt=await p.evaluate(()=>document.body.innerText);
  ok('mise à niveau : « 85 $/mois » et « Payer 11 900 HTG »',/85 \$\/mois/.test(txt)&&/Payer 11\s900 HTG avec MonCash/.test(txt),txt.slice(-600));
  await p.getByText(/Payer 11\s900 HTG avec MonCash/).first().click();await p.waitForTimeout(800);
  ok('mise à niveau : montant 11900 et forfait cible « assisted »',calls.length===1&&calls[0].body.amount===11900&&calls[0].body.targetTier==='assisted',calls);
 } else ok('mise à niveau : lien du forfait trouvé',false,(await p.evaluate(()=>document.body.innerText)).slice(0,300));
 ok('aucune erreur de page (mise à niveau)',errs.length===0,errs.slice(0,2));await p.context().close();}
// G — v335 : payer son forfait pendant l'essai (sans attendre le blocage)
{const calls=[];const fin=new Date(Date.now()+10*86400000).toISOString().slice(0,10);
 const {p,errs}=await boot(b,{settings:{companyName:'X'},pageInit:mk((o)=>{const S=window.__srv;S.tables.billing_settings=[o.bs];S.tables.companies=[{id:'c1',name:'Lakay SA',plan_status:'trial',plan_tier:'standard',trial_ends_at:o.fin,security_pin_hash:null,group_id:null}];},{fin,bs:{id:1,rate_htg_per_usd:140,prices:{standard:20,assisted:85,group:350}}}),onPage:(pg)=>{marche(pg,132);capter(pg,calls);}});
 await p.waitForTimeout(700);
 if(await g(p,'side-payer-maintenant').count()){await g(p,'side-payer-maintenant').click();await p.waitForTimeout(700);
  ok('essai : carte « Payer mon forfait Standard maintenant » affichée',await g(p,'upg-payer-carte').count()===1&&/Payer mon forfait Standard maintenant/.test(await g(p,'upg-payer-carte').innerText()));
  ok('essai : montant 2 800 HTG (20 USD × 140) et mention des jours restants',/Payer 2\s800 HTG avec MonCash/.test(await g(p,'upg-payer-carte').innerText())&&/se termine dans (9|10) jours/.test(await g(p,'upg-payer-carte').innerText()),await g(p,'upg-payer-carte').innerText());
  await g(p,'upg-payer-maintenant').click();await p.waitForTimeout(800);
  ok('essai : demande envoyée, montant 2800, sans forfait cible',calls.length===1&&calls[0].body.amount===2800&&calls[0].body.targetTier===undefined,calls);
  ok('essai : fenêtre « Payer mon forfait » sans la carte du forfait supérieur',await g(p,'upg-carte-superieur').count()===0&&/Payer mon forfait/.test(await p.evaluate(()=>document.body.innerText)));
  await p.getByText('×',{exact:true}).first().click();await p.waitForTimeout(300);await g(p,'side-mise-a-niveau').click();await p.waitForTimeout(700);
  ok('essai : lien « Mise à niveau » = forfait supérieur seul, sans la carte de paiement du forfait en cours',await g(p,'upg-carte-superieur').count()===1&&await g(p,'upg-payer-carte').count()===0);
  await g(p,'upg-mise-a-niveau').click();await p.waitForTimeout(150);
 } else ok('essai : lien « Payer mon forfait maintenant » dans la barre latérale',false,(await p.evaluate(()=>document.body.innerText)).slice(0,400));
 ok('aucune erreur de page (paiement pendant l\'essai)',errs.length===0,errs.slice(0,2));await p.context().close();}
// G2 — v336 : seul le bouton cliqué affiche « Redirection »
{const fin=new Date(Date.now()+10*86400000).toISOString().slice(0,10);
 const {p}=await boot(b,{settings:{companyName:'X'},pageInit:mk((o)=>{const S=window.__srv;S.tables.billing_settings=[];S.tables.companies=[{id:'c1',name:'Lakay SA',plan_status:'trial',plan_tier:'standard',trial_ends_at:o.fin,security_pin_hash:null,group_id:null}];},{fin}),onPage:(pg)=>{marche(pg,132);pg.route('**/functions/v1/moncash**',r=>setTimeout(()=>r.fulfill({status:400,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"error":"test"}'}),1500));}});
 await p.waitForTimeout(700);await g(p,'side-mise-a-niveau').click();await p.waitForTimeout(600);
 await g(p,'upg-mise-a-niveau').click();await p.waitForTimeout(500);
 ok('clic sur la mise à niveau : ce bouton affiche « Redirection en cours… » et il est désactivé',/Redirection en cours/.test(await g(p,'upg-mise-a-niveau').innerText())&&await g(p,'upg-mise-a-niveau').isDisabled());
 await p.context().close();}
// H — abonnement actif loin de l'échéance : pas de paiement anticipé ; à 3 jours : proposé
for(const [j,attendu] of [[20,0],[3,1]]){const fin=new Date(Date.now()+j*86400000).toISOString().slice(0,10);
 const {p}=await boot(b,{settings:{companyName:'X'},pageInit:mk((o)=>{const S=window.__srv;S.tables.billing_settings=[];S.tables.companies=[{id:'c1',name:'Lakay SA',plan_status:'active',plan_tier:'standard',trial_ends_at:o.fin,security_pin_hash:null,group_id:null}];},{fin}),onPage:(pg)=>marche(pg,132)});
 await p.waitForTimeout(700);
 ok('abonnement actif, '+j+' jours restants : lien de paiement '+(attendu?'affiché':'absent'),await g(p,'side-payer-maintenant').count()===attendu);
 if(attendu){await g(p,'side-payer-maintenant').click();await p.waitForTimeout(600);
  ok('abonnement actif, '+j+' jours restants : carte de paiement affichée',await g(p,'upg-payer-carte').count()===1);}
 else{await g(p,'side-mise-a-niveau').click();await p.waitForTimeout(600);
  ok('abonnement actif, '+j+' jours restants : aucune carte de paiement anticipé',await g(p,'upg-payer-carte').count()===0&&await g(p,'upg-carte-superieur').count()===1);}await p.context().close();}
await b.close();console.log(fails?('ECHECS fails='+fails):'TOUT PASSE fails=0');process.exit(fails?1:0)})();

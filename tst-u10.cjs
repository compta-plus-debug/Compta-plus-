// v257 — blocs par secteur, étape 1 : choix unique des 3 secteurs, verrouillage, demande de changement, centre de gestion.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const rows=(p,t)=>p.evaluate((t)=>window.__srv.tables[t]||[],t);
const initA=()=>{const S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors=[];S.tables.companies[0].sectors_locked=false;try{localStorage.removeItem('compta-plus-active-tab')}catch(e){}};
const initStd=()=>{const S=window.__srv;S.tables.companies[0].sectors=[];S.tables.companies[0].sectors_locked=false;S.tables.companies[0].sector_pack=false;try{localStorage.removeItem('compta-plus-active-tab')}catch(e){}};
const initLocked=()=>{const S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors=['ecoles','sante'];S.tables.companies[0].sectors_locked=true;S.tables.sector_change_requests=[];try{localStorage.removeItem('compta-plus-active-tab')}catch(e){}};
const initMgmt=()=>{const S=window.__srv;S.tables.platform_admins=[{email:'a@x.com'}];S.tables.companies[0].sectors=['ecoles'];S.tables.companies[0].sectors_locked=true;S.tables.sector_change_requests=[{id:'r1',company_id:'c1',company_name:'Lakay SA',requested_by_email:'a@x.com',current_sectors:['ecoles'],requested_sectors:['ecoles','btp'],reason:'Nous ouvrons un chantier',status:'pending',created_at:'2026-10-23T10:00:00Z'}];try{localStorage.removeItem('compta-plus-active-tab')}catch(e){}};
const fn=f=>new Function('('+f.toString()+')()');
const toAdmin=async p=>{await p.getByText('Administration',{exact:true}).first().click();await p.waitForTimeout(900)};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// A) forfait Assisté, secteurs jamais choisis : l'écran de choix apparaît, 3 secteurs maximum, choix définitif
{const {p,errs}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,pageInit:fn(initA)});
 ok('écran de choix affiché',(await p.locator('[data-testid="secteurs-modal"]').count())===1);
 for(const id of ['ecoles','import_export','industrie'])await p.locator('[data-testid="secteur-'+id+'"]').check();
 ok('3 choisis : le 4e secteur est bloqué',await p.locator('[data-testid="secteur-sante"]').isDisabled());
 ok('compteur 3 sur 3',/3 sur 3/.test(await p.locator('[data-testid="secteurs-compte"]').innerText()));
 await p.locator('[data-testid="secteurs-confirmer"]').click();await p.waitForTimeout(1000);
 const co=(await rows(p,'companies'))[0];
 ok('choix enregistré et verrouillé',JSON.stringify(co.sectors)==='["ecoles","import_export","industrie"]'&&co.sectors_locked===true,co);
 ok('écran fermé après le choix',(await p.locator('[data-testid="secteurs-modal"]').count())===0);
 await toAdmin(p);
 ok('Administration : les 3 secteurs sont listés',(await p.locator('[data-testid="secteurs-liste"] li').count())===3);
 ok('plus de bouton « Choisir »',(await p.locator('[data-testid="secteurs-choisir"]').count())===0);
 ok('aucune erreur JS (choix)',errs.length===0,errs.slice(0,3));await p.close();}
// A2) « Plus tard » : rien n'est enregistré
{const {p}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,pageInit:fn(initA)});
 await p.locator('[data-testid="secteurs-plus-tard"]').click();await p.waitForTimeout(400);
 ok('plus tard : écran fermé, rien verrouillé',(await p.locator('[data-testid="secteurs-modal"]').count())===0&&(await rows(p,'companies'))[0].sectors_locked===false);
 await toAdmin(p);
 ok('bouton « Choisir mes secteurs » disponible dans Administration',(await p.locator('[data-testid="secteurs-choisir"]').count())===1);await p.close();}
// B) Standard sans supplément : pas d'écran de choix, message du supplément
{const {p}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,pageInit:fn(initStd)});
 ok('Standard sans supplément : pas d\'écran de choix',(await p.locator('[data-testid="secteurs-modal"]').count())===0);
 await toAdmin(p);
 ok('message du supplément « 3 secteurs »',(await p.locator('[data-testid="secteurs-supplement"]').count())===1);
 ok('pas de bouton de choix',(await p.locator('[data-testid="secteurs-choisir"]').count())===0);await p.close();}
// C) choix verrouillé : demande de changement
{const {p,errs}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,pageInit:fn(initLocked)});
 ok('verrouillé : pas d\'écran de choix',(await p.locator('[data-testid="secteurs-modal"]').count())===0);
 await toAdmin(p);
 ok('secteurs verrouillés listés (2)',(await p.locator('[data-testid="secteurs-liste"] li').count())===2);
 await p.locator('[data-testid="secteurs-demander"]').click();await p.waitForTimeout(300);
 await p.locator('[data-testid="secteur-btp"]').check();
 await p.locator('[data-testid="secteurs-envoyer"]').click();await p.waitForTimeout(500);
 ok('motif obligatoire : aucune demande sans motif',(await rows(p,'sector_change_requests')).length===0);
 await p.locator('[data-testid="secteurs-motif"]').fill('Nous ouvrons un chantier');
 await p.locator('[data-testid="secteurs-envoyer"]').click();await p.waitForTimeout(900);
 const rq=await rows(p,'sector_change_requests');
 ok('demande enregistrée : 3 secteurs demandés, en attente',rq.length===1&&rq[0].status==='pending'&&rq[0].requested_sectors.length===3&&rq[0].reason==='Nous ouvrons un chantier',rq);
 ok('demande en attente affichée',(await p.locator('[data-testid="secteurs-demande-attente"]').count())===1);
 ok('les secteurs de l\'entreprise ne changent pas tant que la demande n\'est pas acceptée',JSON.stringify((await rows(p,'companies'))[0].sectors)==='["ecoles","sante"]');
 await p.locator('[data-testid="secteurs-demande-attente"] button').click();await p.waitForTimeout(800);
 ok('demande annulée',(await rows(p,'sector_change_requests'))[0].status==='cancelled');
 ok('aucune erreur JS (demande)',errs.length===0,errs.slice(0,3));await p.close();}
// D) centre de gestion : accepter une demande, régler une entreprise
{const {p,errs}=await boot(b,{settings:{companyName:'X'},primary:true,pageInit:fn(initMgmt)});
 await p.getByText('Centre de gestion',{exact:false}).first().click();await p.waitForTimeout(1000);
 await p.getByRole('button',{name:'Secteurs et blocs',exact:true}).click();await p.waitForTimeout(800);
 ok('onglet Secteurs et blocs affiché',(await p.locator('[data-testid="secteurs-gestion"]').count())===1);
 ok('demande en attente listée',(await p.locator('[data-testid="secteurs-demande"]').count())===1);
 await p.locator('[data-testid="secteurs-accepter"]').click();await p.waitForTimeout(1000);
 const co=(await rows(p,'companies'))[0],rq=(await rows(p,'sector_change_requests'))[0];
 ok('demande acceptée : secteurs remplacés',JSON.stringify(co.sectors)==='["ecoles","btp"]'&&rq.status==='accepted'&&!!rq.decided_at,{co,rq});
 await p.locator('[data-testid="secteurs-regler"]').first().click();await p.waitForTimeout(400);
 await p.locator('[data-testid="secteurs-pack"]').check();
 await p.locator('[data-testid="secteurs-extra-sante"]').check();
 await p.locator('[data-testid="secteurs-enregistrer"]').click();await p.waitForTimeout(1000);
 const co2=(await rows(p,'companies'))[0];
 ok('supplément et bloc supplémentaire enregistrés',co2.sector_pack===true&&JSON.stringify(co2.extra_blocks)==='["sante"]',co2);
 ok('aucune erreur JS (centre de gestion)',errs.length===0,errs.slice(0,3));await p.close();}
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

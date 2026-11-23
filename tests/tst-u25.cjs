// v275 — WhatsApp hors facture : écrire à un client, file de promotions (accord WhatsApp), bouton sur chaque entreprise ; aide quand rien n'est en retard.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const init=()=>{const S=window.__srv;
 window.__wa=[];window.open=function(u){window.__wa.push(u);return null;};
 S.tables.platform_admins=[{email:'a@x.com'}];S.tables.superadmin_log=[];S.tables.billing_settings=[];S.tables.billing_invoices=[];
 S.tables.companies=[
  {id:'c1',name:'Lakay SA',plan_status:'active',plan_tier:'standard',trial_ends_at:null,created_at:'2025-01-01T00:00:00Z',sectors:[],extra_blocks:[],phone:'509 3712 3456',whatsapp_optin:true},
  {id:'c2',name:'Boutique Sans Contact',plan_status:'active',plan_tier:'standard',trial_ends_at:null,created_at:'2025-01-02T00:00:00Z',sectors:[],extra_blocks:[]},
  {id:'c3',name:'Marché Pa Nou',plan_status:'active',plan_tier:'standard',trial_ends_at:null,created_at:'2025-01-03T00:00:00Z',sectors:[],extra_blocks:[],phone:'3799 1111',whatsapp_optin:true},
  {id:'c4',name:'Sans Accord',plan_status:'active',plan_tier:'standard',trial_ends_at:null,created_at:'2025-01-04T00:00:00Z',sectors:[],extra_blocks:[],phone:'3700 2222',whatsapp_optin:false}];
 S.tables.company_groups=[];
 S.tables.company_members=[{id:7,company_id:'c1',email:'a@x.com',role:'Administrateur',user_id:'u1',is_primary_admin:true,created_at:'2026-01-01'}];};
const msgVu=async(p,txt)=>{try{await p.getByText(txt,{exact:false}).first().waitFor({timeout:6000});return true;}catch(e){return false;}};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p}=await boot(b,{settings:{companyName:'X'},primary:true,pageInit:new Function('('+init.toString()+')()')});
 await p.getByText('Super Admin',{exact:false}).first().click();await p.waitForTimeout(900);
 await g(p,'sa-group-facturation').click();await g(p,'sa-tab-fact_relances').click();await p.waitForTimeout(700);
 ok('aucune facture en retard : explication affichée avec renvoi vers la carte WhatsApp libre',/carte « Écrire à un client/.test(await g(p,'fb-rel-vide').innerText()));
 ok('carte « Écrire à un client » présente',await g(p,'fb-wa-libre').count()===1);
 // sans choix d'entreprise
 await g(p,'fb-wa-ouvrir').click();const v0=await msgVu(p,'Choisissez l\'entreprise');
 ok('écrire à un client : sans entreprise choisie, refusé',v0&&(await p.evaluate(()=>window.__wa.length))===0);
 // entreprise sans numéro
 await g(p,'fb-wa-societe').selectOption('c2');await g(p,'fb-wa-ouvrir').click();const v1=await msgVu(p,'Aucun numéro WhatsApp valide');
 ok('écrire à un client : entreprise sans numéro, refusé',v1&&(await p.evaluate(()=>window.__wa.length))===0);
 // entreprise avec numéro, modèle nouveauté
 await g(p,'fb-wa-societe').selectOption('c1');await g(p,'fb-wa-modele').selectOption('nouveaute');
 ok('modèle : le texte change',/nouveauté/i.test(await g(p,'fb-wa-texte').inputValue()));
 await g(p,'fb-wa-texte').fill('Bonjour {client}, ici {emetteur}. Nouveau module Santé !');
 await g(p,'fb-wa-ouvrir').click();await p.waitForTimeout(600);
 const wa=await p.evaluate(()=>window.__wa);
 ok('écrire à un client : lien wa.me, bon numéro, nom et émetteur remplacés',wa.length===1&&wa[0].startsWith('https://wa.me/50937123456?text=')&&/Bonjour%20Lakay%20SA%2C%20ici%20Compta%2B/.test(wa[0])&&/Sant%C3%A9/.test(wa[0]),wa);
 // promotions
 ok('promotions : seulement les clients avec accord ET numéro (2 sur 4)',(await g(p,'fb-promo-ligne').count())===2&&/2 restant\(s\) sur 2/.test(await g(p,'fb-promo-reste').innerText()),await g(p,'fb-promo-reste').innerText());
 ok('promotions : « Sans Accord » absent',!(await g(p,'fb-promo').innerText()).includes('Sans Accord'));
 await g(p,'fb-promo-texte').fill('Offre {client} : -20 % ce mois (de {emetteur}).');
 await p.evaluate(()=>{window.__wa=[];});
 await g(p,'fb-promo-wa').first().click();await p.waitForTimeout(500);
 const w2=await p.evaluate(()=>window.__wa);
 ok('promotions : WhatsApp ouvert pour le client, texte personnalisé',w2.length===1&&/^https:\/\/wa\.me\/509\d{8}\?text=/.test(w2[0])&&/Offre%20(Lakay%20SA|March)/.test(w2[0]),w2);
 ok('promotions : la ligne est cochée et le compteur baisse',/1 restant\(s\) sur 2/.test(await g(p,'fb-promo-reste').innerText())&&/Ouvert/.test(await g(p,'fb-promo-wa').first().innerText()));
 // bouton WhatsApp sur chaque entreprise
 await g(p,'sa-group-activite').click();await g(p,'sa-tab-entreprises').click();await p.waitForTimeout(800);
 await p.getByText('Lakay SA',{exact:false}).first().click();await p.waitForTimeout(500);
 await p.evaluate(()=>{window.__wa=[];});
 await g(p,'sa-co-wa').first().click();await p.waitForTimeout(500);
 const w3=await p.evaluate(()=>window.__wa);
 ok('entreprise : bouton WhatsApp ouvre le lien du bon numéro',w3.length===1&&w3[0].startsWith('https://wa.me/50937123456?text='),w3);
 await p.close();}
await b.close();console.log('fails='+fails);})();

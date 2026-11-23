// v274 — relances (e-mail, WhatsApp), messages types, téléphone obligatoire à l'inscription, coordonnées de contact, cartes de la facturation.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const init=()=>{const S=window.__srv;const pad=n=>String(n).padStart(2,'0');
 const d=(k)=>{const x=new Date();x.setDate(x.getDate()+k);return x.getFullYear()+'-'+pad(x.getMonth()+1)+'-'+pad(x.getDate());};
 window.__wa=[];window.open=function(u){window.__wa.push(u);return null;};
 S.tables.platform_admins=[{email:'a@x.com'}];S.tables.superadmin_log=[];S.tables.billing_settings=[];
 S.tables.companies=[
  {id:'c1',name:'Lakay SA',plan_status:'active',plan_tier:'standard',trial_ends_at:null,created_at:'2025-01-01T00:00:00Z',sectors:[],extra_blocks:[],phone:'509 3712 3456',whatsapp_optin:true},
  {id:'c2',name:'Boutique Sans Contact',plan_status:'active',plan_tier:'standard',trial_ends_at:null,created_at:'2025-01-01T00:00:00Z',sectors:[],extra_blocks:[]}];
 S.tables.company_groups=[];
 S.tables.company_members=[{id:7,company_id:'c1',email:'a@x.com',role:'Administrateur',user_id:'u1',is_primary_admin:true,created_at:'2026-01-01'}];
 const L=[{label:'Forfait Standard',qty:1,unit_usd:20,total_usd:20}];
 S.tables.billing_invoices=[
  {id:'i1',number:'FA-2026-000001',company_id:'c1',client_name:'Lakay SA',kind:'mensuelle',status:'emise',issue_date:d(-35),due_date:d(-20),period_start:d(-35),period_end:d(-5),lines:L,subtotal_usd:20,rate_htg_per_usd:130,subtotal_htg:2600,total_htg:2600},
  {id:'i2',number:'FA-2026-000002',company_id:'c2',client_name:'Boutique Sans Contact',kind:'mensuelle',status:'emise',issue_date:d(-45),due_date:d(-30),period_start:d(-45),period_end:d(-15),lines:L,subtotal_usd:20,rate_htg_per_usd:130,subtotal_htg:2600,total_htg:2600},
  {id:'i3',number:'FA-2026-000003',company_id:'c1',client_name:'Lakay SA',kind:'mensuelle',status:'emise',issue_date:d(-1),due_date:d(14),period_start:d(-1),period_end:d(29),lines:L,subtotal_usd:20,rate_htg_per_usd:130,subtotal_htg:2600,total_htg:2600}];
 S.fnH={'send-offer-email':async function(){return {data:{success:true},error:null};}};};
const mk=(f)=>new Function('const init='+init.toString()+';('+f.toString()+')()');
const goSA=async p=>{await p.getByText('Super Admin',{exact:false}).first().click();await p.waitForTimeout(900);await g(p,'sa-group-facturation').click();};
const inv=(p)=>p.evaluate(()=>window.__srv.tables.billing_invoices);
const msgVu=async(p,txt)=>{try{await p.getByText(txt,{exact:false}).first().waitFor({timeout:6000});return true;}catch(e){return false;}};
const ligne=(p,nom)=>g(p,'fb-rel-ligne').filter({hasText:nom});
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p}=await boot(b,{settings:{companyName:'X'},primary:true,pageInit:mk(init)});
 await goSA(p);
 ok('menu Facturation : onglet Relances',await g(p,'sa-tab-fact_relances').count()===1);
 // cartes : l'historique est dans une carte, pas sur le fond
 ok('cartes : historique, émission et indicateurs dans des cartes',await p.evaluate(()=>{const e=document.querySelector('[data-testid=fb-ligne]');if(!e)return false;let n=e.parentElement,f=false;for(let i=0;i<4&&n;i++){const cs=getComputedStyle(n);if(cs.backgroundColor==='rgb(255, 255, 255)'&&parseFloat(cs.borderTopWidth)>=1&&parseFloat(cs.borderTopLeftRadius)>=10){f=true;break;}n=n.parentElement;}return f;}));
 await g(p,'sa-tab-fact_relances').click();await p.waitForTimeout(700);
 ok('relances : 2 factures en retard comptées',(await g(p,'fb-rel-kpi-retard').innerText()).trim()==='2');
 ok('relances : liste = 2 lignes en retard (la 3e n est pas échue)',(await g(p,'fb-rel-ligne').count())===2);
 // e-mail
 await ligne(p,'Lakay').locator('[data-testid="fb-rel-email"]').click();await p.waitForTimeout(900);
 const fn=await p.evaluate(()=>window.__srv.lastFn);
 ok('e-mail : fonction d envoi appelée vers l administrateur avec numéro et montant',fn&&fn.name==='send-offer-email'&&fn.body.to[0]==='a@x.com'&&/FA-2026-000001/.test(fn.body.subject)&&/2\s?600/.test(fn.body.html.replace(/&nbsp;| | /g,' ')),fn&&fn.body);
 let rows=await inv(p);const r1=rows.find(r=>r.id==='i1');
 ok('e-mail : relance notée (1, e-mail)',r1.reminder_count===1&&r1.last_reminder_channel==='email'&&!!r1.last_reminder_at,r1);
 // e-mail impossible sans adresse
 const nb0=await p.evaluate(()=>window.__srv.calls.filter(c=>c==='fn send-offer-email').length);
 await ligne(p,'Boutique').locator('[data-testid="fb-rel-email"]').click();
 const vu1=await msgVu(p,'Aucune adresse e-mail');
 ok('e-mail sans adresse : refusé, rien envoyé',(await p.evaluate(()=>window.__srv.calls.filter(c=>c==='fn send-offer-email').length))===nb0&&vu1);
 // WhatsApp
 await ligne(p,'Lakay').locator('[data-testid="fb-rel-wa"]').click();await p.waitForTimeout(700);
 const wa=await p.evaluate(()=>window.__wa);
 ok('WhatsApp : lien wa.me avec le bon numéro et le message',wa.length===1&&wa[0].startsWith('https://wa.me/50937123456?text=')&&/FA-2026-000001/.test(decodeURIComponent(wa[0])),wa);
 rows=await inv(p);ok('WhatsApp : relance notée (2, whatsapp)',rows.find(r=>r.id==='i1').reminder_count===2&&rows.find(r=>r.id==='i1').last_reminder_channel==='whatsapp');
 await ligne(p,'Boutique').locator('[data-testid="fb-rel-wa"]').click();
 const vu2=await msgVu(p,'Aucun numéro WhatsApp valide');
 ok('WhatsApp sans numéro : refusé, rien ouvert',(await p.evaluate(()=>window.__wa.length))===1&&vu2);
 // envoi de masse : Lakay relancée il y a moins de 3 jours -> ignorée
 const nb1=await p.evaluate(()=>window.__srv.calls.filter(c=>c==='fn send-offer-email').length);
 await g(p,'fb-rel-masse').click();await p.waitForTimeout(900);
 ok('envoi de masse : pas de nouvel e-mail pour une facture relancée depuis moins de 3 jours',(await p.evaluate(()=>window.__srv.calls.filter(c=>c==='fn send-offer-email').length))===nb1);
 await g(p,'fb-rel-filtre').selectOption('dues');await p.waitForTimeout(400);
 ok('filtre : toutes les factures à payer (3)',(await g(p,'fb-rel-ligne').count())===3);
 // réglages : messages
 await g(p,'sa-tab-fact_reglages').click();await p.waitForTimeout(500);
 ok('réglages : messages de relance proposés par défaut',/\{numero\}/.test(await g(p,'fb-reg-rem_subject').inputValue())&&/\{client\}/.test(await g(p,'fb-reg-rem_wa').inputValue()));
 await g(p,'fb-reg-rem_wa').fill('Salut {client}, facture {numero} à régler ({montant}).');
 await g(p,'fb-reg-rate_htg_per_usd').fill('130');await g(p,'fb-reg-enregistrer').click();await p.waitForTimeout(600);
 const cfgRow=await p.evaluate(()=>window.__srv.tables.billing_settings[0]);
 ok('réglages : message WhatsApp enregistré',cfgRow&&/^Salut \{client\}/.test(cfgRow.reminder_whatsapp_body),cfgRow);
 await g(p,'sa-tab-fact_relances').click();await p.waitForTimeout(600);
 await p.evaluate(()=>{window.__wa=[];});
 await ligne(p,'Lakay').locator('[data-testid="fb-rel-wa"]').click();await p.waitForTimeout(600);
 const wa2=await p.evaluate(()=>window.__wa);
 ok('WhatsApp : message modifié utilisé',wa2.length===1&&/Salut%20Lakay%20SA/.test(wa2[0]),wa2);
 await p.close();}
// écran client : coordonnées
{const {p}=await boot(b,{settings:{companyName:'X'},primary:true,pageInit:mk(()=>{init();window.__srv.tables.platform_admins=[];})});await p.waitForTimeout(1000);
 await p.getByText('Administration',{exact:false}).first().click();await p.waitForTimeout(900);
 await p.getByText('Accès',{exact:true}).first().click();await p.waitForTimeout(400);await p.getByText('Abonnement et factures',{exact:false}).first().click();await p.waitForTimeout(900);
 ok('contact : téléphone déjà connu affiché',(await g(p,'fb-contact-tel').inputValue())==='509 3712 3456');
 await g(p,'fb-contact-tel').fill('abc');await g(p,'fb-contact-save').click();await p.waitForTimeout(400);
 ok('contact : numéro invalide refusé',/invalide/i.test(await g(p,'fb-contact-msg').innerText())&&(await p.evaluate(()=>window.__srv.tables.companies.find(c=>c.id==='c1').phone))==='509 3712 3456');
 await g(p,'fb-contact-tel').fill('3712 9999');await g(p,'fb-contact-optin').uncheck();await g(p,'fb-contact-save').click();await p.waitForTimeout(500);
 const c1=await p.evaluate(()=>window.__srv.tables.companies.find(c=>c.id==='c1'));
 ok('contact : enregistré (numéro, accord retiré)',c1.phone==='3712 9999'&&c1.whatsapp_optin===false,c1);
 ok('écran client : rien ne déborde',await p.evaluate(()=>{const e=document.querySelector('[data-testid=fb-client]');return !!e&&e.scrollWidth<=e.clientWidth+1&&e.getBoundingClientRect().right<=window.innerWidth+1;}));
 await p.close();}
// inscription : téléphone obligatoire
{const noMember=new Function("(function(){var S=window.__srv;S.tables.company_members=[];S.tables.companies=[];S.fnH={'create-company':async function(o){return {data:{success:true,alreadyExisted:false,companyId:'c9',companyName:o.body.companyName,role:'Administrateur',email:'a@x.com',trialEndsAt:'2026-12-01'},error:null}}};})();");
 const {p}=await boot(b,{skipSeed:true,pageInit:noMember});
 await p.locator('input[placeholder*="Nom de l\'entreprise"]').fill('Ma Boutique');
 await p.getByRole('button',{name:'Commencer'}).click();await p.waitForTimeout(900);
 ok('inscription : sans téléphone, rien n est créé',await p.evaluate(()=>!window.__srv.lastFn)&&await g(p,'welcome-error').count()===1&&/numéro de téléphone/.test(await g(p,'welcome-error').innerText()));
 await g(p,'welcome-phone').fill('12');await p.getByRole('button',{name:'Commencer'}).click();await p.waitForTimeout(700);
 ok('inscription : numéro trop court refusé',await p.evaluate(()=>!window.__srv.lastFn));
 await g(p,'welcome-phone').fill('509 3712 3456');await p.getByRole('button',{name:'Commencer'}).click();await p.waitForTimeout(1500);
 ok('inscription : avec un numéro valide, l entreprise est créée',await p.evaluate(()=>window.__srv.lastFn&&window.__srv.lastFn.name==='create-company'));
 await p.close();}
await b.close();console.log('fails='+fails);})();

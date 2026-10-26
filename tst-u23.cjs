// v272 — facturation des abonnements : émission mensuelle, prorata, groupe, TCA, paiement, annulation, complément, écran client, feuille de facture.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const init=()=>{const S=window.__srv;const now=new Date();const y=now.getFullYear(),m=now.getMonth();const pad=n=>String(n).padStart(2,'0');
 const first=y+'-'+pad(m+1)+'-01';const dix=y+'-'+pad(m+1)+'-10';const old=(y-1)+'-01-01';
 S.tables.platform_admins=[{email:'a@x.com'}];S.tables.superadmin_log=[];S.tables.billing_invoices=[];S.tables.billing_settings=[];
 S.tables.companies=[
  {id:'c1',name:'Lakay SA',plan_status:'active',plan_tier:'standard',trial_ends_at:null,created_at:old+'T00:00:00Z',sectors:[],extra_blocks:[]},
  {id:'a1',name:'Boutique',plan_status:'active',plan_tier:'standard',trial_ends_at:old,created_at:old+'T00:00:00Z',sectors:['ecoles','sante'],extra_blocks:['ecoles','sante'],sector_pack:false},
  {id:'b1',name:'PackCo',plan_status:'active',plan_tier:'standard',trial_ends_at:old,created_at:old+'T00:00:00Z',sectors:['ecoles'],extra_blocks:[],sector_pack:true},
  {id:'s1',name:'Assistee',plan_status:'active',plan_tier:'assisted',trial_ends_at:old,created_at:old+'T00:00:00Z',sectors:[],extra_blocks:[]},
  {id:'t1',name:'EnEssai',plan_status:'trial',plan_tier:'standard',trial_ends_at:y+'-12-31',created_at:first+'T00:00:00Z',sectors:[],extra_blocks:[]},
  {id:'n1',name:'NouvellePayante',plan_status:'active',plan_tier:'standard',trial_ends_at:dix,created_at:first+'T00:00:00Z',sectors:[],extra_blocks:[]},
  {id:'g1',name:'Filiale1',plan_status:'active',plan_tier:'group',group_id:'grp1',trial_ends_at:old,created_at:old+'T00:00:00Z',sectors:[],extra_blocks:[]},
  {id:'g2',name:'Filiale2',plan_status:'active',plan_tier:'group',group_id:'grp1',trial_ends_at:old,created_at:'2025-02-01T00:00:00Z',sectors:[],extra_blocks:[]}];
 S.tables.company_groups=[{id:'grp1',name:'Groupe Alpha',plan_status:'active'}];
 S.tables.company_members=[{id:7,company_id:'c1',email:'a@x.com',role:'Administrateur',user_id:'u1',is_primary_admin:true,created_at:'2026-01-01'}];};
const mk=(f)=>new Function('('+f.toString()+')()');
const goSA=async p=>{await p.getByText('Super Admin',{exact:false}).first().click();await p.waitForTimeout(900);await g(p,'sa-group-facturation').click();};
const inv=(p)=>p.evaluate(()=>window.__srv.tables.billing_invoices);
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p}=await boot(b,{settings:{companyName:'X'},primary:true,pageInit:mk(init)});
 await goSA(p);await g(p,'sa-tab-fact_reglages').click();await p.waitForTimeout(500);
 ok('réglages : prix par défaut affichés',(await g(p,'fb-prix-standard').inputValue())==='20'&&(await g(p,'fb-prix-assisted').inputValue())==='80'&&(await g(p,'fb-prix-A').inputValue())==='8');
 await g(p,'fb-reg-issuer_name').fill('Compta+ SA');await g(p,'fb-reg-thanks').fill('Mèsi anpil !');await g(p,'fb-reg-rate_htg_per_usd').fill('130');await g(p,'fb-reg-enregistrer').click();await p.waitForTimeout(500);
 const cfgRow=await p.evaluate(()=>window.__srv.tables.billing_settings[0]);
 ok('réglages enregistrés (nom, remerciement, taux, TCA désactivée par défaut)',cfgRow&&cfgRow.issuer_name==='Compta+ SA'&&cfgRow.thanks==='Mèsi anpil !'&&cfgRow.rate_htg_per_usd===130&&cfgRow.vat_enabled===false,cfgRow);
 await g(p,'sa-tab-fact_factures').click();await p.waitForTimeout(600);
 ok('taux repris des réglages',(await g(p,'fb-em-taux').inputValue())==='130');
 ok('TCA décochée par défaut',!(await g(p,'fb-em-vat').isChecked()));
 const dateEm=await g(p,'fb-em-date').inputValue();
 await g(p,'fb-em-emettre').click();await p.waitForTimeout(1200);
 let rows=await inv(p);const mens=rows.filter(r=>r.kind==='mensuelle');
 const tot=(name)=>{const r=mens.find(x=>x.client_name===name);return r&&r.total_htg};
 ok('Boutique : forfait 20 + écoles 8 + santé 5 = 33 USD = 4 290 G',tot('Boutique')===4290,tot('Boutique'));
 ok('PackCo : 20 + pack 12 = 32 USD = 4 160 G',tot('PackCo')===4160,tot('PackCo'));
 ok('Assisté : 80 USD = 10 400 G (blocs inclus)',tot('Assistee')===10400,tot('Assistee'));
 ok('Lakay : forfait seul 20 USD = 2 600 G',tot('Lakay SA')===2600,tot('Lakay SA'));
 const gf=mens.filter(r=>r.company_id==='g1'||r.company_id==='g2');
 ok('Groupe : une seule facture de 350 USD = 45 500 G',gf.length===1&&gf[0].total_htg===45500,gf.length);
 ok('Groupe : facturée au nom de l entreprise rattachée (jamais un autre nom) avec le groupe et les entreprises couvertes sur la ligne',gf[0]&&gf[0].client_name===(gf[0].company_id==='g1'?'Filiale1':'Filiale2')&&/Groupe Alpha/.test(gf[0].lines[0].label)&&/Filiale1/.test(gf[0].lines[0].label)&&/Filiale2/.test(gf[0].lines[0].label),gf[0]&&[gf[0].client_name,gf[0].lines[0].label]);
 ok('aucune facture ne porte le nom du groupe comme client',!mens.some(r=>r.client_name==='Groupe Alpha'));
 ok('entreprise en essai : pas de facture mensuelle',!mens.some(r=>r.client_name==='EnEssai'));
 const np=mens.find(x=>x.client_name==='NouvellePayante');
 const jours=new Date(Number(dateEm.slice(0,4)),Number(dateEm.slice(5,7)),0).getDate();
 ok('première facture payante : prorata à partir du lendemain de la fin de l\'essai',np&&np.lines[0].label.includes('prorata '+(jours-10)+'/'+jours)&&Math.abs(np.subtotal_usd-Math.round(20*(jours-10)/jours*100)/100)<0.011,np&&np.lines);
 const ins=rows.filter(r=>r.kind==='inscription');
 ok('factures d inscription à 0 créées pour les entreprises sans facture (essai gratuit)',ins.some(r=>r.client_name==='EnEssai'&&r.total_htg===0&&r.status==='gratuite'),ins.length);
 ok('numérotation FA-AAAA-000001 sans doublon',new Set(rows.map(r=>r.number)).size===rows.length&&rows.every(r=>/^FA-\d{4}-\d{6}$/.test(r.number)),rows.map(r=>r.number));
 ok('échéance à 15 jours',mens[0].due_date&&Math.round((new Date(mens[0].due_date)-new Date(mens[0].issue_date))/86400000)===15);
 const n0=rows.length;
 await g(p,'fb-em-emettre').click();await p.waitForTimeout(800);
 ok('2e émission du même mois : aucun doublon',(await inv(p)).length===n0);
 // paiement
 await g(p,'fb-filtre').selectOption('emise');await p.waitForTimeout(300);
 await g(p,'fb-payer').first().click();await p.waitForTimeout(300);
 await g(p,'fb-pay-montant').fill('0');await g(p,'fb-pay-valider').click();await p.waitForTimeout(300);
 ok('paiement à 0 refusé',(await inv(p)).filter(r=>r.status==='payee').length===0);
 await g(p,'fb-pay-montant').fill('4290');await g(p,'fb-pay-mode').selectOption('Virement');await g(p,'fb-pay-ref').fill('VIR-1');await g(p,'fb-pay-valider').click();await p.waitForTimeout(500);
 const pay=(await inv(p)).filter(r=>r.status==='payee');
 ok('paiement enregistré (mode, référence, date)',pay.length===1&&pay[0].payment_method==='Virement'&&pay[0].payment_ref==='VIR-1'&&!!pay[0].paid_at,pay);
 ok('indicateurs : encaissé affiché',/4.?290/.test((await g(p,'fb-kpi-encaisse').innerText()).replace(/\s/g,'')));
 // annulation avec motif
 await p.evaluate(()=>{window.prompt=()=>''});
 await g(p,'fb-filtre').selectOption('emise');await p.waitForTimeout(300);
 await g(p,'fb-annuler').first().click();await p.waitForTimeout(400);
 ok('annulation sans motif refusée',(await inv(p)).filter(r=>r.status==='annulee').length===0);
 await p.evaluate(()=>{window.prompt=()=>'Erreur de saisie'});
 await g(p,'fb-annuler').first().click();await p.waitForTimeout(500);
 const ann=(await inv(p)).filter(r=>r.status==='annulee');
 ok('annulation avec motif : facture conservée, statut annulée',ann.length===1&&ann[0].cancel_reason==='Erreur de saisie');
 // feuille de facture
 await g(p,'fb-filtre').selectOption('toutes');await p.waitForTimeout(300);
 await g(p,'fb-ouvrir').first().click();await p.waitForTimeout(400);
 const feuille=await g(p,'fb-feuille').first().innerText();
 ok('feuille : en-tête émetteur, FACTURE, détail, total en gourdes, remerciement en dernier',/Compta\+ SA/.test(feuille)&&/FACTURE/.test(feuille)&&/Taux de conversion/.test(feuille)&&/Total à payer/.test(feuille)&&feuille.trim().endsWith('Mèsi anpil !'),feuille.slice(-120));
 await p.close();}
// TCA et complément
{const {p}=await boot(b,{settings:{companyName:'X'},primary:true,pageInit:mk(init)});
 await goSA(p);await p.waitForTimeout(500);await g(p,'sa-tab-fact_factures').click();await p.waitForTimeout(600);
 await g(p,'fb-em-taux').fill('100');await g(p,'fb-em-vat').check();
 const dateEm=await g(p,'fb-em-date').inputValue();
 await g(p,'fb-em-emettre').click();await p.waitForTimeout(1200);
 let rows=await inv(p);const bq=rows.find(r=>r.client_name==='Boutique'&&r.kind==='mensuelle');
 ok('TCA 10 % : 33 USD × 100 = 3 300 G + 330 G = 3 630 G',bq&&bq.vat_enabled&&bq.vat_rate===10&&bq.subtotal_htg===3300&&bq.vat_htg===330&&bq.total_htg===3630,bq);
 await p.evaluate(()=>{const c=window.__srv.tables.companies.find(x=>x.id==='a1');c.extra_blocks=['ecoles','sante','import_export'];});
 await g(p,'fb-comp-societe').selectOption({label:'Boutique'});await g(p,'fb-comp-emettre').click();await p.waitForTimeout(900);
 rows=await inv(p);const cp=rows.find(r=>r.kind==='complement');
 const [Y,M,D]=dateEm.split('-').map(Number);const jours=new Date(Y,M,0).getDate();const rest=jours-D+1;
 ok('complément : +8 USD/mois au prorata des jours restants',cp&&Math.abs(cp.subtotal_usd-Math.round(8*rest/jours*100)/100)<0.011&&cp.client_name==='Boutique',cp&&cp.subtotal_usd);
 await g(p,'fb-comp-emettre').click();await p.waitForTimeout(700);
 ok('2e complément sans nouvelle hausse refusé',(await inv(p)).filter(r=>r.kind==='complement').length===1);
 await p.close();}
// écran client
{const {p}=await boot(b,{settings:{companyName:'X'},primary:true,pageInit:mk(()=>{const S=window.__srv;S.tables.billing_settings=[{id:1,issuer_name:'Compta+ SA',thanks:'Mèsi !'}];
  const d=(n)=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
  S.tables.billing_invoices=[{id:'i1',number:'FA-2026-000001',company_id:'c1',client_name:'X',kind:'inscription',status:'gratuite',issue_date:d(-60),lines:[{label:'Inscription — essai',qty:1,unit_usd:0,total_usd:0}],subtotal_usd:0,rate_htg_per_usd:130,subtotal_htg:0,total_htg:0},
   {id:'i2',number:'FA-2026-000002',company_id:'c1',client_name:'X',kind:'mensuelle',status:'emise',issue_date:d(-30),due_date:d(-15),period_start:d(-30),period_end:d(0),lines:[{label:'Forfait Standard',qty:1,unit_usd:20,total_usd:20}],subtotal_usd:20,rate_htg_per_usd:130,subtotal_htg:2600,total_htg:2600},
   {id:'i3',number:'FA-2026-000003',company_id:'autre',client_name:'Autre',kind:'mensuelle',status:'emise',issue_date:d(-1),lines:[],total_htg:999}];})});
 await p.waitForTimeout(1000);await p.getByText('Administration',{exact:false}).first().click();await p.waitForTimeout(900);
 await p.getByText('Accès',{exact:true}).first().click();await p.waitForTimeout(400);await p.getByText('Abonnement et factures',{exact:false}).first().click();await p.waitForTimeout(900);
 ok('écran client : seulement ses 2 factures',(await g(p,'fb-client-ligne').count())===2);
 ok('écran client : alerte de retard',(await g(p,'fb-client-retard').count())===1);
 ok('écran client : rien ne déborde de l écran',await p.evaluate(()=>{const e=document.querySelector('[data-testid=fb-client]');return !!e&&e.scrollWidth<=e.clientWidth+1&&e.getBoundingClientRect().right<=window.innerWidth+1;}));
 await g(p,'fb-client-ouvrir').first().click();await p.waitForTimeout(400);
 ok('écran client : facture imprimable',(await g(p,'fb-feuille').count())>=1);
 await p.close();}
await b.close();console.log('fails='+fails);})();

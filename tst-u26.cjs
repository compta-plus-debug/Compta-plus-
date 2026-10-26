// v276 — émission de facture : choix de l'entreprise à facturer (une seule ou toutes).
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const init=()=>{const S=window.__srv;const pad=n=>String(n).padStart(2,'0');const y=new Date().getFullYear();
 const fut=new Date(Date.now()+20*86400000);const futS=fut.getFullYear()+'-'+pad(fut.getMonth()+1)+'-'+pad(fut.getDate());
 S.tables.platform_admins=[{email:'a@x.com'}];S.tables.superadmin_log=[];S.tables.billing_invoices=[];
 S.tables.billing_settings=[{id:1,rate_htg_per_usd:130}];
 S.tables.companies=[
  {id:'a1',name:'Alpha',plan_status:'active',plan_tier:'standard',trial_ends_at:null,created_at:(y-1)+'-01-01T00:00:00Z',sectors:[],extra_blocks:[]},
  {id:'b1',name:'Beta',plan_status:'active',plan_tier:'standard',trial_ends_at:null,created_at:(y-1)+'-01-02T00:00:00Z',sectors:[],extra_blocks:[]},
  {id:'c1',name:'Gamma',plan_status:'trial',plan_tier:'standard',trial_ends_at:futS,created_at:(y-1)+'-01-03T00:00:00Z',sectors:[],extra_blocks:[]},
  {id:'g1',name:'Fil1',plan_status:'active',plan_tier:'group',group_id:'grp1',trial_ends_at:null,created_at:(y-1)+'-02-01T00:00:00Z',sectors:[],extra_blocks:[]},
  {id:'g2',name:'Fil2',plan_status:'active',plan_tier:'group',group_id:'grp1',trial_ends_at:null,created_at:(y-1)+'-03-01T00:00:00Z',sectors:[],extra_blocks:[]}];
 S.tables.company_groups=[{id:'grp1',name:'Groupe Alpha',plan_status:'active'}];
 S.tables.company_members=[{id:7,company_id:'a1',email:'a@x.com',role:'Administrateur',user_id:'u1',is_primary_admin:true,created_at:'2026-01-01'}];};
const msgVu=async(p,txt)=>{try{await p.getByText(txt,{exact:false}).first().waitFor({timeout:6000});return true;}catch(e){return false;}};
const inv=(p)=>p.evaluate(()=>window.__srv.tables.billing_invoices);
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p}=await boot(b,{settings:{companyName:'X'},primary:true,pageInit:new Function('('+init.toString()+')()')});
 await p.getByText('Super Admin',{exact:false}).first().click();await p.waitForTimeout(900);
 await g(p,'sa-group-facturation').click();await p.waitForTimeout(700);
 const sel=g(p,'fb-em-societe');
 ok('sélecteur d entreprise présent, « toutes » par défaut',await sel.count()===1&&(await sel.inputValue())==='');
 ok('sélecteur : liste les 5 entreprises (+ « toutes »), l essai est signalé',(await sel.locator('option').count())===6&&/Gamma \(essai\)/.test(await sel.innerText()));
 ok('bouton : libellé « toutes » par défaut',/Émettre les factures du mois/.test(await g(p,'fb-em-emettre').innerText()));
 // une seule entreprise
 await sel.selectOption('b1');
 ok('bouton : libellé « cette entreprise » après choix',/facture de cette entreprise/.test(await g(p,'fb-em-emettre').innerText()));
 await g(p,'fb-em-emettre').click();await p.waitForTimeout(1200);
 let rows=await inv(p);let mens=rows.filter(r=>r.kind==='mensuelle');
 ok('une seule entreprise : seule la facture de Beta est émise',mens.length===1&&mens[0].client_name==='Beta'&&mens[0].total_htg===2600,mens.map(r=>r.client_name));
 // entreprise en essai
 await sel.selectOption('c1');await g(p,'fb-em-emettre').click();await p.waitForTimeout(1200);
 rows=await inv(p);
 ok('essai : pas de facture mensuelle, seulement l inscription à 0 de Gamma',!rows.some(r=>r.kind==='mensuelle'&&r.client_name==='Gamma')&&rows.some(r=>r.kind==='inscription'&&r.client_name==='Gamma'&&r.total_htg===0),rows.map(r=>r.kind+':'+r.client_name));
 await g(p,'fb-em-emettre').click();const v=await msgVu(p,'pas encore en forfait payant');
 ok('essai : 2e clic, message clair (rien de plus émis)',v&&(await inv(p)).length===rows.length);
 // membre non principal d'un groupe
 await sel.selectOption('g2');await g(p,'fb-em-emettre').click();await p.waitForTimeout(1200);
 rows=await inv(p);const gf=rows.filter(r=>r.kind==='mensuelle'&&(r.company_id==='g1'||r.company_id==='g2'));
 ok('groupe : une seule facture (350 USD) au nom de l entreprise la plus ancienne (Fil1), groupe cité',gf.length===1&&gf[0].company_id==='g1'&&gf[0].client_name==='Fil1'&&gf[0].total_htg===45500&&/Groupe Alpha/.test(gf[0].lines[0].label),gf.map(r=>[r.company_id,r.client_name,r.total_htg]));
 // toutes
 await sel.selectOption('');await g(p,'fb-em-emettre').click();await p.waitForTimeout(1500);
 rows=await inv(p);mens=rows.filter(r=>r.kind==='mensuelle');
 const noms=mens.map(r=>r.client_name).sort();
 ok('toutes : Alpha ajoutée, aucun doublon (Alpha, Beta, Fil1)',JSON.stringify(noms)===JSON.stringify(['Alpha','Beta','Fil1']),noms);
 ok('numéros de facture tous différents',new Set(rows.map(r=>r.number)).size===rows.length);
 await p.close();}
await b.close();console.log('fails='+fails);})();

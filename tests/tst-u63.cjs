// v363 — promotion datée : la facture mensuelle prend le prix promo pendant la période, puis le prix normal.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const decalage=(j)=>{const d=new Date(Date.now()+j*86400000);const pad=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
// initialisation de la base simulée : un groupe de 2 entreprises ; promotion Extension à 199 $ du jour -1 au jour +20 (ou expirée)
const initCorps=(function(PROMO){
  const S=window.__srv;const y=new Date().getFullYear();
  S.tables.platform_admins=[{email:'a@x.com'}];S.tables.superadmin_log=[];S.tables.billing_invoices=[];
  const prices={standard:20,assisted:80,group:230,pack:12,A:8,B:5,C:3};
  if(PROMO)prices.promo=PROMO;
  S.tables.billing_settings=[{id:1,rate_htg_per_usd:130,prices}];
  S.tables.companies=[
   {id:'a1',name:'Alpha',plan_status:'active',plan_tier:'standard',trial_ends_at:null,created_at:(y-1)+'-01-01T00:00:00Z',sectors:[],extra_blocks:[]},
   {id:'g1',name:'Fil1',plan_status:'active',plan_tier:'group',group_id:'grp1',trial_ends_at:null,created_at:(y-1)+'-02-01T00:00:00Z',sectors:[],extra_blocks:[]},
   {id:'g2',name:'Fil2',plan_status:'active',plan_tier:'group',group_id:'grp1',trial_ends_at:null,created_at:(y-1)+'-03-01T00:00:00Z',sectors:[],extra_blocks:[]}];
  S.tables.company_groups=[{id:'grp1',name:'Groupe Alpha',plan_status:'active'}];
  S.tables.company_members=[{id:7,company_id:'a1',email:'a@x.com',role:'Administrateur',user_id:'u1',is_primary_admin:true,created_at:'2026-01-01'}];
});
const inv=(p)=>p.evaluate(()=>window.__srv.tables.billing_invoices);
const scenario=async(b,nom,promo,attendu,libelleAttendu)=>{
  const {p}=await boot(b,{settings:{companyName:'X'},primary:true,pageInit:new Function('('+initCorps.toString()+')('+JSON.stringify(promo)+')')});
  await p.getByText('Super Admin',{exact:false}).first().click();await p.waitForTimeout(900);
  await g(p,'sa-group-facturation').click();await p.waitForTimeout(700);
  await g(p,'fb-em-societe').selectOption('g2');await g(p,'fb-em-emettre').click();await p.waitForTimeout(1200);
  const rows=await inv(p);const gf=rows.filter(r=>r.kind==='mensuelle'&&r.company_id==='g1');
  ok(nom+' : facture Extension au prix attendu ('+attendu+' G)',gf.length===1&&gf[0].total_htg===attendu,gf.map(r=>r.total_htg));
  if(libelleAttendu)ok(nom+' : la ligne mentionne la promotion',gf.length===1&&gf[0].lines[0].label.includes(libelleAttendu),gf.map(r=>r.lines[0].label));
  await p.close();
};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
  await scenario(b,'promotion en cours',{tier:'group',usd:199,debut:decalage(-1),fin:decalage(20),libelle:'Lancement'},199*130,'Lancement');
  await scenario(b,'promotion expirée',{tier:'group',usd:199,debut:decalage(-30),fin:decalage(-1),libelle:'Ancienne'},230*130,null);
  await scenario(b,'pas de promotion',null,230*130,null);
  await b.close();console.log('fails='+fails);})();

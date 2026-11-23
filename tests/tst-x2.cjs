// v347 — exports Excel et Word d'un chantier BTP (bordereau de prix, situations, dépenses) : chargement à la demande.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');const fs=require('fs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const iso=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const jours=(n)=>{const d=new Date();d.setHours(12);d.setDate(d.getDate()+n);return iso(d)};
const an=new Date().getFullYear();
const init=new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors=['btp'];S.tables.companies[0].sectors_locked=true;S.tables.company_members[0].role='Administrateur';})()");
const data=[
 {type:'client',id:'c1',name:'Société Delmas',phone:'3700-1',address:''},
 {type:'site',id:'s1',number:'CH-'+an+'-0001',name:'Villa Pétion-Ville',clientId:'c1',address:'Pétion-Ville',start:jours(-60),end:'',retPct:5,budget:30000,status:'encours',
  lines:[{id:'l1',label:'Maçonnerie',unit:'m²',qty:100,pu:500},{id:'l2',label:'Peinture',unit:'m²',qty:200,pu:100}],avances:[{id:'a1',date:jours(-55),amount:7000,mode:'caisse',entryId:'',status:'valide'}],staff:[{id:'m1',name:'Pierre Noël',role:'Conducteur de travaux',phone:'3600-1'}]},
 {type:'sit',id:'z1',number:'DC-'+an+'-0001',n:1,date:jours(-45),siteId:'s1',clientId:'c1',cum:{l1:20},lignes:[{id:'l1',label:'Maçonnerie',unit:'m²',qty:100,pu:500,prevQty:0,cumQty:20,montant:10000}],marche:70000,cumHt:10000,prevHt:0,ht:10000,tcaRate:10,tca:1000,ttc:11000,retPct:5,retenue:500,recup:700,net:9800,entryId:'',status:'emise',payments:[]},
 {type:'dep',id:'d1',date:jours(-20),siteId:'s1',kind:'materiaux',supplier:'',label:'Ciment',amount:40000,mode:'caisse',entryId:'',status:'valide',settlements:[]},
 {type:'dep',id:'d2',date:jours(-40),siteId:'s1',kind:'soustraitance',supplier:'Tito Maçon',label:'Coffrage',amount:5000,mode:'apayer',entryId:'',status:'valide',settlements:[]}];
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const {p,errs}=await boot(b,{settings:{companyName:'BTP Test',currency:'HTG',taxRate:10},primary:true,cats:{btp:data},pageInit:init});await p.waitForTimeout(1200);
await g(p,'bt-tab-chantiers').click();await p.waitForTimeout(350);
const lignes=await g(p,'bt-ch-ligne').count(); ok('chantier listé',lignes>=1,lignes);
if(lignes){ await g(p,'bt-ch-ouvrir').first().click(); await p.waitForTimeout(350); }
await g(p,'bt-sub-marche').click(); await p.waitForTimeout(350);
for (const [id,ext] of [['bt-chantier-excel','xlsx'],['bt-chantier-word','docx']]) {
  const n=await g(p,id).count(); ok(id+' présent (chantier avec travaux)',n>=1,n);
  if(!n) continue;
  const [dl]=await Promise.all([p.waitForEvent('download',{timeout:20000}).catch(e=>null),g(p,id).first().click()]);
  if(!dl){ ok(id+' : téléchargement déclenché',false,'aucun téléchargement'); continue; }
  const f='/tmp/x2-'+ext+'.'+ext; await dl.saveAs(f); const buf=fs.readFileSync(f);
  ok(id+' : archive '+ext+' valide', buf.slice(0,2).toString()==='PK' && buf.length>2000, buf.length);
  ok(id+' : nom de fichier', dl.suggestedFilename().endsWith('.'+ext), dl.suggestedFilename());
}
ok('aucune erreur JS',errs.length===0,errs);
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

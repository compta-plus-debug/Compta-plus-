// v291 — bloc Immobilier et location : biens, locataires, baux (dépôt de garantie), loyers (émission, encaissement, retards), avis et quittances, dépenses, rapports, statistiques, accueil (Vendeur), petits écrans.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const iso=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const jours=(n)=>{const d=new Date();d.setHours(12);d.setDate(d.getDate()+n);return iso(d)};
const S='[\\s\\u202f\\u00a0]?';const re=(a,b)=>new RegExp(a+S+b);
const mk=(role)=>new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors=['immobilier'];S.tables.companies[0].sectors_locked=true;S.tables.company_members[0].role="+JSON.stringify(role)+";})()");
const tab=async(p,id)=>{await g(p,'im-tab-'+id).click();await p.waitForTimeout(350)};
const cat=(p,c)=>p.evaluate((c)=>window.__srv.getCat(c)||[],c);
const sum=(e,acc)=>e.reduce((s,x)=>s+x.lines.filter(l=>l.account===acc).reduce((a,l)=>a+l.debit-l.credit,0),0);
const an=new Date().getFullYear();
const mois=(n)=>jours(n).slice(0,7);
const data=[
 {type:'property',id:'p1',name:'Appartement 2B',kind:'Appartement',address:'Delmas 33',notes:'',active:true},
 {type:'property',id:'p2',name:'Local commercial 1',kind:'Local commercial',address:'Pétion-Ville',notes:'',active:true},
 {type:'property',id:'p3',name:'Studio 5',kind:'Studio',address:'Tabarre',notes:'',active:true},
 {type:'tenant',id:'t1',name:'Marie Joseph',phone:'3700-1',address:''},
 {type:'tenant',id:'t2',name:'Paul Étienne',phone:'',address:''},
 {type:'lease',id:'b1',number:'BA-'+an+'-0001',propertyId:'p1',tenantId:'t1',start:jours(-200),end:'',rent:10000,charges:1000,dueDay:5,deposit:20000,depositStatus:'',status:'actif'},
 {type:'lease',id:'b2',number:'BA-'+an+'-0002',propertyId:'p2',tenantId:'t2',start:jours(-300),end:jours(-100),rent:15000,charges:0,dueDay:1,deposit:0,depositStatus:'',status:'actif'},
 {type:'rent',id:'r0',number:'LY-'+an+'-0001',date:jours(-70),period:mois(-70),dueDate:mois(-70)+'-05',leaseId:'b1',propertyId:'p1',tenantId:'t1',rent:10000,charges:1000,ht:11000,tcaRate:0,tca:0,total:11000,entryId:'',status:'emise',payments:[]}];

const fs=require('fs');
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const {p,errs}=await boot(b,{settings:{companyName:'Immo Test',currency:'HTG'},primary:true,cats:{immo:data},pageInit:mk('Administrateur')});
await p.waitForTimeout(1200);
await tab(p,'rapports');
for (const [id,ext] of [['im-rapport-excel-bien','xlsx'],['im-rapport-word-bien','docx'],['im-rapport-excel-imp','xlsx'],['im-rapport-word-imp','docx']]) {
  ok(id+' présent',(await g(p,id).count())===1);
  const [dl]=await Promise.all([p.waitForEvent('download',{timeout:20000}).catch(()=>null),g(p,id).click()]);
  if(!dl){ok(id+' : téléchargement',false,'aucun');continue;}
  const f='/tmp/x7-'+id+'.'+ext; await dl.saveAs(f); const buf=fs.readFileSync(f);
  ok(id+' : archive '+ext+' valide',buf.slice(0,2).toString()==='PK'&&buf.length>2000,buf.length);
}
ok('aucune erreur JS',errs.length===0,errs);
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

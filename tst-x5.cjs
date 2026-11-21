// v289 — bloc Transport et logistique : véhicules et échéances, chauffeurs, clients, voyages (bordereau), factures et encaissements, dépenses, rapports de rentabilité, statistiques, régulation (Vendeur), petits écrans.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const iso=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const jours=(n)=>{const d=new Date();d.setHours(12);d.setDate(d.getDate()+n);return iso(d)};
const S='[\\s\\u202f\\u00a0]?';const re=(a,b)=>new RegExp(a+S+b);
const mk=(role)=>new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors=['transport'];S.tables.companies[0].sectors_locked=true;S.tables.company_members[0].role="+JSON.stringify(role)+";})()");
const tab=async(p,id)=>{await g(p,'tr-tab-'+id).click();await p.waitForTimeout(350)};
const cat=(p,c)=>p.evaluate((c)=>window.__srv.getCat(c)||[],c);
const sum=(e,acc)=>e.reduce((s,x)=>s+x.lines.filter(l=>l.account===acc).reduce((a,l)=>a+l.debit-l.credit,0),0);
const trip=(id,n,date,cl,v,d,price,km,status,inv)=>({type:'trip',id,number:n,date,clientId:cl,vehicleId:v,driverId:d,from:'Port-au-Prince',to:'Cap-Haïtien',desc:'',km,price,status,invoiceId:inv||''});
const data=[
 {type:'vehicle',id:'v1',plate:'AB-1234',kind:'Camion',model:'Isuzu',capacity:'5 t',odometer:1200,nextServiceDate:'',nextServiceKm:1000,docs:[{id:'dc1',label:'Assurance',date:jours(-10)}],active:true},
 {type:'vehicle',id:'v2',plate:'CD-5678',kind:'Camionnette',model:'Toyota',capacity:'',odometer:500,nextServiceDate:'',nextServiceKm:0,docs:[],active:true},
 {type:'driver',id:'d1',name:'Jean Baptiste',phone:'',license:'P-1',licenseExpiry:jours(10),active:true},
 {type:'client',id:'c1',name:'Quincaillerie Delmas',phone:'3700-1',address:''},
 {type:'client',id:'c2',name:'Marché Croix-des-Bossales',phone:'',address:''},
 trip('t0','VY-2026-0001',jours(-45),'c2','v2','d1',4000,80,'livre','i1'),
 trip('t1','VY-2026-0002',jours(-3),'c1','v1','d1',5000,100,'livre'),
 trip('t2','VY-2026-0003',jours(-2),'c1','v1','d1',3000,50,'livre'),
 trip('t3','VY-2026-0004',jours(2),'c2','v1','d1',2000,0,'planifie'),
 {type:'invoice',id:'i1',number:'FT-2026-0001',date:jours(-45),clientId:'c2',tripIds:['t0'],lines:[{id:'l0',tripId:'t0',label:'VY-2026-0001',amount:4000}],ht:4000,tcaRate:0,tca:0,total:4000,entryId:'',status:'emise',payments:[]},
 {type:'expense',id:'e1',date:jours(-2),vehicleId:'v1',kind:'carburant',label:'Carburant',liters:0,amount:1000,mode:'caisse',odometer:0,entryId:'',status:'valide'},
 {type:'expense',id:'e2',date:jours(-1),vehicleId:'v1',kind:'entretien',label:'Vidange',liters:0,amount:500,mode:'caisse',odometer:0,entryId:'',status:'valide'}];

const fs=require('fs');
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const {p,errs}=await boot(b,{settings:{companyName:'Trans Test',currency:'HTG',taxRate:10},primary:true,cats:{transport:data},pageInit:mk('Administrateur')});
await p.waitForTimeout(1200);
await tab(p,'rapports');
for (const [id,ext] of [['tr-rapport-excel','xlsx'],['tr-rapport-word','docx']]) {
  ok(id+' présent',(await g(p,id).count())===1);
  const [dl]=await Promise.all([p.waitForEvent('download',{timeout:20000}).catch(()=>null),g(p,id).click()]);
  if(!dl){ok(id+' : téléchargement',false,'aucun');continue;}
  const f='/tmp/x5-'+ext+'.'+ext; await dl.saveAs(f); const buf=fs.readFileSync(f);
  ok(id+' : archive '+ext+' valide', buf.slice(0,2).toString()==='PK'&&buf.length>2000, buf.length);
}
ok('aucune erreur JS',errs.length===0,errs);
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

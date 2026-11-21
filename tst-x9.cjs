// v287 — bloc Santé refondu : tableau de bord guidé, à faire, filtres et totaux, facture A4 ou ticket, rapports par période (praticien, ancienneté assureurs), statistiques, petits écrans.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const iso=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const jours=(n)=>{const d=new Date();d.setHours(12);d.setDate(d.getDate()+n);return iso(d)};
const S='[\\s\\u202f\\u00a0]?';const re=(a,b)=>new RegExp(a+S+b);
const mk=(role)=>new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors=['sante'];S.tables.companies[0].sectors_locked=true;S.tables.company_members[0].role="+JSON.stringify(role)+";})()");
const tab=async(p,id)=>{await g(p,'sante-tab-'+id).click();await p.waitForTimeout(350)};
const E='cabinet';
const inv=(id,n,date,pid,prid,ins,total,insAmt,patAmt,hono,pays,status,lbl)=>({type:'invoice',id,number:n,date,patientId:pid,practitionerId:prid,insurerId:ins,insurerPct:ins?80:0,total,insurerAmount:insAmt,patientAmount:patAmt,honoraires:hono,lines:[{id:id+'l',label:lbl||'Consultation',qty:1,unit:total,cat:'consultation'}],payments:pays,claims:[],adjusts:[],status:status||'emise',etab:E});
const sante=[
 {type:'insurer',id:'ins1',name:'Assurance Alpha',phone:'',email:'',defaultPct:80,etab:E},
 {type:'practitioner',id:'pr1',name:'Dr Jean',specialty:'Généraliste',share:30,etab:E},
 {type:'patient',id:'p1',number:'PAT-0001',name:'Marie Pierre',phone:'3700-1111',insurerId:'ins1',policy:'P-1',etab:E},
 {type:'patient',id:'p2',number:'PAT-0002',name:'Paul Louis',phone:'3700-2222',insurerId:'',policy:'',etab:E},
 {type:'act',id:'a1',code:'',label:'Consultation',price:1000,cat:'consultation',productId:'',etab:E},
 inv('i1','FS-2026-0001',jours(-45),'p1','pr1','ins1',1000,800,200,300,[]),
 inv('i2','FS-2026-0002',jours(0),'p2','','',500,0,500,0,[{id:'pa1',amount:500,date:jours(0),mode:'caisse',status:'valide'}]),
 inv('i3','FS-2026-0003',jours(-5),'p2','','',999,0,999,0,[],'annulee')];
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const fs=require('fs');
const {p,errs}=await boot(b,{settings:{companyName:'Cabinet Test',currency:'HTG'},primary:true,cats:{sante},pageInit:mk('Administrateur')});await p.waitForTimeout(1200);
await tab(p,'rapports');
for (const [id,ext] of [['sante-fact-excel','xlsx'],['sante-fact-word','docx'],['sante-enc-excel','xlsx'],['sante-enc-word','docx']]) {
  ok(id+' présent',(await g(p,id).count())===1);
  const [dl]=await Promise.all([p.waitForEvent('download',{timeout:20000}).catch(()=>null),g(p,id).click()]);
  if(!dl){ok(id+' : téléchargement',false,'aucun');continue;}
  const f='/tmp/x9-'+id+'.'+ext; await dl.saveAs(f); const buf=fs.readFileSync(f);
  ok(id+' : archive '+ext+' valide',buf.slice(0,2).toString()==='PK'&&buf.length>2000,buf.length);
}
ok('aucune erreur JS',errs.length===0,errs);
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

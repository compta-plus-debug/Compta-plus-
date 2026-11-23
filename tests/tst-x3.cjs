// v348 — exports Excel et Word d'un fonds affecté (bloc ONG) : fiche, dons, dépenses, virements.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');const fs=require('fs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const iso=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const yr=new Date().getFullYear();const today=iso(new Date());
const mk=(sec,role)=>new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors="+JSON.stringify(sec)+";S.tables.companies[0].sectors_locked=true;S.tables.company_members[0].role="+JSON.stringify(role)+";})()");
const data=[
 {type:'config',id:'cf',orgType:'ong'},
 {type:'contact',id:'c1',name:'UNICEF Haïti',kind:'bailleur',phone:'',email:'',address:'Port-au-Prince'},
 {type:'membre',id:'m1',number:'MB-'+(yr-1)+'-0001',name:'Marie Joseph',phone:'',address:'',joined:(yr-1)+'-01-01',cotis:500,period:'annuelle',status:'actif'},
 {type:'fonds',id:'f1',number:'FD-'+yr+'-0001',name:'Projet Eau',bailleurId:'c1',budget:100000,start:yr+'-01-01',end:yr+'-12-31',desc:'',status:'actif'},
 {type:'don',id:'dn1',number:'RC-'+yr+'-0001',date:today,kind:'subvention',donorId:'c1',memberId:'',donorName:'',fondId:'f1',amount:60000,mode:'banque',label:'Subvention 1',entryId:'',status:'valide',by:''},
 {type:'dep',id:'dp1',date:today,kind:'activites',label:'Pompes',supplier:'Fournisseur X',amount:25000,mode:'caisse',fondId:'f1',depassement:false,entryId:'',status:'valide',settlements:[],by:''}];
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const {p,errs}=await boot(b,{settings:{companyName:'Association Espoir',currency:'HTG'},primary:true,cats:{ong:data},pageInit:mk(['ong'],'Administrateur')});await p.waitForTimeout(1500);
ok('espace ONG ouvert',(await g(p,'ong-module').count())===1,0);
await g(p,'og-tab-fonds').click();await p.waitForTimeout(400);
for (const [id,ext] of [['og-fonds-excel','xlsx'],['og-fonds-word','docx']]) {
  const n=await g(p,id).count(); ok(id+' présent sur le fonds',n>=1,n);
  if(!n) continue;
  const [dl]=await Promise.all([p.waitForEvent('download',{timeout:20000}).catch(()=>null),g(p,id).first().click()]);
  if(!dl){ ok(id+' : téléchargement déclenché',false,'aucun'); continue; }
  const f='/tmp/x3-'+ext+'.'+ext; await dl.saveAs(f); const buf=fs.readFileSync(f);
  ok(id+' : archive '+ext+' valide', buf.slice(0,2).toString()==='PK' && buf.length>2000, buf.length);
}
ok('aucune erreur JS',errs.length===0,errs);
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

// v350 — export Word et Excel du journal des séjours (hôtellerie), onglet Rapports.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');const fs=require('fs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const fmt=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const add=(n)=>{const d=new Date();d.setHours(12);d.setDate(d.getDate()+n);return fmt(d)};
const init=new Function("(function(){try{localStorage.clear()}catch(e){}var c=window.__srv.tables.companies[0];c.plan_tier='assisted';c.sectors=['restauration'];c.sectors_locked=true;})();");
const d0=add(-3);
const inv={number:'FH-2026-0001',date:add(-1),status:'payee',nights:2,rate:2000,adults:2,heberg:4000,services:600,sejour:200,sejourRate:50,tca:460,total:5260,deposits:1000,payments:[{mode:'especes',amount:4000},{mode:'banque',amount:260}]};
const hotel=[{type:'roomtype',id:'t1',name:'Double',capacity:2,price:2000},{type:'room',id:'r1',number:'102',typeId:'t1',menage:'propre'},{type:'guest',id:'g1',name:'Marie Dupont',phone:'3700'},{type:'booking',id:'b1',number:'RS-2026-0001',guestId:'g1',roomId:'r1',from:d0,to:add(-1),departed:add(-1),adults:2,children:0,rate:2000,status:'partie',extras:[{id:'x1',date:add(-2),label:'Petit-déjeuner',qty:2,unit:300}],deposits:[],invoice:inv,createdAt:new Date().toISOString()}];
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const {p,errs}=await boot(b,{settings:{companyName:'Hôtel Test',currency:'HTG'},primary:true,cats:{hotel},pageInit:init});
await p.getByText('Hôtellerie',{exact:true}).last().click();await p.waitForTimeout(800);
await g(p,'hotel-tab-rapports').click();await p.waitForTimeout(400);
for (const [id,ext] of [['hotel-journal-excel','xlsx'],['hotel-journal-word','docx']]) {
  ok(id+' présent',(await g(p,id).count())===1);
  const [dl]=await Promise.all([p.waitForEvent('download',{timeout:20000}).catch(()=>null),g(p,id).click()]);
  if(!dl){ok(id+' : téléchargement',false,'aucun');continue;}
  const f='/tmp/x6-'+ext+'.'+ext; await dl.saveAs(f); const buf=fs.readFileSync(f);
  ok(id+' : archive '+ext+' valide',buf.slice(0,2).toString()==='PK'&&buf.length>2000,buf.length);
}
ok('aucune erreur JS',errs.length===0,errs);
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

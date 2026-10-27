// v283 — petits écrans : aucune page ne déborde en largeur (tableaux défilent dans leur cadre), onglets Rapports Hôtellerie et Restauration.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const fmt=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const add=(n)=>{const d=new Date();d.setHours(12);d.setDate(d.getDate()+n);return fmt(d)};
const init=new Function("(function(){try{localStorage.clear()}catch(e){}var c=window.__srv.tables.companies[0];c.plan_tier='assisted';c.sectors=['restauration'];c.sectors_locked=true;})();");
const d0=add(-3);
const inv={number:'FH-2026-0001',date:add(-1),status:'payee',nights:2,rate:2000,adults:2,heberg:4000,services:600,sejour:200,sejourRate:50,tca:460,total:5260,deposits:1000,payments:[{mode:'especes',amount:4000},{mode:'banque',amount:260}]};
const hotel=[{type:'roomtype',id:'t1',name:'Double',capacity:2,price:2000},{type:'room',id:'r1',number:'102',typeId:'t1',menage:'propre'},{type:'guest',id:'g1',name:'Marie Dupont',phone:'3700'},{type:'booking',id:'b1',number:'RS-2026-0001',guestId:'g1',roomId:'r1',from:d0,to:add(-1),departed:add(-1),adults:2,children:0,rate:2000,status:'partie',extras:[{id:'x1',date:add(-2),label:'Petit-déjeuner',qty:2,unit:300}],deposits:[],invoice:inv,createdAt:new Date().toISOString()}];
const larg=async(p)=>p.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,bw:document.body.scrollWidth}));
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p}=await boot(b,{settings:{companyName:'Hôtel Test',currency:'HTG'},primary:true,cats:{hotel},pageInit:init});
 await p.addStyleTag({content:'.grid{display:grid}.gap-4{gap:1rem}.gap-3{gap:.75rem}.grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.grid-cols-1{grid-template-columns:repeat(1,minmax(0,1fr))}.mb-4{margin-bottom:1rem}.mb-5{margin-bottom:1.25rem}.p-4{padding:1rem}'});await p.setViewportSize({width:390,height:800});await p.waitForTimeout(400);
 await p.getByText('Hôtellerie',{exact:true}).last().click();await p.waitForTimeout(800);
 for(const t of ['apercu','planning','resa','chambres','clients','factures','rapports','stats']){
  if(!(await g(p,'hotel-tab-'+t).count())){await p.locator('button[aria-label*="enu"], button:has(svg)').first().click().catch(()=>{});}
  await g(p,'hotel-tab-'+t).click();await p.waitForTimeout(400);
  const w=await larg(p);ok('390 px : onglet '+t+' sans débordement de page',w.sw<=w.cw+1,w);}
 await g(p,'hotel-tab-rapports').click();await p.waitForTimeout(300);
 const cadres=await p.locator('.ec-wrap').evaluateAll(e=>e.map(x=>({sw:x.scrollWidth,cw:x.clientWidth,r:x.getBoundingClientRect().right})));
 ok('cadres de tableaux dans l\'écran',cadres.length>=4&&cadres.every(c=>c.r<=391),cadres);
 await p.close();}
await b.close();console.log(fails?'ÉCHEC u30':'OK u30');process.exit(fails?1:0)})();

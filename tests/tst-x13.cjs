// v293 — bloc BTP et construction : clients, chantiers et bordereau de prix, avance, situations de travaux (retenue de garantie, récupération de l'avance), encaissements, libération de la retenue, dépenses et dettes, rapports, statistiques, secrétariat (Vendeur), petits écrans.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const iso=(d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const jours=(n)=>{const d=new Date();d.setHours(12);d.setDate(d.getDate()+n);return iso(d)};
const S='[\\s\\u202f\\u00a0]?';const re=(a,b)=>new RegExp('^'+a+S+b);
const mk=(role)=>new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors=['btp'];S.tables.companies[0].sectors_locked=true;S.tables.company_members[0].role="+JSON.stringify(role)+";})()");
const sub=async(p,id)=>{await g(p,'bt-sub-'+id).click();await p.waitForTimeout(250)};
const tab=async(p,id)=>{await g(p,'bt-tab-'+id).click();await p.waitForTimeout(350)};
const cat=(p,c)=>p.evaluate((c)=>window.__srv.getCat(c)||[],c);
const sum=(e,acc)=>e.reduce((s,x)=>s+x.lines.filter(l=>l.account===acc).reduce((a,l)=>a+l.debit-l.credit,0),0);
const an=new Date().getFullYear();
const data=[
 {type:'client',id:'c1',name:'Société Delmas',phone:'3700-1',address:''},
 {type:'client',id:'c2',name:'Mme Pierre',phone:'',address:''},
 {type:'site',id:'s1',number:'CH-'+an+'-0001',name:'Villa Pétion-Ville',clientId:'c1',address:'Pétion-Ville',start:jours(-60),end:'',retPct:5,budget:30000,status:'encours',phases:[{id:'ph1',label:'Fondations',start:jours(2),end:jours(9),pct:0,realStart:'',weight:30}],
  lines:[{id:'l1',label:'Maçonnerie',unit:'m²',qty:100,pu:500},{id:'l2',label:'Peinture',unit:'m²',qty:200,pu:100}],avances:[{id:'a1',date:jours(-55),amount:7000,mode:'caisse',entryId:'',status:'valide'}],staff:[{id:'m1',name:'Pierre Noël',role:'Conducteur de travaux',phone:'3600-1'},{id:'m2',name:'Jean Louis',role:'Chef de chantier',phone:''}]},
 {type:'site',id:'s2',number:'CH-'+an+'-0002',name:'Entrepôt Tabarre',clientId:'c2',address:'',start:jours(-90),end:jours(-10),retPct:0,budget:0,status:'encours',lines:[{id:'l3',label:'Dalle',unit:'m²',qty:10,pu:1000}],avances:[]},
 {type:'sit',id:'z0',number:'DC-'+an+'-0001',n:1,date:jours(-45),siteId:'s2',clientId:'c2',cum:{l3:3},lignes:[{id:'l3',label:'Dalle',unit:'m²',qty:10,pu:1000,prevQty:0,cumQty:3,montant:3000}],marche:10000,cumHt:3000,prevHt:0,ht:3000,tcaRate:0,tca:0,ttc:3000,retPct:0,retenue:0,recup:0,net:3000,entryId:'',status:'emise',payments:[]},
 {type:'dep',id:'d1',date:jours(-20),siteId:'s1',kind:'materiaux',supplier:'',label:'Ciment',amount:40000,mode:'caisse',entryId:'',status:'valide',settlements:[]},
 {type:'dep',id:'d2',date:jours(-40),siteId:'s1',kind:'soustraitance',supplier:'Tito Maçon',label:'Coffrage',amount:5000,mode:'apayer',entryId:'',status:'valide',settlements:[]}];

(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const {p,errs}=await boot(b,{settings:{companyName:'BTP Test',currency:'HTG',taxRate:10},primary:true,cats:{btp:data},pageInit:mk('Administrateur')});
await p.setViewportSize({width:360,height:780});await p.waitForTimeout(1200);
await tab(p,'chantiers');
await p.locator('[data-testid="bt-ch-ligne"]:has-text("Villa")  [data-testid="bt-ch-ouvrir"]').click();await p.waitForTimeout(400);
const m=await p.evaluate(()=>[...document.querySelectorAll('main.compta-bloc table, table.ec-table')].map(t=>{const w=t.parentElement;const first=t.querySelector('tbody td');return {rows:t.rows.length,tw:t.getBoundingClientRect().width,ww:w.getBoundingClientRect().width,sw:w.scrollWidth,cw:w.clientWidth,scrollLeft:w.scrollLeft,first:first?first.innerText.slice(0,30):'',firstW:first?first.getBoundingClientRect().width:0}}));
console.log(JSON.stringify(m,null,0).slice(0,2500));
await p.locator('[data-testid="bt-sub-etapes"]').first().click().catch(()=>{});await p.waitForTimeout(400);
const m2=await p.evaluate(()=>[...document.querySelectorAll('[data-testid="bt-etapes"] table')].map(t=>{const w=t.parentElement;return {rows:t.rows.length,tw:Math.round(t.getBoundingClientRect().width),ww:Math.round(w.getBoundingClientRect().width),sw:w.scrollWidth,cols:[...t.rows[0].cells].map(c=>Math.round(c.getBoundingClientRect().width))}}));console.log('ETAPES '+JSON.stringify(m2));
await p.evaluate(()=>{document.querySelectorAll('.ec-wrap').forEach(w=>{w.scrollLeft=0});});await p.locator('[data-testid="bt-vue-echeance"]').first().scrollIntoViewIfNeeded().catch(()=>{});await p.waitForTimeout(200);await p.locator('[data-testid="bt-etapes"]').first().scrollIntoViewIfNeeded().catch(()=>{});await p.waitForTimeout(200);await p.screenshot({path:'/tmp/x13-etapes.png',fullPage:false});
await p.evaluate(()=>{window.scrollTo(0,0)});await p.locator('[data-testid="bt-ch-ligne"]').first().scrollIntoViewIfNeeded().catch(()=>{});await p.waitForTimeout(200);await p.screenshot({path:'/tmp/x10-liste.png',fullPage:false});
ok('aucune erreur JS',errs.length===0,errs);
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

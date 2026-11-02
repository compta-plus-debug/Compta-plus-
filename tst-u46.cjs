// v314 — écho temps réel de NOTRE propre sauvegarde : il ne doit jamais écraser l'écran (écritures/clients qui « disparaissent puis reviennent »).
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const mk=(sec)=>new Function("(function(){try{localStorage.clear();sessionStorage.clear()}catch(e){}var S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors="+JSON.stringify(sec)+";S.rtEcho=true;S.lat=700;})()");
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const {p}=await boot(b,{settings:{companyName:'Test',currency:'HTG',taxRate:10},primary:true,cats:{services:[{type:'config',id:'cfg',svType:'securite'}]},pageInit:mk(['services'])});
await p.waitForTimeout(1600);
await g(p,'sv-tab-prestations').click();await p.waitForTimeout(300);
for(let i=1;i<=6;i++){await g(p,'sv-prest-nom').fill('Prestation '+i);await g(p,'sv-prest-prix').fill(String(1000*i));await g(p,'sv-prest-ajouter').click();await p.waitForTimeout(120);}
await p.waitForTimeout(400);
const screen=await g(p,'sv-prest-ligne').count();
ok('les 6 lignes restent à l\'écran malgré les échos temps réel',screen===6,screen);
await p.waitForTimeout(30000);
const srv=await p.evaluate(()=>window.__srv.getCat('services')||[]);
ok('les 6 lignes sont bien enregistrées côté serveur',srv.filter(r=>r.type==='prest').length===6,srv.filter(r=>r.type==='prest').length);
ok('toujours 6 lignes à l\'écran après stabilisation',(await g(p,'sv-prest-ligne').count())===6);
await b.close();process.exit(fails?1:0)})();

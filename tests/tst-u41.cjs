// v302 — Réinitialisation : la date de clôture est effacée sur le serveur avant la suppression des pièces ; le résultat est vérifié et signalé.
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
const an=new Date().getFullYear();
const ouvrir=async(p)=>{await tab(p,'chantiers');if((await g(p,'bt-ch-detail').count())===0)await p.locator('[data-testid="bt-ch-ligne"]:has-text("Villa") [data-testid="bt-ch-ouvrir"]').click();await p.waitForTimeout(300)};

const E=(id,d,k)=>({id,date:d,label:'Ecr '+id,kind:k,lines:[{account:'530',debit:100,credit:0},{account:'706',debit:0,credit:100}]});
const go=async(p)=>{await p.getByText('Administration',{exact:false}).first().click();await p.waitForTimeout(800);await p.getByRole('button',{name:/^Données/}).first().click();await p.waitForTimeout(500);
 await p.getByText('Réinitialiser…').last().click();await p.waitForTimeout(300);await p.getByText('Tout cocher (complète)').click();
 p.removeAllListeners('dialog');p.on('dialog',d=>{d.type()==='prompt'?d.accept('RÉINITIALISER'):d.accept()});
 await p.getByText(/Réinitialiser la sélection/).click();await p.waitForTimeout(16000)};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
for(const lock of ['','2026-01-31']){
 const {p}=await boot(b,{settings:{companyName:'X',currency:'HTG',lockDate:lock,lastClosingDate:lock},primary:true,cats:{entries:[E('e1','2026-01-10','btp'),E('e2','2026-03-10',undefined),E('e3','2026-09-10','btp')],btp:[{type:'client',id:'c1',name:'A'}],invoices:[{id:'i1',number:'F1',date:'2026-01-12',items:[],total:100},{id:'i2',number:'F2',date:'2026-03-12',items:[],total:100}],purchases:[{id:'a1',date:'2026-01-05',total:50}]},pageInit:mk('Administrateur')});
 await p.evaluate(()=>{window.__srv.periodeRule=true});await p.waitForTimeout(1200);
 await go(p);
 const r=await p.evaluate(()=>({e:(window.__srv.getCat('entries')||[]).length,i:(window.__srv.getCat('invoices')||[]).length,a:(window.__srv.getCat('purchases')||[]).length,b:(window.__srv.getCat('btp')||[]).length,lock:(window.__srv.getCat('settings')||{}).lockDate||''}));
 ok('période '+(lock||'ouverte')+' : serveur entièrement vide',r.e===0&&r.i===0&&r.a===0&&r.b===0&&r.lock==='',r);
 ok('période '+(lock||'ouverte')+' : rapport « vérifié »',(await p.locator('[data-testid="reset-rapport-ok"]').count())===1,await p.evaluate(()=>document.body.innerText.match(/Réinitialis[^\n]*/g)));
 await p.close();
}
await b.close();console.log(fails?('ÉCHECS '+fails):'TOUT PASSE');process.exit(fails?1:0)})();

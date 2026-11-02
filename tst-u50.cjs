// v316 — Réinitialisation fiable entre appareils : un appareil resté sur d'anciennes données ne ressuscite jamais ce qui a été effacé ailleurs ;
// la réinitialisation remplace le serveur tel quel (même ce qu'un autre appareil y avait ajouté).
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const E=(id)=>({id,date:'2026-03-10',label:'Ecr '+id,lines:[{account:'530',debit:100,credit:0},{account:'706',debit:0,credit:100}]});
const rec=(p,c)=>p.evaluate((c)=>{try{return JSON.parse(window.__srv.kv['compta-'+c])}catch(e){return null}},c);
const go=async(p)=>{await p.getByText('Administration',{exact:false}).first().click();await p.waitForTimeout(800);await p.getByRole('button',{name:/^Données/}).first().click();await p.waitForTimeout(500);
 await p.getByText('Réinitialiser…').last().click();await p.waitForTimeout(300);await p.getByText('Tout cocher (complète)').click();
 p.removeAllListeners('dialog');p.on('dialog',d=>{d.type()==='prompt'?d.accept('RÉINITIALISER'):d.accept()});
 await p.getByText(/Réinitialiser la sélection/).click();await p.waitForTimeout(14000)};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// A) appareil « périmé » : le serveur a été réinitialisé ailleurs
{const {p}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,cats:{entries:[E('e1'),E('e2')],invoices:[{id:'i1',number:'F1',date:'2026-03-10',lines:[],total:100}]}});
 await p.waitForTimeout(1500);
 await p.evaluate(()=>{const S=window.__srv;S.kv['compta-entries']=JSON.stringify({v:99,data:[],reset:'1700000000000-abc'});S.kv['compta-invoices']=JSON.stringify({v:99,data:[],reset:'1700000000000-abc'});});
 await p.getByText('Sauvegarder maintenant').first().click();await p.waitForTimeout(3500);
 const e=await rec(p,'entries'),i=await rec(p,'invoices');
 ok('A : les écritures effacées ailleurs ne ressuscitent pas',e&&e.data.length===0,e);
 ok('A : les factures effacées ailleurs ne ressuscitent pas',i&&i.data.length===0,i);
 ok('A : le marqueur de réinitialisation est conservé',e&&e.reset==='1700000000000-abc');
 ok('A : l\'appareil périmé est averti et mis à jour',/réinitialisées depuis un autre appareil/.test(await p.evaluate(()=>document.body.innerText)));
 await p.close();}
// B) réinitialisation complète alors qu'un autre appareil a ajouté une écriture que celui-ci ne connaît pas
{const {p}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,cats:{entries:[E('e1')]}});
 await p.waitForTimeout(1500);
 await p.evaluate(()=>{const S=window.__srv;const r=JSON.parse(S.kv['compta-entries']);r.v+=5;r.data.push({id:'e9',date:'2026-04-01',label:'Ajout autre appareil',lines:[{account:'530',debit:5,credit:0},{account:'706',debit:0,credit:5}]});S.kv['compta-entries']=JSON.stringify(r);});
 await go(p);
 const e=await rec(p,'entries');
 ok('B : serveur entièrement vide, même l\'ajout d\'un autre appareil',e&&e.data.length===0,e&&e.data.length);
 ok('B : marqueur de réinitialisation posé',e&&/^\d+-/.test(e.reset||''),e&&e.reset);
 ok('B : rapport « vérifié sur le serveur »',(await p.locator('[data-testid="reset-rapport-ok"]').count())===1);
 await p.close();}
await b.close();console.log(fails?('ÉCHECS '+fails):'TOUT PASSE');process.exit(fails?1:0)})();

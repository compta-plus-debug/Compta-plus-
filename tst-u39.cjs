// v300 — BTP : modification du dossier de chantier et des lignes du bordereau. (ancien en-tête : calendrier de supervision, comptes rendus, journal de chantier imprimable, réception provisoire/définitive et réserves, libération de la retenue selon la règle choisie, études et plan du projet.
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
const site=(over)=>({type:'site',id:'s1',number:'CH-'+an+'-0001',name:'Villa',clientId:'c1',address:'Pétion-Ville',start:jours(-40),end:jours(50),retPct:10,budget:0,status:'encours',lines:[{id:'l1',label:'Maçonnerie',unit:'m²',qty:100,pu:1000}],avances:[],staff:[{id:'m1',name:'Pierre Noël',role:'Ingénieur',phone:''}],...over});
const sit={type:'sit',id:'z1',number:'DC-'+an+'-0001',n:1,date:jours(-10),siteId:'s1',clientId:'c1',cum:{l1:100},lignes:[{id:'l1',label:'Maçonnerie',unit:'m²',qty:100,pu:1000,prevQty:0,cumQty:100,montant:100000}],marche:100000,cumHt:100000,prevHt:0,ht:100000,tcaRate:0,tca:0,ttc:100000,retPct:10,retenue:10000,recup:0,net:90000,entryId:'',status:'emise',payments:[]};
const base=[{type:'client',id:'c1',name:'Société Delmas',phone:'',address:''},site({}),sit];
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p}=await boot(b,{settings:{companyName:'BTP Test',currency:'HTG'},primary:true,cats:{btp:[...base,{type:'client',id:'c2',name:'Marie Joseph',phone:'',address:''}]},pageInit:mk('Administrateur')});await p.waitForTimeout(1200);
 await ouvrir(p);
 ok('bouton Modifier présent',(await g(p,'bt-ch-modifier').count())===1);
 await g(p,'bt-ch-modifier').click();await p.waitForTimeout(250);
 ok('formulaire ouvert, retenue figée (situation émise)',(await g(p,'bt-md-form').count())===1&&await g(p,'bt-md-retenue').isDisabled());
 await g(p,'bt-md-nom').fill('');await g(p,'bt-md-enregistrer').click();await p.waitForTimeout(250);
 ok('nom vide refusé',(await g(p,'bt-md-form').count())===1);
 await g(p,'bt-md-nom').fill('Villa Delmas');await g(p,'bt-md-fin').fill(jours(-60));await g(p,'bt-md-enregistrer').click();await p.waitForTimeout(250);
 ok('fin avant début refusée',(await g(p,'bt-md-form').count())===1);
 await g(p,'bt-md-fin').fill(jours(80));await g(p,'bt-md-debut').fill(jours(-5));await g(p,'bt-md-enregistrer').click();await p.waitForTimeout(250);
 ok('début postérieur à la situation refusé',(await g(p,'bt-md-form').count())===1);
 await g(p,'bt-md-debut').fill(jours(-45));await g(p,'bt-md-adresse').fill('Delmas 33');await g(p,'bt-md-client').selectOption('c2');await g(p,'bt-md-enregistrer').click();await p.waitForTimeout(350);
 let s=(await cat(p,'btp')).find(r=>r.id==='s1');
 ok('modifications enregistrées',s.name==='Villa Delmas'&&s.address==='Delmas 33'&&s.clientId==='c2'&&s.start===jours(-45)&&s.end===jours(80)&&s.retPct===10,s);
 ok('formulaire refermé',(await g(p,'bt-md-form').count())===0);
 // lignes : quantité figée mais désignation modifiable
 await sub(p,'marche');
 ok('quantité non modifiable après situation',(await g(p,'bt-ligne-qte').count())===0);
 const lab=g(p,'bt-ligne-label').first();await lab.fill('Maçonnerie de fondation');await lab.blur();await p.waitForTimeout(350);
 s=(await cat(p,'btp')).find(r=>r.id==='s1');
 ok('désignation de ligne modifiée',s.lines[0].label==='Maçonnerie de fondation',s.lines);
}
{const {p}=await boot(b,{settings:{companyName:'BTP Test',currency:'HTG'},primary:true,cats:{btp:[{type:'client',id:'c1',name:'Société Delmas',phone:'',address:''},site({})]},pageInit:mk('Administrateur')});await p.waitForTimeout(1200);
 await ouvrir(p);await sub(p,'marche');
 const q=g(p,'bt-ligne-qte').first(),pu=g(p,'bt-ligne-pu').first();
 ok('sans situation : quantité et prix modifiables',(await q.count())===1&&(await pu.count())===1);
 await q.fill('120');await q.blur();await p.waitForTimeout(250);await pu.fill('1500');await pu.blur();await p.waitForTimeout(350);
 let s=(await cat(p,'btp')).find(r=>r.id==='s1');
 ok('quantité et prix enregistrés',s.lines[0].qty===120&&s.lines[0].pu===1500,s.lines);
 await g(p,'bt-ch-modifier').click().catch(()=>{});
}
{const {p}=await boot(b,{settings:{companyName:'BTP Test',currency:'HTG'},primary:true,cats:{btp:base},pageInit:mk('Lecteur')});await p.waitForTimeout(1200);
 await ouvrir(p);
 ok('lecteur : pas de bouton Modifier',(await g(p,'bt-ch-modifier').count())===0);
}
await b.close();console.log(fails?('ÉCHECS '+fails):'TOUT PASSE');process.exit(fails?1:0)})();

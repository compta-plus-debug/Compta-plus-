const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const idbKeys=(p)=>p.evaluate(()=>new Promise(r=>{const rq=indexedDB.open('compta-plus-offline-v1');rq.onsuccess=()=>{const g=rq.result.transaction('kv').objectStore('kv').getAllKeys();g.onsuccess=()=>r(g.result)};rq.onerror=()=>r([])}));
const supNames=(p)=>p.evaluate(()=>{const v=window.__srv.getCat('suppliers');return (v||[]).map(x=>x.name)});
const addSupplier=async(p,name)=>{await p.getByText('Achat et fournisseurs',{exact:true}).first().click();await p.waitForTimeout(400);await p.getByRole('button',{name:'Fournisseurs',exact:true}).first().click();await p.waitForTimeout(300);
 await p.locator('input').first().fill(name);await p.getByRole('button',{name:'Ajouter',exact:true}).first().click();await p.waitForTimeout(600)};
const pageInit=(extra)=>()=>{try{localStorage.removeItem('compta-plus-active-tab')}catch(e){}};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const ctx=await b.newContext({viewport:{width:1100,height:800}});
const sups0=[{id:'s1',name:'Alpha',contact:''}];
// 1. en ligne : cache rempli
let {p,errs}=await boot(b,{ctx,cats:{suppliers:sups0},settings:{companyName:"Lakay SA",currency:"HTG"},primary:true,pageInit:()=>{try{localStorage.removeItem('compta-plus-active-tab');window.__srv.offlineHang=true}catch(e){}}});
await p.waitForTimeout(1500);
let keys=await idbKeys(p);
ok('cache local rempli (fournisseurs)',keys.includes('cache:c1:suppliers'),keys.slice(0,5));
ok('cache de toutes les catégories',keys.filter(k=>k.startsWith('cache:c1:')).length>=20,keys.length);
const meta=await p.evaluate(()=>JSON.parse(localStorage.getItem('compta-plus-hl-meta')||'null'));
ok('mémo d\'identité enregistré',!!meta&&meta.bootOk===true&&meta.email==='a@x.com'&&meta.companyId==='c1',meta&&Object.keys(meta));
// 2. hors ligne : ajout d'un fournisseur → gardé sur l'appareil
await ctx.setOffline(true);await p.waitForTimeout(500);
await addSupplier(p,'Beta');await p.waitForTimeout(1500);
keys=await idbKeys(p);
ok('modification hors ligne gardée (pend)',keys.includes('pend:c1:suppliers'),keys.filter(k=>k.startsWith('pend')));
ok('serveur inchangé',(await supNames(p)).join()==='Alpha');
ok('bandeau « en attente »',await p.locator('[data-hl="banner-pending"]').count()===1);
const kv1=await p.evaluate(()=>JSON.parse(JSON.stringify(window.__srv.kv)));
await p.close();
// 3. redémarrage SANS réseau (session ouverte sur l'appareil, jeton expiré)
await p.context().route('**/__none__',r=>r.abort());
await p.evaluate(()=>{}).catch(()=>{});
const pi=()=>{try{localStorage.removeItem('compta-plus-active-tab');localStorage.setItem('sb-test-auth-token','{"user":{"email":"a@x.com"}}')}catch(e){}};
let r2=await boot(b,{ctx,kv:kv1,pageInit:()=>{try{localStorage.removeItem('compta-plus-active-tab');localStorage.setItem('sb-test-auth-token','{"user":{"email":"a@x.com"}}');window.__srv.sessionNull=true;window.__srv.offlineHang=true}catch(e){}}});
p=r2.p;await p.waitForTimeout(2500);
let txt=await p.evaluate(()=>document.body.innerText);
ok('démarrage hors ligne : application affichée (pas l\'écran de connexion)',/Achat et fournisseurs/.test(txt)&&!/Recevoir le lien/.test(txt),txt.slice(0,160));
ok('bandeau hors ligne avec date des données',/données enregistrées le/.test(txt),txt.slice(0,200));
await p.getByText('Achat et fournisseurs',{exact:true}).first().click();await p.waitForTimeout(400);await p.getByRole('button',{name:'Fournisseurs',exact:true}).first().click();await p.waitForTimeout(400);
txt=await p.evaluate(()=>document.body.innerText);
ok('données du cache + modification hors ligne visibles (Alpha, Beta)',/Alpha/.test(txt)&&/Beta/.test(txt),txt.slice(0,300));
await addSupplier(p,'Gamma');await p.waitForTimeout(1500);
keys=await idbKeys(p);ok('pend toujours présent après 2e ajout',keys.includes('pend:c1:suppliers'));
const kv2=await p.evaluate(()=>JSON.parse(JSON.stringify(window.__srv.kv)));
// 4. retour du réseau : rechargement déclenché
let navigated=false;p.on('framenavigated',()=>{navigated=true});
await ctx.setOffline(false);await p.waitForTimeout(3500);
ok('rechargement automatique au retour du réseau',navigated);
await p.close().catch(()=>{});
// 5. redémarrage EN LIGNE : fusion + synchronisation sans doublon
let r3=await boot(b,{ctx,kv:kv2,pageInit:pageInit()});p=r3.p;
await p.waitForFunction(()=>{const v=window.__srv.getCat('suppliers');return v&&v.length>=3},null,{timeout:20000}).catch(()=>{});
const names=await supNames(p);
ok('serveur : Alpha, Beta, Gamma (sans doublon)',names.length===3&&['Alpha','Beta','Gamma'].every(n=>names.includes(n)),names);
await p.waitForTimeout(1500);
keys=await idbKeys(p);ok('pend effacé après synchronisation',!keys.includes('pend:c1:suppliers'),keys.filter(k=>k.startsWith('pend')));
ok('bandeau « en attente » disparu',await p.locator('[data-hl="banner-pending"]').count()===0);
ok('aucune erreur JS (en ligne)',r3.errs.length===0,r3.errs.slice(0,3));
await p.close();
// 6. refus du démarrage hors ligne si PIN d'entreprise
await ctx.setOffline(true);
await (async()=>{const pg=await ctx.newPage();await pg.route('http://app.test/**',r=>r.fulfill({contentType:'text/html',body:'x'}));await pg.goto('http://app.test/');await pg.evaluate(()=>{const m=JSON.parse(localStorage.getItem('compta-plus-hl-meta'));m.membership.hasSecurityPin=true;localStorage.setItem('compta-plus-hl-meta',JSON.stringify(m))});await pg.close()})();
let r4=await boot(b,{ctx,kv:kv2,pageInit:()=>{try{localStorage.removeItem('compta-plus-active-tab');window.__srv.sessionNull=true;window.__srv.offlineHang=true}catch(e){}}});
await r4.p.waitForTimeout(2000);txt=await r4.p.evaluate(()=>document.body.innerText);
ok('PIN d\'entreprise : pas de démarrage hors ligne',!/Achat et fournisseurs/.test(txt),txt.slice(0,120));
// 6b. appareil sans mémoire d'identité : message clair (jamais un chargement sans fin)
await ctx.setOffline(true);
{const pg=await ctx.newPage();await pg.route('http://app.test/**',r=>r.fulfill({contentType:'text/html',body:'x'}));await pg.goto('http://app.test/');await pg.evaluate(()=>localStorage.removeItem('compta-plus-hl-meta'));await pg.close()}
let r5=await boot(b,{ctx,kv:kv2,pageInit:()=>{try{localStorage.removeItem('compta-plus-active-tab');window.__srv.sessionNull=true;window.__srv.offlineHang=true}catch(e){}}});
await r5.p.waitForSelector('[data-hl="offline-blocked"]',{timeout:15000}).catch(()=>{});
ok('sans mémoire d\'identité : message explicite au lieu de « Chargement » sans fin',await r5.p.locator('[data-hl="offline-blocked"]').count()===1,(await r5.p.evaluate(()=>document.body.innerText)).slice(0,100));
// 8. réseau instable : « en ligne » pour le navigateur mais le serveur ne répond pas
await ctx.setOffline(false);
{const pg=await ctx.newPage();await pg.route('http://app.test/**',r=>r.fulfill({contentType:'text/html',body:'x'}));await pg.goto('http://app.test/');await pg.evaluate((m)=>localStorage.setItem('compta-plus-hl-meta',m),JSON.stringify(meta));await pg.close()}
const t0=Date.now();
let r6=await boot(b,{ctx,kv:kv2,pageInit:()=>{try{localStorage.removeItem('compta-plus-active-tab');localStorage.setItem('sb-test-auth-token','{"user":{"email":"a@x.com"}}');window.__srv.sessionNull=true;window.__srv.offlineHang=true;window.__srv.net=false}catch(e){}}});
await r6.p.waitForFunction(()=>/Achat et fournisseurs/.test(document.body.innerText),null,{timeout:60000}).catch(()=>{});
const txt6=await r6.p.evaluate(()=>document.body.innerText);
ok('réseau instable : application ouverte depuis le cache (sans écran d\'erreur de connexion)',/Achat et fournisseurs/.test(txt6)&&!/Connexion refus/.test(txt6),txt6.slice(0,150));
console.log('   délai',Math.round((Date.now()-t0)/1000),'s');
await b.close();console.log(fails?'ECHECS '+fails:'OK');process.exit(fails?1:0)})();

// v245 — entreprise protégée par un code PIN : après une saisie du PIN EN LIGNE sur l'appareil, l'ouverture sans
// internet est possible pendant 7 jours (sans nouvelle saisie) ; au-delà, pour un autre compte, ou sans saisie
// préalable, elle reste refusée avec une explication claire. La trace ne contient jamais le PIN.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const KEY='compta-plus-pin-offline-c1';
const setLS=async(ctx,fn,arg)=>{const pg=await ctx.newPage();await pg.route('http://app.test/**',r=>r.fulfill({contentType:'text/html',body:'x'}));await pg.goto('http://app.test/');const out=await pg.evaluate(fn,arg);await pg.close();return out};
const offInit=()=>{try{localStorage.removeItem('compta-plus-active-tab');localStorage.setItem('sb-test-auth-token','{"user":{"email":"a@x.com"}}');window.__srv.sessionNull=true;window.__srv.offlineHang=true}catch(e){}};
const bootOff=async(b,ctx)=>boot(b,{ctx,kv:{},pageInit:offInit});
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const ctx=await b.newContext({viewport:{width:1100,height:800}});
// 1) en ligne : PIN demandé puis saisi
let {p,errs}=await boot(b,{ctx,settings:{companyName:'Lakay SA',currency:'HTG'},primary:true,pageInit:()=>{try{localStorage.removeItem('compta-plus-active-tab');sessionStorage.clear();window.__srv.tables.companies[0].security_pin_hash='h';window.__srv.rpcH={verify_company_pin:(a)=>({data:a.pin_attempt==='1234',error:null})}}catch(e){}}});
await p.waitForTimeout(1200);
ok('en ligne : l\'écran du code de sécurité s\'affiche',/Code de sécurité de l'entreprise/.test(await p.evaluate(()=>document.body.innerText)));
await p.locator('input[placeholder="Code de sécurité"]').fill('0000');await p.getByRole('button',{name:'Valider'}).click();await p.waitForTimeout(600);
ok('mauvais code : refusé',/Code incorrect/.test(await p.evaluate(()=>document.body.innerText)));
ok('mauvais code : aucune trace hors ligne',(await p.evaluate(k=>localStorage.getItem(k),KEY))===null);
await p.locator('input[placeholder="Code de sécurité"]').fill('1234');await p.getByRole('button',{name:'Valider'}).click();await p.waitForTimeout(1500);
ok('bon code : l\'application s\'ouvre',/Achat et fournisseurs/.test(await p.evaluate(()=>document.body.innerText)));
const mk=await p.evaluate(k=>localStorage.getItem(k),KEY);
let rec=null;try{rec=JSON.parse(mk)}catch(e){}
ok('trace enregistrée : compte + heure récente',!!rec&&rec.email==='a@x.com'&&Math.abs(Date.now()-rec.t)<60000,mk);
ok('la trace ne contient pas le code',!/1234/.test(mk||''));
const meta=await p.evaluate(()=>JSON.parse(localStorage.getItem('compta-plus-hl-meta')||'null'));
ok('mémo d\'identité enregistré avec PIN',!!meta&&meta.membership&&meta.membership.hasSecurityPin===true);
await p.close();
// 2) hors ligne, trace valide : ouverture sans saisie
await ctx.setOffline(true);
let r=await bootOff(b,ctx);
await r.p.waitForFunction(()=>/Achat et fournisseurs|Code de sécurité|offline-blocked|ne peut pas|hors ligne/i.test(document.body.innerText)||document.querySelector('[data-hl="offline-blocked"]'),null,{timeout:30000}).catch(()=>{});
let t=await r.p.evaluate(()=>document.body.innerText);
ok('hors ligne, PIN saisi il y a moins de 7 jours : application ouverte',/Achat et fournisseurs/.test(t),t.slice(0,150));
ok('hors ligne : pas de nouvel écran de code',!/Code de sécurité de l'entreprise/.test(t));
await r.p.close();
// 3) trace vieille de 8 jours : refusé, message explicite
await setLS(ctx,(k)=>{const o=JSON.parse(localStorage.getItem(k));o.t=Date.now()-8*86400000;localStorage.setItem(k,JSON.stringify(o))},KEY);
r=await bootOff(b,ctx);await r.p.waitForSelector('[data-hl="offline-blocked"]',{timeout:20000}).catch(()=>{});
t=await r.p.evaluate(()=>document.body.innerText);
ok('PIN saisi il y a 8 jours : ouverture refusée',await r.p.locator('[data-hl="offline-blocked"]').count()===1&&!/Achat et fournisseurs/.test(t),t.slice(0,160));
ok('le message parle du code PIN et des 7 jours',/PIN/.test(t)&&/7 jours/.test(t),t.slice(0,300));
await r.p.close();
// 4) trace d'un autre compte : refusé
await setLS(ctx,(k)=>localStorage.setItem(k,JSON.stringify({email:'autre@x.com',t:Date.now()})),KEY);
r=await bootOff(b,ctx);await r.p.waitForSelector('[data-hl="offline-blocked"]',{timeout:20000}).catch(()=>{});
ok('trace d\'un autre compte : ouverture refusée',await r.p.locator('[data-hl="offline-blocked"]').count()===1);
await r.p.close();
// 5) aucune trace : refusé
await setLS(ctx,(k)=>localStorage.removeItem(k),KEY);
r=await bootOff(b,ctx);await r.p.waitForSelector('[data-hl="offline-blocked"]',{timeout:20000}).catch(()=>{});
t=await r.p.evaluate(()=>document.body.innerText);
ok('jamais saisi sur cet appareil : ouverture refusée',await r.p.locator('[data-hl="offline-blocked"]').count()===1&&/PIN/.test(t));
await r.p.close();
// 6) date dans le futur (horloge trafiquée) : refusé
await setLS(ctx,(k)=>localStorage.setItem(k,JSON.stringify({email:'a@x.com',t:Date.now()+30*86400000})),KEY);
r=await bootOff(b,ctx);await r.p.waitForSelector('[data-hl="offline-blocked"]',{timeout:20000}).catch(()=>{});
ok('date de saisie dans le futur : ouverture refusée',await r.p.locator('[data-hl="offline-blocked"]').count()===1);
await r.p.close();
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

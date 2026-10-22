// v249 — connexion très faible : getUser() renvoie « aucun utilisateur » avec une erreur réseau.
// L'application ne doit pas afficher « Connexion refusée » ; elle reprend l'identité mémorisée ou réessaie seule.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const txt=p=>p.evaluate(()=>document.body.innerText);
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// A) appareil déjà ouvert en ligne : réseau bancal → l'application s'ouvre
const ctx=await b.newContext({viewport:{width:1100,height:800}});
let {p}=await boot(b,{ctx,settings:{companyName:'Lakay SA',currency:'HTG'},primary:true,pageInit:()=>{try{localStorage.removeItem('compta-plus-active-tab')}catch(e){}}});
await p.waitForTimeout(1500);await p.close();
({p}=await boot(b,{ctx,settings:{companyName:'Lakay SA',currency:'HTG'},primary:true,pageInit:()=>{try{localStorage.removeItem('compta-plus-active-tab');localStorage.setItem('sb-test-auth-token','{"user":{"email":"a@x.com"}}');window.__srv.getUserNetErr=true}catch(e){}}}));
await p.waitForTimeout(3000);let t=await txt(p);
ok('réseau bancal, appareil connu : pas de « Connexion refusée »',!/Connexion refusée/.test(t),t.slice(0,150));
ok('réseau bancal, appareil connu : l\'application s\'ouvre',/Achat et fournisseurs/.test(t),t.slice(0,150));
await p.close();
// B) appareil jamais ouvert : attente et nouvelle tentative, sans écran de refus
const ctx2=await b.newContext({viewport:{width:1100,height:800}});
({p}=await boot(b,{ctx:ctx2,settings:{companyName:'Lakay SA',currency:'HTG'},primary:true,pageInit:()=>{try{window.__srv.getUserNetErr=true}catch(e){}}}));
await p.waitForTimeout(3000);t=await txt(p);
ok('réseau bancal, appareil inconnu : pas de « Connexion refusée »',!/Connexion refusée/.test(t),t.slice(0,150));
ok('réseau bancal, appareil inconnu : message d\'attente',/instable/.test(t),t.slice(0,150));
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

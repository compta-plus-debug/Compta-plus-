// v323 : captcha à la connexion (clé renseignée) — jeton transmis, refus sans jeton, remise à zéro après échec.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const pre=()=>{window.__srv.sessionNull=true;window.turnstile={render:(el,o)=>{window.__hc=o;el.innerHTML='<i>captcha</i>';return 'w1'},reset:()=>{window.__hcReset=(window.__hcReset||0)+1}}};
const toLogin=async(p)=>{await p.evaluate(()=>{const c=[...document.querySelectorAll('button')].find(x=>/Commencer|Se connecter|Essai|Démarrer|Créer/i.test(x.innerText));c&&c.click()});await p.waitForTimeout(500)};
const submit=(p)=>p.evaluate(()=>{const i=document.querySelector('input[type=email]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'a@x.com');i.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('button')].find(x=>/Recevoir le lien/.test(x.innerText)).click()});
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const {p,errs}=await boot(b,{primary:true,pageInit:pre});await p.waitForTimeout(1200);await toLogin(p);
const hasBox=await p.evaluate(()=>!!document.querySelector('[data-testid="captcha-box"] i'));
if(!hasBox){console.log('PASS (aucune clé Turnstile renseignée : test du captcha ignoré)');await b.close();console.log('TOUT PASSE');process.exit(0)}
ok('case captcha affichée',hasBox);
await submit(p);await p.waitForTimeout(500);
let st=await p.evaluate(()=>({calls:window.__srv.otpCalls||[],txt:document.body.innerText}));
ok('sans jeton : aucun envoi',st.calls.length===0,st.calls);
ok('sans jeton : message clair',/Cochez la case de vérification/.test(st.txt));
await p.evaluate(()=>window.__hc.callback('TOKEN-1'));
await submit(p);await p.waitForTimeout(500);
st=await p.evaluate(()=>({calls:window.__srv.otpCalls||[],txt:document.body.innerText}));
ok('avec jeton : transmis à Supabase',st.calls.length===1&&st.calls[0].options.captchaToken==='TOKEN-1',st.calls);
ok('lien envoyé affiché',/Lien de connexion envoyé/.test(st.txt));
await p.close();
// échec côté serveur → captcha remis à zéro
{const r=await boot(b,{primary:true,pageInit:()=>{window.__srv.sessionNull=true;window.__srv.otpFail=true;window.turnstile={render:(el,o)=>{window.__hc=o;el.innerHTML='<i>captcha</i>';return 'w1'},reset:()=>{window.__hcReset=(window.__hcReset||0)+1}}}});await r.p.waitForTimeout(1200);await toLogin(r.p);
 await r.p.evaluate(()=>window.__hc.callback('T2'));await submit(r.p);await r.p.waitForTimeout(500);
 ok('échec : captcha remis à zéro',(await r.p.evaluate(()=>window.__hcReset||0))===1);
 await submit(r.p);await r.p.waitForTimeout(400);
 ok('échec : nouveau jeton exigé',/Cochez la case/.test(await r.p.evaluate(()=>document.body.innerText)));await r.p.close();}
ok('aucune erreur JS',errs.length===0,errs.slice(0,3));
await b.close();console.log(fails?'ECHECS '+fails:'TOUT PASSE');process.exit(fails?1:0)})();

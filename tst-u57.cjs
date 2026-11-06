// v322 : activation 2FA — facteur orphelin nettoyé (listFactors().all), nom unique, et « référence » technique en cas d'échec.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const clickAct=(p)=>p.evaluate(()=>{const c=[...document.querySelectorAll('button')].find(x=>/Activer la double/.test(x.innerText));c&&c.click();return !!c});
const mk=async(b,pre)=>{const r=await boot(b,{settings:{companyName:"Lakay SA",currency:"HTG",requireAdminMfa:true},primary:true,pageInit:()=>{try{localStorage.removeItem('compta-plus-active-tab')}catch(e){}}});await r.p.waitForTimeout(1500);await r.p.evaluate(pre);return r};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// A) un facteur orphelin existe : il est retiré puis l'activation démarre
{const {p,errs}=await mk(b,()=>{window.__srv.mfaOrphans=['orph1']});
 ok('A : bouton présent',await clickAct(p));await p.waitForTimeout(900);
 const st=await p.evaluate(()=>({calls:window.__srv.mfaCalls,txt:document.body.innerText}));
 ok('A : orphelin retiré',(st.calls||[]).includes('unenroll:orph1'),st.calls);
 ok('A : activation lancée avec un nom',(st.calls||[]).includes('enroll:nommé'),st.calls);
 ok('A : aucune erreur affichée',!/Impossible de démarrer/.test(st.txt));
 ok('A : aucune erreur JS',errs.length===0,errs.slice(0,3));await p.close();}
// B) l'orphelin ne peut pas être retiré : message clair + référence
{const {p}=await mk(b,()=>{window.__srv.mfaOrphans=['orph1'];window.__srv.mfaStuck=true});
 await clickAct(p);await p.waitForTimeout(900);
 const txt=await p.evaluate(()=>document.body.innerText);
 ok('B : message clair',/Impossible de démarrer l'activation/.test(txt));
 ok('B : référence avec le code',/Référence : .*mfa_factor_name_conflict/.test(txt),txt.slice(0,300));await p.close();}
await b.close();console.log(fails?'ECHECS '+fails:'TOUT PASSE');process.exit(fails?1:0)})();

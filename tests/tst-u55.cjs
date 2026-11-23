// v320 — Code de sécurité (PIN) : message clair quand il reste des essais, et quand le blocage de 15 minutes est actif.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const init=()=>{try{localStorage.removeItem('compta-plus-active-tab');sessionStorage.clear();const S=window.__srv;S.tables.companies[0].security_pin_hash='h';
  S.pin={fail:0,locked:false,statusErr:false};
  S.rpcH={verify_company_pin:(a)=>{if(S.pin.locked)return {data:false,error:null};if(a.pin_attempt==='1234')return {data:true,error:null};S.pin.fail++;if(S.pin.fail>=5)S.pin.locked=true;return {data:false,error:null};},
   pin_status:()=>{if(S.pin.statusErr)return {data:null,error:{message:'function does not exist'}};return {data:S.pin.locked?{locked:true,left:0,minutes:15}:{locked:false,left:5-S.pin.fail},error:null};}};}catch(e){}};
 const {p,errs}=await boot(b,{settings:{companyName:'Lakay SA'},primary:true,pageInit:new Function('return ('+init.toString()+')()')});
 await p.waitForTimeout(1200);
 ok('écran du code affiché',/Code de sécurité de l'entreprise/.test(await p.evaluate(()=>document.body.innerText)));
 const essai=async(c)=>{await p.locator('input[placeholder="Code de sécurité"]').fill(c);await g(p,'pin-valider').click();await p.waitForTimeout(500);};
 await essai('0000');
 ok('1er mauvais code : « il vous reste 4 essais » et mention du blocage de 15 minutes',/Il vous reste 4 essais avant un blocage de 15 minutes/.test(await g(p,'pin-error').innerText()),await g(p,'pin-error').innerText());
 await essai('1111');await essai('2222');
 ok('3e mauvais code : « il vous reste 2 essais »',/Il vous reste 2 essais/.test(await g(p,'pin-error').innerText()));
 await essai('3333');
 ok('4e mauvais code : singulier « 1 essai »',/Il vous reste 1 essai avant/.test(await g(p,'pin-error').innerText()),await g(p,'pin-error').innerText());
 await essai('4444');
 const t=await g(p,'pin-error').innerText();
 ok('5e mauvais code : message de blocage clair (15 minutes, voulu, pas une panne)',/bloqué pendant 15 minutes/.test(t)&&/voulu/.test(t)&&/pas une panne/.test(t),t);
 ok('bouton désactivé et libellé « Bloqué temporairement »',await g(p,'pin-valider').isDisabled()&&/Bloqué temporairement/.test(await g(p,'pin-valider').innerText()));
 const calls0=await p.evaluate(()=>window.__srv.calls.filter(c=>c==='rpc verify_company_pin').length);
 await p.locator('input[placeholder="Code de sécurité"]').fill('1234');await g(p,'pin-valider').click({force:true,timeout:1500}).catch(()=>{});await p.waitForTimeout(400);
 const calls1=await p.evaluate(()=>window.__srv.calls.filter(c=>c==='rpc verify_company_pin').length);
 ok('pendant le blocage, plus aucun appel envoyé au serveur (on ne réessaie pas en boucle)',calls1===calls0,[calls0,calls1]);
 ok('toujours sur l\'écran du code',/Code de sécurité de l'entreprise/.test(await p.evaluate(()=>document.body.innerText)));
 ok('aucune erreur de page',errs.length===0,errs);
 await p.close();}
{const init=()=>{try{localStorage.removeItem('compta-plus-active-tab');sessionStorage.clear();const S=window.__srv;S.tables.companies[0].security_pin_hash='h';
  S.rpcH={verify_company_pin:(a)=>({data:a.pin_attempt==='1234',error:null}),pin_status:()=>({data:null,error:{message:'function does not exist'}})};}catch(e){}};
 const {p}=await boot(b,{settings:{companyName:'Lakay SA'},primary:true,pageInit:new Function('return ('+init.toString()+')()')});
 await p.waitForTimeout(1200);
 await p.locator('input[placeholder="Code de sécurité"]').fill('0000');await g(p,'pin-valider').click();await p.waitForTimeout(500);
 ok('serveur sans pin_status : ancien message conservé (rien ne casse)',/Code incorrect\. Redemandez-le/.test(await g(p,'pin-error').innerText()),await g(p,'pin-error').innerText());
 await p.locator('input[placeholder="Code de sécurité"]').fill('1234');await g(p,'pin-valider').click();await p.waitForTimeout(800);
 ok('bon code : accès à l\'application',!/Code de sécurité de l'entreprise/.test(await p.evaluate(()=>document.body.innerText)));
 await p.close();}
await b.close();console.log(fails?'ÉCHECS: '+fails:'TOUT PASSE');process.exit(fails?1:0);})();

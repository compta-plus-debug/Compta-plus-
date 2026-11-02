// v316 — Retour sur l'application : un appareil resté périmé se remet à niveau (élément supprimé ailleurs ne revient pas à la sauvegarde suivante).
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const rec=(p,c)=>p.evaluate((c)=>{try{return JSON.parse(window.__srv.kv['compta-'+c])}catch(e){return null}},c);
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
for(const mode of ['avec retour (focus)','sans retour']){
 const {p}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,cats:{clients:[{id:'a',name:'Alice'},{id:'b',name:'Bob'}]}});
 await p.waitForTimeout(1500);
 // un autre appareil supprime Bob (aucun événement temps réel n'arrive ici)
 await p.evaluate(()=>{const S=window.__srv;const r=JSON.parse(S.kv['compta-clients']);r.v+=3;r.data=r.data.filter(x=>x.id!=='b');S.kv['compta-clients']=JSON.stringify(r);});
 if(mode.startsWith('avec')){await p.evaluate(()=>window.dispatchEvent(new Event('focus')));await p.waitForTimeout(3000);}
 await p.getByText('Sauvegarder maintenant').first().click();await p.waitForTimeout(3500);
 const c=await rec(p,'clients');const noms=(c&&c.data||[]).map(x=>x.name);
 if(mode.startsWith('avec')) ok('Bob supprimé ailleurs ne revient pas ('+mode+')',!noms.includes('Bob')&&noms.includes('Alice'),noms);
 await p.close();}
await b.close();console.log(fails?('ÉCHECS '+fails):'TOUT PASSE');process.exit(fails?1:0)})();

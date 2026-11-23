const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const LONG='x'.repeat(260), MSG='TypeError: Cannot read properties of undefined (reading '+LONG+') '+('motsinterminablessansespace'.repeat(12));
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
for(const vw of [390,1100]){
 const ctx=await b.newContext({viewport:{width:vw,height:800}});
 const {p,errs}=await boot(b,{ctx,settings:{companyName:"Lakay SA",currency:"HTG"},primary:true,pageInit:()=>{try{localStorage.removeItem('compta-plus-active-tab')}catch(e){}
  const S=window.__srv;S.tables.platform_admins=[{email:'a@x.com'}];
  const long='y'.repeat(300);
  S.tables.error_logs=[{id:1,created_at:'2026-10-12T10:00:00Z',message:'TypeError: '+long+' '+'abcdefghij'.repeat(40),app_version:'20260830-202',company_id:'c1',user_email:'une.adresse.tres.longue.'+'z'.repeat(120)+'@exemple.com',url:'https://comptaplus.app/'+'segment/'.repeat(40)+'?q='+long,stack:'at fn ('+'https://comptaplus.app/app.min.js:1:'+'9'.repeat(200)+')\n'+'at '+'w'.repeat(400)}];
  S.tables.signup_failures=[{id:1,created_at:'2026-10-12T10:00:00Z',email:'longue'+'q'.repeat(200)+'@exemple.com',user_agent:'Mozilla/5.0 '+'u'.repeat(400),event_log:['a'.repeat(500),'b'.repeat(500)]}];
 }});
 await p.waitForTimeout(800);
 await p.getByText('Plateforme — Super Admin').first().click();await p.waitForTimeout(1200);
 for(const [tab,tid] of [['Erreurs','err-panel'],['Inscriptions et essais','insc-panel']]){
  await p.locator('[data-testid="sa-group-controle"]').click();await p.locator('[data-testid="sa-tab-'+({'Erreurs':'erreurs','Inscriptions et essais':'inscriptions'})[tab]+'"]').count()||await p.locator('[data-testid="sa-group-essais"]').click();await p.locator('[data-testid="sa-tab-'+({'Erreurs':'erreurs','Inscriptions et essais':'inscriptions'})[tab]+'"]').click();await p.waitForTimeout(900);
  await p.locator('details').first().locator('summary').click();await p.waitForTimeout(300);
  const m=await p.evaluate((tid)=>{const de=document.documentElement;const panel=document.querySelector('[data-testid="'+tid+'"]');const pr=panel.getBoundingClientRect();
   let worst=0;panel.querySelectorAll('*').forEach(el=>{const r=el.getBoundingClientRect();if(r.width>0&&el.tagName!=='PRE'&&!el.closest('pre')){const over=r.right-pr.right;if(over>worst)worst=over}});
   return {docOverflow:de.scrollWidth-de.clientWidth,bodyOverflow:document.body.scrollWidth-window.innerWidth,child:Math.round(worst),panelW:Math.round(pr.width),vw:window.innerWidth,pageW:de.scrollWidth}},tid);
  ok(`${vw}px ${tab}: pas de défilement horizontal de la page`,m.docOverflow<=0&&m.bodyOverflow<=0,m);
  ok(`${vw}px ${tab}: aucun élément ne dépasse son cadre`,m.child<=1,m);
 }
 ok(`${vw}px: aucune erreur JS`,errs.length===0,errs.slice(0,2));
 await p.screenshot({path:`g2_${vw}.png`});
 await ctx.close();
}
await b.close();console.log(fails?'ECHECS '+fails:'TOUT PASSE');process.exit(fails?1:0)})();

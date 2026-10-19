// Bouton « Installer l'application » (v230) : l'invitation du navigateur reçue AVANT le démarrage de l'application est bien utilisée.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const fakeEvt='{prompt(){window.__prompted=(window.__prompted||0)+1},userChoice:Promise.resolve({outcome:"accepted"}),preventDefault(){}}';
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// A) invitation arrivée avant l'application
{const {p,errs}=await boot(b,{settings:{companyName:"Lakay SA",currency:"HTG"},primary:true,pageInit:new Function('window.__deferredInstall='+fakeEvt+';try{localStorage.removeItem("compta-plus-active-tab")}catch(e){}')});
 await p.getByText("Installer l'application").first().click();await p.waitForTimeout(500);
 ok('A : le clic déclenche l\'installation',(await p.evaluate(()=>window.__prompted))===1);
 ok('A : le bouton disparaît ensuite (plus d\'invitation)',(await p.evaluate(()=>window.__prompted))===1&&errs.length===0,errs.slice(0,3));await p.close();}
// B) sans invitation (iPhone, ou déjà proposée) : l'aide d'installation s'affiche, aucune erreur
{const {p,errs}=await boot(b,{settings:{companyName:"Lakay SA",currency:"HTG"},primary:true,pageInit:()=>{try{localStorage.removeItem('compta-plus-active-tab')}catch(e){}}});
 await p.getByText("Installer l'application").first().click();await p.waitForTimeout(400);
 ok('B : aide affichée sans erreur',(await p.evaluate(()=>window.__prompted||0))===0&&errs.length===0,errs.slice(0,3));await p.close();}
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

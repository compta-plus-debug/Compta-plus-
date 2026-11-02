 // v318 — Réinitialisation en conservant le catalogue : toutes les quantités en stock repassent à zéro, même celles d'un article de type service.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const go=async(p)=>{await p.getByText('Administration',{exact:false}).first().click();await p.waitForTimeout(800);await p.getByRole('button',{name:/^Données/}).first().click();await p.waitForTimeout(500);
 await p.getByText('Réinitialiser…').last().click();await p.waitForTimeout(300);
 await p.locator('label:has-text("Comptabilité et pièces")').first().click();await p.locator('label:has-text("Mouvements de stock")').first().click();await p.waitForTimeout(300);
 
 p.removeAllListeners('dialog');p.on('dialog',d=>{d.type()==='prompt'?d.accept('RÉINITIALISER'):d.accept()});
 await p.getByText(/Réinitialiser la sélection/).click();await p.waitForTimeout(16000);
 const pr=await p.evaluate(()=>window.__srv.getCat('products'));ok('catalogue conservé, quantités à zéro (service avec stock inclus)',pr.length===2&&pr.every(x=>x.stock===0),pr);ok('articles et noms conservés',pr[0].name==='Cons'&&pr[1].name==='Art'&&pr[1].seuil===5,pr);
 console.log('UI',await p.evaluate(()=>document.body.innerText.match(/Réinitialis[^\n]*/g)));};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
 const {p}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,cats:{products:[{id:1,code:'S1',name:'Cons',price:10,type:'service',account:'706',stock:12},{id:2,code:'M1',name:'Art',price:10,type:'marchandise',account:'707',stock:40,seuil:5}],movements:[{id:'m1',productId:2,qty:40}],invoices:[{id:'i1',number:'F1',date:'2026-03-12',items:[],total:100}]}});
 await p.waitForTimeout(1500);await go(p);await b.close();console.log(fails?('ÉCHECS '+fails):'TOUT PASSE');process.exit(fails?1:0)})();

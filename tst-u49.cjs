// v315 — Catalogue : un article ne peut exister qu'une fois (même nom = refus, sans tenir compte des majuscules, accents, espaces) ; valeurs absurdes refusées.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const init=new Function("(function(){try{localStorage.clear()}catch(e){}window.__srv.tables.companies[0].plan_tier='assisted';})();");
const prods=(p)=>p.evaluate(()=>window.__srv.getCat('products')||[]);
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const {p}=await boot(b,{settings:{companyName:'Test',currency:'HTG',taxRate:0},primary:true,pageInit:init});
await p.getByText('Vente (POS / Facturation)',{exact:true}).first().click();await p.waitForTimeout(600);
await p.getByText('Catalogue',{exact:true}).first().click();await p.waitForTimeout(500);
const add=async(code,nom,prix)=>{await g(p,'cat-code').fill(code);await g(p,'cat-name').fill(nom);await g(p,'cat-price').fill(String(prix));await g(p,'cat-add').click();await p.waitForTimeout(600);};
const body=()=>p.evaluate(()=>document.body.innerText);
const n0=(await prods(p)).length;
await add('RB1','Riz Blanc',150);
ok('1er article ajouté',(await prods(p)).length===n0+1,(await prods(p)).length);
for(const [code,nom,label] of [['RB2','riz blanc','minuscules'],['RB3','RIZ BLANC','majuscules'],['RB4','  Riz   Blanc ','espaces en trop'],['RB5','Riz Blanç','accent']]){
  await add(code,nom,150);
  ok('doublon refusé ('+label+')',(await prods(p)).length===n0+1,(await prods(p)).length);
  ok('message clair « existe déjà au Catalogue » ('+label+')',/existe déjà au Catalogue/.test(await body()),(await body()).slice(0,200));
  await p.waitForTimeout(300);
}
await add('rb1','Autre nom',10);
ok('code identique (casse différente) refusé aussi',(await prods(p)).length===n0+1);
await add('RB6','Huile',-5);
ok('prix négatif refusé',(await prods(p)).length===n0+1);
await add('RB7','Sucre',1e308);
ok('prix démesuré refusé',(await prods(p)).length===n0+1);
await add('RB8','Sucre',90);
ok('un autre article distinct est accepté',(await prods(p)).length===n0+2);
await b.close();console.log(fails?('ÉCHECS '+fails):'TOUT PASSE');process.exit(fails?1:0)})();

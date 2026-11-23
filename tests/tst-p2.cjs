const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const txt=p=>p.evaluate(()=>document.body.innerText);
const prod=[{id:1700000000001,code:"R1",name:"Riz",type:"marchandise",price:100,costPrice:60,tva:0,account:"707",stock:10,seuil:2},{id:1700000000002,code:"C1",name:"Conseil",type:"service",price:500,tva:0,account:"706"}];
const ent=(amt)=>[{id:5001,date:"2026-01-05",createdAt:"2026-01-05T10:00:00Z",label:"Achat — Stock initial (Four)",lines:[{account:"370",debit:amt,credit:0},{account:"401",debit:0,credit:amt}]}];
const mk=(plan)=>new Function("(function(){try{localStorage.removeItem('compta-plus-active-tab')}catch(e){}window.__srv.tables.companies[0].plan_tier="+JSON.stringify(plan||'assisted')+";})();");
const seed=(method,amt)=>({settings:{companyName:'X',currency:'HTG',stockValuationMethod:method},primary:true,cats:{entries:ent(amt),purchases:[],suppliers:[{id:1,name:"Four"}]},pageInit:mk()});
const goStock=async p=>{await p.getByText('Stock et inventaire',{exact:false}).first().click();await p.waitForTimeout(700);};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// A) actif, 370 = 600 = stock en rayon (10×60)
{const {p,errs}=await boot(b,seed('actif',600));await goStock(p);
 const c=p.locator('[data-testid="stock-reconcile"]');
 ok('A : carte présente',await c.count()===1);
 ok('A : stock correspond',/Le stock correspond à la comptabilité/.test(await c.innerText()),await c.innerText().catch(()=>''));
 ok('aucune erreur JS (A)',errs.length===0,errs.slice(0,3));await p.close();}
// B) actif, 370 = 300 ≠ 600 : écart 300 + alerte assistant
{const {p,errs}=await boot(b,seed('actif',300));await goStock(p);
 const c=p.locator('[data-testid="stock-reconcile"]');const t=await c.innerText();
 ok('B : ne correspond pas',/ne correspond pas/.test(t)&&/300/.test(t),t);
 await p.getByText('Comptabilité',{exact:false}).first().click();await p.waitForTimeout(700);
 await p.getByText(/Assistant de contrôle/).first().click();await p.waitForTimeout(600);
 ok('B : alerte dans l\'Assistant',/Le stock ne correspond pas à la comptabilité/.test(await txt(p)),(await txt(p)).slice(0,300));
 await p.getByText('Clôture',{exact:true}).first().click();await p.waitForTimeout(400);
 await p.getByText('Clôture annuelle',{exact:true}).first().click();await p.waitForTimeout(600);
 ok('B : contrôle dans la clôture annuelle',/ne correspond pas au compte 370/.test(await txt(p)),(await txt(p)).slice(0,300));
 ok('aucune erreur JS (B)',errs.length===0,errs.slice(0,3));await p.close();}
// C) méthode « charge » : aucune carte
{const {p,errs}=await boot(b,seed('charge',300));await goStock(p);
 ok('C : pas de carte en méthode charge',await p.locator('[data-testid="stock-reconcile"]').count()===0);
 ok('aucune erreur JS (C)',errs.length===0,errs.slice(0,3));await p.close();}
// D) achat avec frais d'approche : coût moyen = (10×60 + 10×100 + 100) ÷ 20 = 85
{const {p,errs}=await boot(b,{...seed('actif',600),pageInit:mk('standard')});
 await p.getByText('Achat et fournisseurs',{exact:false}).first().click();await p.waitForTimeout(700);
 const ach=p.getByText('Achats',{exact:true});if(await ach.count())await ach.first().click();await p.waitForTimeout(400);
 await p.getByText('Réception de marchandise (avec produits)').first().click();await p.waitForTimeout(300);
 await p.locator('select:has(option:text("Choisir un produit"))').first().selectOption({index:1});
 await p.getByRole('button',{name:'Ajouter',exact:true}).first().click();await p.waitForTimeout(300);
 await p.locator('input[placeholder="Qté"]').fill('10');await p.locator('input[placeholder="Coût unit."]').fill('100');
 await p.locator('[data-testid="purchase-freight"]').fill('100');await p.waitForTimeout(300);
 ok('D : total calculé = 1100',/1[\s ,.]?100/.test(await txt(p)));
 await p.locator('input[placeholder*="Achat fournitures"]').first().fill('Réception test').catch(()=>{});
 await p.getByRole('button',{name:"Enregistrer l'achat"}).click();await p.waitForTimeout(600);await p.waitForTimeout(5000);
 const prods=await p.evaluate(()=>window.__srv.getCat('products'));const riz=(prods||[]).find(x=>x.code==='R1');
 ok('D : stock = 20',riz&&Number(riz.stock)===20,riz);
 ok('D : coût moyen = 85 (frais inclus)',riz&&Math.abs(Number(riz.costPrice)-85)<0.01,riz);
 const purs=await p.evaluate(()=>window.__srv.getCat('purchases'));
 ok('D : achat enregistré avec frais 100 et montant 1100',purs&&purs[0]&&purs[0].freight===100&&Number(purs[0].amount)===1100,purs);
 const es=await p.evaluate(()=>window.__srv.getCat('entries'));const last=es[es.length-1];
 ok('D : écriture 370 débit 1100',last&&last.lines.some(l=>l.account==='370'&&Number(l.debit)===1100),last);
 ok('aucune erreur JS (D)',errs.length===0,errs.slice(0,3));await p.close();}
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

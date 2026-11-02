// v314 — vente enregistrée de façon ATOMIQUE (facture + écriture en une transaction), avec repli si la fonction serveur n'est pas installée.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const mk=(extra)=>new Function("(function(){try{localStorage.clear()}catch(e){}window.__srv.tables.companies[0].plan_tier='assisted';"+(extra||"")+"})();");
const cat=(p,c)=>p.evaluate((c)=>window.__srv.getCat(c)||[],c);
const calls=(p)=>p.evaluate(()=>window.__srv.calls.filter(c=>/commit_sale_documents/.test(c)).length);
const vendre=async(p)=>{await p.getByText('Vente (POS / Facturation)',{exact:true}).first().click();await p.waitForTimeout(700);
 await p.locator('button:has-text("Riz")').first().click();await p.waitForTimeout(300);
 await p.locator('[data-pos="validate"]').click();await p.waitForTimeout(3500);};
const scen=async(b,nom,extra,verif)=>{const {p,errs}=await boot(b,{settings:{companyName:'Test',currency:'HTG',taxRate:0},primary:true,cats:{invoices:[],entries:[]},pageInit:mk(extra)});await vendre(p);await verif(p,errs);await p.close();};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
await scen(b,'A',"",async(p)=>{
 const inv=await cat(p,'invoices'),ent=await cat(p,'entries');
 ok('A : la fonction atomique a été appelée une fois',(await calls(p))===1,await calls(p));
 ok('A : 1 facture et 1 écriture enregistrées, sans doublon',inv.length===1&&ent.filter(e=>!e.kind).length===1,{i:inv.length,e:ent.length});
 ok('A : l\'écriture est rattachée à la facture et équilibrée',ent[0]&&ent[0].invoiceId===inv[0].id&&Math.abs(ent[0].lines.reduce((s,l)=>s+l.debit-l.credit,0))<0.001,ent[0]);
 ok('A : la facture est visible à l\'écran',/Facture .* créée|FAC|F-?\d/.test(await p.evaluate(()=>document.body.innerText)));});
await scen(b,'B',"window.__srv.atomicMissing=true;",async(p)=>{
 const inv=await cat(p,'invoices'),ent=await cat(p,'entries');
 ok('B : fonction absente → repli, la vente est quand même enregistrée',inv.length===1&&ent.filter(e=>!e.kind).length===1,{i:inv.length,e:ent.length});});
await scen(b,'C',"window.__srv.rpcH={commit_sale_documents:async()=>({data:null,error:{message:'REGLE|periode_cloturee|La période comptable est clôturée.'}})};",async(p)=>{
 const inv=await cat(p,'invoices'),ent=await cat(p,'entries');
 ok('C : refus de la base → rien n\'est enregistré (ni facture, ni écriture)',inv.length===0&&ent.length===0,{i:inv.length,e:ent.length});
 ok('C : message clair affiché',/clôturée/.test(await p.evaluate(()=>document.body.innerText)));});
await scen(b,'D',"window.__srv.rtEcho=true;window.__srv.lat=400;",async(p)=>{
 const inv=await cat(p,'invoices'),ent=await cat(p,'entries');
 ok('D : avec écho temps réel et latence, toujours 1 facture + 1 écriture',inv.length===1&&ent.filter(e=>!e.kind).length===1,{i:inv.length,e:ent.length});});
await b.close();console.log(fails?('ÉCHECS '+fails):'TOUT PASSE');process.exit(fails?1:0)})();

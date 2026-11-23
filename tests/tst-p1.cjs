const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const d=new Date();const today=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const stBase=[{id:'s1',name:'Caisse Alpha',sellerNames:[],sellerEmails:[]},{id:'s2',name:'Caisse Beta',sellerNames:[],sellerEmails:[]}];
const withEmail=(i,em)=>stBase.map((s,k)=>k===i?{...s,sellerEmails:[em],activeSellerEmail:em}:{...s});
const inv=(id,total,st)=>({id,number:'F'+id,date:today,status:'payée',client:'Client '+id,total,totalHT:total,totalTax:0,paymentMode:'caisse',payments:[],lines:[{name:'Riz '+id,qty:1,subtotal:total}],stationId:st?st.id:null,stationName:st?st.name:null});
const invoices=[inv(1,111,stBase[0]),inv(2,222,stBase[1]),inv(3,333,null)];
const mk=(role,extra)=>new Function("(function(){try{localStorage.removeItem('compta-plus-active-tab')}catch(e){}window.__srv.tables.companies[0].plan_tier='assisted';window.__srv.tables.company_members[0].role="+JSON.stringify(role)+";"+(extra||"")+"})();");
const base=(st)=>({settings:{companyName:'X',currency:'HTG'},primary:true,cats:{invoices,salesStations:st||stBase}});
const goVente=async p=>{await p.getByText('Vente (POS / Facturation)',{exact:true}).first().click();await p.waitForTimeout(600);};
const tab=async(p,t)=>{await p.getByText(t,{exact:true}).first().click();await p.waitForTimeout(500);};
const txt=p=>p.evaluate(()=>document.body.innerText);
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// 1) Administrateur : filtre par poste
{const {p,errs}=await boot(b,{...base(),pageInit:mk('Administrateur')});await goVente(p);await tab(p,'Rapport journalier');
 const sel=p.locator('select:has(option:text("Tous les postes"))');
 ok('option Sans poste assigné',(await sel.locator('option').allTextContents()).includes('Sans poste assigné'));
 await sel.selectOption('__none__');await p.waitForTimeout(400);let t=await txt(p);
 ok('sans poste : seul Riz 3',/Riz 3/.test(t)&&!/Riz 1/.test(t)&&!/Riz 2/.test(t));
 await sel.selectOption('s1');await p.waitForTimeout(400);t=await txt(p);
 ok('poste Alpha : seul Riz 1',/Riz 1/.test(t)&&!/Riz 2/.test(t)&&!/Riz 3/.test(t));
 ok('admin : tableau Répartition visible',/Répartition par poste de vente/.test(t));
 ok('aucune erreur JS (1)',errs.length===0,errs.slice(0,3));await p.close();}
// 2) Vendeur NON assigné (même avec d'anciennes mémoires d'appareil) : aucun poste, aucun total
{const {p,errs}=await boot(b,{...base(withEmail(0,'autre@x.com')),pageInit:mk('Vendeur',"localStorage.setItem('compta-plus-station-id:a@x.com','s1');localStorage.setItem('compta-plus-station-id','s1');")});await p.waitForTimeout(800);
 await goVente(p);
 ok('non assigné : message sans poste',await p.locator('[data-testid="pos-no-station"]').count()===1);
 ok('non assigné : aucun menu de choix de poste',await p.locator('select:has(option:text("Caisse Alpha"))').count()===0);
 await tab(p,'Rapport journalier');const t=await txt(p);
 ok('non assigné : aucun total',!/666|111|222|333/.test(t)&&/Choisissez votre poste|ne vous est assigné/.test(t)||/Choisissez votre poste dans l'onglet/.test(t),t.slice(0,200));
 ok('aucune erreur JS (2)',errs.length===0,errs.slice(0,3));await p.close();}
// 3) Vendeur assigné à Beta par email : poste imposé, seulement ses ventes, rien écrit dans l'appareil
{const {p,errs}=await boot(b,{...base(withEmail(1,'a@x.com')),pageInit:mk('Vendeur')});await p.waitForTimeout(800);
 await goVente(p);
 ok('assigné : pas d\'avertissement',await p.locator('[data-testid="pos-no-station"]').count()===0);
 ok('assigné : poste Beta affiché',(await p.locator('[data-testid="pos-station-name"]').textContent())==='Caisse Beta');
 ok('assigné : rien écrit dans l\'appareil',await p.evaluate(()=>!Object.keys(localStorage).some(k=>k.startsWith('compta-plus-station-id'))));
 await tab(p,'Rapport journalier');let t=await txt(p);
 ok('assigné : rapport = Beta (222)',/Montant des ventes\n222/.test(t));
 ok('assigné : pas de tableau Répartition',!/Répartition par poste de vente/.test(t));
 await tab(p,'Factures');t=await txt(p);
 ok('assigné : factures = F2 seulement',/F2/.test(t)&&!/F1\b/.test(t)&&!/F3\b/.test(t));
 ok('aucune erreur JS (3)',errs.length===0,errs.slice(0,3));await p.close();}
// 4) Panneau Postes : un seul vendeur par poste, messages de rejet
{const st=[{id:'s1',name:'Comptoir 1',sellerNames:['Marie'],activeSellerName:'Marie',sellerEmails:['marie@x.com'],activeSellerEmail:'marie@x.com'},{id:'s2',name:'Comptoir 2',sellerNames:[],sellerEmails:[]}];
 const {p,errs}=await boot(b,{...base(st),pageInit:mk('Administrateur')});await p.waitForTimeout(800);
 await p.getByText('Administration',{exact:true}).first().click();await p.waitForTimeout(600);await tab(p,'Postes de vente');
 const card=i=>p.locator('input[defaultvalue]').nth(i);
 const emailIn=p.locator('input[placeholder*="mail"]');const nameIn=p.locator('input[placeholder="Nom du vendeur"]');
 const add=async(inp,idx,val)=>{await inp.nth(idx).fill(val);await inp.nth(idx).press('Enter');await p.waitForTimeout(500);};
 await add(emailIn,0,'jean@x.com');let t=await txt(p);
 ok('2e email sur Comptoir 1 refusé avec message',/Comptoir 1.* est déjà attribué à marie@x\.com.*Un seul vendeur par poste/.test(t),t.slice(-400));
 await p.waitForTimeout(9500);
 await add(emailIn,1,'marie@x.com');t=await txt(p);
 ok('email déjà pris par Comptoir 1 refusé sur Comptoir 2',/marie@x\.com est déjà assigné au poste « Comptoir 1 »/.test(t),t.slice(-400));
 await p.waitForTimeout(9500);
 await add(nameIn,0,'Paul');t=await txt(p);
 ok('2e nom sur Comptoir 1 refusé',/Comptoir 1.* est déjà attribué à Marie.*Un seul vendeur par poste/.test(t),t.slice(-400));
 await p.waitForTimeout(9500);
 await add(nameIn,1,'marie');t=await txt(p);
 ok('nom déjà pris refusé sur Comptoir 2',/« marie » est déjà assigné au poste « Comptoir 1 »/.test(t),t.slice(-400));
 await p.waitForTimeout(9500);
 await add(emailIn,1,'jean@x.com');t=await txt(p);
 ok('email libre accepté sur Comptoir 2',/jean@x\.com/.test(t)&&!/est déjà/.test(t.split('Emails affiliés').pop()||''),t.slice(-300));
 ok('aucune erreur JS (4)',errs.length===0,errs.slice(0,3));await p.close();}
// 5) Ancien poste avec deux vendeurs : avertissement
{const st=[{id:'s1',name:'Comptoir 1',sellerNames:[],sellerEmails:['a1@x.com','a2@x.com'],activeSellerEmail:'a1@x.com'},stBase[1]];
 const {p}=await boot(b,{...base(st),pageInit:mk('Administrateur')});await p.waitForTimeout(800);
 await p.getByText('Administration',{exact:true}).first().click();await p.waitForTimeout(600);await tab(p,'Postes de vente');
 ok('avertissement poste à plusieurs vendeurs',await p.locator('[data-testid="station-multi-warning"]').count()===1);await p.close();}
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

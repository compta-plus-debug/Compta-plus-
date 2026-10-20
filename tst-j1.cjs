// v235 : droit de régularisation de l'expert-comptable.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const pageInit=(adj)=>new Function(`try{localStorage.removeItem('compta-plus-active-tab')}catch(e){};const m=window.__srv.tables.company_members[0];m.role='Lecture seule';m.is_accountant=true;m.can_adjust=${adj};`);
const accounts=[{code:'512',name:'Banque',type:'Actif'},{code:'607',name:'Achats',type:'Charge'},{code:'401',name:'Fournisseurs',type:'Passif'}];
const open=async(P,label)=>{await P.getByText('Comptabilité',{exact:true}).first().click();await P.waitForTimeout(600);};
// A. expert AVEC droit
const A=await boot(b,{settings:{companyName:'Dossier SA',currency:'HTG'},cats:{accounts,entries:[]},pageInit:pageInit(true)});
await open(A.p);
const txt=async(P)=>P.evaluate(()=>document.body.innerText);
ok('bandeau : écritures de régularisation autorisées',/écritures de régularisation dans Comptabilité/.test(await txt(A.p)));
await A.p.getByRole('button',{name:'Plan comptable'}).click();await A.p.waitForTimeout(400);
const nb0=await A.p.evaluate(()=>window.__srv.getCat('accounts').length);
const inputs=A.p.locator('input[type="text"],input:not([type])');
await A.p.getByPlaceholder('Ex : 613').first().fill('164');await A.p.getByPlaceholder('Ex : Locations').first().fill('Emprunts bancaires');
await A.p.getByRole('button',{name:/Ajouter/}).first().click();await A.p.waitForTimeout(900);
const nb1=await A.p.evaluate(()=>window.__srv.getCat('accounts').length);
ok('expert avec droit : compte ajouté',nb1===nb0+1,[nb0,nb1]);
await A.p.getByRole('button',{name:'Journal des écritures'}).click();await A.p.waitForTimeout(400);
const sels=A.p.locator('select');
const n=await sels.count();
// première ligne : compte 607 débit 100 ; deuxième : 401 crédit 100
await A.p.getByPlaceholder('0').nth(0).fill('100');
const accSel=A.p.locator('select').filter({has:A.p.locator('option[value="607"]')});
await accSel.nth(0).selectOption('607');await accSel.nth(1).selectOption('401');
await A.p.getByPlaceholder('0').nth(3).fill('100');
const lab=A.p.locator('input[type="text"]').filter({hasNotText:'x'});
await A.p.getByPlaceholder(/Ex : Vente prestation/).first().fill('Charge à payer — honoraires').catch(()=>{});
await A.p.getByRole('button',{name:/Enregistrer l'écriture/}).click();await A.p.waitForTimeout(1200);
const ents=await A.p.evaluate(()=>window.__srv.getCat('entries'));
ok('expert avec droit : écriture enregistrée',ents.length===1,ents.length);
ok('écriture marquée « expert-comptable »',ents[0]&&ents[0].byAccountant===true,ents[0]);
// ailleurs : toujours bloqué
await A.p.getByRole('button',{name:'Clôture',exact:true}).click();await A.p.waitForTimeout(300);await A.p.getByRole('button',{name:'Clôture annuelle'}).click();await A.p.waitForTimeout(500);
const cl=A.p.getByRole('button',{name:/Clôturer|Générer|Passer/}).first();
if(await cl.count())await cl.click({force:true}).catch(()=>{});await A.p.waitForTimeout(700);
ok('clôture : toujours bloquée pour l\'expert',(await A.p.evaluate(()=>window.__srv.getCat('entries').length))===1&&!(await A.p.evaluate(()=>(window.__srv.getCat('settings')||{}).lockDate)),null);
ok('aucune erreur JS (avec droit)',A.errs.length===0,A.errs.slice(0,3));
// B. expert SANS droit : bloqué
const B=await boot(b,{settings:{companyName:'Dossier SA',currency:'HTG'},cats:{accounts,entries:[]},pageInit:pageInit(false)});
await open(B.p);
ok('bandeau sans droit : modifications désactivées',/les modifications sont désactivées/.test(await txt(B.p)));
await B.p.getByRole('button',{name:'Plan comptable'}).click();await B.p.waitForTimeout(400);
await B.p.getByPlaceholder('Ex : 613').first().fill('164').catch(()=>{});
await B.p.getByRole('button',{name:/Ajouter/}).first().click({force:true}).catch(()=>{});await B.p.waitForTimeout(700);
ok('expert sans droit : aucun compte ajouté',(await B.p.evaluate(()=>window.__srv.getCat('accounts').filter(a=>a.code==='164').length))===0);
ok('expert sans droit : message de consultation',/Mode consultation/.test(await txt(B.p)));
// C. administrateur : voit la case et peut l'activer
const C=await boot(b,{settings:{companyName:'Dossier SA',currency:'HTG'},primary:true,cats:{accounts,entries:[]},pageInit:new Function(`try{localStorage.removeItem('compta-plus-active-tab')}catch(e){};const S=window.__srv;S.tables.company_members.push({id:2,company_id:'c1',role:'Lecture seule',email:'cab@x.com',user_id:'u9',is_accountant:true,can_adjust:false,created_at:'2026-01-02'});`)});
await C.p.getByText('Administration',{exact:true}).first().click();await C.p.waitForTimeout(600);
await C.p.getByRole('button',{name:'Accès',exact:true}).click();await C.p.waitForTimeout(400);await C.p.getByRole('button',{name:/Utilisateurs/}).first().click();await C.p.waitForTimeout(600);
const cb=C.p.locator('[data-testid="adjust-right"]');
ok('administrateur : case visible pour l\'expert',(await cb.count())===1,await cb.count());
await cb.check();await C.p.waitForTimeout(800);
ok('droit accordé enregistré',await C.p.evaluate(()=>window.__srv.tables.company_members.find(m=>m.id===2).can_adjust===true));
await cb.uncheck();await C.p.waitForTimeout(800);
ok('droit retiré enregistré',await C.p.evaluate(()=>window.__srv.tables.company_members.find(m=>m.id===2).can_adjust===false));
ok('libellés : Gestionnaire et Consultant dans la liste',/Gestionnaire/.test(await C.p.evaluate(()=>document.body.innerHTML))&&/Consultant/.test(await C.p.evaluate(()=>document.body.innerHTML)));
ok('aucune erreur JS (admin/sans droit)',B.errs.length+C.errs.length===0,[...B.errs,...C.errs].slice(0,3));
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

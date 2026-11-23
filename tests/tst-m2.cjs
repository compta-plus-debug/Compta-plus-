// v240 : exercices clos dans l'application (consultation, réévaluation des devises, réouverture).
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const E=(id,date,label,lines,x)=>({id,date,createdAt:date+'T10:00:00Z',label,lines:lines.map(([account,debit,credit])=>({account,debit,credit})),...(x||{})});
const accounts=[{code:'512',name:'Banque',type:'Actif'},{code:'5121',name:'Banque — compte en dollars (USD)',type:'Actif'},{code:'411',name:'Clients',type:'Actif'},{code:'401',name:'Fournisseurs',type:'Passif'},{code:'164',name:'Emprunts auprès des établissements de crédit',type:'Passif'},{code:'110',name:'Report à nouveau',type:'Capitaux propres'},{code:'701',name:'Ventes',type:'Produit'},{code:'601',name:'Achats',type:'Charge'}];
const entries=[
 E('a1','2025-03-01','Vente',[['512',500000,0],['701',0,500000]]),
 E('a2','2025-04-01','Achat',[['601',300000,0],['512',0,300000]]),
 E('c1','2025-12-31',"Clôture de l'exercice au 2025-12-31 — Résultat : 200 000",[['701',500000,0],['601',0,300000],['110',0,200000]]),
 E('b1','2026-02-01','Vente 2026',[['512',100000,0],['701',0,100000]]),
 E('u1','2026-01-05','Achat de dollars',[['5121',2600000,0],['512',0,2600000]],{fxc:{type:'buy',usd:20000,rate:130,cost:2600000,commission:0,source:'512'}}),
 E('f1','2026-03-01','Créance en devise — Client X',[['411',130000,0],['701',0,130000]],{fx:{type:'open',docId:'f1',kind:'creance',currency:'USD',amount:1000,rate:130,party:'Client X',ref:''}}),
];
const loans=[{id:'L1',name:'Prêt USD — machine',kind:'banque',principal:10000,annualRate:6,startDate:'2026-01-10',currency:'USD',bookRate:130,bookHtg:1300000,account:'164',status:'encours',disbursed:true,alreadyRunning:false,periodMonths:1,method:'capital',rows:[{n:1,date:'2026-12-10',capital:10000,interest:50,insurance:0,total:10050,status:'prevue'}]}];
const pageInit=new Function("try{localStorage.removeItem('compta-plus-active-tab')}catch(e){};");
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const A=await boot(b,{settings:{companyName:'Exo SA',currency:'HTG',lockDate:'2025-12-31',lastClosingDate:'2025-12-31',fxRates:[{id:'r1',date:'2026-01-01',currency:'USD',rate:135}]},primary:true,cats:{accounts,entries,loans},pageInit});
const P=A.p;const T=(id)=>P.locator(`[data-testid="${id}"]`);
const nav=async(Q)=>{await Q.getByText('Comptabilité',{exact:true}).first().click();await Q.waitForTimeout(500);await Q.getByRole('button',{name:'Clôture',exact:true}).first().click();await Q.waitForTimeout(300);await Q.getByRole('button',{name:'Exercices clos',exact:true}).click();await Q.waitForTimeout(500);};
await nav(P);
ok('onglet Exercices clos affiché',(await T('exercices-panel').count())===1);
const opts=await T('exo-select').locator('option').allInnerTexts();
ok('liste : exercice en cours + exercice clos',opts.length===2&&/en cours/i.test(opts[0])&&/clos le 2025-12-31/.test(opts[1]),opts);
ok('exercice clos sélectionné par défaut',(await T('exo-select').inputValue())==='c1');
ok('bilan affiché',(await T('exo-bilan').count())===1&&/TOTAL ACTIF/i.test(await T('exo-bilan').innerText()));
await T('exo-part-resultat').click();await P.waitForTimeout(300);
ok('résultat de 2025 : 200 000',/200[\s  ,.]?000/.test(await T('exo-resultat').innerText()),await T('exo-resultat').innerText());
await T('exo-part-balance').click();await P.waitForTimeout(300);
const bt=await T('exo-balance').innerText();
ok('balance avant clôture : ventes 500 000 et achats 300 000 présents',/701/.test(bt)&&/500[\s  ,.]?000/.test(bt)&&/601/.test(bt)&&/300[\s  ,.]?000/.test(bt),bt.slice(0,200));
await T('exo-part-journal').click();await P.waitForTimeout(300);
ok('journal 2025 : 3 écritures (dont la clôture)',(await T('exo-journal-row').count())===3,await T('exo-journal-row').count());
await T('exo-select').selectOption('open');await P.waitForTimeout(300);
await T('exo-part-resultat').click();await P.waitForTimeout(300);
ok('exercice en cours : résultat 2026 = 100 000 + 130 000 = 230 000',/230[\s  ,.]?000/.test(await T('exo-resultat').innerText()),await T('exo-resultat').innerText());
// réévaluation
await T('exo-view-devises').click();await P.waitForTimeout(300);
await T('reval-date').fill('2026-10-15');await P.waitForTimeout(300);
ok('3 éléments à réévaluer (créance, compte USD, emprunt)',(await T('reval-row').count())===3,await T('reval-row').count());
await T('reval-rate-USD').fill('140');await P.waitForTimeout(300);
ok('gains latents 210 000',/210[\s  ,.]?000/.test(await T('reval-gain').innerText()),await T('reval-gain').innerText());
ok('pertes latentes 100 000',/100[\s  ,.]?000/.test(await T('reval-perte').innerText()),await T('reval-perte').innerText());
ok('écriture proposée affichée (476 et 477)',/476/.test(await T('reval-proposal').innerText())&&/477/.test(await T('reval-proposal').innerText()));
const n0=(await P.evaluate(()=>window.__srv.getCat('entries'))).length;
await T('reval-book').click();await P.waitForTimeout(500);
ok('sans validation de l\'expert : rien n\'est comptabilisé',(await P.evaluate(()=>window.__srv.getCat('entries'))).length===n0);
await T('reval-expert').fill('Marie Expert');await T('reval-validated').check();
await T('reval-book').click();await P.waitForTimeout(900);
let ents=await P.evaluate(()=>window.__srv.getCat('entries'));
const e1=ents.find(e=>e.exoReval),e2=e1&&ents.find(e=>e.reversalOf===e1.id);
ok('réévaluation comptabilisée (écriture + extourne)',!!e1&&!!e2&&ents.length===n0+2,ents.length);
const bl=(e,c)=>e.lines.filter(l=>l.account===c).reduce((s,l)=>s+l.debit-l.credit,0);
ok('écriture : 411 +10 000, 5121 +200 000, 477 -210 000, 476 +100 000, 164 -100 000',bl(e1,'411')===10000&&bl(e1,'5121')===200000&&bl(e1,'477')===-210000&&bl(e1,'476')===100000&&bl(e1,'164')===-100000,e1&&e1.lines);
ok('écriture équilibrée et extourne au lendemain, inverse exacte',Math.abs(e1.lines.reduce((s,l)=>s+l.debit-l.credit,0))<0.005&&e2.date==='2026-10-16'&&Math.abs([...e1.lines,...e2.lines].reduce((s,l)=>s+l.debit-l.credit,0))<0.005&&e1.exoReval.validatedBy==='Marie Expert');
const accs=await P.evaluate(()=>window.__srv.getCat('accounts').map(a=>a.code));
ok('comptes 476 et 477 créés',accs.includes('476')&&accs.includes('477'),accs);
await T('reval-book').click({force:true}).catch(()=>{});await P.waitForTimeout(500);
ok('pas de doublon à la même date',(await P.evaluate(()=>window.__srv.getCat('entries').filter(e=>e.exoReval).length))===1);
// réouverture
await T('exo-view-rouvrir').click();await P.waitForTimeout(300);
ok('dernier exercice clos proposé : 2025-12-31',/2025-12-31/.test(await T('reopen-date').innerText()));
await T('reopen-motif').fill('court');await T('reopen-btn').click();await P.waitForTimeout(500);
ok('motif trop court : refusé',!(await P.evaluate(()=>window.__srv.getCat('entries').some(e=>e.reversalOf==='c1'))));
await T('reopen-motif').fill('Facture fournisseur oubliée à enregistrer en 2025');await T('reopen-btn').click();await P.waitForTimeout(1000);
ents=await P.evaluate(()=>window.__srv.getCat('entries'));
const rv=ents.find(e=>e.reversalOf==='c1'),orig=ents.find(e=>e.id==='c1');
ok('contrepassation de la clôture à sa date',!!rv&&rv.date==='2025-12-31'&&orig.cancelledBy===rv.id&&/annulée/.test(rv.label),rv);
const set=await P.evaluate(()=>window.__srv.getCat('settings'));
ok('réglages : période déverrouillée, plus de clôture, trace de la réouverture',(!set.lockDate)&&!set.lastClosingDate&&set.exerciseReopen&&set.exerciseReopen.closingDate==='2025-12-31'&&/oubliée/.test(set.exerciseReopen.motif),set);
ok('bandeau « exercice rouvert » affiché',(await T('exo-reopened').count())===1);
const hist=await P.evaluate(()=>(window.__srv.getCat('auditLog')||window.__srv.getCat('audit_log')||[]).map(a=>a.action).join('|'));
ok('trace dans l\'historique (si journal disponible)',/Réouverture d'exercice/.test(hist)||hist==='',hist);
ok('toutes les écritures équilibrées',ents.every(e=>Math.abs(e.lines.reduce((s,l)=>s+l.debit-l.credit,0))<0.005));
ok('aucune erreur JS',A.errs.length===0,A.errs.slice(0,3));
// consultant : lecture seule
const C=await boot(b,{settings:{companyName:'Exo SA',currency:'HTG',lockDate:'2025-12-31',lastClosingDate:'2025-12-31'},cats:{accounts,entries,loans},pageInit:new Function("try{localStorage.removeItem('compta-plus-active-tab')}catch(e){};window.__srv.tables.company_members[0].role='Lecture seule';")});
await nav(C.p);
ok('consultant : consultation possible',(await C.p.locator('[data-testid="exo-select"]').count())===1);
await C.p.locator('[data-testid="exo-view-rouvrir"]').click();await C.p.waitForTimeout(300);
ok('consultant : aucun bouton de réouverture',(await C.p.locator('[data-testid="reopen-btn"]').count())===0);
await C.p.locator('[data-testid="exo-view-devises"]').click();await C.p.waitForTimeout(300);
ok('consultant : aucun bouton de comptabilisation',(await C.p.locator('[data-testid="reval-book"]').count())===0);
ok('aucune erreur JS (consultant)',C.errs.length===0,C.errs.slice(0,3));
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

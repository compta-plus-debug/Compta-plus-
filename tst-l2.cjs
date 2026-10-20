// v236 : module Emprunts dans l'application (écritures, paiement, annulation, remboursement anticipé, intérêts courus).
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const accounts=[{code:'512',name:'Banque',type:'Actif'},{code:'530',name:'Caisse',type:'Actif'},{code:'627',name:'Frais bancaires',type:'Charge'},{code:'616',name:'Assurances',type:'Charge'}];
const pageInit=(extra)=>new Function(`try{localStorage.removeItem('compta-plus-active-tab')}catch(e){};${extra||''}`);
const A=await boot(b,{settings:{companyName:'Prêts SA',currency:'HTG'},primary:true,cats:{accounts,entries:[]},pageInit:pageInit()});
const P=A.p;const T=(id)=>P.locator(`[data-testid="${id}"]`);
await P.getByText('Comptabilité',{exact:true}).first().click();await P.waitForTimeout(500);
await P.getByRole('button',{name:'Immobilisations & Provisions'}).click();await P.waitForTimeout(300);
await P.getByRole('button',{name:'Emprunts',exact:true}).click();await P.waitForTimeout(500);
ok('onglet Emprunts affiché',(await T('loans-panel').count())===1);
// refus : formulaire incomplet
await T('loan-save').click();await P.waitForTimeout(300);
ok('formulaire vide : aucun emprunt',(await T('loan-card').count())===0);
await T('loan-name').fill('Prêt banque — camion');
await T('loan-principal').fill('120000');await T('loan-rate').fill('12');
await T('loan-start').fill('2026-01-10');await T('loan-first').fill('2026-02-10');await T('loan-count').fill('12');
await T('loan-fees').fill('1200');
await T('loan-compute').click();await P.waitForTimeout(300);
ok('aperçu : 12 lignes',(await T('loan-preview').locator('tbody tr').count())===13);
await T('loan-save').click();await P.waitForTimeout(900);
ok('emprunt enregistré',(await T('loan-card').count())===1);
let ents=await P.evaluate(()=>window.__srv.getCat('entries'));
ok('écriture de déblocage',ents.length===1&&/Déblocage/.test(ents[0].label),ents);
const d=ents[0];const dl=(c)=>d.lines.filter(l=>l.account===c).reduce((s,l)=>s+l.debit-l.credit,0);
ok('déblocage : banque +118 800, frais 1 200, emprunt -120 000',dl('512')===118800&&dl('627')===1200&&dl('164')===-120000,d.lines);
const accs=await P.evaluate(()=>window.__srv.getCat('accounts').map(a=>a.code));
ok('comptes 164, 6611, 1688 créés',['164','6611','1688'].every(c=>accs.includes(c)),accs);
const saved=await P.evaluate(()=>window.__srv.getCat('loans'));
ok('emprunt sauvegardé avec 12 échéances',saved.length===1&&saved[0].rows.length===12,saved.length);
ok('capital restant dû = 120 000',/120[\s  ,.]?000/.test(await T('loan-remaining').first().innerText()),await T('loan-remaining').first().innerText());
// paiement 1re échéance
ok('tableau ouvert après création',(await T('loan-table').count())===1);
await T('loan-pay').first().click();await P.waitForTimeout(300);
await T('pay-date').fill('2026-02-10');
await T('pay-save').click();await P.waitForTimeout(900);
ents=await P.evaluate(()=>window.__srv.getCat('entries'));
ok('paiement : 2e écriture',ents.length===2&&/Échéance 1\/12/.test(ents[1].label),ents.map(e=>e.label));
const pe=ents[1];const bal=pe.lines.reduce((s,l)=>s+l.debit-l.credit,0);
ok('paiement équilibré, capital + intérêts contre banque',Math.abs(bal)<0.005&&pe.lines.some(l=>l.account==='164'&&l.debit>0)&&pe.lines.some(l=>l.account==='6611'&&l.debit===1200)&&pe.lines.some(l=>l.account==='512'&&l.credit>0),pe.lines);
let sv=await P.evaluate(()=>window.__srv.getCat('loans')[0].rows[0].status);
ok('échéance 1 marquée payée',sv==='payee',sv);
// la 2e est maintenant la seule à pouvoir être payée
ok('un seul bouton Payer (la prochaine)',(await T('loan-pay').count())===1);
// correction d'une échéance (tableau de la banque)
await T('loan-edit').first().click();await P.waitForTimeout(300);
await T('edit-interest').fill('1111');await T('edit-save').click();await P.waitForTimeout(500);
const r2=await P.evaluate(()=>window.__srv.getCat('loans')[0].rows[1]);
ok('correction : intérêts 1 111 et total recalculé',r2.interest===1111&&Math.abs(r2.total-(r2.capital+1111))<0.005&&r2.edited===true,r2);
// annulation du paiement (administrateur)
await T('loan-cancel').first().click();await P.waitForTimeout(900);
ents=await P.evaluate(()=>window.__srv.getCat('entries'));
ok('annulation : contrepassation ajoutée',ents.length===3&&ents[2].reversalOf===ents[1].id&&ents[1].cancelledBy===ents[2].id,ents.map(e=>e.label));
sv=await P.evaluate(()=>window.__srv.getCat('loans')[0].rows[0].status);
ok('échéance 1 redevient à payer',sv==='prevue',sv);
// repayer
await T('loan-pay').first().click();await P.waitForTimeout(300);await T('pay-date').fill('2026-02-10');await T('pay-save').click();await P.waitForTimeout(800);
// intérêts courus
await T('loan-accrual-btn').click();await P.waitForTimeout(300);
await T('accr-date').fill('2026-03-01');await P.waitForTimeout(200);
ok('intérêts courus proposés > 0',!/^0|—/.test((await T('accr-amount').innerText()).trim()),await T('accr-amount').innerText());
await T('accr-save').click();await P.waitForTimeout(900);
ents=await P.evaluate(()=>window.__srv.getCat('entries'));
const acc1=ents.find(e=>/Intérêts courus non échus/.test(e.label)),acc2=ents.find(e=>/Extourne intérêts courus/.test(e.label));
ok('intérêts courus : écriture + extourne au lendemain',!!acc1&&!!acc2&&acc2.date==='2026-03-02'&&acc1.lines.some(l=>l.account==='1688'&&l.credit>0)&&acc2.lines.some(l=>l.account==='1688'&&l.debit>0),[acc1,acc2]);
await T('loan-accrual-btn').click();await P.waitForTimeout(300);await T('accr-date').fill('2026-03-01');await T('accr-save').click();await P.waitForTimeout(500);
ok('intérêts courus : pas de doublon à la même date',(await P.evaluate(()=>window.__srv.getCat('entries').filter(e=>/Intérêts courus non échus/.test(e.label)).length))===1);
// remboursement anticipé partiel
await T('loan-early-btn').click();await P.waitForTimeout(300);
await T('early-date').fill('2026-03-05');await T('early-capital').fill('30000');await T('early-penalty').fill('300');
await T('early-save').click();await P.waitForTimeout(900);
ents=await P.evaluate(()=>window.__srv.getCat('entries'));
const ea=ents.find(e=>/Remboursement anticipé partiel/.test(e.label));
ok('anticipé partiel : capital 30 000 et pénalité 300 (668)',!!ea&&ea.lines.some(l=>l.account==='164'&&l.debit===30000)&&ea.lines.some(l=>l.account==='668'&&l.debit===300)&&Math.abs(ea.lines.reduce((s,l)=>s+l.debit-l.credit,0))<0.005,ea);
const ln=await P.evaluate(()=>window.__srv.getCat('loans')[0]);
const paidCap=ln.rows.filter(r=>r.status==='payee').reduce((s,r)=>s+r.capital,0);
const unpaidCap=ln.rows.filter(r=>r.status==='prevue').reduce((s,r)=>s+r.capital,0);
ok('anticipé partiel : capital payé + restant = 120 000',Math.abs(paidCap+unpaidCap-120000)<0.02,[paidCap,unpaidCap]);
// remboursement total
await T('loan-early-btn').click();await P.waitForTimeout(300);
await T('early-date').fill('2026-03-06');await T('early-total').check();await T('early-save').click();await P.waitForTimeout(900);
const fin=await P.evaluate(()=>window.__srv.getCat('loans')[0]);
ok('remboursement total : emprunt soldé',fin.status==='solde'&&fin.rows.every(r=>r.status==='payee'),fin.status);
const allEnts=await P.evaluate(()=>window.__srv.getCat('entries'));
const net164=allEnts.filter(e=>!e.reversalOf||!/Contrepassation/.test(e.label)||true).flatMap(e=>e.lines).filter(l=>l.account==='164').reduce((s,l)=>s+l.debit-l.credit,0);
ok('compte 164 soldé à zéro dans le journal',Math.abs(net164)<0.02,net164);
ok('toutes les écritures équilibrées',allEnts.every(e=>Math.abs(e.lines.reduce((s,l)=>s+l.debit-l.credit,0))<0.005));
ok('aucune erreur JS',A.errs.length===0,A.errs.slice(0,3));
// période clôturée : refus
const B=await boot(b,{settings:{companyName:'Prêts SA',currency:'HTG',lockDate:'2026-06-30'},primary:true,cats:{accounts,entries:[]},pageInit:pageInit()});
const Q=B.p;await Q.getByText('Comptabilité',{exact:true}).first().click();await Q.waitForTimeout(500);
await Q.getByRole('button',{name:'Immobilisations & Provisions'}).click();await Q.waitForTimeout(300);await Q.getByRole('button',{name:'Emprunts',exact:true}).click();await Q.waitForTimeout(400);
await Q.locator('[data-testid="loan-name"]').fill('X');await Q.locator('[data-testid="loan-principal"]').fill('1000');await Q.locator('[data-testid="loan-rate"]').fill('5');
await Q.locator('[data-testid="loan-start"]').fill('2026-01-10');await Q.locator('[data-testid="loan-first"]').fill('2026-02-10');
await Q.locator('[data-testid="loan-save"]').click();await Q.waitForTimeout(600);
ok('période clôturée : déblocage refusé',(await Q.locator('[data-testid="loan-card"]').count())===0&&(await Q.evaluate(()=>window.__srv.getCat('entries').length))===0);
// consultant : aucun formulaire
const C=await boot(b,{settings:{companyName:'Prêts SA',currency:'HTG'},cats:{accounts,entries:[]},pageInit:pageInit("window.__srv.tables.company_members[0].role='Lecture seule';")});
const R=C.p;await R.getByText('Comptabilité',{exact:true}).first().click();await R.waitForTimeout(500);
await R.getByRole('button',{name:'Immobilisations & Provisions'}).click();await R.waitForTimeout(300);await R.getByRole('button',{name:'Emprunts',exact:true}).click();await R.waitForTimeout(400);
ok('consultant : pas de formulaire de création',(await R.locator('[data-testid="loan-form"]').count())===0);
ok('aucune erreur JS (autres)',B.errs.length+C.errs.length===0,[...B.errs,...C.errs].slice(0,3));
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

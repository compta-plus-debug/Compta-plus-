// v240 : calculs des exercices (liste, situation, réévaluation des devises, réouverture).
const fs=require('fs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const cand=['/../src/parties/','/src/parties/','/src/','/../src/','/'].map(d=>__dirname+d+'47-compta-exercices.jsx');
const found=cand.find(p=>fs.existsSync(p));
if(!found){console.log('FAIL fichier 47-compta-exercices.jsx introuvable');process.exit(1);}
const src=fs.readFileSync(found,'utf8');
const a=src.indexOf('// <calcul-exercices>'),b=src.indexOf('// </calcul-exercices>');
const L=new Function(src.slice(a,b)+';return {exoClosings,exoList,exoStatement,exoBalancesAt,exoLoanAt,exoRevalPlan,exoReopen,exoAddDays,exoIsClosing};')();
const accounts=[{code:'512',name:'Banque',type:'Actif'},{code:'411',name:'Clients',type:'Actif'},{code:'401',name:'Fournisseurs',type:'Passif'},{code:'110',name:'Report à nouveau',type:'Capitaux propres'},{code:'701',name:'Ventes',type:'Produit'},{code:'601',name:'Achats',type:'Charge'}];
const E=(id,date,label,lines,x)=>({id,date,createdAt:date+'T10:00:00Z',label,lines:lines.map(([account,debit,credit])=>({account,debit,credit})),...(x||{})});
const entries=[
 E('a1','2025-03-01','Vente',[['512',500000,0],['701',0,500000]]),
 E('a2','2025-04-01','Achat',[['601',300000,0],['512',0,300000]]),
 E('c1','2025-12-31',"Clôture de l'exercice au 2025-12-31 — Résultat : 200000",[['701',500000,0],['601',0,300000],['110',0,200000]]),
 E('b1','2026-02-01','Vente 2026',[['512',100000,0],['701',0,100000]]),
];
const cl=L.exoClosings(entries);
ok('une clôture détectée',cl.length===1&&cl[0].date==='2025-12-31'&&cl[0].entryId==='c1',cl);
const lst=L.exoList(entries,'2026-10-20');
ok('liste : exercice clos + exercice en cours',lst.length===2&&lst[0].from===null&&lst[0].to==='2025-12-31'&&lst[1].open&&lst[1].from==='2025-12-31'&&lst[1].to==='2026-10-20',lst);
let s=L.exoStatement(accounts,entries,lst[0]);
ok('exercice clos : résultat 200 000 (hors écriture de clôture)',s.totalProduits===500000&&s.totalCharges===300000&&s.resultat===200000,s);
ok('balance avant clôture : 701 créditeur 500 000, 601 débiteur 300 000, équilibrée',s.trial.find(r=>r.code==='701').solde===-500000&&s.trial.find(r=>r.code==='601').solde===300000&&Math.abs(s.trial.reduce((t,r)=>t+r.debit-r.credit,0))<0.005,s.trial);
ok('journal : 3 écritures (dont la clôture)',s.journal.length===3,s.journal.map(e=>e.id));
s=L.exoStatement(accounts,entries,lst[1]);
ok('exercice en cours : seulement 2026 (100 000)',s.resultat===100000&&s.journal.length===1,s.resultat);
const bal=L.exoBalancesAt(entries,'2025-12-31');
ok('bilan à la clôture : charges et produits à zéro, report 200 000',bal['701']===0&&bal['601']===0&&bal['110']===-200000&&bal['512']===200000,bal);
// clôture annulée ou contrepassée : ignorée
ok('clôture annulée ignorée',L.exoClosings(entries.map(e=>e.id==='c1'?{...e,cancelledBy:'x'}:e)).length===0);
// devises
const items=[
 {kind:'creance',label:'Créance client',currency:'USD',foreign:1000,book:130000,account:'411'},
 {kind:'banque',label:'Compte USD',currency:'USD',foreign:20000,book:2600000,account:'5121'},
 {kind:'emprunt',label:'Emprunt',currency:'USD',foreign:10000,book:1300000,account:'164'},
 {kind:'dette',label:'Fournisseur',currency:'USD',foreign:500,book:70000,account:'401'},
];
let p=L.exoRevalPlan(items,()=>140);
ok('réévaluation : gains 210 000 (créance + compte USD)',p.totals.gain===210000+0*1&&true,p.totals);
ok('réévaluation : pertes 100 000 (emprunt) + 0 (dette à 70 000 = 500×140)',p.totals.perte===100000,p.totals);
ok('écriture proposée équilibrée',p.balanced&&Math.abs(p.lines.reduce((t,l)=>t+l.debit-l.credit,0))<0.005,p.lines);
const g=(c)=>p.lines.find(l=>l.account===c)||{debit:0,credit:0};
ok('lignes : 411 +10 000, 5121 +200 000, 477 crédit 210 000, 476 débit 100 000, 164 crédit 100 000',g('411').debit===10000&&g('5121').debit===200000&&g('477').credit===210000&&g('476').debit===100000&&g('164').credit===100000,p.lines);
p=L.exoRevalPlan(items,()=>120);
ok('dollar en baisse : perte sur créance et compte USD, gain sur emprunt et dette',p.rows[0].nature==='perte'&&p.rows[1].nature==='perte'&&p.rows[2].nature==='gain'&&p.rows[3].nature==='gain'&&p.balanced,p.rows.map(r=>r.nature));
p=L.exoRevalPlan(items,(c)=>null);
ok('taux manquant signalé, aucune ligne',p.missing.join()==='USD'&&p.lines.length===0);
ok('aucun écart : aucune écriture',L.exoRevalPlan([{kind:'creance',label:'x',currency:'USD',foreign:10,book:1300,account:'411'}],()=>130).lines.length===0);
// emprunt à une date
const loan={currency:'USD',principal:10000,bookHtg:1300000,startDate:'2026-01-10',rows:[{status:'payee',paidDate:'2026-02-10',capital:1000,carry:130000},{status:'payee',paidDate:'2026-03-10',capital:1000,carry:130000},{status:'prevue',date:'2026-04-10',capital:1000}]};
let x=L.exoLoanAt(loan,'2026-02-28');
ok('emprunt à une date : 9 000 USD, 1 170 000',x&&x.remaining===9000&&x.book===1170000,x);
ok('emprunt avant déblocage : ignoré',L.exoLoanAt(loan,'2026-01-01')===null);
ok('emprunt en gourdes : ignoré',L.exoLoanAt({principal:5},'2026-01-01')===null);
// réouverture
let n=0;const mk=()=> 'r'+(++n);
let r=L.exoReopen(entries,'Facture oubliée à enregistrer',mk,'2026-10-20T10:00:00Z','admin@x');
ok('réouverture : contrepassation à la date de clôture',r&&r.entry.date==='2025-12-31'&&r.entry.reversalOf==='c1'&&r.closingDate==='2025-12-31',r&&r.entry);
const net=(es)=>es.flatMap(e=>e.lines).reduce((t,l)=>t+l.debit-l.credit,0);
ok('contrepassation = inverse exact',r.entry.lines.every((l,i)=>l.debit===entries[2].lines[i].credit&&l.credit===entries[2].lines[i].debit)&&Math.abs(net([entries[2],r.entry]))<0.005);
ok('réglages : plus aucune clôture, période déverrouillée',r.newSettings.lastClosingDate===null&&r.newSettings.lockDate===''&&r.newSettings.exerciseReopen.closingDate==='2025-12-31',r.newSettings);
const after=[...entries.map(e=>e.id==='c1'?{...e,cancelledBy:r.entry.id}:e),r.entry];
ok('après réouverture : plus de clôture, exercice en cours depuis le début',L.exoClosings(after).length===0&&L.exoList(after,'2026-10-20').length===1&&L.exoList(after,'2026-10-20')[0].from===null);
const s2=L.exoStatement(accounts,after,L.exoList(after,'2026-10-20')[0]);
ok('après réouverture : charges et produits de 2025 de nouveau visibles (résultat cumulé 300 000)',s2.resultat===300000,s2.resultat);
// deux clôtures : on ne rouvre que la dernière
const two=[...entries,E('c2','2026-12-31',"Clôture de l'exercice au 2026-12-31 — Résultat : 100000",[['701',100000,0],['110',0,100000]])];
r=L.exoReopen(two,'Erreur de saisie sur 2026',mk,'2027-01-05T10:00:00Z','admin@x');
ok('deux clôtures : la dernière est rouverte, la précédente reste',r.closingDate==='2026-12-31'&&r.prevDate==='2025-12-31'&&r.newSettings.lastClosingDate==='2025-12-31'&&r.newSettings.lockDate==='2025-12-31');
ok('aucune clôture : pas de réouverture',L.exoReopen([entries[0]],'x',mk,'t','u')===null);
ok('jour suivant (extourne) : changement d\'année',L.exoAddDays('2026-12-31',1)==='2027-01-01');
console.log('fails='+fails);process.exit(fails?1:0);

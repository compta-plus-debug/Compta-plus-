// v236 : calculs du module Emprunts (tableau d'amortissement, intérêts courus, remboursement anticipé).
const fs=require('fs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
// Le dépôt peut être rangé de plusieurs façons : on cherche le fichier aux emplacements connus.
const cand=['/../src/parties/','/src/parties/','/src/','/../src/','/'].map(d=>__dirname+d+'46-compta-emprunts.jsx');
const found=cand.find(p=>fs.existsSync(p));
if(!found){console.log('FAIL fichier 46-compta-emprunts.jsx introuvable');process.exit(1);}
const src=fs.readFileSync(found,'utf8');
const a=src.indexOf('// <calcul-emprunts>'),b=src.indexOf('// </calcul-emprunts>');
const lib=new Function(src.slice(a,b)+';return {loanBuildSchedule,loanSummary,loansTotals,loanAccrued,loanRebuildAfterPartial,loanAddMonths,loanAddDays,loanDaysBetween,loanValidDate,loanRound};')();
const sum=(rows,k)=>Math.round(rows.reduce((s,r)=>s+r[k],0)*100)/100;
const base={principal:100000,annualRate:12,count:12,periodMonths:1,firstDate:'2026-02-01',method:'annuite',grace:0,insurance:0};
let r=lib.loanBuildSchedule(base);
ok('annuité : 12 échéances',r.length===12);
ok('annuité : échéance de 8 884,88',r[0].total===8884.88&&r[5].total===8884.88,[r[0].total,r[5].total]);
ok('annuité : capital total = montant emprunté',sum(r,'capital')===100000,sum(r,'capital'));
ok('annuité : 1er intérêt = 1 000',r[0].interest===1000,r[0].interest);
ok('annuité : intérêts décroissants',r[0].interest>r[11].interest);
r=lib.loanBuildSchedule({...base,method:'capital',annualRate:0,principal:120000});
ok('capital constant sans intérêt : 10 000 par échéance',r.every(x=>x.capital===10000&&x.interest===0)&&sum(r,'capital')===120000);
r=lib.loanBuildSchedule({...base,method:'infine'});
ok('in fine : intérêts mensuels de 1 000 et capital à la fin',r.slice(0,11).every(x=>x.capital===0&&x.interest===1000)&&r[11].capital===100000);
r=lib.loanBuildSchedule({...base,grace:2});
ok('différé de 2 échéances : intérêts seuls',r[0].capital===0&&r[1].capital===0&&r[2].capital>0&&sum(r,'capital')===100000);
r=lib.loanBuildSchedule({...base,firstDate:'2026-01-31'});
ok('fin de mois : 28 février puis 31 mars',r[1].date==='2026-02-28'&&r[2].date==='2026-03-31'&&r[3].date==='2026-04-30',[r[1].date,r[2].date,r[3].date]);
r=lib.loanBuildSchedule({...base,count:4,periodMonths:3,firstDate:'2026-03-15'});
ok('trimestriel : pas de 3 mois',r.map(x=>x.date).join()==='2026-03-15,2026-06-15,2026-09-15,2026-12-15');
r=lib.loanBuildSchedule({...base,insurance:150});
ok('assurance ajoutée au total',r[0].total===8884.88+150&&r[0].insurance===150);
for(const method of ['annuite','capital','infine'])for(const rate of [0,3.5,18])for(const count of [1,2,7,36])for(const pm of [1,3,12]){
  const rr=lib.loanBuildSchedule({principal:123456.78,annualRate:rate,count,periodMonths:pm,firstDate:'2026-05-10',method,grace:0,insurance:0});
  if(sum(rr,'capital')!==123456.78||rr.some(x=>x.capital<0||x.interest<0)){ok('propriété capital total '+method+' '+rate+' '+count+' '+pm,false,sum(rr,'capital'));break;}
}
ok('propriété : capital total toujours égal au montant emprunté',true);
// situation
let loan={id:1,principal:100000,annualRate:12,startDate:'2026-01-01',firstRowStart:'2026-01-01',periodMonths:1,method:'annuite',status:'encours',disbursed:true,rows:lib.loanBuildSchedule(base)};
loan.rows=loan.rows.map((x,i)=>i<3?{...x,status:'payee'}:x);
let s=lib.loanSummary(loan,'2026-06-15');
ok('capital restant dû après 3 paiements',Math.abs(s.remaining-(100000-sum(loan.rows.slice(0,3),'capital')))<0.01,s.remaining);
ok('part à moins d\'un an = 9 échéances restantes',Math.abs(s.dueWithinYear-s.remaining)<0.01,[s.dueWithinYear,s.remaining]);
ok('échéances en retard au 15/06 : 1er mai et 1er juin',s.overdue===2,s.overdue);
s=lib.loanSummary({...loan,rows:lib.loanBuildSchedule({...base,count:36})},'2026-01-01');
ok('36 mois : à moins d\'un an < capital restant',s.dueWithinYear<s.remaining&&s.dueWithinYear>0,[s.dueWithinYear,s.remaining]);
// intérêts courus
let l2={id:2,principal:100000,annualRate:12,startDate:'2026-01-31',firstRowStart:'2026-01-31',periodMonths:1,method:'infine',status:'encours',disbursed:true,rows:lib.loanBuildSchedule({...base,method:'infine',firstDate:'2026-02-28'})};
ok('intérêts courus au prorata (14 j sur 28)',lib.loanAccrued(l2,'2026-02-14')===500,lib.loanAccrued(l2,'2026-02-14'));
ok('intérêts courus : échéance échue non payée comptée en entier',lib.loanAccrued(l2,'2026-02-28')===1000,lib.loanAccrued(l2,'2026-02-28'));
ok('intérêts courus : emprunt soldé = 0',lib.loanAccrued({...l2,status:'solde'},'2026-02-14')===0);
// remboursement anticipé partiel
const paid=loan.rows.map((x,i)=>i<2?{...x,status:'payee'}:{...x,status:'prevue'});
const L3={...loan,rows:paid};
const rb=lib.loanRebuildAfterPartial(L3,'2026-03-10',30000);
const unpaidRb=rb.filter(x=>x.status==='prevue');
const remainBefore=100000-sum(paid.slice(0,2),'capital');
ok('partiel : nombre d\'échéances conservé',unpaidRb.length===10&&rb.length===12,[unpaidRb.length,rb.length]);
ok('partiel : capital restant = ancien - remboursement',Math.abs(sum(unpaidRb,'capital')-(remainBefore-30000))<0.01,sum(unpaidRb,'capital'));
ok('partiel : numérotation continue',rb.map(x=>x.n).join()==='1,2,3,4,5,6,7,8,9,10,11,12');
ok('partiel : 1er intérêt réduit au prorata',unpaidRb[0].interest<paid[2].interest*0.5+0.01&&unpaidRb[0].interest>0,unpaidRb[0].interest);
const rbAll=lib.loanRebuildAfterPartial(L3,'2026-03-10',remainBefore);
ok('partiel égal au solde : plus d\'échéance à payer',rbAll.filter(x=>x.status==='prevue').length===0);
ok('dates valides',lib.loanValidDate('2026-02-28')&&!lib.loanValidDate('2026-02-30')&&!lib.loanValidDate('abc'));
ok('addDays : changement de mois',lib.loanAddDays('2026-12-31',1)==='2027-01-01');
const tt=lib.loansTotals([loan,l2],'2026-06-15');
ok('totaux : somme des capitaux restants',Math.abs(tt.remaining-(lib.loanSummary(loan,'2026-06-15').remaining+lib.loanSummary(l2,'2026-06-15').remaining))<0.01);
console.log('fails='+fails);process.exit(fails?1:0);

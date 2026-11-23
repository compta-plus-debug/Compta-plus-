// v236 : calculs du module Emprunts (tableau d'amortissement, intérêts courus, remboursement anticipé).
const fs=require('fs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
// Le dépôt peut être rangé de plusieurs façons : on cherche le fichier aux emplacements connus.
const cand=['/../src/parties/','/src/parties/','/src/','/../src/','/'].map(d=>__dirname+d+'46-compta-emprunts.jsx');
const found=cand.find(p=>fs.existsSync(p));
if(!found){console.log('FAIL fichier 46-compta-emprunts.jsx introuvable');process.exit(1);}
const src=fs.readFileSync(found,'utf8');
const a=src.indexOf('// <calcul-emprunts>'),b=src.indexOf('// </calcul-emprunts>');
const lib=new Function(src.slice(a,b)+';return {loanBuildSchedule,loanSummary,loansTotals,loanAccrued,loanRebuildAfterPartial,loanAddMonths,loanAddDays,loanDaysBetween,loanValidDate,loanRound,loanFxSettle,loanBookRemaining,loanIsFx};')();
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
// v237 : emprunts en devise
const fxl={id:9,currency:'USD',principal:10000,bookHtg:1300000,annualRate:6,startDate:'2026-01-01',firstRowStart:'2026-01-01',periodMonths:1,method:'capital',status:'encours',disbursed:true,rows:lib.loanBuildSchedule({principal:10000,annualRate:6,count:10,periodMonths:1,firstDate:'2026-02-01',method:'capital',grace:0,insurance:0})};
ok('devise : valeur comptable initiale',lib.loanBookRemaining(fxl)===1300000);
ok('HTG : pas de valeur comptable séparée',lib.loanBookRemaining({principal:5})===null&&!lib.loanIsFx({principal:5})&&lib.loanIsFx(fxl));
let f1=lib.loanFxSettle(1300000,10000,{capital:1000,interest:50,insurance:0},140);
ok('règlement : valeur comptable sortie 130 000',f1.carry===130000,f1);
ok('règlement : capital 140 000 + intérêts 7 000 = 147 000',f1.capV===140000&&f1.intV===7000&&f1.cash===147000,f1);
ok('règlement : perte de change 10 000 (dollar plus cher)',f1.diff===10000,f1.diff);
f1=lib.loanFxSettle(1300000,10000,{capital:1000,interest:50},125);
ok('règlement : gain de change 5 000 (dollar moins cher)',f1.diff===-5000,f1.diff);
const eqBal=(r)=>Math.round((r.carry+r.intV+r.insV+r.penV+Math.max(r.diff,0)-(r.cash+Math.max(-r.diff,0)))*100)/100;
ok('écriture équilibrée dans les deux sens',eqBal(lib.loanFxSettle(1300000,10000,{capital:1000,interest:50,insurance:10,penalty:5},140))===0&&eqBal(lib.loanFxSettle(1300000,10000,{capital:1000,interest:50,insurance:10,penalty:5},125))===0);
f1=lib.loanFxSettle(1300000,10000,{capital:1000,interest:50},null,147500);
ok('paiement depuis le compte USD : sortie au coût, répartie',f1.cash===147500&&f1.intV===7023.81&&f1.capV===140476.19,f1);
const last=lib.loanFxSettle(260000,2000,{capital:2000,interest:10},150);
ok('dernier règlement : solde exactement la valeur comptable',last.carry===260000&&last.diff===40000,last);
// cycle complet : 10 paiements à des taux variables, la valeur comptable tombe à zéro
let cur={...fxl,rows:fxl.rows.map(x=>({...x}))},rates=[131,133,129,135,140,138,142,128,130,136],sumDiff=0,cashTot=0;
cur.rows.forEach((row,i)=>{const bk=lib.loanBookRemaining(cur),rem=lib.loanSummary(cur,'2026-01-01').remaining;const r=lib.loanFxSettle(bk,rem,{capital:row.capital,interest:row.interest},rates[i]);row.status='payee';row.carry=r.carry;sumDiff+=r.diff;cashTot+=r.capV;});
cur.status='solde';
ok('cycle complet : capital total 10 000 USD',Math.abs(cur.rows.reduce((s,x)=>s+x.capital,0)-10000)<0.011);
ok('cycle complet : somme des valeurs comptables sorties = valeur d\'origine',Math.abs(cur.rows.reduce((s,x)=>s+x.carry,0)-1300000)<0.02,cur.rows.reduce((s,x)=>s+x.carry,0));
ok('cycle complet : écarts = décaissé capital - valeur d\'origine',Math.abs(sumDiff-(cashTot-1300000))<0.02,[sumDiff,cashTot]);
const part=lib.loanSummary({...fxl,rows:fxl.rows.map((x,i)=>i<4?{...x,status:'payee',carry:Math.round(x.capital*130*100)/100}:x)},'2026-01-01');
ok('situation en devise : valeur comptable proportionnelle',part.remaining===6000&&Math.abs(part.remainingBook-780000)<0.05,[part.remaining,part.remainingBook]);
const mix=lib.loansTotals([loan,{...fxl}],'2026-01-01');
ok('totaux mixtes : gourdes + valeur comptable',Math.abs(mix.remaining-(lib.loanSummary(loan,'2026-01-01').remaining+1300000))<0.02,mix.remaining);
console.log('fails='+fails);process.exit(fails?1:0);

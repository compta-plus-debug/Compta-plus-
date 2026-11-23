// v270 — Santé : rôle Réception (Vendeur), contrôle des doublons et de la fraude, produits réservés à la pharmacie.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const base={companyName:'Sante Test',currency:'HTG'};
const mk=(role,sect)=>new Function("(function(){const S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors="+JSON.stringify(sect)+";S.tables.companies[0].sectors_locked=true;S.tables.company_members[0].role="+JSON.stringify(role)+";try{sessionStorage.clear();localStorage.removeItem('compta-plus-espace')}catch(e){}})();");
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const tab=async(p,id)=>{await g(p,'sante-tab-'+id).click();await p.waitForTimeout(300)};
const cat=(p,c)=>p.evaluate((c)=>window.__srv.getCat(c)||[],c);
const addP=async(p,nom,tel,pol)=>{await g(p,'sante-patient-nom').fill(nom);await p.locator('[data-testid="sante-module"] input[type=tel]').fill(tel);await p.locator('[data-testid="sante-module"] input').nth(2).fill(pol);await g(p,'sante-patient-ajouter').click();await p.waitForTimeout(350)};
const seed=(kind)=>[...(kind?[{type:'etab',id:'etab',kind}]:[]),
 {type:'patient',id:'p1',number:'PAT-0001',name:'Marie Pierre',phone:'3700-1111',insurerId:'',policy:'P-123',etab:kind||'cabinet'},
 {type:'act',id:'a1',code:'',label:'Consultation',price:1000,cat:'consultation',productId:'',etab:kind||'cabinet'},
 {type:'act',id:'a2',code:'',label:'Médicament Riz',price:100,cat:'produit',productId:'1700000000001',etab:kind||'cabinet'}];
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p}=await boot(b,{settings:base,primary:true,cats:{sante:seed()},pageInit:mk('Administrateur',['sante'])});await p.waitForTimeout(1200);
 await tab(p,'patients');
 const n=async()=>g(p,'sante-patient-ligne').count();
 ok('départ : 1 patient',(await n())===1);
 await addP(p,'marie  PIERRE','+509 3700 1111','');
 ok('même nom + même téléphone : bloqué',(await n())===1);
 await addP(p,'Pierre Marie','2222-2222','p123');
 ok('même nom (ordre inversé) + même police : bloqué',(await n())===1);
 await addP(p,'Marié Pierre','2222-2222','Z-999');
 ok('homonyme avec autre téléphone et autre police : autorisé',(await n())===2);
 await addP(p,'Luc Marc','3700-1111','');
 ok('même téléphone, autre nom : autorisé avec avertissement',(await n())===3);
 await addP(p,'Jean Paul','','P-123');
 ok('police commune, autre nom : le responsable peut confirmer',(await n())===4);
 await p.close();}
{const {p}=await boot(b,{settings:base,primary:false,cats:{sante:seed()},pageInit:mk('Vendeur',['sante'])});await p.waitForTimeout(1200);
 ok('réception : module et note d\'accueil visibles',(await g(p,'sante-module').count())===1&&(await g(p,'sante-accueil-note').count())===1);
 ok('réception : libellé « Réceptionniste »',/Réceptionniste/.test(await p.locator('body').innerText()));
 ok('réception : pas d\'onglets Assureurs, Praticiens, Rapports',(await g(p,'sante-tab-assureurs').count())===0&&(await g(p,'sante-tab-praticiens').count())===0&&(await g(p,'sante-tab-rapports').count())===0);
 await tab(p,'patients');
 const n=async()=>g(p,'sante-patient-ligne').count();
 await addP(p,'Jean Paul','','P-123');
 ok('réception : police déjà utilisée par une autre personne → bloqué',(await n())===1);
 await addP(p,'marie pierre','3700-1111','');
 ok('réception : doublon bloqué',(await n())===1);
 await addP(p,'Rose Louis','4444-4444','');
 ok('réception : nouvelle fiche créée',(await n())===2);
 await g(p,'sante-patient-modifier').first().click();await g(p,'sante-patient-edit-tel').fill('5555-5555');await g(p,'sante-patient-edit-ok').click();await p.waitForTimeout(400);
 const pats=(await cat(p,'sante')).filter(r=>r.type==='patient');
 ok('réception : fiche modifiée',pats.some(x=>x.id==='p1'&&x.phone==='5555-5555'),pats.map(x=>x.phone));
 ok('réception : pas de bouton Supprimer',(await g(p,'sante-patient-supprimer').count())===0);
 await tab(p,'factures');
 await g(p,'sante-fact-patient').selectOption({label:'Marie Pierre'});
 const opts=await g(p,'sante-fact-acte').locator('option').allInnerTexts();
 ok('réception en cabinet : aucun produit dans la facturation',opts.some(x=>/Consultation/.test(x))&&!opts.some(x=>/Médicament/.test(x)),opts);
 await g(p,'sante-fact-acte').selectOption({index:1});await g(p,'sante-fact-ajouter').click();await g(p,'sante-fact-emettre').click();await p.waitForTimeout(600);
 const inv=(await cat(p,'sante')).filter(r=>r.type==='invoice');
 ok('réception : facture émise et enregistrée',inv.length===1&&inv[0].total===1000,inv.length);
 await g(p,'sante-enc-montant').fill('1000');await g(p,'sante-enc-valider').click();await p.waitForTimeout(500);
 const inv2=(await cat(p,'sante')).filter(r=>r.type==='invoice');
 ok('réception : encaissement enregistré',inv2[0].payments.length===1);
 ok('réception : ni annulation de facture ni d\'encaissement',(await g(p,'sante-facture-annuler').count())===0&&(await g(p,'sante-paiement-annuler').count())===0);
 await p.close();}
{const {p}=await boot(b,{settings:base,primary:false,cats:{sante:seed('pharmacie')},pageInit:mk('Vendeur',['sante'])});await p.waitForTimeout(1200);
 ok('comptoir en pharmacie : libellé « Vendeur(se) de comptoir »',/Vendeur\(se\) de comptoir/.test(await p.locator('body').innerText()));
 await tab(p,'patients');await addP(p,'Client Un','1111-1111','');
 await tab(p,'factures');await g(p,'sante-fact-patient').selectOption({label:'Client Un'});
 const opts=await g(p,'sante-fact-acte').locator('option').allInnerTexts();
 ok('pharmacie : le comptoir voit les produits',opts.some(x=>/Médicament/.test(x)),opts);
 await g(p,'sante-fact-acte').selectOption({label:/Médicament/.test(opts.join('|'))?opts.find(x=>/Médicament/.test(x)):''});await g(p,'sante-fact-qte').fill('2');await g(p,'sante-fact-ajouter').click();await g(p,'sante-fact-emettre').click();await p.waitForTimeout(700);
 const pr=(await cat(p,'products')).find(x=>x.code==='R1');
 ok('pharmacie : vente par le comptoir, stock 10 → 8',pr&&pr.stock===8,pr&&pr.stock);
 await tab(p,'lots');
 ok('comptoir : aucun formulaire de lot (lecture seule)',(await g(p,'sante-lot-ajouter').count())===0&&(await g(p,'sante-lot-supprimer').count())===0);
 await p.close();}
await b.close();console.log('fails='+fails);})();

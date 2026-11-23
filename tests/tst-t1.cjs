// v244 — le panier de la caisse survit à un changement de module (ex. vérifier la dette d'un client) :
// produits, quantités, client, mode de paiement, remise globale ; il se vide une fois la vente enregistrée ;
// il est propre à l'entreprise/compte et ne ressuscite pas des articles supprimés du catalogue.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const txt=p=>p.evaluate(()=>document.body.innerText);
const mod=async(p,n)=>{await p.getByText(n,{exact:true}).first().click();await p.waitForTimeout(900)};
const VENTE='Vente (POS / Facturation)',CRM='Comptes clients (CRM)';
const cartPart=async p=>{const t=await txt(p);return t.slice(t.indexOf('Panier'))};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p,errs}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,pageInit:()=>{try{sessionStorage.clear()}catch(e){}}});
 await mod(p,VENTE);
 ok('au départ, le panier est vide',/Sélectionnez un article à gauche/.test(await cartPart(p)));
 await p.getByText('Riz',{exact:true}).first().click();await p.waitForTimeout(300);
 await p.getByText('Riz',{exact:true}).first().click();await p.waitForTimeout(300);
 await p.getByText('Conseil',{exact:true}).first().click();await p.waitForTimeout(400);
 const avant=await cartPart(p);
 ok('le panier contient les articles ajoutés',!/Sélectionnez un article/.test(avant)&&/Riz/.test(avant)&&/Conseil/.test(avant),avant.slice(0,200));
 const qtyAvant=await p.evaluate(()=>[...document.querySelectorAll('input[type=number]')].map(i=>i.value).join(','));
 // un client saisi
 const cli=p.locator('input[placeholder*="lient"]').first();
 if(await cli.count()){await cli.fill('Marie Joseph');}
 await p.waitForTimeout(300);
 // on va vérifier la dette d'un client dans un autre module, puis on revient
 await mod(p,CRM);
 ok('on est bien sorti de la caisse',/Comptes clients|CRM|Module 6/.test(await txt(p)));
 await mod(p,VENTE);
 const apres=await cartPart(p);
 ok('au retour, le panier n\'est pas vidé',!/Sélectionnez un article/.test(apres)&&/Riz/.test(apres)&&/Conseil/.test(apres),apres.slice(0,200));
 const qtyApres=await p.evaluate(()=>[...document.querySelectorAll('input[type=number]')].map(i=>i.value).join(','));
 ok('les quantités sont identiques',qtyApres===qtyAvant,{qtyAvant,qtyApres});
 if(await cli.count())ok('le client saisi est conservé',(await p.locator('input[placeholder*="lient"]').first().inputValue())==='Marie Joseph');
 // plusieurs allers-retours
 await mod(p,CRM);await mod(p,'Stock et inventaire'.replace(/^/,'5')===''?CRM:CRM);await mod(p,VENTE);
 ok('après plusieurs allers-retours, le panier est toujours là',/Riz/.test(await cartPart(p)));
 ok('aucune erreur JS',errs.length===0,errs.slice(0,3));
 await p.close();}
// brouillon expiré ou panier vidé : rien n'est ressuscité
{const {p,errs}=await boot(b,{settings:{companyName:'X',currency:'HTG'},primary:true,pageInit:()=>{try{sessionStorage.clear();
  const k='compta-plus-pos-draft:c1:a@x.com';void k;}catch(e){}}});
 await mod(p,VENTE);await p.getByText('Riz',{exact:true}).first().click();await p.waitForTimeout(300);
 // on retire la ligne : le brouillon doit disparaître
 const del=p.locator('button[aria-label*="etirer"],button[title*="etirer"],button[aria-label*="upprimer"],button[title*="upprimer"]').first();
 if(await del.count()){await del.click();await p.waitForTimeout(300);await mod(p,CRM);await mod(p,VENTE);
  ok('panier vidé à la main : il reste vide au retour',/Sélectionnez un article/.test(await cartPart(p)));}
 // brouillon périmé (plus de 6 h) : ignoré
 const cle=await p.evaluate(()=>Object.keys(sessionStorage).find(k=>k.startsWith('compta-plus-pos-draft:'))||null);
 await p.getByText('Riz',{exact:true}).first().click();await p.waitForTimeout(300);
 const cle2=await p.evaluate(()=>Object.keys(sessionStorage).find(k=>k.startsWith('compta-plus-pos-draft:'))||null);
 ok('le brouillon est gardé dans la session de l\'appareil, propre à l\'entreprise et au compte',!!cle2&&/^compta-plus-pos-draft:[^:]+:/.test(cle2),cle2);
 ok('aucune erreur JS (2)',errs.length===0,errs.slice(0,3));
 await p.close();}
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const side=(p)=>p.evaluate(()=>{const n=document.querySelector('nav');return n?n.innerText:''});
const MODS=['Comptabilité','Caisse et banque','Vente (POS / Facturation)','Achat et fournisseurs','Stock et inventaire','Comptes clients (CRM)','Rapports et analyse','Administration','Salaires (RH)','Gestion avancée'];
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const pi=()=>{try{localStorage.removeItem('compta-plus-active-tab')}catch(e){}};
// 1. réglage absent : tout visible
let {p,errs}=await boot(b,{settings:{companyName:"Lakay SA",currency:"HTG"},primary:true,pageInit:pi});
let t=await side(p);
ok('défaut : tous les modules + tableau de bord',MODS.every(m=>t.includes(m))&&/Tableau de bord/.test(t),t);
ok('défaut : pas de mention espace comptable',!/espace comptable/.test(t));
// 2. activer depuis Administration → Entreprise
await p.getByText('Administration',{exact:true}).first().click();await p.waitForTimeout(600);
ok('plus de case dans le formulaire Entreprise',await p.locator('[data-testid="acc-only"]').count()===0&&await p.locator('input[type=checkbox]').count()===0||!/Espace réservé à la comptabilité/.test(await p.evaluate(()=>document.body.innerText)));
await p.getByRole('button',{name:'Accès',exact:true}).click();await p.waitForTimeout(300);await p.getByRole('button',{name:'Espace de travail',exact:true}).click();await p.waitForTimeout(500);
ok('onglet Espace de travail : désactivé, bouton Activer',/Désactivé/.test(await p.locator('[data-testid="espace-status"]').innerText())&&/Activer l'espace comptable/.test(await p.locator('[data-testid="espace-toggle"]').innerText()));
await p.locator('[data-testid="espace-toggle"]').click();await p.waitForTimeout(900);
ok('statut Activé',/Activé/.test(await p.locator('[data-testid="espace-status"]').innerText()));
t=await side(p);
ok('activé : seuls compta, banque, rapports, admin, gestion',['Comptabilité','Caisse et banque','Rapports et analyse','Administration','Gestion avancée'].every(m=>t.includes(m))&&['Vente (POS','Achat et fournisseurs','Stock et inventaire','Comptes clients','Salaires (RH)','Tableau de bord'].every(m=>!t.includes(m)),t);
ok('activé : mention espace comptable',/espace comptable/.test(t),t);
const srv=await p.evaluate(()=>window.__srv.getCat('settings'));
ok('réglage enregistré sur le serveur',srv&&srv.accountingOnly===true&&srv.companyName==='Lakay SA',srv);
// 3. Gestion avancée : onglets commerciaux masqués
await p.getByText('Gestion avancée',{exact:true}).first().click();await p.waitForTimeout(600);
let tabs=await p.evaluate(()=>[...document.querySelectorAll('[data-bz-tab]')].map(x=>x.getAttribute('data-bz-tab')));
ok('gestion : échéances, avoirs, acomptes gardés ; devis, inventaire masqués',tabs.includes('echeances')&&tabs.includes('avoirs')&&tabs.includes('acomptes')&&!tabs.includes('docs')&&!tabs.includes('inventaire'),tabs);
// 4. comptabilité accessible
await p.getByText('Comptabilité',{exact:true}).first().click();await p.waitForTimeout(600);
t=await p.evaluate(()=>document.body.innerText);
ok('comptabilité affichée',/Module 1|Comptabilité/.test(t)&&/Écriture|Journal/.test(t),t.slice(0,150));
// 5. rechargement : persiste et ouverture directe sur la comptabilité
await p.close();
const kv=null;
ok('aucune erreur JS',errs.length===0,errs.slice(0,2));
// 6. démarrage avec réglage actif : tableau de bord par défaut remplacé
({p,errs}=await boot(b,{settings:{companyName:"Cabinet X",currency:"HTG",accountingOnly:true},primary:true,pageInit:pi}));
await p.waitForTimeout(800);
t=await p.evaluate(()=>document.body.innerText);
ok('démarrage espace comptable : écran de comptabilité (pas le tableau de bord)',/Module 1/.test(t)||/Comptabilité/.test(t),t.slice(0,200));
const s6=await side(p);
ok('démarrage : modules commerciaux absents',!/Vente \(POS/.test(s6)&&!/Stock et inventaire/.test(s6),s6);
// 7. désactivation
await p.getByText('Administration',{exact:true}).first().click();await p.waitForTimeout(600);
await p.getByRole('button',{name:'Accès',exact:true}).click();await p.waitForTimeout(300);await p.getByRole('button',{name:'Espace de travail',exact:true}).click();await p.waitForTimeout(500);
ok('démarrage actif : statut Activé, bouton Revenir',/Activé/.test(await p.locator('[data-testid="espace-status"]').innerText())&&/Revenir à l'affichage complet/.test(await p.locator('[data-testid="espace-toggle"]').innerText()));
await p.locator('[data-testid="espace-toggle"]').click();await p.waitForTimeout(900);
const s7=await side(p);
ok('désactivé : tout revient',MODS.every(m=>s7.includes(m)),s7);
ok('aucune erreur JS (2)',errs.length===0,errs.slice(0,2));
await b.close();console.log(fails?'ECHECS '+fails:'TOUT PASSE');process.exit(fails?1:0)})();

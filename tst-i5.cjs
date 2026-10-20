// v233 : restaurer un fichier d'une autre entreprise ne doit pas imposer la double authentification.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const pageInit=()=>{try{localStorage.removeItem('compta-plus-active-tab')}catch(e){}};
const go=async(P)=>{await P.getByText('Administration',{exact:true}).first().click();await P.waitForTimeout(500);await P.getByRole('button',{name:'Données & Suivi'}).click();await P.waitForTimeout(300);await P.getByRole('button',{name:'Données',exact:true}).click();await P.waitForTimeout(500)};
const A=await boot(b,{settings:{companyName:"Source SA",currency:"HTG",requireAdminMfa:false},primary:true,pageInit});
await go(A.p);
await A.p.getByRole('button',{name:'Copier le texte à la place'}).click();await A.p.waitForTimeout(500);
let txt=await A.p.locator('textarea').first().inputValue();
ok('export contient requireAdminMfa',/"requireAdminMfa":false/.test(txt));
{const bk=(str)=>{let h1=0xdeadbeef,h2=0x41c6ce57;for(let i=0;i<str.length;i++){const ch=str.charCodeAt(i);h1=Math.imul(h1^ch,2654435761);h2=Math.imul(h2^ch,1597334677);}h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);return (4294967296*(2097151&h2)+(h1>>>0)).toString(16)+'-'+str.length.toString(16)};
const o=JSON.parse(txt);o.settings.requireAdminMfa=true;const rest={};Object.keys(o).forEach(k=>{if(k!=='_meta')rest[k]=o[k]});o._meta.checksum=bk(JSON.stringify(rest));txt=JSON.stringify(o);}
const B=await boot(b,{settings:{companyName:"Cible",currency:"HTG"},primary:true,pageInit});
await go(B.p);
await B.p.getByRole('button',{name:'Coller le texte à la place'}).click();
await B.p.locator('textarea').last().fill(txt);
await B.p.getByRole('button',{name:'Importer ce texte'}).click();await B.p.waitForTimeout(1200);
await B.p.locator('[data-testid="restore-ack"]').check();await B.p.locator('[data-testid="restore-confirm"]').click();await B.p.waitForTimeout(1500);
ok('restauration appliquée',/Source SA/.test(await B.p.evaluate(()=>document.body.innerText)));
ok('aucun écran de double authentification forcé',(await B.p.locator('[data-testid="mfa-forced-signout"]').count())===0);
ok('aucune erreur JS',A.errs.length+B.errs.length===0,[...A.errs,...B.errs].slice(0,3));
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

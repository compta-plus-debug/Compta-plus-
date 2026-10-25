// v271 — sélecteur d'espaces sur 2 lignes, Commerce selon l'activité, onglet Statistiques (Éducation, Import-export, Santé).
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const base={companyName:'Stats Test',currency:'HTG'};
const mk=(role,sect)=>new Function("(function(){const S=window.__srv;S.tables.companies[0].plan_tier='assisted';S.tables.companies[0].sectors="+JSON.stringify(sect)+";S.tables.companies[0].sectors_locked=true;S.tables.company_members[0].role="+JSON.stringify(role)+";try{sessionStorage.clear();localStorage.removeItem('compta-plus-espace')}catch(e){}})();");
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const ids=(sect)=>sect;
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p}=await boot(b,{settings:base,primary:true,pageInit:mk('Administrateur',['ecoles','import_export','sante'])});await p.waitForTimeout(1200);
 const box=async(t)=>g(p,t).boundingBox();
 const e=await box('espace-ecole'),i=await box('espace-impex'),s=await box('espace-sante'),c=await box('espace-commerce');
 ok('4 espaces : Éducation, Import-export, Santé, Commerce',!!e&&!!i&&!!s&&!!c);
 ok('sélecteur sur 2 lignes',e&&i&&s&&c&&Math.abs(e.y-i.y)<3&&Math.abs(s.y-c.y)<3&&s.y>e.y+15);
 const side=await p.locator('[data-testid="espace-selecteur"]').boundingBox();
 ok('boutons dans la barre latérale et espacés',[e,i,s,c].every(x=>x.x>=side.x-1&&x.x+x.width<=side.x+side.width+1)&&(i.x-(e.x+e.width))>=4);
 await p.close();}
{const {p}=await boot(b,{settings:base,primary:true,pageInit:mk('Administrateur',['ecoles','sante'])});await p.waitForTimeout(1200);
 ok('Éducation + Santé cabinet : pas d\'espace Commerce',(await g(p,'espace-commerce').count())===0&&(await g(p,'espace-ecole').count())===1&&(await g(p,'espace-sante').count())===1);
 await g(p,'espace-sante').click();await p.waitForTimeout(500);
 const txt=await p.locator('nav, aside').first().innerText().catch(()=>p.locator('body').innerText());
 ok('espace Santé cabinet : menu sans Vente ni Stock',!/Vente \(POS/.test(txt)&&!/Stock et inventaire/.test(txt),txt.slice(0,300));
 await p.locator('[data-testid="sante-tab-stats"]').click();await p.waitForTimeout(400);
 ok('Santé : onglet Statistiques affiché avec indicateurs',(await g(p,'stats-bloc').count())===1&&(await g(p,'sante-stat-facture').count())===1&&(await g(p,'stats-vide').count())===1);
 await g(p,'espace-ecole').click();await p.waitForTimeout(600);
 await p.locator('[data-testid="ecole-tab-stats"]').click();await p.waitForTimeout(400);
 ok('Éducation : onglet Statistiques affiché',(await g(p,'stats-bloc').count())===1&&(await g(p,'ecole-stat-inscrits').count())===1);
 await p.close();}
{const {p}=await boot(b,{settings:base,primary:true,cats:{sante:[{type:'etab',id:'etab',kind:'pharmacie'}]},pageInit:mk('Administrateur',['sante'])});await p.waitForTimeout(1200);
 ok('Santé pharmacie : espace Commerce disponible',(await g(p,'espace-commerce').count())===1);
 await g(p,'espace-sante').click();await p.waitForTimeout(500);
 ok('espace Santé pharmacie : le menu contient Stock',/Stock et inventaire/.test(await p.locator('body').innerText()));
 await p.close();}
{const {p}=await boot(b,{settings:base,primary:true,pageInit:mk('Administrateur',['import_export'])});await p.waitForTimeout(1200);
 ok('Import-export : Commerce disponible',(await g(p,'espace-commerce').count())===1);
 await g(p,'ie-tab-stats').click();await p.waitForTimeout(400);
 ok('Import-export : onglet Statistiques affiché',(await g(p,'stats-bloc').count())===1&&(await g(p,'ie-stat-imports').count())===1);
 await p.close();}
{const {p}=await boot(b,{settings:base,primary:true,pageInit:mk('Administrateur',[])});await p.waitForTimeout(1200);
 ok('entreprise sans secteur : pas de sélecteur, Commerce habituel',(await g(p,'espace-selecteur').count())===0);
 await p.close();}
await b.close();console.log('fails='+fails);})();

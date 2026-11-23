// Annonces de la plateforme (v230) : affichées à chaque ouverture/rechargement ; « J'ai lu » ne masque que pour la session.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const future=new Date(Date.now()+864e5*5).toISOString(),past=new Date(Date.now()-864e5).toISOString();
const A=(over)=>Object.assign({id:'a1',title:'Nouveauté sécurité',body:'La double authentification est disponible.',level:'important',active:true,ends_at:future,created_at:'2026-10-19T10:00:00Z'},over);
const init=(rows,reads,missing)=>new Function('const S=window.__srv;S.tables.announcements='+JSON.stringify(rows)+';S.tables.announcement_reads='+JSON.stringify(reads)+';'+(missing?'S.tableMissing={announcements:true,announcement_reads:true};':'')+'try{localStorage.removeItem("compta-plus-active-tab")}catch(e){}');
const open=(b,rows,reads,missing)=>boot(b,{settings:{companyName:"Lakay SA",currency:"HTG"},primary:true,pageInit:init(rows,reads,missing)});
const txt=(p)=>p.evaluate(()=>document.body.innerText);
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
// A) une annonce visible, une retirée, une expirée : seule la visible apparaît ; « J'ai lu » l'enregistre
{const {p,errs}=await open(b,[A(),A({id:'a2',title:'Retirée',active:false}),A({id:'a3',title:'Expirée',ends_at:past})],[]);
 const t=await txt(p);
 ok('A : l\'annonce visible est affichée',t.includes('Nouveauté sécurité')&&t.includes('double authentification est disponible')&&t.includes('Important'),t.slice(0,200));
 ok('A : retirée et expirée absentes',!t.includes('Retirée')&&!t.includes('Expirée'));
 await p.locator('[data-testid="announcement-read"]').first().click();await p.waitForTimeout(500);
 ok('A : disparaît après « J\'ai lu »',(await p.locator('[data-testid="announcement"]').count())===0);
 const reads=await p.evaluate(()=>window.__srv.tables.announcement_reads);
 ok('A : rien n\'est mémorisé côté serveur (elle reviendra au prochain rechargement)',(await p.evaluate(()=>window.__srv.tables.announcement_reads.length))===0);
 ok('A : aucune erreur JS',errs.length===0,errs.slice(0,3));await p.close();}
// B) déjà « lue » dans l'ancien système : s'affiche quand même (elle revient à chaque ouverture)
{const {p,errs}=await open(b,[A()],[{announcement_id:'a1',user_id:'u1'}]);
 ok('B : réaffichée à l\'ouverture',(await p.locator('[data-testid="announcement"]').count())===1);
 ok('B : aucune erreur JS',errs.length===0,errs.slice(0,3));await p.close();}
// C) nouvelle ouverture après « J'ai lu » : l'annonce revient
{const {p}=await open(b,[A()],[]);
 await p.locator('[data-testid="announcement-read"]').first().click();await p.waitForTimeout(300);
 ok('C : masquée après « J\'ai lu »',(await p.locator('[data-testid="announcement"]').count())===0);await p.close();
 const {p:p2}=await open(b,[A()],[]);
 ok('C : revient à la nouvelle ouverture',(await p2.locator('[data-testid="announcement"]').count())===1);await p2.close();}
// D) table absente (SQL pas encore exécuté) : rien, aucune erreur, application utilisable
{const {p,errs}=await open(b,[],[],true);
 const t=await txt(p);
 ok('D : table absente, aucune annonce',(await p.locator('[data-testid="announcements"]').count())===0);
 ok('D : application affichée normalement',t.includes('Lakay SA')||t.length>200,t.slice(0,150));
 ok('D : aucune erreur JS',errs.length===0,errs.slice(0,3));await p.close();}
// E) plusieurs annonces : 3 au plus, la plus récente d'abord ; en masquer une fait venir la suivante
{const rows=[1,2,3,4].map(i=>A({id:'n'+i,title:'Annonce '+i,created_at:'2026-10-1'+i+'T10:00:00Z'}));
 const {p}=await open(b,rows,[]);
 let titles=await p.locator('[data-testid="announcement"]').allInnerTexts();
 ok('E : trois annonces au plus, la plus récente en premier',titles.length===3&&/Annonce 4/.test(titles[0])&&!titles.join().includes('Annonce 1'),titles);
 await p.locator('[data-testid="announcement-read"]').first().click();await p.waitForTimeout(300);
 titles=await p.locator('[data-testid="announcement"]').allInnerTexts();
 ok('E : la suivante apparaît',titles.length===3&&titles.join().includes('Annonce 1')&&!titles.join().includes('Annonce 4'),titles);await p.close();}
await b.close();console.log('fails='+fails);process.exit(fails?1:0)})();

// Chantier 9 — page réelle, politique de sécurité réellement appliquée (sans 'unsafe-eval', sans script externe) :
// la page s'ouvre, aucune règle de sécurité n'est violée, les styles sont appliqués, et les bibliothèques
// (PDF, Excel, QR, Supabase, React) fonctionnent sans exécution de code généré à la volée.
const {chromium}=require('playwright');const fs=require('fs'),path=require('path'),http=require('http');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const site=process.env.SITE||[path.resolve(__dirname,'..','docs'),path.resolve(__dirname,'docs'),path.resolve(process.cwd(),'docs')].find(d=>fs.existsSync(path.join(d,'index.html')));
if(!site||!fs.existsSync(path.join(site,'vendor','jspdf.umd.min.js'))){console.log('SKIP site avec bibliothèques introuvable ('+site+') : test ignoré');console.log('fails=0');process.exit(0)}
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.json':'application/json','.png':'image/png'};
const SONDE="try{new Function('return 1')();window.__evalBlocked=false}catch(e){window.__evalBlocked=true}try{eval('1');window.__evalBlocked2=false}catch(e){window.__evalBlocked2=true}window.__sondeFaite=true;";
const srv=http.createServer((q,r)=>{const u=decodeURIComponent(new URL(q.url,'http://x').pathname);if(u==='/__sonde.js'){r.writeHead(200,{'content-type':'application/javascript'});return r.end(SONDE)}const f=path.join(site,u==='/'?'index.html':u);
 if(!f.startsWith(site)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end()}
 r.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f))});
(async()=>{await new Promise(r=>srv.listen(0,'127.0.0.1',r));const port=srv.address().port;
const html=fs.readFileSync(path.join(site,'index.html'),'utf8');
const csp=(html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)||[])[1]||'';
ok('la politique ne contient plus unsafe-eval',!/unsafe-eval/.test(csp),csp);
ok('plus aucun script ni feuille de style externe dans la page',!/(?:src|href)="https?:\/\/[^"]*(tailwind|unpkg|jsdelivr|cdnjs|googleapis)/.test(html));
ok('la feuille de styles est hébergée avec le site et protégée par empreinte',/<link rel="stylesheet" href="tailwind\.css\?v=[^"]+" integrity="sha384-[A-Za-z0-9+\/=]{64}"/.test(html));
const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const ctx=await b.newContext({viewport:{width:1100,height:800}});
const p=await ctx.newPage();const viol=[],cons=[],errs=[],failedReq=[];
await p.addInitScript(()=>{window.__viol=[];document.addEventListener('securitypolicyviolation',e=>window.__viol.push(e.violatedDirective+' '+e.blockedURI))});
p.on('console',m=>{if(m.type()==='error')cons.push(m.text())});p.on('pageerror',e=>errs.push(e.message));
p.on('requestfailed',r=>failedReq.push(r.url()));
// le réseau extérieur (Supabase…) est coupé : seule la page locale compte ici
await p.route(u=>!u.href.startsWith('http://127.0.0.1:'+port),r=>r.abort());
await p.goto('http://127.0.0.1:'+port+'/');await p.waitForTimeout(3500);
const v=await p.evaluate(()=>window.__viol);
ok('aucune violation de la politique de sécurité au chargement',v.length===0,v);
ok('aucun message de sécurité dans la console',!cons.some(t=>/Content Security Policy|Refused to/i.test(t)),cons.filter(t=>/Content Security|Refused/i.test(t)).slice(0,3));
// L'évaluation par le débogueur ignore la politique : la sonde est donc un petit script de la page elle-même.
await p.evaluate(()=>new Promise(res=>{const sc=document.createElement('script');sc.src='/__sonde.js';sc.onload=res;sc.onerror=res;document.head.appendChild(sc)}));
const S=await p.evaluate(()=>{const r={fait:window.__sondeFaite,fn:window.__evalBlocked,ev:window.__evalBlocked2};window.__viol.length=0;return r});
ok('la politique est bien appliquée : new Function et eval sont refusés',S.fait===true&&S.fn===true&&S.ev===true,S);
ok('la feuille de styles est chargée',await p.evaluate(()=>[...document.styleSheets].some(s=>/tailwind\.css/.test(s.href||''))),failedReq);
ok('les styles s\'appliquent (classe flex, rounded, text-sm)',await p.evaluate(()=>{const d=document.createElement('div');d.className='flex rounded-lg text-sm hidden md:flex';document.body.appendChild(d);d.classList.remove('hidden');const c=getComputedStyle(d);const r=c.display==='flex'&&c.borderTopLeftRadius==='8px'&&c.fontSize==='14px';d.remove();return r}));
ok('l\'application a démarré (écran de connexion ou boot)',(await p.evaluate(()=>document.body.innerText)).length>20);
ok('aucune erreur JS',errs.length===0,errs.slice(0,3));
// bibliothèques sous la même politique
const L=await p.evaluate(async()=>{const r={};
 try{const {jsPDF}=window.jspdf;const d=new jsPDF();d.text('Test',10,10);if(d.autoTable)d.autoTable({head:[['A','B']],body:[['1','2']]});else if(window.jspdf&&window.jspdf.autoTable)0;r.pdf=d.output('arraybuffer').byteLength>1000}catch(e){r.pdf='ERR '+e.message}
 try{r.qr=typeof window.Html5Qrcode==='function'}catch(e){r.qr='ERR '+e.message}
 try{const c=window.supabase.createClient('https://x.supabase.co','k');r.sb=typeof c.from==='function'}catch(e){r.sb='ERR '+e.message}
 try{await new Promise((ok,ko)=>{const s=document.createElement('script');s.src='vendor/xlsx.full.min.js';s.onload=ok;s.onerror=()=>ko(new Error('load'));document.head.appendChild(s)});
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['a',1],['b',2]]),'S');const out=XLSX.write(wb,{type:'array',bookType:'xlsx'});const rd=XLSX.read(out,{type:'array'});r.xlsx=out.byteLength>500&&rd.SheetNames[0]==='S'}catch(e){r.xlsx='ERR '+e.message}
 try{r.react=typeof React.createElement==='function'&&typeof ReactDOM.createRoot==='function'}catch(e){r.react='ERR '+e.message}
 r.viol=window.__viol.slice();return r});
ok('PDF (jsPDF + tableau) sans code généré',L.pdf===true,L);ok('lecteur de QR disponible',L.qr===true,L);ok('client Supabase créé',L.sb===true,L);
ok('Excel (SheetJS) écrit et relit un classeur',L.xlsx===true,L);ok('React disponible',L.react===true,L);
ok('aucune violation pendant l\'usage des bibliothèques',L.viol.length===0,L.viol);
await b.close();srv.close();console.log('fails='+fails);process.exit(fails?1:0)})();

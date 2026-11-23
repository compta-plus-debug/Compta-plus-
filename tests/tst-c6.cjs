// v239 (chantier 6) : site réel avec bibliothèques et polices hébergées, politique de sécurité stricte.
// Ce test charge docs/index.html tel que publié (vraies bibliothèques) dans un navigateur ; il ne peut
// tourner que là où les bibliothèques ont été copiées (construction automatique). Sinon : ignoré.
const fs=require('fs'),path=require('path'),http=require('http');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const docs0=[__dirname+'/../docs',__dirname+'/docs'].find(d=>fs.existsSync(d+'/index.html'));const docs=docs0&&path.resolve(docs0);
if(!docs||!fs.existsSync(docs+'/vendor/react.production.min.js')){console.log('IGNORÉ : bibliothèques hébergées absentes (étape de construction non exécutée ici).');console.log('fails=0');process.exit(0);}
const {chromium}=require('playwright');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.woff2':'font/woff2','.png':'image/png','.css':'text/css'};
const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';const f=path.join(docs,u);if(!f.startsWith(docs)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.statusCode=404;return r.end('non');}r.setHeader('Content-Type',types[path.extname(f)]||'application/octet-stream');r.end(fs.readFileSync(f));});
(async()=>{try{await new Promise(res=>srv.listen(0,'127.0.0.1',res));const port=srv.address().port;
const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const p=await b.newPage();
const hosts=new Set(),bad=[];
p.on('request',q=>{try{hosts.add(new URL(q.url()).host)}catch(e){}});
p.on('response',r=>{const u=r.url();if(u.startsWith('http://127.0.0.1:'+port+'/')&&/\/(vendor|fonts)\//.test(u)&&r.status()>=400)bad.push(r.status()+' '+u)});
await p.addInitScript(()=>{window.__v=[];document.addEventListener('securitypolicyviolation',e=>window.__v.push(e.violatedDirective+' '+e.blockedURI))});
await p.goto('http://127.0.0.1:'+port+'/index.html');
let booted=false;for(let i=0;i<60&&!booted;i++){await p.waitForTimeout(500);booted=await p.evaluate(()=>!document.getElementById('boot-status')&&document.getElementById('root')&&document.getElementById('root').innerText.trim().length>0&&!/Connexion internet difficile/.test(document.getElementById('root').innerText));}
ok('l\'application démarre avec les bibliothèques hébergées',booted,await p.evaluate(()=>((document.getElementById('root')||{innerText:''}).innerText||'').slice(0,120)));
const g=await p.evaluate(()=>({react:!!window.React,dom:!!window.ReactDOM,sb:!!(window.supabase&&window.supabase.createClient),pdf:!!(window.jspdf&&window.jspdf.jsPDF),qr:!!window.Html5Qrcode}));
ok('React, ReactDOM, Supabase, jsPDF, scan : présents',g.react&&g.dom&&g.sb&&g.pdf&&g.qr,g);
const x=await p.evaluate(()=>new Promise(res=>{const s=document.createElement('script');s.src='vendor/xlsx.full.min.js';s.onload=()=>res(!!window.XLSX);s.onerror=()=>res(false);document.head.appendChild(s)}));
ok('lecteur Excel hébergé chargeable',x===true);
const ext=[...hosts].filter(h=>/unpkg\.com|jsdelivr|cdnjs|googleapis|gstatic/.test(h));
ok('aucun appel à unpkg, jsDelivr, cdnjs ni Google Fonts',ext.length===0,ext);
ok('aucun fichier vendor/ ou fonts/ introuvable',bad.length===0,bad);
const v=(await p.evaluate(()=>window.__v)).filter(s=>!/tailwind/i.test(s));
ok('aucune violation de la politique de sécurité',v.length===0,v);
const injected=await p.evaluate(()=>{const s=document.createElement('script');s.textContent='window.__pwn=1';document.head.appendChild(s);return !!window.__pwn});
ok('un script injecté est refusé par le navigateur',injected===false);
const fonts=await p.evaluate(async()=>{try{await document.fonts.ready;return [...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family.replace(/"/g,'')+' '+f.weight)}catch(e){return []}});
ok('polices hébergées chargées (au moins Inter)',fonts.some(f=>/Inter/.test(f)),fonts);
await b.close();}catch(e){console.log('FAIL erreur du test : '+String(e&&e.message).slice(0,300));fails++}srv.close();console.log('fails='+fails);process.exit(fails?1:0)})();

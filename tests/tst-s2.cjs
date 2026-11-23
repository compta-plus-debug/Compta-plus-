// Chantier 9 — aucune classe de style ne doit manquer dans tailwind.css : on parcourt les écrans de l'application
// (menu, onglets, boutons), on relève toutes les classes réellement posées sur la page, puis on vérifie que chaque
// classe que Tailwind sait générer figure bien dans la feuille publiée.
// Nécessite l'exécutable Tailwind (variable TAILWIND_BIN) ; sinon le test est ignoré.
const {chromium}=require('playwright');const fs=require('fs'),path=require('path'),os=require('os');
const {execFileSync}=require('child_process');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const bin=process.env.TAILWIND_BIN;
const site=process.env.SITE||[path.resolve(__dirname,'..','docs'),path.resolve(__dirname,'docs'),path.resolve(process.cwd(),'docs')].find(d=>fs.existsSync(path.join(d,'tailwind.css')));
if(!bin||!fs.existsSync(bin)||!site||!fs.existsSync(path.join(site,'tailwind.css'))){console.log('SKIP générateur Tailwind ou tailwind.css introuvable : test ignoré');console.log('fails=0');process.exit(0)}
const css=fs.readFileSync(path.join(site,'tailwind.css'),'utf8');
const sel=t=>{const s=new Set();for(const m of t.matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g))s.add(m[1].replace(/\\(.)/g,'$1'));return s};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const seen=new Set();
for(const [vw,adm] of [[1100,false],[390,false],[1100,true]]){
 const ctx=await b.newContext({viewport:{width:vw,height:800}});
 const corps="try{localStorage.removeItem('compta-plus-active-tab')}catch(e){}\n  window.__seen=new Set();const grab=r=>{r.querySelectorAll&&r.querySelectorAll('[class]').forEach(e=>{(e.getAttribute('class')||'').split(/\\s+/).forEach(c=>c&&window.__seen.add(c))});if(r.getAttribute&&r.getAttribute('class'))r.getAttribute('class').split(/\\s+/).forEach(c=>c&&window.__seen.add(c))};\n  new MutationObserver(ms=>ms.forEach(m=>{if(m.type==='attributes')grab(m.target);m.addedNodes.forEach(n=>n.nodeType===1&&grab(n))})).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});\n  window.__scan=()=>grab(document.documentElement);\n";
 const {p}=await boot(b,{ctx,settings:{companyName:"Lakay SA",currency:"HTG"},primary:true,pageInit:new Function(corps+(adm?";window.__srv.tables.platform_admins=[{email:'a@x.com'}];":""))});
 let clicks=0;const done=new Set();
 for(let pass=0;pass<8&&clicks<600;pass++){
  const n=await p.evaluate(async(done)=>{const skip=/supprim|déconnex|quitter|vider|réinitial|reset|effacer|restaur|annuler tout|se déconnecter/i;let c=0;
   const els=[...document.querySelectorAll('button,[role=tab],summary,[data-testid]')].filter(e=>e.offsetParent!==null&&(e.tagName==='BUTTON'||e.getAttribute('role')==='tab'||e.tagName==='SUMMARY'||/tab|nav|group|menu|panel-open/.test(e.getAttribute('data-testid')||'')));
   for(const e of els){const t=(e.innerText||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim().slice(0,40);const key=e.tagName+'|'+(e.getAttribute('data-testid')||'')+'|'+t;
    if(done.includes(key)||skip.test(t)||e.disabled||e.closest('[data-testid=chunk-error]'))continue;done.push(key);
    try{e.click();c++}catch(x){}await new Promise(r=>setTimeout(r,260));window.__scan();if(c>=150)break}
   return {c,done}},[...done]);
  console.log('pass',pass,n.c,n.done.length);n.done.forEach(k=>done.add(k));clicks+=n.c;if(n.c===0)break;
 }
 await p.evaluate(()=>window.__scan());
 (await p.evaluate(()=>[...window.__seen])).forEach(c=>seen.add(c));
 console.log(vw+'px : '+clicks+' éléments parcourus, '+seen.size+' classes relevées au total');
 await ctx.close();
}
await b.close();
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'s2-'));
fs.writeFileSync(path.join(tmp,'c.html'),[...seen].map(c=>'<i class="'+c.replace(/"/g,'')+'"></i>').join('\n'));
fs.writeFileSync(path.join(tmp,'cfg.cjs'),'module.exports={content:['+JSON.stringify(path.join(tmp,'c.html'))+'],theme:{extend:{}},plugins:[]};');
fs.writeFileSync(path.join(tmp,'in.css'),'@tailwind utilities;\n');
execFileSync(bin,['-c',path.join(tmp,'cfg.cjs'),'-i',path.join(tmp,'in.css'),'-o',path.join(tmp,'o.css'),'--minify'],{stdio:'pipe'});
const ref=sel(fs.readFileSync(path.join(tmp,'o.css'),'utf8')),have=sel(css);
const missing=[...ref].filter(c=>seen.has(c)&&!have.has(c));
ok('au moins 150 classes de style relevées sur les écrans parcourus (le parcours a bien eu lieu)',ref.size>=150,ref.size);
ok('aucune classe utilisée à l\'écran ne manque dans tailwind.css',missing.length===0,missing.slice(0,40));
console.log('classes Tailwind observées : '+ref.size+' ; absentes de la feuille : '+missing.length);
console.log('fails='+fails);process.exit(fails?1:0)})();

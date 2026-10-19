// Politique de sécurité de la page (v229) : vérifie que chaque source externe réellement utilisée par la page et par l'application est autorisée.
const fs=require('fs'),path=require('path');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const racine=[path.resolve(__dirname,'..'),__dirname,process.cwd(),path.resolve(process.cwd(),'..')].find(d=>fs.existsSync(path.join(d,'docs/index.html')))||path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(racine,'docs/index.html'),'utf8');
const js=fs.existsSync(path.join(racine,'docs/app.min.js'))?fs.readFileSync(path.join(racine,'docs/app.min.js'),'utf8'):'';
const m=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
ok('la politique existe',!!m);
const dir={};(m?m[1]:'').split(';').map(x=>x.trim()).filter(Boolean).forEach(x=>{const [k,...v]=x.split(/\s+/);dir[k]=v});
const permet=(d,url)=>{const u=new URL(url);const liste=dir[d]||dir['default-src']||[];return liste.some(s=>{if(s==="'self'")return false;if(s.startsWith('*.',0))return false;
 if(/^[a-z]+:$/.test(s))return u.protocol===s;
 const mm=s.match(/^(https?|wss?):\/\/(\*\.)?([^/]+)$/);if(!mm)return false;if(u.protocol!==mm[1]+':')return false;return mm[2]?u.hostname.endsWith('.'+mm[3]):u.hostname===mm[3]})};
// scripts externes de la page
const scripts=[...html.matchAll(/<script[^>]+src="(https:[^"]+)"/g)].map(x=>x[1]);
ok('scripts externes trouvés',scripts.length>=6,scripts.length);
scripts.forEach(u=>ok('script autorisé : '+new URL(u).host,permet('script-src',u),u));
[...html.matchAll(/<link[^>]+href="(https:[^"]+)"/g)].forEach(x=>ok('feuille autorisée : '+new URL(x[1]).host,permet('style-src',x[1])||permet('font-src',x[1]),x[1]));
// réseau utilisé par l'application
const hotes=[...new Set([...js.matchAll(/https?:\/\/[a-zA-Z0-9.-]+/g)].map(x=>x[0]))];
const connus=['https://wa.me','https://comptaplus.app','https://fonts.googleapis.com','https://cdnjs.cloudflare.com'];
hotes.forEach(h=>{if(/supabase\.co$/.test(h)||h==='https://open.er-api.com')ok('réseau autorisé : '+h,permet('connect-src',h+'/x'),h);
 else ok('adresse connue (lien, pas de requête automatique) : '+h,connus.includes(h),h)});
ok('aucun objet incorporé',(dir['object-src']||[])[0]==="'none'");
ok('base et formulaires verrouillés',(dir['base-uri']||[])[0]==="'self'"&&(dir['form-action']||[])[0]==="'self'");
console.log('fails='+fails);process.exit(fails?1:0);

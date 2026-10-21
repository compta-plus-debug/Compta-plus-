// v241 : contrôle statique du chargement à la demande (chantier 8).
// - chaque fichier de chunks/ ne référence que ce que l'application de départ lui fournit (pas de variable libre inconnue) ;
// - l'application de départ n'utilise aucun nom resté dans un chunk ;
// - versions concordantes, aucune adresse de base de données dans les chunks, poids de l'application de départ borné.
const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const req=(n)=>{try{return require(n)}catch(e){return require('/opt/node-tools/node_modules/'+n)}};
const acorn=req('acorn'),escope=req('eslint-scope');
const racine=[path.join(__dirname,'..'),__dirname].find(d=>fs.existsSync(path.join(d,'docs'))||fs.existsSync(path.join(d,'build'))||fs.existsSync(path.join(d,'build.mjs')))||__dirname;
const appJs=process.env.APP_JS||path.join(racine,'docs','app.min.js');
const dir=path.dirname(appJs);
const script=[path.join(racine,'build','build.mjs'),path.join(racine,'build.mjs')].find(f=>fs.existsSync(f));
const libres=(code)=>{const ast=acorn.parse(code,{ecmaVersion:2020,sourceType:'script',ranges:true});const sm=escope.analyze(ast,{ecmaVersion:2020,sourceType:'script'});const g=new Set();for(const r of sm.globalScope.through)g.add(r.identifier.name);return g;};
(async()=>{
  const core=fs.readFileSync(appJs,'utf8');
  const chunks=fs.existsSync(path.join(dir,'chunks'))?fs.readdirSync(path.join(dir,'chunks')).filter(f=>f.endsWith('.js')).sort():[];
  ok('des fichiers de chargement à la demande existent',chunks.length>=8,chunks);
  // référence : mêmes noms libres dans la version « tout en un » (étape CHUNKS=off)
  let base=null;
  if(script){
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cp-mono-'));
    try{cp.execFileSync(process.execPath,[script,'test'],{env:{...process.env,CHUNKS:'off',SORTIE:tmp,VENDOR:'skip'},stdio:'pipe'});base=libres(fs.readFileSync(path.join(tmp,'app.min.js'),'utf8'));}catch(e){ok('version « tout en un » compilée pour comparaison',false,String(e.stderr||e.message).slice(0,300));}
  }
  if(base){
    const g=libres(core);const inconnus=[...g].filter(n=>!base.has(n));
    ok('application de départ : aucune variable inconnue',inconnus.length===0,inconnus);
    for(const f of chunks){
      const g2=libres(fs.readFileSync(path.join(dir,'chunks',f),'utf8'));
      const inc=[...g2].filter(n=>!base.has(n));
      ok(f+' : aucune variable inconnue',inc.length===0,inc);
    }
  }
  const v=(core.match(/APP_VERSION="(20\d{6}-\d{3})"/)||[])[1];
  ok('version lue dans l\'application de départ',!!v,v);
  for(const f of chunks){
    const t=fs.readFileSync(path.join(dir,'chunks',f),'utf8');
    const id=f.replace(/\.js$/,'');
    ok(f+' : s\'enregistre sous son nom et à la bonne version',t.startsWith('(window.__cpc=window.__cpc||{}).'+id+'={v:"'+v+'"')||t.startsWith('(window.__cpc=window.__cpc||{})["'+id+'"]={v:"'+v+'"'),t.slice(0,90));
    ok(f+' : aucune adresse de base de données',!/cnmmxpwlgovzbcfqaxqm|lfpqetfasjqnucklvwah/.test(t));
  }
  ok('application de départ allégée (moins de 1 000 Ko)',Buffer.byteLength(core)<1000*1024,Math.round(Buffer.byteLength(core)/1024));
  ok('liste des fichiers connue de l\'application de départ',/__CP_IDS|\["admin","superadmin"/.test(core)||core.includes('"admin"'));
  console.log('fails='+fails);process.exit(fails?1:0);
})();

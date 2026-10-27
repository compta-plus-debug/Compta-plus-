// Compilation de Compta+ : assemble les parties de src/parties/ (dans l'ordre des numéros),
// produit docs/app.min.js et met à jour le numéro de version dans docs/index.html.
//
// Usage :  node build/build.mjs [prod|test]
//   - sans argument, la cible est TARGET (variable d'environnement), sinon « prod ».
//   - SORTIE=dossier  pour écrire ailleurs que dans docs/ (utile pour comparer / tester).
//   - Le résultat est identique, octet pour octet, à l'ancien processus manuel.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { controle } from "./controle.mjs";
import { verifierDependances, lireEntete, nomsDeclares, sansCommentaires } from "./dependances.mjs";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");

// Le script peut se trouver dans build/ (organisation prévue) ou directement à la racine du dépôt
// (si les dossiers ont été aplatis lors de l'envoi sur GitHub) : on s'adapte aux deux cas.
const dossierScript = path.dirname(new URL(import.meta.url).pathname);
const racine = fs.existsSync(path.join(dossierScript, "docs")) ? dossierScript : path.resolve(dossierScript, "..");
const cible = process.argv[2] || process.env.TARGET || "prod";
if (cible !== "prod" && cible !== "test") { console.error("Cible inconnue : " + cible + " (prod ou test)"); process.exit(2); }
const sortie = path.resolve(process.env.SORTIE || path.join(racine, "docs"));
const estPartie = (n) => /^\d\d-.+\.jsx$/.test(n);
const dossierParties = [path.join(racine, "src", "parties"), path.join(racine, "src"), racine]
  .find((d) => fs.existsSync(d) && fs.readdirSync(d).some(estPartie));
if (!dossierParties) { console.error("Aucune partie (fichiers 00-….jsx) trouvée."); process.exit(1); }
console.log("Parties lues dans : " + path.relative(racine, dossierParties) + (dossierParties === racine ? "(racine)" : ""));

// 1) Assemblage des parties
const noms = fs.readdirSync(dossierParties).filter(estPartie).sort();
const lues = noms.map((n) => ({ nom: n, texte: fs.readFileSync(path.join(dossierParties, n), "utf8") }));
const dep = verifierDependances(lues);
console.log("Frontières entre modules vérifiées (" + lues.filter((x) => x.texte.startsWith("// ═══ MODULE")).length + " modules).");
if (dep.problemes.length) { console.error("BLOQUÉ — frontières entre modules :"); dep.problemes.forEach((x) => console.error("  ✗ " + x)); process.exit(1); }
let source = noms.map((n) => fs.readFileSync(path.join(dossierParties, n), "utf8")).join("");

// 2) Cible TEST : même substitution que l'ancienne publication (première occurrence par ligne)
const appliquerCible = (texte) => {
  if (cible !== "test") return texte;
  const subs = [
    ["cnmmxpwlgovzbcfqaxqm", "lfpqetfasjqnucklvwah"],
    ["sb_publishable_Ba1KJd2YY-eLaCy1FRECIA_C1DoyAjL", "sb_publishable_dQ2C3wy2LikR2IY2BgSrlQ_Go9Gj9Da"],
  ];
  return texte.split("\n").map((l) => subs.reduce((acc, [a, b]) => acc.replace(a, b), l)).join("\n");
};
source = appliquerCible(source);

// 2b) Chargement à la demande (chantier 8) : certains écrans lourds sont compilés à part (dossier chunks/).
// Chaque fichier est une fonction qui reçoit de l'application de départ ce qu'il emprunte (@depends de ses blocs)
// et rend l'écran principal. Les variables « let » modifiées au fil du temps (ex. _membership) sont lues en direct.
// CHUNKS=off : tout reste dans un seul fichier (secours).
const CHUNKS_ON = (process.env.CHUNKS || "on") !== "off";
const CHUNK_DEFS = {   // identifiant -> numéros des blocs (fichiers NN-….jsx)
  admin: ["39"], superadmin: ["43"], centre: ["42"], paie: ["27"], gestion: ["31", "32", "33", "34"],
  compta: ["14", "18", "19", "47"], groupe: ["37"], stock: ["25"], creances: ["26"], caisse: ["21"], sante: ["54"], impex: ["53"], resto: ["58"],
};
const version0 = (source.match(/const APP_VERSION = "(20\d{6}-\d{3})"/) || [])[1];
const chunkFiles = {};   // identifiant -> code compilé
let coreSource = source;
if (CHUNKS_ON) {
  const parNum = (num) => lues.filter((x) => x.nom.startsWith(num + "-"));
  const dansChunk = new Map();  // nom de fichier -> identifiant
  for (const [id, nums] of Object.entries(CHUNK_DEFS)) for (const num of nums) {
    const f = parNum(num); if (f.length !== 1) { console.error("BLOQUÉ — chunk « " + id + " » : bloc " + num + " introuvable."); process.exit(1); }
    dansChunk.set(f[0].nom, id);
  }
  const coreParts = lues.filter((x) => !dansChunk.has(x.nom));
  // Analyse du vrai code (commentaires retirés par le compilateur), pas des seuls en-têtes : un en-tête incomplet ne doit pas pouvoir casser un chunk.
  const nettoye = (t) => esbuild.transformSync(t, { loader: "jsx", target: "es2019" }).code;
  const proprio = new Map(); // nom déclaré au premier niveau -> fichier
  for (const x of lues) for (const n of nomsDeclares(x.texte)) if (!proprio.has(n)) proprio.set(n, x.nom);
  const coreTexte = coreParts.map((x) => x.texte).join("");
  const coreCode = nettoye(coreTexte);
  const vivantes = new Set([...coreTexte.matchAll(/^(?:let|var)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]));
  const utilise = (code, n) => new RegExp("(?<![\\w$.])" + n.replace(/\$/g, "\\$") + "(?![\\w$])").test(code);
  const scopeNoms = new Set(), liveUtilisees = new Set(), stubs = [];
  for (const [id, nums] of Object.entries(CHUNK_DEFS)) {
    const parts = lues.filter((x) => dansChunk.get(x.nom) === id);
    const propres = new Set(); parts.forEach((x) => nomsDeclares(x.texte).forEach((n) => propres.add(n)));
    const texteChunk = parts.map((x) => x.texte).join("");
    const codeChunk = nettoye(texteChunk);
    const besoins = new Set();
    for (const [n, f] of proprio) {
      if (propres.has(n) || !utilise(codeChunk, n)) continue;
      if (dansChunk.has(f)) { console.error("BLOQUÉ — chunk « " + id + " » utilise « " + n + " », qui est dans le chunk « " + dansChunk.get(f) + " »."); process.exit(1); }
      besoins.add(n);
    }
    // ce que l'application de départ utilise de ce chunk (doit être l'écran principal, et lui seul)
    const entree = [...propres].filter((n) => utilise(coreCode, n)).sort();
    if (!entree.length) { console.error("BLOQUÉ — chunk « " + id + " » : aucun écran n'est utilisé par l'application de départ."); process.exit(1); }
    console.log("  chunk " + id + " : écran(s) d'entrée " + entree.join(", ") + " ; emprunte " + besoins.size + " noms");
    for (const n of besoins) if (vivantes.has(n)) liveUtilisees.add(n); else scopeNoms.add(n);
    let code = texteChunk;
    for (const n of besoins) if (vivantes.has(n)) {
      const re = new RegExp("(?<![\\w$.])" + n.replace(/\$/g, "\\$") + "(?![\\w$])(?!\\s*:)", "g");
      code = code.replace(re, "__live." + n);
    }
    const liste = [...besoins].filter((n) => !vivantes.has(n)).sort();
    const enveloppe = '(window.__cpc=window.__cpc||{})[' + JSON.stringify(id) + ']={v:' + JSON.stringify(version0) + ',f:function(__c){const {' + liste.join(",") + '}=__c;const __live=__c.__live;\n' + code + '\nreturn {' + entree.join(",") + '};}};';
    const mini = esbuild.transformSync(appliquerCible(enveloppe), { loader: "jsx", target: "es2019", minify: true, charset: "ascii" }).code;
    chunkFiles[id] = mini;
    entree.forEach((n) => stubs.push("const " + n + " = cpLazy(" + JSON.stringify(id) + ", " + JSON.stringify(n) + ");"));
  }
  const tete = "const __CP_IDS = " + JSON.stringify(Object.keys(CHUNK_DEFS)) + ";\n";
  const queue = "\nfunction __cpScope() {\n  const __L = {};\n" + [...liveUtilisees].sort().map((n) => "  Object.defineProperty(__L, " + JSON.stringify(n) + ", { get: () => " + n + ", enumerable: true });\n").join("") +
    "  return { " + [...scopeNoms].sort().join(", ") + ", __live: __L };\n}\n" + stubs.join("\n") + "\n";
  coreSource = appliquerCible(tete + coreParts.map((x) => x.texte).join("") + queue);
  console.log("Chargement à la demande : " + Object.keys(CHUNK_DEFS).length + " fichiers (" + Object.entries(chunkFiles).map(([k, v]) => k + " " + Math.round(v.length / 1024) + " Ko").join(", ") + ").");
}

// 3) Compilation (même réglages qu'avant)
const brut = esbuild.transformSync(coreSource, { loader: "jsx", target: "es2019", minify: true }).code;
const min = "(function(){" + brut + "})();";

// 4) Numéro de version : lu dans l'application, recopié dans index.html
const m = source.match(/const APP_VERSION = "(20\d{6}-\d{3})"/);
if (!m) { console.error("APP_VERSION introuvable."); process.exit(1); }
const version = m[1];
// Le modèle de la page est src/index.modele.html (s'il existe) ; la page publiée docs/index.html n'est alors
// remplacée qu'au moment où les bibliothèques hébergées sont, elles aussi, publiées (jamais l'une sans l'autre).
const cheminIndex = [path.join(dossierParties, "index.modele.html"), path.join(racine, "docs", "index.html")].find((f) => fs.existsSync(f));
if (!cheminIndex) { console.error("Modèle de page introuvable (src/index.modele.html ou docs/index.html)."); process.exit(1); }
console.log("Modèle de page : " + path.relative(racine, cheminIndex));
const index = fs.readFileSync(cheminIndex, "utf8")
  .replace(/(app\.min\.js\?v=)20\d{6}-\d{3}/g, "$1" + version)
  .replace(/(sw\.js\?v=)20\d{6}-\d{3}/g, "$1" + version)
  .replace(/(tailwind\.css\?v=)20\d{6}-\d{3}/g, "$1" + version);

// 4b) Bibliothèques et polices hébergées avec le site (chantier 6)
// Elles sont copiées depuis les paquets npm (versions fixées dans package.json) vers vendor/ et fonts/,
// puis l'empreinte SRI (sha384) de chaque bibliothèque est inscrite dans index.html.
// VENDOR=skip : saute cette étape (poste sans accès aux paquets) ; en construction automatique, elle est obligatoire.
import crypto from "node:crypto";
const VENDOR_LIBS = [
  ["react.production.min.js", "react/umd/react.production.min.js"],
  ["react-dom.production.min.js", "react-dom/umd/react-dom.production.min.js"],
  ["supabase.js", "@supabase/supabase-js/dist/umd/supabase.js"],
  ["jspdf.umd.min.js", "jspdf/dist/jspdf.umd.min.js"],
  ["jspdf.plugin.autotable.min.js", "jspdf-autotable/dist/jspdf.plugin.autotable.min.js"],
  ["html5-qrcode.min.js", "html5-qrcode/html5-qrcode.min.js"],
  ["xlsx.full.min.js", "xlsx/dist/xlsx.full.min.js"],
];
const VENDOR_FONTS = [
  ...[400, 500, 600, 700].map((w) => ["inter-latin-" + w + "-normal.woff2", "@fontsource/inter/files/inter-latin-" + w + "-normal.woff2"]),
  ...[500, 600, 700].map((w) => ["spectral-latin-" + w + "-normal.woff2", "@fontsource/spectral/files/spectral-latin-" + w + "-normal.woff2"]),
  ...[500, 600].map((w) => ["ibm-plex-mono-latin-" + w + "-normal.woff2", "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-" + w + "-normal.woff2"]),
];
const vendorOn = (process.env.VENDOR || "on") !== "skip";
const vendorOut = []; // [chemin relatif dans la sortie, contenu]
let indexFinal = index;
if (vendorOn) {
  const nm = path.join(racine, "node_modules");
  const manque = [];
  for (const [nom, src] of VENDOR_LIBS) {
    const f = path.join(nm, src);
    if (!fs.existsSync(f)) { manque.push(src); continue; }
    const buf = fs.readFileSync(f);
    vendorOut.push(["vendor/" + nom, buf]);
    const sri = "sha384-" + crypto.createHash("sha384").update(buf).digest("base64");
    const re = new RegExp('(<script src="vendor/' + nom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '" integrity=")[^"]*(")');
    if (!re.test(indexFinal)) {
      if (nom === "xlsx.full.min.js") continue; // chargé à la demande par l'application : pas de balise dans index.html
      console.error("BLOQUÉ — index.html ne référence pas vendor/" + nom); process.exit(1);
    }
    indexFinal = indexFinal.replace(re, "$1" + sri + "$2");
  }
  for (const [nom, src] of VENDOR_FONTS) {
    const f = path.join(nm, src);
    if (!fs.existsSync(f)) { manque.push(src); continue; }
    vendorOut.push(["fonts/" + nom, fs.readFileSync(f)]);
  }
  if (manque.length) { console.error("BLOQUÉ — paquets manquants dans node_modules (npm install a-t-il été lancé ?) :\n  " + manque.join("\n  ")); process.exit(1); }
  if (/<script[^>]*integrity="sha384-PLACEHOLDER"/.test(indexFinal)) { console.error("BLOQUÉ — une empreinte SRI n'a pas été calculée."); process.exit(1); }
  console.log("Bibliothèques hébergées : " + VENDOR_LIBS.length + " fichiers, polices : " + VENDOR_FONTS.length + " fichiers (empreintes SRI inscrites).");
} else {
  console.log("Bibliothèques hébergées : étape sautée (VENDOR=skip).");
}

// 4b-bis) Feuille de styles (chantier 9) : Tailwind 3.4.17 (exécutable autonome, version fixée) génère tailwind.css
// à partir des classes réellement présentes dans les sources ; plus de script externe ni de 'unsafe-eval'.
// TAILWIND_BIN : chemin de l'exécutable (la construction automatique le télécharge et vérifie son empreinte).
// TAILWIND=skip : saute cette étape (poste de test sans l'exécutable) ; en construction automatique, elle est obligatoire.
import { execFileSync } from "node:child_process";
import os from "node:os";
const TAILWIND_VERSION = "3.4.17";
if (/tailwind\.css\?v=/.test(indexFinal)) {
  const bin = process.env.TAILWIND_BIN || "";
  if ((process.env.TAILWIND || "on") === "skip" || (!bin && !vendorOn)) {
    console.log("Feuille de styles : étape sautée (TAILWIND=skip ou VENDOR=skip sans TAILWIND_BIN).");
  } else {
    if (!bin || !fs.existsSync(bin)) { console.error("BLOQUÉ — générateur de styles introuvable (variable TAILWIND_BIN)."); process.exit(1); }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-"));
    const cfg = path.join(tmp, "tailwind.config.cjs"), entree = path.join(tmp, "entree.css"), sortieCss = path.join(tmp, "tailwind.css");
    const contenus = [path.join(dossierParties, "*.jsx"), cheminIndex];
    fs.writeFileSync(cfg, "module.exports = " + JSON.stringify({ content: contenus, theme: { extend: {} }, plugins: [] }) + ";\n");
    fs.writeFileSync(entree, "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n");
    let v = "";
    try { v = execFileSync(bin, ["--help"], { encoding: "utf8" }); } catch (e) { v = String((e && e.stdout) || ""); }
    if (!v.includes("tailwindcss v" + TAILWIND_VERSION)) { console.error("BLOQUÉ — le générateur de styles n'est pas en version " + TAILWIND_VERSION + "."); process.exit(1); }
    try { execFileSync(bin, ["-c", cfg, "-i", entree, "-o", sortieCss, "--minify"], { stdio: ["ignore", "pipe", "pipe"], cwd: racine }); }
    catch (e) { console.error("BLOQUÉ — la génération des styles a échoué :\n" + String((e && e.stderr) || e)); process.exit(1); }
    const css = fs.readFileSync(sortieCss);
    if (css.length < 5000) { console.error("BLOQUÉ — feuille de styles anormalement petite (" + css.length + " octets)."); process.exit(1); }
    vendorOut.push(["tailwind.css", css]);
    const sriCss = "sha384-" + crypto.createHash("sha384").update(css).digest("base64");
    indexFinal = indexFinal.replace(/(<link rel="stylesheet" href="tailwind\.css\?v=[^"]*" integrity=")[^"]*(")/, "$1" + sriCss + "$2");
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log("Feuille de styles : tailwind.css (" + Math.round(css.length / 1024) + " Ko, Tailwind " + TAILWIND_VERSION + ", empreinte SRI inscrite).");
  }
}

if (vendorOn && /integrity="sha384-PLACEHOLDER"/.test(indexFinal)) { console.error("BLOQUÉ — une empreinte SRI n'a pas été calculée (feuille de styles)."); process.exit(1); }

// 4c) Politique de sécurité : les scripts incorporés à index.html sont autorisés par leur empreinte sha256
// (recalculée ici, après la mise à jour des numéros de version), sans 'unsafe-inline'.
{
  const inline = [...indexFinal.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const hashes = [...new Set(inline.map((t) => "'sha256-" + crypto.createHash("sha256").update(t, "utf8").digest("base64") + "'"))];
  const reCsp = /(<meta http-equiv="Content-Security-Policy" content="[^"]*?script-src )([^;"]*)/;
  const mm = indexFinal.match(reCsp);
  if (!mm) { console.error("BLOQUÉ — politique de sécurité introuvable dans index.html."); process.exit(1); }
  const garde = mm[2].split(/\s+/).filter((t) => t && !t.startsWith("'sha256-") && t !== "'unsafe-inline'");
  indexFinal = indexFinal.replace(reCsp, "$1" + [...garde, ...hashes].join(" "));
  console.log("Politique de sécurité : " + hashes.length + " script(s) incorporé(s) autorisé(s) par empreinte.");
}

// 5) Contrôle avant d'écrire quoi que ce soit
const r = controle(cible, { "app.min.js": min, "app.jsx": source, "index.html": indexFinal });
console.log((r.ok ? "OK" : "BLOQUÉ") + " — cible " + cible.toUpperCase() + " — version " + version + " — " + noms.length + " parties");
r.warnings.forEach((w) => console.log("  ! " + w));
if (!r.ok) { r.problems.forEach((p) => console.log("  ✗ " + p)); process.exit(1); }

fs.mkdirSync(sortie, { recursive: true });
fs.writeFileSync(path.join(sortie, "app.min.js"), min);
fs.rmSync(path.join(sortie, "chunks"), { recursive: true, force: true });
for (const [id, code] of Object.entries(chunkFiles)) {
  fs.mkdirSync(path.join(sortie, "chunks"), { recursive: true });
  fs.writeFileSync(path.join(sortie, "chunks", id + ".js"), code);
}
fs.writeFileSync(path.join(sortie, "index.html"), indexFinal);
for (const [rel, buf] of vendorOut) {
  const dest = path.join(sortie, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}
console.log("Écrit : " + path.join(sortie, "app.min.js") + " (" + Math.round(min.length / 1024) + " Ko) et index.html");

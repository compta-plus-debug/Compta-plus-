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
import { verifierDependances } from "./dependances.mjs";

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
dep.infos.forEach((i) => console.log("  · " + i));
if (dep.problemes.length) { console.error("BLOQUÉ — frontières entre modules :"); dep.problemes.forEach((x) => console.error("  ✗ " + x)); process.exit(1); }
let source = noms.map((n) => fs.readFileSync(path.join(dossierParties, n), "utf8")).join("");

// 2) Cible TEST : même substitution que l'ancienne publication (première occurrence par ligne)
if (cible === "test") {
  const subs = [
    ["cnmmxpwlgovzbcfqaxqm", "lfpqetfasjqnucklvwah"],
    ["sb_publishable_Ba1KJd2YY-eLaCy1FRECIA_C1DoyAjL", "sb_publishable_dQ2C3wy2LikR2IY2BgSrlQ_Go9Gj9Da"],
  ];
  source = source.split("\n").map((l) => subs.reduce((acc, [a, b]) => acc.replace(a, b), l)).join("\n");
}

// 3) Compilation (même réglages qu'avant)
const brut = esbuild.transformSync(source, { loader: "jsx", target: "es2019", minify: true }).code;
const min = "(function(){" + brut + "})();";

// 4) Numéro de version : lu dans l'application, recopié dans index.html
const m = source.match(/const APP_VERSION = "(20\d{6}-\d{3})"/);
if (!m) { console.error("APP_VERSION introuvable."); process.exit(1); }
const version = m[1];
const cheminIndex = path.join(racine, "docs", "index.html");
if (!fs.existsSync(cheminIndex)) { console.error("docs/index.html introuvable."); process.exit(1); }
const index = fs.readFileSync(cheminIndex, "utf8")
  .replace(/(app\.min\.js\?v=)20\d{6}-\d{3}/g, "$1" + version)
  .replace(/(sw\.js\?v=)20\d{6}-\d{3}/g, "$1" + version);

// 5) Contrôle avant d'écrire quoi que ce soit
const r = controle(cible, { "app.min.js": min, "app.jsx": source, "index.html": index });
console.log((r.ok ? "OK" : "BLOQUÉ") + " — cible " + cible.toUpperCase() + " — version " + version + " — " + noms.length + " parties");
r.warnings.forEach((w) => console.log("  ! " + w));
if (!r.ok) { r.problems.forEach((p) => console.log("  ✗ " + p)); process.exit(1); }

fs.mkdirSync(sortie, { recursive: true });
fs.writeFileSync(path.join(sortie, "app.min.js"), min);
fs.writeFileSync(path.join(sortie, "index.html"), index);
console.log("Écrit : " + path.join(sortie, "app.min.js") + " (" + Math.round(min.length / 1024) + " Ko) et index.html");

// Outil de maintenance (utilisé par Claude, pas par vous) :
//   node build/entetes.mjs            -> écrit/met à jour l'en-tête « MODULE » de chaque partie + CARTE-DES-MODULES.md
//   node build/entetes.mjs --verifier -> ne modifie rien, signale si un en-tête n'est plus à jour
// Les en-têtes ne sont que des commentaires : le site compilé reste identique.
import fs from "node:fs";
import path from "node:path";
import { nomsDeclares, sansCommentaires, utilise, lireEntete } from "./dependances.mjs";

const dossierScript = path.dirname(new URL(import.meta.url).pathname);
const racine = fs.existsSync(path.join(dossierScript, "docs")) ? dossierScript : path.resolve(dossierScript, "..");
const estPartie = (n) => /^\d\d-.+\.jsx$/.test(n);
const dossier = [path.join(racine, "src", "parties"), path.join(racine, "src"), racine].find((d) => fs.existsSync(d) && fs.readdirSync(d).some(estPartie));
const verifier = process.argv.includes("--verifier");

const noms = fs.readdirSync(dossier).filter(estPartie).sort();
const FIN = "// ═══ FIN DE L'EN-TÊTE ═══";
const retirerEntete = (t) => {
  if (!t.startsWith("// ═══ MODULE ═══")) return t;
  const l = t.split("\n"); const i = l.indexOf(FIN);
  if (i >= 0) return l.slice(i + 1).join("\n");
  let j = 0; while (j < l.length && /^\/\/ (═══ MODULE|@|  )/.test(l[j])) j++;   // ancien en-tête sans terminateur
  return l.slice(j).join("\n");
};
const parties = noms.map((n) => ({ nom: n, corps: retirerEntete(fs.readFileSync(path.join(dossier, n), "utf8")) }));
const joli = (n) => { const s = n.replace(/^\d\d-/, "").replace(/\.jsx$/, "").replace(/-/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };

const decl = new Map(); parties.forEach((p) => { p.propres = nomsDeclares(p.corps); p.code = sansCommentaires(p.corps); p.propres.forEach((n) => { if (!decl.has(n)) decl.set(n, new Set()); decl.get(n).add(p.nom); }); });
for (const p of parties) {
  p.depends = []; p.exports = [];
  for (const [n, owners] of decl) {
    if (!p.propres.has(n) && utilise(p.code, n)) p.depends.push(n);
  }
  for (const n of p.propres) {
    if (parties.some((q) => q.nom !== p.nom && !q.propres.has(n) && utilise(q.code, n))) p.exports.push(n);
  }
  p.depends.sort(); p.exports.sort();
}
const enveloppe = (cle, liste) => { if (!liste.length) return "// @" + cle + " —\n"; let out = "// @" + cle, ligne = ""; const lignes = []; for (const n of liste) { if ((ligne + n + ", ").length > 96) { lignes.push(ligne.replace(/, $/, "")); ligne = ""; } ligne += n + ", "; } lignes.push(ligne.replace(/, $/, "")); return lignes.map((l, i) => (i ? "//   " : "// @" + cle + " ") + l).join("\n") + "\n"; };
let aJour = true;
for (const p of parties) {
  const entete = "// ═══ MODULE ═══\n// @module " + joli(p.nom) + "\n" + enveloppe("depends", p.depends) + enveloppe("exports", p.exports) + FIN + "\n";
  const actuel = fs.readFileSync(path.join(dossier, p.nom), "utf8");
  const voulu = entete + p.corps;
  if (actuel !== voulu) { aJour = false; if (!verifier) fs.writeFileSync(path.join(dossier, p.nom), voulu); }
}
if (verifier) { console.log(aJour ? "En-têtes à jour." : "En-têtes à régénérer (node build/entetes.mjs)."); process.exit(aJour ? 0 : 1); }

// Carte lisible
const proprio = new Map(); parties.forEach((p) => p.exports.forEach((n) => { if (!proprio.has(n)) proprio.set(n, p.nom); }));
let md = "# Carte des modules de Compta+\n\nGénérée automatiquement. Pour chaque bloc : combien de lignes, de quels autres blocs il dépend, et qui l'utilise.\n\n| Bloc | Lignes | Dépend de | Utilisé par |\n|---|---:|---|---|\n";
const court = (n) => n.replace(/\.jsx$/, "");
for (const p of parties) {
  const deps = [...new Set(p.depends.map((n) => [...(decl.get(n) || [])].find((f) => f !== p.nom)).filter(Boolean))].map(court);
  const users = parties.filter((q) => q.nom !== p.nom && q.depends.some((n) => p.exports.includes(n))).map((q) => court(q.nom));
  md += "| " + court(p.nom) + " | " + p.corps.split("\n").length + " | " + (deps.join(", ") || "—") + " | " + (users.join(", ") || "—") + " |\n";
}
fs.writeFileSync(path.join(racine, "CARTE-DES-MODULES.md"), md);
console.log("En-têtes écrits sur " + parties.length + " blocs et carte générée.");

// Lance les tests automatiques sur le site compilé (docs/app.min.js) avec une fausse base de données.
// Utilisation : node tests/lancer.mjs   (variables : APP_JS = fichier à tester, CHROMIUM = navigateur)
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ici = path.dirname(fileURLToPath(import.meta.url));
const tests = ["h1", "k1", "g2", "p1", "p2", "p3", "p5", "p6", "r1", "c2", "c1", "d2", "d3", "d4", "e1", "i3", "i4", "i5", "j1", "l1", "l2", "l3", "c6", "m1", "m2", "n2", "n1", "n3", "s1", "s2", "t1", "t2", "u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "u9"];
let echecs = 0;
for (const t of tests) {
  let sortie = "", ok = false;
  for (let essai = 1; essai <= 2 && !ok; essai++) {           // un 2e essai si le navigateur a eu un raté ponctuel
    const r = spawnSync("node", [path.join(ici, "tst-" + t + ".cjs")], { cwd: ici, encoding: "utf8", timeout: 300000, env: process.env });
    sortie = (r.stdout || "") + (r.stderr || "");
    const lignes = sortie.split("\n").filter(Boolean);
    ok = r.status === 0 && !lignes.some((l) => /^FAIL/.test(l)) && /fails=0|TOUT PASSE|^OK/m.test(lignes.slice(-3).join("\n"));
  }
  const nbPass = (sortie.match(/^PASS/gm) || []).length;
  console.log((ok ? "OK    " : "ÉCHEC ") + t + " (" + nbPass + " contrôles réussis)");
  if (!ok) { echecs++; console.log(sortie.split("\n").filter((l) => /^FAIL/.test(l)).slice(0, 8).join("\n") || sortie.slice(-600)); }
}
console.log(echecs ? echecs + " test(s) en échec." : "Tous les tests automatiques sont réussis.");
process.exit(echecs ? 1 : 0);

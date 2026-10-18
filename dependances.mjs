// Contrôle des « frontières » entre modules.
// Un module (ex. Super Admin) est un fichier de src/parties/ qui commence par un en-tête :
//   // @module Nom
//   // @depends nomA, nomB, ...     <- tout ce qu'il emprunte au reste de l'application
//   // @exports FonctionPrincipale  <- ce que le reste de l'application a le droit d'utiliser
// La compilation s'arrête si :
//   - le module utilise un nom du reste de l'application qu'il n'a pas déclaré dans @depends ;
//   - le reste de l'application utilise autre chose que ce que le module exporte.
// Aucun effet sur le résultat compilé : ce sont seulement des commentaires.

const reDecl = /^(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
const reObj = /^const\s+\{([^}]*)\}\s*=/gm;
const reArr = /^const\s+\[([^\]]*)\]\s*=/gm;

function nomsDeclares(texte) {
  const s = new Set();
  for (const m of texte.matchAll(reDecl)) s.add(m[1]);
  for (const m of texte.matchAll(reObj)) for (const n of m[1].split(",")) { const x = n.trim().split(":").pop().trim().split("=")[0].trim(); if (x) s.add(x); }
  for (const m of texte.matchAll(reArr)) for (const n of m[1].split(",")) { const x = n.trim(); if (x) s.add(x); }
  return s;
}
const sansCommentaires = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
const utilise = (texte, nom) => new RegExp("(?<![\\w$.])" + nom.replace(/\$/g, "\\$") + "(?![\\w$])").test(texte);

export function verifierDependances(parties) {
  const problemes = [], infos = [];
  const decl = new Map(); // nom -> fichier
  for (const p of parties) for (const n of nomsDeclares(p.texte)) if (!decl.has(n)) decl.set(n, p.nom);
  for (const p of parties) {
    const mod = p.texte.match(/^\/\/ @module (.+)$/m);
    if (!mod) continue;
    const dep = (p.texte.match(/^\/\/ @depends (.*)$/m) || [, ""])[1].split(",").map((x) => x.trim()).filter(Boolean);
    const exp = (p.texte.match(/^\/\/ @exports (.*)$/m) || [, ""])[1].split(",").map((x) => x.trim()).filter(Boolean);
    const code = sansCommentaires(p.texte);
    const propres = nomsDeclares(p.texte);
    // 1) emprunts non déclarés
    const reels = [];
    for (const [n, f] of decl) if (f !== p.nom && !propres.has(n) && utilise(code, n)) reels.push(n);
    const manque = reels.filter((n) => !dep.includes(n));
    if (manque.length) problemes.push(`${p.nom} : emprunte ${manque.join(", ")} sans l'avoir déclaré dans « @depends ».`);
    const inutiles = dep.filter((n) => !reels.includes(n));
    if (inutiles.length) infos.push(`${p.nom} : déclaré mais non détecté (à retirer si inutile) : ${inutiles.join(", ")}`);
    // 2) le reste de l'application ne doit utiliser que les exports
    const interne = [...propres].filter((n) => !exp.includes(n));
    for (const q of parties) {
      if (q.nom === p.nom) continue;
      const c2 = sansCommentaires(q.texte);
      const mal = interne.filter((n) => utilise(c2, n) && !nomsDeclares(q.texte).has(n));
      if (mal.length) problemes.push(`${q.nom} : utilise ${mal.join(", ")}, interne au module ${mod[1]} (seuls ${exp.join(", ") || "—"} sont exportés).`);
    }
    infos.push(`module ${mod[1]} : ${reels.length} emprunts, exporte ${exp.join(", ")}`);
  }
  return { problemes, infos };
}

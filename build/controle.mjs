// Contrôle de publication : refuse un fichier qui n'est pas pour la bonne base (test / production)
// ou dont les numéros de version ne concordent pas. Même règles que le contrôle manuel utilisé jusqu'ici.
const PROD = "cnmmxpwlgovzbcfqaxqm", TEST = "lfpqetfasjqnucklvwah";
const PK = "sb_publishable_Ba1KJd2YY-eLaCy1FRECIA_C1DoyAjL", TK = "sb_publishable_dQ2C3wy2LikR2IY2BgSrlQ_Go9Gj9Da";

export function controle(dest, files) {
  const label = { prod: "PRODUCTION", test: "TEST" };
  const oth = dest === "prod" ? "test" : "prod";
  const want = dest === "prod" ? [PROD, PK] : [TEST, TK];
  const other = dest === "prod" ? [TEST, TK] : [PROD, PK];
  const problems = [], warnings = [], versions = {};
  const VER = /\b(20\d{6}-\d{3})\b/g;
  const distinct = (t) => [...new Set([...t.matchAll(VER)].map((m) => m[1]))];
  for (const name of ["app.min.js", "app.jsx"]) {
    const t = files[name];
    if (!t) { problems.push("Fichier manquant : " + name + "."); continue; }
    if (t.indexOf(want[0]) < 0 || t.indexOf(want[1]) < 0) problems.push(`${name} n'est pas une version ${label[dest]} (adresse ou clé de la base absente).`);
    if (t.indexOf(other[0]) >= 0 || t.indexOf(other[1]) >= 0) problems.push(`${name} est une version ${label[oth]} : ne la publiez PAS ici.`);
    const v = distinct(t);
    versions[name] = v;
    if (v.length !== 1) problems.push(`${name} : numéro de version introuvable ou ambigu (${v.join(", ") || "aucun"}).`);
  }
  const ix = files["index.html"];
  if (!ix) problems.push("Fichier manquant : index.html.");
  else {
    const v2 = distinct(ix);
    versions["index.html"] = v2;
    if (v2.length !== 1) problems.push(`index.html : numéro de version introuvable ou ambigu (${v2.join(", ") || "aucun"}).`);
    if (ix.indexOf(PROD) >= 0 || ix.indexOf(TEST) >= 0) warnings.push("index.html contient une adresse de base de données : inattendu.");
  }
  const all = new Set(Object.values(versions).flat());
  if (all.size > 1) problems.push("Les fichiers n'ont pas le même numéro de version : " + Object.entries(versions).map(([k, v]) => `${k} = ${v.join("/") || "?"}`).join(" ; "));
  if (files["app.min.js"] && files["app.min.js"].indexOf("ENV_GUARD") < 0) warnings.push("La version ne contient pas le garde-fou intégré.");
  return { ok: problems.length === 0, problems, warnings, versions };
}

// @module V333-ExportCsvSecurise
// @depends —
// @exports —
// Protection contre l'injection de formules dans les exports CSV : une cellule de texte qui commence par
// = + - @ (ou tabulation / retour chariot) serait exécutée comme une formule à l'ouverture dans Excel.
// On la préfixe d'une apostrophe. Les nombres (ex. -1 234,50) ne sont pas touchés.
(function () {
  const g = typeof window !== "undefined" ? window : globalThis;
  if (!g.Blob || g.__csvGuardV333) return;
  g.__csvGuardV333 = true;
  const Native = g.Blob;
  const DANGER = /^[=+\-@\t\r]/;
  const NUMERIC = /^[+-]?[\d\s  .,]+%?$/;
  const clean = (v) => (DANGER.test(v) && !NUMERIC.test(v) ? "'" + v : v);
  // Découpe une ligne en cellules (séparateurs ; , tabulation hors guillemets) et nettoie chaque cellule.
  const line = (l) => {
    let out = "", cur = "", v333Quote = false;
    const flush = () => {
      if (cur.length > 1 && cur[0] === '"' && cur[cur.length - 1] === '"') out += '"' + clean(cur.slice(1, -1)) + '"';
      else out += clean(cur);
      cur = "";
    };
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') { v333Quote = !v333Quote; cur += ch; }
      else if (!v333Quote && (ch === ";" || ch === "," || ch === "\t")) { flush(); out += ch; }
      else cur += ch;
    }
    flush();
    return out;
  };
  const sanitize = (text) => text.split(/(\r\n|\n)/).map((p, i) => (i % 2 ? p : line(p))).join("");
  const isCsv = (o) => !!(o && typeof o.type === "string" && /csv/i.test(o.type));
  class GuardedBlob extends Native {
    constructor(parts, opts) {
      let p = parts;
      try {
        if (isCsv(opts) && Array.isArray(parts) && parts.every((x) => typeof x === "string")) p = parts.map(sanitize);
      } catch (e) { p = parts; }
      super(p, opts);
    }
  }
  g.Blob = GuardedBlob;
})();

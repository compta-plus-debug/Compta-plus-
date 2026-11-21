// ═══ MODULE ═══
// @module Export Office
// @depends —
// @exports officeDocx, officeEntreprise, officeEntetePage, officeLogo, officeTelecharger, officeXlsx
// ═══ FIN DE L'EN-TÊTE ═══
// Export Word (.docx) et Excel (.xlsx) mis en forme, sans bibliothèque externe.
// Ces fichiers sont des archives ZIP de XML fabriquées ici. Entrée commune : des « sections » composées de blocs
// qui reprennent la présentation des documents imprimés de Compta+ (fiche de coût, facture, devis).
//
// Blocs :
//   { k:"logo" }                                  logo de l'entreprise (ignoré s'il n'y en a pas)
//   { k:"entete", nom, detail, date }            en-tête à gauche (fiches et factures) : nom, coordonnées, date à droite, filet bleu
//   { k:"p", t | parts:[{t,g}], g, s, c, al, sp, av }   paragraphe ; s = taille en points ; al = "l"|"c"|"r"
//   { k:"tbl", style:"ligne"|"grille"|"sans", cols:[{h, sp, al}], lignes:[[cellule]], pieds:[[cellule]] }
//   { k:"espace", h }                            espace vertical (en lignes)
//   cellule : texte, nombre, ou { t (affichage), n (valeur numérique pour Excel), nf (3 = entier, 4 = décimal), g (gras), cs (colonnes fusionnées), al, bord ("haut" | "aucun") }
//   sp : largeur relative sur une grille de 12 colonnes (la somme des sp d'un tableau vaut 12).

const OF_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function ofCrc(octets) {
  let c = 0xffffffff;
  for (let i = 0; i < octets.length; i++) c = OF_CRC[(c ^ octets[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// fichiers : [{ nom, texte } | { nom, octets }] -> Uint8Array (archive ZIP, méthode « stockée »)
function ofZip(fichiers) {
  const enc = new TextEncoder();
  const morceaux = [];
  const centraux = [];
  let offset = 0;
  for (const f of fichiers) {
    const nom = enc.encode(f.nom);
    const donnees = f.octets ? f.octets : enc.encode(f.texte);
    const crc = ofCrc(donnees);
    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true);
    loc.setUint16(8, 0, true); loc.setUint16(10, 0, true); loc.setUint16(12, 0x21, true);
    loc.setUint32(14, crc, true); loc.setUint32(18, donnees.length, true); loc.setUint32(22, donnees.length, true);
    loc.setUint16(26, nom.length, true); loc.setUint16(28, 0, true);
    morceaux.push(new Uint8Array(loc.buffer), nom, donnees);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true); cen.setUint16(12, 0, true); cen.setUint16(14, 0x21, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, donnees.length, true); cen.setUint32(24, donnees.length, true);
    cen.setUint16(28, nom.length, true); cen.setUint16(30, 0, true); cen.setUint16(32, 0, true);
    cen.setUint16(34, 0, true); cen.setUint16(36, 0, true); cen.setUint32(38, 0, true); cen.setUint32(42, offset, true);
    centraux.push(new Uint8Array(cen.buffer), nom);
    offset += 30 + nom.length + donnees.length;
  }
  const tailleCentral = centraux.reduce((t, p) => t + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, fichiers.length, true); fin.setUint16(10, fichiers.length, true);
  fin.setUint32(12, tailleCentral, true); fin.setUint32(16, offset, true);
  const tous = [...morceaux, ...centraux, new Uint8Array(fin.buffer)];
  const total = tous.reduce((t, p) => t + p.length, 0);
  const archive = new Uint8Array(total);
  let pos = 0;
  for (const p of tous) { archive.set(p, pos); pos += p.length; }
  return archive;
}

function ofEchap(v) {
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function ofTxt(v) {
  if (typeof v === "number" && isFinite(v)) return v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  return v == null ? "" : String(v);
}

// Couleurs de la charte des documents imprimés
const OF_NAVY = "152238";
const OF_BEIGE_TEXTE = "EFE9DD";
const OF_ZEBRA = "FAF7EF";
const OF_GRIS = "BBBBBB";
const OF_LIGNE = "DDDDDD";
const OF_TEXTE = "111111";
const OF_CHARS = 10; // largeur d'une colonne de la grille Excel, en caractères
const OF_AL = { l: "left", c: "center", r: "right" };

// Cellule normalisée
function ofCellule(c) {
  if (c && typeof c === "object" && !Array.isArray(c)) {
    const n = typeof c.n === "number" && isFinite(c.n) ? c.n : null;
    return { t: c.t != null ? String(c.t) : ofTxt(n), n, nf: c.nf || (n != null ? (Number.isInteger(n) ? 3 : 4) : 0), g: !!c.g, cs: c.cs || 1, al: c.al || null, bord: c.bord || null };
  }
  if (typeof c === "number" && isFinite(c)) return { t: ofTxt(c), n: c, nf: Number.isInteger(c) ? 3 : 4, g: false, cs: 1, al: null, bord: null };
  return { t: c == null ? "" : String(c), n: null, nf: 0, g: false, cs: 1, al: null, bord: null };
}

// Filets d'une cellule selon le style du tableau, le rôle de la ligne et une exception éventuelle
function ofFilets(style, role, bord) {
  const vide = { top: null, left: null, bottom: null, right: null };
  if (bord === "aucun") return vide;
  if (bord === "haut") return { ...vide, top: { sz: 6, c: OF_NAVY } };
  if (style === "grille") { const g = { sz: 4, c: OF_GRIS }; return { top: g, left: g, bottom: g, right: g }; }
  if (role === "tete") return { ...vide, bottom: { sz: 8, c: OF_NAVY } };
  return { ...vide, bottom: { sz: 4, c: OF_LIGNE } };
}

// Tableau -> lignes normalisées : [{ role, cellules:[{ col, cs, sp, c, al, fond, couleur, bord }] }]
function ofLignesTableau(b) {
  const cols = b.cols || [];
  const sp = cols.map((c) => c.sp || 1);
  const lignes = [];
  const lig = (role, rangees) => rangees.forEach((r, idx) => {
    const cells = [];
    let j = 0;
    (r || []).map(ofCellule).forEach((c) => {
      const cs = Math.max(1, Math.min(c.cs, cols.length - j));
      const colonne = cols[j] || {};
      const largeur = sp.slice(j, j + cs).reduce((a, x) => a + x, 0);
      const entete = role === "tete";
      const zebre = role === "corps" && idx % 2 === 1 && b.style !== "sans";
      cells.push({ col: j, cs, sp: largeur, c, al: c.al || colonne.al || "l", role, fond: entete ? OF_NAVY : zebre ? OF_ZEBRA : null, couleur: entete ? OF_BEIGE_TEXTE : OF_TEXTE, bord: c.bord || null });
      j += cs;
    });
    lignes.push({ role, cellules: cells });
  });
  if (cols.some((c) => c.h)) lig("tete", [cols.map((c) => ({ t: String(c.h).toUpperCase(), g: true, al: c.al || "l" }))]);
  lig("corps", b.lignes || []);
  lig("pied", b.pieds || []);
  return lignes;
}

// ───────── Word (.docx)

function ofDocxBorders(f) {
  const cote = (nom, v) => (v ? '<w:' + nom + ' w:val="single" w:sz="' + v.sz + '" w:space="0" w:color="' + v.c + '"/>' : '<w:' + nom + ' w:val="nil"/>');
  return "<w:tcBorders>" + cote("top", f.top) + cote("left", f.left) + cote("bottom", f.bottom) + cote("right", f.right) + "</w:tcBorders>";
}

function ofDocxSansBordure() {
  return '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>';
}

// Morceaux de texte d'un paragraphe (texte simple ou parties en gras)
function ofDocxRuns(b) {
  const sz = Math.round((b.s || 10) * 2);
  const parts = b.parts || [{ t: b.t, g: b.g }];
  return parts.map((m) => "<w:r><w:rPr>" + ((m.g != null ? m.g : b.g) ? "<w:b/>" : "") + (b.c ? '<w:color w:val="' + b.c + '"/>' : "") +
    '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr><w:t xml:space="preserve">' + ofEchap(m.t) + "</w:t></w:r>").join("");
}

function ofDocxParagraphe(b) {
  const apres = b.sp == null ? 60 : b.sp;
  return '<w:p><w:pPr><w:spacing w:before="' + (b.av || 0) + '" w:after="' + apres + '"/><w:jc w:val="' + (OF_AL[b.al || "l"] || "left") + '"/></w:pPr>' +
    ofDocxRuns(b) + "</w:p>";
}

let ofDocxIdImage = 0;
function ofDocxImage(logo, align) {
  const id = ++ofDocxIdImage;
  return '<w:p><w:pPr><w:spacing w:before="0" w:after="60"/><w:jc w:val="' + (align || "center") + '"/></w:pPr><w:r><w:drawing>' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + logo.cx + '" cy="' + logo.cy + '"/><wp:docPr id="' + id + '" name="Logo ' + id + '"/>' +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
    '<pic:nvPicPr><pic:cNvPr id="' + id + '" name="logo.' + logo.ext + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + logo.cx + '" cy="' + logo.cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>";
}

// En-tête à gauche (fiche ou facture) : logo, nom, coordonnées à gauche ; date à droite ; filet bleu dessous
function ofDocxEntete(b, logo) {
  const bordure = '<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="single" w:sz="16" w:space="0" w:color="' + OF_NAVY + '"/><w:right w:val="nil"/></w:tcBorders>';
  const gauche = (logo ? ofDocxImage(logo, "left") : "") +
    ofDocxParagraphe({ t: b.nom || "", g: true, s: 12, al: "l", sp: 0 }) +
    ofDocxParagraphe({ t: b.detail || "", s: 8, al: "l", sp: 80 });
  const droite = ofDocxParagraphe({ t: b.date || "", s: 8, al: "r", sp: 0 });
  return "<w:tbl><w:tblPr><w:tblW w:w=\"9638\" w:type=\"dxa\"/><w:tblLayout w:type=\"fixed\"/>" + ofDocxSansBordure() + "</w:tblPr>" +
    '<w:tblGrid><w:gridCol w:w="6900"/><w:gridCol w:w="2738"/></w:tblGrid><w:tr>' +
    '<w:tc><w:tcPr><w:tcW w:w="6900" w:type="dxa"/>' + bordure + "</w:tcPr>" + gauche + "</w:tc>" +
    '<w:tc><w:tcPr><w:tcW w:w="2738" w:type="dxa"/>' + bordure + "</w:tcPr>" + droite + "</w:tc>" +
    "</w:tr></w:tbl>" + '<w:p><w:pPr><w:spacing w:before="0" w:after="120"/></w:pPr></w:p>';
}

function ofDocxTableau(b) {
  const cols = b.cols || [];
  const sp = cols.map((c) => c.sp || 1);
  const total = sp.reduce((a, x) => a + x, 0) || 1;
  const largeur = 9638;
  const colW = sp.map((x) => Math.floor((largeur * x) / total));
  let xml = '<w:tbl><w:tblPr><w:tblW w:w="' + largeur + '" w:type="dxa"/><w:tblLayout w:type="fixed"/>' + ofDocxSansBordure() +
    '<w:tblCellMar><w:top w:w="90" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr>';
  xml += "<w:tblGrid>" + colW.map((w) => '<w:gridCol w:w="' + w + '"/>').join("") + "</w:tblGrid>";
  ofLignesTableau(b).forEach((ligne) => {
    xml += "<w:tr>" + (ligne.role === "tete" ? "<w:trPr><w:tblHeader/></w:trPr>" : "");
    ligne.cellules.forEach((cel) => {
      const w = colW.slice(cel.col, cel.col + cel.cs).reduce((a, x) => a + x, 0);
      const fond = cel.fond ? '<w:shd w:val="clear" w:color="auto" w:fill="' + cel.fond + '"/>' : "";
      const span = cel.cs > 1 ? '<w:gridSpan w:val="' + cel.cs + '"/>' : "";
      const gras = ligne.role === "tete" || cel.c.g || ligne.role === "pied" ? "<w:b/>" : "";
      const sz = ligne.role === "tete" ? 17 : 18;
      xml += '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' + span + ofDocxBorders(ofFilets(b.style, ligne.role, cel.bord)) + fond + '<w:vAlign w:val="center"/></w:tcPr>' +
        '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="' + (OF_AL[cel.al] || "left") + '"/></w:pPr>' +
        "<w:r><w:rPr>" + gras + '<w:color w:val="' + cel.couleur + '"/><w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr>' +
        '<w:t xml:space="preserve">' + ofEchap(cel.c.t) + "</w:t></w:r></w:p></w:tc>";
    });
    xml += "</w:tr>";
  });
  return xml + "</w:tbl>" + '<w:p><w:pPr><w:spacing w:before="0" w:after="100"/></w:pPr></w:p>';
}

// sections : [{ nom, blocs:[...] }] -> Uint8Array (.docx). ctx.logo : résultat de officeLogo (ou null)
function officeDocx(sections, ctx) {
  const logo = ctx && ctx.logo;
  ofDocxIdImage = 0;
  let corps = "";
  sections.forEach((s, i) => {
    if (i > 0) corps += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    s.blocs.forEach((b) => {
      if (b.k === "logo") { if (logo) corps += ofDocxImage(logo, "center"); }
      else if (b.k === "entete") corps += ofDocxEntete(b, logo);
      else if (b.k === "p") corps += ofDocxParagraphe(b);
      else if (b.k === "tbl") corps += ofDocxTableau(b);
      else if (b.k === "espace") corps += '<w:p><w:pPr><w:spacing w:before="0" w:after="' + ((b.h || 1) * 120) + '"/></w:pPr></w:p>';
    });
  });
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + "><w:body>" + corps +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1134" w:bottom="1000" w:left="1134" w:header="500" w:footer="500" w:gutter="0"/></w:sectPr></w:body></w:document>';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="20"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="60"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>';
  const extImage = logo ? (logo.ext === "png" ? "png" : "jpeg") : "";
  const contenu = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    (logo ? '<Default Extension="' + extImage + '" ContentType="image/' + extImage + '"/>' : "") +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
  const racine = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  const relDoc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    (logo ? '<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.' + extImage + '"/>' : "") +
    "</Relationships>";
  const fichiers = [
    { nom: "[Content_Types].xml", texte: contenu },
    { nom: "_rels/.rels", texte: racine },
    { nom: "word/document.xml", texte: docXml },
    { nom: "word/styles.xml", texte: styles },
    { nom: "word/_rels/document.xml.rels", texte: relDoc },
  ];
  if (logo) fichiers.push({ nom: "word/media/logo." + extImage, octets: logo.octets });
  return ofZip(fichiers);
}

// ───────── Excel (.xlsx)

function officeXlsx(sections, ctx) {
  const logo = ctx && ctx.logo;
  const polices = [];
  const remplis = [];
  const bords = [];
  const xfs = [];
  const cache = {};
  const pousse = (liste, xml) => { let i = liste.indexOf(xml); if (i < 0) { liste.push(xml); i = liste.length - 1; } return i; };
  polices.push('<font><sz val="10"/><color rgb="FF' + OF_TEXTE + '"/><name val="Calibri"/><family val="2"/></font>');
  remplis.push('<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>');
  bords.push('<border><left/><right/><top/><bottom/><diagonal/></border>');
  xfs.push('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');
  const cote = (nom, v) => (v ? "<" + nom + ' style="' + (v.sz >= 8 ? "medium" : "thin") + '"><color rgb="FF' + v.c + '"/></' + nom + ">" : "<" + nom + "/>");
  // o : { g, sz, c, fond, al, nf, wrap, f (filets) }
  const style = (o) => {
    const cle = JSON.stringify(o);
    if (cache[cle] != null) return cache[cle];
    const f = pousse(polices, "<font>" + (o.g ? "<b/>" : "") + '<sz val="' + (o.sz || 10) + '"/><color rgb="FF' + (o.c || OF_TEXTE) + '"/><name val="Calibri"/><family val="2"/></font>');
    const fi = o.fond ? pousse(remplis, '<fill><patternFill patternType="solid"><fgColor rgb="FF' + o.fond + '"/><bgColor indexed="64"/></patternFill></fill>') : 0;
    const bo = o.f ? pousse(bords, "<border>" + cote("left", o.f.left) + cote("right", o.f.right) + cote("top", o.f.top) + cote("bottom", o.f.bottom) + "<diagonal/></border>") : 0;
    const idFormat = o.nf === "g" ? 164 : o.nf === "usd" ? 165 : (o.nf || 0);
    xfs.push('<xf numFmtId="' + idFormat + '" fontId="' + f + '" fillId="' + fi + '" borderId="' + bo + '" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' +
      '<alignment horizontal="' + (OF_AL[o.al] || "general") + '" vertical="center"' + (o.wrap ? ' wrapText="1"' : "") + "/></xf>");
    cache[cle] = xfs.length - 1;
    return cache[cle];
  };
  const col = (i) => String.fromCharCode(65 + i);
  const largeurPx = OF_CHARS * 7 + 5;
  const totalPx = 12 * largeurPx;
  const feuilles = [];
  sections.forEach((s) => {
    const lignes = [];
    let r = 0;
    const fusions = [];
    let ancre = null;
    // cellule : c = { t, n, nf, parts } ; vide si rien à écrire (mise en forme seule)
    const cellXml = (ref, st, c) => {
      if (c == null || (c.t === "" && c.n == null && !c.parts)) return '<c r="' + ref + '" s="' + st + '"/>';
      if (c.n != null) return '<c r="' + ref + '" s="' + st + '"><v>' + c.n + "</v></c>";
      if (c.parts) {
        const runs = c.parts.map((m) => "<r><rPr><rFont val=\"Calibri\"/>" + ((m.g != null ? m.g : c.g) ? "<b/>" : "") + '<color rgb="FF' + (c.c || OF_TEXTE) + '"/><sz val="' + (c.sz || 10) + '"/></rPr><t xml:space="preserve">' + ofEchap(m.t) + "</t></r>").join("");
        return '<c r="' + ref + '" s="' + st + '" t="inlineStr"><is>' + runs + "</is></c>";
      }
      return '<c r="' + ref + '" s="' + st + '" t="inlineStr"><is><t xml:space="preserve">' + ofEchap(c.t) + "</t></is></c>";
    };
    const ajouteLigne = (cells, ht) => { r++; lignes.push('<row r="' + r + '"' + (ht ? ' ht="' + ht + '" customHeight="1"' : "") + ">" + cells.join("") + "</row>"); return r; };
    const lignesVides = (n) => { for (let i = 0; i < n; i++) ajouteLigne([]); };
    const ligneLogo = (gauche) => {
      if (!logo) return;
      r++;
      lignes.push('<row r="' + r + '" ht="' + Math.round(Math.max(logo.hPx, 40) * 0.75) + '" customHeight="1"></row>');
      ancre = { ligne: r - 1, gauche, hPx: logo.hPx, wPx: logo.wPx };
    };
    s.blocs.forEach((b) => {
      if (b.k === "logo") {
        ligneLogo(false);
      } else if (b.k === "entete") {
        ligneLogo(true);
        const stNom = style({ g: true, sz: 12, al: "l" });
        const stDate = style({ sz: 8, al: "r" });
        const stDetail = style({ sz: 8, al: "l", f: { bottom: { sz: 8, c: OF_NAVY } } });
        const rNom = r + 1;
        const cellsNom = [];
        for (let i = 0; i < 12; i++) {
          if (i === 0) cellsNom.push(cellXml(col(0) + rNom, stNom, { t: b.nom || "" }));
          else if (i === 8) cellsNom.push(cellXml(col(8) + rNom, stDate, { t: b.date || "" }));
          else cellsNom.push(cellXml(col(i) + rNom, i < 8 ? stNom : stDate, null));
        }
        ajouteLigne(cellsNom, 18);
        fusions.push("A" + rNom + ":H" + rNom, "I" + rNom + ":L" + rNom);
        const rDet = r + 1;
        const cellsDet = [];
        for (let i = 0; i < 12; i++) cellsDet.push(cellXml(col(i) + rDet, stDetail, i === 0 ? { t: b.detail || "" } : null));
        ajouteLigne(cellsDet, 15);
        fusions.push("A" + rDet + ":L" + rDet);
        lignesVides(1);
      } else if (b.k === "p") {
        const st = style({ g: b.g, sz: b.s || 10, c: b.c, al: b.al || "l", wrap: true });
        const texte = b.parts ? b.parts.map((m) => m.t).join("") : String(b.t || "");
        const cells = [];
        for (let i = 0; i < 12; i++) cells.push(cellXml(col(i) + (r + 1), st, i === 0 ? { t: b.parts ? "" : b.t, parts: b.parts, g: b.g, c: b.c, sz: b.s || 10 } : null));
        const n = Math.max(1, Math.ceil(texte.length / 105));
        const rr = ajouteLigne(cells, Math.round((b.s || 10) * 1.6 * n + ((b.sp == null ? 60 : b.sp) / 20)));
        fusions.push("A" + rr + ":L" + rr);
      } else if (b.k === "espace") {
        lignesVides(b.h || 1);
      } else if (b.k === "tbl") {
        ofLignesTableau(b).forEach((ligne) => {
          const rr = r + 1;
          const cells = [];
          let hauteur = 1;
          ligne.cellules.forEach((cel) => {
            const spDebut = (b.cols || []).slice(0, cel.col).reduce((a, c) => a + (c.sp || 1), 0);
            const f = ofFilets(b.style, ligne.role, cel.bord);
            const st = style({
              g: ligne.role === "tete" || cel.c.g || ligne.role === "pied",
              sz: ligne.role === "tete" ? 8 : 9,
              c: ligne.role === "tete" ? OF_BEIGE_TEXTE : OF_TEXTE,
              al: cel.al,
              fond: cel.fond,
              nf: cel.c.n != null ? cel.c.nf : 0,
              wrap: true,
              f,
            });
            const texte = cel.c.t || "";
            hauteur = Math.max(hauteur, Math.ceil(texte.length / Math.max(4, cel.sp * OF_CHARS * 1.1)));
            for (let k = 0; k < cel.sp; k++) cells.push(cellXml(col(spDebut + k) + rr, st, k === 0 ? cel.c : null));
            if (cel.sp > 1) fusions.push(col(spDebut) + rr + ":" + col(spDebut + cel.sp - 1) + rr);
          });
          ajouteLigne(cells, hauteur > 1 ? Math.round(13.5 * hauteur + 4) : 18);
        });
        lignesVides(1);
      }
    });
    const nomFeuille = String(s.nom || "Feuille").replace(/[\[\]:*?\/\\]/g, " ").slice(0, 31).trim() || "Feuille";
    const cols = [];
    for (let i = 0; i < 12; i++) cols.push('<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + OF_CHARS + '" customWidth="1"/>');
    feuilles.push({
      nom: nomFeuille,
      xml: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>' +
        "<cols>" + cols.join("") + "</cols><sheetData>" + lignes.join("") + "</sheetData>" +
        (fusions.length ? '<mergeCells count="' + fusions.length + '">' + fusions.map((f) => '<mergeCell ref="' + f + '"/>').join("") + "</mergeCells>" : "") +
        '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>' +
        (ancre ? '<drawing r:id="rIdDessin"/>' : "") + "</worksheet>",
      ancre,
    });
  });
  // images : une par feuille avec logo ; à gauche (en-tête) ou centré
  const dessins = [];
  feuilles.forEach((f) => {
    if (!f.ancre || !logo) return;
    const debutPx = f.ancre.gauche ? 0 : (totalPx - f.ancre.wPx) / 2;
    const colonne = Math.floor(debutPx / largeurPx);
    const decalage = Math.round((debutPx - colonne * largeurPx) * 9525);
    dessins.push({ n: dessins.length + 1, colonne, decalage, ligne: f.ancre.ligne, cx: logo.cx, cy: logo.cy });
    f.dessin = dessins[dessins.length - 1];
  });
  const extImage = logo ? (logo.ext === "png" ? "png" : "jpeg") : "";
  const types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    (logo ? '<Default Extension="' + extImage + '" ContentType="image/' + extImage + '"/>' : "") +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    feuilles.map((f, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("") +
    dessins.map((d) => '<Override PartName="/xl/drawings/drawing' + d.n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>').join("") +
    "</Types>";
  const racine = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const classeur = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="16000" windowHeight="9000"/></bookViews><sheets>' +
    feuilles.map((f, i) => '<sheet name="' + ofEchap(f.nom) + '" sheetId="' + (i + 1) + '" r:id="rIdF' + (i + 1) + '"/>').join("") + "</sheets></workbook>";
  const relClasseur = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    feuilles.map((f, i) => '<Relationship Id="rIdF' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join("") +
    '<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0&quot; G&quot;"/><numFmt numFmtId="165" formatCode="#,##0.00&quot; USD&quot;"/></numFmts>' +
    '<fonts count="' + polices.length + '">' + polices.join("") + '</fonts><fills count="' + remplis.length + '">' + remplis.join("") + "</fills>" +
    '<borders count="' + bords.length + '">' + bords.join("") + "</borders>" +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="' + xfs.length + '">' + xfs.join("") + "</cellXfs>" +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  const fichiers = [
    { nom: "[Content_Types].xml", texte: types },
    { nom: "_rels/.rels", texte: racine },
    { nom: "xl/workbook.xml", texte: classeur },
    { nom: "xl/_rels/workbook.xml.rels", texte: relClasseur },
    { nom: "xl/styles.xml", texte: styles },
  ];
  feuilles.forEach((f, i) => {
    fichiers.push({ nom: "xl/worksheets/sheet" + (i + 1) + ".xml", texte: f.xml });
    if (!f.dessin) return;
    const d = f.dessin;
    fichiers.push({ nom: "xl/worksheets/_rels/sheet" + (i + 1) + ".xml.rels", texte: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDessin" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing' + d.n + '.xml"/></Relationships>' });
    fichiers.push({ nom: "xl/drawings/drawing" + d.n + ".xml", texte: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<xdr:oneCellAnchor><xdr:from><xdr:col>' + d.colonne + '</xdr:col><xdr:colOff>' + d.decalage + '</xdr:colOff><xdr:row>' + d.ligne + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="' + d.cx + '" cy="' + d.cy + '"/>' +
      '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="' + (d.n + 1) + '" name="Logo ' + d.n + '"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
      '<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
      '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + d.cx + '" cy="' + d.cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>' });
    fichiers.push({ nom: "xl/drawings/_rels/drawing" + d.n + ".xml.rels", texte: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.' + extImage + '"/></Relationships>' });
  });
  if (logo) fichiers.push({ nom: "xl/media/logo." + extImage, octets: logo.octets });
  return ofZip(fichiers);
}

// En-tête centré (devis) : logo, nom, coordonnées, titre éventuel
function officeEntreprise(settings, titre) {
  const s = settings || {};
  const b = [{ k: "logo" }, { k: "p", t: s.companyName || "Mon Entreprise", g: true, s: 15, al: "c", sp: 0 }];
  if (s.companyAddress) b.push({ k: "p", t: s.companyAddress, s: 9, al: "c", sp: 0 });
  if (s.companyPhone) b.push({ k: "p", t: s.companyPhone, s: 9, al: "c", sp: 0 });
  if (s.companyNIF) b.push({ k: "p", t: "NIF : " + s.companyNIF, s: 9, al: "c", sp: 0 });
  if (titre) b.push({ k: "p", t: titre, g: true, s: 13.5, al: "c", av: 160, sp: 200 });
  else b.push({ k: "espace", h: 1 });
  return b;
}

// En-tête à gauche (fiche ou facture) : nom, coordonnées sur une ligne, date d'édition à droite
function officeEntetePage(settings, dateEdition) {
  const s = settings || {};
  const detail = (s.companyAddress || "") + (s.companyPhone ? " · " + s.companyPhone : "") + (s.companyNIF ? " · NIF " + s.companyNIF : "");
  return [{ k: "entete", nom: s.companyName || "Mon Entreprise", detail, date: "Édité le " + (dateEdition || "") }]; // le logo fait partie de l'en-tête
}

// Logo de l'entreprise (data URL) : octets, format, dimensions d'affichage (boîte carrée en px). null si absent ou illisible.
function officeLogo(dataUrl, boite) {
  return new Promise((res) => {
    try {
      const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(String(dataUrl || ""));
      if (!m) return res(null);
      const ext = /png/i.test(m[1]) ? "png" : "jpeg";
      const bin = atob(m[2]);
      const octets = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || 1, h = img.naturalHeight || 1;
        const box = boite || 50;
        const k = Math.min(box / w, box / h);
        const wPx = Math.max(1, Math.round(w * k)), hPx = Math.max(1, Math.round(h * k));
        res({ octets, ext, wPx, hPx, cx: wPx * 9525, cy: hPx * 9525 });
      };
      img.onerror = () => res(null);
      img.src = dataUrl;
    } catch (e) { res(null); }
  });
}

// Remise du fichier au navigateur (téléchargement)
function officeTelecharger(nom, octets, type) {
  const blob = new Blob([octets], { type: type || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ═══ MODULE ═══
// @module Formatage impression et pdf
// @depends CURRENCIES, CURRENT_CURRENCY, todayStr
// @exports HEADER_RGB, MENTION_FRANCHISE_TCA, RecordedStamp, connectThermalPrinter
//   disconnectThermalPrinter, downloadEtatsFinanciersPDF, downloadInvoicePDF, downloadTablePDF
//   fmt, getRememberedPrinterName, isThermalPrinterConnected, nifLigne, pdfSafe
//   printInvoiceBluetooth, tauxFactureTexte
// ═══ FIN DE L'EN-TÊTE ═══
// Mentions fiscales de la facture (nouveau Code fiscal : identité du vendeur et NIF obligatoires ; entreprise en
// franchise de TCA : mention « TCA non applicable - article 193 du CGI »). Sources à confirmer dans le texte officiel.
const MENTION_FRANCHISE_TCA = "TCA non applicable - article 193 du CGI";
// Article 191 : la facture mentionne le taux de TCA appliqué. Déduit des lignes (montant de taxe / sous-total).
function tauxFactureTexte(inv) {
  const taux = new Set();
  (inv && inv.lines || []).forEach((l) => { const st = Number(l.subtotal) || 0; if (st > 0) taux.add(Math.round(((Number(l.taxAmount) || 0) / st) * 1000) / 10); });
  const t = [...taux];
  if (t.length === 0) return "";
  return t.length === 1 ? String(t[0]).replace(".", ",") + " %" : "taux variables";
}
function nifLigne(settings) { return settings && String(settings.companyNIF || "").trim() ? "NIF : " + String(settings.companyNIF).trim() : ""; }

const fmt = (n) => {
  const code = CURRENT_CURRENCY;
  const locale = CURRENCIES[code]?.locale || "fr-FR";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: code, maximumFractionDigits: 0 }).format(n || 0);
  } catch (e) {
    return `${Math.round(n || 0)} ${code}`;
  }
};

// Formate un horodatage ISO (createdAt) en "12/08/2026 à 14:32:07" (heure locale de
// l'appareil). Utilisé partout où on affiche à quel moment exact une opération a
// réellement été enregistrée dans le système — distinct de la "date" saisie par
// l'utilisateur, qui peut être antidatée ou postdatée volontairement.
const fmtTimestamp = (iso) => {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const datePart = d.toLocaleDateString("fr-FR");
    const timePart = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return `${datePart} à ${timePart}`;
  } catch (e) { return null; }
};

// Petit composant réutilisable : ligne discrète "Enregistré le ... à ..." affichée
// sous une ligne de tableau ou dans un panneau de détail, dans tous les modules.
const RecordedStamp = ({ createdAt }) => {
  const label = fmtTimestamp(createdAt);
  if (!label) return null;
  return <div className="text-xs mt-0.5" style={{ color: "#A39C87" }}>Enregistré le {label}</div>;
};

// --- Impression directe sur mini-imprimante thermique Bluetooth (ESC/POS via Web
// Bluetooth) ------------------------------------------------------------------
// Contrairement à window.print() (qui dépend de la boîte de dialogue d'impression
// du système, et donc d'une appli tierce type RawBT pour convertir en ESC/POS), le
// navigateur se connecte ici DIRECTEMENT à l'imprimante en Bluetooth Low Energy
// (API navigator.bluetooth) et lui envoie lui-même les commandes ESC/POS. Zéro
// appli à installer côté vendeur, une seule connexion à faire une fois par session.
//
// Limite connue : l'API Web Bluetooth n'existe que sur Chrome/Edge (desktop et
// Android) — pas sur Safari/iOS (restriction d'Apple, pas un manque côté Compta+).
//
// Les imprimantes thermiques chinoises bon marché (GOOJPRT, "Cat printer", etc.)
// exposent en général l'une de ces 3 paires service/caractéristique BLE pour
// recevoir des données en écriture — on essaie chacune dans l'ordre jusqu'à ce
// qu'une connexion réussisse, car ça varie selon le lot de fabrication même pour
// un modèle identique.
const BLE_PRINTER_CANDIDATES = [
  { service: "49535343-fe7d-4ae5-8fa9-9fafd205e455", write: "49535343-8841-43f4-a8d4-ecbe34729bb3" }, // ISSC Transparent UART (GOOJPRT PT-210 et clones)
  { service: "000018f0-0000-1000-8000-00805f9b34fb", write: "00002af1-0000-1000-8000-00805f9b34fb" },
  { service: "0000fee7-0000-1000-8000-00805f9b34fb", write: "0000fec7-0000-1000-8000-00805f9b34fb" },
];
const BLE_PRINTER_NAME_KEY = "comptaplus_bt_printer_name";
let _btPrinter = { device: null, characteristic: null };

function isThermalPrinterConnected() {
  return !!(_btPrinter.device && _btPrinter.device.gatt && _btPrinter.device.gatt.connected && _btPrinter.characteristic);
}
function getRememberedPrinterName() {
  try { return localStorage.getItem(BLE_PRINTER_NAME_KEY) || ""; } catch (e) { return ""; }
}

// Ouvre la fenêtre native de sélection Bluetooth du téléphone, se connecte, et
// trouve laquelle des paires service/caractéristique ci-dessus fonctionne sur
// l'appareil choisi. Doit être appelée depuis un clic direct de l'utilisateur
// (exigence du navigateur pour l'API Web Bluetooth, question de sécurité).
async function connectThermalPrinter() {
  if (!navigator.bluetooth) {
    throw new Error("Bluetooth non disponible sur ce navigateur. Utilisez Chrome sur Android (pas Safari/iPhone).");
  }
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: BLE_PRINTER_CANDIDATES.map((c) => c.service),
  });
  const server = await device.gatt.connect();
  let found = null;
  for (const candidate of BLE_PRINTER_CANDIDATES) {
    try {
      const service = await server.getPrimaryService(candidate.service);
      const characteristic = await service.getCharacteristic(candidate.write);
      found = characteristic;
      break;
    } catch (e) { /* ce candidat ne correspond pas à cet appareil, on essaie le suivant */ }
  }
  if (!found) {
    try { device.gatt.disconnect(); } catch (e) {}
    throw new Error("Imprimante connectée en Bluetooth, mais son protocole n'a pas été reconnu. Contactez le support avec le nom exact du modèle.");
  }
  device.addEventListener("gattserverdisconnected", () => {
    _btPrinter = { device: null, characteristic: null };
  });
  _btPrinter = { device, characteristic: found };
  try { localStorage.setItem(BLE_PRINTER_NAME_KEY, device.name || "Imprimante"); } catch (e) {}
  return device.name || "Imprimante";
}

function disconnectThermalPrinter() {
  try { if (_btPrinter.device && _btPrinter.device.gatt) _btPrinter.device.gatt.disconnect(); } catch (e) {}
  _btPrinter = { device: null, characteristic: null };
}

// Envoie les octets à l'imprimante par petits blocs — les caractéristiques BLE
// refusent les écritures trop volumineuses d'un coup (limite typique ~180-512
// octets selon l'appareil).
async function writeToThermalPrinter(bytes) {
  const chunkSize = 100;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    await _btPrinter.characteristic.writeValue(chunk);
  }
}

// Remplace chaque caractère accentué par son équivalent sans accent. En théorie,
// un encodage CP1252/Latin-1 correct devrait suffire (voir plus bas), mais dans la
// pratique, le firmware de certaines imprimantes bon marché (confirmé sur le
// GOOJPRT PT-210 en test réel) n'affiche pas ces caractères correctement, peu
// importe l'octet envoyé. Plutôt que parier sur un réglage de police propre à
// chaque modèle, on évite complètement le problème : le texte reste lisible sur
// n'importe quel matériel, au prix de l'accent.
const ACCENT_FOLD = { "à": "a", "â": "a", "ä": "a", "á": "a", "ã": "a", "å": "a", "À": "A", "Â": "A", "Ä": "A", "Á": "A",
  "é": "e", "è": "e", "ê": "e", "ë": "e", "É": "E", "È": "E", "Ê": "E", "Ë": "E",
  "î": "i", "ï": "i", "í": "i", "ì": "i", "Î": "I", "Ï": "I",
  "ô": "o", "ö": "o", "ó": "o", "ò": "o", "õ": "o", "Ô": "O", "Ö": "O",
  "û": "u", "ü": "u", "ú": "u", "ù": "u", "Û": "U", "Ü": "U",
  "ç": "c", "Ç": "C", "ñ": "n", "Ñ": "N", "œ": "oe", "Œ": "OE" };
function foldAccents(str) {
  return String(str ?? "").replace(/[àâäáãåÀÂÄÁéèêëÉÈÊËîïíìÎÏôöóòõÔÖûüúùÛÜçÇñÑœŒ]/g, (ch) => ACCENT_FOLD[ch] || ch);
}

// Encodage des caractères accentués français : la plupart de ces imprimantes ne
// comprennent pas l'UTF-8 (multi-octets) mais un jeu de caractères sur un seul
// octet (CP1252/Latin-1), où les lettres accentuées françaises (é, è, à, ç, ô...)
// occupent justement les mêmes codes qu'en Unicode ≤ 255. Quelques symboles
// spécifiques (œ, Œ, guillemets typographiques) sont mappés à la main car ils
// sortent de cette plage. Les accents sont malgré tout retirés au préalable (voir
// foldAccents ci-dessus) avant d'arriver ici, pour les imprimantes qui ignorent cet
// encodage — cette fonction reste utile pour les guillemets/tirets typographiques.
const CP1252_EXTRA = { "œ": 0x9c, "Œ": 0x8c, "€": 0x80, "’": 0x27, "‘": 0x27, "“": 0x22, "”": 0x22, "–": 0x2d, "—": 0x2d, "…": "...", "\u00A0": 0x20, "\u202F": 0x20 };
function escposTextToBytes(str) {
  const out = [];
  for (const ch of foldAccents(str)) {
    const mapped = CP1252_EXTRA[ch];
    if (typeof mapped === "string") { for (const c2 of mapped) out.push(c2.charCodeAt(0)); continue; }
    if (typeof mapped === "number") { out.push(mapped); continue; }
    const code = ch.charCodeAt(0);
    out.push(code <= 0xff ? code : 0x3f); // caractère non supporté -> "?"
  }
  return out;
}

// Découpe un texte en lignes ne dépassant pas `width` caractères, en coupant de
// préférence sur un espace plutôt qu'en plein milieu d'un mot.
function wrapPlain(str, width) {
  const words = String(str ?? "").split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? cur + " " + w : w;
    if (candidate.length > width) {
      if (cur) lines.push(cur);
      if (w.length > width) {
        // Le mot seul dépasse la largeur de la ligne (ex. une longue adresse
        // email) : on le découpe en plusieurs lignes complètes plutôt que de
        // couper silencieusement les derniers caractères (perdus autrement).
        let rest = w;
        while (rest.length > width) {
          lines.push(rest.slice(0, width));
          rest = rest.slice(width);
        }
        cur = rest;
      } else {
        cur = w;
      }
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
// Aligne deux morceaux de texte sur une même ligne (gauche + droite), avec des
// espaces au milieu — utilisé pour "qté x prix ... sous-total" et les totaux.
function twoCols(left, right, width) {
  left = String(left ?? ""); right = String(right ?? "");
  const space = Math.max(1, width - left.length - right.length);
  if (left.length + right.length >= width) {
    left = left.slice(0, Math.max(0, width - right.length - 1));
    return left + " " + right;
  }
  return left + " ".repeat(space) + right;
}

// Commandes ESC/POS de base
const ESC_INIT = [0x1b, 0x40];
const ESC_ALIGN = (n) => [0x1b, 0x61, n]; // 0 gauche, 1 centre, 2 droite
const ESC_BOLD = (on) => [0x1b, 0x45, on ? 1 : 0];
const ESC_FEED = (n) => [0x1b, 0x64, n];
const LF = [0x0a];

// Construit le ticket complet en octets ESC/POS prêts à envoyer à l'imprimante,
// à partir des mêmes données de facture que downloadInvoiceTicketPDF ci-dessous.
// charsPerLine=32 correspond à la largeur d'impression réelle du GOOJPRT PT-210
// (384 points / 12 points par caractère en police standard) — indépendant du
// réglage "Format d'impression" (A4/ticket80/58) qui, lui, ne concerne que le PDF
// et l'impression système.
function buildInvoiceEscPos(inv, settings, charsPerLine = 32) {
  const bytes = [];
  const push = (arr) => bytes.push(...arr);
  const line = (str = "") => { push(escposTextToBytes(str)); push(LF); };
  const dashLine = () => line("-".repeat(charsPerLine));

  push(ESC_INIT);
  push(ESC_ALIGN(1));
  push(ESC_BOLD(true));
  line(settings.companyName || "Mon Entreprise");
  push(ESC_BOLD(false));
  if (settings.companyAddress) wrapPlain(settings.companyAddress, charsPerLine).forEach(line);
  const contact = [settings.companyPhone, settings.companyEmail].filter(Boolean).join(" - ");
  if (contact) wrapPlain(contact, charsPerLine).forEach(line);
  if (nifLigne(settings)) line(nifLigne(settings));
  push(ESC_ALIGN(0));
  dashLine();

  line(`Facture N° ${inv.number}`);
  line(String(inv.date));
  line(`Client : ${inv.client || "Client comptant"}`);
  if (inv.soldByName) line(`Vendeur : ${inv.soldByName}`);
  dashLine();

  (inv.lines || []).forEach((l) => {
    wrapPlain(l.name, charsPerLine).forEach(line);
    line(twoCols(`${l.qty} x ${fmt(l.price)}`, fmt(l.subtotal), charsPerLine));
  });
  dashLine();

  line(twoCols("Sous-total HT", fmt(inv.totalHT), charsPerLine));
  if (inv.globalDiscountAmount > 0) line(twoCols("Remise", `-${fmt(inv.globalDiscountAmount)}`, charsPerLine));
  (inv.fees || []).forEach((f) => line(twoCols(f.label || "Frais", `+${fmt(f.amount)}`, charsPerLine)));
  line(twoCols(inv.taxLabel || "Taxe", fmt(inv.totalTax), charsPerLine));
  push(ESC_BOLD(true));
  line(twoCols("TOTAL", fmt(inv.total), charsPerLine));
  push(ESC_BOLD(false));
  dashLine();

  push(ESC_ALIGN(1));
  line(`Paiement : ${inv.paymentMode === "caisse" ? "Caisse" : inv.paymentMode === "banque" ? "Banque" : "Crédit"}`);
  if ((inv.payments || []).length > 0) {
    const paidTotal = inv.payments.reduce((s, p) => s + p.amount, 0);
    const balance = Math.max(0, (inv.total || 0) - paidTotal);
    line(`Versé : ${fmt(paidTotal)} - Solde dû : ${fmt(balance)}`);
  }
  if (settings.tcaFranchise) wrapPlain(MENTION_FRANCHISE_TCA, charsPerLine).forEach(line);
  line("Merci de votre confiance !");
  if (settings.invoiceFooterNote && settings.invoiceFooterNote.trim()) {
    wrapPlain(settings.invoiceFooterNote.trim(), charsPerLine).forEach(line);
  }
  push(ESC_FEED(4)); // marge pour la déchirure manuelle du papier (pas de massicot sur le PT-210)
  return new Uint8Array(bytes);
}

// Point d'entrée appelé depuis les boutons "Imprimer (Bluetooth)" — se connecte
// automatiquement si aucune imprimante n'est déjà attachée à cette session.
async function printInvoiceBluetooth(inv, settings, showToast) {
  try {
    if (!isThermalPrinterConnected()) {
      showToast && showToast("Choisissez l'imprimante dans la liste Bluetooth…");
      await connectThermalPrinter();
    }
    const bytes = buildInvoiceEscPos(inv, settings);
    await writeToThermalPrinter(bytes);
    showToast && showToast("Ticket envoyé à l'imprimante.");
  } catch (e) {
    showToast && showToast("Impression Bluetooth impossible. Vérifiez que l\'imprimante est allumée et à portée, puis réessayez.");
  }
}

// --- Génération de vrais fichiers PDF téléchargeables (jsPDF, chargé via CDN dans
// index.html) — déclenche un téléchargement direct du fichier, contrairement à
// window.print() qui dépend de la boîte de dialogue d'impression du système et se
// révèle peu fiable pour "Enregistrer en PDF" sur certains navigateurs mobiles
// (Android/iOS). Utilisé pour les factures et les rapports comptables.
const HEADER_RGB = [21, 34, 56];

// jsPDF utilise les polices PDF standards (Helvetica/Times/Courier), qui ne
// contiennent pas le caractère d'espace fine insécable qu'utilise Intl.NumberFormat
// (fmt()) comme séparateur de milliers en français — ce caractère s'affiche alors
// comme un symbole de remplacement (souvent une barre oblique visible dans le PDF)
// au lieu d'un simple espace. On le remplace par une espace normale uniquement au
// moment d'écrire dans le PDF — l'affichage à l'écran, lui, n'a jamais ce problème
// (les polices web gèrent ce caractère correctement) et reste inchangé.
const pdfSafe = (s) => String(s ?? "").replace(/[\u00A0\u202F\u2000-\u200B\u2007\u2009]/g, " ");

// Génère un PDF en format ticket étroit (58 ou 80 mm), mise en page condensée dédiée
// — pas simplement le PDF A4 rétréci. Une seule colonne, texte centré pour l'en-tête,
// séparateurs en pointillés, adapté à l'impression sur mini-imprimante (via pilote
// système standard — voir note dans l'interface pour les limites de ce mécanisme).
function downloadInvoiceTicketPDF(inv, settings, widthMm) {
  if (!window.jspdf) { alert("Le générateur de PDF n'a pas fini de charger — réessayez dans quelques secondes."); return; }
  const { jsPDF } = window.jspdf;
  const lineCount = (inv.lines || []).length;
  const estHeight = 60 + lineCount * 10 + (inv.fees || []).length * 5;
  const doc = new jsPDF({ unit: "mm", format: [widthMm, Math.max(80, estHeight)] });
  const cx = widthMm / 2;
  const margin = 3;
  const innerW = widthMm - margin * 2;
  let y = 5;
  const dashLine = () => { doc.setLineDashPattern([0.5, 0.5], 0); doc.line(margin, y, widthMm - margin, y); doc.setLineDashPattern([], 0); y += 4; };

  if (settings.companyLogo) {
    try { doc.addImage(settings.companyLogo, "JPEG", cx - 6, y, 12, 12); y += 14; } catch (e) {}
  }
  doc.setFontSize(10);
  doc.text(pdfSafe(settings.companyName || "Mon Entreprise"), cx, y, { align: "center" }); y += 4;
  doc.setFontSize(7);
  if (settings.companyAddress) { doc.text(pdfSafe(settings.companyAddress), cx, y, { align: "center" }); y += 3.5; }
  const contact = [settings.companyPhone, settings.companyEmail].filter(Boolean).join(" · ");
  if (contact) { doc.text(pdfSafe(contact), cx, y, { align: "center" }); y += 3.5; }
  if (nifLigne(settings)) { doc.text(pdfSafe(nifLigne(settings)), cx, y, { align: "center" }); y += 3.5; }
  y += 1;
  dashLine();

  doc.setFontSize(8);
  doc.text(pdfSafe(`Facture N° ${inv.number}`), margin, y); y += 4;
  doc.text(pdfSafe(String(inv.date)), margin, y); y += 4;
  doc.text(pdfSafe(`Client : ${inv.client || "Client comptant"}`), margin, y); y += 4;
  if (inv.soldByName) { doc.text(pdfSafe(`Vendeur : ${inv.soldByName}`), margin, y); y += 4; }
  dashLine();

  doc.setFontSize(7);
  (inv.lines || []).forEach((l) => {
    doc.text(pdfSafe(l.name), margin, y); y += 3.2;
    doc.text(pdfSafe(`${l.qty} x ${fmt(l.price)}`), margin, y);
    doc.text(pdfSafe(fmt(l.subtotal)), widthMm - margin, y, { align: "right" });
    y += 4;
  });
  dashLine();

  doc.setFontSize(7.5);
  doc.text("Sous-total HT", margin, y); doc.text(pdfSafe(fmt(inv.totalHT)), widthMm - margin, y, { align: "right" }); y += 4;
  if (inv.globalDiscountAmount > 0) {
    doc.text("Remise", margin, y); doc.text(pdfSafe(`-${fmt(inv.globalDiscountAmount)}`), widthMm - margin, y, { align: "right" }); y += 4;
  }
  (inv.fees || []).forEach((f) => {
    doc.text(pdfSafe(f.label || "Frais"), margin, y); doc.text(pdfSafe(`+${fmt(f.amount)}`), widthMm - margin, y, { align: "right" }); y += 4;
  });
  doc.text(pdfSafe(inv.taxLabel || "Taxe"), margin, y); doc.text(pdfSafe(fmt(inv.totalTax)), widthMm - margin, y, { align: "right" }); y += 5;
  doc.setFontSize(9);
  doc.text("TOTAL", margin, y); doc.text(pdfSafe(fmt(inv.total)), widthMm - margin, y, { align: "right" }); y += 5;
  dashLine();

  doc.setFontSize(7);
  doc.text(pdfSafe(`Paiement : ${inv.paymentMode === "caisse" ? "Caisse" : inv.paymentMode === "banque" ? "Banque" : "Crédit"}`), cx, y, { align: "center" }); y += 4;
  if ((inv.payments || []).length > 0) {
    const paidTotal = inv.payments.reduce((s, p) => s + p.amount, 0);
    const balance = Math.max(0, (inv.total || 0) - paidTotal);
    doc.text(pdfSafe(`Versé : ${fmt(paidTotal)} — Solde dû : ${fmt(balance)}`), cx, y, { align: "center" }); y += 4;
  }
  if (settings.tcaFranchise) { doc.text(pdfSafe(MENTION_FRANCHISE_TCA), cx, y, { align: "center" }); y += 4; }
  doc.text("Merci de votre confiance !", cx, y, { align: "center" });
  if (settings.invoiceFooterNote && settings.invoiceFooterNote.trim()) {
    y += 5;
    const noteLines = doc.splitTextToSize(pdfSafe(settings.invoiceFooterNote.trim()), widthMm - margin * 2);
    noteLines.forEach((line) => { doc.text(line, cx, y, { align: "center" }); y += 3.2; });
  }

  doc.save(`Facture-${inv.number}-ticket.pdf`);
}

function downloadInvoicePDF(inv, settings) {
  if (settings.receiptFormat === "ticket80") return downloadInvoiceTicketPDF(inv, settings, 80);
  if (settings.receiptFormat === "ticket58") return downloadInvoiceTicketPDF(inv, settings, 58);
  if (!window.jspdf) { alert("Le générateur de PDF n'a pas fini de charger — réessayez dans quelques secondes."); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const pageRight = 196; // marge droite (A4, 210mm de large moins ~14mm de marge)
  // Logo en en-tête (n'échoue jamais le PDF si l'image est invalide/corrompue — la
  // génération continue sans logo dans ce cas).
  let headerX = 14;
  if (settings.companyLogo) {
    try { doc.addImage(settings.companyLogo, "JPEG", 14, 10, 18, 18); headerX = 36; } catch (e) {}
  }
  doc.setFontSize(16);
  doc.text(pdfSafe(settings.companyName || "Mon Entreprise"), headerX, 18);
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  let y = 24;
  if (settings.companyAddress) { doc.text(pdfSafe(settings.companyAddress), headerX, y); y += 5; }
  const contact = [settings.companyPhone, settings.companyEmail].filter(Boolean).join("  ·  ");
  if (contact) { doc.text(pdfSafe(contact), headerX, y); y += 5; }
  if (nifLigne(settings)) { doc.text(pdfSafe(nifLigne(settings)), headerX, y); y += 5; }
  // Bloc "FACTURE / N° / date" aligné à droite sur la marge de page (pas seulement
  // aligné à gauche sur un même point de départ) — évite l'effet "en escalier" que
  // donnaient des lignes de largeurs différentes toutes démarrées au même endroit.
  doc.setTextColor(21, 34, 56);
  doc.setFontSize(14);
  doc.text("FACTURE", pageRight, 18, { align: "right" });
  doc.setFontSize(10);
  doc.text(pdfSafe(`N° ${inv.number}`), pageRight, 25, { align: "right" });
  doc.text(pdfSafe(String(inv.date)), pageRight, 30, { align: "right" });
  // Séparateur horizontal sous tout l'en-tête, pour la même clarté visuelle que la
  // version imprimée depuis l'écran (bordure sous l'en-tête).
  const headerBottom = Math.max(y + 4, settings.companyLogo ? 32 : 24);
  doc.setDrawColor(21, 34, 56);
  doc.setLineWidth(0.6);
  doc.line(14, headerBottom, pageRight, headerBottom);
  doc.setTextColor(21, 34, 56);
  doc.setFontSize(10);
  doc.text(pdfSafe(`Client : ${inv.client || "Client comptant"}`), 14, headerBottom + 8);
  doc.autoTable({
    startY: headerBottom + 14,
    head: [["Article", "Qté", "Prix unit.", "Remise", "Sous-total HT", inv.taxLabel || "Taxe"]],
    body: (inv.lines || []).map((l) => [
      l.name, String(l.qty), fmt(l.price),
      l.discountAmt > 0 ? `-${fmt(l.discountAmt)}` : l.discountPct > 0 ? `-${l.discountPct}%` : "—",
      fmt(l.subtotal), fmt(l.taxAmount),
    ].map(pdfSafe)),
    styles: { fontSize: 9 },
    headStyles: { fillColor: HEADER_RGB },
  });
  let ty = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(10);
  doc.text(pdfSafe(`Sous-total HT : ${fmt(inv.totalHT)}`), 130, ty); ty += 6;
  if (inv.globalDiscountAmount > 0) { doc.text(pdfSafe(`Remise globale : -${fmt(inv.globalDiscountAmount)}`), 130, ty); ty += 6; }
  (inv.fees || []).forEach((f) => { doc.text(pdfSafe(`${f.label || "Frais"} : +${fmt(f.amount)}`), 130, ty); ty += 6; });
  doc.text(pdfSafe(`${inv.taxLabel || "Taxe"}${tauxFactureTexte(inv) ? " (" + tauxFactureTexte(inv) + ")" : ""} : ${fmt(inv.totalTax)}`), 130, ty); ty += 8;
  doc.setFontSize(12);
  doc.text(pdfSafe(`Total : ${fmt(inv.total)}`), 130, ty); ty += 10;
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(pdfSafe(`Mode de paiement : ${inv.paymentMode === "caisse" ? "Caisse" : inv.paymentMode === "banque" ? "Banque" : inv.paymentMode === "don" ? "Don" : "Crédit"}`), 14, ty);
  if ((inv.payments || []).length > 0) {
    ty += 5;
    const paidTotal = inv.payments.reduce((s, p) => s + p.amount, 0);
    const balance = Math.max(0, (inv.total || 0) - paidTotal);
    doc.text(pdfSafe(`Versé : ${fmt(paidTotal)} — Solde dû : ${fmt(balance)}`), 14, ty);
  }
  if (settings.invoiceFooterNote && settings.invoiceFooterNote.trim()) {
    ty += 8;
    const noteLines = doc.splitTextToSize(pdfSafe(settings.invoiceFooterNote.trim()), 180);
    noteLines.forEach((line) => { doc.text(line, 14, ty); ty += 4.5; });
  }
  if (settings.tcaFranchise) { ty += 8; doc.setFontSize(9); doc.setTextColor(90, 90, 90); doc.text(pdfSafe(MENTION_FRANCHISE_TCA), 14, ty); }
  // Article 191 : visa de l'entreprise et signature d'une personne habilitée.
  if (ty > 262) { doc.addPage(); ty = 20; }
  ty += 14; doc.setFontSize(9); doc.setTextColor(90, 90, 90);
  doc.text(pdfSafe("Visa de l'entreprise et signature :"), 130, ty);
  doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.3); doc.rect(130, ty + 2, 66, 22);
  doc.save(`Facture-${inv.number}.pdf`);
}

// Document combiné "États financiers" — compte de résultat, bilan et annexes en
// un seul PDF téléchargeable, plutôt que trois exports séparés. Les annexes sont
// un résumé auto-généré des méthodes et provisions en cours (pas un éditeur de
// notes libres) : suffisant pour donner une image fidèle sans construire un tout
// nouveau système de rédaction de texte.
function downloadEtatsFinanciersPDF({ settings, produitsAccounts, chargesAccounts, totalProduits, totalCharges, resultat, actifAccounts, passifAccounts, capitauxAccounts, totalActif, totalPassif, notes }) {
  if (!window.jspdf) { alert("Le générateur de PDF n'a pas fini de charger — réessayez dans quelques secondes."); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let headerX = 14;
  if (settings.companyLogo) {
    try { doc.addImage(settings.companyLogo, "JPEG", 14, 8, 16, 16); headerX = 34; } catch (e) {}
  }
  let y = 16;
  doc.setFontSize(16);
  doc.text(pdfSafe(settings.companyName || "Mon Entreprise"), headerX, y); y += 7;
  if (settings.companyAddress) { doc.setFontSize(9); doc.setTextColor(90, 90, 90); doc.text(pdfSafe(settings.companyAddress), headerX, y); doc.setTextColor(0, 0, 0); y += 6; }
  doc.setFontSize(13);
  doc.text("États financiers", headerX, y + 2); y += 9;
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(`Généré le ${todayStr()}`, 14, y);
  doc.setTextColor(0, 0, 0);
  y += 8;

  doc.setFontSize(12);
  doc.text("Compte de résultat", 14, y); y += 2;
  doc.autoTable({
    startY: y + 4,
    head: [["Compte", "Libellé", "Solde"]],
    body: [
      ...produitsAccounts.filter((a) => a.solde !== 0).map((a) => [a.code, a.name, fmt(a.solde)]),
      ["", "Total produits", fmt(totalProduits)],
      ...chargesAccounts.filter((a) => a.solde !== 0).map((a) => [a.code, a.name, fmt(a.solde)]),
      ["", "Total charges", fmt(totalCharges)],
      ["", "Résultat de l'exercice", fmt(resultat)],
    ].map((r) => r.map(pdfSafe)),
    styles: { fontSize: 8 },
    headStyles: { fillColor: HEADER_RGB },
  });
  y = doc.lastAutoTable.finalY + 10;

  if (y > 230) { doc.addPage(); y = 20; }
  doc.setFontSize(12);
  doc.text("Bilan simplifié", 14, y); y += 2;
  doc.autoTable({
    startY: y + 4,
    head: [["Compte", "Libellé", "Solde"]],
    body: [
      ...actifAccounts.filter((a) => a.solde !== 0).map((a) => [a.code, a.name, fmt(a.solde)]),
      ["", "Total Actif", fmt(totalActif)],
      ...passifAccounts.filter((a) => a.solde !== 0).map((a) => [a.code, a.name, fmt(a.solde)]),
      ...capitauxAccounts.filter((a) => a.solde !== 0).map((a) => [a.code, a.name, fmt(a.solde)]),
      ["", "Résultat de l'exercice", fmt(resultat)],
      ["", "Total Passif", fmt(totalPassif)],
    ].map((r) => r.map(pdfSafe)),
    styles: { fontSize: 8 },
    headStyles: { fillColor: HEADER_RGB },
  });
  y = doc.lastAutoTable.finalY + 10;

  if (y > 230) { doc.addPage(); y = 20; }
  doc.setFontSize(12);
  doc.text("Annexes", 14, y); y += 8;
  doc.setFontSize(9);
  notes.forEach((line) => {
    const wrapped = doc.splitTextToSize(pdfSafe(`• ${line}`), 180);
    wrapped.forEach((wl) => {
      if (y > 280) { doc.addPage(); y = 20; }
      doc.text(wl, 14, y); y += 5.5;
    });
  });

  doc.save(`Etats-financiers-${todayStr()}.pdf`);
}

function downloadTablePDF({ title, settings, columns, rows, footerLines }) {
  if (!window.jspdf) { alert("Le générateur de PDF n'a pas fini de charger — réessayez dans quelques secondes."); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let headerX = 14;
  if (settings.companyLogo) {
    try { doc.addImage(settings.companyLogo, "JPEG", 14, 8, 16, 16); headerX = 34; } catch (e) {}
  }
  let y = 16;
  doc.setFontSize(14);
  doc.text(pdfSafe(settings.companyName || "Mon Entreprise"), headerX, y); y += 6;
  if (settings.companyAddress) { doc.setFontSize(9); doc.setTextColor(90, 90, 90); doc.text(pdfSafe(settings.companyAddress), headerX, y); doc.setTextColor(0, 0, 0); y += 6; }
  doc.setFontSize(12);
  doc.text(pdfSafe(title), headerX, y + 2); y += 8;
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(`Généré le ${todayStr()}`, 14, y);
  doc.setTextColor(0, 0, 0);
  doc.autoTable({
    startY: y + 5,
    head: [columns.map(pdfSafe)],
    body: rows.map((r) => r.map(pdfSafe)),
    styles: { fontSize: 9 },
    headStyles: { fillColor: HEADER_RGB },
  });
  if (footerLines && footerLines.length) {
    let fy = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(10);
    footerLines.forEach((line) => { doc.text(pdfSafe(line), 14, fy); fy += 6; });
  }
  doc.save(`${title.replace(/\s+/g, "-")}-${todayStr()}.pdf`);
}


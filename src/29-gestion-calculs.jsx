// ═══ MODULE ═══
// @module Gestion calculs
// @depends X, pjStep, supabase, uid
// @exports BZ_ACCOUNTS, BZ_ATT_MAX_COUNT, BZ_ST_BUCKET, BZ_ST_MAX_COUNT, BZ_ST_TOTAL, bzAddDays, bzAging
//   bzAlerts, bzApplyCreditToInvoice, bzBudgetActuals, bzBuildCreditInvoice, bzCalcLines
//   bzCreditNoteEntry, bzDepositLeft, bzDiffDays, bzExcelRead, bzFixDate, bzForecast, bzInvBalance
//   bzInventoryDiff, bzInvoiceText, bzIsStored, bzMatchBank, bzNextNumber, bzNextRecurring
//   bzNoAccent, bzNum, bzOpenAttachment, bzOpenInvoices, bzParseCSV, bzParseCSVDetailed
//   bzPayables, bzR, bzReadText, bzReceivables, bzReceivePO, bzRecurringDates, bzRemoveStored
//   bzStockShortage, bzStoreAttachment, bzSupplierReturnEntry
// ═══ FIN DE L'EN-TÊTE ═══
// ── Grand livre ───────────────────────────────────────────────────────────
// Pour UN compte : solde d'ouverture (tout ce qui précède "from"), lignes de la période
// triées par date puis ordre de saisie, avec solde progressif (débit − crédit).
// ============================================================================
// Gestion avancée — phases 2 à 9 : logique PURE (testable hors interface).
// Toutes les données sont stockées dans la catégorie "bizdocs" (tableau de
// documents typés : quote, proforma, po, creditnote, supplierreturn, deposit,
// expense, inventory, recurring, project, time, budget, attachment).
// ============================================================================
const BZ_ACCOUNTS = [
  { code: "658", name: "Pertes sur stocks (péremption, casse)", type: "Charge" },
  { code: "419", name: "Clients — Avances et acomptes reçus", type: "Passif" },
  { code: "421", name: "Personnel — Rémunérations dues (notes de frais)", type: "Passif" },
  { code: "409", name: "Fournisseurs débiteurs (avoirs à recevoir)", type: "Actif" },
];
const BZ_PREFIX = { quote: "DV", proforma: "PF", po: "BC", creditnote: "AV", supplierreturn: "RF", deposit: "AC", expense: "NF", inventory: "INV", recurring: "ABN", project: "PRJ" };
const bzR = (n) => Math.round((Number(n) || 0) * 100) / 100;

function bzParseDate(d) { const [y, m, j] = String(d).split("-").map(Number); return Date.UTC(y, (m || 1) - 1, j || 1); }
function bzAddDays(d, n) { const t = new Date(bzParseDate(d) + n * 86400000); return t.toISOString().slice(0, 10); }
function bzDiffDays(a, b) { return Math.round((bzParseDate(a) - bzParseDate(b)) / 86400000); }
function bzAddMonths(d, n) {
  const [y, m, j] = String(d).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(j, last));
  return t.toISOString().slice(0, 10);
}

function bzNextNumber(docs, type) {
  const prefix = BZ_PREFIX[type] || "DOC";
  let max = 0;
  for (const d of docs || []) {
    if (d.type !== type || !d.number) continue;
    const n = parseInt(String(d.number).replace(/\D/g, ""), 10);
    if (n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

// Calcule les lignes d'un document (devis, facture récurrente...) comme le fait la vente.
function bzCalcLines(rawLines, products, taxActive) {
  const lines = (rawLines || []).map((l) => {
    const p = l.productId != null && l.productId !== "" ? (products || []).find((x) => String(x.id) === String(l.productId)) : null;
    const qty = Number(l.qty) || 0;
    const price = l.price !== undefined && l.price !== "" ? Number(l.price) : (p ? Number(p.price) : 0);
    const subtotal = bzR(qty * price);
    const tva = p ? Number(p.tva) || 0 : Number(l.tva) || 0;
    const taxAmount = taxActive ? bzR(subtotal * tva / 100) : 0;
    return { productId: p ? p.id : null, name: p ? p.name : (l.name || l.desc || "Prestation"), qty, price, discountPct: 0, discountAmt: 0, subtotal, tva, taxAmount, type: p ? p.type : "service", account: p ? p.account : (l.account || "706") };
  }).filter((l) => l.qty > 0);
  const totalHT = bzR(lines.reduce((s, l) => s + l.subtotal, 0));
  const totalTax = bzR(lines.reduce((s, l) => s + l.taxAmount, 0));
  return { lines, totalHT, totalTax, total: bzR(totalHT + totalTax) };
}

// Construit une facture À CRÉDIT + son écriture de vente (+ sortie de stock) — même schéma que la vente.
function bzBuildCreditInvoice({ id, number, date, client, calc, products, settings, taxLabel, source, dueDate }) {
  const byAcc = {};
  const stockLines = [];
  let cogs = 0;
  for (const l of calc.lines) {
    const acc = l.account || (l.type === "marchandise" ? "707" : "706");
    byAcc[acc] = bzR((byAcc[acc] || 0) + l.subtotal);
    if (l.type === "marchandise" && l.productId != null) {
      const p = products.find((x) => x.id === l.productId);
      stockLines.push({ productId: l.productId, qty: l.qty, name: l.name });
      cogs += l.qty * (Number(p?.costPrice) || 0);
    }
  }
  const invoice = {
    id, number, date, createdAt: new Date().toISOString(), client,
    lines: calc.lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, price: l.price, discountPct: 0, discountAmt: 0, subtotal: l.subtotal, tva: l.tva, taxAmount: l.taxAmount })),
    globalDiscountPct: 0, globalDiscountAmtInput: 0, globalDiscountAmount: 0, fees: [],
    totalHT: calc.totalHT, totalTax: calc.totalTax, taxLabel: taxLabel || "Taxe", total: calc.total,
    paymentMode: "credit", status: "impayée", payments: [], stationId: null, stationName: null, soldByName: null, soldByEmail: null,
    source: source || null,
  };
  if (dueDate) invoice.dueDate = dueDate;
  const lines = [{ account: "411", debit: calc.total, credit: 0 }, ...Object.entries(byAcc).map(([account, amount]) => ({ account, debit: 0, credit: amount }))];
  if (calc.totalTax > 0) lines.push({ account: settings.taxAccount || "445", debit: 0, credit: calc.totalTax });
  const saleEntry = { id: id + 1, invoiceId: id, date, createdAt: new Date().toISOString(), label: `Vente ${number} — ${client}`, lines };
  let cogsEntry = null;
  if (settings.stockValuationMethod === "actif" && cogs > 0) {
    cogsEntry = { id: id + 2, invoiceId: id, date, createdAt: new Date().toISOString(), label: `Sortie de stock — Vente ${number}`, kind: "cogs", lines: [{ account: "6037", debit: bzR(cogs), credit: 0 }, { account: "370", debit: 0, credit: bzR(cogs) }] };
  }
  const movements = stockLines.map((s, i) => ({ id: id + 3 + i, invoiceId: id, date, createdAt: new Date().toISOString(), productId: s.productId, productName: s.name, type: "sortie", qty: s.qty, reason: `Vente ${number}` }));
  return { invoice, saleEntry, cogsEntry, stockLines, movements };
}

function bzStockShortage(stockLines, products) {
  const out = [];
  for (const s of stockLines) {
    const p = products.find((x) => x.id === s.productId);
    const have = Number(p?.stock) || 0;
    if (have < s.qty) out.push({ name: s.name, have, need: s.qty });
  }
  return out;
}

// ----- Phase 2 : échéances / balance âgée / alertes -----
const bzOpenInvoices = (invoices) => (invoices || []).filter((i) => !["payée", "don", "annulée", "perte"].includes(i.status) && bzR((i.total || 0) - (i.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0)) > 0);
const bzInvDue = (inv, settings) => inv.dueDate || bzAddDays(inv.date, Number(settings?.paymentTermsDays ?? 30));
const bzPurDue = (p, settings) => p.dueDate || bzAddDays(p.date, Number(settings?.supplierTermsDays ?? 30));
// Une facture réglée comptant (caisse/banque) n'a pas de tableau payments : statut « payée » = rien à devoir.
const bzInvBalance = (inv) => (inv.status === "payée" || inv.status === "don" || inv.status === "annulée" ? 0 : Math.max(0, bzR((inv.total || 0) - (inv.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0))));

function bzAging(items, today) {
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
  const byParty = {};
  const rows = items.map((it) => {
    const late = bzDiffDays(today, it.due);
    const key = late <= 0 ? "current" : late <= 30 ? "d30" : late <= 60 ? "d60" : late <= 90 ? "d90" : "over90";
    buckets[key] = bzR(buckets[key] + it.amount);
    byParty[it.party] = byParty[it.party] || { party: it.party, current: 0, d30: 0, d60: 0, d90: 0, over90: 0, total: 0 };
    byParty[it.party][key] = bzR(byParty[it.party][key] + it.amount);
    byParty[it.party].total = bzR(byParty[it.party].total + it.amount);
    return { ...it, late: Math.max(0, late), bucket: key };
  });
  return { buckets, total: bzR(Object.values(buckets).reduce((a, b) => a + b, 0)), parties: Object.values(byParty).sort((a, b) => b.total - a.total), rows: rows.sort((a, b) => b.late - a.late) };
}
function bzReceivables(invoices, settings) {
  return bzOpenInvoices(invoices).map((i) => ({ ref: i.number || "—", id: i.id, party: i.client || "Client", date: i.date, due: bzInvDue(i, settings), amount: bzInvBalance(i) }));
}
function bzPayables(purchases, settings) {
  return (purchases || []).filter((p) => p.status === "à payer").map((p) => ({ ref: p.label || "Achat", id: p.id, party: p.supplier || "Fournisseur", date: p.date, due: bzPurDue(p, settings), amount: bzR(p.amount) }));
}
function bzAlerts({ invoices, purchases, bizdocs, settings, today }) {
  const rec = bzReceivables(invoices, settings), pay = bzPayables(purchases, settings);
  const overdueRec = rec.filter((r) => r.due < today), overduePay = pay.filter((r) => r.due < today);
  const soonPay = pay.filter((r) => r.due >= today && bzDiffDays(r.due, today) <= 7);
  const soonRec = rec.filter((r) => r.due >= today && bzDiffDays(r.due, today) <= 7);
  const sum = (a) => bzR(a.reduce((s, r) => s + r.amount, 0));
  const recurringDue = (bizdocs || []).filter((d) => d.type === "recurring" && d.active !== false && d.nextDate && d.nextDate <= today).length;
  const quotesExpiring = (bizdocs || []).filter((d) => (d.type === "quote" || d.type === "proforma") && d.status === "envoyé" && d.validUntil && d.validUntil < today).length;
  return { overdueRec: { n: overdueRec.length, amount: sum(overdueRec) }, overduePay: { n: overduePay.length, amount: sum(overduePay) }, soonPay: { n: soonPay.length, amount: sum(soonPay) }, soonRec: { n: soonRec.length, amount: sum(soonRec) }, recurringDue, quotesExpiring, total: overdueRec.length + overduePay.length + soonPay.length + recurringDue + quotesExpiring };
}

// ----- Phase 3 : avoirs clients -----
// Écriture d'avoir : contrepasse au prorata les comptes de produit et la taxe de la vente d'origine.
function bzCreditNoteEntry({ invoice, entries, amount, date, number, id }) {
  const total = Number(invoice.total) || 0;
  const ratio = total > 0 ? Math.min(1, amount / total) : 0;
  const sale = (entries || []).find((e) => e.invoiceId === invoice.id && !e.kind && /^Vente /.test(e.label || "") && !e.cancelled) || (entries || []).find((e) => e.invoiceId === invoice.id && !e.kind);
  const lines = [];
  if (sale) {
    const credits = sale.lines.filter((l) => l.credit > 0);
    let acc = 0;
    credits.forEach((l, i) => {
      const v = i === credits.length - 1 ? bzR(amount - acc) : bzR(l.credit * ratio);
      acc = bzR(acc + v);
      lines.push({ account: l.account, debit: v, credit: 0 });
    });
  } else {
    lines.push({ account: "706", debit: amount, credit: 0 });
  }
  lines.push({ account: "411", debit: 0, credit: amount });
  return { id, date, createdAt: new Date().toISOString(), label: `Avoir ${number} — ${invoice.number || ""} — ${invoice.client}`, creditNoteId: id, lines };
}
function bzApplyCreditToInvoice(invoice, amount, cnId, date) {
  const due = bzInvBalance(invoice);
  const applied = bzR(Math.min(due, amount));
  if (applied <= 0) return { invoice, applied: 0 };
  const payments = [...(invoice.payments || []), { id: cnId + 1, date, createdAt: new Date().toISOString(), amount: applied, account: "avoir", creditNoteId: cnId }];
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  return { invoice: { ...invoice, payments, status: paid >= invoice.total - 0.005 ? "payée" : "partielle" }, applied };
}

// ----- Phase 4 : bons de commande reçus -----
function bzReceivePO(po, { suppliers, products, date, paymentMode, settings, accounts }) {
  const lines = (po.lines || []).filter((l) => Number(l.qty) > 0);
  const amount = bzR(lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitCost), 0));
  const purchaseId = Date.now() * 1000 + 777;
  const supplier = po.supplierName || "Fournisseur";
  const payAccount = paymentMode === "caisse" ? "530" : paymentMode === "banque" ? "512" : "401";
  const entry = { id: purchaseId, date, createdAt: new Date().toISOString(), label: `Achat — Réception ${po.number} (${supplier})`, lines: [{ account: (settings && settings.stockValuationMethod === "actif") ? "370" : "607", debit: amount, credit: 0 }, { account: payAccount, debit: 0, credit: amount }] };
  const purchase = { id: purchaseId, date, createdAt: new Date().toISOString(), supplier, label: `Réception ${po.number}`, amount, paymentMode, status: paymentMode === "credit" ? "à payer" : "payé", lines: lines.map((l) => ({ productId: l.productId, qty: Number(l.qty), unitCost: Number(l.unitCost) })), poId: po.id };
  const movements = lines.map((l, i) => { const p = products.find((x) => String(x.id) === String(l.productId)); return { id: purchaseId + 1 + i, date, createdAt: new Date().toISOString(), productId: p ? p.id : l.productId, productName: p?.name || "", type: "entree", qty: Number(l.qty), reason: `Achat — Réception ${po.number} (${supplier})` }; });
  const nextProducts = products.map((p) => {
    const l = lines.find((x) => String(x.productId) === String(p.id));
    if (!l) return p;
    const qty = Number(l.qty), unitCost = Number(l.unitCost), oldStock = Number(p.stock) || 0, oldCost = Number(p.costPrice) || 0, ns = oldStock + qty;
    return { ...p, stock: ns, costPrice: ns > 0 && oldStock > 0 ? (oldStock * oldCost + qty * unitCost) / ns : unitCost };
  });
  return { amount, entry, purchase, movements, nextProducts };
}

// ----- Phase 3 bis : retours fournisseurs -----
function bzSupplierReturnEntry({ purchase, entries, amount, date, number, id }) {
  const orig = (entries || []).find((e) => e.id === purchase.id);
  const chargeAcc = orig ? (orig.lines.find((l) => l.debit > 0)?.account || "607") : "607";
  return { id, date, createdAt: new Date().toISOString(), label: `Retour fournisseur ${number} — ${purchase.label} (${purchase.supplier})`, supplierReturnId: id, lines: [{ account: "409", debit: amount, credit: 0 }, { account: chargeAcc, debit: 0, credit: amount }] };
}

// ----- Phase 5 : acomptes -----
const bzDepositLeft = (d) => bzR((d.amount || 0) - (d.applied || 0) - (d.refunded || 0));

// ----- Phase 6 : inventaire -----
function bzInventoryDiff(session, products) {
  return session.lines.filter((l) => l.counted !== "" && l.counted != null && !isNaN(Number(l.counted))).map((l) => {
    const p = products.find((x) => x.id === l.productId);
    const current = Number(p?.stock) || 0;
    const counted = Number(l.counted);
    return { productId: l.productId, name: l.name, current, counted, variance: counted - current, cost: Number(p?.costPrice) || 0 };
  });
}

// ----- Phase 7 : récurrence -----
function bzNextRecurring(date, freq) {
  if (freq === "hebdomadaire") return bzAddDays(date, 7);
  if (freq === "trimestrielle") return bzAddMonths(date, 3);
  if (freq === "annuelle") return bzAddMonths(date, 12);
  return bzAddMonths(date, 1);
}
function bzRecurringDates(tpl, today) {
  const out = [];
  let d = tpl.nextDate;
  while (d && d <= today && (!tpl.endDate || d <= tpl.endDate) && out.length < 24) { out.push(d); d = bzNextRecurring(d, tpl.freq); }
  return { dates: out, next: d };
}

// ----- Phase 8 : budget & prévisionnel -----
function bzBudgetActuals(entries, accounts, year) {
  const res = {};
  for (const a of accounts) res[a.code] = { code: a.code, name: a.name, type: a.type, actual: 0 };
  for (const e of entries || []) {
    if (!e.date || String(e.date).slice(0, 4) !== String(year)) continue;
    for (const l of e.lines || []) {
      const a = res[l.account]; if (!a) continue;
      a.actual = bzR(a.actual + (a.type === "Produit" ? (l.credit - l.debit) : (l.debit - l.credit)));
    }
  }
  return res;
}
function bzForecast({ cash, receivables, payables, recurring, today, days }) {
  const weeks = Math.ceil(days / 7);
  const rows = [];
  let bal = cash;
  for (let w = 0; w < weeks; w++) {
    const from = bzAddDays(today, w * 7), to = bzAddDays(today, w * 7 + 6);
    const inRange = (d) => (w === 0 ? d <= to : d >= from && d <= to);
    const rin = receivables.filter((r) => inRange(r.due)).reduce((s, r) => s + r.amount, 0) + recurring.filter((r) => inRange(r.date)).reduce((s, r) => s + r.amount, 0);
    const rout = payables.filter((r) => inRange(r.due)).reduce((s, r) => s + r.amount, 0);
    bal = bzR(bal + rin - rout);
    rows.push({ from, to, inflow: bzR(rin), outflow: bzR(rout), balance: bal });
  }
  return { start: cash, rows, end: bal, minBalance: rows.reduce((m, r) => Math.min(m, r.balance), cash) };
}

// ----- Phase 9 : relevé bancaire CSV -----
const bzNoAccent = (x) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const BZ_MONTHS = { jan: 1, janv: 1, feb: 2, fev: 2, mar: 3, apr: 4, avr: 4, may: 5, mai: 5, jun: 6, juin: 6, jul: 7, juil: 7, aug: 8, aou: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
function bzNum(s) {
  if (s == null || s === "") return 0;
  let t = String(s).trim();
  t = t.replace(/[\u2212\u2013\u2014]/g, "-"); // moins typographique (Excel/PDF) → "-"
  let neg = /^\(.*\)$/.test(t) || /-\s*$/.test(t) || /^[^0-9]*-/.test(t) || /\bDR\b/i.test(t) || /\bd[ée]bit\b/i.test(t);
  t = t.replace(/[^0-9,.]/g, "");
  if (!t) return 0;
  const lc = t.lastIndexOf(","), ld = t.lastIndexOf(".");
  if (lc >= 0 && ld >= 0) { const dec = lc > ld ? "," : "."; t = dec === "," ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, ""); }
  else if (lc >= 0) t = /,(\d{1,2}|\d{4,})$/.test(t) && (t.match(/,/g) || []).length === 1 ? t.replace(",", ".") : t.replace(/,/g, "");
  else if (ld >= 0) t = /\.(\d{1,2}|\d{4,})$/.test(t) && (t.match(/\./g) || []).length === 1 ? t : t.replace(/\./g, "");
  const v = Number(t) || 0;
  return neg ? -v : v;
}
function bzFixDate(s, order) {
  const x = String(s || "").trim();
  let m = x.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = x.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    const [dd, mm] = order === "mdy" ? [m[2], m[1]] : [m[1], m[2]];
    if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return "";
    return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  m = bzNoAccent(x).match(/^(\d{1,2})[\s\-.]+([a-z]{3,5})\.?[\s\-.,]+(\d{2,4})/);
  if (m && BZ_MONTHS[m[2]]) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${String(BZ_MONTHS[m[2]]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  // « Oct 12, 2026 » / « October 12 2026 »
  m = bzNoAccent(x).match(/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (m && BZ_MONTHS[m[1].slice(0, m[1].startsWith("sept") ? 4 : 3)]) return `${m[3]}-${String(BZ_MONTHS[m[1].slice(0, m[1].startsWith("sept") ? 4 : 3)]).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  // Numéro de série Excel resté brut (cellule au format « Standard ») : 2009 → 2064
  if (/^\d{5}(\.\d+)?$/.test(x)) {
    const n = Math.floor(Number(x));
    if (n >= 40000 && n <= 60000) return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  }
  return "";
}
// Lit un relevé bancaire texte (CSV/TSV, « ; » ou « , »). Tolère les lignes d'introduction avant l'en-tête,
// les accents, les montants en colonnes Débit/Crédit ou en une seule colonne signée.
function bzParseCSV(text) { return bzParseCSVDetailed(text).lines; }
// Version détaillée : lignes reconnues + ce qui a été compris du fichier (pour l'expliquer à l'utilisateur).
function bzParseCSVDetailed(text) {
  const empty = { lines: [], skipped: 0, dateOrder: "dmy", cols: null };
  const all = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() && l.replace(/[;,\t"\s]/g, ""));
  if (all.length < 2) return empty;
  const HEAD_AMT = /(montant|amount|importe|debit|credit|cargo|abono|retrait|depot|deposit|withdraw|solde|entree|sortie)/;
  let hi = all.findIndex((l) => /(date|fecha)/.test(bzNoAccent(l)) && HEAD_AMT.test(bzNoAccent(l)));
  if (hi < 0) hi = 0;
  const cnt = { ";": (all[hi].match(/;/g) || []).length, ",": (all[hi].match(/,/g) || []).length, "\t": (all[hi].match(/\t/g) || []).length };
  const sep = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
  if (!sep[1]) return empty;
  const split = (l) => { const o = []; let cur = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep[0] && !q) { o.push(cur); cur = ""; } else cur += ch; } o.push(cur); return o.map((x) => x.trim()); };
  const rawHead = split(all[hi]);
  const head = rawHead.map(bzNoAccent);
  const iDate = head.findIndex((h) => /(date|fecha)/.test(h));
  const find = (re, not) => head.findIndex((h, i) => re.test(h) && i !== not);
  const iAmt = find(/^(montant|amount|importe)/);
  const iDeb = find(/debit|retrait|withdraw|sortie|cargo/);
  const iCre = find(/credit|depot|deposit|entree|abono/);
  const iLab = find(/lib|desc|detail|mouvement|ref|motif|operation|memo|narrat|particul|nature|concepto/, iDate);
  if (iDate < 0 || (iAmt < 0 && iDeb < 0 && iCre < 0)) return { ...empty, cols: { date: iDate >= 0 ? rawHead[iDate] : null, header: rawHead.join(" | ") } };
  const rows = all.slice(hi + 1).map(split);
  // Ordre des dates : « 03/04/2026 » est-il le 3 avril (jour/mois) ou le 4 mars (mois/jour) ?
  // Tranché par les dates sans ambiguïté du fichier ; à défaut, jour/mois (usage haïtien et français).
  let dmy = 0, mdy = 0;
  rows.forEach((c) => { const m = String(c[iDate] || "").trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/); if (m) { if (Number(m[1]) > 12) dmy++; if (Number(m[2]) > 12) mdy++; } });
  const dateOrder = mdy > 0 && dmy === 0 ? "mdy" : "dmy";
  const lines = [];
  let skipped = 0;
  for (const c of rows) {
    if (c.every((x) => !x)) continue;
    const date = bzFixDate(c[iDate], dateOrder);
    if (!date) { if (/\d/.test(String(c[iDate] || ""))) skipped++; continue; }
    const amount = iAmt >= 0 ? bzNum(c[iAmt]) : bzR(Math.abs(bzNum(c[iCre])) - Math.abs(bzNum(c[iDeb])));
    if (!amount) { skipped++; continue; }
    lines.push({ date, label: iLab >= 0 ? c[iLab] || "" : "", amount: bzR(amount) });
  }
  return { lines, skipped, dateOrder, cols: { header: rawHead.join(" | "), date: rawHead[iDate], amount: iAmt >= 0 ? rawHead[iAmt] : null, debit: iDeb >= 0 ? rawHead[iDeb] : null, credit: iCre >= 0 ? rawHead[iCre] : null, label: iLab >= 0 ? rawHead[iLab] : null } };
}
// Rapproche chaque ligne du relevé avec une écriture 512 non pointée (même montant, ±5 jours).
function bzMatchBank(bankLines, entries) {
  const used = new Set();
  const cand = [];
  for (const e of entries || []) {
    if (e.reconciled) continue;
    const net = bzR((e.lines || []).filter((l) => l.account === "512").reduce((s, l) => s + l.debit - l.credit, 0));
    if (net !== 0) cand.push({ id: e.id, date: e.date, label: e.label, net });
  }
  return bankLines.map((b) => {
    let best = null;
    for (const c of cand) {
      if (used.has(c.id) || c.net !== b.amount) continue;
      const dd = Math.abs(bzDiffDays(b.date, c.date));
      if (dd <= 5 && (!best || dd < best.dd)) best = { c, dd };
    }
    if (best) used.add(best.c.id);
    return { ...b, match: best ? best.c : null };
  });
}

// Facture au format texte (WhatsApp : *gras* ; e-mail : sans balises).
function bzInvoiceText({ invoice, settings, markup, fmtMoney }) {
  const f = fmtMoney || ((n) => String(bzR(n)));
  const B = (t) => (markup ? `*${t}*` : t);
  const inv = invoice, st = settings || {};
  const paid = bzR((inv.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const due = bzInvBalance(inv);
  const hr = "──────────────────";
  const out = [];
  out.push(B((st.companyName || "Mon entreprise").toUpperCase()));
  [st.companyAddress, [st.companyPhone, st.companyEmail].filter(Boolean).join(" · ")].filter(Boolean).forEach((x) => out.push(x));
  out.push(hr);
  out.push(B(`FACTURE N° ${inv.number || "—"}`));
  out.push(`Date : ${bzFr(inv.date)}`);
  if (due > 0) out.push(`Échéance : ${bzFr(bzInvDue(inv, st))}`);
  out.push(`Client : ${inv.client || "Client"}`);
  out.push(hr);
  (inv.lines || []).forEach((l) => out.push(`• ${l.name || "Article"} — ${l.qty} × ${f(l.price)} = ${f(l.subtotal)}`));
  (inv.fees || []).forEach((x) => out.push(`• ${x.label || "Frais"} = ${f(x.amount)}`));
  if (Number(inv.globalDiscountAmount) > 0) out.push(`Remise : -${f(inv.globalDiscountAmount)}`);
  out.push(hr);
  if (Number(inv.totalTax) > 0) { out.push(`Total HT : ${f(inv.totalHT)}`); out.push(`${inv.taxLabel || "Taxe"} : ${f(inv.totalTax)}`); }
  out.push(B(`TOTAL${Number(inv.totalTax) > 0 ? " TTC" : ""} : ${f(inv.total)}`));
  if (paid > 0) out.push(`Déjà réglé : ${f(paid)}`);
  if (inv.status === "payée") out.push(B("✔ FACTURE ACQUITTÉE"));
  else out.push(B(`RESTE À PAYER : ${f(due)}`));
  out.push(hr);
  out.push("Merci de votre confiance.");
  return out.join("\n");
}
const bzFr = (d) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d || "");

// Réduit une image (photo de téléphone) pour tenir dans la base ; les PDF sont acceptés tels quels s'ils sont petits.
const BZ_ATT_MAX = 250 * 1024;      // image réduite : cible
const BZ_PDF_MAX = 900 * 1024;      // PDF / autre fichier : maximum
const BZ_ATT_TOTAL = 8 * 1024 * 1024; // total de toutes les pièces jointes
const BZ_ATT_MAX_COUNT = 40;
const bzFileReadBuf = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error("Lecture du fichier impossible. Réessayez en choisissant à nouveau le fichier (par exemple depuis le dossier Téléchargements).")); r.readAsArrayBuffer(file); });
const bzFileReadURL = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("Lecture du fichier impossible.")); r.readAsDataURL(file); });
// Lecture texte tolérante : UTF-8, sinon Windows-1252 (relevés de banque exportés d'Excel)
async function bzReadText(file) {
  const buf = await bzFileReadBuf(file);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch (e) { return new TextDecoder("windows-1252").decode(buf); }
}
// Excel (.xls/.xlsx) → texte CSV, via SheetJS chargé à la demande (nécessite une connexion)
let _bzXlsxP = null;
function bzLoadXlsx() {
  if (typeof window !== "undefined" && window.XLSX) return Promise.resolve(window.XLSX);
  if (_bzXlsxP) return _bzXlsxP;
  _bzXlsxP = new Promise((res, rej) => {
    const sc = document.createElement("script");
    sc.src = "vendor/xlsx.full.min.js";
    sc.onload = () => (window.XLSX ? res(window.XLSX) : rej(new Error("Lecteur Excel indisponible.")));
    sc.onerror = () => { _bzXlsxP = null; rej(new Error("Lecteur Excel non chargé (connexion ?). Enregistrez le relevé en CSV puis réessayez.")); };
    document.head.appendChild(sc);
  });
  return _bzXlsxP;
}
// Feuille → CSV « neutre », sans dépendre de la langue ni du format d'affichage d'Excel :
// dates reconnues par leur format de cellule et écrites en AAAA-MM-JJ, nombres lus tels quels (arrondis
// au centime : jamais de 0,30000000000000004), texte repris tel quel.
function bzSheetToCsv(X, ws) {
  const ref = ws && ws["!ref"];
  if (!ref) return "";
  const r = X.utils.decode_range(ref);
  const pad = (n) => String(n).padStart(2, "0");
  const q = (t) => (/[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
  const out = [];
  for (let R = r.s.r; R <= r.e.r; R++) {
    const row = [];
    let any = false;
    for (let C = r.s.c; C <= r.e.c; C++) {
      const c = ws[X.utils.encode_cell({ r: R, c: C })];
      let t = "";
      if (c && c.v != null && c.v !== "") {
        if (c.t === "n") {
          let isDate = false;
          try { isDate = !!(c.z && X.SSF && X.SSF.is_date && X.SSF.is_date(c.z)); } catch (e) { isDate = false; }
          if (isDate) { const d = X.SSF.parse_date_code(c.v); t = d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : String(c.v); }
          else t = String(Math.round(c.v * 100) / 100);
        } else if (c.t === "d" && c.v instanceof Date) t = c.v.toISOString().slice(0, 10);
        else t = String(c.t === "s" || c.w == null ? c.v : c.w);
        t = t.replace(/\s+/g, " ").trim();
        if (t) any = true;
      }
      row.push(q(t));
    }
    if (any) out.push(row.join(";"));
  }
  return out.join("\n");
}
// Lit TOUTES les feuilles et garde celle qui contient le plus de lignes de relevé reconnues
// (le relevé n'est pas toujours sur la première feuille : page de garde, synthèse…).
async function bzExcelRead(file) {
  const X = await bzLoadXlsx();
  const buf = await bzFileReadBuf(file);
  const wb = X.read(buf, { type: "array", cellDates: false, cellNF: true });
  if (!wb.SheetNames || wb.SheetNames.length === 0) throw new Error("Classeur Excel vide.");
  let best = null;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const cands = [];
    try { cands.push(bzSheetToCsv(X, ws)); } catch (e) { /* repli ci-dessous */ }
    try { cands.push(X.utils.sheet_to_csv(ws, { FS: ";", RS: "\n", dateNF: "yyyy-mm-dd" })); } catch (e) { /* ignoré */ }
    for (const csv of cands) {
      if (!csv) continue;
      const n = bzParseCSV(csv).length;
      if (!best || n > best.n) best = { csv, n, sheet: name };
    }
  }
  if (!best) throw new Error("Classeur Excel vide.");
  return { csv: best.csv, sheet: best.sheet, sheets: wb.SheetNames.length };
}
async function bzExcelToCsv(file) { return (await bzExcelRead(file)).csv; }
async function bzPrepareFile(file) {
  const nm = (file.name || "").toLowerCase();
  const isImg = (/^image\//.test(file.type) || /\.(jpe?g|png|webp|bmp)$/.test(nm)) && !/svg|gif/.test(file.type);
  const raw = async () => {
    if (file.size > BZ_PDF_MAX) throw new Error(`Fichier trop volumineux (${Math.round(file.size / 1024)} Ko, maximum ${Math.round(BZ_PDF_MAX / 1024)} Ko). Réduisez-le ou prenez une photo (les photos sont réduites automatiquement).`);
    const data = await bzFileReadURL(file);
    const mime = file.type || (/\.pdf$/.test(nm) ? "application/pdf" : "application/octet-stream");
    return { data: data.startsWith("data:;") ? data.replace("data:;", "data:" + mime + ";") : data, mime, size: file.size };
  };
  if (!isImg) return raw();
  const url = URL.createObjectURL(file);
  try {
    let img;
    try { img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("x")); i.src = url; }); }
    catch (e) { return raw(); } // format non décodable (ex. HEIC) : on garde l'original s'il est assez petit
    for (const dim of [1600, 1300, 1000, 800, 600, 450]) {
      const k = Math.min(1, dim / Math.max(img.width, img.height));
      const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
      const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
      for (const q of [0.8, 0.65, 0.5]) {
        const data = cv.toDataURL("image/jpeg", q);
        const size = Math.round((data.length - data.indexOf(",") - 1) * 0.75);
        if (size <= BZ_ATT_MAX) return { data, mime: "image/jpeg", size };
      }
    }
    throw new Error("Image trop complexe pour être réduite : prenez une photo plus simple ou un PDF léger.");
  } finally { URL.revokeObjectURL(url); }
}

// K:ST:START — Pièces justificatives : stockage de fichiers dédié au-delà de la limite intégrée
const BZ_ST_BUCKET = "justificatifs";
const BZ_ST_FILE_MAX = 5 * 1024 * 1024;       // par fichier
const BZ_ST_MAX_COUNT = 400;                   // par entreprise
const BZ_ST_TOTAL = 200 * 1024 * 1024;         // par entreprise
const bzIsStored = (a) => !!(a && a.path);
// Placement : intégré (comme avant) tant que 40 pièces / 8 Mo ne sont pas atteints, sinon stockage dédié.
function bzPlacement(atts, size) {
  const emb = (atts || []).filter((a) => !bzIsStored(a));
  const bytes = emb.reduce((t, a) => t + (a.size || 0), 0);
  return emb.length < BZ_ATT_MAX_COUNT && bytes + size <= BZ_ATT_TOTAL ? "inline" : "storage";
}
const bzSafeName = (n) => (String(n || "piece").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "piece");
// Prépare et range une pièce ; renvoie l'enregistrement à ajouter à bizdocs.
async function bzStoreAttachment({ atts, file, companyId, ref, refLabel }) {
  let prepared = null, prepErr = null;
  pjStep("préparation : " + file.name + " (" + Math.round((file.size || 0) / 1024) + " Ko)");
  try { prepared = await bzPrepareFile(file); } catch (e) { prepErr = e; }
  pjStep(prepared ? "préparation : conservé avec les données" : "préparation : envoi au stockage dédié" + (prepErr ? " (" + String(prepErr.message || prepErr).slice(0, 60) + ")" : "") + (companyId ? "" : " — entreprise inconnue"));
  const base = { type: "attachment", createdAt: new Date().toISOString(), ref: ref || "", refLabel: refLabel || "Non rattaché", fileName: file.name };
  if (prepared && bzPlacement(atts, prepared.size) === "inline") return { id: uid(), ...base, mime: prepared.mime, size: prepared.size, data: prepared.data };
  if (!companyId) throw prepErr || new Error("Espace des pièces jointes presque plein (8 Mo au total) : supprimez des pièces jointes avant d'en ajouter.");
  const stored = (atts || []).filter(bzIsStored);
  if (stored.length >= BZ_ST_MAX_COUNT) throw new Error(`Limite de ${BZ_ST_MAX_COUNT} pièces dans le stockage dédié atteinte : supprimez-en une.`);
  let blob, mime, size;
  if (prepared) { blob = await (await fetch(prepared.data)).blob(); mime = prepared.mime; size = prepared.size; }
  else {
    if (file.size > BZ_ST_FILE_MAX) throw new Error(`Fichier trop volumineux (${Math.round(file.size / 1024)} Ko, maximum ${Math.round(BZ_ST_FILE_MAX / 1024)} Ko). Réduisez-le ou prenez une photo.`);
    blob = file; mime = file.type || (/\.pdf$/i.test(file.name || "") ? "application/pdf" : "application/octet-stream"); size = file.size;
  }
  if (stored.reduce((t, a) => t + (a.size || 0), 0) + size > BZ_ST_TOTAL) throw new Error("Espace de stockage des pièces presque plein (200 Mo) : supprimez des pièces avant d'en ajouter.");
  const id = uid();
  const path = `${companyId}/${id}-${bzSafeName(file.name)}`;
  pjStep("stockage : envoi en cours");
  const { error } = await supabase.storage.from(BZ_ST_BUCKET).upload(path, blob, { contentType: mime, upsert: false });
  pjStep(error ? "stockage : échec — " + String(error.message || "").slice(0, 80) : "stockage : envoi réussi");
  if (error) throw new Error(/bucket|not found|policy|row-level|security/i.test(String(error.message)) ? "Le stockage des pièces n'est pas encore disponible sur votre compte. Contactez le support." : "La pièce n'a pas pu être envoyée. Vérifiez votre connexion et réessayez.");
  return { id, ...base, mime, size, path };
}
async function bzOpenAttachment(a, showToast) {
  if (!bzIsStored(a)) return;
  try {
    const { data, error } = await supabase.storage.from(BZ_ST_BUCKET).createSignedUrl(a.path, 120);
    if (error || !data || !data.signedUrl) throw new Error("x");
    const el = document.createElement("a"); el.href = data.signedUrl; el.target = "_blank"; el.rel = "noopener"; el.setAttribute("download", a.fileName || ""); document.body.appendChild(el); el.click(); el.remove();
  } catch (e) { showToast("La pièce n'a pas pu être ouverte. Vérifiez votre connexion et réessayez."); }
}
async function bzRemoveStored(a) {
  if (!bzIsStored(a)) return true;
  try { const { error } = await supabase.storage.from(BZ_ST_BUCKET).remove([a.path]); return !error; } catch (e) { return false; }
}

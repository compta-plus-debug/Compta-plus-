// ═══ MODULE ═══
// @module Import export
// @depends EC_CSS, ecBorder, ecBtn, ecBtnGold, ecDateFr, ecInput, ecPastille, ecTelecharger, fmt
//   isFutureDate, isLocked, todayStr, uid, useBrouillon, useState
// @exports ImportExportModule
// ═══ FIN DE L'EN-TÊTE ═══
// Bloc Import-export : dossiers d'importation (coût de revient réel) et dossiers d'exportation.
//
// Principe : la comptabilité reste ENTIÈREMENT EN GOURDES. Le dollar n'est qu'une unité de saisie : chaque dossier porte son propre
// taux (choisi par l'entreprise) ; la facture du fournisseur ou du client étranger est convertie à ce taux. Quand le règlement se fait
// à un autre taux, l'écart est constaté en gourdes : 666 « Pertes de change » ou 766 « Gains de change ».
//
// Importation (méthode du stock en charge : 607 / 608 ; méthode du stock en actif : tout en 370) :
//  • facture fournisseur (marchandise + fret + assurance) : Débit 607 et 608 (ou 370) / Crédit 401 ;
//  • droits de douane, taxe de vérification, prélèvement de 2 %, transit, magasinage, surestaries : Débit 608 (ou 370) / Crédit caisse, banque ou 401 ;
//  • TCA payée à l'importation : Débit 4456 (récupérable) ; acompte d'impôt sur le revenu : Débit 4458 (à imputer) ;
//  • règlement du fournisseur en dollars : Débit 401 / Crédit caisse ou banque, écart de change en 666 ou 766.
// Exportation : Débit 411 / Crédit 707 (et 445 si la TCA s'applique, taux 0 par défaut à confirmer), encaissement : Débit banque ou caisse / Crédit 411,
// écart de change en 666 ou 766 ; coût de revient des marchandises sorties : Débit 6037 / Crédit 370 (méthode du stock en actif).
// Tous les taux sont des RÉGLAGES (valeurs par défaut à confirmer avec l'expert-comptable ou le transitaire).
// Toutes les données sont dans une seule catégorie « impex » (enregistrements distingués par leur type : config, imp, exp).

const IE_COMPTES = {
  "607": { name: "Achats de marchandises", type: "Charge" },
  "608": { name: "Frais accessoires d'achat (transport, manutention)", type: "Charge" },
  "370": { name: "Stock de marchandises", type: "Actif" },
  "401": { name: "Fournisseurs", type: "Passif" },
  "411": { name: "Clients", type: "Actif" },
  "4456": { name: "Taxe déductible sur achats (TCA)", type: "Actif" },
  "445": { name: "Taxe collectée sur ventes (IVA/TCA)", type: "Passif" },
  "4458": { name: "Acompte d'impôt sur le revenu payé à l'importation (à imputer)", type: "Actif" },
  "6037": { name: "Coût des marchandises vendues", type: "Charge" },
  "624": { name: "Transports et frais d'expédition (exportation)", type: "Charge" },
  "666": { name: "Pertes de change", type: "Charge" },
  "766": { name: "Gains de change", type: "Produit" },
  "707": { name: "Ventes de marchandises", type: "Produit" },
  "512": { name: "Banque", type: "Actif" },
  "530": { name: "Caisse", type: "Actif" },
};
const IE_TAUX_DEFAUT = { duty: 10, verif: 5, cfgdct: 2, tca: 10, acompte: 0, tcaExport: 0 };
const IE_FRAIS = [
  ["duty", "Droits de douane", "cout"], ["verif", "Taxe de vérification", "cout"], ["cfgdct", "Prélèvement de 2 % (CFGDCT)", "cout"],
  ["tca", "TCA payée à l'importation (récupérable)", "tca"], ["acompte", "Acompte d'impôt sur le revenu à l'importation", "acompte"],
  ["transit", "Frais de transitaire / courtier", "cout"], ["storage", "Magasinage et surestaries", "cout"], ["local", "Transport local et manutention", "cout"], ["autre", "Autre frais d'approche", "cout"],
];
const IE_ETAPES_IMP = [["commande", "Commandé"], ["expedie", "Expédié"], ["port", "Arrivé au port"], ["dedouane", "Dédouané"], ["livre", "Livré en stock"]];
const IE_ETAPES_EXP = [["prepare", "En préparation"], ["expedie", "Expédié"], ["livre", "Livré au client"], ["solde", "Soldé"]];
const IE_DOCS_IMP = [["facture", "Facture du fournisseur"], ["connaissement", "Connaissement / lettre de transport"], ["dpi", "Déclaration préalable à l'importation"], ["av", "Certificat de vérification"], ["declaration", "Déclaration en douane"]];
const IE_DOCS_EXP = [["facture", "Facture d'exportation"], ["packing", "Liste de colisage"], ["connaissement", "Connaissement / lettre de transport"], ["origine", "Certificat d'origine"], ["douane", "Déclaration d'exportation"]];

const ieR2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const ieId = () => String(uid());
const ieRows = (rows, type) => (rows || []).filter((r) => r && r.type === type);
const ieUsd = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USD";
const ieJours = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000)) : 0);

function ieAjouterComptes(accounts, setAccounts, codes) {
  const missing = [...new Set(codes)].filter((k) => IE_COMPTES[k] && !accounts.some((a) => a.code === k)).map((k) => ({ code: k, name: IE_COMPTES[k].name, type: IE_COMPTES[k].type }));
  if (missing.length) setAccounts((prev) => [...prev, ...missing.filter((m) => !prev.some((a) => a.code === m.code))]);
}

// ─── calculs d'un dossier d'importation (tout en gourdes) ───
function ieImpCalc(d) {
  const lines = d.lines || [];
  const goodsUSD = ieR2(lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitUSD) || 0), 0));
  const fiUSD = ieR2((Number(d.freightUSD) || 0) + (Number(d.insuranceUSD) || 0));
  const rate = Number(d.rate) || 0;
  const goodsHTG = ieR2(goodsUSD * rate), fiHTG = ieR2(fiUSD * rate);
  const totalUSD = ieR2(goodsUSD + fiUSD), totalHTG = ieR2(goodsHTG + fiHTG);
  const charges = (d.charges || []).filter((c) => c.status !== "annulé");
  const kindOf = (k) => (IE_FRAIS.find((x) => x[0] === k) || [])[2] || "cout";
  const chargesCout = ieR2(charges.filter((c) => kindOf(c.kind) === "cout").reduce((s, c) => s + c.amount, 0));
  const chargesTca = ieR2(charges.filter((c) => kindOf(c.kind) === "tca").reduce((s, c) => s + c.amount, 0));
  const chargesAcompte = ieR2(charges.filter((c) => kindOf(c.kind) === "acompte").reduce((s, c) => s + c.amount, 0));
  const approche = ieR2(fiHTG + chargesCout); // tous les frais d'approche non récupérables (fret et assurance compris)
  const coutRevient = ieR2(goodsHTG + approche);
  const paidUSD = ieR2((d.payments || []).filter((p) => p.status !== "annulé").reduce((s, p) => s + p.usd, 0));
  const lineCosts = lines.map((l) => {
    const lineHTG = ieR2((Number(l.qty) || 0) * (Number(l.unitUSD) || 0) * rate);
    const part = goodsHTG > 0 ? ieR2(chargesCout * lineHTG / goodsHTG) : 0;
    const partFi = goodsHTG > 0 ? ieR2(fiHTG * lineHTG / goodsHTG) : 0;
    const total = ieR2(lineHTG + part + partFi);
    const qty = Number(l.qty) || 0;
    return { ...l, lineHTG, total, unitCost: qty > 0 ? ieR2(total / qty) : 0 };
  });
  return { goodsUSD, fiUSD, goodsHTG, fiHTG, totalUSD, totalHTG, chargesCout, chargesTca, chargesAcompte, approche, coutRevient, coef: goodsHTG > 0 ? coutRevient / goodsHTG : 0, paidUSD, resteUSD: ieR2(totalUSD - paidUSD), lineCosts };
}
// Estimation des droits et taxes à partir des taux réglés (pour pré-remplir ; les montants réels viennent de la déclaration en douane)
function ieEstimer(d, rates) {
  const c = ieImpCalc(d);
  const cif = c.totalHTG;
  const duty = ieR2(cif * (Number(rates.duty) || 0) / 100), verif = ieR2(cif * (Number(rates.verif) || 0) / 100), cfgdct = ieR2(cif * (Number(rates.cfgdct) || 0) / 100);
  const tca = ieR2((cif + duty + verif) * (Number(rates.tca) || 0) / 100);
  const acompte = ieR2((cif + duty + verif) * (Number(rates.acompte) || 0) / 100);
  return { cif, duty, verif, cfgdct, tca, acompte };
}
function ieExpCalc(d) {
  const lines = d.lines || [];
  const rate = Number(d.rate) || 0;
  const totalUSD = ieR2(lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitUSD) || 0), 0));
  const ht = ieR2(totalUSD * rate);
  const tcaRate = Number(d.tcaRate) || 0;
  const tca = ieR2(ht * tcaRate / 100);
  const totalHTG = ieR2(ht + tca);
  const costs = ieR2((d.costs || []).filter((c) => c.status !== "annulé").reduce((s, c) => s + c.amount, 0));
  const cogs = ieR2(lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitCostHTG) || 0), 0));
  const receivedUSD = ieR2((d.receipts || []).filter((r) => r.status !== "annulé").reduce((s, r) => s + r.usd, 0));
  return { totalUSD, ht, tca, totalHTG, costs, cogs, marge: ieR2(ht - cogs - costs), receivedUSD, resteUSD: ieR2(totalUSD - receivedUSD) };
}

function ImportExportModule({ impex, setImpex, entries, setEntries, accounts, setAccounts, products, setProducts, movements, setMovements, settings, role, showToast, logAudit, currentUserEmail }) {
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const today = todayStr();
  const [tab, setTab] = useState("apercu");
  const imps = ieRows(impex, "imp");
  const exps = ieRows(impex, "exp");
  const cfg = ieRows(impex, "config")[0] || { id: "config", type: "config", rates: IE_TAUX_DEFAUT };
  const rates = { ...IE_TAUX_DEFAUT, ...(cfg.rates || {}) };
  const [impSel, setImpSel] = useState("");
  const [expSel, setExpSel] = useState("");
  const stockActif = settings.stockValuationMethod === "actif";
  const compteMarch = stockActif ? "370" : "607";
  const compteApproche = stockActif ? "370" : "608";
  const marchandises = (products || []).filter((p) => p.type === "marchandise");
  const nomProduit = (id) => ((products || []).find((p) => String(p.id) === String(id)) || {}).name || "";

  const maj = (id, fn) => setImpex((prev) => (prev || []).map((r) => (r.id === id ? fn(r) : r)));
  const ecrire = (date, label, lines, dossierId) => {
    const e = { id: uid(), date, createdAt: new Date().toISOString(), label, lines: lines.filter((l) => l.debit > 0 || l.credit > 0), kind: "impex", dossierId };
    setEntries((prev) => [...prev, e]);
    return e;
  };
  const contre = (entryId, label, date, dossierId) => {
    const e = (entries || []).find((x) => x.id === entryId);
    if (!e) return null;
    return ecrire(date, label, e.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })), dossierId);
  };
  const compteMode = (mode) => (mode === "banque" ? "512" : mode === "apayer" ? "401" : "530");
  const verifDate = (date, action) => {
    if (!date || isFutureDate(date)) { showToast("La date ne peut pas être dans le futur."); return false; }
    if (isLocked(date, settings)) { showToast("La période comptable est clôturée jusqu'au " + settings.lockDate + " inclus : impossible de " + action + " à cette date."); return false; }
    return true;
  };
  const numero = (prefix, rows, date) => {
    const yy = String((date || today).slice(0, 4));
    const n = rows.filter((r) => String(r.number || "").startsWith(prefix + "-" + yy + "-")).reduce((m, r) => Math.max(m, Number(String(r.number).split("-")[2]) || 0), 0) + 1;
    return prefix + "-" + yy + "-" + String(n).padStart(3, "0");
  };

  // ───────── Importations ─────────
  const [fi, setFi] = useBrouillon("impex-imp-nouveau", { supplier: "", country: "", ref: "", rate: "", date: todayStr() });
  const creerImp = () => {
    if (!canEdit) return;
    const rate = Number(fi.rate);
    if (!fi.supplier.trim()) { showToast("Indiquez le fournisseur étranger."); return; }
    if (!(rate > 0)) { showToast("Indiquez le taux du dollar en gourdes pour ce dossier (par exemple 131)."); return; }
    if (!fi.date || isFutureDate(fi.date)) { showToast("La date ne peut pas être dans le futur."); return; }
    const d = { type: "imp", id: ieId(), number: numero("IMP", imps, fi.date), supplier: fi.supplier.trim(), country: fi.country.trim(), ref: fi.ref.trim(), rate, date: fi.date, status: "commande", etaDate: "", portDate: "", docs: {}, lines: [], freightUSD: 0, insuranceUSD: 0, charges: [], payments: [], invoiceEntryId: "", receivedToStock: false, createdAt: new Date().toISOString(), by: currentUserEmail || "" };
    setImpex((prev) => [...(prev || []), d]);
    setImpSel(d.id); setFi({ supplier: "", country: "", ref: "", rate: fi.rate, date: todayStr() });
    showToast("Dossier " + d.number + " créé : ajoutez les articles, puis comptabilisez la facture."); logAudit("Import-export", "Dossier d'importation créé", d.number + " — " + d.supplier);
  };
  const [fl, setFl] = useBrouillon("impex-imp-ligne", { desc: "", productId: "", qty: "1", unitUSD: "" });
  const [ff, setFf] = useBrouillon("impex-imp-frais", { kind: "duty", label: "", amount: "", date: todayStr(), mode: "caisse" });
  const [fp, setFp] = useBrouillon("impex-imp-paiement", { usd: "", rate: "", date: todayStr(), mode: "banque" });

  const ajouterLigneImp = (d) => {
    if (!canEdit || d.invoiceEntryId) return;
    const prod = marchandises.find((p) => String(p.id) === String(fl.productId));
    const desc = (fl.desc.trim() || (prod ? prod.name : "")).trim();
    const qty = Number(fl.qty), unit = Number(fl.unitUSD);
    if (!desc) { showToast("Indiquez la désignation de l'article ou choisissez un produit."); return; }
    if (!(qty > 0)) { showToast("Indiquez une quantité supérieure à zéro."); return; }
    if (!(unit >= 0) || fl.unitUSD === "") { showToast("Indiquez le prix unitaire en dollars."); return; }
    maj(d.id, (r) => ({ ...r, lines: [...(r.lines || []), { id: ieId(), desc, productId: prod ? String(prod.id) : "", qty, unitUSD: unit }] }));
    setFl({ desc: "", productId: "", qty: "1", unitUSD: "" });
  };
  const retirerLigneImp = (d, lid) => { if (!canEdit || d.invoiceEntryId) return; maj(d.id, (r) => ({ ...r, lines: r.lines.filter((l) => l.id !== lid) })); };
  const changerImp = (d, patch) => { if (!canEdit) return; maj(d.id, (r) => ({ ...r, ...patch })); };
  const comptabiliserFactureImp = (d) => {
    if (!canEdit || d.invoiceEntryId) return;
    const c = ieImpCalc(d);
    if (!(c.goodsHTG > 0)) { showToast("Ajoutez d'abord au moins un article avec un prix."); return; }
    if (!verifDate(d.date, "comptabiliser la facture")) return;
    ieAjouterComptes(accounts, setAccounts, [compteMarch, compteApproche, "401"]);
    const lines = stockActif
      ? [{ account: "370", debit: c.totalHTG, credit: 0 }]
      : [{ account: "607", debit: c.goodsHTG, credit: 0 }, { account: "608", debit: c.fiHTG, credit: 0 }];
    lines.push({ account: "401", debit: 0, credit: c.totalHTG });
    const e = ecrire(d.date, "Importation " + d.number + " — facture " + d.supplier + " (" + ieUsd(c.totalUSD) + " à " + d.rate + ")", lines, d.id);
    maj(d.id, (r) => ({ ...r, invoiceEntryId: e.id, invoiceHTG: c.totalHTG, invoiceUSD: c.totalUSD }));
    showToast("Facture comptabilisée : " + fmt(c.totalHTG) + " dus au fournisseur."); logAudit("Import-export", "Facture d'importation comptabilisée", d.number + " — " + fmt(c.totalHTG));
  };
  const estimation = (d) => ieEstimer(d, rates);
  const ajouterFraisImp = (d) => {
    if (!canEdit) return;
    const amount = ieR2(ff.amount);
    if (!(amount > 0)) { showToast("Indiquez un montant en gourdes supérieur à zéro."); return; }
    if (!verifDate(ff.date, "enregistrer ce frais")) return;
    const def = IE_FRAIS.find((x) => x[0] === ff.kind) || IE_FRAIS[0];
    const label = ff.label.trim() || def[1];
    const compte = def[2] === "tca" ? "4456" : def[2] === "acompte" ? "4458" : compteApproche;
    ieAjouterComptes(accounts, setAccounts, [compte, compteMode(ff.mode)]);
    const e = ecrire(ff.date, "Importation " + d.number + " — " + label, [{ account: compte, debit: amount, credit: 0 }, { account: compteMode(ff.mode), debit: 0, credit: amount }], d.id);
    maj(d.id, (r) => ({ ...r, charges: [...(r.charges || []), { id: ieId(), kind: ff.kind, label, amount, date: ff.date, mode: ff.mode, entryId: e.id, status: "valide", by: currentUserEmail || "" }] }));
    setFf({ ...ff, label: "", amount: "" });
    showToast("Frais enregistré : " + label + " — " + fmt(amount) + "."); logAudit("Import-export", "Frais d'importation", d.number + " — " + label + " — " + fmt(amount));
  };
  const annulerFraisImp = (d, c) => {
    if (!canEdit || c.status === "annulé") return;
    if (!verifDate(today, "annuler ce frais")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler ce frais ? Une écriture inverse sera passée.")) return;
    const e = contre(c.entryId, "Annulation — " + d.number + " — " + c.label + " (écriture inverse)", today, d.id);
    maj(d.id, (r) => ({ ...r, charges: r.charges.map((x) => (x.id === c.id ? { ...x, status: "annulé", reversalEntryId: e ? e.id : "" } : x)) }));
    showToast("Frais annulé.");
  };
  const payerFournisseur = (d) => {
    if (!canEdit) return;
    const usd = ieR2(fp.usd), rate = Number(fp.rate) || d.rate;
    const c = ieImpCalc(d);
    if (!d.invoiceEntryId) { showToast("Comptabilisez d'abord la facture du fournisseur."); return; }
    if (!(usd > 0)) { showToast("Indiquez le montant payé en dollars."); return; }
    if (!(rate > 0)) { showToast("Indiquez le taux du jour."); return; }
    if (usd > c.resteUSD + 0.004) { showToast("Le montant dépasse ce qui reste dû (" + ieUsd(c.resteUSD) + ")."); return; }
    if (!verifDate(fp.date, "enregistrer ce règlement")) return;
    const dette = ieR2(usd * d.rate), paye = ieR2(usd * rate), ecart = ieR2(paye - dette);
    const cpt = fp.mode === "banque" ? "512" : "530";
    ieAjouterComptes(accounts, setAccounts, ["401", cpt, ecart > 0 ? "666" : "766"]);
    const lines = [{ account: "401", debit: dette, credit: 0 }, { account: cpt, debit: 0, credit: paye }];
    if (ecart > 0) lines.push({ account: "666", debit: ecart, credit: 0 });
    else if (ecart < 0) lines.push({ account: "766", debit: 0, credit: -ecart });
    const e = ecrire(fp.date, "Importation " + d.number + " — règlement " + d.supplier + " (" + ieUsd(usd) + " à " + rate + ")", lines, d.id);
    maj(d.id, (r) => ({ ...r, payments: [...(r.payments || []), { id: ieId(), date: fp.date, usd, rate, htg: paye, dette, ecart, mode: fp.mode, entryId: e.id, status: "valide", by: currentUserEmail || "" }] }));
    setFp({ ...fp, usd: "" });
    showToast("Règlement enregistré : " + ieUsd(usd) + " = " + fmt(paye) + (ecart ? " (écart de change " + (ecart > 0 ? "perte " : "gain ") + fmt(Math.abs(ecart)) + ")" : "") + "."); logAudit("Import-export", "Règlement fournisseur", d.number + " — " + ieUsd(usd));
  };
  const annulerPaiementImp = (d, p) => {
    if (!canEdit || p.status === "annulé") return;
    if (!verifDate(today, "annuler ce règlement")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler ce règlement ? Une écriture inverse sera passée.")) return;
    const e = contre(p.entryId, "Annulation — règlement " + d.number + " (écriture inverse)", today, d.id);
    maj(d.id, (r) => ({ ...r, payments: r.payments.map((x) => (x.id === p.id ? { ...x, status: "annulé", reversalEntryId: e ? e.id : "" } : x)) }));
    showToast("Règlement annulé.");
  };
  const recevoirEnStock = (d) => {
    if (!canEdit || d.receivedToStock) return;
    if (!d.invoiceEntryId) { showToast("Comptabilisez d'abord la facture du fournisseur."); return; }
    const c = ieImpCalc(d);
    const liees = c.lineCosts.filter((l) => l.productId);
    if (!liees.length) { showToast("Aucun article de ce dossier n'est lié à un produit du stock."); return; }
    const date = today;
    const nouveaux = liees.map((l) => ({ id: uid(), date, createdAt: new Date().toISOString(), productId: (marchandises.find((p) => String(p.id) === String(l.productId)) || {}).id, productName: nomProduit(l.productId), type: "entree", qty: Number(l.qty) || 0, reason: "Importation " + d.number + " — " + d.supplier }));
    setMovements((prev) => [...prev, ...nouveaux]);
    setProducts((prev) => prev.map((p) => {
      const l = liees.find((x) => String(x.productId) === String(p.id));
      if (!l) return p;
      const qty = Number(l.qty) || 0, oldStock = Number(p.stock) || 0, oldCost = Number(p.costPrice) || 0, newStock = oldStock + qty;
      const newCost = newStock > 0 && oldStock > 0 ? ((oldStock * oldCost) + (qty * l.unitCost)) / newStock : l.unitCost;
      return { ...p, stock: newStock, costPrice: newCost };
    }));
    maj(d.id, (r) => ({ ...r, receivedToStock: true, receivedAt: date, status: "livre" }));
    showToast("Marchandises reçues en stock au coût de revient réel (" + liees.length + " produit(s)). Les frais ajoutés plus tard ne modifient plus ce coût."); logAudit("Import-export", "Réception en stock", d.number);
  };
  const supprimerImp = (d) => {
    if (!canEdit) return;
    if (d.invoiceEntryId || (d.charges || []).length || (d.payments || []).length) { showToast("Ce dossier a des écritures : il ne peut plus être supprimé (annulez-les d'abord ou conservez-le)."); return; }
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Supprimer le dossier " + d.number + " ?")) return;
    setImpex((prev) => (prev || []).filter((r) => r.id !== d.id)); setImpSel("");
  };

  const pastEtape = (etapes, s) => { const e = etapes.find((x) => x[0] === s); return e ? e[1] : s; };
  const Importations = () => {
    const d = imps.find((x) => x.id === impSel);
    return (
      <div>
        {canEdit && (
          <div className="ec-card p-4 mb-5">
            <div className="display text-base mb-2" style={{ color: "#152238" }}>Nouveau dossier d'importation</div>
            <div className="grid md:grid-cols-5 gap-2 items-end">
              <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Fournisseur étranger</label><input value={fi.supplier} onChange={(e) => setFi({ ...fi, supplier: e.target.value })} data-testid="ie-imp-fournisseur" className={ecInput} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Pays</label><input value={fi.country} onChange={(e) => setFi({ ...fi, country: e.target.value })} className={ecInput} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Taux (gourdes pour 1 dollar)</label><input type="number" min="0" step="0.01" value={fi.rate} onChange={(e) => setFi({ ...fi, rate: e.target.value })} data-testid="ie-imp-taux" className={ecInput + " tabular"} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Date de la facture</label><input type="date" value={fi.date} max={todayStr()} onChange={(e) => setFi({ ...fi, date: e.target.value })} data-testid="ie-imp-date" className={ecInput} style={ecBorder} /></div>
            </div>
            <div className="flex flex-wrap items-end gap-3 mt-2">
              <div className="flex-1 min-w-[200px]"><label className="text-xs" style={{ color: "#8A8370" }}>N° de facture ou de commande du fournisseur (facultatif)</label><input value={fi.ref} onChange={(e) => setFi({ ...fi, ref: e.target.value })} className={ecInput} style={ecBorder} /></div>
              <button onClick={creerImp} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ie-imp-creer">Créer le dossier</button>
            </div>
          </div>
        )}
        <div className="ec-wrap"><table className="ec-table"><thead><tr><th className="py-1 text-left">Dossier</th><th className="text-left">Fournisseur</th><th className="text-left">Étape</th><th className="text-right">Facture</th><th className="text-right">Reste dû</th><th className="text-right">Coût de revient</th><th></th></tr></thead>
          <tbody>{imps.slice().sort((a, b) => String(b.number).localeCompare(String(a.number))).map((x) => { const c = ieImpCalc(x); return (
            <tr key={x.id} data-testid="ie-imp-ligne" style={{ background: x.id === impSel ? "#E6F1EE" : undefined }}><td className="tabular text-xs">{x.number}</td><td>{x.supplier}{x.country ? <span className="text-xs" style={{ color: "#8A8370" }}> — {x.country}</span> : null}</td>
              <td>{ecPastille(pastEtape(IE_ETAPES_IMP, x.status), x.status === "livre" ? "ok" : x.status === "port" ? "attente" : "neutre")}</td>
              <td className="text-right tabular">{ieUsd(c.totalUSD)}</td><td className="text-right tabular">{x.invoiceEntryId ? ieUsd(c.resteUSD) : "—"}</td><td className="text-right tabular">{fmt(c.coutRevient)}</td>
              <td className="text-right"><button onClick={() => setImpSel(x.id === impSel ? "" : x.id)} className="text-xs underline" data-testid="ie-imp-ouvrir">{x.id === impSel ? "Fermer" : "Ouvrir"}</button></td></tr>); })}</tbody></table></div>
        {imps.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun dossier d'importation.</div>}
        {d && ImpDetail(d)}
      </div>
    );
  };

  const ImpDetail = (d) => {
    const c = ieImpCalc(d);
    const est = estimation(d);
    const figee = !!d.invoiceEntryId;
    const jours = d.status === "port" && d.portDate ? ieJours(d.portDate, today) : 0;
    return (
      <div className="ec-card p-4 mt-5" data-testid="ie-imp-detail">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="display text-lg" style={{ color: "#152238" }}>{d.number} — {d.supplier}</div>
          <span className="text-xs" style={{ color: "#8A8370" }}>Taux {d.rate} G/USD{d.ref ? " · réf. " + d.ref : ""}</span>
          {jours > 0 && ecPastille(jours + " j au port", jours > 17 ? "alerte" : jours > 7 ? "attente" : "neutre")}
        </div>
        <div className="grid md:grid-cols-4 gap-2 mb-4 items-end">
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Étape</label><select value={d.status} disabled={!canEdit} onChange={(e) => changerImp(d, { status: e.target.value, portDate: e.target.value === "port" && !d.portDate ? today : d.portDate })} data-testid="ie-imp-etape" className={ecInput} style={ecBorder}>{IE_ETAPES_IMP.filter((x) => x[0] !== "livre" || d.receivedToStock).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Arrivée prévue</label><input type="date" value={d.etaDate || ""} disabled={!canEdit} onChange={(e) => changerImp(d, { etaDate: e.target.value })} className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Fret (USD)</label><input type="number" min="0" value={d.freightUSD || ""} disabled={!canEdit || figee} onChange={(e) => changerImp(d, { freightUSD: Number(e.target.value) || 0 })} data-testid="ie-imp-fret" className={ecInput + " tabular"} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Assurance (USD)</label><input type="number" min="0" value={d.insuranceUSD || ""} disabled={!canEdit || figee} onChange={(e) => changerImp(d, { insuranceUSD: Number(e.target.value) || 0 })} data-testid="ie-imp-assurance" className={ecInput + " tabular"} style={ecBorder} /></div>
        </div>
        <div className="flex flex-wrap gap-4 mb-4 text-xs">{IE_DOCS_IMP.map(([k, l]) => (<label key={k} className="flex items-center gap-1"><input type="checkbox" checked={!!(d.docs || {})[k]} disabled={!canEdit} onChange={(e) => changerImp(d, { docs: { ...(d.docs || {}), [k]: e.target.checked } })} data-testid={"ie-imp-doc-" + k} />{l}</label>))}</div>

        <div className="display text-base mb-2" style={{ color: "#152238" }}>Articles</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr><th className="text-left">Article</th><th className="text-right">Quantité</th><th className="text-right">Prix unitaire (USD)</th><th className="text-right">Valeur (G)</th><th className="text-right">Coût de revient unitaire (G)</th><th></th></tr></thead>
          <tbody>{c.lineCosts.map((l) => (<tr key={l.id} data-testid="ie-imp-article"><td>{l.desc}{l.productId ? <span className="text-xs" style={{ color: "#0F6B5C" }}> · lié au stock</span> : null}</td><td className="text-right tabular">{l.qty}</td><td className="text-right tabular">{ieUsd(l.unitUSD)}</td><td className="text-right tabular">{fmt(l.lineHTG)}</td><td className="text-right tabular" data-testid="ie-imp-cout-unitaire">{fmt(l.unitCost)}</td>
            <td className="text-right">{canEdit && !figee && <button onClick={() => retirerLigneImp(d, l.id)} className="text-xs" style={{ color: "#A6432F" }}>Retirer</button>}</td></tr>))}</tbody></table></div>
        {canEdit && !figee && (
          <div className="grid md:grid-cols-5 gap-2 mb-4 items-end">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Désignation</label><input value={fl.desc} onChange={(e) => setFl({ ...fl, desc: e.target.value })} data-testid="ie-imp-ligne-desc" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Produit du stock (facultatif)</label><select value={fl.productId} onChange={(e) => setFl({ ...fl, productId: e.target.value })} data-testid="ie-imp-ligne-produit" className={ecInput} style={ecBorder}><option value="">— aucun —</option>{marchandises.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Quantité</label><input type="number" min="0" value={fl.qty} onChange={(e) => setFl({ ...fl, qty: e.target.value })} data-testid="ie-imp-ligne-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Prix unitaire (USD)</label><input type="number" min="0" step="0.01" value={fl.unitUSD} onChange={(e) => setFl({ ...fl, unitUSD: e.target.value })} data-testid="ie-imp-ligne-prix" className={ecInput + " tabular"} style={ecBorder} /></div>
            <button onClick={() => ajouterLigneImp(d)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ie-imp-ligne-ajouter">Ajouter l'article</button>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {[["Marchandise", ieUsd(c.goodsUSD) + " = " + fmt(c.goodsHTG), "ie-imp-marchandise"], ["Fret et assurance", fmt(c.fiHTG), "ie-imp-fi"], ["Total facture", ieUsd(c.totalUSD) + " = " + fmt(c.totalHTG), "ie-imp-total"], ["Coût de revient", fmt(c.coutRevient) + " (×" + (c.coef || 0).toFixed(3) + ")", "ie-imp-revient"]].map(([l, v, t]) => (
            <div key={t} className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>{l}</div><div className="text-sm font-semibold tabular" data-testid={t} style={{ color: "#152238" }}>{v}</div></div>))}
        </div>
        {canEdit && !figee && <button onClick={() => comptabiliserFactureImp(d)} className="px-3 py-2 rounded text-sm mb-4" style={ecBtnGold} data-testid="ie-imp-comptabiliser">Comptabiliser la facture du fournisseur</button>}
        {figee && <div className="text-xs mb-4" style={{ color: "#0F6B5C" }}>✓ Facture comptabilisée : {fmt(d.invoiceHTG)} dus au fournisseur (compte 401).</div>}

        <div className="display text-base mb-2" style={{ color: "#152238" }}>Droits, taxes et frais d'approche</div>
        <div className="text-xs p-2 rounded mb-3" style={{ background: "#F4F1E6", color: "#5B563F" }}>Estimation d'après vos réglages (à confirmer avec la déclaration en douane et votre expert-comptable) : droits <b className="tabular" data-testid="ie-est-duty">{fmt(est.duty)}</b> · vérification <b className="tabular">{fmt(est.verif)}</b> · 2 % <b className="tabular">{fmt(est.cfgdct)}</b> · TCA <b className="tabular" data-testid="ie-est-tca">{fmt(est.tca)}</b>. Les montants réels se saisissent ci-dessous, tels qu'ils figurent sur la quittance de douane.
          {canEdit && <span> <button onClick={() => setFf({ ...ff, kind: "duty", amount: String(est.duty), label: "" })} className="underline ml-2" data-testid="ie-utiliser-estimation">Reprendre l'estimation des droits</button></span>}</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr><th className="text-left">Date</th><th className="text-left">Frais</th><th className="text-left">Payé par</th><th className="text-right">Montant</th><th className="text-left">État</th><th></th></tr></thead>
          <tbody>{(d.charges || []).map((x) => (<tr key={x.id} data-testid="ie-imp-frais-ligne" style={{ opacity: x.status === "annulé" ? 0.55 : 1 }}><td>{ecDateFr(x.date)}</td><td>{x.label}</td><td className="text-xs">{x.mode === "banque" ? "Banque" : x.mode === "apayer" ? "À payer (fournisseur)" : "Caisse"}</td><td className="text-right tabular">{fmt(x.amount)}</td><td>{x.status === "annulé" ? ecPastille("Annulé", "neutre") : ecPastille("Valide", "ok")}</td>
            <td className="text-right">{canEdit && x.status !== "annulé" && <button onClick={() => annulerFraisImp(d, x)} className="text-xs" style={{ color: "#A6432F" }} data-testid="ie-imp-frais-annuler">Annuler</button>}</td></tr>))}</tbody></table></div>
        {canEdit && (
          <div className="grid md:grid-cols-6 gap-2 mb-4 items-end">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nature</label><select value={ff.kind} onChange={(e) => setFf({ ...ff, kind: e.target.value })} data-testid="ie-frais-nature" className={ecInput} style={ecBorder}>{IE_FRAIS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant (gourdes)</label><input type="number" min="0" value={ff.amount} onChange={(e) => setFf({ ...ff, amount: e.target.value })} data-testid="ie-frais-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" value={ff.date} max={todayStr()} onChange={(e) => setFf({ ...ff, date: e.target.value })} data-testid="ie-frais-date" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Payé par</label><select value={ff.mode} onChange={(e) => setFf({ ...ff, mode: e.target.value })} data-testid="ie-frais-mode" className={ecInput} style={ecBorder}><option value="caisse">Caisse</option><option value="banque">Banque</option><option value="apayer">À payer (dette)</option></select></div>
            <button onClick={() => ajouterFraisImp(d)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ie-frais-ajouter">Enregistrer le frais</button>
          </div>
        )}

        <div className="display text-base mb-2" style={{ color: "#152238" }}>Règlements au fournisseur (en dollars)</div>
        <div className="text-xs mb-2" style={{ color: "#7A7460" }}>Reste dû : <b className="tabular" data-testid="ie-imp-reste">{figee ? ieUsd(c.resteUSD) : "—"}</b>. Si le taux du jour diffère du taux du dossier, l'écart est constaté en gourdes (perte ou gain de change) : la comptabilité ne garde aucun dollar.</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr><th className="text-left">Date</th><th className="text-right">Dollars</th><th className="text-right">Taux</th><th className="text-right">Gourdes payées</th><th className="text-right">Écart de change</th><th className="text-left">État</th><th></th></tr></thead>
          <tbody>{(d.payments || []).map((p) => (<tr key={p.id} data-testid="ie-imp-paiement-ligne" style={{ opacity: p.status === "annulé" ? 0.55 : 1 }}><td>{ecDateFr(p.date)}</td><td className="text-right tabular">{ieUsd(p.usd)}</td><td className="text-right tabular">{p.rate}</td><td className="text-right tabular">{fmt(p.htg)}</td><td className="text-right tabular">{p.ecart > 0 ? "perte " + fmt(p.ecart) : p.ecart < 0 ? "gain " + fmt(-p.ecart) : "—"}</td><td>{p.status === "annulé" ? ecPastille("Annulé", "neutre") : ecPastille("Valide", "ok")}</td>
            <td className="text-right">{canEdit && p.status !== "annulé" && <button onClick={() => annulerPaiementImp(d, p)} className="text-xs" style={{ color: "#A6432F" }} data-testid="ie-imp-paiement-annuler">Annuler</button>}</td></tr>))}</tbody></table></div>
        {canEdit && figee && (
          <div className="grid md:grid-cols-5 gap-2 mb-4 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant payé (USD)</label><input type="number" min="0" step="0.01" value={fp.usd} onChange={(e) => setFp({ ...fp, usd: e.target.value })} data-testid="ie-paie-usd" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Taux du jour</label><input type="number" min="0" step="0.01" value={fp.rate} placeholder={String(d.rate)} onChange={(e) => setFp({ ...fp, rate: e.target.value })} data-testid="ie-paie-taux" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" value={fp.date} max={todayStr()} onChange={(e) => setFp({ ...fp, date: e.target.value })} data-testid="ie-paie-date" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Mode</label><select value={fp.mode} onChange={(e) => setFp({ ...fp, mode: e.target.value })} data-testid="ie-paie-mode" className={ecInput} style={ecBorder}><option value="banque">Banque</option><option value="caisse">Caisse</option></select></div>
            <button onClick={() => payerFournisseur(d)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ie-paie-valider">Enregistrer le règlement</button>
          </div>
        )}
        <div className="flex flex-wrap gap-3 items-center">
          {canEdit && figee && !d.receivedToStock && <button onClick={() => recevoirEnStock(d)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ie-imp-stock">Recevoir en stock au coût de revient</button>}
          {d.receivedToStock && <span className="text-xs" style={{ color: "#0F6B5C" }} data-testid="ie-imp-recu-stock">✓ Reçu en stock le {ecDateFr(d.receivedAt)}</span>}
          {canEdit && !figee && <button onClick={() => supprimerImp(d)} className="text-xs underline" style={{ color: "#A6432F" }}>Supprimer ce dossier</button>}
        </div>
      </div>
    );
  };

  // ───────── Exportations ─────────
  const [fe, setFe] = useBrouillon("impex-exp-nouveau", { customer: "", country: "", ref: "", rate: "", date: todayStr(), tcaRate: String(rates.tcaExport) });
  const creerExp = () => {
    if (!canEdit) return;
    const rate = Number(fe.rate);
    if (!fe.customer.trim()) { showToast("Indiquez le client étranger."); return; }
    if (!(rate > 0)) { showToast("Indiquez le taux du dollar en gourdes pour ce dossier."); return; }
    if (!fe.date || isFutureDate(fe.date)) { showToast("La date ne peut pas être dans le futur."); return; }
    const d = { type: "exp", id: ieId(), number: numero("EXP", exps, fe.date), customer: fe.customer.trim(), country: fe.country.trim(), ref: fe.ref.trim(), rate, date: fe.date, status: "prepare", tcaRate: Number(fe.tcaRate) || 0, docs: {}, lines: [], costs: [], receipts: [], invoiceEntryId: "", stockOut: false, createdAt: new Date().toISOString(), by: currentUserEmail || "" };
    setImpex((prev) => [...(prev || []), d]);
    setExpSel(d.id); setFe({ customer: "", country: "", ref: "", rate: fe.rate, date: todayStr(), tcaRate: String(rates.tcaExport) });
    showToast("Dossier " + d.number + " créé : ajoutez les articles, puis comptabilisez la facture."); logAudit("Import-export", "Dossier d'exportation créé", d.number + " — " + d.customer);
  };
  const [gl, setGl] = useBrouillon("impex-exp-ligne", { desc: "", productId: "", qty: "1", unitUSD: "", unitCostHTG: "" });
  const [gc, setGc] = useBrouillon("impex-exp-frais", { label: "", amount: "", date: todayStr(), mode: "caisse" });
  const [gp, setGp] = useBrouillon("impex-exp-encaissement", { usd: "", rate: "", date: todayStr(), mode: "banque" });
  const ajouterLigneExp = (d) => {
    if (!canEdit || d.invoiceEntryId) return;
    const prod = marchandises.find((p) => String(p.id) === String(gl.productId));
    const desc = (gl.desc.trim() || (prod ? prod.name : "")).trim();
    const qty = Number(gl.qty), unit = Number(gl.unitUSD);
    if (!desc) { showToast("Indiquez la désignation de l'article ou choisissez un produit."); return; }
    if (!(qty > 0)) { showToast("Indiquez une quantité supérieure à zéro."); return; }
    if (!(unit >= 0) || gl.unitUSD === "") { showToast("Indiquez le prix unitaire en dollars."); return; }
    const cost = gl.unitCostHTG !== "" ? Number(gl.unitCostHTG) || 0 : prod ? Number(prod.costPrice) || 0 : 0;
    maj(d.id, (r) => ({ ...r, lines: [...(r.lines || []), { id: ieId(), desc, productId: prod ? String(prod.id) : "", qty, unitUSD: unit, unitCostHTG: cost }] }));
    setGl({ desc: "", productId: "", qty: "1", unitUSD: "", unitCostHTG: "" });
  };
  const retirerLigneExp = (d, lid) => { if (!canEdit || d.invoiceEntryId) return; maj(d.id, (r) => ({ ...r, lines: r.lines.filter((l) => l.id !== lid) })); };
  const changerExp = (d, patch) => { if (!canEdit) return; maj(d.id, (r) => ({ ...r, ...patch })); };
  const comptabiliserFactureExp = (d) => {
    if (!canEdit || d.invoiceEntryId) return;
    const c = ieExpCalc(d);
    if (!(c.ht > 0)) { showToast("Ajoutez d'abord au moins un article avec un prix."); return; }
    if (!verifDate(d.date, "comptabiliser la facture")) return;
    ieAjouterComptes(accounts, setAccounts, ["411", "707", ...(c.tca > 0 ? ["445"] : [])]);
    const lines = [{ account: "411", debit: c.totalHTG, credit: 0 }, { account: "707", debit: 0, credit: c.ht }];
    if (c.tca > 0) lines.push({ account: "445", debit: 0, credit: c.tca });
    const e = ecrire(d.date, "Exportation " + d.number + " — facture " + d.customer + " (" + ieUsd(c.totalUSD) + " à " + d.rate + ")", lines, d.id);
    maj(d.id, (r) => ({ ...r, invoiceEntryId: e.id, invoiceHTG: c.totalHTG, invoiceUSD: c.totalUSD }));
    showToast("Facture comptabilisée : " + fmt(c.totalHTG) + " à recevoir du client."); logAudit("Import-export", "Facture d'exportation comptabilisée", d.number + " — " + fmt(c.totalHTG));
  };
  const ajouterCoutExp = (d) => {
    if (!canEdit) return;
    const amount = ieR2(gc.amount);
    if (!(amount > 0)) { showToast("Indiquez un montant en gourdes supérieur à zéro."); return; }
    if (!verifDate(gc.date, "enregistrer ce frais")) return;
    const label = gc.label.trim() || "Frais d'exportation (transport, documents)";
    ieAjouterComptes(accounts, setAccounts, ["624", compteMode(gc.mode)]);
    const e = ecrire(gc.date, "Exportation " + d.number + " — " + label, [{ account: "624", debit: amount, credit: 0 }, { account: compteMode(gc.mode), debit: 0, credit: amount }], d.id);
    maj(d.id, (r) => ({ ...r, costs: [...(r.costs || []), { id: ieId(), label, amount, date: gc.date, mode: gc.mode, entryId: e.id, status: "valide", by: currentUserEmail || "" }] }));
    setGc({ ...gc, label: "", amount: "" });
    showToast("Frais enregistré : " + fmt(amount) + ".");
  };
  const annulerCoutExp = (d, x) => {
    if (!canEdit || x.status === "annulé") return;
    if (!verifDate(today, "annuler ce frais")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler ce frais ? Une écriture inverse sera passée.")) return;
    const e = contre(x.entryId, "Annulation — " + d.number + " — " + x.label + " (écriture inverse)", today, d.id);
    maj(d.id, (r) => ({ ...r, costs: r.costs.map((y) => (y.id === x.id ? { ...y, status: "annulé", reversalEntryId: e ? e.id : "" } : y)) }));
    showToast("Frais annulé.");
  };
  const encaisserExp = (d) => {
    if (!canEdit) return;
    const usd = ieR2(gp.usd), rate = Number(gp.rate) || d.rate;
    const c = ieExpCalc(d);
    if (!d.invoiceEntryId) { showToast("Comptabilisez d'abord la facture d'exportation."); return; }
    if (!(usd > 0)) { showToast("Indiquez le montant reçu en dollars."); return; }
    if (!(rate > 0)) { showToast("Indiquez le taux du jour."); return; }
    const resteTotalUSD = ieR2(c.totalUSD * (1 + (Number(d.tcaRate) || 0) / 100) - c.receivedUSD);
    if (usd > resteTotalUSD + 0.004) { showToast("Le montant dépasse ce qui reste à recevoir (" + ieUsd(resteTotalUSD) + ")."); return; }
    if (!verifDate(gp.date, "enregistrer cet encaissement")) return;
    const creance = ieR2(usd * d.rate), recu = ieR2(usd * rate), ecart = ieR2(recu - creance);
    const cpt = gp.mode === "banque" ? "512" : "530";
    ieAjouterComptes(accounts, setAccounts, [cpt, "411", ecart > 0 ? "766" : "666"]);
    const lines = [{ account: cpt, debit: recu, credit: 0 }, { account: "411", debit: 0, credit: creance }];
    if (ecart > 0) lines.push({ account: "766", debit: 0, credit: ecart });
    else if (ecart < 0) lines.push({ account: "666", debit: -ecart, credit: 0 });
    const e = ecrire(gp.date, "Exportation " + d.number + " — encaissement " + d.customer + " (" + ieUsd(usd) + " à " + rate + ")", lines, d.id);
    maj(d.id, (r) => ({ ...r, receipts: [...(r.receipts || []), { id: ieId(), date: gp.date, usd, rate, htg: recu, creance, ecart, mode: gp.mode, entryId: e.id, status: "valide", by: currentUserEmail || "" }] }));
    setGp({ ...gp, usd: "" });
    showToast("Encaissement enregistré : " + ieUsd(usd) + " = " + fmt(recu) + (ecart ? " (écart de change " + (ecart > 0 ? "gain " : "perte ") + fmt(Math.abs(ecart)) + ")" : "") + "."); logAudit("Import-export", "Encaissement d'exportation", d.number + " — " + ieUsd(usd));
  };
  const annulerEncaissementExp = (d, r0) => {
    if (!canEdit || r0.status === "annulé") return;
    if (!verifDate(today, "annuler cet encaissement")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler cet encaissement ? Une écriture inverse sera passée.")) return;
    const e = contre(r0.entryId, "Annulation — encaissement " + d.number + " (écriture inverse)", today, d.id);
    maj(d.id, (r) => ({ ...r, receipts: r.receipts.map((x) => (x.id === r0.id ? { ...x, status: "annulé", reversalEntryId: e ? e.id : "" } : x)) }));
    showToast("Encaissement annulé.");
  };
  const sortirDuStock = (d) => {
    if (!canEdit || d.stockOut) return;
    if (!d.invoiceEntryId) { showToast("Comptabilisez d'abord la facture d'exportation."); return; }
    const liees = (d.lines || []).filter((l) => l.productId);
    if (!liees.length) { showToast("Aucun article de ce dossier n'est lié à un produit du stock."); return; }
    const manque = liees.find((l) => { const p = marchandises.find((x) => String(x.id) === String(l.productId)); return !p || (Number(p.stock) || 0) < Number(l.qty); });
    if (manque) { showToast("Stock insuffisant pour « " + manque.desc + " »."); return; }
    if (!verifDate(today, "sortir du stock")) return;
    const date = today;
    const nouveaux = liees.map((l) => ({ id: uid(), date, createdAt: new Date().toISOString(), productId: (marchandises.find((p) => String(p.id) === String(l.productId)) || {}).id, productName: nomProduit(l.productId), type: "sortie", qty: Number(l.qty) || 0, reason: "Exportation " + d.number + " — " + d.customer }));
    let cogs = 0;
    setProducts((prev) => prev.map((p) => {
      const l = liees.find((x) => String(x.productId) === String(p.id));
      if (!l) return p;
      return { ...p, stock: (Number(p.stock) || 0) - (Number(l.qty) || 0) };
    }));
    liees.forEach((l) => { const p = marchandises.find((x) => String(x.id) === String(l.productId)); cogs += ieR2((Number(l.qty) || 0) * (Number(p && p.costPrice) || Number(l.unitCostHTG) || 0)); });
    setMovements((prev) => [...prev, ...nouveaux]);
    if (stockActif && cogs > 0) {
      ieAjouterComptes(accounts, setAccounts, ["6037", "370"]);
      ecrire(date, "Exportation " + d.number + " — coût des marchandises sorties", [{ account: "6037", debit: cogs, credit: 0 }, { account: "370", debit: 0, credit: cogs }], d.id);
    }
    maj(d.id, (r) => ({ ...r, stockOut: true, stockOutAt: date, cogsBooked: stockActif ? cogs : 0 }));
    showToast("Marchandises sorties du stock" + (stockActif ? " et coût des marchandises vendues comptabilisé (" + fmt(cogs) + ")" : "") + "."); logAudit("Import-export", "Sortie de stock (exportation)", d.number);
  };
  const supprimerExp = (d) => {
    if (!canEdit) return;
    if (d.invoiceEntryId || (d.costs || []).length || (d.receipts || []).length) { showToast("Ce dossier a des écritures : il ne peut plus être supprimé."); return; }
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Supprimer le dossier " + d.number + " ?")) return;
    setImpex((prev) => (prev || []).filter((r) => r.id !== d.id)); setExpSel("");
  };
  const Exportations = () => {
    const d = exps.find((x) => x.id === expSel);
    return (
      <div>
        {canEdit && (
          <div className="ec-card p-4 mb-5">
            <div className="display text-base mb-2" style={{ color: "#152238" }}>Nouveau dossier d'exportation</div>
            <div className="grid md:grid-cols-5 gap-2 items-end">
              <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Client étranger</label><input value={fe.customer} onChange={(e) => setFe({ ...fe, customer: e.target.value })} data-testid="ie-exp-client" className={ecInput} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Pays</label><input value={fe.country} onChange={(e) => setFe({ ...fe, country: e.target.value })} className={ecInput} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Taux (gourdes pour 1 dollar)</label><input type="number" min="0" step="0.01" value={fe.rate} onChange={(e) => setFe({ ...fe, rate: e.target.value })} data-testid="ie-exp-taux" className={ecInput + " tabular"} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Date de la facture</label><input type="date" value={fe.date} max={todayStr()} onChange={(e) => setFe({ ...fe, date: e.target.value })} data-testid="ie-exp-date" className={ecInput} style={ecBorder} /></div>
            </div>
            <div className="flex flex-wrap items-end gap-3 mt-2">
              <div className="flex-1 min-w-[200px]"><label className="text-xs" style={{ color: "#8A8370" }}>N° de facture ou de commande (facultatif)</label><input value={fe.ref} onChange={(e) => setFe({ ...fe, ref: e.target.value })} className={ecInput} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>TCA sur cette exportation (%)</label><input type="number" min="0" value={fe.tcaRate} onChange={(e) => setFe({ ...fe, tcaRate: e.target.value })} data-testid="ie-exp-tca" className={ecInput + " tabular"} style={{ ...ecBorder, width: 110 }} /></div>
              <button onClick={creerExp} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ie-exp-creer">Créer le dossier</button>
            </div>
            <div className="text-xs mt-2" style={{ color: "#7A7460" }}>Par défaut 0 % : à confirmer avec votre expert-comptable (traitement de la TCA à l'exportation). Le taux par défaut se règle dans l'onglet Réglages.</div>
          </div>
        )}
        <div className="ec-wrap"><table className="ec-table"><thead><tr><th className="text-left">Dossier</th><th className="text-left">Client</th><th className="text-left">Étape</th><th className="text-right">Facture</th><th className="text-right">Reste à recevoir</th><th className="text-right">Marge</th><th></th></tr></thead>
          <tbody>{exps.slice().sort((a, b) => String(b.number).localeCompare(String(a.number))).map((x) => { const c = ieExpCalc(x); const reste = ieR2(c.totalUSD * (1 + (Number(x.tcaRate) || 0) / 100) - c.receivedUSD); return (
            <tr key={x.id} data-testid="ie-exp-ligne" style={{ background: x.id === expSel ? "#E6F1EE" : undefined }}><td className="tabular text-xs">{x.number}</td><td>{x.customer}{x.country ? <span className="text-xs" style={{ color: "#8A8370" }}> — {x.country}</span> : null}</td>
              <td>{ecPastille(pastEtape(IE_ETAPES_EXP, x.status), x.status === "solde" ? "ok" : x.status === "expedie" ? "info" : "neutre")}</td>
              <td className="text-right tabular">{ieUsd(c.totalUSD)}</td><td className="text-right tabular">{x.invoiceEntryId ? ieUsd(reste) : "—"}</td><td className="text-right tabular">{fmt(c.marge)}</td>
              <td className="text-right"><button onClick={() => setExpSel(x.id === expSel ? "" : x.id)} className="text-xs underline" data-testid="ie-exp-ouvrir">{x.id === expSel ? "Fermer" : "Ouvrir"}</button></td></tr>); })}</tbody></table></div>
        {exps.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun dossier d'exportation.</div>}
        {d && ExpDetail(d)}
      </div>
    );
  };
  const ExpDetail = (d) => {
    const c = ieExpCalc(d);
    const figee = !!d.invoiceEntryId;
    const resteUSD = ieR2(c.totalUSD * (1 + (Number(d.tcaRate) || 0) / 100) - c.receivedUSD);
    return (
      <div className="ec-card p-4 mt-5" data-testid="ie-exp-detail">
        <div className="flex flex-wrap items-center gap-3 mb-3"><div className="display text-lg" style={{ color: "#152238" }}>{d.number} — {d.customer}</div><span className="text-xs" style={{ color: "#8A8370" }}>Taux {d.rate} G/USD · TCA {d.tcaRate || 0} %{d.ref ? " · réf. " + d.ref : ""}</span></div>
        <div className="grid md:grid-cols-4 gap-2 mb-4 items-end">
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Étape</label><select value={d.status} disabled={!canEdit} onChange={(e) => changerExp(d, { status: e.target.value })} data-testid="ie-exp-etape" className={ecInput} style={ecBorder}>{IE_ETAPES_EXP.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        </div>
        <div className="flex flex-wrap gap-4 mb-4 text-xs">{IE_DOCS_EXP.map(([k, l]) => (<label key={k} className="flex items-center gap-1"><input type="checkbox" checked={!!(d.docs || {})[k]} disabled={!canEdit} onChange={(e) => changerExp(d, { docs: { ...(d.docs || {}), [k]: e.target.checked } })} data-testid={"ie-exp-doc-" + k} />{l}</label>))}</div>
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Articles exportés</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr><th className="text-left">Article</th><th className="text-right">Quantité</th><th className="text-right">Prix unitaire (USD)</th><th className="text-right">Valeur (G)</th><th className="text-right">Coût unitaire (G)</th><th></th></tr></thead>
          <tbody>{(d.lines || []).map((l) => (<tr key={l.id} data-testid="ie-exp-article"><td>{l.desc}{l.productId ? <span className="text-xs" style={{ color: "#0F6B5C" }}> · lié au stock</span> : null}</td><td className="text-right tabular">{l.qty}</td><td className="text-right tabular">{ieUsd(l.unitUSD)}</td><td className="text-right tabular">{fmt(ieR2(l.qty * l.unitUSD * d.rate))}</td><td className="text-right tabular">{fmt(l.unitCostHTG || 0)}</td>
            <td className="text-right">{canEdit && !figee && <button onClick={() => retirerLigneExp(d, l.id)} className="text-xs" style={{ color: "#A6432F" }}>Retirer</button>}</td></tr>))}</tbody></table></div>
        {canEdit && !figee && (
          <div className="grid md:grid-cols-6 gap-2 mb-4 items-end">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Désignation</label><input value={gl.desc} onChange={(e) => setGl({ ...gl, desc: e.target.value })} data-testid="ie-exp-ligne-desc" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Produit du stock (facultatif)</label><select value={gl.productId} onChange={(e) => setGl({ ...gl, productId: e.target.value })} data-testid="ie-exp-ligne-produit" className={ecInput} style={ecBorder}><option value="">— aucun —</option>{marchandises.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Quantité</label><input type="number" min="0" value={gl.qty} onChange={(e) => setGl({ ...gl, qty: e.target.value })} data-testid="ie-exp-ligne-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Prix unitaire (USD)</label><input type="number" min="0" step="0.01" value={gl.unitUSD} onChange={(e) => setGl({ ...gl, unitUSD: e.target.value })} data-testid="ie-exp-ligne-prix" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Coût unitaire (G)</label><input type="number" min="0" value={gl.unitCostHTG} placeholder="auto" onChange={(e) => setGl({ ...gl, unitCostHTG: e.target.value })} data-testid="ie-exp-ligne-cout" className={ecInput + " tabular"} style={ecBorder} /></div>
            <button onClick={() => ajouterLigneExp(d)} className="px-3 py-2 rounded text-sm md:col-span-6" style={ecBtn} data-testid="ie-exp-ligne-ajouter">Ajouter l'article</button>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {[["Facture", ieUsd(c.totalUSD) + " = " + fmt(c.ht), "ie-exp-total"], ["TCA", fmt(c.tca), "ie-exp-tca-montant"], ["Frais d'exportation", fmt(c.costs), "ie-exp-frais-total"], ["Marge du dossier", fmt(c.marge), "ie-exp-marge"]].map(([l, v, t]) => (
            <div key={t} className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>{l}</div><div className="text-sm font-semibold tabular" data-testid={t} style={{ color: "#152238" }}>{v}</div></div>))}
        </div>
        {canEdit && !figee && <button onClick={() => comptabiliserFactureExp(d)} className="px-3 py-2 rounded text-sm mb-4" style={ecBtnGold} data-testid="ie-exp-comptabiliser">Comptabiliser la facture d'exportation</button>}
        {figee && <div className="text-xs mb-4" style={{ color: "#0F6B5C" }}>✓ Facture comptabilisée : {fmt(d.invoiceHTG)} à recevoir du client (compte 411).</div>}
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Frais d'exportation</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr><th className="text-left">Date</th><th className="text-left">Frais</th><th className="text-left">Payé par</th><th className="text-right">Montant</th><th className="text-left">État</th><th></th></tr></thead>
          <tbody>{(d.costs || []).map((x) => (<tr key={x.id} data-testid="ie-exp-frais-ligne" style={{ opacity: x.status === "annulé" ? 0.55 : 1 }}><td>{ecDateFr(x.date)}</td><td>{x.label}</td><td className="text-xs">{x.mode === "banque" ? "Banque" : x.mode === "apayer" ? "À payer (fournisseur)" : "Caisse"}</td><td className="text-right tabular">{fmt(x.amount)}</td><td>{x.status === "annulé" ? ecPastille("Annulé", "neutre") : ecPastille("Valide", "ok")}</td>
            <td className="text-right">{canEdit && x.status !== "annulé" && <button onClick={() => annulerCoutExp(d, x)} className="text-xs" style={{ color: "#A6432F" }}>Annuler</button>}</td></tr>))}</tbody></table></div>
        {canEdit && (
          <div className="grid md:grid-cols-5 gap-2 mb-4 items-end">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Frais (transport, documents, courtier…)</label><input value={gc.label} onChange={(e) => setGc({ ...gc, label: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant (gourdes)</label><input type="number" min="0" value={gc.amount} onChange={(e) => setGc({ ...gc, amount: e.target.value })} data-testid="ie-expfrais-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Payé par</label><select value={gc.mode} onChange={(e) => setGc({ ...gc, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Caisse</option><option value="banque">Banque</option><option value="apayer">À payer (dette)</option></select></div>
            <button onClick={() => ajouterCoutExp(d)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ie-expfrais-ajouter">Enregistrer le frais</button>
          </div>
        )}
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Encaissements du client (en dollars)</div>
        <div className="text-xs mb-2" style={{ color: "#7A7460" }}>Reste à recevoir : <b className="tabular" data-testid="ie-exp-reste">{figee ? ieUsd(resteUSD) : "—"}</b>. L'écart entre le taux du dossier et le taux du jour est constaté en gourdes (gain ou perte de change).</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr><th className="text-left">Date</th><th className="text-right">Dollars</th><th className="text-right">Taux</th><th className="text-right">Gourdes reçues</th><th className="text-right">Écart de change</th><th className="text-left">État</th><th></th></tr></thead>
          <tbody>{(d.receipts || []).map((r) => (<tr key={r.id} data-testid="ie-exp-encaissement-ligne" style={{ opacity: r.status === "annulé" ? 0.55 : 1 }}><td>{ecDateFr(r.date)}</td><td className="text-right tabular">{ieUsd(r.usd)}</td><td className="text-right tabular">{r.rate}</td><td className="text-right tabular">{fmt(r.htg)}</td><td className="text-right tabular">{r.ecart > 0 ? "gain " + fmt(r.ecart) : r.ecart < 0 ? "perte " + fmt(-r.ecart) : "—"}</td><td>{r.status === "annulé" ? ecPastille("Annulé", "neutre") : ecPastille("Valide", "ok")}</td>
            <td className="text-right">{canEdit && r.status !== "annulé" && <button onClick={() => annulerEncaissementExp(d, r)} className="text-xs" style={{ color: "#A6432F" }}>Annuler</button>}</td></tr>))}</tbody></table></div>
        {canEdit && figee && (
          <div className="grid md:grid-cols-5 gap-2 mb-4 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant reçu (USD)</label><input type="number" min="0" step="0.01" value={gp.usd} onChange={(e) => setGp({ ...gp, usd: e.target.value })} data-testid="ie-enc-usd" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Taux du jour</label><input type="number" min="0" step="0.01" value={gp.rate} placeholder={String(d.rate)} onChange={(e) => setGp({ ...gp, rate: e.target.value })} data-testid="ie-enc-taux" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" value={gp.date} max={todayStr()} onChange={(e) => setGp({ ...gp, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Mode</label><select value={gp.mode} onChange={(e) => setGp({ ...gp, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="banque">Banque</option><option value="caisse">Caisse</option></select></div>
            <button onClick={() => encaisserExp(d)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ie-enc-valider">Enregistrer l'encaissement</button>
          </div>
        )}
        <div className="flex flex-wrap gap-3 items-center">
          {canEdit && figee && !d.stockOut && <button onClick={() => sortirDuStock(d)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ie-exp-stock">Sortir les marchandises du stock</button>}
          {d.stockOut && <span className="text-xs" style={{ color: "#0F6B5C" }} data-testid="ie-exp-sorti">✓ Sorties du stock le {ecDateFr(d.stockOutAt)}</span>}
          {canEdit && !figee && <button onClick={() => supprimerExp(d)} className="text-xs underline" style={{ color: "#A6432F" }}>Supprimer ce dossier</button>}
        </div>
      </div>
    );
  };

  // ───────── Vue d'ensemble ─────────
  const Apercu = () => {
    const impCalc = imps.map((d) => ({ d, c: ieImpCalc(d) }));
    const expCalc = exps.map((d) => ({ d, c: ieExpCalc(d) }));
    const impOuverts = imps.filter((d) => d.status !== "livre").length;
    const dettesUSD = ieR2(impCalc.filter((x) => x.d.invoiceEntryId).reduce((s, x) => s + x.c.resteUSD, 0));
    const creancesUSD = ieR2(expCalc.filter((x) => x.d.invoiceEntryId).reduce((s, x) => s + ieR2(x.c.totalUSD * (1 + (Number(x.d.tcaRate) || 0) / 100) - x.c.receivedUSD), 0));
    const enRetard = imps.filter((d) => d.status === "port" && d.portDate && ieJours(d.portDate, today) > 7);
    return (
      <div>
        {imps.length + exps.length === 0 && <div className="p-4 rounded text-sm mb-4" style={{ background: "#FFF6E0", color: "#152238" }} data-testid="ie-vide">Pour commencer : ouvrez l'onglet <b>Importations</b> ou <b>Exportations</b> et créez votre premier dossier. Vérifiez d'abord vos taux dans l'onglet <b>Réglages</b>.</div>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[["Importations en cours", String(impOuverts), "ie-kpi-imp-ouverts"], ["Dû aux fournisseurs", ieUsd(dettesUSD), "ie-kpi-dettes"], ["Exportations", String(exps.length), "ie-kpi-exp"], ["À recevoir des clients", ieUsd(creancesUSD), "ie-kpi-creances"]].map(([l, v, t]) => (
            <div key={t} className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>{l}</div><div className="display text-lg tabular" data-testid={t} style={{ color: "#152238" }}>{v}</div></div>))}
        </div>
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Marchandises au port depuis plus de 7 jours</div>
        {enRetard.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucune : rien n'attend au port.</div> : (
          <div className="ec-wrap"><table className="ec-table"><thead><tr><th className="text-left">Dossier</th><th className="text-left">Fournisseur</th><th className="text-right">Jours au port</th></tr></thead>
            <tbody>{enRetard.map((d) => (<tr key={d.id} data-testid="ie-retard-ligne"><td className="tabular text-xs">{d.number}</td><td>{d.supplier}</td><td className="text-right">{ecPastille(ieJours(d.portDate, today) + " jours", ieJours(d.portDate, today) > 17 ? "alerte" : "attente")}</td></tr>))}</tbody></table></div>
        )}
        <div className="text-xs" style={{ color: "#7A7460" }}>Les frais de magasinage et les surestaries courent tant que la marchandise n'est pas dédouanée : voyez avec votre transitaire.</div>
      </div>
    );
  };

  // ───────── Rapports ─────────
  const Rapports = () => {
    const parType = {};
    imps.forEach((d) => (d.charges || []).filter((x) => x.status !== "annulé").forEach((x) => { const k = (IE_FRAIS.find((f) => f[0] === x.kind) || [0, x.label])[1]; parType[k] = ieR2((parType[k] || 0) + x.amount); }));
    const exporterImp = () => ecTelecharger("importations-" + today + ".csv", [["Dossier", "Fournisseur", "Étape", "Facture USD", "Taux", "Marchandise G", "Fret et assurance G", "Autres frais d'approche G", "Coût de revient G", "TCA récupérable G", "Reste dû USD"], ...imps.map((d) => { const c = ieImpCalc(d); return [d.number, d.supplier, pastEtape(IE_ETAPES_IMP, d.status), c.totalUSD, d.rate, c.goodsHTG, c.fiHTG, c.chargesCout, c.coutRevient, c.chargesTca, d.invoiceEntryId ? c.resteUSD : ""]; })]);
    const exporterExp = () => ecTelecharger("exportations-" + today + ".csv", [["Dossier", "Client", "Étape", "Facture USD", "Taux", "Chiffre d'affaires G", "Coût des marchandises G", "Frais G", "Marge G", "Reste à recevoir USD"], ...exps.map((d) => { const c = ieExpCalc(d); return [d.number, d.customer, pastEtape(IE_ETAPES_EXP, d.status), c.totalUSD, d.rate, c.ht, c.cogs, c.costs, c.marge, d.invoiceEntryId ? ieR2(c.totalUSD * (1 + (Number(d.tcaRate) || 0) / 100) - c.receivedUSD) : ""]; })]);
    return (
      <div>
        <div className="flex items-center justify-between mb-2"><div className="display text-base" style={{ color: "#152238" }}>Coût de revient par importation</div><button onClick={exporterImp} className="text-xs underline" data-testid="ie-rapport-export-imp">Exporter</button></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr><th className="text-left">Dossier</th><th className="text-left">Fournisseur</th><th className="text-right">Marchandise</th><th className="text-right">Frais d'approche</th><th className="text-right">Coût de revient</th><th className="text-right">Coefficient</th></tr></thead>
          <tbody>{imps.map((d) => { const c = ieImpCalc(d); return (<tr key={d.id} data-testid="ie-rapport-imp"><td className="tabular text-xs">{d.number}</td><td>{d.supplier}</td><td className="text-right tabular">{fmt(c.goodsHTG)}</td><td className="text-right tabular">{fmt(c.approche)}</td><td className="text-right tabular">{fmt(c.coutRevient)}</td><td className="text-right tabular">{c.coef ? c.coef.toFixed(3) : "—"}</td></tr>); })}</tbody></table></div>
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Frais d'approche par nature</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr><th className="text-left">Nature</th><th className="text-right">Montant</th></tr></thead>
          <tbody>{Object.keys(parType).map((k) => (<tr key={k} data-testid="ie-rapport-type"><td>{k}</td><td className="text-right tabular">{fmt(parType[k])}</td></tr>))}</tbody></table></div>
        <div className="flex items-center justify-between mb-2"><div className="display text-base" style={{ color: "#152238" }}>Marge par exportation</div><button onClick={exporterExp} className="text-xs underline" data-testid="ie-rapport-export-exp">Exporter</button></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr><th className="text-left">Dossier</th><th className="text-left">Client</th><th className="text-right">Chiffre d'affaires</th><th className="text-right">Coût des marchandises</th><th className="text-right">Frais</th><th className="text-right">Marge</th></tr></thead>
          <tbody>{exps.map((d) => { const c = ieExpCalc(d); return (<tr key={d.id} data-testid="ie-rapport-exp"><td className="tabular text-xs">{d.number}</td><td>{d.customer}</td><td className="text-right tabular">{fmt(c.ht)}</td><td className="text-right tabular">{fmt(c.cogs)}</td><td className="text-right tabular">{fmt(c.costs)}</td><td className="text-right tabular">{fmt(c.marge)}</td></tr>); })}</tbody></table></div>
      </div>
    );
  };

  // ───────── Réglages ─────────
  const [rg, setRg] = useState(null);
  const Reglages = () => {
    const cur = rg || rates;
    const champs = [["duty", "Droits de douane (% de la valeur CIF)"], ["verif", "Taxe de vérification (% de la valeur CIF)"], ["cfgdct", "Prélèvement CFGDCT (% de la valeur CIF)"], ["tca", "TCA à l'importation (%)"], ["acompte", "Acompte d'impôt sur le revenu à l'importation (%)"], ["tcaExport", "TCA sur les exportations (%)"]];
    const enregistrer = () => {
      if (!canEdit) return;
      const r = {}; champs.forEach(([k]) => { const v = Number(cur[k]); r[k] = v >= 0 && v <= 100 ? v : IE_TAUX_DEFAUT[k]; });
      setImpex((prev) => [...(prev || []).filter((x) => !(x.type === "config")), { type: "config", id: "config", rates: r }]);
      setRg(null); showToast("Taux enregistrés. Ils servent aux estimations ; les montants réels se saisissent dossier par dossier.");
    };
    return (
      <div>
        <div className="text-xs p-2 rounded mb-4" style={{ background: "#F4F1E6", color: "#5B563F" }}>Ces taux ne servent qu'à <b>estimer</b> les droits et taxes d'un dossier. Les montants réels (quittance de douane) se saisissent dossier par dossier. Les valeurs proposées sont indicatives : <b>confirmez-les avec votre expert-comptable ou votre transitaire</b>, surtout l'acompte d'impôt sur le revenu à l'importation (0 par défaut) et la TCA à l'exportation (0 par défaut).</div>
        <div className="ec-card p-4 max-w-2xl">
          <div className="grid md:grid-cols-2 gap-3">
            {champs.map(([k, l]) => (<div key={k}><label className="text-xs" style={{ color: "#8A8370" }}>{l}</label><input type="number" min="0" max="100" step="0.1" value={cur[k]} disabled={!canEdit} onChange={(e) => setRg({ ...cur, [k]: e.target.value })} data-testid={"ie-reglage-" + k} className={ecInput + " tabular"} style={ecBorder} /></div>))}
          </div>
          {canEdit && <button onClick={enregistrer} className="mt-3 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ie-reglage-enregistrer">Enregistrer les taux</button>}
        </div>
      </div>
    );
  };

  const tabs = [["apercu", "Vue d'ensemble"], ["imports", "Importations"], ["exports", "Exportations"], ["rapports", "Rapports"], ["reglages", "Réglages"]];
  return (
    <div className="p-4 md:p-8 max-w-6xl" data-testid="importexport-module">
      <style>{EC_CSS + '[data-testid="importexport-module"] .display.text-base{border-left:3px solid #C9A24B;padding-left:10px;margin-bottom:12px}[data-testid="importexport-module"] input,[data-testid="importexport-module"] select,[data-testid="importexport-module"] textarea{background:#fff}'}</style>
      <div className="mb-4"><div className="display text-2xl" style={{ color: "#152238" }}>Import-export</div><div className="text-xs" style={{ color: "#8A8370" }}>Dossiers d'importation (coût de revient réel) et d'exportation — comptabilité toujours en gourdes</div></div>
      {!canEdit && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }}>Consultation seule : votre rôle ne permet pas de modifier les dossiers.</div>}
      <div className="ec-tabs">
        {tabs.map(([id, l]) => (<button key={id} onClick={() => setTab(id)} data-testid={"ie-tab-" + id} className="px-3 py-2 text-sm rounded-lg transition-colors" style={{ background: tab === id ? "#152238" : "transparent", color: tab === id ? "#EFE9DD" : "#6B6552", fontWeight: tab === id ? 600 : 500 }}>{l}</button>))}
      </div>
      {tab === "apercu" && Apercu()}
      {tab === "imports" && Importations()}
      {tab === "exports" && Exportations()}
      {tab === "rapports" && Rapports()}
      {tab === "reglages" && Reglages()}
    </div>
  );
}

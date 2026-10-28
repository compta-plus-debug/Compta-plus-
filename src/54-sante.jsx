// ═══ MODULE ═══
// @module Sante
// @depends EC_CSS, Plus, StatsBloc, ecBorder, ecBtn, ecBtnGold, ecDateFr, ecInput, ecPastille
//   ecTelecharger, fmt, isFutureDate, isLocked, statMois, statSomme, todayStr, uid, useBrouillon
//   useState
// @exports SanteModule
// ═══ FIN DE L'EN-TÊTE ═══
// Bloc Santé : cabinets et cliniques, pharmacies, laboratoires et imagerie, hôpitaux.
// Données administratives seulement : aucun diagnostic, aucune ordonnance, aucun résultat d'examen.
//
// Comptabilité (tout en gourdes) :
//  • facture émise : Débit 4112 (part du patient) et 4113 (part de l'assureur) / Crédit 7065 actes, 7066 examens, 7067 séjours ou 707 produits ;
//  • honoraires rétrocédés au praticien : Débit 6221 / Crédit 4678, puis paiement : Débit 4678 / Crédit caisse ou banque ;
//  • encaissement du patient : Débit caisse ou banque / Crédit 4112 ; remboursement de l'assureur : Débit banque / Crédit 4113 ;
//  • rejet d'un assureur (perte) : Débit 659 / Crédit 4113 ; report de la part rejetée sur le patient : Débit 4112 / Crédit 4113 ;
//  • pharmacie : sortie du stock à la vente ; avec la méthode « stock à l'actif » : Débit 6037 / Crédit 370.
// Chaque type d'établissement (cabinet, pharmacie, laboratoire, hôpital) a ses propres données (marque « etab »).
// Aucune TCA n'est calculée dans cette première version (à confirmer avec l'expert-comptable).

const SA_TYPES = [["cabinet", "Cabinet ou clinique"], ["pharmacie", "Pharmacie"], ["labo", "Laboratoire ou imagerie"], ["hopital", "Hôpital"]];
const SA_VOCAB = {
  cabinet: { etab: "Cabinet / clinique", Patient: "Patient", Patients: "Patients", patient: "patient", Actes: "Actes et consultations", Acte: "Acte", Praticien: "Praticien", Praticiens: "Praticiens", praticien: "praticien", Factures: "Facturation", Facture: "Facture", catDef: "consultation", slug: "cabinet" },
  pharmacie: { etab: "Pharmacie", Patient: "Client", Patients: "Clients", patient: "client", Actes: "Produits et services", Acte: "Produit", Praticien: "Pharmacien", Praticiens: "Pharmaciens", praticien: "pharmacien", Factures: "Ventes", Facture: "Vente", catDef: "produit", slug: "pharmacie" },
  labo: { etab: "Laboratoire / imagerie", Patient: "Patient", Patients: "Patients", patient: "patient", Actes: "Examens", Acte: "Examen", Praticien: "Biologiste ou prescripteur", Praticiens: "Biologistes et prescripteurs", praticien: "biologiste ou prescripteur", Factures: "Facturation", Facture: "Facture", catDef: "examen", slug: "labo" },
  hopital: { etab: "Hôpital", Patient: "Patient", Patients: "Patients", patient: "patient", Actes: "Actes et services", Acte: "Acte", Praticien: "Médecin", Praticiens: "Médecins", praticien: "médecin", Factures: "Facturation", Facture: "Facture", catDef: "consultation", slug: "hopital" },
};
const SA_CATS = [["consultation", "Consultation ou soin", "7065"], ["examen", "Examen (laboratoire, imagerie)", "7066"], ["sejour", "Séjour (hospitalisation)", "7067"], ["produit", "Produit (médicament, matériel)", "707"]];
const SA_COMPTES = {
  "4112": { name: "Clients — patients (part du patient)", type: "Actif" },
  "4113": { name: "Assureurs et organismes payeurs (tiers payant)", type: "Actif" },
  "7065": { name: "Actes médicaux et consultations", type: "Produit" },
  "7066": { name: "Examens de laboratoire et d'imagerie", type: "Produit" },
  "7067": { name: "Hospitalisation (séjours)", type: "Produit" },
  "707": { name: "Ventes de marchandises", type: "Produit" },
  "6221": { name: "Honoraires rétrocédés aux praticiens", type: "Charge" },
  "4678": { name: "Praticiens — honoraires à reverser", type: "Passif" },
  "659": { name: "Rejets et écarts de remboursement (assureurs)", type: "Charge" },
  "6037": { name: "Coût des marchandises vendues", type: "Charge" },
  "370": { name: "Stock de marchandises", type: "Actif" },
  "512": { name: "Banque", type: "Actif" },
  "530": { name: "Caisse", type: "Actif" },
};
const saNom = (x) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).sort().join(" ");
const saTel = (x) => String(x || "").replace(/\D/g, "").replace(/^509(\d{8})$/, "$1");
const saPol = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const saR2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const saId = () => String(uid());
const saRows = (rows, type) => (rows || []).filter((r) => r && r.type === type);
const saJours = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000)) : 0);
function saAjouterComptes(accounts, setAccounts, codes) {
  const missing = [...new Set(codes)].filter((k) => SA_COMPTES[k] && !accounts.some((a) => a.code === k)).map((k) => ({ code: k, name: SA_COMPTES[k].name, type: SA_COMPTES[k].type }));
  if (missing.length) setAccounts((prev) => [...prev, ...missing.filter((m) => !prev.some((a) => a.code === m.code))]);
}
// Soldes d'une facture (gourdes)
function saSoldes(inv) {
  const ok = (a) => (a || []).filter((x) => x.status !== "annulé");
  const paye = saR2(ok(inv.payments).reduce((s, x) => s + x.amount, 0));
  const recu = saR2(ok(inv.claims).reduce((s, x) => s + x.amount, 0));
  const rejet = saR2((inv.adjusts || []).filter((x) => x.kind === "rejet").reduce((s, x) => s + x.amount, 0));
  const report = saR2((inv.adjusts || []).filter((x) => x.kind === "report").reduce((s, x) => s + x.amount, 0));
  return {
    paye, recu, rejet, report,
    restePatient: saR2((inv.patientAmount || 0) + report - paye),
    resteAssureur: saR2((inv.insurerAmount || 0) - recu - rejet - report),
  };
}

function SanteModule({ sante: santeTout, setSante: setSanteBrut, entries, setEntries, accounts, setAccounts, products, setProducts, movements, setMovements, settings, role, showToast, logAudit, currentUserEmail }) {
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const isVendeur = role === "Vendeur"; // accueil (ou comptoir en pharmacie) : fiches patients, factures, encaissements, séjours
  const canFront = canEdit || isVendeur;
  const today = todayStr();
  const [tab, setTab] = useState("apercu");
  // Chaque type d'établissement a ses propres données (marque « etab » ; les enregistrements sans marque appartiennent au cabinet).
  const etabRec = santeTout.find((r) => r && r.type === "etab");
  const kind = etabRec && SA_VOCAB[etabRec.kind] ? etabRec.kind : "cabinet";
  const V = SA_VOCAB[kind];
  const peutProduits = canEdit || (isVendeur && kind === "pharmacie"); // la réception n'a pas les produits : c'est la pharmacie qui vend
  const sante = santeTout.filter((r) => r && (r.type === "etab" || (r.etab || "cabinet") === kind));
  const setSante = (fn) => setSanteBrut((prev) => {
    const base = prev || [];
    const next = typeof fn === "function" ? fn(base) : fn;
    const ids = new Set(base.map((r) => r && r.id));
    return next.map((r) => (r && r.type !== "etab" && !r.etab && !ids.has(r.id) ? { ...r, etab: kind } : r));
  });
  const patients = saRows(sante, "patient");
  const insurers = saRows(sante, "insurer");
  const practs = saRows(sante, "practitioner");
  const acts = saRows(sante, "act");
  const invoices = saRows(sante, "invoice");
  const payouts = saRows(sante, "payout");
  const stays = saRows(sante, "stay");
  const lots = saRows(sante, "lot");
  const stockActif = settings.stockValuationMethod === "actif";
  const marchandises = (products || []).filter((p) => p.type === "marchandise");
  const nomPatient = (id) => (patients.find((x) => x.id === id) || {}).name || "—";
  const nomAssureur = (id) => (insurers.find((x) => x.id === id) || {}).name || "—";
  const nomPrat = (id) => (practs.find((x) => x.id === id) || {}).name || "—";
  const compteMode = (m) => (m === "banque" ? "512" : "530");
  const maj = (id, fn) => setSante((prev) => (prev || []).map((r) => (r.id === id ? fn(r) : r)));
  const ecrire = (date, label, lines, dossierId) => {
    const e = { id: uid(), date, createdAt: new Date().toISOString(), label, lines: lines.filter((l) => l.debit > 0 || l.credit > 0), kind: "sante", dossierId };
    setEntries((prev) => [...prev, e]);
    return e;
  };
  const contre = (entryId, label, date, dossierId) => {
    const e = (entries || []).find((x) => x.id === entryId);
    if (!e) return null;
    return ecrire(date, label, e.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })), dossierId);
  };
  const verifDate = (date, action) => {
    if (!date || isFutureDate(date)) { showToast("La date ne peut pas être dans le futur."); return false; }
    if (isLocked(date, settings)) { showToast("La période comptable est clôturée jusqu'au " + settings.lockDate + " inclus : impossible de " + action + " à cette date."); return false; }
    return true;
  };
  const numeroFacture = (date) => {
    const yy = String((date || today).slice(0, 4));
    const n = saRows(santeTout, "invoice").filter((r) => String(r.number || "").startsWith("FS-" + yy + "-")).reduce((m, r) => Math.max(m, Number(String(r.number).split("-")[2]) || 0), 0) + 1;
    return "FS-" + yy + "-" + String(n).padStart(4, "0");
  };
  const numeroPatient = () => "PAT-" + String(patients.length + 1).padStart(4, "0");

  // ───────── Type d'établissement ─────────
  const choisirEtab = (k) => {
    if (!canEdit || !SA_VOCAB[k]) return;
    setSante((prev) => [...(prev || []).filter((r) => r.type !== "etab"), { type: "etab", id: "etab", kind: k }]);
    setTab("apercu");
    showToast("Vous travaillez maintenant dans : " + SA_VOCAB[k].etab + ". Les données de chaque type d'établissement sont séparées.");
  };

  // ───────── Patients, assureurs, praticiens, catalogue ─────────
  const [fp, setFp] = useBrouillon("sante-patient", { name: "", phone: "", insurerId: "", policy: "" });
  const [edP, setEdP] = useState(null);
  // Contrôle des fiches patients (doublons et fraude). Renvoie { ok, alerte }.
  const controlePatient = (d, selfId) => {
    const nom = saNom(d.name), tel = saTel(d.phone), pol = saPol(d.policy);
    const autres = patients.filter((p) => p.id !== selfId);
    const memeNom = (p) => saNom(p.name) === nom;
    const memeTel = (p) => tel.length >= 6 && saTel(p.phone) === tel;
    const memePol = (p) => pol.length >= 3 && saPol(p.policy) === pol && (!d.insurerId || !p.insurerId || d.insurerId === p.insurerId);
    const refus = (msg, detail) => { showToast(msg); logAudit("Santé", "Fiche patient bloquée", detail); return { ok: false }; };
    const dup = autres.find((p) => memeNom(p) && (memeTel(p) || memePol(p)));
    if (dup) return refus("Doublon : « " + dup.name + " » (" + dup.number + ") existe déjà avec le même " + (memeTel(dup) ? "téléphone" : "numéro de police") + ". Utilisez cette fiche.", d.name.trim() + " = " + dup.number + " (" + dup.name + ")");
    const polAutre = autres.find((p) => !memeNom(p) && memePol(p));
    if (polAutre) {
      if (!canEdit) return refus("Ce numéro de police est déjà utilisé par une autre personne (" + polAutre.number + "). Demandez au responsable de vérifier avant d'enregistrer.", d.name.trim() + " : police déjà utilisée par " + polAutre.number);
      if (typeof window !== "undefined" && window.confirm && !window.confirm("Ce numéro de police est déjà utilisé par « " + polAutre.name + " » (" + polAutre.number + "). Confirmer qu'il s'agit bien d'une police commune (famille) ?")) return { ok: false };
      logAudit("Santé", "Police partagée confirmée", d.name.trim() + " avec " + polAutre.number);
    }
    const telAutre = autres.find((p) => !memeNom(p) && memeTel(p));
    return { ok: true, alerte: telAutre ? " Attention : le même téléphone est déjà sur la fiche de « " + telAutre.name + " »." : "" };
  };
  const addPatient = () => {
    if (!canFront) return;
    if (!fp.name.trim()) { showToast("Indiquez le nom du " + V.patient + "."); return; }
    const c = controlePatient(fp, null);
    if (!c.ok) return;
    setSante((prev) => [...(prev || []), { type: "patient", id: saId(), number: numeroPatient(), name: fp.name.trim(), phone: fp.phone.trim(), insurerId: fp.insurerId || "", policy: fp.policy.trim(), createdAt: new Date().toISOString(), createdBy: currentUserEmail || "" }]);
    setFp({ name: "", phone: "", insurerId: fp.insurerId, policy: "" });
    showToast(V.Patient + " ajouté(e)." + c.alerte); logAudit("Santé", V.Patient + " ajouté(e)", fp.name.trim());
  };
  const modifierPatient = () => {
    if (!canFront || !edP) return;
    if (!edP.name.trim()) { showToast("Indiquez le nom du " + V.patient + "."); return; }
    const c = controlePatient(edP, edP.id);
    if (!c.ok) return;
    maj(edP.id, (r) => ({ ...r, name: edP.name.trim(), phone: edP.phone.trim(), insurerId: edP.insurerId || "", policy: edP.policy.trim() }));
    logAudit("Santé", "Fiche patient modifiée", edP.name.trim()); setEdP(null); showToast("Fiche modifiée." + c.alerte);
  };
  const delPatient = (p) => {
    if (!canEdit) return;
    if (invoices.some((i) => i.patientId === p.id) || stays.some((s) => s.patientId === p.id)) { showToast("Ce " + V.patient + " a des factures ou des séjours : il ne peut pas être supprimé."); return; }
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Supprimer " + p.name + " ?")) return;
    setSante((prev) => (prev || []).filter((r) => r.id !== p.id));
  };
  const [fi, setFi] = useBrouillon("sante-assureur", { name: "", phone: "", email: "", pct: "80" });
  const addInsurer = () => {
    if (!canEdit) return;
    const pct = Number(fi.pct);
    if (!fi.name.trim()) { showToast("Indiquez le nom de l'assureur."); return; }
    if (!(pct >= 0 && pct <= 100)) { showToast("La part de l'assureur doit être entre 0 et 100 %."); return; }
    if (insurers.some((x) => x.name.toLowerCase() === fi.name.trim().toLowerCase())) { showToast("Cet assureur existe déjà."); return; }
    setSante((prev) => [...(prev || []), { type: "insurer", id: saId(), name: fi.name.trim(), phone: fi.phone.trim(), email: fi.email.trim(), defaultPct: pct }]);
    setFi({ name: "", phone: "", email: "", pct: fi.pct }); showToast("Assureur ajouté.");
  };
  const delInsurer = (x) => {
    if (!canEdit) return;
    if (invoices.some((i) => i.insurerId === x.id) || patients.some((p) => p.insurerId === x.id)) { showToast("Cet assureur est utilisé : il ne peut pas être supprimé."); return; }
    setSante((prev) => (prev || []).filter((r) => r.id !== x.id));
  };
  const [fr, setFr] = useBrouillon("sante-praticien", { name: "", specialty: "", share: "0" });
  const addPract = () => {
    if (!canEdit) return;
    const share = Number(fr.share);
    if (!fr.name.trim()) { showToast("Indiquez le nom du " + V.praticien + "."); return; }
    if (!(share >= 0 && share <= 100)) { showToast("La part reversée doit être entre 0 et 100 %."); return; }
    setSante((prev) => [...(prev || []), { type: "practitioner", id: saId(), name: fr.name.trim(), specialty: fr.specialty.trim(), share }]);
    setFr({ name: "", specialty: "", share: fr.share }); showToast(V.Praticien + " ajouté(e).");
  };
  const delPract = (x) => {
    if (!canEdit) return;
    if (invoices.some((i) => i.practitionerId === x.id) || payouts.some((i) => i.practitionerId === x.id)) { showToast("Ce " + V.praticien + " a des factures ou des paiements : il ne peut pas être supprimé."); return; }
    setSante((prev) => (prev || []).filter((r) => r.id !== x.id));
  };
  const [fa, setFa] = useBrouillon("sante-acte", { code: "", label: "", price: "", cat: SA_VOCAB[kind].catDef, productId: "" });
  const addAct = () => {
    if (!canEdit) return;
    const price = Number(fa.price);
    if (!fa.label.trim()) { showToast("Indiquez le nom de l'" + V.Acte + "."); return; }
    if (!(price >= 0) || fa.price === "") { showToast("Indiquez le tarif en gourdes."); return; }
    if (acts.some((x) => x.label.toLowerCase() === fa.label.trim().toLowerCase())) { showToast("Ce nom existe déjà dans le catalogue."); return; }
    setSante((prev) => [...(prev || []), { type: "act", id: saId(), code: fa.code.trim(), label: fa.label.trim(), price: saR2(price), cat: fa.cat, productId: fa.cat === "produit" && fa.productId ? String(fa.productId) : "" }]);
    setFa({ code: "", label: "", price: "", cat: fa.cat, productId: "" }); showToast("Ajouté au catalogue.");
  };
  const delAct = (x) => {
    if (!canEdit) return;
    if (invoices.some((i) => (i.lines || []).some((l) => l.actId === x.id))) { showToast("Cet élément figure sur des factures : il ne peut pas être supprimé (modifiez plutôt son tarif)."); return; }
    setSante((prev) => (prev || []).filter((r) => r.id !== x.id));
  };
  const changerTarif = (a, v) => { if (!canEdit) return; maj(a.id, (r) => ({ ...r, price: saR2(Math.max(0, Number(v) || 0)) })); };

  // ───────── Facturation ─────────
  const [nf, setNf] = useBrouillon("sante-facture", { patientId: "", practitionerId: "", date: todayStr(), insurerId: "", pct: "", actId: "", qty: "1" });
  const [lignes, setLignes] = useState([]);
  const [sel, setSel] = useState("");
  const patientSel = patients.find((x) => x.id === nf.patientId);
  const assureurSel = insurers.find((x) => x.id === nf.insurerId);
  const pctEff = nf.insurerId ? (nf.pct !== "" ? Number(nf.pct) : (assureurSel ? assureurSel.defaultPct : 0)) : 0;
  const totalBrouillon = saR2(lignes.reduce((s, l) => s + l.qty * l.unit, 0));
  const partAssureur = nf.insurerId ? saR2(totalBrouillon * (pctEff || 0) / 100) : 0;
  const choisirPatient = (id) => {
    const p = patients.find((x) => x.id === id);
    setNf({ ...nf, patientId: id, insurerId: p && p.insurerId ? p.insurerId : "", pct: "" });
  };
  const ajouterLigne = () => {
    const a = acts.find((x) => x.id === nf.actId);
    const qty = Number(nf.qty);
    if (!a) { showToast("Choisissez un élément du catalogue."); return; }
    if (!(qty > 0)) { showToast("Indiquez une quantité supérieure à zéro."); return; }
    setLignes((prev) => [...prev, { id: saId(), actId: a.id, label: a.label, qty, unit: a.price, cat: a.cat, account: (SA_CATS.find((c) => c[0] === a.cat) || SA_CATS[0])[2], productId: a.productId || "" }]);
    setNf({ ...nf, actId: "", qty: "1" });
  };
  const emettre = (draft) => {
    if (!canFront) return;
    const d = draft || { patientId: nf.patientId, practitionerId: nf.practitionerId, date: nf.date, insurerId: nf.insurerId, pct: pctEff, lines: lignes };
    if (!d.patientId || !patients.some((x) => x.id === d.patientId)) { showToast("Choisissez le " + V.patient + "."); return; }
    if (!d.lines.length) { showToast("Ajoutez au moins un élément à facturer."); return; }
    if (!peutProduits && d.lines.some((l) => l.cat === "produit")) { showToast("La vente de produits se fait à la pharmacie."); return; }
    if (!verifDate(d.date, "émettre la facture")) return;
    const total = saR2(d.lines.reduce((s, l) => s + l.qty * l.unit, 0));
    if (!(total > 0)) { showToast("Le total de la facture doit être supérieur à zéro."); return; }
    const insurerAmount = d.insurerId ? saR2(total * (Number(d.pct) || 0) / 100) : 0;
    const patientAmount = saR2(total - insurerAmount);
    // pharmacie : contrôle du stock avant d'écrire quoi que ce soit
    const stockLignes = d.lines.filter((l) => l.productId);
    for (const l of stockLignes) {
      const p = marchandises.find((x) => String(x.id) === String(l.productId));
      if (!p || (Number(p.stock) || 0) < l.qty) { showToast("Stock insuffisant pour « " + l.label + " »."); return; }
    }
    const parCompte = {};
    d.lines.forEach((l) => { parCompte[l.account] = saR2((parCompte[l.account] || 0) + l.qty * l.unit); });
    const comptes = ["4112", "4113", ...Object.keys(parCompte)];
    const prat = practs.find((x) => x.id === d.practitionerId);
    const baseHono = saR2(d.lines.filter((l) => l.cat !== "produit").reduce((s, l) => s + l.qty * l.unit, 0));
    const honoraires = prat && prat.share > 0 ? saR2(baseHono * prat.share / 100) : 0;
    if (honoraires > 0) comptes.push("6221", "4678");
    saAjouterComptes(accounts, setAccounts, comptes);
    const id = saId();
    const number = numeroFacture(d.date);
    const lignesEcr = [];
    if (patientAmount > 0) lignesEcr.push({ account: "4112", debit: patientAmount, credit: 0 });
    if (insurerAmount > 0) lignesEcr.push({ account: "4113", debit: insurerAmount, credit: 0 });
    Object.keys(parCompte).sort().forEach((k) => lignesEcr.push({ account: k, debit: 0, credit: parCompte[k] }));
    const e = ecrire(d.date, V.Facture + " " + number + " — " + nomPatient(d.patientId), lignesEcr, id);
    let honoEntry = null;
    if (honoraires > 0) honoEntry = ecrire(d.date, "Honoraires " + number + " — " + prat.name, [{ account: "6221", debit: honoraires, credit: 0 }, { account: "4678", debit: 0, credit: honoraires }], id);
    // pharmacie : sortie de stock
    let cogsEntry = null, cogs = 0;
    if (stockLignes.length) {
      const nouveaux = stockLignes.map((l) => ({ id: uid(), date: d.date, createdAt: new Date().toISOString(), productId: (marchandises.find((p) => String(p.id) === String(l.productId)) || {}).id, productName: l.label, type: "sortie", qty: l.qty, reason: V.Facture + " " + number }));
      stockLignes.forEach((l) => { const p = marchandises.find((x) => String(x.id) === String(l.productId)); cogs += saR2(l.qty * (Number(p && p.costPrice) || 0)); });
      setProducts((prev) => prev.map((p) => { const l = stockLignes.find((x) => String(x.productId) === String(p.id)); return l ? { ...p, stock: (Number(p.stock) || 0) - l.qty } : p; }));
      setMovements((prev) => [...prev, ...nouveaux]);
      if (stockActif && cogs > 0) {
        saAjouterComptes(accounts, setAccounts, ["6037", "370"]);
        cogsEntry = ecrire(d.date, V.Facture + " " + number + " — coût des marchandises", [{ account: "6037", debit: cogs, credit: 0 }, { account: "370", debit: 0, credit: cogs }], id);
      }
    }
    const inv = { type: "invoice", id, number, date: d.date, patientId: d.patientId, practitionerId: d.practitionerId || "", insurerId: d.insurerId || "", insurerPct: d.insurerId ? Number(d.pct) || 0 : 0, lines: d.lines, total, insurerAmount, patientAmount, honoraires, entryId: e.id, honoEntryId: honoEntry ? honoEntry.id : "", cogsEntryId: cogsEntry ? cogsEntry.id : "", stockOut: stockLignes.length > 0, status: "emise", payments: [], claims: [], adjusts: [], createdAt: new Date().toISOString(), by: currentUserEmail || "", ...(d.stayId ? { stayId: d.stayId } : {}) };
    setSante((prev) => [...(prev || []), inv, ...(d.stayId ? [] : [])].map((r) => (d.stayId && r.id === d.stayId ? { ...r, invoiceId: id } : r)));
    if (!draft) { setLignes([]); setNf({ ...nf, actId: "", qty: "1" }); setSel(id); }
    showToast(V.Facture + " " + number + " émise : " + fmt(total) + (insurerAmount ? " (patient " + fmt(patientAmount) + ", assureur " + fmt(insurerAmount) + ")" : "") + ".");
    logAudit("Santé", V.Facture + " émise", number + " — " + fmt(total));
    return id;
  };
  const annulerFacture = (inv) => {
    if (!canEdit || inv.status === "annulee") return;
    const s = saSoldes(inv);
    if (s.paye > 0 || s.recu > 0 || (inv.adjusts || []).length) { showToast("Des paiements ou ajustements existent : annulez-les d'abord."); return; }
    if (!verifDate(today, "annuler la facture")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler " + inv.number + " ? Des écritures inverses seront passées.")) return;
    contre(inv.entryId, "Annulation " + inv.number + " (écriture inverse)", today, inv.id);
    if (inv.honoEntryId) contre(inv.honoEntryId, "Annulation honoraires " + inv.number + " (écriture inverse)", today, inv.id);
    if (inv.cogsEntryId) contre(inv.cogsEntryId, "Annulation coût des marchandises " + inv.number + " (écriture inverse)", today, inv.id);
    if (inv.stockOut) {
      const retour = (inv.lines || []).filter((l) => l.productId);
      setProducts((prev) => prev.map((p) => { const l = retour.find((x) => String(x.productId) === String(p.id)); return l ? { ...p, stock: (Number(p.stock) || 0) + l.qty } : p; }));
      setMovements((prev) => [...prev, ...retour.map((l) => ({ id: uid(), date: today, createdAt: new Date().toISOString(), productId: (marchandises.find((p) => String(p.id) === String(l.productId)) || {}).id, productName: l.label, type: "entree", qty: l.qty, reason: "Annulation " + inv.number }))]);
    }
    maj(inv.id, (r) => ({ ...r, status: "annulee", cancelledAt: today }));
    showToast(inv.number + " annulée.");
  };
  const [pp, setPp] = useBrouillon("sante-paiement", { amount: "", mode: "caisse", date: todayStr() });
  const [pc, setPc] = useBrouillon("sante-remboursement", { amount: "", date: todayStr() });
  const [aj, setAj] = useState({ amount: "", motif: "" });
  const encaisser = (inv) => {
    if (!canFront) return;
    const amount = saR2(pp.amount), s = saSoldes(inv);
    if (inv.status === "annulee") { showToast("Cette facture est annulée."); return; }
    if (!(amount > 0)) { showToast("Indiquez un montant supérieur à zéro."); return; }
    if (amount > s.restePatient + 0.004) { showToast("Le montant dépasse ce que le " + V.patient + " doit encore (" + fmt(s.restePatient) + ")."); return; }
    if (!verifDate(pp.date, "enregistrer cet encaissement")) return;
    saAjouterComptes(accounts, setAccounts, ["4112", compteMode(pp.mode)]);
    const e = ecrire(pp.date, "Encaissement " + inv.number + " — " + nomPatient(inv.patientId), [{ account: compteMode(pp.mode), debit: amount, credit: 0 }, { account: "4112", debit: 0, credit: amount }], inv.id);
    maj(inv.id, (r) => ({ ...r, payments: [...(r.payments || []), { id: saId(), date: pp.date, amount, mode: pp.mode, entryId: e.id, status: "valide", by: currentUserEmail || "" }] }));
    setPp({ ...pp, amount: "" }); showToast("Encaissement enregistré : " + fmt(amount) + "."); logAudit("Santé", "Encaissement", inv.number + " — " + fmt(amount));
  };
  const annulerPaiement = (inv, p) => {
    if (!canEdit || p.status === "annulé") return;
    if (!verifDate(today, "annuler cet encaissement")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler cet encaissement ? Une écriture inverse sera passée.")) return;
    const e = contre(p.entryId, "Annulation encaissement " + inv.number + " (écriture inverse)", today, inv.id);
    maj(inv.id, (r) => ({ ...r, payments: r.payments.map((x) => (x.id === p.id ? { ...x, status: "annulé", reversalEntryId: e ? e.id : "" } : x)) }));
  };
  const recevoirAssureur = (inv) => {
    if (!canEdit) return;
    const amount = saR2(pc.amount), s = saSoldes(inv);
    if (inv.status === "annulee") { showToast("Cette facture est annulée."); return; }
    if (!(amount > 0)) { showToast("Indiquez un montant supérieur à zéro."); return; }
    if (amount > s.resteAssureur + 0.004) { showToast("Le montant dépasse ce que l'assureur doit encore (" + fmt(s.resteAssureur) + ")."); return; }
    if (!verifDate(pc.date, "enregistrer ce remboursement")) return;
    saAjouterComptes(accounts, setAccounts, ["4113", "512"]);
    const e = ecrire(pc.date, "Remboursement assureur " + inv.number + " — " + nomAssureur(inv.insurerId), [{ account: "512", debit: amount, credit: 0 }, { account: "4113", debit: 0, credit: amount }], inv.id);
    maj(inv.id, (r) => ({ ...r, claims: [...(r.claims || []), { id: saId(), date: pc.date, amount, entryId: e.id, status: "valide", by: currentUserEmail || "" }] }));
    setPc({ ...pc, amount: "" }); showToast("Remboursement enregistré : " + fmt(amount) + "."); logAudit("Santé", "Remboursement assureur", inv.number + " — " + fmt(amount));
  };
  const annulerRemboursement = (inv, c) => {
    if (!canEdit || c.status === "annulé") return;
    if (!verifDate(today, "annuler ce remboursement")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler ce remboursement ? Une écriture inverse sera passée.")) return;
    const e = contre(c.entryId, "Annulation remboursement " + inv.number + " (écriture inverse)", today, inv.id);
    maj(inv.id, (r) => ({ ...r, claims: r.claims.map((x) => (x.id === c.id ? { ...x, status: "annulé", reversalEntryId: e ? e.id : "" } : x)) }));
  };
  // Part de l'assureur refusée : perte (659) ou report sur le patient (4112)
  const ajuster = (inv, kind2) => {
    if (!canEdit) return;
    const amount = saR2(aj.amount), s = saSoldes(inv), motif = aj.motif.trim();
    if (inv.status === "annulee") { showToast("Cette facture est annulée."); return; }
    if (!(amount > 0)) { showToast("Indiquez le montant refusé par l'assureur."); return; }
    if (amount > s.resteAssureur + 0.004) { showToast("Le montant dépasse ce que l'assureur doit encore (" + fmt(s.resteAssureur) + ")."); return; }
    if (motif.length < 3) { showToast("Indiquez le motif du rejet."); return; }
    if (!verifDate(today, "constater ce rejet")) return;
    saAjouterComptes(accounts, setAccounts, kind2 === "rejet" ? ["659", "4113"] : ["4112", "4113"]);
    const e = ecrire(today, (kind2 === "rejet" ? "Rejet assureur (perte) " : "Part rejetée reportée sur le patient ") + inv.number + " — " + motif, kind2 === "rejet" ? [{ account: "659", debit: amount, credit: 0 }, { account: "4113", debit: 0, credit: amount }] : [{ account: "4112", debit: amount, credit: 0 }, { account: "4113", debit: 0, credit: amount }], inv.id);
    maj(inv.id, (r) => ({ ...r, adjusts: [...(r.adjusts || []), { id: saId(), kind: kind2, amount, motif, date: today, entryId: e.id, by: currentUserEmail || "" }] }));
    setAj({ amount: "", motif: "" }); showToast(kind2 === "rejet" ? "Rejet constaté (perte)." : "Part reportée sur le " + V.patient + ".");
  };
  const [imprimer, setImprimer] = useState(null);
  const [tk, setTk] = useState(false);
  const [fq, setFq] = useState(""); const [fet, setFet] = useState(""); const [fd1, setFd1] = useState(""); const [fd2, setFd2] = useState("");
  const [pq, setPq] = useState("");
  const [rd, setRd] = useState(""); const [rf, setRf] = useState("");
  const etatFact = (x) => { if (x.status === "annulee") return "annulee"; const s0 = saSoldes(x); return s0.restePatient <= 0.004 && s0.resteAssureur <= 0.004 ? "soldee" : "encaisser"; };
  const resteDe = (id) => saR2(invoices.filter((i) => i.patientId === id && i.status !== "annulee").reduce((t, i) => t + saSoldes(i).restePatient, 0));
  const patientsF = patients.filter((x) => !pq.trim() || [x.name, x.number, x.phone, x.policy].join(" ").toLowerCase().includes(pq.trim().toLowerCase()));
  const uniq = (arr) => Array.from(new Set(arr.map((x) => String(x || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const honoDu = (x) => saR2(invoices.filter((i) => i.practitionerId === x.id && i.status !== "annulee").reduce((t, i) => t + (i.honoraires || 0), 0) - payouts.filter((y) => y.practitionerId === x.id && y.status !== "annulé").reduce((t, y) => t + y.amount, 0));
  const listesNoms = (<><datalist id="sa-dl-service">{uniq(stays.map((x) => x.service)).map((n) => <option key={n} value={n} />)}</datalist><datalist id="sa-dl-spec">{uniq(practs.map((x) => x.specialty)).map((n) => <option key={n} value={n} />)}</datalist></>);

  const FactureSheet = ({ inv }) => {
    const p = patients.find((x) => x.id === inv.patientId) || {};
    const s = saSoldes(inv);
    return (
      <div style={{ color: "#152238", background: "#fff", fontFamily: "'Inter', sans-serif", fontSize: tk ? 11 : 13, width: "100%", maxWidth: tk ? 300 : 794, margin: "0 auto", padding: tk ? "12px 10px" : "32px 36px", boxSizing: "border-box" }} data-testid="sante-facture-feuille">
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          {settings.companyLogo && <img src={settings.companyLogo} alt="" style={{ width: 60, height: 60, objectFit: "contain", margin: "0 auto 6px", display: "block" }} />}
          <div style={{ fontWeight: 700, fontSize: 20 }}>{settings.companyName || V.etab}</div>
          {settings.companyAddress && <div style={{ fontSize: 12 }}>{settings.companyAddress}</div>}
          {settings.companyPhone && <div style={{ fontSize: 12 }}>{settings.companyPhone}</div>}
          {settings.companyNIF && <div style={{ fontSize: 12 }}>NIF : {settings.companyNIF}</div>}
        </div>
        <div style={{ fontWeight: 700, fontSize: 18, textAlign: "center", marginBottom: 10 }}>{V.Facture.toUpperCase()}{inv.status === "annulee" ? " — ANNULÉE" : ""}</div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><span>N° <b>{inv.number}</b></span><span>{ecDateFr(inv.date)}</span></div>
        <div style={{ marginBottom: 10, lineHeight: 1.6 }}>{V.Patient} : <b>{p.name}</b>{p.number ? " (" + p.number + ")" : ""}{inv.practitionerId ? <><br />{V.Praticien} : {nomPrat(inv.practitionerId)}</> : null}{inv.insurerId ? <><br />Assureur : {nomAssureur(inv.insurerId)}{p.policy ? " — police " + p.policy : ""}</> : null}</div>
        <div style={{ borderTop: "1px dashed #152238", borderBottom: "1px dashed #152238", padding: "8px 0", marginBottom: 8 }}>
          {(inv.lines || []).map((l) => <div key={l.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0" }}><span>{l.label} × {l.qty}</span><span className="tabular">{fmt(l.qty * l.unit)}</span></div>)}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 18 }}><span>Total</span><span className="tabular">{fmt(inv.total)}</span></div>
        {inv.insurerAmount > 0 && <div style={{ marginTop: 4 }}>Part de l'assureur ({inv.insurerPct} %) : <span className="tabular">{fmt(inv.insurerAmount)}</span> — part du {V.patient} : <span className="tabular">{fmt(inv.patientAmount)}</span></div>}
        <div style={{ marginTop: 4 }}>Reste à payer par le {V.patient} : <span className="tabular">{fmt(s.restePatient)}</span></div>
        <div style={{ marginTop: 14, textAlign: "center", fontSize: 12 }}>Merci de votre confiance !</div>
      </div>
    );
  };

  const Facturation = () => {
    const inv = invoices.find((x) => x.id === sel);
    const invF = invoices.filter((x) => (!fet || etatFact(x) === fet) && (!fd1 || x.date >= fd1) && (!fd2 || x.date <= fd2) && (!fq.trim() || [x.number, nomPatient(x.patientId)].join(" ").toLowerCase().includes(fq.trim().toLowerCase()))).sort((a, b) => String(b.number).localeCompare(String(a.number)));
    const invFA = invF.filter((x) => x.status !== "annulee");
    return (
      <div>
        {canFront && (
          <div className="ec-card p-4 mb-5" data-testid="sante-nouvelle-facture">
            <div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvelle {V.Facture.toLowerCase()}</div>
            <div className="grid md:grid-cols-4 gap-2 items-end">
              <div><label className="text-xs" style={{ color: "#8A8370" }}>{V.Patient}</label><select value={nf.patientId} onChange={(e) => choisirPatient(e.target.value)} data-testid="sante-fact-patient" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>{V.Praticien} (facultatif)</label><select value={nf.practitionerId} onChange={(e) => setNf({ ...nf, practitionerId: e.target.value })} data-testid="sante-fact-praticien" className={ecInput} style={ecBorder}><option value="">—</option>{practs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" value={nf.date} max={todayStr()} onChange={(e) => setNf({ ...nf, date: e.target.value })} data-testid="sante-fact-date" className={ecInput} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Assureur (facultatif)</label><select value={nf.insurerId} onChange={(e) => setNf({ ...nf, insurerId: e.target.value, pct: "" })} data-testid="sante-fact-assureur" className={ecInput} style={ecBorder}><option value="">Le {V.patient} paie tout</option>{insurers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
            </div>
            <div className="grid md:grid-cols-5 gap-2 items-end mt-2">
              <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>{V.Acte} du catalogue</label><select value={nf.actId} onChange={(e) => setNf({ ...nf, actId: e.target.value })} data-testid="sante-fact-acte" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{acts.filter((a) => peutProduits || a.cat !== "produit").map((a) => <option key={a.id} value={a.id}>{a.label} — {fmt(a.price)}</option>)}</select></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Quantité</label><input type="number" min="0" value={nf.qty} onChange={(e) => setNf({ ...nf, qty: e.target.value })} data-testid="sante-fact-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
              <button onClick={ajouterLigne} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="sante-fact-ajouter">Ajouter la ligne</button>
              {nf.insurerId && <div><label className="text-xs" style={{ color: "#8A8370" }}>Part de l'assureur (%)</label><input type="number" min="0" max="100" value={nf.pct !== "" ? nf.pct : (assureurSel ? assureurSel.defaultPct : "")} onChange={(e) => setNf({ ...nf, pct: e.target.value })} data-testid="sante-fact-pct" className={ecInput + " tabular"} style={ecBorder} /></div>}
            </div>
            {lignes.length > 0 && (<div className="mt-3 text-sm">{lignes.map((l) => (<div key={l.id} className="flex justify-between gap-3 py-0.5" data-testid="sante-fact-ligne"><span>{l.label} × {l.qty}</span><span className="tabular">{fmt(l.qty * l.unit)} <button onClick={() => setLignes((prev) => prev.filter((x) => x.id !== l.id))} className="ml-2 text-xs" style={{ color: "#A6432F" }}>retirer</button></span></div>))}</div>)}
            <div className="flex flex-wrap items-center gap-4 mt-3">
              <div className="text-sm" style={{ color: "#152238" }}>Total : <b className="tabular" data-testid="sante-fact-total">{fmt(totalBrouillon)}</b>{nf.insurerId ? <> — assureur <b className="tabular" data-testid="sante-fact-part-assureur">{fmt(partAssureur)}</b> — {V.patient} <b className="tabular" data-testid="sante-fact-part-patient">{fmt(saR2(totalBrouillon - partAssureur))}</b></> : null}</div>
              <button onClick={() => emettre()} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="sante-fact-emettre">Émettre la facture</button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <div className="flex-1 min-w-[150px]"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (n°, {V.patient})</label><input value={fq} onChange={(e) => setFq(e.target.value)} data-testid="sante-fact-recherche" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>État</label><select value={fet} onChange={(e) => setFet(e.target.value)} data-testid="sante-fact-filtre-etat" className={ecInput} style={ecBorder}><option value="">Tous</option><option value="encaisser">À encaisser</option><option value="soldee">Soldée</option><option value="annulee">Annulée</option></select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Du</label><input type="date" value={fd1} onChange={(e) => setFd1(e.target.value)} data-testid="sante-fact-du" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Au</label><input type="date" value={fd2} onChange={(e) => setFd2(e.target.value)} data-testid="sante-fact-au" className={ecInput} style={ecBorder} /></div>
        </div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>Date</th><th>{V.Patient}</th><th className="text-right">Total</th><th className="text-right">Reste patient</th><th className="text-right">Reste assureur</th><th>État</th><th></th></tr></thead>
          <tbody>{invF.map((x) => { const s = saSoldes(x); return (
            <tr key={x.id} data-testid="sante-facture-ligne" style={{ background: x.id === sel ? "#E6F1EE" : undefined, opacity: x.status === "annulee" ? 0.55 : 1 }}><td className="py-1.5 tabular text-xs">{x.number}</td><td>{ecDateFr(x.date)}</td><td>{nomPatient(x.patientId)}</td><td className="text-right tabular">{fmt(x.total)}</td><td className="text-right tabular">{x.status === "annulee" ? "—" : fmt(s.restePatient)}</td><td className="text-right tabular">{x.status === "annulee" || !x.insurerId ? "—" : fmt(s.resteAssureur)}</td>
              <td>{x.status === "annulee" ? ecPastille("Annulée", "neutre") : s.restePatient <= 0.004 && s.resteAssureur <= 0.004 ? ecPastille("Soldée", "ok") : ecPastille("À encaisser", "attente")}</td>
              <td className="text-right whitespace-nowrap"><button onClick={() => setSel(x.id === sel ? "" : x.id)} className="text-xs underline mr-3" data-testid="sante-facture-ouvrir">{x.id === sel ? "Fermer" : "Ouvrir"}</button><button onClick={() => setImprimer(x)} className="text-xs underline" data-testid="sante-facture-imprimer">Imprimer</button></td></tr>); })}</tbody>
          {invF.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="sante-fact-total-ligne"><td colSpan={3}>Total ({invFA.length} facture{invFA.length > 1 ? "s" : ""}, hors annulées)</td><td className="text-right tabular" data-testid="sante-fact-tot-total">{fmt(saR2(invFA.reduce((t, x) => t + x.total, 0)))}</td><td className="text-right tabular" data-testid="sante-fact-tot-patient">{fmt(saR2(invFA.reduce((t, x) => t + saSoldes(x).restePatient, 0)))}</td><td className="text-right tabular" data-testid="sante-fact-tot-assureur">{fmt(saR2(invFA.reduce((t, x) => t + saSoldes(x).resteAssureur, 0)))}</td><td colSpan={2}></td></tr></tfoot>}
        </table></div>
        {invF.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{invoices.length === 0 ? "Aucune facture." : "Aucune facture ne correspond à ces filtres."}</div>}
        {inv && FactureDetail(inv)}
      </div>
    );
  };
  const FactureDetail = (inv) => {
    const s = saSoldes(inv);
    return (
      <div className="ec-card p-4 mt-5" data-testid="sante-facture-detail">
        <div className="flex flex-wrap items-center gap-3 mb-3"><div className="display text-lg" style={{ color: "#152238" }}>{inv.number} — {nomPatient(inv.patientId)}</div><span className="text-xs" style={{ color: "#8A8370" }}>{fmt(inv.total)}{inv.insurerId ? " · assureur " + nomAssureur(inv.insurerId) + " " + inv.insurerPct + " %" : ""}{inv.practitionerId ? " · " + nomPrat(inv.practitionerId) : ""}</span></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {[["Part du " + V.patient, fmt(inv.patientAmount), "sante-det-part-patient"], ["Reste " + V.patient, fmt(s.restePatient), "sante-det-reste-patient"], ["Part assureur", fmt(inv.insurerAmount), "sante-det-part-assureur"], ["Reste assureur", fmt(s.resteAssureur), "sante-det-reste-assureur"]].map(([l, v, t]) => (
            <div key={t} className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>{l}</div><div className="text-sm font-semibold tabular" data-testid={t} style={{ color: "#152238" }}>{v}</div></div>))}
        </div>
        {inv.honoraires > 0 && <div className="text-xs mb-3" style={{ color: "#7A7460" }}>Honoraires à reverser au {V.praticien} : {fmt(inv.honoraires)}.</div>}
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Encaissements du {V.patient}</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Mode</th><th className="text-right">Montant</th><th>État</th><th></th></tr></thead>
          <tbody>{(inv.payments || []).map((p) => (<tr key={p.id} data-testid="sante-paiement-ligne" style={{ opacity: p.status === "annulé" ? 0.55 : 1 }}><td className="py-1.5">{ecDateFr(p.date)}</td><td>{p.mode === "banque" ? "Banque" : "Espèces"}</td><td className="text-right tabular">{fmt(p.amount)}</td><td>{p.status === "annulé" ? ecPastille("Annulé", "neutre") : ecPastille("Valide", "ok")}</td><td className="text-right">{canEdit && p.status !== "annulé" && <button onClick={() => annulerPaiement(inv, p)} className="text-xs" style={{ color: "#A6432F" }} data-testid="sante-paiement-annuler">Annuler</button>}</td></tr>))}</tbody></table></div>
        {canFront && inv.status !== "annulee" && (<div className="grid md:grid-cols-4 gap-2 mb-4 items-end">
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant reçu</label><input type="number" min="0" value={pp.amount} onChange={(e) => setPp({ ...pp, amount: e.target.value })} data-testid="sante-enc-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Mode</label><select value={pp.mode} onChange={(e) => setPp({ ...pp, mode: e.target.value })} data-testid="sante-enc-mode" className={ecInput} style={ecBorder}><option value="caisse">Espèces</option><option value="banque">Banque</option></select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" value={pp.date} max={todayStr()} onChange={(e) => setPp({ ...pp, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
          <button onClick={() => encaisser(inv)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="sante-enc-valider">Enregistrer l'encaissement</button>
        </div>)}
        {inv.insurerId && (<>
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Remboursements de l'assureur</div>
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th className="text-right">Montant</th><th>État</th><th></th></tr></thead>
            <tbody>{(inv.claims || []).map((c) => (<tr key={c.id} data-testid="sante-remb-ligne" style={{ opacity: c.status === "annulé" ? 0.55 : 1 }}><td className="py-1.5">{ecDateFr(c.date)}</td><td className="text-right tabular">{fmt(c.amount)}</td><td>{c.status === "annulé" ? ecPastille("Annulé", "neutre") : ecPastille("Valide", "ok")}</td><td className="text-right">{canEdit && c.status !== "annulé" && <button onClick={() => annulerRemboursement(inv, c)} className="text-xs" style={{ color: "#A6432F" }}>Annuler</button>}</td></tr>))}
              {(inv.adjusts || []).map((a) => (<tr key={a.id} data-testid="sante-ajust-ligne"><td className="py-1.5">{ecDateFr(a.date)}</td><td className="text-right tabular">{fmt(a.amount)}</td><td colSpan={2}>{a.kind === "rejet" ? ecPastille("Rejet (perte)", "alerte") : ecPastille("Reporté sur le " + V.patient, "info")} <span className="text-xs">{a.motif}</span></td></tr>))}</tbody></table></div>
          {canEdit && inv.status !== "annulee" && (<div className="grid md:grid-cols-5 gap-2 mb-4 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant reçu de l'assureur</label><input type="number" min="0" value={pc.amount} onChange={(e) => setPc({ ...pc, amount: e.target.value })} data-testid="sante-remb-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" value={pc.date} max={todayStr()} onChange={(e) => setPc({ ...pc, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <button onClick={() => recevoirAssureur(inv)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="sante-remb-valider">Enregistrer le remboursement</button>
          </div>)}
          {canEdit && inv.status !== "annulee" && s.resteAssureur > 0.004 && (<div className="grid md:grid-cols-5 gap-2 mb-4 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant refusé</label><input type="number" min="0" value={aj.amount} onChange={(e) => setAj({ ...aj, amount: e.target.value })} data-testid="sante-rejet-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Motif du rejet (obligatoire)</label><input value={aj.motif} onChange={(e) => setAj({ ...aj, motif: e.target.value })} data-testid="sante-rejet-motif" className={ecInput} style={ecBorder} /></div>
            <button onClick={() => ajuster(inv, "report")} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="sante-rejet-report">Reporter sur le {V.patient}</button>
            <button onClick={() => ajuster(inv, "rejet")} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="sante-rejet-perte">Constater la perte</button>
          </div>)}
        </>)}
        <div className="flex flex-wrap gap-3 items-center">{canEdit && inv.status !== "annulee" && <button onClick={() => annulerFacture(inv)} className="text-xs underline" style={{ color: "#A6432F" }} data-testid="sante-facture-annuler">Annuler cette facture</button>}</div>
      </div>
    );
  };

  // ───────── Onglets simples ─────────
  const Patients = () => (
    <div>
      {canFront && (<div className="ec-card p-4 mb-5"><div className="grid md:grid-cols-5 gap-2 items-end">
        <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom du {V.patient}</label><input value={fp.name} onChange={(e) => setFp({ ...fp, name: e.target.value })} data-testid="sante-patient-nom" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Téléphone</label><input type="tel" value={fp.phone} onChange={(e) => setFp({ ...fp, phone: e.target.value })} className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Assureur</label><select value={fp.insurerId} onChange={(e) => setFp({ ...fp, insurerId: e.target.value })} data-testid="sante-patient-assureur" className={ecInput} style={ecBorder}><option value="">Aucun</option>{insurers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>N° de police</label><input value={fp.policy} onChange={(e) => setFp({ ...fp, policy: e.target.value })} className={ecInput} style={ecBorder} /></div>
      </div><button onClick={addPatient} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="sante-patient-ajouter">Ajouter</button>
      <div className="text-xs mt-2" style={{ color: "#7A7460" }}>Données administratives seulement : n'enregistrez ici ni diagnostic, ni ordonnance, ni résultat d'examen.</div></div>)}
      <div className="mb-2"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (nom, n°, téléphone, police)</label><input value={pq} onChange={(e) => setPq(e.target.value)} data-testid="sante-patient-recherche" className={ecInput} style={{ ...ecBorder, maxWidth: 360 }} /></div>
      <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>{V.Patient}</th><th>Téléphone</th><th>Assureur</th><th className="text-right">Reste à payer</th><th></th></tr></thead>
        <tbody>{patientsF.map((p) => { const reste = resteDe(p.id); return (
          <tr key={p.id} data-testid="sante-patient-ligne">{edP && edP.id === p.id ? (<>
            <td className="py-1.5 tabular text-xs">{p.number}</td>
            <td><input value={edP.name} onChange={(e) => setEdP({ ...edP, name: e.target.value })} data-testid="sante-patient-edit-nom" className="border rounded px-1 py-0.5 text-xs" style={ecBorder} /><div className="mt-1"><input value={edP.policy} onChange={(e) => setEdP({ ...edP, policy: e.target.value })} placeholder="N° de police" data-testid="sante-patient-edit-police" className="border rounded px-1 py-0.5 text-xs" style={ecBorder} /></div></td>
            <td><input value={edP.phone} onChange={(e) => setEdP({ ...edP, phone: e.target.value })} data-testid="sante-patient-edit-tel" className="border rounded px-1 py-0.5 text-xs" style={ecBorder} /></td>
            <td><select value={edP.insurerId} onChange={(e) => setEdP({ ...edP, insurerId: e.target.value })} className="border rounded px-1 py-0.5 text-xs" style={ecBorder}><option value="">Aucun</option>{insurers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
            <td></td><td className="text-right whitespace-nowrap"><button onClick={modifierPatient} className="text-xs underline mr-3" data-testid="sante-patient-edit-ok">Enregistrer</button><button onClick={() => setEdP(null)} className="text-xs">Annuler</button></td></>) : (<>
            <td className="py-1.5 tabular text-xs">{p.number}</td><td>{p.name}</td><td>{p.phone || "—"}</td><td>{p.insurerId ? nomAssureur(p.insurerId) : "—"}</td><td className="text-right tabular">{fmt(reste)}</td><td className="text-right whitespace-nowrap">{canFront && <button onClick={() => setEdP({ id: p.id, name: p.name, phone: p.phone || "", insurerId: p.insurerId || "", policy: p.policy || "" })} className="text-xs underline mr-3" data-testid="sante-patient-modifier">Modifier</button>}{canEdit && <button onClick={() => delPatient(p)} className="text-xs" style={{ color: "#A6432F" }} data-testid="sante-patient-supprimer">Supprimer</button>}</td></>)}</tr>); })}</tbody>
        {patientsF.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="sante-patient-total-ligne"><td colSpan={4}>Total ({patientsF.length})</td><td className="text-right tabular" data-testid="sante-patient-tot-reste">{fmt(saR2(patientsF.reduce((t, x) => t + resteDe(x.id), 0)))}</td><td></td></tr></tfoot>}
      </table></div>
      {patientsF.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{patients.length === 0 ? "Aucun " + V.patient + "." : "Aucun résultat."}</div>}
    </div>
  );
  const Catalogue = () => (
    <div>
      <div className="text-xs p-2 rounded mb-4" style={{ background: "#F4F1E6", color: "#5B563F" }}>Le catalogue fixe le tarif de chaque {V.Acte.toLowerCase()}. Chaque catégorie alimente un compte de produits : consultations et soins 7065, examens 7066, séjours 7067, produits 707. Aucune TCA n'est calculée dans cette version : à confirmer avec votre expert-comptable.</div>
      {canEdit && (<div className="ec-card p-4 mb-5"><div className="grid md:grid-cols-6 gap-2 items-end">
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Code (facultatif)</label><input value={fa.code} onChange={(e) => setFa({ ...fa, code: e.target.value })} className={ecInput} style={ecBorder} /></div>
        <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom</label><input value={fa.label} onChange={(e) => setFa({ ...fa, label: e.target.value })} data-testid="sante-acte-nom" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Catégorie</label><select value={fa.cat} onChange={(e) => setFa({ ...fa, cat: e.target.value })} data-testid="sante-acte-cat" className={ecInput} style={ecBorder}>{SA_CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Tarif (gourdes)</label><input type="number" min="0" value={fa.price} onChange={(e) => setFa({ ...fa, price: e.target.value })} data-testid="sante-acte-prix" className={ecInput + " tabular"} style={ecBorder} /></div>
        {fa.cat === "produit" ? <div><label className="text-xs" style={{ color: "#8A8370" }}>Produit du stock</label><select value={fa.productId} onChange={(e) => setFa({ ...fa, productId: e.target.value })} data-testid="sante-acte-produit" className={ecInput} style={ecBorder}><option value="">— aucun —</option>{marchandises.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div> : <div></div>}
      </div><button onClick={addAct} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="sante-acte-ajouter">Ajouter au catalogue</button></div>)}
      <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Code</th><th>Nom</th><th>Catégorie</th><th className="text-right">Tarif</th><th></th></tr></thead>
        <tbody>{acts.map((a) => (<tr key={a.id} data-testid="sante-acte-ligne"><td className="py-1.5 tabular text-xs">{a.code || "—"}</td><td>{a.label}{a.productId ? <span className="text-xs" style={{ color: "#0F6B5C" }}> · lié au stock</span> : null}</td><td className="text-xs">{(SA_CATS.find((c) => c[0] === a.cat) || [0, a.cat])[1]}</td>
          <td className="text-right">{canEdit ? <input type="number" min="0" value={a.price} onChange={(e) => changerTarif(a, e.target.value)} className="border rounded px-1 py-0.5 text-xs tabular" style={{ ...ecBorder, width: 90 }} /> : fmt(a.price)}</td><td className="text-right">{canEdit && <button onClick={() => delAct(a)} className="text-xs" style={{ color: "#A6432F" }}>Supprimer</button>}</td></tr>))}</tbody></table></div>
      {acts.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Catalogue vide : ajoutez vos premiers {V.Actes.toLowerCase()}.</div>}
    </div>
  );
  const [fh, setFh] = useBrouillon("sante-honoraires", { practitionerId: "", amount: "", mode: "caisse", date: todayStr() });
  const verser = () => {
    if (!canEdit) return;
    const amount = saR2(fh.amount);
    const pr = practs.find((x) => x.id === fh.practitionerId);
    if (!pr) { showToast("Choisissez le " + V.praticien + "."); return; }
    const du = saR2(invoices.filter((i) => i.practitionerId === pr.id && i.status !== "annulee").reduce((s, i) => s + (i.honoraires || 0), 0) - payouts.filter((x) => x.practitionerId === pr.id && x.status !== "annulé").reduce((s, x) => s + x.amount, 0));
    if (!(amount > 0)) { showToast("Indiquez un montant supérieur à zéro."); return; }
    if (amount > du + 0.004) { showToast("Le montant dépasse les honoraires à reverser (" + fmt(du) + ")."); return; }
    if (!verifDate(fh.date, "enregistrer ce paiement")) return;
    saAjouterComptes(accounts, setAccounts, ["4678", compteMode(fh.mode)]);
    const e = ecrire(fh.date, "Honoraires versés — " + pr.name, [{ account: "4678", debit: amount, credit: 0 }, { account: compteMode(fh.mode), debit: 0, credit: amount }], pr.id);
    setSante((prev) => [...(prev || []), { type: "payout", id: saId(), practitionerId: pr.id, amount, date: fh.date, mode: fh.mode, entryId: e.id, status: "valide", by: currentUserEmail || "" }]);
    setFh({ ...fh, amount: "" }); showToast("Paiement enregistré : " + fmt(amount) + ".");
  };
  const Praticiens = () => (
    <div>
      {canEdit && (<div className="ec-card p-4 mb-5"><div className="grid md:grid-cols-4 gap-2 items-end">
        <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom</label><input value={fr.name} onChange={(e) => setFr({ ...fr, name: e.target.value })} data-testid="sante-prat-nom" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Spécialité</label><input list="sa-dl-spec" value={fr.specialty} onChange={(e) => setFr({ ...fr, specialty: e.target.value })} className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Part reversée (%)</label><input type="number" min="0" max="100" value={fr.share} onChange={(e) => setFr({ ...fr, share: e.target.value })} data-testid="sante-prat-part" className={ecInput + " tabular"} style={ecBorder} /></div>
      </div><button onClick={addPract} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="sante-prat-ajouter">Ajouter</button>
      <div className="text-xs mt-2" style={{ color: "#7A7460" }}>La part reversée s'applique au montant des consultations, soins, examens et séjours de chaque facture où le {V.praticien} est indiqué (pas aux produits).</div></div>)}
      <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">{V.Praticien}</th><th>Spécialité</th><th className="text-right">Part</th><th className="text-right">Facturé</th><th className="text-right">Honoraires dus</th><th className="text-right">Versé</th><th className="text-right">Reste à verser</th><th></th></tr></thead>
        <tbody>{practs.map((x) => { const mine = invoices.filter((i) => i.practitionerId === x.id && i.status !== "annulee"); const fact = saR2(mine.reduce((s, i) => s + i.total, 0)); const dus = saR2(mine.reduce((s, i) => s + (i.honoraires || 0), 0)); const vers = saR2(payouts.filter((p) => p.practitionerId === x.id && p.status !== "annulé").reduce((s, p) => s + p.amount, 0)); return (
          <tr key={x.id} data-testid="sante-prat-ligne"><td className="py-1.5">{x.name}</td><td className="text-xs">{x.specialty || "—"}</td><td className="text-right tabular">{x.share} %</td><td className="text-right tabular">{fmt(fact)}</td><td className="text-right tabular">{fmt(dus)}</td><td className="text-right tabular">{fmt(vers)}</td><td className="text-right tabular" data-testid="sante-prat-reste">{fmt(saR2(dus - vers))}</td><td className="text-right">{canEdit && <button onClick={() => delPract(x)} className="text-xs" style={{ color: "#A6432F" }}>Supprimer</button>}</td></tr>); })}</tbody></table></div>
      {canEdit && practs.length > 0 && (<div className="ec-card p-4 mb-4"><div className="display text-base mb-2" style={{ color: "#152238" }}>Verser des honoraires</div><div className="grid md:grid-cols-5 gap-2 items-end">
        <div><label className="text-xs" style={{ color: "#8A8370" }}>{V.Praticien}</label><select value={fh.practitionerId} onChange={(e) => setFh({ ...fh, practitionerId: e.target.value })} data-testid="sante-hono-prat" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{practs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant</label><input type="number" min="0" value={fh.amount} onChange={(e) => setFh({ ...fh, amount: e.target.value })} data-testid="sante-hono-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Mode</label><select value={fh.mode} onChange={(e) => setFh({ ...fh, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Espèces</option><option value="banque">Banque</option></select></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" value={fh.date} max={todayStr()} onChange={(e) => setFh({ ...fh, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
        <button onClick={verser} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="sante-hono-valider">Enregistrer le paiement</button>
      </div></div>)}
    </div>
  );
  const Assureurs = () => (
    <div>
      {canEdit && (<div className="ec-card p-4 mb-5"><div className="grid md:grid-cols-5 gap-2 items-end">
        <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom de l'assureur</label><input value={fi.name} onChange={(e) => setFi({ ...fi, name: e.target.value })} data-testid="sante-assureur-nom" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Téléphone</label><input value={fi.phone} onChange={(e) => setFi({ ...fi, phone: e.target.value })} className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>E-mail</label><input value={fi.email} onChange={(e) => setFi({ ...fi, email: e.target.value })} className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Part payée par défaut (%)</label><input type="number" min="0" max="100" value={fi.pct} onChange={(e) => setFi({ ...fi, pct: e.target.value })} data-testid="sante-assureur-pct" className={ecInput + " tabular"} style={ecBorder} /></div>
      </div><button onClick={addInsurer} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="sante-assureur-ajouter">Ajouter</button></div>)}
      <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Assureur</th><th>Contact</th><th className="text-right">Part</th><th className="text-right">Facturé</th><th className="text-right">Reçu</th><th className="text-right">Rejeté</th><th className="text-right">Reste à recevoir</th><th></th></tr></thead>
        <tbody>{insurers.map((x) => { const mine = invoices.filter((i) => i.insurerId === x.id && i.status !== "annulee"); const sol = mine.map(saSoldes); const fact = saR2(mine.reduce((s, i) => s + i.insurerAmount, 0)); return (
          <tr key={x.id} data-testid="sante-assureur-ligne"><td className="py-1.5">{x.name}</td><td className="text-xs">{[x.phone, x.email].filter(Boolean).join(" · ") || "—"}</td><td className="text-right tabular">{x.defaultPct} %</td><td className="text-right tabular">{fmt(fact)}</td><td className="text-right tabular">{fmt(saR2(sol.reduce((s, y) => s + y.recu, 0)))}</td><td className="text-right tabular">{fmt(saR2(sol.reduce((s, y) => s + y.rejet + y.report, 0)))}</td><td className="text-right tabular" data-testid="sante-assureur-reste">{fmt(saR2(sol.reduce((s, y) => s + y.resteAssureur, 0)))}</td><td className="text-right">{canEdit && <button onClick={() => delInsurer(x)} className="text-xs" style={{ color: "#A6432F" }}>Supprimer</button>}</td></tr>); })}</tbody>
        {insurers.length > 0 && (() => { const tot = (f) => saR2(insurers.reduce((t, x) => t + f(invoices.filter((i) => i.insurerId === x.id && i.status !== "annulee")), 0)); return (<tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="sante-assureur-total-ligne"><td colSpan={3}>Total</td><td className="text-right tabular">{fmt(tot((m) => m.reduce((t, i) => t + i.insurerAmount, 0)))}</td><td className="text-right tabular">{fmt(tot((m) => m.reduce((t, i) => t + saSoldes(i).recu, 0)))}</td><td className="text-right tabular">{fmt(tot((m) => m.reduce((t, i) => t + saSoldes(i).rejet, 0)))}</td><td className="text-right tabular" data-testid="sante-assureur-tot-reste">{fmt(tot((m) => m.reduce((t, i) => t + saSoldes(i).resteAssureur, 0)))}</td><td></td></tr></tfoot>); })()}
      </table></div>
      {insurers.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun assureur : sans assureur, le {V.patient} paie la totalité.</div>}
    </div>
  );

  // ───────── Hôpital : séjours ─────────
  const [fsj, setFsj] = useBrouillon("sante-sejour", { patientId: "", service: "", admitDate: todayStr(), rate: "" });
  const [sortieDate, setSortieDate] = useState({});
  const admettre = () => {
    if (!canFront) return;
    const rate = Number(fsj.rate);
    if (!fsj.patientId || !patients.some((x) => x.id === fsj.patientId)) { showToast("Choisissez le " + V.patient + "."); return; }
    if (!fsj.service.trim()) { showToast("Indiquez le service (ex. Maternité, Chirurgie)."); return; }
    if (!(rate > 0)) { showToast("Indiquez le tarif de la journée."); return; }
    if (!fsj.admitDate || isFutureDate(fsj.admitDate)) { showToast("La date d'admission ne peut pas être dans le futur."); return; }
    setSante((prev) => [...(prev || []), { type: "stay", id: saId(), patientId: fsj.patientId, service: fsj.service.trim(), admitDate: fsj.admitDate, dischargeDate: "", rate: saR2(rate), invoiceId: "" }]);
    setFsj({ ...fsj, service: "", rate: fsj.rate }); showToast("Admission enregistrée.");
  };
  const facturerSejour = (st) => {
    if (!canFront || st.invoiceId) return;
    const sortie = sortieDate[st.id] || st.dischargeDate;
    if (!sortie) { showToast("Indiquez la date de sortie."); return; }
    if (sortie < st.admitDate) { showToast("La sortie ne peut pas précéder l'admission."); return; }
    if (isFutureDate(sortie)) { showToast("La date de sortie ne peut pas être dans le futur."); return; }
    const jours = Math.max(1, saJours(st.admitDate, sortie));
    const p = patients.find((x) => x.id === st.patientId) || {};
    const ins = insurers.find((x) => x.id === p.insurerId);
    const draft = { patientId: st.patientId, practitionerId: "", date: sortie, insurerId: ins ? ins.id : "", pct: ins ? ins.defaultPct : 0, stayId: st.id,
      lines: [{ id: saId(), actId: "", label: "Séjour " + st.service + " (" + jours + " jour" + (jours > 1 ? "s" : "") + ")", qty: jours, unit: st.rate, cat: "sejour", account: "7067", productId: "" }] };
    const idF = emettre(draft);
    if (idF) maj(st.id, (r) => ({ ...r, dischargeDate: sortie, invoiceId: idF }));
  };
  const Sejours = () => (
    <div>
      {canFront && (<div className="ec-card p-4 mb-5"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvelle admission</div><div className="grid md:grid-cols-5 gap-2 items-end">
        <div><label className="text-xs" style={{ color: "#8A8370" }}>{V.Patient}</label><select value={fsj.patientId} onChange={(e) => setFsj({ ...fsj, patientId: e.target.value })} data-testid="sante-sejour-patient" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Service</label><input list="sa-dl-service" value={fsj.service} onChange={(e) => setFsj({ ...fsj, service: e.target.value })} data-testid="sante-sejour-service" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Admission</label><input type="date" value={fsj.admitDate} max={todayStr()} onChange={(e) => setFsj({ ...fsj, admitDate: e.target.value })} className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Tarif par jour</label><input type="number" min="0" value={fsj.rate} onChange={(e) => setFsj({ ...fsj, rate: e.target.value })} data-testid="sante-sejour-tarif" className={ecInput + " tabular"} style={ecBorder} /></div>
        <button onClick={admettre} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="sante-sejour-admettre">Admettre</button>
      </div></div>)}
      <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">{V.Patient}</th><th>Service</th><th>Admission</th><th>Sortie</th><th className="text-right">Tarif / jour</th><th>État</th><th></th></tr></thead>
        <tbody>{stays.map((st) => (<tr key={st.id} data-testid="sante-sejour-ligne"><td className="py-1.5">{nomPatient(st.patientId)}</td><td>{st.service}</td><td>{ecDateFr(st.admitDate)}</td>
          <td>{st.invoiceId ? ecDateFr(st.dischargeDate) : canFront ? <input type="date" value={sortieDate[st.id] || ""} min={st.admitDate} max={todayStr()} onChange={(e) => setSortieDate({ ...sortieDate, [st.id]: e.target.value })} data-testid="sante-sejour-sortie" className="border rounded px-1 py-0.5 text-xs" style={ecBorder} /> : "—"}</td>
          <td className="text-right tabular">{fmt(st.rate)}</td><td>{st.invoiceId ? ecPastille("Facturé", "ok") : ecPastille("En cours", "attente")}</td>
          <td className="text-right">{canFront && !st.invoiceId && <button onClick={() => facturerSejour(st)} className="text-xs underline" data-testid="sante-sejour-facturer">Sortie et facturation</button>}</td></tr>))}</tbody></table></div>
      {stays.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun séjour.</div>}
    </div>
  );

  // ───────── Pharmacie : lots et péremptions ─────────
  const [fl, setFl] = useBrouillon("sante-lot", { productId: "", name: "", lot: "", expiry: "", qty: "" });
  const addLot = () => {
    if (!canEdit) return;
    const prod = marchandises.find((p) => String(p.id) === String(fl.productId));
    const name = (fl.name.trim() || (prod ? prod.name : "")).trim();
    const qty = Number(fl.qty);
    if (!name) { showToast("Indiquez le produit."); return; }
    if (!fl.lot.trim()) { showToast("Indiquez le numéro de lot."); return; }
    if (!fl.expiry) { showToast("Indiquez la date de péremption."); return; }
    if (!(qty > 0)) { showToast("Indiquez la quantité du lot."); return; }
    setSante((prev) => [...(prev || []), { type: "lot", id: saId(), productId: prod ? String(prod.id) : "", name, lot: fl.lot.trim(), expiry: fl.expiry, qty }]);
    setFl({ productId: "", name: "", lot: "", expiry: "", qty: "" }); showToast("Lot enregistré.");
  };
  const lotEtat = (l) => (l.expiry < today ? "perime" : saJours(today, l.expiry) <= 90 ? "bientot" : "ok");
  const Lots = () => (
    <div>
      <div className="text-xs p-2 rounded mb-4" style={{ background: "#F4F1E6", color: "#5B563F" }}>Registre des lots et dates de péremption (à titre de suivi). Les quantités du registre ne modifient pas le stock : le stock se gère dans le module Stock et se décrémente à chaque vente.</div>
      {canEdit && (<div className="ec-card p-4 mb-5"><div className="grid md:grid-cols-6 gap-2 items-end">
        <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Produit du stock</label><select value={fl.productId} onChange={(e) => setFl({ ...fl, productId: e.target.value })} data-testid="sante-lot-produit" className={ecInput} style={ecBorder}><option value="">— autre (saisir le nom) —</option>{marchandises.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>N° de lot</label><input value={fl.lot} onChange={(e) => setFl({ ...fl, lot: e.target.value })} data-testid="sante-lot-numero" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Péremption</label><input type="date" value={fl.expiry} onChange={(e) => setFl({ ...fl, expiry: e.target.value })} data-testid="sante-lot-peremption" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Quantité</label><input type="number" min="0" value={fl.qty} onChange={(e) => setFl({ ...fl, qty: e.target.value })} data-testid="sante-lot-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
        <button onClick={addLot} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="sante-lot-ajouter">Ajouter le lot</button>
      </div>{!fl.productId && <div className="mt-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom du produit</label><input value={fl.name} onChange={(e) => setFl({ ...fl, name: e.target.value })} data-testid="sante-lot-nom" className={ecInput} style={{ ...ecBorder, maxWidth: 360 }} /></div>}</div>)}
      <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Produit</th><th>Lot</th><th>Péremption</th><th className="text-right">Quantité</th><th>État</th><th></th></tr></thead>
        <tbody>{lots.slice().sort((a, b) => String(a.expiry).localeCompare(String(b.expiry))).map((l) => { const et = lotEtat(l); return (
          <tr key={l.id} data-testid="sante-lot-ligne"><td className="py-1.5">{l.name}</td><td className="tabular text-xs">{l.lot}</td><td>{ecDateFr(l.expiry)}</td><td className="text-right tabular">{l.qty}</td><td>{et === "perime" ? ecPastille("Périmé", "alerte") : et === "bientot" ? ecPastille("Expire sous 90 jours", "attente") : ecPastille("Valide", "ok")}</td><td className="text-right">{canEdit && <button onClick={() => setSante((prev) => (prev || []).filter((r) => r.id !== l.id))} className="text-xs" style={{ color: "#A6432F" }} data-testid="sante-lot-supprimer">Retirer</button>}</td></tr>); })}</tbody></table></div>
      {lots.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun lot enregistré.</div>}
    </div>
  );

  // ───────── Tableau de bord, rapports et statistiques ─────────
  const Apercu = () => {
    const actives = invoices.filter((i) => i.status !== "annulee");
    const sols = actives.map(saSoldes);
    const dusPat = saR2(sols.reduce((s, x) => s + x.restePatient, 0));
    const dusAss = saR2(sols.reduce((s, x) => s + x.resteAssureur, 0));
    const mois = today.slice(0, 7);
    const caMois = saR2(actives.filter((i) => String(i.date).startsWith(mois)).reduce((s, i) => s + i.total, 0));
    const encMois = saR2(actives.flatMap((i) => [...(i.payments || []), ...(i.claims || [])]).filter((x) => x.status !== "annulé" && String(x.date).startsWith(mois)).reduce((s, x) => s + x.amount, 0));
    const ouvertes = actives.filter((i) => etatFact(i) === "encaisser");
    const honoTot = saR2(practs.reduce((s, x) => s + Math.max(0, honoDu(x)), 0));
    const afaire = [];
    ouvertes.forEach((i) => {
      const so = saSoldes(i), age = saJours(i.date, today);
      if (so.restePatient > 0.004 && age > 30) afaire.push({ tab: "factures", sel: i.id, nom: nomPatient(i.patientId), txt: "Facture " + i.number + " : " + V.patient + " à relancer (" + age + " jours), reste " + fmt(so.restePatient) });
      if (so.resteAssureur > 0.004 && age > 30) afaire.push({ tab: "factures", sel: i.id, nom: nomAssureur(i.insurerId), txt: "Facture " + i.number + " : assureur à relancer (" + age + " jours), reste " + fmt(so.resteAssureur) });
    });
    practs.forEach((x) => { const d = honoDu(x); if (d > 0.004) afaire.push({ tab: "praticiens", nom: x.name, txt: "Honoraires à verser : " + fmt(d) }); });
    if (kind === "pharmacie") lots.filter((l) => lotEtat(l) !== "ok").forEach((l) => afaire.push({ tab: "lots", nom: l.name, txt: (lotEtat(l) === "perime" ? "Lot " + l.lot + " périmé depuis le " : "Lot " + l.lot + " expire le ") + ecDateFr(l.expiry) }));
    if (kind === "hopital") stays.filter((st) => !st.invoiceId).forEach((st) => afaire.push({ tab: "sejours", nom: nomPatient(st.patientId), txt: "Séjour en cours depuis " + saJours(st.admitDate, today) + " jour(s) : facturer à la sortie" }));
    const kpis = [[V.Patients, String(patients.length), "sante-kpi-patients"], ["Facturé ce mois", fmt(caMois), "sante-kpi-mois"], ["Encaissé ce mois", fmt(encMois), "sante-kpi-encaisse-mois"], ["Factures à encaisser", String(ouvertes.length), "sante-kpi-ouvertes"], ["À recevoir des " + V.Patients.toLowerCase(), fmt(dusPat), "sante-kpi-patients-dus"], ["À recevoir des assureurs", fmt(dusAss), "sante-kpi-assureurs-dus"], ["Honoraires à verser", fmt(honoTot), "sante-kpi-hono"], ["Choses à faire", String(afaire.length), "sante-kpi-afaire"]];
    if (kind === "pharmacie") kpis.push(["Lots périmés ou proches", String(lots.filter((l) => lotEtat(l) !== "ok").length), "sante-kpi-lots"]);
    if (kind === "hopital") kpis.push(["Séjours en cours", String(stays.filter((s) => !s.invoiceId).length), "sante-kpi-sejours"]);
    const aEncaisse = actives.some((i) => (i.payments || []).concat(i.claims || []).some((x) => x.status !== "annulé"));
    const etapes = [
      ["Type d'établissement", "Choisissez ci-dessus votre type d'établissement : chaque type a ses propres données et ses propres mots.", "etab", !!etabRec],
      ["Assureurs", "Ajoutez les assureurs avec la part qu'ils paient par défaut (facultatif : sans assureur, le " + V.patient + " paie tout).", "assureurs", insurers.length > 0],
      [V.Praticiens, "Ajoutez vos " + V.Praticiens.toLowerCase() + " et la part reversée sur leurs actes (0 si aucune).", "praticiens", practs.length > 0],
      ["Tarifs", "Remplissez le catalogue : " + V.Actes.toLowerCase() + " et leurs prix. Rien n'est préréglé.", "actes", acts.length > 0],
      [V.Patients, "Créez les fiches (administratif seulement : jamais de diagnostic ni de résultat).", "patients", patients.length > 0],
      ["Première facture", "Choisissez le " + V.patient + " et les lignes du catalogue : la part de l'assureur est calculée toute seule.", "factures", invoices.length > 0],
      ["Encaissement", "Enregistrez le paiement du " + V.patient + " puis le remboursement de l'assureur : la comptabilité se fait automatiquement.", "factures", aEncaisse],
    ];
    const toutFait = etapes.every((e) => e[3]);
    const dernieres = invoices.slice().sort((a, b) => String(b.number).localeCompare(String(a.number))).slice(0, 5);
    return (
      <div>
        {canEdit && (<div className="ec-card p-4 mb-5" data-testid="sante-etab">
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Type d'établissement</div>
          <div className="flex flex-wrap items-center gap-3">
            <select value={kind} onChange={(e) => choisirEtab(e.target.value)} data-testid="sante-etab-type" className={ecInput} style={{ ...ecBorder, maxWidth: 320 }}>{SA_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <span className="text-xs" style={{ color: "#7A7460" }}>Chaque type a ses propres données (patients, catalogue, factures, assureurs, praticiens) et ses propres mots. Aucune donnée médicale n'est enregistrée : administratif et comptabilité seulement.</span>
          </div>
        </div>)}
        {!toutFait && (<div className="ec-card p-4 mb-5" data-testid="sante-guide">
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Pour démarrer, en 7 étapes</div>
          <ol className="text-sm" style={{ color: "#152238", listStyle: "none", paddingLeft: 0 }}>{etapes.map(([t, d, tb, fait], i) => (<li key={i} data-testid="sante-etape" className="mb-1.5 flex flex-wrap gap-2 items-baseline"><span style={{ color: fait ? "#0F6B5C" : "#8A8370", fontWeight: 700 }}>{fait ? "✓" : (i + 1) + "."}</span><span><b>{t}</b> — <span style={{ color: "#5B563F" }}>{d}</span></span>{!fait && tb !== "etab" && <button className="text-xs underline" data-testid="sante-etape-ouvrir" onClick={() => setTab(tb)}>Ouvrir</button>}</li>))}</ol>
        </div>)}
        {patients.length + invoices.length === 0 && <div className="p-4 rounded text-sm mb-4" style={{ background: "#FFF6E0", color: "#152238" }} data-testid="sante-vide">Pour commencer : ajoutez vos <b>assureurs</b> et vos <b>{V.Praticiens.toLowerCase()}</b>, remplissez le <b>catalogue</b> (tarifs), puis créez vos <b>{V.Patients.toLowerCase()}</b> et votre première facture.</div>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {kpis.map(([l, v, t]) => (<div key={t} className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>{l}</div><div className="display text-lg tabular" data-testid={t} style={{ color: "#152238" }}>{v}</div></div>))}
        </div>
        <div className="display text-base mb-2" style={{ color: "#152238" }}>À faire</div>
        {afaire.length === 0 ? <div className="text-sm mb-5" style={{ color: "#8A8370" }}>Rien en attente.</div> : (
          <div className="ec-wrap mb-5"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Concerné</th><th>À faire</th><th></th></tr></thead>
            <tbody>{afaire.slice(0, 15).map((x, i) => (<tr key={i} data-testid="sante-afaire-ligne"><td className="py-1.5">{x.nom}</td><td>{x.txt}</td><td className="text-right"><button className="text-xs underline" data-testid="sante-afaire-ouvrir" onClick={() => { setTab(x.tab); if (x.sel) setSel(x.sel); }}>Ouvrir</button></td></tr>))}</tbody></table></div>
        )}
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Dernières factures</div>
        {dernieres.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucune facture.</div> : (
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>Date</th><th>{V.Patient}</th><th className="text-right">Total</th><th>État</th></tr></thead>
            <tbody>{dernieres.map((x) => (<tr key={x.id} data-testid="sante-derniere-ligne"><td className="py-1.5 tabular text-xs">{x.number}</td><td>{ecDateFr(x.date)}</td><td>{nomPatient(x.patientId)}</td><td className="text-right tabular">{fmt(x.total)}</td><td>{etatFact(x) === "annulee" ? ecPastille("Annulée", "neutre") : etatFact(x) === "soldee" ? ecPastille("Soldée", "ok") : ecPastille("À encaisser", "attente")}</td></tr>))}</tbody></table></div>
        )}
      </div>
    );
  };
  const Rapports = () => {
    const dansP = (d) => (!rd || d >= rd) && (!rf || d <= rf);
    const actives = invoices.filter((i) => i.status !== "annulee" && dansP(i.date));
    const parCat = {};
    actives.forEach((i) => (i.lines || []).forEach((l) => { const k = (SA_CATS.find((c) => c[0] === l.cat) || [0, l.cat])[1]; parCat[k] = saR2((parCat[k] || 0) + l.qty * l.unit); }));
    const totCat = saR2(Object.keys(parCat).reduce((t, k) => t + parCat[k], 0));
    const encaiss = invoices.filter((i) => i.status !== "annulee").flatMap((i) => (i.payments || []).filter((p) => p.status !== "annulé" && dansP(p.date)).map((p) => ({ ...p, number: i.number, patient: nomPatient(i.patientId) }))).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const parPrat = {};
    actives.forEach((i) => { const k = i.practitionerId ? nomPrat(i.practitionerId) : "Sans " + V.praticien; const o = parPrat[k] || { n: 0, fact: 0, hono: 0 }; o.n += 1; o.fact = saR2(o.fact + i.total); o.hono = saR2(o.hono + (i.honoraires || 0)); parPrat[k] = o; });
    const parAss = {};
    actives.filter((i) => i.insurerId).forEach((i) => { const k = nomAssureur(i.insurerId); const so = saSoldes(i); const age = saJours(i.date, today); const o = parAss[k] || { b0: 0, b1: 0, b2: 0 }; if (so.resteAssureur > 0.004) { if (age <= 30) o.b0 = saR2(o.b0 + so.resteAssureur); else if (age <= 60) o.b1 = saR2(o.b1 + so.resteAssureur); else o.b2 = saR2(o.b2 + so.resteAssureur); } parAss[k] = o; });
    const S = (arr, f) => saR2(arr.reduce((t, x) => t + f(x), 0));
    const tf = { fontWeight: 600, borderTop: "2px solid #152238" };
    const exporterFact = () => ecTelecharger("factures-" + V.slug + "-" + today + ".csv", [["N°", "Date", V.Patient, "Total", "Part assureur", "Part " + V.patient, "Reste " + V.patient, "Reste assureur", "État"], ...invoices.filter((i) => dansP(i.date)).map((i) => { const s0 = saSoldes(i); return [i.number, ecDateFr(i.date), nomPatient(i.patientId), i.total, i.insurerAmount, i.patientAmount, i.status === "annulee" ? "" : s0.restePatient, i.status === "annulee" ? "" : s0.resteAssureur, i.status === "annulee" ? "Annulée" : "Émise"]; }), ["Total", "", "", S(actives, (i) => i.total), S(actives, (i) => i.insurerAmount), S(actives, (i) => i.patientAmount), S(actives, (i) => saSoldes(i).restePatient), S(actives, (i) => saSoldes(i).resteAssureur), ""]]);
    const exporterEnc = () => ecTelecharger("encaissements-" + V.slug + "-" + today + ".csv", [["Date", "Facture", V.Patient, "Mode", "Montant"], ...encaiss.map((p) => [ecDateFr(p.date), p.number, p.patient, p.mode === "banque" ? "Banque" : "Espèces", p.amount]), ["Total", "", "", "", S(encaiss, (p) => p.amount)]]);
    return (
      <div>
        <div className="flex flex-wrap gap-2 items-end mb-4">
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Du</label><input type="date" value={rd} onChange={(e) => setRd(e.target.value)} data-testid="sante-rapport-du" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Au</label><input type="date" value={rf} onChange={(e) => setRf(e.target.value)} data-testid="sante-rapport-au" className={ecInput} style={ecBorder} /></div>
          {(rd || rf) && <button className="text-xs underline" onClick={() => { setRd(""); setRf(""); }}>Tout afficher</button>}
          <div className="text-xs" style={{ color: "#7A7460" }}>Le filtre porte sur la date des factures et des encaissements.</div>
        </div>
        <div className="flex items-center justify-between mb-2"><div className="display text-base" style={{ color: "#152238" }}>Chiffre d'affaires par catégorie</div><button onClick={exporterFact} className="text-xs underline" data-testid="sante-rapport-export-factures">Exporter les factures</button></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Catégorie</th><th className="text-right">Facturé</th></tr></thead>
          <tbody>{Object.keys(parCat).map((k) => (<tr key={k} data-testid="sante-rapport-cat"><td className="py-1.5">{k}</td><td className="text-right tabular">{fmt(parCat[k])}</td></tr>))}</tbody>
          {Object.keys(parCat).length > 0 && <tfoot><tr style={tf} data-testid="sante-rapport-cat-total"><td>Total</td><td className="text-right tabular" data-testid="sante-rapport-cat-tot">{fmt(totCat)}</td></tr></tfoot>}</table></div>
        <div className="display text-base mb-2 mt-5" style={{ color: "#152238" }}>Facturé par {V.praticien}</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">{V.Praticien}</th><th className="text-right">Factures</th><th className="text-right">Facturé</th><th className="text-right">Honoraires générés</th></tr></thead>
          <tbody>{Object.keys(parPrat).map((k) => (<tr key={k} data-testid="sante-rapport-prat"><td className="py-1.5">{k}</td><td className="text-right tabular">{parPrat[k].n}</td><td className="text-right tabular">{fmt(parPrat[k].fact)}</td><td className="text-right tabular">{fmt(parPrat[k].hono)}</td></tr>))}</tbody>
          {Object.keys(parPrat).length > 0 && <tfoot><tr style={tf} data-testid="sante-rapport-prat-total"><td>Total</td><td className="text-right tabular">{actives.length}</td><td className="text-right tabular" data-testid="sante-rapport-prat-tot">{fmt(S(Object.values(parPrat), (o) => o.fact))}</td><td className="text-right tabular">{fmt(S(Object.values(parPrat), (o) => o.hono))}</td></tr></tfoot>}</table></div>
        <div className="display text-base mb-2 mt-5" style={{ color: "#152238" }}>À recevoir des assureurs, par ancienneté</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Assureur</th><th className="text-right">0 à 30 jours</th><th className="text-right">31 à 60 jours</th><th className="text-right">Plus de 60 jours</th><th className="text-right">Total</th></tr></thead>
          <tbody>{Object.keys(parAss).map((k) => (<tr key={k} data-testid="sante-rapport-ass"><td className="py-1.5">{k}</td><td className="text-right tabular">{fmt(parAss[k].b0)}</td><td className="text-right tabular">{fmt(parAss[k].b1)}</td><td className="text-right tabular">{fmt(parAss[k].b2)}</td><td className="text-right tabular">{fmt(saR2(parAss[k].b0 + parAss[k].b1 + parAss[k].b2))}</td></tr>))}</tbody>
          {Object.keys(parAss).length > 0 && <tfoot><tr style={tf} data-testid="sante-rapport-ass-total"><td>Total</td><td className="text-right tabular">{fmt(S(Object.values(parAss), (o) => o.b0))}</td><td className="text-right tabular">{fmt(S(Object.values(parAss), (o) => o.b1))}</td><td className="text-right tabular">{fmt(S(Object.values(parAss), (o) => o.b2))}</td><td className="text-right tabular" data-testid="sante-rapport-ass-tot">{fmt(S(Object.values(parAss), (o) => o.b0 + o.b1 + o.b2))}</td></tr></tfoot>}</table></div>
        <div className="flex items-center justify-between mb-2 mt-5"><div className="display text-base" style={{ color: "#152238" }}>Journal des encaissements</div><button onClick={exporterEnc} className="text-xs underline" data-testid="sante-rapport-export-enc">Exporter</button></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Facture</th><th>{V.Patient}</th><th>Mode</th><th className="text-right">Montant</th></tr></thead>
          <tbody>{encaiss.map((p) => (<tr key={p.id} data-testid="sante-rapport-enc"><td className="py-1.5">{ecDateFr(p.date)}</td><td className="tabular text-xs">{p.number}</td><td>{p.patient}</td><td>{p.mode === "banque" ? "Banque" : "Espèces"}</td><td className="text-right tabular">{fmt(p.amount)}</td></tr>))}</tbody>
          {encaiss.length > 0 && <tfoot><tr style={tf} data-testid="sante-rapport-enc-total"><td colSpan={4}>Total ({encaiss.length})</td><td className="text-right tabular" data-testid="sante-rapport-enc-tot">{fmt(S(encaiss, (p) => p.amount))}</td></tr></tfoot>}</table></div>
      </div>
    );
  };

  const Stats = () => {
    const actives = invoices.filter((i) => i.status !== "annulee");
    const sols = actives.map(saSoldes);
    const factureT = saR2(actives.reduce((s, i) => s + i.total, 0));
    const encaisseT = saR2(sols.reduce((s, x) => s + x.paye + x.recu, 0));
    const mois = statMois(6, today);
    const payments = actives.flatMap((i) => [...(i.payments || []), ...(i.claims || [])].filter((x) => x.status !== "annulé"));
    const data = mois.map((m) => ({ mois: m.label, facture: statSomme(actives, "date", m.key, (i) => i.total), encaisse: statSomme(payments, "date", m.key, (x) => x.amount) }));
    const parCat = {}; actives.forEach((i) => (i.lines || []).forEach((l) => { const k = (SA_CATS.find((c) => c[0] === l.cat) || [0, l.cat])[1]; parCat[k] = saR2((parCat[k] || 0) + l.qty * l.unit); }));
    const parPayeur = { [V.Patients]: saR2(actives.reduce((s, i) => s + i.patientAmount, 0)) };
    actives.filter((i) => i.insurerId).forEach((i) => { const k = nomAssureur(i.insurerId); parPayeur[k] = saR2((parPayeur[k] || 0) + i.insurerAmount); });
    const parPrat = {}; actives.forEach((i) => { const k = i.practitionerId ? nomPrat(i.practitionerId) : "Sans " + V.praticien; parPrat[k] = saR2((parPrat[k] || 0) + i.total); });
    const parAssPat = {}; patients.forEach((x) => { const k = x.insurerId ? nomAssureur(x.insurerId) : "Sans assureur"; parAssPat[k] = (parAssPat[k] || 0) + 1; });
    const parMode = {}; actives.forEach((i) => (i.payments || []).filter((x) => x.status !== "annulé").forEach((x) => { const k = x.mode === "banque" ? "Banque" : "Espèces"; parMode[k] = saR2((parMode[k] || 0) + x.amount); }));
    return <StatsBloc
      vide={invoices.length === 0 ? "Aucune facture pour le moment : les statistiques apparaîtront avec vos premières factures." : ""}
      kpis={[[V.Patients, String(patients.length), "sante-stat-patients"], ["Facturé", fmt(factureT), "sante-stat-facture"], ["Encaissé (patients et assureurs)", fmt(encaisseT), "sante-stat-encaisse"], ["Taux d'encaissement", (factureT > 0 ? Math.round(encaisseT / factureT * 100) : 0) + " %", "sante-stat-taux"]]}
      evolution={{ titre: "Facturé et encaissé — 6 derniers mois", data, series: [{ key: "facture", name: "Facturé", color: "#9A7B1E" }, { key: "encaisse", name: "Encaissé", color: "#0F6B5C" }] }}
      repartitions={[{ titre: "Chiffre d'affaires par catégorie", data: Object.keys(parCat).map((k) => ({ name: k, value: parCat[k] })) }, { titre: "Qui paie : " + V.patient + " et assureurs", data: Object.keys(parPayeur).map((k) => ({ name: k, value: parPayeur[k] })) }, { titre: "Facturé par " + V.praticien, data: Object.keys(parPrat).map((k) => ({ name: k, value: parPrat[k] })) }, { titre: V.Patients + " par assureur", unite: "nombre", data: Object.keys(parAssPat).map((k) => ({ name: k, value: parAssPat[k] })) }, { titre: "Encaissements des " + V.Patients.toLowerCase() + " par mode", data: Object.keys(parMode).map((k) => ({ name: k, value: parMode[k] })) }]} />;
  };
  const tabs = [["apercu", "Tableau de bord"], ["patients", V.Patients], ["actes", V.Actes], ["factures", V.Factures], ...(isVendeur ? [] : [["assureurs", "Assureurs"], ["praticiens", V.Praticiens]]), ...(kind === "hopital" ? [["sejours", "Séjours"]] : []), ...(kind === "pharmacie" ? [["lots", "Lots et péremptions"]] : []), ...(isVendeur ? [] : [["rapports", "Rapports"], ["stats", "Statistiques"]])];
  return (
    <>
      {listesNoms}
      <div className={"p-4 md:p-8 max-w-6xl" + (imprimer ? " no-print" : "")} data-testid="sante-module">
        <style>{EC_CSS + '[data-testid="sante-module"] .display.text-base{border-left:3px solid #C9A24B;padding-left:10px;margin-bottom:12px}[data-testid="sante-module"] input,[data-testid="sante-module"] select,[data-testid="sante-module"] textarea{background:#fff}'}</style>
        <div className="mb-4"><div className="display text-2xl" style={{ color: "#152238" }}>Santé</div><div className="text-xs" style={{ color: "#8A8370" }}>{V.etab} — {V.Patients.toLowerCase()}, tarifs, facturation, assureurs et honoraires</div></div>
        {!canFront && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }}>Consultation seule : votre rôle ne permet pas de modifier les données.</div>}
        {isVendeur && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }} data-testid="sante-accueil-note">Accueil : vous pouvez enregistrer les {V.Patients.toLowerCase()}, facturer et encaisser{kind === "pharmacie" ? ", et vendre les produits" : " (les produits se vendent à la pharmacie)"}. Tarifs, assureurs, annulations, honoraires et rapports sont réservés au responsable.</div>}
        <div className="ec-tabs">
          {tabs.map(([id, l]) => (<button key={id} onClick={() => setTab(id)} data-testid={"sante-tab-" + id} className="px-3 py-2 text-sm rounded-lg transition-colors" style={{ background: tab === id ? "#152238" : "transparent", color: tab === id ? "#EFE9DD" : "#6B6552", fontWeight: tab === id ? 600 : 500 }}>{l}</button>))}
        </div>
        {tab === "apercu" && Apercu()}
        {tab === "patients" && Patients()}
        {tab === "actes" && Catalogue()}
        {tab === "factures" && Facturation()}
        {tab === "assureurs" && Assureurs()}
        {tab === "praticiens" && Praticiens()}
        {tab === "sejours" && kind === "hopital" && Sejours()}
        {tab === "lots" && kind === "pharmacie" && Lots()}
        {tab === "rapports" && Rapports()}
        {tab === "stats" && !isVendeur && Stats()}
      </div>
      {imprimer && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto p-3 md:p-8 no-print" style={{ background: "rgba(21,34,56,0.55)" }} onClick={() => setImprimer(null)} data-testid="sante-facture-apercu">
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: tk ? 340 : 820 }}>
            <div className="flex items-center justify-between mb-2"><div className="text-sm" style={{ color: "#EFE9DD" }}>{V.Facture} {imprimer.number}</div>
              <div className="flex gap-2 flex-wrap"><button onClick={() => setTk(!tk)} className="px-3 py-1.5 rounded text-sm" style={ecBtn} data-testid="sante-facture-format">{tk ? "Passer en A4" : "Passer en ticket"}</button><button onClick={() => { try { window.print(); } catch (e) {} }} className="px-3 py-1.5 rounded text-sm" style={ecBtnGold} data-testid="sante-facture-imprimer-ok">Imprimer</button><button onClick={() => setImprimer(null)} className="px-3 py-1.5 rounded text-sm" style={ecBtn}>Fermer</button></div></div>
            <div className="rounded shadow-lg overflow-hidden" style={{ background: "#fff" }}><FactureSheet inv={imprimer} /></div>
          </div>
        </div>
      )}
      {imprimer && <div className={"print-only" + (tk ? " ticket-print-80" : "")}><FactureSheet inv={imprimer} /></div>}
    </>
  );
}

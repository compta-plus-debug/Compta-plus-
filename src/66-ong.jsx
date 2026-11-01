// ═══ MODULE ═══
// @module Ong
// @depends CURRENCIES, CURRENT_CURRENCY, EC_CSS, StatsBloc, ecBorder, ecBtn, ecBtnGold, ecDateFr, ecInput
//   ecPastille, ecTelecharger, isFutureDate, isLocked, statMois, statSomme, todayStr, uid
//   useBrouillon, useState
// @exports OngModule
// ═══ FIN DE L'EN-TÊTE ═══
// Bloc ONG, associations, églises, fondations : fonds affectés (un fonds = un projet ou un bailleur), donateurs et bailleurs, dons et reçus numérotés,
// membres et cotisations, dépenses imputées à un fonds (alerte et justification en cas de dépassement), virements entre fonds, rapports financiers par fonds,
// rapport annuel des dons, relevé d'un donateur, cotisations, statistiques. Rien n'est préréglé : montants, dates, budgets et taxes sont saisis par l'organisation.
//
// Comptabilité (tout en gourdes) :
//  • don, subvention, dîme, offrande, collecte : Débit caisse ou banque / Crédit 7581 (dons), 7582 (subventions et bailleurs), 7584 (dîmes et offrandes), 7585 (collectes), 7589 (autres) ;
//  • cotisation d'un membre : Débit caisse ou banque / Crédit 7583 ;
//  • dépense : Débit 6041, 6581, 6331, 6183, 6322, 6231, 6133, 6056, 6613 ou 6283 selon la nature / Crédit caisse, banque ou 401 (à payer) ;
//  • règlement d'une dette : Débit 401 / Crédit caisse ou banque ;
//  • toute annulation passe une écriture inverse.
// Les fonds (projets), les virements entre fonds et les budgets sont un suivi de gestion : ils ne passent aucune écriture. Le personnel salarié imputé à un fonds se paie par le module
// Salaires (aucune écriture ici). Les comptes 7581 à 7589 et 6041 à 6613 sont à confirmer avec l'expert-comptable (plan comptable des organisations à but non lucratif).
// Un reçu de don n'a valeur de reçu fiscal que si l'organisation y est autorisée par la DGI : le reçu l'indique.

const OG_TYPES = [["ong", "ONG (projets financés par des bailleurs)"], ["association", "Association ou club"], ["eglise", "Église ou communauté religieuse"], ["fondation", "Fondation ou école communautaire"]];
const OG_VOC = {
  ong: { contacts: "Bailleurs et donateurs", membres: "Membres", recettes: "Dons, subventions et reçus", formRecette: "Nouvelle recette (subvention, don, collecte…) avec reçu", fondsForm: "Nouveau fonds (un projet, un bailleur)", exFonds: "Projet eau potable 2026, Appui à l'école…", bailleur: "Bailleur", lBailleur: "le bailleur", guideDon: "enregistrez la subvention d'un bailleur ou un don", rapAnnuel: "Rapport annuel des dons" },
  association: { contacts: "Donateurs et partenaires", membres: "Membres", recettes: "Dons, collectes et reçus", formRecette: "Nouvelle recette (don, collecte, subvention…) avec reçu", fondsForm: "Nouveau fonds (un projet, une activité, une campagne)", exFonds: "Fête annuelle, Achat de matériel, Tournoi…", bailleur: "Financeur", lBailleur: "le financeur", guideDon: "enregistrez un don ou le produit d'une collecte", rapAnnuel: "Rapport annuel des dons" },
  eglise: { contacts: "Donateurs", membres: "Fidèles et membres", recettes: "Dîmes, offrandes et reçus", formRecette: "Nouvelle recette (dîme, offrande, don…) avec reçu", fondsForm: "Nouveau fonds (construction, œuvres sociales, campagne…)", exFonds: "Construction de l'église, Œuvres sociales, Campagne de Noël…", bailleur: "Partenaire", lBailleur: "le partenaire", guideDon: "enregistrez une dîme, une offrande ou un don", rapAnnuel: "Rapport annuel des dîmes, offrandes et dons" },
  fondation: { contacts: "Donateurs et parrains", membres: "Membres", recettes: "Dons, subventions et reçus", formRecette: "Nouvelle recette (don, parrainage, subvention…) avec reçu", fondsForm: "Nouveau fonds (un projet, un bailleur, une campagne)", exFonds: "Bourses 2026, Cantine scolaire…", bailleur: "Bailleur", lBailleur: "le bailleur", guideDon: "enregistrez un don, un parrainage ou une subvention", rapAnnuel: "Rapport annuel des dons" },
};
// libellés qui changent selon le type d'organisation (le reste reprend le libellé de base)
const OG_LIB_REC = { ong: {}, association: {}, eglise: { collecte: "Collecte spéciale ou activité de levée de fonds" }, fondation: { don: "Don ou parrainage" } };
const OG_LIB_DEP = {
  ong: {},
  association: { aides: "Aides aux membres et bénéficiaires", loyer: "Loyer du local" },
  eglise: { activites: "Fournitures et matériel (culte, activités)", aides: "Œuvres sociales et aides aux nécessiteux", formation: "Formation, retraites et séminaires", honoraires: "Honoraires et intervenants", loyer: "Loyer ou entretien du lieu de culte", salarie: "Pasteur ou personnel salarié imputé (déjà payé par Salaires, sans écriture)" },
  fondation: { aides: "Bourses et aides aux bénéficiaires" },
};
const OG_RECETTES = [["don", "Don", "7581"], ["subvention", "Subvention ou financement", "7582"], ["cotisation", "Cotisation de membre", "7583"], ["dime", "Dîme", "7584"], ["offrande", "Offrande", "7584"], ["collecte", "Collecte, vente ou activité de levée de fonds", "7585"], ["autre", "Autre recette", "7589"]];
const OG_RECETTES_PAR_TYPE = { ong: ["subvention", "don", "collecte", "autre"], association: ["don", "collecte", "subvention", "autre"], eglise: ["dime", "offrande", "don", "collecte", "autre"], fondation: ["don", "subvention", "collecte", "autre"] };
const OG_DEPENSES = [["activites", "Fournitures et matériel des activités", "6041"], ["aides", "Aides et secours aux bénéficiaires", "6581"], ["formation", "Formation, ateliers et réunions", "6331"], ["transport", "Transport et déplacements", "6183"], ["honoraires", "Honoraires et consultants", "6322"], ["communication", "Communication et publicité", "6231"], ["loyer", "Loyer des locaux", "6133"], ["energie", "Eau, électricité et énergie", "6056"], ["temporaires", "Personnel temporaire et vacataires", "6613"], ["salarie", "Personnel salarié imputé (déjà payé par Salaires, sans écriture)", ""], ["autre", "Autres frais de fonctionnement", "6283"]];
const OG_MOTIFS_BASE = [["accord", "Dépassement accepté par {B} ou le comité"], ["avance", "Avance du fonds général (à rembourser au fonds)"], ["report", "Report de crédit d'une autre période"], ["erreur", "Erreur de budget à corriger"], ["autre", "Autre raison (à préciser)"]];
const OG_PERIODES = [["annuelle", "Annuelle"], ["trimestrielle", "Trimestrielle"], ["mensuelle", "Mensuelle"]];
const OG_CONTACTS = [["particulier", "Particulier"], ["entreprise", "Entreprise"], ["bailleur", "Bailleur (institution, agence)"], ["partenaire", "Église, association ou ONG partenaire"]];
const OG_CONTACTS_PAR_TYPE = { ong: ["particulier", "entreprise", "bailleur", "partenaire"], association: ["particulier", "entreprise", "bailleur", "partenaire"], eglise: ["particulier", "entreprise", "partenaire"], fondation: ["particulier", "entreprise", "bailleur", "partenaire"] };
const OG_COMPTES = {
  "401": { name: "Fournisseurs", type: "Passif" },
  "512": { name: "Banque", type: "Actif" },
  "530": { name: "Caisse", type: "Actif" },
  "7581": { name: "Dons et legs reçus", type: "Produit" },
  "7582": { name: "Subventions et financements de bailleurs", type: "Produit" },
  "7583": { name: "Cotisations des membres", type: "Produit" },
  "7584": { name: "Dîmes et offrandes", type: "Produit" },
  "7585": { name: "Collectes et activités de levée de fonds", type: "Produit" },
  "7589": { name: "Autres produits des activités", type: "Produit" },
  "6041": { name: "Fournitures et matériel des activités", type: "Charge" },
  "6581": { name: "Aides et secours aux bénéficiaires", type: "Charge" },
  "6331": { name: "Formation, ateliers et réunions", type: "Charge" },
  "6183": { name: "Transport et déplacements de mission", type: "Charge" },
  "6322": { name: "Honoraires et consultants", type: "Charge" },
  "6231": { name: "Communication et publicité", type: "Charge" },
  "6133": { name: "Loyer des locaux", type: "Charge" },
  "6056": { name: "Eau, électricité et énergie des locaux", type: "Charge" },
  "6613": { name: "Personnel temporaire et vacataires", type: "Charge" },
  "6283": { name: "Autres frais de fonctionnement", type: "Charge" },
};
const ogR2 = (n) => { const v = Math.round((Number(n) || 0) * 100) / 100; return Number.isFinite(v) && Math.abs(v) <= 1e11 ? v : 0; }; // montant démesuré ou illisible = 0 (refusé par les formulaires)
const ogId = () => String(uid());
const ogRows = (rows, type) => (rows || []).filter((r) => r && r.type === type);
const ogNom = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ogJours = (a, b) => (a && b ? Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000) : 0);
const ogPaye = (arr) => ogR2((arr || []).filter((p) => p.status !== "annulé").reduce((s, p) => s + p.amount, 0));
// Montant : entier sans décimales, sinon 2 décimales (un don de 150,50 ne doit pas s'afficher 151).
const ogM = (n) => {
  const code = CURRENT_CURRENCY;
  const locale = (CURRENCIES[code] && CURRENCIES[code].locale) || "fr-FR";
  const v = ogR2(n);
  const d = Math.abs(v - Math.round(v)) < 0.005 ? 0 : 2;
  try { return new Intl.NumberFormat(locale, { style: "currency", currency: code, minimumFractionDigits: d, maximumFractionDigits: d }).format(v); } catch (e) { return v.toFixed(d) + " " + code; }
};
function ogAjouterComptes(accounts, setAccounts, codes) {
  const missing = [...new Set(codes)].filter((k) => OG_COMPTES[k] && !accounts.some((a) => a.code === k)).map((k) => ({ code: k, name: OG_COMPTES[k].name, type: OG_COMPTES[k].type }));
  if (missing.length) setAccounts((prev) => [...prev, ...missing.filter((m) => !prev.some((a) => a.code === m.code))]);
}
// Montant en lettres (français), pour les reçus.
function ogEnLettres(n) {
  const u = ["", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"];
  const d = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante", "soixante", "quatre-vingt", "quatre-vingt"];
  const s100 = (x) => {
    if (x < 20) return u[x];
    const t = Math.floor(x / 10), r = x % 10;
    if (t === 7 || t === 9) return d[t] + (r === 1 && t === 7 ? " et " : "-") + u[10 + r];
    if (t === 8) return r === 0 ? "quatre-vingts" : "quatre-vingt-" + u[r];
    if (r === 0) return d[t];
    return d[t] + (r === 1 ? " et un" : "-" + u[r]);
  };
  const s1000 = (x, fin) => {
    const c = Math.floor(x / 100), r = x % 100;
    if (c === 0) return s100(r);
    const ce = c === 1 ? "cent" : u[c] + " cent";
    if (r === 0) return c > 1 && fin ? ce + "s" : ce;
    return ce + " " + s100(r);
  };
  const v = Math.abs(Number(n) || 0);
  const ent = Math.floor(v + 1e-9), cts = Math.round((v - ent) * 100);
  if (ent === 0 && cts === 0) return "zéro";
  const mil = Math.floor(ent / 1000000), k = Math.floor((ent % 1000000) / 1000), r = ent % 1000;
  const parts = [];
  if (mil > 0) parts.push(mil === 1 ? "un million" : s1000(mil, false) + " millions");
  if (k > 0) parts.push(k === 1 ? "mille" : s1000(k, false) + " mille");
  if (r > 0) parts.push(s1000(r, true));
  let out = parts.join(" ") || "zéro";
  if (cts > 0) out += " et " + s100(cts) + " centime" + (cts > 1 ? "s" : "");
  return out;
}
const OG_MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const ogIso = (y, mo, d) => y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
const ogFinMois = (y, mo) => ogIso(y, mo, new Date(y, mo, 0).getDate());
// Périodes de cotisation d'un membre pour l'année y, déjà commencées à la date du jour.
function ogPeriodes(m, y, today) {
  const j = m.joined || "0000-00-00", yn = Number(y), out = [];
  if (m.period === "mensuelle") {
    for (let mo = 1; mo <= 12; mo++) { const s = ogIso(yn, mo, 1); if (s > today) break; if (ogFinMois(yn, mo) < j) continue; out.push({ key: yn + "-" + String(mo).padStart(2, "0"), start: s < j ? j : s, label: OG_MOIS[mo - 1] + " " + yn }); }
  } else if (m.period === "trimestrielle") {
    for (let q = 1; q <= 4; q++) { const s = ogIso(yn, (q - 1) * 3 + 1, 1); if (s > today) break; if (ogFinMois(yn, q * 3) < j) continue; out.push({ key: yn + "-T" + q, start: s < j ? j : s, label: q + (q === 1 ? "er" : "e") + " trimestre " + yn }); }
  } else {
    const s = ogIso(yn, 1, 1);
    if (s <= today && ogIso(yn, 12, 31) >= j) out.push({ key: String(yn), start: s < j ? j : s, label: "Année " + yn });
  }
  return out;
}

function OngModule({ suppliers, ong, setOng, entries, setEntries, accounts, setAccounts, settings, role, showToast, logAudit, currentUserEmail }) {
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const isVendeur = role === "Vendeur"; // réception : donateurs, dons, reçus, membres et cotisations
  const canFront = canEdit || isVendeur;
  const today = todayStr();
  const moisCourant = today.slice(0, 7);
  const annee = today.slice(0, 4);
  const [tab, setTab] = useState("apercu");
  const contacts = ogRows(ong, "contact");
  const membres = ogRows(ong, "membre");
  const fonds = ogRows(ong, "fonds");
  const dons = ogRows(ong, "don");
  const deps = ogRows(ong, "dep");
  const vires = ogRows(ong, "vire");
  const cfg = ogRows(ong, "config")[0] || {};
  const orgType = cfg.orgType || "";
  const V = OG_VOC[orgType || "ong"];
  const kindsDon = (OG_RECETTES_PAR_TYPE[orgType || "ong"] || OG_RECETTES_PAR_TYPE.ong).map((k) => { const r = OG_RECETTES.find((x) => x[0] === k); return [r[0], ((OG_LIB_REC[orgType || "ong"] || {})[k]) || r[1], r[2]]; });
  const donsOk = dons.filter((d) => d.status !== "annulé");
  const depsOk = deps.filter((d) => d.status !== "annulé");
  const viresOk = vires.filter((v) => v.status !== "annulé");
  const compteMode = (m) => (m === "banque" ? "512" : m === "apayer" ? "401" : "530");
  const maj = (id, fn) => setOng((prev) => (prev || []).map((r) => (r.id === id ? fn(r) : r)));
  // Copie toujours à jour des données : deux clics rapides ne passent plus le contrôle des doublons avant la mise à jour de l'écran.
  const ongRef = React.useRef(ong || []);
  ongRef.current = ong || [];
  const lignesAJour = (type) => ogRows(ongRef.current, type);
  const ajouter = (rec) => { ongRef.current = [...ongRef.current, rec]; setOng((prev) => ((prev || []).some((r) => r && r.id === rec.id) ? prev : [...(prev || []), rec])); };
  const ecrire = (date, label, lines, dossierId) => {
    const e = { id: uid(), date, createdAt: new Date().toISOString(), label, lines: lines.filter((l) => l.debit > 0 || l.credit > 0), kind: "ong", dossierId };
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
  const numero = (prefix, rows, date) => {
    const yy = String((date || today).slice(0, 4));
    const n = rows.filter((r) => String(r.number || "").startsWith(prefix + "-" + yy + "-")).reduce((m, r) => Math.max(m, Number(String(r.number).split("-")[2]) || 0), 0) + 1;
    return prefix + "-" + yy + "-" + String(n).padStart(4, "0");
  };
  const choisirType = (t) => {
    if (!canEdit) return;
    if (cfg.id) maj(cfg.id, (r) => ({ ...r, orgType: t })); else ajouter({ type: "config", id: ogId(), orgType: t });
    logAudit("ONG et associations", "Type d'organisation", (OG_TYPES.find((x) => x[0] === t) || [0, t])[1]);
  };
  const marquerRapport = () => { if (!cfg.rapportVu) { if (cfg.id) maj(cfg.id, (r) => ({ ...r, rapportVu: true })); else ajouter({ type: "config", id: ogId(), rapportVu: true }); } };

  // ── Fonds : soldes ──
  const nomFonds = (id) => (id ? ((fonds.find((f) => f.id === id) || {}).name || "—") : "Fonds général (libre)");
  const sFonds = (id) => {
    const k = id || "";
    const recu = ogR2(donsOk.filter((d) => (d.fondId || "") === k).reduce((s, d) => s + d.amount, 0));
    const dep = ogR2(depsOk.filter((d) => (d.fondId || "") === k).reduce((s, d) => s + d.amount, 0));
    const vin = ogR2(viresOk.filter((v) => (v.to || "") === k).reduce((s, v) => s + v.amount, 0));
    const vout = ogR2(viresOk.filter((v) => (v.from || "") === k).reduce((s, v) => s + v.amount, 0));
    return { recu, dep, vin, vout, solde: ogR2(recu + vin - vout - dep) };
  };
  const fondsOptions = [["", "Fonds général (libre)"], ...fonds.filter((f) => f.status !== "clos").map((f) => [f.id, f.name])];
  const nomContact = (id) => (contacts.find((c) => c.id === id) || {}).name || "—";
  const nomMembre = (id) => (membres.find((m) => m.id === id) || {}).name || "—";
  const donateur = (d) => (d.memberId ? nomMembre(d.memberId) : d.donorId ? nomContact(d.donorId) : (d.donorName || "Donateur anonyme"));
  const natureDon = (k) => ((OG_LIB_REC[orgType || "ong"] || {})[k]) || (OG_RECETTES.find((r) => r[0] === k) || [0, k])[1];
  const natureDep = (k) => ((OG_LIB_DEP[orgType || "ong"] || {})[k]) || (OG_DEPENSES.find((r) => r[0] === k) || [0, k])[1];
  const OG_MOTIFS = OG_MOTIFS_BASE.map((m) => [m[0], m[1].replace("{B}", V.lBailleur)]);
  const kindsRecAll = OG_RECETTES.map((r) => [r[0], natureDon(r[0])]);
  const kindsDep = OG_DEPENSES.map((r) => [r[0], natureDep(r[0])]);
  const kindsContact = (OG_CONTACTS_PAR_TYPE[orgType || "ong"] || OG_CONTACTS_PAR_TYPE.ong).map((k) => OG_CONTACTS.find((c) => c[0] === k));
  const sorteContact = (k) => (k === "bailleur" ? V.bailleur + " (institution, agence)" : (OG_CONTACTS.find((c) => c[0] === k) || [0, ""])[1]);
  const resteDep = (d) => ogR2(d.mode === "apayer" ? d.amount - ogPaye(d.settlements) : 0);
  const verifDepassement = (fondId, amount) => {
    const s = sFonds(fondId), f = fonds.find((x) => x.id === fondId), msgs = [];
    if (amount > s.solde + 0.004) msgs.push("la dépense (" + ogM(amount) + ") dépasse les fonds disponibles (" + ogM(Math.max(0, s.solde)) + ")");
    if (f && Number(f.budget) > 0 && s.dep + amount > Number(f.budget) + 0.004) msgs.push("le total dépensé (" + ogM(s.dep + amount) + ") dépasserait le budget du projet (" + ogM(f.budget) + ")");
    return msgs;
  };
  const periodesMembre = (m, y) => ogPeriodes(m, y || annee, today);
  const periodePayee = (m, key) => donsOk.some((d) => d.kind === "cotisation" && d.memberId === m.id && d.periode === key);
  const retardsMembre = (m) => (m.status === "inactif" ? [] : periodesMembre(m).filter((p) => !periodePayee(m, p.key) && ogJours(p.start, today) > 30));
  const listes = (<><datalist id="og-dl-fourn">{[...new Set([...(suppliers || []).map((s) => s.name), ...deps.map((d) => d.supplier)].map((x) => String(x || "").trim()).filter(Boolean))].sort().map((n) => <option key={n} value={n} />)}</datalist></>);
  const rechercher = (txt, q) => !q.trim() || txt.toLowerCase().includes(q.trim().toLowerCase());
  const [imprimer, setImprimer] = useState(null);
  const [tk, setTk] = useState(false);

  // ───────── Donateurs et bailleurs ─────────
  const [fco, setFco] = useBrouillon("ong-contact", { name: "", kind: "particulier", phone: "", email: "", address: "" });
  const [cq, setCq] = useState("");
  const ajouterContact = () => {
    if (!canFront) return;
    const name = fco.name.trim();
    if (!name) { showToast("Indiquez le nom du donateur" + (orgType === "eglise" ? "" : " ou du " + V.bailleur.toLowerCase()) + "."); return; }
    if (lignesAJour("contact").some((c) => ogNom(c.name) === ogNom(name))) { showToast("Un contact de ce nom existe déjà."); return; }
    ajouter({ type: "contact", id: ogId(), name, kind: fco.kind, phone: fco.phone.trim(), email: fco.email.trim(), address: fco.address.trim() });
    setFco({ ...fco, name: "", phone: "", email: "", address: "" }); showToast("« " + name + " » ajouté."); logAudit("ONG et associations", "Donateur ajouté", name);
  };
  const retirerContact = (c) => {
    if (!canEdit) return;
    if (donsOk.some((d) => d.donorId === c.id) || fonds.some((f) => f.bailleurId === c.id)) { showToast("Ce contact a des dons ou finance un fonds : il ne peut pas être retiré."); return; }
    setOng((prev) => (prev || []).filter((r) => !(r && r.type === "contact" && r.id === c.id)));
    ongRef.current = ongRef.current.filter((r) => !(r && r.type === "contact" && r.id === c.id));
    showToast("« " + c.name + " » retiré."); logAudit("ONG et associations", "Donateur retiré", c.name);
  };
  const Contacts = () => {
    const rows = contacts.filter((c) => rechercher([c.name, c.phone, c.email].join(" "), cq)).sort((a, b) => a.name.localeCompare(b.name));
    return (
      <div>
        {canFront && (<div className="ec-card p-4 mb-5" data-testid="og-contact-form"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouveau contact</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom</label><input value={fco.name} onChange={(e) => setFco({ ...fco, name: e.target.value })} data-testid="og-contact-nom" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Sorte</label><select value={fco.kind} onChange={(e) => setFco({ ...fco, kind: e.target.value })} data-testid="og-contact-sorte" className={ecInput} style={ecBorder}>{kindsContact.map((k) => <option key={k[0]} value={k[0]}>{k[0] === "bailleur" ? V.bailleur + " (institution, agence)" : k[1]}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Téléphone</label><input value={fco.phone} onChange={(e) => setFco({ ...fco, phone: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Courriel</label><input value={fco.email} onChange={(e) => setFco({ ...fco, email: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Adresse</label><input value={fco.address} onChange={(e) => setFco({ ...fco, address: e.target.value })} className={ecInput} style={ecBorder} /></div>
          </div>
          <button onClick={ajouterContact} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="og-contact-ajouter">Ajouter</button></div>)}
        <div className="ec-card p-4"><div className="flex flex-wrap gap-2 items-end mb-2"><div className="display text-base" style={{ color: "#152238" }}>{V.contacts} ({contacts.length})</div>
          <input value={cq} onChange={(e) => setCq(e.target.value)} placeholder="Rechercher (nom, téléphone, courriel)" className={ecInput + " md:w-72"} style={ecBorder} data-testid="og-contact-recherche" /></div>
          {rows.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucun contact. Les dons peuvent aussi être enregistrés sans nom (donateur anonyme).</div> : (
            <div>{rows.map((c, i) => { const mine = donsOk.filter((d) => d.donorId === c.id); return (<div key={c.id} data-testid="og-contact-ligne" className="py-2 text-sm" style={{ borderTop: i > 0 ? "1px solid #F3EFE3" : "none", overflowWrap: "anywhere" }}>
              <div className="flex flex-wrap justify-between gap-2"><span><b>{c.name}</b> <span className="text-xs" style={{ color: "#8A8370" }}>· {sorteContact(c.kind)}</span></span><span className="tabular">{mine.length} don(s) · <b>{ogM(mine.reduce((s, d) => s + d.amount, 0))}</b></span></div>
              <div className="text-xs" style={{ color: "#8A8370" }}>{[c.phone, c.email, c.address].filter(Boolean).join(" · ") || "—"}{canEdit && mine.length === 0 && !fonds.some((f) => f.bailleurId === c.id) && <button className="underline ml-2" style={{ color: "#A6432F" }} onClick={() => retirerContact(c)} data-testid="og-contact-retirer">Retirer</button>}</div></div>); })}</div>)}
        </div>
      </div>
    );
  };

  // ───────── Membres et cotisations ─────────
  const [fme, setFme] = useBrouillon("ong-membre", { name: "", phone: "", address: "", joined: todayStr(), cotis: "", period: "annuelle" });
  const [mq, setMq] = useState("");
  const [selMem, setSelMem] = useState("");
  const [fcot, setFcot] = useState({ key: "", amount: "", mode: "caisse", date: todayStr() });
  const ajouterMembre = () => {
    if (!canFront) return;
    const name = fme.name.trim();
    if (!name) { showToast("Indiquez le nom du membre."); return; }
    if (lignesAJour("membre").some((m) => ogNom(m.name) === ogNom(name))) { showToast("Un membre de ce nom existe déjà."); return; }
    if (fme.cotis !== "" && !(Number(fme.cotis) > 0)) { showToast("La cotisation doit être supérieure à zéro."); return; }
    if (fme.joined && isFutureDate(fme.joined)) { showToast("La date d'adhésion ne peut pas être dans le futur."); return; }
    const id = ogId();
    ajouter({ type: "membre", id, number: numero("MB", lignesAJour("membre"), fme.joined), name, phone: fme.phone.trim(), address: fme.address.trim(), joined: fme.joined || today, cotis: fme.cotis === "" ? 0 : ogR2(fme.cotis), period: fme.period, status: "actif" });
    setFme({ ...fme, name: "", phone: "", address: "", cotis: "" }); showToast("Membre « " + name + " » ajouté."); logAudit("ONG et associations", "Membre ajouté", name);
  };
  const basculerMembre = (m) => { if (!canEdit) return; maj(m.id, (r) => ({ ...r, status: r.status === "inactif" ? "actif" : "inactif" })); showToast(m.status === "inactif" ? "Membre réactivé." : "Membre désactivé : plus de relance de cotisation."); };
  const retirerMembre = (m) => {
    if (!canEdit) return;
    if (donsOk.some((d) => d.memberId === m.id)) { showToast("Ce membre a des cotisations ou des dons : désactivez-le plutôt."); return; }
    setOng((prev) => (prev || []).filter((r) => !(r && r.type === "membre" && r.id === m.id)));
    ongRef.current = ongRef.current.filter((r) => !(r && r.type === "membre" && r.id === m.id));
    if (selMem === m.id) setSelMem("");
    showToast("« " + m.name + " » retiré.");
  };
  const enregistrerCotisation = (m) => {
    if (!canFront) return;
    const pers = periodesMembre(m).filter((p) => !periodePayee(m, p.key));
    const key = fcot.key || (pers[0] || {}).key;
    if (!key) { showToast("Aucune période à payer pour ce membre."); return; }
    if (periodePayee(m, key)) { showToast("Cette période est déjà payée."); return; }
    const amount = fcot.amount === "" ? ogR2(m.cotis) : ogR2(fcot.amount);
    if (!(amount > 0)) { showToast("Indiquez le montant de la cotisation (en gourdes)."); return; }
    if (!verifDate(fcot.date, "enregistrer cette cotisation")) return;
    const cpt = compteMode(fcot.mode === "banque" ? "banque" : "caisse");
    ogAjouterComptes(accounts, setAccounts, [cpt, "7583"]);
    const id = ogId(), number = numero("RC", lignesAJour("don"), fcot.date);
    const lib = ((periodesMembre(m).find((p) => p.key === key)) || { label: key }).label;
    const e = ecrire(fcot.date, "Cotisation " + m.name + " — " + lib, [{ account: cpt, debit: amount, credit: 0 }, { account: "7583", debit: 0, credit: amount }], id);
    ajouter({ type: "don", id, number, date: fcot.date, kind: "cotisation", memberId: m.id, periode: key, fondId: "", amount, mode: fcot.mode === "banque" ? "banque" : "caisse", label: "Cotisation — " + lib, entryId: e.id, status: "valide", by: currentUserEmail || "" });
    setFcot({ ...fcot, key: "", amount: "" });
    showToast("Cotisation de " + ogM(amount) + " enregistrée (reçu " + number + ")."); logAudit("ONG et associations", "Cotisation", m.name + " — " + ogM(amount));
    setImprimer({ kind: "recu", id });
  };
  const Membres = () => {
    const rows = membres.filter((m) => rechercher([m.name, m.phone, m.number].join(" "), mq)).sort((a, b) => a.name.localeCompare(b.name));
    const m0 = membres.find((x) => x.id === selMem);
    const exporter = () => ecTelecharger("cotisations-" + annee + ".csv", [["Membre", "Périodicité", "Cotisation", "Périodes dues", "Périodes payées", "En retard"], ...membres.map((m) => { const p = periodesMembre(m); return [m.name, m.period, m.cotis, p.length, p.filter((x) => periodePayee(m, x.key)).length, retardsMembre(m).length]; })]);
    return (
      <div>
        {canFront && (<div className="ec-card p-4 mb-5" data-testid="og-membre-form"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouveau membre</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom</label><input value={fme.name} onChange={(e) => setFme({ ...fme, name: e.target.value })} data-testid="og-membre-nom" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Téléphone</label><input value={fme.phone} onChange={(e) => setFme({ ...fme, phone: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Adhésion le</label><input type="date" max={today} value={fme.joined} onChange={(e) => setFme({ ...fme, joined: e.target.value })} data-testid="og-membre-date" className={ecInput} style={ecBorder} /></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Adresse (facultatif)</label><input value={fme.address} onChange={(e) => setFme({ ...fme, address: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Cotisation (facultatif)</label><input type="number" min="0" step="0.01" value={fme.cotis} onChange={(e) => setFme({ ...fme, cotis: e.target.value })} data-testid="og-membre-cotis" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Périodicité</label><select value={fme.period} onChange={(e) => setFme({ ...fme, period: e.target.value })} data-testid="og-membre-periode" className={ecInput} style={ecBorder}>{OG_PERIODES.map((p) => <option key={p[0]} value={p[0]}>{p[1]}</option>)}</select></div>
          </div>
          <button onClick={ajouterMembre} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="og-membre-ajouter">Ajouter le membre</button></div>)}
        <div className="ec-card p-4"><div className="flex flex-wrap gap-2 items-end mb-2"><div className="display text-base" style={{ color: "#152238" }}>{V.membres} ({membres.filter((m) => m.status !== "inactif").length} actifs)</div>
          <input value={mq} onChange={(e) => setMq(e.target.value)} placeholder="Rechercher (nom, téléphone, n°)" className={ecInput + " md:w-72"} style={ecBorder} data-testid="og-membre-recherche" />
          <button onClick={exporter} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="og-cotis-export">Exporter (CSV)</button></div>
          {rows.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucun membre.</div> : (
            <div>{rows.map((m, i) => { const per = periodesMembre(m), ret = retardsMembre(m), payees = per.filter((p) => periodePayee(m, p.key)).length; return (<div key={m.id} data-testid="og-membre-ligne" className="py-2 text-sm" style={{ borderTop: i > 0 ? "1px solid #F3EFE3" : "none", opacity: m.status === "inactif" ? 0.55 : 1, overflowWrap: "anywhere" }}>
              <div className="flex flex-wrap justify-between gap-2"><span><b>{m.name}</b> <span className="text-xs" style={{ color: "#8A8370" }}>· {m.number} · {(OG_PERIODES.find((p) => p[0] === m.period) || [0, ""])[1].toLowerCase()}{m.cotis ? " · " + ogM(m.cotis) : ""}</span></span>
                <span>{m.status === "inactif" ? ecPastille("Inactif", "neutre") : ret.length > 0 ? ecPastille("En retard : " + ret.length + " période(s)", "alerte") : per.length === 0 ? ecPastille("Rien à payer", "neutre") : payees === per.length ? ecPastille("À jour " + annee, "ok") : ecPastille("À payer", "attente")}</span></div>
              <div className="text-xs mt-0.5" style={{ color: "#8A8370" }}>{[m.phone, m.address].filter(Boolean).join(" · ") || "—"} · adhésion le {ecDateFr(m.joined)}
                {canFront && m.status !== "inactif" && <button className="underline ml-2" style={{ color: "#152238" }} onClick={() => { setSelMem(m.id === selMem ? "" : m.id); setFcot({ key: "", amount: "", mode: "caisse", date: todayStr() }); }} data-testid="og-membre-cotiser">{m.id === selMem ? "Fermer" : "Cotisation"}</button>}
                {canEdit && <button className="underline ml-2" onClick={() => basculerMembre(m)} data-testid="og-membre-basculer">{m.status === "inactif" ? "Réactiver" : "Désactiver"}</button>}
                {canEdit && !donsOk.some((d) => d.memberId === m.id) && <button className="underline ml-2" style={{ color: "#A6432F" }} onClick={() => retirerMembre(m)} data-testid="og-membre-retirer">Retirer</button>}</div>
            </div>); })}</div>)}
        </div>
        {m0 && m0.status !== "inactif" && canFront && (() => { const pers = periodesMembre(m0), dues = pers.filter((p) => !periodePayee(m0, p.key)); return (
          <div className="ec-card p-4 mt-4" data-testid="og-cotis-panneau"><div className="display text-base mb-2" style={{ color: "#152238" }}>Cotisation de {m0.name}</div>
            {dues.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Toutes les périodes de {annee} commencées sont payées.</div> : (
              <div className="grid md:grid-cols-5 gap-2 items-end">
                <div><label className="text-xs" style={{ color: "#8A8370" }}>Période</label><select value={fcot.key || dues[0].key} onChange={(e) => setFcot({ ...fcot, key: e.target.value })} data-testid="og-cotis-periode" className={ecInput} style={ecBorder}>{dues.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></div>
                <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant (G)</label><input type="number" min="0" step="0.01" value={fcot.amount} placeholder={m0.cotis ? String(m0.cotis) : ""} onChange={(e) => setFcot({ ...fcot, amount: e.target.value })} data-testid="og-cotis-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
                <div><label className="text-xs" style={{ color: "#8A8370" }}>Reçu en</label><select value={fcot.mode} onChange={(e) => setFcot({ ...fcot, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Caisse</option><option value="banque">Banque</option></select></div>
                <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={fcot.date} onChange={(e) => setFcot({ ...fcot, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
                <div><button onClick={() => enregistrerCotisation(m0)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="og-cotis-enregistrer">Encaisser et imprimer le reçu</button></div>
              </div>)}
            {pers.length > 0 && <div className="text-xs mt-2" style={{ color: "#5B563F" }}>Périodes {annee} : {pers.map((p) => p.label + (periodePayee(m0, p.key) ? " ✓" : "")).join(" · ")}</div>}
          </div>); })()}
      </div>
    );
  };

  // ───────── Fonds et projets ─────────
  const [ffo, setFfo] = useBrouillon("ong-fonds", { name: "", bailleurId: "", budget: "", start: "", end: "", desc: "" });
  const [selFonds, setSelFonds] = useState("");
  const [fvi, setFvi] = useState({ from: "", to: "", amount: "", motif: "" });
  const creerFonds = () => {
    if (!canEdit) return;
    const name = ffo.name.trim();
    if (!name) { showToast("Donnez un nom au fonds (ex. " + V.exFonds.replace(/…$/, "") + ")."); return; }
    if (lignesAJour("fonds").some((f) => ogNom(f.name) === ogNom(name)) || ogNom(name) === ogNom("Fonds général")) { showToast("Un fonds de ce nom existe déjà."); return; }
    if (ffo.budget !== "" && !(Number(ffo.budget) > 0 && Number(ffo.budget) <= 1e11)) { showToast("Le budget doit être supérieur à zéro et raisonnable."); return; }
    if (ffo.start && ffo.end && ffo.end < ffo.start) { showToast("La fin du projet ne peut pas précéder son début."); return; }
    const id = ogId();
    ajouter({ type: "fonds", id, number: numero("FD", lignesAJour("fonds"), ffo.start || today), name, bailleurId: ffo.bailleurId, budget: ffo.budget === "" ? 0 : ogR2(ffo.budget), start: ffo.start, end: ffo.end, desc: ffo.desc.trim(), status: "actif" });
    setFfo({ ...ffo, name: "", budget: "", start: "", end: "", desc: "" }); showToast("Fonds « " + name + " » créé."); logAudit("ONG et associations", "Fonds créé", name);
    setSelFonds(id);
  };
  const cloturerFonds = (f) => {
    if (!canEdit) return;
    if (f.status === "clos") { maj(f.id, (r) => ({ ...r, status: "actif" })); showToast("Fonds rouvert."); return; }
    const s = sFonds(f.id);
    if (Math.abs(s.solde) > 0.004) { showToast("Le fonds a encore un solde de " + ogM(s.solde) + " : transférez-le (virement vers un autre fonds) ou dépensez-le avant de le clôturer."); return; }
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Clôturer ce fonds ? On ne pourra plus y imputer de don ni de dépense (vous pourrez le rouvrir).")) return;
    maj(f.id, (r) => ({ ...r, status: "clos" })); showToast("Fonds clôturé."); logAudit("ONG et associations", "Fonds clôturé", f.name);
  };
  const retirerFonds = (f) => {
    if (!canEdit) return;
    if (dons.some((d) => d.fondId === f.id) || deps.some((d) => d.fondId === f.id) || vires.some((v) => v.from === f.id || v.to === f.id)) { showToast("Ce fonds a des mouvements : clôturez-le plutôt."); return; }
    setOng((prev) => (prev || []).filter((r) => !(r && r.type === "fonds" && r.id === f.id)));
    ongRef.current = ongRef.current.filter((r) => !(r && r.type === "fonds" && r.id === f.id));
    setSelFonds(""); showToast("Fonds « " + f.name + " » retiré.");
  };
  const virer = () => {
    if (!canEdit) return;
    const amount = ogR2(fvi.amount);
    if (fvi.from === fvi.to) { showToast("Choisissez deux fonds différents."); return; }
    if (!(amount > 0)) { showToast("Indiquez le montant du virement."); return; }
    if (!fvi.motif.trim()) { showToast("Indiquez la raison du virement (elle figure dans le rapport)."); return; }
    const sf = sFonds(fvi.from);
    if (amount > sf.solde + 0.004) { showToast("Le fonds de départ n'a que " + ogM(Math.max(0, sf.solde)) + " de disponible."); return; }
    const dest = fonds.find((f) => f.id === fvi.to);
    if (fvi.to && (!dest || dest.status === "clos")) { showToast("Le fonds d'arrivée est clôturé."); return; }
    if (!verifDate(today, "enregistrer ce virement")) return;
    ajouter({ type: "vire", id: ogId(), date: today, from: fvi.from, to: fvi.to, amount, motif: fvi.motif.trim(), status: "valide", by: currentUserEmail || "" });
    setFvi({ from: "", to: "", amount: "", motif: "" });
    showToast("Virement de " + ogM(amount) + " enregistré de « " + nomFonds(fvi.from) + " » vers « " + nomFonds(fvi.to) + " »."); logAudit("ONG et associations", "Virement entre fonds", nomFonds(fvi.from) + " → " + nomFonds(fvi.to) + " : " + ogM(amount));
  };
  const annulerVirement = (v) => {
    if (!canEdit || v.status === "annulé") return;
    const sd = sFonds(v.to);
    if (sd.solde - v.amount < -0.004) { showToast("Annulation impossible : le fonds d'arrivée a déjà dépensé cet argent."); return; }
    maj(v.id, (r) => ({ ...r, status: "annulé" })); showToast("Virement annulé.");
  };
  const Fonds = () => {
    const f0 = fonds.find((x) => x.id === selFonds);
    const carte = (id, nom, f) => {
      const s = sFonds(id), bud = f ? Number(f.budget) || 0 : 0, pct = bud > 0 ? Math.min(100, Math.round(s.dep * 100 / bud)) : 0;
      const bailleur = f && f.bailleurId ? nomContact(f.bailleurId) : "";
      return (<div key={id || "general"} className="ec-card p-4" data-testid="og-fonds-carte" style={{ opacity: f && f.status === "clos" ? 0.6 : 1 }}>
        <div className="flex flex-wrap justify-between gap-2"><div className="display text-base" style={{ color: "#152238", overflowWrap: "anywhere" }}>{nom}</div>{f ? (f.status === "clos" ? ecPastille("Clôturé", "neutre") : f.end && f.end < today ? ecPastille("Échu", "alerte") : ecPastille("Actif", "ok")) : ecPastille("Libre", "neutre")}</div>
        <div className="text-xs mb-2" style={{ color: "#8A8370" }}>{f ? [f.number, bailleur && V.bailleur + " : " + bailleur, f.start && "du " + ecDateFr(f.start), f.end && "au " + ecDateFr(f.end)].filter(Boolean).join(" · ") : "Argent sans destination précise : fonctionnement général de l'organisation"}</div>
        <div className="grid grid-cols-3 gap-2 text-sm"><div><div className="text-xs" style={{ color: "#8A8370" }}>Reçu</div><div className="tabular" data-testid="og-fonds-recu">{ogM(s.recu + s.vin)}</div></div><div><div className="text-xs" style={{ color: "#8A8370" }}>Dépensé</div><div className="tabular" data-testid="og-fonds-dep">{ogM(s.dep + s.vout)}</div></div><div><div className="text-xs" style={{ color: "#8A8370" }}>Solde</div><div className="tabular" data-testid="og-fonds-solde" style={{ fontWeight: 700, color: s.solde < -0.004 ? "#A6432F" : "#152238" }}>{ogM(s.solde)}</div></div></div>
        {bud > 0 && (<div className="mt-2"><div className="text-xs" style={{ color: "#8A8370" }}>Budget {ogM(bud)} · dépensé {pct} %{s.dep > bud + 0.004 ? " — budget dépassé" : ""}</div><div style={{ background: "#EEE9DA", borderRadius: 4, height: 6 }}><div style={{ width: pct + "%", background: s.dep > bud + 0.004 ? "#A6432F" : "#0F6B5C", height: 6, borderRadius: 4 }} /></div></div>)}
        <div className="mt-2 flex flex-wrap gap-3 text-xs"><button className="underline" onClick={() => setSelFonds(selFonds === id && id ? "" : id || "__general")} data-testid="og-fonds-ouvrir">{selFonds === (id || "__general") ? "Fermer" : "Détail"}</button></div>
      </div>);
    };
    const idSel = selFonds === "__general" ? "" : selFonds;
    const detailOuvert = selFonds === "__general" || !!f0;
    const mouvs = detailOuvert ? [
      ...donsOk.filter((d) => (d.fondId || "") === idSel).map((d) => ({ date: d.date, txt: natureDon(d.kind) + " — " + donateur(d) + " (" + d.number + ")", montant: d.amount, sens: 1 })),
      ...depsOk.filter((d) => (d.fondId || "") === idSel).map((d) => ({ date: d.date, txt: natureDep(d.kind) + (d.label && d.label !== natureDep(d.kind) ? " — " + d.label : ""), montant: d.amount, sens: -1 })),
      ...viresOk.filter((v) => (v.to || "") === idSel).map((v) => ({ date: v.date, txt: "Virement reçu de « " + nomFonds(v.from) + " » : " + v.motif, montant: v.amount, sens: 1 })),
      ...viresOk.filter((v) => (v.from || "") === idSel).map((v) => ({ date: v.date, txt: "Virement vers « " + nomFonds(v.to) + " » : " + v.motif, montant: v.amount, sens: -1 })),
    ].sort((a, b) => (a.date < b.date ? 1 : -1)) : [];
    return (
      <div>
        {canEdit && (<div className="ec-card p-4 mb-5" data-testid="og-fonds-form"><div className="display text-base mb-2" style={{ color: "#152238" }}>{V.fondsForm}</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom ({V.exFonds})</label><input value={ffo.name} onChange={(e) => setFfo({ ...ffo, name: e.target.value })} data-testid="og-fonds-nom" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>{V.bailleur} (facultatif)</label><select value={ffo.bailleurId} onChange={(e) => setFfo({ ...ffo, bailleurId: e.target.value })} data-testid="og-fonds-bailleur" className={ecInput} style={ecBorder}><option value="">— aucun —</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Budget du projet (facultatif)</label><input type="number" min="0" step="0.01" value={ffo.budget} onChange={(e) => setFfo({ ...ffo, budget: e.target.value })} data-testid="og-fonds-budget" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Début (facultatif)</label><input type="date" value={ffo.start} onChange={(e) => setFfo({ ...ffo, start: e.target.value })} data-testid="og-fonds-debut" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Fin prévue (facultatif)</label><input type="date" value={ffo.end} onChange={(e) => setFfo({ ...ffo, end: e.target.value })} data-testid="og-fonds-fin" className={ecInput} style={ecBorder} /></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Description (facultatif)</label><input value={ffo.desc} onChange={(e) => setFfo({ ...ffo, desc: e.target.value })} className={ecInput} style={ecBorder} /></div>
          </div>
          <button onClick={creerFonds} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="og-fonds-creer">Créer le fonds</button></div>)}
        <div className="grid md:grid-cols-2 gap-4">{carte("", "Fonds général (libre)", null)}{fonds.map((f) => carte(f.id, f.name, f))}</div>
        {detailOuvert && (<div className="ec-card p-4 mt-5" data-testid="og-fonds-detail">
          <div className="display text-lg mb-1" style={{ color: "#152238" }}>{nomFonds(idSel)}</div>
          {f0 && f0.desc && <div className="text-sm mb-2" style={{ color: "#5B563F" }}>{f0.desc}</div>}
          <div className="flex flex-wrap gap-2 mb-3">
            <button onClick={() => { marquerRapport(); setImprimer({ kind: "fonds", id: idSel }); }} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="og-fonds-rapport">Rapport financier (imprimer)</button>
            {canEdit && f0 && <button onClick={() => cloturerFonds(f0)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="og-fonds-cloturer">{f0.status === "clos" ? "Rouvrir le fonds" : "Clôturer le fonds"}</button>}
            {canEdit && f0 && <button onClick={() => retirerFonds(f0)} className="px-3 py-2 rounded text-sm" style={{ ...ecBtn, background: "#A6432F" }} data-testid="og-fonds-retirer">Retirer</button>}
          </div>
          {mouvs.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucun mouvement pour ce fonds.</div> : (
            <div className="mb-2">{mouvs.slice(0, 40).map((m, i) => (<div key={i} data-testid="og-fonds-mouvement" className="flex flex-wrap justify-between gap-2 py-1 text-sm" style={{ borderTop: i > 0 ? "1px solid #F3EFE3" : "none" }}><span style={{ overflowWrap: "anywhere" }}><span className="text-xs" style={{ color: "#8A8370" }}>{ecDateFr(m.date)}</span> {m.txt}</span><span className="tabular" style={{ color: m.sens > 0 ? "#0F6B5C" : "#A6432F" }}>{m.sens > 0 ? "+" : "−"}{ogM(m.montant)}</span></div>))}</div>)}
        </div>)}
        {canEdit && (<div className="ec-card p-4 mt-5" data-testid="og-virement-form"><div className="display text-base mb-1" style={{ color: "#152238" }}>Virement entre fonds</div>
          <div className="text-xs mb-2" style={{ color: "#8A8370" }}>Pour déplacer de l'argent d'un fonds vers un autre (ex. rembourser une avance du fonds général). C'est un suivi de gestion : aucune écriture comptable (l'argent reste en caisse ou en banque). La raison figure dans les rapports.</div>
          <div className="grid md:grid-cols-5 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>De</label><select value={fvi.from} onChange={(e) => setFvi({ ...fvi, from: e.target.value })} data-testid="og-vire-de" className={ecInput} style={ecBorder}>{[["", "Fonds général (libre)"], ...fonds.map((f) => [f.id, f.name])].map((o) => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Vers</label><select value={fvi.to} onChange={(e) => setFvi({ ...fvi, to: e.target.value })} data-testid="og-vire-vers" className={ecInput} style={ecBorder}>{fondsOptions.map((o) => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant (G)</label><input type="number" min="0" step="0.01" value={fvi.amount} onChange={(e) => setFvi({ ...fvi, amount: e.target.value })} data-testid="og-vire-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Raison</label><input value={fvi.motif} onChange={(e) => setFvi({ ...fvi, motif: e.target.value })} data-testid="og-vire-motif" className={ecInput} style={ecBorder} /></div>
            <div><button onClick={virer} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="og-vire-ok">Enregistrer le virement</button></div>
          </div>
          {viresOk.length > 0 && <div className="mt-3">{viresOk.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10).map((v) => (<div key={v.id} data-testid="og-vire-ligne" className="flex flex-wrap justify-between gap-2 py-1 text-sm" style={{ borderTop: "1px solid #F3EFE3" }}><span style={{ overflowWrap: "anywhere" }}><span className="text-xs" style={{ color: "#8A8370" }}>{ecDateFr(v.date)}</span> « {nomFonds(v.from)} » → « {nomFonds(v.to)} » : {v.motif}</span><span className="tabular">{ogM(v.amount)} <button className="text-xs underline ml-2" onClick={() => annulerVirement(v)}>Annuler</button></span></div>))}</div>}
        </div>)}
      </div>
    );
  };

  // ───────── Dons et reçus ─────────
  const [fdo, setFdo] = useBrouillon("ong-don", { date: todayStr(), kind: "", donor: "", donorName: "", fondId: "", amount: "", mode: "caisse", label: "" });
  const [dq, setDq] = useState("");
  const [dk, setDk] = useState("");
  const [df, setDf] = useState("__tous");
  const kindCourant = fdo.kind && kindsDon.some((k) => k[0] === fdo.kind) ? fdo.kind : kindsDon[0][0];
  const enregistrerDon = () => {
    if (!canFront) return;
    const amount = ogR2(fdo.amount);
    if (!(amount > 0)) { showToast("Indiquez un montant reçu valide (en gourdes, au plus 100 milliards)."); return; }
    if (!verifDate(fdo.date, "enregistrer ce don")) return;
    const fond = fonds.find((f) => f.id === fdo.fondId);
    if (fdo.fondId && (!fond || fond.status === "clos")) { showToast("Ce fonds est clôturé : choisissez-en un autre."); return; }
    const rec = OG_RECETTES.find((r) => r[0] === kindCourant);
    const [dtype, did] = String(fdo.donor || "").split(":");
    const cpt = compteMode(fdo.mode === "banque" ? "banque" : "caisse");
    ogAjouterComptes(accounts, setAccounts, [cpt, rec[2]]);
    const id = ogId(), number = numero("RC", lignesAJour("don"), fdo.date);
    const e = ecrire(fdo.date, rec[1] + " — " + (dtype === "m" ? nomMembre(did) : dtype === "c" ? nomContact(did) : (fdo.donorName.trim() || "donateur anonyme")) + " (reçu " + number + ")", [{ account: cpt, debit: amount, credit: 0 }, { account: rec[2], debit: 0, credit: amount }], id);
    ajouter({ type: "don", id, number, date: fdo.date, kind: kindCourant, donorId: dtype === "c" ? did : "", memberId: dtype === "m" ? did : "", donorName: dtype ? "" : fdo.donorName.trim(), fondId: fdo.fondId, amount, mode: fdo.mode === "banque" ? "banque" : "caisse", label: fdo.label.trim(), entryId: e.id, status: "valide", by: currentUserEmail || "" });
    setFdo({ ...fdo, donor: "", donorName: "", amount: "", label: "" });
    showToast("Reçu " + number + " : " + ogM(amount) + "."); logAudit("ONG et associations", rec[1], number + " — " + ogM(amount));
    setImprimer({ kind: "recu", id });
  };
  const annulerDon = (d) => {
    if (!canEdit || d.status === "annulé") return;
    if (!verifDate(today, "annuler ce don")) return;
    const s = sFonds(d.fondId || "");
    if (s.solde - d.amount < -0.004) { showToast("Annulation impossible : l'argent de ce don a déjà été dépensé ou viré (solde du fonds : " + ogM(s.solde) + ")."); return; }
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler le reçu " + d.number + " ? Une écriture inverse sera passée.")) return;
    const e = contre(d.entryId, "Annulation reçu " + d.number + " (écriture inverse)", today, d.id);
    maj(d.id, (r) => ({ ...r, status: "annulé", reversalEntryId: e ? e.id : "" }));
    showToast("Reçu " + d.number + " annulé."); logAudit("ONG et associations", "Reçu annulé", d.number);
  };
  const Dons = () => {
    const rows = dons.filter((d) => (!dk || d.kind === dk) && (df === "__tous" || (d.fondId || "") === df) && rechercher([d.number, donateur(d), d.label].join(" "), dq)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.number < b.number ? 1 : -1));
    const tot = ogR2(rows.filter((d) => d.status !== "annulé").reduce((s, d) => s + d.amount, 0));
    const exporter = () => ecTelecharger("dons-" + today + ".csv", [["Reçu", "Date", "Donateur", "Nature", "Fonds", "Montant", "Mode", "État"], ...rows.map((d) => [d.number, d.date, donateur(d), natureDon(d.kind), nomFonds(d.fondId), d.amount, d.mode, d.status === "annulé" ? "annulé" : "valide"])]);
    return (
      <div>
        {canFront && (<div className="ec-card p-4 mb-5" data-testid="og-don-form"><div className="display text-base mb-2" style={{ color: "#152238" }}>{V.formRecette}</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={fdo.date} onChange={(e) => setFdo({ ...fdo, date: e.target.value })} data-testid="og-don-date" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Nature</label><select value={kindCourant} onChange={(e) => setFdo({ ...fdo, kind: e.target.value })} data-testid="og-don-nature" className={ecInput} style={ecBorder}>{kindsDon.map((k) => <option key={k[0]} value={k[0]}>{k[1]}</option>)}</select></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>De la part de</label><select value={fdo.donor} onChange={(e) => setFdo({ ...fdo, donor: e.target.value })} data-testid="og-don-donateur" className={ecInput} style={ecBorder}><option value="">Donateur anonyme ou non enregistré</option>{contacts.length > 0 && <optgroup label={V.contacts}>{contacts.map((c) => <option key={c.id} value={"c:" + c.id}>{c.name}</option>)}</optgroup>}{membres.length > 0 && <optgroup label={V.membres}>{membres.map((m) => <option key={m.id} value={"m:" + m.id}>{m.name}</option>)}</optgroup>}</select></div>
            {!fdo.donor && <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom à inscrire sur le reçu (facultatif)</label><input value={fdo.donorName} onChange={(e) => setFdo({ ...fdo, donorName: e.target.value })} data-testid="og-don-nomlibre" className={ecInput} style={ecBorder} /></div>}
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Destiné au fonds</label><select value={fdo.fondId} onChange={(e) => setFdo({ ...fdo, fondId: e.target.value })} data-testid="og-don-fonds" className={ecInput} style={ecBorder}>{fondsOptions.map((o) => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant (G)</label><input type="number" min="0" step="0.01" value={fdo.amount} onChange={(e) => setFdo({ ...fdo, amount: e.target.value })} data-testid="og-don-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Reçu en</label><select value={fdo.mode} onChange={(e) => setFdo({ ...fdo, mode: e.target.value })} data-testid="og-don-mode" className={ecInput} style={ecBorder}><option value="caisse">Caisse (espèces)</option><option value="banque">Banque (virement, chèque)</option></select></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Remarque (facultatif)</label><input value={fdo.label} onChange={(e) => setFdo({ ...fdo, label: e.target.value })} data-testid="og-don-remarque" className={ecInput} style={ecBorder} /></div>
          </div>
          <button onClick={enregistrerDon} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="og-don-enregistrer">Enregistrer et imprimer le reçu</button></div>)}
        <div className="ec-card p-4"><div className="flex flex-wrap gap-2 items-end mb-2"><div className="display text-base" style={{ color: "#152238" }}>{V.recettes}</div>
          <input value={dq} onChange={(e) => setDq(e.target.value)} placeholder="Rechercher (n° de reçu, donateur)" className={ecInput + " md:w-64"} style={ecBorder} data-testid="og-don-recherche" />
          <select value={dk} onChange={(e) => setDk(e.target.value)} className={ecInput + " md:w-56"} style={ecBorder}><option value="">Toutes natures</option>{kindsRecAll.map((k) => <option key={k[0]} value={k[0]}>{k[1]}</option>)}</select>
          <select value={df} onChange={(e) => setDf(e.target.value)} className={ecInput + " md:w-56"} style={ecBorder}><option value="__tous">Tous les fonds</option>{[["", "Fonds général (libre)"], ...fonds.map((f) => [f.id, f.name])].map((o) => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select>
          <button onClick={exporter} className="px-3 py-2 rounded text-sm" style={ecBtn}>Exporter (CSV)</button></div>
          <div className="text-sm mb-2">Total affiché : <b className="tabular" data-testid="og-don-total">{ogM(tot)}</b></div>
          {rows.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucun don enregistré.</div> : (
            <div>{rows.slice(0, 200).map((d, i) => (<div key={d.id} data-testid="og-don-ligne" className="py-2 text-sm" style={{ borderTop: i > 0 ? "1px solid #F3EFE3" : "none", opacity: d.status === "annulé" ? 0.5 : 1, overflowWrap: "anywhere" }}>
              <div className="flex flex-wrap justify-between gap-2"><span><b>{d.number}</b> <span className="text-xs" style={{ color: "#8A8370" }}>· {ecDateFr(d.date)}</span> · {donateur(d)}</span><span className="tabular"><b>{ogM(d.amount)}</b> {d.status === "annulé" ? ecPastille("Annulé", "neutre") : null}</span></div>
              <div className="text-xs" style={{ color: "#8A8370" }}>{natureDon(d.kind)} · {nomFonds(d.fondId)}{d.label ? " · " + d.label : ""}
                <button className="underline ml-2" style={{ color: "#152238" }} onClick={() => setImprimer({ kind: "recu", id: d.id })} data-testid="og-don-recu">Reçu</button>
                {canEdit && d.status !== "annulé" && <button className="underline ml-2" style={{ color: "#A6432F" }} onClick={() => annulerDon(d)} data-testid="og-don-annuler">Annuler</button>}</div></div>))}</div>)}
        </div>
      </div>
    );
  };

  // ───────── Dépenses ─────────
  const [fd, setFd] = useBrouillon("ong-depense", { date: todayStr(), kind: "activites", fondId: "", amount: "", mode: "caisse", supplier: "", label: "" });
  const [dpq, setDpq] = useState("");
  const [dpk, setDpk] = useState("");
  const [selDep, setSelDep] = useState("");
  const [rg, setRg] = useState({ date: todayStr(), mode: "caisse", amount: "" });
  const [alerteDep, setAlerteDep] = useState(null);
  const [motifDep, setMotifDep] = useState({ motif: "", txt: "" });
  const enregistrerDepense = (confirme) => {
    if (!canEdit) return;
    const amount = ogR2(fd.amount);
    if (!(amount > 0)) { showToast("Indiquez le montant (en gourdes)."); return; }
    const def = OG_DEPENSES.find((x) => x[0] === fd.kind) || OG_DEPENSES[0];
    const sansEcr = !def[2];
    if (!sansEcr && fd.mode === "apayer" && !fd.supplier.trim()) { showToast("Pour une dépense à payer plus tard, indiquez le fournisseur."); return; }
    if (!verifDate(fd.date, "enregistrer cette dépense")) return;
    const fond = fonds.find((f) => f.id === fd.fondId);
    if (fd.fondId && (!fond || fond.status === "clos")) { showToast("Ce fonds est clôturé : choisissez-en un autre."); return; }
    const msgs = verifDepassement(fd.fondId, amount);
    let depassement = null;
    if (msgs.length > 0) {
      if (!confirme) { setAlerteDep(msgs); setMotifDep({ motif: "", txt: "" }); showToast("Attention : " + msgs.join(" ; ") + ". Une raison est demandée."); return; }
      if (!motifDep.motif) { showToast("Choisissez la raison du dépassement."); return; }
      if (motifDep.motif === "autre" && !motifDep.txt.trim()) { showToast("Précisez la raison du dépassement."); return; }
      depassement = { motif: motifDep.motif, txt: motifDep.txt.trim(), msg: msgs.join(" ; "), by: currentUserEmail || "" };
    }
    const mode = sansEcr ? "salaires" : fd.mode;
    const cpt = compteMode(mode);
    const label = fd.label.trim() || def[1];
    const id = ogId();
    let e = null;
    if (!sansEcr) { ogAjouterComptes(accounts, setAccounts, [def[2], cpt]); e = ecrire(fd.date, "ONG — " + label + (fond ? " (" + fond.name + ")" : ""), [{ account: def[2], debit: amount, credit: 0 }, { account: cpt, debit: 0, credit: amount }], id); }
    ajouter({ type: "dep", id, date: fd.date, kind: fd.kind, label, supplier: fd.supplier.trim(), amount, mode, entryId: e ? e.id : "", fondId: fd.fondId, depassement, status: "valide", settlements: [], by: currentUserEmail || "" });
    setFd({ ...fd, label: "", amount: "", supplier: "" }); setAlerteDep(null); setMotifDep({ motif: "", txt: "" });
    showToast("Dépense enregistrée : " + ogM(amount) + "." + (depassement ? " Dépassement justifié et tracé." : "")); logAudit("ONG et associations", depassement ? "Dépense avec dépassement" : "Dépense", label + " — " + ogM(amount) + (depassement ? " — " + (OG_MOTIFS.find((m) => m[0] === depassement.motif) || [0, ""])[1] : ""));
  };
  const annulerDepense = (d) => {
    if (!canEdit || d.status === "annulé") return;
    if (ogPaye(d.settlements) > 0) { showToast("Annulez d'abord les règlements de cette dépense."); return; }
    if (!verifDate(today, "annuler cette dépense")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler cette dépense ? Une écriture inverse sera passée.")) return;
    const e = contre(d.entryId, "Annulation — " + d.label + " (écriture inverse)", today, d.id);
    maj(d.id, (r) => ({ ...r, status: "annulé", reversalEntryId: e ? e.id : "" }));
    showToast("Dépense annulée.");
  };
  const reglerDep = (d) => {
    if (!canEdit || d.mode !== "apayer" || d.status === "annulé") return;
    const reste = resteDep(d);
    const amount = rg.amount === "" ? reste : ogR2(rg.amount);
    if (!(amount > 0) || amount > reste + 0.004) { showToast("Le montant doit être compris entre 0 et le reste à payer (" + ogM(reste) + ")."); return; }
    if (!verifDate(rg.date, "enregistrer ce règlement")) return;
    const cpt = compteMode(rg.mode === "banque" ? "banque" : "caisse");
    ogAjouterComptes(accounts, setAccounts, [cpt, "401"]);
    const e = ecrire(rg.date, "Règlement " + (d.supplier || "fournisseur") + " — " + d.label, [{ account: "401", debit: amount, credit: 0 }, { account: cpt, debit: 0, credit: amount }], d.id);
    maj(d.id, (r) => ({ ...r, settlements: [...(r.settlements || []), { id: ogId(), date: rg.date, amount, mode: rg.mode, entryId: e.id, status: "valide" }] }));
    setRg({ ...rg, amount: "" }); showToast("Règlement de " + ogM(amount) + " enregistré."); logAudit("ONG et associations", "Dette réglée", (d.supplier || "") + " — " + ogM(amount));
  };
  const annulerRegDep = (d, s) => {
    if (!canEdit || s.status === "annulé") return;
    if (!verifDate(today, "annuler ce règlement")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler ce règlement ? Une écriture inverse sera passée.")) return;
    const e = contre(s.entryId, "Annulation règlement " + (d.supplier || "") + " (écriture inverse)", today, d.id);
    maj(d.id, (r) => ({ ...r, settlements: r.settlements.map((x) => (x.id === s.id ? { ...x, status: "annulé", reversalEntryId: e ? e.id : "" } : x)) }));
    showToast("Règlement annulé.");
  };
  const Depenses = () => {
    const rows = deps.filter((d) => (!dpk || d.kind === dpk) && rechercher([d.label, d.supplier, nomFonds(d.fondId)].join(" "), dpq)).sort((a, b) => (a.date < b.date ? 1 : -1));
    const d0 = deps.find((x) => x.id === selDep);
    const def = OG_DEPENSES.find((x) => x[0] === fd.kind) || OG_DEPENSES[0];
    return (
      <div>
        {canEdit && (<div className="ec-card p-4 mb-5" data-testid="og-dep-form"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvelle dépense</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={fd.date} onChange={(e) => setFd({ ...fd, date: e.target.value })} data-testid="og-dep-date" className={ecInput} style={ecBorder} /></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nature</label><select value={fd.kind} onChange={(e) => setFd({ ...fd, kind: e.target.value })} data-testid="og-dep-nature" className={ecInput} style={ecBorder}>{kindsDep.map((k) => <option key={k[0]} value={k[0]}>{k[1]}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant (G)</label><input type="number" min="0" step="0.01" value={fd.amount} onChange={(e) => { setAlerteDep(null); setFd({ ...fd, amount: e.target.value }); }} data-testid="og-dep-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Imputer au fonds</label><select value={fd.fondId} onChange={(e) => { setAlerteDep(null); setFd({ ...fd, fondId: e.target.value }); }} data-testid="og-dep-fonds" className={ecInput} style={ecBorder}>{fondsOptions.map((o) => <option key={o[0]} value={o[0]}>{o[1]}{o[0] ? "" : ""}</option>)}</select></div>
            {def[2] && <div><label className="text-xs" style={{ color: "#8A8370" }}>Payé</label><select value={fd.mode} onChange={(e) => setFd({ ...fd, mode: e.target.value })} data-testid="og-dep-mode" className={ecInput} style={ecBorder}><option value="caisse">Caisse (espèces)</option><option value="banque">Banque</option><option value="apayer">À payer plus tard (dette)</option></select></div>}
            {def[2] && <div><label className="text-xs" style={{ color: "#8A8370" }}>Fournisseur{fd.mode === "apayer" ? " (obligatoire)" : " (facultatif)"}</label><input list="og-dl-fourn" value={fd.supplier} onChange={(e) => setFd({ ...fd, supplier: e.target.value })} data-testid="og-dep-fournisseur" className={ecInput} style={ecBorder} /></div>}
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Détail (facultatif)</label><input value={fd.label} onChange={(e) => setFd({ ...fd, label: e.target.value })} data-testid="og-dep-detail" className={ecInput} style={ecBorder} /></div>
          </div>
          {alerteDep && (<div className="p-3 rounded text-sm mt-3" style={{ background: "#FBE9E4", color: "#7A2E1F" }} data-testid="og-dep-alerte">
            <div className="mb-2"><b>Dépassement :</b> {alerteDep.join(" ; ")}. Un dépassement doit être justifié : choisissez la raison. Elle sera inscrite sur la dépense, au journal d'audit et dans le rapport du fonds.</div>
            <div className="grid md:grid-cols-3 gap-2 items-end"><div className="md:col-span-2"><select value={motifDep.motif} onChange={(e) => setMotifDep({ ...motifDep, motif: e.target.value })} data-testid="og-dep-motif" className={ecInput} style={ecBorder}><option value="">— choisir la raison —</option>{OG_MOTIFS.map((m) => <option key={m[0]} value={m[0]}>{m[1]}</option>)}</select></div>
              {motifDep.motif === "autre" && <input value={motifDep.txt} onChange={(e) => setMotifDep({ ...motifDep, txt: e.target.value })} placeholder="Précisez" data-testid="og-dep-motif-txt" className={ecInput} style={ecBorder} />}</div>
            <div className="flex flex-wrap gap-2 mt-2"><button onClick={() => enregistrerDepense(true)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="og-dep-confirmer">Confirmer le dépassement</button><button onClick={() => setAlerteDep(null)} className="px-3 py-2 rounded text-sm" style={ecBtn}>Annuler</button></div></div>)}
          <button onClick={() => enregistrerDepense(false)} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="og-dep-enregistrer">Enregistrer la dépense</button></div>)}
        <div className="ec-card p-4"><div className="flex flex-wrap gap-2 items-end mb-2"><div className="display text-base" style={{ color: "#152238" }}>Dépenses</div>
          <input value={dpq} onChange={(e) => setDpq(e.target.value)} placeholder="Rechercher (détail, fournisseur, fonds)" className={ecInput + " md:w-64"} style={ecBorder} data-testid="og-dep-recherche" />
          <select value={dpk} onChange={(e) => setDpk(e.target.value)} className={ecInput + " md:w-64"} style={ecBorder}><option value="">Toutes natures</option>{kindsDep.map((k) => <option key={k[0]} value={k[0]}>{k[1]}</option>)}</select></div>
          {rows.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucune dépense.</div> : (
            <div>{rows.slice(0, 200).map((d, i) => (<div key={d.id} data-testid="og-dep-ligne" className="py-2 text-sm" style={{ borderTop: i > 0 ? "1px solid #F3EFE3" : "none", opacity: d.status === "annulé" ? 0.5 : 1, overflowWrap: "anywhere" }}>
              <div className="flex flex-wrap justify-between gap-2"><span><span className="text-xs" style={{ color: "#8A8370" }}>{ecDateFr(d.date)}</span> · <b>{d.label}</b></span><span className="tabular"><b>{ogM(d.amount)}</b> {d.status === "annulé" ? ecPastille("Annulée", "neutre") : d.mode === "apayer" ? (resteDep(d) > 0.004 ? ecPastille("À payer : " + ogM(resteDep(d)), "attente") : ecPastille("Payée", "ok")) : null}</span></div>
              <div className="text-xs" style={{ color: "#8A8370" }}>{natureDep(d.kind)} · {nomFonds(d.fondId)}{d.supplier ? " · " + d.supplier : ""}{d.depassement ? " · dépassement justifié : " + ((OG_MOTIFS.find((m) => m[0] === d.depassement.motif) || [0, ""])[1]) + (d.depassement.txt ? " (" + d.depassement.txt + ")" : "") : ""}
                {canEdit && d.mode === "apayer" && d.status !== "annulé" && <button className="underline ml-2" style={{ color: "#152238" }} onClick={() => { setSelDep(d.id === selDep ? "" : d.id); setRg({ date: todayStr(), mode: "caisse", amount: "" }); }} data-testid="og-dep-ouvrir">{d.id === selDep ? "Fermer" : "Régler"}</button>}
                {canEdit && d.status !== "annulé" && <button className="underline ml-2" style={{ color: "#A6432F" }} onClick={() => annulerDepense(d)} data-testid="og-dep-annuler">Annuler</button>}</div></div>))}</div>)}
        </div>
        {d0 && d0.mode === "apayer" && d0.status !== "annulé" && canEdit && (
          <div className="ec-card p-4 mt-4" data-testid="og-dep-detail-panneau"><div className="display text-base mb-2" style={{ color: "#152238" }}>Règlement — {d0.supplier || "fournisseur"} · reste à payer {ogM(resteDep(d0))}</div>
            {(d0.settlements || []).map((s) => (<div key={s.id} className="flex flex-wrap justify-between gap-2 text-sm py-1" data-testid="og-dep-reglement" style={{ opacity: s.status === "annulé" ? 0.5 : 1 }}><span>{ecDateFr(s.date)} · {s.mode === "banque" ? "Banque" : "Caisse"}</span><span className="tabular">{ogM(s.amount)} {s.status === "annulé" ? ecPastille("Annulé", "neutre") : <button className="text-xs underline ml-2" onClick={() => annulerRegDep(d0, s)}>Annuler</button>}</span></div>))}
            {resteDep(d0) > 0.004 && (<div className="grid md:grid-cols-4 gap-2 items-end mt-2">
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant (vide = solde)</label><input type="number" min="0" step="0.01" value={rg.amount} onChange={(e) => setRg({ ...rg, amount: e.target.value })} data-testid="og-reg-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Payé par</label><select value={rg.mode} onChange={(e) => setRg({ ...rg, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Caisse</option><option value="banque">Banque</option></select></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={rg.date} onChange={(e) => setRg({ ...rg, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
              <div><button onClick={() => reglerDep(d0)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="og-reg-ok">Enregistrer le règlement</button></div></div>)}
          </div>)}
      </div>
    );
  };

  // ───────── Tableau de bord ─────────
  const Apercu = () => {
    const recuMois = ogR2(donsOk.filter((d) => String(d.date).startsWith(moisCourant)).reduce((s, d) => s + d.amount, 0));
    const depMois = ogR2(depsOk.filter((d) => String(d.date).startsWith(moisCourant)).reduce((s, d) => s + d.amount, 0));
    const soldeTotal = ogR2(["", ...fonds.map((f) => f.id)].reduce((s, id) => s + sFonds(id).solde, 0));
    const aPayer = ogR2(depsOk.filter((d) => d.mode === "apayer").reduce((s, d) => s + resteDep(d), 0));
    const actifs = fonds.filter((f) => f.status !== "clos");
    const afaire = [];
    membres.filter((m) => retardsMembre(m).length > 0).forEach((m) => { const r = retardsMembre(m); afaire.push({ tab: "membres", sel: m.id, nom: m.name, txt: "Cotisation en retard : " + r.map((p) => p.label).slice(0, 3).join(", ") + (r.length > 3 ? "…" : "") }); });
    actifs.forEach((f) => {
      const s = sFonds(f.id), bud = Number(f.budget) || 0;
      if (bud > 0 && s.dep > bud + 0.004) afaire.push({ tab: "fonds", sel: f.id, nom: f.name, txt: "Budget dépassé de " + ogM(s.dep - bud) + " : informez " + V.lBailleur + " ou revoyez le budget" });
      if (s.solde < -0.004) afaire.push({ tab: "fonds", sel: f.id, nom: f.name, txt: "Solde négatif (" + ogM(s.solde) + ") : des dépenses ont dépassé l'argent reçu pour ce fonds" });
      if (f.end && f.end < today) afaire.push({ tab: "fonds", sel: f.id, nom: f.name, txt: s.solde > 0.004 ? "Projet échu avec " + ogM(s.solde) + " non dépensés : rendez compte à " + V.lBailleur.replace("le ", "au ") + ", virez le solde puis clôturez" : "Projet échu : établissez le rapport financier puis clôturez le fonds" });
    });
    depsOk.filter((d) => resteDep(d) > 0.004 && ogJours(d.date, today) > 30).forEach((d) => afaire.push({ tab: "depenses", sel: d.id, nom: d.supplier || d.label, txt: "Dépense du " + ecDateFr(d.date) + " à payer depuis plus de 30 jours : " + ogM(resteDep(d)) }));
    const etapes = [
      ["Type d'organisation", "Choisissez ci-dessus : ONG, association, église ou fondation. Les mots et les natures de recettes s'adaptent.", "apercu", !!orgType],
      ["Fonds et projets", "Onglet Fonds et projets : créez un fonds par projet ou par " + V.bailleur.toLowerCase() + " (le reste va au fonds général).", "fonds", fonds.length > 0],
      ["Donateurs et membres", "Enregistrez vos " + V.contacts.toLowerCase() + " ou " + V.membres.toLowerCase() + " (facultatif pour les dons anonymes).", "contacts", contacts.length + membres.length > 0],
      ["Premier don avec reçu", "Onglet " + V.recettes.split(" et reçus")[0] + " : " + V.guideDon + " : le reçu numéroté s'imprime et la comptabilité se fait seule.", "dons", donsOk.length > 0],
      ["Première dépense", "Onglet Dépenses : imputez la dépense à un fonds ; si elle dépasse le solde ou le budget, une raison est demandée.", "depenses", depsOk.length > 0],
      ["Budget d'un projet", "Dans Fonds et projets, donnez un budget à un projet pour suivre ce qui reste à dépenser.", "fonds", fonds.some((f) => Number(f.budget) > 0)],
      ["Premier rapport financier", "Dans Fonds et projets, ouvrez un fonds puis « Rapport financier » : à remettre à " + V.lBailleur.replace("le ", "au ") + " ou au comité.", "fonds", !!cfg.rapportVu],
    ];
    const toutFait = etapes.every((e) => e[3]);
    const kpis = [["Reçu ce mois", ogM(recuMois), "og-kpi-recu"], ["Dépensé ce mois", ogM(depMois), "og-kpi-dep"], ["Solde de tous les fonds", ogM(soldeTotal), "og-kpi-solde"], ["Fonds actifs", String(actifs.length), "og-kpi-fonds"], ["Membres actifs", String(membres.filter((m) => m.status !== "inactif").length), "og-kpi-membres"], ["Dépenses à payer", ogM(aPayer), "og-kpi-apayer"], ["Cotisations en retard", String(membres.filter((m) => retardsMembre(m).length > 0).length), "og-kpi-retard"], ["Choses à faire", String(afaire.length), "og-kpi-afaire"]];
    const accesTab = (tb) => !(isVendeur && !["contacts", "dons", "membres", "apercu"].includes(tb));
    return (
      <div>
        {!orgType && canEdit && (<div className="ec-card p-4 mb-5" data-testid="og-type-carte"><div className="display text-base mb-1" style={{ color: "#152238" }}>Quel type d'organisation êtes-vous ?</div>
          <div className="text-xs mb-2" style={{ color: "#8A8370" }}>Ce choix adapte les mots (bailleurs, fidèles, membres…) et les natures de recettes proposées (subvention, collecte, dîme, offrande…). Vous pourrez le changer.</div>
          <div className="flex flex-wrap gap-2">{OG_TYPES.map((t) => <button key={t[0]} onClick={() => choisirType(t[0])} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid={"og-type-" + t[0]}>{t[1]}</button>)}</div></div>)}
        {orgType && canEdit && (<div className="text-xs mb-3" style={{ color: "#8A8370" }} data-testid="og-type-actuel">Type d'organisation : <b>{(OG_TYPES.find((t) => t[0] === orgType) || [0, ""])[1]}</b> · changer : <select value={orgType} onChange={(e) => choisirType(e.target.value)} data-testid="og-type-select" style={{ border: "1px solid #DDD6C4", borderRadius: 4, padding: "2px 4px", background: "#fff" }}>{OG_TYPES.map((t) => <option key={t[0]} value={t[0]}>{t[1]}</option>)}</select></div>)}
        {(<div className="ec-card p-4 mb-5" data-testid="og-guide">
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Marche à suivre, en 7 étapes{toutFait ? " — toutes faites ✓" : ""}</div>
          <ol className="text-sm" style={{ color: "#152238", listStyle: "none", paddingLeft: 0 }}>{etapes.map(([t, d, tb, fait], i) => (<li key={i} data-testid="og-etape" className="mb-1.5 flex flex-wrap gap-2 items-baseline"><span style={{ color: fait ? "#0F6B5C" : "#8A8370", fontWeight: 700 }}>{fait ? "✓" : (i + 1) + "."}</span><span><b>{t}</b> — <span style={{ color: "#5B563F" }}>{d}</span></span>{!fait && tb !== "apercu" && accesTab(tb) && <button className="text-xs underline" data-testid="og-etape-ouvrir" onClick={() => setTab(tb)}>Ouvrir</button>}</li>))}</ol>
        </div>)}
        {dons.length + deps.length + fonds.length === 0 && <div className="p-4 rounded text-sm mb-4" style={{ background: "#FFF6E0", color: "#152238" }} data-testid="og-vide">Pour commencer : choisissez votre <b>type d'organisation</b>, créez vos <b>fonds</b> (projets), enregistrez votre premier <b>don</b> avec son reçu, puis vos <b>dépenses</b> imputées à un fonds.</div>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {kpis.map(([l, v, t]) => (<div key={t} className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>{l}</div><div className="display text-lg tabular" data-testid={t} style={{ color: "#152238" }}>{v}</div></div>))}
        </div>
        <div className="display text-base mb-2" style={{ color: "#152238" }}>À faire</div>
        {afaire.length === 0 ? <div className="text-sm mb-5" style={{ color: "#8A8370" }}>Rien en attente.</div> : (
          <div className="ec-card p-4 mb-5">{afaire.slice(0, 15).map((x, i) => (<div key={i} data-testid="og-afaire-ligne" className="flex flex-wrap justify-between gap-2 py-1.5 text-sm" style={{ borderTop: i > 0 ? "1px solid #F3EFE3" : "none" }}><span style={{ overflowWrap: "anywhere" }}><b>{x.nom}</b> — {x.txt}</span>{accesTab(x.tab) && <button className="text-xs underline" data-testid="og-afaire-ouvrir" onClick={() => { setTab(x.tab); if (x.tab === "membres" && x.sel) setSelMem(x.sel); if (x.tab === "fonds" && x.sel) setSelFonds(x.sel); if (x.tab === "depenses" && x.sel) setSelDep(x.sel); }}>Ouvrir</button>}</div>))}</div>
        )}
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Fonds : où en est-on ?</div>
        <div className="ec-card p-4">{["", ...actifs.map((f) => f.id)].map((id, i) => { const s = sFonds(id); return (<div key={id || "g"} data-testid="og-apercu-fonds" className="flex flex-wrap justify-between gap-2 py-1.5 text-sm" style={{ borderTop: i > 0 ? "1px solid #F3EFE3" : "none" }}><span style={{ overflowWrap: "anywhere" }}>{nomFonds(id)}</span><span className="tabular" style={{ color: s.solde < -0.004 ? "#A6432F" : "#152238", fontWeight: 600 }}>{ogM(s.solde)}</span></div>); })}</div>
      </div>
    );
  };

  // ───────── Rapports ─────────
  const [rp, setRp] = useState({ from: annee + "-01-01", to: todayStr() });
  const [ry, setRy] = useState(annee);
  const donsAnnee = (y) => donsOk.filter((d) => String(d.date).startsWith(y));
  const parDonateur = (y) => {
    const m = new Map();
    donsAnnee(y).forEach((d) => { const k = d.memberId ? "m:" + d.memberId : d.donorId ? "c:" + d.donorId : "a:" + (d.donorName || ""); const e = m.get(k) || { k, nom: donateur(d), n: 0, total: 0, kinds: {} }; e.n += 1; e.total = ogR2(e.total + d.amount); e.kinds[d.kind] = ogR2((e.kinds[d.kind] || 0) + d.amount); m.set(k, e); });
    return [...m.values()].sort((a, b) => b.total - a.total);
  };
  const Rapports = () => {
    const inP = (d) => d >= rp.from && d <= rp.to;
    const ids = ["", ...fonds.map((f) => f.id)];
    const lignesFonds = ids.map((id) => { const s = sFonds(id); const recuP = ogR2(donsOk.filter((d) => (d.fondId || "") === id && inP(d.date)).reduce((t, d) => t + d.amount, 0)); const depP = ogR2(depsOk.filter((d) => (d.fondId || "") === id && inP(d.date)).reduce((t, d) => t + d.amount, 0)); return { id, nom: nomFonds(id), recuP, depP, s, f: fonds.find((x) => x.id === id) }; });
    const parNatD = {}; depsOk.filter((d) => inP(d.date)).forEach((d) => { parNatD[natureDep(d.kind)] = ogR2((parNatD[natureDep(d.kind)] || 0) + d.amount); });
    const parNatR = {}; donsOk.filter((d) => inP(d.date)).forEach((d) => { parNatR[natureDon(d.kind)] = ogR2((parNatR[natureDon(d.kind)] || 0) + d.amount); });
    const dd = parDonateur(ry);
    const totalAn = ogR2(dd.reduce((s, x) => s + x.total, 0));
    const attendu = ogR2(membres.reduce((s, m) => s + periodesMembre(m, ry).length * (Number(m.cotis) || 0), 0));
    const percu = ogR2(donsAnnee(ry).filter((d) => d.kind === "cotisation").reduce((s, d) => s + d.amount, 0));
    const exporterFonds = () => ecTelecharger("fonds-" + today + ".csv", [["Fonds", "Reçu (période)", "Dépensé (période)", "Solde actuel", "Budget"], ...lignesFonds.map((l) => [l.nom, l.recuP, l.depP, l.s.solde, l.f ? l.f.budget : ""])]);
    const exporterDons = () => ecTelecharger("dons-par-donateur-" + ry + ".csv", [["Donateur", "Nombre de reçus", "Total", ...OG_RECETTES.map((r) => natureDon(r[0]))], ...dd.map((x) => [x.nom, x.n, x.total, ...OG_RECETTES.map((r) => x.kinds[r[0]] || 0)])]);
    return (
      <div>
        <div className="flex flex-wrap gap-2 items-end mb-4"><div><label className="text-xs" style={{ color: "#8A8370" }}>Du</label><input type="date" value={rp.from} onChange={(e) => setRp({ ...rp, from: e.target.value })} data-testid="og-rp-du" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Au</label><input type="date" value={rp.to} onChange={(e) => setRp({ ...rp, to: e.target.value })} data-testid="og-rp-au" className={ecInput} style={ecBorder} /></div></div>
        <div className="ec-card p-4 mb-4"><div className="flex flex-wrap justify-between gap-2 mb-2"><div className="display text-base" style={{ color: "#152238" }}>Situation des fonds (période)</div><button onClick={exporterFonds} className="px-3 py-1.5 rounded text-sm" style={ecBtn}>Exporter (CSV)</button></div>
          {lignesFonds.map((l, i) => (<div key={l.id || "g"} data-testid="og-rap-fonds-ligne" className="py-2 text-sm" style={{ borderTop: i > 0 ? "1px solid #F3EFE3" : "none", overflowWrap: "anywhere" }}>
            <div className="flex flex-wrap justify-between gap-2"><b>{l.nom}</b><span className="tabular" style={{ color: l.s.solde < -0.004 ? "#A6432F" : "#152238", fontWeight: 600 }}>Solde {ogM(l.s.solde)}</span></div>
            <div className="text-xs" style={{ color: "#8A8370" }}>Reçu {ogM(l.recuP)} · dépensé {ogM(l.depP)}{l.f && Number(l.f.budget) > 0 ? " · budget " + ogM(l.f.budget) + " (" + Math.round(l.s.dep * 100 / Number(l.f.budget)) + " % dépensé)" : ""}
              <button className="underline ml-2" style={{ color: "#152238" }} onClick={() => { marquerRapport(); setImprimer({ kind: "fonds", id: l.id, from: rp.from, to: rp.to }); }} data-testid="og-rap-fonds-imprimer">Rapport financier</button></div></div>))}
        </div>
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div className="ec-card p-4"><div className="display text-base mb-2" style={{ color: "#152238" }}>Recettes par nature</div>{Object.keys(parNatR).length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucune recette sur la période.</div> : Object.keys(parNatR).map((k) => (<div key={k} className="flex justify-between gap-2 py-1 text-sm" data-testid="og-rap-recette-ligne"><span>{k}</span><span className="tabular">{ogM(parNatR[k])}</span></div>))}</div>
          <div className="ec-card p-4"><div className="display text-base mb-2" style={{ color: "#152238" }}>Dépenses par nature</div>{Object.keys(parNatD).length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucune dépense sur la période.</div> : Object.keys(parNatD).map((k) => (<div key={k} className="flex justify-between gap-2 py-1 text-sm" data-testid="og-rap-depense-ligne"><span>{k}</span><span className="tabular">{ogM(parNatD[k])}</span></div>))}</div>
        </div>
        <div className="ec-card p-4 mb-4" data-testid="og-rap-annuel"><div className="flex flex-wrap gap-2 items-end mb-2"><div className="display text-base" style={{ color: "#152238" }}>{V.rapAnnuel}</div>
          <select value={ry} onChange={(e) => setRy(e.target.value)} data-testid="og-rap-annee" className={ecInput + " md:w-32"} style={ecBorder}>{[...new Set([annee, ...donsOk.map((d) => String(d.date).slice(0, 4))])].sort().reverse().map((y) => <option key={y} value={y}>{y}</option>)}</select>
          <button onClick={() => setImprimer({ kind: "annuel", year: ry })} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="og-rap-annuel-imprimer">Imprimer</button>
          <button onClick={exporterDons} className="px-3 py-2 rounded text-sm" style={ecBtn}>Exporter (CSV)</button></div>
          <div className="text-sm mb-2">Total {ry} : <b className="tabular" data-testid="og-rap-annuel-total">{ogM(totalAn)}</b> · {donsAnnee(ry).length} reçu(s)</div>
          {dd.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucun don cette année.</div> : dd.map((x, i) => (<div key={x.k} data-testid="og-rap-donateur-ligne" className="flex flex-wrap justify-between gap-2 py-1.5 text-sm" style={{ borderTop: i > 0 ? "1px solid #F3EFE3" : "none", overflowWrap: "anywhere" }}><span>{x.nom} <span className="text-xs" style={{ color: "#8A8370" }}>· {x.n} reçu(s)</span></span><span className="tabular"><b>{ogM(x.total)}</b> {!x.k.startsWith("a:") && <button className="text-xs underline ml-2" onClick={() => setImprimer({ kind: "releve", key: x.k, year: ry })} data-testid="og-rap-releve">Relevé</button>}</span></div>))}
        </div>
        <div className="ec-card p-4 mb-4" data-testid="og-rap-cotis"><div className="display text-base mb-2" style={{ color: "#152238" }}>Cotisations {ry}</div>
          <div className="text-sm">Attendu (périodes commencées) : <b className="tabular">{ogM(attendu)}</b> · perçu : <b className="tabular" data-testid="og-rap-cotis-percu">{ogM(percu)}</b> · reste : <b className="tabular">{ogM(Math.max(0, ogR2(attendu - percu)))}</b></div>
          <div className="text-xs mt-1" style={{ color: "#8A8370" }}>La liste des membres en retard est dans l'onglet {V.membres} et dans « À faire ».</div></div>
      </div>
    );
  };

  // ───────── Statistiques ─────────
  const Stats = () => {
    const recT = ogR2(donsOk.reduce((s, d) => s + d.amount, 0)), depT = ogR2(depsOk.reduce((s, d) => s + d.amount, 0));
    const mois = statMois(6, today);
    const data = mois.map((m) => ({ mois: m.label, rec: statSomme(donsOk, "date", m.key, (x) => x.amount), dep: statSomme(depsOk, "date", m.key, (x) => x.amount) }));
    const grp = (rows, keyFn) => { const o = {}; rows.forEach((x) => { const k = keyFn(x); o[k] = ogR2((o[k] || 0) + x.amount); }); return Object.keys(o).map((k) => ({ name: k, value: o[k] })); };
    return <StatsBloc
      vide={dons.length + deps.length === 0 ? "Aucune activité pour le moment : les statistiques apparaîtront avec vos premiers dons et dépenses." : ""}
      kpis={[["Reçu (total)", ogM(recT), "og-stat-recu"], ["Dépensé (total)", ogM(depT), "og-stat-dep"], ["Solde des fonds", ogM(ogR2(recT - depT)), "og-stat-solde"], ["Membres actifs", String(membres.filter((m) => m.status !== "inactif").length), "og-stat-membres"]]}
      evolution={{ titre: "Recettes et dépenses — 6 derniers mois", data, series: [{ key: "rec", name: "Recettes", color: "#0F6B5C" }, { key: "dep", name: "Dépenses", color: "#A6432F" }] }}
      repartitions={[{ titre: "Recettes par nature", data: grp(donsOk, (x) => natureDon(x.kind)) }, { titre: "Dépenses par nature", data: grp(depsOk, (x) => natureDep(x.kind)) }, { titre: "Recettes par fonds", data: grp(donsOk, (x) => nomFonds(x.fondId)) }, { titre: "Dépenses par fonds", data: grp(depsOk, (x) => nomFonds(x.fondId)) }]}
    />;
  };

  // ───────── Documents imprimables ─────────
  const ogDevise = (n) => { const p = Math.floor(n) > 1; return ({ HTG: p ? "gourdes" : "gourde", USD: p ? "dollars" : "dollar", EUR: p ? "euros" : "euro", MXN: p ? "pesos" : "peso" })[CURRENT_CURRENCY] || ""; };
  const entete = (titre) => (
    <div style={{ textAlign: "center", marginBottom: 12 }}>
      {settings.companyLogo && <img src={settings.companyLogo} alt="" style={{ width: 60, height: 60, objectFit: "contain", margin: "0 auto 6px", display: "block" }} />}
      <div style={{ fontWeight: 700, fontSize: 20 }}>{settings.companyName || "Organisation"}</div>
      {settings.companyAddress && <div style={{ fontSize: 12 }}>{settings.companyAddress}</div>}
      {settings.companyPhone && <div style={{ fontSize: 12 }}>{settings.companyPhone}</div>}
      {settings.companyNIF && <div style={{ fontSize: 12 }}>NIF : {settings.companyNIF}</div>}
      <div style={{ fontWeight: 700, fontSize: 18, marginTop: 10 }}>{titre}</div>
    </div>
  );
  const cellule = { padding: "4px 6px", border: "1px solid #bbb", overflowWrap: "anywhere", wordBreak: "break-word" };
  const cadre = { color: "#152238", background: "#fff", fontFamily: "'Inter', sans-serif", fontSize: 12, width: "100%", maxWidth: 794, margin: "0 auto", padding: (typeof window !== "undefined" && window.innerWidth < 640) ? "16px 10px" : "32px 36px", boxSizing: "border-box" };
  const signatures = (a, b) => (<div style={{ display: "flex", justifyContent: "space-between", gap: 24, marginTop: 40 }}><div style={{ flex: 1, borderTop: "1px solid #152238", paddingTop: 4, textAlign: "center" }}>{a}</div><div style={{ flex: 1, borderTop: "1px solid #152238", paddingTop: 4, textAlign: "center" }}>{b}</div></div>);
  const RecuSheet = ({ d }) => {
    const contact = d.donorId ? contacts.find((c) => c.id === d.donorId) : null;
    const membre = d.memberId ? membres.find((m) => m.id === d.memberId) : null;
    const adr = (contact && contact.address) || (membre && membre.address) || "";
    const titre = d.kind === "cotisation" ? "REÇU DE COTISATION" : d.kind === "subvention" ? "REÇU DE SUBVENTION" : d.kind === "dime" || d.kind === "offrande" ? "REÇU — " + natureDon(d.kind).toUpperCase() : "REÇU DE DON";
    const ligne = (a, b) => <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0" }}><span>{a}</span><span style={{ textAlign: "right", fontWeight: 600 }}>{b}</span></div>;
    return (
      <div style={cadre} data-testid="og-recu-feuille">
        {entete(titre + (d.status === "annulé" ? " — ANNULÉ" : ""))}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><span>Reçu n° <b>{d.number}</b></span><span>Fait le {ecDateFr(d.date)}</span></div>
        <div style={{ marginBottom: 6 }}>Reçu de : <b>{donateur(d)}</b>{adr ? " — " + adr : ""}</div>
        <div style={{ border: "1px solid #152238", borderRadius: 4, padding: "10px 12px", margin: "10px 0" }}>
          <div style={{ fontSize: 18, fontWeight: 700 }} data-testid="og-recu-montant">{ogM(d.amount)}</div>
          <div data-testid="og-recu-lettres" style={{ marginTop: 2 }}>Arrêté la présente somme à : <i>{ogEnLettres(d.amount)} {ogDevise(d.amount)}</i></div>
        </div>
        {ligne("Nature", natureDon(d.kind))}
        {d.kind === "cotisation" ? ligne("Période", d.label.replace("Cotisation — ", "")) : null}
        {ligne("Destiné à", nomFonds(d.fondId))}
        {ligne("Reçu en", d.mode === "banque" ? "Banque (virement ou chèque)" : "Espèces (caisse)")}
        {d.label && d.kind !== "cotisation" ? ligne("Remarque", d.label) : null}
        {signatures("Le donateur (facultatif)", "Le trésorier ou le responsable (nom, date et signature)")}
        <div style={{ marginTop: 18, fontSize: 10, color: "#5B563F" }}>Ce reçu atteste de la réception de la somme indiquée. Il ne vaut reçu fiscal (déduction d'impôt) que si l'organisation y est autorisée par la DGI.</div>
      </div>
    );
  };
  const FondsSheet = ({ id, from, to }) => {
    const f = fonds.find((x) => x.id === id);
    const inP = (dt) => dt >= from && dt <= to;
    const rec = donsOk.filter((d) => (d.fondId || "") === id && inP(d.date)).sort((a, b) => (a.date > b.date ? 1 : -1));
    const dp = depsOk.filter((d) => (d.fondId || "") === id && inP(d.date)).sort((a, b) => (a.date > b.date ? 1 : -1));
    const vin = viresOk.filter((v) => (v.to || "") === id && inP(v.date)), vout = viresOk.filter((v) => (v.from || "") === id && inP(v.date));
    const totR = ogR2(rec.reduce((s, d) => s + d.amount, 0) + vin.reduce((s, v) => s + v.amount, 0)), totD = ogR2(dp.reduce((s, d) => s + d.amount, 0) + vout.reduce((s, v) => s + v.amount, 0));
    const parNat = {}; dp.forEach((d) => { parNat[natureDep(d.kind)] = ogR2((parNat[natureDep(d.kind)] || 0) + d.amount); });
    const s = sFonds(id), bud = f ? Number(f.budget) || 0 : 0;
    const th = { ...cellule, textAlign: "left", background: "#F4F1E6" };
    return (
      <div style={cadre} data-testid="og-fonds-feuille">
        {entete("RAPPORT FINANCIER — " + nomFonds(id))}
        <div style={{ marginBottom: 4 }}>Période : du <b>{ecDateFr(from)}</b> au <b>{ecDateFr(to)}</b></div>
        {f && f.bailleurId && <div style={{ marginBottom: 4 }}>{V.bailleur} : <b>{nomContact(f.bailleurId)}</b></div>}
        {bud > 0 && <div style={{ marginBottom: 4 }}>Budget du projet : <b>{ogM(bud)}</b> · dépensé depuis le début : <b>{ogM(s.dep)}</b> ({Math.round(s.dep * 100 / bud)} %)</div>}
        <div style={{ fontWeight: 700, margin: "10px 0 4px" }}>Recettes</div>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}><thead><tr><th style={th}>Date</th><th style={th}>Reçu</th><th style={th}>De la part de</th><th style={th}>Nature</th><th style={{ ...th, textAlign: "right" }}>Montant</th></tr></thead>
          <tbody>{rec.map((d) => (<tr key={d.id}><td style={cellule}>{ecDateFr(d.date)}</td><td style={cellule}>{d.number}</td><td style={cellule}>{donateur(d)}</td><td style={cellule}>{natureDon(d.kind)}</td><td style={{ ...cellule, textAlign: "right" }}>{ogM(d.amount)}</td></tr>))}
            {vin.map((v) => (<tr key={v.id}><td style={cellule}>{ecDateFr(v.date)}</td><td style={cellule}>—</td><td style={cellule}>Virement du fonds « {nomFonds(v.from)} »</td><td style={cellule}>{v.motif}</td><td style={{ ...cellule, textAlign: "right" }}>{ogM(v.amount)}</td></tr>))}
            {rec.length + vin.length === 0 && <tr><td style={cellule} colSpan={5}>Aucune recette sur la période.</td></tr>}
            <tr style={{ fontWeight: 700 }}><td style={cellule} colSpan={4}>Total des recettes</td><td style={{ ...cellule, textAlign: "right" }}>{ogM(totR)}</td></tr></tbody></table>
        <div style={{ fontWeight: 700, margin: "12px 0 4px" }}>Dépenses par nature</div>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}><tbody>{Object.keys(parNat).map((k) => (<tr key={k}><td style={cellule}>{k}</td><td style={{ ...cellule, textAlign: "right" }}>{ogM(parNat[k])}</td></tr>))}
          {vout.map((v) => (<tr key={v.id}><td style={cellule}>Virement vers « {nomFonds(v.to)} » : {v.motif}</td><td style={{ ...cellule, textAlign: "right" }}>{ogM(v.amount)}</td></tr>))}
          {dp.length + vout.length === 0 && <tr><td style={cellule}>Aucune dépense sur la période.</td><td style={cellule}></td></tr>}
          <tr style={{ fontWeight: 700 }}><td style={cellule}>Total des dépenses</td><td style={{ ...cellule, textAlign: "right" }}>{ogM(totD)}</td></tr></tbody></table>
        <div style={{ fontWeight: 700, margin: "12px 0 4px" }}>Détail des dépenses</div>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}><thead><tr><th style={th}>Date</th><th style={th}>Détail</th><th style={th}>Fournisseur</th><th style={{ ...th, textAlign: "right" }}>Montant</th></tr></thead>
          <tbody>{dp.map((d) => (<tr key={d.id}><td style={cellule}>{ecDateFr(d.date)}</td><td style={cellule}>{natureDep(d.kind)}{d.label && d.label !== natureDep(d.kind) ? " — " + d.label : ""}{d.depassement ? " (dépassement justifié : " + ((OG_MOTIFS.find((m) => m[0] === d.depassement.motif) || [0, ""])[1]) + (d.depassement.txt ? " — " + d.depassement.txt : "") + ")" : ""}</td><td style={cellule}>{d.supplier || "—"}</td><td style={{ ...cellule, textAlign: "right" }}>{ogM(d.amount)}</td></tr>))}</tbody></table>
        <div style={{ maxWidth: 360, marginLeft: "auto", marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Recettes de la période</span><span>{ogM(totR)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Dépenses de la période</span><span>{ogM(totD)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 15, borderTop: "1px solid #152238", marginTop: 4, paddingTop: 4 }}><span>Solde du fonds à ce jour</span><span data-testid="og-fonds-feuille-solde">{ogM(s.solde)}</span></div>
        </div>
        {signatures("Établi par (nom, date et signature)", "Approuvé par (nom, date et signature)")}
      </div>
    );
  };
  const AnnuelSheet = ({ year }) => {
    const dd = parDonateur(year), tot = ogR2(dd.reduce((s, x) => s + x.total, 0));
    const th = { ...cellule, textAlign: "left", background: "#F4F1E6" };
    return (
      <div style={cadre} data-testid="og-annuel-feuille">
        {entete(V.rapAnnuel.toUpperCase() + " " + year)}
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}><thead><tr><th style={th}>Donateur</th><th style={{ ...th, textAlign: "right" }}>Reçus</th><th style={{ ...th, textAlign: "right" }}>Total</th></tr></thead>
          <tbody>{dd.map((x) => (<tr key={x.k}><td style={cellule}>{x.nom}</td><td style={{ ...cellule, textAlign: "right" }}>{x.n}</td><td style={{ ...cellule, textAlign: "right" }}>{ogM(x.total)}</td></tr>))}
            <tr style={{ fontWeight: 700 }}><td style={cellule}>Total {year}</td><td style={{ ...cellule, textAlign: "right" }}>{dd.reduce((s, x) => s + x.n, 0)}</td><td style={{ ...cellule, textAlign: "right" }}>{ogM(tot)}</td></tr></tbody></table>
        <div style={{ fontWeight: 700, margin: "12px 0 4px" }}>Par nature</div>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}><tbody>{OG_RECETTES.map((r) => { const t = ogR2(dd.reduce((s, x) => s + (x.kinds[r[0]] || 0), 0)); return t > 0 ? (<tr key={r[0]}><td style={cellule}>{natureDon(r[0])}</td><td style={{ ...cellule, textAlign: "right" }}>{ogM(t)}</td></tr>) : null; })}</tbody></table>
        {signatures("Le trésorier", "Le président ou le responsable")}
      </div>
    );
  };
  const ReleveSheet = ({ k, year }) => {
    const [t, id] = k.split(":");
    const mine = donsAnnee(year).filter((d) => (t === "m" ? d.memberId === id : d.donorId === id)).sort((a, b) => (a.date > b.date ? 1 : -1));
    const nom = t === "m" ? nomMembre(id) : nomContact(id), tot = ogR2(mine.reduce((s, d) => s + d.amount, 0));
    const th = { ...cellule, textAlign: "left", background: "#F4F1E6" };
    return (
      <div style={cadre} data-testid="og-releve-feuille">
        {entete("RELEVÉ DES DONS " + year)}
        <div style={{ marginBottom: 8 }}>Donateur : <b>{nom}</b></div>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}><thead><tr><th style={th}>Date</th><th style={th}>Reçu</th><th style={th}>Nature</th><th style={{ ...th, textAlign: "right" }}>Montant</th></tr></thead>
          <tbody>{mine.map((d) => (<tr key={d.id}><td style={cellule}>{ecDateFr(d.date)}</td><td style={cellule}>{d.number}</td><td style={cellule}>{natureDon(d.kind)}</td><td style={{ ...cellule, textAlign: "right" }}>{ogM(d.amount)}</td></tr>))}
            <tr style={{ fontWeight: 700 }}><td style={cellule} colSpan={3}>Total {year}</td><td style={{ ...cellule, textAlign: "right" }} data-testid="og-releve-total">{ogM(tot)}</td></tr></tbody></table>
        <div style={{ marginTop: 10 }}>Soit : <i>{ogEnLettres(tot)} {ogDevise(tot)}</i>.</div>
        {signatures("", "Le trésorier ou le responsable (nom, date et signature)")}
        <div style={{ marginTop: 18, fontSize: 10, color: "#5B563F" }}>Ce relevé récapitule les reçus délivrés. Il ne vaut reçu fiscal que si l'organisation y est autorisée par la DGI.</div>
      </div>
    );
  };

  const tabs = isVendeur
    ? [["apercu", "Tableau de bord"], ["dons", V.recettes], ["contacts", V.contacts], ["membres", V.membres]]
    : [["apercu", "Tableau de bord"], ["fonds", "Fonds et projets"], ["dons", V.recettes], ["contacts", V.contacts], ["membres", V.membres], ["depenses", "Dépenses"], ["rapports", "Rapports"], ["stats", "Statistiques"]];
  const imprDoc = (() => {
    if (!imprimer) return null;
    if (imprimer.kind === "recu") { const d = dons.find((x) => x.id === imprimer.id); return d ? { titre: "Reçu " + d.number, node: <RecuSheet d={d} />, ticket: true } : null; }
    if (imprimer.kind === "fonds") { const f = fonds.find((x) => x.id === imprimer.id); return { titre: "Rapport financier", node: <FondsSheet id={imprimer.id || ""} from={imprimer.from || (f && f.start) || "2000-01-01"} to={imprimer.to || today} /> }; }
    if (imprimer.kind === "annuel") return { titre: V.rapAnnuel + " " + imprimer.year, node: <AnnuelSheet year={imprimer.year} /> };
    if (imprimer.kind === "releve") return { titre: "Relevé des dons", node: <ReleveSheet k={imprimer.key} year={imprimer.year} /> };
    return null;
  })();
  return (
    <>
      {listes}
      <div className={"p-4 md:p-8 max-w-6xl" + (imprDoc ? " no-print" : "")} data-testid="ong-module">
        <style>{EC_CSS + '[data-testid="ong-module"] .display.text-base{border-left:3px solid #C9A24B;padding-left:10px;margin-bottom:12px}[data-testid="ong-module"] input,[data-testid="ong-module"] select{background:#fff;max-width:100%;min-width:0}[data-testid="ong-module"] .grid>*{min-width:0}'}</style>
        <div className="mb-4"><div className="display text-2xl" style={{ color: "#152238" }}>{orgType === "eglise" ? "Église et communauté" : orgType === "association" ? "Association" : orgType === "fondation" ? "Fondation" : "ONG, associations, églises"}</div><div className="text-xs" style={{ color: "#8A8370" }}>Fonds et projets, dons et reçus, donateurs, membres et cotisations, dépenses, rapports pour les bailleurs</div></div>
        {!canFront && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }}>Consultation seule : votre rôle ne permet pas de modifier les données.</div>}
        {isVendeur && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }} data-testid="og-accueil-note">Accueil : vous pouvez enregistrer les donateurs, les membres, les dons et cotisations et imprimer les reçus. Fonds, dépenses, annulations et rapports sont réservés aux gestionnaires.</div>}
        <div className="ec-tabs">
          {tabs.map(([id, l]) => (<button key={id} onClick={() => setTab(id)} data-testid={"og-tab-" + id} className="px-3 py-2 text-sm rounded-lg transition-colors" style={{ background: tab === id ? "#152238" : "transparent", color: tab === id ? "#EFE9DD" : "#6B6552", fontWeight: tab === id ? 600 : 400 }}>{l}</button>))}
        </div>
        {tab === "apercu" && Apercu()}
        {tab === "fonds" && !isVendeur && Fonds()}
        {tab === "dons" && Dons()}
        {tab === "contacts" && Contacts()}
        {tab === "membres" && Membres()}
        {tab === "depenses" && !isVendeur && Depenses()}
        {tab === "rapports" && !isVendeur && Rapports()}
        {tab === "stats" && !isVendeur && Stats()}
      </div>
      {imprDoc && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto p-3 md:p-8 no-print" style={{ background: "rgba(21,34,56,0.55)" }} onClick={() => setImprimer(null)} data-testid="og-apercu-impression">
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: tk && imprDoc.ticket ? 340 : 820 }}>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap"><div className="text-sm" style={{ color: "#EFE9DD" }}>{imprDoc.titre}</div>
              <div className="flex gap-2 flex-wrap">
                {imprDoc.ticket && <button onClick={() => setTk(!tk)} className="px-3 py-1.5 rounded text-sm" style={ecBtn} data-testid="og-format">{tk ? "Passer en A4" : "Passer en ticket"}</button>}
                <button onClick={() => { try { window.print(); } catch (e) {} }} className="px-3 py-1.5 rounded text-sm" style={ecBtnGold} data-testid="og-imprimer-ok">Imprimer / enregistrer en PDF</button>
                <button onClick={() => setImprimer(null)} className="px-3 py-1.5 rounded text-sm" style={ecBtn} data-testid="og-apercu-fermer">Fermer</button></div></div>
            <div className="rounded shadow-lg overflow-hidden" style={{ background: "#fff" }}>{imprDoc.node}</div>
          </div>
        </div>
      )}
      {imprDoc && <div className={"print-only" + (tk && imprDoc.ticket ? " ticket-print-80" : "")}>{imprDoc.node}</div>}
    </>
  );
}

// ═══ MODULE ═══
// @module Ecoles
// @depends EC_CSS, EC_TRANCHES, EcolesRapports, EcolesRelances, EcolesRemises, StatsBloc, _membership
//   ecAppliquerRemisesAuxNouvelles, ecBorder, ecBtn, ecBtnGold, ecDateFr, ecInput, ecJoursEntre
//   ecPastille, fmt, isFutureDate, isLocked, roleLabel, statMois, statSomme, supabase, todayStr
//   uid, useBrouillon, useEffect, useState
// @exports EC_VOCAB, EcolesModule, ecId, ecR2, ecReste, ecRows
// ═══ FIN DE L'EN-TÊTE ═══
// Bloc Écoles, première version : années scolaires, classes, familles et élèves, grille de frais, échéancier,
// encaissements avec reçus numérotés, écritures comptables.
//
// Principe comptable (voir le document « Blocs par secteur ») :
//  • Les frais sont constatés à l'ÉCHÉANCE : Débit 4111 (familles) / Crédit 706x (produit), et 445 si le frais est soumis à la TCA.
//  • Un paiement reçu AVANT l'échéance est une avance : Débit caisse ou banque / Crédit 487 (produits constatés d'avance) ;
//    à l'échéance, l'avance est transformée en produit : Débit 487 / Crédit 706x.
//  • Un paiement reçu APRÈS la constatation solde la créance : Débit caisse ou banque / Crédit 4111.
//  • Frais scolaires : exonérés de TCA par défaut (art. 181 du Code fiscal, à confirmer pour cantine, transport, uniformes).
// Toutes les données sont dans une seule catégorie « ecole » (liste d'enregistrements distingués par leur type : year, class,
// family, student, fee, charge, receipt), enregistrée comme les autres catégories de l'application.

const EC_COMPTES = {
  "4111": { name: "Clients — Familles et élèves (scolarité)", type: "Actif" },
  "7061": { name: "Frais de scolarité (écolage)", type: "Produit" },
  "7062": { name: "Frais d'inscription et de réinscription", type: "Produit" },
  "7068": { name: "Autres frais scolaires (cantine, transport, uniformes, livres)", type: "Produit" },
  "709": { name: "Rabais, remises et bourses accordés (scolarité)", type: "Produit" },
};
const EC_PRODUITS = [["7061", "Scolarité (écolage)"], ["7062", "Inscription / réinscription"], ["7068", "Autres frais scolaires"]];
// Identifiants en texte : les listes déroulantes renvoient du texte, la comparaison doit donc être faite sur du texte.
const ecId = () => String(uid());
const ecR2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const ecRows = (ecole, type) => (ecole || []).filter((r) => r && r.type === type);
const ecAddMonths = (iso, n) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return iso;
  const y = Number(m[1]), mo = Number(m[2]) - 1 + n, d = Number(m[3]);
  const last = new Date(y, mo + 1, 0).getDate();
  const dt = new Date(y, mo, Math.min(d, last));
  return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
};
const ecReste = (c) => ecR2((Number(c.amount) || 0) - (Number(c.paid) || 0));

// Vocabulaire selon le type d'établissement (le bloc s'appelle « Éducation » : école, formation professionnelle, université)
const EC_TYPES_ETAB = [["ecole", "École (primaire, secondaire)"], ["pro", "Centre de formation professionnelle"], ["univ", "Université ou institut supérieur"]];
const EC_VOCAB = {
  ecole: { Annee: "Année scolaire", annee: "année scolaire", Annees: "Années scolaires", Classe: "Classe", Classes: "Classes", classe: "classe", Eleve: "Élève", Eleves: "Élèves", eleve: "élève", Famille: "Famille", Familles: "Familles", famille: "famille", FamilleResp: "Famille ou responsable", eleveDet: "l'élève", classeDet: "la classe", famDet: "la famille", etabDet: "l'école", etabTitre: "École", slug: "ecole" },
  pro: { Annee: "Année de formation", annee: "année de formation", Annees: "Années de formation", Classe: "Filière", Classes: "Filières", classe: "filière", Eleve: "Apprenant", Eleves: "Apprenants", eleve: "apprenant", Famille: "Payeur", Familles: "Payeurs", famille: "payeur", FamilleResp: "Payeur (apprenant, famille ou entreprise)", eleveDet: "l'apprenant", classeDet: "la filière", famDet: "le payeur", etabDet: "le centre de formation", etabTitre: "Centre de formation", slug: "pro" },
  univ: { Annee: "Année académique", annee: "année académique", Annees: "Années académiques", Classe: "Filière", Classes: "Filières", classe: "filière", Eleve: "Étudiant", Eleves: "Étudiants", eleve: "étudiant", Famille: "Payeur", Familles: "Payeurs", famille: "payeur", FamilleResp: "Payeur (étudiant, famille ou employeur)", eleveDet: "l'étudiant", classeDet: "la filière", famDet: "le payeur", etabDet: "l'université", etabTitre: "Université", slug: "univ" },
};

// Échéances d'un frais pour un élève (identifiants stables : le même frais n'est jamais appliqué deux fois au même élève).
function ecChargesPourEleve(fee, student, opts) {
  const o = opts || {};
  const n = Math.max(1, Math.round(Number(fee.nb) || 1));
  const total = fee.perCredit ? ecR2((Number(fee.amount) || 0) * (Number(o.credits != null ? o.credits : student.credits) || 0)) : ecR2(fee.amount); // frais « par crédit » : montant × crédits de l'étudiant
  if (!(total > 0)) return [];
  const part = ecR2(Math.floor((total / n) * 100) / 100);
  const out = [];
  for (let i = 0; i < n; i++) {
    const amount = i === n - 1 ? ecR2(total - part * (n - 1)) : part;
    out.push({
      type: "charge", id: student.id + ":" + fee.id + (o.idTag ? ":" + o.idTag : "") + ":" + (i + 1), studentId: student.id, familyId: student.familyId, yearId: fee.yearId, feeId: fee.id,
      label: (n > 1 ? fee.label + " " + (i + 1) + "/" + n : fee.label) + (o.labelExtra ? " — " + o.labelExtra : "") + (fee.semesterLabel ? " — " + fee.semesterLabel : ""), amount, dueDate: n > 1 ? ecAddMonths(fee.firstDue, i) : fee.firstDue,
      account: fee.account || "7061", tcaRate: Number(fee.tcaRate) || 0, recognized: false, advance: 0, paid: 0, status: "ok",
    });
  }
  return out;
}

// Constate les échéances échues (jusqu'à la date donnée). Renvoie l'écriture à passer et les échéances mises à jour.
function ecReconnaitre(charges, upTo) {
  const due = charges.filter((c) => c.status !== "annulée" && !c.recognized && c.dueDate && c.dueDate <= upTo);
  if (!due.length) return null;
  const prod = {}; let tva = 0, creance = 0, avance = 0;
  due.forEach((c) => {
    const a = ecR2(c.amount), adv = ecR2(Math.min(c.advance || 0, a));
    const rate = Number(c.tcaRate) || 0;
    const ht = rate > 0 ? ecR2(a / (1 + rate / 100)) : a;
    prod[c.account] = ecR2((prod[c.account] || 0) + ht);
    tva = ecR2(tva + (a - ht));
    avance = ecR2(avance + adv); creance = ecR2(creance + (a - adv));
  });
  const lines = [];
  if (creance > 0) lines.push({ account: "4111", debit: creance, credit: 0 });
  if (avance > 0) lines.push({ account: "487", debit: avance, credit: 0 });
  Object.keys(prod).sort().forEach((k) => { if (prod[k] > 0) lines.push({ account: k, debit: 0, credit: prod[k] }); });
  if (tva > 0) lines.push({ account: "445", debit: 0, credit: tva });
  const ids = new Set(due.map((c) => c.id));
  return { lines, ids, count: due.length, total: ecR2(creance + avance) };
}

// Répartit un paiement sur les échéances d'une famille, de la plus ancienne à la plus récente (élève précisé en premier si choisi).
function ecRepartir(charges, familyId, studentId, amount, date) {
  let left = ecR2(amount);
  const list = charges.filter((c) => c.familyId === familyId && c.status !== "annulée" && ecReste(c) > 0)
    .sort((a, b) => ((studentId && a.studentId === studentId ? 0 : 1) - (studentId && b.studentId === studentId ? 0 : 1)) || String(a.dueDate).localeCompare(String(b.dueDate)) || String(a.id).localeCompare(String(b.id)));
  const alloc = [];
  for (const c of list) {
    if (left <= 0) break;
    const part = ecR2(Math.min(left, ecReste(c)));
    alloc.push({ chargeId: c.id, amount: part, toAdvance: !c.recognized && !(c.dueDate && c.dueDate <= date) });
    left = ecR2(left - part);
  }
  return { alloc, left };
}

function ecAjouterComptes(accounts, setAccounts, codes, role) {
  if (role === "Vendeur") return; // pas le droit d'écrire le plan comptable
  const missing = codes.filter((k) => EC_COMPTES[k] && !accounts.some((a) => a.code === k)).map((k) => ({ code: k, name: EC_COMPTES[k].name, type: EC_COMPTES[k].type }));
  if (missing.length) setAccounts((prev) => [...prev, ...missing.filter((m) => !prev.some((a) => a.code === m.code))]);
}

// Un frais s'applique-t-il à cet élève ? (classes visées ; les frais facultatifs — cantine, transport — seulement si l'élève y est abonné)
const ecEligible = (f, s) => (!f.classIds || f.classIds.length === 0 || f.classIds.includes(s.classId)) && (!f.optional || (s.options || []).includes(f.id));

function EcolesModule({ ecole: ecoleTout, setEcole: setEcoleBrut, entries, setEntries, accounts, setAccounts, settings, role, showToast, logAudit, currentUserEmail }) {
  const canEdit = role === "Administrateur" || role === "Éditeur";
  // Chaque type d'établissement (école, formation professionnelle, université) a ses propres données : années, classes ou filières,
  // inscrits, frais, reçus. Les enregistrements sans marque « etab » (anciens) appartiennent à l'école.
  const etabRec = ecoleTout.find((r) => r && r.type === "etab");
  const kind = etabRec && EC_VOCAB[etabRec.kind] ? etabRec.kind : "ecole";
  const V = EC_VOCAB[kind];
  const sup = kind !== "ecole"; // formation professionnelle ou université : semestres et crédits
  const ecole = ecoleTout.filter((r) => r && (r.type === "etab" || (r.etab || "ecole") === kind));
  const setEcole = (fn) => setEcoleBrut((prev) => {
    const base = prev || [];
    const next = typeof fn === "function" ? fn(base) : fn;
    const ids = new Set(base.map((r) => r && r.id));
    return next.map((r) => (r && r.type !== "etab" && !r.etab && !ids.has(r.id) ? { ...r, etab: kind } : r));
  });
  // Secrétaire-caissier(ère) = rôle Vendeur : encaisse, consulte les élèves et relance les impayés ; ne modifie ni la grille, ni les années, ni les classes, et n'annule rien.
  const secretaire = role === "Vendeur";
  // Modifier ou activer une année : réservé à l'administrateur principal de l'entreprise
  const [principal, setPrincipal] = useState(false);
  useEffect(() => {
    let vivant = true;
    (async () => {
      try {
        const cid = _membership && _membership.companyId;
        if (!cid || !currentUserEmail || role !== "Administrateur") { if (vivant) setPrincipal(false); return; }
        const { data } = await supabase.from("company_members").select("email, is_primary_admin").eq("company_id", cid);
        const moi = (data || []).find((m) => String(m.email || "").toLowerCase() === String(currentUserEmail).toLowerCase());
        if (vivant) setPrincipal(!!(moi && moi.is_primary_admin));
      } catch (e) { if (vivant) setPrincipal(false); }
    })();
    return () => { vivant = false; };
  }, [currentUserEmail, role]);
  const canCash = canEdit || secretaire;
  const [tab, setTab] = useState(role === "Vendeur" ? "recus" : "apercu");
  // Les comptes de l'école sont créés par un administrateur ou un gestionnaire (le rôle Vendeur n'a pas le droit d'écrire le plan comptable)
  useEffect(() => {
    if (canEdit && typeof setAccounts === "function" && Array.isArray(accounts) && accounts.length > 0) ecAjouterComptes(accounts, setAccounts, ["4111", "7061", "7062", "7068", "709"]);
  }, [canEdit, accounts.length]);
  const years = ecRows(ecole, "year");
  const classes = ecRows(ecole, "class");
  const families = ecRows(ecole, "family");
  const students = ecRows(ecole, "student");
  const fees = ecRows(ecole, "fee");
  const semesters = ecRows(ecole, "semester");
  const courses = ecRows(ecole, "course");
  const enrolls = ecRows(ecole, "enroll");
  // un étudiant inscrit à des cours est facturé par cours (crédits du cours) ; sinon, au nombre de crédits saisi sur sa fiche
  const enrolled = new Set(enrolls.filter((x) => x.status !== "annulé").map((x) => x.studentId));
  const cpe = (f, s) => ecChargesPourEleve(f, s, enrolled.has(s.id) ? { credits: 0 } : undefined);
  const charges = ecRows(ecole, "charge");
  const receipts = ecRows(ecole, "receipt");
  const [yearId, setYearId] = useState(() => (years.find((y) => y.active) || years[years.length - 1] || {}).id || "");
  const year = years.find((y) => y.id === yearId) || years.find((y) => y.active) || years[years.length - 1] || null;
  const today = todayStr();
  const famName = (id) => (families.find((f) => f.id === id) || {}).name || "—";
  const stuName = (id) => { const s = students.find((x) => x.id === id); return s ? (s.firstName + " " + s.lastName).trim() : "—"; };
  const className = (id) => (classes.find((c) => c.id === id) || {}).name || "—";
  const yCharges = year ? charges.filter((c) => c.yearId === year.id && c.status !== "annulée") : [];
  const [printRec, setPrintRec] = useState(null);
  const [fmtOvr, setFmtOvr] = useState(null); // null = format choisi dans les réglages ; true = ticket ; false = A4
  const fmtRecu = fmtOvr == null ? (settings.receiptFormat || "a4") : (fmtOvr ? (settings.receiptFormat === "ticket58" ? "ticket58" : "ticket80") : "a4");
  const [printRel, setPrintRel] = useState(null); // relevé de compte d'une famille : { familyId }
  const [fq, setFq] = useState("");
  const [fcl, setFcl] = useState("");
  const [edFam, setEdFam] = useState(null);
  const [fEch, setFEch] = useState({ etat: "", classId: "", q: "", du: "", au: "" });
  const [fRec, setFRec] = useState({ du: "", au: "", familyId: "", mode: "", etat: "" });
  const joursPlus = (iso, n) => { const d = new Date(String(iso).slice(0, 10) + "T12:00:00"); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const nomMode = (m) => (m === "banque" ? "Banque" : m === "moncash" ? "MonCash" : m === "cheque" ? "Chèque" : "Espèces");
  const totalRow = (cells, testid) => <tr className="font-semibold" style={{ borderTop: "2px solid #152238", background: "#F4F1E6" }} data-testid={testid}>{cells}</tr>;

  const tabsTous = [["apercu", "Tableau de bord"], ["annees", "Années et " + V.Classes.toLowerCase()], ["eleves", V.Familles + " et " + V.Eleves.toLowerCase()], ["frais", "Frais"], ...(sup ? [["cours", "Cours et crédits"]] : []), ["echeances", "Échéances"], ["recus", "Encaissements"], ["relances", "Impayés et relances"], ["remises", "Bourses et rabais"], ["rapports", "Rapports"], ["stats", "Statistiques"]];
  const tabs = secretaire ? tabsTous.filter(([id]) => ["eleves", "recus", "relances"].includes(id)) : tabsTous;

  // ───────── Statistiques ─────────
  const Stats = () => {
    const actifs = students.filter((s) => s.status !== "sorti" && (!year || s.yearId === year.id)).length;
    const attenduS = ecR2(yCharges.reduce((s, c) => s + c.amount, 0));
    const paye = ecR2(yCharges.reduce((s, c) => s + (c.paid || 0), 0));
    const impayeS = ecR2(yCharges.filter((c) => c.dueDate <= today && ecReste(c) > 0).reduce((s, c) => s + ecReste(c), 0));
    const recOk = receipts.filter((r) => r.status !== "annulé");
    const mois = statMois(6, today);
    const data = mois.map((m) => ({ mois: m.label, facture: statSomme(yCharges, "dueDate", m.key, (c) => c.amount), encaisse: statSomme(recOk, "date", m.key, (r) => r.amount) }));
    const parClasse = (year ? classes.filter((c) => c.yearId === year.id) : []).map((c) => { const ids = new Set(students.filter((s) => s.classId === c.id).map((s) => s.id)); return { name: c.name, value: ecR2(yCharges.filter((x) => ids.has(x.studentId)).reduce((s, x) => s + x.amount, 0)) }; });
    const effClasse = (year ? classes.filter((c) => c.yearId === year.id) : []).map((c) => ({ name: c.name, value: students.filter((x) => x.classId === c.id && x.status !== "sorti").length }));
    const anciennete = EC_TRANCHES.map(([lib, a1, b1]) => ({ name: lib, value: ecR2(yCharges.filter((c) => c.dueDate <= today && ecReste(c) > 0 && ecJoursEntre(c.dueDate, today) >= a1 && ecJoursEntre(c.dueDate, today) <= b1).reduce((t, c) => t + ecReste(c), 0)) }));
    const modes = {}; recOk.forEach((r) => { const k = r.mode === "banque" ? "Banque" : r.mode === "moncash" ? "MonCash" : r.mode === "cheque" ? "Chèque" : "Espèces"; modes[k] = ecR2((modes[k] || 0) + r.amount); });
    return <StatsBloc
      vide={!year ? "Créez d'abord une année pour voir les statistiques." : ""}
      kpis={[[V.Eleves + " inscrit(e)s", String(actifs), "ecole-stat-inscrits"], ["Attendu sur l'année", fmt(attenduS), "ecole-stat-attendu"], ["Encaissé", fmt(paye), "ecole-stat-encaisse"], ["Taux d'encaissement", (attenduS > 0 ? Math.round(paye / attenduS * 100) : 0) + " %", "ecole-stat-taux"], ["Impayés échus", fmt(impayeS), "ecole-stat-impayes"]]}
      evolution={{ titre: "Échéances et encaissements — 6 derniers mois", data, series: [{ key: "facture", name: "Échéances", color: "#9A7B1E" }, { key: "encaisse", name: "Encaissé", color: "#0F6B5C" }] }}
      repartitions={[{ titre: "Montants attendus par " + V.classe.toLowerCase(), data: parClasse }, { titre: V.Eleves + " par " + V.classe.toLowerCase(), data: effClasse, unite: "nombre" }, { titre: "Impayés échus selon l'ancienneté", data: anciennete }, { titre: "Encaissements par mode de paiement", data: Object.keys(modes).map((k) => ({ name: k, value: modes[k] })) }]} />;
  };

  // ───────── Vue d'ensemble ─────────
  const attendu = ecR2(yCharges.reduce((s, c) => s + c.amount, 0));
  const encaisse = ecR2(yCharges.reduce((s, c) => s + (c.paid || 0), 0));
  const echuNonPaye = yCharges.filter((c) => c.dueDate <= today && ecReste(c) > 0);
  const impayes = ecR2(echuNonPaye.reduce((s, c) => s + ecReste(c), 0));
  const avances = ecR2(yCharges.filter((c) => !c.recognized).reduce((s, c) => s + (c.advance || 0), 0));
  const aConstater = yCharges.filter((c) => !c.recognized && c.dueDate <= today);

  const Apercu = () => {
    const parFamille = {};
    echuNonPaye.forEach((c) => { const f = parFamille[c.familyId] || (parFamille[c.familyId] = { total: 0, plusAncien: c.dueDate }); f.total = ecR2(f.total + ecReste(c)); if (c.dueDate < f.plusAncien) f.plusAncien = c.dueDate; });
    const lignes = Object.keys(parFamille).map((id) => ({ id, ...parFamille[id] })).sort((a, b) => b.total - a.total);
    const recOk = receipts.filter((r) => r.status !== "annulé");
    const duJour = ecR2(recOk.filter((r) => r.date === today).reduce((t, r) => t + r.amount, 0));
    const duMois = ecR2(recOk.filter((r) => String(r.date).startsWith(today.slice(0, 7))).reduce((t, r) => t + r.amount, 0));
    const taux = attendu > 0 ? Math.round(encaisse / attendu * 100) : 0;
    const inscrits = students.filter((s) => year && s.yearId === year.id && s.status !== "sorti");
    const etapes = [
      ["Créer l'" + V.annee, !!year, "annees", "Années et " + V.Classes.toLowerCase()],
      ["Créer les " + V.Classes.toLowerCase(), !!year && classes.some((c) => c.yearId === year.id), "annees", "Années et " + V.Classes.toLowerCase()],
      ["Enregistrer les " + V.Familles.toLowerCase(), families.length > 0, "eleves", V.Familles + " et " + V.Eleves.toLowerCase()],
      ["Inscrire les " + V.Eleves.toLowerCase(), inscrits.length > 0, "eleves", V.Familles + " et " + V.Eleves.toLowerCase()],
      ["Créer la grille de frais", !!year && fees.some((f) => f.yearId === year.id), "frais", "Frais"],
      ["Appliquer les frais (créer les échéances)", yCharges.length > 0, "frais", "Frais"],
      ["Faire le premier encaissement", recOk.length > 0, "recus", "Encaissements"],
    ];
    const fini = etapes.every((e) => e[1]);
    const limite = joursPlus(today, 30);
    const aVenir = yCharges.filter((c) => c.dueDate > today && c.dueDate <= limite && ecReste(c) > 0).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    const effectifs = (year ? classes.filter((c) => c.yearId === year.id) : []).map((c) => { const ids = students.filter((s) => s.classId === c.id && s.status !== "sorti"); const set = new Set(ids.map((s) => s.id)); return { id: c.id, nom: c.name, n: ids.length, attendu: ecR2(yCharges.filter((x) => set.has(x.studentId)).reduce((t, x) => t + x.amount, 0)), reste: ecR2(yCharges.filter((x) => set.has(x.studentId)).reduce((t, x) => t + ecReste(x), 0)) }; });
    const recents = recOk.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 5);
    return (
      <div>
        {!fini && (<div className="p-4 rounded text-sm mb-5" style={{ background: "#FFF6E0", color: "#152238" }} data-testid="ecole-vide">
          <div className="font-semibold mb-2">Pour démarrer, dans cet ordre (chaque étape cochée est faite) :</div>
          {etapes.map(([l, fait, onglet, nomOnglet], i) => (<div key={i} className="flex flex-wrap items-center gap-2 py-0.5" data-testid="ecole-etape"><span style={{ width: 20, color: fait ? "#0F6B5C" : "#8A8370", fontWeight: 700 }}>{fait ? "✓" : "○"}</span><span style={{ textDecoration: fait ? "line-through" : "none", opacity: fait ? 0.6 : 1 }}>{i + 1}. {l}</span>{!fait && <button onClick={() => setTab(onglet)} className="text-xs underline" data-testid="ecole-etape-ouvrir">Ouvrir « {nomOnglet} »</button>}</div>))}
        </div>)}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          {[[V.Eleves + " inscrits", String(inscrits.length), "ecole-kpi-eleves"], ["Frais attendus", fmt(attendu), "ecole-kpi-attendu"], ["Encaissé", fmt(encaisse), "ecole-kpi-encaisse"], ["Impayés échus", fmt(impayes), "ecole-kpi-impayes"], ["Encaissé aujourd'hui", fmt(duJour), "ecole-kpi-jour"], ["Encaissé ce mois", fmt(duMois), "ecole-kpi-mois"], ["Taux d'encaissement", taux + " %", "ecole-kpi-taux"], [V.Familles + " avec impayés", String(lignes.length), "ecole-kpi-nbimpayes"]].map(([l, v, t]) => (
            <div key={t} className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>{l}</div><div className="display text-lg tabular" data-testid={t} style={{ color: "#152238" }}>{v}</div></div>
          ))}
        </div>
        <div className="text-xs mb-5" style={{ color: "#7A7460" }}>Avances reçues sur des échéances à venir (compte 487) : <span className="tabular" data-testid="ecole-kpi-avances">{fmt(avances)}</span> · Échéances échues à constater en comptabilité : <span data-testid="ecole-kpi-aconstater">{aConstater.length}</span></div>
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div><div className="display text-base mb-2" style={{ color: "#152238" }}>Échéances des 30 prochains jours</div>
            {aVenir.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucune échéance à venir dans les 30 jours.</div> : (
              <div className="ec-wrap"><table className="ec-table" style={{ minWidth: 420 }}><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>{V.Eleve}</th><th>Frais</th><th className="text-right">Reste</th></tr></thead>
                <tbody>{aVenir.slice(0, 8).map((c) => (<tr key={c.id} data-testid="ecole-avenir-ligne"><td className="py-1.5">{ecDateFr(c.dueDate)}</td><td>{stuName(c.studentId)}</td><td>{c.label}</td><td className="text-right tabular">{fmt(ecReste(c))}</td></tr>))}
                  {totalRow([<td key="a" className="py-1.5" colSpan={3}>Total ({aVenir.length} échéance(s)){aVenir.length > 8 ? " — 8 premières affichées" : ""}</td>, <td key="b" className="text-right tabular" data-testid="ecole-avenir-total-montant">{fmt(ecR2(aVenir.reduce((t, c) => t + ecReste(c), 0)))}</td>], "ecole-avenir-total")}</tbody></table></div>)}</div>
          <div><div className="display text-base mb-2" style={{ color: "#152238" }}>Effectifs par {V.classe}</div>
            {effectifs.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucune {V.classe} pour cette {V.annee}.</div> : (
              <div className="ec-wrap"><table className="ec-table" style={{ minWidth: 420 }}><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">{V.Classe}</th><th className="text-right">{V.Eleves}</th><th className="text-right">Attendu</th><th className="text-right">Reste à payer</th></tr></thead>
                <tbody>{effectifs.map((c) => (<tr key={c.id} data-testid="ecole-effectif-ligne"><td className="py-1.5">{c.nom}</td><td className="text-right tabular">{c.n}</td><td className="text-right tabular">{fmt(c.attendu)}</td><td className="text-right tabular">{fmt(c.reste)}</td></tr>))}
                  {totalRow([<td key="a" className="py-1.5">Total</td>, <td key="b" className="text-right tabular" data-testid="ecole-effectif-total">{effectifs.reduce((t, c) => t + c.n, 0)}</td>, <td key="c" className="text-right tabular">{fmt(ecR2(effectifs.reduce((t, c) => t + c.attendu, 0)))}</td>, <td key="d" className="text-right tabular">{fmt(ecR2(effectifs.reduce((t, c) => t + c.reste, 0)))}</td>], "ecole-effectif-total-ligne")}</tbody></table></div>)}</div>
        </div>
        <div className="display text-base mb-2" style={{ color: "#152238" }}>{V.Familles} avec impayés</div>
        {lignes.length === 0 ? <div className="text-sm mb-4" style={{ color: "#8A8370" }}>Aucun impayé échu.</div> : (
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">{V.Famille}</th><th>Téléphone</th><th>Depuis le</th><th className="text-right">Reste à payer</th></tr></thead>
            <tbody>{lignes.map((l) => { const f = families.find((x) => x.id === l.id) || {}; return (
              <tr key={l.id} style={{ borderTop: "1px solid #EEE9DA" }} data-testid="ecole-impaye-ligne"><td className="py-1.5">{f.name || "—"}</td><td>{f.phone ? <a href={"tel:" + f.phone} style={{ color: "#0F6B5C" }}>{f.phone}</a> : "—"}</td><td>{ecDateFr(l.plusAncien)}</td><td className="text-right tabular">{fmt(l.total)}</td></tr>); })}
              {totalRow([<td key="a" className="py-1.5" colSpan={3}>Total ({lignes.length} {V.famille}(s))</td>, <td key="b" className="text-right tabular" data-testid="ecole-impaye-total-montant">{fmt(ecR2(lignes.reduce((t, l) => t + l.total, 0)))}</td>], "ecole-impaye-total")}</tbody></table></div>
        )}
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Derniers encaissements</div>
        {recents.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucun encaissement pour le moment.</div> : recents.map((r) => (<div key={r.id} className="flex justify-between text-sm py-1" data-testid="ecole-recent-ligne"><span>{r.number} — {famName(r.familyId)} ({ecDateFr(r.date)})</span><span className="tabular">{fmt(r.amount)}</span></div>))}
      </div>
    );
  };

  // ───────── Années et classes ─────────
  const [fy, setFy] = useBrouillon("ecole-annee", { label: "", start: "", end: "" });
  const [fc, setFc] = useBrouillon("ecole-classe", { name: "" });
  const addYear = () => {
    if (!canEdit) return;
    const label = fy.label.trim();
    if (!label) { showToast("Indiquez le nom de la " + V.annee + " (ex. 2026-2027)."); return; }
    if (years.some((y) => y.label.toLowerCase() === label.toLowerCase())) { showToast("Cette " + V.annee + " existe déjà."); return; }
    const id = ecId();
    setEcole((prev) => [...(prev || []).map((r) => (r.type === "year" && (r.etab || "ecole") === kind ? { ...r, active: false } : r)), { type: "year", id, label, start: fy.start || "", end: fy.end || "", active: true }]);
    setYearId(id); setFy({ label: "", start: "", end: "" });
    showToast(V.annee.charAt(0).toUpperCase() + V.annee.slice(1) + " créée et activée."); logAudit("Écoles", "Année scolaire créée", label);
  };
  const [edAnnee, setEdAnnee] = useState(null);
  const enregistrerAnnee = () => {
    if (!principal || !edAnnee) { showToast("Seul l'administrateur principal peut modifier une " + V.annee + "."); return; }
    const label = (edAnnee.label || "").trim();
    if (!label) { showToast("Indiquez le nom de la " + V.annee + "."); return; }
    if (years.some((y) => y.id !== edAnnee.id && y.label.toLowerCase() === label.toLowerCase())) { showToast("Une autre " + V.annee + " porte déjà ce nom."); return; }
    if (edAnnee.start && edAnnee.end && edAnnee.end < edAnnee.start) { showToast("La date de fin ne peut pas précéder la date de début."); return; }
    setEcole((prev) => (prev || []).map((r) => (r.id === edAnnee.id ? { ...r, label, start: edAnnee.start || "", end: edAnnee.end || "" } : r)));
    logAudit("Éducation", V.Annee + " modifiée", label);
    setEdAnnee(null); showToast(V.Annee + " modifiée.");
  };
  const setActiveYear = (id) => { setEcole((prev) => (prev || []).map((r) => (r.type === "year" && (r.etab || "ecole") === kind ? { ...r, active: r.id === id } : r))); setYearId(id); };
  const addClass = () => {
    if (!canEdit) return;
    if (!year) { showToast("Créez d'abord une " + V.annee + "."); return; }
    const name = fc.name.trim();
    if (!name) { showToast("Indiquez le nom de " + V.classeDet + "."); return; }
    if (classes.some((c) => c.yearId === year.id && c.name.toLowerCase() === name.toLowerCase())) { showToast("Cette " + V.classe + " existe déjà pour cette année."); return; }
    setEcole((prev) => [...(prev || []), { type: "class", id: ecId(), yearId: year.id, name }]);
    setFc({ name: "" }); showToast(V.Classe + " ajoutée."); logAudit("Écoles", "Classe ajoutée", name);
  };
  const delClass = (c) => {
    if (!canEdit) return;
    const nb = students.filter((s) => s.classId === c.id).length;
    if (nb) { showToast("Cette " + V.classe + " contient " + nb + " " + (nb > 1 ? V.Eleves : V.Eleve).toLowerCase() + " : supprimez-les ou déplacez-les d'abord."); return; }
    setEcole((prev) => (prev || []).filter((r) => r.id !== c.id));
  };
  // ───────── Cours et crédits (formation professionnelle, université) ─────────
  const [fco, setFco] = useBrouillon("ecole-cours", { code: "", name: "", credits: "", classId: "" });
  const [fin, setFin] = useBrouillon("ecole-inscription-cours", { studentId: "", courseId: "", semesterId: "" });
  const [reprise, setReprise] = useState({});
  const nomSem = (id) => (semesters.find((x) => x.id === id) || {}).label || "";
  const addCourse = () => {
    if (!canEdit) return;
    const credits = Math.round(Number(fco.credits));
    if (!fco.name.trim()) { showToast("Indiquez l'intitulé du cours (ex. Introduction à la gestion)."); return; }
    if (!(credits >= 1 && credits <= 30)) { showToast("Indiquez le nombre de crédits du cours (entre 1 et 30)."); return; }
    if (courses.some((c) => c.name.toLowerCase() === fco.name.trim().toLowerCase())) { showToast("Ce cours existe déjà."); return; }
    setEcole((prev) => [...(prev || []), { type: "course", id: ecId(), code: fco.code.trim(), name: fco.name.trim(), credits, classId: fco.classId || "" }]);
    setFco({ code: "", name: "", credits: "", classId: fco.classId });
    showToast("Cours ajouté au catalogue.");
  };
  const delCourse = (c) => {
    if (!canEdit) return;
    if (enrolls.some((x) => x.courseId === c.id)) { showToast("Des étudiants sont inscrits à ce cours : il ne peut pas être supprimé."); return; }
    setEcole((prev) => (prev || []).filter((r) => r.id !== c.id));
  };
  const chargesInscription = (en, st) => fees.filter((f) => f.perCredit && f.yearId === st.yearId && ecEligible(f, st) && (!f.semesterId || f.semesterId === en.semesterId))
    .flatMap((f) => ecChargesPourEleve(f, st, { credits: en.credits, idTag: en.id, labelExtra: en.courseName + " (" + en.credits + " cr.)" + (en.semesterLabel && !f.semesterLabel ? " · " + en.semesterLabel : "") }));
  const creerInscription = (st, co, semesterId, extra) => {
    const en = { type: "enroll", id: ecId(), studentId: st.id, courseId: co.id, courseName: co.name, credits: co.credits, yearId: st.yearId, semesterId: semesterId || "", semesterLabel: nomSem(semesterId), status: "cours", createdAt: new Date().toISOString(), ...(extra || {}) };
    const neuves = ecAppliquerRemisesAuxNouvelles(chargesInscription(en, st), ecRows(ecole, "discount"));
    return { en, neuves };
  };
  const inscrireCours = () => {
    if (!canEdit) return;
    const st = students.find((x) => x.id === fin.studentId), co = courses.find((x) => x.id === fin.courseId);
    if (!st) { showToast("Choisissez " + V.eleveDet + "."); return; }
    if (!co) { showToast("Choisissez un cours."); return; }
    if (enrolls.some((x) => x.studentId === st.id && x.courseId === co.id && x.status !== "annulé" && x.status !== "repris" && x.status !== "valide" && (x.semesterId || "") === (fin.semesterId || ""))) { showToast("Cet étudiant est déjà inscrit à ce cours pour cette période."); return; }
    const { en, neuves } = creerInscription(st, co, fin.semesterId);
    setEcole((prev) => [...(prev || []), en, ...neuves]);
    showToast(stuName(st.id) + " inscrit(e) à « " + co.name + " » (" + co.credits + " crédits)" + (neuves.length ? " — " + neuves.length + " échéance(s) créée(s)." : " — aucun frais « par crédit » à facturer."));
    logAudit("Éducation", "Inscription à un cours", stuName(st.id) + " — " + co.name);
  };
  const statutCours = (en, status) => { if (!canEdit) return; setEcole((prev) => (prev || []).map((r) => (r.id === en.id ? { ...r, status } : r))); };
  const reinscrire = (en) => {
    if (!canEdit) return;
    const st = students.find((x) => x.id === en.studentId), co = courses.find((x) => x.id === en.courseId);
    if (!st || !co) { showToast("Le cours ou " + V.eleveDet + " n'existe plus."); return; }
    const sem = reprise[en.id] !== undefined ? reprise[en.id] : en.semesterId;
    const { en: nouveau, neuves } = creerInscription(st, co, sem, { retakeOf: en.id });
    setEcole((prev) => [...(prev || []).map((r) => (r.id === en.id ? { ...r, status: "repris" } : r)), nouveau, ...neuves]);
    showToast("Réinscription au cours « " + co.name + " » enregistrée" + (neuves.length ? " — " + neuves.length + " échéance(s) créée(s) (" + co.credits + " crédits à facturer de nouveau)." : "."));
    logAudit("Éducation", "Réinscription à un cours", stuName(st.id) + " — " + co.name);
  };
  const delInscription = (en) => {
    if (!canEdit) return;
    const siens = charges.filter((c) => String(c.id).includes(":" + en.id + ":"));
    if (siens.some((c) => c.status !== "annulée" && (c.recognized || (c.paid || 0) > 0))) { showToast("Des frais de cette inscription sont déjà constatés ou payés : suppression impossible."); return; }
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Supprimer cette inscription et ses échéances non payées ?")) return;
    const ids = new Set(siens.map((c) => c.id));
    setEcole((prev) => (prev || []).filter((r) => r.id !== en.id && !(r.type === "charge" && ids.has(r.id))));
  };
  const [rs, setRs] = useState({ studentId: "", semesterId: "", motif: "" });
  const renvoyerSemestre = () => {
    const st = students.find((x) => x.id === rs.studentId), sm = semesters.find((x) => x.id === rs.semesterId);
    if (!canEdit) return;
    if (!st) { showToast("Choisissez " + V.eleveDet + "."); return; }
    if (!sm) { showToast("Choisissez le semestre."); return; }
    const motif = rs.motif.trim();
    if (motif.length < 5) { showToast("Indiquez le motif du renvoi (quelques mots au moins) : il est obligatoire."); return; }
    const enr = enrolls.filter((x) => x.studentId === st.id && x.semesterId === sm.id && (x.status === "cours" || x.status === "reprendre"));
    const enrIds = enr.map((x) => x.id);
    const aAnnuler = new Set(charges.filter((c) => c.studentId === st.id && c.status !== "annulée" && !c.recognized && !((c.paid || 0) > 0) && (enrIds.some((id) => String(c.id).includes(":" + id + ":")) || fees.some((f) => f.id === c.feeId && f.semesterId === sm.id))).map((c) => c.id));
    setEcole((prev) => [...(prev || []).map((r) => (r.type === "enroll" && enrIds.includes(r.id) ? { ...r, status: "renvoye" } : (r.type === "charge" && aAnnuler.has(r.id) ? { ...r, status: "annulée" } : r))), { type: "renvoi", id: ecId(), studentId: st.id, semesterId: sm.id, semesterLabel: sm.label, motif, date: today, by: currentUserEmail || "", createdAt: new Date().toISOString() }]);
    setRs({ studentId: "", semesterId: rs.semesterId, motif: "" });
    showToast(stuName(st.id) + " renvoyé(e) du " + sm.label + " : " + enr.length + " inscription(s) à des cours et " + aAnnuler.size + " échéance(s) à venir annulée(s).");
    logAudit("Éducation", "Renvoi d'un semestre", stuName(st.id) + " — " + sm.label + " — motif : " + motif);
  };
  const Cours = () => {
    const anneeEnrolls = enrolls.filter((x) => year && x.yearId === year.id);
    const stActifs = students.filter((x) => year && x.yearId === year.id && x.status !== "sorti");
    const stSel = students.find((x) => x.id === fin.studentId);
    const progression = stActifs.map((x) => {
      const mine = anneeEnrolls.filter((e) => e.studentId === x.id);
      const valides = mine.filter((e) => e.status === "valide").reduce((t, e) => t + e.credits, 0);
      const encours = mine.filter((e) => e.status === "cours").reduce((t, e) => t + e.credits, 0);
      const aRepren = mine.filter((e) => e.status === "reprendre").reduce((t, e) => t + e.credits, 0);
      const requis = Number((classes.find((c) => c.id === x.classId) || {}).creditsRequis) || 0;
      return { id: x.id, nom: stuName(x.id), classe: className(x.classId), valides, encours, aRepren, requis, manque: requis > 0 ? Math.max(0, requis - valides) : 0 };
    });
    return (
      <div data-testid="ecole-cours-bloc">
        <div className="text-xs p-2 rounded mb-4" style={{ background: "#F4F1E6", color: "#5B563F" }}>Un cours porte un nombre de crédits (ex. Introduction à la gestion : 4 crédits). Chaque inscription à un cours crée les échéances des frais « par crédit » (montant × crédits du cours). Marquez le cours « Validé » ou « À reprendre » ; un cours à reprendre se réinscrit : il est alors facturé de nouveau. Pas de notes ici : seulement le résultat du cours.</div>
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Catalogue des cours</div>
        {canEdit && (<div className="grid md:grid-cols-5 gap-2 mb-3 items-end">
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Code (facultatif)</label><input value={fco.code} onChange={(e) => setFco({ ...fco, code: e.target.value })} data-testid="ecole-cours-code" className={ecInput} style={ecBorder} /></div>
          <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Intitulé du cours</label><input value={fco.name} onChange={(e) => setFco({ ...fco, name: e.target.value })} data-testid="ecole-cours-nom" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Crédits</label><input type="number" min="1" max="30" value={fco.credits} onChange={(e) => setFco({ ...fco, credits: e.target.value })} data-testid="ecole-cours-credits" className={ecInput + " tabular"} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>{V.Classe} (facultatif)</label><select value={fco.classId} onChange={(e) => setFco({ ...fco, classId: e.target.value })} data-testid="ecole-cours-classe" className={ecInput} style={ecBorder}><option value="">Toutes</option>{classes.filter((c) => year && c.yearId === year.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <button onClick={addCourse} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ecole-cours-ajouter">Ajouter le cours</button>
        </div>)}
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Code</th><th>Cours</th><th className="text-right">Crédits</th><th>{V.Classe}</th><th></th></tr></thead>
          <tbody>{courses.map((c) => (<tr key={c.id} style={{ borderTop: "1px solid #EEE9DA" }} data-testid="ecole-cours-ligne"><td className="py-1.5 tabular text-xs">{c.code || "—"}</td><td>{c.name}</td><td className="text-right tabular">{c.credits}</td><td className="text-xs">{c.classId ? className(c.classId) : "Toutes"}</td><td className="text-right">{canEdit && <button onClick={() => delCourse(c)} className="text-xs" style={{ color: "#A6432F" }} data-testid="ecole-cours-supprimer">Supprimer</button>}</td></tr>))}</tbody></table></div>
        {courses.length === 0 && <div className="text-sm mb-4" style={{ color: "#8A8370" }}>Aucun cours dans le catalogue (facultatif : sans cours, saisissez les crédits sur la fiche de chaque étudiant).</div>}
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Inscrire {V.eleveDet} à un cours{year ? " — " + year.label : ""}</div>
        {canEdit && year && (<div className="grid md:grid-cols-4 gap-2 mb-4 items-end">
          <div><label className="text-xs" style={{ color: "#8A8370" }}>{V.Eleve}</label><select value={fin.studentId} onChange={(e) => setFin({ ...fin, studentId: e.target.value })} data-testid="ecole-inscr-eleve" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{stActifs.map((x) => <option key={x.id} value={x.id}>{stuName(x.id)}</option>)}</select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Cours</label><select value={fin.courseId} onChange={(e) => setFin({ ...fin, courseId: e.target.value })} data-testid="ecole-inscr-cours" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{courses.filter((c) => !c.classId || !stSel || c.classId === stSel.classId).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.credits} cr.)</option>)}</select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Semestre (facultatif)</label><select value={fin.semesterId} onChange={(e) => setFin({ ...fin, semesterId: e.target.value })} data-testid="ecole-inscr-semestre" className={ecInput} style={ecBorder}><option value="">—</option>{semesters.filter((x) => x.yearId === year.id).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
          <button onClick={inscrireCours} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ecole-inscr-valider">Inscrire au cours</button>
        </div>)}
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">{V.Eleve}</th><th>Cours</th><th className="text-right">Crédits</th><th>Semestre</th><th>Résultat</th><th></th></tr></thead>
          <tbody>{anneeEnrolls.map((en) => (<tr key={en.id} style={{ borderTop: "1px solid #EEE9DA", opacity: en.status === "repris" ? 0.6 : 1 }} data-testid="ecole-inscr-ligne"><td className="py-1.5">{stuName(en.studentId)}</td><td>{en.courseName}{en.retakeOf ? " (reprise)" : ""}</td><td className="text-right tabular">{en.credits}</td><td className="text-xs">{en.semesterLabel || "—"}</td>
            <td>{en.status === "renvoye" ? ecPastille("Renvoyé du semestre", "alerte") : en.status === "repris" ? ecPastille("Repris", "neutre") : canEdit ? <select value={en.status} onChange={(e) => statutCours(en, e.target.value)} data-testid="ecole-inscr-statut" className="border rounded px-1 py-0.5 text-xs" style={ecBorder}><option value="cours">En cours</option><option value="valide">Validé</option><option value="reprendre">À reprendre</option></select> : ({ cours: "En cours", valide: "Validé", reprendre: "À reprendre" }[en.status] || en.status)}</td>
            <td className="text-right whitespace-nowrap">{canEdit && en.status === "reprendre" && (<><select value={reprise[en.id] !== undefined ? reprise[en.id] : en.semesterId} onChange={(e) => setReprise({ ...reprise, [en.id]: e.target.value })} className="border rounded px-1 py-0.5 text-xs mr-2" style={ecBorder}><option value="">Sans semestre</option>{semesters.filter((x) => x.yearId === en.yearId).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select><button onClick={() => reinscrire(en)} className="text-xs underline mr-3" style={{ color: "#0F6B5C" }} data-testid="ecole-inscr-reinscrire">Réinscrire</button></>)}{canEdit && en.status !== "repris" && en.status !== "renvoye" && <button onClick={() => delInscription(en)} className="text-xs" style={{ color: "#A6432F" }} data-testid="ecole-inscr-supprimer">Supprimer</button>}</td></tr>))}</tbody></table></div>
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Renvoi d'un semestre</div>
        {canEdit && year && (<div className="ec-card p-3 mb-3 grid md:grid-cols-4 gap-2 items-end" data-testid="ecole-renvoi-sem">
          <div><label className="text-xs" style={{ color: "#8A8370" }}>{V.Eleve}</label><select value={rs.studentId} onChange={(e) => setRs({ ...rs, studentId: e.target.value })} data-testid="ecole-renvoi-sem-eleve" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{stActifs.map((x) => <option key={x.id} value={x.id}>{stuName(x.id)}</option>)}</select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Semestre</label><select value={rs.semesterId} onChange={(e) => setRs({ ...rs, semesterId: e.target.value })} data-testid="ecole-renvoi-sem-semestre" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{semesters.filter((x) => x.yearId === year.id).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Motif (obligatoire)</label><input value={rs.motif} onChange={(e) => setRs({ ...rs, motif: e.target.value })} data-testid="ecole-renvoi-sem-motif" className={ecInput} style={ecBorder} /></div>
          <button onClick={renvoyerSemestre} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ecole-renvoi-sem-valider">Renvoyer du semestre</button>
        </div>)}
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">{V.Eleve}</th><th>Semestre</th><th>Date</th><th>Motif</th></tr></thead>
          <tbody>{ecRows(ecole, "renvoi").map((x) => (<tr key={x.id} style={{ borderTop: "1px solid #EEE9DA" }} data-testid="ecole-renvoi-sem-ligne"><td className="py-1.5">{stuName(x.studentId)}</td><td>{x.semesterLabel}</td><td>{ecDateFr(x.date)}</td><td>{x.motif}</td></tr>))}</tbody></table></div>
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Progression en crédits</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">{V.Eleve}</th><th>{V.Classe}</th><th className="text-right">Validés</th><th className="text-right">En cours</th><th className="text-right">À reprendre</th><th className="text-right">Requis</th><th>Situation</th></tr></thead>
          <tbody>{progression.map((x) => (<tr key={x.id} style={{ borderTop: "1px solid #EEE9DA" }} data-testid="ecole-progression-ligne"><td className="py-1.5">{x.nom}</td><td className="text-xs">{x.classe}</td><td className="text-right tabular">{x.valides}</td><td className="text-right tabular">{x.encours}</td><td className="text-right tabular">{x.aRepren}</td><td className="text-right tabular">{x.requis || "—"}</td>
            <td>{x.requis ? (x.manque === 0 ? ecPastille("Crédits suffisants", "ok") : ecPastille("Il manque " + x.manque + " crédits", "attente")) : ecPastille("Crédits requis non indiqués", "neutre")}</td></tr>))}</tbody></table></div>
      </div>
    );
  };
  const [fsem, setFsem] = useBrouillon("ecole-semestre", { label: "", start: "", end: "" });
  const choisirEtab = (k) => {
    if (!canEdit || !EC_VOCAB[k]) return;
    setEcole((prev) => [...(prev || []).filter((r) => r.type !== "etab"), { type: "etab", id: "etab", kind: k }]);
    showToast("Vous travaillez maintenant dans : " + EC_VOCAB[k].etabTitre + ". Les données de chaque type d'établissement (" + EC_VOCAB[k].Classes.toLowerCase() + ", " + EC_VOCAB[k].Eleves.toLowerCase() + ", frais, reçus) sont séparées.");
  };
  const addSemester = () => {
    if (!canEdit) return;
    if (!year) { showToast("Créez d'abord une " + V.annee + "."); return; }
    const label = fsem.label.trim();
    if (!label) { showToast("Indiquez le nom du semestre ou de la session (ex. Semestre 1)."); return; }
    if (semesters.some((x) => x.yearId === year.id && x.label.toLowerCase() === label.toLowerCase())) { showToast("Ce semestre existe déjà pour cette année."); return; }
    setEcole((prev) => [...(prev || []), { type: "semester", id: ecId(), yearId: year.id, label, start: fsem.start || "", end: fsem.end || "" }]);
    setFsem({ label: "", start: "", end: "" });
  };
  const delSemester = (x) => {
    if (!canEdit) return;
    if (fees.some((f) => f.semesterId === x.id)) { showToast("Des frais sont rattachés à ce semestre : supprimez-les d'abord."); return; }
    setEcole((prev) => (prev || []).filter((r) => r.id !== x.id));
  };
  const Annees = () => (
    <div>
      {canEdit && (<div className="ec-card p-4 mb-5" data-testid="ecole-etab">
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Type d'établissement</div>
        <div className="flex flex-wrap items-center gap-3">
          <select value={kind} onChange={(e) => choisirEtab(e.target.value)} data-testid="ecole-etab-type" className={ecInput} style={{ ...ecBorder, maxWidth: 360 }}>{EC_TYPES_ETAB.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <span className="text-xs" style={{ color: "#7A7460" }}>Chaque type a ses propres données (années, classes ou filières, inscrits, frais, reçus) et ses propres mots. Une formation professionnelle ou une université ajoute les semestres, les cours, les crédits et les frais par crédit.</span>
        </div>
      </div>)}
      <div className="display text-base mb-2" style={{ color: "#152238" }}>{V.Annees}</div>
      <div className="space-y-1 mb-3">{years.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucune {V.annee}.</div>}
        {years.map((y) => (
          <div key={y.id} className="flex items-center gap-2 text-sm p-2 rounded" style={{ background: y.id === (year && year.id) ? "#E6F1EE" : "#fff", border: "1px solid #EEE9DA" }} data-testid="ecole-annee-ligne">
            <span className="flex-1"><b>{y.label}</b>{y.start ? " — du " + ecDateFr(y.start) : ""}{y.end ? " au " + ecDateFr(y.end) : ""}{y.active ? " (année active)" : ""}</span>
            {y.id !== (year && year.id) && <button onClick={() => setYearId(y.id)} className="text-xs underline">Voir</button>}
            {principal && !y.active && <button onClick={() => setActiveYear(y.id)} className="text-xs underline" data-testid="ecole-annee-activer">Activer</button>}
            {principal && <button onClick={() => setEdAnnee({ id: y.id, label: y.label, start: y.start || "", end: y.end || "" })} className="text-xs underline" data-testid="ecole-annee-modifier">Modifier</button>}
          </div>))}
      </div>
      {edAnnee && principal && (<div className="ec-card p-3 mb-4 grid md:grid-cols-4 gap-2 items-end" data-testid="ecole-annee-edition">
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Nom</label><input value={edAnnee.label} onChange={(e) => setEdAnnee({ ...edAnnee, label: e.target.value })} data-testid="ecole-annee-edit-nom" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Début</label><input type="date" value={edAnnee.start} onChange={(e) => setEdAnnee({ ...edAnnee, start: e.target.value })} className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Fin</label><input type="date" value={edAnnee.end} onChange={(e) => setEdAnnee({ ...edAnnee, end: e.target.value })} className={ecInput} style={ecBorder} /></div>
        <div className="flex gap-2"><button onClick={enregistrerAnnee} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ecole-annee-enregistrer">Enregistrer</button><button onClick={() => setEdAnnee(null)} className="px-3 py-2 rounded text-sm" style={ecBtn}>Annuler</button></div>
      </div>)}
      {canEdit && !principal && years.length > 0 && <div className="text-xs mb-3" style={{ color: "#7A7460" }}>Seul l'administrateur principal peut modifier ou activer une {V.annee}.</div>}
      {canEdit && (<div className="grid md:grid-cols-4 gap-2 mb-6 items-end">
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Nom de la période (année)</label><input value={fy.label} onChange={(e) => setFy({ ...fy, label: e.target.value })} placeholder="2026-2027" data-testid="ecole-annee-nom" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Début</label><input type="date" value={fy.start} onChange={(e) => setFy({ ...fy, start: e.target.value })} className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Fin</label><input type="date" value={fy.end} onChange={(e) => setFy({ ...fy, end: e.target.value })} className={ecInput} style={ecBorder} /></div>
        <button onClick={addYear} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ecole-annee-ajouter">Créer l'année</button>
      </div>)}
      <div className="display text-base mb-2" style={{ color: "#152238" }}>{V.Classes}{year ? " — " + year.label : ""}</div>
      <div className="flex flex-wrap gap-2 mb-3">{year && classes.filter((c) => c.yearId === year.id).map((c) => (
        <span key={c.id} className="text-sm px-2.5 py-1 rounded" style={{ background: "#fff", border: "1px solid #DDD6C4" }} data-testid="ecole-classe-ligne">{c.name} <span className="text-xs" style={{ color: "#8A8370" }}>({students.filter((s) => s.classId === c.id && s.status !== "sorti").length})</span>
          {sup && <span className="text-xs ml-2" style={{ color: "#8A8370" }}>crédits requis : {canEdit ? <input type="number" min="0" value={c.creditsRequis || ""} onChange={(e) => setEcole((prev) => (prev || []).map((r) => (r.id === c.id ? { ...r, creditsRequis: Math.max(0, Math.round(Number(e.target.value) || 0)) } : r)))} data-testid="ecole-classe-credits-requis" className="border rounded px-1 text-xs tabular" style={{ ...ecBorder, width: 56 }} /> : (c.creditsRequis || "—")}</span>}
          {canEdit && <button onClick={() => delClass(c)} className="ml-2 text-xs" style={{ color: "#A6432F" }} aria-label={"Supprimer : " + V.classe}>×</button>}</span>))}
        {year && classes.filter((c) => c.yearId === year.id).length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucune {V.classe} pour cette année.</div>}
      </div>
      {canEdit && year && (<div className="flex gap-2 items-end max-w-md"><div className="flex-1"><label className="text-xs" style={{ color: "#8A8370" }}>Nouvelle {V.classe}</label><input value={fc.name} onChange={(e) => setFc({ name: e.target.value })} placeholder={sup ? "Ex. Comptabilité, Informatique de gestion" : "Ex. 6e année fondamentale A"} data-testid="ecole-classe-nom" className={ecInput} style={ecBorder} /></div>
        <button onClick={addClass} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ecole-classe-ajouter">Ajouter</button></div>)}
      {sup && (<div className="mt-6" data-testid="ecole-semestres">
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Semestres et sessions{year ? " — " + year.label : ""}</div>
        <div className="flex flex-wrap gap-2 mb-3">{year && semesters.filter((x) => x.yearId === year.id).map((x) => (
          <span key={x.id} className="text-sm px-2.5 py-1 rounded" style={{ background: "#fff", border: "1px solid #DDD6C4" }} data-testid="ecole-semestre-ligne">{x.label}{x.start ? " (dès le " + ecDateFr(x.start) + ")" : ""}
            {canEdit && <button onClick={() => delSemester(x)} className="ml-2 text-xs" style={{ color: "#A6432F" }} aria-label="Supprimer le semestre">×</button>}</span>))}
          {year && semesters.filter((x) => x.yearId === year.id).length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun semestre pour cette année (facultatif).</div>}</div>
        {canEdit && year && (<div className="grid md:grid-cols-4 gap-2 items-end max-w-3xl">
          <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nouveau semestre ou session</label><input value={fsem.label} onChange={(e) => setFsem({ ...fsem, label: e.target.value })} placeholder="Semestre 1" data-testid="ecole-semestre-nom" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Début</label><input type="date" value={fsem.start} onChange={(e) => setFsem({ ...fsem, start: e.target.value })} data-testid="ecole-semestre-debut" className={ecInput} style={ecBorder} /></div>
          <button onClick={addSemester} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ecole-semestre-ajouter">Ajouter</button>
        </div>)}
      </div>)}
    </div>
  );

  // ───────── Familles et élèves ─────────
  const [ff, setFf] = useBrouillon("ecole-famille", { name: "", phone: "", email: "", address: "" });
  const [fs, setFs] = useBrouillon("ecole-eleve", { firstName: "", lastName: "", familyId: "", classId: "", credits: "" });
  const addFamily = () => {
    if (!canEdit) return;
    const name = ff.name.trim().replace(/\s+/g, " ");
    if (!name) { showToast("Indiquez le nom de " + V.famDet + " ou du responsable."); return; }
    if (families.some((f) => f.name.toLowerCase() === name.toLowerCase())) { showToast("Ce nom existe déjà dans la liste : " + V.Familles.toLowerCase() + "."); return; }
    const id = ecId();
    setEcole((prev) => [...(prev || []), { type: "family", id, name, phone: ff.phone.trim(), email: ff.email.trim(), address: ff.address.trim() }]);
    setFf({ name: "", phone: "", email: "", address: "" }); setFs({ ...fs, familyId: id });
    showToast(V.Famille + " ajouté(e)."); logAudit("Écoles", "Famille ajoutée", name);
  };
  const nextMatricule = () => {
    const yy = (year && year.label ? year.label.slice(0, 4) : String(new Date().getFullYear()));
    const n = students.filter((s) => String(s.matricule || "").startsWith(yy + "-")).length + 1;
    return yy + "-" + String(n).padStart(4, "0");
  };
  const addStudent = () => {
    if (!canEdit) return;
    if (!year) { showToast("Créez d'abord une " + V.annee + "."); return; }
    const firstName = fs.firstName.trim(), lastName = fs.lastName.trim();
    if (!lastName) { showToast("Indiquez le nom de " + V.eleveDet + "."); return; }
    if (!fs.familyId || !families.some((f) => f.id === fs.familyId)) { showToast("Choisissez " + V.famDet + " de " + V.eleveDet + "."); return; }
    if (!fs.classId || !classes.some((c) => c.id === fs.classId)) { showToast("Choisissez " + V.classeDet + " de " + V.eleveDet + "."); return; }
    const st = { type: "student", id: ecId(), matricule: nextMatricule(), firstName, lastName, familyId: fs.familyId, yearId: year.id, classId: fs.classId, status: "actif", ...(sup && Number(fs.credits) > 0 ? { credits: Number(fs.credits) } : {}) };
    // les frais de l'année prévus pour cette classe sont appliqués tout de suite
    const mesFrais = fees.filter((f) => f.yearId === year.id && ecEligible(f, st));
    const nouvelles = mesFrais.flatMap((f) => cpe(f, st));
    setEcole((prev) => [...(prev || []), st, ...nouvelles]);
    setFs({ firstName: "", lastName: "", familyId: fs.familyId, classId: fs.classId, credits: "" });
    showToast(V.Eleve + " inscrit(e)" + (nouvelles.length ? " — " + nouvelles.length + " échéance(s) de frais créée(s)." : "."));
    logAudit("Écoles", "Élève inscrit", (firstName + " " + lastName).trim() + " — " + st.matricule);
  };
  const changeCredits = (s, v) => {
    if (!canEdit) return;
    const n = Math.max(0, Math.round(Number(v) || 0));
    setEcole((prev) => (prev || []).map((r) => (r.id === s.id ? { ...r, credits: n } : r)));
  };
  const changeClass = (s, classId) => {
    if (!canEdit || !classId || classId === s.classId) return;
    setEcole((prev) => (prev || []).map((r) => (r.id === s.id ? { ...r, classId } : r)));
    showToast("Classe modifiée. Les frais déjà appliqués ne changent pas ; utilisez « Appliquer les frais » (onglet Frais) pour ajouter ceux de la nouvelle classe.");
  };
  const basculerOption = (s, f) => {
    if (!canEdit) return;
    const abonne = (s.options || []).includes(f.id);
    if (!abonne) {
      const base = cpe(f, s);
      const existants = new Set(charges.map((c) => c.id));
      const neuves = ecAppliquerRemisesAuxNouvelles(base.filter((c) => !existants.has(c.id)), ecRows(ecole, "discount"));
      const ids = new Set(base.map((c) => c.id));
      setEcole((prev) => [...(prev || []).map((r) => (r.id === s.id ? { ...r, options: [...(r.options || []), f.id] } : (r.type === "charge" && ids.has(r.id) && r.status === "annulée" ? { ...r, status: "ok" } : r))), ...neuves]);
      showToast("« " + f.label + " » ajouté pour " + (s.firstName + " " + s.lastName).trim() + ".");
      logAudit("Écoles", "Abonnement ajouté", f.label + " — " + (s.firstName + " " + s.lastName).trim());
      return;
    }
    const siens = charges.filter((c) => c.studentId === s.id && c.feeId === f.id && c.status !== "annulée");
    const figees = siens.filter((c) => c.recognized || (c.paid || 0) > 0);
    const aAnnuler = new Set(siens.filter((c) => !c.recognized && !((c.paid || 0) > 0)).map((c) => c.id));
    setEcole((prev) => (prev || []).map((r) => (r.id === s.id ? { ...r, options: (r.options || []).filter((x) => x !== f.id) } : (r.type === "charge" && aAnnuler.has(r.id) ? { ...r, status: "annulée" } : r))));
    showToast(figees.length ? "« " + f.label + " » retiré. " + figees.length + " échéance(s) déjà constatée(s) ou payée(s) restent dues : elles ne sont pas annulées." : "« " + f.label + " » retiré : les échéances à venir sont annulées.");
    logAudit("Écoles", "Abonnement retiré", f.label + " — " + (s.firstName + " " + s.lastName).trim());
  };
  // Suppression d'un inscrit : seulement s'il n'a aucune trace comptable (échéance constatée ou payée). Sinon : « Marquer sorti » garde l'historique.
  const delEleve = (s) => {
    if (!canEdit) return;
    const siens = charges.filter((c) => c.studentId === s.id);
    const figees = siens.filter((c) => c.status !== "annulée" && (c.recognized || (c.paid || 0) > 0));
    if (figees.length) { showToast(figees.length + " échéance(s) de " + stuName(s.id) + " sont déjà constatées en comptabilité ou payées : suppression impossible. Utilisez « Marquer sorti » pour le retirer des listes en gardant l'historique."); return; }
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Supprimer " + stuName(s.id) + " (" + V.eleve + ") et ses échéances non payées ?")) return;
    setEcole((prev) => (prev || []).filter((r) => r.id !== s.id && !((r.type === "charge" || r.type === "enroll" || r.type === "discount" || r.type === "renvoi") && r.studentId === s.id)));
    showToast(V.Eleve + " supprimé(e)."); logAudit("Éducation", V.Eleve + " supprimé(e)", stuName(s.id));
  };
  const sortirEleve = (s) => { if (!canEdit) return; setEcole((prev) => (prev || []).map((r) => (r.id === s.id ? (s.status === "sorti" ? { ...r, status: "actif", renvoi: null, anciensRenvois: s.renvoi ? [...(r.anciensRenvois || []), s.renvoi] : r.anciensRenvois } : { ...r, status: "sorti" }) : r))); };
  // Renvoi : l'inscrit quitte la classe et les listes, avec un motif obligatoire (conservé pour le dossier). Les échéances déjà constatées ou payées restent dues ; les autres sont annulées.
  const [renvoiSel, setRenvoiSel] = useState(null);
  const [renvoiMotif, setRenvoiMotif] = useState("");
  const renvoyer = () => {
    const st = students.find((x) => x.id === renvoiSel);
    if (!canEdit || !st) return;
    const motif = renvoiMotif.trim();
    if (motif.length < 5) { showToast("Indiquez le motif du renvoi (quelques mots au moins) : il est obligatoire."); return; }
    const aAnnuler = new Set(charges.filter((c) => c.studentId === st.id && c.status !== "annulée" && !c.recognized && !((c.paid || 0) > 0)).map((c) => c.id));
    const gardees = charges.filter((c) => c.studentId === st.id && c.status !== "annulée" && (c.recognized || (c.paid || 0) > 0)).length;
    setEcole((prev) => (prev || []).map((r) => (r.id === st.id ? { ...r, status: "sorti", renvoi: { motif, date: today, by: currentUserEmail || "" } } : (r.type === "charge" && aAnnuler.has(r.id) ? { ...r, status: "annulée" } : (r.type === "enroll" && r.studentId === st.id && (r.status === "cours" || r.status === "reprendre") ? { ...r, status: "renvoye" } : r)))));
    setRenvoiSel(null); setRenvoiMotif("");
    showToast(stuName(st.id) + " renvoyé(e) : " + aAnnuler.size + " échéance(s) à venir annulée(s)" + (gardees ? " ; " + gardees + " échéance(s) déjà constatée(s) ou payée(s) restent dues." : "."));
    logAudit("Éducation", V.Eleve + " renvoyé(e)", stuName(st.id) + " — motif : " + motif);
  };
  const resteDe = (sid) => ecR2(charges.filter((c) => c.studentId === sid && c.status !== "annulée").reduce((t, c) => t + ecReste(c), 0));
  const resteFam = (fid) => ecR2(charges.filter((c) => c.familyId === fid && c.status !== "annulée").reduce((t, c) => t + ecReste(c), 0));
  const elevesFiltres = () => students.filter((s) => year && s.yearId === year.id && (!fcl || s.classId === fcl) && (!fq.trim() || ((s.firstName + " " + s.lastName + " " + (s.matricule || "")).toLowerCase().includes(fq.trim().toLowerCase()))));
  const saveFam = () => {
    if (!canEdit || !edFam) return;
    const name = edFam.name.trim().replace(/\s+/g, " ");
    if (!name) { showToast("Indiquez le nom de " + V.famDet + "."); return; }
    if (families.some((f) => f.id !== edFam.id && f.name.toLowerCase() === name.toLowerCase())) { showToast("Un autre " + V.famille + " porte déjà ce nom."); return; }
    setEcole((prev) => (prev || []).map((r) => (r.id === edFam.id ? { ...r, name, phone: edFam.phone.trim(), email: edFam.email.trim() } : r)));
    setEdFam(null); showToast(V.Famille + " modifié(e)."); logAudit("Éducation", V.Famille + " modifiée", name);
  };
  const FamTable = () => (
    <div className="ec-wrap mb-5"><table className="ec-table" data-testid="ecole-familles-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">{V.Famille}</th><th>Téléphone</th><th>E-mail</th><th className="text-right">{V.Eleves}</th><th className="text-right">Reste à payer</th><th></th></tr></thead>
      <tbody>{families.map((f) => { const n = students.filter((x) => x.familyId === f.id && (!year || x.yearId === year.id) && x.status !== "sorti").length; const edit = edFam && edFam.id === f.id; return (
        <tr key={f.id} data-testid="ecole-famille-ligne">
          {edit ? <><td className="py-1.5"><input value={edFam.name} onChange={(e) => setEdFam({ ...edFam, name: e.target.value })} data-testid="ecole-famille-edit-nom" className="border rounded px-1 py-0.5 text-sm w-full" style={ecBorder} /></td><td><input value={edFam.phone} onChange={(e) => setEdFam({ ...edFam, phone: e.target.value })} data-testid="ecole-famille-edit-tel" className="border rounded px-1 py-0.5 text-sm w-full" style={ecBorder} /></td><td><input value={edFam.email} onChange={(e) => setEdFam({ ...edFam, email: e.target.value })} className="border rounded px-1 py-0.5 text-sm w-full" style={ecBorder} /></td></>
            : <><td className="py-1.5">{f.name}</td><td className="text-xs">{f.phone || "—"}</td><td className="text-xs">{f.email || "—"}</td></>}
          <td className="text-right tabular">{n}</td><td className="text-right tabular">{fmt(resteFam(f.id))}</td>
          <td className="text-right whitespace-nowrap">{edit ? <><button onClick={saveFam} className="text-xs underline mr-3" data-testid="ecole-famille-edit-ok">Enregistrer</button><button onClick={() => setEdFam(null)} className="text-xs">Annuler</button></> : <><button onClick={() => setPrintRel({ familyId: f.id })} className="text-xs underline mr-3" data-testid="ecole-releve-voir">Relevé de compte</button>{canEdit && <button onClick={() => setEdFam({ id: f.id, name: f.name, phone: f.phone || "", email: f.email || "" })} className="text-xs underline" data-testid="ecole-famille-modifier">Modifier</button>}</>}</td></tr>); })}
        {families.length > 0 && totalRow([<td key="a" className="py-1.5" colSpan={3}>Total ({families.length} {V.famille}(s))</td>, <td key="b" className="text-right tabular">{students.filter((x) => (!year || x.yearId === year.id) && x.status !== "sorti").length}</td>, <td key="c" className="text-right tabular" data-testid="ecole-familles-total-reste">{fmt(ecR2(families.reduce((t, f) => t + resteFam(f.id), 0)))}</td>, <td key="d"></td>], "ecole-familles-total")}</tbody></table></div>
  );
  const Eleves = () => (
    <div>
      <div className="display text-base mb-2" style={{ color: "#152238" }}>{V.Familles}</div>
      {canEdit && (<div className="grid md:grid-cols-5 gap-2 mb-3 items-end">
        <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>{V.FamilleResp}</label><input value={ff.name} onChange={(e) => setFf({ ...ff, name: e.target.value })} data-testid="ecole-famille-nom" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Téléphone</label><input type="tel" value={ff.phone} onChange={(e) => setFf({ ...ff, phone: e.target.value })} data-testid="ecole-famille-tel" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>E-mail</label><input value={ff.email} onChange={(e) => setFf({ ...ff, email: e.target.value })} className={ecInput} style={ecBorder} /></div>
        <button onClick={addFamily} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ecole-famille-ajouter">Enregistrer {V.famDet}</button>
      </div>)}
      {FamTable()}
      <div className="display text-base mb-2" style={{ color: "#152238" }}>{V.Eleves}{year ? " — " + year.label : ""}</div>
      {canEdit && (<div className="grid md:grid-cols-5 gap-2 mb-3 items-end">
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Prénom</label><input value={fs.firstName} onChange={(e) => setFs({ ...fs, firstName: e.target.value })} data-testid="ecole-eleve-prenom" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Nom</label><input value={fs.lastName} onChange={(e) => setFs({ ...fs, lastName: e.target.value })} data-testid="ecole-eleve-nom" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>{V.Famille}</label><select value={fs.familyId} onChange={(e) => setFs({ ...fs, familyId: e.target.value })} data-testid="ecole-eleve-famille" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>{V.Classe}</label><select value={fs.classId} onChange={(e) => setFs({ ...fs, classId: e.target.value })} data-testid="ecole-eleve-classe" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{year && classes.filter((c) => c.yearId === year.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        {sup && <div><label className="text-xs" style={{ color: "#8A8370" }}>Crédits ce semestre (facultatif)</label><input type="number" min="0" value={fs.credits || ""} onChange={(e) => setFs({ ...fs, credits: e.target.value })} data-testid="ecole-eleve-credits" className={ecInput + " tabular"} style={ecBorder} /></div>}
        <button onClick={addStudent} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ecole-eleve-ajouter">Inscrire {V.eleveDet} et créer ses échéances</button>
      </div>)}
      <div className="flex flex-wrap items-end gap-3 mb-2"><div><label className="text-xs" style={{ color: "#8A8370" }}>Chercher (nom ou matricule)</label><input value={fq} onChange={(e) => setFq(e.target.value)} data-testid="ecole-eleve-recherche" className="block border rounded px-2 py-1 text-sm" style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>{V.Classe}</label><select value={fcl} onChange={(e) => setFcl(e.target.value)} data-testid="ecole-eleve-filtre-classe" className="block border rounded px-2 py-1 text-sm" style={ecBorder}><option value="">Toutes</option>{classes.filter((c) => year && c.yearId === year.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div></div>
      <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Matricule</th><th>{V.Eleve}</th><th>{V.Famille}</th><th>{V.Classe}</th>{sup && <th className="text-right">Crédits</th>}<th className="text-right">Reste à payer</th><th></th></tr></thead>
        <tbody>{elevesFiltres().map((s) => {
          const reste = ecR2(charges.filter((c) => c.studentId === s.id && c.status !== "annulée").reduce((t, c) => t + ecReste(c), 0));
          return (<tr key={s.id} style={{ borderTop: "1px solid #EEE9DA", opacity: s.status === "sorti" ? 0.55 : 1 }} data-testid="ecole-eleve-ligne">
            <td className="py-1.5 tabular text-xs">{s.matricule}</td><td>{(s.firstName + " " + s.lastName).trim()}{s.status === "sorti" ? (s.renvoi ? " (renvoyé le " + ecDateFr(s.renvoi.date) + " — " + s.renvoi.motif + ")" : " (sorti)") : ""}</td><td>{famName(s.familyId)}</td>
            <td>{canEdit ? <select value={s.classId} onChange={(e) => changeClass(s, e.target.value)} className="border rounded px-1 py-0.5 text-xs" style={ecBorder}>{classes.filter((c) => c.yearId === s.yearId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select> : className(s.classId)}</td>
            {sup && <td className="text-right">{canEdit ? <input type="number" min="0" value={s.credits || ""} onChange={(e) => changeCredits(s, e.target.value)} data-testid="ecole-eleve-credits-ligne" className="border rounded px-1 py-0.5 text-xs tabular" style={{ ...ecBorder, width: 64 }} /> : (s.credits || "—")}</td>}
            <td className="text-right tabular">{fmt(reste)}</td><td className="text-right">{canEdit && fees.filter((f) => f.optional && f.yearId === s.yearId && (!f.classIds || f.classIds.length === 0 || f.classIds.includes(s.classId))).map((f) => <label key={f.id} className="text-xs mr-3 whitespace-nowrap"><input type="checkbox" checked={(s.options || []).includes(f.id)} onChange={() => basculerOption(s, f)} data-testid="ecole-eleve-option" /> {f.label}</label>)}{canEdit && <button onClick={() => sortirEleve(s)} className="text-xs underline">{s.status === "sorti" ? "Réintégrer" : "Marquer sorti"}</button>}{canEdit && s.status !== "sorti" && <button onClick={() => { setRenvoiSel(s.id); setRenvoiMotif(""); }} className="text-xs underline ml-3" style={{ color: "#A6432F" }} data-testid="ecole-eleve-renvoyer">Renvoyer</button>}{canEdit && <button onClick={() => delEleve(s)} className="text-xs underline ml-3" style={{ color: "#A6432F" }} data-testid="ecole-eleve-supprimer">Supprimer</button>}</td></tr>);
        })}
          {totalRow([<td key="a" className="py-1.5" colSpan={sup ? 5 : 4}>Total ({elevesFiltres().length} {V.eleve}(s))</td>, <td key="b" className="text-right tabular" data-testid="ecole-eleves-total-reste">{fmt(ecR2(elevesFiltres().reduce((t, s) => t + resteDe(s.id), 0)))}</td>, <td key="c"></td>], "ecole-eleves-total")}</tbody></table></div>
      {renvoiSel && canEdit && (<div className="ec-card p-3 mt-3 flex flex-wrap items-end gap-3" data-testid="ecole-renvoi-form">
        <div className="flex-1 min-w-[260px]"><label className="text-xs" style={{ color: "#8A8370" }}>Motif du renvoi de {stuName(renvoiSel)} (obligatoire)</label><input value={renvoiMotif} onChange={(e) => setRenvoiMotif(e.target.value)} data-testid="ecole-renvoi-motif" className={ecInput} style={ecBorder} /></div>
        <button onClick={renvoyer} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ecole-renvoi-valider">Confirmer le renvoi</button>
        <button onClick={() => setRenvoiSel(null)} className="px-3 py-2 rounded text-sm" style={ecBtn}>Annuler</button>
      </div>)}
      {year && students.filter((s) => s.yearId === year.id).length === 0 && <div className="text-sm mt-2" style={{ color: "#8A8370" }}>Aucun {V.eleve} pour cette année.</div>}
    </div>
  );

  // ───────── Frais ─────────
  const [fe, setFe] = useBrouillon("ecole-frais", { label: "", amount: "", nb: "1", firstDue: "", account: "7061", classIds: [], tca: false, optional: false, perCredit: false, semesterId: "" });
  const addFee = () => {
    if (!canEdit) return;
    if (!year) { showToast("Créez d'abord une " + V.annee + "."); return; }
    const amount = Number(fe.amount), nb = Math.round(Number(fe.nb));
    if (!fe.label.trim()) { showToast("Indiquez le nom du frais (ex. Écolage, Inscription)."); return; }
    if (!(amount > 0)) { showToast("Indiquez un montant supérieur à zéro."); return; }
    if (!(nb >= 1 && nb <= 12)) { showToast("Le nombre d'échéances doit être entre 1 et 12."); return; }
    if (!fe.firstDue) { showToast("Indiquez la date de la première échéance."); return; }
    const taux = fe.tca ? Number(settings.taxRate) || 0 : 0;
    setEcole((prev) => [...(prev || []), { type: "fee", id: ecId(), yearId: year.id, label: fe.label.trim(), amount: ecR2(amount), nb, firstDue: fe.firstDue, account: fe.account, classIds: (fe.classIds || []).slice(), tcaRate: taux, optional: !!fe.optional, ...(sup && fe.perCredit ? { perCredit: true } : {}), ...(sup && fe.semesterId ? { semesterId: fe.semesterId, semesterLabel: (semesters.find((x) => x.id === fe.semesterId) || {}).label || "" } : {}) }]);
    setFe({ label: "", amount: "", nb: "1", firstDue: fe.firstDue, account: fe.account, classIds: [], tca: false, optional: false, perCredit: false, semesterId: fe.semesterId });
    showToast("Frais ajouté. Utilisez « Appliquer les frais aux élèves » pour créer les échéances."); logAudit("Écoles", "Frais ajouté", fe.label.trim() + " — " + fmt(amount));
  };
  const delFee = (f) => {
    if (!canEdit) return;
    if (charges.some((c) => c.feeId === f.id && c.status !== "annulée")) { showToast("Ce frais a déjà été appliqué à des élèves : il ne peut plus être supprimé."); return; }
    setEcole((prev) => (prev || []).filter((r) => r.id !== f.id));
  };
  const calcNouvelles = () => {
    if (!year) return [];
    const existants = new Set(charges.map((c) => c.id));
    const nouvelles = [];
    fees.filter((f) => f.yearId === year.id).forEach((f) => {
      students.filter((s) => s.yearId === year.id && s.status !== "sorti" && ecEligible(f, s)).forEach((s) => {
        cpe(f, s).forEach((c) => { if (!existants.has(c.id)) nouvelles.push(c); });
      });
    });
    return nouvelles;
  };
  const appliquer = () => {
    if (!canEdit || !year) return;
    const nouvelles = calcNouvelles();
    const avecRemises = ecAppliquerRemisesAuxNouvelles(nouvelles, ecRows(ecole, "discount"));
    nouvelles.splice(0, nouvelles.length, ...avecRemises);
    if (!nouvelles.length) { showToast("Rien à ajouter : tous les frais sont déjà appliqués à tous les élèves concernés."); return; }
    setEcole((prev) => [...(prev || []), ...nouvelles]);
    showToast(nouvelles.length + " échéance(s) créée(s)."); logAudit("Écoles", "Frais appliqués aux élèves", nouvelles.length + " échéance(s)");
  };
  const Frais = () => (
    <div>
      <div className="text-xs p-2 rounded mb-4" style={{ background: "#F4F1E6", color: "#5B563F" }}>Frais scolaires : exonérés de TCA par défaut (art. 181 du Code fiscal). Pour la cantine, le transport ou les uniformes, cochez « Soumis à la TCA » seulement après avoir confirmé avec votre expert-comptable ; le montant saisi est alors considéré <b>toutes taxes comprises</b>.</div>
      <div className="display text-base mb-2" style={{ color: "#152238" }}>Grille de frais{year ? " — " + year.label : ""}</div>
      {canEdit && year && (<div className="grid md:grid-cols-6 gap-2 mb-2 items-end">
        <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom du frais</label><input value={fe.label} onChange={(e) => setFe({ ...fe, label: e.target.value })} placeholder="Écolage" data-testid="ecole-frais-nom" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>{sup && fe.perCredit ? "Montant par crédit" : "Montant total par " + V.eleve}</label><input type="number" min="0" value={fe.amount} onChange={(e) => setFe({ ...fe, amount: e.target.value })} data-testid="ecole-frais-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Nombre d'échéances</label><input type="number" min="1" max="12" value={fe.nb} onChange={(e) => setFe({ ...fe, nb: e.target.value })} data-testid="ecole-frais-nb" className={ecInput + " tabular"} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>1re échéance</label><input type="date" value={fe.firstDue} onChange={(e) => setFe({ ...fe, firstDue: e.target.value })} data-testid="ecole-frais-date" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Type</label><select value={fe.account} onChange={(e) => setFe({ ...fe, account: e.target.value })} data-testid="ecole-frais-type" className={ecInput} style={ecBorder}>{EC_PRODUITS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      </div>)}
      {canEdit && year && (<div className="flex flex-wrap items-center gap-4 mb-4 text-sm">
        <span className="text-xs" style={{ color: "#8A8370" }}>{V.Classes} concernées (aucune cochée = toutes) :</span>
        {classes.filter((c) => c.yearId === year.id).map((c) => <label key={c.id} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={(fe.classIds || []).includes(c.id)} onChange={() => setFe({ ...fe, classIds: (fe.classIds || []).includes(c.id) ? fe.classIds.filter((x) => x !== c.id) : [...(fe.classIds || []), c.id] })} />{c.name}</label>)}
        {sup && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!fe.perCredit} onChange={(e) => setFe({ ...fe, perCredit: e.target.checked })} data-testid="ecole-frais-par-credit" />Montant par crédit (× crédits de l'étudiant)</label>}
        {sup && semesters.filter((x) => year && x.yearId === year.id).length > 0 && <select value={fe.semesterId} onChange={(e) => { const sm = semesters.find((x) => x.id === e.target.value); setFe({ ...fe, semesterId: e.target.value, firstDue: sm && sm.start && !fe.firstDue ? sm.start : fe.firstDue }); }} data-testid="ecole-frais-semestre" className="border rounded px-2 py-1 text-xs" style={ecBorder}><option value="">Période : toute l'année</option>{semesters.filter((x) => year && x.yearId === year.id).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>}
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!fe.tca} onChange={(e) => setFe({ ...fe, tca: e.target.checked })} data-testid="ecole-frais-tca" />Soumis à la TCA</label>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!fe.optional} onChange={(e) => setFe({ ...fe, optional: e.target.checked })} data-testid="ecole-frais-facultatif" />Facultatif (cantine, transport : par abonnement)</label>
        <button onClick={addFee} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ecole-frais-ajouter">Ajouter ce frais</button>
      </div>)}
      <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Frais</th><th className="text-right">Montant</th><th className="text-right">Échéances</th><th>1re échéance</th><th>{V.Classes}</th><th></th></tr></thead>
        <tbody>{year && fees.filter((f) => f.yearId === year.id).map((f) => (
          <tr key={f.id} style={{ borderTop: "1px solid #EEE9DA" }} data-testid="ecole-frais-ligne"><td className="py-1.5">{f.label}{f.tcaRate > 0 ? " (TCA " + f.tcaRate + " %)" : ""}{f.optional ? " (facultatif)" : ""}{f.semesterLabel ? " — " + f.semesterLabel : ""}</td><td className="text-right tabular">{fmt(f.amount)}{f.perCredit ? " / crédit" : ""}</td><td className="text-right">{f.nb}</td><td>{ecDateFr(f.firstDue)}</td>
            <td className="text-xs">{(f.classIds || []).length ? f.classIds.map(className).join(", ") : "Toutes"}</td><td className="text-right">{canEdit && <button onClick={() => delFee(f)} className="text-xs" style={{ color: "#A6432F" }}>Supprimer</button>}</td></tr>))}</tbody></table></div>
      {canEdit && year && (() => { const n = calcNouvelles(); const nbE = new Set(n.map((c) => c.studentId)).size; return (<div className="ec-card p-3 mt-3" data-testid="ecole-appliquer-bloc"><div className="text-sm mb-2" data-testid="ecole-appliquer-info">{n.length > 0 ? <><b>{n.length}</b> échéance(s) restent à créer pour <b>{nbE}</b> {V.eleve}(s). Cliquez sur le bouton pour les créer : sans cela, rien n'apparaît dans « Échéances » ni dans les impayés.</> : fees.some((f) => f.yearId === year.id) ? "Toutes les échéances sont déjà créées pour les " + V.Eleves.toLowerCase() + " concernés." : "Ajoutez d'abord au moins un frais ci-dessus."}</div>
        <button onClick={appliquer} disabled={!n.length} className="px-3 py-2 rounded text-sm" style={{ ...ecBtnGold, opacity: n.length ? 1 : 0.5 }} data-testid="ecole-appliquer">Appliquer les frais : créer les échéances</button></div>); })()}
    </div>
  );

  // ───────── Écritures (constatation + encaissement) ─────────
  const postEntry = (date, label, lines, extra) => {
    const e = { id: uid(), date, createdAt: new Date().toISOString(), label, lines, ...(extra || {}) };
    setEntries((prev) => [...prev, e]);
    return e;
  };
  const constater = () => {
    if (!canEdit) return;
    if (isLocked(today, settings)) { showToast("La période comptable est clôturée jusqu'au " + settings.lockDate + " inclus : impossible de constater à cette date."); return; }
    const r = ecReconnaitre(charges.filter((c) => c.yearId === (year && year.id)), today);
    if (!r) { showToast("Aucune échéance échue à constater."); return; }
    ecAjouterComptes(accounts, setAccounts, ["4111", ...r.lines.map((l) => l.account).filter((a) => EC_COMPTES[a])]);
    const e = postEntry(today, "Frais scolaires — échéances échues au " + ecDateFr(today) + " (" + r.count + ")", r.lines, { kind: "ecole" });
    setEcole((prev) => (prev || []).map((x) => (x.type === "charge" && r.ids.has(x.id) ? { ...x, recognized: true, recognizedAt: today, entryId: e.id } : x)));
    showToast(r.count + " échéance(s) constatée(s) en comptabilité."); logAudit("Écoles", "Échéances constatées", r.count + " — " + fmt(r.total));
  };
  const Echeances = () => {
    const etatDe = (c) => (ecReste(c) <= 0 ? "soldee" : c.dueDate <= today ? "echue" : "avenir");
    const q = fEch.q.trim().toLowerCase();
    const list = yCharges.filter((c) => (!fEch.etat || etatDe(c) === fEch.etat) && (!fEch.classId || (students.find((x) => x.id === c.studentId) || {}).classId === fEch.classId) && (!fEch.du || c.dueDate >= fEch.du) && (!fEch.au || c.dueDate <= fEch.au) && (!q || (stuName(c.studentId) + " " + famName(c.familyId) + " " + c.label).toLowerCase().includes(q)))
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || String(a.id).localeCompare(String(b.id)));
    return (
      <div>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="text-sm" style={{ color: "#152238" }}><span data-testid="ecole-nb-echeances">{list.length}</span> échéance(s){year ? " — " + year.label : ""} · à constater : <b data-testid="ecole-nb-aconstater">{aConstater.length}</b></div>
          {canEdit && <button onClick={constater} disabled={!aConstater.length} className="px-3 py-1.5 rounded text-sm" style={{ ...ecBtnGold, opacity: aConstater.length ? 1 : 0.5 }} data-testid="ecole-constater">Constater les échéances échues</button>}
        </div>
        <div className="text-xs mb-3" style={{ color: "#7A7460" }}>Constater, c'est inscrire en comptabilité les frais devenus exigibles (Familles / Produit). Une avance déjà reçue est alors transformée en produit.</div>
        <div className="ec-card p-3 mb-3"><div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
          <div><label className="text-xs" style={{ color: "#8A8370" }}>État</label><select value={fEch.etat} onChange={(e) => setFEch({ ...fEch, etat: e.target.value })} data-testid="ecole-ech-etat" className={ecInput} style={ecBorder}><option value="">Toutes</option><option value="echue">Échues et impayées</option><option value="avenir">À venir</option><option value="soldee">Soldées</option></select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>{V.Classe}</label><select value={fEch.classId} onChange={(e) => setFEch({ ...fEch, classId: e.target.value })} className={ecInput} style={ecBorder}><option value="">Toutes</option>{classes.filter((c) => year && c.yearId === year.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Échéance du</label><input type="date" value={fEch.du} onChange={(e) => setFEch({ ...fEch, du: e.target.value })} className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>au</label><input type="date" value={fEch.au} onChange={(e) => setFEch({ ...fEch, au: e.target.value })} className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Chercher</label><input value={fEch.q} onChange={(e) => setFEch({ ...fEch, q: e.target.value })} data-testid="ecole-ech-recherche" className={ecInput} style={ecBorder} /></div>
        </div></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Échéance</th><th>{V.Eleve}</th><th>Frais</th><th className="text-right">Montant</th><th className="text-right">Payé</th><th className="text-right">Reste</th><th>État</th></tr></thead>
          <tbody>{list.map((c) => {
            const reste = ecReste(c);
            const etat = reste <= 0 ? "Soldée" : c.dueDate <= today ? (c.paid > 0 ? "Partiellement payée — échue" : "Échue, impayée") : (c.advance > 0 ? "Avance reçue" : "À venir");
            return (<tr key={c.id} style={{ borderTop: "1px solid #EEE9DA" }} data-testid="ecole-echeance-ligne"><td className="py-1.5">{ecDateFr(c.dueDate)}</td><td>{stuName(c.studentId)}</td><td>{c.label}</td><td className="text-right tabular">{fmt(c.amount)}</td><td className="text-right tabular">{fmt(c.paid || 0)}</td><td className="text-right tabular">{fmt(reste)}</td><td>{ecPastille(etat, reste <= 0 ? "ok" : c.dueDate <= today ? "alerte" : c.advance > 0 ? "info" : "neutre")}{c.recognized ? <span className="text-xs ml-2" style={{ color: "#8A8370" }}>constatée</span> : null}</td></tr>);
          })}
            {list.length > 0 && totalRow([<td key="a" className="py-1.5" colSpan={3}>Total ({list.length} échéance(s))</td>, <td key="b" className="text-right tabular" data-testid="ecole-ech-total-montant">{fmt(ecR2(list.reduce((t, c) => t + c.amount, 0)))}</td>, <td key="c" className="text-right tabular" data-testid="ecole-ech-total-paye">{fmt(ecR2(list.reduce((t, c) => t + (c.paid || 0), 0)))}</td>, <td key="d" className="text-right tabular" data-testid="ecole-ech-total-reste">{fmt(ecR2(list.reduce((t, c) => t + ecReste(c), 0)))}</td>, <td key="e"></td>], "ecole-ech-total")}</tbody></table></div>
        {list.length === 0 && <div className="text-sm mt-2" style={{ color: "#8A8370" }}>Aucune échéance pour ces filtres.{yCharges.length === 0 ? " Pour en créer : onglet « Frais » → « Appliquer les frais »." : ""}</div>}
      </div>
    );
  };

  const [fp, setFp] = useBrouillon("ecole-paiement", { familyId: "", studentId: "", amount: "", mode: "caisse", date: todayStr(), payer: "" });
  const prochainNumero = () => {
    const yy = String(new Date().getFullYear());
    const n = ecRows(ecoleTout, "receipt").filter((r) => String(r.number || "").startsWith("RE-" + yy + "-")).reduce((m, r) => Math.max(m, Number(String(r.number).split("-")[2]) || 0), 0) + 1;
    return "RE-" + yy + "-" + String(n).padStart(4, "0");
  };
  const famCharges = fp.familyId ? charges.filter((c) => c.familyId === fp.familyId && c.status !== "annulée") : [];
  const famReste = ecR2(famCharges.reduce((s, c) => s + ecReste(c), 0));
  const encaisser = () => {
    if (!canCash) return;
    const montant = ecR2(fp.amount);
    if (!fp.familyId) { showToast("Choisissez la famille."); return; }
    if (!(montant > 0)) { showToast("Indiquez le montant reçu."); return; }
    if (!fp.date || isFutureDate(fp.date)) { showToast("La date d'encaissement ne peut pas être dans le futur."); return; }
    if (isLocked(fp.date, settings)) { showToast("La période comptable est clôturée jusqu'au " + settings.lockDate + " inclus : impossible d'encaisser à cette date."); return; }
    if (montant > famReste + 0.004) { showToast("Le montant dépasse ce que cette famille doit (" + fmt(famReste) + "). Ajoutez d'abord les frais concernés."); return; }
    // 1) constater d'abord les échéances échues de cette famille, pour que le paiement les solde (et non une avance)
    let work = charges.map((c) => ({ ...c }));
    const rec = ecReconnaitre(work.filter((c) => c.familyId === fp.familyId), fp.date);
    const codes = ["4111", "487"];
    let recEntry = null;
    if (rec) {
      recEntry = { lines: rec.lines };
      rec.lines.forEach((l) => codes.push(l.account));
      work = work.map((c) => (rec.ids.has(c.id) ? { ...c, recognized: true, recognizedAt: fp.date } : c));
    }
    const { alloc, left } = ecRepartir(work, fp.familyId, fp.studentId, montant, fp.date);
    if (left > 0.004) { showToast("Le paiement n'a pas pu être réparti : vérifiez les échéances de la famille."); return; }
    const aSolder = ecR2(alloc.filter((a) => !a.toAdvance).reduce((s, a) => s + a.amount, 0));
    const enAvance = ecR2(alloc.filter((a) => a.toAdvance).reduce((s, a) => s + a.amount, 0));
    const compte = fp.mode === "banque" ? "512" : "530";
    ecAjouterComptes(accounts, setAccounts, codes, role);
    const fam = families.find((f) => f.id === fp.familyId) || {};
    let recId = null;
    if (recEntry) recId = postEntry(fp.date, "Frais scolaires — échéances échues au " + ecDateFr(fp.date) + " (" + fam.name + ")", recEntry.lines, { kind: "ecole" }).id;
    const lines = [{ account: compte, debit: montant, credit: 0 }];
    if (aSolder > 0) lines.push({ account: "4111", debit: 0, credit: aSolder });
    if (enAvance > 0) lines.push({ account: "487", debit: 0, credit: enAvance });
    const number = prochainNumero();
    const e = postEntry(fp.date, "Encaissement scolarité " + number + " — " + fam.name, lines, { kind: "ecole" });
    const receipt = { type: "receipt", id: ecId(), number, familyId: fp.familyId, studentId: fp.studentId || "", date: fp.date, createdAt: new Date().toISOString(), amount: montant, mode: fp.mode, payer: fp.payer.trim(), allocations: alloc, entryId: e.id, status: "valide", by: currentUserEmail || "" };
    const parCharge = {}; alloc.forEach((a) => { parCharge[a.chargeId] = a; });
    setEcole((prev) => [...(prev || []).map((x) => {
      if (x.type !== "charge") return x;
      let y = x;
      if (rec && rec.ids.has(x.id)) y = { ...y, recognized: true, recognizedAt: fp.date, entryId: recId };
      const a = parCharge[x.id];
      if (a) y = { ...y, paid: ecR2((y.paid || 0) + a.amount), advance: a.toAdvance ? ecR2((y.advance || 0) + a.amount) : y.advance || 0 };
      return y;
    }), receipt]);
    setFp({ familyId: fp.familyId, studentId: "", amount: "", mode: fp.mode, date: todayStr(), payer: "" });
    showToast("Encaissement enregistré — reçu " + number + ".");
    logAudit("Écoles", "Encaissement scolarité", number + " — " + fam.name + " — " + fmt(montant));
    setPrintRec(receipt);
  };
  const annulerRecu = (r) => {
    if (!canEdit || r.status === "annulé") return;
    if (isLocked(today, settings)) { showToast("La période comptable est clôturée jusqu'au " + settings.lockDate + " inclus : impossible d'annuler ce reçu."); return; }
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler le reçu " + r.number + " ? Une écriture inverse sera passée.")) return;
    const compte = r.mode === "banque" ? "512" : "530";
    let sur4111 = 0, sur487 = 0;
    r.allocations.forEach((a) => { const c = charges.find((x) => x.id === a.chargeId); if (c && !c.recognized) sur487 = ecR2(sur487 + a.amount); else sur4111 = ecR2(sur4111 + a.amount); });
    const lines = [];
    if (sur4111 > 0) lines.push({ account: "4111", debit: sur4111, credit: 0 });
    if (sur487 > 0) lines.push({ account: "487", debit: sur487, credit: 0 });
    lines.push({ account: compte, debit: 0, credit: ecR2(sur4111 + sur487) });
    const e = postEntry(today, "Annulation du reçu " + r.number + " (écriture inverse)", lines, { kind: "ecole" });
    const parCharge = {}; r.allocations.forEach((a) => { parCharge[a.chargeId] = a; });
    setEcole((prev) => (prev || []).map((x) => {
      if (x.id === r.id) return { ...x, status: "annulé", cancelledAt: new Date().toISOString(), reversalEntryId: e.id };
      const a = x.type === "charge" ? parCharge[x.id] : null;
      return a ? { ...x, paid: ecR2(Math.max(0, (x.paid || 0) - a.amount)), advance: a.toAdvance ? ecR2(Math.max(0, (x.advance || 0) - a.amount)) : x.advance || 0 } : x;
    }));
    showToast("Reçu " + r.number + " annulé."); logAudit("Écoles", "Reçu annulé", r.number);
  };
  const Recus = () => {
    const liste = receipts.filter((r) => (!fRec.du || r.date >= fRec.du) && (!fRec.au || r.date <= fRec.au) && (!fRec.familyId || r.familyId === fRec.familyId) && (!fRec.mode || (r.mode === "banque" ? "banque" : "caisse") === fRec.mode) && (!fRec.etat || (fRec.etat === "annule" ? r.status === "annulé" : r.status !== "annulé"))).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const valides = liste.filter((r) => r.status !== "annulé");
    const somme = (f) => ecR2(valides.filter(f).reduce((t, r) => t + r.amount, 0));
    return (
    <div>
      {canCash && (<div className="ec-card p-4 mb-5">
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvel encaissement</div>
        <div className="grid md:grid-cols-6 gap-2 items-end">
          <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>{V.Famille}</label><select value={fp.familyId} onChange={(e) => setFp({ ...fp, familyId: e.target.value, studentId: "" })} data-testid="ecole-paie-famille" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>{V.Eleve} (facultatif)</label><select value={fp.studentId} onChange={(e) => setFp({ ...fp, studentId: e.target.value })} data-testid="ecole-paie-eleve" className={ecInput} style={ecBorder}><option value="">Tous</option>{students.filter((s) => s.familyId === fp.familyId).map((s) => <option key={s.id} value={s.id}>{(s.firstName + " " + s.lastName).trim()}</option>)}</select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant reçu</label><input type="number" min="0" value={fp.amount} onChange={(e) => setFp({ ...fp, amount: e.target.value })} data-testid="ecole-paie-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Mode</label><select value={fp.mode} onChange={(e) => setFp({ ...fp, mode: e.target.value })} data-testid="ecole-paie-mode" className={ecInput} style={ecBorder}><option value="caisse">Espèces (caisse)</option><option value="banque">Banque</option></select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" value={fp.date} max={todayStr()} onChange={(e) => setFp({ ...fp, date: e.target.value })} data-testid="ecole-paie-date" className={ecInput} style={ecBorder} /></div>
        </div>
        <div className="flex flex-wrap items-end gap-3 mt-2">
          <div className="flex-1 min-w-[200px]"><label className="text-xs" style={{ color: "#8A8370" }}>Payé par (facultatif)</label><input value={fp.payer} onChange={(e) => setFp({ ...fp, payer: e.target.value })} className={ecInput} style={ecBorder} /></div>
          {fp.familyId && <div className="text-xs" style={{ color: "#7A7460" }}>Reste à payer par cette famille : <b className="tabular" data-testid="ecole-paie-reste">{fmt(famReste)}</b></div>}
          <button onClick={encaisser} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ecole-paie-valider">Encaisser et éditer le reçu</button>
        </div>
      </div>)}
      <div className="ec-card p-3 mb-3"><div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Du</label><input type="date" value={fRec.du} onChange={(e) => setFRec({ ...fRec, du: e.target.value })} data-testid="ecole-rec-du" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Au</label><input type="date" value={fRec.au} onChange={(e) => setFRec({ ...fRec, au: e.target.value })} data-testid="ecole-rec-au" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>{V.Famille}</label><select value={fRec.familyId} onChange={(e) => setFRec({ ...fRec, familyId: e.target.value })} className={ecInput} style={ecBorder}><option value="">Toutes</option>{families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Mode</label><select value={fRec.mode} onChange={(e) => setFRec({ ...fRec, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="">Tous</option><option value="caisse">Espèces</option><option value="banque">Banque</option></select></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>État</label><select value={fRec.etat} onChange={(e) => setFRec({ ...fRec, etat: e.target.value })} className={ecInput} style={ecBorder}><option value="">Tous</option><option value="valide">Valides</option><option value="annule">Annulés</option></select></div>
      </div></div>
      <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Reçu</th><th>Date</th><th>{V.Famille}</th><th>Mode</th><th className="text-right">Montant</th><th>État</th><th></th></tr></thead>
        <tbody>{liste.map((r) => (
          <tr key={r.id} style={{ borderTop: "1px solid #EEE9DA", opacity: r.status === "annulé" ? 0.55 : 1 }} data-testid="ecole-recu-ligne"><td className="py-1.5 tabular text-xs">{r.number}</td><td>{ecDateFr(r.date)}</td><td>{famName(r.familyId)}</td><td className="text-xs">{nomMode(r.mode)}</td><td className="text-right tabular">{fmt(r.amount)}</td><td>{r.status === "annulé" ? ecPastille("Annulé", "neutre") : ecPastille("Valide", "ok")}</td>
            <td className="text-right whitespace-nowrap"><button onClick={() => setPrintRec(r)} className="text-xs underline mr-3" data-testid="ecole-recu-voir">Voir / imprimer</button>{canEdit && r.status !== "annulé" && <button onClick={() => annulerRecu(r)} className="text-xs" style={{ color: "#A6432F" }} data-testid="ecole-recu-annuler">Annuler</button>}</td></tr>))}
          {liste.length > 0 && totalRow([<td key="a" className="py-1.5" colSpan={4}>Total ({valides.length} reçu(s) valide(s)) — espèces {fmt(somme((r) => r.mode !== "banque"))} · banque {fmt(somme((r) => r.mode === "banque"))}</td>, <td key="b" className="text-right tabular" data-testid="ecole-rec-total-montant">{fmt(somme(() => true))}</td>, <td key="c" colSpan={2}></td>], "ecole-rec-total")}</tbody></table></div>
      {receipts.length === 0 && <div className="text-sm mt-2" style={{ color: "#8A8370" }}>Aucun encaissement.</div>}
    </div>
    );
  };

  const ticket = fmtRecu === "ticket80" || fmtRecu === "ticket58";
  const RecuSheet = ({ r }) => {
    const fam = families.find((f) => f.id === r.familyId) || {};
    const lignes = (r.allocations || []).map((a) => { const c = charges.find((x) => x.id === a.chargeId) || {}; return { label: stuName(c.studentId) + " — " + (c.label || ""), amount: a.amount }; });
    const resteApres = ecR2(charges.filter((c) => c.familyId === r.familyId && c.status !== "annulée").reduce((s, c) => s + ecReste(c), 0));
    return (
      <div style={{ color: "#152238", background: "#fff", fontFamily: ticket ? "'IBM Plex Mono', monospace" : "'Inter', sans-serif", fontSize: ticket ? 10 : 13, width: ticket ? (fmtRecu === "ticket80" ? "74mm" : "52mm") : "100%", maxWidth: ticket ? "100%" : 794, margin: "0 auto", padding: ticket ? "12px 8px" : "32px 36px", boxSizing: "border-box" }} data-testid="ecole-recu-feuille">
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          {settings.companyLogo && <img src={settings.companyLogo} alt="" style={{ width: ticket ? 48 : 60, height: ticket ? 48 : 60, objectFit: "contain", margin: "0 auto 6px", display: "block" }} />}
          <div style={{ fontWeight: 700, fontSize: ticket ? 12 : 20 }}>{settings.companyName || V.etabTitre}</div>
          {settings.companyAddress && <div style={{ fontSize: ticket ? 9 : 12 }}>{settings.companyAddress}</div>}
          {settings.companyPhone && <div style={{ fontSize: ticket ? 9 : 12 }}>{settings.companyPhone}</div>}
          {settings.companyNIF && <div style={{ fontSize: ticket ? 9 : 12 }}>NIF : {settings.companyNIF}</div>}
        </div>
        <div style={{ fontWeight: 700, fontSize: ticket ? 12 : 18, textAlign: "center", marginBottom: 10 }}>REÇU DE PAIEMENT{r.status === "annulé" ? " — ANNULÉ" : ""}</div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><span>N° <b>{r.number}</b></span><span>{ecDateFr(r.date)}</span></div>
        <div style={{ marginBottom: 10, lineHeight: 1.6 }}>Reçu de : <b>{r.payer || fam.name}</b><br />{V.Famille} : {fam.name}{fam.phone ? <><br />Tél. : {fam.phone}</> : null}</div>
        <div style={{ borderTop: "1px dashed #152238", borderBottom: "1px dashed #152238", padding: "8px 0", marginBottom: 8 }}>
          {lignes.map((l, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0" }}><span>{l.label}</span><span className="tabular">{fmt(l.amount)}</span></div>)}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: ticket ? 14 : 18 }}><span>Montant reçu</span><span className="tabular">{fmt(r.amount)}</span></div>
        <div style={{ marginTop: 6 }}>Mode : {r.mode === "banque" ? "Banque" : "Espèces"}</div>
        <div style={{ marginTop: 4 }}>Reste à payer par {V.famDet} : <span className="tabular">{fmt(resteApres)}</span></div>
        <div style={{ marginTop: 14, textAlign: "center", fontSize: ticket ? 9 : 12 }}>Merci de votre confiance !</div>
      </div>
    );
  };

  const ReleveSheet = ({ fid }) => {
    const fam = families.find((f) => f.id === fid) || {};
    const cs = charges.filter((c) => c.familyId === fid && c.status !== "annulée").sort((a, b) => String(a.studentId).localeCompare(String(b.studentId)) || String(a.yearId).localeCompare(String(b.yearId)) || String(a.dueDate).localeCompare(String(b.dueDate)));
    const groupes = []; cs.forEach((c) => { const k = c.studentId + "|" + c.yearId; let g = groupes.find((x) => x.k === k); if (!g) { g = { k, sid: c.studentId, yid: c.yearId, rows: [] }; groupes.push(g); } g.rows.push(c); });
    const rc = receipts.filter((r) => r.familyId === fid && r.status !== "annulé").sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const du = ecR2(cs.reduce((t, c) => t + c.amount, 0)), paye = ecR2(cs.reduce((t, c) => t + (c.paid || 0), 0));
    const w = ticket ? { fs: 10, pad: "12px 8px" } : { fs: 12.5, pad: "32px 36px" };
    return (
      <div style={{ color: "#152238", background: "#fff", fontFamily: ticket ? "'IBM Plex Mono', monospace" : "'Inter', sans-serif", fontSize: w.fs, width: ticket ? (fmtRecu === "ticket80" ? "74mm" : "52mm") : "100%", maxWidth: ticket ? "100%" : 794, margin: "0 auto", padding: w.pad, boxSizing: "border-box" }} data-testid="ecole-releve-feuille">
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          {settings.companyLogo && <img src={settings.companyLogo} alt="" style={{ width: ticket ? 48 : 60, height: ticket ? 48 : 60, objectFit: "contain", margin: "0 auto 6px", display: "block" }} />}
          <div style={{ fontWeight: 700, fontSize: ticket ? 12 : 20 }}>{settings.companyName || V.etabTitre}</div>
          {settings.companyAddress && <div style={{ fontSize: ticket ? 9 : 12 }}>{settings.companyAddress}</div>}
          {settings.companyPhone && <div style={{ fontSize: ticket ? 9 : 12 }}>{settings.companyPhone}</div>}
          {settings.companyNIF && <div style={{ fontSize: ticket ? 9 : 12 }}>NIF : {settings.companyNIF}</div>}
        </div>
        <div style={{ fontWeight: 700, fontSize: ticket ? 12 : 18, textAlign: "center", marginBottom: 8 }}>RELEVÉ DE COMPTE</div>
        <div style={{ marginBottom: 10, lineHeight: 1.6 }}>{V.Famille} : <b>{fam.name}</b>{fam.phone ? " — " + fam.phone : ""}<br />Édité le {ecDateFr(today)}</div>
        {groupes.map((g) => (<div key={g.k} style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 700, borderBottom: "1px solid #152238", paddingBottom: 2, marginBottom: 3 }}>{stuName(g.sid)} — {className((students.find((x) => x.id === g.sid) || {}).classId)}{(years.find((y) => y.id === g.yid) || {}).label ? " — " + years.find((y) => y.id === g.yid).label : ""}</div>
          {g.rows.map((c) => (<div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0" }}><span>{c.label} ({ecDateFr(c.dueDate)})</span><span className="tabular">{fmt(c.amount)} · payé {fmt(c.paid || 0)} · reste {fmt(ecReste(c))}</span></div>))}
        </div>))}
        {groupes.length === 0 && <div style={{ marginBottom: 10 }}>Aucun frais enregistré pour {V.famDet}.</div>}
        {rc.length > 0 && (<div style={{ marginBottom: 10 }}><div style={{ fontWeight: 700, marginBottom: 3 }}>Paiements reçus</div>{rc.map((r) => (<div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>{ecDateFr(r.date)} — reçu {r.number} ({nomMode(r.mode)})</span><span className="tabular">{fmt(r.amount)}</span></div>))}</div>)}
        <div style={{ borderTop: "1px dashed #152238", paddingTop: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Total des frais</span><span className="tabular">{fmt(du)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Total payé</span><span className="tabular">{fmt(paye)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: ticket ? 13 : 16 }}><span>RESTE À PAYER</span><span className="tabular" data-testid="ecole-releve-reste">{fmt(ecR2(du - paye))}</span></div>
        </div>
      </div>
    );
  };

  return (
    <>
    <div className={"p-4 md:p-8 max-w-6xl" + ((printRec || printRel) ? " no-print" : "")} data-testid="ecoles-module">
      <style>{EC_CSS}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div><div className="display text-2xl" style={{ color: "#152238" }}>Éducation</div><div className="text-xs" style={{ color: "#8A8370" }}>{V.Annees}, {V.Eleves.toLowerCase()}, frais, échéances et reçus{year ? " — année : " + year.label : ""}</div></div>
        {years.length > 1 && (<select value={year ? year.id : ""} onChange={(e) => setYearId(e.target.value)} className="border rounded px-2 py-1.5 text-sm" style={ecBorder} data-testid="ecole-annee-choix">{years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}</select>)}
      </div>
      {secretaire && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#E6F1EE", color: "#0F4F44" }} data-testid="ecole-secretaire">Espace {roleLabel("Vendeur", kind).toLowerCase()} : vous encaissez, consultez les élèves et relancez les impayés. La grille de frais, les classes et l'annulation des reçus sont réservés à la direction.</div>}
      {!canEdit && !secretaire && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }}>Consultation seule : votre rôle ne permet pas de modifier les données de l'école.</div>}
      <div className="ec-tabs">
        {tabs.map(([id, l]) => (<button key={id} onClick={() => setTab(id)} data-testid={"ecole-tab-" + id} className="px-3 py-2 text-sm rounded-lg transition-colors" style={{ background: tab === id ? "#152238" : "transparent", color: tab === id ? "#EFE9DD" : "#6B6552", fontWeight: tab === id ? 600 : 500 }}>{l}</button>))}
      </div>
      {tab === "apercu" && Apercu()}
      {tab === "stats" && Stats()}
      {tab === "annees" && Annees()}
      {tab === "eleves" && Eleves()}
      {tab === "frais" && Frais()}
      {tab === "echeances" && Echeances()}
      {tab === "recus" && Recus()}
      {tab === "cours" && sup && Cours()}
      {tab === "relances" && <EcolesRelances ecole={ecole} setEcole={setEcole} year={year} families={families} students={students} charges={charges} canAct={canCash} today={today} showToast={showToast} logAudit={logAudit} currentUserEmail={currentUserEmail} settings={settings} V={V} kind={kind} />}
      {tab === "remises" && <EcolesRemises ecole={ecole} setEcole={setEcole} year={year} students={students} fees={fees} charges={charges} canEdit={canEdit} accounts={accounts} setAccounts={setAccounts} setEntries={setEntries} settings={settings} showToast={showToast} logAudit={logAudit} currentUserEmail={currentUserEmail} V={V} />}
      {tab === "rapports" && <EcolesRapports year={year} classes={classes} students={students} families={families} charges={charges} receipts={receipts} fees={fees} today={today} showToast={showToast} V={V} />}
      {printRel && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto p-3 md:p-8 no-print" style={{ background: "rgba(21,34,56,0.55)" }} onClick={() => { setPrintRel(null); setFmtOvr(null); }} data-testid="ecole-releve-apercu">
            <div className="w-full" style={{ maxWidth: 860 }} onClick={(e) => e.stopPropagation()}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="text-sm" style={{ color: "#EFE9DD" }}>Relevé de compte — {famName(printRel.familyId)}</div>
                <div className="flex gap-2">
                  <button onClick={() => setFmtOvr(!ticket)} className="px-3 py-1.5 rounded text-sm" style={{ background: "#152238", color: "#EFE9DD" }} data-testid="ecole-releve-format">{ticket ? "Passer en A4" : "Passer en ticket"}</button>
                  <button onClick={() => { try { window.print(); } catch (e) {} }} className="px-3 py-1.5 rounded text-sm" style={ecBtnGold} data-testid="ecole-releve-imprimer">Imprimer / enregistrer en PDF</button>
                  <button onClick={() => { setPrintRel(null); setFmtOvr(null); }} className="px-3 py-1.5 rounded text-sm" style={{ background: "#EFE9DD", color: "#152238" }} data-testid="ecole-releve-fermer">Fermer</button>
                </div>
              </div>
              <div className="rounded shadow-lg overflow-hidden" style={{ background: "#fff" }}>{ReleveSheet({ fid: printRel.familyId })}</div>
            </div>
          </div>
      )}
      {printRec && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto p-3 md:p-8 no-print" style={{ background: "rgba(21,34,56,0.55)" }} onClick={() => { setPrintRec(null); setFmtOvr(null); }} data-testid="ecole-recu-apercu">
            <div className="w-full" style={{ maxWidth: 860 }} onClick={(e) => e.stopPropagation()}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="text-sm" style={{ color: "#EFE9DD" }}>Reçu {printRec.number}</div>
                <div className="flex gap-2">
                  <button onClick={() => setFmtOvr(!ticket)} className="px-3 py-1.5 rounded text-sm" style={{ background: "#152238", color: "#EFE9DD" }} data-testid="ecole-recu-format">{ticket ? "Passer en A4" : "Passer en ticket"}</button>
                  <button onClick={() => { try { window.print(); } catch (e) {} }} className="px-3 py-1.5 rounded text-sm" style={ecBtnGold} data-testid="ecole-recu-imprimer">Imprimer</button>
                  <button onClick={() => { setPrintRec(null); setFmtOvr(null); }} className="px-3 py-1.5 rounded text-sm" style={{ background: "#EFE9DD", color: "#152238" }} data-testid="ecole-recu-fermer">Fermer</button>
                </div>
              </div>
              <div className="rounded shadow-lg overflow-hidden" style={{ background: "#fff" }}><RecuSheet r={printRec} /></div>
            </div>
          </div>
      )}
    </div>
    {printRel && !printRec && <div className={"print-only" + (fmtRecu === "ticket80" ? " ticket-print-80" : fmtRecu === "ticket58" ? " ticket-print-58" : "")}>{ReleveSheet({ fid: printRel.familyId })}</div>}
    {printRec && <div className={"print-only" + (fmtRecu === "ticket80" ? " ticket-print-80" : fmtRecu === "ticket58" ? " ticket-print-58" : "")}><RecuSheet r={printRec} /></div>}
    </>
  );
}

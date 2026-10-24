// ═══ MODULE ═══
// @module Ecoles
// @depends fmt, isFutureDate, isLocked, todayStr, uid, useBrouillon, useState
// @exports EcolesModule
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
const ecDateFr = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? m[3] + "/" + m[2] + "/" + m[1] : String(iso || ""); };
const ecReste = (c) => ecR2((Number(c.amount) || 0) - (Number(c.paid) || 0));

// Échéances d'un frais pour un élève (identifiants stables : le même frais n'est jamais appliqué deux fois au même élève).
function ecChargesPourEleve(fee, student) {
  const n = Math.max(1, Math.round(Number(fee.nb) || 1));
  const total = ecR2(fee.amount);
  const part = ecR2(Math.floor((total / n) * 100) / 100);
  const out = [];
  for (let i = 0; i < n; i++) {
    const amount = i === n - 1 ? ecR2(total - part * (n - 1)) : part;
    out.push({
      type: "charge", id: student.id + ":" + fee.id + ":" + (i + 1), studentId: student.id, familyId: student.familyId, yearId: fee.yearId, feeId: fee.id,
      label: n > 1 ? fee.label + " " + (i + 1) + "/" + n : fee.label, amount, dueDate: n > 1 ? ecAddMonths(fee.firstDue, i) : fee.firstDue,
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

function ecAjouterComptes(accounts, setAccounts, codes) {
  const missing = codes.filter((k) => EC_COMPTES[k] && !accounts.some((a) => a.code === k)).map((k) => ({ code: k, name: EC_COMPTES[k].name, type: EC_COMPTES[k].type }));
  if (missing.length) setAccounts((prev) => [...prev, ...missing.filter((m) => !prev.some((a) => a.code === m.code))]);
}

const ecInput = "w-full border rounded px-2 py-1.5 text-sm mt-1";
const ecBorder = { borderColor: "#DDD6C4" };
const ecBtn = { background: "#152238", color: "#EFE9DD" };
const ecBtnGold = { background: "#C9A24B", color: "#152238" };

function EcolesModule({ ecole, setEcole, entries, setEntries, accounts, setAccounts, settings, role, showToast, logAudit }) {
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const [tab, setTab] = useState("apercu");
  const years = ecRows(ecole, "year");
  const classes = ecRows(ecole, "class");
  const families = ecRows(ecole, "family");
  const students = ecRows(ecole, "student");
  const fees = ecRows(ecole, "fee");
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

  const tabs = [["apercu", "Vue d'ensemble"], ["annees", "Années et classes"], ["eleves", "Familles et élèves"], ["frais", "Frais"], ["echeances", "Échéances"], ["recus", "Encaissements"]];

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
    return (
      <div>
        {!year && <div className="p-4 rounded text-sm mb-4" style={{ background: "#FFF6E0", color: "#152238" }} data-testid="ecole-vide">Pour commencer : créez une <b>année scolaire</b> et ses <b>classes</b> (onglet « Années et classes »), puis les <b>familles et élèves</b>, puis la <b>grille de frais</b>.</div>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[["Élèves inscrits", String(students.filter((s) => year && s.yearId === year.id && s.status !== "sorti").length), "ecole-kpi-eleves"], ["Frais attendus", fmt(attendu), "ecole-kpi-attendu"], ["Encaissé", fmt(encaisse), "ecole-kpi-encaisse"], ["Impayés échus", fmt(impayes), "ecole-kpi-impayes"]].map(([l, v, t]) => (
            <div key={t} className="p-3 rounded" style={{ background: "#fff", border: "1px solid #EEE9DA" }}><div className="text-xs" style={{ color: "#8A8370" }}>{l}</div><div className="display text-lg tabular" data-testid={t} style={{ color: "#152238" }}>{v}</div></div>
          ))}
        </div>
        <div className="text-xs mb-3" style={{ color: "#7A7460" }}>Avances reçues sur des échéances à venir (compte 487) : <span className="tabular" data-testid="ecole-kpi-avances">{fmt(avances)}</span> · Échéances échues à constater en comptabilité : <span data-testid="ecole-kpi-aconstater">{aConstater.length}</span></div>
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Familles avec impayés</div>
        {lignes.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucun impayé échu.</div> : (
          <table className="w-full text-sm"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Famille</th><th>Téléphone</th><th>Depuis le</th><th className="text-right">Reste à payer</th></tr></thead>
            <tbody>{lignes.map((l) => { const f = families.find((x) => x.id === l.id) || {}; return (
              <tr key={l.id} style={{ borderTop: "1px solid #EEE9DA" }} data-testid="ecole-impaye-ligne"><td className="py-1.5">{f.name || "—"}</td><td>{f.phone ? <a href={"tel:" + f.phone} style={{ color: "#0F6B5C" }}>{f.phone}</a> : "—"}</td><td>{ecDateFr(l.plusAncien)}</td><td className="text-right tabular">{fmt(l.total)}</td></tr>); })}</tbody></table>
        )}
      </div>
    );
  };

  // ───────── Années et classes ─────────
  const [fy, setFy] = useBrouillon("ecole-annee", { label: "", start: "", end: "" });
  const [fc, setFc] = useBrouillon("ecole-classe", { name: "" });
  const addYear = () => {
    if (!canEdit) return;
    const label = fy.label.trim();
    if (!label) { showToast("Indiquez le nom de l'année scolaire (ex. 2026-2027)."); return; }
    if (years.some((y) => y.label.toLowerCase() === label.toLowerCase())) { showToast("Cette année scolaire existe déjà."); return; }
    const id = ecId();
    setEcole((prev) => [...(prev || []).map((r) => (r.type === "year" ? { ...r, active: false } : r)), { type: "year", id, label, start: fy.start || "", end: fy.end || "", active: true }]);
    setYearId(id); setFy({ label: "", start: "", end: "" });
    showToast("Année scolaire créée et activée."); logAudit("Écoles", "Année scolaire créée", label);
  };
  const setActiveYear = (id) => { setEcole((prev) => (prev || []).map((r) => (r.type === "year" ? { ...r, active: r.id === id } : r))); setYearId(id); };
  const addClass = () => {
    if (!canEdit) return;
    if (!year) { showToast("Créez d'abord une année scolaire."); return; }
    const name = fc.name.trim();
    if (!name) { showToast("Indiquez le nom de la classe."); return; }
    if (classes.some((c) => c.yearId === year.id && c.name.toLowerCase() === name.toLowerCase())) { showToast("Cette classe existe déjà pour cette année."); return; }
    setEcole((prev) => [...(prev || []), { type: "class", id: ecId(), yearId: year.id, name }]);
    setFc({ name: "" }); showToast("Classe ajoutée."); logAudit("Écoles", "Classe ajoutée", name);
  };
  const delClass = (c) => {
    if (!canEdit) return;
    if (students.some((s) => s.classId === c.id)) { showToast("Cette classe contient des élèves : déplacez-les d'abord."); return; }
    setEcole((prev) => (prev || []).filter((r) => r.id !== c.id));
  };
  const Annees = () => (
    <div>
      <div className="display text-base mb-2" style={{ color: "#152238" }}>Années scolaires</div>
      <div className="space-y-1 mb-3">{years.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucune année scolaire.</div>}
        {years.map((y) => (
          <div key={y.id} className="flex items-center gap-2 text-sm p-2 rounded" style={{ background: y.id === (year && year.id) ? "#E6F1EE" : "#fff", border: "1px solid #EEE9DA" }} data-testid="ecole-annee-ligne">
            <span className="flex-1"><b>{y.label}</b>{y.start ? " — du " + ecDateFr(y.start) : ""}{y.end ? " au " + ecDateFr(y.end) : ""}{y.active ? " (année active)" : ""}</span>
            {y.id !== (year && year.id) && <button onClick={() => setYearId(y.id)} className="text-xs underline">Voir</button>}
            {canEdit && !y.active && <button onClick={() => setActiveYear(y.id)} className="text-xs underline">Activer</button>}
          </div>))}
      </div>
      {canEdit && (<div className="grid md:grid-cols-4 gap-2 mb-6 items-end">
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Nom de l'année</label><input value={fy.label} onChange={(e) => setFy({ ...fy, label: e.target.value })} placeholder="2026-2027" data-testid="ecole-annee-nom" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Début</label><input type="date" value={fy.start} onChange={(e) => setFy({ ...fy, start: e.target.value })} className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Fin</label><input type="date" value={fy.end} onChange={(e) => setFy({ ...fy, end: e.target.value })} className={ecInput} style={ecBorder} /></div>
        <button onClick={addYear} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ecole-annee-ajouter">Créer l'année</button>
      </div>)}
      <div className="display text-base mb-2" style={{ color: "#152238" }}>Classes{year ? " — " + year.label : ""}</div>
      <div className="flex flex-wrap gap-2 mb-3">{year && classes.filter((c) => c.yearId === year.id).map((c) => (
        <span key={c.id} className="text-sm px-2.5 py-1 rounded" style={{ background: "#fff", border: "1px solid #DDD6C4" }} data-testid="ecole-classe-ligne">{c.name} <span className="text-xs" style={{ color: "#8A8370" }}>({students.filter((s) => s.classId === c.id && s.status !== "sorti").length})</span>
          {canEdit && <button onClick={() => delClass(c)} className="ml-2 text-xs" style={{ color: "#A6432F" }} aria-label="Supprimer la classe">×</button>}</span>))}
        {year && classes.filter((c) => c.yearId === year.id).length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucune classe pour cette année.</div>}
      </div>
      {canEdit && year && (<div className="flex gap-2 items-end max-w-md"><div className="flex-1"><label className="text-xs" style={{ color: "#8A8370" }}>Nouvelle classe</label><input value={fc.name} onChange={(e) => setFc({ name: e.target.value })} placeholder="Ex. 6e année fondamentale A" data-testid="ecole-classe-nom" className={ecInput} style={ecBorder} /></div>
        <button onClick={addClass} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ecole-classe-ajouter">Ajouter</button></div>)}
    </div>
  );

  // ───────── Familles et élèves ─────────
  const [ff, setFf] = useBrouillon("ecole-famille", { name: "", phone: "", email: "", address: "" });
  const [fs, setFs] = useBrouillon("ecole-eleve", { firstName: "", lastName: "", familyId: "", classId: "" });
  const addFamily = () => {
    if (!canEdit) return;
    const name = ff.name.trim().replace(/\s+/g, " ");
    if (!name) { showToast("Indiquez le nom de la famille ou du responsable."); return; }
    if (families.some((f) => f.name.toLowerCase() === name.toLowerCase())) { showToast("Cette famille existe déjà."); return; }
    const id = ecId();
    setEcole((prev) => [...(prev || []), { type: "family", id, name, phone: ff.phone.trim(), email: ff.email.trim(), address: ff.address.trim() }]);
    setFf({ name: "", phone: "", email: "", address: "" }); setFs({ ...fs, familyId: id });
    showToast("Famille ajoutée."); logAudit("Écoles", "Famille ajoutée", name);
  };
  const nextMatricule = () => {
    const yy = (year && year.label ? year.label.slice(0, 4) : String(new Date().getFullYear()));
    const n = students.filter((s) => String(s.matricule || "").startsWith(yy + "-")).length + 1;
    return yy + "-" + String(n).padStart(4, "0");
  };
  const addStudent = () => {
    if (!canEdit) return;
    if (!year) { showToast("Créez d'abord une année scolaire."); return; }
    const firstName = fs.firstName.trim(), lastName = fs.lastName.trim();
    if (!lastName) { showToast("Indiquez le nom de l'élève."); return; }
    if (!fs.familyId || !families.some((f) => f.id === fs.familyId)) { showToast("Choisissez la famille de l'élève."); return; }
    if (!fs.classId || !classes.some((c) => c.id === fs.classId)) { showToast("Choisissez la classe de l'élève."); return; }
    const st = { type: "student", id: ecId(), matricule: nextMatricule(), firstName, lastName, familyId: fs.familyId, yearId: year.id, classId: fs.classId, status: "actif" };
    // les frais de l'année prévus pour cette classe sont appliqués tout de suite
    const mesFrais = fees.filter((f) => f.yearId === year.id && (!f.classIds || f.classIds.length === 0 || f.classIds.includes(st.classId)));
    const nouvelles = mesFrais.flatMap((f) => ecChargesPourEleve(f, st));
    setEcole((prev) => [...(prev || []), st, ...nouvelles]);
    setFs({ firstName: "", lastName: "", familyId: fs.familyId, classId: fs.classId });
    showToast("Élève inscrit" + (nouvelles.length ? " — " + nouvelles.length + " échéance(s) de frais créée(s)." : "."));
    logAudit("Écoles", "Élève inscrit", (firstName + " " + lastName).trim() + " — " + st.matricule);
  };
  const changeClass = (s, classId) => {
    if (!canEdit || !classId || classId === s.classId) return;
    setEcole((prev) => (prev || []).map((r) => (r.id === s.id ? { ...r, classId } : r)));
    showToast("Classe modifiée. Les frais déjà appliqués ne changent pas ; utilisez « Appliquer les frais » (onglet Frais) pour ajouter ceux de la nouvelle classe.");
  };
  const sortirEleve = (s) => { if (!canEdit) return; setEcole((prev) => (prev || []).map((r) => (r.id === s.id ? { ...r, status: s.status === "sorti" ? "actif" : "sorti" } : r))); };
  const Eleves = () => (
    <div>
      <div className="display text-base mb-2" style={{ color: "#152238" }}>Familles</div>
      {canEdit && (<div className="grid md:grid-cols-5 gap-2 mb-3 items-end">
        <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Famille ou responsable</label><input value={ff.name} onChange={(e) => setFf({ ...ff, name: e.target.value })} data-testid="ecole-famille-nom" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Téléphone</label><input type="tel" value={ff.phone} onChange={(e) => setFf({ ...ff, phone: e.target.value })} data-testid="ecole-famille-tel" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>E-mail</label><input value={ff.email} onChange={(e) => setFf({ ...ff, email: e.target.value })} className={ecInput} style={ecBorder} /></div>
        <button onClick={addFamily} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ecole-famille-ajouter">Ajouter la famille</button>
      </div>)}
      <div className="text-xs mb-5" style={{ color: "#7A7460" }}>{families.length} famille(s) : {families.slice(0, 12).map((f) => f.name).join(", ")}{families.length > 12 ? "…" : ""}</div>
      <div className="display text-base mb-2" style={{ color: "#152238" }}>Élèves{year ? " — " + year.label : ""}</div>
      {canEdit && (<div className="grid md:grid-cols-5 gap-2 mb-3 items-end">
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Prénom</label><input value={fs.firstName} onChange={(e) => setFs({ ...fs, firstName: e.target.value })} data-testid="ecole-eleve-prenom" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Nom</label><input value={fs.lastName} onChange={(e) => setFs({ ...fs, lastName: e.target.value })} data-testid="ecole-eleve-nom" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Famille</label><select value={fs.familyId} onChange={(e) => setFs({ ...fs, familyId: e.target.value })} data-testid="ecole-eleve-famille" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Classe</label><select value={fs.classId} onChange={(e) => setFs({ ...fs, classId: e.target.value })} data-testid="ecole-eleve-classe" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{year && classes.filter((c) => c.yearId === year.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <button onClick={addStudent} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ecole-eleve-ajouter">Inscrire l'élève</button>
      </div>)}
      <table className="w-full text-sm"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Matricule</th><th>Élève</th><th>Famille</th><th>Classe</th><th className="text-right">Reste à payer</th><th></th></tr></thead>
        <tbody>{students.filter((s) => year && s.yearId === year.id).map((s) => {
          const reste = ecR2(charges.filter((c) => c.studentId === s.id && c.status !== "annulée").reduce((t, c) => t + ecReste(c), 0));
          return (<tr key={s.id} style={{ borderTop: "1px solid #EEE9DA", opacity: s.status === "sorti" ? 0.55 : 1 }} data-testid="ecole-eleve-ligne">
            <td className="py-1.5 tabular text-xs">{s.matricule}</td><td>{(s.firstName + " " + s.lastName).trim()}{s.status === "sorti" ? " (sorti)" : ""}</td><td>{famName(s.familyId)}</td>
            <td>{canEdit ? <select value={s.classId} onChange={(e) => changeClass(s, e.target.value)} className="border rounded px-1 py-0.5 text-xs" style={ecBorder}>{classes.filter((c) => c.yearId === s.yearId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select> : className(s.classId)}</td>
            <td className="text-right tabular">{fmt(reste)}</td><td className="text-right">{canEdit && <button onClick={() => sortirEleve(s)} className="text-xs underline">{s.status === "sorti" ? "Réintégrer" : "Marquer sorti"}</button>}</td></tr>);
        })}</tbody></table>
      {year && students.filter((s) => s.yearId === year.id).length === 0 && <div className="text-sm mt-2" style={{ color: "#8A8370" }}>Aucun élève pour cette année.</div>}
    </div>
  );

  // ───────── Frais ─────────
  const [fe, setFe] = useBrouillon("ecole-frais", { label: "", amount: "", nb: "1", firstDue: "", account: "7061", classIds: [], tca: false });
  const addFee = () => {
    if (!canEdit) return;
    if (!year) { showToast("Créez d'abord une année scolaire."); return; }
    const amount = Number(fe.amount), nb = Math.round(Number(fe.nb));
    if (!fe.label.trim()) { showToast("Indiquez le nom du frais (ex. Écolage, Inscription)."); return; }
    if (!(amount > 0)) { showToast("Indiquez un montant supérieur à zéro."); return; }
    if (!(nb >= 1 && nb <= 12)) { showToast("Le nombre d'échéances doit être entre 1 et 12."); return; }
    if (!fe.firstDue) { showToast("Indiquez la date de la première échéance."); return; }
    const taux = fe.tca ? Number(settings.taxRate) || 0 : 0;
    setEcole((prev) => [...(prev || []), { type: "fee", id: ecId(), yearId: year.id, label: fe.label.trim(), amount: ecR2(amount), nb, firstDue: fe.firstDue, account: fe.account, classIds: (fe.classIds || []).slice(), tcaRate: taux }]);
    setFe({ label: "", amount: "", nb: "1", firstDue: fe.firstDue, account: fe.account, classIds: [], tca: false });
    showToast("Frais ajouté. Utilisez « Appliquer les frais aux élèves » pour créer les échéances."); logAudit("Écoles", "Frais ajouté", fe.label.trim() + " — " + fmt(amount));
  };
  const delFee = (f) => {
    if (!canEdit) return;
    if (charges.some((c) => c.feeId === f.id && c.status !== "annulée")) { showToast("Ce frais a déjà été appliqué à des élèves : il ne peut plus être supprimé."); return; }
    setEcole((prev) => (prev || []).filter((r) => r.id !== f.id));
  };
  const appliquer = () => {
    if (!canEdit || !year) return;
    const existants = new Set(charges.map((c) => c.id));
    const nouvelles = [];
    fees.filter((f) => f.yearId === year.id).forEach((f) => {
      students.filter((s) => s.yearId === year.id && s.status !== "sorti" && (!f.classIds || f.classIds.length === 0 || f.classIds.includes(s.classId))).forEach((s) => {
        ecChargesPourEleve(f, s).forEach((c) => { if (!existants.has(c.id)) nouvelles.push(c); });
      });
    });
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
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant total par élève</label><input type="number" min="0" value={fe.amount} onChange={(e) => setFe({ ...fe, amount: e.target.value })} data-testid="ecole-frais-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Nombre d'échéances</label><input type="number" min="1" max="12" value={fe.nb} onChange={(e) => setFe({ ...fe, nb: e.target.value })} data-testid="ecole-frais-nb" className={ecInput + " tabular"} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>1re échéance</label><input type="date" value={fe.firstDue} onChange={(e) => setFe({ ...fe, firstDue: e.target.value })} data-testid="ecole-frais-date" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Type</label><select value={fe.account} onChange={(e) => setFe({ ...fe, account: e.target.value })} data-testid="ecole-frais-type" className={ecInput} style={ecBorder}>{EC_PRODUITS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      </div>)}
      {canEdit && year && (<div className="flex flex-wrap items-center gap-4 mb-4 text-sm">
        <span className="text-xs" style={{ color: "#8A8370" }}>Classes concernées (aucune cochée = toutes) :</span>
        {classes.filter((c) => c.yearId === year.id).map((c) => <label key={c.id} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={(fe.classIds || []).includes(c.id)} onChange={() => setFe({ ...fe, classIds: (fe.classIds || []).includes(c.id) ? fe.classIds.filter((x) => x !== c.id) : [...(fe.classIds || []), c.id] })} />{c.name}</label>)}
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!fe.tca} onChange={(e) => setFe({ ...fe, tca: e.target.checked })} data-testid="ecole-frais-tca" />Soumis à la TCA</label>
        <button onClick={addFee} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ecole-frais-ajouter">Ajouter ce frais</button>
      </div>)}
      <table className="w-full text-sm mb-4"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Frais</th><th className="text-right">Montant</th><th className="text-right">Échéances</th><th>1re échéance</th><th>Classes</th><th></th></tr></thead>
        <tbody>{year && fees.filter((f) => f.yearId === year.id).map((f) => (
          <tr key={f.id} style={{ borderTop: "1px solid #EEE9DA" }} data-testid="ecole-frais-ligne"><td className="py-1.5">{f.label}{f.tcaRate > 0 ? " (TCA " + f.tcaRate + " %)" : ""}</td><td className="text-right tabular">{fmt(f.amount)}</td><td className="text-right">{f.nb}</td><td>{ecDateFr(f.firstDue)}</td>
            <td className="text-xs">{(f.classIds || []).length ? f.classIds.map(className).join(", ") : "Toutes"}</td><td className="text-right">{canEdit && <button onClick={() => delFee(f)} className="text-xs" style={{ color: "#A6432F" }}>Supprimer</button>}</td></tr>))}</tbody></table>
      {canEdit && year && <button onClick={appliquer} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ecole-appliquer">Appliquer les frais aux élèves</button>}
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
    const list = yCharges.slice().sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || String(a.id).localeCompare(String(b.id)));
    return (
      <div>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="text-sm" style={{ color: "#152238" }}><span data-testid="ecole-nb-echeances">{list.length}</span> échéance(s){year ? " — " + year.label : ""} · à constater : <b data-testid="ecole-nb-aconstater">{aConstater.length}</b></div>
          {canEdit && <button onClick={constater} disabled={!aConstater.length} className="px-3 py-1.5 rounded text-sm" style={{ ...ecBtnGold, opacity: aConstater.length ? 1 : 0.5 }} data-testid="ecole-constater">Constater les échéances échues</button>}
        </div>
        <div className="text-xs mb-3" style={{ color: "#7A7460" }}>Constater, c'est inscrire en comptabilité les frais devenus exigibles (Familles / Produit). Une avance déjà reçue est alors transformée en produit.</div>
        <table className="w-full text-sm"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Échéance</th><th>Élève</th><th>Frais</th><th className="text-right">Montant</th><th className="text-right">Payé</th><th>État</th></tr></thead>
          <tbody>{list.map((c) => {
            const reste = ecReste(c);
            const etat = reste <= 0 ? "Soldée" : c.dueDate <= today ? (c.paid > 0 ? "Partiellement payée — échue" : "Échue, impayée") : (c.advance > 0 ? "Avance reçue" : "À venir");
            return (<tr key={c.id} style={{ borderTop: "1px solid #EEE9DA" }} data-testid="ecole-echeance-ligne"><td className="py-1.5">{ecDateFr(c.dueDate)}</td><td>{stuName(c.studentId)}</td><td>{c.label}</td><td className="text-right tabular">{fmt(c.amount)}</td><td className="text-right tabular">{fmt(c.paid || 0)}</td><td className="text-xs" style={{ color: reste <= 0 ? "#0F6B5C" : c.dueDate <= today ? "#A6432F" : "#7A7460" }}>{etat}{c.recognized ? " · constatée" : ""}</td></tr>);
          })}</tbody></table>
      </div>
    );
  };

  const [fp, setFp] = useBrouillon("ecole-paiement", { familyId: "", studentId: "", amount: "", mode: "caisse", date: todayStr(), payer: "" });
  const prochainNumero = () => {
    const yy = String(new Date().getFullYear());
    const n = receipts.filter((r) => String(r.number || "").startsWith("RE-" + yy + "-")).reduce((m, r) => Math.max(m, Number(String(r.number).split("-")[2]) || 0), 0) + 1;
    return "RE-" + yy + "-" + String(n).padStart(4, "0");
  };
  const famCharges = fp.familyId ? charges.filter((c) => c.familyId === fp.familyId && c.status !== "annulée") : [];
  const famReste = ecR2(famCharges.reduce((s, c) => s + ecReste(c), 0));
  const encaisser = () => {
    if (!canEdit) return;
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
    ecAjouterComptes(accounts, setAccounts, codes);
    const fam = families.find((f) => f.id === fp.familyId) || {};
    let recId = null;
    if (recEntry) recId = postEntry(fp.date, "Frais scolaires — échéances échues au " + ecDateFr(fp.date) + " (" + fam.name + ")", recEntry.lines, { kind: "ecole" }).id;
    const lines = [{ account: compte, debit: montant, credit: 0 }];
    if (aSolder > 0) lines.push({ account: "4111", debit: 0, credit: aSolder });
    if (enAvance > 0) lines.push({ account: "487", debit: 0, credit: enAvance });
    const number = prochainNumero();
    const e = postEntry(fp.date, "Encaissement scolarité " + number + " — " + fam.name, lines, { kind: "ecole" });
    const receipt = { type: "receipt", id: ecId(), number, familyId: fp.familyId, studentId: fp.studentId || "", date: fp.date, createdAt: new Date().toISOString(), amount: montant, mode: fp.mode, payer: fp.payer.trim(), allocations: alloc, entryId: e.id, status: "valide" };
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
  const Recus = () => (
    <div>
      {canEdit && (<div className="p-3 rounded mb-5" style={{ background: "#fff", border: "1px solid #EEE9DA" }}>
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvel encaissement</div>
        <div className="grid md:grid-cols-6 gap-2 items-end">
          <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Famille</label><select value={fp.familyId} onChange={(e) => setFp({ ...fp, familyId: e.target.value, studentId: "" })} data-testid="ecole-paie-famille" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Élève (facultatif)</label><select value={fp.studentId} onChange={(e) => setFp({ ...fp, studentId: e.target.value })} data-testid="ecole-paie-eleve" className={ecInput} style={ecBorder}><option value="">Tous</option>{students.filter((s) => s.familyId === fp.familyId).map((s) => <option key={s.id} value={s.id}>{(s.firstName + " " + s.lastName).trim()}</option>)}</select></div>
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
      <table className="w-full text-sm"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Reçu</th><th>Date</th><th>Famille</th><th className="text-right">Montant</th><th>État</th><th></th></tr></thead>
        <tbody>{receipts.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((r) => (
          <tr key={r.id} style={{ borderTop: "1px solid #EEE9DA", opacity: r.status === "annulé" ? 0.55 : 1 }} data-testid="ecole-recu-ligne"><td className="py-1.5 tabular text-xs">{r.number}</td><td>{ecDateFr(r.date)}</td><td>{famName(r.familyId)}</td><td className="text-right tabular">{fmt(r.amount)}</td><td className="text-xs">{r.status === "annulé" ? "Annulé" : "Valide"}</td>
            <td className="text-right"><button onClick={() => setPrintRec(r)} className="text-xs underline mr-3" data-testid="ecole-recu-voir">Voir / imprimer</button>{canEdit && r.status !== "annulé" && <button onClick={() => annulerRecu(r)} className="text-xs" style={{ color: "#A6432F" }} data-testid="ecole-recu-annuler">Annuler</button>}</td></tr>))}</tbody></table>
      {receipts.length === 0 && <div className="text-sm mt-2" style={{ color: "#8A8370" }}>Aucun encaissement.</div>}
    </div>
  );

  const ticket = settings.receiptFormat === "ticket80" || settings.receiptFormat === "ticket58";
  const RecuSheet = ({ r }) => {
    const fam = families.find((f) => f.id === r.familyId) || {};
    const lignes = (r.allocations || []).map((a) => { const c = charges.find((x) => x.id === a.chargeId) || {}; return { label: stuName(c.studentId) + " — " + (c.label || ""), amount: a.amount }; });
    const resteApres = ecR2(charges.filter((c) => c.familyId === r.familyId && c.status !== "annulée").reduce((s, c) => s + ecReste(c), 0));
    return (
      <div style={{ color: "#152238", background: "#fff", fontFamily: ticket ? "'IBM Plex Mono', monospace" : "'Inter', sans-serif", fontSize: ticket ? 10 : 13, width: ticket ? (settings.receiptFormat === "ticket80" ? "74mm" : "52mm") : "100%", maxWidth: ticket ? "100%" : 794, margin: "0 auto", padding: ticket ? "12px 8px" : "32px 36px", boxSizing: "border-box" }} data-testid="ecole-recu-feuille">
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          {settings.companyLogo && <img src={settings.companyLogo} alt="" style={{ width: ticket ? 48 : 60, height: ticket ? 48 : 60, objectFit: "contain", margin: "0 auto 6px", display: "block" }} />}
          <div style={{ fontWeight: 700, fontSize: ticket ? 12 : 20 }}>{settings.companyName || "École"}</div>
          {settings.companyAddress && <div style={{ fontSize: ticket ? 9 : 12 }}>{settings.companyAddress}</div>}
          {settings.companyPhone && <div style={{ fontSize: ticket ? 9 : 12 }}>{settings.companyPhone}</div>}
          {settings.companyNIF && <div style={{ fontSize: ticket ? 9 : 12 }}>NIF : {settings.companyNIF}</div>}
        </div>
        <div style={{ fontWeight: 700, fontSize: ticket ? 12 : 18, textAlign: "center", marginBottom: 10 }}>REÇU DE PAIEMENT{r.status === "annulé" ? " — ANNULÉ" : ""}</div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><span>N° <b>{r.number}</b></span><span>{ecDateFr(r.date)}</span></div>
        <div style={{ marginBottom: 10, lineHeight: 1.6 }}>Reçu de : <b>{r.payer || fam.name}</b><br />Famille : {fam.name}{fam.phone ? <><br />Tél. : {fam.phone}</> : null}</div>
        <div style={{ borderTop: "1px dashed #152238", borderBottom: "1px dashed #152238", padding: "8px 0", marginBottom: 8 }}>
          {lignes.map((l, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0" }}><span>{l.label}</span><span className="tabular">{fmt(l.amount)}</span></div>)}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: ticket ? 14 : 18 }}><span>Montant reçu</span><span className="tabular">{fmt(r.amount)}</span></div>
        <div style={{ marginTop: 6 }}>Mode : {r.mode === "banque" ? "Banque" : "Espèces"}</div>
        <div style={{ marginTop: 4 }}>Reste à payer par la famille : <span className="tabular">{fmt(resteApres)}</span></div>
        <div style={{ marginTop: 14, textAlign: "center", fontSize: ticket ? 9 : 12 }}>Merci de votre confiance !</div>
      </div>
    );
  };

  return (
    <>
    <div className={"p-4 md:p-8 max-w-6xl" + (printRec ? " no-print" : "")} data-testid="ecoles-module">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div><div className="display text-2xl" style={{ color: "#152238" }}>Écoles</div><div className="text-xs" style={{ color: "#8A8370" }}>Années scolaires, élèves, frais, échéances et reçus{year ? " — année : " + year.label : ""}</div></div>
        {years.length > 1 && (<select value={year ? year.id : ""} onChange={(e) => setYearId(e.target.value)} className="border rounded px-2 py-1.5 text-sm" style={ecBorder} data-testid="ecole-annee-choix">{years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}</select>)}
      </div>
      {!canEdit && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }}>Consultation seule : votre rôle ne permet pas de modifier les données de l'école.</div>}
      <div className="flex flex-wrap gap-1 mb-5" style={{ borderBottom: "1px solid #E4DFD1" }}>
        {tabs.map(([id, l]) => (<button key={id} onClick={() => setTab(id)} data-testid={"ecole-tab-" + id} className="px-3 py-2 text-sm" style={{ color: tab === id ? "#152238" : "#8A8370", borderBottom: tab === id ? "2px solid #C9A24B" : "2px solid transparent", fontWeight: tab === id ? 600 : 400 }}>{l}</button>))}
      </div>
      {tab === "apercu" && Apercu()}
      {tab === "annees" && Annees()}
      {tab === "eleves" && Eleves()}
      {tab === "frais" && Frais()}
      {tab === "echeances" && Echeances()}
      {tab === "recus" && Recus()}
      {printRec && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto p-3 md:p-8 no-print" style={{ background: "rgba(21,34,56,0.55)" }} onClick={() => setPrintRec(null)} data-testid="ecole-recu-apercu">
            <div className="w-full" style={{ maxWidth: 860 }} onClick={(e) => e.stopPropagation()}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="text-sm" style={{ color: "#EFE9DD" }}>Reçu {printRec.number}</div>
                <div className="flex gap-2">
                  <button onClick={() => { try { window.print(); } catch (e) {} }} className="px-3 py-1.5 rounded text-sm" style={ecBtnGold} data-testid="ecole-recu-imprimer">Imprimer</button>
                  <button onClick={() => setPrintRec(null)} className="px-3 py-1.5 rounded text-sm" style={{ background: "#EFE9DD", color: "#152238" }} data-testid="ecole-recu-fermer">Fermer</button>
                </div>
              </div>
              <div className="rounded shadow-lg overflow-hidden" style={{ background: "#fff" }}><RecuSheet r={printRec} /></div>
            </div>
          </div>
      )}
    </div>
    {printRec && <div className={"print-only" + (settings.receiptFormat === "ticket80" ? " ticket-print-80" : settings.receiptFormat === "ticket58" ? " ticket-print-58" : "")}><RecuSheet r={printRec} /></div>}
    </>
  );
}

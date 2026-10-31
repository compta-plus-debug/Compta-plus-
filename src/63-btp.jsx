// ═══ MODULE ═══
// @module Btp
// @depends EC_CSS, Plus, StatsBloc, ecBorder, ecBtn, ecBtnGold, ecDateFr, ecInput, ecPastille
//   ecTelecharger, fmt, isFutureDate, isLocked, statMois, statSomme, todayStr, uid, useBrouillon
//   useEffect, useState
// @exports BtpModule
// ═══ FIN DE L'EN-TÊTE ═══
// Bloc BTP et construction : clients (maîtres d'ouvrage), chantiers avec bordereau de prix (devis imprimable), avances de démarrage,
// situations de travaux (décomptes) avec retenue de garantie et récupération de l'avance, encaissements, libération de la retenue,
// dépenses par chantier (matériaux, main-d'œuvre, sous-traitance, engins, transport, autres) avec règlement des dettes,
// rapports de rentabilité par chantier, statistiques.
// Rien n'est préréglé : prix, quantités, pourcentage de retenue, budget, dates et taxe sont saisis par l'entreprise.
//
// Comptabilité (tout en gourdes) :
//  • situation de travaux : Débit 411 (net à payer), 4117 (retenue de garantie), 4191 (avance récupérée) /
//    Crédit 706 (travaux facturés, hors taxe) et 445 (taxe, seulement si activée) ;
//  • avance de démarrage reçue : Débit caisse ou banque / Crédit 4191 ;
//  • encaissement d'une situation : Débit caisse ou banque / Crédit 411 ;
//  • retenue de garantie libérée : Débit caisse ou banque / Crédit 4117 ;
//  • dépense : Débit 601 matériaux, 661 main-d'œuvre, 611 sous-traitance, 622 engins et matériel loué, 618 transport, 628 autres /
//    Crédit caisse, banque ou 401 (à payer) ; règlement d'une dette : Débit 401 / Crédit caisse ou banque ;
//  • toute annulation passe une écriture inverse.
// Les comptes 706, 4117, 4191, 601, 661, 611, 622, 618 et 628 sont à confirmer avec l'expert-comptable.

const BT_DEPENSES = [["materiaux", "Matériaux", "601"], ["maindoeuvre", "Main-d'œuvre (ouvriers, journaliers)", "661"], ["soustraitance", "Sous-traitance", "611"], ["engins", "Location d'engins et de matériel", "622"], ["transport", "Transport", "618"], ["autre", "Autres frais de chantier", "628"]];
const BT_ETATS = [["preparation", "En préparation"], ["encours", "En cours"], ["suspendu", "Suspendu"], ["termine", "Terminé"]];
const BT_COMPTES = {
  "411": { name: "Clients", type: "Actif" },
  "4117": { name: "Clients — retenues de garantie", type: "Actif" },
  "4191": { name: "Clients — avances et acomptes reçus", type: "Passif" },
  "401": { name: "Fournisseurs", type: "Passif" },
  "445": { name: "Taxe collectée sur ventes (IVA/TCA)", type: "Passif" },
  "706": { name: "Travaux et prestations de services", type: "Produit" },
  "601": { name: "Achats de matériaux de chantier", type: "Charge" },
  "661": { name: "Main-d'œuvre de chantier", type: "Charge" },
  "611": { name: "Sous-traitance générale", type: "Charge" },
  "622": { name: "Locations d'engins et de matériel", type: "Charge" },
  "618": { name: "Transports de chantier", type: "Charge" },
  "628": { name: "Autres frais de chantier", type: "Charge" },
  "512": { name: "Banque", type: "Actif" },
  "530": { name: "Caisse", type: "Actif" },
};
const btR2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const btQ = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const btId = () => String(uid());
const btRows = (rows, type) => (rows || []).filter((r) => r && r.type === type);
const btJours = (a, b) => (a && b ? Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000) : 0);
const btNom = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const btUniq = (arr) => Array.from(new Set(arr.map((x) => String(x || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
const btMarche = (s) => btR2(((s && s.lines) || []).reduce((t, l) => t + (Number(l.qty) || 0) * (Number(l.pu) || 0), 0));
function btAjouterComptes(accounts, setAccounts, codes) {
  const missing = [...new Set(codes)].filter((k) => BT_COMPTES[k] && !accounts.some((a) => a.code === k)).map((k) => ({ code: k, name: BT_COMPTES[k].name, type: BT_COMPTES[k].type }));
  if (missing.length) setAccounts((prev) => [...prev, ...missing.filter((m) => !prev.some((a) => a.code === m.code))]);
}
// Solde d'une situation : le net à payer moins les encaissements valides
function btSolde(s) {
  const paye = btR2((s.payments || []).filter((p) => p.status !== "annulé").reduce((t, p) => t + p.amount, 0));
  return { paye, reste: btR2((s.net || 0) - paye) };
}
function btResteDep(d) {
  if (d.status === "annulé" || d.mode !== "apayer") return 0;
  return btR2(d.amount - (d.settlements || []).filter((x) => x.status !== "annulé").reduce((t, x) => t + x.amount, 0));
}

// Case de saisie avec flèche déroulante : choisit dans la liste (si elle existe) ou permet de taper librement.
function BtFleche({ id, onPick }) {
  const [opts, setOpts] = useState([]);
  useEffect(() => {
    const el = document.getElementById(id);
    const n = el ? Array.from(el.options).map((o) => o.value) : [];
    if (n.join("|") !== opts.join("|")) setOpts(n);
  });
  return (
    <select value="" onChange={(e) => { if (e.target.value) onPick(e.target.value); }} aria-label="Choisir dans la liste" title="Choisir dans la liste" data-testid={"bt-fleche-" + id.replace("bt-dl-", "")}
      className="border rounded text-sm" style={{ borderColor: "#DDD6C4", width: 44, flex: "none", background: "#fff", color: "#152238" }}>
      <option value="">▾</option>
      {opts.length === 0 ? <option value="" disabled>Aucune suggestion pour l'instant : tapez le texte</option> : opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
// Case numérique ou date enregistrée quand on la quitte (ou à la touche Entrée), avec confirmation.
function BtChamp({ value, onCommit, onSaved, ...rest }) {
  const ext = value === undefined || value === null ? "" : String(value);
  const [v, setV] = useState(ext);
  useEffect(() => { setV(ext); }, [ext]);
  const fin = () => { if (v !== ext) { onCommit(v); if (onSaved) onSaved(); } };
  return <input {...rest} value={v} onChange={(e) => setV(e.target.value)} onBlur={fin} onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }} />;
}

// Zone de texte enregistrée quand on la quitte.
function BtTexte({ value, onCommit, onSaved, ...rest }) {
  const ext = value === undefined || value === null ? "" : String(value);
  const [v, setV] = useState(ext);
  useEffect(() => { setV(ext); }, [ext]);
  return <textarea {...rest} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== ext) { onCommit(v); if (onSaved) onSaved(); } }} />;
}
const BT_METEO = ["Ensoleillé", "Nuageux", "Pluie légère", "Forte pluie", "Vent fort"];
// Journal de chantier d'un jour : formulaire avec son propre brouillon (remis à zéro à chaque changement de jour).
function BtJournalForm({ entry, staff, effectif, canEdit, onSave }) {
  const [d, setD] = useState({ weather: (entry && entry.weather) || "", works: (entry && entry.works) || "", incidents: (entry && entry.incidents) || "", visitors: (entry && entry.visitors) || "", materials: (entry && entry.materials) || "", author: (entry && entry.author) || "" });
  const lab = (t) => <label className="text-xs" style={{ color: "#8A8370" }}>{t}</label>;
  return (
    <div className="ec-card p-3 mb-3" data-testid="bt-jr-form">
      <div className="grid md:grid-cols-3 gap-2 items-end">
        <div>{lab("Météo")}<select value={d.weather} onChange={(e) => setD({ ...d, weather: e.target.value })} disabled={!canEdit} data-testid="bt-jr-meteo" className={ecInput} style={ecBorder}><option value="">—</option>{BT_METEO.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
        <div>{lab("Rédigé par")}<select value={d.author} onChange={(e) => setD({ ...d, author: e.target.value })} disabled={!canEdit} data-testid="bt-jr-auteur" className={ecInput} style={ecBorder}><option value="">—</option>{staff.map((m) => <option key={m.id} value={m.name}>{m.name} ({m.role})</option>)}</select></div>
        <div className="text-sm" style={{ color: "#5B563F" }}>Effectif du jour (d'après le pointage) : <b className="tabular" data-testid="bt-jr-effectif">{effectif.total}</b> jour(s)-homme{effectif.noms.length > 0 ? " — " + effectif.noms.join(", ") : ""}</div>
      </div>
      <div className="mt-2">{lab("Travaux exécutés ce jour")}<textarea rows={3} value={d.works} onChange={(e) => setD({ ...d, works: e.target.value })} disabled={!canEdit} data-testid="bt-jr-travaux" className={ecInput} style={ecBorder} /></div>
      <div className="mt-2">{lab("Incidents, arrêts, accidents (le cas échéant)")}<textarea rows={2} value={d.incidents} onChange={(e) => setD({ ...d, incidents: e.target.value })} disabled={!canEdit} data-testid="bt-jr-incidents" className={ecInput} style={ecBorder} /></div>
      <div className="grid md:grid-cols-2 gap-2 mt-2">
        <div>{lab("Visiteurs")}<input value={d.visitors} onChange={(e) => setD({ ...d, visitors: e.target.value })} disabled={!canEdit} data-testid="bt-jr-visiteurs" className={ecInput} style={ecBorder} /></div>
        <div>{lab("Matériaux et matériel reçus")}<input value={d.materials} onChange={(e) => setD({ ...d, materials: e.target.value })} disabled={!canEdit} data-testid="bt-jr-materiaux" className={ecInput} style={ecBorder} /></div>
      </div>
      {canEdit && <div className="mt-3"><button onClick={() => onSave(d)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="bt-jr-enregistrer">Enregistrer le journal du jour</button></div>}
    </div>
  );
}

function BtpModule({ suppliers, btp, setBtp, entries, setEntries, accounts, setAccounts, settings, role, showToast, logAudit, currentUserEmail, employees, setEmployees, payslips }) {
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const isVendeur = role === "Vendeur"; // secrétariat : clients, situations et encaissements
  const canFront = canEdit || isVendeur;
  const today = todayStr();
  const [tab, setTab] = useState("apercu");
  const clients = btRows(btp, "client");
  const sites = btRows(btp, "site");
  const sits = btRows(btp, "sit");
  const deps = btRows(btp, "dep");
  const rels = btRows(btp, "retrel");
  const grades = btRows(btp, "grade");
  const workers = btRows(btp, "worker");
  const pts = btRows(btp, "pt");
  const cfg = btRows(btp, "config")[0] || {};
  const tcaOn = !!cfg.tcaOn;
  const tcaRate = tcaOn ? Number(settings.taxRate) || 0 : 0;
  const nomClient = (id) => (clients.find((x) => x.id === id) || {}).name || "—";
  const nomSite = (id) => (sites.find((x) => x.id === id) || {}).name || "—";
  const compteMode = (m) => (m === "banque" ? "512" : m === "apayer" ? "401" : "530");
  const maj = (id, fn) => setBtp((prev) => (prev || []).map((r) => (r.id === id ? fn(r) : r)));
  const ajouter = (rec) => setBtp((prev) => [...(prev || []), rec]);
  const ecrire = (date, label, lines, dossierId) => {
    const e = { id: uid(), date, createdAt: new Date().toISOString(), label, lines: lines.filter((l) => l.debit > 0 || l.credit > 0), kind: "btp", dossierId };
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
  // ── Calculs d'un chantier ──
  const sitsDe = (siteId) => sits.filter((x) => x.siteId === siteId && x.status !== "annulee").sort((a, b) => a.n - b.n);
  const derniere = (siteId) => { const l = sitsDe(siteId); return l.length ? l[l.length - 1] : null; };
  const avancesDe = (s) => (s.avances || []).filter((a) => a.status !== "annulé");
  const avanceTotale = (s) => btR2(avancesDe(s).reduce((t, a) => t + a.amount, 0));
  const avanceRecuperee = (siteId) => btR2(sitsDe(siteId).reduce((t, x) => t + (x.recup || 0), 0));
  const retenueDue = (siteId) => btR2(sitsDe(siteId).reduce((t, x) => t + (x.retenue || 0), 0) - rels.filter((r) => r.siteId === siteId && r.status !== "annulé").reduce((t, r) => t + r.amount, 0));
  const factureHt = (siteId) => { const d = derniere(siteId); return d ? d.cumHt : 0; };
  // Salaires versés via le module Salaires, affectés au chantier au prorata des jours pointés dans la période du bulletin
  const salairesAffectes = (siteId) => {
    let tot = 0;
    (payslips || []).forEach((ps) => {
      if (ps.status === "annulé") return;
      const w = workers.find((y) => y.employeeId && String(y.employeeId) === String(ps.employeeId));
      if (!w) return;
      const dans = (p) => p.workerId === w.id && p.date >= ps.periodStart && p.date <= ps.periodEnd;
      const tous = pts.filter(dans).reduce((t, p) => t + (Number(p.units) || 0), 0);
      const ici = pts.filter((p) => dans(p) && p.siteId === siteId).reduce((t, p) => t + (Number(p.units) || 0), 0);
      if (tous <= 0 || ici <= 0) return;
      tot += ((Number(ps.grossTotal) || 0) + (Number(ps.employerTotal) || 0)) * ici / tous;
    });
    return btR2(tot);
  };
  const depensesDe = (siteId) => btR2(deps.filter((d) => d.siteId === siteId && d.status !== "annulé").reduce((t, d) => t + d.amount, 0) + salairesAffectes(siteId));
  const calcSit = (site, cumQty) => {
    const prev = derniere(site.id);
    const prevHt = prev ? prev.cumHt : 0;
    const cumHt = btR2((site.lines || []).reduce((t, l) => t + Math.min(Number(cumQty[l.id]) || 0, l.qty) * l.pu, 0));
    const ht = btR2(cumHt - prevHt);
    const tca = tcaOn ? btR2(ht * tcaRate / 100) : 0;
    const ttc = btR2(ht + tca);
    const retenue = btR2(ht * (Number(site.retPct) || 0) / 100);
    const marche = btMarche(site);
    const avTot = avanceTotale(site), avRest = btR2(avTot - avanceRecuperee(site.id));
    let recup = 0;
    if (avRest > 0 && marche > 0 && ht > 0) recup = cumHt >= marche - 0.004 ? avRest : btR2(avTot * ht / marche);
    recup = btR2(Math.max(0, Math.min(recup, avRest, ttc - retenue)));
    const net = btR2(ttc - retenue - recup);
    return { prevHt, cumHt, ht, tca, ttc, retenue, recup, net };
  };
  const [imprimer, setImprimer] = useState(null); // { kind: "devis" | "situation", id }
  const [selSite, setSelSite] = useState("");
  const [selSit, setSelSit] = useState("");
  const [selDep, setSelDep] = useState("");
  const listes = (<><datalist id="bt-dl-unite">{btUniq(["m²", "m³", "ml", "unité", "kg", "tonne", "forfait", "jour", "heure", ...sites.flatMap((s) => (s.lines || []).map((l) => l.unit))]).map((n) => <option key={n} value={n} />)}</datalist><datalist id="bt-dl-tiers">{btUniq([...(suppliers || []).map((x) => x.name), ...deps.map((d) => d.supplier)]).map((n) => <option key={n} value={n} />)}</datalist><datalist id="bt-dl-role">{btUniq(["Conducteur de travaux", "Chef de chantier", "Ingénieur", "Architecte", "Chef d'équipe", "Topographe", "Magasinier", "Gardien", ...sites.flatMap((x) => (x.staff || []).map((m) => m.role))]).map((n) => <option key={n} value={n} />)}</datalist><datalist id="bt-dl-staff">{btUniq(sites.flatMap((x) => (x.staff || []).map((m) => m.name))).map((n) => <option key={n} value={n} />)}</datalist><datalist id="bt-dl-ligne">{btUniq(sites.flatMap((s) => (s.lines || []).map((l) => l.label))).map((n) => <option key={n} value={n} />)}</datalist></>);

  // ───────── Clients ─────────
  const [fcl, setFcl] = useBrouillon("btp-client", { name: "", phone: "", address: "" });
  const [cq, setCq] = useState("");
  const ajouterClient = () => {
    if (!canFront) return;
    if (!fcl.name.trim()) { showToast("Indiquez le nom du client (maître d'ouvrage)."); return; }
    if (clients.some((c) => btNom(c.name) === btNom(fcl.name))) { showToast("Un client de ce nom existe déjà."); return; }
    ajouter({ type: "client", id: btId(), name: fcl.name.trim(), phone: fcl.phone.trim(), address: fcl.address.trim() });
    setFcl({ name: "", phone: "", address: "" }); showToast("Client ajouté.");
  };
  const resteClient = (id) => btR2(sits.filter((x) => x.clientId === id && x.status !== "annulee").reduce((t, x) => t + btSolde(x).reste, 0));
  const Clients = () => {
    const cF = clients.filter((c) => !cq.trim() || [c.name, c.phone, c.address].join(" ").toLowerCase().includes(cq.trim().toLowerCase()));
    return (
      <div>
        {canFront && (<div className="ec-card p-4 mb-5"><div className="grid md:grid-cols-4 gap-2 items-end">
          <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom du client (maître d'ouvrage)</label><input value={fcl.name} onChange={(e) => setFcl({ ...fcl, name: e.target.value })} data-testid="bt-client-nom" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Téléphone</label><input type="tel" value={fcl.phone} onChange={(e) => setFcl({ ...fcl, phone: e.target.value })} className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Adresse</label><input value={fcl.address} onChange={(e) => setFcl({ ...fcl, address: e.target.value })} className={ecInput} style={ecBorder} /></div>
        </div><button onClick={ajouterClient} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="bt-client-ajouter">Ajouter le client</button></div>)}
        <div className="mb-2"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (nom, téléphone, adresse)</label><input value={cq} onChange={(e) => setCq(e.target.value)} data-testid="bt-client-recherche" className={ecInput} style={{ ...ecBorder, maxWidth: 360 }} /></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Client</th><th>Téléphone</th><th>Adresse</th><th className="text-right">Chantiers</th><th className="text-right">Reste à payer</th></tr></thead>
          <tbody>{cF.map((c) => (<tr key={c.id} data-testid="bt-client-ligne"><td className="py-1.5">{c.name}</td><td>{c.phone || "—"}</td><td className="text-xs">{c.address || "—"}</td><td className="text-right tabular">{sites.filter((s) => s.clientId === c.id).length}</td><td className="text-right tabular">{fmt(resteClient(c.id))}</td></tr>))}</tbody>
          {cF.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="bt-client-total-ligne"><td colSpan={4}>Total ({cF.length})</td><td className="text-right tabular" data-testid="bt-client-tot-reste">{fmt(btR2(cF.reduce((t, c) => t + resteClient(c.id), 0)))}</td></tr></tfoot>}</table></div>
        {cF.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{clients.length === 0 ? "Aucun client." : "Aucun résultat."}</div>}
      </div>
    );
  };

  // ───────── Chantiers ─────────
  const [fs, setFs] = useBrouillon("btp-chantier", { name: "", clientId: "", address: "", start: todayStr(), end: "", retPct: "", budget: "", lead: "" });
  const [sq, setSq] = useState(""); const [sst, setSst] = useState("");
  const [fl, setFl] = useState({ label: "", unit: "", qty: "", pu: "" });
  const [edS, setEdS] = useState(null); // brouillon de modification du dossier de chantier
  const ouvrirModif = (x) => setEdS({ id: x.id, name: x.name, clientId: x.clientId, address: x.address || "", start: x.start || "", end: x.end || "", retPct: x.retPct || "" });
  const enregistrerModif = (x) => {
    if (!canEdit || !edS) return;
    const name = edS.name.trim();
    if (!name) { showToast("Indiquez le nom du chantier."); return; }
    if (!edS.clientId) { showToast("Choisissez le client."); return; }
    if (sites.some((y) => y.id !== x.id && btNom(y.name) === btNom(name))) { showToast("Un autre chantier porte déjà ce nom."); return; }
    if (!edS.start) { showToast("Indiquez la date de début."); return; }
    if (edS.end && edS.end < edS.start) { showToast("La date de fin prévue doit être après le début."); return; }
    const ret = Number(edS.retPct) || 0;
    if (ret < 0 || ret > 30) { showToast("La retenue de garantie doit être comprise entre 0 et 30 %."); return; }
    if (ret !== (Number(x.retPct) || 0) && sitsDe(x.id).length > 0) { showToast("La retenue de garantie ne peut plus changer : des situations de travaux ont déjà été émises."); return; }
    const datees = [...(x.avances || []).map((a) => a.date), ...deps.filter((d) => d.siteId === x.id).map((d) => d.date), ...sits.filter((y) => y.siteId === x.id).map((y) => y.date), ...pts.filter((q) => q.siteId === x.id).map((q) => q.date)].filter(Boolean).sort();
    if (datees.length && edS.start > datees[0]) { showToast("Des opérations de ce chantier sont datées du " + ecDateFr(datees[0]) + " : le début ne peut pas être plus tardif."); return; }
    maj(x.id, (r) => ({ ...r, name, clientId: edS.clientId, address: edS.address.trim(), start: edS.start, end: edS.end, retPct: ret }));
    logAudit("BTP", "Dossier de chantier modifié", x.number + " — " + name);
    showToast("Dossier du chantier enregistré.");
    setEdS(null);
  };
  const majLigne = (s, l, patch) => {
    if (!canEdit) return;
    const verrou = sitsDe(s.id).length > 0;
    if ("label" in patch && !String(patch.label).trim()) { showToast("La désignation ne peut pas être vide."); return; }
    if (("qty" in patch || "pu" in patch) && verrou) { showToast("Quantités et prix ne peuvent plus changer : des situations de travaux ont déjà été émises."); return; }
    if ("qty" in patch && !(patch.qty > 0)) { showToast("La quantité doit être supérieure à zéro."); return; }
    if ("pu" in patch && !(patch.pu >= 0)) { showToast("Le prix unitaire doit être positif ou nul."); return; }
    maj(s.id, (r) => ({ ...r, lines: r.lines.map((x) => (x.id === l.id ? { ...x, ...patch } : x)) }));
  };
  const [fst, setFst] = useState({ name: "", role: "", phone: "" });
  const respDe = (x) => { const st = x.staff || []; const r = st.find((m) => /chef de chantier/i.test(m.role)) || st.find((m) => /conducteur/i.test(m.role)) || st[0]; return r ? r.name : "—"; };
  const ajouterEncadrant = (s) => {
    if (!canEdit) return;
    if (!fst.name.trim()) { showToast("Indiquez le nom de la personne."); return; }
    if (!fst.role.trim()) { showToast("Indiquez sa fonction (conducteur de travaux, chef de chantier, ingénieur…)."); return; }
    if ((s.staff || []).some((m) => btNom(m.name) === btNom(fst.name) && btNom(m.role) === btNom(fst.role))) { showToast("Cette personne est déjà affectée avec cette fonction."); return; }
    maj(s.id, (r) => ({ ...r, staff: [...(r.staff || []), { id: btId(), name: fst.name.trim(), role: fst.role.trim(), phone: fst.phone.trim() }] }));
    setFst({ name: "", role: fst.role, phone: "" }); showToast("Affectation enregistrée.");
  };
  const [fav, setFav] = useState({ amount: "", mode: "caisse", date: todayStr() });
  const [frt, setFrt] = useState({ amount: "", mode: "caisse", date: todayStr() });
  const creerChantier = () => {
    if (!canEdit) return;
    const name = fs.name.trim();
    if (!name) { showToast("Indiquez le nom du chantier."); return; }
    if (!fs.clientId) { showToast("Choisissez le client."); return; }
    if (sites.some((x) => btNom(x.name) === btNom(name))) { showToast("Un chantier de ce nom existe déjà."); return; }
    if (fs.end && fs.start && fs.end < fs.start) { showToast("La date de fin prévue doit être après le début."); return; }
    const ret = Number(fs.retPct) || 0;
    if (ret < 0 || ret > 30) { showToast("La retenue de garantie doit être comprise entre 0 et 30 %."); return; }
    const s = { type: "site", id: btId(), number: numero("CH", sites, fs.start || today), name, clientId: fs.clientId, address: fs.address.trim(), start: fs.start, end: fs.end, retPct: ret, budget: Number(fs.budget) || 0, status: "encours", lines: [], avances: [], staff: fs.lead.trim() ? [{ id: btId(), name: fs.lead.trim(), role: "Chef de chantier", phone: "" }] : [], createdAt: new Date().toISOString(), by: currentUserEmail || "" };
    ajouter(s);
    setFs({ ...fs, name: "", address: "", end: "", retPct: "", budget: "", lead: "" });
    setSelSite(s.id); setSub("marche");
    showToast("Chantier " + s.number + " créé : ajoutez maintenant son bordereau de prix."); logAudit("BTP", "Chantier créé", s.number + " — " + name);
  };
  const ajouterLigne = (s) => {
    if (!canEdit) return;
    const qty = btQ(fl.qty), pu = btR2(fl.pu);
    if (!fl.label.trim()) { showToast("Indiquez la désignation des travaux."); return; }
    if (!(qty > 0)) { showToast("Indiquez la quantité (supérieure à zéro)."); return; }
    if (!(pu >= 0) || fl.pu === "") { showToast("Indiquez le prix unitaire (en gourdes)."); return; }
    maj(s.id, (r) => ({ ...r, lines: [...(r.lines || []), { id: btId(), label: fl.label.trim(), unit: fl.unit.trim(), qty, pu }] }));
    setFl({ label: "", unit: fl.unit, qty: "", pu: "" });
  };
  const retirerLigne = (s, l) => {
    if (!canEdit || sitsDe(s.id).length > 0) return;
    maj(s.id, (r) => ({ ...r, lines: r.lines.filter((x) => x.id !== l.id) }));
  };
  const recevoirAvance = (s) => {
    if (!canEdit) return;
    const amount = btR2(fav.amount);
    if (!(amount > 0)) { showToast("Indiquez le montant de l'avance."); return; }
    if (!verifDate(fav.date, "enregistrer cette avance")) return;
    const cpt = compteMode(fav.mode === "banque" ? "banque" : "caisse");
    btAjouterComptes(accounts, setAccounts, [cpt, "4191"]);
    const e = ecrire(fav.date, "Avance de démarrage — " + s.name + " (" + nomClient(s.clientId) + ")", [{ account: cpt, debit: amount, credit: 0 }, { account: "4191", debit: 0, credit: amount }], s.id);
    maj(s.id, (r) => ({ ...r, avances: [...(r.avances || []), { id: btId(), date: fav.date, amount, mode: fav.mode, entryId: e.id, status: "valide" }] }));
    setFav({ ...fav, amount: "" }); showToast("Avance de " + fmt(amount) + " enregistrée."); logAudit("BTP", "Avance reçue", s.name + " — " + fmt(amount));
  };
  const annulerAvance = (s, a) => {
    if (!canEdit || a.status === "annulé") return;
    if (avanceRecuperee(s.id) > 0) { showToast("Une partie de l'avance est déjà récupérée sur des situations : annulez d'abord ces situations."); return; }
    if (!verifDate(today, "annuler cette avance")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler cette avance ? Une écriture inverse sera passée.")) return;
    const e = contre(a.entryId, "Annulation avance — " + s.name + " (écriture inverse)", today, s.id);
    maj(s.id, (r) => ({ ...r, avances: r.avances.map((x) => (x.id === a.id ? { ...x, status: "annulé", reversalEntryId: e ? e.id : "" } : x)) }));
    showToast("Avance annulée.");
  };
  const liberer = (s) => {
    if (!canEdit) return;
    const blocage = retenueBloquee(s);
    if (blocage) { showToast(blocage); return; }
    const due = retenueDue(s.id);
    const amount = frt.amount === "" ? due : btR2(frt.amount);
    if (!(amount > 0) || amount > due + 0.004) { showToast("Le montant doit être compris entre 0 et la retenue à libérer (" + fmt(due) + ")."); return; }
    if (!verifDate(frt.date, "enregistrer cette libération")) return;
    const cpt = compteMode(frt.mode === "banque" ? "banque" : "caisse");
    btAjouterComptes(accounts, setAccounts, [cpt, "4117"]);
    const e = ecrire(frt.date, "Retenue de garantie encaissée — " + s.name + " (" + nomClient(s.clientId) + ")", [{ account: cpt, debit: amount, credit: 0 }, { account: "4117", debit: 0, credit: amount }], s.id);
    ajouter({ type: "retrel", id: btId(), siteId: s.id, date: frt.date, amount, mode: frt.mode, entryId: e.id, status: "valide" });
    setFrt({ ...frt, amount: "" }); showToast("Retenue de garantie encaissée : " + fmt(amount) + "."); logAudit("BTP", "Retenue libérée", s.name + " — " + fmt(amount));
  };
  const annulerLiberation = (r) => {
    if (!canEdit || r.status === "annulé") return;
    if (!verifDate(today, "annuler cet encaissement")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler cet encaissement de retenue ? Une écriture inverse sera passée.")) return;
    const e = contre(r.entryId, "Annulation encaissement de retenue (écriture inverse)", today, r.siteId);
    maj(r.id, (x) => ({ ...x, status: "annulé", reversalEntryId: e ? e.id : "" }));
    showToast("Encaissement de retenue annulé.");
  };
  const [mosub, setMosub] = useState("grille");
  const [fgr, setFgr] = useState({ label: "", rate: "" });
  const [fpl, setFpl] = useState({ gradeId: "", count: "", days: "" });
  const [fcr, setFcr] = useState({ name: "", gradeId: "", phone: "", start: "", end: "" });
  const [ptDate, setPtDate] = useState(today);
  const [payFrom, setPayFrom] = useState(today.slice(0, 8) + "01");
  const [payTo, setPayTo] = useState(today);
  const nomGrade = (id) => (grades.find((g) => g.id === id) || {}).label || "—";
  const tauxGrade = (id) => Number((grades.find((g) => g.id === id) || {}).rate) || 0;
  const joursOuv = (wid, from, to, siteId) => btR2(pts.filter((p) => p.workerId === wid && (!siteId || p.siteId === siteId) && (!from || p.date >= from) && (!to || p.date <= to)).reduce((t, p) => t + (Number(p.units) || 0), 0));
  const brutOuv = (wid, from, to, siteId) => btR2(pts.filter((p) => p.workerId === wid && (!siteId || p.siteId === siteId) && (!from || p.date >= from) && (!to || p.date <= to)).reduce((t, p) => t + (Number(p.units) || 0) * (Number(p.rate) || 0), 0));
  const coutPointe = (siteId) => btR2(pts.filter((p) => p.siteId === siteId).reduce((t, p) => t + (Number(p.units) || 0) * (Number(p.rate) || 0), 0));
  const planCout = (x) => btR2((x.plan || []).reduce((t, r) => t + (Number(r.count) || 0) * (Number(r.days) || 0) * tauxGrade(r.gradeId), 0));
  const moisDe = (start, end) => { const m = {}; if (!start || !end || end < start) return m; const d = new Date(start + "T12:00:00"), f = new Date(end + "T12:00:00"); let n = 0; while (d <= f && n < 3700) { const k = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); m[k] = (m[k] || 0) + 1; d.setDate(d.getDate() + 1); n++; } return m; };
  const ajouterGrade = () => {
    if (!canEdit) return;
    const label = fgr.label.trim(), rate = Number(fgr.rate);
    if (!label) { showToast("Indiquez la qualification (ex. maçon, manœuvre)."); return; }
    if (!(rate > 0)) { showToast("Le taux journalier doit être supérieur à zéro."); return; }
    if (grades.some((g) => btNom(g.label) === btNom(label))) { showToast("Cette qualification existe déjà."); return; }
    ajouter({ type: "grade", id: btId(), label, rate });
    setFgr({ label: "", rate: "" });
  };
  const retirerGrade = (g) => {
    if (!canEdit) return;
    if (workers.some((w) => w.gradeId === g.id) || sites.some((s) => (s.plan || []).some((r) => r.gradeId === g.id))) { showToast("Cette qualification est utilisée (ouvriers ou plan de main-d'œuvre) : elle ne peut pas être retirée."); return; }
    setBtp((prev) => (prev || []).filter((r) => r.id !== g.id));
  };
  const ajouterPlan = (x) => {
    if (!canEdit) return;
    if (!fpl.gradeId) { showToast("Choisissez la qualification (grille salariale)."); return; }
    if (!(Number(fpl.count) > 0) || !(Number(fpl.days) > 0)) { showToast("Indiquez l'effectif et le nombre de jours par personne."); return; }
    if ((x.plan || []).some((r) => r.gradeId === fpl.gradeId)) { showToast("Cette qualification est déjà dans le plan : modifiez sa ligne."); return; }
    maj(x.id, (r) => ({ ...r, plan: [...(r.plan || []), { id: btId(), gradeId: fpl.gradeId, count: Number(fpl.count), days: Number(fpl.days) }] }));
    setFpl({ gradeId: "", count: "", days: "" });
  };
  const ajouterAffectation = (x) => {
    if (!canEdit) return;
    const nom = fcr.name.trim();
    if (!nom) { showToast("Indiquez le nom de l'ouvrier."); return; }
    if (fcr.end && fcr.start && fcr.end < fcr.start) { showToast("La fin d'affectation doit être après le début."); return; }
    let w = workers.find((y) => btNom(y.name) === btNom(nom));
    if (!w) {
      if (!fcr.gradeId) { showToast("Choisissez la qualification du nouvel ouvrier (grille salariale)."); return; }
      w = { type: "worker", id: btId(), name: nom, gradeId: fcr.gradeId, phone: fcr.phone.trim(), nif: "", employeeId: "", active: true };
      ajouter(w);
    }
    if ((x.crew || []).some((c) => c.workerId === w.id && (!c.end || c.end >= today))) { showToast("Cette personne est déjà affectée à ce chantier."); return; }
    maj(x.id, (r) => ({ ...r, crew: [...(r.crew || []), { id: btId(), workerId: w.id, start: fcr.start || today, end: fcr.end }] }));
    setFcr({ name: "", gradeId: fcr.gradeId, phone: "", start: "", end: "" });
  };
  const pointer = (x, w, units) => {
    if (!canEdit) return;
    if (!ptDate || isFutureDate(ptDate)) { showToast("Le pointage ne peut pas être daté dans le futur."); return; }
    const rate = tauxGrade(w.gradeId);
    setBtp((prev) => [...(prev || []).filter((r) => !(r.type === "pt" && r.siteId === x.id && r.workerId === w.id && r.date === ptDate)), ...(units > 0 ? [{ type: "pt", id: btId(), siteId: x.id, workerId: w.id, date: ptDate, units, rate }] : [])]);
  };
  const lierRH = (w) => {
    if (!canEdit || !setEmployees) return;
    if (w.employeeId) { showToast("Cet ouvrier est déjà lié au module Salaires."); return; }
    const existant = (employees || []).find((e) => btNom(e.name) === btNom(w.name) && !e.btpWorkerId);
    if (existant) { maj(w.id, (r) => ({ ...r, employeeId: existant.id })); showToast("Lié à la fiche « " + existant.name + " » déjà présente dans Salaires (son salaire de base n'est pas modifié par BTP)."); return; }
    const emp = { id: uid(), createdAt: new Date().toISOString(), name: w.name, position: nomGrade(w.gradeId), nif: w.nif || "", baseSalary: tauxGrade(w.gradeId), payFrequency: "hebdomadaire", overtimeRate: 0, active: true, hireDate: today, btpWorkerId: w.id };
    setEmployees((prev) => [...(prev || []), emp]);
    maj(w.id, (r) => ({ ...r, employeeId: emp.id }));
    logAudit("BTP", "Ouvrier relié au module Salaires", w.name);
    showToast("Fiche créée dans Salaires pour " + w.name + ". Utilisez l'onglet « Paie » pour préparer chaque bulletin.");
  };
  const preparerSalaire = (w, brut) => {
    if (!canEdit || !setEmployees) return;
    const emp = (employees || []).find((e) => String(e.id) === String(w.employeeId));
    if (!emp || emp.btpWorkerId !== w.id) { showToast("Le salaire de base de cette fiche n'est pas géré par BTP : saisissez le montant directement dans Salaires."); return; }
    if (!(brut > 0)) { showToast("Aucun jour pointé sur cette période."); return; }
    setEmployees((prev) => (prev || []).map((e) => (e.id === emp.id ? { ...e, baseSalary: brut } : e)));
    logAudit("BTP", "Salaire de base préparé pour la période", w.name + " : " + brut);
    showToast("Salaire de base de " + w.name + " mis à " + fmt(brut) + ". Allez dans Salaires → Bulletins de paie pour émettre le bulletin (cotisations incluses).");
  };
  const [fvs, setFvs] = useState({ date: "", kind: "visite", subject: "", resp: "" });
  const [fsr, setFsr] = useState({ kind: "visite", from: "", every: "", count: "" });
  const [vOuv, setVOuv] = useState("");
  const [jDate, setJDate] = useState(today);
  const [jf, setJf] = useState(""); const [jt, setJt] = useState("");
  const [frs, setFrs] = useState({ label: "", place: "", due: "", resp: "" });
  const [rsFiltre, setRsFiltre] = useState("");
  const [frc, setFrc] = useState({ prov: { dt: todayStr(), nt: "" }, def: { dt: todayStr(), nt: "" } });
  const [fdc, setFdc] = useState({ label: "", ref: "", resp: "", due: "" });
  const [dcFiltre, setDcFiltre] = useState("");
  const BT_VKIND = [["visite", "Visite de supervision"], ["controle", "Contrôle de la qualité"], ["reunion", "Réunion de chantier"], ["client", "Réunion avec le client"]];
  const nomVKind = (k) => (BT_VKIND.find((v) => v[0] === k) || [0, k])[1];
  const BT_DSTAT = [["afaire", "À faire"], ["encours", "En cours"], ["remis", "Remis"], ["valide", "Validé par le client"]];
  const DOCS_COURANTS = ["Étude de sol", "Plans d'architecture", "Plans de structure", "Plans d'électricité", "Plans de plomberie", "Cahier des charges", "Devis estimatif détaillé", "Autorisations et permis"];
  const recep = (x) => x.reception || {};
  const reservesDe = (x) => (x.reserves || []);
  const reservesOuvertes = (x) => reservesDe(x).filter((r) => r.status !== "levee");
  const reservesRetard = (x) => reservesOuvertes(x).filter((r) => r.due && r.due < today);
  const visitesACompleter = (x) => (x.visits || []).filter((v) => v.status === "prevue" && v.date && v.date < today);
  const docsRetard = (x) => (x.docs || []).filter((d) => (d.status === "afaire" || d.status === "encours") && d.due && d.due < today);
  // Règle de libération de la retenue de garantie, choisie par chantier selon le marché : "" = chantier terminé, "prov", "def".
  const retenueBloquee = (x) => {
    const r = x.retRule || "";
    if (r === "") return x.status !== "termine" ? "La retenue se libère à la réception : passez d'abord le chantier à « Terminé » (ou choisissez une autre règle dans l'onglet Réception et réserves)." : "";
    const rc = recep(x);
    if (r === "prov" && !rc.prov) return "Selon la règle choisie pour ce chantier, la retenue se libère à la réception provisoire : enregistrez-la d'abord (onglet Réception et réserves).";
    if (r === "def" && !rc.def) return "Selon la règle choisie pour ce chantier, la retenue se libère à la réception définitive : enregistrez-la d'abord (onglet Réception et réserves).";
    if (reservesOuvertes(x).length > 0) return "Il reste " + reservesOuvertes(x).length + " réserve(s) non levée(s) : levez-les avant de libérer la retenue.";
    return "";
  };
  const effectifDuJour = (x, date) => {
    const l = pts.filter((p) => p.siteId === x.id && p.date === date);
    return { total: btR2(l.reduce((t, p) => t + (Number(p.units) || 0), 0)), noms: l.map((p) => (workers.find((w) => w.id === p.workerId) || {}).name).filter(Boolean) };
  };
  const ajouterVisite = (x) => {
    if (!canEdit) return;
    if (!fvs.date) { showToast("Indiquez la date de la visite ou de la réunion."); return; }
    if (!fvs.subject.trim()) { showToast("Indiquez l'objet (ex. contrôle des fondations)."); return; }
    maj(x.id, (r) => ({ ...r, visits: [...(r.visits || []), { id: btId(), date: fvs.date, kind: fvs.kind, subject: fvs.subject.trim(), resp: fvs.resp, status: "prevue", report: "", decisions: "" }] }));
    setFvs({ ...fvs, subject: "", date: "" });
  };
  const planifierSerie = (x) => {
    if (!canEdit) return;
    const n = Math.floor(Number(fsr.count)), pas = Math.floor(Number(fsr.every));
    if (!fsr.from || !(n > 0) || n > 60 || !(pas > 0) || pas > 365) { showToast("Indiquez la première date, l'intervalle en jours (1 à 365) et le nombre de visites (1 à 60)."); return; }
    const out = []; const d = new Date(fsr.from + "T12:00:00");
    for (let i = 0; i < n; i++) { out.push({ id: btId(), date: iso8(d), kind: fsr.kind, subject: nomVKind(fsr.kind) + " n° " + (i + 1), resp: "", status: "prevue", report: "", decisions: "" }); d.setDate(d.getDate() + pas); }
    maj(x.id, (r) => ({ ...r, visits: [...(r.visits || []), ...out] }));
    showToast(n + " visite(s) planifiée(s) : complétez le compte rendu après chacune.");
  };
  const iso8 = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const majVisite = (x, v, patch) => maj(x.id, (r) => ({ ...r, visits: r.visits.map((y) => (y.id === v.id ? { ...y, ...patch } : y)) }));
  const marquerRealisee = (x, v) => {
    if (!canEdit) return;
    if (v.date > today) { showToast("Cette visite est datée dans le futur : elle ne peut être marquée réalisée qu'à partir de sa date."); return; }
    majVisite(x, v, { status: "faite" }); setVOuv(v.id);
    showToast("Visite marquée réalisée : rédigez maintenant le compte rendu.");
  };
  const enregistrerJournal = (x, d) => {
    if (!canEdit) return;
    if (!jDate || isFutureDate(jDate)) { showToast("Le journal ne peut pas être daté dans le futur."); return; }
    if (!d.works.trim() && !d.incidents.trim()) { showToast("Décrivez au moins les travaux exécutés ce jour."); return; }
    if (x.start && jDate < x.start) { showToast("Cette date est antérieure au début du chantier."); return; }
    const ent = { id: btId(), date: jDate, weather: d.weather, works: d.works.trim(), incidents: d.incidents.trim(), visitors: d.visitors.trim(), materials: d.materials.trim(), author: d.author };
    maj(x.id, (r) => ({ ...r, journal: [...(r.journal || []).filter((j) => j.date !== jDate), ent] }));
    showToast("Journal du " + ecDateFr(jDate) + " enregistré.");
  };
  const ajouterReserve = (x) => {
    if (!canEdit) return;
    if (!frs.label.trim()) { showToast("Décrivez la réserve (le défaut à corriger)."); return; }
    maj(x.id, (r) => ({ ...r, reserves: [...(r.reserves || []), { id: btId(), label: frs.label.trim(), place: frs.place.trim(), due: frs.due, resp: frs.resp, found: today, status: "ouverte", leveeDate: "" }] }));
    setFrs({ label: "", place: "", due: "", resp: frs.resp });
  };
  const majReserve = (x, rs, patch) => maj(x.id, (r) => ({ ...r, reserves: r.reserves.map((y) => (y.id === rs.id ? { ...y, ...patch } : y)) }));
  const enregistrerReception = (x, type, date, note) => {
    if (!canEdit) return;
    const rc = recep(x);
    if (!date || isFutureDate(date)) { showToast("La date de réception ne peut pas être dans le futur."); return; }
    if (x.start && date < x.start) { showToast("La réception ne peut pas précéder le début du chantier."); return; }
    if (type === "prov" && rc.prov) { showToast("La réception provisoire est déjà enregistrée."); return; }
    if (type === "def") {
      if (!rc.prov) { showToast("Enregistrez d'abord la réception provisoire."); return; }
      if (date < rc.prov.date) { showToast("La réception définitive ne peut pas précéder la réception provisoire."); return; }
      if (reservesOuvertes(x).length > 0) { showToast("Il reste " + reservesOuvertes(x).length + " réserve(s) non levée(s) : levez-les avant la réception définitive."); return; }
      if (rc.def) { showToast("La réception définitive est déjà enregistrée."); return; }
    }
    maj(x.id, (r) => ({ ...r, reception: { ...(r.reception || {}), [type]: { date, note: (note || "").trim() } } }));
    showToast("Réception " + (type === "prov" ? "provisoire" : "définitive") + " enregistrée le " + ecDateFr(date) + ".");
    logAudit("BTP", "Réception " + (type === "prov" ? "provisoire" : "définitive"), x.name);
  };
  const annulerReception = (x, type) => {
    if (!canEdit) return;
    const rc = recep(x);
    if (type === "prov" && rc.def) { showToast("Annulez d'abord la réception définitive."); return; }
    if (rels.some((r) => r.siteId === x.id && r.status !== "annulé") && (x.retRule === type)) { showToast("La retenue de garantie a déjà été encaissée sur la base de cette réception : annulez d'abord cet encaissement."); return; }
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler cette réception ?")) return;
    maj(x.id, (r) => { const n = { ...(r.reception || {}) }; delete n[type]; return { ...r, reception: n }; });
  };
  const ajouterDoc = (x) => {
    if (!canEdit) return;
    const label = fdc.label.trim();
    if (!label) { showToast("Indiquez le document (ex. plans de structure)."); return; }
    if ((x.docs || []).some((d) => btNom(d.label) === btNom(label) && btNom(d.ref) === btNom(fdc.ref))) { showToast("Ce document existe déjà."); return; }
    maj(x.id, (r) => ({ ...r, docs: [...(r.docs || []), { id: btId(), label, ref: fdc.ref.trim(), resp: fdc.resp, due: fdc.due, status: "afaire", date: "" }] }));
    setFdc({ label: "", ref: "", resp: fdc.resp, due: "" });
  };
  const insererDocs = (x) => {
    if (!canEdit) return;
    const deja = (x.docs || []).map((d) => btNom(d.label));
    const n = DOCS_COURANTS.filter((l) => !deja.includes(btNom(l))).map((l) => ({ id: btId(), label: l, ref: "", resp: "", due: "", status: "afaire", date: "" }));
    if (!n.length) { showToast("Ces documents courants existent déjà."); return; }
    maj(x.id, (r) => ({ ...r, docs: [...(r.docs || []), ...n] }));
    showToast(n.length + " document(s) ajouté(s) : renseignez le responsable et l'échéance de chacun.");
  };
  const majDoc = (x, d, patch) => maj(x.id, (r) => ({ ...r, docs: r.docs.map((y) => (y.id === d.id ? { ...y, ...patch } : y)) }));
  const changerEtudes = (x, on) => {
    if (!canEdit) return;
    if (!on && ((x.docs || []).length > 0)) { showToast("Ce chantier a des documents d'études : retirez-les avant de désactiver la phase d'études."); return; }
    maj(x.id, (r) => ({ ...r, etudes: on }));
    if (!on && sub === "etudes") setSub("vue");
  };
  const [sub, setSub] = useState("vue");
  const [fph, setFph] = useState({ label: "", start: "", end: "", weight: "" });
  const [ftk, setFtk] = useState({ title: "", assignee: "", due: "", priority: "normale", phaseId: "" });
  const [tke, setTke] = useState(""); const [tkr, setTkr] = useState("");
  const BT_PRIO = [["haute", "Haute"], ["normale", "Normale"], ["basse", "Basse"]];
  const BT_TSTAT = [["afaire", "À faire"], ["encours", "En cours"], ["fait", "Faite"]];
  const phasesDe = (x) => (x.phases || []).slice().sort((a, b) => String(a.start || "9999").localeCompare(String(b.start || "9999")));
  const etatPhase = (ph) => (ph.pct >= 100 ? "termine" : ph.end && ph.end < today ? "retard" : ph.pct > 0 || ph.realStart ? "encours" : ph.start && ph.start < today ? "demarrer" : "prevu");
  const avPhys = (x) => { const ph = x.phases || []; if (!ph.length) return null; const w = ph.reduce((t, y) => t + (Number(y.weight) || 0), 0); return w > 0 ? Math.round(ph.reduce((t, y) => t + (Number(y.weight) || 0) * (Number(y.pct) || 0), 0) / w) : Math.round(ph.reduce((t, y) => t + (Number(y.pct) || 0), 0) / ph.length); };
  const avFact = (x) => { const m = btMarche(x); return m > 0 ? Math.round(factureHt(x.id) * 100 / m) : 0; };
  const tempsPct = (x) => (x.start && x.end && x.end > x.start ? Math.max(0, Math.min(100, Math.round(btJours(x.start, today) * 100 / btJours(x.start, x.end)))) : null);
  const budgetNat = (x) => x.budgets || {};
  const budgetTotal = (x) => { const t = btR2(Object.keys(budgetNat(x)).reduce((a, k) => a + (Number(budgetNat(x)[k]) || 0), 0)); return t > 0 ? t : Number(x.budget) || 0; };
  const depNat = (x, kind) => btR2(deps.filter((d) => d.siteId === x.id && d.kind === kind && d.status !== "annulé").reduce((t, d) => t + d.amount, 0) + (kind === "maindoeuvre" ? salairesAffectes(x.id) : 0));
  const tachesRetard = (x) => (x.tasks || []).filter((k) => k.status !== "fait" && k.due && k.due < today);
  const phasesRetard = (x) => (x.phases || []).filter((ph) => etatPhase(ph) === "retard");
  const PHASES_COURANTES = ["Installation de chantier", "Terrassement", "Fondations", "Gros œuvre", "Second œuvre", "Finitions", "Réception des travaux"];
  const ajouterPhase = (x) => {
    if (!canEdit) return;
    const label = fph.label.trim();
    if (!label) { showToast("Indiquez le nom de l'étape."); return; }
    if ((x.phases || []).some((y) => btNom(y.label) === btNom(label))) { showToast("Cette étape existe déjà."); return; }
    if (fph.start && fph.end && fph.end < fph.start) { showToast("La fin prévue doit être après le début prévu."); return; }
    const w = fph.weight === "" ? 0 : Number(fph.weight);
    if (!(w >= 0) || w > 100) { showToast("Le poids doit être compris entre 0 et 100 %."); return; }
    maj(x.id, (r) => ({ ...r, phases: [...(r.phases || []), { id: btId(), label, start: fph.start, end: fph.end, weight: w, pct: 0, realStart: "", realEnd: "" }] }));
    setFph({ label: "", start: "", end: "", weight: "" });
  };
  const insererPhases = (x) => {
    if (!canEdit) return;
    const deja = (x.phases || []).map((y) => btNom(y.label));
    const nouvelles = [...(x.etudes ? ["Études et conception"] : []), ...PHASES_COURANTES].filter((n) => !deja.includes(btNom(n))).map((n) => ({ id: btId(), label: n, start: "", end: "", weight: 0, pct: 0, realStart: "", realEnd: "" }));
    if (!nouvelles.length) { showToast("Ces étapes courantes existent déjà."); return; }
    maj(x.id, (r) => ({ ...r, phases: [...(r.phases || []), ...nouvelles] }));
    showToast(nouvelles.length + " étape(s) ajoutée(s) : renseignez maintenant les dates et le poids de chacune.");
  };
  const repartirPoids = (x) => {
    if (!canEdit) return;
    const n = (x.phases || []).length;
    if (!n) { showToast("Ajoutez d'abord des étapes."); return; }
    const base = Math.floor(10000 / n) / 100;
    maj(x.id, (r) => ({ ...r, phases: r.phases.map((y, i) => ({ ...y, weight: i === n - 1 ? btR2(100 - base * (n - 1)) : base })) }));
    showToast("Poids répartis également : " + n + " étape(s). Ajustez-les ensuite selon la valeur de chaque étape.");
  };
  const majPhase = (x, ph, patch) => maj(x.id, (r) => ({ ...r, phases: r.phases.map((y) => (y.id === ph.id ? { ...y, ...patch } : y)) }));
  const changerPct = (x, ph, v) => {
    const pct = Math.max(0, Math.min(100, Number(v) || 0));
    majPhase(x, ph, { pct, realStart: pct > 0 && !ph.realStart ? today : ph.realStart, realEnd: pct >= 100 ? (ph.realEnd || today) : "" });
  };
  const majBudget = (x, kind, v) => maj(x.id, (r) => { const b = { ...(r.budgets || {}), [kind]: Math.max(0, Number(v) || 0) }; return { ...r, budgets: b, budget: btR2(Object.keys(b).reduce((t, k) => t + (Number(b[k]) || 0), 0)) }; });
  const ajouterTache = (x) => {
    if (!canEdit) return;
    if (!ftk.title.trim()) { showToast("Indiquez la tâche à exécuter."); return; }
    if (!ftk.assignee) { showToast("Choisissez la personne responsable (affectez-la d'abord au chantier si elle n'est pas dans la liste)."); return; }
    maj(x.id, (r) => ({ ...r, tasks: [...(r.tasks || []), { id: btId(), title: ftk.title.trim(), assignee: ftk.assignee, due: ftk.due, priority: ftk.priority, phaseId: ftk.phaseId, status: "afaire", createdAt: today }] }));
    setFtk({ ...ftk, title: "", due: "" });
  };
  const majTache = (x, k, patch) => maj(x.id, (r) => ({ ...r, tasks: r.tasks.map((y) => (y.id === k.id ? { ...y, ...patch } : y)) }));
  const pastilleEtat = (e) => (e === "termine" ? ecPastille("Terminée", "ok") : e === "retard" ? ecPastille("En retard", "alerte") : e === "encours" ? ecPastille("En cours", "attente") : e === "demarrer" ? ecPastille("À démarrer", "attente") : ecPastille("Prévue", "neutre"));

  const MoSite = (x) => {
    const crew = (x.crew || []).map((c) => ({ ...c, w: workers.find((y) => y.id === c.workerId) })).filter((c) => c.w);
    const actifs = crew.filter((c) => (!c.start || c.start <= ptDate) && (!c.end || c.end >= ptDate));
    const sal = salairesAffectes(x.id);
    const btnS = (id, l) => (<button key={id} onClick={() => setMosub(id)} data-testid={"bt-mo-" + id} className="px-3 py-1 text-xs rounded-lg" style={{ background: mosub === id ? "#E6F1EE" : "transparent", border: "1px solid " + (mosub === id ? "#0F6B5C" : "#E4DDC8"), color: "#152238", fontWeight: mosub === id ? 600 : 500 }}>{l}</button>);
    const lab = (t) => <label className="text-xs" style={{ color: "#8A8370" }}>{t}</label>;
    const mensu = (() => {
      const m = moisDe(x.start, x.end), tj = Object.values(m).reduce((t, n) => t + n, 0);
      if (!tj) return [];
      return Object.keys(m).sort().map((k) => ({ k, jh: btR2((x.plan || []).reduce((t, r) => t + (Number(r.count) || 0) * (Number(r.days) || 0), 0) * m[k] / tj), cout: btR2(planCout(x) * m[k] / tj) }));
    })();
    const moisFr = (k) => ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."][Number(k.slice(5)) - 1] + " " + k.slice(0, 4);
    return (
      <div data-testid="bt-mo">
        <div className="text-sm mb-3" style={{ color: "#5B563F" }}>Ouvriers du chantier, grille salariale, effectifs prévus sur la durée des travaux, pointage et préparation de la paie (reliée au module Salaires). Les taux journaliers sont ceux que <b>vous</b> fixez : rien n'est préréglé.</div>
        <div className="flex flex-wrap gap-1 mb-4">{btnS("grille", "Grille salariale")}{btnS("plan", "Plan de main-d'œuvre")}{btnS("equipe", "Ouvriers affectés")}{btnS("pointage", "Pointage")}{btnS("paie", "Paie")}</div>
        <datalist id="bt-dl-qualif">{["Maçon", "Manœuvre", "Ferrailleur", "Coffreur", "Charpentier", "Carreleur", "Plombier", "Électricien", "Peintre", "Soudeur", "Conducteur d'engins", "Gardien"].map((n) => <option key={n} value={n} />)}</datalist>
        <datalist id="bt-dl-ouvriers">{workers.map((w) => <option key={w.id} value={w.name} />)}</datalist>

        {mosub === "grille" && (<div data-testid="bt-grille">
          <div className="text-xs mb-2" style={{ color: "#7A7460" }}>La grille est commune à tous vos chantiers : une qualification et son taux par jour de travail (gourdes).</div>
          {canEdit && (<div className="ec-card p-3 mb-3"><div className="grid md:grid-cols-4 gap-2 items-end">
            <div className="md:col-span-2">{lab("Qualification")}<div className="flex gap-1"><input value={fgr.label} onChange={(e) => setFgr({ ...fgr, label: e.target.value })} data-testid="bt-gr-nom" className={ecInput} style={ecBorder} /><BtFleche id="bt-dl-qualif" onPick={(v) => setFgr({ ...fgr, label: v })} /></div></div>
            <div>{lab("Taux par jour (G)")}<input type="number" min="0" value={fgr.rate} onChange={(e) => setFgr({ ...fgr, rate: e.target.value })} data-testid="bt-gr-taux" className={ecInput + " tabular"} style={ecBorder} /></div>
            <button onClick={ajouterGrade} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="bt-gr-ajouter">Ajouter</button></div></div>)}
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Qualification</th><th className="text-right">Taux par jour</th><th className="text-right">Ouvriers</th><th></th></tr></thead>
            <tbody>{grades.map((g) => (<tr key={g.id} data-testid="bt-gr-ligne"><td className="py-1.5">{g.label}</td>
              <td className="text-right">{canEdit ? <BtChamp type="number" min="0" value={g.rate} onCommit={(v) => maj(g.id, (r) => ({ ...r, rate: Math.max(0, Number(v) || 0) }))} onSaved={() => showToast("Enregistré ✓")} data-testid="bt-gr-taux-edit" className="border rounded px-1 py-0.5 text-xs tabular" style={{ ...ecBorder, width: 100 }} /> : fmt(g.rate)}</td>
              <td className="text-right tabular">{workers.filter((w) => w.gradeId === g.id).length}</td>
              <td className="text-right">{canEdit && <button onClick={() => retirerGrade(g)} className="text-xs" style={{ color: "#A6432F" }} data-testid="bt-gr-retirer">Retirer</button>}</td></tr>))}</tbody>
            {grades.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }}><td colSpan={4}>{grades.length} qualification{grades.length > 1 ? "s" : ""}</td></tr></tfoot>}</table></div>
          {grades.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucune qualification : ajoutez celles de vos équipes avec leur taux journalier.</div>}
          {grades.length > 0 && <div className="text-xs mt-2" style={{ color: "#7A7460" }}>Changer un taux n'affecte que les pointages futurs : les jours déjà pointés gardent le taux de leur date.</div>}
        </div>)}

        {mosub === "plan" && (<div data-testid="bt-plan">
          <div className="text-xs mb-2" style={{ color: "#7A7460" }}>Les effectifs prévus pour ce chantier, répartis sur toute la durée entre le début et la fin prévue du chantier.</div>
          {canEdit && (<div className="ec-card p-3 mb-3"><div className="grid md:grid-cols-5 gap-2 items-end">
            <div className="md:col-span-2">{lab("Qualification")}<select value={fpl.gradeId} onChange={(e) => setFpl({ ...fpl, gradeId: e.target.value })} data-testid="bt-pl-grade" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{grades.map((g) => <option key={g.id} value={g.id}>{g.label} ({fmt(g.rate)}/jour)</option>)}</select></div>
            <div>{lab("Effectif prévu")}<input type="number" min="0" value={fpl.count} onChange={(e) => setFpl({ ...fpl, count: e.target.value })} data-testid="bt-pl-effectif" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div>{lab("Jours par personne")}<input type="number" min="0" value={fpl.days} onChange={(e) => setFpl({ ...fpl, days: e.target.value })} data-testid="bt-pl-jours" className={ecInput + " tabular"} style={ecBorder} /></div>
            <button onClick={() => ajouterPlan(x)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="bt-pl-ajouter">Ajouter</button></div>
            {grades.length === 0 && <div className="text-xs mt-2" style={{ color: "#8A8370" }}>Définissez d'abord la grille salariale (onglet « Grille salariale »).</div>}</div>)}
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Qualification</th><th className="text-right">Effectif</th><th className="text-right">Jours / pers.</th><th className="text-right">Jours-homme</th><th className="text-right">Taux</th><th className="text-right">Coût prévu</th><th></th></tr></thead>
            <tbody>{(x.plan || []).map((r) => (<tr key={r.id} data-testid="bt-pl-ligne"><td className="py-1.5">{nomGrade(r.gradeId)}</td><td className="text-right tabular">{r.count}</td><td className="text-right tabular">{r.days}</td><td className="text-right tabular">{btR2(r.count * r.days)}</td><td className="text-right tabular">{fmt(tauxGrade(r.gradeId))}</td><td className="text-right tabular">{fmt(btR2(r.count * r.days * tauxGrade(r.gradeId)))}</td>
              <td className="text-right">{canEdit && <button onClick={() => maj(x.id, (z) => ({ ...z, plan: z.plan.filter((y) => y.id !== r.id) }))} className="text-xs" style={{ color: "#A6432F" }} data-testid="bt-pl-retirer">Retirer</button>}</td></tr>))}</tbody>
            {(x.plan || []).length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }}><td>Total</td><td className="text-right tabular">{(x.plan || []).reduce((t, r) => t + Number(r.count), 0)}</td><td></td><td className="text-right tabular" data-testid="bt-pl-tot-jh">{btR2((x.plan || []).reduce((t, r) => t + r.count * r.days, 0))}</td><td></td><td className="text-right tabular" data-testid="bt-pl-tot-cout">{fmt(planCout(x))}</td><td></td></tr></tfoot>}</table></div>
          {(x.plan || []).length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun effectif prévu.</div>}
          {(x.plan || []).length > 0 && (<div className="mt-4">
            <div className="display text-base mb-2" style={{ color: "#152238" }}>Répartition dans le temps</div>
            {mensu.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }} data-testid="bt-pl-sans-dates">Renseignez le début et la fin prévue du chantier pour voir la répartition mois par mois.</div> : (<div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Mois</th><th className="text-right">Jours-homme</th><th className="text-right">Coût prévu</th></tr></thead><tbody>{mensu.map((m) => (<tr key={m.k} data-testid="bt-pl-mois"><td className="py-1.5">{moisFr(m.k)}</td><td className="text-right tabular">{m.jh}</td><td className="text-right tabular">{fmt(m.cout)}</td></tr>))}</tbody></table></div>)}
            {canEdit && <div className="mt-3"><button onClick={() => { majBudget(x, "maindoeuvre", planCout(x)); showToast("Budget de main-d'œuvre mis à " + fmt(planCout(x)) + " (onglet Budget d'exécution)."); }} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="bt-pl-reporter">Reporter ce coût dans le budget d'exécution</button></div>}
          </div>)}
        </div>)}

        {mosub === "equipe" && (<div data-testid="bt-ouvriers">
          {canEdit && (<div className="ec-card p-3 mb-3"><div className="grid md:grid-cols-5 gap-2 items-end">
            <div className="md:col-span-2">{lab("Nom de l'ouvrier")}<div className="flex gap-1"><input value={fcr.name} onChange={(e) => setFcr({ ...fcr, name: e.target.value })} data-testid="bt-cr-nom" className={ecInput} style={ecBorder} /><BtFleche id="bt-dl-ouvriers" onPick={(v) => setFcr({ ...fcr, name: v })} /></div></div>
            <div>{lab("Qualification (nouvel ouvrier)")}<select value={fcr.gradeId} onChange={(e) => setFcr({ ...fcr, gradeId: e.target.value })} data-testid="bt-cr-grade" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{grades.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select></div>
            <div>{lab("Téléphone")}<input value={fcr.phone} onChange={(e) => setFcr({ ...fcr, phone: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <div>{lab("Affecté depuis le")}<input type="date" value={fcr.start} onChange={(e) => setFcr({ ...fcr, start: e.target.value })} data-testid="bt-cr-debut" className={ecInput} style={ecBorder} /></div>
          </div><div className="flex flex-wrap gap-3 mt-2 items-end"><div>{lab("Jusqu'au (facultatif)")}<input type="date" value={fcr.end} onChange={(e) => setFcr({ ...fcr, end: e.target.value })} className={ecInput} style={ecBorder} /></div><button onClick={() => ajouterAffectation(x)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="bt-cr-ajouter">Affecter au chantier</button></div>
          <div className="text-xs mt-2" style={{ color: "#8A8370" }}>Un nom déjà connu (liste) reprend la fiche de l'ouvrier : il peut travailler sur plusieurs chantiers. Sinon une nouvelle fiche est créée avec la qualification choisie.</div></div>)}
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Ouvrier</th><th>Qualification</th><th className="text-right">Taux / jour</th><th>Affectation</th><th className="text-right">Jours pointés</th><th className="text-right">Coût pointé</th><th>Salaires</th><th></th></tr></thead>
            <tbody>{crew.map((c) => (<tr key={c.id} data-testid="bt-cr-ligne"><td className="py-1.5">{c.w.name}{c.w.phone ? <span className="text-xs" style={{ color: "#8A8370" }}> · {c.w.phone}</span> : null}</td>
              <td>{canEdit ? <select value={c.w.gradeId} onChange={(e) => maj(c.w.id, (r) => ({ ...r, gradeId: e.target.value }))} className="border rounded px-1 py-0.5 text-xs" style={ecBorder}>{grades.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select> : nomGrade(c.w.gradeId)}</td>
              <td className="text-right tabular">{fmt(tauxGrade(c.w.gradeId))}</td>
              <td className="text-xs">{ecDateFr(c.start)} → {c.end ? ecDateFr(c.end) : "en cours"}</td>
              <td className="text-right tabular">{joursOuv(c.w.id, "", "", x.id)}</td><td className="text-right tabular">{fmt(brutOuv(c.w.id, "", "", x.id))}</td>
              <td>{c.w.employeeId ? ecPastille("Lié", "ok") : canEdit ? <button onClick={() => lierRH(c.w)} className="text-xs underline" data-testid="bt-cr-lier">Lier à Salaires</button> : "—"}</td>
              <td className="text-right whitespace-nowrap">{canEdit && (!c.end || c.end > today) && <button onClick={() => maj(x.id, (r) => ({ ...r, crew: r.crew.map((y) => (y.id === c.id ? { ...y, end: today } : y)) }))} className="text-xs mr-2" data-testid="bt-cr-terminer">Terminer</button>}{canEdit && <button onClick={() => { if (joursOuv(c.w.id, "", "", x.id) > 0) { showToast("Cet ouvrier a des jours pointés sur ce chantier : terminez son affectation plutôt que de la retirer."); return; } maj(x.id, (r) => ({ ...r, crew: r.crew.filter((y) => y.id !== c.id) })); }} className="text-xs" style={{ color: "#A6432F" }} data-testid="bt-cr-retirer">Retirer</button>}</td></tr>))}</tbody>
            {crew.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="bt-cr-total"><td colSpan={4}>{crew.length} affectation{crew.length > 1 ? "s" : ""}</td><td className="text-right tabular">{btR2(crew.reduce((t, c) => t + joursOuv(c.w.id, "", "", x.id), 0))}</td><td className="text-right tabular">{fmt(coutPointe(x.id))}</td><td colSpan={2}></td></tr></tfoot>}</table></div>
          {crew.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun ouvrier affecté. Définissez d'abord la grille salariale, puis affectez vos ouvriers.</div>}
        </div>)}

        {mosub === "pointage" && (<div data-testid="bt-pointage">
          <div className="flex flex-wrap gap-3 items-end mb-3"><div>{lab("Jour pointé")}<input type="date" max={today} value={ptDate} onChange={(e) => setPtDate(e.target.value)} data-testid="bt-pt-date" className={ecInput} style={ecBorder} /></div>
            {canEdit && actifs.length > 0 && <button onClick={() => actifs.forEach((c) => pointer(x, c.w, 1))} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="bt-pt-tous">Tous présents</button>}</div>
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Ouvrier</th><th>Qualification</th><th>Présence</th><th className="text-right">Coût du jour</th></tr></thead>
            <tbody>{actifs.map((c) => { const p = pts.find((y) => y.siteId === x.id && y.workerId === c.w.id && y.date === ptDate); return (<tr key={c.id} data-testid="bt-pt-ligne"><td className="py-1.5">{c.w.name}</td><td className="text-xs">{nomGrade(c.w.gradeId)}</td>
              <td>{canEdit ? <select value={p ? String(p.units) : "0"} onChange={(e) => pointer(x, c.w, Number(e.target.value))} data-testid="bt-pt-presence" className="border rounded px-1 py-0.5 text-xs" style={ecBorder}><option value="0">Absent</option><option value="1">Présent (journée)</option><option value="0.5">Demi-journée</option></select> : p ? p.units : 0}</td>
              <td className="text-right tabular">{p ? fmt(btR2(p.units * p.rate)) : "—"}</td></tr>); })}</tbody>
            {actifs.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="bt-pt-total"><td colSpan={2}>{btR2(pts.filter((p) => p.siteId === x.id && p.date === ptDate).reduce((t, p) => t + p.units, 0))} jour(s)-homme</td><td></td><td className="text-right tabular" data-testid="bt-pt-cout-jour">{fmt(btR2(pts.filter((p) => p.siteId === x.id && p.date === ptDate).reduce((t, p) => t + p.units * p.rate, 0)))}</td></tr></tfoot>}</table></div>
          {actifs.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun ouvrier affecté à cette date.</div>}
        </div>)}

        {mosub === "paie" && (<div data-testid="bt-paie">
          <div className="text-xs mb-2" style={{ color: "#7A7460" }}>Choisissez la période à payer. Pour un ouvrier lié à Salaires, « Préparer » met son salaire de base au montant des jours pointés ; vous émettez ensuite le bulletin dans <b>Salaires → Bulletins de paie</b> (cotisations et retenues comprises). Un ouvrier non lié se paie par une dépense « Main-d'œuvre » (onglet Dépenses). N'enregistrez pas le même salaire des deux façons.</div>
          <div className="flex flex-wrap gap-3 items-end mb-3"><div>{lab("Du")}<input type="date" value={payFrom} onChange={(e) => setPayFrom(e.target.value)} data-testid="bt-pa-du" className={ecInput} style={ecBorder} /></div><div>{lab("Au")}<input type="date" value={payTo} onChange={(e) => setPayTo(e.target.value)} data-testid="bt-pa-au" className={ecInput} style={ecBorder} /></div></div>
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Ouvrier</th><th className="text-right">Jours (tous chantiers)</th><th className="text-right">Dont ce chantier</th><th className="text-right">Salaire brut de la période</th><th>Bulletins émis sur la période</th><th>Salaires</th><th></th></tr></thead>
            <tbody>{crew.map((c) => { const j = joursOuv(c.w.id, payFrom, payTo), jh = joursOuv(c.w.id, payFrom, payTo, x.id), brut = brutOuv(c.w.id, payFrom, payTo); const bul = (payslips || []).filter((ps) => ps.status !== "annulé" && c.w.employeeId && String(ps.employeeId) === String(c.w.employeeId) && ps.periodStart <= payTo && ps.periodEnd >= payFrom); return (<tr key={c.id} data-testid="bt-pa-ligne"><td className="py-1.5">{c.w.name}</td><td className="text-right tabular">{j}</td><td className="text-right tabular">{jh}</td><td className="text-right tabular" data-testid="bt-pa-brut">{fmt(brut)}</td>
              <td className="text-xs">{bul.length ? bul.length + " bulletin(s), net " + fmt(btR2(bul.reduce((t, b) => t + (Number(b.netTotal) || 0), 0))) : "—"}</td>
              <td>{c.w.employeeId ? ecPastille("Lié", "ok") : <span className="text-xs" style={{ color: "#8A8370" }}>Non lié</span>}</td>
              <td className="text-right">{canEdit && c.w.employeeId && <button onClick={() => preparerSalaire(c.w, brut)} className="text-xs underline" data-testid="bt-pa-preparer">Préparer dans Salaires</button>}</td></tr>); })}</tbody>
            {crew.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }}><td>Total</td><td colSpan={2}></td><td className="text-right tabular" data-testid="bt-pa-tot">{fmt(btR2(crew.reduce((t, c) => t + brutOuv(c.w.id, payFrom, payTo), 0)))}</td><td colSpan={3}></td></tr></tfoot>}</table></div>
          {crew.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun ouvrier affecté à ce chantier.</div>}
          {sal > 0 && <div className="text-xs mt-3" style={{ color: "#5B563F" }} data-testid="bt-pa-sal">Salaires déjà versés via Salaires et affectés à ce chantier (au prorata des jours pointés) : <b className="tabular">{fmt(sal)}</b> — comptés dans les dépenses de main-d'œuvre du chantier.</div>}
        </div>)}
      </div>
    );
  };

  const SupSite = (x) => {
    const staff = x.staff || [];
    const lab = (t) => <label className="text-xs" style={{ color: "#8A8370" }}>{t}</label>;
    const vs = (x.visits || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const etatV = (v) => (v.status === "faite" ? "faite" : v.status === "annulee" ? "annulee" : v.date < today ? "acompleter" : v.date === today ? "aujourdhui" : "avenir");
    const pastV = (e) => (e === "faite" ? ecPastille("Réalisée", "ok") : e === "annulee" ? ecPastille("Annulée", "neutre") : e === "acompleter" ? ecPastille("À réaliser ou annuler", "alerte") : e === "aujourdhui" ? ecPastille("Aujourd'hui", "attente") : ecPastille("À venir", "attente"));
    const ent = (x.journal || []).find((j) => j.date === jDate);
    const jl = (x.journal || []).filter((j) => (!jf || j.date >= jf) && (!jt || j.date <= jt)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const eff = effectifDuJour(x, jDate);
    return (
      <div data-testid="bt-sup">
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Calendrier de supervision</div>
        <datalist id="bt-dl-objet">{["Contrôle de l'avancement des travaux", "Contrôle de l'implantation", "Contrôle des fondations", "Contrôle du ferraillage avant coulage", "Contrôle de la qualité du béton", "Réunion de coordination avec les sous-traitants", "Point d'avancement avec le client", "Visite préalable à la réception"].map((n) => <option key={n} value={n} />)}</datalist>
        {canEdit && (<div className="ec-card p-3 mb-3"><div className="grid md:grid-cols-5 gap-2 items-end">
          <div>{lab("Date")}<input type="date" value={fvs.date} onChange={(e) => setFvs({ ...fvs, date: e.target.value })} data-testid="bt-vs-date" className={ecInput} style={ecBorder} /></div>
          <div>{lab("Type")}<select value={fvs.kind} onChange={(e) => setFvs({ ...fvs, kind: e.target.value })} data-testid="bt-vs-type" className={ecInput} style={ecBorder}>{BT_VKIND.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="md:col-span-2">{lab("Objet")}<div className="flex gap-1"><input value={fvs.subject} onChange={(e) => setFvs({ ...fvs, subject: e.target.value })} data-testid="bt-vs-objet" className={ecInput} style={ecBorder} /><BtFleche id="bt-dl-objet" onPick={(v) => setFvs({ ...fvs, subject: v })} /></div></div>
          <div>{lab("Responsable")}<select value={fvs.resp} onChange={(e) => setFvs({ ...fvs, resp: e.target.value })} data-testid="bt-vs-resp" className={ecInput} style={ecBorder}><option value="">—</option>{staff.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}</select></div>
        </div>
        <div className="mt-2"><button onClick={() => ajouterVisite(x)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="bt-vs-ajouter">Planifier</button></div>
        <details className="mt-3 text-sm" data-testid="bt-vs-serie-bloc"><summary style={{ cursor: "pointer", fontWeight: 600 }}>Planifier une série de visites régulières</summary>
          <div className="grid md:grid-cols-5 gap-2 items-end mt-2">
            <div>{lab("Type")}<select value={fsr.kind} onChange={(e) => setFsr({ ...fsr, kind: e.target.value })} className={ecInput} style={ecBorder}>{BT_VKIND.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div>{lab("Première date")}<input type="date" value={fsr.from} onChange={(e) => setFsr({ ...fsr, from: e.target.value })} data-testid="bt-sr-debut" className={ecInput} style={ecBorder} /></div>
            <div>{lab("Tous les (jours)")}<input type="number" min="1" value={fsr.every} onChange={(e) => setFsr({ ...fsr, every: e.target.value })} data-testid="bt-sr-pas" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div>{lab("Nombre de visites")}<input type="number" min="1" max="60" value={fsr.count} onChange={(e) => setFsr({ ...fsr, count: e.target.value })} data-testid="bt-sr-nombre" className={ecInput + " tabular"} style={ecBorder} /></div>
            <button onClick={() => planifierSerie(x)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="bt-sr-creer">Créer la série</button>
          </div></details></div>)}
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Type</th><th>Objet</th><th>Responsable</th><th>État</th><th></th></tr></thead>
          <tbody>{vs.map((v) => (<React.Fragment key={v.id}><tr data-testid="bt-vs-ligne" style={{ opacity: v.status === "annulee" ? 0.55 : 1 }}><td className="py-1.5">{ecDateFr(v.date)}</td><td className="text-xs">{nomVKind(v.kind)}</td><td>{v.subject}</td><td className="text-xs">{v.resp || "—"}</td><td data-testid="bt-vs-etat">{pastV(etatV(v))}</td>
            <td className="text-right whitespace-nowrap"><button onClick={() => setVOuv(vOuv === v.id ? "" : v.id)} className="text-xs underline mr-2" data-testid="bt-vs-cr">{vOuv === v.id ? "Fermer" : "Compte rendu"}</button>{canEdit && v.status === "prevue" && <button onClick={() => marquerRealisee(x, v)} className="text-xs mr-2" data-testid="bt-vs-realisee">Marquer réalisée</button>}{canEdit && v.status === "prevue" && <button onClick={() => majVisite(x, v, { status: "annulee" })} className="text-xs mr-2" style={{ color: "#A6432F" }} data-testid="bt-vs-annuler">Annuler</button>}{canEdit && v.status === "annulee" && <button onClick={() => majVisite(x, v, { status: "prevue" })} className="text-xs mr-2">Rétablir</button>}{canEdit && v.status !== "faite" && <button onClick={() => maj(x.id, (r) => ({ ...r, visits: r.visits.filter((y) => y.id !== v.id) }))} className="text-xs" style={{ color: "#A6432F" }} data-testid="bt-vs-retirer">Retirer</button>}</td></tr>
            {vOuv === v.id && (<tr data-testid="bt-vs-detail"><td colSpan={6} className="pb-3"><div className="ec-card p-3">
              <div className="text-xs mb-1" style={{ color: "#7A7460" }}>{v.status === "faite" ? "Compte rendu de la visite" : "Le compte rendu se rédige une fois la visite marquée réalisée."}</div>
              <div>{lab("Constats et observations")}<BtTexte rows={4} value={v.report} disabled={!canEdit || v.status !== "faite"} onCommit={(t) => majVisite(x, v, { report: t })} onSaved={() => showToast("Compte rendu enregistré ✓")} data-testid="bt-vs-constats" className={ecInput} style={ecBorder} /></div>
              <div className="mt-2">{lab("Décisions et actions à mener")}<BtTexte rows={3} value={v.decisions} disabled={!canEdit || v.status !== "faite"} onCommit={(t) => majVisite(x, v, { decisions: t })} onSaved={() => showToast("Décisions enregistrées ✓")} data-testid="bt-vs-decisions" className={ecInput} style={ecBorder} /></div>
              {v.status === "faite" && <div className="mt-2"><button onClick={() => setImprimer({ kind: "cr", id: x.id, vid: v.id })} className="px-3 py-1.5 rounded text-sm" style={ecBtn} data-testid="bt-vs-imprimer">Imprimer le compte rendu</button></div>}
            </div></td></tr>)}</React.Fragment>))}</tbody>
          {vs.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="bt-vs-total"><td colSpan={6}>{vs.filter((v) => v.status === "faite").length} réalisée(s), {vs.filter((v) => etatV(v) === "avenir" || etatV(v) === "aujourdhui").length} à venir, {vs.filter((v) => etatV(v) === "acompleter").length} à régulariser</td></tr></tfoot>}</table></div>
        {vs.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucune visite ni réunion planifiée.</div>}

        <div className="display text-base mb-2 mt-6" style={{ color: "#152238" }}>Journal de chantier</div>
        <div className="flex flex-wrap gap-3 items-end mb-2"><div>{lab("Jour")}<input type="date" max={today} value={jDate} onChange={(e) => setJDate(e.target.value)} data-testid="bt-jr-date" className={ecInput} style={ecBorder} /></div>
          <div className="text-xs" style={{ color: "#7A7460" }}>{ent ? "Journal déjà rédigé pour ce jour : vous pouvez le modifier." : "Aucun journal pour ce jour."}</div></div>
        <BtJournalForm key={x.id + "|" + jDate + "|" + (ent ? ent.id : "")} entry={ent} staff={staff} effectif={eff} canEdit={canEdit} onSave={(d) => enregistrerJournal(x, d)} />
        <div className="flex flex-wrap gap-2 items-end mb-2"><div>{lab("Du")}<input type="date" value={jf} onChange={(e) => setJf(e.target.value)} data-testid="bt-jr-du" className={ecInput} style={ecBorder} /></div><div>{lab("Au")}<input type="date" value={jt} onChange={(e) => setJt(e.target.value)} data-testid="bt-jr-au" className={ecInput} style={ecBorder} /></div>
          {jl.length > 0 && <button onClick={() => setImprimer({ kind: "journal", id: x.id, dates: jl.map((j) => j.date).sort() })} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="bt-jr-imprimer">Imprimer ces journaux</button>}</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Météo</th><th className="text-right">Effectif</th><th>Travaux</th><th></th></tr></thead>
          <tbody>{jl.map((j) => (<tr key={j.id} data-testid="bt-jr-ligne"><td className="py-1.5">{ecDateFr(j.date)}</td><td className="text-xs">{j.weather || "—"}</td><td className="text-right tabular">{effectifDuJour(x, j.date).total}</td><td className="text-xs">{(j.works || "").slice(0, 80)}{(j.works || "").length > 80 ? "…" : ""}</td>
            <td className="text-right whitespace-nowrap"><button onClick={() => setJDate(j.date)} className="text-xs underline mr-2" data-testid="bt-jr-ouvrir">Ouvrir</button><button onClick={() => setImprimer({ kind: "journal", id: x.id, dates: [j.date] })} className="text-xs underline">Imprimer</button></td></tr>))}</tbody>
          {jl.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="bt-jr-total"><td colSpan={5}>{jl.length} jour(s) de journal</td></tr></tfoot>}</table></div>
        {jl.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun journal enregistré{jf || jt ? " sur cette période" : ""}.</div>}
      </div>
    );
  };

  const RecepSite = (x) => {
    const rc = recep(x), staff = x.staff || [];
    const lab = (t) => <label className="text-xs" style={{ color: "#8A8370" }}>{t}</label>;
    const rl = reservesDe(x).filter((r) => !rsFiltre || (rsFiltre === "retard" ? r.status !== "levee" && r.due && r.due < today : r.status === rsFiltre));
    const bloc = retenueBloquee(x);
    const due = retenueDue(x.id);
    const finGarantie = rc.prov && Number(x.warrantyMonths) > 0 ? (() => { const d = new Date(rc.prov.date + "T12:00:00"); d.setMonth(d.getMonth() + Number(x.warrantyMonths)); return iso8(d); })() : "";
    const recBloc = (type, titre) => {
      const ex = rc[type];
      const dt = frc[type].dt, nt = frc[type].nt;
      const setDt = (v) => setFrc({ ...frc, [type]: { ...frc[type], dt: v } }), setNt = (v) => setFrc({ ...frc, [type]: { ...frc[type], nt: v } });
      return (<div className="ec-card p-3 mb-3" data-testid={"bt-rc-" + type}>
        <div className="display text-base mb-1" style={{ color: "#152238" }}>{titre}</div>
        {ex ? (<div className="text-sm"><b data-testid={"bt-rc-" + type + "-date"}>Enregistrée le {ecDateFr(ex.date)}</b>{ex.note ? " — " + ex.note : ""}
          <div className="flex flex-wrap gap-2 mt-2"><button onClick={() => setImprimer({ kind: "pv", id: x.id, type })} className="px-3 py-1.5 rounded text-sm" style={ecBtn} data-testid={"bt-rc-" + type + "-pv"}>Imprimer le procès-verbal</button>{canEdit && <button onClick={() => annulerReception(x, type)} className="text-xs" style={{ color: "#A6432F" }} data-testid={"bt-rc-" + type + "-annuler"}>Annuler la réception</button>}</div></div>)
          : (canEdit ? (<div><div className="grid md:grid-cols-3 gap-2 items-end"><div>{lab("Date de réception")}<input type="date" max={today} value={dt} onChange={(e) => setDt(e.target.value)} data-testid={"bt-rc-" + type + "-champ-date"} className={ecInput} style={ecBorder} /></div><div className="md:col-span-2">{lab("Observations (facultatif)")}<input value={nt} onChange={(e) => setNt(e.target.value)} className={ecInput} style={ecBorder} /></div></div>
            <div className="mt-2"><button onClick={() => enregistrerReception(x, type, dt, nt)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid={"bt-rc-" + type + "-enregistrer"}>Enregistrer la réception {type === "prov" ? "provisoire" : "définitive"}</button></div></div>) : <div className="text-sm" style={{ color: "#8A8370" }}>Pas encore enregistrée.</div>)}
      </div>);
    };
    return (
      <div data-testid="bt-recep">
        <div className="text-sm mb-3" style={{ color: "#5B563F" }}>La réception constate la fin des travaux. Les <b>réserves</b> sont les défauts à corriger ; la retenue de garantie se libère selon la règle de votre marché.</div>
        <div className="grid md:grid-cols-3 gap-2 mb-3 items-end">
          <div className="md:col-span-2">{lab("Libération de la retenue de garantie (selon votre marché)")}<select value={x.retRule || ""} disabled={!canEdit} onChange={(e) => { maj(x.id, (r) => ({ ...r, retRule: e.target.value })); showToast("Règle de libération enregistrée ✓"); }} data-testid="bt-rc-regle" className={ecInput} style={ecBorder}><option value="">Quand le chantier est terminé (état « Terminé »)</option><option value="prov">À la réception provisoire (réserves levées)</option><option value="def">À la réception définitive (réserves levées)</option></select></div>
          <div>{lab("Durée de la garantie après réception provisoire (mois, facultatif)")}<BtChamp type="number" min="0" value={x.warrantyMonths || ""} disabled={!canEdit} onCommit={(v) => maj(x.id, (r) => ({ ...r, warrantyMonths: Math.max(0, Math.floor(Number(v) || 0)) }))} onSaved={() => showToast("Enregistré ✓")} data-testid="bt-rc-garantie" className={ecInput + " tabular"} style={ecBorder} /></div>
        </div>
        {finGarantie && <div className="text-sm mb-3" style={{ color: "#5B563F" }} data-testid="bt-rc-fin-garantie">Fin de la période de garantie : <b>{ecDateFr(finGarantie)}</b> ({x.warrantyMonths} mois après la réception provisoire).</div>}
        <div className="text-sm mb-3 p-2 rounded" style={{ background: due > 0.004 ? (bloc ? "#FFF6E0" : "#E6F1EE") : "#F4F1E6", color: "#152238" }} data-testid="bt-rc-retenue">Retenue de garantie à libérer : <b className="tabular">{fmt(due)}</b> — {due <= 0.004 ? "rien à libérer." : bloc ? "pas encore libérable. " + bloc : "libérable : rendez-vous dans « Marché, avances et retenue »."}</div>
        {recBloc("prov", "Réception provisoire")}
        <div className="display text-base mb-2 mt-4" style={{ color: "#152238" }}>Réserves</div>
        {canEdit && (<div className="ec-card p-3 mb-3"><div className="grid md:grid-cols-4 gap-2 items-end">
          <div className="md:col-span-2">{lab("Défaut à corriger")}<input value={frs.label} onChange={(e) => setFrs({ ...frs, label: e.target.value })} data-testid="bt-rs-nom" className={ecInput} style={ecBorder} /></div>
          <div>{lab("Lieu (pièce, niveau…)")}<input value={frs.place} onChange={(e) => setFrs({ ...frs, place: e.target.value })} className={ecInput} style={ecBorder} /></div>
          <div>{lab("À lever avant le")}<input type="date" value={frs.due} onChange={(e) => setFrs({ ...frs, due: e.target.value })} data-testid="bt-rs-echeance" className={ecInput} style={ecBorder} /></div>
        </div><div className="flex flex-wrap gap-3 items-end mt-2"><div>{lab("Responsable de la correction")}<select value={frs.resp} onChange={(e) => setFrs({ ...frs, resp: e.target.value })} className={ecInput} style={ecBorder}><option value="">—</option>{staff.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}</select></div><button onClick={() => ajouterReserve(x)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="bt-rs-ajouter">Ajouter la réserve</button></div></div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2"><div>{lab("État")}<select value={rsFiltre} onChange={(e) => setRsFiltre(e.target.value)} data-testid="bt-rs-filtre" className={ecInput} style={ecBorder}><option value="">Toutes</option><option value="ouverte">Ouvertes</option><option value="retard">En retard</option><option value="levee">Levées</option></select></div></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Réserve</th><th>Lieu</th><th>Responsable</th><th>À lever avant</th><th>État</th><th></th></tr></thead>
          <tbody>{rl.map((r) => (<tr key={r.id} data-testid="bt-rs-ligne" style={{ opacity: r.status === "levee" ? 0.6 : 1 }}><td className="py-1.5">{r.label}</td><td className="text-xs">{r.place || "—"}</td><td className="text-xs">{r.resp || "—"}</td><td>{r.due ? ecDateFr(r.due) : "—"}</td><td>{r.status === "levee" ? ecPastille("Levée le " + ecDateFr(r.leveeDate), "ok") : r.due && r.due < today ? ecPastille("En retard", "alerte") : ecPastille("Ouverte", "attente")}</td>
            <td className="text-right whitespace-nowrap">{canEdit && r.status !== "levee" && <button onClick={() => majReserve(x, r, { status: "levee", leveeDate: today })} className="text-xs mr-2" data-testid="bt-rs-lever">Lever</button>}{canEdit && r.status === "levee" && !rc.def && <button onClick={() => majReserve(x, r, { status: "ouverte", leveeDate: "" })} className="text-xs mr-2" data-testid="bt-rs-rouvrir">Rouvrir</button>}{canEdit && r.status !== "levee" && <button onClick={() => maj(x.id, (z) => ({ ...z, reserves: z.reserves.filter((y) => y.id !== r.id) }))} className="text-xs" style={{ color: "#A6432F" }} data-testid="bt-rs-retirer">Retirer</button>}</td></tr>))}</tbody>
          {reservesDe(x).length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="bt-rs-total"><td colSpan={6}>{reservesDe(x).length} réserve(s) : {reservesOuvertes(x).length} ouverte(s) dont {reservesRetard(x).length} en retard, {reservesDe(x).length - reservesOuvertes(x).length} levée(s)</td></tr></tfoot>}</table></div>
        {reservesDe(x).length === 0 && <div className="text-sm mb-3" style={{ color: "#8A8370" }}>Aucune réserve enregistrée.</div>}
        <div className="mt-4">{recBloc("def", "Réception définitive")}</div>
      </div>
    );
  };

  const EtudesSite = (x) => {
    const staff = x.staff || [];
    const lab = (t) => <label className="text-xs" style={{ color: "#8A8370" }}>{t}</label>;
    const etatD = (d) => (d.status === "valide" ? "valide" : d.status === "remis" ? "remis" : d.due && d.due < today ? "retard" : d.status);
    const dl = (x.docs || []).filter((d) => !dcFiltre || etatD(d) === dcFiltre);
    const nb = (x.docs || []).length, val = (x.docs || []).filter((d) => d.status === "valide").length;
    return (
      <div data-testid="bt-etudes">
        <div className="text-sm mb-3" style={{ color: "#5B563F" }}>Phase d'études et de conception : suivez les documents à produire (plans, études, devis, autorisations), leur responsable, leur échéance et leur validation par le client.{nb > 0 && <> Avancement des études : <b data-testid="bt-et-avancement">{val} / {nb}</b> document(s) validé(s).</>}</div>
        <datalist id="bt-dl-doc">{DOCS_COURANTS.map((n) => <option key={n} value={n} />)}</datalist>
        {canEdit && (<div className="ec-card p-3 mb-3"><div className="grid md:grid-cols-4 gap-2 items-end">
          <div className="md:col-span-2">{lab("Document")}<div className="flex gap-1"><input value={fdc.label} onChange={(e) => setFdc({ ...fdc, label: e.target.value })} data-testid="bt-dc-nom" className={ecInput} style={ecBorder} /><BtFleche id="bt-dl-doc" onPick={(v) => setFdc({ ...fdc, label: v })} /></div></div>
          <div>{lab("Référence ou indice (facultatif)")}<input value={fdc.ref} onChange={(e) => setFdc({ ...fdc, ref: e.target.value })} className={ecInput} style={ecBorder} /></div>
          <div>{lab("Responsable")}<select value={fdc.resp} onChange={(e) => setFdc({ ...fdc, resp: e.target.value })} data-testid="bt-dc-resp" className={ecInput} style={ecBorder}><option value="">—</option>{staff.map((m) => <option key={m.id} value={m.name}>{m.name} ({m.role})</option>)}</select></div>
        </div><div className="flex flex-wrap gap-3 items-end mt-2"><div>{lab("Échéance")}<input type="date" value={fdc.due} onChange={(e) => setFdc({ ...fdc, due: e.target.value })} data-testid="bt-dc-echeance" className={ecInput} style={ecBorder} /></div><button onClick={() => ajouterDoc(x)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="bt-dc-ajouter">Ajouter le document</button><button onClick={() => insererDocs(x)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="bt-dc-courants">Insérer les documents courants (à ajuster)</button></div></div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2"><div>{lab("État")}<select value={dcFiltre} onChange={(e) => setDcFiltre(e.target.value)} data-testid="bt-dc-filtre" className={ecInput} style={ecBorder}><option value="">Tous</option><option value="afaire">À faire</option><option value="encours">En cours</option><option value="retard">En retard</option><option value="remis">Remis</option><option value="valide">Validés</option></select></div></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Document</th><th>Réf.</th><th>Responsable</th><th>Échéance</th><th>Remis le</th><th>État</th><th></th></tr></thead>
          <tbody>{dl.map((d) => (<tr key={d.id} data-testid="bt-dc-ligne"><td className="py-1.5">{d.label}</td><td className="text-xs">{d.ref || "—"}</td><td className="text-xs">{d.resp || "—"}</td><td>{d.due ? ecDateFr(d.due) : "—"} {etatD(d) === "retard" ? ecPastille("En retard", "alerte") : null}</td><td className="text-xs">{d.date ? ecDateFr(d.date) : "—"}</td>
            <td>{canEdit ? <select value={d.status} onChange={(e) => majDoc(x, d, { status: e.target.value, date: e.target.value === "remis" || e.target.value === "valide" ? (d.date || today) : "" })} data-testid="bt-dc-etat" className="border rounded px-1 py-0.5 text-xs" style={ecBorder}>{BT_DSTAT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select> : (BT_DSTAT.find((v) => v[0] === d.status) || [0, d.status])[1]}</td>
            <td className="text-right">{canEdit && <button onClick={() => maj(x.id, (r) => ({ ...r, docs: r.docs.filter((y) => y.id !== d.id) }))} className="text-xs" style={{ color: "#A6432F" }} data-testid="bt-dc-retirer">Retirer</button>}</td></tr>))}</tbody>
          {dl.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="bt-dc-total"><td colSpan={7}>{dl.length} document(s), dont {dl.filter((d) => d.status === "valide").length} validé(s) et {dl.filter((d) => etatD(d) === "retard").length} en retard</td></tr></tfoot>}</table></div>
        {dl.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{nb === 0 ? "Aucun document : ajoutez ceux de votre phase d'études, ou insérez les documents courants puis renseignez responsable et échéance." : "Aucun document ne correspond à ce filtre."}</div>}
      </div>
    );
  };

  const VueSite = (x) => {
    const phys = avPhys(x), fact = avFact(x), temps = tempsPct(x), bud = budgetTotal(x), dep = depensesDe(x.id);
    const alertes = [];
    if (phys !== null && phys - fact >= 10) alertes.push("Les travaux exécutés (" + phys + " %) devancent la facturation (" + fact + " %) : pensez à émettre une situation de travaux.");
    if (phys !== null && temps !== null && temps - phys >= 15 && x.status === "encours") alertes.push("Le temps écoulé (" + temps + " %) dépasse l'avancement physique (" + phys + " %) : risque de retard.");
    if (bud > 0 && dep > bud) alertes.push("Les dépenses (" + fmt(dep) + ") dépassent le budget d'exécution (" + fmt(bud) + ").");
    if (phasesRetard(x).length) alertes.push(phasesRetard(x).length + " étape(s) en retard sur la date de fin prévue.");
    if (tachesRetard(x).length) alertes.push(tachesRetard(x).length + " tâche(s) en retard.");
    if (visitesACompleter(x).length) alertes.push(visitesACompleter(x).length + " visite(s) ou réunion(s) à régulariser (réalisée ou annulée).");
    if (reservesRetard(x).length) alertes.push(reservesRetard(x).length + " réserve(s) en retard.");
    if (x.etudes && docsRetard(x).length) alertes.push(docsRetard(x).length + " document(s) d'études en retard.");
    const dans = (d, n) => d && d >= today && btJours(today, d) <= n;
    const ech = [];
    (x.phases || []).forEach((ph) => { if (ph.pct < 100 && dans(ph.start, 14) && !ph.realStart) ech.push({ d: ph.start, t: "Début de l'étape « " + ph.label + " »" }); if (ph.pct < 100 && dans(ph.end, 14)) ech.push({ d: ph.end, t: "Fin prévue de l'étape « " + ph.label + " »" }); });
    (x.tasks || []).forEach((k) => { if (k.status !== "fait" && dans(k.due, 7)) ech.push({ d: k.due, t: "Tâche : " + k.title + " (" + k.assignee + ")" }); });
    (x.visits || []).forEach((v) => { if (v.status === "prevue" && dans(v.date, 14)) ech.push({ d: v.date, t: nomVKind(v.kind) + " : " + v.subject }); });
    reservesOuvertes(x).forEach((r) => { if (dans(r.due, 14)) ech.push({ d: r.due, t: "Réserve à lever : " + r.label }); });
    (x.docs || []).forEach((d) => { if ((d.status === "afaire" || d.status === "encours") && dans(d.due, 14)) ech.push({ d: d.due, t: "Document d'études : " + d.label }); });
    ech.sort((a, b) => String(a.d).localeCompare(String(b.d)));
    const kp = [["Avancement physique", phys === null ? "—" : phys + " %", "bt-vue-phys"], ["Avancement facturé", fact + " %", "bt-vue-fact"], ["Temps écoulé", temps === null ? "—" : temps + " %", "bt-vue-temps"], ["Dépensé / budget", fmt(dep) + (bud > 0 ? " / " + fmt(bud) : ""), "bt-vue-budget"], ["Marge à ce jour (facturé − dépensé)", fmt(btR2(factureHt(x.id) - dep)), "bt-vue-marge"]];
    return (
      <div data-testid="bt-vue">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">{kp.map(([l, v, t]) => (<div key={t} className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>{l}</div><div className="display text-base tabular" data-testid={t} style={{ color: "#152238", border: "none", padding: 0, margin: 0 }}>{v}</div></div>))}</div>
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Points d'attention</div>
        {alertes.length === 0 ? <div className="text-sm mb-4" style={{ color: "#8A8370" }}>Rien à signaler.</div> : <div className="mb-4">{alertes.map((a, i) => (<div key={i} className="text-sm p-2 mb-1 rounded" style={{ background: "#FFF6E0", color: "#152238" }} data-testid="bt-vue-alerte">{a}</div>))}</div>}
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Prochaines échéances (14 jours)</div>
        {ech.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucune échéance proche.</div> : (<div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Quoi</th></tr></thead><tbody>{ech.map((e, i) => (<tr key={i} data-testid="bt-vue-echeance"><td className="py-1.5">{ecDateFr(e.d)}</td><td>{e.t}</td></tr>))}</tbody></table></div>)}
      </div>
    );
  };

  const EtapesSite = (x) => {
    const ph = phasesDe(x);
    const poids = ph.reduce((t, y) => t + (Number(y.weight) || 0), 0);
    const avecDates = ph.filter((y) => y.start && y.end);
    const debut = avecDates.reduce((m, y) => (y.start < m ? y.start : m), "9999-12-31"), fin = avecDates.reduce((m, y) => (y.end > m ? y.end : m), "0000-01-01");
    const span = avecDates.length ? Math.max(1, btJours(debut, fin)) : 0;
    const aujour = span && today >= debut && today <= fin ? (btJours(debut, today) * 100 / span) : null;
    const couleur = { termine: "#0F6B5C", retard: "#A6432F", encours: "#C9A24B", demarrer: "#C9A24B", prevu: "#B8B2A0" };
    const phys = avPhys(x);
    return (
      <div data-testid="bt-etapes">
        <div className="text-sm mb-2" style={{ color: "#5B563F" }}>Avancement physique du chantier : <b className="tabular" data-testid="bt-et-phys">{phys === null ? "—" : phys + " %"}</b>{poids > 0 && Math.abs(poids - 100) > 0.01 && <span style={{ color: "#A6432F" }} data-testid="bt-et-poids-alerte"> — attention : le total des poids est de {poids} %, il devrait être de 100 %.</span>}</div>
        <details className="mb-3 text-sm" style={{ color: "#5B563F" }} data-testid="bt-et-aide"><summary style={{ cursor: "pointer", fontWeight: 600 }}>Comment l'avancement est-il calculé ? (touchez pour lire)</summary>
          <div className="p-3 mt-1 rounded" style={{ background: "#F4F1E6" }}>
            <p className="mb-2">Chaque étape ne pèse pas autant dans le chantier. Le <b>poids</b> est la part de l'étape dans la valeur totale des travaux : si les fondations représentent 30 % de ce que le client paiera, leur poids est 30. Le total des poids de toutes les étapes doit faire 100.</p>
            <p className="mb-2">Le <b>% réalisé</b> est ce qui est déjà fait de l'étape (de 0 à 100). L'avancement du chantier est la somme, pour chaque étape, de « poids × % réalisé », divisée par 100.</p>
            <p className="mb-2"><b>Exemple :</b> Fondations (poids 30, réalisé 100 %), Gros œuvre (poids 50, réalisé 40 %), Finitions (poids 20, réalisé 0 %). Calcul : 30 + 20 + 0 = <b>50 %</b> d'avancement du chantier.</p>
            <p>Vous ne savez pas quel poids donner ? Le bouton « Répartir les poids également » partage 100 entre vos étapes ; vous pourrez ensuite ajuster chaque poids.</p>
          </div></details>
        {avecDates.length > 0 && (<div className="mb-4" data-testid="bt-frise">
          <div className="text-xs mb-1" style={{ color: "#8A8370" }}>Calendrier d'exécution : du {ecDateFr(debut)} au {ecDateFr(fin)}</div>
          <div style={{ position: "relative", background: "#F4F1E6", borderRadius: 6, padding: "6px 0" }}>
            {avecDates.map((y) => (<div key={y.id} title={y.label + " : " + ecDateFr(y.start) + " → " + ecDateFr(y.end)} style={{ position: "relative", height: 20, marginBottom: 3 }}><div style={{ position: "absolute", left: (btJours(debut, y.start) * 100 / span) + "%", width: Math.max(2, btJours(y.start, y.end) * 100 / span) + "%", height: 18, borderRadius: 4, background: couleur[etatPhase(y)], overflow: "hidden", fontSize: 10, color: "#fff", lineHeight: "18px", paddingLeft: 4, whiteSpace: "nowrap" }}>{y.label}</div></div>))}
            {aujour !== null && <div style={{ position: "absolute", top: 0, bottom: 0, left: aujour + "%", width: 2, background: "#152238" }} title="Aujourd'hui"></div>}
          </div>
        </div>)}
        {canEdit && (<div className="ec-card p-3 mb-4"><div className="grid md:grid-cols-5 gap-2 items-end">
          <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Étape</label><div className="flex gap-1"><input value={fph.label} onChange={(e) => setFph({ ...fph, label: e.target.value })} data-testid="bt-ph-nom" className={ecInput} style={ecBorder} /><BtFleche id="bt-dl-etape" onPick={(v) => setFph({ ...fph, label: v })} /></div><datalist id="bt-dl-etape">{PHASES_COURANTES.map((n) => <option key={n} value={n} />)}</datalist></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Début prévu</label><input type="date" value={fph.start} onChange={(e) => setFph({ ...fph, start: e.target.value })} data-testid="bt-ph-debut" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Fin prévue</label><input type="date" value={fph.end} onChange={(e) => setFph({ ...fph, end: e.target.value })} data-testid="bt-ph-fin" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Poids dans le marché (%)</label><input type="number" min="0" max="100" value={fph.weight} onChange={(e) => setFph({ ...fph, weight: e.target.value })} data-testid="bt-ph-poids" className={ecInput + " tabular"} style={ecBorder} /></div>
        </div>
        <div className="flex flex-wrap gap-3 mt-2"><button onClick={() => ajouterPhase(x)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="bt-ph-ajouter">Ajouter l'étape</button><button onClick={() => insererPhases(x)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="bt-ph-courantes">Insérer les étapes courantes (à ajuster)</button><button onClick={() => repartirPoids(x)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="bt-ph-egal">Répartir les poids également</button></div></div>)}
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Étape</th><th>Début prévu</th><th>Fin prévue</th><th className="text-right">Poids %</th><th>Début réel</th><th>Fin réelle</th><th className="text-right">Réalisé %</th><th>État</th><th></th></tr></thead>
          <tbody>{ph.map((y) => (<tr key={y.id} data-testid="bt-phase-ligne"><td className="py-1.5">{y.label}</td>
            <td>{canEdit ? <BtChamp type="date" value={y.start || ""} onCommit={(v) => majPhase(x, y, { start: v })} onSaved={() => showToast("Enregistré ✓")} className="border rounded px-1 py-0.5 text-xs" style={ecBorder} /> : ecDateFr(y.start)}</td>
            <td>{canEdit ? <BtChamp type="date" value={y.end || ""} onCommit={(v) => majPhase(x, y, { end: v })} onSaved={() => showToast("Enregistré ✓")} className="border rounded px-1 py-0.5 text-xs" style={ecBorder} /> : ecDateFr(y.end)}</td>
            <td className="text-right">{canEdit ? <BtChamp type="number" min="0" max="100" value={y.weight === 0 ? "" : y.weight} onCommit={(v) => majPhase(x, y, { weight: Math.max(0, Math.min(100, Number(v) || 0)) })} onSaved={() => showToast("Enregistré ✓")} data-testid="bt-phase-poids" className="border rounded px-1 py-0.5 text-xs tabular" style={{ ...ecBorder, width: 60 }} /> : y.weight}</td>
            <td className="text-xs">{y.realStart ? ecDateFr(y.realStart) : "—"}</td><td className="text-xs">{y.realEnd ? ecDateFr(y.realEnd) : "—"}</td>
            <td className="text-right">{canEdit ? <BtChamp type="number" min="0" max="100" value={y.pct || ""} placeholder="0" onCommit={(v) => changerPct(x, y, v)} onSaved={() => showToast("Enregistré ✓")} data-testid="bt-phase-pct" className="border rounded px-1 py-0.5 text-xs tabular" style={{ ...ecBorder, width: 60 }} /> : y.pct}</td>
            <td data-testid="bt-phase-etat">{pastilleEtat(etatPhase(y))}</td>
            <td className="text-right">{canEdit && <button onClick={() => maj(x.id, (r) => ({ ...r, phases: r.phases.filter((z) => z.id !== y.id) }))} className="text-xs" style={{ color: "#A6432F" }} data-testid="bt-phase-retirer">Retirer</button>}</td></tr>))}</tbody>
          {ph.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }}><td colSpan={3}>Total ({ph.length} étape{ph.length > 1 ? "s" : ""})</td><td className="text-right tabular" data-testid="bt-phase-tot-poids">{poids}</td><td colSpan={5}></td></tr></tfoot>}</table></div>
        {ph.length > 0 && <div className="flex flex-wrap items-center gap-3 mt-3"><button onClick={() => showToast("Étapes enregistrées : " + ph.length + " étape(s), avancement physique " + (phys === null ? "—" : phys + " %") + ".")} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="bt-et-enregistrer">Enregistrer les étapes</button><span className="text-xs" style={{ color: "#7A7460" }}>Chaque case est enregistrée dès que vous la quittez ; ce bouton confirme l'ensemble.</span></div>}
        {ph.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucune étape : ajoutez les phases du chantier, ou insérez les étapes courantes puis renseignez leurs dates et leur poids.</div>}
      </div>
    );
  };

  const BudgetSite = (x) => {
    const b = budgetNat(x);
    const detaille = Object.keys(b).some((k) => Number(b[k]) > 0);
    const tot = budgetTotal(x), dep = depensesDe(x.id), m = btMarche(x);
    return (
      <div data-testid="bt-budget">
        <div className="text-sm mb-3" style={{ color: "#5B563F" }}>Le budget d'exécution est ce que vous prévoyez <b>dépenser</b> pour réaliser le chantier ; il se compare automatiquement aux dépenses enregistrées. Marché (hors taxe) : <b className="tabular">{fmt(m)}</b>{tot > 0 && m > 0 && <> · marge prévue : <b className="tabular" data-testid="bt-bud-marge-prevue">{fmt(btR2(m - tot))}</b></>}</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Nature</th><th className="text-right">Budget prévu</th><th className="text-right">Dépensé</th><th className="text-right">Reste à engager</th><th className="text-right">Consommé</th></tr></thead>
          <tbody>{BT_DEPENSES.map(([k, l]) => { const bu = Number(b[k]) || 0, d = depNat(x, k); return (<tr key={k} data-testid="bt-bud-ligne"><td className="py-1.5">{l}</td>
            <td className="text-right">{canEdit ? <BtChamp type="number" min="0" value={bu || ""} placeholder="0" onCommit={(v) => majBudget(x, k, v)} onSaved={() => showToast("Enregistré ✓")} data-testid={"bt-bud-" + k} className="border rounded px-1 py-0.5 text-xs tabular" style={{ ...ecBorder, width: 110 }} /> : fmt(bu)}</td>
            <td className="text-right tabular">{fmt(d)}</td><td className="text-right tabular">{bu > 0 ? fmt(btR2(bu - d)) : "—"}</td><td className="text-right tabular">{bu > 0 ? (d > bu ? ecPastille(Math.round(d * 100 / bu) + " % — dépassé", "alerte") : Math.round(d * 100 / bu) + " %") : "—"}</td></tr>); })}</tbody>
          <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="bt-bud-total"><td>Total</td><td className="text-right tabular" data-testid="bt-bud-tot-budget">{fmt(tot)}</td><td className="text-right tabular" data-testid="bt-bud-tot-dep">{fmt(dep)}</td><td className="text-right tabular">{tot > 0 ? fmt(btR2(tot - dep)) : "—"}</td><td className="text-right tabular">{tot > 0 ? Math.round(dep * 100 / tot) + " %" : "—"}</td></tr></tfoot></table></div>
        {!detaille && (<div className="mt-3 grid md:grid-cols-4 gap-2 items-end"><div><label className="text-xs" style={{ color: "#8A8370" }}>Budget global (si vous ne détaillez pas par nature)</label><BtChamp type="number" min="0" value={x.budget || ""} disabled={!canEdit} onCommit={(v) => maj(x.id, (r) => ({ ...r, budget: Number(v) || 0 }))} onSaved={() => showToast("Enregistré ✓")} data-testid="bt-ch-budget-edit" className={ecInput + " tabular"} style={ecBorder} /></div></div>)}
        {detaille && <div className="text-xs mt-2" style={{ color: "#7A7460" }}>Le budget total est la somme des lignes ci-dessus.</div>}
        <div className="flex flex-wrap items-center gap-3 mt-3"><button onClick={() => showToast("Budget d'exécution enregistré : total " + fmt(tot) + (m > 0 && tot > 0 ? ", marge prévue " + fmt(btR2(m - tot)) : "") + ".")} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="bt-bud-enregistrer">Enregistrer le budget</button><span className="text-xs" style={{ color: "#7A7460" }}>Chaque montant est enregistré dès que vous quittez la case ; ce bouton confirme le total.</span></div>
      </div>
    );
  };

  const TachesSite = (x) => {
    const staff = x.staff || [];
    const etatT = (k) => (k.status === "fait" ? "fait" : k.due && k.due < today ? "retard" : k.status);
    const tl = (x.tasks || []).filter((k) => (!tke || etatT(k) === tke) && (!tkr || btNom(k.assignee) === btNom(tkr))).sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999")));
    const prioPoids = { haute: 0, normale: 1, basse: 2 };
    tl.sort((a, b) => (a.status === "fait") - (b.status === "fait") || prioPoids[a.priority] - prioPoids[b.priority]);
    const nomPhase = (id) => ((x.phases || []).find((y) => y.id === id) || {}).label || "";
    return (
      <div data-testid="bt-taches">
        <div className="display text-base mb-2 mt-4" style={{ color: "#152238" }}>Tâches de l'équipe d'encadrement</div>
        <datalist id="bt-dl-tache">{["Contrôle de l'implantation et des niveaux", "Validation des quantités exécutées pour la situation", "Visite de contrôle de la qualité des travaux", "Pointage quotidien des ouvriers", "Réception et contrôle des matériaux livrés", "Rédaction du rapport journalier", "Vérification de la sécurité sur le chantier", "Commande des matériaux de la semaine", "Coordination des sous-traitants"].map((n) => <option key={n} value={n} />)}</datalist>
        {canEdit && (<div className="ec-card p-3 mb-3"><div className="grid md:grid-cols-5 gap-2 items-end">
          <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Tâche</label><div className="flex gap-1"><input value={ftk.title} onChange={(e) => setFtk({ ...ftk, title: e.target.value })} data-testid="bt-tache-titre" className={ecInput} style={ecBorder} /><BtFleche id="bt-dl-tache" onPick={(v) => setFtk({ ...ftk, title: v })} /></div></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Responsable</label><select value={ftk.assignee} onChange={(e) => setFtk({ ...ftk, assignee: e.target.value })} data-testid="bt-tache-resp" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{staff.map((m) => <option key={m.id} value={m.name}>{m.name} ({m.role})</option>)}</select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Échéance</label><input type="date" value={ftk.due} onChange={(e) => setFtk({ ...ftk, due: e.target.value })} data-testid="bt-tache-echeance" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Priorité</label><select value={ftk.priority} onChange={(e) => setFtk({ ...ftk, priority: e.target.value })} data-testid="bt-tache-prio" className={ecInput} style={ecBorder}>{BT_PRIO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        </div>
        <div className="grid md:grid-cols-5 gap-2 items-end mt-2"><div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Étape concernée (facultatif)</label><select value={ftk.phaseId} onChange={(e) => setFtk({ ...ftk, phaseId: e.target.value })} data-testid="bt-tache-etape" className={ecInput} style={ecBorder}><option value="">—</option>{phasesDe(x).map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}</select></div>
          <button onClick={() => ajouterTache(x)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="bt-tache-ajouter">Ajouter la tâche</button></div>
        {staff.length === 0 && <div className="text-xs mt-2" style={{ color: "#8A8370" }}>Affectez d'abord une personne au chantier (section Encadrement ci-dessus) pour lui confier des tâches.</div>}</div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <div><label className="text-xs" style={{ color: "#8A8370" }}>État</label><select value={tke} onChange={(e) => setTke(e.target.value)} data-testid="bt-tache-filtre-etat" className={ecInput} style={ecBorder}><option value="">Tous</option><option value="afaire">À faire</option><option value="encours">En cours</option><option value="retard">En retard</option><option value="fait">Faite</option></select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Responsable</label><select value={tkr} onChange={(e) => setTkr(e.target.value)} className={ecInput} style={ecBorder}><option value="">Tous</option>{staff.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}</select></div>
        </div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Tâche</th><th>Responsable</th><th>Étape</th><th>Échéance</th><th>Priorité</th><th>État</th><th></th></tr></thead>
          <tbody>{tl.map((k) => (<tr key={k.id} data-testid="bt-tache-ligne" style={{ opacity: k.status === "fait" ? 0.6 : 1 }}><td className="py-1.5">{k.title}</td><td className="text-xs">{k.assignee}</td><td className="text-xs">{nomPhase(k.phaseId) || "—"}</td><td>{k.due ? ecDateFr(k.due) : "—"} {etatT(k) === "retard" ? ecPastille("En retard", "alerte") : null}</td><td className="text-xs">{(BT_PRIO.find((p2) => p2[0] === k.priority) || [0, k.priority])[1]}</td>
            <td>{canEdit ? <select value={k.status} onChange={(e) => majTache(x, k, { status: e.target.value })} data-testid="bt-tache-etat" className="border rounded px-1 py-0.5 text-xs" style={ecBorder}>{BT_TSTAT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select> : (BT_TSTAT.find((v) => v[0] === k.status) || [0, k.status])[1]}</td>
            <td className="text-right">{canEdit && <button onClick={() => maj(x.id, (r) => ({ ...r, tasks: r.tasks.filter((y) => y.id !== k.id) }))} className="text-xs" style={{ color: "#A6432F" }} data-testid="bt-tache-retirer">Retirer</button>}</td></tr>))}</tbody>
          {tl.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="bt-tache-total"><td colSpan={7}>{tl.length} tâche{tl.length > 1 ? "s" : ""}, dont {tl.filter((k) => etatT(k) === "retard").length} en retard et {tl.filter((k) => k.status === "fait").length} faite{tl.filter((k) => k.status === "fait").length > 1 ? "s" : ""}</td></tr></tfoot>}</table></div>
        {tl.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{(x.tasks || []).length === 0 ? "Aucune tâche." : "Aucune tâche ne correspond à ces filtres."}</div>}
      </div>
    );
  };

  const Chantiers = () => {
    const s = sites.find((x) => x.id === selSite);
    const sF = sites.filter((x) => (!sst || x.status === sst) && (!sq.trim() || [x.number, x.name, nomClient(x.clientId), x.address, respDe(x)].join(" ").toLowerCase().includes(sq.trim().toLowerCase()))).sort((a, b) => String(b.number).localeCompare(String(a.number)));
    const avanc = (x) => { const m = btMarche(x); return m > 0 ? Math.round(factureHt(x.id) * 100 / m) : 0; };
    return (
      <div>
        {canEdit && (<div className="ec-card p-4 mb-5" data-testid="bt-nouveau-chantier"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouveau chantier</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom du chantier</label><input value={fs.name} onChange={(e) => setFs({ ...fs, name: e.target.value })} data-testid="bt-ch-nom" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Client</label><select value={fs.clientId} onChange={(e) => setFs({ ...fs, clientId: e.target.value })} data-testid="bt-ch-client" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Adresse du chantier</label><input value={fs.address} onChange={(e) => setFs({ ...fs, address: e.target.value })} className={ecInput} style={ecBorder} /></div>
          </div>
          <div className="grid md:grid-cols-3 gap-2 items-end mt-2">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Chef de chantier ou responsable (facultatif)</label><div className="flex gap-1"><input value={fs.lead} onChange={(e) => setFs({ ...fs, lead: e.target.value })} data-testid="bt-ch-responsable" className={ecInput} style={ecBorder} /><BtFleche id="bt-dl-staff" onPick={(v) => setFs({ ...fs, lead: v })} /></div></div>
          </div>
          <div className="grid md:grid-cols-5 gap-2 items-end mt-2">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Début</label><input type="date" value={fs.start} onChange={(e) => setFs({ ...fs, start: e.target.value })} data-testid="bt-ch-debut" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Fin prévue (facultatif)</label><input type="date" value={fs.end} onChange={(e) => setFs({ ...fs, end: e.target.value })} data-testid="bt-ch-fin" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Retenue de garantie (% — selon le marché)</label><input type="number" min="0" max="30" step="0.5" value={fs.retPct} onChange={(e) => setFs({ ...fs, retPct: e.target.value })} data-testid="bt-ch-retenue" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Budget de dépenses (facultatif)</label><input type="number" min="0" value={fs.budget} onChange={(e) => setFs({ ...fs, budget: e.target.value })} data-testid="bt-ch-budget" className={ecInput + " tabular"} style={ecBorder} /></div>
            <button onClick={creerChantier} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="bt-ch-creer">Créer le chantier</button>
          </div>
          {clients.length === 0 && <div className="text-xs mt-2" style={{ color: "#8A8370" }}>Aucun client : enregistrez d'abord le maître d'ouvrage dans l'onglet Clients.</div>}
        </div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <div className="flex-1 min-w-[150px]"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (n°, chantier, client, adresse, responsable)</label><input value={sq} onChange={(e) => setSq(e.target.value)} data-testid="bt-ch-recherche" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>État</label><select value={sst} onChange={(e) => setSst(e.target.value)} data-testid="bt-ch-filtre-etat" className={ecInput} style={ecBorder}><option value="">Tous</option>{BT_ETATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        </div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>Chantier</th><th>Client</th><th>Responsable</th><th className="text-right">Marché</th><th className="text-right">Avancement</th><th className="text-right">Facturé (HT)</th><th className="text-right">Dépenses</th><th>État</th><th></th></tr></thead>
          <tbody>{sF.map((x) => (<tr key={x.id} data-testid="bt-ch-ligne" style={{ background: x.id === selSite ? "#E6F1EE" : undefined }}><td className="py-1.5 tabular text-xs">{x.number}</td><td className="font-semibold">{x.name}</td><td>{nomClient(x.clientId)}</td><td className="text-xs" data-testid="bt-ch-resp">{respDe(x)}</td><td className="text-right tabular">{fmt(btMarche(x))}</td><td className="text-right tabular">{avanc(x)} %</td><td className="text-right tabular">{fmt(factureHt(x.id))}</td><td className="text-right tabular">{fmt(depensesDe(x.id))}</td>
            <td>{x.status === "termine" ? ecPastille("Terminé", "ok") : x.status === "suspendu" ? ecPastille("Suspendu", "alerte") : x.status === "preparation" ? ecPastille("En préparation", "neutre") : ecPastille("En cours", "attente")}</td>
            <td className="text-right whitespace-nowrap"><button onClick={() => { setSelSite(x.id === selSite ? "" : x.id); setSub("vue"); setEdS(null); }} className="text-xs underline" data-testid="bt-ch-ouvrir">{x.id === selSite ? "Fermer" : "Ouvrir"}</button></td></tr>))}</tbody>
          {sF.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="bt-ch-total-ligne"><td colSpan={4}>Total ({sF.length} chantier{sF.length > 1 ? "s" : ""})</td><td className="text-right tabular" data-testid="bt-ch-tot-marche">{fmt(btR2(sF.reduce((t, x) => t + btMarche(x), 0)))}</td><td></td><td className="text-right tabular" data-testid="bt-ch-tot-fact">{fmt(btR2(sF.reduce((t, x) => t + factureHt(x.id), 0)))}</td><td className="text-right tabular" data-testid="bt-ch-tot-dep">{fmt(btR2(sF.reduce((t, x) => t + depensesDe(x.id), 0)))}</td><td colSpan={2}></td></tr></tfoot>}</table></div>
        {sF.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{sites.length === 0 ? "Aucun chantier." : "Aucun chantier ne correspond à ces filtres."}</div>}
        {s && (<div className="ec-card p-4 mt-5" data-testid="bt-ch-detail">
          <div className="display text-lg mb-1" style={{ color: "#152238" }}>{s.number} — {s.name}</div>
          <div className="text-sm mb-3" style={{ color: "#5B563F" }}>Client : {nomClient(s.clientId)}{s.address ? " · " + s.address : ""} · du {ecDateFr(s.start)}{s.end ? " au " + ecDateFr(s.end) : ""}</div>
          {canEdit && !edS && <div className="mb-3"><button onClick={() => ouvrirModif(s)} className="px-3 py-1.5 rounded text-sm" style={ecBtn} data-testid="bt-ch-modifier">Modifier le dossier</button></div>}
          {canEdit && edS && edS.id === s.id && (<div className="ec-card p-3 mb-3" data-testid="bt-md-form"><div className="display text-base mb-2" style={{ color: "#152238" }}>Modifier le dossier {s.number}</div>
            <div className="grid md:grid-cols-4 gap-2 items-end">
              <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom du chantier</label><input value={edS.name} onChange={(e) => setEdS({ ...edS, name: e.target.value })} data-testid="bt-md-nom" className={ecInput} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Client</label><select value={edS.clientId} onChange={(e) => setEdS({ ...edS, clientId: e.target.value })} data-testid="bt-md-client" className={ecInput} style={ecBorder}>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Adresse du chantier</label><input value={edS.address} onChange={(e) => setEdS({ ...edS, address: e.target.value })} data-testid="bt-md-adresse" className={ecInput} style={ecBorder} /></div>
            </div>
            <div className="grid md:grid-cols-4 gap-2 items-end mt-2">
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Début</label><input type="date" value={edS.start} onChange={(e) => setEdS({ ...edS, start: e.target.value })} data-testid="bt-md-debut" className={ecInput} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Fin prévue</label><input type="date" value={edS.end} onChange={(e) => setEdS({ ...edS, end: e.target.value })} data-testid="bt-md-fin" className={ecInput} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Retenue de garantie (%)</label><input type="number" min="0" max="30" step="0.5" value={edS.retPct} disabled={sitsDe(s.id).length > 0} onChange={(e) => setEdS({ ...edS, retPct: e.target.value })} data-testid="bt-md-retenue" className={ecInput + " tabular"} style={ecBorder} /></div>
            </div>
            {sitsDe(s.id).length > 0 && <div className="text-xs mt-1" style={{ color: "#7A7460" }}>La retenue de garantie est figée : des situations ont déjà été émises.</div>}
            <div className="flex flex-wrap gap-2 mt-3"><button onClick={() => enregistrerModif(s)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="bt-md-enregistrer">Enregistrer les modifications</button><button onClick={() => setEdS(null)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="bt-md-annuler">Annuler</button></div>
          </div>)}
          <div className="grid md:grid-cols-4 gap-2 mb-3 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>État du chantier</label><select value={s.status} disabled={!canEdit} onChange={(e) => maj(s.id, (r) => ({ ...r, status: e.target.value }))} data-testid="bt-ch-etat" className={ecInput} style={ecBorder}>{BT_ETATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Fin prévue</label><input type="date" value={s.end || ""} disabled={!canEdit} onChange={(e) => maj(s.id, (r) => ({ ...r, end: e.target.value }))} className={ecInput} style={ecBorder} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm mb-3" style={{ color: "#5B563F" }}><input type="checkbox" checked={!!s.etudes} disabled={!canEdit} onChange={(e) => changerEtudes(s, e.target.checked)} data-testid="bt-ch-etudes" />Ce chantier comprend une phase d'études (plans, étude de sol, autorisations…)</label>
          <div className="flex flex-wrap gap-1 mb-4" style={{ borderBottom: "1px solid #E4DDC8", paddingBottom: 8 }}>
            {[["vue", "Vue d'ensemble"], ["etapes", "Étapes d'exécution"], ["budget", "Budget d'exécution"], ["equipe", "Encadrement et tâches"], ["mo", "Main-d'œuvre"], ["sup", "Supervision et journal"], ["recep", "Réception et réserves"], ...(s.etudes ? [["etudes", "Études et plan"]] : []), ["marche", "Marché, avances et retenue"]].map(([id, l]) => (<button key={id} onClick={() => setSub(id)} data-testid={"bt-sub-" + id} className="px-3 py-1.5 text-sm rounded-lg" style={{ background: sub === id ? "#E6F1EE" : "transparent", color: sub === id ? "#152238" : "#6B6552", fontWeight: sub === id ? 600 : 500, border: "1px solid " + (sub === id ? "#0F6B5C" : "#E4DDC8") }}>{l}</button>))}
          </div>
          {sub === "vue" && VueSite(s)}
          {sub === "etapes" && EtapesSite(s)}
          {sub === "budget" && BudgetSite(s)}
          {sub === "equipe" && (<div>
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Encadrement du chantier</div>
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Nom</th><th>Fonction</th><th>Téléphone</th><th className="text-right">Tâches ouvertes</th><th></th></tr></thead>
            <tbody>{(s.staff || []).map((m) => (<tr key={m.id} data-testid="bt-staff-ligne"><td className="py-1.5">{m.name}</td><td>{m.role}</td><td>{m.phone || "—"}</td><td className="text-right tabular">{(s.tasks || []).filter((k) => k.status !== "fait" && btNom(k.assignee) === btNom(m.name)).length}</td><td className="text-right">{canEdit && <button onClick={() => maj(s.id, (r) => ({ ...r, staff: r.staff.filter((y) => y.id !== m.id) }))} className="text-xs" style={{ color: "#A6432F" }} data-testid="bt-staff-retirer">Retirer</button>}</td></tr>))}</tbody></table></div>
          {(s.staff || []).length === 0 && <div className="text-sm mb-2" style={{ color: "#8A8370" }}>Personne n'est encore affecté à ce chantier.</div>}
          {canEdit && (<div className="grid md:grid-cols-4 gap-2 mt-2 mb-5 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Nom</label><div className="flex gap-1"><input value={fst.name} onChange={(e) => setFst({ ...fst, name: e.target.value })} data-testid="bt-staff-nom" className={ecInput} style={ecBorder} /><BtFleche id="bt-dl-staff" onPick={(v) => setFst({ ...fst, name: v })} /></div></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Fonction (conducteur de travaux, chef de chantier…)</label><div className="flex gap-1"><input value={fst.role} onChange={(e) => setFst({ ...fst, role: e.target.value })} data-testid="bt-staff-role" className={ecInput} style={ecBorder} /><BtFleche id="bt-dl-role" onPick={(v) => setFst({ ...fst, role: v })} /></div></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Téléphone (facultatif)</label><input type="tel" value={fst.phone} onChange={(e) => setFst({ ...fst, phone: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <button onClick={() => ajouterEncadrant(s)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="bt-staff-ajouter">Affecter au chantier</button>
          </div>)}
          {TachesSite(s)}
          </div>)}
          {sub === "mo" && MoSite(s)}
          {sub === "sup" && SupSite(s)}
          {sub === "recep" && RecepSite(s)}
          {sub === "etudes" && s.etudes && EtudesSite(s)}
          {sub === "marche" && (<div>
          {(() => {
            const fact = factureHt(s.id), mar = btMarche(s);
            const sl = sitsDe(s.id), enc = btR2(sl.reduce((t, y) => t + btSolde(y).paye, 0)), reste = btR2(sl.reduce((t, y) => t + btSolde(y).reste, 0));
            const aEncaisser = sl.find((y) => btSolde(y).reste > 0.004);
            return (<div className="ec-card p-3 mb-4" data-testid="bt-suivi-marche">
              <div className="display text-base mb-2" style={{ color: "#152238" }}>Suivi du marché et encaissement</div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">{[["Marché (hors taxe)", mar, "bt-sm-marche"], ["Travaux facturés", fact, "bt-sm-facture"], ["Déjà encaissé", enc, "bt-sm-encaisse"], ["Reste à encaisser", reste, "bt-sm-reste"], ["Retenue à libérer", retenueDue(s.id), "bt-sm-retenue"]].map(([l, v, t]) => (<div key={t} className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>{l}</div><div className="display text-base tabular" data-testid={t} style={{ color: "#152238", border: "none", padding: 0, margin: 0 }}>{fmt(v)}</div></div>))}</div>
              <div className="text-xs mb-2" style={{ color: "#5B563F" }}>On ne facture pas le bordereau en une fois : à chaque étape des travaux vous émettez une <b>situation de travaux</b> (quantités réellement exécutées), puis vous <b>encaissez</b> le paiement du client sur cette situation.</div>
              <div className="flex flex-wrap gap-2">
                {canFront && <button onClick={() => { if (mar <= 0) { showToast("Ajoutez d'abord les lignes du bordereau de prix."); return; } setSd({ siteId: s.id, cum: {} }); setTab("situations"); }} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="bt-sm-emettre">Émettre une situation de travaux</button>}
                {canFront && <button onClick={() => { if (!aEncaisser) { showToast("Aucune situation à encaisser pour ce chantier."); return; } setSelSit(aEncaisser.id); setTab("situations"); }} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="bt-sm-encaisser">Encaisser une situation</button>}
              </div>
            </div>);
          })()}
          <div className="grid md:grid-cols-3 gap-2 mb-4 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Retenue de garantie (%)</label><BtChamp type="number" min="0" max="30" step="0.5" value={s.retPct || ""} disabled={!canEdit || sitsDe(s.id).length > 0} onCommit={(v) => maj(s.id, (r) => ({ ...r, retPct: Math.min(30, Math.max(0, Number(v) || 0)) }))} onSaved={() => showToast("Enregistré ✓")} data-testid="bt-marche-retpct" className={ecInput + " tabular"} style={ecBorder} /></div>
          </div>
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap"><div className="display text-base" style={{ color: "#152238" }}>Bordereau de prix (devis)</div><button onClick={() => setImprimer({ kind: "devis", id: s.id })} className="text-xs underline" data-testid="bt-ch-devis">Imprimer le devis</button></div>
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Désignation</th><th>Unité</th><th className="text-right">Quantité</th><th className="text-right">Prix unitaire</th><th className="text-right">Montant</th><th></th></tr></thead>
            <tbody>{(s.lines || []).map((l) => (<tr key={l.id} data-testid="bt-ligne"><td className="py-1.5">{canEdit ? <BtChamp value={l.label} onCommit={(v) => majLigne(s, l, { label: String(v).trim() })} onSaved={() => showToast("Enregistré ✓")} data-testid="bt-ligne-label" className="border rounded px-1 py-0.5 text-sm" style={{ ...ecBorder, width: "100%", minWidth: 120 }} /> : l.label}</td><td>{canEdit ? <BtChamp value={l.unit || ""} onCommit={(v) => majLigne(s, l, { unit: String(v).trim() })} onSaved={() => showToast("Enregistré ✓")} className="border rounded px-1 py-0.5 text-xs" style={{ ...ecBorder, width: 70 }} /> : (l.unit || "—")}</td><td className="text-right tabular">{canEdit && sitsDe(s.id).length === 0 ? <BtChamp type="number" min="0" step="0.01" value={l.qty} onCommit={(v) => majLigne(s, l, { qty: btQ(v) })} onSaved={() => showToast("Enregistré ✓")} data-testid="bt-ligne-qte" className="border rounded px-1 py-0.5 text-xs tabular" style={{ ...ecBorder, width: 80 }} /> : l.qty}</td><td className="text-right tabular">{canEdit && sitsDe(s.id).length === 0 ? <BtChamp type="number" min="0" value={l.pu} onCommit={(v) => majLigne(s, l, { pu: btR2(v) })} onSaved={() => showToast("Enregistré ✓")} data-testid="bt-ligne-pu" className="border rounded px-1 py-0.5 text-xs tabular" style={{ ...ecBorder, width: 100 }} /> : fmt(l.pu)}</td><td className="text-right tabular">{fmt(btR2(l.qty * l.pu))}</td><td className="text-right">{canEdit && sitsDe(s.id).length === 0 && <button onClick={() => retirerLigne(s, l)} className="text-xs" style={{ color: "#A6432F" }} data-testid="bt-ligne-retirer">Retirer</button>}</td></tr>))}</tbody>
            {(s.lines || []).length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }}><td colSpan={4}>Total du marché (hors taxe)</td><td className="text-right tabular" data-testid="bt-marche">{fmt(btMarche(s))}</td><td></td></tr></tfoot>}</table></div>
          {(s.lines || []).length === 0 && <div className="text-sm mb-2" style={{ color: "#8A8370" }}>Aucune ligne : ajoutez les travaux du marché ci-dessous.</div>}
          {canEdit && (<div className="grid md:grid-cols-5 gap-2 mt-2 items-end">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Désignation des travaux</label><div className="flex gap-1"><input value={fl.label} onChange={(e) => setFl({ ...fl, label: e.target.value })} data-testid="bt-lg-label" className={ecInput} style={ecBorder} /><BtFleche id="bt-dl-ligne" onPick={(v) => setFl({ ...fl, label: v })} /></div></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Unité</label><div className="flex gap-1"><input value={fl.unit} onChange={(e) => setFl({ ...fl, unit: e.target.value })} data-testid="bt-lg-unite" className={ecInput} style={ecBorder} /><BtFleche id="bt-dl-unite" onPick={(v) => setFl({ ...fl, unit: v })} /></div></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Quantité</label><input type="number" min="0" step="0.01" value={fl.qty} onChange={(e) => setFl({ ...fl, qty: e.target.value })} data-testid="bt-lg-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Prix unitaire (gourdes)</label><input type="number" min="0" value={fl.pu} onChange={(e) => setFl({ ...fl, pu: e.target.value })} data-testid="bt-lg-pu" className={ecInput + " tabular"} style={ecBorder} /></div>
          </div>)}
          {canEdit && <div className="flex flex-wrap gap-2 items-center mt-2"><button onClick={() => ajouterLigne(s)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="bt-lg-ajouter">Ajouter la ligne</button><button onClick={() => showToast("Marché enregistré : retenue de garantie " + (Number(s.retPct) || 0) + " %, " + (s.lines || []).length + " ligne(s) au bordereau, total hors taxe " + fmt(btMarche(s)) + ".")} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="bt-marche-enregistrer">Enregistrer le marché</button><span className="text-xs" style={{ color: "#7A7460" }}>Les lignes et la retenue sont enregistrées au fur et à mesure ; ce bouton confirme l'ensemble.</span></div>}
          <div className="display text-base mb-2 mt-5" style={{ color: "#152238" }}>Avance de démarrage</div>
          <div className="text-sm mb-2" style={{ color: "#5B563F" }}>Reçue : <b className="tabular" data-testid="bt-avance-recue">{fmt(avanceTotale(s))}</b> · récupérée sur les situations : <b className="tabular" data-testid="bt-avance-recup">{fmt(avanceRecuperee(s.id))}</b> · reste à récupérer : <b className="tabular">{fmt(btR2(avanceTotale(s) - avanceRecuperee(s.id)))}</b></div>
          {(s.avances || []).length > 0 && (<div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Mode</th><th className="text-right">Montant</th><th>État</th><th></th></tr></thead>
            <tbody>{s.avances.map((a) => (<tr key={a.id} data-testid="bt-avance-ligne" style={{ opacity: a.status === "annulé" ? 0.55 : 1 }}><td className="py-1.5">{ecDateFr(a.date)}</td><td>{a.mode === "banque" ? "Banque" : "Espèces"}</td><td className="text-right tabular">{fmt(a.amount)}</td><td>{a.status === "annulé" ? ecPastille("Annulée", "neutre") : ecPastille("Reçue", "ok")}</td><td className="text-right">{canEdit && a.status !== "annulé" && <button onClick={() => annulerAvance(s, a)} className="text-xs" style={{ color: "#A6432F" }} data-testid="bt-avance-annuler">Annuler</button>}</td></tr>))}</tbody></table></div>)}
          {canEdit && (<div className="grid md:grid-cols-4 gap-2 mt-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant de l'avance</label><input type="number" min="0" value={fav.amount} onChange={(e) => setFav({ ...fav, amount: e.target.value })} data-testid="bt-avance-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Mode</label><select value={fav.mode} onChange={(e) => setFav({ ...fav, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Espèces</option><option value="banque">Banque</option></select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" value={fav.date} max={todayStr()} onChange={(e) => setFav({ ...fav, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <button onClick={() => recevoirAvance(s)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="bt-avance-valider">Enregistrer l'avance</button>
          </div>)}
          <div className="display text-base mb-2 mt-5" style={{ color: "#152238" }}>Retenue de garantie</div>
          <div className="text-sm mb-2" style={{ color: "#5B563F" }}>Retenue à libérer : <b className="tabular" data-testid="bt-retenue-due">{fmt(retenueDue(s.id))}</b> (taux de {s.retPct || 0} % sur chaque situation ; règle de libération : {s.retRule === "prov" ? "à la réception provisoire" : s.retRule === "def" ? "à la réception définitive" : "quand le chantier est terminé"} — modifiable dans « Réception et réserves »)</div>
          {rels.filter((r) => r.siteId === s.id).length > 0 && (<div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Mode</th><th className="text-right">Montant</th><th>État</th><th></th></tr></thead>
            <tbody>{rels.filter((r) => r.siteId === s.id).map((r) => (<tr key={r.id} data-testid="bt-retrel-ligne" style={{ opacity: r.status === "annulé" ? 0.55 : 1 }}><td className="py-1.5">{ecDateFr(r.date)}</td><td>{r.mode === "banque" ? "Banque" : "Espèces"}</td><td className="text-right tabular">{fmt(r.amount)}</td><td>{r.status === "annulé" ? ecPastille("Annulé", "neutre") : ecPastille("Encaissée", "ok")}</td><td className="text-right">{canEdit && r.status !== "annulé" && <button onClick={() => annulerLiberation(r)} className="text-xs" style={{ color: "#A6432F" }} data-testid="bt-retrel-annuler">Annuler</button>}</td></tr>))}</tbody></table></div>)}
          {canEdit && retenueDue(s.id) > 0.004 && (<div className="grid md:grid-cols-4 gap-2 mt-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant reçu (vide = tout)</label><input type="number" min="0" value={frt.amount} onChange={(e) => setFrt({ ...frt, amount: e.target.value })} data-testid="bt-retrel-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Mode</label><select value={frt.mode} onChange={(e) => setFrt({ ...frt, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Espèces</option><option value="banque">Banque</option></select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" value={frt.date} max={todayStr()} onChange={(e) => setFrt({ ...frt, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <button onClick={() => liberer(s)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="bt-retrel-valider">Encaisser la retenue</button>
          </div>)}
          </div>)}
        </div>)}
      </div>
    );
  };

  // ───────── Situations de travaux ─────────
  const [sd, setSd] = useState({ siteId: "", cum: {} });
  const [pp, setPp] = useBrouillon("btp-paiement", { amount: "", mode: "caisse", date: todayStr() });
  const [xq, setXq] = useState(""); const [xet, setXet] = useState(""); const [xd1, setXd1] = useState(""); const [xd2, setXd2] = useState("");
  const etatSit = (x) => (x.status === "annulee" ? "annulee" : btSolde(x).reste <= 0.004 ? "soldee" : "encaisser");
  const siteChoisi = sites.find((x) => x.id === sd.siteId);
  const prevQty = (site, l) => { const d = derniere(site.id); return d && d.cum ? Number(d.cum[l.id]) || 0 : 0; };
  const cumEff = (site) => { const o = {}; (site.lines || []).forEach((l) => { const v = sd.cum[l.id]; o[l.id] = v === undefined || v === "" ? prevQty(site, l) : Number(v) || 0; }); return o; };
  const emettreSituation = () => {
    if (!canFront) return;
    const site = siteChoisi;
    if (!site) { showToast("Choisissez le chantier."); return; }
    if (!(site.lines || []).length) { showToast("Ce chantier n'a pas encore de bordereau de prix."); return; }
    const cum = cumEff(site);
    for (const l of site.lines) {
      if (cum[l.id] > l.qty + 0.0001) { showToast("« " + l.label + " » : la quantité cumulée dépasse la quantité du marché (" + l.qty + ")."); return; }
      if (cum[l.id] < prevQty(site, l) - 0.0001) { showToast("« " + l.label + " » : la quantité cumulée ne peut pas être inférieure à la situation précédente (" + prevQty(site, l) + ")."); return; }
    }
    const c = calcSit(site, cum);
    if (!(c.ht > 0)) { showToast("Aucun avancement nouveau : augmentez la quantité cumulée d'au moins une ligne."); return; }
    if (!verifDate(today, "émettre cette situation")) return;
    const number = numero("DC", sits, today);
    const n = sits.filter((x) => x.siteId === site.id).reduce((m, x) => Math.max(m, x.n || 0), 0) + 1;
    btAjouterComptes(accounts, setAccounts, ["411", "706", ...(c.retenue > 0 ? ["4117"] : []), ...(c.recup > 0 ? ["4191"] : []), ...(c.tca > 0 ? ["445"] : [])]);
    const e = ecrire(today, "Situation n° " + n + " " + number + " — " + site.name + " (" + nomClient(site.clientId) + ")", [{ account: "411", debit: c.net, credit: 0 }, { account: "4117", debit: c.retenue, credit: 0 }, { account: "4191", debit: c.recup, credit: 0 }, { account: "706", debit: 0, credit: c.ht }, { account: "445", debit: 0, credit: c.tca }], number);
    const id = btId();
    const lignes = site.lines.map((l) => ({ id: l.id, label: l.label, unit: l.unit, qty: l.qty, pu: l.pu, prevQty: prevQty(site, l), cumQty: cum[l.id], montant: btR2(cum[l.id] * l.pu) }));
    ajouter({ type: "sit", id, number, n, date: today, siteId: site.id, clientId: site.clientId, cum, lignes, marche: btMarche(site), cumHt: c.cumHt, prevHt: c.prevHt, ht: c.ht, tcaRate: c.tca > 0 ? tcaRate : 0, tca: c.tca, ttc: c.ttc, retPct: Number(site.retPct) || 0, retenue: c.retenue, recup: c.recup, net: c.net, entryId: e.id, status: "emise", payments: [], createdAt: new Date().toISOString(), by: currentUserEmail || "" });
    setSd({ siteId: site.id, cum: {} }); setSelSit(id);
    showToast("Situation n° " + n + " émise : net à payer " + fmt(c.net) + "."); logAudit("BTP", "Situation émise", number + " — " + site.name + " — " + fmt(c.net));
  };
  const encaisser = (x) => {
    if (!canFront || x.status === "annulee") return;
    const amount = btR2(pp.amount);
    const s = btSolde(x);
    if (!(amount > 0)) { showToast("Indiquez un montant supérieur à zéro."); return; }
    if (amount > s.reste + 0.004) { showToast("Le montant dépasse le reste à payer (" + fmt(s.reste) + ")."); return; }
    if (!verifDate(pp.date, "enregistrer cet encaissement")) return;
    const cpt = compteMode(pp.mode === "banque" ? "banque" : "caisse");
    btAjouterComptes(accounts, setAccounts, [cpt, "411"]);
    const e = ecrire(pp.date, "Encaissement " + x.number + " — " + nomSite(x.siteId), [{ account: cpt, debit: amount, credit: 0 }, { account: "411", debit: 0, credit: amount }], x.id);
    maj(x.id, (r) => ({ ...r, payments: [...(r.payments || []), { id: btId(), date: pp.date, amount, mode: pp.mode, entryId: e.id, status: "valide", by: currentUserEmail || "" }] }));
    setPp({ ...pp, amount: "" }); showToast("Encaissement de " + fmt(amount) + " enregistré."); logAudit("BTP", "Situation encaissée", x.number + " — " + fmt(amount));
  };
  const annulerPaiement = (x, p) => {
    if (!canEdit || p.status === "annulé") return;
    if (!verifDate(today, "annuler cet encaissement")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler cet encaissement ? Une écriture inverse sera passée.")) return;
    const e = contre(p.entryId, "Annulation encaissement " + x.number + " (écriture inverse)", today, x.id);
    maj(x.id, (r) => ({ ...r, payments: r.payments.map((y) => (y.id === p.id ? { ...y, status: "annulé", reversalEntryId: e ? e.id : "" } : y)) }));
    showToast("Encaissement annulé.");
  };
  const annulerSituation = (x) => {
    if (!canEdit || x.status === "annulee") return;
    const last = derniere(x.siteId);
    if (!last || last.id !== x.id) { showToast("Seule la dernière situation du chantier peut être annulée : annulez d'abord les situations suivantes."); return; }
    if ((x.payments || []).some((p) => p.status !== "annulé")) { showToast("Annulez d'abord les encaissements de cette situation."); return; }
    if (rels.some((r) => r.siteId === x.siteId && r.status !== "annulé")) { showToast("Une retenue de garantie a déjà été encaissée sur ce chantier : annulez-la d'abord."); return; }
    if (!verifDate(today, "annuler cette situation")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler la situation " + x.number + " ? Une écriture inverse sera passée.")) return;
    const e = contre(x.entryId, "Annulation situation " + x.number + " (écriture inverse)", today, x.id);
    maj(x.id, (r) => ({ ...r, status: "annulee", reversalEntryId: e ? e.id : "" }));
    showToast("Situation annulée : le chantier revient à l'avancement précédent.");
  };
  const Situations = () => {
    const x = sits.find((y) => y.id === selSit);
    const xF = sits.filter((y) => (!xet || etatSit(y) === xet) && (!xd1 || y.date >= xd1) && (!xd2 || y.date <= xd2) && (!xq.trim() || [y.number, nomSite(y.siteId), nomClient(y.clientId)].join(" ").toLowerCase().includes(xq.trim().toLowerCase()))).sort((a, b) => String(b.number).localeCompare(String(a.number)));
    const xFA = xF.filter((y) => y.status !== "annulee");
    const ouverts = sites.filter((s) => s.status !== "termine");
    const cum = siteChoisi ? cumEff(siteChoisi) : {};
    const c = siteChoisi ? calcSit(siteChoisi, cum) : null;
    const erreurs = siteChoisi ? (siteChoisi.lines || []).flatMap((l) => (cum[l.id] > l.qty + 0.0001 ? ["« " + l.label + " » : la quantité cumulée dépasse celle du marché (" + l.qty + ")."] : cum[l.id] < prevQty(siteChoisi, l) - 0.0001 ? ["« " + l.label + " » : la quantité cumulée ne peut pas être inférieure à la situation précédente (" + prevQty(siteChoisi, l) + ")."] : [])) : [];
    return (
      <div>
        {canFront && (<div className="ec-card p-4 mb-5" data-testid="bt-situation-bloc"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvelle situation de travaux</div>
          <div className="flex flex-wrap items-end gap-3 mb-2">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Chantier</label><select value={sd.siteId} onChange={(e) => setSd({ siteId: e.target.value, cum: {} })} data-testid="bt-sit-chantier" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{ouverts.map((s) => <option key={s.id} value={s.id}>{s.number} — {s.name}</option>)}</select></div>
            <div className="text-sm" style={{ color: "#5B563F" }}>{siteChoisi ? <>Situation n° <b>{sits.filter((y) => y.siteId === siteChoisi.id).reduce((m, y) => Math.max(m, y.n || 0), 0) + 1}</b> · client {nomClient(siteChoisi.clientId)} · retenue {siteChoisi.retPct || 0} %</> : "Choisissez un chantier pour saisir l'avancement des travaux."}</div>
          </div>
          {siteChoisi && !(siteChoisi.lines || []).length && <div className="text-sm p-2 rounded" style={{ background: "#FFF6E0", color: "#152238" }} data-testid="bt-sit-sansligne">Ce chantier n'a pas de bordereau de prix : ouvrez-le dans l'onglet Chantiers et ajoutez les travaux du marché.</div>}
          {siteChoisi && (siteChoisi.lines || []).length > 0 && (<>
            <div className="text-xs mb-1" style={{ color: "#7A7460" }}>Saisissez, pour chaque ligne, la <b>quantité cumulée</b> réellement exécutée depuis le début du chantier (elle ne peut pas diminuer ni dépasser la quantité du marché).</div>
            <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Désignation</th><th>Unité</th><th className="text-right">Marché</th><th className="text-right">Prix unitaire</th><th className="text-right">Déjà exécuté</th><th className="text-right">Cumul à ce jour</th><th className="text-right">Montant cumulé</th></tr></thead>
              <tbody>{siteChoisi.lines.map((l) => (<tr key={l.id} data-testid="bt-sit-ligne"><td className="py-1.5">{l.label}</td><td>{l.unit || "—"}</td><td className="text-right tabular">{l.qty}</td><td className="text-right tabular">{fmt(l.pu)}</td><td className="text-right tabular">{prevQty(siteChoisi, l)}</td>
                <td className="text-right"><input type="number" min="0" step="0.01" value={sd.cum[l.id] === undefined ? String(prevQty(siteChoisi, l)) : sd.cum[l.id]} onChange={(e) => setSd({ ...sd, cum: { ...sd.cum, [l.id]: e.target.value } })} data-testid="bt-sit-cum" className="border rounded px-1 py-0.5 text-xs tabular" style={{ ...ecBorder, width: 90, background: "#fff" }} /></td><td className="text-right tabular">{fmt(btR2(cum[l.id] * l.pu))}</td></tr>))}</tbody></table></div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-sm" style={{ color: "#152238" }} data-testid="bt-sit-calcul">
              <div>Cumul des travaux<div className="tabular font-semibold" data-testid="bt-sit-cumht">{fmt(c.cumHt)}</div></div>
              <div>Déjà facturé<div className="tabular font-semibold">{fmt(c.prevHt)}</div></div>
              <div>Cette situation (hors taxe)<div className="tabular font-semibold" data-testid="bt-sit-ht">{fmt(c.ht)}</div></div>
              <div>Taxe<div className="tabular font-semibold">{fmt(c.tca)}</div></div>
              <div>Retenue de garantie<div className="tabular font-semibold" data-testid="bt-sit-ret">− {fmt(c.retenue)}</div></div>
              <div>Avance récupérée<div className="tabular font-semibold" data-testid="bt-sit-recup">− {fmt(c.recup)}</div></div>
              <div className="md:col-span-2">Net à payer par le client<div className="tabular font-semibold text-lg" data-testid="bt-sit-net">{fmt(c.net)}</div></div>
            </div>
            {erreurs.length > 0 && <div className="text-sm mt-2 p-2 rounded" style={{ background: "#FBE9E5", color: "#A6432F" }} data-testid="bt-sit-erreur">{erreurs.map((m, i) => <div key={i}>{m}</div>)}</div>}
            {erreurs.length === 0 && !(c.ht > 0) && <div className="text-xs mt-2" style={{ color: "#7A7460" }} data-testid="bt-sit-aide">Augmentez la quantité cumulée d'au moins une ligne pour faire apparaître le montant de la situation.</div>}
            <button onClick={emettreSituation} disabled={!(c.ht > 0) || erreurs.length > 0} className="mt-3 px-3 py-2 rounded text-sm" style={{ ...ecBtnGold, opacity: c.ht > 0 && erreurs.length === 0 ? 1 : 0.5 }} data-testid="bt-sit-emettre">Émettre la situation</button>
          </>)}
          {canEdit && <label className="text-xs flex items-center gap-2 mt-3"><input type="checkbox" checked={tcaOn} onChange={(e) => { const on = e.target.checked; setBtp((prev) => [...(prev || []).filter((r) => !(r.type === "config")), { type: "config", id: "config", tcaOn: on }]); showToast(on ? "Taxe activée sur les prochaines situations (" + (Number(settings.taxRate) || 0) + " %, taux des Réglages)." : "Taxe désactivée."); }} data-testid="bt-tca" />Appliquer la taxe (TCA) sur les situations (taux des Réglages : {Number(settings.taxRate) || 0} %). À confirmer avec votre expert-comptable.</label>}
        </div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <div className="flex-1 min-w-[150px]"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (n°, chantier, client)</label><input value={xq} onChange={(e) => setXq(e.target.value)} data-testid="bt-sit-recherche" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>État</label><select value={xet} onChange={(e) => setXet(e.target.value)} data-testid="bt-sit-filtre-etat" className={ecInput} style={ecBorder}><option value="">Tous</option><option value="encaisser">À encaisser</option><option value="soldee">Soldée</option><option value="annulee">Annulée</option></select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Du</label><input type="date" value={xd1} onChange={(e) => setXd1(e.target.value)} className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Au</label><input type="date" value={xd2} onChange={(e) => setXd2(e.target.value)} className={ecInput} style={ecBorder} /></div>
        </div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>Date</th><th>Chantier</th><th className="text-right">Situation</th><th className="text-right">Travaux (HT)</th><th className="text-right">Net à payer</th><th className="text-right">Reste à payer</th><th>État</th><th></th></tr></thead>
          <tbody>{xF.map((y) => { const s = btSolde(y); return (<tr key={y.id} data-testid="bt-sit-ligne-liste" style={{ background: y.id === selSit ? "#E6F1EE" : undefined, opacity: y.status === "annulee" ? 0.55 : 1 }}><td className="py-1.5 tabular text-xs">{y.number}</td><td>{ecDateFr(y.date)}</td><td>{nomSite(y.siteId)}</td><td className="text-right tabular">n° {y.n}</td><td className="text-right tabular">{fmt(y.ht)}</td><td className="text-right tabular">{fmt(y.net)}</td><td className="text-right tabular">{y.status === "annulee" ? "—" : fmt(s.reste)}</td>
            <td>{etatSit(y) === "annulee" ? ecPastille("Annulée", "neutre") : etatSit(y) === "soldee" ? ecPastille("Soldée", "ok") : ecPastille("À encaisser", "attente")}</td>
            <td className="text-right whitespace-nowrap"><button onClick={() => setSelSit(y.id === selSit ? "" : y.id)} className="text-xs underline mr-3" data-testid="bt-sit-ouvrir">{y.id === selSit ? "Fermer" : "Ouvrir"}</button><button onClick={() => setImprimer({ kind: "situation", id: y.id })} className="text-xs underline" data-testid="bt-sit-imprimer">Imprimer</button></td></tr>); })}</tbody>
          {xF.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="bt-sit-total-ligne"><td colSpan={4}>Total ({xFA.length} situation{xFA.length > 1 ? "s" : ""}, hors annulées)</td><td className="text-right tabular" data-testid="bt-sit-tot-ht">{fmt(btR2(xFA.reduce((t, y) => t + y.ht, 0)))}</td><td className="text-right tabular" data-testid="bt-sit-tot-net">{fmt(btR2(xFA.reduce((t, y) => t + y.net, 0)))}</td><td className="text-right tabular" data-testid="bt-sit-tot-reste">{fmt(btR2(xFA.reduce((t, y) => t + btSolde(y).reste, 0)))}</td><td colSpan={2}></td></tr></tfoot>}</table></div>
        {xF.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{sits.length === 0 ? "Aucune situation émise." : "Aucune situation ne correspond à ces filtres."}</div>}
        {x && (<div className="ec-card p-4 mt-5" data-testid="bt-sit-detail">
          <div className="display text-lg mb-2" style={{ color: "#152238" }}>{x.number} — situation n° {x.n} — {nomSite(x.siteId)}</div>
          <div className="text-sm mb-3" style={{ color: "#5B563F" }}>Travaux {fmt(x.ht)}{x.tca > 0 ? " + taxe " + fmt(x.tca) : ""} − retenue {fmt(x.retenue)} − avance récupérée {fmt(x.recup)} = net {fmt(x.net)} · payé {fmt(btSolde(x).paye)} · reste <b data-testid="bt-sit-reste">{fmt(btSolde(x).reste)}</b></div>
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Mode</th><th className="text-right">Montant</th><th>État</th><th></th></tr></thead>
            <tbody>{(x.payments || []).map((p) => (<tr key={p.id} data-testid="bt-pay-ligne" style={{ opacity: p.status === "annulé" ? 0.55 : 1 }}><td className="py-1.5">{ecDateFr(p.date)}</td><td>{p.mode === "banque" ? "Banque" : "Espèces"}</td><td className="text-right tabular">{fmt(p.amount)}</td><td>{p.status === "annulé" ? ecPastille("Annulé", "neutre") : ecPastille("Valide", "ok")}</td><td className="text-right">{canEdit && p.status !== "annulé" && <button onClick={() => annulerPaiement(x, p)} className="text-xs" style={{ color: "#A6432F" }} data-testid="bt-pay-annuler">Annuler</button>}</td></tr>))}</tbody></table></div>
          {canFront && x.status !== "annulee" && (<div className="grid md:grid-cols-4 gap-2 mt-3 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant reçu</label><input type="number" min="0" value={pp.amount} onChange={(e) => setPp({ ...pp, amount: e.target.value })} data-testid="bt-pay-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Mode</label><select value={pp.mode} onChange={(e) => setPp({ ...pp, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Espèces</option><option value="banque">Banque</option></select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" value={pp.date} max={todayStr()} onChange={(e) => setPp({ ...pp, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <button onClick={() => encaisser(x)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="bt-pay-valider">Enregistrer l'encaissement</button>
          </div>)}
          {canEdit && x.status !== "annulee" && <button onClick={() => annulerSituation(x)} className="mt-3 text-xs underline" style={{ color: "#A6432F" }} data-testid="bt-sit-annuler">Annuler cette situation</button>}
        </div>)}
      </div>
    );
  };

  // ───────── Dépenses de chantier ─────────
  const [fd, setFd] = useBrouillon("btp-depense", { siteId: "", kind: "materiaux", date: todayStr(), supplier: "", label: "", amount: "", mode: "caisse" });
  const [rg, setRg] = useState({ amount: "", mode: "caisse", date: todayStr() });
  const [dq, setDq] = useState(""); const [dk, setDk] = useState(""); const [dv, setDv] = useState(""); const [de, setDe] = useState("");
  const enregistrerDepense = () => {
    if (!canEdit) return;
    const amount = btR2(fd.amount);
    if (!fd.siteId) { showToast("Choisissez le chantier."); return; }
    if (!(amount > 0)) { showToast("Indiquez le montant (en gourdes)."); return; }
    if (fd.mode === "apayer" && !fd.supplier.trim()) { showToast("Pour une dépense à payer plus tard, indiquez le fournisseur ou le sous-traitant."); return; }
    if (!verifDate(fd.date, "enregistrer cette dépense")) return;
    const def = BT_DEPENSES.find((x) => x[0] === fd.kind) || BT_DEPENSES[0];
    const compte = def[2], cpt = compteMode(fd.mode);
    const label = fd.label.trim() || def[1];
    btAjouterComptes(accounts, setAccounts, [compte, cpt]);
    const e = ecrire(fd.date, "Chantier " + nomSite(fd.siteId) + " — " + label + (fd.supplier.trim() ? " (" + fd.supplier.trim() + ")" : ""), [{ account: compte, debit: amount, credit: 0 }, { account: cpt, debit: 0, credit: amount }], fd.siteId);
    ajouter({ type: "dep", id: btId(), date: fd.date, siteId: fd.siteId, kind: fd.kind, supplier: fd.supplier.trim(), label, amount, mode: fd.mode, entryId: e.id, status: "valide", settlements: [], by: currentUserEmail || "" });
    setFd({ ...fd, supplier: "", label: "", amount: "" });
    showToast("Dépense enregistrée : " + fmt(amount) + "."); logAudit("BTP", "Dépense de chantier", nomSite(fd.siteId) + " — " + label + " — " + fmt(amount));
  };
  const annulerDepense = (d) => {
    if (!canEdit || d.status === "annulé") return;
    if ((d.settlements || []).some((x) => x.status !== "annulé")) { showToast("Annulez d'abord les règlements de cette dépense."); return; }
    if (!verifDate(today, "annuler cette dépense")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler cette dépense ? Une écriture inverse sera passée.")) return;
    const e = contre(d.entryId, "Annulation — " + nomSite(d.siteId) + " — " + d.label + " (écriture inverse)", today, d.siteId);
    maj(d.id, (r) => ({ ...r, status: "annulé", reversalEntryId: e ? e.id : "" }));
    showToast("Dépense annulée.");
  };
  const reglerDepense = (d) => {
    if (!canEdit || d.mode !== "apayer" || d.status === "annulé") return;
    const reste = btResteDep(d);
    const amount = rg.amount === "" ? reste : btR2(rg.amount);
    if (!(amount > 0) || amount > reste + 0.004) { showToast("Le montant doit être compris entre 0 et le reste à payer (" + fmt(reste) + ")."); return; }
    if (!verifDate(rg.date, "enregistrer ce règlement")) return;
    const cpt = compteMode(rg.mode === "banque" ? "banque" : "caisse");
    btAjouterComptes(accounts, setAccounts, [cpt, "401"]);
    const e = ecrire(rg.date, "Règlement " + (d.supplier || "fournisseur") + " — " + nomSite(d.siteId) + " — " + d.label, [{ account: "401", debit: amount, credit: 0 }, { account: cpt, debit: 0, credit: amount }], d.id);
    maj(d.id, (r) => ({ ...r, settlements: [...(r.settlements || []), { id: btId(), date: rg.date, amount, mode: rg.mode, entryId: e.id, status: "valide" }] }));
    setRg({ ...rg, amount: "" }); showToast("Règlement de " + fmt(amount) + " enregistré."); logAudit("BTP", "Dette réglée", (d.supplier || "") + " — " + fmt(amount));
  };
  const annulerReglement = (d, s) => {
    if (!canEdit || s.status === "annulé") return;
    if (!verifDate(today, "annuler ce règlement")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler ce règlement ? Une écriture inverse sera passée.")) return;
    const e = contre(s.entryId, "Annulation règlement " + (d.supplier || "") + " (écriture inverse)", today, d.id);
    maj(d.id, (r) => ({ ...r, settlements: r.settlements.map((x) => (x.id === s.id ? { ...x, status: "annulé", reversalEntryId: e ? e.id : "" } : x)) }));
    showToast("Règlement annulé.");
  };
  const Depenses = () => {
    const d = deps.find((x) => x.id === selDep);
    const etatDep = (x) => (x.status === "annulé" ? "annule" : btResteDep(x) > 0.004 ? "apayer" : "valide");
    const dF = deps.filter((x) => (!dk || x.kind === dk) && (!dv || x.siteId === dv) && (!de || etatDep(x) === de) && (!dq.trim() || [x.label, x.supplier, nomSite(x.siteId)].join(" ").toLowerCase().includes(dq.trim().toLowerCase()))).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const dFA = dF.filter((x) => x.status !== "annulé");
    return (
      <div>
        {canEdit && (<div className="ec-card p-4 mb-5" data-testid="bt-nouvelle-depense"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvelle dépense de chantier</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Chantier</label><select value={fd.siteId} onChange={(e) => setFd({ ...fd, siteId: e.target.value })} data-testid="bt-dep-chantier" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.number} — {s.name}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Nature</label><select value={fd.kind} onChange={(e) => setFd({ ...fd, kind: e.target.value })} data-testid="bt-dep-nature" className={ecInput} style={ecBorder}>{BT_DEPENSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" value={fd.date} max={todayStr()} onChange={(e) => setFd({ ...fd, date: e.target.value })} data-testid="bt-dep-date" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Payé par</label><select value={fd.mode} onChange={(e) => setFd({ ...fd, mode: e.target.value })} data-testid="bt-dep-mode" className={ecInput} style={ecBorder}><option value="caisse">Caisse</option><option value="banque">Banque</option><option value="apayer">À payer plus tard (dette)</option></select></div>
          </div>
          <div className="grid md:grid-cols-4 gap-2 items-end mt-2">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Fournisseur ou sous-traitant</label><div className="flex gap-1"><input value={fd.supplier} onChange={(e) => setFd({ ...fd, supplier: e.target.value })} data-testid="bt-dep-tiers" className={ecInput} style={ecBorder} /><BtFleche id="bt-dl-tiers" onPick={(v) => setFd({ ...fd, supplier: v })} /></div></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Détail (facultatif)</label><input value={fd.label} onChange={(e) => setFd({ ...fd, label: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant (gourdes)</label><input type="number" min="0" value={fd.amount} onChange={(e) => setFd({ ...fd, amount: e.target.value })} data-testid="bt-dep-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
          </div>
          <button onClick={enregistrerDepense} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="bt-dep-valider">Enregistrer la dépense</button></div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <div className="flex-1 min-w-[150px]"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (détail, fournisseur, chantier)</label><input value={dq} onChange={(e) => setDq(e.target.value)} data-testid="bt-dep-recherche" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Nature</label><select value={dk} onChange={(e) => setDk(e.target.value)} data-testid="bt-dep-filtre-nature" className={ecInput} style={ecBorder}><option value="">Toutes</option>{BT_DEPENSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Chantier</label><select value={dv} onChange={(e) => setDv(e.target.value)} className={ecInput} style={ecBorder}><option value="">Tous</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>État</label><select value={de} onChange={(e) => setDe(e.target.value)} data-testid="bt-dep-filtre-etat" className={ecInput} style={ecBorder}><option value="">Tous</option><option value="valide">Payée</option><option value="apayer">À payer</option><option value="annule">Annulée</option></select></div>
        </div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Chantier</th><th>Nature</th><th>Fournisseur / détail</th><th className="text-right">Montant</th><th className="text-right">Reste à payer</th><th>État</th><th></th></tr></thead>
          <tbody>{dF.map((x) => (<tr key={x.id} data-testid="bt-dep-ligne" style={{ background: x.id === selDep ? "#E6F1EE" : undefined, opacity: x.status === "annulé" ? 0.55 : 1 }}><td className="py-1.5">{ecDateFr(x.date)}</td><td>{nomSite(x.siteId)}</td><td className="text-xs">{(BT_DEPENSES.find((k) => k[0] === x.kind) || [0, x.kind])[1]}</td><td className="text-xs">{x.supplier ? x.supplier + " — " : ""}{x.label}</td><td className="text-right tabular">{fmt(x.amount)}</td><td className="text-right tabular">{fmt(btResteDep(x))}</td>
            <td>{etatDep(x) === "annule" ? ecPastille("Annulée", "neutre") : etatDep(x) === "apayer" ? ecPastille("À payer", "attente") : ecPastille("Payée", "ok")}</td>
            <td className="text-right whitespace-nowrap">{x.mode === "apayer" && x.status !== "annulé" && <button onClick={() => setSelDep(x.id === selDep ? "" : x.id)} className="text-xs underline mr-2" data-testid="bt-dep-ouvrir">{x.id === selDep ? "Fermer" : "Règlements"}</button>}{canEdit && x.status !== "annulé" && <button onClick={() => annulerDepense(x)} className="text-xs" style={{ color: "#A6432F" }} data-testid="bt-dep-annuler">Annuler</button>}</td></tr>))}</tbody>
          {dF.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="bt-dep-total-ligne"><td colSpan={4}>Total ({dFA.length}, hors annulées)</td><td className="text-right tabular" data-testid="bt-dep-tot">{fmt(btR2(dFA.reduce((t, x) => t + x.amount, 0)))}</td><td className="text-right tabular" data-testid="bt-dep-tot-reste">{fmt(btR2(dFA.reduce((t, x) => t + btResteDep(x), 0)))}</td><td colSpan={2}></td></tr></tfoot>}</table></div>
        {dF.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{deps.length === 0 ? "Aucune dépense." : "Aucune dépense ne correspond à ces filtres."}</div>}
        {d && (<div className="ec-card p-4 mt-5" data-testid="bt-dep-detail">
          <div className="display text-base mb-2" style={{ color: "#152238" }}>{d.supplier || "Fournisseur"} — {d.label} — {fmt(d.amount)}</div>
          <div className="text-sm mb-2" style={{ color: "#5B563F" }}>Reste à payer : <b className="tabular" data-testid="bt-dep-reste">{fmt(btResteDep(d))}</b></div>
          {(d.settlements || []).length > 0 && (<div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Mode</th><th className="text-right">Montant</th><th>État</th><th></th></tr></thead>
            <tbody>{d.settlements.map((s) => (<tr key={s.id} data-testid="bt-regl-ligne" style={{ opacity: s.status === "annulé" ? 0.55 : 1 }}><td className="py-1.5">{ecDateFr(s.date)}</td><td>{s.mode === "banque" ? "Banque" : "Espèces"}</td><td className="text-right tabular">{fmt(s.amount)}</td><td>{s.status === "annulé" ? ecPastille("Annulé", "neutre") : ecPastille("Réglé", "ok")}</td><td className="text-right">{canEdit && s.status !== "annulé" && <button onClick={() => annulerReglement(d, s)} className="text-xs" style={{ color: "#A6432F" }} data-testid="bt-regl-annuler">Annuler</button>}</td></tr>))}</tbody></table></div>)}
          {canEdit && btResteDep(d) > 0.004 && (<div className="grid md:grid-cols-4 gap-2 mt-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant payé (vide = tout)</label><input type="number" min="0" value={rg.amount} onChange={(e) => setRg({ ...rg, amount: e.target.value })} data-testid="bt-regl-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Mode</label><select value={rg.mode} onChange={(e) => setRg({ ...rg, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Espèces</option><option value="banque">Banque</option></select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" value={rg.date} max={todayStr()} onChange={(e) => setRg({ ...rg, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <button onClick={() => reglerDepense(d)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="bt-regl-valider">Enregistrer le règlement</button>
          </div>)}
        </div>)}
      </div>
    );
  };

  // ───────── Documents imprimables (A4) ─────────
  const entete = (titre) => (
    <div style={{ textAlign: "center", marginBottom: 12 }}>
      {settings.companyLogo && <img src={settings.companyLogo} alt="" style={{ width: 60, height: 60, objectFit: "contain", margin: "0 auto 6px", display: "block" }} />}
      <div style={{ fontWeight: 700, fontSize: 20 }}>{settings.companyName || "Entreprise de construction"}</div>
      {settings.companyAddress && <div style={{ fontSize: 12 }}>{settings.companyAddress}</div>}
      {settings.companyPhone && <div style={{ fontSize: 12 }}>{settings.companyPhone}</div>}
      {settings.companyNIF && <div style={{ fontSize: 12 }}>NIF : {settings.companyNIF}</div>}
      <div style={{ fontWeight: 700, fontSize: 18, marginTop: 10 }}>{titre}</div>
    </div>
  );
  const cellule = { padding: "4px 6px", border: "1px solid #bbb" };
  const JournalSheet = ({ s, dates }) => (
    <div>{dates.map((dt, i) => { const j = (s.journal || []).find((y) => y.date === dt); const ef = effectifDuJour(s, dt); if (!j) return null; return (
      <div key={dt} style={{ color: "#152238", background: "#fff", fontFamily: "'Inter', sans-serif", fontSize: 12, width: "100%", maxWidth: 794, margin: "0 auto", padding: (typeof window !== "undefined" && window.innerWidth < 640) ? "16px 10px" : "32px 36px", boxSizing: "border-box", pageBreakAfter: i < dates.length - 1 ? "always" : "auto" }} data-testid="bt-journal-feuille">
        {entete("JOURNAL DE CHANTIER")}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, flexWrap: "wrap", gap: 6 }}><span>Chantier : <b>{s.name}</b> ({s.number})</span><span>Date : <b>{ecDateFr(dt)}</b></span></div>
        <div style={{ marginBottom: 4 }}>Client : <b>{nomClient(s.clientId)}</b>{s.address ? " — " + s.address : ""}</div>
        <div style={{ marginBottom: 10 }}>Météo : <b>{j.weather || "—"}</b> · Effectif pointé : <b>{ef.total}</b> jour(s)-homme{ef.noms.length ? " (" + ef.noms.join(", ") + ")" : ""}</div>
        <div style={{ fontWeight: 700, marginTop: 6 }}>Travaux exécutés</div><div style={{ border: "1px solid #bbb", padding: 6, minHeight: 80, whiteSpace: "pre-wrap" }}>{j.works || "—"}</div>
        <div style={{ fontWeight: 700, marginTop: 8 }}>Incidents, arrêts, accidents</div><div style={{ border: "1px solid #bbb", padding: 6, minHeight: 40, whiteSpace: "pre-wrap" }}>{j.incidents || "Néant"}</div>
        <div style={{ marginTop: 8 }}>Visiteurs : {j.visitors || "—"}</div><div>Matériaux et matériel reçus : {j.materials || "—"}</div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 24, marginTop: 40 }}><div style={{ flex: 1, borderTop: "1px solid #152238", paddingTop: 4, textAlign: "center" }}>Rédigé par{j.author ? " : " + j.author : ""}</div><div style={{ flex: 1, borderTop: "1px solid #152238", paddingTop: 4, textAlign: "center" }}>Visa du maître d'œuvre</div></div>
      </div>); })}</div>
  );
  const CrSheet = ({ s, v }) => (
    <div style={{ color: "#152238", background: "#fff", fontFamily: "'Inter', sans-serif", fontSize: 12, width: "100%", maxWidth: 794, margin: "0 auto", padding: (typeof window !== "undefined" && window.innerWidth < 640) ? "16px 10px" : "32px 36px", boxSizing: "border-box" }} data-testid="bt-cr-feuille">
      {entete("COMPTE RENDU — " + nomVKind(v.kind).toUpperCase())}
      <div style={{ marginBottom: 4 }}>Chantier : <b>{s.name}</b> ({s.number}) · Date : <b>{ecDateFr(v.date)}</b></div>
      <div style={{ marginBottom: 4 }}>Objet : <b>{v.subject}</b></div><div style={{ marginBottom: 10 }}>Responsable : {v.resp || "—"} · Client : {nomClient(s.clientId)}</div>
      <div style={{ fontWeight: 700 }}>Constats et observations</div><div style={{ border: "1px solid #bbb", padding: 6, minHeight: 120, whiteSpace: "pre-wrap" }}>{v.report || "—"}</div>
      <div style={{ fontWeight: 700, marginTop: 8 }}>Décisions et actions à mener</div><div style={{ border: "1px solid #bbb", padding: 6, minHeight: 80, whiteSpace: "pre-wrap" }}>{v.decisions || "—"}</div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 24, marginTop: 40 }}><div style={{ flex: 1, borderTop: "1px solid #152238", paddingTop: 4, textAlign: "center" }}>Le responsable de la visite</div><div style={{ flex: 1, borderTop: "1px solid #152238", paddingTop: 4, textAlign: "center" }}>Pour l'entreprise</div></div>
    </div>
  );
  const PvSheet = ({ s, type }) => {
    const rc = (s.reception || {})[type] || {}; const rs = s.reserves || [];
    return (
      <div style={{ color: "#152238", background: "#fff", fontFamily: "'Inter', sans-serif", fontSize: 12, width: "100%", maxWidth: 794, margin: "0 auto", padding: (typeof window !== "undefined" && window.innerWidth < 640) ? "16px 10px" : "32px 36px", boxSizing: "border-box" }} data-testid="bt-pv-feuille">
        {entete("PROCÈS-VERBAL DE RÉCEPTION " + (type === "prov" ? "PROVISOIRE" : "DÉFINITIVE"))}
        <div style={{ marginBottom: 4 }}>Chantier : <b>{s.name}</b> ({s.number}){s.address ? " — " + s.address : ""}</div>
        <div style={{ marginBottom: 4 }}>Client (maître d'ouvrage) : <b>{nomClient(s.clientId)}</b></div>
        <div style={{ marginBottom: 4 }}>Montant du marché (hors taxe) : <b>{fmt(btMarche(s))}</b></div>
        <div style={{ marginBottom: 10 }}>Date de la réception : <b>{ecDateFr(rc.date)}</b>{rc.note ? " — " + rc.note : ""}</div>
        <div style={{ fontWeight: 700 }}>Réserves ({rs.length})</div>
        {rs.length === 0 ? <div style={{ border: "1px solid #bbb", padding: 6 }}>Aucune réserve.</div> : (<div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}><thead><tr style={{ background: "#F4F1E6" }}><th style={{ ...cellule, textAlign: "left" }}>Défaut</th><th style={cellule}>Lieu</th><th style={cellule}>À lever avant</th><th style={cellule}>État</th></tr></thead>
          <tbody>{rs.map((r) => (<tr key={r.id}><td style={cellule}>{r.label}</td><td style={cellule}>{r.place || "—"}</td><td style={{ ...cellule, textAlign: "center" }}>{r.due ? ecDateFr(r.due) : "—"}</td><td style={{ ...cellule, textAlign: "center" }}>{r.status === "levee" ? "Levée le " + ecDateFr(r.leveeDate) : "À lever"}</td></tr>))}</tbody></table></div>)}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginTop: 40 }}>{["Le maître d'ouvrage (client)", "L'entreprise", "Le maître d'œuvre"].map((t) => (<div key={t} style={{ flex: 1, borderTop: "1px solid #152238", paddingTop: 4, textAlign: "center", fontSize: 11 }}>{t}</div>))}</div>
      </div>
    );
  };

  const DevisSheet = ({ s }) => (
    <div style={{ color: "#152238", background: "#fff", fontFamily: "'Inter', sans-serif", fontSize: 12, width: "100%", maxWidth: 794, margin: "0 auto", padding: (typeof window !== "undefined" && window.innerWidth < 640) ? "16px 10px" : "32px 36px", boxSizing: "border-box" }} data-testid="bt-devis-feuille">
      {entete("DEVIS ESTIMATIF — BORDEREAU DE PRIX")}
      <div style={{ marginBottom: 4 }}>Chantier : <b>{s.name}</b> ({s.number}){s.address ? " — " + s.address : ""}</div>
      <div style={{ marginBottom: 10 }}>Client : <b>{nomClient(s.clientId)}</b> · établi le {ecDateFr(today)}</div>
      <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}><thead><tr style={{ background: "#F4F1E6" }}><th style={{ ...cellule, textAlign: "left" }}>Désignation</th><th style={cellule}>Unité</th><th style={{ ...cellule, textAlign: "right" }}>Quantité</th><th style={{ ...cellule, textAlign: "right" }}>Prix unitaire</th><th style={{ ...cellule, textAlign: "right" }}>Montant</th></tr></thead>
        <tbody>{(s.lines || []).map((l) => (<tr key={l.id}><td style={cellule}>{l.label}</td><td style={{ ...cellule, textAlign: "center" }}>{l.unit}</td><td style={{ ...cellule, textAlign: "right" }}>{l.qty}</td><td style={{ ...cellule, textAlign: "right" }}>{fmt(l.pu)}</td><td style={{ ...cellule, textAlign: "right" }}>{fmt(btR2(l.qty * l.pu))}</td></tr>))}</tbody></table></div>
      <div style={{ textAlign: "right", fontWeight: 700, fontSize: 15 }}>Total hors taxe : {fmt(btMarche(s))}</div>
      {tcaRate > 0 && <div style={{ textAlign: "right" }}>Taxe ({tcaRate} %) : {fmt(btR2(btMarche(s) * tcaRate / 100))} · Total toutes taxes : {fmt(btR2(btMarche(s) * (1 + tcaRate / 100)))}</div>}
      {Number(s.retPct) > 0 && <div style={{ fontSize: 11, marginTop: 6 }}>Retenue de garantie prévue : {s.retPct} % de chaque situation.</div>}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 24, marginTop: 40 }}>
        <div style={{ flex: 1, borderTop: "1px solid #152238", paddingTop: 4, textAlign: "center", fontSize: 12 }}>Pour l'entreprise</div>
        <div style={{ flex: 1, borderTop: "1px solid #152238", paddingTop: 4, textAlign: "center", fontSize: 12 }}>Bon pour accord du client (date et signature)</div>
      </div>
    </div>
  );
  const SituationSheet = ({ x }) => {
    const s = btSolde(x);
    const ligne = (a, b, bold) => <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontWeight: bold ? 700 : 400, fontSize: bold ? 15 : 12 }}><span>{a}</span><span className="tabular">{b}</span></div>;
    return (
      <div style={{ color: "#152238", background: "#fff", fontFamily: "'Inter', sans-serif", fontSize: 12, width: "100%", maxWidth: 794, margin: "0 auto", padding: (typeof window !== "undefined" && window.innerWidth < 640) ? "16px 10px" : "32px 36px", boxSizing: "border-box" }} data-testid="bt-situation-feuille">
        {entete("SITUATION DE TRAVAUX N° " + x.n + (x.status === "annulee" ? " — ANNULÉE" : ""))}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span>Décompte <b>{x.number}</b></span><span>Établi le {ecDateFr(x.date)}</span></div>
        <div style={{ marginBottom: 4 }}>Chantier : <b>{nomSite(x.siteId)}</b></div>
        <div style={{ marginBottom: 10 }}>Client : <b>{nomClient(x.clientId)}</b></div>
        <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}><thead><tr style={{ background: "#F4F1E6" }}><th style={{ ...cellule, textAlign: "left" }}>Désignation</th><th style={cellule}>Unité</th><th style={{ ...cellule, textAlign: "right" }}>Marché</th><th style={{ ...cellule, textAlign: "right" }}>P.U.</th><th style={{ ...cellule, textAlign: "right" }}>Précédent</th><th style={{ ...cellule, textAlign: "right" }}>Cumul</th><th style={{ ...cellule, textAlign: "right" }}>Montant cumulé</th></tr></thead>
          <tbody>{(x.lignes || []).map((l) => (<tr key={l.id}><td style={cellule}>{l.label}</td><td style={{ ...cellule, textAlign: "center" }}>{l.unit}</td><td style={{ ...cellule, textAlign: "right" }}>{l.qty}</td><td style={{ ...cellule, textAlign: "right" }}>{fmt(l.pu)}</td><td style={{ ...cellule, textAlign: "right" }}>{l.prevQty}</td><td style={{ ...cellule, textAlign: "right" }}>{l.cumQty}</td><td style={{ ...cellule, textAlign: "right" }}>{fmt(l.montant)}</td></tr>))}</tbody></table></div>
        <div style={{ maxWidth: 380, marginLeft: "auto", borderTop: "1px dashed #152238", paddingTop: 6 }}>
          {ligne("Cumul des travaux exécutés", fmt(x.cumHt))}
          {ligne("Déjà facturé (situations précédentes)", "− " + fmt(x.prevHt))}
          {ligne("Travaux de cette situation (hors taxe)", fmt(x.ht))}
          {x.tca > 0 && ligne("Taxe (" + x.tcaRate + " %)", fmt(x.tca))}
          {x.retenue > 0 && ligne("Retenue de garantie (" + x.retPct + " %)", "− " + fmt(x.retenue))}
          {x.recup > 0 && ligne("Avance de démarrage récupérée", "− " + fmt(x.recup))}
          {ligne("NET À PAYER", fmt(x.net), true)}
          {s.paye > 0 && <div style={{ marginTop: 4 }}>Déjà payé : <span className="tabular">{fmt(s.paye)}</span> — reste : <span className="tabular">{fmt(s.reste)}</span></div>}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 24, marginTop: 40 }}>
          <div style={{ flex: 1, borderTop: "1px solid #152238", paddingTop: 4, textAlign: "center", fontSize: 12 }}>L'entreprise</div>
          <div style={{ flex: 1, borderTop: "1px solid #152238", paddingTop: 4, textAlign: "center", fontSize: 12 }}>Vu et accepté par le client ou son représentant</div>
        </div>
      </div>
    );
  };

  // ───────── Tableau de bord ─────────
  const Apercu = () => {
    const sA = sits.filter((x) => x.status !== "annulee");
    const mois = today.slice(0, 7);
    const factMois = btR2(sA.filter((x) => String(x.date).startsWith(mois)).reduce((t, x) => t + x.ht, 0));
    const encMois = btR2(sA.flatMap((x) => x.payments || []).filter((p) => p.status !== "annulé" && String(p.date).startsWith(mois)).reduce((t, p) => t + p.amount, 0));
    const depMois = btR2(deps.filter((x) => x.status !== "annulé" && String(x.date).startsWith(mois)).reduce((t, x) => t + x.amount, 0));
    const dus = btR2(sA.reduce((t, x) => t + btSolde(x).reste, 0));
    const enCours = sites.filter((s) => s.status === "encours");
    const marcheCours = btR2(enCours.reduce((t, s) => t + btMarche(s), 0));
    const retenues = btR2(sites.reduce((t, s) => t + retenueDue(s.id), 0));
    const dettes = btR2(deps.reduce((t, d) => t + btResteDep(d), 0));
    const afaire = [];
    sA.filter((x) => btSolde(x).reste > 0.004 && btJours(x.date, today) > 30).forEach((x) => afaire.push({ tab: "situations", sel: x.id, nom: nomClient(x.clientId), txt: "Situation " + x.number + " (" + nomSite(x.siteId) + ") impayée depuis " + btJours(x.date, today) + " jours : reste " + fmt(btSolde(x).reste) }));
    sites.filter((s) => (s.status === "encours" || s.status === "preparation") && s.end && s.end < today).forEach((s) => afaire.push({ tab: "chantiers", sel: s.id, nom: s.name, txt: "Fin prévue le " + ecDateFr(s.end) + " dépassée (" + btJours(s.end, today) + " jours) : chantier toujours ouvert" }));
    sites.filter((s) => budgetTotal(s) > 0 && depensesDe(s.id) > budgetTotal(s)).forEach((s) => afaire.push({ tab: "chantiers", sel: s.id, sub: "budget", nom: s.name, txt: "Dépenses " + fmt(depensesDe(s.id)) + " au-dessus du budget de " + fmt(budgetTotal(s)) }));
    sites.filter((s) => s.status !== "termine" && phasesRetard(s).length > 0).forEach((s) => afaire.push({ tab: "chantiers", sel: s.id, sub: "etapes", nom: s.name, txt: phasesRetard(s).length + " étape(s) en retard sur la date de fin prévue" }));
    sites.filter((s) => s.status !== "termine" && visitesACompleter(s).length > 0).forEach((s) => afaire.push({ tab: "chantiers", sel: s.id, sub: "sup", nom: s.name, txt: visitesACompleter(s).length + " visite(s) ou réunion(s) planifiée(s) non réalisée(s) ni annulée(s)" }));
    sites.filter((s) => reservesRetard(s).length > 0).forEach((s) => afaire.push({ tab: "chantiers", sel: s.id, sub: "recep", nom: s.name, txt: reservesRetard(s).length + " réserve(s) non levée(s) après l'échéance" }));
    sites.filter((s) => s.etudes && docsRetard(s).length > 0).forEach((s) => afaire.push({ tab: "chantiers", sel: s.id, sub: "etudes", nom: s.name, txt: docsRetard(s).length + " document(s) d'études en retard" }));
    sites.filter((s) => s.status !== "termine" && tachesRetard(s).length > 0).forEach((s) => afaire.push({ tab: "chantiers", sel: s.id, sub: "equipe", nom: s.name, txt: tachesRetard(s).length + " tâche(s) de l'encadrement en retard" }));
    sites.filter((s) => s.status === "encours" && depensesDe(s.id) > 0 && !derniere(s.id)).forEach((s) => afaire.push({ tab: "situations", nom: s.name, txt: "Dépenses engagées (" + fmt(depensesDe(s.id)) + ") mais aucune situation encore émise" }));
    sites.filter((s) => retenueBloquee(s) === "" && retenueDue(s.id) > 0.004).forEach((s) => afaire.push({ tab: "chantiers", sel: s.id, nom: s.name, txt: "Chantier terminé : retenue de garantie de " + fmt(retenueDue(s.id)) + " à réclamer au client" }));
    deps.filter((d) => btResteDep(d) > 0.004 && btJours(d.date, today) > 30).forEach((d) => afaire.push({ tab: "depenses", sel: d.id, nom: d.supplier || nomSite(d.siteId), txt: "Dette de " + fmt(btResteDep(d)) + " à régler depuis " + btJours(d.date, today) + " jours (" + d.label + ")" }));
    const etapes = [
      ["Clients", "Enregistrez vos clients (maîtres d'ouvrage) : nom, téléphone, adresse.", "clients", clients.length > 0],
      ["Premier chantier", "Créez le chantier : client, adresse, dates, pourcentage de retenue de garantie prévu au marché.", "chantiers", sites.length > 0],
      ["Bordereau de prix", "Dans le chantier, ajoutez les travaux : désignation, unité, quantité, prix unitaire ; imprimez le devis.", "chantiers", sites.some((s) => (s.lines || []).length > 0)],
      ["Avance de démarrage", "Si le client verse une avance, enregistrez-la (étape facultative) : elle sera récupérée au fil des situations.", "chantiers", sites.some((s) => avancesDe(s).length > 0)],
      ["Dépenses", "Enregistrez matériaux, main-d'œuvre, sous-traitance, engins : chaque dépense est rattachée à son chantier.", "depenses", deps.length > 0],
      ["Première situation", "Saisissez les quantités cumulées exécutées : le net à payer (retenue et avance déduites) se calcule seul ; imprimez la situation.", "situations", sits.length > 0],
      ["Premier encaissement", "Ouvrez la situation et enregistrez le paiement du client : la comptabilité se fait automatiquement.", "situations", sA.some((x) => (x.payments || []).some((p) => p.status !== "annulé"))],
    ];
    const toutFait = etapes.every((e) => e[3]);
    const kpis = [["Chantiers en cours", String(enCours.length), "bt-kpi-encours"], ["Marchés en cours (HT)", fmt(marcheCours), "bt-kpi-marches"], ["Travaux facturés ce mois (HT)", fmt(factMois), "bt-kpi-fact"], ["Encaissé ce mois", fmt(encMois), "bt-kpi-encaisse"], ["À recevoir des clients", fmt(dus), "bt-kpi-dus"], ["Retenues de garantie à libérer", fmt(retenues), "bt-kpi-retenues"], ["Dépenses ce mois", fmt(depMois), "bt-kpi-depenses"], ["Dettes fournisseurs", fmt(dettes), "bt-kpi-dettes"]];
    return (
      <div>
        {!toutFait && (<div className="ec-card p-4 mb-5" data-testid="bt-guide">
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Pour démarrer, en 7 étapes</div>
          <ol className="text-sm" style={{ color: "#152238", listStyle: "none", paddingLeft: 0 }}>{etapes.map(([t, d, tb, fait], i) => (<li key={i} data-testid="bt-etape" className="mb-1.5 flex flex-wrap gap-2 items-baseline"><span style={{ color: fait ? "#0F6B5C" : "#8A8370", fontWeight: 700 }}>{fait ? "✓" : (i + 1) + "."}</span><span><b>{t}</b> — <span style={{ color: "#5B563F" }}>{d}</span></span>{!fait && !(isVendeur && (tb === "chantiers" || tb === "depenses")) && <button className="text-xs underline" data-testid="bt-etape-ouvrir" onClick={() => setTab(tb)}>Ouvrir</button>}</li>))}</ol>
        </div>)}
        {sites.length === 0 && <div className="p-4 rounded text-sm mb-4" style={{ background: "#FFF6E0", color: "#152238" }} data-testid="bt-vide">Pour commencer : enregistrez vos <b>clients</b>, créez un <b>chantier</b> avec son bordereau de prix, puis suivez les <b>dépenses</b> et émettez les <b>situations de travaux</b>.</div>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {kpis.map(([l, v, t]) => (<div key={t} className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>{l}</div><div className="display text-lg tabular" data-testid={t} style={{ color: "#152238" }}>{v}</div></div>))}
        </div>
        <div className="display text-base mb-2" style={{ color: "#152238" }}>À faire <span className="text-xs" style={{ color: "#8A8370", fontWeight: 400 }}>({afaire.length})</span></div>
        <div style={{ display: "none" }} data-testid="bt-kpi-afaire">{afaire.length}</div>
        {afaire.length === 0 ? <div className="text-sm mb-5" style={{ color: "#8A8370" }}>Rien en attente.</div> : (
          <div className="ec-wrap mb-5"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Concerné</th><th>À faire</th><th></th></tr></thead>
            <tbody>{afaire.slice(0, 15).map((x, i) => (<tr key={i} data-testid="bt-afaire-ligne"><td className="py-1.5">{x.nom}</td><td>{x.txt}</td><td className="text-right"><button className="text-xs underline" data-testid="bt-afaire-ouvrir" onClick={() => { if (isVendeur && (x.tab === "chantiers" || x.tab === "depenses")) return; setTab(x.tab); if (x.sel && x.tab === "chantiers") { setSelSite(x.sel); setSub(x.sub || "vue"); } if (x.sel && x.tab === "situations") setSelSit(x.sel); if (x.sel && x.tab === "depenses") setSelDep(x.sel); }}>Ouvrir</button></td></tr>))}</tbody></table></div>
        )}
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Chantiers en cours</div>
        {enCours.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucun chantier en cours.</div> : (
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Chantier</th><th>Client</th><th>Responsable</th><th className="text-right">Marché</th><th className="text-right">Avancement facturé</th><th>Fin prévue</th></tr></thead>
            <tbody>{enCours.map((s) => { const m = btMarche(s); return (<tr key={s.id} data-testid="bt-encours-ligne"><td className="py-1.5">{s.name}</td><td>{nomClient(s.clientId)}</td><td className="text-xs">{respDe(s)}</td><td className="text-right tabular">{fmt(m)}</td><td className="text-right tabular">{m > 0 ? Math.round(factureHt(s.id) * 100 / m) : 0} %</td><td>{s.end ? ecDateFr(s.end) : "—"}</td></tr>); })}</tbody></table></div>
        )}
      </div>
    );
  };

  // ───────── Rapports ─────────
  const [rd, setRd] = useState(""); const [rf, setRf] = useState("");
  const Rapports = () => {
    const dansP = (d) => (!rd || d >= rd) && (!rf || d <= rf);
    const sP = sits.filter((x) => x.status !== "annulee" && dansP(x.date));
    const dP = deps.filter((x) => x.status !== "annulé" && dansP(x.date));
    const S = (arr, f) => btR2(arr.reduce((t, x) => t + f(x), 0));
    const tf = { fontWeight: 600, borderTop: "2px solid #152238" };
    const parSite = sites.map((s) => { const mine = sP.filter((x) => x.siteId === s.id); const fact = S(mine, (x) => x.ht); const enc = S(mine, (x) => btSolde(x).paye); const dep = S(dP.filter((d) => d.siteId === s.id), (d) => d.amount); const m = btMarche(s); return { s, marche: m, avanc: m > 0 ? Math.round(factureHt(s.id) * 100 / m) : 0, fact, enc, dep, marge: btR2(fact - dep), reste: btR2(m - factureHt(s.id)), ret: retenueDue(s.id) }; });
    const impayes = clients.map((c) => { const mine = sP.filter((x) => x.clientId === c.id && btSolde(x).reste > 0.004); const age = (x) => btJours(x.date, today); return { c, n: mine.length, b0: S(mine.filter((x) => age(x) <= 30), (x) => btSolde(x).reste), b1: S(mine.filter((x) => age(x) > 30 && age(x) <= 60), (x) => btSolde(x).reste), b2: S(mine.filter((x) => age(x) > 60), (x) => btSolde(x).reste), reste: S(mine, (x) => btSolde(x).reste) }; }).filter((x) => x.reste > 0.004);
    const parNature = BT_DEPENSES.map(([k, l]) => ({ l, n: dP.filter((x) => x.kind === k).length, m: S(dP.filter((x) => x.kind === k), (x) => x.amount) })).filter((x) => x.n > 0);
    const dettes = deps.filter((d) => btResteDep(d) > 0.004);
    const parTiers = {}; dettes.forEach((d) => { const k = d.supplier || "—"; parTiers[k] = btR2((parTiers[k] || 0) + btResteDep(d)); });
    const lignesTiers = Object.keys(parTiers).sort().map((k) => ({ k, m: parTiers[k] }));
    const exporterSite = () => ecTelecharger("rentabilite-chantiers-" + today + ".csv", [["Chantier", "Marché HT", "Avancement facturé %", "Facturé HT", "Encaissé", "Dépenses", "Marge", "Reste à facturer", "Retenue à libérer"], ...parSite.map((x) => [x.s.name, x.marche, x.avanc, x.fact, x.enc, x.dep, x.marge, x.reste, x.ret]), ["Total", S(parSite, (x) => x.marche), "", S(parSite, (x) => x.fact), S(parSite, (x) => x.enc), S(parSite, (x) => x.dep), S(parSite, (x) => x.marge), S(parSite, (x) => x.reste), S(parSite, (x) => x.ret)]]);
    const exporterImp = () => ecTelecharger("situations-impayees-" + today + ".csv", [["Client", "Situations", "0 à 30 j", "31 à 60 j", "Plus de 60 j", "Reste à payer"], ...impayes.map((x) => [x.c.name, x.n, x.b0, x.b1, x.b2, x.reste]), ["Total", S(impayes, (x) => x.n), S(impayes, (x) => x.b0), S(impayes, (x) => x.b1), S(impayes, (x) => x.b2), S(impayes, (x) => x.reste)]]);
    return (
      <div>
        <div className="flex flex-wrap gap-2 items-end mb-4">
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Du</label><input type="date" value={rd} onChange={(e) => setRd(e.target.value)} data-testid="bt-rapport-du" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Au</label><input type="date" value={rf} onChange={(e) => setRf(e.target.value)} data-testid="bt-rapport-au" className={ecInput} style={ecBorder} /></div>
          {(rd || rf) && <button className="text-xs underline" onClick={() => { setRd(""); setRf(""); }}>Tout afficher</button>}
          <div className="text-xs" style={{ color: "#7A7460" }}>Le filtre porte sur la date des situations et des dépenses ; marché, avancement, reste à facturer et retenue sont toujours à ce jour.</div>
        </div>
        <div className="flex items-center justify-between mb-2"><div className="display text-base" style={{ color: "#152238" }}>Rentabilité par chantier</div><button onClick={exporterSite} className="text-xs underline" data-testid="bt-rapport-export-ch">Exporter</button></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Chantier</th><th className="text-right">Marché (HT)</th><th className="text-right">Avancement</th><th className="text-right">Facturé (HT)</th><th className="text-right">Encaissé</th><th className="text-right">Dépenses</th><th className="text-right">Marge</th><th className="text-right">Reste à facturer</th><th className="text-right">Retenue à libérer</th></tr></thead>
          <tbody>{parSite.map((x) => (<tr key={x.s.id} data-testid="bt-rapport-ch"><td className="py-1.5">{x.s.name}</td><td className="text-right tabular">{fmt(x.marche)}</td><td className="text-right tabular">{x.avanc} %</td><td className="text-right tabular">{fmt(x.fact)}</td><td className="text-right tabular">{fmt(x.enc)}</td><td className="text-right tabular">{fmt(x.dep)}</td><td className="text-right tabular">{fmt(x.marge)}</td><td className="text-right tabular">{fmt(x.reste)}</td><td className="text-right tabular">{fmt(x.ret)}</td></tr>))}</tbody>
          {parSite.length > 0 && <tfoot><tr style={tf} data-testid="bt-rapport-ch-total"><td>Total</td><td className="text-right tabular" data-testid="bt-rapport-ch-tot-marche">{fmt(S(parSite, (x) => x.marche))}</td><td></td><td className="text-right tabular" data-testid="bt-rapport-ch-tot-fact">{fmt(S(parSite, (x) => x.fact))}</td><td className="text-right tabular" data-testid="bt-rapport-ch-tot-enc">{fmt(S(parSite, (x) => x.enc))}</td><td className="text-right tabular" data-testid="bt-rapport-ch-tot-dep">{fmt(S(parSite, (x) => x.dep))}</td><td className="text-right tabular" data-testid="bt-rapport-ch-tot-marge">{fmt(S(parSite, (x) => x.marge))}</td><td className="text-right tabular" data-testid="bt-rapport-ch-tot-reste">{fmt(S(parSite, (x) => x.reste))}</td><td className="text-right tabular" data-testid="bt-rapport-ch-tot-ret">{fmt(S(parSite, (x) => x.ret))}</td></tr></tfoot>}</table></div>
        <div className="flex items-center justify-between mb-2 mt-5"><div className="display text-base" style={{ color: "#152238" }}>Situations impayées par client (ancienneté)</div><button onClick={exporterImp} className="text-xs underline" data-testid="bt-rapport-export-imp">Exporter</button></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Client</th><th className="text-right">Situations</th><th className="text-right">0 à 30 j</th><th className="text-right">31 à 60 j</th><th className="text-right">Plus de 60 j</th><th className="text-right">Reste à payer</th></tr></thead>
          <tbody>{impayes.map((x) => (<tr key={x.c.id} data-testid="bt-rapport-imp"><td className="py-1.5">{x.c.name}</td><td className="text-right tabular">{x.n}</td><td className="text-right tabular">{fmt(x.b0)}</td><td className="text-right tabular">{fmt(x.b1)}</td><td className="text-right tabular">{fmt(x.b2)}</td><td className="text-right tabular">{fmt(x.reste)}</td></tr>))}</tbody>
          {impayes.length > 0 && <tfoot><tr style={tf} data-testid="bt-rapport-imp-total"><td>Total</td><td className="text-right tabular">{S(impayes, (x) => x.n)}</td><td className="text-right tabular">{fmt(S(impayes, (x) => x.b0))}</td><td className="text-right tabular">{fmt(S(impayes, (x) => x.b1))}</td><td className="text-right tabular">{fmt(S(impayes, (x) => x.b2))}</td><td className="text-right tabular" data-testid="bt-rapport-imp-tot-reste">{fmt(S(impayes, (x) => x.reste))}</td></tr></tfoot>}</table></div>
        {impayes.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucune situation impayée sur cette période.</div>}
        <div className="display text-base mb-2 mt-5" style={{ color: "#152238" }}>Dépenses par nature</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Nature</th><th className="text-right">Opérations</th><th className="text-right">Montant</th></tr></thead>
          <tbody>{parNature.map((x) => (<tr key={x.l} data-testid="bt-rapport-nature"><td className="py-1.5">{x.l}</td><td className="text-right tabular">{x.n}</td><td className="text-right tabular">{fmt(x.m)}</td></tr>))}</tbody>
          {parNature.length > 0 && <tfoot><tr style={tf}><td>Total</td><td className="text-right tabular">{S(parNature, (x) => x.n)}</td><td className="text-right tabular" data-testid="bt-rapport-nature-tot">{fmt(S(parNature, (x) => x.m))}</td></tr></tfoot>}</table></div>
        <div className="display text-base mb-2 mt-5" style={{ color: "#152238" }}>Dettes envers les fournisseurs et sous-traitants (à ce jour)</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Fournisseur / sous-traitant</th><th className="text-right">Reste à payer</th></tr></thead>
          <tbody>{lignesTiers.map((x) => (<tr key={x.k} data-testid="bt-rapport-dette"><td className="py-1.5">{x.k}</td><td className="text-right tabular">{fmt(x.m)}</td></tr>))}</tbody>
          {lignesTiers.length > 0 && <tfoot><tr style={tf}><td>Total</td><td className="text-right tabular" data-testid="bt-rapport-dette-tot">{fmt(S(lignesTiers, (x) => x.m))}</td></tr></tfoot>}</table></div>
        {lignesTiers.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucune dette en cours.</div>}
      </div>
    );
  };

  // ───────── Statistiques ─────────
  const Stats = () => {
    const sA = sits.filter((x) => x.status !== "annulee");
    const dA = deps.filter((x) => x.status !== "annulé");
    const fT = btR2(sA.reduce((t, x) => t + x.ht, 0));
    const depT = btR2(dA.reduce((t, x) => t + x.amount, 0));
    const encT = btR2(sA.reduce((t, x) => t + btSolde(x).paye, 0));
    const mois = statMois(6, today);
    const data = mois.map((m) => ({ mois: m.label, ca: statSomme(sA, "date", m.key, (x) => x.ht), dep: statSomme(dA, "date", m.key, (x) => x.amount) }));
    const parSite = {}; sA.forEach((x) => { const k = nomSite(x.siteId); parSite[k] = btR2((parSite[k] || 0) + x.ht); });
    const depSite = {}; dA.forEach((x) => { const k = nomSite(x.siteId); depSite[k] = btR2((depSite[k] || 0) + x.amount); });
    const parNat = {}; dA.forEach((x) => { const k = (BT_DEPENSES.find((d) => d[0] === x.kind) || [0, x.kind])[1]; parNat[k] = btR2((parNat[k] || 0) + x.amount); });
    const parEtat = {}; sites.forEach((s) => { const k = (BT_ETATS.find((e) => e[0] === s.status) || [0, s.status])[1]; parEtat[k] = (parEtat[k] || 0) + 1; });
    const parCli = {}; sA.forEach((x) => { const r = btSolde(x).reste; if (r > 0.004) { const k = nomClient(x.clientId); parCli[k] = btR2((parCli[k] || 0) + r); } });
    return <StatsBloc
      vide={sites.length + sits.length === 0 ? "Aucun chantier pour le moment : les statistiques apparaîtront avec vos premières situations et dépenses." : ""}
      kpis={[["Travaux facturés (hors taxe)", fmt(fT), "bt-stat-fact"], ["Encaissé", fmt(encT), "bt-stat-enc"], ["Dépenses de chantier", fmt(depT), "bt-stat-dep"], ["Marge", fmt(btR2(fT - depT)), "bt-stat-marge"]]}
      evolution={{ titre: "Travaux facturés et dépenses — 6 derniers mois", data, series: [{ key: "ca", name: "Travaux facturés", color: "#0F6B5C" }, { key: "dep", name: "Dépenses", color: "#9A7B1E" }] }}
      repartitions={[{ titre: "Travaux facturés par chantier", data: Object.keys(parSite).map((k) => ({ name: k, value: parSite[k] })) }, { titre: "Dépenses par chantier", data: Object.keys(depSite).map((k) => ({ name: k, value: depSite[k] })) }, { titre: "Dépenses par nature", data: Object.keys(parNat).map((k) => ({ name: k, value: parNat[k] })) }, { titre: "Chantiers par état", unite: "nombre", data: Object.keys(parEtat).map((k) => ({ name: k, value: parEtat[k] })) }, { titre: "Situations impayées par client", data: Object.keys(parCli).map((k) => ({ name: k, value: parCli[k] })) }]} />;
  };

  const tabs = isVendeur
    ? [["apercu", "Tableau de bord"], ["clients", "Clients"], ["situations", "Situations"]]
    : [["apercu", "Tableau de bord"], ["chantiers", "Chantiers"], ["clients", "Clients"], ["situations", "Situations"], ["depenses", "Dépenses"], ["rapports", "Rapports"], ["stats", "Statistiques"]];
  const imprDoc = (() => {
    if (!imprimer) return null;
    if (imprimer.kind === "journal") { const s = sites.find((y) => y.id === imprimer.id); return s ? { titre: "Journal de chantier — " + s.name, node: <JournalSheet s={s} dates={imprimer.dates || []} /> } : null; }
    if (imprimer.kind === "cr") { const s = sites.find((y) => y.id === imprimer.id); const v = s && (s.visits || []).find((y) => y.id === imprimer.vid); return v ? { titre: "Compte rendu — " + v.subject, node: <CrSheet s={s} v={v} /> } : null; }
    if (imprimer.kind === "pv") { const s = sites.find((y) => y.id === imprimer.id); return s ? { titre: "PV de réception " + (imprimer.type === "prov" ? "provisoire" : "définitive") + " — " + s.name, node: <PvSheet s={s} type={imprimer.type} /> } : null; }
    if (imprimer.kind === "devis") { const s = sites.find((x) => x.id === imprimer.id); return s ? { titre: "Devis " + s.number, node: <DevisSheet s={s} /> } : null; }
    const x = sits.find((y) => y.id === imprimer.id);
    return x ? { titre: "Situation " + x.number, node: <SituationSheet x={x} /> } : null;
  })();
  return (
    <>
      {listes}
      <div className={"p-4 md:p-8 max-w-6xl" + (imprDoc ? " no-print" : "")} data-testid="btp-module">
        <style>{EC_CSS + '[data-testid="btp-module"] .display.text-base{border-left:3px solid #C9A24B;padding-left:10px;margin-bottom:12px}[data-testid="btp-module"] input,[data-testid="btp-module"] select{background:#fff}'}</style>
        <div className="mb-4"><div className="display text-2xl" style={{ color: "#152238" }}>BTP et construction</div><div className="text-xs" style={{ color: "#8A8370" }}>Chantiers, bordereaux de prix, situations de travaux, retenues de garantie, dépenses et rentabilité par chantier</div></div>
        {!canFront && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }}>Consultation seule : votre rôle ne permet pas de modifier les données.</div>}
        {isVendeur && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }} data-testid="bt-secretariat-note">Secrétariat : vous pouvez enregistrer les clients, émettre les situations de travaux, encaisser et imprimer. Chantiers, dépenses, annulations et rapports sont réservés au responsable.</div>}
        <div className="ec-tabs">
          {tabs.map(([id, l]) => (<button key={id} onClick={() => setTab(id)} data-testid={"bt-tab-" + id} className="px-3 py-2 text-sm rounded-lg transition-colors" style={{ background: tab === id ? "#152238" : "transparent", color: tab === id ? "#EFE9DD" : "#6B6552", fontWeight: tab === id ? 600 : 500 }}>{l}</button>))}
        </div>
        {tab === "apercu" && Apercu()}
        {tab === "chantiers" && !isVendeur && Chantiers()}
        {tab === "clients" && Clients()}
        {tab === "situations" && Situations()}
        {tab === "depenses" && !isVendeur && Depenses()}
        {tab === "rapports" && !isVendeur && Rapports()}
        {tab === "stats" && !isVendeur && Stats()}
      </div>
      {imprDoc && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto p-3 md:p-8 no-print" style={{ background: "rgba(21,34,56,0.55)" }} onClick={() => setImprimer(null)} data-testid="bt-apercu">
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 820 }}>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap"><div className="text-sm" style={{ color: "#EFE9DD" }}>{imprDoc.titre}</div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => { try { window.print(); } catch (e) {} }} className="px-3 py-1.5 rounded text-sm" style={ecBtnGold} data-testid="bt-imprimer-ok">Imprimer / enregistrer en PDF</button>
                <button onClick={() => setImprimer(null)} className="px-3 py-1.5 rounded text-sm" style={ecBtn} data-testid="bt-apercu-fermer">Fermer</button></div></div>
            <div className="rounded shadow-lg overflow-auto" style={{ background: "#fff" }}>{imprDoc.node}</div>
          </div>
        </div>
      )}
      {imprDoc && <div className="print-only">{imprDoc.node}</div>}
    </>
  );
}

// ═══ MODULE ═══
// @module Immobilier
// @depends EC_CSS, Plus, StatsBloc, ecBorder, ecBtn, ecBtnGold, ecDateFr, ecInput, ecPastille
//   ecTelecharger, fmt, isFutureDate, isLocked, statMois, statSomme, todayStr, uid, useBrouillon
//   useState
// @exports ImmobilierModule
// ═══ FIN DE L'EN-TÊTE ═══
// Bloc Immobilier et location : biens, locataires, baux (dépôt de garantie), loyers mensuels (émission, encaissement, retards),
// avis d'échéance et quittances imprimables (A4 ou ticket), dépenses par bien, rapports (impayés, rentabilité par bien) et statistiques.
// Rien n'est préréglé : loyers, charges, jour d'échéance, dépôt et taxe éventuelle sont saisis par l'entreprise.
//
// Comptabilité (tout en gourdes) :
//  • loyer émis : Débit 411 (total) / Crédit 706 (loyers), 708 (charges refacturées) et 445 (taxe, seulement si activée) ;
//  • encaissement : Débit caisse ou banque / Crédit 411 ;
//  • dépôt de garantie reçu : Débit caisse ou banque / Crédit 165 ; rendu : Débit 165 / Crédit caisse ou banque (et 708 pour la retenue) ;
//  • dépense d'un bien : Débit 6152 entretien et réparations, 6411 impôts fonciers, 616 assurance, 605 eau et électricité, 628 autres /
//    Crédit caisse, banque ou 401 (à payer) ;
//  • toute annulation passe une écriture inverse.
// Les comptes 706, 708, 165, 6152, 6411, 616, 605 et 628 sont à confirmer avec l'expert-comptable.

const IM_DEPENSES = [["entretien", "Entretien et réparations", "6152"], ["taxes", "Impôts fonciers et taxes", "6411"], ["assurance", "Assurance du bien", "616"], ["eau", "Eau, électricité (parties communes ou à charge)", "605"], ["autre", "Autres frais", "628"]];
const IM_COMPTES = {
  "411": { name: "Clients (locataires)", type: "Actif" },
  "401": { name: "Fournisseurs", type: "Passif" },
  "445": { name: "Taxe collectée sur ventes (IVA/TCA)", type: "Passif" },
  "165": { name: "Dépôts et cautionnements reçus", type: "Passif" },
  "706": { name: "Loyers", type: "Produit" },
  "708": { name: "Charges locatives refacturées et produits annexes", type: "Produit" },
  "6152": { name: "Entretien et réparations des immeubles", type: "Charge" },
  "6411": { name: "Impôts fonciers et taxes annexes", type: "Charge" },
  "616": { name: "Primes d'assurance", type: "Charge" },
  "605": { name: "Eau, électricité, énergie", type: "Charge" },
  "628": { name: "Autres frais de gestion locative", type: "Charge" },
  "512": { name: "Banque", type: "Actif" },
  "530": { name: "Caisse", type: "Actif" },
};
const IM_MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const imR2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const imId = () => String(uid());
const imRows = (rows, type) => (rows || []).filter((r) => r && r.type === type);
const imJours = (a, b) => (a && b ? Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000) : 0);
const imNom = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const imUniq = (arr) => Array.from(new Set(arr.map((x) => String(x || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
const imPeriode = (p) => (p && p.length >= 7 ? IM_MOIS[Number(p.slice(5, 7)) - 1] + " " + p.slice(0, 4) : "—");
function imAjouterComptes(accounts, setAccounts, codes) {
  const missing = [...new Set(codes)].filter((k) => IM_COMPTES[k] && !accounts.some((a) => a.code === k)).map((k) => ({ code: k, name: IM_COMPTES[k].name, type: IM_COMPTES[k].type }));
  if (missing.length) setAccounts((prev) => [...prev, ...missing.filter((m) => !prev.some((a) => a.code === m.code))]);
}
// Soldes d'un loyer émis (gourdes)
function imSolde(r) {
  const paye = imR2((r.payments || []).filter((p) => p.status !== "annulé").reduce((s, p) => s + p.amount, 0));
  return { paye, reste: imR2((r.total || 0) - paye) };
}

function ImmobilierModule({ immo, setImmo, entries, setEntries, accounts, setAccounts, settings, role, showToast, logAudit, currentUserEmail }) {
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const isVendeur = role === "Vendeur"; // accueil : locataires, loyers, encaissements, quittances
  const canFront = canEdit || isVendeur;
  const today = todayStr();
  const moisCourant = today.slice(0, 7);
  const [tab, setTab] = useState("apercu");
  const biens = imRows(immo, "property");
  const locataires = imRows(immo, "tenant");
  const baux = imRows(immo, "lease");
  const loyers = imRows(immo, "rent");
  const depenses = imRows(immo, "expense");
  const cfg = imRows(immo, "config")[0] || {};
  const tcaOn = !!cfg.tcaOn;
  const tcaRate = tcaOn ? Number(settings.taxRate) || 0 : 0;
  const nomBien = (id) => (biens.find((x) => x.id === id) || {}).name || "—";
  const nomLoc = (id) => (locataires.find((x) => x.id === id) || {}).name || "—";
  const bauxActifs = baux.filter((b) => b.status !== "termine");
  const bailDuBien = (id) => bauxActifs.find((b) => b.propertyId === id);
  const compteMode = (m) => (m === "banque" ? "512" : m === "apayer" ? "401" : "530");
  const maj = (id, fn) => setImmo((prev) => (prev || []).map((r) => (r.id === id ? fn(r) : r)));
  const ajouter = (rec) => setImmo((prev) => [...(prev || []), rec]);
  const ecrire = (date, label, lines, dossierId) => {
    const e = { id: uid(), date, createdAt: new Date().toISOString(), label, lines: lines.filter((l) => l.debit > 0 || l.credit > 0), kind: "immo", dossierId };
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
  const echeanceDe = (periode, jour) => periode + "-" + String(Math.min(28, Math.max(1, Number(jour) || 1))).padStart(2, "0");
  const etatLoyer = (r) => (r.status === "annulee" ? "annulee" : imSolde(r).reste <= 0.004 ? "soldee" : r.dueDate < today ? "retard" : "encaisser");
  const [imprimer, setImprimer] = useState(null); // { kind: "avis" | "quittance", id }
  const [tk, setTk] = useState(false);
  const [selBien, setSelBien] = useState("");
  const [selBail, setSelBail] = useState("");
  const [selLoyer, setSelLoyer] = useState("");
  const listes = (<><datalist id="im-dl-type">{imUniq(["Appartement", "Maison", "Studio", "Chambre", "Local commercial", "Bureau", "Entrepôt", "Terrain", ...biens.map((b) => b.kind)]).map((n) => <option key={n} value={n} />)}</datalist><datalist id="im-dl-detail">{imUniq(depenses.map((d) => d.label)).map((n) => <option key={n} value={n} />)}</datalist></>);

  // ───────── Biens ─────────
  const [fb, setFb] = useBrouillon("immo-bien", { name: "", kind: "", address: "", notes: "" });
  const [bq, setBq] = useState(""); const [bet, setBet] = useState("");
  const ajouterBien = () => {
    if (!canEdit) return;
    const name = fb.name.trim();
    if (!name) { showToast("Indiquez le nom du bien (ex. Appartement 2B)."); return; }
    if (biens.some((b) => imNom(b.name) === imNom(name))) { showToast("Un bien de ce nom existe déjà."); return; }
    ajouter({ type: "property", id: imId(), name, kind: fb.kind.trim(), address: fb.address.trim(), notes: fb.notes.trim(), active: true });
    setFb({ name: "", kind: "", address: "", notes: "" });
    showToast("Bien « " + name + " » ajouté."); logAudit("Immobilier", "Bien ajouté", name);
  };
  const Biens = () => {
    const b = biens.find((x) => x.id === selBien);
    const etatBien = (x) => (x.active === false ? "hors" : bailDuBien(x.id) ? "loue" : "libre");
    const bF = biens.filter((x) => (!bet || etatBien(x) === bet) && (!bq.trim() || [x.name, x.kind, x.address, (bailDuBien(x.id) ? nomLoc(bailDuBien(x.id).tenantId) : "")].join(" ").toLowerCase().includes(bq.trim().toLowerCase())));
    const loyerMensuel = (x) => { const bl = bailDuBien(x.id); return bl ? imR2((bl.rent || 0) + (bl.charges || 0)) : 0; };
    return (
      <div>
        {canEdit && (<div className="ec-card p-4 mb-5"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouveau bien</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Nom du bien</label><input value={fb.name} onChange={(e) => setFb({ ...fb, name: e.target.value })} data-testid="im-bien-nom" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Type (appartement, local commercial…)</label><input list="im-dl-type" value={fb.kind} onChange={(e) => setFb({ ...fb, kind: e.target.value })} data-testid="im-bien-type" className={ecInput} style={ecBorder} /></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Adresse</label><input value={fb.address} onChange={(e) => setFb({ ...fb, address: e.target.value })} className={ecInput} style={ecBorder} /></div>
          </div>
          <div className="mt-2"><label className="text-xs" style={{ color: "#8A8370" }}>Remarques (étage, nombre de pièces… facultatif)</label><input value={fb.notes} onChange={(e) => setFb({ ...fb, notes: e.target.value })} className={ecInput} style={ecBorder} /></div>
          <button onClick={ajouterBien} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="im-bien-ajouter">Ajouter le bien</button></div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <div className="flex-1 min-w-[150px]"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (nom, type, adresse, locataire)</label><input value={bq} onChange={(e) => setBq(e.target.value)} data-testid="im-bien-recherche" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>État</label><select value={bet} onChange={(e) => setBet(e.target.value)} data-testid="im-bien-filtre-etat" className={ecInput} style={ecBorder}><option value="">Tous</option><option value="loue">Loué</option><option value="libre">Libre</option><option value="hors">Hors gestion</option></select></div>
        </div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Bien</th><th>Type</th><th>Adresse</th><th>Locataire</th><th className="text-right">Loyer + charges</th><th>État</th><th></th></tr></thead>
          <tbody>{bF.map((x) => { const bl = bailDuBien(x.id); const e = etatBien(x); return (
            <tr key={x.id} data-testid="im-bien-ligne" style={{ background: x.id === selBien ? "#E6F1EE" : undefined, opacity: e === "hors" ? 0.55 : 1 }}><td className="py-1.5 font-semibold">{x.name}</td><td>{x.kind || "—"}</td><td className="text-xs">{x.address || "—"}</td><td>{bl ? nomLoc(bl.tenantId) : "—"}</td><td className="text-right tabular">{bl ? fmt(loyerMensuel(x)) : "—"}</td>
              <td>{e === "loue" ? ecPastille("Loué", "ok") : e === "libre" ? ecPastille("Libre", "attente") : ecPastille("Hors gestion", "neutre")}</td>
              <td className="text-right whitespace-nowrap"><button onClick={() => setSelBien(x.id === selBien ? "" : x.id)} className="text-xs underline" data-testid="im-bien-ouvrir">{x.id === selBien ? "Fermer" : "Ouvrir"}</button></td></tr>); })}</tbody>
          {bF.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="im-bien-total-ligne"><td colSpan={4}>Total ({bF.length} bien{bF.length > 1 ? "s" : ""}, dont {bF.filter((x) => etatBien(x) === "loue").length} loué{bF.filter((x) => etatBien(x) === "loue").length > 1 ? "s" : ""})</td><td className="text-right tabular" data-testid="im-bien-tot-loyer">{fmt(imR2(bF.reduce((s, x) => s + loyerMensuel(x), 0)))}</td><td colSpan={2}></td></tr></tfoot>}</table></div>
        {bF.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{biens.length === 0 ? "Aucun bien." : "Aucun bien ne correspond à ces filtres."}</div>}
        {b && (<div className="ec-card p-4 mt-5" data-testid="im-bien-detail">
          <div className="display text-lg mb-3" style={{ color: "#152238" }}>{b.name}{b.kind ? " — " + b.kind : ""}</div>
          <div className="grid md:grid-cols-3 gap-2 mb-3 items-end">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Adresse</label><input value={b.address || ""} disabled={!canEdit} onChange={(e) => maj(b.id, (r) => ({ ...r, address: e.target.value }))} className={ecInput} style={ecBorder} /></div>
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={b.active !== false} disabled={!canEdit || !!bailDuBien(b.id)} onChange={(e) => maj(b.id, (r) => ({ ...r, active: e.target.checked }))} data-testid="im-bien-actif" />En gestion {bailDuBien(b.id) ? "(bail en cours)" : ""}</label>
          </div>
          <div className="text-sm mb-2" style={{ color: "#5B563F" }}>Loyers facturés (hors annulés) : <b className="tabular" data-testid="im-bien-fact">{fmt(imR2(loyers.filter((r) => r.propertyId === b.id && r.status !== "annulee").reduce((s, r) => s + r.ht, 0)))}</b> · dépenses : <b className="tabular" data-testid="im-bien-dep">{fmt(imR2(depenses.filter((d) => d.propertyId === b.id && d.status !== "annulé").reduce((s, d) => s + d.amount, 0)))}</b></div>
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Baux de ce bien</div>
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>Locataire</th><th>Début</th><th>Fin</th><th className="text-right">Loyer</th><th>État</th></tr></thead>
            <tbody>{baux.filter((x) => x.propertyId === b.id).map((x) => (<tr key={x.id} data-testid="im-bien-bail-ligne"><td className="py-1.5 tabular text-xs">{x.number}</td><td>{nomLoc(x.tenantId)}</td><td>{ecDateFr(x.start)}</td><td>{x.status === "termine" ? ecDateFr(x.endDate) : x.end ? ecDateFr(x.end) : "—"}</td><td className="text-right tabular">{fmt(x.rent)}</td><td>{x.status === "termine" ? ecPastille("Terminé", "neutre") : ecPastille("En cours", "ok")}</td></tr>))}</tbody></table></div>
          {baux.filter((x) => x.propertyId === b.id).length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun bail pour ce bien.</div>}
        </div>)}
      </div>
    );
  };

  // ───────── Locataires ─────────
  const [fl, setFl] = useBrouillon("immo-locataire", { name: "", phone: "", address: "" });
  const [lq, setLq] = useState("");
  const ajouterLocataire = () => {
    if (!canFront) return;
    if (!fl.name.trim()) { showToast("Indiquez le nom du locataire."); return; }
    if (locataires.some((c) => imNom(c.name) === imNom(fl.name))) { showToast("Un locataire de ce nom existe déjà."); return; }
    ajouter({ type: "tenant", id: imId(), name: fl.name.trim(), phone: fl.phone.trim(), address: fl.address.trim() });
    setFl({ name: "", phone: "", address: "" }); showToast("Locataire ajouté.");
  };
  const resteLoc = (id) => imR2(loyers.filter((r) => r.tenantId === id && r.status !== "annulee").reduce((s, r) => s + imSolde(r).reste, 0));
  const Locataires = () => {
    const lF = locataires.filter((c) => !lq.trim() || [c.name, c.phone, c.address].join(" ").toLowerCase().includes(lq.trim().toLowerCase()));
    return (
      <div>
        {canFront && (<div className="ec-card p-4 mb-5"><div className="grid md:grid-cols-4 gap-2 items-end">
          <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom du locataire</label><input value={fl.name} onChange={(e) => setFl({ ...fl, name: e.target.value })} data-testid="im-loc-nom" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Téléphone</label><input type="tel" value={fl.phone} onChange={(e) => setFl({ ...fl, phone: e.target.value })} className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Adresse ou pièce d'identité (facultatif)</label><input value={fl.address} onChange={(e) => setFl({ ...fl, address: e.target.value })} className={ecInput} style={ecBorder} /></div>
        </div><button onClick={ajouterLocataire} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="im-loc-ajouter">Ajouter le locataire</button></div>)}
        <div className="mb-2"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (nom, téléphone)</label><input value={lq} onChange={(e) => setLq(e.target.value)} data-testid="im-loc-recherche" className={ecInput} style={{ ...ecBorder, maxWidth: 360 }} /></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Locataire</th><th>Téléphone</th><th>Bien loué</th><th className="text-right">Reste à payer</th></tr></thead>
          <tbody>{lF.map((c) => { const bl = bauxActifs.find((x) => x.tenantId === c.id); return (<tr key={c.id} data-testid="im-loc-ligne"><td className="py-1.5">{c.name}</td><td>{c.phone || "—"}</td><td className="text-xs">{bl ? nomBien(bl.propertyId) : "—"}</td><td className="text-right tabular">{fmt(resteLoc(c.id))}</td></tr>); })}</tbody>
          {lF.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="im-loc-total-ligne"><td colSpan={3}>Total ({lF.length})</td><td className="text-right tabular" data-testid="im-loc-tot-reste">{fmt(imR2(lF.reduce((s, c) => s + resteLoc(c.id), 0)))}</td></tr></tfoot>}</table></div>
        {lF.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{locataires.length === 0 ? "Aucun locataire." : "Aucun résultat."}</div>}
      </div>
    );
  };

  // ───────── Baux et dépôts de garantie ─────────
  const [fba, setFba] = useBrouillon("immo-bail", { propertyId: "", tenantId: "", start: todayStr(), end: "", rent: "", charges: "", dueDay: "5", deposit: "" });
  const [bst, setBst] = useState(""); const [bqq, setBqq] = useState("");
  const [dp, setDp] = useState({ mode: "caisse", date: todayStr(), rendu: "" });
  const creerBail = () => {
    if (!canEdit) return;
    if (!fba.propertyId) { showToast("Choisissez le bien."); return; }
    if (bailDuBien(fba.propertyId)) { showToast("Ce bien a déjà un bail en cours : terminez-le avant d'en créer un autre."); return; }
    if (!fba.tenantId) { showToast("Choisissez le locataire."); return; }
    if (!fba.start) { showToast("Indiquez la date de début du bail."); return; }
    if (fba.end && fba.end < fba.start) { showToast("La date de fin doit être après la date de début."); return; }
    const rent = Number(fba.rent);
    if (!(rent > 0)) { showToast("Indiquez le loyer mensuel (en gourdes)."); return; }
    const b = { type: "lease", id: imId(), number: numero("BA", baux, fba.start), propertyId: fba.propertyId, tenantId: fba.tenantId, start: fba.start, end: fba.end, rent, charges: Number(fba.charges) || 0, dueDay: Math.min(28, Math.max(1, Number(fba.dueDay) || 1)), deposit: Number(fba.deposit) || 0, depositStatus: "", status: "actif", createdAt: new Date().toISOString(), by: currentUserEmail || "" };
    ajouter(b);
    setFba({ ...fba, propertyId: "", tenantId: "", end: "", rent: "", charges: "", deposit: "" });
    setSelBail(b.id);
    showToast("Bail " + b.number + " enregistré."); logAudit("Immobilier", "Bail créé", b.number + " — " + nomBien(b.propertyId) + " / " + nomLoc(b.tenantId));
  };
  const recevoirDepot = (b) => {
    if (!canEdit || b.depositStatus || !(b.deposit > 0)) return;
    if (!verifDate(dp.date, "enregistrer ce dépôt")) return;
    const cpt = compteMode(dp.mode === "banque" ? "banque" : "caisse");
    imAjouterComptes(accounts, setAccounts, [cpt, "165"]);
    const e = ecrire(dp.date, "Dépôt de garantie " + b.number + " — " + nomLoc(b.tenantId), [{ account: cpt, debit: b.deposit, credit: 0 }, { account: "165", debit: 0, credit: b.deposit }], b.id);
    maj(b.id, (r) => ({ ...r, depositStatus: "recu", depositDate: dp.date, depositEntryId: e.id }));
    showToast("Dépôt de garantie de " + fmt(b.deposit) + " enregistré."); logAudit("Immobilier", "Dépôt reçu", b.number + " — " + fmt(b.deposit));
  };
  const annulerDepot = (b) => {
    if (!canEdit || b.depositStatus !== "recu") return;
    if (!verifDate(today, "annuler ce dépôt")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler le dépôt de garantie ? Une écriture inverse sera passée.")) return;
    contre(b.depositEntryId, "Annulation dépôt de garantie " + b.number + " (écriture inverse)", today, b.id);
    maj(b.id, (r) => ({ ...r, depositStatus: "", depositEntryId: "" }));
    showToast("Dépôt annulé.");
  };
  const rendreDepot = (b) => {
    if (!canEdit || b.depositStatus !== "recu") return;
    if (b.status !== "termine") { showToast("Terminez d'abord le bail avant de rendre le dépôt."); return; }
    const rendu = dp.rendu === "" ? b.deposit : imR2(dp.rendu);
    if (!(rendu >= 0) || rendu > b.deposit + 0.004) { showToast("Le montant rendu doit être compris entre 0 et " + fmt(b.deposit) + "."); return; }
    if (!verifDate(dp.date, "rendre ce dépôt")) return;
    const retenue = imR2(b.deposit - rendu);
    const cpt = compteMode(dp.mode === "banque" ? "banque" : "caisse");
    imAjouterComptes(accounts, setAccounts, [cpt, "165", ...(retenue > 0 ? ["708"] : [])]);
    const e = ecrire(dp.date, "Restitution dépôt " + b.number + " — " + nomLoc(b.tenantId) + (retenue > 0 ? " (retenue " + fmt(retenue) + ")" : ""), [{ account: "165", debit: b.deposit, credit: 0 }, { account: cpt, debit: 0, credit: rendu }, { account: "708", debit: 0, credit: retenue }], b.id);
    maj(b.id, (r) => ({ ...r, depositStatus: "rendu", depositRendu: rendu, depositRetenue: retenue, depositReturnEntryId: e.id, depositReturnDate: dp.date }));
    setDp({ ...dp, rendu: "" });
    showToast("Dépôt restitué : " + fmt(rendu) + (retenue > 0 ? " (retenue " + fmt(retenue) + ")" : "") + "."); logAudit("Immobilier", "Dépôt restitué", b.number + " — " + fmt(rendu));
  };
  const terminerBail = (b) => {
    if (!canEdit || b.status === "termine") return;
    const dus = loyers.filter((r) => r.leaseId === b.id && r.status !== "annulee").reduce((s, r) => s + imSolde(r).reste, 0);
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Mettre fin au bail " + b.number + " aujourd'hui ?" + (dus > 0.004 ? " Attention : il reste " + fmt(imR2(dus)) + " de loyers impayés." : ""))) return;
    maj(b.id, (r) => ({ ...r, status: "termine", endDate: today }));
    showToast("Bail terminé : le bien est de nouveau libre."); logAudit("Immobilier", "Bail terminé", b.number);
  };
  const Baux = () => {
    const b = baux.find((x) => x.id === selBail);
    const bF = baux.filter((x) => (!bst || (bst === "actif" ? x.status !== "termine" : x.status === "termine")) && (!bqq.trim() || [x.number, nomBien(x.propertyId), nomLoc(x.tenantId)].join(" ").toLowerCase().includes(bqq.trim().toLowerCase()))).sort((a, c) => String(c.number).localeCompare(String(a.number)));
    const libres = biens.filter((x) => x.active !== false && !bailDuBien(x.id));
    return (
      <div>
        {canEdit && (<div className="ec-card p-4 mb-5" data-testid="im-nouveau-bail"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouveau bail</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Bien</label><select value={fba.propertyId} onChange={(e) => setFba({ ...fba, propertyId: e.target.value })} data-testid="im-bail-bien" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{biens.filter((x) => x.active !== false).map((x) => { const bl = bailDuBien(x.id); return <option key={x.id} value={x.id} disabled={!!bl}>{x.name}{bl ? " — loué à " + nomLoc(bl.tenantId) : ""}</option>; })}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Locataire</label><select value={fba.tenantId} onChange={(e) => setFba({ ...fba, tenantId: e.target.value })} data-testid="im-bail-locataire" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{locataires.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Début du bail</label><input type="date" value={fba.start} onChange={(e) => setFba({ ...fba, start: e.target.value })} data-testid="im-bail-debut" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Fin prévue (facultatif)</label><input type="date" value={fba.end} onChange={(e) => setFba({ ...fba, end: e.target.value })} data-testid="im-bail-fin" className={ecInput} style={ecBorder} /></div>
          </div>
          <div className="grid md:grid-cols-5 gap-2 items-end mt-2">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Loyer mensuel (gourdes)</label><input type="number" min="0" value={fba.rent} onChange={(e) => setFba({ ...fba, rent: e.target.value })} data-testid="im-bail-loyer" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Charges mensuelles (facultatif)</label><input type="number" min="0" value={fba.charges} onChange={(e) => setFba({ ...fba, charges: e.target.value })} data-testid="im-bail-charges" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Loyer dû le (jour du mois)</label><select value={fba.dueDay} onChange={(e) => setFba({ ...fba, dueDay: e.target.value })} data-testid="im-bail-jour" className={ecInput} style={ecBorder}>{Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Dépôt de garantie (facultatif)</label><input type="number" min="0" value={fba.deposit} onChange={(e) => setFba({ ...fba, deposit: e.target.value })} data-testid="im-bail-depot" className={ecInput + " tabular"} style={ecBorder} /></div>
            <button onClick={creerBail} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="im-bail-creer">Enregistrer le bail</button>
          </div>
          {libres.length === 0 && <div className="text-sm mt-3 p-2 rounded" style={{ background: "#FFF6E0", color: "#152238" }} data-testid="im-bail-aucun-libre">{biens.length === 0 ? "Vous n'avez encore aucun bien : ouvrez l'onglet Biens et ajoutez-en un, puis revenez ici." : biens.filter((x) => x.active !== false).length === 0 ? "Tous vos biens sont « Hors gestion » : dans l'onglet Biens, ouvrez un bien et cochez « En gestion »." : "Tous vos biens en gestion ont déjà un bail en cours (ils sont grisés dans la liste). Pour louer l'un d'eux à un nouveau locataire, ouvrez son bail ci-dessous et cliquez sur « Mettre fin à ce bail » ; sinon ajoutez un nouveau bien dans l'onglet Biens."}</div>}
          {libres.length > 0 && biens.filter((x) => x.active === false).length > 0 && <div className="text-xs mt-2" style={{ color: "#7A7460" }}>{biens.filter((x) => x.active === false).length} bien(s) « Hors gestion » ne sont pas proposés.</div>}
        </div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <div className="flex-1 min-w-[150px]"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (n°, bien, locataire)</label><input value={bqq} onChange={(e) => setBqq(e.target.value)} data-testid="im-bail-recherche" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>État</label><select value={bst} onChange={(e) => setBst(e.target.value)} data-testid="im-bail-filtre-etat" className={ecInput} style={ecBorder}><option value="">Tous</option><option value="actif">En cours</option><option value="termine">Terminés</option></select></div>
        </div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>Bien</th><th>Locataire</th><th>Début</th><th>Fin</th><th className="text-right">Loyer + charges</th><th className="text-right">Dépôt</th><th>État</th><th></th></tr></thead>
          <tbody>{bF.map((x) => (<tr key={x.id} data-testid="im-bail-ligne" style={{ background: x.id === selBail ? "#E6F1EE" : undefined, opacity: x.status === "termine" ? 0.6 : 1 }}><td className="py-1.5 tabular text-xs">{x.number}</td><td>{nomBien(x.propertyId)}</td><td>{nomLoc(x.tenantId)}</td><td>{ecDateFr(x.start)}</td><td>{x.status === "termine" ? ecDateFr(x.endDate) : x.end ? ecDateFr(x.end) : "—"}</td><td className="text-right tabular">{fmt(imR2(x.rent + x.charges))}</td><td className="text-right tabular">{x.deposit > 0 ? fmt(x.deposit) : "—"}</td>
            <td>{x.status === "termine" ? ecPastille("Terminé", "neutre") : ecPastille("En cours", "ok")}</td>
            <td className="text-right whitespace-nowrap"><button onClick={() => setSelBail(x.id === selBail ? "" : x.id)} className="text-xs underline" data-testid="im-bail-ouvrir">{x.id === selBail ? "Fermer" : "Ouvrir"}</button></td></tr>))}</tbody>
          {bF.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="im-bail-total-ligne"><td colSpan={5}>Total ({bF.length})</td><td className="text-right tabular" data-testid="im-bail-tot-loyer">{fmt(imR2(bF.filter((x) => x.status !== "termine").reduce((s, x) => s + x.rent + x.charges, 0)))}</td><td className="text-right tabular">{fmt(imR2(bF.reduce((s, x) => s + (x.deposit || 0), 0)))}</td><td colSpan={2}></td></tr></tfoot>}</table></div>
        {bF.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{baux.length === 0 ? "Aucun bail." : "Aucun bail ne correspond à ces filtres."}</div>}
        {b && (<div className="ec-card p-4 mt-5" data-testid="im-bail-detail">
          <div className="display text-lg mb-2" style={{ color: "#152238" }}>{b.number} — {nomBien(b.propertyId)} / {nomLoc(b.tenantId)}</div>
          <div className="text-sm mb-3" style={{ color: "#5B563F" }}>Loyer {fmt(b.rent)} + charges {fmt(b.charges)} · dû le {b.dueDay} de chaque mois · depuis le {ecDateFr(b.start)}{b.status === "termine" ? " · terminé le " + ecDateFr(b.endDate) : ""}</div>
          {canEdit && b.status !== "termine" && (<div className="grid md:grid-cols-4 gap-2 mb-3 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Loyer mensuel</label><input type="number" min="0" value={b.rent || ""} onChange={(e) => maj(b.id, (r) => ({ ...r, rent: Number(e.target.value) || 0 }))} data-testid="im-bail-edit-loyer" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Charges mensuelles</label><input type="number" min="0" value={b.charges || ""} onChange={(e) => maj(b.id, (r) => ({ ...r, charges: Number(e.target.value) || 0 }))} className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Fin prévue</label><input type="date" value={b.end || ""} onChange={(e) => maj(b.id, (r) => ({ ...r, end: e.target.value }))} className={ecInput} style={ecBorder} /></div>
            <div className="text-xs" style={{ color: "#7A7460" }}>Le nouveau loyer s'applique aux prochains loyers émis.</div>
          </div>)}
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Dépôt de garantie</div>
          {!(b.deposit > 0) ? <div className="text-sm mb-3" style={{ color: "#8A8370" }}>Aucun dépôt prévu pour ce bail.</div> : (
            <div className="mb-3">
              <div className="text-sm mb-2" data-testid="im-depot-etat">{fmt(b.deposit)} — {b.depositStatus === "recu" ? <>reçu le {ecDateFr(b.depositDate)} {ecPastille("En garde", "ok")}</> : b.depositStatus === "rendu" ? <>restitué le {ecDateFr(b.depositReturnDate)} : {fmt(b.depositRendu)}{b.depositRetenue > 0 ? " (retenue " + fmt(b.depositRetenue) + ")" : ""} {ecPastille("Restitué", "neutre")}</> : <>pas encore reçu {ecPastille("À encaisser", "attente")}</>}</div>
              {canEdit && b.depositStatus !== "rendu" && (<div className="grid md:grid-cols-5 gap-2 items-end">
                <div><label className="text-xs" style={{ color: "#8A8370" }}>Mode</label><select value={dp.mode} onChange={(e) => setDp({ ...dp, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Espèces</option><option value="banque">Banque</option></select></div>
                <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" value={dp.date} max={todayStr()} onChange={(e) => setDp({ ...dp, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
                {!b.depositStatus && <button onClick={() => recevoirDepot(b)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="im-depot-recevoir">Enregistrer le dépôt reçu</button>}
                {b.depositStatus === "recu" && b.status === "termine" && <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant rendu (vide = tout)</label><input type="number" min="0" value={dp.rendu} onChange={(e) => setDp({ ...dp, rendu: e.target.value })} data-testid="im-depot-rendu" className={ecInput + " tabular"} style={ecBorder} /></div>}
                {b.depositStatus === "recu" && b.status === "termine" && <button onClick={() => rendreDepot(b)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="im-depot-rendre">Restituer le dépôt</button>}
                {b.depositStatus === "recu" && <button onClick={() => annulerDepot(b)} className="text-xs underline" style={{ color: "#A6432F" }} data-testid="im-depot-annuler">Annuler le dépôt</button>}
              </div>)}
              {b.depositStatus === "recu" && b.status !== "termine" && <div className="text-xs mt-1" style={{ color: "#7A7460" }}>Le dépôt pourra être restitué quand le bail sera terminé.</div>}
            </div>)}
          {canEdit && b.status !== "termine" && <button onClick={() => terminerBail(b)} className="text-xs underline" style={{ color: "#A6432F" }} data-testid="im-bail-terminer">Mettre fin à ce bail (le bien redevient libre)</button>}
        </div>)}
      </div>
    );
  };

  // ───────── Loyers : émission, encaissement ─────────
  const emettre = (bail, periode, rentAmt, chargesAmt, silencieux) => {
    if (!canFront || !bail) return false;
    if (loyers.some((r) => r.leaseId === bail.id && r.period === periode && r.status !== "annulee")) { if (!silencieux) showToast("Un loyer de " + imPeriode(periode) + " existe déjà pour ce bail."); return false; }
    const rent = imR2(rentAmt), charges = imR2(chargesAmt);
    const ht = imR2(rent + charges);
    if (!(ht > 0)) { if (!silencieux) showToast("Le montant du loyer est à zéro : rien à émettre."); return false; }
    const tca = tcaOn ? imR2(ht * tcaRate / 100) : 0;
    const total = imR2(ht + tca);
    const number = numero("LY", loyers, today);
    imAjouterComptes(accounts, setAccounts, ["411", "706", ...(charges > 0 ? ["708"] : []), ...(tca > 0 ? ["445"] : [])]);
    const e = ecrire(today, "Loyer " + number + " (" + imPeriode(periode) + ") — " + nomLoc(bail.tenantId) + " / " + nomBien(bail.propertyId), [{ account: "411", debit: total, credit: 0 }, { account: "706", debit: 0, credit: rent }, { account: "708", debit: 0, credit: charges }, { account: "445", debit: 0, credit: tca }], number);
    const id = imId();
    const r = { type: "rent", id, number, date: today, period: periode, dueDate: echeanceDe(periode, bail.dueDay), leaseId: bail.id, propertyId: bail.propertyId, tenantId: bail.tenantId, rent, charges, ht, tcaRate: tca > 0 ? tcaRate : 0, tca, total, entryId: e.id, status: "emise", payments: [], createdAt: new Date().toISOString(), by: currentUserEmail || "" };
    ajouter(r);
    return { id, number: r.number };
  };
  const [fe, setFe] = useBrouillon("immo-loyer", { leaseId: "", period: todayStr().slice(0, 7), rent: "", charges: "" });
  const [genP, setGenP] = useState(todayStr().slice(0, 7));
  const [pp, setPp] = useBrouillon("immo-paiement", { amount: "", mode: "caisse", date: todayStr() });
  const [lqq, setLqq] = useState(""); const [let_, setLet] = useState(""); const [ld1, setLd1] = useState(""); const [ld2, setLd2] = useState("");
  const aGenerer = (periode) => bauxActifs.filter((b) => b.start.slice(0, 7) <= periode && (!b.end || b.end.slice(0, 7) >= periode) && !loyers.some((r) => r.leaseId === b.id && r.period === periode && r.status !== "annulee"));
  const genererMois = () => {
    if (!canFront) return;
    if (!genP || genP > moisCourant) { showToast("Vous ne pouvez pas émettre les loyers d'un mois à venir."); return; }
    const liste = aGenerer(genP);
    if (!liste.length) { showToast("Tous les loyers de " + imPeriode(genP) + " sont déjà émis."); return; }
    if (!verifDate(today, "émettre ces loyers")) return;
    // émission groupée : numéros attribués en séquence
    const base = loyers.filter((r) => String(r.number || "").startsWith("LY-" + today.slice(0, 4) + "-")).reduce((m, r) => Math.max(m, Number(String(r.number).split("-")[2]) || 0), 0);
    const nouveaux = []; const ecritures = []; const codes = ["411", "706"];
    liste.forEach((bail, i) => {
      const rent = imR2(bail.rent), charges = imR2(bail.charges), ht = imR2(rent + charges);
      if (!(ht > 0)) return;
      const tca = tcaOn ? imR2(ht * tcaRate / 100) : 0;
      const total = imR2(ht + tca);
      const number = "LY-" + today.slice(0, 4) + "-" + String(base + nouveaux.length + 1).padStart(4, "0");
      if (charges > 0) codes.push("708"); if (tca > 0) codes.push("445");
      const eid = uid();
      ecritures.push({ id: eid, date: today, createdAt: new Date().toISOString(), label: "Loyer " + number + " (" + imPeriode(genP) + ") — " + nomLoc(bail.tenantId) + " / " + nomBien(bail.propertyId), lines: [{ account: "411", debit: total, credit: 0 }, { account: "706", debit: 0, credit: rent }, { account: "708", debit: 0, credit: charges }, { account: "445", debit: 0, credit: tca }].filter((l) => l.debit > 0 || l.credit > 0), kind: "immo", dossierId: number });
      nouveaux.push({ type: "rent", id: imId(), number, date: today, period: genP, dueDate: echeanceDe(genP, bail.dueDay), leaseId: bail.id, propertyId: bail.propertyId, tenantId: bail.tenantId, rent, charges, ht, tcaRate: tca > 0 ? tcaRate : 0, tca, total, entryId: eid, status: "emise", payments: [], createdAt: new Date().toISOString(), by: currentUserEmail || "" });
    });
    if (!nouveaux.length) { showToast("Les loyers à émettre sont à zéro."); return; }
    imAjouterComptes(accounts, setAccounts, codes);
    setEntries((prev) => [...prev, ...ecritures]);
    setImmo((prev) => [...(prev || []), ...nouveaux]);
    showToast(nouveaux.length + " loyer(s) de " + imPeriode(genP) + " émis."); logAudit("Immobilier", "Loyers du mois émis", imPeriode(genP) + " — " + nouveaux.length);
  };
  const emettreUn = () => {
    if (!canFront) return;
    const bail = baux.find((b) => b.id === fe.leaseId);
    if (!bail) { showToast("Choisissez le bail."); return; }
    if (!fe.period || fe.period > moisCourant) { showToast("Vous ne pouvez pas émettre le loyer d'un mois à venir."); return; }
    if (fe.period < bail.start.slice(0, 7)) { showToast("Ce mois est avant le début du bail."); return; }
    if (!verifDate(today, "émettre ce loyer")) return;
    const rentAmt = fe.rent === "" ? bail.rent : Number(fe.rent), chAmt = fe.charges === "" ? bail.charges : Number(fe.charges);
    if (!(rentAmt >= 0) || !(chAmt >= 0)) { showToast("Montants invalides."); return; }
    const res = emettre(bail, fe.period, rentAmt, chAmt);
    if (!res) return;
    setFe({ ...fe, rent: "", charges: "" }); setSelLoyer(res.id);
    showToast("Loyer " + res.number + " émis."); logAudit("Immobilier", "Loyer émis", res.number);
  };
  const encaisser = (r) => {
    if (!canFront || r.status === "annulee") return;
    const amount = imR2(pp.amount);
    const s = imSolde(r);
    if (!(amount > 0)) { showToast("Indiquez un montant supérieur à zéro."); return; }
    if (amount > s.reste + 0.004) { showToast("Le montant dépasse le reste à payer (" + fmt(s.reste) + ")."); return; }
    if (!verifDate(pp.date, "enregistrer cet encaissement")) return;
    const cpt = compteMode(pp.mode === "banque" ? "banque" : "caisse");
    imAjouterComptes(accounts, setAccounts, [cpt, "411"]);
    const e = ecrire(pp.date, "Encaissement loyer " + r.number + " — " + nomLoc(r.tenantId), [{ account: cpt, debit: amount, credit: 0 }, { account: "411", debit: 0, credit: amount }], r.id);
    maj(r.id, (x) => ({ ...x, payments: [...(x.payments || []), { id: imId(), date: pp.date, amount, mode: pp.mode, entryId: e.id, status: "valide", by: currentUserEmail || "" }] }));
    setPp({ ...pp, amount: "" }); showToast("Encaissement de " + fmt(amount) + " enregistré."); logAudit("Immobilier", "Loyer encaissé", r.number + " — " + fmt(amount));
  };
  const annulerPaiement = (r, p) => {
    if (!canEdit || p.status === "annulé") return;
    if (!verifDate(today, "annuler cet encaissement")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler cet encaissement ? Une écriture inverse sera passée.")) return;
    const e = contre(p.entryId, "Annulation encaissement " + r.number + " (écriture inverse)", today, r.id);
    maj(r.id, (x) => ({ ...x, payments: x.payments.map((y) => (y.id === p.id ? { ...y, status: "annulé", reversalEntryId: e ? e.id : "" } : y)) }));
    showToast("Encaissement annulé.");
  };
  const annulerLoyer = (r) => {
    if (!canEdit || r.status === "annulee") return;
    if ((r.payments || []).some((p) => p.status !== "annulé")) { showToast("Annulez d'abord les encaissements de ce loyer."); return; }
    if (!verifDate(today, "annuler ce loyer")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler le loyer " + r.number + " ? Une écriture inverse sera passée.")) return;
    const e = contre(r.entryId, "Annulation loyer " + r.number + " (écriture inverse)", today, r.id);
    maj(r.id, (x) => ({ ...x, status: "annulee", reversalEntryId: e ? e.id : "" }));
    showToast("Loyer annulé : vous pouvez le réémettre.");
  };
  const Loyers = () => {
    const r = loyers.find((x) => x.id === selLoyer);
    const lF = loyers.filter((x) => (!let_ || etatLoyer(x) === let_) && (!ld1 || x.dueDate >= ld1) && (!ld2 || x.dueDate <= ld2) && (!lqq.trim() || [x.number, nomLoc(x.tenantId), nomBien(x.propertyId), imPeriode(x.period)].join(" ").toLowerCase().includes(lqq.trim().toLowerCase()))).sort((a, b) => String(b.period).localeCompare(String(a.period)) || String(b.number).localeCompare(String(a.number)));
    const lFA = lF.filter((x) => x.status !== "annulee");
    const nbGen = aGenerer(genP).length;
    const bailSel = baux.find((b) => b.id === fe.leaseId);
    return (
      <div>
        {canFront && (<div className="ec-card p-4 mb-5" data-testid="im-emettre-bloc"><div className="display text-base mb-2" style={{ color: "#152238" }}>Émettre les loyers</div>
          <div className="flex flex-wrap items-end gap-3">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Mois</label><input type="month" value={genP} max={moisCourant} onChange={(e) => setGenP(e.target.value)} data-testid="im-gen-mois" className={ecInput} style={ecBorder} /></div>
            <div className="text-sm" style={{ color: "#152238" }}><b data-testid="im-gen-nb">{nbGen}</b> loyer(s) à émettre pour {imPeriode(genP)} (baux en cours sans loyer pour ce mois)</div>
            <button onClick={genererMois} disabled={!nbGen} className="px-3 py-2 rounded text-sm" style={{ ...ecBtnGold, opacity: nbGen ? 1 : 0.5 }} data-testid="im-gen-emettre">Émettre les loyers du mois</button>
          </div>
          <div className="text-xs mt-3 mb-1" style={{ color: "#7A7460" }}>Cas particulier (premier mois au prorata, loyer d'un mois précédent, montant différent) : émettez un loyer isolé.</div>
          <div className="grid md:grid-cols-5 gap-2 items-end">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Bail</label><select value={fe.leaseId} onChange={(e) => setFe({ ...fe, leaseId: e.target.value, rent: "", charges: "" })} data-testid="im-un-bail" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{bauxActifs.map((b) => <option key={b.id} value={b.id}>{b.number} — {nomBien(b.propertyId)} / {nomLoc(b.tenantId)}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Mois</label><input type="month" value={fe.period} max={moisCourant} onChange={(e) => setFe({ ...fe, period: e.target.value })} data-testid="im-un-mois" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Loyer {bailSel ? "(bail : " + fmt(bailSel.rent) + ")" : ""}</label><input type="number" min="0" value={fe.rent} placeholder={bailSel ? String(bailSel.rent) : ""} onChange={(e) => setFe({ ...fe, rent: e.target.value })} data-testid="im-un-loyer" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Charges {bailSel ? "(bail : " + fmt(bailSel.charges) + ")" : ""}</label><input type="number" min="0" value={fe.charges} placeholder={bailSel ? String(bailSel.charges) : ""} onChange={(e) => setFe({ ...fe, charges: e.target.value })} data-testid="im-un-charges" className={ecInput + " tabular"} style={ecBorder} /></div>
          </div>
          <button onClick={emettreUn} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtn} data-testid="im-un-emettre">Émettre ce loyer</button>
          {canEdit && <label className="text-xs flex items-center gap-2 mt-3"><input type="checkbox" checked={tcaOn} onChange={(e) => { const on = e.target.checked; setImmo((prev) => [...(prev || []).filter((x) => !(x.type === "config")), { type: "config", id: "config", tcaOn: on }]); showToast(on ? "Taxe activée sur les prochains loyers (" + (Number(settings.taxRate) || 0) + " %, taux des Réglages)." : "Taxe désactivée."); }} data-testid="im-tca" />Appliquer la taxe (TCA) sur les loyers (taux des Réglages : {Number(settings.taxRate) || 0} %). À confirmer avec votre expert-comptable : la location de locaux nus d'habitation n'est en général pas concernée.</label>}
        </div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <div className="flex-1 min-w-[150px]"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (n°, locataire, bien, mois)</label><input value={lqq} onChange={(e) => setLqq(e.target.value)} data-testid="im-loy-recherche" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>État</label><select value={let_} onChange={(e) => setLet(e.target.value)} data-testid="im-loy-filtre-etat" className={ecInput} style={ecBorder}><option value="">Tous</option><option value="encaisser">À encaisser</option><option value="retard">En retard</option><option value="soldee">Soldé</option><option value="annulee">Annulé</option></select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Échéance du</label><input type="date" value={ld1} onChange={(e) => setLd1(e.target.value)} className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>au</label><input type="date" value={ld2} onChange={(e) => setLd2(e.target.value)} className={ecInput} style={ecBorder} /></div>
        </div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>Mois</th><th>Bien</th><th>Locataire</th><th>Échéance</th><th className="text-right">Total</th><th className="text-right">Reste à payer</th><th>État</th><th></th></tr></thead>
          <tbody>{lF.map((x) => { const s = imSolde(x); const e = etatLoyer(x); return (<tr key={x.id} data-testid="im-loy-ligne" style={{ background: x.id === selLoyer ? "#E6F1EE" : undefined, opacity: x.status === "annulee" ? 0.55 : 1 }}><td className="py-1.5 tabular text-xs">{x.number}</td><td>{imPeriode(x.period)}</td><td>{nomBien(x.propertyId)}</td><td>{nomLoc(x.tenantId)}</td><td>{ecDateFr(x.dueDate)}</td><td className="text-right tabular">{fmt(x.total)}</td><td className="text-right tabular">{x.status === "annulee" ? "—" : fmt(s.reste)}</td>
            <td>{e === "annulee" ? ecPastille("Annulé", "neutre") : e === "soldee" ? ecPastille("Soldé", "ok") : e === "retard" ? ecPastille("En retard de " + imJours(x.dueDate, today) + " j", "alerte") : ecPastille("À encaisser", "attente")}</td>
            <td className="text-right whitespace-nowrap"><button onClick={() => setSelLoyer(x.id === selLoyer ? "" : x.id)} className="text-xs underline mr-2" data-testid="im-loy-ouvrir">{x.id === selLoyer ? "Fermer" : "Ouvrir"}</button>{x.status !== "annulee" && <button onClick={() => setImprimer({ kind: e === "soldee" ? "quittance" : "avis", id: x.id })} className="text-xs underline" data-testid="im-loy-imprimer">{e === "soldee" ? "Quittance" : "Avis"}</button>}</td></tr>); })}</tbody>
          {lF.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="im-loy-total-ligne"><td colSpan={5}>Total ({lFA.length} loyer{lFA.length > 1 ? "s" : ""}, hors annulés)</td><td className="text-right tabular" data-testid="im-loy-tot-total">{fmt(imR2(lFA.reduce((s, x) => s + x.total, 0)))}</td><td className="text-right tabular" data-testid="im-loy-tot-reste">{fmt(imR2(lFA.reduce((s, x) => s + imSolde(x).reste, 0)))}</td><td colSpan={2}></td></tr></tfoot>}</table></div>
        {lF.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{loyers.length === 0 ? "Aucun loyer émis." : "Aucun loyer ne correspond à ces filtres."}</div>}
        {r && (<div className="ec-card p-4 mt-5" data-testid="im-loy-detail">
          <div className="display text-lg mb-2" style={{ color: "#152238" }}>{r.number} — {nomLoc(r.tenantId)} · {imPeriode(r.period)}</div>
          <div className="text-sm mb-3" style={{ color: "#5B563F" }}>Loyer {fmt(r.rent)}{r.charges > 0 ? " + charges " + fmt(r.charges) : ""}{r.tca > 0 ? " + taxe " + fmt(r.tca) : ""} = {fmt(r.total)} · payé {fmt(imSolde(r).paye)} · reste <b data-testid="im-loy-reste">{fmt(imSolde(r).reste)}</b></div>
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Mode</th><th className="text-right">Montant</th><th>État</th><th></th></tr></thead>
            <tbody>{(r.payments || []).map((p) => (<tr key={p.id} data-testid="im-pay-ligne" style={{ opacity: p.status === "annulé" ? 0.55 : 1 }}><td className="py-1.5">{ecDateFr(p.date)}</td><td>{p.mode === "banque" ? "Banque" : "Espèces"}</td><td className="text-right tabular">{fmt(p.amount)}</td><td>{p.status === "annulé" ? ecPastille("Annulé", "neutre") : ecPastille("Valide", "ok")}</td><td className="text-right">{canEdit && p.status !== "annulé" && <button onClick={() => annulerPaiement(r, p)} className="text-xs" style={{ color: "#A6432F" }} data-testid="im-pay-annuler">Annuler</button>}</td></tr>))}</tbody></table></div>
          {canFront && r.status !== "annulee" && (<div className="grid md:grid-cols-4 gap-2 mt-3 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant reçu</label><input type="number" min="0" value={pp.amount} onChange={(e) => setPp({ ...pp, amount: e.target.value })} data-testid="im-pay-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Mode</label><select value={pp.mode} onChange={(e) => setPp({ ...pp, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Espèces</option><option value="banque">Banque</option></select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" value={pp.date} max={todayStr()} onChange={(e) => setPp({ ...pp, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <button onClick={() => encaisser(r)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="im-pay-valider">Enregistrer l'encaissement</button>
          </div>)}
          {canEdit && r.status !== "annulee" && <button onClick={() => annulerLoyer(r)} className="mt-3 text-xs underline" style={{ color: "#A6432F" }} data-testid="im-loy-annuler">Annuler ce loyer</button>}
        </div>)}
      </div>
    );
  };

  // ───────── Dépenses des biens ─────────
  const [fd, setFd] = useBrouillon("immo-depense", { propertyId: "", kind: "entretien", date: todayStr(), label: "", amount: "", mode: "caisse" });
  const [dq, setDq] = useState(""); const [dk, setDk] = useState(""); const [dv, setDv] = useState("");
  const enregistrerDepense = () => {
    if (!canEdit) return;
    const amount = imR2(fd.amount);
    if (!fd.propertyId) { showToast("Choisissez le bien."); return; }
    if (!(amount > 0)) { showToast("Indiquez le montant (en gourdes)."); return; }
    if (!verifDate(fd.date, "enregistrer cette dépense")) return;
    const def = IM_DEPENSES.find((x) => x[0] === fd.kind) || IM_DEPENSES[0];
    const compte = def[2], cpt = compteMode(fd.mode);
    const label = fd.label.trim() || def[1];
    imAjouterComptes(accounts, setAccounts, [compte, cpt]);
    const e = ecrire(fd.date, "Bien " + nomBien(fd.propertyId) + " — " + label, [{ account: compte, debit: amount, credit: 0 }, { account: cpt, debit: 0, credit: amount }], fd.propertyId);
    ajouter({ type: "expense", id: imId(), date: fd.date, propertyId: fd.propertyId, kind: fd.kind, label, amount, mode: fd.mode, entryId: e.id, status: "valide", by: currentUserEmail || "" });
    setFd({ ...fd, label: "", amount: "" });
    showToast("Dépense enregistrée : " + fmt(amount) + "."); logAudit("Immobilier", "Dépense d'un bien", nomBien(fd.propertyId) + " — " + label + " — " + fmt(amount));
  };
  const annulerDepense = (x) => {
    if (!canEdit || x.status === "annulé") return;
    if (!verifDate(today, "annuler cette dépense")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler cette dépense ? Une écriture inverse sera passée.")) return;
    const e = contre(x.entryId, "Annulation — " + nomBien(x.propertyId) + " — " + x.label + " (écriture inverse)", today, x.propertyId);
    maj(x.id, (r) => ({ ...r, status: "annulé", reversalEntryId: e ? e.id : "" }));
    showToast("Dépense annulée.");
  };
  const Depenses = () => {
    const dF = depenses.filter((x) => (!dk || x.kind === dk) && (!dv || x.propertyId === dv) && (!dq.trim() || [x.label, nomBien(x.propertyId)].join(" ").toLowerCase().includes(dq.trim().toLowerCase()))).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const dFA = dF.filter((x) => x.status !== "annulé");
    return (
      <div>
        {canEdit && (<div className="ec-card p-4 mb-5" data-testid="im-nouvelle-depense"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvelle dépense</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Bien</label><select value={fd.propertyId} onChange={(e) => setFd({ ...fd, propertyId: e.target.value })} data-testid="im-dep-bien" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{biens.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Nature</label><select value={fd.kind} onChange={(e) => setFd({ ...fd, kind: e.target.value })} data-testid="im-dep-nature" className={ecInput} style={ecBorder}>{IM_DEPENSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" value={fd.date} max={todayStr()} onChange={(e) => setFd({ ...fd, date: e.target.value })} data-testid="im-dep-date" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Payé par</label><select value={fd.mode} onChange={(e) => setFd({ ...fd, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Caisse</option><option value="banque">Banque</option><option value="apayer">À payer (dette)</option></select></div>
          </div>
          <div className="grid md:grid-cols-4 gap-2 items-end mt-2">
            <div className="md:col-span-3"><label className="text-xs" style={{ color: "#8A8370" }}>Détail (facultatif)</label><input list="im-dl-detail" value={fd.label} onChange={(e) => setFd({ ...fd, label: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant (gourdes)</label><input type="number" min="0" value={fd.amount} onChange={(e) => setFd({ ...fd, amount: e.target.value })} data-testid="im-dep-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
          </div>
          <button onClick={enregistrerDepense} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="im-dep-valider">Enregistrer la dépense</button></div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <div className="flex-1 min-w-[150px]"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (détail, bien)</label><input value={dq} onChange={(e) => setDq(e.target.value)} className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Nature</label><select value={dk} onChange={(e) => setDk(e.target.value)} data-testid="im-dep-filtre-nature" className={ecInput} style={ecBorder}><option value="">Toutes</option>{IM_DEPENSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Bien</label><select value={dv} onChange={(e) => setDv(e.target.value)} className={ecInput} style={ecBorder}><option value="">Tous</option>{biens.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
        </div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Bien</th><th>Nature</th><th>Détail</th><th className="text-right">Montant</th><th>État</th><th></th></tr></thead>
          <tbody>{dF.map((x) => (<tr key={x.id} data-testid="im-dep-ligne" style={{ opacity: x.status === "annulé" ? 0.55 : 1 }}><td className="py-1.5">{ecDateFr(x.date)}</td><td>{nomBien(x.propertyId)}</td><td className="text-xs">{(IM_DEPENSES.find((k) => k[0] === x.kind) || [0, x.kind])[1]}</td><td className="text-xs">{x.label}</td><td className="text-right tabular">{fmt(x.amount)}</td><td>{x.status === "annulé" ? ecPastille("Annulée", "neutre") : ecPastille("Valide", "ok")}</td><td className="text-right">{canEdit && x.status !== "annulé" && <button onClick={() => annulerDepense(x)} className="text-xs" style={{ color: "#A6432F" }} data-testid="im-dep-annuler">Annuler</button>}</td></tr>))}</tbody>
          {dF.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="im-dep-total-ligne"><td colSpan={4}>Total ({dFA.length}, hors annulées)</td><td className="text-right tabular" data-testid="im-dep-tot">{fmt(imR2(dFA.reduce((s, x) => s + x.amount, 0)))}</td><td colSpan={2}></td></tr></tfoot>}</table></div>
        {dF.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{depenses.length === 0 ? "Aucune dépense." : "Aucune dépense ne correspond à ces filtres."}</div>}
      </div>
    );
  };

  // ───────── Documents imprimables ─────────
  const entete = (titre) => (
    <div style={{ textAlign: "center", marginBottom: 12 }}>
      {settings.companyLogo && <img src={settings.companyLogo} alt="" style={{ width: 60, height: 60, objectFit: "contain", margin: "0 auto 6px", display: "block" }} />}
      <div style={{ fontWeight: 700, fontSize: 20 }}>{settings.companyName || "Gestion locative"}</div>
      {settings.companyAddress && <div style={{ fontSize: 12 }}>{settings.companyAddress}</div>}
      {settings.companyPhone && <div style={{ fontSize: 12 }}>{settings.companyPhone}</div>}
      {settings.companyNIF && <div style={{ fontSize: 12 }}>NIF : {settings.companyNIF}</div>}
      <div style={{ fontWeight: 700, fontSize: 18, marginTop: 10 }}>{titre}</div>
    </div>
  );
  const LoyerSheet = ({ r, mode }) => {
    const s = imSolde(r);
    const bien = biens.find((x) => x.id === r.propertyId) || {};
    const loc = locataires.find((x) => x.id === r.tenantId) || {};
    const quittance = mode === "quittance" && s.reste <= 0.004;
    const titre = quittance ? "QUITTANCE DE LOYER" : mode === "quittance" ? "REÇU DE PAIEMENT PARTIEL" : "AVIS D'ÉCHÉANCE";
    const ligne = (a, b, bold) => <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0", fontWeight: bold ? 700 : 400, fontSize: bold ? (tk ? 13 : 16) : undefined }}><span>{a}</span><span className="tabular">{b}</span></div>;
    return (
      <div style={{ color: "#152238", background: "#fff", fontFamily: "'Inter', sans-serif", fontSize: tk ? 11 : 13, width: "100%", maxWidth: tk ? 300 : 794, margin: "0 auto", padding: tk ? "12px 10px" : "32px 36px", boxSizing: "border-box" }} data-testid="im-loyer-feuille">
        {entete(titre)}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><span>N° <b>{r.number}</b></span><span>Émis le {ecDateFr(r.date)}</span></div>
        <div style={{ marginBottom: 4 }}>Locataire : <b>{loc.name || "—"}</b></div>
        <div style={{ marginBottom: 4 }}>Bien loué : <b>{bien.name || "—"}</b>{bien.address ? " — " + bien.address : ""}</div>
        <div style={{ marginBottom: 10 }}>Période : <b>{imPeriode(r.period)}</b>{!quittance && mode !== "quittance" ? <> · à payer avant le <b>{ecDateFr(r.dueDate)}</b></> : null}</div>
        <div style={{ borderTop: "1px dashed #152238", borderBottom: "1px dashed #152238", padding: "8px 0", marginBottom: 8 }}>
          {ligne("Loyer", fmt(r.rent))}
          {r.charges > 0 && ligne("Charges", fmt(r.charges))}
          {r.tca > 0 && ligne("Taxe (" + r.tcaRate + " %)", fmt(r.tca))}
        </div>
        {ligne("Total du mois", fmt(r.total), true)}
        {(mode === "quittance" || s.paye > 0) && (r.payments || []).filter((p) => p.status !== "annulé").map((p) => <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: tk ? 10 : 12 }}><span>Reçu le {ecDateFr(p.date)} ({p.mode === "banque" ? "banque" : "espèces"})</span><span className="tabular">{fmt(p.amount)}</span></div>)}
        {s.paye > 0 && <div style={{ marginTop: 4 }}>Déjà payé : <span className="tabular">{fmt(s.paye)}</span> — reste : <span className="tabular">{fmt(s.reste)}</span></div>}
        {quittance && <div style={{ marginTop: 12, fontSize: tk ? 10 : 12 }}>Je soussigné(e), pour le compte de {settings.companyName || "le bailleur"}, reconnais avoir reçu de {loc.name || "—"} la somme de {fmt(s.paye)} au titre du loyer et des charges de {imPeriode(r.period)} pour le bien désigné ci-dessus, dont quittance, sous réserve de tous mes droits.</div>}
        {!quittance && mode !== "quittance" && <div style={{ marginTop: 12, fontSize: tk ? 10 : 12 }}>Cet avis n'est pas une quittance : la quittance vous sera remise après paiement complet.</div>}
        <div style={{ marginTop: 28, textAlign: "right", fontSize: 12 }}>Le bailleur ou son représentant<div style={{ borderTop: "1px solid #152238", display: "inline-block", width: 160, marginLeft: 12 }}></div></div>
      </div>
    );
  };

  // ───────── Tableau de bord ─────────
  const Apercu = () => {
    const lA = loyers.filter((x) => x.status !== "annulee");
    const emisMois = imR2(lA.filter((x) => x.period === moisCourant).reduce((s, x) => s + x.total, 0));
    const encMois = imR2(lA.flatMap((x) => x.payments || []).filter((p) => p.status !== "annulé" && String(p.date).startsWith(moisCourant)).reduce((s, p) => s + p.amount, 0));
    const depMois = imR2(depenses.filter((x) => x.status !== "annulé" && String(x.date).startsWith(moisCourant)).reduce((s, x) => s + x.amount, 0));
    const dus = imR2(lA.reduce((s, x) => s + imSolde(x).reste, 0));
    const retards = lA.filter((x) => imSolde(x).reste > 0.004 && x.dueDate < today);
    const enGestion = biens.filter((x) => x.active !== false);
    const loues = enGestion.filter((x) => bailDuBien(x.id));
    const taux = enGestion.length ? Math.round(loues.length * 100 / enGestion.length) : 0;
    const manque = aGenerer(moisCourant);
    const afaire = [];
    retards.forEach((x) => afaire.push({ tab: "loyers", sel: x.id, nom: nomLoc(x.tenantId), txt: "Loyer " + imPeriode(x.period) + " (" + nomBien(x.propertyId) + ") en retard de " + imJours(x.dueDate, today) + " jours : reste " + fmt(imSolde(x).reste) }));
    if (manque.length) afaire.push({ tab: "loyers", nom: imPeriode(moisCourant), txt: manque.length + " loyer(s) du mois pas encore émis" });
    bauxActifs.forEach((b) => { if (b.end && imJours(today, b.end) <= 60) afaire.push({ tab: "baux", sel: b.id, nom: nomLoc(b.tenantId), txt: "Bail " + b.number + " (" + nomBien(b.propertyId) + ") " + (b.end < today ? "arrivé à échéance le " : "se termine le ") + ecDateFr(b.end) }); if (b.deposit > 0 && !b.depositStatus) afaire.push({ tab: "baux", sel: b.id, nom: nomLoc(b.tenantId), txt: "Dépôt de garantie de " + fmt(b.deposit) + " pas encore encaissé (" + b.number + ")" }); });
    baux.filter((b) => b.status === "termine" && b.depositStatus === "recu").forEach((b) => afaire.push({ tab: "baux", sel: b.id, nom: nomLoc(b.tenantId), txt: "Bail terminé : dépôt de garantie de " + fmt(b.deposit) + " à restituer" }));
    const libres = enGestion.filter((x) => !bailDuBien(x.id));
    const etapes = [
      ["Biens", "Ajoutez vos biens (appartement, local commercial, maison…) avec leur adresse.", "biens", biens.length > 0],
      ["Locataires", "Enregistrez vos locataires (nom, téléphone).", "locataires", locataires.length > 0],
      ["Premier bail", "Associez un bien libre et un locataire : loyer, charges, jour d'échéance.", "baux", baux.length > 0],
      ["Dépôt de garantie", "Si un dépôt est prévu, enregistrez-le à la réception (étape facultative).", "baux", baux.some((b) => b.depositStatus)],
      ["Loyers du mois", "Dans Loyers, émettez en un clic les loyers de tous les baux en cours.", "loyers", loyers.length > 0],
      ["Premier encaissement", "Ouvrez un loyer et enregistrez le paiement : la comptabilité se fait automatiquement.", "loyers", lA.some((x) => (x.payments || []).some((p) => p.status !== "annulé"))],
      ["Première quittance", "Quand un loyer est entièrement payé, imprimez la quittance (A4 ou ticket).", "loyers", lA.some((x) => imSolde(x).reste <= 0.004)],
    ];
    const toutFait = etapes.every((e) => e[3]);
    const kpis = [["Biens loués / en gestion", loues.length + " / " + enGestion.length, "im-kpi-biens"], ["Taux d'occupation", taux + " %", "im-kpi-taux"], ["Loyers émis ce mois", fmt(emisMois), "im-kpi-emis"], ["Encaissé ce mois", fmt(encMois), "im-kpi-encaisse"], ["Loyers à recevoir", fmt(dus), "im-kpi-dus"], ["Loyers en retard", String(retards.length), "im-kpi-retards"], ["Dépenses ce mois", fmt(depMois), "im-kpi-depenses"], ["Choses à faire", String(afaire.length), "im-kpi-afaire"]];
    return (
      <div>
        {!toutFait && (<div className="ec-card p-4 mb-5" data-testid="im-guide">
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Pour démarrer, en 7 étapes</div>
          <ol className="text-sm" style={{ color: "#152238", listStyle: "none", paddingLeft: 0 }}>{etapes.map(([t, d, tb, fait], i) => (<li key={i} data-testid="im-etape" className="mb-1.5 flex flex-wrap gap-2 items-baseline"><span style={{ color: fait ? "#0F6B5C" : "#8A8370", fontWeight: 700 }}>{fait ? "✓" : (i + 1) + "."}</span><span><b>{t}</b> — <span style={{ color: "#5B563F" }}>{d}</span></span>{!fait && !(isVendeur && (tb === "biens" || tb === "baux")) && <button className="text-xs underline" data-testid="im-etape-ouvrir" onClick={() => setTab(tb)}>Ouvrir</button>}</li>))}</ol>
        </div>)}
        {biens.length + baux.length === 0 && <div className="p-4 rounded text-sm mb-4" style={{ background: "#FFF6E0", color: "#152238" }} data-testid="im-vide">Pour commencer : ajoutez vos <b>biens</b> et vos <b>locataires</b>, puis créez un <b>bail</b> et émettez le premier <b>loyer</b>.</div>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {kpis.map(([l, v, t]) => (<div key={t} className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>{l}</div><div className="display text-lg tabular" data-testid={t} style={{ color: "#152238" }}>{v}</div></div>))}
        </div>
        <div className="display text-base mb-2" style={{ color: "#152238" }}>À faire</div>
        {afaire.length === 0 ? <div className="text-sm mb-5" style={{ color: "#8A8370" }}>Rien en attente.</div> : (
          <div className="ec-wrap mb-5"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Concerné</th><th>À faire</th><th></th></tr></thead>
            <tbody>{afaire.slice(0, 15).map((x, i) => (<tr key={i} data-testid="im-afaire-ligne"><td className="py-1.5">{x.nom}</td><td>{x.txt}</td><td className="text-right"><button className="text-xs underline" data-testid="im-afaire-ouvrir" onClick={() => { if (isVendeur && x.tab === "baux") return; setTab(x.tab); if (x.sel && x.tab === "baux") setSelBail(x.sel); if (x.sel && x.tab === "loyers") setSelLoyer(x.sel); }}>Ouvrir</button></td></tr>))}</tbody></table></div>
        )}
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Biens libres</div>
        {libres.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucun bien libre.</div> : (
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Bien</th><th>Type</th><th>Adresse</th></tr></thead>
            <tbody>{libres.map((x) => (<tr key={x.id} data-testid="im-libre-ligne"><td className="py-1.5">{x.name}</td><td>{x.kind || "—"}</td><td className="text-xs">{x.address || "—"}</td></tr>))}</tbody></table></div>
        )}
      </div>
    );
  };

  // ───────── Rapports ─────────
  const [rd, setRd] = useState(""); const [rf, setRf] = useState("");
  const Rapports = () => {
    const dansP = (d) => (!rd || d >= rd) && (!rf || d <= rf);
    const lP = loyers.filter((x) => x.status !== "annulee" && dansP(x.date));
    const depP = depenses.filter((x) => x.status !== "annulé" && dansP(x.date));
    const S = (arr, f) => imR2(arr.reduce((t, x) => t + f(x), 0));
    const tf = { fontWeight: 600, borderTop: "2px solid #152238" };
    const parBien = biens.map((b) => { const mine = lP.filter((x) => x.propertyId === b.id); const fact = S(mine, (x) => x.ht); const enc = S(mine, (x) => imSolde(x).paye); const dep = S(depP.filter((d) => d.propertyId === b.id), (d) => d.amount); return { b, fact, enc, dep, res: imR2(fact - dep) }; });
    const impayes = locataires.map((c) => { const mine = lP.filter((x) => x.tenantId === c.id && imSolde(x).reste > 0.004); const ret = (x) => imJours(x.dueDate, today); return { c, n: mine.length, b0: S(mine.filter((x) => ret(x) <= 0), (x) => imSolde(x).reste), b1: S(mine.filter((x) => ret(x) > 0 && ret(x) <= 30), (x) => imSolde(x).reste), b2: S(mine.filter((x) => ret(x) > 30 && ret(x) <= 60), (x) => imSolde(x).reste), b3: S(mine.filter((x) => ret(x) > 60), (x) => imSolde(x).reste), reste: S(mine, (x) => imSolde(x).reste) }; }).filter((x) => x.reste > 0.004);
    const parNature = IM_DEPENSES.map(([k, l]) => ({ l, n: depP.filter((x) => x.kind === k).length, m: S(depP.filter((x) => x.kind === k), (x) => x.amount) })).filter((x) => x.n > 0);
    const exporterBien = () => ecTelecharger("rentabilite-biens-" + today + ".csv", [["Bien", "Loyers facturés HT", "Encaissé", "Dépenses", "Résultat"], ...parBien.map((x) => [x.b.name, x.fact, x.enc, x.dep, x.res]), ["Total", S(parBien, (x) => x.fact), S(parBien, (x) => x.enc), S(parBien, (x) => x.dep), S(parBien, (x) => x.res)]]);
    const exporterImp = () => ecTelecharger("loyers-impayes-" + today + ".csv", [["Locataire", "Loyers impayés", "Pas encore échu", "1 à 30 j", "31 à 60 j", "Plus de 60 j", "Reste à payer"], ...impayes.map((x) => [x.c.name, x.n, x.b0, x.b1, x.b2, x.b3, x.reste]), ["Total", S(impayes, (x) => x.n), S(impayes, (x) => x.b0), S(impayes, (x) => x.b1), S(impayes, (x) => x.b2), S(impayes, (x) => x.b3), S(impayes, (x) => x.reste)]]);
    return (
      <div>
        <div className="flex flex-wrap gap-2 items-end mb-4">
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Du</label><input type="date" value={rd} onChange={(e) => setRd(e.target.value)} data-testid="im-rapport-du" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Au</label><input type="date" value={rf} onChange={(e) => setRf(e.target.value)} data-testid="im-rapport-au" className={ecInput} style={ecBorder} /></div>
          {(rd || rf) && <button className="text-xs underline" onClick={() => { setRd(""); setRf(""); }}>Tout afficher</button>}
          <div className="text-xs" style={{ color: "#7A7460" }}>Le filtre porte sur la date d'émission des loyers et la date des dépenses.</div>
        </div>
        <div className="flex items-center justify-between mb-2"><div className="display text-base" style={{ color: "#152238" }}>Rentabilité par bien</div><button onClick={exporterBien} className="text-xs underline" data-testid="im-rapport-export-bien">Exporter</button></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Bien</th><th className="text-right">Loyers facturés (hors taxe)</th><th className="text-right">Encaissé</th><th className="text-right">Dépenses</th><th className="text-right">Résultat</th></tr></thead>
          <tbody>{parBien.map((x) => (<tr key={x.b.id} data-testid="im-rapport-bien"><td className="py-1.5">{x.b.name}</td><td className="text-right tabular">{fmt(x.fact)}</td><td className="text-right tabular">{fmt(x.enc)}</td><td className="text-right tabular">{fmt(x.dep)}</td><td className="text-right tabular">{fmt(x.res)}</td></tr>))}</tbody>
          {parBien.length > 0 && <tfoot><tr style={tf} data-testid="im-rapport-bien-total"><td>Total</td><td className="text-right tabular" data-testid="im-rapport-bien-tot-fact">{fmt(S(parBien, (x) => x.fact))}</td><td className="text-right tabular" data-testid="im-rapport-bien-tot-enc">{fmt(S(parBien, (x) => x.enc))}</td><td className="text-right tabular" data-testid="im-rapport-bien-tot-dep">{fmt(S(parBien, (x) => x.dep))}</td><td className="text-right tabular" data-testid="im-rapport-bien-tot-res">{fmt(S(parBien, (x) => x.res))}</td></tr></tfoot>}</table></div>
        <div className="flex items-center justify-between mb-2 mt-5"><div className="display text-base" style={{ color: "#152238" }}>Loyers impayés par locataire (retard depuis l'échéance)</div><button onClick={exporterImp} className="text-xs underline" data-testid="im-rapport-export-imp">Exporter</button></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Locataire</th><th className="text-right">Loyers</th><th className="text-right">Pas encore échu</th><th className="text-right">1 à 30 j</th><th className="text-right">31 à 60 j</th><th className="text-right">Plus de 60 j</th><th className="text-right">Reste à payer</th></tr></thead>
          <tbody>{impayes.map((x) => (<tr key={x.c.id} data-testid="im-rapport-imp"><td className="py-1.5">{x.c.name}</td><td className="text-right tabular">{x.n}</td><td className="text-right tabular">{fmt(x.b0)}</td><td className="text-right tabular">{fmt(x.b1)}</td><td className="text-right tabular">{fmt(x.b2)}</td><td className="text-right tabular">{fmt(x.b3)}</td><td className="text-right tabular">{fmt(x.reste)}</td></tr>))}</tbody>
          {impayes.length > 0 && <tfoot><tr style={tf} data-testid="im-rapport-imp-total"><td>Total</td><td className="text-right tabular">{S(impayes, (x) => x.n)}</td><td className="text-right tabular">{fmt(S(impayes, (x) => x.b0))}</td><td className="text-right tabular">{fmt(S(impayes, (x) => x.b1))}</td><td className="text-right tabular">{fmt(S(impayes, (x) => x.b2))}</td><td className="text-right tabular">{fmt(S(impayes, (x) => x.b3))}</td><td className="text-right tabular" data-testid="im-rapport-imp-tot-reste">{fmt(S(impayes, (x) => x.reste))}</td></tr></tfoot>}</table></div>
        {impayes.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun loyer impayé sur cette période.</div>}
        <div className="display text-base mb-2 mt-5" style={{ color: "#152238" }}>Dépenses par nature</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Nature</th><th className="text-right">Opérations</th><th className="text-right">Montant</th></tr></thead>
          <tbody>{parNature.map((x) => (<tr key={x.l} data-testid="im-rapport-nature"><td className="py-1.5">{x.l}</td><td className="text-right tabular">{x.n}</td><td className="text-right tabular">{fmt(x.m)}</td></tr>))}</tbody>
          {parNature.length > 0 && <tfoot><tr style={tf}><td>Total</td><td className="text-right tabular">{S(parNature, (x) => x.n)}</td><td className="text-right tabular" data-testid="im-rapport-nature-tot">{fmt(S(parNature, (x) => x.m))}</td></tr></tfoot>}</table></div>
      </div>
    );
  };

  // ───────── Statistiques ─────────
  const Stats = () => {
    const lA = loyers.filter((x) => x.status !== "annulee");
    const depA = depenses.filter((x) => x.status !== "annulé");
    const fT = imR2(lA.reduce((s, x) => s + x.ht, 0));
    const depT = imR2(depA.reduce((s, x) => s + x.amount, 0));
    const encT = imR2(lA.reduce((s, x) => s + imSolde(x).paye, 0));
    const mois = statMois(6, today);
    const data = mois.map((m) => ({ mois: m.label, ca: statSomme(lA, "date", m.key, (x) => x.ht), dep: statSomme(depA, "date", m.key, (x) => x.amount) }));
    const parBien = {}; lA.forEach((x) => { const k = nomBien(x.propertyId); parBien[k] = imR2((parBien[k] || 0) + x.ht); });
    const parNat = {}; depA.forEach((x) => { const k = (IM_DEPENSES.find((d) => d[0] === x.kind) || [0, x.kind])[1]; parNat[k] = imR2((parNat[k] || 0) + x.amount); });
    const parLoc = {}; lA.forEach((x) => { const r = imSolde(x).reste; if (r > 0.004) { const k = nomLoc(x.tenantId); parLoc[k] = imR2((parLoc[k] || 0) + r); } });
    const enG = biens.filter((b) => b.active !== false);
    const parEtat = {}; enG.forEach((b) => { const k = bailDuBien(b.id) ? "Loués" : "Libres"; parEtat[k] = (parEtat[k] || 0) + 1; });
    return <StatsBloc
      vide={biens.length + loyers.length === 0 ? "Aucun bien pour le moment : les statistiques apparaîtront avec vos premiers loyers." : ""}
      kpis={[["Loyers facturés (hors taxe)", fmt(fT), "im-stat-fact"], ["Loyers encaissés", fmt(encT), "im-stat-enc"], ["Dépenses des biens", fmt(depT), "im-stat-dep"], ["Résultat", fmt(imR2(fT - depT)), "im-stat-res"]]}
      evolution={{ titre: "Loyers facturés et dépenses — 6 derniers mois", data, series: [{ key: "ca", name: "Loyers facturés", color: "#0F6B5C" }, { key: "dep", name: "Dépenses", color: "#9A7B1E" }] }}
      repartitions={[{ titre: "Loyers facturés par bien", data: Object.keys(parBien).map((k) => ({ name: k, value: parBien[k] })) }, { titre: "Dépenses par nature", data: Object.keys(parNat).map((k) => ({ name: k, value: parNat[k] })) }, { titre: "Loyers impayés par locataire", data: Object.keys(parLoc).map((k) => ({ name: k, value: parLoc[k] })) }, { titre: "Biens loués et libres", unite: "nombre", data: Object.keys(parEtat).map((k) => ({ name: k, value: parEtat[k] })) }]} />;
  };

  const tabs = isVendeur
    ? [["apercu", "Tableau de bord"], ["locataires", "Locataires"], ["loyers", "Loyers"]]
    : [["apercu", "Tableau de bord"], ["biens", "Biens"], ["locataires", "Locataires"], ["baux", "Baux"], ["loyers", "Loyers"], ["depenses", "Dépenses"], ["rapports", "Rapports"], ["stats", "Statistiques"]];
  const imprDoc = (() => {
    if (!imprimer) return null;
    const r = loyers.find((x) => x.id === imprimer.id);
    if (!r) return null;
    return { titre: (imprimer.kind === "quittance" ? "Quittance " : "Avis d'échéance ") + r.number, node: <LoyerSheet r={r} mode={imprimer.kind} />, ticket: true };
  })();
  return (
    <>
      {listes}
      <div className={"p-4 md:p-8 max-w-6xl" + (imprDoc ? " no-print" : "")} data-testid="immobilier-module">
        <style>{EC_CSS + '[data-testid="immobilier-module"] .display.text-base{border-left:3px solid #C9A24B;padding-left:10px;margin-bottom:12px}[data-testid="immobilier-module"] input,[data-testid="immobilier-module"] select{background:#fff}'}</style>
        <div className="mb-4"><div className="display text-2xl" style={{ color: "#152238" }}>Immobilier et location</div><div className="text-xs" style={{ color: "#8A8370" }}>Biens, locataires, baux, loyers, quittances, dépenses et rentabilité par bien</div></div>
        {!canFront && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }}>Consultation seule : votre rôle ne permet pas de modifier les données.</div>}
        {isVendeur && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }} data-testid="im-accueil-note">Accueil : vous pouvez enregistrer les locataires, émettre les loyers, encaisser et imprimer avis et quittances. Biens, baux, dépenses, annulations et rapports sont réservés au responsable.</div>}
        <div className="ec-tabs">
          {tabs.map(([id, l]) => (<button key={id} onClick={() => setTab(id)} data-testid={"im-tab-" + id} className="px-3 py-2 text-sm rounded-lg transition-colors" style={{ background: tab === id ? "#152238" : "transparent", color: tab === id ? "#EFE9DD" : "#6B6552", fontWeight: tab === id ? 600 : 500 }}>{l}</button>))}
        </div>
        {tab === "apercu" && Apercu()}
        {tab === "biens" && !isVendeur && Biens()}
        {tab === "locataires" && Locataires()}
        {tab === "baux" && !isVendeur && Baux()}
        {tab === "loyers" && Loyers()}
        {tab === "depenses" && !isVendeur && Depenses()}
        {tab === "rapports" && !isVendeur && Rapports()}
        {tab === "stats" && !isVendeur && Stats()}
      </div>
      {imprDoc && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto p-3 md:p-8 no-print" style={{ background: "rgba(21,34,56,0.55)" }} onClick={() => setImprimer(null)} data-testid="im-apercu">
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: tk ? 340 : 820 }}>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap"><div className="text-sm" style={{ color: "#EFE9DD" }}>{imprDoc.titre}</div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => setTk(!tk)} className="px-3 py-1.5 rounded text-sm" style={ecBtn} data-testid="im-format">{tk ? "Passer en A4" : "Passer en ticket"}</button>
                <button onClick={() => { try { window.print(); } catch (e) {} }} className="px-3 py-1.5 rounded text-sm" style={ecBtnGold} data-testid="im-imprimer-ok">Imprimer / enregistrer en PDF</button>
                <button onClick={() => setImprimer(null)} className="px-3 py-1.5 rounded text-sm" style={ecBtn} data-testid="im-apercu-fermer">Fermer</button></div></div>
            <div className="rounded shadow-lg overflow-hidden" style={{ background: "#fff" }}>{imprDoc.node}</div>
          </div>
        </div>
      )}
      {imprDoc && <div className={"print-only" + (tk ? " ticket-print-80" : "")}>{imprDoc.node}</div>}
    </>
  );
}

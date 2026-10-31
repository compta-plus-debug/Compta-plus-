// ═══ MODULE ═══
// @module Transport
// @depends EC_CSS, Plus, StatsBloc, ecBorder, ecBtn, ecBtnGold, ecDateFr, ecInput, ecPastille
//   ecTelecharger, fmt, isFutureDate, isLocked, statMois, statSomme, todayStr, uid, useBrouillon
//   useState
// @exports TransportModule
// ═══ FIN DE L'EN-TÊTE ═══
// Bloc Transport et logistique : véhicules et échéances, chauffeurs, clients, voyages (bordereau imprimable), factures (A4 ou ticket),
// encaissements, dépenses par véhicule (carburant, entretien, assurance, autres), rapports de rentabilité par véhicule, statistiques.
// Rien n'est préréglé : prix des voyages, TCA, échéances et capacités sont saisis par l'entreprise.
//
// Comptabilité (tout en gourdes) :
//  • facture de voyage(s) : Débit 411 (total) / Crédit 706 (prestations de services) et 445 (TCA, seulement si activée) ;
//  • encaissement : Débit caisse ou banque / Crédit 411 ;
//  • dépense d'un véhicule : Débit 6053 carburant, 6242 entretien et réparations, 6252 assurance du véhicule, 618 autres frais /
//    Crédit caisse, banque ou 401 (à payer) ;
//  • toute annulation passe une écriture inverse.
// Les comptes 6053, 6242, 6252 et 618 sont à confirmer avec l'expert-comptable.

const TR_STATUTS = [["planifie", "Planifié"], ["encours", "En route"], ["livre", "Livré"], ["annule", "Annulé"]];
const TR_DEPENSES = [["carburant", "Carburant", "6053"], ["entretien", "Entretien et réparations", "6242"], ["assurance", "Assurance du véhicule", "6252"], ["autre", "Autres frais (péages, stationnement, vignette…)", "618"]];
const TR_COMPTES = {
  "411": { name: "Clients", type: "Actif" },
  "401": { name: "Fournisseurs", type: "Passif" },
  "445": { name: "Taxe collectée sur ventes (IVA/TCA)", type: "Passif" },
  "706": { name: "Prestations de services", type: "Produit" },
  "6053": { name: "Carburant et lubrifiants", type: "Charge" },
  "6242": { name: "Entretien et réparations du matériel de transport", type: "Charge" },
  "6252": { name: "Assurance du matériel de transport", type: "Charge" },
  "618": { name: "Autres frais de transport", type: "Charge" },
  "512": { name: "Banque", type: "Actif" },
  "530": { name: "Caisse", type: "Actif" },
};
const trR2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const trId = () => String(uid());
const trRows = (rows, type) => (rows || []).filter((r) => r && r.type === type);
const trJours = (a, b) => (a && b ? Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000) : 0);
const trPlus = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); };
const trPlaque = (x) => String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const trNom = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const trUniq = (arr) => Array.from(new Set(arr.map((x) => String(x || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
function trAjouterComptes(accounts, setAccounts, codes) {
  const missing = [...new Set(codes)].filter((k) => TR_COMPTES[k] && !accounts.some((a) => a.code === k)).map((k) => ({ code: k, name: TR_COMPTES[k].name, type: TR_COMPTES[k].type }));
  if (missing.length) setAccounts((prev) => [...prev, ...missing.filter((m) => !prev.some((a) => a.code === m.code))]);
}
// Soldes d'une facture (gourdes)
function trSolde(inv) {
  const paye = trR2((inv.payments || []).filter((p) => p.status !== "annulé").reduce((s, p) => s + p.amount, 0));
  return { paye, reste: trR2((inv.total || 0) - paye) };
}

function TransportModule({ suppliers, transport, setTransport, entries, setEntries, accounts, setAccounts, settings, role, showToast, logAudit, currentUserEmail }) {
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const isVendeur = role === "Vendeur"; // régulation : voyages, clients, factures et encaissements
  const canFront = canEdit || isVendeur;
  const today = todayStr();
  const [tab, setTab] = useState("apercu");
  const vehicles = trRows(transport, "vehicle");
  const drivers = trRows(transport, "driver");
  const clients = trRows(transport, "client");
  const trips = trRows(transport, "trip");
  const invoices = trRows(transport, "invoice");
  const expenses = trRows(transport, "expense");
  const cfg = trRows(transport, "config")[0] || {};
  const tcaOn = !!cfg.tcaOn;
  const tcaRate = tcaOn ? Number(settings.taxRate) || 0 : 0;
  const nomClient = (id) => (clients.find((x) => x.id === id) || {}).name || "—";
  const nomVeh = (id) => { const v = vehicles.find((x) => x.id === id); return v ? v.plate : "—"; };
  const nomChauf = (id) => (drivers.find((x) => x.id === id) || {}).name || "—";
  const compteMode = (m) => (m === "banque" ? "512" : m === "apayer" ? "401" : "530");
  const maj = (id, fn) => setTransport((prev) => (prev || []).map((r) => (r.id === id ? fn(r) : r)));
  const ajouter = (rec) => setTransport((prev) => [...(prev || []), rec]);
  const ecrire = (date, label, lines, dossierId) => {
    const e = { id: uid(), date, createdAt: new Date().toISOString(), label, lines: lines.filter((l) => l.debit > 0 || l.credit > 0), kind: "transport", dossierId };
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
  const [imprimer, setImprimer] = useState(null); // { kind: "facture" | "bordereau", id }
  const [tk, setTk] = useState(false);
  const [selInv, setSelInv] = useState("");
  const [selVeh, setSelVeh] = useState("");
  const listes = (<><datalist id="tr-dl-four">{trUniq([...(suppliers || []).map((y) => y.name), ...expenses.map((y) => y.supplier)]).map((n) => <option key={n} value={n} />)}</datalist><datalist id="tr-dl-lieu">{trUniq(trips.flatMap((t) => [t.from, t.to])).map((n) => <option key={n} value={n} />)}</datalist><datalist id="tr-dl-kind">{trUniq(vehicles.map((v) => v.kind)).map((n) => <option key={n} value={n} />)}</datalist><datalist id="tr-dl-doc">{trUniq(["Assurance", "Contrôle technique", "Vignette", ...vehicles.flatMap((v) => (v.docs || []).map((d) => d.label))]).map((n) => <option key={n} value={n} />)}</datalist></>);

  // ───────── Véhicules ─────────
  const [fv, setFv] = useBrouillon("transport-vehicule", { plate: "", kind: "", model: "", capacity: "", odometer: "" });
  const ajouterVehicule = () => {
    if (!canEdit) return;
    const plate = fv.plate.trim().toUpperCase();
    if (!plate) { showToast("Indiquez la plaque d'immatriculation."); return; }
    if (vehicles.some((v) => trPlaque(v.plate) === trPlaque(plate))) { showToast("Un véhicule avec cette plaque existe déjà."); return; }
    ajouter({ type: "vehicle", id: trId(), plate, kind: fv.kind.trim(), model: fv.model.trim(), capacity: fv.capacity.trim(), odometer: Number(fv.odometer) || 0, nextServiceDate: "", nextServiceKm: 0, docs: [], active: true });
    setFv({ plate: "", kind: "", model: "", capacity: "", odometer: "" });
    showToast("Véhicule " + plate + " ajouté."); logAudit("Transport", "Véhicule ajouté", plate);
  };
  const [fdoc, setFdoc] = useBrouillon("transport-echeance", { label: "", date: "" });
  const ajouterDoc = (v) => {
    if (!canEdit) return;
    if (!fdoc.label.trim()) { showToast("Indiquez le document (assurance, contrôle technique…)."); return; }
    if (!fdoc.date) { showToast("Indiquez la date d'échéance."); return; }
    maj(v.id, (r) => ({ ...r, docs: [...(r.docs || []), { id: trId(), label: fdoc.label.trim(), date: fdoc.date }] }));
    setFdoc({ label: "", date: "" });
  };
  const Vehicules = () => {
    const v = vehicles.find((x) => x.id === selVeh);
    return (
      <div>
        {canEdit && (<div className="ec-card p-4 mb-5"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouveau véhicule</div>
          <div className="grid md:grid-cols-5 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Plaque</label><input value={fv.plate} onChange={(e) => setFv({ ...fv, plate: e.target.value })} data-testid="tr-veh-plaque" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Type (camion, camionnette, moto…)</label><input list="tr-dl-kind" value={fv.kind} onChange={(e) => setFv({ ...fv, kind: e.target.value })} data-testid="tr-veh-type" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Marque et modèle</label><input value={fv.model} onChange={(e) => setFv({ ...fv, model: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Capacité (texte libre)</label><input value={fv.capacity} onChange={(e) => setFv({ ...fv, capacity: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Compteur actuel (km)</label><input type="number" min="0" value={fv.odometer} onChange={(e) => setFv({ ...fv, odometer: e.target.value })} data-testid="tr-veh-km" className={ecInput + " tabular"} style={ecBorder} /></div>
          </div>
          <button onClick={ajouterVehicule} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="tr-veh-ajouter">Ajouter le véhicule</button></div>)}
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Plaque</th><th>Type</th><th>Modèle</th><th className="text-right">Compteur (km)</th><th>Prochaine échéance</th><th>État</th><th></th></tr></thead>
          <tbody>{vehicles.map((x) => { const prochaines = (x.docs || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date))); const p0 = prochaines[0]; return (
            <tr key={x.id} data-testid="tr-veh-ligne" style={{ background: x.id === selVeh ? "#E6F1EE" : undefined, opacity: x.active === false ? 0.55 : 1 }}><td className="py-1.5 font-semibold">{x.plate}</td><td>{x.kind || "—"}</td><td>{x.model || "—"}</td><td className="text-right tabular">{x.odometer || 0}</td>
              <td className="text-xs">{p0 ? p0.label + " — " + ecDateFr(p0.date) : "—"}{p0 && p0.date < today ? " " : ""}{p0 && p0.date < today ? ecPastille("Échue", "alerte") : p0 && trJours(today, p0.date) <= 30 ? ecPastille("Sous 30 jours", "attente") : null}</td>
              <td>{x.active === false ? ecPastille("Hors service", "neutre") : ecPastille("En service", "ok")}</td>
              <td className="text-right whitespace-nowrap"><button onClick={() => setSelVeh(x.id === selVeh ? "" : x.id)} className="text-xs underline" data-testid="tr-veh-ouvrir">{x.id === selVeh ? "Fermer" : "Ouvrir"}</button></td></tr>); })}</tbody></table></div>
        {vehicles.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun véhicule.</div>}
        {v && (<div className="ec-card p-4 mt-5" data-testid="tr-veh-detail">
          <div className="display text-lg mb-3" style={{ color: "#152238" }}>{v.plate}{v.model ? " — " + v.model : ""}</div>
          <div className="grid md:grid-cols-4 gap-2 mb-4 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Compteur (km)</label><input type="number" min="0" value={v.odometer || ""} disabled={!canEdit} onChange={(e) => maj(v.id, (r) => ({ ...r, odometer: Number(e.target.value) || 0 }))} className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Prochain entretien (date)</label><input type="date" value={v.nextServiceDate || ""} disabled={!canEdit} onChange={(e) => maj(v.id, (r) => ({ ...r, nextServiceDate: e.target.value }))} data-testid="tr-veh-entretien-date" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Prochain entretien (km)</label><input type="number" min="0" value={v.nextServiceKm || ""} disabled={!canEdit} onChange={(e) => maj(v.id, (r) => ({ ...r, nextServiceKm: Number(e.target.value) || 0 }))} data-testid="tr-veh-entretien-km" className={ecInput + " tabular"} style={ecBorder} /></div>
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={v.active !== false} disabled={!canEdit} onChange={(e) => maj(v.id, (r) => ({ ...r, active: e.target.checked }))} data-testid="tr-veh-actif" />En service</label>
          </div>
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Échéances (assurance, contrôle technique, vignette…)</div>
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Document</th><th>Échéance</th><th></th></tr></thead>
            <tbody>{(v.docs || []).map((d) => (<tr key={d.id} data-testid="tr-doc-ligne"><td className="py-1.5">{d.label}</td><td>{ecDateFr(d.date)} {d.date < today ? ecPastille("Échue", "alerte") : trJours(today, d.date) <= 30 ? ecPastille("Sous 30 jours", "attente") : ecPastille("Valide", "ok")}</td>
              <td className="text-right">{canEdit && <button onClick={() => maj(v.id, (r) => ({ ...r, docs: r.docs.filter((x) => x.id !== d.id) }))} className="text-xs" style={{ color: "#A6432F" }}>Retirer</button>}</td></tr>))}</tbody></table></div>
          {canEdit && (<div className="grid md:grid-cols-4 gap-2 mt-2 items-end">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Document</label><input list="tr-dl-doc" value={fdoc.label} onChange={(e) => setFdoc({ ...fdoc, label: e.target.value })} data-testid="tr-doc-nom" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Échéance</label><input type="date" value={fdoc.date} onChange={(e) => setFdoc({ ...fdoc, date: e.target.value })} data-testid="tr-doc-date" className={ecInput} style={ecBorder} /></div>
            <button onClick={() => ajouterDoc(v)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="tr-doc-ajouter">Ajouter l'échéance</button>
          </div>)}
        </div>)}
      </div>
    );
  };

  // ───────── Chauffeurs ─────────
  const [fc, setFc] = useBrouillon("transport-chauffeur", { name: "", phone: "", license: "", expiry: "" });
  const ajouterChauffeur = () => {
    if (!canEdit) return;
    if (!fc.name.trim()) { showToast("Indiquez le nom du chauffeur."); return; }
    if (drivers.some((d) => trNom(d.name) === trNom(fc.name))) { showToast("Un chauffeur de ce nom existe déjà."); return; }
    ajouter({ type: "driver", id: trId(), name: fc.name.trim(), phone: fc.phone.trim(), license: fc.license.trim(), licenseExpiry: fc.expiry, active: true });
    setFc({ name: "", phone: "", license: "", expiry: "" }); showToast("Chauffeur ajouté.");
  };
  const Chauffeurs = () => (
    <div>
      {canEdit && (<div className="ec-card p-4 mb-5"><div className="grid md:grid-cols-5 gap-2 items-end">
        <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom</label><input value={fc.name} onChange={(e) => setFc({ ...fc, name: e.target.value })} data-testid="tr-chauf-nom" className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Téléphone</label><input type="tel" value={fc.phone} onChange={(e) => setFc({ ...fc, phone: e.target.value })} className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>N° de permis</label><input value={fc.license} onChange={(e) => setFc({ ...fc, license: e.target.value })} className={ecInput} style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Permis valable jusqu'au</label><input type="date" value={fc.expiry} onChange={(e) => setFc({ ...fc, expiry: e.target.value })} data-testid="tr-chauf-permis" className={ecInput} style={ecBorder} /></div>
      </div><button onClick={ajouterChauffeur} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="tr-chauf-ajouter">Ajouter le chauffeur</button></div>)}
      <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Chauffeur</th><th>Téléphone</th><th>Permis</th><th>Valable jusqu'au</th><th className="text-right">Voyages livrés</th><th>État</th></tr></thead>
        <tbody>{drivers.map((d) => (<tr key={d.id} data-testid="tr-chauf-ligne" style={{ opacity: d.active === false ? 0.55 : 1 }}><td className="py-1.5">{d.name}</td><td>{d.phone || "—"}</td><td className="text-xs">{d.license || "—"}</td>
          <td>{canEdit ? <input type="date" value={d.licenseExpiry || ""} onChange={(e) => maj(d.id, (r) => ({ ...r, licenseExpiry: e.target.value }))} className="border rounded px-1 py-0.5 text-xs" style={ecBorder} /> : ecDateFr(d.licenseExpiry)} {d.licenseExpiry && d.licenseExpiry < today ? ecPastille("Échu", "alerte") : d.licenseExpiry && trJours(today, d.licenseExpiry) <= 30 ? ecPastille("Sous 30 jours", "attente") : null}</td>
          <td className="text-right tabular">{trips.filter((t) => t.driverId === d.id && t.status === "livre").length}</td>
          <td>{canEdit ? <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={d.active !== false} onChange={(e) => maj(d.id, (r) => ({ ...r, active: e.target.checked }))} />Actif</label> : (d.active === false ? "Inactif" : "Actif")}</td></tr>))}</tbody></table></div>
      {drivers.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun chauffeur.</div>}
    </div>
  );

  // ───────── Clients ─────────
  const [fcl, setFcl] = useBrouillon("transport-client", { name: "", phone: "", address: "" });
  const [cq, setCq] = useState("");
  const ajouterClient = () => {
    if (!canFront) return;
    if (!fcl.name.trim()) { showToast("Indiquez le nom du client."); return; }
    if (clients.some((c) => trNom(c.name) === trNom(fcl.name))) { showToast("Un client de ce nom existe déjà."); return; }
    ajouter({ type: "client", id: trId(), name: fcl.name.trim(), phone: fcl.phone.trim(), address: fcl.address.trim() });
    setFcl({ name: "", phone: "", address: "" }); showToast("Client ajouté.");
  };
  const resteClient = (id) => trR2(invoices.filter((i) => i.clientId === id && i.status !== "annulee").reduce((s, i) => s + trSolde(i).reste, 0));
  const Clients = () => {
    const cF = clients.filter((c) => !cq.trim() || [c.name, c.phone, c.address].join(" ").toLowerCase().includes(cq.trim().toLowerCase()));
    return (
      <div>
        {canFront && (<div className="ec-card p-4 mb-5"><div className="grid md:grid-cols-4 gap-2 items-end">
          <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom du client</label><input value={fcl.name} onChange={(e) => setFcl({ ...fcl, name: e.target.value })} data-testid="tr-client-nom" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Téléphone</label><input type="tel" value={fcl.phone} onChange={(e) => setFcl({ ...fcl, phone: e.target.value })} className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Adresse</label><input value={fcl.address} onChange={(e) => setFcl({ ...fcl, address: e.target.value })} className={ecInput} style={ecBorder} /></div>
        </div><button onClick={ajouterClient} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="tr-client-ajouter">Ajouter le client</button></div>)}
        <div className="mb-2"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (nom, téléphone, adresse)</label><input value={cq} onChange={(e) => setCq(e.target.value)} data-testid="tr-client-recherche" className={ecInput} style={{ ...ecBorder, maxWidth: 360 }} /></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Client</th><th>Téléphone</th><th>Adresse</th><th className="text-right">Voyages</th><th className="text-right">Reste à payer</th></tr></thead>
          <tbody>{cF.map((c) => (<tr key={c.id} data-testid="tr-client-ligne"><td className="py-1.5">{c.name}</td><td>{c.phone || "—"}</td><td className="text-xs">{c.address || "—"}</td><td className="text-right tabular">{trips.filter((t) => t.clientId === c.id && t.status !== "annule").length}</td><td className="text-right tabular">{fmt(resteClient(c.id))}</td></tr>))}</tbody>
          {cF.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="tr-client-total-ligne"><td colSpan={4}>Total ({cF.length})</td><td className="text-right tabular" data-testid="tr-client-tot-reste">{fmt(trR2(cF.reduce((s, c) => s + resteClient(c.id), 0)))}</td></tr></tfoot>}</table></div>
        {cF.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{clients.length === 0 ? "Aucun client." : "Aucun résultat."}</div>}
      </div>
    );
  };

  // ───────── Voyages ─────────
  const [ft, setFt] = useBrouillon("transport-voyage", { clientId: "", vehicleId: "", driverId: "", date: todayStr(), from: "", to: "", desc: "", km: "", price: "" });
  const [tq, setTq] = useState(""); const [tst, setTst] = useState(""); const [td1, setTd1] = useState(""); const [td2, setTd2] = useState("");
  const creerVoyage = () => {
    if (!canFront) return;
    if (!ft.clientId) { showToast("Choisissez le client."); return; }
    if (!ft.vehicleId) { showToast("Choisissez le véhicule."); return; }
    if (!ft.driverId) { showToast("Choisissez le chauffeur."); return; }
    if (!ft.date) { showToast("Indiquez la date du voyage."); return; }
    if (!ft.from.trim() || !ft.to.trim()) { showToast("Indiquez le lieu de départ et le lieu d'arrivée."); return; }
    const price = Number(ft.price);
    if (!(price >= 0) || ft.price === "") { showToast("Indiquez le prix convenu (en gourdes)."); return; }
    const t = { type: "trip", id: trId(), number: numero("VY", trips, ft.date), date: ft.date, clientId: ft.clientId, vehicleId: ft.vehicleId, driverId: ft.driverId, from: ft.from.trim(), to: ft.to.trim(), desc: ft.desc.trim(), km: Number(ft.km) || 0, price, status: "planifie", invoiceId: "", createdAt: new Date().toISOString(), by: currentUserEmail || "" };
    ajouter(t);
    setFt({ ...ft, desc: "", km: "", price: "", from: "", to: "" });
    showToast("Voyage " + t.number + " enregistré."); logAudit("Transport", "Voyage créé", t.number + " — " + nomClient(t.clientId));
  };
  const changerStatut = (t, status) => {
    if (!canFront) return;
    if (t.invoiceId && status === "annule") { showToast("Ce voyage est facturé : annulez d'abord la facture."); return; }
    maj(t.id, (r) => ({ ...r, status }));
  };
  const supprimerVoyage = (t) => {
    if (!canFront || t.invoiceId) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Supprimer le voyage " + t.number + " ?")) return;
    setTransport((prev) => (prev || []).filter((r) => r.id !== t.id));
  };
  const Voyages = () => {
    const tF = trips.filter((t) => (!tst || t.status === tst) && (!td1 || t.date >= td1) && (!td2 || t.date <= td2) && (!tq.trim() || [t.number, nomClient(t.clientId), nomVeh(t.vehicleId), nomChauf(t.driverId), t.from, t.to].join(" ").toLowerCase().includes(tq.trim().toLowerCase()))).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.number).localeCompare(String(a.number)));
    const tFA = tF.filter((t) => t.status !== "annule");
    const vehOk = vehicles.filter((v) => v.active !== false), chOk = drivers.filter((d) => d.active !== false);
    return (
      <div>
        {canFront && (<div className="ec-card p-4 mb-5" data-testid="tr-nouveau-voyage"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouveau voyage</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Client</label><select value={ft.clientId} onChange={(e) => setFt({ ...ft, clientId: e.target.value })} data-testid="tr-voy-client" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Véhicule</label><select value={ft.vehicleId} onChange={(e) => setFt({ ...ft, vehicleId: e.target.value })} data-testid="tr-voy-vehicule" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{vehOk.map((v) => <option key={v.id} value={v.id}>{v.plate}{v.kind ? " — " + v.kind : ""}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Chauffeur</label><select value={ft.driverId} onChange={(e) => setFt({ ...ft, driverId: e.target.value })} data-testid="tr-voy-chauffeur" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{chOk.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date du voyage</label><input type="date" value={ft.date} onChange={(e) => setFt({ ...ft, date: e.target.value })} data-testid="tr-voy-date" className={ecInput} style={ecBorder} /></div>
          </div>
          <div className="grid md:grid-cols-5 gap-2 items-end mt-2">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Lieu de départ</label><input list="tr-dl-lieu" value={ft.from} onChange={(e) => setFt({ ...ft, from: e.target.value })} data-testid="tr-voy-depart" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Lieu d'arrivée</label><input list="tr-dl-lieu" value={ft.to} onChange={(e) => setFt({ ...ft, to: e.target.value })} data-testid="tr-voy-arrivee" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Distance (km, facultatif)</label><input type="number" min="0" value={ft.km} onChange={(e) => setFt({ ...ft, km: e.target.value })} data-testid="tr-voy-km" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Prix convenu (gourdes)</label><input type="number" min="0" value={ft.price} onChange={(e) => setFt({ ...ft, price: e.target.value })} data-testid="tr-voy-prix" className={ecInput + " tabular"} style={ecBorder} /></div>
            <button onClick={creerVoyage} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="tr-voy-creer">Enregistrer le voyage</button>
          </div>
          <div className="mt-2"><label className="text-xs" style={{ color: "#8A8370" }}>Marchandise ou passagers (facultatif)</label><input value={ft.desc} onChange={(e) => setFt({ ...ft, desc: e.target.value })} className={ecInput} style={ecBorder} /></div>
        </div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <div className="flex-1 min-w-[150px]"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (n°, client, plaque, chauffeur, lieu)</label><input value={tq} onChange={(e) => setTq(e.target.value)} data-testid="tr-voy-recherche" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>État</label><select value={tst} onChange={(e) => setTst(e.target.value)} data-testid="tr-voy-filtre-etat" className={ecInput} style={ecBorder}><option value="">Tous</option>{TR_STATUTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Du</label><input type="date" value={td1} onChange={(e) => setTd1(e.target.value)} className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Au</label><input type="date" value={td2} onChange={(e) => setTd2(e.target.value)} className={ecInput} style={ecBorder} /></div>
        </div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>Date</th><th>Client</th><th>Trajet</th><th>Véhicule / chauffeur</th><th className="text-right">Km</th><th className="text-right">Prix</th><th>État</th><th></th></tr></thead>
          <tbody>{tF.map((t) => (<tr key={t.id} data-testid="tr-voy-ligne" style={{ opacity: t.status === "annule" ? 0.55 : 1 }}><td className="py-1.5 tabular text-xs">{t.number}</td><td>{ecDateFr(t.date)}</td><td>{nomClient(t.clientId)}</td><td className="text-xs">{t.from} → {t.to}</td><td className="text-xs">{nomVeh(t.vehicleId)} · {nomChauf(t.driverId)}</td><td className="text-right tabular">{t.km || "—"}</td><td className="text-right tabular">{fmt(t.price)}</td>
            <td>{canFront ? <select value={t.status} onChange={(e) => changerStatut(t, e.target.value)} data-testid="tr-voy-etat" className="border rounded px-1 py-0.5 text-xs" style={ecBorder}>{TR_STATUTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select> : (TR_STATUTS.find((x) => x[0] === t.status) || [0, t.status])[1]}{t.invoiceId ? <span className="ml-1">{ecPastille("Facturé", "ok")}</span> : null}</td>
            <td className="text-right whitespace-nowrap"><button onClick={() => setImprimer({ kind: "bordereau", id: t.id })} className="text-xs underline mr-2" data-testid="tr-voy-bordereau">Bordereau</button>{canFront && t.status === "livre" && !t.invoiceId && <button onClick={() => facturer([t])} className="text-xs underline mr-2" data-testid="tr-voy-facturer">Facturer</button>}{canFront && !t.invoiceId && <button onClick={() => supprimerVoyage(t)} className="text-xs" style={{ color: "#A6432F" }}>Supprimer</button>}</td></tr>))}</tbody>
          {tF.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="tr-voy-total-ligne"><td colSpan={5}>Total ({tFA.length} voyage{tFA.length > 1 ? "s" : ""}, hors annulés)</td><td className="text-right tabular" data-testid="tr-voy-tot-km">{tFA.reduce((s, t) => s + (t.km || 0), 0)}</td><td className="text-right tabular" data-testid="tr-voy-tot-prix">{fmt(trR2(tFA.reduce((s, t) => s + t.price, 0)))}</td><td colSpan={2}></td></tr></tfoot>}</table></div>
        {tF.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{trips.length === 0 ? "Aucun voyage." : "Aucun voyage ne correspond à ces filtres."}</div>}
      </div>
    );
  };

  // ───────── Factures et encaissements ─────────
  const facturer = (liste) => {
    if (!canFront || !liste.length) return;
    const clientId = liste[0].clientId;
    if (liste.some((t) => t.clientId !== clientId || t.invoiceId || t.status !== "livre")) { showToast("Seuls les voyages livrés et non facturés d'un même client peuvent être facturés ensemble."); return; }
    if (!verifDate(today, "établir cette facture")) return;
    const ht = trR2(liste.reduce((s, t) => s + t.price, 0));
    if (!(ht > 0)) { showToast("Le prix des voyages est à zéro : rien à facturer."); return; }
    const tca = tcaOn ? trR2(ht * tcaRate / 100) : 0;
    const total = trR2(ht + tca);
    const number = numero("FT", invoices, today);
    trAjouterComptes(accounts, setAccounts, ["411", "706", ...(tca > 0 ? ["445"] : [])]);
    const e = ecrire(today, "Facture " + number + " — " + nomClient(clientId), [{ account: "411", debit: total, credit: 0 }, { account: "706", debit: 0, credit: ht }, ...(tca > 0 ? [{ account: "445", debit: 0, credit: tca }] : [])], number);
    const id = trId();
    const inv = { type: "invoice", id, number, date: today, clientId, tripIds: liste.map((t) => t.id), lines: liste.map((t) => ({ id: trId(), tripId: t.id, label: t.number + " — " + t.from + " → " + t.to + " (" + nomVeh(t.vehicleId) + ")", amount: t.price })), ht, tcaRate, tca, total, entryId: e.id, status: "emise", payments: [], createdAt: new Date().toISOString(), by: currentUserEmail || "" };
    setTransport((prev) => [...(prev || []).map((r) => (liste.some((t) => t.id === r.id) ? { ...r, invoiceId: id } : r)), inv]);
    setSelInv(id); setTab("factures");
    showToast("Facture " + number + " : " + fmt(total) + "."); logAudit("Transport", "Facture émise", number + " — " + fmt(total));
  };
  const [pp, setPp] = useBrouillon("transport-paiement", { amount: "", mode: "caisse", date: todayStr() });
  const [fcf, setFcf] = useState("");
  const [iq, setIq] = useState(""); const [iet, setIet] = useState(""); const [id1, setId1] = useState(""); const [id2, setId2] = useState("");
  const etatInv = (i) => (i.status === "annulee" ? "annulee" : trSolde(i).reste <= 0.004 ? "soldee" : "encaisser");
  const encaisser = (inv) => {
    if (!canFront || inv.status === "annulee") return;
    const amount = trR2(pp.amount);
    const s = trSolde(inv);
    if (!(amount > 0)) { showToast("Indiquez un montant supérieur à zéro."); return; }
    if (amount > s.reste + 0.004) { showToast("Le montant dépasse le reste à payer (" + fmt(s.reste) + ")."); return; }
    if (!verifDate(pp.date, "enregistrer cet encaissement")) return;
    const cpt = compteMode(pp.mode === "banque" ? "banque" : "caisse");
    trAjouterComptes(accounts, setAccounts, [cpt, "411"]);
    const e = ecrire(pp.date, "Encaissement " + inv.number + " — " + nomClient(inv.clientId), [{ account: cpt, debit: amount, credit: 0 }, { account: "411", debit: 0, credit: amount }], inv.id);
    maj(inv.id, (r) => ({ ...r, payments: [...(r.payments || []), { id: trId(), date: pp.date, amount, mode: pp.mode, entryId: e.id, status: "valide", by: currentUserEmail || "" }] }));
    setPp({ ...pp, amount: "" }); showToast("Encaissement de " + fmt(amount) + " enregistré."); logAudit("Transport", "Encaissement", inv.number + " — " + fmt(amount));
  };
  const annulerPaiement = (inv, p) => {
    if (!canEdit || p.status === "annulé") return;
    if (!verifDate(today, "annuler cet encaissement")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler cet encaissement ? Une écriture inverse sera passée.")) return;
    const e = contre(p.entryId, "Annulation encaissement " + inv.number + " (écriture inverse)", today, inv.id);
    maj(inv.id, (r) => ({ ...r, payments: r.payments.map((x) => (x.id === p.id ? { ...x, status: "annulé", reversalEntryId: e ? e.id : "" } : x)) }));
    showToast("Encaissement annulé.");
  };
  const annulerFacture = (inv) => {
    if (!canEdit || inv.status === "annulee") return;
    if ((inv.payments || []).some((p) => p.status !== "annulé")) { showToast("Annulez d'abord les encaissements de cette facture."); return; }
    if (!verifDate(today, "annuler cette facture")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler la facture " + inv.number + " ? Une écriture inverse sera passée.")) return;
    const e = contre(inv.entryId, "Annulation facture " + inv.number + " (écriture inverse)", today, inv.id);
    setTransport((prev) => (prev || []).map((r) => (r.id === inv.id ? { ...r, status: "annulee", reversalEntryId: e ? e.id : "" } : (r.type === "trip" && r.invoiceId === inv.id ? { ...r, invoiceId: "" } : r))));
    showToast("Facture annulée : les voyages peuvent être refacturés.");
  };
  const FactureSheet = ({ inv }) => {
    const s = trSolde(inv);
    return (
      <div style={{ color: "#152238", background: "#fff", fontFamily: "'Inter', sans-serif", fontSize: tk ? 11 : 13, width: "100%", maxWidth: tk ? 300 : 794, margin: "0 auto", padding: tk ? "12px 10px" : "32px 36px", boxSizing: "border-box" }} data-testid="tr-facture-feuille">
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          {settings.companyLogo && <img src={settings.companyLogo} alt="" style={{ width: 60, height: 60, objectFit: "contain", margin: "0 auto 6px", display: "block" }} />}
          <div style={{ fontWeight: 700, fontSize: 20 }}>{settings.companyName || "Transport"}</div>
          {settings.companyAddress && <div style={{ fontSize: 12 }}>{settings.companyAddress}</div>}
          {settings.companyPhone && <div style={{ fontSize: 12 }}>{settings.companyPhone}</div>}
          {settings.companyNIF && <div style={{ fontSize: 12 }}>NIF : {settings.companyNIF}</div>}
        </div>
        <div style={{ fontWeight: 700, fontSize: 18, textAlign: "center", marginBottom: 10 }}>FACTURE{inv.status === "annulee" ? " — ANNULÉE" : ""}</div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><span>N° <b>{inv.number}</b></span><span>{ecDateFr(inv.date)}</span></div>
        <div style={{ marginBottom: 10 }}>Client : <b>{nomClient(inv.clientId)}</b></div>
        <div style={{ borderTop: "1px dashed #152238", borderBottom: "1px dashed #152238", padding: "8px 0", marginBottom: 8 }}>
          {(inv.lines || []).map((l) => <div key={l.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0" }}><span>{l.label}</span><span className="tabular">{fmt(l.amount)}</span></div>)}
        </div>
        {inv.tca > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span>Total hors taxe</span><span className="tabular">{fmt(inv.ht)}</span></div>}
        {inv.tca > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span>TCA ({inv.tcaRate} %)</span><span className="tabular">{fmt(inv.tca)}</span></div>}
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 18 }}><span>Total à payer</span><span className="tabular">{fmt(inv.total)}</span></div>
        {s.paye > 0 && <div style={{ marginTop: 4 }}>Déjà payé : <span className="tabular">{fmt(s.paye)}</span> — reste : <span className="tabular">{fmt(s.reste)}</span></div>}
        <div style={{ marginTop: 14, textAlign: "center", fontSize: 12 }}>Merci de votre confiance !</div>
      </div>
    );
  };
  const BordereauSheet = ({ t }) => (
    <div style={{ color: "#152238", background: "#fff", fontFamily: "'Inter', sans-serif", fontSize: 13, width: "100%", maxWidth: 794, margin: "0 auto", padding: "32px 36px", boxSizing: "border-box" }} data-testid="tr-bordereau-feuille">
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        {settings.companyLogo && <img src={settings.companyLogo} alt="" style={{ width: 60, height: 60, objectFit: "contain", margin: "0 auto 6px", display: "block" }} />}
        <div style={{ fontWeight: 700, fontSize: 20 }}>{settings.companyName || "Transport"}</div>
        {settings.companyAddress && <div style={{ fontSize: 12 }}>{settings.companyAddress}</div>}
        {settings.companyPhone && <div style={{ fontSize: 12 }}>{settings.companyPhone}</div>}
      </div>
      <div style={{ fontWeight: 700, fontSize: 18, textAlign: "center", marginBottom: 12 }}>BORDEREAU DE TRANSPORT</div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}><tbody>
        {[["N°", t.number], ["Date", ecDateFr(t.date)], ["Client", nomClient(t.clientId)], ["Départ", t.from], ["Arrivée", t.to], ["Véhicule", nomVeh(t.vehicleId)], ["Chauffeur", nomChauf(t.driverId)], ["Marchandise ou passagers", t.desc || "—"], ["Distance", t.km ? t.km + " km" : "—"]].map(([k, v]) => (<tr key={k}><td style={{ padding: "5px 8px", border: "1px solid #bbb", width: "35%", fontWeight: 600 }}>{k}</td><td style={{ padding: "5px 8px", border: "1px solid #bbb" }}>{v}</td></tr>))}
      </tbody></table>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 24, marginTop: 40 }}>
        <div style={{ flex: 1, borderTop: "1px solid #152238", paddingTop: 4, textAlign: "center", fontSize: 12 }}>Signature du chauffeur</div>
        <div style={{ flex: 1, borderTop: "1px solid #152238", paddingTop: 4, textAlign: "center", fontSize: 12 }}>Reçu par (nom et signature)</div>
      </div>
    </div>
  );
  const Factures = () => {
    const inv = invoices.find((x) => x.id === selInv);
    const iF = invoices.filter((x) => (!iet || etatInv(x) === iet) && (!id1 || x.date >= id1) && (!id2 || x.date <= id2) && (!iq.trim() || [x.number, nomClient(x.clientId)].join(" ").toLowerCase().includes(iq.trim().toLowerCase()))).sort((a, b) => String(b.number).localeCompare(String(a.number)));
    const iFA = iF.filter((x) => x.status !== "annulee");
    const aFacturer = trips.filter((t) => t.status === "livre" && !t.invoiceId && (!fcf || t.clientId === fcf));
    const nonLivres = trips.filter((t) => t.status !== "livre" && t.status !== "annule" && !t.invoiceId && t.clientId === fcf);
    return (
      <div>
        {canFront && (<div className="ec-card p-4 mb-5" data-testid="tr-facturer-bloc"><div className="display text-base mb-2" style={{ color: "#152238" }}>Facturer les voyages livrés</div>
          <div className="flex flex-wrap items-end gap-3">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Client</label><select value={fcf} onChange={(e) => setFcf(e.target.value)} data-testid="tr-fact-client" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div className="text-sm" style={{ color: "#152238" }}>{fcf ? <><b data-testid="tr-fact-nb">{aFacturer.length}</b> voyage(s) livré(s) à facturer — <b className="tabular" data-testid="tr-fact-montant">{fmt(trR2(aFacturer.reduce((s, t) => s + t.price, 0)))}</b></> : "Choisissez un client pour voir ses voyages livrés non facturés."}</div>
            <button onClick={() => facturer(aFacturer)} disabled={!fcf || !aFacturer.length} className="px-3 py-2 rounded text-sm" style={{ ...ecBtnGold, opacity: !fcf || !aFacturer.length ? 0.5 : 1 }} data-testid="tr-fact-emettre">Émettre la facture</button>
          </div>
          {fcf && aFacturer.length === 0 && (<div className="text-sm mt-3 p-2 rounded" style={{ background: "#FFF6E0", color: "#152238" }} data-testid="tr-fact-aucun">{nonLivres.length > 0 ? "Aucun voyage livré à facturer pour ce client. Ses voyages ci-dessous ne sont pas encore à l'état « Livré » : passez-les à « Livré » dans la colonne État, puis le bouton « Émettre la facture » s'active." : "Ce client n'a aucun voyage à facturer : créez d'abord un voyage dans l'onglet Voyages, puis passez-le à « Livré »."}</div>)}
          {fcf && nonLivres.length > 0 && (<div className="ec-wrap mt-3"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>Date</th><th>Trajet</th><th className="text-right">Prix</th><th>État</th></tr></thead>
            <tbody>{nonLivres.map((t) => (<tr key={t.id} data-testid="tr-fact-voyage-ligne"><td className="py-1.5 tabular text-xs">{t.number}</td><td>{ecDateFr(t.date)}</td><td className="text-xs">{t.from} → {t.to}</td><td className="text-right tabular">{fmt(t.price)}</td><td><select value={t.status} onChange={(e) => changerStatut(t, e.target.value)} data-testid="tr-fact-voyage-etat" className="border rounded px-1 py-0.5 text-xs" style={ecBorder}>{TR_STATUTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td></tr>))}</tbody></table></div>)}
          {canEdit && <label className="text-xs flex items-center gap-2 mt-3"><input type="checkbox" checked={tcaOn} onChange={(e) => { const on = e.target.checked; setTransport((prev) => [...(prev || []).filter((r) => !(r.type === "config")), { type: "config", id: "config", tcaOn: on }]); showToast(on ? "TCA activée sur les prochaines factures (" + (Number(settings.taxRate) || 0) + " %, taux des Réglages)." : "TCA désactivée."); }} data-testid="tr-tca" />Appliquer la TCA sur les factures (taux des Réglages : {Number(settings.taxRate) || 0} %). À confirmer avec votre expert-comptable.</label>}
        </div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <div className="flex-1 min-w-[150px]"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (n°, client)</label><input value={iq} onChange={(e) => setIq(e.target.value)} data-testid="tr-inv-recherche" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>État</label><select value={iet} onChange={(e) => setIet(e.target.value)} data-testid="tr-inv-filtre-etat" className={ecInput} style={ecBorder}><option value="">Tous</option><option value="encaisser">À encaisser</option><option value="soldee">Soldée</option><option value="annulee">Annulée</option></select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Du</label><input type="date" value={id1} onChange={(e) => setId1(e.target.value)} className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Au</label><input type="date" value={id2} onChange={(e) => setId2(e.target.value)} className={ecInput} style={ecBorder} /></div>
        </div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>Date</th><th>Client</th><th className="text-right">Total</th><th className="text-right">Reste à payer</th><th>État</th><th></th></tr></thead>
          <tbody>{iF.map((x) => { const s = trSolde(x); return (<tr key={x.id} data-testid="tr-inv-ligne" style={{ background: x.id === selInv ? "#E6F1EE" : undefined, opacity: x.status === "annulee" ? 0.55 : 1 }}><td className="py-1.5 tabular text-xs">{x.number}</td><td>{ecDateFr(x.date)}</td><td>{nomClient(x.clientId)}</td><td className="text-right tabular">{fmt(x.total)}</td><td className="text-right tabular">{x.status === "annulee" ? "—" : fmt(s.reste)}</td>
            <td>{etatInv(x) === "annulee" ? ecPastille("Annulée", "neutre") : etatInv(x) === "soldee" ? ecPastille("Soldée", "ok") : ecPastille("À encaisser", "attente")}</td>
            <td className="text-right whitespace-nowrap"><button onClick={() => setSelInv(x.id === selInv ? "" : x.id)} className="text-xs underline mr-3" data-testid="tr-inv-ouvrir">{x.id === selInv ? "Fermer" : "Ouvrir"}</button><button onClick={() => setImprimer({ kind: "facture", id: x.id })} className="text-xs underline" data-testid="tr-inv-imprimer">Imprimer</button></td></tr>); })}</tbody>
          {iF.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="tr-inv-total-ligne"><td colSpan={3}>Total ({iFA.length} facture{iFA.length > 1 ? "s" : ""}, hors annulées)</td><td className="text-right tabular" data-testid="tr-inv-tot-total">{fmt(trR2(iFA.reduce((s, x) => s + x.total, 0)))}</td><td className="text-right tabular" data-testid="tr-inv-tot-reste">{fmt(trR2(iFA.reduce((s, x) => s + trSolde(x).reste, 0)))}</td><td colSpan={2}></td></tr></tfoot>}</table></div>
        {iF.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{invoices.length === 0 ? "Aucune facture." : "Aucune facture ne correspond à ces filtres."}</div>}
        {inv && (<div className="ec-card p-4 mt-5" data-testid="tr-inv-detail">
          <div className="display text-lg mb-2" style={{ color: "#152238" }}>{inv.number} — {nomClient(inv.clientId)}</div>
          <div className="text-sm mb-3" style={{ color: "#5B563F" }}>Total {fmt(inv.total)}{inv.tca > 0 ? " (dont TCA " + fmt(inv.tca) + ")" : ""} · payé {fmt(trSolde(inv).paye)} · reste <b data-testid="tr-inv-reste">{fmt(trSolde(inv).reste)}</b></div>
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Mode</th><th className="text-right">Montant</th><th>État</th><th></th></tr></thead>
            <tbody>{(inv.payments || []).map((p) => (<tr key={p.id} data-testid="tr-pay-ligne" style={{ opacity: p.status === "annulé" ? 0.55 : 1 }}><td className="py-1.5">{ecDateFr(p.date)}</td><td>{p.mode === "banque" ? "Banque" : "Espèces"}</td><td className="text-right tabular">{fmt(p.amount)}</td><td>{p.status === "annulé" ? ecPastille("Annulé", "neutre") : ecPastille("Valide", "ok")}</td><td className="text-right">{canEdit && p.status !== "annulé" && <button onClick={() => annulerPaiement(inv, p)} className="text-xs" style={{ color: "#A6432F" }} data-testid="tr-pay-annuler">Annuler</button>}</td></tr>))}</tbody></table></div>
          {canFront && inv.status !== "annulee" && (<div className="grid md:grid-cols-4 gap-2 mt-3 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant reçu</label><input type="number" min="0" value={pp.amount} onChange={(e) => setPp({ ...pp, amount: e.target.value })} data-testid="tr-pay-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Mode</label><select value={pp.mode} onChange={(e) => setPp({ ...pp, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Espèces</option><option value="banque">Banque</option></select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" value={pp.date} max={todayStr()} onChange={(e) => setPp({ ...pp, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <button onClick={() => encaisser(inv)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="tr-pay-valider">Enregistrer l'encaissement</button>
          </div>)}
          {canEdit && inv.status !== "annulee" && <button onClick={() => annulerFacture(inv)} className="mt-3 text-xs underline" style={{ color: "#A6432F" }} data-testid="tr-inv-annuler">Annuler cette facture</button>}
        </div>)}
      </div>
    );
  };

  // ───────── Dépenses des véhicules ─────────
  const [fd, setFd] = useBrouillon("transport-depense", { vehicleId: "", kind: "carburant", date: todayStr(), label: "", liters: "", amount: "", mode: "caisse", odometer: "", supplier: "" });
  const [dq, setDq] = useState(""); const [dk, setDk] = useState(""); const [dv, setDv] = useState("");
  const [selDep, setSelDep] = useState(""); const [rg, setRg] = useState({ amount: "", date: todayStr(), mode: "caisse" });
  const payeDep = (x) => trR2((x.settlements || []).filter((s2) => s2.status !== "annulé").reduce((t, s2) => t + s2.amount, 0));
  const resteDep = (x) => (x.mode === "apayer" && x.status !== "annulé" ? trR2(x.amount - payeDep(x)) : 0);
  const enregistrerDepense = () => {
    if (!canEdit) return;
    const amount = trR2(fd.amount);
    if (!fd.vehicleId) { showToast("Choisissez le véhicule."); return; }
    if (!(amount > 0)) { showToast("Indiquez le montant (en gourdes)."); return; }
    if (fd.mode === "apayer" && !fd.supplier.trim()) { showToast("Pour une dépense à payer plus tard, indiquez le fournisseur."); return; }
    if (!verifDate(fd.date, "enregistrer cette dépense")) return;
    const def = TR_DEPENSES.find((x) => x[0] === fd.kind) || TR_DEPENSES[0];
    const compte = def[2], cpt = compteMode(fd.mode);
    const label = fd.label.trim() || def[1];
    trAjouterComptes(accounts, setAccounts, [compte, cpt]);
    const e = ecrire(fd.date, "Véhicule " + nomVeh(fd.vehicleId) + " — " + label, [{ account: compte, debit: amount, credit: 0 }, { account: cpt, debit: 0, credit: amount }], fd.vehicleId);
    const km = Number(fd.odometer) || 0;
    setTransport((prev) => [...(prev || []).map((r) => (r.id === fd.vehicleId && km > (Number(r.odometer) || 0) ? { ...r, odometer: km } : r)), { type: "expense", id: trId(), date: fd.date, vehicleId: fd.vehicleId, kind: fd.kind, label, liters: Number(fd.liters) || 0, amount, mode: fd.mode, supplier: fd.supplier.trim(), settlements: [], odometer: km, entryId: e.id, status: "valide", by: currentUserEmail || "" }]);
    setFd({ ...fd, label: "", liters: "", amount: "", odometer: "", supplier: "" });
    showToast("Dépense enregistrée : " + fmt(amount) + "."); logAudit("Transport", "Dépense véhicule", nomVeh(fd.vehicleId) + " — " + label + " — " + fmt(amount));
  };
  const annulerDepense = (x) => {
    if (!canEdit || x.status === "annulé") return;
    if (payeDep(x) > 0) { showToast("Annulez d'abord les règlements de cette dépense."); return; }
    if (!verifDate(today, "annuler cette dépense")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler cette dépense ? Une écriture inverse sera passée.")) return;
    const e = contre(x.entryId, "Annulation — " + nomVeh(x.vehicleId) + " — " + x.label + " (écriture inverse)", today, x.vehicleId);
    maj(x.id, (r) => ({ ...r, status: "annulé", reversalEntryId: e ? e.id : "" }));
    showToast("Dépense annulée.");
  };
  const reglerDep = (x) => {
    if (!canEdit || x.mode !== "apayer" || x.status === "annulé") return;
    const reste = resteDep(x);
    const amount = rg.amount === "" ? reste : trR2(rg.amount);
    if (!(amount > 0) || amount > reste + 0.004) { showToast("Le montant doit être compris entre 0 et le reste à payer (" + fmt(reste) + ")."); return; }
    if (!verifDate(rg.date, "enregistrer ce règlement")) return;
    if (rg.date < x.date) { showToast("Le règlement ne peut pas précéder la dépense."); return; }
    const cpt = compteMode(rg.mode === "banque" ? "banque" : "caisse");
    trAjouterComptes(accounts, setAccounts, [cpt, "401"]);
    const e = ecrire(rg.date, "Règlement " + (x.supplier || "fournisseur") + " — " + x.label, [{ account: "401", debit: amount, credit: 0 }, { account: cpt, debit: 0, credit: amount }], x.vehicleId);
    maj(x.id, (r) => ({ ...r, settlements: [...(r.settlements || []), { id: trId(), date: rg.date, amount, mode: rg.mode, entryId: e.id, status: "valide" }] }));
    setRg({ ...rg, amount: "" }); showToast("Règlement de " + fmt(amount) + " enregistré."); logAudit("Transport", "Dette réglée", (x.supplier || "") + " — " + fmt(amount));
  };
  const annulerRegDep = (x, s2) => {
    if (!canEdit || s2.status === "annulé") return;
    if (!verifDate(today, "annuler ce règlement")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler ce règlement ? Une écriture inverse sera passée.")) return;
    const e = contre(s2.entryId, "Annulation règlement " + (x.supplier || "") + " (écriture inverse)", today, x.vehicleId);
    maj(x.id, (r) => ({ ...r, settlements: r.settlements.map((y) => (y.id === s2.id ? { ...y, status: "annulé", reversalEntryId: e ? e.id : "" } : y)) }));
    showToast("Règlement annulé.");
  };
  const Depenses = () => {
    const dF = expenses.filter((x) => (!dk || x.kind === dk) && (!dv || x.vehicleId === dv) && (!dq.trim() || [x.label, nomVeh(x.vehicleId)].join(" ").toLowerCase().includes(dq.trim().toLowerCase()))).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const dFA = dF.filter((x) => x.status !== "annulé");
    return (
      <div>
        {canEdit && (<div className="ec-card p-4 mb-5" data-testid="tr-nouvelle-depense"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvelle dépense</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Véhicule</label><select value={fd.vehicleId} onChange={(e) => setFd({ ...fd, vehicleId: e.target.value })} data-testid="tr-dep-vehicule" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Nature</label><select value={fd.kind} onChange={(e) => setFd({ ...fd, kind: e.target.value })} data-testid="tr-dep-nature" className={ecInput} style={ecBorder}>{TR_DEPENSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" value={fd.date} max={todayStr()} onChange={(e) => setFd({ ...fd, date: e.target.value })} data-testid="tr-dep-date" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Payé par</label><select value={fd.mode} onChange={(e) => setFd({ ...fd, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Caisse</option><option value="banque">Banque</option><option value="apayer">À payer (dette)</option></select></div>
          </div>
          <div className="grid md:grid-cols-5 gap-2 items-end mt-2">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Détail (facultatif)</label><input value={fd.label} onChange={(e) => setFd({ ...fd, label: e.target.value })} className={ecInput} style={ecBorder} /></div>
            {fd.kind === "carburant" && <div><label className="text-xs" style={{ color: "#8A8370" }}>Litres (facultatif)</label><input type="number" min="0" value={fd.liters} onChange={(e) => setFd({ ...fd, liters: e.target.value })} className={ecInput + " tabular"} style={ecBorder} /></div>}
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Compteur (km, facultatif)</label><input type="number" min="0" value={fd.odometer} onChange={(e) => setFd({ ...fd, odometer: e.target.value })} data-testid="tr-dep-km" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Fournisseur (obligatoire si « à payer »)</label><input list="tr-dl-four" value={fd.supplier} onChange={(e) => setFd({ ...fd, supplier: e.target.value })} data-testid="tr-dep-fournisseur" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant (gourdes)</label><input type="number" min="0" value={fd.amount} onChange={(e) => setFd({ ...fd, amount: e.target.value })} data-testid="tr-dep-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
          </div>
          <button onClick={enregistrerDepense} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="tr-dep-valider">Enregistrer la dépense</button></div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <div className="flex-1 min-w-[150px]"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (détail, plaque)</label><input value={dq} onChange={(e) => setDq(e.target.value)} className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Nature</label><select value={dk} onChange={(e) => setDk(e.target.value)} data-testid="tr-dep-filtre-nature" className={ecInput} style={ecBorder}><option value="">Toutes</option>{TR_DEPENSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Véhicule</label><select value={dv} onChange={(e) => setDv(e.target.value)} className={ecInput} style={ecBorder}><option value="">Tous</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}</select></div>
        </div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Véhicule</th><th>Nature</th><th>Détail</th><th className="text-right">Montant</th><th>État</th><th></th></tr></thead>
          <tbody>{dF.map((x) => (<tr key={x.id} data-testid="tr-dep-ligne" style={{ opacity: x.status === "annulé" ? 0.55 : 1 }}><td className="py-1.5">{ecDateFr(x.date)}</td><td>{nomVeh(x.vehicleId)}</td><td className="text-xs">{(TR_DEPENSES.find((k) => k[0] === x.kind) || [0, x.kind])[1]}</td><td className="text-xs">{x.label}{x.liters ? " · " + x.liters + " L" : ""}</td><td className="text-right tabular">{fmt(x.amount)}</td><td>{x.status === "annulé" ? ecPastille("Annulée", "neutre") : x.mode === "apayer" ? (resteDep(x) > 0.004 ? ecPastille("À payer : " + fmt(resteDep(x)), "attente") : ecPastille("Payée", "ok")) : ecPastille("Valide", "ok")}{x.supplier ? <div className="text-xs" style={{ color: "#8A8370" }}>{x.supplier}</div> : null}</td><td className="text-right">{canEdit && x.mode === "apayer" && x.status !== "annulé" && <button onClick={() => setSelDep(x.id === selDep ? "" : x.id)} className="text-xs underline mr-2" data-testid="tr-dep-ouvrir">{x.id === selDep ? "Fermer" : "Régler"}</button>}{canEdit && x.status !== "annulé" && <button onClick={() => annulerDepense(x)} className="text-xs" style={{ color: "#A6432F" }} data-testid="tr-dep-annuler">Annuler</button>}</td></tr>))}</tbody>
          {dF.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="tr-dep-total-ligne"><td colSpan={4}>Total ({dFA.length}, hors annulées)</td><td className="text-right tabular" data-testid="tr-dep-tot">{fmt(trR2(dFA.reduce((s, x) => s + x.amount, 0)))}</td><td colSpan={2}></td></tr></tfoot>}</table></div>
        {(() => { const x0 = expenses.find((y) => y.id === selDep); return x0 && x0.mode === "apayer" && x0.status !== "annulé" ? (<div className="ec-card p-4 mt-3" data-testid="tr-depreg-form"><div className="text-sm mb-2">Règlement de {x0.supplier || "fournisseur"} — {x0.label} — reste à payer <b className="tabular" data-testid="tr-dep-reste">{fmt(resteDep(x0))}</b></div>
          {(x0.settlements || []).length > 0 && (<div className="ec-wrap mb-2"><table className="ec-table"><tbody>{x0.settlements.map((s2) => (<tr key={s2.id} data-testid="tr-reg-ligne" style={{ opacity: s2.status === "annulé" ? 0.5 : 1 }}><td className="py-1.5">{ecDateFr(s2.date)}</td><td>{s2.mode === "banque" ? "Banque" : "Caisse"}</td><td className="text-right tabular">{fmt(s2.amount)}</td><td className="text-right">{s2.status === "annulé" ? ecPastille("Annulé", "neutre") : (canEdit && <button onClick={() => annulerRegDep(x0, s2)} className="text-xs" style={{ color: "#A6432F" }}>Annuler</button>)}</td></tr>))}</tbody></table></div>)}
          <div className="grid md:grid-cols-4 gap-2 items-end"><div><label className="text-xs" style={{ color: "#8A8370" }}>Montant (vide = tout le reste)</label><input type="number" min="0" step="0.01" value={rg.amount} onChange={(e) => setRg({ ...rg, amount: e.target.value })} data-testid="tr-reg-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={todayStr()} value={rg.date} onChange={(e) => setRg({ ...rg, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Payé par</label><select value={rg.mode} onChange={(e) => setRg({ ...rg, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Caisse</option><option value="banque">Banque</option></select></div>
            <button onClick={() => reglerDep(x0)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="tr-reg-valider">Enregistrer le règlement</button></div></div>) : null; })()}
        {dF.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{expenses.length === 0 ? "Aucune dépense." : "Aucune dépense ne correspond à ces filtres."}</div>}
      </div>
    );
  };

  // ───────── Tableau de bord ─────────
  const Apercu = () => {
    const invA = invoices.filter((i) => i.status !== "annulee");
    const mois = today.slice(0, 7);
    const caMois = trR2(invA.filter((i) => String(i.date).startsWith(mois)).reduce((s, i) => s + i.ht, 0));
    const encMois = trR2(invA.flatMap((i) => i.payments || []).filter((p) => p.status !== "annulé" && String(p.date).startsWith(mois)).reduce((s, p) => s + p.amount, 0));
    const depMois = trR2(expenses.filter((x) => x.status !== "annulé" && String(x.date).startsWith(mois)).reduce((s, x) => s + x.amount, 0));
    const dus = trR2(invA.reduce((s, i) => s + trSolde(i).reste, 0));
    const nbMois = trips.filter((t) => t.status !== "annule" && String(t.date).startsWith(mois)).length;
    const enRoute = trips.filter((t) => t.status === "encours").length;
    const afaire = [];
    vehicles.filter((v) => v.active !== false).forEach((v) => {
      (v.docs || []).forEach((d) => { const j = trJours(today, d.date); if (j <= 30) afaire.push({ tab: "vehicules", sel: v.id, nom: v.plate, txt: d.label + (j < 0 ? " échu(e) depuis le " : " à renouveler avant le ") + ecDateFr(d.date) }); });
      if (v.nextServiceDate && trJours(today, v.nextServiceDate) <= 15) afaire.push({ tab: "vehicules", sel: v.id, nom: v.plate, txt: "Entretien prévu le " + ecDateFr(v.nextServiceDate) });
      if (v.nextServiceKm > 0 && (Number(v.odometer) || 0) >= v.nextServiceKm) afaire.push({ tab: "vehicules", sel: v.id, nom: v.plate, txt: "Entretien à faire : compteur " + v.odometer + " km (prévu à " + v.nextServiceKm + " km)" });
    });
    drivers.filter((d) => d.active !== false && d.licenseExpiry && trJours(today, d.licenseExpiry) <= 30).forEach((d) => afaire.push({ tab: "chauffeurs", nom: d.name, txt: "Permis " + (d.licenseExpiry < today ? "échu depuis le " : "valable jusqu'au ") + ecDateFr(d.licenseExpiry) }));
    trips.filter((t) => t.status === "livre" && !t.invoiceId).forEach((t) => afaire.push({ tab: "voyages", nom: nomClient(t.clientId), txt: "Voyage " + t.number + " livré, pas encore facturé (" + fmt(t.price) + ")" }));
    invA.filter((i) => trSolde(i).reste > 0.004 && trJours(i.date, today) > 30).forEach((i) => afaire.push({ tab: "factures", sel: i.id, nom: nomClient(i.clientId), txt: "Facture " + i.number + " impayée depuis " + trJours(i.date, today) + " jours : reste " + fmt(trSolde(i).reste) }));
    const bientot = trips.filter((t) => (t.status === "planifie" || t.status === "encours") && t.date >= today && t.date <= trPlus(today, 7)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const etapes = [
      ["Véhicules", "Ajoutez vos véhicules (plaque, type, compteur) et leurs échéances : assurance, contrôle technique…", "vehicules", vehicles.length > 0],
      ["Chauffeurs", "Ajoutez vos chauffeurs avec la date de validité du permis.", "chauffeurs", drivers.length > 0],
      ["Clients", "Enregistrez vos clients (nom, téléphone, adresse).", "clients", clients.length > 0],
      ["Premier voyage", "Choisissez le client, le véhicule, le chauffeur, le trajet et le prix convenu ; imprimez le bordereau de transport.", "voyages", trips.length > 0],
      ["Voyage livré", "Passez le voyage à « Livré » quand la marchandise ou les passagers sont arrivés.", "voyages", trips.some((t) => t.status === "livre")],
      ["Première facture", "Dans Factures, choisissez le client : tous ses voyages livrés sont facturés ensemble.", "factures", invoices.length > 0],
      ["Premier encaissement", "Enregistrez le paiement du client : la comptabilité se fait automatiquement.", "factures", invA.some((i) => (i.payments || []).some((p) => p.status !== "annulé"))],
    ];
    const toutFait = etapes.every((e) => e[3]);
    const kpis = [["Voyages ce mois", String(nbMois), "tr-kpi-voyages"], ["Voyages en route", String(enRoute), "tr-kpi-enroute"], ["Facturé ce mois (hors taxe)", fmt(caMois), "tr-kpi-ca"], ["Encaissé ce mois", fmt(encMois), "tr-kpi-encaisse"], ["À recevoir des clients", fmt(dus), "tr-kpi-dus"], ["Dépenses ce mois", fmt(depMois), "tr-kpi-depenses"], ["Marge du mois", fmt(trR2(caMois - depMois)), "tr-kpi-marge"], ["Choses à faire", String(afaire.length), "tr-kpi-afaire"]];
    return (
      <div>
        {!toutFait && (<div className="ec-card p-4 mb-5" data-testid="tr-guide">
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Pour démarrer, en 7 étapes</div>
          <ol className="text-sm" style={{ color: "#152238", listStyle: "none", paddingLeft: 0 }}>{etapes.map(([t, d, tb, fait], i) => (<li key={i} data-testid="tr-etape" className="mb-1.5 flex flex-wrap gap-2 items-baseline"><span style={{ color: fait ? "#0F6B5C" : "#8A8370", fontWeight: 700 }}>{fait ? "✓" : (i + 1) + "."}</span><span><b>{t}</b> — <span style={{ color: "#5B563F" }}>{d}</span></span>{!fait && <button className="text-xs underline" data-testid="tr-etape-ouvrir" onClick={() => setTab(tb)}>Ouvrir</button>}</li>))}</ol>
        </div>)}
        {vehicles.length + trips.length === 0 && <div className="p-4 rounded text-sm mb-4" style={{ background: "#FFF6E0", color: "#152238" }} data-testid="tr-vide">Pour commencer : ajoutez vos <b>véhicules</b> et vos <b>chauffeurs</b>, enregistrez vos <b>clients</b>, puis créez votre premier <b>voyage</b>.</div>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {kpis.map(([l, v, t]) => (<div key={t} className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>{l}</div><div className="display text-lg tabular" data-testid={t} style={{ color: "#152238" }}>{v}</div></div>))}
        </div>
        <div className="display text-base mb-2" style={{ color: "#152238" }}>À faire</div>
        {afaire.length === 0 ? <div className="text-sm mb-5" style={{ color: "#8A8370" }}>Rien en attente.</div> : (
          <div className="ec-wrap mb-5"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Concerné</th><th>À faire</th><th></th></tr></thead>
            <tbody>{afaire.slice(0, 15).map((x, i) => (<tr key={i} data-testid="tr-afaire-ligne"><td className="py-1.5">{x.nom}</td><td>{x.txt}</td><td className="text-right"><button className="text-xs underline" data-testid="tr-afaire-ouvrir" onClick={() => { if (!canEdit && (x.tab === "vehicules" || x.tab === "chauffeurs")) return; setTab(x.tab); if (x.sel && x.tab === "vehicules") setSelVeh(x.sel); if (x.sel && x.tab === "factures") setSelInv(x.sel); }}>Ouvrir</button></td></tr>))}</tbody></table></div>
        )}
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Voyages des 7 prochains jours</div>
        {bientot.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucun voyage prévu.</div> : (
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Client</th><th>Trajet</th><th>Véhicule / chauffeur</th></tr></thead>
            <tbody>{bientot.map((t) => (<tr key={t.id} data-testid="tr-bientot-ligne"><td className="py-1.5">{ecDateFr(t.date)}</td><td>{nomClient(t.clientId)}</td><td className="text-xs">{t.from} → {t.to}</td><td className="text-xs">{nomVeh(t.vehicleId)} · {nomChauf(t.driverId)}</td></tr>))}</tbody></table></div>
        )}
      </div>
    );
  };

  // ───────── Rapports ─────────
  const [rd, setRd] = useState(""); const [rf, setRf] = useState("");
  const Rapports = () => {
    const dansP = (d) => (!rd || d >= rd) && (!rf || d <= rf);
    const invP = invoices.filter((i) => i.status !== "annulee" && dansP(i.date));
    const depP = expenses.filter((x) => x.status !== "annulé" && dansP(x.date));
    const tripP = trips.filter((t) => t.status === "livre" && dansP(t.date));
    const S = (arr, f) => trR2(arr.reduce((t, x) => t + f(x), 0));
    const tf = { fontWeight: 600, borderTop: "2px solid #152238" };
    const caDe = (pred) => S(invP.flatMap((i) => (i.lines || []).filter((l) => { const t = trips.find((x) => x.id === l.tripId); return t && pred(t); })), (l) => l.amount);
    const parVeh = vehicles.map((v) => { const ca = caDe((t) => t.vehicleId === v.id); const dep = S(depP.filter((x) => x.vehicleId === v.id), (x) => x.amount); const km = S(tripP.filter((t) => t.vehicleId === v.id), (t) => t.km || 0); return { v, ca, dep, marge: trR2(ca - dep), km, coutKm: km > 0 ? trR2(dep / km) : 0 }; });
    const parChauf = drivers.map((d) => ({ d, n: tripP.filter((t) => t.driverId === d.id).length, km: S(tripP.filter((t) => t.driverId === d.id), (t) => t.km || 0), ca: caDe((t) => t.driverId === d.id) }));
    const parCli = clients.map((c) => { const mine = invP.filter((i) => i.clientId === c.id); const fact = S(mine, (i) => i.total); const enc = S(mine, (i) => trSolde(i).paye); return { c, fact, enc, reste: trR2(fact - enc), b0: S(mine.filter((i) => trJours(i.date, today) <= 30), (i) => trSolde(i).reste), b1: S(mine.filter((i) => trJours(i.date, today) > 30 && trJours(i.date, today) <= 60), (i) => trSolde(i).reste), b2: S(mine.filter((i) => trJours(i.date, today) > 60), (i) => trSolde(i).reste) }; }).filter((x) => x.fact > 0);
    const parNature = TR_DEPENSES.map(([k, l]) => ({ l, n: depP.filter((x) => x.kind === k).length, m: S(depP.filter((x) => x.kind === k), (x) => x.amount) })).filter((x) => x.n > 0);
    const exporterVeh = () => ecTelecharger("rentabilite-vehicules-" + today + ".csv", [["Plaque", "Chiffre d'affaires HT", "Dépenses", "Marge", "Km livrés", "Coût au km"], ...parVeh.map((x) => [x.v.plate, x.ca, x.dep, x.marge, x.km, x.coutKm]), ["Total", S(parVeh, (x) => x.ca), S(parVeh, (x) => x.dep), S(parVeh, (x) => x.marge), S(parVeh, (x) => x.km), ""]]);
    const exporterCli = () => ecTelecharger("clients-transport-" + today + ".csv", [["Client", "Facturé", "Encaissé", "Reste à payer"], ...parCli.map((x) => [x.c.name, x.fact, x.enc, x.reste]), ["Total", S(parCli, (x) => x.fact), S(parCli, (x) => x.enc), S(parCli, (x) => x.reste)]]);
    return (
      <div>
        <div className="flex flex-wrap gap-2 items-end mb-4">
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Du</label><input type="date" value={rd} onChange={(e) => setRd(e.target.value)} data-testid="tr-rapport-du" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Au</label><input type="date" value={rf} onChange={(e) => setRf(e.target.value)} data-testid="tr-rapport-au" className={ecInput} style={ecBorder} /></div>
          {(rd || rf) && <button className="text-xs underline" onClick={() => { setRd(""); setRf(""); }}>Tout afficher</button>}
          <div className="text-xs" style={{ color: "#7A7460" }}>Le filtre porte sur la date des factures, des dépenses et des voyages.</div>
        </div>
        <div className="flex items-center justify-between mb-2"><div className="display text-base" style={{ color: "#152238" }}>Rentabilité par véhicule</div><button onClick={exporterVeh} className="text-xs underline" data-testid="tr-rapport-export-veh">Exporter</button></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Véhicule</th><th className="text-right">Chiffre d'affaires</th><th className="text-right">Dépenses</th><th className="text-right">Marge</th><th className="text-right">Km livrés</th><th className="text-right">Coût au km</th></tr></thead>
          <tbody>{parVeh.map((x) => (<tr key={x.v.id} data-testid="tr-rapport-veh"><td className="py-1.5">{x.v.plate}</td><td className="text-right tabular">{fmt(x.ca)}</td><td className="text-right tabular">{fmt(x.dep)}</td><td className="text-right tabular">{fmt(x.marge)}</td><td className="text-right tabular">{x.km}</td><td className="text-right tabular">{x.km > 0 ? fmt(x.coutKm) : "—"}</td></tr>))}</tbody>
          {parVeh.length > 0 && <tfoot><tr style={tf} data-testid="tr-rapport-veh-total"><td>Total</td><td className="text-right tabular" data-testid="tr-rapport-veh-tot-ca">{fmt(S(parVeh, (x) => x.ca))}</td><td className="text-right tabular" data-testid="tr-rapport-veh-tot-dep">{fmt(S(parVeh, (x) => x.dep))}</td><td className="text-right tabular" data-testid="tr-rapport-veh-tot-marge">{fmt(S(parVeh, (x) => x.marge))}</td><td className="text-right tabular">{S(parVeh, (x) => x.km)}</td><td></td></tr></tfoot>}</table></div>
        <div className="display text-base mb-2 mt-5" style={{ color: "#152238" }}>Dépenses par nature</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Nature</th><th className="text-right">Opérations</th><th className="text-right">Montant</th></tr></thead>
          <tbody>{parNature.map((x) => (<tr key={x.l} data-testid="tr-rapport-nature"><td className="py-1.5">{x.l}</td><td className="text-right tabular">{x.n}</td><td className="text-right tabular">{fmt(x.m)}</td></tr>))}</tbody>
          {parNature.length > 0 && <tfoot><tr style={tf}><td>Total</td><td className="text-right tabular">{S(parNature, (x) => x.n)}</td><td className="text-right tabular" data-testid="tr-rapport-nature-tot">{fmt(S(parNature, (x) => x.m))}</td></tr></tfoot>}</table></div>
        <div className="display text-base mb-2 mt-5" style={{ color: "#152238" }}>Par chauffeur</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Chauffeur</th><th className="text-right">Voyages livrés</th><th className="text-right">Km</th><th className="text-right">Chiffre d'affaires</th></tr></thead>
          <tbody>{parChauf.map((x) => (<tr key={x.d.id} data-testid="tr-rapport-chauf"><td className="py-1.5">{x.d.name}</td><td className="text-right tabular">{x.n}</td><td className="text-right tabular">{x.km}</td><td className="text-right tabular">{fmt(x.ca)}</td></tr>))}</tbody>
          {parChauf.length > 0 && <tfoot><tr style={tf}><td>Total</td><td className="text-right tabular">{S(parChauf, (x) => x.n)}</td><td className="text-right tabular">{S(parChauf, (x) => x.km)}</td><td className="text-right tabular">{fmt(S(parChauf, (x) => x.ca))}</td></tr></tfoot>}</table></div>
        <div className="flex items-center justify-between mb-2 mt-5"><div className="display text-base" style={{ color: "#152238" }}>Clients : facturé, encaissé, reste à payer</div><button onClick={exporterCli} className="text-xs underline" data-testid="tr-rapport-export-cli">Exporter</button></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Client</th><th className="text-right">Facturé</th><th className="text-right">Encaissé</th><th className="text-right">0 à 30 j</th><th className="text-right">31 à 60 j</th><th className="text-right">Plus de 60 j</th><th className="text-right">Reste à payer</th></tr></thead>
          <tbody>{parCli.map((x) => (<tr key={x.c.id} data-testid="tr-rapport-cli"><td className="py-1.5">{x.c.name}</td><td className="text-right tabular">{fmt(x.fact)}</td><td className="text-right tabular">{fmt(x.enc)}</td><td className="text-right tabular">{fmt(x.b0)}</td><td className="text-right tabular">{fmt(x.b1)}</td><td className="text-right tabular">{fmt(x.b2)}</td><td className="text-right tabular">{fmt(x.reste)}</td></tr>))}</tbody>
          {parCli.length > 0 && <tfoot><tr style={tf} data-testid="tr-rapport-cli-total"><td>Total</td><td className="text-right tabular" data-testid="tr-rapport-cli-tot-fact">{fmt(S(parCli, (x) => x.fact))}</td><td className="text-right tabular">{fmt(S(parCli, (x) => x.enc))}</td><td className="text-right tabular">{fmt(S(parCli, (x) => x.b0))}</td><td className="text-right tabular">{fmt(S(parCli, (x) => x.b1))}</td><td className="text-right tabular">{fmt(S(parCli, (x) => x.b2))}</td><td className="text-right tabular" data-testid="tr-rapport-cli-tot-reste">{fmt(S(parCli, (x) => x.reste))}</td></tr></tfoot>}</table></div>
      </div>
    );
  };

  // ───────── Statistiques ─────────
  const Stats = () => {
    const invA = invoices.filter((i) => i.status !== "annulee");
    const depA = expenses.filter((x) => x.status !== "annulé");
    const caT = trR2(invA.reduce((s, i) => s + i.ht, 0));
    const depT = trR2(depA.reduce((s, x) => s + x.amount, 0));
    const mois = statMois(6, today);
    const data = mois.map((m) => ({ mois: m.label, ca: statSomme(invA, "date", m.key, (i) => i.ht), dep: statSomme(depA, "date", m.key, (x) => x.amount) }));
    const parVeh = {}; invA.forEach((i) => (i.lines || []).forEach((l) => { const t = trips.find((x) => x.id === l.tripId); const k = t ? nomVeh(t.vehicleId) : "—"; parVeh[k] = trR2((parVeh[k] || 0) + l.amount); }));
    const parNat = {}; depA.forEach((x) => { const k = (TR_DEPENSES.find((d) => d[0] === x.kind) || [0, x.kind])[1]; parNat[k] = trR2((parNat[k] || 0) + x.amount); });
    const parCli = {}; invA.forEach((i) => { const k = nomClient(i.clientId); parCli[k] = trR2((parCli[k] || 0) + i.ht); });
    const parEtat = {}; trips.forEach((t) => { const k = (TR_STATUTS.find((s) => s[0] === t.status) || [0, t.status])[1]; parEtat[k] = (parEtat[k] || 0) + 1; });
    const parChauf = {}; trips.filter((t) => t.status === "livre").forEach((t) => { const k = nomChauf(t.driverId); parChauf[k] = (parChauf[k] || 0) + 1; });
    return <StatsBloc
      vide={trips.length + invoices.length === 0 ? "Aucun voyage pour le moment : les statistiques apparaîtront avec vos premiers voyages et factures." : ""}
      kpis={[["Voyages livrés", String(trips.filter((t) => t.status === "livre").length), "tr-stat-livres"], ["Chiffre d'affaires (hors taxe)", fmt(caT), "tr-stat-ca"], ["Dépenses des véhicules", fmt(depT), "tr-stat-dep"], ["Marge", fmt(trR2(caT - depT)), "tr-stat-marge"]]}
      evolution={{ titre: "Chiffre d'affaires et dépenses — 6 derniers mois", data, series: [{ key: "ca", name: "Chiffre d'affaires", color: "#0F6B5C" }, { key: "dep", name: "Dépenses", color: "#9A7B1E" }] }}
      repartitions={[{ titre: "Chiffre d'affaires par véhicule", data: Object.keys(parVeh).map((k) => ({ name: k, value: parVeh[k] })) }, { titre: "Dépenses par nature", data: Object.keys(parNat).map((k) => ({ name: k, value: parNat[k] })) }, { titre: "Chiffre d'affaires par client", data: Object.keys(parCli).map((k) => ({ name: k, value: parCli[k] })) }, { titre: "Voyages par état", unite: "nombre", data: Object.keys(parEtat).map((k) => ({ name: k, value: parEtat[k] })) }, { titre: "Voyages livrés par chauffeur", unite: "nombre", data: Object.keys(parChauf).map((k) => ({ name: k, value: parChauf[k] })) }]} />;
  };

  const tabs = isVendeur
    ? [["apercu", "Tableau de bord"], ["voyages", "Voyages"], ["clients", "Clients"], ["factures", "Factures"]]
    : [["apercu", "Tableau de bord"], ["voyages", "Voyages"], ["vehicules", "Véhicules"], ["chauffeurs", "Chauffeurs"], ["clients", "Clients"], ["factures", "Factures"], ["depenses", "Dépenses"], ["rapports", "Rapports"], ["stats", "Statistiques"]];
  const imprDoc = (() => {
    if (!imprimer) return null;
    if (imprimer.kind === "facture") { const inv = invoices.find((x) => x.id === imprimer.id); return inv ? { titre: "Facture " + inv.number, node: <FactureSheet inv={inv} />, ticket: true } : null; }
    const t = trips.find((x) => x.id === imprimer.id);
    return t ? { titre: "Bordereau " + t.number, node: <BordereauSheet t={t} />, ticket: false } : null;
  })();
  return (
    <>
      {listes}
      <div className={"p-4 md:p-8 max-w-6xl" + (imprDoc ? " no-print" : "")} data-testid="transport-module">
        <style>{EC_CSS + '[data-testid="transport-module"] .display.text-base{border-left:3px solid #C9A24B;padding-left:10px;margin-bottom:12px}[data-testid="transport-module"] input,[data-testid="transport-module"] select{background:#fff}'}</style>
        <div className="mb-4"><div className="display text-2xl" style={{ color: "#152238" }}>Transport et logistique</div><div className="text-xs" style={{ color: "#8A8370" }}>Véhicules, chauffeurs, voyages, factures, dépenses et rentabilité par véhicule</div></div>
        {!canFront && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }}>Consultation seule : votre rôle ne permet pas de modifier les données.</div>}
        {isVendeur && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }} data-testid="tr-regulation-note">Régulation : vous pouvez enregistrer les clients et les voyages, suivre leur état, facturer et encaisser. Véhicules, chauffeurs, dépenses, annulations et rapports sont réservés au responsable.</div>}
        <div className="ec-tabs">
          {tabs.map(([id, l]) => (<button key={id} onClick={() => setTab(id)} data-testid={"tr-tab-" + id} className="px-3 py-2 text-sm rounded-lg transition-colors" style={{ background: tab === id ? "#152238" : "transparent", color: tab === id ? "#EFE9DD" : "#6B6552", fontWeight: tab === id ? 600 : 500 }}>{l}</button>))}
        </div>
        {tab === "apercu" && Apercu()}
        {tab === "voyages" && Voyages()}
        {tab === "vehicules" && !isVendeur && Vehicules()}
        {tab === "chauffeurs" && !isVendeur && Chauffeurs()}
        {tab === "clients" && Clients()}
        {tab === "factures" && Factures()}
        {tab === "depenses" && !isVendeur && Depenses()}
        {tab === "rapports" && !isVendeur && Rapports()}
        {tab === "stats" && !isVendeur && Stats()}
      </div>
      {imprDoc && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto p-3 md:p-8 no-print" style={{ background: "rgba(21,34,56,0.55)" }} onClick={() => setImprimer(null)} data-testid="tr-apercu">
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: imprDoc.ticket && tk ? 340 : 820 }}>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap"><div className="text-sm" style={{ color: "#EFE9DD" }}>{imprDoc.titre}</div>
              <div className="flex gap-2 flex-wrap">
                {imprDoc.ticket && <button onClick={() => setTk(!tk)} className="px-3 py-1.5 rounded text-sm" style={ecBtn} data-testid="tr-format">{tk ? "Passer en A4" : "Passer en ticket"}</button>}
                <button onClick={() => { try { window.print(); } catch (e) {} }} className="px-3 py-1.5 rounded text-sm" style={ecBtnGold} data-testid="tr-imprimer-ok">Imprimer / enregistrer en PDF</button>
                <button onClick={() => setImprimer(null)} className="px-3 py-1.5 rounded text-sm" style={ecBtn} data-testid="tr-apercu-fermer">Fermer</button></div></div>
            <div className="rounded shadow-lg overflow-hidden" style={{ background: "#fff" }}>{imprDoc.node}</div>
          </div>
        </div>
      )}
      {imprDoc && <div className={"print-only" + (imprDoc.ticket && tk ? " ticket-print-80" : "")}>{imprDoc.node}</div>}
    </>
  );
}

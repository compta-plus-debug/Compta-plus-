// ═══ MODULE ═══
// @module Services
// @depends CURRENCIES, CURRENT_CURRENCY, EC_CSS, Plus, StatsBloc, ecBorder, ecBtn, ecBtnGold, ecDateFr
//   ecInput, ecPastille, ecTelecharger, isFutureDate, isLocked, statMois, statSomme, todayStr, uid
//   useBrouillon, useState
// @exports ServicesModule
// ═══ FIN DE L'EN-TÊTE ═══
// Bloc Services et prestations : sécurité privée et gardiennage, clubs, discothèques et événementiel, salons de coiffure et de beauté, nettoyage et entretien,
// conseil, formation et agences, réparation et maintenance, autres services. Catalogue de prestations, clients, factures de prestations (au comptant ou à crédit)
// avec encaissements, contrats mensuels facturés en un clic, dépenses avec règlement des dettes, rapports (chiffre d'affaires, créances âgées, résultat), statistiques.
// Rien n'est préréglé : prix, quantités, taux de taxe, dates et contrats sont saisis par l'entreprise.
//
// Comptabilité (tout en gourdes) :
//  • facture au comptant : Débit caisse ou banque / Crédit 706 (prestations, hors taxe) et 445 (taxe, seulement si activée) ;
//  • facture à crédit : Débit 411 / Crédit 706 et 445 ; encaissement : Débit caisse ou banque / Crédit 411 ;
//  • dépense : Débit 601, 611, 622, 618, 6133, 6056, 6231, 6322 ou 628 selon la nature / Crédit caisse, banque ou 401 (à payer) ; règlement : Débit 401 / Crédit caisse ou banque ;
//  • le personnel salarié se paie par le module Salaires (aucune écriture ici) ;
//  • toute annulation passe une écriture inverse.
// Les comptes 706, 445, 601, 611, 622, 618, 6133, 6056, 6231, 6322 et 628 sont à confirmer avec l'expert-comptable. Ce module aide à tenir les comptes : il ne remplace
// ni l'expert-comptable ni les avis des autorités (déclarations, taxes, licences et autorisations propres à chaque métier).

const SV_TYPES = [["securite", "Sécurité privée et gardiennage"], ["loisirs", "Club, discothèque, bar, événementiel"], ["beaute", "Salon de coiffure, beauté, bien-être"], ["nettoyage", "Nettoyage, entretien, jardinage"], ["conseil", "Conseil, formation, agence, cabinet"], ["atelier", "Réparation, maintenance, installation"], ["autre", "Autre service"]];
const SV_VOC = {
  securite: { clients: "Clients (sociétés, résidences, événements)", interv: "Agent ou équipe", exPrest: "Gardiennage de nuit, Patrouille, Surveillance d'événement…", unit: "mois", guideContrat: "Les gardiennages mensuels se facturent avec un contrat : un clic par mois." },
  loisirs: { clients: "Clients et organisateurs", interv: "DJ, artiste ou responsable de soirée", exPrest: "Entrée, Table réservée, Location de salle, Soirée privée…", unit: "soirée", guideContrat: "Les locations ou partenariats réguliers (bar, salle) se facturent avec un contrat mensuel." },
  beaute: { clients: "Clientèle", interv: "Coiffeur(se), esthéticien(ne)", exPrest: "Coupe, Tresses, Soin du visage, Manucure…", unit: "séance", guideContrat: "Les abonnements ou forfaits mensuels se facturent avec un contrat." },
  nettoyage: { clients: "Clients (maisons, bureaux, entreprises)", interv: "Équipe ou employé", exPrest: "Nettoyage de bureau, Entretien de jardin, Nettoyage après chantier…", unit: "mois", guideContrat: "Les entretiens réguliers se facturent avec un contrat : un clic par mois." },
  conseil: { clients: "Clients", interv: "Consultant ou formateur", exPrest: "Consultation, Formation d'une journée, Conception d'un site, Étude…", unit: "heure", guideContrat: "Les missions d'abonnement ou d'assistance mensuelle se facturent avec un contrat." },
  atelier: { clients: "Clients", interv: "Technicien", exPrest: "Réparation, Installation, Entretien annuel, Dépannage…", unit: "intervention", guideContrat: "Les contrats d'entretien se facturent avec un contrat mensuel." },
  autre: { clients: "Clients", interv: "Intervenant", exPrest: "Votre prestation, vendue à l'heure, à la séance ou au forfait…", unit: "forfait", guideContrat: "Les prestations récurrentes se facturent avec un contrat mensuel." },
};
const SV_UNITES = [["heure", "Heure"], ["jour", "Jour"], ["mois", "Mois"], ["séance", "Séance"], ["soirée", "Soirée"], ["intervention", "Intervention"], ["personne", "Personne"], ["forfait", "Forfait"], ["pièce", "Pièce ou unité"]];
const SV_DEPENSES = [["fournitures", "Fournitures et produits consommables", "601"], ["soustraitance", "Sous-traitance et intervenants externes", "611"], ["location", "Location de matériel et d'équipement", "622"], ["transport", "Transport et carburant", "618"], ["loyer", "Loyer des locaux", "6133"], ["energie", "Eau, électricité et énergie", "6056"], ["communication", "Communication et publicité", "6231"], ["honoraires", "Honoraires (comptable, juriste, autres)", "6322"], ["salarie", "Personnel salarié (déjà payé par Salaires, sans écriture)", ""], ["autre", "Autres frais", "628"]];
const SV_LIB_DEP = {
  securite: { fournitures: "Uniformes, radios et équipement", soustraitance: "Agents ou sociétés partenaires (sous-traitance)" },
  loisirs: { fournitures: "Boissons, consommables et décoration", soustraitance: "Artistes, DJ et prestataires de soirée", location: "Sono, éclairage et matériel de soirée" },
  beaute: { fournitures: "Produits et fournitures de soins", location: "Location de fauteuil ou de cabine" },
  nettoyage: { fournitures: "Produits d'entretien et petit matériel" },
  conseil: { soustraitance: "Consultants et formateurs externes", fournitures: "Fournitures de bureau et licences" },
  atelier: { fournitures: "Pièces et consommables" },
  autre: {},
};
const SV_COMPTES = {
  "411": { name: "Clients", type: "Actif" },
  "401": { name: "Fournisseurs", type: "Passif" },
  "445": { name: "Taxe collectée sur ventes (IVA/TCA)", type: "Passif" },
  "706": { name: "Prestations de services", type: "Produit" },
  "601": { name: "Fournitures et produits consommables", type: "Charge" },
  "611": { name: "Sous-traitance générale", type: "Charge" },
  "622": { name: "Locations de matériel et d'équipement", type: "Charge" },
  "618": { name: "Transports et carburant", type: "Charge" },
  "6133": { name: "Loyer des locaux", type: "Charge" },
  "6056": { name: "Eau, électricité et énergie", type: "Charge" },
  "6231": { name: "Communication et publicité", type: "Charge" },
  "6322": { name: "Honoraires", type: "Charge" },
  "628": { name: "Autres frais", type: "Charge" },
  "512": { name: "Banque", type: "Actif" },
  "530": { name: "Caisse", type: "Actif" },
};
const svR2 = (n) => { const v = Math.round((Number(n) || 0) * 100) / 100; return Number.isFinite(v) && Math.abs(v) <= 1e11 ? v : 0; };
const svQ = (n) => { const v = Math.round((Number(n) || 0) * 1000) / 1000; return Number.isFinite(v) && v > 0 && v <= 1e7 ? v : 0; };
const svId = () => String(uid());
const svRows = (rows, type) => (rows || []).filter((r) => r && r.type === type);
const svNom = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const svJours = (a, b) => (a && b ? Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000) : 0);
const svPaye = (arr) => svR2((arr || []).filter((p) => p.status !== "annulé").reduce((s, p) => s + p.amount, 0));
const svMois = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const svLibMois = (ym) => svMois[Number(ym.slice(5, 7)) - 1] + " " + ym.slice(0, 4);
const svFinMois = (ym) => { const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)); return ym + "-" + String(new Date(y, m, 0).getDate()).padStart(2, "0"); };
const svM = (n) => {
  const code = CURRENT_CURRENCY;
  const locale = (CURRENCIES[code] && CURRENCIES[code].locale) || "fr-FR";
  const v = svR2(n);
  const d = Math.abs(v - Math.round(v)) < 0.005 ? 0 : 2;
  try { return new Intl.NumberFormat(locale, { style: "currency", currency: code, minimumFractionDigits: d, maximumFractionDigits: d }).format(v); } catch (e) { return v.toFixed(d) + " " + code; }
};
function svAjouterComptes(accounts, setAccounts, codes) {
  const missing = [...new Set(codes)].filter((k) => SV_COMPTES[k] && !accounts.some((a) => a.code === k)).map((k) => ({ code: k, name: SV_COMPTES[k].name, type: SV_COMPTES[k].type }));
  if (missing.length) setAccounts((prev) => [...prev, ...missing.filter((m) => !prev.some((a) => a.code === m.code))]);
}

function ServicesModule({ suppliers, services, setServices, entries, setEntries, accounts, setAccounts, settings, role, showToast, logAudit, currentUserEmail }) {
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const isVendeur = role === "Vendeur"; // caisse : clients, factures de prestations, encaissements
  const canFront = canEdit || isVendeur;
  const today = todayStr();
  const moisCourant = today.slice(0, 7);
  const [tab, setTab] = useState("apercu");
  const clients = svRows(services, "client");
  const catalogue = svRows(services, "prest");
  const ventes = svRows(services, "vente");
  const contrats = svRows(services, "contrat");
  const deps = svRows(services, "dep");
  const cfg = svRows(services, "config")[0] || {};
  const svType = cfg.svType || "";
  const V = SV_VOC[svType || "autre"];
  const tcaRate = cfg.tcaOn ? Math.max(0, Math.min(100, Number(settings && settings.taxRate) || 0)) : 0;
  const ventesOk = ventes.filter((v) => v.status !== "annulé");
  const depsOk = deps.filter((d) => d.status !== "annulé");
  const compteMode = (m) => (m === "banque" ? "512" : m === "credit" || m === "apayer" ? (m === "credit" ? "411" : "401") : "530");
  const maj = (id, fn) => setServices((prev) => (prev || []).map((r) => (r.id === id ? fn(r) : r)));
  // Copie toujours à jour : deux clics rapides ne passent plus le contrôle des doublons avant la mise à jour de l'écran.
  const svRef = React.useRef(services || []);
  svRef.current = services || [];
  const lignesAJour = (type) => svRows(svRef.current, type);
  const ajouter = (rec) => { svRef.current = [...svRef.current, rec]; setServices((prev) => ((prev || []).some((r) => r && r.id === rec.id) ? prev : [...(prev || []), rec])); };
  const ecrire = (date, label, lines, dossierId) => {
    const e = { id: uid(), date, createdAt: new Date().toISOString(), label, lines: lines.filter((l) => l.debit > 0 || l.credit > 0), kind: "services", dossierId };
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
  const numero = (rows, date) => {
    const yy = String((date || today).slice(0, 4));
    const n = rows.filter((r) => String(r.number || "").startsWith("FS-" + yy + "-")).reduce((m, r) => Math.max(m, Number(String(r.number).split("-")[2]) || 0), 0) + 1;
    return "FS-" + yy + "-" + String(n).padStart(4, "0");
  };
  const choisirType = (t) => {
    if (!canEdit) return;
    if (cfg.id) maj(cfg.id, (r) => ({ ...r, svType: t })); else ajouter({ type: "config", id: svId(), svType: t });
    logAudit("Services et prestations", "Type d'activité", (SV_TYPES.find((x) => x[0] === t) || [0, t])[1]);
  };
  const basculerTca = () => {
    if (!canEdit) return;
    if (cfg.id) maj(cfg.id, (r) => ({ ...r, tcaOn: !r.tcaOn })); else ajouter({ type: "config", id: svId(), tcaOn: true });
    logAudit("Services et prestations", "Taxe sur les factures", cfg.tcaOn ? "désactivée" : "activée (" + (Number(settings && settings.taxRate) || 0) + " %)");
  };
  const nomClient = (v) => (v.clientId ? ((clients.find((c) => c.id === v.clientId) || {}).name || "—") : (v.clientName || "Client de passage"));
  const natureDep = (k) => ((SV_LIB_DEP[svType || "autre"] || {})[k]) || (SV_DEPENSES.find((r) => r[0] === k) || [0, k])[1];
  const kindsDep = SV_DEPENSES.map((r) => [r[0], natureDep(r[0])]);
  const resteVente = (v) => svR2(v.mode === "credit" ? v.total - svPaye(v.settlements) : 0);
  const resteDep = (d) => svR2(d.mode === "apayer" ? d.amount - svPaye(d.settlements) : 0);
  const rechercher = (txt, q) => !q.trim() || txt.toLowerCase().includes(q.trim().toLowerCase());
  const listes = (<><datalist id="sv-dl-fourn">{[...new Set([...(suppliers || []).map((s) => s.name), ...deps.map((d) => d.supplier)].map((x) => String(x || "").trim()).filter(Boolean))].sort().map((n) => <option key={n} value={n} />)}</datalist><datalist id="sv-dl-interv">{[...new Set([...ventes.map((v) => v.interv), ...contrats.map((c) => c.interv)].map((x) => String(x || "").trim()).filter(Boolean))].sort().map((n) => <option key={n} value={n} />)}</datalist></>);
  const [imprimer, setImprimer] = useState(null);
  const totaux = (lines) => {
    const ht = svR2(lines.reduce((s, l) => s + svR2(svQ(l.qty) * svR2(l.pu)), 0));
    const tca = svR2(ht * tcaRate / 100);
    return { ht, tca, total: svR2(ht + tca) };
  };

  // ───────── Clients ─────────
  const [fcl, setFcl] = useBrouillon("sv-client", { name: "", kind: "particulier", phone: "", email: "", address: "" });
  const [cq, setCq] = useState("");
  const ajouterClient = () => {
    if (!canFront) return;
    const name = fcl.name.trim();
    if (!name) { showToast("Indiquez le nom du client."); return; }
    if (lignesAJour("client").some((c) => svNom(c.name) === svNom(name))) { showToast("Un client de ce nom existe déjà."); return; }
    ajouter({ type: "client", id: svId(), name, kind: fcl.kind, phone: fcl.phone.trim(), email: fcl.email.trim(), address: fcl.address.trim() });
    setFcl({ ...fcl, name: "", phone: "", email: "", address: "" }); showToast("« " + name + " » ajouté."); logAudit("Services et prestations", "Client ajouté", name);
  };
  const retirerClient = (c) => {
    if (!canEdit) return;
    if (ventes.some((v) => v.clientId === c.id) || contrats.some((k) => k.clientId === c.id)) { showToast("Ce client a des factures ou des contrats : il ne peut pas être retiré."); return; }
    setServices((prev) => (prev || []).filter((r) => !(r && r.type === "client" && r.id === c.id)));
    svRef.current = svRef.current.filter((r) => !(r && r.type === "client" && r.id === c.id));
    showToast("« " + c.name + " » retiré."); logAudit("Services et prestations", "Client retiré", c.name);
  };
  const Clients = () => {
    const rows = clients.filter((c) => rechercher([c.name, c.phone, c.email].join(" "), cq)).sort((a, b) => a.name.localeCompare(b.name));
    return (
      <div>
        {canFront && (<div className="ec-card p-4 mb-5" data-testid="sv-client-form"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouveau client</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom</label><input value={fcl.name} onChange={(e) => setFcl({ ...fcl, name: e.target.value })} data-testid="sv-client-nom" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Sorte</label><select value={fcl.kind} onChange={(e) => setFcl({ ...fcl, kind: e.target.value })} className={ecInput} style={ecBorder}><option value="particulier">Particulier</option><option value="entreprise">Entreprise ou organisation</option></select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Téléphone</label><input value={fcl.phone} onChange={(e) => setFcl({ ...fcl, phone: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Courriel</label><input value={fcl.email} onChange={(e) => setFcl({ ...fcl, email: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Adresse</label><input value={fcl.address} onChange={(e) => setFcl({ ...fcl, address: e.target.value })} className={ecInput} style={ecBorder} /></div>
          </div>
          <button onClick={ajouterClient} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="sv-client-ajouter">Ajouter</button></div>)}
        <div className="ec-card p-4"><div className="flex flex-wrap gap-2 items-end mb-2"><div className="display text-base" style={{ color: "#152238" }}>{V.clients} ({clients.length})</div>
          <input value={cq} onChange={(e) => setCq(e.target.value)} placeholder="Rechercher (nom, téléphone, courriel)" className={ecInput + " md:w-72"} style={ecBorder} data-testid="sv-client-recherche" /></div>
          {rows.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucun client. Une facture peut aussi être faite pour un client de passage, sans le créer.</div> : (
            <div>{rows.map((c, i) => { const mine = ventesOk.filter((v) => v.clientId === c.id); const du = svR2(mine.reduce((s, v) => s + resteVente(v), 0)); return (<div key={c.id} data-testid="sv-client-ligne" className="py-2 text-sm" style={{ borderTop: i > 0 ? "1px solid #F3EFE3" : "none", overflowWrap: "anywhere" }}>
              <div className="flex flex-wrap justify-between gap-2"><span><b>{c.name}</b> <span className="text-xs" style={{ color: "#8A8370" }}>· {c.kind === "entreprise" ? "Entreprise ou organisation" : "Particulier"}</span></span><span className="tabular">{mine.length} facture(s) · <b>{svM(mine.reduce((s, v) => s + v.total, 0))}</b>{du > 0.004 ? " · à encaisser " + svM(du) : ""}</span></div>
              <div className="text-xs" style={{ color: "#8A8370" }}>{[c.phone, c.email, c.address].filter(Boolean).join(" · ") || "—"}{canEdit && mine.length === 0 && !contrats.some((k) => k.clientId === c.id) && <button className="underline ml-2" style={{ color: "#A6432F" }} onClick={() => retirerClient(c)} data-testid="sv-client-retirer">Retirer</button>}</div></div>); })}</div>)}
        </div>
      </div>
    );
  };

  // ───────── Catalogue de prestations ─────────
  const [fp, setFp] = useBrouillon("sv-prest", { name: "", unit: "", price: "" });
  const ajouterPrest = () => {
    if (!canEdit) return;
    const name = fp.name.trim();
    const price = svR2(fp.price);
    if (!name) { showToast("Indiquez le nom de la prestation."); return; }
    if (!(price > 0) || fp.price === "") { showToast("Indiquez un prix valide (en gourdes, au plus 100 milliards)."); return; }
    if (lignesAJour("prest").some((p) => svNom(p.name) === svNom(name))) { showToast("Une prestation de ce nom existe déjà."); return; }
    ajouter({ type: "prest", id: svId(), name, unit: fp.unit || V.unit, price, active: true });
    setFp({ ...fp, name: "", price: "" }); showToast("Prestation « " + name + " » ajoutée."); logAudit("Services et prestations", "Prestation ajoutée", name + " — " + svM(price));
  };
  const basculerPrest = (p) => { if (canEdit) maj(p.id, (r) => ({ ...r, active: r.active === false })); };
  const retirerPrest = (p) => {
    if (!canEdit) return;
    if (ventes.some((v) => (v.lines || []).some((l) => l.prestId === p.id))) { showToast("Cette prestation figure sur des factures : désactivez-la plutôt."); return; }
    setServices((prev) => (prev || []).filter((r) => !(r && r.type === "prest" && r.id === p.id)));
    svRef.current = svRef.current.filter((r) => !(r && r.type === "prest" && r.id === p.id));
    showToast("Prestation retirée.");
  };
  const Prestations = () => (
    <div>
      {canEdit && (<div className="ec-card p-4 mb-5" data-testid="sv-prest-form"><div className="display text-base mb-1" style={{ color: "#152238" }}>Nouvelle prestation</div>
        <div className="text-xs mb-2" style={{ color: "#8A8370" }}>Exemples : {V.exPrest} Le prix reste modifiable sur chaque facture.</div>
        <div className="grid md:grid-cols-4 gap-2 items-end">
          <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom</label><input value={fp.name} onChange={(e) => setFp({ ...fp, name: e.target.value })} data-testid="sv-prest-nom" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Vendue par</label><select value={fp.unit || V.unit} onChange={(e) => setFp({ ...fp, unit: e.target.value })} data-testid="sv-prest-unite" className={ecInput} style={ecBorder}>{SV_UNITES.map((u) => <option key={u[0]} value={u[0]}>{u[1]}</option>)}</select></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Prix (G)</label><input type="number" min="0" step="0.01" value={fp.price} onChange={(e) => setFp({ ...fp, price: e.target.value })} data-testid="sv-prest-prix" className={ecInput + " tabular"} style={ecBorder} /></div>
        </div>
        <button onClick={ajouterPrest} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="sv-prest-ajouter">Ajouter</button></div>)}
      <div className="ec-card p-4"><div className="display text-base mb-2" style={{ color: "#152238" }}>Mes prestations ({catalogue.length})</div>
        {catalogue.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucune prestation. Vous pouvez aussi facturer en saisissant un libellé libre.</div> : catalogue.slice().sort((a, b) => a.name.localeCompare(b.name)).map((p, i) => (<div key={p.id} data-testid="sv-prest-ligne" className="flex flex-wrap justify-between gap-2 py-1.5 text-sm" style={{ borderTop: i > 0 ? "1px solid #F3EFE3" : "none", opacity: p.active === false ? 0.5 : 1, overflowWrap: "anywhere" }}><span><b>{p.name}</b> <span className="text-xs" style={{ color: "#8A8370" }}>· par {p.unit}{p.active === false ? " · désactivée" : ""}</span></span><span className="tabular"><b>{svM(p.price)}</b>{canEdit && <button className="underline ml-2 text-xs" onClick={() => basculerPrest(p)} data-testid="sv-prest-bascule">{p.active === false ? "Réactiver" : "Désactiver"}</button>}{canEdit && <button className="underline ml-2 text-xs" style={{ color: "#A6432F" }} onClick={() => retirerPrest(p)} data-testid="sv-prest-retirer">Retirer</button>}</span></div>))}
      </div>
    </div>
  );

  // ───────── Ventes (factures de prestations) ─────────
  const ligneVide = () => ({ prestId: "", label: "", qty: "1", pu: "" });
  const [fv, setFv] = useBrouillon("sv-vente", { date: todayStr(), client: "", clientName: "", interv: "", mode: "caisse", lines: [ligneVide()] });
  const [vq, setVq] = useState("");
  const [selVente, setSelVente] = useState("");
  const [enc, setEnc] = useState({ date: todayStr(), mode: "caisse", amount: "" });
  const lignesForm = Array.isArray(fv.lines) && fv.lines.length > 0 ? fv.lines : [ligneVide()];
  const majLigne = (i, patch) => setFv({ ...fv, lines: lignesForm.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const choisirPrest = (i, id) => { const p = catalogue.find((x) => x.id === id); majLigne(i, p ? { prestId: id, label: p.name, pu: String(p.price) } : { prestId: "", label: "", pu: "" }); };
  const creerVente = (base) => {
    // base : { date, clientId, clientName, interv, mode, lines, contratId, periode }
    const lines = base.lines.map((l) => ({ prestId: l.prestId || "", label: String(l.label || "").trim(), qty: svQ(l.qty), pu: svR2(l.pu) })).filter((l) => l.label || l.qty > 0 || l.pu > 0);
    if (lines.length === 0 || lines.some((l) => !l.label)) { showToast("Chaque ligne a besoin d'un libellé (choisissez une prestation ou écrivez-le)."); return null; }
    if (lines.some((l) => !(l.qty > 0))) { showToast("Chaque quantité doit être supérieure à zéro."); return null; }
    if (lines.some((l) => !(l.pu > 0))) { showToast("Chaque prix doit être supérieur à zéro (en gourdes, au plus 100 milliards)."); return null; }
    const t = totaux(lines);
    if (!(t.total > 0) || t.total > 1e11) { showToast("Le total de la facture est invalide."); return null; }
    if (!verifDate(base.date, "enregistrer cette facture")) return null;
    if (base.contratId && lignesAJour("vente").some((v) => v.contratId === base.contratId && v.periode === base.periode && v.status !== "annulé")) { showToast("Ce mois est déjà facturé pour ce contrat."); return null; }
    const mode = ["caisse", "banque", "credit"].includes(base.mode) ? base.mode : "caisse";
    const cpt = compteMode(mode);
    svAjouterComptes(accounts, setAccounts, [cpt, "706", ...(t.tca > 0 ? ["445"] : [])]);
    const id = svId(), number = numero(lignesAJour("vente"), base.date);
    const e = ecrire(base.date, "Prestations — " + (base.clientId ? ((clients.find((c) => c.id === base.clientId) || {}).name || "client") : (base.clientName || "client de passage")) + " (facture " + number + ")", [{ account: cpt, debit: t.total, credit: 0 }, { account: "706", debit: 0, credit: t.ht }, { account: "445", debit: 0, credit: t.tca }], id);
    ajouter({ type: "vente", id, number, date: base.date, clientId: base.clientId || "", clientName: base.clientId ? "" : String(base.clientName || "").trim(), interv: String(base.interv || "").trim(), lines, ht: t.ht, tca: t.tca, tcaRate, total: t.total, mode, settlements: [], entryId: e.id, contratId: base.contratId || "", periode: base.periode || "", status: "valide", by: currentUserEmail || "" });
    logAudit("Services et prestations", "Facture", number + " — " + svM(t.total));
    return { id, number, total: t.total };
  };
  const enregistrerVente = () => {
    if (!canFront) return;
    const [ct, cid] = String(fv.client || "").split(":");
    if (fv.mode === "credit" && ct !== "c") { showToast("Une facture à crédit doit être rattachée à un client enregistré."); return; }
    const r = creerVente({ date: fv.date, clientId: ct === "c" ? cid : "", clientName: fv.clientName, interv: fv.interv, mode: fv.mode, lines: lignesForm });
    if (!r) return;
    setFv({ ...fv, client: "", clientName: "", interv: "", lines: [ligneVide()] });
    showToast("Facture " + r.number + " : " + svM(r.total) + ".");
    setImprimer({ kind: "facture", id: r.id });
  };
  const annulerVente = (v) => {
    if (!canEdit || v.status === "annulé") return;
    if (svPaye(v.settlements) > 0) { showToast("Annulez d'abord les encaissements de cette facture."); return; }
    if (!verifDate(today, "annuler cette facture")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler la facture " + v.number + " ? Une écriture inverse sera passée.")) return;
    const e = contre(v.entryId, "Annulation facture " + v.number + " (écriture inverse)", today, v.id);
    maj(v.id, (r) => ({ ...r, status: "annulé", reversalEntryId: e ? e.id : "" }));
    showToast("Facture " + v.number + " annulée."); logAudit("Services et prestations", "Facture annulée", v.number);
  };
  const encaisser = (v) => {
    if (!canFront || v.mode !== "credit" || v.status === "annulé") return;
    const reste = resteVente(v);
    const amount = enc.amount === "" ? reste : svR2(enc.amount);
    if (!(amount > 0) || amount > reste + 0.004) { showToast("Le montant doit être compris entre 0 et le reste à encaisser (" + svM(reste) + ")."); return; }
    if (!verifDate(enc.date, "enregistrer cet encaissement")) return;
    const cpt = compteMode(enc.mode === "banque" ? "banque" : "caisse");
    svAjouterComptes(accounts, setAccounts, [cpt, "411"]);
    const e = ecrire(enc.date, "Encaissement facture " + v.number + " — " + nomClient(v), [{ account: cpt, debit: amount, credit: 0 }, { account: "411", debit: 0, credit: amount }], v.id);
    maj(v.id, (r) => ({ ...r, settlements: [...(r.settlements || []), { id: svId(), date: enc.date, amount, mode: enc.mode === "banque" ? "banque" : "caisse", entryId: e.id, status: "valide" }] }));
    setEnc({ ...enc, amount: "" }); showToast("Encaissement de " + svM(amount) + " enregistré."); logAudit("Services et prestations", "Encaissement", v.number + " — " + svM(amount));
  };
  const annulerEnc = (v, s) => {
    if (!canEdit || s.status === "annulé") return;
    if (!verifDate(today, "annuler cet encaissement")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler cet encaissement ? Une écriture inverse sera passée.")) return;
    const e = contre(s.entryId, "Annulation encaissement " + v.number + " (écriture inverse)", today, v.id);
    maj(v.id, (r) => ({ ...r, settlements: r.settlements.map((x) => (x.id === s.id ? { ...x, status: "annulé", reversalEntryId: e ? e.id : "" } : x)) }));
    showToast("Encaissement annulé.");
  };
  const Ventes = () => {
    const rows = ventes.filter((v) => rechercher([v.number, nomClient(v), v.interv, (v.lines || []).map((l) => l.label).join(" ")].join(" "), vq)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.number < b.number ? 1 : -1));
    const t = totaux(lignesForm);
    const v0 = ventes.find((x) => x.id === selVente);
    const exporter = () => ecTelecharger("factures-prestations-" + today + ".csv", [["Facture", "Date", "Client", "Intervenant", "Hors taxe", "Taxe", "Total", "Mode", "Reste à encaisser", "État"], ...rows.map((v) => [v.number, v.date, nomClient(v), v.interv || "", v.ht, v.tca, v.total, v.mode, v.status === "annulé" ? 0 : resteVente(v), v.status === "annulé" ? "annulée" : "valide"])]);
    return (
      <div>
        {canFront && (<div className="ec-card p-4 mb-5" data-testid="sv-vente-form"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvelle facture de prestations</div>
          <div className="grid md:grid-cols-4 gap-2 items-end mb-2">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={fv.date} onChange={(e) => setFv({ ...fv, date: e.target.value })} data-testid="sv-vente-date" className={ecInput} style={ecBorder} /></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Client</label><select value={fv.client} onChange={(e) => setFv({ ...fv, client: e.target.value })} data-testid="sv-vente-client" className={ecInput} style={ecBorder}><option value="">Client de passage ou non enregistré</option>{clients.map((c) => <option key={c.id} value={"c:" + c.id}>{c.name}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Réglé</label><select value={fv.mode} onChange={(e) => setFv({ ...fv, mode: e.target.value })} data-testid="sv-vente-mode" className={ecInput} style={ecBorder}><option value="caisse">Au comptant — caisse (espèces)</option><option value="banque">Au comptant — banque</option><option value="credit">À crédit (à encaisser plus tard)</option></select></div>
            {!fv.client && <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom à inscrire sur la facture (facultatif)</label><input value={fv.clientName} onChange={(e) => setFv({ ...fv, clientName: e.target.value })} data-testid="sv-vente-nomlibre" className={ecInput} style={ecBorder} /></div>}
            {fv.mode === "credit" && !fv.client && <div className="md:col-span-4 text-xs p-2 rounded" style={{ background: "#FFF6E0", color: "#152238" }}>Une facture à crédit doit être rattachée à un client enregistré, pour pouvoir le relancer.</div>}
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>{V.interv} (facultatif)</label><input list="sv-dl-interv" value={fv.interv} onChange={(e) => setFv({ ...fv, interv: e.target.value })} data-testid="sv-vente-interv" className={ecInput} style={ecBorder} /></div>
          </div>
          {lignesForm.map((l, i) => (<div key={i} data-testid="sv-vente-ligne" className="grid md:grid-cols-6 gap-2 items-end mb-1">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Prestation</label><select value={l.prestId} onChange={(e) => choisirPrest(i, e.target.value)} data-testid="sv-ligne-prest" className={ecInput} style={ecBorder}><option value="">Libellé libre</option>{catalogue.filter((p) => p.active !== false).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}</select></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Libellé</label><input value={l.label} onChange={(e) => majLigne(i, { label: e.target.value })} data-testid="sv-ligne-libelle" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Quantité</label><input type="number" min="0" step="0.001" value={l.qty} onChange={(e) => majLigne(i, { qty: e.target.value })} data-testid="sv-ligne-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Prix unitaire (G)</label><input type="number" min="0" step="0.01" value={l.pu} onChange={(e) => majLigne(i, { pu: e.target.value })} data-testid="sv-ligne-pu" className={ecInput + " tabular"} style={ecBorder} />{lignesForm.length > 1 && <button className="text-xs underline" onClick={() => setFv({ ...fv, lines: lignesForm.filter((_, j) => j !== i) })}>Retirer la ligne</button>}</div>
          </div>))}
          {lignesForm.length < 12 && <button className="text-xs underline mb-2" onClick={() => setFv({ ...fv, lines: [...lignesForm, ligneVide()] })} data-testid="sv-ligne-ajouter">+ Ajouter une ligne</button>}
          <div className="text-sm mb-2" data-testid="sv-vente-totaux">Hors taxe : <b className="tabular">{svM(t.ht)}</b>{tcaRate > 0 ? <> · Taxe ({tcaRate} %) : <b className="tabular">{svM(t.tca)}</b></> : null} · Total : <b className="tabular" data-testid="sv-vente-total">{svM(t.total)}</b></div>
          <button onClick={enregistrerVente} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="sv-vente-enregistrer">Enregistrer et imprimer la facture</button></div>)}
        <div className="ec-card p-4"><div className="flex flex-wrap gap-2 items-end mb-2"><div className="display text-base" style={{ color: "#152238" }}>Factures de prestations</div>
          <input value={vq} onChange={(e) => setVq(e.target.value)} placeholder="Rechercher (n°, client, prestation)" className={ecInput + " md:w-64"} style={ecBorder} data-testid="sv-vente-recherche" />
          <button onClick={exporter} className="px-3 py-2 rounded text-sm" style={ecBtn}>Exporter (CSV)</button></div>
          {rows.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucune facture.</div> : (
            <div>{rows.slice(0, 200).map((v, i) => (<div key={v.id} data-testid="sv-vente-ligne-liste" className="py-2 text-sm" style={{ borderTop: i > 0 ? "1px solid #F3EFE3" : "none", opacity: v.status === "annulé" ? 0.5 : 1, overflowWrap: "anywhere" }}>
              <div className="flex flex-wrap justify-between gap-2"><span><b>{v.number}</b> <span className="text-xs" style={{ color: "#8A8370" }}>· {ecDateFr(v.date)}</span> · {nomClient(v)}</span><span className="tabular"><b>{svM(v.total)}</b> {v.status === "annulé" ? ecPastille("Annulée", "neutre") : v.mode === "credit" ? (resteVente(v) > 0.004 ? ecPastille("À encaisser : " + svM(resteVente(v)), "attente") : ecPastille("Payée", "ok")) : null}</span></div>
              <div className="text-xs" style={{ color: "#8A8370" }}>{(v.lines || []).map((l) => l.label).join(", ")}{v.interv ? " · " + v.interv : ""}
                <button className="underline ml-2" style={{ color: "#152238" }} onClick={() => setImprimer({ kind: "facture", id: v.id })} data-testid="sv-vente-imprimer">Facture</button>
                {canFront && v.mode === "credit" && v.status !== "annulé" && <button className="underline ml-2" style={{ color: "#152238" }} onClick={() => { setSelVente(v.id === selVente ? "" : v.id); setEnc({ date: todayStr(), mode: "caisse", amount: "" }); }} data-testid="sv-vente-ouvrir">{v.id === selVente ? "Fermer" : "Encaisser"}</button>}
                {canEdit && v.status !== "annulé" && <button className="underline ml-2" style={{ color: "#A6432F" }} onClick={() => annulerVente(v)} data-testid="sv-vente-annuler">Annuler</button>}</div></div>))}</div>)}
        </div>
        {v0 && v0.mode === "credit" && v0.status !== "annulé" && canFront && (
          <div className="ec-card p-4 mt-4" data-testid="sv-vente-panneau"><div className="display text-base mb-2" style={{ color: "#152238" }}>Encaissements — {v0.number} · reste à encaisser {svM(resteVente(v0))}</div>
            {(v0.settlements || []).map((s) => (<div key={s.id} className="flex flex-wrap justify-between gap-2 text-sm py-1" data-testid="sv-vente-encaissement" style={{ opacity: s.status === "annulé" ? 0.5 : 1 }}><span>{ecDateFr(s.date)} · {s.mode === "banque" ? "Banque" : "Caisse"}</span><span className="tabular">{svM(s.amount)} {s.status === "annulé" ? ecPastille("Annulé", "neutre") : canEdit ? <button className="text-xs underline ml-2" onClick={() => annulerEnc(v0, s)}>Annuler</button> : null}</span></div>))}
            {resteVente(v0) > 0.004 && (<div className="grid md:grid-cols-4 gap-2 items-end mt-2">
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant (vide = solde)</label><input type="number" min="0" step="0.01" value={enc.amount} onChange={(e) => setEnc({ ...enc, amount: e.target.value })} data-testid="sv-enc-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Reçu par</label><select value={enc.mode} onChange={(e) => setEnc({ ...enc, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Caisse</option><option value="banque">Banque</option></select></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={enc.date} onChange={(e) => setEnc({ ...enc, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
              <div><button onClick={() => encaisser(v0)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="sv-enc-ok">Enregistrer l'encaissement</button></div></div>)}
          </div>)}
      </div>
    );
  };

  // ───────── Contrats mensuels ─────────
  const [fk, setFk] = useBrouillon("sv-contrat", { client: "", label: "", amount: "", start: todayStr(), end: "", interv: "" });
  const ajouterContrat = () => {
    if (!canEdit) return;
    const amount = svR2(fk.amount);
    if (!fk.client) { showToast("Choisissez le client du contrat."); return; }
    if (!fk.label.trim()) { showToast("Indiquez ce que le contrat couvre (ex. gardiennage de nuit)."); return; }
    if (!(amount > 0)) { showToast("Indiquez le montant mensuel hors taxe (en gourdes, au plus 100 milliards)."); return; }
    if (!fk.start) { showToast("Indiquez la date de début."); return; }
    if (fk.end && fk.end < fk.start) { showToast("La fin du contrat ne peut pas précéder son début."); return; }
    ajouter({ type: "contrat", id: svId(), clientId: fk.client.split(":")[1] || "", label: fk.label.trim(), amount, start: fk.start, end: fk.end || "", interv: fk.interv.trim(), status: "actif" });
    setFk({ ...fk, label: "", amount: "", end: "", interv: "" }); showToast("Contrat enregistré."); logAudit("Services et prestations", "Contrat", fk.label.trim() + " — " + svM(amount) + " par mois");
  };
  const periodesDues = (c) => {
    if (c.status !== "actif") return [];
    const out = [];
    let y = Number(c.start.slice(0, 4)), m = Number(c.start.slice(5, 7));
    for (let n = 0; n < 600; n++) {
      const ym = y + "-" + String(m).padStart(2, "0");
      if (ym > moisCourant || (c.end && ym > c.end.slice(0, 7))) break;
      if (!ventesOk.some((v) => v.contratId === c.id && v.periode === ym)) out.push(ym);
      m += 1; if (m > 12) { m = 1; y += 1; }
    }
    return out.slice(-24);
  };
  const facturerContrat = (c, ym) => {
    if (!canEdit) return;
    const date = ym === moisCourant ? today : svFinMois(ym);
    const r = creerVente({ date, clientId: c.clientId, clientName: "", interv: c.interv, mode: "credit", lines: [{ prestId: "", label: c.label + " — " + svLibMois(ym), qty: "1", pu: String(c.amount) }], contratId: c.id, periode: ym });
    if (r) showToast("Facture " + r.number + " pour " + svLibMois(ym) + " : " + svM(r.total) + " (à encaisser).");
  };
  const suspendreContrat = (c) => { if (canEdit) { maj(c.id, (r) => ({ ...r, status: r.status === "actif" ? "suspendu" : "actif" })); logAudit("Services et prestations", c.status === "actif" ? "Contrat suspendu" : "Contrat repris", c.label); } };
  const retirerContrat = (c) => {
    if (!canEdit) return;
    if (ventes.some((v) => v.contratId === c.id)) { showToast("Ce contrat a des factures : suspendez-le plutôt."); return; }
    setServices((prev) => (prev || []).filter((r) => !(r && r.type === "contrat" && r.id === c.id)));
    svRef.current = svRef.current.filter((r) => !(r && r.type === "contrat" && r.id === c.id));
    showToast("Contrat retiré.");
  };
  const Contrats = () => (
    <div>
      {canEdit && (<div className="ec-card p-4 mb-5" data-testid="sv-contrat-form"><div className="display text-base mb-1" style={{ color: "#152238" }}>Nouveau contrat mensuel</div>
        <div className="text-xs mb-2" style={{ color: "#8A8370" }}>{V.guideContrat} Le montant est hors taxe ; la taxe s'ajoute si vous l'avez activée.</div>
        <div className="grid md:grid-cols-4 gap-2 items-end">
          <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Client</label><select value={fk.client} onChange={(e) => setFk({ ...fk, client: e.target.value })} data-testid="sv-contrat-client" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{clients.map((c) => <option key={c.id} value={"c:" + c.id}>{c.name}</option>)}</select></div>
          <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Ce que le contrat couvre</label><input value={fk.label} onChange={(e) => setFk({ ...fk, label: e.target.value })} data-testid="sv-contrat-libelle" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant par mois (G)</label><input type="number" min="0" step="0.01" value={fk.amount} onChange={(e) => setFk({ ...fk, amount: e.target.value })} data-testid="sv-contrat-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Début</label><input type="date" value={fk.start} onChange={(e) => setFk({ ...fk, start: e.target.value })} data-testid="sv-contrat-debut" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Fin (facultatif)</label><input type="date" value={fk.end} onChange={(e) => setFk({ ...fk, end: e.target.value })} className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>{V.interv} (facultatif)</label><input list="sv-dl-interv" value={fk.interv} onChange={(e) => setFk({ ...fk, interv: e.target.value })} className={ecInput} style={ecBorder} /></div>
        </div>
        <button onClick={ajouterContrat} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="sv-contrat-ajouter">Enregistrer le contrat</button></div>)}
      <div className="ec-card p-4"><div className="display text-base mb-2" style={{ color: "#152238" }}>Contrats ({contrats.length})</div>
        {contrats.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucun contrat mensuel.</div> : contrats.map((c, i) => { const dues = periodesDues(c); return (<div key={c.id} data-testid="sv-contrat-ligne" className="py-2 text-sm" style={{ borderTop: i > 0 ? "1px solid #F3EFE3" : "none", opacity: c.status === "actif" ? 1 : 0.55, overflowWrap: "anywhere" }}>
          <div className="flex flex-wrap justify-between gap-2"><span><b>{c.label}</b> <span className="text-xs" style={{ color: "#8A8370" }}>· {nomClient({ clientId: c.clientId })} · depuis {ecDateFr(c.start)}{c.end ? " jusqu'au " + ecDateFr(c.end) : ""}{c.status !== "actif" ? " · suspendu" : ""}</span></span><span className="tabular"><b>{svM(c.amount)}</b> / mois</span></div>
          <div className="text-xs" style={{ color: "#8A8370" }}>{dues.length === 0 ? "Tous les mois sont facturés." : "À facturer : " + dues.map(svLibMois).join(", ")}</div>
          {canEdit && <div className="flex flex-wrap gap-2 mt-1">{dues.slice(0, 3).map((ym) => <button key={ym} onClick={() => facturerContrat(c, ym)} className="px-2 py-1 rounded text-xs" style={ecBtnGold} data-testid="sv-contrat-facturer">Facturer {svLibMois(ym)}</button>)}<button className="underline text-xs" onClick={() => suspendreContrat(c)} data-testid="sv-contrat-suspendre">{c.status === "actif" ? "Suspendre" : "Reprendre"}</button><button className="underline text-xs" style={{ color: "#A6432F" }} onClick={() => retirerContrat(c)}>Retirer</button></div>}
        </div>); })}
      </div>
    </div>
  );

  // ───────── Dépenses ─────────
  const [fd, setFd] = useBrouillon("sv-depense", { date: todayStr(), kind: "fournitures", amount: "", mode: "caisse", supplier: "", label: "" });
  const [dpq, setDpq] = useState("");
  const [selDep, setSelDep] = useState("");
  const [rg, setRg] = useState({ date: todayStr(), mode: "caisse", amount: "" });
  const enregistrerDepense = () => {
    if (!canEdit) return;
    const amount = svR2(fd.amount);
    if (!(amount > 0)) { showToast("Indiquez le montant (en gourdes, au plus 100 milliards)."); return; }
    const def = SV_DEPENSES.find((x) => x[0] === fd.kind) || SV_DEPENSES[0];
    const sansEcr = !def[2];
    if (!sansEcr && fd.mode === "apayer" && !fd.supplier.trim()) { showToast("Pour une dépense à payer plus tard, indiquez le fournisseur."); return; }
    if (!verifDate(fd.date, "enregistrer cette dépense")) return;
    const mode = sansEcr ? "salaires" : fd.mode;
    const cpt = compteMode(mode);
    const label = fd.label.trim() || natureDep(fd.kind);
    const id = svId();
    let e = null;
    if (!sansEcr) { svAjouterComptes(accounts, setAccounts, [def[2], cpt]); e = ecrire(fd.date, "Services — " + label, [{ account: def[2], debit: amount, credit: 0 }, { account: cpt, debit: 0, credit: amount }], id); }
    ajouter({ type: "dep", id, date: fd.date, kind: fd.kind, label, supplier: fd.supplier.trim(), amount, mode, entryId: e ? e.id : "", status: "valide", settlements: [], by: currentUserEmail || "" });
    setFd({ ...fd, label: "", amount: "", supplier: "" });
    showToast("Dépense enregistrée : " + svM(amount) + "."); logAudit("Services et prestations", "Dépense", label + " — " + svM(amount));
  };
  const annulerDepense = (d) => {
    if (!canEdit || d.status === "annulé") return;
    if (svPaye(d.settlements) > 0) { showToast("Annulez d'abord les règlements de cette dépense."); return; }
    if (!verifDate(today, "annuler cette dépense")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler cette dépense ? Une écriture inverse sera passée.")) return;
    const e = contre(d.entryId, "Annulation — " + d.label + " (écriture inverse)", today, d.id);
    maj(d.id, (r) => ({ ...r, status: "annulé", reversalEntryId: e ? e.id : "" }));
    showToast("Dépense annulée.");
  };
  const reglerDep = (d) => {
    if (!canEdit || d.mode !== "apayer" || d.status === "annulé") return;
    const reste = resteDep(d);
    const amount = rg.amount === "" ? reste : svR2(rg.amount);
    if (!(amount > 0) || amount > reste + 0.004) { showToast("Le montant doit être compris entre 0 et le reste à payer (" + svM(reste) + ")."); return; }
    if (!verifDate(rg.date, "enregistrer ce règlement")) return;
    const cpt = compteMode(rg.mode === "banque" ? "banque" : "caisse");
    svAjouterComptes(accounts, setAccounts, [cpt, "401"]);
    const e = ecrire(rg.date, "Règlement " + (d.supplier || "fournisseur") + " — " + d.label, [{ account: "401", debit: amount, credit: 0 }, { account: cpt, debit: 0, credit: amount }], d.id);
    maj(d.id, (r) => ({ ...r, settlements: [...(r.settlements || []), { id: svId(), date: rg.date, amount, mode: rg.mode, entryId: e.id, status: "valide" }] }));
    setRg({ ...rg, amount: "" }); showToast("Règlement de " + svM(amount) + " enregistré."); logAudit("Services et prestations", "Dette réglée", (d.supplier || "") + " — " + svM(amount));
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
    const rows = deps.filter((d) => rechercher([d.label, d.supplier].join(" "), dpq)).sort((a, b) => (a.date < b.date ? 1 : -1));
    const d0 = deps.find((x) => x.id === selDep);
    const def = SV_DEPENSES.find((x) => x[0] === fd.kind) || SV_DEPENSES[0];
    return (
      <div>
        {canEdit && (<div className="ec-card p-4 mb-5" data-testid="sv-dep-form"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvelle dépense</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={fd.date} onChange={(e) => setFd({ ...fd, date: e.target.value })} data-testid="sv-dep-date" className={ecInput} style={ecBorder} /></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nature</label><select value={fd.kind} onChange={(e) => setFd({ ...fd, kind: e.target.value })} data-testid="sv-dep-nature" className={ecInput} style={ecBorder}>{kindsDep.map((k) => <option key={k[0]} value={k[0]}>{k[1]}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant (G)</label><input type="number" min="0" step="0.01" value={fd.amount} onChange={(e) => setFd({ ...fd, amount: e.target.value })} data-testid="sv-dep-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
            {def[2] && <div><label className="text-xs" style={{ color: "#8A8370" }}>Payé</label><select value={fd.mode} onChange={(e) => setFd({ ...fd, mode: e.target.value })} data-testid="sv-dep-mode" className={ecInput} style={ecBorder}><option value="caisse">Caisse (espèces)</option><option value="banque">Banque</option><option value="apayer">À payer plus tard (dette)</option></select></div>}
            {def[2] && <div><label className="text-xs" style={{ color: "#8A8370" }}>Fournisseur{fd.mode === "apayer" ? " (obligatoire)" : " (facultatif)"}</label><input list="sv-dl-fourn" value={fd.supplier} onChange={(e) => setFd({ ...fd, supplier: e.target.value })} data-testid="sv-dep-fournisseur" className={ecInput} style={ecBorder} /></div>}
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Détail (facultatif)</label><input value={fd.label} onChange={(e) => setFd({ ...fd, label: e.target.value })} data-testid="sv-dep-detail" className={ecInput} style={ecBorder} /></div>
          </div>
          <button onClick={enregistrerDepense} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="sv-dep-enregistrer">Enregistrer la dépense</button></div>)}
        <div className="ec-card p-4"><div className="flex flex-wrap gap-2 items-end mb-2"><div className="display text-base" style={{ color: "#152238" }}>Dépenses</div>
          <input value={dpq} onChange={(e) => setDpq(e.target.value)} placeholder="Rechercher (détail, fournisseur)" className={ecInput + " md:w-64"} style={ecBorder} data-testid="sv-dep-recherche" /></div>
          {rows.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucune dépense.</div> : (
            <div>{rows.slice(0, 200).map((d, i) => (<div key={d.id} data-testid="sv-dep-ligne" className="py-2 text-sm" style={{ borderTop: i > 0 ? "1px solid #F3EFE3" : "none", opacity: d.status === "annulé" ? 0.5 : 1, overflowWrap: "anywhere" }}>
              <div className="flex flex-wrap justify-between gap-2"><span><span className="text-xs" style={{ color: "#8A8370" }}>{ecDateFr(d.date)}</span> · <b>{d.label}</b></span><span className="tabular"><b>{svM(d.amount)}</b> {d.status === "annulé" ? ecPastille("Annulée", "neutre") : d.mode === "apayer" ? (resteDep(d) > 0.004 ? ecPastille("À payer : " + svM(resteDep(d)), "attente") : ecPastille("Payée", "ok")) : null}</span></div>
              <div className="text-xs" style={{ color: "#8A8370" }}>{natureDep(d.kind)}{d.supplier ? " · " + d.supplier : ""}
                {canEdit && d.mode === "apayer" && d.status !== "annulé" && <button className="underline ml-2" style={{ color: "#152238" }} onClick={() => { setSelDep(d.id === selDep ? "" : d.id); setRg({ date: todayStr(), mode: "caisse", amount: "" }); }} data-testid="sv-dep-ouvrir">{d.id === selDep ? "Fermer" : "Régler"}</button>}
                {canEdit && d.status !== "annulé" && <button className="underline ml-2" style={{ color: "#A6432F" }} onClick={() => annulerDepense(d)} data-testid="sv-dep-annuler">Annuler</button>}</div></div>))}</div>)}
        </div>
        {d0 && d0.mode === "apayer" && d0.status !== "annulé" && canEdit && (
          <div className="ec-card p-4 mt-4" data-testid="sv-dep-panneau"><div className="display text-base mb-2" style={{ color: "#152238" }}>Règlement — {d0.supplier || "fournisseur"} · reste à payer {svM(resteDep(d0))}</div>
            {(d0.settlements || []).map((s) => (<div key={s.id} className="flex flex-wrap justify-between gap-2 text-sm py-1" data-testid="sv-dep-reglement" style={{ opacity: s.status === "annulé" ? 0.5 : 1 }}><span>{ecDateFr(s.date)} · {s.mode === "banque" ? "Banque" : "Caisse"}</span><span className="tabular">{svM(s.amount)} {s.status === "annulé" ? ecPastille("Annulé", "neutre") : <button className="text-xs underline ml-2" onClick={() => annulerRegDep(d0, s)}>Annuler</button>}</span></div>))}
            {resteDep(d0) > 0.004 && (<div className="grid md:grid-cols-4 gap-2 items-end mt-2">
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant (vide = solde)</label><input type="number" min="0" step="0.01" value={rg.amount} onChange={(e) => setRg({ ...rg, amount: e.target.value })} data-testid="sv-reg-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Payé par</label><select value={rg.mode} onChange={(e) => setRg({ ...rg, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Caisse</option><option value="banque">Banque</option></select></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={rg.date} onChange={(e) => setRg({ ...rg, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
              <div><button onClick={() => reglerDep(d0)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="sv-reg-ok">Enregistrer le règlement</button></div></div>)}
          </div>)}
      </div>
    );
  };

  // ───────── Tableau de bord ─────────
  const Apercu = () => {
    const caMois = svR2(ventesOk.filter((v) => String(v.date).startsWith(moisCourant)).reduce((s, v) => s + v.ht, 0));
    const depMois = svR2(depsOk.filter((d) => String(d.date).startsWith(moisCourant)).reduce((s, d) => s + d.amount, 0));
    const aEncaisser = svR2(ventesOk.reduce((s, v) => s + resteVente(v), 0));
    const aPayer = svR2(depsOk.reduce((s, d) => s + resteDep(d), 0));
    const impayes = ventesOk.filter((v) => resteVente(v) > 0.004 && svJours(v.date, today) > 30);
    const afaire = [];
    impayes.forEach((v) => afaire.push({ tab: "ventes", sel: v.id, nom: nomClient(v), txt: "Facture " + v.number + " du " + ecDateFr(v.date) + " non payée depuis plus de 30 jours : " + svM(resteVente(v)) }));
    contrats.filter((c) => periodesDues(c).length > 0).forEach((c) => { const p = periodesDues(c); afaire.push({ tab: "contrats", nom: c.label, txt: "À facturer : " + p.slice(0, 3).map(svLibMois).join(", ") + (p.length > 3 ? "…" : "") }); });
    depsOk.filter((d) => resteDep(d) > 0.004 && svJours(d.date, today) > 30).forEach((d) => afaire.push({ tab: "depenses", sel: d.id, nom: d.supplier || d.label, txt: "Dépense du " + ecDateFr(d.date) + " à payer depuis plus de 30 jours : " + svM(resteDep(d)) }));
    const etapes = [
      ["Type d'activité", "Choisissez ci-dessus votre activité : les mots et les natures de dépenses s'adaptent.", "apercu", !!svType],
      ["Prestations", "Onglet Prestations : listez ce que vous vendez et vos prix (ex. " + V.exPrest.split("…")[0].split(",").slice(0, 2).join(",") + ").", "prestations", catalogue.length > 0],
      ["Clients", "Enregistrez vos clients (facultatif pour les clients de passage).", "clients", clients.length > 0],
      ["Première facture", "Onglet Factures : choisissez la prestation, la quantité, le mode de règlement ; la facture s'imprime et la comptabilité se fait seule.", "ventes", ventesOk.length > 0],
      ["Contrats mensuels", V.guideContrat, "contrats", contrats.length > 0],
      ["Première dépense", "Onglet Dépenses : fournitures, location, transport, loyer… ; une dette se règle plus tard.", "depenses", depsOk.length > 0],
    ];
    const toutFait = etapes.every((e) => e[3]);
    const kpis = [["Chiffre d'affaires du mois (HT)", svM(caMois), "sv-kpi-ca"], ["Dépenses du mois", svM(depMois), "sv-kpi-dep"], ["Résultat du mois", svM(svR2(caMois - depMois)), "sv-kpi-resultat"], ["À encaisser", svM(aEncaisser), "sv-kpi-aencaisser"], ["Dépenses à payer", svM(aPayer), "sv-kpi-apayer"], ["Contrats actifs", String(contrats.filter((c) => c.status === "actif").length), "sv-kpi-contrats"], ["Factures impayées +30 j", String(impayes.length), "sv-kpi-impayes"], ["Choses à faire", String(afaire.length), "sv-kpi-afaire"]];
    const accesTab = (tb) => !(isVendeur && !["clients", "ventes", "apercu"].includes(tb));
    return (
      <div>
        {!svType && canEdit && (<div className="ec-card p-4 mb-5" data-testid="sv-type-carte"><div className="display text-base mb-1" style={{ color: "#152238" }}>Quelle est votre activité ?</div>
          <div className="text-xs mb-2" style={{ color: "#8A8370" }}>Ce choix adapte les mots (agent, DJ, coiffeur, consultant…) et les natures de dépenses. Votre métier n'est pas dans la liste ? Choisissez « Autre service », ou gardez l'espace Commerce. Vous pourrez le changer.</div>
          <div className="flex flex-wrap gap-2">{SV_TYPES.map((t) => <button key={t[0]} onClick={() => choisirType(t[0])} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid={"sv-type-" + t[0]}>{t[1]}</button>)}</div></div>)}
        {svType && canEdit && (<div className="text-xs mb-3" style={{ color: "#8A8370" }} data-testid="sv-type-actuel">Activité : <b>{(SV_TYPES.find((t) => t[0] === svType) || [0, ""])[1]}</b> · changer : <select value={svType} onChange={(e) => choisirType(e.target.value)} data-testid="sv-type-select" style={{ border: "1px solid #DDD6C4", borderRadius: 4, padding: "2px 4px", background: "#fff" }}>{SV_TYPES.map((t) => <option key={t[0]} value={t[0]}>{t[1]}</option>)}</select>
          {" "}· <label><input type="checkbox" checked={!!cfg.tcaOn} onChange={basculerTca} data-testid="sv-tca" /> Ajouter la taxe ({Number(settings && settings.taxRate) || 0} %) sur les factures</label></div>)}
        <div className="ec-card p-4 mb-5" data-testid="sv-guide">
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Marche à suivre, en 6 étapes{toutFait ? " — toutes faites ✓" : ""}</div>
          <ol className="text-sm" style={{ color: "#152238", listStyle: "none", paddingLeft: 0 }}>{etapes.map(([t, d, tb, fait], i) => (<li key={i} data-testid="sv-etape" className="mb-1.5 flex flex-wrap gap-2 items-baseline"><span style={{ color: fait ? "#0F6B5C" : "#8A8370", fontWeight: 700 }}>{fait ? "✓" : (i + 1) + "."}</span><span><b>{t}</b> — <span style={{ color: "#5B563F" }}>{d}</span></span>{!fait && tb !== "apercu" && accesTab(tb) && <button className="text-xs underline" data-testid="sv-etape-ouvrir" onClick={() => setTab(tb)}>Ouvrir</button>}</li>))}</ol>
        </div>
        {ventes.length + deps.length + catalogue.length === 0 && <div className="p-4 rounded text-sm mb-4" style={{ background: "#FFF6E0", color: "#152238" }} data-testid="sv-vide">Pour commencer : choisissez votre <b>activité</b>, listez vos <b>prestations</b> et vos prix, puis faites votre première <b>facture</b>.</div>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {kpis.map(([l, v, t]) => (<div key={t} className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>{l}</div><div className="display text-lg tabular" data-testid={t} style={{ color: "#152238" }}>{v}</div></div>))}
        </div>
        <div className="display text-base mb-2" style={{ color: "#152238" }}>À faire</div>
        {afaire.length === 0 ? <div className="text-sm mb-5" style={{ color: "#8A8370" }}>Rien en attente.</div> : (
          <div className="ec-card p-4 mb-5">{afaire.slice(0, 15).map((x, i) => (<div key={i} data-testid="sv-afaire-ligne" className="flex flex-wrap justify-between gap-2 py-1.5 text-sm" style={{ borderTop: i > 0 ? "1px solid #F3EFE3" : "none" }}><span style={{ overflowWrap: "anywhere" }}><b>{x.nom}</b> — {x.txt}</span>{accesTab(x.tab) && <button className="text-xs underline" data-testid="sv-afaire-ouvrir" onClick={() => { setTab(x.tab); if (x.tab === "ventes" && x.sel) setSelVente(x.sel); if (x.tab === "depenses" && x.sel) setSelDep(x.sel); }}>Ouvrir</button>}</div>))}</div>
        )}
        <div className="text-xs" style={{ color: "#8A8370" }} data-testid="sv-mention">Ce module aide à tenir vos comptes ; il ne remplace pas votre expert-comptable. Taxes, déclarations, licences et autorisations propres à votre métier (par exemple pour la sécurité privée ou les débits de boissons) sont à confirmer auprès des autorités et de votre expert.</div>
      </div>
    );
  };

  // ───────── Rapports ─────────
  const [rp, setRp] = useState({ from: today.slice(0, 4) + "-01-01", to: todayStr() });
  const Rapports = () => {
    const inP = (d) => d >= rp.from && d <= rp.to;
    const vP = ventesOk.filter((v) => inP(v.date)), dP = depsOk.filter((d) => inP(d.date));
    const ca = svR2(vP.reduce((s, v) => s + v.ht, 0)), tcaT = svR2(vP.reduce((s, v) => s + v.tca, 0)), depT = svR2(dP.reduce((s, d) => s + d.amount, 0));
    const grp = (rows, keyFn, amountFn) => { const o = {}; rows.forEach((x) => { const k = keyFn(x); o[k] = svR2((o[k] || 0) + amountFn(x)); }); return Object.keys(o).map((k) => [k, o[k]]).sort((a, b) => b[1] - a[1]); };
    const parPrest = (() => { const o = {}; vP.forEach((v) => (v.lines || []).forEach((l) => { o[l.label] = svR2((o[l.label] || 0) + svR2(l.qty * l.pu)); })); return Object.keys(o).map((k) => [k, o[k]]).sort((a, b) => b[1] - a[1]); })();
    const parClient = grp(vP, (v) => nomClient(v), (v) => v.ht);
    const parInterv = grp(vP.filter((v) => v.interv), (v) => v.interv, (v) => v.ht);
    const parNatDep = grp(dP, (d) => natureDep(d.kind), (d) => d.amount);
    const ages = { a: 0, b: 0, c: 0 };
    ventesOk.forEach((v) => { const r = resteVente(v); if (r <= 0.004) return; const j = svJours(v.date, today); if (j <= 30) ages.a = svR2(ages.a + r); else if (j <= 60) ages.b = svR2(ages.b + r); else ages.c = svR2(ages.c + r); });
    const exporter = () => ecTelecharger("rapport-services-" + today + ".csv", [["Rubrique", "Libellé", "Montant"], ...parPrest.map((x) => ["Chiffre d'affaires par prestation", x[0], x[1]]), ...parClient.map((x) => ["Chiffre d'affaires par client", x[0], x[1]]), ...parInterv.map((x) => ["Chiffre d'affaires par intervenant", x[0], x[1]]), ...parNatDep.map((x) => ["Dépenses par nature", x[0], x[1]]), ["Résultat", "Chiffre d'affaires HT − dépenses", svR2(ca - depT)]]);
    const Liste = (titre, data, tid) => (<div className="ec-card p-4"><div className="display text-base mb-2" style={{ color: "#152238" }}>{titre}</div>{data.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Rien sur la période.</div> : data.map((x) => (<div key={x[0]} className="flex justify-between gap-2 py-1 text-sm" data-testid={tid} style={{ overflowWrap: "anywhere" }}><span>{x[0]}</span><span className="tabular">{svM(x[1])}</span></div>))}</div>);
    return (
      <div>
        <div className="flex flex-wrap gap-2 items-end mb-4"><div><label className="text-xs" style={{ color: "#8A8370" }}>Du</label><input type="date" value={rp.from} onChange={(e) => setRp({ ...rp, from: e.target.value })} data-testid="sv-rp-du" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Au</label><input type="date" value={rp.to} onChange={(e) => setRp({ ...rp, to: e.target.value })} data-testid="sv-rp-au" className={ecInput} style={ecBorder} /></div>
          <button onClick={exporter} className="px-3 py-2 rounded text-sm" style={ecBtn}>Exporter (CSV)</button></div>
        <div className="ec-card p-4 mb-4" data-testid="sv-rap-resume"><div className="display text-base mb-2" style={{ color: "#152238" }}>Résultat de la période</div>
          <div className="flex justify-between gap-2 py-1 text-sm"><span>Chiffre d'affaires (hors taxe)</span><span className="tabular" data-testid="sv-rap-ca">{svM(ca)}</span></div>
          {tcaT > 0 && <div className="flex justify-between gap-2 py-1 text-sm"><span>Taxe facturée (à reverser)</span><span className="tabular" data-testid="sv-rap-tca">{svM(tcaT)}</span></div>}
          <div className="flex justify-between gap-2 py-1 text-sm"><span>Dépenses</span><span className="tabular" data-testid="sv-rap-dep">{svM(depT)}</span></div>
          <div className="flex justify-between gap-2 py-1 text-sm" style={{ borderTop: "1px solid #DDD6C4", fontWeight: 700 }}><span>Résultat</span><span className="tabular" data-testid="sv-rap-resultat" style={{ color: ca - depT < 0 ? "#A6432F" : "#0F6B5C" }}>{svM(svR2(ca - depT))}</span></div>
          <div className="text-xs mt-1" style={{ color: "#8A8370" }}>Calcul de gestion simple : il ne tient pas compte des salaires payés par le module Salaires, ni des amortissements. Les états comptables officiels se préparent avec votre expert-comptable.</div></div>
        <div className="grid md:grid-cols-2 gap-4 mb-4">{Liste("Chiffre d'affaires par prestation", parPrest, "sv-rap-prest")}{Liste("Chiffre d'affaires par client", parClient, "sv-rap-client")}{Liste("Chiffre d'affaires par " + V.interv.split(" ou ")[0].toLowerCase(), parInterv, "sv-rap-interv")}{Liste("Dépenses par nature", parNatDep, "sv-rap-natdep")}</div>
        <div className="ec-card p-4" data-testid="sv-rap-ages"><div className="display text-base mb-2" style={{ color: "#152238" }}>Créances clients à ce jour</div>
          <div className="flex justify-between gap-2 py-1 text-sm"><span>Moins de 30 jours</span><span className="tabular" data-testid="sv-age-a">{svM(ages.a)}</span></div>
          <div className="flex justify-between gap-2 py-1 text-sm"><span>31 à 60 jours</span><span className="tabular" data-testid="sv-age-b">{svM(ages.b)}</span></div>
          <div className="flex justify-between gap-2 py-1 text-sm"><span>Plus de 60 jours</span><span className="tabular" data-testid="sv-age-c">{svM(ages.c)}</span></div></div>
      </div>
    );
  };

  // ───────── Statistiques ─────────
  const Stats = () => {
    const caT = svR2(ventesOk.reduce((s, v) => s + v.ht, 0)), depT = svR2(depsOk.reduce((s, d) => s + d.amount, 0));
    const mois = statMois(6, today);
    const data = mois.map((m) => ({ mois: m.label, rec: statSomme(ventesOk, "date", m.key, (x) => x.ht), dep: statSomme(depsOk, "date", m.key, (x) => x.amount) }));
    const grp = (rows, keyFn, amountFn) => { const o = {}; rows.forEach((x) => { const k = keyFn(x); o[k] = svR2((o[k] || 0) + amountFn(x)); }); return Object.keys(o).map((k) => ({ name: k, value: o[k] })); };
    return <StatsBloc
      vide={ventes.length + deps.length === 0 ? "Aucune activité pour le moment : les statistiques apparaîtront avec vos premières factures et dépenses." : ""}
      kpis={[["Chiffre d'affaires (total HT)", svM(caT), "sv-stat-ca"], ["Dépensé (total)", svM(depT), "sv-stat-dep"], ["Résultat", svM(svR2(caT - depT)), "sv-stat-resultat"], ["Clients", String(clients.length), "sv-stat-clients"]]}
      evolution={{ titre: "Chiffre d'affaires et dépenses — 6 derniers mois", data, series: [{ key: "rec", name: "Chiffre d'affaires", color: "#0F6B5C" }, { key: "dep", name: "Dépenses", color: "#A6432F" }] }}
      repartitions={[{ titre: "Chiffre d'affaires par client", data: grp(ventesOk, (v) => nomClient(v), (v) => v.ht) }, { titre: "Dépenses par nature", data: grp(depsOk, (d) => natureDep(d.kind), (d) => d.amount) }]}
    />;
  };

  // ───────── Facture imprimable ─────────
  const entete = (titre) => (
    <div style={{ textAlign: "center", marginBottom: 12 }}>
      {settings.companyLogo && <img src={settings.companyLogo} alt="" style={{ width: 60, height: 60, objectFit: "contain", margin: "0 auto 6px", display: "block" }} />}
      <div style={{ fontWeight: 700, fontSize: 20 }}>{settings.companyName || "Entreprise"}</div>
      {settings.companyAddress && <div style={{ fontSize: 12 }}>{settings.companyAddress}</div>}
      {settings.companyPhone && <div style={{ fontSize: 12 }}>{settings.companyPhone}</div>}
      {settings.companyNIF && <div style={{ fontSize: 12 }}>NIF : {settings.companyNIF}</div>}
      <div style={{ fontWeight: 700, fontSize: 18, marginTop: 10 }}>{titre}</div>
    </div>
  );
  const cellule = { padding: "4px 6px", border: "1px solid #bbb", overflowWrap: "anywhere", wordBreak: "break-word" };
  const cadre = { color: "#152238", background: "#fff", fontFamily: "'Inter', sans-serif", fontSize: 12, width: "100%", maxWidth: 794, margin: "0 auto", padding: (typeof window !== "undefined" && window.innerWidth < 640) ? "16px 10px" : "32px 36px", boxSizing: "border-box" };
  const FactureSheet = ({ v }) => {
    const th = { ...cellule, textAlign: "left", background: "#F4F1E6" };
    const paye = v.mode === "credit" ? svPaye(v.settlements) : v.total;
    const client = v.clientId ? clients.find((c) => c.id === v.clientId) : null;
    return (
      <div style={cadre} data-testid="sv-facture-feuille">
        {entete("FACTURE" + (v.status === "annulé" ? " — ANNULÉE" : ""))}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><span>Facture n° <b>{v.number}</b></span><span>Date : {ecDateFr(v.date)}</span></div>
        <div style={{ marginBottom: 8 }}>Client : <b>{nomClient(v)}</b>{client && client.address ? " — " + client.address : ""}</div>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}><thead><tr><th style={{ ...th, width: "46%" }}>Désignation</th><th style={{ ...th, textAlign: "right" }}>Qté</th><th style={{ ...th, textAlign: "right" }}>Prix unitaire</th><th style={{ ...th, textAlign: "right" }}>Montant</th></tr></thead>
          <tbody>{(v.lines || []).map((l, i) => (<tr key={i}><td style={cellule}>{l.label}</td><td style={{ ...cellule, textAlign: "right" }}>{l.qty}</td><td style={{ ...cellule, textAlign: "right" }}>{svM(l.pu)}</td><td style={{ ...cellule, textAlign: "right" }}>{svM(svR2(l.qty * l.pu))}</td></tr>))}</tbody></table>
        <div style={{ maxWidth: 320, marginLeft: "auto", marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Total hors taxe</span><span>{svM(v.ht)}</span></div>
          {v.tca > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span>Taxe ({v.tcaRate} %)</span><span>{svM(v.tca)}</span></div>}
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 15, borderTop: "1px solid #152238", marginTop: 4, paddingTop: 4 }}><span>Total à payer</span><span data-testid="sv-facture-total">{svM(v.total)}</span></div>
          {v.mode === "credit" && <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}><span>Déjà payé</span><span>{svM(paye)}</span></div>}
          {v.mode === "credit" && <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}><span>Reste à payer</span><span>{svM(svR2(v.total - paye))}</span></div>}
        </div>
        <div style={{ marginTop: 10 }}>{v.mode === "credit" ? "Payable à crédit." : "Réglée au comptant (" + (v.mode === "banque" ? "banque" : "espèces") + ")."}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 36 }}><div style={{ width: 240, borderTop: "1px solid #152238", paddingTop: 4, textAlign: "center" }}>Cachet et signature</div></div>
      </div>
    );
  };

  const tabs = isVendeur
    ? [["apercu", "Tableau de bord"], ["ventes", "Factures"], ["clients", "Clients"]]
    : [["apercu", "Tableau de bord"], ["ventes", "Factures"], ["prestations", "Prestations"], ["clients", "Clients"], ["contrats", "Contrats"], ["depenses", "Dépenses"], ["rapports", "Rapports"], ["stats", "Statistiques"]];
  const imprDoc = (() => {
    if (!imprimer) return null;
    if (imprimer.kind === "facture") { const v = ventes.find((x) => x.id === imprimer.id); return v ? { titre: "Facture " + v.number, node: <FactureSheet v={v} />, ticket: false } : null; }
    return null;
  })();
  return (
    <>
      {listes}
      <div className={"p-4 md:p-8 max-w-6xl" + (imprDoc ? " no-print" : "")} data-testid="services-module">
        <style>{EC_CSS + '[data-testid="services-module"] .display.text-base{border-left:3px solid #C9A24B;padding-left:10px;margin-bottom:12px}[data-testid="services-module"] input,[data-testid="services-module"] select{background:#fff;max-width:100%;min-width:0}[data-testid="services-module"] .grid>*{min-width:0}'}</style>
        <div className="mb-4"><div className="display text-2xl" style={{ color: "#152238" }}>{svType ? ((SV_TYPES.find((t) => t[0] === svType) || [0, "Services et prestations"])[1]) : "Services et prestations"}</div><div className="text-xs" style={{ color: "#8A8370" }}>Prestations, clients, factures, contrats mensuels, dépenses, rapports</div></div>
        {!canFront && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }}>Consultation seule : votre rôle ne permet pas de modifier les données.</div>}
        {isVendeur && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }} data-testid="sv-accueil-note">Caisse : vous pouvez enregistrer les clients, faire les factures de prestations et encaisser. Prestations, contrats, dépenses, annulations et rapports sont réservés aux gestionnaires.</div>}
        <div className="ec-tabs">
          {tabs.map(([id, l]) => (<button key={id} onClick={() => setTab(id)} data-testid={"sv-tab-" + id} className="px-3 py-2 text-sm rounded-lg transition-colors" style={{ background: tab === id ? "#152238" : "transparent", color: tab === id ? "#EFE9DD" : "#6B6552", fontWeight: tab === id ? 600 : 400 }}>{l}</button>))}
        </div>
        {tab === "apercu" && Apercu()}
        {tab === "ventes" && Ventes()}
        {tab === "prestations" && !isVendeur && Prestations()}
        {tab === "clients" && Clients()}
        {tab === "contrats" && !isVendeur && Contrats()}
        {tab === "depenses" && !isVendeur && Depenses()}
        {tab === "rapports" && !isVendeur && Rapports()}
        {tab === "stats" && !isVendeur && Stats()}
      </div>
      {imprDoc && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto p-3 md:p-8 no-print" style={{ background: "rgba(21,34,56,0.55)" }} onClick={() => setImprimer(null)} data-testid="sv-apercu-impression">
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 820 }}>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap"><div className="text-sm" style={{ color: "#EFE9DD" }}>{imprDoc.titre}</div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => { try { window.print(); } catch (e) {} }} className="px-3 py-1.5 rounded text-sm" style={ecBtnGold} data-testid="sv-imprimer-ok">Imprimer / enregistrer en PDF</button>
                <button onClick={() => setImprimer(null)} className="px-3 py-1.5 rounded text-sm" style={ecBtn} data-testid="sv-apercu-fermer">Fermer</button></div></div>
            <div className="rounded shadow-lg overflow-hidden" style={{ background: "#fff" }}>{imprDoc.node}</div>
          </div>
        </div>
      )}
      {imprDoc && <div className="print-only">{imprDoc.node}</div>}
    </>
  );
}

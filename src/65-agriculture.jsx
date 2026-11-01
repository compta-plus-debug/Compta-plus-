// ═══ MODULE ═══
// @module Agriculture
// @depends CURRENCIES, CURRENT_CURRENCY, EC_CSS, Plus, StatsBloc, ecBorder, ecBtn, ecBtnGold, ecDateFr
//   ecInput, ecPastille, ecTelecharger, fmt, isFutureDate, isLocked, statMois, statSomme, todayStr
//   uid, useBrouillon, useState
// @exports AgriModule
// ═══ FIN DE L'EN-TÊTE ═══
// Bloc Agriculture et élevage : cultures (parcelles, campagnes, récoltes), élevage (bandes et animaux, soins, production),
// intrants et stock, achats d'intrants, produits de la ferme (catalogue illustré), transformation simple, clients, ventes et factures
// (A4 ou ticket), dépenses de la ferme imputables à une campagne ou à une bande, rapports (rentabilité des campagnes, élevage) et statistiques.
// Rien n'est préréglé : prix, quantités, taux, dates et taxe sont saisis par l'entreprise.
//
// Comptabilité (tout en gourdes) :
//  • achat d'intrants : Débit 6021 / Crédit caisse, banque ou 401 (à payer) ; règlement d'une dette : Débit 401 / Crédit caisse ou banque ;
//  • facture de vente (produits, animaux vivants, services) : Débit 411 (net), 4191 (acompte imputé) / Crédit 7012 et 445 (taxe, seulement si activée) ;
//  • acompte de commande : Débit caisse ou banque / Crédit 4191 ; encaissement : Débit caisse ou banque / Crédit 411 ;
//  • dépense de la ferme : Débit 6022 achat d'animaux, 6132 location de terre, 6055 eau, irrigation et carburant, 6155 entretien, 6182 transport, 632 honoraires,
//    6612 main-d'œuvre journalière, 6282 autres / Crédit caisse, banque ou 401 ;
//  • toute annulation passe une écriture inverse.
// Le stock, les campagnes, les bandes, le coût de revient et la main-d'œuvre salariée imputée sont un suivi de gestion : la main-d'œuvre salariée se paie par le module
// Salaires (aucune écriture ici), et la valeur des récoltes, du cheptel et des stocks de fin d'exercice reste à passer avec l'expert-comptable.
// Les comptes 6021, 6022, 7012, 4191, 6055, 6132, 6155, 6182, 6282, 632 et 6612 sont à confirmer avec l'expert-comptable.

const AG_DEPENSES = [["main_oeuvre", "Main-d'œuvre journalière (journaliers)", "6612"], ["salarie", "Main-d'œuvre salariée imputée (déjà payée par Salaires, sans écriture)", ""], ["animaux", "Achat d'animaux", "6022"], ["veto", "Vétérinaire et agronome (honoraires)", "632"], ["terre", "Location de terre (fermage)", "6132"], ["energie", "Eau, irrigation, carburant", "6055"], ["entretien", "Entretien du matériel, clôtures et bâtiments", "6155"], ["transport", "Transport des récoltes et des animaux", "6182"], ["autre", "Autres frais", "6282"]];
const AG_ETATS_CMD = [["devis", "Devis"], ["confirmee", "Confirmée"], ["enprod", "En préparation"], ["prete", "Prête à livrer"], ["livree", "Livrée et facturée"], ["annulee", "Annulée"]];
const AG_COMPTES = {
  "411": { name: "Clients", type: "Actif" },
  "401": { name: "Fournisseurs", type: "Passif" },
  "445": { name: "Taxe collectée sur ventes (IVA/TCA)", type: "Passif" },
  "4191": { name: "Clients — avances et acomptes reçus", type: "Passif" },
  "6021": { name: "Achats d'intrants agricoles (semences, engrais, aliments, produits vétérinaires)", type: "Charge" },
  "6022": { name: "Achats d'animaux d'élevage (poussins, alevins, reproducteurs)", type: "Charge" },
  "6055": { name: "Eau d'irrigation, énergie et carburant agricole", type: "Charge" },
  "6132": { name: "Location de terres agricoles (fermage)", type: "Charge" },
  "6155": { name: "Entretien du matériel agricole, des clôtures et des bâtiments d'élevage", type: "Charge" },
  "6182": { name: "Transport des récoltes et des animaux", type: "Charge" },
  "6282": { name: "Autres frais d'exploitation agricole", type: "Charge" },
  "632": { name: "Honoraires (vétérinaire, agronome)", type: "Charge" },
  "6612": { name: "Main-d'œuvre agricole (journaliers)", type: "Charge" },
  "7012": { name: "Ventes de produits agricoles et d'animaux d'élevage", type: "Produit" },
  "512": { name: "Banque", type: "Actif" },
  "530": { name: "Caisse", type: "Actif" },
};
// Montants unitaires (coût par unité, coût par tête, prix, marge par unité) : toujours 2 décimales, sinon 6,50 s'afficherait « 7 ».
const agF = (n) => {
  const code = CURRENT_CURRENCY;
  const locale = (CURRENCIES[code] && CURRENCIES[code].locale) || "fr-FR";
  try { return new Intl.NumberFormat(locale, { style: "currency", currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); } catch (e) { return (Math.round((n || 0) * 100) / 100).toFixed(2) + " " + code; }
};
const agR2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const agQ = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const agId = () => String(uid());
const agRows = (rows, type) => (rows || []).filter((r) => r && r.type === type);
const AG_CATS = [["cereales", "Céréales et légumineuses"], ["legumes", "Légumes"], ["fruits", "Fruits"], ["racines", "Racines et tubercules"], ["cafe", "Café, cacao et épices"], ["animaux", "Élevage et produits animaux"], ["transforme", "Produits transformés"], ["autre", "Autres produits"]];
const AG_ESPECES = [["volaille", "Volaille (poules, poulets, dindes)", "lot"], ["poisson", "Poissons (bassin)", "lot"], ["lapin", "Lapins", "lot"], ["porcin", "Porcs", "individuel"], ["caprin", "Chèvres et moutons", "individuel"], ["bovin", "Bovins", "individuel"], ["autre", "Autre élevage", "lot"]];
const AG_MOUV = [["mortalite", "Mortalité"], ["naissance", "Naissances ou éclosions"], ["achat", "Animaux achetés"], ["perte", "Vol ou animaux perdus"], ["autoconso", "Consommation de la ferme ou don"]];
const AG_SOINS = [["vaccin", "Vaccin"], ["vermifuge", "Vermifuge"], ["soin", "Soin ou traitement"], ["pesee", "Pesée"], ["autre", "Autre intervention"]];
const AG_MOTIFS_PERTE = [["destockage", "Écoulement (produit abîmé, trop mûr ou en excès)"], ["promo", "Promotion décidée par la direction"], ["geste", "Geste commercial (client important)"], ["erreur", "Prix ou coût mal calculé : à corriger"], ["autre", "Autre raison (à préciser)"]];
const agMotifLibelle = (k, t) => (k === "autre" ? (t || "autre raison") : ((AG_MOTIFS_PERTE.find((m) => m[0] === k) || [0, ""])[1] || ""));
// Réduit la photo d'un produit (420 px, JPEG) pour qu'elle reste légère dans la sauvegarde.
function agRedimensionner(file, max) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("lecture"));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("image"));
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.72));
      };
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });
}
const agNom = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const agUniq = (arr) => Array.from(new Set(arr.map((x) => String(x || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
const agJours = (a, b) => (a && b ? Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000) : 0);
function agAjouterComptes(accounts, setAccounts, codes) {
  const missing = [...new Set(codes)].filter((k) => AG_COMPTES[k] && !accounts.some((a) => a.code === k)).map((k) => ({ code: k, name: AG_COMPTES[k].name, type: AG_COMPTES[k].type }));
  if (missing.length) setAccounts((prev) => [...prev, ...missing.filter((m) => !prev.some((a) => a.code === m.code))]);
}
const agPaye = (arr) => agR2((arr || []).filter((p) => p.status !== "annulé").reduce((s, p) => s + p.amount, 0));
// Solde d'une facture (gourdes)
function agSolde(f) { const paye = agPaye(f.payments); return { paye, reste: agR2((f.net || 0) - paye) }; }
const agMontantLignes = (lines) => agR2((lines || []).reduce((s, l) => s + agR2(l.qty * l.pu), 0));

function AgriModule({ suppliers, agri, setAgri, entries, setEntries, accounts, setAccounts, settings, role, showToast, logAudit, currentUserEmail }) {
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const isVendeur = role === "Vendeur"; // accueil : clients, commandes, ventes et encaissements
  const canFront = canEdit || isVendeur;
  const today = todayStr();
  const moisCourant = today.slice(0, 7);
  const [tab, setTab] = useState("apercu");
  const clients = agRows(agri, "client");
  const mats = agRows(agri, "mat");
  const achats = agRows(agri, "achat");
  const prods = agRows(agri, "prod");
  const recettes = agRows(agri, "rec");
  const lots = agRows(agri, "lot");
  const cmds = agRows(agri, "cmd");
  const facts = agRows(agri, "fact");
  const deps = agRows(agri, "dep");
  const ajusts = agRows(agri, "ajust");
  const cfg = agRows(agri, "config")[0] || {};
  const catsAll = [...AG_CATS, ...agRows(agri, "cat").map((c) => [c.id, c.label])];
  const catDe = (p) => (catsAll.some((c) => c[0] === p.cat) ? p.cat : "autre");
  const tcaOn = !!cfg.tcaOn;
  const tcaRate = tcaOn ? Number(settings.taxRate) || 0 : 0;
  const nomClient = (id) => (clients.find((x) => x.id === id) || {}).name || "Client de passage";
  const nomMat = (id) => (mats.find((x) => x.id === id) || {}).name || "—";
  const unitMat = (id) => (mats.find((x) => x.id === id) || {}).unit || "";
  const nomProd = (id) => (prods.find((x) => x.id === id) || {}).name || "—";
  const unitProd = (id) => (prods.find((x) => x.id === id) || {}).unit || "";
  const compteMode = (m) => (m === "banque" ? "512" : m === "apayer" ? "401" : "530");
  const maj = (id, fn) => setAgri((prev) => (prev || []).map((r) => (r.id === id ? fn(r) : r)));
  // Copie toujours à jour des données : deux clics rapides ne passent plus le contrôle des doublons avant la mise à jour de l'écran.
  const agriRef = React.useRef(agri || []);
  agriRef.current = agri || [];
  const lignesAJour = (type) => agRows(agriRef.current, type);
  const ajouter = (rec) => { agriRef.current = [...agriRef.current, rec]; setAgri((prev) => ((prev || []).some((r) => r && r.id === rec.id) ? prev : [...(prev || []), rec])); };
  const ecrire = (date, label, lines, dossierId) => {
    const e = { id: uid(), date, createdAt: new Date().toISOString(), label, lines: lines.filter((l) => l.debit > 0 || l.credit > 0), kind: "agri", dossierId };
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
  // ── Stock (suivi de gestion) ──
  const lotsOk = lots.filter((l) => l.status !== "annulé");
  const achatsOk = achats.filter((a) => a.status !== "annulé");
  const ajOk = ajusts.filter((a) => a.status !== "annulé");
  const factsOk = facts.filter((f) => f.status !== "annulee");
  const stockMat = (id) => agQ(achatsOk.filter((a) => a.matId === id).reduce((s, a) => s + a.qty, 0) - lotsOk.reduce((s, l) => s + (l.lines || []).filter((x) => x.matId === id).reduce((t, x) => t + x.qty, 0), 0) - usagesOk.filter((u) => u.matId === id).reduce((s, u) => s + u.qty, 0) + ajOk.filter((a) => a.target === "mat" && a.refId === id).reduce((s, a) => s + a.qty, 0));
  const stockProd = (id) => agQ(lotsOk.filter((l) => l.productId === id).reduce((s, l) => s + l.qty, 0) + recoltesOk.filter((r) => r.productId === id).reduce((s, r) => s + r.qty, 0) - lotsOk.filter((l) => l.srcProdId === id).reduce((s, l) => s + (l.srcQty || 0), 0) - factsOk.reduce((s, f) => s + (f.lines || []).filter((x) => x.productId === id).reduce((t, x) => t + x.qty, 0), 0) + ajOk.filter((a) => a.target === "prod" && a.refId === id).reduce((s, a) => s + a.qty, 0));
  const prixMoyen = (id) => { const a = achatsOk.filter((x) => x.matId === id); const q = a.reduce((s, x) => s + x.qty, 0); return q > 0 ? Math.round(a.reduce((s, x) => s + x.amount, 0) / q * 10000) / 10000 : 0; };
  const coutLot = (l) => { const m = agR2((l.lines || []).reduce((s, x) => s + x.cost, 0)); const mo = agR2((l.hours || 0) * (l.rate || 0)); const fr = agR2(l.frais || 0); const src = agR2(l.srcCost || 0); return { m, mo, fr, src, total: agR2(m + mo + fr + src) }; };
  // coût de revient moyen d'une unité du produit (moyenne des lots transformés : intrants + main-d'œuvre + frais) ; 0 = pas encore de lot
  // coût de revient moyen d'une unité du produit : récoltes des campagnes + production des bandes + lots transformés (0 = pas encore de données)
  const coutUnit = (id) => {
    let q = 0, c = 0;
    lotsOk.filter((l) => l.productId === id).forEach((l) => { q += l.qty; c += coutLot(l).total; });
    camps.filter((x) => x.productId === id && x.status !== "annulee").forEach((x) => { const r = recolteCamp(x); if (r > 0) { q += r; c += coutCamp(x).total; } });
    bandes.filter((x) => x.productId === id).forEach((x) => { const r = prodBande(x); if (r > 0) { q += r; c += coutBande(x, false).total; } });
    return q > 0 ? agR2(c / q) : 0;
  };
  const etatCmd = (c) => (AG_ETATS_CMD.find((e) => e[0] === c.status) || [0, c.status])[1];
  // ── Fermes : parcelles, campagnes, récoltes, élevage (suivi de gestion) ──
  const parcs = agRows(agri, "parc");
  const camps = agRows(agri, "camp");
  const usages = agRows(agri, "usage");
  const recoltes = agRows(agri, "recolte");
  const bandes = agRows(agri, "bande");
  const mouvs = agRows(agri, "mouv");
  const animaux = agRows(agri, "animal");
  const soins = agRows(agri, "soin");
  const usagesOk = usages.filter((u) => u.status !== "annulé");
  const recoltesOk = recoltes.filter((r) => r.status !== "annulé");
  const mouvsOk = mouvs.filter((m) => m.status !== "annulé");
  const depsOk = deps.filter((d) => d.status !== "annulé");
  const nomParc = (id) => (parcs.find((x) => x.id === id) || {}).name || "—";
  const nomBande = (id) => (bandes.find((x) => x.id === id) || {}).name || "—";
  const especeLib = (k) => (AG_ESPECES.find((e) => e[0] === k) || [0, k])[1];
  const coutCamp = (c) => { const u = agR2(usagesOk.filter((x) => x.campId === c.id).reduce((s, x) => s + x.cost, 0)); const f = agR2(depsOk.filter((x) => x.campId === c.id).reduce((s, x) => s + x.amount, 0)); return { u, f, total: agR2(u + f) }; };
  const recolteCamp = (c) => agQ(recoltesOk.filter((r) => r.campId === c.id).reduce((s, r) => s + r.qty, 0));
  // coût d'une bande : intrants (aliment, soins) + dépenses imputées ; « avecAchat » compte aussi l'achat des animaux
  const coutBande = (b, avecAchat) => { const u = agR2(usagesOk.filter((x) => x.bandeId === b.id).reduce((s, x) => s + x.cost, 0)); const f = agR2(depsOk.filter((x) => x.bandeId === b.id && (avecAchat || x.kind !== "animaux")).reduce((s, x) => s + x.amount, 0)); return { u, f, total: agR2(u + f) }; };
  const animauxDe = (b) => animaux.filter((a) => a.bandeId === b.id);
  const animalVendu = (a) => factsOk.some((f) => (f.lines || []).some((l) => l.animalId === a.id));
  const animalPresent = (a) => a.status !== "mort" && !animalVendu(a);
  const vendusTetes = (b) => agQ(factsOk.reduce((s, f) => s + (f.lines || []).filter((l) => l.bandeId === b.id).reduce((t, l) => t + l.qty, 0), 0));
  const mvt = (b, kind) => agQ(mouvsOk.filter((m) => m.bandeId === b.id && m.kind === kind).reduce((s, m) => s + m.qty, 0));
  // têtes ayant vécu dans la bande (sans retirer les ventes) : base du coût par tête
  const tetesVecu = (b) => (b.mode === "individuel" ? animauxDe(b).filter((a) => a.status !== "mort").length : agQ((b.count0 || 0) + mvt(b, "naissance") + mvt(b, "achat") - mvt(b, "mortalite") - mvt(b, "perte") - mvt(b, "autoconso")));
  const effectif = (b) => (b.mode === "individuel" ? animauxDe(b).filter(animalPresent).length : agQ(tetesVecu(b) - vendusTetes(b)));
  const coutTete = (b) => { const n = tetesVecu(b); return n > 0 ? agR2(coutBande(b, true).total / n) : 0; };
  const mortalitePct = (b) => { const base = agQ((b.count0 || 0) + mvt(b, "naissance") + mvt(b, "achat")); return base > 0 ? Math.round(mvt(b, "mortalite") * 1000 / base) / 10 : 0; };
  const prodBande = (b) => agQ(recoltesOk.filter((r) => r.bandeId === b.id).reduce((s, r) => s + r.qty, 0));
  const isVivant = (id) => String(id || "").startsWith("bande:") || String(id || "").startsWith("animal:");
  const vivantLabel = (id, dflt) => { const x = String(id || ""); if (x.startsWith("bande:")) { const b = bandes.find((y) => y.id === x.slice(6)); return b ? "Animaux — " + b.name : dflt; } if (x.startsWith("animal:")) { const a = animaux.find((y) => y.id === x.slice(7)); return a ? "Animal — " + a.tag + " (" + nomBande(a.bandeId) + ")" : dflt; } return dflt; };
  const [nouvCat, setNouvCat] = useState("");
  const [imprimer, setImprimer] = useState(null); // { kind: "devis" | "facture" | "lot", id }
  const [tk, setTk] = useState(false);
  const [selCmd, setSelCmd] = useState("");
  const [selFact, setSelFact] = useState("");
  const [selProd, setSelProd] = useState("");
  const [selLot, setSelLot] = useState("");
  const listes = (<><datalist id="ag-dl-unit">{agUniq(["kg", "livre", "sac", "marmite", "régime", "douzaine", "plateau", "litre", "pièce", "tête", "botte", "boîte", ...mats.map((m) => m.unit), ...prods.map((p) => p.unit)]).map((n) => <option key={n} value={n} />)}</datalist><datalist id="ag-dl-four">{agUniq([...(suppliers || []).map((x) => x.name), ...achats.map((a) => a.supplier), ...deps.map((d) => d.supplier)]).map((n) => <option key={n} value={n} />)}</datalist></>);

  // ───────── Clients ─────────
  const [fcl, setFcl] = useBrouillon("agri-client", { name: "", phone: "", address: "" });
  const [cq, setCq] = useState("");
  const ajouterClient = () => {
    if (!canFront) return;
    const name = fcl.name.trim();
    if (!name) { showToast("Indiquez le nom du client."); return; }
    if (lignesAJour("client").some((c) => agNom(c.name) === agNom(name))) { showToast("Un client de ce nom existe déjà."); return; }
    ajouter({ type: "client", id: agId(), name, phone: fcl.phone.trim(), address: fcl.address.trim() });
    setFcl({ name: "", phone: "", address: "" });
    showToast("Client « " + name + " » ajouté."); logAudit("Agriculture et élevage", "Client ajouté", name);
  };
  const Clients = () => {
    const rows = clients.filter((c) => !cq.trim() || [c.name, c.phone, c.address].join(" ").toLowerCase().includes(cq.trim().toLowerCase()));
    const dus = (c) => agR2(factsOk.filter((f) => f.clientId === c.id).reduce((s, f) => s + agSolde(f).reste, 0));
    return (
      <div>
        {canFront && (<div className="ec-card p-4 mb-5"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouveau client</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom</label><input value={fcl.name} onChange={(e) => setFcl({ ...fcl, name: e.target.value })} data-testid="ag-cl-nom" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Téléphone</label><input value={fcl.phone} onChange={(e) => setFcl({ ...fcl, phone: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Adresse</label><input value={fcl.address} onChange={(e) => setFcl({ ...fcl, address: e.target.value })} className={ecInput} style={ecBorder} /></div>
          </div>
          <button onClick={ajouterClient} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-cl-ajouter">Ajouter le client</button></div>)}
        <div className="mb-2"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (nom, téléphone, adresse)</label><input value={cq} onChange={(e) => setCq(e.target.value)} data-testid="ag-cl-recherche" className={ecInput} style={ecBorder} /></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Client</th><th>Téléphone</th><th>Adresse</th><th className="text-right">Commandes</th><th className="text-right">Reste dû</th></tr></thead>
          <tbody>{rows.map((c) => (<tr key={c.id} data-testid="ag-cl-ligne"><td className="py-1.5 font-semibold">{c.name}</td><td>{c.phone || "—"}</td><td className="text-xs">{c.address || "—"}</td><td className="text-right tabular">{cmds.filter((x) => x.clientId === c.id && x.status !== "annulee").length}</td><td className="text-right tabular">{fmt(dus(c))}</td></tr>))}</tbody>
          {rows.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="ag-cl-total-ligne"><td colSpan={4}>Total ({rows.length} client{rows.length > 1 ? "s" : ""})</td><td className="text-right tabular" data-testid="ag-cl-tot-du">{fmt(agR2(rows.reduce((s, c) => s + dus(c), 0)))}</td></tr></tfoot>}</table></div>
        {rows.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{clients.length === 0 ? "Aucun client. Les ventes au comptoir peuvent se faire sans client (« client de passage »)." : "Aucun client ne correspond à la recherche."}</div>}
      </div>
    );
  };

  // ───────── Intrants et achats ─────────
  const [fm, setFm] = useBrouillon("agri-mat", { name: "", unit: "", min: "" });
  const [fa, setFa] = useBrouillon("agri-achat", { matId: "", date: todayStr(), qty: "", amount: "", supplier: "", mode: "caisse" });
  const [fadj, setFadj] = useState({ qty: "", reason: "" });
  const [rg, setRg] = useState({ amount: "", date: todayStr(), mode: "caisse" });
  const [mq, setMq] = useState(""); const [mb, setMb] = useState("");
  const [selMat, setSelMat] = useState(""); const [selAchat, setSelAchat] = useState("");
  const ajouterMat = () => {
    if (!canEdit) return;
    const name = fm.name.trim();
    if (!name) { showToast("Indiquez le nom de l'intrant (ex. Semences de maïs, Engrais, Aliment poulet)."); return; }
    if (!fm.unit.trim()) { showToast("Indiquez l'unité (kg, sac, litre, tête…)."); return; }
    if (lignesAJour("mat").some((m) => agNom(m.name) === agNom(name))) { showToast("Un intrant de ce nom existe déjà."); return; }
    const min = agQ(fm.min);
    if (min < 0) { showToast("Le seuil d'alerte ne peut pas être négatif."); return; }
    ajouter({ type: "mat", id: agId(), name, unit: fm.unit.trim(), min, active: true });
    setFm({ name: "", unit: "", min: "" });
    showToast("Intrant « " + name + " » ajouté."); logAudit("Agriculture et élevage", "Intrant ajouté", name);
  };
  const acheter = () => {
    if (!canEdit) return;
    const qty = agQ(fa.qty), amount = agR2(fa.amount);
    if (!fa.matId) { showToast("Choisissez l'intrant acheté."); return; }
    if (!(qty > 0)) { showToast("La quantité doit être supérieure à zéro."); return; }
    if (!(amount > 0)) { showToast("Indiquez le montant total payé (en gourdes)."); return; }
    if (fa.mode === "apayer" && !fa.supplier.trim()) { showToast("Pour un achat à payer plus tard, indiquez le fournisseur."); return; }
    if (!verifDate(fa.date, "enregistrer cet achat")) return;
    const cpt = compteMode(fa.mode);
    agAjouterComptes(accounts, setAccounts, ["6021", cpt]);
    const e = ecrire(fa.date, "Achat " + nomMat(fa.matId) + (fa.supplier.trim() ? " — " + fa.supplier.trim() : ""), [{ account: "6021", debit: amount, credit: 0 }, { account: cpt, debit: 0, credit: amount }], fa.matId);
    ajouter({ type: "achat", id: agId(), date: fa.date, matId: fa.matId, qty, amount, supplier: fa.supplier.trim(), mode: fa.mode, entryId: e.id, status: "valide", settlements: [], by: currentUserEmail || "" });
    setFa({ ...fa, qty: "", amount: "" });
    showToast("Achat enregistré : " + qty + " " + unitMat(fa.matId) + " pour " + fmt(amount) + "."); logAudit("Agriculture et élevage", "Achat d'intrant", nomMat(fa.matId) + " — " + fmt(amount));
  };
  const resteAchat = (a) => (a.mode === "apayer" && a.status !== "annulé" ? agR2(a.amount - agPaye(a.settlements)) : 0);
  const annulerAchat = (a) => {
    if (!canEdit || a.status === "annulé") return;
    if (agPaye(a.settlements) > 0) { showToast("Annulez d'abord les règlements de cet achat."); return; }
    if (stockMat(a.matId) - a.qty < -0.0005) { showToast("Annulation impossible : cet intrant a déjà été utilisé dans des lots (le stock deviendrait négatif)."); return; }
    if (!verifDate(today, "annuler cet achat")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler cet achat ? Une écriture inverse sera passée.")) return;
    const e = contre(a.entryId, "Annulation achat " + nomMat(a.matId) + " (écriture inverse)", today, a.matId);
    maj(a.id, (r) => ({ ...r, status: "annulé", reversalEntryId: e ? e.id : "" }));
    showToast("Achat annulé.");
  };
  const reglerAchat = (a) => {
    if (!canEdit || a.mode !== "apayer" || a.status === "annulé") return;
    const reste = resteAchat(a);
    const amount = rg.amount === "" ? reste : agR2(rg.amount);
    if (!(amount > 0) || amount > reste + 0.004) { showToast("Le montant doit être compris entre 0 et le reste à payer (" + fmt(reste) + ")."); return; }
    if (!verifDate(rg.date, "enregistrer ce règlement")) return;
    const cpt = compteMode(rg.mode === "banque" ? "banque" : "caisse");
    agAjouterComptes(accounts, setAccounts, [cpt, "401"]);
    const e = ecrire(rg.date, "Règlement " + (a.supplier || "fournisseur") + " — " + nomMat(a.matId), [{ account: "401", debit: amount, credit: 0 }, { account: cpt, debit: 0, credit: amount }], a.id);
    maj(a.id, (r) => ({ ...r, settlements: [...(r.settlements || []), { id: agId(), date: rg.date, amount, mode: rg.mode, entryId: e.id, status: "valide" }] }));
    setRg({ ...rg, amount: "" }); showToast("Règlement de " + fmt(amount) + " enregistré."); logAudit("Agriculture et élevage", "Dette réglée", (a.supplier || "") + " — " + fmt(amount));
  };
  const annulerReglement = (a, s) => {
    if (!canEdit || s.status === "annulé") return;
    if (!verifDate(today, "annuler ce règlement")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler ce règlement ? Une écriture inverse sera passée.")) return;
    const e = contre(s.entryId, "Annulation règlement " + (a.supplier || "") + " (écriture inverse)", today, a.id);
    maj(a.id, (r) => ({ ...r, settlements: r.settlements.map((x) => (x.id === s.id ? { ...x, status: "annulé", reversalEntryId: e ? e.id : "" } : x)) }));
    showToast("Règlement annulé.");
  };
  const ajusterStock = (target, refId) => {
    if (!canEdit) return;
    const qty = agQ(fadj.qty);
    if (qty === 0) { showToast("Indiquez la quantité à retirer (négatif) ou à ajouter (positif)."); return; }
    if (!fadj.reason.trim()) { showToast("Indiquez le motif (casse, perte, inventaire, don…)."); return; }
    const courant = target === "mat" ? stockMat(refId) : stockProd(refId);
    if (courant + qty < -0.0005) { showToast("Le stock ne peut pas devenir négatif (stock actuel : " + courant + ")."); return; }
    ajouter({ type: "ajust", id: agId(), date: today, target, refId, qty, reason: fadj.reason.trim(), status: "valide", by: currentUserEmail || "" });
    setFadj({ qty: "", reason: "" });
    showToast("Stock ajusté."); logAudit("Agriculture et élevage", "Ajustement de stock", (target === "mat" ? nomMat(refId) : nomProd(refId)) + " : " + qty + " — " + fadj.reason.trim());
  };
  const Matieres = () => {
    const etatMat = (m) => (m.active === false ? "arret" : stockMat(m.id) <= (m.min || 0) && (m.min || 0) > 0 ? "bas" : "ok");
    const rows = mats.filter((m) => (!mb || etatMat(m) === mb) && (!mq.trim() || [m.name, m.unit].join(" ").toLowerCase().includes(mq.trim().toLowerCase())));
    const valeur = (m) => agR2(stockMat(m.id) * prixMoyen(m.id));
    const m = mats.find((x) => x.id === selMat);
    return (
      <div>
        {canEdit && (<div className="grid md:grid-cols-2 gap-4 mb-5">
          <div className="ec-card p-4"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvel intrant</div>
            <div className="grid grid-cols-2 gap-2 items-end">
              <div className="col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom (semences de maïs, engrais NPK, aliment poulet, vaccin…)</label><input value={fm.name} onChange={(e) => setFm({ ...fm, name: e.target.value })} data-testid="ag-mat-nom" className={ecInput} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Unité</label><input list="ag-dl-unit" value={fm.unit} onChange={(e) => setFm({ ...fm, unit: e.target.value })} data-testid="ag-mat-unite" className={ecInput} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Seuil d'alerte (facultatif)</label><input type="number" min="0" step="0.001" value={fm.min} onChange={(e) => setFm({ ...fm, min: e.target.value })} data-testid="ag-mat-seuil" className={ecInput + " tabular"} style={ecBorder} /></div>
            </div>
            <button onClick={ajouterMat} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-mat-ajouter">Ajouter l'intrant</button></div>
          <div className="ec-card p-4"><div className="display text-base mb-2" style={{ color: "#152238" }}>Acheter des intrants</div>
            <div className="grid grid-cols-2 gap-2 items-end">
              <div className="col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Intrant</label><select value={fa.matId} onChange={(e) => setFa({ ...fa, matId: e.target.value })} data-testid="ag-ach-mat" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{mats.filter((x) => x.active !== false).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Quantité achetée</label><input type="number" min="0" step="0.001" value={fa.qty} onChange={(e) => setFa({ ...fa, qty: e.target.value })} data-testid="ag-ach-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant total payé</label><input type="number" min="0" step="0.01" value={fa.amount} onChange={(e) => setFa({ ...fa, amount: e.target.value })} data-testid="ag-ach-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" value={fa.date} max={today} onChange={(e) => setFa({ ...fa, date: e.target.value })} data-testid="ag-ach-date" className={ecInput} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Fournisseur</label><input list="ag-dl-four" value={fa.supplier} onChange={(e) => setFa({ ...fa, supplier: e.target.value })} data-testid="ag-ach-fournisseur" className={ecInput} style={ecBorder} /></div>
              <div className="col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Paiement</label><select value={fa.mode} onChange={(e) => setFa({ ...fa, mode: e.target.value })} data-testid="ag-ach-mode" className={ecInput} style={ecBorder}><option value="caisse">Payé en caisse</option><option value="banque">Payé par la banque</option><option value="apayer">À payer plus tard (dette fournisseur)</option></select></div>
            </div>
            <button onClick={acheter} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-ach-enregistrer">Enregistrer l'achat</button></div>
        </div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <div className="flex-1 min-w-[150px]"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (nom, unité)</label><input value={mq} onChange={(e) => setMq(e.target.value)} data-testid="ag-mat-recherche" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>État du stock</label><select value={mb} onChange={(e) => setMb(e.target.value)} data-testid="ag-mat-filtre-etat" className={ecInput} style={ecBorder}><option value="">Tous</option><option value="bas">Stock bas</option><option value="ok">Normal</option><option value="arret">Arrêtée</option></select></div>
        </div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Intrant</th><th>Unité</th><th className="text-right">En stock</th><th className="text-right">Prix moyen d'achat</th><th className="text-right">Valeur du stock</th><th>État</th><th></th></tr></thead>
          <tbody>{rows.map((x) => { const e = etatMat(x); return (
            <tr key={x.id} data-testid="ag-mat-ligne" style={{ background: x.id === selMat ? "#E6F1EE" : undefined, opacity: e === "arret" ? 0.55 : 1 }}><td className="py-1.5 font-semibold">{x.name}</td><td>{x.unit}</td><td className="text-right tabular" data-testid="ag-mat-stock">{stockMat(x.id)}</td><td className="text-right tabular">{prixMoyen(x.id) ? fmt(prixMoyen(x.id)) : "—"}</td><td className="text-right tabular">{fmt(valeur(x))}</td>
              <td>{e === "bas" ? ecPastille("Stock bas", "alerte") : e === "arret" ? ecPastille("Arrêtée", "neutre") : ecPastille("Normal", "ok")}</td>
              <td className="text-right"><button onClick={() => setSelMat(x.id === selMat ? "" : x.id)} className="text-xs underline" data-testid="ag-mat-ouvrir">{x.id === selMat ? "Fermer" : "Ouvrir"}</button></td></tr>); })}</tbody>
          {rows.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="ag-mat-total-ligne"><td colSpan={4}>Total ({rows.length} intrant{rows.length > 1 ? "s" : ""})</td><td className="text-right tabular" data-testid="ag-mat-tot-valeur">{fmt(agR2(rows.reduce((s, x) => s + valeur(x), 0)))}</td><td colSpan={2}></td></tr></tfoot>}</table></div>
        {rows.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{mats.length === 0 ? "Aucun intrant." : "Aucun intrant ne correspond à ces filtres."}</div>}
        {m && (<div className="ec-card p-4 mt-5" data-testid="ag-mat-detail">
          <div className="display text-lg mb-2" style={{ color: "#152238" }}>{m.name} — en stock : <span className="tabular" data-testid="ag-mat-d-stock">{stockMat(m.id)}</span> {m.unit}</div>
          <div className="grid md:grid-cols-3 gap-2 mb-3 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Seuil d'alerte</label><input type="number" min="0" step="0.001" value={m.min || 0} disabled={!canEdit} onChange={(e) => maj(m.id, (r) => ({ ...r, min: Math.max(0, agQ(e.target.value)) }))} data-testid="ag-mat-d-seuil" className={ecInput + " tabular"} style={ecBorder} /></div>
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={m.active !== false} disabled={!canEdit} onChange={(e) => maj(m.id, (r) => ({ ...r, active: e.target.checked }))} data-testid="ag-mat-actif" />Intrant utilisé (décochez si arrêté)</label>
          </div>
          {canEdit && (<div className="grid md:grid-cols-4 gap-2 mb-3 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Ajuster le stock (− retire, + ajoute)</label><input type="number" step="0.001" value={fadj.qty} onChange={(e) => setFadj({ ...fadj, qty: e.target.value })} data-testid="ag-adj-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Motif (casse, perte, inventaire…)</label><input value={fadj.reason} onChange={(e) => setFadj({ ...fadj, reason: e.target.value })} data-testid="ag-adj-motif" className={ecInput} style={ecBorder} /></div>
            <button onClick={() => ajusterStock("mat", m.id)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ag-adj-ok">Ajuster</button>
          </div>)}
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Achats de cet intrant</div>
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Fournisseur</th><th className="text-right">Quantité</th><th className="text-right">Montant</th><th>Paiement</th><th></th></tr></thead>
            <tbody>{achats.filter((a) => a.matId === m.id).map((a) => (<tr key={a.id} data-testid="ag-ach-ligne" style={{ opacity: a.status === "annulé" ? 0.5 : 1 }}><td className="py-1.5">{ecDateFr(a.date)}</td><td>{a.supplier || "—"}</td><td className="text-right tabular">{a.qty}</td><td className="text-right tabular">{fmt(a.amount)}</td>
              <td>{a.status === "annulé" ? ecPastille("Annulé", "neutre") : a.mode === "apayer" ? (resteAchat(a) > 0.004 ? ecPastille("À payer : " + fmt(resteAchat(a)), "attente") : ecPastille("Payé", "ok")) : ecPastille(a.mode === "banque" ? "Banque" : "Caisse", "ok")}</td>
              <td className="text-right whitespace-nowrap">{canEdit && a.mode === "apayer" && a.status !== "annulé" && <button onClick={() => setSelAchat(a.id === selAchat ? "" : a.id)} className="text-xs underline mr-2" data-testid="ag-ach-regler">Régler</button>}{canEdit && a.status !== "annulé" && <button onClick={() => annulerAchat(a)} className="text-xs underline" data-testid="ag-ach-annuler">Annuler</button>}</td></tr>))}</tbody></table></div>
          {achats.filter((a) => a.matId === m.id).length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun achat enregistré.</div>}
          {canEdit && achats.filter((a) => a.id === selAchat && a.matId === m.id).map((a) => (<div key={a.id} className="ec-card p-3 mt-3" data-testid="ag-reg-form"><div className="text-sm mb-2">Règlement de {a.supplier || "fournisseur"} — reste à payer <b className="tabular">{fmt(resteAchat(a))}</b></div>
            <div className="grid md:grid-cols-4 gap-2 items-end">
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant (vide = tout le reste)</label><input type="number" min="0" step="0.01" value={rg.amount} onChange={(e) => setRg({ ...rg, amount: e.target.value })} data-testid="ag-reg-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={rg.date} onChange={(e) => setRg({ ...rg, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Mode</label><select value={rg.mode} onChange={(e) => setRg({ ...rg, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Caisse</option><option value="banque">Banque</option></select></div>
              <button onClick={() => reglerAchat(a)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-reg-valider">Enregistrer le règlement</button>
            </div>
            {(a.settlements || []).map((s) => (<div key={s.id} className="text-xs mt-1" data-testid="ag-reg-ligne" style={{ opacity: s.status === "annulé" ? 0.5 : 1 }}>{ecDateFr(s.date)} — {fmt(s.amount)} ({s.mode === "banque" ? "banque" : "caisse"}){s.status === "annulé" ? " — annulé" : <button onClick={() => annulerReglement(a, s)} className="underline ml-2" data-testid="ag-reg-annuler">Annuler</button>}</div>))}
          </div>))}
        </div>)}
      </div>
    );
  };

  // ───────── Produits et prix ─────────
  const [fp, setFp] = useBrouillon("agri-produit", { name: "", unit: "", price: "", cat: "", desc: "", photo: "" });
  const [pq, setPq] = useState("");
  const [fr, setFr] = useState({ outQty: "", matId: "", qty: "" });
  const choisirPhoto = async (e, prodId) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { const url = await agRedimensionner(f, 420); if (prodId) maj(prodId, (r) => ({ ...r, photo: url })); else setFp((x) => ({ ...(x || {}), photo: url })); showToast("Photo ajoutée (réduite à 420 px pour rester légère)."); }
    catch (err) { showToast("Cette image n'a pas pu être lue. Essayez un fichier JPG ou PNG."); }
  };
  const ajouterProd = () => {
    if (!canEdit) return;
    const name = fp.name.trim();
    if (!name) { showToast("Indiquez le nom du produit (ex. Maïs, Poulet de chair, Œufs)."); return; }
    if (!fp.unit.trim()) { showToast("Indiquez l'unité de vente (kg, sac, régime, douzaine, tête…)."); return; }
    if (lignesAJour("prod").some((p) => agNom(p.name) === agNom(name))) { showToast("Un produit de ce nom existe déjà."); return; }
    const price = fp.price === "" ? 0 : agR2(fp.price);
    if (price < 0) { showToast("Le prix de vente ne peut pas être négatif."); return; }
    ajouter({ type: "prod", id: agId(), name, unit: fp.unit.trim(), price, cat: fp.cat || "autre", desc: (fp.desc || "").trim(), photo: fp.photo || "", active: true });
    setFp({ name: "", unit: "", price: "", cat: fp.cat || "", desc: "", photo: "" });
    showToast("Produit « " + name + " » ajouté."); logAudit("Agriculture et élevage", "Produit ajouté", name);
  };
  const [npx, setNpx] = useState("");
  const redresserPrix = (p, cu) => {
    if (!canEdit) return;
    const prix = npx === "" ? Math.ceil(cu) : agR2(npx);
    if (!(prix > 0)) { showToast("Indiquez un prix supérieur à zéro."); return; }
    maj(p.id, (r) => ({ ...r, price: prix, prixRedresseLe: todayStr() }));
    setNpx(""); showToast("Prix de « " + p.name + " » : " + agF(prix) + (prix + 0.004 < cu ? " (encore sous le coût de revient)." : "."));
    logAudit("Agriculture et élevage", "Prix redressé", p.name + " : " + agF(Number(p.price) || 0) + " → " + agF(prix) + " (coût moyen " + agF(cu) + ")");
  };
  const recetteDe = (id) => recettes.find((r) => r.productId === id);
  const ajouterLigneRecette = (p) => {
    if (!canEdit) return;
    const qty = agQ(fr.qty);
    if (!fr.matId) { showToast("Choisissez l'intrant à ajouter à la recette."); return; }
    if (!(qty > 0)) { showToast("La quantité d'intrant doit être supérieure à zéro."); return; }
    const r = recetteDe(p.id);
    if (r && r.lines.some((l) => l.matId === fr.matId)) { showToast("Cet intrant figure déjà dans la recette."); return; }
    if (!r) {
      const out = agQ(fr.outQty);
      if (!(out > 0)) { showToast("Indiquez d'abord combien d'unités donne une transformation (ex. 40 pains)."); return; }
      ajouter({ type: "rec", id: agId(), productId: p.id, outQty: out, lines: [{ matId: fr.matId, qty }] });
    } else maj(r.id, (x) => ({ ...x, lines: [...x.lines, { matId: fr.matId, qty }] }));
    setFr({ ...fr, matId: "", qty: "" });
    showToast("Intrant ajouté à la recette.");
  };
  const Produits = () => {
    const rows = prods.filter((p) => !pq.trim() || [p.name, p.unit].join(" ").toLowerCase().includes(pq.trim().toLowerCase()));
    const p = prods.find((x) => x.id === selProd);
    const rec = p ? recetteDe(p.id) : null;
    const coutRecette = (r) => agR2(r.lines.reduce((s, l) => s + l.qty * prixMoyen(l.matId), 0));
    return (
      <div>
        {canEdit && (<div className="ec-card p-4 mb-5"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouveau produit fini</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom du produit</label><input value={fp.name} onChange={(e) => setFp({ ...fp, name: e.target.value })} data-testid="ag-prod-nom" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Unité de vente</label><input list="ag-dl-unit" value={fp.unit} onChange={(e) => setFp({ ...fp, unit: e.target.value })} data-testid="ag-prod-unite" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Prix de vente (facultatif)</label><input type="number" min="0" step="0.01" value={fp.price} onChange={(e) => setFp({ ...fp, price: e.target.value })} data-testid="ag-prod-prix" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Catégorie du catalogue</label><select value={fp.cat || ""} onChange={(e) => setFp({ ...fp, cat: e.target.value })} data-testid="ag-prod-cat" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{catsAll.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Description courte (facultatif)</label><input value={fp.desc || ""} onChange={(e) => setFp({ ...fp, desc: e.target.value })} data-testid="ag-prod-desc" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Photo (facultatif)</label><div className="flex items-center gap-2"><input type="file" accept="image/*" onChange={(e) => choisirPhoto(e, "")} data-testid="ag-prod-photo" className="text-xs" style={{ maxWidth: 170 }} />{fp.photo && <img src={fp.photo} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 6 }} data-testid="ag-prod-photo-apercu" />}</div></div>
          </div>
          <button onClick={ajouterProd} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-prod-ajouter">Ajouter le produit</button></div>)}
        <div className="mb-2"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (nom, unité)</label><input value={pq} onChange={(e) => setPq(e.target.value)} data-testid="ag-prod-recherche" className={ecInput} style={ecBorder} /></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Produit</th><th>Unité</th><th className="text-right">Prix de vente</th><th className="text-right">En stock</th><th>Recette</th><th></th></tr></thead>
          <tbody>{rows.map((x) => (<tr key={x.id} data-testid="ag-prod-ligne" style={{ background: x.id === selProd ? "#E6F1EE" : undefined }}><td className="py-1.5 font-semibold">{x.name}</td><td>{x.unit}</td><td className="text-right tabular">{x.price ? agF(x.price) : "—"}</td><td className="text-right tabular" data-testid="ag-prod-stock">{stockProd(x.id)}</td><td>{recetteDe(x.id) ? ecPastille("Définie", "ok") : ecPastille("Aucune", "neutre")}</td>
            <td className="text-right"><button onClick={() => setSelProd(x.id === selProd ? "" : x.id)} className="text-xs underline" data-testid="ag-prod-ouvrir">{x.id === selProd ? "Fermer" : "Ouvrir"}</button></td></tr>))}</tbody>
          {rows.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="ag-prod-total-ligne"><td colSpan={3}>Total ({rows.length} produit{rows.length > 1 ? "s" : ""})</td><td className="text-right tabular" data-testid="ag-prod-tot-stock">{agQ(rows.reduce((s, x) => s + stockProd(x.id), 0))}</td><td colSpan={2}></td></tr></tfoot>}</table></div>
        {rows.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{prods.length === 0 ? "Aucun produit. Créez vos produits de la ferme : saisissez-les directement dans la commande." : "Aucun produit ne correspond à la recherche."}</div>}
        {p && (<div className="ec-card p-4 mt-5" data-testid="ag-prod-detail">
          <div className="display text-lg mb-2" style={{ color: "#152238" }}>{p.name} — en stock : <span className="tabular">{stockProd(p.id)}</span> {p.unit}</div>
          <div className="grid md:grid-cols-3 gap-2 mb-3 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Prix de vente</label><input type="number" min="0" step="0.01" value={p.price || 0} disabled={!canEdit} onChange={(e) => maj(p.id, (r) => ({ ...r, price: Math.max(0, agR2(e.target.value)) }))} data-testid="ag-prod-d-prix" className={ecInput + " tabular"} style={ecBorder} /></div>
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={p.active !== false} disabled={!canEdit} onChange={(e) => maj(p.id, (r) => ({ ...r, active: e.target.checked }))} data-testid="ag-prod-actif" />Produit obtenu (décochez si arrêté)</label>
          </div>
          <div className="grid md:grid-cols-3 gap-2 mb-3 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Catégorie du catalogue</label><select value={catDe(p)} disabled={!canEdit} onChange={(e) => maj(p.id, (r) => ({ ...r, cat: e.target.value }))} data-testid="ag-prod-d-cat" className={ecInput} style={ecBorder}>{catsAll.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Description courte</label><input value={p.desc || ""} disabled={!canEdit} onChange={(e) => maj(p.id, (r) => ({ ...r, desc: e.target.value }))} data-testid="ag-prod-d-desc" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Photo</label><div className="flex items-center gap-2">{canEdit && <input type="file" accept="image/*" onChange={(e) => choisirPhoto(e, p.id)} data-testid="ag-prod-d-photo" className="text-xs" style={{ maxWidth: 170 }} />}{p.photo && <img src={p.photo} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 6 }} />}{canEdit && p.photo && <button onClick={() => maj(p.id, (r) => ({ ...r, photo: "" }))} className="text-xs" style={{ color: "#A6432F" }}>Retirer</button>}</div></div>
          </div>
          {canEdit && coutUnit(p.id) > 0 && (() => { const cu = coutUnit(p.id), pr = Number(p.price) || 0, sous = pr > 0 && pr + 0.004 < cu, conseil = Math.ceil(cu); return (
            <div className="p-3 rounded mb-3 text-sm" style={{ background: sous ? "#FBE9E4" : "#F4F1E6", color: sous ? "#7A2E1F" : "#5B563F" }} data-testid="ag-prod-redress">
              <div>Coût de revient moyen : <b className="tabular" data-testid="ag-prod-d-cout">{agF(cu)}</b> par {p.unit} · prix de vente : <b className="tabular">{pr > 0 ? agF(pr) : "non fixé"}</b>{pr > 0 && <> · {sous ? <b>perte de {agF(agR2(cu - pr))} par {p.unit}</b> : <>marge {agF(agR2(pr - cu))} ({Math.round((pr - cu) * 100 / pr)} %)</>}</>}</div>
              {sous && <div className="mt-1">Le prix est <b>inférieur au coût</b> : chaque vente creuse le déficit. Redressez le prix, ou vérifiez les lots (intrants ou heures surévalués ?).</div>}
              <div className="flex flex-wrap items-end gap-2 mt-2"><div><label className="text-xs" style={{ color: "#8A8370" }}>Nouveau prix de vente (au moins {fmt(conseil)} pour couvrir le coût)</label><input type="number" min="0" step="0.01" value={npx} placeholder={String(conseil)} onChange={(e) => setNpx(e.target.value)} data-testid="ag-prod-redress-prix" className={ecInput + " tabular"} style={ecBorder} /></div>
                <button onClick={() => redresserPrix(p, cu)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-prod-redress-ok">Enregistrer le nouveau prix</button>
                <button onClick={() => setTab("production")} className="px-3 py-2 rounded text-sm" style={ecBtn}>Voir les lots</button></div>
            </div>); })()}
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Recette de transformation (intrants pour une transformation)</div>
          <div className="text-xs mb-2" style={{ color: "#8A8370" }}>La recette prépare la saisie d'un lot : vous pourrez toujours corriger les quantités réellement utilisées. Le coût estimé utilise le prix moyen d'achat de chaque intrant.</div>
          {rec && (<div className="text-sm mb-2" data-testid="ag-rec-resume">Une transformation donne <b>{rec.outQty}</b> {p.unit} — coût estimé des intrants : <b className="tabular" data-testid="ag-rec-cout">{fmt(coutRecette(rec))}</b>{rec.outQty > 0 ? " (soit " + fmt(agR2(coutRecette(rec) / rec.outQty)) + " par " + p.unit + ")" : ""}</div>)}
          {rec && (<div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Intrant</th><th className="text-right">Quantité</th><th className="text-right">Coût estimé</th><th></th></tr></thead>
            <tbody>{rec.lines.map((l) => (<tr key={l.matId} data-testid="ag-rec-ligne"><td className="py-1.5">{nomMat(l.matId)}</td><td className="text-right tabular">{l.qty} {unitMat(l.matId)}</td><td className="text-right tabular">{fmt(agR2(l.qty * prixMoyen(l.matId)))}</td><td className="text-right">{canEdit && <button onClick={() => { if (rec.lines.length === 1) { setAgri((prev) => prev.filter((x) => x.id !== rec.id)); } else maj(rec.id, (x) => ({ ...x, lines: x.lines.filter((y) => y.matId !== l.matId) })); }} className="text-xs underline" data-testid="ag-rec-retirer">Retirer</button>}</td></tr>))}</tbody></table></div>)}
          {canEdit && (<div className="grid md:grid-cols-4 gap-2 items-end">
            {!rec && <div><label className="text-xs" style={{ color: "#8A8370" }}>Une transformation donne (en {p.unit})</label><input type="number" min="0" step="0.001" value={fr.outQty} onChange={(e) => setFr({ ...fr, outQty: e.target.value })} data-testid="ag-rec-sortie" className={ecInput + " tabular"} style={ecBorder} /></div>}
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Intrant</label><select value={fr.matId} onChange={(e) => setFr({ ...fr, matId: e.target.value })} data-testid="ag-rec-mat" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{mats.filter((x) => x.active !== false).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Quantité</label><input type="number" min="0" step="0.001" value={fr.qty} onChange={(e) => setFr({ ...fr, qty: e.target.value })} data-testid="ag-rec-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
            <button onClick={() => ajouterLigneRecette(p)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-rec-ajouter">Ajouter à la recette</button>
          </div>)}
          {canEdit && (<div className="grid md:grid-cols-4 gap-2 items-end mt-3"><div><label className="text-xs" style={{ color: "#8A8370" }}>Ajuster le stock du produit (− / +)</label><input type="number" step="0.001" value={fadj.qty} onChange={(e) => setFadj({ ...fadj, qty: e.target.value })} data-testid="ag-padj-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Motif (invendus, casse, don…)</label><input value={fadj.reason} onChange={(e) => setFadj({ ...fadj, reason: e.target.value })} data-testid="ag-padj-motif" className={ecInput} style={ecBorder} /></div>
            <button onClick={() => ajusterStock("prod", p.id)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ag-padj-ok">Ajuster</button></div>)}
        </div>)}
      </div>
    );
  };

  // ───────── Production (lots de transformation) ─────────
  const lotVide = () => ({ productId: "", label: "", date: todayStr(), qty: "", orderId: "", expire: "", hours: "", rate: "", frais: "", notes: "", lines: [], matId: "", mqty: "", srcProdId: "", srcQty: "" });
  const [fl, setFl] = useBrouillon("agri-lot", lotVide());
  const [lq, setLq] = useState(""); const [lp, setLp] = useState("");
  const remplirRecette = () => {
    const r = fl.productId ? recetteDe(fl.productId) : null;
    if (!r) { showToast("Ce produit n'a pas de recette (onglet Produits et prix)."); return; }
    const q = agQ(fl.qty);
    if (!(q > 0)) { showToast("Indiquez d'abord la quantité à transformer."); return; }
    setFl({ ...fl, lines: r.lines.map((l) => ({ matId: l.matId, qty: agQ(l.qty * q / r.outQty) })) });
  };
  const ajouterLigneLot = () => {
    const q = agQ(fl.mqty);
    if (!fl.matId) { showToast("Choisissez l'intrant utilisé."); return; }
    if (!(q > 0)) { showToast("La quantité utilisée doit être supérieure à zéro."); return; }
    if (fl.lines.some((l) => l.matId === fl.matId)) { showToast("Cet intrant est déjà dans la liste : corrigez sa quantité."); return; }
    setFl({ ...fl, lines: [...fl.lines, { matId: fl.matId, qty: q }], matId: "", mqty: "" });
  };
  const creerLot = () => {
    if (!canEdit) return;
    const qty = agQ(fl.qty);
    if (!fl.productId && !fl.label.trim()) { showToast("Choisissez un produit, ou décrivez le produit."); return; }
    if (!(qty > 0)) { showToast("La quantité fabriquée doit être supérieure à zéro."); return; }
    if (!verifDate(fl.date, "enregistrer cette transformation")) return;
    const srcQ = fl.srcProdId ? agQ(fl.srcQty) : 0;
    if (fl.srcProdId && !(srcQ > 0)) { showToast("Indiquez la quantité du produit de la ferme transformé."); return; }
    if (fl.srcProdId && stockProd(fl.srcProdId) + 0.0005 < srcQ) { showToast("Stock insuffisant de « " + nomProd(fl.srcProdId) + " » : " + stockProd(fl.srcProdId) + " " + unitProd(fl.srcProdId) + " disponible."); return; }
    if (fl.lines.length === 0 && !(srcQ > 0)) { showToast("Indiquez au moins un intrant ou un produit de la ferme transformé."); return; }
    const hours = fl.hours === "" ? 0 : Number(fl.hours), rate = fl.rate === "" ? 0 : agR2(fl.rate), frais = fl.frais === "" ? 0 : agR2(fl.frais);
    if (hours < 0 || rate < 0 || frais < 0) { showToast("Heures, taux horaire et frais ne peuvent pas être négatifs."); return; }
    if (fl.expire && fl.expire < fl.date) { showToast("La date limite de consommation ou d'utilisation ne peut pas précéder la transformation."); return; }
    for (const l of fl.lines) { if (stockMat(l.matId) + 0.0005 < l.qty) { showToast("Stock insuffisant de " + nomMat(l.matId) + " : " + stockMat(l.matId) + " " + unitMat(l.matId) + " disponible, " + l.qty + " demandé."); return; } }
    const lines = fl.lines.map((l) => { const pu = prixMoyen(l.matId); return { matId: l.matId, qty: l.qty, pu, cost: agR2(l.qty * pu) }; });
    const number = numero("LT", lots, fl.date);
    const rec = { type: "lot", id: agId(), number, date: fl.date, productId: fl.productId, label: fl.productId ? "" : fl.label.trim(), qty, lines, hours, rate, frais, srcProdId: srcQ > 0 ? fl.srcProdId : "", srcQty: srcQ, srcCost: srcQ > 0 ? agR2(srcQ * coutUnit(fl.srcProdId)) : 0, expire: fl.expire, orderId: fl.orderId, notes: fl.notes.trim(), status: "valide", by: currentUserEmail || "" };
    ajouter(rec);
    if (fl.orderId) maj(fl.orderId, (c) => (c.status === "confirmee" ? { ...c, status: "enprod" } : c));
    setFl(lotVide());
    showToast("Lot " + number + " enregistré : coût de revient " + fmt(coutLot(rec).total) + "."); logAudit("Agriculture et élevage", "Lot de transformation", number + " — " + (fl.productId ? nomProd(fl.productId) : fl.label.trim()));
  };
  const annulerLot = (l) => {
    if (!canEdit || l.status === "annulé") return;
    if (l.productId && stockProd(l.productId) - l.qty < -0.0005) { showToast("Annulation impossible : une partie de ce lot a déjà été vendue (le stock du produit deviendrait négatif)."); return; }
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler ce lot ? Les intrants reviennent en stock.")) return;
    maj(l.id, (r) => ({ ...r, status: "annulé", canceledAt: today }));
    showToast("Lot annulé : intrants remis en stock."); logAudit("Agriculture et élevage", "Lot annulé", l.number);
  };
  const nomLot = (l) => (l.productId ? nomProd(l.productId) : l.label);
  const Production = () => {
    const rows = lots.filter((l) => (!lp || l.productId === lp) && (!lq.trim() || [l.number, nomLot(l), l.notes].join(" ").toLowerCase().includes(lq.trim().toLowerCase()))).sort((a, b) => (a.date < b.date ? 1 : -1));
    const rowsOk = rows.filter((l) => l.status !== "annulé");
    const l0 = lots.find((x) => x.id === selLot);
    const cmdsOuvertes = cmds.filter((c) => c.status === "confirmee" || c.status === "enprod");
    const prev = (() => { const q = agQ(fl.qty); const m = agR2(fl.lines.reduce((s, x) => s + x.qty * prixMoyen(x.matId), 0)); const mo = agR2((Number(fl.hours) || 0) * (Number(fl.rate) || 0)); const fr = agR2(Number(fl.frais) || 0); const sc = fl.srcProdId ? agR2(agQ(fl.srcQty) * coutUnit(fl.srcProdId)) : 0; const t = agR2(m + mo + fr + sc); return { m, mo, fr, t, u: q > 0 ? agR2(t / q) : 0 }; })();
    return (
      <div>
        {canEdit && (<div className="ec-card p-4 mb-5" data-testid="ag-lot-form"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvelle transformation (lot)</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Produit obtenu</label><select value={fl.productId} onChange={(e) => setFl({ ...fl, productId: e.target.value })} data-testid="ag-lot-produit" className={ecInput} style={ecBorder}><option value="">— autre produit transformé —</option>{prods.filter((x) => x.active !== false).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select></div>
            {!fl.productId && <div><label className="text-xs" style={{ color: "#8A8370" }}>Description du produit</label><input value={fl.label} onChange={(e) => setFl({ ...fl, label: e.target.value })} data-testid="ag-lot-label" className={ecInput} style={ecBorder} /></div>}
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Quantité obtenue{fl.productId ? " (" + unitProd(fl.productId) + ")" : ""}</label><input type="number" min="0" step="0.001" value={fl.qty} onChange={(e) => setFl({ ...fl, qty: e.target.value })} data-testid="ag-lot-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date de transformation</label><input type="date" max={today} value={fl.date} onChange={(e) => setFl({ ...fl, date: e.target.value })} data-testid="ag-lot-date" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Commande concernée (facultatif)</label><select value={fl.orderId} onChange={(e) => setFl({ ...fl, orderId: e.target.value })} data-testid="ag-lot-commande" className={ecInput} style={ecBorder}><option value="">— aucune —</option>{cmdsOuvertes.map((c) => <option key={c.id} value={c.id}>{c.number} — {nomClient(c.clientId)}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>À consommer avant (facultatif)</label><input type="date" value={fl.expire} onChange={(e) => setFl({ ...fl, expire: e.target.value })} data-testid="ag-lot-expire" className={ecInput} style={ecBorder} /></div>
          </div>
          <div className="display text-base mt-3 mb-1" style={{ color: "#152238" }}>Intrants utilisés</div>
          {fl.productId && recetteDe(fl.productId) && <button onClick={remplirRecette} className="text-xs underline mb-2" data-testid="ag-lot-recette">Remplir depuis la recette</button>}
          {fl.lines.length > 0 && (<div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Intrant</th><th className="text-right">Quantité utilisée</th><th className="text-right">En stock</th><th className="text-right">Coût (prix moyen)</th><th></th></tr></thead>
            <tbody>{fl.lines.map((l) => (<tr key={l.matId} data-testid="ag-lot-mligne"><td className="py-1.5">{nomMat(l.matId)}</td><td className="text-right"><input type="number" min="0" step="0.001" value={l.qty} onChange={(e) => setFl({ ...fl, lines: fl.lines.map((x) => (x.matId === l.matId ? { ...x, qty: agQ(e.target.value) } : x)) })} data-testid="ag-lot-mqte" className="border rounded px-1 py-0.5 text-sm tabular text-right" style={{ ...ecBorder, width: 90 }} /> {unitMat(l.matId)}</td><td className="text-right tabular" style={{ color: stockMat(l.matId) + 0.0005 < l.qty ? "#A6432F" : undefined }}>{stockMat(l.matId)}</td><td className="text-right tabular">{fmt(agR2(l.qty * prixMoyen(l.matId)))}</td><td className="text-right"><button onClick={() => setFl({ ...fl, lines: fl.lines.filter((x) => x.matId !== l.matId) })} className="text-xs underline" data-testid="ag-lot-mretirer">Retirer</button></td></tr>))}</tbody></table></div>)}
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Ajouter un intrant</label><select value={fl.matId} onChange={(e) => setFl({ ...fl, matId: e.target.value })} data-testid="ag-lot-mat" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{mats.filter((x) => x.active !== false).map((x) => <option key={x.id} value={x.id}>{x.name} (stock {stockMat(x.id)} {x.unit})</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Quantité</label><input type="number" min="0" step="0.001" value={fl.mqty} onChange={(e) => setFl({ ...fl, mqty: e.target.value })} data-testid="ag-lot-mq" className={ecInput + " tabular"} style={ecBorder} /></div>
            <button onClick={ajouterLigneLot} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ag-lot-mpl">Ajouter</button>
          </div>
          <div className="display text-base mt-3 mb-1" style={{ color: "#152238" }}>Produit de la ferme transformé (facultatif)</div>
          <div className="grid md:grid-cols-4 gap-2 items-end mb-1">
            <div className="md:col-span-2"><select value={fl.srcProdId} onChange={(e) => setFl({ ...fl, srcProdId: e.target.value })} data-testid="ag-lot-src" className={ecInput} style={ecBorder}><option value="">— aucun —</option>{prods.filter((x) => x.active !== false).map((x) => <option key={x.id} value={x.id}>{x.name} — stock {stockProd(x.id)} {x.unit}</option>)}</select></div>
            <div><input type="number" min="0" step="0.001" placeholder="Quantité transformée" value={fl.srcQty} onChange={(e) => setFl({ ...fl, srcQty: e.target.value })} data-testid="ag-lot-srcqte" className={ecInput + " tabular"} style={ecBorder} /></div>
          </div>
          <div className="display text-base mt-3 mb-1" style={{ color: "#152238" }}>Main-d'œuvre et frais de cette transformation</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Heures de travail</label><input type="number" min="0" step="0.25" value={fl.hours} onChange={(e) => setFl({ ...fl, hours: e.target.value })} data-testid="ag-lot-heures" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Taux horaire (gourdes)</label><input type="number" min="0" step="0.01" value={fl.rate} onChange={(e) => setFl({ ...fl, rate: e.target.value })} data-testid="ag-lot-taux" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Autres frais (énergie, emballage…)</label><input type="number" min="0" step="0.01" value={fl.frais} onChange={(e) => setFl({ ...fl, frais: e.target.value })} data-testid="ag-lot-frais" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Remarques</label><input value={fl.notes} onChange={(e) => setFl({ ...fl, notes: e.target.value })} className={ecInput} style={ecBorder} /></div>
          </div>
          <div className="text-sm mt-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#152238" }} data-testid="ag-lot-apercu-cout">Coût estimé : intrants <b className="tabular">{fmt(prev.m)}</b> + main-d'œuvre <b className="tabular">{fmt(prev.mo)}</b> + frais <b className="tabular">{fmt(prev.fr)}</b> = <b className="tabular" data-testid="ag-lot-cout-total">{fmt(prev.t)}</b>{prev.u > 0 ? " — soit " + fmt(prev.u) + " par unité" : ""}. La main-d'œuvre sert au calcul du coût ; les salaires se paient dans le module Salaires.</div>
          <button onClick={creerLot} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-lot-enregistrer">Enregistrer la transformation</button></div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <div className="flex-1 min-w-[150px]"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (n° de transformation, produit, remarque)</label><input value={lq} onChange={(e) => setLq(e.target.value)} data-testid="ag-lot-recherche" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Produit</label><select value={lp} onChange={(e) => setLp(e.target.value)} data-testid="ag-lot-filtre-produit" className={ecInput} style={ecBorder}><option value="">Tous</option>{prods.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
        </div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>Date</th><th>Produit</th><th className="text-right">Quantité</th><th className="text-right">Coût de revient</th><th className="text-right">Coût unitaire</th><th>À consommer avant</th><th></th></tr></thead>
          <tbody>{rows.map((l) => { const c = coutLot(l); return (<tr key={l.id} data-testid="ag-lot-ligne" style={{ background: l.id === selLot ? "#E6F1EE" : undefined, opacity: l.status === "annulé" ? 0.5 : 1 }}><td className="py-1.5 tabular text-xs">{l.number}</td><td>{ecDateFr(l.date)}</td><td className="font-semibold">{nomLot(l)}{l.status === "annulé" ? " (annulé)" : ""}</td><td className="text-right tabular">{l.qty}</td><td className="text-right tabular">{fmt(c.total)}</td><td className="text-right tabular">{fmt(agR2(c.total / l.qty))}</td><td>{l.expire ? ecDateFr(l.expire) : "—"}</td>
            <td className="text-right"><button onClick={() => setSelLot(l.id === selLot ? "" : l.id)} className="text-xs underline" data-testid="ag-lot-ouvrir">{l.id === selLot ? "Fermer" : "Ouvrir"}</button></td></tr>); })}</tbody>
          {rows.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="ag-lot-total-ligne"><td colSpan={3}>Total ({rowsOk.length} lot{rowsOk.length > 1 ? "s" : ""}, hors annulés)</td><td className="text-right tabular">{agQ(rowsOk.reduce((s, l) => s + l.qty, 0))}</td><td className="text-right tabular" data-testid="ag-lot-tot-cout">{fmt(agR2(rowsOk.reduce((s, l) => s + coutLot(l).total, 0)))}</td><td colSpan={3}></td></tr></tfoot>}</table></div>
        {rows.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{lots.length === 0 ? "Aucune transformation enregistrée." : "Aucun lot ne correspond à ces filtres."}</div>}
        {l0 && (() => { const c = coutLot(l0); return (<div className="ec-card p-4 mt-5" data-testid="ag-lot-detail">
          <div className="display text-lg mb-2" style={{ color: "#152238" }}>{l0.number} — {nomLot(l0)} ({l0.qty}{l0.productId ? " " + unitProd(l0.productId) : ""})</div>
          <div className="text-sm mb-2">Intrants <b className="tabular">{fmt(c.m)}</b> · main-d'œuvre ({l0.hours || 0} h × {fmt(l0.rate || 0)}) <b className="tabular">{fmt(c.mo)}</b> · frais <b className="tabular">{fmt(c.fr)}</b> · <b>coût de revient {fmt(c.total)}</b> · unitaire <b className="tabular" data-testid="ag-lot-d-unit">{fmt(agR2(c.total / l0.qty))}</b>{l0.orderId ? " · commande " + ((cmds.find((x) => x.id === l0.orderId) || {}).number || "") : ""}</div>
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Intrant</th><th className="text-right">Quantité</th><th className="text-right">Prix moyen</th><th className="text-right">Coût</th></tr></thead>
            <tbody>{l0.lines.map((x) => (<tr key={x.matId}><td className="py-1.5">{nomMat(x.matId)}</td><td className="text-right tabular">{x.qty} {unitMat(x.matId)}</td><td className="text-right tabular">{agF(x.pu)}</td><td className="text-right tabular">{fmt(x.cost)}</td></tr>))}</tbody></table></div>
          <div className="flex flex-wrap gap-2"><button onClick={() => setImprimer({ kind: "lot", id: l0.id })} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ag-lot-imprimer">Imprimer la fiche de transformation</button>{canEdit && l0.status !== "annulé" && <button onClick={() => annulerLot(l0)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ag-lot-annuler">Annuler ce lot</button>}</div>
        </div>); })()}
      </div>
    );
  };

  // ───────── Facturation (commune aux commandes et à la vente au comptoir) ─────────
  const acomptesDispo = (c) => agR2((c.acomptes || []).filter((a) => a.status !== "annulé" && !a.imputed).reduce((s, a) => s + a.amount, 0));
  const verifStockLignes = (lines, ignoreFactId) => {
    const need = {};
    lines.filter((l) => l.productId).forEach((l) => { need[l.productId] = agQ((need[l.productId] || 0) + l.qty); });
    for (const id of Object.keys(need)) { if (stockProd(id) + 0.0005 < need[id]) { showToast("Stock insuffisant de « " + nomProd(id) + " » : " + stockProd(id) + " " + unitProd(id) + " disponible, " + need[id] + " demandé. Enregistrez d'abord la récolte ou la production."); return false; } }
    const needB = {};
    lines.filter((l) => l.bandeId && !l.animalId).forEach((l) => { needB[l.bandeId] = agQ((needB[l.bandeId] || 0) + l.qty); });
    for (const id of Object.keys(needB)) { const b = bandes.find((x) => x.id === id); if (!b || effectif(b) + 0.0005 < needB[id]) { showToast("Il ne reste que " + (b ? effectif(b) : 0) + " animal(aux) à vendre dans « " + (b ? b.name : "bande") + " », " + needB[id] + " demandé."); return false; } }
    for (const l of lines.filter((x) => x.animalId)) { const a = animaux.find((x) => x.id === l.animalId); if (!a || !animalPresent(a)) { showToast("L'animal « " + (a ? a.tag : "?") + " » n'est plus disponible à la vente."); return false; } }
    return true;
  };
  const emettreFacture = ({ orderId, clientId, date, lines, payNow, payMode }) => {
    if (!canFront) return null;
    if (lines.length === 0) { showToast("Ajoutez au moins une ligne à facturer."); return null; }
    if (!verifDate(date, "émettre cette facture")) return null;
    if (!verifStockLignes(lines)) return null;
    const ht = agMontantLignes(lines);
    if (!(ht > 0)) { showToast("Le montant à facturer doit être supérieur à zéro."); return null; }
    const tca = agR2(ht * tcaRate / 100), ttc = agR2(ht + tca);
    const cmd = orderId ? cmds.find((c) => c.id === orderId) : null;
    const recup = cmd ? Math.min(acomptesDispo(cmd), ttc) : 0;
    const net = agR2(ttc - recup);
    agAjouterComptes(accounts, setAccounts, ["411", "7012", ...(tca > 0 ? ["445"] : []), ...(recup > 0 ? ["4191"] : [])]);
    const number = numero("FA", facts, date);
    const e = ecrire(date, "Facture " + number + " — " + nomClient(clientId), [{ account: "411", debit: net, credit: 0 }, { account: "4191", debit: recup, credit: 0 }, { account: "7012", debit: 0, credit: ht }, { account: "445", debit: 0, credit: tca }], clientId || "passage");
    const f = { type: "fact", id: agId(), number, date, dueDate: date, clientId: clientId || "", orderId: orderId || "", lines: lines.map((l) => ({ id: agId(), label: l.label, productId: l.productId || "", bandeId: l.bandeId || "", animalId: l.animalId || "", service: !!l.service, perte: !!l.perte, motif: l.motif || "", motifTxt: l.motifTxt || "", unit: l.unit || "", qty: l.qty, pu: l.pu })), ht, tcaRate, tca, ttc, recup, net, entryId: e.id, payments: [], status: "emise", by: currentUserEmail || "" };
    if (payNow && net > 0) {
      const cpt = compteMode(payMode === "banque" ? "banque" : "caisse");
      agAjouterComptes(accounts, setAccounts, [cpt]);
      const pe = ecrire(date, "Encaissement " + number, [{ account: cpt, debit: net, credit: 0 }, { account: "411", debit: 0, credit: net }], f.id);
      f.payments = [{ id: agId(), date, amount: net, mode: payMode === "banque" ? "banque" : "caisse", entryId: pe.id, status: "valide" }];
    }
    ajouter(f);
    if (cmd) { maj(cmd.id, (c) => ({ ...c, status: "livree", factId: f.id, acomptes: (c.acomptes || []).map((a) => (a.status !== "annulé" && !a.imputed ? { ...a, imputed: true } : a)) })); }
    showToast("Facture " + number + " émise : " + fmt(ttc) + "." + (f.lines.some((l) => l.perte) ? " Attention : cette facture contient une vente à perte." : "")); logAudit("Agriculture et élevage", "Facture émise", number + " — " + fmt(ttc));
    if (f.lines.some((l) => l.perte)) logAudit("Agriculture et élevage", "Vente à perte", number + " — " + f.lines.filter((l) => l.perte).map((l) => l.label + " (" + agMotifLibelle(l.motif, l.motifTxt) + ")").join(" ; "));
    return f;
  };
  const [pf, setPf] = useBrouillon("agri-paiement", { amount: "", mode: "caisse", date: todayStr() });
  const encaisser = (f) => {
    if (!canFront || f.status === "annulee") return;
    const reste = agSolde(f).reste;
    const amount = pf.amount === "" ? reste : agR2(pf.amount);
    if (!(amount > 0) || amount > reste + 0.004) { showToast("Le montant doit être compris entre 0 et le reste à payer (" + fmt(reste) + ")."); return; }
    if (!verifDate(pf.date, "enregistrer cet encaissement")) return;
    if (pf.date < f.date) { showToast("L'encaissement ne peut pas précéder la facture."); return; }
    const cpt = compteMode(pf.mode === "banque" ? "banque" : "caisse");
    agAjouterComptes(accounts, setAccounts, [cpt, "411"]);
    const e = ecrire(pf.date, "Encaissement " + f.number + " — " + nomClient(f.clientId), [{ account: cpt, debit: amount, credit: 0 }, { account: "411", debit: 0, credit: amount }], f.id);
    maj(f.id, (r) => ({ ...r, payments: [...(r.payments || []), { id: agId(), date: pf.date, amount, mode: pf.mode, entryId: e.id, status: "valide" }] }));
    setPf({ ...pf, amount: "" }); showToast("Encaissement de " + fmt(amount) + " enregistré."); logAudit("Agriculture et élevage", "Encaissement", f.number + " — " + fmt(amount));
  };
  const annulerPaiement = (f, p) => {
    if (!canEdit || p.status === "annulé") return;
    if (!verifDate(today, "annuler cet encaissement")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler cet encaissement ? Une écriture inverse sera passée.")) return;
    const e = contre(p.entryId, "Annulation encaissement " + f.number + " (écriture inverse)", today, f.id);
    maj(f.id, (r) => ({ ...r, payments: r.payments.map((x) => (x.id === p.id ? { ...x, status: "annulé", reversalEntryId: e ? e.id : "" } : x)) }));
    showToast("Encaissement annulé.");
  };
  const annulerFacture = (f) => {
    if (!canEdit || f.status === "annulee") return;
    if (agPaye(f.payments) > 0) { showToast("Annulez d'abord les encaissements de cette facture."); return; }
    if (!verifDate(today, "annuler cette facture")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler la facture " + f.number + " ? Une écriture inverse sera passée et les produits reviennent en stock.")) return;
    const e = contre(f.entryId, "Annulation facture " + f.number + " (écriture inverse)", today, f.clientId || "passage");
    maj(f.id, (r) => ({ ...r, status: "annulee", reversalEntryId: e ? e.id : "" }));
    if (f.orderId) maj(f.orderId, (c) => ({ ...c, status: "prete", factId: "", acomptes: (c.acomptes || []).map((a) => (a.imputed ? { ...a, imputed: false } : a)) }));
    showToast("Facture annulée.");
  };

  // ───────── Catalogue (cartes illustrées, comme la carte de la Restauration) ─────────
  const addCatI = () => {
    if (!canEdit) return;
    const label = nouvCat.trim();
    if (!label) { showToast("Donnez un nom à la catégorie (ex. Maïs et céréales, Volailles, Légumes)."); return; }
    if (catsAll.some((c) => agNom(c[1]) === agNom(label))) { showToast("Cette catégorie existe déjà."); return; }
    ajouter({ type: "cat", id: "c" + agId(), label });
    setNouvCat(""); showToast("Catégorie « " + label + " » ajoutée.");
  };
  const cartes = (mode) => {
    const actifs = prods.filter((p) => mode === "catalogue" || p.active !== false);
    return (<div>{catsAll.map(([ck, cl]) => { const liste = actifs.filter((p) => catDe(p) === ck); return liste.length ? (
      <div key={ck} className="mb-5" data-testid="ag-cat-groupe"><div className="display text-base" style={{ color: "#152238" }}>{cl}</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{liste.map((p) => {
          const st = stockProd(p.id), rupture = st <= 0, cu = coutUnit(p.id), pr = Number(p.price) || 0, sous = canEdit && cu > 0 && pr > 0 && pr + 0.004 < cu;
          return (<div key={p.id} className="ec-card p-3" data-testid="ag-cat-carte" style={{ opacity: (rupture && mode === "vente") || p.active === false ? 0.55 : 1 }}>
            <div className="flex gap-3">
              {p.photo ? <img src={p.photo} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} /> : <div style={{ width: 72, height: 72, borderRadius: 8, background: "#F4F1E6", color: "#9A7B1E", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0 }}>{p.name.charAt(0).toUpperCase()}</div>}
              <div style={{ minWidth: 0 }}><div className="font-semibold text-sm">{p.name}</div>{p.desc && <div className="text-xs" style={{ color: "#7A7460" }}>{p.desc}</div>}
                <div className="tabular text-sm mt-1" data-testid="ag-cat-prix">{pr > 0 ? agF(pr) : "prix à fixer"} <span className="text-xs" style={{ color: "#8A8370" }}>/ {p.unit}</span></div>
                <div className="text-xs" data-testid="ag-cat-stock" style={{ color: rupture ? "#A6432F" : "#5B563F" }}>{rupture ? "Rupture" : st + " " + p.unit + " disponible" + (st > 1 ? "s" : "")}</div>
                {p.active === false && <div className="text-xs" style={{ color: "#8A8370" }}>Retiré du catalogue</div>}
                {mode === "catalogue" && canEdit && cu > 0 && <div className="text-xs" style={{ color: sous ? "#A6432F" : "#8A8370" }}>coût moyen {agF(cu)}{pr > 0 ? (sous ? " · prix sous le coût" : " · marge " + Math.round((pr - cu) * 100 / pr) + " %") : ""}</div>}
                {mode !== "catalogue" && sous && <div className="text-xs" style={{ color: "#A6432F" }}>Prix sous le coût de revient</div>}</div>
            </div>
            <div className="flex flex-wrap gap-2 mt-2 text-xs">
              {mode === "vente" && !rupture && canFront && <><button onClick={() => ajouterRapide(p)} className="px-2 py-1 rounded" style={ecBtnGold} data-testid="ag-cat-plus1">+ 1</button><button onClick={() => choisirProduitVente(p.id)} className="underline" data-testid="ag-vte-cat-choisir">Choisir</button></>}
              {mode === "commande" && canFront && <button onClick={() => choisirProduitLigne(p.id)} className="underline" data-testid="ag-cmd-cat-choisir">Choisir</button>}
              {mode === "catalogue" && canEdit && <><button onClick={() => { setSelProd(p.id); setTab("produits"); }} className="underline" data-testid="ag-cat-modifier">Modifier</button><button onClick={() => maj(p.id, (r) => ({ ...r, active: r.active === false }))} className="underline" data-testid="ag-cat-retirer">{p.active === false ? "Remettre au catalogue" : "Retirer du catalogue"}</button></>}
            </div>
          </div>); })}</div></div>) : null; })}
      {actifs.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun produit : créez-les dans « Produits et prix ».</div>}</div>);
  };
  const Catalogue = () => (
    <div>
      <div className="ec-card p-4 mb-5" data-testid="ag-catalogue-entete">
        <div className="text-sm mb-2" style={{ color: "#5B563F" }}>Votre vitrine : les produits finis, rangés par catégorie, avec photo, prix et stock disponible. Les produits se créent dans « Produits et prix » ; ici vous les présentez et les vendez.</div>
        <div className="flex flex-wrap items-end gap-2">
          {canEdit && <><div><label className="text-xs" style={{ color: "#8A8370" }}>Nouvelle catégorie (ex. Maïs et céréales, Volailles, Légumes)</label><input value={nouvCat} onChange={(e) => setNouvCat(e.target.value)} data-testid="ag-cat-nom" className={ecInput} style={{ ...ecBorder, minWidth: 220 }} /></div><button onClick={addCatI} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ag-cat-ajouter">Ajouter la catégorie</button></>}
          <button onClick={() => setImprimer({ kind: "catalogue" })} className="px-3 py-2 rounded text-sm ml-auto" style={ecBtn} data-testid="ag-catalogue-apercu">Aperçu du catalogue pour les clients</button>
        </div>
      </div>
      {cartes("catalogue")}
    </div>
  );
  // ───────── Commandes ─────────
  const cmdVide = () => ({ clientId: "", kind: "serie", subject: "", due: "", lines: [], productId: "", label: "", unit: "", qty: "", pu: "" });
  const [fc, setFc] = useBrouillon("agri-commande", cmdVide());
  const [perteAl, setPerteAl] = useState(null); // alerte « prix inférieur au coût de revient » : { ou, label, pu, cu } — à confirmer
  const [confPerte, setConfPerte] = useState(""); const [motifCmd, setMotifCmd] = useState({ motif: "", txt: "" }); // commande dont la facturation à perte attend une confirmation
  const [cqq, setCqq] = useState(""); const [cet, setCet] = useState("");
  const [ac, setAc] = useState({ amount: "", mode: "caisse", date: todayStr() });
  const choisirProduitLigne = (id) => { const p = prods.find((x) => x.id === id); setFc({ ...fc, productId: id, label: p ? p.name : fc.label, unit: p ? p.unit : fc.unit, pu: p && p.price ? String(p.price) : fc.pu }); };
  const ajouterCandCmd = (cand, forcer) => {
    const qty = agQ(cand.qty), pu = agR2(cand.pu);
    if (!String(cand.label || "").trim()) { showToast("Indiquez la désignation (ou choisissez un produit)."); return; }
    if (!(qty > 0)) { showToast("La quantité doit être supérieure à zéro."); return; }
    if (cand.pu === "" || pu < 0) { showToast("Indiquez le prix unitaire (en gourdes)."); return; }
    const cu = cand.productId ? coutUnit(cand.productId) : 0, perte = cu > 0 && pu + 0.004 < cu;
    if (perte && !forcer) { setPerteAl({ ou: "cmd", label: String(cand.label).trim(), pu, cu, cand, motif: "", txt: "" }); return; }
    setPerteAl(null);
    setFc({ ...fc, lines: [...fc.lines, { id: agId(), label: String(cand.label).trim(), productId: cand.productId || "", unit: String(cand.unit || "").trim(), qty, pu, perte, motif: perte ? forcer.motif : "", motifTxt: perte ? forcer.txt : "" }], productId: "", label: "", unit: "", qty: "", pu: "" });
  };
  const ajouterLigneCmd = (forcer) => ajouterCandCmd({ productId: fc.productId, label: fc.label, unit: fc.unit, qty: fc.qty, pu: fc.pu }, forcer);
  const creerCommande = () => {
    if (!canFront) return;
    if (!fc.clientId) { showToast("Choisissez le client (créez-le d'abord dans l'onglet Clients)."); return; }
    if (fc.lines.length === 0) { showToast("Ajoutez au moins une ligne à la commande."); return; }
    if (fc.due && fc.due < today) { showToast("La date de livraison souhaitée ne peut pas être passée."); return; }
    const number = numero("CD", cmds, today);
    ajouter({ type: "cmd", id: agId(), number, date: today, clientId: fc.clientId, kind: fc.kind, subject: fc.subject.trim(), lines: fc.lines, due: fc.due, status: "devis", specs: "", acomptes: [], factId: "", by: currentUserEmail || "" });
    setFc(cmdVide());
    showToast("Commande " + number + " enregistrée (devis)."); logAudit("Agriculture et élevage", "Commande créée", number + " — " + nomClient(fc.clientId));
  };
  const changerEtat = (c, st, msg) => { maj(c.id, (r) => ({ ...r, status: st })); showToast(msg); logAudit("Agriculture et élevage", "Commande " + c.number, msg); };
  const recevoirAcompte = (c) => {
    if (!canFront || c.status === "annulee" || c.status === "livree") return;
    const amount = agR2(ac.amount);
    if (!(amount > 0)) { showToast("Indiquez le montant de l'acompte."); return; }
    const total = agR2(agMontantLignes(c.lines) * (1 + tcaRate / 100));
    if (amount + acomptesDispo(c) > total + 0.004) { showToast("Les acomptes ne peuvent pas dépasser le total de la commande (" + fmt(total) + ")."); return; }
    if (!verifDate(ac.date, "enregistrer cet acompte")) return;
    const cpt = compteMode(ac.mode === "banque" ? "banque" : "caisse");
    agAjouterComptes(accounts, setAccounts, [cpt, "4191"]);
    const e = ecrire(ac.date, "Acompte " + c.number + " — " + nomClient(c.clientId), [{ account: cpt, debit: amount, credit: 0 }, { account: "4191", debit: 0, credit: amount }], c.id);
    maj(c.id, (r) => ({ ...r, acomptes: [...(r.acomptes || []), { id: agId(), date: ac.date, amount, mode: ac.mode, entryId: e.id, status: "valide", imputed: false }] }));
    setAc({ ...ac, amount: "" }); showToast("Acompte de " + fmt(amount) + " enregistré."); logAudit("Agriculture et élevage", "Acompte reçu", c.number + " — " + fmt(amount));
  };
  const annulerAcompte = (c, a) => {
    if (!canEdit || a.status === "annulé" || a.imputed) return;
    if (!verifDate(today, "annuler cet acompte")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler cet acompte ? Une écriture inverse sera passée.")) return;
    const e = contre(a.entryId, "Annulation acompte " + c.number + " (écriture inverse)", today, c.id);
    maj(c.id, (r) => ({ ...r, acomptes: r.acomptes.map((x) => (x.id === a.id ? { ...x, status: "annulé", reversalEntryId: e ? e.id : "" } : x)) }));
    showToast("Acompte annulé.");
  };
  const annulerCommande = (c) => {
    if (!canEdit || c.status === "annulee" || c.status === "livree") return;
    if (acomptesDispo(c) > 0) { showToast("Un acompte a été reçu : annulez-le (restitution au client) avant d'annuler la commande."); return; }
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler la commande " + c.number + " ?")) return;
    changerEtat(c, "annulee", "Commande annulée.");
  };
  const facturerCommande = (c) => {
    if (!canFront || c.status === "annulee" || c.status === "livree") return;
    if (c.status === "devis") { showToast("Confirmez d'abord la commande (accord du client)."); return; }
    const coutC = agR2(lotsOk.filter((l) => l.orderId === c.id).reduce((s2, l) => s2 + coutLot(l).total, 0)), htC = agMontantLignes(c.lines), perteC = coutC > 0 && coutC > htC + 0.004;
    if (perteC && confPerte !== c.id) { setConfPerte(c.id); setMotifCmd({ motif: "", txt: "" }); showToast("Attention : le coût de revient des lots (" + fmt(coutC) + ") dépasse le montant à facturer (" + fmt(htC) + "). Justifiez la raison pour facturer quand même."); return; }
    if (perteC) {
      if (isVendeur || !canEdit) { showToast("Seul un gestionnaire peut autoriser une facturation à perte."); return; }
      if (!motifCmd.motif) { showToast("Choisissez la raison de cette vente à perte."); return; }
      if (motifCmd.motif === "autre" && !motifCmd.txt.trim()) { showToast("Précisez la raison de cette vente à perte."); return; }
    }
    setConfPerte("");
    const f = emettreFacture({ orderId: c.id, clientId: c.clientId, date: today, lines: c.lines, payNow: false });
    if (f && perteC) { maj(f.id, (r) => ({ ...r, perteMotif: motifCmd.motif, perteTxt: motifCmd.txt.trim(), perteCout: coutC })); logAudit("Agriculture et élevage", "Vente à perte", f.number + " — coût " + fmt(coutC) + " pour " + fmt(htC) + " facturés — " + agMotifLibelle(motifCmd.motif, motifCmd.txt.trim())); }
  };
  const cmdHt = (c) => agMontantLignes(c.lines);
  const Commandes = () => {
    const rows = cmds.filter((c) => (!cet || c.status === cet) && (!cqq.trim() || [c.number, nomClient(c.clientId), c.subject].join(" ").toLowerCase().includes(cqq.trim().toLowerCase()))).sort((a, b) => (a.date < b.date ? 1 : -1));
    const rowsOk = rows.filter((c) => c.status !== "annulee");
    const c0 = cmds.find((x) => x.id === selCmd);
    const f0 = c0 && c0.factId ? facts.find((f) => f.id === c0.factId) : null;
    return (
      <div>
        {canFront && (<div className="ec-card p-4 mb-5" data-testid="ag-cmd-form"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvelle commande ou devis</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Client</label><select value={fc.clientId} onChange={(e) => setFc({ ...fc, clientId: e.target.value })} data-testid="ag-cmd-client" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Type</label><select value={fc.kind} onChange={(e) => setFc({ ...fc, kind: e.target.value })} data-testid="ag-cmd-type" className={ecInput} style={ecBorder}><option value="serie">Vente courante (produits de la ferme)</option><option value="mesure">Précommande (récolte ou animaux à venir, avance)</option></select></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Objet (ex. Maïs de la récolte de juin, 20 poulets pour Noël, Légumes pour le marché)</label><input value={fc.subject} onChange={(e) => setFc({ ...fc, subject: e.target.value })} data-testid="ag-cmd-objet" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Livraison souhaitée (facultatif)</label><input type="date" min={today} value={fc.due} onChange={(e) => setFc({ ...fc, due: e.target.value })} data-testid="ag-cmd-livraison" className={ecInput} style={ecBorder} /></div>
          </div>
          {fc.lines.length > 0 && (<div className="ec-wrap mt-3"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Désignation</th><th>Unité</th><th className="text-right">Quantité</th><th className="text-right">Prix unitaire</th><th className="text-right">Montant</th><th></th></tr></thead>
            <tbody>{fc.lines.map((l) => (<tr key={l.id} data-testid="ag-cmd-lignebrouillon"><td className="py-1.5">{l.label}</td><td>{l.unit || "—"}</td><td className="text-right tabular">{l.qty}</td><td className="text-right tabular">{agF(l.pu)}</td><td className="text-right tabular">{fmt(agR2(l.qty * l.pu))}</td><td className="text-right"><button onClick={() => setFc({ ...fc, lines: fc.lines.filter((x) => x.id !== l.id) })} className="text-xs underline">Retirer</button></td></tr>))}</tbody>
            <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }}><td colSpan={4}>Total hors taxe</td><td className="text-right tabular" data-testid="ag-cmd-brouillon-total">{fmt(agMontantLignes(fc.lines))}</td><td></td></tr></tfoot></table></div>)}
          {prods.length > 0 && <details className="mt-2" data-testid="ag-cmd-catalogue"><summary className="text-sm cursor-pointer" style={{ color: "#152238" }}>Ouvrir le catalogue (photos, prix, stock)</summary><div className="mt-2">{cartes("commande")}</div></details>}
          <div className="grid md:grid-cols-6 gap-2 items-end mt-2">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Produit de la ferme (ou texte libre à droite)</label><select value={fc.productId} onChange={(e) => choisirProduitLigne(e.target.value)} data-testid="ag-cmd-produit" className={ecInput} style={ecBorder}><option value="">— texte libre —</option>{prods.filter((x) => x.active !== false).map((x) => <option key={x.id} value={x.id}>{x.name} (stock {stockProd(x.id)})</option>)}</select></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Désignation</label><input value={fc.label} onChange={(e) => setFc({ ...fc, label: e.target.value, productId: fc.productId && prods.find((p) => p.id === fc.productId && p.name === e.target.value) ? fc.productId : "" })} data-testid="ag-cmd-designation" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Quantité</label><input type="number" min="0" step="0.001" value={fc.qty} onChange={(e) => setFc({ ...fc, qty: e.target.value })} data-testid="ag-cmd-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Prix unitaire</label><input type="number" min="0" step="0.01" value={fc.pu} onChange={(e) => setFc({ ...fc, pu: e.target.value })} data-testid="ag-cmd-pu" className={ecInput + " tabular"} style={ecBorder} /></div>
          </div>
          <div className="flex flex-wrap gap-2 mt-2"><button onClick={() => ajouterLigneCmd()} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ag-cmd-ajouter-ligne">Ajouter la ligne</button><button onClick={creerCommande} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-cmd-creer">Enregistrer la commande</button></div>
          {alertePerte("cmd")}</div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <div className="flex-1 min-w-[150px]"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (n°, client, objet)</label><input value={cqq} onChange={(e) => setCqq(e.target.value)} data-testid="ag-cmd-recherche" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>État</label><select value={cet} onChange={(e) => setCet(e.target.value)} data-testid="ag-cmd-filtre-etat" className={ecInput} style={ecBorder}><option value="">Tous</option>{AG_ETATS_CMD.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        </div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>Date</th><th>Client</th><th>Objet</th><th>Livraison</th><th className="text-right">Total HT</th><th>État</th><th></th></tr></thead>
          <tbody>{rows.map((c) => (<tr key={c.id} data-testid="ag-cmd-ligne" style={{ background: c.id === selCmd ? "#E6F1EE" : undefined, opacity: c.status === "annulee" ? 0.5 : 1 }}><td className="py-1.5 tabular text-xs">{c.number}</td><td>{ecDateFr(c.date)}</td><td className="font-semibold">{nomClient(c.clientId)}</td><td className="text-xs">{c.subject || (c.kind === "mesure" ? "Spéciale" : "—")}</td><td>{c.due ? ecDateFr(c.due) : "—"}</td><td className="text-right tabular">{fmt(cmdHt(c))}</td>
            <td>{ecPastille(etatCmd(c), c.status === "livree" ? "ok" : c.status === "annulee" ? "neutre" : c.status === "prete" ? "info" : "attente")}</td>
            <td className="text-right"><button onClick={() => setSelCmd(c.id === selCmd ? "" : c.id)} className="text-xs underline" data-testid="ag-cmd-ouvrir">{c.id === selCmd ? "Fermer" : "Ouvrir"}</button></td></tr>))}</tbody>
          {rows.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="ag-cmd-total-ligne"><td colSpan={5}>Total ({rowsOk.length} commande{rowsOk.length > 1 ? "s" : ""}, hors annulées)</td><td className="text-right tabular" data-testid="ag-cmd-tot-ht">{fmt(agR2(rowsOk.reduce((s, c) => s + cmdHt(c), 0)))}</td><td colSpan={2}></td></tr></tfoot>}</table></div>
        {rows.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{cmds.length === 0 ? "Aucune commande." : "Aucune commande ne correspond à ces filtres."}</div>}
        {c0 && (<div className="ec-card p-4 mt-5" data-testid="ag-cmd-detail">
          <div className="display text-lg mb-1" style={{ color: "#152238" }}>{c0.number} — {nomClient(c0.clientId)}</div>
          <div className="text-xs mb-2" style={{ color: "#8A8370" }}>{c0.kind === "mesure" ? "Précommande" : "Vente courante"}{c0.subject ? " · " + c0.subject : ""} · état : <b data-testid="ag-cmd-d-etat">{etatCmd(c0)}</b>{c0.due ? " · livraison souhaitée le " + ecDateFr(c0.due) : ""}</div>
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Désignation</th><th className="text-right">Quantité</th><th className="text-right">Prix unitaire</th><th className="text-right">Montant</th></tr></thead>
            <tbody>{c0.lines.map((l) => (<tr key={l.id}><td className="py-1.5">{l.label}</td><td className="text-right tabular">{l.qty} {l.unit}</td><td className="text-right tabular">{agF(l.pu)}</td><td className="text-right tabular">{fmt(agR2(l.qty * l.pu))}</td></tr>))}</tbody></table></div>
          <div className="text-sm mb-3">Total hors taxe : <b className="tabular" data-testid="ag-cmd-d-ht">{fmt(cmdHt(c0))}</b>{tcaRate > 0 ? " · taxe " + tcaRate + " % : " + fmt(agR2(cmdHt(c0) * tcaRate / 100)) : ""} · coût de revient des lots liés : <b className="tabular" data-testid="ag-cmd-d-cout">{fmt(agR2(lotsOk.filter((l) => l.orderId === c0.id).reduce((s, l) => s + coutLot(l).total, 0)))}</b></div>
          <div className="flex flex-wrap gap-2 mb-3">
            <button onClick={() => setImprimer({ kind: "devis", id: c0.id })} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ag-cmd-devis">Imprimer le devis</button>
            {canFront && c0.status === "devis" && <button onClick={() => changerEtat(c0, "confirmee", "Commande confirmée.")} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-cmd-confirmer">Confirmer (accord du client)</button>}
            {canFront && (c0.status === "confirmee" || c0.status === "enprod") && <button onClick={() => changerEtat(c0, "prete", "Commande prête.")} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ag-cmd-prete">Marquer prête</button>}
            {canFront && (c0.status === "confirmee" || c0.status === "enprod" || c0.status === "prete") && <button onClick={() => facturerCommande(c0)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-cmd-facturer">{confPerte === c0.id ? "Facturer quand même (à perte)" : "Livrer et facturer"}</button>}
            {canEdit && c0.status !== "livree" && c0.status !== "annulee" && <button onClick={() => annulerCommande(c0)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ag-cmd-annuler">Annuler la commande</button>}
          </div>
          {confPerte === c0.id && (<div className="p-3 rounded text-sm mb-3" style={{ background: "#FBE9E4", color: "#7A2E1F" }} data-testid="ag-cmd-fact-perte">Le coût de revient des lots liés dépasse le montant facturé : facturer, c'est vendre à perte.
            {(isVendeur || !canEdit) ? <div className="mt-1">Seul un gestionnaire peut l'autoriser.</div> : (<div className="grid md:grid-cols-3 gap-2 mt-2 items-end"><div className="md:col-span-2"><label className="text-xs">Raison (obligatoire)</label><select value={motifCmd.motif} onChange={(e) => setMotifCmd({ ...motifCmd, motif: e.target.value })} data-testid="ag-cmd-fact-motif" className={ecInput} style={ecBorder}><option value="">— choisir la raison —</option>{AG_MOTIFS_PERTE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>{motifCmd.motif === "autre" && <div><label className="text-xs">Précisez</label><input value={motifCmd.txt} onChange={(e) => setMotifCmd({ ...motifCmd, txt: e.target.value })} className={ecInput} style={ecBorder} /></div>}</div>)}
            <div className="mt-2"><button onClick={() => setConfPerte("")} className="px-3 py-1.5 rounded text-xs" style={ecBtn}>Annuler</button></div></div>)}
          {canFront && c0.status !== "devis" && c0.status !== "annulee" && c0.status !== "livree" && (<div className="mb-3"><div className="display text-base mb-2" style={{ color: "#152238" }}>Acomptes reçus</div>
            <div className="grid md:grid-cols-4 gap-2 items-end">
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant</label><input type="number" min="0" step="0.01" value={ac.amount} onChange={(e) => setAc({ ...ac, amount: e.target.value })} data-testid="ag-ac-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={ac.date} onChange={(e) => setAc({ ...ac, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Mode</label><select value={ac.mode} onChange={(e) => setAc({ ...ac, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Caisse</option><option value="banque">Banque</option></select></div>
              <button onClick={() => recevoirAcompte(c0)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-ac-ok">Enregistrer l'acompte</button>
            </div></div>)}
          {(c0.acomptes || []).length > 0 && (<div className="mb-3 text-sm" data-testid="ag-ac-liste">{c0.acomptes.map((a) => (<div key={a.id} className="text-xs" data-testid="ag-ac-ligne" style={{ opacity: a.status === "annulé" ? 0.5 : 1 }}>{ecDateFr(a.date)} — acompte {fmt(a.amount)} ({a.mode === "banque" ? "banque" : "caisse"}){a.status === "annulé" ? " — annulé" : a.imputed ? " — déduit de la facture" : ""}{canEdit && a.status !== "annulé" && !a.imputed && <button onClick={() => annulerAcompte(c0, a)} className="underline ml-2" data-testid="ag-ac-annuler">Annuler</button>}</div>))}</div>)}
          {f0 && <div className="text-sm">Facture : <b>{f0.number}</b> — <button className="underline" onClick={() => { setTab("ventes"); setSelFact(f0.id); }} data-testid="ag-cmd-voir-facture">voir dans Ventes</button></div>}
        </div>)}
      </div>
    );
  };

  // ───────── Ventes (factures) ─────────
  const vteVide = () => ({ clientId: "", date: todayStr(), lines: [], productId: "", label: "", unit: "", qty: "", pu: "", payNow: true, mode: "caisse" });
  const [fv, setFv] = useBrouillon("agri-vente", vteVide());
  const [vq, setVq] = useState(""); const [vet, setVet] = useState("");
  const etatFact = (f) => (f.status === "annulee" ? "annulee" : agSolde(f).reste <= 0.004 ? "soldee" : "encaisser");
  const choisirProduitVente = (id) => { const p = prods.find((x) => x.id === id); setPerteAl(null); setFv({ ...fv, productId: id, label: p ? p.name : vivantLabel(id, id === "__service" ? "" : fv.label), unit: p ? p.unit : (isVivant(id) ? "tête" : fv.unit), pu: p && p.price ? String(p.price) : fv.pu }); };
  const ajouterCandVente = (cand, forcer) => {
    const qty = agQ(cand.qty), pu = agR2(cand.pu);
    const service = cand.productId === "__service";
    const vivant = isVivant(cand.productId);
    if (!service && !cand.productId) { showToast("Choisissez un produit du catalogue. Pour une prestation sans stock (réparation, livraison…), choisissez « Service ou prestation »."); return; }
    if (!String(cand.label || "").trim()) { showToast("Choisissez un produit ou indiquez la désignation."); return; }
    if (!(qty > 0)) { showToast("La quantité doit être supérieure à zéro."); return; }
    if (cand.pu === "" || pu < 0) { showToast("Indiquez le prix unitaire (en gourdes)."); return; }
    let perte = false, vivantInfo = null;
    if (vivant) {
      const sx = String(cand.productId), isAn = sx.startsWith("animal:");
      const an = isAn ? animaux.find((x) => x.id === sx.slice(7)) : null;
      const bd = isAn ? (an ? bandes.find((x) => x.id === an.bandeId) : null) : bandes.find((x) => x.id === sx.slice(6));
      if (!bd || (isAn && !an)) { showToast("Cet animal ou cette bande est introuvable."); return; }
      if (isAn && qty !== 1) { showToast("Un animal se vend à l'unité : quantité 1."); return; }
      if (isAn && (!animalPresent(an) || fv.lines.some((l) => l.animalId === an.id))) { showToast("Cet animal n'est plus disponible à la vente."); return; }
      if (!isAn) { const dj = agQ(fv.lines.filter((l) => l.bandeId === bd.id && !l.animalId).reduce((t, l) => t + l.qty, 0)); if (dj + qty > effectif(bd) + 0.0005) { showToast("Il ne reste que " + Math.max(0, agQ(effectif(bd) - dj)) + " animal(aux) à vendre dans « " + bd.name + " »."); return; } }
      const cu = coutTete(bd);
      perte = cu > 0 && pu + 0.004 < cu;
      vivantInfo = { bandeId: bd.id, animalId: isAn ? an.id : "" };
      if (perte && !forcer) { setPerteAl({ ou: "vte", label: String(cand.label).trim(), pu, cu, cand, motif: "", txt: "" }); return; }
    } else if (!service) {
      const deja = agQ(fv.lines.filter((l) => l.productId === cand.productId).reduce((t, l) => t + l.qty, 0)), dispo = stockProd(cand.productId);
      if (deja + qty > dispo + 0.0005) { showToast("Stock insuffisant de « " + nomProd(cand.productId) + " » : il en reste " + Math.max(0, agQ(dispo - deja)) + " " + unitProd(cand.productId) + " à vendre. Enregistrez d'abord la transformation."); return; }
      const cu = coutUnit(cand.productId);
      perte = cu > 0 && pu + 0.004 < cu;
      if (perte && !forcer) { setPerteAl({ ou: "vte", label: String(cand.label).trim(), pu, cu, cand, motif: "", txt: "" }); return; }
    }
    setPerteAl(null);
    setFv({ ...fv, lines: [...fv.lines, { id: agId(), label: String(cand.label).trim(), productId: (service || vivant) ? "" : cand.productId, bandeId: vivantInfo ? vivantInfo.bandeId : "", animalId: vivantInfo ? vivantInfo.animalId : "", service, perte, motif: perte ? forcer.motif : "", motifTxt: perte ? forcer.txt : "", unit: String(cand.unit || "").trim(), qty, pu }], productId: "", label: "", unit: "", qty: "", pu: "" });
  };
  const ajouterLigneVente = (forcer) => ajouterCandVente({ productId: fv.productId, label: fv.label, unit: fv.unit, qty: fv.qty, pu: fv.pu }, forcer);
  const ajouterRapide = (p) => { if (!(Number(p.price) > 0)) { choisirProduitVente(p.id); showToast("Ce produit n'a pas de prix : indiquez-le dans le formulaire ci-dessous."); return; } ajouterCandVente({ productId: p.id, label: p.name, unit: p.unit, qty: 1, pu: p.price }); };
  const confirmerPerte = () => {
    if (!perteAl) return;
    if (isVendeur || !canEdit) { showToast("Seul un gestionnaire peut autoriser une vente à perte : demandez-lui de la saisir."); return; }
    if (!perteAl.motif) { showToast("Choisissez la raison de cette vente à perte."); return; }
    if (perteAl.motif === "autre" && !perteAl.txt.trim()) { showToast("Précisez la raison de cette vente à perte."); return; }
    const f = { motif: perteAl.motif, txt: perteAl.txt.trim() };
    if (perteAl.ou === "cmd") ajouterCandCmd(perteAl.cand, f); else ajouterCandVente(perteAl.cand, f);
  };
  const prixDeRevient = () => {
    if (!perteAl) return; const px = String(Math.ceil(perteAl.cu)), c = perteAl.cand;
    if (perteAl.ou === "cmd") setFc({ ...fc, productId: c.productId, label: c.label, unit: c.unit || "", qty: String(c.qty), pu: px }); else setFv({ ...fv, productId: c.productId, label: c.label, unit: c.unit || "", qty: String(c.qty), pu: px });
    setPerteAl(null); showToast("Prix mis au prix de revient (" + fmt(Number(px)) + ") : vérifiez-le puis ajoutez la ligne.");
  };
  const alertePerte = (ou) => (perteAl && perteAl.ou === ou) ? (<div className="p-3 rounded text-sm mt-2" style={{ background: "#FBE9E4", color: "#7A2E1F" }} data-testid={"ag-" + (ou === "cmd" ? "cmd" : "vte") + "-perte"}>
    Attention : « {perteAl.label} » est proposé à <b>{agF(perteAl.pu)}</b> alors que son coût de revient moyen est de <b>{agF(perteAl.cu)}</b> : vous perdez <b>{agF(agR2(perteAl.cu - perteAl.pu))}</b> par unité. Une vente à perte doit rester exceptionnelle : sinon l'entreprise s'appauvrit à chaque vente. Corrigez le prix, ou justifiez.
    {(isVendeur || !canEdit) ? <div className="mt-2" data-testid="ag-perte-gestionnaire">Seul un gestionnaire peut autoriser une vente à perte. Mettez le prix de revient ou demandez-lui.</div> : (
      <div className="grid md:grid-cols-3 gap-2 mt-2 items-end"><div className="md:col-span-2"><label className="text-xs">Raison de la vente à perte (obligatoire)</label><select value={perteAl.motif} onChange={(e) => setPerteAl({ ...perteAl, motif: e.target.value })} data-testid="ag-perte-motif" className={ecInput} style={ecBorder}><option value="">— choisir la raison —</option>{AG_MOTIFS_PERTE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        {perteAl.motif === "autre" && <div><label className="text-xs">Précisez</label><input value={perteAl.txt} onChange={(e) => setPerteAl({ ...perteAl, txt: e.target.value })} data-testid="ag-perte-motif-txt" className={ecInput} style={ecBorder} /></div>}</div>)}
    <div className="flex flex-wrap gap-2 mt-2"><button onClick={prixDeRevient} className="px-3 py-1.5 rounded text-xs" style={ecBtnGold} data-testid={"ag-" + ou + "-perte-prixrevient"}>Mettre au prix de revient ({fmt(Math.ceil(perteAl.cu))})</button>{!(isVendeur || !canEdit) && <button onClick={confirmerPerte} className="px-3 py-1.5 rounded text-xs" style={ecBtn} data-testid={"ag-" + ou + "-perte-confirmer"}>{ou === "cmd" ? "Ajouter quand même (à perte)" : "Vendre quand même (à perte)"}</button>}<button onClick={() => setPerteAl(null)} className="px-3 py-1.5 rounded text-xs" style={ecBtn}>Annuler</button></div></div>) : null;
  const venteComptoir = () => {
    const f = emettreFacture({ orderId: "", clientId: fv.clientId, date: fv.date, lines: fv.lines, payNow: fv.payNow, payMode: fv.mode });
    if (f) { setFv({ ...vteVide(), mode: fv.mode, payNow: fv.payNow }); setSelFact(f.id); }
  };
  const Ventes = () => {
    const rows = facts.filter((f) => (!vet || etatFact(f) === vet) && (!vq.trim() || [f.number, nomClient(f.clientId)].join(" ").toLowerCase().includes(vq.trim().toLowerCase()))).sort((a, b) => (a.date < b.date ? 1 : -1));
    const rowsOk = rows.filter((f) => f.status !== "annulee");
    const f0 = facts.find((x) => x.id === selFact);
    return (
      <div>
        {canFront && (<div className="ec-card p-4 mb-5" data-testid="ag-vte-form"><div className="display text-base mb-2" style={{ color: "#152238" }}>Vente directe (comptoir ou stock)</div>
          <div className="mb-3" data-testid="ag-vte-catalogue">{cartes("vente")}</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Client (facultatif)</label><select value={fv.clientId} onChange={(e) => setFv({ ...fv, clientId: e.target.value })} data-testid="ag-vte-client" className={ecInput} style={ecBorder}><option value="">Client de passage</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={fv.date} onChange={(e) => setFv({ ...fv, date: e.target.value })} data-testid="ag-vte-date" className={ecInput} style={ecBorder} /></div>
          </div>
          {fv.lines.length > 0 && (<div className="ec-wrap mt-3"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Désignation</th><th className="text-right">Quantité</th><th className="text-right">Prix unitaire</th><th className="text-right">Montant</th><th></th></tr></thead>
            <tbody>{fv.lines.map((l) => (<tr key={l.id} data-testid="ag-vte-lignebrouillon"><td className="py-1.5">{l.label}</td><td className="text-right tabular">{l.qty} {l.unit}</td><td className="text-right tabular">{agF(l.pu)}</td><td className="text-right tabular">{fmt(agR2(l.qty * l.pu))}</td><td className="text-right"><button onClick={() => setFv({ ...fv, lines: fv.lines.filter((x) => x.id !== l.id) })} className="text-xs underline">Retirer</button></td></tr>))}</tbody>
            <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }}><td colSpan={3}>Total hors taxe{tcaRate > 0 ? " (taxe " + tcaRate + " % en plus)" : ""}</td><td className="text-right tabular" data-testid="ag-vte-brouillon-total">{fmt(agMontantLignes(fv.lines))}</td><td></td></tr></tfoot></table></div>)}
          <div className="grid md:grid-cols-6 gap-2 items-end mt-2">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Produit du catalogue</label><select value={fv.productId} onChange={(e) => choisirProduitVente(e.target.value)} data-testid="ag-vte-produit" className={ecInput} style={ecBorder}><option value="">— choisir un produit —</option>{prods.filter((x) => x.active !== false).map((x) => <option key={x.id} value={x.id} disabled={stockProd(x.id) <= 0}>{x.name} — {x.price ? agF(x.price) : "prix à saisir"} — {stockProd(x.id) > 0 ? "stock " + stockProd(x.id) + " " + x.unit : "rupture"}</option>)}{bandes.filter((b) => b.status === "encours" && b.mode === "lot" && effectif(b) > 0).map((b) => <option key={"b" + b.id} value={"bande:" + b.id}>Animaux vivants — {b.name} (reste {effectif(b)})</option>)}{bandes.filter((b) => b.mode === "individuel").flatMap((b) => animauxDe(b).filter(animalPresent).map((a) => <option key={"a" + a.id} value={"animal:" + a.id}>Animal — {a.tag} ({b.name})</option>))}<option value="__service">Service ou prestation (hors stock)</option></select></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Désignation</label><input value={fv.label} onChange={(e) => setFv({ ...fv, label: e.target.value })} data-testid="ag-vte-designation" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Quantité</label><input type="number" min="0" step="0.001" value={fv.qty} onChange={(e) => setFv({ ...fv, qty: e.target.value })} data-testid="ag-vte-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Prix unitaire</label><input type="number" min="0" step="0.01" value={fv.pu} onChange={(e) => setFv({ ...fv, pu: e.target.value })} data-testid="ag-vte-pu" className={ecInput + " tabular"} style={ecBorder} /></div>
          </div>
          <div className="flex flex-wrap gap-3 items-center mt-2">
            <button onClick={() => ajouterLigneVente()} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ag-vte-ajouter-ligne">Ajouter la ligne</button>
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={fv.payNow} onChange={(e) => setFv({ ...fv, payNow: e.target.checked })} data-testid="ag-vte-encaisser" />Encaisser tout de suite</label>
            {fv.payNow && <select value={fv.mode} onChange={(e) => setFv({ ...fv, mode: e.target.value })} data-testid="ag-vte-mode" className={ecInput} style={{ ...ecBorder, width: "auto" }}><option value="caisse">Caisse</option><option value="banque">Banque</option></select>}
            <button onClick={venteComptoir} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-vte-emettre">Émettre la facture</button>
          </div>
          {alertePerte("vte")}</div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <div className="flex-1 min-w-[150px]"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (n° de facture, client)</label><input value={vq} onChange={(e) => setVq(e.target.value)} data-testid="ag-vte-recherche" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>État</label><select value={vet} onChange={(e) => setVet(e.target.value)} data-testid="ag-vte-filtre-etat" className={ecInput} style={ecBorder}><option value="">Tous</option><option value="encaisser">À encaisser</option><option value="soldee">Soldée</option><option value="annulee">Annulée</option></select></div>
        </div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>Date</th><th>Client</th><th className="text-right">Total HT</th><th className="text-right">Total TTC</th><th className="text-right">Reste dû</th><th>État</th><th></th></tr></thead>
          <tbody>{rows.map((f) => { const e = etatFact(f); return (<tr key={f.id} data-testid="ag-vte-ligne" style={{ background: f.id === selFact ? "#E6F1EE" : undefined, opacity: e === "annulee" ? 0.5 : 1 }}><td className="py-1.5 tabular text-xs">{f.number}</td><td>{ecDateFr(f.date)}</td><td className="font-semibold">{nomClient(f.clientId)}</td><td className="text-right tabular">{fmt(f.ht)}</td><td className="text-right tabular">{fmt(f.ttc)}</td><td className="text-right tabular">{e === "annulee" ? "—" : fmt(agSolde(f).reste)}</td>
            <td>{e === "soldee" ? ecPastille("Soldée", "ok") : e === "annulee" ? ecPastille("Annulée", "neutre") : ecPastille("À encaisser", "attente")}</td>
            <td className="text-right"><button onClick={() => setSelFact(f.id === selFact ? "" : f.id)} className="text-xs underline" data-testid="ag-vte-ouvrir">{f.id === selFact ? "Fermer" : "Ouvrir"}</button></td></tr>); })}</tbody>
          {rows.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="ag-vte-total-ligne"><td colSpan={3}>Total ({rowsOk.length} facture{rowsOk.length > 1 ? "s" : ""}, hors annulées)</td><td className="text-right tabular" data-testid="ag-vte-tot-ht">{fmt(agR2(rowsOk.reduce((s, f) => s + f.ht, 0)))}</td><td className="text-right tabular" data-testid="ag-vte-tot-ttc">{fmt(agR2(rowsOk.reduce((s, f) => s + f.ttc, 0)))}</td><td className="text-right tabular" data-testid="ag-vte-tot-reste">{fmt(agR2(rowsOk.reduce((s, f) => s + agSolde(f).reste, 0)))}</td><td colSpan={2}></td></tr></tfoot>}</table></div>
        {rows.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{facts.length === 0 ? "Aucune facture." : "Aucune facture ne correspond à ces filtres."}</div>}
        {f0 && (<div className="ec-card p-4 mt-5" data-testid="ag-vte-detail">
          <div className="display text-lg mb-2" style={{ color: "#152238" }}>{f0.number} — {nomClient(f0.clientId)}</div>
          <div className="text-sm mb-2">Total hors taxe <b className="tabular">{fmt(f0.ht)}</b>{f0.tca > 0 ? " · taxe " + fmt(f0.tca) : ""}{f0.recup > 0 ? " · acompte déduit " + fmt(f0.recup) : ""} · net à payer <b className="tabular">{fmt(f0.net)}</b> · payé <b className="tabular" data-testid="ag-vte-d-paye">{fmt(agSolde(f0).paye)}</b> · reste <b className="tabular" data-testid="ag-vte-d-reste">{fmt(agSolde(f0).reste)}</b></div>
          <div className="flex flex-wrap gap-2 mb-3"><button onClick={() => setImprimer({ kind: "facture", id: f0.id })} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ag-vte-imprimer">Imprimer la facture (A4 ou ticket)</button>{canEdit && f0.status !== "annulee" && <button onClick={() => annulerFacture(f0)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ag-vte-annuler">Annuler la facture</button>}</div>
          {canFront && f0.status !== "annulee" && agSolde(f0).reste > 0.004 && (<div className="grid md:grid-cols-4 gap-2 items-end mb-2">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant (vide = tout le reste)</label><input type="number" min="0" step="0.01" value={pf.amount} onChange={(e) => setPf({ ...pf, amount: e.target.value })} data-testid="ag-pay-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={pf.date} onChange={(e) => setPf({ ...pf, date: e.target.value })} data-testid="ag-pay-date" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Mode</label><select value={pf.mode} onChange={(e) => setPf({ ...pf, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Caisse</option><option value="banque">Banque</option></select></div>
            <button onClick={() => encaisser(f0)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-pay-ok">Encaisser</button></div>)}
          {(f0.payments || []).map((p) => (<div key={p.id} className="text-xs" data-testid="ag-pay-ligne" style={{ opacity: p.status === "annulé" ? 0.5 : 1 }}>{ecDateFr(p.date)} — {fmt(p.amount)} ({p.mode === "banque" ? "banque" : "caisse"}){p.status === "annulé" ? " — annulé" : canEdit && <button onClick={() => annulerPaiement(f0, p)} className="underline ml-2" data-testid="ag-pay-annuler">Annuler</button>}</div>))}
        </div>)}
      </div>
    );
  };

  // ───────── Dépenses de la ferme ─────────
  const [fd, setFd] = useBrouillon("agri-depense", { kind: "energie", date: todayStr(), label: "", supplier: "", amount: "", mode: "caisse", cible: "" });
  const [dq, setDq] = useState(""); const [dk, setDk] = useState(""); const [selDep, setSelDep] = useState("");
  const resteDep = (d) => (d.mode === "apayer" && d.status !== "annulé" ? agR2(d.amount - agPaye(d.settlements)) : 0);
  const enregistrerDepense = () => {
    if (!canEdit) return;
    const amount = agR2(fd.amount);
    if (!(amount > 0)) { showToast("Indiquez le montant (en gourdes)."); return; }
    if (fd.kind !== "salarie" && fd.mode === "apayer" && !fd.supplier.trim()) { showToast("Pour une dépense à payer plus tard, indiquez le fournisseur."); return; }
    if (!verifDate(fd.date, "enregistrer cette dépense")) return;
    const def = AG_DEPENSES.find((x) => x[0] === fd.kind) || AG_DEPENSES[0];
    const sansEcr = !def[2];
    const mode = sansEcr ? "salaires" : fd.mode;
    const [ck, cid] = String(fd.cible || "").split(":");
    if (sansEcr && !fd.cible) { showToast("La main-d'œuvre salariée s'impute à une campagne ou à une bande : choisissez laquelle."); return; }
    if (ck === "camp" && !camps.some((c) => c.id === cid && c.status === "encours")) { showToast("Cette campagne n'est plus en cours."); return; }
    if (ck === "bande" && !bandes.some((b) => b.id === cid && b.status === "encours")) { showToast("Cette bande n'est plus en cours."); return; }
    const cpt = compteMode(mode);
    const label = fd.label.trim() || def[1];
    let e = null;
    if (!sansEcr) { agAjouterComptes(accounts, setAccounts, [def[2], cpt]); e = ecrire(fd.date, "Ferme — " + label, [{ account: def[2], debit: amount, credit: 0 }, { account: cpt, debit: 0, credit: amount }], "ferme"); }
    ajouter({ type: "dep", id: agId(), date: fd.date, kind: fd.kind, label, supplier: fd.supplier.trim(), amount, mode, entryId: e ? e.id : "", campId: ck === "camp" ? cid : "", bandeId: ck === "bande" ? cid : "", status: "valide", settlements: [], by: currentUserEmail || "" });
    setFd({ ...fd, label: "", amount: "", cible: "" });
    showToast("Dépense enregistrée : " + fmt(amount) + "."); logAudit("Agriculture et élevage", "Dépense de la ferme", label + " — " + fmt(amount));
  };
  const annulerDepense = (d) => {
    if (!canEdit || d.status === "annulé") return;
    if (agPaye(d.settlements) > 0) { showToast("Annulez d'abord les règlements de cette dépense."); return; }
    if (!verifDate(today, "annuler cette dépense")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler cette dépense ? Une écriture inverse sera passée.")) return;
    const e = contre(d.entryId, "Annulation — " + d.label + " (écriture inverse)", today, "ferme");
    maj(d.id, (r) => ({ ...r, status: "annulé", reversalEntryId: e ? e.id : "" }));
    showToast("Dépense annulée.");
  };
  const reglerDep = (d) => {
    if (!canEdit || d.mode !== "apayer" || d.status === "annulé") return;
    const reste = resteDep(d);
    const amount = rg.amount === "" ? reste : agR2(rg.amount);
    if (!(amount > 0) || amount > reste + 0.004) { showToast("Le montant doit être compris entre 0 et le reste à payer (" + fmt(reste) + ")."); return; }
    if (!verifDate(rg.date, "enregistrer ce règlement")) return;
    const cpt = compteMode(rg.mode === "banque" ? "banque" : "caisse");
    agAjouterComptes(accounts, setAccounts, [cpt, "401"]);
    const e = ecrire(rg.date, "Règlement " + (d.supplier || "fournisseur") + " — " + d.label, [{ account: "401", debit: amount, credit: 0 }, { account: cpt, debit: 0, credit: amount }], d.id);
    maj(d.id, (r) => ({ ...r, settlements: [...(r.settlements || []), { id: agId(), date: rg.date, amount, mode: rg.mode, entryId: e.id, status: "valide" }] }));
    setRg({ ...rg, amount: "" }); showToast("Règlement de " + fmt(amount) + " enregistré."); logAudit("Agriculture et élevage", "Dette réglée", (d.supplier || "") + " — " + fmt(amount));
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
    const rows = deps.filter((d) => (!dk || d.kind === dk) && (!dq.trim() || [d.label, d.supplier].join(" ").toLowerCase().includes(dq.trim().toLowerCase()))).sort((a, b) => (a.date < b.date ? 1 : -1));
    const rowsOk = rows.filter((d) => d.status !== "annulé");
    const d0 = deps.find((x) => x.id === selDep);
    return (
      <div>
        {canEdit && (<div className="ec-card p-4 mb-5"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvelle dépense de la ferme</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Nature</label><select value={fd.kind} onChange={(e) => setFd({ ...fd, kind: e.target.value })} data-testid="ag-dep-nature" className={ecInput} style={ecBorder}>{AG_DEPENSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={fd.date} onChange={(e) => setFd({ ...fd, date: e.target.value })} data-testid="ag-dep-date" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Détail (facultatif)</label><input value={fd.label} onChange={(e) => setFd({ ...fd, label: e.target.value })} data-testid="ag-dep-detail-saisie" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant</label><input type="number" min="0" step="0.01" value={fd.amount} onChange={(e) => setFd({ ...fd, amount: e.target.value })} data-testid="ag-dep-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Fournisseur</label><input list="ag-dl-four" value={fd.supplier} onChange={(e) => setFd({ ...fd, supplier: e.target.value })} data-testid="ag-dep-fournisseur" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Paiement</label><select value={fd.mode} onChange={(e) => setFd({ ...fd, mode: e.target.value })} data-testid="ag-dep-mode" disabled={fd.kind === "salarie"} className={ecInput} style={ecBorder}><option value="caisse">Payé en caisse</option><option value="banque">Payé par la banque</option><option value="apayer">À payer plus tard</option></select></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Imputer à (coût de revient)</label><select value={fd.cible} onChange={(e) => setFd({ ...fd, cible: e.target.value })} data-testid="ag-dep-cible" className={ecInput} style={ecBorder}><option value="">— aucune (frais généraux de la ferme) —</option>{camps.filter((c) => c.status === "encours").map((c) => <option key={c.id} value={"camp:" + c.id}>Campagne {c.number} — {c.name}</option>)}{bandes.filter((b) => b.status === "encours").map((b) => <option key={b.id} value={"bande:" + b.id}>Bande {b.number} — {b.name}</option>)}</select></div>
          </div>
          <button onClick={enregistrerDepense} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-dep-enregistrer">Enregistrer la dépense</button></div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <div className="flex-1 min-w-[150px]"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (détail, fournisseur)</label><input value={dq} onChange={(e) => setDq(e.target.value)} data-testid="ag-dep-recherche" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Nature</label><select value={dk} onChange={(e) => setDk(e.target.value)} data-testid="ag-dep-filtre-nature" className={ecInput} style={ecBorder}><option value="">Toutes</option>{AG_DEPENSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        </div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Nature</th><th>Détail</th><th>Fournisseur</th><th className="text-right">Montant</th><th>Paiement</th><th></th></tr></thead>
          <tbody>{rows.map((d) => (<tr key={d.id} data-testid="ag-dep-ligne" style={{ opacity: d.status === "annulé" ? 0.5 : 1 }}><td className="py-1.5">{ecDateFr(d.date)}</td><td>{(AG_DEPENSES.find((x) => x[0] === d.kind) || [0, d.kind])[1]}</td><td className="text-xs">{d.label}{d.campId ? " · " + ((camps.find((c) => c.id === d.campId) || {}).name || "campagne") : ""}{d.bandeId ? " · " + nomBande(d.bandeId) : ""}</td><td>{d.supplier || "—"}</td><td className="text-right tabular">{fmt(d.amount)}</td>
            <td>{d.status === "annulé" ? ecPastille("Annulée", "neutre") : d.mode === "apayer" ? (resteDep(d) > 0.004 ? ecPastille("À payer : " + fmt(resteDep(d)), "attente") : ecPastille("Payée", "ok")) : d.mode === "salaires" ? ecPastille("Sans écriture", "neutre") : ecPastille(d.mode === "banque" ? "Banque" : "Caisse", "ok")}</td>
            <td className="text-right whitespace-nowrap">{canEdit && d.mode === "apayer" && d.status !== "annulé" && <button onClick={() => setSelDep(d.id === selDep ? "" : d.id)} className="text-xs underline mr-2" data-testid="ag-dep-regler">Régler</button>}{canEdit && d.status !== "annulé" && <button onClick={() => annulerDepense(d)} className="text-xs underline" data-testid="ag-dep-annuler">Annuler</button>}</td></tr>))}</tbody>
          {rows.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="ag-dep-total-ligne"><td colSpan={4}>Total ({rowsOk.length} dépense{rowsOk.length > 1 ? "s" : ""}, hors annulées)</td><td className="text-right tabular" data-testid="ag-dep-tot">{fmt(agR2(rowsOk.reduce((s, d) => s + d.amount, 0)))}</td><td colSpan={2}></td></tr></tfoot>}</table></div>
        {rows.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{deps.length === 0 ? "Aucune dépense de la ferme." : "Aucune dépense ne correspond à ces filtres."}</div>}
        {canEdit && d0 && d0.mode === "apayer" && d0.status !== "annulé" && (<div className="ec-card p-3 mt-3" data-testid="ag-depreg-form"><div className="text-sm mb-2">Règlement de {d0.supplier || "fournisseur"} — reste à payer <b className="tabular">{fmt(resteDep(d0))}</b></div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant (vide = tout le reste)</label><input type="number" min="0" step="0.01" value={rg.amount} onChange={(e) => setRg({ ...rg, amount: e.target.value })} data-testid="ag-depreg-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={rg.date} onChange={(e) => setRg({ ...rg, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Mode</label><select value={rg.mode} onChange={(e) => setRg({ ...rg, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Caisse</option><option value="banque">Banque</option></select></div>
            <button onClick={() => reglerDep(d0)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-depreg-valider">Enregistrer le règlement</button>
          </div>
          {(d0.settlements || []).map((s) => (<div key={s.id} className="text-xs mt-1" data-testid="ag-depreg-ligne" style={{ opacity: s.status === "annulé" ? 0.5 : 1 }}>{ecDateFr(s.date)} — {fmt(s.amount)}{s.status === "annulé" ? " — annulé" : <button onClick={() => annulerRegDep(d0, s)} className="underline ml-2">Annuler</button>}</div>))}
        </div>)}
      </div>
    );
  };

  // ───────── Imputations communes (cultures et élevage) ─────────
  const enregistrerUsage = (cible, f, reset, minDate, debutLib) => {
    if (!canEdit) return;
    const qty = agQ(f.qty);
    if (!f.matId) { showToast("Choisissez l'intrant utilisé."); return; }
    if (!(qty > 0)) { showToast("La quantité utilisée doit être supérieure à zéro."); return; }
    if (!verifDate(f.date, "enregistrer cet usage")) return;
    if (minDate && f.date < minDate) { showToast("L'intrant ne peut pas être utilisé avant le début " + debutLib + " (" + ecDateFr(minDate) + ")."); return; }
    if (stockMat(f.matId) + 0.0005 < qty) { showToast("Stock insuffisant de " + nomMat(f.matId) + " : " + stockMat(f.matId) + " " + unitMat(f.matId) + " disponible, " + qty + " demandé."); return; }
    const pu = prixMoyen(f.matId);
    ajouter({ type: "usage", id: agId(), date: f.date, ...cible, matId: f.matId, qty, pu, cost: agR2(qty * pu), status: "valide", by: currentUserEmail || "" });
    reset();
    showToast("Intrant utilisé : " + nomMat(f.matId) + " (" + qty + " " + unitMat(f.matId) + ") — coût " + fmt(agR2(qty * pu)) + "."); logAudit("Agriculture et élevage", "Intrant utilisé", nomMat(f.matId) + " — " + qty);
  };
  const annulerUsage = (u) => {
    if (!canEdit || u.status === "annulé") return;
    maj(u.id, (r) => ({ ...r, status: "annulé", canceledAt: today }));
    showToast("Usage annulé : l'intrant revient en stock."); logAudit("Agriculture et élevage", "Usage annulé", nomMat(u.matId));
  };
  const annulerRecolte = (r) => {
    if (!canEdit || r.status === "annulé") return;
    if (stockProd(r.productId) - r.qty < -0.0005) { showToast("Annulation impossible : une partie de cette production a déjà été vendue ou transformée (le stock deviendrait négatif)."); return; }
    maj(r.id, (x) => ({ ...x, status: "annulé", canceledAt: today }));
    showToast("Production annulée : le stock est corrigé."); logAudit("Agriculture et élevage", "Récolte annulée", nomProd(r.productId) + " — " + r.qty);
  };
  const payerAchatAnimaux = ({ bandeId, animalId, amount, pay, supplier, date, label }) => {
    const def = AG_DEPENSES.find((x) => x[0] === "animaux");
    const cpt = compteMode(pay);
    agAjouterComptes(accounts, setAccounts, [def[2], cpt]);
    const e = ecrire(date, "Ferme — " + label, [{ account: def[2], debit: amount, credit: 0 }, { account: cpt, debit: 0, credit: amount }], bandeId || "ferme");
    const id = agId();
    ajouter({ type: "dep", id, date, kind: "animaux", label, supplier: String(supplier || "").trim(), amount, mode: pay, entryId: e.id, bandeId: bandeId || "", animalId: animalId || "", status: "valide", settlements: [], by: currentUserEmail || "" });
    return id;
  };

  // ───────── Cultures : parcelles, campagnes, récoltes ─────────
  const [fpa, setFpa] = useBrouillon("agri-parcelle", { name: "", area: "", unit: "carreau", place: "" });
  const [fca, setFca] = useBrouillon("agri-campagne", { name: "", parcId: "", productId: "", start: todayStr() });
  const [selCamp, setSelCamp] = useState("");
  const [fcu, setFcu] = useState({ matId: "", qty: "", date: todayStr() });
  const [fre, setFre] = useState({ qty: "", date: todayStr(), note: "" });
  const [errParc, setErrParc] = useState("");
  const retirerParcelle = (p) => {
    if (!canEdit) return;
    if (camps.some((c) => c.parcId === p.id)) { showToast("Cette parcelle a des campagnes : elle ne peut pas être retirée."); return; }
    setAgri((prev) => (prev || []).filter((r) => !(r && r.type === "parc" && r.id === p.id)));
    agriRef.current = agriRef.current.filter((r) => !(r && r.type === "parc" && r.id === p.id));
    showToast("Parcelle « " + p.name + " » retirée."); logAudit("Agriculture et élevage", "Parcelle retirée", p.name);
  };
  const ajouterParcelle = () => {
    if (!canEdit) return;
    const name = fpa.name.trim();
    const refus = (m) => { setErrParc(m); showToast(m); };
    if (!name) { refus("Indiquez le nom de la parcelle (ex. Champ du bas, Parcelle 3)."); return; }
    if (lignesAJour("parc").some((p) => agNom(p.name) === agNom(name))) { refus("Refusé : une parcelle « " + name + " » existe déjà (les majuscules et les accents ne comptent pas). Choisissez un autre nom."); return; }
    if (fpa.area !== "" && !(Number(fpa.area) > 0)) { refus("La superficie doit être supérieure à zéro."); return; }
    setErrParc("");
    ajouter({ type: "parc", id: agId(), name, area: fpa.area === "" ? 0 : agQ(fpa.area), unit: fpa.unit, place: fpa.place.trim(), active: true });
    setFpa({ ...fpa, name: "", area: "", place: "" }); showToast("Parcelle « " + name + " » ajoutée."); logAudit("Agriculture et élevage", "Parcelle ajoutée", name);
  };
  const creerCampagne = () => {
    if (!canEdit) return;
    const name = fca.name.trim();
    if (!name) { showToast("Donnez un nom à la campagne (ex. Maïs printemps 2026)."); return; }
    if (!fca.parcId) { showToast("Choisissez la parcelle cultivée (créez-la d'abord si besoin)."); return; }
    if (!fca.productId) { showToast("Choisissez le produit récolté (créez-le d'abord dans l'onglet Produits)."); return; }
    if (!verifDate(fca.start, "ouvrir cette campagne")) return;
    const number = numero("CP", camps, fca.start);
    ajouter({ type: "camp", id: agId(), number, name, parcId: fca.parcId, productId: fca.productId, start: fca.start, status: "encours", by: currentUserEmail || "" });
    setFca({ ...fca, name: "" }); showToast("Campagne " + number + " ouverte."); logAudit("Agriculture et élevage", "Campagne ouverte", number + " — " + name);
  };
  const recolter = (c) => {
    if (!canEdit || c.status !== "encours") return;
    const qty = agQ(fre.qty);
    if (!(qty > 0)) { showToast("La quantité récoltée doit être supérieure à zéro."); return; }
    if (!verifDate(fre.date, "enregistrer cette récolte")) return;
    if (fre.date < c.start) { showToast("La récolte ne peut pas précéder le début de la campagne (" + ecDateFr(c.start) + ")."); return; }
    ajouter({ type: "recolte", id: agId(), date: fre.date, campId: c.id, productId: c.productId, qty, note: fre.note.trim(), status: "valide", by: currentUserEmail || "" });
    setFre({ ...fre, qty: "", note: "" }); showToast("Récolte enregistrée : " + qty + " " + unitProd(c.productId) + " de " + nomProd(c.productId) + " ajoutés au stock."); logAudit("Agriculture et élevage", "Récolte", c.number + " — " + qty);
  };
  const cloturerCamp = (c) => {
    if (!canEdit || c.status !== "encours") return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm(recolteCamp(c) > 0 ? "Clôturer cette campagne ? Plus aucune récolte ni aucun intrant ne pourra y être ajouté." : "Aucune récolte n'est enregistrée : clôturer quand même (campagne perdue) ? Les frais restent comptés.")) return;
    maj(c.id, (r) => ({ ...r, status: "cloturee", closedAt: today }));
    showToast("Campagne clôturée : coût de revient final " + (recolteCamp(c) > 0 ? fmt(agR2(coutCamp(c).total / recolteCamp(c))) + " par " + unitProd(c.productId) : "non calculé (aucune récolte)") + "."); logAudit("Agriculture et élevage", "Campagne clôturée", c.number);
  };
  const annulerCamp = (c) => {
    if (!canEdit || c.status === "annulee") return;
    if (usagesOk.some((u) => u.campId === c.id) || recoltesOk.some((r) => r.campId === c.id) || depsOk.some((d) => d.campId === c.id)) { showToast("Annulez d'abord les intrants, les récoltes et les dépenses imputés à cette campagne."); return; }
    maj(c.id, (r) => ({ ...r, status: "annulee" })); setSelCamp(""); showToast("Campagne annulée.");
  };
  const unites = ["hectare", "carreau", "are", "m²"];
  const Cultures = () => {
    const c0 = camps.find((x) => x.id === selCamp);
    return (
      <div>
        {canEdit && (<div className="grid md:grid-cols-2 gap-4 mb-5">
          <div className="ec-card p-4" data-testid="ag-parc-form"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvelle parcelle</div>
            <div className="grid grid-cols-2 gap-2 items-end">
              <div className="col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom (Champ du bas, Parcelle 3…)</label><input value={fpa.name} onChange={(e) => { setErrParc(""); setFpa({ ...fpa, name: e.target.value }); }} data-testid="ag-parc-nom" className={ecInput} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Superficie (facultatif)</label><input type="number" min="0" step="0.01" value={fpa.area} onChange={(e) => setFpa({ ...fpa, area: e.target.value })} data-testid="ag-parc-surface" className={ecInput + " tabular"} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Unité</label><select value={fpa.unit} onChange={(e) => setFpa({ ...fpa, unit: e.target.value })} data-testid="ag-parc-unite" className={ecInput} style={ecBorder}>{unites.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
              <div className="col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Lieu (facultatif)</label><input value={fpa.place} onChange={(e) => setFpa({ ...fpa, place: e.target.value })} data-testid="ag-parc-lieu" className={ecInput} style={ecBorder} /></div>
            </div>
            <button onClick={ajouterParcelle} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-parc-ajouter">Ajouter la parcelle</button>
            {errParc && <div className="mt-2 px-3 py-2 rounded text-sm" style={{ background: "#FBE9E5", color: "#A6432F" }} data-testid="ag-parc-erreur">{errParc}</div>}</div>
          <div className="ec-card p-4" data-testid="ag-camp-form"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvelle campagne (une saison sur une parcelle)</div>
            <div className="grid grid-cols-2 gap-2 items-end">
              <div className="col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom (Maïs printemps 2026…)</label><input value={fca.name} onChange={(e) => setFca({ ...fca, name: e.target.value })} data-testid="ag-camp-nom" className={ecInput} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Parcelle</label><select value={fca.parcId} onChange={(e) => setFca({ ...fca, parcId: e.target.value })} data-testid="ag-camp-parcelle" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{parcs.filter((p) => p.active !== false).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Produit récolté</label><select value={fca.productId} onChange={(e) => setFca({ ...fca, productId: e.target.value })} data-testid="ag-camp-produit" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{prods.filter((p) => p.active !== false).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}</select></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Début (semis ou plantation)</label><input type="date" max={today} value={fca.start} onChange={(e) => setFca({ ...fca, start: e.target.value })} data-testid="ag-camp-debut" className={ecInput} style={ecBorder} /></div>
            </div>
            <button onClick={creerCampagne} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-camp-creer">Ouvrir la campagne</button></div>
        </div>)}
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Campagnes</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>Campagne</th><th>Parcelle</th><th>Produit</th><th>Début</th><th className="text-right">Coût</th><th className="text-right">Récolté</th><th className="text-right">Coût par unité</th><th>État</th><th></th></tr></thead>
          <tbody>{camps.slice().sort((a, b) => (a.start < b.start ? 1 : -1)).map((c) => { const k = coutCamp(c), q = recolteCamp(c); return (
            <tr key={c.id} data-testid="ag-camp-ligne" style={{ background: c.id === selCamp ? "#E6F1EE" : undefined, opacity: c.status === "annulee" ? 0.5 : 1 }}><td className="py-1.5 tabular text-xs">{c.number}</td><td className="font-semibold">{c.name}</td><td>{nomParc(c.parcId)}</td><td>{nomProd(c.productId)}</td><td>{ecDateFr(c.start)}</td><td className="text-right tabular" data-testid="ag-camp-cout">{fmt(k.total)}</td><td className="text-right tabular" data-testid="ag-camp-recolte">{q} {unitProd(c.productId)}</td><td className="text-right tabular" data-testid="ag-camp-cu">{q > 0 ? fmt(agR2(k.total / q)) : "—"}</td>
              <td>{c.status === "encours" ? ecPastille("En cours", "attente") : c.status === "cloturee" ? ecPastille("Clôturée", "ok") : ecPastille("Annulée", "neutre")}</td>
              <td className="text-right"><button onClick={() => setSelCamp(c.id === selCamp ? "" : c.id)} className="text-xs underline" data-testid="ag-camp-ouvrir">{c.id === selCamp ? "Fermer" : "Ouvrir"}</button></td></tr>); })}</tbody></table>
          {camps.length === 0 && <div className="text-sm mt-2" style={{ color: "#8A8370" }}>Aucune campagne. Créez d'abord une parcelle et un produit, puis ouvrez une campagne.</div>}</div>
        {parcs.length > 0 && (<div className="ec-card p-4 mt-4" data-testid="ag-parc-liste">
          <div className="display text-base mb-1" style={{ color: "#152238" }}>Mes parcelles ({parcs.length})</div>
          {parcs.map((p, i) => (<div key={p.id} data-testid="ag-parc-ligne" className="py-1.5 text-sm" style={{ borderTop: i > 0 ? "1px solid #F3EFE3" : "none", overflowWrap: "anywhere" }}><b>{p.name}</b>{p.area ? " — " + p.area + " " + p.unit : ""}{p.place ? " — " + p.place : ""}<span className="text-xs" style={{ color: "#8A8370" }}> · {camps.filter((c) => c.parcId === p.id).length} campagne(s)</span>{canEdit && !camps.some((c) => c.parcId === p.id) && <button className="text-xs underline ml-2" style={{ color: "#A6432F" }} onClick={() => retirerParcelle(p)} data-testid="ag-parc-retirer">Retirer</button>}</div>))}
        </div>)}
        {c0 && (<div className="ec-card p-4 mt-5" data-testid="ag-camp-detail">
          <div className="display text-lg mb-1" style={{ color: "#152238" }}>{c0.number} — {c0.name}</div>
          <div className="text-sm mb-3" style={{ color: "#5B563F" }}>Coût : intrants <b className="tabular">{fmt(coutCamp(c0).u)}</b> + frais imputés <b className="tabular">{fmt(coutCamp(c0).f)}</b> = <b className="tabular" data-testid="ag-camp-d-cout">{fmt(coutCamp(c0).total)}</b>. Pour imputer une dépense (main-d'œuvre, irrigation, transport…) à cette campagne, choisissez-la dans l'onglet Dépenses.</div>
          {canEdit && c0.status === "encours" && (<div className="grid md:grid-cols-2 gap-4 mb-3">
            <div><div className="display text-base mb-1" style={{ color: "#152238" }}>Intrant utilisé (semences, engrais, produits)</div>
              <div className="grid grid-cols-3 gap-2 items-end">
                <div className="col-span-3"><select value={fcu.matId} onChange={(e) => setFcu({ ...fcu, matId: e.target.value })} data-testid="ag-cu-mat" className={ecInput} style={ecBorder}><option value="">— choisir l'intrant —</option>{mats.filter((x) => x.active !== false).map((x) => <option key={x.id} value={x.id}>{x.name} — stock {stockMat(x.id)} {x.unit}</option>)}</select></div>
                <div><label className="text-xs" style={{ color: "#8A8370" }}>Quantité</label><input type="number" min="0" step="0.001" value={fcu.qty} onChange={(e) => setFcu({ ...fcu, qty: e.target.value })} data-testid="ag-cu-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
                <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={fcu.date} onChange={(e) => setFcu({ ...fcu, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
                <button onClick={() => enregistrerUsage({ campId: c0.id }, fcu, () => setFcu({ ...fcu, matId: "", qty: "" }), c0.start, "de la campagne")} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-cu-ajouter">Utiliser</button>
              </div></div>
            <div><div className="display text-base mb-1" style={{ color: "#152238" }}>Récolte ({unitProd(c0.productId) || "unité"})</div>
              <div className="grid grid-cols-3 gap-2 items-end">
                <div><label className="text-xs" style={{ color: "#8A8370" }}>Quantité récoltée</label><input type="number" min="0" step="0.001" value={fre.qty} onChange={(e) => setFre({ ...fre, qty: e.target.value })} data-testid="ag-re-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
                <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={fre.date} onChange={(e) => setFre({ ...fre, date: e.target.value })} data-testid="ag-re-date" className={ecInput} style={ecBorder} /></div>
                <button onClick={() => recolter(c0)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-re-ajouter">Enregistrer la récolte</button>
                <div className="col-span-3"><input placeholder="Remarque (qualité, pertes, météo…)" value={fre.note} onChange={(e) => setFre({ ...fre, note: e.target.value })} className={ecInput} style={ecBorder} /></div>
              </div></div>
          </div>)}
          <div className="display text-base mb-1" style={{ color: "#152238" }}>Intrants utilisés</div>
          <div className="ec-wrap mb-3"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Intrant</th><th className="text-right">Quantité</th><th className="text-right">Coût</th><th></th></tr></thead>
            <tbody>{usages.filter((u) => u.campId === c0.id).map((u) => (<tr key={u.id} data-testid="ag-cu-ligne" style={{ opacity: u.status === "annulé" ? 0.5 : 1 }}><td className="py-1.5">{ecDateFr(u.date)}</td><td>{nomMat(u.matId)}</td><td className="text-right tabular">{u.qty} {unitMat(u.matId)}</td><td className="text-right tabular">{fmt(u.cost)}</td><td className="text-right">{canEdit && c0.status === "encours" && u.status !== "annulé" ? <button onClick={() => annulerUsage(u)} className="text-xs underline" data-testid="ag-cu-annuler">Annuler</button> : u.status === "annulé" ? "annulé" : ""}</td></tr>))}</tbody></table>
            {usages.filter((u) => u.campId === c0.id).length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun intrant utilisé.</div>}</div>
          <div className="display text-base mb-1" style={{ color: "#152238" }}>Récoltes</div>
          <div className="ec-wrap mb-3"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th className="text-right">Quantité</th><th>Remarque</th><th></th></tr></thead>
            <tbody>{recoltes.filter((r) => r.campId === c0.id).map((r) => (<tr key={r.id} data-testid="ag-re-ligne" style={{ opacity: r.status === "annulé" ? 0.5 : 1 }}><td className="py-1.5">{ecDateFr(r.date)}</td><td className="text-right tabular">{r.qty} {unitProd(r.productId)}</td><td className="text-xs">{r.note}</td><td className="text-right">{canEdit && r.status !== "annulé" ? <button onClick={() => annulerRecolte(r)} className="text-xs underline" data-testid="ag-re-annuler">Annuler</button> : r.status === "annulé" ? "annulé" : ""}</td></tr>))}</tbody></table>
            {recoltes.filter((r) => r.campId === c0.id).length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucune récolte enregistrée.</div>}</div>
          {canEdit && (<div className="flex flex-wrap gap-2">{c0.status === "encours" && <button onClick={() => cloturerCamp(c0)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ag-camp-cloturer">Clôturer la campagne</button>}{c0.status !== "annulee" && <button onClick={() => annulerCamp(c0)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ag-camp-annuler">Annuler la campagne</button>}</div>)}
        </div>)}
      </div>
    );
  };

  // ───────── Élevage : bandes (lots) et animaux ─────────
  const [fba, setFba] = useBrouillon("agri-bande", { name: "", species: "volaille", mode: "lot", start: todayStr(), count0: "", productId: "", buy: "", pay: "caisse", supplier: "" });
  const [selBande, setSelBande] = useState("");
  const [fmo, setFmo] = useState({ kind: "mortalite", qty: "", date: todayStr(), note: "", amount: "", pay: "caisse", supplier: "" });
  const [fbu, setFbu] = useState({ matId: "", qty: "", date: todayStr() });
  const [fso, setFso] = useState({ kind: "vaccin", label: "", date: todayStr(), next: "", weight: "", animalId: "" });
  const [fpr, setFpr] = useState({ qty: "", date: todayStr() });
  const [fan, setFan] = useState({ tag: "", sex: "F", birth: "", origin: "ne", price: "", pay: "caisse", supplier: "", date: todayStr() });
  const creerBande = () => {
    if (!canEdit) return;
    const name = fba.name.trim();
    if (!name) { showToast("Donnez un nom à la bande (ex. Poulets de chair janvier, Troupeau de chèvres)."); return; }
    if (lignesAJour("bande").some((b) => agNom(b.name) === agNom(name))) { showToast("Une bande de ce nom existe déjà."); return; }
    const c0 = fba.mode === "lot" ? agQ(fba.count0) : 0;
    if (fba.mode === "lot" && !(c0 > 0)) { showToast("Indiquez l'effectif de départ (nombre d'animaux)."); return; }
    if (!verifDate(fba.start, "créer cette bande")) return;
    const buy = fba.mode === "lot" && fba.buy !== "" ? agR2(fba.buy) : 0;
    if (buy < 0) { showToast("Le prix d'achat ne peut pas être négatif."); return; }
    if (buy > 0 && fba.pay === "apayer" && !fba.supplier.trim()) { showToast("Pour un achat à payer plus tard, indiquez le fournisseur."); return; }
    const id = agId(), number = numero("EL", bandes, fba.start);
    ajouter({ type: "bande", id, number, name, species: fba.species, mode: fba.mode, start: fba.start, count0: c0, productId: fba.productId, status: "encours", by: currentUserEmail || "" });
    if (buy > 0) payerAchatAnimaux({ bandeId: id, amount: buy, pay: fba.pay, supplier: fba.supplier, date: fba.start, label: "Achat d'animaux — " + name });
    setFba({ ...fba, name: "", count0: "", buy: "", supplier: "" }); showToast("Bande " + number + " créée."); logAudit("Agriculture et élevage", "Bande créée", number + " — " + name);
  };
  const MOUV_BAISSE = ["mortalite", "perte", "autoconso"];
  const enregistrerMouv = (b) => {
    if (!canEdit || b.status !== "encours" || b.mode !== "lot") return;
    const qty = agQ(fmo.qty);
    if (!(qty > 0)) { showToast("Le nombre d'animaux doit être supérieur à zéro."); return; }
    if (!verifDate(fmo.date, "enregistrer ce mouvement")) return;
    if (fmo.date < b.start) { showToast("Ce mouvement ne peut pas précéder le début de la bande (" + ecDateFr(b.start) + ")."); return; }
    if (MOUV_BAISSE.includes(fmo.kind) && qty > effectif(b) + 0.0005) { showToast("Impossible : il ne reste que " + effectif(b) + " animal(aux) dans cette bande."); return; }
    const amount = fmo.kind === "achat" && fmo.amount !== "" ? agR2(fmo.amount) : 0;
    if (amount > 0 && fmo.pay === "apayer" && !fmo.supplier.trim()) { showToast("Pour un achat à payer plus tard, indiquez le fournisseur."); return; }
    const depId = amount > 0 ? payerAchatAnimaux({ bandeId: b.id, amount, pay: fmo.pay, supplier: fmo.supplier, date: fmo.date, label: "Achat d'animaux — " + b.name }) : "";
    ajouter({ type: "mouv", id: agId(), bandeId: b.id, date: fmo.date, kind: fmo.kind, qty, note: fmo.note.trim(), depId, status: "valide", by: currentUserEmail || "" });
    setFmo({ ...fmo, qty: "", note: "", amount: "" }); showToast((AG_MOUV.find((m) => m[0] === fmo.kind) || [0, "Mouvement"])[1] + " : " + qty + " — effectif " + agQ(effectif(b) + (MOUV_BAISSE.includes(fmo.kind) ? -qty : qty)) + "."); logAudit("Agriculture et élevage", "Mouvement d'effectif", b.number + " — " + fmo.kind + " " + qty);
  };
  const annulerMouv = (m, b) => {
    if (!canEdit || m.status === "annulé") return;
    if (!MOUV_BAISSE.includes(m.kind) && effectif(b) - m.qty < -0.0005) { showToast("Annulation impossible : une partie de ces animaux a déjà été vendue ou a disparu (l'effectif deviendrait négatif)."); return; }
    const dep = m.depId ? deps.find((d) => d.id === m.depId) : null;
    if (dep && agPaye(dep.settlements) > 0) { showToast("Annulez d'abord les règlements de l'achat de ces animaux (onglet Dépenses)."); return; }
    if (dep && !verifDate(today, "annuler cet achat")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler ce mouvement ?" + (dep ? " Une écriture inverse sera passée pour l'achat." : ""))) return;
    if (dep) { const e = contre(dep.entryId, "Annulation — " + dep.label + " (écriture inverse)", today, b.id); maj(dep.id, (r) => ({ ...r, status: "annulé", reversalEntryId: e ? e.id : "" })); }
    maj(m.id, (r) => ({ ...r, status: "annulé", canceledAt: today })); showToast("Mouvement annulé.");
  };
  const ajouterAnimal = (b) => {
    if (!canEdit || b.status !== "encours" || b.mode !== "individuel") return;
    const tag = fan.tag.trim();
    if (!tag) { showToast("Indiquez le repère de l'animal (nom, numéro de boucle…)."); return; }
    if (lignesAJour("animal").filter((a) => a.bandeId === b.id).some((a) => agNom(a.tag) === agNom(tag))) { showToast("Un animal de cette bande porte déjà ce repère."); return; }
    if (fan.birth && isFutureDate(fan.birth)) { showToast("La date de naissance ne peut pas être dans le futur."); return; }
    const price = fan.origin === "achete" && fan.price !== "" ? agR2(fan.price) : 0;
    if (price < 0) { showToast("Le prix d'achat ne peut pas être négatif."); return; }
    if (price > 0 && fan.pay === "apayer" && !fan.supplier.trim()) { showToast("Pour un achat à payer plus tard, indiquez le fournisseur."); return; }
    if (price > 0 && !verifDate(fan.date, "enregistrer cet achat")) return;
    const id = agId();
    ajouter({ type: "animal", id, bandeId: b.id, tag, sex: fan.sex, birth: fan.birth, origin: fan.origin, status: "present", by: currentUserEmail || "" });
    if (price > 0) payerAchatAnimaux({ bandeId: b.id, animalId: id, amount: price, pay: fan.pay, supplier: fan.supplier, date: fan.date, label: "Achat d'animal — " + tag });
    setFan({ ...fan, tag: "", birth: "", price: "", supplier: "" }); showToast("Animal « " + tag + " » ajouté."); logAudit("Agriculture et élevage", "Animal ajouté", b.number + " — " + tag);
  };
  const marquerMort = (a) => {
    if (!canEdit || a.status === "mort") return;
    if (animalVendu(a)) { showToast("Cet animal est déjà vendu."); return; }
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Enregistrer la mort de « " + a.tag + " » ?")) return;
    maj(a.id, (r) => ({ ...r, status: "mort", deathDate: today })); showToast("Mort enregistrée : « " + a.tag + " »."); logAudit("Agriculture et élevage", "Animal mort", a.tag);
  };
  const retablirAnimal = (a) => { if (!canEdit || a.status !== "mort") return; maj(a.id, (r) => ({ ...r, status: "present", deathDate: "" })); showToast("Animal rétabli."); };
  const enregistrerSoin = (b) => {
    if (!canEdit || b.status !== "encours") return;
    if (fso.kind !== "pesee" && !fso.label.trim()) { showToast("Indiquez le soin (ex. Newcastle, vermifuge, boiterie)."); return; }
    if (fso.kind === "pesee" && !(Number(fso.weight) > 0)) { showToast("Indiquez le poids (en kg)."); return; }
    if (!verifDate(fso.date, "enregistrer ce soin")) return;
    if (fso.next && fso.next < fso.date) { showToast("La date du prochain soin ne peut pas précéder ce soin."); return; }
    ajouter({ type: "soin", id: agId(), bandeId: b.id, animalId: fso.animalId, date: fso.date, kind: fso.kind, label: fso.label.trim(), next: fso.next, weight: fso.kind === "pesee" ? agQ(fso.weight) : 0, nextDone: false, status: "valide", by: currentUserEmail || "" });
    setFso({ ...fso, label: "", next: "", weight: "" }); showToast("Soin enregistré."); logAudit("Agriculture et élevage", "Soin", b.number + " — " + (fso.label.trim() || "pesée"));
  };
  const enregistrerProduction = (b) => {
    if (!canEdit || b.status !== "encours" || !b.productId) return;
    const qty = agQ(fpr.qty);
    if (!(qty > 0)) { showToast("La quantité produite doit être supérieure à zéro."); return; }
    if (!verifDate(fpr.date, "enregistrer cette production")) return;
    if (fpr.date < b.start) { showToast("La production ne peut pas précéder le début de la bande (" + ecDateFr(b.start) + ")."); return; }
    ajouter({ type: "recolte", id: agId(), date: fpr.date, bandeId: b.id, productId: b.productId, qty, note: "", status: "valide", by: currentUserEmail || "" });
    setFpr({ ...fpr, qty: "" }); showToast("Production enregistrée : " + qty + " " + unitProd(b.productId) + " de " + nomProd(b.productId) + " ajoutés au stock."); logAudit("Agriculture et élevage", "Production animale", b.number + " — " + qty);
  };
  const cloturerBande = (b) => {
    if (!canEdit || b.status !== "encours") return;
    if (effectif(b) > 0.0005) { showToast("Il reste " + effectif(b) + " animal(aux) dans cette bande : vendez-les ou enregistrez leur sortie (mortalité, perte, consommation) avant de clôturer."); return; }
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Clôturer cette bande ?")) return;
    maj(b.id, (r) => ({ ...r, status: "cloturee", closedAt: today })); showToast("Bande clôturée."); logAudit("Agriculture et élevage", "Bande clôturée", b.number);
  };
  const Elevage = () => {
    const b0 = bandes.find((x) => x.id === selBande);
    const lot = fba.mode === "lot";
    return (
      <div>
        {canEdit && (<div className="ec-card p-4 mb-5" data-testid="ag-bande-form"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvelle bande ou nouveau troupeau</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom (Poulets de chair janvier, Troupeau de chèvres…)</label><input value={fba.name} onChange={(e) => setFba({ ...fba, name: e.target.value })} data-testid="ag-bande-nom" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Espèce</label><select value={fba.species} onChange={(e) => { const sp = e.target.value; setFba({ ...fba, species: sp, mode: (AG_ESPECES.find((x) => x[0] === sp) || [0, 0, "lot"])[2] }); }} data-testid="ag-bande-espece" className={ecInput} style={ecBorder}>{AG_ESPECES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Suivi</label><select value={fba.mode} onChange={(e) => setFba({ ...fba, mode: e.target.value })} data-testid="ag-bande-mode" className={ecInput} style={ecBorder}><option value="lot">Par bande (effectif)</option><option value="individuel">Animal par animal (fiches)</option></select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Début</label><input type="date" max={today} value={fba.start} onChange={(e) => setFba({ ...fba, start: e.target.value })} data-testid="ag-bande-debut" className={ecInput} style={ecBorder} /></div>
            {lot && <div><label className="text-xs" style={{ color: "#8A8370" }}>Effectif de départ</label><input type="number" min="0" step="1" value={fba.count0} onChange={(e) => setFba({ ...fba, count0: e.target.value })} data-testid="ag-bande-effectif" className={ecInput + " tabular"} style={ecBorder} /></div>}
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Produit obtenu (œufs, lait… facultatif)</label><select value={fba.productId} onChange={(e) => setFba({ ...fba, productId: e.target.value })} data-testid="ag-bande-produit" className={ecInput} style={ecBorder}><option value="">— aucun —</option>{prods.filter((p) => p.active !== false).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}</select></div>
            {lot && <div><label className="text-xs" style={{ color: "#8A8370" }}>Prix d'achat des animaux (facultatif)</label><input type="number" min="0" step="0.01" value={fba.buy} onChange={(e) => setFba({ ...fba, buy: e.target.value })} data-testid="ag-bande-achat" className={ecInput + " tabular"} style={ecBorder} /></div>}
            {lot && fba.buy !== "" && <div><label className="text-xs" style={{ color: "#8A8370" }}>Paiement</label><select value={fba.pay} onChange={(e) => setFba({ ...fba, pay: e.target.value })} data-testid="ag-bande-pay" className={ecInput} style={ecBorder}><option value="caisse">Payé en caisse</option><option value="banque">Payé par la banque</option><option value="apayer">À payer plus tard</option></select></div>}
            {lot && fba.buy !== "" && <div><label className="text-xs" style={{ color: "#8A8370" }}>Fournisseur</label><input list="ag-dl-four" value={fba.supplier} onChange={(e) => setFba({ ...fba, supplier: e.target.value })} data-testid="ag-bande-fournisseur" className={ecInput} style={ecBorder} /></div>}
          </div>
          <button onClick={creerBande} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-bande-creer">Créer la bande</button></div>)}
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Bandes et troupeaux</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>Nom</th><th>Espèce</th><th className="text-right">Effectif</th><th className="text-right">Mortalité</th><th className="text-right">Coût total</th><th className="text-right">Coût par tête</th><th>État</th><th></th></tr></thead>
          <tbody>{bandes.slice().sort((a, b) => (a.start < b.start ? 1 : -1)).map((b) => (
            <tr key={b.id} data-testid="ag-bande-ligne" style={{ background: b.id === selBande ? "#E6F1EE" : undefined }}><td className="py-1.5 tabular text-xs">{b.number}</td><td className="font-semibold">{b.name}</td><td>{especeLib(b.species)}</td><td className="text-right tabular" data-testid="ag-bande-eff">{effectif(b)}</td><td className="text-right tabular">{b.mode === "lot" ? mortalitePct(b) + " %" : "—"}</td><td className="text-right tabular">{fmt(coutBande(b, true).total)}</td><td className="text-right tabular" data-testid="ag-bande-ct">{coutTete(b) > 0 ? agF(coutTete(b)) : "—"}</td>
              <td>{b.status === "encours" ? ecPastille("En cours", "attente") : ecPastille("Clôturée", "ok")}</td>
              <td className="text-right"><button onClick={() => setSelBande(b.id === selBande ? "" : b.id)} className="text-xs underline" data-testid="ag-bande-ouvrir">{b.id === selBande ? "Fermer" : "Ouvrir"}</button></td></tr>))}</tbody></table>
          {bandes.length === 0 && <div className="text-sm mt-2" style={{ color: "#8A8370" }}>Aucune bande. Créez votre première bande (volaille, poissons) ou votre troupeau (chèvres, bovins, porcs).</div>}</div>
        {b0 && (<div className="ec-card p-4 mt-5" data-testid="ag-bande-detail">
          <div className="display text-lg mb-1" style={{ color: "#152238" }}>{b0.number} — {b0.name} ({especeLib(b0.species)})</div>
          <div className="text-sm mb-3" style={{ color: "#5B563F" }}>Effectif : <b className="tabular" data-testid="ag-bande-d-eff">{effectif(b0)}</b> · coût : intrants et soins <b className="tabular">{fmt(coutBande(b0, true).u)}</b> + dépenses imputées (animaux, aliment, main-d'œuvre…) <b className="tabular">{fmt(coutBande(b0, true).f)}</b> = <b className="tabular">{fmt(coutBande(b0, true).total)}</b>{b0.productId ? " · production : " + prodBande(b0) + " " + unitProd(b0.productId) + " de " + nomProd(b0.productId) : ""}. Pour imputer une dépense à cette bande, choisissez-la dans l'onglet Dépenses. La vente des animaux se fait dans l'onglet Ventes.</div>
          {canEdit && b0.status === "encours" && (<div className="grid md:grid-cols-2 gap-4 mb-3">
            {b0.mode === "lot" && (<div><div className="display text-base mb-1" style={{ color: "#152238" }}>Mouvement d'effectif</div>
              <div className="grid grid-cols-3 gap-2 items-end">
                <div className="col-span-2"><select value={fmo.kind} onChange={(e) => setFmo({ ...fmo, kind: e.target.value })} data-testid="ag-mo-type" className={ecInput} style={ecBorder}>{AG_MOUV.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                <div><input type="number" min="0" step="1" placeholder="Nombre" value={fmo.qty} onChange={(e) => setFmo({ ...fmo, qty: e.target.value })} data-testid="ag-mo-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
                <div><input type="date" max={today} value={fmo.date} onChange={(e) => setFmo({ ...fmo, date: e.target.value })} data-testid="ag-mo-date" className={ecInput} style={ecBorder} /></div>
                <div className="col-span-2"><input placeholder="Cause ou remarque" value={fmo.note} onChange={(e) => setFmo({ ...fmo, note: e.target.value })} data-testid="ag-mo-note" className={ecInput} style={ecBorder} /></div>
                {fmo.kind === "achat" && <><div><input type="number" min="0" step="0.01" placeholder="Prix d'achat" value={fmo.amount} onChange={(e) => setFmo({ ...fmo, amount: e.target.value })} data-testid="ag-mo-prix" className={ecInput + " tabular"} style={ecBorder} /></div>
                  <div><select value={fmo.pay} onChange={(e) => setFmo({ ...fmo, pay: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Caisse</option><option value="banque">Banque</option><option value="apayer">À payer</option></select></div>
                  <div><input list="ag-dl-four" placeholder="Fournisseur" value={fmo.supplier} onChange={(e) => setFmo({ ...fmo, supplier: e.target.value })} className={ecInput} style={ecBorder} /></div></>}
                <button onClick={() => enregistrerMouv(b0)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-mo-ajouter">Enregistrer</button>
              </div></div>)}
            {b0.mode === "individuel" && (<div><div className="display text-base mb-1" style={{ color: "#152238" }}>Ajouter un animal</div>
              <div className="grid grid-cols-3 gap-2 items-end">
                <div><input placeholder="Repère (nom, boucle)" value={fan.tag} onChange={(e) => setFan({ ...fan, tag: e.target.value })} data-testid="ag-an-repere" className={ecInput} style={ecBorder} /></div>
                <div><select value={fan.sex} onChange={(e) => setFan({ ...fan, sex: e.target.value })} className={ecInput} style={ecBorder}><option value="F">Femelle</option><option value="M">Mâle</option></select></div>
                <div><input type="date" max={today} value={fan.birth} onChange={(e) => setFan({ ...fan, birth: e.target.value })} title="Naissance (facultatif)" className={ecInput} style={ecBorder} /></div>
                <div><select value={fan.origin} onChange={(e) => setFan({ ...fan, origin: e.target.value })} data-testid="ag-an-origine" className={ecInput} style={ecBorder}><option value="ne">Né dans la ferme</option><option value="achete">Acheté</option></select></div>
                {fan.origin === "achete" && <><div><input type="number" min="0" step="0.01" placeholder="Prix d'achat" value={fan.price} onChange={(e) => setFan({ ...fan, price: e.target.value })} data-testid="ag-an-prix" className={ecInput + " tabular"} style={ecBorder} /></div>
                  <div><select value={fan.pay} onChange={(e) => setFan({ ...fan, pay: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Caisse</option><option value="banque">Banque</option><option value="apayer">À payer</option></select></div>
                  <div className="col-span-3"><input list="ag-dl-four" placeholder="Fournisseur" value={fan.supplier} onChange={(e) => setFan({ ...fan, supplier: e.target.value })} className={ecInput} style={ecBorder} /></div></>}
                <button onClick={() => ajouterAnimal(b0)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-an-ajouter">Ajouter l'animal</button>
              </div></div>)}
            <div><div className="display text-base mb-1" style={{ color: "#152238" }}>Aliment ou produit vétérinaire utilisé</div>
              <div className="grid grid-cols-3 gap-2 items-end">
                <div className="col-span-3"><select value={fbu.matId} onChange={(e) => setFbu({ ...fbu, matId: e.target.value })} data-testid="ag-bu-mat" className={ecInput} style={ecBorder}><option value="">— choisir l'intrant —</option>{mats.filter((x) => x.active !== false).map((x) => <option key={x.id} value={x.id}>{x.name} — stock {stockMat(x.id)} {x.unit}</option>)}</select></div>
                <div><input type="number" min="0" step="0.001" placeholder="Quantité" value={fbu.qty} onChange={(e) => setFbu({ ...fbu, qty: e.target.value })} data-testid="ag-bu-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
                <div><input type="date" max={today} value={fbu.date} onChange={(e) => setFbu({ ...fbu, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
                <button onClick={() => enregistrerUsage({ bandeId: b0.id }, fbu, () => setFbu({ ...fbu, matId: "", qty: "" }), b0.start, "de la bande")} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-bu-ajouter">Utiliser</button>
              </div></div>
            <div><div className="display text-base mb-1" style={{ color: "#152238" }}>Soin, vaccin, pesée</div>
              <div className="grid grid-cols-3 gap-2 items-end">
                <div><select value={fso.kind} onChange={(e) => setFso({ ...fso, kind: e.target.value })} data-testid="ag-so-type" className={ecInput} style={ecBorder}>{AG_SOINS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                <div className="col-span-2">{fso.kind === "pesee" ? <input type="number" min="0" step="0.01" placeholder="Poids (kg)" value={fso.weight} onChange={(e) => setFso({ ...fso, weight: e.target.value })} data-testid="ag-so-poids" className={ecInput + " tabular"} style={ecBorder} /> : <input placeholder="Précisez (Newcastle, vermifuge…)" value={fso.label} onChange={(e) => setFso({ ...fso, label: e.target.value })} data-testid="ag-so-label" className={ecInput} style={ecBorder} />}</div>
                <div><input type="date" max={today} value={fso.date} onChange={(e) => setFso({ ...fso, date: e.target.value })} data-testid="ag-so-date" className={ecInput} style={ecBorder} /></div>
                <div><input type="date" value={fso.next} onChange={(e) => setFso({ ...fso, next: e.target.value })} title="Prochain rappel (facultatif)" data-testid="ag-so-next" className={ecInput} style={ecBorder} /></div>
                {b0.mode === "individuel" ? <div><select value={fso.animalId} onChange={(e) => setFso({ ...fso, animalId: e.target.value })} data-testid="ag-so-animal" className={ecInput} style={ecBorder}><option value="">Toute la bande</option>{animauxDe(b0).map((a) => <option key={a.id} value={a.id}>{a.tag}</option>)}</select></div> : <div></div>}
                <button onClick={() => enregistrerSoin(b0)} className="px-3 py-2 rounded text-sm col-span-3" style={ecBtnGold} data-testid="ag-so-ajouter">Enregistrer le soin</button>
              </div></div>
            {b0.productId && (<div><div className="display text-base mb-1" style={{ color: "#152238" }}>Production ({nomProd(b0.productId)}, {unitProd(b0.productId)})</div>
              <div className="grid grid-cols-3 gap-2 items-end">
                <div><input type="number" min="0" step="0.001" placeholder="Quantité" value={fpr.qty} onChange={(e) => setFpr({ ...fpr, qty: e.target.value })} data-testid="ag-pr-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
                <div><input type="date" max={today} value={fpr.date} onChange={(e) => setFpr({ ...fpr, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
                <button onClick={() => enregistrerProduction(b0)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ag-pr-ajouter">Enregistrer</button>
              </div></div>)}
          </div>)}
          {b0.mode === "individuel" && (<><div className="display text-base mb-1" style={{ color: "#152238" }}>Animaux ({animauxDe(b0).length})</div>
            <div className="ec-wrap mb-3"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Repère</th><th>Sexe</th><th>Naissance</th><th>Origine</th><th className="text-right">Dernier poids</th><th>État</th><th></th></tr></thead>
              <tbody>{animauxDe(b0).map((a) => { const ps = soins.filter((s) => s.animalId === a.id && s.kind === "pesee" && s.status !== "annulé").sort((x, y) => (x.date < y.date ? 1 : -1)); return (
                <tr key={a.id} data-testid="ag-an-ligne"><td className="py-1.5 font-semibold">{a.tag}</td><td>{a.sex === "M" ? "Mâle" : "Femelle"}</td><td>{a.birth ? ecDateFr(a.birth) : "—"}</td><td>{a.origin === "achete" ? "Acheté" : "Né ici"}</td><td className="text-right tabular">{ps[0] ? ps[0].weight + " kg" : "—"}</td>
                  <td>{a.status === "mort" ? ecPastille("Mort", "alerte") : animalVendu(a) ? ecPastille("Vendu", "ok") : ecPastille("Présent", "attente")}</td>
                  <td className="text-right whitespace-nowrap">{canEdit && a.status !== "mort" && !animalVendu(a) && <button onClick={() => marquerMort(a)} className="text-xs underline" data-testid="ag-an-mort">Mort</button>}{canEdit && a.status === "mort" && <button onClick={() => retablirAnimal(a)} className="text-xs underline">Rétablir</button>}</td></tr>); })}</tbody></table>
              {animauxDe(b0).length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun animal enregistré.</div>}</div></>)}
          {b0.mode === "lot" && (<><div className="display text-base mb-1" style={{ color: "#152238" }}>Mouvements d'effectif</div>
            <div className="ec-wrap mb-3"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Mouvement</th><th className="text-right">Nombre</th><th>Remarque</th><th></th></tr></thead>
              <tbody>{mouvs.filter((m) => m.bandeId === b0.id).map((m) => (<tr key={m.id} data-testid="ag-mo-ligne" style={{ opacity: m.status === "annulé" ? 0.5 : 1 }}><td className="py-1.5">{ecDateFr(m.date)}</td><td>{(AG_MOUV.find((x) => x[0] === m.kind) || [0, m.kind])[1]}</td><td className="text-right tabular">{m.qty}</td><td className="text-xs">{m.note}</td><td className="text-right">{canEdit && m.status !== "annulé" ? <button onClick={() => annulerMouv(m, b0)} className="text-xs underline" data-testid="ag-mo-annuler">Annuler</button> : m.status === "annulé" ? "annulé" : ""}</td></tr>))}</tbody></table>
              {mouvs.filter((m) => m.bandeId === b0.id).length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun mouvement enregistré (effectif de départ : {b0.count0}).</div>}</div></>)}
          <div className="display text-base mb-1" style={{ color: "#152238" }}>Soins, vaccins et pesées</div>
          <div className="ec-wrap mb-3"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Type</th><th>Détail</th><th>Concerne</th><th>Prochain rappel</th><th></th></tr></thead>
            <tbody>{soins.filter((s) => s.bandeId === b0.id).sort((a, b) => (a.date < b.date ? 1 : -1)).map((s) => (<tr key={s.id} data-testid="ag-so-ligne" style={{ opacity: s.status === "annulé" ? 0.5 : 1 }}><td className="py-1.5">{ecDateFr(s.date)}</td><td>{(AG_SOINS.find((x) => x[0] === s.kind) || [0, s.kind])[1]}</td><td className="text-xs">{s.kind === "pesee" ? s.weight + " kg" : s.label}</td><td className="text-xs">{s.animalId ? ((animaux.find((a) => a.id === s.animalId) || {}).tag || "animal") : "Toute la bande"}</td><td className="text-xs">{s.next ? ecDateFr(s.next) + (s.nextDone ? " (fait)" : "") : "—"}</td>
              <td className="text-right whitespace-nowrap">{canEdit && s.next && !s.nextDone && s.status !== "annulé" && <button onClick={() => maj(s.id, (r) => ({ ...r, nextDone: true }))} className="text-xs underline mr-2" data-testid="ag-so-fait">Fait</button>}{canEdit && s.status !== "annulé" && <button onClick={() => maj(s.id, (r) => ({ ...r, status: "annulé" }))} className="text-xs underline">Annuler</button>}</td></tr>))}</tbody></table>
            {soins.filter((s) => s.bandeId === b0.id).length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun soin enregistré.</div>}</div>
          <div className="display text-base mb-1" style={{ color: "#152238" }}>Intrants utilisés</div>
          <div className="ec-wrap mb-3"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Intrant</th><th className="text-right">Quantité</th><th className="text-right">Coût</th><th></th></tr></thead>
            <tbody>{usages.filter((u) => u.bandeId === b0.id).map((u) => (<tr key={u.id} data-testid="ag-bu-ligne" style={{ opacity: u.status === "annulé" ? 0.5 : 1 }}><td className="py-1.5">{ecDateFr(u.date)}</td><td>{nomMat(u.matId)}</td><td className="text-right tabular">{u.qty} {unitMat(u.matId)}</td><td className="text-right tabular">{fmt(u.cost)}</td><td className="text-right">{canEdit && u.status !== "annulé" ? <button onClick={() => annulerUsage(u)} className="text-xs underline" data-testid="ag-bu-annuler">Annuler</button> : u.status === "annulé" ? "annulé" : ""}</td></tr>))}</tbody></table>
            {usages.filter((u) => u.bandeId === b0.id).length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun intrant utilisé.</div>}</div>
          {b0.productId && (<><div className="display text-base mb-1" style={{ color: "#152238" }}>Production</div>
            <div className="ec-wrap mb-3"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th className="text-right">Quantité</th><th></th></tr></thead>
              <tbody>{recoltes.filter((r) => r.bandeId === b0.id).map((r) => (<tr key={r.id} data-testid="ag-pr-ligne" style={{ opacity: r.status === "annulé" ? 0.5 : 1 }}><td className="py-1.5">{ecDateFr(r.date)}</td><td className="text-right tabular">{r.qty} {unitProd(r.productId)}</td><td className="text-right">{canEdit && r.status !== "annulé" ? <button onClick={() => annulerRecolte(r)} className="text-xs underline" data-testid="ag-pr-annuler">Annuler</button> : r.status === "annulé" ? "annulé" : ""}</td></tr>))}</tbody></table>
              {recoltes.filter((r) => r.bandeId === b0.id).length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucune production enregistrée.</div>}</div></>)}
          {canEdit && b0.status === "encours" && <button onClick={() => cloturerBande(b0)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="ag-bande-cloturer">Clôturer la bande</button>}
        </div>)}
      </div>
    );
  };

  // ───────── Tableau de bord ─────────
  const Apercu = () => {
    const fA = factsOk;
    const caMois = agR2(fA.filter((f) => f.date.startsWith(moisCourant)).reduce((s, f) => s + f.ht, 0));
    const encMois = agR2(fA.flatMap((f) => f.payments || []).filter((p) => p.status !== "annulé" && String(p.date).startsWith(moisCourant)).reduce((s, p) => s + p.amount, 0));
    const aEnc = agR2(fA.reduce((s, f) => s + agSolde(f).reste, 0));
    const lotsMois = lotsOk.filter((l) => l.date.startsWith(moisCourant));
    const coutMois = agR2(lotsMois.reduce((s, l) => s + coutLot(l).total, 0));
    const depMois = agR2(deps.filter((d) => d.status !== "annulé" && d.date.startsWith(moisCourant)).reduce((s, d) => s + d.amount, 0));
    const bas = mats.filter((m) => m.active !== false && (m.min || 0) > 0 && stockMat(m.id) <= m.min);
    const afaire = [];
    bas.forEach((m) => afaire.push({ tab: "matieres", sel: m.id, nom: m.name, txt: "Stock bas : " + stockMat(m.id) + " " + m.unit + " (seuil " + m.min + ")" }));
    cmds.filter((c) => c.status !== "livree" && c.status !== "annulee" && c.status !== "devis" && c.due && c.due < today).forEach((c) => afaire.push({ tab: "commandes", sel: c.id, nom: nomClient(c.clientId), txt: "Commande " + c.number + " : livraison prévue le " + ecDateFr(c.due) + " dépassée" }));
    cmds.filter((c) => c.status === "devis").forEach((c) => { const j = agJours(c.date, today); if (j >= 7) afaire.push({ tab: "commandes", sel: c.id, nom: nomClient(c.clientId), txt: "Devis " + c.number + " sans réponse depuis " + j + " jours : relancer ou annuler" }); });
    cmds.filter((c) => c.status === "prete").forEach((c) => afaire.push({ tab: "commandes", sel: c.id, nom: nomClient(c.clientId), txt: "Commande " + c.number + " prête : à livrer et facturer" }));
    fA.filter((f) => agSolde(f).reste > 0.004 && agJours(f.date, today) > 30).forEach((f) => afaire.push({ tab: "ventes", sel: f.id, nom: nomClient(f.clientId), txt: "Facture " + f.number + " impayée depuis " + agJours(f.date, today) + " jours : reste " + fmt(agSolde(f).reste) }));
    prods.filter((p) => p.active !== false && Number(p.price) > 0 && coutUnit(p.id) > 0 && Number(p.price) + 0.004 < coutUnit(p.id)).forEach((p) => afaire.push({ tab: "produits", sel: p.id, nom: p.name, txt: "Prix du catalogue (" + agF(p.price) + ") sous le coût de revient (" + agF(coutUnit(p.id)) + ") : redressez le prix ou vérifiez les lots." }));
    prods.forEach((p) => { const n = fA.filter((f) => agJours(f.date, today) <= 30).flatMap((f) => f.lines || []).filter((l) => l.productId === p.id && l.perte).length; if (n >= 2) afaire.push({ tab: "produits", sel: p.id, nom: p.name, txt: n + " ventes à perte en 30 jours : le prix ou le coût de production doit être redressé." }); });
    { const sc = fA.flatMap((f) => (f.lines || []).filter((l) => l.productId && coutUnit(l.productId) > 0 && l.pu + 0.004 < coutUnit(l.productId)).map((l) => ({ f, l }))).filter((x) => agJours(x.f.date, today) <= 30); if (sc.length > 0) afaire.push({ tab: "rapports", nom: "Ventes à perte", txt: sc.length + " vente(s) sous le coût de revient ces 30 derniers jours : vérifiez les prix ou le calcul du coût." }); }
    achatsOk.filter((a) => resteAchat(a) > 0.004).forEach((a) => afaire.push({ tab: "matieres", sel: a.matId, nom: a.supplier || nomMat(a.matId), txt: "Achat de " + nomMat(a.matId) + " du " + ecDateFr(a.date) + " à payer : " + fmt(resteAchat(a)) }));
    soins.filter((x) => x.status !== "annulé" && x.next && !x.nextDone && x.next <= today).forEach((x) => afaire.push({ tab: "elevage", sel: x.bandeId, nom: nomBande(x.bandeId), txt: ((AG_SOINS.find((k) => k[0] === x.kind) || [0, "Soin"])[1]) + (x.label ? " « " + x.label + " »" : "") + " à refaire depuis le " + ecDateFr(x.next) }));
    bandes.filter((b) => b.status === "encours" && b.mode === "lot" && mortalitePct(b) > 10).forEach((b) => afaire.push({ tab: "elevage", sel: b.id, nom: b.name, txt: "Mortalité de " + mortalitePct(b) + " % : cherchez la cause (eau, aliment, maladie)" }));
    camps.filter((c) => c.status === "encours" && agJours(c.start, today) > 180 && recolteCamp(c) === 0).forEach((c) => afaire.push({ tab: "cultures", sel: c.id, nom: c.name, txt: "Campagne ouverte depuis plus de 6 mois sans récolte : enregistrez la récolte ou clôturez-la" }));
    const etapes = [
      ["Produits", "Créez les produits de la ferme (maïs, œufs, régime de bananes…) avec leur unité et leur prix.", "produits", prods.length > 0],
      ["Intrants", "Enregistrez vos intrants (semences, engrais, aliment du bétail, produits vétérinaires…) avec leur unité.", "matieres", mats.length > 0],
      ["Premier achat", "Achetez des intrants : le stock et le prix moyen se calculent seuls.", "matieres", achatsOk.length > 0],
      ["Parcelle et campagne", "Cultures : créez une parcelle puis ouvrez une campagne (une saison sur une parcelle). Élevage : créez une bande ou un troupeau.", "cultures", (parcs.length > 0 && camps.length > 0) || bandes.length > 0],
      ["Première récolte", "Enregistrez les intrants utilisés puis la récolte (ou la production : œufs, lait) : le coût de revient se calcule seul.", "cultures", recoltesOk.length > 0],
      ["Première vente", "Vendez des produits ou des animaux : la facture se fait seule.", "ventes", fA.length > 0],
      ["Premier encaissement", "Encaissez la facture : la comptabilité se fait automatiquement.", "ventes", fA.some((f) => agSolde(f).paye > 0)],
    ];
    const toutFait = etapes.every((e) => e[3]);
    const cheptel = bandes.filter((b) => b.status === "encours").reduce((t, b) => t + effectif(b), 0);
    const kpis = [["Ventes du mois (HT)", fmt(caMois), "ag-kpi-ca"], ["Encaissé ce mois", fmt(encMois), "ag-kpi-enc"], ["Reste à encaisser", fmt(aEnc), "ag-kpi-aenc"], ["Campagnes en cours", String(camps.filter((c) => c.status === "encours").length), "ag-kpi-camp"], ["Animaux présents", String(cheptel), "ag-kpi-cheptel"], ["Dépenses de la ferme du mois", fmt(depMois), "ag-kpi-dep"], ["Intrants en stock bas", String(bas.length), "ag-kpi-bas"], ["Choses à faire", String(afaire.length), "ag-kpi-afaire"]];
    return (
      <div>
        {(<div className="ec-card p-4 mb-5" data-testid="ag-guide">
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Marche à suivre, en 7 étapes{toutFait ? " — toutes faites ✓" : ""}</div>
          <ol className="text-sm" style={{ color: "#152238", listStyle: "none", paddingLeft: 0 }}>{etapes.map(([t, d, tb, fait], i) => (<li key={i} data-testid="ag-etape" className="mb-1.5 flex flex-wrap gap-2 items-baseline"><span style={{ color: fait ? "#0F6B5C" : "#8A8370", fontWeight: 700 }}>{fait ? "✓" : (i + 1) + "."}</span><span><b>{t}</b> — <span style={{ color: "#5B563F" }}>{d}</span></span>{!fait && !(isVendeur && !["commandes", "ventes"].includes(tb)) && <button className="text-xs underline" data-testid="ag-etape-ouvrir" onClick={() => setTab(tb)}>Ouvrir</button>}</li>))}</ol>
        </div>)}
        {mats.length + prods.length + cmds.length === 0 && <div className="p-4 rounded text-sm mb-4" style={{ background: "#FFF6E0", color: "#152238" }} data-testid="ag-vide">Pour commencer : créez vos <b>produits</b> et vos <b>intrants</b>, achetez des intrants, ouvrez une <b>campagne</b> (ou une <b>bande</b> d'animaux), puis enregistrez votre première <b>récolte</b>.</div>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {kpis.map(([l, v, t]) => (<div key={t} className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>{l}</div><div className="display text-lg tabular" data-testid={t} style={{ color: "#152238" }}>{v}</div></div>))}
        </div>
        <div className="display text-base mb-2" style={{ color: "#152238" }}>À faire</div>
        {afaire.length === 0 ? <div className="text-sm mb-5" style={{ color: "#8A8370" }}>Rien en attente.</div> : (
          <div className="ec-wrap mb-5"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Concerné</th><th>À faire</th><th></th></tr></thead>
            <tbody>{afaire.slice(0, 15).map((x, i) => (<tr key={i} data-testid="ag-afaire-ligne"><td className="py-1.5">{x.nom}</td><td>{x.txt}</td><td className="text-right"><button className="text-xs underline" data-testid="ag-afaire-ouvrir" onClick={() => { if (isVendeur && x.tab === "matieres") return; setTab(x.tab); if (x.sel && x.tab === "commandes") setSelCmd(x.sel); if (x.sel && x.tab === "ventes") setSelFact(x.sel); if (x.sel && x.tab === "matieres") setSelMat(x.sel); if (x.sel && x.tab === "cultures") setSelCamp(x.sel); if (x.sel && x.tab === "elevage") setSelBande(x.sel); }}>Ouvrir</button></td></tr>))}</tbody></table></div>
        )}
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Produits en stock</div>
        {prods.filter((p) => stockProd(p.id) > 0).length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucun produit en stock.</div> : (
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Produit</th><th className="text-right">En stock</th><th className="text-right">Prix de vente</th></tr></thead>
            <tbody>{prods.filter((p) => stockProd(p.id) > 0).map((p) => (<tr key={p.id} data-testid="ag-stockp-ligne"><td className="py-1.5">{p.name}</td><td className="text-right tabular">{stockProd(p.id)} {p.unit}</td><td className="text-right tabular">{p.price ? agF(p.price) : "—"}</td></tr>))}</tbody></table></div>
        )}
      </div>
    );
  };

  // ───────── Rapports ─────────
  const [rp, setRp] = useState({ from: moisCourant + "-01", to: todayStr() });
  const Rapports = () => {
    const agP = (d) => d >= rp.from && d <= rp.to;
    const fP = factsOk.filter((f) => agP(f.date));
    const dP = deps.filter((d) => d.status !== "annulé" && agP(d.date));
    const lP = lotsOk.filter((l) => agP(l.date));
    const aP = achatsOk.filter((a) => agP(a.date));
    // marge par produit (période) : ventes des produits de la ferme − coût unitaire moyen des lots × quantités vendues
    const coutUnitProd = (id) => coutUnit(id);
    const parProd = prods.map((p) => { const lg = fP.flatMap((f) => f.lines).filter((l) => l.productId === p.id); const q = agQ(lg.reduce((s, l) => s + l.qty, 0)); const ca = agR2(lg.reduce((s, l) => s + l.qty * l.pu, 0)); const cu = coutUnitProd(p.id); const cout = agR2(q * cu); return { p, q, ca, cu, cout, marge: agR2(ca - cout), pct: ca > 0 ? Math.round((ca - cout) * 100 / ca) : 0 }; }).filter((x) => x.q > 0 || lotsOk.some((l) => l.productId === x.p.id));
    const sousCout = fP.flatMap((f) => (f.lines || []).filter((l) => l.productId || l.bandeId).map((l) => ({ f, l, cu: l.productId ? coutUnit(l.productId) : coutTete(bandes.find((b) => b.id === l.bandeId) || {}) }))).filter((x) => x.cu > 0 && x.l.pu + 0.004 < x.cu);
    // marge par commande (précommandes et ventes courantes)
    const parCmd = cmds.filter((c) => c.factId).map((c) => { const f = facts.find((x) => x.id === c.factId); return { c, f, cout: agR2(lotsOk.filter((l) => l.orderId === c.id).reduce((s, l) => s + coutLot(l).total, 0)) }; }).filter((x) => x.f && x.f.status !== "annulee" && agP(x.f.date)).map((x) => ({ ...x, marge: agR2(x.f.ht - x.cout) }));
    const imp = clients.map((c) => { const fs = factsOk.filter((f) => f.clientId === c.id && agSolde(f).reste > 0.004); const b = [0, 0, 0, 0]; fs.forEach((f) => { const j = agJours(f.date, today); const r = agSolde(f).reste; b[j <= 30 ? 0 : j <= 60 ? 1 : j <= 90 ? 2 : 3] += r; }); return { c, n: fs.length, b: b.map(agR2), tot: agR2(b.reduce((s, x) => s + x, 0)) }; }).filter((x) => x.tot > 0);
    const S = (a, f) => agR2(a.reduce((s, x) => s + f(x), 0));
    const exporterMarge = () => ecTelecharger("marge-par-produit-" + today + ".csv", [["Produit", "Quantité vendue", "Ventes HT", "Coût unitaire moyen", "Coût des ventes", "Marge", "Marge %"], ...parProd.map((x) => [x.p.name, x.q, x.ca, x.cu, x.cout, x.marge, x.pct]), ["Total", "", S(parProd, (x) => x.ca), "", S(parProd, (x) => x.cout), S(parProd, (x) => x.marge), ""]]);
    const exporterStock = () => ecTelecharger("stock-" + today + ".csv", [["Type", "Nom", "Unité", "En stock", "Prix moyen d'achat", "Valeur"], ...mats.map((m) => ["Intrant", m.name, m.unit, stockMat(m.id), prixMoyen(m.id), agR2(stockMat(m.id) * prixMoyen(m.id))]), ...prods.map((p) => ["Produit fini", p.name, p.unit, stockProd(p.id), coutUnitProd(p.id), agR2(stockProd(p.id) * coutUnitProd(p.id))])]);
    const exporterImp = () => ecTelecharger("impayes-clients-" + today + ".csv", [["Client", "Factures", "0-30 j", "31-60 j", "61-90 j", "Plus de 90 j", "Reste dû"], ...imp.map((x) => [x.c.name, x.n, ...x.b, x.tot])]);
    return (
      <div>
        <div className="flex flex-wrap gap-2 items-end mb-4">
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Du</label><input type="date" value={rp.from} onChange={(e) => setRp({ ...rp, from: e.target.value })} data-testid="ag-rap-du" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Au</label><input type="date" value={rp.to} onChange={(e) => setRp({ ...rp, to: e.target.value })} data-testid="ag-rap-au" className={ecInput} style={ecBorder} /></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[["Ventes HT", fmt(S(fP, (f) => f.ht)), "ag-rap-ventes"], ["Coût des transformations", fmt(S(lP, (l) => coutLot(l).total)), "ag-rap-fab"], ["Achats d'intrants", fmt(S(aP, (a) => a.amount)), "ag-rap-achats"], ["Dépenses de la ferme", fmt(S(dP, (d) => d.amount)), "ag-rap-dep"]].map(([l, v, t]) => (<div key={t} className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>{l}</div><div className="display text-lg tabular" data-testid={t} style={{ color: "#152238" }}>{v}</div></div>))}
        </div>
        <div className="flex flex-wrap items-center gap-3 mb-2"><div className="display text-base" style={{ color: "#152238" }}>Marge par produit (coût de revient moyen : récoltes, élevage et transformations)</div><button onClick={exporterMarge} className="text-xs underline" data-testid="ag-rap-exp-marge">Exporter (CSV)</button></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Produit</th><th className="text-right">Quantité vendue</th><th className="text-right">Ventes HT</th><th className="text-right">Coût unitaire moyen</th><th className="text-right">Coût des ventes</th><th className="text-right">Marge</th><th className="text-right">Marge %</th></tr></thead>
          <tbody>{parProd.map((x) => (<tr key={x.p.id} data-testid="ag-rap-prod-ligne"><td className="py-1.5">{x.p.name}</td><td className="text-right tabular">{x.q}</td><td className="text-right tabular">{fmt(x.ca)}</td><td className="text-right tabular">{agF(x.cu)}</td><td className="text-right tabular">{fmt(x.cout)}</td><td className="text-right tabular" style={{ color: x.marge < 0 ? "#A6432F" : undefined }}>{fmt(x.marge)}</td><td className="text-right tabular">{x.ca > 0 ? x.pct + " %" : "—"}</td></tr>))}</tbody>
          {parProd.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="ag-rap-prod-total"><td colSpan={2}>Total</td><td className="text-right tabular" data-testid="ag-rap-prod-tot-ca">{fmt(S(parProd, (x) => x.ca))}</td><td></td><td className="text-right tabular">{fmt(S(parProd, (x) => x.cout))}</td><td className="text-right tabular" data-testid="ag-rap-prod-tot-marge">{fmt(S(parProd, (x) => x.marge))}</td><td></td></tr></tfoot>}</table></div>
        {parProd.length === 0 && <div className="text-sm mb-4" style={{ color: "#8A8370" }}>Aucune vente de produit de la ferme sur la période.</div>}
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Ventes sous le coût de revient</div>
        {sousCout.length === 0 ? <div className="text-sm mb-4" style={{ color: "#8A8370" }} data-testid="ag-rap-perte-aucune">Aucune vente sous le coût de revient sur la période.</div> : (
          <div className="ec-wrap mb-4"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Facture</th><th>Date</th><th>Produit</th><th className="text-right">Quantité</th><th className="text-right">Prix vendu</th><th className="text-right">Coût moyen</th><th className="text-right">Perte</th><th>Raison</th></tr></thead>
            <tbody>{sousCout.map((x, i) => (<tr key={i} data-testid="ag-rap-perte-ligne"><td className="py-1.5 tabular text-xs">{x.f.number}</td><td>{ecDateFr(x.f.date)}</td><td>{x.l.label}</td><td className="text-right tabular">{x.l.qty}</td><td className="text-right tabular">{agF(x.l.pu)}</td><td className="text-right tabular">{agF(x.cu)}</td><td className="text-right tabular" style={{ color: "#A6432F" }}>{fmt(agR2((x.cu - x.l.pu) * x.l.qty))}</td><td className="text-xs" data-testid="ag-rap-perte-motif">{x.l.perte ? (agMotifLibelle(x.l.motif, x.l.motifTxt) || "non justifiée") : "non justifiée"}</td></tr>))}</tbody>
            <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }}><td colSpan={6}>Perte totale</td><td className="text-right tabular" data-testid="ag-rap-perte-total">{fmt(S(sousCout, (x) => (x.cu - x.l.pu) * x.l.qty))}</td><td></td></tr></tfoot></table></div>)}
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Marge par commande (transformations rattachées à la commande)</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Commande</th><th>Client</th><th className="text-right">Facturé HT</th><th className="text-right">Coût des transformations</th><th className="text-right">Marge</th></tr></thead>
          <tbody>{parCmd.map((x) => (<tr key={x.c.id} data-testid="ag-rap-cmd-ligne"><td className="py-1.5 tabular text-xs">{x.c.number}</td><td>{nomClient(x.c.clientId)}</td><td className="text-right tabular">{fmt(x.f.ht)}</td><td className="text-right tabular">{fmt(x.cout)}</td><td className="text-right tabular" style={{ color: x.marge < 0 ? "#A6432F" : undefined }}>{fmt(x.marge)}</td></tr>))}</tbody></table></div>
        {parCmd.length === 0 && <div className="text-sm mb-4" style={{ color: "#8A8370" }}>Aucune commande facturée sur la période.</div>}
        <div className="flex flex-wrap items-center gap-3 mb-2"><div className="display text-base" style={{ color: "#152238" }}>Factures impayées par ancienneté</div><button onClick={exporterImp} className="text-xs underline" data-testid="ag-rap-exp-imp">Exporter (CSV)</button></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Client</th><th className="text-right">Factures</th><th className="text-right">0 à 30 j</th><th className="text-right">31 à 60 j</th><th className="text-right">61 à 90 j</th><th className="text-right">Plus de 90 j</th><th className="text-right">Reste dû</th></tr></thead>
          <tbody>{imp.map((x) => (<tr key={x.c.id} data-testid="ag-rap-imp-ligne"><td className="py-1.5">{x.c.name}</td><td className="text-right tabular">{x.n}</td>{x.b.map((v, i) => <td key={i} className="text-right tabular">{fmt(v)}</td>)}<td className="text-right tabular">{fmt(x.tot)}</td></tr>))}</tbody>
          {imp.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }}><td colSpan={6}>Total</td><td className="text-right tabular" data-testid="ag-rap-imp-tot">{fmt(S(imp, (x) => x.tot))}</td></tr></tfoot>}</table></div>
        {imp.length === 0 && <div className="text-sm mb-4" style={{ color: "#8A8370" }}>Aucune facture impayée.</div>}
        <div className="flex flex-wrap items-center gap-3 mb-2"><div className="display text-base" style={{ color: "#152238" }}>État du stock</div><button onClick={exporterStock} className="text-xs underline" data-testid="ag-rap-exp-stock">Exporter (CSV)</button></div>
        <div className="text-sm" style={{ color: "#5B563F" }}>Valeur des intrants en stock : <b className="tabular" data-testid="ag-rap-val-mat">{fmt(S(mats, (m) => stockMat(m.id) * prixMoyen(m.id)))}</b> · valeur des produits finis (au coût de revient moyen) : <b className="tabular" data-testid="ag-rap-val-prod">{fmt(S(prods, (p) => stockProd(p.id) * coutUnitProd(p.id)))}</b>. Ces valeurs sont un suivi de gestion ; l'inventaire de fin d'exercice se fait avec l'expert-comptable.</div>
        <div className="display text-base mb-2 mt-5" style={{ color: "#152238" }}>Rentabilité des campagnes</div>
        <div className="ec-wrap mb-4"><table className="ec-table" data-testid="ag-rap-camp"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Campagne</th><th>Produit</th><th className="text-right">Coût total</th><th className="text-right">Récolté</th><th className="text-right">Coût par unité</th><th className="text-right">Prix du catalogue</th><th className="text-right">Marge par unité</th></tr></thead>
          <tbody>{camps.filter((c) => c.status !== "annulee").map((c) => { const k = coutCamp(c).total, q = recolteCamp(c), p = prods.find((x) => x.id === c.productId), cu = q > 0 ? agR2(k / q) : 0; return (<tr key={c.id} data-testid="ag-rap-camp-ligne"><td className="py-1.5">{c.name}</td><td>{nomProd(c.productId)}</td><td className="text-right tabular">{fmt(k)}</td><td className="text-right tabular">{q} {unitProd(c.productId)}</td><td className="text-right tabular">{q > 0 ? agF(cu) : "—"}</td><td className="text-right tabular">{p && p.price ? agF(p.price) : "—"}</td><td className="text-right tabular" style={{ color: q > 0 && p && p.price && Number(p.price) < cu ? "#A6432F" : undefined }}>{q > 0 && p && p.price ? agF(agR2(Number(p.price) - cu)) : "—"}</td></tr>); })}</tbody></table>
          {camps.filter((c) => c.status !== "annulee").length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucune campagne.</div>}</div>
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Élevage : effectifs et coût par tête</div>
        <div className="ec-wrap mb-4"><table className="ec-table" data-testid="ag-rap-elevage"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Bande</th><th>Espèce</th><th className="text-right">Effectif</th><th className="text-right">Mortalité</th><th className="text-right">Coût total</th><th className="text-right">Coût par tête</th><th className="text-right">Production</th></tr></thead>
          <tbody>{bandes.map((b) => (<tr key={b.id} data-testid="ag-rap-elevage-ligne"><td className="py-1.5">{b.name}</td><td>{especeLib(b.species)}</td><td className="text-right tabular">{effectif(b)}</td><td className="text-right tabular">{b.mode === "lot" ? mortalitePct(b) + " %" : "—"}</td><td className="text-right tabular">{fmt(coutBande(b, true).total)}</td><td className="text-right tabular">{coutTete(b) > 0 ? agF(coutTete(b)) : "—"}</td><td className="text-right tabular">{b.productId ? prodBande(b) + " " + unitProd(b.productId) : "—"}</td></tr>))}</tbody></table>
          {bandes.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucune bande.</div>}</div>
      </div>
    );
  };

  // ───────── Statistiques ─────────
  const Stats = () => {
    const depA = deps.filter((x) => x.status !== "annulé");
    const caT = agR2(factsOk.reduce((s, x) => s + x.ht, 0));
    const encT = agR2(factsOk.reduce((s, x) => s + agSolde(x).paye, 0));
    const coutT = agR2(lotsOk.reduce((s, l) => s + coutLot(l).total, 0));
    const depT = agR2(depA.reduce((s, x) => s + x.amount, 0));
    const mois = statMois(6, today);
    const data = mois.map((m) => ({ mois: m.label, ca: statSomme(factsOk, "date", m.key, (x) => x.ht), cout: statSomme(lotsOk, "date", m.key, (x) => coutLot(x).total), dep: statSomme(depA, "date", m.key, (x) => x.amount) }));
    const parProd = {}; factsOk.forEach((f) => f.lines.forEach((l) => { const k = l.productId ? nomProd(l.productId) : "Autres ventes"; parProd[k] = agR2((parProd[k] || 0) + l.qty * l.pu); }));
    const parCli = {}; factsOk.forEach((f) => { const k = nomClient(f.clientId); parCli[k] = agR2((parCli[k] || 0) + f.ht); });
    const parNat = {}; depA.forEach((x) => { const k = (AG_DEPENSES.find((d) => d[0] === x.kind) || [0, x.kind])[1]; parNat[k] = agR2((parNat[k] || 0) + x.amount); });
    const parMat = {}; achatsOk.forEach((a) => { const k = nomMat(a.matId); parMat[k] = agR2((parMat[k] || 0) + a.amount); });
    const parEtat = {}; cmds.filter((c) => c.status !== "annulee").forEach((c) => { const k = etatCmd(c); parEtat[k] = (parEtat[k] || 0) + 1; });
    return <StatsBloc
      vide={facts.length + lots.length + achats.length === 0 ? "Aucune activité pour le moment : les statistiques apparaîtront avec vos premiers achats, transformations et ventes." : ""}
      kpis={[["Ventes (hors taxe)", fmt(caT), "ag-stat-ca"], ["Encaissé", fmt(encT), "ag-stat-enc"], ["Coût des transformations", fmt(coutT), "ag-stat-cout"], ["Dépenses de la ferme", fmt(depT), "ag-stat-dep"]]}
      evolution={{ titre: "Ventes, coût des transformations et dépenses — 6 derniers mois", data, series: [{ key: "ca", name: "Ventes", color: "#0F6B5C" }, { key: "cout", name: "Coût des transformations", color: "#2B4C8C" }, { key: "dep", name: "Dépenses de la ferme", color: "#9A7B1E" }] }}
      repartitions={[{ titre: "Coût par campagne", data: camps.filter((c) => c.status !== "annulee" && coutCamp(c).total > 0).map((c) => ({ name: c.name, value: coutCamp(c).total })) }, { titre: "Ventes par produit", data: Object.keys(parProd).map((k) => ({ name: k, value: parProd[k] })) }, { titre: "Ventes par client", data: Object.keys(parCli).map((k) => ({ name: k, value: parCli[k] })) }, { titre: "Achats par intrant", data: Object.keys(parMat).map((k) => ({ name: k, value: parMat[k] })) }, { titre: "Dépenses par nature", data: Object.keys(parNat).map((k) => ({ name: k, value: parNat[k] })) }, { titre: "Commandes par état", unite: "nombre", data: Object.keys(parEtat).map((k) => ({ name: k, value: parEtat[k] })) }]} />;
  };

  // ───────── Documents imprimables ─────────
  const entete = (titre) => (
    <div style={{ textAlign: "center", marginBottom: 12 }}>
      {settings.companyLogo && <img src={settings.companyLogo} alt="" style={{ width: 60, height: 60, objectFit: "contain", margin: "0 auto 6px", display: "block" }} />}
      <div style={{ fontWeight: 700, fontSize: 20 }}>{settings.companyName || "Ferme"}</div>
      {settings.companyAddress && <div style={{ fontSize: 12 }}>{settings.companyAddress}</div>}
      {settings.companyPhone && <div style={{ fontSize: 12 }}>{settings.companyPhone}</div>}
      {settings.companyNIF && <div style={{ fontSize: 12 }}>NIF : {settings.companyNIF}</div>}
      <div style={{ fontWeight: 700, fontSize: 18, marginTop: 10 }}>{titre}</div>
    </div>
  );
  const cellule = { padding: "4px 6px", border: "1px solid #bbb" };
  const cadre = { color: "#152238", background: "#fff", fontFamily: "'Inter', sans-serif", fontSize: 12, width: "100%", maxWidth: 794, margin: "0 auto", padding: (typeof window !== "undefined" && window.innerWidth < 640) ? "16px 10px" : "32px 36px", boxSizing: "border-box" };
  const tableLignes = (lines) => (
    <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}><thead><tr style={{ background: "#F4F1E6" }}><th style={{ ...cellule, textAlign: "left" }}>Désignation</th><th style={cellule}>Unité</th><th style={{ ...cellule, textAlign: "right" }}>Quantité</th><th style={{ ...cellule, textAlign: "right" }}>Prix unitaire</th><th style={{ ...cellule, textAlign: "right" }}>Montant</th></tr></thead>
      <tbody>{lines.map((l) => (<tr key={l.id}><td style={cellule}>{l.label}</td><td style={{ ...cellule, textAlign: "center" }}>{l.unit}</td><td style={{ ...cellule, textAlign: "right" }}>{l.qty}</td><td style={{ ...cellule, textAlign: "right" }}>{agF(l.pu)}</td><td style={{ ...cellule, textAlign: "right" }}>{fmt(agR2(l.qty * l.pu))}</td></tr>))}</tbody></table></div>
  );
  const DevisSheet = ({ c }) => {
    const ht = cmdHt(c);
    return (
      <div style={cadre} data-testid="ag-devis-feuille">
        {entete("DEVIS" + (c.kind === "mesure" ? " — PRÉCOMMANDE" : ""))}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span>Commande <b>{c.number}</b></span><span>Établi le {ecDateFr(c.date)}</span></div>
        <div style={{ marginBottom: 4 }}>Client : <b>{nomClient(c.clientId)}</b></div>
        {c.subject && <div style={{ marginBottom: 4 }}>Objet : <b>{c.subject}</b></div>}
        {c.due && <div style={{ marginBottom: 10 }}>Livraison souhaitée : {ecDateFr(c.due)}</div>}
        {tableLignes(c.lines)}
        <div style={{ textAlign: "right", fontWeight: 700, fontSize: 15 }}>Total hors taxe : {fmt(ht)}</div>
        {tcaRate > 0 && <div style={{ textAlign: "right" }}>Taxe ({tcaRate} %) : {fmt(agR2(ht * tcaRate / 100))} · Total toutes taxes : {fmt(agR2(ht * (1 + tcaRate / 100)))}</div>}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 24, marginTop: 40 }}>
          <div style={{ flex: 1, borderTop: "1px solid #152238", paddingTop: 4, textAlign: "center" }}>Pour la ferme</div>
          <div style={{ flex: 1, borderTop: "1px solid #152238", paddingTop: 4, textAlign: "center" }}>Bon pour accord du client (date et signature)</div>
        </div>
      </div>
    );
  };
  const FactureSheet = ({ f }) => {
    const s = agSolde(f);
    const ligne = (a, b, bold) => <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontWeight: bold ? 700 : 400, fontSize: bold ? 15 : 12 }}><span>{a}</span><span className="tabular">{b}</span></div>;
    return (
      <div style={tk ? { ...cadre, maxWidth: 320, padding: "10px 8px", fontSize: 11 } : cadre} data-testid="ag-facture-feuille">
        {entete("FACTURE" + (f.status === "annulee" ? " — ANNULÉE" : ""))}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span>N° <b>{f.number}</b></span><span>{ecDateFr(f.date)}</span></div>
        <div style={{ marginBottom: 10 }}>Client : <b>{nomClient(f.clientId)}</b></div>
        {tk ? (<div style={{ marginBottom: 8 }}>{f.lines.map((l) => (<div key={l.id} style={{ padding: "2px 0", borderBottom: "1px dotted #999" }}><div>{l.label}</div><div style={{ display: "flex", justifyContent: "space-between" }}><span>{l.qty} {l.unit} × {agF(l.pu)}</span><span>{fmt(agR2(l.qty * l.pu))}</span></div></div>))}</div>) : tableLignes(f.lines)}
        <div style={{ maxWidth: tk ? "100%" : 380, marginLeft: "auto", borderTop: "1px dashed #152238", paddingTop: 6 }}>
          {ligne("Total hors taxe", fmt(f.ht))}
          {f.tca > 0 && ligne("Taxe (" + f.tcaRate + " %)", fmt(f.tca))}
          {f.tca > 0 && ligne("Total toutes taxes", fmt(f.ttc))}
          {f.recup > 0 && ligne("Acompte déduit", "− " + fmt(f.recup))}
          {ligne("NET À PAYER", fmt(f.net), true)}
          {ligne("Déjà payé", fmt(s.paye))}
          {ligne("Reste à payer", fmt(s.reste), true)}
        </div>
        <div style={{ marginTop: 14, textAlign: "center", fontSize: 11 }}>Merci de votre confiance.</div>
      </div>
    );
  };
  const CatalogueSheet = () => (
    <div style={cadre} data-testid="ag-catalogue-feuille">
      {entete("CATALOGUE")}
      {catsAll.map(([ck, cl]) => { const liste = prods.filter((p) => catDe(p) === ck && p.active !== false); return liste.length ? (<div key={ck} style={{ marginBottom: 14, pageBreakInside: "avoid" }}><div style={{ fontWeight: 700, fontSize: 15, borderBottom: "2px solid #C9A24B", marginBottom: 6 }}>{cl}</div>
        {liste.map((p) => (<div key={p.id} style={{ display: "flex", gap: 10, padding: "5px 0", alignItems: "center" }}>{p.photo && <img src={p.photo} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6 }} />}<div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{p.name}{stockProd(p.id) <= 0 ? " (épuisé)" : ""}</div>{p.desc && <div style={{ fontSize: 11, color: "#7A7460" }}>{p.desc}</div>}</div><div style={{ fontWeight: 600 }}>{Number(p.price) > 0 ? agF(p.price) + " / " + p.unit : "sur devis"}</div></div>))}</div>) : null; })}
    </div>
  );
  const LotSheet = ({ l }) => {
    const c = coutLot(l);
    return (
      <div style={cadre} data-testid="ag-lot-feuille">
        {entete("FICHE DE TRANSFORMATION" + (l.status === "annulé" ? " — ANNULÉE" : ""))}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span>Lot <b>{l.number}</b></span><span>Fabriqué le {ecDateFr(l.date)}</span></div>
        <div style={{ marginBottom: 4 }}>Produit : <b>{nomLot(l)}</b> — quantité : <b>{l.qty}{l.productId ? " " + unitProd(l.productId) : ""}</b></div>
        {l.expire && <div style={{ marginBottom: 4 }}>À consommer avant le : <b>{ecDateFr(l.expire)}</b></div>}
        {l.orderId && <div style={{ marginBottom: 4 }}>Commande : {(cmds.find((x) => x.id === l.orderId) || {}).number}</div>}
        <div style={{ overflowX: "auto", marginTop: 8 }}><table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}><thead><tr style={{ background: "#F4F1E6" }}><th style={{ ...cellule, textAlign: "left" }}>Intrant</th><th style={{ ...cellule, textAlign: "right" }}>Quantité</th><th style={{ ...cellule, textAlign: "right" }}>Prix moyen</th><th style={{ ...cellule, textAlign: "right" }}>Coût</th></tr></thead>
          <tbody>{l.lines.map((x) => (<tr key={x.matId}><td style={cellule}>{nomMat(x.matId)}</td><td style={{ ...cellule, textAlign: "right" }}>{x.qty} {unitMat(x.matId)}</td><td style={{ ...cellule, textAlign: "right" }}>{agF(x.pu)}</td><td style={{ ...cellule, textAlign: "right" }}>{fmt(x.cost)}</td></tr>))}</tbody></table></div>
        <div style={{ maxWidth: 380, marginLeft: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Intrants</span><span>{fmt(c.m)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Main-d'œuvre ({l.hours || 0} h × {fmt(l.rate || 0)})</span><span>{fmt(c.mo)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Autres frais</span><span>{fmt(c.fr)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 15, borderTop: "1px solid #152238", marginTop: 4, paddingTop: 4 }}><span>Coût de revient</span><span>{fmt(c.total)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Coût par unité</span><span>{fmt(agR2(c.total / l.qty))}</span></div>
        </div>
        {l.notes && <div style={{ marginTop: 10 }}>Remarques : {l.notes}</div>}
      </div>
    );
  };

  const tabs = isVendeur
    ? [["apercu", "Tableau de bord"], ["catalogue", "Catalogue"], ["clients", "Clients"], ["commandes", "Commandes"], ["ventes", "Ventes"]]
    : [["apercu", "Tableau de bord"], ["matieres", "Intrants et achats"], ["produits", "Produits et prix"], ["catalogue", "Catalogue"], ["cultures", "Cultures"], ["elevage", "Élevage"], ["production", "Transformation"], ["clients", "Clients"], ["commandes", "Commandes"], ["ventes", "Ventes"], ["depenses", "Dépenses"], ["rapports", "Rapports"], ["stats", "Statistiques"]];
  const imprDoc = (() => {
    if (!imprimer) return null;
    if (imprimer.kind === "devis") { const c = cmds.find((x) => x.id === imprimer.id); return c ? { titre: "Devis " + c.number, node: <DevisSheet c={c} /> } : null; }
    if (imprimer.kind === "catalogue") return { titre: "Catalogue", node: <CatalogueSheet /> };
    if (imprimer.kind === "lot") { const l = lots.find((x) => x.id === imprimer.id); return l ? { titre: "Fiche de transformation " + l.number, node: <LotSheet l={l} /> } : null; }
    const f = facts.find((x) => x.id === imprimer.id);
    return f ? { titre: "Facture " + f.number, node: <FactureSheet f={f} />, ticket: true } : null;
  })();
  return (
    <>
      {listes}
      <div className={"p-4 md:p-8 max-w-6xl" + (imprDoc ? " no-print" : "")} data-testid="agri-module">
        <style>{EC_CSS + '[data-testid="agri-module"] .display.text-base{border-left:3px solid #C9A24B;padding-left:10px;margin-bottom:12px}[data-testid="agri-module"] input,[data-testid="agri-module"] select{background:#fff}'}</style>
        <div className="mb-4"><div className="display text-2xl" style={{ color: "#152238" }}>Agriculture et élevage</div><div className="text-xs" style={{ color: "#8A8370" }}>Parcelles et campagnes, récoltes, élevage, intrants, ventes, dépenses de la ferme et coût de revient</div></div>
        {!canFront && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }}>Consultation seule : votre rôle ne permet pas de modifier les données.</div>}
        {isVendeur && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }} data-testid="ag-accueil-note">Accueil : vous pouvez enregistrer les clients, prendre les commandes, vendre, encaisser et imprimer les factures. Intrants, cultures, élevage, transformations, dépenses, annulations et rapports sont réservés au responsable.</div>}
        <div className="ec-tabs">
          {tabs.map(([id, l]) => (<button key={id} onClick={() => setTab(id)} data-testid={"ag-tab-" + id} className="px-3 py-2 text-sm rounded-lg transition-colors" style={{ background: tab === id ? "#152238" : "transparent", color: tab === id ? "#EFE9DD" : "#6B6552", fontWeight: tab === id ? 600 : 500 }}>{l}</button>))}
        </div>
        {tab === "apercu" && Apercu()}
        {tab === "matieres" && !isVendeur && Matieres()}
        {tab === "produits" && !isVendeur && Produits()}
        {tab === "catalogue" && Catalogue()}
        {tab === "cultures" && !isVendeur && Cultures()}
        {tab === "elevage" && !isVendeur && Elevage()}
        {tab === "production" && !isVendeur && Production()}
        {tab === "clients" && Clients()}
        {tab === "commandes" && Commandes()}
        {tab === "ventes" && Ventes()}
        {tab === "depenses" && !isVendeur && Depenses()}
        {tab === "rapports" && !isVendeur && Rapports()}
        {tab === "stats" && !isVendeur && Stats()}
      </div>
      {imprDoc && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto p-3 md:p-8 no-print" style={{ background: "rgba(21,34,56,0.55)" }} onClick={() => setImprimer(null)} data-testid="ag-apercu">
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: tk && imprDoc.ticket ? 340 : 820 }}>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap"><div className="text-sm" style={{ color: "#EFE9DD" }}>{imprDoc.titre}</div>
              <div className="flex gap-2 flex-wrap">
                {imprDoc.ticket && <button onClick={() => setTk(!tk)} className="px-3 py-1.5 rounded text-sm" style={ecBtn} data-testid="ag-format">{tk ? "Passer en A4" : "Passer en ticket"}</button>}
                <button onClick={() => { try { window.print(); } catch (e) {} }} className="px-3 py-1.5 rounded text-sm" style={ecBtnGold} data-testid="ag-imprimer-ok">Imprimer / enregistrer en PDF</button>
                <button onClick={() => setImprimer(null)} className="px-3 py-1.5 rounded text-sm" style={ecBtn} data-testid="ag-apercu-fermer">Fermer</button></div></div>
            <div className="rounded shadow-lg overflow-hidden" style={{ background: "#fff" }}>{imprDoc.node}</div>
          </div>
        </div>
      )}
      {imprDoc && <div className={"print-only" + (tk && imprDoc.ticket ? " ticket-print-80" : "")}>{imprDoc.node}</div>}
    </>
  );
}

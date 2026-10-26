// ═══ MODULE ═══
// @module Restauration
// @depends EC_CSS, Menu, ecBorder, ecBtn, ecBtnGold, ecDateFr, ecInput, ecPastille, ecTelecharger
//   isFutureDate, isLocked, todayStr, uid, useBrouillon, useState
// @exports RestoModule
// ═══ FIN DE L'EN-TÊTE ═══
// Bloc Restauration : tables, menu et plats avec fiche recette (coût du plat), commandes et additions, encaissement, service et pourboires du personnel.
// (L'hôtellerie — chambres, réservations, séjours — viendra dans la version suivante.)
//
// Comptabilité (tout se passe à l'ENCAISSEMENT de l'addition ; une commande ouverte n'écrit rien) :
//  • encaissement : Débit caisse ou banque (addition + pourboire) / Crédit 7075 ventes de repas et boissons, 445 TCA si elle s'applique,
//    4677 « service et pourboires à reverser au personnel » (service + pourboire : cet argent n'appartient pas à l'entreprise) ;
//  • répartition du service : Débit 4677 / Crédit caisse ou banque, au prorata des parts (points) de chaque employé ;
//  • sortie des ingrédients de la fiche recette (stock) ; si la méthode du stock en actif est choisie : Débit 6037 / Crédit 370.
// Toutes les données sont dans une seule catégorie « resto » (types : config, table, dish, order, staff, payout).

const RS_COMPTES = {
  "530": { name: "Caisse", type: "Actif" },
  "512": { name: "Banque", type: "Actif" },
  "7075": { name: "Ventes de repas et boissons", type: "Produit" },
  "445": { name: "Taxe collectée sur ventes (IVA/TCA)", type: "Passif" },
  "4677": { name: "Service et pourboires à reverser au personnel", type: "Passif" },
  "6037": { name: "Coût des marchandises vendues", type: "Charge" },
  "370": { name: "Stock de marchandises", type: "Actif" },
};
const RS_CATS = [["entree", "Entrées"], ["plat", "Plats"], ["dessert", "Desserts"], ["boisson", "Boissons"]];
const rsR2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const rsM = (n) => rsR2(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " G"; // toujours 2 décimales : une part de service de 37,50 ne doit pas s'afficher 38
const rsId = () => String(uid());
const rsRows = (rows, type) => (rows || []).filter((r) => r && r.type === type);

function rsAjouterComptes(accounts, setAccounts, codes) {
  const missing = [...new Set(codes)].filter((k) => RS_COMPTES[k] && !accounts.some((a) => a.code === k)).map((k) => ({ code: k, name: RS_COMPTES[k].name, type: RS_COMPTES[k].type }));
  if (missing.length) setAccounts((prev) => [...prev, ...missing.filter((m) => !prev.some((a) => a.code === m.code))]);
}

function RestoModule({ resto, setResto, entries, setEntries, accounts, setAccounts, products, setProducts, movements, setMovements, settings, role, showToast, logAudit, currentUserEmail }) {
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const isVendeur = role === "Vendeur"; // serveur ou caissier : ouvre les commandes et encaisse
  const canFront = canEdit || isVendeur;
  const today = todayStr();
  const [tab, setTab] = useState("apercu");
  const tables = rsRows(resto, "table");
  const dishes = rsRows(resto, "dish");
  const orders = rsRows(resto, "order");
  const staff = rsRows(resto, "staff");
  const payouts = rsRows(resto, "payout").filter((p) => p.status !== "annulé");
  const cfg = rsRows(resto, "config")[0] || { id: "config", type: "config", serviceRate: 10, tcaOn: false };
  const serviceRate = Number(cfg.serviceRate) || 0;
  const tcaRate = cfg.tcaOn ? Number(settings.taxRate) || 0 : 0;
  const stockActif = settings.stockValuationMethod === "actif";
  const marchandises = (products || []).filter((p) => p.type === "marchandise");
  const nomTable = (id) => (tables.find((x) => x.id === id) || {}).name || "Sans table";
  const nomProduit = (id) => (marchandises.find((p) => String(p.id) === String(id)) || {}).name || "(produit supprimé)";
  const coutPlat = (d) => rsR2((d.recipe || []).reduce((s, r) => s + (Number(r.qty) || 0) * (Number((marchandises.find((p) => String(p.id) === String(r.productId)) || {}).costPrice) || 0), 0));
  const maj = (id, fn) => setResto((prev) => (prev || []).map((r) => (r.id === id ? fn(r) : r)));
  const compteMode = (m) => (m === "banque" ? "512" : "530");
  const ecrire = (date, label, lines, dossierId) => {
    const e = { id: uid(), date, createdAt: new Date().toISOString(), label, lines: lines.filter((l) => l.debit > 0 || l.credit > 0), kind: "resto", dossierId };
    setEntries((prev) => [...prev, e]);
    return e;
  };
  const verifDate = (date, action) => {
    if (!date || isFutureDate(date)) { showToast("La date ne peut pas être dans le futur."); return false; }
    if (isLocked(date, settings)) { showToast("La période comptable est clôturée jusqu'au " + settings.lockDate + " inclus : impossible de " + action + " à cette date."); return false; }
    return true;
  };
  const numeroCommande = (date) => {
    const yy = String((date || today).slice(0, 4));
    const n = orders.filter((r) => String(r.number || "").startsWith("CM-" + yy + "-")).reduce((m, r) => Math.max(m, Number(String(r.number).split("-")[2]) || 0), 0) + 1;
    return "CM-" + yy + "-" + String(n).padStart(4, "0");
  };
  const totauxCommande = (o) => {
    const sous = rsR2((o.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit) || 0), 0));
    const service = rsR2(sous * serviceRate / 100), tca = rsR2(sous * tcaRate / 100);
    return { sous, service, tca, total: rsR2(sous + service + tca) };
  };
  // service et pourboires encaissés, moins ce qui a déjà été reversé
  const poolService = () => rsR2(orders.filter((o) => o.status === "payee").reduce((s, o) => s + (Number(o.service) || 0) + (Number(o.tip) || 0), 0) - payouts.reduce((s, p) => s + (Number(p.amount) || 0), 0));

  // ───────── Réglages ─────────
  const [fr, setFr] = useState(null);
  const reglages = fr || { serviceRate: String(serviceRate), tcaOn: !!cfg.tcaOn };
  const saveCfg = () => {
    if (!canEdit) return;
    const r = Number(reglages.serviceRate);
    if (!(r >= 0 && r <= 30)) { showToast("Le service doit être entre 0 % et 30 %."); return; }
    setResto((prev) => [...(prev || []).filter((x) => x.type !== "config"), { type: "config", id: "config", serviceRate: r, tcaOn: !!reglages.tcaOn }]);
    setFr(null);
    showToast("Réglages enregistrés : service " + r + " %" + (reglages.tcaOn ? ", TCA " + (Number(settings.taxRate) || 0) + " % ajoutée aux additions." : ", sans TCA."));
    logAudit("Restauration", "Réglages modifiés", "service " + r + " %");
  };

  // ───────── Tables ─────────
  const [ft, setFt] = useBrouillon("resto-table", { name: "", seats: "4" });
  const addTable = () => {
    if (!canEdit) return;
    const name = ft.name.trim();
    if (!name) { showToast("Donnez un nom ou un numéro à la table."); return; }
    if (tables.some((t) => t.name.toLowerCase() === name.toLowerCase())) { showToast("Cette table existe déjà."); return; }
    setResto((prev) => [...(prev || []), { type: "table", id: rsId(), name, seats: Math.max(1, Math.round(Number(ft.seats) || 1)) }]);
    setFt({ name: "", seats: ft.seats });
    showToast("Table « " + name + " » ajoutée.");
  };
  const delTable = (t) => {
    if (!canEdit) return;
    if (orders.some((o) => o.tableId === t.id && o.status === "ouverte")) { showToast("Une commande est ouverte sur cette table : encaissez-la ou annulez-la d'abord."); return; }
    setResto((prev) => (prev || []).filter((r) => r.id !== t.id));
    showToast("Table supprimée (les anciennes commandes sont conservées).");
  };

  // ───────── Menu et recettes ─────────
  const [fd, setFd] = useBrouillon("resto-plat", { name: "", cat: "plat", price: "" });
  const [fri, setFri] = useState({ productId: "", qty: "" });
  const [platSel, setPlatSel] = useState("");
  const addDish = () => {
    if (!canEdit) return;
    const name = fd.name.trim(), price = Number(fd.price);
    if (!name) { showToast("Indiquez le nom du plat ou de la boisson."); return; }
    if (!(price > 0)) { showToast("Indiquez un prix supérieur à zéro."); return; }
    if (dishes.some((d) => d.name.toLowerCase() === name.toLowerCase())) { showToast("Ce plat existe déjà dans le menu."); return; }
    const id = rsId();
    setResto((prev) => [...(prev || []), { type: "dish", id, name, cat: fd.cat, price: rsR2(price), recipe: [], active: true }]);
    setFd({ name: "", cat: fd.cat, price: "" });
    setPlatSel(id);
    showToast("« " + name + " » ajouté au menu. Ajoutez sa recette pour connaître son coût.");
    logAudit("Restauration", "Plat ajouté", name + " — " + rsM(price));
  };
  const toggleDish = (d) => { if (canEdit) maj(d.id, (r) => ({ ...r, active: r.active === false })); };
  const addIngredient = (d) => {
    if (!canEdit) return;
    const qty = Number(fri.qty);
    if (!fri.productId) { showToast("Choisissez un ingrédient (produit du stock)."); return; }
    if (!(qty > 0)) { showToast("Indiquez la quantité utilisée pour UNE portion."); return; }
    maj(d.id, (r) => ({ ...r, recipe: [...(r.recipe || []).filter((x) => String(x.productId) !== String(fri.productId)), { productId: fri.productId, qty }] }));
    setFri({ productId: "", qty: "" });
  };
  const delIngredient = (d, productId) => { if (canEdit) maj(d.id, (r) => ({ ...r, recipe: (r.recipe || []).filter((x) => String(x.productId) !== String(productId)) })); };

  // ───────── Commandes ─────────
  const [nc, setNc] = useState({ tableId: "", server: "" });
  const [cmdSel, setCmdSel] = useState("");
  const [ld, setLd] = useState({ dishId: "", qty: "1" });
  const [pay, setPay] = useState({ mode: "especes", tip: "" });
  const ouvertes = orders.filter((o) => o.status === "ouverte");
  const cmd = orders.find((o) => o.id === cmdSel);
  const ouvrirCommande = () => {
    if (!canFront) return;
    if (!dishes.some((d) => d.active !== false)) { showToast("Le menu est vide : ajoutez d'abord des plats."); return; }
    const id = rsId();
    setResto((prev) => [...(prev || []), { type: "order", id, number: numeroCommande(today), date: today, tableId: nc.tableId, server: nc.server.trim() || currentUserEmail || "", lines: [], status: "ouverte", createdAt: new Date().toISOString() }]);
    setCmdSel(id);
    showToast("Commande ouverte" + (nc.tableId ? " sur la table " + nomTable(nc.tableId) : "") + ". Ajoutez les plats.");
  };
  const ajouterLigne = (o) => {
    if (!canFront || o.status !== "ouverte") return;
    const d = dishes.find((x) => x.id === ld.dishId), qty = Math.round(Number(ld.qty));
    if (!d) { showToast("Choisissez un plat."); return; }
    if (!(qty >= 1 && qty <= 99)) { showToast("La quantité doit être entre 1 et 99."); return; }
    maj(o.id, (r) => {
      const ex = (r.lines || []).find((l) => l.dishId === d.id);
      return { ...r, lines: ex ? r.lines.map((l) => (l.dishId === d.id ? { ...l, qty: l.qty + qty } : l)) : [...(r.lines || []), { dishId: d.id, label: d.name, qty, unit: d.price }] };
    });
    setLd({ dishId: ld.dishId, qty: "1" });
  };
  const retirerLigne = (o, dishId) => { if (canFront && o.status === "ouverte") maj(o.id, (r) => ({ ...r, lines: r.lines.filter((l) => l.dishId !== dishId) })); };
  const annulerOuverte = (o) => {
    if (!canFront || o.status !== "ouverte") return;
    maj(o.id, (r) => ({ ...r, status: "annulee", cancelledAt: today }));
    if (cmdSel === o.id) setCmdSel("");
    showToast("Commande " + o.number + " annulée (aucune écriture : elle n'était pas encaissée).");
  };
  const encaisser = (o) => {
    if (!canFront || o.status !== "ouverte") return;
    if (!(o.lines || []).length) { showToast("La commande est vide : ajoutez au moins un plat."); return; }
    const tip = rsR2(Number(pay.tip) || 0);
    if (tip < 0) { showToast("Le pourboire ne peut pas être négatif."); return; }
    if (!verifDate(today, "encaisser")) return;
    const t = totauxCommande(o);
    const compte = compteMode(pay.mode);
    const credits = [{ account: "7075", debit: 0, credit: t.sous }];
    if (t.tca > 0) credits.push({ account: "445", debit: 0, credit: t.tca });
    if (t.service + tip > 0) credits.push({ account: "4677", debit: 0, credit: rsR2(t.service + tip) });
    rsAjouterComptes(accounts, setAccounts, [compte, ...credits.map((c) => c.account)]);
    const e = ecrire(today, "Addition " + o.number + " — " + nomTable(o.tableId), [{ account: compte, debit: rsR2(t.total + tip), credit: 0 }, ...credits], o.id);
    // sortie des ingrédients (fiche recette) : jamais en dessous de zéro
    const besoins = {};
    o.lines.forEach((l) => { const d = dishes.find((x) => x.id === l.dishId); (d ? d.recipe || [] : []).forEach((r) => { besoins[r.productId] = (besoins[r.productId] || 0) + (Number(r.qty) || 0) * l.qty; }); });
    const sorties = [];
    let cogs = 0, manque = false;
    Object.keys(besoins).forEach((pid) => {
      const p = marchandises.find((x) => String(x.id) === String(pid));
      if (!p) return;
      const dispo = Math.max(0, Number(p.stock) || 0), q = Math.min(dispo, rsR2(besoins[pid]));
      if (q < rsR2(besoins[pid])) manque = true;
      if (q > 0) { sorties.push({ productId: p.id, name: p.name, qty: q }); cogs += rsR2(q * (Number(p.costPrice) || 0)); }
    });
    cogs = rsR2(cogs);
    let cogsEntry = null;
    if (sorties.length) {
      setProducts((prev) => prev.map((p) => { const s = sorties.find((x) => String(x.productId) === String(p.id)); return s ? { ...p, stock: rsR2((Number(p.stock) || 0) - s.qty) } : p; }));
      setMovements((prev) => [...prev, ...sorties.map((s) => ({ id: uid(), date: today, createdAt: new Date().toISOString(), productId: s.productId, productName: s.name, type: "sortie", qty: s.qty, reason: "Addition " + o.number }))]);
      if (stockActif && cogs > 0) {
        rsAjouterComptes(accounts, setAccounts, ["6037", "370"]);
        cogsEntry = ecrire(today, "Addition " + o.number + " — coût des ingrédients", [{ account: "6037", debit: cogs, credit: 0 }, { account: "370", debit: 0, credit: cogs }], o.id);
      }
    }
    maj(o.id, (r) => ({ ...r, status: "payee", paidDate: today, mode: pay.mode, subtotal: t.sous, service: t.service, tca: t.tca, tip, total: t.total, entryId: e.id, cogsEntryId: cogsEntry ? cogsEntry.id : "", cogs, stockOut: sorties.map((s) => ({ productId: s.productId, name: s.name, qty: s.qty })), paidBy: currentUserEmail || "" }));
    setPay({ mode: pay.mode, tip: "" });
    setCmdSel("");
    showToast("Addition " + o.number + " encaissée : " + rsM(rsR2(t.total + tip)) + (manque ? " — attention : le stock de certains ingrédients était insuffisant." : "."));
    logAudit("Restauration", "Addition encaissée", o.number + " — " + rsM(t.total));
  };
  const annulerPayee = (o) => {
    if (!canEdit || o.status !== "payee") return;
    if (!verifDate(today, "annuler l'addition")) return;
    if (poolService() - rsR2((Number(o.service) || 0) + (Number(o.tip) || 0)) < -0.005) { showToast("Le service de cette addition a déjà été reversé au personnel : impossible de l'annuler."); return; }
    const contre = (id, label) => { const e = (entries || []).find((x) => x.id === id); return e ? ecrire(today, label, e.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })), o.id) : null; };
    contre(o.entryId, "Annulation addition " + o.number);
    if (o.cogsEntryId) contre(o.cogsEntryId, "Annulation addition " + o.number + " — coût des ingrédients");
    if ((o.stockOut || []).length) {
      setProducts((prev) => prev.map((p) => { const s = o.stockOut.find((x) => String(x.productId) === String(p.id)); return s ? { ...p, stock: rsR2((Number(p.stock) || 0) + s.qty) } : p; }));
      setMovements((prev) => [...prev, ...o.stockOut.map((s) => ({ id: uid(), date: today, createdAt: new Date().toISOString(), productId: s.productId, productName: s.name, type: "entree", qty: s.qty, reason: "Annulation addition " + o.number }))]);
    }
    maj(o.id, (r) => ({ ...r, status: "annulee", cancelledAt: today }));
    showToast("Addition " + o.number + " annulée : écritures contrepassées, ingrédients remis en stock.");
    logAudit("Restauration", "Addition annulée", o.number);
  };

  // ───────── Service du personnel ─────────
  const [fs, setFs] = useBrouillon("resto-staff", { name: "", points: "1" });
  const [fv, setFv] = useState({ mode: "especes" });
  const addStaff = () => {
    if (!canEdit) return;
    const name = fs.name.trim(), points = Number(fs.points);
    if (!name) { showToast("Indiquez le nom de l'employé."); return; }
    if (!(points > 0)) { showToast("Les points (la part) doivent être supérieurs à zéro."); return; }
    if (staff.some((s) => s.name.toLowerCase() === name.toLowerCase())) { showToast("Cet employé existe déjà."); return; }
    setResto((prev) => [...(prev || []), { type: "staff", id: rsId(), name, points: rsR2(points), active: true }]);
    setFs({ name: "", points: fs.points });
    showToast(name + " ajouté(e) à la répartition du service.");
  };
  const delStaff = (s) => { if (canEdit) setResto((prev) => (prev || []).filter((r) => r.id !== s.id)); };
  const repartir = () => {
    if (!canEdit) return;
    const pool = poolService();
    const actifs = staff.filter((s) => s.active !== false);
    if (!(pool > 0.004)) { showToast("Il n'y a aucun service à répartir pour le moment."); return; }
    if (!actifs.length) { showToast("Ajoutez d'abord les employés qui partagent le service."); return; }
    if (!verifDate(today, "répartir le service")) return;
    const totalPts = actifs.reduce((s, x) => s + x.points, 0);
    let reste = pool;
    const lines = actifs.map((s, i) => { const a = i === actifs.length - 1 ? rsR2(reste) : rsR2(pool * s.points / totalPts); reste = rsR2(reste - a); return { staffId: s.id, name: s.name, amount: a }; });
    const compte = compteMode(fv.mode);
    rsAjouterComptes(accounts, setAccounts, [compte, "4677"]);
    const id = rsId();
    const e = ecrire(today, "Répartition du service et des pourboires au personnel", [{ account: "4677", debit: pool, credit: 0 }, { account: compte, debit: 0, credit: pool }], id);
    setResto((prev) => [...(prev || []), { type: "payout", id, date: today, mode: fv.mode, lines, amount: pool, entryId: e.id, status: "valide", by: currentUserEmail || "" }]);
    showToast(rsM(pool) + " réparti entre " + actifs.length + " employé(s).");
    logAudit("Restauration", "Service réparti", rsM(pool));
  };

  // ───────── Écrans ─────────
  const lab = (t) => <label className="text-xs" style={{ color: "#8A8370" }}>{t}</label>;
  const Apercu = () => {
    const payees = orders.filter((o) => o.status === "payee");
    const jour = payees.filter((o) => o.paidDate === today);
    const caJour = rsR2(jour.reduce((s, o) => s + o.subtotal, 0));
    const caMois = rsR2(payees.filter((o) => String(o.paidDate).startsWith(today.slice(0, 7))).reduce((s, o) => s + o.subtotal, 0));
    const kpis = [["Ventes du jour", rsM(caJour), "resto-kpi-jour"], ["Additions du jour", String(jour.length), "resto-kpi-nb"], ["Ventes du mois", rsM(caMois), "resto-kpi-mois"], ["Commandes ouvertes", String(ouvertes.length), "resto-kpi-ouvertes"], ["Service à répartir", rsM(poolService()), "resto-kpi-service"]];
    return (
      <div>
        {tables.length + dishes.length === 0 && <div className="p-4 rounded text-sm mb-4" style={{ background: "#FFF6E0", color: "#152238" }} data-testid="resto-vide">Pour commencer : créez vos <b>tables</b>, remplissez le <b>menu</b> (plats, boissons, prix, recettes), ajoutez les <b>employés</b> qui partagent le service, puis ouvrez une <b>commande</b>.</div>}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          {kpis.map(([l, v, t]) => (<div key={t} className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>{l}</div><div className="display text-lg tabular" data-testid={t} style={{ color: "#152238" }}>{v}</div></div>))}
        </div>
        {canEdit && (<div className="ec-card p-4 mb-5" data-testid="resto-reglages">
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Réglages des additions</div>
          <div className="grid md:grid-cols-3 gap-2 items-end">
            <div>{lab("Service ajouté à l'addition (%)")}<input type="number" min="0" max="30" value={reglages.serviceRate} onChange={(e) => setFr({ ...reglages, serviceRate: e.target.value })} data-testid="resto-service-taux" className={ecInput + " tabular"} style={ecBorder} /></div>
            <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" checked={!!reglages.tcaOn} onChange={(e) => setFr({ ...reglages, tcaOn: e.target.checked })} data-testid="resto-tca" />Ajouter la TCA ({Number(settings.taxRate) || 0} %) aux additions</label>
            <div><button onClick={saveCfg} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="resto-reglages-enregistrer">Enregistrer</button></div>
          </div>
          <div className="text-xs mt-2" style={{ color: "#7A7460" }}>Le service et les pourboires ne sont pas un revenu de l'entreprise : ils sont gardés en compte 4677 puis reversés au personnel (onglet « Service »). Taux et TCA à confirmer avec votre expert-comptable.</div>
        </div>)}
        {ouvertes.length > 0 && (<div className="ec-card p-4"><div className="display text-base mb-2" style={{ color: "#152238" }}>Commandes ouvertes</div>
          {ouvertes.map((o) => (<div key={o.id} className="flex items-center justify-between text-sm py-1" data-testid="resto-ouverte-ligne"><span>{o.number} — {nomTable(o.tableId)} — {rsM(totauxCommande(o).total)}</span><button onClick={() => { setCmdSel(o.id); setTab("commandes"); }} className="text-xs underline">Ouvrir</button></div>))}</div>)}
      </div>
    );
  };
  const Tables = () => (
    <div>
      {canEdit && (<div className="ec-card p-4 mb-5"><div className="grid md:grid-cols-3 gap-2 items-end">
        <div>{lab("Nom ou numéro de la table")}<input value={ft.name} onChange={(e) => setFt({ ...ft, name: e.target.value })} data-testid="resto-table-nom" className={ecInput} style={ecBorder} /></div>
        <div>{lab("Places")}<input type="number" min="1" value={ft.seats} onChange={(e) => setFt({ ...ft, seats: e.target.value })} data-testid="resto-table-places" className={ecInput + " tabular"} style={ecBorder} /></div>
        <div><button onClick={addTable} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="resto-table-ajouter">Ajouter la table</button></div>
      </div></div>)}
      <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Table</th><th className="text-right">Places</th><th>État</th><th></th></tr></thead>
        <tbody>{tables.map((t) => { const occ = ouvertes.find((o) => o.tableId === t.id); return (<tr key={t.id} data-testid="resto-table-ligne"><td className="py-1.5">{t.name}</td><td className="text-right tabular">{t.seats}</td><td>{occ ? ecPastille("Occupée — " + occ.number, "attente") : ecPastille("Libre", "ok")}</td><td className="text-right">{canEdit && <button onClick={() => delTable(t)} className="text-xs" style={{ color: "#A6432F" }}>Supprimer</button>}</td></tr>); })}</tbody></table></div>
      {tables.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucune table : vous pouvez aussi ouvrir des commandes « sans table » (vente au comptoir ou à emporter).</div>}
    </div>
  );
  const MenuPlats = () => {
    const d = dishes.find((x) => x.id === platSel);
    return (
      <div>
        {canEdit && (<div className="ec-card p-4 mb-5"><div className="grid md:grid-cols-4 gap-2 items-end">
          <div className="md:col-span-2">{lab("Nom du plat ou de la boisson")}<input value={fd.name} onChange={(e) => setFd({ ...fd, name: e.target.value })} data-testid="resto-plat-nom" className={ecInput} style={ecBorder} /></div>
          <div>{lab("Catégorie")}<select value={fd.cat} onChange={(e) => setFd({ ...fd, cat: e.target.value })} data-testid="resto-plat-cat" className={ecInput} style={ecBorder}>{RS_CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div>{lab("Prix de vente")}<input type="number" min="0" step="0.01" value={fd.price} onChange={(e) => setFd({ ...fd, price: e.target.value })} data-testid="resto-plat-prix" className={ecInput + " tabular"} style={ecBorder} /></div>
        </div><button onClick={addDish} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="resto-plat-ajouter">Ajouter au menu</button></div>)}
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Plat</th><th>Catégorie</th><th className="text-right">Prix</th><th className="text-right">Coût</th><th className="text-right">Marge</th><th></th></tr></thead>
          <tbody>{dishes.map((x) => { const c = coutPlat(x); const m = x.price > 0 && c > 0 ? Math.round((1 - c / x.price) * 100) : null; return (
            <tr key={x.id} data-testid="resto-plat-ligne" style={{ opacity: x.active === false ? 0.5 : 1 }}><td className="py-1.5">{x.name}</td><td className="text-xs">{(RS_CATS.find((k) => k[0] === x.cat) || [0, x.cat])[1]}</td><td className="text-right tabular">{rsM(x.price)}</td><td className="text-right tabular">{(x.recipe || []).length ? rsM(c) : "—"}</td><td className="text-right tabular">{m === null ? "—" : m + " %"}</td>
              <td className="text-right whitespace-nowrap"><button onClick={() => setPlatSel(platSel === x.id ? "" : x.id)} className="text-xs underline mr-2" data-testid="resto-plat-recette">Recette</button>{canEdit && <button onClick={() => toggleDish(x)} className="text-xs underline">{x.active === false ? "Remettre" : "Retirer du menu"}</button>}</td></tr>); })}</tbody></table></div>
        {dishes.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Le menu est vide.</div>}
        {d && (<div className="ec-card p-4 mt-4" data-testid="resto-recette"><div className="display text-base mb-2" style={{ color: "#152238" }}>Recette de « {d.name} » — pour une portion</div>
          <div className="text-xs mb-2" style={{ color: "#7A7460" }}>Les ingrédients sont des produits de votre stock. À chaque addition encaissée, ils sortent du stock et le coût du plat est calculé avec leur prix de revient.</div>
          {(d.recipe || []).map((r) => (<div key={r.productId} className="flex items-center justify-between text-sm py-1" data-testid="resto-ingredient-ligne"><span>{nomProduit(r.productId)} — {r.qty}</span>{canEdit && <button onClick={() => delIngredient(d, r.productId)} className="text-xs" style={{ color: "#A6432F" }}>Retirer</button>}</div>))}
          {(d.recipe || []).length === 0 && <div className="text-sm mb-2" style={{ color: "#8A8370" }}>Aucun ingrédient : le coût du plat est inconnu.</div>}
          {canEdit && (<div className="grid md:grid-cols-3 gap-2 items-end mt-2">
            <div>{lab("Ingrédient")}<select value={fri.productId} onChange={(e) => setFri({ ...fri, productId: e.target.value })} data-testid="resto-ingredient-produit" className={ecInput} style={ecBorder}><option value="">—</option>{marchandises.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div>{lab("Quantité par portion")}<input type="number" min="0" step="0.01" value={fri.qty} onChange={(e) => setFri({ ...fri, qty: e.target.value })} data-testid="resto-ingredient-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><button onClick={() => addIngredient(d)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="resto-ingredient-ajouter">Ajouter l'ingrédient</button></div>
          </div>)}
          {marchandises.length === 0 && <div className="text-xs mt-2" style={{ color: "#A6432F" }}>Aucun produit « marchandise » dans le stock : créez d'abord vos ingrédients dans le module Stock.</div>}
        </div>)}
      </div>
    );
  };
  const Commandes = () => {
    const t = cmd ? totauxCommande(cmd) : null;
    return (
      <div>
        {canFront && (<div className="ec-card p-4 mb-5"><div className="grid md:grid-cols-3 gap-2 items-end">
          <div>{lab("Table")}<select value={nc.tableId} onChange={(e) => setNc({ ...nc, tableId: e.target.value })} data-testid="resto-cmd-table" className={ecInput} style={ecBorder}><option value="">Sans table (comptoir, à emporter)</option>{tables.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          <div>{lab("Serveur")}<input value={nc.server} onChange={(e) => setNc({ ...nc, server: e.target.value })} data-testid="resto-cmd-serveur" className={ecInput} style={ecBorder} /></div>
          <div><button onClick={ouvrirCommande} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="resto-cmd-ouvrir">Ouvrir une commande</button></div>
        </div></div>)}
        <div className="ec-wrap mb-4"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>Date</th><th>Table</th><th>Serveur</th><th className="text-right">Total</th><th>État</th><th></th></tr></thead>
          <tbody>{[...orders].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 60).map((o) => (
            <tr key={o.id} data-testid="resto-cmd-ligne"><td className="py-1.5 tabular text-xs">{o.number}</td><td>{ecDateFr(o.date)}</td><td>{nomTable(o.tableId)}</td><td className="text-xs">{o.server || "—"}</td><td className="text-right tabular">{rsM(o.status === "payee" ? o.total + (o.tip || 0) : totauxCommande(o).total)}</td>
              <td>{o.status === "ouverte" ? ecPastille("Ouverte", "attente") : o.status === "payee" ? ecPastille("Payée", "ok") : ecPastille("Annulée", "neutre")}</td>
              <td className="text-right whitespace-nowrap">{o.status === "ouverte" && <button onClick={() => setCmdSel(cmdSel === o.id ? "" : o.id)} className="text-xs underline" data-testid="resto-cmd-ouvrir-ligne">Ouvrir</button>}{o.status === "payee" && canEdit && <button onClick={() => annulerPayee(o)} className="text-xs" style={{ color: "#A6432F" }} data-testid="resto-cmd-annuler-payee">Annuler</button>}</td></tr>))}</tbody></table></div>
        {orders.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucune commande pour le moment.</div>}
        {cmd && cmd.status === "ouverte" && (<div className="ec-card p-4" data-testid="resto-cmd-detail">
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Commande {cmd.number} — {nomTable(cmd.tableId)}</div>
          {(cmd.lines || []).map((l) => (<div key={l.dishId} className="flex items-center justify-between text-sm py-1" data-testid="resto-cmd-plat-ligne"><span>{l.qty} × {l.label}</span><span className="tabular">{rsM(l.qty * l.unit)} {canFront && <button onClick={() => retirerLigne(cmd, l.dishId)} className="text-xs ml-2" style={{ color: "#A6432F" }}>Retirer</button>}</span></div>))}
          {(cmd.lines || []).length === 0 && <div className="text-sm mb-2" style={{ color: "#8A8370" }}>Aucun plat pour le moment.</div>}
          <div className="grid md:grid-cols-4 gap-2 items-end mt-2">
            <div className="md:col-span-2">{lab("Plat")}<select value={ld.dishId} onChange={(e) => setLd({ ...ld, dishId: e.target.value })} data-testid="resto-cmd-plat" className={ecInput} style={ecBorder}><option value="">—</option>{RS_CATS.map(([k, l]) => (<optgroup key={k} label={l}>{dishes.filter((d) => d.cat === k && d.active !== false).map((d) => <option key={d.id} value={d.id}>{d.name} — {rsM(d.price)}</option>)}</optgroup>))}</select></div>
            <div>{lab("Quantité")}<input type="number" min="1" value={ld.qty} onChange={(e) => setLd({ ...ld, qty: e.target.value })} data-testid="resto-cmd-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><button onClick={() => ajouterLigne(cmd)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="resto-cmd-plat-ajouter">Ajouter</button></div>
          </div>
          <div className="mt-3 p-3 rounded text-sm" style={{ background: "#F4F1E6" }} data-testid="resto-cmd-totaux">
            <div className="flex justify-between"><span>Sous-total</span><span className="tabular" data-testid="resto-tot-sous">{rsM(t.sous)}</span></div>
            {serviceRate > 0 && <div className="flex justify-between"><span>Service ({serviceRate} %)</span><span className="tabular" data-testid="resto-tot-service">{rsM(t.service)}</span></div>}
            {t.tca > 0 && <div className="flex justify-between"><span>TCA ({tcaRate} %)</span><span className="tabular">{rsM(t.tca)}</span></div>}
            <div className="flex justify-between font-semibold"><span>Addition</span><span className="tabular" data-testid="resto-tot-total">{rsM(t.total)}</span></div>
          </div>
          {canFront && (<div className="grid md:grid-cols-4 gap-2 items-end mt-3">
            <div>{lab("Mode de paiement")}<select value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })} data-testid="resto-pay-mode" className={ecInput} style={ecBorder}><option value="especes">Espèces</option><option value="banque">Banque / carte</option></select></div>
            <div>{lab("Pourboire (facultatif)")}<input type="number" min="0" step="0.01" value={pay.tip} onChange={(e) => setPay({ ...pay, tip: e.target.value })} data-testid="resto-pay-tip" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><button onClick={() => encaisser(cmd)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="resto-pay-encaisser">Encaisser l'addition</button></div>
            <div><button onClick={() => annulerOuverte(cmd)} className="px-3 py-2 rounded text-sm" style={{ ...ecBtn, background: "transparent", color: "#A6432F", border: "1px solid #A6432F" }} data-testid="resto-cmd-annuler">Annuler la commande</button></div>
          </div>)}
        </div>)}
      </div>
    );
  };
  const Service = () => {
    const pool = poolService();
    const actifs = staff.filter((s) => s.active !== false);
    const totalPts = actifs.reduce((s, x) => s + x.points, 0);
    return (
      <div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
          <div className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>Service et pourboires à répartir</div><div className="display text-lg tabular" data-testid="resto-pool" style={{ color: "#152238" }}>{rsM(pool)}</div></div>
          <div className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>Déjà reversé</div><div className="display text-lg tabular" data-testid="resto-pool-verse" style={{ color: "#152238" }}>{rsM(rsR2(payouts.reduce((s, p) => s + p.amount, 0)))}</div></div>
        </div>
        {canEdit && (<div className="ec-card p-4 mb-5"><div className="display text-base mb-2" style={{ color: "#152238" }}>Employés qui partagent le service</div>
          <div className="grid md:grid-cols-3 gap-2 items-end">
            <div>{lab("Nom de l'employé")}<input value={fs.name} onChange={(e) => setFs({ ...fs, name: e.target.value })} data-testid="resto-staff-nom" className={ecInput} style={ecBorder} /></div>
            <div>{lab("Points (sa part : cuisinier 2, serveur 3, plongeur 1…)")}<input type="number" min="0" step="0.5" value={fs.points} onChange={(e) => setFs({ ...fs, points: e.target.value })} data-testid="resto-staff-points" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><button onClick={addStaff} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="resto-staff-ajouter">Ajouter</button></div>
          </div></div>)}
        <div className="ec-wrap mb-4"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Employé</th><th className="text-right">Points</th><th className="text-right">Part</th><th className="text-right">Montant prévu</th><th></th></tr></thead>
          <tbody>{actifs.map((s) => (<tr key={s.id} data-testid="resto-staff-ligne"><td className="py-1.5">{s.name}</td><td className="text-right tabular">{s.points}</td><td className="text-right tabular">{totalPts > 0 ? Math.round(s.points / totalPts * 100) : 0} %</td><td className="text-right tabular" data-testid="resto-staff-montant">{rsM(totalPts > 0 ? rsR2(pool * s.points / totalPts) : 0)}</td><td className="text-right">{canEdit && <button onClick={() => delStaff(s)} className="text-xs" style={{ color: "#A6432F" }}>Retirer</button>}</td></tr>))}</tbody></table></div>
        {actifs.length === 0 && <div className="text-sm mb-3" style={{ color: "#8A8370" }}>Aucun employé : ajoutez ceux qui reçoivent une part du service.</div>}
        {canEdit && (<div className="flex flex-wrap items-end gap-3 mb-5"><div>{lab("Payé par")}<select value={fv.mode} onChange={(e) => setFv({ mode: e.target.value })} data-testid="resto-repartir-mode" className={ecInput} style={{ ...ecBorder, minWidth: 160 }}><option value="especes">Espèces</option><option value="banque">Banque</option></select></div>
          <button onClick={repartir} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="resto-repartir">Répartir {rsM(pool)} au personnel</button></div>)}
        {payouts.length > 0 && (<div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Détail</th><th className="text-right">Montant</th></tr></thead>
          <tbody>{[...payouts].reverse().map((p) => (<tr key={p.id} data-testid="resto-versement-ligne"><td className="py-1.5">{ecDateFr(p.date)}</td><td className="text-xs">{p.lines.map((l) => l.name + " " + rsM(l.amount)).join(" · ")}</td><td className="text-right tabular">{rsM(p.amount)}</td></tr>))}</tbody></table></div>)}
      </div>
    );
  };
  const Rapports = () => {
    const payees = orders.filter((o) => o.status === "payee").sort((a, b) => String(a.paidDate).localeCompare(String(b.paidDate)));
    const parPlat = {};
    payees.forEach((o) => o.lines.forEach((l) => { const x = parPlat[l.label] || (parPlat[l.label] = { qty: 0, total: 0 }); x.qty += l.qty; x.total = rsR2(x.total + l.qty * l.unit); }));
    const exporter = () => ecTelecharger("additions-restauration-" + today + ".csv", [["N°", "Date", "Table", "Sous-total", "Service", "TCA", "Pourboire", "Total encaissé", "Mode"], ...payees.map((o) => [o.number, ecDateFr(o.paidDate), nomTable(o.tableId), o.subtotal, o.service, o.tca, o.tip, rsR2(o.total + o.tip), o.mode === "banque" ? "Banque" : "Espèces"])]);
    return (
      <div>
        <div className="flex items-center justify-between mb-2"><div className="display text-base" style={{ color: "#152238" }}>Ventes par plat</div><button onClick={exporter} className="text-xs underline" data-testid="resto-rapport-export">Exporter les additions (CSV)</button></div>
        <div className="ec-wrap mb-4"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Plat</th><th className="text-right">Vendus</th><th className="text-right">Chiffre d'affaires</th></tr></thead>
          <tbody>{Object.keys(parPlat).sort((a, b) => parPlat[b].total - parPlat[a].total).map((k) => (<tr key={k} data-testid="resto-rapport-plat"><td className="py-1.5">{k}</td><td className="text-right tabular">{parPlat[k].qty}</td><td className="text-right tabular">{rsM(parPlat[k].total)}</td></tr>))}</tbody></table></div>
        {payees.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucune addition encaissée pour le moment.</div>}
      </div>
    );
  };
  const tabs = [["apercu", "Vue d'ensemble"], ["commandes", "Commandes"], ["menu", "Menu et recettes"], ["tables", "Tables"], ...(isVendeur ? [] : [["service", "Service"], ["rapports", "Rapports"]])];
  return (
    <div className="p-4 md:p-8 max-w-6xl" data-testid="resto-module">
      <style>{EC_CSS + '[data-testid="resto-module"] .display.text-base{border-left:3px solid #C9A24B;padding-left:10px;margin-bottom:12px}[data-testid="resto-module"] input,[data-testid="resto-module"] select{background:#fff}'}</style>
      <div className="mb-4"><div className="display text-2xl" style={{ color: "#152238" }}>Restauration</div><div className="text-xs" style={{ color: "#8A8370" }}>Tables, menu et coût des plats, commandes et additions, service du personnel</div></div>
      {!canFront && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }}>Consultation seule : votre rôle ne permet pas de modifier les données.</div>}
      {isVendeur && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }} data-testid="resto-serveur-note">Serveur / caissier : vous pouvez ouvrir des commandes, ajouter des plats et encaisser. Le menu, les tables et la répartition du service sont réservés à l'administrateur.</div>}
      <div className="ec-tabs">
        {tabs.map(([id, l]) => (<button key={id} onClick={() => setTab(id)} data-testid={"resto-tab-" + id} className="px-3 py-2 text-sm rounded-lg transition-colors" style={{ background: tab === id ? "#152238" : "transparent", color: tab === id ? "#EFE9DD" : "#5B563F" }}>{l}</button>))}
      </div>
      {tab === "apercu" && Apercu()}
      {tab === "commandes" && Commandes()}
      {tab === "menu" && MenuPlats()}
      {tab === "tables" && Tables()}
      {tab === "service" && !isVendeur && Service()}
      {tab === "rapports" && !isVendeur && Rapports()}
    </div>
  );
}

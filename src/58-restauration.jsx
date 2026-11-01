// ═══ MODULE ═══
// @module Restauration
// @depends EC_CSS, Menu, Plus, StatsBloc, ecBorder, ecBtn, ecBtnGold, ecDateFr, ecInput, ecPastille
//   ecTelecharger, isFutureDate, isLocked, statMois, statSomme, todayStr, uid, useState
// @exports RestoModule
// ═══ FIN DE L'EN-TÊTE ═══
// Bloc Restauration : salle (tables) et commandes avec envoi en cuisine, menu illustré (carte), fiches recettes (coût du plat), factures imprimables
// (A4 ou ticket), personnel et partage du service par postes, rapports et statistiques. L'hôtellerie viendra dans une version suivante.
//
// Comptabilité (tout se passe à l'ENCAISSEMENT de l'addition ; une commande ouverte n'écrit rien) :
//  • encaissement : Débit caisse ou banque (addition + pourboire, un ou plusieurs modes de paiement) / Crédit 7075 ventes de repas et boissons
//    (nettes de remise), 445 TCA si elle s'applique, 4677 « service et pourboires à reverser au personnel » (cet argent n'appartient pas à l'entreprise) ;
//  • répartition du service : Débit 4677 / Crédit caisse ou banque, au prorata des points de chaque employé ;
//  • sortie des ingrédients de la fiche recette (stock) ; si la méthode du stock en actif est choisie : Débit 6037 / Crédit 370.
// Toutes les données sont dans une seule catégorie « resto » (types : config, table, dish, order, staff, payout, closing).

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
const RS_POSTES = [["serveur", "Serveur / serveuse", 3], ["cuisinier", "Cuisinier / cuisinière", 2], ["aide", "Aide-cuisinier", 1.5], ["plongeur", "Plongeur", 1], ["barman", "Barman / barmaid", 2], ["caissier", "Caissier / caissière", 1.5], ["gerant", "Gérant", 0]];
const RS_MODES = [["especes", "Espèces"], ["banque", "Banque / carte"]];
const rsR2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const rsM = (n) => rsR2(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " G"; // toujours 2 décimales : une part de 37,50 ne doit pas s'afficher 38
const rsId = () => String(uid());
const rsRows = (rows, type) => (rows || []).filter((r) => r && r.type === type);
const rsNomMode = (m) => (RS_MODES.find((x) => x[0] === m) || [0, m])[1];
const rsPoste = (k) => (RS_POSTES.find((x) => x[0] === k) || [0, "—"])[1];
const rsPaiements = (o) => (o.payments && o.payments.length ? o.payments : [{ mode: o.mode || "especes", amount: rsR2((o.total || 0) + (o.tip || 0)) }]);

function rsAjouterComptes(accounts, setAccounts, codes) {
  const missing = [...new Set(codes)].filter((k) => RS_COMPTES[k] && !accounts.some((a) => a.code === k)).map((k) => ({ code: k, name: RS_COMPTES[k].name, type: RS_COMPTES[k].type }));
  if (missing.length) setAccounts((prev) => [...prev, ...missing.filter((m) => !prev.some((a) => a.code === m.code))]);
}
// Réduit la photo d'un plat (400 px, JPEG) pour qu'elle reste légère dans la sauvegarde.
function rsRedimensionner(file, max) {
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
  const closings = rsRows(resto, "closing");
  const cfg = rsRows(resto, "config")[0] || { id: "config", type: "config", serviceRate: 10, tcaOn: false, cats: [] };
  const serviceRate = Number(cfg.serviceRate) || 0;
  const tcaRate = cfg.tcaOn ? Number(settings.taxRate) || 0 : 0;
  const cats = [...RS_CATS, ...(cfg.cats || []).map((c) => [c.id, c.label])];
  const nomCat = (k) => (cats.find((c) => c[0] === k) || [0, k])[1];
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
    const brut = rsR2((o.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit) || 0), 0));
    const remise = Math.min(brut, rsR2(Number((o.discount || {}).amount) || 0));
    const sous = rsR2(brut - remise);
    const service = rsR2(sous * serviceRate / 100), tca = rsR2(sous * tcaRate / 100);
    return { brut, remise, sous, service, tca, total: rsR2(sous + service + tca) };
  };
  const dejaRepartie = new Set(payouts.flatMap((p) => p.orderIds || []));
  const payees = orders.filter((o) => o.status === "payee");
  const etatCmd = (o) => {
    if (o.status === "payee") return ["Payée", "ok"];
    if (o.status === "annulee") return ["Annulée", "neutre"];
    const nonEnv = (o.lines || []).some((l) => !l.sent);
    if (!(o.lines || []).length) return ["En saisie", "neutre"];
    if (nonEnv) return [(o.lines || []).some((l) => l.sent) ? "Ajouts à envoyer" : "En saisie", "info"];
    return o.served ? ["Servie — à encaisser", "attente"] : ["En cuisine", "attente"];
  };

  // ───────── Réglages ─────────
  const [fr, setFr] = useState(null);
  const reglages = fr || { serviceRate: String(serviceRate), tcaOn: !!cfg.tcaOn };
  const ecrireCfg = (patch) => setResto((prev) => [...(prev || []).filter((x) => x.type !== "config"), { type: "config", id: "config", serviceRate, tcaOn: !!cfg.tcaOn, cats: cfg.cats || [], ...patch }]);
  const saveCfg = () => {
    if (!canEdit) return;
    const r = Number(reglages.serviceRate);
    if (!(r >= 0 && r <= 30)) { showToast("Le service doit être entre 0 % et 30 %."); return; }
    ecrireCfg({ serviceRate: r, tcaOn: !!reglages.tcaOn });
    setFr(null);
    showToast("Réglages enregistrés : service " + r + " %" + (reglages.tcaOn ? ", TCA " + (Number(settings.taxRate) || 0) + " % ajoutée aux additions." : ", sans TCA."));
    logAudit("Restauration", "Réglages modifiés", "service " + r + " %");
  };

  // ───────── Tables ─────────
  const [ft, setFt] = useState({ name: "", seats: "4" });
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

  // ───────── Menu (carte) ─────────
  const vide = { id: "", name: "", cat: "plat", price: "", desc: "", photo: "" };
  const [fd, setFd] = useState(vide);
  const [nouvCat, setNouvCat] = useState("");
  const [carteApercu, setCarteApercu] = useState(false);
  const choisirPhoto = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try { const url = await rsRedimensionner(f, 420); setFd((x) => ({ ...x, photo: url })); showToast("Photo ajoutée (réduite à 420 px pour rester légère)."); }
    catch (err) { showToast("Cette image n'a pas pu être lue. Essayez un fichier JPG ou PNG."); }
  };
  const saveDish = () => {
    if (!canEdit) return;
    const name = fd.name.trim(), price = Number(fd.price);
    if (!name) { showToast("Indiquez le nom du plat ou de la boisson."); return; }
    if (!(price > 0)) { showToast("Indiquez un prix supérieur à zéro."); return; }
    if (dishes.some((d) => d.id !== fd.id && d.name.toLowerCase() === name.toLowerCase())) { showToast("Ce plat existe déjà dans le menu."); return; }
    if (fd.id) {
      maj(fd.id, (r) => ({ ...r, name, cat: fd.cat, price: rsR2(price), desc: fd.desc.trim(), photo: fd.photo }));
      showToast("« " + name + " » modifié.");
    } else {
      setResto((prev) => [...(prev || []), { type: "dish", id: rsId(), name, cat: fd.cat, price: rsR2(price), desc: fd.desc.trim(), photo: fd.photo, recipe: [], active: true, soldOut: false, special: false }]);
      showToast("« " + name + " » ajouté au menu. Ajoutez sa recette (onglet « Recettes et coûts ») pour connaître son coût.");
    }
    logAudit("Restauration", fd.id ? "Plat modifié" : "Plat ajouté", name + " — " + rsM(price));
    setFd({ ...vide, cat: fd.cat });
  };
  const toggleDish = (d, champ) => { if (canEdit) maj(d.id, (r) => ({ ...r, [champ]: !r[champ] })); };
  const addCat = () => {
    if (!canEdit) return;
    const label = nouvCat.trim();
    if (!label) { showToast("Donnez un nom à la catégorie (ex. Grillades, Pizzas)."); return; }
    if (cats.some((c) => c[1].toLowerCase() === label.toLowerCase())) { showToast("Cette catégorie existe déjà."); return; }
    ecrireCfg({ cats: [...(cfg.cats || []), { id: "c" + rsId(), label }] });
    setNouvCat("");
    showToast("Catégorie « " + label + " » ajoutée.");
  };

  // ───────── Recettes ─────────
  const [fri, setFri] = useState({ productId: "", qty: "" });
  const [platSel, setPlatSel] = useState("");
  const addIngredient = (d) => {
    if (!canEdit) return;
    const qty = Number(fri.qty);
    if (!fri.productId) { showToast("Choisissez un ingrédient (produit du stock)."); return; }
    if (!(qty > 0)) { showToast("Indiquez la quantité utilisée pour UNE portion."); return; }
    maj(d.id, (r) => ({ ...r, recipe: [...(r.recipe || []).filter((x) => String(x.productId) !== String(fri.productId)), { productId: fri.productId, qty }] }));
    setFri({ productId: "", qty: "" });
  };
  const delIngredient = (d, productId) => { if (canEdit) maj(d.id, (r) => ({ ...r, recipe: (r.recipe || []).filter((x) => String(x.productId) !== String(productId)) })); };

  // ───────── Salle et commandes ─────────
  const [cmdSel, setCmdSel] = useState("");
  const [serveur, setServeur] = useState("");
  const [rem, setRem] = useState({ amount: "", reason: "" });
  const [tip, setTip] = useState("");
  const [payRows, setPayRows] = useState([{ mode: "especes", amount: "" }]);
  const [convives, setConvives] = useState("");
  const [imprimer, setImprimer] = useState(null); // { o, ticket }
  const ouvertes = orders.filter((o) => o.status === "ouverte");
  const cmd = orders.find((o) => o.id === cmdSel && o.status === "ouverte");
  const ouvrirCommande = (tableId) => {
    if (!canFront) return;
    if (!dishes.some((d) => d.active !== false)) { showToast("Le menu est vide : ajoutez d'abord des plats (onglet « Menu »)."); return; }
    // le serveur se choisit dans la liste du personnel (jamais tapé à la main : une faute de frappe fausserait les rapports par serveur)
    if (staff.some((s) => s.active !== false) && !serveur) { showToast("Choisissez le serveur dans la liste avant d'ouvrir la commande."); return; }
    const id = rsId();
    setResto((prev) => [...(prev || []), { type: "order", id, number: numeroCommande(today), date: today, tableId: tableId || "", server: serveur || currentUserEmail || "", lines: [], status: "ouverte", createdAt: new Date().toISOString() }]);
    setCmdSel(id); setRem({ amount: "", reason: "" }); setTip(""); setPayRows([{ mode: "especes", amount: "" }]); setConvives("");
    showToast("Commande ouverte" + (tableId ? " sur la table " + nomTable(tableId) : " (sans table)") + ". Touchez les plats pour les ajouter.");
  };
  const choisirCommande = (o) => { setCmdSel(o.id); setRem({ amount: String((o.discount || {}).amount || ""), reason: (o.discount || {}).reason || "" }); setTip(""); setPayRows([{ mode: "especes", amount: "" }]); setConvives(""); };
  const ajouterPlat = (o, d) => {
    if (!canFront || o.status !== "ouverte") return;
    if (d.soldOut) { showToast("« " + d.name + " » est en rupture."); return; }
    maj(o.id, (r) => {
      const ex = (r.lines || []).find((l) => l.dishId === d.id && !l.sent);
      return { ...r, served: false, lines: ex ? r.lines.map((l) => (l === ex ? { ...l, qty: l.qty + 1 } : l)) : [...(r.lines || []), { dishId: d.id, label: d.name, qty: 1, unit: d.price, sent: false }] };
    });
  };
  const changerQte = (o, idx, delta) => { if (canFront && o.status === "ouverte") maj(o.id, (r) => ({ ...r, lines: r.lines.map((l, i) => (i === idx ? { ...l, qty: Math.max(0, l.qty + delta) } : l)).filter((l) => l.qty > 0) })); };
  const envoyerCuisine = (o) => {
    if (!canFront || o.status !== "ouverte") return;
    const nb = (o.lines || []).filter((l) => !l.sent).length;
    if (!nb) { showToast("Rien de nouveau à envoyer en cuisine."); return; }
    maj(o.id, (r) => ({ ...r, served: false, kitchenAt: new Date().toISOString(), lines: r.lines.map((l) => (l.sent ? l : { ...l, sent: true })) }));
    showToast(nb + " ligne(s) envoyée(s) en cuisine.");
  };
  const marquerServie = (o) => { if (canFront && o.status === "ouverte") { maj(o.id, (r) => ({ ...r, served: true, servedAt: new Date().toISOString() })); showToast("Commande marquée servie : prête à être encaissée."); } };
  const sauverRemise = (o) => {
    if (!canFront || o.status !== "ouverte") return;
    const a = rsR2(Number(rem.amount) || 0);
    if (a < 0) { showToast("La remise ne peut pas être négative."); return; }
    if (a > 0 && !rem.reason.trim()) { showToast("Indiquez le motif de la remise (elle figurera sur la facture)."); return; }
    if (a > totauxCommande(o).brut) { showToast("La remise ne peut pas dépasser le montant des plats."); return; }
    maj(o.id, (r) => ({ ...r, discount: a > 0 ? { amount: a, reason: rem.reason.trim() } : null }));
    showToast(a > 0 ? "Remise de " + rsM(a) + " appliquée." : "Remise retirée.");
  };
  const annulerOuverte = (o) => {
    if (!canFront || o.status !== "ouverte") return;
    maj(o.id, (r) => ({ ...r, status: "annulee", cancelledAt: today }));
    if (cmdSel === o.id) setCmdSel("");
    showToast("Commande " + o.number + " annulée (aucune écriture : elle n'était pas encaissée).");
  };
  const encaisser = (o) => {
    if (!canFront || o.status !== "ouverte") return;
    if (!(o.lines || []).length) { showToast("La commande est vide : ajoutez au moins un plat."); return; }
    const pourboire = rsR2(Number(tip) || 0);
    if (pourboire < 0) { showToast("Le pourboire ne peut pas être négatif."); return; }
    if (!verifDate(today, "encaisser")) return;
    const t = totauxCommande(o);
    const du = rsR2(t.total + pourboire);
    // paiement unique (cas normal) ou partagé entre plusieurs modes
    let pays;
    if (payRows.length === 1) pays = [{ mode: payRows[0].mode, amount: du }];
    else {
      pays = payRows.map((r) => ({ mode: r.mode, amount: rsR2(Number(r.amount) || 0) }));
      if (pays.some((p) => !(p.amount > 0))) { showToast("Chaque paiement doit avoir un montant supérieur à zéro (ou retirez la ligne)."); return; }
      const somme = rsR2(pays.reduce((s, p) => s + p.amount, 0));
      if (Math.abs(somme - du) > 0.005) { showToast("Les paiements totalisent " + rsM(somme) + " mais l'addition (pourboire compris) est de " + rsM(du) + "."); return; }
    }
    const credits = [{ account: "7075", debit: 0, credit: t.sous }];
    if (t.tca > 0) credits.push({ account: "445", debit: 0, credit: t.tca });
    if (t.service + pourboire > 0) credits.push({ account: "4677", debit: 0, credit: rsR2(t.service + pourboire) });
    const debits = {};
    pays.forEach((p) => { const c = compteMode(p.mode); debits[c] = rsR2((debits[c] || 0) + p.amount); });
    rsAjouterComptes(accounts, setAccounts, [...Object.keys(debits), ...credits.map((c) => c.account)]);
    const e = ecrire(today, "Addition " + o.number + " — " + nomTable(o.tableId), [...Object.keys(debits).map((c) => ({ account: c, debit: debits[c], credit: 0 })), ...credits], o.id);
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
    maj(o.id, (r) => ({ ...r, status: "payee", paidDate: today, paidAt: new Date().toISOString(), mode: pays[0].mode, payments: pays, brut: t.brut, discount: t.remise > 0 ? { amount: t.remise, reason: (r.discount || {}).reason || "" } : null, subtotal: t.sous, service: t.service, tca: t.tca, tip: pourboire, total: t.total, entryId: e.id, cogsEntryId: cogsEntry ? cogsEntry.id : "", cogs, stockOut: sorties.map((s) => ({ productId: s.productId, name: s.name, qty: s.qty })), paidBy: currentUserEmail || "", serviceRateUsed: serviceRate, tcaRateUsed: tcaRate }));
    setTip(""); setPayRows([{ mode: "especes", amount: "" }]); setConvives("");
    setCmdSel("");
    showToast("Addition " + o.number + " encaissée : " + rsM(du) + (manque ? " — attention : le stock de certains ingrédients était insuffisant." : "."));
    logAudit("Restauration", "Addition encaissée", o.number + " — " + rsM(t.total));
    setImprimer({ o: { ...o, status: "payee", paidDate: today, paidAt: new Date().toISOString(), payments: pays, brut: t.brut, discount: t.remise > 0 ? { amount: t.remise, reason: (o.discount || {}).reason || "" } : null, subtotal: t.sous, service: t.service, tca: t.tca, tip: pourboire, total: t.total, serviceRateUsed: serviceRate, tcaRateUsed: tcaRate }, ticket: false, apresPaiement: true });
  };
  const annulerPayee = (o) => {
    if (!canEdit || o.status !== "payee") return;
    if (!verifDate(today, "annuler l'addition")) return;
    if (dejaRepartie.has(o.id)) { showToast("Le service de cette addition a déjà été réparti au personnel : impossible de l'annuler."); return; }
    const contre = (id, label) => { const e = (entries || []).find((x) => x.id === id); return e ? ecrire(today, label, e.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })), o.id) : null; };
    contre(o.entryId, "Annulation addition " + o.number);
    if (o.cogsEntryId) contre(o.cogsEntryId, "Annulation addition " + o.number + " — coût des ingrédients");
    if ((o.stockOut || []).length) {
      setProducts((prev) => prev.map((p) => { const s = o.stockOut.find((x) => String(x.productId) === String(p.id)); return s ? { ...p, stock: rsR2((Number(p.stock) || 0) + s.qty) } : p; }));
      setMovements((prev) => [...prev, ...o.stockOut.map((s) => ({ id: uid(), date: today, createdAt: new Date().toISOString(), productId: s.productId, productName: s.name, type: "entree", qty: s.qty, reason: "Annulation addition " + o.number }))]);
    }
    maj(o.id, (r) => ({ ...r, status: "annulee", cancelledAt: today, wasPaid: true }));
    showToast("Addition " + o.number + " annulée : écritures contrepassées, ingrédients remis en stock.");
    logAudit("Restauration", "Addition annulée", o.number);
  };

  // ───────── Personnel ─────────
  const [fs, setFs] = useState({ name: "", phone: "", poste: "serveur", points: "3" });
  const changerPoste = (poste) => setFs({ ...fs, poste, points: String((RS_POSTES.find((p) => p[0] === poste) || [0, 0, 1])[2]) });
  const addStaff = () => {
    if (!canEdit) return;
    const name = fs.name.trim(), points = Number(fs.points);
    if (!name) { showToast("Indiquez le nom de l'employé."); return; }
    if (!(points >= 0)) { showToast("Les points doivent être un nombre (0 si l'employé ne reçoit pas de service)."); return; }
    if (staff.some((s) => s.name.toLowerCase() === name.toLowerCase())) { showToast("Cet employé existe déjà."); return; }
    setResto((prev) => [...(prev || []), { type: "staff", id: rsId(), name, phone: fs.phone.trim(), poste: fs.poste, points: rsR2(points), active: true }]);
    setFs({ name: "", phone: "", poste: fs.poste, points: fs.points });
    showToast(name + " ajouté(e) au personnel (" + rsPoste(fs.poste) + ", " + rsR2(points) + " point(s)).");
  };
  const toggleStaff = (s) => { if (canEdit) maj(s.id, (r) => ({ ...r, active: r.active === false })); };
  const delStaff = (s) => { if (canEdit) { setResto((prev) => (prev || []).filter((r) => r.id !== s.id)); showToast("Employé retiré (les répartitions passées sont conservées)."); } };
  const majPointsStaff = (s, v) => { if (canEdit) maj(s.id, (r) => ({ ...r, points: Math.max(0, rsR2(Number(v) || 0)) })); };

  // ───────── Service et pourboires ─────────
  const debutMois = today.slice(0, 7) + "-01";
  const [per, setPer] = useState({ from: debutMois, to: today });
  const [presence, setPresence] = useState({}); // points de la période par employé (0 = absent)
  const [fv, setFv] = useState({ mode: "especes" });
  const [recusImp, setRecusImp] = useState(null);
  const aRepartir = payees.filter((o) => !dejaRepartie.has(o.id) && o.paidDate >= per.from && o.paidDate <= per.to);
  const serviceTotal = rsR2(aRepartir.reduce((s, o) => s + (Number(o.service) || 0), 0));
  const tipsTotal = rsR2(aRepartir.reduce((s, o) => s + (Number(o.tip) || 0), 0));
  const pool = rsR2(serviceTotal + tipsTotal);
  const poolTout = rsR2(payees.filter((o) => !dejaRepartie.has(o.id)).reduce((s, o) => s + (Number(o.service) || 0) + (Number(o.tip) || 0), 0));
  const actifs = staff.filter((s) => s.active !== false);
  const ptsDe = (s) => (presence[s.id] !== undefined && presence[s.id] !== "" ? Math.max(0, Number(presence[s.id]) || 0) : s.points);
  const totalPts = rsR2(actifs.reduce((s, x) => s + ptsDe(x), 0));
  const partsCalc = () => {
    const part = actifs.filter((s) => ptsDe(s) > 0);
    let reste = pool;
    return part.map((s, i) => { const a = i === part.length - 1 ? rsR2(reste) : rsR2(pool * ptsDe(s) / totalPts); reste = rsR2(reste - a); return { staffId: s.id, name: s.name, poste: s.poste, points: ptsDe(s), amount: a }; });
  };
  const repartir = () => {
    if (!canEdit) return;
    if (!(pool > 0.004)) { showToast("Il n'y a aucun service ni pourboire à répartir sur cette période."); return; }
    if (!(totalPts > 0)) { showToast("Aucun employé n'a de points : ajoutez du personnel dans l'onglet « Personnel »."); return; }
    if (!verifDate(today, "répartir le service")) return;
    const lines = partsCalc();
    const compte = compteMode(fv.mode);
    rsAjouterComptes(accounts, setAccounts, [compte, "4677"]);
    const id = rsId();
    const e = ecrire(today, "Répartition du service et des pourboires au personnel (" + per.from + " au " + per.to + ")", [{ account: "4677", debit: pool, credit: 0 }, { account: compte, debit: 0, credit: pool }], id);
    setResto((prev) => [...(prev || []), { type: "payout", id, date: today, from: per.from, to: per.to, mode: fv.mode, lines, amount: pool, service: serviceTotal, tips: tipsTotal, orderIds: aRepartir.map((o) => o.id), entryId: e.id, status: "valide", by: currentUserEmail || "" }]);
    setPresence({});
    showToast(rsM(pool) + " réparti entre " + lines.length + " employé(s). Vous pouvez imprimer les reçus.");
    logAudit("Restauration", "Service réparti", rsM(pool));
  };

  // ───────── Factures (liste) ─────────
  const [ff, setFf] = useState({ from: debutMois, to: today, table: "", server: "", mode: "", etat: "" });
  const facturesListe = orders.filter((o) => (o.status === "payee" || (o.status === "annulee" && o.wasPaid)) && (o.paidDate || o.date) >= ff.from && (o.paidDate || o.date) <= ff.to
    && (!ff.table || (ff.table === "_sans" ? !o.tableId : o.tableId === ff.table)) && (!ff.server || o.server === ff.server) && (!ff.mode || rsPaiements(o).some((p) => p.mode === ff.mode)) && (!ff.etat || (ff.etat === "payee" ? o.status === "payee" : o.status === "annulee")))
    .sort((a, b) => String(b.paidAt || b.createdAt).localeCompare(String(a.paidAt || a.createdAt)));
  const serveurs = [...new Set(orders.map((o) => o.server).filter(Boolean))];
  const FactureSheet = ({ o, ticket }) => {
    const t = o.status === "payee" || o.wasPaid ? { brut: o.brut != null ? o.brut : o.subtotal, remise: (o.discount || {}).amount || 0, sous: o.subtotal, service: o.service, tca: o.tca, total: o.total } : totauxCommande(o);
    const tipV = Number(o.tip) || 0;
    const W = ticket ? 300 : 794;
    return (
      <div style={{ color: "#152238", background: "#fff", fontFamily: "'Inter', sans-serif", fontSize: ticket ? 11 : 13, width: "100%", maxWidth: W, margin: "0 auto", padding: ticket ? "10px 8px" : "32px 36px", boxSizing: "border-box" }} data-testid={ticket ? "resto-ticket-feuille" : "resto-facture-feuille"}>
        <div style={{ textAlign: "center", marginBottom: 10 }}>
          {settings.companyLogo && <img src={settings.companyLogo} alt="" style={{ width: ticket ? 40 : 60, height: ticket ? 40 : 60, objectFit: "contain", margin: "0 auto 6px", display: "block" }} />}
          <div style={{ fontWeight: 700, fontSize: ticket ? 14 : 20 }}>{settings.companyName || "Restaurant"}</div>
          {settings.companyAddress && <div style={{ fontSize: ticket ? 10 : 12 }}>{settings.companyAddress}</div>}
          {settings.companyPhone && <div style={{ fontSize: ticket ? 10 : 12 }}>{settings.companyPhone}</div>}
          {settings.companyNIF && <div style={{ fontSize: ticket ? 10 : 12 }}>NIF : {settings.companyNIF}</div>}
        </div>
        <div style={{ fontWeight: 700, fontSize: ticket ? 13 : 18, textAlign: "center", marginBottom: 8 }}>FACTURE{o.status === "annulee" ? " — ANNULÉE" : ""}</div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span>N° <b>{o.number}</b></span><span>{ecDateFr(o.paidDate || o.date)}</span></div>
        <div style={{ marginBottom: 8, lineHeight: 1.6 }}>{o.tableId ? "Table : " + nomTable(o.tableId) : "Sans table"}{o.server ? <><br />Serveur : {o.server}</> : null}</div>
        <div style={{ borderTop: "1px dashed #152238", borderBottom: "1px dashed #152238", padding: "6px 0", marginBottom: 6 }}>
          {(o.lines || []).map((l, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0" }}><span>{l.qty} × {l.label}</span><span className="tabular">{rsM(l.qty * l.unit)}</span></div>)}
        </div>
        <div style={{ lineHeight: 1.7 }}>
          {t.remise > 0 && <><div style={{ display: "flex", justifyContent: "space-between" }}><span>Montant des plats</span><span className="tabular">{rsM(t.brut)}</span></div><div style={{ display: "flex", justifyContent: "space-between" }}><span>Remise{(o.discount || {}).reason ? " (" + o.discount.reason + ")" : ""}</span><span className="tabular">− {rsM(t.remise)}</span></div></>}
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Sous-total</span><span className="tabular">{rsM(t.sous)}</span></div>
          {t.service > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span>Service ({o.serviceRateUsed != null ? o.serviceRateUsed : serviceRate} %)</span><span className="tabular">{rsM(t.service)}</span></div>}
          {t.tca > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span>TCA ({o.tcaRateUsed != null ? o.tcaRateUsed : tcaRate} %)</span><span className="tabular">{rsM(t.tca)}</span></div>}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: ticket ? 14 : 18, marginTop: 4 }}><span>TOTAL</span><span className="tabular">{rsM(t.total)}</span></div>
        {tipV > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span>Pourboire</span><span className="tabular">{rsM(tipV)}</span></div>}
        {(o.status === "payee" || o.wasPaid) && <div style={{ marginTop: 6 }}>{rsPaiements(o).map((p, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between" }}><span>Payé — {rsNomMode(p.mode)}</span><span className="tabular">{rsM(p.amount)}</span></div>)}</div>}
        <div style={{ marginTop: 12, textAlign: "center", fontSize: ticket ? 10 : 12 }}>Merci de votre visite !</div>
      </div>
    );
  };

  // ───────── Rapports et statistiques ─────────
  const [rp, setRp] = useState({ from: debutMois, to: today });
  const [compte, setCompte] = useState("");
  const dansRp = payees.filter((o) => o.paidDate >= rp.from && o.paidDate <= rp.to);
  const cloturerCaisse = () => {
    if (!canFront) return;
    const attendu = rsR2(payees.filter((o) => o.paidDate === today).reduce((s, o) => s + rsPaiements(o).filter((p) => p.mode === "especes").reduce((a, p) => a + p.amount, 0), 0));
    const c = Number(compte);
    if (compte === "" || !(c >= 0)) { showToast("Indiquez l'argent compté en caisse (espèces)."); return; }
    setResto((prev) => [...(prev || []).filter((x) => !(x.type === "closing" && x.date === today)), { type: "closing", id: rsId(), date: today, expected: attendu, counted: rsR2(c), ecart: rsR2(c - attendu), by: currentUserEmail || "" }]);
    setCompte("");
    showToast("Caisse du jour clôturée : attendu " + rsM(attendu) + ", compté " + rsM(c) + ", écart " + rsM(c - attendu) + ".");
  };

  // ───────── Écrans ─────────
  const lab = (t) => <label className="text-xs" style={{ color: "#8A8370" }}>{t}</label>;
  const Tot = (cols) => (<tr className="font-semibold" style={{ borderTop: "2px solid #152238" }} data-testid="resto-total-ligne">{cols.map((c, i) => <td key={i} className={"py-1.5" + (i > 0 ? " text-right tabular" : "")}>{c}</td>)}</tr>);

  const Apercu = () => {
    const jour = payees.filter((o) => o.paidDate === today);
    const caJour = rsR2(jour.reduce((s, o) => s + o.subtotal, 0));
    const mois = payees.filter((o) => String(o.paidDate).startsWith(today.slice(0, 7)));
    const caMois = rsR2(mois.reduce((s, o) => s + o.subtotal, 0));
    const panier = jour.length ? rsR2(jour.reduce((s, o) => s + o.total, 0) / jour.length) : 0;
    const ventesPlat = {};
    mois.forEach((o) => o.lines.forEach((l) => { ventesPlat[l.label] = (ventesPlat[l.label] || 0) + l.qty; }));
    const top = Object.keys(ventesPlat).sort((a, b) => ventesPlat[b] - ventesPlat[a]).slice(0, 5);
    const guide = [
      ["Tables", "Onglet Salle : créez vos tables (numéro, places).", "salle", tables.length > 0],
      ["Menu", "Onglet Menu : ajoutez vos plats avec photo, catégorie et prix.", "menu", dishes.length > 0],
      ["Recettes", "Onglet Recettes et coûts : liez les ingrédients du stock pour connaître le coût et la marge de chaque plat.", "recettes", dishes.some((d) => (d.recipe || []).length > 0)],
      ["Personnel", "Onglet Personnel : ajoutez vos employés et leur poste pour répartir le service.", "personnel", staff.length > 0],
      ["Première commande", "Onglet Salle : touchez une table, ajoutez les plats, envoyez en cuisine.", "salle", orders.length > 0],
      ["Premier encaissement", "Encaissez l'addition : la facture et la comptabilité se font toutes seules.", "salle", payees.length > 0],
      ["Service et pourboires", "Onglet Service et pourboires : répartissez au personnel ce qui a été encaissé pour lui.", "service", payouts.length > 0],
    ];
    const guideFait = guide.every((e) => e[3]);
    const kpis = [["Ventes du jour", rsM(caJour), "resto-kpi-jour"], ["Additions du jour", String(jour.length), "resto-kpi-nb"], ["Panier moyen (jour)", rsM(panier), "resto-kpi-panier"], ["Ventes du mois", rsM(caMois), "resto-kpi-mois"], ["Commandes ouvertes", String(ouvertes.length), "resto-kpi-ouvertes"], ["Service à répartir", rsM(poolTout), "resto-kpi-service"]];
    return (
      <div>
        {(<div className="ec-card p-4 mb-5" data-testid="resto-guide">
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Marche à suivre, en 7 étapes{guideFait ? " — toutes faites ✓" : ""}</div>
          <ol className="text-sm" style={{ color: "#152238", listStyle: "none", paddingLeft: 0 }}>{guide.map(([t, d, tb, fait], i) => (<li key={i} data-testid="resto-etape" className="mb-1.5 flex flex-wrap gap-2 items-baseline"><span style={{ color: fait ? "#0F6B5C" : "#8A8370", fontWeight: 700 }}>{fait ? "✓" : (i + 1) + "."}</span><span><b>{t}</b> — <span style={{ color: "#5B563F" }}>{d}</span></span>{!fait && !(isVendeur && !["salle", "menu", "recettes", "factures"].includes(tb)) && <button className="text-xs underline" data-testid="resto-etape-ouvrir" onClick={() => setTab(tb)}>Ouvrir</button>}</li>))}</ol>
        </div>)}
        {tables.length + dishes.length === 0 && <div className="p-4 rounded text-sm mb-4" style={{ background: "#FFF6E0", color: "#152238" }} data-testid="resto-vide">Pour commencer, dans cet ordre : <b>1.</b> onglet <b>Salle</b> : créez vos tables · <b>2.</b> onglet <b>Menu</b> : ajoutez vos plats avec photo et prix · <b>3.</b> onglet <b>Recettes et coûts</b> : liez les ingrédients du stock · <b>4.</b> onglet <b>Personnel</b> : ajoutez vos employés et leur poste · <b>5.</b> onglet <b>Salle</b> : touchez une table pour prendre une commande.</div>}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
          {kpis.map(([l, v, t]) => (<div key={t} className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>{l}</div><div className="display text-lg tabular" data-testid={t} style={{ color: "#152238" }}>{v}</div></div>))}
        </div>
        <div className="grid md:grid-cols-2 gap-4 mb-5">
          <div className="ec-card p-4"><div className="display text-base mb-2" style={{ color: "#152238" }}>Plats les plus vendus ce mois</div>
            {top.map((k, i) => (<div key={k} className="flex justify-between text-sm py-1" data-testid="resto-top-plat"><span>{i + 1}. {k}</span><span className="tabular">{ventesPlat[k]} vendu(s)</span></div>))}
            {top.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucune vente ce mois-ci.</div>}</div>
          <div className="ec-card p-4"><div className="display text-base mb-2" style={{ color: "#152238" }}>En cours maintenant</div>
            {ouvertes.map((o) => { const [lib, k] = etatCmd(o); return (<div key={o.id} className="flex items-center justify-between text-sm py-1" data-testid="resto-ouverte-ligne"><span>{o.number} — {nomTable(o.tableId)} — {rsM(totauxCommande(o).total)} {ecPastille(lib, k)}</span><button onClick={() => { setCmdSel(o.id); setTab("salle"); }} className="text-xs underline">Ouvrir</button></div>); })}
            {ouvertes.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucune commande ouverte.</div>}</div>
        </div>
        {canEdit && (<div className="ec-card p-4 mb-5" data-testid="resto-reglages">
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Réglages des additions</div>
          <div className="grid md:grid-cols-3 gap-2 items-end">
            <div>{lab("Service ajouté à l'addition (%)")}<input type="number" min="0" max="30" value={reglages.serviceRate} onChange={(e) => setFr({ ...reglages, serviceRate: e.target.value })} data-testid="resto-service-taux" className={ecInput + " tabular"} style={ecBorder} /></div>
            <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" checked={!!reglages.tcaOn} onChange={(e) => setFr({ ...reglages, tcaOn: e.target.checked })} data-testid="resto-tca" />Ajouter la TCA ({Number(settings.taxRate) || 0} %) aux additions</label>
            <div><button onClick={saveCfg} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="resto-reglages-enregistrer">Enregistrer</button></div>
          </div>
          <div className="text-xs mt-2" style={{ color: "#7A7460" }}>Le nom, l'adresse, le logo et le NIF imprimés sur les factures viennent de Administration → Paramètres de l'entreprise. Le service et les pourboires ne sont pas un revenu du restaurant : ils sont gardés en compte 4677 puis reversés au personnel. Taux et TCA à confirmer avec votre expert-comptable.</div>
        </div>)}
      </div>
    );
  };

  const Salle = () => (
    <div>
      {canFront && (<div className="flex flex-wrap items-end gap-3 mb-4">
        <div>{lab("Serveur")}<select value={serveur} onChange={(e) => setServeur(e.target.value)} data-testid="resto-cmd-serveur" className={ecInput} style={{ ...ecBorder, minWidth: 200 }}><option value="">{staff.some((s) => s.active !== false) ? "— Choisir le serveur —" : "(aucun employé enregistré)"}</option>{[...staff.filter((s) => s.active !== false)].sort((a, b) => (b.poste === "serveur") - (a.poste === "serveur") || a.name.localeCompare(b.name)).map((s) => <option key={s.id} value={s.name}>{s.name} — {rsPoste(s.poste)}</option>)}</select>{!staff.some((s) => s.active !== false) && <div className="text-xs mt-1" style={{ color: "#A6432F" }}>Enregistrez vos serveurs dans l'onglet « Personnel » pour les choisir ici.</div>}</div>
        <button onClick={() => ouvrirCommande("")} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="resto-cmd-sans-table">Nouvelle commande sans table (comptoir, à emporter)</button>
      </div>)}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5" data-testid="resto-plan">
        {tables.map((t) => { const occ = ouvertes.find((o) => o.tableId === t.id); const [lib, k] = occ ? etatCmd(occ) : ["Libre", "ok"]; return (
          <button key={t.id} onClick={() => (occ ? choisirCommande(occ) : ouvrirCommande(t.id))} data-testid="resto-table-carte" className="rounded-lg p-3 text-left" style={{ border: "2px solid " + (occ ? (occ.served ? "#9A7B1E" : "#C9A24B") : "#0F6B5C"), background: occ ? "#FFF8E6" : "#F0F8F5", cursor: "pointer" }}>
            <div className="display text-base" style={{ color: "#152238", border: "none", padding: 0, margin: 0 }}>{t.name}</div>
            <div className="text-xs" style={{ color: "#8A8370" }}>{t.seats} place(s)</div>
            <div className="mt-1">{ecPastille(lib, k)}</div>
            {occ && <div className="text-sm tabular mt-1">{rsM(totauxCommande(occ).total)}</div>}
          </button>); })}
        {ouvertes.filter((o) => !o.tableId).map((o) => { const [lib, k] = etatCmd(o); return (
          <button key={o.id} onClick={() => choisirCommande(o)} data-testid="resto-table-carte" className="rounded-lg p-3 text-left" style={{ border: "2px solid #C9A24B", background: "#FFF8E6", cursor: "pointer" }}>
            <div className="display text-base" style={{ color: "#152238", border: "none", padding: 0, margin: 0 }}>Comptoir {o.number.split("-")[2]}</div><div className="text-xs" style={{ color: "#8A8370" }}>sans table</div><div className="mt-1">{ecPastille(lib, k)}</div><div className="text-sm tabular mt-1">{rsM(totauxCommande(o).total)}</div>
          </button>); })}
      </div>
      {tables.length === 0 && <div className="text-sm mb-4" style={{ color: "#8A8370" }}>Aucune table : créez-les ci-dessous (administrateur), ou utilisez « commande sans table ».</div>}
      {cmd && Commande(cmd)}
      {canEdit && (<div className="ec-card p-4 mt-5"><div className="display text-base mb-2" style={{ color: "#152238" }}>Tables de la salle</div>
        <div className="grid md:grid-cols-3 gap-2 items-end">
          <div>{lab("Nom ou numéro de la table")}<input value={ft.name} onChange={(e) => setFt({ ...ft, name: e.target.value })} data-testid="resto-table-nom" className={ecInput} style={ecBorder} /></div>
          <div>{lab("Places")}<input type="number" min="1" value={ft.seats} onChange={(e) => setFt({ ...ft, seats: e.target.value })} data-testid="resto-table-places" className={ecInput + " tabular"} style={ecBorder} /></div>
          <div><button onClick={addTable} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="resto-table-ajouter">Ajouter la table</button></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">{tables.map((t) => (<span key={t.id} className="text-xs px-2 py-1 rounded" style={{ background: "#F4F1E6" }} data-testid="resto-table-ligne">{t.name} ({t.seats}) <button onClick={() => delTable(t)} style={{ color: "#A6432F" }}>×</button></span>))}</div>
      </div>)}
    </div>
  );
  const Commande = (o) => {
    const t = totauxCommande(o);
    const du = rsR2(t.total + (Number(tip) || 0));
    const nbConv = Math.max(0, Math.round(Number(convives) || 0));
    const [lib, k] = etatCmd(o);
    return (
      <div className="ec-card p-4" data-testid="resto-cmd-detail">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2"><div className="display text-base" style={{ color: "#152238", margin: 0 }}>Commande {o.number} — {nomTable(o.tableId)}</div><div>{ecPastille(lib, k)}</div></div>
        {canFront && (<div className="mb-3"><div className="text-xs mb-1" style={{ color: "#8A8370" }}>Touchez un plat pour l'ajouter à la commande :</div>
          {cats.map(([ck, cl]) => { const liste = dishes.filter((d) => d.cat === ck && d.active !== false); return liste.length ? (<div key={ck} className="mb-2"><div className="text-xs font-semibold" style={{ color: "#5B563F" }}>{cl}</div><div className="flex flex-wrap gap-2 mt-1">{liste.map((d) => (<button key={d.id} onClick={() => ajouterPlat(o, d)} data-testid="resto-plat-bouton" disabled={!!d.soldOut} className="px-2 py-1.5 rounded text-sm" style={{ border: "1px solid #DDD6C4", background: d.soldOut ? "#EEE" : "#fff", color: d.soldOut ? "#999" : "#152238", textDecoration: d.soldOut ? "line-through" : "none" }}>{d.name} <span className="tabular text-xs" style={{ color: "#8A8370" }}>{rsM(d.price)}</span></button>))}</div></div>) : null; })}</div>)}
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Plat</th><th className="text-center">Qté</th><th className="text-right">Prix</th><th className="text-right">Total</th><th>Cuisine</th></tr></thead>
          <tbody>{(o.lines || []).map((l, i) => (<tr key={i} data-testid="resto-cmd-plat-ligne"><td className="py-1.5">{l.label}</td><td className="text-center whitespace-nowrap">{canFront && <button onClick={() => changerQte(o, i, -1)} className="px-2" data-testid="resto-qte-moins">−</button>} <span className="tabular">{l.qty}</span> {canFront && <button onClick={() => changerQte(o, i, 1)} className="px-2" data-testid="resto-qte-plus">+</button>}</td><td className="text-right tabular">{rsM(l.unit)}</td><td className="text-right tabular">{rsM(l.qty * l.unit)}</td><td className="text-xs">{l.sent ? "Envoyé" : "À envoyer"}</td></tr>))}</tbody></table></div>
        {(o.lines || []).length === 0 && <div className="text-sm my-2" style={{ color: "#8A8370" }}>Aucun plat pour le moment.</div>}
        {canFront && (<div className="flex flex-wrap gap-2 my-3">
          <button onClick={() => envoyerCuisine(o)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="resto-cuisine-envoyer">Envoyer en cuisine</button>
          <button onClick={() => marquerServie(o)} className="px-3 py-2 rounded text-sm" style={{ ...ecBtn, background: "#0F6B5C" }} data-testid="resto-cuisine-servie">Marquer servie</button>
        </div>)}
        {canFront && (<div className="grid md:grid-cols-3 gap-2 items-end mb-3">
          <div>{lab("Remise (montant)")}<input type="number" min="0" step="0.01" value={rem.amount} onChange={(e) => setRem({ ...rem, amount: e.target.value })} data-testid="resto-remise-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
          <div>{lab("Motif de la remise")}<input value={rem.reason} onChange={(e) => setRem({ ...rem, reason: e.target.value })} data-testid="resto-remise-motif" className={ecInput} style={ecBorder} /></div>
          <div><button onClick={() => sauverRemise(o)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="resto-remise-appliquer">Appliquer la remise</button></div>
        </div>)}
        <div className="p-3 rounded text-sm" style={{ background: "#F4F1E6" }} data-testid="resto-cmd-totaux">
          {t.remise > 0 && <div className="flex justify-between"><span>Remise</span><span className="tabular">− {rsM(t.remise)}</span></div>}
          <div className="flex justify-between"><span>Sous-total</span><span className="tabular" data-testid="resto-tot-sous">{rsM(t.sous)}</span></div>
          {serviceRate > 0 && <div className="flex justify-between"><span>Service ({serviceRate} %)</span><span className="tabular" data-testid="resto-tot-service">{rsM(t.service)}</span></div>}
          {t.tca > 0 && <div className="flex justify-between"><span>TCA ({tcaRate} %)</span><span className="tabular">{rsM(t.tca)}</span></div>}
          <div className="flex justify-between font-semibold"><span>Addition</span><span className="tabular" data-testid="resto-tot-total">{rsM(t.total)}</span></div>
        </div>
        {canFront && (<div className="mt-3">
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div>{lab("Mode de paiement")}<select value={payRows[0].mode} onChange={(e) => setPayRows(payRows.map((r, i) => (i === 0 ? { ...r, mode: e.target.value } : r)))} data-testid="resto-pay-mode" className={ecInput} style={ecBorder}>{RS_MODES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></div>
            {payRows.length > 1 && <div>{lab("Montant payé")}<input type="number" min="0" step="0.01" value={payRows[0].amount} onChange={(e) => setPayRows(payRows.map((r, i) => (i === 0 ? { ...r, amount: e.target.value } : r)))} data-testid="resto-pay-montant-0" className={ecInput + " tabular"} style={ecBorder} /></div>}
            <div>{lab("Pourboire (facultatif)")}<input type="number" min="0" step="0.01" value={tip} onChange={(e) => setTip(e.target.value)} data-testid="resto-pay-tip" className={ecInput + " tabular"} style={ecBorder} /></div>
          </div>
          {payRows.slice(1).map((r, i) => (<div key={i} className="grid md:grid-cols-4 gap-2 items-end mt-2">
            <div>{lab("Autre mode de paiement")}<select value={r.mode} onChange={(e) => setPayRows(payRows.map((x, j) => (j === i + 1 ? { ...x, mode: e.target.value } : x)))} className={ecInput} style={ecBorder}>{RS_MODES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></div>
            <div>{lab("Montant payé")}<input type="number" min="0" step="0.01" value={r.amount} onChange={(e) => setPayRows(payRows.map((x, j) => (j === i + 1 ? { ...x, amount: e.target.value } : x)))} data-testid={"resto-pay-montant-" + (i + 1)} className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><button onClick={() => setPayRows(payRows.filter((x, j) => j !== i + 1).length === 1 ? [{ ...payRows[0], amount: "" }] : payRows.filter((x, j) => j !== i + 1))} className="text-xs" style={{ color: "#A6432F" }}>Retirer ce paiement</button></div>
          </div>))}
          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs" style={{ color: "#7A7460" }}>
            <button onClick={() => setPayRows([...payRows.length === 1 ? [{ ...payRows[0], amount: "" }] : payRows, { mode: "banque", amount: "" }])} className="underline" data-testid="resto-pay-ajouter-mode">Payer avec plusieurs modes (facultatif)</button>
            <span>Diviser entre <input type="number" min="0" value={convives} onChange={(e) => setConvives(e.target.value)} data-testid="resto-convives" style={{ width: 54, border: "1px solid #DDD6C4", borderRadius: 4, padding: "2px 4px" }} /> personnes{nbConv > 1 ? <b data-testid="resto-part-personne"> : {rsM(du / nbConv)} chacune</b> : null} (information)</span>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <button onClick={() => encaisser(o)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="resto-pay-encaisser">Encaisser {rsM(du)}</button>
            <button onClick={() => annulerOuverte(o)} className="px-3 py-2 rounded text-sm" style={{ ...ecBtn, background: "transparent", color: "#A6432F", border: "1px solid #A6432F" }} data-testid="resto-cmd-annuler">Annuler la commande</button>
          </div>
        </div>)}
      </div>
    );
  };

  const Factures = () => {
    const pay = facturesListe.filter((o) => o.status === "payee");
    const somme = (f) => rsR2(pay.reduce((s, o) => s + (Number(f(o)) || 0), 0));
    return (
      <div>
        <div className="ec-card p-4 mb-4"><div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
          <div>{lab("Du")}<input type="date" value={ff.from} onChange={(e) => setFf({ ...ff, from: e.target.value })} data-testid="resto-fact-du" className={ecInput} style={ecBorder} /></div>
          <div>{lab("Au")}<input type="date" value={ff.to} onChange={(e) => setFf({ ...ff, to: e.target.value })} data-testid="resto-fact-au" className={ecInput} style={ecBorder} /></div>
          <div>{lab("Table")}<select value={ff.table} onChange={(e) => setFf({ ...ff, table: e.target.value })} className={ecInput} style={ecBorder}><option value="">Toutes</option><option value="_sans">Sans table</option>{tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
          <div>{lab("Serveur")}<select value={ff.server} onChange={(e) => setFf({ ...ff, server: e.target.value })} className={ecInput} style={ecBorder}><option value="">Tous</option>{serveurs.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
          <div>{lab("Paiement")}<select value={ff.mode} onChange={(e) => setFf({ ...ff, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="">Tous</option>{RS_MODES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></div>
          <div>{lab("État")}<select value={ff.etat} onChange={(e) => setFf({ ...ff, etat: e.target.value })} className={ecInput} style={ecBorder}><option value="">Tous</option><option value="payee">Payées</option><option value="annulee">Annulées</option></select></div>
        </div></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>Date</th><th>Table</th><th>Serveur</th><th className="text-right">Sous-total</th><th className="text-right">Service</th><th className="text-right">TCA</th><th className="text-right">Pourboire</th><th className="text-right">Total encaissé</th><th>Paiement</th><th>État</th><th></th></tr></thead>
          <tbody>{facturesListe.map((o) => (<tr key={o.id} data-testid="resto-fact-ligne" style={{ opacity: o.status === "annulee" ? 0.55 : 1 }}><td className="py-1.5 tabular text-xs">{o.number}</td><td>{ecDateFr(o.paidDate || o.date)}</td><td>{nomTable(o.tableId)}</td><td className="text-xs">{o.server || "—"}</td><td className="text-right tabular">{rsM(o.subtotal)}</td><td className="text-right tabular">{rsM(o.service)}</td><td className="text-right tabular">{rsM(o.tca)}</td><td className="text-right tabular">{rsM(o.tip)}</td><td className="text-right tabular">{rsM(rsR2((o.total || 0) + (o.tip || 0)))}</td><td className="text-xs">{rsPaiements(o).map((p) => rsNomMode(p.mode)).join(" + ")}</td><td>{o.status === "payee" ? ecPastille("Payée", "ok") : ecPastille("Annulée", "neutre")}</td>
            <td className="text-right whitespace-nowrap"><button onClick={() => setImprimer({ o, ticket: false })} className="text-xs underline mr-2" data-testid="resto-fact-voir">Voir / A4</button><button onClick={() => setImprimer({ o, ticket: true })} className="text-xs underline mr-2" data-testid="resto-fact-ticket">Ticket</button>{o.status === "payee" && canEdit && <button onClick={() => annulerPayee(o)} className="text-xs" style={{ color: "#A6432F" }} data-testid="resto-cmd-annuler-payee">Annuler</button>}</td></tr>))}
            {facturesListe.length > 0 && Tot(["Total (" + pay.length + " facture(s) payée(s))", "", "", "", rsM(somme((o) => o.subtotal)), rsM(somme((o) => o.service)), rsM(somme((o) => o.tca)), rsM(somme((o) => o.tip)), rsM(somme((o) => (o.total || 0) + (o.tip || 0)))])}</tbody></table></div>
        {facturesListe.length === 0 && <div className="text-sm mt-2" style={{ color: "#8A8370" }}>Aucune facture pour ces filtres. Une facture est créée à chaque addition encaissée.</div>}
      </div>
    );
  };

  const Menu = () => (
    <div>
      {canEdit && (<div className="ec-card p-4 mb-5" data-testid="resto-plat-form">
        <div className="display text-base mb-2" style={{ color: "#152238" }}>{fd.id ? "Modifier le plat" : "Ajouter un plat ou une boisson"}</div>
        <div className="grid md:grid-cols-4 gap-2 items-end">
          <div className="md:col-span-2">{lab("Nom du plat ou de la boisson")}<input value={fd.name} onChange={(e) => setFd({ ...fd, name: e.target.value })} data-testid="resto-plat-nom" className={ecInput} style={ecBorder} /></div>
          <div>{lab("Catégorie")}<select value={fd.cat} onChange={(e) => setFd({ ...fd, cat: e.target.value })} data-testid="resto-plat-cat" className={ecInput} style={ecBorder}>{cats.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div>{lab("Prix de vente")}<input type="number" min="0" step="0.01" value={fd.price} onChange={(e) => setFd({ ...fd, price: e.target.value })} data-testid="resto-plat-prix" className={ecInput + " tabular"} style={ecBorder} /></div>
          <div className="md:col-span-2">{lab("Description courte (facultatif)")}<input value={fd.desc} onChange={(e) => setFd({ ...fd, desc: e.target.value })} data-testid="resto-plat-desc" className={ecInput} style={ecBorder} /></div>
          <div className="md:col-span-2">{lab("Photo (facultatif)")}<div className="flex items-center gap-2 mt-1"><input type="file" accept="image/*" onChange={choisirPhoto} data-testid="resto-plat-photo" className="text-xs" />{fd.photo && <img src={fd.photo} alt="" data-testid="resto-plat-photo-apercu" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6 }} />}{fd.photo && <button onClick={() => setFd({ ...fd, photo: "" })} className="text-xs" style={{ color: "#A6432F" }}>Retirer</button>}</div></div>
        </div>
        <div className="flex flex-wrap gap-2 mt-2"><button onClick={saveDish} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="resto-plat-ajouter">{fd.id ? "Enregistrer les modifications" : "Ajouter au menu"}</button>{fd.id && <button onClick={() => setFd(vide)} className="px-3 py-2 rounded text-sm underline">Annuler la modification</button>}</div>
        <div className="flex flex-wrap items-end gap-2 mt-4 pt-3" style={{ borderTop: "1px solid #E4DFD1" }}>
          <div>{lab("Nouvelle catégorie (ex. Grillades, Pizzas)")}<input value={nouvCat} onChange={(e) => setNouvCat(e.target.value)} data-testid="resto-cat-nom" className={ecInput} style={{ ...ecBorder, minWidth: 220 }} /></div>
          <button onClick={addCat} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="resto-cat-ajouter">Ajouter la catégorie</button>
          <button onClick={() => setCarteApercu(true)} className="px-3 py-2 rounded text-sm ml-auto" style={ecBtn} data-testid="resto-carte-apercu-ouvrir">Aperçu de la carte pour les clients</button>
        </div>
      </div>)}
      {!canEdit && <div className="mb-3"><button onClick={() => setCarteApercu(true)} className="px-3 py-2 rounded text-sm" style={ecBtn}>Voir la carte</button></div>}
      {cats.map(([ck, cl]) => { const liste = dishes.filter((d) => d.cat === ck); return liste.length ? (
        <div key={ck} className="mb-5"><div className="display text-base" style={{ color: "#152238" }}>{cl}</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {liste.map((d) => (<div key={d.id} className="ec-card p-3" data-testid="resto-plat-ligne" style={{ opacity: d.active === false ? 0.5 : 1 }}>
              <div className="flex gap-3">
                {d.photo ? <img src={d.photo} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} /> : <div style={{ width: 72, height: 72, borderRadius: 8, background: "#F4F1E6", color: "#9A7B1E", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0 }}>{d.name.charAt(0).toUpperCase()}</div>}
                <div style={{ minWidth: 0 }}><div className="font-semibold text-sm">{d.name} {d.special && <span title="Plat du jour">★</span>}</div>{d.desc && <div className="text-xs" style={{ color: "#7A7460" }}>{d.desc}</div>}<div className="tabular text-sm mt-1">{rsM(d.price)}</div>{d.soldOut && <div className="text-xs" style={{ color: "#A6432F" }}>En rupture</div>}{d.active === false && <div className="text-xs" style={{ color: "#8A8370" }}>Retiré de la carte</div>}</div>
              </div>
              {canEdit && <div className="flex flex-wrap gap-2 mt-2 text-xs"><button onClick={() => { setFd({ id: d.id, name: d.name, cat: d.cat, price: String(d.price), desc: d.desc || "", photo: d.photo || "" }); try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) {} }} className="underline" data-testid="resto-plat-modifier">Modifier</button><button onClick={() => toggleDish(d, "soldOut")} className="underline" data-testid="resto-plat-rupture">{d.soldOut ? "Disponible" : "En rupture"}</button><button onClick={() => toggleDish(d, "special")} className="underline">{d.special ? "Plus plat du jour" : "Plat du jour"}</button><button onClick={() => toggleDish(d, "active")} className="underline" style={{ color: "#A6432F" }}>{d.active === false ? "Remettre" : "Retirer"}</button></div>}
            </div>))}
          </div></div>) : null; })}
      {dishes.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Le menu est vide : ajoutez votre premier plat ci-dessus.</div>}
    </div>
  );
  const CarteClient = () => (
    <div style={{ color: "#152238", background: "#fff", fontFamily: "'Inter', sans-serif", maxWidth: 794, margin: "0 auto", padding: "32px 36px", boxSizing: "border-box" }} data-testid="resto-carte-feuille">
      <div style={{ textAlign: "center", marginBottom: 18 }}>{settings.companyLogo && <img src={settings.companyLogo} alt="" style={{ width: 60, height: 60, objectFit: "contain", margin: "0 auto 6px", display: "block" }} />}<div style={{ fontWeight: 700, fontSize: 26 }}>{settings.companyName || "Notre carte"}</div><div style={{ fontSize: 13, color: "#7A7460" }}>La carte</div></div>
      {dishes.some((d) => d.special && d.active !== false) && <div style={{ marginBottom: 14 }}><div style={{ fontWeight: 700, fontSize: 16, borderBottom: "2px solid #C9A24B", marginBottom: 6 }}>★ Plats du jour</div>{dishes.filter((d) => d.special && d.active !== false).map((d) => <div key={d.id} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}><span>{d.name}</span><span>{rsM(d.price)}</span></div>)}</div>}
      {cats.map(([ck, cl]) => { const liste = dishes.filter((d) => d.cat === ck && d.active !== false); return liste.length ? (<div key={ck} style={{ marginBottom: 14, pageBreakInside: "avoid" }}><div style={{ fontWeight: 700, fontSize: 16, borderBottom: "2px solid #C9A24B", marginBottom: 6 }}>{cl}</div>
        {liste.map((d) => (<div key={d.id} style={{ display: "flex", gap: 10, padding: "5px 0", alignItems: "center" }}>{d.photo && <img src={d.photo} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6 }} />}<div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{d.name}{d.soldOut ? " (épuisé)" : ""}</div>{d.desc && <div style={{ fontSize: 12, color: "#7A7460" }}>{d.desc}</div>}</div><div style={{ fontWeight: 600 }}>{rsM(d.price)}</div></div>))}</div>) : null; })}
    </div>
  );

  const Recettes = () => {
    const d = dishes.find((x) => x.id === platSel);
    const sansRecette = dishes.filter((x) => x.active !== false && !(x.recipe || []).length).length;
    return (
      <div>
        <div className="text-sm mb-3 p-3 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }}>Une fiche recette liste les <b>ingrédients d'UNE portion</b>. Elle sert à deux choses : calculer le <b>coût</b> et la <b>marge</b> du plat, et faire <b>sortir les ingrédients du stock</b> à chaque addition. {sansRecette > 0 && <b data-testid="resto-sans-recette">{sansRecette} plat(s) n'ont pas encore de recette.</b>}</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Plat</th><th>Catégorie</th><th className="text-right">Prix de vente</th><th className="text-right">Coût</th><th className="text-right">Marge</th><th></th></tr></thead>
          <tbody>{dishes.map((x) => { const c = coutPlat(x); const m = x.price > 0 && c > 0 ? Math.round((1 - c / x.price) * 100) : null; return (
            <tr key={x.id} data-testid="resto-recette-ligne"><td className="py-1.5">{x.name}</td><td className="text-xs">{nomCat(x.cat)}</td><td className="text-right tabular">{rsM(x.price)}</td><td className="text-right tabular">{(x.recipe || []).length ? rsM(c) : "—"}</td><td className="text-right tabular" style={{ color: m !== null && m < 30 ? "#A6432F" : undefined }}>{m === null ? "—" : m + " %"}</td><td className="text-right"><button onClick={() => setPlatSel(platSel === x.id ? "" : x.id)} className="text-xs underline" data-testid="resto-plat-recette">Recette</button></td></tr>); })}</tbody></table></div>
        {dishes.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Ajoutez d'abord des plats dans l'onglet « Menu ».</div>}
        {d && (<div className="ec-card p-4 mt-4" data-testid="resto-recette"><div className="display text-base mb-2" style={{ color: "#152238" }}>Recette de « {d.name} » — pour une portion</div>
          {(d.recipe || []).map((r) => (<div key={r.productId} className="flex items-center justify-between text-sm py-1" data-testid="resto-ingredient-ligne"><span>{nomProduit(r.productId)} — {r.qty}</span>{canEdit && <button onClick={() => delIngredient(d, r.productId)} className="text-xs" style={{ color: "#A6432F" }}>Retirer</button>}</div>))}
          {(d.recipe || []).length === 0 && <div className="text-sm mb-2" style={{ color: "#8A8370" }}>Aucun ingrédient : le coût du plat est inconnu.</div>}
          {canEdit && (<div className="grid md:grid-cols-3 gap-2 items-end mt-2">
            <div>{lab("Ingrédient (produit du stock)")}<select value={fri.productId} onChange={(e) => setFri({ ...fri, productId: e.target.value })} data-testid="resto-ingredient-produit" className={ecInput} style={ecBorder}><option value="">—</option>{marchandises.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div>{lab("Quantité par portion")}<input type="number" min="0" step="0.01" value={fri.qty} onChange={(e) => setFri({ ...fri, qty: e.target.value })} data-testid="resto-ingredient-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><button onClick={() => addIngredient(d)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="resto-ingredient-ajouter">Ajouter l'ingrédient</button></div>
          </div>)}
          {marchandises.length === 0 && <div className="text-xs mt-2" style={{ color: "#A6432F" }}>Aucun produit « marchandise » dans le stock : créez d'abord vos ingrédients dans le module Stock (avec leur prix de revient).</div>}
        </div>)}
      </div>
    );
  };

  const Personnel = () => (
    <div>
      <div className="text-sm mb-3 p-3 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }}>Enregistrez ici toute l'équipe avec son <b>poste</b>. Les <b>points</b> servent à partager le service et les pourboires (onglet « Service ») : plus un poste a de points, plus sa part est grande. Les points par défaut sont modifiables, employé par employé.</div>
      {canEdit && (<div className="ec-card p-4 mb-5"><div className="grid md:grid-cols-5 gap-2 items-end">
        <div className="md:col-span-2">{lab("Nom de l'employé")}<input value={fs.name} onChange={(e) => setFs({ ...fs, name: e.target.value })} data-testid="resto-staff-nom" className={ecInput} style={ecBorder} /></div>
        <div>{lab("Téléphone (facultatif)")}<input value={fs.phone} onChange={(e) => setFs({ ...fs, phone: e.target.value })} className={ecInput} style={ecBorder} /></div>
        <div>{lab("Poste")}<select value={fs.poste} onChange={(e) => changerPoste(e.target.value)} data-testid="resto-staff-poste" className={ecInput} style={ecBorder}>{RS_POSTES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div>{lab("Points")}<input type="number" min="0" step="0.5" value={fs.points} onChange={(e) => setFs({ ...fs, points: e.target.value })} data-testid="resto-staff-points" className={ecInput + " tabular"} style={ecBorder} /></div>
      </div><button onClick={addStaff} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="resto-staff-ajouter">Ajouter à l'équipe</button></div>)}
      <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Employé</th><th>Poste</th><th>Téléphone</th><th className="text-right">Points</th><th>État</th><th></th></tr></thead>
        <tbody>{staff.map((s) => (<tr key={s.id} data-testid="resto-staff-ligne" style={{ opacity: s.active === false ? 0.5 : 1 }}><td className="py-1.5">{s.name}</td><td>{rsPoste(s.poste)}</td><td className="text-xs">{s.phone || "—"}</td>
          <td className="text-right">{canEdit ? <input type="number" min="0" step="0.5" defaultValue={s.points} key={s.id + ":" + s.points} onBlur={(e) => majPointsStaff(s, e.target.value)} className="tabular" style={{ width: 64, border: "1px solid #DDD6C4", borderRadius: 4, padding: "2px 4px", textAlign: "right" }} /> : <span className="tabular">{s.points}</span>}</td>
          <td>{s.active === false ? ecPastille("Parti", "neutre") : ecPastille("En poste", "ok")}</td><td className="text-right whitespace-nowrap">{canEdit && <><button onClick={() => toggleStaff(s)} className="text-xs underline mr-2">{s.active === false ? "Remettre en poste" : "Marquer parti"}</button><button onClick={() => delStaff(s)} className="text-xs" style={{ color: "#A6432F" }}>Retirer</button></>}</td></tr>))}</tbody></table></div>
      {staff.length === 0 && <div className="text-sm mt-2" style={{ color: "#8A8370" }}>Aucun employé pour le moment.</div>}
    </div>
  );

  const Service = () => {
    const parts = actifs.length && totalPts > 0 ? partsCalc() : [];
    const ex = (() => { const a = actifs.filter((s) => s.points > 0).slice(0, 2); if (a.length < 2) return "Exemple : 1 000 G à répartir ; Anne a 1 point et Boris 3 points ; total 4 points → Anne reçoit 250 G (1 ÷ 4) et Boris 750 G (3 ÷ 4)."; const tp = a[0].points + a[1].points; return "Exemple avec 1 000 G à répartir : " + a[0].name + " (" + a[0].points + " pt) → " + rsM(1000 * a[0].points / tp) + " ; " + a[1].name + " (" + a[1].points + " pt) → " + rsM(1000 * a[1].points / tp) + " (si seuls ces deux-là partagent)."; })();
    return (
      <div>
        <div className="ec-card p-4 mb-4" data-testid="resto-service-explication"><div className="display text-base mb-2" style={{ color: "#152238" }}>Comment fonctionne le partage du service</div>
          <ol className="text-sm" style={{ color: "#5B563F", paddingLeft: 18, listStyle: "decimal" }}>
            <li>À chaque addition, le <b>service</b> ({serviceRate} %) est ajouté, et le client peut laisser un <b>pourboire</b>.</li>
            <li>Cet argent <b>appartient au personnel</b>, pas au restaurant : il est gardé à part (compte 4677) jusqu'à la répartition.</li>
            <li>Chaque employé a des <b>points</b> selon son poste (onglet « Personnel »). Sa part = <b>ses points ÷ total des points × l'argent à répartir</b>.</li>
            <li>Vous choisissez la <b>période</b>, vous ajustez les points des absents (0 = n'a pas travaillé), vous cliquez sur « Répartir », puis vous imprimez les <b>reçus</b>.</li>
          </ol><div className="text-xs mt-2" style={{ color: "#7A7460" }} data-testid="resto-service-exemple">{ex}</div></div>
        <div className="ec-card p-4 mb-4"><div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <div>{lab("Du")}<input type="date" value={per.from} onChange={(e) => setPer({ ...per, from: e.target.value })} data-testid="resto-per-du" className={ecInput} style={ecBorder} /></div>
          <div>{lab("Au")}<input type="date" value={per.to} onChange={(e) => setPer({ ...per, to: e.target.value })} data-testid="resto-per-au" className={ecInput} style={ecBorder} /></div>
          <div className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>Service ({aRepartir.length} addition(s))</div><div className="tabular" data-testid="resto-pool-service">{rsM(serviceTotal)}</div></div>
          <div className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>Pourboires</div><div className="tabular" data-testid="resto-pool-tips">{rsM(tipsTotal)}</div></div>
          <div className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>À répartir</div><div className="display text-lg tabular" data-testid="resto-pool" style={{ color: "#152238" }}>{rsM(pool)}</div></div>
        </div></div>
        <div className="ec-wrap mb-4"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Employé</th><th>Poste</th><th className="text-right">Points (cette période)</th><th className="text-right">Part</th><th className="text-right">Montant</th></tr></thead>
          <tbody>{actifs.map((s) => { const p = parts.find((x) => x.staffId === s.id); return (<tr key={s.id} data-testid="resto-staff-ligne-service"><td className="py-1.5">{s.name}</td><td className="text-xs">{rsPoste(s.poste)}</td>
            <td className="text-right">{canEdit ? <input type="number" min="0" step="0.5" value={presence[s.id] !== undefined ? presence[s.id] : s.points} onChange={(e) => setPresence({ ...presence, [s.id]: e.target.value })} data-testid="resto-presence" className="tabular" style={{ width: 64, border: "1px solid #DDD6C4", borderRadius: 4, padding: "2px 4px", textAlign: "right" }} /> : <span className="tabular">{s.points}</span>}</td>
            <td className="text-right tabular">{p && totalPts > 0 ? Math.round(p.points / totalPts * 100) + " %" : "—"}</td><td className="text-right tabular" data-testid="resto-staff-montant">{rsM(p ? p.amount : 0)}</td></tr>); })}
            {actifs.length > 0 && <tr className="font-semibold" style={{ borderTop: "2px solid #152238" }}><td className="py-1.5" colSpan={2}>Total</td><td className="text-right tabular" data-testid="resto-total-points">{totalPts}</td><td></td><td className="text-right tabular" data-testid="resto-total-montant">{rsM(parts.reduce((s, p) => s + p.amount, 0))}</td></tr>}</tbody></table></div>
        {actifs.length === 0 && <div className="text-sm mb-3" style={{ color: "#8A8370" }}>Aucun employé en poste : ajoutez l'équipe dans l'onglet « Personnel ».</div>}
        {canEdit && (<div className="flex flex-wrap items-end gap-3 mb-5"><div>{lab("Payé par")}<select value={fv.mode} onChange={(e) => setFv({ mode: e.target.value })} data-testid="resto-repartir-mode" className={ecInput} style={{ ...ecBorder, minWidth: 160 }}>{RS_MODES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></div>
          <button onClick={repartir} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="resto-repartir">Répartir {rsM(pool)} au personnel</button></div>)}
        {payouts.length > 0 && (<div><div className="display text-base" style={{ color: "#152238" }}>Répartitions déjà faites</div><div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Période</th><th>Détail</th><th className="text-right">Montant</th><th></th></tr></thead>
          <tbody>{[...payouts].reverse().map((p) => (<tr key={p.id} data-testid="resto-versement-ligne"><td className="py-1.5">{ecDateFr(p.date)}</td><td className="text-xs">{p.from ? ecDateFr(p.from) + " → " + ecDateFr(p.to) : "—"}</td><td className="text-xs">{p.lines.map((l) => l.name + " " + rsM(l.amount)).join(" · ")}</td><td className="text-right tabular">{rsM(p.amount)}</td><td className="text-right"><button onClick={() => setRecusImp(p)} className="text-xs underline" data-testid="resto-recus">Reçus</button></td></tr>))}</tbody></table></div></div>)}
      </div>
    );
  };
  const RecusSheet = ({ p }) => (
    <div style={{ color: "#152238", background: "#fff", fontFamily: "'Inter', sans-serif", fontSize: 13, maxWidth: 794, margin: "0 auto" }} data-testid="resto-recus-feuille">
      {p.lines.map((l, i) => (<div key={i} style={{ padding: "28px 36px", pageBreakAfter: "always", borderBottom: "1px dashed #bbb" }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>{settings.companyName || "Restaurant"}</div>
        <div style={{ fontWeight: 700, fontSize: 16, margin: "8px 0" }}>REÇU — PARTAGE DU SERVICE ET DES POURBOIRES</div>
        <div>Employé : <b>{l.name}</b>{l.poste ? " — " + rsPoste(l.poste) : ""}</div>
        <div>Période : {ecDateFr(p.from)} au {ecDateFr(p.to)} · Points : {l.points}</div>
        <div style={{ fontSize: 18, fontWeight: 700, margin: "10px 0" }}>Montant reçu : {rsM(l.amount)}</div>
        <div style={{ fontSize: 12 }}>Payé le {ecDateFr(p.date)} ({rsNomMode(p.mode)}).</div>
        <div style={{ marginTop: 28, fontSize: 12 }}>Signature de l'employé : ______________________</div></div>))}
    </div>
  );

  const Rapports = () => {
    const parJour = {};
    dansRp.forEach((o) => { const x = parJour[o.paidDate] || (parJour[o.paidDate] = { nb: 0, sous: 0, service: 0, tca: 0, tip: 0, tot: 0, esp: 0, ban: 0 }); x.nb++; x.sous += o.subtotal; x.service += o.service; x.tca += o.tca; x.tip += o.tip || 0; x.tot += o.total + (o.tip || 0); rsPaiements(o).forEach((p) => { if (p.mode === "banque") x.ban += p.amount; else x.esp += p.amount; }); });
    const jours = Object.keys(parJour).sort();
    const S = (f) => rsR2(jours.reduce((s, j) => s + f(parJour[j]), 0));
    const agr = (cle) => { const m = {}; dansRp.forEach((o) => o.lines.forEach((l) => { const k = cle(o, l); const x = m[k] || (m[k] = { qty: 0, total: 0 }); x.qty += l.qty; x.total = rsR2(x.total + l.qty * l.unit); })); return m; };
    const parPlat = agr((o, l) => l.label), parCat = agr((o, l) => nomCat((dishes.find((d) => d.id === l.dishId) || {}).cat || "?"));
    const parServ = {}, parTable = {}, parHeure = {};
    dansRp.forEach((o) => { const s = o.server || "—"; parServ[s] = rsR2((parServ[s] || 0) + o.subtotal); const tb = nomTable(o.tableId); parTable[tb] = rsR2((parTable[tb] || 0) + o.subtotal); const h = o.paidAt ? String(new Date(o.paidAt).getHours()).padStart(2, "0") + " h" : "—"; parHeure[h] = rsR2((parHeure[h] || 0) + o.subtotal); });
    const marge = dishes.map((d) => { const v = parPlat[d.name]; const c = coutPlat(d); return v && c > 0 ? { nom: d.name, qty: v.qty, ca: v.total, cout: rsR2(c * v.qty), marge: rsR2(v.total - c * v.qty) } : null; }).filter(Boolean).sort((a, b) => b.marge - a.marge);
    const exporter = () => ecTelecharger("journal-ventes-restauration-" + today + ".csv", [["Date", "Additions", "Sous-total", "Service", "TCA", "Pourboires", "Total encaissé", "Espèces", "Banque"], ...jours.map((j) => [ecDateFr(j), parJour[j].nb, rsR2(parJour[j].sous), rsR2(parJour[j].service), rsR2(parJour[j].tca), rsR2(parJour[j].tip), rsR2(parJour[j].tot), rsR2(parJour[j].esp), rsR2(parJour[j].ban)]), ["TOTAL", S((x) => x.nb), S((x) => x.sous), S((x) => x.service), S((x) => x.tca), S((x) => x.tip), S((x) => x.tot), S((x) => x.esp), S((x) => x.ban)]]);
    const liste = (titre, m, testid) => (<div className="mb-4"><div className="display text-base" style={{ color: "#152238" }}>{titre}</div><div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">{titre.replace("Ventes par ", "").replace(/^./, (c) => c.toUpperCase())}</th>{typeof Object.values(m)[0] === "object" && <th className="text-right">Vendus</th>}<th className="text-right">Chiffre d'affaires</th></tr></thead>
      <tbody>{Object.keys(m).sort((a, b) => (m[b].total !== undefined ? m[b].total - m[a].total : m[b] - m[a])).map((k) => (<tr key={k} data-testid={testid}><td className="py-1.5">{k}</td>{m[k].qty !== undefined && <td className="text-right tabular">{m[k].qty}</td>}<td className="text-right tabular">{rsM(m[k].total !== undefined ? m[k].total : m[k])}</td></tr>))}</tbody></table></div></div>);
    const attenduJour = rsR2(payees.filter((o) => o.paidDate === today).reduce((s, o) => s + rsPaiements(o).filter((p) => p.mode === "especes").reduce((a, p) => a + p.amount, 0), 0));
    const clotureJour = closings.find((c) => c.date === today);
    return (
      <div>
        <div className="ec-card p-4 mb-4"><div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
          <div>{lab("Du")}<input type="date" value={rp.from} onChange={(e) => setRp({ ...rp, from: e.target.value })} data-testid="resto-rp-du" className={ecInput} style={ecBorder} /></div>
          <div>{lab("Au")}<input type="date" value={rp.to} onChange={(e) => setRp({ ...rp, to: e.target.value })} data-testid="resto-rp-au" className={ecInput} style={ecBorder} /></div>
          <div><button onClick={exporter} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="resto-rapport-export">Exporter le journal (CSV)</button></div>
        </div></div>
        <div className="display text-base" style={{ color: "#152238" }}>Journal des ventes par jour</div>
        <div className="ec-wrap mb-5"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th className="text-right">Additions</th><th className="text-right">Sous-total</th><th className="text-right">Service</th><th className="text-right">TCA</th><th className="text-right">Pourboires</th><th className="text-right">Total encaissé</th><th className="text-right">Espèces</th><th className="text-right">Banque</th></tr></thead>
          <tbody>{jours.map((j) => (<tr key={j} data-testid="resto-journal-ligne"><td className="py-1.5">{ecDateFr(j)}</td><td className="text-right tabular">{parJour[j].nb}</td><td className="text-right tabular">{rsM(parJour[j].sous)}</td><td className="text-right tabular">{rsM(parJour[j].service)}</td><td className="text-right tabular">{rsM(parJour[j].tca)}</td><td className="text-right tabular">{rsM(parJour[j].tip)}</td><td className="text-right tabular">{rsM(parJour[j].tot)}</td><td className="text-right tabular">{rsM(parJour[j].esp)}</td><td className="text-right tabular">{rsM(parJour[j].ban)}</td></tr>))}
            {jours.length > 0 && <tr className="font-semibold" style={{ borderTop: "2px solid #152238" }} data-testid="resto-journal-total"><td className="py-1.5">TOTAL</td><td className="text-right tabular" data-testid="resto-jt-nb">{S((x) => x.nb)}</td><td className="text-right tabular" data-testid="resto-jt-sous">{rsM(S((x) => x.sous))}</td><td className="text-right tabular" data-testid="resto-jt-service">{rsM(S((x) => x.service))}</td><td className="text-right tabular">{rsM(S((x) => x.tca))}</td><td className="text-right tabular" data-testid="resto-jt-tip">{rsM(S((x) => x.tip))}</td><td className="text-right tabular" data-testid="resto-jt-total">{rsM(S((x) => x.tot))}</td><td className="text-right tabular">{rsM(S((x) => x.esp))}</td><td className="text-right tabular">{rsM(S((x) => x.ban))}</td></tr>}</tbody></table></div>
        {jours.length === 0 && <div className="text-sm mb-4" style={{ color: "#8A8370" }}>Aucune addition encaissée sur cette période.</div>}
        {liste("Ventes par plat", parPlat, "resto-rapport-plat")}
        {liste("Ventes par catégorie", parCat, "resto-rapport-cat")}
        {liste("Ventes par serveur", parServ, "resto-rapport-serveur")}
        {liste("Ventes par table", parTable, "resto-rapport-table")}
        {liste("Ventes par heure (heures de pointe)", parHeure, "resto-rapport-heure")}
        {marge.length > 0 && (<div className="mb-4"><div className="display text-base" style={{ color: "#152238" }}>Marge par plat (plats avec recette)</div><div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Plat</th><th className="text-right">Vendus</th><th className="text-right">Chiffre d'affaires</th><th className="text-right">Coût des ingrédients</th><th className="text-right">Marge</th></tr></thead>
          <tbody>{marge.map((m) => (<tr key={m.nom} data-testid="resto-marge-ligne"><td className="py-1.5">{m.nom}</td><td className="text-right tabular">{m.qty}</td><td className="text-right tabular">{rsM(m.ca)}</td><td className="text-right tabular">{rsM(m.cout)}</td><td className="text-right tabular">{rsM(m.marge)}</td></tr>))}</tbody></table></div></div>)}
        <div className="ec-card p-4" data-testid="resto-cloture"><div className="display text-base mb-2" style={{ color: "#152238" }}>Clôture de caisse du jour</div>
          <div className="text-sm mb-2">Espèces attendues aujourd'hui (additions payées en espèces) : <b className="tabular" data-testid="resto-cloture-attendu">{rsM(attenduJour)}</b></div>
          {canFront && (<div className="flex flex-wrap items-end gap-2"><div>{lab("Espèces comptées dans la caisse")}<input type="number" min="0" step="0.01" value={compte} onChange={(e) => setCompte(e.target.value)} data-testid="resto-cloture-compte" className={ecInput + " tabular"} style={ecBorder} /></div><button onClick={cloturerCaisse} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="resto-cloture-valider">Clôturer la caisse</button></div>)}
          {clotureJour && <div className="text-sm mt-2" data-testid="resto-cloture-resultat">Clôturée : compté {rsM(clotureJour.counted)}, écart <b>{rsM(clotureJour.ecart)}</b>{Math.abs(clotureJour.ecart) > 0.005 ? " — notez la cause et parlez-en à votre comptable." : " — la caisse est juste."}</div>}
        </div>
      </div>
    );
  };

  const Stats = () => {
    const mois = statMois(6, today);
    const data = mois.map((m) => ({ mois: m.label, ventes: statSomme(payees, "paidDate", m.key, (o) => o.subtotal), additions: statSomme(payees, "paidDate", m.key, () => 1) }));
    const moisCourant = payees.filter((o) => String(o.paidDate).startsWith(today.slice(0, 7)));
    const ca = rsR2(moisCourant.reduce((s, o) => s + o.subtotal, 0));
    const tips = rsR2(moisCourant.reduce((s, o) => s + (o.tip || 0), 0));
    const parCat = {}; moisCourant.forEach((o) => o.lines.forEach((l) => { const k = nomCat((dishes.find((d) => d.id === l.dishId) || {}).cat || "?"); parCat[k] = rsR2((parCat[k] || 0) + l.qty * l.unit); }));
    const parMode = {}; moisCourant.forEach((o) => rsPaiements(o).forEach((p) => { const k = rsNomMode(p.mode); parMode[k] = rsR2((parMode[k] || 0) + p.amount); }));
    const parServ = {}; moisCourant.forEach((o) => { const k = o.server || "—"; parServ[k] = rsR2((parServ[k] || 0) + o.subtotal); });
    return <StatsBloc
      vide={payees.length === 0 ? "Aucune addition encaissée pour le moment : les statistiques apparaîtront avec vos premières ventes." : ""}
      kpis={[["Ventes du mois", rsM(ca), "resto-stat-ventes"], ["Additions du mois", String(moisCourant.length), "resto-stat-additions"], ["Panier moyen", rsM(moisCourant.length ? ca / moisCourant.length : 0), "resto-stat-panier"], ["Pourboires du mois", rsM(tips), "resto-stat-tips"]]}
      evolution={{ titre: "Ventes — 6 derniers mois", data, series: [{ key: "ventes", name: "Ventes", color: "#9A7B1E" }] }}
      repartitions={[{ titre: "Ventes par catégorie (mois)", data: Object.keys(parCat).map((k) => ({ name: k, value: parCat[k] })) }, { titre: "Modes de paiement (mois)", data: Object.keys(parMode).map((k) => ({ name: k, value: parMode[k] })) }, { titre: "Ventes par serveur (mois)", data: Object.keys(parServ).map((k) => ({ name: k, value: parServ[k] })) }]} />;
  };

  const tabs = [["apercu", "Tableau de bord"], ["salle", "Salle et commandes"], ["factures", "Factures"], ["menu", "Menu"], ["recettes", "Recettes et coûts"], ...(isVendeur ? [] : [["personnel", "Personnel"], ["service", "Service et pourboires"], ["rapports", "Rapports"], ["stats", "Statistiques"]])];
  const impressionActive = imprimer || recusImp || carteApercu;
  return (
    <>
      <div className={"p-4 md:p-8 max-w-6xl" + (impressionActive ? " no-print" : "")} data-testid="resto-module">
        <style>{EC_CSS + '[data-testid="resto-module"] .display.text-base{border-left:3px solid #C9A24B;padding-left:10px;margin-bottom:12px}[data-testid="resto-module"] input,[data-testid="resto-module"] select{background:#fff}'}</style>
        <div className="mb-4"><div className="display text-2xl" style={{ color: "#152238" }}>Restauration</div><div className="text-xs" style={{ color: "#8A8370" }}>Salle et commandes, menu illustré, coût des plats, factures, personnel et partage du service</div></div>
        {!canFront && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }}>Consultation seule : votre rôle ne permet pas de modifier les données.</div>}
        {isVendeur && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }} data-testid="resto-serveur-note">Serveur / caissier : vous pouvez prendre les commandes, les envoyer en cuisine et encaisser. Le menu, les tables, le personnel et le partage du service sont réservés à l'administrateur.</div>}
        <div className="ec-tabs">
          {tabs.map(([id, l]) => (<button key={id} onClick={() => setTab(id)} data-testid={"resto-tab-" + id} className="px-3 py-2 text-sm rounded-lg transition-colors" style={{ background: tab === id ? "#152238" : "transparent", color: tab === id ? "#EFE9DD" : "#5B563F" }}>{l}</button>))}
        </div>
        {tab === "apercu" && Apercu()}
        {tab === "salle" && Salle()}
        {tab === "factures" && Factures()}
        {tab === "menu" && Menu()}
        {tab === "recettes" && Recettes()}
        {tab === "personnel" && !isVendeur && Personnel()}
        {tab === "service" && !isVendeur && Service()}
        {tab === "rapports" && !isVendeur && Rapports()}
        {tab === "stats" && !isVendeur && Stats()}
      </div>
      {(imprimer || carteApercu || recusImp) && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto p-3 md:p-8 no-print" style={{ background: "rgba(21,34,56,0.55)" }} onClick={() => { setImprimer(null); setCarteApercu(false); setRecusImp(null); }} data-testid="resto-apercu">
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: imprimer && imprimer.ticket ? 340 : 820 }}>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap"><div className="text-sm" style={{ color: "#EFE9DD" }}>{imprimer ? "Facture " + imprimer.o.number : carteApercu ? "Carte du restaurant" : "Reçus du partage du service"}</div>
              <div className="flex gap-2 flex-wrap">
                {imprimer && <button onClick={() => setImprimer({ ...imprimer, ticket: !imprimer.ticket })} className="px-3 py-1.5 rounded text-sm" style={ecBtn} data-testid="resto-format">{imprimer.ticket ? "Passer en A4" : "Passer en ticket"}</button>}
                <button onClick={() => { try { window.print(); } catch (e) {} }} className="px-3 py-1.5 rounded text-sm" style={ecBtnGold} data-testid="resto-imprimer-ok">Imprimer / enregistrer en PDF</button>
                <button onClick={() => { setImprimer(null); setCarteApercu(false); setRecusImp(null); }} className="px-3 py-1.5 rounded text-sm" style={ecBtn} data-testid="resto-apercu-fermer">Fermer</button></div></div>
            <div className="rounded shadow-lg overflow-hidden" style={{ background: "#fff" }}>{imprimer ? <FactureSheet o={imprimer.o} ticket={imprimer.ticket} /> : carteApercu ? <CarteClient /> : <RecusSheet p={recusImp} />}</div>
          </div>
        </div>
      )}
      {(imprimer || carteApercu || recusImp) && <div className={"print-only" + (imprimer && imprimer.ticket ? " ticket-print-80" : "")}>{imprimer ? <FactureSheet o={imprimer.o} ticket={imprimer.ticket} /> : carteApercu ? <CarteClient /> : <RecusSheet p={recusImp} />}</div>}
    </>
  );
}

// ═══ MODULE ═══
// @module Hotellerie
// @depends EC_CSS, StatsBloc, ecBorder, ecBtn, ecBtnGold, ecDateFr, ecInput, ecPastille, ecTelecharger
//   isFutureDate, isLocked, statMois, statSomme, todayStr, uid, useState
// @exports HotelModule
// ═══ FIN DE L'EN-TÊTE ═══
// Bloc Hôtellerie : types de chambres et tarifs, chambres et ménage, planning, réservations (arrivée, départ), acomptes, services annexes,
// clients, factures de séjour imprimables (A4 ou ticket), rapports et statistiques. Rien n'est préréglé : tarifs, taxe de séjour, services
// et TCA sont des RÉGLAGES saisis par l'établissement (désactivés tant qu'il ne les active pas).
//
// Comptabilité :
//  • acompte reçu (à la réservation ou pendant le séjour) : Débit caisse ou banque / Crédit 4191 « acomptes reçus des clients » ;
//  • départ (facturation du séjour) : Débit caisse ou banque (solde) et 4191 (acomptes déduits) / Crédit 7076 hébergement, 7077 services annexes,
//    4476 taxe de séjour à reverser (si activée), 445 TCA (si activée) ; une chambre n'est donc un revenu qu'au départ du client ;
//  • annulation ou absence avec acompte : soit remboursement (Débit 4191 / Crédit caisse ou banque), soit acompte conservé
//    (Débit 4191 / Crédit 7078 indemnités d'annulation conservées). Comptes et traitement fiscal à confirmer avec l'expert-comptable.
// Toutes les données sont dans une seule catégorie « hotel » (types : config, roomtype, room, guest, booking).

const HO_COMPTES = {
  "530": { name: "Caisse", type: "Actif" },
  "512": { name: "Banque", type: "Actif" },
  "4191": { name: "Clients — acomptes reçus", type: "Passif" },
  "7076": { name: "Ventes d'hébergement", type: "Produit" },
  "7077": { name: "Services annexes de l'hôtel", type: "Produit" },
  "7078": { name: "Indemnités d'annulation conservées", type: "Produit" },
  "4476": { name: "Taxe de séjour à reverser", type: "Passif" },
  "445": { name: "Taxe collectée sur ventes (IVA/TCA)", type: "Passif" },
};
const HO_MODES = [["especes", "Espèces"], ["banque", "Banque / carte"]];
const HO_MENAGE = [["propre", "Propre"], ["sale", "À nettoyer"], ["maintenance", "Hors service"]];
const hoR2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const hoM = (n) => hoR2(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " G";
const hoId = () => String(uid());
const hoRows = (rows, type) => (rows || []).filter((r) => r && r.type === type);
const hoNomMode = (m) => (HO_MODES.find((x) => x[0] === m) || [0, m])[1];
const hoD = (iso) => new Date(String(iso).slice(0, 10) + "T12:00:00");
const hoJours = (a, b) => Math.round((hoD(b) - hoD(a)) / 86400000);
const hoAdd = (iso, n) => { const d = hoD(iso); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const hoCourt = (iso) => { const d = hoD(iso); return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0"); };
const hoActive = (b) => b.status === "reservee" || b.status === "arrivee";
function hoAjouterComptes(accounts, setAccounts, codes) {
  const missing = [...new Set(codes)].filter((k) => HO_COMPTES[k] && !accounts.some((a) => a.code === k)).map((k) => ({ code: k, name: HO_COMPTES[k].name, type: HO_COMPTES[k].type }));
  if (missing.length) setAccounts((prev) => [...prev, ...missing.filter((m) => !prev.some((a) => a.code === m.code))]);
}
function hoRedimensionner(file, max) {
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

function HotelModule({ hotel, setHotel, entries, setEntries, accounts, setAccounts, settings, role, showToast, logAudit, currentUserEmail }) {
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const isVendeur = role === "Vendeur"; // réception : réservations, arrivées, départs, encaissements
  const canFront = canEdit || isVendeur;
  const today = todayStr();
  const [tab, setTab] = useState("apercu");
  const types = hoRows(hotel, "roomtype");
  const rooms = hoRows(hotel, "room").sort((a, b) => String(a.number).localeCompare(String(b.number), "fr", { numeric: true }));
  const guests = hoRows(hotel, "guest");
  const bookings = hoRows(hotel, "booking");
  const cfg = rsCfg();
  function rsCfg() { const c = hoRows(hotel, "config")[0] || {}; return { tcaOn: !!c.tcaOn, sejourOn: !!c.sejourOn, sejour: Number(c.sejour) || 0, services: c.services || [] }; }
  const tcaRate = cfg.tcaOn ? Number(settings.taxRate) || 0 : 0;
  const nomType = (id) => (types.find((t) => t.id === id) || {}).name || "—";
  const roomDe = (id) => rooms.find((r) => r.id === id) || {};
  const nomChambre = (id) => { const r = roomDe(id); return r.number ? "Chambre " + r.number : "—"; };
  const guestDe = (id) => guests.find((g) => g.id === id) || {};
  const maj = (id, fn) => setHotel((prev) => (prev || []).map((r) => (r.id === id ? fn(r) : r)));
  const compteMode = (m) => (m === "banque" ? "512" : "530");
  const ecrire = (date, label, lines, dossierId) => {
    const e = { id: uid(), date, createdAt: new Date().toISOString(), label, lines: lines.filter((l) => l.debit > 0 || l.credit > 0), kind: "hotel", dossierId };
    setEntries((prev) => [...prev, e]);
    return e;
  };
  const verifDate = (date, action) => {
    if (!date || isFutureDate(date)) { showToast("La date ne peut pas être dans le futur."); return false; }
    if (isLocked(date, settings)) { showToast("La période comptable est clôturée jusqu'au " + settings.lockDate + " inclus : impossible de " + action + " à cette date."); return false; }
    return true;
  };
  const numero = (prefixe, liste, champ, date) => {
    const yy = String((date || today).slice(0, 4));
    const n = liste.filter((r) => String(r[champ] || "").startsWith(prefixe + "-" + yy + "-")).reduce((m, r) => Math.max(m, Number(String(r[champ]).split("-")[2]) || 0), 0) + 1;
    return prefixe + "-" + yy + "-" + String(n).padStart(4, "0");
  };
  const libre = (roomId, from, to, sauf) => !bookings.some((b) => b.id !== sauf && b.roomId === roomId && hoActive(b) && b.from < to && b.to > from);
  const acomptesDe = (b) => hoR2((b.deposits || []).reduce((s, d) => s + (Number(d.amount) || 0), 0));
  const calcSejour = (b, depart) => {
    const nuits = Math.max(1, hoJours(b.from, depart));
    const heberg = hoR2(nuits * (Number(b.rate) || 0));
    const services = hoR2((b.extras || []).reduce((s, x) => s + (Number(x.qty) || 0) * (Number(x.unit) || 0), 0));
    const sejour = cfg.sejourOn ? hoR2(nuits * (Number(b.adults) || 1) * cfg.sejour) : 0;
    const tca = hoR2((heberg + services) * tcaRate / 100);
    return { nuits, heberg, services, sejour, tca, total: hoR2(heberg + services + sejour + tca) };
  };
  const factures = bookings.filter((b) => b.invoice);
  const factPayees = factures.filter((b) => b.invoice.status !== "annulee");

  // ───────── Réglages, services ─────────
  const ecrireCfg = (patch) => setHotel((prev) => [...(prev || []).filter((x) => x.type !== "config"), { type: "config", id: "config", ...rsCfg(), ...patch }]);
  const [fr, setFr] = useState(null);
  const reg = fr || { tcaOn: cfg.tcaOn, sejourOn: cfg.sejourOn, sejour: String(cfg.sejour || "") };
  const saveCfg = () => {
    if (!canEdit) return;
    const s = Number(reg.sejour) || 0;
    if (reg.sejourOn && !(s > 0)) { showToast("Indiquez le montant de la taxe de séjour (par adulte et par nuit), ou décochez-la."); return; }
    ecrireCfg({ tcaOn: !!reg.tcaOn, sejourOn: !!reg.sejourOn, sejour: s });
    setFr(null);
    showToast("Réglages enregistrés" + (reg.sejourOn ? " : taxe de séjour " + hoM(s) + " par adulte et par nuit" : "") + (reg.tcaOn ? ", TCA " + (Number(settings.taxRate) || 0) + " %." : "."));
    logAudit("Hôtellerie", "Réglages modifiés", "");
  };
  const [fsv, setFsv] = useState({ label: "", price: "" });
  const addService = () => {
    if (!canEdit) return;
    const label = fsv.label.trim(), price = Number(fsv.price);
    if (!label) { showToast("Donnez un nom au service (ex. Petit-déjeuner, Blanchisserie)."); return; }
    if (!(price >= 0) || fsv.price === "") { showToast("Indiquez le prix du service."); return; }
    if (cfg.services.some((s) => s.label.toLowerCase() === label.toLowerCase())) { showToast("Ce service existe déjà."); return; }
    ecrireCfg({ services: [...cfg.services, { id: hoId(), label, price: hoR2(price) }] });
    setFsv({ label: "", price: "" });
    showToast("Service « " + label + " » ajouté.");
  };
  const delService = (s) => { if (canEdit) ecrireCfg({ services: cfg.services.filter((x) => x.id !== s.id) }); };

  // ───────── Types de chambres et chambres ─────────
  const vide = { id: "", name: "", capacity: "2", price: "", desc: "", photo: "" };
  const [ft, setFt] = useState(vide);
  const choisirPhoto = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try { const url = await hoRedimensionner(f, 420); setFt((x) => ({ ...x, photo: url })); showToast("Photo ajoutée (réduite à 420 px pour rester légère)."); }
    catch (err) { showToast("Cette image n'a pas pu être lue. Essayez un fichier JPG ou PNG."); }
  };
  const saveType = () => {
    if (!canEdit) return;
    const name = ft.name.trim(), price = Number(ft.price), cap = Math.round(Number(ft.capacity));
    if (!name) { showToast("Donnez un nom au type de chambre (ex. Simple, Double, Suite)."); return; }
    if (!(price > 0)) { showToast("Indiquez le tarif par nuit (supérieur à zéro)."); return; }
    if (!(cap >= 1)) { showToast("Indiquez le nombre de personnes (au moins 1)."); return; }
    if (types.some((t) => t.id !== ft.id && t.name.toLowerCase() === name.toLowerCase())) { showToast("Ce type existe déjà."); return; }
    if (ft.id) maj(ft.id, (r) => ({ ...r, name, capacity: cap, price: hoR2(price), desc: ft.desc.trim(), photo: ft.photo }));
    else setHotel((prev) => [...(prev || []), { type: "roomtype", id: hoId(), name, capacity: cap, price: hoR2(price), desc: ft.desc.trim(), photo: ft.photo }]);
    showToast("Type « " + name + " » " + (ft.id ? "modifié" : "ajouté") + ". Le tarif d'une réservation existante ne change pas.");
    logAudit("Hôtellerie", ft.id ? "Type de chambre modifié" : "Type de chambre ajouté", name + " — " + hoM(price));
    setFt(vide);
  };
  const delType = (t) => {
    if (!canEdit) return;
    if (rooms.some((r) => r.typeId === t.id)) { showToast("Des chambres utilisent ce type : changez-les ou supprimez-les d'abord."); return; }
    setHotel((prev) => (prev || []).filter((r) => r.id !== t.id));
  };
  const [fch, setFch] = useState({ number: "", typeId: "" });
  const addRoom = () => {
    if (!canEdit) return;
    const number = fch.number.trim();
    if (!number) { showToast("Indiquez le numéro de la chambre."); return; }
    if (!fch.typeId) { showToast("Choisissez le type de la chambre."); return; }
    if (rooms.some((r) => String(r.number).toLowerCase() === number.toLowerCase())) { showToast("Ce numéro de chambre existe déjà."); return; }
    setHotel((prev) => [...(prev || []), { type: "room", id: hoId(), number, typeId: fch.typeId, menage: "propre" }]);
    setFch({ number: "", typeId: fch.typeId });
    showToast("Chambre " + number + " ajoutée.");
  };
  const delRoom = (r) => {
    if (!canEdit) return;
    if (bookings.some((b) => b.roomId === r.id && hoActive(b))) { showToast("Cette chambre a une réservation ou un séjour en cours."); return; }
    setHotel((prev) => (prev || []).filter((x) => x.id !== r.id));
  };
  const setMenage = (r, v) => { if (canFront) maj(r.id, (x) => ({ ...x, menage: v })); };

  // ───────── Clients ─────────
  const [fg, setFg] = useState({ name: "", phone: "", email: "", idDoc: "" });
  const addGuest = () => {
    if (!canFront) return null;
    const name = fg.name.trim();
    if (!name) { showToast("Indiquez le nom du client."); return null; }
    const tel = fg.phone.replace(/\D/g, "");
    const dup = guests.find((g) => g.name.toLowerCase() === name.toLowerCase() && (g.phone || "").replace(/\D/g, "") === tel);
    if (dup) { showToast("Ce client existe déjà (même nom et même téléphone)."); return null; }
    const id = hoId();
    setHotel((prev) => [...(prev || []), { type: "guest", id, name, phone: fg.phone.trim(), email: fg.email.trim(), idDoc: fg.idDoc.trim() }]);
    setFg({ name: "", phone: "", email: "", idDoc: "" });
    showToast("Client « " + name + " » enregistré.");
    return id;
  };

  // ───────── Réservations ─────────
  const [rv, setRv] = useState({ guestId: "", roomId: "", from: today, to: hoAdd(today, 1), adults: "1", children: "0", rate: "", depAmount: "", depMode: "especes", notes: "" });
  const [sel, setSel] = useState("");
  const dispoChambres = rooms.filter((r) => r.menage !== "maintenance" && libre(r.id, rv.from, rv.to));
  const choisirChambre = (roomId) => { const r = roomDe(roomId); const t = types.find((x) => x.id === r.typeId); setRv({ ...rv, roomId, rate: t ? String(t.price) : rv.rate }); };
  const reserver = (pre) => {
    if (!canFront) return;
    const v = pre || rv;
    const room = roomDe(v.roomId);
    if (!v.guestId) { showToast("Choisissez le client (ou créez sa fiche dans l'onglet « Clients »)."); return; }
    if (!room.id) { showToast("Choisissez une chambre."); return; }
    if (!(v.to > v.from)) { showToast("La date de départ doit être après la date d'arrivée."); return; }
    if (v.from < today) { showToast("La date d'arrivée ne peut pas être dans le passé."); return; }
    if (!libre(room.id, v.from, v.to)) { showToast("Cette chambre est déjà prise sur ces dates."); return; }
    const rate = Number(v.rate), adults = Math.round(Number(v.adults)), children = Math.round(Number(v.children) || 0);
    if (!(rate > 0)) { showToast("Indiquez le tarif par nuit."); return; }
    if (!(adults >= 1)) { showToast("Indiquez au moins un adulte."); return; }
    const t = types.find((x) => x.id === room.typeId);
    if (t && adults + children > t.capacity) { showToast("Cette chambre accueille " + t.capacity + " personne(s) au maximum."); return; }
    const dep = hoR2(Number(v.depAmount) || 0);
    if (dep < 0) { showToast("L'acompte ne peut pas être négatif."); return; }
    if (dep > 0 && !verifDate(today, "encaisser un acompte")) return;
    const id = hoId();
    const b = { type: "booking", id, number: numero("RS", bookings, "number", today), guestId: v.guestId, roomId: room.id, from: v.from, to: v.to, adults, children, rate: hoR2(rate), status: "reservee", extras: [], deposits: [], notes: (v.notes || "").trim(), createdAt: new Date().toISOString(), by: currentUserEmail || "" };
    if (dep > 0) {
      hoAjouterComptes(accounts, setAccounts, [compteMode(v.depMode), "4191"]);
      const e = ecrire(today, "Acompte réservation " + b.number + " — " + guestDe(v.guestId).name, [{ account: compteMode(v.depMode), debit: dep, credit: 0 }, { account: "4191", debit: 0, credit: dep }], id);
      b.deposits.push({ id: hoId(), date: today, amount: dep, mode: v.depMode, entryId: e.id, status: "valide" });
    }
    setHotel((prev) => [...(prev || []), b]);
    setRv({ guestId: v.guestId, roomId: "", from: v.from, to: v.to, adults: "1", children: "0", rate: "", depAmount: "", depMode: "especes", notes: "" });
    setSel(id);
    showToast("Réservation " + b.number + " enregistrée : " + nomChambre(room.id) + ", " + hoJours(v.from, v.to) + " nuit(s)" + (dep > 0 ? ", acompte " + hoM(dep) : "") + ".");
    logAudit("Hôtellerie", "Réservation créée", b.number);
  };
  const arrivee = (b) => {
    if (!canFront || b.status !== "reservee") return;
    if (b.from > today) { showToast("L'arrivée est prévue le " + ecDateFr(b.from) + " : vous ne pouvez pas enregistrer l'arrivée avant cette date."); return; }
    const r = roomDe(b.roomId);
    if (r.menage === "maintenance") { showToast("La chambre est hors service."); return; }
    if (r.menage === "sale") { showToast("La chambre est à nettoyer : marquez-la « Propre » dans l'onglet « Chambres et tarifs » quand le ménage est fait."); return; }
    maj(b.id, (x) => ({ ...x, status: "arrivee", arrivedAt: new Date().toISOString() }));
    showToast("Arrivée enregistrée : " + guestDe(b.guestId).name + ", " + nomChambre(b.roomId) + ".");
    logAudit("Hôtellerie", "Arrivée", b.number);
  };
  const [dp, setDp] = useState({ amount: "", mode: "especes" });
  const addDeposit = (b) => {
    if (!canFront || !hoActive(b)) return;
    const a = hoR2(Number(dp.amount));
    if (!(a > 0)) { showToast("Indiquez le montant de l'acompte."); return; }
    if (!verifDate(today, "encaisser un acompte")) return;
    hoAjouterComptes(accounts, setAccounts, [compteMode(dp.mode), "4191"]);
    const e = ecrire(today, "Acompte " + b.number + " — " + guestDe(b.guestId).name, [{ account: compteMode(dp.mode), debit: a, credit: 0 }, { account: "4191", debit: 0, credit: a }], b.id);
    maj(b.id, (x) => ({ ...x, deposits: [...(x.deposits || []), { id: hoId(), date: today, amount: a, mode: dp.mode, entryId: e.id, status: "valide" }] }));
    setDp({ amount: "", mode: dp.mode });
    showToast("Acompte de " + hoM(a) + " encaissé.");
  };
  const [ex, setEx] = useState({ serviceId: "", qty: "1", label: "", unit: "" });
  const addExtra = (b) => {
    if (!canFront || b.status !== "arrivee") { showToast("Les services s'ajoutent pendant le séjour (après l'arrivée)."); return; }
    const qty = Math.round(Number(ex.qty));
    if (!(qty >= 1)) { showToast("Indiquez la quantité."); return; }
    let label, unit;
    if (ex.serviceId) { const s = cfg.services.find((x) => x.id === ex.serviceId); if (!s) { showToast("Choisissez un service."); return; } label = s.label; unit = s.price; }
    else { label = ex.label.trim(); unit = Number(ex.unit); if (!label || !(unit >= 0) || ex.unit === "") { showToast("Choisissez un service dans la liste, ou saisissez un libellé et un prix."); return; } }
    maj(b.id, (x) => ({ ...x, extras: [...(x.extras || []), { id: hoId(), date: today, label, qty, unit: hoR2(unit) }] }));
    setEx({ serviceId: "", qty: "1", label: "", unit: "" });
    showToast(label + " ajouté au séjour.");
  };
  const delExtra = (b, id) => { if (canFront && b.status === "arrivee") maj(b.id, (x) => ({ ...x, extras: x.extras.filter((e) => e.id !== id) })); };
  const [an, setAn] = useState({ raison: "annulation", acompte: "rembourser" });
  const annuler = (b) => {
    if (!canFront || b.status !== "reservee") return;
    const dep = acomptesDe(b);
    if (dep > 0 && !verifDate(today, "traiter l'acompte")) return;
    if (dep > 0) {
      const compte = compteMode((b.deposits[b.deposits.length - 1] || {}).mode);
      hoAjouterComptes(accounts, setAccounts, [compte, "4191", "7078"]);
      if (an.acompte === "rembourser") ecrire(today, "Remboursement acompte " + b.number, [{ account: "4191", debit: dep, credit: 0 }, { account: compte, debit: 0, credit: dep }], b.id);
      else ecrire(today, "Acompte conservé " + b.number + " (annulation)", [{ account: "4191", debit: dep, credit: 0 }, { account: "7078", debit: 0, credit: dep }], b.id);
    }
    maj(b.id, (x) => ({ ...x, status: an.raison === "absent" ? "absent" : "annulee", cancelledAt: today, acompteTraite: dep > 0 ? an.acompte : "" }));
    showToast("Réservation " + b.number + (an.raison === "absent" ? " marquée « client absent »" : " annulée") + (dep > 0 ? " ; acompte " + (an.acompte === "rembourser" ? "remboursé" : "conservé") + "." : "."));
    logAudit("Hôtellerie", "Réservation annulée", b.number);
  };

  // ───────── Départ et facture ─────────
  const [dep, setDep] = useState({ date: today, rows: [{ mode: "especes", amount: "" }] });
  const [imprimer, setImprimer] = useState(null);
  const partir = (b) => {
    if (!canFront || b.status !== "arrivee") return;
    const depart = dep.date;
    if (!depart || depart < b.from) { showToast("La date de départ ne peut pas être avant la date d'arrivée (" + ecDateFr(b.from) + "). Choisissez le " + ecDateFr(b.from) + " ou une date entre cette date et aujourd'hui."); return; }
    if (depart > today) { showToast("Le départ s'enregistre le jour où le client part (au plus tard aujourd'hui) : choisissez une date entre le " + ecDateFr(b.from) + " et aujourd'hui."); return; }
    if (!verifDate(depart, "facturer le séjour")) return;
    const t = calcSejour(b, depart);
    const ac = acomptesDe(b);
    const reste = hoR2(t.total - ac);
    if (reste < -0.005) { showToast("Les acomptes (" + hoM(ac) + ") dépassent le total du séjour (" + hoM(t.total) + ") : remboursez d'abord la différence au client, puis refaites le départ."); return; }
    let pays = [];
    if (reste > 0.005) {
      if (dep.rows.length === 1) pays = [{ mode: dep.rows[0].mode, amount: reste }];
      else {
        pays = dep.rows.map((r) => ({ mode: r.mode, amount: hoR2(Number(r.amount) || 0) }));
        if (pays.some((p) => !(p.amount > 0))) { showToast("Chaque paiement doit avoir un montant supérieur à zéro (ou retirez la ligne)."); return; }
        const s = hoR2(pays.reduce((a, p) => a + p.amount, 0));
        if (Math.abs(s - reste) > 0.005) { showToast("Les paiements totalisent " + hoM(s) + " mais le solde à payer est de " + hoM(reste) + "."); return; }
      }
    }
    const credits = [{ account: "7076", debit: 0, credit: t.heberg }];
    if (t.services > 0) credits.push({ account: "7077", debit: 0, credit: t.services });
    if (t.sejour > 0) credits.push({ account: "4476", debit: 0, credit: t.sejour });
    if (t.tca > 0) credits.push({ account: "445", debit: 0, credit: t.tca });
    const debits = {};
    pays.forEach((p) => { const c = compteMode(p.mode); debits[c] = hoR2((debits[c] || 0) + p.amount); });
    if (ac > 0) debits["4191"] = ac;
    hoAjouterComptes(accounts, setAccounts, [...Object.keys(debits), ...credits.map((c) => c.account)]);
    const number = numero("FH", factures.map((x) => ({ n: x.invoice.number })), "n", depart);
    const e = ecrire(depart, "Séjour " + b.number + " — " + guestDe(b.guestId).name + " — " + nomChambre(b.roomId), [...Object.keys(debits).map((c) => ({ account: c, debit: debits[c], credit: 0 })), ...credits], b.id);
    const invoice = { number, date: depart, status: "payee", nights: t.nuits, rate: b.rate, adults: b.adults, heberg: t.heberg, services: t.services, sejour: t.sejour, sejourRate: cfg.sejourOn ? cfg.sejour : 0, tca: t.tca, tcaRate, total: t.total, deposits: ac, payments: pays, entryId: e.id, by: currentUserEmail || "" };
    maj(b.id, (x) => ({ ...x, status: "partie", departed: depart, invoice }));
    if (roomDe(b.roomId).id) maj(b.roomId, (x) => ({ ...x, menage: "sale" }));
    setDep({ date: today, rows: [{ mode: "especes", amount: "" }] });
    showToast("Départ enregistré. Facture " + number + " : " + hoM(t.total) + (reste > 0.005 ? ", solde encaissé " + hoM(reste) : "") + ". La chambre est à nettoyer.");
    logAudit("Hôtellerie", "Séjour facturé", number + " — " + hoM(t.total));
    setImprimer({ b: { ...b, status: "partie", departed: depart, invoice }, ticket: false });
  };
  const annulerFacture = (b) => {
    if (!canEdit || !b.invoice || b.invoice.status === "annulee") return;
    if (!verifDate(today, "annuler la facture")) return;
    const e = (entries || []).find((x) => x.id === b.invoice.entryId);
    if (e) ecrire(today, "Annulation facture " + b.invoice.number, e.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })), b.id);
    maj(b.id, (x) => ({ ...x, status: "arrivee", invoice: { ...x.invoice, status: "annulee", cancelledAt: today }, invoiceHistory: [...(x.invoiceHistory || []), { ...x.invoice, status: "annulee", cancelledAt: today }] }));
    showToast("Facture " + b.invoice.number + " annulée : écritures contrepassées, le séjour est de nouveau en cours.");
    logAudit("Hôtellerie", "Facture annulée", b.invoice.number);
  };

  // ───────── Écrans ─────────
  const lab = (t) => <label className="text-xs" style={{ color: "#8A8370" }}>{t}</label>;
  const pastilleEtat = (b) => (b.status === "reservee" ? ecPastille("Réservée", "info") : b.status === "arrivee" ? (b.to < today ? ecPastille("Départ dépassé", "attente") : ecPastille("En séjour", "attente")) : b.status === "partie" ? ecPastille("Parti", "ok") : b.status === "absent" ? ecPastille("Absent", "neutre") : ecPastille("Annulée", "neutre"));
  const enSejour = bookings.filter((b) => b.status === "arrivee");
  const totalChambres = rooms.filter((r) => r.menage !== "maintenance").length;

  const Apercu = () => {
    const arrivees = bookings.filter((b) => b.status === "reservee" && b.from === today);
    const departs = enSejour.filter((b) => b.to <= today);
    const mois = today.slice(0, 7);
    const fm = factPayees.filter((b) => String(b.invoice.date).startsWith(mois));
    const ca = hoR2(fm.reduce((s, b) => s + b.invoice.heberg + b.invoice.services, 0));
    const nuits = fm.reduce((s, b) => s + b.invoice.nights, 0);
    const heberg = hoR2(fm.reduce((s, b) => s + b.invoice.heberg, 0));
    const taux = totalChambres ? Math.round(enSejour.length / totalChambres * 100) : 0;
    const guide = [
      ["Types de chambres", "Onglet Chambres et tarifs : créez vos types (nom, personnes, tarif par nuit).", "chambres", types.length > 0],
      ["Chambres", "Ajoutez vos chambres avec leur numéro et leur type.", "chambres", rooms.length > 0],
      ["Clients", "Onglet Clients : enregistrez votre premier client.", "clients", guests.length > 0],
      ["Réservation", "Onglet Réservations : choisissez le client, la chambre et les dates.", "resa", bookings.length > 0],
      ["Arrivée", "À l'arrivée du client, ouvrez la réservation et enregistrez son arrivée.", "resa", bookings.some((b) => b.status === "arrivee" || b.status === "partie")],
      ["Départ et facture", "Au départ, ajoutez les services, établissez la facture et encaissez.", "resa", factPayees.length > 0],
      ["Planning", "Onglet Planning : visualisez les chambres occupées, réservées ou hors service sur 14 jours.", "planning", bookings.length > 0],
    ];
    const guideFait = guide.every((e) => e[3]);
    const kpis = [["Chambres occupées", enSejour.length + " / " + totalChambres, "hotel-kpi-occupees"], ["Taux d'occupation du jour", taux + " %", "hotel-kpi-taux"], ["Arrivées prévues aujourd'hui", String(arrivees.length), "hotel-kpi-arrivees"], ["Départs prévus aujourd'hui", String(departs.length), "hotel-kpi-departs"], ["Ventes du mois (séjours facturés)", hoM(ca), "hotel-kpi-mois"], ["Prix moyen par nuit (mois)", hoM(nuits ? heberg / nuits : 0), "hotel-kpi-prixmoyen"]];
    const ligne = (b, bouton) => (<div key={b.id} className="flex items-center justify-between text-sm py-1" data-testid="hotel-ligne-jour"><span>{guestDe(b.guestId).name} — {nomChambre(b.roomId)} ({ecDateFr(b.from)} → {ecDateFr(b.to)})</span><button onClick={() => { setSel(b.id); setTab("resa"); }} className="text-xs underline">{bouton}</button></div>);
    return (
      <div>
        {(<div className="ec-card p-4 mb-5" data-testid="hotel-guide">
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Marche à suivre, en 7 étapes{guideFait ? " — toutes faites ✓" : ""}</div>
          <ol className="text-sm" style={{ color: "#152238", listStyle: "none", paddingLeft: 0 }}>{guide.map(([t, d, tb, fait], i) => (<li key={i} data-testid="hotel-etape" className="mb-1.5 flex flex-wrap gap-2 items-baseline"><span style={{ color: fait ? "#0F6B5C" : "#8A8370", fontWeight: 700 }}>{fait ? "✓" : (i + 1) + "."}</span><span><b>{t}</b> — <span style={{ color: "#5B563F" }}>{d}</span></span>{!fait && !(isVendeur && !["resa", "clients", "factures", "planning"].includes(tb)) && <button className="text-xs underline" data-testid="hotel-etape-ouvrir" onClick={() => setTab(tb)}>Ouvrir</button>}</li>))}</ol>
        </div>)}
        {types.length + rooms.length === 0 && <div className="p-4 rounded text-sm mb-4" style={{ background: "#FFF6E0", color: "#152238" }} data-testid="hotel-vide">Pour commencer, dans cet ordre : <b>1.</b> onglet <b>Chambres et tarifs</b> : créez vos types de chambres (nom, personnes, tarif par nuit) · <b>2.</b> ajoutez vos chambres (numéro et type) · <b>3.</b> facultatif : vos services (petit-déjeuner, blanchisserie…), la taxe de séjour et la TCA · <b>4.</b> onglet <b>Clients</b> : enregistrez un client · <b>5.</b> onglet <b>Réservations</b> : créez une réservation.</div>}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
          {kpis.map(([l, v, t]) => (<div key={t} className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>{l}</div><div className="display text-lg tabular" data-testid={t} style={{ color: "#152238" }}>{v}</div></div>))}
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="ec-card p-4"><div className="display text-base mb-2" style={{ color: "#152238" }}>Arrivées du jour</div>{arrivees.map((b) => ligne(b, "Ouvrir"))}{arrivees.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucune arrivée prévue aujourd'hui.</div>}</div>
          <div className="ec-card p-4"><div className="display text-base mb-2" style={{ color: "#152238" }}>Départs du jour (et départs dépassés)</div>{departs.map((b) => ligne(b, "Ouvrir"))}{departs.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun départ prévu aujourd'hui.</div>}</div>
        </div>
      </div>
    );
  };

  const [debutPlan, setDebutPlan] = useState(today);
  const Planning = () => {
    const jours = Array.from({ length: 14 }, (_, i) => hoAdd(debutPlan, i));
    const occ = (r, j) => bookings.find((b) => b.roomId === r.id && hoActive(b) && b.from <= j && b.to > j);
    return (
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button onClick={() => setDebutPlan(hoAdd(debutPlan, -7))} className="px-3 py-1.5 rounded text-sm" style={ecBtn}>← 7 jours</button>
          <button onClick={() => setDebutPlan(today)} className="px-3 py-1.5 rounded text-sm" style={ecBtn}>Aujourd'hui</button>
          <button onClick={() => setDebutPlan(hoAdd(debutPlan, 7))} className="px-3 py-1.5 rounded text-sm" style={ecBtn}>7 jours →</button>
          <span className="text-xs" style={{ color: "#7A7460" }}>Bleu : réservée · Orange : en séjour · Gris : chambre hors service. Touchez une case occupée pour ouvrir la réservation.</span>
        </div>
        <div className="ec-wrap"><table className="ec-table" data-testid="hotel-planning"><thead><tr className="text-xs" style={{ color: "#8A8370" }}><th className="py-1 text-left">Chambre</th>{jours.map((j) => <th key={j} style={{ minWidth: 46, textAlign: "center", background: j === today ? "#FFF6E0" : undefined }}>{hoCourt(j)}</th>)}</tr></thead>
          <tbody>{rooms.map((r) => (<tr key={r.id} data-testid="hotel-planning-ligne"><td className="py-1 whitespace-nowrap text-sm">{r.number} <span className="text-xs" style={{ color: "#8A8370" }}>{nomType(r.typeId)}</span></td>
            {jours.map((j) => { const b = occ(r, j); return (<td key={j} style={{ padding: 2 }}>{b ? <button onClick={() => { setSel(b.id); setTab("resa"); }} title={guestDe(b.guestId).name} data-testid="hotel-case-occupee" style={{ width: "100%", height: 26, borderRadius: 4, background: b.status === "arrivee" ? "#E9A94B" : "#8FB4DE", border: "none", fontSize: 10, color: "#152238", overflow: "hidden" }}>{b.from === j ? guestDe(b.guestId).name.split(" ")[0].slice(0, 5) : ""}</button> : <div style={{ height: 26, borderRadius: 4, background: r.menage === "maintenance" ? "#CFCFCF" : "#F0F8F5" }} />}</td>); })}</tr>))}</tbody></table></div>
        {rooms.length === 0 && <div className="text-sm mt-2" style={{ color: "#8A8370" }}>Aucune chambre : créez-les dans l'onglet « Chambres et tarifs ».</div>}
      </div>
    );
  };

  const Reservations = () => {
    const b = bookings.find((x) => x.id === sel);
    const tri = [...bookings].sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt))).slice(0, 80);
    return (
      <div>
        {canFront && (<div className="ec-card p-4 mb-5" data-testid="hotel-resa-form"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvelle réservation</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div className="md:col-span-2">{lab("Client")}<select value={rv.guestId} onChange={(e) => setRv({ ...rv, guestId: e.target.value })} data-testid="hotel-resa-client" className={ecInput} style={ecBorder}><option value="">— Choisir le client —</option>{[...guests].sort((a, b2) => a.name.localeCompare(b2.name)).map((g) => <option key={g.id} value={g.id}>{g.name}{g.phone ? " — " + g.phone : ""}</option>)}</select></div>
            <div>{lab("Arrivée")}<input type="date" value={rv.from} min={today} onChange={(e) => setRv({ ...rv, from: e.target.value, to: e.target.value >= rv.to ? hoAdd(e.target.value, 1) : rv.to, roomId: "" })} data-testid="hotel-resa-arrivee" className={ecInput} style={ecBorder} /></div>
            <div>{lab("Départ")}<input type="date" value={rv.to} min={hoAdd(rv.from, 1)} onChange={(e) => setRv({ ...rv, to: e.target.value, roomId: "" })} data-testid="hotel-resa-depart" className={ecInput} style={ecBorder} /></div>
            <div className="md:col-span-2">{lab("Chambre disponible sur ces dates (" + hoJours(rv.from, rv.to) + " nuit(s))")}<select value={rv.roomId} onChange={(e) => choisirChambre(e.target.value)} data-testid="hotel-resa-chambre" className={ecInput} style={ecBorder}><option value="">— Choisir la chambre —</option>{dispoChambres.map((r) => <option key={r.id} value={r.id}>Chambre {r.number} — {nomType(r.typeId)}</option>)}</select></div>
            <div>{lab("Adultes")}<input type="number" min="1" value={rv.adults} onChange={(e) => setRv({ ...rv, adults: e.target.value })} data-testid="hotel-resa-adultes" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div>{lab("Enfants")}<input type="number" min="0" value={rv.children} onChange={(e) => setRv({ ...rv, children: e.target.value })} className={ecInput + " tabular"} style={ecBorder} /></div>
            <div>{lab("Tarif par nuit")}<input type="number" min="0" step="0.01" value={rv.rate} onChange={(e) => setRv({ ...rv, rate: e.target.value })} data-testid="hotel-resa-tarif" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div>{lab("Acompte (facultatif)")}<input type="number" min="0" step="0.01" value={rv.depAmount} onChange={(e) => setRv({ ...rv, depAmount: e.target.value })} data-testid="hotel-resa-acompte" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div>{lab("Acompte payé par")}<select value={rv.depMode} onChange={(e) => setRv({ ...rv, depMode: e.target.value })} className={ecInput} style={ecBorder}>{HO_MODES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></div>
            <div className="md:col-span-2">{lab("Notes (facultatif)")}<input value={rv.notes} onChange={(e) => setRv({ ...rv, notes: e.target.value })} className={ecInput} style={ecBorder} /></div>
          </div>
          <button onClick={() => reserver()} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="hotel-resa-creer">Enregistrer la réservation</button>
          {guests.length === 0 && <div className="text-xs mt-2" style={{ color: "#A6432F" }}>Aucun client enregistré : créez d'abord sa fiche dans l'onglet « Clients ».</div>}
        </div>)}
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>Client</th><th>Chambre</th><th>Arrivée</th><th>Départ</th><th className="text-right">Nuits</th><th className="text-right">Acompte</th><th>État</th><th></th></tr></thead>
          <tbody>{tri.map((x) => (<tr key={x.id} data-testid="hotel-resa-ligne"><td className="py-1.5 tabular text-xs">{x.number}</td><td>{guestDe(x.guestId).name || "—"}</td><td>{nomChambre(x.roomId)}</td><td>{ecDateFr(x.from)}</td><td>{ecDateFr(x.to)}</td><td className="text-right tabular">{hoJours(x.from, x.to)}</td><td className="text-right tabular">{hoM(acomptesDe(x))}</td><td>{pastilleEtat(x)}</td><td className="text-right"><button onClick={() => setSel(sel === x.id ? "" : x.id)} className="text-xs underline" data-testid="hotel-resa-ouvrir">Ouvrir</button></td></tr>))}</tbody></table></div>
        {bookings.length === 0 && <div className="text-sm mt-2" style={{ color: "#8A8370" }}>Aucune réservation pour le moment.</div>}
        {b && Detail(b)}
      </div>
    );
  };
  const Detail = (b) => {
    const g = guestDe(b.guestId);
    const t = b.status === "arrivee" ? calcSejour(b, dep.date) : null;
    const ac = acomptesDe(b);
    const reste = t ? hoR2(t.total - ac) : 0;
    return (
      <div className="ec-card p-4 mt-4" data-testid="hotel-detail">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2"><div className="display text-base" style={{ color: "#152238", margin: 0 }}>{b.number} — {g.name} — {nomChambre(b.roomId)}</div><div>{pastilleEtat(b)}</div></div>
        <div className="text-sm mb-2" style={{ color: "#5B563F" }}>Du {ecDateFr(b.from)} au {ecDateFr(b.to)} ({hoJours(b.from, b.to)} nuit(s)) · {b.adults} adulte(s){b.children ? ", " + b.children + " enfant(s)" : ""} · {hoM(b.rate)} la nuit{b.notes ? " · " + b.notes : ""}{g.phone ? " · " + g.phone : ""}</div>
        {(b.deposits || []).length > 0 && <div className="text-sm mb-2" data-testid="hotel-acomptes">Acomptes : {b.deposits.map((d) => hoM(d.amount) + " (" + hoNomMode(d.mode) + ", " + ecDateFr(d.date) + ")").join(" · ")} — total <b>{hoM(ac)}</b></div>}
        {canFront && hoActive(b) && (<div className="grid md:grid-cols-4 gap-2 items-end mb-3">
          <div>{lab("Encaisser un acompte")}<input type="number" min="0" step="0.01" value={dp.amount} onChange={(e) => setDp({ ...dp, amount: e.target.value })} data-testid="hotel-acompte-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
          <div>{lab("Payé par")}<select value={dp.mode} onChange={(e) => setDp({ ...dp, mode: e.target.value })} className={ecInput} style={ecBorder}>{HO_MODES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></div>
          <div><button onClick={() => addDeposit(b)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="hotel-acompte-ajouter">Encaisser l'acompte</button></div>
        </div>)}
        {b.status === "reservee" && canFront && (<div>
          <button onClick={() => arrivee(b)} className="px-3 py-2 rounded text-sm mr-2" style={ecBtnGold} data-testid="hotel-arrivee">Enregistrer l'arrivée</button>
          <div className="mt-3 p-3 rounded" style={{ background: "#F4F1E6" }}><div className="text-xs font-semibold mb-1">Annulation ou client absent</div>
            <div className="flex flex-wrap items-end gap-3">
              <div>{lab("Motif")}<select value={an.raison} onChange={(e) => setAn({ ...an, raison: e.target.value })} data-testid="hotel-annul-motif" className={ecInput} style={ecBorder}><option value="annulation">Annulation par le client</option><option value="absent">Client absent (n'est pas venu)</option></select></div>
              {ac > 0 && <div>{lab("Acompte de " + hoM(ac))}<select value={an.acompte} onChange={(e) => setAn({ ...an, acompte: e.target.value })} data-testid="hotel-annul-acompte" className={ecInput} style={ecBorder}><option value="rembourser">Rembourser au client</option><option value="conserver">Conserver (indemnité d'annulation)</option></select></div>}
              <button onClick={() => annuler(b)} className="px-3 py-2 rounded text-sm" style={{ ...ecBtn, background: "transparent", color: "#A6432F", border: "1px solid #A6432F" }} data-testid="hotel-annuler">Annuler la réservation</button>
            </div></div></div>)}
        {b.status === "arrivee" && (<div>
          <div className="display text-base mb-1 mt-2" style={{ color: "#152238" }}>Services pendant le séjour</div>
          {(b.extras || []).map((x) => (<div key={x.id} className="flex items-center justify-between text-sm py-1" data-testid="hotel-extra-ligne"><span>{x.qty} × {x.label} ({ecDateFr(x.date)})</span><span className="tabular">{hoM(x.qty * x.unit)} {canFront && <button onClick={() => delExtra(b, x.id)} className="text-xs ml-2" style={{ color: "#A6432F" }}>Retirer</button>}</span></div>))}
          {(b.extras || []).length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun service ajouté.</div>}
          {canFront && (<div className="grid md:grid-cols-5 gap-2 items-end mt-2">
            <div className="md:col-span-2">{lab("Service")}<select value={ex.serviceId} onChange={(e) => setEx({ ...ex, serviceId: e.target.value })} data-testid="hotel-extra-service" className={ecInput} style={ecBorder}><option value="">Autre (saisir ci-dessous)</option>{cfg.services.map((s) => <option key={s.id} value={s.id}>{s.label} — {hoM(s.price)}</option>)}</select></div>
            <div>{lab("Quantité")}<input type="number" min="1" value={ex.qty} onChange={(e) => setEx({ ...ex, qty: e.target.value })} data-testid="hotel-extra-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
            {!ex.serviceId && <><div>{lab("Libellé")}<input value={ex.label} onChange={(e) => setEx({ ...ex, label: e.target.value })} className={ecInput} style={ecBorder} /></div><div>{lab("Prix unitaire")}<input type="number" min="0" step="0.01" value={ex.unit} onChange={(e) => setEx({ ...ex, unit: e.target.value })} className={ecInput + " tabular"} style={ecBorder} /></div></>}
            <div><button onClick={() => addExtra(b)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="hotel-extra-ajouter">Ajouter</button></div>
          </div>)}
          {canFront && (<div className="mt-4 p-3 rounded" style={{ background: "#F4F1E6" }} data-testid="hotel-depart"><div className="display text-base mb-2" style={{ color: "#152238" }}>Départ et facturation</div>
            <div className="grid md:grid-cols-3 gap-2 items-end mb-2"><div>{lab("Date de départ réelle (entre le " + ecDateFr(b.from) + " et aujourd'hui ; un départ le jour même de l'arrivée compte 1 nuit)")}<input type="date" value={dep.date} min={b.from} max={today} onChange={(e) => setDep({ ...dep, date: e.target.value })} data-testid="hotel-depart-date" className={ecInput} style={ecBorder} /></div></div>
            <div className="text-sm" data-testid="hotel-depart-totaux">
              <div className="flex justify-between"><span>Hébergement ({t.nuits} nuit(s) × {hoM(b.rate)})</span><span className="tabular" data-testid="hotel-tot-heberg">{hoM(t.heberg)}</span></div>
              {t.services > 0 && <div className="flex justify-between"><span>Services annexes</span><span className="tabular">{hoM(t.services)}</span></div>}
              {t.sejour > 0 && <div className="flex justify-between"><span>Taxe de séjour ({b.adults} adulte(s) × {t.nuits} nuit(s) × {hoM(cfg.sejour)})</span><span className="tabular">{hoM(t.sejour)}</span></div>}
              {t.tca > 0 && <div className="flex justify-between"><span>TCA ({tcaRate} %)</span><span className="tabular">{hoM(t.tca)}</span></div>}
              <div className="flex justify-between font-semibold"><span>Total du séjour</span><span className="tabular" data-testid="hotel-tot-total">{hoM(t.total)}</span></div>
              {ac > 0 && <div className="flex justify-between"><span>Acomptes déjà payés</span><span className="tabular">− {hoM(ac)}</span></div>}
              <div className="flex justify-between font-semibold"><span>Reste à payer</span><span className="tabular" data-testid="hotel-tot-reste">{hoM(Math.max(0, reste))}</span></div>
            </div>
            {reste > 0.005 && (<div className="mt-2">
              <div className="grid md:grid-cols-3 gap-2 items-end"><div>{lab("Mode de paiement")}<select value={dep.rows[0].mode} onChange={(e) => setDep({ ...dep, rows: dep.rows.map((r, i) => (i === 0 ? { ...r, mode: e.target.value } : r)) })} data-testid="hotel-depart-mode" className={ecInput} style={ecBorder}>{HO_MODES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></div>
                {dep.rows.length > 1 && <div>{lab("Montant payé")}<input type="number" min="0" step="0.01" value={dep.rows[0].amount} onChange={(e) => setDep({ ...dep, rows: dep.rows.map((r, i) => (i === 0 ? { ...r, amount: e.target.value } : r)) })} data-testid="hotel-pay-montant-0" className={ecInput + " tabular"} style={ecBorder} /></div>}</div>
              {dep.rows.slice(1).map((r, i) => (<div key={i} className="grid md:grid-cols-3 gap-2 items-end mt-2"><div>{lab("Autre mode")}<select value={r.mode} onChange={(e) => setDep({ ...dep, rows: dep.rows.map((x, j) => (j === i + 1 ? { ...x, mode: e.target.value } : x)) })} className={ecInput} style={ecBorder}>{HO_MODES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></div><div>{lab("Montant payé")}<input type="number" min="0" step="0.01" value={r.amount} onChange={(e) => setDep({ ...dep, rows: dep.rows.map((x, j) => (j === i + 1 ? { ...x, amount: e.target.value } : x)) })} data-testid={"hotel-pay-montant-" + (i + 1)} className={ecInput + " tabular"} style={ecBorder} /></div><div><button onClick={() => setDep({ ...dep, rows: dep.rows.length === 2 ? [{ ...dep.rows[0], amount: "" }] : dep.rows.filter((x, j) => j !== i + 1) })} className="text-xs" style={{ color: "#A6432F" }}>Retirer ce paiement</button></div></div>))}
              <button onClick={() => setDep({ ...dep, rows: [...(dep.rows.length === 1 ? [{ ...dep.rows[0], amount: "" }] : dep.rows), { mode: "banque", amount: "" }] })} className="text-xs underline mt-2" data-testid="hotel-pay-ajouter-mode">Payer avec plusieurs modes (facultatif)</button>
            </div>)}
            <button onClick={() => partir(b)} className="mt-3 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="hotel-partir">Enregistrer le départ et facturer</button>
          </div>)}
        </div>)}
        {b.invoice && b.invoice.status !== "annulee" && <div className="mt-3"><button onClick={() => setImprimer({ b, ticket: false })} className="text-xs underline" data-testid="hotel-voir-facture">Voir la facture {b.invoice.number}</button></div>}
      </div>
    );
  };

  const Chambres = () => (
    <div>
      {canEdit && (<div className="ec-card p-4 mb-5" data-testid="hotel-type-form"><div className="display text-base mb-2" style={{ color: "#152238" }}>{ft.id ? "Modifier le type de chambre" : "Ajouter un type de chambre"}</div>
        <div className="grid md:grid-cols-4 gap-2 items-end">
          <div className="md:col-span-2">{lab("Nom du type (ex. Simple, Double, Suite)")}<input value={ft.name} onChange={(e) => setFt({ ...ft, name: e.target.value })} data-testid="hotel-type-nom" className={ecInput} style={ecBorder} /></div>
          <div>{lab("Personnes (maximum)")}<input type="number" min="1" value={ft.capacity} onChange={(e) => setFt({ ...ft, capacity: e.target.value })} data-testid="hotel-type-capacite" className={ecInput + " tabular"} style={ecBorder} /></div>
          <div>{lab("Tarif par nuit")}<input type="number" min="0" step="0.01" value={ft.price} onChange={(e) => setFt({ ...ft, price: e.target.value })} data-testid="hotel-type-tarif" className={ecInput + " tabular"} style={ecBorder} /></div>
          <div className="md:col-span-2">{lab("Description (facultatif)")}<input value={ft.desc} onChange={(e) => setFt({ ...ft, desc: e.target.value })} className={ecInput} style={ecBorder} /></div>
          <div className="md:col-span-2">{lab("Photo (facultatif)")}<div className="flex items-center gap-2 mt-1"><input type="file" accept="image/*" onChange={choisirPhoto} data-testid="hotel-type-photo" className="text-xs" />{ft.photo && <img src={ft.photo} alt="" data-testid="hotel-type-photo-apercu" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6 }} />}</div></div>
        </div>
        <div className="flex gap-2 mt-2"><button onClick={saveType} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="hotel-type-ajouter">{ft.id ? "Enregistrer les modifications" : "Ajouter le type"}</button>{ft.id && <button onClick={() => setFt(vide)} className="px-3 py-2 rounded text-sm underline">Annuler</button>}</div>
      </div>)}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        {types.map((t) => (<div key={t.id} className="ec-card p-3" data-testid="hotel-type-carte"><div className="flex gap-3">{t.photo ? <img src={t.photo} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} /> : <div style={{ width: 72, height: 72, borderRadius: 8, background: "#F4F1E6", color: "#9A7B1E", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0 }}>{t.name.charAt(0).toUpperCase()}</div>}
          <div style={{ minWidth: 0 }}><div className="font-semibold text-sm">{t.name}</div>{t.desc && <div className="text-xs" style={{ color: "#7A7460" }}>{t.desc}</div>}<div className="text-xs" style={{ color: "#8A8370" }}>{t.capacity} personne(s) max.</div><div className="tabular text-sm mt-1">{hoM(t.price)} / nuit</div></div></div>
          {canEdit && <div className="flex gap-3 mt-2 text-xs"><button onClick={() => setFt({ id: t.id, name: t.name, capacity: String(t.capacity), price: String(t.price), desc: t.desc || "", photo: t.photo || "" })} className="underline" data-testid="hotel-type-modifier">Modifier</button><button onClick={() => delType(t)} style={{ color: "#A6432F" }}>Supprimer</button></div>}</div>))}
      </div>
      {types.length === 0 && <div className="text-sm mb-4" style={{ color: "#8A8370" }}>Aucun type de chambre : créez le premier ci-dessus.</div>}
      {canEdit && (<div className="ec-card p-4 mb-3"><div className="display text-base mb-2" style={{ color: "#152238" }}>Ajouter une chambre</div>
        <div className="grid md:grid-cols-3 gap-2 items-end">
          <div>{lab("Numéro")}<input value={fch.number} onChange={(e) => setFch({ ...fch, number: e.target.value })} data-testid="hotel-chambre-numero" className={ecInput} style={ecBorder} /></div>
          <div>{lab("Type")}<select value={fch.typeId} onChange={(e) => setFch({ ...fch, typeId: e.target.value })} data-testid="hotel-chambre-type" className={ecInput} style={ecBorder}><option value="">—</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
          <div><button onClick={addRoom} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="hotel-chambre-ajouter">Ajouter la chambre</button></div>
        </div></div>)}
      <div className="ec-wrap mb-5"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Chambre</th><th>Type</th><th>Occupation</th><th>Ménage</th><th></th></tr></thead>
        <tbody>{rooms.map((r) => { const o = enSejour.find((b) => b.roomId === r.id); return (<tr key={r.id} data-testid="hotel-chambre-ligne"><td className="py-1.5">{r.number}</td><td>{nomType(r.typeId)}</td><td>{o ? ecPastille("Occupée — " + (guestDe(o.guestId).name || ""), "attente") : ecPastille("Libre", "ok")}</td>
          <td>{canFront ? <select value={r.menage || "propre"} onChange={(e) => setMenage(r, e.target.value)} data-testid="hotel-menage" className="text-sm" style={{ border: "1px solid #DDD6C4", borderRadius: 4, padding: "2px 4px" }}>{HO_MENAGE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select> : (HO_MENAGE.find((m) => m[0] === r.menage) || [0, "Propre"])[1]}</td>
          <td className="text-right">{canEdit && <button onClick={() => delRoom(r)} className="text-xs" style={{ color: "#A6432F" }}>Supprimer</button>}</td></tr>); })}</tbody></table></div>
      {canEdit && (<div className="grid md:grid-cols-2 gap-4">
        <div className="ec-card p-4" data-testid="hotel-services"><div className="display text-base mb-2" style={{ color: "#152238" }}>Services de l'hôtel (facultatif)</div>
          <div className="text-xs mb-2" style={{ color: "#7A7460" }}>Petit-déjeuner, blanchisserie, navette… avec leur prix : on les ajoute au séjour d'un client en un clic.</div>
          {cfg.services.map((s) => (<div key={s.id} className="flex justify-between text-sm py-1" data-testid="hotel-service-ligne"><span>{s.label} — {hoM(s.price)}</span><button onClick={() => delService(s)} className="text-xs" style={{ color: "#A6432F" }}>Retirer</button></div>))}
          <div className="grid grid-cols-3 gap-2 items-end mt-2"><div className="col-span-2">{lab("Nom du service")}<input value={fsv.label} onChange={(e) => setFsv({ ...fsv, label: e.target.value })} data-testid="hotel-service-nom" className={ecInput} style={ecBorder} /></div><div>{lab("Prix")}<input type="number" min="0" step="0.01" value={fsv.price} onChange={(e) => setFsv({ ...fsv, price: e.target.value })} data-testid="hotel-service-prix" className={ecInput + " tabular"} style={ecBorder} /></div></div>
          <button onClick={addService} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtn} data-testid="hotel-service-ajouter">Ajouter le service</button></div>
        <div className="ec-card p-4" data-testid="hotel-reglages"><div className="display text-base mb-2" style={{ color: "#152238" }}>Taxes sur la facture (facultatif)</div>
          <label className="flex items-center gap-2 text-sm mb-2"><input type="checkbox" checked={!!reg.sejourOn} onChange={(e) => setFr({ ...reg, sejourOn: e.target.checked })} data-testid="hotel-sejour-on" />Ajouter une taxe de séjour (par adulte et par nuit)</label>
          {reg.sejourOn && <div className="mb-2">{lab("Montant par adulte et par nuit")}<input type="number" min="0" step="0.01" value={reg.sejour} onChange={(e) => setFr({ ...reg, sejour: e.target.value })} data-testid="hotel-sejour-montant" className={ecInput + " tabular"} style={{ ...ecBorder, maxWidth: 180 }} /></div>}
          <label className="flex items-center gap-2 text-sm mb-2"><input type="checkbox" checked={!!reg.tcaOn} onChange={(e) => setFr({ ...reg, tcaOn: e.target.checked })} data-testid="hotel-tca" />Ajouter la TCA ({Number(settings.taxRate) || 0} %) sur l'hébergement et les services</label>
          <button onClick={saveCfg} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="hotel-reglages-enregistrer">Enregistrer</button>
          <div className="text-xs mt-2" style={{ color: "#7A7460" }}>Rien n'est activé tant que vous ne le décidez pas. La taxe de séjour est gardée en compte 4476 (à reverser à qui de droit). Taux et obligations à confirmer avec votre expert-comptable.</div></div>
      </div>)}
    </div>
  );

  const Clients = () => (
    <div>
      {canFront && (<div className="ec-card p-4 mb-5"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouveau client</div>
        <div className="grid md:grid-cols-4 gap-2 items-end">
          <div>{lab("Nom complet")}<input value={fg.name} onChange={(e) => setFg({ ...fg, name: e.target.value })} data-testid="hotel-client-nom" className={ecInput} style={ecBorder} /></div>
          <div>{lab("Téléphone")}<input value={fg.phone} onChange={(e) => setFg({ ...fg, phone: e.target.value })} data-testid="hotel-client-tel" className={ecInput} style={ecBorder} /></div>
          <div>{lab("E-mail (facultatif)")}<input value={fg.email} onChange={(e) => setFg({ ...fg, email: e.target.value })} className={ecInput} style={ecBorder} /></div>
          <div>{lab("Pièce d'identité (facultatif)")}<input value={fg.idDoc} onChange={(e) => setFg({ ...fg, idDoc: e.target.value })} className={ecInput} style={ecBorder} /></div>
        </div><button onClick={addGuest} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="hotel-client-ajouter">Enregistrer le client</button></div>)}
      <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Client</th><th>Téléphone</th><th>E-mail</th><th className="text-right">Séjours</th><th className="text-right">Total dépensé</th></tr></thead>
        <tbody>{[...guests].sort((a, b) => a.name.localeCompare(b.name)).map((g) => { const f = factPayees.filter((b) => b.guestId === g.id); return (<tr key={g.id} data-testid="hotel-client-ligne"><td className="py-1.5">{g.name}</td><td className="text-xs">{g.phone || "—"}</td><td className="text-xs">{g.email || "—"}</td><td className="text-right tabular">{f.length}</td><td className="text-right tabular">{hoM(f.reduce((s, b) => s + b.invoice.total, 0))}</td></tr>); })}</tbody></table></div>
      {guests.length === 0 && <div className="text-sm mt-2" style={{ color: "#8A8370" }}>Aucun client enregistré.</div>}
    </div>
  );

  const debutMois = today.slice(0, 7) + "-01";
  const [ff, setFf] = useState({ from: debutMois, to: today, type: "", etat: "" });
  const Factures = () => {
    const liste = factures.filter((b) => b.invoice.date >= ff.from && b.invoice.date <= ff.to && (!ff.type || roomDe(b.roomId).typeId === ff.type) && (!ff.etat || (ff.etat === "payee" ? b.invoice.status !== "annulee" : b.invoice.status === "annulee"))).sort((a, b) => String(b.invoice.date).localeCompare(String(a.invoice.date)) || b.invoice.number.localeCompare(a.invoice.number));
    const pay = liste.filter((b) => b.invoice.status !== "annulee");
    const S = (f) => hoR2(pay.reduce((s, b) => s + (Number(f(b.invoice)) || 0), 0));
    return (
      <div>
        <div className="ec-card p-4 mb-4"><div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
          <div>{lab("Du")}<input type="date" value={ff.from} onChange={(e) => setFf({ ...ff, from: e.target.value })} data-testid="hotel-fact-du" className={ecInput} style={ecBorder} /></div>
          <div>{lab("Au")}<input type="date" value={ff.to} onChange={(e) => setFf({ ...ff, to: e.target.value })} data-testid="hotel-fact-au" className={ecInput} style={ecBorder} /></div>
          <div>{lab("Type de chambre")}<select value={ff.type} onChange={(e) => setFf({ ...ff, type: e.target.value })} className={ecInput} style={ecBorder}><option value="">Tous</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
          <div>{lab("État")}<select value={ff.etat} onChange={(e) => setFf({ ...ff, etat: e.target.value })} className={ecInput} style={ecBorder}><option value="">Toutes</option><option value="payee">Payées</option><option value="annulee">Annulées</option></select></div>
        </div></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>Date</th><th>Client</th><th>Chambre</th><th className="text-right">Nuits</th><th className="text-right">Hébergement</th><th className="text-right">Services</th><th className="text-right">Taxe séjour</th><th className="text-right">TCA</th><th className="text-right">Total</th><th>État</th><th></th></tr></thead>
          <tbody>{liste.map((b) => (<tr key={b.id} data-testid="hotel-fact-ligne" style={{ opacity: b.invoice.status === "annulee" ? 0.55 : 1 }}><td className="py-1.5 tabular text-xs">{b.invoice.number}</td><td>{ecDateFr(b.invoice.date)}</td><td>{guestDe(b.guestId).name}</td><td>{nomChambre(b.roomId)}</td><td className="text-right tabular">{b.invoice.nights}</td><td className="text-right tabular">{hoM(b.invoice.heberg)}</td><td className="text-right tabular">{hoM(b.invoice.services)}</td><td className="text-right tabular">{hoM(b.invoice.sejour)}</td><td className="text-right tabular">{hoM(b.invoice.tca)}</td><td className="text-right tabular">{hoM(b.invoice.total)}</td><td>{b.invoice.status === "annulee" ? ecPastille("Annulée", "neutre") : ecPastille("Payée", "ok")}</td>
            <td className="text-right whitespace-nowrap"><button onClick={() => setImprimer({ b, ticket: false })} className="text-xs underline mr-2" data-testid="hotel-fact-voir">Voir / A4</button><button onClick={() => setImprimer({ b, ticket: true })} className="text-xs underline mr-2">Ticket</button>{b.invoice.status !== "annulee" && canEdit && <button onClick={() => annulerFacture(b)} className="text-xs" style={{ color: "#A6432F" }} data-testid="hotel-fact-annuler">Annuler</button>}</td></tr>))}
            {liste.length > 0 && (<tr className="font-semibold" style={{ borderTop: "2px solid #152238" }} data-testid="hotel-fact-total"><td className="py-1.5" colSpan={4}>Total ({pay.length} facture(s) payée(s))</td><td className="text-right tabular">{S((i) => i.nights)}</td><td className="text-right tabular">{hoM(S((i) => i.heberg))}</td><td className="text-right tabular">{hoM(S((i) => i.services))}</td><td className="text-right tabular">{hoM(S((i) => i.sejour))}</td><td className="text-right tabular">{hoM(S((i) => i.tca))}</td><td className="text-right tabular" data-testid="hotel-fact-total-montant">{hoM(S((i) => i.total))}</td><td colSpan={2}></td></tr>)}</tbody></table></div>
        {liste.length === 0 && <div className="text-sm mt-2" style={{ color: "#8A8370" }}>Aucune facture pour ces filtres. Une facture est créée à chaque départ enregistré.</div>}
      </div>
    );
  };
  const FactureSheet = ({ b, ticket }) => {
    const i = b.invoice, g = guestDe(b.guestId);
    const W = ticket ? 300 : 794, fs = ticket ? 11 : 13;
    const row = (l, v, bold) => (<div style={{ display: "flex", justifyContent: "space-between", fontWeight: bold ? 700 : 400, gap: 8 }}><span>{l}</span><span className="tabular">{v}</span></div>);
    return (
      <div style={{ color: "#152238", background: "#fff", fontFamily: "'Inter', sans-serif", fontSize: fs, width: "100%", maxWidth: W, margin: "0 auto", padding: ticket ? "10px 8px" : "32px 36px", boxSizing: "border-box" }} data-testid={ticket ? "hotel-ticket-feuille" : "hotel-facture-feuille"}>
        <div style={{ textAlign: "center", marginBottom: 10 }}>
          {settings.companyLogo && <img src={settings.companyLogo} alt="" style={{ width: ticket ? 40 : 60, height: ticket ? 40 : 60, objectFit: "contain", margin: "0 auto 6px", display: "block" }} />}
          <div style={{ fontWeight: 700, fontSize: ticket ? 14 : 20 }}>{settings.companyName || "Hôtel"}</div>
          {settings.companyAddress && <div style={{ fontSize: ticket ? 10 : 12 }}>{settings.companyAddress}</div>}
          {settings.companyPhone && <div style={{ fontSize: ticket ? 10 : 12 }}>{settings.companyPhone}</div>}
          {settings.companyNIF && <div style={{ fontSize: ticket ? 10 : 12 }}>NIF : {settings.companyNIF}</div>}
        </div>
        <div style={{ fontWeight: 700, fontSize: ticket ? 13 : 18, textAlign: "center", marginBottom: 8 }}>FACTURE DE SÉJOUR{i.status === "annulee" ? " — ANNULÉE" : ""}</div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span>N° <b>{i.number}</b></span><span>{ecDateFr(i.date)}</span></div>
        <div style={{ marginBottom: 8, lineHeight: 1.6 }}>Client : <b>{g.name}</b>{g.phone ? " — " + g.phone : ""}<br />{nomChambre(b.roomId)} ({nomType(roomDe(b.roomId).typeId)}) · réservation {b.number}<br />Du {ecDateFr(b.from)} au {ecDateFr(b.departed || b.to)} · {b.adults} adulte(s){b.children ? ", " + b.children + " enfant(s)" : ""}</div>
        <div style={{ borderTop: "1px dashed #152238", borderBottom: "1px dashed #152238", padding: "6px 0", marginBottom: 6 }}>
          {row(i.nights + " nuit(s) × " + hoM(i.rate), hoM(i.heberg))}
          {(b.extras || []).map((x) => <div key={x.id}>{row(x.qty + " × " + x.label, hoM(x.qty * x.unit))}</div>)}
        </div>
        <div style={{ lineHeight: 1.7 }}>
          {i.sejour > 0 && row("Taxe de séjour (" + i.adults + " adulte(s) × " + i.nights + " nuit(s) × " + hoM(i.sejourRate) + ")", hoM(i.sejour))}
          {i.tca > 0 && row("TCA (" + i.tcaRate + " %)", hoM(i.tca))}
        </div>
        <div style={{ fontSize: ticket ? 14 : 18, marginTop: 4 }}>{row("TOTAL", hoM(i.total), true)}</div>
        <div style={{ marginTop: 6 }}>{i.deposits > 0 && row("Acomptes déjà payés", hoM(i.deposits))}{(i.payments || []).map((p, k) => <div key={k}>{row("Payé — " + hoNomMode(p.mode), hoM(p.amount))}</div>)}</div>
        <div style={{ marginTop: 12, textAlign: "center", fontSize: ticket ? 10 : 12 }}>Merci de votre séjour !</div>
      </div>
    );
  };

  const [rp, setRp] = useState({ from: debutMois, to: today });
  const Rapports = () => {
    const fp = factPayees.filter((b) => b.invoice.date >= rp.from && b.invoice.date <= rp.to);
    const parJour = {};
    fp.forEach((b) => { const i = b.invoice; const x = parJour[i.date] || (parJour[i.date] = { nb: 0, nuits: 0, heberg: 0, services: 0, sejour: 0, tca: 0, total: 0, esp: 0, ban: 0 }); x.nb++; x.nuits += i.nights; x.heberg += i.heberg; x.services += i.services; x.sejour += i.sejour; x.tca += i.tca; x.total += i.total; (i.payments || []).forEach((p) => { if (p.mode === "banque") x.ban += p.amount; else x.esp += p.amount; }); });
    const jours = Object.keys(parJour).sort();
    const S = (f) => hoR2(jours.reduce((s, j) => s + f(parJour[j]), 0));
    const parType = {}; fp.forEach((b) => { const k = nomType(roomDe(b.roomId).typeId); const x = parType[k] || (parType[k] = { nuits: 0, ca: 0 }); x.nuits += b.invoice.nights; x.ca = hoR2(x.ca + b.invoice.heberg); });
    const parServ = {}; fp.forEach((b) => (b.extras || []).forEach((e) => { const x = parServ[e.label] || (parServ[e.label] = { qty: 0, ca: 0 }); x.qty += e.qty; x.ca = hoR2(x.ca + e.qty * e.unit); }));
    const nbJ = Math.max(1, hoJours(rp.from, rp.to) + 1);
    const occup = (() => { const tot = rooms.length; if (!tot) return []; return Array.from({ length: Math.min(nbJ, 62) }, (_, i) => { const j = hoAdd(rp.from, i); const n = bookings.filter((b) => (b.status === "partie" || b.status === "arrivee") && b.from <= j && (b.departed || b.to) > j).length; return { j, n, taux: Math.round(n / tot * 100) }; }); })();
    const exporter = () => ecTelecharger("journal-hotel-" + today + ".csv", [["Date", "Séjours facturés", "Nuitées", "Hébergement", "Services", "Taxe de séjour", "TCA", "Total", "Espèces", "Banque"], ...jours.map((j) => [ecDateFr(j), parJour[j].nb, parJour[j].nuits, hoR2(parJour[j].heberg), hoR2(parJour[j].services), hoR2(parJour[j].sejour), hoR2(parJour[j].tca), hoR2(parJour[j].total), hoR2(parJour[j].esp), hoR2(parJour[j].ban)]), ["TOTAL", S((x) => x.nb), S((x) => x.nuits), S((x) => x.heberg), S((x) => x.services), S((x) => x.sejour), S((x) => x.tca), S((x) => x.total), S((x) => x.esp), S((x) => x.ban)]]);
    return (
      <div>
        <div className="ec-card p-4 mb-4"><div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
          <div>{lab("Du")}<input type="date" value={rp.from} onChange={(e) => setRp({ ...rp, from: e.target.value })} data-testid="hotel-rp-du" className={ecInput} style={ecBorder} /></div>
          <div>{lab("Au")}<input type="date" value={rp.to} onChange={(e) => setRp({ ...rp, to: e.target.value })} data-testid="hotel-rp-au" className={ecInput} style={ecBorder} /></div>
          <div><button onClick={exporter} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="hotel-rapport-export">Exporter le journal (CSV)</button></div>
        </div></div>
        <div className="display text-base" style={{ color: "#152238" }}>Journal des ventes par jour (séjours facturés)</div>
        <div className="ec-wrap mb-5"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th className="text-right">Séjours</th><th className="text-right">Nuitées</th><th className="text-right">Hébergement</th><th className="text-right">Services</th><th className="text-right">Taxe séjour</th><th className="text-right">TCA</th><th className="text-right">Total</th><th className="text-right">Espèces</th><th className="text-right">Banque</th></tr></thead>
          <tbody>{jours.map((j) => (<tr key={j} data-testid="hotel-journal-ligne"><td className="py-1.5">{ecDateFr(j)}</td><td className="text-right tabular">{parJour[j].nb}</td><td className="text-right tabular">{parJour[j].nuits}</td><td className="text-right tabular">{hoM(parJour[j].heberg)}</td><td className="text-right tabular">{hoM(parJour[j].services)}</td><td className="text-right tabular">{hoM(parJour[j].sejour)}</td><td className="text-right tabular">{hoM(parJour[j].tca)}</td><td className="text-right tabular">{hoM(parJour[j].total)}</td><td className="text-right tabular">{hoM(parJour[j].esp)}</td><td className="text-right tabular">{hoM(parJour[j].ban)}</td></tr>))}
            {jours.length > 0 && <tr className="font-semibold" style={{ borderTop: "2px solid #152238" }} data-testid="hotel-journal-total"><td className="py-1.5">TOTAL</td><td className="text-right tabular" data-testid="hotel-jt-nb">{S((x) => x.nb)}</td><td className="text-right tabular" data-testid="hotel-jt-nuits">{S((x) => x.nuits)}</td><td className="text-right tabular" data-testid="hotel-jt-heberg">{hoM(S((x) => x.heberg))}</td><td className="text-right tabular">{hoM(S((x) => x.services))}</td><td className="text-right tabular">{hoM(S((x) => x.sejour))}</td><td className="text-right tabular">{hoM(S((x) => x.tca))}</td><td className="text-right tabular" data-testid="hotel-jt-total">{hoM(S((x) => x.total))}</td><td className="text-right tabular">{hoM(S((x) => x.esp))}</td><td className="text-right tabular">{hoM(S((x) => x.ban))}</td></tr>}</tbody></table></div>
        {jours.length === 0 && <div className="text-sm mb-4" style={{ color: "#8A8370" }}>Aucun séjour facturé sur cette période.</div>}
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div><div className="display text-base" style={{ color: "#152238" }}>Ventes par type de chambre</div><div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Type</th><th className="text-right">Nuitées</th><th className="text-right">Hébergement</th></tr></thead><tbody>{Object.keys(parType).map((k) => (<tr key={k} data-testid="hotel-rapport-type"><td className="py-1.5">{k}</td><td className="text-right tabular">{parType[k].nuits}</td><td className="text-right tabular">{hoM(parType[k].ca)}</td></tr>))}</tbody></table></div></div>
          <div><div className="display text-base" style={{ color: "#152238" }}>Services annexes vendus</div><div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Service</th><th className="text-right">Quantité</th><th className="text-right">Chiffre d'affaires</th></tr></thead><tbody>{Object.keys(parServ).map((k) => (<tr key={k} data-testid="hotel-rapport-service"><td className="py-1.5">{k}</td><td className="text-right tabular">{parServ[k].qty}</td><td className="text-right tabular">{hoM(parServ[k].ca)}</td></tr>))}</tbody></table></div></div>
        </div>
        <div className="display text-base" style={{ color: "#152238" }}>Occupation par jour (chambres occupées sur {rooms.length})</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th className="text-right">Chambres occupées</th><th className="text-right">Taux</th></tr></thead>
          <tbody>{occup.map((o) => (<tr key={o.j} data-testid="hotel-occup-ligne"><td className="py-1">{ecDateFr(o.j)}</td><td className="text-right tabular">{o.n}</td><td className="text-right tabular">{o.taux} %</td></tr>))}</tbody></table></div>
      </div>
    );
  };
  const Stats = () => {
    const mois = statMois(6, today);
    const data = mois.map((m) => ({ mois: m.label, ventes: statSomme(factPayees.map((b) => ({ d: b.invoice.date, v: b.invoice.heberg + b.invoice.services })), "d", m.key, (x) => x.v) }));
    const fm = factPayees.filter((b) => String(b.invoice.date).startsWith(today.slice(0, 7)));
    const ca = hoR2(fm.reduce((s, b) => s + b.invoice.heberg + b.invoice.services, 0));
    const nuits = fm.reduce((s, b) => s + b.invoice.nights, 0), heberg = hoR2(fm.reduce((s, b) => s + b.invoice.heberg, 0));
    const jEcoules = Number(today.slice(8, 10));
    const taux = rooms.length ? Math.round(nuits / (rooms.length * jEcoules) * 100) : 0;
    const parType = {}; fm.forEach((b) => { const k = nomType(roomDe(b.roomId).typeId); parType[k] = hoR2((parType[k] || 0) + b.invoice.heberg); });
    const parMode = {}; fm.forEach((b) => (b.invoice.payments || []).forEach((p) => { const k = hoNomMode(p.mode); parMode[k] = hoR2((parMode[k] || 0) + p.amount); }));
    const repart = { Hébergement: heberg, "Services annexes": hoR2(ca - heberg) };
    return <StatsBloc
      vide={factPayees.length === 0 ? "Aucun séjour facturé pour le moment : les statistiques apparaîtront avec vos premiers départs." : ""}
      kpis={[["Ventes du mois", hoM(ca), "hotel-stat-ventes"], ["Nuitées du mois", String(nuits), "hotel-stat-nuitees"], ["Taux d'occupation du mois", taux + " %", "hotel-stat-taux"], ["Prix moyen par nuit", hoM(nuits ? heberg / nuits : 0), "hotel-stat-prix"]]}
      evolution={{ titre: "Ventes (hébergement et services) — 6 derniers mois", data, series: [{ key: "ventes", name: "Ventes", color: "#9A7B1E" }] }}
      repartitions={[{ titre: "Hébergement par type de chambre (mois)", data: Object.keys(parType).map((k) => ({ name: k, value: parType[k] })) }, { titre: "Hébergement et services (mois)", data: Object.keys(repart).map((k) => ({ name: k, value: repart[k] })) }, { titre: "Modes de paiement (mois)", data: Object.keys(parMode).map((k) => ({ name: k, value: parMode[k] })) }]} />;
  };

  const tabs = [["apercu", "Tableau de bord"], ["planning", "Planning"], ["resa", "Réservations"], ...(isVendeur ? [] : [["chambres", "Chambres et tarifs"]]), ["clients", "Clients"], ["factures", "Factures"], ...(isVendeur ? [] : [["rapports", "Rapports"], ["stats", "Statistiques"]])];
  return (
    <>
      <div className={"p-4 md:p-8 max-w-6xl" + (imprimer ? " no-print" : "")} data-testid="hotel-module">
        <style>{EC_CSS + '[data-testid="hotel-module"] .display.text-base{border-left:3px solid #C9A24B;padding-left:10px;margin-bottom:12px}[data-testid="hotel-module"] input,[data-testid="hotel-module"] select{background:#fff}'}</style>
        <div className="mb-4"><div className="display text-2xl" style={{ color: "#152238" }}>Hôtellerie</div><div className="text-xs" style={{ color: "#8A8370" }}>Chambres et tarifs, planning, réservations, arrivées et départs, factures de séjour</div></div>
        {!canFront && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }}>Consultation seule : votre rôle ne permet pas de modifier les données.</div>}
        {isVendeur && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }} data-testid="hotel-reception-note">Réception : vous pouvez enregistrer les clients, réserver, enregistrer arrivées et départs, encaisser et imprimer les factures. Les chambres, tarifs, rapports et statistiques sont réservés à l'administrateur.</div>}
        <div className="ec-tabs">
          {tabs.map(([id, l]) => (<button key={id} onClick={() => setTab(id)} data-testid={"hotel-tab-" + id} className="px-3 py-2 text-sm rounded-lg transition-colors" style={{ background: tab === id ? "#152238" : "transparent", color: tab === id ? "#EFE9DD" : "#5B563F" }}>{l}</button>))}
        </div>
        {tab === "apercu" && Apercu()}
        {tab === "planning" && Planning()}
        {tab === "resa" && Reservations()}
        {tab === "chambres" && !isVendeur && Chambres()}
        {tab === "clients" && Clients()}
        {tab === "factures" && Factures()}
        {tab === "rapports" && !isVendeur && Rapports()}
        {tab === "stats" && !isVendeur && Stats()}
      </div>
      {imprimer && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto p-3 md:p-8 no-print" style={{ background: "rgba(21,34,56,0.55)" }} onClick={() => setImprimer(null)} data-testid="hotel-apercu">
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: imprimer.ticket ? 340 : 820 }}>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap"><div className="text-sm" style={{ color: "#EFE9DD" }}>Facture {imprimer.b.invoice.number}</div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => setImprimer({ ...imprimer, ticket: !imprimer.ticket })} className="px-3 py-1.5 rounded text-sm" style={ecBtn} data-testid="hotel-format">{imprimer.ticket ? "Passer en A4" : "Passer en ticket"}</button>
                <button onClick={() => { try { window.print(); } catch (e) {} }} className="px-3 py-1.5 rounded text-sm" style={ecBtnGold} data-testid="hotel-imprimer-ok">Imprimer / enregistrer en PDF</button>
                <button onClick={() => setImprimer(null)} className="px-3 py-1.5 rounded text-sm" style={ecBtn} data-testid="hotel-apercu-fermer">Fermer</button></div></div>
            <div className="rounded shadow-lg overflow-hidden" style={{ background: "#fff" }}><FactureSheet b={imprimer.b} ticket={imprimer.ticket} /></div>
          </div>
        </div>
      )}
      {imprimer && <div className={"print-only" + (imprimer.ticket ? " ticket-print-80" : "")}><FactureSheet b={imprimer.b} ticket={imprimer.ticket} /></div>}
    </>
  );
}

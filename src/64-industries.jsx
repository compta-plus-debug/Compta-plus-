// ═══ MODULE ═══
// @module Industries
// @depends EC_CSS, Plus, StatsBloc, ecBorder, ecBtn, ecBtnGold, ecDateFr, ecInput, ecPastille
//   ecTelecharger, fmt, isFutureDate, isLocked, statMois, statSomme, todayStr, uid, useBrouillon
//   useState
// @exports IndusModule
// ═══ FIN DE L'EN-TÊTE ═══
// Bloc Industries artisanales (alimentaire, produits d'entretien et cosmétiques, bois et métal, couture et artisanat d'art) :
// matières premières et stock, achats de matières, produits finis et recettes (nomenclatures), lots de fabrication avec coût de revient
// (matières + main-d'œuvre + frais saisis), commandes (série ou sur mesure) avec devis et acomptes, ventes et factures (A4 ou ticket),
// dépenses d'atelier, rapports (coût de revient, marge par produit, stock, impayés) et statistiques.
// Rien n'est préréglé : prix, quantités, taux horaire, frais, dates et taxe sont saisis par l'entreprise.
//
// Comptabilité (tout en gourdes) :
//  • achat de matières : Débit 601 / Crédit caisse, banque ou 401 (à payer) ; règlement d'une dette : Débit 401 / Crédit caisse ou banque ;
//  • facture de vente : Débit 411 (net), 4191 (acompte imputé) / Crédit 701 (ventes) et 445 (taxe, seulement si activée) ;
//  • acompte de commande : Débit caisse ou banque / Crédit 4191 ; encaissement : Débit caisse ou banque / Crédit 411 ;
//  • dépense d'atelier : Débit 602 emballages, 605 énergie, 613 loyer de l'atelier, 615 entretien et réparations, 618 transport, 628 autres / Crédit caisse, banque ou 401 ;
//  • toute annulation passe une écriture inverse.
// Le stock, les lots, le coût de revient et la main-d'œuvre des lots sont un suivi de gestion : la main-d'œuvre se paie par le module Salaires
// (aucune écriture de salaire ici), et la variation de stock de fin d'exercice reste à passer avec l'expert-comptable.
// Les comptes 601, 701, 4191, 602, 605, 613, 615, 618 et 628 sont à confirmer avec l'expert-comptable.

const IN_DEPENSES = [["emballage", "Emballages et étiquettes", "602"], ["energie", "Énergie (électricité, gaz, charbon, eau)", "605"], ["loyer", "Loyer de l'atelier", "613"], ["entretien", "Entretien et réparation du matériel", "615"], ["transport", "Transport", "618"], ["autre", "Autres frais", "628"]];
const IN_ETATS_CMD = [["devis", "Devis"], ["confirmee", "Confirmée"], ["enprod", "En fabrication"], ["prete", "Prête"], ["livree", "Livrée et facturée"], ["annulee", "Annulée"]];
const IN_COMPTES = {
  "411": { name: "Clients", type: "Actif" },
  "401": { name: "Fournisseurs", type: "Passif" },
  "445": { name: "Taxe collectée sur ventes (IVA/TCA)", type: "Passif" },
  "4191": { name: "Clients — avances et acomptes reçus", type: "Passif" },
  "601": { name: "Achats de matières premières", type: "Charge" },
  "602": { name: "Achats d'emballages et fournitures", type: "Charge" },
  "605": { name: "Eau, électricité, énergie", type: "Charge" },
  "613": { name: "Loyers", type: "Charge" },
  "615": { name: "Entretien et réparations", type: "Charge" },
  "618": { name: "Transports", type: "Charge" },
  "628": { name: "Autres charges d'exploitation", type: "Charge" },
  "701": { name: "Ventes de produits fabriqués", type: "Produit" },
  "512": { name: "Banque", type: "Actif" },
  "530": { name: "Caisse", type: "Actif" },
};
const inR2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const inQ = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const inId = () => String(uid());
const inRows = (rows, type) => (rows || []).filter((r) => r && r.type === type);
const IN_CATS = [["alimentaire", "Alimentaire"], ["entretien", "Entretien et cosmétiques"], ["bois", "Bois et métal"], ["couture", "Couture et art"], ["autre", "Autres produits"]];
const IN_MOTIFS_PERTE = [["destockage", "Déstockage (produit ancien ou proche de la date limite)"], ["promo", "Promotion décidée par la direction"], ["geste", "Geste commercial (client important)"], ["erreur", "Prix ou fabrication mal calculé : à corriger"], ["autre", "Autre raison (à préciser)"]];
const inMotifLibelle = (k, t) => (k === "autre" ? (t || "autre raison") : ((IN_MOTIFS_PERTE.find((m) => m[0] === k) || [0, ""])[1] || ""));
// Réduit la photo d'un produit (420 px, JPEG) pour qu'elle reste légère dans la sauvegarde.
function inRedimensionner(file, max) {
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
const inNom = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const inUniq = (arr) => Array.from(new Set(arr.map((x) => String(x || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
const inJours = (a, b) => (a && b ? Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000) : 0);
function inAjouterComptes(accounts, setAccounts, codes) {
  const missing = [...new Set(codes)].filter((k) => IN_COMPTES[k] && !accounts.some((a) => a.code === k)).map((k) => ({ code: k, name: IN_COMPTES[k].name, type: IN_COMPTES[k].type }));
  if (missing.length) setAccounts((prev) => [...prev, ...missing.filter((m) => !prev.some((a) => a.code === m.code))]);
}
const inPaye = (arr) => inR2((arr || []).filter((p) => p.status !== "annulé").reduce((s, p) => s + p.amount, 0));
// Solde d'une facture (gourdes)
function inSolde(f) { const paye = inPaye(f.payments); return { paye, reste: inR2((f.net || 0) - paye) }; }
const inMontantLignes = (lines) => inR2((lines || []).reduce((s, l) => s + inR2(l.qty * l.pu), 0));

function IndusModule({ suppliers, indus, setIndus, entries, setEntries, accounts, setAccounts, settings, role, showToast, logAudit, currentUserEmail }) {
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const isVendeur = role === "Vendeur"; // accueil : clients, commandes, ventes et encaissements
  const canFront = canEdit || isVendeur;
  const today = todayStr();
  const moisCourant = today.slice(0, 7);
  const [tab, setTab] = useState("apercu");
  const clients = inRows(indus, "client");
  const mats = inRows(indus, "mat");
  const achats = inRows(indus, "achat");
  const prods = inRows(indus, "prod");
  const recettes = inRows(indus, "rec");
  const lots = inRows(indus, "lot");
  const cmds = inRows(indus, "cmd");
  const facts = inRows(indus, "fact");
  const deps = inRows(indus, "dep");
  const ajusts = inRows(indus, "ajust");
  const cfg = inRows(indus, "config")[0] || {};
  const catsAll = [...IN_CATS, ...inRows(indus, "cat").map((c) => [c.id, c.label])];
  const catDe = (p) => (catsAll.some((c) => c[0] === p.cat) ? p.cat : "autre");
  const tcaOn = !!cfg.tcaOn;
  const tcaRate = tcaOn ? Number(settings.taxRate) || 0 : 0;
  const nomClient = (id) => (clients.find((x) => x.id === id) || {}).name || "Client de passage";
  const nomMat = (id) => (mats.find((x) => x.id === id) || {}).name || "—";
  const unitMat = (id) => (mats.find((x) => x.id === id) || {}).unit || "";
  const nomProd = (id) => (prods.find((x) => x.id === id) || {}).name || "—";
  const unitProd = (id) => (prods.find((x) => x.id === id) || {}).unit || "";
  const compteMode = (m) => (m === "banque" ? "512" : m === "apayer" ? "401" : "530");
  const maj = (id, fn) => setIndus((prev) => (prev || []).map((r) => (r.id === id ? fn(r) : r)));
  const ajouter = (rec) => setIndus((prev) => [...(prev || []), rec]);
  const ecrire = (date, label, lines, dossierId) => {
    const e = { id: uid(), date, createdAt: new Date().toISOString(), label, lines: lines.filter((l) => l.debit > 0 || l.credit > 0), kind: "indus", dossierId };
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
  const stockMat = (id) => inQ(achatsOk.filter((a) => a.matId === id).reduce((s, a) => s + a.qty, 0) - lotsOk.reduce((s, l) => s + (l.lines || []).filter((x) => x.matId === id).reduce((t, x) => t + x.qty, 0), 0) + ajOk.filter((a) => a.target === "mat" && a.refId === id).reduce((s, a) => s + a.qty, 0));
  const stockProd = (id) => inQ(lotsOk.filter((l) => l.productId === id).reduce((s, l) => s + l.qty, 0) - factsOk.reduce((s, f) => s + (f.lines || []).filter((x) => x.productId === id).reduce((t, x) => t + x.qty, 0), 0) + ajOk.filter((a) => a.target === "prod" && a.refId === id).reduce((s, a) => s + a.qty, 0));
  const prixMoyen = (id) => { const a = achatsOk.filter((x) => x.matId === id); const q = a.reduce((s, x) => s + x.qty, 0); return q > 0 ? Math.round(a.reduce((s, x) => s + x.amount, 0) / q * 10000) / 10000 : 0; };
  const coutLot = (l) => { const m = inR2((l.lines || []).reduce((s, x) => s + x.cost, 0)); const mo = inR2((l.hours || 0) * (l.rate || 0)); const fr = inR2(l.frais || 0); return { m, mo, fr, total: inR2(m + mo + fr) }; };
  // coût de revient moyen d'une unité du produit (moyenne des lots fabriqués : matières + main-d'œuvre + frais) ; 0 = pas encore de lot
  const coutUnit = (id) => { const ls = lotsOk.filter((l) => l.productId === id); const q = ls.reduce((s2, l) => s2 + l.qty, 0); return q > 0 ? inR2(ls.reduce((s2, l) => s2 + coutLot(l).total, 0) / q) : 0; };
  const etatCmd = (c) => (IN_ETATS_CMD.find((e) => e[0] === c.status) || [0, c.status])[1];
  const [nouvCat, setNouvCat] = useState("");
  const [imprimer, setImprimer] = useState(null); // { kind: "devis" | "facture" | "lot", id }
  const [tk, setTk] = useState(false);
  const [selCmd, setSelCmd] = useState("");
  const [selFact, setSelFact] = useState("");
  const [selProd, setSelProd] = useState("");
  const [selLot, setSelLot] = useState("");
  const listes = (<><datalist id="in-dl-unit">{inUniq(["kg", "g", "litre", "ml", "pièce", "mètre", "m²", "planche", "sac", "boîte", ...mats.map((m) => m.unit), ...prods.map((p) => p.unit)]).map((n) => <option key={n} value={n} />)}</datalist><datalist id="in-dl-four">{inUniq([...(suppliers || []).map((x) => x.name), ...achats.map((a) => a.supplier), ...deps.map((d) => d.supplier)]).map((n) => <option key={n} value={n} />)}</datalist></>);

  // ───────── Clients ─────────
  const [fcl, setFcl] = useBrouillon("indus-client", { name: "", phone: "", address: "" });
  const [cq, setCq] = useState("");
  const ajouterClient = () => {
    if (!canFront) return;
    const name = fcl.name.trim();
    if (!name) { showToast("Indiquez le nom du client."); return; }
    if (clients.some((c) => inNom(c.name) === inNom(name))) { showToast("Un client de ce nom existe déjà."); return; }
    ajouter({ type: "client", id: inId(), name, phone: fcl.phone.trim(), address: fcl.address.trim() });
    setFcl({ name: "", phone: "", address: "" });
    showToast("Client « " + name + " » ajouté."); logAudit("Industries", "Client ajouté", name);
  };
  const Clients = () => {
    const rows = clients.filter((c) => !cq.trim() || [c.name, c.phone, c.address].join(" ").toLowerCase().includes(cq.trim().toLowerCase()));
    const dus = (c) => inR2(factsOk.filter((f) => f.clientId === c.id).reduce((s, f) => s + inSolde(f).reste, 0));
    return (
      <div>
        {canFront && (<div className="ec-card p-4 mb-5"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouveau client</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom</label><input value={fcl.name} onChange={(e) => setFcl({ ...fcl, name: e.target.value })} data-testid="in-cl-nom" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Téléphone</label><input value={fcl.phone} onChange={(e) => setFcl({ ...fcl, phone: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Adresse</label><input value={fcl.address} onChange={(e) => setFcl({ ...fcl, address: e.target.value })} className={ecInput} style={ecBorder} /></div>
          </div>
          <button onClick={ajouterClient} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="in-cl-ajouter">Ajouter le client</button></div>)}
        <div className="mb-2"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (nom, téléphone, adresse)</label><input value={cq} onChange={(e) => setCq(e.target.value)} data-testid="in-cl-recherche" className={ecInput} style={ecBorder} /></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Client</th><th>Téléphone</th><th>Adresse</th><th className="text-right">Commandes</th><th className="text-right">Reste dû</th></tr></thead>
          <tbody>{rows.map((c) => (<tr key={c.id} data-testid="in-cl-ligne"><td className="py-1.5 font-semibold">{c.name}</td><td>{c.phone || "—"}</td><td className="text-xs">{c.address || "—"}</td><td className="text-right tabular">{cmds.filter((x) => x.clientId === c.id && x.status !== "annulee").length}</td><td className="text-right tabular">{fmt(dus(c))}</td></tr>))}</tbody>
          {rows.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="in-cl-total-ligne"><td colSpan={4}>Total ({rows.length} client{rows.length > 1 ? "s" : ""})</td><td className="text-right tabular" data-testid="in-cl-tot-du">{fmt(inR2(rows.reduce((s, c) => s + dus(c), 0)))}</td></tr></tfoot>}</table></div>
        {rows.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{clients.length === 0 ? "Aucun client. Les ventes au comptoir peuvent se faire sans client (« client de passage »)." : "Aucun client ne correspond à la recherche."}</div>}
      </div>
    );
  };

  // ───────── Matières et achats ─────────
  const [fm, setFm] = useBrouillon("indus-mat", { name: "", unit: "", min: "" });
  const [fa, setFa] = useBrouillon("indus-achat", { matId: "", date: todayStr(), qty: "", amount: "", supplier: "", mode: "caisse" });
  const [fadj, setFadj] = useState({ qty: "", reason: "" });
  const [rg, setRg] = useState({ amount: "", date: todayStr(), mode: "caisse" });
  const [mq, setMq] = useState(""); const [mb, setMb] = useState("");
  const [selMat, setSelMat] = useState(""); const [selAchat, setSelAchat] = useState("");
  const ajouterMat = () => {
    if (!canEdit) return;
    const name = fm.name.trim();
    if (!name) { showToast("Indiquez le nom de la matière (ex. Farine, Soude, Planche de pin)."); return; }
    if (!fm.unit.trim()) { showToast("Indiquez l'unité (kg, litre, pièce, planche…)."); return; }
    if (mats.some((m) => inNom(m.name) === inNom(name))) { showToast("Une matière de ce nom existe déjà."); return; }
    const min = inQ(fm.min);
    if (min < 0) { showToast("Le seuil d'alerte ne peut pas être négatif."); return; }
    ajouter({ type: "mat", id: inId(), name, unit: fm.unit.trim(), min, active: true });
    setFm({ name: "", unit: "", min: "" });
    showToast("Matière « " + name + " » ajoutée."); logAudit("Industries", "Matière ajoutée", name);
  };
  const acheter = () => {
    if (!canEdit) return;
    const qty = inQ(fa.qty), amount = inR2(fa.amount);
    if (!fa.matId) { showToast("Choisissez la matière achetée."); return; }
    if (!(qty > 0)) { showToast("La quantité doit être supérieure à zéro."); return; }
    if (!(amount > 0)) { showToast("Indiquez le montant total payé (en gourdes)."); return; }
    if (fa.mode === "apayer" && !fa.supplier.trim()) { showToast("Pour un achat à payer plus tard, indiquez le fournisseur."); return; }
    if (!verifDate(fa.date, "enregistrer cet achat")) return;
    const cpt = compteMode(fa.mode);
    inAjouterComptes(accounts, setAccounts, ["601", cpt]);
    const e = ecrire(fa.date, "Achat " + nomMat(fa.matId) + (fa.supplier.trim() ? " — " + fa.supplier.trim() : ""), [{ account: "601", debit: amount, credit: 0 }, { account: cpt, debit: 0, credit: amount }], fa.matId);
    ajouter({ type: "achat", id: inId(), date: fa.date, matId: fa.matId, qty, amount, supplier: fa.supplier.trim(), mode: fa.mode, entryId: e.id, status: "valide", settlements: [], by: currentUserEmail || "" });
    setFa({ ...fa, qty: "", amount: "" });
    showToast("Achat enregistré : " + qty + " " + unitMat(fa.matId) + " pour " + fmt(amount) + "."); logAudit("Industries", "Achat de matière", nomMat(fa.matId) + " — " + fmt(amount));
  };
  const resteAchat = (a) => (a.mode === "apayer" && a.status !== "annulé" ? inR2(a.amount - inPaye(a.settlements)) : 0);
  const annulerAchat = (a) => {
    if (!canEdit || a.status === "annulé") return;
    if (inPaye(a.settlements) > 0) { showToast("Annulez d'abord les règlements de cet achat."); return; }
    if (stockMat(a.matId) - a.qty < -0.0005) { showToast("Annulation impossible : cette matière a déjà été utilisée dans des lots (le stock deviendrait négatif)."); return; }
    if (!verifDate(today, "annuler cet achat")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler cet achat ? Une écriture inverse sera passée.")) return;
    const e = contre(a.entryId, "Annulation achat " + nomMat(a.matId) + " (écriture inverse)", today, a.matId);
    maj(a.id, (r) => ({ ...r, status: "annulé", reversalEntryId: e ? e.id : "" }));
    showToast("Achat annulé.");
  };
  const reglerAchat = (a) => {
    if (!canEdit || a.mode !== "apayer" || a.status === "annulé") return;
    const reste = resteAchat(a);
    const amount = rg.amount === "" ? reste : inR2(rg.amount);
    if (!(amount > 0) || amount > reste + 0.004) { showToast("Le montant doit être compris entre 0 et le reste à payer (" + fmt(reste) + ")."); return; }
    if (!verifDate(rg.date, "enregistrer ce règlement")) return;
    const cpt = compteMode(rg.mode === "banque" ? "banque" : "caisse");
    inAjouterComptes(accounts, setAccounts, [cpt, "401"]);
    const e = ecrire(rg.date, "Règlement " + (a.supplier || "fournisseur") + " — " + nomMat(a.matId), [{ account: "401", debit: amount, credit: 0 }, { account: cpt, debit: 0, credit: amount }], a.id);
    maj(a.id, (r) => ({ ...r, settlements: [...(r.settlements || []), { id: inId(), date: rg.date, amount, mode: rg.mode, entryId: e.id, status: "valide" }] }));
    setRg({ ...rg, amount: "" }); showToast("Règlement de " + fmt(amount) + " enregistré."); logAudit("Industries", "Dette réglée", (a.supplier || "") + " — " + fmt(amount));
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
    const qty = inQ(fadj.qty);
    if (qty === 0) { showToast("Indiquez la quantité à retirer (négatif) ou à ajouter (positif)."); return; }
    if (!fadj.reason.trim()) { showToast("Indiquez le motif (casse, perte, inventaire, don…)."); return; }
    const courant = target === "mat" ? stockMat(refId) : stockProd(refId);
    if (courant + qty < -0.0005) { showToast("Le stock ne peut pas devenir négatif (stock actuel : " + courant + ")."); return; }
    ajouter({ type: "ajust", id: inId(), date: today, target, refId, qty, reason: fadj.reason.trim(), status: "valide", by: currentUserEmail || "" });
    setFadj({ qty: "", reason: "" });
    showToast("Stock ajusté."); logAudit("Industries", "Ajustement de stock", (target === "mat" ? nomMat(refId) : nomProd(refId)) + " : " + qty + " — " + fadj.reason.trim());
  };
  const Matieres = () => {
    const etatMat = (m) => (m.active === false ? "arret" : stockMat(m.id) <= (m.min || 0) && (m.min || 0) > 0 ? "bas" : "ok");
    const rows = mats.filter((m) => (!mb || etatMat(m) === mb) && (!mq.trim() || [m.name, m.unit].join(" ").toLowerCase().includes(mq.trim().toLowerCase())));
    const valeur = (m) => inR2(stockMat(m.id) * prixMoyen(m.id));
    const m = mats.find((x) => x.id === selMat);
    return (
      <div>
        {canEdit && (<div className="grid md:grid-cols-2 gap-4 mb-5">
          <div className="ec-card p-4"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvelle matière première</div>
            <div className="grid grid-cols-2 gap-2 items-end">
              <div className="col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom (farine, soude, huile, planche de pin, tissu…)</label><input value={fm.name} onChange={(e) => setFm({ ...fm, name: e.target.value })} data-testid="in-mat-nom" className={ecInput} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Unité</label><input list="in-dl-unit" value={fm.unit} onChange={(e) => setFm({ ...fm, unit: e.target.value })} data-testid="in-mat-unite" className={ecInput} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Seuil d'alerte (facultatif)</label><input type="number" min="0" step="0.001" value={fm.min} onChange={(e) => setFm({ ...fm, min: e.target.value })} data-testid="in-mat-seuil" className={ecInput + " tabular"} style={ecBorder} /></div>
            </div>
            <button onClick={ajouterMat} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="in-mat-ajouter">Ajouter la matière</button></div>
          <div className="ec-card p-4"><div className="display text-base mb-2" style={{ color: "#152238" }}>Acheter des matières</div>
            <div className="grid grid-cols-2 gap-2 items-end">
              <div className="col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Matière</label><select value={fa.matId} onChange={(e) => setFa({ ...fa, matId: e.target.value })} data-testid="in-ach-mat" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{mats.filter((x) => x.active !== false).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Quantité achetée</label><input type="number" min="0" step="0.001" value={fa.qty} onChange={(e) => setFa({ ...fa, qty: e.target.value })} data-testid="in-ach-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant total payé</label><input type="number" min="0" step="0.01" value={fa.amount} onChange={(e) => setFa({ ...fa, amount: e.target.value })} data-testid="in-ach-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" value={fa.date} max={today} onChange={(e) => setFa({ ...fa, date: e.target.value })} data-testid="in-ach-date" className={ecInput} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Fournisseur</label><input list="in-dl-four" value={fa.supplier} onChange={(e) => setFa({ ...fa, supplier: e.target.value })} data-testid="in-ach-fournisseur" className={ecInput} style={ecBorder} /></div>
              <div className="col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Paiement</label><select value={fa.mode} onChange={(e) => setFa({ ...fa, mode: e.target.value })} data-testid="in-ach-mode" className={ecInput} style={ecBorder}><option value="caisse">Payé en caisse</option><option value="banque">Payé par la banque</option><option value="apayer">À payer plus tard (dette fournisseur)</option></select></div>
            </div>
            <button onClick={acheter} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="in-ach-enregistrer">Enregistrer l'achat</button></div>
        </div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <div className="flex-1 min-w-[150px]"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (nom, unité)</label><input value={mq} onChange={(e) => setMq(e.target.value)} data-testid="in-mat-recherche" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>État du stock</label><select value={mb} onChange={(e) => setMb(e.target.value)} data-testid="in-mat-filtre-etat" className={ecInput} style={ecBorder}><option value="">Tous</option><option value="bas">Stock bas</option><option value="ok">Normal</option><option value="arret">Arrêtée</option></select></div>
        </div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Matière</th><th>Unité</th><th className="text-right">En stock</th><th className="text-right">Prix moyen d'achat</th><th className="text-right">Valeur du stock</th><th>État</th><th></th></tr></thead>
          <tbody>{rows.map((x) => { const e = etatMat(x); return (
            <tr key={x.id} data-testid="in-mat-ligne" style={{ background: x.id === selMat ? "#E6F1EE" : undefined, opacity: e === "arret" ? 0.55 : 1 }}><td className="py-1.5 font-semibold">{x.name}</td><td>{x.unit}</td><td className="text-right tabular" data-testid="in-mat-stock">{stockMat(x.id)}</td><td className="text-right tabular">{prixMoyen(x.id) ? fmt(prixMoyen(x.id)) : "—"}</td><td className="text-right tabular">{fmt(valeur(x))}</td>
              <td>{e === "bas" ? ecPastille("Stock bas", "alerte") : e === "arret" ? ecPastille("Arrêtée", "neutre") : ecPastille("Normal", "ok")}</td>
              <td className="text-right"><button onClick={() => setSelMat(x.id === selMat ? "" : x.id)} className="text-xs underline" data-testid="in-mat-ouvrir">{x.id === selMat ? "Fermer" : "Ouvrir"}</button></td></tr>); })}</tbody>
          {rows.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="in-mat-total-ligne"><td colSpan={4}>Total ({rows.length} matière{rows.length > 1 ? "s" : ""})</td><td className="text-right tabular" data-testid="in-mat-tot-valeur">{fmt(inR2(rows.reduce((s, x) => s + valeur(x), 0)))}</td><td colSpan={2}></td></tr></tfoot>}</table></div>
        {rows.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{mats.length === 0 ? "Aucune matière première." : "Aucune matière ne correspond à ces filtres."}</div>}
        {m && (<div className="ec-card p-4 mt-5" data-testid="in-mat-detail">
          <div className="display text-lg mb-2" style={{ color: "#152238" }}>{m.name} — en stock : <span className="tabular" data-testid="in-mat-d-stock">{stockMat(m.id)}</span> {m.unit}</div>
          <div className="grid md:grid-cols-3 gap-2 mb-3 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Seuil d'alerte</label><input type="number" min="0" step="0.001" value={m.min || 0} disabled={!canEdit} onChange={(e) => maj(m.id, (r) => ({ ...r, min: Math.max(0, inQ(e.target.value)) }))} data-testid="in-mat-d-seuil" className={ecInput + " tabular"} style={ecBorder} /></div>
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={m.active !== false} disabled={!canEdit} onChange={(e) => maj(m.id, (r) => ({ ...r, active: e.target.checked }))} data-testid="in-mat-actif" />Matière utilisée (décochez si arrêtée)</label>
          </div>
          {canEdit && (<div className="grid md:grid-cols-4 gap-2 mb-3 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Ajuster le stock (− retire, + ajoute)</label><input type="number" step="0.001" value={fadj.qty} onChange={(e) => setFadj({ ...fadj, qty: e.target.value })} data-testid="in-adj-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Motif (casse, perte, inventaire…)</label><input value={fadj.reason} onChange={(e) => setFadj({ ...fadj, reason: e.target.value })} data-testid="in-adj-motif" className={ecInput} style={ecBorder} /></div>
            <button onClick={() => ajusterStock("mat", m.id)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="in-adj-ok">Ajuster</button>
          </div>)}
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Achats de cette matière</div>
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Fournisseur</th><th className="text-right">Quantité</th><th className="text-right">Montant</th><th>Paiement</th><th></th></tr></thead>
            <tbody>{achats.filter((a) => a.matId === m.id).map((a) => (<tr key={a.id} data-testid="in-ach-ligne" style={{ opacity: a.status === "annulé" ? 0.5 : 1 }}><td className="py-1.5">{ecDateFr(a.date)}</td><td>{a.supplier || "—"}</td><td className="text-right tabular">{a.qty}</td><td className="text-right tabular">{fmt(a.amount)}</td>
              <td>{a.status === "annulé" ? ecPastille("Annulé", "neutre") : a.mode === "apayer" ? (resteAchat(a) > 0.004 ? ecPastille("À payer : " + fmt(resteAchat(a)), "attente") : ecPastille("Payé", "ok")) : ecPastille(a.mode === "banque" ? "Banque" : "Caisse", "ok")}</td>
              <td className="text-right whitespace-nowrap">{canEdit && a.mode === "apayer" && a.status !== "annulé" && <button onClick={() => setSelAchat(a.id === selAchat ? "" : a.id)} className="text-xs underline mr-2" data-testid="in-ach-regler">Régler</button>}{canEdit && a.status !== "annulé" && <button onClick={() => annulerAchat(a)} className="text-xs underline" data-testid="in-ach-annuler">Annuler</button>}</td></tr>))}</tbody></table></div>
          {achats.filter((a) => a.matId === m.id).length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun achat enregistré.</div>}
          {canEdit && achats.filter((a) => a.id === selAchat && a.matId === m.id).map((a) => (<div key={a.id} className="ec-card p-3 mt-3" data-testid="in-reg-form"><div className="text-sm mb-2">Règlement de {a.supplier || "fournisseur"} — reste à payer <b className="tabular">{fmt(resteAchat(a))}</b></div>
            <div className="grid md:grid-cols-4 gap-2 items-end">
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant (vide = tout le reste)</label><input type="number" min="0" step="0.01" value={rg.amount} onChange={(e) => setRg({ ...rg, amount: e.target.value })} data-testid="in-reg-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={rg.date} onChange={(e) => setRg({ ...rg, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Mode</label><select value={rg.mode} onChange={(e) => setRg({ ...rg, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Caisse</option><option value="banque">Banque</option></select></div>
              <button onClick={() => reglerAchat(a)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="in-reg-valider">Enregistrer le règlement</button>
            </div>
            {(a.settlements || []).map((s) => (<div key={s.id} className="text-xs mt-1" data-testid="in-reg-ligne" style={{ opacity: s.status === "annulé" ? 0.5 : 1 }}>{ecDateFr(s.date)} — {fmt(s.amount)} ({s.mode === "banque" ? "banque" : "caisse"}){s.status === "annulé" ? " — annulé" : <button onClick={() => annulerReglement(a, s)} className="underline ml-2" data-testid="in-reg-annuler">Annuler</button>}</div>))}
          </div>))}
        </div>)}
      </div>
    );
  };

  // ───────── Produits et recettes ─────────
  const [fp, setFp] = useBrouillon("indus-produit", { name: "", unit: "", price: "", cat: "", desc: "", photo: "" });
  const [pq, setPq] = useState("");
  const [fr, setFr] = useState({ outQty: "", matId: "", qty: "" });
  const choisirPhoto = async (e, prodId) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { const url = await inRedimensionner(f, 420); if (prodId) maj(prodId, (r) => ({ ...r, photo: url })); else setFp((x) => ({ ...(x || {}), photo: url })); showToast("Photo ajoutée (réduite à 420 px pour rester légère)."); }
    catch (err) { showToast("Cette image n'a pas pu être lue. Essayez un fichier JPG ou PNG."); }
  };
  const ajouterProd = () => {
    if (!canEdit) return;
    const name = fp.name.trim();
    if (!name) { showToast("Indiquez le nom du produit (ex. Pain, Savon 200 g, Table 6 places)."); return; }
    if (!fp.unit.trim()) { showToast("Indiquez l'unité de vente (pièce, kg, litre, boîte…)."); return; }
    if (prods.some((p) => inNom(p.name) === inNom(name))) { showToast("Un produit de ce nom existe déjà."); return; }
    const price = fp.price === "" ? 0 : inR2(fp.price);
    if (price < 0) { showToast("Le prix de vente ne peut pas être négatif."); return; }
    ajouter({ type: "prod", id: inId(), name, unit: fp.unit.trim(), price, cat: fp.cat || "autre", desc: (fp.desc || "").trim(), photo: fp.photo || "", active: true });
    setFp({ name: "", unit: "", price: "", cat: fp.cat || "", desc: "", photo: "" });
    showToast("Produit « " + name + " » ajouté."); logAudit("Industries", "Produit ajouté", name);
  };
  const [npx, setNpx] = useState("");
  const redresserPrix = (p, cu) => {
    if (!canEdit) return;
    const prix = npx === "" ? Math.ceil(cu) : inR2(npx);
    if (!(prix > 0)) { showToast("Indiquez un prix supérieur à zéro."); return; }
    maj(p.id, (r) => ({ ...r, price: prix, prixRedresseLe: todayStr() }));
    setNpx(""); showToast("Prix de « " + p.name + " » : " + fmt(prix) + (prix + 0.004 < cu ? " (encore sous le coût de revient)." : "."));
    logAudit("Industries", "Prix redressé", p.name + " : " + fmt(Number(p.price) || 0) + " → " + fmt(prix) + " (coût moyen " + fmt(cu) + ")");
  };
  const recetteDe = (id) => recettes.find((r) => r.productId === id);
  const ajouterLigneRecette = (p) => {
    if (!canEdit) return;
    const qty = inQ(fr.qty);
    if (!fr.matId) { showToast("Choisissez la matière à ajouter à la recette."); return; }
    if (!(qty > 0)) { showToast("La quantité de matière doit être supérieure à zéro."); return; }
    const r = recetteDe(p.id);
    if (r && r.lines.some((l) => l.matId === fr.matId)) { showToast("Cette matière figure déjà dans la recette."); return; }
    if (!r) {
      const out = inQ(fr.outQty);
      if (!(out > 0)) { showToast("Indiquez d'abord combien d'unités donne une fabrication (ex. 40 pains)."); return; }
      ajouter({ type: "rec", id: inId(), productId: p.id, outQty: out, lines: [{ matId: fr.matId, qty }] });
    } else maj(r.id, (x) => ({ ...x, lines: [...x.lines, { matId: fr.matId, qty }] }));
    setFr({ ...fr, matId: "", qty: "" });
    showToast("Matière ajoutée à la recette.");
  };
  const Produits = () => {
    const rows = prods.filter((p) => !pq.trim() || [p.name, p.unit].join(" ").toLowerCase().includes(pq.trim().toLowerCase()));
    const p = prods.find((x) => x.id === selProd);
    const rec = p ? recetteDe(p.id) : null;
    const coutRecette = (r) => inR2(r.lines.reduce((s, l) => s + l.qty * prixMoyen(l.matId), 0));
    return (
      <div>
        {canEdit && (<div className="ec-card p-4 mb-5"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouveau produit fini</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Nom du produit</label><input value={fp.name} onChange={(e) => setFp({ ...fp, name: e.target.value })} data-testid="in-prod-nom" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Unité de vente</label><input list="in-dl-unit" value={fp.unit} onChange={(e) => setFp({ ...fp, unit: e.target.value })} data-testid="in-prod-unite" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Prix de vente (facultatif)</label><input type="number" min="0" step="0.01" value={fp.price} onChange={(e) => setFp({ ...fp, price: e.target.value })} data-testid="in-prod-prix" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Catégorie du catalogue</label><select value={fp.cat || ""} onChange={(e) => setFp({ ...fp, cat: e.target.value })} data-testid="in-prod-cat" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{catsAll.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Description courte (facultatif)</label><input value={fp.desc || ""} onChange={(e) => setFp({ ...fp, desc: e.target.value })} data-testid="in-prod-desc" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Photo (facultatif)</label><div className="flex items-center gap-2"><input type="file" accept="image/*" onChange={(e) => choisirPhoto(e, "")} data-testid="in-prod-photo" className="text-xs" style={{ maxWidth: 170 }} />{fp.photo && <img src={fp.photo} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 6 }} data-testid="in-prod-photo-apercu" />}</div></div>
          </div>
          <button onClick={ajouterProd} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="in-prod-ajouter">Ajouter le produit</button></div>)}
        <div className="mb-2"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (nom, unité)</label><input value={pq} onChange={(e) => setPq(e.target.value)} data-testid="in-prod-recherche" className={ecInput} style={ecBorder} /></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Produit</th><th>Unité</th><th className="text-right">Prix de vente</th><th className="text-right">En stock</th><th>Recette</th><th></th></tr></thead>
          <tbody>{rows.map((x) => (<tr key={x.id} data-testid="in-prod-ligne" style={{ background: x.id === selProd ? "#E6F1EE" : undefined }}><td className="py-1.5 font-semibold">{x.name}</td><td>{x.unit}</td><td className="text-right tabular">{x.price ? fmt(x.price) : "—"}</td><td className="text-right tabular" data-testid="in-prod-stock">{stockProd(x.id)}</td><td>{recetteDe(x.id) ? ecPastille("Définie", "ok") : ecPastille("Aucune", "neutre")}</td>
            <td className="text-right"><button onClick={() => setSelProd(x.id === selProd ? "" : x.id)} className="text-xs underline" data-testid="in-prod-ouvrir">{x.id === selProd ? "Fermer" : "Ouvrir"}</button></td></tr>))}</tbody>
          {rows.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="in-prod-total-ligne"><td colSpan={3}>Total ({rows.length} produit{rows.length > 1 ? "s" : ""})</td><td className="text-right tabular" data-testid="in-prod-tot-stock">{inQ(rows.reduce((s, x) => s + stockProd(x.id), 0))}</td><td colSpan={2}></td></tr></tfoot>}</table></div>
        {rows.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{prods.length === 0 ? "Aucun produit. Un produit sur mesure unique (table, robe) n'a pas besoin d'être créé : saisissez-le directement dans la commande." : "Aucun produit ne correspond à la recherche."}</div>}
        {p && (<div className="ec-card p-4 mt-5" data-testid="in-prod-detail">
          <div className="display text-lg mb-2" style={{ color: "#152238" }}>{p.name} — en stock : <span className="tabular">{stockProd(p.id)}</span> {p.unit}</div>
          <div className="grid md:grid-cols-3 gap-2 mb-3 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Prix de vente</label><input type="number" min="0" step="0.01" value={p.price || 0} disabled={!canEdit} onChange={(e) => maj(p.id, (r) => ({ ...r, price: Math.max(0, inR2(e.target.value)) }))} data-testid="in-prod-d-prix" className={ecInput + " tabular"} style={ecBorder} /></div>
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={p.active !== false} disabled={!canEdit} onChange={(e) => maj(p.id, (r) => ({ ...r, active: e.target.checked }))} data-testid="in-prod-actif" />Produit fabriqué (décochez si arrêté)</label>
          </div>
          <div className="grid md:grid-cols-3 gap-2 mb-3 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Catégorie du catalogue</label><select value={catDe(p)} disabled={!canEdit} onChange={(e) => maj(p.id, (r) => ({ ...r, cat: e.target.value }))} data-testid="in-prod-d-cat" className={ecInput} style={ecBorder}>{catsAll.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Description courte</label><input value={p.desc || ""} disabled={!canEdit} onChange={(e) => maj(p.id, (r) => ({ ...r, desc: e.target.value }))} data-testid="in-prod-d-desc" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Photo</label><div className="flex items-center gap-2">{canEdit && <input type="file" accept="image/*" onChange={(e) => choisirPhoto(e, p.id)} data-testid="in-prod-d-photo" className="text-xs" style={{ maxWidth: 170 }} />}{p.photo && <img src={p.photo} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 6 }} />}{canEdit && p.photo && <button onClick={() => maj(p.id, (r) => ({ ...r, photo: "" }))} className="text-xs" style={{ color: "#A6432F" }}>Retirer</button>}</div></div>
          </div>
          {canEdit && coutUnit(p.id) > 0 && (() => { const cu = coutUnit(p.id), pr = Number(p.price) || 0, sous = pr > 0 && pr + 0.004 < cu, conseil = Math.ceil(cu); return (
            <div className="p-3 rounded mb-3 text-sm" style={{ background: sous ? "#FBE9E4" : "#F4F1E6", color: sous ? "#7A2E1F" : "#5B563F" }} data-testid="in-prod-redress">
              <div>Coût de revient moyen : <b className="tabular" data-testid="in-prod-d-cout">{fmt(cu)}</b> par {p.unit} · prix de vente : <b className="tabular">{pr > 0 ? fmt(pr) : "non fixé"}</b>{pr > 0 && <> · {sous ? <b>perte de {fmt(inR2(cu - pr))} par {p.unit}</b> : <>marge {fmt(inR2(pr - cu))} ({Math.round((pr - cu) * 100 / pr)} %)</>}</>}</div>
              {sous && <div className="mt-1">Le prix est <b>inférieur au coût</b> : chaque vente creuse le déficit. Redressez le prix, ou vérifiez les lots (matières ou heures surévaluées ?).</div>}
              <div className="flex flex-wrap items-end gap-2 mt-2"><div><label className="text-xs" style={{ color: "#8A8370" }}>Nouveau prix de vente (au moins {fmt(conseil)} pour couvrir le coût)</label><input type="number" min="0" step="0.01" value={npx} placeholder={String(conseil)} onChange={(e) => setNpx(e.target.value)} data-testid="in-prod-redress-prix" className={ecInput + " tabular"} style={ecBorder} /></div>
                <button onClick={() => redresserPrix(p, cu)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="in-prod-redress-ok">Enregistrer le nouveau prix</button>
                <button onClick={() => setTab("production")} className="px-3 py-2 rounded text-sm" style={ecBtn}>Voir les lots</button></div>
            </div>); })()}
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Recette (matières pour une fabrication)</div>
          <div className="text-xs mb-2" style={{ color: "#8A8370" }}>La recette prépare la saisie d'un lot : vous pourrez toujours corriger les quantités réellement utilisées. Le coût estimé utilise le prix moyen d'achat de chaque matière.</div>
          {rec && (<div className="text-sm mb-2" data-testid="in-rec-resume">Une fabrication donne <b>{rec.outQty}</b> {p.unit} — coût estimé des matières : <b className="tabular" data-testid="in-rec-cout">{fmt(coutRecette(rec))}</b>{rec.outQty > 0 ? " (soit " + fmt(inR2(coutRecette(rec) / rec.outQty)) + " par " + p.unit + ")" : ""}</div>)}
          {rec && (<div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Matière</th><th className="text-right">Quantité</th><th className="text-right">Coût estimé</th><th></th></tr></thead>
            <tbody>{rec.lines.map((l) => (<tr key={l.matId} data-testid="in-rec-ligne"><td className="py-1.5">{nomMat(l.matId)}</td><td className="text-right tabular">{l.qty} {unitMat(l.matId)}</td><td className="text-right tabular">{fmt(inR2(l.qty * prixMoyen(l.matId)))}</td><td className="text-right">{canEdit && <button onClick={() => { if (rec.lines.length === 1) { setIndus((prev) => prev.filter((x) => x.id !== rec.id)); } else maj(rec.id, (x) => ({ ...x, lines: x.lines.filter((y) => y.matId !== l.matId) })); }} className="text-xs underline" data-testid="in-rec-retirer">Retirer</button>}</td></tr>))}</tbody></table></div>)}
          {canEdit && (<div className="grid md:grid-cols-4 gap-2 items-end">
            {!rec && <div><label className="text-xs" style={{ color: "#8A8370" }}>Une fabrication donne (en {p.unit})</label><input type="number" min="0" step="0.001" value={fr.outQty} onChange={(e) => setFr({ ...fr, outQty: e.target.value })} data-testid="in-rec-sortie" className={ecInput + " tabular"} style={ecBorder} /></div>}
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Matière</label><select value={fr.matId} onChange={(e) => setFr({ ...fr, matId: e.target.value })} data-testid="in-rec-mat" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{mats.filter((x) => x.active !== false).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Quantité</label><input type="number" min="0" step="0.001" value={fr.qty} onChange={(e) => setFr({ ...fr, qty: e.target.value })} data-testid="in-rec-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
            <button onClick={() => ajouterLigneRecette(p)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="in-rec-ajouter">Ajouter à la recette</button>
          </div>)}
          {canEdit && (<div className="grid md:grid-cols-4 gap-2 items-end mt-3"><div><label className="text-xs" style={{ color: "#8A8370" }}>Ajuster le stock du produit (− / +)</label><input type="number" step="0.001" value={fadj.qty} onChange={(e) => setFadj({ ...fadj, qty: e.target.value })} data-testid="in-padj-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Motif (invendus, casse, don…)</label><input value={fadj.reason} onChange={(e) => setFadj({ ...fadj, reason: e.target.value })} data-testid="in-padj-motif" className={ecInput} style={ecBorder} /></div>
            <button onClick={() => ajusterStock("prod", p.id)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="in-padj-ok">Ajuster</button></div>)}
        </div>)}
      </div>
    );
  };

  // ───────── Production (lots de fabrication) ─────────
  const lotVide = () => ({ productId: "", label: "", date: todayStr(), qty: "", orderId: "", expire: "", hours: "", rate: "", frais: "", notes: "", lines: [], matId: "", mqty: "" });
  const [fl, setFl] = useBrouillon("indus-lot", lotVide());
  const [lq, setLq] = useState(""); const [lp, setLp] = useState("");
  const remplirRecette = () => {
    const r = fl.productId ? recetteDe(fl.productId) : null;
    if (!r) { showToast("Ce produit n'a pas de recette (onglet Produits et recettes)."); return; }
    const q = inQ(fl.qty);
    if (!(q > 0)) { showToast("Indiquez d'abord la quantité à fabriquer."); return; }
    setFl({ ...fl, lines: r.lines.map((l) => ({ matId: l.matId, qty: inQ(l.qty * q / r.outQty) })) });
  };
  const ajouterLigneLot = () => {
    const q = inQ(fl.mqty);
    if (!fl.matId) { showToast("Choisissez la matière utilisée."); return; }
    if (!(q > 0)) { showToast("La quantité utilisée doit être supérieure à zéro."); return; }
    if (fl.lines.some((l) => l.matId === fl.matId)) { showToast("Cette matière est déjà dans la liste : corrigez sa quantité."); return; }
    setFl({ ...fl, lines: [...fl.lines, { matId: fl.matId, qty: q }], matId: "", mqty: "" });
  };
  const creerLot = () => {
    if (!canEdit) return;
    const qty = inQ(fl.qty);
    if (!fl.productId && !fl.label.trim()) { showToast("Choisissez un produit, ou décrivez la pièce sur mesure."); return; }
    if (!(qty > 0)) { showToast("La quantité fabriquée doit être supérieure à zéro."); return; }
    if (!verifDate(fl.date, "enregistrer cette fabrication")) return;
    if (fl.lines.length === 0) { showToast("Indiquez au moins une matière utilisée."); return; }
    const hours = fl.hours === "" ? 0 : Number(fl.hours), rate = fl.rate === "" ? 0 : inR2(fl.rate), frais = fl.frais === "" ? 0 : inR2(fl.frais);
    if (hours < 0 || rate < 0 || frais < 0) { showToast("Heures, taux horaire et frais ne peuvent pas être négatifs."); return; }
    if (fl.expire && fl.expire < fl.date) { showToast("La date limite de consommation ou d'utilisation ne peut pas précéder la fabrication."); return; }
    for (const l of fl.lines) { if (stockMat(l.matId) + 0.0005 < l.qty) { showToast("Stock insuffisant de " + nomMat(l.matId) + " : " + stockMat(l.matId) + " " + unitMat(l.matId) + " disponible, " + l.qty + " demandé."); return; } }
    const lines = fl.lines.map((l) => { const pu = prixMoyen(l.matId); return { matId: l.matId, qty: l.qty, pu, cost: inR2(l.qty * pu) }; });
    const number = numero("LT", lots, fl.date);
    const rec = { type: "lot", id: inId(), number, date: fl.date, productId: fl.productId, label: fl.productId ? "" : fl.label.trim(), qty, lines, hours, rate, frais, expire: fl.expire, orderId: fl.orderId, notes: fl.notes.trim(), status: "valide", by: currentUserEmail || "" };
    ajouter(rec);
    if (fl.orderId) maj(fl.orderId, (c) => (c.status === "confirmee" ? { ...c, status: "enprod" } : c));
    setFl(lotVide());
    showToast("Lot " + number + " enregistré : coût de revient " + fmt(coutLot(rec).total) + "."); logAudit("Industries", "Lot de fabrication", number + " — " + (fl.productId ? nomProd(fl.productId) : fl.label.trim()));
  };
  const annulerLot = (l) => {
    if (!canEdit || l.status === "annulé") return;
    if (l.productId && stockProd(l.productId) - l.qty < -0.0005) { showToast("Annulation impossible : une partie de ce lot a déjà été vendue (le stock du produit deviendrait négatif)."); return; }
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler ce lot ? Les matières reviennent en stock.")) return;
    maj(l.id, (r) => ({ ...r, status: "annulé", canceledAt: today }));
    showToast("Lot annulé : matières remises en stock."); logAudit("Industries", "Lot annulé", l.number);
  };
  const nomLot = (l) => (l.productId ? nomProd(l.productId) : l.label);
  const Production = () => {
    const rows = lots.filter((l) => (!lp || l.productId === lp) && (!lq.trim() || [l.number, nomLot(l), l.notes].join(" ").toLowerCase().includes(lq.trim().toLowerCase()))).sort((a, b) => (a.date < b.date ? 1 : -1));
    const rowsOk = rows.filter((l) => l.status !== "annulé");
    const l0 = lots.find((x) => x.id === selLot);
    const cmdsOuvertes = cmds.filter((c) => c.status === "confirmee" || c.status === "enprod");
    const prev = (() => { const q = inQ(fl.qty); const m = inR2(fl.lines.reduce((s, x) => s + x.qty * prixMoyen(x.matId), 0)); const mo = inR2((Number(fl.hours) || 0) * (Number(fl.rate) || 0)); const fr = inR2(Number(fl.frais) || 0); const t = inR2(m + mo + fr); return { m, mo, fr, t, u: q > 0 ? inR2(t / q) : 0 }; })();
    return (
      <div>
        {canEdit && (<div className="ec-card p-4 mb-5" data-testid="in-lot-form"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvelle fabrication (lot)</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Produit fabriqué</label><select value={fl.productId} onChange={(e) => setFl({ ...fl, productId: e.target.value })} data-testid="in-lot-produit" className={ecInput} style={ecBorder}><option value="">— pièce sur mesure —</option>{prods.filter((x) => x.active !== false).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select></div>
            {!fl.productId && <div><label className="text-xs" style={{ color: "#8A8370" }}>Description de la pièce</label><input value={fl.label} onChange={(e) => setFl({ ...fl, label: e.target.value })} data-testid="in-lot-label" className={ecInput} style={ecBorder} /></div>}
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Quantité fabriquée{fl.productId ? " (" + unitProd(fl.productId) + ")" : ""}</label><input type="number" min="0" step="0.001" value={fl.qty} onChange={(e) => setFl({ ...fl, qty: e.target.value })} data-testid="in-lot-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date de fabrication</label><input type="date" max={today} value={fl.date} onChange={(e) => setFl({ ...fl, date: e.target.value })} data-testid="in-lot-date" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Commande concernée (facultatif)</label><select value={fl.orderId} onChange={(e) => setFl({ ...fl, orderId: e.target.value })} data-testid="in-lot-commande" className={ecInput} style={ecBorder}><option value="">— aucune —</option>{cmdsOuvertes.map((c) => <option key={c.id} value={c.id}>{c.number} — {nomClient(c.clientId)}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>À consommer avant (facultatif)</label><input type="date" value={fl.expire} onChange={(e) => setFl({ ...fl, expire: e.target.value })} data-testid="in-lot-expire" className={ecInput} style={ecBorder} /></div>
          </div>
          <div className="display text-base mt-3 mb-1" style={{ color: "#152238" }}>Matières utilisées</div>
          {fl.productId && recetteDe(fl.productId) && <button onClick={remplirRecette} className="text-xs underline mb-2" data-testid="in-lot-recette">Remplir depuis la recette</button>}
          {fl.lines.length > 0 && (<div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Matière</th><th className="text-right">Quantité utilisée</th><th className="text-right">En stock</th><th className="text-right">Coût (prix moyen)</th><th></th></tr></thead>
            <tbody>{fl.lines.map((l) => (<tr key={l.matId} data-testid="in-lot-mligne"><td className="py-1.5">{nomMat(l.matId)}</td><td className="text-right"><input type="number" min="0" step="0.001" value={l.qty} onChange={(e) => setFl({ ...fl, lines: fl.lines.map((x) => (x.matId === l.matId ? { ...x, qty: inQ(e.target.value) } : x)) })} data-testid="in-lot-mqte" className="border rounded px-1 py-0.5 text-sm tabular text-right" style={{ ...ecBorder, width: 90 }} /> {unitMat(l.matId)}</td><td className="text-right tabular" style={{ color: stockMat(l.matId) + 0.0005 < l.qty ? "#A6432F" : undefined }}>{stockMat(l.matId)}</td><td className="text-right tabular">{fmt(inR2(l.qty * prixMoyen(l.matId)))}</td><td className="text-right"><button onClick={() => setFl({ ...fl, lines: fl.lines.filter((x) => x.matId !== l.matId) })} className="text-xs underline" data-testid="in-lot-mretirer">Retirer</button></td></tr>))}</tbody></table></div>)}
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Ajouter une matière</label><select value={fl.matId} onChange={(e) => setFl({ ...fl, matId: e.target.value })} data-testid="in-lot-mat" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{mats.filter((x) => x.active !== false).map((x) => <option key={x.id} value={x.id}>{x.name} (stock {stockMat(x.id)} {x.unit})</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Quantité</label><input type="number" min="0" step="0.001" value={fl.mqty} onChange={(e) => setFl({ ...fl, mqty: e.target.value })} data-testid="in-lot-mq" className={ecInput + " tabular"} style={ecBorder} /></div>
            <button onClick={ajouterLigneLot} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="in-lot-mpl">Ajouter</button>
          </div>
          <div className="display text-base mt-3 mb-1" style={{ color: "#152238" }}>Main-d'œuvre et frais de cette fabrication</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Heures de travail</label><input type="number" min="0" step="0.25" value={fl.hours} onChange={(e) => setFl({ ...fl, hours: e.target.value })} data-testid="in-lot-heures" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Taux horaire (gourdes)</label><input type="number" min="0" step="0.01" value={fl.rate} onChange={(e) => setFl({ ...fl, rate: e.target.value })} data-testid="in-lot-taux" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Autres frais (énergie, emballage…)</label><input type="number" min="0" step="0.01" value={fl.frais} onChange={(e) => setFl({ ...fl, frais: e.target.value })} data-testid="in-lot-frais" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Remarques</label><input value={fl.notes} onChange={(e) => setFl({ ...fl, notes: e.target.value })} className={ecInput} style={ecBorder} /></div>
          </div>
          <div className="text-sm mt-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#152238" }} data-testid="in-lot-apercu-cout">Coût estimé : matières <b className="tabular">{fmt(prev.m)}</b> + main-d'œuvre <b className="tabular">{fmt(prev.mo)}</b> + frais <b className="tabular">{fmt(prev.fr)}</b> = <b className="tabular" data-testid="in-lot-cout-total">{fmt(prev.t)}</b>{prev.u > 0 ? " — soit " + fmt(prev.u) + " par unité" : ""}. La main-d'œuvre sert au calcul du coût ; les salaires se paient dans le module Salaires.</div>
          <button onClick={creerLot} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="in-lot-enregistrer">Enregistrer la fabrication</button></div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <div className="flex-1 min-w-[150px]"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (n° de lot, produit, remarque)</label><input value={lq} onChange={(e) => setLq(e.target.value)} data-testid="in-lot-recherche" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Produit</label><select value={lp} onChange={(e) => setLp(e.target.value)} data-testid="in-lot-filtre-produit" className={ecInput} style={ecBorder}><option value="">Tous</option>{prods.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
        </div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>Date</th><th>Produit</th><th className="text-right">Quantité</th><th className="text-right">Coût de revient</th><th className="text-right">Coût unitaire</th><th>À consommer avant</th><th></th></tr></thead>
          <tbody>{rows.map((l) => { const c = coutLot(l); return (<tr key={l.id} data-testid="in-lot-ligne" style={{ background: l.id === selLot ? "#E6F1EE" : undefined, opacity: l.status === "annulé" ? 0.5 : 1 }}><td className="py-1.5 tabular text-xs">{l.number}</td><td>{ecDateFr(l.date)}</td><td className="font-semibold">{nomLot(l)}{l.status === "annulé" ? " (annulé)" : ""}</td><td className="text-right tabular">{l.qty}</td><td className="text-right tabular">{fmt(c.total)}</td><td className="text-right tabular">{fmt(inR2(c.total / l.qty))}</td><td>{l.expire ? ecDateFr(l.expire) : "—"}</td>
            <td className="text-right"><button onClick={() => setSelLot(l.id === selLot ? "" : l.id)} className="text-xs underline" data-testid="in-lot-ouvrir">{l.id === selLot ? "Fermer" : "Ouvrir"}</button></td></tr>); })}</tbody>
          {rows.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="in-lot-total-ligne"><td colSpan={3}>Total ({rowsOk.length} lot{rowsOk.length > 1 ? "s" : ""}, hors annulés)</td><td className="text-right tabular">{inQ(rowsOk.reduce((s, l) => s + l.qty, 0))}</td><td className="text-right tabular" data-testid="in-lot-tot-cout">{fmt(inR2(rowsOk.reduce((s, l) => s + coutLot(l).total, 0)))}</td><td colSpan={3}></td></tr></tfoot>}</table></div>
        {rows.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{lots.length === 0 ? "Aucune fabrication enregistrée." : "Aucun lot ne correspond à ces filtres."}</div>}
        {l0 && (() => { const c = coutLot(l0); return (<div className="ec-card p-4 mt-5" data-testid="in-lot-detail">
          <div className="display text-lg mb-2" style={{ color: "#152238" }}>{l0.number} — {nomLot(l0)} ({l0.qty}{l0.productId ? " " + unitProd(l0.productId) : ""})</div>
          <div className="text-sm mb-2">Matières <b className="tabular">{fmt(c.m)}</b> · main-d'œuvre ({l0.hours || 0} h × {fmt(l0.rate || 0)}) <b className="tabular">{fmt(c.mo)}</b> · frais <b className="tabular">{fmt(c.fr)}</b> · <b>coût de revient {fmt(c.total)}</b> · unitaire <b className="tabular" data-testid="in-lot-d-unit">{fmt(inR2(c.total / l0.qty))}</b>{l0.orderId ? " · commande " + ((cmds.find((x) => x.id === l0.orderId) || {}).number || "") : ""}</div>
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Matière</th><th className="text-right">Quantité</th><th className="text-right">Prix moyen</th><th className="text-right">Coût</th></tr></thead>
            <tbody>{l0.lines.map((x) => (<tr key={x.matId}><td className="py-1.5">{nomMat(x.matId)}</td><td className="text-right tabular">{x.qty} {unitMat(x.matId)}</td><td className="text-right tabular">{fmt(x.pu)}</td><td className="text-right tabular">{fmt(x.cost)}</td></tr>))}</tbody></table></div>
          <div className="flex flex-wrap gap-2"><button onClick={() => setImprimer({ kind: "lot", id: l0.id })} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="in-lot-imprimer">Imprimer la fiche de fabrication</button>{canEdit && l0.status !== "annulé" && <button onClick={() => annulerLot(l0)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="in-lot-annuler">Annuler ce lot</button>}</div>
        </div>); })()}
      </div>
    );
  };

  // ───────── Facturation (commune aux commandes et à la vente au comptoir) ─────────
  const acomptesDispo = (c) => inR2((c.acomptes || []).filter((a) => a.status !== "annulé" && !a.imputed).reduce((s, a) => s + a.amount, 0));
  const verifStockLignes = (lines, ignoreFactId) => {
    const need = {};
    lines.filter((l) => l.productId).forEach((l) => { need[l.productId] = inQ((need[l.productId] || 0) + l.qty); });
    for (const id of Object.keys(need)) { if (stockProd(id) + 0.0005 < need[id]) { showToast("Stock insuffisant de « " + nomProd(id) + " » : " + stockProd(id) + " " + unitProd(id) + " disponible, " + need[id] + " demandé. Enregistrez d'abord la fabrication."); return false; } }
    return true;
  };
  const emettreFacture = ({ orderId, clientId, date, lines, payNow, payMode }) => {
    if (!canFront) return null;
    if (lines.length === 0) { showToast("Ajoutez au moins une ligne à facturer."); return null; }
    if (!verifDate(date, "émettre cette facture")) return null;
    if (!verifStockLignes(lines)) return null;
    const ht = inMontantLignes(lines);
    if (!(ht > 0)) { showToast("Le montant à facturer doit être supérieur à zéro."); return null; }
    const tca = inR2(ht * tcaRate / 100), ttc = inR2(ht + tca);
    const cmd = orderId ? cmds.find((c) => c.id === orderId) : null;
    const recup = cmd ? Math.min(acomptesDispo(cmd), ttc) : 0;
    const net = inR2(ttc - recup);
    inAjouterComptes(accounts, setAccounts, ["411", "701", ...(tca > 0 ? ["445"] : []), ...(recup > 0 ? ["4191"] : [])]);
    const number = numero("FA", facts, date);
    const e = ecrire(date, "Facture " + number + " — " + nomClient(clientId), [{ account: "411", debit: net, credit: 0 }, { account: "4191", debit: recup, credit: 0 }, { account: "701", debit: 0, credit: ht }, { account: "445", debit: 0, credit: tca }], clientId || "passage");
    const f = { type: "fact", id: inId(), number, date, dueDate: date, clientId: clientId || "", orderId: orderId || "", lines: lines.map((l) => ({ id: inId(), label: l.label, productId: l.productId || "", service: !!l.service, perte: !!l.perte, motif: l.motif || "", motifTxt: l.motifTxt || "", unit: l.unit || "", qty: l.qty, pu: l.pu })), ht, tcaRate, tca, ttc, recup, net, entryId: e.id, payments: [], status: "emise", by: currentUserEmail || "" };
    if (payNow && net > 0) {
      const cpt = compteMode(payMode === "banque" ? "banque" : "caisse");
      inAjouterComptes(accounts, setAccounts, [cpt]);
      const pe = ecrire(date, "Encaissement " + number, [{ account: cpt, debit: net, credit: 0 }, { account: "411", debit: 0, credit: net }], f.id);
      f.payments = [{ id: inId(), date, amount: net, mode: payMode === "banque" ? "banque" : "caisse", entryId: pe.id, status: "valide" }];
    }
    ajouter(f);
    if (cmd) { maj(cmd.id, (c) => ({ ...c, status: "livree", factId: f.id, acomptes: (c.acomptes || []).map((a) => (a.status !== "annulé" && !a.imputed ? { ...a, imputed: true } : a)) })); }
    showToast("Facture " + number + " émise : " + fmt(ttc) + "." + (f.lines.some((l) => l.perte) ? " Attention : cette facture contient une vente à perte." : "")); logAudit("Industries", "Facture émise", number + " — " + fmt(ttc));
    if (f.lines.some((l) => l.perte)) logAudit("Industries", "Vente à perte", number + " — " + f.lines.filter((l) => l.perte).map((l) => l.label + " (" + inMotifLibelle(l.motif, l.motifTxt) + ")").join(" ; "));
    return f;
  };
  const [pf, setPf] = useBrouillon("indus-paiement", { amount: "", mode: "caisse", date: todayStr() });
  const encaisser = (f) => {
    if (!canFront || f.status === "annulee") return;
    const reste = inSolde(f).reste;
    const amount = pf.amount === "" ? reste : inR2(pf.amount);
    if (!(amount > 0) || amount > reste + 0.004) { showToast("Le montant doit être compris entre 0 et le reste à payer (" + fmt(reste) + ")."); return; }
    if (!verifDate(pf.date, "enregistrer cet encaissement")) return;
    if (pf.date < f.date) { showToast("L'encaissement ne peut pas précéder la facture."); return; }
    const cpt = compteMode(pf.mode === "banque" ? "banque" : "caisse");
    inAjouterComptes(accounts, setAccounts, [cpt, "411"]);
    const e = ecrire(pf.date, "Encaissement " + f.number + " — " + nomClient(f.clientId), [{ account: cpt, debit: amount, credit: 0 }, { account: "411", debit: 0, credit: amount }], f.id);
    maj(f.id, (r) => ({ ...r, payments: [...(r.payments || []), { id: inId(), date: pf.date, amount, mode: pf.mode, entryId: e.id, status: "valide" }] }));
    setPf({ ...pf, amount: "" }); showToast("Encaissement de " + fmt(amount) + " enregistré."); logAudit("Industries", "Encaissement", f.number + " — " + fmt(amount));
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
    if (inPaye(f.payments) > 0) { showToast("Annulez d'abord les encaissements de cette facture."); return; }
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
    if (!label) { showToast("Donnez un nom à la catégorie (ex. Savons, Meubles, Robes)."); return; }
    if (catsAll.some((c) => inNom(c[1]) === inNom(label))) { showToast("Cette catégorie existe déjà."); return; }
    ajouter({ type: "cat", id: "c" + inId(), label });
    setNouvCat(""); showToast("Catégorie « " + label + " » ajoutée.");
  };
  const cartes = (mode) => {
    const actifs = prods.filter((p) => mode === "catalogue" || p.active !== false);
    return (<div>{catsAll.map(([ck, cl]) => { const liste = actifs.filter((p) => catDe(p) === ck); return liste.length ? (
      <div key={ck} className="mb-5" data-testid="in-cat-groupe"><div className="display text-base" style={{ color: "#152238" }}>{cl}</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{liste.map((p) => {
          const st = stockProd(p.id), rupture = st <= 0, cu = coutUnit(p.id), pr = Number(p.price) || 0, sous = canEdit && cu > 0 && pr > 0 && pr + 0.004 < cu;
          return (<div key={p.id} className="ec-card p-3" data-testid="in-cat-carte" style={{ opacity: (rupture && mode === "vente") || p.active === false ? 0.55 : 1 }}>
            <div className="flex gap-3">
              {p.photo ? <img src={p.photo} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} /> : <div style={{ width: 72, height: 72, borderRadius: 8, background: "#F4F1E6", color: "#9A7B1E", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0 }}>{p.name.charAt(0).toUpperCase()}</div>}
              <div style={{ minWidth: 0 }}><div className="font-semibold text-sm">{p.name}</div>{p.desc && <div className="text-xs" style={{ color: "#7A7460" }}>{p.desc}</div>}
                <div className="tabular text-sm mt-1" data-testid="in-cat-prix">{pr > 0 ? fmt(pr) : "prix à fixer"} <span className="text-xs" style={{ color: "#8A8370" }}>/ {p.unit}</span></div>
                <div className="text-xs" data-testid="in-cat-stock" style={{ color: rupture ? "#A6432F" : "#5B563F" }}>{rupture ? "Rupture" : st + " " + p.unit + " disponible" + (st > 1 ? "s" : "")}</div>
                {p.active === false && <div className="text-xs" style={{ color: "#8A8370" }}>Retiré du catalogue</div>}
                {mode === "catalogue" && canEdit && cu > 0 && <div className="text-xs" style={{ color: sous ? "#A6432F" : "#8A8370" }}>coût moyen {fmt(cu)}{pr > 0 ? (sous ? " · prix sous le coût" : " · marge " + Math.round((pr - cu) * 100 / pr) + " %") : ""}</div>}
                {mode !== "catalogue" && sous && <div className="text-xs" style={{ color: "#A6432F" }}>Prix sous le coût de revient</div>}</div>
            </div>
            <div className="flex flex-wrap gap-2 mt-2 text-xs">
              {mode === "vente" && !rupture && canFront && <><button onClick={() => ajouterRapide(p)} className="px-2 py-1 rounded" style={ecBtnGold} data-testid="in-cat-plus1">+ 1</button><button onClick={() => choisirProduitVente(p.id)} className="underline" data-testid="in-vte-cat-choisir">Choisir</button></>}
              {mode === "commande" && canFront && <button onClick={() => choisirProduitLigne(p.id)} className="underline" data-testid="in-cmd-cat-choisir">Choisir</button>}
              {mode === "catalogue" && canEdit && <><button onClick={() => { setSelProd(p.id); setTab("produits"); }} className="underline" data-testid="in-cat-modifier">Modifier</button><button onClick={() => maj(p.id, (r) => ({ ...r, active: r.active === false }))} className="underline" data-testid="in-cat-retirer">{p.active === false ? "Remettre au catalogue" : "Retirer du catalogue"}</button></>}
            </div>
          </div>); })}</div></div>) : null; })}
      {actifs.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>Aucun produit : créez-les dans « Produits et recettes ».</div>}</div>);
  };
  const Catalogue = () => (
    <div>
      <div className="ec-card p-4 mb-5" data-testid="in-catalogue-entete">
        <div className="text-sm mb-2" style={{ color: "#5B563F" }}>Votre vitrine : les produits finis, rangés par catégorie, avec photo, prix et stock disponible. Les produits se créent dans « Produits et recettes » ; ici vous les présentez et les vendez.</div>
        <div className="flex flex-wrap items-end gap-2">
          {canEdit && <><div><label className="text-xs" style={{ color: "#8A8370" }}>Nouvelle catégorie (ex. Savons, Meubles, Robes)</label><input value={nouvCat} onChange={(e) => setNouvCat(e.target.value)} data-testid="in-cat-nom" className={ecInput} style={{ ...ecBorder, minWidth: 220 }} /></div><button onClick={addCatI} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="in-cat-ajouter">Ajouter la catégorie</button></>}
          <button onClick={() => setImprimer({ kind: "catalogue" })} className="px-3 py-2 rounded text-sm ml-auto" style={ecBtn} data-testid="in-catalogue-apercu">Aperçu du catalogue pour les clients</button>
        </div>
      </div>
      {cartes("catalogue")}
    </div>
  );
  // ───────── Commandes ─────────
  const cmdVide = () => ({ clientId: "", kind: "serie", subject: "", due: "", lines: [], productId: "", label: "", unit: "", qty: "", pu: "" });
  const [fc, setFc] = useBrouillon("indus-commande", cmdVide());
  const [perteAl, setPerteAl] = useState(null); // alerte « prix inférieur au coût de revient » : { ou, label, pu, cu } — à confirmer
  const [confPerte, setConfPerte] = useState(""); const [motifCmd, setMotifCmd] = useState({ motif: "", txt: "" }); // commande dont la facturation à perte attend une confirmation
  const [cqq, setCqq] = useState(""); const [cet, setCet] = useState("");
  const [ac, setAc] = useState({ amount: "", mode: "caisse", date: todayStr() });
  const choisirProduitLigne = (id) => { const p = prods.find((x) => x.id === id); setFc({ ...fc, productId: id, label: p ? p.name : fc.label, unit: p ? p.unit : fc.unit, pu: p && p.price ? String(p.price) : fc.pu }); };
  const ajouterCandCmd = (cand, forcer) => {
    const qty = inQ(cand.qty), pu = inR2(cand.pu);
    if (!String(cand.label || "").trim()) { showToast("Indiquez la désignation (ou choisissez un produit)."); return; }
    if (!(qty > 0)) { showToast("La quantité doit être supérieure à zéro."); return; }
    if (cand.pu === "" || pu < 0) { showToast("Indiquez le prix unitaire (en gourdes)."); return; }
    const cu = cand.productId ? coutUnit(cand.productId) : 0, perte = cu > 0 && pu + 0.004 < cu;
    if (perte && !forcer) { setPerteAl({ ou: "cmd", label: String(cand.label).trim(), pu, cu, cand, motif: "", txt: "" }); return; }
    setPerteAl(null);
    setFc({ ...fc, lines: [...fc.lines, { id: inId(), label: String(cand.label).trim(), productId: cand.productId || "", unit: String(cand.unit || "").trim(), qty, pu, perte, motif: perte ? forcer.motif : "", motifTxt: perte ? forcer.txt : "" }], productId: "", label: "", unit: "", qty: "", pu: "" });
  };
  const ajouterLigneCmd = (forcer) => ajouterCandCmd({ productId: fc.productId, label: fc.label, unit: fc.unit, qty: fc.qty, pu: fc.pu }, forcer);
  const creerCommande = () => {
    if (!canFront) return;
    if (!fc.clientId) { showToast("Choisissez le client (créez-le d'abord dans l'onglet Clients)."); return; }
    if (fc.lines.length === 0) { showToast("Ajoutez au moins une ligne à la commande."); return; }
    if (fc.due && fc.due < today) { showToast("La date de livraison souhaitée ne peut pas être passée."); return; }
    const number = numero("CD", cmds, today);
    ajouter({ type: "cmd", id: inId(), number, date: today, clientId: fc.clientId, kind: fc.kind, subject: fc.subject.trim(), lines: fc.lines, due: fc.due, status: "devis", specs: "", acomptes: [], factId: "", by: currentUserEmail || "" });
    setFc(cmdVide());
    showToast("Commande " + number + " enregistrée (devis)."); logAudit("Industries", "Commande créée", number + " — " + nomClient(fc.clientId));
  };
  const changerEtat = (c, st, msg) => { maj(c.id, (r) => ({ ...r, status: st })); showToast(msg); logAudit("Industries", "Commande " + c.number, msg); };
  const recevoirAcompte = (c) => {
    if (!canFront || c.status === "annulee" || c.status === "livree") return;
    const amount = inR2(ac.amount);
    if (!(amount > 0)) { showToast("Indiquez le montant de l'acompte."); return; }
    const total = inR2(inMontantLignes(c.lines) * (1 + tcaRate / 100));
    if (amount + acomptesDispo(c) > total + 0.004) { showToast("Les acomptes ne peuvent pas dépasser le total de la commande (" + fmt(total) + ")."); return; }
    if (!verifDate(ac.date, "enregistrer cet acompte")) return;
    const cpt = compteMode(ac.mode === "banque" ? "banque" : "caisse");
    inAjouterComptes(accounts, setAccounts, [cpt, "4191"]);
    const e = ecrire(ac.date, "Acompte " + c.number + " — " + nomClient(c.clientId), [{ account: cpt, debit: amount, credit: 0 }, { account: "4191", debit: 0, credit: amount }], c.id);
    maj(c.id, (r) => ({ ...r, acomptes: [...(r.acomptes || []), { id: inId(), date: ac.date, amount, mode: ac.mode, entryId: e.id, status: "valide", imputed: false }] }));
    setAc({ ...ac, amount: "" }); showToast("Acompte de " + fmt(amount) + " enregistré."); logAudit("Industries", "Acompte reçu", c.number + " — " + fmt(amount));
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
    const coutC = inR2(lotsOk.filter((l) => l.orderId === c.id).reduce((s2, l) => s2 + coutLot(l).total, 0)), htC = inMontantLignes(c.lines), perteC = coutC > 0 && coutC > htC + 0.004;
    if (perteC && confPerte !== c.id) { setConfPerte(c.id); setMotifCmd({ motif: "", txt: "" }); showToast("Attention : le coût de revient des lots (" + fmt(coutC) + ") dépasse le montant à facturer (" + fmt(htC) + "). Justifiez la raison pour facturer quand même."); return; }
    if (perteC) {
      if (isVendeur || !canEdit) { showToast("Seul un gestionnaire peut autoriser une facturation à perte."); return; }
      if (!motifCmd.motif) { showToast("Choisissez la raison de cette vente à perte."); return; }
      if (motifCmd.motif === "autre" && !motifCmd.txt.trim()) { showToast("Précisez la raison de cette vente à perte."); return; }
    }
    setConfPerte("");
    const f = emettreFacture({ orderId: c.id, clientId: c.clientId, date: today, lines: c.lines, payNow: false });
    if (f && perteC) { maj(f.id, (r) => ({ ...r, perteMotif: motifCmd.motif, perteTxt: motifCmd.txt.trim(), perteCout: coutC })); logAudit("Industries", "Vente à perte", f.number + " — coût " + fmt(coutC) + " pour " + fmt(htC) + " facturés — " + inMotifLibelle(motifCmd.motif, motifCmd.txt.trim())); }
  };
  const cmdHt = (c) => inMontantLignes(c.lines);
  const Commandes = () => {
    const rows = cmds.filter((c) => (!cet || c.status === cet) && (!cqq.trim() || [c.number, nomClient(c.clientId), c.subject].join(" ").toLowerCase().includes(cqq.trim().toLowerCase()))).sort((a, b) => (a.date < b.date ? 1 : -1));
    const rowsOk = rows.filter((c) => c.status !== "annulee");
    const c0 = cmds.find((x) => x.id === selCmd);
    const f0 = c0 && c0.factId ? facts.find((f) => f.id === c0.factId) : null;
    return (
      <div>
        {canFront && (<div className="ec-card p-4 mb-5" data-testid="in-cmd-form"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvelle commande ou devis</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Client</label><select value={fc.clientId} onChange={(e) => setFc({ ...fc, clientId: e.target.value })} data-testid="in-cmd-client" className={ecInput} style={ecBorder}><option value="">— choisir —</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Type</label><select value={fc.kind} onChange={(e) => setFc({ ...fc, kind: e.target.value })} data-testid="in-cmd-type" className={ecInput} style={ecBorder}><option value="serie">Produits de la gamme</option><option value="mesure">Sur mesure</option></select></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Objet (ex. Gâteaux de mariage, Porte en fer forgé, Uniformes)</label><input value={fc.subject} onChange={(e) => setFc({ ...fc, subject: e.target.value })} data-testid="in-cmd-objet" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Livraison souhaitée (facultatif)</label><input type="date" min={today} value={fc.due} onChange={(e) => setFc({ ...fc, due: e.target.value })} data-testid="in-cmd-livraison" className={ecInput} style={ecBorder} /></div>
          </div>
          {fc.lines.length > 0 && (<div className="ec-wrap mt-3"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Désignation</th><th>Unité</th><th className="text-right">Quantité</th><th className="text-right">Prix unitaire</th><th className="text-right">Montant</th><th></th></tr></thead>
            <tbody>{fc.lines.map((l) => (<tr key={l.id} data-testid="in-cmd-lignebrouillon"><td className="py-1.5">{l.label}</td><td>{l.unit || "—"}</td><td className="text-right tabular">{l.qty}</td><td className="text-right tabular">{fmt(l.pu)}</td><td className="text-right tabular">{fmt(inR2(l.qty * l.pu))}</td><td className="text-right"><button onClick={() => setFc({ ...fc, lines: fc.lines.filter((x) => x.id !== l.id) })} className="text-xs underline">Retirer</button></td></tr>))}</tbody>
            <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }}><td colSpan={4}>Total hors taxe</td><td className="text-right tabular" data-testid="in-cmd-brouillon-total">{fmt(inMontantLignes(fc.lines))}</td><td></td></tr></tfoot></table></div>)}
          {prods.length > 0 && <details className="mt-2" data-testid="in-cmd-catalogue"><summary className="text-sm cursor-pointer" style={{ color: "#152238" }}>Ouvrir le catalogue (photos, prix, stock)</summary><div className="mt-2">{cartes("commande")}</div></details>}
          <div className="grid md:grid-cols-6 gap-2 items-end mt-2">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Produit de la gamme (ou texte libre à droite)</label><select value={fc.productId} onChange={(e) => choisirProduitLigne(e.target.value)} data-testid="in-cmd-produit" className={ecInput} style={ecBorder}><option value="">— texte libre —</option>{prods.filter((x) => x.active !== false).map((x) => <option key={x.id} value={x.id}>{x.name} (stock {stockProd(x.id)})</option>)}</select></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Désignation</label><input value={fc.label} onChange={(e) => setFc({ ...fc, label: e.target.value, productId: fc.productId && prods.find((p) => p.id === fc.productId && p.name === e.target.value) ? fc.productId : "" })} data-testid="in-cmd-designation" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Quantité</label><input type="number" min="0" step="0.001" value={fc.qty} onChange={(e) => setFc({ ...fc, qty: e.target.value })} data-testid="in-cmd-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Prix unitaire</label><input type="number" min="0" step="0.01" value={fc.pu} onChange={(e) => setFc({ ...fc, pu: e.target.value })} data-testid="in-cmd-pu" className={ecInput + " tabular"} style={ecBorder} /></div>
          </div>
          <div className="flex flex-wrap gap-2 mt-2"><button onClick={() => ajouterLigneCmd()} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="in-cmd-ajouter-ligne">Ajouter la ligne</button><button onClick={creerCommande} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="in-cmd-creer">Enregistrer la commande</button></div>
          {alertePerte("cmd")}</div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <div className="flex-1 min-w-[150px]"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (n°, client, objet)</label><input value={cqq} onChange={(e) => setCqq(e.target.value)} data-testid="in-cmd-recherche" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>État</label><select value={cet} onChange={(e) => setCet(e.target.value)} data-testid="in-cmd-filtre-etat" className={ecInput} style={ecBorder}><option value="">Tous</option>{IN_ETATS_CMD.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        </div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>Date</th><th>Client</th><th>Objet</th><th>Livraison</th><th className="text-right">Total HT</th><th>État</th><th></th></tr></thead>
          <tbody>{rows.map((c) => (<tr key={c.id} data-testid="in-cmd-ligne" style={{ background: c.id === selCmd ? "#E6F1EE" : undefined, opacity: c.status === "annulee" ? 0.5 : 1 }}><td className="py-1.5 tabular text-xs">{c.number}</td><td>{ecDateFr(c.date)}</td><td className="font-semibold">{nomClient(c.clientId)}</td><td className="text-xs">{c.subject || (c.kind === "mesure" ? "Sur mesure" : "—")}</td><td>{c.due ? ecDateFr(c.due) : "—"}</td><td className="text-right tabular">{fmt(cmdHt(c))}</td>
            <td>{ecPastille(etatCmd(c), c.status === "livree" ? "ok" : c.status === "annulee" ? "neutre" : c.status === "prete" ? "info" : "attente")}</td>
            <td className="text-right"><button onClick={() => setSelCmd(c.id === selCmd ? "" : c.id)} className="text-xs underline" data-testid="in-cmd-ouvrir">{c.id === selCmd ? "Fermer" : "Ouvrir"}</button></td></tr>))}</tbody>
          {rows.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="in-cmd-total-ligne"><td colSpan={5}>Total ({rowsOk.length} commande{rowsOk.length > 1 ? "s" : ""}, hors annulées)</td><td className="text-right tabular" data-testid="in-cmd-tot-ht">{fmt(inR2(rowsOk.reduce((s, c) => s + cmdHt(c), 0)))}</td><td colSpan={2}></td></tr></tfoot>}</table></div>
        {rows.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{cmds.length === 0 ? "Aucune commande." : "Aucune commande ne correspond à ces filtres."}</div>}
        {c0 && (<div className="ec-card p-4 mt-5" data-testid="in-cmd-detail">
          <div className="display text-lg mb-1" style={{ color: "#152238" }}>{c0.number} — {nomClient(c0.clientId)}</div>
          <div className="text-xs mb-2" style={{ color: "#8A8370" }}>{c0.kind === "mesure" ? "Sur mesure" : "Gamme"}{c0.subject ? " · " + c0.subject : ""} · état : <b data-testid="in-cmd-d-etat">{etatCmd(c0)}</b>{c0.due ? " · livraison souhaitée le " + ecDateFr(c0.due) : ""}</div>
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Désignation</th><th className="text-right">Quantité</th><th className="text-right">Prix unitaire</th><th className="text-right">Montant</th></tr></thead>
            <tbody>{c0.lines.map((l) => (<tr key={l.id}><td className="py-1.5">{l.label}</td><td className="text-right tabular">{l.qty} {l.unit}</td><td className="text-right tabular">{fmt(l.pu)}</td><td className="text-right tabular">{fmt(inR2(l.qty * l.pu))}</td></tr>))}</tbody></table></div>
          <div className="text-sm mb-3">Total hors taxe : <b className="tabular" data-testid="in-cmd-d-ht">{fmt(cmdHt(c0))}</b>{tcaRate > 0 ? " · taxe " + tcaRate + " % : " + fmt(inR2(cmdHt(c0) * tcaRate / 100)) : ""} · coût de revient des lots liés : <b className="tabular" data-testid="in-cmd-d-cout">{fmt(inR2(lotsOk.filter((l) => l.orderId === c0.id).reduce((s, l) => s + coutLot(l).total, 0)))}</b></div>
          <div className="flex flex-wrap gap-2 mb-3">
            <button onClick={() => setImprimer({ kind: "devis", id: c0.id })} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="in-cmd-devis">Imprimer le devis</button>
            {canFront && c0.status === "devis" && <button onClick={() => changerEtat(c0, "confirmee", "Commande confirmée.")} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="in-cmd-confirmer">Confirmer (accord du client)</button>}
            {canFront && (c0.status === "confirmee" || c0.status === "enprod") && <button onClick={() => changerEtat(c0, "prete", "Commande prête.")} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="in-cmd-prete">Marquer prête</button>}
            {canFront && (c0.status === "confirmee" || c0.status === "enprod" || c0.status === "prete") && <button onClick={() => facturerCommande(c0)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="in-cmd-facturer">{confPerte === c0.id ? "Facturer quand même (à perte)" : "Livrer et facturer"}</button>}
            {canEdit && c0.status !== "livree" && c0.status !== "annulee" && <button onClick={() => annulerCommande(c0)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="in-cmd-annuler">Annuler la commande</button>}
          </div>
          {confPerte === c0.id && (<div className="p-3 rounded text-sm mb-3" style={{ background: "#FBE9E4", color: "#7A2E1F" }} data-testid="in-cmd-fact-perte">Le coût de revient des lots liés dépasse le montant facturé : facturer, c'est vendre à perte.
            {(isVendeur || !canEdit) ? <div className="mt-1">Seul un gestionnaire peut l'autoriser.</div> : (<div className="grid md:grid-cols-3 gap-2 mt-2 items-end"><div className="md:col-span-2"><label className="text-xs">Raison (obligatoire)</label><select value={motifCmd.motif} onChange={(e) => setMotifCmd({ ...motifCmd, motif: e.target.value })} data-testid="in-cmd-fact-motif" className={ecInput} style={ecBorder}><option value="">— choisir la raison —</option>{IN_MOTIFS_PERTE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>{motifCmd.motif === "autre" && <div><label className="text-xs">Précisez</label><input value={motifCmd.txt} onChange={(e) => setMotifCmd({ ...motifCmd, txt: e.target.value })} className={ecInput} style={ecBorder} /></div>}</div>)}
            <div className="mt-2"><button onClick={() => setConfPerte("")} className="px-3 py-1.5 rounded text-xs" style={ecBtn}>Annuler</button></div></div>)}
          {canFront && c0.status !== "devis" && c0.status !== "annulee" && c0.status !== "livree" && (<div className="mb-3"><div className="display text-base mb-2" style={{ color: "#152238" }}>Acomptes reçus</div>
            <div className="grid md:grid-cols-4 gap-2 items-end">
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant</label><input type="number" min="0" step="0.01" value={ac.amount} onChange={(e) => setAc({ ...ac, amount: e.target.value })} data-testid="in-ac-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={ac.date} onChange={(e) => setAc({ ...ac, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Mode</label><select value={ac.mode} onChange={(e) => setAc({ ...ac, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Caisse</option><option value="banque">Banque</option></select></div>
              <button onClick={() => recevoirAcompte(c0)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="in-ac-ok">Enregistrer l'acompte</button>
            </div></div>)}
          {(c0.acomptes || []).length > 0 && (<div className="mb-3 text-sm" data-testid="in-ac-liste">{c0.acomptes.map((a) => (<div key={a.id} className="text-xs" data-testid="in-ac-ligne" style={{ opacity: a.status === "annulé" ? 0.5 : 1 }}>{ecDateFr(a.date)} — acompte {fmt(a.amount)} ({a.mode === "banque" ? "banque" : "caisse"}){a.status === "annulé" ? " — annulé" : a.imputed ? " — déduit de la facture" : ""}{canEdit && a.status !== "annulé" && !a.imputed && <button onClick={() => annulerAcompte(c0, a)} className="underline ml-2" data-testid="in-ac-annuler">Annuler</button>}</div>))}</div>)}
          {f0 && <div className="text-sm">Facture : <b>{f0.number}</b> — <button className="underline" onClick={() => { setTab("ventes"); setSelFact(f0.id); }} data-testid="in-cmd-voir-facture">voir dans Ventes</button></div>}
        </div>)}
      </div>
    );
  };

  // ───────── Ventes (factures) ─────────
  const vteVide = () => ({ clientId: "", date: todayStr(), lines: [], productId: "", label: "", unit: "", qty: "", pu: "", payNow: true, mode: "caisse" });
  const [fv, setFv] = useBrouillon("indus-vente", vteVide());
  const [vq, setVq] = useState(""); const [vet, setVet] = useState("");
  const etatFact = (f) => (f.status === "annulee" ? "annulee" : inSolde(f).reste <= 0.004 ? "soldee" : "encaisser");
  const choisirProduitVente = (id) => { const p = prods.find((x) => x.id === id); setPerteAl(null); setFv({ ...fv, productId: id, label: p ? p.name : (id === "__service" ? "" : fv.label), unit: p ? p.unit : fv.unit, pu: p && p.price ? String(p.price) : fv.pu }); };
  const ajouterCandVente = (cand, forcer) => {
    const qty = inQ(cand.qty), pu = inR2(cand.pu);
    const service = cand.productId === "__service";
    if (!service && !cand.productId) { showToast("Choisissez un produit du catalogue. Pour une prestation sans stock (réparation, livraison…), choisissez « Service ou prestation »."); return; }
    if (!String(cand.label || "").trim()) { showToast("Choisissez un produit ou indiquez la désignation."); return; }
    if (!(qty > 0)) { showToast("La quantité doit être supérieure à zéro."); return; }
    if (cand.pu === "" || pu < 0) { showToast("Indiquez le prix unitaire (en gourdes)."); return; }
    let perte = false;
    if (!service) {
      const deja = inQ(fv.lines.filter((l) => l.productId === cand.productId).reduce((t, l) => t + l.qty, 0)), dispo = stockProd(cand.productId);
      if (deja + qty > dispo + 0.0005) { showToast("Stock insuffisant de « " + nomProd(cand.productId) + " » : il en reste " + Math.max(0, inQ(dispo - deja)) + " " + unitProd(cand.productId) + " à vendre. Enregistrez d'abord la fabrication."); return; }
      const cu = coutUnit(cand.productId);
      perte = cu > 0 && pu + 0.004 < cu;
      if (perte && !forcer) { setPerteAl({ ou: "vte", label: String(cand.label).trim(), pu, cu, cand, motif: "", txt: "" }); return; }
    }
    setPerteAl(null);
    setFv({ ...fv, lines: [...fv.lines, { id: inId(), label: String(cand.label).trim(), productId: service ? "" : cand.productId, service, perte, motif: perte ? forcer.motif : "", motifTxt: perte ? forcer.txt : "", unit: String(cand.unit || "").trim(), qty, pu }], productId: "", label: "", unit: "", qty: "", pu: "" });
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
  const alertePerte = (ou) => (perteAl && perteAl.ou === ou) ? (<div className="p-3 rounded text-sm mt-2" style={{ background: "#FBE9E4", color: "#7A2E1F" }} data-testid={"in-" + (ou === "cmd" ? "cmd" : "vte") + "-perte"}>
    Attention : « {perteAl.label} » est proposé à <b>{fmt(perteAl.pu)}</b> alors que son coût de revient moyen est de <b>{fmt(perteAl.cu)}</b> : vous perdez <b>{fmt(inR2(perteAl.cu - perteAl.pu))}</b> par unité. Une vente à perte doit rester exceptionnelle : sinon l'entreprise s'appauvrit à chaque vente. Corrigez le prix, ou justifiez.
    {(isVendeur || !canEdit) ? <div className="mt-2" data-testid="in-perte-gestionnaire">Seul un gestionnaire peut autoriser une vente à perte. Mettez le prix de revient ou demandez-lui.</div> : (
      <div className="grid md:grid-cols-3 gap-2 mt-2 items-end"><div className="md:col-span-2"><label className="text-xs">Raison de la vente à perte (obligatoire)</label><select value={perteAl.motif} onChange={(e) => setPerteAl({ ...perteAl, motif: e.target.value })} data-testid="in-perte-motif" className={ecInput} style={ecBorder}><option value="">— choisir la raison —</option>{IN_MOTIFS_PERTE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        {perteAl.motif === "autre" && <div><label className="text-xs">Précisez</label><input value={perteAl.txt} onChange={(e) => setPerteAl({ ...perteAl, txt: e.target.value })} data-testid="in-perte-motif-txt" className={ecInput} style={ecBorder} /></div>}</div>)}
    <div className="flex flex-wrap gap-2 mt-2"><button onClick={prixDeRevient} className="px-3 py-1.5 rounded text-xs" style={ecBtnGold} data-testid={"in-" + ou + "-perte-prixrevient"}>Mettre au prix de revient ({fmt(Math.ceil(perteAl.cu))})</button>{!(isVendeur || !canEdit) && <button onClick={confirmerPerte} className="px-3 py-1.5 rounded text-xs" style={ecBtn} data-testid={"in-" + ou + "-perte-confirmer"}>{ou === "cmd" ? "Ajouter quand même (à perte)" : "Vendre quand même (à perte)"}</button>}<button onClick={() => setPerteAl(null)} className="px-3 py-1.5 rounded text-xs" style={ecBtn}>Annuler</button></div></div>) : null;
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
        {canFront && (<div className="ec-card p-4 mb-5" data-testid="in-vte-form"><div className="display text-base mb-2" style={{ color: "#152238" }}>Vente directe (comptoir ou stock)</div>
          <div className="mb-3" data-testid="in-vte-catalogue">{cartes("vente")}</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Client (facultatif)</label><select value={fv.clientId} onChange={(e) => setFv({ ...fv, clientId: e.target.value })} data-testid="in-vte-client" className={ecInput} style={ecBorder}><option value="">Client de passage</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={fv.date} onChange={(e) => setFv({ ...fv, date: e.target.value })} data-testid="in-vte-date" className={ecInput} style={ecBorder} /></div>
          </div>
          {fv.lines.length > 0 && (<div className="ec-wrap mt-3"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Désignation</th><th className="text-right">Quantité</th><th className="text-right">Prix unitaire</th><th className="text-right">Montant</th><th></th></tr></thead>
            <tbody>{fv.lines.map((l) => (<tr key={l.id} data-testid="in-vte-lignebrouillon"><td className="py-1.5">{l.label}</td><td className="text-right tabular">{l.qty} {l.unit}</td><td className="text-right tabular">{fmt(l.pu)}</td><td className="text-right tabular">{fmt(inR2(l.qty * l.pu))}</td><td className="text-right"><button onClick={() => setFv({ ...fv, lines: fv.lines.filter((x) => x.id !== l.id) })} className="text-xs underline">Retirer</button></td></tr>))}</tbody>
            <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }}><td colSpan={3}>Total hors taxe{tcaRate > 0 ? " (taxe " + tcaRate + " % en plus)" : ""}</td><td className="text-right tabular" data-testid="in-vte-brouillon-total">{fmt(inMontantLignes(fv.lines))}</td><td></td></tr></tfoot></table></div>)}
          <div className="grid md:grid-cols-6 gap-2 items-end mt-2">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Produit du catalogue</label><select value={fv.productId} onChange={(e) => choisirProduitVente(e.target.value)} data-testid="in-vte-produit" className={ecInput} style={ecBorder}><option value="">— choisir un produit —</option>{prods.filter((x) => x.active !== false).map((x) => <option key={x.id} value={x.id} disabled={stockProd(x.id) <= 0}>{x.name} — {x.price ? fmt(x.price) : "prix à saisir"} — {stockProd(x.id) > 0 ? "stock " + stockProd(x.id) + " " + x.unit : "rupture"}</option>)}<option value="__service">Service ou prestation (hors stock)</option></select></div>
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>Désignation</label><input value={fv.label} onChange={(e) => setFv({ ...fv, label: e.target.value })} data-testid="in-vte-designation" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Quantité</label><input type="number" min="0" step="0.001" value={fv.qty} onChange={(e) => setFv({ ...fv, qty: e.target.value })} data-testid="in-vte-qte" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Prix unitaire</label><input type="number" min="0" step="0.01" value={fv.pu} onChange={(e) => setFv({ ...fv, pu: e.target.value })} data-testid="in-vte-pu" className={ecInput + " tabular"} style={ecBorder} /></div>
          </div>
          <div className="flex flex-wrap gap-3 items-center mt-2">
            <button onClick={() => ajouterLigneVente()} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="in-vte-ajouter-ligne">Ajouter la ligne</button>
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={fv.payNow} onChange={(e) => setFv({ ...fv, payNow: e.target.checked })} data-testid="in-vte-encaisser" />Encaisser tout de suite</label>
            {fv.payNow && <select value={fv.mode} onChange={(e) => setFv({ ...fv, mode: e.target.value })} data-testid="in-vte-mode" className={ecInput} style={{ ...ecBorder, width: "auto" }}><option value="caisse">Caisse</option><option value="banque">Banque</option></select>}
            <button onClick={venteComptoir} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="in-vte-emettre">Émettre la facture</button>
          </div>
          {alertePerte("vte")}</div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <div className="flex-1 min-w-[150px]"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (n° de facture, client)</label><input value={vq} onChange={(e) => setVq(e.target.value)} data-testid="in-vte-recherche" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>État</label><select value={vet} onChange={(e) => setVet(e.target.value)} data-testid="in-vte-filtre-etat" className={ecInput} style={ecBorder}><option value="">Tous</option><option value="encaisser">À encaisser</option><option value="soldee">Soldée</option><option value="annulee">Annulée</option></select></div>
        </div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">N°</th><th>Date</th><th>Client</th><th className="text-right">Total HT</th><th className="text-right">Total TTC</th><th className="text-right">Reste dû</th><th>État</th><th></th></tr></thead>
          <tbody>{rows.map((f) => { const e = etatFact(f); return (<tr key={f.id} data-testid="in-vte-ligne" style={{ background: f.id === selFact ? "#E6F1EE" : undefined, opacity: e === "annulee" ? 0.5 : 1 }}><td className="py-1.5 tabular text-xs">{f.number}</td><td>{ecDateFr(f.date)}</td><td className="font-semibold">{nomClient(f.clientId)}</td><td className="text-right tabular">{fmt(f.ht)}</td><td className="text-right tabular">{fmt(f.ttc)}</td><td className="text-right tabular">{e === "annulee" ? "—" : fmt(inSolde(f).reste)}</td>
            <td>{e === "soldee" ? ecPastille("Soldée", "ok") : e === "annulee" ? ecPastille("Annulée", "neutre") : ecPastille("À encaisser", "attente")}</td>
            <td className="text-right"><button onClick={() => setSelFact(f.id === selFact ? "" : f.id)} className="text-xs underline" data-testid="in-vte-ouvrir">{f.id === selFact ? "Fermer" : "Ouvrir"}</button></td></tr>); })}</tbody>
          {rows.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="in-vte-total-ligne"><td colSpan={3}>Total ({rowsOk.length} facture{rowsOk.length > 1 ? "s" : ""}, hors annulées)</td><td className="text-right tabular" data-testid="in-vte-tot-ht">{fmt(inR2(rowsOk.reduce((s, f) => s + f.ht, 0)))}</td><td className="text-right tabular" data-testid="in-vte-tot-ttc">{fmt(inR2(rowsOk.reduce((s, f) => s + f.ttc, 0)))}</td><td className="text-right tabular" data-testid="in-vte-tot-reste">{fmt(inR2(rowsOk.reduce((s, f) => s + inSolde(f).reste, 0)))}</td><td colSpan={2}></td></tr></tfoot>}</table></div>
        {rows.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{facts.length === 0 ? "Aucune facture." : "Aucune facture ne correspond à ces filtres."}</div>}
        {f0 && (<div className="ec-card p-4 mt-5" data-testid="in-vte-detail">
          <div className="display text-lg mb-2" style={{ color: "#152238" }}>{f0.number} — {nomClient(f0.clientId)}</div>
          <div className="text-sm mb-2">Total hors taxe <b className="tabular">{fmt(f0.ht)}</b>{f0.tca > 0 ? " · taxe " + fmt(f0.tca) : ""}{f0.recup > 0 ? " · acompte déduit " + fmt(f0.recup) : ""} · net à payer <b className="tabular">{fmt(f0.net)}</b> · payé <b className="tabular" data-testid="in-vte-d-paye">{fmt(inSolde(f0).paye)}</b> · reste <b className="tabular" data-testid="in-vte-d-reste">{fmt(inSolde(f0).reste)}</b></div>
          <div className="flex flex-wrap gap-2 mb-3"><button onClick={() => setImprimer({ kind: "facture", id: f0.id })} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="in-vte-imprimer">Imprimer la facture (A4 ou ticket)</button>{canEdit && f0.status !== "annulee" && <button onClick={() => annulerFacture(f0)} className="px-3 py-2 rounded text-sm" style={ecBtn} data-testid="in-vte-annuler">Annuler la facture</button>}</div>
          {canFront && f0.status !== "annulee" && inSolde(f0).reste > 0.004 && (<div className="grid md:grid-cols-4 gap-2 items-end mb-2">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant (vide = tout le reste)</label><input type="number" min="0" step="0.01" value={pf.amount} onChange={(e) => setPf({ ...pf, amount: e.target.value })} data-testid="in-pay-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={pf.date} onChange={(e) => setPf({ ...pf, date: e.target.value })} data-testid="in-pay-date" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Mode</label><select value={pf.mode} onChange={(e) => setPf({ ...pf, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Caisse</option><option value="banque">Banque</option></select></div>
            <button onClick={() => encaisser(f0)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="in-pay-ok">Encaisser</button></div>)}
          {(f0.payments || []).map((p) => (<div key={p.id} className="text-xs" data-testid="in-pay-ligne" style={{ opacity: p.status === "annulé" ? 0.5 : 1 }}>{ecDateFr(p.date)} — {fmt(p.amount)} ({p.mode === "banque" ? "banque" : "caisse"}){p.status === "annulé" ? " — annulé" : canEdit && <button onClick={() => annulerPaiement(f0, p)} className="underline ml-2" data-testid="in-pay-annuler">Annuler</button>}</div>))}
        </div>)}
      </div>
    );
  };

  // ───────── Dépenses d'atelier ─────────
  const [fd, setFd] = useBrouillon("indus-depense", { kind: "energie", date: todayStr(), label: "", supplier: "", amount: "", mode: "caisse" });
  const [dq, setDq] = useState(""); const [dk, setDk] = useState(""); const [selDep, setSelDep] = useState("");
  const resteDep = (d) => (d.mode === "apayer" && d.status !== "annulé" ? inR2(d.amount - inPaye(d.settlements)) : 0);
  const enregistrerDepense = () => {
    if (!canEdit) return;
    const amount = inR2(fd.amount);
    if (!(amount > 0)) { showToast("Indiquez le montant (en gourdes)."); return; }
    if (fd.mode === "apayer" && !fd.supplier.trim()) { showToast("Pour une dépense à payer plus tard, indiquez le fournisseur."); return; }
    if (!verifDate(fd.date, "enregistrer cette dépense")) return;
    const def = IN_DEPENSES.find((x) => x[0] === fd.kind) || IN_DEPENSES[0];
    const cpt = compteMode(fd.mode);
    const label = fd.label.trim() || def[1];
    inAjouterComptes(accounts, setAccounts, [def[2], cpt]);
    const e = ecrire(fd.date, "Atelier — " + label, [{ account: def[2], debit: amount, credit: 0 }, { account: cpt, debit: 0, credit: amount }], "atelier");
    ajouter({ type: "dep", id: inId(), date: fd.date, kind: fd.kind, label, supplier: fd.supplier.trim(), amount, mode: fd.mode, entryId: e.id, status: "valide", settlements: [], by: currentUserEmail || "" });
    setFd({ ...fd, label: "", amount: "" });
    showToast("Dépense enregistrée : " + fmt(amount) + "."); logAudit("Industries", "Dépense d'atelier", label + " — " + fmt(amount));
  };
  const annulerDepense = (d) => {
    if (!canEdit || d.status === "annulé") return;
    if (inPaye(d.settlements) > 0) { showToast("Annulez d'abord les règlements de cette dépense."); return; }
    if (!verifDate(today, "annuler cette dépense")) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Annuler cette dépense ? Une écriture inverse sera passée.")) return;
    const e = contre(d.entryId, "Annulation — " + d.label + " (écriture inverse)", today, "atelier");
    maj(d.id, (r) => ({ ...r, status: "annulé", reversalEntryId: e ? e.id : "" }));
    showToast("Dépense annulée.");
  };
  const reglerDep = (d) => {
    if (!canEdit || d.mode !== "apayer" || d.status === "annulé") return;
    const reste = resteDep(d);
    const amount = rg.amount === "" ? reste : inR2(rg.amount);
    if (!(amount > 0) || amount > reste + 0.004) { showToast("Le montant doit être compris entre 0 et le reste à payer (" + fmt(reste) + ")."); return; }
    if (!verifDate(rg.date, "enregistrer ce règlement")) return;
    const cpt = compteMode(rg.mode === "banque" ? "banque" : "caisse");
    inAjouterComptes(accounts, setAccounts, [cpt, "401"]);
    const e = ecrire(rg.date, "Règlement " + (d.supplier || "fournisseur") + " — " + d.label, [{ account: "401", debit: amount, credit: 0 }, { account: cpt, debit: 0, credit: amount }], d.id);
    maj(d.id, (r) => ({ ...r, settlements: [...(r.settlements || []), { id: inId(), date: rg.date, amount, mode: rg.mode, entryId: e.id, status: "valide" }] }));
    setRg({ ...rg, amount: "" }); showToast("Règlement de " + fmt(amount) + " enregistré."); logAudit("Industries", "Dette réglée", (d.supplier || "") + " — " + fmt(amount));
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
        {canEdit && (<div className="ec-card p-4 mb-5"><div className="display text-base mb-2" style={{ color: "#152238" }}>Nouvelle dépense d'atelier</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Nature</label><select value={fd.kind} onChange={(e) => setFd({ ...fd, kind: e.target.value })} data-testid="in-dep-nature" className={ecInput} style={ecBorder}>{IN_DEPENSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={fd.date} onChange={(e) => setFd({ ...fd, date: e.target.value })} data-testid="in-dep-date" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Détail (facultatif)</label><input value={fd.label} onChange={(e) => setFd({ ...fd, label: e.target.value })} data-testid="in-dep-detail-saisie" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant</label><input type="number" min="0" step="0.01" value={fd.amount} onChange={(e) => setFd({ ...fd, amount: e.target.value })} data-testid="in-dep-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Fournisseur</label><input list="in-dl-four" value={fd.supplier} onChange={(e) => setFd({ ...fd, supplier: e.target.value })} data-testid="in-dep-fournisseur" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Paiement</label><select value={fd.mode} onChange={(e) => setFd({ ...fd, mode: e.target.value })} data-testid="in-dep-mode" className={ecInput} style={ecBorder}><option value="caisse">Payé en caisse</option><option value="banque">Payé par la banque</option><option value="apayer">À payer plus tard</option></select></div>
          </div>
          <button onClick={enregistrerDepense} className="mt-2 px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="in-dep-enregistrer">Enregistrer la dépense</button></div>)}
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <div className="flex-1 min-w-[150px]"><label className="text-xs" style={{ color: "#8A8370" }}>Rechercher (détail, fournisseur)</label><input value={dq} onChange={(e) => setDq(e.target.value)} data-testid="in-dep-recherche" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Nature</label><select value={dk} onChange={(e) => setDk(e.target.value)} data-testid="in-dep-filtre-nature" className={ecInput} style={ecBorder}><option value="">Toutes</option>{IN_DEPENSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        </div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Date</th><th>Nature</th><th>Détail</th><th>Fournisseur</th><th className="text-right">Montant</th><th>Paiement</th><th></th></tr></thead>
          <tbody>{rows.map((d) => (<tr key={d.id} data-testid="in-dep-ligne" style={{ opacity: d.status === "annulé" ? 0.5 : 1 }}><td className="py-1.5">{ecDateFr(d.date)}</td><td>{(IN_DEPENSES.find((x) => x[0] === d.kind) || [0, d.kind])[1]}</td><td className="text-xs">{d.label}</td><td>{d.supplier || "—"}</td><td className="text-right tabular">{fmt(d.amount)}</td>
            <td>{d.status === "annulé" ? ecPastille("Annulée", "neutre") : d.mode === "apayer" ? (resteDep(d) > 0.004 ? ecPastille("À payer : " + fmt(resteDep(d)), "attente") : ecPastille("Payée", "ok")) : ecPastille(d.mode === "banque" ? "Banque" : "Caisse", "ok")}</td>
            <td className="text-right whitespace-nowrap">{canEdit && d.mode === "apayer" && d.status !== "annulé" && <button onClick={() => setSelDep(d.id === selDep ? "" : d.id)} className="text-xs underline mr-2" data-testid="in-dep-regler">Régler</button>}{canEdit && d.status !== "annulé" && <button onClick={() => annulerDepense(d)} className="text-xs underline" data-testid="in-dep-annuler">Annuler</button>}</td></tr>))}</tbody>
          {rows.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="in-dep-total-ligne"><td colSpan={4}>Total ({rowsOk.length} dépense{rowsOk.length > 1 ? "s" : ""}, hors annulées)</td><td className="text-right tabular" data-testid="in-dep-tot">{fmt(inR2(rowsOk.reduce((s, d) => s + d.amount, 0)))}</td><td colSpan={2}></td></tr></tfoot>}</table></div>
        {rows.length === 0 && <div className="text-sm" style={{ color: "#8A8370" }}>{deps.length === 0 ? "Aucune dépense d'atelier." : "Aucune dépense ne correspond à ces filtres."}</div>}
        {canEdit && d0 && d0.mode === "apayer" && d0.status !== "annulé" && (<div className="ec-card p-3 mt-3" data-testid="in-depreg-form"><div className="text-sm mb-2">Règlement de {d0.supplier || "fournisseur"} — reste à payer <b className="tabular">{fmt(resteDep(d0))}</b></div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant (vide = tout le reste)</label><input type="number" min="0" step="0.01" value={rg.amount} onChange={(e) => setRg({ ...rg, amount: e.target.value })} data-testid="in-depreg-montant" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={rg.date} onChange={(e) => setRg({ ...rg, date: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Mode</label><select value={rg.mode} onChange={(e) => setRg({ ...rg, mode: e.target.value })} className={ecInput} style={ecBorder}><option value="caisse">Caisse</option><option value="banque">Banque</option></select></div>
            <button onClick={() => reglerDep(d0)} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="in-depreg-valider">Enregistrer le règlement</button>
          </div>
          {(d0.settlements || []).map((s) => (<div key={s.id} className="text-xs mt-1" data-testid="in-depreg-ligne" style={{ opacity: s.status === "annulé" ? 0.5 : 1 }}>{ecDateFr(s.date)} — {fmt(s.amount)}{s.status === "annulé" ? " — annulé" : <button onClick={() => annulerRegDep(d0, s)} className="underline ml-2">Annuler</button>}</div>))}
        </div>)}
      </div>
    );
  };

  // ───────── Tableau de bord ─────────
  const Apercu = () => {
    const fA = factsOk;
    const caMois = inR2(fA.filter((f) => f.date.startsWith(moisCourant)).reduce((s, f) => s + f.ht, 0));
    const encMois = inR2(fA.flatMap((f) => f.payments || []).filter((p) => p.status !== "annulé" && String(p.date).startsWith(moisCourant)).reduce((s, p) => s + p.amount, 0));
    const aEnc = inR2(fA.reduce((s, f) => s + inSolde(f).reste, 0));
    const lotsMois = lotsOk.filter((l) => l.date.startsWith(moisCourant));
    const coutMois = inR2(lotsMois.reduce((s, l) => s + coutLot(l).total, 0));
    const depMois = inR2(deps.filter((d) => d.status !== "annulé" && d.date.startsWith(moisCourant)).reduce((s, d) => s + d.amount, 0));
    const bas = mats.filter((m) => m.active !== false && (m.min || 0) > 0 && stockMat(m.id) <= m.min);
    const afaire = [];
    bas.forEach((m) => afaire.push({ tab: "matieres", sel: m.id, nom: m.name, txt: "Stock bas : " + stockMat(m.id) + " " + m.unit + " (seuil " + m.min + ")" }));
    cmds.filter((c) => c.status !== "livree" && c.status !== "annulee" && c.status !== "devis" && c.due && c.due < today).forEach((c) => afaire.push({ tab: "commandes", sel: c.id, nom: nomClient(c.clientId), txt: "Commande " + c.number + " : livraison prévue le " + ecDateFr(c.due) + " dépassée" }));
    cmds.filter((c) => c.status === "devis").forEach((c) => { const j = inJours(c.date, today); if (j >= 7) afaire.push({ tab: "commandes", sel: c.id, nom: nomClient(c.clientId), txt: "Devis " + c.number + " sans réponse depuis " + j + " jours : relancer ou annuler" }); });
    cmds.filter((c) => c.status === "prete").forEach((c) => afaire.push({ tab: "commandes", sel: c.id, nom: nomClient(c.clientId), txt: "Commande " + c.number + " prête : à livrer et facturer" }));
    fA.filter((f) => inSolde(f).reste > 0.004 && inJours(f.date, today) > 30).forEach((f) => afaire.push({ tab: "ventes", sel: f.id, nom: nomClient(f.clientId), txt: "Facture " + f.number + " impayée depuis " + inJours(f.date, today) + " jours : reste " + fmt(inSolde(f).reste) }));
    prods.filter((p) => p.active !== false && Number(p.price) > 0 && coutUnit(p.id) > 0 && Number(p.price) + 0.004 < coutUnit(p.id)).forEach((p) => afaire.push({ tab: "produits", sel: p.id, nom: p.name, txt: "Prix du catalogue (" + fmt(p.price) + ") sous le coût de revient (" + fmt(coutUnit(p.id)) + ") : redressez le prix ou vérifiez les lots." }));
    prods.forEach((p) => { const n = fA.filter((f) => inJours(f.date, today) <= 30).flatMap((f) => f.lines || []).filter((l) => l.productId === p.id && l.perte).length; if (n >= 2) afaire.push({ tab: "produits", sel: p.id, nom: p.name, txt: n + " ventes à perte en 30 jours : le prix ou le coût de fabrication doit être redressé." }); });
    { const sc = fA.flatMap((f) => (f.lines || []).filter((l) => l.productId && coutUnit(l.productId) > 0 && l.pu + 0.004 < coutUnit(l.productId)).map((l) => ({ f, l }))).filter((x) => inJours(x.f.date, today) <= 30); if (sc.length > 0) afaire.push({ tab: "rapports", nom: "Ventes à perte", txt: sc.length + " vente(s) sous le coût de revient ces 30 derniers jours : vérifiez les prix ou le calcul de fabrication." }); }
    achatsOk.filter((a) => resteAchat(a) > 0.004).forEach((a) => afaire.push({ tab: "matieres", sel: a.matId, nom: a.supplier || nomMat(a.matId), txt: "Achat de " + nomMat(a.matId) + " du " + ecDateFr(a.date) + " à payer : " + fmt(resteAchat(a)) }));
    const etapes = [
      ["Matières premières", "Enregistrez vos matières (farine, soude, planches, tissu…) avec leur unité.", "matieres", mats.length > 0],
      ["Premier achat", "Achetez des matières : le stock et le prix moyen se calculent seuls.", "matieres", achatsOk.length > 0],
      ["Produits finis", "Créez vos produits et, si vous voulez, leur recette (matières par fabrication).", "produits", prods.length > 0],
      ["Première fabrication", "Enregistrez un lot : matières utilisées, heures, frais → coût de revient.", "production", lotsOk.length > 0],
      ["Clients et commandes", "Ajoutez un client et une commande ou un devis (série ou sur mesure).", "commandes", cmds.length > 0],
      ["Première vente", "Livrez une commande ou vendez directement : la facture se fait seule.", "ventes", fA.length > 0],
      ["Premier encaissement", "Encaissez la facture : la comptabilité se fait automatiquement.", "ventes", fA.some((f) => inSolde(f).paye > 0)],
    ];
    const toutFait = etapes.every((e) => e[3]);
    const kpis = [["Ventes du mois (HT)", fmt(caMois), "in-kpi-ca"], ["Encaissé ce mois", fmt(encMois), "in-kpi-enc"], ["Reste à encaisser", fmt(aEnc), "in-kpi-aenc"], ["Coût des fabrications du mois", fmt(coutMois), "in-kpi-cout"], ["Dépenses d'atelier du mois", fmt(depMois), "in-kpi-dep"], ["Commandes en cours", String(cmds.filter((c) => ["confirmee", "enprod", "prete"].includes(c.status)).length), "in-kpi-cmd"], ["Matières en stock bas", String(bas.length), "in-kpi-bas"], ["Choses à faire", String(afaire.length), "in-kpi-afaire"]];
    return (
      <div>
        {(<div className="ec-card p-4 mb-5" data-testid="in-guide">
          <div className="display text-base mb-2" style={{ color: "#152238" }}>Marche à suivre, en 7 étapes{toutFait ? " — toutes faites ✓" : ""}</div>
          <ol className="text-sm" style={{ color: "#152238", listStyle: "none", paddingLeft: 0 }}>{etapes.map(([t, d, tb, fait], i) => (<li key={i} data-testid="in-etape" className="mb-1.5 flex flex-wrap gap-2 items-baseline"><span style={{ color: fait ? "#0F6B5C" : "#8A8370", fontWeight: 700 }}>{fait ? "✓" : (i + 1) + "."}</span><span><b>{t}</b> — <span style={{ color: "#5B563F" }}>{d}</span></span>{!fait && !(isVendeur && !["commandes", "ventes"].includes(tb)) && <button className="text-xs underline" data-testid="in-etape-ouvrir" onClick={() => setTab(tb)}>Ouvrir</button>}</li>))}</ol>
        </div>)}
        {mats.length + prods.length + cmds.length === 0 && <div className="p-4 rounded text-sm mb-4" style={{ background: "#FFF6E0", color: "#152238" }} data-testid="in-vide">Pour commencer : ajoutez vos <b>matières premières</b> et vos <b>produits</b>, achetez des matières, puis enregistrez votre première <b>fabrication</b>.</div>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {kpis.map(([l, v, t]) => (<div key={t} className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>{l}</div><div className="display text-lg tabular" data-testid={t} style={{ color: "#152238" }}>{v}</div></div>))}
        </div>
        <div className="display text-base mb-2" style={{ color: "#152238" }}>À faire</div>
        {afaire.length === 0 ? <div className="text-sm mb-5" style={{ color: "#8A8370" }}>Rien en attente.</div> : (
          <div className="ec-wrap mb-5"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Concerné</th><th>À faire</th><th></th></tr></thead>
            <tbody>{afaire.slice(0, 15).map((x, i) => (<tr key={i} data-testid="in-afaire-ligne"><td className="py-1.5">{x.nom}</td><td>{x.txt}</td><td className="text-right"><button className="text-xs underline" data-testid="in-afaire-ouvrir" onClick={() => { if (isVendeur && x.tab === "matieres") return; setTab(x.tab); if (x.sel && x.tab === "commandes") setSelCmd(x.sel); if (x.sel && x.tab === "ventes") setSelFact(x.sel); if (x.sel && x.tab === "matieres") setSelMat(x.sel); }}>Ouvrir</button></td></tr>))}</tbody></table></div>
        )}
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Produits en stock</div>
        {prods.filter((p) => stockProd(p.id) > 0).length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucun produit en stock.</div> : (
          <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Produit</th><th className="text-right">En stock</th><th className="text-right">Prix de vente</th></tr></thead>
            <tbody>{prods.filter((p) => stockProd(p.id) > 0).map((p) => (<tr key={p.id} data-testid="in-stockp-ligne"><td className="py-1.5">{p.name}</td><td className="text-right tabular">{stockProd(p.id)} {p.unit}</td><td className="text-right tabular">{p.price ? fmt(p.price) : "—"}</td></tr>))}</tbody></table></div>
        )}
      </div>
    );
  };

  // ───────── Rapports ─────────
  const [rp, setRp] = useState({ from: moisCourant + "-01", to: todayStr() });
  const Rapports = () => {
    const inP = (d) => d >= rp.from && d <= rp.to;
    const fP = factsOk.filter((f) => inP(f.date));
    const dP = deps.filter((d) => d.status !== "annulé" && inP(d.date));
    const lP = lotsOk.filter((l) => inP(l.date));
    const aP = achatsOk.filter((a) => inP(a.date));
    // marge par produit (période) : ventes des produits de la gamme − coût unitaire moyen des lots × quantités vendues
    const coutUnitProd = (id) => { const ls = lotsOk.filter((l) => l.productId === id); const q = ls.reduce((s, l) => s + l.qty, 0); return q > 0 ? inR2(ls.reduce((s, l) => s + coutLot(l).total, 0) / q) : 0; };
    const parProd = prods.map((p) => { const lg = fP.flatMap((f) => f.lines).filter((l) => l.productId === p.id); const q = inQ(lg.reduce((s, l) => s + l.qty, 0)); const ca = inR2(lg.reduce((s, l) => s + l.qty * l.pu, 0)); const cu = coutUnitProd(p.id); const cout = inR2(q * cu); return { p, q, ca, cu, cout, marge: inR2(ca - cout), pct: ca > 0 ? Math.round((ca - cout) * 100 / ca) : 0 }; }).filter((x) => x.q > 0 || lotsOk.some((l) => l.productId === x.p.id));
    const sousCout = fP.flatMap((f) => (f.lines || []).filter((l) => l.productId).map((l) => ({ f, l, cu: coutUnit(l.productId) }))).filter((x) => x.cu > 0 && x.l.pu + 0.004 < x.cu);
    // marge par commande (sur mesure et série)
    const parCmd = cmds.filter((c) => c.factId).map((c) => { const f = facts.find((x) => x.id === c.factId); return { c, f, cout: inR2(lotsOk.filter((l) => l.orderId === c.id).reduce((s, l) => s + coutLot(l).total, 0)) }; }).filter((x) => x.f && x.f.status !== "annulee" && inP(x.f.date)).map((x) => ({ ...x, marge: inR2(x.f.ht - x.cout) }));
    const imp = clients.map((c) => { const fs = factsOk.filter((f) => f.clientId === c.id && inSolde(f).reste > 0.004); const b = [0, 0, 0, 0]; fs.forEach((f) => { const j = inJours(f.date, today); const r = inSolde(f).reste; b[j <= 30 ? 0 : j <= 60 ? 1 : j <= 90 ? 2 : 3] += r; }); return { c, n: fs.length, b: b.map(inR2), tot: inR2(b.reduce((s, x) => s + x, 0)) }; }).filter((x) => x.tot > 0);
    const S = (a, f) => inR2(a.reduce((s, x) => s + f(x), 0));
    const exporterMarge = () => ecTelecharger("marge-par-produit-" + today + ".csv", [["Produit", "Quantité vendue", "Ventes HT", "Coût unitaire moyen", "Coût des ventes", "Marge", "Marge %"], ...parProd.map((x) => [x.p.name, x.q, x.ca, x.cu, x.cout, x.marge, x.pct]), ["Total", "", S(parProd, (x) => x.ca), "", S(parProd, (x) => x.cout), S(parProd, (x) => x.marge), ""]]);
    const exporterStock = () => ecTelecharger("stock-" + today + ".csv", [["Type", "Nom", "Unité", "En stock", "Prix moyen d'achat", "Valeur"], ...mats.map((m) => ["Matière", m.name, m.unit, stockMat(m.id), prixMoyen(m.id), inR2(stockMat(m.id) * prixMoyen(m.id))]), ...prods.map((p) => ["Produit fini", p.name, p.unit, stockProd(p.id), coutUnitProd(p.id), inR2(stockProd(p.id) * coutUnitProd(p.id))])]);
    const exporterImp = () => ecTelecharger("impayes-clients-" + today + ".csv", [["Client", "Factures", "0-30 j", "31-60 j", "61-90 j", "Plus de 90 j", "Reste dû"], ...imp.map((x) => [x.c.name, x.n, ...x.b, x.tot])]);
    return (
      <div>
        <div className="flex flex-wrap gap-2 items-end mb-4">
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Du</label><input type="date" value={rp.from} onChange={(e) => setRp({ ...rp, from: e.target.value })} data-testid="in-rap-du" className={ecInput} style={ecBorder} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Au</label><input type="date" value={rp.to} onChange={(e) => setRp({ ...rp, to: e.target.value })} data-testid="in-rap-au" className={ecInput} style={ecBorder} /></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[["Ventes HT", fmt(S(fP, (f) => f.ht)), "in-rap-ventes"], ["Coût des fabrications", fmt(S(lP, (l) => coutLot(l).total)), "in-rap-fab"], ["Achats de matières", fmt(S(aP, (a) => a.amount)), "in-rap-achats"], ["Dépenses d'atelier", fmt(S(dP, (d) => d.amount)), "in-rap-dep"]].map(([l, v, t]) => (<div key={t} className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>{l}</div><div className="display text-lg tabular" data-testid={t} style={{ color: "#152238" }}>{v}</div></div>))}
        </div>
        <div className="flex flex-wrap items-center gap-3 mb-2"><div className="display text-base" style={{ color: "#152238" }}>Marge par produit (coût de revient moyen des lots)</div><button onClick={exporterMarge} className="text-xs underline" data-testid="in-rap-exp-marge">Exporter (CSV)</button></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Produit</th><th className="text-right">Quantité vendue</th><th className="text-right">Ventes HT</th><th className="text-right">Coût unitaire moyen</th><th className="text-right">Coût des ventes</th><th className="text-right">Marge</th><th className="text-right">Marge %</th></tr></thead>
          <tbody>{parProd.map((x) => (<tr key={x.p.id} data-testid="in-rap-prod-ligne"><td className="py-1.5">{x.p.name}</td><td className="text-right tabular">{x.q}</td><td className="text-right tabular">{fmt(x.ca)}</td><td className="text-right tabular">{fmt(x.cu)}</td><td className="text-right tabular">{fmt(x.cout)}</td><td className="text-right tabular" style={{ color: x.marge < 0 ? "#A6432F" : undefined }}>{fmt(x.marge)}</td><td className="text-right tabular">{x.ca > 0 ? x.pct + " %" : "—"}</td></tr>))}</tbody>
          {parProd.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }} data-testid="in-rap-prod-total"><td colSpan={2}>Total</td><td className="text-right tabular" data-testid="in-rap-prod-tot-ca">{fmt(S(parProd, (x) => x.ca))}</td><td></td><td className="text-right tabular">{fmt(S(parProd, (x) => x.cout))}</td><td className="text-right tabular" data-testid="in-rap-prod-tot-marge">{fmt(S(parProd, (x) => x.marge))}</td><td></td></tr></tfoot>}</table></div>
        {parProd.length === 0 && <div className="text-sm mb-4" style={{ color: "#8A8370" }}>Aucune vente de produit de la gamme sur la période.</div>}
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Ventes sous le coût de revient</div>
        {sousCout.length === 0 ? <div className="text-sm mb-4" style={{ color: "#8A8370" }} data-testid="in-rap-perte-aucune">Aucune vente sous le coût de revient sur la période.</div> : (
          <div className="ec-wrap mb-4"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Facture</th><th>Date</th><th>Produit</th><th className="text-right">Quantité</th><th className="text-right">Prix vendu</th><th className="text-right">Coût moyen</th><th className="text-right">Perte</th><th>Raison</th></tr></thead>
            <tbody>{sousCout.map((x, i) => (<tr key={i} data-testid="in-rap-perte-ligne"><td className="py-1.5 tabular text-xs">{x.f.number}</td><td>{ecDateFr(x.f.date)}</td><td>{x.l.label}</td><td className="text-right tabular">{x.l.qty}</td><td className="text-right tabular">{fmt(x.l.pu)}</td><td className="text-right tabular">{fmt(x.cu)}</td><td className="text-right tabular" style={{ color: "#A6432F" }}>{fmt(inR2((x.cu - x.l.pu) * x.l.qty))}</td><td className="text-xs" data-testid="in-rap-perte-motif">{x.l.perte ? (inMotifLibelle(x.l.motif, x.l.motifTxt) || "non justifiée") : "non justifiée"}</td></tr>))}</tbody>
            <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }}><td colSpan={6}>Perte totale</td><td className="text-right tabular" data-testid="in-rap-perte-total">{fmt(S(sousCout, (x) => (x.cu - x.l.pu) * x.l.qty))}</td><td></td></tr></tfoot></table></div>)}
        <div className="display text-base mb-2" style={{ color: "#152238" }}>Marge par commande (lots rattachés à la commande)</div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Commande</th><th>Client</th><th className="text-right">Facturé HT</th><th className="text-right">Coût des lots</th><th className="text-right">Marge</th></tr></thead>
          <tbody>{parCmd.map((x) => (<tr key={x.c.id} data-testid="in-rap-cmd-ligne"><td className="py-1.5 tabular text-xs">{x.c.number}</td><td>{nomClient(x.c.clientId)}</td><td className="text-right tabular">{fmt(x.f.ht)}</td><td className="text-right tabular">{fmt(x.cout)}</td><td className="text-right tabular" style={{ color: x.marge < 0 ? "#A6432F" : undefined }}>{fmt(x.marge)}</td></tr>))}</tbody></table></div>
        {parCmd.length === 0 && <div className="text-sm mb-4" style={{ color: "#8A8370" }}>Aucune commande facturée sur la période.</div>}
        <div className="flex flex-wrap items-center gap-3 mb-2"><div className="display text-base" style={{ color: "#152238" }}>Factures impayées par ancienneté</div><button onClick={exporterImp} className="text-xs underline" data-testid="in-rap-exp-imp">Exporter (CSV)</button></div>
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Client</th><th className="text-right">Factures</th><th className="text-right">0 à 30 j</th><th className="text-right">31 à 60 j</th><th className="text-right">61 à 90 j</th><th className="text-right">Plus de 90 j</th><th className="text-right">Reste dû</th></tr></thead>
          <tbody>{imp.map((x) => (<tr key={x.c.id} data-testid="in-rap-imp-ligne"><td className="py-1.5">{x.c.name}</td><td className="text-right tabular">{x.n}</td>{x.b.map((v, i) => <td key={i} className="text-right tabular">{fmt(v)}</td>)}<td className="text-right tabular">{fmt(x.tot)}</td></tr>))}</tbody>
          {imp.length > 0 && <tfoot><tr style={{ fontWeight: 600, borderTop: "2px solid #152238" }}><td colSpan={6}>Total</td><td className="text-right tabular" data-testid="in-rap-imp-tot">{fmt(S(imp, (x) => x.tot))}</td></tr></tfoot>}</table></div>
        {imp.length === 0 && <div className="text-sm mb-4" style={{ color: "#8A8370" }}>Aucune facture impayée.</div>}
        <div className="flex flex-wrap items-center gap-3 mb-2"><div className="display text-base" style={{ color: "#152238" }}>État du stock</div><button onClick={exporterStock} className="text-xs underline" data-testid="in-rap-exp-stock">Exporter (CSV)</button></div>
        <div className="text-sm" style={{ color: "#5B563F" }}>Valeur des matières en stock : <b className="tabular" data-testid="in-rap-val-mat">{fmt(S(mats, (m) => stockMat(m.id) * prixMoyen(m.id)))}</b> · valeur des produits finis (au coût de revient moyen) : <b className="tabular" data-testid="in-rap-val-prod">{fmt(S(prods, (p) => stockProd(p.id) * coutUnitProd(p.id)))}</b>. Ces valeurs sont un suivi de gestion ; l'inventaire de fin d'exercice se fait avec l'expert-comptable.</div>
      </div>
    );
  };

  // ───────── Statistiques ─────────
  const Stats = () => {
    const depA = deps.filter((x) => x.status !== "annulé");
    const caT = inR2(factsOk.reduce((s, x) => s + x.ht, 0));
    const encT = inR2(factsOk.reduce((s, x) => s + inSolde(x).paye, 0));
    const coutT = inR2(lotsOk.reduce((s, l) => s + coutLot(l).total, 0));
    const depT = inR2(depA.reduce((s, x) => s + x.amount, 0));
    const mois = statMois(6, today);
    const data = mois.map((m) => ({ mois: m.label, ca: statSomme(factsOk, "date", m.key, (x) => x.ht), cout: statSomme(lotsOk, "date", m.key, (x) => coutLot(x).total), dep: statSomme(depA, "date", m.key, (x) => x.amount) }));
    const parProd = {}; factsOk.forEach((f) => f.lines.forEach((l) => { const k = l.productId ? nomProd(l.productId) : "Sur mesure et divers"; parProd[k] = inR2((parProd[k] || 0) + l.qty * l.pu); }));
    const parCli = {}; factsOk.forEach((f) => { const k = nomClient(f.clientId); parCli[k] = inR2((parCli[k] || 0) + f.ht); });
    const parNat = {}; depA.forEach((x) => { const k = (IN_DEPENSES.find((d) => d[0] === x.kind) || [0, x.kind])[1]; parNat[k] = inR2((parNat[k] || 0) + x.amount); });
    const parMat = {}; achatsOk.forEach((a) => { const k = nomMat(a.matId); parMat[k] = inR2((parMat[k] || 0) + a.amount); });
    const parEtat = {}; cmds.filter((c) => c.status !== "annulee").forEach((c) => { const k = etatCmd(c); parEtat[k] = (parEtat[k] || 0) + 1; });
    return <StatsBloc
      vide={facts.length + lots.length + achats.length === 0 ? "Aucune activité pour le moment : les statistiques apparaîtront avec vos premiers achats, fabrications et ventes." : ""}
      kpis={[["Ventes (hors taxe)", fmt(caT), "in-stat-ca"], ["Encaissé", fmt(encT), "in-stat-enc"], ["Coût des fabrications", fmt(coutT), "in-stat-cout"], ["Dépenses d'atelier", fmt(depT), "in-stat-dep"]]}
      evolution={{ titre: "Ventes, coût des fabrications et dépenses — 6 derniers mois", data, series: [{ key: "ca", name: "Ventes", color: "#0F6B5C" }, { key: "cout", name: "Coût des fabrications", color: "#2B4C8C" }, { key: "dep", name: "Dépenses d'atelier", color: "#9A7B1E" }] }}
      repartitions={[{ titre: "Ventes par produit", data: Object.keys(parProd).map((k) => ({ name: k, value: parProd[k] })) }, { titre: "Ventes par client", data: Object.keys(parCli).map((k) => ({ name: k, value: parCli[k] })) }, { titre: "Achats par matière", data: Object.keys(parMat).map((k) => ({ name: k, value: parMat[k] })) }, { titre: "Dépenses par nature", data: Object.keys(parNat).map((k) => ({ name: k, value: parNat[k] })) }, { titre: "Commandes par état", unite: "nombre", data: Object.keys(parEtat).map((k) => ({ name: k, value: parEtat[k] })) }]} />;
  };

  // ───────── Documents imprimables ─────────
  const entete = (titre) => (
    <div style={{ textAlign: "center", marginBottom: 12 }}>
      {settings.companyLogo && <img src={settings.companyLogo} alt="" style={{ width: 60, height: 60, objectFit: "contain", margin: "0 auto 6px", display: "block" }} />}
      <div style={{ fontWeight: 700, fontSize: 20 }}>{settings.companyName || "Atelier"}</div>
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
      <tbody>{lines.map((l) => (<tr key={l.id}><td style={cellule}>{l.label}</td><td style={{ ...cellule, textAlign: "center" }}>{l.unit}</td><td style={{ ...cellule, textAlign: "right" }}>{l.qty}</td><td style={{ ...cellule, textAlign: "right" }}>{fmt(l.pu)}</td><td style={{ ...cellule, textAlign: "right" }}>{fmt(inR2(l.qty * l.pu))}</td></tr>))}</tbody></table></div>
  );
  const DevisSheet = ({ c }) => {
    const ht = cmdHt(c);
    return (
      <div style={cadre} data-testid="in-devis-feuille">
        {entete("DEVIS" + (c.kind === "mesure" ? " — TRAVAIL SUR MESURE" : ""))}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span>Commande <b>{c.number}</b></span><span>Établi le {ecDateFr(c.date)}</span></div>
        <div style={{ marginBottom: 4 }}>Client : <b>{nomClient(c.clientId)}</b></div>
        {c.subject && <div style={{ marginBottom: 4 }}>Objet : <b>{c.subject}</b></div>}
        {c.due && <div style={{ marginBottom: 10 }}>Livraison souhaitée : {ecDateFr(c.due)}</div>}
        {tableLignes(c.lines)}
        <div style={{ textAlign: "right", fontWeight: 700, fontSize: 15 }}>Total hors taxe : {fmt(ht)}</div>
        {tcaRate > 0 && <div style={{ textAlign: "right" }}>Taxe ({tcaRate} %) : {fmt(inR2(ht * tcaRate / 100))} · Total toutes taxes : {fmt(inR2(ht * (1 + tcaRate / 100)))}</div>}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 24, marginTop: 40 }}>
          <div style={{ flex: 1, borderTop: "1px solid #152238", paddingTop: 4, textAlign: "center" }}>Pour l'atelier</div>
          <div style={{ flex: 1, borderTop: "1px solid #152238", paddingTop: 4, textAlign: "center" }}>Bon pour accord du client (date et signature)</div>
        </div>
      </div>
    );
  };
  const FactureSheet = ({ f }) => {
    const s = inSolde(f);
    const ligne = (a, b, bold) => <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontWeight: bold ? 700 : 400, fontSize: bold ? 15 : 12 }}><span>{a}</span><span className="tabular">{b}</span></div>;
    return (
      <div style={tk ? { ...cadre, maxWidth: 320, padding: "10px 8px", fontSize: 11 } : cadre} data-testid="in-facture-feuille">
        {entete("FACTURE" + (f.status === "annulee" ? " — ANNULÉE" : ""))}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span>N° <b>{f.number}</b></span><span>{ecDateFr(f.date)}</span></div>
        <div style={{ marginBottom: 10 }}>Client : <b>{nomClient(f.clientId)}</b></div>
        {tk ? (<div style={{ marginBottom: 8 }}>{f.lines.map((l) => (<div key={l.id} style={{ padding: "2px 0", borderBottom: "1px dotted #999" }}><div>{l.label}</div><div style={{ display: "flex", justifyContent: "space-between" }}><span>{l.qty} {l.unit} × {fmt(l.pu)}</span><span>{fmt(inR2(l.qty * l.pu))}</span></div></div>))}</div>) : tableLignes(f.lines)}
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
    <div style={cadre} data-testid="in-catalogue-feuille">
      {entete("CATALOGUE")}
      {catsAll.map(([ck, cl]) => { const liste = prods.filter((p) => catDe(p) === ck && p.active !== false); return liste.length ? (<div key={ck} style={{ marginBottom: 14, pageBreakInside: "avoid" }}><div style={{ fontWeight: 700, fontSize: 15, borderBottom: "2px solid #C9A24B", marginBottom: 6 }}>{cl}</div>
        {liste.map((p) => (<div key={p.id} style={{ display: "flex", gap: 10, padding: "5px 0", alignItems: "center" }}>{p.photo && <img src={p.photo} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6 }} />}<div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{p.name}{stockProd(p.id) <= 0 ? " (épuisé)" : ""}</div>{p.desc && <div style={{ fontSize: 11, color: "#7A7460" }}>{p.desc}</div>}</div><div style={{ fontWeight: 600 }}>{Number(p.price) > 0 ? fmt(p.price) + " / " + p.unit : "sur devis"}</div></div>))}</div>) : null; })}
    </div>
  );
  const LotSheet = ({ l }) => {
    const c = coutLot(l);
    return (
      <div style={cadre} data-testid="in-lot-feuille">
        {entete("FICHE DE FABRICATION" + (l.status === "annulé" ? " — ANNULÉE" : ""))}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span>Lot <b>{l.number}</b></span><span>Fabriqué le {ecDateFr(l.date)}</span></div>
        <div style={{ marginBottom: 4 }}>Produit : <b>{nomLot(l)}</b> — quantité : <b>{l.qty}{l.productId ? " " + unitProd(l.productId) : ""}</b></div>
        {l.expire && <div style={{ marginBottom: 4 }}>À consommer avant le : <b>{ecDateFr(l.expire)}</b></div>}
        {l.orderId && <div style={{ marginBottom: 4 }}>Commande : {(cmds.find((x) => x.id === l.orderId) || {}).number}</div>}
        <div style={{ overflowX: "auto", marginTop: 8 }}><table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}><thead><tr style={{ background: "#F4F1E6" }}><th style={{ ...cellule, textAlign: "left" }}>Matière</th><th style={{ ...cellule, textAlign: "right" }}>Quantité</th><th style={{ ...cellule, textAlign: "right" }}>Prix moyen</th><th style={{ ...cellule, textAlign: "right" }}>Coût</th></tr></thead>
          <tbody>{l.lines.map((x) => (<tr key={x.matId}><td style={cellule}>{nomMat(x.matId)}</td><td style={{ ...cellule, textAlign: "right" }}>{x.qty} {unitMat(x.matId)}</td><td style={{ ...cellule, textAlign: "right" }}>{fmt(x.pu)}</td><td style={{ ...cellule, textAlign: "right" }}>{fmt(x.cost)}</td></tr>))}</tbody></table></div>
        <div style={{ maxWidth: 380, marginLeft: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Matières</span><span>{fmt(c.m)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Main-d'œuvre ({l.hours || 0} h × {fmt(l.rate || 0)})</span><span>{fmt(c.mo)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Autres frais</span><span>{fmt(c.fr)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 15, borderTop: "1px solid #152238", marginTop: 4, paddingTop: 4 }}><span>Coût de revient</span><span>{fmt(c.total)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Coût par unité</span><span>{fmt(inR2(c.total / l.qty))}</span></div>
        </div>
        {l.notes && <div style={{ marginTop: 10 }}>Remarques : {l.notes}</div>}
      </div>
    );
  };

  const tabs = isVendeur
    ? [["apercu", "Tableau de bord"], ["catalogue", "Catalogue"], ["clients", "Clients"], ["commandes", "Commandes"], ["ventes", "Ventes"]]
    : [["apercu", "Tableau de bord"], ["matieres", "Matières et achats"], ["produits", "Produits et recettes"], ["catalogue", "Catalogue"], ["production", "Production"], ["clients", "Clients"], ["commandes", "Commandes"], ["ventes", "Ventes"], ["depenses", "Dépenses"], ["rapports", "Rapports"], ["stats", "Statistiques"]];
  const imprDoc = (() => {
    if (!imprimer) return null;
    if (imprimer.kind === "devis") { const c = cmds.find((x) => x.id === imprimer.id); return c ? { titre: "Devis " + c.number, node: <DevisSheet c={c} /> } : null; }
    if (imprimer.kind === "catalogue") return { titre: "Catalogue", node: <CatalogueSheet /> };
    if (imprimer.kind === "lot") { const l = lots.find((x) => x.id === imprimer.id); return l ? { titre: "Fiche de fabrication " + l.number, node: <LotSheet l={l} /> } : null; }
    const f = facts.find((x) => x.id === imprimer.id);
    return f ? { titre: "Facture " + f.number, node: <FactureSheet f={f} />, ticket: true } : null;
  })();
  return (
    <>
      {listes}
      <div className={"p-4 md:p-8 max-w-6xl" + (imprDoc ? " no-print" : "")} data-testid="indus-module">
        <style>{EC_CSS + '[data-testid="indus-module"] .display.text-base{border-left:3px solid #C9A24B;padding-left:10px;margin-bottom:12px}[data-testid="indus-module"] input,[data-testid="indus-module"] select{background:#fff}'}</style>
        <div className="mb-4"><div className="display text-2xl" style={{ color: "#152238" }}>Industries artisanales</div><div className="text-xs" style={{ color: "#8A8370" }}>Matières premières, recettes, fabrications et coût de revient, commandes, ventes, dépenses d'atelier</div></div>
        {!canFront && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }}>Consultation seule : votre rôle ne permet pas de modifier les données.</div>}
        {isVendeur && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#F4F1E6", color: "#5B563F" }} data-testid="in-accueil-note">Accueil : vous pouvez enregistrer les clients, prendre les commandes, vendre, encaisser et imprimer les factures. Matières, fabrications, dépenses, annulations et rapports sont réservés au responsable.</div>}
        <div className="ec-tabs">
          {tabs.map(([id, l]) => (<button key={id} onClick={() => setTab(id)} data-testid={"in-tab-" + id} className="px-3 py-2 text-sm rounded-lg transition-colors" style={{ background: tab === id ? "#152238" : "transparent", color: tab === id ? "#EFE9DD" : "#6B6552", fontWeight: tab === id ? 600 : 500 }}>{l}</button>))}
        </div>
        {tab === "apercu" && Apercu()}
        {tab === "matieres" && !isVendeur && Matieres()}
        {tab === "produits" && !isVendeur && Produits()}
        {tab === "catalogue" && Catalogue()}
        {tab === "production" && !isVendeur && Production()}
        {tab === "clients" && Clients()}
        {tab === "commandes" && Commandes()}
        {tab === "ventes" && Ventes()}
        {tab === "depenses" && !isVendeur && Depenses()}
        {tab === "rapports" && !isVendeur && Rapports()}
        {tab === "stats" && !isVendeur && Stats()}
      </div>
      {imprDoc && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto p-3 md:p-8 no-print" style={{ background: "rgba(21,34,56,0.55)" }} onClick={() => setImprimer(null)} data-testid="in-apercu">
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: tk && imprDoc.ticket ? 340 : 820 }}>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap"><div className="text-sm" style={{ color: "#EFE9DD" }}>{imprDoc.titre}</div>
              <div className="flex gap-2 flex-wrap">
                {imprDoc.ticket && <button onClick={() => setTk(!tk)} className="px-3 py-1.5 rounded text-sm" style={ecBtn} data-testid="in-format">{tk ? "Passer en A4" : "Passer en ticket"}</button>}
                <button onClick={() => { try { window.print(); } catch (e) {} }} className="px-3 py-1.5 rounded text-sm" style={ecBtnGold} data-testid="in-imprimer-ok">Imprimer / enregistrer en PDF</button>
                <button onClick={() => setImprimer(null)} className="px-3 py-1.5 rounded text-sm" style={ecBtn} data-testid="in-apercu-fermer">Fermer</button></div></div>
            <div className="rounded shadow-lg overflow-hidden" style={{ background: "#fff" }}>{imprDoc.node}</div>
          </div>
        </div>
      )}
      {imprDoc && <div className={"print-only" + (tk && imprDoc.ticket ? " ticket-print-80" : "")}>{imprDoc.node}</div>}
    </>
  );
}

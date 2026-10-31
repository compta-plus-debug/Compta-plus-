// ═══ MODULE ═══
// @module Administration stock et sauvegardes
// @depends APP_VERSION, RotateCcw, computeBalances, fmt, isFutureDate, isLocked, todayStr, uid, useEffect
//   useState
// @exports BK_LABELS, PartialResetPanel, RestorePreviewModal, bkBalance, bkBuildFile, bkDiff, bkDownload
//   bkVerify, rpSave
// ═══ FIN DE L'EN-TÊTE ═══
// ── Changement de méthode de stock avec écriture de régularisation ─────────
function StockMethodPanel({ settings, setSettings, accounts, entries, setEntries, products, isPrimaryAdmin, showToast, logAudit }) {
  const current = settings.stockValuationMethod === "actif" ? "actif" : "charge";
  const target = current === "actif" ? "charge" : "actif";
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayStr());
  const label = (m) => (m === "actif" ? "Stock en actif" : "Stock en charge");
  const hasAcc = (code) => accounts.some((a) => a.code === code);
  const round2 = (n) => Math.round(n * 100) / 100;

  const balances = computeBalances(accounts, entries);
  const bal370 = round2(balances["370"] || 0);
  const bal39 = round2(balances["39"] || 0);
  const goods = products.filter((p) => p.type === "marchandise");
  const stockOnHand = round2(goods.reduce((t, p) => t + (Number(p.stock) || 0) * (Number(p.costPrice) || 0), 0));
  const noCost = goods.filter((p) => (Number(p.stock) || 0) > 0 && !(Number(p.costPrice) > 0));

  // Écriture de régularisation (une seule écriture équilibrée, plusieurs lignes possibles)
  const lines = [];
  if (target === "actif") {
    const adj = round2(stockOnHand - bal370); // amener le compte 370 à la valeur réelle du stock en rayon
    if (adj > 0) lines.push({ account: "370", debit: adj, credit: 0 }, { account: "607", debit: 0, credit: adj });
    if (adj < 0) lines.push({ account: "607", debit: -adj, credit: 0 }, { account: "370", debit: 0, credit: -adj });
  } else {
    if (bal370 > 0) lines.push({ account: "607", debit: bal370, credit: 0 }, { account: "370", debit: 0, credit: bal370 }); // passer le stock en charge
    if (bal370 < 0) lines.push({ account: "370", debit: -bal370, credit: 0 }, { account: "607", debit: 0, credit: -bal370 });
    if (bal39 < 0) lines.push({ account: "39", debit: -bal39, credit: 0 }, { account: "7817", debit: 0, credit: -bal39 }); // reprise des dépréciations
  }
  const missing = [...new Set(lines.map((l) => l.account))].filter((c) => !hasAcc(c));
  const accName = (c) => accounts.find((a) => a.code === c)?.name || c;

  const confirmChange = () => {
    if (!isPrimaryAdmin) { showToast("Seul l'administrateur principal peut changer la méthode de stock."); return; }
    if (isFutureDate(date)) { showToast("La date du changement ne peut pas être dans le futur."); return; }
    if (lines.length > 0 && isLocked(date, settings)) { showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Choisissez une date postérieure.`); return; }
    if (missing.length > 0) { showToast(`Compte(s) manquant(s) dans le plan comptable : ${missing.join(", ")}. Ajoutez-les avant de continuer.`); return; }
    if (!window.confirm(`Passer de « ${label(current)} » à « ${label(target)} » à la date du ${date} ?${lines.length ? " Une écriture de régularisation sera enregistrée dans le journal." : " Aucune écriture n'est nécessaire."} Les ventes déjà enregistrées ne sont pas recalculées.`)) return;
    if (lines.length > 0) {
      setEntries((prev) => [...prev, {
        id: uid(), date, createdAt: new Date().toISOString(), kind: "regularisation_stock",
        label: `Régularisation — changement de méthode de stock (${label(current)} → ${label(target)})`,
        lines,
      }]);
    }
    setSettings({ ...settings, stockValuationMethod: target });
    logAudit("Administration", "Changement de méthode de stock", `${label(current)} → ${label(target)} au ${date}${lines.length ? ` (régularisation ${fmt(lines.reduce((t, l) => t + l.debit, 0))})` : ""}`);
    showToast(`Méthode de stock changée : ${label(target)}.`);
    setOpen(false);
  };

  return (
    <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
      <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Méthode comptable du stock</div>
      <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
        <b>Stock en charge</b> : simple, mais ne respecte pas les normes comptables formelles si vous conservez du stock d'une période à l'autre.<br/>
        <b>Stock en actif</b> : le stock devient un actif au bilan, sorti au coût moyen pondéré à chaque vente — la méthode conforme, recommandée si vous présentez vos comptes à un tiers (banque, audit, fisc).
      </p>
      <div className="flex gap-2 mb-3">
        {["charge", "actif"].map((m) => (
          <div key={m} className="px-3 py-2 rounded text-xs text-left flex-1"
            style={{ background: current === m ? "#152238" : "#F3EFE3", color: current === m ? "#fff" : "#7A7460" }}>
            {label(m)}<br /><span className="opacity-75">{current === m ? "(méthode actuelle)" : m === "actif" ? "(conforme)" : "(simple)"}</span>
          </div>
        ))}
      </div>
      {!open ? (
        <button onClick={() => { if (!isPrimaryAdmin) { showToast("Seul l'administrateur principal peut changer la méthode de stock."); return; } setDate(todayStr()); setOpen(true); }}
          className="px-3 py-2 rounded text-xs text-white" style={{ background: "#152238" }}>
          Changer pour « {label(target)} »…
        </button>
      ) : (
        <div className="rounded p-4" style={{ background: "#FAF8F1", border: "1px solid #E4DFD1" }}>
          <div className="text-sm font-medium mb-2" style={{ color: "#152238" }}>Passage à « {label(target)} » — écriture de régularisation</div>
          <p className="text-xs mb-3" style={{ color: "#7A7460" }}>
            {target === "actif"
              ? "Les achats passés ont déjà été comptés en charge (607). Pour que le stock en rayon apparaisse au bilan, une écriture fait entrer sa valeur dans le compte 370 en diminuant les charges. Sans elle, le stock serait négatif après les premières ventes."
              : "Le stock inscrit au bilan (370) est passé en charge d'un seul coup, et les dépréciations existantes sont reprises. Ensuite, chaque achat sera directement une charge."}
            {" "}Les ventes déjà enregistrées ne sont pas recalculées. Idéalement, changez de méthode en début d'exercice.
          </p>
          <div className="grid grid-cols-2 gap-3 mb-3 text-xs">
            <div><div style={{ color: "#8A8370" }}>Valeur du stock en rayon (quantités × coût)</div><div className="tabular text-sm font-medium" style={{ color: "#152238" }}>{fmt(stockOnHand)}</div></div>
            <div><div style={{ color: "#8A8370" }}>Solde actuel du compte 370</div><div className="tabular text-sm font-medium" style={{ color: "#152238" }}>{fmt(bal370)}</div></div>
          </div>
          {target === "actif" && noCost.length > 0 && (
            <div className="text-xs p-2 rounded mb-3" style={{ background: "#FBF1DC", color: "#7A5B10" }}>
              {noCost.length} article{noCost.length > 1 ? "s" : ""} en stock sans coût d'achat renseigné ({noCost.slice(0, 4).map((p) => p.name).join(", ")}{noCost.length > 4 ? "…" : ""}) : leur valeur compte pour 0. Renseignez leur coût dans Vente → Catalogue avant de continuer pour un résultat exact.
            </div>
          )}
          <div className="mb-3">
            <label className="text-xs" style={{ color: "#8A8370" }}>Date du changement</label>
            <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)}
              className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
          </div>
          {lines.length === 0 ? (
            <div className="text-xs mb-3" style={{ color: "#0F6B5C" }}>Aucune écriture de régularisation nécessaire : les comptes sont déjà cohérents avec la nouvelle méthode.</div>
          ) : (
            <div className="overflow-x-auto mb-3"><table className="w-full text-xs">
              <thead><tr style={{ color: "#8A8370" }}><th className="text-left font-normal py-1">Compte</th><th className="text-right font-normal py-1">Débit</th><th className="text-right font-normal py-1">Crédit</th></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}><td className="py-1">{l.account} — {accName(l.account)}</td><td className="py-1 tabular text-right">{l.debit > 0 ? fmt(l.debit) : ""}</td><td className="py-1 tabular text-right">{l.credit > 0 ? fmt(l.credit) : ""}</td></tr>
                ))}
              </tbody>
            </table></div>
          )}
          {missing.length > 0 && <div className="text-xs mb-3" style={{ color: "#A6432F" }}>Compte(s) manquant(s) dans le plan comptable : {missing.join(", ")}.</div>}
          <div className="flex gap-2">
            <button onClick={confirmChange} className="px-3 py-2 rounded text-xs text-white" style={{ background: "#0F6B5C" }}>Confirmer le changement</button>
            <button onClick={() => setOpen(false)} className="px-3 py-2 rounded text-xs" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Chantier A : sauvegarde, contrôle d'intégrité et points de restauration ──
const BK_FORMAT = "compta-plus-backup";
const BK_FORMAT_VERSION = 2;
const BK_LABELS = {
  accounts: "Plan comptable", entries: "Écritures", products: "Produits", productImages: "Photos produits",
  invoices: "Factures", suppliers: "Fournisseurs", purchases: "Achats", movements: "Mouvements de stock",
  clients: "Clients", settings: "Paramètres", users: "Utilisateurs", employees: "Employés",
  salesStations: "Postes de vente", assets: "Immobilisations", accruals: "Charges à payer / produits à recevoir",
  deferrals: "Charges / produits d'avance", riskProvisions: "Provisions pour risques", entryTemplates: "Modèles d'écritures",
  pendingApprovals: "Approbations en attente", cheques: "Chèques", bizdocs: "Documents commerciaux", ecole: "Éducation (élèves, étudiants, frais, reçus)", impex: "Import-export (dossiers)", sante: "Santé (patients, factures, assureurs, praticiens)", resto: "Restauration (tables, menu, commandes, service)", hotel: "Hôtellerie (chambres, clients, réservations, factures de séjour)", transport: "Transport et logistique (véhicules, chauffeurs, voyages, factures, dépenses)", immo: "Immobilier et location (biens, locataires, baux, loyers, dépenses)", btp: "BTP et construction (chantiers, situations de travaux, dépenses)", indus: "Industries artisanales (matières, produits, recettes, lots, commandes, ventes)",
  payslips: "Bulletins de paie", salaryAdvances: "Avances sur salaire", loans: "Emprunts",
};
// Empreinte (cyrb53) : détecte un fichier tronqué ou altéré (copier-coller incomplet,
// transfert interrompu). Ce n'est pas une signature de sécurité.
function bkHash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16) + "-" + str.length.toString(16);
}
function bkCount(v) {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === "object") return Object.keys(v).length;
  return 0;
}
// Construit le fichier de sauvegarde : les catégories à plat (compatible avec les
// anciens exports) précédées d'un bloc _meta (version, entreprise, date, empreinte).
function bkBuildFile(data, companyId, label) {
  const payload = {};
  Object.keys(data).forEach((k) => { if (data[k] !== undefined) payload[k] = data[k]; });
  const body = JSON.stringify(payload);
  const counts = {};
  Object.keys(payload).forEach((k) => { counts[k] = bkCount(payload[k]); });
  return {
    _meta: {
      format: BK_FORMAT, formatVersion: BK_FORMAT_VERSION, appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(), companyId: companyId || null,
      companyName: (payload.settings && payload.settings.companyName) || "",
      label: label || "", counts, checksum: bkHash(body),
    },
    ...payload,
  };
}
// "ok" : empreinte conforme · "legacy" : ancien fichier sans empreinte · "corrupt" : altéré
function bkVerify(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { status: "corrupt", meta: null };
  const meta = parsed._meta && typeof parsed._meta === "object" ? parsed._meta : null;
  if (!meta || !meta.checksum) return { status: "legacy", meta };
  const rest = {};
  Object.keys(parsed).forEach((k) => { if (k !== "_meta") rest[k] = parsed[k]; });
  return { status: bkHash(JSON.stringify(rest)) === meta.checksum ? "ok" : "corrupt", meta };
}
function bkItemKey(it, i) {
  return it && typeof it === "object" ? (it.id ?? it.code ?? it.key ?? ("#" + i)) : ("#" + i);
}
// Compare l'état actuel au contenu du fichier : éléments à réapparaître (+),
// à disparaître (−) et modifiés (≠), catégorie par catégorie.
function bkDiff(cur, file) {
  const rows = [];
  Object.keys(file).forEach((cat) => {
    if (!BK_LABELS[cat]) return;
    const a = cur[cat], b = file[cat];
    let A, B;
    if (Array.isArray(b)) {
      A = new Map((Array.isArray(a) ? a : []).map((x, i) => [String(bkItemKey(x, i)), JSON.stringify(x)]));
      B = new Map(b.map((x, i) => [String(bkItemKey(x, i)), JSON.stringify(x)]));
    } else {
      A = new Map(Object.keys(a && typeof a === "object" ? a : {}).map((k) => [k, JSON.stringify(a[k])]));
      B = new Map(Object.keys(b || {}).map((k) => [k, JSON.stringify(b[k])]));
    }
    let added = 0, removed = 0, changed = 0;
    B.forEach((v, k) => { if (!A.has(k)) added++; else if (A.get(k) !== v) changed++; });
    A.forEach((v, k) => { if (!B.has(k)) removed++; });
    rows.push({ cat, label: BK_LABELS[cat], cur: bkCount(a), file: bkCount(b), added, removed, changed });
  });
  return rows;
}
function bkBalance(entries) {
  let debit = 0, credit = 0;
  (Array.isArray(entries) ? entries : []).forEach((e) => (e.lines || []).forEach((l) => { debit += Number(l.debit) || 0; credit += Number(l.credit) || 0; }));
  return { debit, credit, gap: Math.round((debit - credit) * 100) / 100 };
}
function bkDownload(fileObj, name) {
  const blob = new Blob([JSON.stringify(fileObj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

// Points de restauration : copies complètes stockées dans IndexedDB, sur cet appareil.
const RP_KEEP = 8;
function rpOpen() {
  return new Promise((resolve, reject) => {
    try {
      const r = indexedDB.open("compta-plus-restore", 1);
      r.onupgradeneeded = () => { r.result.createObjectStore("points", { keyPath: "id" }); r.result.createObjectStore("blobs", { keyPath: "id" }); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error("idb"));
      r.onblocked = () => reject(new Error("idb-blocked"));
    } catch (e) { reject(e); }
  });
}
function rpRun(stores, mode, fn) {
  return rpOpen().then((db) => new Promise((resolve, reject) => {
    let out;
    try {
      const tx = db.transaction(stores, mode);
      out = fn(...stores.map((n) => tx.objectStore(n)));
      tx.oncomplete = () => { db.close(); resolve(out && "result" in out ? out.result : out); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error("idb-tx")); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error("idb-abort")); };
    } catch (e) { try { db.close(); } catch (e2) {} reject(e); }
  }));
}
async function rpList(companyId) {
  const all = await rpRun(["points"], "readonly", (st) => st.getAll());
  return (all || []).filter((p) => p.companyId === (companyId || null)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
async function rpSave(companyId, fileObj, label, auto) {
  try {
    const id = "rp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
    const meta = { id, companyId: companyId || null, createdAt: new Date().toISOString(), label: label || "", auto: !!auto, appVersion: APP_VERSION, counts: (fileObj._meta && fileObj._meta.counts) || {} };
    await rpRun(["points", "blobs"], "readwrite", (p, b) => { p.put(meta); b.put({ id, file: fileObj }); return null; });
    const list = await rpList(companyId);
    const extra = list.slice(RP_KEEP);
    if (extra.length) await rpRun(["points", "blobs"], "readwrite", (p, b) => { extra.forEach((x) => { p.delete(x.id); b.delete(x.id); }); return null; });
    return id;
  } catch (e) { return null; }
}
async function rpGet(id) {
  const r = await rpRun(["blobs"], "readonly", (b) => b.get(id));
  return r ? r.file : null;
}
async function rpDelete(id) {
  await rpRun(["points", "blobs"], "readwrite", (p, b) => { p.delete(id); b.delete(id); return null; });
}

function RestorePreviewModal({ preview, busy, onCancel, onConfirm }) {
  const [ack, setAck] = useState(false);
  const p = preview;
  const fmtDate = (iso) => { try { return new Date(iso).toLocaleString("fr-FR"); } catch (e) { return ""; } };
  const total = p.rows.reduce((a, r) => ({ added: a.added + r.added, removed: a.removed + r.removed, changed: a.changed + r.changed }), { added: 0, removed: 0, changed: 0 });
  return (
    <div role="dialog" aria-modal="true" data-testid="restore-modal" style={{ position: "fixed", inset: 0, background: "rgba(21,34,56,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div style={{ background: "#fff", borderRadius: 8, width: "100%", maxWidth: 560, maxHeight: "92vh", overflowY: "auto", overflowX: "hidden", padding: 16, border: "1px solid #E4DFD1" }}>
        <div className="display text-xl mb-1" style={{ color: "#152238" }}>Restaurer une sauvegarde</div>
        <div className="text-xs mb-3" style={{ color: "#8A8370", wordBreak: "break-word" }}>
          Source : {p.sourceLabel}
          {p.meta && p.meta.exportedAt ? ` · créée le ${fmtDate(p.meta.exportedAt)}` : ""}
          {p.meta && p.meta.appVersion ? ` · version ${p.meta.appVersion}` : ""}
        </div>
        <div className="text-xs mb-3" style={{ color: "#152238", wordBreak: "break-word" }}>
          Entreprise du fichier : <b>{p.fileCompanyName || "(inconnue)"}</b><br />
          Entreprise actuelle : <b>{p.curCompanyName || "—"}</b>
        </div>
        {p.warnings.map((w, i) => (
          <div key={i} className="text-xs p-2 rounded mb-2" style={{ background: w.level === "error" ? "#F7E9E3" : "#FBF1DC", color: w.level === "error" ? "#A6432F" : "#7A5F10", wordBreak: "break-word" }}>{w.text}</div>
        ))}
        <table className="w-full text-xs mb-2" style={{ tableLayout: "fixed", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "#8A8370", textAlign: "left" }}>
              <th style={{ width: "40%", padding: "4px 2px", fontWeight: 500 }}>Données</th>
              <th style={{ width: "16%", padding: "4px 2px", fontWeight: 500, textAlign: "right" }}>Actuel</th>
              <th style={{ width: "16%", padding: "4px 2px", fontWeight: 500, textAlign: "right" }}>Fichier</th>
              <th style={{ width: "28%", padding: "4px 2px", fontWeight: 500, textAlign: "right" }}>+ / − / ≠</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.cat} style={{ borderTop: "1px solid #EEE9DA" }}>
                <td style={{ padding: "4px 2px", wordBreak: "break-word", color: "#152238" }}>{r.label}</td>
                <td className="tabular" style={{ padding: "4px 2px", textAlign: "right" }}>{r.cur}</td>
                <td className="tabular" style={{ padding: "4px 2px", textAlign: "right" }}>{r.file}</td>
                <td className="tabular" style={{ padding: "4px 2px", textAlign: "right", color: r.added || r.removed || r.changed ? "#152238" : "#A39C87" }}>
                  {r.added || r.removed || r.changed ? `+${r.added} / −${r.removed} / ≠${r.changed}` : "identique"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-xs mb-2" style={{ color: "#8A8370" }}>
          + : éléments qui réapparaissent · − : éléments présents aujourd'hui qui disparaîtront · ≠ : éléments modifiés.
          {p.untouched.length > 0 && ` Non concernés par ce fichier (conservés tels quels) : ${p.untouched.join(", ")}.`}
        </div>
        {p.balance && (
          <div className="text-xs mb-2" style={{ color: p.balance.gap === 0 ? "#0F6B5C" : "#A6432F" }}>
            Contrôle des écritures du fichier : {p.balance.gap === 0 ? "débits et crédits équilibrés." : `écart débit − crédit de ${p.balance.gap}.`}
          </div>
        )}
        <div className="text-xs p-2 rounded mb-3" style={{ background: "#E6F1EE", color: "#0F6B5C" }}>
          Avant d'appliquer, l'état actuel est enregistré automatiquement comme point de restauration : vous pourrez revenir en arrière depuis cet écran.
        </div>
        {!p.blocked && (
          <label className="flex items-start gap-2 mb-3 cursor-pointer">
            <input type="checkbox" checked={ack} onChange={() => setAck(!ack)} className="mt-0.5" data-testid="restore-ack" />
            <span className="text-xs" style={{ color: "#152238" }}>
              Je comprends que {total.removed} élément{total.removed > 1 ? "s" : ""} actuel{total.removed > 1 ? "s" : ""} disparaîtr{total.removed > 1 ? "ont" : "a"} et que {total.changed} {total.changed > 1 ? "seront" : "sera"} remplacé{total.changed > 1 ? "s" : ""} par la version du fichier.
            </span>
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <button onClick={onCancel} disabled={busy} data-testid="restore-cancel" className="px-3 py-1.5 rounded text-xs" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>Annuler</button>
          {!p.blocked && (
            <button onClick={onConfirm} disabled={!ack || busy} data-testid="restore-confirm" className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#A6432F", opacity: !ack || busy ? 0.5 : 1 }}>
              {busy ? "Restauration…" : "Restaurer ces données"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RestorePointsPanel({ companyId, refreshKey, buildFile, onRestoreFile, showToast }) {
  const [list, setList] = useState(null); // null = chargement, false = indisponible
  const [busy, setBusy] = useState(false);
  const reload = async () => {
    try { setList(await rpList(companyId)); } catch (e) { setList(false); }
  };
  useEffect(() => { reload(); }, [companyId, refreshKey]);
  const create = async () => {
    setBusy(true);
    const id = await rpSave(companyId, buildFile("Point manuel"), "Point manuel", false);
    setBusy(false);
    if (id) showToast("Point de restauration créé."); else showToast("Impossible de créer le point de restauration sur cet appareil. Téléchargez plutôt un fichier de sauvegarde.");
    reload();
  };
  const restore = async (pt) => {
    try {
      const f = await rpGet(pt.id);
      if (!f) { showToast("Ce point de restauration n'est plus disponible."); reload(); return; }
      onRestoreFile(f, `point de restauration du ${new Date(pt.createdAt).toLocaleString("fr-FR")}`);
    } catch (e) { showToast("Impossible de lire ce point de restauration."); }
  };
  const download = async (pt) => {
    try {
      const f = await rpGet(pt.id);
      if (!f) { showToast("Ce point de restauration n'est plus disponible."); return; }
      bkDownload(f, `point-restauration-${pt.createdAt.slice(0, 10)}.json`);
    } catch (e) { showToast("Impossible de lire ce point de restauration."); }
  };
  const remove = async (pt) => {
    if (!window.confirm("Supprimer ce point de restauration ?")) return;
    try { await rpDelete(pt.id); } catch (e) { /* ignoré : la liste est rechargée */ }
    reload();
  };
  return (
    <div className="mb-4 bg-white rounded-lg p-5" style={{ border: "1px solid #E4DFD1" }} data-testid="rp-panel">
      <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Points de restauration</div>
      <p className="text-xs mb-3" style={{ color: "#8A8370" }}>
        Copies complètes de vos données, créées automatiquement avant chaque restauration ou réinitialisation, et à la demande. Elles sont conservées sur cet appareil uniquement ({RP_KEEP} au maximum) : elles ne remplacent pas un fichier de sauvegarde téléchargé et rangé ailleurs.
      </p>
      <button onClick={create} disabled={busy} className="px-3 py-1.5 rounded text-xs text-white mb-3" style={{ background: "#152238", opacity: busy ? 0.6 : 1 }} data-testid="rp-create">Créer un point de restauration maintenant</button>
      {list === null && <div className="text-xs" style={{ color: "#A39C87" }}>Chargement…</div>}
      {list === false && <div className="text-xs" style={{ color: "#9A7B1E" }}>Les points de restauration ne sont pas disponibles sur ce navigateur (mode privé ou stockage bloqué). Utilisez l'export de fichier.</div>}
      {Array.isArray(list) && list.length === 0 && <div className="text-xs" style={{ color: "#A39C87" }}>Aucun point de restauration pour l'instant.</div>}
      {Array.isArray(list) && list.map((pt) => (
        <div key={pt.id} className="py-2 flex items-center gap-2 flex-wrap" style={{ borderTop: "1px solid #EEE9DA" }} data-testid="rp-item">
          <div className="text-xs" style={{ color: "#152238", flex: "1 1 180px", minWidth: 0, wordBreak: "break-word" }}>
            <b>{new Date(pt.createdAt).toLocaleString("fr-FR")}</b>
            <span className="block" style={{ color: "#8A8370" }}>{pt.label || "Point de restauration"} · {pt.counts.entries || 0} écriture{(pt.counts.entries || 0) > 1 ? "s" : ""}, {pt.counts.invoices || 0} facture{(pt.counts.invoices || 0) > 1 ? "s" : ""}, {pt.counts.products || 0} produit{(pt.counts.products || 0) > 1 ? "s" : ""}</span>
          </div>
          <button onClick={() => restore(pt)} className="px-2 py-1 rounded text-xs text-white" style={{ background: "#0F6B5C" }} data-testid="rp-restore">Restaurer</button>
          <button onClick={() => download(pt)} className="px-2 py-1 rounded text-xs" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>Télécharger</button>
          <button onClick={() => remove(pt)} className="px-2 py-1 rounded text-xs" style={{ border: "1px solid #DDD6C4", color: "#A6432F" }}>Supprimer</button>
        </div>
      ))}
    </div>
  );
}

// ── Réinitialisation complète ou partielle (cases à cocher) ───────────────
function PartialResetPanel({ counts, isPrimaryAdmin, settings, setSettings, apply, exportData, showToast, logAudit }) {
  const ITEMS = [
    { id: "compta", label: "Comptabilité et pièces", detail: "écritures du journal, factures de vente, achats, chèques, bulletins et avances de paie, immobilisations, régularisations, provisions — toujours effacés ensemble pour que les comptes restent cohérents (la date de clôture est aussi remise à zéro)", count: counts.entries + counts.invoices + counts.purchases + counts.cheques + counts.bizdocs + counts.payslips + counts.assets, group: "tx" },
    { id: "movements", label: "Mouvements de stock", detail: "historique des entrées, sorties, pertes et ajustements", count: counts.movements, group: "tx" },
    { id: "templates", label: "Modèles d'écritures et approbations en attente", detail: "", count: counts.templates, group: "tx" },
    { id: "products", label: "Catalogue produits", detail: "articles, prix, quantités en stock et photos", count: counts.products, group: "base" },
    { id: "clients", label: "Clients", detail: "fiches clients (les factures sont dans « Comptabilité et pièces »)", count: counts.clients, group: "base" },
    { id: "suppliers", label: "Fournisseurs", detail: "", count: counts.suppliers, group: "base" },
    { id: "employees", label: "Employés", detail: "fiches employés (les bulletins sont dans « Comptabilité et pièces »)", count: counts.employees, group: "base" },
    { id: "stations", label: "Postes de vente", detail: "", count: counts.stations, group: "base" },
    { id: "accounts", label: "Plan comptable personnalisé", detail: "revient au plan comptable standard — nécessite d'effacer aussi la comptabilité", count: counts.accounts, group: "base" },
  ];
  const [sel, setSel] = useState({});
  const [zeroStock, setZeroStock] = useState(true);
  const [open, setOpen] = useState(false);
  const toggle = (id) => setSel((p) => ({ ...p, [id]: !p[id] }));
  const preset = (ids) => setSel(Object.fromEntries(ids.map((i) => [i, true])));
  const chosen = ITEMS.filter((i) => sel[i.id]);
  const problem = sel.accounts && !sel.compta ? "Le plan comptable ne peut être réinitialisé que si la comptabilité est aussi effacée (sinon des écritures référenceraient des comptes disparus)." : null;

  const [rapport, setRapport] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const run = async () => {
    if (!isPrimaryAdmin) { showToast("Seul l'administrateur principal peut réinitialiser les données de l'entreprise."); return; }
    if (chosen.length === 0) { showToast("Cochez au moins une catégorie à réinitialiser."); return; }
    if (problem) { showToast(problem); return; }
    const recap = chosen.map((i) => `• ${i.label}`).join("\n");
    const kept = ITEMS.filter((i) => !sel[i.id]).map((i) => `• ${i.label}`).join("\n") || "(rien)";
    if (!window.confirm(`Réinitialiser ces données ? Cette action est irréversible.\n\nSERONT EFFACÉES :\n${recap}\n\nSERONT CONSERVÉES :\n${kept}\n\n(Les paramètres de l'entreprise, le logo, les utilisateurs et le journal d'audit sont toujours conservés.)`)) return;
    const typed = window.prompt('Action irréversible. Pour confirmer, tapez exactement RÉINITIALISER (en majuscules) :');
    const normalized = (typed || "").trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (normalized !== "REINITIALISER") { showToast("Réinitialisation annulée."); return; }
    setEnCours(true); setRapport(null);
    let res = null;
    try { res = await apply(sel, { zeroStock: !sel.products && zeroStock }); } catch (e) { res = { restant: [{ cat: "?", label: "la réinitialisation a été interrompue", n: 0 }] }; }
    setEnCours(false);
    logAudit("Administration", sel.products && sel.compta && ITEMS.every((i) => sel[i.id]) ? "Réinitialisation complète des données" : "Réinitialisation partielle des données", chosen.map((i) => i.label).join(", ") + (!sel.products && zeroStock ? " + quantités de stock remises à zéro" : ""));
    const restant = (res && res.restant) || [];
    setRapport({ ok: restant.length === 0, restant, compta: !!sel.compta });
    showToast(restant.length === 0 ? "Réinitialisation effectuée et vérifiée sur le serveur." : "Réinitialisation incomplète : voir le détail dans le panneau.");
    setSel({});
  };

  const Row = ({ it }) => (
    <label className="flex items-start gap-2 py-1.5 cursor-pointer">
      <input type="checkbox" checked={!!sel[it.id]} onChange={() => toggle(it.id)} className="mt-0.5" />
      <span className="text-xs" style={{ color: "#152238" }}>
        <b>{it.label}</b> <span style={{ color: "#A39C87" }}>({it.count} élément{it.count > 1 ? "s" : ""})</span>
        {it.detail && <span className="block" style={{ color: "#8A8370" }}>{it.detail}</span>}
      </span>
    </label>
  );

  return (
    <div className={"bg-white rounded-lg p-5" + (open ? " sm:col-span-3" : "")} style={{ border: "1px solid #E4DFD1" }}>
      <RotateCcw size={18} style={{ color: "#A6432F" }} className="mb-2" />
      <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Réinitialiser</div>
      <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Complète ou partielle : vous choisissez, case par case, ce qui est effacé et ce qui est conservé.</p>
      {!isPrimaryAdmin ? (
        <p className="text-xs" style={{ color: "#A39C87" }}>Réservé à l'administrateur principal.</p>
      ) : !open ? (
        <button onClick={() => setOpen(true)} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#A6432F" }}>Réinitialiser…</button>
      ) : (
        <div>
          <div className="flex flex-wrap gap-2 mb-3">
            <button onClick={() => preset(ITEMS.map((i) => i.id))} className="text-xs px-2 py-1 rounded" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>Tout cocher (complète)</button>
            <button onClick={() => preset(["compta", "movements", "templates"])} className="text-xs px-2 py-1 rounded" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>Repartir à zéro en gardant catalogue, clients, fournisseurs, employés</button>
            <button onClick={() => setSel({})} className="text-xs px-2 py-1 rounded" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>Tout décocher</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
            <div>
              <div className="text-xs font-medium mb-1" style={{ color: "#A6432F" }}>Données d'activité</div>
              {ITEMS.filter((i) => i.group === "tx").map((it) => <Row key={it.id} it={it} />)}
            </div>
            <div>
              <div className="text-xs font-medium mb-1 mt-3 md:mt-0" style={{ color: "#A6432F" }}>Données de base</div>
              {ITEMS.filter((i) => i.group === "base").map((it) => <Row key={it.id} it={it} />)}
            </div>
          </div>
          {!sel.products && (sel.compta || sel.movements) && (
            <label className="flex items-start gap-2 mt-3 cursor-pointer">
              <input type="checkbox" checked={zeroStock} onChange={() => setZeroStock(!zeroStock)} className="mt-0.5" />
              <span className="text-xs" style={{ color: "#152238" }}>Remettre à zéro les quantités en stock du catalogue conservé <span className="block" style={{ color: "#8A8370" }}>Décochez pour garder les quantités actuelles (utile si vous refaites ensuite un solde d'ouverture à la main).</span></span>
            </label>
          )}
          {problem && <div className="text-xs p-2 rounded mt-3" style={{ background: "#F7E9E3", color: "#A6432F" }}>{problem}</div>}
          {enCours && <div className="text-xs p-2 rounded mt-3" style={{ background: "#FFF6E0", color: "#152238" }} data-testid="reset-encours">Réinitialisation en cours : la date de clôture est d'abord effacée, puis les données, puis le résultat est vérifié sur le serveur. Ne fermez pas la page (quelques secondes).</div>}
          {rapport && rapport.ok && <div className="text-xs p-2 rounded mt-3" style={{ background: "#E3F2EE", color: "#0F6B5C" }} data-testid="reset-rapport-ok">Réinitialisation terminée et vérifiée : toutes les catégories choisies sont vides sur le serveur.</div>}
          {rapport && !rapport.ok && <div className="text-xs p-2 rounded mt-3" style={{ background: "#F7E9E3", color: "#A6432F" }} data-testid="reset-rapport-ko"><b>Réinitialisation incomplète.</b> Il reste sur le serveur : {rapport.restant.map((r) => r.n + " " + r.label).join(", ")}. Le serveur a refusé certaines suppressions (période clôturée ou règle de protection). Relancez la réinitialisation ; si le message revient, notez-le et transmettez-le-moi.</div>}
          <div className="flex flex-wrap gap-2 mt-4">
            <button onClick={exportData} className="px-3 py-1.5 rounded text-xs" style={{ border: "1px solid #152238", color: "#152238" }}>Télécharger une sauvegarde d'abord</button>
            <button onClick={run} disabled={chosen.length === 0 || !!problem || enCours} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#A6432F", opacity: chosen.length === 0 || problem ? 0.5 : 1 }}>Réinitialiser la sélection ({chosen.length})</button>
            <button onClick={() => { setOpen(false); setSel({}); }} className="px-3 py-1.5 rounded text-xs" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}


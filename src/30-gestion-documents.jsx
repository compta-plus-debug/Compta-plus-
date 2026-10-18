function BzAttLink({ a, showToast }) {
  return bzIsStored(a)
    ? <button type="button" data-bz="att-open" onClick={() => bzOpenAttachment(a, showToast)} style={{ color: "#3B6EA5", textDecoration: "underline" }}>{a.fileName}</button>
    : <a href={a.data} download={a.fileName} style={{ color: "#3B6EA5" }} className="underline">{a.fileName}</a>;
}
// Repère posé juste avant l'ouverture du sélecteur de fichiers : si la page est rechargée pendant le choix
// (mémoire d'un téléphone modeste), l'application le dit au retour au lieu de repartir sans explication.
function pjStep(txt) {
  try {
    const d = new Date(); const hh = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
    const arr = JSON.parse(sessionStorage.getItem("pj-trace") || "[]"); arr.push(hh + " " + String(txt).slice(0, 140));
    sessionStorage.setItem("pj-trace", JSON.stringify(arr.slice(-12)));
  } catch (e) { /* ignoré */ }
}
function pjTraceText() { try { return JSON.parse(sessionStorage.getItem("pj-trace") || "[]").join("\n"); } catch (e) { return ""; } }
function pjPickMark() {
  pjStep("ouverture du sélecteur de fichiers");
  try {
    sessionStorage.setItem("pj-pick", String(Date.now()));
    const clear = () => { window.removeEventListener("focus", clear); setTimeout(() => { try { if (!sessionStorage.getItem("pj-busy")) sessionStorage.removeItem("pj-pick"); } catch (e) { /* ignoré */ } }, 2500); };
    window.addEventListener("focus", clear);
  } catch (e) { /* ignoré */ }
}
// Pièces envoyées depuis la page légère « ajouter-piece.html » (téléphones à mémoire limitée) :
// elles attendent dans <entreprise>/pending ; on les range ici avec les autres pièces, sans doublon.
async function bzPendingRecover(atts, companyId) {
  if (!companyId) return [];
  try {
    const { data, error } = await supabase.storage.from(BZ_ST_BUCKET).list(`${companyId}/pending`, { limit: 100 });
    if (error || !Array.isArray(data)) return [];
    const stored = (atts || []).filter(bzIsStored);
    const known = new Set(stored.map((a) => a.path));
    let count = stored.length, bytes = stored.reduce((t, a) => t + (a.size || 0), 0);
    const out = [];
    for (const o of data) {
      if (!o || !o.name || o.name.charAt(0) === ".") continue;
      const path = `${companyId}/pending/${o.name}`;
      if (known.has(path)) continue;
      const size = Number(o.metadata && o.metadata.size) || 0;
      if (count >= BZ_ST_MAX_COUNT || bytes + size > BZ_ST_TOTAL) break;
      count++; bytes += size;
      out.push({ id: "pj-" + o.name.split("-")[0], type: "attachment", createdAt: o.created_at || new Date().toISOString(), ref: "", refLabel: "Non rattaché", fileName: o.name.replace(/^[^-]*-/, "") || o.name, mime: (o.metadata && o.metadata.mimetype) || "application/octet-stream", size, path });
    }
    return out;
  } catch (e) { return []; }
}
// K:ST:END

// Écritures de régularisation d'inventaire — mêmes comptes que « Perte sur stock » du module Stock :
// manquant = 658 / (370 si stock en actif, sinon 607) ; excédent = l'inverse.
function bzInventoryEntries({ diffs, settings, date, number, sessionId, mkId }) {
  const stockAcc = settings && settings.stockValuationMethod === "actif" ? "370" : "607";
  const loss = bzR(diffs.filter((x) => x.variance < 0).reduce((t, x) => t + -x.variance * x.cost, 0));
  const gain = bzR(diffs.filter((x) => x.variance > 0).reduce((t, x) => t + x.variance * x.cost, 0));
  const out = [];
  if (loss > 0) out.push({ id: mkId(), inventoryId: sessionId, date, createdAt: new Date().toISOString(), label: `Inventaire ${number} — manquants`, lines: [{ account: "658", debit: loss, credit: 0 }, { account: stockAcc, debit: 0, credit: loss }] });
  if (gain > 0) out.push({ id: mkId(), inventoryId: sessionId, date, createdAt: new Date().toISOString(), label: `Inventaire ${number} — excédents`, lines: [{ account: stockAcc, debit: gain, credit: 0 }, { account: "658", debit: 0, credit: gain }] });
  return out;
}

// ============================================================================
// Gestion avancée — interface (module 10)
// ============================================================================
const bzInp = "w-full border rounded px-2 py-1.5 text-sm";
const bzInpS = { borderColor: "#DDD6C4" };
const bzBtn = { background: "#152238", color: "#fff" };
const bzBtn2 = { border: "1px solid #DDD6C4", color: "#152238" };
function BzCard({ title, children, right, id }) {
  return (
    <div className="bg-white rounded-lg p-3 sm:p-4 mb-4 min-w-0" style={{ border: "1px solid #E4DFD1", maxWidth: "100%" }} data-bz-card={id}>
      <div className="flex flex-wrap items-center gap-2 mb-3"><div className="text-sm font-semibold min-w-0" style={{ color: "#152238" }}>{title}</div><div className="ml-auto max-w-full">{right}</div></div>
      <div className="min-w-0" style={{ overflowX: "auto", maxWidth: "100%" }}>{children}</div>
    </div>
  );
}
function BzField({ label, children }) {
  return <div><label className="text-xs" style={{ color: "#8A8370" }}>{label}</label><div className="mt-1">{children}</div></div>;
}
const BzEmpty = ({ children }) => <div className="text-sm py-4 text-center" style={{ color: "#A39C87" }}>{children}</div>;
function BzStatus({ s }) {
  const colors = { brouillon: "#8A8370", "envoyé": "#3B6EA5", "accepté": "#2F7A4A", "refusé": "#A6432F", "converti": "#2F7A4A", "reçu": "#2F7A4A", "en cours": "#B7791F", "validé": "#2F7A4A", "soumise": "#B7791F", "approuvée": "#3B6EA5", "remboursée": "#2F7A4A", "rejetée": "#A6432F", "disponible": "#3B6EA5", "imputé": "#2F7A4A", "remboursé": "#2F7A4A", "reçue": "#2F7A4A", "commandé": "#3B6EA5" };
  return <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#F3EFE3", color: colors[s] || "#8A8370" }} data-bz-status={s}>{s}</span>;
}

// Lignes de document (devis / BC / abonnement) : sélection produit + quantité + prix
function BzLinesEditor({ lines, setLines, products, mode }) {
  const list = mode === "po" ? products.filter((p) => p.type === "marchandise") : products;
  const add = () => setLines([...lines, { key: Date.now() + Math.random(), productId: "", name: "", qty: 1, price: "" }]);
  const upd = (key, patch) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  return (
    <div>
      {lines.map((l) => (
        <div key={l.key} className="grid grid-cols-6 md:grid-cols-12 gap-2 mb-2 items-center" data-bz="line">
          <select className={`${bzInp} col-span-6 md:col-span-5`} style={bzInpS} value={String(l.productId ?? "")} data-bz="line-product"
            onChange={(e) => { const p = list.find((x) => String(x.id) === e.target.value); upd(l.key, { productId: p ? p.id : "", name: p ? p.name : l.name, price: p ? (mode === "po" ? (p.costPrice || "") : p.price) : l.price }); }}>
            <option value="">{mode === "po" ? "— Produit —" : "— Produit ou prestation libre —"}</option>
            {list.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
          </select>
          {mode !== "po" && !l.productId && <input className={`${bzInp} col-span-6 md:col-span-3`} style={bzInpS} placeholder="Libellé libre" value={l.name || ""} data-bz="line-name" onChange={(e) => upd(l.key, { name: e.target.value })} />}
          <input type="number" min="0" className={`${bzInp} col-span-3 md:col-span-2`} style={bzInpS} placeholder="Qté" value={l.qty} data-bz="line-qty" onChange={(e) => upd(l.key, { qty: e.target.value })} />
          <input type="number" min="0" className={`${bzInp} col-span-2 md:col-span-2`} style={bzInpS} placeholder={mode === "po" ? "Coût unit." : "Prix"} value={l.price} data-bz="line-price" onChange={(e) => upd(l.key, { price: e.target.value })} />
          <button type="button" className="text-xs col-span-1" style={{ color: "#A6432F" }} onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>✕</button>
        </div>
      ))}
      <button type="button" className="text-xs px-2.5 py-1 rounded" style={bzBtn2} onClick={add} data-bz="add-line">+ Ajouter une ligne</button>
    </div>
  );
}

// ---------------------------------------------------------------- Phase 2
function BzEcheances({ P }) {
  const { invoices, setInvoices, purchases, setPurchases, bizdocs, settings, setSettings, role, showToast } = P;
  const today = todayStr();
  const rec = bzReceivables(invoices, settings), pay = bzPayables(purchases, settings);
  const agR = bzAging(rec, today), agP = bzAging(pay, today);
  const al = bzAlerts({ invoices, purchases, bizdocs, settings, today });
  const cols = [["current", "Non échu"], ["d30", "1-30 j"], ["d60", "31-60 j"], ["d90", "61-90 j"], ["over90", "> 90 j"]];
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const AgingTable = ({ ag, id, partyLabel }) => (
    <div className="overflow-x-auto"><table className="w-full text-sm" style={{ minWidth: 520 }} data-bz={id}>
      <thead><tr style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}><th className="py-2 px-2 text-left font-normal">{partyLabel}</th>{cols.map(([k, l]) => <th key={k} className="py-2 px-2 text-right font-normal">{l}</th>)}<th className="py-2 px-2 text-right font-normal">Total</th></tr></thead>
      <tbody>
        {ag.parties.length === 0 && <tr><td colSpan={7}><BzEmpty>Rien à recevoir/payer.</BzEmpty></td></tr>}
        {ag.parties.map((p) => <tr key={p.party} data-bz-party={p.party} style={{ borderBottom: "1px solid #F3EFE3" }}><td className="py-1.5 px-2">{p.party}</td>{cols.map(([k]) => <td key={k} className="py-1.5 px-2 text-right tabular">{p[k] ? fmt(p[k]) : "—"}</td>)}<td className="py-1.5 px-2 text-right tabular font-semibold">{fmt(p.total)}</td></tr>)}
        <tr style={{ background: "#FAF8F1" }}><td className="py-1.5 px-2 font-semibold">Total</td>{cols.map(([k]) => <td key={k} data-bz={`${id}-${k}`} className="py-1.5 px-2 text-right tabular font-semibold">{fmt(ag.buckets[k])}</td>)}<td data-bz={`${id}-total`} className="py-1.5 px-2 text-right tabular font-semibold">{fmt(ag.total)}</td></tr>
      </tbody>
    </table></div>
  );
  const setDueInv = (id, v) => { if (!canEdit) return; setInvoices((prev) => prev.map((i) => (i.id === id ? { ...i, dueDate: v } : i))); };
  const setDuePur = (id, v) => { if (!canEdit) return; setPurchases((prev) => prev.map((i) => (i.id === id ? { ...i, dueDate: v } : i))); };
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[["Clients en retard", al.overdueRec, "#A6432F", "alert-overdue-rec"], ["Fournisseurs en retard", al.overduePay, "#A6432F", "alert-overdue-pay"], ["À payer sous 7 jours", al.soonPay, "#B7791F", "alert-soon-pay"], ["À encaisser sous 7 jours", al.soonRec, "#2F7A4A", "alert-soon-rec"]].map(([t, v, c, id]) => (
          <div key={id} className="bg-white rounded-lg p-3" style={{ border: "1px solid #E4DFD1" }} data-bz={id}>
            <div className="text-xs" style={{ color: "#8A8370" }}>{t}</div>
            <div className="text-lg font-semibold tabular" style={{ color: v.n ? c : "#152238" }}><span data-bz="n">{v.n}</span> · <span data-bz="amount">{fmt(v.amount)}</span></div>
          </div>
        ))}
      </div>
      {(al.recurringDue > 0 || al.quotesExpiring > 0) && (
        <div className="rounded-lg p-3 mb-4 text-sm" style={{ background: "#FFF8E6", border: "1px solid #E9D9A6", color: "#7A5B00" }} data-bz="alert-misc">
          {al.recurringDue > 0 && <div>⏰ {al.recurringDue} abonnement(s) à facturer (onglet Récurrence).</div>}
          {al.quotesExpiring > 0 && <div>⏳ {al.quotesExpiring} devis/proforma envoyé(s) dont la validité est dépassée.</div>}
        </div>
      )}
      <BzCard title="Conditions de règlement par défaut" id="terms">
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <BzField label="Clients (jours)"><input type="number" min="0" className={bzInp} style={bzInpS} data-bz="terms-cli" value={settings.paymentTermsDays ?? 30} onChange={(e) => setSettings((s) => ({ ...s, paymentTermsDays: Math.max(0, Number(e.target.value) || 0) }))} /></BzField>
          <BzField label="Fournisseurs (jours)"><input type="number" min="0" className={bzInp} style={bzInpS} data-bz="terms-sup" value={settings.supplierTermsDays ?? 30} onChange={(e) => setSettings((s) => ({ ...s, supplierTermsDays: Math.max(0, Number(e.target.value) || 0) }))} /></BzField>
        </div>
        <div className="text-xs mt-2" style={{ color: "#A39C87" }}>L'échéance = date de la facture/achat + ce délai. Vous pouvez la modifier facture par facture ci-dessous.</div>
      </BzCard>
      <BzCard title="Balance âgée — créances clients" id="aging-rec"><AgingTable ag={agR} id="aging-rec" partyLabel="Client" /></BzCard>
      <BzCard title="Balance âgée — dettes fournisseurs" id="aging-pay"><AgingTable ag={agP} id="aging-pay" partyLabel="Fournisseur" /></BzCard>
      <BzCard title="Détail des échéances" id="due-detail">
        <div className="overflow-x-auto"><table className="w-full text-sm" style={{ minWidth: 520 }}><thead><tr style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}><th className="py-2 px-2 text-left font-normal">Type</th><th className="py-2 px-2 text-left font-normal">Tiers</th><th className="py-2 px-2 text-left font-normal">Pièce</th><th className="py-2 px-2 text-left font-normal">Échéance</th><th className="py-2 px-2 text-right font-normal">Retard</th><th className="py-2 px-2 text-right font-normal">Montant</th></tr></thead>
          <tbody>
            {agR.rows.length + agP.rows.length === 0 && <tr><td colSpan={6}><BzEmpty>Aucune échéance en cours.</BzEmpty></td></tr>}
            {agR.rows.map((r) => <tr key={"r" + r.id} data-bz="due-row" data-bz-kind="client" style={{ borderBottom: "1px solid #F3EFE3" }}><td className="py-1.5 px-2">Créance</td><td className="py-1.5 px-2">{r.party}</td><td className="py-1.5 px-2">{r.ref}</td><td className="py-1.5 px-2"><input type="date" className="border rounded px-1 py-0.5 text-xs" style={bzInpS} value={r.due} data-bz="due-input" onChange={(e) => e.target.value && setDueInv(r.id, e.target.value)} /></td><td className="py-1.5 px-2 text-right tabular" style={{ color: r.late ? "#A6432F" : "#8A8370" }}>{r.late ? `${r.late} j` : "—"}</td><td className="py-1.5 px-2 text-right tabular">{fmt(r.amount)}</td></tr>)}
            {agP.rows.map((r) => <tr key={"p" + r.id} data-bz="due-row" data-bz-kind="fournisseur" style={{ borderBottom: "1px solid #F3EFE3" }}><td className="py-1.5 px-2">Dette</td><td className="py-1.5 px-2">{r.party}</td><td className="py-1.5 px-2">{r.ref}</td><td className="py-1.5 px-2"><input type="date" className="border rounded px-1 py-0.5 text-xs" style={bzInpS} value={r.due} data-bz="due-input" onChange={(e) => e.target.value && setDuePur(r.id, e.target.value)} /></td><td className="py-1.5 px-2 text-right tabular" style={{ color: r.late ? "#A6432F" : "#8A8370" }}>{r.late ? `${r.late} j` : "—"}</td><td className="py-1.5 px-2 text-right tabular">{fmt(r.amount)}</td></tr>)}
          </tbody></table></div>
      </BzCard>
    </div>
  );
}

// ---------------------------------------------------------------- Phase 4 : devis / proforma / bons de commande
function BzDocs({ P }) {
  const { bizdocs, setBizdocs, products, setProducts, suppliers, clients, invoices, setInvoices, setEntries, setMovements, setPurchases, settings, role, showToast, logAudit, getInvoiceNumber } = P;
  const [kind, setKind] = useState("quote");
  const [party, setParty] = useState("");
  const [supId, setSupId] = useState("");
  const [valid, setValid] = useState(bzAddDays(todayStr(), 30));
  const [lines, setLines] = useState([{ key: 1, productId: "", name: "", qty: 1, price: "" }]);
  const [recv, setRecv] = useState(null); // { id, mode }
  const taxActive = settings.taxSystem !== "aucune";
  const taxLabel = (TAX_SYSTEMS[settings.taxSystem] || {}).label || "Taxe";
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const docs = bizdocs.filter((d) => ["quote", "proforma", "po"].includes(d.type)).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const patch = (id, p) => setBizdocs((prev) => prev.map((d) => (d.id === id ? { ...d, ...p } : d)));
  const clientNames = [...new Set([...(clients || []).map((c) => c.name), ...invoices.map((i) => i.client)].filter(Boolean))];

  const save = () => {
    if (!canEdit) { showToast("Droits insuffisants."); return; }
    if (kind === "po") {
      const sup = suppliers.find((s) => String(s.id) === String(supId));
      if (!sup) { showToast("Choisissez le fournisseur."); return; }
      const ls = lines.filter((l) => l.productId && Number(l.qty) > 0).map((l) => ({ productId: l.productId, name: l.name, qty: Number(l.qty), unitCost: Number(l.price) || 0 }));
      if (ls.length === 0) { showToast("Ajoutez au moins un produit avec une quantité."); return; }
      const doc = { id: uid(), type: "po", number: bzNextNumber(bizdocs, "po"), date: todayStr(), createdAt: new Date().toISOString(), supplierId: sup.id, supplierName: sup.name, lines: ls, total: bzR(ls.reduce((s, l) => s + l.qty * l.unitCost, 0)), status: "brouillon" };
      setBizdocs((prev) => [...prev, doc]); setLines([{ key: Date.now(), productId: "", name: "", qty: 1, price: "" }]);
      showToast(`Bon de commande ${doc.number} créé.`); logAudit("Gestion", "Bon de commande créé", `${doc.number} — ${sup.name}`);
    } else {
      if (!party.trim()) { showToast("Indiquez le nom du client."); return; }
      const calc = bzCalcLines(lines.map((l) => ({ ...l, price: l.price })), products, taxActive);
      if (calc.lines.length === 0 || calc.total <= 0) { showToast("Ajoutez au moins une ligne avec quantité et prix."); return; }
      const doc = { id: uid(), type: kind, number: bzNextNumber(bizdocs, kind), date: todayStr(), createdAt: new Date().toISOString(), client: party.trim(), validUntil: valid, lines: calc.lines, totalHT: calc.totalHT, totalTax: calc.totalTax, total: calc.total, status: "brouillon" };
      setBizdocs((prev) => [...prev, doc]); setLines([{ key: Date.now(), productId: "", name: "", qty: 1, price: "" }]); setParty("");
      showToast(`${kind === "quote" ? "Devis" : "Proforma"} ${doc.number} créé.`); logAudit("Gestion", kind === "quote" ? "Devis créé" : "Proforma créé", `${doc.number} — ${doc.client}`);
    }
  };

  const convert = async (d) => {
    if (!canEdit) { showToast("Droits insuffisants."); return; }
    if (d.status === "converti") return;
    const today = todayStr();
    if (isLocked(today, settings)) { showToast(`Période clôturée jusqu'au ${settings.lockDate}.`); return; }
    const calc = { lines: d.lines.map((l) => ({ ...l, account: (products.find((p) => p.id === l.productId) || {}).account || "706", type: (products.find((p) => p.id === l.productId) || {}).type || "service" })), totalHT: d.totalHT, totalTax: d.totalTax, total: d.total };
    const stockLines = calc.lines.filter((l) => l.type === "marchandise" && l.productId != null).map((l) => ({ productId: l.productId, qty: l.qty, name: l.name }));
    const short = bzStockShortage(stockLines, products);
    if (short.length) { showToast(`Stock insuffisant : ${short.map((s) => `${s.name} (${s.have} dispo, ${s.need} demandé)`).join(", ")}`); return; }
    let number;
    try { number = await getInvoiceNumber(); } catch (e) { showToast("Impossible d'obtenir un numéro de facture (connexion instable). Réessayez."); return; }
    const id = uid();
    const r = bzBuildCreditInvoice({ id, number, date: today, client: d.client, calc, products, settings, taxLabel, source: { type: d.type, id: d.id, number: d.number } });
    setInvoices((prev) => [...prev, r.invoice]);
    setEntries((prev) => [...prev, r.saleEntry, ...(r.cogsEntry ? [r.cogsEntry] : [])]);
    if (r.stockLines.length) {
      setProducts((prev) => prev.map((p) => { const l = r.stockLines.find((x) => x.productId === p.id); return l ? { ...p, stock: (Number(p.stock) || 0) - l.qty } : p; }));
      setMovements((prev) => [...prev, ...r.movements]);
    }
    patch(d.id, { status: "converti", invoiceId: id, invoiceNumber: number });
    showToast(`Facture ${number} créée à partir de ${d.number} (à crédit, échéance selon vos conditions).`);
    logAudit("Gestion", "Conversion en facture", `${d.number} → ${number}`);
  };

  const receive = (d, mode) => {
    if (!canEdit) { showToast("Droits insuffisants."); return; }
    const today = todayStr();
    if (isLocked(today, settings)) { showToast(`Période clôturée jusqu'au ${settings.lockDate}.`); return; }
    const r = bzReceivePO(d, { suppliers, products, date: today, paymentMode: mode, settings });
    r.purchase.id = uid(); r.entry.id = r.purchase.id;
    r.movements.forEach((m, i) => { m.id = uid(); });
    setEntries((prev) => [...prev, r.entry]);
    setPurchases((prev) => [...prev, r.purchase]);
    setProducts((prev) => prev.map((p) => r.nextProducts.find((n) => n.id === p.id) || p));
    setMovements((prev) => [...prev, ...r.movements]);
    patch(d.id, { status: "reçu", purchaseId: r.purchase.id, receivedAt: today });
    setRecv(null);
    showToast(`Commande ${d.number} réceptionnée : stock mis à jour, achat de ${fmt(r.amount)} enregistré (${mode === "credit" ? "à payer" : "payé"}).`);
    logAudit("Gestion", "Réception bon de commande", `${d.number} — ${fmt(r.amount)}`);
  };

  return (
    <div>
      <BzCard title="Nouveau document" id="doc-form">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <BzField label="Type"><select className={bzInp} style={bzInpS} value={kind} data-bz="doc-kind" onChange={(e) => { setKind(e.target.value); setLines([{ key: Date.now(), productId: "", name: "", qty: 1, price: "" }]); }}><option value="quote">Devis</option><option value="proforma">Facture proforma</option><option value="po">Bon de commande fournisseur</option></select></BzField>
          {kind === "po" ? (
            <BzField label="Fournisseur"><select className={bzInp} style={bzInpS} value={String(supId)} data-bz="doc-supplier" onChange={(e) => setSupId(e.target.value)}><option value="">— Choisir —</option>{suppliers.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}</select></BzField>
          ) : (
            <>
              <BzField label="Client"><input className={bzInp} style={bzInpS} list="bz-clients" value={party} data-bz="doc-client" onChange={(e) => setParty(e.target.value)} /><datalist id="bz-clients">{clientNames.map((n) => <option key={n} value={n} />)}</datalist></BzField>
              <BzField label="Valable jusqu'au"><input type="date" className={bzInp} style={bzInpS} value={valid} data-bz="doc-valid" onChange={(e) => setValid(e.target.value)} /></BzField>
            </>
          )}
        </div>
        <BzLinesEditor lines={lines} setLines={setLines} products={products} mode={kind === "po" ? "po" : "sale"} />
        <div className="mt-3"><button className="text-sm px-4 py-1.5 rounded" style={bzBtn} onClick={save} data-bz="doc-save">Enregistrer le document</button></div>
      </BzCard>
      <BzCard title="Devis, proformas et commandes" id="doc-list">
        {docs.length === 0 ? <BzEmpty>Aucun document pour le moment.</BzEmpty> : (
          <div className="overflow-x-auto"><table className="w-full text-sm" style={{ minWidth: 520 }}><thead><tr style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}><th className="py-2 px-2 text-left font-normal">N°</th><th className="py-2 px-2 text-left font-normal">Tiers</th><th className="py-2 px-2 text-left font-normal">Date</th><th className="py-2 px-2 text-right font-normal">Total</th><th className="py-2 px-2 text-left font-normal">Statut</th><th className="py-2 px-2 text-left font-normal">Actions</th></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} data-bz="doc-row" data-bz-number={d.number} style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-1.5 px-2 font-medium">{d.number}</td>
                  <td className="py-1.5 px-2">{d.client || d.supplierName}</td>
                  <td className="py-1.5 px-2">{d.date}</td>
                  <td className="py-1.5 px-2 text-right tabular">{fmt(d.total)}</td>
                  <td className="py-1.5 px-2"><BzStatus s={d.status} />{d.invoiceNumber && <span className="text-xs ml-1" style={{ color: "#8A8370" }}>→ {d.invoiceNumber}</span>}</td>
                  <td className="py-1.5 px-2"><div className="flex flex-wrap gap-1.5">
                    {d.type !== "po" && d.status === "brouillon" && <button className="text-xs px-2 py-0.5 rounded" style={bzBtn2} data-bz="act-send" onClick={() => patch(d.id, { status: "envoyé" })}>Marquer envoyé</button>}
                    {d.type !== "po" && d.status === "envoyé" && <><button className="text-xs px-2 py-0.5 rounded" style={bzBtn2} data-bz="act-accept" onClick={() => patch(d.id, { status: "accepté" })}>Accepté</button><button className="text-xs px-2 py-0.5 rounded" style={bzBtn2} data-bz="act-refuse" onClick={() => patch(d.id, { status: "refusé" })}>Refusé</button></>}
                    {d.type !== "po" && ["accepté", "envoyé", "brouillon"].includes(d.status) && <button className="text-xs px-2 py-0.5 rounded" style={bzBtn} data-bz="act-convert" onClick={() => convert(d)}>Convertir en facture</button>}
                    {d.type === "po" && d.status === "brouillon" && <button className="text-xs px-2 py-0.5 rounded" style={bzBtn2} data-bz="act-order" onClick={() => patch(d.id, { status: "commandé" })}>Marquer commandé</button>}
                    {d.type === "po" && ["brouillon", "commandé"].includes(d.status) && (recv && recv.id === d.id ? (
                      <span className="flex flex-wrap items-center gap-1.5"><select className="border rounded px-1 py-0.5 text-xs" style={bzInpS} value={recv.mode} data-bz="recv-mode" onChange={(e) => setRecv({ id: d.id, mode: e.target.value })}><option value="credit">À payer (crédit)</option><option value="caisse">Payé en caisse</option><option value="banque">Payé par banque</option></select><button className="text-xs px-2 py-0.5 rounded" style={bzBtn} data-bz="recv-ok" onClick={() => receive(d, recv.mode)}>Confirmer la réception</button></span>
                    ) : <button className="text-xs px-2 py-0.5 rounded" style={bzBtn} data-bz="act-receive" onClick={() => setRecv({ id: d.id, mode: "credit" })}>Réceptionner</button>)}
                  </div></td>
                </tr>
              ))}
            </tbody></table></div>
        )}
      </BzCard>
    </div>
  );
}


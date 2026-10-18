function BzImportPos({ P }) {
  const { entries, setEntries, invoices, setInvoices, clients, setClients, accounts, settings, role, showToast, logAudit } = P;
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null);
  const [revenueAccount, setRevenueAccount] = useState("707");
  const [taxRate, setTaxRate] = useState("");
  const [allowMismatch, setAllowMismatch] = useState(false);
  const [payMap, setPayMap] = useState({});
  const [result, setResult] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(null);
  const [cancelMsg, setCancelMsg] = useState(null);
  const productAccounts = (accounts || []).filter((a) => a.type === "Produit");
  const modes = parsed ? [...new Set(parsed.tickets.map((t) => t.payMode).filter((m) => m !== undefined))] : [];
  const opts = { revenueAccount, taxIncludedRate: Number(taxRate) || 0, allowMismatch, payMap: { ...Object.fromEntries(modes.map((m) => [m, posPayAccountFor(m)])), ...payMap } };
  const preview = parsed ? posBuildImport(parsed.tickets, { entries, invoices, clients, settings, opts, mkId: () => "x", nowIso: "", batchId: "x" }) : null;
  const analyse = () => { setResult(null); setParsed(posParseReceipts(text)); };
  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { setText(String(r.result || "")); setParsed(null); setResult(null); };
    r.onerror = () => showToast("Ce fichier n'a pas pu être lu. Vérifiez votre connexion internet et réessayez.");
    r.readAsText(f);
    e.target.value = "";
  };
  const run = () => {
    if (!canEdit) { showToast("Seuls un administrateur ou un éditeur peuvent importer des tickets."); return; }
    const batchId = uid();
    const res = posBuildImport(parsed.tickets, { entries, invoices, clients, settings, opts, mkId: uid, nowIso: new Date().toISOString(), batchId });
    if (res.entries.length === 0) { showToast("Aucun ticket à importer."); setResult({ done: 0, skipped: res.skipped }); return; }
    setEntries((prev) => [...prev, ...res.entries]);
    setInvoices((prev) => [...prev, ...res.invoices]);
    if (res.clients.length) setClients((prev) => [...prev, ...res.clients]);
    const sum = res.imported.reduce((s, x) => s + x.total, 0);
    logAudit("Gestion", "Import de tickets POS", `${res.imported.length} ticket(s) — ${fmt(sum)}`);
    showToast(`${res.imported.length} ticket(s) importé(s) pour ${fmt(sum)}.`);
    setResult({ done: res.imported.length, total: sum, skipped: res.skipped, newClients: res.clients.length });
    setParsed(null); setText("");
  };
  const batches = (() => {
    const m = {};
    (entries || []).forEach((e) => { if (e.importBatch && !e.cancelledBy && !e.reversalOf) { (m[e.importBatch] = m[e.importBatch] || []).push(e); } });
    return Object.entries(m).map(([id, list]) => ({ id, list, total: list.reduce((s, e) => s + (e.lines || []).reduce((a, l) => a + (Number(l.debit) || 0), 0), 0), date: (list[0].createdAt || "").slice(0, 10) })).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  })();
  const cancelBatch = (b) => {
    setConfirmCancel(null);
    if (role !== "Administrateur") { const m = "Seul un administrateur peut annuler un import."; setCancelMsg({ ok: false, text: m }); showToast(m); return; }
    const res = asstApplyFix({ kind: "reverse", entryIds: b.list.map((e) => e.id) }, { entries, accounts, settings, mkId: uid, today: todayStr(), nowIso: new Date().toISOString() });
    if (res.error) { setCancelMsg({ ok: false, text: res.error }); showToast(res.error); return; }
    setEntries(res.entries);
    setInvoices((prev) => prev.map((i) => (String(i.importBatch) === String(b.id) ? { ...i, status: "annulée" } : i)));
    logAudit("Gestion", "Annulation d'un import de tickets POS", `${b.list.length} ticket(s)`);
    setCancelMsg({ ok: true, text: `Import annulé (${b.list.length} ticket(s)). Vous pouvez maintenant coller à nouveau les tickets pour les réimporter.` });
    showToast("Import annulé par contrepassation.");
  };
  const statusLabel = { ok: "Prêt", ecart: "Total à vérifier", invalide: "Illisible" };
  const statusColor = { ok: "#2F7D4F", ecart: "#B7791F", invalide: "#B3402F" };
  return (
    <div className="space-y-5 min-w-0" data-testid="pos-import" style={{ overflowWrap: "anywhere" }}>
      <div className="bg-white rounded-lg p-4 sm:p-5" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-semibold mb-1" style={{ color: "#152238" }}>Importer des tickets de caisse (Zobase POS)</div>
        <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Collez le texte d'un ou de plusieurs tickets, ou choisissez un fichier texte. Chaque ticket devient une écriture et une facture importée. Un ticket déjà importé est ignoré.</p>
        <textarea data-testid="pos-text" value={text} onChange={(e) => { setText(e.target.value); setParsed(null); setResult(null); }} rows={8}
          placeholder={"Receipt #BJ-3179\n12 Oct 26 - 09:17\nPayment Mode: Credit\n…"}
          className="w-full border rounded px-2 py-1.5 text-xs font-mono" style={{ borderColor: "#DDD6C4", minWidth: 0 }} />
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <button onClick={analyse} disabled={!text.trim()} data-testid="pos-analyse" className="text-sm px-4 py-2 rounded" style={{ background: "#152238", color: "#EFE9DD", opacity: text.trim() ? 1 : 0.5 }}>Analyser</button>
          <label className="text-xs underline cursor-pointer" style={{ color: "#8A8370" }}>Choisir un fichier texte<input type="file" accept=".txt,.csv,.text,text/plain" className="hidden" onChange={onFile} data-ro-ok /></label>
        </div>
      </div>
      {parsed && (
        <div className="bg-white rounded-lg p-4 sm:p-5" style={{ border: "1px solid #E4DFD1" }} data-testid="pos-preview">
          {parsed.tickets.length === 0 ? (
            <div className="text-sm" style={{ color: "#B3402F" }}>Aucun ticket reconnu. Le texte doit être un ticket Zobase : soit « Receipt # » suivi du numéro puis le tableau Article / Qté / Taux / Montant, soit le message client « BJ-0000 Date: … » avec les lignes « x 1 $… », Subtotal et TOTAL.</div>
          ) : (
            <>
              <div className="grid sm:grid-cols-3 gap-3 mb-4">
                <div>
                  <label className="text-xs" style={{ color: "#8A8370" }}>Compte de produit</label>
                  <select value={revenueAccount} onChange={(e) => setRevenueAccount(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                    {(productAccounts.length ? productAccounts : [{ code: "707", name: "Ventes de marchandises" }]).map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs" style={{ color: "#8A8370" }}>Taxe incluse dans les totaux (%)</label>
                  <input value={taxRate} onChange={(e) => setTaxRate(e.target.value)} placeholder="0 = aucune taxe" inputMode="decimal" className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
                </div>
                <div className="space-y-1">
                  <div className="text-xs" style={{ color: "#8A8370" }}>Mode de paiement → compte</div>
                  {modes.map((m) => (
                    <div key={m || "(vide)"} className="flex items-center gap-2 text-xs">
                      <span className="shrink-0" style={{ color: "#152238" }}>{m || "(non indiqué)"}</span>
                      <select value={opts.payMap[m]} onChange={(e) => setPayMap({ ...payMap, [m]: e.target.value })} className="border rounded px-1 py-1 text-xs min-w-0" style={{ borderColor: "#DDD6C4" }}>
                        <option value="530">Caisse (530)</option><option value="512">Banque (512)</option><option value="411">Client à crédit (411)</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr style={{ color: "#8A8370" }}><th className="text-left font-normal py-1">Ticket</th><th className="text-left font-normal">Date</th><th className="text-left font-normal">Client</th><th className="text-right font-normal">Articles</th><th className="text-right font-normal">Total</th><th className="text-left font-normal pl-3">État</th></tr></thead>
                  <tbody>
                    {parsed.tickets.map((t, i) => {
                      const skip = preview.skipped.find((s) => String(s.number) === String(t.number || "?"));
                      return (
                        <tr key={i} style={{ borderTop: "1px solid #F3EFE3" }} data-testid="pos-row">
                          <td className="py-1.5">{t.number || "?"}</td><td>{t.date || "—"}</td><td>{t.customer || "Client comptant"}</td>
                          <td className="text-right tabular">{t.lines.length}</td>
                          <td className="text-right tabular">{fmt(t.net != null ? t.net : (t.status === "ecart" ? t.computed : (t.total != null ? t.total : t.computed)))}</td>
                          <td className="pl-3" style={{ color: skip ? "#B3402F" : statusColor[t.status] }}>
                            {skip ? `Ignoré : ${skip.why}` : statusLabel[t.status]}
                            {t.warnings.length > 0 && <div style={{ color: "#8A8370" }}>{t.warnings.join(" ")}</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {parsed.tickets.some((t) => t.status === "ecart") && (
                <label className="flex items-center gap-2 text-xs mt-3" style={{ color: "#152238" }}>
                  <input type="checkbox" checked={allowMismatch} onChange={(e) => setAllowMismatch(e.target.checked)} />
                  Importer aussi les tickets dont le total est à vérifier (la somme des articles est alors utilisée)
                </label>
              )}
              <div className="flex flex-wrap items-center gap-3 mt-4">
                <button onClick={run} disabled={!preview || preview.entries.length === 0} data-testid="pos-run" className="text-sm px-4 py-2 rounded" style={{ background: "#0F6B5C", color: "#fff", opacity: preview && preview.entries.length ? 1 : 0.5 }}>
                  Importer {preview ? preview.entries.length : 0} ticket(s)
                </button>
                {preview && preview.entries.length > 0 && <span className="text-xs" style={{ color: "#8A8370" }}>pour {fmt(preview.imported.reduce((s, x) => s + x.total, 0))}</span>}
                {preview && preview.entries.length === 0 && (
                  <span className="text-xs" data-testid="pos-why" style={{ color: "#B3402F" }}>
                    {preview.skipped.some((x) => x.why === "déjà importé")
                      ? "Ces tickets sont déjà importés. Pour les réimporter, annulez d'abord l'import existant dans « Imports effectués » plus bas."
                      : preview.skipped.some((x) => x.why === "total à vérifier")
                        ? "Total à vérifier : cochez la case ci-dessus pour importer quand même avec la somme des articles."
                        : preview.skipped.some((x) => String(x.why).startsWith("période clôturée"))
                          ? "Période clôturée : rouvrez la période pour importer ces tickets."
                          : "Aucun ticket importable dans ce texte."}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {result && (
        <div className="rounded-lg p-4 text-sm" style={{ background: "#F1F7F2", border: "1px solid #CFE3D4", color: "#152238" }} data-testid="pos-result">
          {result.done} ticket(s) importé(s){result.total ? ` pour ${fmt(result.total)}` : ""}{result.newClients ? `, ${result.newClients} nouveau(x) client(s) créé(s)` : ""}.
          {result.skipped && result.skipped.length > 0 && <div className="text-xs mt-1" style={{ color: "#8A6D1F" }}>Ignorés : {result.skipped.map((s) => `${s.number} (${s.why})`).join(", ")}.</div>}
        </div>
      )}
      {cancelMsg && (
        <div className="rounded-lg p-3 text-sm" data-testid="pos-cancel-msg" style={cancelMsg.ok ? { background: "#F1F7F2", border: "1px solid #CFE3D4", color: "#152238" } : { background: "#FBEDE9", border: "1px solid #E9C4BA", color: "#8A2F1F" }}>{cancelMsg.text}</div>
      )}
      {batches.length > 0 && (
        <div className="bg-white rounded-lg p-4 sm:p-5" style={{ border: "1px solid #E4DFD1" }} data-testid="pos-batches">
          <div className="text-sm font-semibold mb-2" style={{ color: "#152238" }}>Imports effectués</div>
          <div className="space-y-2">
            {batches.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "#152238" }}>
                <span>{b.date || "—"}</span><span>{b.list.length} ticket(s)</span><span className="tabular">{fmt(b.total)}</span>
                {confirmCancel === b.id ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span style={{ color: "#B3402F" }}>Annuler ces {b.list.length} ticket(s) ? Des écritures de contrepassation seront créées ; rien n'est supprimé.</span>
                    <button onClick={() => cancelBatch(b)} data-testid="pos-cancel-yes" className="px-2 py-1 rounded" style={{ background: "#B3402F", color: "#fff" }}>Oui, annuler</button>
                    <button onClick={() => setConfirmCancel(null)} className="px-2 py-1 rounded" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>Non</button>
                  </span>
                ) : (
                  <button onClick={() => { setCancelMsg(null); setConfirmCancel(b.id); }} data-testid="pos-cancel" className="underline" style={{ color: "#B3402F" }}>Annuler cet import</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BzAvoirs({ P }) {
  const { bizdocs, setBizdocs, products, setProducts, purchases, setPurchases, invoices, setInvoices, entries, setEntries, setMovements, settings, role, showToast, logAudit } = P;
  const [invId, setInvId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [back, setBack] = useState({});
  const [purId, setPurId] = useState("");
  const [rAmount, setRAmount] = useState("");
  const [rBack, setRBack] = useState({});
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const creditsFor = (id) => bizdocs.filter((d) => d.type === "creditnote" && d.invoiceId === id).reduce((s, d) => s + d.amount, 0);
  const invList = invoices.filter((i) => !["annulée", "don"].includes(i.status) && i.total > 0 && !i.isOpeningBalance);
  const inv = invList.find((i) => String(i.id) === String(invId));
  const maxCn = inv ? bzR(inv.total - creditsFor(inv.id)) : 0;
  const purList = purchases.filter((p) => p.status !== "annulé");
  const pur = purList.find((p) => String(p.id) === String(purId));
  const maxRet = pur ? bzR(pur.amount - (pur.returnedAmount || 0)) : 0;
  const cns = bizdocs.filter((d) => d.type === "creditnote").sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const rets = bizdocs.filter((d) => d.type === "supplierreturn").sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const patch = (id, p) => setBizdocs((prev) => prev.map((d) => (d.id === id ? { ...d, ...p } : d)));

  const createCN = () => {
    if (!canEdit) { showToast("Droits insuffisants."); return; }
    if (!inv) { showToast("Choisissez la facture concernée."); return; }
    const amt = bzR(amount === "" ? maxCn : Number(amount));
    if (!(amt > 0) || amt > maxCn + 0.005) { showToast(`Le montant de l'avoir doit être compris entre 0 et ${fmt(maxCn)}.`); return; }
    const today = todayStr();
    if (isLocked(today, settings)) { showToast(`Période clôturée jusqu'au ${settings.lockDate}.`); return; }
    const id = uid();
    const number = bzNextNumber(bizdocs, "creditnote");
    const entry = bzCreditNoteEntry({ invoice: inv, entries, amount: amt, date: today, number, id: id + 1 });
    const ap = bzApplyCreditToInvoice(inv, amt, id, today);
    const restock = (inv.lines || []).filter((l) => Number(back[l.productId]) > 0 && products.find((p) => p.id === l.productId && p.type === "marchandise"));
    for (const l of restock) { if (Number(back[l.productId]) > l.qty) { showToast(`Quantité retournée supérieure à la quantité vendue pour ${l.name}.`); return; } }
    const newEntries = [entry];
    const mov = [];
    if (restock.length) {
      let cost = 0;
      for (const l of restock) { const q = Number(back[l.productId]); const p = products.find((x) => x.id === l.productId); cost += q * (Number(p.costPrice) || 0); mov.push({ id: uid(), date: today, createdAt: new Date().toISOString(), productId: l.productId, productName: l.name, type: "entree", qty: q, reason: `Avoir ${number} — retour client` }); }
      if (settings.stockValuationMethod === "actif" && cost > 0) newEntries.push({ id: uid(), creditNoteId: id + 1, date: today, createdAt: new Date().toISOString(), label: `Retour en stock — Avoir ${number}`, lines: [{ account: "370", debit: bzR(cost), credit: 0 }, { account: "6037", debit: 0, credit: bzR(cost) }] });
      setProducts((prev) => prev.map((p) => { const l = restock.find((x) => x.productId === p.id); return l ? { ...p, stock: (Number(p.stock) || 0) + Number(back[p.id]) } : p; }));
      setMovements((prev) => [...prev, ...mov]);
    }
    setEntries((prev) => [...prev, ...newEntries]);
    if (ap.applied > 0) setInvoices((prev) => prev.map((i) => (i.id === inv.id ? ap.invoice : i)));
    const cn = { id, type: "creditnote", number, date: today, createdAt: new Date().toISOString(), invoiceId: inv.id, invoiceNumber: inv.number, client: inv.client, amount: amt, applied: ap.applied, toRefund: bzR(amt - ap.applied), refunded: 0, reason, entryId: id + 1, status: "reçu" };
    setBizdocs((prev) => [...prev, cn]);
    setAmount(""); setBack({}); setReason("");
    showToast(`Avoir ${number} de ${fmt(amt)} créé${ap.applied > 0 ? ` : ${fmt(ap.applied)} déduits de la facture ${inv.number}` : ""}${cn.toRefund > 0 ? ` — ${fmt(cn.toRefund)} à rembourser au client` : ""}.`);
    logAudit("Gestion", "Avoir client", `${number} — ${inv.client} — ${fmt(amt)}`);
  };
  const refundCN = (cn, mode) => {
    if (!canEdit) return;
    const today = todayStr();
    if (isLocked(today, settings)) { showToast(`Période clôturée jusqu'au ${settings.lockDate}.`); return; }
    const left = bzR(cn.toRefund - cn.refunded);
    if (left <= 0) return;
    const e = simpleEntry(today, `Remboursement avoir ${cn.number} — ${cn.client}`, "411", mode === "banque" ? "512" : "530", left);
    e.creditNoteId = cn.entryId;
    setEntries((prev) => [...prev, e]);
    patch(cn.id, { refunded: bzR(cn.refunded + left) });
    showToast(`Remboursement de ${fmt(left)} enregistré.`);
    logAudit("Gestion", "Remboursement avoir", `${cn.number} — ${fmt(left)}`);
  };

  const createReturn = () => {
    if (!canEdit) { showToast("Droits insuffisants."); return; }
    if (!pur) { showToast("Choisissez l'achat concerné."); return; }
    const amt = bzR(rAmount === "" ? maxRet : Number(rAmount));
    if (!(amt > 0) || amt > maxRet + 0.005) { showToast(`Le montant du retour doit être compris entre 0 et ${fmt(maxRet)}.`); return; }
    const today = todayStr();
    if (isLocked(today, settings)) { showToast(`Période clôturée jusqu'au ${settings.lockDate}.`); return; }
    const lns = (pur.lines || []).filter((l) => Number(rBack[l.productId]) > 0);
    for (const l of lns) {
      const p = products.find((x) => x.id === l.productId);
      if (Number(rBack[l.productId]) > l.qty) { showToast("Quantité retournée supérieure à la quantité achetée."); return; }
      if ((Number(p?.stock) || 0) < Number(rBack[l.productId])) { showToast(`Stock insuffisant pour retourner ${p?.name || "ce produit"}.`); return; }
    }
    const id = uid();
    const number = bzNextNumber(bizdocs, "supplierreturn");
    const entry = bzSupplierReturnEntry({ purchase: pur, entries, amount: amt, date: today, number, id: id + 1 });
    const newEntries = [entry];
    if (lns.length) {
      const mv = lns.map((l) => { const p = products.find((x) => x.id === l.productId); return { id: uid(), date: today, createdAt: new Date().toISOString(), productId: l.productId, productName: p?.name || "", type: "sortie", qty: Number(rBack[l.productId]), reason: `Retour fournisseur ${number} (${pur.supplier})` }; });
      setProducts((prev) => prev.map((p) => (rBack[p.id] > 0 && lns.some((l) => l.productId === p.id) ? { ...p, stock: (Number(p.stock) || 0) - Number(rBack[p.id]) } : p)));
      setMovements((prev) => [...prev, ...mv]);
    }
    setEntries((prev) => [...prev, ...newEntries]);
    setPurchases((prev) => prev.map((x) => (x.id === pur.id ? { ...x, returnedAmount: bzR((x.returnedAmount || 0) + amt) } : x)));
    setBizdocs((prev) => [...prev, { id, type: "supplierreturn", number, date: today, createdAt: new Date().toISOString(), purchaseId: pur.id, supplier: pur.supplier, label: pur.label, amount: amt, settled: 0, entryId: id + 1, status: "disponible" }]);
    setRAmount(""); setRBack({});
    showToast(`Retour ${number} de ${fmt(amt)} enregistré : avoir à recevoir de ${pur.supplier}.`);
    logAudit("Gestion", "Retour fournisseur", `${number} — ${pur.supplier} — ${fmt(amt)}`);
  };
  const refundRet = (r, mode) => {
    if (!canEdit) return;
    const left = bzR(r.amount - r.settled);
    const today = todayStr();
    if (left <= 0 || isLocked(today, settings)) { if (left > 0) showToast(`Période clôturée jusqu'au ${settings.lockDate}.`); return; }
    const e = simpleEntry(today, `Remboursement retour ${r.number} — ${r.supplier}`, mode === "banque" ? "512" : "530", "409", left);
    e.supplierReturnId = r.entryId;
    setEntries((prev) => [...prev, e]);
    patch(r.id, { settled: r.amount, status: "remboursé" });
    showToast(`Remboursement fournisseur de ${fmt(left)} enregistré.`);
  };
  const compensateRet = (r) => {
    if (!canEdit) return;
    const left = bzR(r.amount - r.settled);
    const today = todayStr();
    const target = purchases.find((p) => p.status === "à payer" && p.supplier === r.supplier && p.id !== r.purchaseId && bzR(p.amount) <= left + 0.005) || purchases.find((p) => p.status === "à payer" && p.supplier === r.supplier && bzR(p.amount) <= left + 0.005);
    if (!target) { showToast(`Aucun achat « à payer » de ${r.supplier} dont le montant soit couvert par cet avoir (${fmt(left)}). Utilisez le remboursement.`); return; }
    if (isLocked(today, settings)) { showToast(`Période clôturée jusqu'au ${settings.lockDate}.`); return; }
    const e = simpleEntry(today, `Compensation retour ${r.number} sur achat « ${target.label} » (${r.supplier})`, "401", "409", bzR(target.amount));
    e.supplierReturnId = r.entryId;
    setEntries((prev) => [...prev, e]);
    setPurchases((prev) => prev.map((p) => (p.id === target.id ? { ...p, status: "payé", compensatedBy: r.number } : p)));
    const settled = bzR(r.settled + target.amount);
    patch(r.id, { settled, status: settled >= r.amount - 0.005 ? "imputé" : "disponible" });
    showToast(`Achat « ${target.label} » soldé par compensation (${fmt(target.amount)}).`);
  };

  return (
    <div>
      <BzCard title="Nouvel avoir client" id="cn-form">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <BzField label="Facture"><select className={bzInp} style={bzInpS} value={String(invId)} data-bz="cn-invoice" onChange={(e) => { setInvId(e.target.value); setAmount(""); setBack({}); }}><option value="">— Choisir —</option>{invList.map((i) => <option key={i.id} value={String(i.id)}>{i.number} — {i.client} — {fmt(i.total)}</option>)}</select></BzField>
          <BzField label={`Montant de l'avoir (max ${fmt(maxCn)})`}><input type="number" min="0" className={bzInp} style={bzInpS} value={amount} placeholder={inv ? String(maxCn) : ""} data-bz="cn-amount" onChange={(e) => setAmount(e.target.value)} /></BzField>
          <BzField label="Motif"><input className={bzInp} style={bzInpS} value={reason} data-bz="cn-reason" onChange={(e) => setReason(e.target.value)} /></BzField>
        </div>
        {inv && (inv.lines || []).some((l) => products.find((p) => p.id === l.productId && p.type === "marchandise")) && (
          <div className="mt-3"><div className="text-xs mb-1" style={{ color: "#8A8370" }}>Marchandises retournées par le client (remises en stock) :</div>
            {(inv.lines || []).filter((l) => products.find((p) => p.id === l.productId && p.type === "marchandise")).map((l) => (
              <div key={l.productId} className="flex items-center gap-2 mb-1 text-sm"><span className="w-48">{l.name} (vendu : {l.qty})</span><input type="number" min="0" max={l.qty} className="border rounded px-2 py-1 text-sm w-24" style={bzInpS} value={back[l.productId] ?? ""} data-bz="cn-back" data-bz-product={l.productId} onChange={(e) => setBack({ ...back, [l.productId]: e.target.value })} /></div>
            ))}
          </div>
        )}
        <div className="mt-3"><button className="text-sm px-4 py-1.5 rounded" style={bzBtn} data-bz="cn-save" onClick={createCN}>Créer l'avoir</button></div>
      </BzCard>
      <BzCard title="Avoirs clients" id="cn-list">
        {cns.length === 0 ? <BzEmpty>Aucun avoir.</BzEmpty> : (
          <table className="w-full text-sm" style={{ minWidth: 520 }}><thead><tr style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}><th className="py-2 px-2 text-left font-normal">N°</th><th className="py-2 px-2 text-left font-normal">Client / facture</th><th className="py-2 px-2 text-right font-normal">Montant</th><th className="py-2 px-2 text-right font-normal">Déduit</th><th className="py-2 px-2 text-right font-normal">À rembourser</th><th className="py-2 px-2 text-left font-normal">Action</th></tr></thead>
            <tbody>{cns.map((c) => { const left = bzR(c.toRefund - c.refunded); return (
              <tr key={c.id} data-bz="cn-row" data-bz-number={c.number} style={{ borderBottom: "1px solid #F3EFE3" }}><td className="py-1.5 px-2">{c.number}</td><td className="py-1.5 px-2">{c.client} — {c.invoiceNumber}</td><td className="py-1.5 px-2 text-right tabular">{fmt(c.amount)}</td><td className="py-1.5 px-2 text-right tabular">{fmt(c.applied)}</td><td className="py-1.5 px-2 text-right tabular" data-bz="cn-left">{fmt(left)}</td>
                <td className="py-1.5 px-2">{left > 0 ? <span className="flex flex-wrap gap-1.5"><button className="text-xs px-2 py-0.5 rounded" style={bzBtn2} data-bz="cn-refund-cash" onClick={() => refundCN(c, "caisse")}>Rembourser (caisse)</button><button className="text-xs px-2 py-0.5 rounded" style={bzBtn2} data-bz="cn-refund-bank" onClick={() => refundCN(c, "banque")}>Rembourser (banque)</button></span> : <BzStatus s="reçu" />}</td></tr>); })}</tbody></table>
        )}
      </BzCard>
      <BzCard title="Nouveau retour fournisseur" id="ret-form">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BzField label="Achat"><select className={bzInp} style={bzInpS} value={String(purId)} data-bz="ret-purchase" onChange={(e) => { setPurId(e.target.value); setRAmount(""); setRBack({}); }}><option value="">— Choisir —</option>{purList.map((p) => <option key={p.id} value={String(p.id)}>{p.date} — {p.supplier} — {p.label} — {fmt(p.amount)}</option>)}</select></BzField>
          <BzField label={`Montant retourné (max ${fmt(maxRet)})`}><input type="number" min="0" className={bzInp} style={bzInpS} value={rAmount} placeholder={pur ? String(maxRet) : ""} data-bz="ret-amount" onChange={(e) => setRAmount(e.target.value)} /></BzField>
        </div>
        {pur && (pur.lines || []).length > 0 && (
          <div className="mt-3"><div className="text-xs mb-1" style={{ color: "#8A8370" }}>Quantités renvoyées au fournisseur (sorties de stock) :</div>
            {pur.lines.map((l) => { const p = products.find((x) => x.id === l.productId); return (
              <div key={l.productId} className="flex items-center gap-2 mb-1 text-sm"><span className="w-48">{p?.name || "Produit"} (acheté : {l.qty})</span><input type="number" min="0" max={l.qty} className="border rounded px-2 py-1 text-sm w-24" style={bzInpS} value={rBack[l.productId] ?? ""} data-bz="ret-back" data-bz-product={l.productId} onChange={(e) => setRBack({ ...rBack, [l.productId]: e.target.value })} /></div>); })}
          </div>
        )}
        <div className="mt-3"><button className="text-sm px-4 py-1.5 rounded" style={bzBtn} data-bz="ret-save" onClick={createReturn}>Enregistrer le retour</button></div>
      </BzCard>
      <BzCard title="Retours fournisseurs" id="ret-list">
        {rets.length === 0 ? <BzEmpty>Aucun retour.</BzEmpty> : (
          <table className="w-full text-sm" style={{ minWidth: 520 }}><thead><tr style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}><th className="py-2 px-2 text-left font-normal">N°</th><th className="py-2 px-2 text-left font-normal">Fournisseur</th><th className="py-2 px-2 text-right font-normal">Avoir</th><th className="py-2 px-2 text-right font-normal">Restant</th><th className="py-2 px-2 text-left font-normal">Statut / action</th></tr></thead>
            <tbody>{rets.map((r) => { const left = bzR(r.amount - r.settled); return (
              <tr key={r.id} data-bz="ret-row" data-bz-number={r.number} style={{ borderBottom: "1px solid #F3EFE3" }}><td className="py-1.5 px-2">{r.number}</td><td className="py-1.5 px-2">{r.supplier} — {r.label}</td><td className="py-1.5 px-2 text-right tabular">{fmt(r.amount)}</td><td className="py-1.5 px-2 text-right tabular" data-bz="ret-left">{fmt(left)}</td>
                <td className="py-1.5 px-2">{left > 0 ? <span className="flex gap-1.5 flex-wrap"><BzStatus s="disponible" />{(() => { const o = purchases.find((q) => q.id === r.purchaseId); return !o || o.status === "payé"; })() && <><button className="text-xs px-2 py-0.5 rounded" style={bzBtn2} data-bz="ret-refund-cash" onClick={() => refundRet(r, "caisse")}>Remboursé en caisse</button><button className="text-xs px-2 py-0.5 rounded" style={bzBtn2} data-bz="ret-refund-bank" onClick={() => refundRet(r, "banque")}>Remboursé en banque</button></>}<button className="text-xs px-2 py-0.5 rounded" style={bzBtn2} data-bz="ret-compensate" onClick={() => compensateRet(r)}>Compenser sur un achat à payer</button></span> : <BzStatus s={r.status} />}</td></tr>); })}</tbody></table>
        )}
      </BzCard>
    </div>
  );
}

// ---------------------------------------------------------------- Phase 5 : acomptes + notes de frais
function BzAcomptes({ P }) {
  const { bizdocs, setBizdocs, invoices, setInvoices, accounts, setEntries, clients, settings, role, showToast, logAudit } = P;
  const [d, setD] = useState({ client: "", amount: "", mode: "caisse", note: "" });
  const [imp, setImp] = useState({});
  const [x, setX] = useState({ employee: "", label: "", amount: "", account: "" });
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const deposits = bizdocs.filter((q) => q.type === "deposit").sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const expenses = bizdocs.filter((q) => q.type === "expense").sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const chargeAccounts = accounts.filter((a) => a.type === "Charge").sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
  const effAcc = x.account || chargeAccounts[0]?.code || "";
  const patch = (id, p) => setBizdocs((prev) => prev.map((q) => (q.id === id ? { ...q, ...p } : q)));
  const names = [...new Set([...(clients || []).map((c) => c.name), ...invoices.map((i) => i.client)].filter(Boolean))];
  const lockedToday = () => { if (isLocked(todayStr(), settings)) { showToast(`Période clôturée jusqu'au ${settings.lockDate}.`); return true; } return false; };

  const addDeposit = () => {
    if (!canEdit) { showToast("Droits insuffisants."); return; }
    const amt = bzR(Number(d.amount));
    if (!d.client.trim() || !(amt > 0)) { showToast("Indiquez le client et un montant valide."); return; }
    if (lockedToday()) return;
    const id = uid(); const number = bzNextNumber(bizdocs, "deposit"); const today = todayStr();
    const e = simpleEntry(today, `Acompte ${number} — ${d.client.trim()}`, d.mode === "banque" ? "512" : "530", "419", amt);
    e.depositId = id;
    setEntries((prev) => [...prev, e]);
    setBizdocs((prev) => [...prev, { id, type: "deposit", number, date: today, createdAt: new Date().toISOString(), client: d.client.trim(), amount: amt, applied: 0, refunded: 0, mode: d.mode, note: d.note, status: "disponible", entryId: e.id }]);
    setD({ client: "", amount: "", mode: "caisse", note: "" });
    showToast(`Acompte ${number} de ${fmt(amt)} encaissé (compte 419 — avances clients).`);
    logAudit("Gestion", "Acompte client", `${number} — ${d.client.trim()} — ${fmt(amt)}`);
  };
  const openInv = (client) => bzOpenInvoices(invoices).filter((i) => normalizeClientName(i.client) === normalizeClientName(client));
  const apply = (dep) => {
    if (!canEdit) return;
    const invId = imp[dep.id];
    const inv = invoices.find((i) => String(i.id) === String(invId));
    if (!inv) { showToast("Choisissez la facture à régler avec cet acompte."); return; }
    if (lockedToday()) return;
    const amt = bzR(Math.min(bzDepositLeft(dep), bzInvBalance(inv)));
    if (amt <= 0) return;
    const today = todayStr();
    const e = simpleEntry(today, `Imputation acompte ${dep.number} sur ${inv.number} — ${inv.client}`, "419", "411", amt);
    e.depositId = dep.id;
    const pay = { id: uid(), date: today, createdAt: new Date().toISOString(), amount: amt, account: "419", depositId: dep.id };
    const payments = [...(inv.payments || []), pay];
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    setEntries((prev) => [...prev, e]);
    setInvoices((prev) => prev.map((i) => (i.id === inv.id ? { ...i, payments, status: paid >= i.total - 0.005 ? "payée" : "partielle" } : i)));
    const applied = bzR(dep.applied + amt);
    patch(dep.id, { applied, status: bzDepositLeft({ ...dep, applied }) <= 0 ? "imputé" : "disponible" });
    setImp({ ...imp, [dep.id]: "" });
    showToast(`${fmt(amt)} de l'acompte ${dep.number} imputés sur la facture ${inv.number}.`);
    logAudit("Gestion", "Imputation acompte", `${dep.number} → ${inv.number} — ${fmt(amt)}`);
  };
  const refundDep = (dep) => {
    if (!canEdit) return;
    const left = bzDepositLeft(dep);
    if (left <= 0 || lockedToday()) return;
    const e = simpleEntry(todayStr(), `Remboursement acompte ${dep.number} — ${dep.client}`, "419", dep.mode === "banque" ? "512" : "530", left);
    e.depositId = dep.id;
    setEntries((prev) => [...prev, e]);
    patch(dep.id, { refunded: bzR(dep.refunded + left), status: "remboursé" });
    showToast(`Acompte remboursé (${fmt(left)}).`);
  };

  const addExpense = () => {
    if (!canEdit) { showToast("Droits insuffisants."); return; }
    const amt = bzR(Number(x.amount));
    if (!x.employee.trim() || !x.label.trim() || !(amt > 0) || !effAcc) { showToast("Renseignez l'employé, le libellé, le compte de charge et le montant."); return; }
    const id = uid();
    setBizdocs((prev) => [...prev, { id, type: "expense", number: bzNextNumber(prev, "expense"), date: todayStr(), createdAt: new Date().toISOString(), employee: x.employee.trim(), label: x.label.trim(), amount: amt, account: effAcc, status: "soumise" }]);
    setX({ employee: "", label: "", amount: "", account: "" });
    showToast("Note de frais enregistrée (soumise).");
  };
  const approveExp = (n) => {
    if (!canEdit || lockedToday()) return;
    const e = simpleEntry(todayStr(), `Note de frais ${n.number} — ${n.employee} — ${n.label}`, n.account, "421", n.amount);
    e.expenseId = n.id;
    setEntries((prev) => [...prev, e]);
    patch(n.id, { status: "approuvée", entryId: e.id });
    showToast(`Note de frais ${n.number} approuvée : charge comptabilisée, ${fmt(n.amount)} dus à ${n.employee}.`);
    logAudit("Gestion", "Note de frais approuvée", `${n.number} — ${fmt(n.amount)}`);
  };
  const payExp = (n, mode) => {
    if (!canEdit || lockedToday()) return;
    const e = simpleEntry(todayStr(), `Remboursement note de frais ${n.number} — ${n.employee}`, "421", mode === "banque" ? "512" : "530", n.amount);
    e.expenseId = n.id;
    setEntries((prev) => [...prev, e]);
    patch(n.id, { status: "remboursée" });
    showToast(`Note de frais ${n.number} remboursée.`);
  };

  return (
    <div>
      <BzCard title="Nouvel acompte / avance client" id="dep-form">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <BzField label="Client"><input className={bzInp} style={bzInpS} list="bz-clients2" value={d.client} data-bz="dep-client" onChange={(e) => setD({ ...d, client: e.target.value })} /><datalist id="bz-clients2">{names.map((n) => <option key={n} value={n} />)}</datalist></BzField>
          <BzField label="Montant"><input type="number" min="0" className={bzInp} style={bzInpS} value={d.amount} data-bz="dep-amount" onChange={(e) => setD({ ...d, amount: e.target.value })} /></BzField>
          <BzField label="Encaissé en"><select className={bzInp} style={bzInpS} value={d.mode} data-bz="dep-mode" onChange={(e) => setD({ ...d, mode: e.target.value })}><option value="caisse">Caisse</option><option value="banque">Banque</option></select></BzField>
          <BzField label="Note"><input className={bzInp} style={bzInpS} value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} /></BzField>
        </div>
        <div className="mt-3"><button className="text-sm px-4 py-1.5 rounded" style={bzBtn} data-bz="dep-save" onClick={addDeposit}>Encaisser l'acompte</button></div>
      </BzCard>
      <BzCard title="Acomptes clients" id="dep-list">
        {deposits.length === 0 ? <BzEmpty>Aucun acompte.</BzEmpty> : (
          <table className="w-full text-sm" style={{ minWidth: 520 }}><thead><tr style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}><th className="py-2 px-2 text-left font-normal">N°</th><th className="py-2 px-2 text-left font-normal">Client</th><th className="py-2 px-2 text-right font-normal">Montant</th><th className="py-2 px-2 text-right font-normal">Restant</th><th className="py-2 px-2 text-left font-normal">Actions</th></tr></thead>
            <tbody>{deposits.map((q) => { const left = bzDepositLeft(q); const open = openInv(q.client); return (
              <tr key={q.id} data-bz="dep-row" data-bz-number={q.number} style={{ borderBottom: "1px solid #F3EFE3" }}><td className="py-1.5 px-2">{q.number}</td><td className="py-1.5 px-2">{q.client}</td><td className="py-1.5 px-2 text-right tabular">{fmt(q.amount)}</td><td className="py-1.5 px-2 text-right tabular" data-bz="dep-left">{fmt(left)}</td>
                <td className="py-1.5 px-2">{left > 0 ? <span className="flex gap-1.5 flex-wrap items-center">
                  <select className="border rounded px-1 py-0.5 text-xs" style={bzInpS} value={String(imp[q.id] ?? "")} data-bz="dep-invoice" onChange={(e) => setImp({ ...imp, [q.id]: e.target.value })}><option value="">— facture à régler —</option>{open.map((i) => <option key={i.id} value={String(i.id)}>{i.number} — reste {fmt(bzInvBalance(i))}</option>)}</select>
                  <button className="text-xs px-2 py-0.5 rounded" style={bzBtn} data-bz="dep-apply" onClick={() => apply(q)}>Imputer</button>
                  <button className="text-xs px-2 py-0.5 rounded" style={bzBtn2} data-bz="dep-refund" onClick={() => refundDep(q)}>Rembourser le reste</button></span> : <BzStatus s={q.status} />}</td></tr>); })}</tbody></table>
        )}
      </BzCard>
      <BzCard title="Nouvelle note de frais" id="exp-form">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <BzField label="Employé"><input className={bzInp} style={bzInpS} value={x.employee} data-bz="exp-employee" onChange={(e) => setX({ ...x, employee: e.target.value })} /></BzField>
          <BzField label="Libellé"><input className={bzInp} style={bzInpS} value={x.label} data-bz="exp-label" onChange={(e) => setX({ ...x, label: e.target.value })} /></BzField>
          <BzField label="Compte de charge"><select className={bzInp} style={bzInpS} value={effAcc} data-bz="exp-account" onChange={(e) => setX({ ...x, account: e.target.value })}>{chargeAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}</select></BzField>
          <BzField label="Montant"><input type="number" min="0" className={bzInp} style={bzInpS} value={x.amount} data-bz="exp-amount" onChange={(e) => setX({ ...x, amount: e.target.value })} /></BzField>
        </div>
        <div className="mt-3"><button className="text-sm px-4 py-1.5 rounded" style={bzBtn} data-bz="exp-save" onClick={addExpense}>Soumettre</button></div>
      </BzCard>
      <BzCard title="Notes de frais" id="exp-list">
        {expenses.length === 0 ? <BzEmpty>Aucune note de frais.</BzEmpty> : (
          <table className="w-full text-sm" style={{ minWidth: 520 }}><thead><tr style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}><th className="py-2 px-2 text-left font-normal">N°</th><th className="py-2 px-2 text-left font-normal">Employé</th><th className="py-2 px-2 text-left font-normal">Libellé</th><th className="py-2 px-2 text-right font-normal">Montant</th><th className="py-2 px-2 text-left font-normal">Statut</th><th className="py-2 px-2 text-left font-normal">Actions</th></tr></thead>
            <tbody>{expenses.map((n) => (
              <tr key={n.id} data-bz="exp-row" data-bz-number={n.number} style={{ borderBottom: "1px solid #F3EFE3" }}><td className="py-1.5 px-2">{n.number}</td><td className="py-1.5 px-2">{n.employee}</td><td className="py-1.5 px-2">{n.label}</td><td className="py-1.5 px-2 text-right tabular">{fmt(n.amount)}</td><td className="py-1.5 px-2"><BzStatus s={n.status} /></td>
                <td className="py-1.5 px-2"><span className="flex flex-wrap gap-1.5">
                  {n.status === "soumise" && <><button className="text-xs px-2 py-0.5 rounded" style={bzBtn} data-bz="exp-approve" onClick={() => approveExp(n)}>Approuver</button><button className="text-xs px-2 py-0.5 rounded" style={bzBtn2} data-bz="exp-reject" onClick={() => patch(n.id, { status: "rejetée" })}>Rejeter</button></>}
                  {n.status === "approuvée" && <><button className="text-xs px-2 py-0.5 rounded" style={bzBtn2} data-bz="exp-pay-cash" onClick={() => payExp(n, "caisse")}>Rembourser (caisse)</button><button className="text-xs px-2 py-0.5 rounded" style={bzBtn2} data-bz="exp-pay-bank" onClick={() => payExp(n, "banque")}>Rembourser (banque)</button></>}
                </span></td></tr>))}</tbody></table>
        )}
      </BzCard>
    </div>
  );
}

// ---------------------------------------------------------------- Phase 6 : inventaire physique
function BzInventaire({ P }) {
  const { bizdocs, setBizdocs, products, setProducts, setMovements, setEntries, settings, role, showToast, logAudit } = P;
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const sessions = bizdocs.filter((d) => d.type === "inventory").sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const patch = (id, p) => setBizdocs((prev) => prev.map((d) => (d.id === id ? { ...d, ...p } : d)));
  const start = () => {
    if (!canEdit) { showToast("Droits insuffisants."); return; }
    if (sessions.some((s) => s.status === "en cours")) { showToast("Un inventaire est déjà en cours : validez-le ou annulez-le d'abord."); return; }
    const ms = products.filter((p) => p.type === "marchandise");
    if (ms.length === 0) { showToast("Aucune marchandise au catalogue."); return; }
    setBizdocs((prev) => [...prev, { id: uid(), type: "inventory", number: bzNextNumber(prev, "inventory"), date: todayStr(), createdAt: new Date().toISOString(), status: "en cours", lines: ms.map((p) => ({ productId: p.id, name: p.name, theoretical: Number(p.stock) || 0, counted: "" })) }]);
    showToast("Inventaire démarré : saisissez les quantités comptées.");
  };
  const setCount = (s, pid, v) => patch(s.id, { lines: s.lines.map((l) => (l.productId === pid ? { ...l, counted: v } : l)) });
  const validate = (s) => {
    if (!canEdit) return;
    const today = todayStr();
    if (isLocked(today, settings)) { showToast(`Période clôturée jusqu'au ${settings.lockDate}.`); return; }
    const diffs = bzInventoryDiff(s, products).filter((x) => x.variance !== 0);
    const countedAny = s.lines.some((l) => l.counted !== "");
    if (!countedAny) { showToast("Saisissez au moins une quantité comptée."); return; }
    const mv = diffs.map((x) => ({ id: uid(), date: today, createdAt: new Date().toISOString(), productId: x.productId, productName: x.name, type: x.variance > 0 ? "entree" : "sortie", qty: Math.abs(x.variance), reason: `Inventaire ${s.number} — écart de comptage` }));
    if (diffs.length) {
      setProducts((prev) => prev.map((p) => { const x = diffs.find((d) => d.productId === p.id); return x ? { ...p, stock: x.counted } : p; }));
      setMovements((prev) => [...prev, ...mv]);
      const es = bzInventoryEntries({ diffs, settings, date: today, number: s.number, sessionId: s.id, mkId: uid });
      if (es.length) setEntries((prev) => [...prev, ...es]);
    }
    patch(s.id, { status: "validé", validatedAt: today, result: diffs.map((x) => ({ productId: x.productId, name: x.name, before: x.current, after: x.counted, variance: x.variance })) });
    showToast(diffs.length ? `Inventaire validé : ${diffs.length} écart(s) régularisé(s).` : "Inventaire validé : aucun écart.");
    logAudit("Gestion", "Inventaire validé", `${s.number} — ${diffs.length} écart(s)`);
  };
  const cancel = (s) => { if (!canEdit) return; setBizdocs((prev) => prev.filter((d) => d.id !== s.id)); showToast("Inventaire annulé."); };
  return (
    <div>
      <div className="mb-4"><button className="text-sm px-4 py-1.5 rounded" style={bzBtn} data-bz="inv-start" onClick={start}>Démarrer un inventaire physique</button></div>
      {sessions.length === 0 && <BzEmpty>Aucun inventaire.</BzEmpty>}
      {sessions.map((s) => {
        const diffs = bzInventoryDiff(s, products);
        return (
          <BzCard key={s.id} id={`inv-${s.number}`} title={`${s.number} — ${s.date}`} right={<BzStatus s={s.status} />}>
            <table className="w-full text-sm" style={{ minWidth: 520 }}><thead><tr style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}><th className="py-2 px-2 text-left font-normal">Produit</th><th className="py-2 px-2 text-right font-normal">Stock théorique</th><th className="py-2 px-2 text-right font-normal">Compté</th><th className="py-2 px-2 text-right font-normal">Écart</th></tr></thead>
              <tbody>{s.lines.map((l) => {
                const dd = diffs.find((x) => x.productId === l.productId);
                const res = (s.result || []).find((x) => x.productId === l.productId);
                return (
                  <tr key={l.productId} data-bz="inv-line" data-bz-product={l.name} style={{ borderBottom: "1px solid #F3EFE3" }}>
                    <td className="py-1.5 px-2">{l.name}</td>
                    <td className="py-1.5 px-2 text-right tabular">{s.status === "validé" ? (res ? res.before : l.theoretical) : (products.find((p) => p.id === l.productId)?.stock ?? l.theoretical)}</td>
                    <td className="py-1.5 px-2 text-right">{s.status === "en cours" ? <input type="number" min="0" className="border rounded px-2 py-1 text-sm w-24 text-right" style={bzInpS} value={l.counted} data-bz="inv-count" onChange={(e) => setCount(s, l.productId, e.target.value)} /> : <span className="tabular">{l.counted === "" ? "—" : l.counted}</span>}</td>
                    <td className="py-1.5 px-2 text-right tabular" data-bz="inv-var" style={{ color: ((s.status === "validé" ? res?.variance : dd?.variance) || 0) < 0 ? "#A6432F" : "#2F7A4A" }}>{s.status === "validé" ? (res ? res.variance : 0) : (dd ? dd.variance : "—")}</td>
                  </tr>);
              })}</tbody></table>
            {s.status === "en cours" && <div className="mt-3 flex gap-2"><button className="text-sm px-4 py-1.5 rounded" style={bzBtn} data-bz="inv-validate" onClick={() => validate(s)}>Valider et régulariser les écarts</button><button className="text-sm px-3 py-1.5 rounded" style={bzBtn2} data-bz="inv-cancel" onClick={() => cancel(s)}>Annuler</button></div>}
          </BzCard>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Phase 7 : récurrence + projets/temps
function BzRecurrent({ P }) {
  const { bizdocs, setBizdocs, products, setProducts, clients, invoices, setInvoices, setEntries, setMovements, settings, role, showToast, logAudit, getInvoiceNumber } = P;
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const taxActive = settings.taxSystem !== "aucune";
  const taxLabel = (TAX_SYSTEMS[settings.taxSystem] || {}).label || "Taxe";
  const [r, setR] = useState({ client: "", freq: "mensuelle", nextDate: todayStr() });
  const [lines, setLines] = useState([{ key: 1, productId: "", name: "", qty: 1, price: "" }]);
  const [pj, setPj] = useState({ name: "", client: "", rate: "" });
  const [tm, setTm] = useState({ projectId: "", date: todayStr(), hours: "", note: "" });
  const tpls = bizdocs.filter((d) => d.type === "recurring");
  const projects = bizdocs.filter((d) => d.type === "project");
  const times = bizdocs.filter((d) => d.type === "time").sort((a, b) => b.date.localeCompare(a.date));
  const patch = (id, p) => setBizdocs((prev) => prev.map((d) => (d.id === id ? { ...d, ...p } : d)));
  const names = [...new Set([...(clients || []).map((c) => c.name), ...invoices.map((i) => i.client)].filter(Boolean))];

  const addTpl = () => {
    if (!canEdit) { showToast("Droits insuffisants."); return; }
    const calc = bzCalcLines(lines, products, taxActive);
    if (!r.client.trim() || calc.lines.length === 0 || calc.total <= 0) { showToast("Indiquez le client et au moins une ligne valide."); return; }
    setBizdocs((prev) => [...prev, { id: uid(), type: "recurring", number: bzNextNumber(prev, "recurring"), createdAt: new Date().toISOString(), client: r.client.trim(), freq: r.freq, nextDate: r.nextDate, active: true, lines: calc.lines, total: calc.total, totalHT: calc.totalHT, totalTax: calc.totalTax, count: 0 }]);
    setR({ client: "", freq: "mensuelle", nextDate: todayStr() }); setLines([{ key: Date.now(), productId: "", name: "", qty: 1, price: "" }]);
    showToast("Abonnement créé.");
  };

  const makeInvoice = async (client, date, calc, source, sink) => {
    const number = await getInvoiceNumber();
    const id = uid();
    const prodList = sink.products;
    const full = { ...calc, lines: calc.lines.map((l) => { const p = prodList.find((x) => x.id === l.productId); return { ...l, account: p?.account || "706", type: p?.type || "service" }; }) };
    const res = bzBuildCreditInvoice({ id, number, date, client, calc: full, products: prodList, settings, taxLabel, source });
    sink.invoices.push(res.invoice); sink.entries.push(res.saleEntry); if (res.cogsEntry) sink.entries.push(res.cogsEntry);
    res.stockLines.forEach((s) => { const p = sink.products.find((x) => x.id === s.productId); if (p) p.stock = (Number(p.stock) || 0) - s.qty; });
    sink.movements.push(...res.movements);
    return number;
  };
  const flush = (sink, extraPatch) => {
    if (sink.invoices.length) setInvoices((prev) => [...prev, ...sink.invoices]);
    if (sink.entries.length) setEntries((prev) => [...prev, ...sink.entries]);
    if (sink.movements.length) { setMovements((prev) => [...prev, ...sink.movements]); setProducts((prev) => prev.map((p) => sink.products.find((x) => x.id === p.id) || p)); }
    if (extraPatch) extraPatch();
  };

  const generate = async () => {
    if (!canEdit) { showToast("Droits insuffisants."); return; }
    const today = todayStr();
    if (isLocked(today, settings)) { showToast(`Période clôturée jusqu'au ${settings.lockDate}.`); return; }
    const due = tpls.filter((t) => t.active !== false && t.nextDate <= today);
    if (due.length === 0) { showToast("Aucun abonnement à facturer aujourd'hui."); return; }
    const sink = { invoices: [], entries: [], movements: [], products: products.map((p) => ({ ...p })) };
    const patches = {};
    const skipped = [];
    let made = 0;
    try {
      for (const t of due) {
        const { dates, next } = bzRecurringDates(t, today);
        let done = 0;
        for (const dt of dates) {
          const stockLines = t.lines.filter((l) => l.type === "marchandise").map((l) => ({ productId: l.productId, qty: l.qty, name: l.name }));
          if (bzStockShortage(stockLines, sink.products).length) { skipped.push(t.client); break; }
          const calc = { lines: t.lines, totalHT: t.totalHT, totalTax: t.totalTax, total: t.total };
          await makeInvoice(t.client, dt <= today ? dt : today, calc, { type: "recurring", id: t.id, number: t.number }, sink);
          done++; made++;
        }
        if (done > 0) {
          let nd = t.nextDate; for (let i = 0; i < done; i++) nd = bzNextRecurring(nd, t.freq);
          patches[t.id] = { nextDate: nd, count: (t.count || 0) + done, lastGenerated: today };
        }
      }
    } catch (e) { showToast("Numérotation impossible (connexion instable) : génération interrompue, rien n'a été enregistré."); return; }
    if (made === 0) { showToast(skipped.length ? `Stock insuffisant pour : ${[...new Set(skipped)].join(", ")}.` : "Rien à générer."); return; }
    flush(sink, () => setBizdocs((prev) => prev.map((d) => (patches[d.id] ? { ...d, ...patches[d.id] } : d))));
    showToast(`${made} facture(s) récurrente(s) générée(s)${skipped.length ? ` — ignoré (stock) : ${[...new Set(skipped)].join(", ")}` : ""}.`);
    logAudit("Gestion", "Facturation récurrente", `${made} facture(s)`);
  };

  const addProject = () => {
    if (!canEdit) { showToast("Droits insuffisants."); return; }
    if (!pj.name.trim() || !pj.client.trim() || !(Number(pj.rate) > 0)) { showToast("Nom du projet, client et taux horaire sont obligatoires."); return; }
    setBizdocs((prev) => [...prev, { id: uid(), type: "project", number: bzNextNumber(prev, "project"), createdAt: new Date().toISOString(), name: pj.name.trim(), client: pj.client.trim(), rate: Number(pj.rate), status: "en cours" }]);
    setPj({ name: "", client: "", rate: "" }); showToast("Projet créé.");
  };
  const addTime = () => {
    if (!canEdit) { showToast("Droits insuffisants."); return; }
    const p = projects.find((x) => String(x.id) === String(tm.projectId));
    if (!p || !(Number(tm.hours) > 0)) { showToast("Choisissez un projet et saisissez des heures valides."); return; }
    if (isFutureDate(tm.date)) { showToast("Date future impossible."); return; }
    setBizdocs((prev) => [...prev, { id: uid(), type: "time", createdAt: new Date().toISOString(), projectId: p.id, date: tm.date, hours: Number(tm.hours), note: tm.note, billed: false }]);
    setTm({ ...tm, hours: "", note: "" }); showToast("Temps enregistré.");
  };
  const billProject = async (p) => {
    if (!canEdit) return;
    const today = todayStr();
    if (isLocked(today, settings)) { showToast(`Période clôturée jusqu'au ${settings.lockDate}.`); return; }
    const open = times.filter((t) => t.projectId === p.id && !t.billed);
    const hours = bzR(open.reduce((s, t) => s + t.hours, 0));
    if (hours <= 0) { showToast("Aucune heure à facturer sur ce projet."); return; }
    const calc = bzCalcLines([{ productId: "", name: `Projet ${p.name} — ${hours} h`, qty: 1, price: bzR(hours * p.rate), tva: 0, account: "706" }], products, taxActive);
    const sink = { invoices: [], entries: [], movements: [], products: products.map((x) => ({ ...x })) };
    let number;
    try { number = await makeInvoice(p.client, today, calc, { type: "project", id: p.id, number: p.number }, sink); } catch (e) { showToast("Impossible d'obtenir un numéro de facture (connexion instable)."); return; }
    flush(sink, () => setBizdocs((prev) => prev.map((d) => (open.some((t) => t.id === d.id) ? { ...d, billed: true, invoiceNumber: number } : d))));
    showToast(`Facture ${number} créée : ${hours} h × ${fmt(p.rate)} = ${fmt(calc.total)}.`);
    logAudit("Gestion", "Facturation du temps", `${p.name} — ${number}`);
  };

  return (
    <div>
      <BzCard title="Nouvel abonnement (facturation récurrente)" id="rec-form">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <BzField label="Client"><input className={bzInp} style={bzInpS} list="bz-clients3" value={r.client} data-bz="rec-client" onChange={(e) => setR({ ...r, client: e.target.value })} /><datalist id="bz-clients3">{names.map((n) => <option key={n} value={n} />)}</datalist></BzField>
          <BzField label="Fréquence"><select className={bzInp} style={bzInpS} value={r.freq} data-bz="rec-freq" onChange={(e) => setR({ ...r, freq: e.target.value })}><option value="hebdomadaire">Hebdomadaire</option><option value="mensuelle">Mensuelle</option><option value="trimestrielle">Trimestrielle</option><option value="annuelle">Annuelle</option></select></BzField>
          <BzField label="Prochaine facture le"><input type="date" className={bzInp} style={bzInpS} value={r.nextDate} data-bz="rec-next" onChange={(e) => setR({ ...r, nextDate: e.target.value })} /></BzField>
        </div>
        <BzLinesEditor lines={lines} setLines={setLines} products={products} mode="sale" />
        <div className="mt-3"><button className="text-sm px-4 py-1.5 rounded" style={bzBtn} data-bz="rec-save" onClick={addTpl}>Créer l'abonnement</button></div>
      </BzCard>
      <BzCard title="Abonnements" id="rec-list" right={<button className="text-xs px-3 py-1 rounded" style={bzBtn} data-bz="rec-generate" onClick={generate}>Générer les factures échues</button>}>
        {tpls.length === 0 ? <BzEmpty>Aucun abonnement.</BzEmpty> : (
          <table className="w-full text-sm" style={{ minWidth: 520 }}><thead><tr style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}><th className="py-2 px-2 text-left font-normal">N°</th><th className="py-2 px-2 text-left font-normal">Client</th><th className="py-2 px-2 text-left font-normal">Fréquence</th><th className="py-2 px-2 text-right font-normal">Montant</th><th className="py-2 px-2 text-left font-normal">Prochaine</th><th className="py-2 px-2 text-right font-normal">Émises</th><th className="py-2 px-2 text-left font-normal"></th></tr></thead>
            <tbody>{tpls.map((t) => (
              <tr key={t.id} data-bz="rec-row" data-bz-number={t.number} style={{ borderBottom: "1px solid #F3EFE3" }}><td className="py-1.5 px-2">{t.number}</td><td className="py-1.5 px-2">{t.client}</td><td className="py-1.5 px-2">{t.freq}</td><td className="py-1.5 px-2 text-right tabular">{fmt(t.total)}</td><td className="py-1.5 px-2" data-bz="rec-nextdate">{t.nextDate}</td><td className="py-1.5 px-2 text-right" data-bz="rec-count">{t.count || 0}</td><td className="py-1.5 px-2"><button className="text-xs px-2 py-0.5 rounded" style={bzBtn2} data-bz="rec-toggle" onClick={() => patch(t.id, { active: t.active === false })}>{t.active === false ? "Réactiver" : "Suspendre"}</button></td></tr>))}</tbody></table>
        )}
      </BzCard>
      <BzCard title="Projets et suivi du temps" id="prj">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <BzField label="Projet"><input className={bzInp} style={bzInpS} value={pj.name} data-bz="pj-name" onChange={(e) => setPj({ ...pj, name: e.target.value })} /></BzField>
          <BzField label="Client"><input className={bzInp} style={bzInpS} list="bz-clients3" value={pj.client} data-bz="pj-client" onChange={(e) => setPj({ ...pj, client: e.target.value })} /></BzField>
          <BzField label="Taux horaire"><input type="number" min="0" className={bzInp} style={bzInpS} value={pj.rate} data-bz="pj-rate" onChange={(e) => setPj({ ...pj, rate: e.target.value })} /></BzField>
          <div className="flex items-end"><button className="text-sm px-4 py-1.5 rounded" style={bzBtn} data-bz="pj-save" onClick={addProject}>Créer le projet</button></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-3">
          <BzField label="Projet"><select className={bzInp} style={bzInpS} value={String(tm.projectId)} data-bz="tm-project" onChange={(e) => setTm({ ...tm, projectId: e.target.value })}><option value="">— Choisir —</option>{projects.map((p) => <option key={p.id} value={String(p.id)}>{p.name} ({p.client})</option>)}</select></BzField>
          <BzField label="Date"><input type="date" className={bzInp} style={bzInpS} value={tm.date} data-bz="tm-date" onChange={(e) => setTm({ ...tm, date: e.target.value })} /></BzField>
          <BzField label="Heures"><input type="number" min="0" step="0.25" className={bzInp} style={bzInpS} value={tm.hours} data-bz="tm-hours" onChange={(e) => setTm({ ...tm, hours: e.target.value })} /></BzField>
          <BzField label="Note"><input className={bzInp} style={bzInpS} value={tm.note} onChange={(e) => setTm({ ...tm, note: e.target.value })} /></BzField>
          <div className="flex items-end"><button className="text-sm px-4 py-1.5 rounded" style={bzBtn2} data-bz="tm-save" onClick={addTime}>Ajouter le temps</button></div>
        </div>
        {projects.length === 0 ? <BzEmpty>Aucun projet.</BzEmpty> : (
          <table className="w-full text-sm" style={{ minWidth: 520 }}><thead><tr style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}><th className="py-2 px-2 text-left font-normal">Projet</th><th className="py-2 px-2 text-left font-normal">Client</th><th className="py-2 px-2 text-right font-normal">Taux</th><th className="py-2 px-2 text-right font-normal">H. non facturées</th><th className="py-2 px-2 text-right font-normal">À facturer</th><th></th></tr></thead>
            <tbody>{projects.map((p) => { const h = bzR(times.filter((t) => t.projectId === p.id && !t.billed).reduce((s, t) => s + t.hours, 0)); return (
              <tr key={p.id} data-bz="pj-row" data-bz-name={p.name} style={{ borderBottom: "1px solid #F3EFE3" }}><td className="py-1.5 px-2">{p.name}</td><td className="py-1.5 px-2">{p.client}</td><td className="py-1.5 px-2 text-right tabular">{fmt(p.rate)}</td><td className="py-1.5 px-2 text-right" data-bz="pj-hours">{h}</td><td className="py-1.5 px-2 text-right tabular" data-bz="pj-amount">{fmt(h * p.rate)}</td><td className="py-1.5 px-2"><button className="text-xs px-2 py-0.5 rounded" style={bzBtn} data-bz="pj-bill" onClick={() => billProject(p)}>Facturer le temps</button></td></tr>); })}</tbody></table>
        )}
      </BzCard>
    </div>
  );
}

// ---------------------------------------------------------------- Phase 8 : budget + prévisionnel
function BzBudget({ P }) {
  const { bizdocs, setBizdocs, accounts, entries, invoices, purchases, balances, settings, role, showToast } = P;
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const today = todayStr();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [nb, setNb] = useState({ account: "", amount: "" });
  const [horizon, setHorizon] = useState(60);
  const bAccounts = accounts.filter((a) => a.type === "Charge" || a.type === "Produit").sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
  const effAcc = nb.account || bAccounts[0]?.code || "";
  const budgets = bizdocs.filter((d) => d.type === "budget" && String(d.year) === String(year));
  const actuals = bzBudgetActuals(entries, accounts, year);
  const addBudget = () => {
    if (!canEdit) { showToast("Droits insuffisants."); return; }
    const amt = Number(nb.amount);
    if (!effAcc || !(amt > 0)) { showToast("Choisissez un compte et un montant annuel valide."); return; }
    setBizdocs((prev) => [...prev.filter((d) => !(d.type === "budget" && String(d.year) === String(year) && d.account === effAcc)), { id: uid(), type: "budget", year: Number(year), account: effAcc, amount: amt, createdAt: new Date().toISOString() }]);
    setNb({ account: "", amount: "" }); showToast("Ligne de budget enregistrée.");
  };
  const cash = bzR(["530", "512"].reduce((s, c) => s + (balances?.[c] || 0), 0));
  const recurring = [];
  for (const t of bizdocs.filter((d) => d.type === "recurring" && d.active !== false)) {
    let d = t.nextDate; let n = 0;
    while (d && n < 60 && bzDiffDays(d, today) <= horizon) { if (d >= today) recurring.push({ date: bzAddDays(d, Number(settings.paymentTermsDays ?? 30)), amount: t.total }); d = bzNextRecurring(d, t.freq); n++; }
  }
  const fc = bzForecast({ cash, receivables: bzReceivables(invoices, settings), payables: bzPayables(purchases, settings), recurring, today, days: horizon });
  return (
    <div>
      <BzCard title="Budget annuel" id="budget" right={<select className="border rounded px-2 py-1 text-sm" style={bzInpS} value={year} data-bz="bud-year" onChange={(e) => setYear(e.target.value)}>{[-1, 0, 1].map((k) => { const y = String(new Date().getFullYear() + k); return <option key={y} value={y}>{y}</option>; })}</select>}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <BzField label="Compte (charge ou produit)"><select className={bzInp} style={bzInpS} value={effAcc} data-bz="bud-account" onChange={(e) => setNb({ ...nb, account: e.target.value })}>{bAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}</select></BzField>
          <BzField label="Budget annuel"><input type="number" min="0" className={bzInp} style={bzInpS} value={nb.amount} data-bz="bud-amount" onChange={(e) => setNb({ ...nb, amount: e.target.value })} /></BzField>
          <div className="flex items-end"><button className="text-sm px-4 py-1.5 rounded" style={bzBtn} data-bz="bud-save" onClick={addBudget}>Enregistrer</button></div>
        </div>
        {budgets.length === 0 ? <BzEmpty>Aucun budget pour {year}.</BzEmpty> : (
          <table className="w-full text-sm" style={{ minWidth: 520 }}><thead><tr style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}><th className="py-2 px-2 text-left font-normal">Compte</th><th className="py-2 px-2 text-right font-normal">Budget</th><th className="py-2 px-2 text-right font-normal">Réalisé</th><th className="py-2 px-2 text-right font-normal">Écart</th><th className="py-2 px-2 text-right font-normal">% réalisé</th><th></th></tr></thead>
            <tbody>{budgets.map((b) => { const a = actuals[b.account] || { actual: 0, name: b.account, type: "Charge" }; const gap = bzR(a.type === "Produit" ? a.actual - b.amount : b.amount - a.actual); const pct = b.amount ? Math.round((a.actual / b.amount) * 100) : 0; const bad = a.type === "Charge" ? pct > 100 : false; return (
              <tr key={b.id} data-bz="bud-row" data-bz-account={b.account} style={{ borderBottom: "1px solid #F3EFE3" }}><td className="py-1.5 px-2">{b.account} — {a.name}</td><td className="py-1.5 px-2 text-right tabular">{fmt(b.amount)}</td><td className="py-1.5 px-2 text-right tabular" data-bz="bud-actual">{fmt(a.actual)}</td><td className="py-1.5 px-2 text-right tabular" data-bz="bud-gap" style={{ color: gap < 0 ? "#A6432F" : "#2F7A4A" }}>{fmt(gap)}</td><td className="py-1.5 px-2 text-right" data-bz="bud-pct" style={{ color: bad ? "#A6432F" : "#152238" }}>{pct}%</td><td className="py-1.5 px-2"><button className="text-xs" style={{ color: "#A6432F" }} onClick={() => setBizdocs((prev) => prev.filter((d) => d.id !== b.id))}>✕</button></td></tr>); })}</tbody></table>
        )}
      </BzCard>
      <BzCard title="Trésorerie prévisionnelle" id="forecast" right={<select className="border rounded px-2 py-1 text-sm" style={bzInpS} value={horizon} data-bz="fc-horizon" onChange={(e) => setHorizon(Number(e.target.value))}><option value={30}>30 jours</option><option value={60}>60 jours</option><option value={90}>90 jours</option></select>}>
        <div className="text-sm mb-3">Trésorerie actuelle (caisse + banque) : <b data-bz="fc-start">{fmt(fc.start)}</b> — Solde prévu à {horizon} jours : <b data-bz="fc-end" style={{ color: fc.end < 0 ? "#A6432F" : "#2F7A4A" }}>{fmt(fc.end)}</b></div>
        {fc.minBalance < 0 && <div className="rounded p-2 mb-3 text-sm" style={{ background: "#FDECEA", color: "#A6432F" }} data-bz="fc-warning">⚠ La trésorerie devient négative (minimum prévu : {fmt(fc.minBalance)}). Anticipez un encaissement ou décalez un paiement.</div>}
        <table className="w-full text-sm" style={{ minWidth: 520 }}><thead><tr style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}><th className="py-2 px-2 text-left font-normal">Semaine</th><th className="py-2 px-2 text-right font-normal">Encaissements</th><th className="py-2 px-2 text-right font-normal">Décaissements</th><th className="py-2 px-2 text-right font-normal">Solde prévu</th></tr></thead>
          <tbody>{fc.rows.map((w, i) => <tr key={w.from} data-bz="fc-row" style={{ borderBottom: "1px solid #F3EFE3" }}><td className="py-1.5 px-2">{i === 0 ? "Retards + " : ""}{w.from} → {w.to}</td><td className="py-1.5 px-2 text-right tabular" data-bz="fc-in">{fmt(w.inflow)}</td><td className="py-1.5 px-2 text-right tabular" data-bz="fc-out">{fmt(w.outflow)}</td><td className="py-1.5 px-2 text-right tabular" data-bz="fc-bal" style={{ color: w.balance < 0 ? "#A6432F" : "#152238" }}>{fmt(w.balance)}</td></tr>)}</tbody></table>
        <div className="text-xs mt-2" style={{ color: "#A39C87" }}>Basé sur les échéances des factures clients, des achats à payer et des abonnements actifs (décalés du délai de règlement client).</div>
      </BzCard>
    </div>
  );
}

// ---------------------------------------------------------------- Phase 9 : pilotage
function BzPilotage({ P }) {
  const { bizdocs, setBizdocs, invoices, purchases, clients, entries, setEntries, settings, companyName, role, showToast, logAudit, companyId } = P;
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const [text, setText] = useState("");
  const [manual, setManual] = useState([]);
  const [ml, setMl] = useState({ date: todayStr(), label: "", sign: "in", amount: "" });
  const [res, setRes] = useState(null);
  const [sel, setSel] = useState({});
  const [att, setAtt] = useState({ ref: "" });
  const [busy, setBusy] = useState(false);
  const [fileMsg, setFileMsg] = useState(null);
  const [shareAll, setShareAll] = useState(false);
  const atts = bizdocs.filter((d) => d.type === "attachment");
  const recoverPending = async (manualClick) => {
    if (!canEdit || !companyId) return;
    const found = await bzPendingRecover(atts, companyId);
    if (found.length > 0) {
      setBizdocs((prev) => [...prev, ...found.filter((r) => !prev.some((x) => x.id === r.id || (x.path && x.path === r.path)))]);
      showToast(found.length === 1 ? "1 pièce envoyée depuis le téléphone a été ajoutée." : `${found.length} pièces envoyées depuis le téléphone ont été ajoutées.`);
    } else if (manualClick) showToast("Aucune nouvelle pièce envoyée depuis le téléphone.");
  };
  useEffect(() => { recoverPending(false); }, [companyId]);

  const addManual = () => {
    const amt = bzR(Number(ml.amount));
    if (!ml.date || !(amt > 0)) { showToast("Indiquez la date et un montant supérieur à zéro."); return; }
    setManual((prev) => [...prev, { date: ml.date, label: ml.label || (ml.sign === "in" ? "Dépôt" : "Retrait"), amount: ml.sign === "in" ? amt : -amt }]);
    setMl({ ...ml, label: "", amount: "" });
  };
  const analyse = () => {
    const lines = [...bzParseCSV(text), ...manual];
    if (lines.length === 0) { showToast("Aucune ligne reconnue. Collez un relevé CSV avec une ligne d'en-têtes (Date, Description, Montant — ou Débit/Crédit), ou ajoutez les lignes à la main ci-dessous."); return; }
    const m = bzMatchBank(lines, entries);
    setRes(m); const s = {}; m.forEach((l, i) => { if (l.match) s[i] = true; }); setSel(s);
  };
  const storeFile = async (f, ref, refLabel) => {
    if (!canEdit) { showToast("Droits insuffisants."); return false; }
    setBusy(true);
    try {
      const rec = await bzStoreAttachment({ atts, file: f, companyId, ref, refLabel });
      pjStep("enregistrement dans les données");
      setBizdocs((prev) => [...prev, rec]);
      pjStep("enregistrement terminé");
      return true;
    } catch (e) { setFileMsg({ ok: false, text: (e && e.message) || "Fichier impossible à enregistrer." }); showToast((e && e.message) || "Fichier impossible à enregistrer."); return false; }
    finally { setBusy(false); }
  };
  const clearInput = (el) => { try { setTimeout(() => { el.value = ""; }, 0); } catch (e) { /* ignoré */ } };
  const onBankFile = async (e) => {
    const el = e.target; const f = el.files && el.files[0];
    if (!f) return;
    const nm = (f.name || "").toLowerCase();
    setFileMsg({ ok: true, text: `Fichier reçu : ${f.name} (${Math.max(1, Math.round((f.size || 0) / 1024))} Ko) — lecture…` });
    try {
      const isExcel = /\.(xlsx|xls)$/.test(nm);
      const isText = /\.(csv|txt|tsv)$/.test(nm) || /^text\//.test(f.type) || f.type === "application/vnd.ms-excel" && !isExcel;
      if (isExcel || isText) {
        let sheetInfo = "";
        let t;
        if (isExcel) { const xr = await bzExcelRead(f); t = xr.csv; if (xr.sheets > 1) sheetInfo = ` (feuille « ${xr.sheet} »)`; }
        else t = await bzReadText(f);
        setText(t);
        const det = bzParseCSVDetailed(t);
        const n = det.lines.length;
        const extra = `${sheetInfo}${det.skipped ? ` ${det.skipped} ligne(s) ignorée(s) (date ou montant illisible).` : ""}${det.dateOrder === "mdy" && n > 0 ? " Dates lues au format mois/jour." : ""}`;
        const diag = !det.cols ? " Aucune ligne d'en-têtes (Date, Description, Montant ou Débit/Crédit) trouvée." : !det.cols.amount && !det.cols.debit && !det.cols.credit ? ` En-têtes lus : ${det.cols.header}. Aucune colonne Montant, Débit ou Crédit reconnue.` : ` Colonnes reconnues : date « ${det.cols.date} », ${det.cols.amount ? `montant « ${det.cols.amount} »` : `débit « ${det.cols.debit || "—"} » / crédit « ${det.cols.credit || "—"} »`}.`;
        const m = n > 0 ? `${n} ligne(s) reconnue(s) dans « ${f.name} »${extra}. Cliquez sur « Analyser et rapprocher ».` : `« ${f.name} » chargé, mais aucune ligne date + montant reconnue.${diag}${extra} Vérifiez le contenu dans la zone de texte ou ajoutez les lignes à la main.`;
        setFileMsg({ ok: n > 0, text: m }); showToast(m);
        return;
      }
      const ok = await storeFile(f, "bank", "Relevé / fiche de dépôt");
      const m = ok ? `« ${f.name} » est gardé en pièce jointe. Ce format (PDF, photo) ne peut pas être lu automatiquement : saisissez sa ou ses lignes (date, montant) dans « Ajouter une ligne à la main ».` : "Ce format ne peut pas être lu automatiquement et n'a pas pu être gardé : saisissez les lignes à la main.";
      setFileMsg({ ok, text: m }); showToast(m);
    } catch (err) {
      const m = (err && err.message) || "Lecture du fichier impossible.";
      setFileMsg({ ok: false, text: m }); showToast(m);
    } finally { clearInput(el); }
  };
  const validate = () => {
    if (!canEdit) { showToast("Droits insuffisants."); return; }
    const ids = new Set((res || []).filter((l, i) => sel[i] && l.match).map((l) => l.match.id));
    if (ids.size === 0) { showToast("Aucun rapprochement sélectionné."); return; }
    setEntries((prev) => prev.map((e) => (ids.has(e.id) ? { ...e, reconciled: true } : e)));
    setRes(null); setText(""); setManual([]);
    showToast(`${ids.size} écriture(s) rapprochée(s) avec le relevé bancaire.`);
    logAudit("Gestion", "Rapprochement par import de relevé", `${ids.size} écriture(s)`);
  };

  const invList = (shareAll ? invoices.filter((i) => i.status !== "annulée") : bzOpenInvoices(invoices)).slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 25);
  const contactOf = (name) => (clients || []).find((c) => normalizeClientName(c.name) === normalizeClientName(name)) || {};
  const refs = [{ k: "", label: "Non rattaché" }, ...invoices.slice(-30).map((i) => ({ k: "i" + i.id, label: `Facture ${i.number} — ${i.client}` })), ...purchases.slice(-30).map((p) => ({ k: "p" + p.id, label: `Achat ${p.date} — ${p.supplier} — ${p.label}` }))];
  const onAttFile = async (e) => {
    const el = e.target; const f = el.files && el.files[0];
    pjStep(f ? "fichier choisi : " + f.name + " (" + Math.round((f.size || 0) / 1024) + " Ko)" : "sélecteur fermé sans fichier");
    if (!f) return;
    try { sessionStorage.setItem("pj-busy", "1"); sessionStorage.setItem("pj-pick", String(Date.now())); } catch (x) { /* ignoré */ }
    try {
      setFileMsg({ ok: true, text: `Fichier reçu : ${f.name} (${Math.max(1, Math.round((f.size || 0) / 1024))} Ko) — enregistrement…` });
      const r = refs.find((x) => x.k === att.ref);
      const ok = await storeFile(f, att.ref, r ? r.label : "Non rattaché");
      if (ok) { setFileMsg({ ok: true, text: `Pièce jointe « ${f.name} » enregistrée.` }); showToast("Pièce jointe enregistrée."); }
    } finally { clearInput(el); try { sessionStorage.removeItem("pj-busy"); sessionStorage.removeItem("pj-pick"); } catch (x) { /* ignoré */ } }
  };
  const copyText = async (msg) => { try { await navigator.clipboard.writeText(msg); showToast("Facture copiée : collez-la dans votre message."); } catch (e) { showToast("Copie impossible sur cet appareil : utilisez WhatsApp ou E-mail."); } };
  return (
    <div>
      <BzCard title="Import d'un relevé bancaire" id="bank">
        <div className="text-xs mb-2" style={{ color: "#8A8370" }}>Fichier CSV/TXT exporté de votre banque (colonnes Date, Description, puis Montant ou Débit/Crédit), ou texte collé ci-dessous. Une photo ou un PDF (fiche de dépôt) n'est pas lisible automatiquement : il est gardé en pièce jointe et vous saisissez sa ligne à la main.</div>
        <input type="file" onClick={pjPickMark} onChange={onBankFile} className="text-sm mb-1 max-w-full" data-bz="bank-file" />
        {fileMsg && <div className="text-xs mb-2 p-2 rounded" data-bz="file-msg" style={{ background: fileMsg.ok ? "#EAF3EE" : "#F7E9E3", color: fileMsg.ok ? "#0F6B5C" : "#A6432F" }}>{fileMsg.text}</div>}
        <textarea className={bzInp} style={bzInpS} rows={4} placeholder="…ou collez le contenu du relevé ici" value={text} data-bz="bank-text" onChange={(e) => setText(e.target.value)} />
        <div className="mt-3 text-xs font-semibold" style={{ color: "#152238" }}>Ajouter une ligne à la main (ex. une fiche de dépôt)</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-1 items-end">
          <input type="date" className={bzInp} style={bzInpS} value={ml.date} data-bz="man-date" onChange={(e) => setMl({ ...ml, date: e.target.value })} />
          <input className={bzInp} style={bzInpS} placeholder="Libellé" value={ml.label} data-bz="man-label" onChange={(e) => setMl({ ...ml, label: e.target.value })} />
          <select className={bzInp} style={bzInpS} value={ml.sign} data-bz="man-sign" onChange={(e) => setMl({ ...ml, sign: e.target.value })}><option value="in">Entrée (dépôt)</option><option value="out">Sortie (retrait)</option></select>
          <input type="number" min="0" className={bzInp} style={bzInpS} placeholder="Montant" value={ml.amount} data-bz="man-amount" onChange={(e) => setMl({ ...ml, amount: e.target.value })} />
          <button className="text-sm px-3 py-1.5 rounded" style={bzBtn2} data-bz="man-add" onClick={addManual}>Ajouter</button>
        </div>
        {manual.length > 0 && <div className="mt-2 text-xs" data-bz="man-list" style={{ color: "#5A5444" }}>{manual.map((m, i) => <div key={i}>{m.date} — {m.label} — {fmt(m.amount)} <button className="ml-1" style={{ color: "#A6432F" }} onClick={() => setManual(manual.filter((_, k) => k !== i))}>✕</button></div>)}</div>}
        <div className="mt-3"><button className="text-sm px-4 py-1.5 rounded" style={bzBtn} data-bz="bank-analyse" onClick={analyse}>Analyser et rapprocher</button></div>
        {res && (
          <div className="mt-3">
            <table className="w-full text-sm" style={{ minWidth: 520 }} data-bz="bank-result"><thead><tr style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}><th className="py-2 px-2 w-8"></th><th className="py-2 px-2 text-left font-normal">Date</th><th className="py-2 px-2 text-left font-normal">Relevé</th><th className="py-2 px-2 text-right font-normal">Montant</th><th className="py-2 px-2 text-left font-normal">Écriture trouvée</th></tr></thead>
              <tbody>{res.map((l, i) => <tr key={i} data-bz="bank-row" data-bz-matched={l.match ? "1" : "0"} style={{ borderBottom: "1px solid #F3EFE3" }}><td className="py-1.5 px-2">{l.match && <input type="checkbox" checked={!!sel[i]} data-bz="bank-check" onChange={(e) => setSel({ ...sel, [i]: e.target.checked })} />}</td><td className="py-1.5 px-2">{l.date}</td><td className="py-1.5 px-2">{l.label}</td><td className="py-1.5 px-2 text-right tabular">{fmt(l.amount)}</td><td className="py-1.5 px-2" style={{ color: l.match ? "#2F7A4A" : "#A6432F" }}>{l.match ? `${l.match.date} — ${l.match.label}` : "Aucune écriture correspondante"}</td></tr>)}</tbody></table>
            <div className="mt-2"><button className="text-sm px-4 py-1.5 rounded" style={bzBtn} data-bz="bank-validate" onClick={validate}>Valider les rapprochements cochés</button></div>
          </div>
        )}
      </BzCard>
      <BzCard title="Envoyer une facture au client" id="share" right={<label className="text-xs flex items-center gap-1.5" style={{ color: "#8A8370" }}><input type="checkbox" checked={shareAll} data-bz="share-all" onChange={(e) => setShareAll(e.target.checked)} /> Toutes les factures</label>}>
        {invList.length === 0 ? <BzEmpty>Aucune facture impayée à envoyer.</BzEmpty> : (
          <table className="w-full text-sm" style={{ minWidth: 520 }}><tbody>{invList.map((i) => {
            const c = contactOf(i.client);
            const wa = bzInvoiceText({ invoice: i, settings, markup: true, fmtMoney: fmt });
            const mail = bzInvoiceText({ invoice: i, settings, markup: false, fmtMoney: fmt });
            const phone = String(c.phone || "").replace(/\D/g, "");
            return (
              <tr key={i.id} data-bz="share-row" style={{ borderBottom: "1px solid #F3EFE3" }}><td className="py-1.5 px-2">{i.number}</td><td className="py-1.5 px-2">{i.client}</td><td className="py-1.5 px-2 text-right tabular">{fmt(bzInvBalance(i))}</td>
                <td className="py-1.5 px-2"><span className="flex flex-wrap gap-1.5">
                  <a className="text-xs px-2 py-0.5 rounded" style={bzBtn2} data-bz="share-wa" target="_blank" rel="noopener noreferrer" href={`https://wa.me/${phone}?text=${encodeURIComponent(wa)}`}>WhatsApp</a>
                  <a className="text-xs px-2 py-0.5 rounded" style={bzBtn2} data-bz="share-mail" href={`mailto:${c.email || ""}?subject=${encodeURIComponent(`Facture ${i.number || ""} — ${settings.companyName || ""}`)}&body=${encodeURIComponent(mail)}`}>E-mail</a>
                  <button className="text-xs px-2 py-0.5 rounded" style={bzBtn2} data-bz="share-copy" onClick={() => copyText(mail)}>Copier</button>
                  <button className="text-xs px-2 py-0.5 rounded" style={bzBtn2} data-bz="share-pdf" onClick={() => { if (typeof downloadInvoicePDF === "function") downloadInvoicePDF(i, settings); }}>PDF</button>
                </span></td></tr>); })}</tbody></table>
        )}
        <div className="text-xs mt-2" style={{ color: "#A39C87" }}>Le message reprend la facture (lignes, taxe, total, reste à payer, échéance). Si la fiche du client contient un téléphone ou un e-mail, il est utilisé. Pour joindre la facture en PDF, touchez PDF puis joignez le fichier à votre message.</div>
      </BzCard>
      <BzCard title="Pièces jointes (justificatifs)" id="attach">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <BzField label="Rattacher à (facultatif)"><select className={bzInp} style={bzInpS} value={att.ref} data-bz="att-ref" onChange={(e) => setAtt({ ref: e.target.value })}>{refs.map((r) => <option key={r.k} value={r.k}>{r.label}</option>)}</select></BzField>
          <BzField label="Fichier (photo ou PDF jusqu'à 5 Mo — les photos sont réduites automatiquement)"><input type="file" accept="application/pdf,image/*" className="text-sm max-w-full" data-bz="att-file" onClick={pjPickMark} onChange={onAttFile} disabled={busy} /></BzField>
        </div>
        {fileMsg && <div className="text-xs mb-2 p-2 rounded" data-bz="att-msg" style={{ background: fileMsg.ok ? "#EAF3EE" : "#F7E9E3", color: fileMsg.ok ? "#0F6B5C" : "#A6432F" }}>{fileMsg.text}</div>}
        {canEdit && <div className="text-xs mb-2" style={{ color: "#4A4636" }}>Le sélecteur de fichiers ferme l'application sur votre téléphone ? <a href="ajouter-piece.html" data-bz="light-upload" className="underline" style={{ color: "#0F6B5C" }}>Envoyer une pièce avec la page légère</a> · <button type="button" onClick={() => recoverPending(true)} data-bz="light-refresh" className="underline" style={{ color: "#0F6B5C" }}>Actualiser</button></div>}
        {pjTraceText() && <pre className="text-xs mb-2 p-2 rounded" data-bz="att-trace" style={{ background: "#F3EFE3", color: "#4A4636", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{"Journal du dernier envoi :\n" + pjTraceText()}</pre>}
        {atts.length === 0 ? <BzEmpty>Aucune pièce jointe.</BzEmpty> : <table className="w-full text-sm" style={{ minWidth: 520 }}><tbody>{atts.map((a) => <tr key={a.id} data-bz="att-row" style={{ borderBottom: "1px solid #F3EFE3" }}><td className="py-1.5 px-2">{a.refLabel}</td><td className="py-1.5 px-2"><BzAttLink a={a} showToast={showToast} /> <span className="text-xs" style={{ color: "#A39C87" }}>({Math.round(a.size / 1024)} Ko)</span></td><td className="py-1.5 px-2"><button className="text-xs" style={{ color: "#A6432F" }} onClick={async () => { if (!canEdit) return; if (!(await bzRemoveStored(a))) { showToast("La pièce n'a pas pu être supprimée. Réessayez."); return; } setBizdocs((prev) => prev.filter((d) => d.id !== a.id)); }}>Supprimer</button></td></tr>)}</tbody></table>}
      </BzCard>
    </div>
  );
}


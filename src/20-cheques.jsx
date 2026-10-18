// ── Chèques ───────────────────────────────────────────────────────────────
// Registre des chèques. Chèque REÇU d'un client : débit 5112 (Chèques à encaisser) /
// crédit 411 à la réception, puis débit 512 / crédit 5112 au dépôt en banque.
// Chèque ÉMIS à un fournisseur : débit 401 / crédit 512 à l'émission (solde comptable
// prudent), suivi "en circulation" jusqu'à l'encaissement constaté sur le relevé.
const makeChequeRecord = ({ kind, number, bank, party, amount, date, entryIds, links, purchaseId }) => ({
  id: uid(), kind, number: String(number || "").trim(), bank: String(bank || "").trim(), party: party || "",
  amount: Number(amount) || 0, date, createdAt: new Date().toISOString(),
  status: kind === "recu" ? "a_deposer" : "en_circulation",
  entryIds: entryIds || [], links: links || [], purchaseId: purchaseId || null,
});

function ChequeDialog({ title, partyLabel, party, amountDefault, askAmount, onConfirm, onClose }) {
  const [number, setNumber] = useState("");
  const [bank, setBank] = useState("");
  const [amount, setAmount] = useState(askAmount ? String(amountDefault || "") : "");
  const submit = () => {
    if (!number.trim()) { window.alert("Le numéro du chèque est obligatoire."); return; }
    if (askAmount && !(Number(amount) > 0)) { window.alert("Renseignez un montant valide."); return; }
    onConfirm({ number: number.trim(), bank: bank.trim() }, askAmount ? Number(amount) : null);
  };
  return (
    <div onClick={(e) => e.stopPropagation()} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(21,34,56,0.45)" }}>
      <div className="bg-white rounded-lg p-5 w-full" style={{ maxWidth: 380, border: "1px solid #E4DFD1" }}>
        <div className="display text-lg mb-1" style={{ color: "#152238" }}>{title}</div>
        <div className="text-xs mb-4" style={{ color: "#7A7460" }}>{partyLabel} : <b>{party}</b></div>
        <label className="text-xs" style={{ color: "#8A8370" }}>Numéro du chèque *</label>
        <input autoFocus value={number} onChange={(e) => setNumber(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm mt-1 mb-3" style={{ borderColor: "#DDD6C4" }} />
        <label className="text-xs" style={{ color: "#8A8370" }}>Banque du chèque</label>
        <input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Ex : Unibank, BNC, Sogebank…" className="w-full border rounded px-2 py-1.5 text-sm mt-1 mb-3" style={{ borderColor: "#DDD6C4" }} />
        {askAmount && (<>
          <label className="text-xs" style={{ color: "#8A8370" }}>Montant du chèque</label>
          <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm mt-1 mb-3 tabular" style={{ borderColor: "#DDD6C4" }} />
        </>)}
        <div className="flex gap-2 justify-end mt-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded text-sm" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>Annuler</button>
          <button onClick={submit} className="px-3 py-1.5 rounded text-sm text-white" style={{ background: "#152238" }}>Enregistrer le chèque</button>
        </div>
      </div>
    </div>
  );
}

function ChequesPanel({ cheques, setCheques, entries, setEntries, invoices, setInvoices, purchases, setPurchases, balances, settings, role, showToast, logAudit }) {
  const lastRef = React.useRef(0);
  const [kindFilter, setKindFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending"); // pending | all | <status>
  // Formulaire "Nouveau chèque" (saisie directe depuis ce registre)
  const [nf, setNf] = useState(null); // { kind, client, invoiceId, purchaseId, number, bank, amount }
  const list = cheques || [];
  const STATUS_LABEL = { a_deposer: "à déposer", depose: "déposé", encaisse: "encaissé", rejete: "rejeté", en_circulation: "en circulation", annule: "annulé" };
  const STATUS_STYLE = {
    a_deposer: ["#FBF1DC", "#9A7B1E"], depose: ["#E8EEF8", "#2B4C8C"], encaisse: ["#E6F1EE", "#0F6B5C"],
    rejete: ["#F7E9E3", "#A6432F"], en_circulation: ["#FBF1DC", "#9A7B1E"], annule: ["#EEE9DA", "#7A7460"],
  };
  const sum = (arr) => arr.reduce((t, c) => t + (Number(c.amount) || 0), 0);
  const toDeposit = list.filter((c) => c.kind === "recu" && c.status === "a_deposer");
  const deposited = list.filter((c) => c.kind === "recu" && c.status === "depose");
  const inCirculation = list.filter((c) => c.kind === "emis" && c.status === "en_circulation");
  const soldeBanque = balances["512"] || 0;
  const expectedStatement = soldeBanque + sum(inCirculation) - sum(deposited);

  const shown = list.filter((c) => {
    if (kindFilter && c.kind !== kindFilter) return false;
    if (statusFilter === "pending") return c.status === "a_deposer" || c.status === "depose" || c.status === "en_circulation";
    if (statusFilter === "all") return true;
    return c.status === statusFilter;
  });

  const guard = () => {
    if (Date.now() - lastRef.current < 800) return false;
    lastRef.current = Date.now();
    return true;
  };
  const checkOpen = () => {
    const today = todayStr();
    if (isLocked(today, settings)) { showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Impossible d'enregistrer cette opération aujourd'hui.`); return null; }
    return today;
  };
  const patch = (id, changes) => setCheques((prev) => prev.map((c) => (c.id === id ? { ...c, ...changes } : c)));
  const label = (c) => `chèque n° ${c.number}${c.bank ? ` (${c.bank})` : ""} — ${c.party}`;

  const deposit = (c) => {
    if (!guard()) return;
    const today = checkOpen(); if (!today) return;
    const entry = simpleEntry(today, `Dépôt ${label(c)}`, "512", "5112", c.amount);
    entry.reconciled = false;
    setEntries((prev) => [...prev, entry]);
    patch(c.id, { status: "depose", depositEntryId: entry.id, depositDate: today });
    logAudit("Caisse et banque", "Dépôt de chèque", `${label(c)} — ${fmt(c.amount)}`);
    showToast("Chèque déposé en banque.");
  };

  const markCashed = (c) => {
    if (!guard()) return;
    const eid = c.kind === "recu" ? c.depositEntryId : (c.entryIds || [])[0];
    if (eid) setEntries((prev) => prev.map((e) => (e.id === eid ? { ...e, reconciled: true } : e)));
    patch(c.id, { status: "encaisse", cashedDate: todayStr() });
    logAudit("Caisse et banque", "Chèque encaissé (pointé)", `${label(c)} — ${fmt(c.amount)}`);
    showToast("Chèque marqué comme encaissé et pointé sur le relevé.");
  };

  const rejectReceived = (c) => {
    if (role !== "Administrateur") { showToast("Seul un administrateur peut déclarer un chèque rejeté."); return; }
    if (!guard()) return;
    const today = checkOpen(); if (!today) return;
    const blocked = (c.links || []).find((l) => { const inv = invoices.find((i) => i.id === l.invoiceId); return !inv || inv.status === "annulée" || inv.status === "perte" || inv.status === "don"; });
    if (blocked) { showToast("Une facture liée à ce chèque a été annulée ou passée en perte : rejet impossible automatiquement. Contrepassez l'opération manuellement."); return; }
    if (!window.confirm(`Déclarer le ${label(c)} comme REJETÉ ? La créance du client (${fmt(c.amount)}) sera rétablie et les factures concernées redeviendront impayées.`)) return;
    const fromAccount = c.status === "depose" ? "512" : "5112";
    const entry = simpleEntry(today, `Chèque rejeté — ${label(c)}`, "411", fromAccount, c.amount);
    entry.reconciled = false;
    setEntries((prev) => [...prev, entry]);
    setInvoices((prev) => prev.map((inv) => {
      const lnk = (c.links || []).find((l) => l.invoiceId === inv.id);
      if (!lnk) return inv;
      const payments = (inv.payments || []).filter((p) => p.id !== lnk.paymentId);
      const paid = payments.reduce((t, p) => t + p.amount, 0);
      return { ...inv, payments, status: paid > 0 ? "partielle" : "impayée" };
    }));
    patch(c.id, { status: "rejete", rejectEntryId: entry.id, rejectDate: today });
    logAudit("Caisse et banque", "Chèque reçu rejeté", `${label(c)} — ${fmt(c.amount)}`);
    showToast("Chèque rejeté : la créance du client est rétablie. Pensez à saisir d'éventuels frais bancaires dans Caisse et banque.");
  };

  const cancelIssued = (c) => {
    if (role !== "Administrateur") { showToast("Seul un administrateur peut annuler un chèque émis."); return; }
    if (!guard()) return;
    const today = checkOpen(); if (!today) return;
    const purchase = purchases.find((p) => p.id === c.purchaseId);
    if (!purchase) { showToast("L'achat lié à ce chèque est introuvable : annulation automatique impossible."); return; }
    const purchaseCancelled = purchase.status === "annulé";
    if (!window.confirm(purchaseCancelled
      ? `Annuler le ${label(c)} ? L'achat lié est déjà annulé : seule la sortie de banque (${fmt(c.amount)}) sera contrepassée (le montant revient en banque), l'achat reste annulé.`
      : `Annuler le ${label(c)} ? Le montant (${fmt(c.amount)}) revient en banque et la dette fournisseur est rétablie (l'achat repasse « à payer »).`)) return;
    const entry = simpleEntry(today, `Annulation ${label(c)}`, "512", "401", c.amount);
    entry.reconciled = false;
    setEntries((prev) => [...prev, entry]);
    if (!purchaseCancelled) setPurchases((prev) => prev.map((p) => (p.id === c.purchaseId ? { ...p, status: "à payer" } : p)));
    patch(c.id, { status: "annule", cancelEntryId: entry.id, cancelDate: today });
    logAudit("Caisse et banque", "Chèque émis annulé", `${label(c)} — ${fmt(c.amount)}`);
    showToast(purchaseCancelled ? "Chèque annulé : le montant est revenu en banque (l'achat reste annulé)." : "Chèque annulé : la dette fournisseur est rétablie.");
  };

  // Factures impayées / partielles, regroupées par client
  const unpaidInvoices = (invoices || []).filter((i) => i.status !== "payée" && i.status !== "don" && i.status !== "annulée" && i.status !== "perte" && balanceDue(i) > 0);
  const unpaidClients = [...new Set(unpaidInvoices.map((i) => i.client))].sort();
  const payablePurchases = (purchases || []).filter((p) => p.status === "à payer");

  const openNewCheque = (kind) => setNf({ kind, client: "", invoiceId: "", purchaseId: "", number: "", bank: "", amount: "" });

  const submitNewCheque = () => {
    if (!nf) return;
    if (!guard()) return;
    const number = nf.number.trim();
    if (!number) { showToast("Le numéro du chèque est obligatoire."); return; }
    const today = checkOpen(); if (!today) return;
    if (nf.kind === "recu") {
      const inv = unpaidInvoices.find((i) => String(i.id) === String(nf.invoiceId));
      if (!inv) { showToast("Choisissez le client puis la facture à régler."); return; }
      const amountNum = Number(nf.amount) > 0 ? Number(nf.amount) : balanceDue(inv);
      let remaining = amountNum;
      const clientKey = normalizeClientName(inv.client);
      const others = unpaidInvoices
        .filter((i) => i.id !== inv.id && normalizeClientName(i.client) === clientKey)
        .sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.createdAt || "").localeCompare(b.createdAt || ""));
      const newEntries = [], updates = [];
      for (const target of [inv, ...others]) {
        if (remaining <= 0) break;
        const due = balanceDue(target);
        const amt = Math.min(remaining, due);
        remaining -= amt;
        const payId = uid();
        const ent = simpleEntry(today, `${amt < due ? "Encaissement partiel" : "Encaissement"} ${target.number || "(sans numéro)"} — ${target.client} (chèque n° ${number})`, "5112", "411", amt);
        newEntries.push(ent);
        updates.push({ id: target.id, payId, entryId: ent.id, amt, payment: { id: payId, date: today, createdAt: new Date().toISOString(), amount: amt, account: "5112", cheque: number }, status: amt >= due ? "payée" : "partielle" });
      }
      const applied = updates.reduce((t, u) => t + u.amt, 0);
      setEntries((prev) => [...prev, ...newEntries]);
      setInvoices((prev) => prev.map((i) => { const u = updates.find((x) => x.id === i.id); return u ? { ...i, payments: [...(i.payments || []), u.payment], status: u.status } : i; }));
      setCheques((prev) => [...prev, makeChequeRecord({ kind: "recu", number, bank: nf.bank, party: inv.client, amount: applied, date: today, entryIds: newEntries.map((e) => e.id), links: updates.map((u) => ({ invoiceId: u.id, paymentId: u.payId, amt: u.amt, entryId: u.entryId })) })]);
      logAudit("Chèques", "Chèque reçu enregistré", `${inv.client} — n° ${number}`);
      showToast(remaining > 0 ? `Chèque enregistré (${fmt(applied)} appliqués). Excédent de ${fmt(remaining)} non affecté : ${inv.client} n'a plus de facture en cours.` : "Chèque reçu enregistré : à déposer en banque.");
    } else {
      const pur = payablePurchases.find((p) => String(p.id) === String(nf.purchaseId));
      if (!pur) { showToast("Choisissez l'achat à payer."); return; }
      const ent = simpleEntry(today, `Paiement — ${pur.label} (${pur.supplier}) — chèque n° ${number}`, "401", "512", pur.amount);
      ent.reconciled = false;
      setEntries((prev) => [...prev, ent]);
      setPurchases((prev) => prev.map((x) => (x.id === pur.id ? { ...x, status: "payé" } : x)));
      setCheques((prev) => [...prev, makeChequeRecord({ kind: "emis", number, bank: nf.bank, party: pur.supplier, amount: pur.amount, date: today, entryIds: [ent.id], purchaseId: pur.id })]);
      logAudit("Chèques", "Chèque émis enregistré", `${pur.supplier} — n° ${number}`);
      showToast(`Achat payé par chèque n° ${number} : chèque en circulation.`);
    }
    setNf(null);
  };

  const btn = { background: "#152238", color: "#EFE9DD" };
  const inputCls = "w-full border rounded px-2 py-1.5 text-sm mt-1";
  const inputSt = { borderColor: "#DDD6C4" };
  const selInv = nf && nf.kind === "recu" ? unpaidInvoices.find((i) => String(i.id) === String(nf.invoiceId)) : null;
  const selPur = nf && nf.kind === "emis" ? payablePurchases.find((p) => String(p.id) === String(nf.purchaseId)) : null;
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={() => openNewCheque("recu")} className="flex items-center gap-1 px-3 py-2 rounded text-sm text-white" style={{ background: "#152238" }}><Plus size={14} /> Nouveau chèque reçu (client)</button>
        <button onClick={() => openNewCheque("emis")} className="flex items-center gap-1 px-3 py-2 rounded text-sm text-white" style={{ background: "#152238" }}><Plus size={14} /> Nouveau chèque émis (fournisseur)</button>
      </div>

      {nf && (
        <div className="bg-white rounded-lg p-5 mb-6" style={{ border: "1px solid #C9A24B" }}>
          <div className="display text-lg mb-3" style={{ color: "#152238" }}>{nf.kind === "recu" ? "Nouveau chèque reçu d'un client" : "Nouveau chèque émis à un fournisseur"}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {nf.kind === "recu" ? (<>
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Client</label>
                <select value={nf.client} onChange={(e) => setNf({ ...nf, client: e.target.value, invoiceId: "", amount: "" })} className={inputCls} style={inputSt}>
                  <option value="">— Choisir un client —</option>
                  {unpaidClients.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Facture à régler</label>
                <select value={nf.invoiceId} onChange={(e) => { const inv = unpaidInvoices.find((i) => String(i.id) === e.target.value); setNf({ ...nf, invoiceId: e.target.value, amount: inv ? String(balanceDue(inv)) : "" }); }} className={inputCls} style={inputSt} disabled={!nf.client}>
                  <option value="">— Choisir une facture —</option>
                  {unpaidInvoices.filter((i) => i.client === nf.client).map((i) => <option key={i.id} value={i.id}>{i.number || "(sans n°)"} · {i.date} · reste {fmt(balanceDue(i))}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Montant du chèque{selInv ? ` (reste dû : ${fmt(balanceDue(selInv))} — le surplus se répartit sur les autres factures du client)` : ""}</label>
                <input type="number" min="0" value={nf.amount} onChange={(e) => setNf({ ...nf, amount: e.target.value })} className={inputCls + " tabular"} style={inputSt} />
              </div>
            </>) : (
              <div className="md:col-span-2">
                <label className="text-xs" style={{ color: "#8A8370" }}>Achat à payer</label>
                <select value={nf.purchaseId} onChange={(e) => setNf({ ...nf, purchaseId: e.target.value })} className={inputCls} style={inputSt}>
                  <option value="">— Choisir un achat —</option>
                  {payablePurchases.map((p) => <option key={p.id} value={p.id}>{p.supplier} · {p.label} · {fmt(p.amount)}</option>)}
                </select>
                {payablePurchases.length === 0 && <div className="text-xs mt-1" style={{ color: "#A39C87" }}>Aucun achat « à payer ». Enregistrez d'abord l'achat à crédit dans Achat et fournisseurs.</div>}
              </div>
            )}
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Numéro du chèque *</label>
              <input value={nf.number} onChange={(e) => setNf({ ...nf, number: e.target.value })} className={inputCls} style={inputSt} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Banque du chèque</label>
              <input value={nf.bank} onChange={(e) => setNf({ ...nf, bank: e.target.value })} placeholder="Ex : Unibank, BNC, Sogebank…" className={inputCls} style={inputSt} />
            </div>
          </div>
          {nf.kind === "recu" && unpaidClients.length === 0 && <div className="text-xs mt-3" style={{ color: "#A39C87" }}>Aucune facture impayée. Un chèque se rattache à une facture à crédit.</div>}
          <div className="flex gap-2 justify-end mt-4">
            <button onClick={() => setNf(null)} className="px-3 py-1.5 rounded text-sm" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>Annuler</button>
            <button onClick={submitNewCheque} className="px-4 py-1.5 rounded text-sm text-white" style={{ background: "#0F6B5C" }}>Confirmer et enregistrer le chèque</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Card label="Chèques reçus à déposer" value={sum(toDeposit)} accent="#9A7B1E" />
        <Card label="Reçus déposés, non encaissés" value={sum(deposited)} accent="#2B4C8C" />
        <Card label="Émis en circulation" value={sum(inCirculation)} accent="#A6432F" />
        <Card label="Solde attendu sur le relevé" value={expectedStatement} accent="#0F6B5C" />
      </div>
      <p className="text-xs mb-6" style={{ color: "#7A7460" }}>
        Solde attendu sur le relevé bancaire = solde banque comptable ({fmt(soldeBanque)}) + chèques émis en circulation ({fmt(sum(inCirculation))}) − chèques reçus déposés pas encore crédités ({fmt(sum(deposited))}). Comparez ce montant au relevé de la banque.
      </p>

      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="display text-lg mb-1" style={{ color: "#152238" }}>Registre des chèques</div>
        <p className="text-xs mb-4" style={{ color: "#7A7460" }}>
          Utilisez les boutons « Nouveau chèque » ci-dessus, ou le bouton « Chèque » dans Vente / Comptes clients et « Payer (chèque) » dans Achat et fournisseurs. Les listes ci-dessous ne servent qu'à filtrer l'affichage.
        </p>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <span className="text-xs" style={{ color: "#8A8370" }}>Filtrer :</span>
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }}>
            <option value="">Reçus et émis</option>
            <option value="recu">Reçus (clients)</option>
            <option value="emis">Émis (fournisseurs)</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }}>
            <option value="pending">En attente d'encaissement</option>
            <option value="all">Tous les statuts</option>
            <option value="encaisse">Encaissés</option>
            <option value="rejete">Rejetés</option>
            <option value="annule">Annulés</option>
          </select>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead>
            <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
              <th className="py-2 font-normal">Date</th>
              <th className="py-2 font-normal">Type</th>
              <th className="py-2 font-normal">N°</th>
              <th className="py-2 font-normal">Tiers</th>
              <th className="py-2 font-normal text-right">Montant</th>
              <th className="py-2 font-normal text-center">Statut</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={7} className="py-8 text-center" style={{ color: "#A39C87" }}>Aucun chèque dans cette vue.</td></tr>
            )}
            {[...shown].reverse().map((c) => {
              const [bg, fg] = STATUS_STYLE[c.status] || ["#EEE9DA", "#7A7460"];
              return (
                <tr key={c.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-2 tabular">{c.date}</td>
                  <td className="py-2">{c.kind === "recu" ? "Reçu" : "Émis"}</td>
                  <td className="py-2 tabular">{c.number}{c.bank ? <span className="text-xs" style={{ color: "#A39C87" }}> · {c.bank}</span> : null}</td>
                  <td className="py-2">{c.party}</td>
                  <td className="py-2 tabular text-right">{fmt(c.amount)}</td>
                  <td className="py-2 text-center"><span className="text-xs px-2 py-0.5 rounded" style={{ background: bg, color: fg }}>{STATUS_LABEL[c.status] || c.status}</span></td>
                  <td className="py-2 text-right">
                    <div className="flex flex-wrap gap-1 justify-end">
                      {c.kind === "recu" && c.status === "a_deposer" && <button onClick={() => deposit(c)} className="text-xs px-2 py-1 rounded" style={btn}>Déposer en banque</button>}
                      {((c.kind === "recu" && c.status === "depose") || (c.kind === "emis" && c.status === "en_circulation")) && <button onClick={() => markCashed(c)} className="text-xs px-2 py-1 rounded" style={btn}>Marquer encaissé</button>}
                      {c.kind === "recu" && (c.status === "a_deposer" || c.status === "depose") && role === "Administrateur" && <button onClick={() => rejectReceived(c)} className="text-xs px-2 py-1 rounded" style={{ border: "1px solid #A6432F", color: "#A6432F" }}>Rejeté</button>}
                      {c.kind === "emis" && c.status === "en_circulation" && role === "Administrateur" && <button onClick={() => cancelIssued(c)} className="text-xs px-2 py-1 rounded" style={{ border: "1px solid #A6432F", color: "#A6432F" }}>Annuler</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}


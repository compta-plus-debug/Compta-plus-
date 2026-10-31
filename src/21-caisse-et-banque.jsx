// ═══ MODULE ═══
// @module Caisse et banque
// @depends ArrowDownCircle, ArrowUpCircle, AssistedPrincipleReminder, Card, CheckCircle2, ChequesPanel
//   Circle, GENESIS_HASH, PendingRecommendationsBanner, Plus, RecordedStamp, RotateCcw
//   _membership, detectAmountAnomaly, detectDuplicateAnomaly, detectRareAccountAnomaly, fmt
//   isFutureDate, isLocked, rangModule, simpleEntry, todayStr, uid, useAssistedAnomalyGate
//   useBrouillon, useMemo, useState
// @exports CaisseBanqueModule
// ═══ FIN DE L'EN-TÊTE ═══
const COUNTERPART_TYPES = ["Actif", "Passif", "Capitaux propres", "Charge", "Produit"];

function CaisseBanqueModule({ cheques, setCheques, invoices, setInvoices, purchases, setPurchases, accounts, entries, setEntries, balances, settings, role, showToast, logAudit, planTier, recordPendingRecommendation, currentUserEmail, pendingRecommendations, resolvePendingRecommendation }) {
  const lastSubmitRef = React.useRef(0); // anti double-clic/double-tap
  const anomalyGate = useAssistedAnomalyGate();
  const hasPendingCaisse = (pendingRecommendations || []).some((r) => r.module === "caisse");
  const [tab, setTab] = useState("caisse"); // "caisse" | "banque"
  const [expanded, setExpanded] = useState(null);
  const accountName = (code) => accounts.find((a) => a.code === code)?.name || code;
  const compteCode = tab === "caisse" ? "530" : "512";
  const counterparts = accounts.filter((a) => a.code !== compteCode);

  const [form, setForm] = useBrouillon("caisse-banque", {
    date: todayStr(),
    label: "",
    sens: "entree", // entree = encaissement, sortie = décaissement
    counterpart: counterparts[0]?.code,
    amount: "",
  });

  const ops = useMemo(
    () => entries.filter((e) => e.lines.some((l) => l.account === compteCode)),
    [entries, compteCode]
  );
  const [cbFrom, setCbFrom] = useState("");
  const [cbTo, setCbTo] = useState("");
  const [cbAccount, setCbAccount] = useState(""); // filtre par compte de contrepartie
  const [cbSens, setCbSens] = useState(""); // "" | "entree" | "sortie"
  const opsFiltered = ops.filter((e) => {
    if (cbFrom && e.date < cbFrom) return false;
    if (cbTo && e.date > cbTo) return false;
    const line = e.lines.find((l) => l.account === compteCode);
    const isEntree = line && line.debit > 0;
    if (cbSens === "entree" && !isEntree) return false;
    if (cbSens === "sortie" && isEntree) return false;
    if (cbAccount && !e.lines.some((l) => l.account === cbAccount)) return false;
    return true;
  });
  const opsFilteredTotal = opsFiltered.reduce((s, e) => {
    const line = e.lines.find((l) => l.account === compteCode);
    return s + (line ? (line.debit > 0 ? line.debit : line.credit) : 0);
  }, 0);

  const solde = balances[compteCode] || 0;

  const addOp = () => {
    if (Date.now() - lastSubmitRef.current < 800) return;
    lastSubmitRef.current = Date.now();
    if (hasPendingCaisse) {
      showToast("Traitez d'abord la recommandation en attente ci-dessus avant d'enregistrer une nouvelle opération.");
      return;
    }
    if (!form.label || !form.amount || Number(form.amount) <= 0) {
      showToast("Renseignez un libellé et un montant valide.");
      return;
    }
    if (isFutureDate(form.date)) {
      showToast("Impossible d'enregistrer une opération à une date future.");
      return;
    }
    if (isLocked(form.date, settings)) {
      showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Impossible d'enregistrer une opération à cette date.`);
      return;
    }
    const debit = form.sens === "entree" ? compteCode : form.counterpart;
    const credit = form.sens === "entree" ? form.counterpart : compteCode;
    const commitOp = () => {
      const entry = simpleEntry(form.date, form.label, debit, credit, Number(form.amount));
      entry.reconciled = false;
      setEntries((prev) => [...prev, entry]);
      logAudit("Caisse et banque", tab === "caisse" ? "Opération de caisse" : "Opération bancaire", `${form.label} — ${fmt(Number(form.amount))}`);
      setForm({ ...form, label: "", amount: "" });
      showToast(tab === "caisse" ? "Opération de caisse enregistrée." : "Opération bancaire enregistrée.");
    };
    if (planTier !== "assisted") { commitOp(); return; }
    const usageCounts = {};
    const amountsForCounterpart = [];
    for (const e of entries) {
      for (const l of e.lines) usageCounts[l.account] = (usageCounts[l.account] || 0) + 1;
      if (e.lines.some((l) => l.account === form.counterpart)) {
        amountsForCounterpart.push(e.lines.reduce((s, l) => s + l.debit + l.credit, 0) / 2);
      }
    }
    const anomalies = [];
    const corrections = [];
    const counterpartAcc = accounts.find((a) => a.code === form.counterpart);
    const rare = detectRareAccountAnomaly(form.counterpart, usageCounts, counterpartAcc?.name);
    if (rare) { anomalies.push(rare); corrections.push(`Si le compte de contrepartie ${counterpartAcc?.name || form.counterpart} est erroné : annulez cette opération (contrepassation) puis ressaisissez-la avec le bon compte.`); }
    const amt = detectAmountAnomaly(Number(form.amount), amountsForCounterpart, counterpartAcc?.name || form.counterpart);
    if (amt) { anomalies.push(amt); corrections.push("Si le montant est erroné : annulez cette opération (contrepassation) puis ressaisissez-la avec le montant correct."); }
    const dup = detectDuplicateAnomaly(
      { amount: Number(form.amount), date: form.date, label: form.label },
      ops.slice(-50).map((e) => ({ amount: e.lines.reduce((s, l) => s + l.debit, 0), date: e.date, label: e.label }))
    );
    if (dup) { anomalies.push(dup); corrections.push("Vérifiez les deux opérations : si l'une est bien un doublon, annulez-la par contrepassation."); }
    const signature = `cbop:${form.date}:${form.label}:${form.sens}:${form.counterpart}:${form.amount}`;
    anomalyGate(signature, [...new Set(anomalies)], commitOp, showToast, () => {
      recordPendingRecommendation?.({
        companyId: _membership?.companyId,
        module: "caisse",
        anomalyText: anomalies.join(" "),
        correctionText: [...new Set(corrections)].join(" "),
        entryRef: form.label,
        createdByEmail: currentUserEmail,
      });
    });
  };

  const toggleReconciled = (id) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, reconciled: !e.reconciled } : e)));
  };

  const cancelOp = (e) => {
    if (role !== "Administrateur") {
      showToast("Seul un administrateur peut annuler une opération validée.");
      return;
    }
    if (e.reversalOf) {
      showToast("Une écriture de contrepassation elle-même ne peut pas être annulée.");
      return;
    }
    if (e.cancelledBy) {
      showToast("Cette opération a déjà été contrepassée.");
      return;
    }
    if (isLocked(e.date, settings)) {
      showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Cette opération ne peut plus être annulée sans rouvrir la période.`);
      return;
    }
    if (!window.confirm("Annuler cette opération ? Une écriture de contrepassation sera ajoutée — l'opération d'origine reste visible pour la traçabilité.")) return;
    const reversalId = uid();
    const today = todayStr();
    setEntries((prev) => [
      ...prev.map((x) => (x.id === e.id ? { ...x, cancelledBy: reversalId } : x)),
      { id: reversalId, date: today, createdAt: new Date().toISOString(), label: `Contrepassation — ${e.label}`, reversalOf: e.id, lines: e.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })) },
    ]);
    showToast("Opération annulée par contrepassation.");
    logAudit("Caisse et banque", "Annulation opération (contrepassation)", e.label);
  };

  // ── Dépôt en banque / Retrait ──────────────────────────────────────────
  // Mouvement interne entre la caisse (530) et la banque (512) : une seule
  // écriture à deux lignes, comptes imposés (jamais choisis à la main).
  const cashCeilingKey = `compta-cash-ceiling-${_membership?.companyId || "x"}`;
  const [cashCeiling, setCashCeiling] = useState(() => {
    try { return window.localStorage.getItem(cashCeilingKey) || ""; } catch (e) { return ""; }
  });
  const saveCashCeiling = (v) => {
    setCashCeiling(v);
    try { if (v) window.localStorage.setItem(cashCeilingKey, v); else window.localStorage.removeItem(cashCeilingKey); } catch (e) {}
  };
  const [tf, setTf] = useState({ date: todayStr(), type: "depot", amount: "", ref: "" });
  const soldeCaisse = balances["530"] || 0;
  const soldeBanque = balances["512"] || 0;
  const ceilingNum = Number(cashCeiling) || 0;
  const excessCash = ceilingNum > 0 ? Math.max(0, soldeCaisse - ceilingNum) : 0;
  const transfers = useMemo(
    () => entries.filter((e) => e.transfer && e.lines.some((l) => l.account === "530") && e.lines.some((l) => l.account === "512")),
    [entries]
  );

  const addTransfer = () => {
    if (Date.now() - lastSubmitRef.current < 800) return;
    lastSubmitRef.current = Date.now();
    if (hasPendingCaisse) {
      showToast("Traitez d'abord la recommandation en attente avant d'enregistrer une nouvelle opération.");
      return;
    }
    const amount = Number(tf.amount);
    if (!amount || amount <= 0) { showToast("Renseignez un montant valide."); return; }
    if (isFutureDate(tf.date)) { showToast("Impossible d'enregistrer une opération à une date future."); return; }
    if (isLocked(tf.date, settings)) {
      showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Impossible d'enregistrer une opération à cette date.`);
      return;
    }
    const isDepot = tf.type === "depot";
    if (isDepot && amount > soldeCaisse) {
      showToast(`Dépôt impossible : le solde de la caisse (${fmt(soldeCaisse)}) est inférieur au montant.`);
      return;
    }
    if (!isDepot && amount > soldeBanque) {
      showToast(`Retrait impossible : le solde de la banque (${fmt(soldeBanque)}) est inférieur au montant.`);
      return;
    }
    const refTxt = (tf.ref || "").trim();
    const label = `${isDepot ? "Dépôt en banque" : "Retrait de la banque"}${refTxt ? ` — réf. ${refTxt}` : ""}`;
    const commitTransfer = () => {
      const entry = simpleEntry(tf.date, label, isDepot ? "512" : "530", isDepot ? "530" : "512", amount);
      entry.reconciled = false;
      entry.transfer = isDepot ? "depot" : "retrait";
      if (refTxt) entry.ref = refTxt;
      setEntries((prev) => [...prev, entry]);
      logAudit("Caisse et banque", isDepot ? "Dépôt en banque" : "Retrait de la banque", `${label} — ${fmt(amount)}`);
      setTf({ ...tf, amount: "", ref: "" });
      showToast(isDepot ? "Dépôt en banque enregistré." : "Retrait enregistré.");
    };
    if (planTier !== "assisted") { commitTransfer(); return; }
    const anomalies = [];
    const corrections = [];
    const prevAmounts = transfers.map((e) => e.lines.reduce((s, l) => s + l.debit, 0));
    const amt = detectAmountAnomaly(amount, prevAmounts, "dépôts/retraits");
    if (amt) { anomalies.push(amt); corrections.push("Si le montant est erroné : annulez cette opération (contrepassation) puis ressaisissez-la avec le montant correct."); }
    const dup = detectDuplicateAnomaly(
      { amount, date: tf.date, label },
      transfers.slice(-50).map((e) => ({ amount: e.lines.reduce((s, l) => s + l.debit, 0), date: e.date, label: e.label }))
    );
    if (dup) { anomalies.push(dup); corrections.push("Vérifiez les deux opérations : si l'une est bien un doublon, annulez-la par contrepassation."); }
    const signature = `cbtransfer:${tf.date}:${tf.type}:${tf.ref}:${tf.amount}`;
    anomalyGate(signature, [...new Set(anomalies)], commitTransfer, showToast, () => {
      recordPendingRecommendation?.({
        companyId: _membership?.companyId,
        module: "caisse",
        anomalyText: anomalies.join(" "),
        correctionText: [...new Set(corrections)].join(" "),
        entryRef: label,
        createdByEmail: currentUserEmail,
      });
    });
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module {rangModule("caisse")}</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Caisse et banque</div>
        <p className="text-sm mt-1" style={{ color: "#7A7460" }}>
          Chaque opération saisie ici est automatiquement enregistrée dans le journal comptable (compte {compteCode}).
        </p>
      </header>

      <div className="flex gap-1 mb-6 overflow-x-auto">
        {[
          ["caisse", "Caisse (530)"],
          ["banque", "Banque (512)"],
          ["transfert", "Dépôt / Retrait"],
          ["cheques", "Chèques"],
          ["performance", "Performance des dépenses"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="px-4 py-2 text-sm rounded-t shrink-0 whitespace-nowrap"
            style={{
              background: tab === id ? "#fff" : "transparent",
              borderBottom: tab === id ? "2px solid #C9A24B" : "2px solid transparent",
              color: tab === id ? "#152238" : "#8A8370",
              fontWeight: tab === id ? 600 : 400,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "caisse" && excessCash > 0 && (
        <div className="mb-4 p-3 rounded text-sm flex flex-wrap items-center justify-between gap-2" style={{ background: "#FBF1DC", color: "#7A5B10", border: "1px solid #E8D5A0" }}>
          <span>La caisse dépasse le plafond fixé ({fmt(ceilingNum)}) de <b>{fmt(excessCash)}</b>. Pensez à déposer l'excédent à la banque.</span>
          <button onClick={() => { setTf({ ...tf, type: "depot", amount: String(excessCash) }); setTab("transfert"); }}
            className="text-xs px-3 py-1.5 rounded text-white shrink-0" style={{ background: "#152238" }}>
            Déposer l'excédent
          </button>
        </div>
      )}

      {tab === "cheques" && (
        <ChequesPanel cheques={cheques} setCheques={setCheques} entries={entries} setEntries={setEntries} invoices={invoices || []} setInvoices={setInvoices} purchases={purchases || []} setPurchases={setPurchases} balances={balances} settings={settings} role={role} showToast={showToast} logAudit={logAudit} />
      )}

      {tab === "transfert" && (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            <Card label="Solde caisse (530)" value={soldeCaisse} accent={soldeCaisse >= 0 ? "#0F6B5C" : "#A6432F"} />
            <Card label="Solde banque (512)" value={soldeBanque} accent={soldeBanque >= 0 ? "#0F6B5C" : "#A6432F"} />
          </div>

          <div className="bg-white rounded-lg p-6 mb-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="display text-lg mb-1" style={{ color: "#152238" }}>Dépôt en banque / Retrait</div>
            <p className="text-xs mb-4" style={{ color: "#7A7460" }}>
              Mouvement d'argent entre la caisse et la banque. Les comptes sont fixés automatiquement : un dépôt débite la banque (512) et crédite la caisse (530) ; un retrait fait l'inverse. Ce n'est ni une recette ni une dépense.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 items-end">
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Opération</label>
                <select value={tf.type} onChange={(e) => setTf({ ...tf, type: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                  <option value="depot">Dépôt en banque (caisse → banque)</option>
                  <option value="retrait">Retrait de la banque (banque → caisse)</option>
                </select>
              </div>
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Date</label>
                <input type="date" value={tf.date} max={todayStr()} onChange={(e) => setTf({ ...tf, date: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
              </div>
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Montant</label>
                <input type="number" value={tf.amount} onChange={(e) => setTf({ ...tf, amount: e.target.value })} placeholder="0"
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
              </div>
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>N° de bordereau / référence</label>
                <input value={tf.ref} onChange={(e) => setTf({ ...tf, ref: e.target.value })} placeholder="Facultatif"
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
              </div>
            </div>
            <PendingRecommendationsBanner recommendations={pendingRecommendations} module="caisse" onDismiss={resolvePendingRecommendation} />
            <button onClick={addTransfer} disabled={hasPendingCaisse}
              className="flex items-center gap-2 px-4 py-2 rounded text-sm text-white"
              style={{ background: "#152238", opacity: hasPendingCaisse ? 0.5 : 1 }}>
              <Plus size={14} /> {tf.type === "depot" ? "Enregistrer le dépôt" : "Enregistrer le retrait"}
            </button>

            <div className="mt-6 pt-4" style={{ borderTop: "1px solid #EEE9DA" }}>
              <label className="text-xs" style={{ color: "#8A8370" }}>Plafond de caisse (alerte quand la caisse le dépasse)</label>
              <div className="flex items-center gap-2 mt-1">
                <input type="number" value={cashCeiling} onChange={(e) => saveCashCeiling(e.target.value)} placeholder="Aucun plafond"
                  className="border rounded px-2 py-1.5 text-sm tabular" style={{ borderColor: "#DDD6C4", width: 200, maxWidth: "100%" }} />
                {cashCeiling && <button onClick={() => saveCashCeiling("")} className="text-xs underline" style={{ color: "#8A8370" }}>Retirer</button>}
              </div>
              <p className="text-xs mt-1" style={{ color: "#A39C87" }}>Enregistré sur cet appareil. L'alerte s'affiche en haut de l'onglet Caisse.</p>
            </div>
          </div>

          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="display text-lg mb-3" style={{ color: "#152238" }}>Historique des dépôts et retraits</div>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                  <th className="py-2 font-normal">Date</th>
                  <th className="py-2 font-normal">Opération</th>
                  <th className="py-2 font-normal text-right">Montant</th>
                  <th className="py-2 font-normal text-center">Pointé</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {transfers.length === 0 && (
                  <tr><td colSpan={5} className="py-8 text-center" style={{ color: "#A39C87" }}>Aucun dépôt ni retrait enregistré.</td></tr>
                )}
                {[...transfers].reverse().map((e) => {
                  const amount = e.lines.reduce((s, l) => s + l.debit, 0);
                  return (
                    <tr key={e.id} style={{ borderBottom: "1px solid #F3EFE3", borderLeft: e.cancelledBy ? "3px solid #A6432F" : "3px solid #0F6B5C" }}>
                      <td className="py-2 tabular pl-2">{e.date}</td>
                      <td className="py-2">
                        {e.label}
                        {e.cancelledBy && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded" style={{ background: "#F7E9E3", color: "#A6432F" }}>annulée</span>}
                      </td>
                      <td className="py-2 tabular text-right">{fmt(amount)}</td>
                      <td className="py-2 text-center">
                        <button onClick={() => toggleReconciled(e.id)} title="Pointer avec le relevé bancaire">
                          {e.reconciled ? <CheckCircle2 size={16} style={{ color: "#0F6B5C" }} /> : <Circle size={16} style={{ color: "#C7C0AD" }} />}
                        </button>
                      </td>
                      <td className="py-2 text-right">
                        {role === "Administrateur" && !e.cancelledBy && !e.reversalOf && (
                          <button onClick={() => cancelOp(e)} title="Annuler (contrepassation)" style={{ color: "#A6432F" }}>
                            <RotateCcw size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </div>
        </div>
      )}

      {(tab === "caisse" || tab === "banque") && (<>
      <div className="mb-6">
        <Card label={tab === "caisse" ? "Solde caisse" : "Solde banque"} value={solde} accent={solde >= 0 ? "#0F6B5C" : "#A6432F"} />
      </div>

      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5 items-end">
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Date</label>
            <input type="date" value={form.date} max={todayStr()} onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Sens</label>
            <select value={form.sens} onChange={(e) => setForm({ ...form, sens: e.target.value })}
              className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
              <option value="entree">Encaissement</option>
              <option value="sortie">Décaissement</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-xs" style={{ color: "#8A8370" }}>Libellé</label>
            <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Ex : Règlement client, achat fournitures..."
              className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Contrepartie</label>
            <select value={form.counterpart} onChange={(e) => setForm({ ...form, counterpart: e.target.value })}
              className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
              {counterparts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Montant</label>
            <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0"
              className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
          </div>
        </div>
        <PendingRecommendationsBanner recommendations={pendingRecommendations} module="caisse" onDismiss={resolvePendingRecommendation} />
        <AssistedPrincipleReminder planTier={planTier} text="Un encaissement augmente la caisse/banque (débit), un décaissement la diminue (crédit) — vérifiez que le sens choisi correspond bien à l'argent qui entre ou qui sort réellement." />
        <button onClick={addOp} disabled={hasPendingCaisse}
          className="flex items-center gap-2 px-4 py-2 rounded text-sm text-white mb-6"
          style={{ background: "#152238", opacity: hasPendingCaisse ? 0.5 : 1 }}>
          <Plus size={14} /> Enregistrer l'opération
        </button>

        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Du</label>
            <input type="date" value={cbFrom} onChange={(e) => setCbFrom(e.target.value)}
              className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
            <input type="date" value={cbTo} onChange={(e) => setCbTo(e.target.value)}
              className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Compte (contrepartie)</label>
            <select value={cbAccount} onChange={(e) => setCbAccount(e.target.value)}
              className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", width: "min(280px, 100%)", boxSizing: "border-box" }}>
              <option value="">Tous les comptes</option>
              {counterparts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Sens</label>
            <select value={cbSens} onChange={(e) => setCbSens(e.target.value)}
              className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }}>
              <option value="">Tous</option>
              <option value="entree">Encaissement</option>
              <option value="sortie">Décaissement</option>
            </select>
          </div>
          {(cbFrom || cbTo || cbAccount || cbSens) && (
            <button onClick={() => { setCbFrom(""); setCbTo(""); setCbAccount(""); setCbSens(""); }} className="text-xs underline mb-1.5" style={{ color: "#8A8370" }}>
              Réinitialiser
            </button>
          )}
          {(cbFrom || cbTo || cbAccount || cbSens) && (
            <div className="tabular text-xs mb-1.5 ml-auto" style={{ color: "#152238" }}>
              {opsFiltered.length} opération{opsFiltered.length > 1 ? "s" : ""} · Total {fmt(opsFilteredTotal)}
            </div>
          )}
        </div>

        <div className="overflow-x-auto overflow-y-auto max-h-[65vh] border rounded" style={{ borderColor: "#EEE9DA" }}><table className="w-full text-sm">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
              <th className="py-2 font-normal">Date</th>
              <th className="py-2 font-normal">Libellé</th>
              <th className="py-2 font-normal">Sens</th>
              <th className="py-2 font-normal text-right">Montant</th>
              {tab === "banque" && <th className="py-2 font-normal text-center">Pointé</th>}
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {opsFiltered.length === 0 && (
              <tr><td colSpan={tab === "banque" ? 6 : 5} className="py-8 text-center" style={{ color: "#A39C87" }}>
                {ops.length === 0 ? "Aucune opération. Enregistrez-en une ci-dessus." : "Aucune opération sur cette période."}
              </td></tr>
            )}
            {[...opsFiltered].reverse().map((e) => {
              const line = e.lines.find((l) => l.account === compteCode);
              const isEntree = line.debit > 0;
              const amount = line.debit > 0 ? line.debit : line.credit;
              const isOpen = expanded === e.id;
              return (
                <React.Fragment key={e.id}>
                <tr onClick={() => setExpanded(isOpen ? null : e.id)} className="cursor-pointer" style={{ borderBottom: "1px solid #F3EFE3", borderLeft: e.cancelledBy ? "3px solid #A6432F" : "3px solid #0F6B5C" }}>
                  <td className="py-2 tabular">{e.date}</td>
                  <td className="py-2">
                    {e.label}
                    {e.cancelledBy && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded" style={{ background: "#F7E9E3", color: "#A6432F" }}>annulée</span>}
                    {e.reversalOf && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded" style={{ background: "#FBF1DC", color: "#9A7B1E" }}>contrepassation</span>}
                  </td>
                  <td className="py-2">
                    <span className="flex items-center gap-1" style={{ color: isEntree ? "#0F6B5C" : "#A6432F" }}>
                      {isEntree ? <ArrowDownCircle size={14} /> : <ArrowUpCircle size={14} />}
                      {isEntree ? "Encaissement" : "Décaissement"}
                    </span>
                  </td>
                  <td className="py-2 tabular text-right">{fmt(amount)}</td>
                  {tab === "banque" && (
                    <td className="py-2 text-center">
                      <button onClick={(ev) => { ev.stopPropagation(); toggleReconciled(e.id); }}>
                        {e.reconciled
                          ? <CheckCircle2 size={16} style={{ color: "#0F6B5C" }} />
                          : <Circle size={16} style={{ color: "#C7C0AD" }} />}
                      </button>
                    </td>
                  )}
                  <td className="py-2 text-right">
                    {role === "Administrateur" && !e.cancelledBy && !e.reversalOf && (
                      <button onClick={(ev) => { ev.stopPropagation(); cancelOp(e); }} title="Annuler (contrepassation)" style={{ color: "#A6432F" }}>
                        <RotateCcw size={14} />
                      </button>
                    )}
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={tab === "banque" ? 6 : 5} className="py-3 px-3" style={{ background: "#FAF8F1" }}>
                      <div className="overflow-x-auto"><table className="w-full text-xs">
                        <thead>
                          <tr style={{ color: "#8A8370" }}>
                            <th className="text-left font-normal py-1">Compte</th>
                            <th className="text-right font-normal py-1">Débit</th>
                            <th className="text-right font-normal py-1">Crédit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {e.lines.map((l, i) => (
                            <tr key={i}>
                              <td className="py-1">{l.account} — {accountName(l.account)}</td>
                              <td className="py-1 tabular text-right">{l.debit > 0 ? fmt(l.debit) : ""}</td>
                              <td className="py-1 tabular text-right">{l.credit > 0 ? fmt(l.credit) : ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table></div>
                      <RecordedStamp createdAt={e.createdAt} />
                      {e.hash && (
                        <div className="mt-2 tabular text-[10px]" style={{ color: "#A39C87" }}>
                          Empreinte : {e.hash.slice(0, 16)}… (chaînée sur {(e.prevHash || GENESIS_HASH).slice(0, 8)}…)
                        </div>
                      )}
                    </td>
                  </tr>
                )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table></div>
      </div>
      </>)}

      {tab === "performance" && (() => {
        // Performance des dépenses : regroupe toutes les sorties de caisse ET de
        // banque par catégorie (compte de contrepartie), avec le montant dépensé
        // ce mois-ci et le pourcentage que cette catégorie représente dans le
        // total des dépenses — toutes périodes confondues, caisse et banque réunies.
        const now = new Date();
        const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const byCategory = {};
        let totalAllExpenses = 0;
        entries.forEach((e) => {
          const cashLine = e.lines.find((l) => l.account === "530" || l.account === "512");
          if (!cashLine || !(cashLine.credit > 0)) return;
          (e.lines || []).forEach((l) => {
            if (l.account === "530" || l.account === "512") return;
            if (!(l.debit > 0)) return;
            const key = l.account;
            if (!byCategory[key]) byCategory[key] = { code: key, name: accountName(key), totalAll: 0, totalMonth: 0 };
            byCategory[key].totalAll += l.debit;
            totalAllExpenses += l.debit;
            if (e.date && e.date.startsWith(currentMonthPrefix)) byCategory[key].totalMonth += l.debit;
          });
        });
        const perfRows = Object.values(byCategory)
          .map((c) => ({ ...c, pct: totalAllExpenses > 0 ? (c.totalAll / totalAllExpenses) * 100 : 0 }))
          .sort((a, b) => b.totalMonth - a.totalMonth);

        return perfRows.length === 0 ? (
          <div className="bg-white rounded-lg p-8 text-center text-sm" style={{ border: "1px solid #E4DFD1", color: "#A39C87" }}>Aucune dépense enregistrée pour le moment.</div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,34,56,0.08)" }}>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#F5E6BE" }}>
                  <th className="py-2 px-3 text-left font-medium" style={{ color: "#6B5117", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Catégorie de dépense</th>
                  <th className="py-2 px-3 text-right font-medium" style={{ color: "#6B5117", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Dépenses ce mois-ci</th>
                  <th className="py-2 px-3 text-right font-medium" style={{ color: "#6B5117", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>% du total des dépenses</th>
                </tr>
              </thead>
              <tbody>
                {perfRows.map((r) => (
                  <tr key={r.code}>
                    <td className="py-2 pl-3 pr-1" style={{ color: "#152238", borderLeft: "3px solid #D85A30" }}>{r.name}</td>
                    <td className="py-2 px-3 tabular text-right" style={{ color: r.totalMonth > 0 ? "#A6432F" : "#A39C87" }}>{fmt(r.totalMonth)}</td>
                    <td className="py-2 px-3 tabular text-right" style={{ color: "#7A7460" }}>{r.pct.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        );
      })()}
    </div>
  );
}


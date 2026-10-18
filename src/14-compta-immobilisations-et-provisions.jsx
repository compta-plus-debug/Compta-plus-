// Registre des immobilisations — amortissement linéaire uniquement, dotations
// générées manuellement par l'utilisateur (bouton "Générer les dotations"), jamais
// automatiquement à l'insu de l'entreprise. Le calcul se base sur des mois entiers
// écoulés depuis la dernière dotation (ou l'acquisition si aucune n'a encore été
// posée), plafonné à ce qu'il reste à amortir — jamais au-delà de la valeur d'origine.
// Coefficient standard d'amortissement dégressif, selon la durée de vie retenue —
// usage courant francophone. Le taux dégressif suggéré = (1/durée) × coefficient.
function suggestDegressiveCoefficient(years) {
  if (years <= 4) return 1.25;
  if (years <= 6) return 1.75;
  return 2.25;
}

function ImmobilisationsPanel({ accounts, assets, setAssets, entries, setEntries, role, showToast, logAudit, planTier, recordPendingRecommendation, currentUserEmail }) {
  const canEdit = role !== "Vendeur";
  const [form, setForm] = useState({ name: "", categoryIdx: "0", acquisitionDate: todayStr(), originalValue: "", usefulLifeYears: "5", paymentMode: "caisse", method: "lineaire", degressiveRate: "" });
  const [genDate, setGenDate] = useState(todayStr());
  const anomalyGate = useAssistedAnomalyGate();

  // Taux suggéré recalculé à chaque changement de durée, tant que l'utilisateur n'a
  // pas lui-même modifié le champ (une saisie manuelle est toujours respectée).
  const suggestedRate = (() => {
    const years = Number(form.usefulLifeYears);
    if (!(years > 0)) return "";
    return Math.round(((1 / years) * suggestDegressiveCoefficient(years)) * 10000) / 100; // en %, 2 décimales
  })();

  // Pré-remplit le taux dégressif suggéré dès que la durée change ou que le mode
  // dégressif est sélectionné — une vraie valeur dans le champ, pas seulement un
  // texte grisé indicatif, pour que la suggestion soit immédiatement visible.
  useEffect(() => {
    if (form.method === "degressif") {
      const years = Number(form.usefulLifeYears);
      if (years > 0) {
        const rate = Math.round(((1 / years) * suggestDegressiveCoefficient(years)) * 10000) / 100;
        setForm((prev) => (prev.method === "degressif" ? { ...prev, degressiveRate: String(rate) } : prev));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.method, form.usefulLifeYears]);

  const addAsset = () => {
    const value = Number(form.originalValue);
    const years = Number(form.usefulLifeYears);
    if (!form.name.trim() || !(value > 0) || !(years > 0)) {
      showToast("Renseignez un nom, une valeur d'origine et une durée valides.");
      return;
    }
    const degressiveRate = form.method === "degressif" ? Number(form.degressiveRate || suggestedRate) / 100 : null;
    if (form.method === "degressif" && !(degressiveRate > 0)) {
      showToast("Renseignez un taux dégressif valide.");
      return;
    }
    const category = ASSET_CATEGORIES[Number(form.categoryIdx)];
    const payAccount = form.paymentMode === "caisse" ? "530" : form.paymentMode === "banque" ? "512" : "404";
    const commit = () => {
    const entry = {
      id: uid(), date: form.acquisitionDate, createdAt: new Date().toISOString(),
      label: `Acquisition immobilisation — ${form.name}`,
      lines: [{ account: category.assetAccount, debit: value, credit: 0 }, { account: payAccount, debit: 0, credit: value }],
    };
    setEntries((prev) => [...prev, entry]);
    setAssets((prev) => [...prev, {
      id: uid(), name: form.name.trim(), categoryLabel: category.label,
      assetAccount: category.assetAccount, depreciationAccount: category.depreciationAccount,
      acquisitionDate: form.acquisitionDate, originalValue: value, usefulLifeYears: years,
      method: form.method, degressiveRate,
      accumulatedDepreciation: 0, lastDepreciationDate: null, createdAt: new Date().toISOString(),
    }]);
    logAudit("Comptabilité", "Ajout immobilisation", `${form.name} : ${fmt(value)}`);
    showToast("Immobilisation enregistrée.");
    setForm({ name: "", categoryIdx: "0", acquisitionDate: todayStr(), originalValue: "", usefulLifeYears: "5", paymentMode: "caisse", method: "lineaire", degressiveRate: "" });
    };
    if (planTier !== "assisted") { commit(); return; }
    const anomalies = [];
    if (years < 1 || years > 20) anomalies.push(`Durée d'amortissement inhabituelle pour « ${form.name} » : ${years} an(s) — vérifiez la saisie.`);
    const amountsInCategory = assets.filter((a) => a.categoryLabel === category.label).map((a) => a.originalValue);
    const amtAnomaly = detectAmountAnomaly(value, amountsInCategory, category.label);
    if (amtAnomaly) anomalies.push(amtAnomaly);
    const signature = `asset:${form.name}:${value}:${years}:${form.method}:${degressiveRate}`;
    anomalyGate(signature, [...new Set(anomalies)], commit, showToast, () => {
      recordPendingRecommendation?.({
        companyId: _membership?.companyId,
        module: "immobilisations",
        anomalyText: anomalies.join(" "),
        correctionText: "Vérifiez la durée et la valeur saisies ; une immobilisation erronée peut être retirée manuellement du registre.",
        entryRef: form.name,
        createdByEmail: currentUserEmail,
      });
    });
  };

  // Mois entiers écoulés entre deux dates (années*12 + mois, sans tenir compte du
  // jour du mois) — une base simple et prévisible pour le prorata linéaire.
  const monthsBetween = (from, to) => {
    const a = new Date(from), b = new Date(to);
    return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()));
  };

  const generateDepreciations = () => {
    let count = 0, total = 0;
    const newEntries = [];
    const updatedAssets = assets.map((a) => {
      const remaining = a.originalValue - (a.accumulatedDepreciation || 0);
      if (remaining <= 0) return a;
      const since = a.lastDepreciationDate || a.acquisitionDate;
      const months = monthsBetween(since, genDate);
      if (months <= 0) return a;
      // Linéaire : montant fixe chaque mois, basé sur la valeur d'origine.
      // Dégressif : taux annuel appliqué chaque mois à la valeur nette comptable
      // restante au début de la période — la dotation diminue donc naturellement
      // d'une génération à l'autre, à l'inverse du linéaire.
      const dotation = a.method === "degressif"
        ? Math.min(remaining, Math.round(remaining * (a.degressiveRate / 12) * months * 100) / 100)
        : Math.min(remaining, Math.round((a.originalValue / (a.usefulLifeYears * 12)) * months * 100) / 100);
      if (dotation <= 0) return a;
      newEntries.push({
        id: uid(), date: genDate, createdAt: new Date().toISOString(),
        label: `Dotation amortissement — ${a.name}`,
        lines: [{ account: "6811", debit: dotation, credit: 0 }, { account: a.depreciationAccount, debit: 0, credit: dotation }],
      });
      count += 1; total += dotation;
      return { ...a, accumulatedDepreciation: (a.accumulatedDepreciation || 0) + dotation, lastDepreciationDate: genDate };
    });
    if (count === 0) {
      showToast("Aucune dotation à générer à cette date (déjà à jour, ou immobilisations entièrement amorties).");
      return;
    }
    setEntries((prev) => [...prev, ...newEntries]);
    setAssets(updatedAssets);
    logAudit("Comptabilité", "Génération dotations amortissements", `${count} immobilisation(s), total ${fmt(total)}`);
    showToast(`${count} dotation(s) générée(s), total ${fmt(total)}.`);
  };

  return (
    <div className="space-y-6">
      {canEdit && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Ajouter une immobilisation</div>
          <div className="flex gap-2 mb-3">
            <button onClick={() => setForm({ ...form, method: "lineaire" })}
              className="px-3 py-1.5 rounded text-xs" style={{ background: form.method === "lineaire" ? "#152238" : "#F3EFE3", color: form.method === "lineaire" ? "#fff" : "#7A7460" }}>
              Amortissement linéaire
            </button>
            <button onClick={() => setForm({ ...form, method: "degressif" })}
              className="px-3 py-1.5 rounded text-xs" style={{ background: form.method === "degressif" ? "#152238" : "#F3EFE3", color: form.method === "degressif" ? "#fff" : "#7A7460" }}>
              Amortissement dégressif
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Nom</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex. Camionnette de livraison"
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Catégorie</label>
              <select value={form.categoryIdx} onChange={(e) => setForm({ ...form, categoryIdx: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                {ASSET_CATEGORIES.map((c, i) => <option key={c.assetAccount} value={i}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Date d'acquisition</label>
              <input type="date" value={form.acquisitionDate} max={todayStr()} onChange={(e) => setForm({ ...form, acquisitionDate: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Valeur d'origine</label>
              <input type="number" min="0" value={form.originalValue} onChange={(e) => setForm({ ...form, originalValue: e.target.value })} placeholder="0"
                className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Durée d'amortissement (années)</label>
              <input type="number" min="1" value={form.usefulLifeYears} onChange={(e) => setForm({ ...form, usefulLifeYears: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
            {form.method === "degressif" && (
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Taux dégressif annuel (%)</label>
                <input type="number" min="0" max="100" step="0.01" value={form.degressiveRate} placeholder={String(suggestedRate)}
                  onChange={(e) => setForm({ ...form, degressiveRate: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
              </div>
            )}
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Règlement</label>
              <select value={form.paymentMode} onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="caisse">Caisse</option>
                <option value="banque">Banque</option>
                <option value="credit">À crédit (fournisseur à payer)</option>
              </select>
            </div>
          </div>
          <button onClick={addAsset} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238" }}>+ Enregistrer l'immobilisation</button>
        </div>
      )}

      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="text-sm font-medium" style={{ color: "#152238" }}>Registre des immobilisations</div>
          {canEdit && assets.length > 0 && (
            <div className="flex items-end gap-2">
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Générer les dotations jusqu'au</label>
                <input type="date" value={genDate} max={todayStr()} onChange={(e) => setGenDate(e.target.value)}
                  className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
              </div>
              <button onClick={generateDepreciations} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>Générer les dotations</button>
            </div>
          )}
        </div>
        {assets.length === 0 ? (
          <div className="text-xs py-4 text-center" style={{ color: "#A39C87" }}>Aucune immobilisation enregistrée.</div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,34,56,0.08)" }}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#A8D4C4" }}>
                <th className="py-2 px-3 text-left font-medium" style={{ color: "#0F6B5C", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Nom</th>
                <th className="py-2 px-3 text-left font-medium" style={{ color: "#0F6B5C", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Catégorie</th>
                <th className="py-2 px-3 text-left font-medium" style={{ color: "#0F6B5C", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Méthode</th>
                <th className="py-2 px-3 text-left font-medium" style={{ color: "#0F6B5C", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Acquisition</th>
                <th className="py-2 px-3 text-right font-medium" style={{ color: "#0F6B5C", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Valeur d'origine</th>
                <th className="py-2 px-3 text-right font-medium" style={{ color: "#0F6B5C", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Cumul amorti</th>
                <th className="py-2 px-3 text-right font-medium" style={{ color: "#0F6B5C", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>VNC</th>
                <th className="py-2 px-3 text-right font-medium" style={{ color: "#0F6B5C", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Mois à compter</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => {
                const remaining = a.originalValue - (a.accumulatedDepreciation || 0);
                const since = a.lastDepreciationDate || a.acquisitionDate;
                const monthsToCount = remaining > 0 ? monthsBetween(since, genDate) : 0;
                return (
                <tr key={a.id}>
                  <td className="py-2 pl-3 pr-1" style={{ color: "#152238", borderLeft: "3px solid #1D9E75" }}>{a.name}</td>
                  <td className="py-2 px-3" style={{ color: "#152238" }}>{a.categoryLabel}</td>
                  <td className="py-2 px-3 text-xs" style={{ color: "#7A7460" }}>{a.method === "degressif" ? `Dégressif (${Math.round((a.degressiveRate || 0) * 10000) / 100}%)` : "Linéaire"}</td>
                  <td className="py-2 px-3 tabular" style={{ color: "#152238" }}>{a.acquisitionDate}</td>
                  <td className="py-2 px-3 tabular text-right" style={{ color: "#152238" }}>{fmt(a.originalValue)}</td>
                  <td className="py-2 px-3 tabular text-right" style={{ color: "#152238" }}>{fmt(a.accumulatedDepreciation || 0)}</td>
                  <td className="py-2 px-3 tabular text-right font-medium" style={{ color: "#152238" }}>{fmt(remaining)}</td>
                  <td className="py-2 px-3 tabular text-right" style={{ color: monthsToCount > 0 ? "#152238" : "#A39C87" }}>{monthsToCount}</td>
                </tr>
                );
              })}
            </tbody>
          </table></div>
          </div>
        )}
      </div>
    </div>
  );
}

// Charges à payer / produits à recevoir — une charge/produit déjà engagé mais pas
// encore facturé, estimé à la date de clôture pour être rattaché à la bonne
// période. Se contrepasse manuellement dès réception de la vraie facture (la vraie
// facture se saisit alors normalement dans Achats/Ventes, séparément).
function AccrualsPanel({ accounts, accruals, setAccruals, entries, setEntries, role, showToast, logAudit, planTier, recordPendingRecommendation, currentUserEmail }) {
  const canEdit = role !== "Vendeur";
  const chargeAccounts = accounts.filter((a) => a.type === "Charge");
  const revenueAccounts = accounts.filter((a) => a.type === "Produit");
  const [form, setForm] = useState({ type: "charge", date: todayStr(), account: "", amount: "", label: "" });
  const anomalyGate = useAssistedAnomalyGate();

  const relevantAccounts = form.type === "charge" ? chargeAccounts : revenueAccounts;
  const selectedAccount = form.account || relevantAccounts[0]?.code || "";

  const addAccrual = () => {
    const amount = Number(form.amount);
    if (!form.label.trim() || !(amount > 0) || !selectedAccount) {
      showToast("Renseignez un libellé, un compte et un montant valides.");
      return;
    }
    const counterAccount = form.type === "charge" ? "4081" : "4181";
    const commit = () => {
    const entry = {
      id: uid(), date: form.date, createdAt: new Date().toISOString(),
      label: `${form.type === "charge" ? "Charge à payer" : "Produit à recevoir"} — ${form.label}`,
      lines: form.type === "charge"
        ? [{ account: selectedAccount, debit: amount, credit: 0 }, { account: counterAccount, debit: 0, credit: amount }]
        : [{ account: counterAccount, debit: amount, credit: 0 }, { account: selectedAccount, debit: 0, credit: amount }],
    };
    setEntries((prev) => [...prev, entry]);
    setAccruals((prev) => [...prev, {
      id: uid(), type: form.type, date: form.date, label: form.label.trim(), account: selectedAccount, counterAccount, amount,
      entryId: entry.id, status: "en_attente", createdAt: new Date().toISOString(),
    }]);
    logAudit("Comptabilité", form.type === "charge" ? "Charge à payer" : "Produit à recevoir", `${form.label} : ${fmt(amount)}`);
    showToast("Régularisation enregistrée.");
    setForm({ type: form.type, date: todayStr(), account: "", amount: "", label: "" });
    };
    if (planTier !== "assisted") { commit(); return; }
    const anomalies = [];
    const sameAccountAmounts = accruals.filter((a) => a.account === selectedAccount).map((a) => a.amount);
    const amtAnomaly = detectAmountAnomaly(amount, sameAccountAmounts, accounts.find((a) => a.code === selectedAccount)?.name || selectedAccount);
    if (amtAnomaly) anomalies.push(amtAnomaly);
    const signature = `accrual:${form.type}:${selectedAccount}:${amount}:${form.label}`;
    anomalyGate(signature, [...new Set(anomalies)], commit, showToast, () => {
      recordPendingRecommendation?.({
        companyId: _membership?.companyId,
        module: "comptabilite",
        anomalyText: anomalies.join(" "),
        correctionText: "Vérifiez le montant estimé ; la contrepassation corrigera l'écart dès réception de la vraie facture.",
        entryRef: form.label,
        createdByEmail: currentUserEmail,
      });
    });
  };

  const reverseAccrual = (accrual) => {
    if (!window.confirm(`Contrepasser « ${accrual.label} » (${fmt(accrual.amount)}) ? Vous pourrez ensuite enregistrer la vraie facture normalement dans Achats ou Ventes.`)) return;
    const entry = {
      id: uid(), date: todayStr(), createdAt: new Date().toISOString(), reversalOf: accrual.entryId,
      label: `Contrepassation — ${accrual.label}`,
      lines: accrual.type === "charge"
        ? [{ account: accrual.counterAccount, debit: accrual.amount, credit: 0 }, { account: accrual.account, debit: 0, credit: accrual.amount }]
        : [{ account: accrual.account, debit: accrual.amount, credit: 0 }, { account: accrual.counterAccount, debit: 0, credit: accrual.amount }],
    };
    setEntries((prev) => [...prev, entry]);
    setAccruals((prev) => prev.map((a) => (a.id === accrual.id ? { ...a, status: "contrepasse", reversalDate: todayStr() } : a)));
    logAudit("Comptabilité", "Contrepassation régularisation", `${accrual.label} : ${fmt(accrual.amount)}`);
    showToast("Contrepassé — enregistrez maintenant la vraie facture dans Achats ou Ventes.");
  };

  const pending = accruals.filter((a) => a.status !== "contrepasse");
  const closed = accruals.filter((a) => a.status === "contrepasse");

  return (
    <div className="space-y-6">
      {canEdit && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Nouvelle régularisation</div>
          <div className="flex gap-2 mb-3">
            <button onClick={() => setForm({ ...form, type: "charge", account: "" })}
              className="px-3 py-1.5 rounded text-xs" style={{ background: form.type === "charge" ? "#152238" : "#F3EFE3", color: form.type === "charge" ? "#fff" : "#7A7460" }}>
              Charge à payer
            </button>
            <button onClick={() => setForm({ ...form, type: "produit", account: "" })}
              className="px-3 py-1.5 rounded text-xs" style={{ background: form.type === "produit" ? "#152238" : "#F3EFE3", color: form.type === "produit" ? "#fff" : "#7A7460" }}>
              Produit à recevoir
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Libellé</label>
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Ex. Électricité décembre"
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Compte {form.type === "charge" ? "de charge" : "de produit"}</label>
              <select value={selectedAccount} onChange={(e) => setForm({ ...form, account: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                {relevantAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Date (période concernée)</label>
              <input type="date" value={form.date} max={todayStr()} onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Montant estimé</label>
              <input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0"
                className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
          </div>
          <button onClick={addAccrual} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238" }}>+ Enregistrer la régularisation</button>
        </div>
      )}

      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>En attente de facture ({pending.length})</div>
        {pending.length === 0 ? (
          <div className="text-xs py-4 text-center" style={{ color: "#A39C87" }}>Aucune régularisation en attente.</div>
        ) : (
          <div className="space-y-2">
            {pending.map((a) => (
              <div key={a.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-2 rounded" style={{ border: "1px solid #EEE9DA" }}>
                <span className="text-sm">{a.type === "charge" ? "Charge à payer" : "Produit à recevoir"} — {a.label} ({a.date}) : <span className="tabular font-medium">{fmt(a.amount)}</span></span>
                {canEdit && (
                  <button onClick={() => reverseAccrual(a)} className="text-xs underline sm:shrink-0" style={{ color: "#152238" }}>Contrepasser (facture reçue)</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {closed.length > 0 && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Contrepassées ({closed.length})</div>
          <div className="space-y-2">
            {closed.map((a) => (
              <div key={a.id} className="text-sm p-2 rounded" style={{ border: "1px solid #F3EFE3", color: "#8A8370" }}>
                {a.type === "charge" ? "Charge à payer" : "Produit à recevoir"} — {a.label} : {fmt(a.amount)} — contrepassée le {a.reversalDate}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Charges/produits constatés d'avance — un montant déjà payé ou encaissé mais qui
// couvre plusieurs périodes futures (ex. assurance annuelle payée d'avance) : la
// totalité est d'abord logée en 486/487, puis reclassée mois par mois vers le
// vrai compte de charge/produit via un bouton manuel — même principe que
// l'amortissement d'une immobilisation, mais sur un compte de régularisation
// plutôt qu'un actif physique.
function DeferralsPanel({ accounts, deferrals, setDeferrals, entries, setEntries, role, showToast, logAudit, planTier, recordPendingRecommendation, currentUserEmail }) {
  const canEdit = role !== "Vendeur";
  const chargeAccounts = accounts.filter((a) => a.type === "Charge");
  const revenueAccounts = accounts.filter((a) => a.type === "Produit");
  const [form, setForm] = useState({ type: "charge", label: "", startDate: todayStr(), months: "12", totalAmount: "", account: "", paymentMode: "caisse" });
  const [genDate, setGenDate] = useState(todayStr());
  const anomalyGate = useAssistedAnomalyGate();

  const relevantAccounts = form.type === "charge" ? chargeAccounts : revenueAccounts;
  const selectedAccount = form.account || relevantAccounts[0]?.code || "";

  const monthsBetween = (from, to) => {
    const a = new Date(from), b = new Date(to);
    return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()));
  };

  const addDeferral = () => {
    const amount = Number(form.totalAmount);
    const months = Number(form.months);
    if (!form.label.trim() || !(amount > 0) || !(months > 0) || !selectedAccount) {
      showToast("Renseignez un libellé, un compte, une durée et un montant valides.");
      return;
    }
    const counterAccount = form.type === "charge" ? "486" : "487";
    const payAccount = form.type === "charge"
      ? (form.paymentMode === "caisse" ? "530" : form.paymentMode === "banque" ? "512" : "401")
      : (form.paymentMode === "caisse" ? "530" : form.paymentMode === "banque" ? "512" : "411");
    const commit = () => {
    const entry = {
      id: uid(), date: form.startDate, createdAt: new Date().toISOString(),
      label: `${form.type === "charge" ? "Charge" : "Produit"} constaté(e) d'avance — ${form.label}`,
      lines: form.type === "charge"
        ? [{ account: counterAccount, debit: amount, credit: 0 }, { account: payAccount, debit: 0, credit: amount }]
        : [{ account: payAccount, debit: amount, credit: 0 }, { account: counterAccount, debit: 0, credit: amount }],
    };
    setEntries((prev) => [...prev, entry]);
    setDeferrals((prev) => [...prev, {
      id: uid(), type: form.type, label: form.label.trim(), account: selectedAccount, counterAccount,
      startDate: form.startDate, months, totalAmount: amount, amountRecognized: 0, lastRecognitionDate: null, createdAt: new Date().toISOString(),
    }]);
    logAudit("Comptabilité", form.type === "charge" ? "Charge constatée d'avance" : "Produit constaté d'avance", `${form.label} : ${fmt(amount)}`);
    showToast("Régularisation enregistrée.");
    setForm({ type: form.type, label: "", startDate: todayStr(), months: "12", totalAmount: "", account: "", paymentMode: "caisse" });
    };
    if (planTier !== "assisted") { commit(); return; }
    const anomalies = [];
    const sameAccountAmounts = deferrals.filter((d) => d.account === selectedAccount).map((d) => d.totalAmount);
    const amtAnomaly = detectAmountAnomaly(amount, sameAccountAmounts, accounts.find((a) => a.code === selectedAccount)?.name || selectedAccount);
    if (amtAnomaly) anomalies.push(amtAnomaly);
    if (months > 36) anomalies.push(`Durée d'étalement inhabituelle pour « ${form.label} » : ${months} mois — vérifiez la saisie.`);
    const signature = `deferral:${form.type}:${selectedAccount}:${amount}:${months}`;
    anomalyGate(signature, [...new Set(anomalies)], commit, showToast, () => {
      recordPendingRecommendation?.({
        companyId: _membership?.companyId,
        module: "comptabilite",
        anomalyText: anomalies.join(" "),
        correctionText: "Vérifiez le montant et la durée saisis pour cette régularisation.",
        entryRef: form.label,
        createdByEmail: currentUserEmail,
      });
    });
  };

  const generateRecognitions = () => {
    let count = 0, total = 0;
    const newEntries = [];
    const updated = deferrals.map((d) => {
      const remaining = d.totalAmount - (d.amountRecognized || 0);
      if (remaining <= 0) return d;
      const monthlyRate = d.totalAmount / d.months;
      const since = d.lastRecognitionDate || d.startDate;
      const elapsed = monthsBetween(since, genDate);
      if (elapsed <= 0) return d;
      const amt = Math.min(remaining, Math.round(monthlyRate * elapsed * 100) / 100);
      if (amt <= 0) return d;
      newEntries.push({
        id: uid(), date: genDate, createdAt: new Date().toISOString(),
        label: `Reclassement ${d.type === "charge" ? "charge" : "produit"} d'avance — ${d.label}`,
        lines: d.type === "charge"
          ? [{ account: d.account, debit: amt, credit: 0 }, { account: d.counterAccount, debit: 0, credit: amt }]
          : [{ account: d.counterAccount, debit: amt, credit: 0 }, { account: d.account, debit: 0, credit: amt }],
      });
      count += 1; total += amt;
      return { ...d, amountRecognized: (d.amountRecognized || 0) + amt, lastRecognitionDate: genDate };
    });
    if (count === 0) {
      showToast("Aucun reclassement à générer à cette date (déjà à jour, ou régularisations entièrement soldées).");
      return;
    }
    setEntries((prev) => [...prev, ...newEntries]);
    setDeferrals(updated);
    logAudit("Comptabilité", "Génération reclassements charges/produits d'avance", `${count} régularisation(s), total ${fmt(total)}`);
    showToast(`${count} reclassement(s) généré(s), total ${fmt(total)}.`);
  };

  return (
    <div className="space-y-6">
      {canEdit && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Nouvelle régularisation</div>
          <div className="flex gap-2 mb-3">
            <button onClick={() => setForm({ ...form, type: "charge", account: "" })}
              className="px-3 py-1.5 rounded text-xs" style={{ background: form.type === "charge" ? "#152238" : "#F3EFE3", color: form.type === "charge" ? "#fff" : "#7A7460" }}>
              Charge constatée d'avance
            </button>
            <button onClick={() => setForm({ ...form, type: "produit", account: "" })}
              className="px-3 py-1.5 rounded text-xs" style={{ background: form.type === "produit" ? "#152238" : "#F3EFE3", color: form.type === "produit" ? "#fff" : "#7A7460" }}>
              Produit constaté d'avance
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Libellé</label>
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Ex. Assurance annuelle"
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Compte {form.type === "charge" ? "de charge" : "de produit"} final</label>
              <select value={selectedAccount} onChange={(e) => setForm({ ...form, account: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                {relevantAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Date de départ</label>
              <input type="date" value={form.startDate} max={todayStr()} onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Durée à étaler (mois)</label>
              <input type="number" min="1" value={form.months} onChange={(e) => setForm({ ...form, months: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Montant total</label>
              <input type="number" min="0" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} placeholder="0"
                className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>{form.type === "charge" ? "Règlement" : "Encaissement"}</label>
              <select value={form.paymentMode} onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="caisse">Caisse</option>
                <option value="banque">Banque</option>
                <option value="credit">{form.type === "charge" ? "À crédit (fournisseur à payer)" : "À recevoir (client)"}</option>
              </select>
            </div>
          </div>
          <button onClick={addDeferral} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238" }}>+ Enregistrer la régularisation</button>
        </div>
      )}

      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="text-sm font-medium" style={{ color: "#152238" }}>Registre des régularisations</div>
          {canEdit && deferrals.length > 0 && (
            <div className="flex items-end gap-2">
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Générer les reclassements jusqu'au</label>
                <input type="date" value={genDate} max={todayStr()} onChange={(e) => setGenDate(e.target.value)}
                  className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
              </div>
              <button onClick={generateRecognitions} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>Générer les reclassements</button>
            </div>
          )}
        </div>
        {deferrals.length === 0 ? (
          <div className="text-xs py-4 text-center" style={{ color: "#A39C87" }}>Aucune régularisation enregistrée.</div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,34,56,0.08)" }}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#A8D4C4" }}>
                <th className="py-2 px-3 text-left font-medium" style={{ color: "#0F6B5C", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Libellé</th>
                <th className="py-2 px-3 text-left font-medium" style={{ color: "#0F6B5C", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Type</th>
                <th className="py-2 px-3 text-right font-medium" style={{ color: "#0F6B5C", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Montant total</th>
                <th className="py-2 px-3 text-right font-medium" style={{ color: "#0F6B5C", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Déjà reclassé</th>
                <th className="py-2 px-3 text-right font-medium" style={{ color: "#0F6B5C", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Restant</th>
                <th className="py-2 px-3 text-right font-medium" style={{ color: "#0F6B5C", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Mois à compter</th>
              </tr>
            </thead>
            <tbody>
              {deferrals.map((d) => {
                const remaining = d.totalAmount - (d.amountRecognized || 0);
                const since = d.lastRecognitionDate || d.startDate;
                const monthsToCount = remaining > 0 ? monthsBetween(since, genDate) : 0;
                return (
                  <tr key={d.id}>
                    <td className="py-2 pl-3 pr-1" style={{ color: "#152238", borderLeft: `3px solid ${d.type === "charge" ? "#D85A30" : "#639922"}` }}>{d.label}</td>
                    <td className="py-2 px-3" style={{ color: "#152238" }}>{d.type === "charge" ? "Charge" : "Produit"}</td>
                    <td className="py-2 px-3 tabular text-right" style={{ color: "#152238" }}>{fmt(d.totalAmount)}</td>
                    <td className="py-2 px-3 tabular text-right" style={{ color: "#152238" }}>{fmt(d.amountRecognized || 0)}</td>
                    <td className="py-2 px-3 tabular text-right font-medium" style={{ color: "#152238" }}>{fmt(remaining)}</td>
                    <td className="py-2 px-3 tabular text-right" style={{ color: monthsToCount > 0 ? "#152238" : "#A39C87" }}>{monthsToCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          </div>
        )}
      </div>
    </div>
  );
}

// Provisions pour risques et charges (litiges, garanties...) — même principe que la
// dépréciation de stock ou la provision créance douteuse : on saisit le montant
// actuellement estimé du risque, et seul l'écart avec la provision déjà existante
// génère une dotation (le risque s'aggrave) ou une reprise (le risque diminue ou se
// résout), jamais le montant total à chaque réévaluation.
function RiskProvisionsPanel({ accounts, riskProvisions, setRiskProvisions, entries, setEntries, role, showToast, logAudit, planTier, recordPendingRecommendation, currentUserEmail }) {
  const canEdit = role !== "Vendeur";
  const [form, setForm] = useState({ label: "", date: todayStr(), amount: "" });
  const [drafts, setDrafts] = useState({}); // { [provisionId]: "nouvelle estimation en cours de saisie" }
  const anomalyGate = useAssistedAnomalyGate();

  const addProvision = () => {
    const amount = Number(form.amount);
    if (!form.label.trim() || !(amount > 0)) {
      showToast("Renseignez un libellé et un montant estimé valides.");
      return;
    }
    const commit = () => {
      const entry = {
        id: uid(), date: form.date, createdAt: new Date().toISOString(),
        label: `Dotation provision pour risque — ${form.label}`,
        lines: [{ account: "6815", debit: amount, credit: 0 }, { account: "151", debit: 0, credit: amount }],
      };
      setEntries((prev) => [...prev, entry]);
      setRiskProvisions((prev) => [...prev, { id: uid(), label: form.label.trim(), date: form.date, currentAmount: amount, status: "en_cours", createdAt: new Date().toISOString() }]);
      logAudit("Comptabilité", "Provision pour risque", `${form.label} : ${fmt(amount)}`);
      showToast("Provision enregistrée.");
      setForm({ label: "", date: todayStr(), amount: "" });
    };
    if (planTier !== "assisted") { commit(); return; }
    const anomalies = [];
    const amtAnomaly = detectAmountAnomaly(amount, riskProvisions.map((p) => p.currentAmount), "provisions pour risques");
    if (amtAnomaly) anomalies.push(amtAnomaly);
    const signature = `riskprov:${form.label}:${amount}`;
    anomalyGate(signature, [...new Set(anomalies)], commit, showToast, () => {
      recordPendingRecommendation?.({
        companyId: _membership?.companyId,
        module: "comptabilite",
        anomalyText: anomalies.join(" "),
        correctionText: "Vérifiez le montant estimé de cette provision.",
        entryRef: form.label,
        createdByEmail: currentUserEmail,
      });
    });
  };

  const reassessProvision = (provision) => {
    const draft = drafts[provision.id];
    if (draft === undefined || draft === "") return;
    const newAmount = Number(draft);
    if (!(newAmount >= 0)) { showToast("Le nouveau montant doit être un nombre positif ou nul."); return; }
    const delta = newAmount - provision.currentAmount;
    if (Math.round(delta * 100) === 0) { showToast("Aucun changement pour ce montant."); return; }
    const isDotation = delta > 0;
    const entry = {
      id: uid(), date: todayStr(), createdAt: new Date().toISOString(),
      label: `${isDotation ? "Dotation" : "Reprise"} provision pour risque — ${provision.label}`,
      lines: isDotation
        ? [{ account: "6815", debit: delta, credit: 0 }, { account: "151", debit: 0, credit: delta }]
        : [{ account: "151", debit: -delta, credit: 0 }, { account: "7815", debit: 0, credit: -delta }],
    };
    setEntries((prev) => [...prev, entry]);
    setRiskProvisions((prev) => prev.map((p) => (p.id === provision.id ? { ...p, currentAmount: newAmount, status: newAmount === 0 ? "close" : "en_cours" } : p)));
    logAudit("Comptabilité", isDotation ? "Dotation provision risque" : "Reprise provision risque", `${provision.label} : ${fmt(Math.abs(delta))}`);
    showToast(`${isDotation ? "Dotation" : "Reprise"} enregistrée : ${fmt(Math.abs(delta))}.`);
    setDrafts((prev) => ({ ...prev, [provision.id]: undefined }));
  };

  const closeProvision = (provision) => {
    if (!(provision.currentAmount > 0)) return;
    if (!window.confirm(`Clôturer entièrement la provision « ${provision.label} » ? Une reprise totale de ${fmt(provision.currentAmount)} sera enregistrée.`)) return;
    const delta = -provision.currentAmount;
    const entry = {
      id: uid(), date: todayStr(), createdAt: new Date().toISOString(),
      label: `Reprise provision pour risque — ${provision.label}`,
      lines: [{ account: "151", debit: -delta, credit: 0 }, { account: "7815", debit: 0, credit: -delta }],
    };
    setEntries((prev) => [...prev, entry]);
    setRiskProvisions((prev) => prev.map((p) => (p.id === provision.id ? { ...p, currentAmount: 0, status: "close" } : p)));
    logAudit("Comptabilité", "Clôture provision risque", `${provision.label} : ${fmt(-delta)}`);
    showToast(`Provision clôturée, reprise de ${fmt(-delta)} enregistrée.`);
  };

  const active = riskProvisions.filter((p) => p.status !== "close");
  const closed = riskProvisions.filter((p) => p.status === "close");

  return (
    <div className="space-y-6">
      {canEdit && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Nouvelle provision pour risque</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Libellé</label>
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Ex. Litige client Dupont"
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Date</label>
              <input type="date" value={form.date} max={todayStr()} onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Montant estimé</label>
              <input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0"
                className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
          </div>
          <button onClick={addProvision} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238" }}>+ Enregistrer la provision</button>
        </div>
      )}

      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Provisions en cours ({active.length})</div>
        {active.length === 0 ? (
          <div className="text-xs py-4 text-center" style={{ color: "#A39C87" }}>Aucune provision en cours.</div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,34,56,0.08)" }}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#A8D4C4" }}>
                <th className="py-2 px-3 text-left font-medium" style={{ color: "#0F6B5C", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Libellé</th>
                <th className="py-2 px-3 text-left font-medium" style={{ color: "#0F6B5C", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Date</th>
                <th className="py-2 px-3 text-right font-medium" style={{ color: "#0F6B5C", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Provision actuelle</th>
                <th className="py-2 px-3 text-right font-medium" style={{ color: "#0F6B5C", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Nouvelle estimation</th>
                <th className="py-2 px-3"></th>
              </tr>
            </thead>
            <tbody>
              {active.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 pl-3 pr-1" style={{ color: "#152238", borderLeft: "3px solid #1D9E75" }}>{p.label}</td>
                  <td className="py-2 px-3 tabular" style={{ color: "#152238" }}>{p.date}</td>
                  <td className="py-2 px-3 tabular text-right font-medium" style={{ color: "#152238" }}>{fmt(p.currentAmount)}</td>
                  <td className="py-2 px-3 text-right">
                    {canEdit ? (
                      <input type="number" min="0" placeholder={String(p.currentAmount)}
                        value={drafts[p.id] ?? ""} onChange={(e) => setDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        className="w-24 border rounded px-2 py-1 text-xs tabular text-right" style={{ borderColor: "#DDD6C4" }} />
                    ) : "—"}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {canEdit && (
                      <>
                        <button onClick={() => reassessProvision(p)} className="text-xs underline mr-2" style={{ color: "#152238" }}>Enregistrer</button>
                        <button onClick={() => closeProvision(p)} className="text-xs underline" style={{ color: "#A6432F" }}>Clôturer</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
          </div>
        )}
      </div>

      {closed.length > 0 && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Clôturées ({closed.length})</div>
          <div className="space-y-1">
            {closed.map((p) => (
              <div key={p.id} className="text-sm p-2 rounded" style={{ border: "1px solid #F3EFE3", color: "#8A8370" }}>{p.label} — clôturée</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


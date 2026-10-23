// ═══ MODULE ═══
// @module Achats
// @depends AssistedPrincipleReminder, CheckCircle2, ChequeDialog, History, Pencil
//   PendingRecommendationsBanner, Plus, RecordedStamp, RotateCcw, TAX_SYSTEMS, Trash2, X
//   _membership, cleanSuggestionLabel, detectAmountAnomaly, detectDuplicateAnomaly
//   detectRareAccountAnomaly, fmt, isFutureDate, isLocked, makeChequeRecord, normalizeClientName
//   simpleEntry, suggestAccountFromHistory, todayStr, uid, useAssistedAnomalyGate, useBackNav
//   useEffect, useState
// @exports AchatModule, ProductHistoryModal
// ═══ FIN DE L'EN-TÊTE ═══
// Modal d'historique produit — réutilisé depuis Vente (POS/Catalogue) et Achat et
// fournisseurs, pour afficher tous les mouvements (achats reçus, ventes, pertes,
// dons, ajustements) d'un même produit, du plus récent au plus ancien.
function ProductHistoryModal({ productId, products, movements, onClose }) {
  const product = products.find((p) => p.id === productId);
  const productMovements = movements
    .filter((m) => m.productId === productId)
    .slice()
    .sort((a, b) => (b.createdAt || b.date || "").localeCompare(a.createdAt || a.date || ""));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(21,34,56,0.5)" }} onClick={onClose}>
      <div className="bg-white rounded-lg p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-medium" style={{ color: "#152238" }}>Historique — {product?.name || "Produit"}</div>
          <button onClick={onClose} style={{ color: "#8A8370" }}><X size={16} /></button>
        </div>
        <div className="text-xs mb-4" style={{ color: "#8A8370" }}>Stock actuel : {product?.stock ?? 0} — Coût moyen : {fmt(product?.costPrice || 0)}</div>
        {productMovements.length === 0 ? (
          <div className="text-xs py-4 text-center" style={{ color: "#A39C87" }}>Aucun mouvement enregistré pour ce produit.</div>
        ) : (
          <div className="space-y-2">
            {productMovements.map((m) => (
              <div key={m.id} className="flex items-center justify-between text-sm p-2 rounded" style={{ border: "1px solid #F3EFE3" }}>
                <div>
                  <div>{m.reason}</div>
                  <div className="text-xs" style={{ color: "#A39C87" }}>{m.date}</div>
                </div>
                <div className="tabular font-medium" style={{ color: m.type === "sortie" ? "#A6432F" : "#0F6B5C" }}>
                  {m.type === "sortie" ? "−" : "+"}{m.qty}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AchatModule({ cheques, setCheques, accounts, entries, setEntries, suppliers, setSuppliers, purchases, setPurchases, products, setProducts, movements, setMovements, settings, role, showToast, logAudit, verifyTransactionSaved, planTier, recordPendingRecommendation, currentUserEmail, pendingRecommendations, resolvePendingRecommendation }) {
  const anomalyGate = useAssistedAnomalyGate();
  const hasPendingAchat = (pendingRecommendations || []).some((r) => r.module === "achat");
  const lastSubmitRef = React.useRef(0); // anti double-clic/double-tap sur "Enregistrer l'achat"
  const [tab, setTab] = useState("achats");
  useBackNav(tab, setTab, "achats");
  const chargeAccounts = accounts.filter((a) => a.type === "Charge");
  const accountName = (code) => accounts.find((a) => a.code === code)?.name || code;
  const [form, setForm] = useState({
    date: todayStr(),
    supplierId: suppliers[0]?.id,
    label: "",
    account: chargeAccounts[0]?.code,
    amount: "",
    paymentMode: "credit", // caisse | banque | credit
  });
  const [newSupplier, setNewSupplier] = useState({ name: "", contact: "", nif: "" });
  // Les listes (fournisseurs, comptes) peuvent arriver après le premier affichage : la liste
  // déroulante montrait alors le premier élément, mais le formulaire n'avait aucune valeur
  // réelle (choisir l'élément déjà affiché ne déclenche aucun changement) -> achat enregistré
  // sous « Fournisseur ». On remplit donc la valeur par défaut dès que la liste existe.
  const effSupplierId = form.supplierId || suppliers[0]?.id;
  const effAccount = form.account || chargeAccounts[0]?.code;
  useEffect(() => {
    setForm((prev) => (prev.supplierId && prev.account) ? prev : { ...prev, supplierId: prev.supplierId || suppliers[0]?.id, account: prev.account || chargeAccounts[0]?.code });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suppliers, accounts]);
  // Fondation pour la future méthode de valorisation du stock (coût moyen pondéré) :
  // un achat de marchandise peut désormais détailler ligne par ligne quel produit,
  // en quelle quantité et à quel coût unitaire — au lieu d'un simple montant global.
  // Le comportement comptable actuel (débit du compte choisi) reste inchangé pour
  // l'instant ; seule l'information produit/quantité/coût est désormais capturée et
  // sert à recalculer le coût moyen pondéré de chaque produit reçu.
  // TCA déductible sur les achats (articles 187 et 190 du Code fiscal) : pour une entreprise dont le régime de taxe est
  // activé (et qui n'est pas en franchise), la TCA payée à un fournisseur se saisit à part. Le « montant » reste hors
  // taxe (charge ou stock) ; la fiche d'achat porte le total à payer (HT + TCA) et l'écriture débite le compte 4456.
  const taxDeductActive = settings.taxSystem !== "aucune" && !settings.tcaFranchise;
  const taxShort = (TAX_SYSTEMS[settings.taxSystem] && TAX_SYSTEMS[settings.taxSystem].label) || "TCA";
  const [tcaDeduct, setTcaDeduct] = useState("");
  const [supplierInvNo, setSupplierInvNo] = useState("");
  const [purchaseKind, setPurchaseKind] = useState("simple"); // "simple" | "marchandise"
  const [purchaseLines, setPurchaseLines] = useState([]); // [{ productId, qty, unitCost }]
  const [purchaseProductPick, setPurchaseProductPick] = useState("");
  const [purchaseFreight, setPurchaseFreight] = useState(""); // frais d'approche (transport, douane, manutention) répartis dans le coût des produits
  const merchandiseProducts = (products || []).filter((p) => p.type === "marchandise");
  const purchaseLinesTotal = purchaseLines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.unitCost || 0), 0);
  const purchaseFreightNum = Math.max(0, Number(purchaseFreight) || 0);
  const purchaseGrandTotal = purchaseLinesTotal + purchaseFreightNum;
  // Part des frais d'approche affectée à chaque ligne : au prorata de sa valeur
  // (ou de sa quantité si toutes les lignes sont à coût zéro). Le coût d'entrée d'un
  // produit = prix fournisseur + sa part de frais ÷ quantité (norme : coût d'acquisition).
  const freightShare = (l) => {
    if (!(purchaseFreightNum > 0)) return 0;
    const lv = Number(l.qty || 0) * Number(l.unitCost || 0);
    if (purchaseLinesTotal > 0) return purchaseFreightNum * lv / purchaseLinesTotal;
    const totalQty = purchaseLines.reduce((t, x) => t + Number(x.qty || 0), 0);
    return totalQty > 0 ? purchaseFreightNum * Number(l.qty || 0) / totalQty : 0;
  };
  const addPurchaseLine = () => {
    const product = merchandiseProducts.find((p) => String(p.id) === String(purchaseProductPick));
    if (!product) return;
    if (purchaseLines.some((l) => l.productId === product.id)) { showToast("Ce produit est déjà dans la liste — modifiez la ligne existante."); return; }
    setPurchaseLines((prev) => [...prev, { productId: product.id, qty: "1", unitCost: product.costPrice || "" }]);
    setPurchaseProductPick("");
  };
  const updatePurchaseLine = (productId, field, value) => {
    setPurchaseLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, [field]: value } : l)));
  };
  const removePurchaseLine = (productId) => setPurchaseLines((prev) => prev.filter((l) => l.productId !== productId));
  useEffect(() => {
    if (purchaseKind === "marchandise") {
      const account = settings.stockValuationMethod === "actif" ? "370" : "607";
      setForm((prev) => ({ ...prev, amount: purchaseGrandTotal > 0 ? String(Math.round(purchaseGrandTotal * 100) / 100) : "", account }));
    }
  }, [purchaseKind, purchaseGrandTotal, settings.stockValuationMethod]);
  // Applique la réception aux produits concernés : quantité en stock augmentée, et
  // coût moyen pondéré recalculé — (ancien stock × ancien coût + qté reçue × coût
  // reçu) ÷ (ancien stock + qté reçue). Un stock à 0 ou négatif prend simplement le
  // nouveau coût, sans division par une base inexistante.
  const applyPurchaseLinesToStock = (supplierName) => {
    const date = form.date || todayStr();
    const newMovements = purchaseLines.map((l) => {
      const product = merchandiseProducts.find((p) => p.id === l.productId);
      return {
        id: uid(), date, createdAt: new Date().toISOString(),
        productId: l.productId, productName: product?.name || "", type: "entree", qty: Number(l.qty) || 0,
        reason: `Achat — ${form.label || "Réception de marchandise"}${supplierName ? ` (${supplierName})` : ""}`,
      };
    });
    setMovements((prev) => [...prev, ...newMovements]);
    setProducts((prev) => prev.map((p) => {
      const line = purchaseLines.find((l) => l.productId === p.id);
      if (!line) return p;
      const qty = Number(line.qty) || 0;
      const unitCost = (Number(line.unitCost) || 0) + (qty > 0 ? freightShare(line) / qty : 0);
      const oldStock = Number(p.stock) || 0;
      const oldCost = Number(p.costPrice) || 0;
      const newStock = oldStock + qty;
      const newCost = newStock > 0 && oldStock > 0 ? ((oldStock * oldCost) + (qty * unitCost)) / newStock : unitCost;
      return { ...p, stock: newStock, costPrice: newCost };
    }));
  };
  const [editingPurchaseId, setEditingPurchaseId] = useState(null);
  const [editingSupplierId, setEditingSupplierId] = useState(null);
  const [achatFrom, setAchatFrom] = useState("");
  const [achatTo, setAchatTo] = useState("");
  const [achatSupplier, setAchatSupplier] = useState(""); // filtre par fournisseur
  const [historyProductPick, setHistoryProductPick] = useState("");
  const [historyProductId, setHistoryProductId] = useState(null);
  const achatFiltered = purchases.filter((p) =>
    (!achatFrom || p.date >= achatFrom) &&
    (!achatTo || p.date <= achatTo) &&
    (!achatSupplier || p.supplier === achatSupplier)
  );
  const achatFilteredTotal = achatFiltered.reduce((s, p) => s + Number(p.amount || 0), 0);
  // Récapitulatif par fournisseur (nombre de transactions par type d'achat, montant total)
  // affiché quand un fournisseur précis est sélectionné dans la liste déroulante.
  const achatSupplierSummary = achatSupplier
    ? (() => {
        const list = purchases.filter((p) => p.supplier === achatSupplier);
        const byType = list.reduce((acc, p) => {
          const key = p.account ? `${p.account} — ${accountName(p.account)}` : "Non catégorisé";
          if (!acc[key]) acc[key] = { count: 0, total: 0 };
          acc[key].count += 1;
          acc[key].total += Number(p.amount || 0);
          return acc;
        }, {});
        return { count: list.length, total: list.reduce((s, p) => s + Number(p.amount || 0), 0), byType };
      })()
    : null;
  const [achatOpenId, setAchatOpenId] = useState(null);

  const addPurchase = () => {
    if (Date.now() - lastSubmitRef.current < 800) return;
    lastSubmitRef.current = Date.now();
    if (hasPendingAchat) {
      showToast("Traitez d'abord la recommandation en attente ci-dessus avant d'enregistrer un nouvel achat.");
      return;
    }
    if (purchaseKind === "marchandise" && !editingPurchaseId) {
      if (purchaseLines.length === 0) {
        showToast("Ajoutez au moins un produit reçu avant d'enregistrer cet achat.");
        return;
      }
      if (purchaseLines.some((l) => !(Number(l.qty) > 0) || !(Number(l.unitCost) >= 0))) {
        showToast("Chaque ligne doit avoir une quantité et un coût unitaire valides.");
        return;
      }
    }
    if (!form.label || !form.amount || Number(form.amount) <= 0) {
      showToast("Renseignez un libellé et un montant valide.");
      return;
    }
    const tcaNum = taxDeductActive ? Math.round(Math.max(0, Number(tcaDeduct) || 0) * 100) / 100 : 0;
    if (tcaNum > Number(form.amount) + 0.005) {
      showToast(`La ${taxShort} déductible ne peut pas dépasser le montant hors taxe de l'achat.`);
      return;
    }
    const amountHT = Math.round(Number(form.amount) * 100) / 100;
    const amountTotal = Math.round((amountHT + tcaNum) * 100) / 100;
    if (isFutureDate(form.date)) {
      showToast("Impossible d'enregistrer un achat à une date future.");
      return;
    }
    if (isLocked(form.date, settings)) {
      showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Impossible d'enregistrer un achat à cette date.`);
      return;
    }
    if (editingPurchaseId) {
      const old0 = purchases.find((x) => x.id === editingPurchaseId);
      if (old0?.status === "annulé") {
        showToast("Cet achat est annulé et ne peut plus être modifié.");
        return;
      }
      if (old0 && isLocked(old0.date, settings)) {
        showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Cet achat ne peut plus être modifié.`);
        return;
      }
    }
    const supplier = suppliers.find((s) => s.id === Number(effSupplierId));
    const payAccount = form.paymentMode === "caisse" ? "530" : form.paymentMode === "banque" ? "512" : "401";
    const label = `Achat — ${form.label} (${supplier?.name || "Fournisseur"})`;
    // Écriture d'achat : sans taxe déductible, l'écriture simple d'origine ; avec taxe : charge HT + 4456 au débit, règlement du total TTC au crédit.
    const buildPurchaseEntry = () => (tcaNum > 0
      ? { date: form.date, createdAt: new Date().toISOString(), label, lines: [
          { account: effAccount, debit: amountHT, credit: 0 },
          { account: "4456", debit: tcaNum, credit: 0 },
          { account: payAccount, debit: 0, credit: amountTotal },
        ] }
      : simpleEntry(form.date, label, effAccount, payAccount, Number(form.amount)));
    const taxFields = tcaNum > 0 ? { amountHT, tcaDeductible: tcaNum, supplierInvoiceNo: (supplierInvNo || "").trim() || undefined }
      : { amountHT: undefined, tcaDeductible: undefined, supplierInvoiceNo: (supplierInvNo || "").trim() || undefined };

    const commitPurchase = () => {
    if (editingPurchaseId) {
      const purchaseEntry = { ...buildPurchaseEntry(), id: editingPurchaseId };
      const updatedPurchase = { ...taxFields, supplier: supplier?.name || "Fournisseur", date: form.date, label: form.label, amount: amountTotal, paymentMode: form.paymentMode, status: form.paymentMode === "credit" ? "à payer" : "payé" };
      setEntries((prev) => prev.map((e) => (e.id === editingPurchaseId ? purchaseEntry : e)));
      setPurchases((prev) => prev.map((p) => (p.id === editingPurchaseId ? { ...p, ...updatedPurchase } : p)));
      setEditingPurchaseId(null);
      showToast("Achat modifié.");
      logAudit("Achat", "Modification achat", `${form.label} — ${fmt(Number(form.amount))} (${supplier?.name || "Fournisseur"})`);
      verifyTransactionSaved(`Achat ${form.label}`, [
        { category: "entries", label: "écriture d'achat", isPresent: (arr) => { const e = arr.find((x) => x.id === editingPurchaseId); return e && e.label === purchaseEntry.label; }, buildNext: () => entries.map((e) => (e.id === editingPurchaseId ? purchaseEntry : e)) },
        { category: "purchases", label: "fiche d'achat", isPresent: (arr) => { const p = arr.find((x) => x.id === editingPurchaseId); return p && p.amount === updatedPurchase.amount; }, buildNext: () => purchases.map((p) => (p.id === editingPurchaseId ? { ...p, ...updatedPurchase } : p)) },
      ], { showToast, logAudit });
    } else {
      const purchaseId = uid();
      const purchaseEntry = { ...buildPurchaseEntry(), id: purchaseId };
      const newPurchase = {
        id: purchaseId,
        date: form.date,
        createdAt: new Date().toISOString(),
        supplier: supplier?.name || "Fournisseur",
        label: form.label,
        amount: amountTotal,
        ...(tcaNum > 0 ? { amountHT, tcaDeductible: tcaNum } : {}),
        ...(taxFields.supplierInvoiceNo ? { supplierInvoiceNo: taxFields.supplierInvoiceNo } : {}),
        paymentMode: form.paymentMode,
        status: form.paymentMode === "credit" ? "à payer" : "payé",
        lines: purchaseKind === "marchandise" ? purchaseLines.map((l) => ({ productId: l.productId, qty: Number(l.qty), unitCost: Number(l.unitCost) })) : undefined,
        freight: purchaseKind === "marchandise" && purchaseFreightNum > 0 ? Math.round(purchaseFreightNum * 100) / 100 : undefined,
      };
      if (purchaseKind === "marchandise") applyPurchaseLinesToStock(supplier?.name);
      setEntries((prev) => [...prev, purchaseEntry]);
      setPurchases((prev) => [...prev, newPurchase]);
      showToast("Achat enregistré.");
      logAudit("Achat", "Ajout achat", `${form.label} — ${fmt(Number(form.amount))} (${supplier?.name || "Fournisseur"})`);
      verifyTransactionSaved(`Achat ${form.label}`, [
        { category: "entries", label: "écriture d'achat", isPresent: (arr) => arr.some((e) => e.id === purchaseId), buildNext: () => [...entries, purchaseEntry] },
        { category: "purchases", label: "fiche d'achat", isPresent: (arr) => arr.some((p) => p.id === purchaseId), buildNext: () => [...purchases, newPurchase] },
      ], { showToast, logAudit });
    }
    setForm({ ...form, label: "", amount: "" });
    setTcaDeduct(""); setSupplierInvNo("");
    setPurchaseLines([]); setPurchaseFreight(""); setPurchaseKind("simple");
    };
    if (planTier !== "assisted" || editingPurchaseId) { commitPurchase(); return; }
    const usageCounts = {};
    const amountsForAccount = [];
    for (const e of entries) {
      for (const l of e.lines) usageCounts[l.account] = (usageCounts[l.account] || 0) + 1;
      if (e.lines.some((l) => l.account === effAccount)) {
        amountsForAccount.push(e.lines.reduce((s, l) => s + l.debit + l.credit, 0) / 2);
      }
    }
    const anomalies = [];
    const corrections = [];
    const acc = accounts.find((a) => a.code === effAccount);
    const rare = detectRareAccountAnomaly(effAccount, usageCounts, acc?.name);
    if (rare) { anomalies.push(rare); corrections.push(`Si le compte ${acc?.name || effAccount} est erroné : annulez cet achat (contrepassation) puis ressaisissez-le avec le bon compte.`); }
    const amt = detectAmountAnomaly(Number(form.amount), amountsForAccount, acc?.name || effAccount);
    if (amt) { anomalies.push(amt); corrections.push("Si le montant est erroné : annulez cet achat (contrepassation) puis ressaisissez-le avec le montant correct."); }
    const dup = detectDuplicateAnomaly(
      { amount: Number(form.amount), date: form.date, label: form.label },
      purchases.slice(-50).map((p) => ({ amount: p.amount, date: p.date, label: p.label }))
    );
    if (dup) { anomalies.push(dup); corrections.push("Vérifiez les deux achats : si l'un est bien un doublon, annulez-le par contrepassation."); }
    const signature = `purchase:${form.date}:${form.label}:${effAccount}:${form.amount}:${form.supplierId}`;
    anomalyGate(signature, [...new Set(anomalies)], commitPurchase, showToast, () => {
      recordPendingRecommendation?.({
        companyId: _membership?.companyId,
        module: "achat",
        anomalyText: anomalies.join(" "),
        correctionText: [...new Set(corrections)].join(" "),
        entryRef: form.label,
        createdByEmail: currentUserEmail,
      });
    });
  };

  const startEditPurchase = (p) => {
    if (p.status === "annulé") {
      showToast("Cet achat est annulé et ne peut plus être modifié.");
      return;
    }
    if (Number(p.returnedAmount) > 0) {
      showToast("Un retour fournisseur est enregistré sur cet achat : il ne peut plus être modifié.");
      return;
    }
    if (isLocked(p.date, settings)) {
      showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Cet achat ne peut plus être modifié.`);
      return;
    }
    const supplier = suppliers.find((s) => s.name === p.supplier);
    setPurchaseKind("simple"); setPurchaseLines([]); setPurchaseFreight("");
    setEditingPurchaseId(p.id);
    setForm({
      date: p.date,
      supplierId: supplier?.id ?? suppliers[0]?.id,
      label: p.label,
      account: entries.find((e) => e.id === p.id)?.lines?.find((l) => l.debit > 0)?.account || chargeAccounts[0]?.code,
      amount: p.amountHT != null ? p.amountHT : p.amount,
      paymentMode: p.paymentMode,
    });
    setTcaDeduct(p.tcaDeductible ? String(p.tcaDeductible) : "");
    setSupplierInvNo(p.supplierInvoiceNo || "");
  };

  const cancelEditPurchase = () => {
    setEditingPurchaseId(null);
    setForm({ ...form, label: "", amount: "" });
    setTcaDeduct(""); setSupplierInvNo("");
  };

  const cancelPurchase = (p) => {
    if (role !== "Administrateur") {
      showToast("Seul un administrateur peut annuler un achat validé.");
      return;
    }
    if (Number(p.returnedAmount) > 0) {
      showToast("Un retour fournisseur est enregistré sur cet achat : il ne peut pas être annulé directement.");
      return;
    }
    if (p.status === "annulé") {
      showToast("Cet achat est déjà annulé.");
      return;
    }
    if (isLocked(p.date, settings)) {
      showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Cet achat ne peut plus être annulé sans rouvrir la période.`);
      return;
    }
    const activeCheque = (cheques || []).find((c) => c.kind === "emis" && c.purchaseId === p.id && c.status !== "annule");
    if (activeCheque) {
      showToast(`Cet achat a été payé par le chèque n° ${activeCheque.number}. Annulez d'abord ce chèque (Caisse et banque → Chèques → « Annuler ») : la dette sera rétablie, puis vous pourrez annuler l'achat si besoin.`);
      return;
    }
    const msg = p.status === "payé" && p.paymentMode === "credit"
      ? "Annuler cet achat ? Une écriture de contrepassation sera générée pour l'écriture d'origine. Un paiement déjà enregistré séparément dans le journal ne sera pas contrepassé automatiquement — vérifiez le journal comptable."
      : "Annuler cet achat ? Une écriture de contrepassation sera générée et l'achat restera visible dans l'historique avec le statut « annulé ».";
    if (!window.confirm(msg)) return;
    const today = todayStr();
    const original = entries.find((e) => e.id === p.id);
    let reversal = null;
    if (original) {
      reversal = {
        id: uid(),
        date: today,
        createdAt: new Date().toISOString(),
        label: `Annulation achat — ${p.label} (${p.supplier})`,
        lines: original.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })),
      };
      setEntries((prev) => [...prev, reversal]);
    }
    setPurchases((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: "annulé" } : x)));
    if (editingPurchaseId === p.id) cancelEditPurchase();
    showToast("Achat annulé par contrepassation.");
    logAudit("Achat", "Annulation achat (contrepassation)", `${p.label} — ${fmt(p.amount)}`);
    verifyTransactionSaved(`Annulation achat ${p.label}`, [
      { category: "purchases", label: "statut annulé", isPresent: (arr) => { const x = arr.find((y) => y.id === p.id); return x && x.status === "annulé"; }, buildNext: () => purchases.map((x) => (x.id === p.id ? { ...x, status: "annulé" } : x)) },
      ...(reversal ? [{ category: "entries", label: "écriture de contrepassation", isPresent: (arr) => arr.some((e) => e.id === reversal.id), buildNext: () => [...entries, reversal] }] : []),
    ], { showToast, logAudit });
  };

  const addSupplier = () => {
    if (!newSupplier.name) {
      showToast("Le nom du fournisseur est requis.");
      return;
    }
    if (editingSupplierId) {
      const oldName = suppliers.find((s) => s.id === editingSupplierId)?.name;
      const renamed = oldName && oldName !== newSupplier.name;
      setSuppliers((prev) => prev.map((s) => (s.id === editingSupplierId ? { ...s, ...newSupplier } : s)));
      if (renamed) {
        setPurchases((prev) => prev.map((p) => (p.supplier === oldName ? { ...p, supplier: newSupplier.name } : p)));
      }
      setEditingSupplierId(null);
      showToast("Fournisseur modifié.");
      logAudit("Achat", "Modification fournisseur", newSupplier.name);
      if (renamed) {
        verifyTransactionSaved(`Renommage fournisseur ${newSupplier.name}`, [
          { category: "suppliers", label: "fiche fournisseur", isPresent: (arr) => { const s = arr.find((x) => x.id === editingSupplierId); return s && s.name === newSupplier.name; }, buildNext: () => suppliers.map((s) => (s.id === editingSupplierId ? { ...s, ...newSupplier } : s)) },
          { category: "purchases", label: "achats renommés", isPresent: (arr) => !arr.some((p) => p.supplier === oldName), buildNext: () => purchases.map((p) => (p.supplier === oldName ? { ...p, supplier: newSupplier.name } : p)) },
        ], { showToast, logAudit });
      }
    } else {
      setSuppliers((prev) => [...prev, { ...newSupplier, id: uid(), createdAt: new Date().toISOString() }]);
      showToast("Fournisseur ajouté.");
      logAudit("Achat", "Ajout fournisseur", newSupplier.name);
    }
    setNewSupplier({ name: "", contact: "", nif: "" });
  };

  const startEditSupplier = (s) => {
    setEditingSupplierId(s.id);
    setNewSupplier({ name: s.name, contact: s.contact || "", nif: s.nif || "" });
  };

  const cancelEditSupplier = () => {
    setEditingSupplierId(null);
    setNewSupplier({ name: "", contact: "", nif: "" });
  };

  const deleteSupplier = (s) => {
    const hasPurchases = purchases.some((p) => p.supplier === s.name);
    const msg = hasPurchases
      ? `Supprimer « ${s.name} » ? Des achats existants restent associés à ce nom de fournisseur.`
      : `Supprimer le fournisseur « ${s.name} » ?`;
    if (!window.confirm(msg)) return;
    setSuppliers((prev) => prev.filter((x) => x.id !== s.id));
    if (editingSupplierId === s.id) cancelEditSupplier();
    showToast("Fournisseur supprimé.");
    logAudit("Achat", "Suppression fournisseur", s.name);
  };

  const [chequeDlg, setChequeDlg] = useState(null);
  const payerAchat = (p, compte, cheque) => {
    if (Date.now() - lastSubmitRef.current < 800) return; // double-clic/double-tap ignoré
    lastSubmitRef.current = Date.now();
    if (cheque) compte = "512"; // chèque émis : sort de la banque, suivi "en circulation"
    const today = todayStr();
    if (isLocked(today, settings)) {
      showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Impossible d'enregistrer un paiement aujourd'hui.`);
      return;
    }
    const payEntry = simpleEntry(today, `Paiement — ${p.label} (${p.supplier})${cheque ? ` — chèque n° ${cheque.number}` : ""}`, "401", compte, p.amount);
    if (cheque) payEntry.reconciled = false;
    setEntries((prev) => [...prev, payEntry]);
    setPurchases((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: "payé" } : x)));
    if (cheque && setCheques) {
      setCheques((prev) => [...prev, makeChequeRecord({ kind: "emis", number: cheque.number, bank: cheque.bank, party: p.supplier, amount: p.amount, date: today, entryIds: [payEntry.id], purchaseId: p.id })]);
      logAudit("Chèques", "Chèque émis enregistré", `${p.supplier} — n° ${cheque.number}`);
    }
    showToast(cheque ? `Achat payé par chèque n° ${cheque.number} (suivi dans Caisse et banque → Chèques).` : "Achat payé.");
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module 4</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Achat et fournisseurs</div>
        <p className="text-sm mt-1" style={{ color: "#7A7460" }}>
          Chaque achat génère automatiquement son écriture comptable (compte de charge ↔ 401/512/530).
        </p>
      </header>

      <div className="flex gap-1 mb-6 overflow-x-auto">
        {[["achats", "Achats"], ["fournisseurs", "Fournisseurs"], ["performance", "Performance"]].map(([id, label]) => (
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

      {tab === "achats" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          {!editingPurchaseId && (
            <div className="mb-5 flex gap-2">
              <button onClick={() => setPurchaseKind("simple")}
                className="px-3 py-1.5 rounded text-xs" style={{ background: purchaseKind === "simple" ? "#152238" : "#F3EFE3", color: purchaseKind === "simple" ? "#fff" : "#7A7460" }}>
                Achat divers (loyer, fournitures...)
              </button>
              <button onClick={() => setPurchaseKind("marchandise")}
                className="px-3 py-1.5 rounded text-xs" style={{ background: purchaseKind === "marchandise" ? "#152238" : "#F3EFE3", color: purchaseKind === "marchandise" ? "#fff" : "#7A7460" }}>
                Réception de marchandise (avec produits)
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5 items-end">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Date</label>
              <input type="date" value={form.date} max={todayStr()} onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Fournisseur</label>
              <select value={effSupplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs" style={{ color: "#8A8370" }}>Libellé</label>
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Ex : Achat fournitures de bureau"
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
              {planTier === "assisted" && form.label.trim().length >= 3 && (() => {
                const purchaseHistory = purchases.map((p) => {
                  const relatedEntry = entries.find((e) => e.id === p.id);
                  return { label: p.label, date: p.date, account: relatedEntry?.lines?.[0]?.account };
                }).filter((p) => p.account);
                const result = suggestAccountFromHistory(form.label, purchaseHistory.map((p) => ({ ...p, accountName: accounts.find((a) => a.code === p.account)?.name })));
                const options = result?.options || [];
                if (options.length === 0) return null;
                return (
                  <div className="text-xs mt-1.5" style={{ color: "#5B3FA0" }}>
                    {result.ambiguous && <div className="mb-1">💡 Plusieurs comptes utilisés pour des libellés similaires — choisissez :</div>}
                    {!result.ambiguous && options[0].account !== form.account && (
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span>💡 Suggestion : compte {options[0].account} ({options[0].accountName || ""}), d'après « {cleanSuggestionLabel(options[0].label)} »</span>
                        <button onClick={() => setForm((prev) => ({ ...prev, account: options[0].account }))} className="underline font-medium">Appliquer</button>
                      </div>
                    )}
                    {result.ambiguous && options.map((opt) => {
                      const isCurrent = opt.account === form.account;
                      return (
                        <div key={opt.account} className="flex items-center gap-2 flex-wrap mb-1">
                          <span>Compte {opt.account} ({opt.accountName || ""}), d'après « {cleanSuggestionLabel(opt.label)} »{isCurrent ? " — sélectionné" : ""}</span>
                          {!isCurrent && (
                            <button onClick={() => setForm((prev) => ({ ...prev, account: opt.account }))} className="underline font-medium">Appliquer</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            {purchaseKind === "simple" || editingPurchaseId ? (
              <>
                <div>
                  <label className="text-xs" style={{ color: "#8A8370" }}>Compte de charge</label>
                  <select value={effAccount} onChange={(e) => setForm({ ...form, account: e.target.value })}
                    className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                    {chargeAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs" style={{ color: "#8A8370" }}>{taxDeductActive ? `Montant hors ${taxShort}` : "Montant"}</label>
                  <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder="0" className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
                </div>
              </>
            ) : (
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Montant total (calculé)</label>
                <div className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4", background: "#FAF8F1", color: "#7A7460" }}>{fmt(purchaseGrandTotal)}</div>
              </div>
            )}
          </div>

          {taxDeductActive && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5 p-3 rounded" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }}>
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>{taxShort} déductible payée au fournisseur (facultatif)</label>
                <input type="number" min="0" value={tcaDeduct} onChange={(e) => setTcaDeduct(e.target.value)} placeholder="0" data-testid="achat-tca"
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
              </div>
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>N° de la facture du fournisseur</label>
                <input value={supplierInvNo} onChange={(e) => setSupplierInvNo(e.target.value)} placeholder="Ex. F-2026-114" data-testid="achat-facture-fournisseur"
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
              </div>
              <div className="text-xs" style={{ color: "#7A7460" }} data-testid="achat-total-ttc">
                Total à payer au fournisseur : <span className="font-medium" style={{ color: "#152238" }}>{fmt(Math.round(((Number(form.amount) || 0) + (Math.max(0, Number(tcaDeduct) || 0))) * 100) / 100)}</span>
                <span className="block" style={{ color: "#A39C87" }}>La taxe n'est déductible que si elle figure sur une facture en règle du fournisseur (article 187). Elle est déduite de la {taxShort} collectée dans la déclaration mensuelle.</span>
              </div>
            </div>
          )}

          {purchaseKind === "marchandise" && !editingPurchaseId && (
            <div className="mb-5 p-4 rounded" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }}>
              <div className="text-xs font-medium mb-2" style={{ color: "#152238" }}>Produits reçus</div>
              <div className="flex flex-wrap gap-2 mb-3">
                <select value={purchaseProductPick} onChange={(e) => setPurchaseProductPick(e.target.value)}
                  className="flex-1 min-w-0 border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }}>
                  <option value="">Choisir un produit...</option>
                  {merchandiseProducts.filter((p) => !purchaseLines.some((l) => l.productId === p.id)).map((p) => (
                    <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                  ))}
                </select>
                <button onClick={addPurchaseLine} className="px-3 py-1.5 rounded text-xs text-white shrink-0" style={{ background: "#152238" }}>Ajouter</button>
              </div>
              {purchaseLines.length === 0 ? (
                <div className="text-xs py-2 text-center" style={{ color: "#A39C87" }}>Aucun produit ajouté pour l'instant.</div>
              ) : (
                <div className="space-y-2">
                  {purchaseLines.map((l) => {
                    const product = merchandiseProducts.find((p) => p.id === l.productId);
                    return (
                      <div key={l.productId} className="p-2 rounded" style={{ border: "1px solid #EEE9DA" }}>
                        <div className="text-sm mb-1.5 truncate">{product?.name || l.productId}</div>
                        <div className="flex items-center gap-2 flex-wrap text-sm">
                          <input type="number" min="0" value={l.qty} onChange={(e) => updatePurchaseLine(l.productId, "qty", e.target.value)}
                            placeholder="Qté" className="w-20 border rounded px-2 py-1 text-xs tabular" style={{ borderColor: "#DDD6C4" }} />
                          <input type="number" min="0" value={l.unitCost} onChange={(e) => updatePurchaseLine(l.productId, "unitCost", e.target.value)}
                            placeholder="Coût unit." className="w-24 border rounded px-2 py-1 text-xs tabular" style={{ borderColor: "#DDD6C4" }} />
                          <span className="tabular text-xs shrink-0" style={{ color: "#7A7460" }}>{fmt(Number(l.qty || 0) * Number(l.unitCost || 0))}</span>
                          <button onClick={() => removePurchaseLine(l.productId)} className="shrink-0 ml-auto" style={{ color: "#A6432F" }}><Trash2 size={14} /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="mt-3 pt-3" style={{ borderTop: "1px solid #EEE9DA" }}>
                <label className="text-xs" style={{ color: "#8A8370" }}>Frais d'approche (transport, douane, manutention) — facultatif</label>
                <input type="number" min="0" value={purchaseFreight} onChange={(e) => setPurchaseFreight(e.target.value)} placeholder="0"
                  className="block w-40 border rounded px-2 py-1 text-xs mt-1 tabular" style={{ borderColor: "#DDD6C4" }} data-testid="purchase-freight" />
                <div className="text-xs mt-1" style={{ color: "#A39C87" }}>Ces frais sont ajoutés au coût d'entrée des produits, au prorata de leur valeur : le coût moyen (et donc la marge) en tient compte.</div>
              </div>
            </div>
          )}
          <div className="mb-5">
            <label className="text-xs" style={{ color: "#8A8370" }}>Règlement</label>
            <select value={form.paymentMode} onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}
              className="border rounded px-2 py-1.5 text-sm mt-1 block" style={{ borderColor: "#DDD6C4" }}>
              <option value="credit">À crédit (fournisseur à payer)</option>
              <option value="caisse">Payé comptant — caisse</option>
              <option value="banque">Payé comptant — banque</option>
            </select>
          </div>
          <PendingRecommendationsBanner recommendations={pendingRecommendations} module="achat" onDismiss={resolvePendingRecommendation} />
          <AssistedPrincipleReminder planTier={planTier} text="Un achat à crédit augmente vos dettes fournisseurs (401), pas votre trésorerie — l'argent ne sort qu'au moment du règlement réel." />
          <button onClick={addPurchase} disabled={hasPendingAchat} className="flex items-center gap-2 px-4 py-2 rounded text-sm text-white mb-2" style={{ background: "#152238", opacity: hasPendingAchat ? 0.5 : 1 }}>
            {editingPurchaseId ? <CheckCircle2 size={14} /> : <Plus size={14} />}
            {editingPurchaseId ? "Enregistrer les modifications" : "Enregistrer l'achat"}
          </button>
          {editingPurchaseId && (
            <div className="flex items-center gap-2 mb-4 text-xs" style={{ color: "#A6432F" }}>
              Modification en cours.
              <button onClick={cancelEditPurchase} className="underline">Annuler</button>
            </div>
          )}
          {!editingPurchaseId && <div className="mb-6" />}

          <div className="flex items-center gap-2 mb-3" style={{ color: "#152238" }}>
            <History size={16} /><span className="font-medium text-sm">Historique des achats</span>
          </div>
          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Du</label>
              <input type="date" value={achatFrom} onChange={(e) => setAchatFrom(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
              <input type="date" value={achatTo} onChange={(e) => setAchatTo(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Fournisseur</label>
              <select value={achatSupplier} onChange={(e) => setAchatSupplier(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", width: "min(280px, 100%)", boxSizing: "border-box" }}>
                <option value="">Tous les fournisseurs</option>
                {suppliers.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            {(achatFrom || achatTo || achatSupplier) && (
              <button onClick={() => { setAchatFrom(""); setAchatTo(""); setAchatSupplier(""); }} className="text-xs underline mb-1.5" style={{ color: "#8A8370" }}>
                Réinitialiser
              </button>
            )}
            <div className="w-full sm:w-auto">
              <label className="text-xs" style={{ color: "#8A8370" }}>Historique d'un produit</label>
              <div className="flex flex-wrap gap-1 mt-1">
                <select value={historyProductPick} onChange={(e) => setHistoryProductPick(e.target.value)}
                  className="border rounded px-2 py-1.5 text-sm min-w-0" style={{ borderColor: "#DDD6C4", width: "min(220px, 100%)", boxSizing: "border-box" }}>
                  <option value="">Choisir un produit...</option>
                  {(products || []).filter((p) => p.type === "marchandise").map((p) => (
                    <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                  ))}
                </select>
                <button onClick={() => { if (historyProductPick) setHistoryProductId(Number(historyProductPick)); }}
                  disabled={!historyProductPick} className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded text-xs text-white" style={{ background: historyProductPick ? "#152238" : "#C7C0AD" }}>
                  <History size={13} /> Historique
                </button>
              </div>
            </div>
            {(achatFrom || achatTo || achatSupplier) && (
              <div className="tabular text-xs mb-1.5 ml-auto" style={{ color: "#152238" }}>
                {achatFiltered.length} achat{achatFiltered.length > 1 ? "s" : ""} · Total {fmt(achatFilteredTotal)}
              </div>
            )}
          </div>

          {achatSupplierSummary && (
            <div className="mb-4 p-3 rounded text-xs" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }}>
              <div className="font-medium mb-1.5" style={{ color: "#152238" }}>
                {achatSupplier} — {achatSupplierSummary.count} transaction{achatSupplierSummary.count > 1 ? "s" : ""} au total · {fmt(achatSupplierSummary.total)}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1" style={{ color: "#7A7460" }}>
                {Object.entries(achatSupplierSummary.byType).map(([type, v]) => (
                  <div key={type}>{type} : {v.count} transaction{v.count > 1 ? "s" : ""} · {fmt(v.total)}</div>
                ))}
              </div>
            </div>
          )}

          <div className="overflow-x-auto overflow-y-auto max-h-[65vh] border rounded" style={{ borderColor: "#EEE9DA" }}><table className="w-full text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-2 font-normal">Date</th>
                <th className="py-2 font-normal">Fournisseur</th>
                <th className="py-2 font-normal">Libellé</th>
                <th className="py-2 font-normal text-right">Montant</th>
                <th className="py-2 font-normal text-center">Statut</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {achatFiltered.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center" style={{ color: "#A39C87" }}>{purchases.length === 0 ? "Aucun achat enregistré." : "Aucun achat sur cette période."}</td></tr>
              )}
              {[...achatFiltered].reverse().map((p) => {
                const entry = entries.find((e) => e.id === p.id);
                const chargeLine = entry?.lines?.find((l) => l.debit > 0);
                return (
                <React.Fragment key={p.id}>
                <tr
                  onClick={() => setAchatOpenId(achatOpenId === p.id ? null : p.id)}
                  className="cursor-pointer"
                  style={{ borderBottom: "1px solid #F3EFE3", background: editingPurchaseId === p.id ? "#FAF8F1" : achatOpenId === p.id ? "#FAF8F1" : "transparent" }}>
                  <td className="py-2 tabular">{p.date}</td>
                  <td className="py-2">{p.supplier}</td>
                  <td className="py-2">{p.label}</td>
                  <td className="py-2 tabular text-right">{fmt(p.amount)}</td>
                  <td className="py-2 text-center">
                    <span className="text-xs px-2 py-0.5 rounded"
                      style={{
                        background: p.status === "annulé" ? "#EEE9DA" : p.status === "payé" ? "#E6F1EE" : "#F7E9E3",
                        color: p.status === "annulé" ? "#7A7460" : p.status === "payé" ? "#0F6B5C" : "#A6432F",
                        textDecoration: p.status === "annulé" ? "line-through" : "none",
                      }}>
                      {p.status}
                    </span>
                  </td>
                  <td className="py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1 justify-end items-center flex-wrap">
                      {p.status === "à payer" && (
                        <>
                          <button onClick={() => payerAchat(p, "530")} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Payer (caisse)</button>
                          <button onClick={() => payerAchat(p, "512")} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Payer (banque)</button>
                          {role !== "Vendeur" && <button onClick={() => setChequeDlg({ id: p.id })} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Payer (chèque)</button>}
                          {chequeDlg && chequeDlg.id === p.id && (
                            <ChequeDialog title="Chèque émis au fournisseur" partyLabel="Fournisseur" party={p.supplier}
                              onClose={() => setChequeDlg(null)}
                              onConfirm={(cq) => { setChequeDlg(null); payerAchat(p, "512", cq); }} />
                          )}
                        </>
                      )}
                      {p.status !== "annulé" && (
                        <button onClick={() => startEditPurchase(p)} title="Modifier" style={{ color: "#152238" }}><Pencil size={14} /></button>
                      )}
                      {role === "Administrateur" && p.status !== "annulé" && (
                        <button onClick={() => cancelPurchase(p)} title="Annuler (contrepassation)" style={{ color: "#A6432F" }}><RotateCcw size={14} /></button>
                      )}
                    </div>
                  </td>
                </tr>
                {achatOpenId === p.id && (
                  <tr>
                    <td colSpan={6} className="py-3 px-3" style={{ background: "#FAF8F1" }}>
                      <div className="text-xs uppercase tracking-widest mb-2" style={{ color: "#8A8370" }}>Détail de l'approvisionnement</div>
                      <div className="text-xs space-y-1" style={{ color: "#7A7460" }}>
                        <div>Fournisseur : <span style={{ color: "#152238" }}>{p.supplier}</span></div>
                        <div>Libellé : <span style={{ color: "#152238" }}>{p.label}</span></div>
                        <div>Compte imputé : <span style={{ color: "#152238" }}>{chargeLine ? `${chargeLine.account}` : "—"}</span></div>
                        <div>Mode de règlement : <span style={{ color: "#152238" }}>{p.paymentMode === "caisse" ? "Caisse (comptant)" : p.paymentMode === "banque" ? "Banque (comptant)" : "Crédit fournisseur"}</span></div>
                        <div>Montant : <span className="font-medium" style={{ color: "#152238" }}>{fmt(p.amount)}</span></div>
                        {p.tcaDeductible > 0 && <div data-testid="achat-detail-tca">dont {taxShort} déductible : <span style={{ color: "#152238" }}>{fmt(p.tcaDeductible)}</span> (hors taxe {fmt(p.amountHT)})</div>}
                        {p.supplierInvoiceNo && <div>Facture du fournisseur : <span style={{ color: "#152238" }}>{p.supplierInvoiceNo}</span></div>}
                        <div>Statut : <span style={{ color: "#152238" }}>{p.status}</span></div>
                      </div>
                      <RecordedStamp createdAt={p.createdAt} />
                    </td>
                  </tr>
                )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === "fournisseurs" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5 items-end">
            <div className="col-span-2">
              <label className="text-xs" style={{ color: "#8A8370" }}>Nom du fournisseur</label>
              <input value={newSupplier.name} onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Contact</label>
              <input value={newSupplier.contact} onChange={(e) => setNewSupplier({ ...newSupplier, contact: e.target.value })}
                placeholder="Email / téléphone" className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>NIF (facultatif)</label>
              <input value={newSupplier.nif || ""} onChange={(e) => setNewSupplier({ ...newSupplier, nif: e.target.value })} data-testid="fournisseur-nif"
                placeholder="Pour la liste annuelle des versements" className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <button onClick={addSupplier} className="flex items-center justify-center gap-2 px-4 py-2 rounded text-sm text-white h-[38px]" style={{ background: "#152238" }}>
              {editingSupplierId ? <CheckCircle2 size={14} /> : <Plus size={14} />}
              {editingSupplierId ? "Enregistrer" : "Ajouter"}
            </button>
          </div>
          {editingSupplierId && (
            <div className="flex items-center gap-2 mb-4 text-xs" style={{ color: "#A6432F" }}>
              Modification en cours.
              <button onClick={cancelEditSupplier} className="underline">Annuler</button>
            </div>
          )}
          <div className="overflow-x-auto overflow-y-auto max-h-[65vh] border rounded" style={{ borderColor: "#EEE9DA" }}><table className="w-full text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-2 font-normal">Nom</th>
                <th className="py-2 font-normal">Contact</th>
                <th className="py-2 font-normal text-right">Total achats à payer</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => {
                const due = purchases.filter((p) => p.supplier === s.name && p.status === "à payer").reduce((sum, p) => sum + p.amount, 0);
                return (
                  <tr key={s.id} style={{ borderBottom: "1px solid #F3EFE3", background: editingSupplierId === s.id ? "#FAF8F1" : "transparent" }}>
                    <td className="py-2">{s.name}<RecordedStamp createdAt={s.createdAt} /></td>
                    <td className="py-2">{s.contact || "—"}</td>
                    <td className="py-2 tabular text-right">{fmt(due)}</td>
                    <td className="py-2 text-right">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => startEditSupplier(s)} title="Modifier" style={{ color: "#152238" }}><Pencil size={14} /></button>
                        <button onClick={() => deleteSupplier(s)} title="Supprimer" style={{ color: "#A6432F" }}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === "performance" && (() => {
        // Performance d'achat par fournisseur : montant acheté ce mois-ci, produit
        // le plus acheté (en montant cumulé, toutes périodes confondues) et le
        // pourcentage qu'il représente dans le total des achats — même principe
        // que la Performance clients dans Comptes clients.
        const now = new Date();
        const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const bySupplier = {};
        purchases.forEach((p) => {
          if (!p.supplier || p.status === "annulé") return;
          const key = normalizeClientName(p.supplier);
          if (!bySupplier[key]) bySupplier[key] = { name: p.supplier, totalAll: 0, totalMonth: 0, products: {} };
          bySupplier[key].totalAll += Number(p.amount) || 0;
          if (p.date && p.date.startsWith(currentMonthPrefix)) bySupplier[key].totalMonth += Number(p.amount) || 0;
          (p.lines || []).forEach((l) => {
            const prod = products.find((pr) => pr.id === l.productId);
            const name = prod?.name || "Produit supprimé";
            bySupplier[key].products[name] = (bySupplier[key].products[name] || 0) + (Number(l.qty) || 0) * (Number(l.unitCost) || 0);
          });
        });
        const perfRows = Object.values(bySupplier)
          .map((s) => {
            const sortedProducts = Object.entries(s.products).sort((a, b) => b[1] - a[1]);
            const top = sortedProducts[0];
            const pct = top && s.totalAll > 0 ? (top[1] / s.totalAll) * 100 : 0;
            return { name: s.name, totalMonth: s.totalMonth, topProductName: top?.[0] || "—", pct };
          })
          .sort((a, b) => b.totalMonth - a.totalMonth);

        return perfRows.length === 0 ? (
          <div className="bg-white rounded-lg p-8 text-center text-sm" style={{ border: "1px solid #E4DFD1", color: "#A39C87" }}>Aucun achat enregistré pour le moment.</div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,34,56,0.08)" }}>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#C7CCDA" }}>
                  <th className="py-2 px-3 text-left font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Fournisseur</th>
                  <th className="py-2 px-3 text-right font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Achats ce mois-ci</th>
                  <th className="py-2 px-3 text-left font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Produit le plus acheté</th>
                  <th className="py-2 px-3 text-right font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>% de ses achats</th>
                </tr>
              </thead>
              <tbody>
                {perfRows.map((r) => (
                  <tr key={r.name}>
                    <td className="py-2 pl-3 pr-1" style={{ color: "#152238", borderLeft: "3px solid #378ADD" }}>{r.name}</td>
                    <td className="py-2 px-3 tabular text-right" style={{ color: r.totalMonth > 0 ? "#0F6B5C" : "#A39C87" }}>{fmt(r.totalMonth)}</td>
                    <td className="py-2 px-3" style={{ color: "#152238" }}>{r.topProductName}</td>
                    <td className="py-2 px-3 tabular text-right" style={{ color: "#7A7460" }}>{r.pct.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        );
      })()}

      {historyProductId && (
        <ProductHistoryModal productId={historyProductId} products={products} movements={movements} onClose={() => setHistoryProductId(null)} />
      )}
    </div>
  );
}


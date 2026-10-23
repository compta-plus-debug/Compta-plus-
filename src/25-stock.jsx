// ═══ MODULE ═══
// @module Stock
// @depends ArrowDownCircle, ArrowUpCircle, AssistedPrincipleReminder, PendingRecommendationsBanner, Plus
//   RecordedStamp, Trash2, _membership, detectAmountAnomaly, fmt, isLocked, resolveMembership
//   stockReconcile, supabase, todayStr, uid, useAssistedAnomalyGate, useBackNav, useBrouillon
//   useEffect, useMemo, useState
// @exports StockModule
// ═══ FIN DE L'EN-TÊTE ═══
// Dépréciation de stock — dévalue un produit sans en retirer la quantité physique
// (contrairement à "Perte", qui retire du stock réellement disparu/détruit). Utile
// pour un article encore présent mais qui ne vaut plus son coût d'achat : invendable,
// obsolète, démodé... La provision se réévalue à chaque saisie d'une nouvelle valeur
// estimée par unité : une baisse crée une dotation (charge), une hausse crée une
// reprise (produit) — jamais le montant total, seulement la variation par rapport à
// la provision déjà existante pour ce produit.
function StockDepreciationPanel({ products, setProducts, entries, setEntries, role, showToast, logAudit, planTier, recordPendingRecommendation, currentUserEmail }) {
  const canEdit = role !== "Vendeur";
  const [drafts, setDrafts] = useState({}); // { [productId]: "valeur en cours de saisie" }
  const merchandiseProducts = (products || []).filter((p) => p.type === "marchandise");
  const anomalyGate = useAssistedAnomalyGate();

  const applyDepreciation = (product) => {
    const draft = drafts[product.id];
    if (draft === undefined || draft === "") return;
    const nrv = Number(draft);
    if (!(nrv >= 0)) { showToast("La valeur estimée doit être un nombre positif ou nul."); return; }
    const cost = Number(product.costPrice) || 0;
    const stock = Number(product.stock) || 0;
    const newProvision = Math.max(0, (cost - nrv) * stock);
    const oldProvision = Number(product.depreciationProvision) || 0;
    const delta = newProvision - oldProvision;
    if (Math.round(delta * 100) === 0) {
      showToast("Aucun changement de provision pour ce montant.");
      setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, depreciationNrv: nrv } : p)));
      setDrafts((prev) => ({ ...prev, [product.id]: undefined }));
      return;
    }
    const commit = () => {
    const isDotation = delta > 0;
    const entry = {
      id: uid(),
      date: todayStr(),
      createdAt: new Date().toISOString(),
      label: `${isDotation ? "Dotation" : "Reprise"} dépréciation stock — ${product.name}`,
      lines: isDotation
        ? [{ account: "6817", debit: delta, credit: 0 }, { account: "39", debit: 0, credit: delta }]
        : [{ account: "39", debit: -delta, credit: 0 }, { account: "7817", debit: 0, credit: -delta }],
    };
    setEntries((prev) => [...prev, entry]);
    setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, depreciationNrv: nrv, depreciationProvision: newProvision } : p)));
    logAudit("Stock", isDotation ? "Dotation dépréciation" : "Reprise dépréciation", `${product.name} : ${fmt(Math.abs(delta))}`);
    showToast(`${isDotation ? "Dotation" : "Reprise"} enregistrée : ${fmt(Math.abs(delta))}.`);
    setDrafts((prev) => ({ ...prev, [product.id]: undefined }));
    // Suggestion facultative seulement — la dépréciation (comptable) et le prix de
    // vente (commercial) sont deux décisions distinctes ; on propose, on ne change
    // jamais automatiquement à la place de l'utilisateur.
    if (window.confirm(`Ajuster aussi le prix de vente de « ${product.name} » (actuellement ${fmt(product.price)}) ?`)) {
      const newPrice = window.prompt("Nouveau prix de vente :", String(nrv));
      if (newPrice !== null && Number(newPrice) >= 0) {
        setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, price: Number(newPrice) } : p)));
        logAudit("Catalogue", "Prix ajusté après dépréciation", `${product.name} : ${fmt(Number(newPrice))}`);
        showToast("Prix de vente mis à jour.");
      }
    }
    };
    if (planTier !== "assisted") { commit(); return; }
    const anomalies = [];
    if (nrv === 0 && cost > 0) anomalies.push(`Vous dépréciez « ${product.name} » à une valeur nulle — vérifiez que ce n'est pas une erreur de saisie.`);
    if (delta > 0 && cost > 0 && stock > 0 && delta > cost * stock * 0.5) {
      anomalies.push(`La dotation représente plus de la moitié de la valeur totale de « ${product.name} » — vérifiez le montant saisi.`);
    }
    const signature = `stockdep:${product.id}:${nrv}`;
    anomalyGate(signature, [...new Set(anomalies)], commit, showToast, () => {
      recordPendingRecommendation?.({
        companyId: _membership?.companyId,
        module: "stock",
        anomalyText: anomalies.join(" "),
        correctionText: "Vérifiez la valeur estimée saisie ; une reprise peut être enregistrée ensuite pour corriger.",
        entryRef: product.name,
        createdByEmail: currentUserEmail,
      });
    });
  };

  const clearDepreciation = (product) => {
    if (!(Number(product.depreciationProvision) > 0)) return;
    if (!window.confirm(`Annuler entièrement la dépréciation de « ${product.name} » ? Une reprise totale sera enregistrée.`)) return;
    const delta = -(Number(product.depreciationProvision) || 0);
    const entry = {
      id: uid(), date: todayStr(), createdAt: new Date().toISOString(),
      label: `Reprise dépréciation stock — ${product.name}`,
      lines: [{ account: "39", debit: -delta, credit: 0 }, { account: "7817", debit: 0, credit: -delta }],
    };
    setEntries((prev) => [...prev, entry]);
    setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, depreciationNrv: null, depreciationProvision: 0 } : p)));
    logAudit("Stock", "Reprise dépréciation", `${product.name} : ${fmt(-delta)}`);
    showToast(`Dépréciation annulée, reprise de ${fmt(-delta)} enregistrée.`);
  };

  return (
    <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
      <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Dépréciation de stock</div>
      <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
        Pour un article toujours en stock mais qui ne vaut plus son coût d'achat (obsolète, invendable, démodé). Indiquez sa nouvelle valeur estimée par unité — la provision se recalcule automatiquement, en charge (dotation) ou en produit (reprise) selon le sens du changement. Sans effet sur la quantité physique (voir "Perte" pour un article réellement disparu).
      </p>
      {merchandiseProducts.length === 0 ? (
        <div className="text-xs py-4 text-center" style={{ color: "#A39C87" }}>Aucun produit de type Marchandise au catalogue.</div>
      ) : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead>
            <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
              <th className="py-1.5 font-normal">Produit</th>
              <th className="py-1.5 font-normal text-right">Stock</th>
              <th className="py-1.5 font-normal text-right">Coût moyen</th>
              <th className="py-1.5 font-normal text-right">Provision actuelle</th>
              <th className="py-1.5 font-normal text-right">Nouvelle valeur/unité</th>
              <th className="py-1.5 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {merchandiseProducts.map((p) => (
              <tr key={p.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                <td className="py-1.5">{p.name}</td>
                <td className="py-1.5 tabular text-right">{p.stock || 0}</td>
                <td className="py-1.5 tabular text-right">{fmt(p.costPrice || 0)}</td>
                <td className="py-1.5 tabular text-right">{Number(p.depreciationProvision) > 0 ? fmt(p.depreciationProvision) : "—"}</td>
                <td className="py-1.5 text-right">
                  {canEdit ? (
                    <input type="number" min="0" placeholder={String(p.depreciationNrv ?? p.costPrice ?? 0)}
                      value={drafts[p.id] ?? ""} onChange={(e) => setDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      className="w-24 border rounded px-2 py-1 text-xs tabular text-right" style={{ borderColor: "#DDD6C4" }} />
                  ) : (fmt(p.depreciationNrv ?? p.costPrice ?? 0))}
                </td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  {canEdit && (
                    <>
                      <button onClick={() => applyDepreciation(p)} className="text-xs underline mr-2" style={{ color: "#152238" }}>Enregistrer</button>
                      {Number(p.depreciationProvision) > 0 && (
                        <button onClick={() => clearDepreciation(p)} className="text-xs underline" style={{ color: "#A6432F" }}>Annuler</button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

function StockModule({ products, setProducts, movements, setMovements, accounts, setAccounts, entries, setEntries, settings, role, showToast, logAudit, saveCategoryVerified, refreshCategoryFromServer, planTier, recordPendingRecommendation, currentUserEmail, pendingRecommendations, resolvePendingRecommendation }) {
  const anomalyGate = useAssistedAnomalyGate();
  const hasPendingStock = (pendingRecommendations || []).some((r) => r.module === "stock");
  // S'assure que le compte de pertes sur stock existe, sans jamais toucher aux
  // comptes déjà là — ajout silencieux au premier accès au module, y compris pour
  // une entreprise créée avant l'existence de cette fonctionnalité.
  useEffect(() => {
    const missing = [
      !accounts.some((a) => a.code === "658") && { code: "658", name: "Pertes sur stocks (péremption, casse)", type: "Charge" },
      !accounts.some((a) => a.code === "39") && { code: "39", name: "Dépréciation des stocks", type: "Actif" },
      !accounts.some((a) => a.code === "6817") && { code: "6817", name: "Dotations aux dépréciations des stocks", type: "Charge" },
      !accounts.some((a) => a.code === "7817") && { code: "7817", name: "Reprises sur dépréciations des stocks", type: "Produit" },
    ].filter(Boolean);
    if (missing.length > 0) setAccounts((prev) => [...prev, ...missing]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Le Vendeur peut consulter le stock et l'historique des mouvements, mais ne peut
  // ni ajuster manuellement le stock, ni supprimer un mouvement déjà enregistré —
  // ces actions restent réservées à Administrateur/Éditeur.
  const canAdjustStock = role !== "Vendeur";
  const [tab, setTab] = useState("inventaire");
  useBackNav(tab, setTab, "inventaire");
  const stockProducts = products.filter((p) => p.type === "marchandise");
  const [form, setForm] = useBrouillon("stock-mouvement", {
    productId: stockProducts[0]?.id,
    type: "entree",
    qty: "",
    reason: "",
  });
  const [invSort, setInvSort] = useState("stock_desc");
  const stockProductsSorted = [...stockProducts].sort((a, b) => {
    if (invSort === "stock_asc") return (a.stock || 0) - (b.stock || 0);
    if (invSort === "name") return a.name.localeCompare(b.name);
    return (b.stock || 0) - (a.stock || 0); // stock_desc par défaut
  });
  const [movFrom, setMovFrom] = useState("");
  const [movTo, setMovTo] = useState("");
  const [movSort, setMovSort] = useState("date");
  const [movProductFilter, setMovProductFilter] = useState(""); // "" = tous les produits
  // Liste des produits ayant au moins un mouvement, avec le nombre de mouvements pour
  // chacun — sert au sélecteur de recherche rapide par article dans l'historique.
  const movProductOptions = useMemo(() => {
    const counts = {};
    movements.forEach((m) => { counts[m.productId] = (counts[m.productId] || 0) + 1; });
    return products
      .filter((p) => counts[p.id])
      .map((p) => ({ id: p.id, name: p.name, count: counts[p.id] }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [movements, products]);
  const movFiltered = movements.filter((m) =>
    (!movFrom || m.date >= movFrom) &&
    (!movTo || m.date <= movTo) &&
    (!movProductFilter || String(m.productId) === movProductFilter)
  );
  const movEntreesQty = movFiltered.filter((m) => m.type !== "sortie").reduce((s, m) => s + m.qty, 0);
  const movSortiesQty = movFiltered.filter((m) => m.type === "sortie").reduce((s, m) => s + m.qty, 0);
  // Calcule, pour chaque mouvement, le solde de stock réel APRÈS ce mouvement précis —
  // pas le stock actuel du produit (qui a continué de bouger depuis). On reconstruit
  // rétroactivement à partir du stock actuel en remontant l'historique chronologique de
  // chaque produit, plutôt que d'afficher la même valeur "live" sur toutes les lignes.
  const stockAfterByMovement = useMemo(() => {
    const byProduct = {};
    movements.forEach((m) => {
      (byProduct[m.productId] = byProduct[m.productId] || []).push(m);
    });
    const result = {};
    Object.entries(byProduct).forEach(([productId, list]) => {
      // Tri chronologique stable : à date égale, l'ordre de création (celui du tableau
      // d'origine) est conservé grâce à la stabilité du tri de JavaScript.
      const chrono = [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const currentStock = products.find((p) => p.id === Number(productId))?.stock || 0;
      const totalDelta = chrono.reduce((s, m) => s + (m.type === "sortie" ? -m.qty : m.qty), 0);
      let running = currentStock - totalDelta; // stock avant le tout premier mouvement connu de ce produit
      chrono.forEach((m) => {
        running += m.type === "sortie" ? -m.qty : m.qty;
        result[m.id] = running;
      });
    });
    return result;
  }, [movements, products]);
  const stockRestantOf = (movementId) => stockAfterByMovement[movementId] ?? 0;
  const movSorted = [...movFiltered].sort((a, b) => {
    if (movSort === "stock_desc") return stockRestantOf(b.id) - stockRestantOf(a.id);
    if (movSort === "stock_asc") return stockRestantOf(a.id) - stockRestantOf(b.id);
    return 0; // "date" : conserve l'ordre chronologique, inversé à l'affichage ci-dessous
  });
  const movDisplayed = movSort === "date" ? [...movSorted].reverse() : movSorted;

  const addMovement = async () => {
    if (hasPendingStock) {
      showToast("Traitez d'abord la recommandation en attente ci-dessus avant d'enregistrer un nouveau mouvement.");
      return;
    }
    if (!form.qty || Number(form.qty) <= 0) {
      showToast("Renseignez une quantité valide.");
      return;
    }
    const product = products.find((p) => p.id === Number(form.productId));
    if (!product) return;
    const isLoss = form.type === "perte";
    const delta = (form.type === "sortie" || isLoss) ? -Number(form.qty) : Number(form.qty);
    const reason = form.reason || (form.type === "entree" ? "Réception fournisseur" : form.type === "sortie" ? "Sortie manuelle" : isLoss ? "Perte / péremption" : "Ajustement d'inventaire");
    const date = todayStr();
    // Une perte enregistrée avec une période comptable déjà clôturée resterait sans
    // écriture correspondante — on bloque en amont plutôt que de laisser un
    // mouvement de stock orphelin, sans comptabilisation associée.
    if (isLoss && isLocked(date, settings)) {
      showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Impossible d'enregistrer une perte aujourd'hui.`);
      return;
    }
    const commitMovement = async () => {
    // Ajustement atomique en base : verrouille la ligne le temps de l'opération, décrémente
    // le stock ET journalise le mouvement dans LA MÊME transaction — impossible que l'un
    // réussisse sans l'autre, même en cas de coupure de connexion en plein milieu.
    try {
      const { companyId } = await resolveMembership();
      const { error } = await supabase.rpc("adjust_product_stock", {
        target_company_id: companyId,
        target_product_id: product.id,
        delta,
        p_type: form.type,
        p_reason: reason,
        p_date: date,
      });
      if (error) throw error;
      const [pData, mData] = await Promise.all([
        refreshCategoryFromServer("products", setProducts),
        refreshCategoryFromServer("movements", setMovements),
      ]);
      // Comptabilisation de la perte : reclasse le coût déjà passé en charge à
      // l'achat (607) vers une ligne "Pertes sur stocks" dédiée et visible — impact
      // net nul sur le résultat (le montant était déjà en charge), mais permet de
      // suivre séparément combien coûte la péremption/casse dans le temps. Ignorée
      // silencieusement si l'article n'a pas de prix d'achat renseigné (rien à
      // valoriser).
      if (isLoss && Number(product.costPrice) > 0) {
        const lossValue = Number(product.costPrice) * Number(form.qty);
        const stockAccount = settings.stockValuationMethod === "actif" ? "370" : "607";
        setEntries((prev) => [...prev, {
          id: uid(), date, createdAt: new Date().toISOString(),
          label: `Perte sur stock — ${product.name} (${reason})`,
          lines: [{ account: "658", debit: lossValue, credit: 0 }, { account: stockAccount, debit: 0, credit: lossValue }],
        }]);
      } else if (isLoss) {
        showToast("Mouvement enregistré, mais aucune écriture comptable créée : renseignez un prix d'achat pour cet article (Catalogue) pour valoriser les prochaines pertes.");
      }
    } catch (e) {
      showToast("Impossible d'ajuster le stock (connexion instable). Réessayez.");
      return;
    }
    setForm({ ...form, qty: "", reason: "" });
    showToast(isLoss ? "Perte enregistrée." : "Mouvement de stock enregistré.");
    logAudit("Stock", form.type === "entree" ? "Entrée stock" : form.type === "sortie" ? "Sortie stock" : isLoss ? "Perte / péremption" : "Ajustement stock", `${product.name} — ${(form.type === "sortie" || isLoss) ? "-" : "+"}${form.qty}`);
    };
    if (planTier !== "assisted") { await commitMovement(); return; }
    const anomalies = [];
    const corrections = [];
    const value = Number(product.costPrice) > 0 ? Number(product.costPrice) * Number(form.qty) : null;
    if (value !== null) {
      const historyValues = movements
        .filter((m) => m.productId === product.id)
        .map((m) => Number(product.costPrice) * Number(m.qty))
        .filter((n) => Number.isFinite(n) && n > 0);
      const amt = detectAmountAnomaly(value, historyValues, product.name);
      if (amt) { anomalies.push(amt); corrections.push("Si la quantité est erronée : annulez ce mouvement puis ressaisissez-le avec la bonne quantité."); }
    }
    // Doublon simplifié : même produit, même type, même quantité, déjà présent
    // dans les mouvements récents (pas de champ date fiable disponible ici).
    const isDuplicateMovement = movements.slice(-30).some((m) => m.productId === product.id && m.type === form.type && Number(m.qty) === Number(form.qty));
    if (isDuplicateMovement) { anomalies.push(`Un mouvement identique (même article, même type, même quantité) existe déjà récemment pour ${product.name} — vérifiez qu'il ne s'agit pas d'un doublon.`); corrections.push("Vérifiez les mouvements récents : si celui-ci est bien un doublon, annulez-le (bouton Supprimer sur le mouvement)."); }
    const signature = `stock:${form.productId}:${form.type}:${form.qty}:${reason}`;
    await new Promise((resolve) => {
      anomalyGate(signature, [...new Set(anomalies)], async () => { await commitMovement(); resolve(); }, (msg) => { showToast(msg); resolve(); }, () => {
        recordPendingRecommendation?.({
          companyId: _membership?.companyId,
          module: "stock",
          anomalyText: anomalies.join(" "),
          correctionText: [...new Set(corrections)].join(" "),
          entryRef: product.name,
          createdByEmail: currentUserEmail,
        });
      });
    });
  };

  const deleteMovement = async (m) => {
    if (role === "Vendeur") { showToast("Seul un administrateur ou gestionnaire peut supprimer un mouvement de stock."); return; }
    if (!window.confirm("Supprimer définitivement ce mouvement de stock ? Le stock de l'article sera réajusté en conséquence.")) return;
    const originalDelta = m.type === "sortie" ? -m.qty : m.qty;
    try {
      const { companyId } = await resolveMembership();
      const { data: result, error } = await supabase.rpc("adjust_product_stock", {
        target_company_id: companyId,
        target_product_id: m.productId,
        delta: -originalDelta,
        p_type: null,
        p_reason: null,
        p_date: null,
      });
      if (error) throw error;
      // Comme addMovement(), on relit l'état confirmé du serveur juste après le RPC
      // plutôt que de se contenter d'une mise à jour locale optimiste — celle-ci
      // restait exposée à la sauvegarde automatique générique de la catégorie
      // "products", pouvant réintroduire l'ancien stock via une fusion basée sur une
      // référence pas encore à jour (surtout lors de suppressions rapprochées).
      const refreshed = await refreshCategoryFromServer("products", setProducts).catch(() => null);
      if (!refreshed) {
        setProducts((prev) => prev.map((p) => (p.id === m.productId ? { ...p, stock: result.newStock } : p)));
      }
    } catch (e) {
      showToast("Impossible d'ajuster le stock (connexion instable). Réessayez.");
      return;
    }
    const next = movements.filter((x) => x.id !== m.id);
    setMovements(next);
    // Suppression confirmée EXPLICITEMENT côté serveur, plutôt que de compter
    // uniquement sur la sauvegarde automatique passive — évite qu'un mouvement
    // supprimé ne réapparaisse après une resynchronisation.
    await saveCategoryVerified("movements", next, (arr) => arr.some((x) => x.id === m.id));
    showToast("Mouvement supprimé, stock réajusté.");
    logAudit("Stock", "Suppression mouvement", `${m.productName} — ${m.type === "sortie" ? "-" : "+"}${m.qty}`);
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module 5</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Stock et inventaire</div>
        <p className="text-sm mt-1" style={{ color: "#7A7460" }}>
          Le stock est décrémenté automatiquement à chaque vente de marchandise (Module 3).
        </p>
      </header>

      <div className="flex gap-1 mb-6 overflow-x-auto">
        {[["inventaire", "Inventaire"], ["mouvements", "Mouvements"], ...(settings.stockValuationMethod === "actif" ? [["depreciation", "Dépréciation"]] : [])].map(([id, label]) => (
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

      {tab === "inventaire" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          {(() => {
            const rec = stockReconcile(products, accounts, entries, settings);
            if (!rec) return null;
            return (
              <div className="mb-5 p-3 rounded text-sm" style={{ background: rec.ok ? "#E6F1EE" : "#FBF1DC", border: "1px solid " + (rec.ok ? "#BFDDD3" : "#E9D9A8") }} data-testid="stock-reconcile">
                <div className="font-medium mb-1" style={{ color: rec.ok ? "#0F6B5C" : "#9A7B1E" }}>
                  {rec.ok ? "Le stock correspond à la comptabilité" : "Le stock ne correspond pas à la comptabilité"}
                </div>
                <div className="text-xs" style={{ color: "#5C5640" }}>
                  Valeur du stock en rayon (quantités × coût) : <span className="tabular font-medium">{fmt(rec.stockValue)}</span> · Compte 370 « Stock de marchandises » : <span className="tabular font-medium">{fmt(rec.bal370)}</span>{!rec.ok && <> · Écart : <span className="tabular font-medium">{fmt(rec.gap)}</span></>}
                </div>
                {!rec.ok && <div className="text-xs mt-1" style={{ color: "#5C5640" }}>Faites un inventaire physique (Gestion avancée → Inventaire), ou régularisez dans Administration → Méthode de valorisation du stock.</div>}
              </div>
            );
          })()}
          {stockProducts.length === 0 ? (
            <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>
              Aucune marchandise au catalogue. Ajoutez des articles de type « Marchandise » depuis le Module 3 — Catalogue.
            </div>
          ) : (
            <>
            <div className="flex items-end gap-3 mb-3">
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Trier par</label>
                <select value={invSort} onChange={(e) => setInvSort(e.target.value)}
                  className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }}>
                  <option value="stock_desc">Stock restant — décroissant</option>
                  <option value="stock_asc">Stock restant — croissant</option>
                  <option value="name">Nom de l'article</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto overflow-y-auto max-h-[65vh] border rounded" style={{ borderColor: "#EEE9DA" }}><table className="w-full text-sm">
              <thead className="sticky top-0 bg-white z-10">
                <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                  <th className="py-2 font-normal">Code</th>
                  <th className="py-2 font-normal">Article</th>
                  <th className="py-2 font-normal text-right">Stock restant</th>
                  <th className="py-2 font-normal text-right">Seuil d'alerte</th>
                  <th className="py-2 font-normal text-center">État</th>
                </tr>
              </thead>
              <tbody>
                {stockProductsSorted.map((p) => {
                  const low = (p.stock || 0) <= (p.seuil || 0);
                  return (
                    <tr key={p.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                      <td className="py-2 tabular">{p.code}</td>
                      <td className="py-2">{p.name}</td>
                      <td className="py-2 tabular text-right font-medium" style={{ color: low ? "#A6432F" : "#152238" }}>{p.stock || 0}</td>
                      <td className="py-2 tabular text-right">{p.seuil || 0}</td>
                      <td className="py-2 text-center">
                        <span className="text-xs px-2 py-0.5 rounded"
                          style={{ background: low ? "#F7E9E3" : "#E6F1EE", color: low ? "#A6432F" : "#0F6B5C" }}>
                          {low ? "à réapprovisionner" : "suffisant"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
            </>
          )}
        </div>
      )}

      {tab === "mouvements" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          {canAdjustStock && stockProducts.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5 items-end">
              <div className="col-span-2">
                <label className="text-xs" style={{ color: "#8A8370" }}>Article</label>
                <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                  {stockProducts.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Type</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                  <option value="entree">Entrée (réception)</option>
                  <option value="sortie">Sortie manuelle</option>
                  <option value="perte">Perte / Péremption</option>
                  <option value="ajustement">Ajustement</option>
                </select>
              </div>
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Quantité</label>
                <input type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
              </div>
              <PendingRecommendationsBanner recommendations={pendingRecommendations} module="stock" onDismiss={resolvePendingRecommendation} />
              <AssistedPrincipleReminder planTier={planTier} text={
                form.type === "perte"
                  ? "Une perte/péremption reclasse le coût déjà en charge (achat) vers une ligne dédiée — l'impact sur le résultat est nul, mais elle doit être enregistrée pour suivre la valeur réellement perdue."
                  : form.type === "entree"
                  ? "Une entrée de stock correspond en principe à une réception déjà comptabilisée en achat — vérifiez qu'elle ne double pas une écriture d'achat déjà enregistrée."
                  : "Toute sortie ou ajustement de stock doit correspondre à un mouvement réel — une quantité saisie par erreur fausse la valorisation de l'inventaire et le coût des ventes."
              } />
              <button onClick={addMovement} disabled={hasPendingStock} className="flex items-center justify-center gap-2 px-4 py-2 rounded text-sm text-white h-[38px]" style={{ background: "#152238", opacity: hasPendingStock ? 0.5 : 1 }}>
                <Plus size={14} /> Enregistrer
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Article</label>
              <select value={movProductFilter} onChange={(e) => setMovProductFilter(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1 max-w-[220px]" style={{ borderColor: "#DDD6C4" }}>
                <option value="">Tous les articles</option>
                {movProductOptions.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.count})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Du</label>
              <input type="date" value={movFrom} onChange={(e) => setMovFrom(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
              <input type="date" value={movTo} onChange={(e) => setMovTo(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
            </div>
            {(movFrom || movTo || movProductFilter) && (
              <button onClick={() => { setMovFrom(""); setMovTo(""); setMovProductFilter(""); }} className="text-xs underline mb-1.5" style={{ color: "#8A8370" }}>
                Réinitialiser
              </button>
            )}
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Trier par</label>
              <select value={movSort} onChange={(e) => setMovSort(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }}>
                <option value="date">Plus récent d'abord</option>
                <option value="stock_desc">Stock restant — décroissant</option>
                <option value="stock_asc">Stock restant — croissant</option>
              </select>
            </div>
            {(movFrom || movTo || movProductFilter) && (
              <div className="tabular text-xs mb-1.5 ml-auto" style={{ color: "#152238" }}>
                Entrées {movEntreesQty} · Sorties {movSortiesQty}
              </div>
            )}
          </div>

          <div className="overflow-x-auto overflow-y-auto max-h-[65vh] border rounded" style={{ borderColor: "#EEE9DA" }}><table className="w-full text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-2 font-normal">Date</th>
                <th className="py-2 font-normal">Article</th>
                <th className="py-2 font-normal">Type</th>
                <th className="py-2 font-normal">Motif</th>
                <th className="py-2 font-normal text-right">Quantité</th>
                <th className="py-2 font-normal text-right">Stock restant</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {movFiltered.length === 0 && (
                <tr><td colSpan={7} className="py-8 text-center" style={{ color: "#A39C87" }}>{movements.length === 0 ? "Aucun mouvement pour le moment." : "Aucun mouvement sur cette période."}</td></tr>
              )}
              {movDisplayed.map((m) => {
                const restant = stockRestantOf(m.id);
                const low = products.find((p) => p.id === m.productId)?.seuil >= restant;
                return (
                <tr key={m.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-2 tabular">{m.date}<RecordedStamp createdAt={m.createdAt} /></td>
                  <td className="py-2">{m.productName}</td>
                  <td className="py-2">
                    <span className="flex items-center gap-1" style={{ color: m.type === "sortie" ? "#A6432F" : "#0F6B5C" }}>
                      {m.type === "sortie" ? <ArrowUpCircle size={14} /> : <ArrowDownCircle size={14} />}
                      {m.type === "entree" ? "Entrée" : m.type === "sortie" ? "Sortie" : "Ajustement"}
                    </span>
                  </td>
                  <td className="py-2" style={{ color: "#7A7460" }}>{m.reason}</td>
                  <td className="py-2 tabular text-right">{m.qty}</td>
                  <td className="py-2 tabular text-right font-medium" style={{ color: low ? "#A6432F" : "#152238" }}>{restant}</td>
                  <td className="py-2 text-right">
                    {canAdjustStock && <button onClick={() => deleteMovement(m)} title="Supprimer" style={{ color: "#A6432F" }}><Trash2 size={14} /></button>}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === "depreciation" && settings.stockValuationMethod === "actif" && (
        <StockDepreciationPanel products={products} setProducts={setProducts} entries={entries} setEntries={setEntries} role={role} showToast={showToast} logAudit={logAudit} planTier={planTier} recordPendingRecommendation={recordPendingRecommendation} currentUserEmail={currentUserEmail} />
      )}
    </div>
  );
}


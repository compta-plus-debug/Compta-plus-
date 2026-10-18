function VenteModule({ setCheques, accounts, entries, setEntries, products: productsProp, setProducts, productImages, setProductImages, invoices, setInvoices, movements, setMovements, settings, setSettings, salesStations, stationId, setStationId, role, showToast, logAudit, verifyTransactionSaved, planTier, recordPendingRecommendation, currentUserEmail, pendingRecommendations, resolvePendingRecommendation }) {
  const anomalyGate = useAssistedAnomalyGate();
  // --- Vente hors ligne : file locale, stock réservé, état de connexion ---
  const [oflQ, setOflQ] = useState(() => oflLoad());
  const [oflOnline, setOflOnline] = useState(typeof navigator === "undefined" || navigator.onLine !== false);
  const [oflSyncingUi, setOflSyncingUi] = useState(false);
  const [saleBusy, setSaleBusy] = useState(false);
  useEffect(() => {
    const h = () => setOflQ(oflLoad());
    const on = () => setOflOnline(true), off = () => setOflOnline(false);
    window.addEventListener(OFL_EVT, h); window.addEventListener("online", on); window.addEventListener("offline", off);
    h();
    return () => { window.removeEventListener(OFL_EVT, h); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  const oflRes = oflReserved(oflQ);
  const products = useMemo(() => (Object.keys(oflRes).length ? productsProp.map((p) => (oflRes[p.id] ? { ...p, stock: Math.max(0, (Number(p.stock) || 0) - oflRes[p.id]) } : p)) : productsProp), [productsProp, oflQ]);
  const hasPendingVente = (pendingRecommendations || []).some((r) => r.module === "vente");
  const [tab, setTab] = useState("pos");
  useBackNav(tab, setTab, "pos");
  const [historyProductId, setHistoryProductId] = useState(null);
  const [reportDate, setReportDate] = useState(todayStr());
  const [stationFilter, setStationFilter] = useState(""); // filtre optionnel du Rapport journalier POS par poste de vente
  const [cart, setCart] = useState([]); // [{productId, qty}]
  const [client, setClient] = useState("");
  const [paymentMode, setPaymentMode] = useState("caisse"); // caisse | banque | credit
  const [partialPaymentAmount, setPartialPaymentAmount] = useState("");
  const [partialPaymentAccount, setPartialPaymentAccount] = useState("caisse"); // caisse | banque
  const [editingInvoiceId, setEditingInvoiceId] = useState(null);
  const [saleDate, setSaleDate] = useState(todayStr());
  // Empêche un double-clic (ou double-tap sur écran tactile) de déclencher deux
  // ventes coup sur coup : la seconde lirait un numéro de facture et un état encore
  // périmés avant que l'écran n'ait fini de se mettre à jour après la première.
  const submittingSaleRef = React.useRef(false);
  const [posHistoryOpenId, setPosHistoryOpenId] = useState(null);
  const [printInvoice, setPrintInvoice] = useState(null);
  React.useEffect(() => {
    if (!printInvoice) return;
    // Un simple délai fixe n'attend pas vraiment que le logo (image encodée en base64,
    // parfois volumineuse) ait fini de se décoder dans le navigateur — sur mobile en
    // particulier, window.print() pouvait se déclencher avant que l'image soit prête,
    // produisant un aperçu/impression sans logo alors que le code l'affiche bien. On
    // attend maintenant la confirmation réelle du chargement de l'image (avec un
    // filet de sécurité pour ne jamais bloquer indéfiniment si elle échoue).
    let cancelled = false;
    const triggerPrint = () => { if (!cancelled) window.print(); };
    if (settings.companyLogo) {
      const img = new Image();
      const safety = setTimeout(triggerPrint, 1200);
      img.onload = () => { clearTimeout(safety); setTimeout(triggerPrint, 30); };
      img.onerror = () => { clearTimeout(safety); triggerPrint(); };
      img.src = settings.companyLogo;
    } else {
      setTimeout(triggerPrint, 80);
    }
    const onAfter = () => setPrintInvoice(null);
    window.addEventListener("afterprint", onAfter);
    return () => { cancelled = true; window.removeEventListener("afterprint", onAfter); };
  }, [printInvoice]);
  const [posSearch, setPosSearch] = useState("");
  const currentStation = (salesStations || []).find((s) => String(s.id) === String(stationId)) || null;
  // Si l'email connecté est affilié (liste "Emails affiliés") à un poste précis, ce
  // poste est imposé — l'utilisateur ne peut pas en choisir un autre, pour éviter
  // qu'une vente soit comptée sous le mauvais poste et fausse les rapports de caisse.
  const lockedStation = (salesStations || []).find((s) => (s.sellerEmails || []).some((e) => (currentUserEmail || "").toLowerCase() === e.toLowerCase())) || null;
  const [showScanner, setShowScanner] = useState(false);
  const [showPosScanner, setShowPosScanner] = useState(false);
  const [factFrom, setFactFrom] = useState("");
  const [factTo, setFactTo] = useState("");
  const [factNature, setFactNature] = useState(""); // "" | "payee" | "impayee"
  const [expandedInvoiceId, setExpandedInvoiceId] = useState(null);
  // Un Vendeur affecté à un poste ne voit que les ventes de son poste ; sans poste choisi
  // (alors que les postes sont en service), il n'en voit aucune. Les autres rôles voient tout.
  const scopedInvoices = (role === "Vendeur" && planTier === "assisted" && (salesStations || []).length > 0)
    ? invoices.filter((inv) => currentStation && (String(inv.stationId) === String(currentStation.id) || inv.stationName === currentStation.name))
    : invoices;
  const factFiltered = scopedInvoices.filter((inv) =>
    (!factFrom || inv.date >= factFrom) &&
    (!factTo || inv.date <= factTo) &&
    (!factNature || (factNature === "payee" ? inv.status === "payée" : inv.status !== "payée" && inv.status !== "annulée" && inv.status !== "don" && inv.status !== "perte"))
  );
  const factFilteredTotal = factFiltered.reduce((s, inv) => s + Number(inv.total || 0), 0);
  const factPayeeCount = scopedInvoices.filter((inv) => inv.status === "payée").length;
  const factImpayeeCount = scopedInvoices.filter((inv) => inv.status !== "payée" && inv.status !== "annulée" && inv.status !== "don" && inv.status !== "perte").length;
  const posProducts = products.filter((p) =>
    !posSearch.trim() || p.name.toLowerCase().includes(posSearch.trim().toLowerCase()) || p.code.toLowerCase().includes(posSearch.trim().toLowerCase())
  );
  const [newProduct, setNewProduct] = useState({ code: "", name: "", price: "", costPrice: "", tva: settings.taxRate, type: "service", account: "706", stock: "", seuil: "", image: null });
  const [imgLoading, setImgLoading] = useState(false);

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setImgLoading(true);
      const dataUrl = await resizeImage(file);
      setNewProduct((cur) => ({ ...cur, image: dataUrl }));
    } catch (err) {
      showToast("Impossible de charger cette image.");
    } finally {
      setImgLoading(false);
      e.target.value = "";
    }
  };

  const taxLabel = TAX_SYSTEMS[settings.taxSystem]?.label || "Taxe";
  const taxActive = settings.taxSystem !== "aucune";

  const addToCart = (productId) => {
    const p = products.find((pr) => pr.id === productId);
    if (p && p.type === "marchandise" && (p.stock || 0) <= 0) {
      showToast("Rupture de stock : cet article ne peut pas être ajouté au panier.");
      return;
    }
    setCart((c) => {
      const found = c.find((l) => l.productId === productId);
      if (found) {
        if (p && p.type === "marchandise" && found.qty + 1 > (p.stock || 0)) {
          showToast(`Stock insuffisant : il ne reste que ${p.stock || 0} unité(s) de « ${p.name} ».`);
          return c;
        }
        return c.map((l) => (l.productId === productId ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...c, { productId, qty: 1, discountPct: 0, discountAmt: 0 }];
    });
  };

  // Scan de code-barres/QR pendant une vente : dès que le texte saisi (par un
  // lecteur physique qui "tape" comme un clavier, ou après un scan caméra) correspond
  // EXACTEMENT au code d'un seul article, on l'ajoute directement au panier et on vide
  // le champ pour enchaîner le scan suivant sans clic — un lecteur physique peut alors
  // s'utiliser en continu sans jamais toucher l'écran.
  const handlePosSearchChange = (value) => {
    setPosSearch(value);
    const trimmed = value.trim();
    if (!trimmed) return;
    const exactMatches = products.filter((p) => p.code && p.code.toLowerCase() === trimmed.toLowerCase());
    if (exactMatches.length === 1) {
      addToCart(exactMatches[0].id);
      setPosSearch("");
    }
  };
  const posSearchInputRef = React.useRef(null);
  const handleScannedCode = (code) => {
    setShowPosScanner(false);
    handlePosSearchChange(code);
    // Remet le focus sur le champ après un scan caméra, pour permettre d'enchaîner
    // avec un lecteur physique ou une nouvelle saisie sans avoir à recliquer.
    setTimeout(() => posSearchInputRef.current?.focus(), 50);
  };

  const changeQty = (productId, delta) => {
    setCart((c) => c.map((l) => {
      if (l.productId !== productId) return l;
      const p = products.find((pr) => pr.id === productId);
      let nextQty = Math.max(1, l.qty + delta);
      if (delta > 0 && p && p.type === "marchandise" && nextQty > (p.stock || 0)) {
        showToast(`Stock insuffisant : il ne reste que ${p.stock || 0} unité(s) de « ${p.name} ».`);
        nextQty = l.qty;
      }
      return { ...l, qty: nextQty };
    }).filter((l) => l.qty > 0));
  };
  // Saisie directe de la quantité — complémentaire aux boutons +/-, pour éviter de
  // devoir cliquer des dizaines ou des centaines de fois sur une grosse quantité
  // (ex. 400 unités). Même contrôle de stock que changeQty.
  const setQtyDirect = (productId, value) => {
    setCart((c) => c.map((l) => {
      if (l.productId !== productId) return l;
      const p = products.find((pr) => pr.id === productId);
      let nextQty = Math.max(1, Math.floor(Number(value)) || 1);
      if (p && p.type === "marchandise" && nextQty > (p.stock || 0)) {
        showToast(`Stock insuffisant : il ne reste que ${p.stock || 0} unité(s) de « ${p.name} » — quantité ramenée au maximum disponible.`);
        nextQty = Math.max(1, p.stock || 1);
      }
      return { ...l, qty: nextQty };
    }));
  };
  const changeLineDiscount = (productId, pct) => {
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    setCart((c) => c.map((l) => (l.productId === productId ? { ...l, discountPct: clamped, discountAmt: 0 } : l)));
  };
  const changeLineDiscountAmt = (productId, amt) => {
    const clamped = Math.max(0, Number(amt) || 0);
    setCart((c) => c.map((l) => (l.productId === productId ? { ...l, discountAmt: clamped, discountPct: 0 } : l)));
  };
  const removeLine = (productId) => setCart((c) => c.filter((l) => l.productId !== productId));

  const [globalDiscountPct, setGlobalDiscountPct] = useState(0);
  const [globalDiscountAmt, setGlobalDiscountAmt] = useState(0);
  const [fees, setFees] = useState([]); // { id, label, amount, account }
  const revenueAccounts = accounts.filter((a) => a.type === "Produit");
  const addFee = () => setFees((f) => [...f, { id: uid(), label: "", amount: "", account: revenueAccounts[0]?.code }]);
  const updateFee = (id, patch) => setFees((f) => f.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const removeFee = (id) => setFees((f) => f.filter((x) => x.id !== id));

  const cartLines = cart.map((l) => {
    const p = products.find((pr) => pr.id === l.productId);
    const gross = p ? p.price * l.qty : 0; // avant remise ligne
    const lineDiscount = (l.discountAmt || 0) > 0 ? Math.min(Number(l.discountAmt) * l.qty, gross) : gross * ((l.discountPct || 0) / 100);
    const subtotal = gross - lineDiscount; // HT après remise ligne
    const taxAmount = taxActive ? subtotal * ((p?.tva || 0) / 100) : 0;
    return { ...l, product: p, gross, lineDiscount, subtotal, taxAmount, subtotalTTC: subtotal + taxAmount };
  });
  const linesTotalHT = cartLines.reduce((s, l) => s + l.subtotal, 0);
  const globalDiscountAmount = (Number(globalDiscountAmt) || 0) > 0
    ? Math.min(Number(globalDiscountAmt), linesTotalHT)
    : linesTotalHT * ((Number(globalDiscountPct) || 0) / 100);
  const feesTotal = fees.reduce((s, f) => s + (Number(f.amount) || 0), 0);
  const totalTax = cartLines.reduce((s, l) => s + l.taxAmount, 0);
  const totalHT = linesTotalHT - globalDiscountAmount + feesTotal;
  const total = linesTotalHT + totalTax - globalDiscountAmount + feesTotal; // TTC

  const validateSale = async () => {
    if (submittingSaleRef.current) return; // une soumission est déjà en cours pour ce clic/tap
    if (hasPendingVente) {
      showToast("Traitez d'abord la recommandation en attente ci-dessus avant d'enregistrer une nouvelle vente.");
      return;
    }
    if (cartLines.length === 0) {
      showToast("Le panier est vide.");
      return;
    }
    if (paymentMode === "credit" && !client) {
      showToast("Indiquez le nom du client pour une vente à crédit.");
      return;
    }
    const invId = uid();
    const date = saleDate || todayStr();
    if (isFutureDate(date)) {
      showToast("Impossible d'enregistrer une vente à une date future.");
      return;
    }
    if (total <= 0) {
      showToast("Le montant total de la vente ne peut pas être à zéro.");
      return;
    }
    if (isLocked(date, settings)) {
      showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Impossible d'enregistrer une vente à cette date.`);
      return;
    }
    if (editingInvoiceId) {
      const old0 = invoices.find((i) => i.id === editingInvoiceId);
      if (old0?.status === "annulée") {
        showToast("Cette facture est annulée et ne peut plus être modifiée.");
        return;
      }
      if (old0 && isLocked(old0.date, settings)) {
        showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Cette facture ne peut plus être modifiée.`);
        return;
      }
    }
    submittingSaleRef.current = true;
    setSaleBusy(true);
    const slowHint = setTimeout(() => showToast("Enregistrement en cours… Si la connexion est mauvaise, la vente sera gardée sur cet appareil puis envoyée automatiquement."), 2500);
    try {
      if (planTier !== "assisted") {
        await validateSaleCommit(invId, date);
        return;
      }
      const anomalies = [];
      const corrections = [];
      const amountHistory = invoices.slice(-50).map((i) => i.total).filter((n) => Number.isFinite(n));
      const amt = detectAmountAnomaly(total, amountHistory, "cette vente");
      if (amt) { anomalies.push(amt); corrections.push("Si le montant est erroné : annulez cette facture puis recréez-la avec le montant correct."); }
      const someProductsHaveTax = products.some((p) => Number(p.tva) > 0);
      const taxAnomaly = detectTaxAnomaly(taxActive, totalTax, linesTotalHT, someProductsHaveTax);
      if (taxAnomaly) { anomalies.push(taxAnomaly); corrections.push("Corrigez le taux de TCA sur la fiche du ou des produits vendus (Vente → Catalogue), puis recréez cette facture."); }
      const dup = detectDuplicateAnomaly(
        { amount: total, date, label: client || "Vente comptoir" },
        invoices.slice(-50).map((i) => ({ amount: i.total, date: i.date, label: i.client || "" }))
      );
      if (dup) { anomalies.push(dup); corrections.push("Vérifiez les deux factures : si l'une est bien un doublon, annulez-la."); }
      const signature = `sale:${date}:${client}:${paymentMode}:${total}:${cart.map((l) => l.productId + "x" + l.qty).join(",")}`;
      await new Promise((resolve) => {
        anomalyGate(signature, [...new Set(anomalies)], async () => { await validateSaleCommit(invId, date); resolve(); }, (msg) => { showToast(msg); resolve(); }, () => {
          recordPendingRecommendation?.({
            companyId: _membership?.companyId,
            module: "vente",
            anomalyText: anomalies.join(" "),
            correctionText: [...new Set(corrections)].join(" "),
            entryRef: client || "Vente comptoir",
            createdByEmail: currentUserEmail,
          });
        });
      });
    } finally {
      clearTimeout(slowHint);
      setSaleBusy(false);
      submittingSaleRef.current = false;
    }
  };

  const validateSaleCommit = async (invId, date) => {
    let invNumber;
    let offlineMode = false;      // vente gardée sur l'appareil, synchronisée plus tard
    let offlineStockAttempted = false;
    if (editingInvoiceId && typeof navigator !== "undefined" && navigator.onLine === false) {
      showToast("Hors ligne : la modification d'une facture existante n'est pas possible sans connexion. Réessayez une fois connecté.");
      return;
    }
    if (editingInvoiceId) {
      invNumber = invoices.find((i) => i.id === editingInvoiceId)?.number || ("F" + String(settings.nextInvoiceNumber || 1).padStart(4, "0"));
    } else if (typeof navigator !== "undefined" && navigator.onLine === false) {
      offlineMode = true;
      invNumber = oflProvisionalNumber();
    } else {
      // Le numéro de facture est délivré par la base de données (compteur atomique
      // côté serveur), et non plus calculé localement : deux ventes validées au même
      // instant depuis deux appareils différents ne peuvent plus jamais recevoir le
      // même numéro, contrairement à l'ancien compteur en mémoire locale.
      try {
        const companyId = await oflCompanyId();
        const { data: n, error } = await oflTimeout(supabase.rpc("next_invoice_number", { target_company_id: companyId }), 6000);
        if (error) throw error;
        invNumber = "F" + String(n).padStart(4, "0");
      } catch (e) {
        if (oflIsNetworkError(e)) {
          // Connexion coupée ou trop instable : la vente continue hors ligne plutôt que d'être bloquée.
          offlineMode = true;
          invNumber = oflProvisionalNumber();
        } else {
          showToast("Impossible d'obtenir un numéro de facture (connexion instable). Réessayez.");
          return;
        }
      }
    }

    // Pour une NOUVELLE vente (pas une modification), le stock ET le mouvement de
    // stock correspondant sont vérifiés, décrémentés et journalisés en UNE SEULE
    // opération indivisible en base : impossible que l'un réussisse sans l'autre,
    // même en cas de coupure de connexion en plein milieu.
    const stockLinesForGate = editingInvoiceId ? [] : cartLines.filter((l) => l.product.type === "marchandise");
    if (!offlineMode && stockLinesForGate.length > 0) {
      try {
        const companyId = await oflCompanyId();
        const { data: stockResult, error: stockErr } = await oflTimeout(supabase.rpc("commit_sale_stock", {
          target_company_id: companyId,
          sale_lines: stockLinesForGate.map((l) => ({ productId: l.productId, qty: l.qty })),
          p_invoice_id: invId,
          p_invoice_number: invNumber,
          p_date: date,
        }), 10000);
        if (stockErr) throw stockErr;
        if (!stockResult.ok) {
          const details = stockResult.insufficient.map((i) => `« ${i.name} » (${i.available} dispo, ${i.requested} demandé)`).join(", ");
          showToast(`Vente refusée — stock insuffisant : ${details}`);
          return;
        }
      } catch (e) {
        if (oflIsNetworkError(e)) {
          // La réponse a pu se perdre APRÈS l'application côté serveur : la synchronisation vérifiera avant de rejouer.
          offlineMode = true;
          offlineStockAttempted = true;
        } else {
          showToast("Impossible de vérifier le stock (connexion instable). Réessayez.");
          return;
        }
      }
    }

    let saleEntry = null;
    let cogsEntry = null;
    let partialAmt = 0;
    let partialAcc = partialPaymentAccount === "banque" ? "512" : "530";
    if (paymentMode === "don") {
      // Un don n'est pas une vente : aucun compte de produit (706/707) n'est crédité,
      // aucun encaissement n'est attendu. Seul le coût de revient des articles donnés
      // devient une charge (Dons, libéralités), en contrepartie du stock qui sort —
      // exactement comme une perte, mais avec un compte de charge distinct pour rester
      // lisible dans les rapports (un don est une décision, pas un accident).
      const donCost = cartLines.reduce((sum, l) => {
        if (l.product.type !== "marchandise") return sum;
        return sum + (Number(l.qty) || 0) * (Number(l.product.costPrice) || 0);
      }, 0);
      if (donCost > 0) {
        const stockAccount = settings.stockValuationMethod === "actif" ? "370" : "607";
        saleEntry = {
          id: uid(),
          invoiceId: editingInvoiceId || invId,
          date,
          createdAt: new Date().toISOString(),
          label: `Don — ${invNumber}${client ? " — " + client : ""}`,
          lines: [{ account: "6238", debit: donCost, credit: 0 }, { account: stockAccount, debit: 0, credit: donCost }],
        };
      } else {
        showToast("Don enregistré, mais aucune écriture comptable créée : renseignez un coût pour ces articles (Catalogue) pour valoriser les prochains dons.");
      }
    } else {
    const payAccount = paymentMode === "caisse" ? "530" : paymentMode === "banque" ? "512" : "411";
    // Recouvrement partiel à la vente : un versement immédiat (caisse ou banque) peut
    // être encaissé tout de suite même sur une vente à crédit, le solde restant seul
    // au compte 411 (Clients) — sans ça, une vente "à crédit" partiellement réglée sur
    // place n'avait aucun moyen d'enregistrer ce versement au moment même de la vente.
    partialAmt = (!editingInvoiceId && paymentMode === "credit") ? Math.min(Math.max(0, Number(partialPaymentAmount) || 0), total) : 0;

    // Regrouper les lignes de vente par compte pour construire une écriture équilibrée multi-lignes
    const byAccount = {};
    cartLines.forEach((l) => {
      const acc = l.product.account;
      byAccount[acc] = (byAccount[acc] || 0) + l.subtotal;
    });
    // La remise globale réduit proportionnellement chaque compte de produit concerné
    if (globalDiscountAmount > 0 && linesTotalHT > 0) {
      Object.keys(byAccount).forEach((acc) => {
        byAccount[acc] -= globalDiscountAmount * (byAccount[acc] / linesTotalHT);
      });
    }
    // Les frais divers (transport, livraison...) s'ajoutent sur le compte de produit choisi pour chacun
    fees.forEach((f) => {
      const amt = Number(f.amount) || 0;
      if (amt > 0 && f.account) byAccount[f.account] = (byAccount[f.account] || 0) + amt;
    });
    saleEntry = {
      id: uid(),
      invoiceId: editingInvoiceId || invId,
      date,
      createdAt: new Date().toISOString(),
      label: `Vente ${invNumber}${client ? " — " + client : ""}`,
      lines: [
        ...(partialAmt > 0
          ? [{ account: partialAcc, debit: partialAmt, credit: 0 }, { account: payAccount, debit: total - partialAmt, credit: 0 }]
          : [{ account: payAccount, debit: total, credit: 0 }]),
        ...Object.entries(byAccount).map(([acc, amount]) => ({ account: acc, debit: 0, credit: amount })),
        ...(totalTax > 0 ? [{ account: settings.taxAccount, debit: 0, credit: totalTax }] : []),
      ],
    };
    // Sortie de stock au coût moyen pondéré — uniquement si l'entreprise a choisi la
    // méthode "stock en actif" (sinon le stock reste en charge dès l'achat, sans
    // écriture supplémentaire à la vente, comme avant). Seules les lignes de type
    // "marchandise" sont concernées ; les services n'ont pas de stock ni de coût.
    // Une écriture séparée (pas fusionnée avec saleEntry) pour rester lisible dans
    // le journal et pour que l'annulation puisse la contrepasser distinctement.
    // (Ignorée pour un don : la sortie de stock est déjà couverte par saleEntry ci-dessus.)
    if (settings.stockValuationMethod === "actif") {
      const cogsTotal = cartLines.reduce((sum, l) => {
        if (l.product.type !== "marchandise") return sum;
        return sum + (Number(l.qty) || 0) * (Number(l.product.costPrice) || 0);
      }, 0);
      if (cogsTotal > 0) {
        cogsEntry = {
          id: uid(),
          invoiceId: editingInvoiceId || invId,
          date,
          createdAt: new Date().toISOString(),
          label: `Sortie de stock — Vente ${invNumber}`,
          kind: "cogs", // distingue cette écriture de la facturation elle-même pour le contrôle de cohérence
          lines: [{ account: "6037", debit: cogsTotal, credit: 0 }, { account: "370", debit: 0, credit: cogsTotal }],
        };
      }
    }
    }
    const invoiceBeingEdited = editingInvoiceId ? invoices.find((i) => i.id === editingInvoiceId) : null;
    const newInvoice = {
      id: editingInvoiceId || invId,
      number: invNumber,
      date,
      createdAt: invoiceBeingEdited ? invoiceBeingEdited.createdAt : new Date().toISOString(),
      client: client || "Client comptant",
      lines: cartLines.map((l) => ({ productId: l.productId, name: l.product.name, qty: l.qty, price: l.product.price, discountPct: l.discountPct || 0, discountAmt: l.discountAmt || 0, subtotal: l.subtotal, tva: l.product.tva, taxAmount: l.taxAmount })),
      globalDiscountPct: Number(globalDiscountPct) || 0,
      globalDiscountAmtInput: Number(globalDiscountAmt) || 0,
      globalDiscountAmount,
      fees: fees.filter((f) => Number(f.amount) > 0).map((f) => ({ label: f.label || "Frais", amount: Number(f.amount), account: f.account })),
      totalHT,
      totalTax,
      taxLabel,
      total: paymentMode === "don" ? 0 : total,
      retailValue: paymentMode === "don" ? total : undefined, // valeur de vente conservée pour référence, sans figurer dans le total affiché
      paymentMode,
      status: paymentMode === "don" ? "don" : "payée", // recalculé juste après si la facture est à crédit
      // Le poste de vente et le vendeur affiché ne concernent que le rôle Vendeur —
      // un Administrateur (ou tout autre rôle) qui effectue une vente sur un appareil
      // où un poste est configuré ne doit jamais lui être rattaché : les rôles sont
      // distincts et leur activité doit rester séparée dans les rapports.
      stationId: editingInvoiceId ? (invoiceBeingEdited?.stationId || null) : (role === "Vendeur" && currentStation ? currentStation.id : null),
      stationName: editingInvoiceId ? (invoiceBeingEdited?.stationName || null) : (role === "Vendeur" && currentStation ? currentStation.name : null),
      soldByName: editingInvoiceId ? (invoiceBeingEdited?.soldByName || null) : (role === "Vendeur" ? (currentStation?.activeSellerName || null) : null),
      soldByEmail: editingInvoiceId ? (invoiceBeingEdited?.soldByEmail || null) : (role === "Vendeur" ? (currentStation?.activeSellerEmail || null) : null),
    };
    const old = invoiceBeingEdited;
    if (paymentMode === "credit") {
      const carriedPayments = old?.payments || (partialAmt > 0 ? [{ id: uid(), date, createdAt: new Date().toISOString(), amount: partialAmt, account: partialAcc }] : []);
      const paidSoFar = carriedPayments.reduce((s, p) => s + p.amount, 0);
      newInvoice.payments = carriedPayments;
      newInvoice.status = paidSoFar <= 0 ? "impayée" : paidSoFar >= total ? "payée" : "partielle";
    }

    if (offlineMode) {
      const isProv = String(invNumber).startsWith("HL-");
      const queued = oflEnqueue({
        qid: uid(), invId, number: invNumber, numberReal: !isProv, provNumber: isProv ? invNumber : undefined,
        stockAttempted: offlineStockAttempted, date, createdAt: new Date().toISOString(),
        invoice: newInvoice, entries: [saleEntry, cogsEntry].filter(Boolean),
        stockLines: stockLinesForGate.map((l) => ({ productId: l.productId, qty: l.qty, name: l.product.name })),
      });
      if (!queued) { showToast("Espace de stockage de l'appareil saturé : la vente n'a pas pu être gardée hors ligne. Reconnectez-vous pour continuer."); return; }
      setCart([]); setClient(""); setEditingInvoiceId(null); setGlobalDiscountPct(0); setGlobalDiscountAmt(0); setFees([]); setPartialPaymentAmount(""); setSaleDate(todayStr());
      showToast(`Vente ${invNumber} enregistrée HORS LIGNE sur cet appareil — elle sera synchronisée automatiquement au retour de la connexion.`);
      logAudit("Vente", "Vente hors ligne", `${invNumber} — ${fmt(total)}`);
      return;
    }
    if (editingInvoiceId) {
      // Annule l'effet de l'ancienne version sur le stock avant d'appliquer la nouvelle.
      if (old) {
        setProducts((prev) => prev.map((p) => {
          const oldLine = (old.lines || []).find((l) => l.productId === p.id);
          return oldLine ? { ...p, stock: (p.stock || 0) + oldLine.qty } : p;
        }));
      }
      setMovements((prev) => prev.filter((m) => m.invoiceId !== editingInvoiceId));
      const entriesToAdd = [saleEntry, cogsEntry].filter(Boolean);
      setEntries((prev) => prev.filter((e) => e.invoiceId !== editingInvoiceId).concat(entriesToAdd));
      setInvoices((prev) => prev.map((i) => (i.id === editingInvoiceId ? newInvoice : i)));
    } else {
      const entriesToAdd = [saleEntry, cogsEntry].filter(Boolean);
      setEntries((prev) => [...prev, ...entriesToAdd]);
      setInvoices((prev) => [...prev, newInvoice]);
    }

    // Décrémenter le stock des marchandises et journaliser les mouvements de sortie
    const stockLines = editingInvoiceId
      ? cartLines.filter((l) => l.product.type === "marchandise")
      : stockLinesForGate;
    if (stockLines.length > 0) {
      if (editingInvoiceId) {
        // Modification d'une facture existante : cas plus rare, hors du flux de vente
        // à haute fréquence — pas de verrou atomique ici, calcul local conservé.
        setProducts((prev) => prev.map((p) => {
          const line = stockLines.find((l) => l.productId === p.id);
          return line ? { ...p, stock: Math.max(0, (p.stock || 0) - line.qty) } : p;
        }));
        setMovements((prev) => [
          ...prev,
          ...stockLines.map((l) => ({
            id: uid(),
            invoiceId: editingInvoiceId || invId,
            date,
            createdAt: new Date().toISOString(),
            productId: l.productId,
            productName: l.product.name,
            type: "sortie",
            qty: l.qty,
            reason: `Vente ${invNumber}`,
          })),
        ]);
      } else {
        // Le stock ET le mouvement correspondant ont déjà été appliqués en base de
        // façon atomique par commit_sale_stock ci-dessus. On recharge l'état exact
        // depuis le serveur pour les deux catégories, plutôt que de recalculer
        // localement, pour ne jamais risquer d'écraser le résultat de la réservation
        // atomique avec une valeur locale périmée ou de dupliquer le mouvement.
        try {
          const [freshProducts, freshMovements] = await oflTimeout(Promise.all([
            window.storage.get("compta-products"),
            window.storage.get("compta-movements"),
          ]), 8000);
          const extractData = (res) => {
            if (!res?.value) return null;
            const parsed = JSON.parse(res.value);
            return (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "data" in parsed) ? parsed.data : parsed;
          };
          const pData = extractData(freshProducts);
          const mData = extractData(freshMovements);
          // Garde-fou : si la réservation atomique a répondu « ok » mais que le serveur
          // n'a PAS réellement diminué le stock (ou n'a pas journalisé le mouvement),
          // on applique nous-mêmes la sortie ici, une seule fois, pour que catalogue,
          // stock restant et mouvements restent justes quoi qu'il arrive côté base.
          let nextProducts = Array.isArray(pData) ? pData : null;
          let nextMovements = Array.isArray(mData) ? mData : null;
          if (nextProducts) {
            const missingStock = stockLines.filter((l) => {
              const before = products.find((p) => p.id === l.productId);
              const after = nextProducts.find((p) => p.id === l.productId);
              return before && after && (Number(after.stock) || 0) === (Number(before.stock) || 0);
            });
            if (missingStock.length > 0) {
              nextProducts = nextProducts.map((p) => {
                const line = missingStock.find((l) => l.productId === p.id);
                return line ? { ...p, stock: Math.max(0, (Number(p.stock) || 0) - line.qty) } : p;
              });
            }
          }
          if (nextMovements) {
            const missingMoves = stockLines.filter((l) => !nextMovements.some((m) => m.invoiceId === invId && m.productId === l.productId));
            if (missingMoves.length > 0) {
              nextMovements = [...nextMovements, ...missingMoves.map((l) => ({
                id: uid(), invoiceId: invId, date, createdAt: new Date().toISOString(),
                productId: l.productId, productName: l.product.name, type: "sortie", qty: l.qty, reason: `Vente ${invNumber}`,
              }))];
            }
          }
          if (nextProducts) setProducts(nextProducts);
          if (nextMovements) setMovements(nextMovements);
        } catch (e) {
          // Best effort : si le rechargement échoue, l'état local reste tel quel
          // (légèrement en retard) mais sera corrigé au prochain rechargement/sync.
        }
      }
    }


    setCart([]);
    setClient("");
    setEditingInvoiceId(null);
    setGlobalDiscountPct(0);
    setGlobalDiscountAmt(0);
    setFees([]);
    setPartialPaymentAmount("");
    setSaleDate(todayStr());
    showToast(editingInvoiceId ? `Facture ${invNumber} mise à jour.` : `Facture ${invNumber} créée (${paymentMode === "credit" ? "à encaisser" : "payée"}).`);
    logAudit("Vente", editingInvoiceId ? "Modification facture" : "Création facture", `${invNumber} — ${fmt(total)}`);

    // Vérification différée, spécifique à CETTE vente : "entries" et "invoices" sont
    // sauvegardées vers le serveur par deux mécanismes indépendants (aucune transaction
    // atomique commune) — un accroc réseau touchant l'un pendant que l'autre réussit peut
    // laisser une écriture sans sa facture (ou l'inverse), sans que rien ne le signale sur
    // le moment. On laisse le temps aux deux sauvegardes passives de se terminer, puis on
    // vérifie sur le serveur ; en cas d'absence, on retente une fois, et on avertit
    // explicitement par le numéro de facture si ça persiste malgré tout.
    // Vérification différée de CETTE vente, via le mécanisme générique (voir App() —
    // verifyTransactionSaved) : couvre écriture + facture systématiquement, et en plus
    // produits + mouvements dans le cas (rare) d'une modification de facture existante,
    // où ces deux catégories restent aussi des écritures locales optimistes non couvertes
    // par la réservation atomique côté serveur utilisée pour une vente neuve.
    const txOps = [
      { category: "invoices", label: "facture", isPresent: (arr) => arr.some((i) => i.id === newInvoice.id), buildNext: () => (editingInvoiceId ? invoices.map((i) => (i.id === editingInvoiceId ? newInvoice : i)) : [...invoices, newInvoice]) },
      { category: "entries", label: "écriture", isPresent: (arr) => (!saleEntry || arr.some((e) => e.id === saleEntry.id)) && (!cogsEntry || arr.some((e) => e.id === cogsEntry.id)), buildNext: () => { const toAdd = [saleEntry, cogsEntry].filter(Boolean); return editingInvoiceId ? entries.filter((e) => e.invoiceId !== editingInvoiceId).concat(toAdd) : [...entries, ...toAdd]; } },
    ];
    if (editingInvoiceId && stockLines.length > 0) {
      const stockMovements = stockLines.map((l) => ({
        id: uid(), invoiceId: editingInvoiceId, date, createdAt: new Date().toISOString(),
        productId: l.productId, productName: l.product.name, type: "sortie", qty: l.qty, reason: `Vente ${invNumber}`,
      }));
      txOps.push(
        { category: "products", label: "stock produits", isPresent: (arr) => stockLines.every((l) => arr.some((p) => p.id === l.productId)), buildNext: () => products },
        { category: "movements", label: "mouvements de stock", isPresent: (arr) => stockMovements.every((m) => arr.some((x) => x.productId === m.productId && x.invoiceId === m.invoiceId && x.reason === m.reason)), buildNext: () => movements }
      );
    }
    verifyTransactionSaved(`Vente ${invNumber}`, txOps, { showToast, logAudit });
  };

  const lastEncaissementRef = React.useRef(0);
  const [chequeDlg, setChequeDlg] = useState(null);
  const encaisserFacture = (inv, compte, montant, cheque) => {
    if (cheque) compte = "5112"; // chèque reçu : compte "Chèques à encaisser" jusqu'au dépôt
    if (Date.now() - lastEncaissementRef.current < 800) return; // double-clic/double-tap ignoré
    lastEncaissementRef.current = Date.now();
    const restantInitial = balanceDue(inv);
    let remaining = montant == null ? restantInitial : Math.max(0, Number(montant) || 0);
    if (remaining <= 0) {
      showToast("Montant invalide ou facture déjà soldée.");
      return;
    }
    // Même principe que dans Comptes clients : un versement supérieur au solde de
    // cette facture précise se répartit automatiquement sur les factures suivantes
    // du même client, de la plus ancienne à la plus récente.
    const clientKey = normalizeClientName(inv.client);
    const otherOutstanding = invoices
      .filter((i) => i.id !== inv.id && normalizeClientName(i.client) === clientKey && i.status !== "payée" && i.status !== "don" && i.status !== "annulée" && i.status !== "perte")
      .sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.createdAt || "").localeCompare(b.createdAt || ""));
    const ordered = [inv, ...otherOutstanding];
    const date = todayStr();
    const newEntries = [];
    const updates = [];
    for (const target of ordered) {
      if (remaining <= 0) break;
      const due = balanceDue(target);
      if (due <= 0) continue;
      const amt = Math.min(remaining, due);
      remaining -= amt;
      const payId = uid();
      const newPayments = [...(target.payments || []), { id: payId, date, createdAt: new Date().toISOString(), amount: amt, account: compte, ...(cheque ? { cheque: cheque.number } : {}) }];
      const newStatus = amt >= due ? "payée" : "partielle";
      updates.push({ id: target.id, updatedInvoice: { ...target, payments: newPayments, status: newStatus }, amt, number: target.number, payId });
      { const ent = simpleEntry(date, `${amt < due ? "Encaissement partiel" : "Encaissement"} ${target.number} — ${target.client}${cheque ? ` (chèque n° ${cheque.number})` : ""}`, compte, "411", amt); newEntries.push(ent); updates[updates.length - 1].entryId = ent.id; }
    }
    setEntries((prev) => [...prev, ...newEntries]);
    if (cheque && setCheques && updates.length > 0) {
      setCheques((prev) => [...prev, makeChequeRecord({ kind: "recu", number: cheque.number, bank: cheque.bank, party: inv.client, amount: updates.reduce((t, u) => t + u.amt, 0), date, entryIds: newEntries.map((e) => e.id), links: updates.map((u) => ({ invoiceId: u.id, paymentId: u.payId, amt: u.amt, entryId: u.entryId })) })]);
      logAudit("Chèques", "Chèque reçu enregistré", `${inv.client} — n° ${cheque.number}`);
    }
    setInvoices((prev) => prev.map((i) => { const u = updates.find((x) => x.id === i.id); return u ? u.updatedInvoice : i; }));
    const totalApplied = updates.reduce((s, u) => s + u.amt, 0);
    if (updates.length <= 1) {
      const u = updates[0];
      showToast(u && u.updatedInvoice.status === "payée" ? `Facture ${inv.number} soldée.` : `Paiement partiel de ${fmt(totalApplied)} enregistré sur ${inv.number} (reste dû : ${fmt(restantInitial - totalApplied)}).`);
    } else {
      showToast(`Versement de ${fmt(totalApplied)} réparti sur ${updates.length} factures de ${inv.client} (${updates.map((u) => u.number).join(", ")}).`);
    }
    if (remaining > 0) {
      showToast(`Excédent de ${fmt(remaining)} non affecté : ${inv.client} n'a plus de facture en cours.`);
    }
    logAudit("Vente", updates.length > 1 ? "Encaissement réparti sur plusieurs factures" : (updates[0]?.updatedInvoice.status === "payée" ? "Encaissement facture" : "Encaissement partiel facture"), `${inv.client} — ${fmt(totalApplied)}`);
    verifyTransactionSaved(`Encaissement ${inv.client}`, [
      { category: "entries", label: "écriture(s) d'encaissement", isPresent: (arr) => newEntries.every((e) => arr.some((x) => x.id === e.id)), buildNext: () => [...entries, ...newEntries] },
      { category: "invoices", label: "statut des factures", isPresent: (arr) => updates.every((u) => { const i = arr.find((x) => x.id === u.id); return i && i.status === u.updatedInvoice.status; }), buildNext: () => invoices.map((i) => { const u = updates.find((x) => x.id === i.id); return u ? u.updatedInvoice : i; }) },
    ], { showToast, logAudit });
  };

  const cancelInvoice = (inv) => {
    if (role !== "Administrateur") {
      showToast("Seul un administrateur peut annuler une facture validée.");
      return;
    }
    if ((inv.payments || []).some((p) => p.account === "avoir" || p.account === "419")) {
      showToast("Cette facture a un avoir ou un acompte imputé : elle ne peut plus être annulée directement (les écritures d'avoir/acompte seraient contrepassées deux fois). Corrigez-la par un avoir complémentaire.");
      return;
    }
    if (inv.status === "annulée") {
      showToast("Cette facture est déjà annulée.");
      return;
    }
    if (isLocked(inv.date, settings)) {
      showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Cette facture ne peut plus être annulée sans rouvrir la période.`);
      return;
    }
    if (!window.confirm(`Annuler la facture ${inv.number} ? Une écriture de contrepassation sera générée et le stock sera restitué. La facture reste conservée dans l'historique avec le statut « annulée » — conformément aux règles de non-altération comptable.`)) return;
    const today = todayStr();
    const original = entries.filter((e) => e.invoiceId === inv.id && !e.cancelledBy);
    const newReversals = original.map((orig) => ({
      id: uid(),
      invoiceId: inv.id,
      date: today,
      createdAt: new Date().toISOString(),
      label: `Annulation facture ${inv.number}${orig.kind === "cogs" ? " — sortie de stock" : ""}`,
      reversalOf: orig.id,
      kind: orig.kind,
      lines: orig.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })),
    }));
    setEntries((prev) => [
      ...prev.map((e) => {
        const r = newReversals.find((rv) => rv.reversalOf === e.id);
        return r ? { ...e, cancelledBy: r.id } : e;
      }),
      ...newReversals,
    ]);
    // Contrepasse aussi les encaissements/paiements partiels déjà reçus sur cette facture
    (inv.payments || []).forEach((p) => {
      const paymentReversal = simpleEntry(today, `Annulation encaissement ${inv.number}`, "411", p.account, p.amount);
      newReversals.push(paymentReversal);
      setEntries((prev) => [...prev, paymentReversal]);
    });
    // Restitue le stock des marchandises vendues via un mouvement d'entrée (traçable), sans supprimer l'historique des sorties
    const stockLines = (inv.lines || []).filter((l) => products.find((p) => p.id === l.productId && p.type === "marchandise"));
    const restockMovements = [];
    if (stockLines.length > 0) {
      setProducts((prev) => prev.map((p) => {
        const line = stockLines.find((l) => l.productId === p.id);
        return line ? { ...p, stock: (p.stock || 0) + line.qty } : p;
      }));
      stockLines.forEach((l) => restockMovements.push({
        id: uid(), invoiceId: inv.id, date: today, createdAt: new Date().toISOString(), productId: l.productId, productName: l.name,
        type: "entree", qty: l.qty, reason: `Annulation facture ${inv.number}`,
      }));
      setMovements((prev) => [...prev, ...restockMovements]);
    }
    setInvoices((prev) => prev.map((i) => (i.id === inv.id ? { ...i, status: "annulée" } : i)));
    showToast(`Facture ${inv.number} annulée par contrepassation.`);
    logAudit("Vente", "Annulation facture (contrepassation)", `${inv.number} — ${fmt(inv.total)}`);
    verifyTransactionSaved(`Annulation ${inv.number}`, [
      { category: "invoices", label: "statut annulé de la facture", isPresent: (arr) => { const i = arr.find((x) => x.id === inv.id); return i && i.status === "annulée"; }, buildNext: () => invoices.map((i) => (i.id === inv.id ? { ...i, status: "annulée" } : i)) },
      ...(newReversals.length > 0 ? [{ category: "entries", label: "écriture(s) de contrepassation", isPresent: (arr) => newReversals.every((r) => arr.some((e) => e.id === r.id)), buildNext: () => [...entries, ...newReversals] }] : []),
      ...(restockMovements.length > 0 ? [
        { category: "products", label: "stock restitué", isPresent: (arr) => stockLines.every((l) => arr.some((p) => p.id === l.productId)), buildNext: () => products },
        { category: "movements", label: "mouvement de restitution", isPresent: (arr) => restockMovements.every((m) => arr.some((x) => x.productId === m.productId && x.invoiceId === m.invoiceId && x.reason === m.reason)), buildNext: () => movements },
      ] : []),
    ], { showToast, logAudit });
  };

  const startEditInvoice = (inv) => {
    if (role === "Vendeur") {
      showToast("Un vendeur ne peut pas modifier une facture déjà enregistrée — contactez un administrateur.");
      return;
    }
    if ((inv.payments || []).some((p) => p.account === "avoir" || p.account === "419")) {
      showToast("Cette facture a un avoir ou un acompte imputé : elle ne peut plus être modifiée. Émettez un avoir complémentaire si besoin.");
      return;
    }
    if (inv.status === "annulée") {
      showToast("Cette facture est annulée et ne peut plus être modifiée.");
      return;
    }
    if (isLocked(inv.date, settings)) {
      showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Cette facture ne peut plus être modifiée.`);
      return;
    }
    if (inv.isOpeningBalance) {
      showToast("Cette facture représente un solde d'ouverture et n'a pas de détail d'articles ; elle ne peut pas être modifiée via le panier de vente.");
      return;
    }
    if ((inv.lines || []).some((l) => l.productId === undefined)) {
      showToast("Cette facture a été créée avant l'activation de la modification et ne peut pas être éditée ; vous pouvez la supprimer et en recréer une.");
      return;
    }
    if ((inv.lines || []).some((l) => !products.find((p) => p.id === l.productId))) {
      showToast("Un ou plusieurs articles de cette facture ont été supprimés du catalogue ; modification impossible. Vous pouvez la supprimer et en recréer une.");
      return;
    }
    setCart(inv.lines.map((l) => ({ productId: l.productId, qty: l.qty, discountPct: l.discountPct || 0, discountAmt: l.discountAmt || 0 })));
    setClient(inv.client === "Client comptant" ? "" : inv.client);
    setPaymentMode(inv.paymentMode);
    setGlobalDiscountPct(inv.globalDiscountPct || 0);
    setGlobalDiscountAmt(inv.globalDiscountAmtInput || 0);
    setFees((inv.fees || []).map((f) => ({ id: uid(), label: f.label, amount: f.amount, account: f.account })));
    setEditingInvoiceId(inv.id);
    setSaleDate(inv.date || todayStr());
    setTab("pos");
  };

  const cancelEditInvoice = () => {
    setCart([]);
    setClient("");
    setPaymentMode("caisse");
    setGlobalDiscountPct(0);
    setGlobalDiscountAmt(0);
    setFees([]);
    setEditingInvoiceId(null);
    setSaleDate(todayStr());
  };

  const [editingProductId, setEditingProductId] = useState(null);

  const addProduct = () => {
    if (!newProduct.code || !newProduct.name || !newProduct.price) {
      showToast("Code, intitulé et prix requis.");
      return;
    }
    const codeTaken = products.some((p) => p.id !== editingProductId && p.code.trim().toLowerCase() === newProduct.code.trim().toLowerCase());
    if (codeTaken) {
      showToast(`Le code « ${newProduct.code} » est déjà utilisé par un autre article. Choisissez un code unique.`);
      return;
    }
    const nameTaken = products.some((p) => p.id !== editingProductId && p.name.trim().toLowerCase() === newProduct.name.trim().toLowerCase());
    if (nameTaken && !window.confirm(`Un article nommé « ${newProduct.name} » existe déjà au catalogue (avec un autre code). Créer quand même une seconde fiche distincte ? Cela créera deux compteurs de stock séparés pour le même nom.`)) {
      return;
    }
    const base = { ...newProduct, price: Number(newProduct.price), costPrice: Number(newProduct.costPrice || 0), tva: Number(newProduct.tva) };
    delete base.image; // la photo est stockée à part, voir productImages plus bas
    if (base.type === "marchandise") {
      base.stock = Number(newProduct.stock || 0);
      base.seuil = Number(newProduct.seuil || 5);
    } else {
      delete base.stock;
      delete base.seuil;
    }

    if (editingProductId) {
      setProducts((prev) => prev.map((p) => (p.id === editingProductId ? { ...base, id: editingProductId } : p)));
      setProductImages((prev) => {
        const next = { ...prev };
        if (newProduct.image) next[editingProductId] = newProduct.image; else delete next[editingProductId];
        return next;
      });
      showToast("Article modifié.");
      logAudit("Vente", "Modification article", `${base.code} — ${base.name}`);
      setEditingProductId(null);
    } else {
      const newId = uid();
      setProducts((prev) => [...prev, { ...base, id: newId, createdAt: new Date().toISOString() }]);
      if (newProduct.image) setProductImages((prev) => ({ ...prev, [newId]: newProduct.image }));
      showToast("Article ajouté au catalogue.");
      logAudit("Vente", "Ajout article", `${base.code} — ${base.name}`);
    }
    setNewProduct({ code: "", name: "", price: "", tva: settings.taxRate, type: "service", account: "706", stock: "", seuil: "", image: null });
  };

  const startEditProduct = (p) => {
    setEditingProductId(p.id);
    setNewProduct({
      code: p.code, name: p.name, price: p.price, costPrice: p.costPrice ?? "", tva: p.tva, type: p.type, account: p.account,
      stock: p.stock ?? "", seuil: p.seuil ?? "", image: productImages[p.id] ?? null,
    });
  };

  const cancelEditProduct = () => {
    setEditingProductId(null);
    setNewProduct({ code: "", name: "", price: "", costPrice: "", tva: settings.taxRate, type: "service", account: "706", stock: "", seuil: "", image: null });
  };

  const deleteProduct = (id) => {
    if (!window.confirm("Supprimer définitivement cet article du catalogue ?")) return;
    const p = products.find((x) => x.id === id);
    setProducts((prev) => prev.filter((p) => p.id !== id));
    setProductImages((prev) => { const next = { ...prev }; delete next[id]; return next; });
    if (editingProductId === id) cancelEditProduct();
    showToast("Article supprimé.");
    if (p) logAudit("Vente", "Suppression article", `${p.code} — ${p.name}`);
  };

  return (
    <>
    <div className={`p-4 md:p-8 max-w-6xl${printInvoice ? " no-print" : ""}`}>
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module 3</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Vente — POS et facturation</div>
        <p className="text-sm mt-1" style={{ color: "#7A7460" }}>
          Chaque vente génère automatiquement sa facture et son écriture comptable (compte 706/707).
        </p>
      </header>

      <OflPanel queue={oflQ} offline={!oflOnline} syncing={oflSyncingUi} canEdit={role !== "Lecture seule"} onPrint={(it) => setPrintInvoice(oflFinal(it).invoice)} onSync={async () => { setOflSyncingUi(true); try { window.dispatchEvent(new Event("compta-plus-ofl-sync")); await new Promise((r) => setTimeout(r, 1500)); } finally { setOflSyncingUi(false); } }} />

      <div className="flex gap-1 mb-6 overflow-x-auto">
        {[["pos", "Point de vente"], ["factures", "Factures"], ["rapport", "Rapport journalier"], ["catalogue", "Catalogue"]].map(([id, label]) => (
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

      {tab === "pos" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="col-span-2">
            <div className="flex items-center gap-3 flex-wrap justify-between mb-3 px-3 py-2 rounded" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }}>
              <BluetoothPrinterCard showToast={showToast} settings={settings} compact />
              <div className="flex items-center gap-2 flex-wrap">
                {planTier === "assisted" && role === "Vendeur" && (salesStations || []).length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs shrink-0" style={{ color: "#7A7460" }}>Poste :</span>
                    {currentStation
                      ? <span className="text-xs font-medium" style={{ color: "#152238" }} data-testid="pos-station-name">{currentStation.name}</span>
                      : <span className="text-xs" style={{ color: "#A6432F" }} data-testid="pos-no-station">Aucun poste ne vous est assigné : demandez à l'administrateur de vous assigner un poste (Administration → Postes de vente). Sans poste, vos ventes ne seront rattachées à aucune caisse.</span>}
                  </div>
                )}
                <span className="text-xs shrink-0" style={{ color: "#7A7460" }}>Format d'impression :</span>
                <select value={settings.receiptFormat || "a4"} onChange={(e) => setSettings({ ...settings, receiptFormat: e.target.value })}
                  className="border rounded px-2 py-1 text-xs" style={{ borderColor: "#DDD6C4" }}>
                  <option value="a4">Feuille A4</option>
                  <option value="ticket80">Ticket 80 mm</option>
                  <option value="ticket58">Ticket 58 mm</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 mb-3">
              <input ref={posSearchInputRef} value={posSearch} onChange={(e) => handlePosSearchChange(e.target.value)}
                placeholder="Rechercher, ou scanner un code-barres/QR..."
                className="flex-1 min-w-0 border rounded px-3 py-2 text-sm" style={{ borderColor: "#DDD6C4" }} />
              <button type="button" onClick={() => setShowPosScanner(true)} title="Scanner un code-barres ou QR"
                className="shrink-0 border rounded px-3 flex items-center justify-center" style={{ borderColor: "#DDD6C4", color: "#152238" }}>
                <ScanLine size={18} />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 overflow-y-auto max-h-[65vh] pr-1">
              {posProducts.length === 0 && (
                <div className="col-span-full text-xs py-6 text-center" style={{ color: "#A39C87" }}>Aucun article ne correspond à cette recherche.</div>
              )}
              {posProducts.map((p) => {
                const outOfStock = p.type === "marchandise" && (p.stock || 0) <= 0;
                return (
                <button key={p.id} onClick={() => addToCart(p.id)} disabled={outOfStock}
                  className="text-left bg-white rounded-lg p-3 hover:shadow-sm transition-shadow flex gap-3"
                  style={{ border: "1px solid #E4DFD1", opacity: outOfStock ? 0.5 : 1, cursor: outOfStock ? "not-allowed" : "pointer" }}>
                  {productImages[p.id] ? (
                    <img src={productImages[p.id]} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded flex items-center justify-center shrink-0" style={{ background: "#F3EFE3" }}>
                      <ImageIcon size={18} style={{ color: "#C7C0AD" }} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs" style={{ color: "#A39C87" }}>{p.code} · {p.type === "service" ? "Service" : "Marchandise"}</div>
                    <div className="text-sm font-medium mt-0.5 truncate" style={{ color: "#152238" }}>{p.name}</div>
                    <div className="flex items-center justify-between mt-1">
                      <div className="tabular text-sm" style={{ color: "#0F6B5C" }}>{fmt(p.price)}</div>
                      {p.type === "marchandise" && (
                        <div className="tabular text-xs font-medium" style={{ color: outOfStock ? "#A6432F" : (p.stock || 0) <= (p.seuil || 0) ? "#A6432F" : "#A39C87" }}>
                          {outOfStock ? "Rupture de stock" : `stock : ${p.stock || 0}`}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
                );
              })}
            </div>

            <div className="mt-6">
              <div className="flex items-center gap-2 mb-3" style={{ color: "#152238" }}>
                <History size={16} /><span className="font-medium text-sm">Historique des ventes</span>
              </div>
              {invoices.length === 0 ? (
                <div className="text-xs py-4 text-center" style={{ color: "#A39C87" }}>Aucune vente enregistrée pour le moment.</div>
              ) : (
                <div className="overflow-y-auto max-h-[40vh] border rounded" style={{ borderColor: "#EEE9DA" }}>
                  {[...invoices].reverse().slice(0, 30).map((inv) => (
                    <div key={inv.id} onClick={() => setPosHistoryOpenId(posHistoryOpenId === inv.id ? null : inv.id)}
                      className="px-3 py-2 text-xs cursor-pointer hover:bg-[#FAF8F1]" style={{ borderBottom: "1px solid #F3EFE3" }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="tabular" style={{ color: "#8A8370" }}>{inv.date}</span>
                          <span className="font-medium truncate" style={{ color: "#152238" }}>{inv.number}</span>
                          <span className="truncate" style={{ color: "#7A7460" }}>{inv.client}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="tabular" style={{ color: "#152238" }}>{fmt(inv.total)}</span>
                          <span className="px-1.5 py-0.5 rounded"
                            style={{
                              background: inv.status === "payée" ? "#E6F1EE" : inv.status === "partielle" ? "#FBF1DC" : inv.status === "don" ? "#EDEAF7" : "#F7E9E3",
                              color: inv.status === "payée" ? "#0F6B5C" : inv.status === "partielle" ? "#9A7B1E" : inv.status === "don" ? "#5B3FA0" : "#A6432F",
                            }}>
                            {inv.status}
                          </span>
                        </div>
                      </div>
                      {posHistoryOpenId === inv.id && (
                        <div className="mt-2 pl-1 space-y-0.5" style={{ color: "#7A7460" }} onClick={(e) => e.stopPropagation()}>
                          {(inv.lines || []).map((l, i) => (
                            <div key={i} className="flex justify-between">
                              <span className="truncate">{l.qty} × {l.name}</span>
                              <span className="tabular shrink-0 ml-2">{fmt(l.subtotal + (l.taxAmount || 0))}</span>
                            </div>
                          ))}
                          <div className="flex justify-between pt-1" style={{ borderTop: "1px solid #EEE9DA" }}>
                            <span>Mode</span>
                            <span>{inv.paymentMode === "caisse" ? "Caisse" : inv.paymentMode === "banque" ? "Banque" : "Crédit"}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            <button onClick={() => setPrintInvoice(inv)} className="flex items-center gap-1 text-xs underline" style={{ color: "#152238" }}>
                              <Printer size={11} /> Imprimer
                            </button>
                            <button onClick={() => printInvoiceBluetooth(inv, settings, showToast)} className="flex items-center gap-1 text-xs underline" style={{ color: "#152238" }}>
                              <BluetoothIcon size={11} /> Ticket (Bluetooth)
                            </button>
                            <button onClick={() => downloadInvoicePDF(inv, settings)} className="flex items-center gap-1 text-xs underline" style={{ color: "#152238" }}>
                              <Download size={11} /> Télécharger PDF
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg p-5 h-fit" style={{ border: "1px solid #E4DFD1" }}>
            <div className="flex items-center gap-2 mb-4" style={{ color: "#152238" }}>
              <Receipt size={16} /><span className="font-medium text-sm">Panier</span>
            </div>
            {cartLines.length === 0 ? (
              <div className="text-xs py-6 text-center" style={{ color: "#A39C87" }}>Sélectionnez un article à gauche.</div>
            ) : (
              <div className="space-y-3 mb-4">
                {cartLines.map((l) => (
                  <div key={l.productId} className="text-sm pb-3" style={{ borderBottom: "1px solid #F3EFE3" }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 truncate" style={{ color: "#152238" }}>{l.product.name}</div>
                      <div className="text-right shrink-0">
                        {l.lineDiscount > 0 && <div className="tabular text-xs line-through" style={{ color: "#A6432F" }}>{fmt(l.gross)}</div>}
                        <div className="tabular text-sm">{fmt(l.subtotal)}</div>
                      </div>
                      <button onClick={() => removeLine(l.productId)} className="shrink-0" style={{ color: "#A6432F" }}><X size={13} /></button>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <button onClick={() => changeQty(l.productId, -1)} className="w-5 h-5 flex items-center justify-center rounded shrink-0" style={{ background: "#F3EFE3" }}><Minus size={10} /></button>
                      <input type="number" min="1" value={l.qty}
                        onChange={(e) => setQtyDirect(l.productId, e.target.value)}
                        onFocus={(e) => e.target.select()}
                        className="tabular text-xs w-12 text-center shrink-0 border rounded py-0.5" style={{ borderColor: "#DDD6C4" }} />
                      <button onClick={() => changeQty(l.productId, 1)} className="w-5 h-5 flex items-center justify-center rounded shrink-0" style={{ background: "#F3EFE3" }}><Plus size={10} /></button>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mt-1.5">
                      <span className="text-xs" style={{ color: "#A39C87" }}>Remise</span>
                      <input type="number" min="0" max="100" value={l.discountPct || ""} placeholder="0"
                        onChange={(e) => changeLineDiscount(l.productId, e.target.value)}
                        className="w-11 border rounded px-1 py-0.5 text-xs tabular" style={{ borderColor: "#DDD6C4" }} />
                      <span className="text-xs" style={{ color: "#A39C87" }}>%</span>
                      <span className="text-xs" style={{ color: "#A39C87" }}>ou</span>
                      <input type="number" min="0" value={l.discountAmt || ""} placeholder="0"
                        onChange={(e) => changeLineDiscountAmt(l.productId, e.target.value)}
                        title="Montant de remise par unité, multiplié automatiquement par la quantité"
                        className="w-14 border rounded px-1 py-0.5 text-xs tabular" style={{ borderColor: "#DDD6C4" }} />
                      <span className="text-xs" style={{ color: "#A39C87" }}>/ unité</span>
                    </div>
                    {(l.discountAmt || 0) > 0 && (
                      <div className="text-xs mt-0.5" style={{ color: "#A6432F" }}>
                        soit −{fmt(Number(l.discountAmt))} × {l.qty} = −{fmt(l.lineDiscount)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="border-t pt-3 mb-3" style={{ borderColor: "#EEE9DA" }}>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs" style={{ color: "#8A8370" }}>Remise globale sur la facture</label>
                <div className="flex items-center gap-1">
                  <input type="number" min="0" max="100" value={globalDiscountPct || ""} placeholder="0"
                    onChange={(e) => { setGlobalDiscountPct(Math.max(0, Math.min(100, Number(e.target.value) || 0))); setGlobalDiscountAmt(0); }}
                    className="w-14 border rounded px-1.5 py-1 text-xs tabular text-right" style={{ borderColor: "#DDD6C4" }} />
                  <span className="text-xs" style={{ color: "#A39C87" }}>%</span>
                  <span className="text-xs" style={{ color: "#A39C87" }}>ou</span>
                  <input type="number" min="0" value={globalDiscountAmt || ""} placeholder="0"
                    onChange={(e) => { setGlobalDiscountAmt(Math.max(0, Number(e.target.value) || 0)); setGlobalDiscountPct(0); }}
                    className="w-16 border rounded px-1.5 py-1 text-xs tabular text-right" style={{ borderColor: "#DDD6C4" }} />
                  <span className="text-xs" style={{ color: "#A39C87" }}>montant</span>
                </div>
              </div>

              <div className="text-xs mb-1.5" style={{ color: "#8A8370" }}>Autres frais (transport, livraison...)</div>
              {fees.map((f) => (
                <div key={f.id} className="flex items-center gap-1.5 mb-1.5">
                  <input value={f.label} onChange={(e) => updateFee(f.id, { label: e.target.value })} placeholder="Libellé"
                    className="flex-1 min-w-0 border rounded px-1.5 py-1 text-xs" style={{ borderColor: "#DDD6C4" }} />
                  <select value={f.account} onChange={(e) => updateFee(f.id, { account: e.target.value })}
                    className="border rounded px-1 py-1 text-xs w-20" style={{ borderColor: "#DDD6C4" }}>
                    {revenueAccounts.map((a) => <option key={a.code} value={a.code}>{a.code}</option>)}
                  </select>
                  <input type="number" value={f.amount} onChange={(e) => updateFee(f.id, { amount: e.target.value })} placeholder="0"
                    className="w-16 border rounded px-1.5 py-1 text-xs tabular text-right" style={{ borderColor: "#DDD6C4" }} />
                  <button onClick={() => removeFee(f.id)} style={{ color: "#A6432F" }}><X size={13} /></button>
                </div>
              ))}
              <button onClick={addFee} className="text-xs underline mb-2" style={{ color: "#8A8370" }}>+ Ajouter des frais</button>
            </div>

            <div className="border-t pt-3 mb-4" style={{ borderColor: "#EEE9DA" }}>
              <div className="flex justify-between tabular text-xs mb-1" style={{ color: "#8A8370" }}>
                <span>Sous-total lignes (avant remise produit)</span><span>{fmt(cartLines.reduce((s, l) => s + l.gross, 0))}</span>
              </div>
              {cartLines.some((l) => l.lineDiscount > 0) && (
                <div className="flex justify-between tabular text-xs mb-1" style={{ color: "#A6432F" }}>
                  <span>Remise produit{cartLines.filter((l) => l.lineDiscount > 0).length > 1 ? "s" : ""} ({cartLines.filter((l) => l.lineDiscount > 0).length} article{cartLines.filter((l) => l.lineDiscount > 0).length > 1 ? "s" : ""})</span>
                  <span>−{fmt(cartLines.reduce((s, l) => s + l.lineDiscount, 0))}</span>
                </div>
              )}
              {globalDiscountAmount > 0 && (
                <div className="flex justify-between tabular text-xs mb-1" style={{ color: "#A6432F" }}>
                  <span>Remise globale {Number(globalDiscountAmt) > 0 ? "(montant)" : `(${globalDiscountPct}%)`}</span><span>−{fmt(globalDiscountAmount)}</span>
                </div>
              )}
              {feesTotal > 0 && (
                <div className="flex justify-between tabular text-xs mb-1" style={{ color: "#8A8370" }}>
                  <span>Frais divers</span><span>+{fmt(feesTotal)}</span>
                </div>
              )}
              {taxActive && (
                <>
                  <div className="flex justify-between tabular text-xs mb-1" style={{ color: "#8A8370" }}>
                    <span>Sous-total HT</span><span>{fmt(totalHT)}</span>
                  </div>
                  <div className="flex justify-between tabular text-xs mb-2" style={{ color: "#8A8370" }}>
                    <span>{taxLabel}</span><span>{fmt(totalTax)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between tabular text-base font-semibold" style={{ color: "#152238" }}>
                <span>Total {taxActive ? "TTC" : ""}</span><span>{fmt(total)}</span>
              </div>
            </div>
            {editingInvoiceId && (
              <div className="flex items-center justify-between mb-2 px-2 py-1.5 rounded text-xs" style={{ background: "#FBF3E3", color: "#8A6D1F" }}>
                <span>Modification d'une facture existante</span>
                <button onClick={cancelEditInvoice} className="underline">Annuler</button>
              </div>
            )}
            <div className="mb-2">
              <label className="text-xs" style={{ color: "#8A8370" }}>Date de la vente</label>
              <input type="date" value={saleDate} max={todayStr()} onChange={(e) => setSaleDate(e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Nom du client (optionnel)"
              className="w-full border rounded px-2 py-1.5 text-sm mb-2" style={{ borderColor: "#DDD6C4" }} />
            {planTier === "assisted" && client.trim().length >= 3 && (() => {
              const existingNames = [...new Set(invoices.map((i) => i.client).filter(Boolean))];
              const similar = suggestSimilarTiers(client, existingNames);
              if (!similar) return null;
              return (
                <div className="text-xs mb-2 flex items-center gap-2 flex-wrap" style={{ color: "#5B3FA0" }}>
                  <span>💡 Client existant similaire : « {similar} » — même personne ?</span>
                  <button onClick={() => setClient(similar)} className="underline font-medium">Utiliser ce nom</button>
                </div>
              );
            })()}
            <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}
              className="w-full border rounded px-2 py-1.5 text-sm mb-3" style={{ borderColor: "#DDD6C4" }}>
              <option value="caisse">Paiement en caisse</option>
              <option value="banque">Paiement par banque</option>
              <option value="credit">Vente à crédit (client)</option>
              <option value="don">Don (aucun paiement reçu)</option>
            </select>
            {paymentMode === "don" && (
              <div className="mb-3 p-2 rounded text-xs" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA", color: "#7A7460" }}>
                Aucune vente n'est enregistrée : le coût de revient de ces articles est comptabilisé en charge (Dons, libéralités), et le stock est décrémenté normalement.
              </div>
            )}
            {paymentMode === "credit" && !editingInvoiceId && (
              <div className="mb-3 p-3 rounded" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }}>
                <label className="text-xs" style={{ color: "#8A8370" }}>Versement reçu maintenant (optionnel)</label>
                <div className="flex gap-2 mt-1">
                  <input type="number" min="0" max={total} value={partialPaymentAmount} onChange={(e) => setPartialPaymentAmount(e.target.value)}
                    placeholder="0" className="flex-1 border rounded px-2 py-1.5 text-sm tabular" style={{ borderColor: "#DDD6C4" }} />
                  <select value={partialPaymentAccount} onChange={(e) => setPartialPaymentAccount(e.target.value)}
                    className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }}>
                    <option value="caisse">Caisse</option>
                    <option value="banque">Banque</option>
                  </select>
                </div>
                {Number(partialPaymentAmount) > 0 && (
                  <div className="text-xs mt-1.5" style={{ color: "#0F6B5C" }}>
                    Solde restant à crédit après ce versement : {fmt(Math.max(0, total - Math.min(Number(partialPaymentAmount) || 0, total)))}
                  </div>
                )}
              </div>
            )}
            <PendingRecommendationsBanner recommendations={pendingRecommendations} module="vente" onDismiss={resolvePendingRecommendation} />
            <AssistedPrincipleReminder planTier={planTier} text={paymentMode === "credit" ? "Une vente à crédit augmente les Comptes clients (411), pas la caisse — l'argent n'est encaissé que plus tard, au règlement." : "Une vente au comptant augmente directement la caisse ou la banque du montant encaissé, en contrepartie du chiffre d'affaires (706/707)."} />
            <button onClick={validateSale} disabled={hasPendingVente || saleBusy} data-pos="validate" className="w-full py-2 rounded text-sm text-white" style={{ background: "#152238", opacity: (hasPendingVente || saleBusy) ? 0.5 : 1 }}>
              {saleBusy ? "Enregistrement en cours…" : (editingInvoiceId ? "Enregistrer les modifications" : "Valider la vente")}
            </button>
          </div>
        </div>
      )}

      {tab === "factures" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Du</label>
              <input type="date" value={factFrom} onChange={(e) => setFactFrom(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
              <input type="date" value={factTo} onChange={(e) => setFactTo(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Nature</label>
              <select value={factNature} onChange={(e) => setFactNature(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }}>
                <option value="">Toutes ({invoices.length})</option>
                <option value="payee">Payées ({factPayeeCount})</option>
                <option value="impayee">Impayées ({factImpayeeCount})</option>
              </select>
            </div>
            {(factFrom || factTo || factNature) && (
              <button onClick={() => { setFactFrom(""); setFactTo(""); setFactNature(""); }} className="text-xs underline mb-1.5" style={{ color: "#8A8370" }}>
                Réinitialiser
              </button>
            )}
            {(factFrom || factTo || factNature) && (
              <div className="tabular text-xs mb-1.5 ml-auto" style={{ color: "#152238" }}>
                {factFiltered.length} facture{factFiltered.length > 1 ? "s" : ""} · Total {fmt(factFilteredTotal)}
              </div>
            )}
          </div>
          <div className="overflow-x-auto overflow-y-auto max-h-[65vh] border rounded" style={{ borderColor: "#EEE9DA" }}><table className="w-full text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-2 font-normal">N°</th>
                <th className="py-2 font-normal">Date</th>
                <th className="py-2 font-normal">Client</th>
                <th className="py-2 font-normal text-right">Montant</th>
                <th className="py-2 font-normal text-center">Statut</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {factFiltered.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center" style={{ color: "#A39C87" }}>{invoices.length === 0 ? "Aucune facture. Réalisez une vente depuis le POS." : "Aucune facture sur cette période."}</td></tr>
              )}
              {[...factFiltered].reverse().map((inv) => (
                <React.Fragment key={inv.id}>
                <tr
                  onClick={() => setExpandedInvoiceId(expandedInvoiceId === inv.id ? null : inv.id)}
                  className="cursor-pointer"
                  style={{ borderBottom: "1px solid #F3EFE3", background: expandedInvoiceId === inv.id ? "#FAF8F1" : "transparent" }}>
                  <td className="py-2 tabular">{inv.number}</td>
                  <td className="py-2 tabular">{inv.date}</td>
                  <td className="py-2">{inv.client}</td>
                  <td className="py-2 tabular text-right">{fmt(inv.total)}</td>
                  <td className="py-2 text-center">
                    <span className="text-xs px-2 py-0.5 rounded"
                      style={{
                        background: inv.status === "annulée" ? "#EEE9DA" : inv.status === "payée" ? "#E6F1EE" : inv.status === "partielle" ? "#FBF1DC" : inv.status === "don" ? "#EDEAF7" : "#F7E9E3",
                        color: inv.status === "annulée" ? "#7A7460" : inv.status === "payée" ? "#0F6B5C" : inv.status === "partielle" ? "#9A7B1E" : inv.status === "don" ? "#5B3FA0" : "#A6432F",
                        textDecoration: inv.status === "annulée" ? "line-through" : "none",
                      }}>
                      {inv.status === "partielle" ? `partielle (reste ${fmt(balanceDue(inv))})` : inv.status}
                    </span>
                  </td>
                  <td className="py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1 justify-end items-center">
                      {inv.status !== "payée" && inv.status !== "annulée" && inv.status !== "don" && inv.status !== "perte" && (
                        <>
                          <button onClick={() => encaisserFacture(inv, "530")} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Encaisser (caisse)</button>
                          <button onClick={() => encaisserFacture(inv, "512")} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Encaisser (banque)</button>
                          {role !== "Vendeur" && <button onClick={() => setChequeDlg({ id: inv.id })} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Encaisser (chèque)</button>}
                          {chequeDlg && chequeDlg.id === inv.id && (
                            <ChequeDialog title="Chèque reçu du client" partyLabel="Client" party={inv.client} askAmount amountDefault={balanceDue(inv)}
                              onClose={() => setChequeDlg(null)}
                              onConfirm={(cq, amt) => { setChequeDlg(null); encaisserFacture(inv, "5112", amt, cq); }} />
                          )}
                        </>
                      )}
                      <button onClick={() => setPrintInvoice(inv)} title="Imprimer" style={{ color: "#152238" }}><Printer size={14} /></button>
                      <button onClick={() => printInvoiceBluetooth(inv, settings, showToast)} title="Imprimer sur mini-imprimante Bluetooth" style={{ color: "#152238" }}><BluetoothIcon size={14} /></button>
                      <button onClick={() => downloadInvoicePDF(inv, settings)} title="Télécharger en PDF" style={{ color: "#152238" }}><Download size={14} /></button>
                      {inv.status !== "annulée" && role !== "Vendeur" && (
                        <button onClick={() => startEditInvoice(inv)} title="Modifier" style={{ color: "#152238" }}><Pencil size={14} /></button>
                      )}
                      {role === "Administrateur" && inv.status !== "annulée" && (
                        <button onClick={() => cancelInvoice(inv)} title="Annuler (contrepassation)" style={{ color: "#A6432F" }}><RotateCcw size={14} /></button>
                      )}
                    </div>
                  </td>
                </tr>
                {expandedInvoiceId === inv.id && (
                  <tr>
                    <td colSpan={6} className="py-3 px-3" style={{ background: "#FAF8F1" }}>
                      <div className="text-xs uppercase tracking-widest mb-2" style={{ color: "#8A8370" }}>Détail de la facture {inv.number}</div>
                      <div className="overflow-x-auto"><table className="w-full text-xs mb-2">
                        <thead>
                          <tr className="text-left" style={{ color: "#8A8370" }}>
                            <th className="py-1 font-normal">Article</th>
                            <th className="py-1 font-normal text-right">Qté</th>
                            <th className="py-1 font-normal text-right">Prix</th>
                            <th className="py-1 font-normal text-right">Remise</th>
                            <th className="py-1 font-normal text-right">Sous-total HT</th>
                            <th className="py-1 font-normal text-right">{inv.taxLabel || "Taxe"}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(inv.lines || []).map((l, i) => (
                            <tr key={i} style={{ borderTop: "1px solid #EEE9DA" }}>
                              <td className="py-1">{l.name}</td>
                              <td className="py-1 tabular text-right">{l.qty}</td>
                              <td className="py-1 tabular text-right">{fmt(l.price)}</td>
                              <td className="py-1 tabular text-right">{l.discountAmt > 0 ? `−${fmt(l.discountAmt)}` : l.discountPct > 0 ? `−${l.discountPct}%` : "—"}</td>
                              <td className="py-1 tabular text-right">{fmt(l.subtotal)}</td>
                              <td className="py-1 tabular text-right">{fmt(l.taxAmount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table></div>
                      <div className="text-xs space-y-0.5" style={{ color: "#7A7460" }}>
                        {inv.globalDiscountAmount > 0 && (
                          <div>Remise globale : −{fmt(inv.globalDiscountAmount)}{inv.globalDiscountAmtInput > 0 ? "" : ` (${inv.globalDiscountPct}%)`}</div>
                        )}
                        {(inv.fees || []).length > 0 && (
                          <div>Autres frais : {inv.fees.map((f) => `${f.label || "Frais"} (+${fmt(f.amount)})`).join(", ")}</div>
                        )}
                        <div>Sous-total HT : {fmt(inv.totalHT)} · {inv.taxLabel || "Taxe"} : {fmt(inv.totalTax)}</div>
                        <div className="font-medium" style={{ color: "#152238" }}>Total {inv.total !== inv.totalHT ? "TTC" : ""} : {fmt(inv.total)}</div>
                        <div>Mode de paiement : {inv.paymentMode === "caisse" ? "Caisse" : inv.paymentMode === "banque" ? "Banque" : inv.paymentMode === "don" ? "Don" : "Crédit"}</div>
                        {(inv.payments || []).length > 0 && (
                          <div className="mt-1">
                            Paiements reçus : {inv.payments.map((p) => `${fmt(p.amount)} le ${p.date} (${p.account === "530" ? "caisse" : p.account === "5112" ? `chèque n° ${p.cheque || "—"}` : "banque"})`).join(", ")}
                            {inv.status !== "payée" && <span> — reste dû : {fmt(balanceDue(inv))}</span>}
                          </div>
                        )}
                      </div>
                      <RecordedStamp createdAt={inv.createdAt} />
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === "rapport" && (() => {
        const allDayInvoices = invoices.filter((inv) => inv.date === reportDate && inv.status !== "annulée");
        const effectiveStationFilter = role === "Vendeur" ? (currentStation ? stationId : "") : stationFilter;
        // Comparaison par identifiant ET par nom : si un poste a été supprimé puis
        // recréé sous le même nom, son identifiant technique change mais le nom
        // affiché reste identique — sans ce repli sur le nom, les ventes passées
        // "disparaîtraient" du filtre alors qu'elles appartiennent bien à ce poste.
        const effectiveStationName = effectiveStationFilter ? (salesStations || []).find((s) => String(s.id) === String(effectiveStationFilter))?.name : null;
        // Un Vendeur ne voit jamais le total des autres postes. Quand les postes sont en
        // service, un Vendeur sans poste choisi n'a pas de rapport à voir : on lui demande
        // de choisir son poste plutôt que de lui montrer les ventes de tout le monde.
        const stationsInUse = planTier === "assisted" && (salesStations || []).length > 0;
        const vendeurSansPoste = role === "Vendeur" && stationsInUse && !currentStation;
        const dayInvoices = vendeurSansPoste ? [] : effectiveStationFilter === "__none__"
          ? allDayInvoices.filter((inv) => !inv.stationId && !inv.stationName)
          : effectiveStationFilter
            ? allDayInvoices.filter((inv) => String(inv.stationId) === String(effectiveStationFilter) || (effectiveStationName && inv.stationName === effectiveStationName))
            : allDayInvoices;
        const totalVentes = dayInvoices.reduce((s, inv) => s + Number(inv.total || 0), 0);
        const nbFiches = dayInvoices.length;
        const panierMoyen = nbFiches > 0 ? totalVentes / nbFiches : 0;
        const payeesCount = dayInvoices.filter((inv) => inv.status === "payée").length;
        const impayeesCount = nbFiches - payeesCount;

        const parClient = {};
        dayInvoices.forEach((inv) => {
          const key = inv.client || "Client comptant";
          parClient[key] = (parClient[key] || 0) + Number(inv.total || 0);
        });
        const meilleurClient = Object.entries(parClient).sort((a, b) => b[1] - a[1])[0];

        const parMode = {};
        dayInvoices.forEach((inv) => {
          const key = inv.paymentMode === "banque" ? "Banque" : inv.paymentMode === "credit" ? "À crédit" : "Caisse";
          parMode[key] = (parMode[key] || 0) + Number(inv.total || 0);
        });

        // Répartition par poste de vente (forfait Assisté uniquement) — une vente
        // sans poste assigné (forfait Standard, ou poste non sélectionné ce jour-là)
        // est regroupée sous "Sans poste assigné" plutôt qu'ignorée, pour que le
        // total du tableau corresponde toujours au total général du jour.
        const parStation = {};
        allDayInvoices.forEach((inv) => {
          const key = inv.stationName || "Sans poste assigné";
          if (!parStation[key]) parStation[key] = { count: 0, total: 0, sellers: new Set() };
          parStation[key].count += 1;
          parStation[key].total += Number(inv.total || 0);
          if (inv.soldByName || inv.soldByEmail) {
            parStation[key].sellers.add([inv.soldByName, inv.soldByEmail].filter(Boolean).join(" — "));
          }
        });

        const parProduit = {};
        dayInvoices.forEach((inv) => {
          (inv.lines || []).forEach((l) => {
            const key = l.name || "Article";
            if (!parProduit[key]) parProduit[key] = { qty: 0, total: 0 };
            parProduit[key].qty += Number(l.qty || 0);
            parProduit[key].total += Number(l.subtotal || 0);
          });
        });
        const meilleurProduit = Object.entries(parProduit).sort((a, b) => b[1].qty - a[1].qty)[0];

        // Impôt collecté, remises accordées et bénéfice réalisé sur les ventes du jour.
        const impotsCollectes = dayInvoices.reduce((s, inv) => s + Number(inv.totalTax || 0), 0);
        const remiseAccordee = dayInvoices.reduce((s, inv) => {
          const remiseLignes = (inv.lines || []).reduce((s2, l) => s2 + (Number(l.price || 0) * Number(l.qty || 0) - Number(l.subtotal || 0)), 0);
          return s + remiseLignes + Number(inv.globalDiscountAmount || 0);
        }, 0);
        let beneficeRealise = 0;
        let articlesSansCoutQty = 0;
        dayInvoices.forEach((inv) => {
          (inv.lines || []).forEach((l) => {
            const p = products.find((pr) => pr.id === l.productId);
            if (p && Number(p.costPrice) > 0) {
              beneficeRealise += Number(l.subtotal || 0) - Number(p.costPrice) * Number(l.qty || 0);
            } else {
              articlesSansCoutQty += Number(l.qty || 0);
            }
          });
        });

        return (
          <div>
            <div className="mb-5 flex flex-wrap gap-4 items-end">
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Date du rapport</label>
                <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)}
                  className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
              </div>
              {planTier === "assisted" && (salesStations || []).length > 0 && (
                <div>
                  <label className="text-xs" style={{ color: "#8A8370" }}>{role === "Vendeur" ? "Poste" : "Filtrer par poste"}</label>
                  {role === "Vendeur" ? (
                    <div className="border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", background: "#FAF8F1", color: "#7A7460" }}>
                      {currentStation ? currentStation.name : "Aucun poste sélectionné"}
                    </div>
                  ) : (
                    <select value={stationFilter} onChange={(e) => setStationFilter(e.target.value)}
                      className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                      <option value="">Tous les postes</option>
                      {salesStations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      <option value="__none__">Sans poste assigné</option>
                    </select>
                  )}
                </div>
              )}
            </div>

            {nbFiches === 0 ? (
              <div className="bg-white rounded-lg p-8 text-center text-sm" style={{ border: "1px solid #E4DFD1", color: "#A39C87" }}>
                {vendeurSansPoste
                  ? "Choisissez votre poste dans l'onglet Point de vente pour voir le rapport de votre poste."
                  : `Aucune vente enregistrée pour le ${reportDate}${effectiveStationFilter === "__none__" ? " sans poste assigné" : effectiveStationFilter ? " sur le poste sélectionné" : ""}.`}
              </div>
            ) : (
              <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
                <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
                  <div className="text-xs" style={{ color: "#8A8370" }}>Montant des ventes</div>
                  <div className="text-xl tabular font-medium" style={{ color: "#0F6B5C" }}>{fmt(totalVentes)}</div>
                </div>
                <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
                  <div className="text-xs" style={{ color: "#8A8370" }}>Fiches vendues</div>
                  <div className="text-xl tabular font-medium" style={{ color: "#152238" }}>{nbFiches}</div>
                </div>
                <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
                  <div className="text-xs" style={{ color: "#8A8370" }}>Panier moyen</div>
                  <div className="text-xl tabular font-medium" style={{ color: "#152238" }}>{fmt(panierMoyen)}</div>
                </div>
                <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
                  <div className="text-xs" style={{ color: "#8A8370" }}>Payées / Impayées</div>
                  <div className="text-xl tabular font-medium" style={{ color: "#152238" }}>{payeesCount} / {impayeesCount}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-5">
                <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
                  <div className="text-xs" style={{ color: "#8A8370" }}>Impôt collecté ({taxLabel || "taxe"})</div>
                  <div className="text-xl tabular font-medium" style={{ color: "#152238" }}>{fmt(impotsCollectes)}</div>
                </div>
                <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
                  <div className="text-xs" style={{ color: "#8A8370" }}>Remises accordées</div>
                  <div className="text-xl tabular font-medium" style={{ color: "#A6432F" }}>{remiseAccordee > 0 ? `−${fmt(remiseAccordee)}` : fmt(0)}</div>
                </div>
                <div className="bg-white rounded-lg p-4 col-span-2 md:col-span-1" style={{ border: "1px solid #E4DFD1" }}>
                  <div className="text-xs" style={{ color: "#8A8370" }}>Bénéfice réalisé (selon marges du catalogue)</div>
                  <div className="text-xl tabular font-medium" style={{ color: beneficeRealise >= 0 ? "#0F6B5C" : "#A6432F" }}>{fmt(beneficeRealise)}</div>
                  {articlesSansCoutQty > 0 && (
                    <div className="text-xs mt-1" style={{ color: "#A39C87" }}>
                      Sous-estimé : {articlesSansCoutQty} unité{articlesSansCoutQty > 1 ? "s" : ""} vendue{articlesSansCoutQty > 1 ? "s" : ""} sans prix de revient renseigné dans le Catalogue
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
                  <div className="text-sm font-medium mb-2" style={{ color: "#152238" }}>Meilleur client du jour</div>
                  {meilleurClient ? (
                    <div className="text-sm">{meilleurClient[0]} — <span className="tabular font-medium">{fmt(meilleurClient[1])}</span></div>
                  ) : <div className="text-sm" style={{ color: "#A39C87" }}>—</div>}
                </div>
                <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
                  <div className="text-sm font-medium mb-2" style={{ color: "#152238" }}>Article le plus vendu</div>
                  {meilleurProduit ? (
                    <div className="text-sm">{meilleurProduit[0]} — <span className="tabular font-medium">{meilleurProduit[1].qty} unité{meilleurProduit[1].qty > 1 ? "s" : ""}</span></div>
                  ) : <div className="text-sm" style={{ color: "#A39C87" }}>—</div>}
                </div>
              </div>

              <div className="bg-white rounded-lg p-4 mb-5" style={{ border: "1px solid #E4DFD1" }}>
                <div className="text-sm font-medium mb-2" style={{ color: "#152238" }}>Répartition par mode de paiement</div>
                <div className="flex flex-wrap gap-4 text-sm">
                  {Object.entries(parMode).map(([mode, total]) => (
                    <div key={mode}>{mode} : <span className="tabular font-medium">{fmt(total)}</span></div>
                  ))}
                </div>
              </div>

              {planTier === "assisted" && (salesStations || []).length > 0 && role !== "Vendeur" && (
                <div className="bg-white rounded-lg p-4 mb-5" style={{ border: "1px solid #E4DFD1" }}>
                  <div className="text-sm font-medium mb-2" style={{ color: "#152238" }}>Répartition par poste de vente</div>
                  <div className="overflow-x-auto"><table className="w-full text-sm">
                    <thead>
                      <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                        <th className="py-1.5 font-normal">Poste</th>
                        <th className="py-1.5 font-normal">Vendeur(s)</th>
                        <th className="py-1.5 font-normal text-right">Ventes</th>
                        <th className="py-1.5 font-normal text-right">Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(parStation).map(([name, s]) => (
                        <tr key={name} style={{ borderBottom: "1px solid #F3EFE3" }}>
                          <td className="py-1.5">{name}</td>
                          <td className="py-1.5 text-xs" style={{ color: "#7A7460" }}>{[...s.sellers].join(", ") || "—"}</td>
                          <td className="py-1.5 tabular text-right">{s.count}</td>
                          <td className="py-1.5 tabular text-right">{fmt(s.total)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td className="py-1.5 font-medium">Total général</td>
                        <td className="py-1.5"></td>
                        <td className="py-1.5 tabular text-right font-medium">{Object.values(parStation).reduce((s, v) => s + v.count, 0)}</td>
                        <td className="py-1.5 tabular text-right font-medium">{fmt(Object.values(parStation).reduce((s, v) => s + v.total, 0))}</td>
                      </tr>
                    </tbody>
                  </table></div>
                </div>
              )}

              <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
                <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Détail des ventes du jour</div>
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead>
                    <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                      <th className="py-2 font-normal">N°</th>
                      <th className="py-2 font-normal">Client</th>
                      {planTier === "assisted" && <th className="py-2 font-normal">Vendeur</th>}
                      <th className="py-2 font-normal text-right">Montant</th>
                      <th className="py-2 font-normal text-center">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...dayInvoices].reverse().map((inv) => (
                      <tr key={inv.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                        <td className="py-2 tabular">{inv.number}</td>
                        <td className="py-2">{inv.client}</td>
                        {planTier === "assisted" && <td className="py-2 text-xs" style={{ color: "#7A7460" }}>{[inv.soldByName, inv.soldByEmail].filter(Boolean).join(" — ") || "—"}</td>}
                        <td className="py-2 tabular text-right">{fmt(inv.total)}</td>
                        <td className="py-2 text-center">
                          <span className="text-xs px-2 py-0.5 rounded" style={{ background: inv.status === "payée" ? "#E6F1EE" : "#FBF1DC", color: inv.status === "payée" ? "#0F6B5C" : "#9A7B1E" }}>{inv.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </div>
              </>
            )}
          </div>
        );
      })()}

      {tab === "catalogue" && (
        <div style={role === "Vendeur" ? { pointerEvents: "none", opacity: 0.6 } : undefined}>
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          {role === "Vendeur" && (
            <div className="mb-4 text-xs px-3 py-2 rounded flex items-center gap-2" style={{ background: "#FBF1DC", color: "#9A7B1E" }}>
              <Lock size={13} /> Catalogue en lecture seule — contactez un administrateur pour ajouter, modifier ou retirer un article.
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-8 gap-3 mb-5 items-end">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Photo</label>
              <label className="mt-1 flex items-center justify-center rounded cursor-pointer overflow-hidden"
                style={{ width: 38, height: 38, border: "1px dashed #DDD6C4", background: newProduct.image ? "transparent" : "#FAF8F1" }}>
                {imgLoading ? (
                  <span className="text-[9px]" style={{ color: "#A39C87" }}>...</span>
                ) : newProduct.image ? (
                  <img src={newProduct.image} alt="" className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon size={16} style={{ color: "#A39C87" }} />
                )}
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              </label>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Code</label>
              <div className="flex gap-1 mt-1">
                <input value={newProduct.code} onChange={(e) => setNewProduct({ ...newProduct, code: e.target.value })}
                  placeholder="Manuel ou scanné" className="flex-1 min-w-0 border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }} />
                <button type="button" onClick={() => setShowScanner(true)} title="Scanner un code-barres ou QR"
                  className="shrink-0 border rounded px-2 flex items-center justify-center" style={{ borderColor: "#DDD6C4", color: "#152238" }}>
                  <ScanLine size={16} />
                </button>
              </div>
            </div>
            <div className="col-span-2">
              <label className="text-xs" style={{ color: "#8A8370" }}>Intitulé</label>
              <input value={newProduct.name} onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Prix HT (vente)</label>
              <input type="number" value={newProduct.price} onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Prix de revient</label>
              <input type="number" min="0" value={newProduct.costPrice} onChange={(e) => setNewProduct({ ...newProduct, costPrice: e.target.value })}
                placeholder="0" className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>{taxLabel} %</label>
              <input type="number" value={newProduct.tva} onChange={(e) => setNewProduct({ ...newProduct, tva: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Type</label>
              <select value={newProduct.type} onChange={(e) => setNewProduct({ ...newProduct, type: e.target.value, account: e.target.value === "service" ? "706" : "707" })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="service">Service</option>
                <option value="marchandise">Marchandise</option>
              </select>
            </div>
            {newProduct.type === "marchandise" && (
              <>
                <div>
                  <label className="text-xs" style={{ color: "#8A8370" }}>Stock {editingProductId ? "actuel" : "initial"}</label>
                  <input type="number" min="0" value={newProduct.stock} onChange={(e) => setNewProduct({ ...newProduct, stock: e.target.value })}
                    placeholder="0" className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
                  {editingProductId && (
                    <div className="text-xs mt-1" style={{ color: "#A39C87" }}>
                      Pour une réception normale, préférez plutôt Stock et inventaire → Mouvements (garde une trace). Ce champ écrase directement la valeur, sans laisser de trace dans les mouvements.
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs" style={{ color: "#8A8370" }}>Seuil d'alerte</label>
                  <input type="number" min="0" value={newProduct.seuil} onChange={(e) => setNewProduct({ ...newProduct, seuil: e.target.value })}
                    placeholder="5" className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
                </div>
              </>
            )}
            <button onClick={addProduct} className="flex items-center justify-center gap-2 px-4 py-2 rounded text-sm text-white h-[38px]" style={{ background: "#152238" }}>
              {editingProductId ? <CheckCircle2 size={14} /> : <Plus size={14} />}
              {editingProductId ? "Enregistrer" : "Ajouter"}
            </button>
          </div>
          {editingProductId && (
            <div className="flex items-center gap-2 mb-4 text-xs" style={{ color: "#A6432F" }}>
              Modification de « {products.find((p) => p.id === editingProductId)?.name} » en cours.
              <button onClick={cancelEditProduct} className="underline">Annuler</button>
            </div>
          )}
          {products.some((p) => Number(p.tva) !== Number(settings.taxRate)) && (
            <div className="flex items-center gap-2 mb-4 text-xs flex-wrap p-2 rounded" style={{ background: "#FBF1DC", color: "#9A7B1E" }}>
              <span>Certains articles ont un taux différent du taux par défaut actuel ({settings.taxRate}%).</span>
              <button
                onClick={() => {
                  if (!window.confirm(`Appliquer le taux par défaut (${settings.taxRate}%) à TOUS les articles du catalogue, y compris ceux avec un taux différent actuellement ? Cette action est irréversible.`)) return;
                  setProducts((prev) => prev.map((p) => ({ ...p, tva: settings.taxRate })));
                  showToast(`Taux de ${settings.taxRate}% appliqué à tous les articles.`);
                  logAudit("Vente", "Application taxe en masse", `${settings.taxRate}% sur tous les articles`);
                }}
                className="underline font-medium">
                Appliquer {settings.taxRate}% à tous les articles
              </button>
            </div>
          )}
          <div className="overflow-x-auto overflow-y-auto max-h-[65vh] border rounded" style={{ borderColor: "#EEE9DA" }}><table className="w-full text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-2 font-normal">Photo</th>
                <th className="py-2 font-normal">Code</th>
                <th className="py-2 font-normal">Intitulé</th>
                <th className="py-2 font-normal">Type</th>
                <th className="py-2 font-normal">Compte de vente</th>
                <th className="py-2 font-normal text-right">Prix HT</th>
                <th className="py-2 font-normal text-right">Prix de revient</th>
                <th className="py-2 font-normal text-right">Marge</th>
                <th className="py-2 font-normal text-right">{taxLabel}</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 && (
                <tr><td colSpan={9} className="py-8 text-center" style={{ color: "#A39C87" }}>Aucun article. Ajoutez-en un ci-dessus.</td></tr>
              )}
              {products.map((p) => {
                const dupName = products.filter((x) => x.name.trim().toLowerCase() === p.name.trim().toLowerCase()).length > 1;
                const margin = p.price - (p.costPrice || 0);
                const marginPct = p.price > 0 ? (margin / p.price) * 100 : 0;
                return (
                <tr key={p.id} style={{ borderBottom: "1px solid #F3EFE3", background: editingProductId === p.id ? "#FAF8F1" : "transparent" }}>
                  <td className="py-2">
                    {productImages[p.id] ? (
                      <img src={productImages[p.id]} alt="" className="w-8 h-8 rounded object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded flex items-center justify-center" style={{ background: "#F3EFE3" }}>
                        <ImageIcon size={13} style={{ color: "#C7C0AD" }} />
                      </div>
                    )}
                  </td>
                  <td className="py-2 tabular">{p.code}</td>
                  <td className="py-2">
                    {p.name}
                    <RecordedStamp createdAt={p.createdAt} />
                    {dupName && (
                      <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded" style={{ background: "#F7E9E3", color: "#A6432F" }} title="Un autre article porte le même nom — deux fiches distinctes avec des stocks séparés">
                        doublon ?
                      </span>
                    )}
                  </td>
                  <td className="py-2">{p.type === "service" ? "Service" : "Marchandise"}</td>
                  <td className="py-2 tabular">{p.account}</td>
                  <td className="py-2 tabular text-right">{fmt(p.price)}</td>
                  <td className="py-2 tabular text-right" style={{ color: "#7A7460" }}>{p.costPrice > 0 ? fmt(p.costPrice) : "—"}</td>
                  <td className="py-2 tabular text-right" style={{ color: p.costPrice > 0 ? (margin >= 0 ? "#0F6B5C" : "#A6432F") : "#C7C0AD" }}>
                    {p.costPrice > 0 ? `${fmt(margin)} (${marginPct.toFixed(0)}%)` : "—"}
                  </td>
                  <td className="py-2 tabular text-right">{taxActive ? `${p.tva || 0}%` : "—"}</td>
                  <td className="py-2 text-right">
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setHistoryProductId(p.id)} title="Historique"><History size={14} /></button>
                      <button onClick={() => startEditProduct(p)} title="Modifier" style={{ color: "#152238" }}><Pencil size={14} /></button>
                      <button onClick={() => deleteProduct(p.id)} title="Supprimer" style={{ color: "#A6432F" }}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
        </div>
      )}

      {showScanner && (
        <BarcodeScannerModal
          onScan={(code) => { setNewProduct((p) => ({ ...p, code })); setShowScanner(false); showToast("Code scanné avec succès."); }}
          onClose={() => setShowScanner(false)}
        />
      )}

      {showPosScanner && (
        <BarcodeScannerModal
          onScan={handleScannedCode}
          onClose={() => setShowPosScanner(false)}
        />
      )}
    </div>

      {printInvoice && (settings.receiptFormat === "ticket80" || settings.receiptFormat === "ticket58") && (
        <div className={`print-only ${settings.receiptFormat === "ticket80" ? "ticket-print-80" : "ticket-print-58"}`}
          style={{ color: "#000", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, width: settings.receiptFormat === "ticket80" ? "74mm" : "52mm" }}>
          <div style={{ textAlign: "center", marginBottom: 6 }}>
            {settings.companyLogo && (
              <img src={settings.companyLogo} alt="" style={{ width: 28, height: 28, objectFit: "contain", margin: "0 auto 4px" }} />
            )}
            <div style={{ fontWeight: 700, fontSize: 12 }}>{settings.companyName || "Mon Entreprise"}</div>
            {settings.companyAddress && <div style={{ fontSize: 8 }}>{settings.companyAddress}</div>}
            {(settings.companyPhone || settings.companyEmail) && (
              <div style={{ fontSize: 8 }}>{[settings.companyPhone, settings.companyEmail].filter(Boolean).join(" · ")}</div>
            )}
          </div>
          <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
          <div>Facture N° {printInvoice.number}</div>
          <div>{printInvoice.date}</div>
          <div>Client : {printInvoice.client || "Client comptant"}</div>
          {printInvoice.soldByName && <div>Vendeur : {printInvoice.soldByName}</div>}
          <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
          {(printInvoice.lines || []).map((l, i) => (
            <div key={i} style={{ marginBottom: 3 }}>
              <div>{l.name}</div>
              <div className="tabular" style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{l.qty} x {fmt(l.price)}</span><span>{fmt(l.subtotal)}</span>
              </div>
            </div>
          ))}
          <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
          <div className="tabular" style={{ display: "flex", justifyContent: "space-between" }}><span>Sous-total HT</span><span>{fmt(printInvoice.totalHT)}</span></div>
          {printInvoice.globalDiscountAmount > 0 && (
            <div className="tabular" style={{ display: "flex", justifyContent: "space-between" }}><span>Remise</span><span>-{fmt(printInvoice.globalDiscountAmount)}</span></div>
          )}
          {(printInvoice.fees || []).map((f, i) => (
            <div key={i} className="tabular" style={{ display: "flex", justifyContent: "space-between" }}><span>{f.label || "Frais"}</span><span>+{fmt(f.amount)}</span></div>
          ))}
          <div className="tabular" style={{ display: "flex", justifyContent: "space-between" }}><span>{printInvoice.taxLabel || "Taxe"}</span><span>{fmt(printInvoice.totalTax)}</span></div>
          <div className="tabular" style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 12, marginTop: 4 }}><span>TOTAL</span><span>{fmt(printInvoice.total)}</span></div>
          <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
          <div style={{ textAlign: "center", fontSize: 8 }}>
            Paiement : {printInvoice.paymentMode === "caisse" ? "Caisse" : printInvoice.paymentMode === "banque" ? "Banque" : "Crédit"}<br />
            {(printInvoice.payments || []).length > 0 && (
              <>Versé : {fmt(printInvoice.payments.reduce((s, p) => s + p.amount, 0))} — Solde dû : {fmt(Math.max(0, (printInvoice.total || 0) - printInvoice.payments.reduce((s, p) => s + p.amount, 0)))}<br /></>
            )}
            Merci de votre confiance !
            {settings.invoiceFooterNote && settings.invoiceFooterNote.trim() && (
              <><br />{settings.invoiceFooterNote.trim()}</>
            )}
          </div>
        </div>
      )}
      {printInvoice && settings.receiptFormat !== "ticket80" && settings.receiptFormat !== "ticket58" && (
        <div className="print-only" style={{ color: "#152238", fontFamily: "'Inter', sans-serif" }}>
          <div className="flex justify-between items-center mb-6" style={{ borderBottom: "2px solid #152238", paddingBottom: 16 }}>
            <div className="flex items-center gap-3">
              {settings.companyLogo && (
                <img src={settings.companyLogo} alt="" style={{ width: 44, height: 44, objectFit: "contain", flexShrink: 0 }} />
              )}
              <div>
                <div className="display" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{settings.companyName || "Mon Entreprise"}</div>
                {settings.companyAddress && <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>{settings.companyAddress}</div>}
                {(settings.companyPhone || settings.companyEmail) && (
                  <div style={{ fontSize: 12, color: "#555", marginTop: 1 }}>{[settings.companyPhone, settings.companyEmail].filter(Boolean).join(" · ")}</div>
                )}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>FACTURE</div>
              <div className="tabular" style={{ fontSize: 13, lineHeight: 1.6 }}>N° {printInvoice.number}</div>
              <div className="tabular" style={{ fontSize: 13, lineHeight: 1.6 }}>{printInvoice.date}</div>
            </div>
          </div>

          <div className="flex justify-between mb-6" style={{ fontSize: 13 }}>
            <div>
              <div style={{ color: "#888", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Facturé à</div>
              <div style={{ fontWeight: 600, marginTop: 2 }}>{printInvoice.client || "Client comptant"}</div>
              {printInvoice.soldByName && <div style={{ fontSize: 12, color: "#7A7460", marginTop: 2 }}>Vendeur : {printInvoice.soldByName}</div>}
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#888", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Statut</div>
              <div style={{ fontWeight: 600, marginTop: 2 }}>
                {printInvoice.status === "payée" ? "Payée" : printInvoice.status === "partielle" ? `Partiellement payée (reste ${fmt(balanceDue(printInvoice))})` : "Impayée"}
              </div>
            </div>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #152238" }}>
                <th style={{ textAlign: "left", padding: "6px 4px" }}>Article</th>
                <th style={{ textAlign: "right", padding: "6px 4px" }}>Qté</th>
                <th style={{ textAlign: "right", padding: "6px 4px" }}>Prix unit.</th>
                <th style={{ textAlign: "right", padding: "6px 4px" }}>Remise</th>
                <th style={{ textAlign: "right", padding: "6px 4px" }}>Sous-total HT</th>
                <th style={{ textAlign: "right", padding: "6px 4px" }}>{printInvoice.taxLabel || "Taxe"}</th>
              </tr>
            </thead>
            <tbody>
              {(printInvoice.lines || []).map((l, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #E4DFD1" }}>
                  <td style={{ padding: "6px 4px" }}>{l.name}</td>
                  <td className="tabular" style={{ textAlign: "right", padding: "6px 4px" }}>{l.qty}</td>
                  <td className="tabular" style={{ textAlign: "right", padding: "6px 4px" }}>{fmt(l.price)}</td>
                  <td className="tabular" style={{ textAlign: "right", padding: "6px 4px" }}>{l.discountAmt > 0 ? `-${fmt(l.discountAmt)}` : l.discountPct > 0 ? `-${l.discountPct}%` : "—"}</td>
                  <td className="tabular" style={{ textAlign: "right", padding: "6px 4px" }}>{fmt(l.subtotal)}</td>
                  <td className="tabular" style={{ textAlign: "right", padding: "6px 4px" }}>{fmt(l.taxAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <div style={{ width: 260, fontSize: 13 }}>
              <div className="flex justify-between tabular" style={{ padding: "3px 0" }}><span>Sous-total HT</span><span>{fmt(printInvoice.totalHT)}</span></div>
              {printInvoice.globalDiscountAmount > 0 && (
                <div className="flex justify-between tabular" style={{ padding: "3px 0" }}><span>Remise globale</span><span>-{fmt(printInvoice.globalDiscountAmount)}</span></div>
              )}
              {(printInvoice.fees || []).length > 0 && printInvoice.fees.map((f, i) => (
                <div key={i} className="flex justify-between tabular" style={{ padding: "3px 0" }}><span>{f.label || "Frais"}</span><span>+{fmt(f.amount)}</span></div>
              ))}
              <div className="flex justify-between tabular" style={{ padding: "3px 0" }}><span>{printInvoice.taxLabel || "Taxe"}</span><span>{fmt(printInvoice.totalTax)}</span></div>
              <div className="flex justify-between tabular" style={{ padding: "8px 0", borderTop: "2px solid #152238", marginTop: 4, fontWeight: 700, fontSize: 15 }}>
                <span>Total {printInvoice.totalTax > 0 ? "TTC" : ""}</span><span>{fmt(printInvoice.total)}</span>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 32, fontSize: 12, color: "#888", borderTop: "1px solid #E4DFD1", paddingTop: 12 }}>
            Mode de paiement : {printInvoice.paymentMode === "caisse" ? "Caisse" : printInvoice.paymentMode === "banque" ? "Banque" : printInvoice.paymentMode === "don" ? "Don" : "Crédit"} — Merci de votre confiance.
            {(printInvoice.payments || []).length > 0 && (
              <div style={{ marginTop: 4 }}>
                Versé : {fmt(printInvoice.payments.reduce((s, p) => s + p.amount, 0))} — Solde dû : {fmt(Math.max(0, (printInvoice.total || 0) - printInvoice.payments.reduce((s, p) => s + p.amount, 0)))}
              </div>
            )}
            {settings.invoiceFooterNote && settings.invoiceFooterNote.trim() && (
              <div style={{ marginTop: 6 }}>{settings.invoiceFooterNote.trim()}</div>
            )}
          </div>
        </div>
      )}

      {historyProductId && (
        <ProductHistoryModal productId={historyProductId} products={products} movements={movements} onClose={() => setHistoryProductId(null)} />
      )}
    </>
  );
}


function ComptaModule({ accounts, setAccounts, entries, setEntries, invoices, setInvoices, balances, settings, setSettings, assets, setAssets, accruals, setAccruals, deferrals, setDeferrals, riskProvisions, setRiskProvisions, entryTemplates, setEntryTemplates, role, showToast, logAudit, verifyTransactionSaved, planTier, recordPendingRecommendation, currentUserEmail, pendingRecommendations, resolvePendingRecommendation, pendingApprovals, setPendingApprovals, companyId, isAccountant, assistantActive, assistantFindings, assistantAll, assistantJump, products }) {
  const lastSubmitRef = React.useRef(0); // anti double-clic/double-tap sur "Enregistrer l'écriture"
  const anomalyGate = useAssistedAnomalyGate();
  const hasPendingCompta = (pendingRecommendations || []).some((r) => r.module === "comptabilite");
  const applyReversedCorrection = (r) => {
    const payload = r.correction_payload;
    if (!payload) return;
    setEntries((prev) => [...prev, { id: uid(), date: payload.date, createdAt: new Date().toISOString(), label: `${payload.label} (corrigée)`, lines: payload.lines }]);
    logAudit("Comptabilité", "Application correction automatique", payload.label);
    showToast("Écriture corrigée appliquée.");
    resolvePendingRecommendation?.(r.id);
  };
  const [tab, setTab] = useState("journal");
  useBackNav(tab, setTab, "journal");
  useEffect(() => { if (assistantJump) setTab("assistant"); }, [assistantJump]); // eslint-disable-line
  const [date, setDate] = useState(todayStr());
  const [label, setLabel] = useState("");
  const [lines, setLines] = useState([
    { account: accounts[0]?.code, debit: "", credit: "" },
    { account: accounts[1]?.code, debit: "", credit: "" },
  ]);
  const [expanded, setExpanded] = useState(null);
  const [newAccount, setNewAccount] = useState({ code: "", name: "", type: "Charge" });

  // --- Associés (sous-comptes de capital 101.N) ---
  const lastAssociateSubmitRef = React.useRef(0);
  const associateAccounts = accounts
    .filter((a) => /^101\.\d+$/.test(a.code))
    .map((a) => ({ ...a, solde: -(balances[a.code] || 0) }));
  const emptyAssociateForm = { mode: "existing", associateCode: "", newName: "", date: todayStr(), amount: "", payAccount: "530" };
  const [associateForm, setAssociateForm] = useState(emptyAssociateForm);

  const recordCapitalContribution = () => {
    if (Date.now() - lastAssociateSubmitRef.current < 800) return; // double-clic/double-tap ignoré
    lastAssociateSubmitRef.current = Date.now();
    const amount = Number(associateForm.amount);
    if (!amount || amount <= 0) { showToast("Montant invalide."); return; }
    if (isFutureDate(associateForm.date)) { showToast("Impossible d'enregistrer un apport à une date future."); return; }
    if (isLocked(associateForm.date, settings)) { showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus.`); return; }

    let subCode = associateForm.associateCode;
    let associateName = "";
    let accountsToAdd = null;

    if (associateForm.mode === "new") {
      if (!associateForm.newName.trim()) { showToast("Le nom de l'associé est requis."); return; }
      associateName = associateForm.newName.trim();
      const usedNums = accounts
        .map((a) => { const m = a.code.match(/^101\.(\d+)$/); return m ? Number(m[1]) : 0; })
        .filter(Boolean);
      const nextNum = (usedNums.length ? Math.max(...usedNums) : 0) + 1;
      subCode = `101.${nextNum}`;
      accountsToAdd = { code: subCode, name: `Capital — ${associateName}`, type: "Capitaux propres" };
    } else {
      if (!subCode) { showToast("Sélectionnez un associé."); return; }
      associateName = associateAccounts.find((a) => a.code === subCode)?.name.replace(/^Capital — /, "") || "";
    }

    if (accountsToAdd) setAccounts((prev) => [...prev, accountsToAdd]);
    const capitalEntry = simpleEntry(associateForm.date, `Apport de capital — ${associateName}`, associateForm.payAccount, subCode, amount);
    setEntries((prev) => [...prev, capitalEntry]);
    showToast(`Apport de ${fmt(amount)} enregistré pour ${associateName}.`);
    logAudit("Comptabilité", "Apport de capital", `${associateName} — ${fmt(amount)} (${subCode})`);
    setAssociateForm(emptyAssociateForm);
    verifyTransactionSaved(`Apport de capital — ${associateName}`, [
      { category: "entries", label: "écriture d'apport", isPresent: (arr) => arr.some((e) => e.id === capitalEntry.id), buildNext: () => [...entries, capitalEntry] },
      ...(accountsToAdd ? [{ category: "accounts", label: "sous-compte associé", isPresent: (arr) => arr.some((a) => a.code === accountsToAdd.code), buildNext: () => [...accounts, accountsToAdd] }] : []),
    ], { showToast, logAudit });
  };

  const [journalFrom, setJournalFrom] = useState("");
  const [journalTo, setJournalTo] = useState("");
  const [journalAccount, setJournalAccount] = useState("");
  const [chainCheck, setChainCheck] = useState(null);
  const runChainCheck = () => setChainCheck(verifyChain(entries));
  const [chainFullCheck, setChainFullCheck] = useState(null);
  const runChainFullCheck = () => setChainFullCheck(verifyChainFull(entries));

  // Rescellement : recalcule hash/prevHash de TOUTES les écritures à partir de leur
  // contenu ACTUEL. À utiliser uniquement après avoir confirmé, écriture par écriture
  // via l'analyse complète, qu'aucune n'a été réellement altérée (juste scellée sous un
  // format de hash antérieur) — cette action accepterait aussi silencieusement une
  // vraie altération si elle existait, d'où la confirmation stricte exigée.
  const reseal = () => {
    if (role !== "Administrateur") { showToast("Seul un administrateur peut resceller le journal."); return; }
    const typed = window.prompt("Cette action recalcule le scellement de TOUTES les écritures à partir de leur contenu actuel. À utiliser seulement si vous avez vérifié qu'aucune n'a été réellement modifiée depuis sa création — sinon, une altération réelle deviendrait indétectable. Tapez RESCELLER pour confirmer :");
    if (typed !== "RESCELLER") { showToast("Rescellement annulé."); return; }
    let prevHash = GENESIS_HASH;
    const resealed = entries.map((e) => {
      const hash = sha256Hex(prevHash + "|" + canonicalEntryContent(e));
      const out = { ...e, prevHash, hash };
      prevHash = hash;
      return out;
    });
    setEntries(resealed);
    setChainCheck(null);
    setChainFullCheck(null);
    showToast("Journal rescellé — toutes les écritures ont un nouveau scellement basé sur leur contenu actuel.");
    logAudit("Comptabilité", "Rescellement complet du journal", `${resealed.length} écritures`);
  };

  // --- Contrôle de cohérence Facturation ↔ Journal ---
  // Détecte les cas où une vente n'a pas produit exactement UNE écriture ET UNE
  // facture assorties (écriture en double pour une même facture, écriture sans
  // facture correspondante, facture sans écriture correspondante). Calculé en
  // continu (pas de bouton "vérifier" nécessaire, contrairement au chaînage
  // cryptographique) car c'est une simple comparaison, pas un calcul de hash.
  const isReversalEntry = (e) => !!e.reversalOf || !!e.cancelledBy || (e.label && (e.label.startsWith("Annulation") || e.label.startsWith("Contrepassation")));
  const isCogsEntry = (e) => e.kind === "cogs" || e.label?.startsWith("Sortie de stock —") || (e.lines || []).some((l) => l.account === "6037" || l.account === "370");
  const activeSaleEntries = entries.filter((e) => e.invoiceId && !isReversalEntry(e) && !isCogsEntry(e));
  const saleEntriesByInvoice = {};
  activeSaleEntries.forEach((e) => { (saleEntriesByInvoice[e.invoiceId] = saleEntriesByInvoice[e.invoiceId] || []).push(e); });
  const duplicateSaleGroups = Object.entries(saleEntriesByInvoice).filter(([, list]) => list.length > 1);
  const orphanSaleEntries = Object.entries(saleEntriesByInvoice)
    .filter(([invId]) => !invoices.some((inv) => String(inv.id) === invId))
    .map(([, list]) => list[0]);
  const invoicesWithoutEntry = invoices.filter((inv) => inv.status !== "annulée" && inv.status !== "don" && inv.status !== "perte" && !saleEntriesByInvoice[inv.id]);
  const reconciliationIssueCount = duplicateSaleGroups.length + orphanSaleEntries.length + invoicesWithoutEntry.length;
  const [showReconciliation, setShowReconciliation] = useState(false);

  const fixDuplicateGroup = (list) => {
    if (role !== "Administrateur") { showToast("Seul un administrateur peut corriger ce doublon."); return; }
    const [keep, ...extra] = list;
    if (!window.confirm(`Corriger ${extra.length} écriture(s) en double pour « ${keep.label} » ? Chacune sera contrepassée pour ne garder qu'un seul effet comptable.`)) return;
    const todayIso = todayStr();
    const reversals = extra.map((e) => ({
      id: uid(), date: todayIso, createdAt: new Date().toISOString(), label: `Correction doublon — ${e.label}`, reversalOf: e.id,
      lines: e.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })),
    }));
    setEntries((prev) => [...prev, ...reversals].map((x) => {
      const r = reversals.find((rv) => rv.reversalOf === x.id);
      return r ? { ...x, cancelledBy: r.id } : x;
    }));
    showToast(`${extra.length} écriture(s) en double corrigée(s) par contrepassation.`);
    logAudit("Comptabilité", "Correction doublon vente (contrepassation)", keep.label);
  };

  // Reconstitue l'écriture manquante d'une facture issue du Solde d'ouverture — le
  // seul cas où c'est fiable à 100%, puisque son écriture d'origine suit toujours
  // exactement le même schéma (411 débit / 108 crédit), sans ambiguïté possible sur
  // le mode de paiement ou la TVA comme pour une vraie vente.
  const rebuildOpeningBalanceEntry = (inv) => {
    if (role !== "Administrateur") { showToast("Seul un administrateur peut recréer cette écriture."); return; }
    if (!window.confirm(`Recréer l'écriture comptable manquante de la facture ${inv.number} (${inv.client}, ${fmt(inv.total)}) ?`)) return;
    const entry = {
      id: uid(), invoiceId: inv.id, date: inv.date, createdAt: new Date().toISOString(),
      label: `Solde d'ouverture — Créance client (${inv.client})`,
      lines: [{ account: "411", debit: inv.total, credit: 0 }, { account: "108", debit: 0, credit: inv.total }],
    };
    setEntries((prev) => [...prev, entry]);
    showToast(`Écriture recréée pour la facture ${inv.number}.`);
    logAudit("Comptabilité", "Reconstruction écriture solde d'ouverture", `${inv.number} — ${fmt(inv.total)}`);
  };

  const rebuildInvoiceFromEntry = (entry) => {
    if (role !== "Administrateur") { showToast("Seul un administrateur peut recréer cette facture."); return; }
    const m = entry.label.match(/^Vente (\S+)(?: — (.*))?$/);
    const number = m ? m[1] : entry.label;
    const clientName = (m && m[2]) || "Client comptant";
    const debitLine = entry.lines.find((l) => l.debit > 0);
    const total = debitLine ? debitLine.debit : entry.lines.reduce((s, l) => s + l.debit, 0);
    const paymentMode = debitLine?.account === "512" ? "banque" : debitLine?.account === "411" ? "credit" : "caisse";
    if (!window.confirm(`Recréer la facture ${number} (${clientName}, ${fmt(total)}) à partir de cette écriture ? Le détail des articles vendus ne peut pas être récupéré depuis le journal — seul le montant total sera reconstitué. Vous pourrez ajouter une note à la main si besoin.`)) return;
    setInvoices((prev) => [...prev, {
      id: entry.invoiceId, number, date: entry.date, client: clientName,
      lines: [], globalDiscountPct: 0, globalDiscountAmtInput: 0, globalDiscountAmount: 0, fees: [],
      totalHT: total, totalTax: 0, taxLabel: "", total, paymentMode,
      status: paymentMode === "credit" ? "impayée" : "payée",
      reconstructedFromJournal: true,
    }]);
    showToast(`Facture ${number} recréée à partir du journal.`);
    logAudit("Comptabilité", "Reconstruction facture depuis le journal", `${number} — ${fmt(total)}`);
  };

  // Recrée en une seule fois toutes les factures manquantes détectées — évite de
  // cliquer un par un sur "Recréer la facture" quand l'écart touche des dizaines
  // d'écritures (ex. incident du 14/08 : 91 factures manquantes d'un coup).
  const rebuildAllOrphanInvoices = () => {
    if (role !== "Administrateur") { showToast("Seul un administrateur peut recréer ces factures."); return; }
    if (orphanSaleEntries.length === 0) return;
    if (!window.confirm(`Recréer les ${orphanSaleEntries.length} factures manquantes en une fois ? Seul le montant total de chacune sera récupéré (déduit du journal) — le détail des articles vendus reste définitivement perdu. Cette action est irréversible.`)) return;
    const rebuilt = orphanSaleEntries.map((entry) => {
      const m = entry.label.match(/^Vente (\S+)(?: — (.*))?$/);
      const number = m ? m[1] : entry.label;
      const clientName = (m && m[2]) || "Client comptant";
      const debitLine = entry.lines.find((l) => l.debit > 0);
      const total = debitLine ? debitLine.debit : entry.lines.reduce((s, l) => s + l.debit, 0);
      const paymentMode = debitLine?.account === "512" ? "banque" : debitLine?.account === "411" ? "credit" : "caisse";
      return {
        id: entry.invoiceId, number, date: entry.date, client: clientName,
        lines: [], globalDiscountPct: 0, globalDiscountAmtInput: 0, globalDiscountAmount: 0, fees: [],
        totalHT: total, totalTax: 0, taxLabel: "", total, paymentMode,
        status: paymentMode === "credit" ? "impayée" : "payée",
        reconstructedFromJournal: true,
      };
    });
    setInvoices((prev) => [...prev, ...rebuilt]);
    showToast(`${rebuilt.length} factures recréées à partir du journal.`);
    logAudit("Comptabilité", "Reconstruction en masse depuis le journal", `${rebuilt.length} factures — total ${fmt(rebuilt.reduce((s, r) => s + r.total, 0))}`);
  };

  // Répare les doublons créés par le bug de comparaison type texte/nombre corrigé le
  // 15/08 : des factures "reconstruites" ont pu être ajoutées à tort alors que la
  // vraie facture existait déjà (le contrôle de cohérence les signalait par erreur
  // comme manquantes). On retire uniquement les copies reconstruites
  // (reconstructedFromJournal:true) dont l'id est aussi porté par une autre facture
  // dans la liste — jamais une facture qui est la seule copie de son id.
  const invoiceIdCounts = {};
  invoices.forEach((inv) => { invoiceIdCounts[inv.id] = (invoiceIdCounts[inv.id] || 0) + 1; });
  const wrongfulDuplicates = invoices.filter((inv) => inv.reconstructedFromJournal && invoiceIdCounts[inv.id] > 1);
  const cleanupWrongfulDuplicates = () => {
    if (role !== "Administrateur") { showToast("Seul un administrateur peut effectuer ce nettoyage."); return; }
    if (wrongfulDuplicates.length === 0) return;
    if (!window.confirm(`Retirer les ${wrongfulDuplicates.length} facture(s) recréée(s) par erreur (doublons du bug corrigé le 15/08) ? La facture originale, avec son détail complet, est conservée dans chaque cas.`)) return;
    setInvoices((prev) => {
      const idCounts = {};
      prev.forEach((inv) => { idCounts[inv.id] = (idCounts[inv.id] || 0) + 1; });
      return prev.filter((inv) => {
        if (inv.reconstructedFromJournal && idCounts[inv.id] > 1) { return false; }
        return true;
      });
    });
    showToast(`${wrongfulDuplicates.length} doublon(s) retiré(s), factures originales conservées.`);
    logAudit("Comptabilité", "Nettoyage doublons reconstruction (bug type texte/nombre)", `${wrongfulDuplicates.length} facture(s)`);
  };

  // Les comptes se chargent de façon asynchrone (stockage/Supabase) après le premier
  // rendu. Si le compte sélectionné dans une ligne n'existe plus dans la liste à jour
  // (ex : encore sur un compte par défaut alors que les vrais comptes viennent d'arriver),
  // on le recale automatiquement sur le premier compte disponible pour éviter un menu
  // déroulant vide et une écriture qui ne peut jamais s'équilibrer.
  useEffect(() => {
    if (!accounts.length) return;
    setLines((prev) => {
      let changed = false;
      const next = prev.map((l) => {
        if (accounts.some((a) => a.code === l.account)) return l;
        changed = true;
        return { ...l, account: accounts[0]?.code };
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = totalDebit > 0 && totalDebit === totalCredit;
  const journalFilteredEntries = entries.filter((e) =>
    (!journalFrom || e.date >= journalFrom) &&
    (!journalTo || e.date <= journalTo) &&
    (!journalAccount || e.lines.some((l) => l.account === journalAccount))
  );
  const journalFilteredTotal = journalFilteredEntries.reduce((s, e) => s + e.lines.reduce((s2, l) => s2 + l.debit, 0), 0);
  // Quand un compte précis est sélectionné : montant débit/crédit/solde propre à CE compte
  // uniquement (et non le total de l'écriture entière), sur la période filtrée.
  const journalAccountAmounts = journalAccount
    ? journalFilteredEntries.reduce((acc, e) => {
        e.lines.forEach((l) => {
          if (l.account === journalAccount) {
            acc.debit += l.debit;
            acc.credit += l.credit;
          }
        });
        return acc;
      }, { debit: 0, credit: 0 })
    : null;

  const updateLine = (idx, field, value) => {
    setLines(lines.map((l, i) => {
      if (i !== idx) return l;
      // Une ligne est soit débitrice, soit créditrice : renseigner l'une vide l'autre
      if (field === "debit") return { ...l, debit: value, credit: value ? "" : l.credit };
      if (field === "credit") return { ...l, credit: value, debit: value ? "" : l.debit };
      return { ...l, [field]: value };
    }));
  };
  const addLine = () => setLines([...lines, { account: accounts[0]?.code, debit: "", credit: "" }]);
  const removeLine = (idx) => {
    if (lines.length <= 2) return;
    setLines(lines.filter((_, i) => i !== idx));
  };

  const addEntry = () => {
    if (Date.now() - lastSubmitRef.current < 800) return; // double-clic/double-tap ignoré
    lastSubmitRef.current = Date.now();
    if (hasPendingCompta) {
      showToast("Traitez d'abord la recommandation en attente ci-dessus avant d'enregistrer une nouvelle écriture.");
      return;
    }
    if (!label) {
      showToast("Renseignez un libellé.");
      return;
    }
    if (isFutureDate(date)) {
      showToast("Impossible d'enregistrer une écriture à une date future — sélectionnez la date du jour ou une date passée.");
      return;
    }
    if (!balanced) {
      showToast("L'écriture n'est pas équilibrée : le total débit doit égaler le total crédit.");
      return;
    }
    const cleanLines = lines
      .filter((l) => Number(l.debit) > 0 || Number(l.credit) > 0)
      .map((l) => ({ account: l.account, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 }));
    if (cleanLines.length === 0 || cleanLines.every((l) => l.debit === 0 && l.credit === 0)) {
      showToast("Le montant de l'écriture ne peut pas être à zéro.");
      return;
    }
    if (isLocked(date, settings)) {
      showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Impossible d'enregistrer une écriture à cette date.`);
      return;
    }
    const commitEntry = () => {
      setEntries((prev) => [...prev, { id: uid(), date, createdAt: new Date().toISOString(), label, lines: cleanLines }]);
      setLabel("");
      setLines([
        { account: accounts[0]?.code, debit: "", credit: "" },
        { account: accounts[1]?.code, debit: "", credit: "" },
      ]);
      showToast("Écriture enregistrée.");
      logAudit("Comptabilité", "Ajout écriture", `${label} — ${fmt(cleanLines.reduce((s, l) => s + l.debit, 0))}`);
    };
    if (planTier !== "assisted") { commitEntry(); return; }
    const total = cleanLines.reduce((s, l) => s + l.debit, 0);
    const usageCounts = {};
    const amountsByAccount = {};
    for (const e of entries) {
      for (const l of e.lines) {
        usageCounts[l.account] = (usageCounts[l.account] || 0) + 1;
        (amountsByAccount[l.account] = amountsByAccount[l.account] || []).push(l.debit + l.credit);
      }
    }
    const anomalies = [];
    const corrections = [];
    for (const l of cleanLines) {
      const acc = accounts.find((a) => a.code === l.account);
      const rare = detectRareAccountAnomaly(l.account, usageCounts, acc?.name);
      if (rare) { anomalies.push(rare); corrections.push(`Si le compte ${acc?.name || l.account} est erroné : annulez cette écriture (contrepassation) puis ressaisissez-la avec le bon compte.`); }
      const amt = detectAmountAnomaly(l.debit + l.credit, amountsByAccount[l.account], acc?.name || l.account);
      if (amt) corrections.push(`Si le montant est erroné : annulez cette écriture (contrepassation) puis ressaisissez-la avec le montant correct.`);
      if (amt) anomalies.push(amt);
    }
    const reversed = detectReversedAnomaly(cleanLines, accounts);
    let reversedPayload = null;
    if (reversed) {
      anomalies.push(reversed);
      const corr = buildReversedCorrection(cleanLines, accounts);
      if (corr) corrections.push(`Écriture correcte à exécuter : ${corr}`);
      reversedPayload = { date, label, lines: buildReversedCorrectedLines(cleanLines) };
    }
    const dup = detectDuplicateAnomaly({ amount: total, date, label }, entries.slice(-50).map((e) => ({ amount: e.lines.reduce((s, l) => s + l.debit, 0), date: e.date, label: e.label })));
    if (dup) { anomalies.push(dup); corrections.push("Vérifiez les deux écritures : si l'une est bien un doublon, annulez-la par contrepassation."); }
    const signature = `entry:${date}:${label}:${JSON.stringify(cleanLines)}`;
    anomalyGate(signature, [...new Set(anomalies)], commitEntry, showToast, () => {
      recordPendingRecommendation?.({
        companyId: _membership?.companyId,
        module: "comptabilite",
        anomalyText: anomalies.join(" "),
        correctionText: [...new Set(corrections)].join(" "),
        entryRef: label,
        createdByEmail: currentUserEmail,
        correctionKind: reversedPayload ? "reversed" : "generic",
        correctionPayload: reversedPayload,
      });
    });
  };

  const cancelEntry = (e) => {
    if (role !== "Administrateur") {
      showToast("Seul un administrateur peut annuler une écriture validée.");
      return;
    }
    if (e.reversalOf) {
      showToast("Une écriture de contrepassation elle-même ne peut pas être annulée. Passez une nouvelle écriture corrective si nécessaire.");
      return;
    }
    if (e.cancelledBy) {
      showToast("Cette écriture a déjà été contrepassée.");
      return;
    }
    if (isLocked(e.date, settings)) {
      showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Cette écriture ne peut plus être annulée sans rouvrir la période.`);
      return;
    }
    if (!window.confirm("Annuler cette écriture ? Une écriture de contrepassation sera ajoutée au journal — l'écriture d'origine est conservée pour la traçabilité, conformément aux règles de non-altération comptable.")) return;
    const reversalId = uid();
    const today = todayStr();
    setEntries((prev) => [
      ...prev.map((x) => (x.id === e.id ? { ...x, cancelledBy: reversalId } : x)),
      { id: reversalId, date: today, createdAt: new Date().toISOString(), label: `Contrepassation — ${e.label}`, reversalOf: e.id, lines: e.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })) },
    ]);
    showToast("Écriture annulée par contrepassation.");
    logAudit("Comptabilité", "Annulation écriture (contrepassation)", e.label);
  };

  const accountName = (code) => accounts.find((a) => a.code === code)?.name || code;

  const addAccount = () => {
    if (!newAccount.code || !newAccount.name) {
      showToast("Code et intitulé requis.");
      return;
    }
    if (accounts.some((a) => a.code === newAccount.code)) {
      showToast("Ce code compte existe déjà.");
      return;
    }
    setAccounts((prev) => (prev.some((a) => a.code === newAccount.code) ? prev : [...prev, newAccount]));
    logAudit("Comptabilité", "Ajout compte", `${newAccount.code} — ${newAccount.name}`);
    setNewAccount({ code: "", name: "", type: "Charge" });
    showToast("Compte ajouté au plan comptable.");
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module 1</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Comptabilité</div>
      </header>

      <GroupedTabNav
        tab={tab}
        setTab={setTab}
        groups={[
          { label: "Écritures", color: { bg: "#152238", text: "#fff", light: "#E8EAF0", lightText: "#152238" }, tabs: [["journal", "Journal des écritures"], ["plan", "Plan comptable"], ["associes", "Associés (capital)"], ["devises", "Opérations en devise"], ["rapprochement", "Rapprochement bancaire"], ["lettrage", "Lettrage"], ["revision", "Révision (cabinet)"], ...(assistantActive ? [["assistant", `Assistant de contrôle${(assistantFindings || []).length ? ` (${(assistantFindings || []).length})` : ""}`]] : [])] },
          { label: "Immobilisations & Provisions", color: { bg: "#0F6B5C", text: "#fff", light: "#E6F1EE", lightText: "#0F6B5C" }, tabs: [["immobilisations", "Immobilisations"], ["regularisations", "Régularisations"], ["avances", "Charges/produits d'avance"], ["risques", "Provisions pour risques"]] },
          { label: "Clôture", color: { bg: "#5B3FA0", text: "#fff", light: "#EDEAF7", lightText: "#5B3FA0" }, tabs: [["cloture", "Clôture annuelle"], ["affectation", "Affectation du résultat"]] },
        ]}
      />

      {tab === "journal" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          {planTier === "assisted" && (
            <div className="mb-4 pb-4" style={{ borderBottom: "1px solid #F0EDE3" }}>
              <label className="text-xs" style={{ color: "#8A8370" }}>Modèles d'écritures récurrentes</label>
              {entryTemplates.length === 0 ? (
                <p className="text-xs mt-1" style={{ color: "#A39C87" }}>Aucun modèle enregistré — remplissez une écriture ci-dessous, puis cliquez « Enregistrer comme modèle » pour la réutiliser le mois prochain.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {entryTemplates.map((t) => (
                    <div key={t.id} className="flex items-center gap-1 rounded-full text-xs pl-3 pr-1.5 py-1" style={{ background: "#EDEAF7", color: "#5B3FA0" }}>
                      <button onClick={() => { setLabel(t.label); setLines(t.lines.map((l) => ({ ...l }))); }} className="font-medium">
                        {t.name}
                      </button>
                      <button onClick={() => { if (window.confirm(`Supprimer le modèle « ${t.name} » ?`)) setEntryTemplates((prev) => prev.filter((x) => x.id !== t.id)); }}
                        style={{ color: "#A6432F" }}><X size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Date</label>
              <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div className="col-span-2">
              <label className="text-xs" style={{ color: "#8A8370" }}>Libellé</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)}
                placeholder="Ex : Vente prestation + matériel, encaissement partiel"
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
              {planTier === "assisted" && label.trim().length >= 3 && (() => {
                const result = suggestAccountFromHistory(label, entries.map((e) => ({ label: e.label, date: e.date, account: e.lines[0]?.account, accountName: accounts.find((a) => a.code === e.lines[0]?.account)?.name })));
                const options = result?.options || [];
                if (options.length === 0) return null;
                const currentAccount = lines[0]?.account;
                return (
                  <div className="text-xs mt-1.5" style={{ color: "#5B3FA0" }}>
                    {result.ambiguous && <div className="mb-1">💡 Plusieurs comptes utilisés pour des libellés similaires — choisissez :</div>}
                    {!result.ambiguous && options[0].account !== currentAccount && (
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span>💡 Suggestion : compte {options[0].account} ({options[0].accountName || ""}), d'après « {cleanSuggestionLabel(options[0].label)} »</span>
                        <button onClick={() => setLines((prev) => { const next = [...prev]; next[0] = { ...next[0], account: options[0].account }; return next; })} className="underline font-medium">Appliquer</button>
                      </div>
                    )}
                    {result.ambiguous && options.map((opt) => {
                      const isCurrent = opt.account === currentAccount;
                      return (
                        <div key={opt.account} className="flex items-center gap-2 flex-wrap mb-1">
                          <span>Compte {opt.account} ({opt.accountName || ""}), d'après « {cleanSuggestionLabel(opt.label)} »{isCurrent ? " — sélectionné" : ""}</span>
                          {!isCurrent && (
                            <button onClick={() => setLines((prev) => { const next = [...prev]; next[0] = { ...next[0], account: opt.account }; return next; })} className="underline font-medium">Appliquer</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="mb-3">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs mb-1 px-1" style={{ color: "#8A8370" }}>
              <div className="col-span-6">Compte</div>
              <div className="col-span-3 text-right">Débit</div>
              <div className="col-span-3 text-right">Crédit</div>
            </div>
            {lines.map((l, idx) => (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 mb-2 items-center">
                <select value={l.account} onChange={(e) => updateLine(idx, "account", e.target.value)}
                  className="col-span-6 border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }}>
                  {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </select>
                <input type="number" value={l.debit} onChange={(e) => updateLine(idx, "debit", e.target.value)}
                  placeholder="0" className="col-span-3 border rounded px-2 py-1.5 text-sm text-right tabular" style={{ borderColor: "#DDD6C4" }} />
                <input type="number" value={l.credit} onChange={(e) => updateLine(idx, "credit", e.target.value)}
                  placeholder="0" className="col-span-2 border rounded px-2 py-1.5 text-sm text-right tabular" style={{ borderColor: "#DDD6C4" }} />
                <button onClick={() => removeLine(idx)} disabled={lines.length <= 2}
                  className="col-span-1 flex justify-center" style={{ color: lines.length <= 2 ? "#DDD6C4" : "#A6432F" }}>
                  <X size={14} />
                </button>
              </div>
            ))}
            <button onClick={addLine} className="flex items-center gap-1 text-xs mt-1" style={{ color: "#152238" }}>
              <Plus size={12} /> Ajouter une ligne
            </button>
          </div>

          <div className="flex items-center justify-between mb-5 px-1">
            <div className="flex items-center gap-1 text-xs" style={{ color: balanced ? "#0F6B5C" : "#A6432F" }}>
              {balanced ? <CheckCircle2 size={13} /> : <Circle size={13} />}
              {balanced ? "Écriture équilibrée" : "L'écriture doit être équilibrée pour être enregistrée"}
            </div>
            <div className="tabular text-xs" style={{ color: "#8A8370" }}>
              Total débit {fmt(totalDebit)} · Total crédit {fmt(totalCredit)}
            </div>
          </div>

          <PendingRecommendationsBanner recommendations={pendingRecommendations} module="comptabilite" onDismiss={resolvePendingRecommendation} onApplyCorrection={applyReversedCorrection} />
          <AssistedPrincipleReminder planTier={planTier} text="Une écriture doit toujours respecter la partie double : chaque montant débité doit avoir sa contrepartie créditée du même montant, sinon les comptes ne s'équilibrent plus." />
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            <button onClick={addEntry} disabled={hasPendingCompta}
              className="flex items-center gap-2 px-4 py-2 rounded text-sm text-white"
              style={{ background: "#152238", opacity: hasPendingCompta ? 0.5 : 1 }}>
              <Plus size={14} /> Enregistrer l'écriture
            </button>
            {planTier === "assisted" && (
              <button
                onClick={() => {
                  const name = window.prompt("Nom du modèle (ex. « Loyer mensuel ») :", label || "");
                  if (!name || !name.trim()) return;
                  setEntryTemplates((prev) => [...prev, { id: uid(), name: name.trim(), label, lines: lines.map((l) => ({ ...l })), createdAt: new Date().toISOString() }]);
                  showToast("Modèle enregistré.");
                }}
                className="text-xs px-3 py-2 rounded" style={{ background: "#EDEAF7", color: "#5B3FA0" }}>
                Enregistrer comme modèle
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 mb-4 flex-wrap p-3 rounded" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }}>
            <div className="flex items-center gap-1.5 text-xs" style={{ color: "#7A7460" }}>
              <Lock size={13} />
              Journal scellé par chaînage cryptographique (SHA-256) — {entries.length} écriture{entries.length > 1 ? "s" : ""} enregistrée{entries.length > 1 ? "s" : ""}.
            </div>
            <button onClick={runChainCheck} className="text-xs px-3 py-1.5 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>
              Vérifier l'intégrité du journal
            </button>
            {chainCheck && (
              chainCheck.ok ? (
                <span className="text-xs px-2 py-1 rounded flex items-center gap-1" style={{ background: "#E6F1EE", color: "#0F6B5C" }}>
                  <CheckCircle2 size={13} /> Intègre — {chainCheck.count} écritures vérifiées, aucune altération détectée.
                </span>
              ) : (
                <span className="text-xs px-2 py-1 rounded flex items-center gap-1" style={{ background: "#F7E9E3", color: "#A6432F" }}>
                  <X size={13} /> Altération détectée à l'écriture « {chainCheck.entry?.label} » ({chainCheck.entry?.date}) — {chainCheck.reason}.
                </span>
              )
            )}
            {chainCheck && !chainCheck.ok && (
              <button onClick={runChainFullCheck} className="text-xs px-3 py-1.5 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>
                Analyser toutes les écritures (sans s'arrêter à la première)
              </button>
            )}
          </div>

          {chainFullCheck && (
            <div className="mb-4 p-3 rounded text-xs" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }}>
              {chainFullCheck.ok ? (
                <div style={{ color: "#0F6B5C" }}>Analyse complète : les {chainFullCheck.count} écritures sont toutes cohérentes avec leur scellement — aucune altération réelle détectée.</div>
              ) : (
                <>
                  <div className="mb-2" style={{ color: "#A6432F" }}>
                    {chainFullCheck.brokenCount} écriture{chainFullCheck.brokenCount > 1 ? "s" : ""} sur {chainFullCheck.count} ne correspond{chainFullCheck.brokenCount > 1 ? "ent" : ""} pas à son scellement enregistré.
                  </div>
                  <div className="space-y-1 mb-2">
                    {chainFullCheck.broken.slice(0, 20).map((b) => (
                      <div key={b.index}>« {b.entry.label} » ({b.entry.date}) — {b.reason}</div>
                    ))}
                    {chainFullCheck.broken.length > 20 && <div style={{ color: "#8A8370" }}>… et {chainFullCheck.broken.length - 20} de plus.</div>}
                  </div>
                  <div style={{ color: "#8A8370" }}>
                    Si toutes les écritures listées datent d'avant une évolution du format de scellement et que leur contenu (montant, client, compte) vous semble correct, vous pouvez resceller le journal ci-dessous. Si un montant ou un contenu vous paraît réellement incorrect, ne rescellez pas — contactez le support d'abord.
                  </div>
                  {role === "Administrateur" && (
                    <button onClick={reseal} className="text-xs px-3 py-1.5 rounded mt-2" style={{ background: "#A6432F", color: "#fff" }}>
                      Resceller le journal (après vérification)
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          <div className="mb-4 p-3 rounded" style={{ background: reconciliationIssueCount > 0 ? "#F7E9E3" : "#FAF8F1", border: "1px solid #EEE9DA" }}>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs" style={{ color: reconciliationIssueCount > 0 ? "#A6432F" : "#7A7460" }}>
                {reconciliationIssueCount > 0 ? <X size={13} /> : <CheckCircle2 size={13} />}
                Cohérence Facturation ↔ Journal — {reconciliationIssueCount === 0 ? "aucun écart détecté." : `${reconciliationIssueCount} écart${reconciliationIssueCount > 1 ? "s" : ""} détecté${reconciliationIssueCount > 1 ? "s" : ""}.`}
              </div>
              {reconciliationIssueCount > 0 && (
                <button onClick={() => setShowReconciliation((v) => !v)} className="text-xs px-3 py-1.5 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>
                  {showReconciliation ? "Masquer le détail" : "Voir le détail"}
                </button>
              )}
              {orphanSaleEntries.length > 1 && role === "Administrateur" && (
                <button onClick={rebuildAllOrphanInvoices} className="text-xs px-3 py-1.5 rounded" style={{ background: "#A6432F", color: "#fff" }}>
                  Recréer les {orphanSaleEntries.length} factures manquantes
                </button>
              )}
              {wrongfulDuplicates.length > 0 && role === "Administrateur" && (
                <button onClick={cleanupWrongfulDuplicates} className="text-xs px-3 py-1.5 rounded" style={{ background: "#D9A441", color: "#152238" }}>
                  Nettoyer {wrongfulDuplicates.length} doublon(s) créé(s) par erreur
                </button>
              )}
            </div>
            {showReconciliation && reconciliationIssueCount > 0 && (
              <div className="mt-3 space-y-2 text-xs">
                {duplicateSaleGroups.map(([invId, list]) => (
                  <div key={invId} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-2 rounded bg-white" style={{ border: "1px solid #EEE9DA" }}>
                    <span>« {list[0].label} » enregistrée {list.length} fois dans le journal.</span>
                    {role === "Administrateur" && <button onClick={() => fixDuplicateGroup(list)} className="underline text-left sm:shrink-0" style={{ color: "#A6432F" }}>Corriger (contrepasser le doublon)</button>}
                  </div>
                ))}
                {orphanSaleEntries.map((e) => (
                  <div key={e.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-2 rounded bg-white" style={{ border: "1px solid #EEE9DA" }}>
                    <span>« {e.label} » présente dans le journal, absente de Facturation.</span>
                    {role === "Administrateur" && <button onClick={() => rebuildInvoiceFromEntry(e)} className="underline text-left sm:shrink-0" style={{ color: "#A6432F" }}>Recréer la facture</button>}
                  </div>
                ))}
                {invoicesWithoutEntry.map((inv) => (
                  <div key={inv.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-2 rounded bg-white" style={{ border: "1px solid #EEE9DA" }}>
                    <span>Facture {inv.number} ({inv.client}, {fmt(inv.total)}) présente dans Facturation, sans écriture correspondante dans le journal.</span>
                    {inv.isOpeningBalance && role === "Administrateur" ? (
                      <button onClick={() => rebuildOpeningBalanceEntry(inv)} className="underline text-left sm:shrink-0" style={{ color: "#A6432F" }}>Recréer l'écriture (solde d'ouverture)</button>
                    ) : (
                      <span className="sm:shrink-0" style={{ color: "#8A8370" }}>Contactez le support — nécessite une vérification manuelle.</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Du</label>
              <input type="date" value={journalFrom} onChange={(e) => setJournalFrom(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
              <input type="date" value={journalTo} onChange={(e) => setJournalTo(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Compte</label>
              <select value={journalAccount} onChange={(e) => setJournalAccount(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", width: "min(280px, 100%)", boxSizing: "border-box" }}>
                <option value="">Tous les comptes</option>
                {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            {(journalFrom || journalTo || journalAccount) && (
              <button onClick={() => { setJournalFrom(""); setJournalTo(""); setJournalAccount(""); }} className="text-xs underline mb-1.5" style={{ color: "#8A8370" }}>
                Réinitialiser
              </button>
            )}
            {(journalFrom || journalTo || journalAccount) && (
              <div className="tabular text-xs mb-1.5 ml-auto text-right" style={{ color: "#152238" }}>
                {journalFilteredEntries.length} écriture{journalFilteredEntries.length > 1 ? "s" : ""} · Total {fmt(journalFilteredTotal)}
                {journalAccountAmounts && (
                  <div style={{ color: "#8A8370" }}>
                    Compte {journalAccount} — Débit {fmt(journalAccountAmounts.debit)} · Crédit {fmt(journalAccountAmounts.credit)} · Solde {fmt(journalAccountAmounts.debit - journalAccountAmounts.credit)}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="overflow-x-auto overflow-y-auto max-h-[65vh] border rounded" style={{ borderColor: "#EEE9DA" }}><table className="w-full text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-2 font-normal">Date</th>
                <th className="py-2 font-normal">Libellé</th>
                <th className="py-2 font-normal text-center">Lignes</th>
                <th className="py-2 font-normal text-right">Montant</th>
                {journalAccount && <th className="py-2 font-normal text-right">Montant compte {journalAccount}</th>}
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {journalFilteredEntries.length === 0 && (
                <tr><td colSpan={journalAccount ? 6 : 5} className="py-8 text-center" style={{ color: "#A39C87" }}>{entries.length === 0 ? "Aucune écriture. Commencez par en ajouter une ci-dessus." : "Aucune écriture sur cette période."}</td></tr>
              )}
              {[...journalFilteredEntries].reverse().map((e) => {
                const total = e.lines.reduce((s, l) => s + l.debit, 0);
                const accountLines = journalAccount ? e.lines.filter((l) => l.account === journalAccount) : [];
                const accountAmount = accountLines.reduce((s, l) => s + l.debit - l.credit, 0);
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
                      <td className="py-2 tabular text-center">{e.lines.length}</td>
                      <td className="py-2 tabular text-right">{fmt(total)}</td>
                      {journalAccount && (
                        <td className="py-2 tabular text-right" style={{ color: "#152238", fontWeight: 600 }}>
                          {accountAmount >= 0 ? fmt(accountAmount) : `(${fmt(Math.abs(accountAmount))})`}
                        </td>
                      )}
                      <td className="py-2 text-right">
                        {role === "Administrateur" && !e.cancelledBy && !e.reversalOf && (
                          <button onClick={(ev) => { ev.stopPropagation(); cancelEntry(e); }} title="Annuler (contrepassation)" style={{ color: "#A6432F" }}>
                            <RotateCcw size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={journalAccount ? 6 : 5} className="py-3 px-3" style={{ background: "#FAF8F1" }}>
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
      )}

      {tab === "plan" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5 items-end">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Code</label>
              <input value={newAccount.code} onChange={(e) => setNewAccount({ ...newAccount, code: e.target.value })}
                placeholder="Ex : 613" className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Intitulé</label>
              <input value={newAccount.name} onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                placeholder="Ex : Locations" className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Type</label>
              <select value={newAccount.type} onChange={(e) => setNewAccount({ ...newAccount, type: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                {["Actif", "Passif", "Capitaux propres", "Charge", "Produit"].map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <button onClick={addAccount}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded text-sm text-white h-[38px]"
              style={{ background: "#152238" }}>
              <Plus size={14} /> Ajouter
            </button>
          </div>

          <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,34,56,0.08)" }}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#C7CCDA" }}>
                <th className="py-2 px-3 text-left font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Code</th>
                <th className="py-2 px-3 text-left font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Intitulé</th>
                <th className="py-2 px-3 text-left font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Type</th>
                <th className="py-2 px-3 text-right font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Solde</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const accentByType = { "Produit": "#639922", "Charge": "#D85A30", "Actif": "#378ADD", "Passif": "#7F77DD", "Capitaux propres": "#7F77DD" };
                return (
                <tr key={a.code}>
                  <td className="py-2 pl-3 pr-1 tabular" style={{ color: "#152238", borderLeft: `3px solid ${accentByType[a.type] || "#A39C87"}` }}>{a.code}</td>
                  <td className="py-2 px-3" style={{ color: "#152238" }}>{a.name}</td>
                  <td className="py-2 px-3" style={{ color: "#152238" }}>{a.type}</td>
                  <td className="py-2 px-3 tabular text-right" style={{ color: "#152238" }}>{fmt(balances[a.code] || 0)}</td>
                </tr>
                );
              })}
            </tbody>
          </table></div>
          </div>
        </div>
      )}
      {tab === "associes" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <p className="text-sm mb-4" style={{ color: "#7A7460" }}>
            Chaque associé a son propre sous-compte de capital (101.1, 101.2…), pour suivre séparément qui a apporté combien. Un nouvel apport pour un associé déjà enregistré vient s'ajouter à son sous-compte existant.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Associé</label>
              <select value={associateForm.mode === "new" ? "__new__" : associateForm.associateCode}
                onChange={(e) => {
                  if (e.target.value === "__new__") setAssociateForm({ ...associateForm, mode: "new", associateCode: "" });
                  else setAssociateForm({ ...associateForm, mode: "existing", associateCode: e.target.value });
                }}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="">— Sélectionner —</option>
                {associateAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name.replace(/^Capital — /, "")}</option>)}
                <option value="__new__">+ Nouvel associé</option>
              </select>
            </div>
            {associateForm.mode === "new" && (
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Nom du nouvel associé</label>
                <input value={associateForm.newName} onChange={(e) => setAssociateForm({ ...associateForm, newName: e.target.value })}
                  className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
              </div>
            )}
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Date</label>
              <input type="date" value={associateForm.date} max={todayStr()} onChange={(e) => setAssociateForm({ ...associateForm, date: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Montant de l'apport</label>
              <input type="number" min="0" value={associateForm.amount} onChange={(e) => setAssociateForm({ ...associateForm, amount: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Reçu sur</label>
              <select value={associateForm.payAccount} onChange={(e) => setAssociateForm({ ...associateForm, payAccount: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="530">Caisse</option>
                <option value="512">Banque</option>
              </select>
            </div>
          </div>
          <AssistedPrincipleReminder planTier={planTier} text="Un apport de capital augmente le compte de l'associé (101.N) et la trésorerie (caisse ou banque) du même montant — c'est un apport, pas une vente ni une charge." />
          <button onClick={recordCapitalContribution} className="px-4 py-2 rounded text-sm text-white mb-6" style={{ background: "#152238" }}>
            + Enregistrer l'apport
          </button>

          {associateAccounts.length === 0 ? (
            <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Aucun associé enregistré pour le moment.</div>
          ) : (
            <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,34,56,0.08)" }}>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#C7CCDA" }}>
                  <th className="py-2 px-3 text-left font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Compte</th>
                  <th className="py-2 px-3 text-left font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Associé</th>
                  <th className="py-2 px-3 text-right font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Total apporté</th>
                </tr>
              </thead>
              <tbody>
                {associateAccounts.map((a) => (
                  <tr key={a.code}>
                    <td className="py-2 pl-3 pr-1 tabular" style={{ color: "#152238", borderLeft: "3px solid #7F77DD" }}>{a.code}</td>
                    <td className="py-2 px-3" style={{ color: "#152238" }}>{a.name.replace(/^Capital — /, "")}</td>
                    <td className="py-2 px-3 tabular text-right font-medium" style={{ color: "#152238" }}>{fmt(a.solde)}</td>
                  </tr>
                ))}
                <tr style={{ background: "#FAF8F1" }}>
                  <td className="py-2 pl-3 pr-1" colSpan={2} style={{ color: "#152238", borderLeft: "3px solid #152238", fontWeight: 500 }}>Total capital</td>
                  <td className="py-2 px-3 tabular text-right font-semibold" style={{ color: "#152238" }}>{fmt(associateAccounts.reduce((s, a) => s + a.solde, 0))}</td>
                </tr>
              </tbody>
            </table></div>
            </div>
          )}
        </div>
      )}

      {tab === "immobilisations" && (
        <ImmobilisationsPanel accounts={accounts} assets={assets} setAssets={setAssets} entries={entries} setEntries={setEntries} role={role} showToast={showToast} logAudit={logAudit} planTier={planTier} recordPendingRecommendation={recordPendingRecommendation} currentUserEmail={currentUserEmail} />
      )}

      {tab === "regularisations" && (
        <AccrualsPanel accounts={accounts} accruals={accruals} setAccruals={setAccruals} entries={entries} setEntries={setEntries} role={role} showToast={showToast} logAudit={logAudit} planTier={planTier} recordPendingRecommendation={recordPendingRecommendation} currentUserEmail={currentUserEmail} />
      )}

      {tab === "avances" && (
        <DeferralsPanel accounts={accounts} deferrals={deferrals} setDeferrals={setDeferrals} entries={entries} setEntries={setEntries} role={role} showToast={showToast} logAudit={logAudit} planTier={planTier} recordPendingRecommendation={recordPendingRecommendation} currentUserEmail={currentUserEmail} />
      )}

      {tab === "risques" && (
        <RiskProvisionsPanel accounts={accounts} riskProvisions={riskProvisions} setRiskProvisions={setRiskProvisions} entries={entries} setEntries={setEntries} role={role} showToast={showToast} logAudit={logAudit} planTier={planTier} recordPendingRecommendation={recordPendingRecommendation} currentUserEmail={currentUserEmail} />
      )}

      {tab === "devises" && (
        <DevisesPanel accounts={accounts} setAccounts={setAccounts} entries={entries} setEntries={setEntries} settings={settings} setSettings={setSettings} role={role} showToast={showToast} logAudit={logAudit} />
      )}

      {tab === "rapprochement" && (
        <BankReconciliationPanel accounts={accounts} entries={entries} setEntries={setEntries} settings={settings} setSettings={setSettings} role={role} showToast={showToast} logAudit={logAudit} />
      )}

      {tab === "lettrage" && (
        <LettragePanel accounts={accounts} entries={entries} setEntries={setEntries} role={role} showToast={showToast} logAudit={logAudit} />
      )}

      {tab === "assistant" && assistantActive && (
        <AssistantPanel findings={assistantAll} ignored={settings.assistantIgnored} entries={entries} accounts={accounts} setEntries={setEntries} setAccounts={setAccounts} settings={settings} setSettings={setSettings} role={role} showToast={showToast} logAudit={logAudit} />
      )}

      {tab === "revision" && (
        <RevisionPanel accounts={accounts} entries={entries} invoices={invoices} settings={settings} role={role} isAccountant={isAccountant} companyId={companyId} currentUserEmail={currentUserEmail} showToast={showToast} logAudit={logAudit} />
      )}

      {tab === "cloture" && (
        <ClotureAnnuellePanel accounts={accounts} entries={entries} setEntries={setEntries} settings={settings} setSettings={setSettings} role={role} showToast={showToast} logAudit={logAudit} planTier={planTier} currentUserEmail={currentUserEmail} pendingApprovals={pendingApprovals} setPendingApprovals={setPendingApprovals} products={products} />
      )}

      {tab === "affectation" && (
        <AffectationResultatPanel accounts={accounts} setAccounts={setAccounts} entries={entries} setEntries={setEntries} balances={balances} settings={settings} role={role} showToast={showToast} logAudit={logAudit} planTier={planTier} currentUserEmail={currentUserEmail} pendingApprovals={pendingApprovals} setPendingApprovals={setPendingApprovals} />
      )}
    </div>
  );
}



// ═══ MODULE ═══
// @module Creances et clients
// @depends ChequeDialog, History, InvoiceSheet, Plus, RecordedStamp, X, _membership, balanceDue, fmt
//   makeChequeRecord, normalizeClientName, rangModule, simpleEntry, todayStr, uid
//   useAssistedAnomalyGate, useBackNav, useBrouillon, useEffect, useState
// @exports CRMModule
// ═══ FIN DE L'EN-TÊTE ═══
// Provision pour créances douteuses — mêmes principes que la dépréciation de
// stock : on indique le montant qu'on estime réellement récupérable sur une
// créance, la provision se recalcule automatiquement (dotation si elle augmente,
// reprise si elle diminue), jamais le montant total à chaque fois. Ne solde ni
// n'annule la créance elle-même — c'est un ajustement de valorisation, pas un
// recouvrement.
function ProvisionsCreancesPanel({ rows, clients, setClients, entries, setEntries, role, showToast, logAudit, planTier, recordPendingRecommendation, currentUserEmail }) {
  const canEdit = role !== "Vendeur";
  const [drafts, setDrafts] = useState({}); // { [clientName]: "valeur en cours de saisie" }
  const anomalyGate = useAssistedAnomalyGate();

  const applyProvision = (row) => {
    const draft = drafts[row.name];
    if (draft === undefined || draft === "") return;
    const recoverable = Number(draft);
    if (!(recoverable >= 0)) { showToast("Le montant récupérable doit être un nombre positif ou nul."); return; }
    const existing = clients.find((c) => normalizeClientName(c.name) === normalizeClientName(row.name));
    const oldProvision = Number(existing?.doubtfulProvision) || 0;
    const newProvision = Math.max(0, row.due - recoverable);
    const delta = newProvision - oldProvision;
    if (Math.round(delta * 100) === 0) {
      showToast("Aucun changement de provision pour ce montant.");
      return;
    }
    const commit = () => {
    const isDotation = delta > 0;
    const entry = {
      id: uid(), date: todayStr(), createdAt: new Date().toISOString(),
      label: `${isDotation ? "Dotation" : "Reprise"} provision créance douteuse — ${row.name}`,
      lines: isDotation
        ? [{ account: "6816", debit: delta, credit: 0 }, { account: "491", debit: 0, credit: delta }]
        : [{ account: "491", debit: -delta, credit: 0 }, { account: "7816", debit: 0, credit: -delta }],
    };
    setEntries((prev) => [...prev, entry]);
    setClients((prev) => {
      if (existing) return prev.map((c) => (normalizeClientName(c.name) === normalizeClientName(row.name) ? { ...c, doubtfulEstimate: recoverable, doubtfulProvision: newProvision } : c));
      return [...prev, { id: uid(), name: row.name, email: row.email || "", phone: row.phone || "", createdAt: new Date().toISOString(), doubtfulEstimate: recoverable, doubtfulProvision: newProvision }];
    });
    logAudit("CRM", isDotation ? "Dotation provision créance" : "Reprise provision créance", `${row.name} : ${fmt(Math.abs(delta))}`);
    showToast(`${isDotation ? "Dotation" : "Reprise"} enregistrée : ${fmt(Math.abs(delta))}.`);
    setDrafts((prev) => ({ ...prev, [row.name]: undefined }));
    };
    if (planTier !== "assisted") { commit(); return; }
    const anomalies = [];
    if (recoverable === 0) anomalies.push(`Vous provisionnez la totalité de la créance de « ${row.name} » comme irrécouvrable — vérifiez avant de continuer.`);
    const signature = `creancedep:${row.name}:${recoverable}`;
    anomalyGate(signature, [...new Set(anomalies)], commit, showToast, () => {
      recordPendingRecommendation?.({
        companyId: _membership?.companyId,
        module: "crm",
        anomalyText: anomalies.join(" "),
        correctionText: "Vérifiez le montant récupérable saisi ; une reprise peut être enregistrée ensuite pour corriger.",
        entryRef: row.name,
        createdByEmail: currentUserEmail,
      });
    });
  };

  const clearProvision = (row) => {
    const existing = clients.find((c) => normalizeClientName(c.name) === normalizeClientName(row.name));
    const provision = Number(existing?.doubtfulProvision) || 0;
    if (!(provision > 0)) return;
    if (!window.confirm(`Annuler entièrement la provision sur « ${row.name} » ? Une reprise totale sera enregistrée.`)) return;
    const delta = -provision;
    const entry = {
      id: uid(), date: todayStr(), createdAt: new Date().toISOString(),
      label: `Reprise provision créance douteuse — ${row.name}`,
      lines: [{ account: "491", debit: -delta, credit: 0 }, { account: "7816", debit: 0, credit: -delta }],
    };
    setEntries((prev) => [...prev, entry]);
    setClients((prev) => prev.map((c) => (normalizeClientName(c.name) === normalizeClientName(row.name) ? { ...c, doubtfulEstimate: null, doubtfulProvision: 0 } : c)));
    logAudit("CRM", "Reprise provision créance", `${row.name} : ${fmt(-delta)}`);
    showToast(`Provision annulée, reprise de ${fmt(-delta)} enregistrée.`);
  };

  const activeRows = rows.filter((r) => r.due > 0);
  const resolvedRows = rows.filter((r) => {
    if (r.due > 0) return false;
    const existing = clients.find((c) => normalizeClientName(c.name) === normalizeClientName(r.name));
    return existing && existing.doubtfulEstimate != null;
  });

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Créances douteuses</div>
        <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
          Pour un client dont la dette totale ou partielle semble compromise (retard important, difficultés connues). Indiquez le montant que vous estimez réellement récupérable — la provision se recalcule automatiquement. Ceci ne solde ni n'annule la créance : elle reste due tant qu'un encaissement réel n'est pas enregistré.
        </p>
        {activeRows.length === 0 ? (
          <div className="text-xs py-4 text-center" style={{ color: "#A39C87" }}>Aucun client avec une créance en cours.</div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,34,56,0.08)" }}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#C7CCDA" }}>
                <th className="py-2 px-3 text-left font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Client</th>
                <th className="py-2 px-3 text-right font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Total dû</th>
                <th className="py-2 px-3 text-right font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Provision actuelle</th>
                <th className="py-2 px-3 text-right font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Montant estimé récupérable</th>
                <th className="py-2 px-3"></th>
              </tr>
            </thead>
            <tbody>
              {activeRows.map((row) => {
                const existing = clients.find((c) => normalizeClientName(c.name) === normalizeClientName(row.name));
                const provision = Number(existing?.doubtfulProvision) || 0;
                return (
                  <tr key={row.name}>
                    <td className="py-2 pl-3 pr-1" style={{ color: "#152238", borderLeft: "3px solid #378ADD" }}>{row.name}</td>
                    <td className="py-2 px-3 tabular text-right" style={{ color: "#152238" }}>{fmt(row.due)}</td>
                    <td className="py-2 px-3 tabular text-right" style={{ color: "#152238" }}>{provision > 0 ? fmt(provision) : "—"}</td>
                    <td className="py-2 px-3 text-right">
                      {canEdit ? (
                        <input type="number" min="0" placeholder={String(existing?.doubtfulEstimate ?? row.due)}
                          value={drafts[row.name] ?? ""} onChange={(e) => setDrafts((prev) => ({ ...prev, [row.name]: e.target.value }))}
                          className="w-24 border rounded px-2 py-1 text-xs tabular text-right" style={{ borderColor: "#DDD6C4" }} />
                      ) : (fmt(existing?.doubtfulEstimate ?? row.due))}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {canEdit && (
                        <>
                          <button onClick={() => applyProvision(row)} className="text-xs underline mr-2" style={{ color: "#152238" }}>Enregistrer</button>
                          {provision > 0 && (
                            <button onClick={() => clearProvision(row)} className="text-xs underline" style={{ color: "#A6432F" }}>Annuler</button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          </div>
        )}
      </div>

      {resolvedRows.length > 0 && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Résolues ({resolvedRows.length})</div>
          <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Créance soldée, annulée, ou passée en perte définitive — provision revenue à zéro.</p>
          <div className="space-y-1">
            {resolvedRows.map((row) => (
              <div key={row.name} className="flex items-center justify-between text-sm p-2 rounded" style={{ border: "1px solid #F3EFE3", color: "#8A8370" }}>
                <span>{row.name}</span>
                <span className="tabular">Provision : 0</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CRMModule({ setCheques, clients, setClients, invoices, setInvoices, entries, setEntries, accounts, setAccounts, planTier, recordPendingRecommendation, currentUserEmail, role, showToast, logAudit, verifyTransactionSaved, pendingApprovals, setPendingApprovals, settings }) {
  useEffect(() => {
    const missing = [
      { code: "491", name: "Provisions pour créances douteuses", type: "Actif" },
      { code: "6816", name: "Dotations aux provisions pour créances douteuses", type: "Charge" },
      { code: "7816", name: "Reprises sur provisions pour créances douteuses", type: "Produit" },
      { code: "654", name: "Pertes sur créances irrécouvrables", type: "Charge" },
    ].filter((a) => !accounts.some((existing) => existing.code === a.code));
    if (missing.length > 0) setAccounts((prev) => [...prev, ...missing]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Le Vendeur peut consulter les clients/factures et encaisser des paiements, mais
  // ne peut ni créer/modifier une fiche client, ni annuler une facture ou un
  // encaissement déjà enregistré — ces actions restent réservées à
  // Administrateur/Éditeur, conformément à la demande explicite de l'utilisateur.
  const canManageClients = role !== "Vendeur";
  const [newClient, setNewClient] = useBrouillon("client-fiche", { name: "", email: "", phone: "", address: "" });
  const [selected, setSelected] = useState(null);
  const [historyClientName, setHistoryClientName] = useState(null);
  const [expandedDueClients, setExpandedDueClients] = useState({}); // { [nomNormalisé]: true } — replié par défaut
  const [tab, setTab] = useState("clients");
  useBackNav(tab, setTab, "clients");
  const [payAmounts, setPayAmounts] = useState({});
  // Aperçu de la facture telle qu'elle sort de l'imprimante (format choisi dans Administration), avec impression directe.
  const [apercuInv, setApercuInv] = useState(null);
  const [printInv, setPrintInv] = useState(null);
  const cfg = settings || {};
  useEffect(() => {
    if (!printInv) return;
    const t = setTimeout(() => { try { window.print(); } catch (e) {} }, 150);
    const onAfter = () => setPrintInv(null);
    window.addEventListener("afterprint", onAfter);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", onAfter); };
  }, [printInv]);

  // Fusionne les clients déclarés et les noms de clients apparus dans les factures
  // Regroupe par nom normalisé (espaces superflus et casse ignorés) — sans ça, deux
  // factures du même client saisies avec une variation minime ("Guerline" vs
  // "Guerline " ou une casse différente) créaient deux fiches distinctes, chacune
  // avec son propre solde partiel au lieu d'un seul total correct.
  const clientNameGroups = {};
  invoices.forEach((i) => {
    if (!i.client || i.client === "Client comptant") return;
    const key = normalizeClientName(i.client);
    if (!clientNameGroups[key]) clientNameGroups[key] = i.client.trim().replace(/\s+/g, " ");
  });
  const invoiceNames = Object.values(clientNameGroups);
  const rows = invoiceNames.map((name) => {
    const key = normalizeClientName(name);
    const known = clients.find((c) => normalizeClientName(c.name) === key);
    const clientInvoices = invoices.filter((i) => normalizeClientName(i.client) === key);
    const total = clientInvoices.reduce((s, i) => s + i.total, 0);
    const due = clientInvoices.filter((i) => i.status !== "payée" && i.status !== "don" && i.status !== "annulée" && i.status !== "perte").reduce((s, i) => s + balanceDue(i), 0);
    const lastDate = clientInvoices.reduce((max, i) => (i.date > max ? i.date : max), "");
    return { name, email: known?.email || "", phone: known?.phone || ([...clientInvoices].reverse().find((i) => i.clientPhone) || {}).clientPhone || "", nb: clientInvoices.length, total, due, lastDate, invoices: clientInvoices };
  });

  // Liste affichée : les clients ayant des factures, PLUS les clients déclarés (fiche créée)
  // qui n'ont pas encore de facture — sans ça, une fiche client conservée (ex. après une
  // réinitialisation qui garde les clients) restait invisible tant qu'aucune facture n'existait.
  const invoiceKeys = new Set(rows.map((r) => normalizeClientName(r.name)));
  const listRows = [
    ...rows,
    ...clients
      .filter((c) => c && c.name && !invoiceKeys.has(normalizeClientName(c.name)))
      .map((c) => ({ name: c.name.trim().replace(/\s+/g, " "), email: c.email || "", phone: c.phone || "", nb: 0, total: 0, due: 0, lastDate: "", invoices: [] })),
  ];

  const dueInvoicesAll = invoices.filter((i) => i.status !== "payée" && i.status !== "annulée" && i.status !== "don" && i.status !== "perte");
  const dueClientCount = new Set(dueInvoicesAll.map((i) => normalizeClientName(i.client))).size;
  const paidInvoices = invoices.filter((i) => i.status === "payée");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [dueClient, setDueClient] = useState("");
  const [dueStatus, setDueStatus] = useState(""); // "" | "impayée" | "partielle"
  const dueClientOptions = Object.values(
    dueInvoicesAll.reduce((acc, i) => { const k = normalizeClientName(i.client); if (!acc[k]) acc[k] = i.client; return acc; }, {})
  );
  const dueInvoices = dueInvoicesAll.filter((i) =>
    (!dueFrom || i.date >= dueFrom) &&
    (!dueTo || i.date <= dueTo) &&
    (!dueClient || normalizeClientName(i.client) === normalizeClientName(dueClient)) &&
    (!dueStatus || i.status === dueStatus)
  );
  // Mêmes filtres (date / client) appliqués à l'onglet Clients payés, avec leurs
  // propres états pour ne pas interférer avec ceux de Clients dûs.
  const [paidFrom, setPaidFrom] = useState("");
  const [paidTo, setPaidTo] = useState("");
  const [paidClient, setPaidClient] = useState("");
  const paidClientOptions = [...new Set(paidInvoices.map((i) => i.client))];
  const paidInvoicesFiltered = paidInvoices.filter((i) =>
    (!paidFrom || i.date >= paidFrom) &&
    (!paidTo || i.date <= paidTo) &&
    (!paidClient || i.client === paidClient)
  );

  const addClient = () => {
    if (!newClient.name) {
      showToast("Le nom du client est requis.");
      return;
    }
    const existing = clients.find((c) => c.name === newClient.name);
    if (existing) {
      // Fiche déjà là : on la complète (adresse, e-mail, téléphone saisis) sans rien effacer.
      const patch = {};
      ["email", "phone", "address"].forEach((k) => { if ((newClient[k] || "").trim()) patch[k] = newClient[k].trim(); });
      if (!Object.keys(patch).length) { showToast("Ce client existe déjà : renseignez au moins l'adresse, l'e-mail ou le téléphone pour le compléter."); return; }
      setClients((prev) => prev.map((c) => (c.id === existing.id ? { ...c, ...patch } : c)));
      setNewClient({ name: "", email: "", phone: "", address: "" });
      showToast("Fiche client complétée.");
      logAudit("CRM", "Fiche client complétée", newClient.name);
      return;
    }
    setClients((prev) => [...prev, { ...newClient, id: uid(), createdAt: new Date().toISOString() }]);
    setNewClient({ name: "", email: "", phone: "", address: "" });
    showToast("Client ajouté.");
    logAudit("CRM", "Ajout client", newClient.name);
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
    // Si le montant versé dépasse le solde de cette facture précise, l'excédent se
    // répartit automatiquement sur les factures suivantes du même client — de la
    // plus ancienne à la plus récente — jusqu'à épuisement du versement ou du solde
    // dû total. Sans ça, un versement supérieur au solde d'une facture voyait sa
    // différence disparaître sans jamais être appliquée nulle part.
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
      { const ent = simpleEntry(date, `${amt < due ? "Recouvrement partiel" : "Encaissement"} ${target.number || "(sans numéro)"} — ${target.client}${cheque ? ` (chèque n° ${cheque.number})` : ""}`, compte, "411", amt); newEntries.push(ent); updates[updates.length - 1].entryId = ent.id; }
    }
    setEntries((prev) => [...prev, ...newEntries]);
    if (cheque && setCheques && updates.length > 0) {
      setCheques((prev) => [...prev, makeChequeRecord({ kind: "recu", number: cheque.number, bank: cheque.bank, party: inv.client, amount: updates.reduce((t, u) => t + u.amt, 0), date, entryIds: newEntries.map((e) => e.id), links: updates.map((u) => ({ invoiceId: u.id, paymentId: u.payId, amt: u.amt, entryId: u.entryId })) })]);
      logAudit("Chèques", "Chèque reçu enregistré", `${inv.client} — n° ${cheque.number}`);
    }
    setInvoices((prev) => prev.map((i) => { const u = updates.find((x) => x.id === i.id); return u ? u.updatedInvoice : i; }));
    setPayAmounts((p) => ({ ...p, [inv.id]: "" }));
    const totalApplied = updates.reduce((s, u) => s + u.amt, 0);
    if (updates.length <= 1) {
      const u = updates[0];
      showToast(u && u.updatedInvoice.status === "payée"
        ? `Facture ${inv.number} régularisée — déplacée vers Clients payés.`
        : `Recouvrement partiel de ${fmt(totalApplied)} enregistré sur ${inv.number} (reste dû : ${fmt(restantInitial - totalApplied)}).`);
    } else {
      showToast(`Versement de ${fmt(totalApplied)} réparti sur ${updates.length} factures de ${inv.client} (${updates.map((u) => u.number).join(", ")}).`);
    }
    if (remaining > 0) {
      showToast(`Excédent de ${fmt(remaining)} non affecté : ${inv.client} n'a plus de facture en cours.`);
    }
    logAudit("CRM", updates.length > 1 ? "Recouvrement réparti sur plusieurs factures" : (updates[0]?.updatedInvoice.status === "payée" ? "Régularisation facture" : "Recouvrement partiel"), `${inv.client} — ${fmt(totalApplied)}`);
    verifyTransactionSaved(`Recouvrement ${inv.client}`, [
      { category: "entries", label: "écriture(s) de recouvrement", isPresent: (arr) => newEntries.every((e) => arr.some((x) => x.id === e.id)), buildNext: () => [...entries, ...newEntries] },
      { category: "invoices", label: "statut des factures", isPresent: (arr) => updates.every((u) => { const i = arr.find((x) => x.id === u.id); return i && i.status === u.updatedInvoice.status; }), buildNext: () => invoices.map((i) => { const u = updates.find((x) => x.id === i.id); return u ? u.updatedInvoice : i; }) },
    ], { showToast, logAudit });
  };

  // Sortie définitive d'une créance jugée irrécouvrable — différent d'une simple
  // provision (qui est une estimation de prudence, réversible) : ici, la créance
  // quitte réellement les comptes. La provision déjà constituée pour ce client (le
  // cas échéant) absorbe la perte en priorité ; seule la partie non couverte devient
  // une charge nouvelle (654). La provision du client est réduite d'autant, puisque
  // son rôle — anticiper cette perte précise — est maintenant rempli.
  const passerEnPerteDefinitive = (inv) => {
    const restant = balanceDue(inv);
    if (restant <= 0) { showToast("Cette facture est déjà soldée."); return; }
    const clientRecord = clients.find((c) => normalizeClientName(c.name) === normalizeClientName(inv.client));
    const availableProvision = Number(clientRecord?.doubtfulProvision) || 0;
    const covered = Math.min(availableProvision, restant);
    const uncovered = restant - covered;
    const confirmMsg = `Passer la facture ${inv.number} (${inv.client}, ${fmt(restant)}) en perte définitive ?${covered > 0 ? ` ${fmt(covered)} sera absorbé par la provision déjà constituée, ${fmt(uncovered)} passera en charge nouvelle.` : ` Aucune provision existante : ${fmt(uncovered)} passera intégralement en charge.`}`;
    if (!window.confirm(confirmMsg)) return;
    const date = todayStr();
    const lines = [{ account: "411", debit: 0, credit: restant }];
    if (covered > 0) lines.push({ account: "491", debit: covered, credit: 0 });
    if (uncovered > 0) lines.push({ account: "654", debit: uncovered, credit: 0 });
    const entry = { id: uid(), date, createdAt: new Date().toISOString(), label: `Perte définitive — Facture ${inv.number} (${inv.client})`, lines };
    const updatedInvoice = { ...inv, status: "perte", writeOffAt: new Date().toISOString() };

    // Double validation (forfait Assisté) : la demande est mise en attente au lieu
    // de s'exécuter immédiatement — tout est déjà calculé, seule son application
    // attend qu'un administrateur (soi-même ou un autre) l'approuve explicitement
    // depuis Administration → Approbations en attente.
    if (planTier === "assisted") {
      const alreadyPending = (pendingApprovals || []).some((a) => a.type === "perte_definitive" && a.payload?.invoiceId === inv.id);
      if (alreadyPending) {
        showToast("Une demande est déjà en attente d'approbation pour cette facture — inutile d'en créer une seconde.");
        return;
      }
      setPendingApprovals((prev) => [...prev, {
        id: uid(), type: "perte_definitive",
        label: `Perte définitive — Facture ${inv.number} (${inv.client}, ${fmt(restant)})`,
        requestedBy: currentUserEmail || "Inconnu", requestedAt: new Date().toISOString(),
        payload: { entry, invoiceId: inv.id, updatedInvoiceStatus: updatedInvoice.status, writeOffAt: updatedInvoice.writeOffAt, clientId: clientRecord?.id || null, covered, availableProvision },
      }]);
      showToast("Demande envoyée — en attente d'approbation par un administrateur.");
      return;
    }

    setEntries((prev) => [...prev, entry]);
    setInvoices((prev) => prev.map((i) => (i.id === inv.id ? updatedInvoice : i)));
    if (clientRecord && covered > 0) {
      setClients((prev) => prev.map((c) => (c.id === clientRecord.id ? { ...c, doubtfulProvision: availableProvision - covered } : c)));
    }
    logAudit("CRM", "Perte définitive créance", `${inv.number} — ${inv.client} : ${fmt(restant)}`);
    showToast(`Facture ${inv.number} passée en perte définitive.`);
    verifyTransactionSaved(`Perte définitive ${inv.number}`, [
      { category: "entries", label: "écriture de perte", isPresent: (arr) => arr.some((e) => e.id === entry.id), buildNext: () => [...entries, entry] },
      { category: "invoices", label: "statut de la facture", isPresent: (arr) => { const i = arr.find((x) => x.id === inv.id); return i && i.status === "perte"; }, buildNext: () => invoices.map((i) => (i.id === inv.id ? updatedInvoice : i)) },
    ], { showToast, logAudit });
  };

  return (
    <>
    <div className={`p-4 md:p-8 max-w-6xl${printInv ? " no-print" : ""}`}>
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module {rangModule("crm")}</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Comptes clients (CRM)</div>
        <p className="text-sm mt-1" style={{ color: "#7A7460" }}>
          Fiches alimentées automatiquement par les factures du module Vente — un client apparaît dès sa première vente.
        </p>
      </header>

      <div className="flex gap-1 mb-6 overflow-x-auto">
        {[["clients", "Clients"], ["dus", `Clients dûs${dueClientCount ? ` (${dueClientCount})` : ""}`], ["payes", "Clients payés"], ["douteuses", "Créances douteuses"], ["performance", "Performance"]].map(([id, label]) => (
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

      {tab === "clients" && (
      <>
      {canManageClients && (
      <div className="bg-white rounded-lg p-6 mb-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Compléter une fiche client</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Nom du client</label>
            <input value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })}
              placeholder="Doit correspondre au nom saisi en vente"
              className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Email</label>
            <input value={newClient.email} onChange={(e) => setNewClient({ ...newClient, email: e.target.value })}
              className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Téléphone</label>
            <input value={newClient.phone} onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })}
              className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
          </div>
          <div className="col-span-2 md:col-span-4">
            <label className="text-xs" style={{ color: "#8A8370" }}>Adresse (imprimée sur les factures du client)</label>
            <input value={newClient.address} onChange={(e) => setNewClient({ ...newClient, address: e.target.value })} data-testid="client-adresse"
              className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
          </div>
          <button onClick={addClient} className="flex items-center justify-center gap-2 px-4 py-2 rounded text-sm text-white h-[38px]" style={{ background: "#152238" }}>
            <Plus size={14} /> Enregistrer
          </button>
        </div>
      </div>
      )}

      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        {listRows.length === 0 ? (
          <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>
            Aucun client pour le moment. Ajoutez une fiche client ou faites une vente dans le module Vente.
          </div>
        ) : (
          <div className="overflow-x-auto overflow-y-auto max-h-[65vh] border rounded" style={{ borderColor: "#EEE9DA" }}><table className="w-full text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-2 font-normal">Client</th>
                <th className="py-2 font-normal">Contact</th>
                <th className="py-2 font-normal text-right">Factures</th>
                <th className="py-2 font-normal text-right">Total facturé</th>
                <th className="py-2 font-normal text-right">Solde dû</th>
                <th className="py-2 font-normal">Dernier achat</th>
                <th className="py-2 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {listRows.map((r) => (
                <React.Fragment key={r.name}>
                  <tr style={{ borderBottom: "1px solid #F3EFE3" }}>
                    <td className="py-2 font-medium" style={{ color: "#152238" }}>{r.name}</td>
                    <td className="py-2" style={{ color: "#7A7460" }}>{r.email || r.phone || "—"}</td>
                    <td className="py-2 tabular text-right">{r.nb}</td>
                    <td className="py-2 tabular text-right">{fmt(r.total)}</td>
                    <td className="py-2 tabular text-right" style={{ color: r.due > 0 ? "#A6432F" : "#0F6B5C" }}>{fmt(r.due)}</td>
                    <td className="py-2 tabular">{r.lastDate}</td>
                    <td className="py-2 text-right">
                      <button onClick={(e) => { e.stopPropagation(); setHistoryClientName(r.name); }} title="Historique" style={{ color: "#152238" }}><History size={14} /></button>
                    </td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
      </>
      )}

      {tab === "dus" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <p className="text-sm mb-4" style={{ color: "#7A7460" }}>
            Toutes les factures impayées ou partiellement réglées, tous clients confondus. Saisis un montant inférieur au solde pour un recouvrement partiel, ou laisse vide pour solder entièrement. Une facture soldée bascule automatiquement vers « Clients payés ».
          </p>

          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Du</label>
              <input type="date" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
              <input type="date" value={dueTo} onChange={(e) => setDueTo(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Client</label>
              <select value={dueClient} onChange={(e) => setDueClient(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }}>
                <option value="">Tous les clients</option>
                {dueClientOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Statut</label>
              <select value={dueStatus} onChange={(e) => setDueStatus(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }}>
                <option value="">Tous</option>
                <option value="impayée">Impayée</option>
                <option value="partielle">Partielle</option>
              </select>
            </div>
            {(dueFrom || dueTo || dueClient || dueStatus) && (
              <button onClick={() => { setDueFrom(""); setDueTo(""); setDueClient(""); setDueStatus(""); }} className="text-xs underline mb-1.5" style={{ color: "#8A8370" }}>
                Réinitialiser
              </button>
            )}
            {(dueFrom || dueTo || dueClient || dueStatus) && (
              <div className="tabular text-xs mb-1.5 ml-auto" style={{ color: "#152238" }}>
                {dueInvoices.length} facture{dueInvoices.length > 1 ? "s" : ""} · Reste dû {fmt(dueInvoices.reduce((s, i) => s + balanceDue(i), 0))}
              </div>
            )}
          </div>

          {dueInvoices.length === 0 ? (
            <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>{dueInvoicesAll.length === 0 ? "Aucune facture impayée actuellement." : "Aucune facture ne correspond à ces filtres."}</div>
          ) : (
            <div className="overflow-y-auto max-h-[65vh] space-y-2">
              {(() => {
                // Regroupe les factures filtrées par client (nom normalisé), pour
                // afficher une fiche par client — avec son solde cumulé sur toutes
                // ses factures — plutôt qu'une ligne par facture isolée. Facilite la
                // lecture dès qu'un client a plusieurs factures en cours, sans rien
                // changer à la logique des filtres eux-mêmes.
                const groups = {};
                const order = [];
                [...dueInvoices].reverse().forEach((inv) => {
                  const key = normalizeClientName(inv.client);
                  if (!groups[key]) { groups[key] = { name: inv.client, invoices: [] }; order.push(key); }
                  groups[key].invoices.push(inv);
                });
                return order.map((key) => {
                  const g = groups[key];
                  const groupDue = g.invoices.reduce((s, inv) => s + balanceDue(inv), 0);
                  const isExpanded = !!expandedDueClients[key];
                  // Bandeau de couleur selon l'ancienneté de la facture due la plus
                  // ancienne du client — un repère visuel rapide, indépendant du montant :
                  // vert (récent) → ambre (à surveiller) → rouge (ancien, à relancer).
                  const oldestDate = g.invoices.reduce((min, inv) => (!min || inv.date < min ? inv.date : min), null);
                  const daysOld = oldestDate ? Math.floor((new Date(todayStr()) - new Date(oldestDate)) / 86400000) : 0;
                  const accentColor = daysOld > 60 ? "#A32D2D" : daysOld > 30 ? "#BA7517" : "#639922";
                  return (
                    <div key={key} style={{ background: "#fff", borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 2px rgba(21,34,56,0.06)" }}>
                      <div className="flex items-stretch cursor-pointer" onClick={() => setExpandedDueClients((prev) => ({ ...prev, [key]: !prev[key] }))}>
                        <div style={{ width: 4, background: accentColor, flexShrink: 0 }}></div>
                        <div className="flex-1 flex items-center justify-between gap-2 px-3 py-2.5 flex-wrap">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="shrink-0" style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s", color: "#A39C87" }}>›</span>
                            <div className="min-w-0">
                              <div className="font-medium truncate" style={{ color: "#152238" }}>{g.name}</div>
                              <div className="text-xs" style={{ color: "#A39C87" }}>{g.invoices.length} facture{g.invoices.length > 1 ? "s" : ""}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="tabular font-medium" style={{ color: "#152238" }}>{fmt(groupDue)}</span>
                            <button onClick={(e) => { e.stopPropagation(); setHistoryClientName(g.name); }} title="Historique" style={{ color: "#8A8370" }}><History size={14} /></button>
                          </div>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="overflow-x-auto" style={{ borderTop: "1px solid #F0EDE3" }}>
                          <table className="w-full text-sm">
                            <tbody>
                              {g.invoices.map((inv) => {
                                const paid = (inv.payments || []).reduce((s, p) => s + p.amount, 0);
                                const restant = balanceDue(inv);
                                return (
                                <tr key={inv.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                                  <td className="py-2 pl-4 tabular">{inv.number}</td>
                                  <td className="py-2 tabular">{inv.date}<RecordedStamp createdAt={inv.createdAt} /></td>
                                  <td className="py-2 tabular text-right">{fmt(inv.total)}</td>
                                  <td className="py-2 tabular text-right" style={{ color: paid > 0 ? "#0F6B5C" : "#A39C87" }}>{fmt(paid)}</td>
                                  <td className="py-2 tabular text-right font-medium" style={{ color: "#A6432F" }}>{fmt(restant)}</td>
                                  <td className="py-2">
                                    <span className="text-xs px-2 py-0.5 rounded"
                                      style={{ background: inv.status === "partielle" ? "#FBF1DC" : "#F7E9E3", color: inv.status === "partielle" ? "#9A7B1E" : "#A6432F" }}>
                                      {inv.status === "partielle" ? "partielle" : "impayée"}
                                    </span>
                                  </td>
                                  <td className="py-2">
                                    <div className="flex flex-wrap gap-1 items-center">
                                      <button onClick={() => setApercuInv(inv)} className="text-xs px-2 py-1 rounded border" style={{ borderColor: "#DDD6C4", color: "#152238" }} data-testid="facture-voir">Voir la facture</button>
                                      <input type="number" min="0" placeholder={`≤ ${fmt(restant)} ou plus (réparti automatiquement)`}
                                        value={payAmounts[inv.id] || ""}
                                        onChange={(e) => setPayAmounts((p) => ({ ...p, [inv.id]: e.target.value }))}
                                        className="w-24 border rounded px-1.5 py-1 text-xs tabular" style={{ borderColor: "#DDD6C4" }} />
                                      <button onClick={() => encaisserFacture(inv, "530", payAmounts[inv.id] || null)} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Caisse</button>
                                      <button onClick={() => encaisserFacture(inv, "512", payAmounts[inv.id] || null)} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Banque</button>
                                      {role !== "Vendeur" && <button onClick={() => setChequeDlg({ id: inv.id })} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Chèque</button>}
                                      {chequeDlg && chequeDlg.id === inv.id && (
                                        <ChequeDialog title="Chèque reçu du client" partyLabel="Client" party={inv.client} askAmount amountDefault={payAmounts[inv.id] || restant}
                                          onClose={() => setChequeDlg(null)}
                                          onConfirm={(cq, amt) => { setChequeDlg(null); encaisserFacture(inv, "5112", amt, cq); }} />
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-2 text-right">
                                    <button onClick={() => passerEnPerteDefinitive(inv)} title="Passer en perte définitive" className="text-xs underline whitespace-nowrap" style={{ color: "#A6432F" }}>Perte définitive</button>
                                  </td>
                                </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </div>
      )}

      {tab === "payes" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <p className="text-sm mb-4" style={{ color: "#7A7460" }}>
            Toutes les factures déjà réglées, tous clients confondus.
          </p>

          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Du</label>
              <input type="date" value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
              <input type="date" value={paidTo} onChange={(e) => setPaidTo(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Client</label>
              <select value={paidClient} onChange={(e) => setPaidClient(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }}>
                <option value="">Tous les clients</option>
                {paidClientOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {(paidFrom || paidTo || paidClient) && (
              <button onClick={() => { setPaidFrom(""); setPaidTo(""); setPaidClient(""); }} className="text-xs underline mb-1.5" style={{ color: "#8A8370" }}>
                Réinitialiser
              </button>
            )}
            {(paidFrom || paidTo || paidClient) && (
              <div className="tabular text-xs mb-1.5 ml-auto" style={{ color: "#152238" }}>
                {paidInvoicesFiltered.length} facture{paidInvoicesFiltered.length > 1 ? "s" : ""} · Total {fmt(paidInvoicesFiltered.reduce((s, i) => s + i.total, 0))}
              </div>
            )}
          </div>

          {paidInvoicesFiltered.length === 0 ? (
            <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>{paidInvoices.length === 0 ? "Aucune facture payée pour le moment." : "Aucune facture ne correspond à ces filtres."}</div>
          ) : (
            <div className="overflow-y-auto max-h-[65vh] space-y-2">
              {[...paidInvoicesFiltered].reverse().map((inv) => (
                <div key={inv.id} className="flex items-stretch" style={{ background: "#fff", borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 2px rgba(21,34,56,0.06)" }}>
                  <div style={{ width: 4, background: "#0F6B5C", flexShrink: 0 }}></div>
                  <div className="flex-1 flex items-center justify-between gap-2 px-3 py-2.5 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-medium truncate" style={{ color: "#152238" }}>{inv.client}</div>
                      <div className="text-xs tabular" style={{ color: "#A39C87" }}>{inv.number} · {inv.date}<RecordedStamp createdAt={inv.createdAt} /></div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="tabular font-medium" style={{ color: "#0F6B5C" }}>{fmt(inv.total)}</span>
                      <button onClick={() => setApercuInv(inv)} className="text-xs px-2 py-0.5 rounded border" style={{ borderColor: "#DDD6C4", color: "#152238" }} data-testid="facture-voir-payee">Voir la facture</button>
                      <button onClick={() => setHistoryClientName(inv.client)} title="Historique" style={{ color: "#8A8370" }}><History size={14} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "douteuses" && (
        <ProvisionsCreancesPanel rows={rows} clients={clients} setClients={setClients} entries={entries} setEntries={setEntries} role={role} showToast={showToast} logAudit={logAudit} planTier={planTier} recordPendingRecommendation={recordPendingRecommendation} currentUserEmail={currentUserEmail} />
      )}

      {tab === "performance" && (() => {
        // Performance d'achat par client : montant acheté ce mois-ci, produit le
        // plus acheté (en montant cumulé, toutes périodes confondues) et le
        // pourcentage qu'il représente dans le total des achats du client — pour
        // repérer d'un coup d'œil les habitudes d'achat de chaque client.
        const now = new Date();
        const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const byClient = {};
        invoices.forEach((inv) => {
          if (!inv.client || inv.client === "Client comptant" || inv.status === "annulée" || inv.status === "don") return;
          const key = normalizeClientName(inv.client);
          if (!byClient[key]) byClient[key] = { name: inv.client, totalAll: 0, totalMonth: 0, products: {} };
          byClient[key].totalAll += Number(inv.total) || 0;
          if (inv.date && inv.date.startsWith(currentMonthPrefix)) byClient[key].totalMonth += Number(inv.total) || 0;
          (inv.lines || []).forEach((l) => {
            byClient[key].products[l.name] = (byClient[key].products[l.name] || 0) + (Number(l.subtotal) || 0);
          });
        });
        const perfRows = Object.values(byClient)
          .map((c) => {
            const sortedProducts = Object.entries(c.products).sort((a, b) => b[1] - a[1]);
            const top = sortedProducts[0];
            const pct = top && c.totalAll > 0 ? (top[1] / c.totalAll) * 100 : 0;
            return { name: c.name, totalMonth: c.totalMonth, topProductName: top?.[0] || "—", pct };
          })
          .sort((a, b) => b.totalMonth - a.totalMonth);

        return perfRows.length === 0 ? (
          <div className="bg-white rounded-lg p-8 text-center text-sm" style={{ border: "1px solid #E4DFD1", color: "#A39C87" }}>Aucun achat enregistré pour le moment.</div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,34,56,0.08)" }}>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#C7CCDA" }}>
                  <th className="py-2 px-3 text-left font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Client</th>
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

      {apercuInv && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto p-3 md:p-8" style={{ background: "rgba(21,34,56,0.55)" }} onClick={() => setApercuInv(null)} data-testid="facture-apercu">
          <div className="w-full" style={{ maxWidth: 860 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="text-sm" style={{ color: "#EFE9DD" }}>Aperçu de la facture {apercuInv.number} — tel qu'il sera imprimé ({cfg.receiptFormat === "ticket80" ? "ticket 80 mm" : cfg.receiptFormat === "ticket58" ? "ticket 58 mm" : "feuille A4"})</div>
              <div className="flex gap-2">
                <button onClick={() => { setPrintInv(apercuInv); setApercuInv(null); }} className="px-3 py-1.5 rounded text-sm" style={{ background: "#C9A24B", color: "#152238" }} data-testid="facture-imprimer">Imprimer</button>
                <button onClick={() => setApercuInv(null)} className="px-3 py-1.5 rounded text-sm" style={{ background: "#EFE9DD", color: "#152238" }} data-testid="facture-fermer">Fermer</button>
              </div>
            </div>
            <div className="rounded shadow-lg overflow-hidden" style={{ background: "#fff" }}>
              <InvoiceSheet invoice={{ ...apercuInv, clientAddress: apercuInv.clientAddress || ((clients || []).find((c) => c && c.address && normalizeClientName(c.name) === normalizeClientName(apercuInv.client)) || {}).address }} settings={cfg} />
            </div>
            <div className="text-xs mt-2" style={{ color: "#EFE9DD" }}>Le logo, le NIF, le taux de taxe, la mention de franchise et la zone de signature sont ceux de votre paramétrage.</div>
          </div>
        </div>
      )}
      {historyClientName && (
        <ClientHistoryModal clientName={historyClientName} invoices={invoices.filter((i) => normalizeClientName(i.client) === normalizeClientName(historyClientName))} onClose={() => setHistoryClientName(null)} />
      )}
    </div>
    {printInv && (
      <div className={`print-only${cfg.receiptFormat === "ticket80" ? " ticket-print-80" : cfg.receiptFormat === "ticket58" ? " ticket-print-58" : ""}`}>
        <InvoiceSheet invoice={printInv} settings={cfg} testPrefix="impression" />
      </div>
    )}
    </>
  );
}

// Modal d'historique client — chronologie complète mêlant achats (factures) et
// paiements/recouvrements, du plus récent au plus ancien. Utilisé depuis les trois
// onglets de Comptes clients (Clients, Clients dûs, Clients payés).
function ClientHistoryModal({ clientName, invoices, onClose }) {
  const timeline = [];
  invoices.forEach((inv) => {
    const invNum = inv.number || `#${inv.id}`;
    timeline.push({ key: `inv-${inv.id}`, date: inv.date, kind: "achat", label: `Facture ${invNum}${inv.status === "don" ? " (don)" : ""}`, amount: inv.total, status: inv.status || "—" });
    (inv.payments || []).forEach((p) => {
      const accountLabel = p.account === "530" ? "Caisse" : p.account === "512" ? "Banque" : (p.account || "Paiement");
      timeline.push({ key: `pay-${p.id}`, date: p.date, kind: "paiement", label: `${accountLabel} — Facture ${invNum}`, amount: p.amount || 0 });
    });
  });
  timeline.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(21,34,56,0.5)" }} onClick={onClose}>
      <div className="bg-white rounded-lg p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-medium" style={{ color: "#152238" }}>Historique — {clientName}</div>
          <button onClick={onClose} style={{ color: "#8A8370" }}><X size={16} /></button>
        </div>
        {timeline.length === 0 ? (
          <div className="text-xs py-4 text-center" style={{ color: "#A39C87" }}>Aucun mouvement enregistré pour ce client.</div>
        ) : (
          <div className="space-y-2">
            {timeline.map((t) => (
              <div key={t.key} className="flex items-center justify-between text-sm p-2 rounded" style={{ border: "1px solid #F3EFE3" }}>
                <div>
                  <div>{t.label}</div>
                  <div className="text-xs" style={{ color: "#A39C87" }}>{t.date || "date inconnue"} — {t.kind === "achat" ? "Achat" : "Recouvrement"}{t.kind === "achat" ? ` — ${t.status}` : ""}</div>
                </div>
                <div className="tabular font-medium" style={{ color: t.kind === "achat" ? "#152238" : "#0F6B5C" }}>
                  {t.kind === "achat" ? fmt(t.amount) : `+${fmt(t.amount)}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


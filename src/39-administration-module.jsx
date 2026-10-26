// ═══ MODULE ═══
// @module Administration module
// @depends APP_VERSION, BK_LABELS, CURRENCIES, DEFAULT_ACCOUNTS, DEFAULT_CLIENTS, DEFAULT_PRODUCTS
//   DEFAULT_SUPPLIERS, GroupedTabNav, NET_MSG, PartialResetPanel, Plus, RestorePreviewModal
//   TAX_SYSTEMS, bkBalance, bkBuildFile, bkDiff, bkDownload, bkVerify, ecInviteError, fmt
//   genInviteToken, invoicePrefix, isFutureDate, isLocked, logClientError, resizeImage
//   resolveMembership, roleLabel, rpSave, supabase, todayStr, uid, useBackNav, useEffect, useState
// @exports AdminModule
// ═══ FIN DE L'EN-TÊTE ═══
function AdminModule({
  settings, setSettings, users, setUsers, currentUserEmail, companyId,
  accounts, entries, products, productImages, invoices, suppliers, purchases, movements, clients, auditLog,
  employees, payslips, salaryAdvances, salesStations, assets, accruals, deferrals, riskProvisions, loans, setLoans, entryTemplates, pendingApprovals, cheques, setCheques, bizdocs, setBizdocs, ecole, setEcole, impex, setImpex, sante, setSante,
  setAccounts, setEntries, setProducts, setProductImages, setInvoices, setSuppliers, setPurchases, setMovements, setClients,
  setEmployees, setPayslips, setSalaryAdvances, setSalesStations, setAssets, setAccruals, setDeferrals, setRiskProvisions, setEntryTemplates, setPendingApprovals,
  showToast, logAudit, planTier, groupId, groupName, groupMaxCompanies, secteurs, planStatus, onSecteursChanged, ecoleLabels,
}) {
  // École : le nom du métier suivi du rôle réel entre parenthèses (ex. « Secrétaire-caissier(ère) (Vendeur) »), quel que soit l'espace de travail ouvert
  const roleOptionLabel = (r) => (ecoleLabels && roleLabel(r, ecoleLabels) !== roleLabel(r) ? roleLabel(r, ecoleLabels) + " (" + roleLabel(r) + ")" : roleLabel(r));
  const [tab, setTab] = useState("entreprise");
  useBackNav(tab, setTab, "entreprise");
  const [companyName, setCompanyName] = useState(settings.companyName);
  const [companyAddress, setCompanyAddress] = useState(settings.companyAddress || "");
  const [companyPhone, setCompanyPhone] = useState(settings.companyPhone || "");
  const [companyEmail, setCompanyEmail] = useState(settings.companyEmail || "");
  const [companyNIF, setCompanyNIF] = useState(settings.companyNIF || "");
  const [invoicePrefixIn, setInvoicePrefixIn] = useState(settings.invoicePrefix || "");
  const [clientAddressOnInvoice, setClientAddressOnInvoice] = useState(settings.clientAddressOnInvoice !== false);
  const [tcaFranchise, setTcaFranchise] = useState(!!settings.tcaFranchise);
  const [companyVille, setCompanyVille] = useState(settings.companyVille || "");
  const [companySecteurCode, setCompanySecteurCode] = useState(settings.companySecteurCode || "");
  const [companySecteurNom, setCompanySecteurNom] = useState(settings.companySecteurNom || "");
  const [companyType, setCompanyType] = useState(settings.companyType || "");
  const [companyLogo, setCompanyLogo] = useState(settings.companyLogo || null);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = React.useRef(null);

  // --- Assistant "Solde d'ouverture" (intégration d'une entreprise déjà en
  // activité) : enregistre où en est réellement l'entreprise au jour de la
  // bascule (trésorerie, créances clients, dettes fournisseurs), sans jamais
  // recréer l'historique détaillé passé. Le compte 108 sert uniquement de
  // contrepartie d'équilibrage pour ces écritures d'ouverture — jamais crédité
  // en produit (706/707) ni débité en charge, pour ne pas fausser le résultat
  // du mois en cours avec des montants qui datent d'avant l'usage de l'app.
  const [migDate, setMigDate] = useState(todayStr());
  const [migCaisse, setMigCaisse] = useState("");
  const [migBanque, setMigBanque] = useState("");
  const [migStock, setMigStock] = useState("");
  const [migClients, setMigClients] = useState([{ id: uid(), name: "", amount: "", note: "" }]);
  const [migSuppliers, setMigSuppliers] = useState([{ id: uid(), name: "", amount: "", note: "" }]);
  const [migRunning, setMigRunning] = useState(false);
  const ensure108 = () => {
    if (!accounts.some((a) => a.code === "108")) {
      setAccounts((prev) => [...prev, { code: "108", name: "Report d'ouverture (solde initial)", type: "Capitaux propres" }]);
    }
  };
  const updateMigRow = (setter, id, field, value) => setter((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  const addMigRow = (setter) => setter((prev) => [...prev, { id: uid(), name: "", amount: "", note: "" }]);
  const removeMigRow = (setter, id) => setter((prev) => prev.filter((r) => r.id !== id));

  const runMigration = async () => {
    if (migRunning) return;
    if (isFutureDate(migDate)) { showToast("Impossible d'utiliser une date future pour le solde d'ouverture."); return; }
    if (isLocked(migDate, settings)) { showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus.`); return; }
    const caisse = Number(migCaisse) || 0;
    const banque = Number(migBanque) || 0;
    const stockValue = Number(migStock) || 0;
    const clientRows = migClients.filter((r) => r.name.trim() && Number(r.amount) > 0);
    const supplierRows = migSuppliers.filter((r) => r.name.trim() && Number(r.amount) > 0);
    if (caisse <= 0 && banque <= 0 && stockValue <= 0 && clientRows.length === 0 && supplierRows.length === 0) {
      showToast("Renseignez au moins un montant (trésorerie, stock, créance ou dette) avant de générer le solde d'ouverture.");
      return;
    }
    setMigRunning(true);
    ensure108();
    const newEntries = [];
    const newInvoices = [];
    const newPurchases = [];
    const newClients = [];
    const newSuppliers = [];

    if (caisse > 0 || banque > 0) {
      const lines = [];
      if (caisse > 0) lines.push({ account: "530", debit: caisse, credit: 0 });
      if (banque > 0) lines.push({ account: "512", debit: banque, credit: 0 });
      lines.push({ account: "108", debit: 0, credit: caisse + banque });
      newEntries.push({ id: uid(), date: migDate, createdAt: new Date().toISOString(), label: "Solde d'ouverture — Trésorerie existante", lines });
    }

    // Stock déjà en rayon au moment de l'intégration : comptabilisé selon la méthode
    // choisie par l'entreprise — en actif (370) si "stock en actif" est activé,
    // sinon en charge (607) comme n'importe quel achat, comportement historique.
    // Sans cette écriture, la quantité physique serait bien suivie (Catalogue →
    // Stock initial) mais sa valeur resterait absente des comptes.
    if (stockValue > 0) {
      const stockAccount = settings.stockValuationMethod === "actif" ? "370" : "607";
      newEntries.push({
        id: uid(), date: migDate, createdAt: new Date().toISOString(),
        label: "Solde d'ouverture — Stock existant",
        lines: [{ account: stockAccount, debit: stockValue, credit: 0 }, { account: "108", debit: 0, credit: stockValue }],
      });
    }

    clientRows.forEach((r) => {
      const amount = Number(r.amount);
      const invId = uid();
      const label = r.note.trim() ? `Solde d'ouverture — ${r.note.trim()}` : "Solde d'ouverture";
      newEntries.push({ id: uid(), invoiceId: invId, date: migDate, createdAt: new Date().toISOString(), label: `Solde d'ouverture — Créance client (${r.name.trim()})`, lines: [{ account: "411", debit: amount, credit: 0 }, { account: "108", debit: 0, credit: amount }] });
      newInvoices.push({ id: invId, date: migDate, createdAt: new Date().toISOString(), client: r.name.trim(), items: [{ name: label, qty: 1, price: amount }], total: amount, paymentMode: "credit", status: "impayé", isOpeningBalance: true });
      if (!clients.some((c) => c.name.trim().toLowerCase() === r.name.trim().toLowerCase()) && !newClients.some((c) => c.name.toLowerCase() === r.name.trim().toLowerCase())) {
        newClients.push({ id: uid(), name: r.name.trim(), phone: "", note: "Ajouté via le solde d'ouverture" });
      }
    });

    supplierRows.forEach((r) => {
      const amount = Number(r.amount);
      const purchaseId = uid();
      const label = r.note.trim() ? `Solde d'ouverture — ${r.note.trim()}` : "Solde d'ouverture";
      newEntries.push({ id: purchaseId, date: migDate, createdAt: new Date().toISOString(), label: `Solde d'ouverture — Dette fournisseur (${r.name.trim()})`, lines: [{ account: "108", debit: amount, credit: 0 }, { account: "401", debit: 0, credit: amount }] });
      newPurchases.push({ id: purchaseId, date: migDate, createdAt: new Date().toISOString(), supplier: r.name.trim(), label, amount, paymentMode: "credit", status: "à payer", isOpeningBalance: true });
      if (!suppliers.some((s) => s.name.trim().toLowerCase() === r.name.trim().toLowerCase()) && !newSuppliers.some((s) => s.name.toLowerCase() === r.name.trim().toLowerCase())) {
        newSuppliers.push({ id: uid(), name: r.name.trim(), contact: "" });
      }
    });

    setEntries((prev) => [...prev, ...newEntries]);
    if (newInvoices.length) setInvoices((prev) => [...prev, ...newInvoices]);
    if (newPurchases.length) setPurchases((prev) => [...prev, ...newPurchases]);
    if (newClients.length) setClients((prev) => [...prev, ...newClients]);
    if (newSuppliers.length) setSuppliers((prev) => [...prev, ...newSuppliers]);

    const summary = [
      caisse > 0 || banque > 0 ? `Trésorerie ${fmt(caisse + banque)}` : null,
      stockValue > 0 ? `Stock ${fmt(stockValue)}` : null,
      clientRows.length ? `${clientRows.length} créance(s) client` : null,
      supplierRows.length ? `${supplierRows.length} dette(s) fournisseur` : null,
    ].filter(Boolean).join(" · ");
    showToast(`Solde d'ouverture enregistré : ${summary}.`);
    logAudit("Administration", "Solde d'ouverture", summary);
    setMigCaisse(""); setMigBanque(""); setMigStock("");
    setMigClients([{ id: uid(), name: "", amount: "", note: "" }]);
    setMigSuppliers([{ id: uid(), name: "", amount: "", note: "" }]);
    setMigRunning(false);
  };

  const handleLogoUpload = async (file) => {
    if (!file) return;
    setLogoUploading(true);
    try {
      // Logo un peu plus grand qu'une image produit (160px) pour rester net en
      // en-tête de PDF, mais toujours compressé pour ne pas alourdir le stockage.
      const dataUrl = await resizeImage(file, 300, 0.85);
      setCompanyLogo(dataUrl);
      setSettings((prev) => ({ ...prev, companyLogo: dataUrl }));
      showToast("Logo enregistré — apparaîtra sur les factures et rapports.");
    } catch (e) {
      showToast("Impossible de traiter cette image.");
    }
    setLogoUploading(false);
  };

  const removeLogo = () => {
    setCompanyLogo(null);
    setSettings((prev) => ({ ...prev, companyLogo: null }));
    showToast("Logo retiré.");
  };
  const [currency, setCurrency] = useState(settings.currency || "HTG");
  const [taxForm, setTaxForm] = useState({
    taxSystem: settings.taxSystem,
    taxRate: settings.taxRate,
    taxAccount: settings.taxAccount,
    taxDeductibleOnPurchases: settings.taxDeductibleOnPurchases,
  });
  const [newUser, setNewUser] = useState({ email: "", role: "Éditeur", assistedSupervisor: false, accountant: false });
  const [lastInviteLink, setLastInviteLink] = useState(null);
  const [lockDate, setLockDate] = useState(settings.lockDate || "");
  useEffect(() => { setLockDate(settings.lockDate || ""); }, [settings.lockDate]);
  const [members, setMembers] = useState([]);
  const [myCompanyId, setMyCompanyId] = useState(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const isPrimaryAdmin = members.find((m) => currentUserEmail && m.email?.toLowerCase() === currentUserEmail.toLowerCase())?.is_primary_admin || false;
  const myMemberRole = members.find((m) => currentUserEmail && m.email?.toLowerCase() === currentUserEmail.toLowerCase())?.role || "";
  const fileInputRef = React.useRef(null);
  const [histFrom, setHistFrom] = useState("");
  const [histTo, setHistTo] = useState("");
  const [histModule, setHistModule] = useState("");
  const [histUser, setHistUser] = useState("");
  const histModules = [...new Set((auditLog || []).map((a) => a.module))];
  const histUsers = [...new Set((auditLog || []).map((a) => a.user))];
  const histFiltered = [...(auditLog || [])].reverse().filter((a) => {
    const d = a.date.slice(0, 10);
    return (!histFrom || d >= histFrom) && (!histTo || d <= histTo) && (!histModule || a.module === histModule) && (!histUser || a.user === histUser);
  });

  const loadMembers = async () => {
    setMembersLoading(true);
    try {
      const { companyId } = await resolveMembership();
      setMyCompanyId(companyId);
      let { data, error } = await supabase
        .from("company_members")
        .select("id, email, role, user_id, is_primary_admin, is_assisted_supervisor")
        .eq("company_id", companyId)
        .order("created_at", { ascending: true });
      if (error && error.code === "42703") {
        const retry = await supabase
          .from("company_members")
          .select("id, email, role, user_id")
          .eq("company_id", companyId)
          .order("created_at", { ascending: true });
        data = retry.data; error = retry.error;
      }
      if (!error) {
        // Marqueur expert-comptable : lecture séparée et facultative (colonne ajoutée par le
        // script SQL du chantier I) — son absence ne doit jamais empêcher l'affichage des membres.
        let rows = data || [];
        try {
          const acc = await supabase.from("company_members").select("id, is_accountant").eq("company_id", companyId);
          if (!acc.error && acc.data) { const m = {}; acc.data.forEach((r) => { m[r.id] = !!r.is_accountant; }); rows = rows.map((r) => ({ ...r, is_accountant: !!m[r.id] })); }
        } catch (e2) {}
        // Droit de régularisation de l'expert-comptable : colonne facultative (script SQL v235).
        try {
          const adj = await supabase.from("company_members").select("id, can_adjust").eq("company_id", companyId);
          if (!adj.error && adj.data) { const m2 = {}; adj.data.forEach((r) => { m2[r.id] = !!r.can_adjust; }); rows = rows.map((r) => ({ ...r, can_adjust: !!m2[r.id], adjust_ready: true })); }
        } catch (e3) {}
        setMembers(rows);
      }
    } catch (e) {
      // hors mode Supabase, rien à charger
    }
    setMembersLoading(false);
  };

  useEffect(() => {
    // Chargé dès l'ouverture du module (pas seulement sur l'onglet Utilisateurs) : le
    // statut d'administrateur principal est nécessaire ailleurs aussi (ex. onglet
    // Données, pour savoir qui peut réinitialiser).
    loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveCompany = async () => {
    const finalName = companyName.trim() || settings.companyName;
    try {
      // .limit(1) plutôt que .maybeSingle() : cette dernière lève une exception
      // dès que PLUSIEURS entreprises partagent déjà un nom proche (pas
      // seulement une) — une exception ici empêchait silencieusement tout le
      // reste de cette fonction de s'exécuter, y compris l'enregistrement réel
      // du nom en base, alors que l'écran affichait quand même "enregistré".
      const { data: clashRows } = await supabase
        .from("companies")
        .select("id")
        .ilike("name", finalName)
        .neq("id", companyId)
        .limit(1);
      if (clashRows && clashRows.length > 0) {
        showToast(`Le nom « ${finalName} » est déjà utilisé par une autre entreprise — choisissez-en un autre.`);
        return;
      }
      const { data: nameUpdateRows, error: nameUpdateErr } = await supabase.from("companies").update({ name: finalName }).eq("id", companyId).select("id");
      if (nameUpdateErr) {
        showToast("Le nom n'a pas pu être enregistré pour le moment. " + NET_MSG + " Les autres informations ont bien été sauvegardées.");
        logClientError("saveCompany_name_update_failed: " + nameUpdateErr.message, JSON.stringify(nameUpdateErr), window.location.href);
      } else if (!nameUpdateRows || nameUpdateRows.length === 0) {
        // Aucune erreur renvoyée, mais AUCUNE ligne affectée non plus — signe
        // typique d'un filtrage silencieux par une règle de sécurité (RLS),
        // jamais remonté comme une erreur classique autrement.
        showToast("Le nom n'a pas pu être enregistré pour le moment. Les autres informations ont bien été sauvegardées. Si le problème persiste, contactez le support.");
        logClientError("saveCompany_name_update_zero_rows_affected", "companyId=" + companyId + " finalName=" + finalName, window.location.href);
      }
      // Le téléphone de l'entreprise est aussi gardé côté serveur : il sert aux rappels de facture (WhatsApp). Sans effet si la colonne n'existe pas encore.
      if (String(companyPhone || "").trim()) { try { await supabase.from("companies").update({ phone: String(companyPhone).trim() }).eq("id", companyId); } catch (e2) { /* sans effet */ } }
    } catch (e) {
      showToast("Le nom n'a peut-être pas pu être enregistré côté serveur — les autres informations ont quand même été sauvegardées localement.");
      logClientError("saveCompany_exception: " + String(e), String(e && e.stack || ""), window.location.href);
    }
    setSettings({ ...settings, companyName: finalName, companyAddress, companyPhone, companyEmail, companyNIF, invoicePrefix: invoicePrefixIn.replace(/[^A-Za-z0-9-]/g, "").slice(0, 8), clientAddressOnInvoice, tcaFranchise, companyVille, companySecteurCode, companySecteurNom, companyType, currency });
    showToast("Paramètres de l'entreprise enregistrés.");
  };

  const saveTax = () => {
    setSettings({ ...settings, ...taxForm, taxRate: Number(taxForm.taxRate) });
    showToast("Système de taxation mis à jour. Les nouveaux articles reprendront ce taux par défaut.");
  };

  const saveLockDate = () => {
    if (lockDate && settings.lockDate && lockDate < settings.lockDate) {
      if (!window.confirm(`Vous êtes sur le point de ROUVRIR des périodes déjà clôturées (du ${lockDate} au ${settings.lockDate}). Cela permettra à nouveau de créer, modifier ou annuler des écritures sur cette plage de dates. Continuer ?`)) return;
    } else if (lockDate) {
      if (!window.confirm(`Clôturer toutes les périodes jusqu'au ${lockDate} inclus ? Plus aucune écriture, facture, achat ou opération de caisse/banque datée à cette période ou avant ne pourra être créée, modifiée ou annulée. Cette action peut être annulée par un administrateur en repoussant la date.`)) return;
    }
    setSettings({ ...settings, lockDate });
    showToast(lockDate ? `Période clôturée jusqu'au ${lockDate} inclus.` : "Clôture retirée — plus aucune période n'est verrouillée.");
    logAudit("Administration", "Modification clôture d'exercice", lockDate || "aucune (déverrouillé)");
  };

  const addUser = async () => {
    if (!newUser.email) {
      showToast("L'email de l'utilisateur est requis.");
      return;
    }
    const email = newUser.email.trim().toLowerCase();
    try {
      const { companyId } = await resolveMembership();

      const { data: allRows, error: fetchErr } = await supabase
        .from("company_members")
        .select("id, company_id, user_id, role, invite_token")
        .eq("email", email);
      // Une même adresse peut figurer dans PLUSIEURS entreprises (cabinet d'expertise
      // comptable) : on cherche la ligne de CETTE entreprise, pas la première venue.
      const existingRows = (allRows || []).filter((r) => r.company_id === companyId);
      const elsewhere = (allRows || []).filter((r) => r.company_id !== companyId);

      if (fetchErr) {
        showToast("Impossible de vérifier cette invitation.");
        return;
      }

      const existing = existingRows && existingRows[0];
      // Lien d'invitation à jeton unique : plus fiable qu'un email à faire
      // correspondre exactement — la personne invitée n'a qu'à ouvrir ce lien précis
      // pour rejoindre l'entreprise, quel que soit l'email avec lequel elle se
      // connecte ensuite.
      const buildInviteLink = (token) => `${window.location.origin}${window.location.pathname}?invite=${token}`;

      if (!existing && elsewhere.length > 0 && !newUser.accountant) {
        showToast("Cette adresse est déjà rattachée à une autre entreprise. Seul un expert-comptable (lecture seule) peut l'être à plusieurs.");
        return;
      }
      if (existing) {
        // Membre déjà existant (invitation en attente ou compte déjà actif) :
        // on ne touche JAMAIS à user_id, seulement au rôle — pour ne jamais
        // déconnecter un compte déjà réclamé en réinvitant la même personne.
        // Un jeton est généré s'il n'en existe pas déjà (invitation créée avant
        // ce système), pour que même une ré-invitation obtienne un lien à jour.
        const token = existing.invite_token || genInviteToken();
        const updates = { role: newUser.role, is_assisted_supervisor: newUser.assistedSupervisor };
        if (newUser.accountant) updates.is_accountant = true;
        if (!existing.invite_token) updates.invite_token = token;
        const { error: updateErr } = await supabase
          .from("company_members")
          .update(updates)
          .eq("id", existing.id);
        if (updateErr) {
          showToast(ecInviteError(updateErr, "Impossible de mettre à jour cette invitation."));
          return;
        }
        setNewUser({ email: "", role: "Éditeur", assistedSupervisor: false, accountant: false });
        if (!existing.user_id) setLastInviteLink({ email, link: buildInviteLink(token) });
        showToast(existing.user_id
          ? `${email} est déjà membre — rôle mis à jour.`
          : `Invitation déjà existante pour ${email} — rôle mis à jour.`);
        logAudit("Administration", "Mise à jour invitation existante", `${email} — rôle ${roleLabel(newUser.role, ecoleLabels)}`);
        loadMembers();
        return;
      }

      const token = genInviteToken();
      const { error } = await supabase
        .from("company_members")
        .insert({ company_id: companyId, email, role: newUser.role, is_assisted_supervisor: newUser.assistedSupervisor, invite_token: token, ...(newUser.accountant ? { is_accountant: true } : {}) });
      if (error) {
        showToast(ecInviteError(error, error.code === "23505" ? "Cette personne est déjà membre." : "Impossible d'ajouter cette personne."));
        return;
      }
      setNewUser({ email: "", role: "Éditeur", assistedSupervisor: false, accountant: false });
      setLastInviteLink({ email, link: buildInviteLink(token) });
      showToast(`Invitation créée pour ${email}.`);
      logAudit("Administration", "Invitation utilisateur", `${email} — rôle ${roleLabel(newUser.role, ecoleLabels)}`);
      loadMembers();
    } catch (e) {
      showToast("Action impossible pour le moment. Vérifiez votre connexion internet puis réessayez.");
    }
  };

  const changeUserRole = async (member, selectedLabel) => {
    if (member.is_primary_admin && (!currentUserEmail || member.email.toLowerCase() !== currentUserEmail.toLowerCase())) {
      showToast("Un administrateur principal ne peut pas être rétrogradé par un autre administrateur.");
      return;
    }
    // "Superviseur assisté" n'est pas un rôle stocké tel quel : c'est un
    // Administrateur (mêmes droits, sauf ceux réservés au principal) avec un
    // simple marqueur cosmétique + déclencheur des fonctionnalités d'assistance.
    // Voir la note technique dans la mémoire du projet (Option B).
    const isExpert = selectedLabel === "Expert-comptable";
    const isAssisted = selectedLabel === "Superviseur assisté";
    const role = isExpert ? "Lecture seule" : isAssisted ? "Administrateur" : selectedLabel;
    const upd = { role, is_assisted_supervisor: isAssisted };
    if (isExpert) upd.is_accountant = true; else if (member.is_accountant) upd.is_accountant = false;
    const { error: roleErr } = await supabase.from("company_members").update(upd).eq("id", member.id);
    if (roleErr) { showToast(ecInviteError(roleErr, "Le rôle n'a pas pu être modifié.")); loadMembers(); return; }
    loadMembers();
    showToast("Rôle mis à jour.");
    logAudit("Administration", "Changement de rôle", `${member.email} — ${selectedLabel}`);
  };

  // Accorde ou retire à un expert-comptable le droit de passer des écritures de régularisation.
  // Réservé à l'administrateur (contrôlé aussi côté serveur). Effet à la prochaine ouverture de l'expert.
  const setAdjustRight = async (member, on) => {
    if (on && !window.confirm(`Autoriser ${member.email} à passer des écritures de régularisation dans la comptabilité (écritures manuelles, régularisations, provisions, amortissements) ? Il pourra ajouter des écritures, jamais en supprimer ni en modifier, et chaque action sera tracée. Vous pourrez retirer ce droit à tout moment.`)) return;
    const { error } = await supabase.from("company_members").update({ can_adjust: !!on }).eq("id", member.id);
    if (error) { showToast("Le droit n'a pas pu être modifié. Réessayez dans un instant."); loadMembers(); return; }
    loadMembers();
    showToast(on ? "Droit de régularisation accordé." : "Droit de régularisation retiré.");
    logAudit("Administration", on ? "Droit de régularisation accordé à l'expert-comptable" : "Droit de régularisation retiré à l'expert-comptable", member.email);
  };
  const removeUser = async (member) => {
    if (member.is_primary_admin && (!currentUserEmail || member.email.toLowerCase() !== currentUserEmail.toLowerCase())) {
      showToast("Un administrateur principal ne peut pas être retiré par un autre administrateur.");
      return;
    }
    const warning = member.user_id
      ? `Retirer ${member.email} de l'entreprise ? Ce membre a déjà un compte actif — il perdra l'accès immédiatement et devra être réinvité pour revenir.`
      : `Annuler l'invitation en attente pour ${member.email} ? Le lien d'invitation envoyé (par WhatsApp, SMS, etc.) cessera immédiatement de fonctionner.`;
    if (!window.confirm(warning)) return;
    await supabase.from("company_members").delete().eq("id", member.id);
    loadMembers();
    showToast("Membre retiré.");
    logAudit("Administration", "Retrait utilisateur", member.email);
  };

  const [lastExportAt, setLastExportAt] = useState(() => { try { return localStorage.getItem("compta-plus-last-export"); } catch (e) { return null; } });
  const buildExportData = () => ({ accounts, entries, products, productImages, invoices, suppliers, purchases, movements, clients, settings, users, employees, payslips, salaryAdvances, salesStations, assets, accruals, deferrals, riskProvisions, loans, entryTemplates, pendingApprovals, cheques, bizdocs, ecole, impex, sante });
  const buildBackupNow = (label) => bkBuildFile(buildExportData(), companyId || myCompanyId, label);
  const exportData = () => {
    bkDownload(buildBackupNow("Export manuel"), `sauvegarde-${settings.companyName || "erp"}-${todayStr()}.json`);
    const now = new Date().toISOString();
    try { localStorage.setItem("compta-plus-last-export", now); } catch (e) { /* stockage local indisponible, tant pis pour le rappel */ }
    setLastExportAt(now);
    showToast("Export généré.");
  };
  const [showCopyExport, setShowCopyExport] = useState(false);
  const [exportText, setExportText] = useState("");
  const exportTextareaRef = React.useRef(null);
  const openCopyExport = () => {
    setExportText(JSON.stringify(buildBackupNow("Export copié")));
    setShowCopyExport(true);
  };
  const copyExportText = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      showToast("Texte copié dans le presse-papiers.");
      return;
    } catch (err) {
      // Sur certains navigateurs/appareils, l'API Clipboard est indisponible ou
      // refusée (permission) — repli sur la sélection manuelle + execCommand,
      // qui fonctionne encore sur beaucoup d'anciens navigateurs Android.
      try {
        exportTextareaRef.current?.focus();
        exportTextareaRef.current?.select();
        const ok = document.execCommand("copy");
        showToast(ok ? "Texte copié dans le presse-papiers." : "Copie automatique indisponible — sélectionnez le texte manuellement et copiez-le.");
      } catch (err2) {
        showToast("Copie automatique indisponible — sélectionnez le texte manuellement et copiez-le.");
      }
    }
  };
  const exportDaysAgo = lastExportAt ? Math.floor((Date.now() - new Date(lastExportAt).getTime()) / 86400000) : null;

  // Schéma minimal attendu pour chaque catégorie importable : "array" (liste d'objets)
  // ou "object" (dictionnaire/objet simple). Sert à rejeter un fichier malformé ou
  // corrompu avant qu'il n'écrase les données actuelles.
  const IMPORT_SCHEMA = {
    accounts: { kind: "array", requiredKeys: ["code", "name"] },
    entries: { kind: "array", requiredKeys: ["id", "date"], dateKeys: ["date"], hasLines: true },
    products: { kind: "array", requiredKeys: ["id", "name"], numericKeys: ["price", "tva", "stock", "seuil"] },
    productImages: { kind: "object" },
    invoices: { kind: "array", requiredKeys: ["id"], numericKeys: ["total"], dateKeys: ["date"] },
    suppliers: { kind: "array", requiredKeys: ["id", "name"] },
    purchases: { kind: "array", requiredKeys: ["id"], numericKeys: ["amount"], dateKeys: ["date"] },
    movements: { kind: "array", requiredKeys: ["id"], numericKeys: ["qty"], dateKeys: ["date"] },
    clients: { kind: "array", requiredKeys: ["id", "name"] },
    settings: { kind: "object" },
    users: { kind: "array" },
    employees: { kind: "array", requiredKeys: ["id", "name"], numericKeys: ["baseSalary", "overtimeRate"] },
    salesStations: { kind: "array", requiredKeys: ["id", "name"] },
    assets: { kind: "array", requiredKeys: ["id", "name"], numericKeys: ["originalValue", "usefulLifeYears", "accumulatedDepreciation", "degressiveRate"] },
    accruals: { kind: "array", requiredKeys: ["id", "type"], numericKeys: ["amount"], dateKeys: ["date"] },
    deferrals: { kind: "array", requiredKeys: ["id", "type"], numericKeys: ["totalAmount", "months", "amountRecognized"], dateKeys: ["startDate"] },
    riskProvisions: { kind: "array", requiredKeys: ["id", "label"], numericKeys: ["currentAmount"], dateKeys: ["date"] },
    loans: { kind: "array", requiredKeys: ["id", "name"], numericKeys: ["principal", "annualRate"], dateKeys: ["startDate"] },
    entryTemplates: { kind: "array", requiredKeys: ["id", "name"] },
    pendingApprovals: { kind: "array", requiredKeys: ["id", "type"] },
    cheques: { kind: "array", requiredKeys: ["id", "kind"], numericKeys: ["amount"], dateKeys: ["date"] },
    bizdocs: { kind: "array", requiredKeys: ["id", "type"] },
    ecole: { kind: "array", requiredKeys: ["id", "type"] },
    impex: { kind: "array", requiredKeys: ["id", "type"] },
    sante: { kind: "array", requiredKeys: ["id", "type"] },
    payslips: { kind: "array", requiredKeys: ["id", "employeeId"], numericKeys: ["netAmount", "grossAmount"], dateKeys: ["date"] },
    salaryAdvances: { kind: "array", requiredKeys: ["id", "employeeId"], numericKeys: ["amount", "repaidAmount"], dateKeys: ["date"] },
  };

  // Un champ "numérique" doit être un nombre fini une fois converti — rejette les
  // NaN, Infinity, chaînes non numériques ou objets glissés dans un champ censé
  // porter un montant/une quantité, qui provoqueraient sinon des calculs erronés
  // ou des plantages d'affichage ailleurs dans l'app sans message clair.
  const isValidNumericField = (v) => v === undefined || v === null || v === "" || Number.isFinite(Number(v));
  const isValidDateField = (v) => v === undefined || v === null || v === "" || !isNaN(new Date(v).getTime());

  // Valide la forme des données importées : type correct par catégorie, éléments de
  // liste bien des objets porteurs des clés minimales attendues, et suppression des
  // clés dangereuses (__proto__, constructor, prototype) qui n'ont rien à faire dans
  // une sauvegarde légitime.
  const validateImportData = (data) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, error: "Le fichier ne contient pas un objet JSON valide." };
    }
    const DANGEROUS_KEYS = ["__proto__", "constructor", "prototype"];
    const sanitize = (obj) => {
      if (Array.isArray(obj)) return obj.map(sanitize);
      if (obj && typeof obj === "object") {
        const clean = {};
        for (const k of Object.keys(obj)) {
          if (DANGEROUS_KEYS.includes(k)) continue;
          clean[k] = sanitize(obj[k]);
        }
        return clean;
      }
      return obj;
    };

    const cleaned = {};
    const counts = {};
    for (const [category, schema] of Object.entries(IMPORT_SCHEMA)) {
      if (!(category in data)) continue;
      const value = sanitize(data[category]);
      if (schema.kind === "array") {
        if (!Array.isArray(value)) {
          return { ok: false, error: `"${category}" doit être une liste dans le fichier importé.` };
        }
        const badIndex = value.findIndex((item) => !item || typeof item !== "object" || Array.isArray(item));
        if (badIndex !== -1) {
          return { ok: false, error: `"${category}" contient un élément invalide (position ${badIndex + 1}).` };
        }
        if (schema.requiredKeys) {
          const missing = value.find((item) => schema.requiredKeys.some((k) => !(k in item)));
          if (missing) {
            return { ok: false, error: `"${category}" contient un élément sans "${schema.requiredKeys.join('"/"')}".` };
          }
        }
        if (schema.numericKeys) {
          const badItemIndex = value.findIndex((item) => schema.numericKeys.some((k) => k in item && !isValidNumericField(item[k])));
          if (badItemIndex !== -1) {
            return { ok: false, error: `"${category}" contient une valeur non numérique là où un montant/une quantité est attendu (position ${badItemIndex + 1}).` };
          }
        }
        if (schema.dateKeys) {
          const badItemIndex = value.findIndex((item) => schema.dateKeys.some((k) => k in item && !isValidDateField(item[k])));
          if (badItemIndex !== -1) {
            return { ok: false, error: `"${category}" contient une date invalide (position ${badItemIndex + 1}).` };
          }
        }
        if (schema.hasLines) {
          const badItemIndex = value.findIndex((item) => {
            if (item.lines === undefined) return false;
            if (!Array.isArray(item.lines)) return true;
            return item.lines.some((l) => !l || typeof l !== "object" || !isValidNumericField(l.debit) || !isValidNumericField(l.credit) || (l.debit === undefined && l.credit === undefined));
          });
          if (badItemIndex !== -1) {
            return { ok: false, error: `"${category}" contient une écriture aux lignes invalides (position ${badItemIndex + 1}) — chaque ligne doit avoir un débit/crédit numérique.` };
          }
        }
        counts[category] = value.length;
      } else {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return { ok: false, error: `"${category}" doit être un objet dans le fichier importé.` };
        }
        if (category === "settings") {
          if ("taxRate" in value && !isValidNumericField(value.taxRate)) {
            return { ok: false, error: `"settings.taxRate" doit être un nombre.` };
          }
          if ("taxSystem" in value && value.taxSystem && !(value.taxSystem in TAX_SYSTEMS)) {
            return { ok: false, error: `"settings.taxSystem" doit être l'un de : ${Object.keys(TAX_SYSTEMS).join(", ")}.` };
          }
        }
        counts[category] = Object.keys(value).length;
      }
      cleaned[category] = value;
    }
    if (Object.keys(cleaned).length === 0) {
      return { ok: false, error: "Aucune donnée reconnue dans ce fichier." };
    }
    return { ok: true, data: cleaned, counts };
  };

  // Restauration en deux temps : (1) lecture, contrôle d'intégrité et validation du
  // fichier puis AFFICHAGE d'un aperçu des différences ; (2) seulement après
  // confirmation explicite, création d'un point de restauration de l'état actuel
  // puis application des données.
  const [restorePreview, setRestorePreview] = useState(null);
  // Message d'état visible dans la page (en plus de l'avis passager), pour qu'un import
  // qui échoue ne reste jamais sans réponse à l'écran, notamment sur téléphone.
  const [importStatus, setImportStatus] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [rpRefresh, setRpRefresh] = useState(0);
  const startRestore = (parsed, sourceLabel) => {
    const verdict = bkVerify(parsed);
    const result = validateImportData(parsed);
    if (!result.ok) {
      showToast(`Import refusé : ${result.error}`);
      setImportStatus({ kind: "error", text: `Import refusé : ${result.error}` });
      return;
    }
    const meta = verdict.meta;
    const warnings = [];
    let blocked = false;
    if (verdict.status === "corrupt") {
      blocked = true;
      warnings.push({ level: "error", text: "Ce fichier a été modifié ou est incomplet (son contrôle d'intégrité ne correspond pas). Il ne peut pas être restauré. Téléchargez à nouveau la sauvegarde d'origine." });
    } else if (verdict.status === "legacy") {
      warnings.push({ level: "warn", text: "Ce fichier vient d'une ancienne version : il n'a pas de contrôle d'intégrité. Vérifiez bien le tableau ci-dessous avant de continuer." });
    }
    const fileCompanyName = (parsed.settings && parsed.settings.companyName) || (meta && meta.companyName) || "";
    const curCompanyName = settings.companyName || "";
    const curId = companyId || myCompanyId || null;
    if (meta && meta.companyId && curId && meta.companyId !== curId) {
      warnings.push({ level: "warn", text: "Ce fichier a été créé pour une AUTRE entreprise (identifiant différent). Le restaurer ici remplacerait les données de cette entreprise par celles de l'autre." });
    } else if (fileCompanyName && curCompanyName && fileCompanyName.trim().toLowerCase() !== curCompanyName.trim().toLowerCase()) {
      warnings.push({ level: "warn", text: `Le nom de l'entreprise dans le fichier (« ${fileCompanyName} ») est différent de l'entreprise actuelle (« ${curCompanyName} »).` });
    }
    if (meta && meta.exportedAt) {
      const days = Math.floor((Date.now() - new Date(meta.exportedAt).getTime()) / 86400000);
      if (days > 30) warnings.push({ level: "warn", text: `Cette sauvegarde date d'il y a ${days} jours : tout ce qui a été saisi depuis sera perdu s'il n'est pas dans le fichier.` });
    }
    if (meta && meta.appVersion && String(meta.appVersion) > String(APP_VERSION)) {
      warnings.push({ level: "warn", text: `Ce fichier vient d'une version plus récente de l'application (${meta.appVersion}). Rechargez la page pour avoir la dernière version avant de restaurer.` });
    }
    const rows = bkDiff(buildExportData(), result.data);
    const untouched = Object.keys(BK_LABELS).filter((k) => !(k in result.data)).map((k) => BK_LABELS[k]);
    setImportStatus(null);
    setRestorePreview({
      sourceLabel, meta, status: verdict.status, blocked, warnings, rows, untouched,
      fileCompanyName, curCompanyName,
      balance: result.data.entries ? bkBalance(result.data.entries) : null,
      data: result.data,
    });
  };
  const applyRestoredData = (data) => {
    if (data.accounts) setAccounts(data.accounts);
    if (data.entries) setEntries(data.entries);
    if (data.products) setProducts(data.products);
    if (data.productImages) setProductImages(data.productImages);
    if (data.invoices) setInvoices(data.invoices);
    if (data.suppliers) setSuppliers(data.suppliers);
    if (data.purchases) setPurchases(data.purchases);
    if (data.movements) setMovements(data.movements);
    if (data.clients) setClients(data.clients);
    if (data.settings) {
      // Réglage de sécurité propre à l'entreprise qui restaure : un fichier venant d'une autre
      // entreprise ne doit jamais imposer (ni retirer) la double authentification ici.
      setSettings({ ...data.settings, requireAdminMfa: !!(settings && settings.requireAdminMfa) });
      setCompanyName(data.settings.companyName || "");
      setCompanyAddress(data.settings.companyAddress || "");
      setCompanyPhone(data.settings.companyPhone || "");
      setCompanyEmail(data.settings.companyEmail || "");
      setCompanyNIF(data.settings.companyNIF || "");
      setInvoicePrefixIn(data.settings.invoicePrefix || "");
      setClientAddressOnInvoice(data.settings.clientAddressOnInvoice !== false);
      setTcaFranchise(!!data.settings.tcaFranchise);
      setCompanyVille(data.settings.companyVille || "");
      setCompanySecteurCode(data.settings.companySecteurCode || "");
      setCompanySecteurNom(data.settings.companySecteurNom || "");
      setCompanyType(data.settings.companyType || "");
      setCompanyLogo(data.settings.companyLogo || null);
    }
    if (data.users) setUsers(data.users);
    if (data.employees) setEmployees(data.employees);
    if (data.salesStations) setSalesStations(data.salesStations);
    if (data.assets) setAssets(data.assets);
    if (data.accruals) setAccruals(data.accruals);
    if (data.deferrals) setDeferrals(data.deferrals);
    if (data.riskProvisions) setRiskProvisions(data.riskProvisions);
    if (data.loans) setLoans(data.loans);
    if (data.entryTemplates) setEntryTemplates(data.entryTemplates);
    if (data.pendingApprovals) setPendingApprovals(data.pendingApprovals);
    if (data.cheques) setCheques(data.cheques);
    if (data.bizdocs) setBizdocs(data.bizdocs);
    if (data.ecole && typeof setEcole === "function") setEcole(data.ecole);
    if (data.impex && typeof setImpex === "function") setImpex(data.impex);
    if (data.sante && typeof setSante === "function") setSante(data.sante);
    if (data.payslips) setPayslips(data.payslips);
    if (data.salaryAdvances) setSalaryAdvances(data.salaryAdvances);
  };
  const confirmRestore = async () => {
    if (!restorePreview || restorePreview.blocked || restoring) return;
    setRestoring(true);
    try {
      const before = buildBackupNow("Avant restauration");
      const savedId = await rpSave(companyId || myCompanyId, before, "Avant restauration", true);
      if (!savedId) {
        // Stockage local indisponible : on garde quand même une trace, en fichier.
        bkDownload(before, `avant-restauration-${settings.companyName || "erp"}-${todayStr()}.json`);
      }
      applyRestoredData(restorePreview.data);
      logAudit("Administration", "Restauration de sauvegarde", restorePreview.sourceLabel);
      setRestorePreview(null);
      setRpRefresh((n) => n + 1);
      showToast(savedId ? "Données restaurées. L'état précédent est conservé dans « Points de restauration »." : "Données restaurées. L'état précédent a été téléchargé en fichier.");
    } catch (err) {
      showToast("La restauration n'a pas pu être terminée. Vérifiez vos données puis réessayez.");
    }
    setRestoring(false);
  };
  const applyImportedJson = (rawText, sourceLabel) => {
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      showToast("Ce fichier n'est pas une sauvegarde Compta+ valide.");
      setImportStatus({ kind: "error", text: "Ce fichier n'est pas une sauvegarde Compta+ valide. Utilisez un fichier téléchargé avec « Exporter » (extension .json)." });
      return;
    }
    try {
      startRestore(parsed, sourceLabel);
    } catch (err) {
      showToast("Ce fichier n'a pas pu être analysé. Réessayez avec « Coller le texte à la place ».");
      setImportStatus({ kind: "error", text: "Ce fichier n'a pas pu être analysé. Essayez « Coller le texte à la place », ou refaites une sauvegarde avec « Exporter »." });
    }
  };

  const importData = async (e) => {
    const input = e.target;
    const file = input.files && input.files[0];
    if (!file) {
      setImportStatus({ kind: "error", text: "Aucun fichier n'a été reçu. Choisissez à nouveau le fichier, ou utilisez « Coller le texte à la place »." });
      return;
    }
    // Retour immédiat à l'écran : l'utilisateur voit que le fichier est bien arrivé.
    setImportStatus({ kind: "info", text: `Fichier reçu : « ${file.name} » (${Math.max(1, Math.round(file.size / 1024))} Ko). Lecture en cours…` });
    const readFile = () => new Promise((resolve, reject) => {
      // Sans ce gestionnaire d'erreur, une lecture qui échoue (permission refusée sur
      // l'URI renvoyée par le sélecteur de fichiers Android, fichier corrompu…) ne
      // montrait rien. On essaie d'abord la lecture moderne, puis l'ancienne.
      const viaReader = () => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error("lecture"));
        reader.onload = (evt) => resolve(String(evt.target.result || ""));
        try { reader.readAsText(file); } catch (err) { reject(err); }
      };
      if (typeof file.text === "function") {
        file.text().then(resolve, viaReader);
      } else {
        viaReader();
      }
    });
    try {
      const text = await readFile();
      input.value = "";
      if (!text || !text.trim()) {
        showToast(`Le fichier « ${file.name} » est vide ou illisible.`);
        setImportStatus({ kind: "error", text: `Le fichier « ${file.name} » est vide ou illisible. Refaites une sauvegarde avec « Exporter », ou utilisez « Coller le texte à la place ».` });
        return;
      }
      applyImportedJson(text, file.name);
    } catch (err) {
      try { input.value = ""; } catch (e2) { /* sélecteur déjà libéré */ }
      showToast(`Impossible de lire le fichier « ${file.name} ». Vérifiez-le, puis réessayez.`);
      setImportStatus({ kind: "error", text: `Impossible de lire le fichier « ${file.name} ». Sur téléphone, copiez-le d'abord dans le dossier Téléchargements, ou utilisez « Coller le texte à la place ».` });
    }
  };
  const [pastedJson, setPastedJson] = useState("");
  const [showPasteImport, setShowPasteImport] = useState(false);

  // Applique la réinitialisation choisie (les confirmations sont faites dans PartialResetPanel).
  const applyReset = (sel, opts) => {
    // Filet de sécurité : copie complète de l'état AVANT toute suppression.
    try { rpSave(companyId || myCompanyId, buildBackupNow("Avant réinitialisation"), "Avant réinitialisation", true).then(() => setRpRefresh((n) => n + 1)); } catch (e) { /* sans stockage local : la réinitialisation se fait quand même */ }
    if (sel.compta) {
      setEntries([]); setInvoices([]); setPurchases([]); setCheques([]); setBizdocs([]); if (typeof setEcole === "function") setEcole([]); if (typeof setImpex === "function") setImpex([]); if (typeof setSante === "function") setSante([]);
      setPayslips([]); setSalaryAdvances([]);
      setAssets([]); setAccruals([]); setDeferrals([]); setRiskProvisions([]); setLoans([]);
    }
    if (sel.movements) setMovements([]);
    if (sel.templates) { setEntryTemplates([]); setPendingApprovals([]); }
    if (sel.products) { setProducts(DEFAULT_PRODUCTS); setProductImages({}); }
    else if (opts && opts.zeroStock) setProducts((prev) => prev.map((p) => (p.type === "marchandise" ? { ...p, stock: 0 } : p)));
    if (sel.clients) setClients(DEFAULT_CLIENTS);
    if (sel.suppliers) setSuppliers(DEFAULT_SUPPLIERS);
    if (sel.employees) setEmployees([]);
    if (sel.stations) setSalesStations([]);
    if (sel.accounts) setAccounts(DEFAULT_ACCOUNTS);
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module 8</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Administration et paramètres</div>
      </header>

      {restorePreview && (
        <RestorePreviewModal preview={restorePreview} busy={restoring} onCancel={() => setRestorePreview(null)} onConfirm={confirmRestore} />
      )}

      <GroupedTabNav
        tab={tab}
        setTab={setTab}
        groups={[
          { label: "Entreprise", color: { bg: "#152238", text: "#fff", light: "#E8EAF0", lightText: "#152238" }, tabs: [["entreprise", "Entreprise"], ["ouverture", "Solde d'ouverture"], ...(planTier === "assisted" && !(settings && settings.accountingOnly === true) ? [["postes", "Postes de vente"]] : [])] },
          { label: "Accès", color: { bg: "#A6432F", text: "#fff", light: "#F7E9E3", lightText: "#A6432F" }, tabs: [["utilisateurs", "Utilisateurs"], ["espace", "Espace de travail"], ["abonnement", "Abonnement et factures"]] },
          { label: "Données & Suivi", color: { bg: "#0F6B5C", text: "#fff", light: "#A8D4C4", lightText: "#0F6B5C" }, tabs: [["donnees", "Données"], ["historique", "Historique"], ...(planTier === "assisted" ? [["approbations", `Approbations${(pendingApprovals || []).length ? ` (${(pendingApprovals || []).length})` : ""}`]] : [])] },
        ]}
      />

      {tab === "entreprise" && (
        <div className="space-y-6 max-w-md">
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="mb-4">
              <label className="text-xs" style={{ color: "#8A8370" }}>Nom de l'entreprise</label>
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div className="mb-4">
              <label className="text-xs" style={{ color: "#8A8370" }}>Adresse (apparaît sur les factures et rapports imprimés)</label>
              <input value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} placeholder="Rue, ville, pays"
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Téléphone</label>
                <input value={companyPhone} onChange={(e) => setCompanyPhone(e.target.value)}
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
              </div>
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Email</label>
                <input value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)}
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
              </div>
            </div>
            <div className="mb-4 p-3 rounded" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }}>
              <label className="flex items-start gap-2 text-sm" style={{ color: "#152238" }}>
                <input type="checkbox" className="mt-1" checked={tcaFranchise} onChange={(e) => setTcaFranchise(e.target.checked)} data-testid="tca-franchise" />
                <span>Entreprise en franchise de TCA (chiffre d'affaires inférieur à 10 millions de HTG)
                  <span className="block text-xs" style={{ color: "#8A8370" }}>La TCA n'est alors pas facturée et la facture porte la mention « TCA non applicable - article 193 du CGI ». La TCA payée sur vos achats n'est pas récupérable (article 193 du Code fiscal). Attention : facturer la TCA à tort vous en rend redevable. Faites confirmer par votre expert-comptable que vous êtes bien en dessous du seuil avant d'activer.</span>
                </span>
              </label>
            </div>
            <div className="mb-4">
              <label className="flex items-start gap-2 text-sm cursor-pointer" style={{ color: "#152238" }}>
                <input type="checkbox" checked={clientAddressOnInvoice} onChange={(e) => setClientAddressOnInvoice(e.target.checked)} className="mt-1" data-testid="admin-adresse-client-facture" />
                <span>Afficher l'adresse du client sur la facture
                  <span className="block text-xs" style={{ color: "#8A8370" }}>Décochez si vos clients ne souhaitent pas donner leur adresse : le champ disparaît de la caisse et l'adresse n'est plus imprimée (facture, aperçu, PDF, ticket). Le Code fiscal la prévoit : à décider avec votre expert-comptable.</span>
                </span>
              </label>
            </div>
            <div className="mb-4">
              <label className="text-xs" style={{ color: "#8A8370" }}>Préfixe de la série des factures (facultatif, « F » par défaut)</label>
              <input value={invoicePrefixIn} onChange={(e) => setInvoicePrefixIn(e.target.value)} placeholder="F" maxLength={8} data-testid="admin-prefixe-facture"
                className="block w-32 border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
              <div className="text-xs mt-1" style={{ color: "#A39C87" }}>Exemple : « FA- » donne FA-0001, FA-0002… Le compteur continue sans trou ni doublon ; seul le début du numéro change, pour les nouvelles factures.</div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>NIF (Numéro d'Identification Fiscale)</label>
                <input value={companyNIF} onChange={(e) => setCompanyNIF(e.target.value)} placeholder="Requis pour la déclaration TCA"
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
              </div>
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Ville</label>
                <input value={companyVille} onChange={(e) => setCompanyVille(e.target.value)}
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
              </div>
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Type d'entreprise</label>
                <input value={companyType} onChange={(e) => setCompanyType(e.target.value)} placeholder="Ex. Salon de coiffure, Lave-auto, Dépôt de gros"
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
              </div>
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Code secteur d'activité</label>
                <input value={companySecteurCode} onChange={(e) => setCompanySecteurCode(e.target.value)}
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
              </div>
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Nom du secteur d'activité</label>
                <input value={companySecteurNom} onChange={(e) => setCompanySecteurNom(e.target.value)}
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
              </div>
            </div>
            <div className="mb-4">
              <label className="text-xs" style={{ color: "#8A8370" }}>Devise</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                {Object.entries(CURRENCIES).map(([code, c]) => (
                  <option key={code} value={code}>{c.label}</option>
                ))}
              </select>
              <p className="text-xs mt-1" style={{ color: "#A39C87" }}>
                S'applique à tous les montants affichés dans l'application. Pour le régime TCA (Haïti), la Gourde (HTG) est généralement la devise attendue.
              </p>
            </div>
            <button onClick={saveCompany} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238" }}>
              Enregistrer
            </button>
          </div>

          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Logo de l'entreprise</div>
            <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
              Facultatif — s'il est renseigné, apparaît en en-tête des factures, du Compte de résultat, du Bilan et des autres documents PDF générés par l'application.
            </p>
            <div className="flex items-center gap-4">
              {companyLogo ? (
                <img src={companyLogo} alt="Logo" className="w-16 h-16 object-contain rounded border" style={{ borderColor: "#DDD6C4" }} />
              ) : (
                <div className="w-16 h-16 rounded border flex items-center justify-center text-xs" style={{ borderColor: "#DDD6C4", color: "#A39C87" }}>Aucun</div>
              )}
              <div>
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => handleLogoUpload(e.target.files?.[0])} />
                <button onClick={() => logoInputRef.current?.click()} disabled={logoUploading}
                  className="px-3 py-1.5 rounded text-xs text-white mr-2" style={{ background: "#152238" }}>
                  {logoUploading ? "Traitement…" : companyLogo ? "Changer le logo" : "Téléverser un logo"}
                </button>
                {companyLogo && (
                  <button onClick={removeLogo} className="px-3 py-1.5 rounded text-xs" style={{ border: "1px solid #A6432F", color: "#A6432F" }}>
                    Retirer
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Format d'impression des factures</div>
            <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
              Selon le matériel utilisé au point de vente. S'applique au bouton "Imprimer" et au PDF téléchargé des factures — les autres documents (rapports, bilan…) restent toujours au format A4.
            </p>
            <select value={settings.receiptFormat || "a4"} onChange={(e) => setSettings({ ...settings, receiptFormat: e.target.value })}
              className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }}>
              <option value="a4">Feuille A4 (imprimante de bureau)</option>
              <option value="ticket80">Ticket 80 mm (mini-imprimante)</option>
              <option value="ticket58">Ticket 58 mm (mini-imprimante)</option>
            </select>
          </div>

          <BluetoothPrinterCard showToast={showToast} settings={settings} />

          <StockMethodPanel settings={settings} setSettings={setSettings} accounts={accounts} entries={entries} setEntries={setEntries} products={products} isPrimaryAdmin={isPrimaryAdmin} showToast={showToast} logAudit={logAudit} />

          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Note de bas de facture</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>
              Facultatif — affichée sous le total, sur chaque facture imprimée ou téléchargée (tous formats). Par exemple des conditions de garantie, une mention légale, ou un mot de remerciement personnalisé.
            </p>
            <textarea value={settings.invoiceFooterNote || ""} onChange={(e) => setSettings({ ...settings, invoiceFooterNote: e.target.value })}
              rows={2} placeholder="Ex. : Marchandise vendue non reprise, non échangée."
              className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }} />
          </div>

          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Système de taxation</div>
            <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
              Choisissez le régime applicable aux ventes du Module 3. Le taux par défaut s'applique aux nouveaux articles du catalogue (modifiable par article).
            </p>

            <div className="mb-4">
              <label className="text-xs" style={{ color: "#8A8370" }}>Régime fiscal</label>
              <select
                value={taxForm.taxSystem}
                onChange={(e) => {
                  const sys = e.target.value;
                  setTaxForm({ ...taxForm, taxSystem: sys, taxRate: TAX_SYSTEMS[sys].defaultRate });
                  if (sys === "tca" && currency === "EUR") setCurrency("HTG");
                  if (sys === "iva" && currency === "EUR") setCurrency("MXN");
                }}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="iva">IVA — Impuesto al Valor Agregado (Mexique, déductible sur achats)</option>
                <option value="tca">TCA — Taxe sur le Chiffre d'Affaires (Haïti, 10 %, non déductible)</option>
                <option value="aucune">Aucune taxe</option>
              </select>
              <p className="text-xs mt-1" style={{ color: "#A39C87" }}>{TAX_SYSTEMS[taxForm.taxSystem]?.description}</p>
            </div>

            {taxForm.taxSystem !== "aucune" && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="text-xs" style={{ color: "#8A8370" }}>Taux par défaut (%)</label>
                    <input type="number" value={taxForm.taxRate} onChange={(e) => setTaxForm({ ...taxForm, taxRate: e.target.value })}
                      className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
                  </div>
                  <div>
                    <label className="text-xs" style={{ color: "#8A8370" }}>Compte de taxe collectée</label>
                    <select value={taxForm.taxAccount} onChange={(e) => setTaxForm({ ...taxForm, taxAccount: e.target.value })}
                      className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                      {accounts.filter((a) => a.type === "Passif").map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                    </select>
                  </div>
                </div>
                {taxForm.taxSystem === "iva" && (
                  <label className="flex items-center gap-2 text-xs mb-4" style={{ color: "#8A8370" }}>
                    <input type="checkbox" checked={taxForm.taxDeductibleOnPurchases}
                      onChange={(e) => setTaxForm({ ...taxForm, taxDeductibleOnPurchases: e.target.checked })} />
                    IVA déductible sur les achats (mécanisme de crédit de taxe)
                  </label>
                )}
              </>
            )}

            <button onClick={saveTax} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238" }}>
              Enregistrer le régime fiscal
            </button>
          </div>

          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Clôture d'exercice / période verrouillée</div>
            <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
              Toute date antérieure ou égale à la date de clôture devient définitivement verrouillée : plus aucune écriture, facture, achat ou opération de caisse/banque ne peut y être créée, modifiée ou annulée — par personne, y compris un administrateur, tant que la clôture n'est pas repoussée manuellement ici.
            </p>
            <div className="mb-4">
              <label className="text-xs" style={{ color: "#8A8370" }}>Clôturer jusqu'au (inclus)</label>
              <input type="date" value={lockDate} onChange={(e) => setLockDate(e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            {settings.lockDate && (
              <p className="text-xs mb-4" style={{ color: "#0F6B5C" }}>
                Période actuellement clôturée jusqu'au {settings.lockDate} inclus.
              </p>
            )}
            <div className="flex gap-2">
              <button onClick={saveLockDate} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238" }}>
                Enregistrer la clôture
              </button>
              {settings.lockDate && (
                <button onClick={() => { setLockDate(""); }} className="px-4 py-2 rounded text-sm" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>
                  Retirer la date (avant enregistrement)
                </button>
              )}
            </div>
          </div>
          {secteurs && secteurs.ok && (
            <SecteursCard companyId={secteurs.companyId} info={secteurs} droits={secteursDroits(secteurs, { planTier, groupId, planStatus })} showToast={showToast} onChanged={onSecteursChanged} currentUserEmail={currentUserEmail} />
          )}
        </div>
      )}

      {tab === "ouverture" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="text-sm font-semibold mb-1" style={{ color: "#152238" }}>Solde d'ouverture</div>
          <p className="text-xs mb-5" style={{ color: "#8A8370" }}>
            Pour intégrer une entreprise déjà en activité : indiquez où vous en êtes réellement à la date de bascule (trésorerie, stock, créances clients, dettes fournisseurs). Inutile de reconstituer l'historique détaillé — seul le point de départ compte, tout ce qui suit sera suivi normalement dans l'app.
            Pour le stock déjà en rayon, renseignez sa valeur totale ci-dessous <b>et</b> la quantité de chaque article dans <b>Catalogue → Stock initial</b> — les deux sont nécessaires : l'un pour les comptes, l'autre pour le suivi des quantités.
          </p>

          <div className="mb-6">
            <label className="text-xs" style={{ color: "#8A8370" }}>Date de bascule</label>
            <input type="date" value={migDate} max={todayStr()} onChange={(e) => setMigDate(e.target.value)}
              className="block w-full sm:w-48 border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
          </div>

          <div className="mb-6 p-4 rounded" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }}>
            <div className="text-xs font-semibold mb-3" style={{ color: "#152238" }}>Trésorerie déjà en caisse/banque</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>En caisse aujourd'hui</label>
                <input type="number" min="0" value={migCaisse} onChange={(e) => setMigCaisse(e.target.value)} placeholder="0"
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
              </div>
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>En banque aujourd'hui</label>
                <input type="number" min="0" value={migBanque} onChange={(e) => setMigBanque(e.target.value)} placeholder="0"
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
              </div>
            </div>
          </div>

          <div className="mb-6 p-4 rounded" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }}>
            <div className="text-xs font-semibold mb-1" style={{ color: "#152238" }}>Stock déjà en rayon (valeur d'achat)</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>
              La <b>quantité</b> de chaque article se saisit séparément, produit par produit, dans <b>Catalogue → Stock initial</b>. Ce champ-ci ne concerne que la <b>valeur totale</b> (prix d'achat) de ce stock existant, pour qu'elle apparaisse correctement dans les comptes dès le départ.
            </p>
            <input type="number" min="0" value={migStock} onChange={(e) => setMigStock(e.target.value)} placeholder="0"
              className="w-full sm:w-64 border rounded px-2 py-1.5 text-sm tabular" style={{ borderColor: "#DDD6C4" }} />
          </div>

          <div className="mb-6 p-4 rounded" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }}>
            <div className="text-xs font-semibold mb-3" style={{ color: "#152238" }}>Créances clients (ventes à crédit déjà faites, non réglées)</div>
            {migClients.map((r) => (
              <div key={r.id} className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-2 items-center">
                <input value={r.name} onChange={(e) => updateMigRow(setMigClients, r.id, "name", e.target.value)} placeholder="Nom du client"
                  className="border rounded px-2 py-1.5 text-sm sm:col-span-2" style={{ borderColor: "#DDD6C4" }} />
                <input type="number" min="0" value={r.amount} onChange={(e) => updateMigRow(setMigClients, r.id, "amount", e.target.value)} placeholder="Montant dû"
                  className="border rounded px-2 py-1.5 text-sm tabular" style={{ borderColor: "#DDD6C4" }} />
                <div className="flex gap-1">
                  <input value={r.note} onChange={(e) => updateMigRow(setMigClients, r.id, "note", e.target.value)} placeholder="Motif (optionnel)"
                    className="border rounded px-2 py-1.5 text-sm flex-1" style={{ borderColor: "#DDD6C4" }} />
                  {migClients.length > 1 && (
                    <button onClick={() => removeMigRow(setMigClients, r.id)} className="px-2 text-xs" style={{ color: "#A6432F" }}>✕</button>
                  )}
                </div>
              </div>
            ))}
            <button onClick={() => addMigRow(setMigClients)} className="text-xs underline mt-1" style={{ color: "#152238" }}>+ Ajouter un client</button>
          </div>

          <div className="mb-6 p-4 rounded" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }}>
            <div className="text-xs font-semibold mb-3" style={{ color: "#152238" }}>Dettes fournisseurs (achats à crédit déjà faits, non réglés)</div>
            {migSuppliers.map((r) => (
              <div key={r.id} className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-2 items-center">
                <input value={r.name} onChange={(e) => updateMigRow(setMigSuppliers, r.id, "name", e.target.value)} placeholder="Nom du fournisseur"
                  className="border rounded px-2 py-1.5 text-sm sm:col-span-2" style={{ borderColor: "#DDD6C4" }} />
                <input type="number" min="0" value={r.amount} onChange={(e) => updateMigRow(setMigSuppliers, r.id, "amount", e.target.value)} placeholder="Montant dû"
                  className="border rounded px-2 py-1.5 text-sm tabular" style={{ borderColor: "#DDD6C4" }} />
                <div className="flex gap-1">
                  <input value={r.note} onChange={(e) => updateMigRow(setMigSuppliers, r.id, "note", e.target.value)} placeholder="Motif (optionnel)"
                    className="border rounded px-2 py-1.5 text-sm flex-1" style={{ borderColor: "#DDD6C4" }} />
                  {migSuppliers.length > 1 && (
                    <button onClick={() => removeMigRow(setMigSuppliers, r.id)} className="px-2 text-xs" style={{ color: "#A6432F" }}>✕</button>
                  )}
                </div>
              </div>
            ))}
            <button onClick={() => addMigRow(setMigSuppliers)} className="text-xs underline mt-1" style={{ color: "#152238" }}>+ Ajouter un fournisseur</button>
          </div>

          <button onClick={runMigration} disabled={migRunning} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238", opacity: migRunning ? 0.6 : 1 }}>
            {migRunning ? "Génération en cours..." : "Générer les écritures d'ouverture"}
          </button>
        </div>
      )}

      {tab === "postes" && planTier === "assisted" && (
        <SalesStationsPanel salesStations={salesStations} setSalesStations={setSalesStations} showToast={showToast} logAudit={logAudit} isPrimaryAdmin={isPrimaryAdmin} />
      )}

      {tab === "abonnement" && <BillingClientPanel companyId={_membership && _membership.companyId} showToast={showToast} />}
      {tab === "espace" && (
        <div className="max-w-xl" data-testid="espace-panel">
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1", overflowWrap: "anywhere" }}>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <div className="text-sm font-semibold" style={{ color: "#152238" }}>Espace de travail comptable</div>
              <span className="text-xs px-2 py-0.5 rounded-full" data-testid="espace-status"
                style={settings.accountingOnly === true ? { background: "#E3F1E7", color: "#2F7D4F" } : { background: "#F3EFE3", color: "#8A8370" }}>
                {settings.accountingOnly === true ? "Activé" : "Désactivé"}
              </span>
            </div>
            <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
              Destiné à un cabinet, un comptable ou un comptable agréé qui tient uniquement la comptabilité de l'entreprise. Une fois activé, seuls la comptabilité, la banque, les rapports, l'administration et la gestion avancée restent affichés ; la vente, les achats, le stock, les comptes clients et les salaires sont masqués.
            </p>
            <ul className="text-xs mb-4 space-y-1" style={{ color: "#5C5742" }}>
              <li>• Aucune donnée n'est modifiée ni supprimée.</li>
              <li>• Les droits de chaque utilisateur restent inchangés.</li>
              <li>• Vous pouvez revenir à l'affichage complet à tout moment.</li>
            </ul>
            {(isPrimaryAdmin || myMemberRole === "Administrateur") ? (
              <button data-testid="espace-toggle"
                onClick={() => {
                  const on = settings.accountingOnly !== true;
                  setSettings({ ...settings, accountingOnly: on });
                  showToast(on ? "Espace comptable activé : seuls les modules de comptabilité restent affichés." : "Tous les modules sont de nouveau affichés.");
                  logAudit("Administration", on ? "Espace comptable activé" : "Espace comptable désactivé", "");
                }}
                className="text-sm px-4 py-2 rounded" style={settings.accountingOnly === true ? { border: "1px solid #DDD6C4", color: "#152238", background: "#fff" } : { background: "#152238", color: "#EFE9DD" }}>
                {settings.accountingOnly === true ? "Revenir à l'affichage complet" : "Activer l'espace comptable"}
              </button>
            ) : (
              <div className="text-xs" style={{ color: "#A39C87" }}>Seul un administrateur de l'entreprise peut modifier ce réglage.</div>
            )}
          </div>
        </div>
      )}

      {tab === "utilisateurs" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
            Invitez une personne par email : dès qu'elle se connecte avec cette adresse, elle rejoint automatiquement cette entreprise avec le rôle choisi. <b>Consultant</b> permet de consulter sans rien modifier ; <b>Expert-comptable</b> est une consultation avec exports et commentaires de révision (vous pouvez en plus l'autoriser à passer des écritures de régularisation, et retirer ce droit à tout moment) — un même cabinet peut être rattaché à plusieurs entreprises ; <b>Vendeur</b> n'a accès qu'au point de vente (POS), sans voir la comptabilité, les rapports ni l'administration ; <b>Gestionnaire</b> permet de saisir et modifier les données sur tous les modules ; <b>Administrateur</b> a en plus accès à ce module.{ecoleLabels && <> <i>Dans l'espace {String(ecoleLabels).startsWith("s_") ? "Santé" : "Éducation"} : <b>{roleLabel("Vendeur", ecoleLabels)}</b> = le rôle Vendeur (encaissements, inscrits et relances seulement), <b>{roleLabel("Éditeur", ecoleLabels)}</b> = le rôle Gestionnaire, <b>{roleLabel("Lecture seule", ecoleLabels)}</b> = le rôle Consultant (consultation sans rien modifier).</i></>}
            {(planTier === "assisted" || !!groupId) && <> L'<b>Assistant de contrôle</b> n'est pas un rôle : il s'active automatiquement avec le forfait Assisté ou Extension et surveille les erreurs et données sensibles pour tous les utilisateurs autorisés.</>}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5 items-end">
            <div className="sm:col-span-2">
              <label className="text-xs" style={{ color: "#8A8370" }}>Email</label>
              <input value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                placeholder="collegue@email.com"
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Rôle</label>
              <select
                value={newUser.accountant ? "Expert-comptable" : newUser.role}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "Expert-comptable") setNewUser({ ...newUser, role: "Lecture seule", assistedSupervisor: false, accountant: true });
                  else if (v === "Superviseur assisté") setNewUser({ ...newUser, role: "Administrateur", assistedSupervisor: true, accountant: false });
                  else setNewUser({ ...newUser, role: v, assistedSupervisor: false, accountant: false });
                }}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="Administrateur">Administrateur</option>
                <option value="Éditeur">{roleOptionLabel("Éditeur")}</option>
                <option value="Vendeur">{roleOptionLabel("Vendeur")}</option>
                <option value="Lecture seule">{roleOptionLabel("Lecture seule")}</option>
                <option value="Expert-comptable">Expert-comptable</option>
              </select>
            </div>
            <button onClick={addUser} className="flex items-center justify-center gap-2 px-4 py-2 rounded text-sm text-white h-[38px] sm:col-span-3" style={{ background: "#152238" }}>
              <Plus size={14} /> Inviter
            </button>
          </div>

          {lastInviteLink && (
            <div className="mb-4 p-3 rounded text-xs" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }}>
              <div className="mb-2" style={{ color: "#152238" }}>
                Lien d'invitation pour <strong>{lastInviteLink.email}</strong> — envoyez-le directement (WhatsApp, SMS, email personnel). Il ne fonctionnera qu'en se connectant avec cette adresse exacte ({lastInviteLink.email}) — toute autre adresse sera refusée, même avec le lien.
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <code className="px-2 py-1.5 rounded flex-1 min-w-0 truncate" style={{ background: "#fff", border: "1px solid #DDD6C4", color: "#5C6B8C" }}>{lastInviteLink.link}</code>
                <button
                  onClick={() => { navigator.clipboard?.writeText(lastInviteLink.link); showToast("Lien copié."); }}
                  className="px-3 py-1.5 rounded text-white shrink-0" style={{ background: "#152238" }}>
                  Copier le lien
                </button>
                <button onClick={() => setLastInviteLink(null)} className="text-xs underline shrink-0" style={{ color: "#8A8370" }}>Fermer</button>
              </div>
            </div>
          )}
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-2 font-normal">Email</th>
                <th className="py-2 font-normal">Rôle</th>
                <th className="py-2 font-normal">Statut</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {membersLoading && (
                <tr><td colSpan={4} className="py-8 text-center" style={{ color: "#A39C87" }}>Chargement…</td></tr>
              )}
              {!membersLoading && members.length === 0 && (
                <tr><td colSpan={4} className="py-8 text-center" style={{ color: "#A39C87" }}>Aucun membre pour le moment.</td></tr>
              )}
              {members.map((m) => {
                const isMe = currentUserEmail && m.email && m.email.toLowerCase() === currentUserEmail.toLowerCase();
                const locked = m.is_primary_admin && !isMe;
                return (
                <tr key={m.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-2" style={{ color: "#7A7460" }}>
                    {m.email}
                    {m.is_accountant && m.adjust_ready && (
                      <label className="flex items-center gap-1.5 mt-1 text-xs cursor-pointer" style={{ color: "#5B3FA0" }} title="L'expert pourra ajouter des écritures de régularisation (jamais supprimer ni modifier). Chaque action est tracée. Retirable à tout moment.">
                        <input type="checkbox" data-testid="adjust-right" checked={!!m.can_adjust} onChange={(e) => setAdjustRight(m, e.target.checked)} />
                        Autoriser les écritures de régularisation
                      </label>
                    )}
                    {m.is_primary_admin && (
                      <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded" style={{ background: "#FBF1DC", color: "#9A7B1E" }} title="Administrateur principal — a créé cette entreprise, ne peut pas être retiré ni rétrogradé par un autre administrateur">
                        ★ principal
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    <select value={m.is_accountant ? "Expert-comptable" : m.role} onChange={(e) => changeUserRole(m, e.target.value)}
                      disabled={locked}
                      title={locked ? "Un administrateur principal ne peut pas être rétrogradé par un autre administrateur." : undefined}
                      className="border rounded px-2 py-1 text-xs" style={{ borderColor: "#DDD6C4", opacity: locked ? 0.6 : 1 }}>
                      <option value="Administrateur">Administrateur</option>
                      <option value="Éditeur">{roleOptionLabel("Éditeur")}</option>
                      <option value="Vendeur">{roleOptionLabel("Vendeur")}</option>
                      <option value="Lecture seule">{roleOptionLabel("Lecture seule")}</option>
                      <option value="Expert-comptable">Expert-comptable</option>
                    </select>
                  </td>
                  <td className="py-2">
                    <span className="text-xs px-2 py-0.5 rounded" style={{ background: m.user_id ? "#E6F1EE" : "#F7E9E3", color: m.user_id ? "#0F6B5C" : "#A6432F" }}>
                      {m.user_id ? "actif" : "invitation en attente"}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    {members.length > 1 && !locked && (
                      <button onClick={() => removeUser(m)} style={{ color: "#A6432F" }}><Trash2 size={14} /></button>
                    )}
                    {locked && (
                      <span title="Un administrateur principal ne peut pas être retiré par un autre administrateur."><Lock size={13} style={{ color: "#A39C87" }} /></span>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table></div>

          {isPrimaryAdmin && (
            <CompanySecurityPinPanel companyId={myCompanyId} showToast={showToast} logAudit={logAudit} />
          )}

          {isPrimaryAdmin && (
            <AdminMfaRequirementPanel settings={settings} setSettings={setSettings} showToast={showToast} logAudit={logAudit} />
          )}

          {isPrimaryAdmin && (
            <EmailRemindersPanel settings={settings} setSettings={setSettings} showToast={showToast} logAudit={logAudit} />
          )}

          {isPrimaryAdmin && (
            <CompanyGroupPanel companyId={myCompanyId} groupId={groupId} groupName={groupName} groupMaxCompanies={groupMaxCompanies} showToast={showToast} />
          )}
        </div>
      )}

      {tab === "donnees" && (
        <div>
          <div className="mb-4 p-3 rounded flex items-center gap-3 flex-wrap" style={{ background: exportDaysAgo === null || exportDaysAgo > 7 ? "#FBF1DC" : "#E6F1EE", border: "1px solid #EEE9DA" }}>
            <div className="text-xs" style={{ color: exportDaysAgo === null || exportDaysAgo > 7 ? "#9A7B1E" : "#0F6B5C" }}>
              {lastExportAt
                ? `Dernière sauvegarde téléchargée le ${new Date(lastExportAt).toLocaleDateString("fr-FR")} (${exportDaysAgo === 0 ? "aujourd'hui" : `il y a ${exportDaysAgo} jour${exportDaysAgo > 1 ? "s" : ""}`})`
                : "Aucune sauvegarde téléchargée pour l'instant sur cet appareil."}
              {" — "}recommandé : une fois par semaine, en plus des sauvegardes automatiques Supabase.
            </div>
          </div>

          {isPrimaryAdmin && (
            <div className="mb-4 p-4 rounded-lg flex items-center justify-between gap-3 flex-wrap" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }}>
              <div>
                <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Sauvegarde automatique hebdomadaire</div>
                <p className="text-xs" style={{ color: "#8A8370" }}>
                  {settings.autoBackupEnabled ? "Activée" : "Désactivée"} — quand activée, un export JSON se télécharge automatiquement, sans clic, dès que 7 jours se sont écoulés depuis la dernière fois, à la première ouverture de l'application par n'importe qui de l'équipe. Ne s'exécute que si quelqu'un ouvre réellement l'application cette semaine-là — ce n'est pas une tâche en arrière-plan sans personne connectée.
                </p>
              </div>
              <button
                onClick={() => setSettings({ ...settings, autoBackupEnabled: !settings.autoBackupEnabled })}
                className="px-3 py-1.5 rounded text-xs text-white shrink-0" style={{ background: settings.autoBackupEnabled ? "#A6432F" : "#0F6B5C" }}>
                {settings.autoBackupEnabled ? "Désactiver" : "Activer"}
              </button>
            </div>
          )}
        <RestorePointsPanel companyId={companyId || myCompanyId} refreshKey={rpRefresh} buildFile={buildBackupNow} onRestoreFile={startRestore} showToast={showToast} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
          <div className="bg-white rounded-lg p-5" style={{ border: "1px solid #E4DFD1" }}>
            <Download size={18} style={{ color: "#0F6B5C" }} className="mb-2" />
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Exporter les données</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Télécharge une sauvegarde complète au format JSON, avec contrôle d'intégrité.</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={exportData} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>Exporter</button>
              <button onClick={() => { if (showCopyExport) { setShowCopyExport(false); } else { openCopyExport(); } }} className="px-3 py-1.5 rounded text-xs" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>
                {showCopyExport ? "Annuler" : "Copier le texte à la place"}
              </button>
            </div>
            {showCopyExport && (
              <div className="mt-3">
                <p className="text-xs mb-2" style={{ color: "#8A8370" }}>
                  Si le téléchargement de fichier pose problème sur l'appareil qui doit recevoir cette sauvegarde : copiez ce texte, puis collez-le dans « Importer une sauvegarde → Coller le texte à la place » sur l'autre appareil.
                </p>
                <textarea ref={exportTextareaRef} readOnly value={exportText}
                  rows={4}
                  className="w-full border rounded px-2 py-1.5 text-xs font-mono mt-1" style={{ borderColor: "#DDD6C4" }} />
                <button onClick={copyExportText} className="mt-2 px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>
                  Copier ce texte
                </button>
              </div>
            )}
          </div>
          <div className="bg-white rounded-lg p-5" style={{ border: "1px solid #E4DFD1" }}>
            <Upload size={18} style={{ color: "#0F6B5C" }} className="mb-2" />
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Importer une sauvegarde</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Affiche d'abord un aperçu des différences, puis remplace les données actuelles par celles du fichier après votre confirmation.</p>
            
            <div className="flex flex-wrap gap-2">
              {/* Bouton « étiquette » : le sélecteur de fichiers s'ouvre par un vrai toucher sur le champ
                  (plus fiable sur Android et Samsung que le déclenchement par programme d'un champ caché). */}
              <label className="px-3 py-1.5 rounded text-xs text-white cursor-pointer" style={{ background: "#152238", position: "relative", display: "inline-block", overflow: "hidden" }}>
                Importer un fichier
                <input type="file" ref={fileInputRef} onChange={importData}
                  onClick={(e) => { try { e.currentTarget.value = ""; } catch (err) { /* sélecteur indisponible */ } }}
                  data-testid="backup-file"
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", fontSize: 0 }} />
              </label>
              <button onClick={() => setShowPasteImport((v) => !v)} className="px-3 py-1.5 rounded text-xs" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>
                {showPasteImport ? "Annuler" : "Coller le texte à la place"}
              </button>
            </div>
            {importStatus && (
              <div data-testid="import-status" role="status" className="mt-3 text-xs p-2 rounded" style={{ background: importStatus.kind === "error" ? "#F7E9E3" : "#E6F1EE", color: importStatus.kind === "error" ? "#A6432F" : "#0F6B5C", wordBreak: "break-word" }}>{importStatus.text}</div>
            )}
            {showPasteImport && (
              <div className="mt-3">
                <p className="text-xs mb-2" style={{ color: "#8A8370" }}>
                  Si le sélecteur de fichiers ne fonctionne pas sur votre appareil : ouvrez le fichier de sauvegarde téléchargé dans une app de fichiers/texte, copiez tout son contenu, puis collez-le ci-dessous.
                </p>
                <textarea value={pastedJson} onChange={(e) => setPastedJson(e.target.value)}
                  placeholder='{"accounts": [...], "entries": [...], ...}'
                  rows={4}
                  className="w-full border rounded px-2 py-1.5 text-xs font-mono mt-1" style={{ borderColor: "#DDD6C4" }} />
                <button
                  onClick={() => {
                    if (!pastedJson.trim()) { showToast("Collez d'abord le contenu JSON."); setImportStatus({ kind: "error", text: "Collez d'abord le contenu du fichier dans la zone ci-dessus." }); return; }
                    applyImportedJson(pastedJson, "collé manuellement");
                    setPastedJson("");
                    setShowPasteImport(false);
                  }}
                  className="mt-2 px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>
                  Importer ce texte
                </button>
              </div>
            )}
          </div>
          <PartialResetPanel
            counts={{ entries: entries.length, invoices: invoices.length, purchases: purchases.length, cheques: (cheques || []).length, bizdocs: (bizdocs || []).length + (ecole || []).length + (impex || []).length + (sante || []).length, payslips: payslips.length + salaryAdvances.length, assets: assets.length + accruals.length + deferrals.length + riskProvisions.length, movements: movements.length, templates: entryTemplates.length + pendingApprovals.length, products: products.length, clients: clients.length, suppliers: suppliers.length, employees: employees.length, stations: salesStations.length, accounts: accounts.length }}
            isPrimaryAdmin={isPrimaryAdmin} settings={settings} setSettings={setSettings}
            exportData={exportData} showToast={showToast} logAudit={logAudit}
            apply={applyReset}
          />
        </div>
        </div>
      )}

      {tab === "historique" && (
        planTier !== "assisted" ? (
          <div className="bg-white rounded-lg p-6 text-sm" style={{ border: "1px solid #E4DFD1", color: "#8A8370" }}>
            Le journal d'activité détaillé est réservé au forfait Assisté.
          </div>
        ) : (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
            <p className="text-xs" style={{ color: "#8A8370" }}>
              Historique de toutes les modifications apportées à l'application, avec l'auteur, le module concerné et l'horodatage.
            </p>
            <button
              onClick={() => {
                const header = "Date et heure,Utilisateur,Module,Action,Détail";
                const escapeCsv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
                const rows = histFiltered.map((a) => [
                  new Date(a.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" }),
                  a.user, a.module, a.action, a.details,
                ].map(escapeCsv).join(","));
                const csv = "\uFEFF" + [header, ...rows].join("\n");
                const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = `journal-activite-${todayStr()}.csv`;
                link.click();
                URL.revokeObjectURL(url);
              }}
              className="text-xs px-3 py-1.5 rounded shrink-0" style={{ background: "#152238", color: "#EFE9DD" }}>
              Exporter en CSV
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Du</label>
              <input type="date" value={histFrom} onChange={(e) => setHistFrom(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
              <input type="date" value={histTo} onChange={(e) => setHistTo(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Module</label>
              <select value={histModule} onChange={(e) => setHistModule(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }}>
                <option value="">Tous</option>
                {histModules.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Utilisateur</label>
              <select value={histUser} onChange={(e) => setHistUser(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }}>
                <option value="">Tous</option>
                {histUsers.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            {(histFrom || histTo || histModule || histUser) && (
              <button onClick={() => { setHistFrom(""); setHistTo(""); setHistModule(""); setHistUser(""); }}
                className="text-xs underline mb-1.5" style={{ color: "#8A8370" }}>
                Réinitialiser
              </button>
            )}
            <div className="tabular text-xs mb-1.5 ml-auto" style={{ color: "#152238" }}>
              {histFiltered.length} action{histFiltered.length > 1 ? "s" : ""}
            </div>
          </div>
          <div className="overflow-x-auto overflow-y-auto max-h-[65vh] border rounded" style={{ borderColor: "#EEE9DA" }}><table className="w-full text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-2 font-normal">Date et heure</th>
                <th className="py-2 font-normal">Utilisateur</th>
                <th className="py-2 font-normal">Module</th>
                <th className="py-2 font-normal">Action</th>
                <th className="py-2 font-normal">Détail</th>
              </tr>
            </thead>
            <tbody>
              {histFiltered.length === 0 && (
                <tr><td colSpan={5} className="py-8 text-center" style={{ color: "#A39C87" }}>
                  {(auditLog || []).length === 0 ? "Aucune action enregistrée pour le moment." : "Aucune action ne correspond à ces filtres."}
                </td></tr>
              )}
              {histFiltered.map((a) => {
                const isDestructive = /suppression|annulation|r[ée]initialisation/i.test(a.action || "");
                return (
                <tr key={a.id} style={{ borderBottom: "1px solid #F3EFE3", borderLeft: isDestructive ? "3px solid #A6432F" : "3px solid #0F6B5C" }}>
                  <td className="py-2 tabular whitespace-nowrap">{new Date(a.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="py-2">{a.user}</td>
                  <td className="py-2">{a.module}</td>
                  <td className="py-2" style={{ color: isDestructive ? "#A6432F" : "#0F6B5C", fontWeight: 500 }}>{a.action}</td>
                  <td className="py-2" style={{ color: "#7A7460" }}>{a.details}</td>
                </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
        )
      )}

      {tab === "approbations" && planTier === "assisted" && (() => {
        // Applique réellement les changements propres à chaque type d'opération —
        // tout était déjà calculé au moment de la demande ; seule l'application
        // attendait cette validation explicite.
        const applyApproval = (approval) => {
          const p = approval.payload;
          if (approval.type === "perte_definitive") {
            setEntries((prev) => [...prev, p.entry]);
            setInvoices((prev) => prev.map((i) => (i.id === p.invoiceId ? { ...i, status: p.updatedInvoiceStatus, writeOffAt: p.writeOffAt } : i)));
            if (p.clientId && p.covered > 0) {
              setClients((prev) => prev.map((c) => (c.id === p.clientId ? { ...c, doubtfulProvision: p.availableProvision - p.covered } : c)));
            }
          } else if (approval.type === "cloture_annuelle") {
            setEntries((prev) => [...prev, p.entry]);
            setSettings((prev) => ({ ...prev, ...p.newSettings }));
          } else if (approval.type === "reouverture_exercice") {
            setEntries((prev) => [...prev.map((x) => (x.id === p.origId ? { ...x, cancelledBy: p.entry.id } : x)), p.entry]);
            setSettings((prev) => ({ ...prev, ...p.newSettings }));
          } else if (approval.type === "affectation_resultat") {
            if (p.accountsToAdd && p.accountsToAdd.length) setAccounts((prev) => [...prev, ...p.accountsToAdd]);
            setEntries((prev) => [...prev, p.entry]);
          }
        };

        const approve = (approval) => {
          if (!window.confirm(`Approuver « ${approval.label} » ? Cette action sera appliquée immédiatement et ne peut pas être annulée facilement.`)) return;
          applyApproval(approval);
          setPendingApprovals((prev) => prev.filter((a) => a.id !== approval.id));
          logAudit("Administration", "Approbation opération à fort enjeu", `${approval.label} — approuvée par ${currentUserEmail}`);
          showToast("Opération approuvée et appliquée.");
        };
        const reject = (approval) => {
          if (!window.confirm(`Rejeter « ${approval.label} » ? Rien ne sera appliqué, la demande sera définitivement retirée.`)) return;
          setPendingApprovals((prev) => prev.filter((a) => a.id !== approval.id));
          logAudit("Administration", "Rejet opération à fort enjeu", `${approval.label} — rejetée par ${currentUserEmail}`);
          showToast("Demande rejetée.");
        };

        const typeLabels = { perte_definitive: "Perte définitive de créance", cloture_annuelle: "Clôture annuelle", reouverture_exercice: "Réouverture d'exercice", affectation_resultat: "Affectation du résultat" };

        return (
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
              Les opérations à fort enjeu (perte définitive de créance, clôture annuelle, affectation du résultat) attendent ici l'approbation explicite d'un administrateur avant de s'appliquer réellement.
            </p>
            {(pendingApprovals || []).length === 0 ? (
              <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Aucune demande en attente.</div>
            ) : (
              <div className="space-y-2">
                {pendingApprovals.map((approval) => {
                  const isSameUser = approval.requestedBy === currentUserEmail;
                  return (
                    <div key={approval.id} className="p-3 rounded" style={{ border: "1px solid #F0EDE3" }}>
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "#9A7B1E" }}>{typeLabels[approval.type] || approval.type}</div>
                          <div className="text-sm mt-0.5" style={{ color: "#152238" }}>{approval.label}</div>
                          <div className="text-xs mt-1" style={{ color: "#A39C87" }}>
                            Demandé par {approval.requestedBy} le {new Date(approval.requestedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                          </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button onClick={() => approve(approval)} className="text-xs px-3 py-1.5 rounded text-white" style={{ background: "#0F6B5C" }}>Approuver</button>
                          <button onClick={() => reject(approval)} className="text-xs px-3 py-1.5 rounded" style={{ background: "#F7E9E3", color: "#A6432F" }}>Rejeter</button>
                        </div>
                      </div>
                      {isSameUser && (
                        <div className="text-xs mt-2 px-2 py-1 rounded" style={{ background: "#FBF1DC", color: "#9A7B1E" }}>
                          Vous êtes vous-même à l'origine de cette demande — idéalement, faites-la approuver par un autre administrateur.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}


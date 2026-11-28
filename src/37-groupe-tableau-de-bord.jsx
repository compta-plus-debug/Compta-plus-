// ═══ MODULE ═══
// @module Groupe tableau de bord
// @depends SimpleGroupedBarChart, chooseCompany, computeBalances, computeKpis, fmt, friendlyError
//   genInviteToken, invokeEdgeFunction, roleLabel, supabase, unwrapVersioned, useEffect, useState
// @exports GroupDashboardModule
// ═══ FIN DE L'EN-TÊTE ═══
// --- Tableau de bord consolidé du groupe ---
// Apparence de l'espace multi-entreprises (maquette C). CSS intégré au module, limité à .compta-groupe.
const GROUPE_CSS = String.raw`/* ==========================================================================
   Compta+ — Refonte visuelle : ESPACE MULTI-ENTREPRISES (maquette C)
   Ne change que l'apparence. Règles limitées au conteneur .compta-groupe.
   Retour arrière : supprimer la ligne <link ... refonte-groupe.css>.
   ========================================================================== */
@media (min-width: 768px) {
  main .compta-groupe .grid.sm\:grid-cols-2 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
main .compta-groupe .grid.sm\:grid-cols-2 > div {
  background: #fff !important;
  border-radius: 12px !important;
  padding: 18px !important;
  box-shadow: 0 1px 3px rgba(21, 34, 56, .07);
  min-width: 0;
}
main .compta-groupe .grid.md\:grid-cols-4 > div {
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(21, 34, 56, .07);
  min-width: 0;
}
main .compta-groupe .grid.md\:grid-cols-4 .tabular { overflow-wrap: anywhere; }
main .compta-groupe table { width: 100%; border-collapse: collapse; font-size: 13px; }
main .compta-groupe table thead tr { background: #152238; }
main .compta-groupe table thead th {
  background: #152238 !important;
  color: #EFE9DD !important;
  font-size: 11px;
  letter-spacing: .04em;
  text-transform: uppercase;
  white-space: nowrap;
  padding: 10px 12px;
}
main .compta-groupe table tbody td { padding: 9px 12px; line-height: 1.4; vertical-align: middle; }
main .compta-groupe table tbody tr:nth-child(even) { background: #FAF8F1; }
main .compta-groupe table tbody tr { border-bottom: 1px solid #EEF1F5; }
main .compta-groupe .overflow-x-auto { border: 1px solid rgba(31, 169, 122, .45); border-radius: 12px; background: #fff; padding: 4px 12px; }
/* Hybride (maquette retenue) — fond gris clair, onglets en pastilles, cartes à bordure fine */
main .compta-groupe { background: #F3F5F8; min-height: 100vh; }
/* Pleine largeur : l'espace groupe occupe tout l'écran, sans le fond vert de l'application */
body:has(.compta-groupe), main:has(.compta-groupe) { background: #F3F5F8 !important; }
main:has(.compta-groupe) { max-width: none !important; padding: 0 !important; }
main .compta-groupe, main .compta-groupe.max-w-6xl { max-width: none !important; width: 100%; }
/* Grand écran : textes et chiffres agrandis */
@media (min-width: 1280px) { main .compta-groupe { zoom: 1.15; } }
/* Chiffres des tableaux et des cartes en gras */
main .compta-groupe table td { font-weight: 600; }
main .compta-groupe [style*="ui-monospace"] { font-weight: 700; }
main .compta-groupe .grid.sm\:grid-cols-2 > div { border: 1px solid #E4E9F1; box-shadow: none; }
main .compta-groupe .gr-tabs { display: flex; gap: 6px; overflow-x: auto; margin: 0 0 18px; padding: 2px 0 6px; scrollbar-width: none; }
main .compta-groupe .gr-tabs::-webkit-scrollbar { display: none; }
main .compta-groupe .gr-tab { flex: 0 0 auto; background: #fff; border: 1px solid #DDE3EC; border-radius: 999px; padding: 8px 14px; font-size: 13px; color: #5A6B85; white-space: nowrap; cursor: pointer; }
main .compta-groupe .gr-tab[aria-selected="true"] { background: #E0B54E; border-color: #E0B54E; color: #14213A; font-weight: 600; }
main .compta-groupe .gr-titre { color: #14213A; }
/* Cartes blanches du groupe (vue d'ensemble, comparatif, collaborateurs, journal…) : bordure fine, coins arrondis, libellés sobres */
main .compta-groupe .bg-white { border: 1px solid #E4E9F1 !important; border-radius: 14px !important; box-shadow: 0 1px 2px rgba(20, 33, 58, .05); }
main .compta-groupe .bg-white > .text-xs { color: #6B7A90 !important; }
main .compta-groupe .bg-white .text-xs { color: #6B7A90; }
main .compta-groupe .display { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-weight: 600; letter-spacing: -.01em; }
main .compta-groupe .display.text-2xl { font-size: 24px; }
main .compta-groupe .bg-white.rounded-lg { padding: 16px; }
main .compta-groupe .bg-white.rounded-lg.p-6 { padding: 18px; }
main .compta-groupe .bg-white .text-xl { font-variant-numeric: tabular-nums; }
/* Fond bleu nuit (choisi dans Paramètres) : la page passe en bleu, les cartes restent blanches */
.compta-groupe.fond-bleu { background: #1F4A85; }
/* Sur le fond bleu, les textes hors cartes deviennent lisibles : bleu marine -> jaune, gris -> gris clair */
.compta-groupe.fond-bleu .gr-titre { color: #E0B54E !important; }
.compta-groupe.fond-bleu [style*="rgb(20, 33, 58)"] { color: #E0B54E !important; }
.compta-groupe.fond-bleu [style*="rgb(107, 122, 144)"], .compta-groupe.fond-bleu p, .compta-groupe.fond-bleu > div > .text-xs { color: #DCE3EE !important; }
.compta-groupe.fond-bleu .gr-carte [style*="rgb(20, 33, 58)"] { color: #EEF2F8 !important; }
.compta-groupe.fond-bleu .gr-carte [style*="rgb(107, 122, 144)"] { color: #B9C6DA !important; }
.compta-groupe.fond-bleu .gr-carte p { color: #B9C6DA !important; }
.compta-groupe.fond-bleu .gr-tab { background: transparent; border-color: #2C3D5C; color: #B9C6DA; }
.compta-groupe.fond-bleu .gr-tab[aria-selected="true"] { background: #E0B54E; border-color: #E0B54E; color: #14213A; }
/* Cartes de la maquette Hybride : bordure fine, coins 14px, fond blanc ; variante bleue en sombre */
main .compta-groupe .gr-carte { background: #fff; border: 1px solid #E4E9F1; border-radius: 14px; box-shadow: 0 1px 2px rgba(20, 33, 58, .05); }
main .compta-groupe .gr-sous { background: #F3F5F8; }
.compta-groupe.fond-bleu .gr-carte { background: #1B2B45; border-color: #2C3D5C; color: #EEF2F8; }
.compta-groupe.fond-bleu .gr-sous { background: #223553; }
.compta-groupe.fond-bleu .gr-carte [style*="rgb(20, 33, 58)"], .compta-groupe.fond-bleu .gr-carte [style*="rgb(21, 34, 56)"] { color: #EEF2F8 !important; }
.compta-groupe.fond-bleu .gr-carte [style*="rgb(107, 122, 144)"] { color: #B9C6DA !important; }
/* Variante bleue (maquette « sombre ») : cartes #1B2B45, texte clair, lignes #223553. Les couleurs en ligne sont reprises par leur valeur rgb. */
.compta-groupe.fond-bleu .bg-white { background: #1B2B45 !important; border-color: #2C3D5C !important; color: #EEF2F8; }
.compta-groupe.fond-bleu .bg-white [style*="rgb(21, 34, 56)"] { color: #EEF2F8 !important; }
.compta-groupe.fond-bleu .bg-white [style*="rgb(122, 116, 96)"], .compta-groupe.fond-bleu .bg-white [style*="rgb(163, 156, 135)"], .compta-groupe.fond-bleu .bg-white .text-xs { color: #B9C6DA !important; }
.compta-groupe.fond-bleu .bg-white [style*="rgb(250, 248, 241)"], .compta-groupe.fond-bleu [style*="rgb(250, 248, 241)"] { background: #223553 !important; }
.compta-groupe.fond-bleu .bg-white table tbody tr:nth-child(even) { background: #223553; }
.compta-groupe.fond-bleu table tbody tr { border-color: #2C3D5C !important; }
.compta-groupe.fond-bleu .bg-white table thead th { background: #14213A !important; }
`;

// Catégorie d'une action du journal (filtres Tout / Ventes / Dépenses / Accès de la maquette).
function categorieJournal(action) {
  const a = String(action || "").toLowerCase();
  if (/vente|factur|encaiss/.test(a)) return "Ventes";
  if (/d[ée]pense|achat|paiement|sortie/.test(a)) return "Dépenses";
  if (/acc[èe]s|membre|collaborat|invit|r[ôo]le/.test(a)) return "Accès";
  return "Autre";
}

function GroupDashboardModule({ groupId, groupName, groupMaxCompanies, groupPlanStatus, groupTrialEndsAt, companyId, role, showToast, onGroupRenamed, onRequestsChanged, onEnterCurrentCompany, onJumpToModule, onBackToPlatform, onSignOut }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [companiesData, setCompaniesData] = useState([]);
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [duplicateFromId, setDuplicateFromId] = useState("");
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState("entreprises");
  const [groupInvoices, setGroupInvoices] = useState([]);
  const [filtreJournal, setFiltreJournal] = useState("Tout");
  // Fond d'affichage (bleu ou blanc) : mémorisé sur cet appareil uniquement.
  const [fondBleu, setFondBleu] = useState(() => { try { return localStorage.getItem("compta_groupe_fond") === "bleu"; } catch (e) { return false; } });
  const choisirFond = (bleu) => { setFondBleu(bleu); try { localStorage.setItem("compta_groupe_fond", bleu ? "bleu" : "blanc"); } catch (e) {} };
  const [joinRequests, setJoinRequests] = useState([]);
  const [respondingRequestId, setRespondingRequestId] = useState(null);
  const [editGroupName, setEditGroupName] = useState(groupName || "");
  const [savingName, setSavingName] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [groupMembers, setGroupMembers] = useState([]);
  const [showAddCollab, setShowAddCollab] = useState(false);
  const [newCollabEmail, setNewCollabEmail] = useState("");
  const [newCollabRole, setNewCollabRole] = useState("Éditeur");
  const [newCollabCompanies, setNewCollabCompanies] = useState({}); // { [companyId]: bool }
  const [savingCollab, setSavingCollab] = useState(false);
  const [lastInviteLinks, setLastInviteLinks] = useState([]); // [{ companyName, link }]
  const [removingMemberId, setRemovingMemberId] = useState(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferSourceId, setTransferSourceId] = useState("");
  const [transferDestId, setTransferDestId] = useState("");
  const [transferProductId, setTransferProductId] = useState("");
  const [transferQty, setTransferQty] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [transferring, setTransferring] = useState(false);

  const loadGroupData = async () => {
    setLoading(true);
    setLoadError("");
    const { data: siblings, error: sibErr } = await supabase.from("companies").select("id, name, plan_status").eq("group_id", groupId).order("created_at", { ascending: true });
    if (sibErr || !siblings) {
      setLoading(false);
      setLoadError(friendlyError(sibErr));
      return;
    }
    const results = await Promise.all(siblings.map(async (s) => {
      const { data: rows } = await supabase.from("kv_store").select("key, value").eq("company_id", s.id).in("key", ["compta-accounts", "compta-entries", "compta-settings", "compta-auditLog", "compta-products", "compta-movements", "compta-employees"]);
      const byKey = {};
      (rows || []).forEach((r) => {
        try { byKey[r.key] = unwrapVersioned(JSON.parse(r.value)).data; } catch (e) { byKey[r.key] = null; }
      });
      const accounts = byKey["compta-accounts"] || [];
      const entries = byKey["compta-entries"] || [];
      const compSettings = byKey["compta-settings"] || {};
      const auditLog = byKey["compta-auditLog"] || [];
      const products = byKey["compta-products"] || [];
      const movements = byKey["compta-movements"] || [];
      const employees = byKey["compta-employees"] || [];
      // Masse salariale : somme des salaires de base des employés actifs
      // uniquement — un employé désactivé ne compte plus dans la grille
      // salariale courante.
      const masseSalariale = employees.filter((e) => e.active !== false).reduce((sum, e) => sum + (Number(e.baseSalary) || 0), 0);
      const activeEmployeeCount = employees.filter((e) => e.active !== false).length;
      const balances = computeBalances(accounts, entries);
      const kpis = computeKpis(accounts, balances);
      // Chiffre d'affaires mois par mois (12 derniers mois) : comptes de produits, crédit moins débit.
      const maintenant = new Date();
      const cles = Array.from({ length: 12 }, (_, i) => { const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - 11 + i, 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); });
      const codesProduits = new Set(accounts.filter((a) => a.type === "Produit").map((a) => a.code));
      const serieCA = cles.map((cle) => {
        let total = 0;
        entries.forEach((e) => {
          if (!String(e.date || "").startsWith(cle)) return;
          (e.lines || []).forEach((l) => { if (codesProduits.has(l.account)) total += Number(l.credit || 0) - Number(l.debit || 0); });
        });
        return total;
      });
      return {
        id: s.id, name: s.name, planStatus: s.plan_status, kpis, serieCA,
        type: compSettings.companyType || "", secteur: compSettings.companySecteurNom || "",
        auditLog, products, movements, masseSalariale, activeEmployeeCount,
      };
    }));
    setCompaniesData(results);

    // Collaborateurs à l'échelle du groupe : une ligne par (personne, entreprise) —
    // une même personne peut légitimement apparaître pour plusieurs entreprises
    // du groupe, contrairement à l'hypothèse "une seule entreprise par email"
    // appliquée ailleurs pour un utilisateur ordinaire.
    const { data: memberRows } = await supabase.from("company_members").select("id, company_id, email, role, user_id, invite_token, created_at").in("company_id", siblings.map((s) => s.id));
    setGroupMembers(memberRows || []);

    // Factures d'abonnement des entreprises du groupe (affichées dans Finances).
    const { data: factures } = await supabase.from("billing_invoices").select("*").in("company_id", siblings.map((s) => s.id)).order("issue_date", { ascending: false }).limit(20);
    setGroupInvoices(factures || []);

    const { data: reqRows } = await supabase.from("group_join_requests").select("id, company_id, company_name, requested_by_email, status, created_at").eq("group_id", groupId).eq("status", "pending").order("created_at", { ascending: false });
    setJoinRequests(reqRows || []);

    setLoading(false);
  };

  const respondToJoinRequest = async (request, accept) => {
    setRespondingRequestId(request.id);
    const { error } = await invokeEdgeFunction("respond-join-group-request", { requestId: request.id, accept });
    setRespondingRequestId(null);
    if (error) { showToast(friendlyError(error)); return; }
    showToast(accept ? "Entreprise ajoutée au groupe." : "Demande refusée.");
    setJoinRequests((prev) => prev.filter((r) => r.id !== request.id));
    if (accept) loadGroupData();
    if (onRequestsChanged) onRequestsChanged();
  };

  useEffect(() => { loadGroupData(); }, [groupId]);

  const totals = companiesData.reduce((acc, c) => ({
    produits: acc.produits + c.kpis.produits,
    charges: acc.charges + c.kpis.charges,
    resultat: acc.resultat + c.kpis.resultat,
    tresorerie: acc.tresorerie + c.kpis.tresorerie,
    masseSalariale: acc.masseSalariale + (c.masseSalariale || 0),
    activeEmployeeCount: acc.activeEmployeeCount + (c.activeEmployeeCount || 0),
  }), { produits: 0, charges: 0, resultat: 0, tresorerie: 0, masseSalariale: 0, activeEmployeeCount: 0 });

  const serieGroupe = Array.from({ length: 12 }, (_, i) => companiesData.reduce((s, c) => s + ((c.serieCA || [])[i] || 0), 0));
  const totalGroupe12Mois = serieGroupe.reduce((s, v) => s + v, 0);

  const ouvrirEntreprise = async (c, targetModule) => {
    const isCurrent = c.id === companyId;
    if (isCurrent) {
      // Déjà l'entreprise résolue par la session : pas besoin de la re-choisir.
      if (targetModule && onJumpToModule) { onJumpToModule(targetModule); return; }
      if (onEnterCurrentCompany) { onEnterCurrentCompany(); return; }
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await chooseCompany(c.id, user.id);
    try {
      sessionStorage.setItem("compta_skip_landing", "1");
      if (targetModule) sessionStorage.setItem("compta_jump_to_module", targetModule);
    } catch (e) {}
    window.location.reload();
  };

  const renameGroup = async () => {
    const name = editGroupName.trim();
    if (!name) { showToast("Le nom du groupe ne peut pas être vide."); return; }
    setSavingName(true);
    const { error } = await supabase.from("company_groups").update({ name }).eq("id", groupId);
    setSavingName(false);
    if (error) { showToast(friendlyError(error)); return; }
    if (onGroupRenamed) onGroupRenamed(name);
    showToast("Nom du groupe mis à jour.");
  };

  // Passe par une fonction serveur dédiée — retirer une entreprise touche à
  // son abonnement (elle redémarre avec un essai neuf), jamais une simple
  // écriture directe depuis le navigateur.
  const removeCompanyFromGroup = async (co) => {
    if (!window.confirm(`Retirer « ${co.name} » du groupe ? Elle repassera au forfait Standard, en mode essai jusqu'à la date actuelle du groupe (pas un essai neuf) — ses données ne sont jamais affectées.`)) return;
    setRemovingId(co.id);
    const { error } = await invokeEdgeFunction("remove-company-from-group", { groupId, companyId: co.id });
    setRemovingId(null);
    if (error) { showToast(friendlyError(error)); return; }
    setCompaniesData((prev) => prev.filter((c) => c.id !== co.id));
    showToast(`« ${co.name} » a été retirée du groupe.`);
  };

  // Ajoute (ou met à jour) un collaborateur sur une ou plusieurs entreprises du
  // groupe en une seule fois — même logique d'invitation qu'une entreprise
  // seule (Administration → Utilisateurs), simplement répétée pour chaque
  // entreprise cochée, sans jamais toucher à la résolution de connexion.
  const addCollaboratorToGroup = async () => {
    const email = newCollabEmail.trim().toLowerCase();
    if (!email) { showToast("L'email du collaborateur est requis."); return; }
    const targetIds = Object.keys(newCollabCompanies).filter((id) => newCollabCompanies[id]);
    if (targetIds.length === 0) { showToast("Choisissez au moins une entreprise."); return; }
    // v340 — le propriétaire ne modifie pas son propre accès depuis ce formulaire.
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (currentUser && (currentUser.email || "").toLowerCase() === email) {
      showToast("Vous êtes le propriétaire du groupe : votre accès aux entreprises ne se modifie pas depuis ce formulaire.");
      return;
    }

    setSavingCollab(true);
    const links = [];
    for (const companyId of targetIds) {
      const co = companiesData.find((c) => c.id === companyId);
      const { data: existingRows } = await supabase.from("company_members").select("id, user_id, invite_token").eq("company_id", companyId).eq("email", email).limit(1);
      const existing = existingRows && existingRows[0];
      const buildLink = (token) => `${window.location.origin}${window.location.pathname}?invite=${token}`;
      if (existing) {
        const token = existing.invite_token || genInviteToken();
        await supabase.from("company_members").update({ role: newCollabRole, ...(existing.invite_token ? {} : { invite_token: token }) }).eq("id", existing.id);
        if (!existing.user_id) links.push({ companyName: co?.name || "?", link: buildLink(token) });
      } else {
        const token = genInviteToken();
        const { error } = await supabase.from("company_members").insert({ company_id: companyId, email, role: newCollabRole, invite_token: token });
        if (!error) links.push({ companyName: co?.name || "?", link: buildLink(token) });
      }
    }
    setSavingCollab(false);
    setNewCollabEmail(""); setNewCollabCompanies({}); setShowAddCollab(false);
    setLastInviteLinks(links);
    showToast(`Collaborateur ajouté à ${targetIds.length} entreprise${targetIds.length > 1 ? "s" : ""}.`);
    loadGroupData();
  };

  const removeCollaboratorFromCompany = async (member) => {
    if (!window.confirm(`Retirer ${member.email} de cette entreprise ?`)) return;
    setRemovingMemberId(member.id);
    const { error } = await supabase.from("company_members").delete().eq("id", member.id);
    setRemovingMemberId(null);
    if (error) { showToast(friendlyError(error)); return; }
    setGroupMembers((prev) => prev.filter((m) => m.id !== member.id));
    showToast(`${member.email} retiré.`);
  };

  const [showLinkExisting, setShowLinkExisting] = useState(false);
  const [myStandaloneCompanies, setMyStandaloneCompanies] = useState(null); // null = pas encore chargées
  const [selectedExistingId, setSelectedExistingId] = useState("");
  const [linkingExisting, setLinkingExisting] = useState(false);

  const loadMyStandaloneCompanies = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: memberRows } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).eq("role", "Administrateur");
    const ids = (memberRows || []).map((m) => m.company_id);
    if (ids.length === 0) { setMyStandaloneCompanies([]); return; }
    const { data: rows } = await supabase.from("companies").select("id, name").in("id", ids).is("group_id", null);
    setMyStandaloneCompanies(rows || []);
  };

  const linkExistingCompany = async () => {
    if (!selectedExistingId) { showToast("Choisissez une entreprise."); return; }
    setLinkingExisting(true);
    const { data, error } = await invokeEdgeFunction("add-existing-company-to-group", { groupId, companyId: selectedExistingId });
    setLinkingExisting(false);
    if (error) { showToast(friendlyError(error)); return; }
    showToast(`« ${data.companyName} » ajoutée au groupe.`);
    setShowLinkExisting(false); setSelectedExistingId("");
    loadGroupData();
  };

  const sourceCompanyForTransfer = companiesData.find((c) => c.id === transferSourceId);
  const availableTransferProducts = (sourceCompanyForTransfer?.products || []).filter((p) => p.type === "marchandise" && Number(p.stock || 0) > 0);

  const submitTransfer = async () => {
    const qty = Number(transferQty);
    if (!transferSourceId || !transferDestId) { showToast("Choisissez les deux entreprises."); return; }
    if (!transferProductId) { showToast("Choisissez un article."); return; }
    if (!qty || qty <= 0) { showToast("Indiquez une quantité valide."); return; }
    setTransferring(true);
    const { data, error } = await invokeEdgeFunction("transfer-stock-between-companies", {
      groupId, sourceCompanyId: transferSourceId, destCompanyId: transferDestId, sourceProductId: transferProductId, quantity: qty, note: transferNote.trim() || undefined,
    });
    setTransferring(false);
    if (error) { showToast(friendlyError(error)); return; }
    showToast(`${data.quantity} × « ${data.productName} » transféré${data.quantity > 1 ? "s" : ""} de ${data.sourceName} vers ${data.destName}.${data.createdNewProduct ? " (nouvel article créé côté destination)" : ""}`);
    setShowTransfer(false); setTransferSourceId(""); setTransferDestId(""); setTransferProductId(""); setTransferQty(""); setTransferNote("");
    loadGroupData();
  };

  const addCompanyToGroup = async () => {
    const name = newCompanyName.trim();
    if (!name) { showToast("Donnez un nom à la nouvelle entreprise."); return; }
    setCreating(true);
    const { data, error } = await invokeEdgeFunction("create-group-company", { groupId, companyName: name, duplicateFromCompanyId: duplicateFromId || undefined });
    setCreating(false);
    if (error) { showToast(friendlyError(error)); return; }
    showToast(`Entreprise créée${data.duplicated ? " (configuration dupliquée)" : ""} — ouverture...`);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await chooseCompany(data.companyId, user.id);
    try { sessionStorage.setItem("compta_skip_landing", "1"); } catch (e) {}
    window.location.reload();
  };

  const membresGroupe = Object.entries(groupMembers.reduce((acc, m) => { (acc[m.email] = acc[m.email] || []).push(m); return acc; }, {}));
  const journalComplet = companiesData
    .flatMap((c) => (c.auditLog || []).map((entry) => ({ ...entry, companyName: c.name })))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 100);
  const journalFiltre = filtreJournal === "Tout" ? journalComplet : journalComplet.filter((e) => categorieJournal(e.action) === filtreJournal);

  return (
    <div className={"p-4 md:p-8 max-w-6xl compta-groupe" + (fondBleu ? " fond-bleu" : "")}>
      <style>{GROUPE_CSS}</style>
      <div className="rounded-lg p-6 mb-6 flex items-center justify-between flex-wrap gap-3"
        style={{ background: "linear-gradient(135deg, #152238 0%, #1F3358 100%)" }}>
        <div>
          <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "#C9A24B" }}>Espace multi-entreprises</div>
          <div className="display text-2xl" style={{ color: "#fff" }}>{groupName}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs px-3 py-1.5 rounded-full" style={{ background: "rgba(201,162,75,0.18)", color: "#C9A24B" }}>
            {companiesData.length} / {groupMaxCompanies || 5} entreprises
          </span>
          {onBackToPlatform && (
            <button onClick={onBackToPlatform} className="hidden md:inline-flex text-xs px-3 py-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.12)", color: "#C9A24B" }}>
              ← Tableau de bord général
            </button>
          )}
          {onSignOut && (
            <button onClick={onSignOut} className="hidden md:inline-flex text-xs px-3 py-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.12)", color: "#EFE9DD" }}>
              Se déconnecter
            </button>
          )}
        </div>
      </div>

      <div className="gr-tabs" role="tablist">
        {[
          { id: "entreprises", label: "Entreprises" },
          { id: "finances", label: "Finances" },
          ...(role === "Administrateur" ? [{ id: "equipe", label: "Équipe" }, { id: "journal", label: "Journal" }] : []),
          { id: "parametres", label: "Paramètres" + (role === "Administrateur" && joinRequests.length > 0 ? ` (${joinRequests.length})` : "") },
        ].map((o) => (
          <button key={o.id} role="tab" aria-selected={tab === o.id} className="gr-tab"
            onClick={() => { setTab(o.id); if (o.id === "parametres") setEditGroupName(groupName || ""); }}>
            {o.label}
          </button>
        ))}
      </div>

      {tab === "parametres" && <div className="flex flex-col gap-3.5 mb-6">
        <div className="gr-carte" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#14213A" }}>Présentation</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "#6B7A90" }}>Fond de l'espace groupe : {fondBleu ? "bleu" : "blanc"}</span>
            <button onClick={() => choisirFond(!fondBleu)} style={{ background: "#14213A", color: "#fff", border: 0, borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
              {fondBleu ? "Passer en fond blanc" : "Passer en fond bleu"}
            </button>
          </div>
        </div>

        {role === "Administrateur" && <>
          <div className="gr-carte" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 12, color: "#6B7A90" }}>Nom du groupe</div>
            <input value={editGroupName} onChange={(e) => setEditGroupName(e.target.value)}
              style={{ border: "1px solid #DDE3EC", borderRadius: 8, padding: 10, fontSize: 14 }} />
            <button onClick={renameGroup} disabled={savingName || editGroupName.trim() === groupName}
              style={{ background: "#14213A", color: "#fff", border: 0, borderRadius: 8, padding: 10, fontSize: 13, alignSelf: "flex-start", opacity: (savingName || editGroupName.trim() === groupName) ? 0.5 : 1 }}>
              {savingName ? "..." : "Enregistrer"}
            </button>
          </div>

          <div className="gr-carte" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ color: "#6B7A90" }}>Abonnement</span>
              <span style={{ color: "#14213A" }}>{groupPlanStatus === "active" ? "Actif" : groupPlanStatus === "trial" ? "Période d'essai" : "Suspendu"}</span>
            </div>
            {groupTrialEndsAt && (groupPlanStatus === "trial" || groupPlanStatus === "active") && (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ color: "#6B7A90" }}>{groupPlanStatus === "trial" ? "Fin d'essai" : "Prochaine échéance"}</span>
                <span style={{ color: "#14213A" }}>{new Date(groupTrialEndsAt).toLocaleDateString("fr-FR")}</span>
              </div>
            )}
            {(() => {
              const today = new Date().toISOString().slice(0, 10);
              const dues = groupInvoices.filter((f) => f.status === "emise");
              const prochaine = dues.slice().sort((a, b) => String(a.due_date || "").localeCompare(String(b.due_date || "")))[0];
              const enRetard = dues.filter((f) => f.due_date && f.due_date < today).length;
              const dates = groupInvoices.map((f) => f.last_reminder_at).filter(Boolean).sort();
              const derniere = dates[dates.length - 1];
              const ligne = (label, value) => (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ color: "#6B7A90" }}>{label}</span>
                  <span style={{ color: "#14213A", textAlign: "right" }}>{value}</span>
                </div>
              );
              return (
                <>
                  {ligne("Prochaine facture à régler", prochaine
                    ? `${Number(prochaine.total_htg || 0).toLocaleString("fr-FR")} HTG, échéance ${prochaine.due_date ? new Date(prochaine.due_date).toLocaleDateString("fr-FR") : "non définie"}`
                    : "Aucune")}
                  {ligne("Factures en retard", enRetard)}
                  {ligne("Dernière relance", derniere ? new Date(derniere).toLocaleDateString("fr-FR") : "Aucune")}
                </>
              );
            })()}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#6B7A90" }}>Entreprises</span><span style={{ color: "#14213A" }}>{companiesData.length} / {groupMaxCompanies || 5}</span>
              </div>
              <div style={{ height: 8, background: "#E4E9F1", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, (companiesData.length / (groupMaxCompanies || 5)) * 100)}%`, height: "100%", background: "#14213A" }} />
              </div>
            </div>
          </div>

          <div className="gr-carte" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#14213A", marginBottom: 4 }}>Entreprises du groupe</div>
            {companiesData.map((c) => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "9px 0", borderTop: "1px solid #EEF1F5", fontSize: 13 }}>
                <span style={{ color: "#14213A" }}>{c.name}{c.id === companyId ? " (celle-ci)" : ""}</span>
                <button onClick={() => removeCompanyFromGroup(c)} disabled={removingId === c.id}
                  style={{ background: "none", border: 0, color: "#A6432F", textDecoration: "underline", fontSize: 12, flexShrink: 0, opacity: removingId === c.id ? 0.5 : 1 }}>
                  {removingId === c.id ? "Retrait..." : "Retirer du groupe"}
                </button>
              </div>
            ))}
            <p style={{ fontSize: 12, color: "#6B7A90", margin: "6px 0 0" }}>Une entreprise retirée repasse au forfait Standard, en mode essai jusqu'à la date actuelle du groupe (pas un essai neuf) — ses données ne sont jamais affectées.</p>
          </div>

          <div style={{ background: "#FDF2F0", border: "1px solid #F0C9C1", borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#A6432F" }}>Zone sensible</div>
            <div style={{ fontSize: 12, color: "#6B7A90" }}>Pour supprimer ce groupe, adressez-vous à l'administrateur de la plateforme : ses entreprises sont détachées et gardent leurs données.</div>
          </div>
        </>}
      </div>}

      {loadError && (
        <div className="text-xs p-3 rounded mb-4" style={{ background: "#F7E9E3", color: "#A6432F" }}>
          Impossible de charger le groupe : {loadError}
        </div>
      )}

      {loading ? (
        <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Chargement...</div>
      ) : (
        <>
          {tab === "entreprises" && <div className="flex flex-col gap-3.5 mb-6">
            <div className="gr-carte" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="flex justify-between" style={{ fontSize: 12, color: "#6B7A90" }}><span>Chiffre d'affaires consolidé</span><span>12 mois</span></div>
              <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 24, fontWeight: 600, color: "#14213A" }}>{fmt(totalGroupe12Mois)}</div>
              {(() => {
                const maxV = Math.max(1, ...serieGroupe);
                const pts = serieGroupe.map((v, i) => [(i * 354) / 11, 90 - (v / maxV) * 78]);
                const ligne = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
                const aire = ligne + " L354,90 L0,90 Z";
                const dernier = pts[pts.length - 1];
                return (
                  <svg viewBox="0 0 354 96" width="100%" height="96" style={{ maxWidth: "100%" }}>
                    <defs>
                      <linearGradient id="gr-aire-ca" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0" stopColor="#E0B54E" stopOpacity=".35" />
                        <stop offset="1" stopColor="#E0B54E" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <line x1="0" y1="90" x2="354" y2="90" stroke="#E4E9F1" />
                    <path d={aire} fill="url(#gr-aire-ca)" />
                    <path d={ligne} fill="none" stroke="#14213A" strokeWidth="2" />
                    <circle cx={dernier[0]} cy={dernier[1]} r="4" fill="#E0B54E" />
                  </svg>
                );
              })()}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
              {[
                ["Charges", fmt(totals.charges), "#A6432F"],
                ["Résultat", fmt(totals.resultat), totals.resultat >= 0 ? "#1E7A5C" : "#A6432F"],
                ["Trésorerie", fmt(totals.tresorerie), "#14213A"],
              ].map(([libelle, valeur, couleur]) => (
                <div key={libelle} className="gr-carte" style={{ padding: 10, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: "#6B7A90" }}>{libelle}</div>
                  <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, fontWeight: 600, color: couleur, marginTop: 3, overflowWrap: "anywhere" }}>{valeur}</div>
                </div>
              ))}
            </div>

            <div className="gr-titre" style={{ fontSize: 14, fontWeight: 600, color: "#14213A" }}>Entreprises du groupe</div>
            {companiesData.map((c) => {
              const isCurrent = c.id === companyId;
              const statut = c.planStatus === "active"
                ? { libelle: "Actif", fond: "#E4F3EC", texte: "#1E7A5C" }
                : c.planStatus === "trial"
                  ? { libelle: "Essai", fond: "#FFF3D6", texte: "#8A6200" }
                  : { libelle: "Suspendu", fond: "#F7E9E3", texte: "#A6432F" };
              return (
                <div key={c.id} className="gr-carte" onClick={() => ouvrirEntreprise(c)}
                  style={{ padding: 14, borderLeft: "4px solid #E0B54E", display: "flex", flexDirection: "column", gap: 10, cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: 15, fontWeight: 600, color: "#14213A" }}>{c.name}</span>
                      <span style={{ fontSize: 12, color: "#6B7A90" }}>{isCurrent ? "Celle-ci · " : ""}{c.type || "Type non renseigné"}{c.secteur ? ` · ${c.secteur}` : ""}</span>
                    </div>
                    <span style={{ fontSize: 11, background: statut.fond, color: statut.texte, borderRadius: 999, padding: "3px 8px", whiteSpace: "nowrap" }}>{statut.libelle}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, fontSize: 12 }}>
                    <div className="gr-sous" style={{ borderRadius: 8, padding: 8, minWidth: 0 }}><div style={{ color: "#6B7A90" }}>CA</div><div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, overflowWrap: "anywhere" }}>{fmt(c.kpis.produits)}</div></div>
                    <div className="gr-sous" style={{ borderRadius: 8, padding: 8, minWidth: 0 }}><div style={{ color: "#6B7A90" }}>Résultat</div><div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, overflowWrap: "anywhere", color: c.kpis.resultat >= 0 ? "#1E7A5C" : "#A6432F" }}>{fmt(c.kpis.resultat)}</div></div>
                    <div className="gr-sous" style={{ borderRadius: 8, padding: 8, minWidth: 0 }}><div style={{ color: "#6B7A90" }}>Salariés</div><div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, overflowWrap: "anywhere" }}>{c.activeEmployeeCount || 0}</div></div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={(e) => { e.stopPropagation(); ouvrirEntreprise(c); }}
                      style={{ flex: 1, background: "#14213A", color: "#fff", border: 0, borderRadius: 8, padding: 9, fontSize: 13 }}>Ouvrir</button>
                    <button onClick={(e) => { e.stopPropagation(); ouvrirEntreprise(c, "rh"); }}
                      style={{ flex: 1, background: "none", border: "1px solid #DDE3EC", borderRadius: 8, padding: 9, fontSize: 13, color: "#14213A" }}>Salaires</button>
                  </div>
                </div>
              );
            })}
            {companiesData.length === 0 && (
              <p className="text-xs" style={{ color: "#A39C87" }}>Aucune entreprise dans ce groupe pour l'instant.</p>
            )}
          </div>}

          {tab === "finances" && <div className="flex flex-col gap-3.5 mb-6">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
              {[
                ["Chiffre d'affaires consolidé", totals.produits, "#14213A"],
                ["Charges", totals.charges, "#A6432F"],
                ["Résultat", totals.resultat, totals.resultat >= 0 ? "#1E7A5C" : "#A6432F"],
                ["Trésorerie", totals.tresorerie, "#14213A"],
              ].map(([libelle, valeur, couleur]) => (
                <div key={libelle} className="gr-carte" style={{ padding: 12, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: "#6B7A90" }}>{libelle}</div>
                  <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 14, fontWeight: 600, color: couleur, marginTop: 4, overflowWrap: "anywhere" }}>{fmt(valeur)}</div>
                </div>
              ))}
            </div>

            <div className="gr-carte" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#14213A" }}>Répartition par entreprise</div>
              {companiesData.length === 0 && <p style={{ fontSize: 13, color: "#6B7A90" }}>Aucune entreprise dans ce groupe.</p>}
              {companiesData.map((c) => {
                const part = totals.produits > 0 ? Math.round((c.kpis.produits / totals.produits) * 100) : 0;
                return (
                  <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#14213A" }}>
                      <span>{c.name}</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{part} %</span>
                    </div>
                    <div style={{ height: 8, background: "#E4E9F1", borderRadius: 999, overflow: "hidden" }}>
                      <div style={{ width: `${part}%`, height: "100%", background: "#14213A" }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="gr-carte" style={{ padding: 14, display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#14213A", marginBottom: 6 }}>Factures d'abonnement</div>
              {groupInvoices.length === 0 && <p style={{ fontSize: 13, color: "#6B7A90", margin: "6px 0" }}>Aucune facture pour l'instant.</p>}
              {groupInvoices.map((f) => {
                const payee = f.status === "payee";
                return (
                  <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "10px 0", borderTop: "1px solid #EEF1F5", fontSize: 13 }}>
                    <span style={{ color: "#14213A" }}>{f.label || f.description || "Abonnement"}{f.issue_date ? " · " + new Date(f.issue_date).toLocaleDateString("fr-FR", { month: "long" }) : ""}</span>
                    <span style={{ fontSize: 11, borderRadius: 6, padding: "2px 8px", background: payee ? "#E4F3EC" : "#FFF3D6", color: payee ? "#1E7A5C" : "#8A6200" }}>{payee ? "Payée" : "En attente"}</span>
                  </div>
                );
              })}
            </div>

          {companiesData.length > 0 && (
            <div className="bg-white rounded-lg p-4 mb-6" style={{ border: "1px solid #E4DFD1" }}>
              <div className="display text-lg mb-3" style={{ color: "#152238" }}>Comparatif entre entreprises</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid #E4DFD1" }}>
                      <th className="text-left py-2 pr-2" style={{ color: "#A39C87" }}>Entreprise</th>
                      <th className="text-right py-2 px-2" style={{ color: "#A39C87" }}>CA</th>
                      <th className="text-right py-2 px-2" style={{ color: "#A39C87" }}>Charges</th>
                      <th className="text-right py-2 px-2" style={{ color: "#A39C87" }}>Résultat</th>
                      <th className="text-right py-2 px-2" style={{ color: "#A39C87" }}>Trésorerie</th>
                      <th className="text-right py-2 pl-2" style={{ color: "#A39C87" }}>Masse salariale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companiesData.map((c) => (
                      <tr key={c.id} style={{ borderBottom: "1px solid #F0EDE3", background: c.id === companyId ? "#FAF8F1" : "transparent" }}>
                        <td className="py-2 pr-2" style={{ color: "#152238", whiteSpace: "nowrap" }}>{c.name}{c.id === companyId ? " (celle-ci)" : ""}</td>
                        <td className="text-right py-2 px-2 tabular" style={{ color: "#152238", whiteSpace: "nowrap" }}>{fmt(c.kpis.produits)}</td>
                        <td className="text-right py-2 px-2 tabular" style={{ color: "#A6432F", whiteSpace: "nowrap" }}>{fmt(c.kpis.charges)}</td>
                        <td className="text-right py-2 px-2 tabular" style={{ color: c.kpis.resultat >= 0 ? "#0F6B5C" : "#A6432F", whiteSpace: "nowrap" }}>{fmt(c.kpis.resultat)}</td>
                        <td className="text-right py-2 px-2 tabular" style={{ color: "#152238", whiteSpace: "nowrap" }}>{fmt(c.kpis.tresorerie)}</td>
                        <td className="text-right py-2 pl-2 tabular" style={{ color: "#152238", whiteSpace: "nowrap" }}>{fmt(c.masseSalariale || 0)} <span style={{ color: "#A39C87" }}>({c.activeEmployeeCount || 0})</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          </div>}

          {tab === "equipe" && role === "Administrateur" && <div className="flex flex-col gap-3.5 mb-6">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#14213A" }}>Collaborateurs ({membresGroupe.length})</span>
              <button onClick={() => { setShowAddCollab((v) => !v); setNewCollabCompanies(Object.fromEntries(companiesData.map((c) => [c.id, true]))); }}
                style={{ background: "#14213A", color: "#fff", border: 0, borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>+ Inviter</button>
            </div>

            {showAddCollab && (
              <div className="gr-carte" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                <input value={newCollabEmail} onChange={(e) => setNewCollabEmail(e.target.value)} placeholder="Email du collaborateur"
                  style={{ border: "1px solid #DDE3EC", borderRadius: 8, padding: "9px 10px", fontSize: 13 }} />
                <select value={newCollabRole} onChange={(e) => setNewCollabRole(e.target.value)}
                  style={{ border: "1px solid #DDE3EC", borderRadius: 8, padding: "9px 10px", fontSize: 13 }}>
                  <option value="Administrateur">Administrateur</option><option value="Éditeur">Gestionnaire</option><option value="Lecture seule">Consultant</option><option value="Vendeur">Vendeur</option>
                </select>
                <div style={{ fontSize: 12, color: "#6B7A90" }}>Entreprises concernées :</div>
                {companiesData.map((c) => (
                  <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#14213A" }}>
                    <input type="checkbox" checked={!!newCollabCompanies[c.id]} onChange={(e) => setNewCollabCompanies((prev) => ({ ...prev, [c.id]: e.target.checked }))} />
                    {c.name}
                  </label>
                ))}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={addCollaboratorToGroup} disabled={savingCollab}
                    style={{ background: "#14213A", color: "#fff", border: 0, borderRadius: 8, padding: "9px 12px", fontSize: 13, opacity: savingCollab ? 0.5 : 1 }}>{savingCollab ? "Ajout..." : "Ajouter"}</button>
                  <button onClick={() => setShowAddCollab(false)} style={{ background: "#F3F5F8", color: "#6B7A90", border: 0, borderRadius: 8, padding: "9px 12px", fontSize: 13 }}>Annuler</button>
                </div>
              </div>
            )}

            {membresGroupe.map(([email, rows]) => (
              <div key={email} className="gr-carte" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ width: 40, height: 40, borderRadius: 999, background: "#E0B54E", color: "#14213A", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0 }}>{email.charAt(0).toUpperCase()}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#14213A", overflowWrap: "anywhere" }}>{email}</span>
                    <span style={{ fontSize: 12, color: "#6B7A90" }}>{roleLabel(rows[0].role)} · {rows.length} entreprise{rows.length > 1 ? "s" : ""}</span>
                  </div>
                </div>
                {rows.map((m) => (
                  <div key={m.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: "#6B7A90", borderTop: "1px solid #EEF1F5", paddingTop: 8 }}>
                    <span>{(companiesData.find((c) => c.id === m.company_id) || {}).name || "?"} — {roleLabel(m.role)}{!m.user_id ? " (invitation en attente)" : ""}</span>
                    <button onClick={() => removeCollaboratorFromCompany(m)} disabled={removingMemberId === m.id}
                      style={{ background: "none", border: 0, color: "#A6432F", textDecoration: "underline", fontSize: 12, flexShrink: 0 }}>Retirer</button>
                  </div>
                ))}
              </div>
            ))}
            {groupMembers.length === 0 && <p style={{ fontSize: 13, color: "#6B7A90" }}>Aucun collaborateur pour l'instant.</p>}

            {lastInviteLinks.length > 0 && (
              <div className="gr-carte" style={{ padding: 12, fontSize: 12, color: "#6B7A90", wordBreak: "break-all" }}>
                <div style={{ fontWeight: 600, color: "#14213A", marginBottom: 4 }}>Lien(s) d'invitation à partager :</div>
                {lastInviteLinks.map((l, i) => (<div key={i} style={{ marginBottom: 4 }}>{l.companyName} : {l.link}</div>))}
              </div>
            )}

            <div style={{ fontSize: 14, fontWeight: 600, color: "#14213A", marginTop: 6 }}>Demandes d'accès</div>
            <div className="gr-carte" style={{ padding: 14, fontSize: 13, color: "#6B7A90" }}>
              {joinRequests.length === 0 && <span>Aucune demande en attente.</span>}
              {joinRequests.map((r) => (
                <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid #EEF1F5" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: "#14213A" }}>{r.company_name}</div>
                    <div style={{ fontSize: 12 }}>Demandée par {r.requested_by_email}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button onClick={() => respondToJoinRequest(r, true)} disabled={respondingRequestId === r.id}
                      style={{ background: "#14213A", color: "#fff", border: 0, borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>Accepter</button>
                    <button onClick={() => respondToJoinRequest(r, false)} disabled={respondingRequestId === r.id}
                      style={{ background: "none", border: "1px solid #DDE3EC", color: "#6B7A90", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>Refuser</button>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 14, fontWeight: 600, color: "#14213A", marginTop: 6 }}>Rôles dans le groupe</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#6B7A90" }}>
              <span>Administrateur : accès complet, gestion des collaborateurs.</span>
              <span>Vendeur : ventes et factures uniquement.</span>
            </div>
          </div>}

          {tab === "journal" && role === "Administrateur" && <div className="flex flex-col gap-3.5 mb-6">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["Tout", "Ventes", "Dépenses", "Accès"].map((f) => (
                <button key={f} onClick={() => setFiltreJournal(f)}
                  style={{ padding: "6px 12px", borderRadius: 999, fontSize: 13, border: filtreJournal === f ? 0 : "1px solid #DDE3EC", background: filtreJournal === f ? "#14213A" : "#fff", color: filtreJournal === f ? "#fff" : "#14213A" }}>{f}</button>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", borderLeft: "2px solid #E4E9F1", marginLeft: 6, paddingLeft: 18, position: "relative" }}>
              {journalFiltre.map((entry, i) => {
                const categorie = categorieJournal(entry.action);
                const couleur = categorie === "Ventes" ? "#1E7A5C" : categorie === "Accès" ? "#E0B54E" : "#14213A";
                return (
                  <div key={i} style={{ position: "relative", padding: "4px 0 16px" }}>
                    <span style={{ position: "absolute", left: -25, top: 6, width: 12, height: 12, borderRadius: 999, background: couleur }} />
                    <div style={{ fontSize: 12, color: "#6B7A90" }}>{new Date(entry.date).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#14213A" }}>{entry.action}</div>
                    <div style={{ fontSize: 12, color: "#6B7A90" }}>{entry.companyName} · {entry.user}{entry.details ? ` — ${entry.details}` : ""}</div>
                  </div>
                );
              })}
            </div>
            {journalFiltre.length === 0 && <p style={{ fontSize: 13, color: "#6B7A90" }}>Aucune action pour ce filtre.</p>}
          </div>}

          {tab === "entreprises" && role === "Administrateur" && companiesData.length >= 2 && (
            <div className="bg-white rounded-lg p-4 mb-6" style={{ border: "1px solid #E4DFD1" }}>
              <div className="display text-lg mb-1" style={{ color: "#152238" }}>Transfert inter-entreprises</div>
              <p className="text-xs mb-3" style={{ color: "#A39C87" }}>Envoyez du stock d'une entreprise à une autre du groupe — la sortie et l'entrée se créent automatiquement des deux côtés, de façon tracée. Chaque entreprise garde sa comptabilité séparée.</p>

              {!showTransfer ? (
                <button onClick={() => setShowTransfer(true)} className="text-xs px-3 py-2 rounded text-white" style={{ background: "#152238" }}>+ Nouveau transfert</button>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs" style={{ color: "#8A8370" }}>Depuis</label>
                      <select value={transferSourceId} onChange={(e) => { setTransferSourceId(e.target.value); setTransferProductId(""); }}
                        className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                        <option value="">Choisir...</option>
                        {companiesData.map((c) => <option key={c.id} value={c.id} disabled={c.id === transferDestId}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs" style={{ color: "#8A8370" }}>Vers</label>
                      <select value={transferDestId} onChange={(e) => setTransferDestId(e.target.value)}
                        className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                        <option value="">Choisir...</option>
                        {companiesData.map((c) => <option key={c.id} value={c.id} disabled={c.id === transferSourceId}>{c.name}</option>)}
                      </select>
                    </div>
                  </div>

                  {transferSourceId && (
                    <div>
                      <label className="text-xs" style={{ color: "#8A8370" }}>Article</label>
                      {availableTransferProducts.length === 0 ? (
                        <p className="text-xs mt-1" style={{ color: "#A39C87" }}>Aucun article en stock disponible chez {sourceCompanyForTransfer?.name}.</p>
                      ) : (
                        <select value={transferProductId} onChange={(e) => setTransferProductId(e.target.value)}
                          className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                          <option value="">Choisir...</option>
                          {availableTransferProducts.map((p) => <option key={p.id} value={p.id}>{p.name} (stock : {p.stock})</option>)}
                        </select>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs" style={{ color: "#8A8370" }}>Quantité</label>
                      <input type="number" min="1" value={transferQty} onChange={(e) => setTransferQty(e.target.value)}
                        className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
                    </div>
                    <div>
                      <label className="text-xs" style={{ color: "#8A8370" }}>Note (facultatif)</label>
                      <input value={transferNote} onChange={(e) => setTransferNote(e.target.value)} placeholder="Ex. réassort"
                        className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
                    </div>
                  </div>

                  <div className="flex gap-2 flex-wrap pt-1">
                    <button onClick={submitTransfer} disabled={transferring} className="text-xs px-3 py-2 rounded text-white" style={{ background: "#152238", opacity: transferring ? 0.5 : 1 }}>
                      {transferring ? "Transfert..." : "Confirmer le transfert"}
                    </button>
                    <button onClick={() => setShowTransfer(false)} className="text-xs px-3 py-2 rounded" style={{ background: "#F3EFE3", color: "#7A7460" }}>Annuler</button>
                  </div>
                </div>
              )}

              {(() => {
                // Reconstitue chaque transfert à partir des mouvements de sortie et
                // d'entrée correspondants, reliés par leur identifiant commun —
                // jamais stocké séparément, toujours recalculé à l'affichage.
                const byTransferId = {};
                companiesData.forEach((c) => {
                  (c.movements || []).forEach((m) => {
                    if (!m.transferId) return;
                    byTransferId[m.transferId] = byTransferId[m.transferId] || {};
                    byTransferId[m.transferId][m.type] = { ...m, companyName: c.name };
                  });
                });
                const transfers = Object.values(byTransferId)
                  .filter((t) => t.sortie && t.entree)
                  .map((t) => ({
                    date: t.sortie.date, productName: t.sortie.productName, qty: t.sortie.qty,
                    sourceName: t.sortie.companyName, destName: t.entree.companyName,
                  }))
                  .sort((a, b) => (a.date < b.date ? 1 : -1))
                  .slice(0, 50);

                if (companiesData.length < 2) return null;
                return (
                  <div className="mt-4 pt-4" style={{ borderTop: "1px solid #EEE9DA" }}>
                    <div className="text-xs font-medium mb-2" style={{ color: "#152238" }}>Historique des transferts</div>
                    {transfers.length === 0 ? (
                      <p className="text-xs" style={{ color: "#A39C87" }}>Aucun transfert effectué pour l'instant.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-80 overflow-y-auto">
                        {transfers.map((t, i) => (
                          <div key={i} className="text-xs p-2 rounded" style={{ background: "#FAF8F1" }}>
                            <div className="flex justify-between gap-2">
                              <span style={{ color: "#152238" }}>{t.qty} × {t.productName}</span>
                              <span style={{ color: "#A39C87" }} className="shrink-0">{new Date(t.date).toLocaleDateString("fr-FR")}</span>
                            </div>
                            <div style={{ color: "#A39C87" }}>{t.sourceName} → {t.destName}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {tab === "entreprises" && role === "Administrateur" && (
            <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
              <div className="text-sm font-semibold mb-2" style={{ color: "#152238" }}>Ajouter une entreprise au groupe</div>
              {companiesData.length >= (groupMaxCompanies || 5) ? (
                <p className="text-xs" style={{ color: "#A6432F" }}>Limite de {groupMaxCompanies || 5} entreprises atteinte pour ce groupe.</p>
              ) : (
                <>
                  {!showAddCompany && !showLinkExisting && (
                    <div className="flex gap-2 flex-wrap">
                      <button onClick={() => setShowAddCompany(true)} className="text-xs px-3 py-2 rounded text-white" style={{ background: "#152238" }}>+ Nouvelle entreprise du groupe</button>
                      <button onClick={() => { setShowLinkExisting(true); if (myStandaloneCompanies === null) loadMyStandaloneCompanies(); }}
                        className="text-xs px-3 py-2 rounded" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>Ajouter une entreprise déjà existante</button>
                    </div>
                  )}
                  {showAddCompany && (
                    <div className="space-y-2">
                      <input value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)} placeholder="Nom de la nouvelle entreprise"
                        className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: "#DDD6C4" }} />
                      {companiesData.length > 0 && (
                        <div>
                          <label className="text-xs" style={{ color: "#8A8370" }}>Dupliquer la configuration de... (facultatif)</label>
                          <select value={duplicateFromId} onChange={(e) => setDuplicateFromId(e.target.value)}
                            className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                            <option value="">Aucune — repartir de zéro</option>
                            {companiesData.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                          <p className="text-xs mt-1" style={{ color: "#A39C87" }}>Reprend le plan comptable et le catalogue produits (jamais le stock réel, les ventes ou les clients) comme point de départ.</p>
                        </div>
                      )}
                      <div className="flex gap-2 flex-wrap">
                        <button onClick={addCompanyToGroup} disabled={creating} className="text-xs px-3 py-2 rounded text-white shrink-0" style={{ background: "#152238", opacity: creating ? 0.5 : 1 }}>
                          {creating ? "Création..." : "Créer"}
                        </button>
                        <button onClick={() => setShowAddCompany(false)} className="text-xs px-3 py-2 rounded shrink-0" style={{ background: "#F3EFE3", color: "#7A7460" }}>Annuler</button>
                      </div>
                    </div>
                  )}
                  {showLinkExisting && (
                    <div>
                      {myStandaloneCompanies === null ? (
                        <p className="text-xs" style={{ color: "#A39C87" }}>Chargement...</p>
                      ) : myStandaloneCompanies.length === 0 ? (
                        <p className="text-xs" style={{ color: "#A39C87" }}>Aucune autre entreprise à vous disponible — vous devez en être l'administrateur, et elle ne doit faire partie d'aucun autre groupe.</p>
                      ) : (
                        <div className="flex gap-2 flex-wrap">
                          <select value={selectedExistingId} onChange={(e) => setSelectedExistingId(e.target.value)}
                            className="flex-1 border rounded px-3 py-2 text-sm" style={{ borderColor: "#DDD6C4", minWidth: 180 }}>
                            <option value="">Choisir une entreprise...</option>
                            {myStandaloneCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                          <button onClick={linkExistingCompany} disabled={linkingExisting} className="text-xs px-3 py-2 rounded text-white shrink-0" style={{ background: "#152238", opacity: linkingExisting ? 0.5 : 1 }}>
                            {linkingExisting ? "Ajout..." : "Ajouter"}
                          </button>
                        </div>
                      )}
                      <button onClick={() => { setShowLinkExisting(false); setSelectedExistingId(""); }} className="text-xs underline mt-2" style={{ color: "#7A7460" }}>Annuler</button>
                    </div>
                  )}
                </>
              )}
              <p className="text-xs mt-2" style={{ color: "#A39C87" }}>Chaque entreprise garde sa propre gestion totalement séparée (comptes, stock, clients) — seul l'abonnement est partagé avec le reste du groupe.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}



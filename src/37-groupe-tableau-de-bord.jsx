// --- Tableau de bord consolidé du groupe ---
function GroupDashboardModule({ groupId, groupName, groupMaxCompanies, groupPlanStatus, groupTrialEndsAt, companyId, role, showToast, onGroupRenamed, onRequestsChanged, onEnterCurrentCompany, onJumpToModule }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [companiesData, setCompaniesData] = useState([]);
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [duplicateFromId, setDuplicateFromId] = useState("");
  const [creating, setCreating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
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
      return {
        id: s.id, name: s.name, planStatus: s.plan_status, kpis,
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

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <div className="rounded-lg p-6 mb-6 flex items-center justify-between flex-wrap gap-3"
        style={{ background: "linear-gradient(135deg, #152238 0%, #1F3358 100%)" }}>
        <div>
          <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "#C9A24B" }}>Espace multi-entreprises</div>
          <div className="display text-2xl" style={{ color: "#fff" }}>{groupName}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs px-3 py-1.5 rounded-full" style={{ background: "rgba(201,162,75,0.18)", color: "#C9A24B" }}>
            {companiesData.length} / {groupMaxCompanies || 5} entreprises
          </span>
          {role === "Administrateur" && (
            <button onClick={() => { setShowSettings((v) => !v); setEditGroupName(groupName || ""); }}
              className="text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5" style={{ background: "rgba(255,255,255,0.12)", color: "#EFE9DD" }}>
              {showSettings ? "Fermer" : "Paramètres du groupe"}
              {!showSettings && joinRequests.length > 0 && (
                <span className="text-xs px-1.5 rounded-full text-white" style={{ background: "#D9756B" }}>{joinRequests.length}</span>
              )}
            </button>
          )}
        </div>
      </div>

      {showSettings && (
        <div className="bg-white rounded-lg p-5 mb-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="display text-lg mb-4" style={{ color: "#152238" }}>Paramètres du groupe</div>

          <div className="mb-5">
            <label className="text-xs" style={{ color: "#8A8370" }}>Nom du groupe</label>
            <div className="flex flex-wrap gap-2 mt-1">
              <input value={editGroupName} onChange={(e) => setEditGroupName(e.target.value)}
                className="flex-1 border rounded px-3 py-2 text-sm" style={{ borderColor: "#DDD6C4", minWidth: 0 }} />
              <button onClick={renameGroup} disabled={savingName || editGroupName.trim() === groupName}
                className="text-xs px-3 py-2 rounded text-white shrink-0" style={{ background: "#152238", opacity: (savingName || editGroupName.trim() === groupName) ? 0.5 : 1 }}>
                {savingName ? "..." : "Enregistrer"}
              </button>
            </div>
          </div>

          <div className="mb-5 p-3 rounded" style={{ background: "#FAF8F1" }}>
            <div className="text-xs mb-1" style={{ color: "#A39C87" }}>Abonnement du groupe</div>
            <div className="text-sm" style={{ color: "#152238" }}>
              {groupPlanStatus === "active" ? "Actif" : groupPlanStatus === "trial" ? "Période d'essai" : "Suspendu"}
              {groupTrialEndsAt && (groupPlanStatus === "trial" || groupPlanStatus === "active") && (
                <span style={{ color: "#A39C87" }}> — {groupPlanStatus === "trial" ? "fin d'essai" : "renouvellement"} le {new Date(groupTrialEndsAt).toLocaleDateString("fr-FR")}</span>
              )}
            </div>
          </div>

          {joinRequests.length > 0 && (
            <div className="mb-5 p-3 rounded" style={{ background: "#FBF1DC" }}>
              <div className="text-xs font-medium mb-2" style={{ color: "#9A7B1E" }}>Demandes de rattachement en attente</div>
              <div className="space-y-2">
                {joinRequests.map((r) => (
                  <div key={r.id} className="p-2 rounded" style={{ background: "#fff" }}>
                    <div className="text-sm mb-1" style={{ color: "#152238" }}>{r.company_name}</div>
                    <div className="text-xs mb-2" style={{ color: "#A39C87" }}>Demandée par {r.requested_by_email}</div>
                    <div className="flex gap-2">
                      <button onClick={() => respondToJoinRequest(r, true)} disabled={respondingRequestId === r.id}
                        className="text-xs px-2 py-1 rounded text-white" style={{ background: "#0F6B5C", opacity: respondingRequestId === r.id ? 0.5 : 1 }}>Accepter</button>
                      <button onClick={() => respondToJoinRequest(r, false)} disabled={respondingRequestId === r.id}
                        className="text-xs px-2 py-1 rounded" style={{ border: "1px solid #DDD6C4", color: "#7A7460", opacity: respondingRequestId === r.id ? 0.5 : 1 }}>Refuser</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-xs mb-2" style={{ color: "#8A8370" }}>Entreprises du groupe</div>
            <div className="space-y-2">
              {companiesData.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 p-2.5 rounded" style={{ background: "#FAF8F1" }}>
                  <span className="text-sm" style={{ color: "#152238" }}>{c.name}{c.id === companyId ? " (celle-ci)" : ""}</span>
                  <button onClick={() => removeCompanyFromGroup(c)} disabled={removingId === c.id}
                    className="text-xs underline shrink-0" style={{ color: "#A6432F", opacity: removingId === c.id ? 0.5 : 1 }}>
                    {removingId === c.id ? "Retrait..." : "Retirer du groupe"}
                  </button>
                </div>
              ))}
            </div>
            <p className="text-xs mt-2" style={{ color: "#A39C87" }}>Une entreprise retirée repasse au forfait Standard, en mode essai jusqu'à la date actuelle du groupe (pas un essai neuf) — ses données ne sont jamais affectées.</p>
          </div>
        </div>
      )}

      {loadError && (
        <div className="text-xs p-3 rounded mb-4" style={{ background: "#F7E9E3", color: "#A6432F" }}>
          Impossible de charger le groupe : {loadError}
        </div>
      )}

      {loading ? (
        <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Chargement...</div>
      ) : (
        <>
          <div className="mb-6">
            <div className="display text-lg mb-3" style={{ color: "#152238" }}>Vos entreprises</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {companiesData.map((c, i) => {
                const isCurrent = c.id === companyId;
                const openThisCompany = async (targetModule) => {
                  if (isCurrent) {
                    // Déjà l'entreprise résolue par la session — inutile de la
                    // re-choisir ou de recharger la page, un simple changement
                    // d'onglet actif suffit à y entrer immédiatement.
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
                return (
                <div key={c.id} onClick={() => openThisCompany()}
                  className="rounded-lg p-4" style={{ background: "#FAF8F1", border: isCurrent ? "1px solid #C9A24B" : "1px solid #E4DFD1", cursor: "pointer" }}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs mb-1" style={{ color: "#A39C87" }}>Entreprise {i + 1}{isCurrent ? " — celle-ci" : ""}</div>
                      <div className="text-sm font-semibold mb-1" style={{ color: "#152238" }}>{c.name}</div>
                      <div className="text-xs" style={{ color: "#7A7460" }}>
                        {c.type || "Type non renseigné"} {c.secteur ? `· ${c.secteur}` : ""}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 items-end shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); openThisCompany(); }}
                        className="text-xs px-2 py-1 rounded text-white" style={{ background: "#152238" }}
                      >
                        Ouvrir
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); openThisCompany("rh"); }}
                        className="text-xs px-2 py-1 rounded" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}
                      >
                        Salaires
                      </button>
                    </div>
                  </div>
                </div>
                );
              })}
              {companiesData.length === 0 && (
                <p className="text-xs" style={{ color: "#A39C87" }}>Aucune entreprise dans ce groupe pour l'instant.</p>
              )}
            </div>
          </div>

          <div className="display text-lg mb-3" style={{ color: "#152238" }}>Vue d'ensemble consolidée</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
              <div className="text-xs mb-1" style={{ color: "#A39C87" }}>Chiffre d'affaires consolidé</div>
              <div className="text-xl font-semibold tabular" style={{ color: "#152238" }}>{fmt(totals.produits)}</div>
            </div>
            <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
              <div className="text-xs mb-1" style={{ color: "#A39C87" }}>Charges consolidées</div>
              <div className="text-xl font-semibold tabular" style={{ color: "#A6432F" }}>{fmt(totals.charges)}</div>
            </div>
            <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
              <div className="text-xs mb-1" style={{ color: "#A39C87" }}>Résultat consolidé</div>
              <div className="text-xl font-semibold tabular" style={{ color: totals.resultat >= 0 ? "#0F6B5C" : "#A6432F" }}>{fmt(totals.resultat)}</div>
            </div>
            <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
              <div className="text-xs mb-1" style={{ color: "#A39C87" }}>Trésorerie totale</div>
              <div className="text-xl font-semibold tabular" style={{ color: "#152238" }}>{fmt(totals.tresorerie)}</div>
            </div>
            <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
              <div className="text-xs mb-1" style={{ color: "#A39C87" }}>Masse salariale consolidée</div>
              <div className="text-xl font-semibold tabular" style={{ color: "#152238" }}>{fmt(totals.masseSalariale)}</div>
              <div className="text-xs mt-0.5" style={{ color: "#A39C87" }}>{totals.activeEmployeeCount} employé{totals.activeEmployeeCount > 1 ? "s" : ""} actif{totals.activeEmployeeCount > 1 ? "s" : ""}</div>
            </div>
          </div>

          {companiesData.length > 0 && (
            <div className="bg-white rounded-lg p-6 mb-6" style={{ border: "1px solid #E4DFD1" }}>
              <div className="display text-lg mb-4" style={{ color: "#152238" }}>Chiffre d'affaires et charges par entreprise</div>
              <SimpleGroupedBarChart
                data={companiesData.map((c) => ({ nom: c.name, produits: c.kpis.produits, charges: c.kpis.charges }))}
                xKey="nom"
                series={[
                  { key: "produits", name: "Chiffre d'affaires", color: "#0F6B5C" },
                  { key: "charges", name: "Charges", color: "#A6432F" },
                ]}
              />
            </div>
          )}

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

          {companiesData.length > 0 && (
            <div className="mb-6">
              <div className="display text-lg mb-1" style={{ color: "#152238" }}>Performance de chaque entreprise</div>
              <p className="text-xs mb-3" style={{ color: "#A39C87" }}>Chiffres propres à chaque entreprise — aucun total partagé ici, pour une idée claire de qui performe comment.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {companiesData.map((c) => (
                  <div key={c.id} className="bg-white rounded-lg p-5" style={{ border: c.id === companyId ? "1px solid #C9A24B" : "1px solid #E4DFD1" }}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm font-semibold" style={{ color: "#152238" }}>{c.name}</div>
                      {c.id === companyId && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#FBF1DC", color: "#9A7B1E" }}>Celle-ci</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs mb-0.5" style={{ color: "#A39C87" }}>Chiffre d'affaires</div>
                        <div className="text-sm font-semibold tabular" style={{ color: "#152238" }}>{fmt(c.kpis.produits)}</div>
                      </div>
                      <div>
                        <div className="text-xs mb-0.5" style={{ color: "#A39C87" }}>Charges</div>
                        <div className="text-sm font-semibold tabular" style={{ color: "#A6432F" }}>{fmt(c.kpis.charges)}</div>
                      </div>
                      <div>
                        <div className="text-xs mb-0.5" style={{ color: "#A39C87" }}>Résultat</div>
                        <div className="text-sm font-semibold tabular" style={{ color: c.kpis.resultat >= 0 ? "#0F6B5C" : "#A6432F" }}>{fmt(c.kpis.resultat)}</div>
                      </div>
                      <div>
                        <div className="text-xs mb-0.5" style={{ color: "#A39C87" }}>Trésorerie</div>
                        <div className="text-sm font-semibold tabular" style={{ color: "#152238" }}>{fmt(c.kpis.tresorerie)}</div>
                      </div>
                      <div>
                        <div className="text-xs mb-0.5" style={{ color: "#A39C87" }}>Masse salariale</div>
                        <div className="text-sm font-semibold tabular" style={{ color: "#152238" }}>{fmt(c.masseSalariale || 0)}</div>
                      </div>
                      <div>
                        <div className="text-xs mb-0.5" style={{ color: "#A39C87" }}>Employés actifs</div>
                        <div className="text-sm font-semibold tabular" style={{ color: "#152238" }}>{c.activeEmployeeCount || 0}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {role === "Administrateur" && (
            <div className="bg-white rounded-lg p-4 mb-6" style={{ border: "1px solid #E4DFD1" }}>
              <div className="display text-lg mb-1" style={{ color: "#152238" }}>Collaborateurs du groupe</div>
              <p className="text-xs mb-3" style={{ color: "#A39C87" }}>Gérez l'accès d'une personne à une ou plusieurs entreprises du groupe depuis un seul endroit.</p>

              {Object.entries(
                groupMembers.reduce((acc, m) => {
                  (acc[m.email] = acc[m.email] || []).push(m);
                  return acc;
                }, {})
              ).map(([email, rows]) => (
                <div key={email} className="mb-2 p-2.5 rounded" style={{ background: "#FAF8F1" }}>
                  <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>{email}</div>
                  <div className="space-y-1">
                    {rows.map((m) => (
                      <div key={m.id} className="flex items-center justify-between gap-2 text-xs">
                        <span style={{ color: "#7A7460" }}>
                          {(companiesData.find((c) => c.id === m.company_id) || {}).name || "?"} — {m.role}{!m.user_id ? " (invitation en attente)" : ""}
                        </span>
                        <button onClick={() => removeCollaboratorFromCompany(m)} disabled={removingMemberId === m.id}
                          className="underline shrink-0" style={{ color: "#A6432F", opacity: removingMemberId === m.id ? 0.5 : 1 }}>
                          Retirer
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {groupMembers.length === 0 && <p className="text-xs mb-3" style={{ color: "#A39C87" }}>Aucun collaborateur pour l'instant.</p>}

              {lastInviteLinks.length > 0 && (
                <div className="mt-3 p-3 rounded text-xs" style={{ background: "#FBF1DC" }}>
                  <div className="font-medium mb-1" style={{ color: "#9A7B1E" }}>Lien(s) d'invitation à partager :</div>
                  {lastInviteLinks.map((l, i) => (
                    <div key={i} className="mb-1" style={{ color: "#7A7460", wordBreak: "break-all" }}>{l.companyName} : {l.link}</div>
                  ))}
                </div>
              )}

              {!showAddCollab ? (
                <button onClick={() => { setShowAddCollab(true); setNewCollabCompanies(Object.fromEntries(companiesData.map((c) => [c.id, true]))); }}
                  className="text-xs px-3 py-2 rounded text-white mt-3" style={{ background: "#152238" }}>+ Ajouter un collaborateur</button>
              ) : (
                <div className="mt-3 p-3 rounded" style={{ border: "1px solid #E4DFD1" }}>
                  <input value={newCollabEmail} onChange={(e) => setNewCollabEmail(e.target.value)} placeholder="Email du collaborateur"
                    className="w-full border rounded px-3 py-2 text-sm mb-2" style={{ borderColor: "#DDD6C4" }} />
                  <select value={newCollabRole} onChange={(e) => setNewCollabRole(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm mb-2" style={{ borderColor: "#DDD6C4" }}>
                    <option>Administrateur</option><option>Éditeur</option><option>Lecture seule</option><option>Vendeur</option>
                  </select>
                  <div className="text-xs mb-1" style={{ color: "#8A8370" }}>Entreprises concernées :</div>
                  <div className="space-y-1 mb-3">
                    {companiesData.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-xs" style={{ color: "#152238" }}>
                        <input type="checkbox" checked={!!newCollabCompanies[c.id]}
                          onChange={(e) => setNewCollabCompanies((prev) => ({ ...prev, [c.id]: e.target.checked }))} />
                        {c.name}
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={addCollaboratorToGroup} disabled={savingCollab}
                      className="text-xs px-3 py-2 rounded text-white" style={{ background: "#152238", opacity: savingCollab ? 0.5 : 1 }}>
                      {savingCollab ? "Ajout..." : "Ajouter"}
                    </button>
                    <button onClick={() => setShowAddCollab(false)} className="text-xs px-3 py-2 rounded" style={{ background: "#F3EFE3", color: "#7A7460" }}>Annuler</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {role === "Administrateur" && (
            <div className="bg-white rounded-lg p-4 mb-6" style={{ border: "1px solid #E4DFD1" }}>
              <div className="display text-lg mb-3" style={{ color: "#152238" }}>Journal d'audit consolidé</div>
              {companiesData.every((c) => (c.auditLog || []).length === 0) ? (
                <p className="text-xs" style={{ color: "#A39C87" }}>Aucune action enregistrée pour l'instant dans les entreprises de ce groupe.</p>
              ) : (
                <div className="space-y-1.5 max-h-96 overflow-y-auto">
                  {companiesData
                    .flatMap((c) => (c.auditLog || []).map((entry) => ({ ...entry, companyName: c.name })))
                    .sort((a, b) => (a.date < b.date ? 1 : -1))
                    .slice(0, 100)
                    .map((entry, i) => (
                      <div key={i} className="text-xs p-2 rounded" style={{ background: "#FAF8F1" }}>
                        <div className="flex justify-between gap-2">
                          <span style={{ color: "#152238" }}>{entry.companyName} — {entry.action}</span>
                          <span style={{ color: "#A39C87" }} className="shrink-0">{new Date(entry.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span>
                        </div>
                        <div style={{ color: "#A39C87" }}>{entry.user}{entry.details ? ` — ${entry.details}` : ""}</div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {role === "Administrateur" && companiesData.length >= 2 && (
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

          {role === "Administrateur" && (
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



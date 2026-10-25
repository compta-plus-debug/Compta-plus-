// ═══ MODULE ═══
// @module Application principale
// @depends APP_VERSION, AchatModule, AdminMfaEnforcer, AdminModule, AnnouncementsBanner, BZ_ACCOUNTS
//   Boxes, CRMModule, CURRENT_CURRENCY, CabinetSpace, CaisseBanqueModule, CentreDeGestionModule
//   ComingSoon, ComptaModule, CreditCard, DEFAULT_ACCOUNTS, DEFAULT_CLIENTS, DEFAULT_PRODUCTS
//   DEFAULT_SETTINGS, DEFAULT_SUPPLIERS, DEFAULT_USERS, Dashboard, EcolesModule
//   FALLBACK_HTG_PER_USD, GestionModule, GroupDashboardModule, HL_EVT, HelpCenterChat, Icon
//   ImportExportModule, LayoutDashboard, Lock, MODULES, Menu, MessageCircle, NET_MSG, OFL_EVT
//   PLAN_TIER_INFO, PayrollModule, ROLE_MODULE_ACCESS, RapportsModule, SUPABASE_URL, SanteModule
//   SecteursChoixModal, SecurityPanel, Smartphone, StockModule, SuperAdminModule, UpgradeModal
//   VENDEUR_WRITABLE_CATEGORIES, VenteModule, X, _backNavStack, _membership, allowedModulesFor
//   asstScan, bkBuildFile, bkDownload, chooseCompany, clearMembershipCache, computeBalances
//   computeKpis, dlog, fetchHtgPerUsd, forgetCompanyChoice, friendlyError, genInviteToken
//   hlCacheAll, hlCachePut, hlKeys, hlMeta, hlNetDown, hlOffline, hlOverlay, hlPendAll, hlPendDel
//   hlPendMark, hlPinMark, hlPinValid, hlSaveMeta, invoicePrefix, invokeEdgeFunction
//   loadSecteursInfo, logClientError, monthLabel, oflIsNetworkError, oflLoad, oflSyncAll
//   oflTimeout, perfMarkMount, perfMarkReady, pjTraceText, resolveMembership, roleLabel
//   ruleRefusalMessage, sanitizeUserMessage, sealEntries, secteursDroits, supabase, todayStr, uid
//   unwrapVersioned, useBackNav, useEffect, useMemo, useState
// @exports App
// ═══ FIN DE L'EN-TÊTE ═══
// Protection légère de l'affichage : on ne peut ni glisser un texte de l'écran, ni le déposer dans un champ.
// (Les fichiers glissés — import de données, logo — restent acceptés.)
(function installerProtectionGlisser() {
  if (typeof document === "undefined" || window.__comptaAntiGlisser) return;
  window.__comptaAntiGlisser = true;
  document.addEventListener("dragstart", (e) => { const t = e.target; if (!(t && t.closest && t.closest("[draggable='true']"))) e.preventDefault(); }, true);
  document.addEventListener("drop", (e) => { const dt = e.dataTransfer; if (dt && dt.files && dt.files.length) return; e.preventDefault(); }, true);
})();
function App() {
  const [active, setActive] = useState("dashboard");
  const initialActiveSetRef = React.useRef(false);
  useBackNav(active, setActive, "dashboard");

  // Confirmation avant de quitter l'application via le bouton retour physique
  // (Android uniquement — aucune API web ne permet d'intercepter le balayage de
  // fermeture sur iPhone ni le changement d'application). Principe : une entrée
  // de garde est empilée tout en bas de la pile de navigation partagée dès le
  // chargement ; quand toutes les autres étapes (sous-onglet, module) ont déjà
  // été consommées par des retours précédents, cette entrée déclenche la boîte
  // de dialogue au lieu de laisser l'application se fermer directement.
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  useEffect(() => {
    const pushExitGuard = () => {
      _backNavStack.unshift({ reset: () => setShowExitConfirm(true) });
      window.history.pushState({ exitGuard: true }, "");
    };
    pushExitGuard();
  }, []);

  // Affiche un message clair dès que l'appareil perd sa connexion internet —
  // plutôt que de laisser l'utilisateur face à une page périmée ou incohérente
  // chargée depuis le cache hors-ligne, sans explication.
  const [isOffline, setIsOffline] = useState(typeof navigator !== "undefined" && !navigator.onLine);
  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);
  const [accounts, setAccounts] = useState(DEFAULT_ACCOUNTS);
  const [entries, setEntriesRaw] = useState([]);
  // Toute écriture ajoutée passe automatiquement par le scellement à la SHA-256 (voir
  // sealEntries plus haut), quel que soit le module d'origine (Compta, Caisse/banque,
  // Vente, Achat) — aucun de ces modules n'a besoin de connaître le mécanisme de scellement.
  const setEntries = React.useCallback((updater) => {
    setEntriesRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      return sealEntries(next);
    });
  }, []);
  const [products, setProducts] = useState(DEFAULT_PRODUCTS);
  // Les photos des produits sont stockées séparément (par id de produit), dans leur
  // propre clé de synchronisation — pas intégrées dans le tableau "products". Sans ça,
  // chaque photo (même compressée) alourdit le bloc unique contenant TOUS les produits,
  // jusqu'à atteindre une limite de taille qui bloquait silencieusement l'enregistrement
  // de nouveaux produits une fois le catalogue assez grand. Ainsi, le nombre de produits
  // n'est plus du tout limité par la présence de photos.
  const [productImages, setProductImages] = useState({});
  const [invoices, setInvoices] = useState([]);
  const [suppliers, setSuppliers] = useState(DEFAULT_SUPPLIERS);
  const [purchases, setPurchases] = useState([]);
  // Registre des chèques (reçus de clients / émis à des fournisseurs), avec leur cycle de vie.
  const [cheques, setCheques] = useState([]);
  const [sante, setSante] = useState([]); // bloc Santé : patients, catalogue, factures, assureurs, praticiens, séjours, lots
  const [impex, setImpex] = useState([]); // bloc Import-export : réglages, dossiers d'importation et d'exportation
  const [ecole, setEcole] = useState([]); // bloc Écoles : années, classes, familles, élèves, frais, échéances, reçus
  const [bizdocs, setBizdocs] = useState([]); // Gestion avancée (devis, avoirs, acomptes, inventaires, abonnements, budgets...)
  const [movements, setMovements] = useState([]);
  const [clients, setClients] = useState(DEFAULT_CLIENTS);
  const [employees, setEmployees] = useState([]);
  // Postes de vente distincts (ex. "Caisse 1", "Caisse 2") — fonctionnalité réservée
  // au forfait Assisté. Chaque appareil retient localement (pas synchronisé) quel
  // poste il représente ; la liste des postes elle-même, gérée par l'Administrateur
  // principal, est partagée comme les autres catégories.
  const [salesStations, setSalesStations] = useState([]);
  // Registre des immobilisations (matériel, véhicules...) — méthode d'amortissement
  // linéaire uniquement, dotations générées manuellement par l'utilisateur quand il
  // le décide (voir ComptaModule → onglet Immobilisations).
  const [assets, setAssets] = useState([]);
  // Charges à payer / produits à recevoir — estimation d'une charge/produit déjà
  // engagé mais pas encore facturé, à contrepasser manuellement dès réception de la
  // vraie facture (voir ComptaModule → onglet Régularisations).
  const [accruals, setAccruals] = useState([]);
  // Charges/produits constatés d'avance — un montant déjà payé/encaissé mais qui
  // couvre plusieurs périodes futures (ex. assurance annuelle payée d'avance),
  // étalé mois par mois via un bouton manuel de reclassement (voir ComptaModule →
  // onglet Charges/produits d'avance), sur le même principe que l'amortissement.
  const [deferrals, setDeferrals] = useState([]);
  // Provisions pour risques et charges (litiges, garanties...) — un montant estimé,
  // réévaluable dans le temps à mesure que la situation évolue (voir ComptaModule →
  // onglet Provisions pour risques). Même principe que la dépréciation de stock :
  // seul l'écart entre l'ancienne et la nouvelle estimation génère une dotation ou
  // une reprise, jamais le montant total à chaque réévaluation.
  const [riskProvisions, setRiskProvisions] = useState([]);
  const [loans, setLoans] = useState([]);
  // Modèles d'écritures récurrentes — fonctionnalité exclusive au forfait Assisté.
  // Un libellé + un jeu de lignes (comptes/montants) enregistrés une fois, réutilisables
  // en un clic pour une écriture qui revient régulièrement (loyer, abonnement...).
  const [entryTemplates, setEntryTemplates] = useState([]);
  // Double validation sur les opérations à fort enjeu — fonctionnalité exclusive au
  // forfait Assisté. Au lieu de s'exécuter immédiatement, l'action crée une demande
  // en attente ; un administrateur (idéalement différent de celui qui a demandé,
  // mais pas obligatoire s'il n'y en a qu'un seul) doit l'approuver explicitement
  // avant que l'écriture et les changements associés ne soient réellement appliqués.
  const [pendingApprovals, setPendingApprovals] = useState([]);
  // Poste de vente : identité propre à CET appareil (pas au compte de l'utilisateur
  // connecté), stockée en localStorage — persiste tant que le vendeur reste sur le
  // même appareil, peu importe qui s'y connecte. Déclaré ici (niveau App) plutôt que
  // dans VenteModule pour que la barre latérale (nom du vendeur affiché) reste
  // réactive à un changement de poste, au lieu de lire localStorage indépendamment
  // sans jamais être notifiée d'un changement fait ailleurs dans l'arbre.
  // Le choix est retenu PAR COMPTE sur cet appareil (clé propre à l'email) : un autre
  // compte vendeur qui se connecte sur le même appareil ne reprend jamais le poste de
  // quelqu'un d'autre. Voir les effets de chargement/enregistrement plus bas, qui ont
  // besoin de l'email connecté.
  const [stationId, setStationId] = useState("");
  const stationOwnerRef = React.useRef("");
  const [payslips, setPayslips] = useState([]);
  const [salaryAdvances, setSalaryAdvances] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [users, setUsers] = useState(DEFAULT_USERS);
  // Journal des modifications : trace qui a fait quoi, où, et quand. Alimenté par
  // logAudit(), défini plus bas une fois currentUserEmail disponible.
  const [auditLog, setAuditLog] = useState([]);
  const [loaded, setLoaded] = useState(false);
  // Complète le plan comptable existant avec les comptes nécessaires à la méthode
  // "stock en actif" (370, 6037), pour toute entreprise créée avant leur ajout au
  // modèle par défaut — sans ça, ils n'existeraient que pour les nouvelles
  // entreprises, et les écritures les utilisant afficheraient un compte sans nom.
  useEffect(() => {
    if (!loaded) return;
    const missing = [
      { code: "370", name: "Stock de marchandises", type: "Actif" },
      { code: "39", name: "Dépréciation des stocks", type: "Actif" },
      { code: "6037", name: "Coût des marchandises vendues", type: "Charge" },
      { code: "6817", name: "Dotations aux dépréciations des stocks", type: "Charge" },
      { code: "7817", name: "Reprises sur dépréciations des stocks", type: "Produit" },
      { code: "491", name: "Provisions pour créances douteuses", type: "Actif" },
      { code: "6816", name: "Dotations aux provisions pour créances douteuses", type: "Charge" },
      { code: "7816", name: "Reprises sur provisions pour créances douteuses", type: "Produit" },
      { code: "654", name: "Pertes sur créances irrécouvrables", type: "Charge" },
      { code: "110", name: "Report à nouveau", type: "Capitaux propres" },
      { code: "106", name: "Réserves", type: "Capitaux propres" },
      { code: "457", name: "Associés — Dividendes à payer", type: "Passif" },
      ...ASSET_CATEGORIES.flatMap((c) => [
        { code: c.assetAccount, name: c.label, type: "Actif" },
        { code: c.depreciationAccount, name: `Amortissements — ${c.label}`, type: "Actif" },
      ]),
      { code: "6811", name: "Dotations aux amortissements des immobilisations", type: "Charge" },
      { code: "404", name: "Fournisseurs d'immobilisations", type: "Passif" },
      { code: "4456", name: "Taxe déductible sur achats (TCA)", type: "Actif" },
      { code: "431", name: "Charges sociales et fiscales à payer", type: "Passif" },
      { code: "4081", name: "Fournisseurs — Factures non parvenues", type: "Passif" },
      { code: "4181", name: "Clients — Factures à établir", type: "Actif" },
      { code: "6238", name: "Dons, libéralités", type: "Charge" },
      { code: "486", name: "Charges constatées d'avance", type: "Actif" },
      { code: "487", name: "Produits constatés d'avance", type: "Passif" },
      { code: "151", name: "Provisions pour risques", type: "Passif" },
      { code: "6815", name: "Dotations aux provisions pour risques", type: "Charge" },
      { code: "7815", name: "Reprises sur provisions pour risques", type: "Produit" },
    ].filter((a) => !accounts.some((existing) => existing.code === a.code));
    if (missing.length > 0) setAccounts((prev) => [...prev, ...missing]);
  }, [loaded]);
  // Suit, catégorie par catégorie, si le CHARGEMENT initial a vraiment réussi. Tant
  // qu'une catégorie n'est pas confirmée chargée, sa sauvegarde automatique reste
  // désactivée — pour ne jamais risquer d'écraser les vraies données du serveur avec
  // la valeur de secours locale (ex. les articles d'exemple) après un simple échec
  // réseau ponctuel au démarrage.
  const loadedCategoriesRef = React.useRef({});
  const offlineBootRef = React.useRef(false);
  const [offlineBootAt, setOfflineBootAt] = useState(null);
  const [hlNotice, setHlNotice] = useState(null);
  const [hlPendingCats, setHlPendingCats] = useState([]);
  const [role, setRole] = useState("Lecture seule"); // valeur de repli la plus restrictive — écrasée dès que resolveMembership() confirme le vrai rôle ; filet de sécurité en plus de la barrière de chargement, au cas où un futur bug l'affaiblirait
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  // Poste imposé par l'affiliation de l'email (liste « Emails affiliés ») : calculé à la
  // volée à partir du compte connecté, sans jamais être écrit dans la mémoire de
  // l'appareil — sinon le poste d'un vendeur affilié « restait collé » à l'appareil et
  // s'ouvrait aussi pour un autre compte vendeur sans poste.
  const stationKey = (em) => "compta-plus-station-id:" + String(em || "").toLowerCase();
  useEffect(() => {
    const em = String(currentUserEmail || "").toLowerCase();
    stationOwnerRef.current = em;
    if (!em) { setStationId(""); return; }
    let v = "";
    try { v = localStorage.getItem(stationKey(em)) || ""; } catch (e) {}
    setStationId(v);
  }, [currentUserEmail]);
  useEffect(() => {
    const em = String(currentUserEmail || "").toLowerCase();
    if (!em || stationOwnerRef.current !== em) return;
    try {
      if (stationId) localStorage.setItem(stationKey(em), stationId);
      else localStorage.removeItem(stationKey(em));
    } catch (e) {}
  }, [stationId]);
  const lockedStationApp = (salesStations || []).find((st) => (st.sellerEmails || []).some((e) => (currentUserEmail || "").toLowerCase() === String(e).toLowerCase())) || null;
  const effectiveStationId = lockedStationApp ? lockedStationApp.id : "";
  const currentStationForSidebar = (salesStations || []).find((st) => String(st.id) === String(effectiveStationId)) || null;
  // Poste choisi à la main sur cet appareil mais disparu de la liste (supprimé, ou recréé
  // sous un autre identifiant) : on l'oublie, pour que le vendeur voie clairement qu'aucun
  // poste n'est choisi au lieu de vendre sans poste sans le savoir.
  useEffect(() => {
    if (stationId && (salesStations || []).length > 0 && !(salesStations || []).some((st) => String(st.id) === String(stationId))) setStationId("");
  }, [stationId, salesStations]);
  const [planStatus, setPlanStatus] = useState("suspended"); // valeur de repli la plus restrictive — écrasée dès que resolveMembership() confirme le vrai statut ; filet de sécurité en plus de la barrière de chargement
  const [planTier, setPlanTier] = useState("standard"); // "standard" | "assisted"
  const [secteurs, setSecteurs] = useState({ sectors: [], locked: false, pack: false, extra: [], ok: false, companyId: null }); // blocs par secteur (étape 1)
  const [secteursSkip, setSecteursSkip] = useState(false);
  const [trialEndsAt, setTrialEndsAt] = useState(null);
  // Groupe multi-entreprises : null si cette entreprise n'en fait pas partie.
  const [groupId, setGroupId] = useState(null);
  const [groupName, setGroupName] = useState(null);
  const [groupMaxCompanies, setGroupMaxCompanies] = useState(null);
  // Nombre de demandes de rattachement en attente pour le groupe — ne reflète
  // jamais que celles visibles pour le propriétaire (la politique de sécurité
  // ne renvoie rien à qui n'est pas le propriétaire du groupe concerné).
  const [pendingGroupRequests, setPendingGroupRequests] = useState(0);
  const [isGroupOwner, setIsGroupOwner] = useState(false);

  const loadPendingGroupRequests = async () => {
    if (!groupId) { setPendingGroupRequests(0); return; }
    const { data } = await supabase.from("group_join_requests").select("id").eq("group_id", groupId).eq("status", "pending");
    setPendingGroupRequests((data || []).length);
  };
  useEffect(() => { loadPendingGroupRequests(); }, [groupId]);
  const [isAssistedSupervisor, setIsAssistedSupervisor] = useState(false);
  const [isAccountant, setIsAccountant] = useState(false);
  const [canAdjust, setCanAdjust] = useState(false); // expert-comptable autorisé à passer des écritures de régularisation
  const [companyCount, setCompanyCount] = useState(1);
  // Recommandations en attente (mode Assisté) : une anomalie ignorée jusqu'à la
  // 3e tentative reste affichée en boucle (toutes les 45s + à chaque retour sur
  // le module concerné) tant qu'elle n'a pas été explicitement prise en compte.
  const [pendingRecommendations, setPendingRecommendations] = useState([]);
  const loadPendingRecommendations = React.useCallback(async (companyId) => {
    if (!companyId) return;
    const { data, error } = await supabase.from("pending_recommendations").select("*").eq("company_id", companyId).eq("resolved", false).order("created_at", { ascending: true });
    if (!error && data) setPendingRecommendations(data);
  }, []);
  const recordPendingRecommendation = async ({ companyId, module, anomalyText, correctionText, entryRef, createdByEmail, correctionKind, correctionPayload }) => {
    const { data, error } = await supabase.from("pending_recommendations").insert({ company_id: companyId, module, anomaly_text: anomalyText, correction_text: correctionText, entry_ref: entryRef, created_by_email: createdByEmail, correction_kind: correctionKind || "generic", correction_payload: correctionPayload || null }).select().single();
    if (!error && data) setPendingRecommendations((prev) => [...prev, data]);
  };
  const resolvePendingRecommendation = async (id) => {
    const { error } = await supabase.from("pending_recommendations").update({ resolved: true, resolved_at: new Date().toISOString() }).eq("id", id);
    if (!error) setPendingRecommendations((prev) => prev.filter((r) => r.id !== id));
  };
  const [needsWelcome, setNeedsWelcome] = useState(false);
  const [membershipError, setMembershipError] = useState(null);
  const [netWait, setNetWait] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [isManagementCollaborator, setIsManagementCollaborator] = useState(false);
  const [companyPickOptions, setCompanyPickOptions] = useState(null);
  // Tableau de bord général réservé à l'administrateur de la plateforme (voir plus
  // bas) — ces hooks sont déclarés tout en haut du composant, avant TOUT retour
  // anticipé (isBlocked, code PIN, etc.), pour ne jamais violer l'ordre des hooks
  // React d'un rendu à l'autre (source de l'erreur #300 rencontrée en pratique).
  const [platformLanding, setPlatformLanding] = useState(() => {
    // Si on vient de cliquer "Ouvrir mon entreprise" juste avant un rechargement
    // volontaire (voir plus bas), on saute l'écran d'accueil général et on va
    // directement dans le bloc Entreprise, avec des données fraîchement relues —
    // pas l'état resté en mémoire depuis avant le rechargement.
    try { return sessionStorage.getItem("compta_skip_landing") !== "1"; } catch (e) { return true; }
  });
  const [platformStats, setPlatformStats] = useState(null);
  const [showCreateCompanyForm, setShowCreateCompanyForm] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [creatingCompany, setCreatingCompany] = useState(false);

  useEffect(() => {
    // Le drapeau ne doit servir qu'une fois, juste après le rechargement volontaire
    // déclenché par "Ouvrir mon entreprise" — on l'efface aussitôt lu pour qu'un
    // rechargement normal ultérieur (F5, etc.) retrouve le comportement habituel.
    try { sessionStorage.removeItem("compta_skip_landing"); } catch (e) {}
  }, []);

  useEffect(() => {
    if (!isPlatformAdmin || !platformLanding) return;
    (async () => {
      const { data } = await supabase.from("companies").select("plan_status");
      if (data) {
        setPlatformStats({
          total: data.length,
          active: data.filter((c) => c.plan_status === "active").length,
          suspended: data.filter((c) => c.plan_status === "suspended").length,
        });
      }
    })();
  }, [isPlatformAdmin, platformLanding]);

  const createAdditionalCompany = async () => {
    if (!newCompanyName.trim()) { showToast("Entrez un nom d'entreprise."); return; }
    setCreatingCompany(true);
    let createdCompanyId = null;
    try {
      const trimmedName = newCompanyName.trim();
      const { data: clash } = await supabase.from("companies").select("id").ilike("name", trimmedName).maybeSingle();
      if (clash) {
        showToast(`Le nom « ${trimmedName} » est déjà utilisé par une autre entreprise — choisissez-en un autre.`);
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      // Même principe que pour l'inscription normale : générer l'id nous-mêmes
      // pour ne jamais avoir besoin de relire la ligne juste après (voir le
      // commentaire détaillé sur resolveMembership plus haut dans ce fichier).
      const newCompanyId = crypto.randomUUID();
      const { error: companyErr } = await supabase.from("companies").insert({ id: newCompanyId, name: trimmedName });
      if (companyErr) throw new Error("La création de l'entreprise n'a pas pu aboutir. " + NET_MSG);
      createdCompanyId = newCompanyId;
      const { error: memberErr } = await supabase.from("company_members").insert({
        company_id: newCompanyId, user_id: user.id, email: user.email, role: "Administrateur", is_primary_admin: true,
      });
      if (memberErr) {
        // L'entreprise a bien été créée mais le rattachement a échoué — on la
        // supprime aussitôt plutôt que de laisser une entreprise orpheline, sans
        // aucun membre, invisible depuis nulle part sauf la liste brute de Super
        // Admin (exactement ce qui s'est produit la première fois : "Toris & co."
        // est resté créé mais totalement inaccessible).
        await supabase.from("companies").delete().eq("id", newCompanyId);
        throw new Error("La création de l'entreprise n'a pas pu aboutir (rien n'a été conservé). " + NET_MSG);
      }
      // Pré-remplit le nom dans les paramètres de l'entreprise (kv_store) avec celui
      // saisi ici — sans ça, le nom n'existe QUE dans companies.name (visible
      // seulement depuis Super Admin) ; le reste de l'app (barre latérale, factures,
      // Administration) lit settings.companyName, une donnée totalement séparée qui
      // resterait bloquée sur la valeur générique "Mon Entreprise" par défaut tant
      // que personne ne passe par l'écran de bienvenue (qui ne se déclenche pas ici).
      // Écrit directement pour CETTE entreprise précise (newCompanyId) plutôt que via
      // window.storage.set(), qui résoudrait encore l'ancienne entreprise en cache.
      try {
        await supabase.from("kv_store").upsert({
          company_id: newCompanyId, key: "compta-settings",
          value: JSON.stringify({ v: 1, data: { ...DEFAULT_SETTINGS, companyName: trimmedName } }),
          updated_at: new Date().toISOString(),
        }, { onConflict: "company_id,key" });
      } catch (e) { /* non bloquant — l'entreprise reste utilisable, juste avec le nom générique par défaut */ }
      showToast(`Entreprise « ${trimmedName} » créée.`);
      setShowCreateCompanyForm(false);
      setNewCompanyName("");
      setPlatformStats(null);
      // Remarque : cette application ne gère qu'une seule entreprise active par
      // session à la fois (pas de bascule en direct entre plusieurs entreprises).
      // Un rechargement est nécessaire pour que la nouvelle entreprise soit prise
      // en compte par la résolution de session normale.
      window.location.reload();
    } catch (e) {
      // Erreur affichée en alerte bloquante EN PLUS du toast (qui peut disparaître
      // sans être remarqué) — une erreur de création d'entreprise ne doit jamais
      // passer inaperçue, contrairement à ce qui s'est produit la première fois.
      window.alert("Échec de la création de l'entreprise.\n\n" + friendlyError(e));
      showToast(friendlyError(e));
    } finally {
      setCreatingCompany(false);
    }
  };
  // Code de sécurité d'entreprise (partagé, contrôlé uniquement par l'Administrateur
  // principal) : demandé une fois par session (pas à chaque navigation) — la
  // validation est mémorisée dans sessionStorage, propre à cet onglet/session, donc
  // redemandée à la prochaine vraie connexion.
  const [companyHasPin, setCompanyHasPin] = useState(false);
  const [companyPinCompanyId, setCompanyPinCompanyId] = useState(null);
  const [pinVerified, setPinVerified] = useState(false);
  // Assistant de contrôle : automatique, rattaché au forfait (Assisté ou Extension), jamais à un rôle.
  const assistantActive = planTier === "assisted" || !!groupId;
  const [assistantJump, setAssistantJump] = useState(0);
  const assistantAll = useMemo(() => {
    if (!assistantActive || !loaded) return [];
    let lastBackupAt = null;
    try { lastBackupAt = localStorage.getItem("compta-plus-last-export"); } catch (e) {}
    try { return asstScan({ entries, accounts, settings, today: todayStr(), hasSecurityPin: companyHasPin, lastBackupAt, products }); } catch (e) { return []; }
  }, [assistantActive, loaded, entries, accounts, settings, companyHasPin, products]);
  const assistantVisible = useMemo(() => assistantAll.filter((f) => !(settings.assistantIgnored || {})[f.key]), [assistantAll, settings.assistantIgnored]);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinChecking, setPinChecking] = useState(false);
  const [showSecurityPanel, setShowSecurityPanel] = useState(false);
  // Centre d'aide : fenêtre de discussion avec le support + pastilles de messages non
  // lus (réponses du support pour l'utilisateur ; nouvelles demandes pour l'équipe
  // de gestion). Déclarés ici, avant tout retour anticipé, comme tous les hooks de
  // ce composant. Toute erreur est ignorée en silence : un compteur qui échoue ne
  // doit jamais gêner le travail de quelqu'un.
  const [showHelpCenter, setShowHelpCenter] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [helpUnread, setHelpUnread] = useState(0);
  const [inboxUnreadApp, setInboxUnreadApp] = useState(0);
  const refreshHelpCounters = React.useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session && session.user && session.user.id;
      if (!uid) return;
      const cid = (_membership && _membership.companyId) || null;
      let mineQuery = supabase.from("support_messages").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("sender", "support").eq("read_by_user", false);
      mineQuery = cid ? mineQuery.eq("company_id", cid) : mineQuery.is("company_id", null);
      const mine = await mineQuery;
      if (!mine.error) setHelpUnread(mine.count || 0);
      if (isManagementCollaborator) {
        const inbox = await supabase.from("support_messages").select("id", { count: "exact", head: true }).eq("sender", "user").eq("read_by_support", false);
        if (!inbox.error) setInboxUnreadApp(inbox.count || 0);
      }
    } catch (e) {}
  }, [isManagementCollaborator]);
  useEffect(() => {
    refreshHelpCounters();
    const t = setInterval(() => { if (!document.hidden) refreshHelpCounters(); }, 60000);
    return () => clearInterval(t);
  }, [refreshHelpCounters]);
  const readOnly = role === "Lecture seule";
  const secteursActifs = secteursDroits(secteurs, { planTier, groupId, planStatus }).actifs;
  const ecolesActif = secteursActifs.includes("ecoles");
  const etabKind = ((ecole || []).find((r) => r && r.type === "etab") || {}).kind || "ecole"; // type d'établissement du bloc Éducation (noms des rôles)
  const ieActif = secteursActifs.includes("import_export");
  const santeActif = secteursActifs.includes("sante");
  const santeKind = ((sante || []).find((r) => r && r.type === "etab") || {}).kind || "cabinet"; // type d'établissement de santé (noms des rôles)
  const modulesDuRole = allowedModulesFor(role, settings); // null = accès à tous les modules
  // Secrétaire-caissier(ère) : le rôle Vendeur d'une école accède aussi au module Écoles (encaissements seulement, voir le module)
  const allowedModuleIds = modulesDuRole && role === "Vendeur" && (ecolesActif || santeActif) ? [...modulesDuRole, ...(ecolesActif ? ["ecole"] : []), ...(santeActif ? ["sante"] : [])] : modulesDuRole;
  // Espace de travail (entreprise qui a le secteur Écoles) : « École » met l'école en premier et replie les outils de commerce ;
  // « Commerce » donne l'espace habituel. Le choix est mémorisé sur cet appareil.
  const [espaceChoisi, setEspaceChoisi] = useState(() => { try { return localStorage.getItem("compta-plus-espace") || ""; } catch (e) { return ""; } });
  // Commerce (vente, stock, clients…) n'est proposé que si l'activité en dépend : import-export, pharmacie, ou entreprise sans secteur.
  // Éducation et santé hors pharmacie ont leurs propres outils de facturation et d'encaissement.
  const commerceUtile = ieActif || (santeActif && santeKind === "pharmacie") || (!ecolesActif && !santeActif);
  const espacesDispo = [...(ecolesActif ? ["ecole"] : []), ...(ieActif ? ["impex"] : []), ...(santeActif ? ["sante"] : []), ...(commerceUtile ? ["commerce"] : [])];
  const espace = espacesDispo.includes(espaceChoisi) ? espaceChoisi : espacesDispo[0];
  const choisirEspace = (e) => { setEspaceChoisi(e); try { localStorage.setItem("compta-plus-espace", e); } catch (x) {} };
  const ESPACE_ECOLE_MODULES = ["ecole", "caisse", "compta", "achat", "rh", "rapports", "admin", "gestion"];
  const ESPACE_SANTE_MODULES = ["sante", "caisse", "compta", "achat", "rh", "rapports", "admin", "gestion", ...(santeKind === "pharmacie" ? ["stock"] : [])];
  const ESPACE_ECOLE_LIBELLES = { achat: "Dépenses et fournisseurs", rh: "Salaires du personnel" };
  const modulesVisibles = MODULES.filter((m) => (!allowedModuleIds || allowedModuleIds.includes(m.id)) && (m.id !== "ecole" || (ecolesActif && espace === "ecole")) && (m.id !== "impex" || (ieActif && espace === "impex")) && (m.id !== "sante" || (santeActif && espace === "sante")) && (espace !== "ecole" || ESPACE_ECOLE_MODULES.includes(m.id)) && (espace !== "sante" || ESPACE_SANTE_MODULES.includes(m.id)))
    .sort((a, b) => (espace === "impex" ? (b.id === "impex") - (a.id === "impex") : espace === "sante" ? (b.id === "sante") - (a.id === "sante") : 0));
  // Contrôle de cohérence Facturation ↔ Journal calculé ici (niveau App), pas
  // seulement dans le module Comptabilité, pour que l'alerte soit visible dès la
  // connexion quel que soit le module ouvert — l'incident du 14/08 (91 factures
  // manquantes) n'a été repéré qu'en ouvrant Comptabilité par hasard, plusieurs
  // jours après son apparition réelle.
  const isReversalEntryTop = (e) => !!e.reversalOf || !!e.cancelledBy || (e.label && (e.label.startsWith("Annulation") || e.label.startsWith("Contrepassation")));
  const isCogsEntryTop = (e) => e.kind === "cogs" || e.label?.startsWith("Sortie de stock —") || (e.lines || []).some((l) => l.account === "6037" || l.account === "370");
  const activeSaleEntriesTop = entries.filter((e) => e.invoiceId && !isReversalEntryTop(e) && !isCogsEntryTop(e));
  const saleEntriesByInvoiceTop = {};
  activeSaleEntriesTop.forEach((e) => { (saleEntriesByInvoiceTop[e.invoiceId] = saleEntriesByInvoiceTop[e.invoiceId] || []).push(e); });
  const topReconciliationIssueCount =
    Object.values(saleEntriesByInvoiceTop).filter((list) => list.length > 1).length +
    Object.keys(saleEntriesByInvoiceTop).filter((invId) => !invoices.some((inv) => String(inv.id) === invId)).length +
    invoices.filter((inv) => inv.status !== "annulée" && inv.status !== "don" && inv.status !== "perte" && !saleEntriesByInvoiceTop[inv.id]).length;
  // Détection d'onglet dupliqué : plusieurs incidents de données passés (écritures
  // dupliquées ou factures manquantes) ont été retracés à DEUX onglets Compta+ ouverts
  // en même temps dans le même navigateur, chacun avec sa propre mémoire de version,
  // se désynchronisant l'un l'autre. Un seul onglet "propriétaire" bat un pouls dans
  // localStorage (partagé entre tous les onglets du même navigateur/origine) ; tout
  // second onglet se détecte non-propriétaire et affiche un écran de blocage plutôt
  // que de continuer à écrire des données en parallèle. Ne détecte que le cas
  // même-navigateur : deux appareils différents restent normalement pris en charge
  // par la synchronisation habituelle, ce n'est pas le même problème.
  const tabIdRef = React.useRef(uid());
  const [isDuplicateTab, setIsDuplicateTab] = useState(false);
  useEffect(() => {
    const KEY = "compta-plus-active-tab";
    const HEARTBEAT_MS = 2000;
    const STALE_MS = 5000;
    const readOwner = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } };
    const claim = () => { localStorage.setItem(KEY, JSON.stringify({ id: tabIdRef.current, ts: Date.now() })); setIsDuplicateTab(false); };
    const existing = readOwner();
    if (!existing || Date.now() - existing.ts > STALE_MS || existing.id === tabIdRef.current) {
      claim();
    } else {
      setIsDuplicateTab(true);
    }
    const heartbeat = setInterval(() => {
      const current = readOwner();
      if (current && current.id === tabIdRef.current) claim();
    }, HEARTBEAT_MS);
    const onStorage = (e) => {
      if (e.key !== KEY) return;
      let val; try { val = JSON.parse(e.newValue || "null"); } catch (err) { val = null; }
      if (val && val.id !== tabIdRef.current) setIsDuplicateTab(true);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      clearInterval(heartbeat);
      window.removeEventListener("storage", onStorage);
      const current = readOwner();
      if (current && current.id === tabIdRef.current) localStorage.removeItem(KEY);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const takeOverTab = () => {
    localStorage.setItem("compta-plus-active-tab", JSON.stringify({ id: tabIdRef.current, ts: Date.now() }));
    setIsDuplicateTab(false);
  };
  useEffect(() => {
    if (allowedModuleIds && !allowedModuleIds.includes(active)) setActive(allowedModuleIds[0]);
  }, [role, active, allowedModuleIds]);
  useEffect(() => {
    // espace École : l'accueil est le tableau de bord de l'école ; un module hors de l'espace choisi renvoie vers l'accueil de l'espace
    const accueil = espace === "ecole" && modulesVisibles.some((m) => m.id === "ecole") ? "ecole" : espace === "impex" && modulesVisibles.some((m) => m.id === "impex") ? "impex" : espace === "sante" && modulesVisibles.some((m) => m.id === "sante") ? "sante" : (allowedModuleIds ? allowedModuleIds[0] : "dashboard");
    if (active === "dashboard" && (espace === "ecole" || espace === "impex" || espace === "sante")) { setActive(accueil); return; }
    if (MODULES.some((m) => m.id === active) && !modulesVisibles.some((m) => m.id === active)) setActive(accueil);
  }, [espace, active, role, ecolesActif, ieActif, santeActif]);
  const [toast, setToast] = useState(null);
  const [syncErrorCategories, setSyncErrorCategories] = useState([]); // catégories dont la dernière sauvegarde a échoué
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const swipeTouchRef = React.useRef(null);
  const [installPrompt, setInstallPrompt] = useState(null);

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    const onInstalled = () => { window.__deferredInstall = null; setInstallPrompt(null); };
    // Le navigateur n'envoie l'invitation d'installation qu'une fois, souvent AVANT que
    // l'application soit prête : index.html la garde de côté (window.__deferredInstall) et on la
    // récupère ici, sinon le bouton « Installer » ne fonctionnerait jamais sur Android.
    if (window.__deferredInstall) setInstallPrompt(window.__deferredInstall);
    const onReady = () => { if (window.__deferredInstall) setInstallPrompt(window.__deferredInstall); };
    window.addEventListener("compta-plus-install-ready", onReady);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("compta-plus-install-ready", onReady);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  // --- Synchronisation multi-utilisateurs ---
  // Chaque catégorie de données a sa propre clé kv_store (au lieu d'un seul bloc
  // "compta-data" partagé) : deux utilisateurs qui modifient des modules différents
  // ne s'écrasent plus mutuellement. Pour les catégories qui sont des listes (tableaux
  // avec un "id" par élément), on fusionne avec le serveur avant chaque écriture au lieu
  // d'écraser — ainsi les ajouts faits par l'autre utilisateur entre-temps ne sont pas perdus.
  const settersByCategory = {
    accounts: setAccounts, entries: setEntries, products: setProducts,
    invoices: setInvoices, suppliers: setSuppliers, purchases: setPurchases,
    movements: setMovements, clients: setClients, settings: setSettings, users: setUsers,
    productImages: setProductImages, auditLog: setAuditLog,
    employees: setEmployees, payslips: setPayslips, salaryAdvances: setSalaryAdvances,
    salesStations: setSalesStations,
    assets: setAssets,
    accruals: setAccruals,
    deferrals: setDeferrals,
    riskProvisions: setRiskProvisions,
    loans: setLoans,
    entryTemplates: setEntryTemplates,
    pendingApprovals: setPendingApprovals,
    cheques: setCheques,
    bizdocs: setBizdocs,
    ecole: setEcole,
    impex: setImpex,
    sante: setSante,
  };
  const CATEGORIES = Object.keys(settersByCategory);

  // Instantané de la dernière version connue du serveur, par catégorie. Sert à
  // distinguer une suppression volontaire (l'élément était connu avant, il a disparu
  // localement) d'un élément simplement pas encore vu localement (ajouté ailleurs).
  // Sans ça, la fusion ne pouvait qu'ajouter des éléments, jamais en retirer : toute
  // suppression était annulée dès la sauvegarde suivante (l'élément "ressuscitait").
  const serverSnapshotRef = React.useRef({});

  // Fusionne deux tableaux d'objets par une clé unique en respectant les suppressions :
  // un élément présent dans "baseline" mais absent de "localArr" a été supprimé
  // volontairement et n'est jamais réintroduit, même s'il traîne encore côté serveur.
  // La clé dépend de la catégorie : les comptes n'ont pas de champ "id" (seulement
  // "code"), donc on ne peut pas toujours utiliser "id" — sinon tous les comptes sont
  // traités comme un seul et même élément et la liste s'effondre à un seul compte.
  const mergeByKey = (serverArr, localArr, keyFn, baselineArr) => {
    if (!Array.isArray(serverArr) || !Array.isArray(localArr)) return localArr;
    const baseline = Array.isArray(baselineArr) ? baselineArr : [];
    const keyOf = (item) => item && keyFn(item);
    const baselineKeys = new Set(baseline.map(keyOf).filter((k) => k !== undefined && k !== null));
    const localKeys = new Set(localArr.map(keyOf).filter((k) => k !== undefined && k !== null));
    const deletedKeys = new Set([...baselineKeys].filter((k) => !localKeys.has(k)));
    const map = new Map();
    serverArr.forEach((item) => {
      const k = keyOf(item);
      if (k !== undefined && k !== null && !deletedKeys.has(k)) map.set(k, item);
    });
    localArr.forEach((item) => {
      const k = keyOf(item);
      if (k !== undefined && k !== null) map.set(k, item);
    });
    return Array.from(map.values());
  };

  const MERGE_KEY_BY_CATEGORY = {
    accounts: (item) => item.code,
  };

  // File d'attente par catégorie : si plusieurs sauvegardes sont déclenchées coup sur
  // coup (ex. modifier un article puis en supprimer un autre juste après), chacune fait
  // un GET-fusion-SET qui n'est pas instantané. Sans sérialisation, une sauvegarde plus
  // ancienne peut se terminer APRÈS une plus récente et écraser son résultat — une
  // suppression pouvait ainsi être annulée par une sauvegarde partie juste avant elle.
  // En chaînant chaque sauvegarde après la précédente (pour la même catégorie), chacune
  // ne lit le serveur qu'une fois la précédente totalement terminée.
  const saveQueueRef = React.useRef({});
  // Dernier numéro de version connu localement, par catégorie. Chaque sauvegarde
  // incrémente ce numéro ; toute donnée reçue (chargement initial ou temps réel) avec un
  // numéro inférieur ou égal est ignorée sans ambiguïté, quel que soit le délai réseau.
  // Remplace un précédent système basé sur l'horloge (fenêtre de quelques secondes) qui
  // restait faillible en cas de réseau lent ou de plusieurs sauvegardes rapprochées.
  const knownVersionRef = React.useRef({});

  // Une valeur stockée peut être soit l'ancien format brut (juste le tableau/objet),
  // soit le nouveau format { v, data }. Cette fonction gère les deux de façon transparente.
  // Catégories dont la valeur est un objet (dictionnaire) plutôt qu'une liste, et qui ont
  // besoin d'une fusion clé par clé (plutôt qu'un simple remplacement) car plusieurs
  // appareils peuvent y ajouter des entrées différentes en parallèle — ex. les photos
  // produits, ajoutées depuis des appareils différents pour des produits différents.
  const OBJECT_MERGE_CATEGORIES = { productImages: true };

  const saveCategory = (category, value) => {
    if (role === "Vendeur" && !VENDEUR_WRITABLE_CATEGORIES.includes(category)) return;
    const previous = saveQueueRef.current[category] || Promise.resolve();
    const run = previous.then(async () => {
      try {
        let toSave = value;
        let serverV = 0;
        const res = await window.storage.get(`compta-${category}`).catch(() => null);
        if (res && res.value) {
          const { v, data: serverData } = unwrapVersioned(JSON.parse(res.value));
          serverV = v;
          if (Array.isArray(value)) {
            const serverValue = Array.isArray(serverData) ? serverData : [];
            const keyFn = MERGE_KEY_BY_CATEGORY[category] || ((item) => item.id);
            toSave = mergeByKey(serverValue, value, keyFn, serverSnapshotRef.current[category]);
            if (category === "products") {
              // Le stock est modifié côté serveur par les ventes (réservation atomique) sans
              // que cet appareil ne le sache tout de suite. Fusion à 3 voies sur le champ
              // « stock » : si cet appareil n'a PAS touché au stock d'un article depuis le
              // dernier état connu, mais que le serveur l'a fait évoluer, on garde la valeur
              // du serveur — sinon une sauvegarde partie avec un état local périmé (ex. 40)
              // écraserait le stock réel (ex. 25) déjà diminué par la vente.
              const baseArr = Array.isArray(serverSnapshotRef.current[category]) ? serverSnapshotRef.current[category] : [];
              const baseById = new Map(baseArr.map((x) => [x && x.id, x]));
              const serverById = new Map(serverValue.map((x) => [x && x.id, x]));
              toSave = toSave.map((item) => {
                const base = baseById.get(item.id);
                const srv = serverById.get(item.id);
                if (!base || !srv) return item;
                const localUntouched = (Number(item.stock) || 0) === (Number(base.stock) || 0);
                const serverMoved = (Number(srv.stock) || 0) !== (Number(base.stock) || 0);
                return localUntouched && serverMoved ? { ...item, stock: srv.stock } : item;
              });
            }
          } else if (OBJECT_MERGE_CATEGORIES[category] && value && typeof value === "object") {
            const serverObj = serverData && typeof serverData === "object" && !Array.isArray(serverData) ? serverData : {};
            const baselineObj = (serverSnapshotRef.current[category] && typeof serverSnapshotRef.current[category] === "object") ? serverSnapshotRef.current[category] : {};
            const merged = { ...serverObj };
            // Une clé présente dans le dernier instantané connu mais absente localement a
            // été volontairement retirée (ex. photo supprimée) : on ne la réintroduit pas.
            Object.keys(baselineObj).forEach((k) => { if (!(k in value)) delete merged[k]; });
            Object.assign(merged, value); // nos ajouts/modifications locales gagnent sur ces clés
            toSave = merged;
          }
        }
        // Le nouveau numéro dépasse à la fois ce que le serveur connaît ET ce qu'on a
        // nous-mêmes déjà vu, pour ne jamais reculer même en cas de sauvegardes rapprochées.
        const newV = Math.max(serverV, knownVersionRef.current[category] || 0) + 1;
        const saved = await window.storage.set(`compta-${category}`, JSON.stringify({ v: newV, data: toSave }));
        if (!saved) throw new Error("Écriture refusée par le serveur (résultat vide)");
        serverSnapshotRef.current[category] = toSave;
        knownVersionRef.current[category] = newV;
        try {
          const cidOk = _membership && _membership.companyId;
          if (cidOk) { hlCachePut(cidOk, category, { v: newV, data: toSave, at: Date.now() }); hlPendDel(cidOk, category); }
        } catch (e2) { /* le cache local ne doit jamais bloquer la sauvegarde */ }
        // Sauvegarde réussie : si cette catégorie était en échec, on l'efface de l'avertissement.
        setSyncErrorCategories((prev) => prev.filter((c) => c !== category));
      } catch (e) {
        // Refus volontaire de la base (règle métier : période clôturée, écriture déséquilibrée…) :
        // inutile de réessayer. On annule la modification locale, on recharge l'état réel et on
        // explique clairement la raison à l'utilisateur.
        const ruleMsg = ruleRefusalMessage(e);
        if (ruleMsg) {
          try { const cidR = _membership && _membership.companyId; if (cidR) hlPendDel(cidR, category); } catch (e2) { /* ignoré */ }
          try { await refreshCategoryFromServer(category, settersByCategory[category]); } catch (e3) { /* ignoré */ }
          setSyncErrorCategories((prev) => prev.filter((c) => c !== category));
          try { showToast(ruleMsg + " La modification a été annulée."); } catch (e4) { /* ignoré */ }
          return;
        }
        // CRITIQUE : ne jamais laisser un échec de sauvegarde passer inaperçu — sans ceci,
        // les données peuvent sembler enregistrées à l'écran alors qu'elles ne le sont pas
        // réellement côté serveur, avec un risque de perte définitive à la déconnexion.
        console.error(`Erreur d'enregistrement (${category})`, e);
        // Les modifications restent sur cet appareil (même après fermeture) jusqu'à la prochaine synchronisation réussie.
        try {
          const cidKo = _membership && _membership.companyId;
          if (cidKo) hlPendMark(cidKo, category, value, serverSnapshotRef.current[category], knownVersionRef.current[category]);
        } catch (e2) { /* ignoré */ }
        setSyncErrorCategories((prev) => (prev.includes(category) ? prev : [...prev, category]));
      }
    });
    // On garde la trace de cette exécution pour la suivante, sans jamais laisser une
    // erreur casser la chaîne (sinon toutes les sauvegardes suivantes resteraient bloquées).
    saveQueueRef.current[category] = run.catch(() => {});
    return run;
  };

  // Sauvegarde une catégorie PUIS vérifie directement côté serveur que le résultat
  // correspond bien à l'intention locale — retente une fois avec une référence
  // rafraîchie si un écart est détecté. Vient compléter la sauvegarde automatique
  // passive (useEffect) pour les opérations les plus sensibles où un retour en
  // arrière imprévu serait le plus gênant (ex. suppressions) — celles-ci ne
  // dépendent plus uniquement du minutage d'un effet et d'une fusion générique.
  const saveCategoryVerified = async (category, next, stillPresentCheck) => {
    await saveCategory(category, next);
    try {
      const check = await window.storage.get(`compta-${category}`).catch(() => null);
      if (check && check.value) {
        const { data: checkData } = unwrapVersioned(JSON.parse(check.value));
        if (Array.isArray(checkData) && stillPresentCheck(checkData)) {
          serverSnapshotRef.current[category] = checkData;
          await saveCategory(category, next);
        }
      }
    } catch (e) { /* la sauvegarde automatique passive (useEffect) prendra le relais */ }
  };

  // Relit une catégorie directement depuis le serveur et met à jour à la fois l'état
  // React ET la référence utilisée comme base de fusion — utile juste après une
  // opération RPC qui modifie déjà les données côté serveur (ex. ajustement de
  // stock), pour éviter qu'une mise à jour locale optimiste ne soit ensuite
  // écrasée par la sauvegarde automatique générique via une fusion basée sur une
  // référence pas encore à jour.
  const refreshCategoryFromServer = async (category, setter) => {
    const res = await window.storage.get(`compta-${category}`);
    const parsed = res?.value ? JSON.parse(res.value) : null;
    const { data } = unwrapVersioned(parsed);
    if (Array.isArray(data)) {
      setter(data);
      serverSnapshotRef.current[category] = data;
      return data;
    }
    return null;
  };

  // Vérification générique pour toute opération touchant PLUSIEURS catégories à la fois
  // (ex. une vente = produits + mouvements + écriture + facture). Ces catégories sont
  // sauvegardées indépendamment (pas de transaction atomique commune côté stockage), donc
  // un accroc réseau ponctuel peut faire réussir certaines et échouer d'autres sans le
  // moindre signal — exactement l'origine du bug "facture sans écriture" du 21-22/08.
  // Quelques secondes après l'opération (le temps que les sauvegardes passives se
  // terminent), on vérifie que chaque catégorie concernée contient bien l'élément attendu ;
  // sinon on retente une fois, puis — si ça échoue toujours — on avertit ET on journalise
  // l'anomalie dans l'Historique (module "Synchronisation"), pour qu'elle reste repérable
  // après coup même si personne n'a vu le message au moment où il est apparu.
  const verifyTransactionSaved = (transactionLabel, ops, { showToast, logAudit }) => {
    setTimeout(async () => {
      try {
        const checkPresence = async (op) => {
          const check = await window.storage.get(`compta-${op.category}`).catch(() => null);
          const data = check?.value ? unwrapVersioned(JSON.parse(check.value)).data : null;
          return Array.isArray(data) && op.isPresent(data);
        };
        const firstPass = await Promise.all(ops.map(async (op) => ({ op, present: await checkPresence(op) })));
        const missing = firstPass.filter((r) => !r.present).map((r) => r.op);
        if (missing.length === 0) return;
        await Promise.all(missing.map((op) => saveCategory(op.category, op.buildNext())));
        const secondPass = await Promise.all(missing.map(async (op) => ({ op, present: await checkPresence(op) })));
        const stillMissing = secondPass.filter((r) => !r.present).map((r) => r.op);
        if (stillMissing.length > 0) {
          const label = stillMissing.map((op) => op.label).join(", ");
          showToast("Une opération n'a pas pu être confirmée à cause d'un problème de connexion internet. Gardez la page ouverte : l'enregistrement reprend automatiquement dès que le réseau revient.");
          logAudit("Synchronisation", "Anomalie de synchronisation", `${transactionLabel} — non confirmé après nouvel essai : ${label}`);
        }
      } catch (e) { /* dernier filet : la sauvegarde passive (useEffect) reste active en arrière-plan */ }
    }, 4000);
  };

  useEffect(() => {
    perfMarkMount();
    (async () => {
      // Vérification explicite AVANT tout chargement de données : s'il faut demander
      // à l'utilisateur de choisir entre plusieurs entreprises, on s'arrête ici tout
      // de suite plutôt que de lancer des dizaines de requêtes avec un company_id
      // encore inconnu.
      try {
        const early = await resolveMembership();
        if (early.needsCompanyPick) {
          setCompanyPickOptions(early.options);
          return;
        }
      } catch (e) {
        // Une vraie erreur ici (pas seulement "plusieurs entreprises") sera de toute
        // façon re-levée par l'appel normal un peu plus bas, avec son message complet.
      }

      // Charge TOUTES les catégories en une seule requête groupée plutôt que 21
      // requêtes séparées et simultanées — élimine toute rafale de requêtes
      // concurrentes juste après la connexion (piste explorée suite à un
      // problème de déconnexion automatique en cours de diagnostic avec
      // Supabase), et accélère nettement le chargement dans tous les cas.
      const fetchAllCategories = async (attempts = 3) => {
        const keys = CATEGORIES.map((c) => `compta-${c}`);
        let lastErr = null;
        if (hlNetDown()) { attempts = 0; lastErr = new Error("OFFLINE"); }
        else if (hlMeta()) attempts = Math.min(attempts, 2);
        for (let i = 0; i < attempts; i++) {
          try {
            const { companyId } = await resolveMembership();
            const { data, error } = await oflTimeout(supabase.from("kv_store").select("key, value").eq("company_id", companyId).in("key", keys), hlMeta() ? 7000 : 30000);
            if (error) throw error;
            const byKey = {};
            (data || []).forEach((row) => { byKey[row.key] = row.value; });
            return { ok: true, byKey };
          } catch (e) {
            lastErr = e;
            if (i < attempts - 1) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
          }
        }
        // Repli : dernière version connue sur cet appareil, UNIQUEMENT si l'échec vient du réseau.
        if (oflIsNetworkError(lastErr)) {
          try {
            const cid = _membership && _membership.companyId;
            const cached = cid ? await hlCacheAll(cid) : {};
            const cats = Object.keys(cached);
            if (cats.length > 0) {
              const byKey = {};
              cats.forEach((c) => { const rec = cached[c]; if (rec && !rec.absent) byKey[`compta-${c}`] = JSON.stringify({ v: rec.v, data: rec.data }); });
              const at = Math.min(...cats.map((c) => cached[c].at || Date.now()));
              return { ok: true, byKey, fromCache: true, cachedCats: new Set(cats), cachedAt: at };
            }
          } catch (e) { /* pas de cache exploitable */ }
        }
        return { ok: false, byKey: null };
      };
      try {
        const { ok: allOk, byKey, fromCache, cachedCats, cachedAt } = await fetchAllCategories();
        if (fromCache) { offlineBootRef.current = true; setOfflineBootAt(cachedAt || null); }
        // Hors ligne : une catégorie jamais mise en cache n'est PAS considérée comme « vide » (on ne risque pas d'écraser le serveur avec des valeurs par défaut).
        const results = CATEGORIES.map((c) => ({ ok: allOk && !(fromCache && !cachedCats.has(c)), res: allOk && byKey[`compta-${c}`] !== undefined ? { value: byKey[`compta-${c}`] } : null }));
        let anyFound = false;
        results.forEach(({ ok, res }, i) => {
          const category = CATEGORIES[i];
          if (res && res.value !== undefined && res.value !== null) {
            anyFound = true;
            try {
              const { v, data } = unwrapVersioned(JSON.parse(res.value));
              // Migration douce : le régime "tva" (français) a été retiré au profit de
              // "iva" (Mexique) — une entreprise qui l'avait choisi avant ce changement
              // passe automatiquement sur "iva" en conservant son taux déjà configuré,
              // plutôt que de se retrouver avec un régime fiscal invalide au chargement.
              const migratedData = (category === "settings" && data && data.taxSystem === "tva") ? { ...data, taxSystem: "iva" } : data;
              settersByCategory[category](migratedData);
              serverSnapshotRef.current[category] = migratedData;
              knownVersionRef.current[category] = v;
              loadedCategoriesRef.current[category] = true;
            } catch (e) {
              // Réponse reçue mais illisible : ne pas marquer comme chargé, la
              // sauvegarde automatique de cette catégorie reste désactivée par sécurité.
            }
          } else if (ok) {
            // Requête réussie mais aucune valeur : cas légitime d'une toute nouvelle
            // entreprise sans données pour cette catégorie — la valeur de secours
            // locale (ex. DEFAULT_PRODUCTS) est alors la bonne base de départ à
            // sauvegarder normalement.
            loadedCategoriesRef.current[category] = true;
          } else {
            // Toutes les tentatives ont échoué : on NE sait PAS s'il y a de vraies
            // données côté serveur. La sauvegarde automatique de cette catégorie
            // reste désactivée pour cette session, et l'utilisateur est averti via
            // la bannière existante plutôt que de risquer d'écraser ses données.
            setSyncErrorCategories((prev) => (prev.includes(category) ? prev : [...prev, category]));
          }
        });
        // Cache local : on mémorise l'état connu de chaque catégorie pour pouvoir démarrer sans réseau.
        if (allOk && !fromCache) {
          try {
            const cid = _membership && _membership.companyId;
            if (cid) CATEGORIES.forEach((c) => {
              const raw = byKey[`compta-${c}`];
              if (raw !== undefined && raw !== null) { const { v, data } = unwrapVersioned(JSON.parse(raw)); hlCachePut(cid, c, { v, data, at: Date.now() }); }
              else hlCachePut(cid, c, { v: 0, data: null, absent: true, at: Date.now() });
            });
          } catch (e) { /* ignoré */ }
        }
        // Modifications faites hors ligne et jamais synchronisées : on les refusionne avec le serveur.
        try {
          const cid = _membership && _membership.companyId;
          const pend = cid ? await hlPendAll(cid) : {};
          let applied = 0; const conflicts = [];
          for (const cat of Object.keys(pend)) {
            if (!settersByCategory[cat] || !loadedCategoriesRef.current[cat]) continue;
            const keyFn = MERGE_KEY_BY_CATEGORY[cat] || ((item) => item.id);
            const r = hlOverlay(cat, serverSnapshotRef.current[cat], knownVersionRef.current[cat] || 0, pend[cat], keyFn);
            if (r.kind === "merged") { settersByCategory[cat](r.data); applied++; }
            else if (r.kind === "conflict") { conflicts.push(cat); await hlPendDel(cid, cat); }
            else await hlPendDel(cid, cat);
          }
          if (applied > 0) setHlNotice(`${applied} catégorie(s) de données modifiées hors ligne ont été rétablies${fromCache ? "" : " et vont être synchronisées"}.`);
          else if (conflicts.length > 0) setHlNotice("Des réglages modifiés hors ligne n'ont pas été appliqués : ils avaient été modifiés ailleurs entre-temps. Vérifiez vos réglages.");
        } catch (e) { /* ignoré : la sauvegarde habituelle reste active */ }
        // Migration : si aucune des nouvelles clés n'existe encore mais l'ancien bloc
        // unique "compta-data" en a, on le lit une seule fois pour ne rien perdre.
        if (!anyFound) {
          try {
            const old = await window.storage.get("compta-data");
            if (old && old.value) {
              const parsed = JSON.parse(old.value);
              CATEGORIES.forEach((c) => {
                if (parsed[c] !== undefined) {
                  settersByCategory[c](parsed[c]);
                  loadedCategoriesRef.current[c] = true;
                }
              });
            }
          } catch (e) {}
        }
      } catch (e) {
        // pas de données existantes
      }
      try {
        try { sessionStorage.removeItem("compta-plus-last-membership-error"); } catch (err) {}
        const membership = await resolveMembership();
        if (!offlineBootRef.current) hlSaveMeta(membership);
        // Ouverture à partir de l'identité mémorisée (réseau absent ou trop faible) : l'écran de choix entre blocs
        // (Groupe, Centre de gestion…) a besoin d'internet ; on ouvre directement l'entreprise mémorisée.
        if (offlineBootRef.current) setPlatformLanding(false);
        try { sessionStorage.setItem("compta-plus-reached-needs-welcome", membership.isNewCompany ? "oui" : "non-nouvelle-entreprise"); } catch (err) {}
        setRole(membership.role);
        setCurrentUserEmail(membership.email || "");
        setNeedsWelcome(!!membership.isNewCompany);
        // Suspension automatique : trial_ends_at sert de date de fin générique (fin
        // d'essai OU fin de la période active/payée en cours, fixée par le Super
        // Admin lors de l'activation). Si le compte est "active" mais que cette date
        // est dépassée, on le repasse localement (et côté base) à "suspended" pour
        // réinitialisation, sans attendre qu'un Super Admin s'en aperçoive.
        let effectiveStatus = membership.planStatus || "trial";
        if (!membership.groupId && effectiveStatus === "active" && membership.trialEndsAt && new Date(membership.trialEndsAt) < new Date()) {
          // Correction automatique réservée aux entreprises seules — pour une
          // entreprise membre d'un groupe, c'est le groupe qui gouverne son
          // propre statut ; lui seul doit être corrigé si besoin, jamais
          // l'entreprise membre elle-même.
          effectiveStatus = "suspended";
          try { await supabase.from("companies").update({ plan_status: "suspended" }).eq("id", membership.companyId); } catch (e) { /* le blocage local reste actif même si la synchro échoue */ }
        }
        setPlanStatus(effectiveStatus);
        setPlanTier(membership.planTier || "standard");
        if (membership.companyId) loadSecteursInfo(membership.companyId).then(setSecteurs);
        setIsAssistedSupervisor(!!membership.isAssistedSupervisor);
        setIsAccountant(!!membership.isAccountant);
        setCanAdjust(!!membership.isAccountant && !!membership.canAdjust);
        setCompanyCount(membership.companyCount || 1);
        if ((membership.planTier || "standard") === "assisted") loadPendingRecommendations(membership.companyId);
        setTrialEndsAt(membership.trialEndsAt || null);
        setGroupId(membership.groupId || null);
        setGroupName(membership.groupName || null);
        setGroupMaxCompanies(membership.groupMaxCompanies || null);
        setIsGroupOwner(!!membership.isGroupOwner);
        // L'atterrissage du propriétaire de groupe est désormais entièrement géré
        // par l'écran de blocs (voir plus bas, platformLanding) — plus aucune
        // redirection forcée ici, qui écraserait sinon le choix d'une entreprise
        // précise fait depuis le bouton "Ouvrir" du tableau de bord du groupe.
        if (!initialActiveSetRef.current) {
          initialActiveSetRef.current = true;
          // Raccourci "Salaires" depuis le tableau de bord du groupe : une fois
          // la session résolue sur la bonne entreprise, saute directement sur
          // le module demandé plutôt que sur le tableau de bord par défaut.
          try {
            const jumpTo = sessionStorage.getItem("compta_jump_to_module");
            if (jumpTo) { setActive(jumpTo); sessionStorage.removeItem("compta_jump_to_module"); }
          } catch (e) {}
        }
        setCompanyHasPin(!!membership.hasSecurityPin);
        setCompanyPinCompanyId(membership.companyId);
        try {
          // Ouverture hors ligne : le PIN a déjà été saisi en ligne sur cet appareil (moins de 7 jours) → pas de nouvelle saisie.
          const pinOffline = !!membership.hasSecurityPin && (offlineBootRef.current || hlOffline()) && hlPinValid(membership.companyId, membership.email);
          setPinVerified(pinOffline || sessionStorage.getItem("compta-plus-pin-verified-" + membership.companyId) === "true");
        } catch (e) { setPinVerified(false); }
        let pa = null;
        try {
          if (offlineBootRef.current || hlOffline()) throw new Error("hors ligne");
          const res = await oflTimeout(supabase.from("platform_admins").select("email").eq("email", membership.email).maybeSingle(), 8000);
          pa = res.data;
          setIsPlatformAdmin(!!pa);
        } catch (e) { /* table absente ou hors mode Supabase : pas admin plateforme */ }
        try {
          if (offlineBootRef.current || hlOffline()) throw new Error("hors ligne");
          const { data: mc } = await oflTimeout(supabase.from("management_collaborators").select("email").ilike("email", membership.email).maybeSingle(), 8000);
          setIsManagementCollaborator(!!mc || !!pa);
        } catch (e) { /* table absente : pas encore migrée, ou hors mode Supabase */ }
      } catch (e) {
        if (e?.message === "OFFLINE") {
          // Pas de connexion au moment de la vérification — on réessaie
          // automatiquement dès le retour du réseau (un simple rechargement
          // complet est le moyen le plus fiable de reprendre proprement tout le
          // processus de connexion) plutôt que d'afficher à tort l'écran de
          // déconnexion pour un souci réseau temporaire.
          await dlog("resolveMembership_offline", {});
          const retryOnReconnect = () => {
            window.removeEventListener("online", retryOnReconnect);
            window.location.reload();
          };
          window.addEventListener("online", retryOnReconnect);
          return;
        }
        if (oflIsNetworkError(e)) {
          // Connexion très faible (ou coupée) et aucune identité mémorisée utilisable : ce n'est pas un refus. On garde
          // l'écran d'attente et on réessaie tout seul (au retour du réseau et toutes les 15 secondes).
          await dlog("resolveMembership_network", { message: e?.message || String(e) });
          setNetWait(true);
          const retry = () => { window.removeEventListener("online", retry); window.location.reload(); };
          window.addEventListener("online", retry);
          setTimeout(retry, 15000);
          return;
        }
        // pas de session Supabase
        await dlog("resolveMembership_threw", { message: e?.message || String(e) });
        const msg = e?.message || String(e);
        setMembershipError(msg);
        // Persisté à part : si ce message a entraîné une déconnexion automatique
        // (ex. essai déjà utilisé sur cet appareil), App() démonte aussitôt et cet
        // état se perdrait — sessionStorage survit à ce remontage, pour que le
        // diagnostic sur l'écran de connexion puisse encore l'afficher.
        try { sessionStorage.setItem("compta-plus-last-membership-error", msg); } catch (err) {}
      }
      perfMarkReady();
      setLoaded(true);
    })();
  }, []);

  // Sauvegarde automatique hebdomadaire : contrôlée par un réglage d'ENTREPRISE (pas
  // un simple rappel local par appareil), pour respecter réellement l'intention de
  // l'Administrateur principal — activée ou non, elle s'applique alors à tous. Se
  // déclenche pour la première personne de l'équipe qui ouvre l'application après 7
  // jours révolus, peu importe son rôle (l'export ne contient rien qu'elle ne voit
  // déjà). Limite assumée et volontairement non cachée : ça ne s'exécute que si
  // quelqu'un ouvre réellement l'application cette semaine-là — pas un vrai
  // déclenchement en arrière-plan sans personne connectée.
  useEffect(() => {
    if (!loaded || !settings.autoBackupEnabled) return;
    const last = settings.lastAutoBackupAt ? new Date(settings.lastAutoBackupAt).getTime() : 0;
    const daysSince = (Date.now() - last) / 86400000;
    if (daysSince < 7) return;
    try {
      const data = { accounts, entries, products, productImages, invoices, suppliers, purchases, movements, clients, settings, users, employees, payslips, salaryAdvances, salesStations, assets, accruals, deferrals, riskProvisions, loans, entryTemplates, pendingApprovals, cheques, bizdocs, ecole, impex, sante };
      bkDownload(bkBuildFile(data, _membership && _membership.companyId, "Sauvegarde automatique hebdomadaire"), `sauvegarde-auto-${settings.companyName || "erp"}-${todayStr()}.json`);
      const now = new Date().toISOString();
      setSettings((prev) => ({ ...prev, lastAutoBackupAt: now }));
      try { localStorage.setItem("compta-plus-last-export", now); } catch (e) {}
      showToast("Sauvegarde automatique hebdomadaire générée.");
    } catch (e) { /* échec silencieux — pas grave, retenté à la prochaine ouverture */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, settings.autoBackupEnabled]);

  useEffect(() => { if (loaded && loadedCategoriesRef.current.accounts) saveCategory("accounts", accounts); }, [accounts, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.entries) saveCategory("entries", entries); }, [entries, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.products) saveCategory("products", products); }, [products, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.invoices) saveCategory("invoices", invoices); }, [invoices, loaded]);

  // Migration ponctuelle : les photos de produits enregistrées avant la séparation des
  // photos (stockées à l'époque directement dans chaque produit) sont déplacées une
  // seule fois vers le nouveau stockage séparé (productImages), pour continuer à
  // s'afficher sans que le catalogue ne redevienne trop lourd pour autant.
  const migratedImagesRef = React.useRef(false);
  useEffect(() => {
    if (!loaded || migratedImagesRef.current) return;
    const withInlineImage = products.filter((p) => p.image);
    if (withInlineImage.length === 0) { migratedImagesRef.current = true; return; }
    setProductImages((prev) => {
      const next = { ...prev };
      withInlineImage.forEach((p) => { if (!next[p.id]) next[p.id] = p.image; });
      return next;
    });
    setProducts((prev) => prev.map((p) => {
      if (!p.image) return p;
      const { image, ...rest } = p;
      return rest;
    }));
    migratedImagesRef.current = true;
  }, [loaded, products]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.suppliers) saveCategory("suppliers", suppliers); }, [suppliers, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.purchases) saveCategory("purchases", purchases); }, [purchases, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.movements) saveCategory("movements", movements); }, [movements, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.clients) saveCategory("clients", clients); }, [clients, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.settings) saveCategory("settings", settings); }, [settings, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.users) saveCategory("users", users); }, [users, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.productImages) saveCategory("productImages", productImages); }, [productImages, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.auditLog) saveCategory("auditLog", auditLog); }, [auditLog, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.employees) saveCategory("employees", employees); }, [employees, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.payslips) saveCategory("payslips", payslips); }, [payslips, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.salaryAdvances) saveCategory("salaryAdvances", salaryAdvances); }, [salaryAdvances, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.salesStations) saveCategory("salesStations", salesStations); }, [salesStations, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.assets) saveCategory("assets", assets); }, [assets, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.accruals) saveCategory("accruals", accruals); }, [accruals, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.deferrals) saveCategory("deferrals", deferrals); }, [deferrals, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.riskProvisions) saveCategory("riskProvisions", riskProvisions); }, [riskProvisions, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.loans) saveCategory("loans", loans); }, [loans, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.entryTemplates) saveCategory("entryTemplates", entryTemplates); }, [entryTemplates, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.pendingApprovals) saveCategory("pendingApprovals", pendingApprovals); }, [pendingApprovals, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.cheques) saveCategory("cheques", cheques); }, [cheques, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.bizdocs) saveCategory("bizdocs", bizdocs); }, [bizdocs, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.ecole) saveCategory("ecole", ecole); }, [ecole, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.impex) saveCategory("impex", impex); }, [impex, loaded]);
  useEffect(() => { if (loaded && loadedCategoriesRef.current.sante) saveCategory("sante", sante); }, [sante, loaded]);
  // Les entreprises existantes ont un plan comptable déjà enregistré : on y ajoute
  // une seule fois le compte 5112 (Chèques à encaisser) s'il manque.
  useEffect(() => {
    if (!loaded || !loadedCategoriesRef.current.accounts) return;
    if (!accounts.some((a) => a.code === "5112")) {
      setAccounts((prev) => (prev.some((a) => a.code === "5112") ? prev : [...prev, { code: "5112", name: "Chèques à encaisser", type: "Actif" }]));
    }
    // Comptes utilisés par la Gestion avancée (acomptes 419, notes de frais 421, avoirs fournisseurs 409).
    const missingBz = BZ_ACCOUNTS.filter((b) => !accounts.some((a) => a.code === b.code));
    if (missingBz.length > 0) {
      setAccounts((prev) => [...prev, ...missingBz.filter((b) => !prev.some((a) => a.code === b.code))]);
    }
  }, [loaded, accounts]);

  // Force une nouvelle tentative de sauvegarde immédiate pour toutes les catégories
  // en échec, plutôt que d'attendre la prochaine modification qui la déclencherait
  // normalement — utile en cas de coupure réseau ponctuelle.
  const [retrySaving, setRetrySaving] = useState(false);
  // Écoute l'événement envoyé par index.html quand le service worker détecte une
  // nouvelle version installée — affiche alors une bannière au lieu de laisser
  // silencieusement une ancienne version continuer de tourner dans cet onglet.
  const [updateAvailable, setUpdateAvailable] = useState(false);
  useEffect(() => {
    const handler = () => setUpdateAvailable(true);
    window.addEventListener("compta-plus-update-available", handler);
    return () => window.removeEventListener("compta-plus-update-available", handler);
  }, []);
  // Le rôle Vendeur n'a, par sécurité (policy côté serveur), le droit d'écrire QUE
  // ces 4 catégories. Un blocage sur toute autre catégorie pour ce rôle est une
  // restriction normale, pas une panne — on l'ignore ici pour ne pas alarmer
  // inutilement avec une bannière permanente et sans objet.
  const retryAllSavesRef = React.useRef(null);
  const visibleSyncErrorCategories = role === "Vendeur"
    ? syncErrorCategories.filter((c) => VENDEUR_WRITABLE_CATEGORIES.includes(c))
    : syncErrorCategories;
  // Tant que la bannière d'erreur de synchronisation est affichée, on retente
  // automatiquement en arrière-plan toutes les 20 secondes — sans ça, la bannière
  // restait affichée indéfiniment même après le retour de la connexion, tant que
  // l'utilisateur ne cliquait pas lui-même sur "Réessayer".
  useEffect(() => {
    if (visibleSyncErrorCategories.length === 0) return;
    // IMPORTANT : on appelle TOUJOURS la version la plus récente de retryAllSaves (via la référence) —
    // une version capturée à la création de l'intervalle contiendrait des listes périmées
    // (factures, écritures…) et, par la fusion « suppression volontaire », effacerait du serveur
    // les éléments ajoutés depuis (ex. ventes synchronisées après une coupure).
    const id = setInterval(() => { retryAllSavesRef.current && retryAllSavesRef.current(); }, 20000);
    return () => clearInterval(id);
  }, [visibleSyncErrorCategories.length]);
  // Empêche de fermer l'onglet ou de recharger la page tant qu'une sauvegarde
  // reste en échec — sans ça, un changement pas encore réellement enregistré côté
  // serveur (visible seulement en mémoire locale) disparaît silencieusement au
  // rechargement, avant même que le rattrapage automatique ci-dessus n'ait eu le
  // temps de le corriger tout seul.
  useEffect(() => {
    const handler = (e) => {
      if (window.__hlReloading) return;
      if (visibleSyncErrorCategories.length > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [visibleSyncErrorCategories.length]);
  // --- Vente hors ligne : synchronisation automatique de la file locale (voir oflSyncAll) ---
  const [oflCount, setOflCount] = useState(() => oflLoad().length);
  const runOflSyncRef = React.useRef(null);
  const runOflSync = async () => {
    if (!loaded) return;
    if (!["invoices", "entries", "products", "movements"].every((c) => loadedCategoriesRef.current[c])) return;
    const dataOf = (res) => (res && res.value ? unwrapVersioned(JSON.parse(res.value)).data : null);
    const ctx = {
      resolveMembership, supabase, unwrap: unwrapVersioned,
      storageGet: (k) => window.storage.get(k),
      refreshStock: async () => { await refreshCategoryFromServer("products", setProducts); await refreshCategoryFromServer("movements", setMovements); },
      applyLocalStock: (it) => {
        setProducts((prev) => prev.map((p) => { const l = (it.stockLines || []).find((x) => x.productId === p.id); return l ? { ...p, stock: Math.max(0, (Number(p.stock) || 0) - l.qty) } : p; }));
        setMovements((prev) => [...prev, ...(it.stockLines || []).map((l) => ({ id: uid(), invoiceId: it.invId, date: it.date, createdAt: new Date().toISOString(), productId: l.productId, productName: l.name, type: "sortie", qty: l.qty, reason: `Vente ${it.number}` }))]);
      },
      addSale: (fin) => {
        setEntries((prev) => prev.concat(fin.entries.filter((e) => !prev.some((x) => x.id === e.id))));
        setInvoices((prev) => (prev.some((i) => i.id === fin.invoice.id) ? prev : [...prev, fin.invoice]));
      },
      confirm: async (fin) => {
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          try {
            const [a, b] = await Promise.all([window.storage.get("compta-invoices"), window.storage.get("compta-entries")]);
            const inv = dataOf(a), ent = dataOf(b);
            if (Array.isArray(inv) && inv.some((x) => x.id === fin.invoice.id) && fin.entries.every((e) => Array.isArray(ent) && ent.some((x) => x.id === e.id))) return true;
          } catch (e) { /* nouvel essai */ }
        }
        return false;
      },
      // Filet de sécurité : quelques secondes après la synchronisation, on revérifie que la vente est
      // toujours bien présente sur le serveur (facture, écritures, mouvements de stock) ; sinon on la remet.
      verifyLater: (fin, it) => {
        [8000, 25000].forEach((delay) => setTimeout(async () => {
          try {
            const [a, b, c] = await Promise.all([window.storage.get("compta-invoices"), window.storage.get("compta-entries"), window.storage.get("compta-movements")]);
            const inv = dataOf(a), ent = dataOf(b), mov = dataOf(c);
            const invOk = Array.isArray(inv) && inv.some((x) => x.id === fin.invoice.id);
            const entOk = Array.isArray(ent) && fin.entries.every((e) => ent.some((x) => x.id === e.id));
            const movOk = !(it.stockLines || []).length || (Array.isArray(mov) && mov.some((m) => m.invoiceId === it.invId));
            if (invOk && entOk && movOk) return;
            if (!invOk || !entOk) {
              setEntries((prev) => prev.concat(fin.entries.filter((e) => !prev.some((x) => x.id === e.id))));
              setInvoices((prev) => (prev.some((i) => i.id === fin.invoice.id) ? prev : [...prev, fin.invoice]));
              setEntries((prev) => [...prev]); setInvoices((prev) => [...prev]);
            }
            if (!movOk) {
              setMovements((prev) => (prev.some((m) => m.invoiceId === it.invId) ? [...prev] : [...prev, ...(it.stockLines || []).map((l) => ({ id: uid(), invoiceId: it.invId, date: it.date, createdAt: new Date().toISOString(), productId: l.productId, productName: l.name, type: "sortie", qty: l.qty, reason: `Vente ${it.number}` }))]));
            }
          } catch (e) { /* réseau : la prochaine vérification ou la sauvegarde automatique reprendra */ }
        }, delay));
      },
      logAudit,
      invoicePrefix: invoicePrefix(settings),
    };
    const r = await oflSyncAll(ctx);
    if (r && r.done > 0) showToast(`${r.done} vente(s) hors ligne synchronisée(s) avec leur vrai numéro de facture${r.conflicts ? ` — ${r.conflicts} avec un stock insuffisant à vérifier (voir la facture)` : ""}.`);
    else if (r && r.failed > 0) showToast("Synchronisation des ventes hors ligne incomplète : nouvelle tentative automatique.");
  };
  runOflSyncRef.current = runOflSync;
  useEffect(() => {
    const upd = () => setOflCount(oflLoad().length);
    const onOnline = () => setTimeout(() => runOflSyncRef.current && runOflSyncRef.current(), 1500);
    const manual = () => runOflSyncRef.current && runOflSyncRef.current();
    window.addEventListener(OFL_EVT, upd); window.addEventListener("online", onOnline); window.addEventListener("compta-plus-ofl-sync", manual);
    return () => { window.removeEventListener(OFL_EVT, upd); window.removeEventListener("online", onOnline); window.removeEventListener("compta-plus-ofl-sync", manual); };
  }, []);
  useEffect(() => {
    if (!loaded || oflCount === 0) return;
    const first = setTimeout(() => runOflSyncRef.current && runOflSyncRef.current(), 800);
    const id = setInterval(() => { if (navigator.onLine !== false) runOflSyncRef.current && runOflSyncRef.current(); }, 30000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [loaded, oflCount]);
  const retryAllSaves = async () => {
    setRetrySaving(true);
    const values = {
      accounts, entries, products, invoices, suppliers, purchases,
      movements, clients, settings, users, productImages, auditLog,
      employees, payslips, salaryAdvances, salesStations, assets, accruals, deferrals, riskProvisions, loans, entryTemplates, pendingApprovals, cheques, bizdocs, ecole, impex, sante,
    };
    await Promise.all(Object.entries(values).map(async ([cat, val]) => {
      if (role === "Vendeur" && !VENDEUR_WRITABLE_CATEGORIES.includes(cat)) return;
      if (!loadedCategoriesRef.current[cat]) {
        // Cette catégorie n'a jamais été confirmée chargée depuis le serveur : on
        // RECHARGE d'abord (jamais d'écrasement à l'aveugle avec une valeur de secours
        // locale potentiellement fausse, comme le catalogue par défaut).
        try {
          const res = await window.storage.get(`compta-${cat}`);
          if (res && res.value !== undefined && res.value !== null) {
            const { v, data } = unwrapVersioned(JSON.parse(res.value));
            settersByCategory[cat](data);
            serverSnapshotRef.current[cat] = data;
            knownVersionRef.current[cat] = v;
          }
          loadedCategoriesRef.current[cat] = true;
          setSyncErrorCategories((prev) => prev.filter((c) => c !== cat));
        } catch (e) {
          return; // toujours indisponible : on ne tente pas de sauvegarde cette fois
        }
      } else {
        await saveCategory(cat, val);
      }
    }));
    setRetrySaving(false);
    if (syncErrorCategories.length === 0) showToast("Sauvegarde réussie — toutes les données sont synchronisées.");
    else showToast("La sauvegarde a encore échoué pour certaines données — vérifiez votre connexion internet.");
  };
  retryAllSavesRef.current = retryAllSaves;

  // Enregistre une action dans le journal des modifications : qui, où (module), quoi
  // (action), et le détail. Passé aux modules qui ont besoin de tracer leurs actions.
  const logAudit = (module, action, details) => {
    setAuditLog((prev) => [
      ...prev,
      { id: uid(), date: new Date().toISOString(), user: currentUserEmail || "Inconnu", module, action, details: details || "" },
    ]);
  };

  // Synchronisation en temps réel : quand l'autre utilisateur enregistre une donnée,
  // ce navigateur la reçoit immédiatement sans avoir besoin de recharger la page.
  useEffect(() => {
    if (!loaded) return;
    let channel;
    (async () => {
      try {
        const { companyId } = await resolveMembership();
        channel = supabase
          .channel(`kv_store_changes_${companyId}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "kv_store", filter: `company_id=eq.${companyId}` },
            (payload) => {
              const row = payload.new || payload.old;
              if (!row || !row.key || !row.key.startsWith("compta-")) return;
              const category = row.key.replace("compta-", "");
              const setter = settersByCategory[category];
              if (!setter || row.value === undefined || row.value === null) return;
              try {
                const { v, data } = unwrapVersioned(JSON.parse(row.value));
                // Rejet strict : si ce qu'on reçoit n'est pas plus récent que ce qu'on
                // connaît déjà, on l'ignore. Contrairement à une fenêtre de délai, ceci
                // ne peut jamais se tromper, quelle que soit la latence réseau.
                if (v <= (knownVersionRef.current[category] || 0)) return;
                setter(data);
                serverSnapshotRef.current[category] = data;
                knownVersionRef.current[category] = v;
                try { hlCachePut(companyId, category, { v, data, at: Date.now() }); } catch (e2) { /* ignoré */ }
              } catch (e) {}
            }
          )
          .subscribe();
      } catch (e) {
        // pas de session Supabase, pas de temps réel possible
      }
    })();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [loaded]);

  // Applique la devise choisie dans les paramètres à toutes les mises en forme monétaires
  CURRENT_CURRENCY = settings.currency || "HTG";

  const showToast = (msg) => {
    msg = sanitizeUserMessage(msg);
    setToast(msg);
    // Durée adaptée à la longueur du message : un texte d'anomalie détaillé (avec
    // orientation vers un comptable) a besoin de bien plus de temps de lecture
    // qu'une simple confirmation ("Écriture enregistrée."). Plancher 2.2s (comme
    // avant), plafond 9s pour ne pas bloquer l'écran indéfiniment.
    const duration = Math.min(9000, Math.max(2200, msg.length * 60));
    setTimeout(() => setToast(null), duration);
  };
  useEffect(() => {
    try {
      const t = Number(sessionStorage.getItem("pj-pick") || 0);
      if (!t) return;
      sessionStorage.removeItem("pj-pick"); sessionStorage.removeItem("pj-busy");
      if (Date.now() - t < 600000) { const tr = pjTraceText().split("\n").pop(); setTimeout(() => showToast("La page s'est rechargée pendant l'envoi d'une pièce" + (tr ? " (dernière étape : " + tr.replace(/^\d\d:\d\d:\d\d /, "") + ")" : "") + ". Le journal du dernier envoi est affiché sous le champ de fichier."), 1500); }
    } catch (e) { /* ignoré */ }
  }, []);

  // Chantier H — message de reprise des modifications hors ligne
  useEffect(() => { if (loaded && hlNotice) { showToast(hlNotice); setHlNotice(null); } }, [loaded, hlNotice]);
  // Chantier H — nombre de catégories modifiées hors ligne et pas encore synchronisées (bandeau)
  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    const refresh = async () => {
      const cid = _membership && _membership.companyId;
      if (!cid) return;
      const keys = await hlKeys(`pend:${cid}:`);
      if (alive) setHlPendingCats(keys.map((k) => k.slice(`pend:${cid}:`.length)));
    };
    refresh();
    window.addEventListener(HL_EVT, refresh);
    const id = setInterval(refresh, 8000);
    return () => { alive = false; window.removeEventListener(HL_EVT, refresh); clearInterval(id); };
  }, [loaded]);
  // Chantier H — après un démarrage sans réseau, on recharge proprement dès le retour du réseau
  // (les modifications sont déjà gardées sur l'appareil et seront rejouées au redémarrage).
  useEffect(() => {
    if (!loaded || !offlineBootRef.current) return;
    let done = false;
    const go = () => { if (done) return; done = true; setTimeout(() => { window.__hlReloading = true; window.location.reload(); }, 1500); };
    window.addEventListener("online", go);
    // Réseau « revenu mais instable » : l'événement peut ne jamais arriver ; on sonde le serveur toutes les 15 s.
    const probe = setInterval(async () => {
      if (hlOffline()) return;
      try {
        const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
        const t = ctl ? setTimeout(() => ctl.abort(), 5000) : null;
        await fetch(SUPABASE_URL + "/auth/v1/health", { mode: "no-cors", cache: "no-store", signal: ctl ? ctl.signal : undefined });
        if (t) clearTimeout(t);
        go();
      } catch (e) { /* toujours injoignable */ }
    }, 15000);
    return () => { window.removeEventListener("online", go); clearInterval(probe); };
  }, [loaded]);

  const balances = useMemo(() => computeBalances(accounts, entries), [accounts, entries]);
  const kpis = useMemo(() => computeKpis(accounts, balances), [accounts, balances]);

  const chartData = useMemo(() => {
    const byMonth = {};
    entries.forEach((e) => {
      const sortKey = (e.date || "").slice(0, 7); // "AAAA-MM", trie chronologiquement de façon fiable
      const key = monthLabel(e.date);
      if (!byMonth[sortKey]) byMonth[sortKey] = { sortKey, mois: key, produits: 0, charges: 0 };
      (e.lines || []).forEach((l) => {
        const acc = accounts.find((a) => a.code === l.account);
        // Montant NET (pas seulement un côté de l'écriture), pour rester cohérent avec
        // le calcul des cartes du tableau de bord — sinon une vente ou une charge
        // contrepassée reste comptée en entier ici alors qu'elle est correctement
        // neutralisée là-bas, gonflant le graphique par rapport aux vrais totaux.
        if (acc?.type === "Produit") byMonth[sortKey].produits += Number(l.credit || 0) - Number(l.debit || 0);
        if (acc?.type === "Charge") byMonth[sortKey].charges += Number(l.debit || 0) - Number(l.credit || 0);
      });
    });
    return Object.values(byMonth).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [entries, accounts]);

  // Indicateur de croissance : variation du chiffre d'affaires (Produits) d'un mois sur
  // l'autre, en montant (HTG/devise courante) et en pourcentage. Le tout premier mois
  // connu n'a rien à comparer et n'apparaît donc pas dans cette série.
  const growthData = useMemo(() => {
    return chartData.slice(1).map((m, i) => {
      const prev = chartData[i]; // chartData[i] correspond au mois précédent de chartData.slice(1)[i]
      const delta = m.produits - prev.produits;
      const pct = prev.produits !== 0 ? (delta / prev.produits) * 100 : null;
      return { mois: m.mois, croissance: delta, pct };
    });
  }, [chartData]);
  const latestGrowth = growthData.length ? growthData[growthData.length - 1] : null;

  // Deux blocs distincts mais cohabitant dans la même application : le bloc
  // "Plateforme" (Super Admin) et le bloc "Entreprise" (les 9 modules comptables).
  // isBlocked ne s'applique JAMAIS au bloc Plateforme, quel que soit le statut
  // d'abonnement de l'entreprise du compte connecté — un administrateur de la
  // plateforme garde toujours un accès total à Super Admin. Le bloc Entreprise,
  // lui, reste normalement soumis au blocage, y compris pour ce même compte s'il
  // essaie d'utiliser les modules comptables de sa propre entreprise suspendue.
  const isBlocked = planStatus === "suspended" || (planStatus === "trial" && trialEndsAt && new Date(trialEndsAt) < new Date());
  const trialDaysLeft = trialEndsAt ? Math.max(0, Math.ceil((new Date(trialEndsAt) - new Date()) / 86400000)) : null;
  const [monCashLoading, setMonCashLoading] = useState(false);
  const [monCashError, setMonCashError] = useState("");
  const [unavailablePayment, setUnavailablePayment] = useState("");
  const [htgRate, setHtgRate] = useState(null);
  useEffect(() => {
    if (!isBlocked) return;
    fetchHtgPerUsd().then((rate) => setHtgRate(rate)); // null si indisponible : on utilisera le repli
  }, [isBlocked]);
  const monCashAmount = settings.subscriptionPriceUSD
    ? Math.round((Number(settings.subscriptionPriceUSD) * (htgRate || FALLBACK_HTG_PER_USD)) / 10) * 10
    : (settings.subscriptionPriceHTG || 2600);
  // targetTier absent = simple renouvellement du forfait en cours (comportement
  // inchangé) ; précisé = mise à niveau/rétrogradation vers ce forfait, appliquée
  // côté serveur par la fonction moncash une fois le paiement confirmé.
  const payWithMonCash = async (targetTier) => {
    setMonCashLoading(true);
    setMonCashError("");
    try {
      const { companyId } = await resolveMembership();
      const amount = targetTier
        ? Math.round((PLAN_TIER_INFO[targetTier].priceUSD * (htgRate || FALLBACK_HTG_PER_USD)) / 10) * 10
        : monCashAmount;
      const { data: { session: s } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/moncash?action=create`, {
        method: "POST",
        headers: { Authorization: `Bearer ${s.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, amount, ...(targetTier ? { targetTier } : {}) }),
      });
      const data = await res.json();
      if (!res.ok || !data.redirectUrl) throw new Error(data.error || "Réponse invalide du service de paiement");
      window.location.href = data.redirectUrl;
    } catch (e) {
      setMonCashError(friendlyError(e));
      setMonCashLoading(false);
    }
  };

  // Au retour de la page de paiement MonCash, vérifie automatiquement le résultat.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get("orderId") || params.get("order_id") || params.get("transactionId") || params.get("transaction_id");
    if (!orderId) return;
    (async () => {
      try {
        const { companyId } = await resolveMembership();
        const { data: { session: s } } = await supabase.auth.getSession();
        const res = await fetch(`${SUPABASE_URL}/functions/v1/moncash?action=verify`, {
          method: "POST",
          headers: { Authorization: `Bearer ${s.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, companyId }),
        });
        const data = await res.json();
        if (data.ok) {
          setPlanStatus("active");
          if (data.appliedTier) {
            showToast(`Paiement confirmé — vous êtes maintenant au forfait ${PLAN_TIER_INFO[data.appliedTier].label} !`);
            clearMembershipCache();
            window.location.reload();
            return;
          }
          if (data.groupCreated) {
            showToast("Paiement confirmé — votre groupe multi-entreprises est prêt !");
            clearMembershipCache();
            window.location.reload();
            return;
          }
          showToast("Paiement MonCash confirmé — votre compte est activé !");
        } else {
          showToast("Paiement MonCash non confirmé pour le moment. Contactez le support si le montant a bien été débité.");
        }
      } catch (e) { /* silencieux : l'utilisateur peut réessayer via le bouton */ }
      window.history.replaceState({}, "", window.location.pathname);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [welcomeName, setWelcomeName] = useState("");
  // Verrou synchrone (une ref, pas un state — qui ne serait mis à jour qu'au
  // rendu suivant, trop tard pour empêcher un second déclenchement immédiat)
  // contre toute double soumission de l'inscription (double-clic, ou Entrée
  // suivie d'un clic) — c'est ce qui causait la création de deux groupes
  // identiques en une fraction de seconde.
  const welcomeSubmittingRef = React.useRef(false);
  const [welcomeSubmitting, setWelcomeSubmitting] = useState(false);
  const [welcomeError, setWelcomeError] = useState("");
  const [welcomeTier, setWelcomeTier] = useState("standard"); // "standard" | "assisted"
  // Cabinet d'expertise comptable autonome : inscription sans créer d'entreprise, validée par le Centre de gestion.
  const [welcomeMode, setWelcomeMode] = useState("entreprise"); // "entreprise" | "cabinet"
  const [cabinetRow, setCabinetRow] = useState(null); // demande de cabinet déjà déposée par cette adresse
  const [cabForm, setCabForm] = useState({ name: "", phone: "", city: "" });
  const [cabSubmitting, setCabSubmitting] = useState(false);
  useEffect(() => {
    if (!needsWelcome || !currentUserEmail) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.from("cabinets").select("*").ilike("owner_email", currentUserEmail).limit(1);
        if (!cancelled && !error && data && data[0]) setCabinetRow(data[0]);
      } catch (e) { /* table absente : inscription cabinet non disponible, écran habituel */ }
    })();
    return () => { cancelled = true; };
  }, [needsWelcome, currentUserEmail]);
  const submitCabinet = async () => {
    if (cabSubmitting) return;
    const name = cabForm.name.trim();
    if (!name) { showToast("Le nom du cabinet est obligatoire."); return; }
    setCabSubmitting(true);
    try {
      const { data: { user: cu } } = await supabase.auth.getUser();
      const row = { name: name.slice(0, 200), owner_email: String(currentUserEmail || cu?.email || "").toLowerCase(), owner_user_id: cu?.id || null, phone: cabForm.phone.trim() || null, city: cabForm.city.trim() || null, status: "pending" };
      const { data, error } = await supabase.from("cabinets").insert(row).select("*");
      if (error) {
        if (error.code === "23505") {
          const ex = await supabase.from("cabinets").select("*").ilike("owner_email", row.owner_email).limit(1);
          if (ex.data && ex.data[0]) { setCabinetRow(ex.data[0]); return; }
        }
        showToast("Impossible d'enregistrer votre cabinet pour le moment. " + NET_MSG);
        return;
      }
      setCabinetRow((data && data[0]) || { ...row, created_at: new Date().toISOString() });
    } catch (e) {
      showToast("Impossible d'enregistrer votre cabinet pour le moment. " + NET_MSG);
    } finally { setCabSubmitting(false); }
  };
  // Crée le groupe (essai gratuit de 30 jours) pour une entreprise qui vient
  // de choisir le forfait Extension à l'inscription — isolée ici pour être
  // utilisée de façon identique quel que soit le chemin emprunté par
  // submitWelcome(). Ne lève jamais d'exception : un échec est journalisé et
  // signalé par un toast, mais ne doit jamais bloquer la création de
  // l'entreprise elle-même, déjà acquise à ce stade.
  const createGroupForNewCompany = async (companyId, baseName) => {
    try {
      const { data: { user: newUser } } = await supabase.auth.getUser();
      if (!newUser) return null;
      const newGroupId = crypto.randomUUID();
      const groupName = `Groupe ${baseName}`;
      const { error: grpErr } = await supabase.from("company_groups").insert({
        id: newGroupId, owner_user_id: newUser.id, owner_email: newUser.email,
        name: groupName, plan_status: "trial",
        trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), max_companies: 5,
      });
      if (grpErr) {
        showToast("Entreprise créée, mais le groupe n'a pas pu être mis en place pour le moment. Contactez le support — votre essai Extension reste acquis.");
        logClientError("welcome_group_insert_failed: " + grpErr.message, JSON.stringify(grpErr), window.location.href);
        return null;
      }
      await supabase.from("companies").update({ group_id: newGroupId }).eq("id", companyId);
      return { groupId: newGroupId, groupName, groupMaxCompanies: 5 };
    } catch (grpEx) {
      showToast("Entreprise créée, mais le groupe n'a pas pu être mis en place — contactez le support, votre essai Extension reste acquis.");
      logClientError("welcome_group_creation_exception: " + String(grpEx), String(grpEx && grpEx.stack || ""), window.location.href);
      return null;
    }
  };

  // Crée le groupe SEUL, sans aucune entreprise rattachée — le vrai point
  // d'entrée du forfait Extension à l'inscription. Les entreprises seront
  // créées ou rattachées ensuite, depuis le tableau de bord du groupe
  // lui-même (mécanisme déjà existant et éprouvé), jamais automatiquement ici.
  const createStandaloneGroup = async (groupName) => {
    try {
      const { data: { user: newUser } } = await supabase.auth.getUser();
      if (!newUser) return null;
      const newGroupId = crypto.randomUUID();
      const { error: grpErr } = await supabase.from("company_groups").insert({
        id: newGroupId, owner_user_id: newUser.id, owner_email: newUser.email,
        name: groupName, plan_status: "trial",
        trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), max_companies: 5,
      });
      if (grpErr) {
        showToast("Le groupe n'a pas pu être créé pour le moment. " + NET_MSG);
        logClientError("welcome_standalone_group_insert_failed: " + grpErr.message, JSON.stringify(grpErr), window.location.href);
        return null;
      }
      return { groupId: newGroupId, groupName, groupMaxCompanies: 5 };
    } catch (grpEx) {
      showToast("Le groupe n'a pas pu être créé — contactez le support.");
      logClientError("welcome_standalone_group_exception: " + String(grpEx), String(grpEx && grpEx.stack || ""), window.location.href);
      return null;
    }
  };

  const submitWelcome = async () => {
    // Vérification ET pose du verrou en une seule ligne, de façon synchrone —
    // un second déclenchement immédiat (double-clic...) le trouve déjà posé
    // et s'arrête ici, avant même de commencer quoi que ce soit.
    if (welcomeSubmittingRef.current) return;
    welcomeSubmittingRef.current = true;
    setWelcomeSubmitting(true);
    const name = welcomeName.trim();
    if (!name) {
      showToast("Le nom de l'entreprise est obligatoire pour continuer — il permet d'identifier votre entreprise parmi les autres.");
      welcomeSubmittingRef.current = false;
      setWelcomeSubmitting(false);
      return;
    }
    try {
      const current = await resolveMembership();
      if (current.pendingCreation && welcomeTier === "group") {
        // Forfait Extension : crée UNIQUEMENT le groupe, jamais d'entreprise par
        // défaut — le nom saisi devient celui du groupe. Les entreprises seront
        // créées ou rattachées ensuite, depuis le tableau de bord du groupe
        // lui-même (mécanisme déjà existant), jamais automatiquement ici. Ça
        // élimine la double logique fragile de création simultanée, à l'origine
        // des groupes en double rencontrés plus tôt.
        // Règle des essais gratuits (2 par adresse email) : la création d'un groupe compte comme
        // un essai, vérifié et enregistré côté serveur avant toute création.
        let groupDeviceId = null;
        try {
          groupDeviceId = localStorage.getItem("compta-plus-device-id");
          if (!groupDeviceId) { groupDeviceId = genInviteToken(); localStorage.setItem("compta-plus-device-id", groupDeviceId); }
        } catch (e) {}
        const { data: chk, error: chkError } = await invokeEdgeFunction("create-company", { deviceId: groupDeviceId, companyName: name, checkOnly: true });
        if (chkError) {
          if (/essai|support@|d[ée]j[àa] utilis/i.test(String(chkError))) setWelcomeError(String(chkError));
          else showToast("Impossible de créer votre groupe pour le moment. " + NET_MSG);
          return;
        }
        if (!chk || chk.allowed !== true) {
          showToast("Impossible de créer votre groupe pour le moment. " + NET_MSG);
          return;
        }
        setWelcomeError("");
        const grp = await createStandaloneGroup(name);
        if (!grp) { return; }
        try { localStorage.setItem("compta-plus-trial-used", new Date().toISOString()); } catch (e) {}
        const { data: { user: newUser } } = await supabase.auth.getUser();
        _membership = {
          companyId: null, role: null, email: newUser?.email || current.email,
          companyName: null, planStatus: "trial", planTier: "assisted", trialEndsAt: null,
          isNewCompany: false, hasSecurityPin: false,
          groupId: grp.groupId, groupName: grp.groupName, groupMaxCompanies: grp.groupMaxCompanies, isGroupOwner: true,
        };
        setGroupId(grp.groupId); setGroupName(grp.groupName); setGroupMaxCompanies(grp.groupMaxCompanies);
        setIsGroupOwner(true);
        setPlanTier("assisted");
        setNeedsWelcome(false);
        setPlatformLanding(false);
        setActive("groupdashboard");
        return;
      }
      if (current.pendingCreation) {
        // Rien n'a encore été créé en base jusqu'ici (voir resolveMembershipInner) —
        // c'est cette soumission, avec le vrai nom choisi, qui déclenche la
        // création réelle de l'entreprise, en un seul appel serveur.
        let deviceId = null;
        try {
          deviceId = localStorage.getItem("compta-plus-device-id");
          if (!deviceId) { deviceId = genInviteToken(); localStorage.setItem("compta-plus-device-id", deviceId); }
        } catch (e) {}
        const { data: createResult, error: createError } = await invokeEdgeFunction("create-company", { deviceId, companyName: name });
        if (createError) {
          if (/essai|support@|d[ée]j[àa] utilis/i.test(String(createError))) {
            // Refus volontaire du serveur (limite d'essais, adresse temporaire…) : message clair et durable.
            setWelcomeError(String(createError));
          } else {
            showToast("Impossible de créer votre entreprise pour le moment. " + NET_MSG);
          }
          return;
        }
        setWelcomeError("");
        try { localStorage.setItem("compta-plus-trial-used", new Date().toISOString()); } catch (e) {}
        // Le forfait Extension inclut toujours les fonctionnalités Assisté — c'est
        // le forfait le plus complet, aucune raison de le limiter au niveau Standard.
        const effectiveTier = welcomeTier === "group" ? "assisted" : welcomeTier;
        let newGroupId = null;
        _membership = {
          companyId: createResult.companyId, role: createResult.role || "Administrateur", email: createResult.email || current.email,
          companyName: createResult.companyName || name, planStatus: "trial", planTier: effectiveTier, trialEndsAt: createResult.trialEndsAt,
          isNewCompany: !createResult.alreadyExisted, hasSecurityPin: false,
        };
        if (createResult.alreadyExisted) {
          // Créée entre-temps par un autre onglet/tentative : on rejoint cette
          // entreprise existante plutôt que d'en avoir créé une seconde pour rien.
          setSettings({ ...settings, companyName: _membership.companyName });
        } else {
          await supabase.from("companies").update({ plan_tier: effectiveTier }).eq("id", createResult.companyId);
          setSettings({ ...settings, companyName: name });
          if (welcomeTier === "group") {
            const grp = await createGroupForNewCompany(createResult.companyId, name);
            if (grp) {
              newGroupId = grp.groupId;
              _membership.groupId = grp.groupId;
              _membership.groupName = grp.groupName;
              _membership.groupMaxCompanies = grp.groupMaxCompanies;
            }
          }
        }
        setPlanTier(effectiveTier);
        if (newGroupId) { setGroupId(newGroupId); setGroupName(`Groupe ${name}`); setGroupMaxCompanies(5); }
        setNeedsWelcome(false);
        return;
      }

      const { companyId } = current;
      // Unicité du nom (insensible à la casse/espaces) : vérifiée ici plutôt qu'à la
      // création technique de l'entreprise, puisque c'est le moment où l'utilisateur
      // choisit réellement le nom définitif — le nom généré automatiquement à
      // l'inscription n'est qu'un espace réservé temporaire.
      const { data: clash } = await supabase
        .from("companies")
        .select("id")
        .ilike("name", name)
        .neq("id", companyId)
        .maybeSingle();
      if (clash) {
        showToast(`Le nom « ${name} » est déjà utilisé par une autre entreprise — choisissez-en un autre.`);
        return;
      }
      // Le forfait choisi s'applique dès maintenant, sans frais tant que l'essai
      // gratuit de 30 jours est en cours — il ne sera facturé qu'à la réactivation
      // payante, au tarif correspondant (20 $ Standard / 80 $ Assisté).
      const effectiveTier2 = welcomeTier === "group" ? "assisted" : welcomeTier;
      await supabase.from("companies").update({ name, plan_tier: effectiveTier2 }).eq("id", companyId);
      setSettings({ ...settings, companyName: name });
      setPlanTier(effectiveTier2);
      if (welcomeTier === "group") {
        const grp = await createGroupForNewCompany(companyId, name);
        if (grp) { setGroupId(grp.groupId); setGroupName(grp.groupName); setGroupMaxCompanies(grp.groupMaxCompanies); }
      }
      setNeedsWelcome(false);
    } catch (e) {
      // Hors mode Supabase (ou vérification indisponible) : le nom local suffit,
      // on ne bloque jamais l'onboarding sur un souci réseau ponctuel.
      setSettings({ ...settings, companyName: name });
      setNeedsWelcome(false);
    } finally {
      welcomeSubmittingRef.current = false;
      setWelcomeSubmitting(false);
    }
  };

  // Barrière de chargement stricte — sans elle, l'interface (avec ses valeurs par
  // défaut permissives : role="Administrateur", planStatus="active") pouvait
  // s'afficher brièvement PENDANT que resolveMembership() tournait encore en
  // arrière-plan, avant qu'aucune entreprise ne soit vérifiée ni créée. Rien ne
  // doit être rendu tant que cette résolution n'est pas définitivement terminée
  // (succès, erreur, ou choix multi-entreprises) — peu importe combien de temps
  // ça prend.
  if (!loaded && !membershipError && !companyPickOptions) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "sans-serif", color: "#152238" }}>
        {netWait ? "Connexion internet instable — nouvelle tentative automatique…" : "Chargement…"}
      </div>
    );
  }

  if (membershipError) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(160deg, #F4FBE8 0%, #DFF0BE 55%, #C7E296 100%)", fontFamily: "'Inter', sans-serif" }}>
        <div className="bg-white rounded-lg p-8 max-w-sm w-full mx-4 text-center" style={{ border: "1px solid #E4DFD1" }}>
          <Lock size={28} className="mx-auto mb-3" style={{ color: "#A6432F" }} />
          <div className="display text-xl mb-2" style={{ color: "#152238" }}>Connexion refusée</div>
          <p className="text-sm mb-5 text-left" style={{ color: "#7A7460" }}>{sanitizeUserMessage(membershipError)}</p>
          <button onClick={() => { clearMembershipCache(); setMembershipError(null); supabase.auth.signOut(); }}
            className="w-full py-2.5 rounded text-sm text-white" style={{ background: "#152238" }}>
            Se déconnecter et réessayer
          </button>
        </div>
      </div>
    );
  }

  if (needsWelcome && cabinetRow) {
    const st = cabinetRow.status || "pending";
    const info = {
      pending: ["Demande reçue — validation en cours", "Nous vérifions votre cabinet, généralement sous 24 à 48 heures. Vous pouvez déjà donner votre adresse email à vos clients : ils vous invitent depuis Administration → Utilisateurs, avec le rôle « Expert-comptable »."],
      active: ["Votre cabinet est validé", "Vous n'avez pas encore de dossier client. Demandez à chaque client de vous inviter depuis Administration → Utilisateurs (rôle « Expert-comptable ») avec l'adresse email ci-dessous. À votre prochaine connexion, vos dossiers apparaissent et vous les consultez en lecture seule."],
      refused: ["Votre demande n'a pas pu être acceptée", "Écrivez-nous à support@comptaplus.app : nous reviendrons vers vous."],
      suspended: ["Votre cabinet est suspendu", "Écrivez-nous à support@comptaplus.app pour en savoir plus."],
    }[st] || ["Demande reçue", "Nous revenons vers vous rapidement."];
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(160deg, #F4FBE8 0%, #DFF0BE 55%, #C7E296 100%)", fontFamily: "'Inter', sans-serif" }}>
        <div data-testid="cabinet-status" data-status={st} className="bg-white rounded-lg p-8 max-w-sm w-full mx-4" style={{ border: "1px solid #E4DFD1" }}>
          <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "#5B3FA0" }}>Cabinet d'expertise comptable</div>
          <div className="display text-2xl mb-1" style={{ color: "#152238" }}>{cabinetRow.name}</div>
          <div className="text-sm font-medium mb-2" style={{ color: st === "refused" || st === "suspended" ? "#A6432F" : "#0F6B5C" }}>{info[0]}</div>
          <p className="text-sm mb-4" style={{ color: "#7A7460" }}>{info[1]}</p>
          <div className="text-xs mb-4 p-2 rounded" style={{ background: "#F3EFE3", color: "#152238", overflowWrap: "anywhere" }}>Votre adresse : <b>{cabinetRow.owner_email}</b></div>
          <button onClick={() => window.location.reload()} className="w-full py-2 rounded text-sm text-white" style={{ background: "#152238" }}>Actualiser</button>
          <button onClick={() => { clearMembershipCache(); supabase.auth.signOut(); }} className="w-full text-center text-xs underline mt-3" style={{ color: "#8A8370" }}>Se déconnecter</button>
        </div>
      </div>
    );
  }

  if (needsWelcome && welcomeMode === "cabinet") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(160deg, #F4FBE8 0%, #DFF0BE 55%, #C7E296 100%)", fontFamily: "'Inter', sans-serif" }}>
        <div data-testid="cabinet-form" className="bg-white rounded-lg p-8 max-w-sm w-full mx-4" style={{ border: "1px solid #E4DFD1" }}>
          <div className="display text-2xl mb-1" style={{ color: "#152238" }}>Inscrire mon cabinet</div>
          <p className="text-sm mb-4" style={{ color: "#7A7460" }}>Pour les experts-comptables et cabinets : suivez plusieurs entreprises clientes en lecture seule, sans créer d'entreprise vous-même. Votre inscription est validée par notre équipe.</p>
          <input value={cabForm.name} onChange={(e) => setCabForm({ ...cabForm, name: e.target.value })} data-testid="cab-name" placeholder="Nom du cabinet (obligatoire)" autoFocus className="w-full border rounded px-3 py-2 text-sm mb-2" style={{ borderColor: "#DDD6C4" }} />
          <input value={cabForm.phone} onChange={(e) => setCabForm({ ...cabForm, phone: e.target.value })} data-testid="cab-phone" placeholder="Téléphone / WhatsApp" className="w-full border rounded px-3 py-2 text-sm mb-2" style={{ borderColor: "#DDD6C4" }} />
          <input value={cabForm.city} onChange={(e) => setCabForm({ ...cabForm, city: e.target.value })} data-testid="cab-city" placeholder="Ville" className="w-full border rounded px-3 py-2 text-sm mb-4" style={{ borderColor: "#DDD6C4" }} />
          <button data-testid="cab-submit" onClick={submitCabinet} disabled={cabSubmitting} className="w-full py-2 rounded text-sm text-white" style={{ background: "#5B3FA0", opacity: cabSubmitting ? 0.6 : 1 }}>{cabSubmitting ? "Envoi…" : "Envoyer ma demande"}</button>
          <button onClick={() => setWelcomeMode("entreprise")} className="w-full text-center text-xs underline mt-3" style={{ color: "#8A8370" }}>← Je veux plutôt créer une entreprise</button>
          <button onClick={() => { clearMembershipCache(); supabase.auth.signOut(); }} className="w-full text-center text-xs underline mt-2" style={{ color: "#8A8370" }}>Se déconnecter</button>
        </div>
      </div>
    );
  }

  if (needsWelcome) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(160deg, #F4FBE8 0%, #DFF0BE 55%, #C7E296 100%)", fontFamily: "'Inter', sans-serif" }}>
        <div className="bg-white rounded-lg p-8 max-w-sm w-full mx-4" style={{ border: "1px solid #E4DFD1" }}>
          <div className="display text-2xl mb-1" style={{ color: "#152238" }}>Bienvenue sur Compta+</div>
          <p className="text-sm mb-5" style={{ color: "#7A7460" }}>
            Votre essai gratuit de 30 jours commence maintenant. Comment s'appelle votre entreprise ?
          </p>
          <input value={welcomeName} onChange={(e) => setWelcomeName(e.target.value)}
            placeholder="Nom de l'entreprise (obligatoire)" autoFocus
            className="w-full border rounded px-3 py-2 text-sm mb-1" style={{ borderColor: "#DDD6C4" }}
            onKeyDown={(e) => e.key === "Enter" && submitWelcome()} />
          <p className="text-xs mb-4" style={{ color: "#A39C87" }}>Requis pour identifier votre entreprise.</p>
          <div className="text-xs font-medium mb-2" style={{ color: "#152238" }}>Choisissez votre forfait</div>
          <div className="flex flex-col gap-2 mb-4">
            <button onClick={() => setWelcomeTier("standard")}
              className="text-left p-3 rounded border-2"
              style={{ borderColor: welcomeTier === "standard" ? "#152238" : "#DDD6C4", background: welcomeTier === "standard" ? "#F4F2EC" : "#fff" }}>
              <div className="text-sm font-medium" style={{ color: "#152238" }}>Standard — 20 $/mois</div>
              <div className="text-xs" style={{ color: "#8A8370" }}>Toutes les fonctionnalités de base</div>
            </button>
            <button onClick={() => setWelcomeTier("assisted")}
              className="text-left p-3 rounded border-2"
              style={{ borderColor: welcomeTier === "assisted" ? "#5B3FA0" : "#DDD6C4", background: welcomeTier === "assisted" ? "#F3EEFB" : "#fff" }}>
              <div className="text-sm font-medium" style={{ color: "#5B3FA0" }}>Assisté — 80 $/mois</div>
              <div className="text-xs" style={{ color: "#8A8370" }}>+ alertes, recommandations et corrections automatiques pour éviter les erreurs de saisie</div>
            </button>
            <button onClick={() => setWelcomeTier("group")}
              className="text-left p-3 rounded border-2"
              style={{ borderColor: welcomeTier === "group" ? "#0F6B5C" : "#DDD6C4", background: welcomeTier === "group" ? "#E6F1EE" : "#fff" }}>
              <div className="text-sm font-medium" style={{ color: "#0F6B5C" }}>Extension — 350 $/mois</div>
              <div className="text-xs" style={{ color: "#8A8370" }}>Pour gérer jusqu'à 5 entreprises (succursales ou commerces distincts) dans un même espace, avec tableau de bord consolidé — inclut toutes les fonctionnalités Assisté</div>
            </button>
          </div>
          <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
            Aucun frais pendant votre essai gratuit de 30 jours — le tarif choisi ne s'applique qu'à la réactivation, à la fin de l'essai.
          </p>
          {welcomeError && (
            <div data-testid="welcome-error" className="text-sm mb-3 p-3 rounded" style={{ background: "#F7E9E3", color: "#A6432F", border: "1px solid #E9C9BC" }}>{welcomeError}</div>
          )}
          <button onClick={submitWelcome} disabled={welcomeSubmitting} className="w-full py-2 rounded text-sm text-white" style={{ background: "#152238", opacity: welcomeSubmitting ? 0.6 : 1 }}>
            {welcomeSubmitting ? "Création en cours..." : "Commencer"}
          </button>
          <button data-testid="go-cabinet" onClick={() => setWelcomeMode("cabinet")} className="w-full text-center text-xs underline mt-3" style={{ color: "#5B3FA0" }}>
            Vous êtes un cabinet d'expertise comptable ? Inscrire mon cabinet
          </button>
          <button onClick={() => { clearMembershipCache(); supabase.auth.signOut(); }} className="w-full text-center text-xs underline mt-3" style={{ color: "#8A8370" }}>
            Ce n'est pas mon compte — se déconnecter
          </button>
        </div>
      </div>
    );
  }

  if (isDuplicateTab) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(160deg, #F4FBE8 0%, #DFF0BE 55%, #C7E296 100%)", fontFamily: "'Inter', sans-serif" }}>
        <div className="bg-white rounded-lg p-8 max-w-sm w-full mx-4 text-center" style={{ border: "1px solid #E4DFD1" }}>
          <Lock size={28} className="mx-auto mb-3" style={{ color: "#C9A24B" }} />
          <div className="display text-xl mb-2" style={{ color: "#152238" }}>Compta+ est déjà ouvert</div>
          <p className="text-sm mb-5" style={{ color: "#7A7460" }}>
            Un autre onglet (ou une autre fenêtre) de Compta+ est déjà ouvert dans ce navigateur. Pour éviter tout conflit d'enregistrement entre les deux, un seul onglet à la fois peut être actif.
          </p>
          <p className="text-xs mb-5 px-3 py-2 rounded text-left" style={{ background: "#FBF1DC", color: "#9A7B1E" }}>
            Le bon réflexe : fermez cet onglet et continuez dans l'autre déjà ouvert. Si vous préférez continuer ici, l'autre onglet sera automatiquement mis en pause.
          </p>
          <button onClick={takeOverTab} className="w-full py-2.5 rounded text-sm text-white" style={{ background: "#152238" }}>
            Continuer dans cet onglet
          </button>
        </div>
      </div>
    );
  }

  if (companyPickOptions) {
    const pickCompany = async (companyId) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await chooseCompany(companyId, user.id);
      window.location.reload();
    };
    if (companyPickOptions.length >= 2 && companyPickOptions.every((o) => o.isAccountant)) {
      return <CabinetSpace options={companyPickOptions} onOpen={pickCompany} showToast={showToast} onSignOut={() => { clearMembershipCache(); supabase.auth.signOut(); }} />;
    }
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "#152238", fontFamily: "'Source Sans Pro', 'Inter', sans-serif" }}>
        <div className="max-w-md w-full">
          <svg width="44" height="44" viewBox="0 0 512 512" className="mb-4" style={{ borderRadius: 10 }}>
            <rect width="512" height="512" rx="112" fill="#14458F" />
            <circle cx="256" cy="256" r="150" fill="#FFFFFF" />
            <path d="M256,256 L429.2,156 A200,200 0 0,1 429.2,356 Z" fill="#14458F" />
            <rect x="341" y="239" width="90" height="34" rx="10" fill="#1FA97A" />
            <rect x="369" y="211" width="34" height="90" rx="10" fill="#1FA97A" />
          </svg>
          <div className="display text-2xl mb-1" style={{ color: "#EFE9DD" }}>Quelle entreprise ouvrir ?</div>
          <p className="text-sm mb-5" style={{ color: "#8A97B5" }}>Vous êtes rattaché à plusieurs entreprises. Votre choix sera mémorisé sur cet appareil.</p>
          <div className="grid gap-3">
            {companyPickOptions.map((opt) => (
              <button key={opt.companyId} onClick={() => pickCompany(opt.companyId)}
                className="text-left rounded-lg p-4 flex items-center justify-between" style={{ background: "#EFE9DD" }}>
                <div>
                  <div className="font-semibold" style={{ color: "#152238" }}>{opt.name}</div>
                  <div className="text-xs mt-0.5" style={{ color: "#7A7460" }}>Rôle : {roleLabel(opt.role)}</div>
                </div>
                <span style={{ color: "#C9A24B" }}>→</span>
              </button>
            ))}
          </div>
          <button onClick={() => { clearMembershipCache(); supabase.auth.signOut(); }}
            className="mt-6 text-xs underline block" style={{ color: "#8A97B5" }}>
            Se déconnecter
          </button>
        </div>
      </div>
    );
  }

  if (isBlocked && !isPlatformAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(160deg, #F4FBE8 0%, #DFF0BE 55%, #C7E296 100%)", fontFamily: "'Inter', sans-serif" }}>
        <div className="bg-white rounded-lg p-8 max-w-sm w-full mx-4 text-center" style={{ border: "1px solid #E4DFD1" }}>
          <Lock size={28} className="mx-auto mb-3" style={{ color: "#A6432F" }} />
          <div className="display text-xl mb-2" style={{ color: "#152238" }}>
            {planStatus === "suspended" ? "Accès suspendu" : "Essai gratuit terminé"}
          </div>
          <p className="text-sm mb-5" style={{ color: "#7A7460" }}>
            {planStatus === "suspended"
              ? "Votre accès à Compta+ a été suspendu. Contactez-nous pour le réactiver."
              : "Votre période d'essai de 30 jours est arrivée à son terme. Contactez-nous pour continuer à utiliser Compta+ — vos données restent en sécurité et seront disponibles dès la réactivation de votre compte."}
          </p>
          <button onClick={() => setShowHelpCenter(true)}
            className="w-full py-2.5 rounded text-sm text-white flex items-center justify-center gap-2 mb-3" style={{ background: "#152238" }}>
            <MessageCircle size={15} /> Contacter le support
            {helpUnread > 0 && <span className="text-xs px-1.5 rounded-full" style={{ background: "#D9756B" }}>{helpUnread}</span>}
          </button>
          <button onClick={() => { clearMembershipCache(); supabase.auth.signOut(); }}
            className="text-xs underline" style={{ color: "#8A8370" }}>
            Se déconnecter
          </button>

          <div className="mt-5 pt-5" style={{ borderTop: "1px solid #EEE9DA" }}>
            <button onClick={() => payWithMonCash()} disabled={monCashLoading}
              className="w-full py-2.5 rounded text-sm text-white flex items-center justify-center gap-2" style={{ background: "#DA2228" }}>
              <Smartphone size={15} /> {monCashLoading ? "Redirection en cours…" : `Payer ${monCashAmount.toLocaleString("fr-FR")} HTG avec MonCash`}
            </button>
            {monCashError && <p className="text-xs mt-2" style={{ color: "#A6432F" }}>{monCashError}</p>}
            <p className="text-xs mt-2 mb-4" style={{ color: "#A39C87" }}>
              Équivalent de {settings.subscriptionPriceUSD || 20} USD, converti au taux du jour. Vous serez redirigé vers la page sécurisée MonCash pour finaliser le paiement, puis ramené automatiquement ici.
            </p>

            {unavailablePayment && (
              <p className="text-xs mb-3 px-3 py-2 rounded" style={{ background: "#FBF1DC", color: "#9A7B1E" }}>
                {unavailablePayment} n'est pas encore activé techniquement sur l'application pour l'encaissement automatique des abonnements. Contactez-nous directement pour régulariser votre paiement par ce moyen en attendant.
              </p>
            )}
            <button onClick={() => setUnavailablePayment("NatCash")}
              className="w-full py-2.5 rounded text-sm mb-2 flex items-center justify-center gap-2" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>
              <Smartphone size={15} /> Payer avec NatCash
            </button>
            <button onClick={() => setUnavailablePayment("Le paiement par carte bancaire (Stripe)")}
              className="w-full py-2.5 rounded text-sm flex items-center justify-center gap-2" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>
              <CreditCard size={15} /> Payer par carte bancaire (Mexique)
            </button>
          </div>
        </div>
        {showHelpCenter && <HelpCenterChat onClose={() => { setShowHelpCenter(false); refreshHelpCounters(); }} />}
      </div>
    );
  }

  if (companyHasPin && !pinVerified) {
    const verifyPin = async () => {
      if (!pinInput.trim()) return;
      setPinChecking(true);
      setPinError("");
      try {
        const { data, error } = await supabase.rpc("verify_company_pin", {
          target_company_id: companyPinCompanyId,
          pin_attempt: pinInput.trim(),
        });
        if (error) {
          setPinError("Impossible de vérifier le code pour l'instant. Réessayez.");
        } else if (data === true) {
          try { sessionStorage.setItem("compta-plus-pin-verified-" + companyPinCompanyId, "true"); } catch (e) {}
          hlPinMark(companyPinCompanyId, _membership && _membership.email);
          setPinVerified(true);
        } else {
          setPinError("Code incorrect. Redemandez-le à votre administrateur si besoin.");
        }
      } catch (e) {
        setPinError("Impossible de vérifier le code pour l'instant. Réessayez.");
      }
      setPinChecking(false);
    };
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(160deg, #F4FBE8 0%, #DFF0BE 55%, #C7E296 100%)", fontFamily: "'Inter', sans-serif" }}>
        <div className="bg-white rounded-lg p-8 max-w-sm w-full mx-4 text-center" style={{ border: "1px solid #E4DFD1" }}>
          <Lock size={28} className="mx-auto mb-3" style={{ color: "#152238" }} />
          <div className="display text-xl mb-2" style={{ color: "#152238" }}>Code de sécurité de l'entreprise</div>
          <p className="text-sm mb-5" style={{ color: "#7A7460" }}>
            Cette entreprise est protégée par un code partagé, défini par l'administrateur principal. Demandez-le-lui si vous ne l'avez pas.
          </p>
          <input type="password" value={pinInput} onChange={(e) => setPinInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && verifyPin()}
            placeholder="Code de sécurité" autoFocus
            className="w-full border rounded px-3 py-2 text-sm mb-3 text-center tabular" style={{ borderColor: "#DDD6C4" }} />
          {pinError && <p className="text-xs mb-3" style={{ color: "#A6432F" }}>{pinError}</p>}
          <button onClick={verifyPin} disabled={pinChecking}
            className="w-full py-2.5 rounded text-sm text-white mb-3" style={{ background: "#152238" }}>
            {pinChecking ? "Vérification…" : "Valider"}
          </button>
          <button onClick={() => { clearMembershipCache(); supabase.auth.signOut(); }}
            className="text-xs underline" style={{ color: "#8A8370" }}>
            Se déconnecter
          </button>
        </div>
      </div>
    );
  }

  if ((isPlatformAdmin || isManagementCollaborator || isGroupOwner) && platformLanding) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "#152238", fontFamily: "'Source Sans Pro', 'Inter', sans-serif" }}>
        <div className="max-w-2xl w-full">
          <svg width="48" height="48" viewBox="0 0 512 512" className="mb-3" style={{ borderRadius: 12, flexShrink: 0 }}>
            <rect width="512" height="512" rx="112" fill="#14458F" />
            <circle cx="256" cy="256" r="150" fill="#FFFFFF" />
            <path d="M256,256 L429.2,156 A200,200 0 0,1 429.2,356 Z" fill="#14458F" />
            <rect x="341" y="239" width="90" height="34" rx="10" fill="#1FA97A" />
            <rect x="369" y="211" width="34" height="90" rx="10" fill="#1FA97A" />
          </svg>
          <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "#C9A24B" }}>
            Compta+ — {isPlatformAdmin ? "Compte administrateur" : isGroupOwner ? "Propriétaire de groupe" : "Compte collaborateur"}
          </div>
          <div className="display text-3xl mb-1" style={{ color: "#EFE9DD" }}>Tableau de bord général</div>
          <p className="text-sm mb-6" style={{ color: "#8A97B5" }}>Choisissez un espace — la Plateforme et votre Entreprise sont deux blocs indépendants.</p>

          {platformStats && (
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="rounded-lg p-3 text-center" style={{ background: "linear-gradient(160deg, #F4FBE8 0%, #DFF0BE 55%, #C7E296 100%)" }}>
                <div className="text-xl tabular font-semibold" style={{ color: "#152238" }}>{platformStats.total}</div>
                <div className="text-xs" style={{ color: "#5C6B4A" }}>Entreprises</div>
              </div>
              <div className="rounded-lg p-3 text-center" style={{ background: "linear-gradient(160deg, #F4FBE8 0%, #DFF0BE 55%, #C7E296 100%)" }}>
                <div className="text-xl tabular font-semibold" style={{ color: "#0F6B5C" }}>{platformStats.active}</div>
                <div className="text-xs" style={{ color: "#5C6B4A" }}>Actives</div>
              </div>
              <div className="rounded-lg p-3 text-center" style={{ background: "linear-gradient(160deg, #F4FBE8 0%, #DFF0BE 55%, #C7E296 100%)" }}>
                <div className="text-xl tabular font-semibold" style={{ color: "#A6432F" }}>{platformStats.suspended}</div>
                <div className="text-xs" style={{ color: "#5C6B4A" }}>Suspendues</div>
              </div>
            </div>
          )}

          <div className="grid gap-3">
            {isPlatformAdmin && (
              <button onClick={() => { setPlatformLanding(false); setActive("superadmin"); }}
                className="text-left rounded-lg p-5 flex items-center justify-between" style={{ background: "linear-gradient(160deg, #F4FBE8 0%, #DFF0BE 55%, #C7E296 100%)" }}>
                <div>
                  <div className="font-semibold" style={{ color: "#152238" }}>Plateforme — Super Admin</div>
                  <div className="text-xs mt-0.5" style={{ color: "#5C6B4A" }}>Abonnements, revenus, historique global, rapports</div>
                </div>
                <span style={{ color: "#3B5C1F" }}>→</span>
              </button>
            )}

            {isGroupOwner && (
              <button onClick={() => { setPlatformLanding(false); setActive("groupdashboard"); }}
                className="text-left rounded-lg p-5 flex items-center justify-between" style={{ background: "linear-gradient(160deg, #F4FBE8 0%, #DFF0BE 55%, #C7E296 100%)" }}>
                <div>
                  <div className="font-semibold flex items-center gap-2" style={{ color: "#152238" }}>
                    Groupe — {groupName}
                    {pendingGroupRequests > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full text-white font-normal" style={{ background: "#D9756B" }}>
                        {pendingGroupRequests} demande{pendingGroupRequests > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: "#5C6B4A" }}>Vue d'ensemble consolidée, comparatifs, et accès à chaque entreprise du groupe</div>
                </div>
                <span style={{ color: "#3B5C1F" }}>→</span>
              </button>
            )}

            {isManagementCollaborator && (
              <button onClick={() => { setPlatformLanding(false); setActive("centredegestion"); }}
                className="text-left rounded-lg p-5 flex items-center justify-between" style={{ background: "linear-gradient(160deg, #F4FBE8 0%, #DFF0BE 55%, #C7E296 100%)" }}>
                <div>
                  <div className="font-semibold flex items-center gap-2" style={{ color: "#152238" }}>
                    Centre de gestion
                    {inboxUnreadApp > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full text-white font-normal" style={{ background: "#D9756B" }}>
                        {inboxUnreadApp} message{inboxUnreadApp > 1 ? "s" : ""} d'aide
                      </span>
                    )}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: "#5C6B4A" }}>Entreprises, collaborateurs, retours clients, offres spéciales</div>
                </div>
                <span style={{ color: "#3B5C1F" }}>→</span>
              </button>
            )}

            {!((isManagementCollaborator || isGroupOwner) && !isPlatformAdmin) && (
            <button onClick={() => {
              // Rechargement volontaire plutôt qu'un simple changement d'onglet : sans
              // ça, le bloc Entreprise garderait le statut d'abonnement chargé au tout
              // premier accès de la session, même si Super Admin l'a changé entre-temps
              // (les deux vivent dans des états React totalement séparés qui ne se
              // resynchronisent jamais tout seuls).
              try { sessionStorage.setItem("compta_skip_landing", "1"); } catch (e) {}
              window.location.reload();
            }}
              className="text-left rounded-lg p-5 flex items-center justify-between" style={{ background: "linear-gradient(160deg, #F4FBE8 0%, #DFF0BE 55%, #C7E296 100%)" }}>
              <div>
                <div className="font-semibold" style={{ color: "#152238" }}>Ouvrir mon entreprise{settings.companyName ? " — " + settings.companyName : ""}</div>
                <div className="text-xs mt-0.5" style={{ color: "#5C6B4A" }}>Comptabilité, ventes, stock — les 9 modules habituels</div>
              </div>
              <span style={{ color: "#3B5C1F" }}>→</span>
            </button>
            )}

            {!((isManagementCollaborator || isGroupOwner) && !isPlatformAdmin) && (!showCreateCompanyForm ? (
              <button onClick={() => setShowCreateCompanyForm(true)}
                className="text-left rounded-lg p-5 flex items-center justify-between" style={{ border: "1px solid rgba(239,233,221,0.3)" }}>
                <div>
                  <div className="font-medium" style={{ color: "#EFE9DD" }}>Créer une nouvelle entreprise</div>
                  <div className="text-xs mt-0.5" style={{ color: "#8A97B5" }}>Nécessitera un rechargement pour y accéder ensuite</div>
                </div>
                <span style={{ color: "#8A97B5" }}>+</span>
              </button>
            ) : (
              <div className="rounded-lg p-5" style={{ border: "1px solid rgba(239,233,221,0.3)" }}>
                <div className="font-medium mb-2" style={{ color: "#EFE9DD" }}>Nouvelle entreprise</div>
                <input value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)} placeholder="Nom de l'entreprise"
                  className="w-full rounded px-3 py-2 text-sm mb-2" style={{ border: "1px solid #DDD6C4" }} />
                <div className="flex gap-2">
                  <button onClick={createAdditionalCompany} disabled={creatingCompany}
                    className="px-3 py-1.5 rounded text-sm" style={{ background: "#C9A24B", color: "#152238" }}>
                    {creatingCompany ? "Création…" : "Créer"}
                  </button>
                  <button onClick={() => { setShowCreateCompanyForm(false); setNewCompanyName(""); }}
                    className="px-3 py-1.5 rounded text-sm" style={{ color: "#8A97B5" }}>
                    Annuler
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button onClick={() => { clearMembershipCache(); supabase.auth.signOut(); }}
            className="mt-6 text-xs underline block" style={{ color: "#8A97B5" }}>
            Se déconnecter
          </button>

          <div className="mt-4 pt-4 text-[11px]" style={{ borderTop: "1px solid rgba(239,233,221,0.15)", color: "#5C6B8C" }}>
            <div className="mb-1 tabular" style={{ color: "#8A97B5" }}>Version {APP_VERSION}</div>
            <div>Rôle : {isPlatformAdmin ? "Administrateur de la plateforme" : isGroupOwner ? "Propriétaire de groupe multi-entreprises" : "Collaborateur du Centre de gestion"}</div>
            <div className="mt-1">
              <a href="cgu.html" target="_blank" rel="noopener" className="underline">Conditions d'utilisation</a>
              {" · "}
              <a href="confidentialite.html" target="_blank" rel="noopener" className="underline">Confidentialité</a>
              {" · "}
              <a href="securite.html" target="_blank" rel="noopener" className="underline">Sécurité</a>
              {" · "}
              <a href="support.html" target="_blank" rel="noopener" className="underline">Support</a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "linear-gradient(160deg, #F4FBE8 0%, #DFF0BE 55%, #C7E296 100%)", fontFamily: "'Source Sans Pro', 'Inter', sans-serif" }}>
      <style>{`
        .tabular { font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; }
        .display { font-family: 'Spectral', serif; }
        .print-only { display: none; }
        /* Le texte affiché ne se sélectionne pas, ne se glisse pas et ne se dépose pas dans les champs : seuls les champs de saisie restent éditables. */
        body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
        input, textarea, select, [contenteditable="true"], .selectable { -webkit-user-select: text; user-select: text; }
        img, a { -webkit-user-drag: none; }
        @page ticket-page-80 { size: 80mm auto; margin: 3mm; }
        @page ticket-page-58 { size: 58mm auto; margin: 2mm; }
        .ticket-print-80 { page: ticket-page-80; }
        .ticket-print-58 { page: ticket-page-58; }
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          main { width: 100% !important; }
          body { background: #fff !important; }
          @page { margin: 14mm; }
        }
      `}</style>

      {isOffline && (
        <div className="px-4 py-2.5 text-sm text-center no-print" data-ofl="banner-offline" style={{ background: "#5A5540", color: "#fff" }}>
          📶 Aucune connexion internet détectée. Ce que vous voyez peut être périmé{offlineBootAt ? ` (données enregistrées le ${new Date(offlineBootAt).toLocaleString("fr-FR")})` : ""}. Vos modifications sont gardées sur cet appareil et seront enregistrées automatiquement au retour de la connexion (ventes du point de vente comprises).
        </div>
      )}
      {hlPendingCats.length > 0 && (
        <div className="px-4 py-2 text-xs text-center no-print" data-hl="banner-pending" style={{ background: "#FFF6E0", color: "#152238" }}>
          ⏳ {hlPendingCats.length} catégorie(s) de données modifiée(s) en attente de synchronisation — conservées sur cet appareil{isOffline ? " (reprise automatique au retour du réseau)" : "…"}
        </div>
      )}
      {oflCount > 0 && (
        <div className="px-4 py-2 text-xs text-center no-print" data-ofl="banner-queue" style={{ background: "#FFF6E0", color: "#152238" }}>
          ⏳ {oflCount} vente(s) hors ligne en attente de synchronisation{isOffline ? " (reprise automatique au retour du réseau)" : "…"}
        </div>
      )}

      {showExitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(21,34,56,0.5)" }}>
          <div className="bg-white rounded-lg p-6 max-w-sm w-full text-center">
            <div className="text-sm font-medium mb-2" style={{ color: "#152238" }}>Quitter Compta+ ?</div>
            <p className="text-xs mb-4" style={{ color: "#A39C87" }}>
              "Quitter" ferme cette fenêtre ; si l'application reste affichée, un nouvel appui sur retour la fermera.
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => {
                  setShowExitConfirm(false);
                  // On reste : on réempile la garde pour qu'un prochain retour
                  // redéclenche cette même confirmation, au lieu de quitter direct.
                  _backNavStack.unshift({ reset: () => setShowExitConfirm(true) });
                  window.history.pushState({ exitGuard: true }, "");
                }}
                className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238" }}>
                Rester
              </button>
              <button
                onClick={() => {
                  setShowExitConfirm(false);
                  // Tentative best-effort — fonctionne rarement pour une fenêtre que
                  // le navigateur n'a pas lui-même ouverte par script, mais sans risque
                  // à essayer. Si ça ne suffit pas, la pile de navigation partagée est
                  // maintenant vide : le prochain appui sur retour n'a plus rien à
                  // intercepter et aboutit naturellement à la fermeture par le système.
                  window.close();
                }}
                className="px-4 py-2 rounded text-sm" style={{ background: "#F3EFE3", color: "#7A7460" }}>
                Quitter
              </button>
            </div>
          </div>
        </div>
      )}

      {updateAvailable && (
        <div className="px-4 py-2.5 text-sm text-center no-print" style={{ background: "#152238", color: "#fff" }}>
          🔄 Une nouvelle version de Compta+ est disponible.
          <button onClick={() => window.location.reload()} className="ml-2 underline font-medium" style={{ color: "#C9A24B" }}>
            Recharger maintenant
          </button>
        </div>
      )}
      {visibleSyncErrorCategories.length > 0 && (
        <div className="px-4 py-2.5 text-sm text-center no-print" style={{ background: "#A6432F", color: "#fff" }}>
          ⚠️ La connexion internet semble interrompue : certaines données ne sont pas encore enregistrées. Gardez cette page ouverte — la sauvegarde reprend automatiquement dès le retour du réseau.
          <button onClick={retryAllSaves} disabled={retrySaving}
            className="ml-2 underline font-medium" style={{ color: "#fff" }}>
            {retrySaving ? "Sauvegarde en cours…" : "Réessayer la sauvegarde maintenant"}
          </button>
        </div>
      )}

      {topReconciliationIssueCount > 0 && active !== "compta" && role === "Administrateur" && (
        <div className="px-4 py-2.5 text-sm text-center no-print" style={{ background: "#D9A441", color: "#152238" }}>
          ⚠️ {topReconciliationIssueCount} écart{topReconciliationIssueCount > 1 ? "s" : ""} détecté{topReconciliationIssueCount > 1 ? "s" : ""} entre Facturation et le Journal des écritures.
          <button onClick={() => setActive("compta")} className="ml-2 underline font-medium" style={{ color: "#152238" }}>
            Voir le détail dans Comptabilité
          </button>
        </div>
      )}

      <div
        className="flex flex-col md:flex-row flex-1 min-h-0"
        style={{ touchAction: "pan-y", overscrollBehaviorX: "none" }}
        onTouchStart={(active === "superadmin" || active === "centredegestion" || active === "groupdashboard") ? undefined : (ev) => { swipeTouchRef.current = { x: ev.touches[0].clientX, y: ev.touches[0].clientY }; }}
        onTouchEnd={(active === "superadmin" || active === "centredegestion" || active === "groupdashboard") ? undefined : (ev) => {
          const start = swipeTouchRef.current;
          if (!start) return;
          const dx = ev.changedTouches[0].clientX - start.x;
          const dy = ev.changedTouches[0].clientY - start.y;
          swipeTouchRef.current = null;
          // Geste purement horizontal uniquement (évite tout conflit avec le défilement vertical de la page)
          if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          if (!mobileMenuOpen && dx > 0 && start.x < 40) setMobileMenuOpen(true); // glisser vers la droite depuis le bord gauche = ouvrir
          if (mobileMenuOpen && dx < 0) setMobileMenuOpen(false); // glisser vers la gauche = fermer
        }}
      >
      {/* Sidebar */}
      {/* Bloc Plateforme (Super Admin) : pas de tiroir latéral du tout, sous aucune
          forme — juste une barre fixe avec le logo, un retour au tableau de bord
          général et la déconnexion. Bloc Entreprise : barre mobile + tiroir
          habituels, inchangés. */}
      {(active === "superadmin" || active === "centredegestion" || active === "groupdashboard") ? (
        <div className="flex items-center justify-between gap-3 px-4 py-3 no-print" style={{ background: "#152238" }}>
          <div className="flex items-center gap-3">
            <svg width="30" height="30" viewBox="0 0 512 512" style={{ flexShrink: 0, borderRadius: 7 }}>
              <rect width="512" height="512" rx="112" fill="#14458F" />
              <circle cx="256" cy="256" r="150" fill="#FFFFFF" />
              <path d="M256,256 L429.2,156 A200,200 0 0,1 429.2,356 Z" fill="#14458F" />
              <rect x="341" y="239" width="90" height="34" rx="10" fill="#1FA97A" />
              <rect x="369" y="211" width="34" height="90" rx="10" fill="#1FA97A" />
            </svg>
            <span className="display text-lg" style={{ color: "#EFE9DD" }}>Compta+</span>
          </div>
          <div className="text-right text-xs">
            <button onClick={() => setPlatformLanding(true)} className="underline block font-medium" style={{ color: "#C9A24B" }}>
              ← Tableau de bord général
            </button>
            <button onClick={() => { clearMembershipCache(); supabase.auth.signOut(); }} className="underline block mt-1" style={{ color: "#8A97B5" }}>
              Se déconnecter
            </button>
          </div>
        </div>
      ) : (
        <div className="md:hidden flex items-center justify-between gap-3 px-4 py-3 no-print" style={{ background: "#152238" }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileMenuOpen(true)} style={{ color: "#EFE9DD" }} aria-label="Ouvrir le menu">
              <Menu size={22} />
            </button>
            <span className="display text-lg" style={{ color: "#EFE9DD" }}>Compta+</span>
          </div>
          <button onClick={() => { clearMembershipCache(); supabase.auth.signOut(); }} className="text-xs underline" style={{ color: "#8A97B5" }}>
            Se déconnecter
          </button>
        </div>
      )}

      {/* Fond assombri derrière le tiroir — jamais dans le bloc Plateforme, qui n'a plus de tiroir du tout */}
      {mobileMenuOpen && active !== "superadmin" && active !== "centredegestion" && active !== "groupdashboard" && (
        <div className="fixed inset-0 z-40 md:hidden no-print" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setMobileMenuOpen(false)} />
      )}

      {active !== "superadmin" && active !== "centredegestion" && active !== "groupdashboard" && (
      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 w-64 shrink-0 flex flex-col overflow-y-auto no-print transform transition-transform duration-200 md:translate-x-0 ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full"}`}
        style={{ background: "#152238", color: "#EFE9DD" }}
      >
        <div className="px-5 py-6 border-b flex items-center justify-between gap-3" style={{ borderColor: "#28395A" }}>
          <div className="flex items-center gap-3">
          <svg width="34" height="34" viewBox="0 0 512 512" style={{ flexShrink: 0, borderRadius: 8 }}>
            <rect width="512" height="512" rx="112" fill="#14458F" />
            <circle cx="256" cy="256" r="150" fill="#FFFFFF" />
            <path d="M256,256 L429.2,156 A200,200 0 0,1 429.2,356 Z" fill="#14458F" />
            <rect x="341" y="239" width="90" height="34" rx="10" fill="#1FA97A" />
            <rect x="369" y="211" width="34" height="90" rx="10" fill="#1FA97A" />
          </svg>
          <div>
            <div className="display text-xl tracking-wide" style={{ color: "#EFE9DD" }}>Compta+</div>
            <div className="text-xs" style={{ color: "#8A97B5" }}>{settings.companyName || "Centre de contrôle ERP"}</div>
          </div>
          </div>
          <button onClick={() => setMobileMenuOpen(false)} className="md:hidden" style={{ color: "#8A97B5" }} aria-label="Fermer le menu">
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 py-3">
          {!allowedModuleIds && (
          <button
            onClick={() => { setActive("dashboard"); setMobileMenuOpen(false); }}
            className="w-full flex items-center gap-3 px-5 py-3 text-sm transition-colors"
            style={{
              background: active === "dashboard" ? "#1F3358" : "transparent",
              color: active === "dashboard" ? "#EFE9DD" : "#AEB8CE",
              borderLeft: active === "dashboard" ? "3px solid #C9A24B" : "3px solid transparent",
            }}
          >
            <LayoutDashboard size={16} />
            {espace === "ecole" ? "Tableau de bord de l'établissement" : "Tableau de bord"}
          </button>
          )}
          {!allowedModuleIds && groupId && isGroupOwner && (
          <button
            onClick={() => { setActive("groupdashboard"); setMobileMenuOpen(false); }}
            className="w-full flex items-center gap-3 px-5 py-3 text-sm transition-colors"
            style={{
              background: active === "groupdashboard" ? "#1F3358" : "transparent",
              color: active === "groupdashboard" ? "#EFE9DD" : "#AEB8CE",
              borderLeft: active === "groupdashboard" ? "3px solid #C9A24B" : "3px solid transparent",
            }}
          >
            <Boxes size={16} />
            <span className="flex-1 text-left">Groupe — {groupName}</span>
            {pendingGroupRequests > 0 && (
              <span className="text-xs px-1.5 rounded-full text-white" style={{ background: "#D9756B" }}>{pendingGroupRequests}</span>
            )}
          </button>
          )}
          {!allowedModuleIds && groupId && !isGroupOwner && (
            // Simple étiquette, jamais cliquable — une entreprise membre d'un
            // groupe sans en être propriétaire ne doit jamais avoir accès au
            // tableau de bord consolidé ni aux données des entreprises sœurs,
            // seulement savoir qu'elle appartient à ce groupe.
            <div className="w-full flex items-center gap-3 px-5 py-3 text-sm" style={{ color: "#5C6B8C" }}>
              <Boxes size={16} />
              <span className="flex-1 text-left">Fait partie du groupe « {groupName} »</span>
            </div>
          )}
          {espacesDispo.length > 1 && (
            <div className="mt-2 px-5 pt-3 pb-1" data-testid="espace-selecteur">
              <div className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "#5C6B8C" }}>Espace de travail</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                {[["ecole", "Éducation"], ["impex", "Import-export"], ["sante", "Santé"], ["commerce", "Commerce"]].filter(([id]) => espacesDispo.includes(id)).map(([id, l]) => (
                  <button key={id} data-testid={"espace-" + id} onClick={() => { choisirEspace(id); setMobileMenuOpen(false); }} className="rounded text-xs transition-colors"
                    style={{ padding: "9px 6px", lineHeight: 1.25, background: espace === id ? "#C9A24B" : "#1F3358", color: espace === id ? "#152238" : "#AEB8CE", fontWeight: espace === id ? 600 : 400 }}>{l}</button>
                ))}
              </div>
            </div>
          )}
          <div className="mt-2 px-5 pt-3 pb-1 text-[10px] uppercase tracking-widest" style={{ color: "#5C6B8C" }}>
            Modules{espace === "ecole" ? " — espace éducation" : espace === "impex" ? " — espace import-export" : espace === "sante" ? " — espace santé" : ""}{settings && settings.accountingOnly === true && !ROLE_MODULE_ACCESS[role] ? " — espace comptable" : ""}
          </div>
          {modulesVisibles.map((m) => {
            const Icon = m.icon;
            const isActive = active === m.id;
            return (
              <button
                key={m.id}
                onClick={() => { setActive(m.id); setMobileMenuOpen(false); }}
                className="w-full flex items-center gap-3 px-5 py-3 text-sm transition-colors"
                style={{
                  background: isActive ? "#1F3358" : "transparent",
                  color: isActive ? "#EFE9DD" : m.ready ? "#AEB8CE" : "#5C6B8C",
                  borderLeft: isActive ? "3px solid #C9A24B" : "3px solid transparent",
                }}
              >
                <span className="tabular text-xs w-4" style={{ color: "#6C7A9C" }}>{m.n}</span>
                <Icon size={16} />
                <span className="flex-1 text-left">{(espace === "ecole" || espace === "sante") && ESPACE_ECOLE_LIBELLES[m.id] ? ESPACE_ECOLE_LIBELLES[m.id] : m.label}</span>
                {!m.ready && <Lock size={12} style={{ color: "#4A587A" }} />}
              </button>
            );
          })}
        </nav>
        <div className="px-5 py-4 text-[11px] border-t" style={{ borderColor: "#28395A", color: "#5C6B8C" }}>
          <div className="mb-1 tabular" style={{ color: "#3F4F73" }}>Version {APP_VERSION}</div>
          {planTier === "assisted" && (
            <div className="mb-1" style={{ color: "#8B6FD9" }}>
              ✓ Mode Assisté
            </div>
          )}
          {assistantActive && !readOnly && role !== "Vendeur" && (
            <button data-as="badge" onClick={() => { setActive("compta"); setAssistantJump((n) => n + 1); }} className="mb-1 block underline text-left" style={{ color: assistantVisible.some((f) => f.severity === "high") ? "#E0897D" : "#8B6FD9" }}>
              {assistantVisible.length === 0 ? "✓ Assistant : rien à signaler" : `Assistant : ${assistantVisible.length} point(s) à voir`}
            </button>
          )}
          {readOnly ? (
            <span style={{ color: "#D9A441" }}>{isAccountant && canAdjust ? "Mode consultation — vous pouvez passer des écritures de régularisation dans Comptabilité." : (espace === "ecole" && !isAccountant ? "Suppléant — mode consultation : les modifications sont désactivées." : "Mode consultation — les modifications sont désactivées.")}</span>
          ) : (
            <>Rôle : {roleLabel(role, espace === "ecole" ? etabKind : espace === "sante" ? "s_" + santeKind : false)}{role === "Vendeur" && currentStationForSidebar?.activeSellerName ? ` — ${currentStationForSidebar.activeSellerName}` : ""}</>
          )}
          {planStatus === "trial" && trialDaysLeft !== null && (
            <div className="mt-1" style={{ color: trialDaysLeft <= 5 ? "#D9A441" : "#5C6B8C" }}>
              Essai gratuit — {trialDaysLeft} jour{trialDaysLeft > 1 ? "s" : ""} restant{trialDaysLeft > 1 ? "s" : ""}
            </div>
          )}
          {planStatus === "active" && trialDaysLeft !== null && trialDaysLeft <= 3 && (
            <div className="mt-1 font-medium" style={{ color: "#D9756B" }}>
              Abonnement — {trialDaysLeft} jour{trialDaysLeft > 1 ? "s" : ""} restant{trialDaysLeft > 1 ? "s" : ""} : veuillez payer dans le délai pour éviter la suspension du compte.
            </div>
          )}
          {isPlatformAdmin && (
            <button onClick={() => setPlatformLanding(true)} className="mt-2 underline block font-medium" style={{ color: "#C9A24B" }}>
              ← Tableau de bord général
            </button>
          )}
          <button onClick={retryAllSaves} disabled={retrySaving} className="mt-2 underline block" style={{ color: "#8A97B5" }}>
            {retrySaving ? "Sauvegarde en cours…" : "Sauvegarder maintenant"}
          </button>
          <button onClick={() => setShowSecurityPanel(true)} className="mt-1 underline block" style={{ color: "#8A97B5" }}>
            Sécurité du compte
          </button>
          {(isPlatformAdmin || companyCount > 1) && (
            <button data-ec="switch-company" onClick={async () => { const { data: { user } } = await supabase.auth.getUser(); if (user) forgetCompanyChoice(user.id); window.location.reload(); }}
              className="mt-1 underline block" style={{ color: "#8A97B5" }}>
              Changer d'entreprise
            </button>
          )}
          <button onClick={() => setShowHelpCenter(true)} className="mt-1 underline flex items-center gap-1.5" style={{ color: "#C9A24B" }}>
            <MessageCircle size={13} /> Centre d'aide
            {helpUnread > 0 && (
              <span className="text-xs px-1.5 rounded-full text-white no-underline" style={{ background: "#D9756B" }}>{helpUnread}</span>
            )}
          </button>
          {role === "Administrateur" && (
            <button onClick={() => setShowUpgradeModal(true)} className="mt-1 underline flex items-center gap-1.5" style={{ color: "#8A97B5" }}>
              <Boxes size={13} /> Mise à niveau
            </button>
          )}
          <div className="mt-1" style={{ color: "#8A97B5" }}>
            <a href="cgu.html" target="_blank" rel="noopener" className="underline">Conditions d'utilisation</a>
            {" · "}
            <a href="confidentialite.html" target="_blank" rel="noopener" className="underline">Confidentialité</a>
              {" · "}
              <a href="securite.html" target="_blank" rel="noopener" className="underline">Sécurité</a>
              {" · "}
              <a href="support.html" target="_blank" rel="noopener" className="underline">Support</a>
          </div>
          <button onClick={() => { clearMembershipCache(); supabase.auth.signOut(); }} className="mt-1 underline block" style={{ color: "#8A97B5" }}>
            Se déconnecter
          </button>
        </div>
      </aside>
      )}

      {showSecurityPanel && <SecurityPanel onClose={() => setShowSecurityPanel(false)} showToast={showToast} />}
      <AnnouncementsBanner />
      <AdminMfaEnforcer role={role} settings={settings} showToast={showToast} onSignOut={() => { clearMembershipCache(); supabase.auth.signOut(); }} />
      {showHelpCenter && <HelpCenterChat onClose={() => { setShowHelpCenter(false); refreshHelpCounters(); }} />}
      {role === "Administrateur" && secteurs.ok && !secteurs.locked && !secteursSkip && !needsWelcome && !isBlocked && secteursDroits(secteurs, { planTier, groupId, planStatus }).inclus && active !== "superadmin" && active !== "centredegestion" && active !== "groupdashboard" && (
        <SecteursChoixModal companyId={secteurs.companyId} showToast={showToast} onClose={() => setSecteursSkip(true)} onSaved={() => loadSecteursInfo(secteurs.companyId).then(setSecteurs)} />
      )}
      {showUpgradeModal && <UpgradeModal onClose={() => setShowUpgradeModal(false)} planTier={planTier} groupId={groupId} groupName={groupName} showToast={showToast} />}

      {/* Main */}
      <main className="flex-1 min-w-0">
        {isBlocked && active !== "superadmin" && active !== "centredegestion" && active !== "groupdashboard" ? (
          <div className="p-4 md:p-8 max-w-lg">
            <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
              <Lock size={24} className="mb-3" style={{ color: "#A6432F" }} />
              <div className="display text-lg mb-2" style={{ color: "#152238" }}>
                {planStatus === "suspended" ? "Entreprise suspendue" : "Essai gratuit terminé"}
              </div>
              <p className="text-sm mb-4" style={{ color: "#7A7460" }}>
                Le bloc Entreprise de ce compte est {planStatus === "suspended" ? "suspendu" : "arrivé au terme de son essai"}. Réactivez-le depuis Super Admin, ou par MonCash ci-dessous.
                Votre accès au bloc Plateforme (Super Admin), lui, n'est jamais affecté par ce statut.
              </p>
              <button onClick={() => payWithMonCash()} disabled={monCashLoading}
                className="w-full py-2.5 rounded text-sm text-white flex items-center justify-center gap-2 mb-2" style={{ background: "#DA2228" }}>
                <Smartphone size={15} /> {monCashLoading ? "Redirection en cours…" : `Payer ${monCashAmount.toLocaleString("fr-FR")} HTG avec MonCash`}
              </button>
              {monCashError && <p className="text-xs mb-2" style={{ color: "#A6432F" }}>{monCashError}</p>}
              <p className="text-xs" style={{ color: "#A39C87" }}>
                Équivalent de {settings.subscriptionPriceUSD || 20} USD, converti au taux du jour.
              </p>
            </div>
          </div>
        ) : (
        <>
        {active === "dashboard" && (
          <Dashboard
            kpis={kpis}
            chartData={chartData}
            growthData={growthData}
            latestGrowth={latestGrowth}
            entriesCount={entries.length}
            installPrompt={installPrompt}
            onInstallClick={handleInstallClick}
            setActive={setActive}
            settings={settings}
            setSettings={setSettings}
            products={products}
            clients={clients}
            planTier={planTier}
            invoices={invoices}
            role={role}
          />
        )}
        {active === "groupdashboard" && groupId && isGroupOwner && (
          <GroupDashboardModule
            groupId={groupId} groupName={groupName} groupMaxCompanies={groupMaxCompanies}
            groupPlanStatus={planStatus} groupTrialEndsAt={trialEndsAt}
            companyId={companyPinCompanyId} role={role} showToast={showToast}
            onGroupRenamed={(newName) => setGroupName(newName)}
            onRequestsChanged={loadPendingGroupRequests}
            onEnterCurrentCompany={() => setActive("dashboard")}
            onJumpToModule={(m) => setActive(m)}
          />
        )}
        <div
          onClickCapture={readOnly ? (e) => {
            // Laisse passer les clics de simple navigation (onglets, groupes
            // d'onglets) — reconnus par leurs classes constantes dans toute
            // l'application — et bloque tout le reste (ajouter, enregistrer,
            // supprimer, cocher, taper...) avec un message clair, plutôt que
            // de rendre l'écran entier inerte et délavé.
            const interactive = e.target.closest("button, input, select, textarea, a[href]");
            if (!interactive) return;
            // Zones explicitement autorisées en lecture seule (révision du cabinet : commentaires
            // et exports) — chaque action y reste contrôlée par le rôle et par les règles serveur.
            if (interactive.closest("[data-ro-ok]")) return;
            const cls = interactive.className || "";
            const isNavTab = interactive.tagName === "BUTTON" && (cls.includes("rounded-t") || (cls.includes("rounded-full") && cls.includes("shrink-0")));
            if (isNavTab) return;
            e.preventDefault();
            e.stopPropagation();
            showToast("Mode consultation : votre rôle ne permet aucune modification. Contactez un administrateur de votre entreprise pour effectuer cette action.");
          } : undefined}
          onFocusCapture={readOnly ? (e) => {
            const el = e.target;
            if (el.closest && el.closest("[data-ro-ok]")) return;
            if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") el.blur();
          } : undefined}
        >
        {active === "compta" && (
          <ComptaModule
            accounts={accounts}
            setAccounts={setAccounts}
            entries={entries}
            setEntries={setEntries}
            invoices={invoices}
            setInvoices={setInvoices}
            balances={balances}
            settings={settings}
            setSettings={setSettings}
            assets={assets}
            setAssets={setAssets}
            accruals={accruals}
            setAccruals={setAccruals}
            deferrals={deferrals}
            setDeferrals={setDeferrals}
            riskProvisions={riskProvisions}
            loans={loans}
            setRiskProvisions={setRiskProvisions}
            setLoans={setLoans}
            entryTemplates={entryTemplates}
            setEntryTemplates={setEntryTemplates}
            pendingApprovals={pendingApprovals}
            setPendingApprovals={setPendingApprovals}
            role={role}
            showToast={showToast}
            logAudit={logAudit}
            verifyTransactionSaved={verifyTransactionSaved}
            planTier={planTier}
            recordPendingRecommendation={recordPendingRecommendation}
            currentUserEmail={currentUserEmail}
            pendingRecommendations={pendingRecommendations}
            resolvePendingRecommendation={resolvePendingRecommendation}
            companyId={companyPinCompanyId}
            isAccountant={isAccountant}
            adjust={isAccountant && canAdjust}
            assistantActive={assistantActive}
            assistantFindings={assistantVisible}
            assistantAll={assistantAll}
            assistantJump={assistantJump}
            products={products}
          />
        )}
        {active === "caisse" && (
          <CaisseBanqueModule
            cheques={cheques}
            setCheques={setCheques}
            invoices={invoices}
            setInvoices={setInvoices}
            purchases={purchases}
            setPurchases={setPurchases}
            accounts={accounts}
            entries={entries}
            setEntries={setEntries}
            balances={balances}
            settings={settings}
            role={role}
            showToast={showToast}
            logAudit={logAudit}
            planTier={planTier}
            recordPendingRecommendation={recordPendingRecommendation}
            currentUserEmail={currentUserEmail}
            pendingRecommendations={pendingRecommendations}
            resolvePendingRecommendation={resolvePendingRecommendation}
          />
        )}
        {active === "vente" && (
          <VenteModule
            clients={clients}
            setClients={setClients}
            setCheques={setCheques}
            accounts={accounts}
            entries={entries}
            setEntries={setEntries}
            products={products}
            setProducts={setProducts}
            productImages={productImages}
            setProductImages={setProductImages}
            invoices={invoices}
            setInvoices={setInvoices}
            movements={movements}
            setMovements={setMovements}
            settings={settings}
            setSettings={setSettings}
            salesStations={salesStations}
            stationId={effectiveStationId}
            setStationId={setStationId}
            role={role}
            showToast={showToast}
            logAudit={logAudit}
            verifyTransactionSaved={verifyTransactionSaved}
            planTier={planTier}
            recordPendingRecommendation={recordPendingRecommendation}
            currentUserEmail={currentUserEmail}
            pendingRecommendations={pendingRecommendations}
            resolvePendingRecommendation={resolvePendingRecommendation}
          />
        )}
        {active === "achat" && (
          <AchatModule
            cheques={cheques}
            setCheques={setCheques}
            accounts={accounts}
            entries={entries}
            setEntries={setEntries}
            suppliers={suppliers}
            setSuppliers={setSuppliers}
            purchases={purchases}
            setPurchases={setPurchases}
            products={products}
            setProducts={setProducts}
            movements={movements}
            setMovements={setMovements}
            settings={settings}
            role={role}
            showToast={showToast}
            logAudit={logAudit}
            verifyTransactionSaved={verifyTransactionSaved}
            planTier={planTier}
            recordPendingRecommendation={recordPendingRecommendation}
            currentUserEmail={currentUserEmail}
            pendingRecommendations={pendingRecommendations}
            resolvePendingRecommendation={resolvePendingRecommendation}
          />
        )}
        {active === "stock" && (
          <StockModule
            products={products}
            setProducts={setProducts}
            movements={movements}
            setMovements={setMovements}
            accounts={accounts}
            setAccounts={setAccounts}
            entries={entries}
            setEntries={setEntries}
            settings={settings}
            role={role}
            showToast={showToast}
            logAudit={logAudit}
            saveCategoryVerified={saveCategoryVerified}
            refreshCategoryFromServer={refreshCategoryFromServer}
            planTier={planTier}
            recordPendingRecommendation={recordPendingRecommendation}
            currentUserEmail={currentUserEmail}
            pendingRecommendations={pendingRecommendations}
            resolvePendingRecommendation={resolvePendingRecommendation}
          />
        )}
        {active === "crm" && (
          <CRMModule
            setCheques={setCheques}
            clients={clients}
            setClients={setClients}
            invoices={invoices}
            setInvoices={setInvoices}
            entries={entries}
            setEntries={setEntries}
            accounts={accounts}
            setAccounts={setAccounts}
            planTier={planTier}
            recordPendingRecommendation={recordPendingRecommendation}
            currentUserEmail={currentUserEmail}
            role={role}
            showToast={showToast}
            logAudit={logAudit}
            verifyTransactionSaved={verifyTransactionSaved}
            pendingApprovals={pendingApprovals}
            setPendingApprovals={setPendingApprovals}
            settings={settings}
          />
        )}
        {active === "rapports" && (
          <RapportsModule
            payslips={payslips}
            employees={employees}
            suppliers={suppliers}
            accounts={accounts}
            balances={balances}
            invoices={invoices}
            purchases={purchases}
            entries={entries}
            settings={settings}
            assets={assets}
            riskProvisions={riskProvisions}
            loans={loans}
            deferrals={deferrals}
            products={products}
            clients={clients}
            showToast={showToast}
            planTier={planTier}
          />
        )}
        {active === "gestion" && role !== "Vendeur" && (
          <GestionModule
            premium={planTier === "assisted" || !!groupId}
            bizdocs={bizdocs} setBizdocs={setBizdocs}
            invoices={invoices} setInvoices={setInvoices}
            purchases={purchases} setPurchases={setPurchases}
            suppliers={suppliers} clients={clients} setClients={setClients}
            products={products} setProducts={setProducts}
            movements={movements} setMovements={setMovements}
            entries={entries} setEntries={setEntries}
            accounts={accounts} setAccounts={setAccounts} balances={balances}
            settings={settings} setSettings={setSettings}
            companyName={settings.companyName}
            role={role} showToast={showToast} logAudit={logAudit}
            companyId={companyPinCompanyId}
            getInvoiceNumber={async () => {
              const { companyId } = await resolveMembership();
              const { data: n, error } = await supabase.rpc("next_invoice_number", { target_company_id: companyId });
              if (error) throw error;
              return invoicePrefix(settings) + String(n).padStart(4, "0");
            }}
          />
        )}
        {active === "sante" && santeActif && (
          <SanteModule sante={sante} setSante={setSante} entries={entries} setEntries={setEntries} accounts={accounts} setAccounts={setAccounts} products={products} setProducts={setProducts} movements={movements} setMovements={setMovements} settings={settings} role={role} showToast={showToast} logAudit={logAudit} currentUserEmail={currentUserEmail} />
        )}
        {active === "impex" && ieActif && (
          <ImportExportModule impex={impex} setImpex={setImpex} entries={entries} setEntries={setEntries} accounts={accounts} setAccounts={setAccounts} products={products} setProducts={setProducts} movements={movements} setMovements={setMovements} settings={settings} role={role} showToast={showToast} logAudit={logAudit} currentUserEmail={currentUserEmail} />
        )}
        {active === "ecole" && ecolesActif && (
          <EcolesModule ecole={ecole} setEcole={setEcole} entries={entries} setEntries={setEntries} accounts={accounts} setAccounts={setAccounts} settings={settings} role={role} showToast={showToast} logAudit={logAudit} currentUserEmail={currentUserEmail} />
        )}
        {active === "admin" && role === "Administrateur" && (
          <AdminModule
            ecoleLabels={ecolesActif ? etabKind : santeActif ? "s_" + santeKind : false}
            settings={settings}
            setSettings={setSettings}
            users={users}
            setUsers={setUsers}
            currentUserEmail={currentUserEmail}
            companyId={companyPinCompanyId}
            secteurs={secteurs}
            planStatus={planStatus}
            onSecteursChanged={() => loadSecteursInfo(secteurs.companyId).then(setSecteurs)}
            accounts={accounts}
            entries={entries}
            products={products}
            productImages={productImages}
            invoices={invoices}
            suppliers={suppliers}
            purchases={purchases}
            movements={movements}
            clients={clients}
            auditLog={auditLog}
            employees={employees}
            payslips={payslips}
            salaryAdvances={salaryAdvances}
            salesStations={salesStations}
            assets={assets}
            accruals={accruals}
            deferrals={deferrals}
            riskProvisions={riskProvisions}
            loans={loans}
            entryTemplates={entryTemplates}
            pendingApprovals={pendingApprovals}
            cheques={cheques}
            setCheques={setCheques}
            bizdocs={bizdocs}
            setBizdocs={setBizdocs}
            ecole={ecole}
            setEcole={setEcole}
            impex={impex}
            setImpex={setImpex}
            sante={sante}
            setSante={setSante}
            setAccounts={setAccounts}
            setEntries={setEntries}
            setProducts={setProducts}
            setProductImages={setProductImages}
            setInvoices={setInvoices}
            setSuppliers={setSuppliers}
            setPurchases={setPurchases}
            setMovements={setMovements}
            setClients={setClients}
            setEmployees={setEmployees}
            setPayslips={setPayslips}
            setSalaryAdvances={setSalaryAdvances}
            setSalesStations={setSalesStations}
            setAssets={setAssets}
            setAccruals={setAccruals}
            setDeferrals={setDeferrals}
            setRiskProvisions={setRiskProvisions}
            setLoans={setLoans}
            setEntryTemplates={setEntryTemplates}
            setPendingApprovals={setPendingApprovals}
            showToast={showToast}
            logAudit={logAudit}
            planTier={planTier}
            groupId={groupId}
            groupName={groupName}
            groupMaxCompanies={groupMaxCompanies}
          />
        )}
        {active === "admin" && role !== "Administrateur" && (
          <div className="p-4 md:p-8 max-w-6xl">
            <div className="rounded-lg p-10 text-center bg-white" style={{ border: "1px dashed #DDD6C4" }}>
              <Lock size={24} className="mx-auto mb-3" style={{ color: "#A6432F" }} />
              <div className="display text-xl mb-2" style={{ color: "#152238" }}>Accès restreint</div>
              <p className="text-sm" style={{ color: "#8A8370" }}>Seul un compte avec le rôle Administrateur peut accéder à l'administration et aux paramètres.</p>
            </div>
          </div>
        )}
        {active === "rh" && role === "Administrateur" && (
          <PayrollModule
            accounts={accounts}
            setAccounts={setAccounts}
            entries={entries}
            setEntries={setEntries}
            employees={employees}
            setEmployees={setEmployees}
            payslips={payslips}
            setPayslips={setPayslips}
            salaryAdvances={salaryAdvances}
            setSalaryAdvances={setSalaryAdvances}
            settings={settings}
            setSettings={setSettings}
            role={role}
            showToast={showToast}
            logAudit={logAudit}
            verifyTransactionSaved={verifyTransactionSaved}
            planTier={planTier}
            recordPendingRecommendation={recordPendingRecommendation}
            currentUserEmail={currentUserEmail}
            pendingRecommendations={pendingRecommendations}
            resolvePendingRecommendation={resolvePendingRecommendation}
          />
        )}
        {active === "rh" && role !== "Administrateur" && (
          <div className="p-4 md:p-8 max-w-6xl">
            <div className="rounded-lg p-10 text-center bg-white" style={{ border: "1px dashed #DDD6C4" }}>
              <Lock size={24} className="mx-auto mb-3" style={{ color: "#A6432F" }} />
              <div className="display text-xl mb-2" style={{ color: "#152238" }}>Accès restreint</div>
              <p className="text-sm" style={{ color: "#8A8370" }}>Les données de salaires sont confidentielles — seul un compte avec le rôle Administrateur peut y accéder.</p>
            </div>
          </div>
        )}
        {active !== "dashboard" && active !== "compta" && active !== "caisse" && active !== "vente" && active !== "achat" && active !== "stock" && active !== "crm" && active !== "rapports" && active !== "admin" && active !== "rh" && active !== "gestion" && active !== "ecole" && active !== "impex" && active !== "sante" && active !== "superadmin" && active !== "centredegestion" && active !== "groupdashboard" && active !== "groupdashboard" && (
          <ComingSoon module={MODULES.find((m) => m.id === active)} />
        )}
        </div>
        {active === "superadmin" && isPlatformAdmin && (
          <SuperAdminModule showToast={showToast} />
        )}
        {active === "centredegestion" && isManagementCollaborator && (
          <CentreDeGestionModule showToast={showToast} currentUserEmail={currentUserEmail} isPlatformAdmin={isPlatformAdmin} />
        )}
        </>
        )}
      </main>
      </div>

      {toast && (
        <div
          className="fixed bottom-6 right-6 px-4 py-3 rounded shadow-lg text-sm no-print"
          style={{ background: "#152238", color: "#EFE9DD", border: "1px solid #C9A24B" }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}


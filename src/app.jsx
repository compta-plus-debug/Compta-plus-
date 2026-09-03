// Version "sans build" : pas d'imports ES module — React, ainsi que les icônes et
// graphiques ci-dessous (remplaçant lucide-react et recharts), sont des variables
// globales chargées directement par <script> dans index.html.
const { useState, useEffect, useMemo } = React;

// --- Supabase (chargé via CDN dans index.html, expose window.supabase.createClient) ---
const SUPABASE_URL = "https://cnmmxpwlgovzbcfqaxqm.supabase.co";
// Version affichée dans le pied de la barre latérale — à incrémenter à chaque
// livraison, en même temps que le cache-buster ?v=... d'index.html, pour pouvoir
// vérifier en un coup d'œil dans l'app elle-même quelle version tourne réellement,
// sans avoir besoin des outils développeur (peu pratiques sur mobile).
const APP_VERSION = "20260830-32";
const SUPABASE_ANON_KEY = "sb_publishable_Ba1KJd2YY-eLaCy1FRECIA_C1DoyAjL";
let _supabaseClient = null;
function supabaseClient() {
  if (!_supabaseClient) {
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error("Supabase n'est pas encore chargé — rechargez la page dans quelques secondes.");
    }
    _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        fetch: (url, options = {}) => fetch(url, { ...options, cache: "no-store" }),
      },
    });
  }
  return _supabaseClient;
}
const supabase = new Proxy({}, {
  get(_target, prop) {
    const client = supabaseClient();
    const value = client[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
});

let _membership = null; // { companyId, role, email, planStatus, trialEndsAt, companyName, isNewCompany } — mis en cache après résolution
let _membershipPromise = null; // dédoublonnage : un seul appel réel à la fois

// Journalisation de diagnostic TEMPORAIRE (table debug_login_log, voir
// debug-login-log.sql) — best-effort, ne doit jamais faire échouer le flux réel même
// si l'insertion elle-même échoue (ex. table pas encore créée).
async function dlog(step, detail) {
  try { await supabase.from("debug_login_log").insert({ step, detail: detail || {} }); } catch (e) {}
}

// Point d'entrée public : garantit qu'une seule résolution tourne réellement à la
// fois. Le composant App() (et son propre remontage possible à chaque changement de
// session déclenché par onAuthStateChange) peut appeler resolveMembership()
// plusieurs fois en rafale en quelques millisecondes — sans ce verrou, chaque appel
// relance sa propre vérification depuis zéro, et les journaux montrent qu'aucune de
// ces tentatives concurrentes ne va jamais jusqu'au bout (probablement un
// verrou interne de session chez Supabase qui bloque les accès simultanés). Tous les
// appels concurrents attendent maintenant le résultat du même appel en cours au lieu
// d'en déclencher un nouveau.
async function resolveMembership() {
  if (_membership) {
    // L'identité (entreprise/rôle) reste en cache — coûteuse à revérifier et très
    // stable. Mais plan_status/plan_tier/etc. peuvent changer À TOUT MOMENT depuis
    // Super Admin (activation, suspension, changement de forfait) : les relire à
    // chaque appel évite qu'un simple rafraîchissement de page (parfois restauré
    // depuis le bfcache du navigateur, sans réexécuter tout le script) affiche un
    // état figé jusqu'à une déconnexion/reconnexion complète.
    try {
      let { data: co, error: coErr } = await supabase.from("companies").select("name, plan_status, plan_tier, trial_ends_at, security_pin_hash").eq("id", _membership.companyId).single();
      if (coErr && coErr.code === "42703") {
        const retry = await supabase.from("companies").select("name, plan_status, trial_ends_at").eq("id", _membership.companyId).single();
        co = retry.data;
      }
      if (co) {
        _membership = {
          ..._membership,
          companyName: co.name,
          planStatus: co.plan_status || "trial",
          planTier: co.plan_tier || "standard",
          trialEndsAt: co.trial_ends_at,
          hasSecurityPin: !!co.security_pin_hash,
        };
      }
    } catch (e) { /* échec de la relecture : on garde la dernière valeur connue plutôt que de bloquer */ }
    dlog("cache_hit_refreshed", { companyId: _membership.companyId, planStatus: _membership.planStatus, planTier: _membership.planTier });
    return _membership;
  }
  if (_membershipPromise) { await dlog("dedup_wait", {}); return _membershipPromise; }
  _membershipPromise = resolveMembershipInner().finally(() => { _membershipPromise = null; });
  return _membershipPromise;
}

async function resolveMembershipInner() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Utilisateur non connecté");
  await dlog("start", { email: user.email, uid: user.id });

  // Juste après l'établissement d'une nouvelle session (ex. clic sur le lien de
  // connexion), le client interne peut mettre un court instant à propager le jeton
  // d'authentification vers les requêtes REST/RPC — auth.jwt() peut alors apparaître
  // vide côté serveur pendant cette fenêtre, faisant échouer silencieusement (sans
  // erreur) la recherche d'invitation par email. On attend que le jeton soit bien
  // rattaché à la session avant de continuer, avec une petite marge de sécurité.
  let sessionReady = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data: { session: s } } = await supabase.auth.getSession();
    if (s?.access_token) { sessionReady = true; break; }
    await new Promise((r) => setTimeout(r, 200));
  }
  await dlog("session_wait", { sessionReady });

  // Lien d'invitation à jeton (?invite=<uuid> dans l'URL) : mécanisme plus robuste
  // que la correspondance par email, ne dépend d'aucun claim JWT particulier ni
  // d'aucune casse/orthographe d'email — seule la connaissance du jeton exact compte.
  // Prioritaire sur tout le reste : un lien d'invitation explicite est une intention
  // sans ambiguïté.
  let inviteToken = null;
  try {
    const params = new URLSearchParams(window.location.search);
    inviteToken = params.get("invite");
  } catch (e) {}
  if (inviteToken) {
    await dlog("token_invite_detected", { token: inviteToken });
    const { data: tokenRows, error: tokenErr } = await supabase
      .from("company_members")
      .select("id, company_id, role, email")
      .eq("invite_token", inviteToken)
      .is("user_id", null)
      .limit(1);
    await dlog("token_invite_lookup", { count: tokenRows?.length ?? null, error: tokenErr ? (tokenErr.message || tokenErr.code) : null });
    const tokenInvite = tokenRows && tokenRows[0];
    if (tokenInvite) {
      // Sécurité : le lien seul ne suffit pas — il faut aussi se connecter avec
      // l'adresse email précise à laquelle l'invitation a été envoyée. Sans ce
      // verrou, quiconque intercepterait ou ferait suivre le lien pourrait
      // l'utiliser avec n'importe quel email pour accéder à l'entreprise.
      const emailMatches = tokenInvite.email && tokenInvite.email.toLowerCase() === (user.email || "").toLowerCase();
      await dlog("token_email_check", { expected: tokenInvite.email, got: user.email, emailMatches });
      if (!emailMatches) {
        try { window.history.replaceState({}, "", window.location.pathname); } catch (e) {}
        throw new Error(
          `Ce lien d'invitation a été envoyé à l'adresse ${tokenInvite.email} — vous êtes connecté(e) avec ${user.email}. ` +
          `Déconnectez-vous et reconnectez-vous avec l'adresse exacte à laquelle l'invitation a été envoyée.`
        );
      }
      // La validation (UPDATE) peut échouer avec une erreur RLS explicite dans la
      // toute première fraction de seconde après l'obtention de la session — même
      // avec le jeton d'authentification déjà présent, le serveur peut mettre un
      // instant de plus à le reconnaître pleinement pour CETTE requête précise. On
      // réessaie automatiquement quelques fois avant d'abandonner.
      let claimedByToken = null, tokenClaimErr = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await supabase
          .from("company_members")
          .update({ user_id: user.id })
          .eq("id", tokenInvite.id)
          .select("id");
        claimedByToken = res.data;
        tokenClaimErr = res.error;
        await dlog("token_claim_attempt", { attempt, claimedCount: claimedByToken?.length ?? null, error: tokenClaimErr ? (tokenClaimErr.message || tokenClaimErr.code) : null });
        if (!tokenClaimErr && claimedByToken && claimedByToken.length > 0) break;
        if (tokenClaimErr && tokenClaimErr.code !== "42501" && !(tokenClaimErr.message || "").includes("row-level security")) break; // autre type d'erreur : pas la peine de réessayer
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
      if (!tokenClaimErr && claimedByToken && claimedByToken.length > 0) {
        try { window.history.replaceState({}, "", window.location.pathname); } catch (e) {}
        await dlog("token_claimed_ok", { companyId: tokenInvite.company_id });
        return finish({ companyId: tokenInvite.company_id, role: tokenInvite.role, email: user.email });
      }
      // Échec persistant après tous les réessais.
      try { window.history.replaceState({}, "", window.location.pathname); } catch (e) {}
      throw new Error(
        `Votre invitation a été trouvée mais n'a pas pu être finalisée` +
        (tokenClaimErr ? ` (${tokenClaimErr.message || tokenClaimErr.code})` : " (aucune ligne mise à jour)") +
        `. Une nouvelle entreprise n'a pas été créée pour éviter de dupliquer vos données — contactez le support avec ce message.`
      );
    }
    // Jeton présent mais invalide/déjà utilisé/expiré/révoqué : on continue avec le
    // mécanisme habituel par email plutôt que de bloquer — le lien peut avoir déjà
    // été ouvert une première fois avec succès, ou avoir été révoqué entre-temps.
  }

  const finish = async (base) => {
    // Complète toujours avec les infos d'essai/abonnement de l'entreprise (sauf si on
    // vient de la créer à l'instant, auquel cas on les a déjà via l'insert ci-dessous).
    if (base.planStatus === undefined) {
      let { data: co, error: coErr } = await supabase.from("companies").select("name, plan_status, plan_tier, trial_ends_at, security_pin_hash").eq("id", base.companyId).single();
      if (coErr && coErr.code === "42703") {
        // Colonne security_pin_hash ou plan_tier pas encore migrée : repli sans elles.
        const retry = await supabase.from("companies").select("name, plan_status, trial_ends_at").eq("id", base.companyId).single();
        co = retry.data;
      }
      base.companyName = co?.name;
      base.planStatus = co?.plan_status || "trial";
      base.planTier = co?.plan_tier || "standard";
      base.trialEndsAt = co?.trial_ends_at;
      base.hasSecurityPin = !!co?.security_pin_hash;
    } else if (base.hasSecurityPin === undefined) {
      base.hasSecurityPin = false;
    }
    if (base.planTier === undefined) base.planTier = "standard";
    _membership = base;
    return _membership;
  };

  let { data: existingRows, error: existingErr } = await supabase
    .from("company_members")
    .select("company_id, role, email, is_assisted_supervisor")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  await dlog("existing_check", { count: existingRows?.length ?? null, error: existingErr ? (existingErr.message || existingErr.code) : null, rows: existingRows });
  if (existingErr) {
    throw new Error(`Impossible de vérifier votre entreprise (${existingErr.message || existingErr.code || "erreur inconnue"}). Une nouvelle entreprise n'a pas été créée pour éviter de dupliquer vos données — contactez le support avec ce message.`);
  }
  if (existingRows && existingRows.length > 1) {
    // Appartenance à plusieurs entreprises : on ne choisit jamais silencieusement —
    // soit une préférence a déjà été mémorisée pour CE compte sur CET appareil (clé
    // dédiée par user.id, jamais partagée entre comptes), soit on renvoie la liste
    // complète pour que App() affiche un sélecteur explicite avant de continuer.
    let preferredId = null;
    try { preferredId = window.localStorage.getItem(`compta_preferred_company_${user.id}`); } catch (e) {}
    const preferred = preferredId && existingRows.find((r) => r.company_id === preferredId);
    if (preferred) {
      await dlog("multi_company_preferred", { companyId: preferred.company_id, total: existingRows.length });
      return finish({ companyId: preferred.company_id, role: preferred.role, email: preferred.email, isAssistedSupervisor: !!preferred.is_assisted_supervisor });
    }
    const { data: namedCompanies } = await supabase.from("companies").select("id, name").in("id", existingRows.map((r) => r.company_id));
    const options = existingRows.map((r) => ({
      companyId: r.company_id, role: r.role,
      name: namedCompanies?.find((c) => c.id === r.company_id)?.name || "(sans nom)",
    }));
    await dlog("multi_company_needs_pick", { total: options.length });
    return { needsCompanyPick: true, options, email: user.email };
  }
  const existing = existingRows && existingRows[0];
  if (existing) {
    await dlog("joined_existing", { companyId: existing.company_id, role: existing.role });
    return finish({ companyId: existing.company_id, role: existing.role, email: existing.email, isAssistedSupervisor: !!existing.is_assisted_supervisor });
  }

  let { data: inviteRows, error: inviteErr } = await supabase
    .from("company_members")
    .select("id, company_id, role")
    .ilike("email", user.email)
    .is("user_id", null)
    .order("created_at", { ascending: true })
    .limit(1);
  await dlog("invite_check_1", { count: inviteRows?.length ?? null, error: inviteErr ? (inviteErr.message || inviteErr.code) : null, rows: inviteRows, searchedEmail: user.email });
  if (inviteErr) {
    throw new Error(`Impossible de vérifier votre invitation (${inviteErr.message || inviteErr.code || "erreur inconnue"}). Une nouvelle entreprise n'a pas été créée pour éviter de dupliquer vos données — contactez le support avec ce message.`);
  }
  // Filet de sécurité supplémentaire : si rien n'est trouvé du premier coup, un
  // nouveau réessai après une pause couvre le cas où le jeton d'authentification
  // n'était pas encore pleinement propagé à cette requête précise (voir commentaire
  // plus haut) — avant de conclure qu'il n'existe vraiment aucune invitation.
  if (!inviteRows || inviteRows.length === 0) {
    await new Promise((r) => setTimeout(r, 800));
    const retry = await supabase
      .from("company_members")
      .select("id, company_id, role")
      .ilike("email", user.email)
      .is("user_id", null)
      .order("created_at", { ascending: true })
      .limit(1);
    await dlog("invite_check_retry", { count: retry.data?.length ?? null, error: retry.error ? (retry.error.message || retry.error.code) : null, rows: retry.data });
    if (!retry.error && retry.data && retry.data.length > 0) inviteRows = retry.data;
  }
  const invite = inviteRows && inviteRows[0];
  if (invite) {
    await dlog("invite_found", { inviteId: invite.id, companyId: invite.company_id, role: invite.role });
    let claimedRows = null, claimErr = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await supabase
        .from("company_members")
        .update({ user_id: user.id })
        .eq("id", invite.id)
        .select("id");
      claimedRows = res.data;
      claimErr = res.error;
      await dlog("claim_attempt", { attempt, claimedCount: claimedRows?.length ?? null, error: claimErr ? (claimErr.message || claimErr.code) : null });
      if (!claimErr && claimedRows && claimedRows.length > 0) break;
      if (claimErr && claimErr.code !== "42501" && !(claimErr.message || "").includes("row-level security")) break;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
    if (claimErr || !claimedRows || claimedRows.length === 0) {
      throw new Error(
        `Votre invitation a été trouvée mais n'a pas pu être finalisée` +
        (claimErr ? ` (${claimErr.message || claimErr.code})` : " (aucune ligne mise à jour, probablement bloqué par une règle de sécurité)") +
        `. Une nouvelle entreprise n'a pas été créée pour éviter de dupliquer vos données — contactez le support avec ce message.`
      );
    }
    await dlog("claimed_ok", { companyId: invite.company_id });
    return finish({ companyId: invite.company_id, role: invite.role, email: user.email });
  }
  await dlog("no_invite_found_fallback", {});

  // Marqueur d'essai gratuit par appareil : empêche la réutilisation facile et
  // occasionnelle du même appareil pour recréer un nouvel essai gratuit avec une
  // adresse email différente à chaque fois qu'un essai précédent expire. Un jeton
  // aléatoire persistant est stocké localement dès la première création
  // d'entreprise ; toute tentative ultérieure de création automatique depuis ce
  // même appareil est bloquée avec une invitation à contacter le support plutôt
  // qu'à obtenir un nouvel essai silencieusement. Limite assumée : n'empêche pas
  // quelqu'un de déterminé à changer de navigateur ou vider son stockage — sert de
  // barrière contre la réutilisation facile, pas de protection infaillible.
  let deviceId = null;
  try {
    deviceId = localStorage.getItem("compta-plus-device-id");
    if (!deviceId) {
      deviceId = genInviteToken();
      localStorage.setItem("compta-plus-device-id", deviceId);
    }
  } catch (e) {}
  let trialAlreadyUsed = false;
  try { trialAlreadyUsed = !!localStorage.getItem("compta-plus-trial-used"); } catch (e) {}

  if (trialAlreadyUsed) {
    try { await supabase.auth.signOut(); } catch (e) {}
    throw new Error(
      `Un essai gratuit a déjà été utilisé depuis cet appareil. Si vous pensiez rejoindre une entreprise existante, reconnectez-vous avec l'adresse email exacte de votre invitation. Si vous êtes une nouvelle entreprise légitime, contactez le support pour activer votre compte.`
    );
  }

  // Aucune invitation trouvée pour cet email : avant de créer une entreprise vierge
  // (correct pour un tout premier utilisateur, mais dangereux si une invitation
  // existait sous une adresse légèrement différente), on demande une confirmation
  // explicite en affichant l'email exact recherché.
  const proceedWithNewCompany = window.confirm(
    `Aucune entreprise ni invitation trouvée pour l'adresse : ${user.email}\n\n` +
    `Si vous pensiez rejoindre une entreprise existante suite à une invitation, cliquez Annuler, déconnectez-vous, et reconnectez-vous avec l'adresse email EXACTE où l'invitation a été envoyée (vérifiez l'orthographe, les espaces, le domaine @...).\n\n` +
    `Cliquez OK pour continuer et créer une nouvelle entreprise vierge avec cette adresse.`
  );
  if (!proceedWithNewCompany) {
    try { await supabase.auth.signOut(); } catch (e) {}
    throw new Error(`Connexion annulée — reconnectez-vous avec l'adresse email exacte de votre invitation.`);
  }

  // Génère l'identifiant nous-mêmes plutôt que de le demander à Supabase après
  // coup : chaîner .select() après .insert() forçait une relecture immédiate de
  // la ligne tout juste créée, soumise à la règle "qui peut VOIR une entreprise"
  // (is_company_member) — qui échoue forcément puisque le rattachement de
  // l'utilisateur à cette entreprise ne se fait qu'à l'étape suivante. C'est la
  // vraie cause du blocage RLS identifiée par le support Supabase (Cameron
  // Blackwood) — en connaissant déjà l'id, on n'a plus jamais besoin de cette
  // relecture, donc plus jamais besoin de satisfaire cette règle à ce stade.
  const newCompanyId = crypto.randomUUID();
  let { error: companyErr } = await supabase
    .from("companies")
    .insert({ id: newCompanyId, name: `Mon Entreprise (${crypto.randomUUID().slice(0, 8)})`, signup_device_id: deviceId });
  if (companyErr && companyErr.code === "42703") {
    // La colonne signup_device_id n'existe pas encore (migration pas encore
    // exécutée) : on retente sans elle plutôt que de bloquer toute inscription.
    const retry = await supabase.from("companies").insert({ id: newCompanyId, name: `Mon Entreprise (${crypto.randomUUID().slice(0, 8)})` });
    companyErr = retry.error;
  }
  if (companyErr) {
    throw new Error(`Impossible de créer votre entreprise (${companyErr.message || companyErr.code || "erreur inconnue"}). Contactez le support avec ce message.`);
  }
  const company = { id: newCompanyId };

  let { error: memberErr } = await supabase.from("company_members").insert({
    company_id: company.id, email: user.email, user_id: user.id, role: "Administrateur", is_primary_admin: true,
  });
  if (memberErr && memberErr.code === "42703") {
    // Colonne is_primary_admin pas encore migrée : retente sans elle plutôt que de
    // bloquer toute inscription.
    const retryInsert = await supabase.from("company_members").insert({
      company_id: company.id, email: user.email, user_id: user.id, role: "Administrateur",
    });
    memberErr = retryInsert.error;
  }
  if (memberErr) {
    // Le verrou "un email = une seule entreprise" (index unique en base) a bloqué
    // cette création — ça veut dire qu'une ligne existait déjà pour cet email mais
    // que la lecture précédente ne l'avait pas trouvée (ex. réplication en retard).
    // On supprime l'entreprise vide qu'on vient de créer par erreur, puis on relit
    // la vraie ligne existante au lieu de dupliquer.
    await supabase.from("companies").delete().eq("id", company.id);
    if (memberErr.code === "23505") {
      const { data: retryRows } = await supabase
        .from("company_members")
        .select("company_id, role, email")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1);
      const retry = retryRows && retryRows[0];
      if (retry) return finish({ companyId: retry.company_id, role: retry.role, email: retry.email });
    }
    throw new Error(`Impossible de finaliser la création de votre entreprise (${memberErr.message || memberErr.code}). Contactez le support avec ce message.`);
  }

  // Le flag "essai déjà utilisé" n'est posé qu'ICI, une fois les DEUX étapes
  // (entreprise + rattachement du membre) confirmées réussies — jamais avant,
  // sinon un échec réseau sur l'étape suivante verrouillait l'appareil de façon
  // permanente : la vraie entreprise créée était supprimée en cas d'échec, mais
  // le flag local restait posé, bloquant toute nouvelle tentative (déconnexion
  // automatique immédiate) même pour un nouvel essai parfaitement légitime.
  try { localStorage.setItem("compta-plus-trial-used", new Date().toISOString()); } catch (e) {}

  return finish({
    companyId: company.id, role: "Administrateur", email: user.email,
    companyName: company.name, planStatus: company.plan_status || "trial", trialEndsAt: company.trial_ends_at,
    isNewCompany: true,
  });
}

function clearMembershipCache() {
  _membership = null;
}

// Force une relecture de resolveMembership (ex. après avoir renommé l'entreprise
// lors de l'écran de bienvenue, pour rafraîchir companyName sans se déconnecter).
async function refreshMembership() {
  _membership = null;
  return resolveMembership();
}

// Mémorise le choix explicite de l'utilisateur quand plusieurs entreprises lui sont
// accessibles (clé dédiée à ce compte précis sur cet appareil, jamais partagée
// entre comptes) puis force une nouvelle résolution qui utilisera ce choix.
async function chooseCompany(companyId, userId) {
  try { window.localStorage.setItem(`compta_preferred_company_${userId}`, companyId); } catch (e) {}
  _membership = null;
  return resolveMembership();
}

// Efface le choix mémorisé, pour permettre de changer d'entreprise plus tard sans
// devoir se déconnecter complètement — utilisé par le lien "Changer d'entreprise".
function forgetCompanyChoice(userId) {
  try { window.localStorage.removeItem(`compta_preferred_company_${userId}`); } catch (e) {}
  _membership = null;
}

window.storage = {
  async get(key) {
    const { companyId } = await resolveMembership();
    const { data, error } = await supabase.from("kv_store").select("value").eq("company_id", companyId).eq("key", key).maybeSingle();
    if (error || !data) return null;
    return { key, value: data.value, shared: false };
  },
  async set(key, value) {
    const { companyId } = await resolveMembership();
    const { error } = await supabase.from("kv_store").upsert({ company_id: companyId, key, value, updated_at: new Date().toISOString() }, { onConflict: "company_id,key" });
    if (error) throw error;
    return { key, value, shared: false };
  },
  async delete(key) {
    const { companyId } = await resolveMembership();
    const { error } = await supabase.from("kv_store").delete().eq("company_id", companyId).eq("key", key);
    return { key, deleted: !error, shared: false };
  },
  async list(prefix = "") {
    const { companyId } = await resolveMembership();
    const { data, error } = await supabase.from("kv_store").select("key").eq("company_id", companyId).like("key", `${prefix}%`);
    if (error) return { keys: [], prefix, shared: false };
    return { keys: (data || []).map((d) => d.key), prefix, shared: false };
  },
};

// --- Écran de connexion (lien magique par email) ---
function AuthGate({ children }) {
  const [session, setSession] = useState(undefined);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [showLogin, setShowLogin] = useState(false);
  // Niveau d'authentification MFA de la session en cours : null = pas encore vérifié,
  // sinon { current, next }. Si next === "aal2" et current !== "aal2", un facteur de
  // double authentification est enregistré sur ce compte et doit être vérifié avant
  // d'accéder à l'application, même si le lien magique (1er facteur) est déjà validé.
  const [mfaLevel, setMfaLevel] = useState(null);
  const [mfaChecked, setMfaChecked] = useState(false);
  // Contournement via code de secours : Supabase ne "sait" pas qu'un code de secours
  // a été utilisé (ce n'est pas son mécanisme MFA natif), donc son propre niveau
  // d'authentification (aal2) ne change pas — on mémorise ce contournement séparément,
  // pour la durée de la session (onglet), pour ne pas redemander en boucle.
  const [mfaBypassed, setMfaBypassed] = useState(() => {
    try { return sessionStorage.getItem("compta-plus-mfa-backup-used") === "true"; } catch (e) { return false; }
  });

  const refreshMfaLevel = async () => {
    setMfaChecked(false);
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!error && data) setMfaLevel({ current: data.currentLevel, next: data.nextLevel });
    setMfaChecked(true);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) refreshMfaLevel();
    else { setMfaLevel(null); setMfaChecked(false); }
  }, [session]);

  const sendLink = async (e) => {
    e.preventDefault();
    setError("");
    // Si un lien d'invitation à jeton a amené la personne ici (?invite=...), on le
    // préserve dans l'URL de redirection du lien magique — sinon il se perdrait au
    // retour et l'invitation ne pourrait jamais être réclamée.
    const basePath = window.location.href.split(/[?#]/)[0];
    const inviteParam = new URLSearchParams(window.location.search).get("invite");
    const redirectTo = inviteParam ? `${basePath}?invite=${encodeURIComponent(inviteParam)}` : basePath;
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    if (error) setError(error.message);
    else setSent(true);
  };

  const signOut = () => {
    clearMembershipCache();
    try { sessionStorage.removeItem("compta-plus-mfa-backup-used"); } catch (e) {}
    supabase.auth.signOut();
  };

  if (session === undefined) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "sans-serif", color: "#152238" }}>
        Chargement…
      </div>
    );
  }

  if (!session && !showLogin) {
    return <LandingPage onStart={() => setShowLogin(true)} />;
  }

  if (!session) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "linear-gradient(160deg, #F4FBE8 0%, #DFF0BE 55%, #C7E296 100%)", fontFamily: "sans-serif" }}>
        <form onSubmit={sendLink} style={{ background: "#fff", padding: 32, borderRadius: 8, border: "1px solid #E4DFD1", width: 320 }}>
          <button type="button" onClick={() => setShowLogin(false)} style={{ background: "none", border: "none", color: "#8A8370", fontSize: 12, marginBottom: 12, cursor: "pointer", padding: 0 }}>
            ← Retour à l'accueil
          </button>
          <h1 style={{ fontSize: 20, marginBottom: 4, color: "#152238" }}>Compta+</h1>
          <p style={{ fontSize: 13, color: "#8A8370", marginBottom: 16 }}>
            Connectez-vous pour retrouver vos données sur tous vos appareils.
          </p>
          {sent ? (
            <p style={{ fontSize: 13, color: "#0F6B5C" }}>
              Lien de connexion envoyé à <strong>{email}</strong>. Vérifiez votre boîte mail et cliquez sur le lien.
            </p>
          ) : (
            <>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="votre@email.com"
                style={{ width: "100%", padding: 8, marginBottom: 12, border: "1px solid #DDD6C4", borderRadius: 4, boxSizing: "border-box" }} />
              <button type="submit" style={{ width: "100%", padding: 10, background: "#152238", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
                Recevoir le lien de connexion
              </button>
              {error && <p style={{ color: "#A6432F", fontSize: 12, marginTop: 8 }}>{error}</p>}
            </>
          )}
        </form>
      </div>
    );
  }

  if (!mfaChecked) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "sans-serif", color: "#152238" }}>
        Chargement…
      </div>
    );
  }

  if (mfaLevel && mfaLevel.next === "aal2" && mfaLevel.current !== "aal2" && !mfaBypassed) {
    return <MfaChallengeScreen onVerified={(viaBackup) => { if (viaBackup) setMfaBypassed(true); else refreshMfaLevel(); }} onSignOut={signOut} />;
  }

  return <>{children}</>;
}

// --- Étape de vérification du code à 6 chiffres (2FA), affichée après le lien magique
// si le compte a un facteur TOTP enregistré. Bloque l'accès à l'application tant que le
// code n'est pas validé. Propose aussi un code de secours à usage unique en repli, pour
// le cas où l'appareil habituel (avec l'application d'authentification) est perdu.
function MfaChallengeScreen({ onVerified, onSignOut }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [useBackup, setUseBackup] = useState(false);
  const [backupCode, setBackupCode] = useState("");

  const verify = async (e) => {
    e.preventDefault();
    setError("");
    setVerifying(true);
    try {
      const { data: factors, error: listErr } = await supabase.auth.mfa.listFactors();
      if (listErr) throw listErr;
      const factor = (factors?.totp || []).find((f) => f.status === "verified") || (factors?.totp || [])[0];
      if (!factor) throw new Error("Aucun facteur de double authentification trouvé.");
      const { data: challenge, error: challErr } = await supabase.auth.mfa.challenge({ factorId: factor.id });
      if (challErr) throw challErr;
      const { error: verifyErr } = await supabase.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code: code.trim() });
      if (verifyErr) throw verifyErr;
      await onVerified();
    } catch (err) {
      setError(err.message || "Code invalide.");
    } finally {
      setVerifying(false);
    }
  };

  const verifyBackup = async (e) => {
    e.preventDefault();
    setError("");
    setVerifying(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc("verify_mfa_backup_code", { code_attempt: backupCode.trim() });
      if (rpcErr) throw rpcErr;
      if (data !== true) throw new Error("Code de secours invalide ou déjà utilisé.");
      // Le code de secours remplace la vérification TOTP pour cette session — mémorisé
      // pour que l'accès normal (sans redemander) continue tant que la session dure.
      try { sessionStorage.setItem("compta-plus-mfa-backup-used", "true"); } catch (e) {}
      await onVerified(true);
    } catch (err) {
      setError(err.message || "Code de secours invalide.");
    } finally {
      setVerifying(false);
    }
  };

  if (useBackup) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "linear-gradient(160deg, #F4FBE8 0%, #DFF0BE 55%, #C7E296 100%)", fontFamily: "sans-serif" }}>
        <form onSubmit={verifyBackup} style={{ background: "#fff", padding: 32, borderRadius: 8, border: "1px solid #E4DFD1", width: 320 }}>
          <h1 style={{ fontSize: 18, marginBottom: 4, color: "#152238" }}>Code de secours</h1>
          <p style={{ fontSize: 13, color: "#8A8370", marginBottom: 16 }}>
            Entrez l'un des codes de secours reçus lors de l'activation de la double authentification. Chaque code ne fonctionne qu'une seule fois.
          </p>
          <input type="text" autoFocus required value={backupCode}
            onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX"
            style={{ width: "100%", padding: 8, marginBottom: 12, border: "1px solid #DDD6C4", borderRadius: 4, boxSizing: "border-box", fontSize: 18, letterSpacing: 2, textAlign: "center" }} />
          <button type="submit" disabled={verifying || !backupCode.trim()} style={{ width: "100%", padding: 10, background: "#152238", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", opacity: verifying || !backupCode.trim() ? 0.6 : 1 }}>
            {verifying ? "Vérification…" : "Valider"}
          </button>
          {error && <p style={{ color: "#A6432F", fontSize: 12, marginTop: 8 }}>{error}</p>}
          <button type="button" onClick={() => { setUseBackup(false); setError(""); }} style={{ background: "none", border: "none", color: "#8A8370", fontSize: 12, marginTop: 16, cursor: "pointer", padding: 0, display: "block" }}>
            ← Revenir au code à 6 chiffres
          </button>
          <button type="button" onClick={onSignOut} style={{ background: "none", border: "none", color: "#8A8370", fontSize: 12, marginTop: 8, cursor: "pointer", padding: 0, display: "block" }}>
            Se déconnecter
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "linear-gradient(160deg, #F4FBE8 0%, #DFF0BE 55%, #C7E296 100%)", fontFamily: "sans-serif" }}>
      <form onSubmit={verify} style={{ background: "#fff", padding: 32, borderRadius: 8, border: "1px solid #E4DFD1", width: 320 }}>
        <h1 style={{ fontSize: 18, marginBottom: 4, color: "#152238" }}>Vérification en deux étapes</h1>
        <p style={{ fontSize: 13, color: "#8A8370", marginBottom: 16 }}>
          Entrez le code à 6 chiffres généré par votre application d'authentification (Google Authenticator, Authy…).
        </p>
        <input type="text" inputMode="numeric" autoFocus required value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="123456" maxLength={6}
          style={{ width: "100%", padding: 8, marginBottom: 12, border: "1px solid #DDD6C4", borderRadius: 4, boxSizing: "border-box", fontSize: 20, letterSpacing: 4, textAlign: "center" }} />
        <button type="submit" disabled={verifying || code.length !== 6} style={{ width: "100%", padding: 10, background: "#152238", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", opacity: verifying || code.length !== 6 ? 0.6 : 1 }}>
          {verifying ? "Vérification…" : "Vérifier"}
        </button>
        {error && <p style={{ color: "#A6432F", fontSize: 12, marginTop: 8 }}>{error}</p>}
        <button type="button" onClick={() => { setUseBackup(true); setError(""); }} style={{ background: "none", border: "none", color: "#5C6B8C", fontSize: 12, marginTop: 16, cursor: "pointer", padding: 0, display: "block" }}>
          Appareil habituel perdu ? Utiliser un code de secours
        </button>
        <button type="button" onClick={onSignOut} style={{ background: "none", border: "none", color: "#8A8370", fontSize: 12, marginTop: 8, cursor: "pointer", padding: 0, display: "block" }}>
          Se déconnecter
        </button>
      </form>
    </div>
  );
}

// --- Panneau "Sécurité du compte" : chaque utilisateur active/désactive sa propre
// double authentification (TOTP), indépendamment de son rôle dans l'entreprise.
function SecurityPanel({ onClose, showToast }) {
  const [factors, setFactors] = useState(null); // null = chargement
  const [enrolling, setEnrolling] = useState(null); // { factorId, qrCode, secret }
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [backupCodes, setBackupCodes] = useState(null); // affichées une seule fois après génération

  const generateBackupCodes = async () => {
    setBusy(true);
    setError("");
    try {
      const { data, error: rpcErr } = await supabase.rpc("generate_mfa_backup_codes");
      if (rpcErr) throw rpcErr;
      setBackupCodes(data || []);
    } catch (err) {
      setError(err.message || "Impossible de générer les codes de secours.");
    } finally {
      setBusy(false);
    }
  };

  const loadFactors = async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) { setError(error.message); setFactors([]); return; }
    setFactors(data?.totp || []);
  };

  useEffect(() => { loadFactors(); }, []);

  const startEnroll = async () => {
    setError("");
    setBusy(true);
    try {
      // Nettoyage préventif : si une tentative précédente a été abandonnée sans
      // aller au bout (ex. navigation arrière du téléphone plutôt que le bouton
      // "Annuler" de l'app), un facteur non vérifié orphelin reste enregistré côté
      // serveur et bloque toute nouvelle tentative avec l'erreur "factor already
      // exists" — on le retire silencieusement avant de réessayer.
      const { data: existingFactors } = await supabase.auth.mfa.listFactors();
      const unverified = (existingFactors?.totp || []).filter((f) => f.status !== "verified");
      for (const f of unverified) {
        await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error) throw error;
      setEnrolling({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    } catch (err) {
      setError(err.message || "Impossible de démarrer l'activation.");
    } finally {
      setBusy(false);
    }
  };

  const confirmEnroll = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { data: challenge, error: challErr } = await supabase.auth.mfa.challenge({ factorId: enrolling.factorId });
      if (challErr) throw challErr;
      const { error: verifyErr } = await supabase.auth.mfa.verify({ factorId: enrolling.factorId, challengeId: challenge.id, code: code.trim() });
      if (verifyErr) throw verifyErr;
      setEnrolling(null);
      setCode("");
      showToast("Double authentification activée.");
      loadFactors();
      await generateBackupCodes();
    } catch (err) {
      setError(err.message || "Code invalide, réessayez.");
    } finally {
      setBusy(false);
    }
  };

  const cancelEnroll = async () => {
    if (enrolling) await supabase.auth.mfa.unenroll({ factorId: enrolling.factorId }).catch(() => {});
    setEnrolling(null);
    setCode("");
    setError("");
  };

  const disable = async (factorId) => {
    if (!window.confirm("Désactiver la double authentification ? Votre compte sera de nouveau protégé par le seul lien magique par email.")) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
      showToast("Double authentification désactivée.");
      loadFactors();
    } catch (err) {
      showToast(err.message || "Impossible de désactiver.");
    } finally {
      setBusy(false);
    }
  };

  const verifiedFactor = (factors || []).find((f) => f.status === "verified");

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(21,34,56,0.5)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 8, padding: 24, width: 360, maxWidth: "100%", maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, color: "#152238", margin: 0 }}>Sécurité du compte</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#8A8370", fontSize: 18 }}>×</button>
        </div>

        {factors === null && <p style={{ fontSize: 13, color: "#8A8370" }}>Chargement…</p>}

        {backupCodes && (
          <div style={{ background: "#FBF1DC", border: "1px solid #E8D9A8", borderRadius: 6, padding: 14, marginBottom: 16 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "#152238", marginBottom: 6 }}>
              Vos codes de secours — à noter maintenant, ils ne seront plus jamais affichés
            </p>
            <p style={{ fontSize: 11, color: "#8A7A4A", marginBottom: 10 }}>
              Chacun ne fonctionne qu'une seule fois, en cas de perte de l'appareil habituel. Conservez-les en lieu sûr (hors de cet appareil, idéalement).
            </p>
            <div className="tabular" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 13, marginBottom: 10 }}>
              {backupCodes.map((c) => <div key={c}>{c}</div>)}
            </div>
            <button
              onClick={() => { navigator.clipboard?.writeText(backupCodes.join("\n")); showToast("Codes copiés."); }}
              style={{ fontSize: 12, background: "none", border: "1px solid #DDD6C4", borderRadius: 4, padding: "4px 10px", cursor: "pointer", color: "#152238", marginRight: 8 }}>
              Copier
            </button>
            <button onClick={() => setBackupCodes(null)} style={{ fontSize: 12, background: "none", border: "none", cursor: "pointer", color: "#8A8370" }}>
              J'ai bien noté mes codes
            </button>
          </div>
        )}

        {factors !== null && !enrolling && (
          <>
            <p style={{ fontSize: 13, color: "#8A8370", marginBottom: 16 }}>
              La double authentification ajoute un code à 6 chiffres (via une application comme Google Authenticator ou Authy) en plus du lien magique par email, pour protéger votre compte même si votre boîte mail est compromise.
            </p>
            {verifiedFactor ? (
              <>
                <p style={{ fontSize: 13, color: "#0F6B5C", marginBottom: 12 }}>✓ Double authentification activée sur ce compte.</p>
                <button onClick={generateBackupCodes} disabled={busy}
                  style={{ width: "100%", padding: 10, marginBottom: 8, background: "#fff", color: "#152238", border: "1px solid #DDD6C4", borderRadius: 4, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
                  Régénérer mes codes de secours
                </button>
                <button onClick={() => disable(verifiedFactor.id)} disabled={busy}
                  style={{ width: "100%", padding: 10, background: "#A6432F", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
                  Désactiver la double authentification
                </button>
              </>
            ) : (
              <button onClick={startEnroll} disabled={busy}
                style={{ width: "100%", padding: 10, background: "#152238", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
                Activer la double authentification
              </button>
            )}
            {error && <p style={{ color: "#A6432F", fontSize: 12, marginTop: 8 }}>{error}</p>}
            {!verifiedFactor && (
              <p style={{ fontSize: 11, color: "#A39C87", marginTop: 16 }}>
                Des codes de secours à usage unique vous seront proposés juste après l'activation, pour le cas où vous perdriez l'appareil habituel.
              </p>
            )}
          </>
        )}

        {enrolling && (
          <form onSubmit={confirmEnroll}>
            <p style={{ fontSize: 13, color: "#8A8370", marginBottom: 12 }}>
              Scannez ce code avec votre application d'authentification, puis entrez le code à 6 chiffres qu'elle affiche.
            </p>
            {enrolling.qrCode && (
              <div style={{ textAlign: "center", marginBottom: 12 }}>
                <img src={enrolling.qrCode} alt="Code QR d'activation" style={{ width: 180, height: 180 }} />
              </div>
            )}
            <p style={{ fontSize: 11, color: "#A39C87", marginBottom: 12, wordBreak: "break-all" }}>
              Ou entrez cette clé manuellement : <strong>{enrolling.secret}</strong>
            </p>
            <input type="text" inputMode="numeric" autoFocus required value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456" maxLength={6}
              style={{ width: "100%", padding: 8, marginBottom: 12, border: "1px solid #DDD6C4", borderRadius: 4, boxSizing: "border-box", fontSize: 20, letterSpacing: 4, textAlign: "center" }} />
            <button type="submit" disabled={busy || code.length !== 6}
              style={{ width: "100%", padding: 10, background: "#152238", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", opacity: busy || code.length !== 6 ? 0.6 : 1 }}>
              {busy ? "Vérification…" : "Confirmer l'activation"}
            </button>
            <button type="button" onClick={cancelEnroll} className="mt-2 underline block" style={{ color: "#8A8370", fontSize: 12, background: "none", border: "none", cursor: "pointer", marginTop: 8 }}>
              Annuler
            </button>
            {error && <p style={{ color: "#A6432F", fontSize: 12, marginTop: 8 }}>{error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}

// --- Page d'accueil publique — première chose vue par un visiteur non connecté,
// avant l'écran de connexion. Sert de vitrine du produit.
function LandingPage({ onStart }) {
  const [htgRate, setHtgRate] = useState(null);
  const [rateIsLive, setRateIsLive] = useState(false);
  useEffect(() => {
    fetchHtgPerUsd().then((rate) => {
      if (rate) { setHtgRate(rate); setRateIsLive(true); }
      else { setHtgRate(FALLBACK_HTG_PER_USD); setRateIsLive(false); }
    });
  }, []);
  const htgPrice = htgRate ? Math.round((20 * htgRate) / 10) * 10 : Math.round((20 * FALLBACK_HTG_PER_USD) / 10) * 10;
  const htgPriceAssisted = htgRate ? Math.round((80 * htgRate) / 10) * 10 : Math.round((80 * FALLBACK_HTG_PER_USD) / 10) * 10;
  const features = [
    { icon: BookOpen, title: "Comptabilité en partie double", desc: "Journal, plan de comptes, bilan et compte de résultat générés automatiquement, avec journal scellé par chaînage cryptographique." },
    { icon: ShoppingCart, title: "Point de vente & facturation", desc: "Encaissez en boutique, générez des factures professionnelles imprimables ou en PDF, gérez remises et paiements partiels." },
    { icon: Boxes, title: "Stock & inventaire", desc: "Suivi en temps réel des quantités, alertes de réapprovisionnement, mouvements tracés." },
    { icon: Truck, title: "Achats & fournisseurs", desc: "Centralisez vos commandes fournisseurs et leur suivi de paiement." },
    { icon: Users, title: "Comptes clients (CRM)", desc: "Suivez les factures dues et payées, relancez vos clients en un coup d'œil." },
    { icon: BarChart3, title: "Rapports en continu", desc: "Bilan, résultat, balance et analyse des ventes toujours à jour, exportables en PDF." },
  ];
  return (
    <div style={{ background: "linear-gradient(160deg, #F4FBE8 0%, #DFF0BE 55%, #C7E296 100%)", fontFamily: "'Source Sans Pro', 'Inter', sans-serif", minHeight: "100vh", color: "#152238" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Spectral:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap'); .lp-display { font-family: 'Spectral', serif; }`}</style>

      <header className="flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <img src="icons/icon-192.png" alt="Compta+" className="w-8 h-8 rounded-full" />
          <span className="lp-display text-xl">Compta+</span>
        </div>
        <button onClick={onStart} className="text-sm px-4 py-2 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>
          Se connecter
        </button>
      </header>

      <section className="px-6 py-14 md:py-20 max-w-4xl mx-auto text-center">
        <div className="text-xs uppercase tracking-widest mb-3" style={{ color: "#C9A24B" }}>Pensé pour Haïti et le Mexique</div>
        <h1 className="lp-display text-3xl md:text-5xl leading-tight mb-5">
          La comptabilité et la vente de votre entreprise, réunies dans une seule application
        </h1>
        <p className="text-base md:text-lg mb-8" style={{ color: "#7A7460" }}>
          Point de vente, facturation, stock, comptabilité et gestion clients — sans logiciel compliqué, accessible depuis votre téléphone ou votre ordinateur.
        </p>
        <button onClick={onStart} className="px-6 py-3 rounded text-base" style={{ background: "#152238", color: "#EFE9DD" }}>
          Démarrer mon essai gratuit de 30 jours
        </button>
        <p className="text-xs mt-3" style={{ color: "#A39C87" }}>Aucune carte bancaire requise</p>
      </section>

      <section className="px-6 py-12 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {features.map((f, i) => (
            <div key={i} className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
              <f.icon size={22} style={{ color: "#C9A24B" }} className="mb-3" />
              <div className="text-sm font-medium mb-1.5">{f.title}</div>
              <p className="text-xs" style={{ color: "#8A8370" }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="px-6 py-14 max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="lp-display text-2xl mb-2">Deux forfaits, selon vos besoins</div>
          <p className="text-sm" style={{ color: "#7A7460" }}>30 jours d'essai gratuit avant tout engagement, quel que soit le forfait choisi.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="bg-white rounded-lg p-7" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-center mb-5">
              <div className="lp-display text-xl mb-1" style={{ color: "#152238" }}>Standard</div>
              <p className="text-xs" style={{ color: "#8A8370" }}>Toutes les fonctionnalités de base</p>
            </div>
            <div className="space-y-4">
              <div className="text-center pb-4" style={{ borderBottom: "1px solid #F0EBDD" }}>
                <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "#C9A24B" }}>Haïti</div>
                <div className="lp-display text-2xl mb-1">{htgPrice.toLocaleString("fr-FR")} HTG<span className="text-sm font-normal" style={{ color: "#A39C87" }}> / mois</span></div>
                <p className="text-xs" style={{ color: "#A39C87" }}>≈ 20 USD ({(htgRate || FALLBACK_HTG_PER_USD).toFixed(2)} HTG/USD) — MonCash, NatCash ou virement</p>
              </div>
              <div className="text-center">
                <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "#C9A24B" }}>Mexique</div>
                <div className="lp-display text-2xl mb-1">400 MXN<span className="text-sm font-normal" style={{ color: "#A39C87" }}> / mois</span></div>
                <p className="text-xs" style={{ color: "#8A8370" }}>Paiement par carte (Stripe)</p>
              </div>
            </div>
            <button onClick={onStart} className="w-full mt-5 text-sm px-5 py-2 rounded" style={{ border: "1px solid #152238", color: "#152238" }}>Essayer gratuitement</button>
          </div>
          <div className="rounded-lg p-7" style={{ border: "1px solid #DDD0F5", background: "#FBFAFE" }}>
            <div className="text-center mb-5">
              <div className="lp-display text-xl mb-1" style={{ color: "#5B3FA0" }}>Assisté</div>
              <p className="text-xs" style={{ color: "#8A8370" }}>+ alertes, recommandations et corrections automatiques pour éviter les erreurs de saisie</p>
            </div>
            <div className="space-y-4">
              <div className="text-center pb-4" style={{ borderBottom: "1px solid #EEE6FA" }}>
                <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "#8B6FD9" }}>Haïti</div>
                <div className="lp-display text-2xl mb-1">{htgPriceAssisted.toLocaleString("fr-FR")} HTG<span className="text-sm font-normal" style={{ color: "#A39C87" }}> / mois</span></div>
                <p className="text-xs" style={{ color: "#A39C87" }}>≈ 80 USD ({(htgRate || FALLBACK_HTG_PER_USD).toFixed(2)} HTG/USD) — MonCash, NatCash ou virement</p>
              </div>
              <div className="text-center">
                <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "#8B6FD9" }}>Mexique</div>
                <div className="lp-display text-2xl mb-1">1 600 MXN<span className="text-sm font-normal" style={{ color: "#A39C87" }}> / mois</span></div>
                <p className="text-xs" style={{ color: "#8A8370" }}>Paiement par carte (Stripe)</p>
              </div>
            </div>
            <button onClick={onStart} className="w-full mt-5 text-sm px-5 py-2 rounded text-white" style={{ background: "#5B3FA0" }}>Essayer gratuitement</button>
          </div>
        </div>
      </section>

      <section className="px-6 py-14 max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <div className="lp-display text-2xl mb-2">Ce que nos utilisateurs en disent</div>
        </div>
        <div className="bg-white rounded-lg p-8 text-center max-w-lg mx-auto" style={{ border: "1px dashed #DDD6C4" }}>
          <p className="text-sm" style={{ color: "#A39C87" }}>
            Les témoignages de nos premiers clients apparaîtront ici prochainement.
          </p>
        </div>
      </section>

      <section className="px-6 py-14 max-w-2xl mx-auto text-center">
        <div className="lp-display text-2xl mb-3">Prêt à essayer ?</div>
        <p className="text-sm mb-6" style={{ color: "#7A7460" }}>
          30 jours d'essai gratuit, sans engagement. Créez votre entreprise en moins d'une minute.
        </p>
        <button onClick={onStart} className="px-6 py-3 rounded text-base" style={{ background: "#152238", color: "#EFE9DD" }}>
          Commencer maintenant
        </button>
      </section>

      <footer className="px-6 py-8 text-center text-xs" style={{ color: "#A39C87", borderTop: "1px solid #E4DFD1" }}>
        © {new Date().getFullYear()} Compta+ · <a href="cgu.html" style={{ color: "#A39C87", textDecoration: "underline" }}>Conditions d'utilisation</a> · <a href="confidentialite.html" style={{ color: "#A39C87", textDecoration: "underline" }}>Confidentialité</a>
      </footer>
    </div>
  );
}

// --- Icônes (SVG minimalistes, remplacent lucide-react pour un usage sans build) ---
const Icon = ({ children, size = 16, style, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style} className={className}>
    {children}
  </svg>
);
const Plus = (p) => <Icon {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Icon>;
const Trash2 = (p) => <Icon {...p}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></Icon>;
const X = (p) => <Icon {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Icon>;
const ChevronRight = (p) => <Icon {...p}><polyline points="9 18 15 12 9 6" /></Icon>;
const Lock = (p) => <Icon {...p}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></Icon>;
const Eye = (p) => <Icon {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" /><circle cx="12" cy="12" r="3" /></Icon>;
const EyeOff = (p) => <Icon {...p}><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.86 19.86 0 0 1 4.22-5.94M9.9 4.24A10.9 10.9 0 0 1 12 4c7 0 11 8 11 8a19.83 19.83 0 0 1-2.16 3.19" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></Icon>;
const ArrowDownCircle = (p) => <Icon {...p}><circle cx="12" cy="12" r="10" /><polyline points="8 12 12 16 16 12" /><line x1="12" y1="8" x2="12" y2="16" /></Icon>;
const ArrowUpCircle = (p) => <Icon {...p}><circle cx="12" cy="12" r="10" /><polyline points="16 12 12 8 8 12" /><line x1="12" y1="16" x2="12" y2="8" /></Icon>;
const CheckCircle2 = (p) => <Icon {...p}><circle cx="12" cy="12" r="10" /><polyline points="9 12 12 15 16 9" /></Icon>;
const Circle = (p) => <Icon {...p}><circle cx="12" cy="12" r="10" /></Icon>;
const Minus = (p) => <Icon {...p}><line x1="5" y1="12" x2="19" y2="12" /></Icon>;
const Receipt = (p) => <Icon {...p}><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><line x1="8" y1="7" x2="16" y2="7" /><line x1="8" y1="11" x2="16" y2="11" /></Icon>;
const Download = (p) => <Icon {...p}><path d="M12 3v12" /><polyline points="7 10 12 15 17 10" /><line x1="4" y1="21" x2="20" y2="21" /></Icon>;
const Upload = (p) => <Icon {...p}><path d="M12 21V9" /><polyline points="7 14 12 9 17 14" /><line x1="4" y1="3" x2="20" y2="3" /></Icon>;
const RotateCcw = (p) => <Icon {...p}><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-8.49L1 10" /></Icon>;
const FileDown = (p) => <Icon {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="12" x2="12" y2="18" /><polyline points="9 15 12 18 15 15" /></Icon>;
const Printer = (p) => <Icon {...p}><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></Icon>;
const BluetoothIcon = (p) => <Icon {...p}><polygon points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5" /></Icon>;
const LayoutDashboard = (p) => <Icon {...p}><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></Icon>;
const BookOpen = (p) => <Icon {...p}><path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z" /><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z" /></Icon>;
const Wallet = (p) => <Icon {...p}><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></Icon>;
const ShoppingCart = (p) => <Icon {...p}><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></Icon>;
const Truck = (p) => <Icon {...p}><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></Icon>;
const History = (p) => <Icon {...p}><path d="M3 3v5h5" /><path d="M3.05 13a9 9 0 1 0 2.13-7.36L3 8" /><polyline points="12 7 12 12 16 14" /></Icon>;
const Smartphone = (p) => <Icon {...p}><rect x="5" y="2" width="14" height="20" rx="2" /><line x1="12" y1="18" x2="12.01" y2="18" /></Icon>;
const CreditCard = (p) => <Icon {...p}><rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" /></Icon>;
const Boxes = (p) => <Icon {...p}><path d="M2.5 7 12 2l9.5 5-9.5 5-9.5-5Z" /><path d="M2.5 7v10L12 22V12" /><path d="M21.5 7v10L12 22" /></Icon>;
const Users = (p) => <Icon {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Icon>;
const BarChart3 = (p) => <Icon {...p}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></Icon>;
const Settings = (p) => <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></Icon>;
const Menu = (p) => <Icon {...p}><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></Icon>;
const Pencil = (p) => <Icon {...p}><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="M15 5l4 4" /></Icon>;
const ImageIcon = (p) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></Icon>;
const ScanLine = (p) => <Icon {...p}><path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><line x1="3" y1="12" x2="21" y2="12" /></Icon>;
const BadgeDollar = (p) => <Icon {...p}><circle cx="12" cy="12" r="8" /><path d="M12 7v10" /><path d="M14.5 9.5c0-1-1-1.5-2.5-1.5s-2.5.6-2.5 1.6c0 2.3 5 1 5 3.3 0 1-1 1.6-2.5 1.6s-2.5-.5-2.5-1.5" /></Icon>;

// --- Graphiques SVG maison (remplacent recharts pour un usage sans build) ---
function SimpleGroupedBarChart({ data, xKey, series }) {
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key] || 0)));
  const H = 240, barW = 18, gap = 10, groupGap = 32;
  // Marge réservée en haut pour que l'étiquette de la barre la plus haute (souvent
  // très proche du sommet du graphique) ne soit jamais coupée par le bord du SVG.
  const topPad = 18;
  const groupW = series.length * barW + (series.length - 1) * gap;
  const W = Math.max(400, data.length * (groupW + groupGap) + groupGap);
  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={W} height={H + 50 + topPad} style={{ minWidth: "100%" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={topPad + H - H * f} y2={topPad + H - H * f} stroke="#EEE9DA" />
        ))}
        {data.map((d, i) => {
          const gx = groupGap + i * (groupW + groupGap);
          return (
            <g key={i}>
              {series.map((s, j) => {
                const val = d[s.key] || 0;
                const h = (val / max) * (H - 10);
                return (
                  <g key={s.key}>
                    <rect x={gx + j * (barW + gap)} y={topPad + H - h} width={barW} height={h} rx={3} fill={s.color}>
                      <title>{s.name}: {fmt(val)}</title>
                    </rect>
                    {val > 0 && (
                      <text x={gx + j * (barW + gap) + barW / 2} y={topPad + H - h - 6} fontSize="9" textAnchor="middle" fill={s.color} className="tabular">
                        {fmt(val)}
                      </text>
                    )}
                  </g>
                );
              })}
              <text x={gx + groupW / 2} y={topPad + H + 18} fontSize="11" textAnchor="middle" fill="#8A8370">{d[xKey]}</text>
            </g>
          );
        })}
      </svg>
      <div className="flex gap-4 mt-2 justify-center text-xs" style={{ color: "#8A8370" }}>
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1">
            <span style={{ width: 10, height: 10, background: s.color, display: "inline-block", borderRadius: 2 }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

// Barres de croissance : contrairement à SimpleGroupedBarChart (toujours positif), ce
// graphique part d'une ligne zéro centrale et affiche les barres vers le haut (croissance)
// ou vers le bas (baisse), en vert/rouge, avec le montant et le pourcentage en infobulle.
function SimpleGrowthBarChart({ data, xKey, valueKey, pctKey }) {
  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d[valueKey] || 0)));
  const H = 220, barW = 28, gap = 40;
  const W = Math.max(400, data.length * (barW + gap) + gap);
  // Marge en haut ET en bas : les étiquettes (2 lignes) d'une barre extrême peuvent
  // sinon se faire couper par le bord du SVG, comme pour SimpleGroupedBarChart.
  const topPad = 26;
  const zeroY = topPad + H / 2;
  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={W} height={H + 30 + topPad * 2} style={{ minWidth: "100%" }}>
        <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke="#DDD6C4" />
        {data.map((d, i) => {
          const val = d[valueKey] || 0;
          const gx = gap + i * (barW + gap);
          const h = (Math.abs(val) / maxAbs) * (H / 2 - 10);
          const color = val >= 0 ? "#0F6B5C" : "#A6432F";
          const pct = d[pctKey];
          return (
            <g key={i}>
              <rect x={gx} y={val >= 0 ? zeroY - h : zeroY} width={barW} height={h} rx={3} fill={color}>
                <title>{d[xKey]} : {val >= 0 ? "+" : ""}{fmt(val)}{pct !== null && pct !== undefined ? ` (${val >= 0 ? "+" : ""}${pct.toFixed(1)}%)` : ""}</title>
              </rect>
              <text x={gx + barW / 2} y={val >= 0 ? zeroY - h - 6 : zeroY + h + 14} fontSize="9" textAnchor="middle" fill={color} className="tabular">
                {pct !== null && pct !== undefined ? `${val >= 0 ? "+" : ""}${pct.toFixed(0)}%` : ""}
              </text>
              <text x={gx + barW / 2} y={val >= 0 ? zeroY - h - 18 : zeroY + h + 26} fontSize="8" textAnchor="middle" fill="#8A8370" className="tabular">
                {val >= 0 ? "+" : ""}{fmt(val)}
              </text>
              <text x={gx + barW / 2} y={topPad + H + 18} fontSize="11" textAnchor="middle" fill="#8A8370">{d[xKey]}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function SimpleLineChart({ data, xKey, yKey, color, name }) {
  const max = Math.max(1, ...data.map((d) => d[yKey] || 0));
  const H = 220, W = Math.max(400, data.length * 90);
  const stepX = data.length > 1 ? (W - 40) / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x = 20 + i * stepX;
    const y = H - ((d[yKey] || 0) / max) * (H - 20) - 5;
    return { x, y, val: d[yKey] || 0, label: d[xKey] };
  });
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={W} height={H + 30} style={{ minWidth: "100%" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={H - H * f + 5} y2={H - H * f + 5} stroke="#EEE9DA" />
        ))}
        <path d={path} fill="none" stroke={color} strokeWidth={2} />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3.5} fill={color}>
              <title>{name} — {p.label}: {fmt(p.val)}</title>
            </circle>
            <text x={p.x} y={H + 20} fontSize="11" textAnchor="middle" fill="#8A8370">{p.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function SimpleDonutChart({ data, nameKey, valueKey, colors }) {
  const total = data.reduce((s, d) => s + (d[valueKey] || 0), 0);
  const palette = colors || ["#0F6B5C", "#9A7B1E", "#3F4F73", "#A6432F", "#7C6BAA", "#5B8A72", "#C9A24B", "#6E8CA0"];
  const size = 220, cx = size / 2, cy = size / 2, rOuter = 100, rInner = 55;
  let angleStart = -Math.PI / 2;
  const arcs = data.map((d, i) => {
    const value = d[valueKey] || 0;
    const frac = total > 0 ? value / total : 0;
    const angleEnd = angleStart + frac * Math.PI * 2;
    const largeArc = angleEnd - angleStart > Math.PI ? 1 : 0;
    const x1 = cx + rOuter * Math.cos(angleStart), y1 = cy + rOuter * Math.sin(angleStart);
    const x2 = cx + rOuter * Math.cos(angleEnd), y2 = cy + rOuter * Math.sin(angleEnd);
    const x3 = cx + rInner * Math.cos(angleEnd), y3 = cy + rInner * Math.sin(angleEnd);
    const x4 = cx + rInner * Math.cos(angleStart), y4 = cy + rInner * Math.sin(angleStart);
    const path = `M${x1},${y1} A${rOuter},${rOuter} 0 ${largeArc} 1 ${x2},${y2} L${x3},${y3} A${rInner},${rInner} 0 ${largeArc} 0 ${x4},${y4} Z`;
    const color = palette[i % palette.length];
    angleStart = angleEnd;
    return { path, color, name: d[nameKey], value, pct: total > 0 ? Math.round((value / total) * 100) : 0 };
  });
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width={size} height={size} style={{ flexShrink: 0 }}>
        {arcs.map((a, i) => (
          <path key={i} d={a.path} fill={a.color}>
            <title>{a.name} — {fmt(a.value)} ({a.pct}%)</title>
          </path>
        ))}
        <text x={cx} y={cy - 3} textAnchor="middle" fontSize="11" fill="#8A8370">Total</text>
        <text x={cx} y={cy + 13} textAnchor="middle" fontSize="13" fontWeight="700" fill="#152238" className="tabular">{fmt(total)}</text>
      </svg>
      <div className="flex-1 min-w-[160px] space-y-1.5">
        {arcs.map((a, i) => (
          <div key={i} className="flex items-center justify-between text-sm gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span style={{ width: 10, height: 10, borderRadius: 2, background: a.color, flexShrink: 0, display: "inline-block" }} />
              <span className="truncate" style={{ color: "#152238" }}>{a.name}</span>
            </div>
            <span className="tabular flex-shrink-0" style={{ color: "#8A8370" }}>{fmt(a.value)} ({a.pct}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const MODULES = [
  { id: "compta", n: 1, label: "Comptabilité", icon: BookOpen, ready: true },
  { id: "caisse", n: 2, label: "Caisse et banque", icon: Wallet, ready: true },
  { id: "vente", n: 3, label: "Vente (POS / Facturation)", icon: ShoppingCart, ready: true },
  { id: "achat", n: 4, label: "Achat et fournisseurs", icon: Truck, ready: true },
  { id: "stock", n: 5, label: "Stock et inventaire", icon: Boxes, ready: true },
  { id: "crm", n: 6, label: "Comptes clients (CRM)", icon: Users, ready: true },
  { id: "rapports", n: 7, label: "Rapports et analyse", icon: BarChart3, ready: true },
  { id: "admin", n: 8, label: "Administration", icon: Settings, ready: true },
  { id: "rh", n: 9, label: "Salaires (RH)", icon: BadgeDollar, ready: true },
];

// Modules accessibles par rôle. "null" = accès à tous les modules (comportement
// historique pour Administrateur/Éditeur/Lecture seule). Le rôle "Vendeur" est
// cantonné au point de vente : il peut encaisser des clients sans jamais voir ni
// modifier la comptabilité, les rapports ou l'administration de l'entreprise.
const ROLE_MODULE_ACCESS = {
  Vendeur: ["vente", "crm", "stock"],
};

// Miroir exact, côté client, de la policy RLS "Insert/Update own company data" sur
// kv_store : le rôle Vendeur n'est autorisé à écrire QUE ces 4 catégories côté
// serveur — tout le reste (settings, employees, users, salesStations...) est
// refusé par design, pas par panne. Sans ce miroir, l'app tenterait quand même
// d'écrire ces catégories pour un Vendeur, échouerait à chaque fois (normal), et
// afficherait indéfiniment la bannière d'erreur de synchronisation pour une
// restriction de sécurité parfaitement normale.
const VENDEUR_WRITABLE_CATEGORIES = ["products", "invoices", "movements", "entries"];

const DEFAULT_ACCOUNTS = [
  { code: "101", name: "Capital", type: "Capitaux propres" },
  { code: "108", name: "Report d'ouverture (solde initial)", type: "Capitaux propres" },
  { code: "411", name: "Clients", type: "Actif" },
  { code: "401", name: "Fournisseurs", type: "Passif" },
  { code: "445", name: "Taxe collectée sur ventes (IVA/TCA)", type: "Passif" },
  { code: "512", name: "Banque", type: "Actif" },
  { code: "530", name: "Caisse", type: "Actif" },
  { code: "370", name: "Stock de marchandises", type: "Actif" },
  { code: "39", name: "Dépréciation des stocks", type: "Actif" },
  { code: "6037", name: "Coût des marchandises vendues", type: "Charge" },
  { code: "6817", name: "Dotations aux dépréciations des stocks", type: "Charge" },
  { code: "7817", name: "Reprises sur dépréciations des stocks", type: "Produit" },
  { code: "491", name: "Provisions pour créances douteuses", type: "Actif" },
  { code: "6816", name: "Dotations aux provisions pour créances douteuses", type: "Charge" },
  { code: "7816", name: "Reprises sur provisions pour créances douteuses", type: "Produit" },
  { code: "2154", name: "Matériel industriel", type: "Actif" },
  { code: "28154", name: "Amortissements — Matériel industriel", type: "Actif" },
  { code: "2182", name: "Matériel de transport", type: "Actif" },
  { code: "28182", name: "Amortissements — Matériel de transport", type: "Actif" },
  { code: "2183", name: "Matériel de bureau et informatique", type: "Actif" },
  { code: "28183", name: "Amortissements — Matériel de bureau et informatique", type: "Actif" },
  { code: "2184", name: "Mobilier", type: "Actif" },
  { code: "28184", name: "Amortissements — Mobilier", type: "Actif" },
  { code: "6811", name: "Dotations aux amortissements des immobilisations", type: "Charge" },
  { code: "404", name: "Fournisseurs d'immobilisations", type: "Passif" },
  { code: "4081", name: "Fournisseurs — Factures non parvenues", type: "Passif" },
  { code: "4181", name: "Clients — Factures à établir", type: "Actif" },
  { code: "486", name: "Charges constatées d'avance", type: "Actif" },
  { code: "487", name: "Produits constatés d'avance", type: "Passif" },
  { code: "151", name: "Provisions pour risques", type: "Passif" },
  { code: "6815", name: "Dotations aux provisions pour risques", type: "Charge" },
  { code: "7815", name: "Reprises sur provisions pour risques", type: "Produit" },
  { code: "606", name: "Achats non stockés", type: "Charge" },
  { code: "607", name: "Achats de marchandises", type: "Charge" },
  { code: "608", name: "Frais accessoires d'achat (transport, manutention)", type: "Charge" },
  { code: "613", name: "Loyers et charges locatives", type: "Charge" },
  { code: "615", name: "Entretien et réparations", type: "Charge" },
  { code: "616", name: "Assurances", type: "Charge" },
  { code: "622", name: "Honoraires et prestations externes", type: "Charge" },
  { code: "623", name: "Publicité et marketing", type: "Charge" },
  { code: "626", name: "Télécommunications et internet", type: "Charge" },
  { code: "627", name: "Frais bancaires", type: "Charge" },
  { code: "635", name: "Impôts et taxes", type: "Charge" },
  { code: "641", name: "Charges de personnel", type: "Charge" },
  { code: "645", name: "Charges sociales", type: "Charge" },
  { code: "658", name: "Pertes sur stocks (péremption, casse)", type: "Charge" },
  { code: "6238", name: "Dons, libéralités", type: "Charge" },
  { code: "706", name: "Prestations de services", type: "Produit" },
  { code: "707", name: "Ventes de marchandises", type: "Produit" },
  { code: "708", name: "Produits accessoires", type: "Produit" },
];

// Catégories d'immobilisations proposées à la création — chacune porte son propre
// compte d'actif et son compte d'amortissements cumulés correspondant, pour rester
// simple (pas de sélection manuelle de compte à faire).
const ASSET_CATEGORIES = [
  { label: "Matériel industriel", assetAccount: "2154", depreciationAccount: "28154" },
  { label: "Matériel de transport", assetAccount: "2182", depreciationAccount: "28182" },
  { label: "Matériel de bureau et informatique", assetAccount: "2183", depreciationAccount: "28183" },
  { label: "Mobilier", assetAccount: "2184", depreciationAccount: "28184" },
];

const TAX_SYSTEMS = {
  iva: { label: "IVA", defaultRate: 16, description: "Impuesto al Valor Agregado (Mexique) — déductible sur les achats" },
  tca: { label: "TCA", defaultRate: 10, description: "Taxe sur le Chiffre d'Affaires (Haïti) — taxe sur ventes/services, supportée par le consommateur final, non déductible" },
  aucune: { label: "Aucune taxe", defaultRate: 0, description: "Aucune taxe appliquée aux ventes" },
};

// Le taux des articles de démonstration suit TOUJOURS le régime fiscal par
// défaut d'une nouvelle entreprise (TAX_SYSTEMS.tca), au lieu d'un nombre codé
// séparément — évite qu'un futur changement du régime par défaut désynchronise
// silencieusement ces 3 articles, comme observé quand le régime par défaut était
// passé de 20% (ancienne TVA) à 10% (TCA) sans que ces articles suivent.
const DEFAULT_PRODUCTS = [
  { id: 1, code: "P001", name: "Prestation de conseil (h)", price: 60, tva: TAX_SYSTEMS.tca.defaultRate, type: "service", account: "706" },
  { id: 2, code: "P002", name: "Pack démarrage", price: 250, tva: TAX_SYSTEMS.tca.defaultRate, type: "service", account: "706" },
  { id: 3, code: "M001", name: "Article standard", price: 25, tva: TAX_SYSTEMS.tca.defaultRate, type: "marchandise", account: "707", stock: 40, seuil: 10 },
];

const DEFAULT_SUPPLIERS = [
  { id: 1, name: "Fournisseur Général SARL", contact: "" },
];

const DEFAULT_CLIENTS = [];

const DEFAULT_SETTINGS = {
  companyName: "Mon Entreprise",
  companyAddress: "",
  companyPhone: "",
  companyEmail: "",
  currency: "HTG",
  fiscalYearStart: "01-01",
  taxSystem: "tca", // "iva" | "tca" | "aucune"
  taxRate: TAX_SYSTEMS.tca.defaultRate,
  taxAccount: "445",
  taxDeductibleOnPurchases: true,
  lockDate: "", // Clôture d'exercice/période : aucune écriture datée ≤ cette date ne peut être créée, modifiée ou annulée
  nextInvoiceNumber: 1, // Compteur strictement croissant : garantit une numérotation de factures sans trous ni doublons
  subscriptionPriceHTG: 2600, // Repli si le taux de change en temps réel est indisponible
  subscriptionPriceUSD: 20, // Prix de référence en USD — le montant HTG facturé est recalculé au taux du jour
  assistedPlanPriceUSD: 80, // Prix de référence du forfait Assisté (mode Superviseur assisté + alertes/suggestions) — activé manuellement par Super Admin en attendant l'intégration MonCash dédiée
  autoBackupEnabled: false, // Sauvegarde JSON hebdomadaire automatique — contrôlée uniquement par l'Administrateur principal
  lastAutoBackupAt: null, // Horodatage de la dernière sauvegarde automatique déclenchée, partagé entre tous les appareils de l'entreprise
  receiptFormat: "a4", // "a4" | "ticket80" | "ticket58" — format d'impression des factures, selon le matériel utilisé
  // "charge" (par défaut, comportement historique) : le stock est comptabilisé en
  // charge dès l'achat, comme la plupart des petites entreprises sans comptable
  // dédié — simple, mais ne respecte pas les normes comptables formelles (IFRS/PCG/
  // SYSCOHADA) dès qu'un stock est conservé d'une période à l'autre.
  // "actif" : le stock est un actif circulant (compte 370), sorti au coût moyen
  // pondéré vers 6037 (Coût des marchandises vendues) à chaque vente — la méthode
  // conforme, choisie explicitement par l'entreprise dans Administration.
  stockValuationMethod: "charge", // "charge" | "actif"
  invoiceFooterNote: "", // Note personnalisée affichée en bas de chaque facture (conditions, mentions légales, remerciement...)
};

// Une date est verrouillée (période clôturée) si elle est antérieure ou égale à la date de clôture définie.
const isLocked = (date, settings) => !!(settings && settings.lockDate && date && date <= settings.lockDate);
const DEFAULT_USERS = [{ id: 1, name: "Administrateur", email: "", role: "Administrateur" }];

const CURRENCIES = {
  EUR: { label: "Euro (EUR)", locale: "fr-FR" },
  USD: { label: "Dollar américain (USD)", locale: "en-US" },
  HTG: { label: "Gourde haïtienne (HTG)", locale: "fr-HT" },
  MXN: { label: "Peso mexicain (MXN)", locale: "es-MX" },
};

// Devise active pour le formatage — mise à jour en direct par App() selon les paramètres.
// (variable de module plutôt que prop, car fmt() est appelée dans des dizaines d'endroits)
let CURRENT_CURRENCY = "HTG";

// Génère un identifiant numérique garanti unique, même si plusieurs éléments sont créés
// à la même milliseconde (saisie très rapide, copier-coller en série...). Date.now() seul
// pouvait produire deux identifiants identiques dans ce cas, ce qui faisait qu'un nouvel
// élément écrasait silencieusement le précédent au lieu de s'ajouter (le nombre total
// semblait alors plafonner sans raison apparente).
let __uidCounter = 0;
// Normalise un nom de client pour le regroupement (espaces superflus et casse
// ignorés) — sans ça, deux saisies légèrement différentes du même nom ("Guerline"
// vs "Guerline " ou une casse différente) créent deux fiches distinctes au lieu
// d'une seule, faussant le solde dû total du client.
function normalizeClientName(n) {
  return (n || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function uid() {
  __uidCounter = (__uidCounter + 1) % 1000;
  return Date.now() * 1000 + __uidCounter;
}

// Génère un jeton d'invitation aléatoire (format UUID). Utilise crypto.randomUUID()
// quand disponible (navigateurs modernes, contexte HTTPS) ; repli manuel sinon.
function genInviteToken() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// --- Scellement cryptographique du journal (chaînage à la SHA-256) ---
// Implémentation SHA-256 pure JS, synchrone (pas de dépendance externe), pour pouvoir
// sceller chaque écriture au moment même où elle est ajoutée, sans réécrire tous les
// points d'ajout en code asynchrone. Chaque écriture porte le hash de la précédente :
// toute modification rétroactive d'une écriture déjà scellée casse la chaîne à partir
// de ce point, ce qui est détectable par vérifyChain().
const sha256Hex = (() => {
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];
  const rrot = (x, n) => (x >>> n) | (x << (32 - n));
  return (str) => {
    const bytes = new TextEncoder().encode(str);
    const bitLen = bytes.length * 8;
    const withOne = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
    withOne.set(bytes);
    withOne[bytes.length] = 0x80;
    const view = new DataView(withOne.buffer);
    view.setUint32(withOne.length - 4, bitLen >>> 0);
    view.setUint32(withOne.length - 8, Math.floor(bitLen / 4294967296));
    let h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const w = new Array(64);
    for (let chunk = 0; chunk < withOne.length; chunk += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(chunk + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rrot(w[i - 15], 7) ^ rrot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rrot(w[i - 2], 17) ^ rrot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const S1 = rrot(e, 6) ^ rrot(e, 11) ^ rrot(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
        const S0 = rrot(a, 2) ^ rrot(a, 13) ^ rrot(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h = [h[0]+a|0, h[1]+b|0, h[2]+c|0, h[3]+d|0, h[4]+e|0, h[5]+f|0, h[6]+g|0, h[7]+hh|0];
    }
    return h.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
  };
})();

const GENESIS_HASH = "0".repeat(64);
// Contenu canonique et immuable d'une écriture : seuls id/date/label/lines entrent dans
// le hash. Des métadonnées ajoutées après coup (cancelledBy, reconciled...) ne cassent
// pas le scellement, seule une altération du contenu comptable lui-même le casse.
const canonicalEntryContent = (e) => `${e.id}|${e.date}|${e.label}|${JSON.stringify(e.lines)}`;

// Parcourt les écritures dans leur ordre d'enregistrement et scelle (ajoute hash/prevHash)
// toute écriture qui n'en a pas encore. Retourne le tableau (inchangé par référence si rien
// à sceller) — à utiliser après tout ajout d'écriture, quel que soit le module d'origine.
const sealEntries = (list) => {
  let prevHash = GENESIS_HASH;
  let changed = false;
  const next = list.map((e) => {
    if (e.hash) {
      prevHash = e.hash;
      return e;
    }
    changed = true;
    const hash = sha256Hex(prevHash + "|" + canonicalEntryContent(e));
    prevHash = hash;
    return { ...e, prevHash: (e.prevHash !== undefined ? e.prevHash : list[list.indexOf(e) - 1]?.hash) ?? GENESIS_HASH, hash };
  });
  return changed ? next : list;
};

// Revérifie l'intégralité de la chaîne à partir de zéro (indépendamment des hash stockés)
// et compare : détecte toute altération rétroactive du contenu d'une écriture déjà scellée.
const verifyChain = (list) => {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const expected = sha256Hex(prevHash + "|" + canonicalEntryContent(e));
    if (!e.hash) return { ok: false, brokenAt: i, entry: e, reason: "non scellée" };
    if (e.hash !== expected) return { ok: false, brokenAt: i, entry: e, reason: "contenu modifié après scellement" };
    prevHash = e.hash;
  }
  return { ok: true, count: list.length, lastHash: prevHash };
};

// Variante qui ne s'arrête pas à la première anomalie : utile pour savoir si UNE
// seule écriture est concernée (probable ancien format de scellement, ou altération
// isolée) ou si le problème touche massivement le journal (bien plus grave). Utilise
// le hash STOCKÉ (pas recalculé) comme référence pour la suite de la chaîne, pour
// qu'une seule anomalie ne déclenche pas un effet domino de faux positifs sur toutes
// les écritures suivantes.
const verifyChainFull = (list) => {
  let prevHash = GENESIS_HASH;
  const broken = [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const expected = sha256Hex(prevHash + "|" + canonicalEntryContent(e));
    if (!e.hash) broken.push({ index: i, entry: e, reason: "non scellée" });
    else if (e.hash !== expected) broken.push({ index: i, entry: e, reason: "contenu modifié après scellement" });
    prevHash = e.hash || expected;
  }
  return { ok: broken.length === 0, count: list.length, brokenCount: broken.length, broken };
};

// Taux de change USD → HTG en temps réel (API gratuite, sans clé), avec repli sur
// un taux fixe si la requête échoue (hors ligne, service indisponible...). Utilisé
// pour afficher/facturer un montant en gourdes cohérent avec le marché du jour,
// sans avoir à mettre à jour le site manuellement à chaque variation du taux BRH.
// --- Règles de blocage universelles (tous forfaits, tous modules de saisie) ---
// Une date de transaction dans le futur, ou un montant à zéro, n'a aucun sens
// comptable et ne peut jamais être corrigé proprement par contrepassation (on
// contrepasse une erreur de catégorie ou de montant, pas une opération qui
// n'a techniquement pas encore eu lieu, ou qui ne représente aucune valeur
// réelle) — le blocage est donc réel et non contournable, pas une simple alerte.
function todayStr() {
  // Date LOCALE de l'appareil, pas UTC — toISOString() bascule au jour suivant dès
  // que l'heure locale dépasse le décalage UTC du fuseau (ex. 22h55 heure d'Haïti,
  // UTC-4, correspond déjà à 02h55 UTC le lendemain), ce qui bloquait à tort la
  // vraie date du jour sur les calendriers en soirée.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function isFutureDate(dateStr) {
  if (!dateStr) return false;
  return dateStr > todayStr();
}

const FALLBACK_HTG_PER_USD = 130.53; // taux de référence BRH du 07/08/2026, en dernier recours

// --- Rappel du principe comptable (forfait Assisté uniquement) ---
// Affiché systématiquement à chaque saisie (pas seulement la première fois),
// sur les modules impliquant un principe comptable — jugé fondamental par
// l'éditeur pour que l'assistance automatisée soit perçue comme réelle, pas
// cosmétique. Purement informatif : n'importe/ne valide/ne bloque jamais rien
// par lui-même (voir isFutureDate/montant zéro pour les vrais blocages).
function AssistedPrincipleReminder({ planTier, text }) {
  if (planTier !== "assisted") return null;
  return (
    <div className="text-xs px-3 py-2 rounded mb-3 flex items-start gap-2" style={{ background: "#F3EEFB", color: "#5B3FA0", border: "1px solid #DDD0F5" }}>
      <span>💡</span>
      <span>{text}</span>
    </div>
  );
}

// --- Bandeau de recommandation en attente (mode Assisté) ---
// Réapparaît toutes les 45s tant que la recommandation n'a pas été explicitement
// prise en compte, et à chaque fois que l'utilisateur revient sur ce module
// (visible dès le montage du composant). L'app ne force jamais la correction
// technique elle-même — elle indique juste clairement ce qu'il faudrait faire.
function PendingRecommendationsBanner({ recommendations, module, onDismiss, onApplyCorrection }) {
  const [visible, setVisible] = useState(true);
  const relevant = (recommendations || []).filter((r) => r.module === module);
  useEffect(() => {
    setVisible(true);
    if (relevant.length === 0) return;
    const interval = setInterval(() => setVisible(true), 45000);
    return () => clearInterval(interval);
  }, [relevant.length, module]);
  if (relevant.length === 0 || !visible) return null;
  return (
    <div className="rounded mb-4 overflow-hidden" style={{ border: "1px solid #E8B34A" }}>
      {relevant.map((r) => (
        <div key={r.id} className="px-3 py-3" style={{ background: "#FDF6E3" }}>
          <div className="text-xs font-medium mb-1 flex items-center gap-1" style={{ color: "#8A6D1E" }}>
            <span>⚠️</span> Recommandation en attente{r.entry_ref ? ` — ${r.entry_ref}` : ""}
          </div>
          <div className="text-xs mb-2" style={{ color: "#6B5A28" }}>{r.anomaly_text}</div>
          <div className="text-xs mb-2 p-2 rounded" style={{ background: "#fff", color: "#152238", border: "1px solid #EAD9A0" }}>
            <b>Correction suggérée :</b> {r.correction_text}
          </div>
          <div className="flex flex-wrap gap-2">
            {r.correction_kind === "reversed" && r.correction_payload && (
              <button onClick={() => onApplyCorrection?.(r)} className="text-xs px-3 py-1.5 rounded text-white" style={{ background: "#0F6B5C" }}>
                ✓ Appliquer l'écriture corrigée automatiquement
              </button>
            )}
            <button onClick={() => {
              // La levée ne se fait jamais en un clic : un récapitulatif de la
              // transaction concernée doit être relu et confirmé explicitement,
              // pour qu'accuser réception ne devienne pas un réflexe automatique
              // qui laisse filer l'anomalie sans vérification réelle.
              const confirmed = window.confirm(
                `Avant de continuer, vérifiez les montants exacts de cette transaction :\n\n` +
                `${r.entry_ref ? `Concerné : ${r.entry_ref}\n` : ""}${r.anomaly_text}\n\n` +
                `Confirmez-vous avoir vérifié et pris en compte cette recommandation ?`
              );
              if (!confirmed) return;
              onDismiss(r.id);
              setVisible(false);
            }} className="text-xs px-3 py-1.5 rounded" style={{ background: "#152238", color: "#fff" }}>
              J'ai pris connaissance
            </button>
          </div>
        </div>
      ))}
      <div className="px-3 py-2 text-xs" style={{ background: "#FBEFD4", color: "#8A6D1E" }}>
        Les nouvelles saisies sont bloquées dans ce module tant que cette recommandation n'est pas traitée.
      </div>
    </div>
  );
}

// --- Alertes intelligentes (forfait Assisté uniquement) ---
// Contrairement aux blocages universels (montant zéro, date future), ces
// anomalies ne sont jamais des erreurs certaines — juste des signaux
// statistiques qui MÉRITENT d'être relus. Mécanisme "3 tentatives" décidé par
// l'éditeur : la 1ère et la 2ème tentative sur la MÊME anomalie (même
// signature — donc si l'utilisateur change une valeur, ça repart à zéro)
// bloquent réellement l'enregistrement ; la 2ème ajoute une orientation
// explicite vers un comptable qualifié ; à la 3ème tentative identique,
// l'utilisateur est réputé avoir fait un choix informé et l'opération passe.
function useAssistedAnomalyGate() {
  const attemptsRef = React.useRef({});
  return (signature, anomalies, proceed, showToast, onBypassed) => {
    if (!anomalies || anomalies.length === 0) {
      proceed();
      return;
    }
    const count = (attemptsRef.current[signature] || 0) + 1;
    attemptsRef.current[signature] = count;
    const list = anomalies.join(" ");
    if (count === 1) {
      showToast(`⚠️ ${list}`);
      return;
    }
    if (count === 2) {
      showToast(`⚠️ ${list} Nous vous recommandons de consulter un comptable qualifié avant de continuer.`);
      return;
    }
    if (onBypassed) onBypassed(anomalies); // 3e tentative identique : enregistre la recommandation en attente
    proceed(); // l'utilisateur assume son choix
  };
}

function detectAmountAnomaly(amount, historicalAmounts, label) {
  if (!historicalAmounts || historicalAmounts.length < 3) return null;
  const avg = historicalAmounts.reduce((a, b) => a + b, 0) / historicalAmounts.length;
  if (avg > 0 && amount > avg * 5) {
    return `Montant inhabituel pour ${label} : ${fmt(amount)} contre une moyenne récente de ${fmt(Math.round(avg))}.`;
  }
  return null;
}
function detectRareAccountAnomaly(accountCode, usageCounts, accountLabel) {
  const count = usageCounts?.[accountCode] || 0;
  if (count <= 1) {
    return `Le compte ${accountLabel || accountCode} a très peu servi dans cette entreprise (${count} fois) — vérifiez que c'est le bon compte.`;
  }
  return null;
}
function detectReversedAnomaly(lines, accounts) {
  for (const l of lines) {
    const acc = accounts.find((a) => a.code === l.account);
    if (!acc) continue;
    if (acc.code.startsWith("6") && Number(l.credit) > 0) {
      return `Le compte de charge ${acc.code} (${acc.name}) est crédité — une charge se débite normalement.`;
    }
    if (acc.code.startsWith("7") && Number(l.debit) > 0) {
      return `Le compte de produit ${acc.code} (${acc.name}) est débité — un produit se crédite normalement.`;
    }
  }
  return null;
}
function buildReversedCorrection(lines, accounts) {
  for (const l of lines) {
    const acc = accounts.find((a) => a.code === l.account);
    if (!acc) continue;
    const other = lines.find((x) => x.account !== l.account);
    const otherAcc = other ? accounts.find((a) => a.code === other.account) : null;
    if (acc.code.startsWith("6") && Number(l.credit) > 0) {
      return `Débit ${acc.code} (${acc.name}) ${fmt(l.credit)} / Crédit ${otherAcc?.code || other?.account || "?"} (${otherAcc?.name || ""}) ${fmt(l.credit)} — inversez les colonnes Débit/Crédit de cette ligne.`;
    }
    if (acc.code.startsWith("7") && Number(l.debit) > 0) {
      return `Crédit ${acc.code} (${acc.name}) ${fmt(l.debit)} / Débit ${otherAcc?.code || other?.account || "?"} (${otherAcc?.name || ""}) ${fmt(l.debit)} — inversez les colonnes Débit/Crédit de cette ligne.`;
    }
  }
  return null;
}
function buildReversedCorrectedLines(lines) {
  // Renvoie les lignes avec débit/crédit inversés pour la ligne fautive —
  // prêtes à être insérées telles quelles comme écriture corrigée.
  return lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit }));
}
function detectTaxAnomaly(taxActive, totalTax, subtotal, someProductsHaveTax) {
  if (taxActive && subtotal > 0 && totalTax === 0 && someProductsHaveTax) {
    return "Cette vente n'applique aucune taxe alors que d'autres produits de cette entreprise ont un taux de TCA défini — vérifiez la fiche des produits vendus.";
  }
  return null;
}
function isSimilarLabel(a, b) {
  if (!a || !b) return false;
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  return na === nb || na.includes(nb) || nb.includes(na);
}

// --- Suggestions guidées (forfait Assisté uniquement) ---
// Purement indicatif : propose un compte ou un nom de tiers déjà utilisé pour
// un libellé similaire, sans jamais rien appliquer automatiquement — l'utilisateur
// garde toujours la main pour accepter ou ignorer la suggestion.
function normalizeWords(str) {
  return (str || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/).filter((w) => w.length >= 3);
}
// Nettoie purement l'affichage du libellé montré dans une suggestion — les
// écritures d'achat/vente stockent un libellé technique complet ("Achat — X
// (Fournisseur)") ; on ne montre que la partie utile à l'utilisateur, sans
// jamais modifier la donnée réelle.
function cleanSuggestionLabel(str) {
  if (!str) return str;
  return str.replace(/^(Achat|Vente)\s*—\s*/, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}
function suggestAccountFromHistory(label, historyEntries) {
  const words = normalizeWords(label);
  if (words.length === 0 || !historyEntries || historyEntries.length === 0) return null;
  // Score chaque entrée historique par nombre de mots significatifs partagés,
  // puis regroupe par compte pour ne jamais cacher qu'un même libellé a pu être
  // affecté à des comptes différents (ex. selon le fournisseur) — l'utilisateur
  // doit voir toutes les options plausibles, pas une seule choisie en silence.
  const scored = [];
  for (const h of historyEntries) {
    if (!h.label || !h.account) continue;
    const hWords = normalizeWords(h.label);
    const score = words.filter((w) => hWords.includes(w)).length;
    if (score > 0) scored.push({ ...h, score });
  }
  if (scored.length === 0) return null;
  const maxScore = Math.max(...scored.map((s) => s.score));
  const topMatches = scored.filter((s) => s.score === maxScore);
  const byAccount = new Map();
  for (const m of topMatches) {
    const existing = byAccount.get(m.account);
    if (!existing || (m.date || "") > (existing.date || "")) byAccount.set(m.account, m);
  }
  const options = [...byAccount.values()].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return { options, ambiguous: options.length > 1 };
}
function suggestSimilarTiers(name, existingNames) {
  const n = (name || "").trim().toLowerCase();
  if (n.length < 3 || !existingNames || existingNames.length === 0) return null;
  const match = existingNames.find((existing) => {
    const e = (existing || "").trim().toLowerCase();
    if (!e || e === n) return false; // exactement identique : rien à suggérer
    return e === n.replace(/\s+/g, " ") || e.replace(/\s+/g, "") === n.replace(/\s+/g, "") || (e.length > 2 && (e.includes(n) || n.includes(e)));
  });
  return match || null;
}
function detectDuplicateAnomaly(newItem, recentItems) {
  const dup = (recentItems || []).find((it) => {
    if (Number(it.amount) !== Number(newItem.amount)) return false;
    const d1 = new Date(it.date).getTime();
    const d2 = new Date(newItem.date).getTime();
    if (!Number.isFinite(d1) || !Number.isFinite(d2)) return false;
    const daysApart = Math.abs(d1 - d2) / 86400000;
    if (daysApart > 1) return false;
    return isSimilarLabel(it.label, newItem.label);
  });
  if (dup) return "Une opération très proche (même montant, date proche, libellé similaire) existe déjà — vérifiez qu'il ne s'agit pas d'un doublon.";
  return null;
}
async function fetchHtgPerUsd() {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const data = await res.json();
    const rate = data?.rates?.HTG;
    if (typeof rate === "number" && rate > 0) return rate;
  } catch (e) { /* pas de réseau ou service indisponible : on utilisera le repli */ }
  return null;
}

const fmt = (n) => {
  const code = CURRENT_CURRENCY;
  const locale = CURRENCIES[code]?.locale || "fr-FR";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: code, maximumFractionDigits: 0 }).format(n || 0);
  } catch (e) {
    return `${Math.round(n || 0)} ${code}`;
  }
};

// Formate un horodatage ISO (createdAt) en "12/08/2026 à 14:32:07" (heure locale de
// l'appareil). Utilisé partout où on affiche à quel moment exact une opération a
// réellement été enregistrée dans le système — distinct de la "date" saisie par
// l'utilisateur, qui peut être antidatée ou postdatée volontairement.
const fmtTimestamp = (iso) => {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const datePart = d.toLocaleDateString("fr-FR");
    const timePart = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return `${datePart} à ${timePart}`;
  } catch (e) { return null; }
};

// Petit composant réutilisable : ligne discrète "Enregistré le ... à ..." affichée
// sous une ligne de tableau ou dans un panneau de détail, dans tous les modules.
const RecordedStamp = ({ createdAt }) => {
  const label = fmtTimestamp(createdAt);
  if (!label) return null;
  return <div className="text-xs mt-0.5" style={{ color: "#A39C87" }}>Enregistré le {label}</div>;
};

// --- Impression directe sur mini-imprimante thermique Bluetooth (ESC/POS via Web
// Bluetooth) ------------------------------------------------------------------
// Contrairement à window.print() (qui dépend de la boîte de dialogue d'impression
// du système, et donc d'une appli tierce type RawBT pour convertir en ESC/POS), le
// navigateur se connecte ici DIRECTEMENT à l'imprimante en Bluetooth Low Energy
// (API navigator.bluetooth) et lui envoie lui-même les commandes ESC/POS. Zéro
// appli à installer côté vendeur, une seule connexion à faire une fois par session.
//
// Limite connue : l'API Web Bluetooth n'existe que sur Chrome/Edge (desktop et
// Android) — pas sur Safari/iOS (restriction d'Apple, pas un manque côté Compta+).
//
// Les imprimantes thermiques chinoises bon marché (GOOJPRT, "Cat printer", etc.)
// exposent en général l'une de ces 3 paires service/caractéristique BLE pour
// recevoir des données en écriture — on essaie chacune dans l'ordre jusqu'à ce
// qu'une connexion réussisse, car ça varie selon le lot de fabrication même pour
// un modèle identique.
const BLE_PRINTER_CANDIDATES = [
  { service: "49535343-fe7d-4ae5-8fa9-9fafd205e455", write: "49535343-8841-43f4-a8d4-ecbe34729bb3" }, // ISSC Transparent UART (GOOJPRT PT-210 et clones)
  { service: "000018f0-0000-1000-8000-00805f9b34fb", write: "00002af1-0000-1000-8000-00805f9b34fb" },
  { service: "0000fee7-0000-1000-8000-00805f9b34fb", write: "0000fec7-0000-1000-8000-00805f9b34fb" },
];
const BLE_PRINTER_NAME_KEY = "comptaplus_bt_printer_name";
let _btPrinter = { device: null, characteristic: null };

function isThermalPrinterConnected() {
  return !!(_btPrinter.device && _btPrinter.device.gatt && _btPrinter.device.gatt.connected && _btPrinter.characteristic);
}
function getRememberedPrinterName() {
  try { return localStorage.getItem(BLE_PRINTER_NAME_KEY) || ""; } catch (e) { return ""; }
}

// Ouvre la fenêtre native de sélection Bluetooth du téléphone, se connecte, et
// trouve laquelle des paires service/caractéristique ci-dessus fonctionne sur
// l'appareil choisi. Doit être appelée depuis un clic direct de l'utilisateur
// (exigence du navigateur pour l'API Web Bluetooth, question de sécurité).
async function connectThermalPrinter() {
  if (!navigator.bluetooth) {
    throw new Error("Bluetooth non disponible sur ce navigateur. Utilisez Chrome sur Android (pas Safari/iPhone).");
  }
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: BLE_PRINTER_CANDIDATES.map((c) => c.service),
  });
  const server = await device.gatt.connect();
  let found = null;
  for (const candidate of BLE_PRINTER_CANDIDATES) {
    try {
      const service = await server.getPrimaryService(candidate.service);
      const characteristic = await service.getCharacteristic(candidate.write);
      found = characteristic;
      break;
    } catch (e) { /* ce candidat ne correspond pas à cet appareil, on essaie le suivant */ }
  }
  if (!found) {
    try { device.gatt.disconnect(); } catch (e) {}
    throw new Error("Imprimante connectée en Bluetooth, mais son protocole n'a pas été reconnu. Contactez le support avec le nom exact du modèle.");
  }
  device.addEventListener("gattserverdisconnected", () => {
    _btPrinter = { device: null, characteristic: null };
  });
  _btPrinter = { device, characteristic: found };
  try { localStorage.setItem(BLE_PRINTER_NAME_KEY, device.name || "Imprimante"); } catch (e) {}
  return device.name || "Imprimante";
}

function disconnectThermalPrinter() {
  try { if (_btPrinter.device && _btPrinter.device.gatt) _btPrinter.device.gatt.disconnect(); } catch (e) {}
  _btPrinter = { device: null, characteristic: null };
}

// Envoie les octets à l'imprimante par petits blocs — les caractéristiques BLE
// refusent les écritures trop volumineuses d'un coup (limite typique ~180-512
// octets selon l'appareil).
async function writeToThermalPrinter(bytes) {
  const chunkSize = 100;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    await _btPrinter.characteristic.writeValue(chunk);
  }
}

// Remplace chaque caractère accentué par son équivalent sans accent. En théorie,
// un encodage CP1252/Latin-1 correct devrait suffire (voir plus bas), mais dans la
// pratique, le firmware de certaines imprimantes bon marché (confirmé sur le
// GOOJPRT PT-210 en test réel) n'affiche pas ces caractères correctement, peu
// importe l'octet envoyé. Plutôt que parier sur un réglage de police propre à
// chaque modèle, on évite complètement le problème : le texte reste lisible sur
// n'importe quel matériel, au prix de l'accent.
const ACCENT_FOLD = { "à": "a", "â": "a", "ä": "a", "á": "a", "ã": "a", "å": "a", "À": "A", "Â": "A", "Ä": "A", "Á": "A",
  "é": "e", "è": "e", "ê": "e", "ë": "e", "É": "E", "È": "E", "Ê": "E", "Ë": "E",
  "î": "i", "ï": "i", "í": "i", "ì": "i", "Î": "I", "Ï": "I",
  "ô": "o", "ö": "o", "ó": "o", "ò": "o", "õ": "o", "Ô": "O", "Ö": "O",
  "û": "u", "ü": "u", "ú": "u", "ù": "u", "Û": "U", "Ü": "U",
  "ç": "c", "Ç": "C", "ñ": "n", "Ñ": "N", "œ": "oe", "Œ": "OE" };
function foldAccents(str) {
  return String(str ?? "").replace(/[àâäáãåÀÂÄÁéèêëÉÈÊËîïíìÎÏôöóòõÔÖûüúùÛÜçÇñÑœŒ]/g, (ch) => ACCENT_FOLD[ch] || ch);
}

// Encodage des caractères accentués français : la plupart de ces imprimantes ne
// comprennent pas l'UTF-8 (multi-octets) mais un jeu de caractères sur un seul
// octet (CP1252/Latin-1), où les lettres accentuées françaises (é, è, à, ç, ô...)
// occupent justement les mêmes codes qu'en Unicode ≤ 255. Quelques symboles
// spécifiques (œ, Œ, guillemets typographiques) sont mappés à la main car ils
// sortent de cette plage. Les accents sont malgré tout retirés au préalable (voir
// foldAccents ci-dessus) avant d'arriver ici, pour les imprimantes qui ignorent cet
// encodage — cette fonction reste utile pour les guillemets/tirets typographiques.
const CP1252_EXTRA = { "œ": 0x9c, "Œ": 0x8c, "€": 0x80, "’": 0x27, "‘": 0x27, "“": 0x22, "”": 0x22, "–": 0x2d, "—": 0x2d, "…": "...", "\u00A0": 0x20, "\u202F": 0x20 };
function escposTextToBytes(str) {
  const out = [];
  for (const ch of foldAccents(str)) {
    const mapped = CP1252_EXTRA[ch];
    if (typeof mapped === "string") { for (const c2 of mapped) out.push(c2.charCodeAt(0)); continue; }
    if (typeof mapped === "number") { out.push(mapped); continue; }
    const code = ch.charCodeAt(0);
    out.push(code <= 0xff ? code : 0x3f); // caractère non supporté -> "?"
  }
  return out;
}

// Découpe un texte en lignes ne dépassant pas `width` caractères, en coupant de
// préférence sur un espace plutôt qu'en plein milieu d'un mot.
function wrapPlain(str, width) {
  const words = String(str ?? "").split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? cur + " " + w : w;
    if (candidate.length > width) {
      if (cur) lines.push(cur);
      if (w.length > width) {
        // Le mot seul dépasse la largeur de la ligne (ex. une longue adresse
        // email) : on le découpe en plusieurs lignes complètes plutôt que de
        // couper silencieusement les derniers caractères (perdus autrement).
        let rest = w;
        while (rest.length > width) {
          lines.push(rest.slice(0, width));
          rest = rest.slice(width);
        }
        cur = rest;
      } else {
        cur = w;
      }
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
// Aligne deux morceaux de texte sur une même ligne (gauche + droite), avec des
// espaces au milieu — utilisé pour "qté x prix ... sous-total" et les totaux.
function twoCols(left, right, width) {
  left = String(left ?? ""); right = String(right ?? "");
  const space = Math.max(1, width - left.length - right.length);
  if (left.length + right.length >= width) {
    left = left.slice(0, Math.max(0, width - right.length - 1));
    return left + " " + right;
  }
  return left + " ".repeat(space) + right;
}

// Commandes ESC/POS de base
const ESC_INIT = [0x1b, 0x40];
const ESC_ALIGN = (n) => [0x1b, 0x61, n]; // 0 gauche, 1 centre, 2 droite
const ESC_BOLD = (on) => [0x1b, 0x45, on ? 1 : 0];
const ESC_FEED = (n) => [0x1b, 0x64, n];
const LF = [0x0a];

// Construit le ticket complet en octets ESC/POS prêts à envoyer à l'imprimante,
// à partir des mêmes données de facture que downloadInvoiceTicketPDF ci-dessous.
// charsPerLine=32 correspond à la largeur d'impression réelle du GOOJPRT PT-210
// (384 points / 12 points par caractère en police standard) — indépendant du
// réglage "Format d'impression" (A4/ticket80/58) qui, lui, ne concerne que le PDF
// et l'impression système.
function buildInvoiceEscPos(inv, settings, charsPerLine = 32) {
  const bytes = [];
  const push = (arr) => bytes.push(...arr);
  const line = (str = "") => { push(escposTextToBytes(str)); push(LF); };
  const dashLine = () => line("-".repeat(charsPerLine));

  push(ESC_INIT);
  push(ESC_ALIGN(1));
  push(ESC_BOLD(true));
  line(settings.companyName || "Mon Entreprise");
  push(ESC_BOLD(false));
  if (settings.companyAddress) wrapPlain(settings.companyAddress, charsPerLine).forEach(line);
  const contact = [settings.companyPhone, settings.companyEmail].filter(Boolean).join(" - ");
  if (contact) wrapPlain(contact, charsPerLine).forEach(line);
  push(ESC_ALIGN(0));
  dashLine();

  line(`Facture N° ${inv.number}`);
  line(String(inv.date));
  line(`Client : ${inv.client || "Client comptant"}`);
  if (inv.soldByName) line(`Vendeur : ${inv.soldByName}`);
  dashLine();

  (inv.lines || []).forEach((l) => {
    wrapPlain(l.name, charsPerLine).forEach(line);
    line(twoCols(`${l.qty} x ${fmt(l.price)}`, fmt(l.subtotal), charsPerLine));
  });
  dashLine();

  line(twoCols("Sous-total HT", fmt(inv.totalHT), charsPerLine));
  if (inv.globalDiscountAmount > 0) line(twoCols("Remise", `-${fmt(inv.globalDiscountAmount)}`, charsPerLine));
  (inv.fees || []).forEach((f) => line(twoCols(f.label || "Frais", `+${fmt(f.amount)}`, charsPerLine)));
  line(twoCols(inv.taxLabel || "Taxe", fmt(inv.totalTax), charsPerLine));
  push(ESC_BOLD(true));
  line(twoCols("TOTAL", fmt(inv.total), charsPerLine));
  push(ESC_BOLD(false));
  dashLine();

  push(ESC_ALIGN(1));
  line(`Paiement : ${inv.paymentMode === "caisse" ? "Caisse" : inv.paymentMode === "banque" ? "Banque" : "Crédit"}`);
  if ((inv.payments || []).length > 0) {
    const paidTotal = inv.payments.reduce((s, p) => s + p.amount, 0);
    const balance = Math.max(0, (inv.total || 0) - paidTotal);
    line(`Versé : ${fmt(paidTotal)} - Solde dû : ${fmt(balance)}`);
  }
  line("Merci de votre confiance !");
  if (settings.invoiceFooterNote && settings.invoiceFooterNote.trim()) {
    wrapPlain(settings.invoiceFooterNote.trim(), charsPerLine).forEach(line);
  }
  push(ESC_FEED(4)); // marge pour la déchirure manuelle du papier (pas de massicot sur le PT-210)
  return new Uint8Array(bytes);
}

// Point d'entrée appelé depuis les boutons "Imprimer (Bluetooth)" — se connecte
// automatiquement si aucune imprimante n'est déjà attachée à cette session.
async function printInvoiceBluetooth(inv, settings, showToast) {
  try {
    if (!isThermalPrinterConnected()) {
      showToast && showToast("Choisissez l'imprimante dans la liste Bluetooth…");
      await connectThermalPrinter();
    }
    const bytes = buildInvoiceEscPos(inv, settings);
    await writeToThermalPrinter(bytes);
    showToast && showToast("Ticket envoyé à l'imprimante.");
  } catch (e) {
    showToast && showToast("Impression Bluetooth impossible : " + (e && e.message ? e.message : e));
  }
}

// --- Génération de vrais fichiers PDF téléchargeables (jsPDF, chargé via CDN dans
// index.html) — déclenche un téléchargement direct du fichier, contrairement à
// window.print() qui dépend de la boîte de dialogue d'impression du système et se
// révèle peu fiable pour "Enregistrer en PDF" sur certains navigateurs mobiles
// (Android/iOS). Utilisé pour les factures et les rapports comptables.
const HEADER_RGB = [21, 34, 56];

// jsPDF utilise les polices PDF standards (Helvetica/Times/Courier), qui ne
// contiennent pas le caractère d'espace fine insécable qu'utilise Intl.NumberFormat
// (fmt()) comme séparateur de milliers en français — ce caractère s'affiche alors
// comme un symbole de remplacement (souvent une barre oblique visible dans le PDF)
// au lieu d'un simple espace. On le remplace par une espace normale uniquement au
// moment d'écrire dans le PDF — l'affichage à l'écran, lui, n'a jamais ce problème
// (les polices web gèrent ce caractère correctement) et reste inchangé.
const pdfSafe = (s) => String(s ?? "").replace(/[\u00A0\u202F\u2000-\u200B\u2007\u2009]/g, " ");

// Génère un PDF en format ticket étroit (58 ou 80 mm), mise en page condensée dédiée
// — pas simplement le PDF A4 rétréci. Une seule colonne, texte centré pour l'en-tête,
// séparateurs en pointillés, adapté à l'impression sur mini-imprimante (via pilote
// système standard — voir note dans l'interface pour les limites de ce mécanisme).
function downloadInvoiceTicketPDF(inv, settings, widthMm) {
  if (!window.jspdf) { alert("Le générateur de PDF n'a pas fini de charger — réessayez dans quelques secondes."); return; }
  const { jsPDF } = window.jspdf;
  const lineCount = (inv.lines || []).length;
  const estHeight = 60 + lineCount * 10 + (inv.fees || []).length * 5;
  const doc = new jsPDF({ unit: "mm", format: [widthMm, Math.max(80, estHeight)] });
  const cx = widthMm / 2;
  const margin = 3;
  const innerW = widthMm - margin * 2;
  let y = 5;
  const dashLine = () => { doc.setLineDashPattern([0.5, 0.5], 0); doc.line(margin, y, widthMm - margin, y); doc.setLineDashPattern([], 0); y += 4; };

  if (settings.companyLogo) {
    try { doc.addImage(settings.companyLogo, "JPEG", cx - 6, y, 12, 12); y += 14; } catch (e) {}
  }
  doc.setFontSize(10);
  doc.text(pdfSafe(settings.companyName || "Mon Entreprise"), cx, y, { align: "center" }); y += 4;
  doc.setFontSize(7);
  if (settings.companyAddress) { doc.text(pdfSafe(settings.companyAddress), cx, y, { align: "center" }); y += 3.5; }
  const contact = [settings.companyPhone, settings.companyEmail].filter(Boolean).join(" · ");
  if (contact) { doc.text(pdfSafe(contact), cx, y, { align: "center" }); y += 3.5; }
  y += 1;
  dashLine();

  doc.setFontSize(8);
  doc.text(pdfSafe(`Facture N° ${inv.number}`), margin, y); y += 4;
  doc.text(pdfSafe(String(inv.date)), margin, y); y += 4;
  doc.text(pdfSafe(`Client : ${inv.client || "Client comptant"}`), margin, y); y += 4;
  if (inv.soldByName) { doc.text(pdfSafe(`Vendeur : ${inv.soldByName}`), margin, y); y += 4; }
  dashLine();

  doc.setFontSize(7);
  (inv.lines || []).forEach((l) => {
    doc.text(pdfSafe(l.name), margin, y); y += 3.2;
    doc.text(pdfSafe(`${l.qty} x ${fmt(l.price)}`), margin, y);
    doc.text(pdfSafe(fmt(l.subtotal)), widthMm - margin, y, { align: "right" });
    y += 4;
  });
  dashLine();

  doc.setFontSize(7.5);
  doc.text("Sous-total HT", margin, y); doc.text(pdfSafe(fmt(inv.totalHT)), widthMm - margin, y, { align: "right" }); y += 4;
  if (inv.globalDiscountAmount > 0) {
    doc.text("Remise", margin, y); doc.text(pdfSafe(`-${fmt(inv.globalDiscountAmount)}`), widthMm - margin, y, { align: "right" }); y += 4;
  }
  (inv.fees || []).forEach((f) => {
    doc.text(pdfSafe(f.label || "Frais"), margin, y); doc.text(pdfSafe(`+${fmt(f.amount)}`), widthMm - margin, y, { align: "right" }); y += 4;
  });
  doc.text(pdfSafe(inv.taxLabel || "Taxe"), margin, y); doc.text(pdfSafe(fmt(inv.totalTax)), widthMm - margin, y, { align: "right" }); y += 5;
  doc.setFontSize(9);
  doc.text("TOTAL", margin, y); doc.text(pdfSafe(fmt(inv.total)), widthMm - margin, y, { align: "right" }); y += 5;
  dashLine();

  doc.setFontSize(7);
  doc.text(pdfSafe(`Paiement : ${inv.paymentMode === "caisse" ? "Caisse" : inv.paymentMode === "banque" ? "Banque" : "Crédit"}`), cx, y, { align: "center" }); y += 4;
  if ((inv.payments || []).length > 0) {
    const paidTotal = inv.payments.reduce((s, p) => s + p.amount, 0);
    const balance = Math.max(0, (inv.total || 0) - paidTotal);
    doc.text(pdfSafe(`Versé : ${fmt(paidTotal)} — Solde dû : ${fmt(balance)}`), cx, y, { align: "center" }); y += 4;
  }
  doc.text("Merci de votre confiance !", cx, y, { align: "center" });
  if (settings.invoiceFooterNote && settings.invoiceFooterNote.trim()) {
    y += 5;
    const noteLines = doc.splitTextToSize(pdfSafe(settings.invoiceFooterNote.trim()), widthMm - margin * 2);
    noteLines.forEach((line) => { doc.text(line, cx, y, { align: "center" }); y += 3.2; });
  }

  doc.save(`Facture-${inv.number}-ticket.pdf`);
}

function downloadInvoicePDF(inv, settings) {
  if (settings.receiptFormat === "ticket80") return downloadInvoiceTicketPDF(inv, settings, 80);
  if (settings.receiptFormat === "ticket58") return downloadInvoiceTicketPDF(inv, settings, 58);
  if (!window.jspdf) { alert("Le générateur de PDF n'a pas fini de charger — réessayez dans quelques secondes."); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const pageRight = 196; // marge droite (A4, 210mm de large moins ~14mm de marge)
  // Logo en en-tête (n'échoue jamais le PDF si l'image est invalide/corrompue — la
  // génération continue sans logo dans ce cas).
  let headerX = 14;
  if (settings.companyLogo) {
    try { doc.addImage(settings.companyLogo, "JPEG", 14, 10, 18, 18); headerX = 36; } catch (e) {}
  }
  doc.setFontSize(16);
  doc.text(pdfSafe(settings.companyName || "Mon Entreprise"), headerX, 18);
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  let y = 24;
  if (settings.companyAddress) { doc.text(pdfSafe(settings.companyAddress), headerX, y); y += 5; }
  const contact = [settings.companyPhone, settings.companyEmail].filter(Boolean).join("  ·  ");
  if (contact) { doc.text(pdfSafe(contact), headerX, y); y += 5; }
  // Bloc "FACTURE / N° / date" aligné à droite sur la marge de page (pas seulement
  // aligné à gauche sur un même point de départ) — évite l'effet "en escalier" que
  // donnaient des lignes de largeurs différentes toutes démarrées au même endroit.
  doc.setTextColor(21, 34, 56);
  doc.setFontSize(14);
  doc.text("FACTURE", pageRight, 18, { align: "right" });
  doc.setFontSize(10);
  doc.text(pdfSafe(`N° ${inv.number}`), pageRight, 25, { align: "right" });
  doc.text(pdfSafe(String(inv.date)), pageRight, 30, { align: "right" });
  // Séparateur horizontal sous tout l'en-tête, pour la même clarté visuelle que la
  // version imprimée depuis l'écran (bordure sous l'en-tête).
  const headerBottom = Math.max(y + 4, settings.companyLogo ? 32 : 24);
  doc.setDrawColor(21, 34, 56);
  doc.setLineWidth(0.6);
  doc.line(14, headerBottom, pageRight, headerBottom);
  doc.setTextColor(21, 34, 56);
  doc.setFontSize(10);
  doc.text(pdfSafe(`Client : ${inv.client || "Client comptant"}`), 14, headerBottom + 8);
  doc.autoTable({
    startY: headerBottom + 14,
    head: [["Article", "Qté", "Prix unit.", "Remise", "Sous-total HT", inv.taxLabel || "Taxe"]],
    body: (inv.lines || []).map((l) => [
      l.name, String(l.qty), fmt(l.price),
      l.discountAmt > 0 ? `-${fmt(l.discountAmt)}` : l.discountPct > 0 ? `-${l.discountPct}%` : "—",
      fmt(l.subtotal), fmt(l.taxAmount),
    ].map(pdfSafe)),
    styles: { fontSize: 9 },
    headStyles: { fillColor: HEADER_RGB },
  });
  let ty = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(10);
  doc.text(pdfSafe(`Sous-total HT : ${fmt(inv.totalHT)}`), 130, ty); ty += 6;
  if (inv.globalDiscountAmount > 0) { doc.text(pdfSafe(`Remise globale : -${fmt(inv.globalDiscountAmount)}`), 130, ty); ty += 6; }
  (inv.fees || []).forEach((f) => { doc.text(pdfSafe(`${f.label || "Frais"} : +${fmt(f.amount)}`), 130, ty); ty += 6; });
  doc.text(pdfSafe(`${inv.taxLabel || "Taxe"} : ${fmt(inv.totalTax)}`), 130, ty); ty += 8;
  doc.setFontSize(12);
  doc.text(pdfSafe(`Total : ${fmt(inv.total)}`), 130, ty); ty += 10;
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(pdfSafe(`Mode de paiement : ${inv.paymentMode === "caisse" ? "Caisse" : inv.paymentMode === "banque" ? "Banque" : inv.paymentMode === "don" ? "Don" : "Crédit"}`), 14, ty);
  if ((inv.payments || []).length > 0) {
    ty += 5;
    const paidTotal = inv.payments.reduce((s, p) => s + p.amount, 0);
    const balance = Math.max(0, (inv.total || 0) - paidTotal);
    doc.text(pdfSafe(`Versé : ${fmt(paidTotal)} — Solde dû : ${fmt(balance)}`), 14, ty);
  }
  if (settings.invoiceFooterNote && settings.invoiceFooterNote.trim()) {
    ty += 8;
    const noteLines = doc.splitTextToSize(pdfSafe(settings.invoiceFooterNote.trim()), 180);
    noteLines.forEach((line) => { doc.text(line, 14, ty); ty += 4.5; });
  }
  doc.save(`Facture-${inv.number}.pdf`);
}

function downloadTablePDF({ title, settings, columns, rows, footerLines }) {
  if (!window.jspdf) { alert("Le générateur de PDF n'a pas fini de charger — réessayez dans quelques secondes."); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let headerX = 14;
  if (settings.companyLogo) {
    try { doc.addImage(settings.companyLogo, "JPEG", 14, 8, 16, 16); headerX = 34; } catch (e) {}
  }
  let y = 16;
  doc.setFontSize(14);
  doc.text(pdfSafe(settings.companyName || "Mon Entreprise"), headerX, y); y += 6;
  if (settings.companyAddress) { doc.setFontSize(9); doc.setTextColor(90, 90, 90); doc.text(pdfSafe(settings.companyAddress), headerX, y); doc.setTextColor(0, 0, 0); y += 6; }
  doc.setFontSize(12);
  doc.text(pdfSafe(title), headerX, y + 2); y += 8;
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(`Généré le ${todayStr()}`, 14, y);
  doc.setTextColor(0, 0, 0);
  doc.autoTable({
    startY: y + 5,
    head: [columns.map(pdfSafe)],
    body: rows.map((r) => r.map(pdfSafe)),
    styles: { fontSize: 9 },
    headStyles: { fillColor: HEADER_RGB },
  });
  if (footerLines && footerLines.length) {
    let fy = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(10);
    footerLines.forEach((line) => { doc.text(pdfSafe(line), 14, fy); fy += 6; });
  }
  doc.save(`${title.replace(/\s+/g, "-")}-${todayStr()}.pdf`);
}

const monthLabel = (d) => {
  // Construit la date à partir des composants AAAA-MM-JJ directement en heure locale,
  // sans passer par l'interprétation UTC de `new Date(chaîne)` — celle-ci décale les
  // dates proches du début du mois (ex. le 1er août affiché comme "juillet") pour tout
  // fuseau horaire en retard sur UTC, ce qui est le cas d'Haïti (UTC-5/-4).
  const [y, m] = (d || "").split("-");
  if (!y || !m) return "";
  const dt = new Date(Number(y), Number(m) - 1, 1);
  return dt.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
};

// Regroupe une date AAAA-MM-JJ selon la granularité voulue — utilisé par le
// tableau de bord Super Admin (Rapports et analyse) pour permettre à l'utilisateur
// de choisir librement mois / trimestre / année comme unité de regroupement.
const periodLabel = (d, groupBy) => {
  const [y, m] = (d || "").split("-");
  if (!y || !m) return "";
  if (groupBy === "annee") return y;
  if (groupBy === "trimestre") return `${y}-T${Math.floor((Number(m) - 1) / 3) + 1}`;
  return monthLabel(d);
};

// Redimensionne et compresse une image uploadée (produit/service) avant stockage,
// pour éviter que le catalogue ne devienne trop lourd (limite de stockage par clé).
function resizeImage(file, maxSize = 160, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height) {
          if (width > maxSize) { height = Math.round(height * (maxSize / width)); width = maxSize; }
        } else {
          if (height > maxSize) { width = Math.round(width * (maxSize / height)); height = maxSize; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Solde restant dû sur une facture, compte tenu des paiements partiels déjà enregistrés
const balanceDue = (inv) => Math.max(0, (inv?.total || 0) - (inv?.payments || []).reduce((s, p) => s + p.amount, 0));

// Construit une écriture équilibrée à 2 lignes (compte débité / compte crédité)
const simpleEntry = (date, label, debitAccount, creditAccount, amount) => ({
  id: uid(),
  date,
  createdAt: new Date().toISOString(),
  label,
  lines: [
    { account: debitAccount, debit: amount, credit: 0 },
    { account: creditAccount, debit: 0, credit: amount },
  ],
});

function App() {
  const [active, setActive] = useState("dashboard");
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
  // Poste de vente : identité propre à CET appareil (pas au compte de l'utilisateur
  // connecté), stockée en localStorage — persiste tant que le vendeur reste sur le
  // même appareil, peu importe qui s'y connecte. Déclaré ici (niveau App) plutôt que
  // dans VenteModule pour que la barre latérale (nom du vendeur affiché) reste
  // réactive à un changement de poste, au lieu de lire localStorage indépendamment
  // sans jamais être notifiée d'un changement fait ailleurs dans l'arbre.
  const [stationId, setStationId] = useState(() => {
    try { return localStorage.getItem("compta-plus-station-id") || ""; } catch (e) { return ""; }
  });
  useEffect(() => {
    try {
      if (stationId) localStorage.setItem("compta-plus-station-id", stationId);
      else localStorage.removeItem("compta-plus-station-id");
    } catch (e) {}
  }, [stationId]);
  const currentStationForSidebar = (salesStations || []).find((s) => String(s.id) === String(stationId)) || null;
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
      ...ASSET_CATEGORIES.flatMap((c) => [
        { code: c.assetAccount, name: c.label, type: "Actif" },
        { code: c.depreciationAccount, name: `Amortissements — ${c.label}`, type: "Actif" },
      ]),
      { code: "6811", name: "Dotations aux amortissements des immobilisations", type: "Charge" },
      { code: "404", name: "Fournisseurs d'immobilisations", type: "Passif" },
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
  const [role, setRole] = useState("Administrateur");
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  const [planStatus, setPlanStatus] = useState("active"); // "trial" | "active" | "suspended" — "active" par défaut hors mode Supabase
  const [planTier, setPlanTier] = useState("standard"); // "standard" | "assisted"
  const [trialEndsAt, setTrialEndsAt] = useState(null);
  const [isAssistedSupervisor, setIsAssistedSupervisor] = useState(false);
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
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
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
      if (companyErr) throw new Error(`Création de l'entreprise refusée — ${companyErr.message || companyErr.code}`);
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
        throw new Error(`Rattachement à l'entreprise refusé (entreprise annulée automatiquement) — ${memberErr.message || memberErr.code}`);
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
      window.alert(`Échec de la création de l'entreprise :\n\n${e.message || e}`);
      showToast(`Erreur lors de la création : ${e.message || e}`);
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
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinChecking, setPinChecking] = useState(false);
  const [showSecurityPanel, setShowSecurityPanel] = useState(false);
  const readOnly = role === "Lecture seule";
  const allowedModuleIds = ROLE_MODULE_ACCESS[role] || null; // null = accès à tous les modules
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
    invoices.filter((inv) => inv.status !== "annulée" && inv.status !== "don" && !saleEntriesByInvoiceTop[inv.id]).length;
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
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
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
  const unwrapVersioned = (parsed) => {
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "v" in parsed && "data" in parsed) {
      return { v: Number(parsed.v) || 0, data: parsed.data };
    }
    return { v: 0, data: parsed };
  };

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
        // Sauvegarde réussie : si cette catégorie était en échec, on l'efface de l'avertissement.
        setSyncErrorCategories((prev) => prev.filter((c) => c !== category));
      } catch (e) {
        // CRITIQUE : ne jamais laisser un échec de sauvegarde passer inaperçu — sans ceci,
        // les données peuvent sembler enregistrées à l'écran alors qu'elles ne le sont pas
        // réellement côté serveur, avec un risque de perte définitive à la déconnexion.
        console.error(`Erreur d'enregistrement (${category})`, e);
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
          showToast(`Anomalie de synchronisation sur « ${transactionLabel} » : ${label} non confirmé(e). Vérifiez votre connexion — le détail reste consultable dans Administration → Historique.`);
          logAudit("Synchronisation", "Anomalie de synchronisation", `${transactionLabel} — non confirmé après nouvel essai : ${label}`);
        }
      } catch (e) { /* dernier filet : la sauvegarde passive (useEffect) reste active en arrière-plan */ }
    }, 4000);
  };

  useEffect(() => {
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

      // Charge chaque catégorie avec jusqu'à 3 tentatives (courte pause entre chaque) :
      // un simple aléa réseau au démarrage ne doit jamais être confondu avec une
      // absence réelle de données, sous peine de réintroduire les valeurs de secours
      // locales (ex. les 3 articles d'exemple) par-dessus le vrai catalogue au prochain
      // enregistrement automatique.
      const fetchWithRetry = async (key, attempts = 3) => {
        for (let i = 0; i < attempts; i++) {
          try {
            const res = await window.storage.get(key);
            return { ok: true, res };
          } catch (e) {
            if (i < attempts - 1) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
          }
        }
        return { ok: false, res: null };
      };
      try {
        const results = await Promise.all(CATEGORIES.map((c) => fetchWithRetry(`compta-${c}`)));
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
        const membership = await resolveMembership();
        setRole(membership.role);
        setCurrentUserEmail(membership.email || "");
        setNeedsWelcome(!!membership.isNewCompany);
        // Suspension automatique : trial_ends_at sert de date de fin générique (fin
        // d'essai OU fin de la période active/payée en cours, fixée par le Super
        // Admin lors de l'activation). Si le compte est "active" mais que cette date
        // est dépassée, on le repasse localement (et côté base) à "suspended" pour
        // réinitialisation, sans attendre qu'un Super Admin s'en aperçoive.
        let effectiveStatus = membership.planStatus || "trial";
        if (effectiveStatus === "active" && membership.trialEndsAt && new Date(membership.trialEndsAt) < new Date()) {
          effectiveStatus = "suspended";
          try { await supabase.from("companies").update({ plan_status: "suspended" }).eq("id", membership.companyId); } catch (e) { /* le blocage local reste actif même si la synchro échoue */ }
        }
        setPlanStatus(effectiveStatus);
        setPlanTier(membership.planTier || "standard");
        setIsAssistedSupervisor(!!membership.isAssistedSupervisor);
        if ((membership.planTier || "standard") === "assisted") loadPendingRecommendations(membership.companyId);
        setTrialEndsAt(membership.trialEndsAt || null);
        setCompanyHasPin(!!membership.hasSecurityPin);
        setCompanyPinCompanyId(membership.companyId);
        try {
          setPinVerified(sessionStorage.getItem("compta-plus-pin-verified-" + membership.companyId) === "true");
        } catch (e) { setPinVerified(false); }
        try {
          const { data: pa } = await supabase.from("platform_admins").select("email").eq("email", membership.email).maybeSingle();
          setIsPlatformAdmin(!!pa);
        } catch (e) { /* table absente ou hors mode Supabase : pas admin plateforme */ }
      } catch (e) {
        // pas de session Supabase
        await dlog("resolveMembership_threw", { message: e?.message || String(e) });
        setMembershipError(e?.message || String(e));
      }
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
      const data = { accounts, entries, products, productImages, invoices, suppliers, purchases, movements, clients, settings, users, employees, payslips, salaryAdvances, salesStations };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sauvegarde-auto-${settings.companyName || "erp"}-${todayStr()}.json`;
      a.click();
      URL.revokeObjectURL(url);
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
  const visibleSyncErrorCategories = role === "Vendeur"
    ? syncErrorCategories.filter((c) => VENDEUR_WRITABLE_CATEGORIES.includes(c))
    : syncErrorCategories;
  // Tant que la bannière d'erreur de synchronisation est affichée, on retente
  // automatiquement en arrière-plan toutes les 20 secondes — sans ça, la bannière
  // restait affichée indéfiniment même après le retour de la connexion, tant que
  // l'utilisateur ne cliquait pas lui-même sur "Réessayer".
  useEffect(() => {
    if (visibleSyncErrorCategories.length === 0) return;
    const id = setInterval(() => { retryAllSaves(); }, 20000);
    return () => clearInterval(id);
  }, [visibleSyncErrorCategories.length]);
  // Empêche de fermer l'onglet ou de recharger la page tant qu'une sauvegarde
  // reste en échec — sans ça, un changement pas encore réellement enregistré côté
  // serveur (visible seulement en mémoire locale) disparaît silencieusement au
  // rechargement, avant même que le rattrapage automatique ci-dessus n'ait eu le
  // temps de le corriger tout seul.
  useEffect(() => {
    const handler = (e) => {
      if (visibleSyncErrorCategories.length > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [visibleSyncErrorCategories.length]);
  const retryAllSaves = async () => {
    setRetrySaving(true);
    const values = {
      accounts, entries, products, invoices, suppliers, purchases,
      movements, clients, settings, users, productImages, auditLog,
      employees, payslips, salaryAdvances, salesStations, assets, accruals, deferrals, riskProvisions,
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
    setToast(msg);
    // Durée adaptée à la longueur du message : un texte d'anomalie détaillé (avec
    // orientation vers un comptable) a besoin de bien plus de temps de lecture
    // qu'une simple confirmation ("Écriture enregistrée."). Plancher 2.2s (comme
    // avant), plafond 9s pour ne pas bloquer l'écran indéfiniment.
    const duration = Math.min(9000, Math.max(2200, msg.length * 60));
    setTimeout(() => setToast(null), duration);
  };

  const balances = useMemo(() => {
    const b = {};
    accounts.forEach((a) => (b[a.code] = 0));
    entries.forEach((e) => {
      (e.lines || []).forEach((l) => {
        b[l.account] = (b[l.account] || 0) + Number(l.debit || 0) - Number(l.credit || 0);
      });
    });
    return b;
  }, [accounts, entries]);

  const kpis = useMemo(() => {
    const sumType = (type, sign = 1) =>
      accounts
        .filter((a) => a.type === type)
        .reduce((s, a) => s + sign * (balances[a.code] || 0), 0);
    const produits = sumType("Produit", -1);
    const charges = sumType("Charge", 1);
    const tresorerie = (balances["512"] || 0) + (balances["530"] || 0);
    return {
      produits,
      charges,
      resultat: produits - charges,
      tresorerie,
    };
  }, [accounts, balances]);

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
  const payWithMonCash = async () => {
    setMonCashLoading(true);
    setMonCashError("");
    try {
      const { companyId } = await resolveMembership();
      const { data: { session: s } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/moncash?action=create`, {
        method: "POST",
        headers: { Authorization: `Bearer ${s.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, amount: monCashAmount }),
      });
      const data = await res.json();
      if (!res.ok || !data.redirectUrl) throw new Error(data.error || "Réponse invalide du service de paiement");
      window.location.href = data.redirectUrl;
    } catch (e) {
      setMonCashError(String(e.message || e));
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
  const [welcomeTier, setWelcomeTier] = useState("standard"); // "standard" | "assisted"
  const submitWelcome = async () => {
    const name = welcomeName.trim() || "Mon Entreprise";
    try {
      const { companyId } = await resolveMembership();
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
      await supabase.from("companies").update({ name, plan_tier: welcomeTier }).eq("id", companyId);
      setSettings({ ...settings, companyName: name });
      setPlanTier(welcomeTier);
      setNeedsWelcome(false);
    } catch (e) {
      // Hors mode Supabase (ou vérification indisponible) : le nom local suffit,
      // on ne bloque jamais l'onboarding sur un souci réseau ponctuel.
      setSettings({ ...settings, companyName: name });
      setNeedsWelcome(false);
    }
  };

  if (membershipError) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(160deg, #F4FBE8 0%, #DFF0BE 55%, #C7E296 100%)", fontFamily: "'Inter', sans-serif" }}>
        <div className="bg-white rounded-lg p-8 max-w-sm w-full mx-4 text-center" style={{ border: "1px solid #E4DFD1" }}>
          <Lock size={28} className="mx-auto mb-3" style={{ color: "#A6432F" }} />
          <div className="display text-xl mb-2" style={{ color: "#152238" }}>Connexion refusée</div>
          <p className="text-sm mb-5 text-left" style={{ color: "#7A7460" }}>{membershipError}</p>
          <button onClick={() => { clearMembershipCache(); setMembershipError(null); supabase.auth.signOut(); }}
            className="w-full py-2.5 rounded text-sm text-white" style={{ background: "#152238" }}>
            Se déconnecter et réessayer
          </button>
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
            placeholder="Nom de l'entreprise" autoFocus
            className="w-full border rounded px-3 py-2 text-sm mb-4" style={{ borderColor: "#DDD6C4" }}
            onKeyDown={(e) => e.key === "Enter" && submitWelcome()} />
          <div className="text-xs font-medium mb-2" style={{ color: "#152238" }}>Choisissez votre forfait</div>
          <div className="grid grid-cols-2 gap-2 mb-4">
            <button onClick={() => setWelcomeTier("standard")}
              className="text-left p-3 rounded border-2"
              style={{ borderColor: welcomeTier === "standard" ? "#152238" : "#DDD6C4", background: welcomeTier === "standard" ? "#F4F2EC" : "#fff" }}>
              <div className="text-sm font-medium" style={{ color: "#152238" }}>Standard</div>
              <div className="text-xs mb-1" style={{ color: "#8A8370" }}>20 $/mois</div>
              <div className="text-xs" style={{ color: "#8A8370" }}>Toutes les fonctionnalités de base</div>
            </button>
            <button onClick={() => setWelcomeTier("assisted")}
              className="text-left p-3 rounded border-2"
              style={{ borderColor: welcomeTier === "assisted" ? "#5B3FA0" : "#DDD6C4", background: welcomeTier === "assisted" ? "#F3EEFB" : "#fff" }}>
              <div className="text-sm font-medium" style={{ color: "#5B3FA0" }}>Assisté</div>
              <div className="text-xs mb-1" style={{ color: "#8A8370" }}>80 $/mois</div>
              <div className="text-xs" style={{ color: "#8A8370" }}>+ alertes, recommandations et corrections automatiques pour éviter les erreurs de saisie</div>
            </button>
          </div>
          <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
            Aucun frais pendant votre essai gratuit de 30 jours — le tarif choisi ne s'applique qu'à la réactivation, à la fin de l'essai.
          </p>
          <button onClick={submitWelcome} className="w-full py-2 rounded text-sm text-white" style={{ background: "#152238" }}>
            Commencer
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
                  <div className="text-xs mt-0.5" style={{ color: "#7A7460" }}>Rôle : {opt.role}</div>
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
          <button onClick={() => { clearMembershipCache(); supabase.auth.signOut(); }}
            className="text-xs underline" style={{ color: "#8A8370" }}>
            Se déconnecter
          </button>

          <div className="mt-5 pt-5" style={{ borderTop: "1px solid #EEE9DA" }}>
            <button onClick={payWithMonCash} disabled={monCashLoading}
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

  if (isPlatformAdmin && platformLanding) {
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
          <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "#C9A24B" }}>Compta+ — Compte administrateur</div>
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
            <button onClick={() => { setPlatformLanding(false); setActive("superadmin"); }}
              className="text-left rounded-lg p-5 flex items-center justify-between" style={{ background: "#EFE9DD" }}>
              <div>
                <div className="font-semibold" style={{ color: "#152238" }}>Plateforme — Super Admin</div>
                <div className="text-xs mt-0.5" style={{ color: "#7A7460" }}>Abonnements, revenus, historique global, rapports</div>
              </div>
              <span style={{ color: "#C9A24B" }}>→</span>
            </button>

            <button onClick={() => {
              // Rechargement volontaire plutôt qu'un simple changement d'onglet : sans
              // ça, le bloc Entreprise garderait le statut d'abonnement chargé au tout
              // premier accès de la session, même si Super Admin l'a changé entre-temps
              // (les deux vivent dans des états React totalement séparés qui ne se
              // resynchronisent jamais tout seuls).
              try { sessionStorage.setItem("compta_skip_landing", "1"); } catch (e) {}
              window.location.reload();
            }}
              className="text-left rounded-lg p-5 flex items-center justify-between" style={{ background: "#EFE9DD" }}>
              <div>
                <div className="font-semibold" style={{ color: "#152238" }}>Ouvrir mon entreprise{settings.companyName ? " — " + settings.companyName : ""}</div>
                <div className="text-xs mt-0.5" style={{ color: "#7A7460" }}>Comptabilité, ventes, stock — les 9 modules habituels</div>
              </div>
              <span style={{ color: "#C9A24B" }}>→</span>
            </button>

            {!showCreateCompanyForm ? (
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
            )}
          </div>

          <button onClick={() => { clearMembershipCache(); supabase.auth.signOut(); }}
            className="mt-6 text-xs underline block" style={{ color: "#8A97B5" }}>
            Se déconnecter
          </button>

          <div className="mt-4 pt-4 text-[11px]" style={{ borderTop: "1px solid rgba(239,233,221,0.15)", color: "#5C6B8C" }}>
            <div className="mb-1 tabular" style={{ color: "#8A97B5" }}>Version {APP_VERSION}</div>
            <div>Rôle : Administrateur de la plateforme</div>
            <div className="mt-1">
              <a href="cgu.html" target="_blank" rel="noopener" className="underline">Conditions d'utilisation</a>
              {" · "}
              <a href="confidentialite.html" target="_blank" rel="noopener" className="underline">Confidentialité</a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "linear-gradient(160deg, #F4FBE8 0%, #DFF0BE 55%, #C7E296 100%)", fontFamily: "'Source Sans Pro', 'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Spectral:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');
        .tabular { font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; }
        .display { font-family: 'Spectral', serif; }
        .print-only { display: none; }
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
          ⚠️ Certaines données n'ont pas pu être synchronisées avec le serveur (connexion interrompue ?). Ce que vous voyez à l'écran n'est peut-être pas encore sauvegardé — évitez de fermer ou recharger la page tant que ce message est affiché. Vérifiez votre connexion internet.
          <div className="text-xs opacity-90 mt-0.5">Concerné : {visibleSyncErrorCategories.join(", ")}</div>
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
        onTouchStart={active === "superadmin" ? undefined : (ev) => { swipeTouchRef.current = { x: ev.touches[0].clientX, y: ev.touches[0].clientY }; }}
        onTouchEnd={active === "superadmin" ? undefined : (ev) => {
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
      {active === "superadmin" ? (
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
      {mobileMenuOpen && active !== "superadmin" && (
        <div className="fixed inset-0 z-40 md:hidden no-print" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setMobileMenuOpen(false)} />
      )}

      {active !== "superadmin" && (
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
            Tableau de bord
          </button>
          )}
          <div className="mt-2 px-5 pt-3 pb-1 text-[10px] uppercase tracking-widest" style={{ color: "#5C6B8C" }}>
            Modules
          </div>
          {MODULES.filter((m) => !allowedModuleIds || allowedModuleIds.includes(m.id)).map((m) => {
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
                <span className="flex-1 text-left">{m.label}</span>
                {!m.ready && <Lock size={12} style={{ color: "#4A587A" }} />}
              </button>
            );
          })}
        </nav>
        <div className="px-5 py-4 text-[11px] border-t" style={{ borderColor: "#28395A", color: "#5C6B8C" }}>
          <div className="mb-1 tabular" style={{ color: "#3F4F73" }}>Version {APP_VERSION}</div>
          {planTier === "assisted" && (
            <div className="mb-1" style={{ color: "#8B6FD9" }}>
              ✓ Mode Assisté{isAssistedSupervisor ? " — Superviseur assisté" : ""}
            </div>
          )}
          {readOnly ? (
            <span style={{ color: "#D9A441" }}>Mode lecture seule — les modifications sont désactivées.</span>
          ) : (
            <>Rôle : {role}{role === "Vendeur" && currentStationForSidebar?.activeSellerName ? ` — ${currentStationForSidebar.activeSellerName}` : ""}</>
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
          {isPlatformAdmin && (
            <button onClick={async () => { const { data: { user } } = await supabase.auth.getUser(); if (user) forgetCompanyChoice(user.id); window.location.reload(); }}
              className="mt-1 underline block" style={{ color: "#8A97B5" }}>
              Changer d'entreprise
            </button>
          )}
          <div className="mt-1" style={{ color: "#8A97B5" }}>
            <a href="cgu.html" target="_blank" rel="noopener" className="underline">Conditions d'utilisation</a>
            {" · "}
            <a href="confidentialite.html" target="_blank" rel="noopener" className="underline">Confidentialité</a>
          </div>
          <button onClick={() => { clearMembershipCache(); supabase.auth.signOut(); }} className="mt-1 underline block" style={{ color: "#8A97B5" }}>
            Se déconnecter
          </button>
        </div>
      </aside>
      )}

      {showSecurityPanel && <SecurityPanel onClose={() => setShowSecurityPanel(false)} showToast={showToast} />}

      {/* Main */}
      <main className="flex-1 min-w-0">
        {isBlocked && active !== "superadmin" ? (
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
              <button onClick={payWithMonCash} disabled={monCashLoading}
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
          />
        )}
        <div style={readOnly ? { pointerEvents: "none", opacity: 0.6 } : undefined}>
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
            assets={assets}
            setAssets={setAssets}
            accruals={accruals}
            setAccruals={setAccruals}
            deferrals={deferrals}
            setDeferrals={setDeferrals}
            riskProvisions={riskProvisions}
            setRiskProvisions={setRiskProvisions}
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
        {active === "caisse" && (
          <CaisseBanqueModule
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
            stationId={stationId}
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
          />
        )}
        {active === "rapports" && (
          <RapportsModule
            accounts={accounts}
            balances={balances}
            invoices={invoices}
            purchases={purchases}
            entries={entries}
            settings={settings}
            showToast={showToast}
          />
        )}
        {active === "admin" && role === "Administrateur" && (
          <AdminModule
            settings={settings}
            setSettings={setSettings}
            users={users}
            setUsers={setUsers}
            currentUserEmail={currentUserEmail}
            companyId={companyPinCompanyId}
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
            showToast={showToast}
            logAudit={logAudit}
            planTier={planTier}
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
        {active !== "dashboard" && active !== "compta" && active !== "caisse" && active !== "vente" && active !== "achat" && active !== "stock" && active !== "crm" && active !== "rapports" && active !== "admin" && active !== "rh" && active !== "superadmin" && (
          <ComingSoon module={MODULES.find((m) => m.id === active)} />
        )}
        </div>
        {active === "superadmin" && isPlatformAdmin && (
          <SuperAdminModule showToast={showToast} />
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

function Card({ label, value, accent }) {
  return (
    <div className="rounded-lg p-5 bg-white min-w-0" style={{ border: "1px solid #E4DFD1" }}>
      <div className="text-xs uppercase tracking-widest break-words" style={{ color: "#8A8370" }}>{label}</div>
      <div className="tabular text-2xl mt-2 break-words" style={{ color: accent || "#152238" }}>{fmt(value)}</div>
    </div>
  );
}

function Dashboard({ kpis, chartData, growthData, latestGrowth, entriesCount, installPrompt, onInstallClick }) {
  const [showIosHelp, setShowIosHelp] = useState(false);
  const alreadyInstalled = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-8 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="display text-3xl" style={{ color: "#152238" }}>Centre de contrôle</div>
          <p className="text-sm mt-1" style={{ color: "#7A7460" }}>
            Vue d'ensemble consolidée — {entriesCount} écriture{entriesCount > 1 ? "s" : ""} enregistrée{entriesCount > 1 ? "s" : ""} dans le journal.
          </p>
        </div>

        {!alreadyInstalled && (
          <div className="relative shrink-0">
            {installPrompt ? (
              <button onClick={onInstallClick}
                className="flex items-center gap-2 px-4 py-2 rounded text-sm text-white"
                style={{ background: "#152238" }}>
                <Download size={15} /> Installer l'application
              </button>
            ) : (
              <button onClick={() => setShowIosHelp((v) => !v)}
                className="flex items-center gap-2 px-4 py-2 rounded text-sm"
                style={{ background: "#fff", border: "1px solid #DDD6C4", color: "#152238" }}>
                <Download size={15} /> Installer l'application
              </button>
            )}
            {showIosHelp && !installPrompt && (
              <div className="absolute right-0 mt-2 w-72 rounded-lg p-4 text-xs z-10 shadow-lg"
                style={{ background: "#fff", border: "1px solid #E4DFD1", color: "#5F5A4C" }}>
                <div className="font-medium mb-2" style={{ color: "#152238" }}>Comment installer :</div>
                <p className="mb-2"><b>Android (Chrome)</b> : menu ⋮ en haut à droite. Si deux options distinctes apparaissent, choisissez bien <b>« Installer l'application »</b> — pas « Ajouter à l'écran d'accueil », qui ne crée qu'un simple raccourci vers le site, pas une vraie application autonome. S'il n'y a qu'une seule option, elle convient.</p>
                <p className="mb-2"><b>iPhone/iPad (Safari)</b> : bouton Partager (carré avec flèche) → « Sur l'écran d'accueil ».</p>
                <p><b>Windows/Mac (Chrome ou Edge)</b> : icône d'installation dans la barre d'adresse, à droite de l'URL.</p>
                <button onClick={() => setShowIosHelp(false)} className="mt-3 underline" style={{ color: "#152238" }}>Fermer</button>
              </div>
            )}
          </div>
        )}
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 min-w-0">
        <Card label="Produits" value={kpis.produits} accent="#0F6B5C" />
        <Card label="Charges" value={kpis.charges} accent="#A6432F" />
        <Card label="Résultat" value={kpis.resultat} accent={kpis.resultat >= 0 ? "#0F6B5C" : "#A6432F"} />
        <Card label="Trésorerie (Banque + Caisse)" value={kpis.tresorerie} />
      </div>

      {latestGrowth && (
        <div className="bg-white rounded-lg p-4 mb-8" style={{ border: "1px solid #E4DFD1" }}>
          <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "#8A8370" }}>
            Croissance du chiffre d'affaires — {latestGrowth.mois}
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-semibold" style={{ color: latestGrowth.croissance >= 0 ? "#0F6B5C" : "#A6432F" }}>
              {latestGrowth.croissance >= 0 ? "+" : ""}{fmt(latestGrowth.croissance)}
            </span>
            {latestGrowth.pct !== null && (
              <span className="text-sm" style={{ color: latestGrowth.croissance >= 0 ? "#0F6B5C" : "#A6432F" }}>
                ({latestGrowth.croissance >= 0 ? "+" : ""}{latestGrowth.pct.toFixed(1)}%)
              </span>
            )}
            <span className="text-xs" style={{ color: "#A39C87" }}>vs mois précédent</span>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg p-6 mb-8" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-semibold mb-4" style={{ color: "#152238" }}>Produits vs Charges par mois</div>
        {chartData.length === 0 ? (
          <div className="text-sm py-16 text-center" style={{ color: "#A39C87" }}>
            Aucune écriture pour le moment. Ajoutez des écritures dans le module Comptabilité pour voir apparaître le graphique.
          </div>
        ) : (
          <SimpleGroupedBarChart
            data={chartData}
            xKey="mois"
            series={[
              { key: "produits", name: "Produits", color: "#0F6B5C" },
              { key: "charges", name: "Charges", color: "#A6432F" },
            ]}
          />
        )}
      </div>

      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-semibold mb-1" style={{ color: "#152238" }}>Croissance du chiffre d'affaires par mois</div>
        <p className="text-xs mb-4" style={{ color: "#A39C87" }}>Variation des Produits en montant, comparé au mois précédent.</p>
        {growthData.length === 0 ? (
          <div className="text-sm py-16 text-center" style={{ color: "#A39C87" }}>
            Au moins deux mois d'écritures sont nécessaires pour calculer une croissance.
          </div>
        ) : (
          <SimpleGrowthBarChart data={growthData} xKey="mois" valueKey="croissance" pctKey="pct" />
        )}
      </div>
    </div>
  );
}

// Registre des immobilisations — amortissement linéaire uniquement, dotations
// générées manuellement par l'utilisateur (bouton "Générer les dotations"), jamais
// automatiquement à l'insu de l'entreprise. Le calcul se base sur des mois entiers
// écoulés depuis la dernière dotation (ou l'acquisition si aucune n'a encore été
// posée), plafonné à ce qu'il reste à amortir — jamais au-delà de la valeur d'origine.
function ImmobilisationsPanel({ accounts, assets, setAssets, entries, setEntries, role, showToast, logAudit, planTier, recordPendingRecommendation, currentUserEmail }) {
  const canEdit = role !== "Vendeur";
  const [form, setForm] = useState({ name: "", categoryIdx: "0", acquisitionDate: todayStr(), originalValue: "", usefulLifeYears: "5", paymentMode: "caisse" });
  const [genDate, setGenDate] = useState(todayStr());
  const anomalyGate = useAssistedAnomalyGate();

  const addAsset = () => {
    const value = Number(form.originalValue);
    const years = Number(form.usefulLifeYears);
    if (!form.name.trim() || !(value > 0) || !(years > 0)) {
      showToast("Renseignez un nom, une valeur d'origine et une durée valides.");
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
      accumulatedDepreciation: 0, lastDepreciationDate: null, createdAt: new Date().toISOString(),
    }]);
    logAudit("Comptabilité", "Ajout immobilisation", `${form.name} : ${fmt(value)}`);
    showToast("Immobilisation enregistrée.");
    setForm({ name: "", categoryIdx: "0", acquisitionDate: todayStr(), originalValue: "", usefulLifeYears: "5", paymentMode: "caisse" });
    };
    if (planTier !== "assisted") { commit(); return; }
    const anomalies = [];
    if (years < 1 || years > 20) anomalies.push(`Durée d'amortissement inhabituelle pour « ${form.name} » : ${years} an(s) — vérifiez la saisie.`);
    const amountsInCategory = assets.filter((a) => a.categoryLabel === category.label).map((a) => a.originalValue);
    const amtAnomaly = detectAmountAnomaly(value, amountsInCategory, category.label);
    if (amtAnomaly) anomalies.push(amtAnomaly);
    const signature = `asset:${form.name}:${value}:${years}`;
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
      const monthlyRate = a.originalValue / (a.usefulLifeYears * 12);
      const since = a.lastDepreciationDate || a.acquisitionDate;
      const months = monthsBetween(since, genDate);
      if (months <= 0) return a;
      const dotation = Math.min(remaining, Math.round(monthlyRate * months * 100) / 100);
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
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-1.5 font-normal">Nom</th>
                <th className="py-1.5 font-normal">Catégorie</th>
                <th className="py-1.5 font-normal">Acquisition</th>
                <th className="py-1.5 font-normal text-right">Valeur d'origine</th>
                <th className="py-1.5 font-normal text-right">Cumul amorti</th>
                <th className="py-1.5 font-normal text-right">VNC</th>
                <th className="py-1.5 font-normal text-right">Mois à compter</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => {
                const remaining = a.originalValue - (a.accumulatedDepreciation || 0);
                const since = a.lastDepreciationDate || a.acquisitionDate;
                const monthsToCount = remaining > 0 ? monthsBetween(since, genDate) : 0;
                return (
                <tr key={a.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-1.5">{a.name}</td>
                  <td className="py-1.5">{a.categoryLabel}</td>
                  <td className="py-1.5 tabular">{a.acquisitionDate}</td>
                  <td className="py-1.5 tabular text-right">{fmt(a.originalValue)}</td>
                  <td className="py-1.5 tabular text-right">{fmt(a.accumulatedDepreciation || 0)}</td>
                  <td className="py-1.5 tabular text-right font-medium">{fmt(remaining)}</td>
                  <td className="py-1.5 tabular text-right" style={{ color: monthsToCount > 0 ? "#152238" : "#A39C87" }}>{monthsToCount}</td>
                </tr>
                );
              })}
            </tbody>
          </table></div>
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
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-1.5 font-normal">Libellé</th>
                <th className="py-1.5 font-normal">Type</th>
                <th className="py-1.5 font-normal text-right">Montant total</th>
                <th className="py-1.5 font-normal text-right">Déjà reclassé</th>
                <th className="py-1.5 font-normal text-right">Restant</th>
                <th className="py-1.5 font-normal text-right">Mois à compter</th>
              </tr>
            </thead>
            <tbody>
              {deferrals.map((d) => {
                const remaining = d.totalAmount - (d.amountRecognized || 0);
                const since = d.lastRecognitionDate || d.startDate;
                const monthsToCount = remaining > 0 ? monthsBetween(since, genDate) : 0;
                return (
                  <tr key={d.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                    <td className="py-1.5">{d.label}</td>
                    <td className="py-1.5">{d.type === "charge" ? "Charge" : "Produit"}</td>
                    <td className="py-1.5 tabular text-right">{fmt(d.totalAmount)}</td>
                    <td className="py-1.5 tabular text-right">{fmt(d.amountRecognized || 0)}</td>
                    <td className="py-1.5 tabular text-right font-medium">{fmt(remaining)}</td>
                    <td className="py-1.5 tabular text-right" style={{ color: monthsToCount > 0 ? "#152238" : "#A39C87" }}>{monthsToCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
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
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-1.5 font-normal">Libellé</th>
                <th className="py-1.5 font-normal">Date</th>
                <th className="py-1.5 font-normal text-right">Provision actuelle</th>
                <th className="py-1.5 font-normal text-right">Nouvelle estimation</th>
                <th className="py-1.5 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {active.map((p) => (
                <tr key={p.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-1.5">{p.label}</td>
                  <td className="py-1.5 tabular">{p.date}</td>
                  <td className="py-1.5 tabular text-right font-medium">{fmt(p.currentAmount)}</td>
                  <td className="py-1.5 text-right">
                    {canEdit ? (
                      <input type="number" min="0" placeholder={String(p.currentAmount)}
                        value={drafts[p.id] ?? ""} onChange={(e) => setDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        className="w-24 border rounded px-2 py-1 text-xs tabular text-right" style={{ borderColor: "#DDD6C4" }} />
                    ) : "—"}
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
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

function ComptaModule({ accounts, setAccounts, entries, setEntries, invoices, setInvoices, balances, settings, assets, setAssets, accruals, setAccruals, deferrals, setDeferrals, riskProvisions, setRiskProvisions, role, showToast, logAudit, verifyTransactionSaved, planTier, recordPendingRecommendation, currentUserEmail, pendingRecommendations, resolvePendingRecommendation }) {
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
  const invoicesWithoutEntry = invoices.filter((inv) => inv.status !== "annulée" && inv.status !== "don" && !saleEntriesByInvoice[inv.id]);
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

      <div className="flex gap-1 mb-6 overflow-x-auto">
        {[
          ["journal", "Journal des écritures"],
          ["plan", "Plan comptable"],
          ["associes", "Associés (capital)"],
          ["immobilisations", "Immobilisations"],
          ["regularisations", "Régularisations"],
          ["avances", "Charges/produits d'avance"],
          ["risques", "Provisions pour risques"],
        ].map(([id, label]) => (
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

      {tab === "journal" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
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
          <button onClick={addEntry} disabled={hasPendingCompta}
            className="flex items-center gap-2 px-4 py-2 rounded text-sm text-white mb-6"
            style={{ background: "#152238", opacity: hasPendingCompta ? 0.5 : 1 }}>
            <Plus size={14} /> Enregistrer l'écriture
          </button>

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

          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-2 font-normal">Code</th>
                <th className="py-2 font-normal">Intitulé</th>
                <th className="py-2 font-normal">Type</th>
                <th className="py-2 font-normal text-right">Solde</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.code} style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-2 tabular">{a.code}</td>
                  <td className="py-2">{a.name}</td>
                  <td className="py-2">{a.type}</td>
                  <td className="py-2 tabular text-right">{fmt(balances[a.code] || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
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
            <div className="overflow-x-auto border rounded" style={{ borderColor: "#EEE9DA" }}><table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                  <th className="py-2 px-2 font-normal">Compte</th>
                  <th className="py-2 font-normal">Associé</th>
                  <th className="py-2 font-normal text-right">Total apporté</th>
                </tr>
              </thead>
              <tbody>
                {associateAccounts.map((a) => (
                  <tr key={a.code} style={{ borderBottom: "1px solid #F3EFE3" }}>
                    <td className="py-2 px-2 tabular">{a.code}</td>
                    <td className="py-2">{a.name.replace(/^Capital — /, "")}</td>
                    <td className="py-2 tabular text-right font-medium">{fmt(a.solde)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="py-2 px-2" colSpan={2} style={{ color: "#8A8370" }}>Total capital</td>
                  <td className="py-2 tabular text-right font-medium" style={{ color: "#152238" }}>{fmt(associateAccounts.reduce((s, a) => s + a.solde, 0))}</td>
                </tr>
              </tbody>
            </table></div>
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
    </div>
  );
}

const COUNTERPART_TYPES = ["Actif", "Passif", "Capitaux propres", "Charge", "Produit"];

function CaisseBanqueModule({ accounts, entries, setEntries, balances, settings, role, showToast, logAudit, planTier, recordPendingRecommendation, currentUserEmail, pendingRecommendations, resolvePendingRecommendation }) {
  const lastSubmitRef = React.useRef(0); // anti double-clic/double-tap
  const anomalyGate = useAssistedAnomalyGate();
  const hasPendingCaisse = (pendingRecommendations || []).some((r) => r.module === "caisse");
  const [tab, setTab] = useState("caisse"); // "caisse" | "banque"
  const [expanded, setExpanded] = useState(null);
  const accountName = (code) => accounts.find((a) => a.code === code)?.name || code;
  const compteCode = tab === "caisse" ? "530" : "512";
  const counterparts = accounts.filter((a) => a.code !== compteCode);

  const [form, setForm] = useState({
    date: todayStr(),
    label: "",
    sens: "entree", // entree = encaissement, sortie = décaissement
    counterpart: counterparts[0]?.code,
    amount: "",
  });

  const ops = useMemo(
    () => entries.filter((e) => e.lines.some((l) => l.account === compteCode)),
    [entries, compteCode]
  );
  const [cbFrom, setCbFrom] = useState("");
  const [cbTo, setCbTo] = useState("");
  const [cbAccount, setCbAccount] = useState(""); // filtre par compte de contrepartie
  const [cbSens, setCbSens] = useState(""); // "" | "entree" | "sortie"
  const opsFiltered = ops.filter((e) => {
    if (cbFrom && e.date < cbFrom) return false;
    if (cbTo && e.date > cbTo) return false;
    const line = e.lines.find((l) => l.account === compteCode);
    const isEntree = line && line.debit > 0;
    if (cbSens === "entree" && !isEntree) return false;
    if (cbSens === "sortie" && isEntree) return false;
    if (cbAccount && !e.lines.some((l) => l.account === cbAccount)) return false;
    return true;
  });
  const opsFilteredTotal = opsFiltered.reduce((s, e) => {
    const line = e.lines.find((l) => l.account === compteCode);
    return s + (line ? (line.debit > 0 ? line.debit : line.credit) : 0);
  }, 0);

  const solde = balances[compteCode] || 0;

  const addOp = () => {
    if (Date.now() - lastSubmitRef.current < 800) return;
    lastSubmitRef.current = Date.now();
    if (hasPendingCaisse) {
      showToast("Traitez d'abord la recommandation en attente ci-dessus avant d'enregistrer une nouvelle opération.");
      return;
    }
    if (!form.label || !form.amount || Number(form.amount) <= 0) {
      showToast("Renseignez un libellé et un montant valide.");
      return;
    }
    if (isFutureDate(form.date)) {
      showToast("Impossible d'enregistrer une opération à une date future.");
      return;
    }
    if (isLocked(form.date, settings)) {
      showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Impossible d'enregistrer une opération à cette date.`);
      return;
    }
    const debit = form.sens === "entree" ? compteCode : form.counterpart;
    const credit = form.sens === "entree" ? form.counterpart : compteCode;
    const commitOp = () => {
      const entry = simpleEntry(form.date, form.label, debit, credit, Number(form.amount));
      entry.reconciled = false;
      setEntries((prev) => [...prev, entry]);
      logAudit("Caisse et banque", tab === "caisse" ? "Opération de caisse" : "Opération bancaire", `${form.label} — ${fmt(Number(form.amount))}`);
      setForm({ ...form, label: "", amount: "" });
      showToast(tab === "caisse" ? "Opération de caisse enregistrée." : "Opération bancaire enregistrée.");
    };
    if (planTier !== "assisted") { commitOp(); return; }
    const usageCounts = {};
    const amountsForCounterpart = [];
    for (const e of entries) {
      for (const l of e.lines) usageCounts[l.account] = (usageCounts[l.account] || 0) + 1;
      if (e.lines.some((l) => l.account === form.counterpart)) {
        amountsForCounterpart.push(e.lines.reduce((s, l) => s + l.debit + l.credit, 0) / 2);
      }
    }
    const anomalies = [];
    const corrections = [];
    const counterpartAcc = accounts.find((a) => a.code === form.counterpart);
    const rare = detectRareAccountAnomaly(form.counterpart, usageCounts, counterpartAcc?.name);
    if (rare) { anomalies.push(rare); corrections.push(`Si le compte de contrepartie ${counterpartAcc?.name || form.counterpart} est erroné : annulez cette opération (contrepassation) puis ressaisissez-la avec le bon compte.`); }
    const amt = detectAmountAnomaly(Number(form.amount), amountsForCounterpart, counterpartAcc?.name || form.counterpart);
    if (amt) { anomalies.push(amt); corrections.push("Si le montant est erroné : annulez cette opération (contrepassation) puis ressaisissez-la avec le montant correct."); }
    const dup = detectDuplicateAnomaly(
      { amount: Number(form.amount), date: form.date, label: form.label },
      ops.slice(-50).map((e) => ({ amount: e.lines.reduce((s, l) => s + l.debit, 0), date: e.date, label: e.label }))
    );
    if (dup) { anomalies.push(dup); corrections.push("Vérifiez les deux opérations : si l'une est bien un doublon, annulez-la par contrepassation."); }
    const signature = `cbop:${form.date}:${form.label}:${form.sens}:${form.counterpart}:${form.amount}`;
    anomalyGate(signature, [...new Set(anomalies)], commitOp, showToast, () => {
      recordPendingRecommendation?.({
        companyId: _membership?.companyId,
        module: "caisse",
        anomalyText: anomalies.join(" "),
        correctionText: [...new Set(corrections)].join(" "),
        entryRef: form.label,
        createdByEmail: currentUserEmail,
      });
    });
  };

  const toggleReconciled = (id) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, reconciled: !e.reconciled } : e)));
  };

  const cancelOp = (e) => {
    if (role !== "Administrateur") {
      showToast("Seul un administrateur peut annuler une opération validée.");
      return;
    }
    if (e.reversalOf) {
      showToast("Une écriture de contrepassation elle-même ne peut pas être annulée.");
      return;
    }
    if (e.cancelledBy) {
      showToast("Cette opération a déjà été contrepassée.");
      return;
    }
    if (isLocked(e.date, settings)) {
      showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Cette opération ne peut plus être annulée sans rouvrir la période.`);
      return;
    }
    if (!window.confirm("Annuler cette opération ? Une écriture de contrepassation sera ajoutée — l'opération d'origine reste visible pour la traçabilité.")) return;
    const reversalId = uid();
    const today = todayStr();
    setEntries((prev) => [
      ...prev.map((x) => (x.id === e.id ? { ...x, cancelledBy: reversalId } : x)),
      { id: reversalId, date: today, createdAt: new Date().toISOString(), label: `Contrepassation — ${e.label}`, reversalOf: e.id, lines: e.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })) },
    ]);
    showToast("Opération annulée par contrepassation.");
    logAudit("Caisse et banque", "Annulation opération (contrepassation)", e.label);
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module 2</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Caisse et banque</div>
        <p className="text-sm mt-1" style={{ color: "#7A7460" }}>
          Chaque opération saisie ici est automatiquement enregistrée dans le journal comptable (compte {compteCode}).
        </p>
      </header>

      <div className="flex gap-1 mb-6 overflow-x-auto">
        {[
          ["caisse", "Caisse (530)"],
          ["banque", "Banque (512)"],
        ].map(([id, label]) => (
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

      <div className="mb-6">
        <Card label={tab === "caisse" ? "Solde caisse" : "Solde banque"} value={solde} accent={solde >= 0 ? "#0F6B5C" : "#A6432F"} />
      </div>

      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5 items-end">
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Date</label>
            <input type="date" value={form.date} max={todayStr()} onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Sens</label>
            <select value={form.sens} onChange={(e) => setForm({ ...form, sens: e.target.value })}
              className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
              <option value="entree">Encaissement</option>
              <option value="sortie">Décaissement</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-xs" style={{ color: "#8A8370" }}>Libellé</label>
            <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Ex : Règlement client, achat fournitures..."
              className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Contrepartie</label>
            <select value={form.counterpart} onChange={(e) => setForm({ ...form, counterpart: e.target.value })}
              className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
              {counterparts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Montant</label>
            <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0"
              className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
          </div>
        </div>
        <PendingRecommendationsBanner recommendations={pendingRecommendations} module="caisse" onDismiss={resolvePendingRecommendation} />
        <AssistedPrincipleReminder planTier={planTier} text="Un encaissement augmente la caisse/banque (débit), un décaissement la diminue (crédit) — vérifiez que le sens choisi correspond bien à l'argent qui entre ou qui sort réellement." />
        <button onClick={addOp} disabled={hasPendingCaisse}
          className="flex items-center gap-2 px-4 py-2 rounded text-sm text-white mb-6"
          style={{ background: "#152238", opacity: hasPendingCaisse ? 0.5 : 1 }}>
          <Plus size={14} /> Enregistrer l'opération
        </button>

        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Du</label>
            <input type="date" value={cbFrom} onChange={(e) => setCbFrom(e.target.value)}
              className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
            <input type="date" value={cbTo} onChange={(e) => setCbTo(e.target.value)}
              className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Compte (contrepartie)</label>
            <select value={cbAccount} onChange={(e) => setCbAccount(e.target.value)}
              className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", width: "min(280px, 100%)", boxSizing: "border-box" }}>
              <option value="">Tous les comptes</option>
              {counterparts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Sens</label>
            <select value={cbSens} onChange={(e) => setCbSens(e.target.value)}
              className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }}>
              <option value="">Tous</option>
              <option value="entree">Encaissement</option>
              <option value="sortie">Décaissement</option>
            </select>
          </div>
          {(cbFrom || cbTo || cbAccount || cbSens) && (
            <button onClick={() => { setCbFrom(""); setCbTo(""); setCbAccount(""); setCbSens(""); }} className="text-xs underline mb-1.5" style={{ color: "#8A8370" }}>
              Réinitialiser
            </button>
          )}
          {(cbFrom || cbTo || cbAccount || cbSens) && (
            <div className="tabular text-xs mb-1.5 ml-auto" style={{ color: "#152238" }}>
              {opsFiltered.length} opération{opsFiltered.length > 1 ? "s" : ""} · Total {fmt(opsFilteredTotal)}
            </div>
          )}
        </div>

        <div className="overflow-x-auto overflow-y-auto max-h-[65vh] border rounded" style={{ borderColor: "#EEE9DA" }}><table className="w-full text-sm">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
              <th className="py-2 font-normal">Date</th>
              <th className="py-2 font-normal">Libellé</th>
              <th className="py-2 font-normal">Sens</th>
              <th className="py-2 font-normal text-right">Montant</th>
              {tab === "banque" && <th className="py-2 font-normal text-center">Pointé</th>}
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {opsFiltered.length === 0 && (
              <tr><td colSpan={tab === "banque" ? 6 : 5} className="py-8 text-center" style={{ color: "#A39C87" }}>
                {ops.length === 0 ? "Aucune opération. Enregistrez-en une ci-dessus." : "Aucune opération sur cette période."}
              </td></tr>
            )}
            {[...opsFiltered].reverse().map((e) => {
              const line = e.lines.find((l) => l.account === compteCode);
              const isEntree = line.debit > 0;
              const amount = line.debit > 0 ? line.debit : line.credit;
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
                  <td className="py-2">
                    <span className="flex items-center gap-1" style={{ color: isEntree ? "#0F6B5C" : "#A6432F" }}>
                      {isEntree ? <ArrowDownCircle size={14} /> : <ArrowUpCircle size={14} />}
                      {isEntree ? "Encaissement" : "Décaissement"}
                    </span>
                  </td>
                  <td className="py-2 tabular text-right">{fmt(amount)}</td>
                  {tab === "banque" && (
                    <td className="py-2 text-center">
                      <button onClick={(ev) => { ev.stopPropagation(); toggleReconciled(e.id); }}>
                        {e.reconciled
                          ? <CheckCircle2 size={16} style={{ color: "#0F6B5C" }} />
                          : <Circle size={16} style={{ color: "#C7C0AD" }} />}
                      </button>
                    </td>
                  )}
                  <td className="py-2 text-right">
                    {role === "Administrateur" && !e.cancelledBy && !e.reversalOf && (
                      <button onClick={(ev) => { ev.stopPropagation(); cancelOp(e); }} title="Annuler (contrepassation)" style={{ color: "#A6432F" }}>
                        <RotateCcw size={14} />
                      </button>
                    )}
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={tab === "banque" ? 6 : 5} className="py-3 px-3" style={{ background: "#FAF8F1" }}>
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
    </div>
  );
}

// Fenêtre de scan de code-barres/QR via la caméra du téléphone/ordinateur. Utilise la
// bibliothèque html5-qrcode chargée en CDN (window.Html5Qrcode). Appelle onScan(code) dès
// qu'un code est détecté, puis se ferme automatiquement.
function BarcodeScannerModal({ onScan, onClose }) {
  const [error, setError] = useState("");
  const scannerRef = React.useRef(null);
  const stoppedRef = React.useRef(false);

  useEffect(() => {
    if (typeof window.Html5Qrcode === "undefined") {
      setError("Le module de scan n'a pas pu se charger (vérifiez votre connexion internet), utilisez la saisie manuelle.");
      return;
    }
    const html5QrCode = new window.Html5Qrcode("barcode-scanner-view");
    scannerRef.current = html5QrCode;
    html5QrCode
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 150 } },
        (decodedText) => {
          if (stoppedRef.current) return;
          stoppedRef.current = true;
          html5QrCode.stop().then(() => html5QrCode.clear()).catch(() => {});
          onScan(decodedText);
        },
        () => {} // erreurs image par image (aucun code détecté) : ignorées, normal en continu
      )
      .catch(() => {
        setError("Impossible d'accéder à la caméra. Vérifiez que vous avez autorisé l'accès, ou utilisez la saisie manuelle.");
      });
    return () => {
      if (!stoppedRef.current) {
        stoppedRef.current = true;
        html5QrCode.stop().then(() => html5QrCode.clear()).catch(() => {});
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div className="bg-white rounded-lg p-5 w-full max-w-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium" style={{ color: "#152238" }}>Scanner un code</div>
          <button onClick={onClose} style={{ color: "#8A8370" }}><X size={18} /></button>
        </div>
        {error ? (
          <div className="text-xs py-6 text-center" style={{ color: "#A6432F" }}>{error}</div>
        ) : (
          <>
            <div id="barcode-scanner-view" className="rounded overflow-hidden" style={{ background: "#000" }} />
            <p className="text-xs mt-3 text-center" style={{ color: "#8A8370" }}>Visez le code-barres ou le QR code avec la caméra.</p>
          </>
        )}
        <button onClick={onClose} className="w-full mt-3 py-2 rounded text-sm" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>
          Annuler
        </button>
      </div>
    </div>
  );
}

function VenteModule({ accounts, entries, setEntries, products, setProducts, productImages, setProductImages, invoices, setInvoices, movements, setMovements, settings, setSettings, salesStations, stationId, setStationId, role, showToast, logAudit, verifyTransactionSaved, planTier, recordPendingRecommendation, currentUserEmail, pendingRecommendations, resolvePendingRecommendation }) {
  const anomalyGate = useAssistedAnomalyGate();
  const hasPendingVente = (pendingRecommendations || []).some((r) => r.module === "vente");
  const [tab, setTab] = useState("pos");
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
  useEffect(() => {
    if (lockedStation && stationId !== lockedStation.id) setStationId(lockedStation.id);
  }, [lockedStation?.id]);
  const [showScanner, setShowScanner] = useState(false);
  const [showPosScanner, setShowPosScanner] = useState(false);
  const [factFrom, setFactFrom] = useState("");
  const [factTo, setFactTo] = useState("");
  const [factNature, setFactNature] = useState(""); // "" | "payee" | "impayee"
  const [expandedInvoiceId, setExpandedInvoiceId] = useState(null);
  const factFiltered = invoices.filter((inv) =>
    (!factFrom || inv.date >= factFrom) &&
    (!factTo || inv.date <= factTo) &&
    (!factNature || (factNature === "payee" ? inv.status === "payée" : inv.status !== "payée" && inv.status !== "annulée" && inv.status !== "don"))
  );
  const factFilteredTotal = factFiltered.reduce((s, inv) => s + Number(inv.total || 0), 0);
  const factPayeeCount = invoices.filter((inv) => inv.status === "payée").length;
  const factImpayeeCount = invoices.filter((inv) => inv.status !== "payée" && inv.status !== "annulée" && inv.status !== "don").length;
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
      submittingSaleRef.current = false;
    }
  };

  const validateSaleCommit = async (invId, date) => {
    let invNumber;
    if (editingInvoiceId) {
      invNumber = invoices.find((i) => i.id === editingInvoiceId)?.number || ("F" + String(settings.nextInvoiceNumber || 1).padStart(4, "0"));
    } else {
      // Le numéro de facture est délivré par la base de données (compteur atomique
      // côté serveur), et non plus calculé localement : deux ventes validées au même
      // instant depuis deux appareils différents ne peuvent plus jamais recevoir le
      // même numéro, contrairement à l'ancien compteur en mémoire locale.
      try {
        const { companyId } = await resolveMembership();
        const { data: n, error } = await supabase.rpc("next_invoice_number", { target_company_id: companyId });
        if (error) throw error;
        invNumber = "F" + String(n).padStart(4, "0");
      } catch (e) {
        showToast("Impossible d'obtenir un numéro de facture (connexion instable). Réessayez.");
        return;
      }
    }

    // Pour une NOUVELLE vente (pas une modification), le stock ET le mouvement de
    // stock correspondant sont vérifiés, décrémentés et journalisés en UNE SEULE
    // opération indivisible en base : impossible que l'un réussisse sans l'autre,
    // même en cas de coupure de connexion en plein milieu.
    const stockLinesForGate = editingInvoiceId ? [] : cartLines.filter((l) => l.product.type === "marchandise");
    if (stockLinesForGate.length > 0) {
      try {
        const { companyId } = await resolveMembership();
        const { data: stockResult, error: stockErr } = await supabase.rpc("commit_sale_stock", {
          target_company_id: companyId,
          sale_lines: stockLinesForGate.map((l) => ({ productId: l.productId, qty: l.qty })),
          p_invoice_id: invId,
          p_invoice_number: invNumber,
          p_date: date,
        });
        if (stockErr) throw stockErr;
        if (!stockResult.ok) {
          const details = stockResult.insufficient.map((i) => `« ${i.name} » (${i.available} dispo, ${i.requested} demandé)`).join(", ");
          showToast(`Vente refusée — stock insuffisant : ${details}`);
          return;
        }
      } catch (e) {
        showToast("Impossible de vérifier le stock (connexion instable). Réessayez.");
        return;
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
          const [freshProducts, freshMovements] = await Promise.all([
            window.storage.get("compta-products"),
            window.storage.get("compta-movements"),
          ]);
          const extractData = (res) => {
            if (!res?.value) return null;
            const parsed = JSON.parse(res.value);
            return (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "data" in parsed) ? parsed.data : parsed;
          };
          const pData = extractData(freshProducts);
          const mData = extractData(freshMovements);
          if (Array.isArray(pData)) setProducts(pData);
          if (Array.isArray(mData)) setMovements(mData);
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
  const encaisserFacture = (inv, compte, montant) => {
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
      .filter((i) => i.id !== inv.id && normalizeClientName(i.client) === clientKey && i.status !== "payée" && i.status !== "don" && i.status !== "annulée")
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
      const newPayments = [...(target.payments || []), { id: uid(), date, createdAt: new Date().toISOString(), amount: amt, account: compte }];
      const newStatus = amt >= due ? "payée" : "partielle";
      updates.push({ id: target.id, updatedInvoice: { ...target, payments: newPayments, status: newStatus }, amt, number: target.number });
      newEntries.push(simpleEntry(date, `${amt < due ? "Encaissement partiel" : "Encaissement"} ${target.number} — ${target.client}`, compte, "411", amt));
    }
    setEntries((prev) => [...prev, ...newEntries]);
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
                    <select value={stationId} onChange={(e) => setStationId(e.target.value)} disabled={!!lockedStation}
                      className="border rounded px-2 py-1 text-xs" style={{ borderColor: "#DDD6C4", opacity: lockedStation ? 0.7 : 1 }}>
                      <option value="">Aucun</option>
                      {salesStations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
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
                      <span className="tabular text-xs w-4 text-center shrink-0">{l.qty}</span>
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
            <button onClick={validateSale} disabled={hasPendingVente} className="w-full py-2 rounded text-sm text-white" style={{ background: "#152238", opacity: hasPendingVente ? 0.5 : 1 }}>
              {editingInvoiceId ? "Enregistrer les modifications" : "Valider la vente"}
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
                      {inv.status !== "payée" && inv.status !== "annulée" && inv.status !== "don" && (
                        <>
                          <button onClick={() => encaisserFacture(inv, "530")} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Encaisser (caisse)</button>
                          <button onClick={() => encaisserFacture(inv, "512")} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Encaisser (banque)</button>
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
                            Paiements reçus : {inv.payments.map((p) => `${fmt(p.amount)} le ${p.date} (${p.account === "530" ? "caisse" : "banque"})`).join(", ")}
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
        const effectiveStationFilter = role === "Vendeur" ? stationId : stationFilter;
        // Comparaison par identifiant ET par nom : si un poste a été supprimé puis
        // recréé sous le même nom, son identifiant technique change mais le nom
        // affiché reste identique — sans ce repli sur le nom, les ventes passées
        // "disparaîtraient" du filtre alors qu'elles appartiennent bien à ce poste.
        const effectiveStationName = effectiveStationFilter ? (salesStations || []).find((s) => String(s.id) === String(effectiveStationFilter))?.name : null;
        const dayInvoices = effectiveStationFilter
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
                    </select>
                  )}
                </div>
              )}
            </div>

            {nbFiches === 0 ? (
              <div className="bg-white rounded-lg p-8 text-center text-sm" style={{ border: "1px solid #E4DFD1", color: "#A39C87" }}>
                Aucune vente enregistrée pour le {reportDate}{effectiveStationFilter ? ` sur le poste sélectionné` : ""}.
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

              {planTier === "assisted" && (salesStations || []).length > 0 && (
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

function AchatModule({ accounts, entries, setEntries, suppliers, setSuppliers, purchases, setPurchases, products, setProducts, movements, setMovements, settings, role, showToast, logAudit, verifyTransactionSaved, planTier, recordPendingRecommendation, currentUserEmail, pendingRecommendations, resolvePendingRecommendation }) {
  const anomalyGate = useAssistedAnomalyGate();
  const hasPendingAchat = (pendingRecommendations || []).some((r) => r.module === "achat");
  const lastSubmitRef = React.useRef(0); // anti double-clic/double-tap sur "Enregistrer l'achat"
  const [tab, setTab] = useState("achats");
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
  const [newSupplier, setNewSupplier] = useState({ name: "", contact: "" });
  // Fondation pour la future méthode de valorisation du stock (coût moyen pondéré) :
  // un achat de marchandise peut désormais détailler ligne par ligne quel produit,
  // en quelle quantité et à quel coût unitaire — au lieu d'un simple montant global.
  // Le comportement comptable actuel (débit du compte choisi) reste inchangé pour
  // l'instant ; seule l'information produit/quantité/coût est désormais capturée et
  // sert à recalculer le coût moyen pondéré de chaque produit reçu.
  const [purchaseKind, setPurchaseKind] = useState("simple"); // "simple" | "marchandise"
  const [purchaseLines, setPurchaseLines] = useState([]); // [{ productId, qty, unitCost }]
  const [purchaseProductPick, setPurchaseProductPick] = useState("");
  const merchandiseProducts = (products || []).filter((p) => p.type === "marchandise");
  const purchaseLinesTotal = purchaseLines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.unitCost || 0), 0);
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
      setForm((prev) => ({ ...prev, amount: purchaseLinesTotal > 0 ? String(purchaseLinesTotal) : "", account }));
    }
  }, [purchaseKind, purchaseLinesTotal, settings.stockValuationMethod]);
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
      const unitCost = Number(line.unitCost) || 0;
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
    const supplier = suppliers.find((s) => s.id === Number(form.supplierId));
    const payAccount = form.paymentMode === "caisse" ? "530" : form.paymentMode === "banque" ? "512" : "401";
    const label = `Achat — ${form.label} (${supplier?.name || "Fournisseur"})`;

    const commitPurchase = () => {
    if (editingPurchaseId) {
      const purchaseEntry = { ...simpleEntry(form.date, label, form.account, payAccount, Number(form.amount)), id: editingPurchaseId };
      const updatedPurchase = { supplier: supplier?.name || "Fournisseur", date: form.date, label: form.label, amount: Number(form.amount), paymentMode: form.paymentMode, status: form.paymentMode === "credit" ? "à payer" : "payé" };
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
      const purchaseEntry = { ...simpleEntry(form.date, label, form.account, payAccount, Number(form.amount)), id: purchaseId };
      const newPurchase = {
        id: purchaseId,
        date: form.date,
        createdAt: new Date().toISOString(),
        supplier: supplier?.name || "Fournisseur",
        label: form.label,
        amount: Number(form.amount),
        paymentMode: form.paymentMode,
        status: form.paymentMode === "credit" ? "à payer" : "payé",
        lines: purchaseKind === "marchandise" ? purchaseLines.map((l) => ({ productId: l.productId, qty: Number(l.qty), unitCost: Number(l.unitCost) })) : undefined,
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
    setPurchaseLines([]); setPurchaseKind("simple");
    };
    if (planTier !== "assisted" || editingPurchaseId) { commitPurchase(); return; }
    const usageCounts = {};
    const amountsForAccount = [];
    for (const e of entries) {
      for (const l of e.lines) usageCounts[l.account] = (usageCounts[l.account] || 0) + 1;
      if (e.lines.some((l) => l.account === form.account)) {
        amountsForAccount.push(e.lines.reduce((s, l) => s + l.debit + l.credit, 0) / 2);
      }
    }
    const anomalies = [];
    const corrections = [];
    const acc = accounts.find((a) => a.code === form.account);
    const rare = detectRareAccountAnomaly(form.account, usageCounts, acc?.name);
    if (rare) { anomalies.push(rare); corrections.push(`Si le compte ${acc?.name || form.account} est erroné : annulez cet achat (contrepassation) puis ressaisissez-le avec le bon compte.`); }
    const amt = detectAmountAnomaly(Number(form.amount), amountsForAccount, acc?.name || form.account);
    if (amt) { anomalies.push(amt); corrections.push("Si le montant est erroné : annulez cet achat (contrepassation) puis ressaisissez-le avec le montant correct."); }
    const dup = detectDuplicateAnomaly(
      { amount: Number(form.amount), date: form.date, label: form.label },
      purchases.slice(-50).map((p) => ({ amount: p.amount, date: p.date, label: p.label }))
    );
    if (dup) { anomalies.push(dup); corrections.push("Vérifiez les deux achats : si l'un est bien un doublon, annulez-le par contrepassation."); }
    const signature = `purchase:${form.date}:${form.label}:${form.account}:${form.amount}:${form.supplierId}`;
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
    if (isLocked(p.date, settings)) {
      showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Cet achat ne peut plus être modifié.`);
      return;
    }
    const supplier = suppliers.find((s) => s.name === p.supplier);
    setPurchaseKind("simple"); setPurchaseLines([]);
    setEditingPurchaseId(p.id);
    setForm({
      date: p.date,
      supplierId: supplier?.id ?? suppliers[0]?.id,
      label: p.label,
      account: entries.find((e) => e.id === p.id)?.lines?.find((l) => l.debit > 0)?.account || chargeAccounts[0]?.code,
      amount: p.amount,
      paymentMode: p.paymentMode,
    });
  };

  const cancelEditPurchase = () => {
    setEditingPurchaseId(null);
    setForm({ ...form, label: "", amount: "" });
  };

  const cancelPurchase = (p) => {
    if (role !== "Administrateur") {
      showToast("Seul un administrateur peut annuler un achat validé.");
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
    setNewSupplier({ name: "", contact: "" });
  };

  const startEditSupplier = (s) => {
    setEditingSupplierId(s.id);
    setNewSupplier({ name: s.name, contact: s.contact || "" });
  };

  const cancelEditSupplier = () => {
    setEditingSupplierId(null);
    setNewSupplier({ name: "", contact: "" });
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

  const payerAchat = (p, compte) => {
    if (Date.now() - lastSubmitRef.current < 800) return; // double-clic/double-tap ignoré
    lastSubmitRef.current = Date.now();
    const today = todayStr();
    if (isLocked(today, settings)) {
      showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Impossible d'enregistrer un paiement aujourd'hui.`);
      return;
    }
    setEntries((prev) => [
      ...prev,
      simpleEntry(today, `Paiement — ${p.label} (${p.supplier})`, "401", compte, p.amount),
    ]);
    setPurchases((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: "payé" } : x)));
    showToast("Achat payé.");
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
        {[["achats", "Achats"], ["fournisseurs", "Fournisseurs"]].map(([id, label]) => (
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
              <select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
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
                  <select value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })}
                    className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                    {chargeAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs" style={{ color: "#8A8370" }}>Montant</label>
                  <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder="0" className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
                </div>
              </>
            ) : (
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Montant total (calculé)</label>
                <div className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4", background: "#FAF8F1", color: "#7A7460" }}>{fmt(purchaseLinesTotal)}</div>
              </div>
            )}
          </div>

          {purchaseKind === "marchandise" && !editingPurchaseId && (
            <div className="mb-5 p-4 rounded" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }}>
              <div className="text-xs font-medium mb-2" style={{ color: "#152238" }}>Produits reçus</div>
              <div className="flex gap-2 mb-3">
                <select value={purchaseProductPick} onChange={(e) => setPurchaseProductPick(e.target.value)}
                  className="flex-1 border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }}>
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

      {historyProductId && (
        <ProductHistoryModal productId={historyProductId} products={products} movements={movements} onClose={() => setHistoryProductId(null)} />
      )}
    </div>
  );
}

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
  const stockProducts = products.filter((p) => p.type === "marchandise");
  const [form, setForm] = useState({
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
    if (role === "Vendeur") { showToast("Seul un administrateur ou éditeur peut supprimer un mouvement de stock."); return; }
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
    const existing = clients.find((c) => c.name === row.name);
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
      if (existing) return prev.map((c) => (c.name === row.name ? { ...c, doubtfulEstimate: recoverable, doubtfulProvision: newProvision } : c));
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
    const existing = clients.find((c) => c.name === row.name);
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
    setClients((prev) => prev.map((c) => (c.name === row.name ? { ...c, doubtfulEstimate: null, doubtfulProvision: 0 } : c)));
    logAudit("CRM", "Reprise provision créance", `${row.name} : ${fmt(-delta)}`);
    showToast(`Provision annulée, reprise de ${fmt(-delta)} enregistrée.`);
  };

  return (
    <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
      <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Créances douteuses</div>
      <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
        Pour un client dont la dette totale ou partielle semble compromise (retard important, difficultés connues). Indiquez le montant que vous estimez réellement récupérable — la provision se recalcule automatiquement. Ceci ne solde ni n'annule la créance : elle reste due tant qu'un encaissement réel n'est pas enregistré.
      </p>
      {rows.length === 0 ? (
        <div className="text-xs py-4 text-center" style={{ color: "#A39C87" }}>Aucun client avec une créance en cours.</div>
      ) : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead>
            <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
              <th className="py-1.5 font-normal">Client</th>
              <th className="py-1.5 font-normal text-right">Total dû</th>
              <th className="py-1.5 font-normal text-right">Provision actuelle</th>
              <th className="py-1.5 font-normal text-right">Montant estimé récupérable</th>
              <th className="py-1.5 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const existing = clients.find((c) => c.name === row.name);
              const provision = Number(existing?.doubtfulProvision) || 0;
              return (
                <tr key={row.name} style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-1.5">{row.name}</td>
                  <td className="py-1.5 tabular text-right">{fmt(row.due)}</td>
                  <td className="py-1.5 tabular text-right">{provision > 0 ? fmt(provision) : "—"}</td>
                  <td className="py-1.5 text-right">
                    {canEdit ? (
                      <input type="number" min="0" placeholder={String(existing?.doubtfulEstimate ?? row.due)}
                        value={drafts[row.name] ?? ""} onChange={(e) => setDrafts((prev) => ({ ...prev, [row.name]: e.target.value }))}
                        className="w-24 border rounded px-2 py-1 text-xs tabular text-right" style={{ borderColor: "#DDD6C4" }} />
                    ) : (fmt(existing?.doubtfulEstimate ?? row.due))}
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
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
      )}
    </div>
  );
}

function CRMModule({ clients, setClients, invoices, setInvoices, entries, setEntries, accounts, setAccounts, planTier, recordPendingRecommendation, currentUserEmail, role, showToast, logAudit, verifyTransactionSaved }) {
  useEffect(() => {
    const missing = [
      { code: "491", name: "Provisions pour créances douteuses", type: "Actif" },
      { code: "6816", name: "Dotations aux provisions pour créances douteuses", type: "Charge" },
      { code: "7816", name: "Reprises sur provisions pour créances douteuses", type: "Produit" },
    ].filter((a) => !accounts.some((existing) => existing.code === a.code));
    if (missing.length > 0) setAccounts((prev) => [...prev, ...missing]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Le Vendeur peut consulter les clients/factures et encaisser des paiements, mais
  // ne peut ni créer/modifier une fiche client, ni annuler une facture ou un
  // encaissement déjà enregistré — ces actions restent réservées à
  // Administrateur/Éditeur, conformément à la demande explicite de l'utilisateur.
  const canManageClients = role !== "Vendeur";
  const [newClient, setNewClient] = useState({ name: "", email: "", phone: "" });
  const [selected, setSelected] = useState(null);
  const [historyClientName, setHistoryClientName] = useState(null);
  const [expandedDueClients, setExpandedDueClients] = useState({}); // { [nomNormalisé]: true } — replié par défaut
  const [tab, setTab] = useState("clients");
  const [payAmounts, setPayAmounts] = useState({});

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
    const due = clientInvoices.filter((i) => i.status !== "payée" && i.status !== "don" && i.status !== "annulée").reduce((s, i) => s + balanceDue(i), 0);
    const lastDate = clientInvoices.reduce((max, i) => (i.date > max ? i.date : max), "");
    return { name, email: known?.email || "", phone: known?.phone || "", nb: clientInvoices.length, total, due, lastDate, invoices: clientInvoices };
  });

  const dueInvoicesAll = invoices.filter((i) => i.status !== "payée" && i.status !== "annulée" && i.status !== "don");
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
    if (clients.some((c) => c.name === newClient.name)) {
      showToast("Ce client existe déjà.");
      return;
    }
    setClients((prev) => [...prev, { ...newClient, id: uid(), createdAt: new Date().toISOString() }]);
    setNewClient({ name: "", email: "", phone: "" });
    showToast("Client ajouté.");
    logAudit("CRM", "Ajout client", newClient.name);
  };

  const lastEncaissementRef = React.useRef(0);
  const encaisserFacture = (inv, compte, montant) => {
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
      .filter((i) => i.id !== inv.id && normalizeClientName(i.client) === clientKey && i.status !== "payée" && i.status !== "don" && i.status !== "annulée")
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
      const newPayments = [...(target.payments || []), { id: uid(), date, createdAt: new Date().toISOString(), amount: amt, account: compte }];
      const newStatus = amt >= due ? "payée" : "partielle";
      updates.push({ id: target.id, updatedInvoice: { ...target, payments: newPayments, status: newStatus }, amt, number: target.number });
      newEntries.push(simpleEntry(date, `${amt < due ? "Recouvrement partiel" : "Encaissement"} ${target.number} — ${target.client}`, compte, "411", amt));
    }
    setEntries((prev) => [...prev, ...newEntries]);
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

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module 6</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Comptes clients (CRM)</div>
        <p className="text-sm mt-1" style={{ color: "#7A7460" }}>
          Fiches alimentées automatiquement par les factures du Module 3 — un client apparaît dès sa première vente.
        </p>
      </header>

      <div className="flex gap-1 mb-6 overflow-x-auto">
        {[["clients", "Clients"], ["dus", `Clients dûs${dueClientCount ? ` (${dueClientCount})` : ""}`], ["payes", "Clients payés"], ["douteuses", "Créances douteuses"]].map(([id, label]) => (
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
          <button onClick={addClient} className="flex items-center justify-center gap-2 px-4 py-2 rounded text-sm text-white h-[38px]" style={{ background: "#152238" }}>
            <Plus size={14} /> Enregistrer
          </button>
        </div>
      </div>
      )}

      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        {rows.length === 0 ? (
          <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>
            Aucun client pour le moment. Les clients apparaissent ici dès qu'une vente leur est associée dans le Module 3.
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
              {rows.map((r) => (
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
            <div className="overflow-x-auto overflow-y-auto max-h-[65vh] border rounded" style={{ borderColor: "#EEE9DA" }}><table className="w-full text-sm">
              <thead className="sticky top-0 bg-white z-10">
                <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                  <th className="py-2 font-normal">N°</th>
                  <th className="py-2 font-normal">Date</th>
                  <th className="py-2 font-normal">Client</th>
                  <th className="py-2 font-normal text-right">Total</th>
                  <th className="py-2 font-normal text-right">Déjà versé</th>
                  <th className="py-2 font-normal text-right">Reste dû</th>
                  <th className="py-2 font-normal">Statut</th>
                  <th className="py-2 font-normal">Recouvrement</th>
                  <th className="py-2 font-normal"></th>
                </tr>
              </thead>
              <tbody>
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
                    return (
                      <React.Fragment key={key}>
                        <tr onClick={() => setExpandedDueClients((prev) => ({ ...prev, [key]: !prev[key] }))}
                          className="cursor-pointer" style={{ background: "#FAF8F1", borderBottom: "1px solid #EEE9DA" }}>
                          <td colSpan={5} className="py-1.5 px-2 font-medium" style={{ color: "#152238" }}>
                            <span className="inline-block mr-1" style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>›</span>
                            {g.name} — {g.invoices.length} facture{g.invoices.length > 1 ? "s" : ""}
                          </td>
                          <td className="py-1.5 px-2 text-right font-medium tabular" style={{ color: "#A6432F" }}>{fmt(groupDue)}</td>
                          <td colSpan={2}></td>
                          <td className="py-1.5 px-2 text-right">
                            <button onClick={(e) => { e.stopPropagation(); setHistoryClientName(g.name); }} title="Historique" style={{ color: "#152238" }}><History size={14} /></button>
                          </td>
                        </tr>
                        {isExpanded && g.invoices.map((inv) => {
                          const paid = (inv.payments || []).reduce((s, p) => s + p.amount, 0);
                          const restant = balanceDue(inv);
                          return (
                          <tr key={inv.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                            <td className="py-2 pl-4 tabular">{inv.number}</td>
                            <td className="py-2 tabular">{inv.date}<RecordedStamp createdAt={inv.createdAt} /></td>
                            <td className="py-2" style={{ color: "#A39C87" }}>{inv.client}</td>
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
                                <input type="number" min="0" placeholder={`≤ ${fmt(restant)} ou plus (réparti automatiquement)`}
                                  value={payAmounts[inv.id] || ""}
                                  onChange={(e) => setPayAmounts((p) => ({ ...p, [inv.id]: e.target.value }))}
                                  className="w-24 border rounded px-1.5 py-1 text-xs tabular" style={{ borderColor: "#DDD6C4" }} />
                                <button onClick={() => encaisserFacture(inv, "530", payAmounts[inv.id] || null)} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Caisse</button>
                                <button onClick={() => encaisserFacture(inv, "512", payAmounts[inv.id] || null)} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Banque</button>
                              </div>
                            </td>
                            <td className="py-2"></td>
                          </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  });
                })()}
              </tbody>
            </table></div>
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
            <div className="overflow-x-auto overflow-y-auto max-h-[65vh] border rounded" style={{ borderColor: "#EEE9DA" }}><table className="w-full text-sm">
              <thead className="sticky top-0 bg-white z-10">
                <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                  <th className="py-2 font-normal">N°</th>
                  <th className="py-2 font-normal">Date</th>
                  <th className="py-2 font-normal">Client</th>
                  <th className="py-2 font-normal text-right">Montant</th>
                  <th className="py-2 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {[...paidInvoicesFiltered].reverse().map((inv) => (
                  <tr key={inv.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                    <td className="py-2 tabular">{inv.number}</td>
                    <td className="py-2 tabular">{inv.date}<RecordedStamp createdAt={inv.createdAt} /></td>
                    <td className="py-2">{inv.client}</td>
                    <td className="py-2 tabular text-right" style={{ color: "#0F6B5C" }}>{fmt(inv.total)}</td>
                    <td className="py-2 text-right">
                      <button onClick={() => setHistoryClientName(inv.client)} title="Historique" style={{ color: "#152238" }}><History size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {tab === "douteuses" && (
        <ProvisionsCreancesPanel rows={rows.filter((r) => r.due > 0)} clients={clients} setClients={setClients} entries={entries} setEntries={setEntries} role={role} showToast={showToast} logAudit={logAudit} planTier={planTier} recordPendingRecommendation={recordPendingRecommendation} currentUserEmail={currentUserEmail} />
      )}

      {historyClientName && (
        <ClientHistoryModal clientName={historyClientName} invoices={invoices.filter((i) => normalizeClientName(i.client) === normalizeClientName(historyClientName))} onClose={() => setHistoryClientName(null)} />
      )}
    </div>
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

// --- Module 9 : Salaires (RH) ---
function PayrollModule({ accounts, setAccounts, entries, setEntries, employees, setEmployees, payslips, setPayslips, salaryAdvances, setSalaryAdvances, settings, role, showToast, logAudit, verifyTransactionSaved, planTier, recordPendingRecommendation, currentUserEmail, pendingRecommendations, resolvePendingRecommendation }) {
  const anomalyGate = useAssistedAnomalyGate();
  const hasPendingRH = (pendingRecommendations || []).some((r) => r.module === "salaires");
  const today = todayStr();
  const lastAdvanceSubmitRef = React.useRef(0);
  const lastPayslipSubmitRef = React.useRef(0);
  const [tab, setTab] = useState("employes");

  // S'assure que les comptes nécessaires au module (avances au personnel, charges
  // sociales à payer) existent dans le plan comptable de l'entreprise, sans jamais
  // toucher aux comptes déjà là — ajout silencieux et sans risque au premier accès
  // au module, y compris pour une entreprise créée avant son existence.
  useEffect(() => {
    const missing = [];
    if (!accounts.some((a) => a.code === "425")) missing.push({ code: "425", name: "Avances et acomptes au personnel", type: "Actif" });
    if (!accounts.some((a) => a.code === "431")) missing.push({ code: "431", name: "Charges sociales et fiscales à payer", type: "Passif" });
    if (missing.length) setAccounts((prev) => [...prev, ...missing]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accountName = (code) => accounts.find((a) => a.code === code)?.name || code;
  const activeEmployees = employees.filter((e) => e.active);

  // --- Employés ---
  const emptyEmpForm = { name: "", position: "", baseSalary: "", payFrequency: "mensuelle", overtimeRate: "" };
  const [empForm, setEmpForm] = useState(emptyEmpForm);
  const [editingEmployeeId, setEditingEmployeeId] = useState(null);

  const saveEmployee = () => {
    if (!empForm.name.trim() || !empForm.baseSalary || Number(empForm.baseSalary) <= 0) {
      showToast("Nom et salaire de base (positif) requis.");
      return;
    }
    if (editingEmployeeId) {
      setEmployees((prev) => prev.map((e) =>
        e.id === editingEmployeeId
          ? { ...e, name: empForm.name.trim(), position: empForm.position, baseSalary: Number(empForm.baseSalary), payFrequency: empForm.payFrequency, overtimeRate: Number(empForm.overtimeRate) || 0 }
          : e
      ));
      showToast("Employé modifié.");
      logAudit("Salaires (RH)", "Modification employé", empForm.name);
    } else {
      setEmployees((prev) => [...prev, {
        id: uid(), createdAt: new Date().toISOString(), name: empForm.name.trim(), position: empForm.position, baseSalary: Number(empForm.baseSalary),
        payFrequency: empForm.payFrequency, overtimeRate: Number(empForm.overtimeRate) || 0, active: true, hireDate: today,
      }]);
      showToast("Employé ajouté.");
      logAudit("Salaires (RH)", "Ajout employé", empForm.name);
    }
    setEditingEmployeeId(null);
    setEmpForm(emptyEmpForm);
  };

  const startEditEmployee = (emp) => {
    setEditingEmployeeId(emp.id);
    setEmpForm({ name: emp.name, position: emp.position || "", baseSalary: emp.baseSalary, payFrequency: emp.payFrequency, overtimeRate: emp.overtimeRate || "" });
  };

  const cancelEditEmployee = () => { setEditingEmployeeId(null); setEmpForm(emptyEmpForm); };

  // Pas de suppression réelle d'un employé (il peut être lié à des bulletins de paie
  // passés) : seulement une désactivation, qui le retire des listes de sélection pour
  // les nouvelles avances/bulletins sans jamais toucher à son historique.
  const toggleEmployeeActive = (emp) => {
    setEmployees((prev) => prev.map((e) => (e.id === emp.id ? { ...e, active: !e.active } : e)));
    logAudit("Salaires (RH)", emp.active ? "Désactivation employé" : "Réactivation employé", emp.name);
  };

  // --- Avances sur salaire ---
  const emptyAdvForm = { employeeId: "", date: today, amount: "", reason: "", paymentMode: "caisse" };
  const [advForm, setAdvForm] = useState(emptyAdvForm);
  const [advFrom, setAdvFrom] = useState("");
  const [advTo, setAdvTo] = useState("");
  const [advEmployee, setAdvEmployee] = useState("");
  const [advStatus, setAdvStatus] = useState("");
  const advancesFiltered = salaryAdvances.filter((a) =>
    (!advFrom || a.date >= advFrom) &&
    (!advTo || a.date <= advTo) &&
    (!advEmployee || String(a.employeeId) === advEmployee) &&
    (!advStatus || a.status === advStatus)
  );

  const giveAdvance = () => {
    if (Date.now() - lastAdvanceSubmitRef.current < 800) return;
    lastAdvanceSubmitRef.current = Date.now();
    if (hasPendingRH) { showToast("Traitez d'abord la recommandation en attente ci-dessus avant d'enregistrer une nouvelle avance."); return; }
    if (!advForm.employeeId) { showToast("Sélectionnez un employé."); return; }
    if (!advForm.amount || Number(advForm.amount) <= 0) { showToast("Montant invalide."); return; }
    if (isFutureDate(advForm.date)) { showToast("Impossible d'enregistrer une avance à une date future."); return; }
    if (isLocked(advForm.date, settings)) { showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus.`); return; }
    const emp = employees.find((e) => String(e.id) === String(advForm.employeeId));
    if (!emp) { showToast("Employé introuvable."); return; }
    // Règle stricte, non contournable (comme montant zéro/date future) : le
    // cumul des avances en cours ne doit jamais dépasser 60% du salaire de base
    // de l'employé — une avance n'a pas vocation à représenter l'essentiel d'un
    // salaire, quel que soit le forfait de l'entreprise.
    const openAdvancesTotal = salaryAdvances
      .filter((a) => a.employeeId === emp.id && a.status === "en cours")
      .reduce((s, a) => s + (Number(a.amount) - Number(a.repaidAmount || 0)), 0);
    const advanceCap = Number(emp.baseSalary) * 0.6;
    if (openAdvancesTotal + Number(advForm.amount) > advanceCap + 0.01) {
      showToast(`Le cumul des avances en cours pour ${emp.name} ne peut pas dépasser 60% de son salaire de base (plafond : ${fmt(advanceCap)}). Cumul actuel : ${fmt(openAdvancesTotal)}.`);
      return;
    }
    const commitAdvance = () => {
    const payAccount = advForm.paymentMode === "banque" ? "512" : "530";
    const advanceId = uid();
    const advanceEntry = {
      id: advanceId, date: advForm.date, createdAt: new Date().toISOString(), label: `Avance sur salaire — ${emp.name}`,
      lines: [{ account: "425", debit: Number(advForm.amount), credit: 0 }, { account: payAccount, debit: 0, credit: Number(advForm.amount) }],
    };
    const newAdvance = {
      id: advanceId, employeeId: emp.id, employeeName: emp.name, date: advForm.date, createdAt: new Date().toISOString(),
      amount: Number(advForm.amount), reason: advForm.reason, paymentMode: advForm.paymentMode,
      repaidAmount: 0, status: "en cours",
    };
    setEntries((prev) => [...prev, advanceEntry]);
    setSalaryAdvances((prev) => [...prev, newAdvance]);
    showToast("Avance enregistrée.");
    logAudit("Salaires (RH)", "Avance sur salaire", `${emp.name} — ${fmt(Number(advForm.amount))}`);
    setAdvForm(emptyAdvForm);
    verifyTransactionSaved(`Avance ${emp.name}`, [
      { category: "entries", label: "écriture d'avance", isPresent: (arr) => arr.some((e) => e.id === advanceId), buildNext: () => [...entries, advanceEntry] },
      { category: "salaryAdvances", label: "fiche d'avance", isPresent: (arr) => arr.some((a) => a.id === advanceId), buildNext: () => [...salaryAdvances, newAdvance] },
    ], { showToast, logAudit });
    };
    if (planTier !== "assisted") { commitAdvance(); return; }
    const anomalies = [];
    const corrections = [];
    const historyForEmployee = salaryAdvances.filter((a) => a.employeeId === emp.id).map((a) => Number(a.amount));
    const amt = detectAmountAnomaly(Number(advForm.amount), historyForEmployee, emp.name);
    if (amt) { anomalies.push(amt); corrections.push("Si le montant est erroné : annulez cette avance puis ressaisissez-la avec le montant correct."); }
    const isDup = salaryAdvances.slice(-30).some((a) => a.employeeId === emp.id && Number(a.amount) === Number(advForm.amount) && a.status !== "annulée");
    if (isDup) { anomalies.push(`Une avance identique existe déjà récemment pour ${emp.name} — vérifiez qu'il ne s'agit pas d'un doublon.`); corrections.push("Vérifiez les avances déjà enregistrées : si celle-ci est bien un doublon, annulez-la."); }
    const signature = `advance:${advForm.employeeId}:${advForm.amount}:${advForm.date}`;
    anomalyGate(signature, [...new Set(anomalies)], commitAdvance, showToast, () => {
      recordPendingRecommendation?.({
        companyId: _membership?.companyId,
        module: "salaires",
        anomalyText: anomalies.join(" "),
        correctionText: [...new Set(corrections)].join(" "),
        entryRef: emp.name,
        createdByEmail: currentUserEmail,
      });
    });
  };

  const cancelAdvance = (adv) => {
    if (role !== "Administrateur") { showToast("Seul un administrateur peut annuler une avance."); return; }
    if (adv.status === "annulée") { showToast("Cette avance est déjà annulée."); return; }
    if (adv.repaidAmount > 0) { showToast("Cette avance a déjà été partiellement remboursée sur un bulletin — annulez d'abord ce bulletin."); return; }
    if (isLocked(adv.date, settings)) { showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus.`); return; }
    if (!window.confirm(`Annuler l'avance de ${fmt(adv.amount)} pour ${adv.employeeName} ? Une écriture de contrepassation sera générée.`)) return;
    const original = entries.find((e) => e.id === adv.id);
    let reversal = null;
    if (original) {
      reversal = {
        id: uid(), date: today, createdAt: new Date().toISOString(), label: `Annulation avance — ${adv.employeeName}`,
        lines: original.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })),
      };
      setEntries((prev) => [...prev, reversal]);
    }
    setSalaryAdvances((prev) => prev.map((x) => (x.id === adv.id ? { ...x, status: "annulée" } : x)));
    showToast("Avance annulée par contrepassation.");
    logAudit("Salaires (RH)", "Annulation avance (contrepassation)", `${adv.employeeName} — ${fmt(adv.amount)}`);
    verifyTransactionSaved(`Annulation avance ${adv.employeeName}`, [
      { category: "salaryAdvances", label: "statut annulé", isPresent: (arr) => { const x = arr.find((y) => y.id === adv.id); return x && x.status === "annulée"; }, buildNext: () => salaryAdvances.map((x) => (x.id === adv.id ? { ...x, status: "annulée" } : x)) },
      ...(reversal ? [{ category: "entries", label: "écriture de contrepassation", isPresent: (arr) => arr.some((e) => e.id === reversal.id), buildNext: () => [...entries, reversal] }] : []),
    ], { showToast, logAudit });
  };

  // --- Bulletins de paie ---
  const emptyPayForm = {
    employeeId: "", periodStart: "", periodEnd: "", date: today,
    overtimeHours: "", bonusAmount: "", bonusNote: "",
    deductionCSSONA: "", advanceId: "", advanceRepayment: "", paymentMode: "caisse",
  };
  const [payForm, setPayForm] = useState(emptyPayForm);
  const selectedEmployee = employees.find((e) => String(e.id) === String(payForm.employeeId));
  const overtimeAmount = (Number(payForm.overtimeHours) || 0) * (selectedEmployee?.overtimeRate || 0);
  const baseSalaryAmount = selectedEmployee?.baseSalary || 0;
  const grossTotal = baseSalaryAmount + overtimeAmount + (Number(payForm.bonusAmount) || 0);
  const netTotal = grossTotal - (Number(payForm.deductionCSSONA) || 0) - (Number(payForm.advanceRepayment) || 0);
  const employeeOpenAdvances = salaryAdvances.filter((a) => String(a.employeeId) === String(payForm.employeeId) && a.status === "en cours" && a.repaidAmount < a.amount - 0.001);
  const selectedAdvance = employeeOpenAdvances.find((a) => a.id === payForm.advanceId);
  const selectedAdvanceRemaining = selectedAdvance ? selectedAdvance.amount - selectedAdvance.repaidAmount : 0;

  const processPayslip = () => {
    if (Date.now() - lastPayslipSubmitRef.current < 800) return;
    lastPayslipSubmitRef.current = Date.now();
    if (hasPendingRH) { showToast("Traitez d'abord la recommandation en attente ci-dessus avant d'enregistrer un nouveau bulletin."); return; }
    if (!selectedEmployee) { showToast("Sélectionnez un employé."); return; }
    if (!payForm.periodStart || !payForm.periodEnd) { showToast("La période (du / au) est requise."); return; }
    if (isFutureDate(payForm.periodStart) || isFutureDate(payForm.periodEnd) || isFutureDate(payForm.date)) {
      showToast("Impossible d'enregistrer un bulletin de paie à une date future.");
      return;
    }
    if (grossTotal <= 0) { showToast("Le montant brut doit être positif."); return; }
    if (isLocked(payForm.date, settings)) { showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus.`); return; }
    const advanceRepayment = Number(payForm.advanceRepayment) || 0;
    if (selectedAdvance && advanceRepayment > selectedAdvanceRemaining + 0.001) {
      showToast(`Le remboursement dépasse le solde restant de l'avance (${fmt(selectedAdvanceRemaining)}).`);
      return;
    }
    if (netTotal < -0.001) { showToast("Le net à payer est négatif — réduisez les déductions ou le remboursement d'avance."); return; }

    const commitPayslip = () => {
    const payAccount = payForm.paymentMode === "banque" ? "512" : "530";
    const deduction = Number(payForm.deductionCSSONA) || 0;
    const lines = [{ account: "641", debit: grossTotal, credit: 0 }];
    if (deduction > 0) lines.push({ account: "431", debit: 0, credit: deduction });
    if (advanceRepayment > 0) lines.push({ account: "425", debit: 0, credit: advanceRepayment });
    lines.push({ account: payAccount, debit: 0, credit: Math.max(0, netTotal) });

    const payslipId = uid();
    const payslipEntry = {
      id: payslipId, date: payForm.date, createdAt: new Date().toISOString(),
      label: `Paie — ${selectedEmployee.name} (${payForm.periodStart} au ${payForm.periodEnd})`,
      lines,
    };
    const newPayslip = {
      id: payslipId, employeeId: selectedEmployee.id, employeeName: selectedEmployee.name,
      periodStart: payForm.periodStart, periodEnd: payForm.periodEnd, date: payForm.date, createdAt: new Date().toISOString(),
      baseSalary: baseSalaryAmount, overtimeHours: Number(payForm.overtimeHours) || 0, overtimeRate: selectedEmployee.overtimeRate || 0, overtimeAmount,
      bonusAmount: Number(payForm.bonusAmount) || 0, bonusNote: payForm.bonusNote,
      deductionCSSONA: deduction, advanceId: selectedAdvance ? selectedAdvance.id : null, advanceRepayment,
      paymentMode: payForm.paymentMode, grossTotal, netTotal, status: "payé",
    };
    setEntries((prev) => [...prev, payslipEntry]);
    setPayslips((prev) => [...prev, newPayslip]);
    let updatedAdvance = null;
    if (selectedAdvance && advanceRepayment > 0) {
      const advId = selectedAdvance.id;
      const newRepaid = selectedAdvance.repaidAmount + advanceRepayment;
      updatedAdvance = { ...selectedAdvance, repaidAmount: newRepaid, status: newRepaid >= selectedAdvance.amount - 0.001 ? "remboursée" : "en cours" };
      setSalaryAdvances((prev) => prev.map((a) => (a.id === advId ? updatedAdvance : a)));
    }
    showToast(`Bulletin de paie enregistré — net à payer ${fmt(netTotal)}.`);
    logAudit("Salaires (RH)", "Bulletin de paie", `${selectedEmployee.name} — net ${fmt(netTotal)}`);
    setPayForm(emptyPayForm);
    verifyTransactionSaved(`Bulletin de paie ${selectedEmployee.name}`, [
      { category: "entries", label: "écriture de paie", isPresent: (arr) => arr.some((e) => e.id === payslipId), buildNext: () => [...entries, payslipEntry] },
      { category: "payslips", label: "bulletin de paie", isPresent: (arr) => arr.some((p) => p.id === payslipId), buildNext: () => [...payslips, newPayslip] },
      ...(updatedAdvance ? [{ category: "salaryAdvances", label: "remboursement d'avance", isPresent: (arr) => { const a = arr.find((x) => x.id === updatedAdvance.id); return a && a.repaidAmount === updatedAdvance.repaidAmount; }, buildNext: () => salaryAdvances.map((a) => (a.id === updatedAdvance.id ? updatedAdvance : a)) }] : []),
    ], { showToast, logAudit });
    };
    if (planTier !== "assisted") { commitPayslip(); return; }
    const anomalies = [];
    const corrections = [];
    const historyForEmployee = payslips.filter((p) => p.employeeId === selectedEmployee.id).map((p) => Number(p.grossTotal));
    const amt = detectAmountAnomaly(grossTotal, historyForEmployee, selectedEmployee.name);
    if (amt) { anomalies.push(amt); corrections.push("Si le montant brut est erroné : annulez ce bulletin puis ressaisissez-le avec le montant correct."); }
    const isDup = payslips.slice(-30).some((p) => p.employeeId === selectedEmployee.id && p.periodStart === payForm.periodStart && p.periodEnd === payForm.periodEnd && p.status !== "annulé");
    if (isDup) { anomalies.push(`Un bulletin existe déjà pour ${selectedEmployee.name} sur cette même période — vérifiez qu'il ne s'agit pas d'un doublon.`); corrections.push("Vérifiez les bulletins déjà enregistrés pour cette période : si c'est bien un doublon, annulez-le."); }
    const signature = `payslip:${selectedEmployee.id}:${payForm.periodStart}:${payForm.periodEnd}:${grossTotal}`;
    anomalyGate(signature, [...new Set(anomalies)], commitPayslip, showToast, () => {
      recordPendingRecommendation?.({
        companyId: _membership?.companyId,
        module: "salaires",
        anomalyText: anomalies.join(" "),
        correctionText: [...new Set(corrections)].join(" "),
        entryRef: selectedEmployee.name,
        createdByEmail: currentUserEmail,
      });
    });
  };

  const cancelPayslip = (p) => {
    if (role !== "Administrateur") { showToast("Seul un administrateur peut annuler un bulletin de paie."); return; }
    if (p.status === "annulé") { showToast("Ce bulletin est déjà annulé."); return; }
    if (isLocked(p.date, settings)) { showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus.`); return; }
    if (!window.confirm(`Annuler le bulletin de paie de ${p.employeeName} (net ${fmt(p.netTotal)}) ? Une écriture de contrepassation sera générée.`)) return;
    const original = entries.find((e) => e.id === p.id);
    let reversal = null;
    if (original) {
      reversal = {
        id: uid(), date: today, createdAt: new Date().toISOString(), label: `Annulation paie — ${p.employeeName} (${p.periodStart} au ${p.periodEnd})`,
        lines: original.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })),
      };
      setEntries((prev) => [...prev, reversal]);
    }
    setPayslips((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: "annulé" } : x)));
    let revertedAdvance = null;
    if (p.advanceId && p.advanceRepayment > 0) {
      setSalaryAdvances((prev) => prev.map((a) => {
        if (a.id !== p.advanceId) return a;
        revertedAdvance = { ...a, repaidAmount: Math.max(0, a.repaidAmount - p.advanceRepayment), status: "en cours" };
        return revertedAdvance;
      }));
    }
    showToast("Bulletin annulé par contrepassation.");
    logAudit("Salaires (RH)", "Annulation bulletin (contrepassation)", `${p.employeeName} — ${fmt(p.netTotal)}`);
    verifyTransactionSaved(`Annulation paie ${p.employeeName}`, [
      { category: "payslips", label: "statut annulé", isPresent: (arr) => { const x = arr.find((y) => y.id === p.id); return x && x.status === "annulé"; }, buildNext: () => payslips.map((x) => (x.id === p.id ? { ...x, status: "annulé" } : x)) },
      ...(reversal ? [{ category: "entries", label: "écriture de contrepassation", isPresent: (arr) => arr.some((e) => e.id === reversal.id), buildNext: () => [...entries, reversal] }] : []),
      ...(revertedAdvance ? [{ category: "salaryAdvances", label: "réouverture de l'avance", isPresent: (arr) => { const a = arr.find((x) => x.id === revertedAdvance.id); return a && a.repaidAmount === revertedAdvance.repaidAmount; }, buildNext: () => salaryAdvances.map((a) => (a.id === revertedAdvance.id ? revertedAdvance : a)) }] : []),
    ], { showToast, logAudit });
  };

  const [payFrom, setPayFrom] = useState("");
  const [payTo, setPayTo] = useState("");
  const [payEmployee, setPayEmployee] = useState("");
  const [payStatus, setPayStatus] = useState("");
  const payslipsFiltered = payslips.filter((p) =>
    (!payFrom || p.date >= payFrom) &&
    (!payTo || p.date <= payTo) &&
    (!payEmployee || String(p.employeeId) === payEmployee) &&
    (!payStatus || p.status === payStatus)
  );
  const allEmployeeOptions = [...new Map(payslips.map((p) => [String(p.employeeId), p.employeeName])).entries()];

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module 9</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Salaires (RH)</div>
      </header>

      <div className="flex gap-1 mb-6 overflow-x-auto">
        {[["employes", "Employés"], ["avances", "Avances sur salaire"], ["bulletins", "Bulletins de paie"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className="px-4 py-2 text-sm rounded-t shrink-0 whitespace-nowrap"
            style={{
              background: tab === id ? "#fff" : "transparent",
              borderBottom: tab === id ? "2px solid #C9A24B" : "2px solid transparent",
              color: tab === id ? "#152238" : "#8A8370",
              fontWeight: tab === id ? 600 : 400,
            }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "employes" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="grid md:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Nom complet</label>
              <input value={empForm.name} onChange={(e) => setEmpForm({ ...empForm, name: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Poste</label>
              <input value={empForm.position} onChange={(e) => setEmpForm({ ...empForm, position: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Salaire de base ({settings.currency || "HTG"})</label>
              <input type="number" min="0" value={empForm.baseSalary} onChange={(e) => setEmpForm({ ...empForm, baseSalary: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Fréquence de paie</label>
              <select value={empForm.payFrequency} onChange={(e) => setEmpForm({ ...empForm, payFrequency: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="mensuelle">Mensuelle</option>
                <option value="bimensuelle">Bimensuelle (2×/mois)</option>
                <option value="hebdomadaire">Hebdomadaire</option>
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Taux horaire supplémentaire ({settings.currency || "HTG"}/h)</label>
              <input type="number" min="0" value={empForm.overtimeRate} onChange={(e) => setEmpForm({ ...empForm, overtimeRate: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
              <div className="text-xs mt-1" style={{ color: "#A39C87" }}>Utilisé pour calculer les heures supplémentaires sur les bulletins de paie.</div>
            </div>
          </div>
          <div className="flex gap-2 mb-6">
            <button onClick={saveEmployee} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238" }}>
              {editingEmployeeId ? "Enregistrer les modifications" : "+ Ajouter l'employé"}
            </button>
            {editingEmployeeId && (
              <button onClick={cancelEditEmployee} className="px-4 py-2 rounded text-sm" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>Annuler</button>
            )}
          </div>

          {employees.length === 0 ? (
            <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Aucun employé enregistré pour le moment.</div>
          ) : (
            <div className="overflow-x-auto border rounded" style={{ borderColor: "#EEE9DA" }}><table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                  <th className="py-2 px-2 font-normal">Nom</th>
                  <th className="py-2 font-normal">Poste</th>
                  <th className="py-2 font-normal">Fréquence</th>
                  <th className="py-2 font-normal text-right">Salaire de base</th>
                  <th className="py-2 font-normal text-center">Statut</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {[...employees].reverse().map((emp) => (
                  <tr key={emp.id} style={{ borderBottom: "1px solid #F3EFE3", opacity: emp.active ? 1 : 0.55 }}>
                    <td className="py-2 px-2">{emp.name}<RecordedStamp createdAt={emp.createdAt} /></td>
                    <td className="py-2" style={{ color: "#7A7460" }}>{emp.position || "—"}</td>
                    <td className="py-2" style={{ color: "#7A7460" }}>{emp.payFrequency}</td>
                    <td className="py-2 tabular text-right">{fmt(emp.baseSalary)}</td>
                    <td className="py-2 text-center">
                      <span className="text-xs px-2 py-0.5 rounded" style={{ background: emp.active ? "#E6F1EE" : "#F3EFE3", color: emp.active ? "#0F6B5C" : "#8A8370" }}>
                        {emp.active ? "Actif" : "Inactif"}
                      </span>
                    </td>
                    <td className="py-2 text-right pr-2">
                      <button onClick={() => startEditEmployee(emp)} className="mr-2" title="Modifier" style={{ color: "#5C6B8C" }}><Pencil size={14} /></button>
                      <button onClick={() => toggleEmployeeActive(emp)} className="text-xs underline" style={{ color: "#8A8370" }}>
                        {emp.active ? "Désactiver" : "Réactiver"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {tab === "avances" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="grid md:grid-cols-3 gap-3 mb-4">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Employé</label>
              <select value={advForm.employeeId} onChange={(e) => setAdvForm({ ...advForm, employeeId: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="">— Sélectionner —</option>
                {activeEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Date</label>
              <input type="date" value={advForm.date} max={todayStr()} onChange={(e) => setAdvForm({ ...advForm, date: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Montant</label>
              <input type="number" min="0" value={advForm.amount} onChange={(e) => setAdvForm({ ...advForm, amount: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs" style={{ color: "#8A8370" }}>Motif (facultatif)</label>
              <input value={advForm.reason} onChange={(e) => setAdvForm({ ...advForm, reason: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Versée depuis</label>
              <select value={advForm.paymentMode} onChange={(e) => setAdvForm({ ...advForm, paymentMode: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="caisse">Caisse</option>
                <option value="banque">Banque</option>
              </select>
            </div>
          </div>
          <PendingRecommendationsBanner recommendations={pendingRecommendations} module="salaires" onDismiss={resolvePendingRecommendation} />
          <AssistedPrincipleReminder planTier={planTier} text="Une avance sur salaire est une créance envers l'employé (compte 425), pas une charge de salaire — elle sera déduite de son prochain bulletin de paie." />
          <button onClick={giveAdvance} disabled={hasPendingRH} className="px-4 py-2 rounded text-sm text-white mb-6" style={{ background: "#152238", opacity: hasPendingRH ? 0.5 : 1 }}>+ Enregistrer l'avance</button>

          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Du</label>
              <input type="date" value={advFrom} onChange={(e) => setAdvFrom(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
              <input type="date" value={advTo} onChange={(e) => setAdvTo(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Employé</label>
              <select value={advEmployee} onChange={(e) => setAdvEmployee(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }}>
                <option value="">Tous</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Statut</label>
              <select value={advStatus} onChange={(e) => setAdvStatus(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }}>
                <option value="">Tous</option>
                <option value="en cours">En cours</option>
                <option value="remboursée">Remboursée</option>
                <option value="annulée">Annulée</option>
              </select>
            </div>
            {(advFrom || advTo || advEmployee || advStatus) && (
              <button onClick={() => { setAdvFrom(""); setAdvTo(""); setAdvEmployee(""); setAdvStatus(""); }} className="text-xs underline mb-1.5" style={{ color: "#8A8370" }}>Réinitialiser</button>
            )}
            {(advFrom || advTo || advEmployee || advStatus) && (
              <div className="tabular text-xs mb-1.5 ml-auto" style={{ color: "#152238" }}>
                {advancesFiltered.length} avance{advancesFiltered.length > 1 ? "s" : ""} · Total {fmt(advancesFiltered.reduce((s, a) => s + a.amount, 0))}
              </div>
            )}
          </div>

          {advancesFiltered.length === 0 ? (
            <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>{salaryAdvances.length === 0 ? "Aucune avance enregistrée." : "Aucune avance ne correspond à ces filtres."}</div>
          ) : (
            <div className="overflow-x-auto border rounded" style={{ borderColor: "#EEE9DA" }}><table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                  <th className="py-2 px-2 font-normal">Date</th>
                  <th className="py-2 font-normal">Employé</th>
                  <th className="py-2 font-normal text-right">Montant</th>
                  <th className="py-2 font-normal text-right">Remboursé</th>
                  <th className="py-2 font-normal text-center">Statut</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {[...advancesFiltered].reverse().map((a) => (
                  <tr key={a.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                    <td className="py-2 px-2 tabular">{a.date}<RecordedStamp createdAt={a.createdAt} /></td>
                    <td className="py-2">{a.employeeName}{a.reason ? <span style={{ color: "#A39C87" }}> — {a.reason}</span> : null}</td>
                    <td className="py-2 tabular text-right">{fmt(a.amount)}</td>
                    <td className="py-2 tabular text-right" style={{ color: "#7A7460" }}>{fmt(a.repaidAmount)}</td>
                    <td className="py-2 text-center">
                      <span className="text-xs px-2 py-0.5 rounded" style={{
                        background: a.status === "en cours" ? "#FBF1DC" : a.status === "remboursée" ? "#E6F1EE" : "#F3EFE3",
                        color: a.status === "en cours" ? "#9A7B1E" : a.status === "remboursée" ? "#0F6B5C" : "#8A8370",
                      }}>{a.status}</span>
                    </td>
                    <td className="py-2 text-right pr-2">
                      {role === "Administrateur" && a.status === "en cours" && a.repaidAmount === 0 && (
                        <button onClick={() => cancelAdvance(a)} title="Annuler (contrepassation)" style={{ color: "#A6432F" }}><RotateCcw size={14} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {tab === "bulletins" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="grid md:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Employé</label>
              <select value={payForm.employeeId} onChange={(e) => setPayForm({ ...payForm, employeeId: e.target.value, advanceId: "", advanceRepayment: "" })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="">— Sélectionner —</option>
                {activeEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Période du</label>
              <input type="date" value={payForm.periodStart} max={todayStr()} onChange={(e) => setPayForm({ ...payForm, periodStart: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Période au</label>
              <input type="date" value={payForm.periodEnd} max={todayStr()} onChange={(e) => setPayForm({ ...payForm, periodEnd: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Date de paiement</label>
              <input type="date" value={payForm.date} max={todayStr()} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Heures supplémentaires</label>
              <input type="number" min="0" value={payForm.overtimeHours} onChange={(e) => setPayForm({ ...payForm, overtimeHours: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
              {selectedEmployee && <div className="text-xs mt-1" style={{ color: "#A39C87" }}>Taux : {fmt(selectedEmployee.overtimeRate || 0)}/h → {fmt(overtimeAmount)}</div>}
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Prime / bonus</label>
              <input type="number" min="0" value={payForm.bonusAmount} onChange={(e) => setPayForm({ ...payForm, bonusAmount: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs" style={{ color: "#8A8370" }}>Motif de la prime (facultatif)</label>
              <input value={payForm.bonusNote} onChange={(e) => setPayForm({ ...payForm, bonusNote: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Retenues (CSS/ONA, etc.)</label>
              <input type="number" min="0" value={payForm.deductionCSSONA} onChange={(e) => setPayForm({ ...payForm, deductionCSSONA: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
            {employeeOpenAdvances.length > 0 && (
              <>
                <div>
                  <label className="text-xs" style={{ color: "#8A8370" }}>Rembourser une avance</label>
                  <select value={payForm.advanceId} onChange={(e) => setPayForm({ ...payForm, advanceId: e.target.value, advanceRepayment: "" })}
                    className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                    <option value="">Aucune</option>
                    {employeeOpenAdvances.map((a) => <option key={a.id} value={a.id}>{a.date} — solde {fmt(a.amount - a.repaidAmount)}</option>)}
                  </select>
                </div>
                {selectedAdvance && (
                  <div>
                    <label className="text-xs" style={{ color: "#8A8370" }}>Montant à déduire (solde {fmt(selectedAdvanceRemaining)})</label>
                    <input type="number" min="0" max={selectedAdvanceRemaining} value={payForm.advanceRepayment} onChange={(e) => setPayForm({ ...payForm, advanceRepayment: e.target.value })}
                      className="block w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
                  </div>
                )}
              </>
            )}
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Payé depuis</label>
              <select value={payForm.paymentMode} onChange={(e) => setPayForm({ ...payForm, paymentMode: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="caisse">Caisse</option>
                <option value="banque">Banque</option>
              </select>
            </div>
          </div>

          {selectedEmployee && (
            <div className="mb-4 p-3 rounded text-sm tabular" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }}>
              <div>Salaire de base : {fmt(baseSalaryAmount)}</div>
              {overtimeAmount > 0 && <div>Heures supplémentaires : {fmt(overtimeAmount)}</div>}
              {Number(payForm.bonusAmount) > 0 && <div>Prime : {fmt(Number(payForm.bonusAmount))}</div>}
              <div className="font-medium" style={{ color: "#152238" }}>Total brut : {fmt(grossTotal)}</div>
              {Number(payForm.deductionCSSONA) > 0 && <div style={{ color: "#A6432F" }}>Retenues : − {fmt(Number(payForm.deductionCSSONA))}</div>}
              {Number(payForm.advanceRepayment) > 0 && <div style={{ color: "#A6432F" }}>Remboursement d'avance : − {fmt(Number(payForm.advanceRepayment))}</div>}
              <div className="font-medium mt-1" style={{ color: netTotal < 0 ? "#A6432F" : "#0F6B5C" }}>Net à payer : {fmt(netTotal)}</div>
            </div>
          )}

          <PendingRecommendationsBanner recommendations={pendingRecommendations} module="salaires" onDismiss={resolvePendingRecommendation} />
          <AssistedPrincipleReminder planTier={planTier} text="Le bulletin de paie enregistre le salaire brut en charge, les déductions et l'avance remboursée séparément — le net à payer est ce qui sort réellement de la caisse ou banque." />
          <button onClick={processPayslip} disabled={hasPendingRH} className="px-4 py-2 rounded text-sm text-white mb-6" style={{ background: "#152238", opacity: hasPendingRH ? 0.5 : 1 }}>+ Enregistrer le bulletin de paie</button>

          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Du</label>
              <input type="date" value={payFrom} onChange={(e) => setPayFrom(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
              <input type="date" value={payTo} onChange={(e) => setPayTo(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Employé</label>
              <select value={payEmployee} onChange={(e) => setPayEmployee(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }}>
                <option value="">Tous</option>
                {allEmployeeOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Statut</label>
              <select value={payStatus} onChange={(e) => setPayStatus(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }}>
                <option value="">Tous</option>
                <option value="payé">Payé</option>
                <option value="annulé">Annulé</option>
              </select>
            </div>
            {(payFrom || payTo || payEmployee || payStatus) && (
              <button onClick={() => { setPayFrom(""); setPayTo(""); setPayEmployee(""); setPayStatus(""); }} className="text-xs underline mb-1.5" style={{ color: "#8A8370" }}>Réinitialiser</button>
            )}
            {(payFrom || payTo || payEmployee || payStatus) && (
              <div className="tabular text-xs mb-1.5 ml-auto" style={{ color: "#152238" }}>
                {payslipsFiltered.length} bulletin{payslipsFiltered.length > 1 ? "s" : ""} · Net total {fmt(payslipsFiltered.filter((p) => p.status !== "annulé").reduce((s, p) => s + p.netTotal, 0))}
              </div>
            )}
          </div>

          {payslipsFiltered.length === 0 ? (
            <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>{payslips.length === 0 ? "Aucun bulletin de paie enregistré." : "Aucun bulletin ne correspond à ces filtres."}</div>
          ) : (
            <div className="overflow-x-auto border rounded" style={{ borderColor: "#EEE9DA" }}><table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                  <th className="py-2 px-2 font-normal">Date</th>
                  <th className="py-2 font-normal">Employé</th>
                  <th className="py-2 font-normal">Période</th>
                  <th className="py-2 font-normal text-right">Brut</th>
                  <th className="py-2 font-normal text-right">Net</th>
                  <th className="py-2 font-normal text-center">Statut</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {[...payslipsFiltered].reverse().map((p) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                    <td className="py-2 px-2 tabular">{p.date}<RecordedStamp createdAt={p.createdAt} /></td>
                    <td className="py-2">{p.employeeName}</td>
                    <td className="py-2 tabular" style={{ color: "#7A7460" }}>{p.periodStart} → {p.periodEnd}</td>
                    <td className="py-2 tabular text-right">{fmt(p.grossTotal)}</td>
                    <td className="py-2 tabular text-right font-medium">{fmt(p.netTotal)}</td>
                    <td className="py-2 text-center">
                      <span className="text-xs px-2 py-0.5 rounded" style={{ background: p.status === "payé" ? "#E6F1EE" : "#F3EFE3", color: p.status === "payé" ? "#0F6B5C" : "#8A8370" }}>{p.status}</span>
                    </td>
                    <td className="py-2 text-right pr-2">
                      {role === "Administrateur" && p.status === "payé" && (
                        <button onClick={() => cancelPayslip(p)} title="Annuler (contrepassation)" style={{ color: "#A6432F" }}><RotateCcw size={14} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}
    </div>
  );
}

function RapportsModule({ accounts, balances, invoices, purchases, entries, settings, showToast }) {
  const [tab, setTab] = useState("resultat");
  const [detailMonth, setDetailMonth] = useState("");

  const produitsAccounts = accounts.filter((a) => a.type === "Produit").map((a) => ({ ...a, solde: -(balances[a.code] || 0) }));
  const chargesAccounts = accounts.filter((a) => a.type === "Charge").map((a) => ({ ...a, solde: balances[a.code] || 0 }));
  const totalProduits = produitsAccounts.reduce((s, a) => s + a.solde, 0);
  const totalCharges = chargesAccounts.reduce((s, a) => s + a.solde, 0);
  const resultat = totalProduits - totalCharges;

  const actifAccounts = accounts.filter((a) => a.type === "Actif").map((a) => ({ ...a, solde: balances[a.code] || 0 }));
  const passifAccounts = accounts.filter((a) => a.type === "Passif").map((a) => ({ ...a, solde: -(balances[a.code] || 0) }));
  const capitauxAccounts = accounts.filter((a) => a.type === "Capitaux propres").map((a) => ({ ...a, solde: -(balances[a.code] || 0) }));
  const totalActif = actifAccounts.reduce((s, a) => s + a.solde, 0);
  const totalPassif = passifAccounts.reduce((s, a) => s + a.solde, 0) + capitauxAccounts.reduce((s, a) => s + a.solde, 0) + resultat;

  const salesByMonth = useMemo(() => {
    const byMonth = {};
    invoices.forEach((inv) => {
      const key = monthLabel(inv.date);
      if (!byMonth[key]) byMonth[key] = { total: 0, count: 0 };
      byMonth[key].total += inv.total;
      byMonth[key].count += 1;
    });
    return Object.entries(byMonth).map(([mois, v]) => ({ mois, total: v.total, count: v.count }));
  }, [invoices]);

  const topProducts = useMemo(() => {
    const byProduct = {};
    invoices.forEach((inv) => {
      (inv.lines || []).forEach((l) => {
        if (!byProduct[l.name]) byProduct[l.name] = { name: l.name, qty: 0, revenue: 0 };
        byProduct[l.name].qty += l.qty;
        byProduct[l.name].revenue += l.subtotal;
      });
    });
    return Object.values(byProduct).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [invoices]);

  // Mois affiché par défaut dans le détail des ventes : le plus récent avec au moins
  // une vente, pour ne jamais ouvrir sur un mois vide si le mois en cours n'a rien.
  const effectiveDetailMonth = detailMonth || salesByMonth[salesByMonth.length - 1]?.mois || "";
  const salesForDetailMonth = useMemo(() => {
    if (!effectiveDetailMonth) return [];
    return invoices
      .filter((inv) => monthLabel(inv.date) === effectiveDetailMonth)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [invoices, effectiveDetailMonth]);

  const exportJournalCSV = () => {
    // Export générique du journal, sans référence à une administration fiscale
    // précise — utile pour un import dans un tableur ou un autre logiciel, en
    // attendant les formats réellement conformes DGI (Haïti) / SAT (Mexique)
    // prévus en v2.0 (voir note dans l'interface).
    const cols = ["Date", "Compte", "Libellé du compte", "Libellé de l'écriture", "Débit", "Crédit"];
    const rows = [cols.join(",")];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const sorted = [...entries].sort((a, b) => (a.date > b.date ? 1 : -1));
    sorted.forEach((e) => {
      (e.lines || []).forEach((l) => {
        const acc = accounts.find((a) => a.code === l.account);
        rows.push([esc(e.date), esc(l.account), esc(acc?.name || ""), esc(e.label || ""), (l.debit || 0).toFixed(2), (l.credit || 0).toFixed(2)].join(","));
      });
    });
    const blob = new Blob(["\uFEFF" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `journal-${(settings?.companyName || "export").replace(/\s+/g, "")}-${todayStr()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Export du journal généré.");
  };

  const reportTitles = {
    resultat: "Compte de résultat",
    bilan: "Bilan simplifié",
    balance: "Balance des comptes",
    ventes: "Analyse des ventes",
    export: "Export",
  };

  const exportCurrentTabPDF = () => {
    if (tab === "resultat") {
      downloadTablePDF({
        title: "Compte de résultat", settings,
        columns: ["Code", "Compte", "Solde"],
        rows: [
          ...produitsAccounts.map((a) => [a.code, `Produit — ${a.name}`, fmt(a.solde)]),
          ...chargesAccounts.map((a) => [a.code, `Charge — ${a.name}`, fmt(a.solde)]),
        ],
        footerLines: [
          `Total produits : ${fmt(totalProduits)}`,
          `Total charges : ${fmt(totalCharges)}`,
          `Résultat net : ${fmt(resultat)}`,
        ],
      });
    } else if (tab === "bilan") {
      downloadTablePDF({
        title: "Bilan simplifié", settings,
        columns: ["Code", "Compte", "Solde"],
        rows: [
          ...actifAccounts.map((a) => [a.code, `Actif — ${a.name}`, fmt(a.solde)]),
          ...capitauxAccounts.map((a) => [a.code, `Capitaux propres — ${a.name}`, fmt(a.solde)]),
          ...passifAccounts.map((a) => [a.code, `Passif — ${a.name}`, fmt(a.solde)]),
          ["—", "Résultat de l'exercice", fmt(resultat)],
        ],
        footerLines: [
          `Total actif : ${fmt(totalActif)}`,
          `Total passif + capitaux propres : ${fmt(totalPassif)}`,
        ],
      });
    } else if (tab === "balance") {
      downloadTablePDF({
        title: "Balance des comptes", settings,
        columns: ["Code", "Compte", "Type", "Solde"],
        rows: accounts.map((a) => [a.code, a.name, a.type, fmt(balances[a.code] || 0)]),
      });
    } else if (tab === "ventes") {
      downloadTablePDF({
        title: "Analyse des ventes — chiffre d'affaires par mois", settings,
        columns: ["Mois", "Chiffre d'affaires"],
        rows: salesByMonth.map((m) => [m.mois, fmt(m.total)]),
      });
      downloadTablePDF({
        title: "Analyse des ventes — meilleures ventes", settings,
        columns: ["Article", "Quantité vendue", "Chiffre d'affaires"],
        rows: topProducts.map((p) => [p.name, String(p.qty), fmt(p.revenue)]),
      });
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6 no-print">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module 7</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Rapports et analyse</div>
        <p className="text-sm mt-1" style={{ color: "#7A7460" }}>États calculés en continu à partir du journal comptable et des ventes.</p>
      </header>

      {/* En-tête visible uniquement à l'impression (bouton "Imprimer" ci-dessous) */}
      <div className="print-only mb-6 flex items-start gap-3" style={{ borderBottom: "2px solid #152238", paddingBottom: 12 }}>
        {settings.companyLogo && (
          <img src={settings.companyLogo} alt="" style={{ width: 40, height: 40, objectFit: "contain" }} />
        )}
        <div>
          <div className="display" style={{ fontSize: 20, fontWeight: 700, color: "#152238" }}>{settings.companyName || "Mon Entreprise"}</div>
          {settings.companyAddress && <div style={{ fontSize: 12, color: "#555" }}>{settings.companyAddress}</div>}
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8, color: "#152238" }}>{reportTitles[tab] || "Rapport"}</div>
          <div className="tabular" style={{ fontSize: 12, color: "#888" }}>Généré le {todayStr()}</div>
        </div>
      </div>

      <div className="flex gap-1 mb-3 flex-wrap no-print">
        {[["resultat", "Compte de résultat"], ["bilan", "Bilan simplifié"], ["balance", "Balance des comptes"], ["ventes", "Analyse des ventes"], ["export", "Export"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className="px-4 py-2 text-sm rounded-t shrink-0 whitespace-nowrap"
            style={{
              background: tab === id ? "#fff" : "transparent",
              borderBottom: tab === id ? "2px solid #C9A24B" : "2px solid transparent",
              color: tab === id ? "#152238" : "#8A8370",
              fontWeight: tab === id ? 600 : 400,
            }}>
            {label}
          </button>
        ))}
      </div>
      {tab !== "export" && (
        <div className="flex flex-wrap gap-2 mb-6 no-print">
          <button onClick={exportCurrentTabPDF} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>
            <Download size={13} /> Télécharger « {reportTitles[tab]} » en PDF
          </button>
          <button onClick={() => window.print()} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>
            <Printer size={13} /> Imprimer
          </button>
        </div>
      )}

      {tab === "resultat" && (
        <div className="grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1", minWidth: 0 }}>
            <div className="text-sm font-semibold mb-3" style={{ color: "#0F6B5C" }}>Produits</div>
            <div className="overflow-x-auto"><table className="w-full text-sm mb-2">
              <tbody>
                {produitsAccounts.map((a) => (
                  <tr key={a.code} style={{ borderBottom: "1px solid #F3EFE3" }}>
                    <td className="py-1.5 tabular" style={{ color: "#7A7460" }}>{a.code}</td>
                    <td className="py-1.5">{a.name}</td>
                    <td className="py-1.5 tabular text-right">{fmt(a.solde)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="flex justify-between tabular text-sm font-semibold pt-2" style={{ borderTop: "1px solid #EEE9DA" }}>
              <span>Total produits</span><span>{fmt(totalProduits)}</span>
            </div>
          </div>
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1", minWidth: 0 }}>
            <div className="text-sm font-semibold mb-3" style={{ color: "#A6432F" }}>Charges</div>
            <div className="overflow-x-auto"><table className="w-full text-sm mb-2">
              <tbody>
                {chargesAccounts.map((a) => (
                  <tr key={a.code} style={{ borderBottom: "1px solid #F3EFE3" }}>
                    <td className="py-1.5 tabular" style={{ color: "#7A7460" }}>{a.code}</td>
                    <td className="py-1.5">{a.name}</td>
                    <td className="py-1.5 tabular text-right">{fmt(a.solde)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="flex justify-between tabular text-sm font-semibold pt-2" style={{ borderTop: "1px solid #EEE9DA" }}>
              <span>Total charges</span><span>{fmt(totalCharges)}</span>
            </div>
          </div>
          <div className="bg-white rounded-lg p-6 flex justify-between items-center" style={{ border: "1px solid #E4DFD1", gridColumn: "1 / -1" }}>
            <span className="text-sm font-medium" style={{ color: "#152238" }}>Résultat net</span>
            <span className="tabular text-xl font-semibold" style={{ color: resultat >= 0 ? "#0F6B5C" : "#A6432F" }}>{fmt(resultat)}</span>
          </div>
        </div>
      )}

      {tab === "bilan" && (
        <div className="grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1", minWidth: 0 }}>
            <div className="text-sm font-semibold mb-3" style={{ color: "#152238" }}>Actif</div>
            <div className="overflow-x-auto"><table className="w-full text-sm mb-2">
              <tbody>
                {actifAccounts.map((a) => (
                  <tr key={a.code} style={{ borderBottom: "1px solid #F3EFE3" }}>
                    <td className="py-1.5 tabular" style={{ color: "#7A7460" }}>{a.code}</td>
                    <td className="py-1.5">{a.name}</td>
                    <td className="py-1.5 tabular text-right">{fmt(a.solde)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="flex justify-between tabular text-sm font-semibold pt-2" style={{ borderTop: "1px solid #EEE9DA" }}>
              <span>Total actif</span><span>{fmt(totalActif)}</span>
            </div>
          </div>
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1", minWidth: 0 }}>
            <div className="text-sm font-semibold mb-3" style={{ color: "#152238" }}>Passif &amp; capitaux propres</div>
            <div className="overflow-x-auto"><table className="w-full text-sm mb-2">
              <tbody>
                {[...capitauxAccounts, ...passifAccounts].map((a) => (
                  <tr key={a.code} style={{ borderBottom: "1px solid #F3EFE3" }}>
                    <td className="py-1.5 tabular" style={{ color: "#7A7460" }}>{a.code}</td>
                    <td className="py-1.5">{a.name}</td>
                    <td className="py-1.5 tabular text-right">{fmt(a.solde)}</td>
                  </tr>
                ))}
                <tr style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-1.5 tabular" style={{ color: "#7A7460" }}>—</td>
                  <td className="py-1.5">Résultat de l'exercice</td>
                  <td className="py-1.5 tabular text-right">{fmt(resultat)}</td>
                </tr>
              </tbody>
            </table></div>
            <div className="flex justify-between tabular text-sm font-semibold pt-2" style={{ borderTop: "1px solid #EEE9DA" }}>
              <span>Total passif + capitaux propres</span><span>{fmt(totalPassif)}</span>
            </div>
          </div>
          {Math.round(totalActif) !== Math.round(totalPassif) && (
            <div className="text-xs px-4 py-2 rounded" style={{ background: "#F7E9E3", color: "#A6432F", gridColumn: "1 / -1" }}>
              Écart entre actif et passif : {fmt(totalActif - totalPassif)} — vérifiez les écritures saisies.
            </div>
          )}
        </div>
      )}

      {tab === "balance" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-2 font-normal">Code</th>
                <th className="py-2 font-normal">Compte</th>
                <th className="py-2 font-normal">Type</th>
                <th className="py-2 font-normal text-right">Solde</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.code} style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-2 tabular">{a.code}</td>
                  <td className="py-2">{a.name}</td>
                  <td className="py-2" style={{ color: "#7A7460" }}>{a.type}</td>
                  <td className="py-2 tabular text-right">{fmt(balances[a.code] || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === "ventes" && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-sm font-semibold mb-4" style={{ color: "#152238" }}>Chiffre d'affaires par mois</div>
            {salesByMonth.length === 0 ? (
              <div className="text-sm py-10 text-center" style={{ color: "#A39C87" }}>Aucune vente enregistrée.</div>
            ) : salesByMonth.length === 1 ? (
              // Un graphique en ligne avec un seul point ne montre qu'un point isolé sans
              // repère — illisible. Tant qu'il n'y a qu'un mois de données, on affiche plutôt
              // le chiffre directement : plus clair, et le graphique reprendra automatiquement
              // dès qu'un deuxième mois de ventes existera.
              <div className="text-center py-6">
                <div className="text-xs uppercase tracking-wide mb-1" style={{ color: "#8A8370" }}>{salesByMonth[0].mois}</div>
                <div className="tabular" style={{ fontSize: 32, fontWeight: 700, color: "#0F6B5C" }}>{fmt(salesByMonth[0].total)}</div>
                <div className="text-xs mt-1" style={{ color: "#A39C87" }}>{salesByMonth[0].count} vente{salesByMonth[0].count > 1 ? "s" : ""} — le graphique d'évolution apparaîtra ici dès qu'un deuxième mois de ventes sera enregistré.</div>
              </div>
            ) : (
              <SimpleLineChart data={salesByMonth} xKey="mois" yKey="total" color="#0F6B5C" name="Chiffre d'affaires" />
            )}
          </div>
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="text-sm font-semibold" style={{ color: "#152238" }}>Détail des ventes du mois</div>
              {salesByMonth.length > 1 && (
                <select value={effectiveDetailMonth} onChange={(e) => setDetailMonth(e.target.value)}
                  className="border rounded px-2 py-1 text-xs" style={{ borderColor: "#DDD6C4" }}>
                  {salesByMonth.map((m) => <option key={m.mois} value={m.mois}>{m.mois}</option>)}
                </select>
              )}
            </div>
            {salesForDetailMonth.length === 0 ? (
              <div className="text-sm py-10 text-center" style={{ color: "#A39C87" }}>Aucune vente pour ce mois.</div>
            ) : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead>
                  <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                    <th className="py-2 font-normal">Date</th>
                    <th className="py-2 font-normal">N°</th>
                    <th className="py-2 font-normal">Client</th>
                    <th className="py-2 font-normal text-right">Montant</th>
                    <th className="py-2 font-normal text-right">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {salesForDetailMonth.map((inv) => (
                    <tr key={inv.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                      <td className="py-2 tabular">{inv.date}</td>
                      <td className="py-2 tabular">{inv.number}</td>
                      <td className="py-2">{inv.client}</td>
                      <td className="py-2 tabular text-right">{fmt(inv.total)}</td>
                      <td className="py-2 text-right">
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{
                          background: inv.status === "payée" ? "#E6F1EE" : inv.status === "annulée" ? "#F7E9E3" : "#FBF1DC",
                          color: inv.status === "payée" ? "#0F6B5C" : inv.status === "annulée" ? "#A6432F" : "#9A7B1E",
                        }}>{inv.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-sm font-semibold mb-4" style={{ color: "#152238" }}>Meilleures ventes — répartition du chiffre d'affaires</div>
            {topProducts.length === 0 ? (
              <div className="text-sm py-10 text-center" style={{ color: "#A39C87" }}>Aucune vente enregistrée.</div>
            ) : (
              <SimpleDonutChart data={topProducts} nameKey="name" valueKey="revenue" />
            )}
          </div>
        </div>
      )}

      {tab === "export" && (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          <div className="bg-white rounded-lg p-5" style={{ border: "1px solid #E4DFD1", minWidth: 0 }}>
            <FileDown size={18} style={{ color: "#0F6B5C" }} className="mb-2" />
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Export du journal (CSV)</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>
              Toutes les écritures du journal, format tableur universel — pour import dans Excel ou un autre logiciel.
            </p>
            <button onClick={exportJournalCSV} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>
              Télécharger (.csv)
            </button>
            <p className="text-xs mt-3 pt-3" style={{ color: "#A39C87", borderTop: "1px dashed #EEE9DA" }}>
              Formats conformes aux administrations fiscales d'Haïti (DGI) et du Mexique (SAT — Catálogo de Cuentas, Balanza de Comprobación, Pólizas) prévus pour la version 2.0.
            </p>
          </div>
          <div className="bg-white rounded-lg p-5 no-print" style={{ border: "1px solid #E4DFD1", minWidth: 0 }}>
            <Download size={18} style={{ color: "#0F6B5C" }} className="mb-2" />
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Export PDF</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>
              Retournez sur l'onglet souhaité (Compte de résultat, Bilan, Balance, Analyse des ventes) et utilisez le bouton « Télécharger en PDF » en haut de la page — un vrai fichier PDF est généré et téléchargé directement, y compris sur mobile.
            </p>
          </div>
          <div className="text-xs px-4 py-3 rounded" style={{ background: "#FAF8F1", color: "#7A7460", gridColumn: "1 / -1" }}>
            Le bouton « Imprimer » sur chaque onglet reste disponible séparément pour une impression papier classique.
          </div>
        </div>
      )}
    </div>
  );
}

// Panneau de gestion du code de sécurité partagé de l'entreprise — visible
// uniquement de l'Administrateur principal (contrôlé par le composant appelant).
// Le code lui-même n'est jamais stocké ni transmis en clair : seule son empreinte
// (hachée côté serveur, avec sel) est conservée, via des fonctions RPC dédiées.
function CompanySecurityPinPanel({ companyId, showToast, logAudit }) {
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [showPins, setShowPins] = useState(false);

  const savePin = async () => {
    if (newPin.length < 4) { showToast("Le code doit contenir au moins 4 caractères."); return; }
    if (newPin !== confirmPin) { showToast("Les deux codes saisis ne correspondent pas."); return; }
    setSaving(true);
    const { error } = await supabase.rpc("set_company_pin", { target_company_id: companyId, new_pin: newPin });
    setSaving(false);
    if (error) { showToast(`Impossible d'enregistrer le code (${error.message || error.code}).`); return; }
    setNewPin(""); setConfirmPin("");
    showToast("Code de sécurité de l'entreprise mis à jour — toute l'équipe devra le ressaisir à sa prochaine connexion.");
    logAudit("Administration", "Modification du code de sécurité d'entreprise", "");
  };

  const removePin = async () => {
    if (!window.confirm("Retirer le code de sécurité de l'entreprise ? Plus personne n'aura à le saisir pour accéder à l'entreprise.")) return;
    setSaving(true);
    const { error } = await supabase.rpc("set_company_pin", { target_company_id: companyId, new_pin: null });
    setSaving(false);
    if (error) { showToast(`Impossible de retirer le code (${error.message || error.code}).`); return; }
    showToast("Code de sécurité retiré.");
    logAudit("Administration", "Retrait du code de sécurité d'entreprise", "");
  };

  return (
    <div className="mt-6 p-4 rounded-lg" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }}>
      <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Code de sécurité de l'entreprise</div>
      <p className="text-xs mb-3" style={{ color: "#8A8370" }}>
        Réservé à l'Administrateur principal. Un code unique, partagé avec toute l'équipe, requis en plus de la connexion habituelle pour accéder à cette entreprise. Le modifier déconnecte effectivement tout le monde jusqu'à ce qu'ils saisissent le nouveau code.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        <div className="relative">
          <input type={showPins ? "text" : "password"} value={newPin} onChange={(e) => setNewPin(e.target.value)}
            placeholder="Nouveau code (4 caractères min.)"
            className="border rounded px-2 py-1.5 pr-8 text-sm w-full" style={{ borderColor: "#DDD6C4" }} />
        </div>
        <div className="relative">
          <input type={showPins ? "text" : "password"} value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)}
            placeholder="Confirmer le code"
            className="border rounded px-2 py-1.5 pr-8 text-sm w-full" style={{ borderColor: "#DDD6C4" }} />
          <button type="button" onClick={() => setShowPins((v) => !v)}
            title={showPins ? "Masquer les codes" : "Afficher les codes pour vérifier qu'ils correspondent"}
            className="absolute right-2 top-1/2 -translate-y-1/2" style={{ color: "#8A8370" }}>
            {showPins ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={savePin} disabled={saving} className="text-xs px-3 py-1.5 rounded text-white" style={{ background: "#152238" }}>
          {saving ? "Enregistrement…" : "Définir / changer le code"}
        </button>
        <button onClick={removePin} disabled={saving} className="text-xs px-3 py-1.5 rounded" style={{ border: "1px solid #A6432F", color: "#A6432F" }}>
          Retirer le code
        </button>
      </div>
    </div>
  );
}

// Carte "Imprimante Bluetooth" — permet de jumeler une mini-imprimante thermique
// (ex. GOOJPRT PT-210) directement depuis le navigateur, sans appli tierce. Une
// fois connectée pour cette session, le bouton "Imprimer (Bluetooth)" des factures
// fonctionne directement.
function BluetoothPrinterCard({ showToast, settings, compact }) {
  const [connected, setConnected] = useState(isThermalPrinterConnected());
  const [printerName, setPrinterName] = useState(getRememberedPrinterName());
  const [busy, setBusy] = useState(false);
  const supported = !!navigator.bluetooth;

  const handleConnect = async () => {
    setBusy(true);
    try {
      const name = await connectThermalPrinter();
      setPrinterName(name);
      setConnected(true);
      showToast("Imprimante « " + name + " » connectée.");
    } catch (e) {
      if (e && e.name !== "NotFoundError") { // l'utilisateur a juste fermé la liste sans choisir — pas une vraie erreur
        showToast("Connexion impossible : " + (e && e.message ? e.message : e));
      }
    }
    setBusy(false);
  };
  const handleDisconnect = () => {
    disconnectThermalPrinter();
    setConnected(false);
    showToast("Imprimante déconnectée.");
  };
  const handleTest = async () => {
    setBusy(true);
    const testInvoice = {
      number: "TEST", date: todayStr(), client: "Client test",
      lines: [{ name: "Article de test", qty: 1, price: 100, subtotal: 100 }],
      totalHT: 100, totalTax: 0, total: 100, taxLabel: "Taxe", paymentMode: "caisse", payments: [],
    };
    await printInvoiceBluetooth(testInvoice, settings, showToast);
    setBusy(false);
  };

  if (compact) {
    if (!supported) return null; // évite d'encombrer l'écran de vente sur un appareil incompatible
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: connected ? "#0F6B5C" : "#DDD6C4" }} />
        <span className="text-xs shrink-0" style={{ color: "#7A7460" }}>
          {connected ? `Imprimante : ${printerName}` : "Imprimante Bluetooth non connectée"}
        </span>
        {!connected ? (
          <button onClick={handleConnect} disabled={busy} className="flex items-center gap-1 text-xs underline" style={{ color: "#152238" }}>
            <BluetoothIcon size={12} /> {busy ? "Connexion…" : "Connecter"}
          </button>
        ) : (
          <button onClick={handleDisconnect} className="flex items-center gap-1 text-xs underline" style={{ color: "#7A7460" }}>
            Déconnecter
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
      <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Imprimante Bluetooth (mini-imprimante thermique)</div>
      <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
        Connecte directement l'application à une mini-imprimante Bluetooth (ex. GOOJPRT PT-210) — aucune appli tierce à installer. La connexion doit être refaite si la page est rechargée ou le navigateur fermé. Fonctionne sur Chrome/Edge Android — pas sur Safari/iPhone. Chaque vendeur connecte sa propre imprimante depuis l'onglet Point de vente ; ce panneau ici sert surtout à faire un test.
      </p>
      {!supported && (
        <p className="text-xs mb-3" style={{ color: "#A6432F" }}>Bluetooth non disponible dans ce navigateur sur cet appareil.</p>
      )}
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full" style={{ background: connected ? "#0F6B5C" : "#DDD6C4" }} />
        <span className="text-xs" style={{ color: "#7A7460" }}>
          {connected ? `Connectée : ${printerName}` : printerName ? `Non connectée (dernière utilisée : ${printerName})` : "Aucune imprimante connectée"}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {!connected ? (
          <button onClick={handleConnect} disabled={!supported || busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>
            <BluetoothIcon size={13} /> {busy ? "Connexion…" : "Connecter l'imprimante"}
          </button>
        ) : (
          <>
            <button onClick={handleTest} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>
              <Printer size={13} /> Imprimer un ticket de test
            </button>
            <button onClick={handleDisconnect} className="px-3 py-1.5 rounded text-xs" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>
              Déconnecter
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Gestion des postes de vente distincts (ex. "Caisse 1", "Caisse 2") — fonctionnalité
// réservée au forfait Assisté. Chaque poste est identifié par l'appareil lui-même
// (pas ce panneau), dans l'onglet Point de vente. En plus de son nom, chaque poste
// porte deux listes indépendantes gérées ici : des noms de vendeurs et des emails
// qui lui sont affiliés — un seul de chaque étant "actif" à la fois (celui qui
// s'applique aux ventes en cours sur ce poste). Un Administrateur (non principal)
// peut ajouter des noms/emails et changer lequel est actif, mais seul
// l'Administrateur principal peut en retirer.
function SalesStationsPanel({ salesStations, setSalesStations, showToast, logAudit, isPrimaryAdmin }) {
  const [newName, setNewName] = useState("");
  const [newSellerName, setNewSellerName] = useState({});
  const [newSellerEmail, setNewSellerEmail] = useState({});

  const addStation = () => {
    const name = newName.trim();
    if (!name) return;
    if (salesStations.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      showToast("Un poste porte déjà ce nom.");
      return;
    }
    setSalesStations((prev) => [...prev, { id: uid(), name, sellerNames: [], activeSellerName: null, sellerEmails: [], activeSellerEmail: null }]);
    logAudit("Administration", "Ajout d'un poste de vente", name);
    setNewName("");
  };
  const renameStation = (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSalesStations((prev) => prev.map((s) => (s.id === id ? { ...s, name: trimmed } : s)));
  };
  const removeStation = (station) => {
    if (!isPrimaryAdmin) { showToast("Seul l'administrateur principal peut retirer un poste de vente."); return; }
    if (!window.confirm(`Retirer le poste « ${station.name} » ? Les ventes déjà enregistrées sous ce nom resteront visibles dans les rapports passés.`)) return;
    setSalesStations((prev) => prev.filter((s) => s.id !== station.id));
    logAudit("Administration", "Retrait d'un poste de vente", station.name);
  };

  const addSellerName = (station) => {
    const name = (newSellerName[station.id] || "").trim();
    if (!name) return;
    if ((station.sellerNames || []).some((n) => n.toLowerCase() === name.toLowerCase())) { showToast("Ce nom est déjà dans la liste."); return; }
    setSalesStations((prev) => prev.map((s) => (s.id === station.id
      ? { ...s, sellerNames: [...(s.sellerNames || []), name], activeSellerName: s.activeSellerName || name }
      : s)));
    setNewSellerName((prev) => ({ ...prev, [station.id]: "" }));
  };
  const removeSellerName = (station, name) => {
    if (!isPrimaryAdmin) { showToast("Seul l'administrateur principal peut retirer un nom de vendeur."); return; }
    setSalesStations((prev) => prev.map((s) => (s.id === station.id
      ? { ...s, sellerNames: (s.sellerNames || []).filter((n) => n !== name), activeSellerName: s.activeSellerName === name ? null : s.activeSellerName }
      : s)));
  };
  const addSellerEmail = (station) => {
    const email = (newSellerEmail[station.id] || "").trim();
    if (!email) return;
    if ((station.sellerEmails || []).some((e) => e.toLowerCase() === email.toLowerCase())) { showToast("Cet email est déjà dans la liste."); return; }
    setSalesStations((prev) => prev.map((s) => (s.id === station.id
      ? { ...s, sellerEmails: [...(s.sellerEmails || []), email], activeSellerEmail: s.activeSellerEmail || email }
      : s)));
    setNewSellerEmail((prev) => ({ ...prev, [station.id]: "" }));
  };
  const removeSellerEmail = (station, email) => {
    if (!isPrimaryAdmin) { showToast("Seul l'administrateur principal peut retirer un email."); return; }
    setSalesStations((prev) => prev.map((s) => (s.id === station.id
      ? { ...s, sellerEmails: (s.sellerEmails || []).filter((e) => e !== email), activeSellerEmail: s.activeSellerEmail === email ? null : s.activeSellerEmail }
      : s)));
  };

  return (
    <div className="space-y-6 max-w-md">
      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Postes de vente</div>
        <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
          Créez un poste par appareil de vente physique (ex. « Caisse 1 », « Comptoir »). Sur chaque appareil, le vendeur choisit ensuite lui-même son poste dans l'onglet Point de vente — ce choix reste propre à cet appareil. Le nom actif s'affiche sur la fiche de vente ; le nom et l'email actifs apparaissent tous les deux dans les rapports.
        </p>
        <div className="flex gap-2 mb-4">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addStation()}
            placeholder="Nom du nouveau poste" className="flex-1 border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }} />
          <button onClick={addStation} className="px-3 py-1.5 rounded text-xs text-white shrink-0" style={{ background: "#152238" }}>Ajouter</button>
        </div>
        {salesStations.length === 0 ? (
          <div className="text-xs py-4 text-center" style={{ color: "#A39C87" }}>Aucun poste créé — tant qu'aucun poste n'existe, les ventes fonctionnent normalement sans distinction.</div>
        ) : (
          <div className="space-y-4">
            {salesStations.map((s) => (
              <div key={s.id} className="p-3 rounded" style={{ border: "1px solid #EEE9DA" }}>
                <div className="flex items-center gap-2 mb-3">
                  <input defaultValue={s.name} onBlur={(e) => renameStation(s.id, e.target.value)}
                    className="flex-1 border rounded px-2 py-1.5 text-sm font-medium" style={{ borderColor: "#DDD6C4" }} />
                  <button onClick={() => removeStation(s)} className="p-1.5 rounded" style={{ color: "#A6432F" }}><Trash2 size={14} /></button>
                </div>

                <div className="text-xs font-medium mb-1" style={{ color: "#7A7460" }}>Noms de vendeurs affiliés</div>
                <div className="space-y-1 mb-2">
                  {(s.sellerNames || []).length === 0 && <div className="text-xs" style={{ color: "#A39C87" }}>Aucun nom — la fiche de vente n'affichera aucun vendeur.</div>}
                  {(s.sellerNames || []).map((name) => (
                    <div key={name} className="flex items-center gap-2 text-xs min-w-0">
                      <input type="radio" checked={s.activeSellerName === name} className="shrink-0"
                        onChange={() => setSalesStations((prev) => prev.map((st) => (st.id === s.id ? { ...st, activeSellerName: name } : st)))} />
                      <span className={`min-w-0 flex-1 truncate ${s.activeSellerName === name ? "font-medium" : ""}`} style={{ color: "#152238" }} title={name}>{name}</span>
                      {s.activeSellerName === name && <span className="text-xs px-1.5 rounded shrink-0" style={{ background: "#E6F1EE", color: "#0F6B5C" }}>actif</span>}
                      <button onClick={() => removeSellerName(s, name)} className="shrink-0" style={{ color: "#A6432F" }}><Trash2 size={12} /></button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 mb-3">
                  <input value={newSellerName[s.id] || ""} onChange={(e) => setNewSellerName((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && addSellerName(s)}
                    placeholder="Nom du vendeur" className="flex-1 border rounded px-2 py-1 text-xs" style={{ borderColor: "#DDD6C4" }} />
                  <button onClick={() => addSellerName(s)} className="px-2 py-1 rounded text-xs text-white shrink-0" style={{ background: "#152238" }}>Ajouter</button>
                </div>

                <div className="text-xs font-medium mb-1" style={{ color: "#7A7460" }}>Emails affiliés</div>
                <div className="space-y-1 mb-2">
                  {(s.sellerEmails || []).length === 0 && <div className="text-xs" style={{ color: "#A39C87" }}>Aucun email affilié.</div>}
                  {(s.sellerEmails || []).map((email) => (
                    <div key={email} className="flex items-center gap-2 text-xs min-w-0">
                      <input type="radio" checked={s.activeSellerEmail === email} className="shrink-0"
                        onChange={() => setSalesStations((prev) => prev.map((st) => (st.id === s.id ? { ...st, activeSellerEmail: email } : st)))} />
                      <span className={`min-w-0 flex-1 truncate ${s.activeSellerEmail === email ? "font-medium" : ""}`} style={{ color: "#152238" }} title={email}>{email}</span>
                      {s.activeSellerEmail === email && <span className="text-xs px-1.5 rounded shrink-0" style={{ background: "#E6F1EE", color: "#0F6B5C" }}>actif</span>}
                      <button onClick={() => removeSellerEmail(s, email)} className="shrink-0" style={{ color: "#A6432F" }}><Trash2 size={12} /></button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={newSellerEmail[s.id] || ""} onChange={(e) => setNewSellerEmail((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && addSellerEmail(s)}
                    placeholder="Email du vendeur" className="flex-1 border rounded px-2 py-1 text-xs" style={{ borderColor: "#DDD6C4" }} />
                  <button onClick={() => addSellerEmail(s)} className="px-2 py-1 rounded text-xs text-white shrink-0" style={{ background: "#152238" }}>Ajouter</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AdminModule({
  settings, setSettings, users, setUsers, currentUserEmail, companyId,
  accounts, entries, products, productImages, invoices, suppliers, purchases, movements, clients, auditLog,
  employees, payslips, salaryAdvances, salesStations, assets, accruals, deferrals, riskProvisions,
  setAccounts, setEntries, setProducts, setProductImages, setInvoices, setSuppliers, setPurchases, setMovements, setClients,
  setEmployees, setPayslips, setSalaryAdvances, setSalesStations, setAssets, setAccruals, setDeferrals, setRiskProvisions,
  showToast, logAudit, planTier,
}) {
  const [tab, setTab] = useState("entreprise");
  const [companyName, setCompanyName] = useState(settings.companyName);
  const [companyAddress, setCompanyAddress] = useState(settings.companyAddress || "");
  const [companyPhone, setCompanyPhone] = useState(settings.companyPhone || "");
  const [companyEmail, setCompanyEmail] = useState(settings.companyEmail || "");
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
  const [newUser, setNewUser] = useState({ email: "", role: "Éditeur", assistedSupervisor: false });
  const [lastInviteLink, setLastInviteLink] = useState(null);
  const [lockDate, setLockDate] = useState(settings.lockDate || "");
  const [members, setMembers] = useState([]);
  const [myCompanyId, setMyCompanyId] = useState(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const isPrimaryAdmin = members.find((m) => currentUserEmail && m.email?.toLowerCase() === currentUserEmail.toLowerCase())?.is_primary_admin || false;
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
      if (!error) setMembers(data || []);
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
      const { data: clash } = await supabase
        .from("companies")
        .select("id")
        .ilike("name", finalName)
        .neq("id", companyId)
        .maybeSingle();
      if (clash) {
        showToast(`Le nom « ${finalName} » est déjà utilisé par une autre entreprise — choisissez-en un autre.`);
        return;
      }
      await supabase.from("companies").update({ name: finalName }).eq("id", companyId);
    } catch (e) {
      // Hors mode Supabase (ou vérification indisponible) : on n'empêche jamais
      // l'enregistrement local sur un simple souci réseau ponctuel.
    }
    setSettings({ ...settings, companyName: finalName, companyAddress, companyPhone, companyEmail, currency });
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

      const { data: existingRows, error: fetchErr } = await supabase
        .from("company_members")
        .select("id, company_id, user_id, role, invite_token")
        .eq("email", email)
        .limit(1);

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

      if (existing) {
        if (existing.company_id !== companyId) {
          showToast("Cette adresse est déjà rattachée à une autre entreprise.");
          return;
        }
        // Membre déjà existant (invitation en attente ou compte déjà actif) :
        // on ne touche JAMAIS à user_id, seulement au rôle — pour ne jamais
        // déconnecter un compte déjà réclamé en réinvitant la même personne.
        // Un jeton est généré s'il n'en existe pas déjà (invitation créée avant
        // ce système), pour que même une ré-invitation obtienne un lien à jour.
        const token = existing.invite_token || genInviteToken();
        const updates = { role: newUser.role, is_assisted_supervisor: newUser.assistedSupervisor };
        if (!existing.invite_token) updates.invite_token = token;
        const { error: updateErr } = await supabase
          .from("company_members")
          .update(updates)
          .eq("id", existing.id);
        if (updateErr) {
          showToast("Impossible de mettre à jour cette invitation.");
          return;
        }
        setNewUser({ email: "", role: "Éditeur", assistedSupervisor: false });
        if (!existing.user_id) setLastInviteLink({ email, link: buildInviteLink(token) });
        showToast(existing.user_id
          ? `${email} est déjà membre — rôle mis à jour.`
          : `Invitation déjà existante pour ${email} — rôle mis à jour.`);
        logAudit("Administration", "Mise à jour invitation existante", `${email} — rôle ${newUser.role}`);
        loadMembers();
        return;
      }

      const token = genInviteToken();
      const { error } = await supabase
        .from("company_members")
        .insert({ company_id: companyId, email, role: newUser.role, is_assisted_supervisor: newUser.assistedSupervisor, invite_token: token });
      if (error) {
        showToast(error.code === "23505" ? "Cette personne est déjà membre." : "Impossible d'ajouter cette personne.");
        return;
      }
      setNewUser({ email: "", role: "Éditeur", assistedSupervisor: false });
      setLastInviteLink({ email, link: buildInviteLink(token) });
      showToast(`Invitation créée pour ${email}.`);
      logAudit("Administration", "Invitation utilisateur", `${email} — rôle ${newUser.role}`);
      loadMembers();
    } catch (e) {
      showToast("Fonction disponible uniquement en mode Supabase.");
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
    const isAssisted = selectedLabel === "Superviseur assisté";
    const role = isAssisted ? "Administrateur" : selectedLabel;
    await supabase.from("company_members").update({ role, is_assisted_supervisor: isAssisted }).eq("id", member.id);
    loadMembers();
    showToast("Rôle mis à jour.");
    logAudit("Administration", "Changement de rôle", `${member.email} — ${selectedLabel}`);
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
  const buildExportData = () => ({ accounts, entries, products, productImages, invoices, suppliers, purchases, movements, clients, settings, users, employees, payslips, salaryAdvances, salesStations, assets, accruals, deferrals, riskProvisions });
  const exportData = () => {
    const data = buildExportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sauvegarde-${settings.companyName || "erp"}-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    const now = new Date().toISOString();
    try { localStorage.setItem("compta-plus-last-export", now); } catch (e) { /* stockage local indisponible, tant pis pour le rappel */ }
    setLastExportAt(now);
    showToast("Export généré.");
  };
  const [showCopyExport, setShowCopyExport] = useState(false);
  const [exportText, setExportText] = useState("");
  const exportTextareaRef = React.useRef(null);
  const openCopyExport = () => {
    setExportText(JSON.stringify(buildExportData()));
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
    assets: { kind: "array", requiredKeys: ["id", "name"], numericKeys: ["originalValue", "usefulLifeYears", "accumulatedDepreciation"] },
    accruals: { kind: "array", requiredKeys: ["id", "type"], numericKeys: ["amount"], dateKeys: ["date"] },
    deferrals: { kind: "array", requiredKeys: ["id", "type"], numericKeys: ["totalAmount", "months", "amountRecognized"], dateKeys: ["startDate"] },
    riskProvisions: { kind: "array", requiredKeys: ["id", "label"], numericKeys: ["currentAmount"], dateKeys: ["date"] },
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

  const applyImportedJson = (rawText, sourceLabel) => {
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      showToast(`Fichier invalide (JSON illisible) : ${err.message}`);
      return;
    }
    const result = validateImportData(parsed);
    if (!result.ok) {
      showToast(`Import refusé : ${result.error}`);
      return;
    }
    const summary = Object.entries(result.counts).map(([k, n]) => `${k}: ${n}`).join(", ");
    const sourceCompanyName = parsed?.settings?.companyName || "(nom inconnu dans le fichier)";
    if (!window.confirm(
      `Vous allez importer les données de « ${sourceCompanyName} » dans « ${settings.companyName || "cette entreprise"} ».\n\n` +
      `Cela va REMPLACER les données actuelles de « ${settings.companyName || "cette entreprise"} » par :\n${summary}\n\n` +
      `Cette action est irréversible pour les données non exportées récemment. Continuer ?`
    )) {
      return;
    }
    const { data } = result;
    if (data.accounts) setAccounts(data.accounts);
    if (data.entries) setEntries(data.entries);
    if (data.products) setProducts(data.products);
    if (data.productImages) setProductImages(data.productImages);
    if (data.invoices) setInvoices(data.invoices);
    if (data.suppliers) setSuppliers(data.suppliers);
    if (data.purchases) setPurchases(data.purchases);
    if (data.movements) setMovements(data.movements);
    if (data.clients) setClients(data.clients);
    if (data.settings) setSettings(data.settings);
    if (data.users) setUsers(data.users);
    if (data.employees) setEmployees(data.employees);
    if (data.salesStations) setSalesStations(data.salesStations);
    if (data.assets) setAssets(data.assets);
    if (data.accruals) setAccruals(data.accruals);
    if (data.deferrals) setDeferrals(data.deferrals);
    if (data.riskProvisions) setRiskProvisions(data.riskProvisions);
    if (data.payslips) setPayslips(data.payslips);
    if (data.salaryAdvances) setSalaryAdvances(data.salaryAdvances);
    showToast("Données importées avec succès.");
    logAudit("Administration", "Import de données", sourceLabel);
  };

  const importData = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    // Sans ce gestionnaire, une lecture qui échoue (permission refusée sur l'URI
    // renvoyée par le sélecteur de fichiers Android, fichier corrompu, etc.) ne
    // montrait absolument rien à l'écran — ni erreur, ni confirmation.
    reader.onerror = () => {
      showToast(`Impossible de lire le fichier « ${file.name} » (${reader.error?.message || "erreur inconnue"}).`);
      e.target.value = "";
    };
    reader.onload = (evt) => {
      applyImportedJson(evt.target.result, file.name);
      e.target.value = "";
    };
    try {
      reader.readAsText(file);
    } catch (err) {
      showToast(`Erreur au lancement de la lecture du fichier : ${err.message}`);
    }
  };
  const [pastedJson, setPastedJson] = useState("");
  const [showPasteImport, setShowPasteImport] = useState(false);

  const resetData = () => {
    if (!isPrimaryAdmin) { showToast("Seul l'administrateur principal peut réinitialiser les données de l'entreprise."); return; }
    if (!window.confirm("Réinitialiser toutes les données de l'application ? Cette action est irréversible.")) return;
    const typed = window.prompt(
      'Action irréversible. Pour confirmer, tapez exactement RÉINITIALISER (en majuscules) :'
    );
    // Beaucoup de claviers (surtout mobile) ne permettent pas de taper une
    // majuscule accentuée facilement — on accepte donc aussi bien "RÉINITIALISER"
    // que "REINITIALISER" pour ne pas bloquer une confirmation légitime.
    const normalized = (typed || "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (normalized !== "REINITIALISER") {
      showToast("Réinitialisation annulée.");
      return;
    }
    setAccounts(DEFAULT_ACCOUNTS);
    setEntries([]);
    setProducts(DEFAULT_PRODUCTS);
    setProductImages({});
    setInvoices([]);
    setSuppliers(DEFAULT_SUPPLIERS);
    setPurchases([]);
    setMovements([]);
    setClients(DEFAULT_CLIENTS);
    setEmployees([]);
    setPayslips([]);
    setSalaryAdvances([]);
    setSalesStations([]);
    setAssets([]);
    setAccruals([]);
    setDeferrals([]);
    setRiskProvisions([]);
    showToast("Données réinitialisées.");
    logAudit("Administration", "Réinitialisation des données", "");
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module 8</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Administration et paramètres</div>
      </header>

      <div className="flex gap-1 mb-6 overflow-x-auto">
        {[["entreprise", "Entreprise"], ["ouverture", "Solde d'ouverture"], ...(planTier === "assisted" ? [["postes", "Postes de vente"]] : []), ["utilisateurs", "Utilisateurs"], ["donnees", "Données"], ["historique", "Historique"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className="px-4 py-2 text-sm rounded-t shrink-0 whitespace-nowrap"
            style={{
              background: tab === id ? "#fff" : "transparent",
              borderBottom: tab === id ? "2px solid #C9A24B" : "2px solid transparent",
              color: tab === id ? "#152238" : "#8A8370",
              fontWeight: tab === id ? 600 : 400,
            }}>
            {label}
          </button>
        ))}
      </div>

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

          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Méthode comptable du stock</div>
            <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
              <b>Stock en charge</b> (par défaut) : simple, mais ne respecte pas les normes comptables formelles si vous conservez du stock d'une période à l'autre.<br/>
              <b>Stock en actif</b> : le stock devient un actif au bilan, sorti au coût moyen pondéré à chaque vente — la méthode conforme, recommandée si vous présentez vos comptes à un tiers (banque, audit, fisc).
            </p>
            <div className="flex gap-2">
              <button onClick={() => setSettings({ ...settings, stockValuationMethod: "charge" })}
                className="px-3 py-2 rounded text-xs text-left flex-1" style={{ background: (settings.stockValuationMethod || "charge") === "charge" ? "#152238" : "#F3EFE3", color: (settings.stockValuationMethod || "charge") === "charge" ? "#fff" : "#7A7460" }}>
                Stock en charge<br/><span className="opacity-75">(actuel)</span>
              </button>
              <button onClick={() => {
                  if (window.confirm("Passer en stock-actif ? À partir de maintenant, chaque vente de marchandise générera aussi une écriture de sortie de stock (6037) au coût moyen pondéré. Les ventes déjà enregistrées ne sont pas recalculées rétroactivement.")) {
                    setSettings({ ...settings, stockValuationMethod: "actif" });
                  }
                }}
                className="px-3 py-2 rounded text-xs text-left flex-1" style={{ background: settings.stockValuationMethod === "actif" ? "#152238" : "#F3EFE3", color: settings.stockValuationMethod === "actif" ? "#fff" : "#7A7460" }}>
                Stock en actif<br/><span className="opacity-75">(conforme)</span>
              </button>
            </div>
          </div>

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

      {tab === "utilisateurs" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
            Invitez une personne par email : dès qu'elle se connecte avec cette adresse, elle rejoint automatiquement cette entreprise avec le rôle choisi. <b>Lecture seule</b> permet de consulter sans rien modifier ; <b>Vendeur</b> n'a accès qu'au point de vente (POS), sans voir la comptabilité, les rapports ni l'administration ; <b>Éditeur</b> permet de saisir et modifier les données sur tous les modules ; <b>Administrateur</b> a en plus accès à ce module.
            {planTier === "assisted" && <> <b>Superviseur assisté</b> a les mêmes droits qu'Administrateur (sauf ceux réservés à l'administrateur principal) et bénéficie en plus des alertes et suggestions du mode Assisté.</>}
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
                value={newUser.assistedSupervisor ? "Superviseur assisté" : newUser.role}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "Superviseur assisté") setNewUser({ ...newUser, role: "Administrateur", assistedSupervisor: true });
                  else setNewUser({ ...newUser, role: v, assistedSupervisor: false });
                }}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option>Administrateur</option>
                {planTier === "assisted" && <option>Superviseur assisté</option>}
                <option>Éditeur</option>
                <option>Vendeur</option>
                <option>Lecture seule</option>
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
                    {m.is_primary_admin && (
                      <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded" style={{ background: "#FBF1DC", color: "#9A7B1E" }} title="Administrateur principal — a créé cette entreprise, ne peut pas être retiré ni rétrogradé par un autre administrateur">
                        ★ principal
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    <select value={m.is_assisted_supervisor ? "Superviseur assisté" : m.role} onChange={(e) => changeUserRole(m, e.target.value)}
                      disabled={locked}
                      title={locked ? "Un administrateur principal ne peut pas être rétrogradé par un autre administrateur." : undefined}
                      className="border rounded px-2 py-1 text-xs" style={{ borderColor: "#DDD6C4", opacity: locked ? 0.6 : 1 }}>
                      <option>Administrateur</option>
                      {planTier === "assisted" && <option>Superviseur assisté</option>}
                      <option>Éditeur</option>
                      <option>Vendeur</option>
                      <option>Lecture seule</option>
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg p-5" style={{ border: "1px solid #E4DFD1" }}>
            <Download size={18} style={{ color: "#0F6B5C" }} className="mb-2" />
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Exporter les données</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Télécharge une sauvegarde complète au format JSON.</p>
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
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Remplace les données actuelles par celles du fichier.</p>
            <input type="file" accept="application/json" ref={fileInputRef} onChange={importData} className="hidden" />
            <div className="flex flex-wrap gap-2">
              <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>Importer un fichier</button>
              <button onClick={() => setShowPasteImport((v) => !v)} className="px-3 py-1.5 rounded text-xs" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>
                {showPasteImport ? "Annuler" : "Coller le texte à la place"}
              </button>
            </div>
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
                    if (!pastedJson.trim()) { showToast("Collez d'abord le contenu JSON."); return; }
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
          <div className="bg-white rounded-lg p-5" style={{ border: "1px solid #E4DFD1" }}>
            <RotateCcw size={18} style={{ color: "#A6432F" }} className="mb-2" />
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Réinitialiser</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Efface toutes les données transactionnelles et repart d'un plan comptable vierge.</p>
            {isPrimaryAdmin ? (
              <button onClick={resetData} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#A6432F" }}>Réinitialiser</button>
            ) : (
              <p className="text-xs" style={{ color: "#A39C87" }}>Réservé à l'administrateur principal.</p>
            )}
          </div>
        </div>
        </div>
      )}

      {tab === "historique" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
            Historique de toutes les modifications apportées à l'application, avec l'auteur, le module concerné et l'horodatage.
          </p>
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
      )}
    </div>
  );
}

function ComingSoon({ module }) {
  const Icon = module.icon;
  return (
    <div className="p-8 max-w-3xl">
      <div className="rounded-lg p-10 text-center bg-white" style={{ border: "1px dashed #DDD6C4" }}>
        <Icon size={28} className="mx-auto mb-3" style={{ color: "#C9A24B" }} />
        <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "#C9A24B" }}>Module {module.n}</div>
        <div className="display text-2xl mb-2" style={{ color: "#152238" }}>{module.label}</div>
        <p className="text-sm" style={{ color: "#8A8370" }}>
          Ce module sera développé à l'étape suivante, une fois le module Comptabilité validé, en respectant l'ordre défini.
        </p>
        <div className="flex items-center justify-center gap-1 mt-4 text-xs" style={{ color: "#A39C87" }}>
          <span>Comptabilité</span><ChevronRight size={12} /><span>...</span><ChevronRight size={12} /><span>{module.label}</span>
        </div>
      </div>
    </div>
  );
}

// --- Super Admin (toi seul) : gestion des abonnements et paiements manuels de tous
// les clients (MonCash, NatCash, virement...). Séparé de l'AdminModule habituel, qui
// lui reste cantonné à une seule entreprise. Aucun accès aux données comptables des
// clients (kv_store) — uniquement au statut d'abonnement et à l'historique de paiement.
const PAYMENT_METHODS = [
  { id: "moncash", label: "MonCash" },
  { id: "natcash", label: "NatCash" },
  { id: "virement", label: "Virement bancaire" },
  { id: "stripe", label: "Stripe" },
  { id: "autre", label: "Autre" },
];

function SuperAdminModule({ showToast }) {
  const [tab, setTab] = useState("dashboard"); // dashboard | entreprises | rapports | erreurs
  const [errorLogs, setErrorLogs] = useState(null); // null = pas encore chargé
  const [rapPeriod, setRapPeriod] = useState("annee"); // mois | trimestre | annee | tout
  const [rapGroupBy, setRapGroupBy] = useState("mois"); // mois | trimestre | annee
  const [rapCurrency, setRapCurrency] = useState(""); // "" = toutes
  const [companies, setCompanies] = useState(null); // null = en cours de chargement
  const [openId, setOpenId] = useState(null);
  const [payments, setPayments] = useState({}); // companyId -> liste de paiements (détail par entreprise)
  const [allPayments, setAllPayments] = useState(null); // null = en cours de chargement — tous les paiements, toutes entreprises confondues, pour le tableau de bord
  const [form, setForm] = useState({ method: "moncash", amount: "", currency: "HTG", date: todayStr(), reference: "", note: "", durationDays: 30 });
  // Taux de conversion USD→HTG, même mécanisme que le paiement MonCash du forfait
  // Standard côté client — sert à pré-remplir automatiquement le montant en gourdes
  // pour les deux forfaits (Standard 20 $ / Assisté 80 $), en restant modifiable.
  const [htgRate, setHtgRate] = useState(null);
  useEffect(() => { fetchHtgPerUsd().then((rate) => setHtgRate(rate)); }, []);
  const usdToHtg = (usd) => Math.round((usd * (htgRate || FALLBACK_HTG_PER_USD)) / 10) * 10;
  const [q, setQ] = useState("");
  const [histFrom, setHistFrom] = useState("");
  const [histTo, setHistTo] = useState("");
  const [histCompanyFilter, setHistCompanyFilter] = useState("");

  const loadCompanies = async () => {
    let { data, error } = await supabase.from("companies").select("id, name, plan_status, plan_tier, trial_ends_at, created_at, signup_device_id").order("created_at", { ascending: false });
    if (error && error.code === "42703") {
      // Colonne signup_device_id pas encore migrée : repli sans elle plutôt que de
      // casser tout le panneau Super Admin.
      const retry = await supabase.from("companies").select("id, name, plan_status, trial_ends_at, created_at").order("created_at", { ascending: false });
      data = retry.data; error = retry.error;
    }
    if (error) { showToast("Impossible de charger les entreprises."); setCompanies([]); return; }
    setCompanies(data || []);
  };

  const loadAllPayments = async () => {
    const { data, error } = await supabase.from("payments").select("*").order("date", { ascending: false });
    if (error) { setAllPayments([]); return; }
    setAllPayments(data || []);
  };

  const loadErrorLogs = async () => {
    const { data, error } = await supabase.from("error_logs").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) { setErrorLogs([]); return; }
    setErrorLogs(data || []);
  };

  useEffect(() => { loadCompanies(); loadAllPayments(); }, []);
  // Chargé seulement à la première ouverture de l'onglet, pas systématiquement —
  // ces journaux ne sont consultés qu'occasionnellement, contrairement au
  // tableau de bord et aux entreprises.
  useEffect(() => { if (tab === "erreurs" && errorLogs === null) loadErrorLogs(); }, [tab]);

  const loadPayments = async (companyId) => {
    const { data } = await supabase.from("payments").select("*").eq("company_id", companyId).order("date", { ascending: false });
    setPayments((p) => ({ ...p, [companyId]: data || [] }));
  };

  const toggleOpen = (co) => {
    if (openId === co.id) { setOpenId(null); return; }
    setOpenId(co.id);
    // Montant pré-rempli automatiquement selon le forfait actif de l'entreprise
    // (80 $ Assisté / 20 $ Standard), converti en gourdes au taux de référence —
    // même mécanisme que le paiement MonCash du forfait Standard côté client.
    // Reste librement modifiable si le montant réellement reçu diffère.
    const priceUSD = co.plan_tier === "assisted" ? 80 : 20;
    setForm({ method: "moncash", amount: String(usdToHtg(priceUSD)), currency: "HTG", date: todayStr(), reference: "", note: "", durationDays: 30 });
    if (!payments[co.id]) loadPayments(co.id);
  };

  const setStatus = async (co, status) => {
    const updates = { plan_status: status };
    // "Marquer actif" fixe (ou prolonge) la date de fin d'abonnement à partir
    // d'aujourd'hui + la durée choisie, pour que le décompte de jours restants et la
    // suspension automatique côté client aient une date à laquelle se référer.
    if (status === "active") {
      const days = Number(form.durationDays) || 30;
      const end = new Date();
      end.setDate(end.getDate() + days);
      updates.trial_ends_at = end.toISOString().slice(0, 10);
    }
    const { error } = await supabase.from("companies").update(updates).eq("id", co.id);
    if (error) { showToast("Échec de la mise à jour du statut."); return; }
    setCompanies((prev) => prev.map((c) => (c.id === co.id ? { ...c, ...updates } : c)));
    showToast(`Statut mis à jour : ${status}.`);
  };

  // Bascule manuelle du forfait Standard/Assisté — en attendant que MonCash
  // (actuellement en pause côté production) gère ce choix directement à la
  // souscription, c'est le Super Admin qui active ce forfait après avoir reçu
  // le paiement, exactement comme "Enregistrer un paiement" ci-dessous.
  const setPlanTierForCompany = async (co, tier) => {
    const { error } = await supabase.from("companies").update({ plan_tier: tier }).eq("id", co.id);
    if (error) { showToast("Échec de la mise à jour du forfait."); return; }
    setCompanies((prev) => prev.map((c) => (c.id === co.id ? { ...c, plan_tier: tier } : c)));
    // Si le panneau de paiement de cette entreprise est déjà ouvert, on rafraîchit
    // aussi le montant pré-rempli pour refléter le nouveau forfait immédiatement.
    if (openId === co.id) {
      setForm((f) => ({ ...f, amount: String(usdToHtg(tier === "assisted" ? 80 : 20)), currency: "HTG" }));
    }
    showToast(tier === "assisted" ? `${co.name} passe au forfait Assisté (80 $/mois).` : `${co.name} repasse au forfait Standard.`);
  };

  // Suppression complète et irréversible d'une entreprise (données + membres +
  // l'entreprise elle-même) — passe par une fonction RPC dédiée côté serveur
  // (SECURITY DEFINER) plutôt que des suppressions directes multi-tables, pour que
  // toute la logique sensible soit centralisée et vérifiée à un seul endroit côté
  // base de données, réservée aux administrateurs de la plateforme.
  const deleteCompany = async (co) => {
    const typed = window.prompt(
      `Cette action supprime DÉFINITIVEMENT l'entreprise "${co.name}" et TOUTES ses données (écritures, factures, membres, etc.) — irréversible, aucune sauvegarde de secours.\n\nPour confirmer, tapez exactement le nom de l'entreprise : ${co.name}`
    );
    if (typed !== co.name) { showToast("Suppression annulée — le nom saisi ne correspond pas."); return; }
    const { error } = await supabase.rpc("delete_company_and_data", { target_company_id: co.id });
    if (error) { showToast(`Échec de la suppression (${error.message || error.code}).`); return; }
    setCompanies((prev) => prev.filter((c) => c.id !== co.id));
    if (openId === co.id) setOpenId(null);
    showToast(`Entreprise "${co.name}" supprimée définitivement.`);
  };

  const recordPayment = async (co) => {
    if (!form.amount || Number(form.amount) <= 0) {
      showToast("Montant invalide.");
      return;
    }
    if (isFutureDate(form.date)) {
      showToast("Impossible d'enregistrer un paiement à une date future.");
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("payments").insert({
      company_id: co.id, method: form.method, amount: Number(form.amount), currency: form.currency,
      date: form.date, reference: form.reference || null, note: form.note || null, recorded_by: user?.email || null,
    });
    if (error) { showToast("Échec de l'enregistrement du paiement."); return; }
    // Le paiement active le compte ET fixe la nouvelle date de fin d'abonnement à
    // partir d'aujourd'hui + la durée choisie (pas depuis l'ancienne date d'essai/
    // d'abonnement, potentiellement déjà expirée).
    const days = Number(form.durationDays) || 30;
    const end = new Date();
    end.setDate(end.getDate() + days);
    const trialEndsAt = end.toISOString().slice(0, 10);
    await supabase.from("companies").update({ plan_status: "active", trial_ends_at: trialEndsAt }).eq("id", co.id);
    setCompanies((prev) => prev.map((c) => (c.id === co.id ? { ...c, plan_status: "active", trial_ends_at: trialEndsAt } : c)));
    setForm({ method: "moncash", amount: "", currency: "HTG", date: todayStr(), reference: "", note: "", durationDays: 30 });
    loadPayments(co.id);
    loadAllPayments();
    showToast(`Paiement enregistré — ${co.name} est actif jusqu'au ${trialEndsAt}.`);
  };

  if (companies === null) {
    return <div className="p-8 text-sm" style={{ color: "#8A8370" }}>Chargement des entreprises…</div>;
  }

  const filtered = companies.filter((c) => (c.name || "").toLowerCase().includes(q.toLowerCase()));
  // S'applique aussi bien à un compte en essai qu'à un compte actif : trial_ends_at
  // sert de date de fin générique (fin d'essai OU fin de la période payée en cours).
  const daysLeft = (co) => co.trial_ends_at ? Math.ceil((new Date(co.trial_ends_at) - new Date()) / 86400000) : null;
  // Repère les appareils ayant créé plusieurs entreprises (signe probable d'abus de
  // l'essai gratuit — un même appareil ayant contourné le blocage côté client).
  const deviceCounts = {};
  companies.forEach((c) => { if (c.signup_device_id) deviceCounts[c.signup_device_id] = (deviceCounts[c.signup_device_id] || 0) + 1; });
  const isSuspiciousDevice = (co) => co.signup_device_id && deviceCounts[co.signup_device_id] > 1;

  // --- Statistiques du tableau de bord ---
  const totalCompanies = companies.length;
  const activeCompanies = companies.filter((c) => c.plan_status === "active").length;
  const suspendedCompanies = companies.filter((c) => c.plan_status === "suspended").length;
  const trialCompanies = companies.filter((c) => !c.plan_status || c.plan_status === "trial").length;
  const companyNameById = Object.fromEntries(companies.map((c) => [c.id, c.name || "(sans nom)"]));

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfQuarter = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const sumByCurrency = (list) => {
    const out = {};
    list.forEach((p) => { out[p.currency || "HTG"] = (out[p.currency || "HTG"] || 0) + Number(p.amount || 0); });
    return out;
  };
  const paymentsSince = (start) => (allPayments || []).filter((p) => p.date && new Date(p.date) >= start);
  const revenueMonth = sumByCurrency(paymentsSince(startOfMonth));
  const revenueQuarter = sumByCurrency(paymentsSince(startOfQuarter));
  const revenueYear = sumByCurrency(paymentsSince(startOfYear));
  const currenciesPresent = [...new Set((allPayments || []).map((p) => p.currency || "HTG"))];
  const primaryCurrency = currenciesPresent.includes("HTG") ? "HTG" : (currenciesPresent[0] || "HTG");

  // Revenus mensuels (12 derniers mois, devise principale uniquement — mélanger des
  // devises différentes dans un même total serait trompeur) pour le graphique.
  const monthlyRevenue = (() => {
    const byMonth = {};
    (allPayments || []).filter((p) => (p.currency || "HTG") === primaryCurrency).forEach((p) => {
      const key = monthLabel(p.date);
      byMonth[key] = (byMonth[key] || 0) + Number(p.amount || 0);
    });
    return Object.entries(byMonth).map(([mois, total]) => ({ mois, total }));
  })();

  const filteredHistory = (allPayments || []).filter((p) => {
    if (histFrom && p.date < histFrom) return false;
    if (histTo && p.date > histTo) return false;
    if (histCompanyFilter && p.company_id !== histCompanyFilter) return false;
    return true;
  });

  // --- Rapports et analyse : activité économique liée aux abonnements ---
  const rapPeriodStart = (() => {
    if (rapPeriod === "mois") return startOfMonth;
    if (rapPeriod === "trimestre") return startOfQuarter;
    if (rapPeriod === "annee") return startOfYear;
    return null; // "tout"
  })();
  const rapPayments = (allPayments || []).filter((p) => {
    if (rapPeriodStart && p.date && new Date(p.date) < rapPeriodStart) return false;
    if (rapCurrency && (p.currency || "HTG") !== rapCurrency) return false;
    return true;
  });
  const rapRevenueOverTime = (() => {
    const byPeriod = {};
    rapPayments.forEach((p) => {
      const key = periodLabel(p.date, rapGroupBy);
      byPeriod[key] = (byPeriod[key] || 0) + Number(p.amount || 0);
    });
    return Object.entries(byPeriod).map(([periode, total]) => ({ periode, total }));
  })();
  const rapByMethod = (() => {
    const byMethod = {};
    rapPayments.forEach((p) => {
      const label = PAYMENT_METHODS.find((m) => m.id === p.method)?.label || p.method || "Autre";
      byMethod[label] = (byMethod[label] || 0) + Number(p.amount || 0);
    });
    return Object.entries(byMethod).map(([name, revenue]) => ({ name, revenue }));
  })();
  const rapNewCompaniesOverTime = (() => {
    const byPeriod = {};
    companies.forEach((c) => {
      if (!c.created_at) return;
      const d = c.created_at.slice(0, 10);
      if (rapPeriodStart && new Date(d) < rapPeriodStart) return;
      const key = periodLabel(d, rapGroupBy);
      byPeriod[key] = (byPeriod[key] || 0) + 1;
    });
    return Object.entries(byPeriod).map(([periode, total]) => ({ periode, total }));
  })();
  const rapByCompany = (() => {
    const byCompany = {};
    rapPayments.forEach((p) => {
      const name = companyNameById[p.company_id] || "—";
      byCompany[name] = (byCompany[name] || 0) + Number(p.amount || 0);
    });
    return Object.entries(byCompany).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
  })();
  const rapTotalRevenue = rapPayments.reduce((s, p) => s + Number(p.amount || 0), 0);

  return (
    <div>
      {/* En-tête distinct — pour que cet espace se démarque clairement du reste de
          l'application (c'est un outil de gestion de la plateforme, pas un module
          comptable d'une entreprise cliente). */}
      <div style={{ background: "#152238" }} className="px-4 md:px-8 py-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Espace plateforme — accès réservé</div>
        <div className="display text-3xl" style={{ color: "#EFE9DD" }}>Super Admin</div>
        <p className="text-sm mt-1" style={{ color: "#8A97B5" }}>
          Gestion administrative et financière des abonnements — distincte des données comptables de chaque entreprise cliente.
        </p>
        <div className="flex gap-1 mt-5 overflow-x-auto">
          {[["dashboard", "Tableau de bord"], ["entreprises", "Entreprises"], ["rapports", "Rapports et analyse"], ["erreurs", "Erreurs"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className="px-4 py-2 text-sm rounded-t shrink-0 whitespace-nowrap"
              style={{ background: tab === id ? "#EFE9DD" : "transparent", color: tab === id ? "#152238" : "#8A97B5", fontWeight: tab === id ? 600 : 400 }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 md:p-8 max-w-6xl">
        {tab === "dashboard" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
                <div className="text-xs" style={{ color: "#8A8370" }}>Abonnés totaux</div>
                <div className="text-2xl tabular font-medium" style={{ color: "#152238" }}>{totalCompanies}</div>
              </div>
              <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
                <div className="text-xs" style={{ color: "#8A8370" }}>Actifs</div>
                <div className="text-2xl tabular font-medium" style={{ color: "#0F6B5C" }}>{activeCompanies}</div>
              </div>
              <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
                <div className="text-xs" style={{ color: "#8A8370" }}>Suspendus</div>
                <div className="text-2xl tabular font-medium" style={{ color: "#A6432F" }}>{suspendedCompanies}</div>
              </div>
              <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
                <div className="text-xs" style={{ color: "#8A8370" }}>En essai</div>
                <div className="text-2xl tabular font-medium" style={{ color: "#9A7B1E" }}>{trialCompanies}</div>
              </div>
            </div>

            {allPayments === null ? (
              <div className="text-sm py-6 text-center" style={{ color: "#A39C87" }}>Chargement des revenus…</div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[["Ce mois-ci", revenueMonth], ["Ce trimestre", revenueQuarter], ["Cette année", revenueYear]].map(([label, byCcy]) => (
                    <div key={label} className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
                      <div className="text-xs mb-1" style={{ color: "#8A8370" }}>Revenus — {label}</div>
                      {Object.keys(byCcy).length === 0 ? (
                        <div className="text-sm" style={{ color: "#A39C87" }}>Aucun paiement</div>
                      ) : (
                        Object.entries(byCcy).map(([ccy, amt]) => (
                          <div key={ccy} className="tabular" style={{ fontSize: 20, fontWeight: 600, color: "#152238" }}>{amt.toLocaleString("fr-FR")} {ccy}</div>
                        ))
                      )}
                    </div>
                  ))}
                </div>

                <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
                  <div className="text-sm font-semibold mb-4" style={{ color: "#152238" }}>Revenus par mois ({primaryCurrency})</div>
                  {monthlyRevenue.length === 0 ? (
                    <div className="text-sm py-10 text-center" style={{ color: "#A39C87" }}>Aucun paiement enregistré.</div>
                  ) : monthlyRevenue.length === 1 ? (
                    <div className="text-center py-6">
                      <div className="text-xs uppercase tracking-wide mb-1" style={{ color: "#8A8370" }}>{monthlyRevenue[0].mois}</div>
                      <div className="tabular" style={{ fontSize: 32, fontWeight: 700, color: "#0F6B5C" }}>{monthlyRevenue[0].total.toLocaleString("fr-FR")} {primaryCurrency}</div>
                    </div>
                  ) : (
                    <SimpleLineChart data={monthlyRevenue} xKey="mois" yKey="total" color="#0F6B5C" name="Revenus" />
                  )}
                </div>

                <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                    <div className="text-sm font-semibold" style={{ color: "#152238" }}>Historique global des paiements</div>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-4">
                    <input type="date" value={histFrom} onChange={(e) => setHistFrom(e.target.value)}
                      className="border rounded px-2 py-1.5 text-xs" style={{ borderColor: "#DDD6C4" }} />
                    <input type="date" value={histTo} onChange={(e) => setHistTo(e.target.value)}
                      className="border rounded px-2 py-1.5 text-xs" style={{ borderColor: "#DDD6C4" }} />
                    <select value={histCompanyFilter} onChange={(e) => setHistCompanyFilter(e.target.value)}
                      className="border rounded px-2 py-1.5 text-xs" style={{ borderColor: "#DDD6C4", width: "min(220px, 100%)", boxSizing: "border-box" }}>
                      <option value="">Toutes les entreprises</option>
                      {companies.map((c) => <option key={c.id} value={c.id}>{c.name || "(sans nom)"}</option>)}
                    </select>
                  </div>
                  {filteredHistory.length === 0 ? (
                    <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Aucun paiement pour cette sélection.</div>
                  ) : (
                    <div className="overflow-x-auto"><table className="w-full text-xs">
                      <thead>
                        <tr className="text-left" style={{ color: "#8A8370" }}>
                          <th className="py-1 font-normal">Date</th>
                          <th className="py-1 font-normal">Entreprise</th>
                          <th className="py-1 font-normal">Méthode</th>
                          <th className="py-1 font-normal text-right">Montant</th>
                          <th className="py-1 font-normal">Référence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredHistory.map((p) => (
                          <tr key={p.id} style={{ borderTop: "1px solid #F3EFE3" }}>
                            <td className="py-1 tabular">{p.date}</td>
                            <td className="py-1">{companyNameById[p.company_id] || "—"}</td>
                            <td className="py-1">{PAYMENT_METHODS.find((m) => m.id === p.method)?.label || p.method}</td>
                            <td className="py-1 tabular text-right">{Number(p.amount || 0).toLocaleString("fr-FR")} {p.currency}</td>
                            <td className="py-1">{p.reference || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table></div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {tab === "entreprises" && (
          <>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une entreprise…"
              className="w-full border rounded px-3 py-2 text-sm mb-4" style={{ borderColor: "#DDD6C4" }} />

            <div className="space-y-3">
              {filtered.length === 0 && (
                <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Aucune entreprise trouvée.</div>
              )}
              {filtered.map((co) => {
                const days = daysLeft(co);
                const isOpen = openId === co.id;
                return (
                  <div key={co.id} className="bg-white rounded-lg" style={{ border: "1px solid #E4DFD1" }}>
                    <button onClick={() => toggleOpen(co)} className="w-full flex items-center justify-between px-4 py-3 text-left">
                      <div>
                        <div className="text-sm font-medium" style={{ color: "#152238" }}>{co.name || "(sans nom)"}</div>
                        <div className="text-xs" style={{ color: "#A39C87" }}>Créée le {(co.created_at || "").slice(0, 10)}</div>
                        {isSuspiciousDevice(co) && (
                          <div className="text-xs mt-0.5 px-1.5 py-0.5 rounded inline-block" style={{ background: "#F7E9E3", color: "#A6432F" }}>
                            ⚠ Même appareil que {deviceCounts[co.signup_device_id] - 1} autre{deviceCounts[co.signup_device_id] > 2 ? "s" : ""} entreprise{deviceCounts[co.signup_device_id] > 2 ? "s" : ""}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {co.plan_tier === "assisted" && (
                          <span className="text-xs px-2 py-1 rounded" style={{ background: "#EAE3F5", color: "#5B3FA0" }}>Assisté</span>
                        )}
                        {co.plan_status === "active" && days !== null && (
                          <span className="text-xs px-2 py-1 rounded" style={{ background: days <= 3 ? "#F7E9E3" : "#F3EFE3", color: days <= 3 ? "#A6432F" : "#7A7460" }}>
                            {days > 0 ? `${days} jour${days > 1 ? "s" : ""} restant${days > 1 ? "s" : ""}` : "Expiré"}
                          </span>
                        )}
                        <span className="text-xs px-2 py-1 rounded"
                          style={{
                            background: co.plan_status === "active" ? "#E6F1EE" : co.plan_status === "suspended" ? "#F7E9E3" : "#FBF1DC",
                            color: co.plan_status === "active" ? "#0F6B5C" : co.plan_status === "suspended" ? "#A6432F" : "#9A7B1E",
                          }}>
                          {co.plan_status === "active" ? "Actif" : co.plan_status === "suspended" ? "Suspendu" : `Essai${days !== null ? ` (${days}j)` : ""}`}
                        </span>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 pt-1" style={{ borderTop: "1px solid #F3EFE3" }}>
                        <div className="flex flex-wrap items-end gap-2 mb-4 mt-3">
                          <div>
                            <label className="text-xs block mb-1" style={{ color: "#8A8370" }}>Durée (jours)</label>
                            <input type="number" min="1" value={form.durationDays}
                              onChange={(e) => setForm({ ...form, durationDays: e.target.value })}
                              className="w-20 border rounded px-2 py-1.5 text-sm tabular" style={{ borderColor: "#DDD6C4" }} />
                          </div>
                          <button onClick={() => setStatus(co, "active")} className="text-xs px-2 py-1.5 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Marquer actif (+{form.durationDays || 30}j)</button>
                          <button onClick={() => setStatus(co, "suspended")} className="text-xs px-2 py-1.5 rounded" style={{ background: "#A6432F", color: "#fff" }}>Suspendre</button>
                          <button onClick={() => setStatus(co, "trial")} className="text-xs px-2 py-1.5 rounded" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>Remettre en essai</button>
                          {co.plan_tier === "assisted" ? (
                            <button onClick={() => setPlanTierForCompany(co, "standard")} className="text-xs px-2 py-1.5 rounded" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>Repasser en Standard</button>
                          ) : (
                            <button onClick={() => setPlanTierForCompany(co, "assisted")} className="text-xs px-2 py-1.5 rounded" style={{ background: "#5B3FA0", color: "#fff" }}>Passer en Assisté (80 $/mois)</button>
                          )}
                        </div>
                        {co.trial_ends_at && (
                          <div className="text-xs mb-3" style={{ color: "#8A8370" }}>
                            Date de fin d'abonnement en cours : <span className="tabular">{co.trial_ends_at ? new Date(co.trial_ends_at).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" }) : "—"}</span>
                          </div>
                        )}

                        <div className="text-xs font-medium mb-2" style={{ color: "#152238" }}>Enregistrer un paiement</div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
                          <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}
                            className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }}>
                            {PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                          </select>
                          <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                            placeholder="Montant" className="border rounded px-2 py-1.5 text-sm tabular" style={{ borderColor: "#DDD6C4" }} />
                          <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                            className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }}>
                            <option value="HTG">HTG</option>
                            <option value="USD">USD</option>
                            <option value="MXN">MXN</option>
                          </select>
                          <input type="date" value={form.date} max={todayStr()} onChange={(e) => setForm({ ...form, date: e.target.value })}
                            className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }} />
                          <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })}
                            placeholder="Référence transaction" className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }} />
                          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
                            placeholder="Note (optionnel)" className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }} />
                        </div>
                        <button onClick={() => recordPayment(co)} className="text-xs px-3 py-1.5 rounded text-white mb-4" style={{ background: "#0F6B5C" }}>
                          Enregistrer le paiement et activer
                        </button>

                        <div className="text-xs font-medium mb-2" style={{ color: "#152238" }}>Historique des paiements</div>
                        {!payments[co.id] || payments[co.id].length === 0 ? (
                          <div className="text-xs" style={{ color: "#A39C87" }}>Aucun paiement enregistré.</div>
                        ) : (
                          <div className="overflow-x-auto"><table className="w-full text-xs">
                            <thead>
                              <tr className="text-left" style={{ color: "#8A8370" }}>
                                <th className="py-1 font-normal">Date</th>
                                <th className="py-1 font-normal">Méthode</th>
                                <th className="py-1 font-normal text-right">Montant</th>
                                <th className="py-1 font-normal">Référence</th>
                              </tr>
                            </thead>
                            <tbody>
                              {payments[co.id].map((p) => (
                                <tr key={p.id} style={{ borderTop: "1px solid #F3EFE3" }}>
                                  <td className="py-1 tabular">{p.date}</td>
                                  <td className="py-1">{PAYMENT_METHODS.find((m) => m.id === p.method)?.label || p.method}</td>
                                  <td className="py-1 tabular text-right">{p.amount} {p.currency}</td>
                                  <td className="py-1">{p.reference || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table></div>
                        )}

                        <div className="mt-5 pt-3" style={{ borderTop: "1px dashed #E4DFD1" }}>
                          <button onClick={() => deleteCompany(co)} className="text-xs px-3 py-1.5 rounded" style={{ border: "1px solid #A6432F", color: "#A6432F" }}>
                            🗑 Supprimer définitivement cette entreprise
                          </button>
                          <div className="text-xs mt-1" style={{ color: "#A39C87" }}>Irréversible — supprime aussi toutes les données (écritures, factures, membres, etc.).</div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === "rapports" && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg p-4 flex flex-wrap gap-3" style={{ border: "1px solid #E4DFD1" }}>
              <div>
                <label className="text-xs block mb-1" style={{ color: "#8A8370" }}>Période</label>
                <select value={rapPeriod} onChange={(e) => setRapPeriod(e.target.value)}
                  className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }}>
                  <option value="mois">Ce mois-ci</option>
                  <option value="trimestre">Ce trimestre</option>
                  <option value="annee">Cette année</option>
                  <option value="tout">Tout l'historique</option>
                </select>
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: "#8A8370" }}>Regrouper par</label>
                <select value={rapGroupBy} onChange={(e) => setRapGroupBy(e.target.value)}
                  className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }}>
                  <option value="mois">Mois</option>
                  <option value="trimestre">Trimestre</option>
                  <option value="annee">Année</option>
                </select>
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: "#8A8370" }}>Devise</label>
                <select value={rapCurrency} onChange={(e) => setRapCurrency(e.target.value)}
                  className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }}>
                  <option value="">Toutes</option>
                  <option value="HTG">HTG</option>
                  <option value="USD">USD</option>
                  <option value="MXN">MXN</option>
                </select>
              </div>
            </div>

            <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
              <div className="text-xs" style={{ color: "#8A8370" }}>Revenus sur la sélection</div>
              <div className="text-2xl tabular font-medium" style={{ color: "#0F6B5C" }}>
                {rapTotalRevenue.toLocaleString("fr-FR")} {rapCurrency || ""}
              </div>
              {!rapCurrency && [...new Set(rapPayments.map((p) => p.currency || "HTG"))].length > 1 && (
                <div className="text-xs mt-1" style={{ color: "#9A7B1E" }}>⚠ Plusieurs devises mélangées dans ce total — sélectionnez une devise pour un chiffre exact.</div>
              )}
            </div>

            <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
              <div className="text-sm font-semibold mb-4" style={{ color: "#152238" }}>Revenus dans le temps</div>
              {rapRevenueOverTime.length === 0 ? (
                <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Aucun paiement pour cette sélection.</div>
              ) : rapRevenueOverTime.length === 1 ? (
                <div className="text-center py-4">
                  <div className="text-xs uppercase tracking-wide mb-1" style={{ color: "#8A8370" }}>{rapRevenueOverTime[0].periode}</div>
                  <div className="tabular" style={{ fontSize: 26, fontWeight: 700, color: "#0F6B5C" }}>{rapRevenueOverTime[0].total.toLocaleString("fr-FR")}</div>
                </div>
              ) : (
                <SimpleLineChart data={rapRevenueOverTime} xKey="periode" yKey="total" color="#0F6B5C" name="Revenus" />
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
                <div className="text-sm font-semibold mb-4" style={{ color: "#152238" }}>Répartition par méthode de paiement</div>
                {rapByMethod.length === 0 ? (
                  <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Aucun paiement.</div>
                ) : (
                  <SimpleDonutChart data={rapByMethod} nameKey="name" valueKey="revenue" />
                )}
              </div>
              <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
                <div className="text-sm font-semibold mb-4" style={{ color: "#152238" }}>Nouvelles entreprises</div>
                {rapNewCompaniesOverTime.length === 0 ? (
                  <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Aucune nouvelle entreprise sur cette période.</div>
                ) : rapNewCompaniesOverTime.length === 1 ? (
                  <div className="text-center py-4">
                    <div className="text-xs uppercase tracking-wide mb-1" style={{ color: "#8A8370" }}>{rapNewCompaniesOverTime[0].periode}</div>
                    <div className="tabular" style={{ fontSize: 26, fontWeight: 700, color: "#152238" }}>{rapNewCompaniesOverTime[0].total}</div>
                  </div>
                ) : (
                  <SimpleLineChart data={rapNewCompaniesOverTime} xKey="periode" yKey="total" color="#3F4F73" name="Nouvelles entreprises" />
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
              <div className="text-sm font-semibold mb-4" style={{ color: "#152238" }}>Classement des entreprises par revenu généré</div>
              {rapByCompany.length === 0 ? (
                <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Aucun paiement pour cette sélection.</div>
              ) : (
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead>
                    <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                      <th className="py-2 font-normal">Entreprise</th>
                      <th className="py-2 font-normal text-right">Revenu total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rapByCompany.map((c) => (
                      <tr key={c.name} style={{ borderBottom: "1px solid #F3EFE3" }}>
                        <td className="py-2">{c.name}</td>
                        <td className="py-2 tabular text-right">{c.total.toLocaleString("fr-FR")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </div>
          </div>
        )}

        {tab === "erreurs" && (
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-sm font-semibold mb-1" style={{ color: "#152238" }}>Erreurs récentes (200 dernières)</div>
            <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
              Erreurs JavaScript non gérées survenues chez les utilisateurs, journalisées automatiquement — utile pour repérer un problème sans attendre qu'on vous le signale.
            </p>
            {errorLogs === null ? (
              <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Chargement…</div>
            ) : errorLogs.length === 0 ? (
              <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Aucune erreur journalisée.</div>
            ) : (
              <div className="space-y-2">
                {errorLogs.map((e) => (
                  <details key={e.id} className="rounded" style={{ border: "1px solid #F3EFE3" }}>
                    <summary className="cursor-pointer px-3 py-2 text-xs flex flex-wrap gap-x-3 gap-y-1" style={{ color: "#152238" }}>
                      <span className="tabular" style={{ color: "#8A8370" }}>{e.created_at ? new Date(e.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" }) : "—"}</span>
                      <span className="font-medium">{e.message || "(sans message)"}</span>
                      <span style={{ color: "#A39C87" }}>v{e.app_version || "?"} — {companyNameById[e.company_id] || "—"} — {e.user_email || "anonyme"}</span>
                    </summary>
                    <div className="px-3 pb-3">
                      <div className="text-xs mb-1" style={{ color: "#8A8370" }}>{e.url}</div>
                      {e.stack && <pre className="text-xs whitespace-pre-wrap p-2 rounded overflow-x-auto" style={{ background: "#FAF8F1", color: "#7A7460" }}>{e.stack}</pre>}
                      <button
                        onClick={(ev) => {
                          ev.preventDefault();
                          // Téléchargement ciblé à CE message précis uniquement — pas
                          // l'ensemble du journal, pour ne pas mélanger une erreur déjà
                          // diagnostiquée avec d'autres qui ne le sont pas encore.
                          const blob = new Blob([JSON.stringify(e, null, 2)], { type: "application/json" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `compta-plus-erreur-${e.id}.json`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="mt-2 text-xs px-3 py-1.5 rounded" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>
                        ⬇ Télécharger ce message (JSON)
                      </button>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Supervision d'erreurs basique ---
// Capte toute erreur JS non gérée (window.onerror) et toute promesse rejetée
// non gérée (unhandledrejection) n'importe où dans l'app, et les journalise dans
// Supabase — pour repérer les problèmes en production sans dépendre uniquement
// des remontées manuelles des utilisateurs. Ne bloque et ne casse jamais l'app :
// toute erreur pendant la journalisation elle-même est silencieusement ignorée.
const _errorLogCounts = {};
async function logClientError(message, stack, url) {
  try {
    const key = String(message).slice(0, 200);
    _errorLogCounts[key] = (_errorLogCounts[key] || 0) + 1;
    // Anti-inondation : au-delà de 5 occurrences de la même erreur dans cette
    // session (ex. une boucle de rendu qui échoue en continu), on arrête de
    // journaliser cette erreur précise — le signal est déjà capté, inutile de
    // continuer à écrire en base indéfiniment.
    if (_errorLogCounts[key] > 5) return;
    const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
    let companyId = null;
    try { companyId = _membership?.companyId || null; } catch (e) {}
    await supabase.from("error_logs").insert({
      message: String(message).slice(0, 2000),
      stack: stack ? String(stack).slice(0, 4000) : null,
      url,
      app_version: APP_VERSION,
      user_email: user?.email || null,
      company_id: companyId,
      user_agent: navigator.userAgent,
    });
  } catch (e) { /* la supervision elle-même ne doit jamais faire planter l'app */ }
}
window.addEventListener("error", (event) => {
  logClientError(event.message, event.error?.stack, window.location.href);
});
window.addEventListener("unhandledrejection", (event) => {
  logClientError(String(event.reason?.message || event.reason), event.reason?.stack, window.location.href);
});

// --- Montage de l'application ---
ReactDOM.createRoot(document.getElementById("root")).render(
  <AuthGate><App /></AuthGate>
);

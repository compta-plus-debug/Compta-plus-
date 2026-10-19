// ═══ MODULE ═══
// @module Session et appartenance
// @depends NET_MSG, _extraInvitesFor, _hlNetBadUntil, _membership, _membershipPromise, genInviteToken
//   hlMeta, hlNetDown, hlOfflineAllowed, oflIsNetworkError, oflTimeout, supabase, uid
// @exports chooseCompany, clearMembershipCache, dlog, forgetCompanyChoice, invokeEdgeFunction
//   resolveMembership, ruleRefusalMessage
// ═══ FIN DE L'EN-TÊTE ═══
// Journalisation de diagnostic TEMPORAIRE (table debug_login_log, voir
// debug-login-log.sql) — best-effort, ne doit jamais faire échouer le flux réel même
// si l'insertion elle-même échoue (ex. table pas encore créée).
async function dlog(step, detail) {
  // Désactivé : la table debug_login_log n'existe pas en production, chaque appel
  // échouait silencieusement (404) tout en ajoutant une latence réseau inutile —
  // parfois plusieurs secondes cumulées — au moment le plus sensible de la
  // connexion (juste après un lien magique). Fonction conservée (no-op) pour ne
  // pas avoir à retirer tous ses points d'appel dans resolveMembershipInner().
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
    // Hors ligne : le client de connexion peut rester en attente plusieurs dizaines de secondes (rafraîchissement
    // du jeton impossible) — on garde l'identité connue sans rien demander au réseau.
    if (hlNetDown()) return _membership;
    // L'identité (entreprise/rôle) reste en cache — coûteuse à revérifier et très
    // stable. Mais plan_status/plan_tier/etc. peuvent changer À TOUT MOMENT depuis
    // Super Admin (activation, suspension, changement de forfait) : les relire à
    // chaque appel évite qu'un simple rafraîchissement de page (parfois restauré
    // depuis le bfcache du navigateur, sans réexécuter tout le script) affiche un
    // état figé jusqu'à une déconnexion/reconnexion complète.
    try {
      let { data: co, error: coErr } = await oflTimeout(supabase.from("companies").select("name, plan_status, plan_tier, trial_ends_at, security_pin_hash").eq("id", _membership.companyId).single(), 6000);
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
  // Réseau « connecté mais sans accès réel » : sur un appareil déjà configuré, on n'attend pas indéfiniment.
  const metaOk = (() => { const m = hlMeta(); return !!(m && m.bootOk); })();
  const innerP = resolveMembershipInner();
  const guardedP = metaOk ? Promise.race([innerP, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout: pas de réponse du réseau")), 8000))]) : innerP;
  innerP.catch(() => {});
  _membershipPromise = guardedP.catch((e) => {
    // Réseau instable (connecté mais sans accès réel) : si cet appareil a déjà ouvert l'application en ligne,
    // on reprend l'identité mémorisée au lieu d'afficher un écran d'erreur de connexion.
    const m = oflIsNetworkError(e) ? hlOfflineAllowed(true) : null;
    if (m) { _membership = m.membership; _hlNetBadUntil = Date.now() + 60000; return _membership; }
    throw e;
  }).finally(() => { _membershipPromise = null; });
  return _membershipPromise;
}

async function resolveMembershipInner() {
  // Hors-ligne : getUser() est un appel réseau réel (contrairement à getSession()
  // qui lit le cache local) — sans connexion, il échouerait et serait autrement
  // indiscernable d'une vraie déconnexion. On le signale explicitement ici pour
  // que l'appelant puisse réessayer au retour du réseau, sans jamais montrer
  // l'écran destructeur "Connexion refusée" pour un simple souci réseau ponctuel.
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    // Démarrage hors ligne : on reprend l'identité mémorisée lors de la dernière ouverture en ligne
    // (uniquement si cet appareil a une session et que l'accès hors ligne est autorisé).
    const allowed = hlOfflineAllowed();
    if (allowed) { _membership = allowed.membership; return _membership; }
    throw new Error("OFFLINE");
  }
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
        "Votre invitation a été trouvée mais n'a pas pu être finalisée pour le moment. " + NET_MSG + " Aucune nouvelle entreprise n'a été créée : vos données sont préservées."
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
      let { data: co, error: coErr } = await supabase.from("companies").select("name, plan_status, plan_tier, trial_ends_at, security_pin_hash, group_id").eq("id", base.companyId).single();
      if (coErr && coErr.code === "42703") {
        // Colonne security_pin_hash, plan_tier ou group_id pas encore migrée : repli sans elles.
        const retry = await supabase.from("companies").select("name, plan_status, trial_ends_at").eq("id", base.companyId).single();
        co = retry.data;
      }
      base.companyName = co?.name;
      base.planStatus = co?.plan_status || "trial";
      base.planTier = co?.plan_tier || "standard";
      base.trialEndsAt = co?.trial_ends_at;
      base.hasSecurityPin = !!co?.security_pin_hash;
      // Groupe multi-entreprises : l'abonnement (essai/payant/suspendu) vient du
      // groupe, jamais de l'entreprise elle-même — un seul abonnement couvre
      // toutes les entreprises membres. Si cette lecture échoue pour une raison
      // quelconque (table pas encore migrée, groupe supprimé...), l'entreprise
      // garde simplement son propre statut, sans jamais bloquer la connexion.
      if (co?.group_id) {
        try {
          const { data: grp } = await supabase.from("company_groups").select("id, name, plan_status, trial_ends_at, max_companies, owner_user_id").eq("id", co.group_id).maybeSingle();
          if (grp) {
            base.groupId = grp.id;
            base.groupName = grp.name;
            base.groupMaxCompanies = grp.max_companies;
            base.planStatus = grp.plan_status || "trial";
            base.trialEndsAt = grp.trial_ends_at;
            // Distinction centrale : le PROPRIÉTAIRE du groupe a accès au tableau
            // de bord consolidé ; une entreprise simplement MEMBRE du groupe
            // (créée/rattachée par quelqu'un d'autre, ou rejointe par demande)
            // ne doit jamais y avoir accès — seulement savoir qu'elle en fait partie.
            base.isGroupOwner = grp.owner_user_id === user.id;
          } else {
            base.isGroupOwner = false;
          }
        } catch (e) {}
      } else {
        base.isGroupOwner = false;
      }
    } else if (base.hasSecurityPin === undefined) {
      base.hasSecurityPin = false;
    }
    // Indépendant de ce qui précède : certains chemins (préférence déjà
    // mémorisée entre plusieurs entreprises, notamment) fournissent planStatus
    // dès le départ et sautaient donc entièrement le bloc ci-dessus — laissant
    // groupId/isGroupOwner indéfinis même pour une vraie entreprise de groupe.
    // Toujours résolu séparément ici si ce n'est pas déjà fait.
    if (base.companyId && base.isGroupOwner === undefined) {
      try {
        const { data: co2, error: co2Err } = await supabase.from("companies").select("group_id").eq("id", base.companyId).maybeSingle();
        if (co2?.group_id) {
          const { data: grp } = await supabase.from("company_groups").select("id, name, plan_status, trial_ends_at, max_companies, owner_user_id").eq("id", co2.group_id).maybeSingle();
          if (grp) {
            base.groupId = grp.id;
            base.groupName = grp.name;
            base.groupMaxCompanies = grp.max_companies;
            base.isGroupOwner = grp.owner_user_id === user.id;
          } else {
            base.isGroupOwner = false;
          }
        } else {
          base.isGroupOwner = false;
        }
      } catch (e) {
        base.isGroupOwner = false;
      }
    }
    if (base.planTier === undefined) base.planTier = "standard";
    if (base.isAccountant === undefined) {
      base.isAccountant = false;
      try {
        const { data: me } = await supabase.from("company_members").select("is_accountant").eq("company_id", base.companyId).eq("user_id", user.id).maybeSingle();
        base.isAccountant = !!(me && me.is_accountant);
      } catch (e) {}
    }
    base.companyCount = existingRows && existingRows.length ? existingRows.length : 1;
    _membership = base;
    return _membership;
  };

  let existingRows = null, existingErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await supabase
      .from("company_members")
      .select("company_id, role, email, is_assisted_supervisor")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    existingRows = res.data;
    existingErr = res.error;
    await dlog("existing_check", { attempt, count: existingRows?.length ?? null, error: existingErr ? (existingErr.message || existingErr.code) : null, rows: existingRows });
    if (!existingErr) break;
    // On réessaie sur N'IMPORTE QUELLE erreur ici, sans essayer de reconnaître un
    // format précis (401, JWT...) : le format exact renvoyé par supabase-js pour ce
    // genre d'échec n'est pas garanti, et une erreur à ce moment précis — juste après
    // l'établissement d'une nouvelle session — est presque toujours transitoire
    // (jeton d'authentification pas encore pleinement propagé côté serveur pour
    // cette requête précise). Mieux vaut réessayer à tort que ne jamais réessayer.
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  if (existingErr) {
    throw new Error("Impossible de vérifier votre entreprise pour le moment. " + NET_MSG + " Aucune nouvelle entreprise n'a été créée : vos données sont préservées.");
  }
  // Cabinet d'expertise comptable rattaché à plusieurs entreprises : les invitations
  // « expert » supplémentaires en attente sont réclamées automatiquement (une seule fois
  // par session). Réservé aux rattachements marqués is_accountant : un autre type
  // d'invitation n'est jamais réclamé silencieusement. Sans la colonne (script SQL non
  // exécuté), la lecture échoue et on ignore simplement cette étape.
  const claimExtraAccountantInvites = async () => {
    if (_extraInvitesFor === user.id) return 0;
    _extraInvitesFor = user.id;
    let n = 0;
    try {
      const { data: pend, error } = await supabase.from("company_members").select("id, company_id, user_id, is_accountant").ilike("email", user.email).is("user_id", null);
      if (error || !pend) return 0;
      for (const r of pend) {
        if (r.user_id || !r.is_accountant) continue;
        const res = await supabase.from("company_members").update({ user_id: user.id }).eq("id", r.id).select("id");
        if (!res.error && res.data && res.data.length > 0) n++;
      }
    } catch (e) {}
    if (n > 0) {
      try {
        const res = await supabase.from("company_members").select("company_id, role, email, is_assisted_supervisor").eq("user_id", user.id).order("created_at", { ascending: true });
        if (!res.error && res.data) existingRows = res.data;
      } catch (e) {}
    }
    return n;
  };
  const pickCompany = async () => {
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
    let accMap = {};
    try { const ar = await supabase.from("company_members").select("company_id, is_accountant").eq("user_id", user.id); if (!ar.error && ar.data) ar.data.forEach((x) => { accMap[x.company_id] = !!x.is_accountant; }); } catch (e) { /* colonne absente : pas d'espace cabinet */ }
    const options = existingRows.map((r) => ({
      companyId: r.company_id, role: r.role, isAccountant: !!accMap[r.company_id],
      name: namedCompanies?.find((c) => c.id === r.company_id)?.name || "(sans nom)",
    }));
    await dlog("multi_company_needs_pick", { total: options.length });
    return { needsCompanyPick: true, options, email: user.email };
  };
  if (existingRows && existingRows.length > 0) await claimExtraAccountantInvites();
  if (existingRows && existingRows.length > 1) {
    return await pickCompany();
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
    throw new Error("Impossible de vérifier votre invitation pour le moment. " + NET_MSG + " Aucune nouvelle entreprise n'a été créée : vos données sont préservées.");
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
        "Votre invitation a été trouvée mais n'a pas pu être finalisée pour le moment. " + NET_MSG + " Aucune nouvelle entreprise n'a été créée : vos données sont préservées."
      );
    }
    await dlog("claimed_ok", { companyId: invite.company_id });
    existingRows = [{ company_id: invite.company_id, role: invite.role, email: user.email }];
    if ((await claimExtraAccountantInvites()) > 0 && existingRows.length > 1) return await pickCompany();
    return finish({ companyId: invite.company_id, role: invite.role, email: user.email });
  }
  await dlog("no_invite_found_fallback", {});

  // Un collaborateur du Centre de gestion (ou un administrateur plateforme) n'a
  // jamais besoin d'une entreprise pour accéder à son espace — vérifié ICI, avant
  // le blocage lié à l'essai gratuit et toute création d'entreprise, pour qu'un
  // tout nouveau collaborateur ne se retrouve jamais bloqué ou envoyé à tort vers
  // l'écran "créez votre entreprise" simplement parce que c'est sa première connexion.
  try {
    const [{ data: mc }, { data: pa }] = await Promise.all([
      supabase.from("management_collaborators").select("email").ilike("email", user.email).maybeSingle(),
      supabase.from("platform_admins").select("email").eq("email", user.email).maybeSingle(),
    ]);
    if (mc || pa) {
      await dlog("management_only_no_company", { email: user.email });
      return finish({
        companyId: null, role: null, email: user.email,
        companyName: null, planStatus: "pending", trialEndsAt: null,
        isNewCompany: false,
      });
    }
  } catch (e) {
    // Tables pas encore migrées, ou hors mode Supabase : on continue normalement,
    // comme si la personne n'était ni collaborateur ni administrateur plateforme.
  }

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
  // (Le blocage par appareil côté navigateur a été retiré : la limite d'essais est
  // désormais appliquée par le serveur — 2 essais par adresse email, voir create-company.)

  // Aucune invitation trouvée pour cet email : on ne crée RIEN pour l'instant.
  // L'entreprise ne sera réellement créée qu'au moment où l'utilisateur
  // soumet un nom sur l'écran de bienvenue (submitWelcome) — pour ne jamais
  // laisser une entreprise fantôme, sans nom choisi, si quelqu'un abandonne
  // le processus en cours de route (ferme l'onglet, revient en arrière...).
  return finish({
    companyId: null, role: "Administrateur", email: user.email,
    companyName: null, planStatus: "pending", trialEndsAt: null,
    isNewCompany: true, pendingCreation: true,
  });
}

// Appelle une fonction serveur et récupère le VRAI message d'erreur, même
// quand elle répond avec un code d'erreur HTTP (403, 400, 500...) — laissé
// tel quel, supabase-js masque systématiquement ce détail derrière un message
// générique ("Edge Function returned a non-2xx status code"), qui ne dit
// jamais ce qui a réellement posé problème. Le vrai message reste lisible
// dans la réponse brute (error.context), qu'on relit ici nous-mêmes.
async function invokeEdgeFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let detail = error.message || "Erreur inconnue";
    if (error.context && typeof error.context.json === "function") {
      try {
        const parsed = await error.context.json();
        if (parsed?.error) detail = parsed.error;
      } catch (e) {}
    }
    return { data: null, error: detail };
  }
  if (data?.error) return { data: null, error: data.error };
  return { data, error: null };
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

// Règles métier appliquées par la base (v228) : un refus arrive sous la forme
// « REGLE|code|message en français ». Retourne ce message, ou null si l'erreur est autre.
function ruleRefusalMessage(e) {
  const m = e && typeof e.message === "string" ? e.message : "";
  const i = m.indexOf("REGLE|");
  if (i < 0) return null;
  const parts = m.slice(i).split("|");
  return parts.slice(2).join("|").trim() || "Cette opération n'est pas autorisée.";
}

window.storage = {
  async get(key) {
    if (hlNetDown()) throw new Error("OFFLINE");
    const { companyId } = await resolveMembership();
    const { data, error } = await oflTimeout(supabase.from("kv_store").select("value").eq("company_id", companyId).eq("key", key).maybeSingle(), 20000);
    if (error || !data) return null;
    return { key, value: data.value, shared: false };
  },
  async set(key, value) {
    if (hlNetDown()) throw new Error("OFFLINE");
    const { companyId } = await resolveMembership();
    const { error } = await oflTimeout(supabase.from("kv_store").upsert({ company_id: companyId, key, value, updated_at: new Date().toISOString() }, { onConflict: "company_id,key" }), 25000);
    if (error) throw error;
    return { key, value, shared: false };
  },
  async delete(key) {
    if (hlNetDown()) throw new Error("OFFLINE");
    const { companyId } = await resolveMembership();
    const { error } = await supabase.from("kv_store").delete().eq("company_id", companyId).eq("key", key);
    return { key, deleted: !error, shared: false };
  },
  async list(prefix = "") {
    if (hlNetDown()) throw new Error("OFFLINE");
    const { companyId } = await resolveMembership();
    const { data, error } = await supabase.from("kv_store").select("key").eq("company_id", companyId).like("key", `${prefix}%`);
    if (error) return { keys: [], prefix, shared: false };
    return { keys: (data || []).map((d) => d.key), prefix, shared: false };
  },
};


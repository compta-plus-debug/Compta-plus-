// Version "sans build" : pas d'imports ES module — React, ainsi que les icônes et
// graphiques ci-dessous (remplaçant lucide-react et recharts), sont des variables
// globales chargées directement par <script> dans index.html.
const { useState, useEffect, useMemo } = React;

// --- Supabase (chargé via CDN dans index.html, expose window.supabase.createClient) ---
const SUPABASE_URL = "https://cnmmxpwlgovzbcfqaxqm.supabase.co";
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

async function resolveMembership() {
  if (_membership) return _membership;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Utilisateur non connecté");

  // Juste après l'établissement d'une nouvelle session (ex. clic sur le lien de
  // connexion), le client interne peut mettre un court instant à propager le jeton
  // d'authentification vers les requêtes REST/RPC — auth.jwt() peut alors apparaître
  // vide côté serveur pendant cette fenêtre, faisant échouer silencieusement (sans
  // erreur) la recherche d'invitation par email. On attend que le jeton soit bien
  // rattaché à la session avant de continuer, avec une petite marge de sécurité.
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data: { session: s } } = await supabase.auth.getSession();
    if (s?.access_token) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  const finish = async (base) => {
    // Complète toujours avec les infos d'essai/abonnement de l'entreprise (sauf si on
    // vient de la créer à l'instant, auquel cas on les a déjà via l'insert ci-dessous).
    if (base.planStatus === undefined) {
      const { data: co } = await supabase.from("companies").select("name, plan_status, trial_ends_at").eq("id", base.companyId).single();
      base.companyName = co?.name;
      base.planStatus = co?.plan_status || "trial";
      base.trialEndsAt = co?.trial_ends_at;
    }
    _membership = base;
    return _membership;
  };

  let { data: existingRows, error: existingErr } = await supabase
    .from("company_members")
    .select("company_id, role, email")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);
  if (existingErr) {
    throw new Error(`Impossible de vérifier votre entreprise (${existingErr.message || existingErr.code || "erreur inconnue"}). Une nouvelle entreprise n'a pas été créée pour éviter de dupliquer vos données — contactez le support avec ce message.`);
  }
  const existing = existingRows && existingRows[0];
  if (existing) {
    return finish({ companyId: existing.company_id, role: existing.role, email: existing.email });
  }

  let { data: inviteRows, error: inviteErr } = await supabase
    .from("company_members")
    .select("id, company_id, role")
    .ilike("email", user.email)
    .is("user_id", null)
    .order("created_at", { ascending: true })
    .limit(1);
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
    if (!retry.error && retry.data && retry.data.length > 0) inviteRows = retry.data;
  }
  const invite = inviteRows && inviteRows[0];
  if (invite) {
    const { data: claimedRows, error: claimErr } = await supabase
      .from("company_members")
      .update({ user_id: user.id })
      .eq("id", invite.id)
      .select("id");
    if (claimErr || !claimedRows || claimedRows.length === 0) {
      throw new Error(
        `Votre invitation a été trouvée mais n'a pas pu être finalisée` +
        (claimErr ? ` (${claimErr.message || claimErr.code})` : " (aucune ligne mise à jour, probablement bloqué par une règle de sécurité)") +
        `. Une nouvelle entreprise n'a pas été créée pour éviter de dupliquer vos données — contactez le support avec ce message.`
      );
    }
    return finish({ companyId: invite.company_id, role: invite.role, email: user.email });
  }

  // Aucune invitation trouvée pour cet email : avant de créer une entreprise vierge
  // (correct pour un tout premier utilisateur, mais dangereux si une invitation
  // existait sous une adresse légèrement différente), on demande une confirmation
  // explicite en affichant l'email exact recherché — ça sert aussi de diagnostic
  // visible sans outils développeur en cas de souci d'invitation.
  // DIAGNOSTIC TEMPORAIRE (à retirer une fois le bug d'invitation résolu) : interroge
  // debug_whoami() pour voir exactement ce que le serveur perçoit de cette session
  // (email du jeton, et quelles invitations en attente lui sont visibles selon les
  // règles de sécurité) — évite de deviner davantage à l'aveugle.
  let debugInfo = "";
  try {
    const { data: dbg, error: dbgErr } = await supabase.rpc("debug_whoami");
    debugInfo = dbgErr
      ? `\n\n[Diagnostic] Erreur : ${dbgErr.message || dbgErr.code}`
      : `\n\n[Diagnostic] jwt_email="${dbg?.jwt_email}" — invitations visibles : ${JSON.stringify(dbg?.visible_pending_invites)}`;
  } catch (e) { debugInfo = `\n\n[Diagnostic] Fonction indisponible (${e.message || e}).`; }
  const proceedWithNewCompany = window.confirm(
    `Aucune entreprise ni invitation trouvée pour l'adresse : ${user.email}\n\n` +
    `Si vous pensiez rejoindre une entreprise existante suite à une invitation, cliquez Annuler, déconnectez-vous, et reconnectez-vous avec l'adresse email EXACTE où l'invitation a été envoyée (vérifiez l'orthographe, les espaces, le domaine @...).\n\n` +
    `Cliquez OK pour continuer et créer une nouvelle entreprise vierge avec cette adresse.` +
    debugInfo
  );
  if (!proceedWithNewCompany) {
    try { await supabase.auth.signOut(); } catch (e) {}
    throw new Error(`Connexion annulée — reconnectez-vous avec l'adresse email exacte de votre invitation.`);
  }

  const { data: company, error: companyErr } = await supabase
    .from("companies")
    .insert({ name: "Mon Entreprise" })
    .select()
    .single();
  if (companyErr) throw companyErr;

  const { error: memberErr } = await supabase.from("company_members").insert({
    company_id: company.id, email: user.email, user_id: user.id, role: "Administrateur",
  });
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
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href.split(/[?#]/)[0] } });
    if (error) setError(error.message);
    else setSent(true);
  };

  const signOut = () => {
    clearMembershipCache();
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#F7F5EF", fontFamily: "sans-serif" }}>
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

  if (mfaLevel && mfaLevel.next === "aal2" && mfaLevel.current !== "aal2") {
    return <MfaChallengeScreen onVerified={refreshMfaLevel} onSignOut={signOut} />;
  }

  return <>{children}</>;
}

// --- Étape de vérification du code à 6 chiffres (2FA), affichée après le lien magique
// si le compte a un facteur TOTP enregistré. Bloque l'accès à l'application tant que le
// code n'est pas validé.
function MfaChallengeScreen({ onVerified, onSignOut }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);

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

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#F7F5EF", fontFamily: "sans-serif" }}>
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
        <button type="button" onClick={onSignOut} style={{ background: "none", border: "none", color: "#8A8370", fontSize: 12, marginTop: 16, cursor: "pointer", padding: 0, display: "block" }}>
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

        {factors !== null && !enrolling && (
          <>
            <p style={{ fontSize: 13, color: "#8A8370", marginBottom: 16 }}>
              La double authentification ajoute un code à 6 chiffres (via une application comme Google Authenticator ou Authy) en plus du lien magique par email, pour protéger votre compte même si votre boîte mail est compromise.
            </p>
            {verifiedFactor ? (
              <>
                <p style={{ fontSize: 13, color: "#0F6B5C", marginBottom: 12 }}>✓ Double authentification activée sur ce compte.</p>
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
            <p style={{ fontSize: 11, color: "#A39C87", marginTop: 16 }}>
              En cas de perte de l'appareil utilisé pour générer les codes, contactez l'administrateur de la plateforme pour réinitialiser l'accès.
            </p>
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
  const features = [
    { icon: BookOpen, title: "Comptabilité en partie double", desc: "Journal, plan de comptes, bilan et compte de résultat générés automatiquement, avec journal scellé par chaînage cryptographique." },
    { icon: ShoppingCart, title: "Point de vente & facturation", desc: "Encaissez en boutique, générez des factures professionnelles imprimables ou en PDF, gérez remises et paiements partiels." },
    { icon: Boxes, title: "Stock & inventaire", desc: "Suivi en temps réel des quantités, alertes de réapprovisionnement, mouvements tracés." },
    { icon: Truck, title: "Achats & fournisseurs", desc: "Centralisez vos commandes fournisseurs et leur suivi de paiement." },
    { icon: Users, title: "Comptes clients (CRM)", desc: "Suivez les factures dues et payées, relancez vos clients en un coup d'œil." },
    { icon: BarChart3, title: "Rapports en continu", desc: "Bilan, résultat, balance et analyse des ventes toujours à jour, exportables en PDF." },
  ];
  return (
    <div style={{ background: "#F7F5EF", fontFamily: "'Source Sans Pro', 'Inter', sans-serif", minHeight: "100vh", color: "#152238" }}>
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
          <div className="lp-display text-2xl mb-2">Tarif simple, sans surprise</div>
          <p className="text-sm" style={{ color: "#7A7460" }}>Un seul palier, toutes les fonctionnalités incluses. 30 jours d'essai gratuit avant tout engagement.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="bg-white rounded-lg p-7 text-center" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-xs uppercase tracking-widest mb-2" style={{ color: "#C9A24B" }}>Haïti</div>
            <div className="lp-display text-3xl mb-1">{htgPrice.toLocaleString("fr-FR")} HTG<span className="text-sm font-normal" style={{ color: "#A39C87" }}> / mois</span></div>
            <p className="text-xs mb-1" style={{ color: "#A39C87" }}>
              ≈ 20 USD {rateIsLive ? "au taux du jour" : "au taux de référence indicatif"} ({(htgRate || FALLBACK_HTG_PER_USD).toFixed(2)} HTG/USD)
            </p>
            <p className="text-xs mb-4" style={{ color: "#8A8370" }}>Paiement par MonCash, NatCash ou virement</p>
            <button onClick={onStart} className="text-sm px-5 py-2 rounded" style={{ border: "1px solid #152238", color: "#152238" }}>Essayer gratuitement</button>
          </div>
          <div className="bg-white rounded-lg p-7 text-center" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-xs uppercase tracking-widest mb-2" style={{ color: "#C9A24B" }}>Mexique</div>
            <div className="lp-display text-3xl mb-1">400 MXN<span className="text-sm font-normal" style={{ color: "#A39C87" }}> / mois</span></div>
            <p className="text-xs mb-4" style={{ color: "#8A8370" }}>Paiement par carte (Stripe)</p>
            <button onClick={onStart} className="text-sm px-5 py-2 rounded" style={{ border: "1px solid #152238", color: "#152238" }}>Essayer gratuitement</button>
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
  const groupW = series.length * barW + (series.length - 1) * gap;
  const W = Math.max(400, data.length * (groupW + groupGap) + groupGap);
  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={W} height={H + 50} style={{ minWidth: "100%" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={H - H * f} y2={H - H * f} stroke="#EEE9DA" />
        ))}
        {data.map((d, i) => {
          const gx = groupGap + i * (groupW + groupGap);
          return (
            <g key={i}>
              {series.map((s, j) => {
                const val = d[s.key] || 0;
                const h = (val / max) * (H - 10);
                return (
                  <rect key={s.key} x={gx + j * (barW + gap)} y={H - h} width={barW} height={h} rx={3} fill={s.color}>
                    <title>{s.name}: {fmt(val)}</title>
                  </rect>
                );
              })}
              <text x={gx + groupW / 2} y={H + 18} fontSize="11" textAnchor="middle" fill="#8A8370">{d[xKey]}</text>
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
  const zeroY = H / 2;
  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={W} height={H + 30} style={{ minWidth: "100%" }}>
        <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke="#DDD6C4" />
        {data.map((d, i) => {
          const val = d[valueKey] || 0;
          const gx = gap + i * (barW + gap);
          const h = (Math.abs(val) / maxAbs) * (zeroY - 10);
          const color = val >= 0 ? "#0F6B5C" : "#A6432F";
          const pct = d[pctKey];
          return (
            <g key={i}>
              <rect x={gx} y={val >= 0 ? zeroY - h : zeroY} width={barW} height={h} rx={3} fill={color}>
                <title>{d[xKey]} : {val >= 0 ? "+" : ""}{fmt(val)}{pct !== null && pct !== undefined ? ` (${val >= 0 ? "+" : ""}${pct.toFixed(1)}%)` : ""}</title>
              </rect>
              <text x={gx + barW / 2} y={val >= 0 ? zeroY - h - 6 : zeroY + h + 14} fontSize="10" textAnchor="middle" fill={color}>
                {pct !== null && pct !== undefined ? `${val >= 0 ? "+" : ""}${pct.toFixed(0)}%` : ""}
              </text>
              <text x={gx + barW / 2} y={H + 18} fontSize="11" textAnchor="middle" fill="#8A8370">{d[xKey]}</text>
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
  Vendeur: ["vente"],
};

const DEFAULT_ACCOUNTS = [
  { code: "101", name: "Capital", type: "Capitaux propres" },
  { code: "411", name: "Clients", type: "Actif" },
  { code: "401", name: "Fournisseurs", type: "Passif" },
  { code: "445", name: "Taxe collectée sur ventes (IVA/TCA)", type: "Passif" },
  { code: "512", name: "Banque", type: "Actif" },
  { code: "530", name: "Caisse", type: "Actif" },
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
  { code: "706", name: "Prestations de services", type: "Produit" },
  { code: "707", name: "Ventes de marchandises", type: "Produit" },
  { code: "708", name: "Produits accessoires", type: "Produit" },
];

const DEFAULT_PRODUCTS = [
  { id: 1, code: "P001", name: "Prestation de conseil (h)", price: 60, tva: 20, type: "service", account: "706" },
  { id: 2, code: "P002", name: "Pack démarrage", price: 250, tva: 20, type: "service", account: "706" },
  { id: 3, code: "M001", name: "Article standard", price: 25, tva: 20, type: "marchandise", account: "707", stock: 40, seuil: 10 },
];

const DEFAULT_SUPPLIERS = [
  { id: 1, name: "Fournisseur Général SARL", contact: "" },
];

const DEFAULT_CLIENTS = [];

const TAX_SYSTEMS = {
  iva: { label: "IVA", defaultRate: 16, description: "Impuesto al Valor Agregado (Mexique) — déductible sur les achats" },
  tca: { label: "TCA", defaultRate: 10, description: "Taxe sur le Chiffre d'Affaires (Haïti) — taxe sur ventes/services, supportée par le consommateur final, non déductible" },
  aucune: { label: "Aucune taxe", defaultRate: 0, description: "Aucune taxe appliquée aux ventes" },
};

const DEFAULT_SETTINGS = {
  companyName: "Mon Entreprise",
  companyAddress: "",
  companyPhone: "",
  companyEmail: "",
  currency: "HTG",
  fiscalYearStart: "01-01",
  taxSystem: "tca", // "iva" | "tca" | "aucune"
  taxRate: 10,
  taxAccount: "445",
  taxDeductibleOnPurchases: true,
  lockDate: "", // Clôture d'exercice/période : aucune écriture datée ≤ cette date ne peut être créée, modifiée ou annulée
  nextInvoiceNumber: 1, // Compteur strictement croissant : garantit une numérotation de factures sans trous ni doublons
  subscriptionPriceHTG: 2600, // Repli si le taux de change en temps réel est indisponible
  subscriptionPriceUSD: 20, // Prix de référence en USD — le montant HTG facturé est recalculé au taux du jour
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
function uid() {
  __uidCounter = (__uidCounter + 1) % 1000;
  return Date.now() * 1000 + __uidCounter;
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
const FALLBACK_HTG_PER_USD = 130.53; // taux de référence BRH du 07/08/2026, en dernier recours
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

// --- Génération de vrais fichiers PDF téléchargeables (jsPDF, chargé via CDN dans
// index.html) — déclenche un téléchargement direct du fichier, contrairement à
// window.print() qui dépend de la boîte de dialogue d'impression du système et se
// révèle peu fiable pour "Enregistrer en PDF" sur certains navigateurs mobiles
// (Android/iOS). Utilisé pour les factures et les rapports comptables.
const HEADER_RGB = [21, 34, 56];

function downloadInvoicePDF(inv, settings) {
  if (!window.jspdf) { alert("Le générateur de PDF n'a pas fini de charger — réessayez dans quelques secondes."); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text(settings.companyName || "Mon Entreprise", 14, 18);
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  let y = 24;
  if (settings.companyAddress) { doc.text(settings.companyAddress, 14, y); y += 5; }
  const contact = [settings.companyPhone, settings.companyEmail].filter(Boolean).join("  ·  ");
  if (contact) { doc.text(contact, 14, y); y += 5; }
  doc.setTextColor(21, 34, 56);
  doc.setFontSize(14);
  doc.text("FACTURE", 150, 18);
  doc.setFontSize(10);
  doc.text(`N° ${inv.number}`, 150, 25);
  doc.text(String(inv.date), 150, 30);
  doc.setFontSize(10);
  doc.text(`Client : ${inv.client || "Client comptant"}`, 14, Math.max(y, 26) + 4);
  doc.autoTable({
    startY: Math.max(y, 26) + 10,
    head: [["Article", "Qté", "Prix unit.", "Remise", "Sous-total HT", inv.taxLabel || "Taxe"]],
    body: (inv.lines || []).map((l) => [
      l.name, String(l.qty), fmt(l.price),
      l.discountAmt > 0 ? `-${fmt(l.discountAmt)}` : l.discountPct > 0 ? `-${l.discountPct}%` : "—",
      fmt(l.subtotal), fmt(l.taxAmount),
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: HEADER_RGB },
  });
  let ty = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(10);
  doc.text(`Sous-total HT : ${fmt(inv.totalHT)}`, 130, ty); ty += 6;
  if (inv.globalDiscountAmount > 0) { doc.text(`Remise globale : -${fmt(inv.globalDiscountAmount)}`, 130, ty); ty += 6; }
  (inv.fees || []).forEach((f) => { doc.text(`${f.label || "Frais"} : +${fmt(f.amount)}`, 130, ty); ty += 6; });
  doc.text(`${inv.taxLabel || "Taxe"} : ${fmt(inv.totalTax)}`, 130, ty); ty += 8;
  doc.setFontSize(12);
  doc.text(`Total : ${fmt(inv.total)}`, 130, ty); ty += 10;
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(`Mode de paiement : ${inv.paymentMode === "caisse" ? "Caisse" : inv.paymentMode === "banque" ? "Banque" : "Crédit"}`, 14, ty);
  doc.save(`Facture-${inv.number}.pdf`);
}

function downloadTablePDF({ title, settings, columns, rows, footerLines }) {
  if (!window.jspdf) { alert("Le générateur de PDF n'a pas fini de charger — réessayez dans quelques secondes."); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = 16;
  doc.setFontSize(14);
  doc.text(settings.companyName || "Mon Entreprise", 14, y); y += 6;
  if (settings.companyAddress) { doc.setFontSize(9); doc.setTextColor(90, 90, 90); doc.text(settings.companyAddress, 14, y); doc.setTextColor(0, 0, 0); y += 6; }
  doc.setFontSize(12);
  doc.text(title, 14, y + 2); y += 8;
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(`Généré le ${new Date().toISOString().slice(0, 10)}`, 14, y);
  doc.setTextColor(0, 0, 0);
  doc.autoTable({
    startY: y + 5,
    head: [columns],
    body: rows,
    styles: { fontSize: 9 },
    headStyles: { fillColor: HEADER_RGB },
  });
  if (footerLines && footerLines.length) {
    let fy = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(10);
    footerLines.forEach((line) => { doc.text(line, 14, fy); fy += 6; });
  }
  doc.save(`${title.replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.pdf`);
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
  const [payslips, setPayslips] = useState([]);
  const [salaryAdvances, setSalaryAdvances] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [users, setUsers] = useState(DEFAULT_USERS);
  // Journal des modifications : trace qui a fait quoi, où, et quand. Alimenté par
  // logAudit(), défini plus bas une fois currentUserEmail disponible.
  const [auditLog, setAuditLog] = useState([]);
  const [loaded, setLoaded] = useState(false);
  // Suit, catégorie par catégorie, si le CHARGEMENT initial a vraiment réussi. Tant
  // qu'une catégorie n'est pas confirmée chargée, sa sauvegarde automatique reste
  // désactivée — pour ne jamais risquer d'écraser les vraies données du serveur avec
  // la valeur de secours locale (ex. les articles d'exemple) après un simple échec
  // réseau ponctuel au démarrage.
  const loadedCategoriesRef = React.useRef({});
  const [role, setRole] = useState("Administrateur");
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  const [planStatus, setPlanStatus] = useState("active"); // "trial" | "active" | "suspended" — "active" par défaut hors mode Supabase
  const [trialEndsAt, setTrialEndsAt] = useState(null);
  const [needsWelcome, setNeedsWelcome] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [showSecurityPanel, setShowSecurityPanel] = useState(false);
  const readOnly = role === "Lecture seule";
  const allowedModuleIds = ROLE_MODULE_ACCESS[role] || null; // null = accès à tous les modules
  // Contrôle de cohérence Facturation ↔ Journal calculé ici (niveau App), pas
  // seulement dans le module Comptabilité, pour que l'alerte soit visible dès la
  // connexion quel que soit le module ouvert — l'incident du 14/08 (91 factures
  // manquantes) n'a été repéré qu'en ouvrant Comptabilité par hasard, plusieurs
  // jours après son apparition réelle.
  const activeSaleEntriesTop = entries.filter((e) => e.invoiceId && !e.reversalOf && !e.cancelledBy);
  const saleEntriesByInvoiceTop = {};
  activeSaleEntriesTop.forEach((e) => { (saleEntriesByInvoiceTop[e.invoiceId] = saleEntriesByInvoiceTop[e.invoiceId] || []).push(e); });
  const topReconciliationIssueCount =
    Object.values(saleEntriesByInvoiceTop).filter((list) => list.length > 1).length +
    Object.keys(saleEntriesByInvoiceTop).filter((invId) => !invoices.some((inv) => String(inv.id) === invId)).length +
    invoices.filter((inv) => inv.status !== "annulée" && !saleEntriesByInvoiceTop[inv.id]).length;
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

  useEffect(() => {
    (async () => {
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
        setTrialEndsAt(membership.trialEndsAt || null);
        try {
          const { data: pa } = await supabase.from("platform_admins").select("email").eq("email", membership.email).maybeSingle();
          setIsPlatformAdmin(!!pa);
        } catch (e) { /* table absente ou hors mode Supabase : pas admin plateforme */ }
      } catch (e) {
        // pas de session Supabase
      }
      setLoaded(true);
    })();
  }, []);

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

  // Force une nouvelle tentative de sauvegarde immédiate pour toutes les catégories
  // en échec, plutôt que d'attendre la prochaine modification qui la déclencherait
  // normalement — utile en cas de coupure réseau ponctuelle.
  const [retrySaving, setRetrySaving] = useState(false);
  const retryAllSaves = async () => {
    setRetrySaving(true);
    const values = {
      accounts, entries, products, invoices, suppliers, purchases,
      movements, clients, settings, users, productImages, auditLog,
      employees, payslips, salaryAdvances,
    };
    await Promise.all(Object.entries(values).map(async ([cat, val]) => {
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
    setTimeout(() => setToast(null), 2200);
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
        if (acc?.type === "Produit") byMonth[sortKey].produits += Number(l.credit || 0);
        if (acc?.type === "Charge") byMonth[sortKey].charges += Number(l.debit || 0);
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
  const submitWelcome = async () => {
    const name = welcomeName.trim() || "Mon Entreprise";
    setSettings({ ...settings, companyName: name });
    try {
      const { companyId } = await resolveMembership();
      await supabase.from("companies").update({ name }).eq("id", companyId);
    } catch (e) { /* hors mode Supabase, le nom local suffit */ }
    setNeedsWelcome(false);
  };

  if (needsWelcome) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F7F5EF", fontFamily: "'Inter', sans-serif" }}>
        <div className="bg-white rounded-lg p-8 max-w-sm w-full mx-4" style={{ border: "1px solid #E4DFD1" }}>
          <div className="display text-2xl mb-1" style={{ color: "#152238" }}>Bienvenue sur Compta+</div>
          <p className="text-sm mb-5" style={{ color: "#7A7460" }}>
            Votre essai gratuit de 30 jours commence maintenant. Comment s'appelle votre entreprise ?
          </p>
          <input value={welcomeName} onChange={(e) => setWelcomeName(e.target.value)}
            placeholder="Nom de l'entreprise" autoFocus
            className="w-full border rounded px-3 py-2 text-sm mb-4" style={{ borderColor: "#DDD6C4" }}
            onKeyDown={(e) => e.key === "Enter" && submitWelcome()} />
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
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F7F5EF", fontFamily: "'Inter', sans-serif" }}>
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

  if (isBlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F7F5EF", fontFamily: "'Inter', sans-serif" }}>
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

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#F7F5EF", fontFamily: "'Source Sans Pro', 'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Spectral:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');
        .tabular { font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; }
        .display { font-family: 'Spectral', serif; }
        .print-only { display: none; }
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          main { width: 100% !important; }
          body { background: #fff !important; }
          @page { margin: 14mm; }
        }
      `}</style>

      {syncErrorCategories.length > 0 && (
        <div className="px-4 py-2.5 text-sm text-center no-print" style={{ background: "#A6432F", color: "#fff" }}>
          ⚠️ Certaines données n'ont pas pu être synchronisées avec le serveur (connexion interrompue ?). Ce que vous voyez à l'écran n'est peut-être pas encore sauvegardé — évitez de fermer ou recharger la page tant que ce message est affiché. Vérifiez votre connexion internet.
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

      <div className="flex flex-col md:flex-row flex-1 min-h-0">
      {/* Sidebar */}
      {/* Barre mobile */}
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

      {/* Fond assombri derrière le tiroir, sur mobile uniquement */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 md:hidden no-print" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setMobileMenuOpen(false)} />
      )}

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
          {isPlatformAdmin && (
            <>
              <div className="mt-2 px-5 pt-3 pb-1 text-[10px] uppercase tracking-widest" style={{ color: "#5C6B8C" }}>
                Plateforme
              </div>
              <button
                onClick={() => { setActive("superadmin"); setMobileMenuOpen(false); }}
                className="w-full flex items-center gap-3 px-5 py-3 text-sm transition-colors"
                style={{
                  background: active === "superadmin" ? "#1F3358" : "transparent",
                  color: active === "superadmin" ? "#EFE9DD" : "#D9A441",
                  borderLeft: active === "superadmin" ? "3px solid #C9A24B" : "3px solid transparent",
                }}
              >
                <Wallet size={16} />
                <span className="flex-1 text-left">Super Admin — Abonnements</span>
              </button>
            </>
          )}
        </nav>
        <div className="px-5 py-4 text-[11px] border-t" style={{ borderColor: "#28395A", color: "#5C6B8C" }}>
          {readOnly ? (
            <span style={{ color: "#D9A441" }}>Mode lecture seule — les modifications sont désactivées.</span>
          ) : (
            <>Rôle : {role}</>
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
          <button onClick={retryAllSaves} disabled={retrySaving} className="mt-2 underline block" style={{ color: "#8A97B5" }}>
            {retrySaving ? "Sauvegarde en cours…" : "Sauvegarder maintenant"}
          </button>
          <button onClick={() => setShowSecurityPanel(true)} className="mt-1 underline block" style={{ color: "#8A97B5" }}>
            Sécurité du compte
          </button>
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

      {showSecurityPanel && <SecurityPanel onClose={() => setShowSecurityPanel(false)} showToast={showToast} />}

      {/* Main */}
      <main className="flex-1 min-w-0">
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
        <fieldset disabled={readOnly} className="contents">
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
            role={role}
            showToast={showToast}
            logAudit={logAudit}
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
            role={role}
            showToast={showToast}
            logAudit={logAudit}
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
            settings={settings}
            role={role}
            showToast={showToast}
            logAudit={logAudit}
          />
        )}
        {active === "stock" && (
          <StockModule
            products={products}
            setProducts={setProducts}
            movements={movements}
            setMovements={setMovements}
            showToast={showToast}
            logAudit={logAudit}
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
            showToast={showToast}
            logAudit={logAudit}
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
            showToast={showToast}
            logAudit={logAudit}
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
        </fieldset>
        {active === "superadmin" && isPlatformAdmin && (
          <SuperAdminModule showToast={showToast} />
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
                <p className="mb-2"><b>Android (Chrome)</b> : menu ⋮ en haut à droite → « Installer l'application » ou « Ajouter à l'écran d'accueil ».</p>
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

function ComptaModule({ accounts, setAccounts, entries, setEntries, invoices, setInvoices, balances, settings, role, showToast, logAudit }) {
  const lastSubmitRef = React.useRef(0); // anti double-clic/double-tap sur "Enregistrer l'écriture"
  const [tab, setTab] = useState("journal");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [label, setLabel] = useState("");
  const [lines, setLines] = useState([
    { account: accounts[0]?.code, debit: "", credit: "" },
    { account: accounts[1]?.code, debit: "", credit: "" },
  ]);
  const [expanded, setExpanded] = useState(null);
  const [newAccount, setNewAccount] = useState({ code: "", name: "", type: "Charge" });
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
  const activeSaleEntries = entries.filter((e) => e.invoiceId && !e.reversalOf && !e.cancelledBy);
  const saleEntriesByInvoice = {};
  activeSaleEntries.forEach((e) => { (saleEntriesByInvoice[e.invoiceId] = saleEntriesByInvoice[e.invoiceId] || []).push(e); });
  const duplicateSaleGroups = Object.entries(saleEntriesByInvoice).filter(([, list]) => list.length > 1);
  const orphanSaleEntries = Object.entries(saleEntriesByInvoice)
    .filter(([invId]) => !invoices.some((inv) => String(inv.id) === invId))
    .map(([, list]) => list[0]);
  const invoicesWithoutEntry = invoices.filter((inv) => inv.status !== "annulée" && !saleEntriesByInvoice[inv.id]);
  const reconciliationIssueCount = duplicateSaleGroups.length + orphanSaleEntries.length + invoicesWithoutEntry.length;
  const [showReconciliation, setShowReconciliation] = useState(false);

  const fixDuplicateGroup = (list) => {
    if (role !== "Administrateur") { showToast("Seul un administrateur peut corriger ce doublon."); return; }
    const [keep, ...extra] = list;
    if (!window.confirm(`Corriger ${extra.length} écriture(s) en double pour « ${keep.label} » ? Chacune sera contrepassée pour ne garder qu'un seul effet comptable.`)) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    const reversals = extra.map((e) => ({
      id: uid(), date: todayStr, createdAt: new Date().toISOString(), label: `Correction doublon — ${e.label}`, reversalOf: e.id,
      lines: e.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })),
    }));
    setEntries((prev) => [...prev, ...reversals].map((x) => {
      const r = reversals.find((rv) => rv.reversalOf === x.id);
      return r ? { ...x, cancelledBy: r.id } : x;
    }));
    showToast(`${extra.length} écriture(s) en double corrigée(s) par contrepassation.`);
    logAudit("Comptabilité", "Correction doublon vente (contrepassation)", keep.label);
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
    if (!label) {
      showToast("Renseignez un libellé.");
      return;
    }
    if (!balanced) {
      showToast("L'écriture n'est pas équilibrée : le total débit doit égaler le total crédit.");
      return;
    }
    if (isLocked(date, settings)) {
      showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Impossible d'enregistrer une écriture à cette date.`);
      return;
    }
    const cleanLines = lines
      .filter((l) => Number(l.debit) > 0 || Number(l.credit) > 0)
      .map((l) => ({ account: l.account, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 }));
    setEntries((prev) => [...prev, { id: uid(), date, createdAt: new Date().toISOString(), label, lines: cleanLines }]);
    setLabel("");
    setLines([
      { account: accounts[0]?.code, debit: "", credit: "" },
      { account: accounts[1]?.code, debit: "", credit: "" },
    ]);
    showToast("Écriture enregistrée.");
    logAudit("Comptabilité", "Ajout écriture", `${label} — ${fmt(cleanLines.reduce((s, l) => s + l.debit, 0))}`);
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
    const today = new Date().toISOString().slice(0, 10);
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

      <div className="flex gap-1 mb-6">
        {[
          ["journal", "Journal des écritures"],
          ["plan", "Plan comptable"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="px-4 py-2 text-sm rounded-t"
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
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div className="col-span-2">
              <label className="text-xs" style={{ color: "#8A8370" }}>Libellé</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)}
                placeholder="Ex : Vente prestation + matériel, encaissement partiel"
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
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

          <button onClick={addEntry}
            className="flex items-center gap-2 px-4 py-2 rounded text-sm text-white mb-6"
            style={{ background: "#152238" }}>
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
                  <div key={invId} className="flex items-center justify-between gap-2 p-2 rounded bg-white" style={{ border: "1px solid #EEE9DA" }}>
                    <span>« {list[0].label} » enregistrée {list.length} fois dans le journal.</span>
                    {role === "Administrateur" && <button onClick={() => fixDuplicateGroup(list)} className="underline shrink-0" style={{ color: "#A6432F" }}>Corriger (contrepasser le doublon)</button>}
                  </div>
                ))}
                {orphanSaleEntries.map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-2 p-2 rounded bg-white" style={{ border: "1px solid #EEE9DA" }}>
                    <span>« {e.label} » présente dans le journal, absente de Facturation.</span>
                    {role === "Administrateur" && <button onClick={() => rebuildInvoiceFromEntry(e)} className="underline shrink-0" style={{ color: "#A6432F" }}>Recréer la facture</button>}
                  </div>
                ))}
                {invoicesWithoutEntry.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between gap-2 p-2 rounded bg-white" style={{ border: "1px solid #EEE9DA" }}>
                    <span>Facture {inv.number} ({inv.client}, {fmt(inv.total)}) présente dans Facturation, sans écriture correspondante dans le journal.</span>
                    <span className="shrink-0" style={{ color: "#8A8370" }}>Contactez le support — nécessite une vérification manuelle.</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Du</label>
              <input type="date" value={journalFrom} onChange={(e) => setJournalFrom(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
              <input type="date" value={journalTo} onChange={(e) => setJournalTo(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Compte</label>
              <select value={journalAccount} onChange={(e) => setJournalAccount(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
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
                    <tr onClick={() => setExpanded(isOpen ? null : e.id)} className="cursor-pointer" style={{ borderBottom: "1px solid #F3EFE3" }}>
                      <td className="py-2 tabular">{e.date}</td>
                      <td className="py-2">
                        {e.label}
                        {e.cancelledBy && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded" style={{ background: "#EEE9DA", color: "#7A7460" }}>contrepassée</span>}
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
    </div>
  );
}

const COUNTERPART_TYPES = ["Actif", "Passif", "Capitaux propres", "Charge", "Produit"];

function CaisseBanqueModule({ accounts, entries, setEntries, balances, settings, role, showToast, logAudit }) {
  const lastSubmitRef = React.useRef(0); // anti double-clic/double-tap
  const [tab, setTab] = useState("caisse"); // "caisse" | "banque"
  const [expanded, setExpanded] = useState(null);
  const accountName = (code) => accounts.find((a) => a.code === code)?.name || code;
  const compteCode = tab === "caisse" ? "530" : "512";
  const counterparts = accounts.filter((a) => a.code !== compteCode);

  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
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
    if (!form.label || !form.amount || Number(form.amount) <= 0) {
      showToast("Renseignez un libellé et un montant valide.");
      return;
    }
    if (isLocked(form.date, settings)) {
      showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus. Impossible d'enregistrer une opération à cette date.`);
      return;
    }
    const debit = form.sens === "entree" ? compteCode : form.counterpart;
    const credit = form.sens === "entree" ? form.counterpart : compteCode;
    const entry = simpleEntry(form.date, form.label, debit, credit, Number(form.amount));
    entry.reconciled = false;
    setEntries((prev) => [...prev, entry]);
    logAudit("Caisse et banque", tab === "caisse" ? "Opération de caisse" : "Opération bancaire", `${form.label} — ${fmt(Number(form.amount))}`);
    setForm({ ...form, label: "", amount: "" });
    showToast(tab === "caisse" ? "Opération de caisse enregistrée." : "Opération bancaire enregistrée.");
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
    const today = new Date().toISOString().slice(0, 10);
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

      <div className="flex gap-1 mb-6">
        {[
          ["caisse", "Caisse (530)"],
          ["banque", "Banque (512)"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="px-4 py-2 text-sm rounded-t"
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
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
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
        <button onClick={addOp}
          className="flex items-center gap-2 px-4 py-2 rounded text-sm text-white mb-6"
          style={{ background: "#152238" }}>
          <Plus size={14} /> Enregistrer l'opération
        </button>

        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Du</label>
            <input type="date" value={cbFrom} onChange={(e) => setCbFrom(e.target.value)}
              className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
            <input type="date" value={cbTo} onChange={(e) => setCbTo(e.target.value)}
              className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Compte (contrepartie)</label>
            <select value={cbAccount} onChange={(e) => setCbAccount(e.target.value)}
              className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
              <option value="">Tous les comptes</option>
              {counterparts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Sens</label>
            <select value={cbSens} onChange={(e) => setCbSens(e.target.value)}
              className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
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
                <tr onClick={() => setExpanded(isOpen ? null : e.id)} className="cursor-pointer" style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-2 tabular">{e.date}</td>
                  <td className="py-2">
                    {e.label}
                    {e.cancelledBy && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded" style={{ background: "#EEE9DA", color: "#7A7460" }}>contrepassée</span>}
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

function VenteModule({ accounts, entries, setEntries, products, setProducts, productImages, setProductImages, invoices, setInvoices, movements, setMovements, settings, setSettings, role, showToast, logAudit }) {
  const [tab, setTab] = useState("pos");
  const [cart, setCart] = useState([]); // [{productId, qty}]
  const [client, setClient] = useState("");
  const [paymentMode, setPaymentMode] = useState("caisse"); // caisse | banque | credit
  const [editingInvoiceId, setEditingInvoiceId] = useState(null);
  const [saleDate, setSaleDate] = useState(new Date().toISOString().slice(0, 10));
  // Empêche un double-clic (ou double-tap sur écran tactile) de déclencher deux
  // ventes coup sur coup : la seconde lirait un numéro de facture et un état encore
  // périmés avant que l'écran n'ait fini de se mettre à jour après la première.
  const submittingSaleRef = React.useRef(false);
  const [posHistoryOpenId, setPosHistoryOpenId] = useState(null);
  const [printInvoice, setPrintInvoice] = useState(null);
  React.useEffect(() => {
    if (!printInvoice) return;
    const t = setTimeout(() => window.print(), 80);
    const onAfter = () => setPrintInvoice(null);
    window.addEventListener("afterprint", onAfter);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", onAfter); };
  }, [printInvoice]);
  const [posSearch, setPosSearch] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [factFrom, setFactFrom] = useState("");
  const [factTo, setFactTo] = useState("");
  const [factNature, setFactNature] = useState(""); // "" | "payee" | "impayee"
  const [expandedInvoiceId, setExpandedInvoiceId] = useState(null);
  const factFiltered = invoices.filter((inv) =>
    (!factFrom || inv.date >= factFrom) &&
    (!factTo || inv.date <= factTo) &&
    (!factNature || (factNature === "payee" ? inv.status === "payée" : inv.status !== "payée" && inv.status !== "annulée"))
  );
  const factFilteredTotal = factFiltered.reduce((s, inv) => s + Number(inv.total || 0), 0);
  const factPayeeCount = invoices.filter((inv) => inv.status === "payée").length;
  const factImpayeeCount = invoices.filter((inv) => inv.status !== "payée" && inv.status !== "annulée").length;
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
    const lineDiscount = (l.discountAmt || 0) > 0 ? Math.min(Number(l.discountAmt), gross) : gross * ((l.discountPct || 0) / 100);
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
    if (cartLines.length === 0) {
      showToast("Le panier est vide.");
      return;
    }
    if (paymentMode === "credit" && !client) {
      showToast("Indiquez le nom du client pour une vente à crédit.");
      return;
    }
    const invId = uid();
    const date = saleDate || new Date().toISOString().slice(0, 10);
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
      await validateSaleCommit(invId, date);
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

    const payAccount = paymentMode === "caisse" ? "530" : paymentMode === "banque" ? "512" : "411";

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
    const saleEntry = {
      id: uid(),
      invoiceId: editingInvoiceId || invId,
      date,
      createdAt: new Date().toISOString(),
      label: `Vente ${invNumber}${client ? " — " + client : ""}`,
      lines: [
        { account: payAccount, debit: total, credit: 0 },
        ...Object.entries(byAccount).map(([acc, amount]) => ({ account: acc, debit: 0, credit: amount })),
        ...(totalTax > 0 ? [{ account: settings.taxAccount, debit: 0, credit: totalTax }] : []),
      ],
    };
    const newInvoice = {
      id: editingInvoiceId || invId,
      number: invNumber,
      date,
      createdAt: (editingInvoiceId && invoices.find((i) => i.id === editingInvoiceId)) ? invoices.find((i) => i.id === editingInvoiceId).createdAt : new Date().toISOString(),
      client: client || "Client comptant",
      lines: cartLines.map((l) => ({ productId: l.productId, name: l.product.name, qty: l.qty, price: l.product.price, discountPct: l.discountPct || 0, discountAmt: l.discountAmt || 0, subtotal: l.subtotal, tva: l.product.tva, taxAmount: l.taxAmount })),
      globalDiscountPct: Number(globalDiscountPct) || 0,
      globalDiscountAmtInput: Number(globalDiscountAmt) || 0,
      globalDiscountAmount,
      fees: fees.filter((f) => Number(f.amount) > 0).map((f) => ({ label: f.label || "Frais", amount: Number(f.amount), account: f.account })),
      totalHT,
      totalTax,
      taxLabel,
      total,
      paymentMode,
      status: "payée", // recalculé juste après si la facture est à crédit
    };
    const old = editingInvoiceId ? invoices.find((i) => i.id === editingInvoiceId) : null;
    if (paymentMode === "credit") {
      const carriedPayments = old?.payments || [];
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
      setEntries((prev) => prev.filter((e) => e.invoiceId !== editingInvoiceId).concat(saleEntry));
      setInvoices((prev) => prev.map((i) => (i.id === editingInvoiceId ? newInvoice : i)));
    } else {
      setEntries((prev) => [...prev, saleEntry]);
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
    setSaleDate(new Date().toISOString().slice(0, 10));
    showToast(editingInvoiceId ? `Facture ${invNumber} mise à jour.` : `Facture ${invNumber} créée (${paymentMode === "credit" ? "à encaisser" : "payée"}).`);
    logAudit("Vente", editingInvoiceId ? "Modification facture" : "Création facture", `${invNumber} — ${fmt(total)}`);
  };

  const lastEncaissementRef = React.useRef(0);
  const encaisserFacture = (inv, compte, montant) => {
    if (Date.now() - lastEncaissementRef.current < 800) return; // double-clic/double-tap ignoré
    lastEncaissementRef.current = Date.now();
    const restant = balanceDue(inv);
    const amt = montant == null ? restant : Math.min(Math.max(0, Number(montant) || 0), restant);
    if (amt <= 0) {
      showToast("Montant invalide ou facture déjà soldée.");
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    setEntries((prev) => [
      ...prev,
      simpleEntry(date, `${amt < restant ? "Encaissement partiel" : "Encaissement"} ${inv.number} — ${inv.client}`, compte, "411", amt),
    ]);
    const newPayments = [...(inv.payments || []), { id: uid(), date, createdAt: new Date().toISOString(), amount: amt, account: compte }];
    const newStatus = amt >= restant ? "payée" : "partielle";
    setInvoices((prev) => prev.map((i) => (i.id === inv.id ? { ...i, payments: newPayments, status: newStatus } : i)));
    showToast(newStatus === "payée" ? `Facture ${inv.number} soldée.` : `Paiement partiel de ${fmt(amt)} enregistré sur ${inv.number} (reste dû : ${fmt(restant - amt)}).`);
    logAudit("Vente", newStatus === "payée" ? "Encaissement facture" : "Encaissement partiel facture", `${inv.number} — ${fmt(amt)}`);
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
    const today = new Date().toISOString().slice(0, 10);
    const original = entries.find((e) => e.invoiceId === inv.id);
    if (original) {
      const reversal = {
        id: uid(),
        invoiceId: inv.id,
        date: today,
        label: `Annulation facture ${inv.number}`,
        lines: original.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })),
      };
      setEntries((prev) => [...prev, reversal]);
    }
    // Contrepasse aussi les encaissements/paiements partiels déjà reçus sur cette facture
    (inv.payments || []).forEach((p) => {
      setEntries((prev) => [
        ...prev,
        simpleEntry(today, `Annulation encaissement ${inv.number}`, "411", p.account, p.amount),
      ]);
    });
    // Restitue le stock des marchandises vendues via un mouvement d'entrée (traçable), sans supprimer l'historique des sorties
    const stockLines = (inv.lines || []).filter((l) => products.find((p) => p.id === l.productId && p.type === "marchandise"));
    if (stockLines.length > 0) {
      setProducts((prev) => prev.map((p) => {
        const line = stockLines.find((l) => l.productId === p.id);
        return line ? { ...p, stock: (p.stock || 0) + line.qty } : p;
      }));
      setMovements((prev) => [
        ...prev,
        ...stockLines.map((l) => ({
          id: uid(), invoiceId: inv.id, date: today, createdAt: new Date().toISOString(), productId: l.productId, productName: l.name,
          type: "entree", qty: l.qty, reason: `Annulation facture ${inv.number}`,
        })),
      ]);
    }
    setInvoices((prev) => prev.map((i) => (i.id === inv.id ? { ...i, status: "annulée" } : i)));
    showToast(`Facture ${inv.number} annulée par contrepassation.`);
    logAudit("Vente", "Annulation facture (contrepassation)", `${inv.number} — ${fmt(inv.total)}`);
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
    setSaleDate(inv.date || new Date().toISOString().slice(0, 10));
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
    setSaleDate(new Date().toISOString().slice(0, 10));
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

      <div className="flex gap-1 mb-6">
        {[["pos", "Point de vente"], ["factures", "Factures"], ["catalogue", "Catalogue"]].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="px-4 py-2 text-sm rounded-t"
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
            <input value={posSearch} onChange={(e) => setPosSearch(e.target.value)} placeholder="Rechercher un article..."
              className="w-full border rounded px-3 py-2 text-sm mb-3" style={{ borderColor: "#DDD6C4" }} />
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
                              background: inv.status === "payée" ? "#E6F1EE" : inv.status === "partielle" ? "#FBF1DC" : "#F7E9E3",
                              color: inv.status === "payée" ? "#0F6B5C" : inv.status === "partielle" ? "#9A7B1E" : "#A6432F",
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
                        {l.lineDiscount > 0 && <div className="tabular text-xs line-through" style={{ color: "#A39C87" }}>{fmt(l.gross)}</div>}
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
                        className="w-14 border rounded px-1 py-0.5 text-xs tabular" style={{ borderColor: "#DDD6C4" }} />
                      <span className="text-xs" style={{ color: "#A39C87" }}>montant</span>
                    </div>
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
                <span>Sous-total lignes</span><span>{fmt(linesTotalHT)}</span>
              </div>
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
              <input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Nom du client (optionnel)"
              className="w-full border rounded px-2 py-1.5 text-sm mb-2" style={{ borderColor: "#DDD6C4" }} />
            <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}
              className="w-full border rounded px-2 py-1.5 text-sm mb-3" style={{ borderColor: "#DDD6C4" }}>
              <option value="caisse">Paiement en caisse</option>
              <option value="banque">Paiement par banque</option>
              <option value="credit">Vente à crédit (client)</option>
            </select>
            <button onClick={validateSale} className="w-full py-2 rounded text-sm text-white" style={{ background: "#152238" }}>
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
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
              <input type="date" value={factTo} onChange={(e) => setFactTo(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Nature</label>
              <select value={factNature} onChange={(e) => setFactNature(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
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
                        background: inv.status === "annulée" ? "#EEE9DA" : inv.status === "payée" ? "#E6F1EE" : inv.status === "partielle" ? "#FBF1DC" : "#F7E9E3",
                        color: inv.status === "annulée" ? "#7A7460" : inv.status === "payée" ? "#0F6B5C" : inv.status === "partielle" ? "#9A7B1E" : "#A6432F",
                        textDecoration: inv.status === "annulée" ? "line-through" : "none",
                      }}>
                      {inv.status === "partielle" ? `partielle (reste ${fmt(balanceDue(inv))})` : inv.status}
                    </span>
                  </td>
                  <td className="py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1 justify-end items-center">
                      {inv.status !== "payée" && inv.status !== "annulée" && (
                        <>
                          <button onClick={() => encaisserFacture(inv, "530")} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Encaisser (caisse)</button>
                          <button onClick={() => encaisserFacture(inv, "512")} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Encaisser (banque)</button>
                        </>
                      )}
                      <button onClick={() => setPrintInvoice(inv)} title="Imprimer" style={{ color: "#152238" }}><Printer size={14} /></button>
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
                        <div>Mode de paiement : {inv.paymentMode === "caisse" ? "Caisse" : inv.paymentMode === "banque" ? "Banque" : "Crédit"}</div>
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

      {tab === "catalogue" && (
        <fieldset disabled={role === "Vendeur"} className="contents">
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
        </fieldset>
      )}

      {showScanner && (
        <BarcodeScannerModal
          onScan={(code) => { setNewProduct((p) => ({ ...p, code })); setShowScanner(false); showToast("Code scanné avec succès."); }}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>

      {printInvoice && (
        <div className="print-only" style={{ color: "#152238", fontFamily: "'Inter', sans-serif" }}>
          <div className="flex justify-between items-start mb-6" style={{ borderBottom: "2px solid #152238", paddingBottom: 16 }}>
            <div>
              <div className="display" style={{ fontSize: 22, fontWeight: 700 }}>{settings.companyName || "Mon Entreprise"}</div>
              {settings.companyAddress && <div style={{ fontSize: 12, color: "#555" }}>{settings.companyAddress}</div>}
              {(settings.companyPhone || settings.companyEmail) && (
                <div style={{ fontSize: 12, color: "#555" }}>{[settings.companyPhone, settings.companyEmail].filter(Boolean).join(" · ")}</div>
              )}
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>FACTURE</div>
              <div className="tabular" style={{ fontSize: 13 }}>N° {printInvoice.number}</div>
              <div className="tabular" style={{ fontSize: 13 }}>{printInvoice.date}</div>
            </div>
          </div>

          <div className="flex justify-between mb-6" style={{ fontSize: 13 }}>
            <div>
              <div style={{ color: "#888", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Facturé à</div>
              <div style={{ fontWeight: 600, marginTop: 2 }}>{printInvoice.client || "Client comptant"}</div>
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
            Mode de paiement : {printInvoice.paymentMode === "caisse" ? "Caisse" : printInvoice.paymentMode === "banque" ? "Banque" : "Crédit"} — Merci de votre confiance.
          </div>
        </div>
      )}
    </>
  );
}

function AchatModule({ accounts, entries, setEntries, suppliers, setSuppliers, purchases, setPurchases, settings, role, showToast, logAudit }) {
  const lastSubmitRef = React.useRef(0); // anti double-clic/double-tap sur "Enregistrer l'achat"
  const [tab, setTab] = useState("achats");
  const chargeAccounts = accounts.filter((a) => a.type === "Charge");
  const accountName = (code) => accounts.find((a) => a.code === code)?.name || code;
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    supplierId: suppliers[0]?.id,
    label: "",
    account: chargeAccounts[0]?.code,
    amount: "",
    paymentMode: "credit", // caisse | banque | credit
  });
  const [newSupplier, setNewSupplier] = useState({ name: "", contact: "" });
  const [editingPurchaseId, setEditingPurchaseId] = useState(null);
  const [editingSupplierId, setEditingSupplierId] = useState(null);
  const [achatFrom, setAchatFrom] = useState("");
  const [achatTo, setAchatTo] = useState("");
  const [achatSupplier, setAchatSupplier] = useState(""); // filtre par fournisseur
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
    if (!form.label || !form.amount || Number(form.amount) <= 0) {
      showToast("Renseignez un libellé et un montant valide.");
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

    if (editingPurchaseId) {
      setEntries((prev) => prev.map((e) =>
        e.id === editingPurchaseId
          ? { ...simpleEntry(form.date, label, form.account, payAccount, Number(form.amount)), id: editingPurchaseId }
          : e
      ));
      setPurchases((prev) => prev.map((p) =>
        p.id === editingPurchaseId
          ? { ...p, date: form.date, supplier: supplier?.name || "Fournisseur", label: form.label, amount: Number(form.amount), paymentMode: form.paymentMode, status: form.paymentMode === "credit" ? "à payer" : "payé" }
          : p
      ));
      setEditingPurchaseId(null);
      showToast("Achat modifié.");
      logAudit("Achat", "Modification achat", `${form.label} — ${fmt(Number(form.amount))} (${supplier?.name || "Fournisseur"})`);
    } else {
      const purchaseId = uid();
      setEntries((prev) => [...prev, { ...simpleEntry(form.date, label, form.account, payAccount, Number(form.amount)), id: purchaseId }]);
      setPurchases((prev) => [
        ...prev,
        {
          id: purchaseId,
          date: form.date,
          createdAt: new Date().toISOString(),
          supplier: supplier?.name || "Fournisseur",
          label: form.label,
          amount: Number(form.amount),
          paymentMode: form.paymentMode,
          status: form.paymentMode === "credit" ? "à payer" : "payé",
        },
      ]);
      showToast("Achat enregistré.");
      logAudit("Achat", "Ajout achat", `${form.label} — ${fmt(Number(form.amount))} (${supplier?.name || "Fournisseur"})`);
    }
    setForm({ ...form, label: "", amount: "" });
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
    const today = new Date().toISOString().slice(0, 10);
    const original = entries.find((e) => e.id === p.id);
    if (original) {
      setEntries((prev) => [
        ...prev,
        {
          id: uid(),
          date: today,
          createdAt: new Date().toISOString(),
          label: `Annulation achat — ${p.label} (${p.supplier})`,
          lines: original.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })),
        },
      ]);
    }
    setPurchases((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: "annulé" } : x)));
    if (editingPurchaseId === p.id) cancelEditPurchase();
    showToast("Achat annulé par contrepassation.");
    logAudit("Achat", "Annulation achat (contrepassation)", `${p.label} — ${fmt(p.amount)}`);
  };

  const addSupplier = () => {
    if (!newSupplier.name) {
      showToast("Le nom du fournisseur est requis.");
      return;
    }
    if (editingSupplierId) {
      const oldName = suppliers.find((s) => s.id === editingSupplierId)?.name;
      setSuppliers((prev) => prev.map((s) => (s.id === editingSupplierId ? { ...s, ...newSupplier } : s)));
      if (oldName && oldName !== newSupplier.name) {
        setPurchases((prev) => prev.map((p) => (p.supplier === oldName ? { ...p, supplier: newSupplier.name } : p)));
      }
      setEditingSupplierId(null);
      showToast("Fournisseur modifié.");
      logAudit("Achat", "Modification fournisseur", newSupplier.name);
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
    const today = new Date().toISOString().slice(0, 10);
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

      <div className="flex gap-1 mb-6">
        {[["achats", "Achats"], ["fournisseurs", "Fournisseurs"]].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="px-4 py-2 text-sm rounded-t"
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
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5 items-end">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Date</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
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
            </div>
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
          </div>
          <div className="mb-5">
            <label className="text-xs" style={{ color: "#8A8370" }}>Règlement</label>
            <select value={form.paymentMode} onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}
              className="border rounded px-2 py-1.5 text-sm mt-1 block" style={{ borderColor: "#DDD6C4" }}>
              <option value="credit">À crédit (fournisseur à payer)</option>
              <option value="caisse">Payé comptant — caisse</option>
              <option value="banque">Payé comptant — banque</option>
            </select>
          </div>
          <button onClick={addPurchase} className="flex items-center gap-2 px-4 py-2 rounded text-sm text-white mb-2" style={{ background: "#152238" }}>
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
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
              <input type="date" value={achatTo} onChange={(e) => setAchatTo(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Fournisseur</label>
              <select value={achatSupplier} onChange={(e) => setAchatSupplier(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="">Tous les fournisseurs</option>
                {suppliers.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            {(achatFrom || achatTo || achatSupplier) && (
              <button onClick={() => { setAchatFrom(""); setAchatTo(""); setAchatSupplier(""); }} className="text-xs underline mb-1.5" style={{ color: "#8A8370" }}>
                Réinitialiser
              </button>
            )}
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
    </div>
  );
}

function StockModule({ products, setProducts, movements, setMovements, showToast, logAudit }) {
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
    if (!form.qty || Number(form.qty) <= 0) {
      showToast("Renseignez une quantité valide.");
      return;
    }
    const product = products.find((p) => p.id === Number(form.productId));
    if (!product) return;
    const delta = form.type === "sortie" ? -Number(form.qty) : Number(form.qty);
    const reason = form.reason || (form.type === "entree" ? "Réception fournisseur" : form.type === "sortie" ? "Sortie manuelle" : "Ajustement d'inventaire");
    const date = new Date().toISOString().slice(0, 10);
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
      showToast("Impossible d'ajuster le stock (connexion instable). Réessayez.");
      return;
    }
    setForm({ ...form, qty: "", reason: "" });
    showToast("Mouvement de stock enregistré.");
    logAudit("Stock", form.type === "entree" ? "Entrée stock" : form.type === "sortie" ? "Sortie stock" : "Ajustement stock", `${product.name} — ${form.type === "sortie" ? "-" : "+"}${form.qty}`);
  };

  const deleteMovement = async (m) => {
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
      setProducts((prev) => prev.map((p) => (p.id === m.productId ? { ...p, stock: result.newStock } : p)));
    } catch (e) {
      showToast("Impossible d'ajuster le stock (connexion instable). Réessayez.");
      return;
    }
    setMovements((prev) => prev.filter((x) => x.id !== m.id));
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

      <div className="flex gap-1 mb-6">
        {[["inventaire", "Inventaire"], ["mouvements", "Mouvements"]].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="px-4 py-2 text-sm rounded-t"
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
                  className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
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
          {stockProducts.length > 0 && (
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
                  <option value="ajustement">Ajustement</option>
                </select>
              </div>
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Quantité</label>
                <input type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
              </div>
              <button onClick={addMovement} className="flex items-center justify-center gap-2 px-4 py-2 rounded text-sm text-white h-[38px]" style={{ background: "#152238" }}>
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
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
              <input type="date" value={movTo} onChange={(e) => setMovTo(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            {(movFrom || movTo || movProductFilter) && (
              <button onClick={() => { setMovFrom(""); setMovTo(""); setMovProductFilter(""); }} className="text-xs underline mb-1.5" style={{ color: "#8A8370" }}>
                Réinitialiser
              </button>
            )}
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Trier par</label>
              <select value={movSort} onChange={(e) => setMovSort(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
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
                    <button onClick={() => deleteMovement(m)} title="Supprimer" style={{ color: "#A6432F" }}><Trash2 size={14} /></button>
                  </td>
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

function CRMModule({ clients, setClients, invoices, setInvoices, entries, setEntries, showToast, logAudit }) {
  const [newClient, setNewClient] = useState({ name: "", email: "", phone: "" });
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("clients");
  const [payAmounts, setPayAmounts] = useState({});

  // Fusionne les clients déclarés et les noms de clients apparus dans les factures
  const invoiceNames = [...new Set(invoices.map((i) => i.client).filter((n) => n && n !== "Client comptant"))];
  const rows = invoiceNames.map((name) => {
    const known = clients.find((c) => c.name === name);
    const clientInvoices = invoices.filter((i) => i.client === name);
    const total = clientInvoices.reduce((s, i) => s + i.total, 0);
    const due = clientInvoices.filter((i) => i.status !== "payée").reduce((s, i) => s + balanceDue(i), 0);
    const lastDate = clientInvoices.reduce((max, i) => (i.date > max ? i.date : max), "");
    return { name, email: known?.email || "", phone: known?.phone || "", nb: clientInvoices.length, total, due, lastDate, invoices: clientInvoices };
  });

  const dueInvoicesAll = invoices.filter((i) => i.status !== "payée" && i.status !== "annulée");
  const paidInvoices = invoices.filter((i) => i.status === "payée");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [dueClient, setDueClient] = useState("");
  const [dueStatus, setDueStatus] = useState(""); // "" | "impayée" | "partielle"
  const dueClientOptions = [...new Set(dueInvoicesAll.map((i) => i.client))];
  const dueInvoices = dueInvoicesAll.filter((i) =>
    (!dueFrom || i.date >= dueFrom) &&
    (!dueTo || i.date <= dueTo) &&
    (!dueClient || i.client === dueClient) &&
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
    const restant = balanceDue(inv);
    const amt = montant == null ? restant : Math.min(Math.max(0, Number(montant) || 0), restant);
    if (amt <= 0) {
      showToast("Montant invalide ou facture déjà soldée.");
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    setEntries((prev) => [
      ...prev,
      simpleEntry(date, `${amt < restant ? "Recouvrement partiel" : "Encaissement"} ${inv.number} — ${inv.client}`, compte, "411", amt),
    ]);
    const newPayments = [...(inv.payments || []), { id: uid(), date, createdAt: new Date().toISOString(), amount: amt, account: compte }];
    const newStatus = amt >= restant ? "payée" : "partielle";
    setInvoices((prev) => prev.map((i) => (i.id === inv.id ? { ...i, payments: newPayments, status: newStatus } : i)));
    setPayAmounts((p) => ({ ...p, [inv.id]: "" }));
    showToast(newStatus === "payée"
      ? `Facture ${inv.number} régularisée — déplacée vers Clients payés.`
      : `Recouvrement partiel de ${fmt(amt)} enregistré sur ${inv.number} (reste dû : ${fmt(restant - amt)}).`);
    logAudit("CRM", newStatus === "payée" ? "Régularisation facture" : "Recouvrement partiel", `${inv.number} — ${fmt(amt)}`);
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

      <div className="flex gap-1 mb-6">
        {[["clients", "Clients"], ["dus", `Clients dûs${dueInvoicesAll.length ? ` (${dueInvoicesAll.length})` : ""}`], ["payes", "Clients payés"]].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="px-4 py-2 text-sm rounded-t"
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
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <React.Fragment key={r.name}>
                  <tr
                    onClick={() => setSelected(selected === r.name ? null : r.name)}
                    className="cursor-pointer"
                    style={{ borderBottom: "1px solid #F3EFE3" }}
                  >
                    <td className="py-2 font-medium" style={{ color: "#152238" }}>{r.name}</td>
                    <td className="py-2" style={{ color: "#7A7460" }}>{r.email || r.phone || "—"}</td>
                    <td className="py-2 tabular text-right">{r.nb}</td>
                    <td className="py-2 tabular text-right">{fmt(r.total)}</td>
                    <td className="py-2 tabular text-right" style={{ color: r.due > 0 ? "#A6432F" : "#0F6B5C" }}>{fmt(r.due)}</td>
                    <td className="py-2 tabular">{r.lastDate}</td>
                  </tr>
                  {selected === r.name && (
                    <tr>
                      <td colSpan={6} className="py-3 px-3" style={{ background: "#FAF8F1" }}>
                        <div className="text-xs uppercase tracking-widest mb-2" style={{ color: "#8A8370" }}>Historique des factures</div>
                        <div className="overflow-x-auto"><table className="w-full text-xs">
                          <tbody>
                            {r.invoices.map((inv) => (
                              <tr key={inv.id}>
                                <td className="py-1 tabular">{inv.number}</td>
                                <td className="py-1 tabular">{inv.date}</td>
                                <td className="py-1 tabular text-right">{fmt(inv.total)}</td>
                                <td className="py-1 text-right">
                                  <span className="px-2 py-0.5 rounded" style={{ background: inv.status === "payée" ? "#E6F1EE" : "#F7E9E3", color: inv.status === "payée" ? "#0F6B5C" : "#A6432F" }}>
                                    {inv.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table></div>
                      </td>
                    </tr>
                  )}
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
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
              <input type="date" value={dueTo} onChange={(e) => setDueTo(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Client</label>
              <select value={dueClient} onChange={(e) => setDueClient(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="">Tous les clients</option>
                {dueClientOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Statut</label>
              <select value={dueStatus} onChange={(e) => setDueStatus(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
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
                </tr>
              </thead>
              <tbody>
                {[...dueInvoices].reverse().map((inv) => {
                  const paid = (inv.payments || []).reduce((s, p) => s + p.amount, 0);
                  const restant = balanceDue(inv);
                  return (
                  <tr key={inv.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                    <td className="py-2 tabular">{inv.number}</td>
                    <td className="py-2 tabular">{inv.date}<RecordedStamp createdAt={inv.createdAt} /></td>
                    <td className="py-2">{inv.client}</td>
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
                        <input type="number" min="0" max={restant} placeholder={`≤ ${fmt(restant)}`}
                          value={payAmounts[inv.id] || ""}
                          onChange={(e) => setPayAmounts((p) => ({ ...p, [inv.id]: e.target.value }))}
                          className="w-24 border rounded px-1.5 py-1 text-xs tabular" style={{ borderColor: "#DDD6C4" }} />
                        <button onClick={() => encaisserFacture(inv, "530", payAmounts[inv.id] || null)} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Caisse</button>
                        <button onClick={() => encaisserFacture(inv, "512", payAmounts[inv.id] || null)} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Banque</button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
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
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
              <input type="date" value={paidTo} onChange={(e) => setPaidTo(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Client</label>
              <select value={paidClient} onChange={(e) => setPaidClient(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
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
                </tr>
              </thead>
              <tbody>
                {[...paidInvoicesFiltered].reverse().map((inv) => (
                  <tr key={inv.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                    <td className="py-2 tabular">{inv.number}</td>
                    <td className="py-2 tabular">{inv.date}<RecordedStamp createdAt={inv.createdAt} /></td>
                    <td className="py-2">{inv.client}</td>
                    <td className="py-2 tabular text-right" style={{ color: "#0F6B5C" }}>{fmt(inv.total)}</td>
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

// --- Module 9 : Salaires (RH) ---
function PayrollModule({ accounts, setAccounts, entries, setEntries, employees, setEmployees, payslips, setPayslips, salaryAdvances, setSalaryAdvances, settings, role, showToast, logAudit }) {
  const today = new Date().toISOString().slice(0, 10);
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
    if (!advForm.employeeId) { showToast("Sélectionnez un employé."); return; }
    if (!advForm.amount || Number(advForm.amount) <= 0) { showToast("Montant invalide."); return; }
    if (isLocked(advForm.date, settings)) { showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus.`); return; }
    const emp = employees.find((e) => String(e.id) === String(advForm.employeeId));
    if (!emp) { showToast("Employé introuvable."); return; }
    const payAccount = advForm.paymentMode === "banque" ? "512" : "530";
    const advanceId = uid();
    setEntries((prev) => [...prev, {
      id: advanceId, date: advForm.date, createdAt: new Date().toISOString(), label: `Avance sur salaire — ${emp.name}`,
      lines: [{ account: "425", debit: Number(advForm.amount), credit: 0 }, { account: payAccount, debit: 0, credit: Number(advForm.amount) }],
    }]);
    setSalaryAdvances((prev) => [...prev, {
      id: advanceId, employeeId: emp.id, employeeName: emp.name, date: advForm.date, createdAt: new Date().toISOString(),
      amount: Number(advForm.amount), reason: advForm.reason, paymentMode: advForm.paymentMode,
      repaidAmount: 0, status: "en cours",
    }]);
    showToast("Avance enregistrée.");
    logAudit("Salaires (RH)", "Avance sur salaire", `${emp.name} — ${fmt(Number(advForm.amount))}`);
    setAdvForm(emptyAdvForm);
  };

  const cancelAdvance = (adv) => {
    if (role !== "Administrateur") { showToast("Seul un administrateur peut annuler une avance."); return; }
    if (adv.status === "annulée") { showToast("Cette avance est déjà annulée."); return; }
    if (adv.repaidAmount > 0) { showToast("Cette avance a déjà été partiellement remboursée sur un bulletin — annulez d'abord ce bulletin."); return; }
    if (isLocked(adv.date, settings)) { showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus.`); return; }
    if (!window.confirm(`Annuler l'avance de ${fmt(adv.amount)} pour ${adv.employeeName} ? Une écriture de contrepassation sera générée.`)) return;
    const original = entries.find((e) => e.id === adv.id);
    if (original) {
      setEntries((prev) => [...prev, {
        id: uid(), date: today, createdAt: new Date().toISOString(), label: `Annulation avance — ${adv.employeeName}`,
        lines: original.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })),
      }]);
    }
    setSalaryAdvances((prev) => prev.map((x) => (x.id === adv.id ? { ...x, status: "annulée" } : x)));
    showToast("Avance annulée par contrepassation.");
    logAudit("Salaires (RH)", "Annulation avance (contrepassation)", `${adv.employeeName} — ${fmt(adv.amount)}`);
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
    if (!selectedEmployee) { showToast("Sélectionnez un employé."); return; }
    if (!payForm.periodStart || !payForm.periodEnd) { showToast("La période (du / au) est requise."); return; }
    if (grossTotal <= 0) { showToast("Le montant brut doit être positif."); return; }
    if (isLocked(payForm.date, settings)) { showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus.`); return; }
    const advanceRepayment = Number(payForm.advanceRepayment) || 0;
    if (selectedAdvance && advanceRepayment > selectedAdvanceRemaining + 0.001) {
      showToast(`Le remboursement dépasse le solde restant de l'avance (${fmt(selectedAdvanceRemaining)}).`);
      return;
    }
    if (netTotal < -0.001) { showToast("Le net à payer est négatif — réduisez les déductions ou le remboursement d'avance."); return; }

    const payAccount = payForm.paymentMode === "banque" ? "512" : "530";
    const deduction = Number(payForm.deductionCSSONA) || 0;
    const lines = [{ account: "641", debit: grossTotal, credit: 0 }];
    if (deduction > 0) lines.push({ account: "431", debit: 0, credit: deduction });
    if (advanceRepayment > 0) lines.push({ account: "425", debit: 0, credit: advanceRepayment });
    lines.push({ account: payAccount, debit: 0, credit: Math.max(0, netTotal) });

    const payslipId = uid();
    setEntries((prev) => [...prev, {
      id: payslipId, date: payForm.date, createdAt: new Date().toISOString(),
      label: `Paie — ${selectedEmployee.name} (${payForm.periodStart} au ${payForm.periodEnd})`,
      lines,
    }]);
    setPayslips((prev) => [...prev, {
      id: payslipId, employeeId: selectedEmployee.id, employeeName: selectedEmployee.name,
      periodStart: payForm.periodStart, periodEnd: payForm.periodEnd, date: payForm.date, createdAt: new Date().toISOString(),
      baseSalary: baseSalaryAmount, overtimeHours: Number(payForm.overtimeHours) || 0, overtimeRate: selectedEmployee.overtimeRate || 0, overtimeAmount,
      bonusAmount: Number(payForm.bonusAmount) || 0, bonusNote: payForm.bonusNote,
      deductionCSSONA: deduction, advanceId: selectedAdvance ? selectedAdvance.id : null, advanceRepayment,
      paymentMode: payForm.paymentMode, grossTotal, netTotal, status: "payé",
    }]);
    if (selectedAdvance && advanceRepayment > 0) {
      const advId = selectedAdvance.id;
      setSalaryAdvances((prev) => prev.map((a) => {
        if (a.id !== advId) return a;
        const newRepaid = a.repaidAmount + advanceRepayment;
        return { ...a, repaidAmount: newRepaid, status: newRepaid >= a.amount - 0.001 ? "remboursée" : "en cours" };
      }));
    }
    showToast(`Bulletin de paie enregistré — net à payer ${fmt(netTotal)}.`);
    logAudit("Salaires (RH)", "Bulletin de paie", `${selectedEmployee.name} — net ${fmt(netTotal)}`);
    setPayForm(emptyPayForm);
  };

  const cancelPayslip = (p) => {
    if (role !== "Administrateur") { showToast("Seul un administrateur peut annuler un bulletin de paie."); return; }
    if (p.status === "annulé") { showToast("Ce bulletin est déjà annulé."); return; }
    if (isLocked(p.date, settings)) { showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus.`); return; }
    if (!window.confirm(`Annuler le bulletin de paie de ${p.employeeName} (net ${fmt(p.netTotal)}) ? Une écriture de contrepassation sera générée.`)) return;
    const original = entries.find((e) => e.id === p.id);
    if (original) {
      setEntries((prev) => [...prev, {
        id: uid(), date: today, createdAt: new Date().toISOString(), label: `Annulation paie — ${p.employeeName} (${p.periodStart} au ${p.periodEnd})`,
        lines: original.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })),
      }]);
    }
    setPayslips((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: "annulé" } : x)));
    if (p.advanceId && p.advanceRepayment > 0) {
      setSalaryAdvances((prev) => prev.map((a) => (a.id === p.advanceId ? { ...a, repaidAmount: Math.max(0, a.repaidAmount - p.advanceRepayment), status: "en cours" } : a)));
    }
    showToast("Bulletin annulé par contrepassation.");
    logAudit("Salaires (RH)", "Annulation bulletin (contrepassation)", `${p.employeeName} — ${fmt(p.netTotal)}`);
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

      <div className="flex gap-1 mb-6">
        {[["employes", "Employés"], ["avances", "Avances sur salaire"], ["bulletins", "Bulletins de paie"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className="px-4 py-2 text-sm rounded-t"
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
              <input type="date" value={advForm.date} onChange={(e) => setAdvForm({ ...advForm, date: e.target.value })}
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
          <button onClick={giveAdvance} className="px-4 py-2 rounded text-sm text-white mb-6" style={{ background: "#152238" }}>+ Enregistrer l'avance</button>

          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Du</label>
              <input type="date" value={advFrom} onChange={(e) => setAdvFrom(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
              <input type="date" value={advTo} onChange={(e) => setAdvTo(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Employé</label>
              <select value={advEmployee} onChange={(e) => setAdvEmployee(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="">Tous</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Statut</label>
              <select value={advStatus} onChange={(e) => setAdvStatus(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
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
              <input type="date" value={payForm.periodStart} onChange={(e) => setPayForm({ ...payForm, periodStart: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Période au</label>
              <input type="date" value={payForm.periodEnd} onChange={(e) => setPayForm({ ...payForm, periodEnd: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Date de paiement</label>
              <input type="date" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })}
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

          <button onClick={processPayslip} className="px-4 py-2 rounded text-sm text-white mb-6" style={{ background: "#152238" }}>+ Enregistrer le bulletin de paie</button>

          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Du</label>
              <input type="date" value={payFrom} onChange={(e) => setPayFrom(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
              <input type="date" value={payTo} onChange={(e) => setPayTo(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Employé</label>
              <select value={payEmployee} onChange={(e) => setPayEmployee(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="">Tous</option>
                {allEmployeeOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Statut</label>
              <select value={payStatus} onChange={(e) => setPayStatus(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
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
      byMonth[key] = (byMonth[key] || 0) + inv.total;
    });
    return Object.entries(byMonth).map(([mois, total]) => ({ mois, total }));
  }, [invoices]);

  const topProducts = useMemo(() => {
    const byProduct = {};
    invoices.forEach((inv) => {
      inv.lines.forEach((l) => {
        if (!byProduct[l.name]) byProduct[l.name] = { name: l.name, qty: 0, revenue: 0 };
        byProduct[l.name].qty += l.qty;
        byProduct[l.name].revenue += l.subtotal;
      });
    });
    return Object.values(byProduct).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [invoices]);

  const exportFEC = () => {
    const cols = ["JournalCode", "JournalLib", "EcritureNum", "EcritureDate", "CompteNum", "CompteLib", "CompAuxNum", "CompAuxLib", "PieceRef", "PieceDate", "EcritureLib", "Debit", "Credit", "EcritureLet", "DateLet", "ValidDate", "Montantdevise", "Idevise"];
    const rows = [cols.join("\t")];
    const sorted = [...entries].sort((a, b) => (a.date > b.date ? 1 : -1));
    sorted.forEach((e, idx) => {
      const ecritureNum = String(idx + 1).padStart(6, "0");
      const dateFEC = (e.date || "").replaceAll("-", "");
      (e.lines || []).forEach((l) => {
        const acc = accounts.find((a) => a.code === l.account);
        rows.push([
          "OD", "Opérations diverses", ecritureNum, dateFEC,
          l.account, acc?.name || "", "", "",
          ecritureNum, dateFEC, e.label || "",
          l.debit ? l.debit.toFixed(2) : "0.00",
          l.credit ? l.credit.toFixed(2) : "0.00",
          "", "", dateFEC, "", "",
        ].join("\t"));
      });
    });
    const blob = new Blob(["\uFEFF" + rows.join("\r\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `FEC-${(settings?.companyName || "export").replace(/\s+/g, "")}-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Fichier FEC généré.");
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
      <div className="print-only mb-6" style={{ borderBottom: "2px solid #152238", paddingBottom: 12 }}>
        <div className="display" style={{ fontSize: 20, fontWeight: 700, color: "#152238" }}>{settings.companyName || "Mon Entreprise"}</div>
        {settings.companyAddress && <div style={{ fontSize: 12, color: "#555" }}>{settings.companyAddress}</div>}
        <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8, color: "#152238" }}>{reportTitles[tab] || "Rapport"}</div>
        <div className="tabular" style={{ fontSize: 12, color: "#888" }}>Généré le {new Date().toISOString().slice(0, 10)}</div>
      </div>

      <div className="flex gap-1 mb-3 flex-wrap no-print">
        {[["resultat", "Compte de résultat"], ["bilan", "Bilan simplifié"], ["balance", "Balance des comptes"], ["ventes", "Analyse des ventes"], ["export", "Export"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className="px-4 py-2 text-sm rounded-t"
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
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
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
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
          <div className="col-span-2 bg-white rounded-lg p-6 flex justify-between items-center" style={{ border: "1px solid #E4DFD1" }}>
            <span className="text-sm font-medium" style={{ color: "#152238" }}>Résultat net</span>
            <span className="tabular text-xl font-semibold" style={{ color: resultat >= 0 ? "#0F6B5C" : "#A6432F" }}>{fmt(resultat)}</span>
          </div>
        </div>
      )}

      {tab === "bilan" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
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
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
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
            <div className="col-span-2 text-xs px-4 py-2 rounded" style={{ background: "#F7E9E3", color: "#A6432F" }}>
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
            ) : (
              <SimpleLineChart data={salesByMonth} xKey="mois" yKey="total" color="#0F6B5C" name="Chiffre d'affaires" />
            )}
          </div>
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-sm font-semibold mb-4" style={{ color: "#152238" }}>Meilleures ventes</div>
            {topProducts.length === 0 ? (
              <div className="text-sm py-10 text-center" style={{ color: "#A39C87" }}>Aucune vente enregistrée.</div>
            ) : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead>
                  <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                    <th className="py-2 font-normal">Article</th>
                    <th className="py-2 font-normal text-right">Quantité vendue</th>
                    <th className="py-2 font-normal text-right">Chiffre d'affaires</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((p) => (
                    <tr key={p.name} style={{ borderBottom: "1px solid #F3EFE3" }}>
                      <td className="py-2">{p.name}</td>
                      <td className="py-2 tabular text-right">{p.qty}</td>
                      <td className="py-2 tabular text-right">{p.revenue !== undefined ? fmt(p.revenue) : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        </div>
      )}

      {tab === "export" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white rounded-lg p-5" style={{ border: "1px solid #E4DFD1" }}>
            <FileDown size={18} style={{ color: "#0F6B5C" }} className="mb-2" />
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Export FEC</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>
              Fichier des Écritures Comptables au format normé (18 colonnes, séparateur tabulation) — le format exigé par l'administration fiscale française en cas de contrôle.
            </p>
            <button onClick={exportFEC} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>
              Télécharger le FEC (.txt)
            </button>
          </div>
          <div className="bg-white rounded-lg p-5 no-print" style={{ border: "1px solid #E4DFD1" }}>
            <Download size={18} style={{ color: "#0F6B5C" }} className="mb-2" />
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Export PDF</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>
              Retournez sur l'onglet souhaité (Compte de résultat, Bilan, Balance, Analyse des ventes) et utilisez le bouton « Télécharger en PDF » en haut de la page — un vrai fichier PDF est généré et téléchargé directement, y compris sur mobile.
            </p>
          </div>
          <div className="col-span-2 text-xs px-4 py-3 rounded" style={{ background: "#FAF8F1", color: "#7A7460" }}>
            Le bouton « Imprimer » sur chaque onglet reste disponible séparément pour une impression papier classique.
          </div>
        </div>
      )}
    </div>
  );
}

function AdminModule({
  settings, setSettings, users, setUsers,
  accounts, entries, products, productImages, invoices, suppliers, purchases, movements, clients, auditLog,
  employees, payslips, salaryAdvances,
  setAccounts, setEntries, setProducts, setProductImages, setInvoices, setSuppliers, setPurchases, setMovements, setClients,
  setEmployees, setPayslips, setSalaryAdvances,
  showToast, logAudit,
}) {
  const [tab, setTab] = useState("entreprise");
  const [companyName, setCompanyName] = useState(settings.companyName);
  const [companyAddress, setCompanyAddress] = useState(settings.companyAddress || "");
  const [companyPhone, setCompanyPhone] = useState(settings.companyPhone || "");
  const [companyEmail, setCompanyEmail] = useState(settings.companyEmail || "");
  const [currency, setCurrency] = useState(settings.currency || "HTG");
  const [taxForm, setTaxForm] = useState({
    taxSystem: settings.taxSystem,
    taxRate: settings.taxRate,
    taxAccount: settings.taxAccount,
    taxDeductibleOnPurchases: settings.taxDeductibleOnPurchases,
  });
  const [newUser, setNewUser] = useState({ email: "", role: "Éditeur" });
  const [lockDate, setLockDate] = useState(settings.lockDate || "");
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
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
      const { data, error } = await supabase
        .from("company_members")
        .select("id, email, role, user_id")
        .eq("company_id", companyId)
        .order("created_at", { ascending: true });
      if (!error) setMembers(data || []);
    } catch (e) {
      // hors mode Supabase, rien à charger
    }
    setMembersLoading(false);
  };

  useEffect(() => {
    if (tab === "utilisateurs") loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const saveCompany = () => {
    setSettings({ ...settings, companyName, companyAddress, companyPhone, companyEmail, currency });
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
        .select("id, company_id, user_id, role")
        .eq("email", email)
        .limit(1);

      if (fetchErr) {
        showToast("Impossible de vérifier cette invitation.");
        return;
      }

      const existing = existingRows && existingRows[0];

      if (existing) {
        if (existing.company_id !== companyId) {
          showToast("Cette adresse est déjà rattachée à une autre entreprise.");
          return;
        }
        // Membre déjà existant (invitation en attente ou compte déjà actif) :
        // on ne touche JAMAIS à user_id, seulement au rôle — pour ne jamais
        // déconnecter un compte déjà réclamé en réinvitant la même personne.
        const { error: updateErr } = await supabase
          .from("company_members")
          .update({ role: newUser.role })
          .eq("id", existing.id);
        if (updateErr) {
          showToast("Impossible de mettre à jour cette invitation.");
          return;
        }
        setNewUser({ email: "", role: "Éditeur" });
        showToast(existing.user_id
          ? `${email} est déjà membre — rôle mis à jour.`
          : `Invitation déjà existante pour ${email} — rôle mis à jour.`);
        logAudit("Administration", "Mise à jour invitation existante", `${email} — rôle ${newUser.role}`);
        loadMembers();
        return;
      }

      const { error } = await supabase
        .from("company_members")
        .insert({ company_id: companyId, email, role: newUser.role });
      if (error) {
        showToast(error.code === "23505" ? "Cette personne est déjà membre." : "Impossible d'ajouter cette personne.");
        return;
      }
      setNewUser({ email: "", role: "Éditeur" });
      showToast(`Invitation créée pour ${email}. Elle prend effet dès sa première connexion avec cet email.`);
      logAudit("Administration", "Invitation utilisateur", `${email} — rôle ${newUser.role}`);
      loadMembers();
    } catch (e) {
      showToast("Fonction disponible uniquement en mode Supabase.");
    }
  };

  const changeUserRole = async (member, role) => {
    await supabase.from("company_members").update({ role }).eq("id", member.id);
    loadMembers();
    showToast("Rôle mis à jour.");
    logAudit("Administration", "Changement de rôle", `${member.email} — ${role}`);
  };

  const removeUser = async (member) => {
    const warning = member.user_id
      ? `Retirer ${member.email} de l'entreprise ? Ce membre a déjà un compte actif — il perdra l'accès immédiatement et devra être réinvité pour revenir.`
      : `Retirer l'invitation en attente pour ${member.email} ?`;
    if (!window.confirm(warning)) return;
    await supabase.from("company_members").delete().eq("id", member.id);
    loadMembers();
    showToast("Membre retiré.");
    logAudit("Administration", "Retrait utilisateur", member.email);
  };

  const [lastExportAt, setLastExportAt] = useState(() => { try { return localStorage.getItem("compta-plus-last-export"); } catch (e) { return null; } });
  const exportData = () => {
    const data = { accounts, entries, products, productImages, invoices, suppliers, purchases, movements, clients, settings, users, employees, payslips, salaryAdvances };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sauvegarde-${settings.companyName || "erp"}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    const now = new Date().toISOString();
    try { localStorage.setItem("compta-plus-last-export", now); } catch (e) { /* stockage local indisponible, tant pis pour le rappel */ }
    setLastExportAt(now);
    showToast("Export généré.");
  };
  const exportDaysAgo = lastExportAt ? Math.floor((Date.now() - new Date(lastExportAt).getTime()) / 86400000) : null;

  // Schéma minimal attendu pour chaque catégorie importable : "array" (liste d'objets)
  // ou "object" (dictionnaire/objet simple). Sert à rejeter un fichier malformé ou
  // corrompu avant qu'il n'écrase les données actuelles.
  const IMPORT_SCHEMA = {
    accounts: { kind: "array", requiredKeys: ["code", "name"] },
    entries: { kind: "array", requiredKeys: ["id", "date"] },
    products: { kind: "array", requiredKeys: ["id", "name"] },
    productImages: { kind: "object" },
    invoices: { kind: "array", requiredKeys: ["id"] },
    suppliers: { kind: "array", requiredKeys: ["id", "name"] },
    purchases: { kind: "array", requiredKeys: ["id"] },
    movements: { kind: "array", requiredKeys: ["id"] },
    clients: { kind: "array", requiredKeys: ["id", "name"] },
    settings: { kind: "object" },
    users: { kind: "array" },
    employees: { kind: "array", requiredKeys: ["id", "name"] },
    payslips: { kind: "array", requiredKeys: ["id", "employeeId"] },
    salaryAdvances: { kind: "array", requiredKeys: ["id", "employeeId"] },
  };

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
        counts[category] = value.length;
      } else {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return { ok: false, error: `"${category}" doit être un objet dans le fichier importé.` };
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

  const importData = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      let parsed;
      try {
        parsed = JSON.parse(evt.target.result);
      } catch (err) {
        showToast("Fichier invalide (JSON illisible), import annulé.");
        e.target.value = "";
        return;
      }
      const result = validateImportData(parsed);
      if (!result.ok) {
        showToast(`Import refusé : ${result.error}`);
        e.target.value = "";
        return;
      }
      const summary = Object.entries(result.counts).map(([k, n]) => `${k}: ${n}`).join(", ");
      if (!window.confirm(
        `Importer ce fichier va REMPLACER les données actuelles de l'entreprise par :\n${summary}\n\n` +
        `Cette action est irréversible pour les données non exportées récemment. Continuer ?`
      )) {
        e.target.value = "";
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
      if (data.payslips) setPayslips(data.payslips);
      if (data.salaryAdvances) setSalaryAdvances(data.salaryAdvances);
      showToast("Données importées avec succès.");
      logAudit("Administration", "Import de données", file.name);
      e.target.value = "";
    };
    reader.readAsText(file);
  };

  const resetData = () => {
    if (!window.confirm("Réinitialiser toutes les données de l'application ? Cette action est irréversible.")) return;
    const typed = window.prompt(
      'Action irréversible. Pour confirmer, tapez exactement RÉINITIALISER (en majuscules) :'
    );
    if (typed !== "RÉINITIALISER") {
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
    showToast("Données réinitialisées.");
    logAudit("Administration", "Réinitialisation des données", "");
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module 8</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Administration et paramètres</div>
      </header>

      <div className="flex gap-1 mb-6">
        {[["entreprise", "Entreprise"], ["utilisateurs", "Utilisateurs"], ["donnees", "Données"], ["historique", "Historique"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className="px-4 py-2 text-sm rounded-t"
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

      {tab === "utilisateurs" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
            Invitez une personne par email : dès qu'elle se connecte avec cette adresse, elle rejoint automatiquement cette entreprise avec le rôle choisi. <b>Lecture seule</b> permet de consulter sans rien modifier ; <b>Vendeur</b> n'a accès qu'au point de vente (POS), sans voir la comptabilité, les rapports ni l'administration ; <b>Éditeur</b> permet de saisir et modifier les données sur tous les modules ; <b>Administrateur</b> a en plus accès à ce module.
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
              <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option>Administrateur</option>
                <option>Éditeur</option>
                <option>Vendeur</option>
                <option>Lecture seule</option>
              </select>
            </div>
            <button onClick={addUser} className="flex items-center justify-center gap-2 px-4 py-2 rounded text-sm text-white h-[38px] sm:col-span-3" style={{ background: "#152238" }}>
              <Plus size={14} /> Inviter
            </button>
          </div>
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
              {members.map((m) => (
                <tr key={m.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-2" style={{ color: "#7A7460" }}>{m.email}</td>
                  <td className="py-2">
                    <select value={m.role} onChange={(e) => changeUserRole(m, e.target.value)}
                      className="border rounded px-2 py-1 text-xs" style={{ borderColor: "#DDD6C4" }}>
                      <option>Administrateur</option>
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
                    {members.length > 1 && (
                      <button onClick={() => removeUser(m)} style={{ color: "#A6432F" }}><Trash2 size={14} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg p-5" style={{ border: "1px solid #E4DFD1" }}>
            <Download size={18} style={{ color: "#0F6B5C" }} className="mb-2" />
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Exporter les données</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Télécharge une sauvegarde complète au format JSON.</p>
            <button onClick={exportData} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>Exporter</button>
          </div>
          <div className="bg-white rounded-lg p-5" style={{ border: "1px solid #E4DFD1" }}>
            <Upload size={18} style={{ color: "#0F6B5C" }} className="mb-2" />
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Importer une sauvegarde</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Remplace les données actuelles par celles du fichier.</p>
            <input type="file" accept="application/json" ref={fileInputRef} onChange={importData} className="hidden" />
            <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>Importer</button>
          </div>
          <div className="bg-white rounded-lg p-5" style={{ border: "1px solid #E4DFD1" }}>
            <RotateCcw size={18} style={{ color: "#A6432F" }} className="mb-2" />
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Réinitialiser</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Efface toutes les données transactionnelles et repart d'un plan comptable vierge.</p>
            <button onClick={resetData} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#A6432F" }}>Réinitialiser</button>
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
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
              <input type="date" value={histTo} onChange={(e) => setHistTo(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Module</label>
              <select value={histModule} onChange={(e) => setHistModule(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="">Tous</option>
                {histModules.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Utilisateur</label>
              <select value={histUser} onChange={(e) => setHistUser(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
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
              {histFiltered.map((a) => (
                <tr key={a.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-2 tabular whitespace-nowrap">{new Date(a.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="py-2">{a.user}</td>
                  <td className="py-2">{a.module}</td>
                  <td className="py-2">{a.action}</td>
                  <td className="py-2" style={{ color: "#7A7460" }}>{a.details}</td>
                </tr>
              ))}
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
  const [companies, setCompanies] = useState(null); // null = en cours de chargement
  const [openId, setOpenId] = useState(null);
  const [payments, setPayments] = useState({}); // companyId -> liste de paiements
  const [form, setForm] = useState({ method: "moncash", amount: "", currency: "HTG", date: new Date().toISOString().slice(0, 10), reference: "", note: "", durationDays: 30 });
  const [q, setQ] = useState("");

  const loadCompanies = async () => {
    const { data, error } = await supabase.from("companies").select("id, name, plan_status, trial_ends_at, created_at").order("created_at", { ascending: false });
    if (error) { showToast("Impossible de charger les entreprises."); setCompanies([]); return; }
    setCompanies(data || []);
  };

  useEffect(() => { loadCompanies(); }, []);

  const loadPayments = async (companyId) => {
    const { data } = await supabase.from("payments").select("*").eq("company_id", companyId).order("date", { ascending: false });
    setPayments((p) => ({ ...p, [companyId]: data || [] }));
  };

  const toggleOpen = (co) => {
    if (openId === co.id) { setOpenId(null); return; }
    setOpenId(co.id);
    setForm({ method: "moncash", amount: "", currency: "HTG", date: new Date().toISOString().slice(0, 10), reference: "", note: "", durationDays: 30 });
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

  const recordPayment = async (co) => {
    if (!form.amount || Number(form.amount) <= 0) {
      showToast("Montant invalide.");
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
    setForm({ method: "moncash", amount: "", currency: "HTG", date: new Date().toISOString().slice(0, 10), reference: "", note: "", durationDays: 30 });
    loadPayments(co.id);
    showToast(`Paiement enregistré — ${co.name} est actif jusqu'au ${trialEndsAt}.`);
  };

  if (companies === null) {
    return <div className="p-8 text-sm" style={{ color: "#8A8370" }}>Chargement des entreprises…</div>;
  }

  const filtered = companies.filter((c) => (c.name || "").toLowerCase().includes(q.toLowerCase()));
  // S'applique aussi bien à un compte en essai qu'à un compte actif : trial_ends_at
  // sert de date de fin générique (fin d'essai OU fin de la période payée en cours).
  const daysLeft = (co) => co.trial_ends_at ? Math.ceil((new Date(co.trial_ends_at) - new Date()) / 86400000) : null;

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Super Admin</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Abonnements et paiements</div>
        <p className="text-sm mt-1" style={{ color: "#7A7460" }}>
          Vue plateforme — accès réservé. Aucune donnée comptable des clients n'est visible ici, uniquement leur statut d'abonnement.
        </p>
      </header>

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
                </div>
                <div className="flex items-center gap-2">
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
                  </div>
                  {co.trial_ends_at && (
                    <div className="text-xs mb-3" style={{ color: "#8A8370" }}>
                      Date de fin d'abonnement en cours : <span className="tabular">{co.trial_ends_at}</span>
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
                    <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
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
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Montage de l'application ---
ReactDOM.createRoot(document.getElementById("root")).render(
  <AuthGate><App /></AuthGate>
);

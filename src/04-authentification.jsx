// ═══ MODULE ═══
// @module Authentification
// @depends LandingPage, clearMembershipCache, friendlyError, hlMeta, hlOffline, hlOfflineSession
//   hlOfflineWhyNot, sanitizeUserMessage, supabase, useEffect, useState
// @exports AuthGate, SecurityPanel
// ═══ FIN DE L'EN-TÊTE ═══
// --- Écran de connexion (lien magique par email) ---
function AuthGate({ children }) {
  const [session, setSession] = useState(undefined);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [showLogin, setShowLogin] = useState(() => new URLSearchParams(window.location.search).get("login") === "1");
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
    try {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!error && data) setMfaLevel({ current: data.currentLevel, next: data.nextLevel });
    } catch (e) { /* hors ligne : la vérification a déjà eu lieu lors de la dernière ouverture en ligne */ }
    setMfaChecked(true);
  };

  const [sessionDiag, setSessionDiag] = useState(null);
  const logAuthEvent = (label) => {
    try {
      const log = JSON.parse(sessionStorage.getItem("compta-plus-auth-event-log") || "[]");
      log.push(`${new Date().toISOString().slice(11, 19)} ${label}`);
      sessionStorage.setItem("compta-plus-auth-event-log", JSON.stringify(log.slice(-20)));
    } catch (e) {}
  };
  const lastKnownEmailRef = React.useRef(null);
  const failureLoggedRef = React.useRef(false);
  const [offlineBlocked, setOfflineBlocked] = useState("");
  useEffect(() => {
    logAuthEvent("mount");
    // Hors ligne : getSession() peut rester en attente longtemps (jeton expiré à rafraîchir). Si cet appareil a
    // déjà ouvert l'application en ligne, on ouvre directement avec la session mémorisée (voir hlOfflineAllowed).
    const offNow = hlOfflineSession(false);
    let settled = false;
    if (offNow) { settled = true; setSession(offNow); setSessionDiag({ hasSession: true, error: "hors ligne" }); }
    else {
      // Filet : si rien n'arrive en 8 s (réseau instable ou hors ligne), on bascule sur la session mémorisée si elle existe,
      // sinon on explique clairement pourquoi l'ouverture hors ligne est impossible.
      setTimeout(() => {
        if (settled) return;
        const f = hlOfflineSession(true);
        if (f) { settled = true; setSession(f); setSessionDiag({ hasSession: true, error: "réseau instable" }); }
        else if (hlOffline()) setOfflineBlocked(hlOfflineWhyNot());
      }, 6000);
      supabase.auth.getSession().then(({ data, error }) => {
        if (settled) return;
        settled = true;
        logAuthEvent(`getSession -> ${data.session ? "présente" : "absente"}${error ? " err:" + error.message : ""}`);
        // Jeton expiré impossible à rafraîchir faute de réseau : session mémorisée sur cet appareil, jamais autre chose.
        setSession(data.session || hlOfflineSession(true));
        setSessionDiag({ hasSession: !!data.session, error: error ? (error.message || String(error)) : null });
      }).catch(() => {});
    }
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      logAuthEvent(`onAuthStateChange(${_event}) -> ${s ? "présente" : "absente"}`);
      // Un rafraîchissement de session qui échoue faute de réseau peut, selon la
      // version de la bibliothèque Supabase, déclencher ce même événement avec une
      // session à null — indiscernable d'une vraie déconnexion volontaire. On
      // ignore ce signal tant que l'appareil est hors-ligne, pour ne jamais
      // déconnecter quelqu'un simplement parce que sa connexion a été coupée un
      // instant ; la session réelle sera revérifiée normalement au retour du réseau.
      if (s === null && typeof navigator !== "undefined" && !navigator.onLine) return;
      if (s?.user?.email) lastKnownEmailRef.current = s.user.email;
      // Une déconnexion survenant après une connexion réussie, sans jamais avoir
      // atteint l'écran de bienvenue, est le signe précis du problème qu'on
      // n'a toujours pas résolu — on l'enregistre en base (email + journal
      // complet) pour pouvoir le diagnostiquer depuis Super Admin même après
      // coup, et pour pouvoir recontacter la personne concernée.
      if (s === null && lastKnownEmailRef.current && !failureLoggedRef.current) {
        try {
          const reachedWelcome = sessionStorage.getItem("compta-plus-reached-needs-welcome");
          if (!reachedWelcome) {
            failureLoggedRef.current = true;
            const log = JSON.parse(sessionStorage.getItem("compta-plus-auth-event-log") || "[]");
            supabase.from("signup_failures").insert({
              email: lastKnownEmailRef.current,
              event_log: log,
              user_agent: navigator.userAgent,
            }).then(({ error: insertErr }) => { if (insertErr) console.error("signup_failures :", insertErr.message); });
          }
        } catch (e) {}
      }
      setSession(s);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Une déconnexion automatique (ex. essai gratuit déjà utilisé sur cet
  // appareil) démonte App() avant que son propre message d'erreur ait pu
  // s'afficher — resolveMembership() le persiste dans sessionStorage pour
  // cette raison précise ; c'est ici, une fois revenu sur l'écran de
  // connexion, qu'il faut le relire et l'afficher, sans quoi la personne
  // atterrit silencieusement ici sans aucune explication.
  useEffect(() => {
    const readPersistedError = () => {
      try {
        const persisted = sessionStorage.getItem("compta-plus-last-membership-error");
        if (persisted) {
          setError(persisted);
          setShowLogin(true);
          sessionStorage.removeItem("compta-plus-last-membership-error");
          return true;
        }
      } catch (e) {}
      return false;
    };
    if (readPersistedError()) return;
    // Filet de sécurité : si le message est écrit juste après ce rendu-ci
    // (l'ordre exact entre la déconnexion et l'écriture n'est pas garanti),
    // une seconde vérification après un court délai le rattrape quand même.
    const t = setTimeout(readPersistedError, 300);
    return () => clearTimeout(t);
  }, [session]);

  useEffect(() => {
    if (session && session.offline) { setMfaLevel(null); setMfaChecked(true); } // double authentification déjà passée lors de la dernière ouverture en ligne
    else if (session) {
      refreshMfaLevel();
      // Réseau instable : la vérification peut rester en attente ; si cet appareil l'a déjà passée en ligne, on continue.
      const t = setTimeout(() => { const m = hlMeta(); if (m && m.bootOk) setMfaChecked(true); }, 8000);
      return () => clearTimeout(t);
    }
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
    if (error) setError(friendlyError(error));
    else setSent(true);
  };


  const signOut = () => {
    clearMembershipCache();
    try { sessionStorage.removeItem("compta-plus-mfa-backup-used"); } catch (e) {}
    supabase.auth.signOut();
  };

  if (session === undefined && offlineBlocked) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24, fontFamily: "sans-serif", color: "#152238", textAlign: "center" }} data-hl="offline-blocked">
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Pas de connexion internet</div>
          <p style={{ fontSize: 14, color: "#8A8370" }}>{offlineBlocked}</p>
          <button onClick={() => window.location.reload()} style={{ marginTop: 16, padding: "10px 16px", background: "#152238", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>Réessayer</button>
        </div>
      </div>
    );
  }
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
              {error && <p style={{ color: "#A6432F", fontSize: 12, marginTop: 8 }}>{sanitizeUserMessage(error)}</p>}
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
      setError(friendlyError(err, "Code invalide."));
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
      setError(friendlyError(err, "Code de secours invalide."));
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
          {error && <p style={{ color: "#A6432F", fontSize: 12, marginTop: 8 }}>{sanitizeUserMessage(error)}</p>}
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
        {error && <p style={{ color: "#A6432F", fontSize: 12, marginTop: 8 }}>{sanitizeUserMessage(error)}</p>}
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
      setError(friendlyError(err, "Impossible de générer les codes de secours."));
    } finally {
      setBusy(false);
    }
  };

  const loadFactors = async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) { setError(friendlyError(error)); setFactors([]); return; }
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
      setError(friendlyError(err, "Impossible de démarrer l'activation."));
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
      setError(friendlyError(err, "Code invalide, réessayez."));
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
      showToast(friendlyError(err, "Impossible de désactiver."));
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
            {error && <p style={{ color: "#A6432F", fontSize: 12, marginTop: 8 }}>{sanitizeUserMessage(error)}</p>}
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
            {error && <p style={{ color: "#A6432F", fontSize: 12, marginTop: 8 }}>{sanitizeUserMessage(error)}</p>}
          </form>
        )}
      </div>
    </div>
  );
}


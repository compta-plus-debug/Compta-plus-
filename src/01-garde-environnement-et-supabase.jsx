function envGuardProblem(url, host, path) {
  const h = String(host || "").toLowerCase(), p = String(path || "").toLowerCase(), u = String(url || "");
  const prodSite = h === "comptaplus.app" || h === "www.comptaplus.app";
  const testSite = h.slice(-10) === ".github.io" && p.indexOf("compta-plus--test") >= 0;
  if (prodSite && u.indexOf(ENV_TEST_REF) >= 0) return "Cette copie de TEST a été publiée sur le site de production. Elle a été arrêtée pour protéger les données réelles. Republiez les fichiers de production.";
  if (testSite && u.indexOf(ENV_PROD_REF) >= 0) return "Cette copie de PRODUCTION a été publiée sur le site de test. Elle a été arrêtée pour ne pas toucher aux données réelles. Republiez les fichiers de test.";
  return "";
}
(function () {
  let msg = "";
  try { msg = envGuardProblem(SUPABASE_URL, window.location.hostname, window.location.pathname); } catch (e) { msg = ""; }
  if (msg) {
    try { document.body.innerHTML = '<div style="font-family:sans-serif;max-width:480px;margin:15vh auto;padding:24px;border:2px solid #A6432F;border-radius:8px;color:#152238"><h2 style="margin:0 0 12px">Publication bloquée</h2><p>' + msg + '</p></div>'; } catch (e) { /* ignoré */ }
    throw new Error("ENV_GUARD");
  }
})();
// K:ENV:END
let _supabaseClient = null;
function supabaseClient() {
  if (!_supabaseClient) {
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error("Supabase n'est pas encore chargé — rechargez la page dans quelques secondes.");
    }
    _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { flowType: "implicit" },
    });
    // Diagnostic temporaire (recommandation directe du support Supabase) :
    // capture la trace de pile exacte à CHAQUE appel de signOut(), peu importe
    // d'où il provient (notre code, un autre onglet via la synchronisation de
    // session, ou ailleurs) — le support a confirmé que la déconnexion
    // observée est bien demandée explicitement par le client, jamais par
    // Supabase lui-même.
    const originalSignOut = _supabaseClient.auth.signOut.bind(_supabaseClient.auth);
    _supabaseClient.auth.signOut = async (...args) => {
      const stack = new Error("signOut() appelé ici").stack;
      console.error(stack);
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/signup_failures`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Prefer": "return=minimal" },
          body: JSON.stringify({ email: "(signOut) " + (window.location.href), event_log: [stack], user_agent: navigator.userAgent }),
        });
      } catch (e) {}
      try { hlClearCache(); } catch (e) { /* ignoré */ }
      return originalSignOut(...args);
    };
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

// Diagnostic temporaire : capture l'adresse exacte dès le tout premier chargement
// du script, avant que quoi que ce soit (y compris le SDK Supabase) n'ait pu la
// nettoyer ou la modifier — pour affichage visible sur la page en cas de problème
// de connexion, sans avoir besoin des outils de développement du navigateur.
const _initialLocationSnapshot = typeof window !== "undefined" ? window.location.href : "";

let _membership = null; // { companyId, role, email, planStatus, trialEndsAt, companyName, isNewCompany } — mis en cache après résolution
let _extraInvitesFor = null; // une seule tentative de réclamation des invitations « expert » par utilisateur et par session
let _membershipPromise = null; // dédoublonnage : un seul appel réel à la fois


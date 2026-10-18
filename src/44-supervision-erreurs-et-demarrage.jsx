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

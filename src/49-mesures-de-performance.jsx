// ═══ MODULE ═══
// @module Mesures de performance
// @depends APP_VERSION, CP_PERF, _membership, supabase
// @exports perfMarkMount, perfMarkReady
// ═══ FIN DE L'EN-TÊTE ═══
// --- Mesures de performance (chantier 8, suite) ---
// À chaque ouverture de l'application, on mesure en silence : le temps avant le premier affichage, le temps de
// chargement des données une fois l'application démarrée, le poids et la durée du fichier de départ, la durée de
// chargement de chaque écran ouvert à la demande, et le type de connexion. Un seul petit enregistrement est envoyé
// (12 secondes après le démarrage) dans la table perf_metrics ; le Super admin les consulte (onglet « Performances »)
// et le service d'alertes prévient par e-mail si les chargements deviennent lents.
// Aucune donnée comptable, aucune adresse e-mail : seulement des durées, la version et le type d'appareil.
// Si la table n'existe pas encore, ou si l'envoi échoue, rien ne se passe : la mesure ne doit jamais gêner l'application.
const PERF_SLOW_LOAD_MS = 8000;
const _perfState = { mountMs: null, loadedMs: null, sent: false };

function perfMarkMount() {
  try { if (_perfState.mountMs === null) _perfState.mountMs = Math.round(performance.now()); } catch (e) { /* ignoré */ }
}

function perfMarkReady() {
  try {
    if (_perfState.loadedMs !== null) return;
    _perfState.loadedMs = Math.round(performance.now());
    const delay = typeof window.__PERF_SEND_DELAY === "number" ? window.__PERF_SEND_DELAY : 12000;
    setTimeout(perfSend, delay);
  } catch (e) { /* ignoré */ }
}

function perfCollect() {
  const out = { app_version: APP_VERSION };
  const mount = _perfState.mountMs, loaded = _perfState.loadedMs;
  out.ready_ms = mount !== null && loaded !== null ? Math.max(0, loaded - mount) : null;
  try { const fcp = performance.getEntriesByName("first-contentful-paint")[0]; out.fcp_ms = fcp ? Math.round(fcp.startTime) : null; } catch (e) { out.fcp_ms = null; }
  try {
    const r = performance.getEntriesByType("resource").find((x) => /\/app\.min\.js(\?|$)/.test(x.name));
    if (r) { out.core_ms = Math.round(r.duration); out.core_kb = Math.round((r.transferSize || 0) / 1024); }
  } catch (e) { /* ignoré */ }
  const ch = {};
  Object.keys(CP_PERF.chunks || {}).forEach((k) => { if (CP_PERF.chunks[k].ok) ch[k] = CP_PERF.chunks[k].ms; });
  out.chunks = ch;
  out.chunk_failures = (CP_PERF.failures || []).length;
  out.load_ms = (out.fcp_ms || 0) + (out.ready_ms || 0);
  try {
    const c = navigator.connection;
    if (c) { out.net = c.effectiveType || null; out.rtt_ms = typeof c.rtt === "number" ? Math.round(c.rtt) : null; }
    if (typeof navigator.deviceMemory === "number") out.mem_gb = navigator.deviceMemory;
  } catch (e) { /* ignoré */ }
  out.slow = out.load_ms > PERF_SLOW_LOAD_MS || out.chunk_failures > 0;
  return out;
}

async function perfSend() {
  try {
    if (_perfState.sent) return;
    _perfState.sent = true;
    if (navigator.onLine === false) return;
    const d = perfCollect();
    if (d.ready_ms === null) return;
    let companyId = null;
    try { companyId = _membership?.companyId || null; } catch (e) { /* ignoré */ }
    await supabase.from("perf_metrics").insert({ ...d, company_id: companyId, ua: String(navigator.userAgent || "").slice(0, 160) });
  } catch (e) { /* la mesure ne doit jamais faire planter l'application */ }
}

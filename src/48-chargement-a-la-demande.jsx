// ═══ MODULE ═══
// @module Chargement a la demande
// @depends APP_VERSION, useEffect, useState
// @exports —
// ═══ FIN DE L'EN-TÊTE ═══
// --- Chargement à la demande des gros modules (chantier 8) ---
// Les écrans lourds et rarement ouverts au démarrage (Paie, Administration, Comptabilité, Gestion…)
// sont compilés dans des fichiers séparés (dossier chunks/) chargés au moment où l'on ouvre l'écran.
// L'application de départ est ainsi nettement plus légère : la page de connexion et la caisse s'ouvrent plus vite.
// Les fichiers sont ensuite préchargés en arrière-plan, pour que le mode hors ligne continue de fonctionner.
// La compilation (build.mjs) ajoute à la fin de l'application la liste des fichiers (__CP_IDS), la fonction
// __cpScope() (ce que les fichiers empruntent à l'application de départ) et les écrans « relais » (cpLazy).
// Sans cette étape (CHUNKS=off), tout reste dans un seul fichier et rien de ceci n'est utilisé.
const CP_CHUNK_STATE = {}; // id -> { exports, promise }
const CP_PERF = { chunks: {}, failures: [] }; // mesures locales : durée de chargement de chaque fichier

function cpChunkUrl(id) { return "chunks/" + id + ".js?v=" + APP_VERSION; }

// Charge le fichier (balise <script>) ; il s'enregistre lui-même dans window.__cpc[id].
function cpFetchScript(id) {
  return new Promise((resolve, reject) => {
    if (window.__cpc && window.__cpc[id]) { resolve(window.__cpc[id]); return; }
    const sc = document.createElement("script");
    sc.src = cpChunkUrl(id);
    sc.async = true;
    sc.charset = "utf-8"; // les chunks contiennent des accents : on ne dépend pas de l'en-tête du serveur
    sc.onload = () => { if (window.__cpc && window.__cpc[id]) resolve(window.__cpc[id]); else { sc.remove(); reject(new Error("chunk-missing")); } };
    sc.onerror = () => { sc.remove(); reject(new Error("chunk-load")); };
    document.head.appendChild(sc);
  });
}

function cpLoadChunk(id) {
  const st = CP_CHUNK_STATE[id] || (CP_CHUNK_STATE[id] = {});
  if (st.exports) return Promise.resolve(st.exports);
  if (st.promise) return st.promise;
  const t0 = performance.now();
  st.promise = cpFetchScript(id).then((reg) => {
    if (reg.v !== APP_VERSION) { const e = new Error("chunk-version"); e.stale = true; throw e; }
    st.exports = reg.f(__cpScope());
    CP_PERF.chunks[id] = { ms: Math.round(performance.now() - t0), ok: true };
    return st.exports;
  }).catch((e) => {
    st.promise = null; // permet de réessayer
    CP_PERF.chunks[id] = { ms: Math.round(performance.now() - t0), ok: false };
    CP_PERF.failures.push({ id, at: Date.now(), stale: !!e.stale });
    throw e;
  });
  return st.promise;
}

// Écran « relais » : à la place du vrai composant, tant que son fichier n'est pas chargé.
function cpLazy(id, name) {
  return function CpLazyScreen(props) {
    const [Real, setReal] = useState(() => (CP_CHUNK_STATE[id] && CP_CHUNK_STATE[id].exports ? CP_CHUNK_STATE[id].exports[name] : null));
    const [err, setErr] = useState(null);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
      if (Real) return undefined;
      let off = false;
      setErr(null);
      cpLoadChunk(id).then((ex) => { if (!off) setReal(() => ex[name]); }, (e) => { if (!off) setErr(e); });
      return () => { off = true; };
    }, [Real, attempt]);
    if (Real) return React.createElement(Real, props);
    if (err) {
      const stale = !!err.stale;
      return (
        <div className="p-8 text-center" data-testid={stale ? "chunk-stale" : "chunk-error"} role="alert">
          <p className="text-sm text-slate-700 mb-4">
            {stale
              ? "Une nouvelle version de Compta+ est disponible. Rechargez la page pour continuer."
              : "Cet écran n'a pas pu s'ouvrir. Vérifiez votre connexion internet puis réessayez."}
          </p>
          <button type="button" data-testid="chunk-retry"
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium"
            onClick={() => { if (stale) window.location.reload(); else setAttempt((n) => n + 1); }}>
            {stale ? "Recharger la page" : "Réessayer"}
          </button>
        </div>
      );
    }
    return <div className="p-8 text-center text-sm text-slate-500" data-testid="chunk-loading" role="status">Chargement…</div>;
  };
}

// Préchargement discret, une fois la page chargée : les écrans sont alors prêts (et gardés pour le hors ligne).
function cpPrefetchAll() {
  try {
    if (typeof __CP_IDS === "undefined") return;
    if (navigator.onLine === false) return;
    if (navigator.connection && navigator.connection.saveData) return;
    let i = 0;
    const next = () => {
      if (i >= __CP_IDS.length) { cpPruneOldCaches(); return; }
      const id = __CP_IDS[i++];
      cpFetchScript(id).catch(() => {}).then(() => setTimeout(next, 300));
    };
    next();
  } catch (e) { /* le préchargement ne doit jamais gêner l'application */ }
}

// Supprime du cache hors ligne les fichiers des anciennes versions (ils ne servent plus et s'accumulent).
function cpPruneOldCaches() {
  try {
    if (!window.caches) return;
    caches.keys().then((names) => Promise.all(names.map((n) => caches.open(n).then((c) => c.keys().then((reqs) => Promise.all(reqs.map((r) => {
      const u = new URL(r.url);
      const versioned = /\/(chunks\/[\w-]+|app\.min)\.js$/.test(u.pathname);
      if (versioned && u.searchParams.get("v") && u.searchParams.get("v") !== APP_VERSION) return c.delete(r);
      return null;
    }))))))).catch(() => {});
  } catch (e) { /* idem */ }
}

(function cpScheduleChunkPrefetch() {
  if (typeof __CP_IDS === "undefined") return;
  const start = () => {
    const delay = typeof window.__CP_PREFETCH_DELAY === "number" ? window.__CP_PREFETCH_DELAY : 5000;
    setTimeout(() => { (window.requestIdleCallback || ((f) => setTimeout(f, 0)))(cpPrefetchAll); }, delay);
  };
  if (document.readyState === "complete") start(); else window.addEventListener("load", start);
})();

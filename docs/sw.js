// Service worker — mise en cache de l'app shell pour un fonctionnement hors-ligne,
// avec une garantie stricte : jamais servir une version périmée de l'application
// tant que la connexion est disponible, même si le cache HTTP classique du
// navigateur (différent du Cache Storage ci-dessous) tenterait de s'interposer.
//
// v4 (chantier H) : met aussi en cache les bibliothèques chargées depuis des CDN
// (React, Supabase, Tailwind, jsPDF…) afin que l'application puisse S'OUVRIR sans réseau
// après une première ouverture en ligne. Jamais pour Supabase lui-même (données/API).

const CACHE_NAME = "compta-plus-cache-v4";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
];
// Bibliothèques tierces (versions fixées dans index.html, sauf Tailwind) : préchargées à l'installation.
const CDN_LIBS = [
  "https://cdn.tailwindcss.com",
  "https://unpkg.com/react@18.3.1/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/dist/umd/supabase.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
  "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js",
];
// Seuls ces hébergeurs de bibliothèques sont mis en cache (jamais l'API Supabase, ni les polices).
const CDN_HOSTS = ["cdn.tailwindcss.com", "unpkg.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Le shell est indispensable ; les bibliothèques sont « au mieux » (un CDN indisponible
      // ne doit pas empêcher l'installation — elles seront mises en cache à la première utilisation).
      await Promise.all(APP_SHELL.map((u) => cache.add(u).catch(() => {})));
      await Promise.all(CDN_LIBS.map((u) => cache.add(new Request(u, { mode: "cors" })).catch(() => {})));
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Stratégie : réseau d'abord, repli sur le cache SEULEMENT si hors-ligne — jamais
// pour les appels vers Supabase (autre origine, doivent toujours être frais).
// { cache: "no-store" } sur le fetch interne est la partie critique : sans ça, le
// cache HTTP natif du navigateur peut renvoyer une réponse "network" qui est en
// réalité une vieille copie, même en étant "en ligne".
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const cdn = !sameOrigin && CDN_HOSTS.indexOf(url.hostname) !== -1;
  if (!sameOrigin && !cdn) return;
  event.respondWith(
    (cdn
      // Bibliothèques CDN : on laisse le navigateur gérer la requête normalement (cache HTTP
      // compris, versions fixées) et on garde seulement une copie pour le mode hors ligne.
      ? fetch(event.request)
      : fetch(event.request, { cache: "no-store" }))
      .then((response) => {
        if (response && (response.ok || response.type === "opaque")) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // Rien en cache pour cette ressource précise (ex. après une mise à jour
          // qui a changé le nom d'un fichier) : on retombe sur index.html pour au
          // moins charger la coquille de l'app, qui affichera elle-même un message
          // clair de perte de connexion — plutôt que de laisser échouer la
          // requête et afficher la page d'erreur générique du navigateur.
          if (event.request.mode === "navigate") return caches.match("./index.html");
          return undefined;
        })
      )
  );
});

// Vérifie activement s'il existe une version plus récente du service worker lui-même
// dès qu'un onglet le lui demande (voir app.jsx), au lieu d'attendre le cycle de
// vérification automatique du navigateur qui peut prendre jusqu'à 24h.
self.addEventListener("message", (event) => {
  if (event.data === "CHECK_FOR_UPDATE") self.registration.update();
});

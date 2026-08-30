// Service worker — mise en cache de l'app shell pour un fonctionnement hors-ligne,
// avec une garantie stricte : jamais servir une version périmée de l'application
// tant que la connexion est disponible, même si le cache HTTP classique du
// navigateur (différent du Cache Storage ci-dessous) tenterait de s'interposer.

const CACHE_NAME = "compta-plus-cache-v3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
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
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Vérifie activement s'il existe une version plus récente du service worker lui-même
// dès qu'un onglet le lui demande (voir app.jsx), au lieu d'attendre le cycle de
// vérification automatique du navigateur qui peut prendre jusqu'à 24h.
self.addEventListener("message", (event) => {
  if (event.data === "CHECK_FOR_UPDATE") self.registration.update();
});

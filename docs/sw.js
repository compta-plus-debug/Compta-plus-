// Service worker minimal pour Compta+.
// Rôle : rendre l'application installable (condition requise par les navigateurs
// pour proposer "Installer l'application") et permettre un chargement de secours
// hors ligne. L'application elle-même dépend de Supabase pour toutes les données,
// donc ce service worker ne met en cache que la coquille statique (HTML/JS/manifeste),
// jamais les données comptables.

const CACHE_NAME = "compta-plus-shell-v1";
const SHELL_FILES = ["./", "./index.html", "./manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Stratégie "réseau d'abord" : on essaie toujours d'avoir la version la plus
// récente en ligne ; on ne retombe sur le cache que si le réseau est indisponible
// (évite de servir une coquille périmée alors que le site a été mis à jour).
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

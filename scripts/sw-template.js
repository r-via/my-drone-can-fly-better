// Modèle du service worker. `scripts/gen-sw.mjs` y injecte la version de build
// et la liste de précache, puis écrit le résultat dans out/sw.js.
// Ne jamais éditer out/sw.js : il est régénéré à chaque `npm run build`.

const VERSION = '__SW_VERSION__';
const CACHE = `mdcfb-${VERSION}`;
const PRECACHE = /*__PRECACHE__*/ [];
const APP_SHELL = '/index.html';

// Installation : on télécharge tout l'applicatif d'un coup. Si un seul fichier
// échoue, addAll rejette et le SW n'est pas activé - pas de cache à moitié plein.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

// Le nouveau SW attend que les onglets se ferment, sauf si l'utilisateur clique
// « Recharger » dans la pastille de mise à jour : là il prend la main tout de suite.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Activation : le build précédent devient inutile, on libère la place.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith('mdcfb-') && n !== CACHE).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Ko-fi, Discord, GitHub : liens externes, jamais interceptés.
  if (new URL(req.url).origin !== self.location.origin) return;

  // Une seule route : toute navigation retombe sur la coquille en cache.
  if (req.mode === 'navigate') {
    event.respondWith(caches.match(APP_SHELL).then((hit) => hit ?? fetch(req)));
    return;
  }

  // Assets : cache d'abord (tout est immuable et hashé), réseau en secours.
  event.respondWith(
    (async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;

      const res = await fetch(req);
      if (res.ok && res.type === 'basic') {
        const cache = await caches.open(CACHE);
        await cache.put(req, res.clone());
      }
      return res;
    })(),
  );
});

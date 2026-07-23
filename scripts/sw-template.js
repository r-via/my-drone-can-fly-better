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

  const url = new URL(req.url);
  // Ko-fi, Discord, GitHub : liens externes, jamais interceptés.
  if (url.origin !== self.location.origin) return;

  // /api/* : rapports partagés et carte OG, servis par les fonctions Netlify.
  // Jamais en cache : ignoreSearch fusionnerait les query strings de /api/og.
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    // /s et /s/<id> doivent atteindre l'edge function (aperçu OG + redirection
    // vers /#s=<id>) : servir la coquille ici ferait atterrir le lien sur la
    // page d'accueil, sans rapport. Hors ligne on redirige nous-mêmes - le
    // fragment #r= de l'ancien format survit à la redirection.
    if (url.pathname === '/s' || url.pathname.startsWith('/s/')) {
      event.respondWith(
        fetch(req).catch(() =>
          Response.redirect(url.pathname === '/s' ? '/' : `/#s=${url.pathname.slice(3)}`, 302),
        ),
      );
      return;
    }
    // Une seule route : toute navigation retombe sur la coquille en cache.
    // Cache raté (stockage évincé ou vidé par l'utilisateur) : on la reprend
    // au réseau et on la remet en cache, le hors-ligne se répare tout seul.
    event.respondWith(
      (async () => {
        const hit = await caches.match(APP_SHELL);
        if (hit) return hit;
        const res = await fetch(APP_SHELL);
        if (res.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(APP_SHELL, res.clone());
        }
        return res;
      })(),
    );
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

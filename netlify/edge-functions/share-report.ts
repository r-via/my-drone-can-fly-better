// Liens de partage courts - Edge Function + Netlify Blobs.
//
// Le lien fragment (#r=…) plafonne vers ~1700 caractères : au-delà les courbes
// sautent (trimmed), et le lien reste un pavé illisible dans un chat. Ici le
// client POSTe le rapport ENCODÉ (même codec que le fragment, version complète
// avec courbes, ~1-10 Ko) et reçoit un id court : le lien devient /s/<id>.
//
// Ce qui est stocké est le rapport calculé (scores, findings, courbes
// agrégées), jamais le .bbl brut : pas de trace GPS ni de données pilote. Le
// fragment #r= reste le secours hors ligne et le format des anciens liens.
// Un lien vit TTL_DAYS jours : chaque dépôt purge les entrées plus vieilles.
//
// Routes :
//   POST /api/share?t=…&d=…  corps = rapport encodé → { id }
//   GET  /s/:id              OG (carte /api/og) + redirection humaine /#s=<id>
//   GET  /api/share/:id      renvoie le rapport encodé (lu par l'app)

import { getStore } from '@netlify/blobs';

/** Un rapport encodé pèse quelques Ko ; au-delà c'est un usage détourné. */
const MAX_BYTES = 512_000;
const MAX_TITLE = 120;
const MAX_DESC = 300;

/** Durée de vie d'un lien court. Alignée sur dict.ui.shareLink.description. */
const TTL_DAYS = 15;

/**
 * La date de création vit dans la clé (`YYYYMMDD-xxxxxxxx`) : la purge se fait
 * en comparant les clés listées au seuil, sans lire la moindre métadonnée.
 */
const ID_RE = /^\d{8}-[A-Za-z0-9_-]{8}$/;

function dayStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
}

function isExpired(key: string): boolean {
  return key.slice(0, 8) < dayStamp(Date.now() - TTL_DAYS * 86_400_000);
}

/**
 * Supprime les liens plus vieux que TTL_DAYS (et les clés d'un format inconnu).
 * Appelée à chaque dépôt : le store reste donc borné à ~15 jours d'activité,
 * ce qui borne aussi le coût du list().
 */
async function purgeExpired(store: ReturnType<typeof getStore>): Promise<void> {
  try {
    const { blobs } = await store.list();
    const stale = blobs.filter((b) => !ID_RE.test(b.key) || isExpired(b.key));
    await Promise.all(stale.map((b) => store.delete(b.key)));
  } catch {
    // La purge ne doit jamais faire échouer un partage : au pire elle
    // repassera au dépôt suivant.
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shortId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
}

function json(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  // Sur un 404, la plateforme rejoue la requête en résolution pretty-URL
  // (suffixes /index.html, /index.htm, /) : on normalise pour que tous les
  // passages répondent pareil, sinon le dernier essai finit en 405.
  const pathname = url.pathname.replace(/(\/index\.html?|\/)+$/, '');
  const store = getStore('shared-reports');

  if (req.method === 'POST' && pathname === '/api/share') {
    const t = (url.searchParams.get('t') ?? 'Flight report').slice(0, MAX_TITLE);
    const d = (url.searchParams.get('d') ?? '').slice(0, MAX_DESC);

    let encoded: string;
    try {
      encoded = await req.text();
    } catch {
      return json(400, { ok: false, error: 'bad_request' });
    }
    if (!encoded || encoded.length > MAX_BYTES) {
      return json(encoded ? 413 : 400, { ok: false, error: encoded ? 'too_large' : 'bad_request' });
    }

    const id = `${dayStamp(Date.now())}-${shortId()}`;
    await store.set(id, encoded, {
      metadata: { t, d, createdAt: new Date().toISOString() },
    });
    await purgeExpired(store);
    return json(200, { ok: true, id });
  }

  // GET /api/share/:id - le rapport encodé, consommé par l'app (fragment #s=).
  const apiMatch = /^\/api\/share\/([^/]+)$/.exec(pathname);
  if (req.method === 'GET' && apiMatch) {
    // Un lien expiré mais pas encore purgé est refusé comme un lien inconnu.
    if (!ID_RE.test(apiMatch[1]) || isExpired(apiMatch[1])) {
      return json(404, { ok: false, error: 'not_found' });
    }
    const encoded = await store.get(apiMatch[1], { type: 'text' });
    if (encoded === null) return json(404, { ok: false, error: 'not_found' });
    return new Response(encoded, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        // Un id donné ne change jamais de contenu.
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  }

  // GET /s/:id - aperçu OG pour les crawlers, redirection JS pour les humains.
  const pageMatch = /^\/s\/([^/]+)$/.exec(pathname);
  if (req.method === 'GET' && pageMatch) {
    const id = pageMatch[1];
    const entry =
      ID_RE.test(id) && !isExpired(id) ? await store.getWithMetadata(id, { type: 'text' }) : null;
    if (entry === null) {
      // Lien mort : l'app affiche son message « rapport introuvable ».
      return Response.redirect(`${url.origin}/#s=${encodeURIComponent(id)}`, 302);
    }
    const meta = entry.metadata as { t?: string; d?: string };
    const title = esc((meta.t ?? 'Flight report').slice(0, MAX_TITLE));
    const desc = esc((meta.d ?? '').slice(0, MAX_DESC));
    const image = esc(
      `${url.origin}/api/og?t=${encodeURIComponent(meta.t ?? '')}&d=${encodeURIComponent(meta.d ?? '')}`,
    );

    // Pas de meta refresh : les crawlers (Discord inclus) les suivent et
    // scraperaient l'OG générique de la home (voir share-preview.ts).
    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title} - My Drone Can Fly Better</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="My Drone Can Fly Better">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="description" content="${desc}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${image}">
<meta name="theme-color" content="#c6ff5e">
<meta name="robots" content="noindex">
<script>
  location.replace('/#s=' + ${JSON.stringify(id)});
</script>
</head>
<body><noscript><a href="/">My Drone Can Fly Better</a></noscript></body>
</html>`;
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  return json(405, { ok: false, error: 'method_not_allowed' });
};

export const config = { path: ['/api/share', '/api/share/:id', '/s/:id'] };

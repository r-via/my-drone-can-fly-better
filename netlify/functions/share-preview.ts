// Aperçu OG des liens de partage (/s?t=…&d=…#r=…).
//
// Le rapport vit dans le fragment (#r=…), que les crawlers ne voient jamais -
// c'est la promesse de confidentialité du site. Discord/Slack ne peuvent donc
// pas lire le rapport : le client met le strict nécessaire de la carte (titre
// « craft · score/100 », description « verdict · axes ») en query string, déjà
// localisé. Cette fonction ne fait que l'échapper et le servir en balises OG,
// puis un script renvoie les humains vers l'app en préservant le fragment.
//
// Fonction Netlify v2 (Web standard Request/Response), servie sous /s via un
// redirect netlify.toml.

const MAX_TITLE = 120;
const MAX_DESC = 300;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default (req: Request): Response => {
  const url = new URL(req.url);
  const title = esc((url.searchParams.get('t') ?? 'Flight report').slice(0, MAX_TITLE));
  const desc = esc((url.searchParams.get('d') ?? '').slice(0, MAX_DESC));

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title} - My Drone Can Fly Better</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="My Drone Can Fly Better">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta name="description" content="${desc}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="theme-color" content="#c6ff5e">
<meta name="robots" content="noindex">
<script>
  // Humains : direction l'app, fragment (#r=…) préservé - il ne quitte jamais
  // le navigateur. Les crawlers n'exécutent pas ce script et lisent l'OG.
  location.replace('/' + location.hash);
</script>
<noscript><meta http-equiv="refresh" content="0;url=/"></noscript>
</head>
<body></body>
</html>`;

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Chaque lien porte son propre aperçu : rien à mettre en cache partagé.
      'cache-control': 'no-store',
    },
  });
};

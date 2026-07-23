'use client';

// Page 404 - et filet de sécurité des liens de partage /s.
//
// En prod Netlify, /s est réécrit vers la fonction share-preview et /s/<id>
// vers l'edge function share-report (aperçu OG). Partout ailleurs (next dev
// sans Netlify, autre hébergeur, redirect cassé), ces chemins tombent ici : on
// renvoie alors vers l'app en préservant le rapport (#r=…) ou l'id (#s=<id>),
// pour qu'un lien de partage reste fonctionnel même sans l'aperçu.

import { useEffect, useState } from 'react';
import { useLocale } from '@/lib/i18n/locale';

export default function NotFound() {
  const { dict } = useLocale();
  const t = dict.ui.notFound;
  const [redirecting, setRedirecting] = useState(true);

  useEffect(() => {
    const path = window.location.pathname.replace(/\/$/, '');
    if (path === '/s' && /^#r=.+/.test(window.location.hash)) {
      window.location.replace('/' + window.location.hash);
      return;
    }
    const short = /^\/s\/([A-Za-z0-9_-]+)$/.exec(path);
    if (short) {
      window.location.replace('/#s=' + short[1]);
      return;
    }
    setRedirecting(false);
  }, []);

  // Pendant la décision (un rendu), rien : évite le flash « 404 » sur un lien
  // de partage valide qui va rediriger.
  if (redirecting) return null;

  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-2xl border border-line bg-surface p-8 text-center">
      <p className="font-display text-5xl font-bold text-ink">404</p>
      <p className="text-sm text-ink-2">{t.text}</p>
      <a
        href="/"
        className="rounded-full bg-cta px-5 py-2 text-sm font-bold text-cta-ink transition-opacity hover:opacity-90"
      >
        {t.cta}
      </a>
    </div>
  );
}

'use client';

// Enregistre out/sw.js (généré par scripts/gen-sw.mjs) pour rendre l'app
// utilisable hors ligne, et propose de recharger quand un nouveau build attend.
// Rien à faire en dev : `next dev` ne sert pas de sw.js.
import { useCallback, useEffect, useState } from 'react';

import { useLocale } from '@/lib/i18n/locale';

/** Intervalle minimal entre deux vérifications de mise à jour, en ms. */
const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000;

export default function ServiceWorkerRegister() {
  const { dict } = useLocale();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    let disposed = false;
    let registration: ServiceWorkerRegistration | null = null;
    let lastCheck = 0;

    // Un SW installé alors qu'un autre contrôle déjà la page = build en attente.
    // Sans controller, c'est la première visite : rien à signaler.
    const track = (sw: ServiceWorker | null) => {
      if (!sw || !navigator.serviceWorker.controller) return;
      if (sw.state === 'installed') {
        setWaiting(sw);
        return;
      }
      sw.addEventListener('statechange', () => {
        if (!disposed && sw.state === 'installed') setWaiting(sw);
      });
    };

    // Onglet laissé ouvert des jours : on revérifie au retour, pas plus d'une
    // fois par heure (sw.js est en must-revalidate, la requête est un 304).
    const checkForUpdate = () => {
      if (document.visibilityState !== 'visible' || !registration) return;
      const now = Date.now();
      if (now - lastCheck < UPDATE_CHECK_INTERVAL) return;
      lastCheck = now;
      void registration.update();
    };

    // Après le load : le précache ne doit pas concurrencer le premier rendu.
    const register = () => {
      void navigator.serviceWorker.register('/sw.js').then((reg) => {
        if (disposed) return;
        registration = reg;
        lastCheck = Date.now();
        track(reg.waiting ?? reg.installing);
        reg.addEventListener('updatefound', () => track(reg.installing));
        document.addEventListener('visibilitychange', checkForUpdate);
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => {
      disposed = true;
      window.removeEventListener('load', register);
      document.removeEventListener('visibilitychange', checkForUpdate);
    };
  }, []);

  const reload = useCallback(() => {
    if (!waiting) return;
    // controllerchange = le nouveau SW a pris la main, les chunks servis
    // viennent du nouveau cache : c'est le moment de recharger.
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => window.location.reload(),
      { once: true },
    );
    waiting.postMessage({ type: 'SKIP_WAITING' });
  }, [waiting]);

  if (!waiting || dismissed) return null;

  const t = dict.ui.app;
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-line-strong bg-surface-2 px-4 py-3 shadow-[0_18px_40px_-16px_rgba(0,0,0,0.6)] sm:inset-x-auto sm:right-4 sm:bottom-4"
    >
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
      <p className="flex-1 text-sm text-ink">{t.updateAvailable}</p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="rounded-full px-2 py-1 text-xs text-ink-3 transition-colors hover:text-ink"
      >
        {t.updateDismiss}
      </button>
      <button
        type="button"
        onClick={reload}
        className="rounded-full bg-cta px-4 py-1.5 font-display text-sm font-bold tracking-wide text-cta-ink transition-transform hover:-translate-y-px active:translate-y-0"
      >
        {t.updateReload}
      </button>
    </div>
  );
}

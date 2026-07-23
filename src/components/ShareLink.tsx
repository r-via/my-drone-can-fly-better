'use client';

// Bouton « partager ce rapport » (en-tête du rapport) : encode la session
// courante dans un fragment d'URL. Le fragment n'est jamais transmis au
// serveur, ce qui garde la promesse affichée en page d'accueil - rien de ce
// vol ne quitte le navigateur.
//
// Le lien passe par /s (fonction Netlify share-preview) avec le titre et la
// description en query string : c'est ce que lit le crawler Discord/Slack pour
// afficher la carte d'aperçu (craft, score, verdicts par axe). Le rapport
// lui-même reste dans le fragment, que le crawler ne voit jamais.

import { useEffect, useRef, useState } from 'react';

import { CheckIcon, ShareIcon } from '@/components/icons';
import { useLocale } from '@/lib/i18n/locale';
import { computeFlightScore } from '@/lib/score';
import { DEFAULT_MAX_CHARS, encodeSessionAdaptive } from '@/lib/share/codec';

import type { SessionReport, Severity } from '@/lib/types';

export interface ShareLinkProps {
  sessionReport: SessionReport;
  fileName: string;
}

type Status = 'idle' | 'building' | 'ready' | 'error';

const SEV_RANK: Record<Severity, number> = { ok: 0, info: 1, warn: 2, crit: 3 };

export default function ShareLink({ sessionReport, fileName }: ShareLinkProps) {
  const { dict } = useLocale();
  const t = dict.ui.shareLink;

  const [status, setStatus] = useState<Status>('idle');
  const [link, setLink] = useState('');
  const [overBudget, setOverBudget] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Copie refusée : le panneau montre alors le lien, sélectionnable à la main. */
  const [copyFailed, setCopyFailed] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    },
    [],
  );

  // Une nouvelle session sélectionnée invalide le lien déjà construit : sans ça
  // le bouton copierait le rapport de la session précédente.
  useEffect(() => {
    setStatus('idle');
    setLink('');
    setCopied(false);
    setCopyFailed(false);
  }, [sessionReport]);

  const build = async (): Promise<string | null> => {
    setStatus('building');
    try {
      const res = await encodeSessionAdaptive(sessionReport, fileName, dict);

      // Aperçu OG : composé ici, dans la langue courante - la fonction /s ne
      // fait que l'échapper et le servir au crawler.
      const { score, axes } = computeFlightScore(sessionReport);
      let worst: Severity = 'ok';
      for (const f of sessionReport.findings) {
        if (SEV_RANK[f.severity] > SEV_RANK[worst]) worst = f.severity;
      }
      const name =
        sessionReport.analysis.meta.craftName ||
        dict.rules.profiles[sessionReport.profile.id].label;
      const axisSummary = axes
        .map(
          (a) =>
            `${dict.ui.categories[a.category]} ${a.evaluated ? a.score : 'n/a'}`,
        )
        .join(' · ');
      const og = new URLSearchParams({
        t: `${name} · ${score}/100`,
        d: `${dict.ui.verdict[worst]} · ${axisSummary}`,
      });

      // res.trimmed n'est pas montré ici : le destinataire voit déjà la note
      // « les courbes ne tenaient pas dans le lien » sur le rapport reçu, et
      // côté envoi ce détail technique n'aide pas au geste de partage.
      const url = `${window.location.origin}/s?${og.toString()}#r=${res.encoded}`;
      setLink(url);
      setOverBudget(res.overBudget || url.length > DEFAULT_MAX_CHARS + 300);
      setStatus('ready');
      return url;
    } catch {
      setStatus('error');
      return null;
    }
  };

  const share = async () => {
    const url = link || (await build());
    if (!url) return;

    // Un seul geste : copier le lien. Pas de feuille de partage système, le
    // pilote colle où il veut (Discord en tête).
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers refusé (permission, contexte non sécurisé) : le lien
      // reste affiché dans le panneau, sélectionnable à la main.
      setCopyFailed(true);
    }
  };

  const showPanel =
    (status === 'ready' && (overBudget || copyFailed)) || status === 'error';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void share()}
        disabled={status === 'building'}
        aria-label={copied ? t.copied : t.button}
        title={`${t.title} - ${t.description}`}
        className={`inline-flex size-9 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          copied ? 'bg-ok text-bg' : 'bg-cta text-cta-ink hover:opacity-90'
        }`}
      >
        {copied ? <CheckIcon className="size-4" /> : <ShareIcon className="size-4" />}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? t.copiedSr : ''}
      </span>

      {/* Réserves (courbes retirées, lien trop long), copie refusée et erreurs :
          panneau flottant sous le bouton, pour ne pas pousser la mise en page. */}
      {showPanel ? (
        <div className="absolute right-0 top-full z-10 mt-2 w-72 rounded-xl border border-line-strong bg-surface-2 p-3 text-left shadow-[0_16px_40px_-16px_rgba(0,0,0,0.6)]">
          {status === 'error' ? (
            <p className="text-xs font-semibold text-crit">{t.error}</p>
          ) : (
            <>
              {copyFailed && link ? (
                <input
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label={t.title}
                  className="mb-1.5 w-full rounded-lg border border-line bg-bg/60 px-2 py-1.5 font-mono text-[11px] text-ink-2"
                />
              ) : null}
              {overBudget ? (
                <p className="text-xs font-semibold text-warn">{t.overBudget}</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

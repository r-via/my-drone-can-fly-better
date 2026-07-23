'use client';

// Bouton « partager ce rapport » (en-tête du rapport) : encode la session
// courante avec le codec de partage, puis dépose ce rapport encodé sur le
// serveur (/api/share, Netlify Blobs) pour obtenir un lien court /s/<id>.
// La version stockée est toujours complète : courbes incluses, jamais tronquée.
// Seul le rapport calculé part au serveur - jamais le .bbl brut, la promesse
// de la page d'accueil (les logs ne quittent pas le navigateur) tient.
//
// Si le dépôt échoue (hors ligne, fonction absente en next dev) : repli sur le
// lien fragment historique /s?t=…&d=…#r=…, que le serveur ne voit jamais.
// Dans les deux cas le crawler Discord/Slack lit le titre et la description
// (query ou métadonnées du blob) et la carte PNG /api/og.

import { useEffect, useRef, useState } from 'react';

import { CheckIcon, ShareIcon } from '@/components/icons';
import { useLocale } from '@/lib/i18n/locale';
import { computeFlightScore } from '@/lib/score';
import { DEFAULT_MAX_CHARS, encodeSession, encodeSessionAdaptive } from '@/lib/share/codec';

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
      // Aperçu OG : composé ici, dans la langue courante - le serveur ne fait
      // que l'échapper et le servir au crawler.
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

      // Lien court d'abord : la version complète (courbes incluses) part dans
      // le store et l'id suffit dans le chat.
      try {
        const full = await encodeSession(sessionReport, fileName, dict);
        const res = await fetch(`/api/share?${og.toString()}`, { method: 'POST', body: full });
        if (res.ok) {
          const { id } = (await res.json()) as { id?: string };
          if (id) {
            const url = `${window.location.origin}/s/${id}`;
            setLink(url);
            setOverBudget(false);
            setStatus('ready');
            return url;
          }
        }
      } catch {
        // Hors ligne ou fonction absente : le repli fragment prend la suite.
      }

      const res = await encodeSessionAdaptive(sessionReport, fileName, dict);
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

      {/* Confirmation visible : le bouton n'a pas de texte, la coche seule ne
          dit pas ce qui vient de se passer. */}
      {copied ? (
        <p className="absolute right-0 top-full z-10 mt-2 whitespace-nowrap rounded-full border border-line-strong bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ok shadow-[0_12px_30px_-14px_rgba(0,0,0,0.6)]">
          {t.copied}
        </p>
      ) : null}

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

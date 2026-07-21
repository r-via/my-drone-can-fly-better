'use client';

// Bouton « partager ce rapport » : encode la session courante dans un fragment
// d'URL. Le fragment n'est jamais transmis au serveur, ce qui garde la promesse
// affichée en page d'accueil - rien de ce vol ne quitte le navigateur.

import { useEffect, useRef, useState } from 'react';

import { CheckIcon, CopyIcon } from '@/components/icons';
import { useLocale } from '@/lib/i18n/locale';
import { DEFAULT_MAX_CHARS, encodeSessionAdaptive } from '@/lib/share/codec';

import type { SessionReport } from '@/lib/types';

export interface ShareLinkProps {
  sessionReport: SessionReport;
  fileName: string;
}

type Status = 'idle' | 'building' | 'ready' | 'error';

export default function ShareLink({ sessionReport, fileName }: ShareLinkProps) {
  const { dict } = useLocale();
  const t = dict.ui.shareLink;

  const [status, setStatus] = useState<Status>('idle');
  const [link, setLink] = useState('');
  const [trimmed, setTrimmed] = useState(false);
  const [overBudget, setOverBudget] = useState(false);
  const [copied, setCopied] = useState(false);
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
  }, [sessionReport]);

  const build = async (): Promise<string | null> => {
    setStatus('building');
    try {
      const res = await encodeSessionAdaptive(sessionReport, fileName, dict);
      const url = `${window.location.origin}${window.location.pathname}#r=${res.encoded}`;
      setLink(url);
      setTrimmed(res.trimmed);
      setOverBudget(res.overBudget || url.length > DEFAULT_MAX_CHARS + 300);
      setStatus('ready');
      return url;
    } catch {
      setStatus('error');
      return null;
    }
  };

  const copy = async () => {
    const url = link || (await build());
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers refusé (permission, contexte non sécurisé) : le lien
      // reste affiché juste en dessous, sélectionnable à la main.
      setStatus('ready');
    }
  };

  return (
    <section
      aria-label={t.title}
      className="rounded-2xl border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">{t.title}</h3>
        <button
          type="button"
          onClick={() => void copy()}
          disabled={status === 'building'}
          className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            copied ? 'bg-ok text-bg' : 'bg-cta text-cta-ink hover:opacity-90'
          }`}
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          {status === 'building' ? t.building : copied ? t.copied : t.button}
        </button>
        <span aria-live="polite" className="sr-only">
          {copied ? t.copiedSr : ''}
        </span>
      </div>

      <p className="mt-1 text-xs leading-relaxed text-ink-2">{t.description}</p>

      {status === 'ready' && link ? (
        <>
          <input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            aria-label={t.title}
            className="mt-3 w-full rounded-lg border border-line bg-bg/60 px-3 py-2 font-mono text-xs text-ink-2"
          />
          <p className="mt-1.5 font-mono text-[11px] text-ink-3">{t.charCount(link.length)}</p>
          {trimmed ? <p className="mt-2 text-xs text-ink-2">{t.trimmed}</p> : null}
          {overBudget ? <p className="mt-2 text-xs font-semibold text-warn">{t.overBudget}</p> : null}
        </>
      ) : null}

      {status === 'error' ? <p className="mt-2 text-xs font-semibold text-crit">{t.error}</p> : null}
    </section>
  );
}

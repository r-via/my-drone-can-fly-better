'use client';

import { useState } from 'react';
import { useLocale } from '@/lib/i18n/locale';

export interface ShareLogToggleProps {
  /** Fichiers bruts tels que sélectionnés par l'utilisateur (mêmes objets que ceux analysés). */
  files: File[];
  /** Noms de craft détectés, pour contexte dans le message envoyé - purement informatif. */
  craftNames: string[];
  /** `diff all` collé par l'utilisateur, s'il prime sur les headers du log - voir CliConfig.raw. */
  configText?: string | null;
}

type Status = 'idle' | 'sending' | 'sent' | 'error' | 'too-large';

// Marge sous la limite de pièce jointe Discord (8 Mo pour un webhook non boosté).
const MAX_TOTAL_BYTES = 7_000_000;

export default function ShareLogToggle({ files, craftNames, configText }: ShareLogToggleProps) {
  const { locale, dict } = useLocale();
  const t = dict.ui.shareLog;
  const [status, setStatus] = useState<Status>('idle');

  if (files.length === 0) return null;

  const sent = status === 'sent';
  const busy = status === 'sending';

  const send = async () => {
    if (busy || sent) return;
    const configBytes = configText ? new Blob([configText]).size : 0;
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0) + configBytes;
    if (totalBytes > MAX_TOTAL_BYTES) {
      setStatus('too-large');
      return;
    }
    setStatus('sending');
    try {
      const body = new FormData();
      files.forEach((f, i) => body.append(`file${i}`, f, f.name));
      if (configText) {
        body.append('config', new File([configText], 'diff-all.txt', { type: 'text/plain' }));
      }
      body.append(
        'meta',
        JSON.stringify({ craftNames, locale, fileCount: files.length, hasConfig: Boolean(configText) }),
      );
      // Chemin natif des Netlify Functions - fonctionne sans redirect dédié,
      // que ce soit en prod ou via `netlify dev` en local (voir README).
      const res = await fetch('/.netlify/functions/submit-log', { method: 'POST', body });
      if (!res.ok) throw new Error('upstream');
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  };

  const statusText =
    status === 'sending'
      ? t.sending
      : status === 'sent'
        ? t.sent
        : status === 'error'
          ? t.error
          : status === 'too-large'
            ? t.tooLarge
            : null;

  const statusTone = status === 'error' || status === 'too-large' ? 'text-crit' : 'text-ok';

  return (
    <div className="mt-6 flex items-start gap-4 rounded-2xl border border-line bg-surface p-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-ink">{t.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-2">{t.description}</p>
        <button
          type="button"
          disabled={busy || sent || status === 'too-large'}
          onClick={() => void send()}
          className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-bold transition-colors disabled:cursor-not-allowed ${
            sent ? 'bg-ok text-bg' : 'bg-cta text-cta-ink hover:opacity-90 disabled:opacity-60'
          }`}
        >
          {t.buttonLabel(files.length)}
        </button>
        {statusText ? <p className={`mt-2 text-xs font-semibold ${statusTone}`}>{statusText}</p> : null}
      </div>
    </div>
  );
}

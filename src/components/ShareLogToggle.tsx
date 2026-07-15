'use client';

import { useState } from 'react';
import { useLocale } from '@/lib/i18n/locale';

export interface ShareLogToggleProps {
  /** Fichiers bruts tels que sélectionnés par l'utilisateur (mêmes objets que ceux analysés). */
  files: File[];
  /** Noms de craft détectés, pour contexte dans le message envoyé - purement informatif. */
  craftNames: string[];
}

type Status = 'idle' | 'sending' | 'sent' | 'error' | 'too-large';

// Marge sous la limite de pièce jointe Discord (8 Mo pour un webhook non boosté).
const MAX_TOTAL_BYTES = 7_000_000;

export default function ShareLogToggle({ files, craftNames }: ShareLogToggleProps) {
  const { locale, dict } = useLocale();
  const t = dict.ui.shareLog;
  const [status, setStatus] = useState<Status>('idle');

  if (files.length === 0) return null;

  const checked = status === 'sent';
  const busy = status === 'sending';

  const toggle = async () => {
    if (busy || checked) return;
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      setStatus('too-large');
      return;
    }
    setStatus('sending');
    try {
      const body = new FormData();
      files.forEach((f, i) => body.append(`file${i}`, f, f.name));
      body.append('meta', JSON.stringify({ craftNames, locale, fileCount: files.length }));
      const res = await fetch('/api/submit-log', { method: 'POST', body });
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
            : t.toggleLabel(files.length);

  const statusTone =
    status === 'sent' ? 'text-ok' : status === 'error' || status === 'too-large' ? 'text-crit' : 'text-accent';

  return (
    <div className="mt-6 flex items-start gap-4 rounded-2xl border border-line bg-surface p-4">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={t.toggleLabel(files.length)}
        disabled={busy || checked || status === 'too-large'}
        onClick={() => void toggle()}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed ${
          checked ? 'bg-ok' : 'bg-surface-3'
        } ${busy ? 'opacity-60' : ''}`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-0.5 size-5 rounded-full bg-ink transition-transform ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-ink">{t.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-2">{t.description}</p>
        <p className={`mt-2 text-xs font-semibold ${statusTone}`}>{statusText}</p>
      </div>
    </div>
  );
}

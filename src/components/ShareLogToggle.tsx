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

/**
 * Garde-fou aligné sur l'Edge Function submit-log. L'upload est streamé (pas
 * de plafond de fonction synchrone) et le fichier finit dans le store Blobs du
 * site avec un lien posté sur le salon - aucune limite de pièce jointe Discord,
 * donc aucun découpage : un fichier = une requête.
 */
const MAX_TOTAL_BYTES = 100_000_000;

/**
 * Gzip via CompressionStream (natif navigateur). Fallback : fichier brut si
 * l'API manque (vieux navigateur) ou si la compression ne gagne rien.
 */
async function compress(f: File): Promise<{ blob: Blob; name: string }> {
  if (typeof CompressionStream === 'undefined') return { blob: f, name: f.name };
  try {
    const stream = f.stream().pipeThrough(new CompressionStream('gzip'));
    const blob = await new Response(stream).blob();
    return blob.size < f.size ? { blob, name: `${f.name}.gz` } : { blob: f, name: f.name };
  } catch {
    return { blob: f, name: f.name };
  }
}

export default function ShareLogToggle({ files, craftNames }: ShareLogToggleProps) {
  const { locale, dict } = useLocale();
  const t = dict.ui.shareLog;
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState('');

  if (files.length === 0) return null;

  const sent = status === 'sent';
  const busy = status === 'sending';

  const send = async () => {
    if (busy || sent) return;
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      setStatus('too-large');
      return;
    }
    setStatus('sending');
    try {
      for (let i = 0; i < files.length; i++) {
        setProgress({ done: i + 1, total: files.length });
        const { blob, name } = await compress(files[i]);
        const qs = new URLSearchParams({
          name,
          craft: craftNames.join(', '),
          locale,
        });
        // Message facultatif : joint au premier envoi seulement, pour ne pas
        // répéter la même note sur chaque fichier d'un lot.
        const note = message.trim();
        if (note && i === 0) qs.set('note', note);
        const res = await fetch(`/api/submit-log?${qs.toString()}`, {
          method: 'POST',
          body: blob,
        });
        if (!res.ok) throw new Error('upstream');
      }
      setStatus('sent');
    } catch {
      setStatus('error');
    } finally {
      setProgress(null);
    }
  };

  const statusText =
    status === 'sending'
      ? progress && progress.total > 1
        ? t.sendingPart(progress.done, progress.total)
        : t.sending
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
        <label className="mt-3 block">
          <span className="text-xs font-semibold text-ink-2">{t.messageLabel}</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={busy || sent}
            maxLength={280}
            rows={2}
            placeholder={t.messagePlaceholder}
            className="mt-1 w-full resize-y rounded-lg border border-line bg-bg/60 px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none disabled:opacity-60"
          />
        </label>
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

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
 * Taille d'un morceau envoyé : sous la limite de payload d'une fonction Netlify
 * (6 Mo) et très en dessous de la pièce jointe d'un webhook Discord (8 Mo).
 * Un log plus gros est gzippé puis découpé en N morceaux envoyés séquentiellement,
 * chacun dans son propre message Discord (`.gz.partXX-of-NN`, réassemblage par cat).
 */
const CHUNK_BYTES = 5_000_000;

/** Garde-fou : au-delà, même découpé, l'envoi spammerait le salon. */
const MAX_TOTAL_BYTES = 100_000_000;

/** Un morceau à poster : un fragment de fichier (gzippé si utile) + son contexte. */
interface UploadJob {
  blob: Blob;
  name: string;
  originalName: string;
  part: number;
  parts: number;
}

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

/** Découpe chaque fichier compressé en morceaux ≤ CHUNK_BYTES. */
function buildJobs(prepared: Array<{ blob: Blob; name: string }>, files: File[]): UploadJob[] {
  const jobs: UploadJob[] = [];
  prepared.forEach((p, fi) => {
    const parts = Math.max(1, Math.ceil(p.blob.size / CHUNK_BYTES));
    for (let i = 0; i < parts; i++) {
      const nn = String(parts).padStart(2, '0');
      const ii = String(i + 1).padStart(2, '0');
      jobs.push({
        blob: p.blob.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES),
        name: parts > 1 ? `${p.name}.part${ii}-of-${nn}` : p.name,
        originalName: files[fi].name,
        part: i + 1,
        parts,
      });
    }
  });
  return jobs;
}

export default function ShareLogToggle({ files, craftNames }: ShareLogToggleProps) {
  const { locale, dict } = useLocale();
  const t = dict.ui.shareLog;
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

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
      const prepared = await Promise.all(files.map(compress));
      const jobs = buildJobs(prepared, files);
      for (let i = 0; i < jobs.length; i++) {
        setProgress({ done: i + 1, total: jobs.length });
        const j = jobs[i];
        const body = new FormData();
        body.append('file0', j.blob, j.name);
        body.append(
          'meta',
          JSON.stringify({
            craftNames,
            locale,
            fileCount: files.length,
            originalName: j.originalName,
            part: j.part,
            parts: j.parts,
          }),
        );
        // Chemin natif des Netlify Functions - fonctionne sans redirect dédié,
        // que ce soit en prod ou via `netlify dev` en local (voir README).
        const res = await fetch('/.netlify/functions/submit-log', { method: 'POST', body });
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

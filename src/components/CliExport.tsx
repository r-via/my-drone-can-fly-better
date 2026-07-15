'use client';

import { useEffect, useRef, useState } from 'react';
import type { Finding } from '@/lib/types';

/** Rassemble toutes les lignes fix.cli des findings, dédupliquées, ordre préservé. */
export function collectCliLines(findings: Finding[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const f of findings) {
    for (const raw of f.fix?.cli ?? []) {
      const line = raw.trim();
      if (line && !seen.has(line)) {
        seen.add(line);
        lines.push(line);
      }
    }
  }
  return lines;
}

export default function CliExport({ findings }: { findings: Finding[] }) {
  const lines = collectCliLines(findings);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  if (lines.length === 0) {
    return (
      <section aria-label="Commandes CLI" className="rounded-lg border border-line bg-surface p-4">
        <h3 className="text-sm font-semibold text-ink">Commandes CLI</h3>
        <p className="mt-1 text-sm text-ink-2">
          Rien à corriger côté CLI — ta config tient la route.
        </p>
      </section>
    );
  }

  const script = [...lines, 'save'].join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard indisponible (permissions) : l'utilisateur peut sélectionner le bloc à la main.
    }
  };

  return (
    <section aria-label="Commandes CLI" className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          Commandes CLI <span className="text-ink-3">({lines.length} + save)</span>
        </h3>
        <button
          type="button"
          onClick={copy}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
        >
          {copied ? 'Copié !' : 'Copier tout'}
        </button>
        <span aria-live="polite" className="sr-only">
          {copied ? 'Commandes copiées dans le presse-papiers' : ''}
        </span>
      </div>

      <pre className="mt-3 overflow-x-auto rounded-md bg-bg/60 p-3 font-mono text-xs leading-relaxed text-ink">
        {script}
      </pre>

      <p role="note" className="mt-3 text-xs text-ink-2">
        Vérifie chaque ligne avant de coller — c&apos;est toi qui pilotes, pas le rapport.
      </p>
      <p role="note" className="mt-1 text-xs text-warn">
        <span aria-hidden="true">⚠️</span> Sauvegarde en tapant <code className="font-mono">save</code>{' '}
        dans le CLI, pas avec le bouton Save de la GUI : sur certaines versions il peut effacer toute
        ta config (bug connu).
      </p>
    </section>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/lib/i18n/locale';
import { AlertIcon, CheckIcon, CopyIcon } from '@/components/icons';
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
  const { dict } = useLocale();
  const t = dict.ui.cli;
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
      <section aria-label={t.sectionAria} className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="text-sm font-semibold text-ink">{t.title}</h3>
        <p className="mt-1 text-sm text-ink-2">{t.nothingToFix}</p>
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
    <section aria-label={t.sectionAria} className="overflow-hidden rounded-2xl border border-line-strong bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-3.5">
        <h3 className="text-sm font-bold text-ink">
          {t.title} <span className="font-mono text-xs font-normal text-ink-3">{t.countSuffix(lines.length)}</span>
        </h3>
        <button
          type="button"
          onClick={copy}
          className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-bold transition-colors ${
            copied ? 'bg-ok text-bg' : 'bg-cta text-cta-ink hover:opacity-90'
          }`}
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          {copied ? t.copied : t.copyAll}
        </button>
        <span aria-live="polite" className="sr-only">
          {copied ? t.copiedSr : ''}
        </span>
      </div>

      <div className="p-4">
        <pre className="overflow-x-auto rounded-lg bg-bg/60 p-3 font-mono text-xs leading-relaxed text-ink">
          {script}
        </pre>

        <p role="note" className="mt-3 text-xs text-ink-2">{t.verifyNote}</p>
        <p role="note" className="mt-2 flex items-start gap-1.5 rounded-lg bg-warn/10 p-2.5 text-xs text-warn">
          <AlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {t.saveWarnBefore}
            <code className="font-mono">{t.saveWarnCode}</code>
            {t.saveWarnAfter}
          </span>
        </p>
      </div>
    </section>
  );
}

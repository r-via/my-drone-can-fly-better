'use client';

import { useLocale } from '@/lib/i18n/locale';
import { AlertIcon, CheckIcon, InfoIcon, XIcon } from '@/components/icons';

import type { ComponentType } from 'react';
import type { Finding, Severity } from '@/lib/types';

export const SEVERITY_META: Record<
  Severity,
  { icon: ComponentType<{ className?: string }>; text: string; badge: string; border: string; rank: number }
> = {
  crit: {
    icon: XIcon,
    text: 'text-crit',
    badge: 'bg-crit/10 text-crit',
    border: 'border-l-crit',
    rank: 3,
  },
  warn: {
    icon: AlertIcon,
    text: 'text-warn',
    badge: 'bg-warn/10 text-warn',
    border: 'border-l-warn',
    rank: 2,
  },
  info: {
    icon: InfoIcon,
    text: 'text-info',
    badge: 'bg-info/10 text-info',
    border: 'border-l-info',
    rank: 1,
  },
  ok: {
    icon: CheckIcon,
    text: 'text-ok',
    badge: 'bg-ok/10 text-ok',
    border: 'border-l-ok',
    rank: 0,
  },
};

export default function FindingCard({ finding }: { finding: Finding }) {
  const { dict } = useLocale();
  const sev = SEVERITY_META[finding.severity];
  const SevIcon = sev.icon;
  return (
    <article
      className={`rounded-2xl border border-line border-l-[3px] bg-surface p-4 transition-all hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-24px_rgba(0,0,0,0.7)] ${sev.border}`}
      data-rule={finding.id}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${sev.badge}`}
        >
          <SevIcon className="size-3" />
          {dict.ui.severity[finding.severity]}
        </span>
        <h4 className="text-sm font-bold text-ink">{finding.title}</h4>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-ink-2">{finding.detail}</p>

      {finding.evidence ? (
        <details className="mt-2 group">
          <summary className="cursor-pointer text-xs font-medium text-ink-3 hover:text-ink-2">
            {dict.ui.finding.evidenceSummary}
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-bg/60 p-3 font-mono text-xs leading-relaxed text-ink-2 whitespace-pre-wrap">
            {finding.evidence}
          </pre>
        </details>
      ) : null}

      {finding.fix ? (
        <div className="mt-3 rounded-xl border border-accent/30 bg-accent/5 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-accent">
            {dict.ui.finding.fixTitle}
          </p>
          <p className="mt-1 text-sm text-ink">{finding.fix.text}</p>
          {finding.fix.cli && finding.fix.cli.length > 0 ? (
            <pre className="mt-2 overflow-x-auto rounded-lg bg-bg/60 p-2 font-mono text-xs leading-relaxed text-ink">
              {finding.fix.cli.join('\n')}
            </pre>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

'use client';

import { useLocale } from '@/lib/i18n/locale';

import type { ComponentType } from 'react';

export type MetricTone = 'neutral' | 'ok' | 'warn' | 'crit';

const TONE_VAR: Record<Exclude<MetricTone, 'neutral'>, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  crit: 'var(--crit)',
};

export interface MetricTileProps {
  /** Libellé court, sans deux-points final. */
  label: string;
  /** Valeur déjà formatée (décimales à la française). */
  value: string;
  unit?: string;
  /** Ligne secondaire optionnelle (contexte, détail). */
  hint?: string;
  tone?: MetricTone;
  /** Petit glyphe de contexte (horloge, batterie, ...), purement décoratif. */
  icon?: ComponentType<{ className?: string }>;
}

export default function MetricTile({
  label,
  value,
  unit,
  hint,
  tone = 'neutral',
  icon: Icon,
}: MetricTileProps) {
  const { dict } = useLocale();
  const toneColor = tone === 'neutral' ? undefined : TONE_VAR[tone];
  const toneSr = tone === 'neutral' ? null : dict.ui.metricTone[tone];
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-line bg-surface p-3.5 transition-all hover:-translate-y-0.5 hover:border-line-strong">
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{ background: toneColor ?? 'var(--line-strong)' }}
      />
      <div className="flex items-center justify-between">
        {Icon ? <Icon className="size-[15px] text-ink-3" /> : <span />}
        {toneColor ? (
          <span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: toneColor }} />
        ) : null}
      </div>
      <p className="mt-2 text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
        {toneSr ? <span className="sr-only">{toneSr} - </span> : null}
        {label}
      </p>
      {/* whitespace-nowrap + taille réduite : une valeur comme « 5 min 07 s »
          ne doit JAMAIS se replier sur deux lignes dans la tuile. */}
      <p className="mt-0.5 whitespace-nowrap font-mono text-base font-bold leading-tight text-ink sm:text-lg">
        {value}
        {unit ? <span className="ml-1 text-xs font-normal text-ink-2">{unit}</span> : null}
      </p>
      {hint ? <p className="mt-1 text-[10.5px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

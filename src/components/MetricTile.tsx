export type MetricTone = 'neutral' | 'ok' | 'warn' | 'crit';

const TONE_DOT: Record<Exclude<MetricTone, 'neutral'>, { dot: string; sr: string }> = {
  ok: { dot: 'bg-ok', sr: 'état : bon' },
  warn: { dot: 'bg-warn', sr: 'état : à surveiller' },
  crit: { dot: 'bg-crit', sr: 'état : critique' },
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
}

export default function MetricTile({ label, value, unit, hint, tone = 'neutral' }: MetricTileProps) {
  const toneMeta = tone === 'neutral' ? null : TONE_DOT[tone];
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-3">
        {toneMeta ? (
          <>
            <span aria-hidden="true" className={`size-1.5 rounded-full ${toneMeta.dot}`} />
            <span className="sr-only">{toneMeta.sr} — </span>
          </>
        ) : null}
        {label}
      </p>
      <p className="mt-1 font-mono text-xl font-semibold leading-tight text-ink sm:text-2xl">
        {value}
        {unit ? <span className="ml-1 text-sm font-normal text-ink-2">{unit}</span> : null}
      </p>
      {hint ? <p className="mt-1 text-xs text-ink-2">{hint}</p> : null}
    </div>
  );
}

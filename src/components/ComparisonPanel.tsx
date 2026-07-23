'use client';

// Panneau « comparaison de passes » : montre, pour deux vols consécutifs du même
// quad, ce que le pilote a changé et ce que la mesure a fait en réponse. N'existe
// que dans l'app (jamais dans un lien partagé, qui porte une seule session).

import { useLocale } from '@/lib/i18n/locale';
import { AlertIcon } from '@/components/icons';
import { AXIS_NAMES } from '@/lib/types';

import { splitCommonCaveats } from '@/lib/compare';

import type { Locale } from '@/lib/i18n';
import type { MetricDelta, SessionComparison, SessionRef } from '@/lib/compare';

function fixed(v: number, digits: number, locale: Locale): string {
  return v.toFixed(digits).replace('.', locale === 'fr' ? ',' : '.');
}

/** Valeur d'un indicateur avec l'axe d'où elle vient, ou n/a. */
function MetricValue({
  value,
  axis,
  digits,
  locale,
}: {
  value: number | null;
  axis: number | null;
  digits: number;
  locale: Locale;
}) {
  const { dict } = useLocale();
  if (value === null) return <span className="text-ink-2">{dict.compare.metricUnavailable}</span>;
  return (
    <span className="font-mono tabular-nums text-ink">
      {fixed(value, digits, locale)}
      {axis !== null ? <span className="ml-1 text-xs text-ink-2">{AXIS_NAMES[axis]}</span> : null}
    </span>
  );
}

/**
 * Delta signé, coloré selon qu'il va dans le bon sens. Un témoin (`neutral`,
 * ex. le bruit brut) est affiché sans jugement de couleur : il sert à valider
 * la comparaison, pas à la noter.
 */
function DeltaCell({ m, locale }: { m: MetricDelta; locale: Locale }) {
  if (m.delta === null) return <span className="text-ink-2">–</span>;
  const flat = Math.abs(m.delta) < 10 ** -m.digits / 2;
  const sign = m.delta > 0 ? '+' : '';
  const text = `${sign}${fixed(m.delta, m.digits, locale)}`;

  if (m.better === 'neutral' || flat) {
    return <span className="font-mono tabular-nums text-ink-2">{text}</span>;
  }
  const good = m.delta < 0 === (m.better === 'lower');
  return (
    <span className={`font-mono font-semibold tabular-nums ${good ? 'text-ok' : 'text-warn'}`}>
      {text}
    </span>
  );
}

function refLabel(ref: SessionRef): string {
  return `${ref.fileName} · ${ref.sessionIndex + 1}`;
}

/**
 * Carte repliable. Dépliée par défaut UNIQUEMENT quand un réglage a changé :
 * c'est la raison d'être du panneau. Une paire sans changement de tune (le cas
 * de loin le plus courant quand on dépose une carte SD entière) se réduit à une
 * ligne - mesuré sur 10 logs réels, les cartes toutes dépliées repoussaient le
 * rapport de vol 4,6 écrans plus bas.
 */
function ComparisonCard({ cmp }: { cmp: SessionComparison }) {
  const { dict, locale } = useLocale();
  const c = dict.compare;
  const drivers = cmp.tuneChanges.some((t) => t.driver);
  const changed = cmp.tuneChanges.length;

  return (
    <details
      open={changed > 0}
      className="group rounded-2xl border border-line bg-surface"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 p-4 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="font-mono text-xs text-ink-3 transition-transform group-open:rotate-90"
        >
          ▶
        </span>
        <h3 className="min-w-0 font-mono text-sm font-semibold text-ink">
          {c.heading(refLabel(cmp.before), refLabel(cmp.after))}
        </h3>
        <span className="ml-auto flex items-center gap-2 text-xs text-ink-2">
          {changed > 0 ? (
            <span className="font-semibold text-ink">{c.summaryChanges(changed)}</span>
          ) : (
            <span>{c.summaryNoChange}</span>
          )}
          {cmp.caveats.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-warn">
              <AlertIcon className="size-3.5" />
              {c.caveatsCount(cmp.caveats.length)}
            </span>
          ) : null}
        </span>
      </summary>

      <div className="px-4 pb-4">
      {/* Caveats en premier : ils disent si la comparaison est fiable, avant même
          de la lire. */}
      {cmp.caveats.length > 0 ? (
        <ul className="space-y-1.5">
          {cmp.caveats.map((cav) => (
            <li key={cav.id} className="flex items-start gap-1.5 text-xs leading-relaxed text-ink-2">
              <AlertIcon className="mt-0.5 size-3.5 shrink-0 text-warn" />
              <span>{(c.caveats[cav.id as keyof typeof c.caveats] as (...a: string[]) => string)(...cav.args)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Ce qui a changé */}
      {cmp.tuneChanges.length === 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-ink-2">{c.noTuneChange}</p>
      ) : (
        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-2">{c.tuneTitle}</p>
          <ul className="mt-2 space-y-1">
            {cmp.tuneChanges.map((t) => (
              <li
                key={t.key}
                className="flex items-baseline justify-between gap-3 font-mono text-xs"
              >
                <span className={t.driver ? 'font-semibold text-ink' : 'text-ink-2'}>
                  {t.driver ? '▸ ' : ''}
                  {t.key}
                </span>
                <span className="tabular-nums text-ink-2">
                  {t.before} <span className="text-ink-2">→</span>{' '}
                  <span className="text-ink">{t.after}</span>
                </span>
              </li>
            ))}
          </ul>
          {drivers ? <p className="mt-2 text-xs italic leading-relaxed text-ink-2">{c.driverNote}</p> : null}
        </div>
      )}

      {/* Ce que la mesure en dit */}
      <div className="mt-4">
        <p className="text-xs font-bold uppercase tracking-wide text-ink-2">{c.metricsTitle}</p>
        <table className="mt-2 w-full text-xs">
          <tbody>
            {cmp.metrics.map((m) => (
              <tr key={m.id} className="border-t border-line/60">
                <td className="py-1.5 pr-2 text-ink-2">
                  {c.metrics[m.id as keyof typeof c.metrics]}
                </td>
                <td className="py-1.5 text-right">
                  <MetricValue value={m.before} axis={m.beforeAxis} digits={m.digits} locale={locale} />
                </td>
                <td className="px-1.5 py-1.5 text-center text-ink-2">→</td>
                <td className="py-1.5 text-left">
                  <MetricValue value={m.after} axis={m.afterAxis} digits={m.digits} locale={locale} />
                </td>
                <td className="py-1.5 pl-2 text-right">
                  <DeltaCell m={m} locale={locale} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
    </details>
  );
}

export default function ComparisonPanel({ comparisons }: { comparisons: SessionComparison[] }) {
  const { dict } = useLocale();
  const c = dict.compare;
  if (comparisons.length === 0) return null;

  // Un caveat identique sur toutes les paires est une propriété du groupe :
  // affiché une fois ici, retiré des cartes (voir splitCommonCaveats).
  const { common, perPair } = splitCommonCaveats(comparisons);

  return (
    <section aria-label={c.title} className="space-y-3">
      <h2 className="font-display text-lg font-bold text-ink">{c.title}</h2>
      {common.length > 0 ? (
        <ul className="space-y-1.5">
          {common.map((cav) => (
            <li key={cav.id} className="flex items-start gap-1.5 text-xs leading-relaxed text-ink-2">
              <AlertIcon className="mt-0.5 size-3.5 shrink-0 text-warn" />
              <span>{(c.caveats[cav.id as keyof typeof c.caveats] as (...a: string[]) => string)(...cav.args)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {perPair.map((cmp, i) => (
        <ComparisonCard key={`${cmp.before.fileName}-${cmp.before.sessionIndex}-${i}`} cmp={cmp} />
      ))}
    </section>
  );
}

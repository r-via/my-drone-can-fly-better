'use client';

import { useState } from 'react';
import { eventSeverity, qualifyingEvents } from '@/lib/analysis/oscillation';
import { useLocale } from '@/lib/i18n/locale';
import type {
  CliConfig,
  FileReport,
  Finding,
  FindingCategory,
  Report,
  SessionReport,
  Severity,
} from '@/lib/types';
import CliExport from '@/components/CliExport';
import FindingCard, { SEVERITY_META } from '@/components/FindingCard';
import {
  AlertIcon,
  BatteryIcon,
  BoltIcon,
  CheckIcon,
  ClockIcon,
  GaugeIcon,
  TimerIcon,
  WaveIcon,
} from '@/components/icons';
import MetricTile, { type MetricTone } from '@/components/MetricTile';
import ScoreGauge from '@/components/ScoreGauge';
import SessionPicker, { type SessionPickerItem } from '@/components/SessionPicker';
import ShareLink from '@/components/ShareLink';
import ShareLogToggle from '@/components/ShareLogToggle';
import { SpectrumChart } from '@/components/charts/SpectrumChart';
import { StepResponseChart } from '@/components/charts/StepResponseChart';
import { TimelineStrip } from '@/components/charts/TimelineStrip';

import type { Dict, Locale } from '@/lib/i18n';

// ---------------------------------------------------------------------------
// Formatage - séparateur décimal selon la langue
// ---------------------------------------------------------------------------

interface Formatters {
  fixed: (v: number, digits: number) => string;
  duration: (s: number) => string;
  clock: (s: number) => string;
  hz: (hz: number) => string;
  bytes: (n: number) => string;
}

function makeFormatters(locale: Locale, dict: Dict): Formatters {
  const sep = locale === 'fr' ? ',' : '.';
  const fixed = (v: number, digits: number) => v.toFixed(digits).replace('.', sep);
  const duration = (s: number): string => {
    if (!Number.isFinite(s) || s < 0) return 'n/a';
    if (s < 60) return `${fixed(s, 1)} s`;
    let m = Math.floor(s / 60);
    let r = Math.round(s - m * 60);
    if (r === 60) {
      m += 1;
      r = 0;
    }
    return `${m} min ${String(r).padStart(2, '0')} s`;
  };
  const clock = (s: number): string => {
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${String(r).padStart(2, '0')}`;
  };
  const hz = (v: number): string => (v >= 1000 ? `${fixed(v / 1000, 2)} kHz` : `${Math.round(v)} Hz`);
  const bytes = (n: number): string =>
    n >= 1_000_000
      ? `${fixed(n / 1_000_000, 1)} ${dict.ui.units.mega}`
      : `${Math.max(1, Math.round(n / 1000))} ${dict.ui.units.kilo}`;
  return { fixed, duration, clock, hz, bytes };
}

// ---------------------------------------------------------------------------
// Verdicts & catégories
// ---------------------------------------------------------------------------

const CATEGORY_ORDER: FindingCategory[] = [
  'securite',
  'vibrations',
  'filtres',
  'pid',
  'moteurs',
  'batterie',
  'config',
  'gps',
  'log',
];

function worstSeverity(findings: Finding[]): Severity {
  let worst: Severity = 'ok';
  for (const f of findings) {
    if (SEVERITY_META[f.severity].rank > SEVERITY_META[worst].rank) worst = f.severity;
  }
  return worst;
}

/** Groupe par catégorie ; sections triées par pire sévérité desc puis ordre fixe des catégories. */
function groupFindings(
  findings: Finding[],
): Array<{ category: FindingCategory; findings: Finding[] }> {
  const byCat = new Map<FindingCategory, Finding[]>();
  for (const f of findings) {
    const list = byCat.get(f.category);
    if (list) list.push(f);
    else byCat.set(f.category, [f]);
  }
  const groups = Array.from(byCat.entries()).map(([category, list]) => ({
    category,
    findings: [...list].sort(
      (a, b) => SEVERITY_META[b.severity].rank - SEVERITY_META[a.severity].rank,
    ),
  }));
  return groups.sort((a, b) => {
    const worstA = SEVERITY_META[worstSeverity(a.findings)].rank;
    const worstB = SEVERITY_META[worstSeverity(b.findings)].rank;
    if (worstA !== worstB) return worstB - worstA;
    return CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
  });
}

// ---------------------------------------------------------------------------
// Score /100 - purement une visualisation du même verdict, pas une nouvelle
// règle : pénalité fixe par sévérité, plafonnée à 0. Le détail par catégorie
// reste affiché à côté pour que le chiffre soit traçable, pas une boîte noire.
// ---------------------------------------------------------------------------

const SEVERITY_PENALTY: Record<Severity, number> = { crit: 25, warn: 12, info: 4, ok: 0 };

function computeFlightScore(groups: Array<{ category: FindingCategory; findings: Finding[] }>): {
  score: number;
  penalties: Array<{ category: FindingCategory; penalty: number }>;
} {
  const penalties = groups
    .map((g) => ({
      category: g.category,
      penalty: g.findings.reduce((sum, f) => sum + SEVERITY_PENALTY[f.severity], 0),
    }))
    .filter((p) => p.penalty > 0)
    .sort((a, b) => b.penalty - a.penalty);
  const score = Math.max(0, 100 - penalties.reduce((sum, p) => sum + p.penalty, 0));
  return { score, penalties };
}

/** Catégories affichées en aperçu rapide - seulement celles pertinentes pour ce vol. */
const CHIP_CATEGORIES: FindingCategory[] = [
  'securite',
  'vibrations',
  'filtres',
  'pid',
  'moteurs',
  'batterie',
  'gps',
  'log',
];

// ---------------------------------------------------------------------------
// Blocs
// ---------------------------------------------------------------------------

function SessionBlock({
  sessionReport,
  fileName,
  pasteConfig,
  shareable,
}: {
  sessionReport: SessionReport;
  fileName: string;
  pasteConfig: CliConfig | null;
  /** Faux sur un rapport déjà reçu par lien : on ne repartage pas un partage. */
  shareable: boolean;
}) {
  const { locale, dict } = useLocale();
  const t = dict.ui.report;
  const fmt = makeFormatters(locale, dict);
  const { analysis, profile, findings } = sessionReport;
  const meta = analysis.meta;
  const power = analysis.power;
  const th = profile.thresholds;
  const profileText = dict.rules.profiles[profile.id];

  // Marqueurs de la frise : mêmes événements que le verdict oscillation-event,
  // via le sélecteur partagé. Un marqueur sans verdict (ou l'inverse) laisserait
  // le pilote chercher un problème qu'on n'a pas confirmé.
  const oscEvents = qualifyingEvents(analysis.oscillation, th);
  const timelineEvents = oscEvents.map((e) => ({
    tStart: e.tStart,
    tEnd: e.tEnd,
    severity: eventSeverity(e, th),
    label: `${e.freqHz.toFixed(0)} Hz`,
  }));

  const worst = worstSeverity(findings);
  const sev = SEVERITY_META[worst];
  const SevIcon = sev.icon;

  const sagPerCell = power && power.cells > 0 ? power.sagV / power.cells : null;
  const sagTone: MetricTone =
    sagPerCell == null
      ? 'neutral'
      : sagPerCell >= th.sagPerCellCrit
        ? 'crit'
        : sagPerCell >= th.sagPerCellWarn
          ? 'warn'
          : 'ok';
  const satPct = analysis.motors.saturationPct;
  const satTone: MetricTone =
    satPct >= th.saturationCrit ? 'crit' : satPct >= th.saturationWarn ? 'warn' : 'ok';

  const groups = groupFindings(findings);
  const { score, penalties } = computeFlightScore(groups);
  const breakdown = penalties
    .slice(0, 3)
    .map((p) => `${dict.ui.categories[p.category]} -${p.penalty}`)
    .join(' · ');

  const chipCategories = CHIP_CATEGORIES.filter((cat) => {
    if (cat === 'gps') return analysis.gps.available;
    if (cat === 'batterie') return power !== null;
    return true;
  });
  const chips = chipCategories.map((cat) => {
    const group = groups.find((g) => g.category === cat);
    return { category: cat, worst: group ? worstSeverity(group.findings) : ('ok' as Severity) };
  });

  return (
    <div className="space-y-4">
      {/* Bandeau profil + score de vol */}
      <div className="flex flex-col gap-5 rounded-2xl border border-line-strong bg-surface-2 p-5 sm:flex-row sm:items-center">
        <ScoreGauge score={score} worst={worst} />
        <div className="min-w-0 flex-1">
          <p className="font-display text-xl font-bold text-ink">
            {meta.craftName || profileText.label}
            <span className="ml-2 font-sans text-sm font-normal text-ink-3">
              {t.profileTag(profileText.label)}
            </span>
          </p>
          <p className="mt-0.5 font-mono text-xs text-ink-3">
            {meta.firmware}
            {meta.boardInfo ? ` · ${meta.boardInfo}` : ''}
          </p>
          <p
            className={`mt-3 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-bold ${sev.badge}`}
          >
            <SevIcon className="size-3.5" />
            {dict.ui.verdict[worst]}
          </p>
          {breakdown ? <p className="mt-2 font-mono text-[11px] text-ink-3">100 - {breakdown}</p> : null}
          {profileText.notes.length > 0 ? (
            <ul className="mt-3 space-y-0.5 text-xs text-ink-2">
              {profileText.notes.map((note) => (
                <li key={note}>• {note}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {/* Tuiles chiffrées */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <MetricTile label={t.tileDuration} value={fmt.duration(meta.durationS)} icon={ClockIcon} />
        <MetricTile label={t.tileSampleRate} value={fmt.hz(meta.sampleRateHz)} icon={WaveIcon} />
        <MetricTile
          label={t.tileBattery}
          value={power ? `${power.cells}S` : 'n/a'}
          hint={
            power && sagPerCell != null
              ? t.batterySag(fmt.fixed(power.sagV, 2), fmt.fixed(sagPerCell, 2))
              : power
                ? t.batteryRange(fmt.fixed(power.vbatMin, 2), fmt.fixed(power.vbatMax, 2))
                : t.batteryNoVbat
          }
          tone={sagTone}
          icon={BatteryIcon}
        />
        <MetricTile
          label={t.tileMaxCurrent}
          value={power && power.ampMax != null ? fmt.fixed(power.ampMax, 1) : 'n/a'}
          unit={power && power.ampMax != null ? 'A' : undefined}
          hint={power && power.ampAvg != null ? t.currentAvg(fmt.fixed(power.ampAvg, 1)) : undefined}
          icon={BoltIcon}
        />
        <MetricTile
          label={t.tileSaturation}
          value={fmt.fixed(satPct, 1)}
          unit="%"
          tone={satTone}
          icon={GaugeIcon}
        />
        <MetricTile
          label={t.tileFlightTime}
          value={fmt.duration(analysis.timeline.flightTimeS)}
          hint={t.flightTimeHint}
          icon={TimerIcon}
        />
      </div>

      {/* Aperçu rapide par catégorie */}
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const chipSev = SEVERITY_META[chip.worst];
          const ChipIcon = chipSev.icon;
          return (
            <span
              key={chip.category}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                chip.worst === 'ok'
                  ? 'border-line text-ink-2'
                  : 'border-line-strong text-ink'
              }`}
            >
              <ChipIcon className={`size-3.5 ${chipSev.text}`} />
              {dict.ui.categories[chip.category]}
            </span>
          );
        })}
      </div>

      {/* Graphes (chaque SVG porte son propre titre) */}
      {analysis.timeline.segments.length > 0 ? (
        <figure className="rounded-2xl border border-line bg-surface p-4">
          <figcaption className="mb-2 text-sm font-semibold text-ink">
            {t.timelineCaption}
          </figcaption>
          <TimelineStrip
            segments={analysis.timeline.segments}
            durationS={meta.durationS}
            events={timelineEvents}
            labels={dict.ui.charts.timeline}
          />
          {oscEvents.length > 0 ? (
            /* Un marqueur dit OÙ, pas QUOI : la phrase donne les grandeurs
               mesurées telles quelles, pour que le lecteur voie que le verdict
               vient d'un calcul et non d'une appréciation. */
            <div className="mt-3 border-t border-line pt-3">
              <p className="text-xs font-medium text-ink-2">{t.timelineEventIntro}</p>
              <ul className="mt-1 space-y-1">
                {oscEvents.map((e) => (
                  <li key={e.tStart} className="text-xs leading-relaxed text-ink-3">
                    {t.timelineEventLine(
                      e.tStart.toFixed(1),
                      (e.tEnd - e.tStart).toFixed(2),
                      e.freqHz.toFixed(0),
                      e.ratio.toFixed(0),
                      e.saturationPct.toFixed(0),
                      e.motorsAtStop.map((m) => `M${m}`).join(', ') || null,
                      e.peakGyroDps.toFixed(0),
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </figure>
      ) : null}
      {analysis.spectrum ? (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <SpectrumChart
            axes={analysis.spectrum.axes}
            motorFundamentalHz={analysis.spectrum.motorFundamentalHz}
            labels={dict.ui.charts.spectrum}
          />
        </div>
      ) : null}
      {analysis.step ? (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <StepResponseChart axes={analysis.step.axes} labels={dict.ui.charts.step} />
        </div>
      ) : null}

      {/* Verdicts par catégorie */}
      {groups.length === 0 ? (
        <p className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-4 text-sm text-ink-2">
          <CheckIcon className="size-4 shrink-0 text-ok" /> {t.noFindings}
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.category} aria-label={dict.ui.categories[group.category]}>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">
              {dict.ui.categories[group.category]}
            </h4>
            <div className="space-y-2">
              {group.findings.map((finding, i) => (
                <FindingCard key={`${finding.id}-${i}`} finding={finding} />
              ))}
            </div>
          </section>
        ))
      )}

      {shareable ? (
        <ShareLink sessionReport={sessionReport} fileName={fileName} pasteConfig={pasteConfig} />
      ) : null}
    </div>
  );
}

function FileSection({
  file,
  selected,
  onSelect,
  pasteConfig,
  shareable,
}: {
  file: FileReport;
  selected: number;
  onSelect: (i: number) => void;
  pasteConfig: CliConfig | null;
  shareable: boolean;
}) {
  const { locale, dict } = useLocale();
  const t = dict.ui.report;
  const fmt = makeFormatters(locale, dict);
  const valid = file.sessionReports.length;
  const skipped = file.skipped.length;

  // Heure relative de début : cumul des durées des sessions valides précédentes.
  let offset = 0;
  const items: SessionPickerItem[] = file.sessionReports.map((sr, i) => {
    const dur = sr.analysis.meta.durationS;
    const item: SessionPickerItem = {
      value: i,
      label: t.sessionLabel(String(sr.analysis.meta.index + 1)),
      sublabel: t.sessionSublabel(fmt.duration(dur), fmt.clock(offset)),
    };
    offset += dur;
    return item;
  });

  const current = file.sessionReports[selected] ?? file.sessionReports[0];

  return (
    <section aria-label={t.fileAria(file.fileName)} className="space-y-4">
      <div className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="min-w-0 truncate font-mono text-base font-semibold text-ink">
            {file.fileName}
          </h2>
          <p className="text-xs text-ink-2">
            {t.validSessions(valid)}
            {skipped > 0 ? <span className="text-warn"> · {t.skippedSessions(skipped)}</span> : null}
          </p>
        </div>
        {skipped > 0 ? (
          <ul className="mt-2 space-y-1 text-xs text-ink-2">
            {file.skipped.map((s) => (
              <li key={s.index} className="flex items-start gap-1.5">
                <AlertIcon className="mt-0.5 size-3.5 shrink-0 text-warn" />
                <span>{t.skippedSession(String(s.index + 1), s.error, fmt.bytes(s.sizeBytes))}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {items.length > 1 ? (
          <div className="mt-3">
            <SessionPicker items={items} selected={selected} onSelect={onSelect} />
          </div>
        ) : null}
      </div>

      {current ? (
        <SessionBlock
          sessionReport={current}
          fileName={file.fileName}
          pasteConfig={pasteConfig}
          shareable={shareable}
        />
      ) : (
        <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-ink-2">
          {t.noUsableSession}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Vue principale
// ---------------------------------------------------------------------------

export default function ReportView({
  report,
  onReset,
  files,
}: {
  report: Report;
  onReset: () => void;
  files: File[];
}) {
  const { dict } = useLocale();
  const t = dict.ui.report;
  const [selection, setSelection] = useState<Record<number, number>>({});

  const cliFindings: Finding[] = [...report.configFindings];
  report.files.forEach((file, i) => {
    const sr = file.sessionReports[selection[i] ?? 0];
    if (sr) cliFindings.push(...sr.findings);
  });

  const configGroups = groupFindings(report.configFindings);
  const craftNames = report.files
    .map((f) => f.sessionReports[0]?.analysis.meta.craftName)
    .filter((name): name is string => Boolean(name));

  const shared = report.shared;
  const isShared = shared !== undefined;
  const ts = dict.ui.shareLink;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-ink">{t.title}</h1>
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border border-line bg-surface px-4 py-1.5 text-sm font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
        >
          {isShared ? ts.bannerCta : t.newAnalysis}
        </button>
      </div>

      {isShared ? (
        <div className="rounded-2xl border border-line-strong bg-surface-2 p-4">
          <p className="text-sm font-bold text-ink">{ts.bannerTitle}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-2">{ts.bannerText}</p>
          {/* Dire que les courbes manquent, plutôt que laisser croire que ce
              vol n'avait pas de spectre. */}
          {shared.trimmed ? <p className="mt-2 text-xs text-ink-2">{ts.trimmed}</p> : null}
        </div>
      ) : null}

      {report.configFindings.length > 0 ? (
        <section aria-label={t.configAria} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
            {t.configTitle}{' '}
            {report.config?.source === 'paste' ? t.configSourcePaste : t.configSourceHeaders}
          </h3>
          {configGroups.flatMap((group) =>
            group.findings.map((finding, i) => (
              <FindingCard key={`${finding.id}-${i}`} finding={finding} />
            )),
          )}
        </section>
      ) : null}

      {report.files.map((file, i) => (
        <FileSection
          key={file.fileName}
          file={file}
          selected={selection[i] ?? 0}
          onSelect={(v) => setSelection((prev) => ({ ...prev, [i]: v }))}
          pasteConfig={report.config?.source === 'paste' ? report.config : null}
          shareable={!isShared}
        />
      ))}

      <CliExport findings={cliFindings} />

      <ShareLogToggle
        files={files}
        craftNames={craftNames}
        configText={report.config?.source === 'paste' ? report.config.raw : null}
      />
    </div>
  );
}

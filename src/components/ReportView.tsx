'use client';

import { useState } from 'react';
import { eventSeverity, qualifyingEvents } from '@/lib/analysis/oscillation';
import { useLocale } from '@/lib/i18n/locale';
import type {
  Finding,
  FindingCategory,
  Report,
  SessionReport,
  Severity,
  SkippedSession,
} from '@/lib/types';
import { buildComparisons } from '@/lib/compare';
import { computeFlightScore } from '@/lib/score';
import ChartHelp from '@/components/ChartHelp';
import CliExport from '@/components/CliExport';
import ComparisonPanel from '@/components/ComparisonPanel';
import FindingCard, { SEVERITY_META } from '@/components/FindingCard';
import {
  AlertIcon,
  BatteryIcon,
  BoltIcon,
  CheckIcon,
  ClockIcon,
  GaugeIcon,
  SatelliteIcon,
  TimerIcon,
  WaveIcon,
} from '@/components/icons';
import MetricTile, { type MetricTone } from '@/components/MetricTile';
import ScoreGauge, { type GaugeSegment } from '@/components/ScoreGauge';
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
  skipped,
}: {
  sessionReport: SessionReport;
  /** Sessions écartées du même fichier : affichées repliées, rattachées au vol. */
  skipped: SkippedSession[];
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

  // Tuile GPS : uniquement quand des chiffres existent (les liens partagés ne
  // transportent que gps.available, la tuile y disparaît, les verdicts restent).
  const gps = analysis.gps;
  const showGpsTile =
    gps.available && gps.numSatMedian !== null && gps.numSatMin !== null && gps.numSatMax !== null;
  const gpsTone: MetricTone =
    gps.numSatMin !== null && gps.numSatMin < 5
      ? 'crit'
      : gps.numSatMin !== null && gps.numSatMin < 6
        ? 'warn'
        : 'ok';

  const groups = groupFindings(findings);
  const flightScore = computeFlightScore(sessionReport);
  const { score, axes } = flightScore;

  // Tranches de l'anneau : une par axe pondéré, grise quand la donnée manque.
  // Le tooltip porte la note de l'axe, sa part du score et ce qu'il mesure.
  // Une tranche dont l'axe a des verdicts pointe vers sa section (ancre).
  const gaugeSegments: GaugeSegment[] = axes.map((a) => {
    const label = dict.ui.categories[a.category];
    const hasSection = groups.some((g) => g.category === a.category);
    return {
      key: a.category,
      weight: a.weight,
      tone: a.evaluated ? a.worst : ('absent' as const),
      label,
      status: a.evaluated ? `${a.score}/100` : t.axisNoData,
      share: t.axisShare(a.weight),
      detail: t.axisDetails[a.category as keyof typeof t.axisDetails],
      targetId: hasSection ? `findings-${a.category}` : null,
      score: a.evaluated ? a.score : undefined,
    };
  });

  // Traçabilité du chiffre : axes entamés ou absents, puis déductions plates.
  const breakdown = [
    ...axes
      .filter((a) => !a.evaluated || a.score < 100)
      .map((a) =>
        a.evaluated ? `${dict.ui.categories[a.category]} ${a.score}` : `${dict.ui.categories[a.category]} n/a`,
      ),
    ...flightScore.flatPenalties.map((p) => `${dict.ui.categories[p.category]} -${p.penalty}`),
  ].join(' · ');

  // GPS masqué quand absent (la plupart des quads n'en ont pas) ; la batterie
  // reste affichée en grisé « données absentes » - c'est un axe du score.
  const chipCategories = CHIP_CATEGORIES.filter((cat) => {
    if (cat === 'gps') return analysis.gps.available;
    return true;
  });
  const chips = chipCategories.map((cat) => {
    if (cat === 'batterie' && power === null) {
      return { category: cat, worst: 'ok' as Severity, absent: true };
    }
    const group = groups.find((g) => g.category === cat);
    return {
      category: cat,
      worst: group ? worstSeverity(group.findings) : ('ok' as Severity),
      absent: false,
    };
  });

  return (
    <div className="space-y-4">
      {/* Bandeau profil + score de vol */}
      <div className="flex flex-col gap-5 rounded-2xl border border-line-strong bg-surface-2 p-5 sm:flex-row sm:items-center">
        <ScoreGauge
          score={score}
          worst={worst}
          segments={gaugeSegments}
          gotoHint={t.axisGoto}
        />
        <div className="min-w-0 flex-1">
          <p className="font-display text-xl font-bold text-ink">
            {meta.craftName || profileText.label}
            {/* Sans craft name, le titre EST déjà le nom du profil : le tag
                « profil X » répéterait le même texte côte à côte. */}
            {meta.craftName ? (
              <span className="ml-2 font-sans text-sm font-normal text-ink-3">
                {t.profileTag(profileText.label)}
              </span>
            ) : null}
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
          {breakdown ? <p className="mt-2 font-mono text-[11px] text-ink-3">{breakdown}</p> : null}
          {flightScore.capped ? (
            <p className="mt-1 text-[11px] text-ink-3">{t.scoreCappedNote}</p>
          ) : null}
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
      <div
        className={
          showGpsTile
            ? 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7'
            : 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6'
        }
      >
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
          value={power && power.ampMax != null && !power.ampImplausible ? fmt.fixed(power.ampMax, 1) : 'n/a'}
          unit={power && power.ampMax != null && !power.ampImplausible ? 'A' : undefined}
          hint={
            power?.ampImplausible
              ? t.currentUnreliable
              : power && power.ampAvg != null
                ? t.currentAvg(fmt.fixed(power.ampAvg, 1))
                : undefined
          }
          tone={power?.ampImplausible ? 'warn' : undefined}
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
        {showGpsTile ? (
          <MetricTile
            label={t.tileGps}
            value={fmt.fixed(gps.numSatMedian as number, 0)}
            unit="sats"
            hint={t.gpsTileHint(
              fmt.fixed(gps.numSatMin as number, 0),
              fmt.fixed(gps.numSatMax as number, 0),
              gps.hdopMedian !== null ? fmt.fixed(gps.hdopMedian, 1) : null,
            )}
            tone={gpsTone}
            icon={SatelliteIcon}
          />
        ) : null}
      </div>

      {/* Aperçu rapide par catégorie */}
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          if (chip.absent) {
            return (
              <span
                key={chip.category}
                title={t.axisNotEvaluated(dict.ui.categories[chip.category])}
                className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1.5 text-xs font-semibold text-ink-3 opacity-70"
              >
                <span aria-hidden="true" className="font-mono">
                  ∅
                </span>
                {dict.ui.categories[chip.category]}
              </span>
            );
          }
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

      {/* Sessions écartées du fichier - repliées : elles ne concernent pas le vol
          affiché, mais elles ne doivent pas disparaître avec la vue par onglet. */}
      {skipped.length > 0 ? (
        <details className="group rounded-2xl border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-xs font-semibold text-ink-2 [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden="true"
              className="font-mono text-ink-3 transition-transform group-open:rotate-90"
            >
              ▶
            </span>
            <AlertIcon className="size-3.5 shrink-0 text-warn" />
            {t.skippedInFileSummary(skipped.length)}
          </summary>
          <ul className="space-y-1 px-4 pb-3 pl-9 text-xs text-ink-2">
            {skipped.map((s) => (
              <li key={s.index}>
                {t.skippedSession(String(s.index + 1), s.error, fmt.bytes(s.sizeBytes))}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* Graphes (chaque SVG porte son propre titre) */}
      {analysis.timeline.segments.length > 0 ? (
        <figure className="rounded-2xl border border-line bg-surface p-4">
          <figcaption className="mb-2 flex items-center justify-between gap-2 text-sm font-semibold text-ink">
            {t.timelineCaption}
            <ChartHelp topic="timeline" />
          </figcaption>
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              <TimelineStrip
                segments={analysis.timeline.segments}
                durationS={meta.durationS}
                events={timelineEvents}
                labels={dict.ui.charts.timeline}
              />
            </div>
          </div>
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
          <div className="mb-1 flex justify-end">
            <ChartHelp topic="spectrum" />
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              <SpectrumChart
                axes={analysis.spectrum.axes}
                motorFundamentalHz={analysis.spectrum.motorFundamentalHz}
                sampleRateHz={meta.sampleRateHz}
                labels={dict.ui.charts.spectrum}
              />
            </div>
          </div>
        </div>
      ) : null}
      {analysis.step ? (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <div className="mb-1 flex justify-end">
            <ChartHelp topic="step" />
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              <StepResponseChart axes={analysis.step.axes} labels={dict.ui.charts.step} />
            </div>
          </div>
        </div>
      ) : null}

      {/* Verdicts par catégorie */}
      {groups.length === 0 ? (
        <p className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-4 text-sm text-ink-2">
          <CheckIcon className="size-4 shrink-0 text-ok" /> {t.noFindings}
        </p>
      ) : (
        groups.map((group) => (
          <section
            key={group.category}
            /* Ancre visée par les tranches de la jauge (et par l'URL). */
            id={`findings-${group.category}`}
            aria-label={dict.ui.categories[group.category]}
            className="scroll-mt-6"
          >
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

    </div>
  );
}

// ---------------------------------------------------------------------------
// Vue principale - un onglet par vol, comparaison en tête
// ---------------------------------------------------------------------------

interface Flight {
  key: string;
  fileName: string;
  /** Libellé d'onglet : nom de fichier, suffixé du n° de session si le fichier en a plusieurs. */
  label: string;
  durationS: number;
  report: SessionReport;
}

/** Valeur d'onglet réservée à la comparaison de passes (les vols sont >= 0). */
const COMPARE_TAB = -1;

export default function ReportView({
  report,
  onReset,
  files,
}: {
  report: Report;
  onReset: () => void;
  files: File[];
}) {
  const { locale, dict } = useLocale();
  const t = dict.ui.report;
  const fmt = makeFormatters(locale, dict);
  const [active, setActive] = useState(0);

  // Aplatissement : chaque (fichier, session) devient un vol, donc un onglet.
  // Un fichier multi-sessions se scinde en plusieurs onglets - c'est bien « un
  // onglet par vol », pas par fichier.
  const flights: Flight[] = [];
  report.files.forEach((file) => {
    const multi = file.sessionReports.length > 1;
    file.sessionReports.forEach((sr) => {
      const n = sr.analysis.meta.index + 1;
      flights.push({
        key: `${file.fileName}#${sr.analysis.meta.index}`,
        fileName: file.fileName,
        label: multi ? `${file.fileName} · ${n}` : file.fileName,
        durationS: sr.analysis.meta.durationS,
        report: sr,
      });
    });
  });

  // Sessions écartées : rattachées au(x) vol(s) du même fichier, où elles
  // s'affichent repliées. Un fichier sans aucune session exploitable n'a pas
  // d'onglet : ses raisons restent listées globalement sous la barre d'onglets.
  const skippedByFile = new Map<string, SkippedSession[]>();
  report.files.forEach((f) => {
    if (f.skipped.length > 0 && f.sessionReports.length > 0) {
      skippedByFile.set(f.fileName, f.skipped);
    }
  });
  const orphanSkipped = report.files
    .filter((f) => f.sessionReports.length === 0)
    .flatMap((f) => f.skipped.map((s) => ({ fileName: f.fileName, s })));

  const craftNames = report.files
    .map((f) => f.sessionReports[0]?.analysis.meta.craftName)
    .filter((name): name is string => Boolean(name));

  const shared = report.shared;
  const isShared = shared !== undefined;
  const ts = dict.ui.shareLink;

  // Comparaison de passes : toutes sessions confondues, groupées par quad et
  // ordonnées dans le temps. Sans objet sur un lien partagé (une seule session).
  const comparisons = isShared
    ? []
    : buildComparisons(report.files.flatMap((f) => f.sessionReports));

  const showCompareTab = comparisons.length > 0;
  const compareActive = showCompareTab && active === COMPARE_TAB;
  const activeIdx = !compareActive && active >= 0 && active < flights.length ? active : 0;
  const activeFlight = compareActive ? null : flights[activeIdx];

  // Score par onglet : strictement le même calcul que la carte de score du vol,
  // pour que le chiffre de l'onglet et celui de la jauge ne divergent jamais.
  const tabItems: SessionPickerItem[] = flights.map((f, i) => {
    const { score } = computeFlightScore(f.report);
    return {
      value: i,
      label: f.label,
      sublabel: fmt.duration(f.durationS),
      score,
      tone: worstSeverity(f.report.findings),
    };
  });
  if (showCompareTab) {
    tabItems.push({
      value: COMPARE_TAB,
      label: dict.compare.tabLabel,
      sublabel: dict.compare.tabCount(comparisons.length),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-ink">{t.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* Partage du vol affiché - jamais sur un rapport déjà reçu par lien
              (on ne repartage pas un partage). */}
          {!isShared && activeFlight ? (
            <ShareLink
              sessionReport={activeFlight.report}
              fileName={activeFlight.fileName}
            />
          ) : null}
          <button
            type="button"
            onClick={onReset}
            className="rounded-full border border-line bg-surface px-4 py-1.5 text-sm font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
          >
            {isShared ? ts.bannerCta : t.newAnalysis}
          </button>
        </div>
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

      {/* Onglets : un par vol (score en barre de remplissage) + un onglet
          Comparaison. Masqués quand il n'y a qu'un seul choix possible. */}
      {tabItems.length > 1 ? (
        <SessionPicker
          items={tabItems}
          selected={compareActive ? COMPARE_TAB : activeIdx}
          onSelect={setActive}
          ariaLabel={t.flightsAria}
        />
      ) : null}

      {/* Fichiers sans aucune session exploitable : leurs raisons n'ont pas
          d'onglet où vivre. Repliées ici pour ne pas repousser le rapport. */}
      {orphanSkipped.length > 0 ? (
        <details className="group rounded-2xl border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-xs font-semibold text-ink-2 [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden="true"
              className="font-mono text-ink-3 transition-transform group-open:rotate-90"
            >
              ▶
            </span>
            <AlertIcon className="size-3.5 shrink-0 text-warn" />
            {t.skippedOrphanSummary(orphanSkipped.length)}
          </summary>
          <ul className="space-y-1 px-4 pb-3 pl-9 text-xs text-ink-2">
            {orphanSkipped.map(({ fileName, s }) => (
              <li key={`${fileName}#${s.index}`}>
                <span className="font-mono">{fileName}</span> ·{' '}
                {t.skippedSession(String(s.index + 1), s.error, fmt.bytes(s.sizeBytes))}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {compareActive ? (
        <ComparisonPanel comparisons={comparisons} />
      ) : activeFlight ? (
        <SessionBlock
          key={activeFlight.key}
          sessionReport={activeFlight.report}
          skipped={skippedByFile.get(activeFlight.fileName) ?? []}
        />
      ) : (
        <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-ink-2">
          {t.noUsableSession}
        </p>
      )}

      {activeFlight ? <CliExport findings={activeFlight.report.findings} /> : null}

      <ShareLogToggle files={files} craftNames={craftNames} />
    </div>
  );
}

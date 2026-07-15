'use client';

import { useState } from 'react';
import type {
  FileReport,
  Finding,
  FindingCategory,
  Report,
  SessionReport,
  Severity,
} from '@/lib/types';
import CliExport from '@/components/CliExport';
import FindingCard, { SEVERITY_META } from '@/components/FindingCard';
import MetricTile, { type MetricTone } from '@/components/MetricTile';
import SessionPicker, { type SessionPickerItem } from '@/components/SessionPicker';
import { SpectrumChart } from '@/components/charts/SpectrumChart';
import { StepResponseChart } from '@/components/charts/StepResponseChart';
import { TimelineStrip } from '@/components/charts/TimelineStrip';

// ---------------------------------------------------------------------------
// Formatage (décimales à la française)
// ---------------------------------------------------------------------------

function frFixed(v: number, digits: number): string {
  return v.toFixed(digits).replace('.', ',');
}

function fmtDuration(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '—';
  if (s < 60) return `${frFixed(s, 1)} s`;
  let m = Math.floor(s / 60);
  let r = Math.round(s - m * 60);
  if (r === 60) {
    m += 1;
    r = 0;
  }
  return `${m} min ${String(r).padStart(2, '0')} s`;
}

function fmtClock(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

function fmtHz(hz: number): string {
  return hz >= 1000 ? `${frFixed(hz / 1000, 2)} kHz` : `${Math.round(hz)} Hz`;
}

function fmtBytes(n: number): string {
  if (n >= 1_000_000) return `${frFixed(n / 1_000_000, 1)} Mo`;
  return `${Math.max(1, Math.round(n / 1000))} Ko`;
}

// ---------------------------------------------------------------------------
// Verdicts & catégories
// ---------------------------------------------------------------------------

const VERDICT_TEXT: Record<Severity, string> = {
  ok: 'Nickel — rien à signaler',
  info: 'Propre — quelques observations',
  warn: 'À surveiller — des points à corriger',
  crit: 'Critique — corrige avant de revoler',
};

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

const CATEGORY_LABELS: Record<FindingCategory, string> = {
  securite: 'Sécurité',
  vibrations: 'Vibrations',
  filtres: 'Filtres',
  pid: 'PID',
  moteurs: 'Moteurs',
  batterie: 'Batterie',
  config: 'Config',
  gps: 'GPS',
  log: 'Log',
};

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
// Blocs
// ---------------------------------------------------------------------------

function SessionBlock({ sessionReport }: { sessionReport: SessionReport }) {
  const { analysis, profile, findings } = sessionReport;
  const meta = analysis.meta;
  const power = analysis.power;
  const th = profile.thresholds;

  const worst = worstSeverity(findings);
  const sev = SEVERITY_META[worst];

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

  return (
    <div className="space-y-4">
      {/* Bandeau profil + verdict global */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 p-4">
        <div className="min-w-0">
          <p className="text-base font-semibold text-ink">
            {meta.craftName || profile.label}
            <span className="ml-2 text-sm font-normal text-ink-3">profil {profile.label}</span>
          </p>
          <p className="mt-0.5 font-mono text-xs text-ink-3">
            {meta.firmware}
            {meta.boardInfo ? ` · ${meta.boardInfo}` : ''}
          </p>
          {profile.notes && profile.notes.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-xs text-ink-2">
              {profile.notes.map((note) => (
                <li key={note}>• {note}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <p
          className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold ${sev.badge}`}
        >
          <span aria-hidden="true">{sev.icon}</span>
          {VERDICT_TEXT[worst]}
        </p>
      </div>

      {/* Tuiles chiffrées */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <MetricTile label="Durée de session" value={fmtDuration(meta.durationS)} />
        <MetricTile label="Échantillonnage" value={fmtHz(meta.sampleRateHz)} />
        <MetricTile
          label="Batterie"
          value={power ? `${power.cells}S` : '—'}
          hint={
            power && sagPerCell != null
              ? `sag ${frFixed(power.sagV, 2)} V (${frFixed(sagPerCell, 2)} V/cell)`
              : power
                ? `${frFixed(power.vbatMin, 2)}–${frFixed(power.vbatMax, 2)} V`
                : 'pas de mesure vbat'
          }
          tone={sagTone}
        />
        <MetricTile
          label="Courant max"
          value={power && power.ampMax != null ? frFixed(power.ampMax, 1) : '—'}
          unit={power && power.ampMax != null ? 'A' : undefined}
          hint={
            power && power.ampAvg != null ? `moyenne ${frFixed(power.ampAvg, 1)} A` : undefined
          }
        />
        <MetricTile
          label="Saturation moteurs"
          value={frFixed(satPct, 1)}
          unit="%"
          tone={satTone}
        />
        <MetricTile
          label="Temps de vol"
          value={fmtDuration(analysis.timeline.flightTimeS)}
          hint="throttle réellement en l'air"
        />
      </div>

      {/* Graphes (chaque SVG porte son propre titre) */}
      {analysis.timeline.segments.length > 0 ? (
        <figure className="rounded-lg border border-line bg-surface p-4">
          <figcaption className="mb-2 text-sm font-semibold text-ink">Timeline du vol</figcaption>
          <TimelineStrip segments={analysis.timeline.segments} durationS={meta.durationS} />
        </figure>
      ) : null}
      {analysis.spectrum ? (
        <div className="rounded-lg border border-line bg-surface p-4">
          <SpectrumChart
            axes={analysis.spectrum.axes}
            motorFundamentalHz={analysis.spectrum.motorFundamentalHz}
          />
        </div>
      ) : null}
      {analysis.step ? (
        <div className="rounded-lg border border-line bg-surface p-4">
          <StepResponseChart axes={analysis.step.axes} />
        </div>
      ) : null}

      {/* Verdicts par catégorie */}
      {groups.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-2">
          <span aria-hidden="true">✅</span> Aucune règle déclenchée sur cette session.
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.category} aria-label={CATEGORY_LABELS[group.category]}>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">
              {CATEGORY_LABELS[group.category]}
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

function FileSection({
  file,
  selected,
  onSelect,
}: {
  file: FileReport;
  selected: number;
  onSelect: (i: number) => void;
}) {
  const valid = file.sessionReports.length;
  const skipped = file.skipped.length;

  // Heure relative de début : cumul des durées des sessions valides précédentes.
  let offset = 0;
  const items: SessionPickerItem[] = file.sessionReports.map((sr, i) => {
    const dur = sr.analysis.meta.durationS;
    const item: SessionPickerItem = {
      value: i,
      label: `Session ${sr.analysis.meta.index + 1}`,
      sublabel: `${fmtDuration(dur)} · t+${fmtClock(offset)}`,
    };
    offset += dur;
    return item;
  });

  const current = file.sessionReports[selected] ?? file.sessionReports[0];

  return (
    <section aria-label={`Rapport ${file.fileName}`} className="space-y-4">
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="min-w-0 truncate font-mono text-base font-semibold text-ink">
            {file.fileName}
          </h2>
          <p className="text-xs text-ink-2">
            {valid} {valid > 1 ? 'sessions valides' : 'session valide'}
            {skipped > 0 ? (
              <span className="text-warn">
                {' '}
                · {skipped} {skipped > 1 ? 'ignorées' : 'ignorée'}
              </span>
            ) : null}
          </p>
        </div>
        {skipped > 0 ? (
          <ul className="mt-2 space-y-1 text-xs text-ink-2">
            {file.skipped.map((s) => (
              <li key={s.index}>
                <span aria-hidden="true">⚠️</span> Session {s.index + 1} ignorée — {s.error} (
                {fmtBytes(s.sizeBytes)})
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
        <SessionBlock sessionReport={current} />
      ) : (
        <p className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-2">
          Aucune session exploitable dans ce fichier — voir les raisons ci-dessus.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Vue principale
// ---------------------------------------------------------------------------

export default function ReportView({ report, onReset }: { report: Report; onReset: () => void }) {
  const [selection, setSelection] = useState<Record<number, number>>({});

  const cliFindings: Finding[] = [...report.configFindings];
  report.files.forEach((file, i) => {
    const sr = file.sessionReports[selection[i] ?? 0];
    if (sr) cliFindings.push(...sr.findings);
  });

  const configGroups = groupFindings(report.configFindings);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-ink">Rapport de vol</h1>
        <button
          type="button"
          onClick={onReset}
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink-2 hover:border-ink-3 hover:text-ink"
        >
          Nouvelle analyse
        </button>
      </div>

      {report.configFindings.length > 0 ? (
        <section aria-label="Analyse de la config" className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
            Config{' '}
            {report.config?.source === 'paste' ? '(diff all collé)' : '(headers du log)'}
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
        />
      ))}

      <CliExport findings={cliFindings} />
    </div>
  );
}

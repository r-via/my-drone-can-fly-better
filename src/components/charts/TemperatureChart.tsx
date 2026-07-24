// TemperatureChart - courbes de température de toutes les sondes du log
// (télémétrie ESC, IMU, baro, sondes externes INAV sens0-7, ou temp par ESC
// Betaflight via debug_mode ESC_SENSOR_TMP), superposées sur un seul axe °C
// et filtrables sonde par sonde depuis la légende. SVG pur, état local pour
// le filtre uniquement.
//
// Choix dataviz : couleur fixe par sonde (jamais recalculée quand on filtre),
// étiquette directe en bout de courbe (l'identité ne repose pas que sur la
// couleur), échelle Y calée sur TOUTES les sondes vivantes pour que le cadre
// ne saute pas quand on masque une courbe.
//
// Variables thème (fallbacks = thème sombre) : --chart-text, --chart-text-dim,
// --chart-axis, --chart-grid, --chart-baseline, --chart-motor, --chart-roll
// et les --chart-temp-*.

import * as React from 'react';
import type { JSX } from 'react';
import type { TempProbeCurve, TempProbeId } from '../../lib/types';

const MAX_POINTS = 600;

/**
 * Couleur par sonde, ordre FIXE (palette validée CVD sur les deux surfaces du
 * thème ; l'écart protan 6-8 restant est couvert par les étiquettes directes).
 * esc/imu réutilisent les jetons maison (moteur, roll) ; les slots sens0-7 et
 * esc0-7 partagent les mêmes couleurs : les deux familles ne coexistent
 * jamais dans une même session (INAV vs Betaflight).
 */
const SLOT_COLORS = [
  'var(--chart-temp-sens0, #16a34a)',
  'var(--chart-temp-sens1, #2563eb)',
  'var(--chart-temp-sens2, #db2777)',
  'var(--chart-temp-sens3, #ca8a04)',
  'var(--chart-temp-sens4, #7c3aed)',
  'var(--chart-temp-sens5, #0d9488)',
  'var(--chart-temp-sens6, #ea580c)',
  'var(--chart-temp-sens7, #c026d3)',
] as const;

export function probeColor(id: TempProbeId): string {
  if (id === 'esc') return 'var(--chart-motor, #f87171)';
  if (id === 'imu') return 'var(--chart-roll, #0891b2)';
  if (id === 'baro') return 'var(--chart-temp-baro, #d97706)';
  const slot = Number(id.replace(/^(sens|esc)/, ''));
  return SLOT_COLORS[slot] ?? SLOT_COLORS[0];
}

const INK = 'var(--chart-text, #ffffff)';
const INK_DIM = 'var(--chart-text-dim, #c3c2b7)';
const INK_AXIS = 'var(--chart-axis, #898781)';
const GRID = 'var(--chart-grid, #2c2c2a)';
const BASELINE = 'var(--chart-baseline, #383835)';
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Pas « rond » donnant entre lo et hi ticks sur l'étendue donnée. */
function niceStep(span: number, target: number, steps: number[]): number {
  for (const s of steps) if (span / s <= target) return s;
  return steps[steps.length - 1];
}

export function buildTemperaturePaths(
  probes: TempProbeCurve[],
  w: number,
  h: number,
): {
  paths: string[];
  /** Position (x, y) du dernier point de chaque courbe, pour l'étiquette directe. */
  ends: Array<{ x: number; y: number }>;
  ticksX: Array<{ x: number; label: string }>;
  ticksY: Array<{ y: number; label: string }>;
  yMin: number;
  yMax: number;
} {
  // Domaines depuis TOUTES les sondes : le cadre ne dépend pas du filtre.
  let tMax = 0;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of probes) {
    if (p.t.length > 0) tMax = Math.max(tMax, p.t[p.t.length - 1]);
    yMin = Math.min(yMin, p.minC);
    yMax = Math.max(yMax, p.maxC);
  }
  if (!(tMax > 0) || !Number.isFinite(yMin)) {
    return { paths: [], ends: [], ticksX: [], ticksY: [], yMin: 0, yMax: 1 };
  }
  // Marge verticale : 1 °C ou 5 % de l'étendue, et jamais un domaine plat.
  const pad = Math.max(1, (yMax - yMin) * 0.05);
  yMin -= pad;
  yMax += pad;

  const xOf = (t: number): number => (t / tMax) * w;
  const yOf = (c: number): number => h - ((c - yMin) / (yMax - yMin)) * h;

  const paths: string[] = [];
  const ends: Array<{ x: number; y: number }> = [];
  for (const p of probes) {
    const n = Math.min(p.t.length, p.c.length);
    const stride = Math.max(1, Math.ceil(n / MAX_POINTS));
    let d = '';
    let emitted = 0;
    const emit = (i: number): void => {
      d += (emitted === 0 ? 'M' : 'L') + fmt(xOf(p.t[i])) + ',' + fmt(yOf(p.c[i]));
      emitted++;
    };
    for (let i = 0; i < n; i += stride) emit(i);
    if (n > 0 && (n - 1) % stride !== 0) emit(n - 1);
    paths.push(d);
    ends.push(n > 0 ? { x: xOf(p.t[n - 1]), y: yOf(p.c[n - 1]) } : { x: 0, y: 0 });
  }

  const xStep = niceStep(tMax, 8, [5, 10, 15, 30, 60, 120, 300, 600]);
  const ticksX: Array<{ x: number; label: string }> = [];
  for (let t = 0; t <= tMax + 1e-6; t += xStep) {
    ticksX.push({ x: xOf(t), label: String(Math.round(t)) });
  }
  const yStep = niceStep(yMax - yMin, 6, [1, 2, 5, 10, 20, 50]);
  const ticksY: Array<{ y: number; label: string }> = [];
  for (let c = Math.ceil(yMin / yStep) * yStep; c <= yMax + 1e-6; c += yStep) {
    ticksY.push({ y: yOf(c), label: String(Math.round(c)) });
  }
  return { paths, ends, ticksX, ticksY, yMin, yMax };
}

export interface TemperatureChartLabels {
  title: string;
  ariaLabel: string;
  xAxis: string;
  filterHint: string;
  probeEsc: string;
  probeImu: string;
  probeBaro: string;
  probeSens: (n: string) => string;
  probeEscN: (n: string) => string;
}

const DEFAULT_LABELS: TemperatureChartLabels = {
  title: 'Températures (°C)',
  ariaLabel: 'Courbes de température des sondes du log, superposées, en °C',
  xAxis: 'Temps (s)',
  filterHint: 'Clique une sonde dans la légende pour masquer/afficher sa courbe',
  probeEsc: 'ESC (télémétrie)',
  probeImu: 'IMU',
  probeBaro: 'Baro',
  probeSens: (n) => `Sonde ${n}`,
  probeEscN: (n) => `ESC ${n}`,
};

export function probeLabel(id: TempProbeId, L: TemperatureChartLabels): string {
  if (id === 'esc') return L.probeEsc;
  if (id === 'imu') return L.probeImu;
  if (id === 'baro') return L.probeBaro;
  if (id.startsWith('sens')) return L.probeSens(id.slice(4));
  return L.probeEscN(String(Number(id.slice(3)) + 1));
}

export function TemperatureChart(props: {
  probes: TempProbeCurve[];
  labels?: TemperatureChartLabels;
}): JSX.Element {
  const L = props.labels ?? DEFAULT_LABELS;
  const [hidden, setHidden] = React.useState<ReadonlySet<TempProbeId>>(new Set());
  const toggle = (id: TempProbeId): void => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < props.probes.length - 1) next.add(id); // toujours >= 1 courbe visible
      return next;
    });
  };

  const W = 640;
  const H = 320;
  // Légende à droite : une ligne par sonde, cliquable.
  const legendW = 150;
  const pad = { top: 30, right: 14 + legendW, bottom: 34, left: 38 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const { paths, ends, ticksX, ticksY } = buildTemperaturePaths(props.probes, plotW, plotH);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      role="img"
      aria-label={L.ariaLabel}
      fontFamily={FONT}
    >
      <text x={pad.left} y={18} fontSize={13} fontWeight={600} fill={INK}>
        {L.title}
      </text>
      <text x={W - 14} y={18} fontSize={9} fill={INK_AXIS} textAnchor="end">
        {L.filterHint}
      </text>

      {/* Grille + ticks Y (°C) */}
      {ticksY.map((t) => (
        <g key={`y${t.label}`}>
          <line
            x1={pad.left}
            y1={pad.top + t.y}
            x2={pad.left + plotW}
            y2={pad.top + t.y}
            stroke={GRID}
            strokeWidth={1}
          />
          <text x={pad.left - 6} y={pad.top + t.y + 3} fontSize={10} fill={INK_AXIS} textAnchor="end">
            {t.label}
          </text>
        </g>
      ))}

      {/* Ticks X (s) */}
      {ticksX.map((t) => (
        <g key={`x${t.label}`}>
          {t.x > 0 && (
            <line
              x1={pad.left + t.x}
              y1={pad.top}
              x2={pad.left + t.x}
              y2={pad.top + plotH}
              stroke={GRID}
              strokeWidth={1}
            />
          )}
          <text
            x={pad.left + t.x}
            y={pad.top + plotH + 14}
            fontSize={10}
            fill={INK_AXIS}
            textAnchor="middle"
          >
            {t.label}
          </text>
        </g>
      ))}
      <line
        x1={pad.left}
        y1={pad.top + plotH}
        x2={pad.left + plotW}
        y2={pad.top + plotH}
        stroke={BASELINE}
        strokeWidth={1}
      />
      <text x={pad.left + plotW / 2} y={H - 4} fontSize={9} fill={INK_AXIS} textAnchor="middle">
        {L.xAxis}
      </text>

      {/* Courbes + étiquette directe en bout de trace */}
      <g transform={`translate(${pad.left},${pad.top})`}>
        {props.probes.map((p, i) =>
          hidden.has(p.id) || !paths[i] ? null : (
            <g key={p.id}>
              <path
                d={paths[i]}
                fill="none"
                stroke={probeColor(p.id)}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <text
                x={ends[i].x + 4}
                y={Math.max(8, Math.min(plotH - 2, ends[i].y + 3))}
                fontSize={9}
                fill={INK_DIM}
              >
                {probeLabel(p.id, L)}
              </text>
            </g>
          ),
        )}
      </g>

      {/* Légende cliquable : filtre par sonde. La couleur reste celle de la
          sonde même masquée (estompée), l'identité ne bouge jamais. */}
      {props.probes.map((p, i) => {
        const x = W - legendW - 6;
        const y = pad.top + 4 + i * 18;
        const off = hidden.has(p.id);
        return (
          <g
            key={p.id}
            onClick={() => toggle(p.id)}
            role="button"
            aria-pressed={!off}
            style={{ cursor: 'pointer' }}
          >
            <rect x={x} y={y - 8} width={legendW} height={16} fill="transparent" />
            <rect
              x={x}
              y={y - 2}
              width={14}
              height={3}
              rx={1.5}
              fill={probeColor(p.id)}
              opacity={off ? 0.25 : 1}
            />
            <text
              x={x + 18}
              y={y + 2}
              fontSize={10}
              fill={off ? INK_AXIS : INK_DIM}
              style={{ textDecoration: off ? 'line-through' : undefined }}
            >
              {probeLabel(p.id, L)} {fmt(Math.round(p.lastC))}°
            </text>
          </g>
        );
      })}
    </svg>
  );
}

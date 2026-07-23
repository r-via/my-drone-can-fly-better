// StepResponseChart - réponses indicielles 3 axes (déconvolution Wiener),
// ligne cible 1.0 pointillée + zone d'overshoot teintée. SVG pur, sans dépendance.
//
// X : 0 → 500 ms. Y : 0 → max(1.5, pic observé) ; les valeurs négatives
// (undershoot) sont écrêtées à 0, conformément à l'échelle demandée.
//
// Variables thème (fallbacks = thème sombre) : --chart-text, --chart-text-dim,
// --chart-axis, --chart-grid, --chart-baseline, --chart-roll, --chart-pitch,
// --chart-yaw, --chart-target, --chart-band-overshoot.

import * as React from 'react';
import type { JSX } from 'react';
import { MIN_STEP_QUALITY } from '../../lib/analysis/step';
import type { AxisStepResponse } from '../../lib/types';
import { AXIS_NAMES } from '../../lib/types';

const X_MAX_S = 0.5; // 500 ms
const MAX_POINTS = 600;
const X_TICKS_MS = [0, 100, 200, 300, 400, 500];
const Y_TICK_STEP = 0.5;

const SERIES_COLORS = [
  'var(--chart-roll, #3987e5)',
  'var(--chart-pitch, #199e70)',
  'var(--chart-yaw, #c98500)',
] as const;

const INK = 'var(--chart-text, #ffffff)';
const INK_DIM = 'var(--chart-text-dim, #c3c2b7)';
const INK_AXIS = 'var(--chart-axis, #898781)';
const GRID = 'var(--chart-grid, #2c2c2a)';
const BASELINE = 'var(--chart-baseline, #383835)';
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function buildAxisPath(
  ax: AxisStepResponse,
  w: number,
  h: number,
  yMax: number,
): string | null {
  const n = Math.min(ax.t.length, ax.y.length);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (ax.t[i] <= X_MAX_S) idx.push(i);
  if (idx.length === 0) return null;

  const stride = Math.max(1, Math.ceil(idx.length / MAX_POINTS));
  let d = '';
  let emitted = 0;
  const emit = (i: number): void => {
    const x = (ax.t[i] / X_MAX_S) * w;
    const v = Math.min(Math.max(ax.y[i], 0), yMax);
    const y = h - (v / yMax) * h;
    d += (emitted === 0 ? 'M' : 'L') + fmt(x) + ',' + fmt(y);
    emitted++;
  };
  for (let k = 0; k < idx.length; k += stride) emit(idx[k]);
  if ((idx.length - 1) % stride !== 0) emit(idx[idx.length - 1]); // garde le dernier point
  return d;
}

export function buildStepPaths(
  axes: Array<AxisStepResponse | null>,
  w: number,
  h: number,
): {
  paths: Array<string | null>;
  targetY: number;
  ticksX: Array<{ x: number; label: string }>;
  ticksY: Array<{ y: number; label: string }>;
} {
  // Y : 0 → max(1.5, pic observé sur les axes FIABLES). Un axe sous
  // MIN_STEP_QUALITY est un artefact de déconvolution : son pic ne doit pas
  // dicter l'échelle des axes jugés - sa courbe (estompée) est écrêtée à yMax.
  let peak = 0;
  for (const ax of axes) {
    if (!ax || ax.quality < MIN_STEP_QUALITY) continue;
    const n = Math.min(ax.t.length, ax.y.length);
    for (let i = 0; i < n; i++) {
      if (ax.t[i] <= X_MAX_S && ax.y[i] > peak) peak = ax.y[i];
    }
  }
  const yMax = Math.max(1.5, peak);

  const paths = axes.map((ax) => (ax ? buildAxisPath(ax, w, h, yMax) : null));
  const targetY = h - (1 / yMax) * h;
  const ticksX = X_TICKS_MS.map((ms) => ({
    x: (ms / (X_MAX_S * 1000)) * w,
    label: String(ms),
  }));
  const ticksY: Array<{ y: number; label: string }> = [];
  for (let i = 0; i * Y_TICK_STEP <= yMax + 1e-6; i++) {
    const v = i * Y_TICK_STEP;
    ticksY.push({ y: h - (v / yMax) * h, label: fmt(v) });
  }
  return { paths, targetY, ticksX, ticksY };
}

export interface StepChartLabels {
  title: string;
  ariaLabel: string;
  overshootZone: string;
  targetLine: string;
  xAxis: string;
  axisMissing: (axis: string) => string;
  axisUnreliable: (axis: string) => string;
  unreliableNote: string;
  noData: string;
  noDataWhy: string;
  noDataHint: string;
}

const DEFAULT_LABELS: StepChartLabels = {
  title: 'Réponse indicielle (0–500 ms)',
  ariaLabel: 'Réponse indicielle Roll, Pitch, Yaw - cible 1.0, fenêtre 0 à 500 ms',
  overshootZone: "zone d'overshoot",
  targetLine: 'cible 1.0',
  xAxis: 'Temps (ms)',
  axisMissing: (axis) => `${axis} (n/a)`,
  axisUnreliable: (axis) => `${axis}*`,
  unreliableNote: '* courbe estompée : excitation stick insuffisante, axe non jugé',
  noData: "Pas assez d'excitation stick pour estimer la réponse.",
  noDataWhy: 'En stationnaire la consigne reste plate : la boucle PID ne reçoit aucun ordre à mesurer.',
  noDataHint: 'Refais une passe avec des coups de stick francs (roll puis pitch, une dizaine par axe) : la courbe se remplira.',
};

export function StepResponseChart(props: {
  axes: [AxisStepResponse | null, AxisStepResponse | null, AxisStepResponse | null];
  labels?: StepChartLabels;
}): JSX.Element {
  const L = props.labels ?? DEFAULT_LABELS;
  const W = 640;
  const H = 300;
  const pad = { top: 40, right: 14, bottom: 34, left: 38 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const { paths, targetY, ticksX, ticksY } = buildStepPaths(props.axes, plotW, plotH);
  const hasAny = paths.some((p) => p !== null);
  // Même seuil que le moteur de règles (rules/engine.ts) : un axe sous
  // MIN_STEP_QUALITY n'est pas jugé - le tracer plein trait à côté des exemples
  // « Bien / Pas bien » ferait prendre un artefact de déconvolution pour un
  // verdict. Estompé + pointillé + mention en légende.
  const unreliable = props.axes.map(
    (ax, i) => paths[i] !== null && ax !== null && ax.quality < MIN_STEP_QUALITY,
  );
  const hasUnreliable = unreliable.some(Boolean);

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

      {/* Légende - les axes sans données restent listés, en retrait */}
      {AXIS_NAMES.map((name, i) => {
        const x = W - pad.right - (3 - i) * 78;
        const present = paths[i] !== null;
        return (
          <g key={name}>
            <rect
              x={x}
              y={13}
              width={14}
              height={3}
              rx={1.5}
              fill={present ? SERIES_COLORS[i] : GRID}
              opacity={unreliable[i] ? 0.35 : 1}
            />
            <text
              x={x + 18}
              y={18}
              fontSize={10}
              fill={present && !unreliable[i] ? INK_DIM : INK_AXIS}
            >
              {present ? (unreliable[i] ? L.axisUnreliable(name) : name) : L.axisMissing(name)}
            </text>
          </g>
        );
      })}

      {hasUnreliable && (
        <text x={pad.left} y={32} fontSize={9} fill={INK_AXIS}>
          {L.unreliableNote}
        </text>
      )}

      {/* Zone d'overshoot (au-dessus de la cible 1.0) */}
      <rect
        x={pad.left}
        y={pad.top}
        width={plotW}
        height={Math.max(0, targetY)}
        fill="var(--chart-band-overshoot, rgba(230, 103, 103, 0.06))"
      />
      <text
        x={pad.left + plotW - 4}
        y={pad.top + 11}
        fontSize={9}
        fill={INK_AXIS}
        textAnchor="end"
      >
        {L.overshootZone}
      </text>

      {/* Grille horizontale + ticks Y */}
      {ticksY.map((t) => (
        <g key={t.label}>
          {t.y < plotH - 0.5 && (
            <line
              x1={pad.left}
              y1={pad.top + t.y}
              x2={pad.left + plotW}
              y2={pad.top + t.y}
              stroke={GRID}
              strokeWidth={1}
            />
          )}
          <text
            x={pad.left - 6}
            y={pad.top + t.y + 3}
            fontSize={10}
            fill={INK_AXIS}
            textAnchor="end"
          >
            {t.label}
          </text>
        </g>
      ))}

      {/* Ticks X */}
      {ticksX.map((t) => (
        <g key={t.label}>
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

      {/* Ligne cible 1.0 pointillée */}
      <line
        x1={pad.left}
        y1={pad.top + targetY}
        x2={pad.left + plotW}
        y2={pad.top + targetY}
        stroke="var(--chart-target, #898781)"
        strokeWidth={1}
        strokeDasharray="5 4"
      />
      <text
        x={pad.left + plotW - 4}
        y={pad.top + targetY - 4}
        fontSize={9}
        fill={INK_DIM}
        textAnchor="end"
      >
        {L.targetLine}
      </text>

      {/* Traces */}
      <g transform={`translate(${pad.left},${pad.top})`}>
        {paths.map((d, i) =>
          d !== null ? (
            <path
              key={AXIS_NAMES[i]}
              d={d}
              fill="none"
              stroke={SERIES_COLORS[i]}
              strokeWidth={2}
              strokeOpacity={unreliable[i] ? 0.35 : 1}
              strokeDasharray={unreliable[i] ? '4 4' : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null,
        )}
      </g>

      {!hasAny && (
        <g>
          {/* État vide : constat, cause, action. Un graphe muet sans explication
              se lit comme un bug ; trois lignes transforment le vide en mode d'emploi. */}
          <text
            x={pad.left + plotW / 2}
            y={pad.top + plotH / 2 - 18}
            fontSize={11.5}
            fontWeight={600}
            fill={INK_DIM}
            textAnchor="middle"
          >
            {L.noData}
          </text>
          <text
            x={pad.left + plotW / 2}
            y={pad.top + plotH / 2 + 2}
            fontSize={10}
            fill={INK_AXIS}
            textAnchor="middle"
          >
            {L.noDataWhy}
          </text>
          <text
            x={pad.left + plotW / 2}
            y={pad.top + plotH / 2 + 20}
            fontSize={10}
            fill={INK_AXIS}
            textAnchor="middle"
          >
            {L.noDataHint}
          </text>
        </g>
      )}
    </svg>
  );
}

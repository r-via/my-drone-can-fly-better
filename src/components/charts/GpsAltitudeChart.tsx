// GpsAltitudeChart - profil d'altitude GPS du vol, SVG pur, affiché à côté de
// la trace au sol. Altitude RELATIVE au point de départ (l'ASL est soustrait
// dans l'analyse) : la forme compte, pas le niveau de la mer.

import * as React from 'react';
import type { JSX } from 'react';
import type { GpsTrackPoint } from '../../lib/types';

const LINE = 'var(--chart-gps-2, #60a5fa)';
const INK = 'var(--chart-text, #ffffff)';
const INK_DIM = 'var(--chart-text-dim, #c3c2b7)';
const GRID = 'var(--chart-grid, #2c2c2a)';
const BASELINE = 'var(--chart-baseline, #383835)';
const SURFACE = 'var(--chart-surface, #1a1a19)';
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export interface GpsAltitudeChartLabels {
  title: string;
  ariaLabel: string;
  xAxis: string;
  /** Ligne 0 = altitude du départ. */
  zeroLine: string;
  maxLine: (m: string) => string;
}

const DEFAULT_LABELS: GpsAltitudeChartLabels = {
  title: 'Altitude GPS (m, relative au départ)',
  ariaLabel: "Profil d'altitude GPS du vol, relatif au point de départ",
  xAxis: 'Temps (s)',
  zeroLine: 'départ',
  maxLine: (m) => `max +${m} m`,
};

export function GpsAltitudeChart(props: {
  points: GpsTrackPoint[];
  altMinM: number;
  altMaxM: number;
  labels?: GpsAltitudeChartLabels;
}): JSX.Element {
  const L = props.labels ?? DEFAULT_LABELS;
  const { points, altMinM, altMaxM } = props;
  const W = 340;
  const H = 380;
  const pad = { top: 52, right: 12, bottom: 30, left: 34 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const t0 = points[0].t;
  const tEnd = points[points.length - 1].t;
  const tSpan = Math.max(tEnd - t0, 1);
  // Marge verticale : 8 % du span, la courbe ne colle jamais aux bords.
  const span = Math.max(altMaxM - altMinM, 1);
  const yMax = altMaxM + span * 0.08;
  const yMin = altMinM - span * 0.08;
  const xOf = (t: number) => ((t - t0) / tSpan) * plotW;
  const yOf = (a: number) => plotH - ((a - yMin) / (yMax - yMin)) * plotH;

  let line = '';
  points.forEach((p, i) => {
    line += (i === 0 ? 'M' : 'L') + fmt(xOf(p.t)) + ',' + fmt(yOf(p.altM));
  });
  // Aire fermée sur la ligne du départ (0) : lit « au-dessus / en dessous ».
  const area = `${line}L${fmt(plotW)},${fmt(yOf(0))}L0,${fmt(yOf(0))}Z`;

  const yTicks = [altMaxM, 0, altMinM]
    .filter((v, i, all) => all.findIndex((o) => Math.abs(o - v) < span * 0.08) === i)
    .map((v) => ({ v, y: yOf(v), label: `${v > 0 ? '+' : ''}${Math.round(v)}` }));
  const xTicks = [0, 0.5, 1].map((f) => ({
    x: f * plotW,
    label: String(Math.round(t0 + f * tSpan)),
  }));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      role="img"
      aria-label={L.ariaLabel}
      fontFamily={FONT}
    >
      <text x={pad.left} y={20} fontSize={13} fontWeight={600} fill={INK}>
        {L.title}
      </text>
      <text x={pad.left} y={36} fontSize={10} fill={INK_DIM}>
        {L.maxLine(String(Math.round(altMaxM)))}
      </text>

      <g transform={`translate(${pad.left},${pad.top})`}>
        {/* Grille + libellés Y (mètres relatifs) */}
        {yTicks.map((tk) => (
          <g key={tk.label}>
            <line x1={0} y1={tk.y} x2={plotW} y2={tk.y} stroke={GRID} strokeWidth={1} />
            <text x={-6} y={tk.y + 3} fontSize={10} fill={INK_DIM} textAnchor="end">
              {tk.label}
            </text>
          </g>
        ))}

        <path d={area} fill={LINE} opacity={0.13} />
        <path d={line} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {/* Ligne du départ (0 m), en pointillé au-dessus de l'aire */}
        <line x1={0} y1={yOf(0)} x2={plotW} y2={yOf(0)} stroke={BASELINE} strokeWidth={1} strokeDasharray="5 4" />
        <text
          x={plotW - 4}
          y={yOf(0) - 4}
          fontSize={10}
          fill={INK_DIM}
          textAnchor="end"
          stroke={SURFACE}
          strokeWidth={3}
          paintOrder="stroke"
        >
          {L.zeroLine}
        </text>

        {/* Axe X : temps */}
        <line x1={0} y1={plotH} x2={plotW} y2={plotH} stroke={BASELINE} strokeWidth={1} />
        {xTicks.map((tk) => (
          <text key={tk.label} x={tk.x} y={plotH + 14} fontSize={10} fill={INK_DIM} textAnchor="middle">
            {tk.label}
          </text>
        ))}
      </g>
      <text x={pad.left + plotW / 2} y={H - 4} fontSize={10} fill={INK_DIM} textAnchor="middle">
        {L.xAxis}
      </text>
    </svg>
  );
}

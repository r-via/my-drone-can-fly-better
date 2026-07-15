// SpectrumChart — spectre gyro 3 axes superposés, SVG pur (aucune dépendance).
//
// Échelle Y : RACINE CARRÉE de l'amplitude. Compromis lisibilité assumé :
// le linéaire écrase les pics secondaires (résonance châssis à côté du pic
// moteur), le log amplifie le plancher de bruit au point de noyer les pics.
// La racine carrée garde les pics dominants lisibles ET les harmoniques visibles.
//
// Thème : sombre par défaut via les fallbacks ; l'agent UI peut surcharger
// toutes les variables --chart-* dans globals.css :
//   --chart-text, --chart-text-dim, --chart-axis, --chart-grid, --chart-baseline,
//   --chart-roll, --chart-pitch, --chart-yaw,
//   --chart-band-resonance, --chart-band-motors, --chart-motor
// Palette Roll/Pitch/Yaw validée daltonisme (ΔE adjacent >= 41, protan/deutan/tritan).

import * as React from 'react';
import type { JSX } from 'react';
import type { AxisSpectrum } from '../../lib/types';
import { AXIS_NAMES } from '../../lib/types';

const FREQ_MAX_HZ = 1000;
const MAX_POINTS = 600; // downsample au-delà (max par bucket : préserve les pics)
const X_TICKS_HZ = [0, 100, 250, 500, 750, 1000];
const BANDS_DEF = [
  { lo: 40, hi: 120, label: 'résonance' },
  { lo: 120, hi: 350, label: 'moteurs' },
] as const;

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

/** Trace un axe : filtre 0..1 kHz, downsample (max/bucket), échelle Y = sqrt. */
function buildAxisPath(
  freqs: Float32Array,
  mags: Float32Array,
  w: number,
  h: number,
  maxSqrt: number,
): string {
  const n = Math.min(freqs.length, mags.length);
  let count = 0;
  for (let i = 0; i < n; i++) if (freqs[i] <= FREQ_MAX_HZ) count++;
  if (count === 0) return `M0,${fmt(h)}`;

  const bucket = Math.max(1, Math.ceil(count / MAX_POINTS));
  let d = '';
  let seen = 0;
  let bestMag = -Infinity;
  let bestF = 0;
  let emitted = 0;
  for (let i = 0; i < n; i++) {
    const f = freqs[i];
    if (f > FREQ_MAX_HZ) continue;
    if (mags[i] > bestMag) {
      bestMag = mags[i];
      bestF = f;
    }
    seen++;
    if (seen % bucket === 0 || seen === count) {
      const x = (bestF / FREQ_MAX_HZ) * w;
      const mag = bestMag > 0 ? bestMag : 0;
      const y = h - (Math.sqrt(mag) / maxSqrt) * h;
      d += (emitted === 0 ? 'M' : 'L') + fmt(x) + ',' + fmt(y);
      emitted++;
      bestMag = -Infinity;
    }
  }
  return d;
}

export function buildSpectrumPaths(
  axes: [AxisSpectrum, AxisSpectrum, AxisSpectrum],
  w: number,
  h: number,
): {
  paths: [string, string, string];
  ticksX: Array<{ x: number; label: string }>;
  bands: Array<{ x1: number; x2: number; label: string }>;
} {
  // Échelle commune aux 3 axes (sinon les amplitudes ne sont pas comparables).
  let maxMag = 0;
  for (const ax of axes) {
    const n = Math.min(ax.freqs.length, ax.mags.length);
    for (let i = 0; i < n; i++) {
      if (ax.freqs[i] <= FREQ_MAX_HZ && ax.mags[i] > maxMag) maxMag = ax.mags[i];
    }
  }
  const maxSqrt = maxMag > 0 ? Math.sqrt(maxMag) : 1;

  const paths = axes.map((ax) => buildAxisPath(ax.freqs, ax.mags, w, h, maxSqrt)) as [
    string,
    string,
    string,
  ];
  const ticksX = X_TICKS_HZ.map((f) => ({
    x: (f / FREQ_MAX_HZ) * w,
    label: String(f),
  }));
  const bands = BANDS_DEF.map((b) => ({
    x1: (b.lo / FREQ_MAX_HZ) * w,
    x2: (b.hi / FREQ_MAX_HZ) * w,
    label: b.label,
  }));
  return { paths, ticksX, bands };
}

export function SpectrumChart(props: {
  axes: [AxisSpectrum, AxisSpectrum, AxisSpectrum];
  motorFundamentalHz?: number | null;
  title?: string;
}): JSX.Element {
  const W = 640;
  const H = 300;
  const pad = { top: 46, right: 12, bottom: 34, left: 14 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const { paths, ticksX, bands } = buildSpectrumPaths(props.axes, plotW, plotH);
  const title = props.title ?? 'Spectre gyro (0–1 kHz)';
  const fMotor = props.motorFundamentalHz;
  const motorX =
    fMotor != null && fMotor > 0 && fMotor <= FREQ_MAX_HZ
      ? pad.left + (fMotor / FREQ_MAX_HZ) * plotW
      : null;
  const bandFills = [
    'var(--chart-band-resonance, rgba(230, 103, 103, 0.08))',
    'var(--chart-band-motors, rgba(57, 135, 229, 0.08))',
  ];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      role="img"
      aria-label={`${title} — axes Roll, Pitch et Yaw superposés`}
      fontFamily={FONT}
    >
      <text x={pad.left} y={18} fontSize={13} fontWeight={600} fill={INK}>
        {title}
      </text>
      <text x={pad.left} y={32} fontSize={9} fill={INK_AXIS}>
        amplitude gyro — échelle √ (les pics dominants restent comparables)
      </text>

      {/* Légende (identité jamais portée par la couleur seule) */}
      {AXIS_NAMES.map((name, i) => {
        const x = W - pad.right - (3 - i) * 62;
        return (
          <g key={name}>
            <rect x={x} y={13} width={14} height={3} rx={1.5} fill={SERIES_COLORS[i]} />
            <text x={x + 18} y={18} fontSize={10} fill={INK_DIM}>
              {name}
            </text>
          </g>
        );
      })}

      {/* Bandes de fréquence teintées + libellé discret au-dessus du tracé */}
      {bands.map((b, i) => (
        <g key={b.label}>
          <rect
            x={pad.left + b.x1}
            y={pad.top}
            width={b.x2 - b.x1}
            height={plotH}
            fill={bandFills[i]}
          />
          <text
            x={pad.left + (b.x1 + b.x2) / 2}
            y={pad.top - 5}
            fontSize={8.5}
            fill={INK_AXIS}
            textAnchor="middle"
          >
            {b.label}
          </text>
        </g>
      ))}

      {/* Grille verticale (hairline, en retrait) + axe X */}
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
        Fréquence (Hz)
      </text>

      {/* Fondamentale moteur (médiane eRPM) — ligne en retrait derrière les traces */}
      {motorX != null && (
        <line
          x1={motorX}
          y1={pad.top}
          x2={motorX}
          y2={pad.top + plotH}
          stroke="var(--chart-motor, #e66767)"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      )}

      {/* Traces Roll / Pitch / Yaw */}
      <g transform={`translate(${pad.left},${pad.top})`}>
        {paths.map((d, i) => (
          <path
            key={AXIS_NAMES[i]}
            d={d}
            fill="none"
            stroke={SERIES_COLORS[i]}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      </g>

      {/* Libellé de la fondamentale, au-dessus des traces avec halo surface */}
      {motorX != null && (
        <text
          x={motorX + (motorX > pad.left + plotW * 0.72 ? -4 : 4)}
          y={pad.top + 11}
          fontSize={9}
          fill={INK_DIM}
          textAnchor={motorX > pad.left + plotW * 0.72 ? 'end' : 'start'}
          stroke="var(--chart-surface, #1a1a19)"
          strokeWidth={3}
          paintOrder="stroke"
        >
          {`moteurs ~${Math.round(fMotor as number)} Hz`}
        </text>
      )}
    </svg>
  );
}

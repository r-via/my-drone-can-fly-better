// TimelineStrip — bandeau des segments au sol / gaz bas / en vol,
// avec la tension batterie (vbat) en surimpression. SVG pur, sans dépendance.
//
// buildTimelineRects normalise sur l'étendue temporelle des segments ; le
// composant suppose (comme TimelineMetrics le garantit) que les segments
// partitionnent [0, durationS].
//
// Variables thème (fallbacks = thème sombre) : --chart-text, --chart-text-dim,
// --chart-axis, --chart-baseline, --chart-surface, --chart-state-idle,
// --chart-state-low, --chart-state-flight, --chart-vbat.

import * as React from 'react';
import type { JSX } from 'react';
import type { TimelineSegment } from '../../lib/types';

const INK_DIM = 'var(--chart-text-dim, #c3c2b7)';
const INK_AXIS = 'var(--chart-axis, #898781)';
const BASELINE = 'var(--chart-baseline, #383835)';
const SURFACE = 'var(--chart-surface, #1a1a19)';
const VBAT_COLOR = 'var(--chart-vbat, #c98500)';
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

const STATE_COLORS: Record<string, string> = {
  idle: 'var(--chart-state-idle, #45443f)',
  low: 'var(--chart-state-low, #1c5cab)',
  flight: 'var(--chart-state-flight, #199e70)',
};
const STATE_LABELS: Record<string, string> = {
  idle: 'au sol',
  low: 'gaz bas',
  flight: 'en vol',
};
const STATE_ORDER = ['idle', 'low', 'flight'] as const;

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function fmtTime(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s - m * 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Pas de graduation "propre" pour ~4-6 ticks sur la durée. */
function niceTimeStep(durationS: number): number {
  const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  for (const c of candidates) if (durationS / c <= 6) return c;
  return Math.ceil(durationS / 6 / 600) * 600;
}

export function buildTimelineRects(
  segments: TimelineSegment[],
  w: number,
): Array<{ x: number; width: number; state: string }> {
  if (segments.length === 0 || w <= 0) return [];
  const t0 = segments[0].tStart;
  let tMax = t0;
  for (const s of segments) if (s.tEnd > tMax) tMax = s.tEnd;
  const total = tMax - t0;
  if (total <= 0) return [];
  return segments.map((s) => ({
    x: ((s.tStart - t0) / total) * w,
    width: ((s.tEnd - s.tStart) / total) * w,
    state: s.state,
  }));
}

export function TimelineStrip(props: {
  segments: TimelineSegment[];
  durationS: number;
}): JSX.Element {
  const W = 640;
  const H = 96;
  const pad = { left: 12, right: 12 };
  const plotW = W - pad.left - pad.right;
  const stripTop = 22;
  const stripH = 48;
  const stripBottom = stripTop + stripH;
  const { segments, durationS } = props;

  const rects = buildTimelineRects(segments, plotW);
  const presentStates = STATE_ORDER.filter((st) => segments.some((s) => s.state === st));

  // Tension batterie : un point au milieu de chaque segment qui en a une.
  const vbatPts: Array<{ x: number; v: number }> = [];
  if (durationS > 0) {
    for (const s of segments) {
      if (s.vbat != null) {
        const mid = (s.tStart + s.tEnd) / 2;
        vbatPts.push({ x: pad.left + (mid / durationS) * plotW, v: s.vbat });
      }
    }
  }
  let vbatPath: string | null = null;
  if (vbatPts.length >= 2) {
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const p of vbatPts) {
      if (p.v < vMin) vMin = p.v;
      if (p.v > vMax) vMax = p.v;
    }
    const span = vMax - vMin || 1;
    const inner = 8; // marge haut/bas dans le bandeau
    vbatPath = vbatPts
      .map((p, i) => {
        const y = stripBottom - inner - ((p.v - vMin) / span) * (stripH - 2 * inner);
        return (i === 0 ? 'M' : 'L') + fmt(p.x) + ',' + fmt(y);
      })
      .join('');
  }

  // Graduations temporelles.
  const ticks: Array<{ x: number; label: string }> = [];
  if (durationS > 0) {
    const step = niceTimeStep(durationS);
    for (let t = 0; t <= durationS + 1e-6; t += step) {
      if (durationS - t < step * 0.55 && t > 0) break; // évite la collision avec le tick final
      ticks.push({ x: pad.left + (t / durationS) * plotW, label: fmtTime(t) });
    }
    ticks.push({ x: pad.left + plotW, label: fmtTime(durationS) });
  }

  const legendItems: Array<{ label: string; color: string; line: boolean }> = presentStates.map(
    (st) => ({ label: STATE_LABELS[st], color: STATE_COLORS[st], line: false }),
  );
  if (vbatPts.length >= 2) legendItems.push({ label: 'vbat', color: VBAT_COLOR, line: true });

  const vFirst = vbatPts.length >= 2 ? vbatPts[0].v : null;
  const vLast = vbatPts.length >= 2 ? vbatPts[vbatPts.length - 1].v : null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      role="img"
      aria-label={`Timeline du log : ${fmtTime(durationS)}, ${segments.length} segments (au sol / gaz bas / en vol)`}
      fontFamily={FONT}
    >
      {/* Légende des états + vbat */}
      {legendItems.map((it, i) => {
        const x = pad.left + i * 76;
        return (
          <g key={it.label}>
            {it.line ? (
              <rect x={x} y={9} width={12} height={3} rx={1.5} fill={it.color} />
            ) : (
              <rect x={x} y={5} width={10} height={10} rx={2} fill={it.color} />
            )}
            <text x={x + 15} y={14} fontSize={10} fill={INK_DIM}>
              {it.label}
            </text>
          </g>
        );
      })}
      {vFirst != null && vLast != null && (
        <text x={W - pad.right} y={14} fontSize={10} fill={INK_DIM} textAnchor="end">
          {`${vFirst.toFixed(1)} V → ${vLast.toFixed(1)} V`}
        </text>
      )}

      {/* Segments : le blanc/surface fait la séparation (retrait 1 px de chaque côté) */}
      {segments.length === 0 ? (
        <text x={W / 2} y={stripTop + stripH / 2 + 4} fontSize={11} fill={INK_AXIS} textAnchor="middle">
          Aucun segment détecté.
        </text>
      ) : (
        rects.map((r, i) => {
          const inset = r.width > 3 ? 1 : 0;
          return (
            <rect
              key={i}
              x={pad.left + r.x + inset}
              y={stripTop}
              width={Math.max(0.5, r.width - 2 * inset)}
              height={stripH}
              rx={1.5}
              fill={STATE_COLORS[r.state] ?? STATE_COLORS.idle}
            />
          );
        })
      )}

      {/* Vbat en surimpression (halo couleur surface pour rester lisible) */}
      {vbatPath !== null && (
        <g>
          <path d={vbatPath} fill="none" stroke={SURFACE} strokeWidth={4} strokeLinejoin="round" />
          <path
            d={vbatPath}
            fill="none"
            stroke={VBAT_COLOR}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </g>
      )}

      {/* Axe temps */}
      <line x1={pad.left} y1={stripBottom + 1} x2={pad.left + plotW} y2={stripBottom + 1} stroke={BASELINE} strokeWidth={1} />
      {ticks.map((t, i) => {
        const last = i === ticks.length - 1;
        return (
          <g key={`${t.label}-${i}`}>
            <line x1={t.x} y1={stripBottom + 1} x2={t.x} y2={stripBottom + 5} stroke={BASELINE} strokeWidth={1} />
            <text
              x={t.x}
              y={stripBottom + 16}
              fontSize={9}
              fill={INK_AXIS}
              textAnchor={i === 0 ? 'start' : last ? 'end' : 'middle'}
            >
              {t.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

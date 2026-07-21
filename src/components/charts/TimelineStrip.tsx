// TimelineStrip - bandeau des segments au sol / gaz bas / en vol,
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
const EVENT_COLORS: Record<string, string> = {
  crit: 'var(--chart-event-crit, #e05252)',
  warn: 'var(--chart-event-warn, #d99a2b)',
};

/** Événement daté à marquer sur la frise (oscillation, prop wash…). */
export interface TimelineEvent {
  tStart: number;
  tEnd: number;
  severity: 'warn' | 'crit';
  /** Texte court affiché au-dessus du marqueur, ex. "36 Hz". */
  label: string;
}

export interface TimelineLabels {
  ariaLabel: (duration: string, segmentCount: string) => string;
  stateIdle: string;
  stateLow: string;
  stateFlight: string;
  vbat: string;
  noSegments: string;
  /** Ajouté à l'aria-label quand des événements sont marqués. */
  eventsAria: (count: string, times: string) => string;
  /** Entrée de légende nommant ce que les marqueurs signalent. */
  eventsLegend: string;
}

const DEFAULT_LABELS: TimelineLabels = {
  ariaLabel: (duration, segmentCount) =>
    `Timeline du log : ${duration}, ${segmentCount} segments (au sol / gaz bas / en vol)`,
  stateIdle: 'au sol',
  stateLow: 'gaz bas',
  stateFlight: 'en vol',
  vbat: 'vbat',
  noSegments: 'Aucun segment détecté.',
  eventsAria: (count, times) => `${count} événement(s) signalé(s) à ${times}`,
  eventsLegend: 'oscillation détectée',
};

function stateLabels(L: TimelineLabels): Record<string, string> {
  return { idle: L.stateIdle, low: L.stateLow, flight: L.stateFlight };
}
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

/** Heure d'un événement : au dixième sous la minute, l'axe arrondit trop. */
function fmtEventTime(s: number): string {
  return s < 60 ? `${s.toFixed(1)} s` : fmtTime(s);
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

/** Largeur mini d'un marqueur (px du viewBox) : 0.8 s sur 130 s ferait 4 px. */
const EVENT_MIN_W = 3;

/** Largeur du pastille + espace avant le texte, en px du viewBox. */
const LEGEND_SWATCH = 15;
/** Approximation de la largeur d'un caractère à fontSize 10 (sans-serif). */
const LEGEND_CHAR_W = 5.2;
/** Espace entre deux entrées de légende. */
const LEGEND_GAP = 14;

/**
 * Abscisses des entrées de légende. Un pas fixe suffisait en français mais pas
 * en anglais ni en allemand, où "on the ground" et "am Boden / im Flug"
 * débordaient sur l'entrée suivante.
 */
/**
 * Triangle d'alerte centré sur (cx, cy), taille ~2*r. Dessiné plutôt qu'emoji :
 * net à toute échelle, et la couleur suit la sévérité.
 */
function WarningIcon(props: { cx: number; cy: number; r: number; color: string }): JSX.Element {
  const { cx, cy, r, color } = props;
  return (
    <g>
      <path
        d={`M${fmt(cx)},${fmt(cy - r)} L${fmt(cx + r)},${fmt(cy + r * 0.8)} L${fmt(cx - r)},${fmt(cy + r * 0.8)} Z`}
        fill={color}
      />
      <rect x={cx - 0.5} y={cy - r * 0.25} width={1} height={r * 0.7} fill={SURFACE} />
      <rect x={cx - 0.5} y={cy + r * 0.55} width={1} height={1} fill={SURFACE} />
    </g>
  );
}

export function legendPositions(labels: string[]): number[] {
  const out: number[] = [];
  let x = 0;
  for (const label of labels) {
    out.push(x);
    x += LEGEND_SWATCH + label.length * LEGEND_CHAR_W + LEGEND_GAP;
  }
  return out;
}

/**
 * Position des marqueurs d'événements. Un incident dure souvent moins d'une
 * seconde sur un vol de plusieurs minutes : sans largeur plancher il serait
 * invisible, ce qui reviendrait à ne pas l'afficher.
 */
export function buildEventMarks(
  events: TimelineEvent[],
  durationS: number,
  w: number,
): Array<{ x: number; width: number; severity: string; label: string; tStart: number }> {
  if (events.length === 0 || w <= 0 || durationS <= 0) return [];
  return events.map((e) => {
    const raw = ((Math.max(e.tEnd, e.tStart) - e.tStart) / durationS) * w;
    const width = Math.min(w, Math.max(EVENT_MIN_W, raw));
    // La largeur plancher s'applique AVANT le calage : un incident en toute fin
    // de vol (le cas courant, le pilote coupe et atterrit) est décalé vers la
    // gauche pour rester entier, au lieu de déborder ou d'être tronqué.
    const x = Math.max(0, Math.min(Math.max(0, Math.min(1, e.tStart / durationS)) * w, w - width));
    return { x, width, severity: e.severity, label: e.label, tStart: e.tStart };
  });
}

export function TimelineStrip(props: {
  segments: TimelineSegment[];
  durationS: number;
  events?: TimelineEvent[];
  labels?: TimelineLabels;
}): JSX.Element {
  const L = props.labels ?? DEFAULT_LABELS;
  const STATE_LABELS = stateLabels(L);
  const { segments, durationS, events = [] } = props;
  const W = 640;
  // Une bande de marqueurs s'insère au-dessus du bandeau : la frise grandit
  // seulement quand il y a quelque chose à y montrer.
  const eventBand = events.length > 0 ? 20 : 0;
  const H = 96 + eventBand;
  const pad = { left: 12, right: 12 };
  const plotW = W - pad.left - pad.right;
  const stripTop = 22 + eventBand;
  const stripH = 48;
  const stripBottom = stripTop + stripH;
  const marks = buildEventMarks(events, durationS, plotW);

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

  const legendItems: Array<{ label: string; color: string; line: boolean; icon?: boolean }> =
    presentStates.map((st) => ({ label: STATE_LABELS[st], color: STATE_COLORS[st], line: false }));
  if (vbatPts.length >= 2) legendItems.push({ label: L.vbat, color: VBAT_COLOR, line: true });
  // Sans entrée de légende, un trait rouge marqué "36 Hz" ne dit rien : on
  // nomme ce que le marqueur signale.
  const worstEventSeverity = events.some((e) => e.severity === 'crit') ? 'crit' : 'warn';
  if (events.length > 0) {
    legendItems.push({ label: L.eventsLegend, color: EVENT_COLORS[worstEventSeverity], line: false, icon: true });
  }

  const legendOffsets = legendPositions(legendItems.map((it) => it.label));

  const vFirst = vbatPts.length >= 2 ? vbatPts[0].v : null;
  const vLast = vbatPts.length >= 2 ? vbatPts[vbatPts.length - 1].v : null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      role="img"
      aria-label={
        L.ariaLabel(fmtTime(durationS), String(segments.length)) +
        (events.length > 0
          ? '. ' +
            L.eventsAria(
              String(events.length),
              events.map((e) => `${fmt(e.tStart)} s (${e.label})`).join(', '),
            )
          : '')
      }
      fontFamily={FONT}
    >
      {/* Légende des états + vbat. Le pas était fixe à 76 px : "on the ground"
          passait sous "in flight" en anglais, et pire en allemand. On avance
          d'un pas proportionnel à la longueur du libellé. */}
      {legendItems.map((it, i) => {
        const x = pad.left + legendOffsets[i];
        return (
          <g key={it.label}>
            {it.icon ? (
              <WarningIcon cx={x + 5} cy={10} r={5.5} color={it.color} />
            ) : it.line ? (
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
          {L.noSegments}
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

      {/* Événements datés : icône d'alerte + libellé + heure au-dessus du
          bandeau, bande translucide sur la durée de l'incident. L'heure est
          répétée ici parce que l'axe n'a que 4 à 6 graduations : sans elle, il
          faut interpoler à l'œil pour savoir quand ça s'est produit. */}
      {marks.map((m, i) => {
        const x = pad.left + m.x;
        const color = EVENT_COLORS[m.severity] ?? EVENT_COLORS.warn;
        // La bande d'événements s'insère ENTRE la légende (y 5-15) et le
        // bandeau : centrée sur 6 + eventBand/2 elle retombait sur la légende
        // et sur le rappel de tension en haut à droite.
        const iconY = 22 + eventBand / 2;
        const text = `${m.label} · ${fmtEventTime(m.tStart)}`;
        // L'étiquette part à droite de l'icône, sauf près du bord droit où elle
        // passe à gauche pour ne pas sortir du cadre.
        const flip = x + 10 + text.length * LEGEND_CHAR_W > W - pad.right;
        return (
          <g key={`ev-${i}`}>
            <rect
              x={x}
              y={stripTop}
              width={m.width}
              height={stripH}
              fill={color}
              fillOpacity={0.35}
            />
            <rect x={x} y={stripTop} width={Math.min(1.5, m.width)} height={stripH} fill={color} />
            <line x1={x} y1={iconY + 5} x2={x} y2={stripTop} stroke={color} strokeWidth={1} />
            <WarningIcon cx={x} cy={iconY} r={5} color={color} />
            <text
              x={flip ? x - 8 : x + 8}
              y={iconY + 3.5}
              fontSize={9}
              fill={color}
              textAnchor={flip ? 'end' : 'start'}
            >
              {text}
            </text>
          </g>
        );
      })}

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

'use client';

import { useEffect, useRef, useState } from 'react';

import type { ComponentType } from 'react';
import type { Severity } from '@/lib/types';

/** Teinte d'un segment : sévérité de l'axe, ou gris quand la donnée manque. */
export type SegmentTone = Severity | 'absent';

export interface GaugeSegment {
  key: string;
  /** Fraction de l'anneau (poids de l'axe, somme libre - normalisée ici). */
  weight: number;
  tone: SegmentTone;
  /** Nom de l'axe : « PID ». */
  label: string;
  /** Icône de la section (voir CATEGORY_ICONS) - affichée dans le tooltip. */
  icon?: ComponentType<{ className?: string }>;
  /** Note de l'axe : « 92/100 » ou « non évaluée - données absentes ». */
  status: string;
  /** Part dans la note globale : « 20 % du score ». */
  share: string;
  /** Ce que l'axe mesure : « Suivi de consigne, réponse indicielle… ». */
  detail: string;
  /** Ancre de la section de verdicts de l'axe, ou null si aucun verdict. */
  targetId?: string | null;
  /** Note 0-100 de l'axe : longueur remplie de la tranche (piste + progression).
   *  Absent pour une tranche « données absentes », dessinée pleine en gris. */
  score?: number;
}

const TONE_VAR: Record<SegmentTone, string> = {
  ok: 'var(--ok)',
  info: 'var(--info)',
  warn: 'var(--warn)',
  crit: 'var(--crit)',
  absent: 'var(--line)',
};

const CONFETTI_COLORS = ['#c6ff5e', '#33e0a1', '#ffb238', '#eef1f8'];

/** Petit feu d'artifice canvas, ~1.6 s, coupé si prefers-reduced-motion. */
function burstConfetti(host: HTMLElement) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '5';
  host.appendChild(canvas);
  const rect = host.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  const originX = rect.width * 0.22;
  const originY = rect.height * 0.42;
  const particles = Array.from({ length: 60 }, () => ({
    x: originX + (Math.random() - 0.5) * 40,
    y: originY,
    vx: (Math.random() - 0.5) * 8,
    vy: -Math.random() * 7 - 3,
    size: 3 + Math.random() * 4,
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 0.5,
    color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
    life: 0,
  }));
  let raf = 0;
  const tick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of particles) {
      p.vy += 0.17;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life++;
      if (p.life < 95) alive = true;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p.life / 95);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (alive) raf = requestAnimationFrame(tick);
    else canvas.remove();
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    canvas.remove();
  };
}

const R = 52;
/** Écart entre segments (degrés) - assez pour lire les tranches, pas plus. */
const GAP_DEG = 5;

function polar(angleDeg: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180; // -90 : départ en haut
  return [60 + R * Math.cos(rad), 60 + R * Math.sin(rad)];
}

function arcPath(a0: number, a1: number): string {
  const [x0, y0] = polar(a0);
  const [x1, y1] = polar(a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/**
 * Anneau de score façon PageSpeed : une tranche par axe d'analyse, longueur
 * proportionnelle au poids de l'axe dans la note, couleur selon son état -
 * grise quand la donnée manque dans le log.
 */
export default function ScoreGauge({
  score,
  worst,
  segments,
  gotoHint,
}: {
  score: number;
  worst: Severity;
  segments: GaugeSegment[];
  /** Ligne du tooltip pour une tranche cliquable : « Clic : voir les verdicts ». */
  gotoHint: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [displayed, setDisplayed] = useState(0);
  const [drawn, setDrawn] = useState(false);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cleanups: Array<() => void> = [];

    if (reduceMotion) {
      setDrawn(true);
      setDisplayed(score);
    } else {
      const raf = requestAnimationFrame(() => setDrawn(true));
      cleanups.push(() => cancelAnimationFrame(raf));
      const start = performance.now();
      const durationMs = 900;
      let countRaf = 0;
      const step = (ts: number) => {
        const p = Math.min(1, (ts - start) / durationMs);
        const eased = 1 - (1 - p) ** 3;
        setDisplayed(Math.round(score * eased));
        if (p < 1) countRaf = requestAnimationFrame(step);
      };
      countRaf = requestAnimationFrame(step);
      cleanups.push(() => cancelAnimationFrame(countRaf));
    }

    if (worst === 'ok' && hostRef.current) {
      const stopConfetti = burstConfetti(hostRef.current);
      if (stopConfetti) cleanups.push(stopConfetti);
    }

    return () => {
      cleanups.forEach((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score, worst]);

  // L'anneau est une barre de progression circulaire : chaque axe apporte un
  // arc dont la longueur vaut (part de l'axe) × (note de l'axe), les arcs sont
  // collés bout à bout, et le non-gagné reste en une seule piste grise en fin
  // de course. À 44/100, l'anneau est visiblement rempli à ~44 %. Une tranche
  // « données absentes » (score undefined) garde sa part entière, en gris.
  const totalWeight = segments.reduce((s, seg) => s + seg.weight, 0) || 1;
  // Éléments séparés par un gap : les tranches + le reliquat de piste.
  const usableDeg = 360 - (segments.length + 1) * GAP_DEG;
  /** Un axe à 0 garde un tick visible : il doit rester lisible et survolable. */
  const MIN_FILL_DEG = 3;
  let cursor = 0;
  const arcs = segments.map((seg) => {
    const fullSpan = (seg.weight / totalWeight) * usableDeg;
    const fillSpan =
      seg.score === undefined
        ? fullSpan
        : Math.max(MIN_FILL_DEG, (fullSpan * Math.max(0, Math.min(100, seg.score))) / 100);
    const a0 = cursor;
    cursor += fillSpan + GAP_DEG;
    return { seg, d: arcPath(a0, a0 + fillSpan) };
  });
  const remainderEnd = 360 - GAP_DEG;
  const remainder = remainderEnd - cursor >= 1 ? arcPath(cursor, remainderEnd) : null;

  const hovered = segments.find((s) => s.key === hoveredKey) ?? null;

  return (
    <div ref={hostRef} className="relative mx-auto size-[132px] shrink-0 sm:mx-0">
      <svg
        viewBox="0 0 120 120"
        className="size-full"
        role="img"
        aria-label={segments.map((s) => `${s.label} : ${s.status}`).join(', ')}
      >
        {/* Reliquat non gagné : une seule piste grise en fin d'anneau. */}
        {remainder ? (
          <path
            d={remainder}
            fill="none"
            stroke="var(--line)"
            strokeWidth="10"
            strokeLinecap="round"
          />
        ) : null}
        {arcs.map(({ seg, d }, i) => {
          const isHovered = seg.key === hoveredKey;
          const baseOpacity = seg.tone === 'absent' ? 0.55 : 1;
          /* Zone de survol élargie : un trait de 10 px est trop fin à viser. */
          const hitPath = (
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth="24"
              strokeLinecap="round"
              className={seg.targetId ? 'cursor-pointer' : 'cursor-help'}
              style={{ pointerEvents: 'stroke' }}
              onPointerEnter={() => setHoveredKey(seg.key)}
              onPointerLeave={() => setHoveredKey(null)}
              onClick={
                seg.targetId
                  ? undefined
                  : () => setHoveredKey((k) => (k === seg.key ? null : seg.key))
              }
            />
          );
          return (
            <g key={seg.key}>
              <path
                d={d}
                fill="none"
                stroke={TONE_VAR[seg.tone]}
                strokeWidth={isHovered ? 13 : 10}
                strokeLinecap="round"
                className="transition-[opacity,stroke-width] duration-300 ease-out"
                style={{
                  opacity: !drawn ? 0 : hoveredKey && !isHovered ? baseOpacity * 0.4 : baseOpacity,
                  transitionDelay: drawn && !hoveredKey ? `${i * 70}ms` : '0ms',
                }}
              />
              {seg.targetId ? (
                /* Lien SVG : la tranche EST l'entrée vers sa section de
                   verdicts - focusable au clavier, annoncée avec sa note. */
                <a
                  href={`#${seg.targetId}`}
                  aria-label={`${seg.label} : ${seg.status}`}
                  onFocus={() => setHoveredKey(seg.key)}
                  onBlur={() => setHoveredKey(null)}
                  onClick={(e) => {
                    e.preventDefault();
                    const el = document.getElementById(seg.targetId!);
                    if (!el) return;
                    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
                    setHoveredKey(null);
                  }}
                >
                  {hitPath}
                </a>
              ) : (
                hitPath
              )}
            </g>
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-4xl leading-none font-bold text-ink">{displayed}</span>
        <span className="mt-0.5 text-[11px] text-ink-3">/100</span>
      </div>
      {hovered ? (
        <div className="absolute left-1/2 top-full z-10 mt-1 w-64 -translate-x-1/2 rounded-xl border border-line-strong bg-surface-2 p-3 text-left shadow-[0_16px_40px_-16px_rgba(0,0,0,0.6)]">
          <p className="flex items-center justify-between gap-2 text-xs font-bold text-ink">
            <span className="flex items-center gap-1.5">
              {hovered.icon ? <hovered.icon className="size-3.5 shrink-0 text-ink-2" /> : null}
              {hovered.label}
            </span>
            <span className="font-mono font-semibold text-ink-2">{hovered.status}</span>
          </p>
          <p className="mt-0.5 text-[11px] font-semibold text-ink-3">{hovered.share}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-2">{hovered.detail}</p>
          {hovered.targetId ? (
            <p className="mt-1.5 text-[11px] font-semibold text-accent">{gotoHint}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

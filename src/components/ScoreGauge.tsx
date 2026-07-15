'use client';

import { useEffect, useRef, useState } from 'react';

import type { Severity } from '@/lib/types';

const CIRCUMFERENCE = 2 * Math.PI * 52;

const TONE_VAR: Record<Severity, string> = {
  ok: 'var(--ok)',
  info: 'var(--info)',
  warn: 'var(--warn)',
  crit: 'var(--crit)',
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

export default function ScoreGauge({ score, worst }: { score: number; worst: Severity }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [displayed, setDisplayed] = useState(0);
  const [offset, setOffset] = useState(CIRCUMFERENCE);
  const tone = TONE_VAR[worst];

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const target = CIRCUMFERENCE * (1 - score / 100);
    const cleanups: Array<() => void> = [];

    if (reduceMotion) {
      setOffset(target);
      setDisplayed(score);
    } else {
      const raf = requestAnimationFrame(() => setOffset(target));
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

  return (
    <div ref={hostRef} className="relative mx-auto size-[132px] shrink-0 sm:mx-0">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle cx="60" cy="60" r="52" fill="none" stroke="var(--line)" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r="52"
          fill="none"
          stroke={tone}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset,stroke] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-4xl leading-none font-bold text-ink">{displayed}</span>
        <span className="mt-0.5 text-[11px] text-ink-3">/100</span>
      </div>
    </div>
  );
}

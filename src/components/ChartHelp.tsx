'use client';

// ChartHelp - bouton « Comment lire » + panneau latéral pédagogique par graphe.
// Les exemples Bien / Pas bien sont des mini-SVG statiques dessinés ici : pas
// de données réelles, juste la silhouette typique qu'un novice doit apprendre
// à reconnaître. Mêmes variables --chart-* que les vrais graphes, pour que
// l'exemple ressemble à ce que le pilote a sous les yeux.

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useLocale } from '@/lib/i18n/locale';
import { InfoIcon, XIcon } from '@/components/icons';

export type ChartHelpTopic = 'timeline' | 'spectrum' | 'step';

const TRACE = 'var(--chart-roll, #0891b2)';
const BASELINE = 'var(--chart-baseline, rgba(148, 163, 184, 0.35))';
const MOTOR = 'var(--chart-motor, #f87171)';
const VBAT = 'var(--chart-vbat, #fbbf24)';
const TARGET = 'var(--chart-target, #64748b)';
const BAND_RES = 'var(--chart-band-resonance, rgba(248, 113, 113, 0.1))';
const BAND_MOT = 'var(--chart-band-motors, rgba(56, 189, 248, 0.08))';
const BAND_OVER = 'var(--chart-band-overshoot, rgba(248, 113, 113, 0.07))';
const STATE_IDLE = 'var(--chart-state-idle, #334155)';
const STATE_LOW = 'var(--chart-state-low, #155e75)';
const STATE_FLIGHT = 'var(--chart-state-flight, #10b981)';
const EVENT_CRIT = 'var(--chart-event-crit, #e05252)';

// ---------------------------------------------------------------------------
// Mini-exemples. ViewBox commun 220x100 (70 pour la frise), décoratifs :
// la légende est portée par le tag Bien / Pas bien + la légende texte.
// ---------------------------------------------------------------------------

function Frame({ children, h = 100 }: { children: React.ReactNode; h?: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 220 ${h}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      {children}
    </svg>
  );
}

/** Décor commun du spectre : bandes résonance/moteurs, ligne moteur, axe. */
function SpectrumDecor() {
  return (
    <>
      <rect x={25} y={8} width={45} height={80} fill={BAND_RES} />
      <rect x={70} y={8} width={75} height={80} fill={BAND_MOT} />
      <line x1={105} y1={8} x2={105} y2={88} stroke={MOTOR} strokeWidth={1} strokeDasharray="4 3" />
      <line x1={6} y1={88} x2={214} y2={88} stroke={BASELINE} strokeWidth={1} />
    </>
  );
}

function SpectrumGood() {
  return (
    <Frame>
      <SpectrumDecor />
      <path
        d="M6,86 L20,85 L34,86 L48,85 L62,86 L76,85 L90,86 L98,84 L102,55 L105,18 L108,55 L112,84 L120,86 L140,85 L160,86 L180,85 L200,86 L214,85"
        fill="none"
        stroke={TRACE}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Frame>
  );
}

function SpectrumBad() {
  return (
    <Frame>
      <SpectrumDecor />
      <path
        d="M6,80 L14,74 L22,78 L28,62 L34,48 L40,36 L47,30 L54,38 L61,50 L68,62 L75,70 L82,74 L88,70 L95,74 L100,60 L105,40 L110,60 L116,72 L124,76 L132,70 L140,76 L150,72 L160,77 L170,73 L180,78 L190,74 L202,78 L214,76"
        fill="none"
        stroke={TRACE}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Frame>
  );
}

/** Décor commun de la réponse indicielle : zone d'overshoot, cible, axe. */
function StepDecor() {
  return (
    <>
      <rect x={6} y={10} width={208} height={30} fill={BAND_OVER} />
      <line x1={6} y1={40} x2={214} y2={40} stroke={TARGET} strokeWidth={1} strokeDasharray="5 4" />
      <line x1={6} y1={90} x2={214} y2={90} stroke={BASELINE} strokeWidth={1} />
    </>
  );
}

function StepGood() {
  return (
    <Frame>
      <StepDecor />
      <path
        d="M6,90 L18,90 C26,90 28,52 34,42 C38,35 44,35 50,38 C58,41 70,40 90,40 L214,40"
        fill="none"
        stroke={TRACE}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Frame>
  );
}

function StepBadOvershoot() {
  return (
    <Frame>
      <StepDecor />
      <path
        d="M6,90 L16,90 C22,88 26,30 32,16 C36,8 40,26 46,48 C52,66 56,58 62,38 C68,22 72,34 78,52 C84,64 88,52 94,42 C100,34 106,44 112,46 C120,48 130,42 140,41 L214,41"
        fill="none"
        stroke={TRACE}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Frame>
  );
}

function StepBadSlow() {
  return (
    <Frame>
      <StepDecor />
      <path
        d="M6,90 L18,90 C60,88 100,70 150,55 C180,48 200,44 214,43"
        fill="none"
        stroke={TRACE}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Frame>
  );
}

/** Décor commun de la frise : segments au sol / gaz bas / en vol / au sol. */
function TimelineDecor() {
  return (
    <>
      <rect x={6} y={18} width={24} height={34} rx={1.5} fill={STATE_IDLE} />
      <rect x={32} y={18} width={16} height={34} rx={1.5} fill={STATE_LOW} />
      <rect x={50} y={18} width={140} height={34} rx={1.5} fill={STATE_FLIGHT} />
      <rect x={192} y={18} width={22} height={34} rx={1.5} fill={STATE_IDLE} />
      <line x1={6} y1={54} x2={214} y2={54} stroke={BASELINE} strokeWidth={1} />
    </>
  );
}

function TimelineGood() {
  return (
    <Frame h={70}>
      <TimelineDecor />
      <path
        d="M10,26 L50,27 L90,30 L130,32 L170,35 L210,38"
        fill="none"
        stroke={VBAT}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Frame>
  );
}

function TimelineWarn({ x }: { x: number }) {
  return (
    <>
      <rect x={x - 3} y={18} width={6} height={34} fill={EVENT_CRIT} fillOpacity={0.4} />
      <line x1={x} y1={14} x2={x} y2={18} stroke={EVENT_CRIT} strokeWidth={1} />
      <path d={`M${x},4 L${x + 6},14 L${x - 6},14 Z`} fill={EVENT_CRIT} />
    </>
  );
}

function TimelineBad() {
  return (
    <Frame h={70}>
      <TimelineDecor />
      <TimelineWarn x={92} />
      <TimelineWarn x={152} />
      <path
        d="M10,24 L55,28 L68,42 L88,34 L100,46 L125,38 L150,48 L175,42 L210,48"
        fill="none"
        stroke={VBAT}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Registre : ordre et dessin des exemples par graphe ; les légendes viennent
// du dictionnaire (dict.ui.chartHelp.<topic>.examples, mêmes clés).
// ---------------------------------------------------------------------------

const EXAMPLES: Record<
  ChartHelpTopic,
  Array<{ key: 'good' | 'bad' | 'badSlow'; Svg: () => JSX.Element }>
> = {
  timeline: [
    { key: 'good', Svg: TimelineGood },
    { key: 'bad', Svg: TimelineBad },
  ],
  spectrum: [
    { key: 'good', Svg: SpectrumGood },
    { key: 'bad', Svg: SpectrumBad },
  ],
  step: [
    { key: 'good', Svg: StepGood },
    { key: 'bad', Svg: StepBadOvershoot },
    { key: 'badSlow', Svg: StepBadSlow },
  ],
};

// ---------------------------------------------------------------------------
// Panneau latéral
// ---------------------------------------------------------------------------

function HelpPanel({ topic, onClose }: { topic: ChartHelpTopic; onClose: () => void }) {
  const { dict } = useLocale();
  const h = dict.ui.chartHelp;
  const t = h[topic];
  const closeRef = useRef<HTMLButtonElement>(null);

  // onClose est une arrow recréée à chaque rendu du parent : passé en
  // dépendance, l'effet se rejouerait et capturerait 'hidden' comme valeur
  // à restaurer, laissant le scroll bloqué à la fermeture.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    // Le fond ne doit pas défiler sous le panneau.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t.title}
        className="absolute inset-y-0 right-0 w-full max-w-md overflow-y-auto border-l border-line-strong bg-surface p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-ink">{t.title}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={h.closeAria}
            className="shrink-0 rounded-full text-ink-3 transition-colors hover:text-ink"
          >
            <XIcon className="size-6" />
          </button>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-ink-2">{t.intro}</p>

        <h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-ink-2">{h.readTitle}</h3>
        <ul className="mt-2 space-y-1.5">
          {t.points.map((p) => (
            <li key={p} className="flex items-start gap-1.5 text-xs leading-relaxed text-ink-2">
              <span aria-hidden="true" className="mt-0.5 text-ink-3">
                •
              </span>
              <span>{p}</span>
            </li>
          ))}
        </ul>

        <h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-ink-2">
          {h.examplesTitle}
        </h3>
        <div className="mt-2 space-y-3">
          {EXAMPLES[topic].map(({ key, Svg }) => {
            const good = key === 'good';
            const caption = (t.examples as Record<string, string>)[key];
            return (
              <figure key={key} className="rounded-xl border border-line bg-surface-2 p-3">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    good ? 'bg-ok/15 text-ok' : 'bg-crit/15 text-crit'
                  }`}
                >
                  {good ? h.goodTag : h.badTag}
                </span>
                <div className="mt-2">
                  <Svg />
                </div>
                <figcaption className="mt-2 text-xs leading-relaxed text-ink-2">
                  {caption}
                </figcaption>
              </figure>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bouton d'appel - à poser dans l'en-tête de chaque carte de graphe.
// ---------------------------------------------------------------------------

export default function ChartHelp({ topic }: { topic: ChartHelpTopic }) {
  const { dict } = useLocale();
  const h = dict.ui.chartHelp;
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={h.buttonAria(h[topic].title)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-ink-3 transition-colors hover:border-line-strong hover:text-ink"
      >
        <InfoIcon className="size-3.5" />
        {h.buttonLabel}
      </button>
      {open ? <HelpPanel topic={topic} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

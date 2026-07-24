// Icônes traits fins (stroke=currentColor), remplacent les emoji de statut.
// Même esprit que KofiIcon dans Shell.tsx : petits composants purs, sans état.

import type { ComponentType } from 'react';

import type { FindingCategory } from '@/lib/types';

export function CheckIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M8 12.3l2.6 2.6L16 9.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AlertIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path d="M12 4L21 19H3L12 4Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <line x1="12" y1="10" x2="12" y2="14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="12" cy="16.6" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function InfoIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <line x1="12" y1="11" x2="12" y2="16.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="12" cy="7.6" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function XIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

export function SatelliteIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="16" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 14v-2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M7.5 8.5a6.4 6.4 0 0 1 9 0M5 6a9.9 9.9 0 0 1 14 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ClockIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function WaveIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path
        d="M2 13l3-7 3 12 3-9 3 6 3-8 3 6h2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BatteryIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <rect x="2.5" y="8" width="16" height="8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="20" y="10.5" width="2" height="3" fill="currentColor" />
      <rect x="5" y="10.5" width="10" height="3" fill="currentColor" opacity="0.55" />
    </svg>
  );
}

export function BoltIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path d="M13 2L4 14h6l-1 8 9-13h-6l1-7Z" fill="currentColor" />
    </svg>
  );
}

export function GaugeIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path d="M4 16a8 8 0 0 1 16 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 16l4-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="16" r="1.3" fill="currentColor" />
    </svg>
  );
}

export function TimerIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M9 2h6M12 9v4.2l2.4 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ShareIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <circle cx="18" cy="5" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="6" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="18" cy="19" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8.4 10.8l7.2-4.2M8.4 13.2l7.2 4.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function CopyIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <rect x="8" y="8" width="12" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5 15V5a2 2 0 0 1 2-2h9" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Icônes de section - une par catégorie de verdicts (voir CATEGORY_ICONS).
// ---------------------------------------------------------------------------

export function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path
        d="M12 3.4l6.7 2.5v5c0 4.2-2.8 7.2-6.7 8.7-3.9-1.5-6.7-4.5-6.7-8.7v-5L12 3.4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function VibrationIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <rect x="9" y="6.5" width="6" height="11" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M5.7 9.4v5.2M2.9 10.7v2.6M18.3 9.4v5.2M21.1 10.7v2.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function FilterIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path
        d="M21 4H3l7.2 8.5v6l3.6-2v-4L21 4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Trois potentiomètres verticaux - réglage P/I/D. */
export function SlidersIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path
        d="M6 4v6.3M6 14.1v5.9M12 4v2.8M12 10.6v9.4M18 4v8.8M18 16.6v3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="6" cy="12.2" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="8.7" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="18" cy="14.7" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/** Quatre moteurs vus de dessus - même vocabulaire que DroneIcon. */
export function MotorIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <circle cx="7" cy="7" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17" cy="7" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="7" cy="17" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17" cy="17" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="7" cy="7" r="0.9" fill="currentColor" />
      <circle cx="17" cy="7" r="0.9" fill="currentColor" />
      <circle cx="7" cy="17" r="0.9" fill="currentColor" />
      <circle cx="17" cy="17" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function WrenchIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path
        d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FileTextIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path
        d="M13.5 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8L13.5 3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M13.5 3v5h5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 13h6M9 16.5h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Icône d'identité de chaque catégorie de verdicts. Partout où une section est
 * nommée (titre, puce, tooltip de la jauge), son icône l'accompagne - la forme
 * dit QUELLE section, la couleur reste réservée à la sévérité.
 */
export const CATEGORY_ICONS: Record<FindingCategory, ComponentType<{ className?: string }>> = {
  securite: ShieldIcon,
  vibrations: VibrationIcon,
  filtres: FilterIcon,
  pid: SlidersIcon,
  moteurs: MotorIcon,
  batterie: BatteryIcon,
  config: WrenchIcon,
  gps: SatelliteIcon,
  log: FileTextIcon,
};

/** Petit quad stylisé pour la zone de dépôt - le LED central clignote au survol via .group-hover. */
export function DroneIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" fill="none" className={className}>
      <circle cx="10" cy="10" r="5" stroke="currentColor" strokeWidth="2" className="transition-colors group-hover:stroke-accent" />
      <circle cx="38" cy="10" r="5" stroke="currentColor" strokeWidth="2" className="transition-colors group-hover:stroke-accent" />
      <circle cx="10" cy="38" r="5" stroke="currentColor" strokeWidth="2" className="transition-colors group-hover:stroke-accent" />
      <circle cx="38" cy="38" r="5" stroke="currentColor" strokeWidth="2" className="transition-colors group-hover:stroke-accent" />
      <path
        d="M13 13L21 21M35 13L27 21M13 35L21 27M35 35L27 27"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="transition-colors group-hover:stroke-accent"
      />
      <rect x="18" y="18" width="12" height="12" rx="3" fill="currentColor" opacity="0.15" />
      <rect x="18" y="18" width="12" height="12" rx="3" stroke="currentColor" strokeWidth="2" />
      <circle cx="24" cy="24" r="1.8" fill="currentColor" className="text-accent group-hover:animate-pulse" />
    </svg>
  );
}

// Icônes traits fins (stroke=currentColor), remplacent les emoji de statut.
// Même esprit que KofiIcon dans Shell.tsx : petits composants purs, sans état.

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

export function CopyIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <rect x="8" y="8" width="12" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5 15V5a2 2 0 0 1 2-2h9" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

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

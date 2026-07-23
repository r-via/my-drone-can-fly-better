'use client';

import { useLocale } from '@/lib/i18n/locale';

import type { Severity } from '@/lib/types';

/** Teinte de la barre de score : même sémantique que le badge de verdict. */
const FILL_TONE: Record<Severity, string> = {
  ok: 'bg-ok/25',
  info: 'bg-info/25',
  warn: 'bg-warn/25',
  crit: 'bg-crit/25',
};

export interface SessionPickerItem {
  /** Valeur opaque renvoyée à onSelect (index dans la liste des sessions valides). */
  value: number;
  /** Ex. « Session 2 ». */
  label: string;
  /** Ex. « 1 min 12 s · t+5:03 ». */
  sublabel?: string;
  /** Score /100 du vol : rendu en barre de remplissage dans l'onglet. */
  score?: number;
  /** Sévérité qui teinte la barre (défaut : ok). */
  tone?: Severity;
}

export interface SessionPickerProps {
  items: SessionPickerItem[];
  selected: number;
  onSelect: (value: number) => void;
  /** Libellé du tablist. Par défaut « Sessions du fichier » ; la vue à onglets
   *  de vol le surcharge car elle liste des vols, pas les sessions d'un fichier. */
  ariaLabel?: string;
}

/** Barre d'onglets réutilisable (pills). Chaque item porte son propre libellé,
 *  et optionnellement son score de vol, rendu en barre de remplissage. */
export default function SessionPicker({ items, selected, onSelect, ariaLabel }: SessionPickerProps) {
  const { dict } = useLocale();
  return (
    <div
      role="tablist"
      aria-label={ariaLabel ?? dict.ui.sessionPicker.listAria}
      className="flex flex-wrap gap-2"
    >
      {items.map((item) => {
        const active = item.value === selected;
        const hasScore = item.score !== undefined;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(item.value)}
            className={`relative max-w-full overflow-hidden rounded-full border px-3.5 py-1.5 text-left text-sm transition-colors ${
              active
                ? 'border-accent bg-accent/10 text-ink'
                : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink'
            }`}
          >
            {hasScore ? (
              /* Barre de remplissage : largeur = score/100, sous le texte. */
              <span
                aria-hidden="true"
                className={`absolute inset-y-0 left-0 ${FILL_TONE[item.tone ?? 'ok']} transition-[width] duration-500`}
                style={{ width: `${Math.max(0, Math.min(100, item.score ?? 0))}%` }}
              />
            ) : null}
            {/* flex + truncate : un nom de log de 50+ caractères ne doit pas
                faire déborder la pilule de l'écran en mobile. */}
            <span className="relative flex items-baseline gap-2">
              <span className="min-w-0 truncate font-medium">{item.label}</span>
              {hasScore ? (
                <span className="font-mono text-xs font-bold tabular-nums text-ink">
                  {item.score}
                </span>
              ) : null}
              {item.sublabel ? (
                <span className="whitespace-nowrap font-mono text-xs text-ink-3">{item.sublabel}</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

'use client';

export interface SessionPickerItem {
  /** Valeur opaque renvoyée à onSelect (index dans la liste des sessions valides). */
  value: number;
  /** Ex. « Session 2 ». */
  label: string;
  /** Ex. « 1 min 12 s · t+5:03 ». */
  sublabel?: string;
}

export interface SessionPickerProps {
  items: SessionPickerItem[];
  selected: number;
  onSelect: (value: number) => void;
}

/** Sélecteur de session (affiché seulement quand un fichier en contient plusieurs). */
export default function SessionPicker({ items, selected, onSelect }: SessionPickerProps) {
  return (
    <div role="tablist" aria-label="Sessions du fichier" className="flex flex-wrap gap-2">
      {items.map((item) => {
        const active = item.value === selected;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(item.value)}
            className={`rounded-md border px-3 py-1.5 text-left text-sm transition-colors ${
              active
                ? 'border-accent bg-accent/10 text-ink'
                : 'border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink'
            }`}
          >
            <span className="font-medium">{item.label}</span>
            {item.sublabel ? (
              <span className="ml-2 font-mono text-xs text-ink-3">{item.sublabel}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

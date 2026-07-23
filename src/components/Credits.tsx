'use client';

// Remerciements : contributeurs regroupés par communauté (testeurs, logs
// partagés, bugs remontés). Les noms vivent dans src/lib/credits.ts ; seuls le
// titre et l'intro sont localisés. Rien ne s'affiche tant qu'aucun groupe n'a
// de membre.
import { CREDIT_GROUPS } from '@/lib/credits';
import { useLocale } from '@/lib/i18n/locale';

const chipClass =
  'inline-block rounded-full bg-surface-2 px-3 py-1 font-mono text-xs text-ink-2';

export default function Credits() {
  const { dict } = useLocale();
  const t = dict.ui.credits;
  const groups = CREDIT_GROUPS.filter((g) => g.members.length > 0);
  if (groups.length === 0) return null;
  return (
    <section
      aria-label={t.title}
      className="rounded-2xl border border-line bg-surface p-5"
    >
      <h2 className="font-display text-sm font-bold tracking-wide text-ink">{t.title}</h2>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-2">{t.intro}</p>
      <div className="mt-4 space-y-4">
        {groups.map((group) => (
          <div key={group.name}>
            {group.url ? (
              <a
                href={group.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-bold text-accent hover:underline"
              >
                {group.name}
              </a>
            ) : (
              <p className="text-sm font-bold text-ink">{group.name}</p>
            )}
            <ul className="mt-2 flex flex-wrap gap-2">
              {group.members.map((c) => (
                <li key={c.name}>
                  {c.url ? (
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${chipClass} transition-all hover:-translate-y-px hover:bg-surface-3 hover:text-ink`}
                    >
                      {c.name}
                    </a>
                  ) : (
                    <span className={chipClass}>{c.name}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

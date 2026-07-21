// Registre des locales. La référence est fr/ ; chaque traduction est un fichier
// `const xx: Dict = {...}` : le compilateur garantit la complétude.
import { de } from './de';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { zh } from './zh';

import type { Dict } from './fr';

export type { Dict };

export type Locale = 'en' | 'fr' | 'es' | 'de' | 'zh';

export const LOCALES: ReadonlyArray<{ code: Locale; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
  { code: 'zh', label: '中文' },
];

const REGISTRY: Record<Locale, Dict> = { fr, en, es, de, zh };

export function getDict(locale: Locale): Dict {
  return REGISTRY[locale] ?? REGISTRY.en;
}

export function isLocale(v: string | null | undefined): v is Locale {
  return v === 'en' || v === 'fr' || v === 'es' || v === 'de' || v === 'zh';
}

/** Détection : localStorage puis navigator.language, défaut anglais. */
export function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const saved = window.localStorage.getItem('mdcfb.locale');
  if (isLocale(saved)) return saved;
  const nav = (window.navigator.language || 'en').slice(0, 2).toLowerCase();
  return isLocale(nav) ? nav : 'en';
}

export function persistLocale(locale: Locale): void {
  if (typeof window !== 'undefined') window.localStorage.setItem('mdcfb.locale', locale);
}

/**
 * Détection côté Node (CLI) : LC_ALL, LC_MESSAGES, LANG puis LANGUAGE, au
 * format POSIX (`fr_FR.UTF-8`, `en_US`, éventuellement une liste `fr:en_US`
 * façon gettext) - défaut anglais si rien d'exploitable (locale "C"/"POSIX").
 */
export function detectLocaleFromEnv(env: Record<string, string | undefined>): Locale {
  const raw = env.LC_ALL || env.LC_MESSAGES || env.LANG || env.LANGUAGE || '';
  const code = raw.split(/[:_.]/)[0]?.toLowerCase();
  return isLocale(code) ? code : 'en';
}

// Registre des locales. en/es/de/zh pointent sur fr tant que les traductions
// ne sont pas livrées (fallback sans trou) — chaque traduction est un fichier
// `const xx: Dict = {...}` : le compilateur garantit la complétude.
import { fr } from './fr';

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

const REGISTRY: Record<Locale, Dict> = {
  fr,
  en: fr,
  es: fr,
  de: fr,
  zh: fr,
};

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

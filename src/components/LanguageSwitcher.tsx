'use client';

import { LOCALES } from '@/lib/i18n';
import { useLocale } from '@/lib/i18n/locale';

import type { Locale } from '@/lib/i18n';

export default function LanguageSwitcher() {
  const { locale, setLocale, dict } = useLocale();
  return (
    <label className="flex items-center gap-1.5 text-xs text-ink-3">
      <span className="sr-only">{dict.ui.app.languageLabel}</span>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 fill-current">
        <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm5.9 5h-2.36a10.6 10.6 0 0 0-1.13-3.14A6.53 6.53 0 0 1 13.9 5ZM8 1.5c.74.9 1.44 2.13 1.86 3.5H6.14C6.56 3.63 7.26 2.4 8 1.5ZM1.5 8c0-.52.06-1.02.18-1.5h2.7a15 15 0 0 0 0 3h-2.7A6.4 6.4 0 0 1 1.5 8Zm.6 3h2.36c.28 1.17.68 2.24 1.13 3.14A6.53 6.53 0 0 1 2.1 11Zm2.36-6H2.1a6.53 6.53 0 0 1 3.49-3.14A10.6 10.6 0 0 0 4.46 5ZM8 14.5c-.74-.9-1.44-2.13-1.86-3.5h3.72c-.42 1.37-1.12 2.6-1.86 3.5Zm2.14-5H5.86a13.3 13.3 0 0 1 0-3h4.28a13.3 13.3 0 0 1 0 3Zm.32 4.64c.45-.9.85-1.97 1.13-3.14h2.36a6.53 6.53 0 0 1-3.49 3.14ZM11.62 9.5a15 15 0 0 0 0-3h2.7a6.4 6.4 0 0 1 0 3h-2.7Z" />
      </svg>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="cursor-pointer rounded border border-line bg-surface px-1.5 py-1 text-xs text-ink-2 focus:outline-none"
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}

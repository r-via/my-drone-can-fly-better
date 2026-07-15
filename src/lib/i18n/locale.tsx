'use client';

// Contexte de langue côté client. Le SSG rend en anglais ; la locale réelle
// (localStorage / navigateur) est appliquée après hydratation.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { detectLocale, getDict, persistLocale } from './index';

import type { Dict, Locale } from './index';
import type { ReactNode } from 'react';

interface LocaleContextValue {
  locale: Locale;
  dict: Dict;
  setLocale: (l: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    setLocaleState(detectLocale());
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : locale;
  }, [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      dict: getDict(locale),
      setLocale: (l: Locale) => {
        persistLocale(l);
        setLocaleState(l);
      },
    }),
    [locale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale doit être utilisé sous <LocaleProvider>');
  return ctx;
}

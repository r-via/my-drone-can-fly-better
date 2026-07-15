'use client';

// Coquille client : header/footer localisés autour du contenu.
import LanguageSwitcher from './LanguageSwitcher';
import { useLocale } from '@/lib/i18n/locale';

import type { ReactNode } from 'react';

const KOFI_URL = 'https://ko-fi.com/rvia';

function KofiIcon({ className }: { className?: string }) {
  // Tasse stylisée (esprit Ko-fi), monochrome.
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M3 5h15a3 3 0 0 1 3 3v1a4 4 0 0 1-4 4h-.35A7 7 0 0 1 10 18H8a7 7 0 0 1-7-7V6a1 1 0 0 1 1-1h1Zm14 6h1a2 2 0 0 0 2-2V8a1 1 0 0 0-1-1h-2v4ZM7.5 8.6c-.9 0-1.7.7-1.7 1.6 0 1.5 1.6 2.6 3.2 3.7l.5.3.5-.3c1.6-1.1 3.2-2.2 3.2-3.7 0-.9-.8-1.6-1.7-1.6-.6 0-1.2.3-1.5.8l-.5.7-.5-.7c-.3-.5-.9-.8-1.5-.8Z" />
    </svg>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const { dict } = useLocale();
  return (
    <>
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <p className="flex items-baseline gap-2 font-display text-[15px] font-bold tracking-[0.14em] text-ink">
            <span aria-hidden="true" className="font-mono text-accent">
              //
            </span>
            {dict.ui.app.logo}
          </p>
          <div className="flex items-center gap-3">
            <p className="hidden text-xs text-ink-3 xl:block">{dict.ui.app.headerTagline}</p>
            <a
              href={KOFI_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-amber/15 px-3 py-1.5 text-xs font-bold text-amber transition-all hover:-translate-y-px hover:bg-amber/25 hover:shadow-[0_6px_18px_-8px_var(--amber)]"
            >
              <KofiIcon className="size-4" />
              <span>{dict.ui.app.supportKofi}</span>
            </a>
            <LanguageSwitcher />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-4">
          <p className="text-xs text-ink-3">{dict.ui.app.footer}</p>
          <p className="text-xs text-ink-3">
            {dict.ui.app.footerKofi}{' '}
            <a
              href={KOFI_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-amber hover:underline"
            >
              ko-fi.com/rvia
            </a>
          </p>
        </div>
      </footer>
    </>
  );
}

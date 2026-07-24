'use client';

// Coquille client : header/footer localisés autour du contenu.
import LanguageSwitcher from './LanguageSwitcher';
import { useLocale } from '@/lib/i18n/locale';

import type { ReactNode } from 'react';

const KOFI_URL = 'https://ko-fi.com/rvia';
const DISCORD_URL = 'https://discord.gg/6tsHPedrzZ';
const GITHUB_URL = 'https://github.com/r-via/my-drone-can-fly-better';

function KofiIcon({ className }: { className?: string }) {
  // Tasse stylisée (esprit Ko-fi), monochrome.
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M3 5h15a3 3 0 0 1 3 3v1a4 4 0 0 1-4 4h-.35A7 7 0 0 1 10 18H8a7 7 0 0 1-7-7V6a1 1 0 0 1 1-1h1Zm14 6h1a2 2 0 0 0 2-2V8a1 1 0 0 0-1-1h-2v4ZM7.5 8.6c-.9 0-1.7.7-1.7 1.6 0 1.5 1.6 2.6 3.2 3.7l.5.3.5-.3c1.6-1.1 3.2-2.2 3.2-3.7 0-.9-.8-1.6-1.7-1.6-.6 0-1.2.3-1.5.8l-.5.7-.5-.7c-.3-.5-.9-.8-1.5-.8Z" />
    </svg>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M20.3 5.4A17.5 17.5 0 0 0 15.9 4a12.9 12.9 0 0 0-.6 1.2 16.3 16.3 0 0 0-4.6 0A12.9 12.9 0 0 0 10.1 4a17.5 17.5 0 0 0-4.4 1.4C2.9 9.2 2.2 12.9 2.5 16.5a17.6 17.6 0 0 0 5.3 2.7c.4-.6.8-1.2 1.1-1.9-.6-.2-1.2-.5-1.8-.9l.4-.3c3.5 1.6 7.3 1.6 10.8 0l.4.3c-.6.4-1.2.7-1.8.9.3.7.7 1.3 1.1 1.9a17.5 17.5 0 0 0 5.3-2.7c.4-4.2-.7-7.8-2.9-11.1ZM9.7 14.3c-1 0-1.9-1-1.9-2.2s.8-2.2 1.9-2.2 1.9 1 1.9 2.2-.9 2.2-1.9 2.2Zm6.6 0c-1 0-1.9-1-1.9-2.2s.8-2.2 1.9-2.2 1.9 1 1.9 2.2-.8 2.2-1.9 2.2Z" />
    </svg>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 2a10 10 0 0 0-3.16 19.5c.5.1.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.15-1.11-1.46-1.11-1.46-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.35 1.08 2.92.83.09-.65.35-1.08.63-1.33-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.6 9.6 0 0 1 5 0c1.91-1.3 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
    </svg>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const { dict } = useLocale();
  return (
    <>
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          {/* Lien dur vers l'accueil : l'état du rapport vit dans la page, un
              <Link> vers la même route ne remonterait rien - le rechargement
              complet EST le retour à l'accueil (et il retire le fragment #r/#s
              d'un rapport partagé). */}
          <a
            href="/"
            className="flex items-baseline gap-2 whitespace-nowrap font-display text-[15px] font-bold tracking-[0.14em] text-ink transition-opacity hover:opacity-80"
          >
            <span aria-hidden="true" className="font-mono text-accent">
              //
            </span>
            {dict.ui.app.logo}
          </a>
          <div className="flex items-center gap-2 sm:gap-3">
            <p className="hidden text-xs text-ink-3 xl:block">{dict.ui.app.headerTagline}</p>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={dict.ui.app.viewSource}
              title={dict.ui.app.viewSource}
              className="inline-flex size-8 items-center justify-center rounded-full bg-surface-2 text-ink-2 transition-all hover:-translate-y-px hover:bg-surface-3 hover:text-ink"
            >
              <GitHubIcon className="size-4" />
            </a>
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={dict.ui.app.joinDiscord}
              title={dict.ui.app.joinDiscord}
              className="inline-flex size-8 items-center justify-center rounded-full bg-surface-2 text-ink-2 transition-all hover:-translate-y-px hover:bg-surface-3 hover:text-ink"
            >
              <DiscordIcon className="size-4" />
            </a>
            <a
              href={KOFI_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={dict.ui.app.supportKofi}
              title={dict.ui.app.supportKofi}
              className="inline-flex items-center gap-1.5 rounded-full bg-amber/15 px-3 py-1.5 text-xs font-bold text-amber transition-all hover:-translate-y-px hover:bg-amber/25 hover:shadow-[0_6px_18px_-8px_var(--amber)]"
            >
              <KofiIcon className="size-4" />
              <span className="hidden sm:inline">{dict.ui.app.supportKofi}</span>
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

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Debrief — Ton vol, décodé. Sans IA.',
  description:
    'Analyse blackbox Betaflight 100 % locale : DSP et règles déterministes, verdicts chiffrés, commandes CLI prêtes à coller. Tes logs ne quittent jamais ton navigateur.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0a0e14' },
    { media: '(prefers-color-scheme: light)', color: '#f3f5f9' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="flex min-h-dvh flex-col bg-bg font-sans text-ink antialiased">
        <header className="border-b border-line">
          <div className="mx-auto flex w-full max-w-5xl items-baseline justify-between gap-4 px-4 py-3">
            <p className="text-sm font-semibold tracking-[0.22em] text-ink">
              <span aria-hidden="true" className="font-mono text-accent">
                //
              </span>{' '}
              DEBRIEF
            </p>
            <p className="hidden text-xs text-ink-3 sm:block">
              Analyse 100 % locale — tes logs ne quittent pas ton navigateur.
            </p>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-line">
          <p className="mx-auto w-full max-w-5xl px-4 py-4 text-xs text-ink-3">
            Analyse déterministe — chaque verdict est traçable à une règle open source. Aucune
            donnée envoyée.
          </p>
        </footer>
      </body>
    </html>
  );
}

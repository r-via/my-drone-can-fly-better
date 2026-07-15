import Shell from '@/components/Shell';
import { LocaleProvider } from '@/lib/i18n/locale';
import { manrope, rajdhani } from './fonts';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'My Drone Can Fly Better - Betaflight blackbox analysis',
  description:
    'Fully local Betaflight blackbox analysis: DSP and deterministic rules, quantified verdicts, ready-to-paste CLI commands. Your logs never leave your browser.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0a0e14' },
    { media: '(prefers-color-scheme: light)', color: '#f3f5f9' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${manrope.variable} ${rajdhani.variable} flex min-h-dvh flex-col bg-bg font-sans text-ink antialiased`}
      >
        <LocaleProvider>
          <Shell>{children}</Shell>
        </LocaleProvider>
      </body>
    </html>
  );
}

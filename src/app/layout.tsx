import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';
import Shell from '@/components/Shell';
import { LocaleProvider } from '@/lib/i18n/locale';
import { manrope, rajdhani } from './fonts';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

const TITLE = 'My Drone Can Fly Better - Betaflight blackbox analysis';
const DESCRIPTION =
  'Fully local Betaflight blackbox analysis: DSP and deterministic rules, quantified verdicts, ready-to-paste CLI commands. Your logs never leave your browser.';

export const metadata: Metadata = {
  metadataBase: new URL('https://mydronecanflybetter.wooplib.com'),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    siteName: 'My Drone Can Fly Better',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0a0b12' },
    { media: '(prefers-color-scheme: light)', color: '#f2f3f9' },
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
          <ServiceWorkerRegister />
        </LocaleProvider>
      </body>
    </html>
  );
}

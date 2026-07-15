import localFont from 'next/font/local';

// Rajdhani (SIL OFL) - display technique/racing, réservée aux titres et au score.
export const rajdhani = localFont({
  src: [
    { path: './fonts/rajdhani-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/rajdhani-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-rajdhani',
  display: 'swap',
});

// Manrope (SIL OFL) - texte courant, variable 400 à 800.
export const manrope = localFont({
  src: './fonts/manrope-variable.woff2',
  weight: '400 800',
  variable: '--font-manrope',
  display: 'swap',
});

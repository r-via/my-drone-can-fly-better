import type { MetadataRoute } from 'next';

// Requis par `output: 'export'` - sans ça, next build échoue sur cette route.
export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'My Drone Can Fly Better',
    short_name: 'MDCFB',
    description:
      'Fully local Betaflight blackbox analysis: DSP and deterministic rules, quantified verdicts, ready-to-paste CLI commands.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0a0b12',
    theme_color: '#0a0b12',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}

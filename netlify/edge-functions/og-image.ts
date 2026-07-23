// Carte OG dynamique des liens de partage (/api/og?t=…&d=…).
//
// Rend en PNG 1200x630 la carte de score : nom du craft, score coloré, barre
// de progression et chips par axe. Les données arrivent en query (t = titre
// « craft · score/100 », d = « verdict · axes »), déjà localisées côté client.
// Le rapport complet reste dans le fragment #r=…, jamais envoyé au serveur.
//
// Edge Function (Deno) : og_edge = satori + resvg, pas de navigateur.

// @ts-ignore import URL Deno, résolu par le runtime Edge (tsc ne le connaît pas)
import { ImageResponse } from 'https://deno.land/x/og_edge@0.0.6/mod.ts';

const LIME = '#c6ff5e';
const AMBER = '#fbbf24';
const RED = '#f87171';
const INK = '#e8f0dc';
const MUTED = '#8a9480';
const BG = '#0c0e0a';
const CARD = '#151a10';
const LINE = '#2c3524';

const FONT_BASE = 'https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5.2.5/files';
let fontsPromise: Promise<{ name: string; data: ArrayBuffer; weight: 400 | 700 }[]> | null = null;

function loadFonts() {
  fontsPromise ??= Promise.all(
    ([400, 700] as const).map(async (weight) => ({
      name: 'JetBrains Mono',
      data: await (await fetch(`${FONT_BASE}/jetbrains-mono-latin-${weight}-normal.woff`)).arrayBuffer(),
      weight,
    })),
  );
  return fontsPromise;
}

function el(type: string, style: Record<string, unknown>, children?: unknown) {
  return { type, props: { style, children } };
}

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const t = (url.searchParams.get('t') ?? 'Flight report').slice(0, 120);
  const d = (url.searchParams.get('d') ?? '').slice(0, 300);

  const scoreMatch = t.match(/(\d{1,3})\s*\/\s*100/);
  const score = scoreMatch ? Math.min(100, parseInt(scoreMatch[1], 10)) : null;
  const craft = (scoreMatch ? t.slice(0, t.lastIndexOf(scoreMatch[0])).replace(/[·\s]+$/, '') : t) || 'Flight report';
  const tone = score === null ? MUTED : score >= 85 ? LIME : score >= 60 ? AMBER : RED;

  const parts = d.split('·').map((s) => s.trim()).filter(Boolean);
  const verdict = parts[0] ?? '';
  const chips = parts.slice(1, 8);

  const card = el('div', {
    width: '1200px', height: '630px', display: 'flex', flexDirection: 'column',
    backgroundColor: BG, color: INK, fontFamily: 'JetBrains Mono', padding: '52px 60px',
  }, [
    el('div', { display: 'flex', alignItems: 'center', gap: '14px', fontSize: '26px', letterSpacing: '2px' }, [
      el('span', { color: LIME, fontWeight: 700 }, '//'),
      el('span', { color: MUTED }, 'MY DRONE CAN FLY BETTER'),
    ]),
    el('div', {
      display: 'flex', flexDirection: 'column', flexGrow: 1, justifyContent: 'center',
      backgroundColor: CARD, borderRadius: '24px', border: `2px solid ${LINE}`,
      margin: '36px 0', padding: '40px 56px',
    }, [
      el('div', { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }, [
        el('div', { display: 'flex', flexDirection: 'column', maxWidth: '640px' }, [
          el('div', { fontSize: '46px', fontWeight: 700 }, craft),
          verdict ? el('div', { fontSize: '28px', color: tone, marginTop: '14px' }, verdict) : undefined,
        ]),
        score === null ? undefined : el('div', { display: 'flex', alignItems: 'baseline' }, [
          el('span', { fontSize: '150px', fontWeight: 700, color: tone, lineHeight: 1 }, String(score)),
          el('span', { fontSize: '40px', color: MUTED, marginLeft: '8px' }, '/100'),
        ]),
      ]),
      score === null ? undefined : el('div', {
        display: 'flex', height: '20px', backgroundColor: LINE, borderRadius: '10px', marginTop: '36px',
      }, [
        el('div', {
          display: 'flex', width: `${Math.max(2, score)}%`, height: '20px',
          backgroundColor: tone, borderRadius: '10px',
        }),
      ]),
    ]),
    el('div', { display: 'flex', flexWrap: 'wrap', gap: '14px' },
      chips.map((c) => el('div', {
        display: 'flex', fontSize: '24px', color: INK, backgroundColor: CARD,
        border: `1.5px solid ${LINE}`, borderRadius: '999px', padding: '10px 22px',
      }, c))),
  ]);

  return new ImageResponse(card, {
    width: 1200,
    height: 630,
    fonts: await loadFonts(),
    headers: { 'cache-control': 'public, max-age=86400' },
  });
};

export const config = { path: '/api/og' };

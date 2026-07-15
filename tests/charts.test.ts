// Tests des fonctions de préparation de données des graphes SVG (sans DOM).
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { buildSpectrumPaths, SpectrumChart } from '../src/components/charts/SpectrumChart';
import { buildStepPaths, StepResponseChart } from '../src/components/charts/StepResponseChart';
import { buildTimelineRects, TimelineStrip } from '../src/components/charts/TimelineStrip';
import type { AxisSpectrum, AxisStepResponse, TimelineSegment } from '../src/lib/types';

const W = 600;
const H = 200;

function parsePath(d: string): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  const re = /([ML])(-?[\d.]+),(-?[\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    pts.push({ x: Number(m[2]), y: Number(m[3]) });
  }
  return pts;
}

function makeSpectrum(peakHz: number, n = 2000, fMax = 1000): AxisSpectrum {
  const freqs = new Float32Array(n);
  const mags = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f = (i / (n - 1)) * fMax;
    freqs[i] = f;
    // plancher de bruit + pic gaussien à peakHz
    mags[i] = 0.5 + 50 * Math.exp(-((f - peakHz) ** 2) / (2 * 15 ** 2));
  }
  return {
    bands: [],
    dominantBand: 'test',
    peaks: [{ freqHz: peakHz, mag: 50.5 }],
    freqs,
    mags,
  };
}

function makeStep(peak: number, n = 1001): AxisStepResponse {
  const t = new Float32Array(n);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ts = (i / (n - 1)) * 0.5;
    t[i] = ts;
    // montée linéaire jusqu'au pic à 50 ms (max exactement = peak), puis retour vers 1
    y[i] = ts < 0.05 ? (ts / 0.05) * peak : 1 + (peak - 1) * Math.exp(-(ts - 0.05) / 0.08);
  }
  return {
    t,
    y,
    riseTimeMs: 20,
    peakValue: peak,
    overshootPct: (peak - 1) * 100,
    settleValue: 1,
    quality: 0.9,
  };
}

describe('buildSpectrumPaths', () => {
  const axes: [AxisSpectrum, AxisSpectrum, AxisSpectrum] = [
    makeSpectrum(150),
    makeSpectrum(250),
    makeSpectrum(400),
  ];
  const { paths, ticksX, bands } = buildSpectrumPaths(axes, W, H);

  it('produit 3 chemins SVG valides commençant par M', () => {
    expect(paths).toHaveLength(3);
    for (const p of paths) {
      expect(p.startsWith('M')).toBe(true);
      expect(parsePath(p).length).toBeGreaterThan(10);
    }
  });

  it('downsample à 600 points max par trace', () => {
    for (const p of paths) {
      expect(parsePath(p).length).toBeLessThanOrEqual(600);
    }
  });

  it('garde toutes les coordonnées dans le cadre [0,w]x[0,h]', () => {
    for (const p of paths) {
      for (const pt of parsePath(p)) {
        expect(pt.x).toBeGreaterThanOrEqual(0);
        expect(pt.x).toBeLessThanOrEqual(W + 0.01);
        expect(pt.y).toBeGreaterThanOrEqual(-0.01);
        expect(pt.y).toBeLessThanOrEqual(H + 0.01);
      }
    }
  });

  it('place le pic au bon endroit (250 Hz → x ≈ w/4, y ≈ 0 car pic global partagé)', () => {
    const pts = parsePath(paths[1]);
    let best = pts[0];
    for (const pt of pts) if (pt.y < best.y) best = pt;
    expect(best.x).toBeCloseTo((250 / 1000) * W, -1); // ±5 px
    expect(best.y).toBeLessThan(2); // pic ~= max global → proche du haut
  });

  it('génère les ticks X 0/100/250/500/750/1000', () => {
    expect(ticksX.map((t) => t.label)).toEqual(['0', '100', '250', '500', '750', '1000']);
    expect(ticksX[0].x).toBe(0);
    expect(ticksX[5].x).toBeCloseTo(W, 5);
    expect(ticksX[2].x).toBeCloseTo(0.25 * W, 5);
  });

  it('définit les bandes 40-120 (résonance) et 120-350 (moteurs)', () => {
    expect(bands).toHaveLength(2);
    expect(bands[0].x1).toBeCloseTo((40 / 1000) * W, 5);
    expect(bands[0].x2).toBeCloseTo((120 / 1000) * W, 5);
    expect(bands[0].label).toContain('résonance');
    expect(bands[1].x1).toBeCloseTo((120 / 1000) * W, 5);
    expect(bands[1].x2).toBeCloseTo((350 / 1000) * W, 5);
    expect(bands[1].label).toContain('moteurs');
  });

  it('ignore les fréquences > 1 kHz', () => {
    const wide: [AxisSpectrum, AxisSpectrum, AxisSpectrum] = [
      makeSpectrum(200, 2000, 2000), // moitié des points au-delà de 1 kHz
      makeSpectrum(200, 2000, 2000),
      makeSpectrum(200, 2000, 2000),
    ];
    const r = buildSpectrumPaths(wide, W, H);
    for (const p of r.paths) {
      for (const pt of parsePath(p)) expect(pt.x).toBeLessThanOrEqual(W + 0.01);
    }
  });
});

describe('buildStepPaths', () => {
  it('retourne null à la place d’un axe null, un path M... sinon', () => {
    const { paths } = buildStepPaths([makeStep(1.2), null, makeStep(1.1)], W, H);
    expect(paths).toHaveLength(3);
    expect(paths[0]?.startsWith('M')).toBe(true);
    expect(paths[1]).toBeNull();
    expect(paths[2]?.startsWith('M')).toBe(true);
  });

  it('échelle Y = max(1.5, pic) → cible 1.0 à h/3 quand pic < 1.5', () => {
    const { targetY } = buildStepPaths([makeStep(1.2), null, null], W, H);
    // yMax = 1.5 → targetY = h - h/1.5 = h/3
    expect(targetY).toBeCloseTo(H / 3, 1);
  });

  it('étend l’échelle Y quand le pic dépasse 1.5', () => {
    const { targetY, ticksY } = buildStepPaths([makeStep(2.0), null, null], W, H);
    // yMax = 2 → targetY = h/2
    expect(targetY).toBeCloseTo(H / 2, 1);
    expect(ticksY.map((t) => t.label)).toContain('2');
  });

  it('la ligne cible coïncide avec le tick Y "1"', () => {
    const { targetY, ticksY } = buildStepPaths([makeStep(1.3), makeStep(1.2), makeStep(1.05)], W, H);
    const tick1 = ticksY.find((t) => t.label === '1');
    expect(tick1).toBeDefined();
    expect(tick1?.y).toBeCloseTo(targetY, 5);
  });

  it('génère les ticks X 0..500 ms et des ticks Y de pas 0.5', () => {
    const { ticksX, ticksY } = buildStepPaths([makeStep(1.2), null, null], W, H);
    expect(ticksX.map((t) => t.label)).toEqual(['0', '100', '200', '300', '400', '500']);
    expect(ticksX[5].x).toBeCloseTo(W, 5);
    expect(ticksY.map((t) => t.label)).toEqual(['0', '0.5', '1', '1.5']);
    expect(ticksY[0].y).toBeCloseTo(H, 5);
  });

  it('downsample à 600 points max et reste dans le cadre', () => {
    const big = makeStep(1.4, 5000);
    const { paths } = buildStepPaths([big, big, big], W, H);
    for (const p of paths) {
      const pts = parsePath(p as string);
      expect(pts.length).toBeLessThanOrEqual(601); // stride + dernier point conservé
      for (const pt of pts) {
        expect(pt.x).toBeGreaterThanOrEqual(0);
        expect(pt.x).toBeLessThanOrEqual(W + 0.01);
        expect(pt.y).toBeGreaterThanOrEqual(-0.01);
        expect(pt.y).toBeLessThanOrEqual(H + 0.01);
      }
    }
  });

  it('tous axes null → 3 null et échelle par défaut', () => {
    const { paths, targetY } = buildStepPaths([null, null, null], W, H);
    expect(paths).toEqual([null, null, null]);
    expect(targetY).toBeCloseTo(H / 3, 1);
  });
});

function seg(
  tStart: number,
  tEnd: number,
  state: TimelineSegment['state'],
  vbat: number | null = null,
): TimelineSegment {
  return { tStart, tEnd, state, stickAvg: 0, thrustPct: 0, vbat };
}

describe('buildTimelineRects', () => {
  it('la somme des largeurs ≈ w pour des segments contigus', () => {
    const segments = [seg(0, 10, 'idle'), seg(10, 40, 'flight'), seg(40, 100, 'low')];
    const rects = buildTimelineRects(segments, W);
    expect(rects).toHaveLength(3);
    const total = rects.reduce((acc, r) => acc + r.width, 0);
    expect(total).toBeCloseTo(W, 5);
  });

  it('préserve ordre, états et proportions', () => {
    const segments = [seg(0, 25, 'idle'), seg(25, 75, 'flight'), seg(75, 100, 'low')];
    const rects = buildTimelineRects(segments, W);
    expect(rects.map((r) => r.state)).toEqual(['idle', 'flight', 'low']);
    expect(rects[0].x).toBe(0);
    expect(rects[0].width).toBeCloseTo(0.25 * W, 5);
    expect(rects[1].x).toBeCloseTo(0.25 * W, 5);
    expect(rects[1].width).toBeCloseTo(0.5 * W, 5);
    expect(rects[2].x + rects[2].width).toBeCloseTo(W, 5);
  });

  it('cas dégénérés : vide ou durée nulle → []', () => {
    expect(buildTimelineRects([], W)).toEqual([]);
    expect(buildTimelineRects([seg(5, 5, 'idle')], W)).toEqual([]);
    expect(buildTimelineRects([seg(0, 10, 'idle')], 0)).toEqual([]);
  });
});

describe('composants React (rendu sans DOM : appel direct, structure élément)', () => {
  it('SpectrumChart retourne un <svg> avec viewBox', () => {
    const axes: [AxisSpectrum, AxisSpectrum, AxisSpectrum] = [
      makeSpectrum(150),
      makeSpectrum(250),
      makeSpectrum(400),
    ];
    const el = SpectrumChart({ axes, motorFundamentalHz: 210, title: 'Test' });
    expect(el.type).toBe('svg');
    expect((el.props as { viewBox?: string }).viewBox).toMatch(/^0 0 \d+ \d+$/);
    // sans fondamentale moteur : ne crashe pas
    expect(SpectrumChart({ axes, motorFundamentalHz: null }).type).toBe('svg');
  });

  it('StepResponseChart retourne un <svg> même avec tous les axes null', () => {
    const el = StepResponseChart({ axes: [makeStep(1.2), null, null] });
    expect(el.type).toBe('svg');
    expect(StepResponseChart({ axes: [null, null, null] }).type).toBe('svg');
  });

  it('TimelineStrip retourne un <svg>, avec ou sans vbat/segments', () => {
    const segments = [seg(0, 10, 'idle', 16.8), seg(10, 60, 'flight', 15.9), seg(60, 90, 'low', 14.6)];
    expect(TimelineStrip({ segments, durationS: 90 }).type).toBe('svg');
    expect(TimelineStrip({ segments: [], durationS: 0 }).type).toBe('svg');
  });

  it('le markup statique est un SVG valide, sans NaN ni Infinity', async () => {
    const axes: [AxisSpectrum, AxisSpectrum, AxisSpectrum] = [
      makeSpectrum(215),
      makeSpectrum(215),
      makeSpectrum(430),
    ];
    const segments = [
      seg(0, 8, 'idle', 16.8),
      seg(8, 95, 'flight', 15.7),
      seg(95, 110, 'low', 14.9),
      seg(110, 180, 'flight', 14.3),
    ];
    const markups: Array<[string, string]> = [
      ['spectrum', renderToStaticMarkup(createElement(SpectrumChart, { axes, motorFundamentalHz: 214 }))],
      ['step', renderToStaticMarkup(createElement(StepResponseChart, { axes: [makeStep(1.25), makeStep(1.1), null] }))],
      ['timeline', renderToStaticMarkup(createElement(TimelineStrip, { segments, durationS: 180 }))],
    ];
    for (const [name, svg] of markups) {
      expect(svg.startsWith('<svg'), `${name} doit produire un <svg>`).toBe(true);
      expect(svg.includes('NaN'), `${name} contient NaN`).toBe(false);
      expect(svg.includes('Infinity'), `${name} contient Infinity`).toBe(false);
    }
    if (process.env.DUMP_SVG) {
      const { writeFile } = await import('node:fs/promises');
      for (const [name, svg] of markups) {
        await writeFile(
          `${process.env.DUMP_SVG}/${name}.html`,
          `<!doctype html><body style="background:#111;margin:0"><div style="width:660px;padding:10px">${svg}</div></body>`,
        );
      }
    }
  });
});

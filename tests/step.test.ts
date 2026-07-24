// Tests de la step response (déconvolution de Wiener, méthode Plasmatree).
// D'abord des systèmes synthétiques à réponse connue (seed fixe, reproductible),
// puis un sanity check sur un log réel (pas de golden pour la step).
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

import { analyzeStepResponse } from '../src/lib/analysis/step';
import { initWasm, parseFile } from '../src/lib/bbl/parse';
import type { F32x3, FlightData } from '../src/lib/types';

const CHIMERA = '/home/rviau/projects/drones/chimera/blackbox/btfl_016.bbl';

// ---------------------------------------------------------------------------
// Générateurs synthétiques déterministes
// ---------------------------------------------------------------------------

/** PRNG mulberry32 — seed fixe, reproductible (pas de Math.random). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Séquence d'échelons pseudo-aléatoires ±100 deg/s, paliers de 100-400 ms. */
function stepSequence(n: number, fs: number, rand: () => number): Float32Array {
  const x = new Float32Array(n);
  let i = 0;
  while (i < n) {
    const hold = Math.max(1, Math.round((0.1 + 0.3 * rand()) * fs));
    const level = (rand() * 2 - 1) * 100;
    for (let k = 0; k < hold && i < n; k++, i++) x[i] = level;
  }
  return x;
}

/** 1er ordre discret : y[n] = a·y[n-1] + (1-a)·x[n], a = exp(-1/(fs·tau)). */
function firstOrder(x: Float32Array, fs: number, tauS: number): Float32Array {
  const a = Math.exp(-1 / (fs * tauS));
  const y = new Float32Array(x.length);
  let prev = 0;
  for (let i = 0; i < x.length; i++) {
    prev = a * prev + (1 - a) * x[i];
    y[i] = prev;
  }
  return y;
}

/** 2e ordre sous-amorti (Euler) : ÿ = wn²(x-y) - 2ζwn·ẏ. */
function secondOrder(x: Float32Array, fs: number, wn: number, zeta: number): Float32Array {
  const dt = 1 / fs;
  const y = new Float32Array(x.length);
  let pos = 0;
  let vel = 0;
  for (let i = 0; i < x.length; i++) {
    const acc = wn * wn * (x[i] - pos) - 2 * zeta * wn * vel;
    vel += acc * dt;
    pos += vel * dt;
    y[i] = pos;
  }
  return y;
}

/** FlightData minimal pour analyzeStepResponse (setpoint + gyro + fs). */
function makeFd(fs: number, setpoint: F32x3, gyro: F32x3): FlightData {
  const n = setpoint[0].length;
  const time = new Float64Array(n);
  for (let i = 0; i < n; i++) time[i] = i / fs;
  const z = () => new Float32Array(n);
  return {
    meta: {
      index: 0,
      fileName: 'synthetic.bbl',
      firmware: 'Betaflight synthetic',
      fieldNames: [],
      sampleRateHz: fs,
      durationS: n / fs,
      frameCount: n,
      motorOutputLow: 48,
      motorOutputHigh: 2047,
      headers: {},
    },
    time,
    gyro,
    gyroUnfilt: null,
    setpoint,
    throttle: z(),
    motor: [z(), z(), z(), z()],
    erpm: null,
    escRpm: null,
    temps: null,
    vbat: null,
    amperage: null,
    baroAlt: null,
    axisP: null,
    axisI: null,
    axisD: null,
    axisF: null,
    gps: null,
    failsafePhaseCounts: {},
  };
}

// ---------------------------------------------------------------------------
// Systèmes synthétiques
// ---------------------------------------------------------------------------

describe('analyzeStepResponse — synthétique', () => {
  const FS = 2000;
  const N = 30 * FS; // 30 s

  it('1er ordre tau=20 ms : riseTime ≈ 2.197·tau, pas d’overshoot, settle ≈ 1', () => {
    const tau = 0.02;
    const x = stepSequence(N, FS, mulberry32(42));
    const y = firstOrder(x, FS, tau);
    const quiet = new Float32Array(N); // yaw sans excitation → axe null
    const fd = makeFd(FS, [x, x, quiet], [y, y, quiet]);

    const res = analyzeStepResponse(fd);
    expect(res).not.toBeNull();
    const roll = res!.axes[0];
    expect(roll).not.toBeNull();

    expect(roll!.quality).toBeGreaterThan(0.5);
    expect(roll!.t.length).toBe(roll!.y.length);
    expect(roll!.t[roll!.t.length - 1]).toBeCloseTo(0.5, 2);

    const expectedRiseMs = 2.197 * tau * 1000; // 43.9 ms (10→90 %)
    expect(roll!.riseTimeMs).not.toBeNull();
    expect(roll!.riseTimeMs!).toBeGreaterThan(expectedRiseMs * 0.75);
    expect(roll!.riseTimeMs!).toBeLessThan(expectedRiseMs * 1.25);

    expect(roll!.settleValue).not.toBeNull();
    expect(roll!.settleValue!).toBeGreaterThan(0.9);
    expect(roll!.settleValue!).toBeLessThan(1.1);

    // 1er ordre = pas d'overshoot (tolérance déconvolution < 5 %).
    expect(roll!.overshootPct ?? 0).toBeLessThan(5);

    // Pitch identique à roll (mêmes signaux).
    expect(res!.axes[1]).not.toBeNull();
    expect(res!.axes[1]!.riseTimeMs!).toBeCloseTo(roll!.riseTimeMs!, 3);

    // Yaw jamais excité → axe null.
    expect(res!.axes[2]).toBeNull();
  });

  it('2e ordre sous-amorti (zeta=0.5, 15 Hz) : overshoot détecté entre 8 et 30 %', () => {
    const x = stepSequence(N, FS, mulberry32(1337));
    const y = secondOrder(x, FS, 2 * Math.PI * 15, 0.5);
    const fd = makeFd(FS, [x, x, x], [y, y, y]);

    const res = analyzeStepResponse(fd);
    expect(res).not.toBeNull();
    const roll = res!.axes[0];
    expect(roll).not.toBeNull();

    // Overshoot théorique continu : exp(-πζ/√(1-ζ²)) ≈ 16.3 %.
    expect(roll!.overshootPct).not.toBeNull();
    expect(roll!.overshootPct!).toBeGreaterThan(8);
    expect(roll!.overshootPct!).toBeLessThan(30);

    expect(roll!.peakValue).not.toBeNull();
    expect(roll!.peakValue!).toBeGreaterThan(1);
    expect(roll!.settleValue!).toBeGreaterThan(0.9);
    expect(roll!.settleValue!).toBeLessThan(1.1);
  });

  it('réponse pathologique (gain ~0.05) : métriques null mais courbe conservée', () => {
    const x = stepSequence(N, FS, mulberry32(99));
    const raw = firstOrder(x, FS, 0.02);
    const y = new Float32Array(N);
    for (let i = 0; i < N; i++) y[i] = 0.05 * raw[i]; // le gyro ne suit presque pas
    const fd = makeFd(FS, [x, x, x], [y, y, y]);

    const res = analyzeStepResponse(fd);
    expect(res).not.toBeNull();
    const roll = res!.axes[0];
    expect(roll).not.toBeNull();
    expect(roll!.quality).toBeGreaterThan(0);
    expect(roll!.t.length).toBeGreaterThan(0); // la courbe reste affichable
    expect(roll!.riseTimeMs).toBeNull();
    expect(roll!.peakValue).toBeNull();
    expect(roll!.overshootPct).toBeNull();
    expect(roll!.settleValue).toBeNull();
  });

  it('vol trop court (< 20 s) → null', () => {
    const n = 10 * FS;
    const x = stepSequence(n, FS, mulberry32(7));
    const y = firstOrder(x, FS, 0.02);
    const fd = makeFd(FS, [x, x, x], [y, y, y]);
    expect(analyzeStepResponse(fd)).toBeNull();
  });

  // Ms = max|1-T| a une valeur ANALYTIQUE sur un 2e ordre, ce qui en fait le
  // seul indicateur du module vérifiable autrement que par comparaison :
  //   |S(u)| = u·√(u²+4ζ²) / √((1-u²)² + 4ζ²u²),  u = w/wn
  it.each([
    { zeta: 0.5, fn: 15, msTheory: 1.468, fTheory: 17.5, seed: 1337 },
    { zeta: 0.3, fn: 20, msTheory: 1.995, fTheory: 21.5, seed: 2024 },
  ])('Ms retrouve la théorie sur un 2e ordre (zeta=$zeta, $fn Hz)', (c) => {
    const x = stepSequence(N, FS, mulberry32(c.seed));
    const y = secondOrder(x, FS, 2 * Math.PI * c.fn, c.zeta);
    const roll = analyzeStepResponse(makeFd(FS, [x, x, x], [y, y, y]))!.axes[0];

    expect(roll!.ms).not.toBeNull();
    // 10 % de marge : le lissage ±1.5 Hz rabote un peu le pic (toujours vers le
    // bas), et le système de référence est intégré en Euler.
    expect(roll!.ms!).toBeGreaterThan(c.msTheory * 0.9);
    expect(roll!.ms!).toBeLessThan(c.msTheory * 1.1);
    expect(roll!.msFreqHz!).toBeGreaterThan(c.fTheory * 0.8);
    expect(roll!.msFreqHz!).toBeLessThan(c.fTheory * 1.2);
    // Mt = max|T| : > 0 dB dès qu'il y a résonance, et croît quand ζ baisse.
    expect(roll!.mtDb!).toBeGreaterThan(0);
  });

  it('1er ordre : aucun Ms publié, parce que max|S| n’y dépasse jamais 1', () => {
    const x = stepSequence(N, FS, mulberry32(4242));
    const y = firstOrder(x, FS, 0.02);
    const roll = analyzeStepResponse(makeFd(FS, [x, x, x], [y, y, y]))!.axes[0];

    // Une boucle du 1er ordre n'amplifie rien : |S| monte vers 1 sans jamais le
    // franchir. Publier « Ms = 0.8 » laisserait croire à une mesure alors que
    // c'est une non-mesure - le plancher théorique Ms ≥ 1 l'interdit.
    expect(roll!.settleValue).not.toBeNull(); // la courbe, elle, reste exploitable
    expect(roll!.ms).toBeNull();
    expect(roll!.msFreqHz).toBeNull();
    expect(roll!.msBandTopHz).toBeNull();
  });

  it('courbe pathologique : pas de Ms non plus', () => {
    const x = stepSequence(N, FS, mulberry32(99));
    const raw = secondOrder(x, FS, 2 * Math.PI * 15, 0.5);
    const y = new Float32Array(N);
    for (let i = 0; i < N; i++) y[i] = 0.05 * raw[i];
    const roll = analyzeStepResponse(makeFd(FS, [x, x, x], [y, y, y]))!.axes[0];

    expect(roll!.settleValue).toBeNull();
    expect(roll!.ms).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Log réel (sanity, pas golden)
// ---------------------------------------------------------------------------

describe('analyzeStepResponse — log réel chimera', () => {
  let fd: FlightData;

  beforeAll(async () => {
    await initWasm(await readFile(new URL('../public/blackbox-log.wasm', import.meta.url)));
    const pf = await parseFile('btfl_016.bbl', new Uint8Array(await readFile(CHIMERA)));
    fd = pf.sessions[0];
  });

  it('les 3 axes produisent une courbe plausible', () => {
    const res = analyzeStepResponse(fd);
    expect(res).not.toBeNull();

    for (let a = 0; a < 3; a++) {
      const ax = res!.axes[a as 0 | 1 | 2];
      expect(ax, `axe ${a}`).not.toBeNull();
      expect(ax!.quality).toBeGreaterThan(0);
      expect(ax!.quality).toBeLessThanOrEqual(1);
      expect(ax!.t.length).toBeGreaterThan(0);
      expect(ax!.y.length).toBe(ax!.t.length);
      expect(ax!.riseTimeMs).not.toBeNull();
      expect(ax!.riseTimeMs!).toBeGreaterThan(5);
      expect(ax!.riseTimeMs!).toBeLessThan(200);
      expect(ax!.settleValue).not.toBeNull();
      expect(ax!.settleValue!).toBeGreaterThan(0.7);
      expect(ax!.settleValue!).toBeLessThan(1.3);
    }
  });
});

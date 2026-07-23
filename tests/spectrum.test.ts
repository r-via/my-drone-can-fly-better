// Tests du module spectre + filtres contre le golden chimera_016.txt
// (sortie de analyze_shimera.py) et sur des signaux synthétiques.
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

import { analyzeFilters, analyzeSpectrum } from '../src/lib/analysis/spectrum';
import { initWasm, parseFile } from '../src/lib/bbl/parse';
import type { F32x3, FlightData, SessionMeta, SpectrumMetrics } from '../src/lib/types';

const CHIMERA = '/home/rviau/projects/drones/chimera/blackbox/btfl_016.bbl';
const CHIMERA_POLES = 14;

// Valeurs du golden tests/golden/chimera_016.txt (entiers arrondis par le script python).
const GOLDEN = {
  motorFundamentalHz: 138,
  perMotor: [
    { median: 130, p90: 169 },
    { median: 141, p90: 178 },
    { median: 137, p90: 168 },
    { median: 142, p90: 184 },
  ],
  dominantPeak: { freqHz: 137, axis: 1 as const, nearestMotor: 2, distanceHz: 1 },
  axes: [
    // Roll
    {
      peaks: [183, 162, 118, 175, 151],
      mags: [1467, 1422, 1391, 1390, 1254],
      bands: [433, 298, 605, 121],
    },
    // Pitch
    {
      peaks: [137, 147, 158, 129, 166],
      mags: [4792, 4453, 3522, 3302, 2411],
      bands: [458, 336, 1541, 86],
    },
    // Yaw
    {
      peaks: [183, 165, 175, 118, 150],
      mags: [2896, 2563, 2499, 2292, 2185],
      bands: [127, 502, 1010, 69],
    },
  ],
};

// Le parseur WASM (blackbox-log 0.2.2) décode les P-frames gyroUnfilt avec une
// petite dérive (marche aléatoire ±1-3 deg/s remise à zéro à chaque I-frame,
// vérifié vs orangebox : sauts anormalement petits juste après les I-frames,
// snap-back à l'I-frame suivante). L'énergie de cet artefact est concentrée
// < 5 Hz et déborde dans la bande 5-40 Hz (+19/+54/+188 % vs golden) et un peu
// dans 40-120 Hz (+3/+9/+1 %). Les bandes ≥ 120 Hz et les pics sont intacts.
// Pour ces deux bandes basses on vérifie donc contre la référence exacte :
// les maths de analyze_shimera.py (numpy) appliquées AUX MÊMES données parsées
// par le WASM — ce qui valide fidèlement le portage DSP. Le golden reste la
// cible pour tout le reste. À resserrer si le parseur upstream est corrigé.
const LOW_BANDS_SAME_PARSE_REF = [
  [517, 306], // Roll  [5-40, 40-120]
  [704, 365], // Pitch
  [366, 509], // Yaw
];

let chimera: FlightData;
let sm: SpectrumMetrics;

beforeAll(async () => {
  await initWasm(await readFile(new URL('../public/blackbox-log.wasm', import.meta.url)));
  chimera = (await parseFile('btfl_016.bbl', new Uint8Array(await readFile(CHIMERA)))).sessions[0];
  const result = analyzeSpectrum(chimera, CHIMERA_POLES);
  if (!result) throw new Error('analyzeSpectrum ne doit pas retourner null sur chimera');
  sm = result;
}, 120000);

// ---------------------------------------------------------------------------
// Fabrique de FlightData synthétique
// ---------------------------------------------------------------------------

function zeros3(n: number): F32x3 {
  return [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
}

function makeMeta(n: number, fsHz: number): SessionMeta {
  return {
    index: 0,
    fileName: 'synthetic.bbl',
    firmware: 'Betaflight test',
    fieldNames: [],
    sampleRateHz: fsHz,
    durationS: n / fsHz,
    frameCount: n,
    motorOutputLow: 48,
    motorOutputHigh: 2047,
    headers: {},
  };
}

/** Session synthétique : sinus `freqHz` d'amplitude ampUnfilt (brut) / ampFilt (filtré) sur Roll. */
function makeFd(opts: { n: number; fsHz: number; freqHz: number; ampUnfilt: number | null; ampFilt: number }): FlightData {
  const { n, fsHz, freqHz, ampUnfilt, ampFilt } = opts;
  const time = new Float64Array(n);
  const gyro = zeros3(n);
  const gyroUnfilt = ampUnfilt !== null ? zeros3(n) : null;
  for (let i = 0; i < n; i++) {
    const t = i / fsHz;
    time[i] = t;
    const s = Math.sin(2 * Math.PI * freqHz * t);
    gyro[0][i] = ampFilt * s;
    if (gyroUnfilt && ampUnfilt !== null) gyroUnfilt[0][i] = ampUnfilt * s;
  }
  return {
    meta: makeMeta(n, fsHz),
    time,
    gyro,
    gyroUnfilt,
    setpoint: zeros3(n),
    throttle: new Float32Array(n).fill(1500),
    motor: [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)],
    erpm: null,
    escRpm: null,
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
// Golden chimera_016 — spectre
// ---------------------------------------------------------------------------

describe('analyzeSpectrum — golden chimera_016', () => {
  it('utilise le gyro non-filtré comme source', () => {
    expect(sm.source).toBe('unfilt');
    expect(sm.motorPolesAssumed).toBe(CHIMERA_POLES);
  });

  it('fondamentale moteur médiane ≈ 138 Hz', () => {
    expect(sm.motorFundamentalHz).not.toBeNull();
    expect(Math.abs(sm.motorFundamentalHz! - GOLDEN.motorFundamentalHz)).toBeLessThanOrEqual(1);
  });

  it('rotation par moteur (médiane/p90) conforme au golden (±1 Hz)', () => {
    expect(sm.perMotorHz).not.toBeNull();
    for (let m = 0; m < 4; m++) {
      expect(Math.abs(sm.perMotorHz![m].median - GOLDEN.perMotor[m].median)).toBeLessThanOrEqual(1);
      expect(Math.abs(sm.perMotorHz![m].p90 - GOLDEN.perMotor[m].p90)).toBeLessThanOrEqual(1);
    }
  });

  it('pic dominant global attribué au même moteur que le golden', () => {
    expect(sm.dominantPeak).not.toBeNull();
    const dp = sm.dominantPeak!;
    expect(Math.abs(dp.freqHz - GOLDEN.dominantPeak.freqHz)).toBeLessThanOrEqual(2);
    expect(dp.axis).toBe(GOLDEN.dominantPeak.axis); // Pitch
    expect(dp.nearestMotor).toBe(GOLDEN.dominantPeak.nearestMotor); // M3 (0-based)
    expect(Math.abs(dp.distanceHz - GOLDEN.dominantPeak.distanceHz)).toBeLessThanOrEqual(2);
  });

  it('top 5 pics par axe : fréquences ±2 Hz, magnitudes ±2 %', () => {
    for (let a = 0; a < 3; a++) {
      const axis = sm.axes[a];
      const g = GOLDEN.axes[a];
      expect(axis.peaks.length).toBe(5);
      for (let p = 0; p < 5; p++) {
        expect(Math.abs(axis.peaks[p].freqHz - g.peaks[p])).toBeLessThanOrEqual(2);
        // ±2 % relatif + 0.5 de marge d'arrondi (le golden imprime des entiers)
        expect(Math.abs(axis.peaks[p].mag - g.mags[p])).toBeLessThanOrEqual(g.mags[p] * 0.02 + 0.5);
      }
    }
  });

  it('bandes RMS par axe ±5 %, dominante = plage moteur', () => {
    for (let a = 0; a < 3; a++) {
      const axis = sm.axes[a];
      const g = GOLDEN.axes[a];
      expect(axis.bands.length).toBe(4);
      expect(axis.bands.map((b) => [b.lo, b.hi])).toEqual([
        [5, 40],
        [40, 120],
        [120, 350],
        [350, 900],
      ]);
      // Bandes basses : référence numpy sur les mêmes données parsées
      // (cf. commentaire LOW_BANDS_SAME_PARSE_REF — artefact du parseur WASM).
      for (let b = 0; b < 2; b++) {
        const ref = LOW_BANDS_SAME_PARSE_REF[a][b];
        expect(Math.abs(axis.bands[b].rms - ref)).toBeLessThanOrEqual(ref * 0.05 + 0.5);
      }
      // Bandes ≥ 120 Hz : golden orangebox ±5 %.
      for (let b = 2; b < 4; b++) {
        expect(Math.abs(axis.bands[b].rms - g.bands[b])).toBeLessThanOrEqual(g.bands[b] * 0.05 + 0.5);
      }
      expect(axis.dominantBand).toBe('plage moteur 120-350Hz');
    }
  });

  it('les tableaux du graphe sont bornés (≤ 1 kHz, ≤ 512 points)', () => {
    for (const axis of sm.axes) {
      expect(axis.freqs.length).toBeGreaterThan(0);
      expect(axis.freqs.length).toBeLessThanOrEqual(512);
      expect(axis.mags.length).toBe(axis.freqs.length);
      expect(axis.freqs[axis.freqs.length - 1]).toBeLessThanOrEqual(1000);
      // fréquences croissantes
      for (let i = 1; i < axis.freqs.length; i++) {
        expect(axis.freqs[i]).toBeGreaterThan(axis.freqs[i - 1]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Golden chimera_016 — filtres
// ---------------------------------------------------------------------------

describe('analyzeFilters — chimera_016', () => {
  it('mesure une atténuation positive dans la plage moteur', () => {
    const fm = analyzeFilters(chimera);
    expect(fm.available).toBe(true);
    expect(fm.axes).not.toBeNull();
    for (const axis of fm.axes!) {
      expect(axis.attenuationDb.map((b) => [b.lo, b.hi])).toEqual([
        [40, 120],
        [120, 350],
        [350, 900],
      ]);
      for (const b of axis.attenuationDb) expect(Number.isFinite(b.db)).toBe(true);
      // Le filtrage BF écrase la plage moteur (bruit 7-13 brut → ~1 filtré au golden).
      expect(axis.attenuationDb[1].db).toBeGreaterThan(6);
      expect(axis.residualHfRms).toBeGreaterThan(0);
      expect(Number.isFinite(axis.residualHfRms)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Synthétique
// ---------------------------------------------------------------------------

describe('signaux synthétiques', () => {
  it('sinus 80 Hz atténué ×10 → attenuationDb 40-120 ≈ 20 dB ±1', () => {
    const fd = makeFd({ n: 8192, fsHz: 2000, freqHz: 80, ampUnfilt: 10, ampFilt: 1 });
    const fm = analyzeFilters(fd);
    expect(fm.available).toBe(true);
    const roll = fm.axes![0];
    const band = roll.attenuationDb.find((b) => b.lo === 40 && b.hi === 120)!;
    expect(Math.abs(band.db - 20)).toBeLessThanOrEqual(1);
  });

  it('le spectre trouve le pic à 80 Hz et la bande châssis dominante', () => {
    const fd = makeFd({ n: 8192, fsHz: 2000, freqHz: 80, ampUnfilt: 10, ampFilt: 1 });
    const result = analyzeSpectrum(fd, CHIMERA_POLES);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('unfilt');
    const roll = result!.axes[0];
    expect(roll.peaks.length).toBeGreaterThan(0);
    expect(Math.abs(roll.peaks[0].freqHz - 80)).toBeLessThanOrEqual(1);
    expect(roll.dominantBand).toBe('résonance châssis 40-120Hz');
    // Pas d'eRPM → pas d'attribution moteur
    expect(result!.perMotorHz).toBeNull();
    expect(result!.motorFundamentalHz).toBeNull();
    expect(result!.dominantPeak).toBeNull();
  });

  it('session trop courte (< 2048 échantillons) → null', () => {
    const fd = makeFd({ n: 1000, fsHz: 2000, freqHz: 80, ampUnfilt: 10, ampFilt: 1 });
    expect(analyzeSpectrum(fd, CHIMERA_POLES)).toBeNull();
  });

  it('pas de gyroUnfilt → filtres indisponibles, spectre sur le gyro filtré', () => {
    const fd = makeFd({ n: 8192, fsHz: 2000, freqHz: 80, ampUnfilt: null, ampFilt: 5 });
    const fm = analyzeFilters(fd);
    expect(fm.available).toBe(false);
    expect(fm.axes).toBeNull();
    const result = analyzeSpectrum(fd, CHIMERA_POLES);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('filt');
    expect(Math.abs(result!.axes[0].peaks[0].freqHz - 80)).toBeLessThanOrEqual(1);
  });
});

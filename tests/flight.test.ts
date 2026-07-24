import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

import { analyzePropwash, analyzeYoyo } from '../src/lib/analysis/flight';
import { initWasm, parseFile } from '../src/lib/bbl/parse';
import type { F32x3, F32x4, FlightData, SessionMeta } from '../src/lib/types';

const PICO = '/home/rviau/projects/drones/pavo pico/btfl_002.bbl';
const CHIMERA = '/home/rviau/projects/drones/chimera/blackbox/btfl_016.bbl';
const GOLDEN_PICO = new URL('./golden/pico_002.txt', import.meta.url);

let pico: FlightData;
let chimera: FlightData;

beforeAll(async () => {
  await initWasm(await readFile(new URL('../public/blackbox-log.wasm', import.meta.url)));
  pico = (await parseFile('btfl_002.bbl', new Uint8Array(await readFile(PICO)))).sessions[0];
  chimera = (await parseFile('btfl_016.bbl', new Uint8Array(await readFile(CHIMERA)))).sessions[0];
});

// ---------------------------------------------------------------------------
// Fabrique de FlightData synthétiques
// ---------------------------------------------------------------------------

function makeMeta(n: number, fs: number): SessionMeta {
  return {
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
  };
}

interface SynthOpts {
  durS?: number;
  fs?: number;
  throttle?: (t: number) => number;
  motor?: (t: number) => number; // même valeur pour les 4 moteurs
  gyroRoll?: (t: number) => number;
  gyroPitch?: (t: number) => number;
  baroAlt?: (t: number) => number;
}

function makeFd(opts: SynthOpts = {}): FlightData {
  const fs = opts.fs ?? 1000;
  const durS = opts.durS ?? 10;
  const n = Math.round(durS * fs);
  const time = new Float64Array(n);
  const throttle = new Float32Array(n);
  const baro = opts.baroAlt ? new Float32Array(n) : null;
  const gyro: F32x3 = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const setpoint: F32x3 = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const motor: F32x4 = [
    new Float32Array(n),
    new Float32Array(n),
    new Float32Array(n),
    new Float32Array(n),
  ];
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    time[i] = t;
    throttle[i] = opts.throttle ? opts.throttle(t) : 1500;
    const m = opts.motor ? opts.motor(t) : 1000;
    for (let k = 0; k < 4; k++) motor[k][i] = m;
    gyro[0][i] = opts.gyroRoll ? opts.gyroRoll(t) : 0;
    gyro[1][i] = opts.gyroPitch ? opts.gyroPitch(t) : 0;
    if (baro && opts.baroAlt) baro[i] = opts.baroAlt(t);
  }
  return {
    meta: makeMeta(n, fs),
    time,
    gyro,
    gyroUnfilt: null,
    setpoint,
    throttle,
    motor,
    erpm: null,
    escRpm: null,
    temps: null,
    vbat: null,
    amperage: null,
    baroAlt: baro,
    axisP: null,
    axisI: null,
    axisD: null,
    axisF: null,
    gps: null,
    failsafePhaseCounts: {},
  };
}

// ---------------------------------------------------------------------------
// YOYO — golden pico session 1
// ---------------------------------------------------------------------------

describe('analyzeYoyo — golden pico_002 session 1', () => {
  it('reproduit le ratio et le verdict du golden (±0.1)', async () => {
    const golden = await readFile(GOLDEN_PICO, 'utf8');
    const m = golden.match(/YOYO \(poussee\) :.*-> ratio ([\d.]+)\s+\[(YOYO probable|poussee stable)\]/);
    expect(m).not.toBeNull();
    const goldenRatio = parseFloat(m![1]);
    const goldenVerdict = m![2] === 'YOYO probable' ? 'yoyo' : 'stable';

    const y = analyzeYoyo(pico);
    expect(y.applicable).toBe(true);
    expect(y.ratio).not.toBeNull();
    expect(y.ratio!).toBeGreaterThan(goldenRatio - 0.1);
    expect(y.ratio!).toBeLessThan(goldenRatio + 0.1);
    expect(y.verdict).toBe(goldenVerdict);

    expect(y.peaks.length).toBeGreaterThan(0);
    expect(y.peaks.length).toBeLessThanOrEqual(5);
    for (const p of y.peaks) {
      expect(p.freqHz).toBeGreaterThanOrEqual(0.5);
      expect(p.freqHz).toBeLessThanOrEqual(20);
      expect(p.mag).toBeGreaterThanOrEqual(0);
    }
    // Triés par magnitude décroissante.
    for (let i = 1; i < y.peaks.length; i++) {
      expect(y.peaks[i].mag).toBeLessThanOrEqual(y.peaks[i - 1].mag);
    }
  });
});

describe('analyzeYoyo — synthétiques', () => {
  it("pas applicable si le drone ne vole pas (throttle <= 1100)", () => {
    const y = analyzeYoyo(makeFd({ throttle: () => 1000 }));
    expect(y).toEqual({ applicable: false, ratio: null, verdict: null, peaks: [] });
  });

  it('ratio null (verdict null) si le stick est figé', () => {
    const y = analyzeYoyo(makeFd({ motor: (t) => 1000 + 100 * Math.sin(2 * Math.PI * t) }));
    expect(y.applicable).toBe(true);
    expect(y.ratio).toBeNull();
    expect(y.verdict).toBeNull();
  });

  it('détecte un yoyo à 1 Hz : ratio élevé + pic dominant à ~1 Hz', () => {
    const y = analyzeYoyo(
      makeFd({
        throttle: (t) => 1500 + 10 * Math.sin(2 * Math.PI * 0.05 * t),
        motor: (t) => 1000 + 100 * Math.sin(2 * Math.PI * 1 * t),
      }),
    );
    expect(y.applicable).toBe(true);
    expect(y.ratio!).toBeGreaterThan(1.3);
    expect(y.verdict).toBe('yoyo');
    expect(Math.abs(y.peaks[0].freqHz - 1.0)).toBeLessThanOrEqual(0.25);
  });
});

// ---------------------------------------------------------------------------
// PROP WASH — synthétiques
// ---------------------------------------------------------------------------

describe('analyzePropwash — synthétiques', () => {
  it('détecte une descente baro à -3 m/s avec erreur gyro oscillante', () => {
    const inDescent = (t: number) => t >= 4 && t < 6;
    const fd = makeFd({
      baroAlt: (t) => (t < 4 ? 20 : t < 6 ? 20 - 3 * (t - 4) : 14),
      // Oscillation prop wash 10 Hz (sous la coupure 40 Hz), setpoint à 0.
      gyroRoll: (t) => (inDescent(t) ? 30 * Math.sin(2 * Math.PI * 10 * t) : 0),
    });
    const p = analyzePropwash(fd);
    expect(p.applicable).toBe(true);
    expect(p.events.length).toBe(1);
    const ev = p.events[0];
    expect(ev.severity).toBeGreaterThan(0);
    // RMS attendu ≈ 30/2 (roll seul, pitch nul) moins l'atténuation du lissage.
    expect(ev.severity).toBeGreaterThan(8);
    expect(ev.severity).toBeLessThan(20);
    expect(ev.tStart).toBeGreaterThan(3.6);
    expect(ev.tStart).toBeLessThan(4.4);
    expect(ev.tEnd).toBeGreaterThan(5.6);
    expect(ev.tEnd).toBeLessThan(6.4);
    expect(p.worstSeverity).toBe(ev.severity);
    expect(p.avgSeverity).toBe(ev.severity);
  });

  it('sans baro : heuristique chute de throttle (1600 → 1100)', () => {
    const drop = (t: number) => t >= 5 && t < 6;
    const fd = makeFd({
      throttle: (t) => (drop(t) ? 1100 : 1600),
      gyroPitch: (t) => (drop(t) ? 50 * Math.sin(2 * Math.PI * 5 * t) : 0),
    });
    const p = analyzePropwash(fd);
    expect(p.applicable).toBe(true);
    expect(p.events.length).toBe(1);
    expect(p.events[0].severity).toBeGreaterThan(0);
    expect(p.events[0].tStart).toBeGreaterThan(4.8);
    expect(p.events[0].tStart).toBeLessThan(5.2);
  });

  it('pas applicable sans aucune descente', () => {
    const p = analyzePropwash(makeFd({ throttle: () => 1500 }));
    expect(p).toEqual({ applicable: false, events: [], worstSeverity: null, avgSeverity: null });
  });

  it('fusionne deux descentes séparées de moins de 0.5 s', () => {
    const fd = makeFd({
      baroAlt: (t) => {
        // Descente 3→5 s, palier 0.3 s, descente 5.3→7 s.
        if (t < 3) return 30;
        if (t < 5) return 30 - 3 * (t - 3);
        if (t < 5.3) return 24;
        if (t < 7) return 24 - 3 * (t - 5.3);
        return 24 - 3 * 1.7;
      },
    });
    const p = analyzePropwash(fd);
    expect(p.applicable).toBe(true);
    expect(p.events.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Logs réels — smoke tests (pas de crash, résultats cohérents)
// ---------------------------------------------------------------------------

describe('logs réels — chimera btfl_016', () => {
  it('analyzeYoyo tourne et rend un résultat cohérent', () => {
    const y = analyzeYoyo(chimera);
    expect(typeof y.applicable).toBe('boolean');
    if (y.applicable && y.ratio !== null) {
      expect(y.ratio).toBeGreaterThan(0);
      expect(['stable', 'yoyo']).toContain(y.verdict);
    }
    expect(Array.isArray(y.peaks)).toBe(true);
    expect(y.peaks.length).toBeLessThanOrEqual(5);
  });

  it('analyzePropwash tourne et rend un résultat cohérent', () => {
    const p = analyzePropwash(chimera);
    expect(typeof p.applicable).toBe('boolean');
    expect(Array.isArray(p.events)).toBe(true);
    expect(p.events.length).toBeLessThanOrEqual(10);
    if (p.applicable) {
      expect(p.events.length).toBeGreaterThan(0);
      expect(p.worstSeverity).not.toBeNull();
      expect(p.avgSeverity).not.toBeNull();
      expect(p.worstSeverity!).toBeGreaterThanOrEqual(p.avgSeverity! - 1e-9);
      for (let i = 1; i < p.events.length; i++) {
        expect(p.events[i].severity).toBeLessThanOrEqual(p.events[i - 1].severity);
      }
      for (const ev of p.events) {
        expect(ev.tEnd).toBeGreaterThanOrEqual(ev.tStart);
        expect(Number.isFinite(ev.severity)).toBe(true);
      }
    } else {
      expect(p.events.length).toBe(0);
      expect(p.worstSeverity).toBeNull();
      expect(p.avgSeverity).toBeNull();
    }
  });

  it('analyzePropwash tourne aussi sur le pico (sans baro exploitable ou avec)', () => {
    const p = analyzePropwash(pico);
    expect(typeof p.applicable).toBe('boolean');
    expect(Array.isArray(p.events)).toBe(true);
  });
});

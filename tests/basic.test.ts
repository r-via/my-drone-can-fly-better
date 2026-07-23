// Tests des analyses de base contre les goldens des scripts python
// (tests/golden/*.txt). Tolérances : ±2 % sur les RMS/moyennes (+ demi-pas
// d'affichage du golden), ±1 sur les entiers arrondis. Les écarts plus larges
// (commentés au cas par cas) viennent du décodeur WASM qui lit quelques frames
// différemment d'orangebox sur les logs lr4/pico (frames corrompues).
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  analyzeFailsafe,
  analyzeGps,
  analyzeMotors,
  analyzeNoise,
  analyzePower,
  analyzeTimeline,
  analyzeTracking,
} from '../src/lib/analysis/basic';
import { initWasm, parseFile } from '../src/lib/bbl/parse';
import type { F32x3, F32x4, FlightData, SessionMeta } from '../src/lib/types';

const CHIMERA = '/home/rviau/projects/drones/chimera/blackbox/btfl_016.bbl';
const LR4 = '/home/rviau/projects/drones/explorer lr4/btfl_003.bbl';
const PICO = '/home/rviau/projects/drones/pavo pico/btfl_002.bbl';

let chimera: FlightData;
let lr4: FlightData;
let pico: FlightData;

beforeAll(async () => {
  await initWasm(await readFile(new URL('../public/blackbox-log.wasm', import.meta.url)));
  chimera = (await parseFile('btfl_016.bbl', new Uint8Array(await readFile(CHIMERA)))).sessions[0];
  lr4 = (await parseFile('btfl_003.bbl', new Uint8Array(await readFile(LR4)))).sessions[0]; // golden = session 1 seulement
  pico = (await parseFile('btfl_002.bbl', new Uint8Array(await readFile(PICO)))).sessions[0]; // session 1, les autres sont corrompues
});

/** |actual - golden| ≤ golden·pctTol% + absTol (absTol couvre l'arrondi d'affichage du golden). */
function expectClose(actual: number | null, golden: number, pctTol = 2, absTol = 0.05): void {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual as number) - golden)).toBeLessThanOrEqual((Math.abs(golden) * pctTol) / 100 + absTol);
}

/**
 * Les scripts python codent le bas de plage moteur en dur (48, ou 278 pour le
 * pico) alors que basic.ts utilise meta.motorOutputLow (158 sur le chimera).
 * On reconvertit nos % vers la base python pour comparer aux goldens.
 */
function toPyBasis(fd: FlightData, pct: number, pyLow: number): number {
  const raw = fd.meta.motorOutputLow + (pct / 100) * (fd.meta.motorOutputHigh - fd.meta.motorOutputLow);
  return ((raw - pyLow) / (2047 - pyLow)) * 100;
}

// ---------------------------------------------------------------------------
// Chimera 7 (6S, ~2 kHz, gyroUnfilt + eRPM) — golden chimera_016.txt
// ---------------------------------------------------------------------------

describe('chimera btfl_016 session 1', () => {
  it('power : 6S, 25.44→20.68 V, sag transitoire, courant 2.0 avg / 54.9 max', () => {
    const p = analyzePower(chimera)!;
    expect(p).not.toBeNull();
    expect(p.cells).toBe(6);
    expectClose(p.vbatMax, 25.44, 0, 0.01);
    expectClose(p.vbatMin, 20.68, 0, 0.01);
    expectClose(p.perCellMax, 4.24, 0, 0.01);
    expectClose(p.perCellMin, 3.45, 0, 0.01);
    // sag transitoire (vs max glissant 3 s) < sag max-min du golden python (4.76)
    expectClose(p.sagV, 4.54, 0, 0.05);
    expectClose(p.ampAvg, 2.0);
    expectClose(p.ampMax, 54.9);
    // pas de golden pour les mAh : cohérence avec avg·durée (échantillonnage régulier)
    expectClose(p.mahEstimate, (2.048 * chimera.meta.durationS) / 3.6, 2);
  });

  it('motors : avg 26 %, M1-4 = 25/26/26/27 (base python lo=48), saturation 0.08 %', () => {
    const m = analyzeMotors(chimera);
    expect(chimera.meta.motorOutputLow).toBe(158); // le golden utilisait 48 codé en dur
    expectClose(toPyBasis(chimera, m.avgPct, 48), 26, 0, 1);
    const goldenPerMotor = [25, 26, 26, 27];
    m.perMotorAvgPct.forEach((p, i) => expectClose(toPyBasis(chimera, p, 48), goldenPerMotor[i], 0, 1));
    expect(m.imbalancePctPts).toBeCloseTo(Math.max(...m.perMotorAvgPct) - Math.min(...m.perMotorAvgPct), 6);
    expectClose(m.saturationPct, 0.08, 2, 0.01);
    expect(m.desyncZeros).toEqual([0, 0, 0, 0]);
    expect(m.erpmAvailable).toBe(true);
  });

  it('noise : brut ≈ 7.0/12.7/9.6, filtré ≈ 1.0/1.0/0.6, pics 255/369/66', () => {
    const n = analyzeNoise(chimera);
    const goldenUnfilt = [7.0, 12.7, 9.6];
    const goldenFilt = [1.0, 1.0, 0.6];
    const goldenPeak = [255, 369, 66];
    n.axes.forEach((ax, i) => {
      expectClose(ax.unfiltRms, goldenUnfilt[i]);
      expectClose(ax.filtRms, goldenFilt[i]);
      expectClose(Math.round(ax.gyroPeak), goldenPeak[i], 0, 1);
      expect(ax.ratio).not.toBeNull();
      expect(ax.ratio!).toBeCloseTo(ax.unfiltRms! / ax.filtRms, 6);
      expect(ax.ratio!).toBeGreaterThan(5); // filtrage très efficace sur ce log
    });
  });

  it('tracking : erreur moyenne ≈ 3.4/4.3/1.1 deg/s', () => {
    const t = analyzeTracking(chimera);
    // ±0.1 abs : orangebox lit des entiers, le décodeur WASM des flottants —
    // sur les toutes petites erreurs (yaw 1.1) l'écart relatif gonfle un peu.
    expectClose(t.axes[0].meanAbsErr, 3.4, 2, 0.1);
    expectClose(t.axes[1].meanAbsErr, 4.3, 2, 0.1);
    expectClose(t.axes[2].meanAbsErr, 1.1, 2, 0.1);
    t.axes.forEach((ax) => {
      expect(ax.maxErr).toBeGreaterThanOrEqual(ax.meanAbsErr);
      expect(ax.setpointMax).toBeGreaterThan(0);
    });
  });

  it('timeline : 1 tranche idle, 7 tranches vol (21 s), retour idle', () => {
    const tl = analyzeTimeline(chimera);
    expect(tl.segments).toHaveLength(9);
    expect(tl.segments.map((s) => s.state)).toEqual([
      'idle', 'flight', 'flight', 'flight', 'flight', 'flight', 'flight', 'flight', 'idle',
    ]);
    expect(tl.flightTimeS).toBeCloseTo(21, 6);
    expect(tl.segments[0].tStart).toBe(0);
    expect(tl.segments[8].tEnd).toBeCloseTo(chimera.meta.durationS, 6);
    expectClose(tl.segments[0].vbat, 25.39, 0, 0.02);
    expectClose(tl.segments[0].stickAvg, 1021, 0, 3);
  });

  it('gps + failsafe : 12 sats, 2.9 m/s, jamais déclenché', () => {
    const g = analyzeGps(chimera);
    expect(g.available).toBe(true);
    expect(g.numSatMax).toBe(12);
    expectClose(g.speedMaxMps, 2.9, 0, 0.06);
    const f = analyzeFailsafe(chimera);
    expect(f.triggered).toBe(false);
    expect(f.phases['0']).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Explorer LR4 (4S, ~504 Hz, GPS + baro) — golden lr4_003.txt (session 1)
// ---------------------------------------------------------------------------

describe('lr4 btfl_003 session 1', () => {
  it('est bien la session du golden (7219 frames, durée réelle ~14.3 s)', () => {
    expect(lr4.meta.frameCount).toBe(7219);
    // la durée "~4s" du golden est fausse (fs codée en dur dans analyze_lr4.py)
    expect(lr4.meta.durationS).toBeGreaterThan(14.2);
    expect(lr4.meta.durationS).toBeLessThan(14.4);
  });

  it('power : 4S, 16.28→15.37 V, sag transitoire, courant 3.7 avg / 16.9 max', () => {
    const p = analyzePower(lr4)!;
    expect(p).not.toBeNull();
    expect(p.cells).toBe(4);
    expectClose(p.vbatMax, 16.28, 0, 0.01);
    expectClose(p.vbatMin, 15.37, 0, 0.01);
    // sag transitoire < max-min golden (0.91) : la décharge lente est exclue
    expectClose(p.sagV, 0.68, 0, 0.05);
    expectClose(p.ampAvg, 3.7);
    expectClose(p.ampMax, 16.9);
    expect(p.mahEstimate).toBeGreaterThan(10);
    expect(p.mahEstimate).toBeLessThan(20);
  });

  it('motors : avg 26 %, M1-4 = 22/30/20/31 malgré les frames corrompues', () => {
    const m = analyzeMotors(lr4);
    expectClose(toPyBasis(lr4, m.avgPct, 48), 26, 0, 1);
    const goldenPerMotor = [22, 30, 20, 31];
    m.perMotorAvgPct.forEach((p, i) => expectClose(toPyBasis(lr4, p, 48), goldenPerMotor[i], 0, 1));
    expectClose(m.imbalancePctPts, 11, 0, 1); // 31 - 20 du golden
    // Golden 0.07 % : la fenêtre saturée (t≈12.26 s) tombe pile sur les frames
    // que le décodeur WASM corrompt — on en retrouve une partie seulement.
    expect(m.saturationPct).toBeGreaterThan(0);
    expect(m.saturationPct).toBeLessThan(0.15);
    expect(m.desyncZeros).toEqual([0, 0, 0, 0]);
    expect(m.erpmAvailable).toBe(true);
  });

  it('noise : brut ≈ 20.0/16.2/10.9, filtré ≈ 1.7/3.7/1.5', () => {
    const n = analyzeNoise(lr4);
    // 5 % sur le brut : ~16 frames décodées différemment d'orangebox suffisent
    // à décaler le RMS diff de 2.5-4 % sur ce log court.
    expectClose(n.axes[0].unfiltRms, 20.0, 5);
    expectClose(n.axes[1].unfiltRms, 16.2, 5);
    expectClose(n.axes[2].unfiltRms, 10.9, 5);
    expectClose(n.axes[0].filtRms, 1.7);
    expectClose(n.axes[1].filtRms, 3.7);
    expectClose(n.axes[2].filtRms, 1.5);
    // Pics golden 67/201/25 : le pic pitch 201 est dans la zone corrompue,
    // notre décodage voit 65/181/23. On borne large.
    expectClose(n.axes[0].gyroPeak, 67, 0, 3);
    expectClose(n.axes[1].gyroPeak, 201, 12, 1);
    expectClose(n.axes[2].gyroPeak, 25, 0, 3);
  });

  it('tracking : erreur moyenne ≈ 2.1/4.3/1.0 deg/s', () => {
    const t = analyzeTracking(lr4);
    expectClose(t.axes[0].meanAbsErr, 2.1, 2, 0.1);
    expectClose(t.axes[1].meanAbsErr, 4.3, 2, 0.1);
    expectClose(t.axes[2].meanAbsErr, 1.0, 2, 0.1);
  });

  it('timeline : idle puis 4 tranches de vol (~11.3 s de vol)', () => {
    const tl = analyzeTimeline(lr4);
    expect(tl.segments).toHaveLength(5);
    expect(tl.segments.map((s) => s.state)).toEqual(['idle', 'flight', 'flight', 'flight', 'flight']);
    expect(tl.flightTimeS).toBeCloseTo(lr4.meta.durationS - 3, 3);
    // la tranche 12-14.3 s contient les frames corrompues : la poussée doit
    // rester plausible (garde-fou), pas 459905 %
    const last = tl.segments[4];
    expect(last.thrustPct).toBeGreaterThan(5);
    expect(last.thrustPct).toBeLessThan(100);
  });

  it('gps + failsafe : 8 sats, 2.1 m/s, jamais déclenché', () => {
    const g = analyzeGps(lr4);
    expect(g.available).toBe(true);
    expect(g.numSatMax).toBe(8);
    expectClose(g.speedMaxMps, 2.1, 0, 0.06);
    expect(analyzeFailsafe(lr4).triggered).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pavo Pico (2S, session 1, pas de GPS) — golden pico_002.txt
// ---------------------------------------------------------------------------

describe('pico btfl_002 session 1', () => {
  it('power : 2S, 8.24→6.95 V, sag 1.29, courant 4.2 avg / 25.0 max', () => {
    const p = analyzePower(pico)!;
    expect(p).not.toBeNull();
    expect(p.cells).toBe(2);
    expectClose(p.vbatMax, 8.24, 0, 0.01);
    expectClose(p.vbatMin, 6.95, 0, 0.01);
    expectClose(p.perCellMax, 4.12, 0, 0.01);
    expectClose(p.perCellMin, 3.48, 0, 0.01);
    // sag transitoire < max-min golden (1.29)
    expectClose(p.sagV, 1.08, 0, 0.05);
    expectClose(p.ampAvg, 4.2);
    expectClose(p.ampMax, 25.0);
  });

  it('motors : avg 26 %, M1-4 = 29/24/30/23 (base python lo=278)', () => {
    const m = analyzeMotors(pico);
    expectClose(toPyBasis(pico, m.avgPct, 278), 26, 0, 1);
    const goldenPerMotor = [29, 24, 30, 23];
    m.perMotorAvgPct.forEach((p, i) => expectClose(toPyBasis(pico, p, 278), goldenPerMotor[i], 0, 1));
    expectClose(m.saturationPct, 0.01, 0, 0.05); // golden 0.01 % ≈ 2 échantillons
    expect(m.desyncZeros).toEqual([0, 0, 0, 0]);
  });

  it('noise : brut ≈ 91.8/33.1/37.9, filtré ≈ 4.9/11.7/4.6, pics 183/679/97', () => {
    const n = analyzeNoise(pico);
    // 5-8 % : orangebox lisait 5225 frames, le décodeur WASM 5142 — le jeu de
    // frames diffère de ~1.6 %, surtout visible sur le pitch.
    expectClose(n.axes[0].unfiltRms, 91.8, 5);
    expectClose(n.axes[1].unfiltRms, 33.1, 5);
    expectClose(n.axes[2].unfiltRms, 37.9, 5);
    expectClose(n.axes[0].filtRms, 4.9);
    expectClose(n.axes[1].filtRms, 11.7, 8);
    expectClose(n.axes[2].filtRms, 4.6);
    expectClose(n.axes[0].gyroPeak, 183, 0, 1);
    expectClose(n.axes[1].gyroPeak, 679, 0, 1);
    expectClose(n.axes[2].gyroPeak, 97, 0, 1);
  });

  it('tracking : erreur ≈ 5.5/14.4/2.9, max ≈ 193/714/97, sp max 27/110/12', () => {
    const t = analyzeTracking(pico);
    expectClose(t.axes[0].meanAbsErr, 5.5, 2, 0.1);
    expectClose(t.axes[1].meanAbsErr, 14.4, 8, 0.1); // jeu de frames ≠ orangebox (cf. noise)
    expectClose(t.axes[2].meanAbsErr, 2.9, 2, 0.1);
    expectClose(t.axes[0].maxErr, 193, 0, 1);
    expectClose(t.axes[1].maxErr, 714, 0, 1);
    expectClose(t.axes[2].maxErr, 97, 0, 1);
    expect(Math.round(t.axes[0].setpointMax)).toBe(27);
    expect(Math.round(t.axes[1].setpointMax)).toBe(110);
    expect(Math.round(t.axes[2].setpointMax)).toBe(12);
  });

  it('timeline : tranches 0/3/9/12/18/21 (trous de log à 6 s et 15 s)', () => {
    const tl = analyzeTimeline(pico);
    expect(tl.segments.map((s) => s.tStart)).toEqual([0, 3, 9, 12, 18, 21]);
    // NB : le golden classe 0-3 s en "bas" car il calcule la poussée avec
    // lo=278 codé en dur ; avec meta.motorOutputLow=48 la tranche passe à 13.8 %.
    const goldenStick = [1085, 1129, 1480, 1471, 1405, 1230];
    const goldenVbat = [8.2, 8.16, 7.88, 7.87, 7.85, 7.8];
    tl.segments.forEach((s, i) => {
      expectClose(s.stickAvg, goldenStick[i], 0, 10);
      expectClose(s.vbat, goldenVbat[i], 0, 0.02);
      expect(s.thrustPct).toBeLessThan(100); // garde-fou frames corrompues (18-21 s)
    });
    expect(tl.flightTimeS).toBeGreaterThan(15);
    expect(tl.flightTimeS).toBeLessThan(16);
  });

  it('gps absent + failsafe jamais déclenché', () => {
    const g = analyzeGps(pico);
    expect(g).toEqual({
      available: false,
      numSatMax: null,
      numSatMin: null,
      numSatMedian: null,
      speedMaxMps: null,
      corruptFrameRatio: null,
      timeToHealthySatsS: null,
      satDrops: [],
      satsVsThrottle: null,
      hdopMedian: null,
      hdopWorst: null,
    });
    expect(analyzeFailsafe(pico).triggered).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cas limites sur données synthétiques
// ---------------------------------------------------------------------------

function synth(over: Partial<FlightData> = {}, n = 8): FlightData {
  const z = () => new Float32Array(n);
  const meta: SessionMeta = {
    index: 0,
    fileName: 'synth.bbl',
    firmware: 'Betaflight 4.4.2',
    fieldNames: [],
    sampleRateHz: 1000,
    durationS: (n - 1) / 1000,
    frameCount: n,
    motorOutputLow: 48,
    motorOutputHigh: 2047,
    headers: {},
  };
  const time = new Float64Array(n);
  for (let i = 0; i < n; i++) time[i] = i / 1000;
  const throttle = z();
  throttle.fill(1000);
  return {
    meta,
    time,
    gyro: [z(), z(), z()] as F32x3,
    gyroUnfilt: null,
    setpoint: [z(), z(), z()] as F32x3,
    throttle,
    motor: [z(), z(), z(), z()] as F32x4,
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
    failsafePhaseCounts: { '0': n },
    ...over,
  };
}

describe('cas limites', () => {
  it('analyzePower : null sans vbat exploitable, mAh null sans ampérage', () => {
    expect(analyzePower(synth())).toBeNull();
    expect(analyzePower(synth({ vbat: new Float32Array(8) }))).toBeNull(); // que des 0
    const vb = new Float32Array(8).fill(8.4);
    const p = analyzePower(synth({ vbat: vb }))!;
    expect(p.cells).toBe(2);
    expect(p.ampAvg).toBeNull();
    expect(p.ampMax).toBeNull();
    expect(p.mahEstimate).toBeNull();
  });

  it('analyzePower : intégrale trapèze du courant', () => {
    const vb = new Float32Array(8).fill(16.8);
    const amp = new Float32Array(8).fill(36); // 36 A constants sur 7 ms
    const p = analyzePower(synth({ vbat: vb, amperage: amp }))!;
    expect(p.cells).toBe(4);
    expect(p.mahEstimate).toBeCloseTo((36 * 0.007) / 3.6, 6); // = 0.07 mAh
    expect(p.ampAvg).toBeCloseTo(36, 6);
  });

  it('analyzeNoise : unfiltRms et ratio null sans gyroUnfilt, exclusion des aberrations', () => {
    const g = new Float32Array([0, 1, 0, 1, 6000, 0, 1, 0]); // 6000 = frame corrompue
    const n = analyzeNoise(synth({ gyro: [g, new Float32Array(8), new Float32Array(8)] as F32x3 }));
    expect(n.axes[0].unfiltRms).toBeNull();
    expect(n.axes[0].ratio).toBeNull();
    expect(n.axes[0].gyroPeak).toBe(1); // le 6000 est exclu du pic aussi
    expect(n.axes[0].filtRms).toBeCloseTo(1, 6);
    expect(n.axes[1].ratio).toBeNull(); // filtRms ≈ 0
  });

  it('analyzeMotors : desync compté uniquement en vol (throttle > 1100)', () => {
    const throttle = new Float32Array([1000, 1000, 1000, 1000, 1200, 1200, 1200, 1200]);
    const e = () => new Float32Array(8).fill(500);
    const erpm0 = new Float32Array([0, 0, 0, 0, 0, 0, 500, 500]); // 4 zéros au sol, 2 en vol
    const m = analyzeMotors(synth({ throttle, erpm: [erpm0, e(), e(), e()] as F32x4 }));
    expect(m.erpmAvailable).toBe(true);
    expect(m.desyncZeros).toEqual([2, 0, 0, 0]);
  });

  it('analyzeMotors : saturation comptée, frames corrompues exclues', () => {
    const mk = (v: number) => new Float32Array(8).fill(v);
    const m0 = new Float32Array([2040, 2047, 2050, 4294967040, 1000, 1000, 1000, 1000]);
    const m = analyzeMotors(synth({ motor: [m0, mk(1000), mk(1000), mk(1000)] as F32x4 }));
    // 3 échantillons saturés (2040, 2047, 2050) sur 31 valides (le 4294967040 est exclu)
    expect(m.saturationPct).toBeCloseTo((100 * 3) / 31, 6);
    expect(m.perMotorAvgPct[0]).toBeLessThan(100); // moyenne non polluée par la frame corrompue
  });

  it('analyzeGps : frames G corrompues écartées, stats robustes', () => {
    const gn = 40;
    const sat = new Float32Array(gn).fill(8);
    sat[5] = 0; // zéro isolé au milieu de 8 : glitch décodeur, pas une perte réelle
    sat[20] = 1042; // compte impossible (observé sur logs réels)
    const gt = new Float64Array(gn);
    for (let i = 0; i < gn; i++) gt[i] = i * 0.2;
    const g = analyzeGps(
      synth({ gps: { time: gt, numSat: sat, speedMps: new Float32Array(gn), hdop: null } }),
    );
    expect(g.available).toBe(true);
    expect(g.numSatMin).toBe(8);
    expect(g.numSatMax).toBe(8);
    expect(g.numSatMedian).toBe(8);
    expect(g.corruptFrameRatio).toBeCloseTo(2 / 40, 6);
    expect(g.satDrops).toEqual([]);
    expect(g.timeToHealthySatsS).toBe(0);
  });

  it('analyzeGps : chute soutenue détectée (pas lissée comme un glitch)', () => {
    const gn = 40;
    const sat = new Float32Array(gn).fill(10);
    for (let i = 20; i < 26; i++) sat[i] = 5; // 6 frames sous le seuil : perte réelle
    const gt = new Float64Array(gn);
    for (let i = 0; i < gn; i++) gt[i] = i * 0.2;
    const g = analyzeGps(
      synth({ gps: { time: gt, numSat: sat, speedMps: new Float32Array(gn), hdop: null } }),
    );
    expect(g.numSatMin).toBe(5);
    expect(g.satDrops.length).toBe(1);
    expect(g.satDrops[0].toSats).toBe(5);
    expect(g.satDrops[0].fromSats).toBe(10);
    expect(g.satDrops[0].timeS).toBeCloseTo(4, 1);
  });

  it('analyzeGps : sats en baisse à haut throttle → satsVsThrottle (signature EMI)', () => {
    const n = 400;
    const time = new Float64Array(n);
    const throttle = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      time[i] = i / 100; // 4 s à 100 Hz
      throttle[i] = i < n / 2 ? 1200 : 1800;
    }
    const gn = 60;
    const gt = new Float64Array(gn);
    const sat = new Float32Array(gn);
    for (let i = 0; i < gn; i++) {
      gt[i] = (i * 4) / gn;
      sat[i] = gt[i] < 2 ? 10 : 6; // le GPS perd 4 sats quand le throttle monte
    }
    const g = analyzeGps(
      synth({
        time,
        throttle,
        gps: { time: gt, numSat: sat, speedMps: new Float32Array(gn), hdop: null },
      }),
    );
    expect(g.satsVsThrottle).not.toBeNull();
    expect(g.satsVsThrottle?.lowMedian).toBe(10);
    expect(g.satsVsThrottle?.highMedian).toBe(6);
    expect(g.satsVsThrottle?.delta).toBe(-4);
  });

  it('analyzeGps : hdop médian/pire depuis les frames retenues (INAV)', () => {
    const gn = 30;
    const gt = new Float64Array(gn);
    for (let i = 0; i < gn; i++) gt[i] = i * 0.2;
    const hdop = new Float32Array(gn).fill(3.2);
    hdop[3] = 0; // frame partielle : ignorée
    const g = analyzeGps(
      synth({ gps: { time: gt, numSat: new Float32Array(gn).fill(12), speedMps: new Float32Array(gn), hdop } }),
    );
    expect(g.hdopMedian).toBeCloseTo(3.2, 5);
    expect(g.hdopWorst).toBeCloseTo(3.2, 5);
  });

  it('analyzeFailsafe : déclenché si une phase non bénigne apparaît', () => {
    expect(analyzeFailsafe(synth()).triggered).toBe(false);
    expect(analyzeFailsafe(synth({ failsafePhaseCounts: { '0': 5, IDLE: 2, '': 1, '?': 1 } })).triggered).toBe(false);
    const f = analyzeFailsafe(synth({ failsafePhaseCounts: { '0': 5, RX_LOSS_DETECTED: 3 } }));
    expect(f.triggered).toBe(true);
    expect(f.phases['RX_LOSS_DETECTED']).toBe(3);
  });

  it('analyzeTimeline : état idle stick bas, low si poussée faible', () => {
    const throttle = new Float32Array(8).fill(1050); // < 1080 → idle
    let tl = analyzeTimeline(synth({ throttle }));
    expect(tl.segments).toHaveLength(1);
    expect(tl.segments[0].state).toBe('idle');
    expect(tl.segments[0].vbat).toBeNull();
    expect(tl.flightTimeS).toBe(0);
    const armed = new Float32Array(8).fill(1200); // stick haut mais moteurs à ~0 % → low
    tl = analyzeTimeline(synth({ throttle: armed }));
    expect(tl.segments[0].state).toBe('low');
    expect(tl.flightTimeS).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Écrêtage bas et rupture d'équilibre (analyzeMotors)
// ---------------------------------------------------------------------------

describe('analyzeMotors : floorClipPct et balanceShift', () => {
  const fill = (nn: number, v: number) => new Float32Array(nn).fill(v);

  it('écrêtage bas : moteur au plancher + grand différentiel en demande stabilisée', () => {
    const n = 2000;
    const fd = synth(
      {
        throttle: fill(n, 1400),
        motor: [fill(n, 100), fill(n, 800), fill(n, 800), fill(n, 800)] as F32x4,
      },
      n,
    );
    // pct(100) = 2.6 % <= 6, spread 35 pts >= 30 : chaque échantillon compte
    expect(analyzeMotors(fd).floorClipPct).toBe(100);
  });

  it('pas d écrêtage si le différentiel est petit ou la demande non stabilisée', () => {
    const n = 2000;
    const small = synth(
      {
        throttle: fill(n, 1400),
        motor: [fill(n, 100), fill(n, 500), fill(n, 500), fill(n, 500)] as F32x4,
      },
      n,
    );
    expect(analyzeMotors(small).floorClipPct).toBe(0); // spread 20 pts < 30

    const commanded = synth(
      {
        throttle: fill(n, 1400),
        setpoint: [fill(n, 300), fill(n, 0), fill(n, 0)] as F32x3,
        gyro: [fill(n, 290), fill(n, 0), fill(n, 0)] as F32x3, // le gyro suit : vol réel
        motor: [fill(n, 100), fill(n, 800), fill(n, 800), fill(n, 800)] as F32x4,
      },
      n,
    );
    expect(analyzeMotors(commanded).floorClipPct).toBe(0); // manoeuvre commandée
  });

  it('rupture d équilibre : saut soutenu détecté, moteur surcommandé et diagonale', () => {
    const n = 10_000; // 10 s à 1 kHz
    const m0 = new Float32Array(n);
    const m1 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      m0[i] = i < n / 2 ? 1000 : 1250;
      m1[i] = i < n / 2 ? 1000 : 750;
    }
    const fd = synth(
      { throttle: fill(n, 1400), motor: [m0, m1, fill(n, 1000), fill(n, 1000)] as F32x4 },
      n,
    );
    const shift = analyzeMotors(fd).balanceShift;
    expect(shift).not.toBeNull();
    expect(shift?.motor).toBe(1);
    expect(shift?.counterMotor).toBe(2);
    expect(shift?.deltaPctPts).toBeGreaterThan(10);
    expect(Math.abs((shift?.tChangeS ?? 0) - 5)).toBeLessThan(0.5);
  });

  it('log de banc (grandes consignes sans réponse gyro) : les deux métriques se taisent', () => {
    const n = 10_000;
    const m0 = new Float32Array(n);
    const m1 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      m0[i] = i < n / 2 ? 1000 : 1250;
      m1[i] = i < n / 2 ? 100 : 750; // passe aussi sous le plancher
    }
    const fd = synth(
      {
        throttle: fill(n, 1400),
        setpoint: [fill(n, 400), fill(n, 0), fill(n, 0)] as F32x3, // gyro reste à 0 : quad posé
        motor: [m0, m1, fill(n, 1000), fill(n, 1000)] as F32x4,
      },
      n,
    );
    const mm = analyzeMotors(fd);
    expect(mm.balanceShift).toBeNull();
    expect(mm.floorClipPct).toBe(0);
  });

  it('pas de rupture sans vol assez long de chaque côté', () => {
    const n = 2000; // 2 s < 2 x 3 s de segments minimum
    const m0 = new Float32Array(n);
    for (let i = 0; i < n; i++) m0[i] = i < n / 2 ? 1000 : 1400;
    const fd = synth(
      { throttle: fill(n, 1400), motor: [m0, fill(n, 1000), fill(n, 1000), fill(n, 1000)] as F32x4 },
      n,
    );
    expect(analyzeMotors(fd).balanceShift).toBeNull();
  });
});

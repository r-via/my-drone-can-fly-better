// Perte de contrôle (analyzeControlLoss) : cas synthétiques + ancrage sur les
// logs réels du dossier Akira (désync en vol d'un X8 9" sous INAV, sans eRPM).
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

import { analyzeControlLoss } from '../src/lib/analysis/control';
import { analyzeMotors } from '../src/lib/analysis/basic';
import { initWasm, parseFile } from '../src/lib/bbl/parse';
import type { F32x3, F32x4, FlightData, SessionMeta } from '../src/lib/types';

// ---------------------------------------------------------------------------
// Builder synthétique (même squelette que basic.test.ts)
// ---------------------------------------------------------------------------

function synth(over: Partial<FlightData> = {}, n = 3000): FlightData {
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
  const throttle = new Float32Array(n).fill(1500);
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
    temps: null,
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

/** Excursion non commandée sur roll dans [from, to) : gyro 600 pour consigne 50. */
function excursion(fd: FlightData, from: number, to: number): void {
  for (let i = from; i < to; i++) {
    fd.gyro[0][i] = 600;
    fd.setpoint[0][i] = 50;
  }
}

/** Mixer écartelé dans [from, to) : M1 au plancher (48), M2 au plafond (2040 >= 2047-8). */
function spread(fd: FlightData, from: number, to: number): void {
  for (let i = 0; i < fd.time.length; i++) {
    const inside = i >= from && i < to;
    fd.motor[0][i] = inside ? 48 : 1200;
    fd.motor[1][i] = inside ? 2040 : 1200;
    fd.motor[2][i] = 1200;
    fd.motor[3][i] = 1200;
  }
}

describe('analyzeControlLoss : synthétique', () => {
  it('excursion non commandée + mixer en butée → un événement crit-worthy', () => {
    const fd = synth();
    excursion(fd, 1500, 1800);
    spread(fd, 1500, 1800);
    const cl = analyzeControlLoss(fd);
    expect(cl.applicable).toBe(true);
    expect(cl.events).toHaveLength(1);
    const e = cl.events[0];
    expect(e.axis).toBe(0);
    expect(e.peakExcessDps).toBe(550); // 600 - 50
    expect(e.peakSpreadPct).toBeGreaterThan(95);
    expect(e.floorTouched).toBe(true);
    expect(e.ceilTouched).toBe(true);
    expect(Math.abs(e.tStart - 1.5)).toBeLessThan(0.05);
  });

  it('figure commandée suivie par le gyro : excès nul, aucun événement', () => {
    const fd = synth();
    for (let i = 1500; i < 1800; i++) {
      fd.setpoint[0][i] = 800;
      fd.gyro[0][i] = 780; // le gyro court APRÈS la consigne : sain
    }
    spread(fd, 1500, 1800); // même signature mixer : sans excès, elle ne suffit pas
    expect(analyzeControlLoss(fd).events).toHaveLength(0);
  });

  it('gaz coupés juste avant (pose, catch) : pas une perte de contrôle', () => {
    const fd = synth();
    for (let i = 1300; i < fd.time.length; i++) fd.throttle[i] = 1000;
    excursion(fd, 1500, 1800);
    spread(fd, 1500, 1800);
    expect(analyzeControlLoss(fd).events).toHaveLength(0);
  });

  it('excursion avec mixer détendu : problème de tune, pas de perte de contrôle', () => {
    const fd = synth();
    excursion(fd, 1500, 1800);
    for (const m of fd.motor) m.fill(1200); // aucun différentiel
    expect(analyzeControlLoss(fd).events).toHaveLength(0);
  });

  it('trop court pour juger : non applicable', () => {
    expect(analyzeControlLoss(synth({}, 100)).applicable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Ancrage régression : le dossier Akira (INAV 9, APD sans eRPM)
// ---------------------------------------------------------------------------

const AKIRA_FLYAWAY = '/home/rviau/projects/drones/akira/02 - Acro flyaway.TXT';
const AKIRA_HOVER = '/home/rviau/projects/drones/akira/01 - Hover and wobble.TXT';

let flyaway: FlightData;
let hoverClean: FlightData;

beforeAll(async () => {
  await initWasm(await readFile(new URL('../public/blackbox-log.wasm', import.meta.url)));
  flyaway = (await parseFile('02.TXT', new Uint8Array(await readFile(AKIRA_FLYAWAY)))).sessions[0];
  // session 2 = le hover de référence, parfaitement équilibré
  hoverClean = (await parseFile('01.TXT', new Uint8Array(await readFile(AKIRA_HOVER)))).sessions[1];
});

describe('akira : désync en vol détecté sans eRPM', () => {
  it('flyaway : perte de contrôle datée pendant le quasi-flip', () => {
    const cl = analyzeControlLoss(flyaway);
    expect(cl.applicable).toBe(true);
    expect(cl.events.length).toBeGreaterThanOrEqual(1);
    const w = cl.worst;
    expect(w?.tStart).toBeGreaterThan(3.5);
    expect(w?.tEnd).toBeLessThan(5.2);
    expect(w?.peakExcessDps).toBeGreaterThan(400);
    expect(w?.peakSpreadPct).toBeGreaterThan(70);
  });

  it('flyaway : rupture d équilibre sur M7 avec M2 délesté, écrêtage bas massif', () => {
    const mm = analyzeMotors(flyaway);
    expect(mm.balanceShift?.motor).toBe(7);
    expect(mm.balanceShift?.counterMotor).toBe(2);
    expect(mm.balanceShift?.deltaPctPts).toBeGreaterThan(15);
    expect(mm.floorClipPct).toBeGreaterThan(10);
  });

  it('hover de référence : aucune des trois signatures', () => {
    expect(analyzeControlLoss(hoverClean).events).toHaveLength(0);
    const mm = analyzeMotors(hoverClean);
    expect(mm.balanceShift).toBeNull();
    expect(mm.floorClipPct).toBeLessThan(3); // sous le warn de tous les profils
  });
});

// Tests du moteur de règles : fixtures SessionAnalysis synthétiques,
// aucun parsing de log nécessaire.

import { describe, expect, it } from 'vitest';
import { evaluateSession } from '../src/lib/rules/engine';
import { PROFILES, pickProfile } from '../src/lib/rules/profiles';
import type {
  AxisSpectrum,
  AxisStepResponse,
  Finding,
  SessionAnalysis,
  SessionMeta,
} from '../src/lib/types';

// ---------------------------------------------------------------------------
// Builder : SessionAnalysis saine par défaut (aucune règle warn/crit ne doit
// se déclencher avec le profil chimera7), que chaque test mute à sa guise.
// ---------------------------------------------------------------------------

function makeMeta(over: Partial<SessionMeta> = {}): SessionMeta {
  return {
    index: 0,
    fileName: 'btfl_synth.bbl',
    craftName: 'SHIMERA7PRO',
    firmware: 'Betaflight 2025.12.2 (synthetic) STM32F7X2',
    fieldNames: [],
    sampleRateHz: 2000,
    durationS: 120,
    frameCount: 240_000,
    motorOutputLow: 48,
    motorOutputHigh: 2047,
    headers: {},
    ...over,
  };
}

function makeAxisSpectrum(over: Partial<AxisSpectrum> = {}): AxisSpectrum {
  return {
    bands: [
      { lo: 5, hi: 40, label: 'prop-wash/pilotage <40Hz', rms: 100 },
      { lo: 40, hi: 120, label: 'RÉSONANCE CHÂSSIS 40-120Hz', rms: 150 },
      { lo: 120, hi: 350, label: 'plage moteur 120-350Hz', rms: 600 },
      { lo: 350, hi: 1000, label: 'harmoniques >350Hz', rms: 80 },
    ],
    dominantBand: 'plage moteur 120-350Hz',
    peaks: [{ freqHz: 138, mag: 1000 }],
    freqs: new Float32Array(0),
    mags: new Float32Array(0),
    ...over,
  };
}

function makeStep(over: Partial<AxisStepResponse> = {}): AxisStepResponse {
  return {
    t: new Float32Array(0),
    y: new Float32Array(0),
    riseTimeMs: 30,
    peakValue: 1.1,
    overshootPct: 10,
    settleValue: 1.0,
    quality: 0.8,
    ...over,
  };
}

function makeAnalysis(mutate?: (a: SessionAnalysis) => void): SessionAnalysis {
  const a: SessionAnalysis = {
    meta: makeMeta(),
    power: {
      cells: 6,
      vbatMax: 25.2,
      vbatMin: 22.8,
      perCellMax: 4.2,
      perCellMin: 3.8,
      sagV: 1.2, // 0.2 V/cellule : sain
      ampAvg: 10,
      ampMax: 40,
      mahEstimate: 800,
      perCellMinSustained: 3.8,
      implausibleSamples: 0,
    },
    motors: {
      avgPct: 30,
      perMotorAvgPct: [29, 30, 30, 31],
      imbalancePctPts: 2,
      saturationPct: 0.1,
      desyncZeros: [0, 0, 0, 0],
      erpmAvailable: true,
    },
    noise: {
      axes: [
        { unfiltRms: 8, filtRms: 1.0, ratio: 8, gyroPeak: 200 },
        { unfiltRms: 10, filtRms: 1.2, ratio: 8.3, gyroPeak: 250 },
        { unfiltRms: 6, filtRms: 0.8, ratio: 7.5, gyroPeak: 90 },
      ],
    },
    spectrum: {
      source: 'unfilt',
      axes: [makeAxisSpectrum(), makeAxisSpectrum(), makeAxisSpectrum()],
      motorFundamentalHz: 138,
      perMotorHz: [
        { median: 130, p90: 169 },
        { median: 141, p90: 178 },
        { median: 137, p90: 168 },
        { median: 142, p90: 184 },
      ],
      dominantPeak: null,
      motorPolesAssumed: 14,
    },
    tracking: {
      axes: [
        { meanAbsErr: 3, maxErr: 40, setpointMax: 500 },
        { meanAbsErr: 4, maxErr: 55, setpointMax: 520 },
        { meanAbsErr: 1.5, maxErr: 20, setpointMax: 300 },
      ],
    },
    step: { axes: [makeStep(), makeStep(), makeStep()] },
    yoyo: { applicable: true, ratio: 0.8, verdict: 'stable', peaks: [] },
    propwash: { applicable: true, events: [], worstSeverity: 5, avgSeverity: 4 },
    oscillation: { applicable: true, baselineAmp: 20, events: [], worst: null },
    filters: {
      available: true,
      axes: [
        { attenuationDb: [{ lo: 120, hi: 350, db: 25 }], residualHfRms: 0.5 },
        { attenuationDb: [{ lo: 120, hi: 350, db: 24 }], residualHfRms: 0.6 },
        { attenuationDb: [{ lo: 120, hi: 350, db: 26 }], residualHfRms: 0.4 },
      ],
    },
    timeline: { segments: [], flightTimeS: 110, throttleMaxUs: 1600 },
    gps: { available: true, numSatMax: 14, numSatMin: 9, speedMaxMps: 20 },
    failsafe: { phases: { '0': 240_000 }, triggered: false },
  };
  mutate?.(a);
  return a;
}

const chimera = pickProfile('SHIMERA7PRO');
const pico = pickProfile('Pavo Pico');

function ids(findings: Finding[]): string[] {
  return findings.map((fd) => fd.id);
}

function checkShape(findings: Finding[]): void {
  for (const fd of findings) {
    expect(fd.id.length, `id vide (${fd.title})`).toBeGreaterThan(0);
    expect(['ok', 'info', 'warn', 'crit']).toContain(fd.severity);
    expect(fd.category.length, `category vide (${fd.id})`).toBeGreaterThan(0);
    expect(fd.title.length, `title vide (${fd.id})`).toBeGreaterThan(0);
    expect(fd.detail.length, `detail vide (${fd.id})`).toBeGreaterThan(0);
    expect(fd.evidence.length, `evidence vide (${fd.id})`).toBeGreaterThan(0);
  }
}

// ---------------------------------------------------------------------------

describe('pickProfile', () => {
  it('détecte les drones du parc par craft name', () => {
    expect(pickProfile('SHIMERA7PRO').id).toBe('chimera7');
    expect(pickProfile('Pavo Pico').id).toBe('pico');
    expect(pickProfile('LR4-O4PRO').id).toBe('lr4');
    expect(pickProfile(undefined).id).toBe('generic');
    expect(pickProfile('QuadInconnu123').id).toBe('generic');
    expect(pickProfile('pavo pico').id).toBe('pico'); // insensible à la casse
  });

  it('generic est en dernier et attrape tout', () => {
    const last = PROFILES[PROFILES.length - 1];
    expect(last.id).toBe('generic');
    expect(last.craftMatch.source).toBe('.');
    expect(last.expectedCells).toBeNull();
  });

  it('les profils portent les seuils clés de la mission', () => {
    const p = pickProfile('Pavo Pico');
    expect(p.motorPoles).toBe(12);
    expect(p.expectedCells).toBe(2);
    expect(p.thresholds.filtNoiseWarn).toBe(4);
    expect(p.thresholds.unfiltNoiseWarn).toBe(40);
    expect(p.thresholds.yoyoRatioWarn).toBe(1.3);
    const l = pickProfile('LR4-O4PRO');
    expect(l.motorPoles).toBe(12);
    expect(l.expectedCells).toBe(4);
    expect(l.thresholds.trackingWarn).toBe(6);
    expect(l.thresholds.sagPerCellWarn).toBe(0.35);
    const c = pickProfile('SHIMERA7PRO');
    expect(c.motorPoles).toBe(14);
    expect(c.expectedCells).toBe(6);
    expect(c.thresholds.unfiltNoiseWarn).toBe(20);
  });
});

describe('evaluateSession', () => {
  it('cas sain → all-good seul', () => {
    const findings = evaluateSession(makeAnalysis(), chimera);
    checkShape(findings);
    expect(ids(findings)).toEqual(['all-good']);
    expect(findings[0].severity).toBe('ok');
    expect(findings[0].evidence).toMatch(/deg\/s/); // points forts chiffrés
  });

  it('résonance châssis → chassis-resonance warn avec les chiffres', () => {
    const a = makeAnalysis((x) => {
      if (!x.spectrum) throw new Error('spectrum requis');
      x.spectrum.axes[1] = makeAxisSpectrum({
        bands: [
          { lo: 5, hi: 40, label: 'prop-wash/pilotage <40Hz', rms: 120 },
          { lo: 40, hi: 120, label: 'RÉSONANCE CHÂSSIS 40-120Hz', rms: 900 },
          { lo: 120, hi: 350, label: 'plage moteur 120-350Hz', rms: 400 },
          { lo: 350, hi: 1000, label: 'harmoniques >350Hz', rms: 60 },
        ],
        dominantBand: 'RÉSONANCE CHÂSSIS 40-120Hz',
      });
      x.spectrum.dominantPeak = { freqHz: 87, axis: 1, nearestMotor: 2, distanceHz: 50 };
    });
    const findings = evaluateSession(a, chimera);
    checkShape(findings);
    const res = findings.find((fd) => fd.id === 'chassis-resonance');
    expect(res).toBeDefined();
    expect(res?.severity).toBe('warn');
    expect(res?.evidence).toContain('900');
    expect(res?.evidence).toContain('Pitch');
    expect(res?.evidence).toContain('87'); // pic exact mentionné
    expect(ids(findings)).not.toContain('all-good');
  });

  it('pas de résonance si la bande 40-120 ne domine pas nettement (< 1.5x moteur)', () => {
    const a = makeAnalysis((x) => {
      if (!x.spectrum) throw new Error('spectrum requis');
      x.spectrum.axes[0] = makeAxisSpectrum({
        bands: [
          { lo: 5, hi: 40, label: 'prop-wash/pilotage <40Hz', rms: 100 },
          { lo: 40, hi: 120, label: 'RÉSONANCE CHÂSSIS 40-120Hz', rms: 500 },
          { lo: 120, hi: 350, label: 'plage moteur 120-350Hz', rms: 400 },
          { lo: 350, hi: 1000, label: 'harmoniques >350Hz', rms: 60 },
        ],
        dominantBand: 'RÉSONANCE CHÂSSIS 40-120Hz',
      });
    });
    expect(ids(evaluateSession(a, chimera))).not.toContain('chassis-resonance');
  });

  it('desync eRPM → crit avec le bon moteur', () => {
    const a = makeAnalysis((x) => {
      x.motors.desyncZeros = [0, 37, 0, 0];
    });
    const findings = evaluateSession(a, chimera);
    checkShape(findings);
    const desync = findings.find((fd) => fd.id === 'motors-desync');
    expect(desync).toBeDefined();
    expect(desync?.severity).toBe('crit');
    expect(desync?.title).toContain('M2');
    expect(desync?.evidence).toContain('37');
    // crit trié en premier
    expect(findings[0].id).toBe('motors-desync');
  });

  it('yoyo → yoyo-detected warn avec les pics de fréquence', () => {
    const a = makeAnalysis((x) => {
      x.yoyo = {
        applicable: true,
        ratio: 1.8,
        verdict: 'yoyo',
        peaks: [
          { freqHz: 0.9, mag: 42 },
          { freqHz: 1.8, mag: 17 },
        ],
      };
    });
    const findings = evaluateSession(a, pico);
    checkShape(findings);
    const yo = findings.find((fd) => fd.id === 'yoyo-detected');
    expect(yo).toBeDefined();
    expect(yo?.severity).toBe('warn');
    expect(yo?.evidence).toContain('1.8');
    expect(yo?.evidence).toContain('0.9 Hz');
  });

  it('pic moteur proche → motor-noise-peak, et mention du filtre RPM inefficace', () => {
    const a = makeAnalysis((x) => {
      if (!x.spectrum || !x.filters.axes) throw new Error('spectrum/filters requis');
      x.spectrum.dominantPeak = { freqHz: 137, axis: 1, nearestMotor: 2, distanceHz: 1 };
      x.filters.axes[1] = { attenuationDb: [{ lo: 120, hi: 350, db: 8 }], residualHfRms: 0.6 };
    });
    const findings = evaluateSession(a, chimera);
    checkShape(findings);
    const peak = findings.find((fd) => fd.id === 'motor-noise-peak');
    expect(peak).toBeDefined();
    expect(peak?.title).toContain('M3'); // nearestMotor 0-based → M3
    expect(peak?.evidence).toContain('137');
    expect(peak?.detail).toMatch(/RPM/); // atténuation 8 dB < 15 → filtre RPM suspecté off
    // filters-weak déclenche aussi (8 dB < 15 dB)
    expect(ids(findings)).toContain('filters-weak');
  });

  it('cas dégradé : bruit, tracking, sag, failsafe, log court → tout remonte', () => {
    const a = makeAnalysis((x) => {
      x.meta = makeMeta({ durationS: 12, sampleRateHz: 500 });
      x.noise.axes[1] = { unfiltRms: 55, filtRms: 9, ratio: 6.1, gyroPeak: 800 };
      x.tracking.axes[0] = { meanAbsErr: 25, maxErr: 200, setpointMax: 600 };
      if (x.power) {
        x.power.sagV = 4.8; // 0.8 V/cellule → crit
        x.power.perCellMin = 3.1;
        x.power.perCellMinSustained = 3.1; // TENU sous 3.3 → battery-empty
      }
      x.failsafe = { phases: { '0': 900, '4': 12 }, triggered: true };
    });
    const findings = evaluateSession(a, chimera);
    checkShape(findings);
    const got = ids(findings);
    for (const expected of [
      'noise-mech-high',
      'noise-filtered-leak',
      'tracking-poor',
      'battery-sag',
      'battery-empty',
      'failsafe-triggered',
      'log-quality',
    ]) {
      expect(got).toContain(expected);
    }
    expect(got).not.toContain('all-good');
    // bruit 55 ≥ crit 45 (chimera7) et sag 0.8 ≥ crit 0.6
    expect(findings.find((fd) => fd.id === 'noise-mech-high')?.severity).toBe('crit');
    expect(findings.find((fd) => fd.id === 'battery-sag')?.severity).toBe('crit');
    // tracking-poor : gyro bruité → on demande de corriger le bruit d'abord
    expect(findings.find((fd) => fd.id === 'tracking-poor')?.detail).toMatch(/bruit/i);
    // log-quality : rate faible → CLI blackbox proposé
    expect(findings.find((fd) => fd.id === 'log-quality')?.fix?.cli).toEqual([
      'set blackbox_sample_rate = 1/1',
    ]);
  });

  it('mauvais pack : 4S sur le pico → battery-cells-unexpected', () => {
    const a = makeAnalysis((x) => {
      if (x.power) {
        x.power.cells = 4;
        x.power.vbatMax = 16.8;
        x.power.perCellMax = 4.2;
      }
    });
    const findings = evaluateSession(a, pico);
    checkShape(findings);
    const cells = findings.find((fd) => fd.id === 'battery-cells-unexpected');
    expect(cells).toBeDefined();
    expect(cells?.severity).toBe('warn');
    expect(cells?.evidence).toContain('4S');
    expect(cells?.evidence).toContain('2S');
  });

  it('propwash non testé + step overshoot/settle → info et warns dédiés', () => {
    const a = makeAnalysis((x) => {
      x.propwash = { applicable: false, events: [], worstSeverity: null, avgSeverity: null };
      if (x.step) {
        x.step.axes[0] = makeStep({ overshootPct: 40, peakValue: 1.4 });
        x.step.axes[2] = makeStep({ settleValue: 0.7 });
      }
    });
    const findings = evaluateSession(a, chimera);
    checkShape(findings);
    const got = ids(findings);
    expect(got).toContain('propwash-untested');
    expect(findings.find((fd) => fd.id === 'propwash-untested')?.severity).toBe('info');
    expect(got).toContain('step-overshoot');
    expect(findings.find((fd) => fd.id === 'step-overshoot')?.title).toContain('Roll');
    expect(got).toContain('step-settle-off');
    expect(findings.find((fd) => fd.id === 'step-settle-off')?.title).toContain('Yaw');
  });

  it('GPS faible → gps-low-sats warn', () => {
    const a = makeAnalysis((x) => {
      x.gps = { available: true, numSatMax: 11, numSatMin: 4, speedMaxMps: 25 };
    });
    const findings = evaluateSession(a, pickProfile('LR4-O4PRO'));
    checkShape(findings);
    const gps = findings.find((fd) => fd.id === 'gps-low-sats');
    expect(gps).toBeDefined();
    expect(gps?.severity).toBe('warn');
    expect(gps?.evidence).toContain('4');
  });

  it('les findings sont triés crit > warn > info > ok', () => {
    const a = makeAnalysis((x) => {
      x.motors.desyncZeros = [5, 0, 0, 0]; // crit
      x.motors.saturationPct = 5; // warn
      x.meta = makeMeta({ durationS: 10 }); // info
    });
    const findings = evaluateSession(a, chimera);
    const rank = { crit: 0, warn: 1, info: 2, ok: 3 } as const;
    for (let i = 1; i < findings.length; i++) {
      expect(rank[findings[i - 1].severity]).toBeLessThanOrEqual(rank[findings[i].severity]);
    }
  });
});

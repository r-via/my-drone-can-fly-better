// Tests de la comparaison de passes. Fixtures synthétiques pour les règles de
// composition, puis le sweep PID réel de shared-logs/ pour vérifier que le
// module lit bien une vraie session de tuning.
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

import { initWasm, parseFile } from '../src/lib/bbl/parse';
import {
  buildComparisons,
  compareMetrics,
  compareSessions,
  diffTune,
  sessionStartedAt,
  splitCommonCaveats,
} from '../src/lib/compare';
import { buildSessionReport } from '../src/lib/report';
import { pickProfile } from '../src/lib/rules/profiles';

import type { SessionAnalysis, SessionMeta, SessionReport } from '../src/lib/types';

const SWEEP = '/home/rviau/projects/drones/shared-logs/public/pid-sweep';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMeta(over: Partial<SessionMeta> = {}): SessionMeta {
  return {
    index: 0,
    fileName: 'a.bbl',
    craftName: 'TESTQUAD',
    firmware: 'Betaflight 2025.12.2 (abc) STM32F7X2',
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

/** SessionAnalysis réduite aux champs que compare.ts lit réellement. */
function makeAnalysis(over: Partial<SessionAnalysis> = {}): SessionAnalysis {
  return {
    meta: makeMeta(),
    power: {
      cells: 6,
      vbatMax: 25.2,
      vbatMin: 22.8,
      perCellMax: 4.2,
      perCellMin: 3.8,
      sagV: 1.2,
      ampAvg: 10,
      ampMax: 40,
      ampP99: 38,
      ampImplausible: false,
      mahEstimate: 800,
      perCellMinSustained: 3.8,
      implausibleSamples: 0,
    },
    motors: {
      avgPct: 30,
      perMotorAvgPct: [29, 30, 30, 31],
      imbalancePctPts: 2,
      saturationPct: 0.5,
      desyncZeros: [0, 0, 0, 0],
      erpmAvailable: true,
      escRpmAvailable: false,
      floorClipPct: 0,
      balanceShift: null,
    },
    noise: {
      axes: [
        { unfiltRms: 10, filtRms: 1.0, ratio: 10, gyroPeak: 200 },
        { unfiltRms: 12, filtRms: 1.5, ratio: 8, gyroPeak: 250 },
        { unfiltRms: 8, filtRms: 0.8, ratio: 10, gyroPeak: 90 },
      ],
    },
    spectrum: null,
    tracking: {
      axes: [
        { meanAbsErr: 3, maxErr: 40, setpointMax: 500 },
        { meanAbsErr: 4, maxErr: 55, setpointMax: 500 },
        { meanAbsErr: 1.5, maxErr: 20, setpointMax: 300 },
      ],
    },
    step: null,
    yoyo: { applicable: false, ratio: null, verdict: null, peaks: [] },
    propwash: { applicable: true, events: [], worstSeverity: 8, avgSeverity: 4 },
    oscillation: { applicable: false, baselineAmp: 0, events: [], worst: null },
    controlLoss: { applicable: true, events: [], worst: null },
    temperature: null,
    filters: { available: false, axes: null },
    timeline: { segments: [], flightTimeS: 110, throttleMaxUs: 1600 },
    gps: {
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
    track: null,
    },
    failsafe: { phases: {}, triggered: false },
    ...over,
  };
}

function makeReport(over: Partial<SessionAnalysis> = {}): SessionReport {
  const analysis = makeAnalysis(over);
  return { analysis, profile: pickProfile(analysis.meta.craftName), findings: [] };
}

/** Réponse indicielle minimale : seuls quality et les scalaires comptent ici. */
function step(quality: number, overshoot: number | null, ms: number | null = null) {
  return {
    t: new Float32Array(0),
    y: new Float32Array(0),
    riseTimeMs: 25,
    peakValue: 1.1,
    overshootPct: overshoot,
    settleValue: 1,
    quality,
    ms,
    msFreqHz: ms === null ? null : 20,
    mtDb: null,
    mtFreqHz: null,
    msBandTopHz: ms === null ? null : 30,
  };
}

// ---------------------------------------------------------------------------

describe('diffTune', () => {
  it('ne retient que les vrais réglages', () => {
    const changes = diffTune(
      { p_roll: '45', i_roll: '80', rc_smoothing_rx_smoothed: '250', vbat_scale: '110' },
      { p_roll: '50', i_roll: '80', rc_smoothing_rx_smoothed: '249', vbat_scale: '112' },
    );
    // i_roll identique, les deux autres sont des mesures écrites par le firmware.
    expect(changes.map((c) => c.key)).toEqual(['p_roll']);
    expect(changes[0]).toMatchObject({ before: '45', after: '50', driver: false });
  });

  it('met les curseurs simplifiés en tête, devant les gains qu’ils recalculent', () => {
    const changes = diffTune(
      { i_roll: '67', i_pitch: '84', simplified_i_gain: '60' },
      { i_roll: '100', i_pitch: '127', simplified_i_gain: '90' },
    );
    expect(changes[0].key).toBe('simplified_i_gain');
    expect(changes[0].driver).toBe(true);
    expect(changes.filter((c) => c.driver)).toHaveLength(1);
  });

  it('ignore un paramètre absent d’un seul côté (changement de version)', () => {
    const changes = diffTune({ d_min_roll: '30' }, { d_max_roll: '40' });
    expect(changes).toEqual([]);
  });

  it('ignore les cutoffs rc_smoothing calculés en vol (toute la famille)', () => {
    // Valeurs que le firmware recalcule à chaque vol : pas des réglages.
    const changes = diffTune(
      {
        rc_smoothing_active_cutoffs_ff_sp_thr: '93,93,107',
        rc_smoothing_rx_smoothed: '250',
        rc_smoothing_rx_average: '6689',
        p_roll: '45',
      },
      {
        rc_smoothing_active_cutoffs_ff_sp_thr: '94,94,107',
        rc_smoothing_rx_smoothed: '249',
        rc_smoothing_rx_average: '6687',
        p_roll: '45',
      },
    );
    expect(changes).toEqual([]); // rien de réel n'a bougé
  });

  it('garde les cutoffs rc_smoothing RÉGLÉS par le pilote', () => {
    const changes = diffTune(
      { rc_smoothing_setpoint_cutoff: '0', rc_smoothing_auto_factor: '30' },
      { rc_smoothing_setpoint_cutoff: '20', rc_smoothing_auto_factor: '30' },
    );
    expect(changes.map((c) => c.key)).toEqual(['rc_smoothing_setpoint_cutoff']);
  });
});

describe('compareMetrics', () => {
  it('compare le pire axe de chaque vol et publie les deux axes', () => {
    const before = makeAnalysis();
    const after = makeAnalysis({
      noise: {
        axes: [
          { unfiltRms: 10, filtRms: 3.0, ratio: 3, gyroPeak: 200 }, // roll devient le pire
          { unfiltRms: 12, filtRms: 1.0, ratio: 12, gyroPeak: 250 },
          { unfiltRms: 8, filtRms: 0.8, ratio: 10, gyroPeak: 90 },
        ],
      },
    });
    const filt = compareMetrics(before, after).find((m) => m.id === 'filtNoise')!;
    expect(filt.beforeAxis).toBe(1); // pitch
    expect(filt.afterAxis).toBe(0); // roll
    expect(filt.before).toBeCloseTo(1.5);
    expect(filt.after).toBeCloseTo(3.0);
    expect(filt.delta).toBeCloseTo(1.5); // le delta reste calculé : c'est un résumé
  });

  it('omet une métrique absente des deux vols', () => {
    const ids = compareMetrics(makeAnalysis(), makeAnalysis()).map((m) => m.id);
    expect(ids).not.toContain('residualHf'); // filters.available = false
    expect(ids).not.toContain('overshoot'); // step = null
    expect(ids).toContain('filtNoise');
  });

  it('écarte un axe step sous le seuil de qualité du moteur de règles', () => {
    // Même chiffre des deux côtés, mais une déconvolution trop bruitée à droite :
    // le rapport refuse de juger cet axe, la comparaison doit refuser aussi.
    const good = makeAnalysis({ step: { axes: [step(0.8, 30), null, null] } });
    const noisy = makeAnalysis({ step: { axes: [step(0.1, 160), null, null] } });
    const m = compareMetrics(good, noisy).find((x) => x.id === 'overshoot')!;
    expect(m.before).toBe(30);
    expect(m.after).toBeNull();
    expect(m.delta).toBeNull();
  });

  it('le bruit brut est un témoin, pas une note', () => {
    const m = compareMetrics(makeAnalysis(), makeAnalysis()).find((x) => x.id === 'unfiltNoise')!;
    expect(m.better).toBe('neutral');
  });
});

describe('caveats', () => {
  const withHeaders = (h: Record<string, string>, over: Partial<SessionAnalysis> = {}) =>
    makeReport({ meta: makeMeta({ headers: h }), ...over });

  it('deux vols identiques n’en produisent aucun', () => {
    expect(compareSessions(makeReport(), makeReport()).caveats).toEqual([]);
  });

  it('signale un changement de firmware majeur', () => {
    const after = makeReport({ meta: makeMeta({ firmware: 'Betaflight 4.5.2 (xyz) STM32F7X2' }) });
    const ids = compareSessions(makeReport(), after).caveats.map((c) => c.id);
    expect(ids).toContain('firmware');
  });

  it('signale un échantillonnage et une durée incomparables', () => {
    const after = makeReport({ meta: makeMeta({ sampleRateHz: 1000, durationS: 20 }) });
    const ids = compareSessions(makeReport(), after).caveats.map((c) => c.id);
    expect(ids).toContain('sampleRate');
    expect(ids).toContain('duration');
  });

  it('signale un style de vol différent, qui déplace dépassement et prop wash', () => {
    const after = makeReport({
      tracking: {
        axes: [
          { meanAbsErr: 3, maxErr: 40, setpointMax: 200 }, // vol nettement plus calme
          { meanAbsErr: 4, maxErr: 55, setpointMax: 200 },
          { meanAbsErr: 1.5, maxErr: 20, setpointMax: 150 },
        ],
      },
    });
    expect(compareSessions(makeReport(), after).caveats.map((c) => c.id)).toContain('stickRange');
  });

  it('signale un état mécanique changé : le gyro brut ne répond pas au tune', () => {
    const after = makeReport({
      noise: {
        axes: [
          { unfiltRms: 30, filtRms: 1.0, ratio: 30, gyroPeak: 400 },
          { unfiltRms: 32, filtRms: 1.5, ratio: 21, gyroPeak: 450 },
          { unfiltRms: 28, filtRms: 0.8, ratio: 35, gyroPeak: 300 },
        ],
      },
    });
    expect(compareSessions(makeReport(), after).caveats.map((c) => c.id)).toContain('mechanical');
  });

  it('signale une batterie incomparable, sauf si la compensation de sag est active', () => {
    // 6S : 3.0 V de sag = 0.50 V/cellule (pack fatigué) contre 0.6 V = 0.10
    // V/cellule (pack frais). 0.40 V d'écart, au-dessus du seuil de 0.25.
    const tired = { power: { ...makeAnalysis().power!, sagV: 3.0 } };
    const fresh = { power: { ...makeAnalysis().power!, sagV: 0.6 } };
    const sansComp = compareSessions(withHeaders({}, tired), withHeaders({}, fresh));
    expect(sansComp.caveats.map((c) => c.id)).toContain('battery');

    // Compensation active des deux côtés : la poussée est tenue, on se tait.
    const h = { vbat_sag_compensation: '60' };
    const avecComp = compareSessions(withHeaders(h, tired), withHeaders(h, fresh));
    expect(avecComp.caveats.map((c) => c.id)).not.toContain('battery');

    // Compensation active d'un seul côté : ça ne suffit pas.
    const moitie = compareSessions(withHeaders(h, tired), withHeaders({}, fresh));
    expect(moitie.caveats.map((c) => c.id)).toContain('battery');
  });
});

describe('sessionStartedAt', () => {
  it('lit l’horodatage ISO du log', () => {
    const d = sessionStartedAt({ 'Log start datetime': '2026-07-08T15:32:58.580+00:00' });
    expect(d?.getUTCFullYear()).toBe(2026);
  });

  it('traite l’époque zéro comme une absence de date (carte sans RTC)', () => {
    expect(sessionStartedAt({ 'Log start datetime': '0000-01-01T00:00:00.000+00:00' })).toBeNull();
    expect(sessionStartedAt({ 'Log start datetime': 'n/a' })).toBeNull();
    expect(sessionStartedAt({})).toBeNull();
  });
});

describe('buildComparisons', () => {
  const dated = (iso: string, craft: string, name: string) =>
    makeReport({ meta: makeMeta({ craftName: craft, fileName: name, headers: { 'Log start datetime': iso } }) });

  it('chaîne les passes du même quad dans l’ordre du temps', () => {
    // Volontairement donné à l'envers : c'est l'horodatage qui doit trancher.
    const cmps = buildComparisons([
      dated('2026-07-08T15:00:00Z', 'QUAD', 'tard.bbl'),
      dated('2026-07-08T09:00:00Z', 'QUAD', 'tot.bbl'),
    ]);
    expect(cmps).toHaveLength(1);
    expect(cmps[0].before.fileName).toBe('tot.bbl');
    expect(cmps[0].after.fileName).toBe('tard.bbl');
  });

  it('sans horodatage, garde l’ordre de lecture', () => {
    const cmps = buildComparisons([
      makeReport({ meta: makeMeta({ fileName: 'un.bbl' }) }),
      makeReport({ meta: makeMeta({ fileName: 'deux.bbl' }) }),
    ]);
    expect(cmps[0].before.fileName).toBe('un.bbl');
    expect(cmps[0].after.fileName).toBe('deux.bbl');
  });

  it('ne mélange jamais deux quads, ni ne compare un vol isolé', () => {
    const cmps = buildComparisons([
      makeReport({ meta: makeMeta({ craftName: 'A', fileName: 'a1.bbl' }) }),
      makeReport({ meta: makeMeta({ craftName: 'B', fileName: 'b1.bbl' }) }),
      makeReport({ meta: makeMeta({ craftName: 'A', fileName: 'a2.bbl' }) }),
    ]);
    expect(cmps).toHaveLength(1);
    expect([cmps[0].before.craftName, cmps[0].after.craftName]).toEqual(['A', 'A']);
  });

  it('ignore une session sans craft name NI carte : rien pour regrouper', () => {
    const cmps = buildComparisons([
      makeReport({ meta: makeMeta({ craftName: undefined, boardInfo: undefined }) }),
      makeReport({ meta: makeMeta({ craftName: undefined, boardInfo: undefined }) }),
    ]);
    expect(cmps).toEqual([]);
  });

  it('sans craft name, retombe sur la carte avec un caveat en tête', () => {
    // Cas réel des logs user_logs : pilote sans craft_name, une seule carte.
    const cmps = buildComparisons([
      makeReport({ meta: makeMeta({ craftName: undefined, boardInfo: 'GEPRC_F722', fileName: 'a.bbl' }) }),
      makeReport({ meta: makeMeta({ craftName: undefined, boardInfo: 'GEPRC_F722', fileName: 'b.bbl' }) }),
    ]);
    expect(cmps).toHaveLength(1);
    expect(cmps[0].caveats[0].id).toBe('inferredCraft'); // en tête
    expect(cmps[0].caveats[0].args[0]).toBe('GEPRC_F722');
  });

  it('ne regroupe pas deux cartes différentes, même sans craft name', () => {
    const cmps = buildComparisons([
      makeReport({ meta: makeMeta({ craftName: undefined, boardInfo: 'GEPRC_F722' }) }),
      makeReport({ meta: makeMeta({ craftName: undefined, boardInfo: 'SPEEDYBEE_F405' }) }),
    ]);
    expect(cmps).toEqual([]);
  });

  it('un craft name présent est prioritaire sur la carte (pas de caveat inféré)', () => {
    const cmps = buildComparisons([
      makeReport({ meta: makeMeta({ craftName: 'MonQuad', boardInfo: 'GEPRC_F722', fileName: 'a.bbl' }) }),
      makeReport({ meta: makeMeta({ craftName: 'MonQuad', boardInfo: 'GEPRC_F722', fileName: 'b.bbl' }) }),
    ]);
    expect(cmps).toHaveLength(1);
    expect(cmps[0].caveats.map((c) => c.id)).not.toContain('inferredCraft');
  });
});

describe('splitCommonCaveats', () => {
  const board = (name: string) =>
    makeReport({ meta: makeMeta({ craftName: undefined, boardInfo: 'GEPRC_F722', fileName: name }) });

  it('hisse le caveat identique répété sur toutes les paires', () => {
    // 4 vols anonymes même carte → 3 paires, chacune avec `inferredCraft`.
    const cmps = buildComparisons([board('a.bbl'), board('b.bbl'), board('c.bbl'), board('d.bbl')]);
    expect(cmps).toHaveLength(3);
    const { common, perPair } = splitCommonCaveats(cmps);
    expect(common.map((c) => c.id)).toEqual(['inferredCraft']);
    for (const cmp of perPair) {
      expect(cmp.caveats.map((c) => c.id)).not.toContain('inferredCraft');
    }
  });

  it('ne hisse pas un caveat aux arguments différents (propre à chaque paire)', () => {
    // Le sag varie d'une paire à l'autre : même id, args différents → il reste local.
    const sag = (v: number) => makeReport({ power: { ...makeAnalysis().power!, sagV: v } });
    const cmps = buildComparisons([sag(0.6), sag(3.0), sag(0.6)]);
    const { common, perPair } = splitCommonCaveats(cmps);
    expect(common).toEqual([]);
    expect(perPair.flatMap((c) => c.caveats.map((x) => x.id))).toContain('battery');
  });

  it('sur une seule paire, rien à factoriser', () => {
    const cmps = buildComparisons([board('a.bbl'), board('b.bbl')]);
    const { common, perPair } = splitCommonCaveats(cmps);
    expect(common).toEqual([]);
    expect(perPair[0].caveats.map((c) => c.id)).toContain('inferredCraft');
  });
});

// ---------------------------------------------------------------------------
// Sweep PID réel : deux vols qui ne diffèrent que par simplified_i_gain
// ---------------------------------------------------------------------------

describe('sweep PID réel (i_06 → i_09)', () => {
  let cmp: ReturnType<typeof compareSessions>;

  beforeAll(async () => {
    await initWasm(await readFile('public/blackbox-log.wasm'));
    const load = async (name: string): Promise<SessionReport> => {
      const parsed = await parseFile(name, new Uint8Array(await readFile(`${SWEEP}/${name}`)));
      return buildSessionReport(parsed.sessions[0]);
    };
    cmp = compareSessions(await load('i_06.bbl'), await load('i_09.bbl'));
  }, 60_000);

  it('isole le curseur bougé et les gains qu’il a recalculés', () => {
    const keys = cmp.tuneChanges.map((c) => c.key);
    expect(keys[0]).toBe('simplified_i_gain'); // le curseur d'abord
    expect(cmp.tuneChanges[0]).toMatchObject({ before: '60', after: '90' });
    expect(keys).toEqual(expect.arrayContaining(['i_roll', 'i_pitch', 'i_yaw']));
    // Rien d'autre n'a bougé : un sweep propre ne touche qu'un paramètre.
    expect(keys.filter((k) => !k.startsWith('i_') && !k.startsWith('simplified_'))).toEqual([]);
  });

  it('produit des deltas exploitables sur les indicateurs mesurés', () => {
    const byId = new Map(cmp.metrics.map((m) => [m.id, m]));
    const tracking = byId.get('tracking')!;
    expect(tracking.before).not.toBeNull();
    expect(tracking.after).not.toBeNull();
    expect(tracking.delta).toBeCloseTo(tracking.after! - tracking.before!, 5);
  });
});

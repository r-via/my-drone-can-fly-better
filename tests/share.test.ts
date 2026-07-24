// Codec de partage : fixtures SessionAnalysis synthétiques, aucun parsing de
// log nécessaire.
//
// Le test qui compte vraiment est « rendu identique dans les 5 langues » : le
// codec ne transporte pas les phrases mais des gabarits qui rappellent le
// dictionnaire du lecteur, et ces gabarits sont capturés en rejouant les règles
// avec un dictionnaire espion. Ce mécanisme est automatique, donc il ne dérive
// pas quand une règle est ajoutée - mais il se casserait en silence si une
// règle composait ses phrases d'une façon encore inconnue. Quatre façons ont
// déjà été rencontrées, chacune couverte ci-dessous par une fixture dédiée :
//   - une liste assemblée puis passée en argument (log-quality)
//   - un champ au nom variable selon le cas (tracking-poor : fixCleanGyro)
//   - un texte emprunté à une autre entrée (step-overshoot : suffixe confiance)
//   - le libellé du profil, lui-même traduit, passé en argument (all-good)

import { describe, expect, it } from 'vitest';

import { configFromHeaders } from '../src/lib/cli/config';
import { LOCALES, getDict } from '../src/lib/i18n';
import { composeFindings } from '../src/lib/report';
import { pickProfile } from '../src/lib/rules/profiles';
import {
  DEFAULT_MAX_CHARS,
  ShareDecodeError,
  decodeSession,
  encodeSession,
  encodeSessionAdaptive,
} from '../src/lib/share/codec';

import type { Locale } from '../src/lib/i18n';
import type {
  AxisSpectrum,
  AxisStepResponse,
  Finding,
  SessionAnalysis,
  SessionReport,
} from '../src/lib/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// 43 et pas 40 : la décimation ramène 512 points à 128, soit un point sur 4.
// Un pic sur un multiple de 4 tomberait pile sur la grille et survivrait même
// à un simple échantillonnage - la fixture ne prouverait alors rien du
// max-pooling. 43 n'est pas un multiple de 4.
function makeAxisSpectrum(peakBin = 43): AxisSpectrum {
  const freqs = new Float32Array(512);
  const mags = new Float32Array(512);
  for (let i = 0; i < 512; i++) {
    freqs[i] = (i * 1000) / 512;
    // Fond décroissant + une résonance étroite : le max-pooling doit la garder.
    mags[i] = 100 / (1 + i) + (i === peakBin ? 5000 : 0);
  }
  return {
    bands: [{ lo: 120, hi: 350, label: 'plage moteur 120-350Hz', rms: 600 }],
    dominantBand: 'plage moteur 120-350Hz',
    peaks: [{ freqHz: freqs[peakBin], mag: 5000 }],
    freqs,
    mags,
  };
}

function makeStep(over: Partial<AxisStepResponse> = {}): AxisStepResponse {
  const t = new Float32Array(200);
  const y = new Float32Array(200);
  for (let i = 0; i < 200; i++) {
    t[i] = (i * 0.5) / 200;
    y[i] = 1 - Math.exp(-i / 20) + (i > 20 && i < 60 ? 0.3 : 0);
  }
  // Métriques volontairement saines : c'est `all-good` qui cite le libellé du
  // profil, et il ne se déclenche qu'en l'absence de warn/crit. La courbe, elle,
  // garde un dépassement marqué pour que le test de tracé ait quelque chose à
  // vérifier - les règles lisent les scalaires, pas la courbe.
  return {
    t,
    y,
    riseTimeMs: 30,
    peakValue: 1.1,
    overshootPct: 10,
    settleValue: 1,
    quality: 0.8,
    ms: 1.2,
    msFreqHz: 28,
    mtDb: 0.9,
    mtFreqHz: 24,
    msBandTopHz: 26,
    ...over,
  };
}

function makeAnalysis(mutate?: (a: SessionAnalysis) => void): SessionAnalysis {
  const a: SessionAnalysis = {
    meta: {
      index: 0,
      fileName: 'btfl_synth.bbl',
      craftName: 'SHIMERA7PRO',
      boardInfo: 'SYNTH',
      firmware: 'Betaflight 2025.12.2 (synthetic) STM32F7X2',
      fieldNames: [],
      sampleRateHz: 2000,
      durationS: 120,
      frameCount: 240_000,
      motorOutputLow: 48,
      motorOutputHigh: 2047,
      headers: {},
    },
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
      saturationPct: 0.1,
      desyncZeros: [0, 0, 0, 0],
      erpmAvailable: true,
      escRpmAvailable: false,
      floorClipPct: 0,
      balanceShift: null,
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
      perMotorHz: null,
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
    controlLoss: { applicable: true, events: [], worst: null },
    temperature: null,
    filters: {
      available: true,
      axes: [
        { attenuationDb: [{ lo: 120, hi: 350, db: 25 }], residualHfRms: 0.5, motorBandUnfiltRms: 200 },
        { attenuationDb: [{ lo: 120, hi: 350, db: 24 }], residualHfRms: 0.6, motorBandUnfiltRms: 200 },
        { attenuationDb: [{ lo: 120, hi: 350, db: 26 }], residualHfRms: 0.4, motorBandUnfiltRms: 200 },
      ],
    },
    timeline: {
      segments: [
        { tStart: 0, tEnd: 5, state: 'idle', stickAvg: 0, thrustPct: 0, vbat: 25.2 },
        { tStart: 5, tEnd: 110, state: 'flight', stickAvg: 40, thrustPct: 35, vbat: 23.5 },
        { tStart: 110, tEnd: 120, state: 'low', stickAvg: 5, thrustPct: 5, vbat: 22.8 },
      ],
      flightTimeS: 105,
      throttleMaxUs: 1600,
    },
    gps: {
      available: true,
      numSatMax: 14,
      numSatMin: 9,
      numSatMedian: 12,
      speedMaxMps: 20,
      corruptFrameRatio: 0,
      timeToHealthySatsS: 3,
      satDrops: [],
      satsVsThrottle: null,
      hdopMedian: null,
      hdopWorst: null,
    track: null,
    },
    failsafe: { phases: { '0': 240_000 }, triggered: false },
  };
  mutate?.(a);
  return a;
}

function makeReport(analysis: SessionAnalysis, locale: Locale = 'fr'): SessionReport {
  const profile = pickProfile(analysis.meta.craftName);
  const config = configFromHeaders(analysis.meta.headers);
  return { analysis, profile, findings: composeFindings(analysis, profile, config, getDict(locale)) };
}

/** Les fixtures couvrent chaque forme de composition de phrase connue. */
const CASES: Array<{ name: string; analysis: SessionAnalysis }> = [
  { name: 'vol sain (libellé de profil en argument)', analysis: makeAnalysis() },
  {
    name: 'log court et sous-échantillonné (liste assemblée)',
    analysis: makeAnalysis((a) => {
      a.meta.durationS = 8;
      a.meta.sampleRateHz = 500;
    }),
  },
  {
    name: 'suivi médiocre, gyro propre (champ au nom variable)',
    analysis: makeAnalysis((a) => {
      a.tracking.axes[0].meanAbsErr = 40;
    }),
  },
  {
    name: 'suivi médiocre, gyro bruité (autre nom de champ)',
    analysis: makeAnalysis((a) => {
      a.tracking.axes[0].meanAbsErr = 40;
      a.noise.axes[0].filtRms = 12;
      a.noise.axes[0].unfiltRms = 60;
    }),
  },
  {
    name: 'overshoot peu fiable (texte emprunté à une autre entrée)',
    analysis: makeAnalysis((a) => {
      a.step = { axes: [makeStep({ overshootPct: 45, quality: 0.3 }), null, null] };
    }),
  },
  {
    name: 'batterie à plat et moteurs saturés',
    analysis: makeAnalysis((a) => {
      a.power!.vbatMin = 19.2;
      a.power!.perCellMin = 3.2;
      a.power!.perCellMinSustained = 3.2;
      a.power!.sagV = 3.6;
      a.motors.saturationPct = 12;
      a.motors.imbalancePctPts = 14;
    }),
  },
  {
    name: 'sans batterie ni GPS',
    analysis: makeAnalysis((a) => {
      a.power = null;
      a.gps = {
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
      };
    }),
  },
  {
    // Profil LR4 et pas chimera7 : son libellé est le seul du parc à être
    // réellement traduit (« long range 4S GPS » / « 4S long range, GPS » /
    // « Long Range 4S GPS »). Avec chimera7, dont le libellé est identique en
    // fr, en et de, un lien qui figerait ce libellé passerait inaperçu.
    name: 'profil au libellé traduit (LR4)',
    analysis: makeAnalysis((a) => {
      a.meta.craftName = 'LR4-O4PRO';
      a.power = { ...a.power!, cells: 4, vbatMax: 16.8, vbatMin: 15.2, perCellMax: 4.2, perCellMin: 3.8 };
    }),
  },
  {
    // counterNote : seul argument d'evidence qui est LUI-MÊME un gabarit du
    // dictionnaire (marqueur imbriqué) - le cas que parseTemplate doit récurser.
    name: 'désync en vol : rupture d équilibre, écrêtage bas, perte de contrôle (INAV)',
    analysis: makeAnalysis((a) => {
      a.meta.firmwareFamily = 'inav';
      a.motors.floorClipPct = 22.4;
      a.motors.balanceShift = {
        motor: 7,
        tChangeS: 5.8,
        deltaPctPts: 17.4,
        beforeDevPts: 7.4,
        afterDevPts: 24.9,
        counterMotor: 2,
        counterDeltaPctPts: -18.2,
      };
      a.controlLoss = {
        applicable: true,
        events: [
          {
            tStart: 4.35,
            tEnd: 4.43,
            axis: 0,
            peakErrDps: 584,
            peakExcessDps: 547,
            peakSpreadPct: 83,
            floorTouched: true,
            ceilTouched: false,
          },
        ],
        worst: {
          tStart: 4.35,
          tEnd: 4.43,
          axis: 0,
          peakErrDps: 584,
          peakExcessDps: 547,
          peakSpreadPct: 83,
          floorTouched: true,
          ceilTouched: false,
        },
      };
    }),
  },
];

function key(f: Finding): string {
  return [f.id, f.severity, f.category, f.title, f.detail, f.evidence, f.fix?.text ?? '', (f.fix?.cli ?? []).join('|')].join('␟');
}

// ---------------------------------------------------------------------------

describe('codec de partage', () => {
  it.each(CASES)('conserve les verdicts à l identique - $name', async ({ analysis }) => {
    const dict = getDict('fr');
    const sr = makeReport(analysis);
    expect(sr.findings.length, 'fixture sans verdict : elle ne teste rien').toBeGreaterThan(0);

    const { encoded } = await encodeSessionAdaptive(sr, 'btfl_synth.bbl', dict);
    const back = await decodeSession(encoded, dict);
    const got = back.files[0].sessionReports[0].findings;

    expect(got.map(key)).toEqual(sr.findings.map(key));
  });

  it.each(CASES)('rend le même texte dans les 5 langues - $name', async ({ analysis }) => {
    // Lien émis en français, relu dans chaque langue : le résultat doit être
    // celui d'une analyse native, sans le moindre reste de la langue d'origine.
    const { encoded } = await encodeSessionAdaptive(makeReport(analysis), 'btfl_synth.bbl', getDict('fr'));

    for (const { code } of LOCALES) {
      const dict = getDict(code);
      const decoded = (await decodeSession(encoded, dict)).files[0].sessionReports[0].findings;
      const native = makeReport(analysis, code).findings;
      expect(decoded.map(key), `fuite de langue en ${code}`).toEqual(native.map(key));
    }
  });

  it('ne laisse jamais fuir un marqueur interne dans le rendu', async () => {
    for (const { analysis } of CASES) {
      const { encoded } = await encodeSessionAdaptive(makeReport(analysis), 'x.bbl', getDict('fr'));
      const decoded = (await decodeSession(encoded, getDict('de'))).files[0].sessionReports[0].findings;
      for (const f of decoded) {
        expect(key(f), `marqueur brut dans ${f.id}`).not.toMatch(new RegExp("[\\u0000-\\u0008]"));
        expect(f.title.length, `titre vide pour ${f.id}`).toBeGreaterThan(0);
        expect(f.detail.length, `explication vide pour ${f.id}`).toBeGreaterThan(0);
        expect(f.evidence.length, `evidence vide pour ${f.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('tient dans le budget d un message Discord', async () => {
    for (const { name, analysis } of CASES) {
      const res = await encodeSessionAdaptive(makeReport(analysis), 'btfl_synth.bbl', getDict('fr'));
      expect(res.encoded.length, `${name} déborde sans être signalé`).toBeLessThanOrEqual(
        res.overBudget ? Number.POSITIVE_INFINITY : DEFAULT_MAX_CHARS,
      );
      // Le dépassement doit rester l'exception : ces fixtures tiennent toutes.
      expect(res.overBudget, `${name} ne tient plus dans le budget`).toBe(false);
    }
  });

  it('restitue les valeurs affichées par le bandeau et les tuiles', async () => {
    const analysis = makeAnalysis();
    const dict = getDict('fr');
    const { encoded } = await encodeSessionAdaptive(makeReport(analysis), 'btfl_synth.bbl', dict);
    const got = (await decodeSession(encoded, dict)).files[0].sessionReports[0].analysis;

    expect(got.meta.craftName).toBe('SHIMERA7PRO');
    expect(got.meta.boardInfo).toBe('SYNTH');
    expect(got.meta.firmware).toBe(analysis.meta.firmware);
    expect(got.meta.durationS).toBeCloseTo(120, 1);
    expect(got.meta.sampleRateHz).toBeCloseTo(2000, 0);
    expect(got.timeline.flightTimeS).toBeCloseTo(105, 1);
    expect(got.motors.saturationPct).toBeCloseTo(0.1, 2);
    expect(got.power?.cells).toBe(6);
    expect(got.power?.sagV).toBeCloseTo(1.2, 2);
    expect(got.power?.ampMax).toBeCloseTo(40, 1);
    expect(got.gps.available).toBe(true);
  });

  it('laisse power à null quand le log n a pas de vbat', async () => {
    const dict = getDict('fr');
    const analysis = makeAnalysis((a) => {
      a.power = null;
    });
    const { encoded } = await encodeSessionAdaptive(makeReport(analysis), 'x.bbl', dict);
    const got = (await decodeSession(encoded, dict)).files[0].sessionReports[0].analysis;
    expect(got.power).toBeNull();
  });

  it('reconstruit les courbes en gardant la résonance et les bornes', async () => {
    const dict = getDict('fr');
    const analysis = makeAnalysis();
    const sr = makeReport(analysis);
    // Encodage direct : l'adaptatif pourrait décider de sacrifier les courbes.
    const encoded = await encodeSession(sr, 'x.bbl', dict);
    const got = (await decodeSession(encoded, dict)).files[0].sessionReports[0].analysis;

    const ax = got.spectrum!.axes[0];
    expect(ax.freqs.length).toBeGreaterThan(0);
    expect(ax.freqs.length).toBe(ax.mags.length);
    expect(ax.freqs[0]).toBeCloseTo(0, 3);
    expect(ax.freqs[ax.freqs.length - 1]).toBeCloseTo(analysis.spectrum!.axes[0].freqs[511], 0);

    // Le pic doit survivre à la décimation, et rester au bon endroit : le
    // max-pooling est là pour ça, un simple échantillonnage l'effacerait.
    const source = analysis.spectrum!.axes[0];
    const peakHz = source.freqs[source.mags.indexOf(Math.max(...source.mags))];
    let gotPeakHz = 0;
    let best = -Infinity;
    for (let i = 0; i < ax.mags.length; i++) {
      if (ax.mags[i] > best) {
        best = ax.mags[i];
        gotPeakHz = ax.freqs[i];
      }
    }
    // Le max-pooling reporte le maximum du seau au DÉBUT du seau : la
    // résonance est donc localisée à une largeur de seau près, et pas mieux.
    // C'est la précision réelle du procédé, pas une tolérance de confort.
    const bucketHz = (ax.freqs[ax.freqs.length - 1] - ax.freqs[0]) / (ax.freqs.length - 1);
    expect(Math.abs(gotPeakHz - peakHz)).toBeLessThanOrEqual(bucketHz);
    // Et son amplitude doit survivre : un échantillonnage qui raterait le bin
    // ne rapporterait que le fond, des centaines de fois plus bas.
    expect(best).toBeGreaterThan(Math.max(...source.mags) * 0.9);

    // Le plancher de bruit aussi : le graphe affiche √(mag), une quantification
    // linéaire écrasait tout le fond sur les niveaux 0-2 et une page partagée
    // montrait un plancher plat à zéro. La quantification en domaine racine
    // doit garder chaque point du dernier quart au bon ordre de grandeur.
    const quarter = Math.floor(ax.mags.length * 0.75);
    for (let i = quarter; i < ax.mags.length; i++) {
      const srcAtF = 100 / (1 + Math.round((ax.freqs[i] / 1000) * 512));
      expect(ax.mags[i]).toBeGreaterThan(srcAtF / 4);
      expect(ax.mags[i]).toBeLessThan(srcAtF * 4);
    }

    const step = got.step!.axes[0]!;
    expect(step.t.length).toBeGreaterThan(0);
    expect(step.t[step.t.length - 1]).toBeCloseTo(0.4975, 2);
    expect(Math.max(...step.y)).toBeGreaterThan(1.1); // l'overshoot n'est pas écrasé
    // La quality voyage avec la courbe : sans elle, une page partagée rendrait
    // plein trait un axe que le graphe local estompe comme non fiable.
    expect(step.quality).toBeCloseTo(0.8, 5);
  });

  it('signale le mode dégradé et retire alors tous les graphes', async () => {
    const dict = getDict('fr');
    const sr = makeReport(makeAnalysis());
    const encoded = await encodeSession(sr, 'x.bbl', dict, true);
    const report = await decodeSession(encoded, dict);

    expect(report.shared?.trimmed).toBe(true);
    const got = report.files[0].sessionReports[0].analysis;
    expect(got.spectrum).toBeNull();
    expect(got.step).toBeNull();
    // La frise est un graphe elle aussi : elle saute avec les autres.
    expect(got.timeline.segments).toHaveLength(0);
    // Mais les verdicts, eux, restent intacts.
    expect(report.files[0].sessionReports[0].findings.map(key)).toEqual(sr.findings.map(key));
  });

  it('marque un rapport non partagé comme complet', async () => {
    const dict = getDict('fr');
    const { encoded } = await encodeSessionAdaptive(makeReport(makeAnalysis()), 'x.bbl', dict);
    const report = await decodeSession(encoded, dict);
    expect(report.shared).toEqual({ trimmed: false });
  });

  it('rejette une chaîne illisible', async () => {
    const dict = getDict('fr');
    await expect(decodeSession('pas-du-tout-un-lien', dict)).rejects.toBeInstanceOf(ShareDecodeError);
    await expect(decodeSession('', dict)).rejects.toBeInstanceOf(ShareDecodeError);
    await expect(decodeSession('////', dict)).rejects.toMatchObject({ reason: 'malformed' });
  });

  it('distingue un lien d une autre version d un lien corrompu', async () => {
    const dict = getDict('fr');
    // `ver` reste en clair dans le payload, justement pour rester lisible quand
    // tout le reste a changé de forme.
    const bytes = new Uint8Array(
      await new Response(
        new Blob([JSON.stringify({ ver: 999 })]).stream().pipeThrough(new CompressionStream('gzip')),
      ).arrayBuffer(),
    );
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    const encoded = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    await expect(decodeSession(encoded, dict)).rejects.toMatchObject({ reason: 'version' });
  });
});

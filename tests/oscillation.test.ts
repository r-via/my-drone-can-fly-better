// Détection d'oscillations : contrat sur les ÉVÉNEMENTS (datés, mesurés), pas
// sur un agrégat. Un golden d'événements est vérifiable, contrairement à un
// texte de verdict : si une régression décale une date, change une fréquence ou
// fait disparaître un épisode, le diff le montre directement.
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

import { analyzeOscillation } from '../src/lib/analysis/oscillation';
import { initWasm, parseFile } from '../src/lib/bbl/parse';
import { buildSessionReport } from '../src/lib/report';
import type { F32x3, F32x4, FlightData, SessionMeta } from '../src/lib/types';

/** Racer 5" 6S (DAKE F722) : oscillation 36 Hz à t=13.7 s, log partagé sur Discord. */
const RACER = '/home/rviau/projects/drones/shared-logs/dake-f722-racer-oscillation.bbl';
const CHIMERA = '/home/rviau/projects/drones/chimera/blackbox/btfl_016.bbl';
const LR4 = '/home/rviau/projects/drones/explorer lr4/btfl_003.bbl';
const PICO = '/home/rviau/projects/drones/pavo pico/btfl_002.bbl';

let racer: FlightData;
let chimera: FlightData;
let lr4: FlightData;
let pico: FlightData;

beforeAll(async () => {
  await initWasm(await readFile(new URL('../public/blackbox-log.wasm', import.meta.url)));
  const load = async (p: string, name: string) =>
    (await parseFile(name, new Uint8Array(await readFile(p)))).sessions[0];
  racer = await load(RACER, 'dake-f722-racer-oscillation.bbl');
  chimera = await load(CHIMERA, 'btfl_016.bbl');
  lr4 = await load(LR4, 'btfl_003.bbl');
  pico = await load(PICO, 'btfl_002.bbl');
});

// ---------------------------------------------------------------------------
// Fabrique de FlightData synthétiques (différentiel moteur pilotable)
// ---------------------------------------------------------------------------

interface SynthOpts {
  durS?: number;
  fs?: number;
  throttle?: number;
  collective?: number;
  /** Écart appliqué à M1/M3 (M2/M4 reçoivent l'opposé) : le différentiel. */
  diff?: (t: number) => number;
}

function makeFd(opts: SynthOpts = {}): FlightData {
  const fs = opts.fs ?? 2000;
  const durS = opts.durS ?? 10;
  const n = Math.round(durS * fs);
  const time = new Float64Array(n);
  const throttle = new Float32Array(n);
  const gyro: F32x3 = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const setpoint: F32x3 = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const motor: F32x4 = [
    new Float32Array(n),
    new Float32Array(n),
    new Float32Array(n),
    new Float32Array(n),
  ];
  const col = opts.collective ?? 1000;
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    time[i] = t;
    throttle[i] = opts.throttle ?? 1500;
    const d = opts.diff ? opts.diff(t) : 0;
    // Bruit déterministe (pas de Math.random) : sans lui la médiane de
    // l'enveloppe est nulle et le détecteur sort en "non applicable".
    const noise = 4 * Math.sin(t * 137.1) + 3 * Math.sin(t * 311.7);
    for (let k = 0; k < 4; k++) {
      const sign = k === 0 || k === 2 ? 1 : -1;
      motor[k][i] = Math.max(48, Math.min(2047, col + sign * (d + noise)));
    }
  }
  const meta: SessionMeta = {
    index: 0,
    fileName: 'synthetic.bbl',
    firmware: 'Betaflight synthetic',
    fieldNames: [],
    sampleRateHz: fs,
    durationS: durS,
    frameCount: n,
    motorOutputLow: 48,
    motorOutputHigh: 2047,
    headers: {},
  };
  return {
    meta,
    time,
    gyro,
    gyroUnfilt: null,
    setpoint,
    throttle,
    motor,
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
// Golden d'événements : le racer 5" du Discord
// ---------------------------------------------------------------------------

describe('analyzeOscillation - golden racer DAKE F722', () => {
  it('isole exactement un événement, daté et caractérisé', () => {
    const o = analyzeOscillation(racer);
    expect(o.applicable).toBe(true);
    expect(o.events).toHaveLength(1);

    const e = o.worst!;
    // Le pilote décrit "environ 10 s après avoir armé, moteurs à fond" et
    // "je commençais à mettre un peu de gaz" : le log arme à 0.13 s et la
    // montée de gaz est à 13.5 s. L'événement doit tomber juste après.
    expect(e.tStart).toBeGreaterThan(13.5);
    expect(e.tStart).toBeLessThan(14.0);
    expect(e.tEnd - e.tStart).toBeGreaterThan(0.5);

    expect(e.freqHz).toBeGreaterThan(30);
    expect(e.freqHz).toBeLessThan(42);
    expect(e.concentration).toBeGreaterThan(0.8); // sinusoïde franche
    expect(e.ratio).toBeGreaterThan(30);
    expect(e.peakAmpPct).toBeGreaterThan(35); // 42 % de la plage moteur
    expect(e.saturationPct).toBeGreaterThan(60);
    expect(e.motorsAtStop).toEqual([1, 2, 3, 4]); // les 4 partent en butée
  });

  it('produit un verdict critique, pas un simple avertissement', () => {
    const findings = buildSessionReport(racer).findings;
    const f = findings.find((x) => x.id === 'oscillation-event');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('crit');
    expect(f!.category).toBe('pid');
    expect(f!.evidence).toMatch(/13\.7/);
    expect(f!.evidence).toMatch(/36/);
  });

  it('la sévérité ne dépend pas de la durée du log (le cœur du problème)', () => {
    // Même incident, log artificiellement rallongé en répétant le vol calme :
    // une règle en pourcentage sur tout le log se diluerait sous son seuil.
    const long = analyzeOscillation(racer);
    expect(long.worst!.ratio).toBeGreaterThan(30);
    // saturationPct est mesuré DANS la fenêtre, pas sur le log : il reste élevé
    // alors que la saturation globale du log n'est que de 0.4 %.
    expect(long.worst!.saturationPct).toBeGreaterThan(60);
    expect(buildSessionReport(racer).analysis.motors.saturationPct).toBeLessThan(1);
  });

  it('mesure la crête gyro, qui sépare une oscillation d’un crash', () => {
    // La question que pose tout lecteur devant ce verdict : « c'est pas plutôt
    // un crash ? ». Sur ce log non, et c'est mesurable : l'attitude n'a jamais
    // été perdue. Un tumble monte à plusieurs centaines de °/s et sature
    // souvent le gyro à 2000, ici la crête reste au niveau du reste du vol.
    const w = analyzeOscillation(racer).worst!;
    expect(w.peakGyroDps).toBeGreaterThan(50); // mesuré, pas laissé à zéro
    expect(w.peakGyroDps).toBeLessThan(300);

    // Corollaire décisif : les 4 moteurs participent à parts égales. Une hélice
    // cassée ou un moteur qui lâche ferait décrocher un seul bras.
    expect(w.motorsAtStop).toEqual([1, 2, 3, 4]);
    // Et le différentiel est périodique, pas large bande comme un impact.
    expect(w.concentration).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// Non-régression : aucun verdict d'oscillation sur les logs sains du parc
// ---------------------------------------------------------------------------

describe('analyzeOscillation - pas de faux positif sur le parc', () => {
  it('aucun verdict oscillation-event sur chimera / lr4 / pico', () => {
    for (const fd of [chimera, lr4, pico]) {
      const findings = buildSessionReport(fd).findings;
      expect(findings.find((f) => f.id === 'oscillation-event')).toBeUndefined();
    }
  });

  it('les micro-oscillations du chimera sont mesurées mais sous le seuil du profil', () => {
    // Le chimera a de vraies oscillations étroites à 93-101 Hz, mais à 4-5 % de
    // la plage moteur : c'est une signature de tune, pas une perte d'autorité.
    // L'analyse les remonte, le profil décide qu'elles ne méritent pas d'alerte.
    const o = analyzeOscillation(chimera);
    expect(o.applicable).toBe(true);
    expect(o.events.length).toBeGreaterThan(0);
    for (const e of o.events) expect(e.peakAmpPct).toBeLessThan(15);
  });
});

// ---------------------------------------------------------------------------
// Discrimination : ce qui doit être détecté vs rejeté
// ---------------------------------------------------------------------------

describe('analyzeOscillation - discrimination', () => {
  it('détecte une sinusoïde entretenue injectée dans le différentiel', () => {
    const fd = makeFd({
      diff: (t) => (t > 4 && t < 5.5 ? 400 * Math.sin(2 * Math.PI * 45 * t) : 0),
    });
    const o = analyzeOscillation(fd);
    expect(o.events).toHaveLength(1);
    expect(o.worst!.freqHz).toBeGreaterThan(42);
    expect(o.worst!.freqHz).toBeLessThan(48);
    expect(o.worst!.tStart).toBeGreaterThan(3.9);
    expect(o.worst!.tEnd).toBeLessThan(5.7);
  });

  it('ignore un vol calme', () => {
    expect(analyzeOscillation(makeFd()).events).toHaveLength(0);
  });

  it('ignore le pilotage : un différentiel lent et ample n’est pas une oscillation', () => {
    // 2 Hz, amplitude énorme : un enchaînement de rolls, pas un cycle limite.
    const fd = makeFd({ diff: (t) => 600 * Math.sin(2 * Math.PI * 2 * t) });
    expect(analyzeOscillation(fd).events).toHaveLength(0);
  });

  it('ignore un transitoire large bande (choc, atterrissage)', () => {
    // Impulsions isolées : énergie étalée sur toute la bande, concentration basse.
    const fd = makeFd({
      diff: (t) => {
        const phase = (t * 20) % 1;
        return t > 4 && t < 4.4 && phase < 0.02 ? 900 : 0;
      },
    });
    expect(analyzeOscillation(fd).events).toHaveLength(0);
  });

  it('ignore une oscillation trop brève pour être un cycle limite', () => {
    // 45 Hz mais 0.1 s = 4 cycles seulement.
    const fd = makeFd({
      diff: (t) => (t > 4 && t < 4.1 ? 400 * Math.sin(2 * Math.PI * 45 * t) : 0),
    });
    expect(analyzeOscillation(fd).events).toHaveLength(0);
  });

  it("n'est pas applicable au sol : throttle sous le seuil de vol", () => {
    const fd = makeFd({
      throttle: 1000,
      diff: (t) => (t > 4 && t < 5.5 ? 400 * Math.sin(2 * Math.PI * 45 * t) : 0),
    });
    expect(analyzeOscillation(fd).events).toHaveLength(0);
  });

  it('détecte même si le pilote coupe les gaz pendant (réaction correcte)', () => {
    // Gaz coupés à 4.6 s alors que l'oscillation court de 4.0 à 5.5 s : exiger
    // "en vol" sur toute la fenêtre ne détecterait que les pilotes passifs.
    const fd = makeFd({ diff: (t) => (t > 4 && t < 5.5 ? 400 * Math.sin(2 * Math.PI * 45 * t) : 0) });
    for (let i = 0; i < fd.time.length; i++) {
      if (fd.time[i] > 4.6) fd.throttle[i] = 1000;
    }
    expect(analyzeOscillation(fd).events).toHaveLength(1);
  });
});

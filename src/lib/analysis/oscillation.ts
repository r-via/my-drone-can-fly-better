// Détection d'oscillations en boucle fermée, segmentée en ÉVÉNEMENTS DATÉS.
//
// Pourquoi un module à part plutôt qu'une métrique de plus dans basic.ts : les
// règles agrégées sur tout le log ratent les incidents courts. Une oscillation
// qui sature le mixer pendant 0,5 s représente 71 % des échantillons de sa
// fenêtre mais 0,4 % du log, sous tous les seuils en pourcentage. En isolant
// l'événement, sa gravité ne dépend plus de la durée du vol : le même incident
// dans un log de 15 s et dans un log de 3 min produit le même verdict.
//
// 100 % déterministe, aucune IA.
import { median, movingAverage, topPeaks, welchSpectrum } from '../dsp/dsp';

import type { FlightData, OscillationEvent, OscillationMetrics } from '../types';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Throttle stick au-dessus duquel on considère le drone "en vol". */
const FLIGHT_THROTTLE_US = 1100;
/** Sous ce nombre d'échantillons en vol, la médiane de référence n'a pas de sens. */
const MIN_FLIGHT_SAMPLES = 500;

/**
 * Bande de travail. Sous 8 Hz on retrouve le pilotage (un flip commande un
 * différentiel moteur énorme et parfaitement sain) ; au-dessus de 200 Hz on
 * entre dans les fondamentales moteur, qui relèvent du spectre gyro, pas d'une
 * oscillation de la boucle. Les cycles limites PID vivent entre les deux.
 */
const BAND_LO_HZ = 8;
const BAND_HI_HZ = 200;
/** Coupure -3 dB d'une moyenne glissante de largeur w : ~0.443·fs/w. */
const BOXCAR_CUTOFF_K = 0.443;
/** Largeur de la fenêtre RMS qui transforme le signal filtré en enveloppe (s). */
const ENVELOPE_S = 0.03;

/**
 * Hystérésis : on entre dans un événement au-dessus de ENTER×médiane et on n'en
 * sort qu'en repassant sous EXIT×médiane. Sans écart entre les deux seuils, un
 * signal qui oscille autour du seuil produirait une rafale d'événements d'un
 * échantillon au lieu d'un seul, daté proprement.
 */
const ENTER_RATIO = 6;
const EXIT_RATIO = 3;
/** Sous cette durée, c'est un transitoire isolé (choc, rafale), pas une oscillation. */
const MIN_EVENT_S = 0.05;
/** Deux épisodes séparés de moins que ça sont le même incident. */
const MERGE_GAP_S = 0.15;
/** Fenêtre mini pour que la fréquence dominante soit mesurable (>= ~4 cycles à 8 Hz). */
const MIN_FREQ_WINDOW_S = 0.2;
/**
 * Un cycle limite s'entretient : il dure des dizaines de périodes. Un choc ou
 * une figure produit une ou deux alternances et s'amortit.
 */
const MIN_CYCLES = 12;
/** Largeur relative du pic pour mesurer la concentration spectrale (±15 %). */
const PEAK_BANDWIDTH_FRAC = 0.15;
/**
 * Sous cette part d'énergie dans le pic, le signal est large bande : une salve
 * d'impulsions isolées (choc, artefact de décimation du log) l'étale sur toute
 * la bande, là où une sinusoïde entretenue la concentre sur sa fondamentale.
 */
const MIN_CONCENTRATION = 0.5;
/** Enveloppe médiane en vol sous laquelle le log n'a pas d'activité différentielle exploitable. */
const MIN_BASELINE_AMP = 3;
/** Fenêtre en amont de tStart où l'on vérifie que le drone volait. */
const ONSET_LOOKBACK_S = 0.3;
/** Marge sous/sur les butées moteur pour compter un échantillon "en butée". */
const STOP_MARGIN = 8;
/** Au-delà, l'événement est critique quelle que soit son amplitude relative. */
const SATURATION_CRIT_PCT = 25;
const MAX_EVENTS = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sampleRate(fd: FlightData): number {
  const fs = fd.meta.sampleRateHz;
  if (Number.isFinite(fs) && fs > 0) return fs;
  const n = fd.time.length;
  const dur = n > 1 ? fd.time[n - 1] - fd.time[0] : 0;
  return dur > 0 ? (n - 1) / dur : 1000;
}

/** Largeur de boxcar réalisant la coupure fc, bornée à [1, n]. */
function boxcarWidth(fsHz: number, fcHz: number, n: number): number {
  return Math.max(1, Math.min(n, Math.round((BOXCAR_CUTOFF_K * fsHz) / fcHz)));
}

/** Frame moteur saine : les 4 valeurs dans [0, motorOutputHigh + marge]. */
function motorsValidFn(fd: FlightData): (i: number) => boolean {
  const hi = (fd.meta.motorOutputHigh > 0 ? fd.meta.motorOutputHigh : 2047) + STOP_MARGIN;
  return (i: number) => {
    for (let m = 0; m < 4; m++) {
      const v = fd.motor[m][i];
      if (!(v >= 0 && v <= hi)) return false;
    }
    return true;
  };
}

// ---------------------------------------------------------------------------
// Détection
// ---------------------------------------------------------------------------

export function analyzeOscillation(fd: FlightData): OscillationMetrics {
  const n = fd.time.length;
  const empty: OscillationMetrics = { applicable: false, baselineAmp: 0, events: [], worst: null };
  if (n < MIN_FLIGHT_SAMPLES) return empty;

  const fs = sampleRate(fd);
  const motorsValid = motorsValidFn(fd);
  const hi = fd.meta.motorOutputHigh > 0 ? fd.meta.motorOutputHigh : 2047;
  const lo = fd.meta.motorOutputLow;

  // Écart de chaque moteur à la poussée collective. Retirer la collective
  // élimine le throttle : ne reste que ce que le mixer demande en différentiel.
  // Indépendant de la géométrie (X, H, hexa…) : aucune hypothèse sur quel
  // moteur porte quel axe, contrairement à un différentiel roll/pitch câblé.
  const dev: Float64Array[] = [
    new Float64Array(n),
    new Float64Array(n),
    new Float64Array(n),
    new Float64Array(n),
  ];
  const valid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!motorsValid(i)) continue; // frame corrompue : dev reste à 0
    valid[i] = 1;
    const col = (fd.motor[0][i] + fd.motor[1][i] + fd.motor[2][i] + fd.motor[3][i]) / 4;
    for (let m = 0; m < 4; m++) dev[m][i] = fd.motor[m][i] - col;
  }

  // Passe-bande [8, 200] Hz par différence de moyennes glissantes : le
  // pilotage (<8 Hz) et les fondamentales moteur (>200 Hz) sortent du signal.
  const wHi = boxcarWidth(fs, BAND_LO_HZ, n);
  const wLo = boxcarWidth(fs, BAND_HI_HZ, n);
  const bp: Float64Array[] = [];
  for (let m = 0; m < 4; m++) {
    const trend = movingAverage(dev[m], wHi);
    const hp = new Float64Array(n);
    for (let i = 0; i < n; i++) hp[i] = dev[m][i] - trend[i];
    bp.push(wLo > 1 ? movingAverage(hp, wLo) : hp);
  }

  // Enveloppe : RMS instantanée sur les 4 moteurs, lissée sur ENVELOPE_S.
  const inst = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sq = 0;
    for (let m = 0; m < 4; m++) sq += bp[m][i] * bp[m][i];
    inst[i] = sq / 4;
  }
  const smooth = movingAverage(inst, boxcarWidth(fs, 1 / ENVELOPE_S, n));
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) env[i] = Math.sqrt(smooth[i]);

  // Référence : médiane de l'enveloppe en vol. La médiane ignore l'événement
  // lui-même tant qu'il occupe moins de la moitié du vol, une moyenne, non.
  const flightEnv: number[] = [];
  for (let i = 0; i < n; i++) {
    if (valid[i] && fd.throttle[i] > FLIGHT_THROTTLE_US) flightEnv.push(env[i]);
  }
  if (flightEnv.length < MIN_FLIGHT_SAMPLES) return empty;
  const baselineAmp = median(flightEnv);
  // Un différentiel médian quasi nul (drone posé, moteurs au ralenti sur tout
  // le log) ferait exploser tous les ratios : aucune référence exploitable.
  if (!(baselineAmp >= MIN_BASELINE_AMP)) return empty;

  const { events, worst } = segment(fd, env, bp, baselineAmp, fs, valid, lo, hi);
  return { applicable: true, baselineAmp, events, worst };
}

/** Découpe l'enveloppe en événements par hystérésis, puis les caractérise. */
function segment(
  fd: FlightData,
  env: Float64Array,
  bp: Float64Array[],
  baselineAmp: number,
  fs: number,
  valid: Uint8Array,
  motorLow: number,
  motorHigh: number,
): { events: OscillationEvent[]; worst: OscillationEvent | null } {
  const n = env.length;
  const range = motorHigh - motorLow;
  const enter = baselineAmp * ENTER_RATIO;
  const exit = baselineAmp * EXIT_RATIO;

  const ranges: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (start < 0) {
      if (env[i] > enter) start = i;
    } else if (env[i] < exit) {
      ranges.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) ranges.push([start, n - 1]);

  // Fusion des épisodes proches, puis rejet des trop courts.
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && fd.time[r[0]] - fd.time[last[1]] < MERGE_GAP_S) last[1] = r[1];
    else merged.push([r[0], r[1]]);
  }

  const events: OscillationEvent[] = [];
  for (const [s, e] of merged) {
    const tStart = fd.time[s];
    const tEnd = fd.time[e];
    if (tEnd - tStart < MIN_EVENT_S) continue;

    let peakAmp = 0;
    for (let i = s; i <= e; i++) if (env[i] > peakAmp) peakAmp = env[i];

    // Butées : un moteur coincé en haut pendant que sa diagonale est coupée,
    // c'est la perte d'autorité, indépendamment de l'amplitude relative.
    const atStop = [false, false, false, false];
    let satSamples = 0;
    let count = 0;
    for (let i = s; i <= e; i++) {
      if (!valid[i]) continue;
      count++;
      let any = false;
      for (let m = 0; m < 4; m++) {
        const v = fd.motor[m][i];
        if (v >= motorHigh - STOP_MARGIN || v <= motorLow + STOP_MARGIN) {
          atStop[m] = true;
          any = true;
        }
      }
      if (any) satSamples++;
    }
    const saturationPct = count > 0 ? (100 * satSamples) / count : 0;

    // Le drone doit voler AU DÉCLENCHEMENT : un différentiel énorme au sol
    // (posé, hélices qui touchent) n'est pas une oscillation de la boucle.
    // On regarde en amont de tStart, jamais pendant : couper les gaz est la
    // réaction correcte du pilote face à une oscillation, l'exiger en vol sur
    // toute la fenêtre reviendrait à ne détecter que ceux qui ne réagissent pas.
    const thr: number[] = [];
    for (let i = s; i >= 0 && fd.time[i] > tStart - ONSET_LOOKBACK_S; i--) thr.push(fd.throttle[i]);
    if (thr.length === 0 || median(thr) <= FLIGHT_THROTTLE_US) continue;

    // Périodicité : sans fréquence mesurable, ou sans assez de cycles, c'est un
    // transitoire (choc, atterrissage, flip), pas un cycle limite.
    const spec = dominantFreq(bp, s, e, fs);
    if (spec === null) continue;
    const cycles = (tEnd - tStart) * spec.freqHz;
    if (cycles < MIN_CYCLES) continue;
    if (spec.concentration < MIN_CONCENTRATION) continue;

    events.push({
      tStart,
      tEnd,
      freqHz: spec.freqHz,
      concentration: spec.concentration,
      peakAmp,
      peakAmpPct: range > 0 ? (100 * peakAmp) / range : 0,
      ratio: peakAmp / baselineAmp,
      saturationPct,
      motorsAtStop: atStop.map((v, m) => (v ? m + 1 : 0)).filter((m) => m > 0),
      severity: 'warn', // arbitré par le moteur de règles (seuils du profil)
    });
  }

  events.sort((a, b) => b.ratio - a.ratio);
  const kept = events.slice(0, MAX_EVENTS);
  return { events: kept, worst: kept[0] ?? null };
}

/**
 * Fréquence dominante du différentiel sur la fenêtre ET concentration
 * spectrale : spectres des 4 moteurs sommés (une oscillation les excite tous,
 * le bruit propre à un moteur non).
 *
 * La concentration est ce qui sépare un cycle limite d'un choc : une
 * oscillation est une sinusoïde, son énergie tient dans un pic étroit ; un
 * atterrissage ou un flip est un transitoire large bande qui étale la sienne
 * sur toute la bande.
 */
function dominantFreq(
  bp: Float64Array[],
  s: number,
  e: number,
  fs: number,
): { freqHz: number; concentration: number } | null {
  const len = e - s + 1;
  if (len / fs < MIN_FREQ_WINDOW_S) return null;

  let acc: Float32Array | null = null;
  let freqs: Float32Array | null = null;
  for (let m = 0; m < 4; m++) {
    const spec = welchSpectrum(bp[m].subarray(s, e + 1), fs, 1024);
    if (spec.mags.length === 0) return null;
    if (!acc) {
      acc = new Float32Array(spec.mags.length);
      freqs = spec.freqs;
    }
    if (spec.mags.length !== acc.length) return null;
    for (let k = 0; k < acc.length; k++) acc[k] += spec.mags[k];
  }
  if (!acc || !freqs) return null;

  // Le passe-bande atténue déjà hors bande, mais on borne explicitement : un
  // résidu de fondamentale moteur ne doit jamais être élu pic d'oscillation.
  for (let k = 0; k < acc.length; k++) if (freqs[k] > BAND_HI_HZ) acc[k] = 0;
  const peaks = topPeaks({ freqs, mags: acc }, { fMin: BAND_LO_HZ, k: 1 });
  if (peaks.length === 0) return null;
  const freqHz = peaks[0].freqHz;

  // Part de l'énergie de bande contenue dans ±PEAK_BW autour du pic.
  let inPeak = 0;
  let total = 0;
  const half = freqHz * PEAK_BANDWIDTH_FRAC;
  for (let k = 0; k < acc.length; k++) {
    if (freqs[k] < BAND_LO_HZ || freqs[k] > BAND_HI_HZ) continue;
    const p = acc[k] * acc[k];
    total += p;
    if (Math.abs(freqs[k] - freqHz) <= half) inPeak += p;
  }
  return { freqHz, concentration: total > 0 ? inPeak / total : 0 };
}

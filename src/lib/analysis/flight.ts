// Analyses "comportement en vol" - yoyo (oscillation de poussée basse
// fréquence, portage fidèle de analyze_pico.py) et prop wash (perte de
// contrôle dans les descentes). 100 % déterministe, aucune IA.
import { mean, std } from '../dsp/dsp';
import type { FlightData, PropwashEvent, PropwashMetrics, YoyoMetrics } from '../types';

// ---------------------------------------------------------------------------
// Constantes (mêmes seuils que analyze_pico.py sauf mention contraire)
// ---------------------------------------------------------------------------

/** Throttle stick au-dessus duquel on considère le drone "en vol". */
const FLIGHT_THROTTLE_US = 1100;
/** Nombre minimal d'échantillons en vol pour que le yoyo soit calculable. */
const YOYO_MIN_FLY_SAMPLES = 200;
/** Ratio sd(poussée)/sd(stick) au-delà duquel le yoyo est probable. */
const YOYO_RATIO_THRESHOLD = 1.3;
/** En-dessous de cet écart-type stick, le ratio n'a pas de sens (stick figé). */
const STICK_STD_EPS = 1e-6;
/** Cible de fréquence d'échantillonnage après downsample pour la DFT yoyo. */
const YOYO_DFT_TARGET_HZ = 100;
/** Bande de recherche des pics d'oscillation de poussée (Hz). */
const YOYO_FREQ_MIN_HZ = 0.5;
const YOYO_FREQ_MAX_HZ = 20;
const YOYO_FREQ_STEP_HZ = 0.25;
const YOYO_TOP_PEAKS = 5;

/** Vitesse verticale (baro) sous laquelle on est en descente franche (m/s). */
const DESCENT_VZ_MPS = -2;
/** Fenêtre de lissage de la dérivée d'altitude (s). */
const VZ_SMOOTH_S = 0.5;
/** Heuristique sans baro : throttle passé sous ce seuil… */
const DESCENT_THR_LOW_US = 1200;
/** …alors qu'il dépassait ce seuil dans la seconde précédente. */
const DESCENT_THR_HIGH_US = 1400;
const DESCENT_LOOKBACK_S = 1.0;
/** Deux fenêtres de descente séparées de moins de ça fusionnent (s). */
const EVENT_MERGE_GAP_S = 0.5;
/** Passe-bas (moyenne glissante) sur l'erreur gyro : coupure ~40 Hz. */
const ERR_LPF_CUTOFF_HZ = 40;
/** Nombre max d'événements retournés (les pires d'abord). */
const MAX_EVENTS = 10;

/** Garde-fou aberrations : |gyro| ou |setpoint| >= 5000 deg/s = frame corrompue. */
const GYRO_ABERRATION_LIMIT = 5000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fréquence d'échantillonnage : meta si valide, sinon estimée depuis time. */
function sampleRate(fd: FlightData): number {
  const fs = fd.meta.sampleRateHz;
  if (Number.isFinite(fs) && fs > 0) return fs;
  const n = fd.time.length;
  const dur = n > 1 ? fd.time[n - 1] - fd.time[0] : 0;
  return dur > 0 ? (n - 1) / dur : 1000;
}

/**
 * DFT directe (portage de analyze_pico.dft_power) : amplitude à chaque
 * fréquence demandée, normalisée par la longueur du signal.
 */
function dftPower(sig: ArrayLike<number>, freqs: number[], fsHz: number): number[] {
  const n = sig.length;
  const out: number[] = [];
  for (const fq of freqs) {
    const w = (2 * Math.PI * fq) / fsHz;
    let re = 0;
    let im = 0;
    for (let k = 0; k < n; k++) {
      re += sig[k] * Math.cos(w * k);
      im -= sig[k] * Math.sin(w * k);
    }
    out.push(n > 0 ? Math.hypot(re, im) / n : 0);
  }
  return out;
}

/** Moyenne glissante centrée de largeur w (>=1), via somme cumulée. */
function movingAverage(x: Float64Array, w: number): Float64Array {
  const n = x.length;
  if (w <= 1 || n === 0) return x;
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + x[i];
  const half = Math.floor(w / 2);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half + 1);
    out[i] = (cum[hi] - cum[lo]) / (hi - lo);
  }
  return out;
}

// ---------------------------------------------------------------------------
// YOYO - oscillation de poussée basse fréquence (cf. analyze_pico.py)
// ---------------------------------------------------------------------------

/**
 * Frame moteur saine : les 4 valeurs brutes dans [0, motorOutputHigh].
 * Le parseur WASM laisse passer quelques frames corrompues (valeurs 2^32…)
 * que orangebox droppait - on les exclut, sinon std(poussée) explose.
 */
function motorsValidFn(fd: FlightData): (i: number) => boolean {
  const hi = fd.meta.motorOutputHigh > 0 ? fd.meta.motorOutputHigh : 2047;
  return (i: number) => {
    for (let m = 0; m < 4; m++) {
      const v = fd.motor[m][i];
      if (!(v >= 0 && v <= hi)) return false;
    }
    return true;
  };
}

export function analyzeYoyo(fd: FlightData): YoyoMetrics {
  const n = fd.time.length;
  const motorsValid = motorsValidFn(fd);
  const fly: number[] = [];
  for (let i = 0; i < n; i++) {
    if (fd.throttle[i] > FLIGHT_THROTTLE_US && motorsValid(i)) fly.push(i);
  }
  if (fly.length <= YOYO_MIN_FLY_SAMPLES) {
    return { applicable: false, ratio: null, verdict: null, peaks: [] };
  }

  // Poussée collective (moyenne des 4 moteurs, valeurs brutes) et stick en vol.
  const col = new Float64Array(fly.length);
  const th = new Float64Array(fly.length);
  for (let k = 0; k < fly.length; k++) {
    const i = fly[k];
    col[k] = (fd.motor[0][i] + fd.motor[1][i] + fd.motor[2][i] + fd.motor[3][i]) / 4;
    th[k] = fd.throttle[i];
  }
  const sdCol = std(col);
  const sdTh = std(th);

  // Pics d'oscillation : DFT directe de la poussée recentrée, downsamplée
  // à ~100 Hz, fréquences 0.5→20 Hz par pas de 0.25 (comme dft_power python).
  const fs = sampleRate(fd);
  const ds = Math.max(1, Math.floor(fs / YOYO_DFT_TARGET_HZ));
  const mCol = mean(col);
  const cdLen = Math.ceil(col.length / ds);
  const cd = new Float64Array(cdLen);
  for (let k = 0; k < cdLen; k++) cd[k] = col[k * ds] - mCol;
  const fsd = fs / ds;
  const nFreqs = Math.floor((YOYO_FREQ_MAX_HZ - YOYO_FREQ_MIN_HZ) / YOYO_FREQ_STEP_HZ) + 1;
  const freqs: number[] = [];
  for (let k = 0; k < nFreqs; k++) freqs.push(YOYO_FREQ_MIN_HZ + YOYO_FREQ_STEP_HZ * k);
  const power = dftPower(cd, freqs, fsd);
  const peaks = freqs
    .map((f, i) => ({ freqHz: f, mag: power[i] }))
    .sort((a, b) => b.mag - a.mag)
    .slice(0, YOYO_TOP_PEAKS);

  if (!(sdTh > STICK_STD_EPS)) {
    // Stick quasi figé : le ratio n'a pas de sens.
    return { applicable: true, ratio: null, verdict: null, peaks };
  }
  const ratio = sdCol / sdTh;
  return {
    applicable: true,
    ratio,
    verdict: ratio > YOYO_RATIO_THRESHOLD ? 'yoyo' : 'stable',
    peaks,
  };
}

// ---------------------------------------------------------------------------
// PROP WASH - sévérité de l'erreur gyro pendant les descentes
// ---------------------------------------------------------------------------

/** Vitesse verticale lissée : différence centrée d'altitude sur ~VZ_SMOOTH_S. */
function descentMaskFromBaro(fd: FlightData, fs: number): Uint8Array {
  const alt = fd.baroAlt!;
  const t = fd.time;
  const n = alt.length;
  const mask = new Uint8Array(n);
  const half = Math.max(1, Math.round((VZ_SMOOTH_S / 2) * fs));
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    const dt = t[hi] - t[lo];
    if (dt <= 0) continue;
    const vz = (alt[hi] - alt[lo]) / dt;
    if (vz < DESCENT_VZ_MPS) mask[i] = 1;
  }
  return mask;
}

/**
 * Heuristique sans baro : throttle passé sous DESCENT_THR_LOW_US alors qu'il
 * dépassait DESCENT_THR_HIGH_US dans la seconde précédente (le blackbox ne
 * loggue qu'armé, donc "en restant armé" est garanti par la session).
 * Max glissant en O(n) via deque monotone décroissante.
 */
function descentMaskFromThrottle(fd: FlightData): Uint8Array {
  const thr = fd.throttle;
  const t = fd.time;
  const n = thr.length;
  const mask = new Uint8Array(n);
  const deque: number[] = []; // indices, valeurs décroissantes
  let head = 0;
  for (let i = 0; i < n; i++) {
    // Le max porte sur ]t[i]-1s, t[i][ : on insère i-1 avant de tester i.
    if (i > 0) {
      while (deque.length > head && thr[deque[deque.length - 1]] <= thr[i - 1]) deque.pop();
      deque.push(i - 1);
    }
    while (deque.length > head && t[deque[head]] < t[i] - DESCENT_LOOKBACK_S) head++;
    if (thr[i] < DESCENT_THR_LOW_US && deque.length > head && thr[deque[head]] > DESCENT_THR_HIGH_US) {
      mask[i] = 1;
    }
  }
  return mask;
}

/** Plages contiguës de mask==1, fusionnées si l'écart temporel < gapS. */
function maskToRanges(mask: Uint8Array, t: Float64Array, gapS: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      ranges.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) ranges.push([start, mask.length - 1]);

  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && t[r[0]] - t[last[1]] < gapS) last[1] = r[1];
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

export function analyzePropwash(fd: FlightData): PropwashMetrics {
  const n = fd.time.length;
  if (n < 2) return { applicable: false, events: [], worstSeverity: null, avgSeverity: null };

  const fs = sampleRate(fd);
  const mask = fd.baroAlt ? descentMaskFromBaro(fd, fs) : descentMaskFromThrottle(fd);
  const ranges = maskToRanges(mask, fd.time, EVENT_MERGE_GAP_S);
  if (ranges.length === 0) {
    return { applicable: false, events: [], worstSeverity: null, avgSeverity: null };
  }

  // Erreur de suivi roll+pitch passe-bas <40 Hz (moyenne glissante) : le prop
  // wash est une perturbation basse fréquence, on écarte le bruit HF du gyro.
  const errR = new Float64Array(n);
  const errP = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Frames corrompues (gyro/setpoint aberrants) neutralisées à 0.
    for (const [axis, err] of [
      [0, errR],
      [1, errP],
    ] as Array<[number, Float64Array]>) {
      const sp = fd.setpoint[axis][i];
      const gy = fd.gyro[axis][i];
      err[i] =
        Math.abs(gy) < GYRO_ABERRATION_LIMIT && Math.abs(sp) < GYRO_ABERRATION_LIMIT ? sp - gy : 0;
    }
  }
  const w = Math.max(1, Math.round(fs / ERR_LPF_CUTOFF_HZ));
  const errRf = movingAverage(errR, w);
  const errPf = movingAverage(errP, w);

  const events: PropwashEvent[] = [];
  for (const [s, e] of ranges) {
    let sq = 0;
    const count = e - s + 1;
    for (let i = s; i <= e; i++) sq += errRf[i] * errRf[i] + errPf[i] * errPf[i];
    // RMS sur les échantillons roll et pitch confondus (2 valeurs par frame).
    const severity = Math.sqrt(sq / (2 * count));
    events.push({ tStart: fd.time[s], tEnd: fd.time[e], severity });
  }
  events.sort((a, b) => b.severity - a.severity);

  let sum = 0;
  for (const ev of events) sum += ev.severity;
  return {
    applicable: true,
    events: events.slice(0, MAX_EVENTS),
    worstSeverity: events[0].severity,
    avgSeverity: sum / events.length,
  };
}

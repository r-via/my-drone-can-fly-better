// Réponse indicielle (step response) par déconvolution de Wiener — méthode
// Plasmatree PID-Analyzer (github.com/Plasmatree/PID-Analyzer), adaptée en
// fenêtres de Hann de 2 s avec overlap 50 % :
//   G(f) = Y·conj(X) / (X·conj(X) + λ),  λ = 1e-4·max(X·conj(X))
//   h = Re(ifft(G)),  step = cumsum(h)
// La courbe est la réponse à un échelon unitaire de setpoint : AUCUNE
// normalisation — settleValue ≈ 1 signifie que le PID suit la consigne.
import { fft, ifft, nextPow2 } from '../dsp/dsp';

import type { AxisStepResponse, FlightData, StepResponseMetrics } from '../types';

/** Durée minimale de log (s) pour une estimation exploitable. */
const MIN_DURATION_S = 20;
/** Longueur d'une fenêtre d'analyse (s), overlap 50 %. */
const WINDOW_S = 2;
/** Durée de la réponse indicielle retournée (s). */
const RESPONSE_S = 0.5;
/** Début de la zone de plateau pour settleValue (s) — fin = RESPONSE_S. */
const SETTLE_START_S = 0.2;
/** Excitation stick minimale max|setpoint| (deg/s) pour garder une fenêtre. */
const MIN_EXCITATION_DEGS: [number, number, number] = [20, 20, 10];
/**
 * Vol doux (cruise) : si AUCUNE fenêtre ne passe le seuil nominal, on retente
 * à seuil réduit de moitié — la boucle fermée étant ~linéaire, une excitation
 * modérée suffit encore à estimer la réponse (SNR moindre, quality le reflète).
 */
const EXCITATION_FALLBACK_FACTOR = 0.5;
/** Régularisation de Wiener : λ = facteur · max|X|². */
const WIENER_REG_FACTOR = 1e-4;
/**
 * Le max|X|² servant à λ est pris au-dessus de cette fréquence : les longs
 * virages soutenus mettent une énergie quasi-DC énorme dans X qui gonflerait
 * λ de plusieurs ordres de grandeur et écraserait la bande utile (plateau
 * sous-estimé). Les bins quasi-DC restent auto-régularisés (|X|² ≫ λ).
 */
const LAMBDA_FLOOR_HZ = 2;
/**
 * Filtre de robustesse façon PIDtoolbox : une fenêtre dont le plateau
 * individuel (200-500 ms) sort de cette bande est un artefact de
 * déconvolution (SNR insuffisant), pas une réponse physique — elle est
 * écartée de la moyenne. Si TOUTES les fenêtres sortent de la bande
 * (quad vraiment cassé), on les garde toutes : la règle « pathologique »
 * s'applique alors à la courbe finale.
 */
const WINDOW_PLATEAU_MIN = 0.5;
const WINDOW_PLATEAU_MAX = 1.5;
/** |gyro| au-delà = frame corrompue → fenêtre écartée (cf. analyze_pico LIM). */
const GYRO_ABERRATION_LIMIT = 5000;
/** Plateau ≤ cette valeur (ou non fini) = réponse pathologique → métriques null. */
const PATHOLOGICAL_SETTLE = 0.1;

/**
 * Estime la réponse indicielle par axe (roll, pitch, yaw) via déconvolution
 * de Wiener setpoint→gyro. Retourne null si le vol est trop court (< 20 s).
 * Un axe sans fenêtre suffisamment excitée (quality 0) est null.
 */
export function analyzeStepResponse(fd: FlightData): StepResponseMetrics | null {
  const fs = fd.meta.sampleRateHz;
  const n = fd.time.length;
  if (!Number.isFinite(fs) || fs <= 0) return null;
  const durationS = n >= 2 ? fd.time[n - 1] - fd.time[0] : 0;
  if (durationS < MIN_DURATION_S) return null;

  const axes = ([0, 1, 2] as const).map((a) =>
    analyzeAxis(fd.setpoint[a], fd.gyro[a], fs, MIN_EXCITATION_DEGS[a]),
  );
  return { axes: axes as StepResponseMetrics['axes'] };
}

function analyzeAxis(
  x: Float32Array,
  y: Float32Array,
  fs: number,
  minExcitation: number,
): AxisStepResponse | null {
  return (
    deconvolveAxis(x, y, fs, minExcitation) ??
    deconvolveAxis(x, y, fs, minExcitation * EXCITATION_FALLBACK_FACTOR)
  );
}

function deconvolveAxis(
  x: Float32Array,
  y: Float32Array,
  fs: number,
  minExcitation: number,
): AxisStepResponse | null {
  const winSamp = Math.round(WINDOW_S * fs);
  if (winSamp < 16 || x.length < winSamp) return null;
  const hop = winSamp >> 1;
  const nfft = nextPow2(winSamp);
  const nResp = Math.min(Math.floor(RESPONSE_S * fs) + 1, nfft);
  const kSettle = Math.ceil(SETTLE_START_S * fs);
  const binFloor = Math.ceil((LAMBDA_FLOOR_HZ * nfft) / fs);
  const halfBin = nfft >> 1; // Nyquist

  // Fenêtre de Hann symétrique (même convention que dsp.welchSpectrum) :
  // taper à zéro aux bords → l'hypothèse de convolution circulaire de la FFT
  // devient quasi exacte, le zero-padding à 2^n complète.
  const hann = new Float64Array(winSamp);
  for (let k = 0; k < winSamp; k++) {
    hann[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (winSamp - 1));
  }

  const xr = new Float64Array(nfft);
  const xi = new Float64Array(nfft);
  const yr = new Float64Array(nfft);
  const yi = new Float64Array(nfft);
  const stepBuf = new Float64Array(nResp);
  // Deux accumulateurs : fenêtres saines (plateau plausible) et toutes les
  // fenêtres excitées (repli si aucune n'est saine).
  const accSane = new Float64Array(nResp);
  const accAll = new Float64Array(nResp);

  let total = 0;
  let excited = 0;
  let sane = 0;
  let weightSane = 0;
  let weightAll = 0;

  for (let start = 0; start + winSamp <= x.length; start += hop) {
    total++;

    // Excitation stick + énergie (poids) + garde-fou frames corrompues.
    let maxAbs = 0;
    let energy = 0;
    let corrupted = false;
    for (let k = 0; k < winSamp; k++) {
      const xv = x[start + k];
      const yv = y[start + k];
      if (!Number.isFinite(xv) || !Number.isFinite(yv) || Math.abs(yv) >= GYRO_ABERRATION_LIMIT) {
        corrupted = true;
        break;
      }
      const a = Math.abs(xv);
      if (a > maxAbs) maxAbs = a;
      energy += xv * xv;
    }
    if (corrupted || maxAbs < minExcitation || energy <= 0) continue;
    excited++;

    xr.fill(0);
    xi.fill(0);
    yr.fill(0);
    yi.fill(0);
    for (let k = 0; k < winSamp; k++) {
      xr[k] = x[start + k] * hann[k];
      yr[k] = y[start + k] * hann[k];
    }
    fft(xr, xi);
    fft(yr, yi);

    // λ = 1e-4 · max|X|² au-dessus de LAMBDA_FLOOR_HZ (cf. commentaire const).
    let maxPow = 0;
    for (let b = binFloor; b <= halfBin; b++) {
      const p = xr[b] * xr[b] + xi[b] * xi[b];
      if (p > maxPow) maxPow = p;
    }
    const lambda = WIENER_REG_FACTOR * maxPow;

    // G = Y·conj(X) / (|X|² + λ) — écrit en place dans (xr, xi).
    for (let b = 0; b < nfft; b++) {
      const denom = xr[b] * xr[b] + xi[b] * xi[b] + lambda;
      const gRe = (yr[b] * xr[b] + yi[b] * xi[b]) / denom;
      const gIm = (yi[b] * xr[b] - yr[b] * xi[b]) / denom;
      xr[b] = gRe;
      xi[b] = gIm;
    }
    ifft(xr, xi);

    // h = Re(g) ; step = cumsum(h) tronquée à RESPONSE_S.
    let cum = 0;
    for (let k = 0; k < nResp; k++) {
      cum += xr[k];
      stepBuf[k] = cum;
    }

    // Plateau individuel de la fenêtre (jauge de robustesse).
    let pSum = 0;
    let pCount = 0;
    for (let k = kSettle; k < nResp; k++) {
      pSum += stepBuf[k];
      pCount++;
    }
    const plateau = pCount > 0 ? pSum / pCount : NaN;

    for (let k = 0; k < nResp; k++) accAll[k] += energy * stepBuf[k];
    weightAll += energy;
    if (Number.isFinite(plateau) && plateau >= WINDOW_PLATEAU_MIN && plateau <= WINDOW_PLATEAU_MAX) {
      sane++;
      for (let k = 0; k < nResp; k++) accSane[k] += energy * stepBuf[k];
      weightSane += energy;
    }
  }

  if (total === 0 || excited === 0) return null;

  const useSane = sane > 0;
  const acc = useSane ? accSane : accAll;
  const weightSum = useSane ? weightSane : weightAll;
  const kept = useSane ? sane : excited;
  if (weightSum <= 0) return null;
  const quality = kept / total;

  const t = new Float32Array(nResp);
  const step = new Float32Array(nResp);
  for (let k = 0; k < nResp; k++) {
    t[k] = k / fs;
    step[k] = acc[k] / weightSum;
  }

  return { t, y: step, quality, ...computeMetrics(step, fs, kSettle) };
}

interface StepCurveMetrics {
  riseTimeMs: number | null;
  peakValue: number | null;
  overshootPct: number | null;
  settleValue: number | null;
}

function computeMetrics(y: Float32Array, fs: number, kSettle: number): StepCurveMetrics {
  // Valeur de plateau : moyenne sur 200-500 ms.
  let sum = 0;
  let count = 0;
  for (let k = kSettle; k < y.length; k++) {
    sum += y[k];
    count++;
  }
  const settle = count > 0 ? sum / count : NaN;

  // Réponse pathologique : plateau quasi nul, négatif ou non fini → pas de
  // métriques exploitables mais on garde la courbe pour l'affichage.
  if (!Number.isFinite(settle) || settle <= PATHOLOGICAL_SETTLE) {
    return { riseTimeMs: null, peakValue: null, overshootPct: null, settleValue: null };
  }

  let peak = -Infinity;
  for (let k = 0; k < y.length; k++) {
    if (y[k] > peak) peak = y[k];
  }

  const t10 = crossingTimeS(y, fs, 0.1 * settle);
  const t90 = crossingTimeS(y, fs, 0.9 * settle);
  const riseTimeMs = t10 !== null && t90 !== null && t90 >= t10 ? (t90 - t10) * 1000 : null;

  const overshoot = (peak / settle - 1) * 100;

  return {
    riseTimeMs,
    peakValue: peak,
    overshootPct: overshoot > 0 ? overshoot : null,
    settleValue: settle,
  };
}

/** Premier franchissement (montant) de `level`, interpolé linéairement (s). */
function crossingTimeS(y: Float32Array, fs: number, level: number): number | null {
  for (let k = 0; k < y.length; k++) {
    if (y[k] >= level) {
      if (k === 0) return 0;
      const y0 = y[k - 1];
      const y1 = y[k];
      const frac = y1 > y0 ? (level - y0) / (y1 - y0) : 0;
      return (k - 1 + frac) / fs;
    }
  }
  return null;
}

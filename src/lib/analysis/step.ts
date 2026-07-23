// Réponse indicielle (step response) par déconvolution de Wiener - méthode
// Plasmatree PID-Analyzer (github.com/Plasmatree/PID-Analyzer), adaptée en
// fenêtres de Hann de 2 s avec overlap 50 % :
//   G(f) = Y·conj(X) / (X·conj(X) + λ),  λ = 1e-4·max(X·conj(X))
//   h = Re(ifft(G)),  step = cumsum(h)
// La courbe est la réponse à un échelon unitaire de setpoint : AUCUNE
// normalisation - settleValue ≈ 1 signifie que le PID suit la consigne.
//
// Ce même G(f) EST la fonction de transfert en boucle fermée T(f) consigne →
// gyro. On en tire deux indicateurs fréquentiels sans transformée supplémentaire
// (cf. betaflight-chirp-core, qui les calcule sur un log chirp) :
//   Ms  = max|S| = max|1 - T|  amplification maximale d'une perturbation
//   Mt  = max|T|               résonance de la boucle fermée
// Ms est le meilleur indicateur scalaire de stabilité disponible ici : il ne
// dépend ni du plateau de la courbe (fragile) ni d'un modèle de boucle ouverte
// (L = T/(1-T), bien trop bruité pour une marge de phase honnête).
//
// AUCUNE RÈGLE NE LE CONSOMME, et c'est délibéré. Mesuré sur les 60 logs du
// parc : Ms n'est calculable que sur 34 % des axes déjà jugés fiables, et sur
// les 13 axes où il dépassait 1.5, 12 avaient déjà un overshoot > 25 %. Il ne
// nourrissait donc quasiment aucun verdict neuf, tout en héritant du bruit de
// la déconvolution sur les logs où celle-ci peine. La raison est physique et
// pas corrigeable ici : un manche humain n'excite la boucle que jusqu'à ~25 Hz
// (médiane du parc), alors que le point faible d'un multirotor se situe plus
// haut - c'est précisément pour ça que betaflight-chirp-core exige un chirp.
// La mesure reste calculée parce qu'elle est validée contre la théorie (voir
// tests/step.test.ts) et qu'elle est sans dimension, donc comparable d'un vol
// à l'autre : c'est l'entrée de la comparaison passe N-1 / passe N, où elle a
// un sens qu'elle n'a pas sur un log isolé.
import { fft, ifft, movingAverage, nextPow2 } from '../dsp/dsp';

import type { AxisStepResponse, FlightData, StepResponseMetrics } from '../types';

/** Durée minimale de log (s) pour une estimation exploitable. */
const MIN_DURATION_S = 20;
/** Longueur d'une fenêtre d'analyse (s), overlap 50 %. */
const WINDOW_S = 2;
/** Durée de la réponse indicielle retournée (s). */
const RESPONSE_S = 0.5;
/** Début de la zone de plateau pour settleValue (s) - fin = RESPONSE_S. */
const SETTLE_START_S = 0.2;
/** Excitation stick minimale max|setpoint| (deg/s) pour garder une fenêtre. */
const MIN_EXCITATION_DEGS: [number, number, number] = [20, 20, 10];
/**
 * Vol doux (cruise) : si AUCUNE fenêtre ne passe le seuil nominal, on retente
 * à seuil réduit de moitié - la boucle fermée étant ~linéaire, une excitation
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
 * déconvolution (SNR insuffisant), pas une réponse physique - elle est
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
 * Bande d'évaluation de Ms/Mt. Le bas rejoint LAMBDA_FLOOR_HZ : en dessous,
 * T ≈ gain statique, aucune information de stabilité. Le haut n'est qu'un
 * plafond de sécurité - la vraie limite est MS_MIN_SNR ci-dessous.
 */
const MS_BAND_LO_HZ = 2;
const MS_BAND_HI_HZ = 90;
/**
 * Là où le manche n'a pas mis d'énergie, la déconvolution ne mesure rien : le
 * dénominateur de Wiener se réduit à λ et T devient un rapport de bruits. Sur
 * les logs du parc ça produisait des Ms de 10 à 57 Hz, un chiffre que personne
 * ne peut défendre. On ne garde donc que les fréquences où |X|² ≥ 10·λ, soit
 * |X| ≥ 3 % du maximum : la régularisation y pèse moins de 10 % et l'estimation
 * est celle du signal, pas du plancher. La bande utile devient une PROPRIÉTÉ DU
 * VOL et non une constante - c'est aussi pour cela qu'elle est publiée avec la
 * mesure : Ms n'est un minorant que sur ce que le pilote a réellement excité.
 */
const MS_MIN_SNR = 10;
/**
 * Si la bande utile ne monte pas jusque-là, le vol n'a pas excité la zone où
 * un multirotor croise 0 dB : on ne publie rien plutôt qu'un Ms mesuré sur la
 * seule traîne basse fréquence, qui vaudrait toujours « boucle amortie ».
 */
const MS_MIN_TOP_HZ = 12;
/**
 * Garde-fou théorique, et le plus solide dont on dispose : l'intégrale de Bode
 * impose max|S| ≥ 1 à toute boucle fermée réelle. Mesurer moins ne veut pas dire
 * « boucle exceptionnelle », ça veut dire que la bande observée s'arrête AVANT
 * le point faible - on n'a regardé que la zone où le quad suit parfaitement.
 * Un Ms sous ce plancher est donc une non-mesure, pas un bon résultat.
 */
const MS_THEORETICAL_FLOOR = 1;
/**
 * Lissage en fréquence avant de chercher le pic. Un bin isolé peut sortir du
 * bruit de déconvolution là où l'énergie manche est faible ; un pic physique de
 * boucle fermée est large de plusieurs Hz. Prendre le max d'une moyenne
 * glissante de ±1.5 Hz supprime le premier sans entamer le second.
 */
const MS_SMOOTH_HZ = 1.5;

/**
 * En dessous de ~30 % de fenêtres excitées, la déconvolution sort du bruit
 * (mesuré sur lr4 s6 : quality 0.07 → overshoot fantôme de 163 %). Exporté
 * parce que tout consommateur des métriques step doit appliquer LE MÊME seuil :
 * un axe que le moteur de règles refuse de juger ne doit pas réapparaître dans
 * une comparaison de passes, sans quoi le rapport se contredit d'un panneau à
 * l'autre.
 */
export const MIN_STEP_QUALITY = 0.3;

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

  // T(f) sur la bande Ms/Mt, accumulé en complexe avec les mêmes poids que la
  // courbe : ifft et cumsum étant linéaires, la moyenne des courbes est
  // exactement la courbe de la moyenne des G. Les deux vues restent cohérentes.
  const bLo = Math.max(1, Math.ceil((MS_BAND_LO_HZ * nfft) / fs));
  const bHi = Math.min(halfBin, Math.floor((MS_BAND_HI_HZ * nfft) / fs));
  const nBand = Math.max(0, bHi - bLo + 1);
  const bandRe = new Float64Array(nBand);
  const bandIm = new Float64Array(nBand);
  const bandXX = new Float64Array(nBand); // |X|² par bin, pour la bande utile
  const accSaneG = {
    re: new Float64Array(nBand),
    im: new Float64Array(nBand),
    xx: new Float64Array(nBand),
    lambda: 0,
  };
  const accAllG = {
    re: new Float64Array(nBand),
    im: new Float64Array(nBand),
    xx: new Float64Array(nBand),
    lambda: 0,
  };

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

    // |X|² sur la bande, capturé avant que la boucle suivante n'écrase (xr, xi).
    for (let j = 0; j < nBand; j++) {
      const b = bLo + j;
      bandXX[j] = xr[b] * xr[b] + xi[b] * xi[b];
    }

    // G = Y·conj(X) / (|X|² + λ) - écrit en place dans (xr, xi).
    for (let b = 0; b < nfft; b++) {
      const denom = xr[b] * xr[b] + xi[b] * xi[b] + lambda;
      const gRe = (yr[b] * xr[b] + yi[b] * xi[b]) / denom;
      const gIm = (yi[b] * xr[b] - yr[b] * xi[b]) / denom;
      xr[b] = gRe;
      xi[b] = gIm;
    }
    // Capture de T(f) sur la bande AVANT l'ifft, qui écrase (xr, xi).
    for (let j = 0; j < nBand; j++) {
      bandRe[j] = xr[bLo + j];
      bandIm[j] = xi[bLo + j];
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
    for (let j = 0; j < nBand; j++) {
      accAllG.re[j] += energy * bandRe[j];
      accAllG.im[j] += energy * bandIm[j];
      accAllG.xx[j] += energy * bandXX[j];
    }
    accAllG.lambda += energy * lambda;
    weightAll += energy;
    if (Number.isFinite(plateau) && plateau >= WINDOW_PLATEAU_MIN && plateau <= WINDOW_PLATEAU_MAX) {
      sane++;
      for (let k = 0; k < nResp; k++) accSane[k] += energy * stepBuf[k];
      for (let j = 0; j < nBand; j++) {
        accSaneG.re[j] += energy * bandRe[j];
        accSaneG.im[j] += energy * bandIm[j];
        accSaneG.xx[j] += energy * bandXX[j];
      }
      accSaneG.lambda += energy * lambda;
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

  const metrics = computeMetrics(step, fs, kSettle);
  // Une courbe pathologique (plateau quasi nul) donne T ≈ 0 sur toute la bande,
  // donc Ms ≈ 1 : « boucle parfaitement amortie » alors que rien ne suit la
  // consigne. On ne publie Ms/Mt que quand la réponse a un plateau exploitable.
  const accG = useSane ? accSaneG : accAllG;
  const sensitivity =
    metrics.settleValue === null
      ? NO_SENSITIVITY
      : sensitivityPeaks(accG, weightSum, bLo, nfft, fs);

  return { t, y: step, quality, ...metrics, ...sensitivity };
}

interface SensitivityMetrics {
  ms: number | null;
  msFreqHz: number | null;
  mtDb: number | null;
  mtFreqHz: number | null;
  msBandTopHz: number | null;
}

const NO_SENSITIVITY: SensitivityMetrics = {
  ms: null,
  msFreqHz: null,
  mtDb: null,
  mtFreqHz: null,
  msBandTopHz: null,
};

interface TransferAccumulator {
  re: Float64Array;
  im: Float64Array;
  xx: Float64Array;
  lambda: number;
}

/**
 * Ms = max|1-T| et Mt = max|T| sur la bande réellement excitée par le manche.
 * `bLo` est le premier bin de la bande, nécessaire pour retrouver les Hz.
 */
function sensitivityPeaks(
  acc: TransferAccumulator,
  weightSum: number,
  bLo: number,
  nfft: number,
  fs: number,
): SensitivityMetrics {
  const n = acc.re.length;
  if (n === 0 || weightSum <= 0) return NO_SENSITIVITY;

  // Bande utile : on monte tant que le manche domine la régularisation. On
  // s'arrête au PREMIER décrochage et pas au dernier bin valide - au-delà d'un
  // trou, l'énergie qui revient est du bruit isolé, pas une bande continue.
  const radius = Math.max(1, Math.round((MS_SMOOTH_HZ * nfft) / fs));
  const xxSmooth = movingAverage(acc.xx, 2 * radius + 1);
  const floor = MS_MIN_SNR * acc.lambda; // même pondération des deux côtés
  let top = -1;
  for (let j = 0; j < n; j++) {
    if (xxSmooth[j] < floor) break;
    top = j;
  }
  const freqOf = (j: number): number => ((bLo + j) * fs) / nfft;
  if (top < 0 || freqOf(top) < MS_MIN_TOP_HZ) return NO_SENSITIVITY;

  const magT = new Float64Array(top + 1);
  const magS = new Float64Array(top + 1);
  for (let j = 0; j <= top; j++) {
    const tr = acc.re[j] / weightSum;
    const ti = acc.im[j] / weightSum;
    if (!Number.isFinite(tr) || !Number.isFinite(ti)) return NO_SENSITIVITY;
    magT[j] = Math.hypot(tr, ti);
    magS[j] = Math.hypot(1 - tr, ti); // |S| = |1 - T|
  }

  const peakS = smoothedPeak(magS, radius);
  if (!(peakS.value >= MS_THEORETICAL_FLOOR)) return NO_SENSITIVITY;

  const peakT = smoothedPeak(magT, radius);
  const mtDb = peakT.value > 0 ? 20 * Math.log10(peakT.value) : NaN;
  const mtOk = Number.isFinite(mtDb);
  return {
    ms: peakS.value,
    msFreqHz: freqOf(peakS.index),
    mtDb: mtOk ? mtDb : null,
    mtFreqHz: mtOk ? freqOf(peakT.index) : null,
    msBandTopHz: freqOf(top),
  };
}

/** Max de la moyenne glissante : un bin isolé ne fait pas un pic de boucle. */
function smoothedPeak(mag: Float64Array, radius: number): { value: number; index: number } {
  const smooth = movingAverage(mag, 2 * radius + 1);
  let best = -Infinity;
  let bestIdx = 0;
  for (let j = 0; j < smooth.length; j++) {
    if (smooth[j] > best) {
      best = smooth[j];
      bestIdx = j;
    }
  }
  return { value: best, index: bestIdx };
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

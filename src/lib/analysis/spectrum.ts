// Spectre vibrations (jello) + performance des filtres gyro - portage fidèle
// de la partie FFT de analyze_shimera.py : Welch simplifié sur le gyro brut,
// bandes RMS caractéristiques, pics dominants et attribution du pic global au
// moteur le plus proche via l'eRPM. Tout est déterministe, aucune IA.
import { bandRms, median, percentile, topPeaks, welchSpectrum } from '../dsp/dsp';
import type { Spectrum } from '../dsp/dsp';
import type {
  Axis,
  AxisSpectrum,
  FilterAxisMetrics,
  FilterMetrics,
  FlightData,
  SpectrumBand,
  SpectrumMetrics,
} from '../types';

/** En dessous de 2048 échantillons (une seule fenêtre Welch de 2048), la FFT
 *  moyenne n'est pas fiable - et les magnitudes ne sont plus comparables aux
 *  seuils calibrés sur fenêtre 4096. */
const MIN_SAMPLES_FOR_FFT = 2 * 1024;

/** Au-delà, l'échantillon gyro est une frame corrompue du décodeur WASM
 *  (ex. 4294967040 = -256 en u32) : un seul suffit à écraser tout le spectre. */
const GYRO_SANE_LIMIT = 5000;

/** Remplace les échantillons aberrants par la dernière valeur saine (continuité FFT). */
function sanitizeGyro(sig: Float32Array): Float32Array {
  let dirty = false;
  for (let i = 0; i < sig.length; i++) {
    if (!Number.isFinite(sig[i]) || Math.abs(sig[i]) > GYRO_SANE_LIMIT) {
      dirty = true;
      break;
    }
  }
  if (!dirty) return sig;
  const out = sig.slice();
  let last = 0;
  for (let i = 0; i < out.length; i++) {
    if (!Number.isFinite(out[i]) || Math.abs(out[i]) > GYRO_SANE_LIMIT) out[i] = last;
    else last = out[i];
  }
  return out;
}

/** Bandes de fréquence caractéristiques d'un quad (cf. analyze_shimera.py). */
const SPECTRUM_BANDS: ReadonlyArray<readonly [number, number, string]> = [
  [5, 40, 'prop-wash/pilotage <40Hz'],
  [40, 120, 'résonance châssis 40-120Hz'],
  [120, 350, 'plage moteur 120-350Hz'],
  [350, 900, 'harmoniques >350Hz'],
];

/** Bandes sur lesquelles on mesure l'atténuation des filtres (unfilt → filt). */
const FILTER_BANDS: ReadonlyArray<readonly [number, number]> = [
  [40, 120],
  [120, 350],
  [350, 900],
];

/** Le graphe reste léger : fréquences bornées à 1 kHz, ≤ 512 points. */
const CHART_MAX_FREQ_HZ = 1000;
const CHART_MAX_POINTS = 512;

/** eRPM brut (centaines d'eRPM) → fréquence de rotation mécanique en Hz. */
function erpmToHz(v: number, motorPoles: number): number {
  return (v * 100) / (motorPoles / 2) / 60;
}

/**
 * Tronque le spectre à ≤ 1 kHz puis le sous-échantillonne à ≤ 512 points
 * (moyenne par paquet de bins) pour que le rapport reste léger.
 */
function chartArrays(spec: Spectrum): { freqs: Float32Array; mags: Float32Array } {
  const { freqs, mags } = spec;
  let n = freqs.length;
  while (n > 0 && freqs[n - 1] > CHART_MAX_FREQ_HZ) n--;
  if (n <= CHART_MAX_POINTS) {
    return { freqs: freqs.slice(0, n), mags: mags.slice(0, n) };
  }
  const bucket = Math.ceil(n / CHART_MAX_POINTS);
  const nOut = Math.ceil(n / bucket);
  const outFreqs = new Float32Array(nOut);
  const outMags = new Float32Array(nOut);
  for (let o = 0; o < nOut; o++) {
    const start = o * bucket;
    const end = Math.min(start + bucket, n);
    let sumF = 0;
    let sumM = 0;
    for (let i = start; i < end; i++) {
      sumF += freqs[i];
      sumM += mags[i];
    }
    const count = end - start;
    outFreqs[o] = sumF / count;
    outMags[o] = sumM / count;
  }
  return { freqs: outFreqs, mags: outMags };
}

function axisSpectrum(sig: Float32Array, fsHz: number): AxisSpectrum {
  const spec = welchSpectrum(sanitizeGyro(sig), fsHz);
  // Une bande (presque) entièrement au-delà de Nyquist n'est pas mesurable :
  // on l'omet plutôt que de rapporter un RMS 0 trompeur (logs à faible rate).
  const nyq = (fsHz / 2) * 0.95;
  const bands: SpectrumBand[] = SPECTRUM_BANDS.filter(([lo]) => lo + 30 < nyq).map(([lo, hi, label]) => ({
    lo,
    hi: Math.min(hi, nyq),
    label,
    rms: bandRms(spec, lo, Math.min(hi, nyq)),
  }));
  // Bande dominante = max ; à égalité la première gagne (comme max() en python).
  let dominant = bands[0];
  for (const b of bands) if (b.rms > dominant.rms) dominant = b;
  const peaks = topPeaks(spec, { fMin: 15, k: 5 });
  const { freqs, mags } = chartArrays(spec);
  return { bands, dominantBand: dominant.label, peaks, freqs, mags };
}

/**
 * Spectre vibrations par axe (source gyro brut si dispo, sinon filtré) +
 * fondamentale moteur depuis l'eRPM + attribution du pic global dominant.
 * Retourne null si la session est trop courte pour une FFT propre.
 */
export function analyzeSpectrum(fd: FlightData, motorPoles: number): SpectrumMetrics | null {
  const src = fd.gyroUnfilt ?? fd.gyro;
  const source = fd.gyroUnfilt ? ('unfilt' as const) : ('filt' as const);
  if (src[0].length < MIN_SAMPLES_FOR_FFT) return null;

  const fs = fd.meta.sampleRateHz;
  const axes = [axisSpectrum(src[0], fs), axisSpectrum(src[1], fs), axisSpectrum(src[2], fs)] as [
    AxisSpectrum,
    AxisSpectrum,
    AxisSpectrum,
  ];

  // Régime moteur depuis l'eRPM (échantillons non nuls uniquement : au sol
  // l'ESC rapporte 0, ça fausserait la médiane).
  let perMotorHz: Array<{ median: number; p90: number }> | null = null;
  let motorFundamentalHz: number | null = null;
  if (fd.erpm) {
    perMotorHz = [];
    const all: number[] = [];
    for (let m = 0; m < 4; m++) {
      const arr = fd.erpm[m];
      const vals: number[] = [];
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] > 0) {
          vals.push(arr[i]);
          all.push(arr[i]);
        }
      }
      perMotorHz.push(
        vals.length > 0
          ? { median: erpmToHz(median(vals), motorPoles), p90: erpmToHz(percentile(vals, 90), motorPoles) }
          : { median: 0, p90: 0 },
      );
    }
    if (all.length > 0) motorFundamentalHz = erpmToHz(median(all), motorPoles);
  }

  // Pic global dominant (tous axes, fMin 15) attribué au moteur le plus proche
  // en Hz - en hover les 4 moteurs tournent à des régimes distincts.
  let dominantPeak: SpectrumMetrics['dominantPeak'] = null;
  if (motorFundamentalHz !== null && perMotorHz) {
    let bestAxis = -1;
    let bestMag = 0;
    let bestFreq = 0;
    for (let a = 0; a < 3; a++) {
      const p = axes[a].peaks[0];
      if (p && p.mag > bestMag) {
        bestMag = p.mag;
        bestFreq = p.freqHz;
        bestAxis = a;
      }
    }
    if (bestAxis >= 0) {
      let nearestMotor = -1;
      let distanceHz = Infinity;
      for (let m = 0; m < 4; m++) {
        // Un moteur sans télémétrie eRPM (median 0) capturerait tous les pics
        // basse fréquence (prop wash) → faux diagnostic de balourd : on l'exclut.
        if (perMotorHz[m].median <= 0) continue;
        const d = Math.abs(bestFreq - perMotorHz[m].median);
        if (d < distanceHz) {
          distanceHz = d;
          nearestMotor = m; // index 0-based (M1 = 0)
        }
      }
      if (nearestMotor >= 0) {
        dominantPeak = { freqHz: bestFreq, axis: bestAxis as Axis, nearestMotor, distanceHz };
      }
    }
  }

  return {
    source,
    axes,
    motorFundamentalHz,
    perMotorHz,
    dominantPeak,
    motorPolesAssumed: motorPoles,
  };
}

/**
 * Performance des filtres gyro : atténuation (dB) unfilt→filt par bande, et
 * bruit résiduel haute fréquence qui fuit dans le gyro filtré.
 */
export function analyzeFilters(fd: FlightData): FilterMetrics {
  const gu = fd.gyroUnfilt;
  if (!gu) return { available: false, axes: null };
  // Même gate que le spectre : sous 2048 échantillons les magnitudes Welch ne
  // sont plus comparables aux seuils calibrés (fenêtre réduite).
  if (gu[0].length < MIN_SAMPLES_FOR_FFT) return { available: false, axes: null };

  const fs = fd.meta.sampleRateHz;
  const nyq = (fs / 2) * 0.95;
  const hfHi = Math.min(500, nyq);
  const axes = [0, 1, 2].map((a): FilterAxisMetrics => {
    const specUnfilt = welchSpectrum(sanitizeGyro(gu[a]), fs);
    const specFilt = welchSpectrum(sanitizeGyro(fd.gyro[a]), fs);
    // Bande sans couverture réelle sous Nyquist → omise (un 0 dB serait lu
    // comme « filtres inefficaces » sur un simple log à faible sample rate).
    const attenuationDb = FILTER_BANDS.filter(([lo]) => lo + 30 < nyq).map(([lo, hi]) => {
      const hiEff = Math.min(hi, nyq);
      const u = bandRms(specUnfilt, lo, hiEff);
      const f = bandRms(specFilt, lo, hiEff);
      return { lo, hi: hiEff, db: u > 0 && f > 0 ? 20 * Math.log10(u / f) : 0 };
    });
    return { attenuationDb, residualHfRms: bandRms(specFilt, 100, hfHi) };
  });

  return { available: true, axes: axes as [FilterAxisMetrics, FilterAxisMetrics, FilterAxisMetrics] };
}

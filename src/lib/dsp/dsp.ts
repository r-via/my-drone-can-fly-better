// Bibliothèque DSP de Debrief — zéro dépendance, 100 % déterministe.
// Porte fidèlement les maths de analyze_shimera.py (spectrum, band_rms,
// top_peaks, rmsdiff) : mêmes conventions que numpy (std population ddof=0,
// percentile à interpolation linéaire, fenêtre de Hann symétrique np.hanning).

/** Moyenne arithmétique. NaN si vide. */
export function mean(x: ArrayLike<number>): number {
  const n = x.length;
  if (n === 0) return NaN;
  let s = 0;
  for (let i = 0; i < n; i++) s += x[i];
  return s / n;
}

/** Écart-type population (ddof=0, comme np.std). NaN si vide. */
export function std(x: ArrayLike<number>): number {
  const n = x.length;
  if (n === 0) return NaN;
  const m = mean(x);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = x[i] - m;
    s += d * d;
  }
  return Math.sqrt(s / n);
}

/** Médiane (interpolation linéaire, comme np.median). NaN si vide. */
export function median(x: ArrayLike<number>): number {
  return percentile(x, 50);
}

/**
 * Percentile p (0..100) avec interpolation linéaire entre rangs,
 * convention numpy par défaut : h = (n-1)*p/100. NaN si vide.
 */
export function percentile(x: ArrayLike<number>, p: number): number {
  const n = x.length;
  if (n === 0) return NaN;
  const a = Float64Array.from(x as ArrayLike<number>);
  a.sort();
  const h = ((n - 1) * p) / 100;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return a[lo];
  return a[lo] + (h - lo) * (a[hi] - a[lo]);
}

/**
 * RMS des écarts échantillon-à-échantillon (proxy bruit haute fréquence,
 * cf. analyze_shimera.rmsdiff). 0 si moins de 2 échantillons.
 */
export function rmsDiff(x: ArrayLike<number>): number {
  const n = x.length;
  if (n < 2) return 0;
  let s = 0;
  for (let i = 1; i < n; i++) {
    const d = x[i] - x[i - 1];
    s += d * d;
  }
  return Math.sqrt(s / (n - 1));
}

export interface Spectrum {
  freqs: Float32Array;
  mags: Float32Array;
}

/** Plus petite puissance de 2 >= n (1 pour n <= 1). */
export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Plus grande puissance de 2 <= max(n, 2). */
function prevPow2(n: number): number {
  let p = 2;
  while (p * 2 <= n) p <<= 1;
  return p;
}

/**
 * FFT complexe radix-2 Cooley-Tukey, itérative avec bit-reversal, in-place.
 * Convention numpy : X[k] = somme x[n]·e^(-2πi·kn/N). Longueur = puissance de 2.
 */
export function fft(re: Float64Array, im: Float64Array): void {
  fftCore(re, im, -1);
}

/** FFT inverse (twiddles conjugués + normalisation 1/N), in-place. */
export function ifft(re: Float64Array, im: Float64Array): void {
  fftCore(re, im, 1);
  const n = re.length;
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] /= n;
  }
}

function fftCore(re: Float64Array, im: Float64Array, sign: -1 | 1): void {
  const n = re.length;
  if (im.length !== n) throw new Error('fft: re et im doivent avoir la même longueur');
  if (n === 0 || (n & (n - 1)) !== 0) throw new Error('fft: la longueur doit être une puissance de 2');
  if (n === 1) return;

  // Permutation bit-reversal.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  // Table de twiddles : w[k] = e^(sign·2πi·k/n), k < n/2.
  const half = n >> 1;
  const wRe = new Float64Array(half);
  const wIm = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    const ang = (sign * 2 * Math.PI * k) / n;
    wRe[k] = Math.cos(ang);
    wIm[k] = Math.sin(ang);
  }

  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const stride = n / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < halfLen; j++) {
        const tw = j * stride;
        const p = i + j;
        const q = p + halfLen;
        const bRe = re[q] * wRe[tw] - im[q] * wIm[tw];
        const bIm = re[q] * wIm[tw] + im[q] * wRe[tw];
        re[q] = re[p] - bRe;
        im[q] = im[p] - bIm;
        re[p] += bRe;
        im[p] += bIm;
      }
    }
  }
}

/**
 * Densité spectrale façon Welch simplifié, identique à analyze_shimera.spectrum() :
 * signal recentré (moins sa moyenne), fenêtres de Hann symétriques (np.hanning)
 * de `win` échantillons (défaut 4096, réduit à la puissance de 2 inférieure si le
 * signal est plus court), overlap 50 %, moyenne des modules de rFFT.
 * Spectre vide si le signal est trop court pour une seule fenêtre.
 */
export function welchSpectrum(sig: ArrayLike<number>, fsHz: number, win = 4096): Spectrum {
  const n = sig.length;
  let w = win;
  if (n < w) w = prevPow2(Math.max(n, 2));

  if (n - w + 1 <= 0) return { freqs: new Float32Array(0), mags: new Float32Array(0) };

  const m = mean(sig);
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) a[i] = sig[i] - m;

  // Fenêtre de Hann symétrique (np.hanning : 0.5 - 0.5·cos(2πk/(M-1))).
  const hann = new Float64Array(w);
  if (w === 1) hann[0] = 1;
  else for (let k = 0; k < w; k++) hann[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (w - 1));

  const nBins = (w >> 1) + 1;
  const acc = new Float64Array(nBins);
  const re = new Float64Array(w);
  const im = new Float64Array(w);
  let segCount = 0;
  const hop = w >> 1;
  for (let start = 0; start <= n - w; start += hop) {
    for (let k = 0; k < w; k++) {
      re[k] = a[start + k] * hann[k];
      im[k] = 0;
    }
    fft(re, im);
    for (let b = 0; b < nBins; b++) acc[b] += Math.hypot(re[b], im[b]);
    segCount++;
  }

  const freqs = new Float32Array(nBins);
  const mags = new Float32Array(nBins);
  for (let b = 0; b < nBins; b++) {
    freqs[b] = (b * fsHz) / w;
    mags[b] = acc[b] / segCount;
  }
  return { freqs, mags };
}

/** RMS des magnitudes dans la bande [lo, hi[ ; 0 si aucun bin. */
export function bandRms(spec: Spectrum, lo: number, hi: number): number {
  let s = 0;
  let count = 0;
  const { freqs, mags } = spec;
  for (let i = 0; i < freqs.length; i++) {
    if (freqs[i] >= lo && freqs[i] < hi) {
      s += mags[i] * mags[i];
      count++;
    }
  }
  return count > 0 ? Math.sqrt(s / count) : 0;
}

/**
 * k pics dominants au-dessus de fMin, avec exclusion de ±exclusionHz (strict)
 * autour de chaque pic retenu — cf. analyze_shimera.top_peaks.
 * Défauts : fMin=15 Hz, k=5, exclusionHz=8.
 */
export function topPeaks(
  spec: Spectrum,
  opts?: { fMin?: number; k?: number; exclusionHz?: number },
): Array<{ freqHz: number; mag: number }> {
  const fMin = opts?.fMin ?? 15;
  const k = opts?.k ?? 5;
  const exclusionHz = opts?.exclusionHz ?? 8;

  const { freqs, mags } = spec;
  const f: number[] = [];
  const g: number[] = [];
  for (let i = 0; i < freqs.length; i++) {
    if (freqs[i] >= fMin) {
      f.push(freqs[i]);
      g.push(mags[i]);
    }
  }

  const peaks: Array<{ freqHz: number; mag: number }> = [];
  for (let iter = 0; iter < k; iter++) {
    let best = -1;
    let bestMag = 0;
    for (let i = 0; i < g.length; i++) {
      if (g[i] > bestMag) {
        bestMag = g[i];
        best = i;
      }
    }
    if (best < 0) break; // plus rien au-dessus de zéro
    const fPeak = f[best];
    peaks.push({ freqHz: fPeak, mag: bestMag });
    for (let i = 0; i < g.length; i++) {
      if (Math.abs(f[i] - fPeak) < exclusionHz) g[i] = 0;
    }
  }
  return peaks;
}

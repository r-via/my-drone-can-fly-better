import { describe, expect, it } from 'vitest';
import {
  bandRms,
  fft,
  ifft,
  mean,
  median,
  nextPow2,
  percentile,
  rmsDiff,
  std,
  topPeaks,
  welchSpectrum,
} from '../src/lib/dsp/dsp';

function sine(freqHz: number, fsHz: number, n: number, amp = 1, phase = 0): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin(2 * Math.PI * freqHz * (i / fsHz) + phase);
  return out;
}

describe('stats de base', () => {
  it('mean / std (population, ddof=0)', () => {
    expect(mean([1, 2, 3, 4])).toBeCloseTo(2.5, 12);
    // np.std([2, 4, 4, 4, 5, 5, 7, 9]) = 2 (population)
    expect(std([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 12);
    expect(std([5])).toBe(0);
    expect(Number.isNaN(mean([]))).toBe(true);
    expect(Number.isNaN(std([]))).toBe(true);
  });

  it('median sur cas simples', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBeCloseTo(2.5, 12);
    expect(median([7])).toBe(7);
    expect(Number.isNaN(median([]))).toBe(true);
  });

  it('percentile avec interpolation linéaire (convention numpy)', () => {
    const x = [15, 20, 35, 40, 50];
    expect(percentile(x, 0)).toBe(15);
    expect(percentile(x, 100)).toBe(50);
    expect(percentile(x, 50)).toBe(35);
    // np.percentile([15,20,35,40,50], 40) = 29 : h = 4*0.4 = 1.6 → 20 + 0.6*(35-20)
    expect(percentile(x, 40)).toBeCloseTo(29, 12);
    // np.percentile([1,2,3,4], 90) : h = 2.7 → 3 + 0.7*1 = 3.7
    expect(percentile([1, 2, 3, 4], 90)).toBeCloseTo(3.7, 12);
    expect(percentile([42], 75)).toBe(42);
  });

  it('rmsDiff sur une séquence connue calculée à la main', () => {
    // diffs = [3, -1, 2] → sqrt((9+1+4)/3) = sqrt(14/3)
    expect(rmsDiff([0, 3, 2, 4])).toBeCloseTo(Math.sqrt(14 / 3), 12);
    // Séquence constante → 0
    expect(rmsDiff([5, 5, 5, 5])).toBe(0);
    // Moins de 2 échantillons → 0
    expect(rmsDiff([1])).toBe(0);
    expect(rmsDiff([])).toBe(0);
  });

  it('nextPow2', () => {
    expect(nextPow2(1)).toBe(1);
    expect(nextPow2(2)).toBe(2);
    expect(nextPow2(3)).toBe(4);
    expect(nextPow2(4096)).toBe(4096);
    expect(nextPow2(4097)).toBe(8192);
    expect(nextPow2(0)).toBe(1);
  });
});

describe('fft / ifft', () => {
  it('fft(ifft(x)) ≈ x sur un signal aléatoire déterministe', () => {
    const n = 256;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    // Pseudo-aléatoire reproductible (LCG)
    let seed = 123456789;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff - 0.5;
    };
    for (let i = 0; i < n; i++) {
      re[i] = rnd();
      im[i] = rnd();
    }
    const re0 = Float64Array.from(re);
    const im0 = Float64Array.from(im);
    ifft(re, im);
    fft(re, im);
    for (let i = 0; i < n; i++) {
      expect(re[i]).toBeCloseTo(re0[i], 10);
      expect(im[i]).toBeCloseTo(im0[i], 10);
    }
  });

  it('ifft(fft(x)) ≈ x également', () => {
    const n = 128;
    const re = sine(7, 128, n);
    const im = new Float64Array(n);
    const re0 = Float64Array.from(re);
    fft(re, im);
    ifft(re, im);
    for (let i = 0; i < n; i++) {
      expect(re[i]).toBeCloseTo(re0[i], 10);
      expect(im[i]).toBeCloseTo(0, 10);
    }
  });

  it("fft d'un sinus pur : énergie concentrée au bon bin", () => {
    // 8 périodes exactes sur 512 échantillons → bin 8, |X| = n/2 = 256
    const n = 512;
    const re = sine(8, n, n); // fs = n → bin k = fréquence entière
    const im = new Float64Array(n);
    fft(re, im);
    const mag = Array.from({ length: n }, (_, i) => Math.hypot(re[i], im[i]));
    expect(mag[8]).toBeCloseTo(n / 2, 6);
    expect(mag[n - 8]).toBeCloseTo(n / 2, 6); // symétrie hermitienne du signal réel
    for (let i = 0; i < n; i++) {
      if (i !== 8 && i !== n - 8) expect(mag[i]).toBeLessThan(1e-7);
    }
  });

  it('fft rejette les longueurs non puissance de 2', () => {
    expect(() => fft(new Float64Array(3), new Float64Array(3))).toThrow();
    expect(() => fft(new Float64Array(0), new Float64Array(0))).toThrow();
    expect(() => fft(new Float64Array(8), new Float64Array(4))).toThrow();
  });

  it('fft respecte la convention numpy (signe -i au forward)', () => {
    // x = [1, 0, 0, 0, ...] → X[k] = 1 partout ; x = e^{2πi n/N} → pic à k=1
    const n = 16;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      re[k] = Math.cos((2 * Math.PI * k) / n);
      im[k] = Math.sin((2 * Math.PI * k) / n);
    }
    fft(re, im);
    expect(re[1]).toBeCloseTo(n, 8);
    expect(im[1]).toBeCloseTo(0, 8);
    expect(Math.hypot(re[n - 1], im[n - 1])).toBeLessThan(1e-8); // pas à k=-1
  });
});

describe('welchSpectrum', () => {
  it('sinus 100 Hz @ 2 kHz → pic à 100 ± 1 Hz', () => {
    const fs = 2000;
    const sig = sine(100, fs, 16384, 10);
    const spec = welchSpectrum(sig, fs);
    expect(spec.freqs.length).toBe(4096 / 2 + 1);
    let best = 0;
    for (let i = 1; i < spec.mags.length; i++) if (spec.mags[i] > spec.mags[best]) best = i;
    expect(Math.abs(spec.freqs[best] - 100)).toBeLessThanOrEqual(1);
    // Résolution attendue : fs/win = 2000/4096 ≈ 0.49 Hz par bin
    expect(spec.freqs[1]).toBeCloseTo(fs / 4096, 6);
  });

  it('signal court (< win) : fenêtre réduite à la puissance de 2 inférieure, pas de crash', () => {
    const fs = 1000;
    const sig = sine(50, fs, 3000); // 3000 < 4096 → win = 2048
    const spec = welchSpectrum(sig, fs);
    expect(spec.freqs.length).toBe(2048 / 2 + 1);
    let best = 0;
    for (let i = 1; i < spec.mags.length; i++) if (spec.mags[i] > spec.mags[best]) best = i;
    expect(Math.abs(spec.freqs[best] - 50)).toBeLessThanOrEqual(1);
  });

  it('signal minuscule : spectre vide, pas de crash', () => {
    expect(welchSpectrum([], 1000).freqs.length).toBe(0);
    expect(welchSpectrum([1], 1000).freqs.length).toBe(0);
    const tiny = welchSpectrum([1, 2], 1000); // win = 2, un segment
    expect(tiny.freqs.length).toBe(2);
  });

  it('le recentrage supprime la composante DC', () => {
    const fs = 1000;
    const sig = new Float64Array(8192);
    const s = sine(30, fs, 8192, 2);
    for (let i = 0; i < sig.length; i++) sig[i] = 500 + s[i]; // gros offset DC
    const spec = welchSpectrum(sig, fs);
    expect(spec.mags[0]).toBeLessThan(spec.mags[Math.round((30 / fs) * 4096)] / 100);
  });
});

describe('bandRms / topPeaks', () => {
  it('bandRms : RMS dans [lo,hi[, 0 si bande vide', () => {
    const spec = {
      freqs: Float32Array.from([0, 10, 20, 30, 40]),
      mags: Float32Array.from([1, 3, 4, 12, 5]),
    };
    // [10, 30[ → mags 3 et 4 → sqrt((9+16)/2)
    expect(bandRms(spec, 10, 30)).toBeCloseTo(Math.sqrt(25 / 2), 6);
    // borne hi exclusive : [10, 30] n'inclut pas 30
    expect(bandRms(spec, 20, 30)).toBeCloseTo(4, 6);
    expect(bandRms(spec, 100, 200)).toBe(0);
  });

  it('topPeaks : pics dominants avec exclusion, fMin par défaut 15 Hz', () => {
    const fs = 2000;
    const n = 16384;
    const sig = new Float64Array(n);
    const s1 = sine(100, fs, n, 10);
    const s2 = sine(240, fs, n, 6);
    const s3 = sine(400, fs, n, 3);
    const s4 = sine(5, fs, n, 50); // sous fMin, doit être ignoré
    for (let i = 0; i < n; i++) sig[i] = s1[i] + s2[i] + s3[i] + s4[i];
    const spec = welchSpectrum(sig, fs);
    const peaks = topPeaks(spec);
    expect(peaks.length).toBeGreaterThanOrEqual(3);
    expect(Math.abs(peaks[0].freqHz - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(peaks[1].freqHz - 240)).toBeLessThanOrEqual(1);
    expect(Math.abs(peaks[2].freqHz - 400)).toBeLessThanOrEqual(1);
    expect(peaks[0].mag).toBeGreaterThan(peaks[1].mag);
    expect(peaks[1].mag).toBeGreaterThan(peaks[2].mag);
    for (const p of peaks) expect(p.freqHz).toBeGreaterThanOrEqual(15);
    // Les pics retenus sont espacés d'au moins exclusionHz
    for (let i = 1; i < peaks.length; i++) {
      expect(Math.abs(peaks[i].freqHz - peaks[0].freqHz)).toBeGreaterThanOrEqual(8);
    }
  });

  it('topPeaks : options fMin/k/exclusionHz respectées, spectre nul → []', () => {
    const spec = {
      freqs: Float32Array.from([0, 10, 20, 30, 40, 50]),
      mags: Float32Array.from([9, 8, 5, 7, 6, 2]),
    };
    const peaks = topPeaks(spec, { fMin: 20, k: 2, exclusionHz: 11 });
    expect(peaks).toHaveLength(2);
    expect(peaks[0]).toEqual({ freqHz: 30, mag: 7 });
    // 20 et 40 exclus (à moins de 11 Hz de 30) → prochain pic = 50
    expect(peaks[1]).toEqual({ freqHz: 50, mag: 2 });

    const silent = { freqs: Float32Array.from([10, 20]), mags: Float32Array.from([0, 0]) };
    expect(topPeaks(silent, { fMin: 0 })).toEqual([]);
  });
});

describe('cohérence avec la référence python (analyze_shimera.spectrum)', () => {
  it('reproduit les sorties exactes de spectrum/band_rms/top_peaks/rmsdiff numpy', () => {
    // Valeurs de référence générées avec analyze_shimera.py (numpy) sur ce
    // signal déterministe : fs=1987, n=9000,
    // sig = 17 + 3·sin(2π·137.3·t) + 1.2·sin(2π·412.9·t) + 0.4·sin(2π·733.7·t + 1)
    const fs = 1987;
    const n = 9000;
    const sig = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      sig[i] =
        17 +
        3 * Math.sin(2 * Math.PI * 137.3 * t) +
        1.2 * Math.sin(2 * Math.PI * 412.9 * t) +
        0.4 * Math.sin(2 * Math.PI * 733.7 * t + 1);
    }

    expect(mean(sig)).toBeCloseTo(17.00029051449661, 9);
    expect(std(sig)).toBeCloseTo(2.30233586859694, 9);
    expect(median(sig)).toBeCloseTo(16.996245500427257, 9);
    expect(percentile(sig, 90)).toBeCloseTo(20.122832346537177, 9);
    expect(rmsDiff(sig)).toBeCloseTo(1.4718826104636678, 9);

    const spec = welchSpectrum(sig, fs);
    expect(spec.freqs.length).toBe(2049);
    const relClose = (got: number, want: number, tol = 1e-3) =>
      expect(Math.abs(got - want)).toBeLessThanOrEqual(Math.abs(want) * tol + 1e-9);
    relClose(bandRms(spec, 40, 120), 0.0002772497228520638);
    relClose(bandRms(spec, 120, 300), 195.31107263620663);
    relClose(bandRms(spec, 300, 600), 60.531240429724384);
    relClose(spec.mags[283], 3069.457233134736);

    const peaks = topPeaks(spec, { k: 3 });
    expect(peaks).toHaveLength(3);
    expect(peaks[0].freqHz).toBeCloseTo(137.285400390625, 4);
    relClose(peaks[0].mag, 3069.457233134736);
    expect(peaks[1].freqHz).toBeCloseTo(412.826416015625, 4);
    relClose(peaks[1].mag, 1210.3871533453012);
    expect(peaks[2].freqHz).toBeCloseTo(733.482421875, 4);
    relClose(peaks[2].mag, 359.0812212983419);
  });

  it('fenêtre de Hann symétrique : magnitude du pic ≈ amp·(n/2)·mean(hann) pour un sinus aligné', () => {
    // Sinus exactement sur un bin : |rfft(s·hann)|[k0] ≈ amp·win/2·mean(hann)
    // avec mean(np.hanning(win)) ≈ 0.5 pour win grand.
    const fs = 4096;
    const win = 4096;
    const amp = 2;
    const sig = sine(128, fs, win, amp); // 1 segment exactement, bin 128 pile
    const spec = welchSpectrum(sig, fs, win);
    const k0 = 128;
    const expected = (amp * win) / 2 / 2; // amp · win/2 · 0.5
    expect(spec.mags[k0]).toBeGreaterThan(expected * 0.98);
    expect(spec.mags[k0]).toBeLessThan(expected * 1.02);
  });
});

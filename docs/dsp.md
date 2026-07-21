# Signal processing

[`src/lib/dsp/dsp.ts`](../src/lib/dsp/dsp.ts) is 260 lines, zero dependencies,
and every function matches a numpy convention on purpose: the goldens in
`tests/golden/` were captured from Python reference scripts, and the browser has
to keep agreeing with them.

## Statistics

| Function | Convention | Empty input |
| --- | --- | --- |
| `mean(x)` | arithmetic mean | `NaN` |
| `std(x)` | population, ddof = 0, like `np.std` | `NaN` |
| `median(x)` | `percentile(x, 50)` | `NaN` |
| `percentile(x, p)` | linear interpolation, `h = (n-1)p/100`, like `np.percentile` | `NaN` |
| `rmsDiff(x)` | `sqrt(sum((x[i]-x[i-1])^2) / (n-1))` | `0` if n < 2 |

`std` being population and not sample matters: on a 500 000 sample flight the
difference is invisible, but the goldens were produced with numpy and the test
tolerance is 2 %, so consistency is cheaper than an explanation.

`rmsDiff` is the high frequency noise proxy used everywhere in the noise
analysis. It is sensitive to sample to sample jitter and blind to slow drift,
which is exactly what you want when asking "is the gyro shaking".

## FFT

```ts
fft(re: Float64Array, im: Float64Array): void   // in place
ifft(re: Float64Array, im: Float64Array): void  // in place, normalised by 1/N
nextPow2(n: number): number
```

Iterative radix 2 Cooley Tukey with bit reversal permutation and a precomputed
twiddle table, in place, numpy sign convention:

```
X[k] = sum_n x[n] * exp(-2i*pi*k*n/N)
```

Length must be a power of two, otherwise it throws. `ifft` reuses the same core
with conjugated twiddles and divides by N at the end.

## Welch spectrum

```ts
welchSpectrum(sig, fsHz, win = 4096): { freqs: Float32Array; mags: Float32Array }
```

A simplified Welch periodogram, a faithful port of `spectrum()` in
`analyze_shimera.py`:

1. remove the mean from the signal;
2. cut it into windows of `win` samples with 50 % overlap;
3. apply a symmetric Hann window, `np.hanning` convention:
   `w[k] = 0.5 - 0.5*cos(2*pi*k/(M-1))`;
4. take the magnitude of the real FFT of each window;
5. average the magnitudes across windows.

If the signal is shorter than `win`, the window shrinks to the previous power of
two. If it cannot fit even one window, the result is two empty arrays.

### The window energy anchor

Shrinking the window changes the magnitudes: `|FFT|` grows roughly as
`sqrt(win)` for the same noise process. Without correction, a short log analysed
with a 1024 point window would read 25 to 75 % below thresholds calibrated on
4096, and would silently pass rules it should fail.

So magnitudes are rescaled to the reference window energy:

```
REF_ENERGY = 0.375 * (4096 - 1) = 1535.625   // exact sum of hann^2 over 4096 symmetric points
scale = win === 4096 ? 1 : sqrt(REF_ENERGY / sum(hann^2))
```

At `win = 4096` the factor is exactly 1, so golden parity with the Python
reference is preserved.

Note that the amplitudes are not a physical power spectral density. They are a
consistent, comparable scale, which is what the thresholds need. Any threshold
expressed in these units is only meaningful against this exact function.

## Band RMS

```ts
bandRms(spec, lo, hi): number
```

Root mean square of the magnitudes in `[lo, hi[`, or 0 when no bin falls in the
range. The bands used by the analysis are defined in
[analysis.md](analysis.md#spectrum).

## Peak picking

```ts
topPeaks(spec, { fMin = 15, k = 5, exclusionHz = 8 })
```

Greedy: take the largest magnitude above `fMin`, record it, zero out everything
strictly within `exclusionHz` of it, repeat `k` times or until nothing positive
remains. This is a port of `top_peaks` in `analyze_shimera.py`.

The 15 Hz floor keeps piloting input and prop wash out of the peak list. The
8 Hz exclusion stops a single broad peak from being reported five times.

## Direct DFT

`src/lib/analysis/flight.ts` carries its own `dftPower`, not shared with this
module, because the yoyo analysis needs amplitudes at arbitrary non FFT bin
frequencies (0.5 to 20 Hz in 0.25 Hz steps). It evaluates the sum directly and
normalises by signal length, a port of `dft_power` from `analyze_pico.py`. On a
signal downsampled to about 100 Hz this is cheap enough that an FFT plus
interpolation would only add error.

## Testing

`tests/dsp.test.ts` covers all of it with 19 synthetic cases: FFT against known
transforms, round trip `ifft(fft(x)) == x`, Welch on pure tones at known
frequencies, band RMS boundaries, peak exclusion behaviour, and the numpy
percentile convention at fractional ranks. It needs no log file and runs
anywhere.

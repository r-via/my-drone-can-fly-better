# Testing

```bash
npm test           # 125 vitest cases, node environment
npx tsc --noEmit   # type check, also enforces translation completeness
```

Vitest runs in a Node environment with a 60 second per test timeout, since the
golden suites decode real multi megabyte logs. Configuration is
[`vitest.config.ts`](../vitest.config.ts).

## The ten suites

| Suite | Cases | Needs a log file | Covers |
| --- | --- | --- | --- |
| `dsp.test.ts` | 19 | no | FFT, ifft round trip, Welch, band RMS, peak exclusion, numpy percentile convention |
| `charts.test.ts` | 21 | no | the three geometry helpers plus server side rendering of the chart components |
| `rules.test.ts` | 14 | no | every rule against synthetic `SessionAnalysis` fixtures |
| `ui-shell.test.ts` | 4 | no | `useAnalyzer` exports and `collectCliLines` |
| `basic.test.ts` | 26 | yes | power, motors, noise, tracking, timeline, GPS, failsafe against the goldens |
| `spectrum.test.ts` | 12 | yes | bands, peaks, motor attribution, filter attenuation |
| `flight.test.ts` | 11 | yes | yoyo and prop wash |
| `step.test.ts` | 5 | yes | step response, quality gating |
| `cli.test.ts` | 11 | yes | header reconstruction, lint-key coverage guard, the nine lint rules |
| `parse.test.ts` | 1 | yes | the decoder agreeing with orangebox on a real chimera log |

The four synthetic suites run anywhere and are where new logic gets covered.

## Golden tests

Six suites compare the TypeScript pipeline against `tests/golden/*.txt`,
captured outputs of the older Python reference scripts (`analyze_pico.py`,
`analyze_lr4.py`, `analyze_shimera.py`, running on the orangebox parser).

```
tests/golden/chimera_016.txt    Chimera7, 6S, ~2 kHz, gyroUnfilt + eRPM
tests/golden/lr4_003.txt        LR4, 4S, short session
tests/golden/pico_002.txt       Pavo Pico, 2S, the largest reference
```

The goldens are human readable text, the actual terminal output of the Python
scripts:

```
===== explorer lr4/btfl_003.bbl =====  7219 frames  (~4s)  | 4S détecté
throttle stick : avg 1224  (min 1000 max 1465)
vbat           : max 16.28V  min 15.37V  (4.07->3.84 V/cell)  sag 0.91V
courant        : avg 3.7A  max 16.9A
moteurs        : avg 26%  | par moteur (M1-4): 22 30 20 31 %  | saturation 0.07%
```

### Tolerances

```ts
function expectClose(actual, golden, pctTol = 2, absTol = 0.05) {
  expect(Math.abs(actual - golden)).toBeLessThanOrEqual(Math.abs(golden) * pctTol / 100 + absTol);
}
```

2 % on RMS values and averages, plus an absolute term covering the golden's own
display rounding. Rounded integers get 1 unit. Wider tolerances exist in a few
places and each one carries a comment explaining exactly which frames the WASM
decoder reads differently from orangebox.

### The motor basis conversion

The Python scripts hardcode the low end of the motor range (48, or 278 for the
Pico) while `basic.ts` reads `meta.motorOutputLow`, which is 158 on the Chimera.
The tests convert percentages back to the Python basis before comparing:

```ts
function toPyBasis(fd, pct, pyLow) {
  const raw = fd.meta.motorOutputLow + (pct / 100) * (fd.meta.motorOutputHigh - fd.meta.motorOutputLow);
  return ((raw - pyLow) / (2047 - pyLow)) * 100;
}
```

This is not a fudge factor, it is a unit conversion. The TypeScript reading is
the correct one; the goldens are compared on their own terms.

### Known intentional divergences

Some values deliberately do not match, and the tests assert the new behaviour
with a comment:

- **Sag.** The goldens use `max - min` over the whole log, the TypeScript uses
  the worst transient drop against a 3 second rolling maximum. On the Chimera
  the golden reads 4.76 V and the transient sag is lower, correctly, because
  slow discharge is excluded.
- **Timeline states.** The golden classifies the first seconds as "low" because
  it computes thrust differently.
- **Corrupt frames.** A few peaks in the Pico spectrum sit in a region where the
  WASM decoder and orangebox disagree on frame boundaries.

## Golden tests do not run on a fresh clone

They read real `.bbl` files by absolute path from the maintainer machine:

```ts
const CHIMERA = '/home/rviau/projects/drones/chimera/blackbox/btfl_016.bbl';
const LR4     = '/home/rviau/projects/drones/explorer lr4/btfl_003.bbl';
const PICO    = '/home/rviau/projects/drones/pavo pico/btfl_002.bbl';
```

Clone the repository elsewhere and those six suites fail on a missing file. That
is expected and documented in CONTRIBUTING. The logs are not vendored: they are
tens of megabytes each and carry GPS traces.

The four synthetic suites are the contribution surface. New logic belongs there.

## Rule tests

`tests/rules.test.ts` builds a synthetic `SessionAnalysis` with factory helpers
(`makeMeta`, `makeAxisSpectrum`, `makeStep`, `makeAnalysis`) and mutates one
field per case. No parsing, no log, milliseconds per test. This is possible
because the rule engine depends only on the `SessionAnalysis` type, never on the
analysis implementations.

A new rule should assert three things: it fires when it should, it stays quiet
when it should not, and the boundary behaves.

## Chart tests

`tests/charts.test.ts` calls `buildSpectrumPaths`, `buildStepPaths` and
`buildTimelineRects` directly on synthetic inputs, parses the resulting SVG path
strings back into coordinates, and checks the geometry. It also renders each
component with `renderToStaticMarkup` to catch a crash in the JSX. That works
because the chart components are pure functions of their props with no hooks.

## The rule that matters

If a change makes the numbers move, say so explicitly and explain which of the
two readings is right. Silently loosening a tolerance to make a golden pass is
the one thing that breaks this project: the goldens are the only evidence that
the browser still agrees with a reference implementation nobody runs any more.

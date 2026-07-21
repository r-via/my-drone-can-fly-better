# Rule engine

[`src/lib/rules/engine.ts`](../src/lib/rules/engine.ts) is the whole verdict
layer: one function, `evaluateSession(analysis, profile, dict) -> Finding[]`,
made of 23 independent threshold comparisons.

No prose lives here. Titles, explanations and fix texts come from
`dict.rules.*`; the engine only decides *whether* a rule fires, *how severe* it
is, and *which numbers* go into `evidence`.

## Helpers

```ts
worstAxis(values)            // the axis with the highest value, ignoring nulls
sevAbove(v, warn, crit)      // 'crit' | 'warn' | null
attenuationInBand(entries, lo, hi)  // dB, weighted by band overlap
perAxisList(values, digits)  // "Roll 7.0 / Pitch 12.7 / Yaw 9.6"
```

`sevAbove` is the shape most rules use: one metric, two thresholds, both from
the drone profile.

## The 23 rules

Severity column: a single value means fixed, `warn/crit` means chosen by
`sevAbove` against the two profile thresholds.

### Vibrations

| id | Severity | Fires when | Threshold source |
| --- | --- | --- | --- |
| `noise-mech-high` | warn/crit | worst axis `noise.unfiltRms` above threshold | `unfiltNoiseWarn`, `unfiltNoiseCrit` |
| `chassis-resonance` | warn | on any axis, the 40 to 120 Hz band is dominant **and** its RMS exceeds 1.5x the 120 to 350 Hz band | fixed 1.5 ratio |
| `motor-noise-peak` | info, or warn if raw noise is already high | `spectrum.dominantPeak.distanceHz < 30` | fixed 30 Hz |

`motor-noise-peak` is the rule that names a motor. Its detail is enriched
contextually: if eRPM is not available it says so, and if the filters attenuate
the 120 to 350 Hz band by less than 15 dB on that axis it points at the RPM
filter instead of at the hardware.

`chassis-resonance` appends the dominant peak with its nearest motor and the
distance in Hz when one is available.

### Filters

| id | Severity | Fires when | Threshold source |
| --- | --- | --- | --- |
| `noise-filtered-leak` | warn/crit | worst axis `noise.filtRms` above threshold | `filtNoiseWarn`, `filtNoiseCrit` |
| `filters-weak` | warn | weakest axis attenuation over 120 to 350 Hz is under 15 dB | fixed 15 dB |
| `filters-residual-hf` | warn | worst axis `residualHfRms` above threshold | `residualHfWarn` |

The last two need `gyroUnfilt`. Without it, `filters.available` is false and
neither can fire, which is correct: with only filtered gyro there is nothing to
compare against.

### PID

| id | Severity | Fires when | Threshold source |
| --- | --- | --- | --- |
| `tracking-poor` | warn/crit | worst axis `tracking.meanAbsErr` above threshold | `trackingWarn`, `trackingCrit` |
| `step-overshoot` | warn | worst usable axis `overshootPct` at or above threshold | `overshootWarn` |
| `step-slow` | warn | worst usable axis `riseTimeMs` at or above threshold | `riseTimeSlowMs` |
| `step-settle-off` | warn | any usable axis `settleValue` outside 0.85 to 1.15 | fixed band |
| `yoyo-detected` | warn on `pico`, info elsewhere | `yoyo.applicable` and `ratio` at or above threshold | `yoyoRatioWarn` |
| `propwash-severe` | warn | `propwash.worstSeverity` at or above threshold | `propwashWarn` |

**"Usable axis"** for the three step rules means `quality >= 0.3`. Axes below
that are treated as absent, and between 0.3 and 0.5 the evidence carries a
confidence note. Without that gate a log with 7 % usable windows reported a
163 % overshoot that was pure deconvolution noise.

`step-settle-off` emits at most one finding, on the first offending axis, so the
id stays unique inside a session report.

`tracking-poor` adapts its advice: if the filtered gyro is clean it suggests
gain work on the offending axis, if the gyro is noisy it says fix the noise
first, because tuning on top of noise is wasted effort.

`step-slow` similarly checks whether the 120 to 350 Hz attenuation on that axis
exceeds 30 dB, and if so blames filter delay rather than low gains.

### Motors

| id | Severity | Fires when | Threshold source |
| --- | --- | --- | --- |
| `motors-saturation` | warn/crit | `motors.saturationPct` above threshold | `saturationWarn`, `saturationCrit` |
| `motors-imbalance` | warn | `motors.imbalancePctPts` at or above threshold | `imbalanceWarn` |
| `motors-desync` | crit | any motor has at least one eRPM zero while flying | none, any occurrence |

`motors-imbalance` names the highest and lowest motor, so the evidence reads as
"M3 works hardest, M1 least" rather than a bare number.

### Battery

| id | Severity | Fires when | Threshold source |
| --- | --- | --- | --- |
| `battery-sag` | warn/crit | `sagV / cells` above threshold | `sagPerCellWarn`, `sagPerCellCrit` |
| `battery-empty` | crit | `perCellMin` below threshold | `perCellMinCrit` |
| `battery-cells-unexpected` | warn | detected cell count differs from the profile expectation | `profile.expectedCells` |

All three require `power !== null` and `cells > 0`. `battery-cells-unexpected`
never fires on the `generic` profile, whose `expectedCells` is null.

### GPS, safety, log

| id | Severity | Fires when |
| --- | --- | --- |
| `gps-low-sats` | warn | GPS available and `numSatMin < 6` |
| `failsafe-triggered` | crit | any non benign failsafe phase recorded |
| `propwash-untested` | info | the flight contains no descent, so prop wash was never exercised |
| `log-quality` | info | session shorter than 30 s, or sample rate under 900 Hz |
| `all-good` | ok | no `warn` and no `crit` finding fired |

`log-quality` accumulates its issues into one finding and, when the sample rate
is the problem, ships a CLI fix: `set blackbox_sample_rate = 1/1`. It also
reports the usable analysis bandwidth, which is half the sample rate.

`all-good` summarises the strong points instead of the weak ones: worst raw
noise, worst filtered noise, worst tracking error, saturation, sag per cell.

Note the category assignments that differ from what a first reading suggests:
`propwash-severe` is a **PID** finding (it is a tuning symptom),
`propwash-untested` is a **log** finding (it is a coverage gap), and
`yoyo-detected` is **PID**.

## Ordering and the `all-good` interaction

`evaluateSession` returns findings sorted `crit`, `warn`, `info`, `ok` with a
stable sort, so within a severity the declaration order above is preserved.

`buildSessionReport` in `report.ts` then merges the config lint findings and
re-sorts with `sortFindings`, which is severity first, then category name. One
extra step matters:

```ts
if (findings.some(f => f.severity === 'warn' || f.severity === 'crit')) {
  findings = findings.filter(f => f.id !== 'all-good');
}
```

The engine cannot see the config lint, so it may emit `all-good` on a flight
whose configuration is broken. That filter removes the contradiction.

## Writing a rule

A rule is a block in `evaluateSession` that reads `analysis`, compares against
`profile.thresholds`, and pushes a `Finding`. The contract:

1. **A stable id.** A slug, never renamed once shipped. It is the DOM
   `data-rule` attribute, a test anchor and a user bookmark.
2. **Numbers in `evidence`, not adjectives.** "Roll 7.0 / Pitch 12.7 / Yaw 9.6,
   threshold 8" is evidence. "Noise is high" is not.
3. **Thresholds in `ProfileThresholds`**, not inline, so every drone can tune
   them, and with a comment saying where the value comes from: field calibration
   on real logs, or a published reference. A number out of thin air is worse
   than no rule.
4. **No prose in the engine.** Add the key to `src/lib/i18n/fr/rules.ts` first,
   which is the reference shape, then to the four translations. `tsc` fails
   until all five are complete.
5. **`fix.cli` never contains `save`.** The UI appends it once at the end of the
   assembled script, and duplicating it would be confusing.

Then cover it in `tests/rules.test.ts` against a synthetic `SessionAnalysis`:
it fires when it should, stays quiet when it should not, and the boundary
behaves. No log file needed.

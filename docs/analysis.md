# Analysis modules

Twelve metric functions, all pure, all taking a `FlightData` and returning a
piece of `SessionAnalysis`. They are assembled by `analyzeFlightData` in
[`src/lib/report.ts`](../src/lib/report.ts).

| Module | File | Produces |
| --- | --- | --- |
| power, motors, noise, tracking, timeline, GPS, failsafe | `analysis/basic.ts` | the direct statistics |
| spectrum, filters | `analysis/spectrum.ts` | FFT based metrics |
| step response | `analysis/step.ts` | Wiener deconvolution |
| yoyo, prop wash | `analysis/flight.ts` | flight behaviour |

## Shared guards

Corrupt frames survive the decoder. A single one can destroy a whole spectrum or
send a mean to infinity, so every module filters explicitly:

| Constant | Value | Meaning |
| --- | --- | --- |
| `GYRO_ABERRATION_LIMIT` / `GYRO_SANE_LIMIT` | 5000 deg/s | above this the frame is corrupt, not a fast roll |
| `MOTOR_OVER_RANGE_MARGIN` | 8 | motor values up to `high + 8` are real DSHOT jitter, beyond that the frame is corrupt |
| `FLIGHT_THROTTLE_US` | 1100 | throttle stick above this counts as flying |

The classic corrupt value is `4294967040`, which is `-256` read as unsigned 32
bit. The orangebox parser dropped those frames; the WASM decoder passes them
through, so the analysis layer drops them instead.

## Power

`analyzePower(fd): PowerMetrics | null`, null without `vbat`.

**Cell count.** `cells = max(1, ceil(vbatMax / 4.35))`, the smallest count that
keeps the observed maximum under 4.35 V per cell (LiHV full charge). The obvious
`round(v / 4.2)` is wrong on a partly used pack: 22.56 V rounds to 5S, which
would be 4.51 V per cell, physically impossible, when it is a 6S at 3.76 V.

**Sag** is the worst *transient* drop, not `max - min`:

```
sag = max over i of ( max(vbat over the previous 3 s) - vbat[i] )
```

computed in O(n) with a monotonic deque. Taking `max - min` over the whole log
confounded the normal discharge of a long flight with a tired pack, and every
long range flight tripped the battery rule.

**mAh** is a trapezoidal integral of current over time, divided by 3.6. Each dt
is clamped to 1 second so a recording pause while disarmed does not bill the
whole gap at the last known current.

Samples with `vbat <= 0` are skipped throughout: they are invalid ADC readings.

## Motors

`analyzeMotors(fd): MotorMetrics`.

- `perMotorAvgPct[m]`: mean of the valid raw samples of motor `m`, converted
  with the session's own `motorOutputLow/High`.
- `imbalancePctPts`: `max - min` across the four averages, in percentage points.
  A mechanical or CG asymmetry shows up here before it shows up anywhere else.
- `saturationPct`: share of valid samples at or above `motorOutputHigh - 8`.
  That margin matches the 2040 threshold of the Python scripts on a 2047 scale.
- `desyncZeros[m]`: number of samples where eRPM is exactly 0 **while flying**
  (throttle above 1100 us). On the ground zero is normal, in the air it means
  the ESC lost sync with the motor.
- `erpmAvailable`: whether bidirectional DSHOT telemetry was logged at all.

## Noise

`analyzeNoise(fd): NoiseMetrics`, per axis:

| Field | Definition |
| --- | --- |
| `filtRms` | `rmsDiff` of the filtered gyro, deg/s |
| `unfiltRms` | `rmsDiff` of the raw gyro, null if not logged |
| `ratio` | `unfiltRms / filtRms`, filtering effectiveness |
| `gyroPeak` | max absolute filtered gyro, deg/s |

Frames whose filtered gyro exceeds 5000 deg/s are excluded from **both** signals
at the same index, so the two RMS values stay comparable sample for sample.

Read it as: `unfiltRms` is a mechanical measurement (props, bearings, screws),
`filtRms` is what the PID loop actually sees. High raw with low filtered means
the filters are working hard and adding delay. High filtered means noise reaches
the D term and the motors.

## Tracking

`analyzeTracking(fd): TrackingMetrics`, per axis: mean of `|setpoint - gyro|`,
its maximum, and the maximum absolute setpoint (used as context, a log with a
5 deg/s peak setpoint says nothing about tracking).

## Spectrum

`analyzeSpectrum(fd, motorPoles): SpectrumMetrics | null`.

Returns null under 2048 samples, one Welch window, because below that the
averaged magnitudes are not comparable to thresholds calibrated at 4096.

**Source**: raw gyro when the log has it, filtered otherwise, reported in
`.source`. Aberrant samples are replaced by the last sane value rather than
dropped, to keep FFT continuity.

**Bands**, per axis:

| Range | Label | What lives there |
| --- | --- | --- |
| 5 to 40 Hz | prop wash / piloting | pilot input, prop wash, airframe motion |
| 40 to 120 Hz | frame resonance | arms, stack mounting, loose hardware |
| 120 to 350 Hz | motor range | motor fundamentals |
| 350 to 900 Hz | harmonics | harmonics of the above |

A band whose lower bound plus 30 Hz sits above 0.95 x Nyquist is omitted rather
than reported as zero, so a low sample rate log does not read as "no motor
noise". `dominantBand` is the highest RMS, first one wins on a tie, matching
Python's `max()`.

**Peaks**: top 5 per axis via `topPeaks(spec, { fMin: 15, k: 5 })`.

**Motor fundamental**: median of the non zero eRPM samples of all motors,
converted with the profile's pole count. Zero samples are excluded because a
grounded ESC reports zero and would drag the median down.

**Dominant peak attribution** is the part that turns a number into an actionable
verdict. Take the largest first peak across the three axes, then find the motor
whose median frequency is closest:

```ts
dominantPeak = { freqHz, axis, nearestMotor, distanceHz }
```

Motors with a median of 0, no eRPM telemetry, are excluded from the search,
otherwise they would capture every low frequency peak and produce a fake
imbalance diagnosis. In a hover the motors run at visibly different speeds,
which is what makes attribution possible at all. The rule fires when
`distanceHz < 30`.

**Chart arrays**: truncated to 1 kHz, then bucket averaged to at most 512
points.

## Filters

`analyzeFilters(fd): FilterMetrics`. Requires `gyroUnfilt` and at least 2048
samples, otherwise `available: false`.

Per axis, Welch of both signals, then per band:

```
attenuation_dB = 20 * log10( bandRms(unfiltered) / bandRms(filtered) )
```

over 40 to 120, 120 to 350 and 350 to 900 Hz. Bands without real coverage under
Nyquist are omitted, since a 0 dB entry would read as "filters do nothing".

`residualHfRms` is `bandRms(filtered, 100, min(500, nyquist))`: how much high
frequency energy survives into the signal that drives the D term and therefore
the motors.

## Step response

`analyzeStepResponse(fd): StepResponseMetrics | null`, the
[Plasmatree PID-Analyzer](https://github.com/Plasmatree/PID-Analyzer) method.

For each 2 second Hann window with 50 % overlap, Wiener deconvolution of
setpoint against gyro:

```
G(f) = Y * conj(X) / (|X|^2 + lambda)
h    = Re(ifft(G))
step = cumsum(h)      truncated to 500 ms
```

Windows are energy weighted and averaged. **There is no normalisation**, which
is the whole point: a settle value near 1 genuinely means the PID reaches its
setpoint, and a value of 0.8 means it does not.

| Constant | Value | Why |
| --- | --- | --- |
| `MIN_DURATION_S` | 20 s | shorter logs cannot support the estimate |
| `WINDOW_S` | 2 s | overlap 50 % |
| `RESPONSE_S` | 0.5 s | length of the returned curve |
| `SETTLE_START_S` | 0.2 s | plateau measured over 200 to 500 ms |
| `MIN_EXCITATION_DEGS` | 20 / 20 / 10 | minimum peak setpoint per axis to keep a window |
| `EXCITATION_FALLBACK_FACTOR` | 0.5 | retry at half threshold if no window qualifies |
| `WIENER_REG_FACTOR` | 1e-4 | `lambda = 1e-4 * max|X|^2` |
| `LAMBDA_FLOOR_HZ` | 2 Hz | `max|X|^2` is taken above this frequency |
| `WINDOW_PLATEAU_MIN/MAX` | 0.5 / 1.5 | robustness filter on individual windows |
| `PATHOLOGICAL_SETTLE` | 0.1 | below this the metrics are null, the curve is still drawn |

Three subtleties worth knowing:

- **The lambda floor.** A long sustained turn puts enormous near DC energy into
  X. Taking `max|X|^2` from bin 0 would inflate lambda by orders of magnitude
  and crush the useful band, systematically underestimating the plateau. Near DC
  bins remain self regularised since `|X|^2` dwarfs lambda there anyway.
- **The plateau filter.** A window whose own 200 to 500 ms plateau falls outside
  `[0.5, 1.5]` is a deconvolution artefact from poor SNR, not a physical
  response, and is dropped from the average. If *every* window is out of range,
  which is what a genuinely broken quad looks like, they are all kept and the
  pathological rule applies to the final curve.
- **The cruise fallback.** If no window reaches the nominal excitation, the whole
  pass reruns at half threshold. The closed loop is roughly linear, so moderate
  input still estimates the response, at lower SNR. `quality` reports it.

`quality` is `kept windows / total windows`. The rule engine ignores any axis
under 0.3 and adds a confidence note between 0.3 and 0.5. That gate exists
because a measured log (lr4 session 6, quality 0.07) produced a phantom 163 %
overshoot out of pure noise. The chart and the share codec honour the same
threshold (`MIN_STEP_QUALITY`, exported by `step.ts`): gated axes render dimmed
and dashed instead of posing as a real response.

Metrics derived from the averaged curve:

- `settleValue`: mean over 200 to 500 ms;
- `peakValue`: maximum of the curve;
- `overshootPct`: `(peak / settle - 1) * 100`, null when not positive;
- `riseTimeMs`: 10 % to 90 % of the settle value, linearly interpolated
  crossings.

## Yoyo

`analyzeYoyo(fd): YoyoMetrics`, ported from `analyze_pico.py`.

Yoyo is a low frequency thrust oscillation: throttle steady, altitude bouncing.
The metric compares how much the collective thrust moves against how much the
stick moves, over the flying samples only (throttle above 1100 us, all four
motor values sane), and needs more than 200 such samples to be applicable:

```
ratio = std(mean of the 4 raw motor outputs) / std(throttle stick)
```

Peaks come from a direct DFT of the mean centred thrust, downsampled to about
100 Hz, evaluated from 0.5 to 20 Hz in 0.25 Hz steps, top 5 returned.

**This ratio compares different units** (motor steps against stick
microseconds), so a healthy proportional response already sits around 1.8 to
2.0. Measured across the fleet: 1.47 to 1.98 on flights with no confirmed yoyo.
Only the Pico profile has field calibration (real yoyo reported at about 1.5),
which is why its threshold is 1.3 and the finding is a warning there and an
info everywhere else. Spectral discrimination would be the real fix. See
[limitations.md](limitations.md).

Note that `YoyoMetrics.verdict` uses a fixed internal threshold of 1.3, while
the rule engine uses the profile threshold `yoyoRatioWarn`. The report only
shows the rule.

## Prop wash

`analyzePropwash(fd): PropwashMetrics`.

**Descent detection**, two strategies:

- with a barometer: smoothed vertical speed below -2 m/s, the derivative taken
  over a centred 0.5 s window;
- without: throttle drops under 1200 us while it exceeded 1400 us within the
  previous second, computed with a monotonic deque in O(n). The log only exists
  while armed, so "still flying" needs no extra check.

Contiguous descent ranges less than 0.5 s apart are merged into one event.
No descent at all gives `applicable: false`, which produces an informational
finding saying the flight never tested prop wash rather than a false all clear.

**Severity** per event is the RMS of the low passed roll and pitch tracking
error during the event, roll and pitch samples pooled:

```
severity = sqrt( sum(errRoll^2 + errPitch^2) / (2 * sampleCount) )
```

The error is low passed at about 40 Hz with a moving average, because prop wash
is a low frequency loss of authority and high frequency gyro noise would
pollute the measurement. Frames with aberrant gyro or setpoint contribute zero.

Events are sorted worst first and the top 10 are returned, plus
`worstSeverity` and `avgSeverity` over all events, not just the returned ten.

## Timeline

`analyzeTimeline(fd): TimelineMetrics`. Buckets the log into 3 second slices and
labels each one:

| State | Condition |
| --- | --- |
| `idle` | mean stick under 1080 us |
| `flight` | mean collective thrust above 5 % of the motor range |
| `low` | otherwise |

Each segment carries mean stick, mean thrust percentage and mean vbat.
`flightTimeS` is the total duration of `flight` segments, which is what the
"flight time" tile shows: time actually in the air, not log length.

Only frames where all four motor values are sane contribute to the thrust
average.

## GPS and failsafe

`analyzeGps` reports availability, min and max satellite count, and maximum
speed in m/s.

`analyzeFailsafe` counts the values of `failsafePhase` in slow frames.
`triggered` is true when any non benign phase was recorded, where benign is
`{'0', '', '?', 'IDLE'}`. Values outside the Betaflight enum range 0 to 7 are
rejected as corrupt slow frames, since `4294967294` is `-2` read as unsigned and
would otherwise raise a critical failsafe finding on a perfectly normal flight.

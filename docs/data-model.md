# Data model

Every shared contract lives in [`src/lib/types.ts`](../src/lib/types.ts). This
page is that file, annotated.

## Units, once and for all

`FlightData` normalises what the decoder hands over. After the parser, units
never change again:

| Quantity | Unit | Note |
| --- | --- | --- |
| time | seconds | starts at ~0, monotonic, rebuilt (see [parser.md](parser.md)) |
| gyro, gyroUnfilt, setpoint | deg/s | |
| throttle | microseconds | `rcCommand[3]`, roughly 1000 to 2000 |
| vbat | volts | decoder gives centivolts, scaled by 0.01 |
| amperage | amps | decoder gives centiamps, scaled by 0.01 |
| baroAlt | metres | decoder gives centimetres, scaled by 0.01 |
| GPS speed | m/s | decoder gives cm/s, divided by 100 |
| motor | raw | scale depends on `meta.motorOutputLow` / `motorOutputHigh` |
| eRPM | raw | hundreds of eRPM, see the conversion below |

Motor and eRPM stay raw on purpose. A motor value only means something relative
to the `motorOutput` header of that session, and eRPM only converts to a
frequency once you know the motor pole count, which comes from the drone
profile, not from the log:

```
mechanical Hz = (eRPM_raw * 100) / (poles / 2) / 60
motor %       = (raw - motorOutputLow) / (motorOutputHigh - motorOutputLow) * 100
```

## Parsing layer

### `SessionMeta`

```ts
interface SessionMeta {
  index: number;              // 0 based index of the session inside the file
  fileName: string;
  craftName?: string;         // drives profile selection
  boardInfo?: string;
  firmware: string;           // original string, before the version spoof
  debugMode?: string;
  fieldNames: string[];       // main frame field names, in decoder order
  sampleRateHz: number;       // measured, median of dt
  durationS: number;
  frameCount: number;
  motorOutputLow: number;     // motorOutput header, default 48
  motorOutputHigh: number;    // default 2047
  headers: Record<string, string>;  // every "H key:value" line
  timeAnomalies?: number;     // frames whose dt was invalid and got rebuilt
}
```

`headers` is the full Betaflight configuration snapshot that the firmware
writes at the top of every session. It is the sole input of the config lint,
which is why the `.bbl` alone is enough.

### `FlightData`

```ts
interface FlightData {
  meta: SessionMeta;
  time: Float64Array;              // seconds
  gyro: F32x3;                     // filtered, deg/s
  gyroUnfilt: F32x3 | null;        // deg/s, present only if logged
  setpoint: F32x3;                 // deg/s
  throttle: Float32Array;          // rcCommand[3], microseconds
  motor: Float32Array[];           // raw, one channel per motor (4 to 8, X8 = 8)
  erpm: Float32Array[] | null;     // raw, hundreds of eRPM, same indices as motor
  vbat: Float32Array | null;       // volts
  amperage: Float32Array | null;   // amps
  baroAlt: Float32Array | null;    // metres
  axisP: F32x3 | null;
  axisI: F32x3 | null;
  axisD: [Float32Array | null, Float32Array | null, Float32Array | null] | null;
  axisF: F32x3 | null;
  gps: { time: Float64Array; numSat: Float32Array; speedMps: Float32Array } | null;
  failsafePhaseCounts: Record<string, number>;
}
```

`F32x3` is `[Float32Array, Float32Array, Float32Array]` indexed by axis, and
`Axis` is `0 | 1 | 2` with `AXIS_NAMES = ['Roll', 'Pitch', 'Yaw']`.

`axisD` is a triple of nullables rather than an `F32x3 | null` because
Betaflight does not log a D term on yaw unless `d_yaw` is non zero, so
`axisD[2]` can be `null` while roll and pitch are present.

Only four fields are mandatory: `gyroADC`, `setpoint`, `motor`, `rcCommand[3]`.
Missing any of them throws and the session is skipped. Everything else degrades:
no `gyroUnfilt` means no filter analysis and the spectrum falls back to filtered
gyro, no `vbat` means no battery metrics or rules, no `eRPM` means no desync
detection and no motor attribution of the dominant spectral peak.

### `ParsedFile` and `SkippedSession`

```ts
interface SkippedSession { index: number; fileName: string; sizeBytes: number; error: string }
interface ParsedFile     { fileName: string; sessions: FlightData[]; skipped: SkippedSession[] }
```

A skipped session is not an error, it is a reported outcome. The UI lists it
with its size and reason under the file header.

## Metrics layer

`SessionAnalysis` is the union of the 12 metric modules. Nullable members mean
"not computable on this log", never "zero":

```ts
interface SessionAnalysis {
  meta: SessionMeta;
  power: PowerMetrics | null;          // null without vbat
  motors: MotorMetrics;
  noise: NoiseMetrics;
  spectrum: SpectrumMetrics | null;    // null under 2048 samples
  tracking: TrackingMetrics;
  step: StepResponseMetrics | null;    // null under 20 s of log
  yoyo: YoyoMetrics | null;
  propwash: PropwashMetrics | null;
  filters: FilterMetrics;              // .available false without gyroUnfilt
  timeline: TimelineMetrics;
  gps: GpsMetrics;
  failsafe: { phases: Record<string, number>; triggered: boolean };
}
```

Field by field semantics are in [analysis.md](analysis.md). The shapes:

| Type | Key fields |
| --- | --- |
| `PowerMetrics` | `cells`, `vbatMax/Min`, `perCellMax/Min`, `sagV`, `ampAvg/Max`, `mahEstimate` |
| `MotorMetrics` | `avgPct`, `perMotorAvgPct[4]`, `imbalancePctPts`, `saturationPct`, `desyncZeros[4]`, `erpmAvailable` |
| `NoiseMetrics` | `axes[3]` of `{ unfiltRms, filtRms, ratio, gyroPeak }` |
| `SpectrumMetrics` | `source`, `axes[3]` of `AxisSpectrum`, `motorFundamentalHz`, `perMotorHz[4]`, `dominantPeak`, `motorPolesAssumed` |
| `AxisSpectrum` | `bands[]`, `dominantBand`, `peaks[]` (top 5), `freqs`/`mags` for the chart |
| `TrackingMetrics` | `axes[3]` of `{ meanAbsErr, maxErr, setpointMax }` |
| `StepResponseMetrics` | `axes[3]` of `AxisStepResponse \| null` |
| `AxisStepResponse` | `t`, `y`, `riseTimeMs`, `peakValue`, `overshootPct`, `settleValue`, `quality`, `ms`, `msFreqHz`, `mtDb`, `mtFreqHz`, `msBandTopHz` |
| `YoyoMetrics` | `applicable`, `ratio`, `verdict`, `peaks[]` |
| `PropwashMetrics` | `applicable`, `events[]`, `worstSeverity`, `avgSeverity` |
| `FilterMetrics` | `available`, `axes[3]` of `{ attenuationDb[], residualHfRms }` |
| `TimelineMetrics` | `segments[]` of 3 s slices, `flightTimeS` |
| `GpsMetrics` | `available`, `numSatMax/Min`, `speedMaxMps` |

`AxisSpectrum.freqs` and `.mags` are the chart ready arrays: truncated to 1 kHz
and downsampled to at most 512 points, so a report stays light even with a
dozen sessions.

## Verdict layer

```ts
type Severity = 'ok' | 'info' | 'warn' | 'crit';

type FindingCategory =
  | 'vibrations' | 'filtres' | 'pid' | 'moteurs'
  | 'batterie' | 'config' | 'gps' | 'securite' | 'log';

interface Finding {
  id: string;              // stable slug, e.g. "noise-chassis-resonance"
  severity: Severity;
  category: FindingCategory;
  title: string;           // short, already localised
  detail: string;          // the problem and its likely cause
  evidence: string;        // the numbers that justify the verdict
  fix?: {
    text: string;          // recommended action
    cli?: string[];        // lines to paste, never including `save`
  };
}
```

Category slugs are French because they predate the translation layer. They are
internal keys, mapped to display names through `dict.ui.categories`, and
renaming them would break the golden files and any user bookmark of a rule id.

`id` is the contract with the outside world. It appears as `data-rule` on every
finding card in the DOM, and tests refer to it. Once shipped, an id is never
renamed.

## Report layer

```ts
interface SessionReport { analysis: SessionAnalysis; profile: DroneProfile; findings: Finding[] }
interface FileReport    { fileName: string; sessionReports: SessionReport[]; skipped: SkippedSession[] }
interface Report        { files: FileReport[]; shared?: { trimmed: boolean } }
```

Config findings are merged into each session's `findings` by
`buildSessionReport`, so a report reads as one list per session. `shared` is set
only on a report rebuilt from a share link.

## Profiles

```ts
interface DroneProfile {
  id: 'pico' | 'lr4' | 'chimera7' | 'generic';
  craftMatch: RegExp;        // matched against the craft name, case insensitive
  motorPoles: number;        // eRPM to Hz
  expectedCells: number | null;
  thresholds: ProfileThresholds;
}
```

`ProfileThresholds` has 17 members, each documented inline in `types.ts` and
tabulated in [profiles.md](profiles.md). The display label and the notes shown
under the gauge are not in the profile, they live in
`dict.rules.profiles[id].{ label, notes }`, so a profile stays pure data.

## Betaflight config

```ts
interface CliConfig {
  values: Record<string, string>;   // CLI name -> value, rebuilt from the log headers
}
```

Built by `configFromHeaders`, the only source. The raw feature bitmask is
skipped: decoding it would be work for no rule that needs it. See
[config-lint.md](config-lint.md).

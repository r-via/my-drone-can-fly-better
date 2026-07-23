# My Drone Can Fly Better

**Your flight, decoded.** Drop a Betaflight blackbox log in the browser and get
back numbered verdicts and ready-to-paste CLI commands: vibrations, filters,
PID, motors, battery, GPS, safety.

Nothing is uploaded. The `.bbl` is decoded, analysed and judged inside the tab,
by DSP (FFT, Welch, Wiener deconvolution) and a deterministic rule engine. No
model, no inference, no server round trip: every verdict comes from a threshold
comparison you can read in `src/lib/rules/` and cites the numbers it fired on.

Live: <https://mydronecanflybetter.wooplib.com>

![Flight report header: a 76/100 gauge, the detected craft and drone profile, the
score breakdown per category, then metric tiles for session duration, sample
rate, battery, max current, motor saturation and flight time, above a row of
per-category status chips.](docs/screenshots/report-warn.png)

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # static export to out/
npm test           # 257 tests, including goldens vs the reference Python scripts
```

Node 20 or newer (Next 15 and the WASM parser both need it).

The "share this log" opt-in at the bottom of a report calls a Netlify Edge
Function (`netlify/edge-functions/submit-log.ts`), which `next dev` alone does
not run. Same for the OG share preview (`netlify/functions/share-preview.ts`).
To exercise them locally, use the
[Netlify CLI](https://docs.netlify.com/cli/get-started/):

```bash
netlify dev        # proxies next dev and runs the functions locally
```

### Command line

The exact same pipeline, in a terminal, without a browser:

```bash
npm run analyze -- flight.bbl                       # single log
npm run analyze -- log1.bbl log2.bbl                # several at once
npm run analyze -- flight.bbl --lang fr             # en | fr | es | de | zh
```

Without `--lang`, the CLI reads `LC_ALL` / `LC_MESSAGES` / `LANG` / `LANGUAGE`
and falls back to English.

There is also a raw decode probe, useful when a log refuses to parse:

```bash
npx tsx scripts/smoke.mjs flight.bbl   # sessions, fields, sample rate, headers
```

---

## How it works

```
.bbl bytes
  -> src/lib/bbl/parse.ts     decode via blackbox-log (Rust -> WASM) into FlightData
  -> src/lib/analysis/*       metrics: power, motors, noise, spectrum, tracking,
                              step response, yoyo, prop wash, filters, timeline, GPS
  -> src/lib/rules/profiles   pick the drone profile from the craft name
  -> src/lib/rules/engine.ts  thresholds -> Finding[] (id, severity, evidence, fix)
  -> src/lib/cli/config.ts    log headers -> config lint -> Finding[]
  -> src/lib/report.ts        one Report, sorted worst first
```

Everything after the file read happens in a Web Worker (`src/worker/`), so a
large multi-session log never freezes the UI. The report screen renders the
metrics, three SVG charts (gyro spectrum, step response, flight timeline), the
findings, and a copy-paste CLI block.

### Units and contracts

`FlightData` normalises what the parser hands over: time in seconds, gyro and
setpoint in deg/s, vbat in volts, current in amps, altitude in metres. Motor
and eRPM values stay raw, because their scale depends on headers carried in
`meta` (`motorOutputLow` / `motorOutputHigh`, motor poles from the profile).
All types live in `src/lib/types.ts`.

### Signal processing

Zero DSP dependency, `src/lib/dsp/dsp.ts` is 260 lines: radix-2 FFT, Welch
periodogram, band RMS, peak picking, all matching numpy conventions
(population std, linear-interpolation percentiles, symmetric Hann window) so
the outputs stay comparable to the Python reference scripts.

- **Spectrum**: Welch on unfiltered gyro when the log has it, otherwise on
  filtered gyro. Bands are prop wash / piloting (<40 Hz), frame resonance
  (40-120 Hz), motor range (120-350 Hz), harmonics (>350 Hz). The dominant peak
  is attributed to the nearest motor through eRPM, which is what turns "there
  is a peak at 137 Hz" into "motor 3 is the one shaking".
- **Step response**: Wiener deconvolution of setpoint against gyro
  ([Plasmatree PID-Analyzer](https://github.com/Plasmatree/PID-Analyzer)
  method), 2 s Hann windows with 50 % overlap. No normalisation, so a settle
  value near 1 genuinely means the PID reaches its setpoint. A `quality` score
  reports how much of the log had enough stick excitation to be usable; axes
  below the reliability gate are skipped by the rules and drawn dimmed and
  dashed on the chart.
- **Filter attenuation**: unfiltered against filtered, per band, in dB. Weak
  attenuation in the motor range and leftover high-frequency content each get
  their own rule.

---

## What it checks

Findings carry a stable `id`, a severity (`ok` / `info` / `warn` / `crit`), a
category, the numbers behind the call, and often a CLI fix.

![Two finding cards. A warning under Filters, "Weak filtering in the motor
range", explains that the 120-350 Hz band is only attenuated by 13.6 dB on roll
and suggests checking the RPM filter. An info card under Vibrations, "Noise peak
at the fundamental of M4", points at that motor or its prop. Each card has a
collapsible "the numbers behind this verdict" section and a FIX
block.](docs/screenshots/findings.png)

| Category | Rules |
| --- | --- |
| Vibrations | `noise-mech-high`, `chassis-resonance`, `motor-noise-peak` |
| Filters | `noise-filtered-leak`, `filters-weak`, `filters-residual-hf` |
| PID | `tracking-poor`, `step-overshoot`, `step-slow`, `step-settle-off`, `yoyo-detected`, `propwash-severe` |
| Motors | `motors-saturation`, `motors-imbalance`, `motors-desync` |
| Battery | `battery-sag`, `battery-empty`, `battery-cells-unexpected` |
| GPS / safety / log | `gps-low-sats`, `failsafe-triggered`, `log-quality`, `propwash-untested`, `all-good` |

Every rule is documented one by one, with its condition and its threshold
source, in [`docs/rules.md`](docs/rules.md).

The config lint runs on the configuration snapshot the blackbox writes into its
own headers, so the log alone is enough: `rpm-filter-off-bidir`, `no-bidir`,
`no-notch-no-rpm`, `dterm-lpf-low`, `gyro-lpf-low`, `ff-zero`, `antigravity-off`,
`motor-limit`, `vbat-warning`. There is nothing to paste: those headers carry
every setting the rules read, they reflect the profile that was actually active
during the flight, and they cannot be out of date with respect to it.

### Flight score

The report opens on a score out of 100: 100 minus 25 per critical finding, 12
per warning, 4 per info, floored at 0, with the per-category breakdown shown
next to the gauge. It is a rendering of the findings, not an extra rule, and it
is deliberately traceable rather than clever.

### Drone profiles

Thresholds are per machine, picked automatically from the craft name in the log
headers (`src/lib/rules/profiles.ts`):

| Profile | Craft name match | Tuned for |
| --- | --- | --- |
| `pico` | `pavo pico` | ducted 2S whoop: high raw noise and prop wash tolerated, yoyo caught early |
| `lr4` | `lr4` | long range 4S: strict tracking and sag, rear-heavy CG tolerated |
| `chimera7` | `chimera` / `shimera` | 7 inch 6S: strict on raw vibration (jello), slower rise time accepted |
| `generic` | anything else | median values for a healthy 5 inch freestyle |

Adding a drone is one `DroneProfile` entry (craft-name regex, motor poles, cell
count, threshold overrides). Its display label and notes live in the
dictionaries under `dict.rules.profiles.<id>`, not in the profile itself.

Adding a rule is one pure function in `src/lib/rules/engine.ts` that reads a
`SessionAnalysis` and returns a `Finding`: stable id, numeric evidence,
optional CLI fix. Rules never write their own prose, all user-facing strings
come from the dictionary.

---

## Internationalisation

Five locales: English, French, Spanish, German, Chinese. The French directory
`src/lib/i18n/fr/` (`ui`, `rules`, `lint`, `system`) is the reference shape;
every other locale is a single `const xx: Dict = {...}` file, so `tsc` fails if
a translation is missing a key. Locale selection is localStorage
(`mdcfb.locale`), then `navigator.language`, then English. The worker receives
the locale and generates the findings in that language, which is why switching
languages re-runs the analysis on the files still selected.

---

## Layout

```
src/app/          Next.js app router, fonts, manifest, icons
src/components/   UI, including charts/ (dependency-free SVG)
src/lib/bbl/      WASM parser adapter
src/lib/dsp/      FFT, Welch, bands, peaks
src/lib/analysis/ metric modules
src/lib/rules/    drone profiles + rule engine
src/lib/cli/      config read from the log headers + config lint
src/lib/i18n/     locale registry and dictionaries
src/worker/       analysis worker
scripts/          Node CLI runner, decode probe, service worker generator
tests/            vitest suites + golden/ reference outputs
netlify/          opt-in log sharing function
docs/             reference documentation, see docs/README.md
```

Full documentation lives in [`docs/`](docs/README.md): architecture, data model,
parser, DSP, every metric, every rule, profiles, i18n, UI, CLI, tests,
deployment and known limitations.

Brand assets and their usage rules are documented in
[`public/brand/README.md`](public/brand/README.md).

---

## Tests

`npm test` runs 257 vitest cases in Node. Several of them compare the
TypeScript pipeline against `tests/golden/*.txt`, captured outputs of the older
Python scripts (`analyze_pico.py`, `analyze_lr4.py`, `analyze_shimera.py`, on
top of the orangebox parser), with tolerances around 2 % on RMS and averages.
That is the safety net: the browser must keep agreeing with the reference
implementation.

Those golden tests read real `.bbl` files by absolute path from the developer
machine (constants at the top of `tests/basic.test.ts` and friends). Clone the
repo elsewhere and they fail on a missing file. The synthetic suites (`dsp`,
`rules`, `step` fixtures, `charts`, `ui-shell`) run anywhere.

---

## Deployment

Static export, no server needed for the analysis itself. `netlify.toml` holds
the whole config: `npm run build`, publish `out/`, functions in
`netlify/functions`.

The server-side pieces are optional. `netlify/edge-functions/submit-log.ts`
sits behind the "help improve the tool" opt-in at the bottom of a report: the
client gzips the raw `.bbl` (native CompressionStream) and streams it in a
single request (edge functions have no 6 MB body cap, unlike synchronous
functions). The file lands in the private `shared-logs` Netlify Blobs store,
and the Discord webhook receives a plain message with a download link served
by `netlify/edge-functions/log-download.ts` (`/api/log/<uuid>` - the
unguessable id is the access control). No chunking, no attachment-size limit.
`DISCORD_WEBHOOK_URL` comes from the environment so the webhook never reaches
the client bundle; without it the endpoint answers `not_configured` and the
rest of the site is unaffected. `netlify/functions/share-preview.ts` serves
the OG preview for `/s` share links (title and description come from the query
string; the report itself stays in the URL fragment, which crawlers never
see). Nothing leaves the browser unless the user explicitly asks for it.

### Offline

The site installs as a PWA and works with no connection. `npm run build` runs
`next build` then `scripts/gen-sw.mjs`, which walks `out/`, freezes the list of
emitted files into `scripts/sw-template.js` and writes `out/sw.js`. The service
worker precaches the whole app on first visit (HTML, JS chunks, CSS, fonts,
icons and the 190 kB WASM decoder), then serves everything cache-first, so a
reload with the network down still decodes logs. The cache is named after a hash
of the build output: a new deploy installs a new cache and drops the old one.

`sw.js` is served with `must-revalidate` (see `netlify.toml`), otherwise a new
build would stay invisible behind the HTTP cache. Registration is skipped in
`next dev`, which does not emit a service worker.

A new build installs in the background and waits. `ServiceWorkerRegister.tsx`
shows a small localised pill when it does: "Reload" makes the waiting worker
take over (`SKIP_WAITING`, then reload on `controllerchange`), "Later" hides it.
Nothing reloads on its own, so an analysis in progress is never interrupted. A
tab left open re-checks for updates when it regains focus, at most once an hour.

---

## Known limitations

- **Parser.** The npm `blackbox-log` wrapper (0.2.2, MIT, unmaintained) refuses
  firmware newer than 4.4, so `parse.ts` rewrites the version string in the
  headers to 4.4.2, at constant length. The frame format is self-describing,
  and the result was cross-checked against orangebox on real logs from three
  drones. A second workaround instantiates a fresh `Parser` per session,
  because a large log detaches the WASM `ArrayBuffer`.
- **Upstream P-frame drift.** The decoder shows a 1 to 3 deg/s drift that
  resets on I-frames, which inflates the 5-40 Hz band, mostly on yaw. Corrupt
  frames (a motor value of 4294967040, for instance) are filtered out by
  explicit sanity limits in the analysis modules.
- **Yoyo metric.** The ratio compares standard deviations in different units
  (motor steps against stick microseconds), so 1.8 to 2.0 is normal response,
  not oscillation. Only the Pico profile trips at 1.3, from field calibration.
  Spectral discrimination would be the real fix.
- **Truncated sessions.** A power cut mid-log leaves a session that cannot be
  decoded. It is reported as skipped, with its size and reason, and the other
  sessions in the file are still analysed.
- **Step response** needs at least 20 s of log and enough stick movement. A
  pure cruise flight retries at half the excitation threshold and reports the
  lower confidence through `quality`; unreliable axes are dimmed on the chart
  and never judged.

---

## Contributing

Rules, drone profiles and translations are the three places where an outside
contribution lands most easily. [CONTRIBUTING.md](CONTRIBUTING.md) covers the
shape of a rule, where thresholds live, how the dictionaries stay complete, and
what the golden tests expect.

---

## License

MIT, see [LICENSE](LICENSE). The vendored decoder
([blackbox-log](https://github.com/blackbox-log/blackbox-log)) is MIT too.

---

## Credits

- [blackbox-log](https://github.com/blackbox-log/blackbox-log) for the Rust to
  WASM decoder.
- [Plasmatree PID-Analyzer](https://github.com/Plasmatree/PID-Analyzer) for the
  step response method.
- [Betaflight](https://betaflight.com), for logging all of this in the first
  place.

If the tool saves you a pack or two: <https://ko-fi.com/rvia>.

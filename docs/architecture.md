# Architecture

## The pipeline

One pass, no branching, no state kept between runs:

```
File (.bbl / .bfl) selected in the browser
  |
  |  page.tsx reads it with File.arrayBuffer()
  v
src/lib/analyze-client.ts        spawns a fresh Worker, transfers the bytes
  |
  v  ---------------- Web Worker boundary ----------------
src/worker/analyze.worker.ts
  |
  +-> src/lib/bbl/parse.ts       WASM decode  -> ParsedFile { sessions, skipped }
  |
  +-> src/lib/report.ts          orchestration, per session:
  |     |
  |     +-> rules/profiles.ts    pickProfile(craftName) -> DroneProfile
  |     +-> analysis/*           12 metric modules      -> SessionAnalysis
  |     +-> rules/engine.ts      thresholds             -> Finding[]
  |     +-> cli/config.ts        log headers            -> Finding[] (config)
  |
  v  postMessage({ type: 'done', report })
src/components/ReportView.tsx    render: score, tiles, 3 SVG charts, findings, CLI block
```

The same `buildReport` runs unchanged in Node for the CLI
([cli.md](cli.md)) and in the test suite. There is no browser-only branch in
the analysis path, which is what makes the goldens meaningful.

## Where each stage runs

| Stage | Thread | Module |
| --- | --- | --- |
| File read (`arrayBuffer`) | main | `src/app/page.tsx` |
| Worker lifecycle | main | `src/lib/analyze-client.ts` |
| WASM instantiation | worker | `src/worker/analyze.worker.ts` |
| Decode | worker | `src/lib/bbl/parse.ts` |
| Metrics, rules, lint | worker | `src/lib/report.ts` and children |
| Rendering | main | `src/components/*` |

Everything after the file read is off the main thread, so a 40 MB multi session
log never freezes the tab.

## Worker protocol

`src/worker/analyze.worker.ts` defines both message types:

```ts
type WorkerRequest = {
  files: Array<{ name: string; bytes: ArrayBuffer }>;
  locale: Locale;
};

type WorkerResponse =
  | { type: 'progress'; step: string }
  | { type: 'done'; report: Report }
  | { type: 'error'; error: string };
```

Three details that are deliberate:

- **The bytes are transferred, not copied.** `analyze-client.ts` copies each
  `Uint8Array` into a standalone `ArrayBuffer` first, because the view handed
  over by `File.arrayBuffer()` can sit on a shared buffer, then passes those
  buffers in the transfer list of `postMessage`.
- **A fresh `Worker` per analysis.** The previous one is terminated rather than
  reused: WASM state starts clean and a run that somehow hangs is killed instead
  of queueing behind the new one.
- **The locale crosses the boundary.** Findings are generated as final strings
  inside the worker, in the requested language. That is why changing language
  with a report on screen re-runs the whole analysis on the still selected
  `File` objects (`page.tsx`, the `useEffect` on `locale`).

The WASM module is fetched relative to the worker chunk URL
(`new URL('../../../blackbox-log.wasm', self.location.href)`), not from the site
root, so the app keeps working when served under a sub path.

## Module map

```
src/
  app/            Next.js app router: layout, page, fonts, manifest, icons, globals.css
  components/     UI. charts/ holds three dependency free SVG components
  lib/
    types.ts      every shared contract, the single source of truth for units
    report.ts     orchestrator: ParsedFile[] -> Report
    analyze-client.ts   React hook wrapping the worker
    bbl/parse.ts  WASM adapter
    dsp/dsp.ts    FFT, Welch, band RMS, peaks, stats (260 lines, zero deps)
    analysis/     basic.ts, spectrum.ts, step.ts, flight.ts
    rules/        profiles.ts (thresholds), engine.ts (verdicts)
    cli/config.ts config read from the log headers + config lint
    i18n/         fr/ is the reference shape, en/es/de/zh are typed against it
  worker/         analyze.worker.ts
scripts/          analyze-node.mjs (CLI), smoke.mjs (decode probe)
tests/            10 vitest suites, golden/ reference outputs
netlify/          submit-log.ts, the only server side code
public/           blackbox-log.wasm, brand assets, PWA icons
```

## Dependency rules

The direction of imports is strictly one way:

```
components  ->  lib/types, lib/i18n
worker      ->  lib/bbl, lib/report, lib/i18n
report      ->  analysis/*, rules/*, cli/config, i18n
analysis/*  ->  dsp, types
dsp         ->  nothing
rules/*     ->  types, i18n
```

`dsp` imports nothing at all, `analysis` never imports `rules`, and `rules`
never imports `analysis` implementations, only the `SessionAnalysis` type. That
is what lets `tests/rules.test.ts` exercise every rule against synthetic
`SessionAnalysis` fixtures with no log file involved.

Runtime dependencies are four: `next`, `react`, `react-dom`, and
`blackbox-log` (the WASM decoder). No chart library, no DSP library, no
date library, no state manager.

## Determinism contract

Given the same bytes and the same locale, the pipeline returns byte identical
findings. This holds because:

- no wall clock, no random, no network in the analysis path;
- the DSP layer follows numpy conventions exactly (population standard
  deviation, linear interpolation percentiles, symmetric Hann window), so the
  outputs stay comparable to the Python reference scripts;
- rules are pure functions of `(SessionAnalysis, DroneProfile, Dict)`;
- findings are sorted by a fixed severity rank, then category, with a stable
  sort, so rule declaration order survives.

The only non deterministic thing in the app is decorative: the confetti burst
in `ScoreGauge` when a session comes out clean.

## Error handling

Failures are localised, never global:

- A file with no blackbox magic header yields a `ParsedFile` with zero sessions
  and one `SkippedSession` explaining why.
- A session that fails to decode (power cut mid log, corrupt headers) is pushed
  to `skipped` with its size and reason. Sibling sessions in the same file are
  still analysed.
- A session shorter than 100 frames is skipped as an arming blip.
- Anything thrown above that level becomes `{ type: 'error' }` and the UI shows
  a single error panel with a retry path.
- `File.arrayBuffer()` rejecting (SD card ejected mid selection) is caught in
  `page.tsx` and mapped to a specific message for `NotReadableError`.

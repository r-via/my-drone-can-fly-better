# Documentation

Reference documentation for **My Drone Can Fly Better**, the browser-only
Betaflight blackbox analyser (`debrief/`, repo `r-via/my-drone-can-fly-better`).

The [top level README](../README.md) is the tour. These pages are the detail:
what every module computes, with which constant, and why that constant has the
value it has.

## Reading order

If you are new to the code, read in this order:

1. [Architecture](architecture.md) - the pipeline end to end, where each stage
   runs, what crosses the worker boundary.
2. [Data model](data-model.md) - every type in `src/lib/types.ts`, with units
   and nullability.
3. [Parser](parser.md) - `.bbl` bytes to `FlightData`, and the three decoder
   workarounds that make it work on modern firmware.
4. [Analysis modules](analysis.md) - the metrics themselves.

## By topic

| Page | Covers |
| --- | --- |
| [architecture.md](architecture.md) | Pipeline, worker, module boundaries, determinism contract |
| [data-model.md](data-model.md) | `FlightData`, `SessionAnalysis`, `Finding`, `Report`, units |
| [parser.md](parser.md) | WASM decoder, session splitting, firmware spoof, time rebuild |
| [dsp.md](dsp.md) | FFT, Welch, band RMS, peak picking, numpy conventions |
| [analysis.md](analysis.md) | Power, motors, noise, spectrum, tracking, step, yoyo, prop wash, filters, timeline, GPS, failsafe |
| [rules.md](rules.md) | The 23 flight rules: condition, threshold, evidence, fix |
| [config-lint.md](config-lint.md) | config reconstruction from the log headers, the 9 config rules |
| [profiles.md](profiles.md) | Drone profiles, threshold table, adding a machine |
| [i18n.md](i18n.md) | Dictionary shape, five locales, detection, adding a language |
| [ui.md](ui.md) | Components, flight score, charts, design tokens, accessibility |
| [cli.md](cli.md) | `npm run analyze`, `scripts/smoke.mjs` |
| [testing.md](testing.md) | The 125 vitest cases, goldens, tolerances |
| [deployment.md](deployment.md) | Static export, Netlify, the sharing function |
| [limitations.md](limitations.md) | What the tool cannot do, and why |

`screenshots/` holds the images the top level README embeds. It is not
documentation, just assets.

## The two invariants

Everything here follows from two rules that are not negotiable:

1. **Nothing leaves the browser.** Parsing, DSP and rules run client side. The
   only outbound request in the whole app is the explicit share opt-in at the
   bottom of a report, and it fires on a click, never before.
2. **No model, no inference.** Every verdict is a numeric comparison against a
   threshold that lives in `src/lib/rules/profiles.ts`, and every verdict cites
   the number it fired on. A rule that cannot state its number does not ship.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the contribution workflow.

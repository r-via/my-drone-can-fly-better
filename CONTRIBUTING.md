# Contributing

Thanks for looking. This project analyses Betaflight blackbox logs entirely in
the browser, and the whole point is that a pilot can trace every verdict back
to a number and a threshold. Contributions are welcome as long as they keep
that property.

The project is MIT licensed. By contributing you agree your changes ship under
the same terms.

## Ground rules

1. **Nothing leaves the browser.** Parsing, DSP and rules run client side. The
   only network call in the app is the explicit "help improve the tool" opt-in,
   and it only fires after the user clicks. No analytics, no telemetry, no
   silent upload.
2. **No AI in the analysis path.** Verdicts come from thresholds, not from a
   model. A rule that cannot state the number it fired on does not belong here.
3. **Dependencies are a cost.** The DSP layer is dependency free on purpose,
   and the parser is the only WASM blob. Bring a new dependency only if you can
   argue why the code you would write instead is worse.
4. **No em dashes** in any user-facing string, comment or commit message. Use a
   plain hyphen, a colon or a full stop.

## Setup

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 257 vitest cases
npx tsc --noEmit   # type check, also enforces translation completeness
```

Node 20 or newer. `netlify dev` if you need to exercise the sharing function.

Fastest loop when you work on the analysis itself, no browser involved:

```bash
npm run analyze -- your-log.bbl
```

## Adding a rule

A rule is a pure function in `src/lib/rules/engine.ts` that reads a
`SessionAnalysis` and returns a `Finding`:

- a stable `id` (slug, never renamed once shipped, it is what tests and users
  refer to);
- a `severity` and a `category`;
- an `evidence` string containing the actual numbers, not an adjective;
- optionally a `fix` with the CLI lines to paste, never including `save`.

Thresholds belong in `ProfileThresholds` (`src/lib/types.ts` and
`src/lib/rules/profiles.ts`), not inline in the rule, so every drone profile
can tune them. A threshold that comes out of thin air is worse than no rule at
all: say in a comment where the value comes from, whether it is field
calibration on real logs or a published reference.

No prose in the engine. Titles, details and fix text live in the dictionaries,
keyed by rule. Add the key to `src/lib/i18n/fr/rules.ts` first, that file is
the reference shape, then to the four translations. `tsc` fails until all five
are complete, which is the intended pressure.

Rules get tested in `tests/rules.test.ts` against synthetic `SessionAnalysis`
fixtures, so no log file is needed: assert that the rule fires when it should,
stays quiet when it should not, and that the boundary behaves.

## Adding a drone profile

One `DroneProfile` entry in `src/lib/rules/profiles.ts`: a craft-name regex, the
motor pole count, the expected cell count, and the threshold overrides that
differ from the generic profile. Keep `generic` last, its regex matches
everything and is the safety net. The label and the notes shown in the report
go in `dict.rules.profiles.<id>` in the five dictionaries.

Overrides need a reason in a comment. "This whoop is ducted, so raw gyro noise
is normally high" is a reason. "Felt better" is not.

## Adding a language

Copy `src/lib/i18n/en.ts` to `src/lib/i18n/<code>.ts`, translate, then register
the locale in `src/lib/i18n/index.ts` (`Locale` type, `LOCALES` list,
`REGISTRY`, and the two detection helpers). The `Dict` type is derived from the
French reference, so a missing or renamed key is a compile error, not a runtime
surprise.

Translate meaning, not words. These strings are read by a pilot in a field with
a dead pack, so keep them short and concrete.

## Tests

`npm test` must pass before you open a pull request, and so must
`npx tsc --noEmit`.

Some suites compare the pipeline against `tests/golden/*.txt`, captured outputs
of the older Python reference scripts. They read real `.bbl` files by absolute
path from the maintainer machine, so they fail on a fresh clone. That is
expected: the synthetic suites (`dsp`, `rules`, `step`, `charts`, `ui-shell`)
are the ones you can run anywhere, and they are where new logic gets covered.

If a change makes the numbers move, say so explicitly in the pull request and
explain which of the two is right. Silently loosening a tolerance to make a
golden pass is the one thing that breaks this project.

## Commits and pull requests

Commit messages are English, imperative, one line that says what changes, with
a body when the why is not obvious. No prefixes, no emoji.

A pull request should state what a pilot sees differently after it lands, and
which logs or fixtures back the claim. If it touches a rule, include the before
and after `evidence` string.

## Reporting a log the parser refuses

Open an issue with the firmware version, the board, and the output of:

```bash
npx tsx scripts/smoke.mjs your-log.bbl
```

Attach the log if you can share it. Decoder problems are almost always a
firmware or header shape nobody has seen yet, and a real file is the only way
to fix them.

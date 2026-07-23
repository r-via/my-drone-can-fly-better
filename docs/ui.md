# User interface

Next.js 15 app router, React 19, Tailwind 4, static export. One route.

## Screens

`src/app/page.tsx` is a state machine over `useAnalyzer()`:

| State | Rendered |
| --- | --- |
| `idle` | hero, three step explainer, `UploadZone`, analyse button |
| `working` or reading | spinner with the live progress step from the worker, plus the privacy note |
| `ready` | `ReportView` |
| `error` | the idle screen with an error panel on top |

`layout.tsx` wraps everything in `LocaleProvider` and `Shell` (header with
GitHub, Discord, Ko-fi and the language switcher, plus the footer). Fonts are
self hosted: Rajdhani for display, Manrope for text, both SIL OFL, loaded with
`next/font/local` so no request leaves the page.

## Component map

```
Shell               header, footer, external links, LanguageSwitcher
UploadZone          drag and drop, file list
ReportView          the report screen
  ScoreGauge        the /100 ring, count up animation, confetti on a clean flight
  MetricTile        one figure with a tone bar (neutral, ok, warn, crit)
  SessionPicker     tablist, shown only when a file has several sessions
  FindingCard       one verdict: badge, title, detail, evidence, fix
  CliExport         the assembled script plus a copy button
  ShareLogToggle    the opt-in share block
  charts/
    SpectrumChart      gyro spectrum, three axes
    StepResponseChart  step response, three axes
    TimelineStrip      flight timeline with vbat overlay
icons.tsx           12 inline SVG icons, no icon library
```

`UploadZone` accepts `.bbl` and `.bfl`, rejects the rest with a visible message,
deduplicates on `name:size`, and lets the user remove a file before analysing.

## The flight score

Computed in `ReportView.computeFlightScore`. It is a rendering of the findings,
not an extra rule:

```
penalty = 25 per crit + 12 per warn + 4 per info
score   = max(0, 100 - total penalty)
```

The per category breakdown, top three, is printed next to the gauge as
`100 - Vibrations -12 - PID -4`, so the number is traceable rather than clever.
The ring colour follows the worst severity in the session, not the score.

`ScoreGauge` animates the count and the arc over 900 ms, and fires a short
canvas confetti burst when the worst severity is `ok`. Both are disabled under
`prefers-reduced-motion`.

## Ordering

`groupFindings` groups by category, sorts findings inside a group by severity
descending, then sorts the groups by their worst severity, ties broken by a
fixed category order:

```
securite, vibrations, filtres, pid, moteurs, batterie, config, gps, log
```

So a critical finding is always at the top of the page, whatever its category.

The category chips above the charts show `securite`, `vibrations`, `filtres`,
`pid`, `moteurs`, `batterie`, `gps`, `log`, dropping `batterie` when the log has
no vbat and `gps` when it has no GPS, so the row never advertises a check that
did not run.

## Charts

Three components under `src/components/charts/`, pure SVG, no chart library, no
hooks. Each takes its labels through a `labels` prop, which is what makes them
testable in Node. Each also exports a pure geometry helper that the tests drive
directly:

| Component | Helper | Notes |
| --- | --- | --- |
| `SpectrumChart` | `buildSpectrumPaths(axes, w, h)` | 0 to 1 kHz, square root Y scale, shaded resonance and motor bands, optional motor fundamental line |
| `StepResponseChart` | `buildStepPaths(axes, w, h)` | 0 to 500 ms, Y from 0 to `max(1.5, peak of reliable axes)`, dashed target at 1.0, tinted overshoot zone; axes under `MIN_STEP_QUALITY` are drawn dimmed and dashed, starred in the legend, and never drive the Y scale |
| `TimelineStrip` | `buildTimelineRects(segments, w)` | state bands (idle, low, flight) with the vbat curve on top |

The square root Y scale on the spectrum is a deliberate compromise: linear
crushes the secondary peaks, which is exactly where frame resonance lives next
to a motor peak, and logarithmic lifts the noise floor until it drowns them.
The square root keeps dominant peaks readable and harmonics visible.

The two curve charts downsample to at most 600 points before drawing. The
spectrum takes the bucket **maximum** rather than the mean, so a narrow peak
survives the reduction; the step response strides evenly and always keeps its
last point. The timeline draws one rectangle per 3 second segment, so it needs
no reduction.

## Design tokens

`src/app/globals.css` defines everything as CSS custom properties, dark by
default, with a light theme under `prefers-color-scheme: light`. Tailwind 4 maps
them through `@theme inline`.

| Group | Tokens |
| --- | --- |
| Surfaces | `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--line`, `--line-strong` |
| Text | `--ink`, `--ink-2`, `--ink-3` |
| Accent | `--accent`, `--accent-glow`, `--amber`, `--cta`, `--cta-ink` |
| Status | `--ok`, `--info`, `--warn`, `--crit` |
| Charts | `--chart-*`, 18 tokens |

Two notes on the accent. It is phosphor green yellow, the classic Betaflight OSD
tint in FPV goggles, and it is never used as a data series colour. And `--cta`
is separate from `--accent` because in the light theme a green dark enough to
carry readable text reads as khaki over a large fill, so the light theme uses
`--ink` for solid buttons and keeps the accent for small elements.

The roll, pitch and yaw trio is validated for colour vision deficiency, adjacent
delta E at least 41 across protanopia, deuteranopia and tritanopia, in both
themes.

The body carries a very faint scanline overlay and a radial accent glow, both
purely decorative and both behind `pointer-events: none`.

## Accessibility

- Status severity is never colour alone: every badge, chip and tile pairs the
  colour with an icon and a text label, and `MetricTile` adds a screen reader
  only tone announcement.
- The loading screen is `role="status"` with `aria-live="polite"`, errors are
  `role="alert"`, the copy confirmation is announced through a visually hidden
  live region.
- The upload zone is a real `<label>` over a real file input, keyboard
  reachable, with `aria-describedby` on the help line.
- `SessionPicker` is a `role="tablist"` with `aria-selected`.
- Every SVG chart carries a title and an `aria-label` describing what it shows.
- `:focus-visible` is styled globally with a 2 px accent outline.
- Both animations respect `prefers-reduced-motion`.

## Formatting

`ReportView.makeFormatters(locale, dict)` centralises number formatting: the
decimal separator is a comma in French and a dot elsewhere, durations render as
`42.0 s` or `3 min 07 s`, sample rates switch to kHz above 1000, and file sizes
use the localised `Mo` / `MB` units.

## The CLI block

`CliExport` collects every `fix.cli` line from the findings of the currently
selected session of every file, plus the standalone config findings,
deduplicates while preserving order, and appends a single `save` at the end.

The block carries two warnings on purpose: check each line before pasting, and
save from the CLI with `save` rather than the GUI save button, because on some
versions the GUI button can wipe the configuration.

## The share opt-in

`ShareLogToggle` sits at the bottom of a report. It is idle until clicked. On
click it posts the raw `.bbl` files plus a small metadata blob (craft names,
locale, file count) to `/.netlify/functions/submit-log`. It refuses locally above 7 MB total to avoid a
pointless round trip against the Discord attachment limit.

Nothing is sent before the click, and the component renders nothing at all when
no file is in memory.

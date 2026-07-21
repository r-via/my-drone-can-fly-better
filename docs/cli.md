# Command line

The same pipeline as the site, in a terminal, no browser. This is the fastest
loop when working on the analysis itself.

## `npm run analyze`

```bash
npm run analyze -- flight.bbl                       # one log
npm run analyze -- log1.bbl log2.bbl log3.bbl       # several
npm run analyze -- flight.bbl --lang fr             # en | fr | es | de | zh
```

The `--` is required: it stops npm from eating the arguments.

Implementation: [`scripts/analyze-node.mjs`](../scripts/analyze-node.mjs), run
through `tsx` so it can import the TypeScript modules directly. It loads
`public/blackbox-log.wasm` from disk, calls `parseFile` per argument, then
`buildReport`, which are the exact same functions the worker calls. No
duplicated logic, so a CLI run and a browser run cannot disagree.

### Language

Without `--lang`, the locale comes from the environment: `LC_ALL`,
`LC_MESSAGES`, `LANG`, then `LANGUAGE`, parsed POSIX style, falling back to
English. `fr_FR.UTF-8` gives French, `C` gives English. See
[i18n.md](i18n.md).

### Output

Per file, then per session:

```
━━━ btfl_016.bbl ━━━
  session 2 ignorée (43 ko) : Session trop courte (61 frames) - probable blip d'armement

▶ session 1 - SHIMERA7PRO [profil Chimera7 Pro 6S] - 214s @ 1999 Hz - Betaflight 2025.12.2
  6S 25.08→21.94 V (sag 1.31 V)  courant max 62.4 A
  ⚠️  [filtres] Filtrage faible dans la plage moteur
      Roll 13.6 / Pitch 18.2 / Yaw 21.4 dB
      → Vérifie que le filtre RPM est actif
  ℹ️  [vibrations] Pic de bruit à la fondamentale de M4
      ...
```

Severity icons are `❌ crit`, `⚠️ warn`, `ℹ️ info`, `✅ ok`. Each finding prints
its evidence, then its fix text, then the CLI lines it suggests, indented.

Skipped sessions are listed first with their size and reason. Config verdicts
are read from the log headers and print inline with the flight verdicts.

The CLI does not print the score out of 100. That number is a rendering choice
of the report screen, not part of the analysis.

## `scripts/smoke.mjs`

A raw decode probe. Use it when a log refuses to parse, or when checking what a
new firmware actually logs:

```bash
npx tsx scripts/smoke.mjs flight.bbl
```

```
===== btfl_016.bbl (18.4 MB, 2140 ms) =====
  s1: SHIMERA7PRO | Betaflight 2025.12.2 | 428000f 214.0s @1999Hz | unfilt=true erpm=true vbat=25.08V baro=true gps=no
      failsafe: {"0":71} | motorRange=158-2047 | debug=GYRO_SCALED
      headers config: pid_roll=45,80,40 gyro_lpf=0 dterm_lpf=75 rpm_filter=3
  s2 IGNORÉE (43821o): Session trop courte (61 frames) - probable blip d'armement
```

It reports which optional fields are present, which is the fastest way to
understand why a report is missing a section: no `gyroUnfilt` means no filter
analysis, no `eRPM` means no motor attribution and no desync detection.

That output is what an issue about a refused log should carry, along with the
firmware version and the board.

## Requirements

Node 20 or newer. No global install: `tsx` is a dev dependency and
`npm run analyze` resolves it locally.

## Where the CLI is used

- Working on a rule or a metric, with no UI in the way.
- Checking a real log against a threshold change before touching the goldens.
- Batch checking a session directory: `npm run analyze -- logs/*.bbl`.

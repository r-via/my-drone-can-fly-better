# Configuration lint

[`src/lib/cli/config.ts`](../src/lib/cli/config.ts) reviews the Betaflight
configuration itself, independently of how the drone flew. It has two input
paths and nine rules.

## Two sources, one shape

```ts
parseCliText(text: string): CliConfig            // source: 'paste'
configFromHeaders(headers: Record<string,string>): CliConfig  // source: 'headers'
```

A pasted `diff all` always wins. When nothing is pasted, the configuration is
reconstructed from the snapshot Betaflight writes into the headers of every
blackbox session, which is why the config lint works from a log alone.

`buildSessionReport` picks the source:

```ts
const config = pasteConfig ?? configFromHeaders(fd.meta.headers);
```

### Parsing a pasted diff

Two line shapes are recognised, everything else (`batch`, `board_name`,
`profile`, `save`, comments, blank lines) is ignored:

```
set <name> = <value>      -> values[name.toLowerCase()] = value   (last one wins)
feature <NAME>            -> features.add(NAME)
feature -<NAME>           -> features.delete(NAME)
```

Feature lines are applied in order, so a `diff all` that enables then disables a
feature ends up correct.

The raw text is kept in `CliConfig.raw`, which is what the share opt in attaches
alongside the `.bbl`.

### Reconstructing from headers

Three passes:

1. **Direct keys.** Any header whose name is already a CLI parameter name,
   matching `^[a-z][a-z0-9_]*$`, is copied as is. A skip list drops the ones
   that are not usable CLI settings: `features` (a raw bitmask), `vbatref`,
   `gyro_scale`, `maxthrottle`, `looptime`, `vbatcellvoltage`.

2. **Composite keys.** Betaflight packs several settings per header line, so
   they get split back out:

   | Header | Becomes |
   | --- | --- |
   | `rollPID:45,80,40` | `p_roll`, `i_roll`, `d_roll` |
   | `pitchPID`, `yawPID` | same, per axis |
   | `d_max:40,44,0` | `d_max_roll`, `d_max_pitch`, `d_max_yaw` |
   | `d_min` | `d_min_roll`, `d_min_pitch`, `d_min_yaw` |
   | `ff_weight` | `f_roll`, `f_pitch`, `f_yaw` |
   | `vbatcellvoltage:330,350,430` | `vbat_min_cell_voltage`, `vbat_warning_cell_voltage`, `vbat_max_cell_voltage` |

3. **Normalisation.** `dshot_bidir` becomes `ON` / `OFF` instead of `1` / `0`,
   and a numeric `motor_pwm_protocol` is mapped through the Betaflight 4.x enum
   (`PWM`, `ONESHOT125`, `ONESHOT42`, `MULTISHOT`, `BRUSHED`, `DSHOT150`,
   `DSHOT300`, `DSHOT600`, `PROSHOT1000`, `DISABLED`) so the evidence string
   reads like the CLI does.

`features` stays empty on this path: decoding the raw bitmask would be work for
no rule that currently needs it.

### Value reading

`parseNum` accepts `ON` / `TRUE` as 1, `OFF` / `FALSE` as 0, takes the first
element of a comma separated list, and returns null for anything unparseable.
That single helper is why the rules do not care which source they are reading.

## The nine rules

`lintConfig(config, profile, analysis, dict) -> Finding[]`, all with category
`config`, sorted most severe first.

| id | Severity | Fires when | CLI fix |
| --- | --- | --- | --- |
| `no-notch-no-rpm` | crit | `dyn_notch_count = 0` **and** `rpm_filter_harmonics = 0` | `set dyn_notch_count = 3`, `set rpm_filter_harmonics = 3` |
| `rpm-filter-off-bidir` | warn | `dshot_bidir = ON` but `rpm_filter_harmonics = 0` | `set rpm_filter_harmonics = 3` |
| `dterm-lpf-low` | warn | `dterm_lpf1_static_hz` between 1 and 69 | `set dterm_lpf1_static_hz = 75` |
| `no-bidir` | info | a DSHOT protocol is set but `dshot_bidir` is not on | `set dshot_bidir = ON`, `set rpm_filter_harmonics = 3` |
| `gyro-lpf-low` | info | gyro LPF under 150 Hz while the RPM filter is active | `set <the key found> = 250` |
| `ff-zero` | info | every feedforward key present is 0 | none, text only |
| `antigravity-off` | info | `anti_gravity_gain = 0` | `set anti_gravity_gain = 80` |
| `motor-limit` | info | `motor_output_limit < 100` | none, informational |
| `vbat-warning` | info | warning cell voltage outside 3.2 to 3.6 V | `set vbat_warning_cell_voltage = 350` |

Details worth knowing:

- **`no-notch-no-rpm` is the only critical config rule.** With neither dynamic
  notch nor RPM filtering, nothing adaptive stands between motor noise and the
  D term.
- **`gyro-lpf-low`** looks for `gyro_lpf1_static_hz` first and falls back to the
  older `gyro_lowpass_hz`, and reports whichever key it actually found, so the
  suggested command matches the firmware in front of the user.
- **`ff-zero`** only considers keys that are present. A configuration that never
  mentions feedforward does not trigger it.
- **`vbat-warning`** accepts both units: values above 10 are treated as
  centivolts (`350` means 3.50 V), values below as volts.
- **`motor-limit`** has no fix. A motor output limit is often deliberate, on a
  new build or a bench test, so the rule reports it and stops there.

## What is deliberately not here

The cell count check against the drone profile lives in the flight rule engine
as `battery-cells-unexpected`, not in the lint. Having it in both places
produced two findings for one anomaly in every report.

## Where the findings land

- With at least one usable session: config findings are merged into that
  session's findings by `buildSessionReport` and appear inline with the flight
  verdicts.
- With a pasted diff and no usable session anywhere: they go to
  `Report.configFindings` and render in their own block at the top of the
  report, with the source labelled. This is the "review my config, I have no log
  to give you" path.

## Testing

`tests/cli.test.ts` covers both parsers and every rule: the last `set` winning,
feature add and remove ordering, the composite header splits, the enum mapping,
the centivolt handling, and each rule firing and staying quiet.

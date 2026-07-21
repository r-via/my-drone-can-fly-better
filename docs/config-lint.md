# Configuration lint

[`src/lib/cli/config.ts`](../src/lib/cli/config.ts) reviews the Betaflight
configuration itself, independently of how the drone flew. One input path, nine
rules.

## One source: the log headers

```ts
configFromHeaders(headers: Record<string,string>): CliConfig
```

Betaflight writes a snapshot of its configuration into the headers of every
blackbox session, so the `.bbl` alone is enough:

```ts
const config = configFromHeaders(fd.meta.headers);
```

### Why not a pasted `diff all`

The site used to accept a pasted `diff all` that overrode the headers. It was
removed, because the headers beat it on all three counts that matter:

- **Coverage.** Every key the nine rules read is present in the headers. A
  regression test in [`tests/cli.test.ts`](../tests/cli.test.ts) extracts the
  key list straight from the lint source and asserts the headers of a real log
  carry all of them, so a new rule reading a header-less key fails the build
  rather than going quiet.
- **The right profile.** The headers hold the PID and rate profile that was
  actually active during the flight. A `diff all` holds all of them at once,
  with no way to tell which one flew.
- **The right moment.** The headers were written by the flight itself. A diff is
  pasted afterwards, possibly after the very change being investigated.

A plain `diff` (rather than `diff all`) made it worse still: it only lists
non-default values, so any rule keyed on an absent value silently stopped
firing.

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

The `features` bitmask is skipped: decoding it would be work for no rule that
currently needs it.

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

Config findings are merged into the session's findings by `buildSessionReport`
and appear inline with the flight verdicts. There is no separate config block:
no session means no headers, hence no configuration to review.

## Testing

`tests/cli.test.ts` covers the header reconstruction and every rule: the
composite header splits, the enum mapping, the centivolt handling, each rule
firing and staying quiet, and the coverage guard described above.

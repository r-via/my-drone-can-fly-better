# Drone profiles

A profile is the set of thresholds the rule engine compares against. Selection
is automatic, from the craft name in the log headers, in
[`src/lib/rules/profiles.ts`](../src/lib/rules/profiles.ts).

```ts
pickProfile(craftName: string | undefined): DroneProfile
```

`PROFILES` is scanned in order and the first `craftMatch` that tests true wins.
`generic` is last and its regex is `/./`, so it catches everything. No craft
name at all also yields `generic`.

| Profile | Craft regex | Real craft name | Poles | Cells |
| --- | --- | --- | --- | --- |
| `pico` | `/pavo\s*pico/i` | `Pavo Pico` | 12 (1102) | 2 |
| `lr4` | `/lr4/i` | `LR4-O4PRO` | 12 (1404) | 4 |
| `chimera7` | `/[cs]himera/i` | `SHIMERA7PRO` | 14 (2806.5) | 6 |
| `generic` | `/./` | anything else | 14 | none |

The `[cs]himera` alternation is not a typo: the craft is a Chimera7 Pro whose
craft name is misspelled `SHIMERA7PRO` in the firmware, and both spellings must
match.

Pole count feeds the eRPM to Hz conversion used for motor peak attribution
([analysis.md](analysis.md#spectrum)). Cell count feeds
`battery-cells-unexpected`; `null` disables that rule.

## Threshold table

Bold values are overrides, plain values are inherited from generic.

| Threshold | generic | pico | lr4 | chimera7 | Unit |
| --- | --- | --- | --- | --- | --- |
| `filtNoiseWarn` | 3 | **4** | 3 | 3 | deg/s RMS |
| `filtNoiseCrit` | 8 | **10** | 8 | 8 | deg/s RMS |
| `unfiltNoiseWarn` | 25 | **40** | 25 | **20** | deg/s RMS |
| `unfiltNoiseCrit` | 60 | **90** | 60 | **45** | deg/s RMS |
| `trackingWarn` | 8 | **10** | **6** | 8 | deg/s |
| `trackingCrit` | 20 | **25** | **15** | 20 | deg/s |
| `saturationWarn` | 3 | 3 | 3 | 3 | % of samples |
| `saturationCrit` | 10 | 10 | 10 | 10 | % of samples |
| `imbalanceWarn` | 12 | 12 | **15** | 12 | percentage points |
| `sagPerCellWarn` | 0.4 | **0.45** | **0.35** | 0.4 | V |
| `sagPerCellCrit` | 0.6 | **0.65** | **0.55** | 0.6 | V |
| `perCellMinCrit` | 3.3 | 3.3 | 3.3 | 3.3 | V |
| `overshootWarn` | 25 | **30** | **20** | 25 | % |
| `riseTimeSlowMs` | 60 | **70** | 60 | **80** | ms |
| `yoyoRatioWarn` | 2.2 | **1.3** | 2.2 | 2.2 | ratio |
| `propwashWarn` | 15 | **20** | 15 | 15 | deg/s RMS |
| `residualHfWarn` | 150 | **250** | 150 | **90** | Welch amplitude |

## Why each override exists

Every override carries a reason in the source. Summarised:

**Pico**, a 2S ducted whoop.
The ducts blow air back into the props, so raw gyro noise is structurally high
and tolerating 40 deg/s instead of 25 is realistic, not lax. Permanent duct
turbulence makes perfect tracking impossible, hence 10 instead of 8. Small 2S
cells sag more at equal current. The airframe is featherweight, so a small
overshoot costs nothing, while 1102 motors have limited authority and rise a
little slower. Prop wash is inherent to ducted cinewhoops. And the yoyo
threshold is the one number here with real field calibration: this machine had a
confirmed yoyo problem, reported at a ratio of about 1.5, so it trips at 1.3
while every other profile stays at 2.2.

**LR4**, a 4S long range build.
Clean tracking means fewer corrections means more range, so tracking is stricter
at 6 and 15. Endurance depends on the pack, so sag is watched more closely.
Smooth cruising flight should not bounce at the end of a movement, hence
overshoot at 20. The CG sits rearward with a GPS and a long range pack, so a
front to rear motor asymmetry is expected and imbalance tolerance goes up to 15
points.

**Chimera7**, a 6S 7 inch.
Long arms mean jello appears easily, so raw vibration is caught early at 20 and
45. Big 2806.5 motors are sensitive to heat, and healthy logs on this machine
measure 20 to 40 residual HF amplitude, so the threshold sits at 90 rather than
150. A 7 inch has real rotational inertia and rises naturally slower than a
5 inch, hence 80 ms.

**Generic** is the median of Betaflight practice on a healthy 5 inch freestyle
build. The `residualHfWarn` value of 150 comes from measuring 20 to 130 across
the fleet and taking roughly twice the worst healthy reading.

Two thresholds carry a warning of their own:

- `yoyoRatioWarn` compares standard deviations in different units, so 1.8 to 2.0
  is a normal proportional response, not oscillation. Only the Pico value is
  field calibrated. See [limitations.md](limitations.md).
- `residualHfWarn` is expressed in the amplitude units of this project's Welch
  implementation ([dsp.md](dsp.md)), not in a physical unit. It is only
  comparable to itself.

## Adding a machine

One entry in `PROFILES`, before `generic`:

```ts
const MY_QUAD: DroneProfile = {
  id: 'myquad',
  craftMatch: /my\s*quad/i,   // matched against the craft name, case insensitive
  motorPoles: 14,
  expectedCells: 6,
  thresholds: {
    ...GENERIC_THRESHOLDS,
    unfiltNoiseWarn: 20,      // 7 inch arms, jello shows up early
  },
};
```

Then:

1. add the id to the `DroneProfileId` union in `src/lib/types.ts`;
2. add `label` and `notes` under `dict.rules.profiles.myquad` in the five
   dictionaries. `tsc` fails until all five are done, which is the intended
   pressure;
3. keep `generic` last.

Every override needs a reason in a comment. "This whoop is ducted, so raw gyro
noise is normally high" is a reason. "Felt better" is not. If the number comes
from measuring your own logs, say which ones and what they read.

## Display strings

A `DroneProfile` carries no user facing text. The label under the score gauge
and the bullet notes about the machine's quirks come from
`dict.rules.profiles[id]`, so translating a profile never touches the thresholds
and tuning a threshold never touches the translations.

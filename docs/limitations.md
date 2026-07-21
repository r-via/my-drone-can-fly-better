# Known limitations

What the tool cannot do, why, and what would fix it. Everything here is
deliberate and documented in the source at the point it bites.

## Parser

**The npm wrapper is stuck at firmware 4.4.**
`blackbox-log` 0.2.2 (MIT, unmaintained) refuses any Betaflight version newer
than 4.4, so `parse.ts` rewrites the version string in the headers to `4.4.2`,
padded to constant length. This is safe because the frame format is self
describing, and the result was cross checked against orangebox on real logs from
three drones. The real firmware is preserved in `meta.firmware` and displayed.
The proper fix is upstream, either a maintained wrapper or a direct binding to
the Rust crate.

**A large log detaches the WASM ArrayBuffer.**
Reusing one `Parser` across sessions crashes on the second one, so a fresh
instance is created per session. It costs a few milliseconds and removes the
failure entirely.

**Upstream P frame drift.**
The decoder shows a 1 to 3 deg/s drift that resets on I frames. It inflates the
5 to 40 Hz band, mostly on yaw. Nothing in this repository can fix it; the
analysis absorbs it by treating that band as piloting and prop wash energy
rather than as a diagnostic.

**Corrupt frames get through.**
Values like `4294967040` (which is `-256` read as unsigned 32 bit) reach the
analysis layer, where orangebox used to drop them. Every module filters them
with explicit sanity limits: 5000 deg/s on gyro and setpoint, `motorOutputHigh
+ 8` on motors, the 0 to 7 enum range on failsafe phases. A single unfiltered
one is enough to destroy a spectrum or raise a false critical failsafe.

**Truncated sessions cannot be recovered.**
A power cut mid log leaves a session the decoder cannot read. It is reported as
skipped with its size and reason, and the other sessions in the file are still
analysed.

## Metrics

**The yoyo ratio compares different units.**
`std(mean motor output)` against `std(throttle stick)`, that is motor steps
against stick microseconds. A healthy proportional response already lands
around 1.8 to 2.0, and the fleet measures 1.47 to 1.98 on flights with no yoyo.
Only the Pico profile has field calibration, from a confirmed real yoyo at about
1.5, which is why it trips at 1.3 and the finding is a warning there and an info
everywhere else. The real fix is spectral discrimination: a genuine yoyo has a
narrow peak in the thrust spectrum, a proportional response does not. The peaks
are already computed and reported in the evidence, the rule just does not use
them yet.

**The step response needs excitation.**
At least 20 seconds of log, and enough stick movement. A pure cruise flight
retries at half the excitation threshold and reports lower confidence through
`quality`. Axes under quality 0.3 are ignored by the rules entirely, because a
measured log at 0.07 produced a phantom 163 % overshoot out of deconvolution
noise.

**Welch amplitudes are not a physical unit.**
`residualHfWarn` and the band RMS values are expressed in the amplitude scale of
this project's Welch implementation. They are internally consistent and
comparable across logs, thanks to the window energy anchor, but they are not a
power spectral density and cannot be compared to a value from another tool.

**Prop wash detection without a barometer is a heuristic.**
Throttle dropping under 1200 us after having exceeded 1400 us within the
previous second. It catches the obvious descents and misses gentle ones. With a
barometer the vertical speed threshold of -2 m/s is used instead, which is much
more reliable.

**A flight with no descent reports nothing about prop wash.**
That is why `propwash-untested` exists: an informational finding saying the
flight never exercised it, rather than a silent all clear.

**Sample rate below about 900 Hz limits everything.**
Usable analysis bandwidth is half the sample rate. Bands sitting above Nyquist
are omitted rather than reported as zero, and `log-quality` says so with a CLI
fix.

**Sessions under 2048 samples get no spectrum and no filter analysis.**
That is one Welch window. Below it, the averaged magnitudes stop being
comparable to thresholds calibrated at 4096.

## Rules

**Thresholds are calibrated on a small fleet.**
Three drones plus published Betaflight practice. The `generic` profile is a
median of that practice and will be wrong for machines far from a 5 inch
freestyle build. This is why profiles exist, and why adding one is meant to be
easy.

**The score out of 100 is arithmetic, not judgement.**
25 per critical, 12 per warning, 4 per info, floored at 0. Two warnings in
different categories cost the same as two in one category. It is a summary of
the findings, deliberately traceable rather than clever, and the per category
breakdown is printed next to it so nobody has to trust the number.

**No cross session analysis.**
Each session is judged independently. Trends across a pack, or across flights,
are not computed.

**No PID gain recommendations.**
The tool says "overshoot is 31 % on roll, which is above the 25 % threshold" and
points at the P to D balance. It does not compute new gains. That would require
a plant model it does not have.

## Application

**Analysis is single threaded inside one worker.**
Several files are processed sequentially. A very large batch is slow but never
freezes the UI.

**Changing language re-runs the analysis.**
Findings are generated as final strings inside the worker, so switching locale
with a report open re-decodes the still selected files. If those `File` objects
are gone, after a page reload for instance, the report resets instead.

**Nothing persists.**
No history, no saved reports, no comparison over time. The only thing stored is
the locale preference in `localStorage['mdcfb.locale']`.

**The share opt-in is capped.**
7 MB checked client side, 7.5 MB server side, against the 8 MB Discord webhook
attachment limit. Larger logs cannot be shared through the button.

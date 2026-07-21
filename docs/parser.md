# Parser

[`src/lib/bbl/parse.ts`](../src/lib/bbl/parse.ts) turns `.bbl` bytes into
`FlightData`. It is a thin adapter over the `blackbox-log` WASM decoder plus
three workarounds without which modern logs do not open at all.

## Public surface

```ts
initWasm(source: BufferSource | WebAssembly.Module): Promise<void>
parseFile(fileName: string, buf: Uint8Array, dict?: Dict): Promise<ParsedFile>

// exported for tests and tooling
spoofFirmware(buf: Uint8Array): { data: Uint8Array; original: string | null }
splitSessions(buf: Uint8Array): Array<{ offset: number; bytes: Uint8Array }>
extractHeaderText(chunk: Uint8Array): Record<string, string>
```

`initWasm` must be called once before `parseFile`. In the browser the worker
fetches `public/blackbox-log.wasm`; in Node the CLI and the tests read it from
disk.

## Stage 1: firmware spoof

The npm `blackbox-log` wrapper is version 0.2.2, MIT, and unmaintained. It
refuses any firmware string it does not recognise, which means anything newer
than 4.4. A 2025 log would simply fail to open.

`spoofFirmware` scans for every occurrence of `Firmware revision:Betaflight `
and rewrites the version that follows to `4.4.2`, padded with spaces to the
exact original length so no byte offset in the file moves:

```
H Firmware revision:Betaflight 2025.12.2 (79065c96b) STM32F7X2
                               ^^^^^^^^^ -> "4.4.2    "
```

Versions already in `4.0.x` to `4.4.x` are left alone. The original string is
returned and stored in `meta.firmware`, so the report shows the real firmware
even though the decoder was handed a fake one.

This is safe because the blackbox frame format is self describing: field names,
widths, predictors and encodings are all declared in the headers of each
session. The decoder does not need the version to read the frames. The output
was cross checked against the orangebox parser on real logs from three
different drones (see [testing.md](testing.md), `tests/parse.test.ts`).

## Stage 2: session splitting

A `.bbl` file straight off an SD card usually contains several flights
concatenated. `splitSessions` finds every occurrence of the magic header

```
H Product:Blackbox flight data recorder
```

and cuts the buffer between consecutive offsets. Bytes before the first magic
are discarded. Zero matches means the file is not a blackbox log, and
`parseFile` returns a single `SkippedSession` saying so.

## Stage 3: per session decode

Each chunk is decoded independently:

```ts
const parser = await Parser.init(wasmModule);   // fresh instance, see below
const file = parser.loadFile(chunk);
const h = file.parseHeaders(0);
for (const pe of h.getDataParser()) { ... }
```

**A fresh `Parser` per session** is the second workaround. The wrapper detaches
its WASM `ArrayBuffer` on a large file, so reusing one instance across sessions
crashes on the second one. Instantiating per session costs a few milliseconds
and removes the whole class of failure.

Three frame kinds are consumed:

| Kind | Used for |
| --- | --- |
| `main` | timestamps and every numeric field |
| `gps` | `GPS_numSat`, `GPS_speed` (cm/s, converted to m/s) |
| `slow` | `failsafePhase`, counted per distinct value |

Field lookup is by name (`gyroADC[0]`, `motor[3]`, `rcCommand[3]`, `eRPM[2]`,
`vbatLatest`, `amperageLatest`, `baroAlt`, `axisP/I/D/F[n]`), resolved once into
a column index map, so a firmware that reorders fields still works.

Headers are read separately by `extractHeaderText`, which walks the contiguous
`H key:value` lines at the top of the chunk with a latin1 decoder. The decoder
exposes some of them, but not all, and the config lint needs the raw set.

## Stage 4: sample rate and time rebuild

Sample rate is the median of dt over up to 2000 evenly spaced pairs, keeping
only intervals in `(0, 0.5)` seconds. That resists both a corrupt frame and a
recording pause.

The decoded timestamp is not trustworthy end to end. Three things break it:

- the counter rebases towards zero after a flash write stall;
- the 32 bit microsecond counter wraps at about 71 minutes, which the crate
  does not handle;
- a corrupt frame produces nonsense.

Left alone, this yields negative flight durations and wrong mAh integrals. So
`parse.ts` rebuilds a monotonic time axis:

```ts
time[0] = 0;
for (i > 0) {
  const d = times[i] - times[i - 1];
  time[i] = Number.isFinite(d) && d > 0
    ? time[i - 1] + d          // keep positive jumps
    : time[i - 1] + nominalDt; // repair, count it in meta.timeAnomalies
}
```

Positive jumps are kept deliberately: they are legitimate recording pauses
(disarmed, flash saturated) that the timeline is supposed to show. Only
negative or invalid steps are replaced by the nominal dt, and their count lands
in `meta.timeAnomalies`.

## Skip rules

A session is pushed to `ParsedFile.skipped` rather than analysed when:

| Condition | Message key |
| --- | --- |
| no magic header in the whole file | `system.noBlackboxHeader` |
| `parseHeaders` returns nothing | `system.headersUnreadable` |
| zero main frames decoded | `system.noFramesDecoded` |
| `gyroADC`, `setpoint`, `motor` or `rcCommand[3]` missing | `system.essentialFieldsMissing` |
| fewer than 100 frames | `system.sessionTooShort` (arming blip) |
| shorter than `MIN_SESSION_S` (10 s) | `system.flightTooShort` |

Any other thrown error is caught and stored with its message. Sibling sessions
in the same file are unaffected.

## Motor output scale

```ts
const motorOutput = (rawHeaders['motorOutput'] ?? '48,2047').split(',').map(Number);
```

The `motorOutput` header gives the real low and high bounds for that build. The
default `48,2047` only applies when the header is absent. Analysis modules use
`meta.motorOutputLow/High` for every percentage, never a hardcoded 2047. Real
logs in the test set use `158` as the low bound, which is why hardcoding it was
wrong.

## Debugging a log that will not open

```bash
npx tsx scripts/smoke.mjs your-log.bbl
```

prints, per session: craft name, firmware, frame count, duration, sample rate,
which optional fields are present, failsafe counters, motor range, debug mode
and a few config headers. Skipped sessions are listed with their reason. That
output is what an issue about a refused log should carry.

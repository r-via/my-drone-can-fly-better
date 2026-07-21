// Calibration du détecteur d'oscillation : dump des événements bruts par log.
// Usage : npx tsx scripts/osc-debug.mjs <log.bbl> [...]
import { readFile } from 'node:fs/promises';

import { analyzeOscillation } from '../src/lib/analysis/oscillation.ts';
import { initWasm, parseFile } from '../src/lib/bbl/parse.ts';

await initWasm(await readFile(new URL('../public/blackbox-log.wasm', import.meta.url)));

for (const path of process.argv.slice(2)) {
  const name = path.split('/').pop();
  const parsed = await parseFile(name, new Uint8Array(await readFile(path)));
  for (const [si, fd] of parsed.sessions.entries()) {
    if (fd.time.length < 2000) continue;
    const o = analyzeOscillation(fd);
    const dur = fd.time[fd.time.length - 1] - fd.time[0];
    console.log(
      `\n${name} s${si + 1}  ${fd.meta.craftName || '?'}  ${dur.toFixed(0)}s @ ${fd.meta.sampleRateHz.toFixed(0)}Hz` +
        `  baseline=${o.baselineAmp.toFixed(1)}  events=${o.events.length}`,
    );
    for (const e of o.events.slice(0, 6)) {
      console.log(
        `   t=${e.tStart.toFixed(2)}-${e.tEnd.toFixed(2)}s (${(e.tEnd - e.tStart).toFixed(2)}s)` +
          `  f=${e.freqHz === null ? '  n/a' : e.freqHz.toFixed(0).padStart(5)}Hz` +
          `  peak=${e.peakAmp.toFixed(0).padStart(5)}(${e.peakAmpPct.toFixed(0).padStart(2)}%)  ratio=${e.ratio.toFixed(1).padStart(6)}` +
          `  conc=${e.concentration.toFixed(2)}  sat=${e.saturationPct.toFixed(0).padStart(3)}%  cycles=${e.freqHz ? ((e.tEnd - e.tStart) * e.freqHz).toFixed(0) : '?'}`,
      );
    }
  }
}

// Runner Node du pipeline complet (mêmes modules que le site).
// Usage : npm run analyze -- <log.bbl> [log2.bbl ...] [--cli <diff.txt>]
import { readFile } from 'node:fs/promises';

import { initWasm, parseFile } from '../src/lib/bbl/parse.ts';
import { buildReport } from '../src/lib/report.ts';

const ICONS = { crit: '❌', warn: '⚠️ ', info: 'ℹ️ ', ok: '✅' };

const args = process.argv.slice(2);
const cliIdx = args.indexOf('--cli');
let cliText = '';
if (cliIdx !== -1) {
  cliText = await readFile(args[cliIdx + 1], 'utf8');
  args.splice(cliIdx, 2);
}

await initWasm(await readFile(new URL('../public/blackbox-log.wasm', import.meta.url)));

const parsed = [];
for (const path of args) {
  const buf = new Uint8Array(await readFile(path));
  parsed.push(await parseFile(path.split('/').pop(), buf));
}

const report = buildReport(parsed, cliText);

for (const file of report.files) {
  console.log(`\n━━━ ${file.fileName} ━━━`);
  for (const sk of file.skipped) {
    console.log(`  session ${sk.index + 1} ignorée (${(sk.sizeBytes / 1000).toFixed(0)} ko) : ${sk.error}`);
  }
  for (const sr of file.sessionReports) {
    const m = sr.analysis.meta;
    console.log(`\n▶ session ${m.index + 1} — ${m.craftName ?? '?'} [profil ${sr.profile.label}] — ${m.durationS.toFixed(0)}s @ ${m.sampleRateHz.toFixed(0)} Hz — ${m.firmware.split(' (')[0]}`);
    const p = sr.analysis.power;
    if (p) console.log(`  ${p.cells}S ${p.vbatMax.toFixed(2)}→${p.vbatMin.toFixed(2)} V (sag ${p.sagV.toFixed(2)} V)  courant max ${p.ampMax?.toFixed(1) ?? '?'} A`);
    for (const f of sr.findings) {
      console.log(`  ${ICONS[f.severity]} [${f.category}] ${f.title}`);
      console.log(`      ${f.evidence}`);
      if (f.fix) {
        console.log(`      → ${f.fix.text}`);
        for (const line of f.fix.cli ?? []) console.log(`        ${line}`);
      }
    }
  }
}

if (report.configFindings.length > 0) {
  console.log('\n━━━ Lint config (diff collé) ━━━');
  for (const f of report.configFindings) console.log(`  ${ICONS[f.severity]} ${f.title} — ${f.evidence}`);
}

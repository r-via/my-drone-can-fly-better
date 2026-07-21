// Runner Node du pipeline complet (mêmes modules que le site).
// Usage : npm run analyze -- <log.bbl> [log2.bbl ...] [--lang fr|en|es|de|zh]
import { readFile } from 'node:fs/promises';

import { initWasm, parseFile } from '../src/lib/bbl/parse.ts';
import { detectLocaleFromEnv, getDict, isLocale } from '../src/lib/i18n/index.ts';
import { buildReport } from '../src/lib/report.ts';

const ICONS = { crit: '❌', warn: '⚠️ ', info: 'ℹ️ ', ok: '✅' };

const args = process.argv.slice(2);

let locale = detectLocaleFromEnv(process.env);
const langIdx = args.indexOf('--lang');
if (langIdx !== -1) {
  const requested = args[langIdx + 1];
  if (isLocale(requested)) locale = requested;
  args.splice(langIdx, 2);
}
const dict = getDict(locale);

await initWasm(await readFile(new URL('../public/blackbox-log.wasm', import.meta.url)));

const parsed = [];
for (const path of args) {
  const buf = new Uint8Array(await readFile(path));
  // dict : sans lui les erreurs de parsing restent dans la langue par défaut
  // alors que le reste du rapport suit --lang.
  parsed.push(await parseFile(path.split('/').pop(), buf, dict));
}

const report = buildReport(parsed, dict);

for (const file of report.files) {
  console.log(`\n━━━ ${file.fileName} ━━━`);
  for (const sk of file.skipped) {
    console.log(`  ${dict.system.cliSessionSkipped(String(sk.index + 1), (sk.sizeBytes / 1000).toFixed(0))} : ${sk.error}`);
  }
  for (const sr of file.sessionReports) {
    const m = sr.analysis.meta;
    console.log(`\n▶ session ${m.index + 1} - ${m.craftName ?? '?'} [${dict.system.cliProfile(dict.rules.profiles[sr.profile.id].label)}] - ${m.durationS.toFixed(0)}s @ ${m.sampleRateHz.toFixed(0)} Hz - ${m.firmware.split(' (')[0]}`);
    const p = sr.analysis.power;
    if (p) {
      // Canal vbat incohérent : ne pas afficher min/max/sag comme des mesures,
      // le verdict batterie les a justement écartés.
      const vbat = p.implausibleSamples > 0
        ? dict.system.cliVbatUnusable(String(p.cells), String(p.implausibleSamples))
        : dict.system.cliVbatRange(String(p.cells), p.vbatMax.toFixed(2), p.vbatMin.toFixed(2), p.sagV.toFixed(2));
      console.log(`  ${vbat}  ${dict.system.cliCurrentMax(p.ampMax?.toFixed(1) ?? '?')}`);
    }
    for (const f of sr.findings) {
      // f.category est la clé d'enum (français) : l'UI la traduit via
      // dict.ui.categories, le terminal doit faire pareil.
      console.log(`  ${ICONS[f.severity]} [${dict.ui.categories[f.category] ?? f.category}] ${f.title}`);
      console.log(`      ${f.evidence}`);
      if (f.fix) {
        console.log(`      → ${f.fix.text}`);
        for (const line of f.fix.cli ?? []) console.log(`        ${line}`);
      }
    }
  }
}

// Runner Node du pipeline complet (mêmes modules que le site).
// Usage : npm run analyze -- <log.bbl> [log2.bbl ...] [--lang fr|en|es|de|zh]
import { readFile } from 'node:fs/promises';

import { initWasm, parseFile } from '../src/lib/bbl/parse.ts';
import { buildComparisons, splitCommonCaveats } from '../src/lib/compare.ts';
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
      const amp = p.ampImplausible
        ? dict.system.cliCurrentUnreliable
        : dict.system.cliCurrentMax(p.ampMax?.toFixed(1) ?? '?');
      console.log(`  ${vbat}  ${amp}`);
    }
    const g = sr.analysis.gps;
    if (g.available && g.numSatMedian !== null && g.numSatMin !== null) {
      console.log(
        `  ${dict.system.cliGpsSummary(
          g.numSatMedian.toFixed(0),
          g.numSatMin.toFixed(0),
          g.hdopMedian !== null ? g.hdopMedian.toFixed(1) : null,
        )}`,
      );
    }
    const temp = sr.analysis.temperature;
    if (temp) {
      // Mêmes libellés de sonde que le graphe web (dict.ui.charts.temperature).
      const tl = dict.ui.charts.temperature;
      const label = (id) =>
        id === 'esc' ? tl.probeEsc
        : id === 'imu' ? tl.probeImu
        : id === 'baro' ? tl.probeBaro
        : id.startsWith('sens') ? tl.probeSens(id.slice(4))
        : tl.probeEscN(String(Number(id.slice(3)) + 1));
      const probes = temp.probes
        .map((p) => `${label(p.id)} ${p.firstC.toFixed(0)}→${p.lastC.toFixed(0)} (max ${p.maxC.toFixed(0)})`)
        .join(' | ');
      console.log(`  ${dict.system.cliTemps(probes)}`);
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

// --- Comparaison de passes -------------------------------------------------
// N'apparaît que quand plusieurs vols du même quad sont donnés : c'est le seul
// cadre où un delta de tune veut dire quelque chose (voir src/lib/compare.ts).

const c = dict.compare;
// Même dédoublonnage que le panneau web : un caveat identique sur toutes les
// paires (ex. « regroupés par carte ») s'imprime une fois, pas huit.
const { common, perPair: comparisons } = splitCommonCaveats(
  buildComparisons(report.files.flatMap((f) => f.sessionReports)),
);

const AXES = ['Roll', 'Pitch', 'Yaw'];
/** Valeur formatée, avec l'axe d'où elle vient quand il y en a un. */
const fmt = (v, digits, axis) =>
  v === null ? c.metricUnavailable : `${v.toFixed(digits)}${axis === null ? '' : ` ${AXES[axis]}`}`;
/**
 * Delta signé. Le verdict bien/mal n'est apposé que sur les indicateurs qu'un
 * réglage pilote : un témoin (`neutral`) est affiché sans jugement.
 */
function fmtDelta(m) {
  if (m.delta === null) return '';
  const sign = m.delta > 0 ? '+' : '';
  const flat = Math.abs(m.delta) < 10 ** -m.digits / 2;
  const mark =
    m.better === 'neutral' ? '·' : flat ? '=' : (m.delta < 0) === (m.better === 'lower') ? '✅' : '⚠️ ';
  return `${sign}${m.delta.toFixed(m.digits)} ${mark}`;
}

if (common.length > 0) {
  console.log(`\n═══ ${c.title} ═══`);
  for (const cav of common) console.log(`  ⚠️  ${c.caveats[cav.id](...cav.args)}`);
}

for (const cmp of comparisons) {
  const label = (ref) => c.sessionLabel(ref.fileName, String(ref.sessionIndex + 1));
  console.log(`\n═══ ${c.title} : ${c.heading(label(cmp.before), label(cmp.after))} ═══`);

  for (const cav of cmp.caveats) console.log(`  ⚠️  ${c.caveats[cav.id](...cav.args)}`);

  if (cmp.tuneChanges.length === 0) {
    console.log(`  ${c.noTuneChange}`);
  } else {
    console.log(`\n  ${c.tuneTitle}`);
    for (const t of cmp.tuneChanges) {
      console.log(`    ${t.driver ? '▸' : ' '} ${t.key.padEnd(34)} ${t.before} → ${t.after}`);
    }
    if (cmp.tuneChanges.some((t) => t.driver)) console.log(`    ${c.driverNote}`);
  }

  console.log(`\n  ${c.metricsTitle}`);
  for (const m of cmp.metrics) {
    console.log(
      `    ${c.metrics[m.id].padEnd(28)} ${fmt(m.before, m.digits, m.beforeAxis).padStart(12)} → ${fmt(m.after, m.digits, m.afterAxis).padStart(12)}  ${fmtDelta(m)}`,
    );
  }
}

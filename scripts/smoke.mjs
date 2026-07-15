import { readFile } from 'node:fs/promises';
import { initWasm, parseFile } from '../src/lib/bbl/parse.ts';

await initWasm(await readFile(new URL('../public/blackbox-log.wasm', import.meta.url)));

for (const path of process.argv.slice(2)) {
  const buf = new Uint8Array(await readFile(path));
  const name = path.split('/').pop();
  const t0 = performance.now();
  const pf = await parseFile(name, buf);
  const ms = (performance.now() - t0).toFixed(0);
  console.log(`\n===== ${name} (${(buf.length/1e6).toFixed(1)} MB, ${ms} ms) =====`);
  for (const s of pf.sessions) {
    const m = s.meta;
    console.log(`  s${m.index+1}: ${m.craftName} | ${m.firmware.split(' (')[0]} | ${m.frameCount}f ${m.durationS.toFixed(1)}s @${m.sampleRateHz.toFixed(0)}Hz | unfilt=${!!s.gyroUnfilt} erpm=${!!s.erpm} vbat=${s.vbat ? s.vbat[0].toFixed(2)+'V' : 'n/a'} baro=${!!s.baroAlt} gps=${s.gps ? s.gps.numSat.length+'pts' : 'no'}`);
    if (s.gps) console.log(`      gps: satMax=${Math.max(...s.gps.numSat)} speedMax=${Math.max(...s.gps.speedMps).toFixed(1)} (unité à vérifier)`);
    console.log(`      failsafe: ${JSON.stringify(s.failsafePhaseCounts)} | motorRange=${m.motorOutputLow}-${m.motorOutputHigh} | debug=${m.debugMode}`);
    console.log(`      headers config: pid_roll=${m.headers['rollPID']} gyro_lpf=${m.headers['gyro_lowpass_hz']} dterm_lpf=${m.headers['dterm_lpf1_static_hz'] ?? m.headers['dterm_lowpass_hz']} rpm_filter=${m.headers['rpm_filter_harmonics'] ?? m.headers['gyro_rpm_notch_harmonics']}`);
  }
  for (const sk of pf.skipped) console.log(`  s${sk.index+1} IGNORÉE (${sk.sizeBytes}o): ${sk.error}`);
}

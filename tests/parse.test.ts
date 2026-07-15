import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

import { initWasm, parseFile } from '../src/lib/bbl/parse';

const CHIMERA = '/home/rviau/projects/drones/chimera/blackbox/btfl_016.bbl';

beforeAll(async () => {
  await initWasm(await readFile(new URL('../public/blackbox-log.wasm', import.meta.url)));
});

describe('adaptateur bbl', () => {
  it('parse le log chimera avec les mêmes chiffres qu orangebox', async () => {
    const buf = new Uint8Array(await readFile(CHIMERA));
    const pf = await parseFile('btfl_016.bbl', buf);
    expect(pf.sessions).toHaveLength(1);
    const s = pf.sessions[0];
    // Références issues de analyze_shimera.py (golden chimera_016.txt)
    expect(s.meta.frameCount).toBe(50077);
    expect(s.meta.craftName).toBe('SHIMERA7PRO');
    expect(s.meta.firmware).toContain('2025.12.2');
    expect(s.meta.sampleRateHz).toBeGreaterThan(1900);
    expect(s.meta.sampleRateHz).toBeLessThan(2100);
    const vmax = Math.max(...Array.from(s.vbat!));
    const vmin = Math.min(...Array.from(s.vbat!).filter((v) => v > 0));
    expect(vmax).toBeCloseTo(25.44, 1);
    expect(vmin).toBeCloseTo(20.68, 1);
    let peak = 0;
    for (const v of s.gyro[1]) peak = Math.max(peak, Math.abs(v));
    expect(Math.round(peak)).toBe(369);
    expect(s.gyroUnfilt).not.toBeNull();
    expect(s.erpm).not.toBeNull();
    expect(s.meta.headers['rollPID']).toBeTruthy();
  });
});

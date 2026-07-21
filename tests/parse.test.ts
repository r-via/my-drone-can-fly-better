import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

import { MIN_SESSION_S, initWasm, parseFile, rejectShortSession } from '../src/lib/bbl/parse';
import { getDict } from '../src/lib/i18n';
import type { SessionMeta } from '../src/lib/types';

const CHIMERA = '/home/rviau/projects/drones/chimera/blackbox/btfl_016.bbl';
/** 1,28 s pour 1277 frames : assez de frames pour passer, trop court pour valoir quoi que ce soit. */
const HOP = '/home/rviau/projects/drones/pavo pico/btfl_001.bbl';
/** 5 frames : le blip d'armement pur. */
const BLIP = '/home/rviau/projects/drones/shared-logs/public/parser-stress/error-recovery.bbl';

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

// ---------------------------------------------------------------------------
// Vols trop courts
// ---------------------------------------------------------------------------

const meta = (durationS: number, frameCount: number): SessionMeta => ({
  index: 0,
  fileName: 'x.bbl',
  firmware: 'Betaflight 2025.12.2',
  fieldNames: [],
  sampleRateHz: 2000,
  durationS,
  frameCount,
  motorOutputLow: 48,
  motorOutputHigh: 2047,
  headers: {},
});

describe('refus des sessions trop courtes', () => {
  const fr = getDict('fr');

  it('accepte une session à partir du seuil et refuse juste en dessous', () => {
    expect(rejectShortSession(meta(MIN_SESSION_S, 20_000), fr)).toBeNull();
    expect(rejectShortSession(meta(MIN_SESSION_S - 0.1, 20_000), fr)).toContain('9.9');
  });

  it('distingue le blip d armement du vol trop court', () => {
    expect(rejectShortSession(meta(0.05, 5), fr)).toBe(fr.system.sessionTooShort('5'));
    expect(rejectShortSession(meta(3, 6000), fr)).toBe(fr.system.flightTooShort('3.0', '10'));
  });

  it('écarte un saut de 1,3 s au lieu d en tirer un rapport', async () => {
    const pf = await parseFile('btfl_001.bbl', new Uint8Array(await readFile(HOP)), fr);
    expect(pf.sessions).toHaveLength(0);
    expect(pf.skipped.map((s) => s.error)).toEqual([fr.system.flightTooShort('1.3', '10')]);
  });

  it('garde le message frames pour un blip d armement réel', async () => {
    const pf = await parseFile('error-recovery.bbl', new Uint8Array(await readFile(BLIP)), fr);
    expect(pf.sessions).toHaveLength(0);
    expect(pf.skipped[0].error).toContain('frames');
  });
});

import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

import { initWasm, parseFile } from '../src/lib/bbl/parse';
import { configFromHeaders, lintConfig } from '../src/lib/cli/config';
import type { CliConfig, DroneProfile, SessionAnalysis } from '../src/lib/types';

const CHIMERA = '/home/rviau/projects/drones/chimera/blackbox/btfl_016.bbl';

const PROFILE: DroneProfile = {
  id: 'chimera7',
  craftMatch: /shimera|chimera/i,
  motorPoles: 14,
  expectedCells: 6,
  dynIdleSuggested: 25,
  thresholds: {
    filtNoiseWarn: 5,
    filtNoiseCrit: 10,
    unfiltNoiseWarn: 20,
    unfiltNoiseCrit: 40,
    trackingWarn: 15,
    trackingCrit: 30,
    saturationWarn: 5,
    saturationCrit: 15,
    imbalanceWarn: 8,
    imbalanceShiftWarn: 10,
    imbalanceShiftCrit: 18,
    floorClipWarn: 3,
    floorClipCrit: 10,
    sagPerCellWarn: 0.35,
    sagPerCellCrit: 0.5,
    perCellMinCrit: 3.2,
    overshootWarn: 15,
    riseTimeSlowMs: 80,
    yoyoRatioWarn: 1.5,
    propwashWarn: 30,
    residualHfWarn: 3,
    oscRatioWarn: 6,
    oscRatioCrit: 12,
    oscMinAmpPct: 15,
    motorBandRawFloor: 100,
  },
};

const cfg = (values: Record<string, string>): CliConfig => ({ values });

// Config volontairement mal réglée : chaque valeur vise une règle du lint.
const BAD_CONFIG = cfg({
  gyro_lpf1_static_hz: '100',
  dterm_lpf1_static_hz: '60',
  dyn_notch_count: '0',
  rpm_filter_harmonics: '0',
  dshot_bidir: 'ON',
  motor_pwm_protocol: 'DSHOT600',
  vbat_warning_cell_voltage: '300',
  anti_gravity_gain: '0',
  motor_output_limit: '90',
  f_roll: '0',
  f_pitch: '0',
  f_yaw: '0',
});

function ids(findings: { id: string }[]): string[] {
  return findings.map((f) => f.id);
}

describe('lintConfig sur config mal réglée', () => {
  const findings = lintConfig(BAD_CONFIG, PROFILE, null);
  const found = ids(findings);

  it('déclenche les règles attendues', () => {
    expect(found).toContain('rpm-filter-off-bidir');
    expect(found).toContain('no-notch-no-rpm');
    expect(found).toContain('dterm-lpf-low');
    expect(found).toContain('ff-zero');
    expect(found).toContain('antigravity-off');
    expect(found).toContain('motor-limit');
    expect(found).toContain('vbat-warning');
  });

  it('ff-zero est un choix assumé : mentionné mais exempté du score', () => {
    const ffZero = findings.find((f) => f.id === 'ff-zero');
    expect(ffZero?.scoreExempt).toBe(true);
    // Les autres lints restent comptés : l'exemption est propre à ff-zero.
    expect(findings.find((f) => f.id === 'antigravity-off')?.scoreExempt).toBeUndefined();
  });

  it('ne déclenche pas les règles non applicables', () => {
    // bidir est ON → pas de no-bidir ; filtre RPM inactif → pas de gyro-lpf-low ; pas d'analysis → pas de cells-mismatch
    expect(found).not.toContain('no-bidir');
    expect(found).not.toContain('gyro-lpf-low');
    expect(found).not.toContain('cells-mismatch');
  });

  it('produit des findings complets, triés par sévérité', () => {
    expect(findings[0].id).toBe('no-notch-no-rpm');
    expect(findings[0].severity).toBe('crit');
    for (const f of findings) {
      expect(f.category).toBe('config');
      expect(f.title.length).toBeGreaterThan(0);
      expect(f.detail.length).toBeGreaterThan(0);
      expect(f.evidence.length).toBeGreaterThan(0);
    }
    const rpm = findings.find((f) => f.id === 'rpm-filter-off-bidir')!;
    expect(rpm.severity).toBe('warn');
    expect(rpm.fix?.cli).toEqual(['set rpm_filter_harmonics = 3']);
    const vbat = findings.find((f) => f.id === 'vbat-warning')!;
    expect(vbat.evidence).toContain('3.00');
  });
});

describe('lintConfig cas complémentaires', () => {
  it('no-bidir + gyro-lpf-low quand DSHOT sans bidir et LPF gyro bas avec RPM actif', () => {
    const found = ids(
      lintConfig(
        cfg({
          motor_pwm_protocol: 'DSHOT300',
          dshot_bidir: 'OFF',
          gyro_lpf1_static_hz: '120',
          rpm_filter_harmonics: '3',
        }),
        PROFILE,
        null,
      ),
    );
    expect(found).toContain('no-bidir');
    expect(found).toContain('gyro-lpf-low');
    expect(found).not.toContain('rpm-filter-off-bidir');
    expect(found).not.toContain('no-notch-no-rpm');
  });

  it('no-bidir aussi quand dshot_bidir est absent', () => {
    const found = ids(lintConfig(cfg({ motor_pwm_protocol: 'DSHOT600' }), PROFILE, null));
    expect(found).toContain('no-bidir');
  });

  it('ne signale rien quand les clés sont absentes (config vide)', () => {
    expect(lintConfig(cfg({}), PROFILE, null)).toEqual([]);
  });

  it('dterm-lpf-low ignore la valeur 0 (LPF désactivé volontairement)', () => {
    expect(ids(lintConfig(cfg({ dterm_lpf1_static_hz: '0' }), PROFILE, null))).not.toContain(
      'dterm-lpf-low',
    );
  });

  it('pas de cells-mismatch dans le lint : la règle vit dans engine.ts (battery-cells-unexpected)', () => {
    const analysis = {
      power: { cells: 4, vbatMax: 16.8, vbatMin: 14.2, perCellMax: 4.2, perCellMin: 3.55, sagV: 1.1, ampAvg: 10, ampMax: 40, mahEstimate: 800 },
    } as unknown as SessionAnalysis;
    expect(ids(lintConfig(cfg({}), PROFILE, analysis))).not.toContain('cells-mismatch');
  });
});

describe('configFromHeaders sur le log chimera réel', () => {
  let headers: Record<string, string>;

  beforeAll(async () => {
    await initWasm(await readFile(new URL('../public/blackbox-log.wasm', import.meta.url)));
    const pf = await parseFile('btfl_016.bbl', new Uint8Array(await readFile(CHIMERA)));
    headers = pf.sessions[0].meta.headers;
  });

  it('extrait PID, filtres et réglages moteur avec les noms CLI', () => {
    const v = configFromHeaders(headers).values;
    // PID (headers rollPID/pitchPID/yawPID "P,I,D" → p_/i_/d_)
    expect(v['p_roll']).toBe('45');
    expect(v['i_roll']).toBe('80');
    expect(v['d_roll']).toBe('30');
    expect(v['p_pitch']).toBe('47');
    expect(v['d_pitch']).toBe('34');
    expect(v['p_yaw']).toBe('45');
    // filtres
    expect(v['gyro_lpf1_static_hz']).toBe('250');
    expect(v['dterm_lpf1_static_hz']).toBe('75');
    expect(v['dyn_notch_count']).toBe('3');
    expect(v['dyn_notch_q']).toBe('300');
    expect(v['rpm_filter_harmonics']).toBe('3');
    // moteurs (normalisation enum + booléen)
    expect(v['motor_pwm_protocol']).toBe('DSHOT600');
    expect(v['dshot_bidir']).toBe('ON');
    expect(v['motor_output_limit']).toBe('100');
    // composites éclatés
    expect(v['f_roll']).toBe('120');
    expect(v['f_pitch']).toBe('125');
    expect(v['d_max_roll']).toBe('40');
    expect(v['d_max_pitch']).toBe('46');
    expect(v['vbat_warning_cell_voltage']).toBe('350');
    // divers
    expect(v['anti_gravity_gain']).toBe('80');
    expect(v['motor_poles']).toBe('14');
  });

  // Le garde-fou du choix « headers uniquement » : si une règle se met un jour
  // à lire une clé que les headers ne portent pas, elle ne se tairait pas en
  // silence, ce test tomberait.
  it('les headers portent TOUTES les clés que lintConfig sait lire', async () => {
    const src = await readFile(new URL('../src/lib/cli/config.ts', import.meta.url), 'utf8');
    const read = new Set(
      [...src.matchAll(/\bnum\('([a-z0-9_]+)'\)|\bv\['([a-z0-9_]+)'\]/g)].map((m) => m[1] ?? m[2]),
    );
    expect(read.size).toBeGreaterThan(10);
    const v = configFromHeaders(headers).values;
    expect([...read].filter((k) => v[k] === undefined)).toEqual([]);
  });

  it('lintConfig tourne sans crash sur la config chimera (config saine → aucun finding)', () => {
    const findings = lintConfig(configFromHeaders(headers), PROFILE, null);
    expect(Array.isArray(findings)).toBe(true);
    expect(findings).toEqual([]);
  });
});

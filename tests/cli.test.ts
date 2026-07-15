import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

import { initWasm, parseFile } from '../src/lib/bbl/parse';
import { configFromHeaders, lintConfig, parseCliText } from '../src/lib/cli/config';
import type { DroneProfile, SessionAnalysis } from '../src/lib/types';

const CHIMERA = '/home/rviau/projects/drones/chimera/blackbox/btfl_016.bbl';

const PROFILE: DroneProfile = {
  id: 'chimera7',
  label: 'Chimera 7',
  craftMatch: /shimera|chimera/i,
  motorPoles: 14,
  expectedCells: 6,
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
    sagPerCellWarn: 0.35,
    sagPerCellCrit: 0.5,
    perCellMinCrit: 3.2,
    overshootWarn: 15,
    riseTimeSlowMs: 80,
    yoyoRatioWarn: 1.5,
    propwashWarn: 30,
    residualHfWarn: 3,
  },
};

// Diff all synthétique réaliste (Betaflight 4.5) avec plusieurs réglages douteux.
const DIFF_ALL = `# diff all

# version
# Betaflight / STM32F7X2 (S7X2) 4.5.1 Dec 3 2024 / 12:00:00 (77d01ba3b) MSP API: 1.46

# start the command batch
batch start

board_name SKYSTARSF7HDPRO
manufacturer_id SKST

# feature
feature -RX_PARALLEL_PWM
feature TELEMETRY
feature OSD
feature GPS
feature -GPS

# master
set gyro_lpf1_static_hz = 100
set dterm_lpf1_static_hz = 60
set dyn_notch_count = 0
set rpm_filter_harmonics = 0
set dshot_bidir = ON
set motor_pwm_protocol = DSHOT600
set vbat_warning_cell_voltage = 300
set anti_gravity_gain = 0
set motor_output_limit = 90
set osd_vbat_pos = 2434
set small_angle = 180

profile 0

# profile 0
set p_roll = 40
set p_roll = 45
set i_roll = 80
set d_roll = 30
set f_roll = 0
set f_pitch = 0
set f_yaw = 0

# end the command batch
batch end

save
`;

function ids(findings: { id: string }[]): string[] {
  return findings.map((f) => f.id);
}

describe('parseCliText', () => {
  it('parse un diff all : set (dernier gagne), features, ignore le reste', () => {
    const cfg = parseCliText(DIFF_ALL);
    expect(cfg.source).toBe('paste');
    expect(cfg.raw).toBe(DIFF_ALL);
    // dernier set gagne
    expect(cfg.values['p_roll']).toBe('45');
    expect(cfg.values['i_roll']).toBe('80');
    expect(cfg.values['dshot_bidir']).toBe('ON');
    expect(cfg.values['motor_pwm_protocol']).toBe('DSHOT600');
    expect(cfg.values['vbat_warning_cell_voltage']).toBe('300');
    // features : ajout, retrait (feature -GPS annule feature GPS)
    expect(cfg.features).toContain('TELEMETRY');
    expect(cfg.features).toContain('OSD');
    expect(cfg.features).not.toContain('GPS');
    expect(cfg.features).not.toContain('RX_PARALLEL_PWM');
    // les commentaires et commandes hors set/feature n'introduisent pas de clés
    expect(cfg.values['board_name']).toBeUndefined();
    expect(cfg.values['version']).toBeUndefined();
    expect(Object.keys(cfg.values)).toHaveLength(17);
  });

  it('retourne une config vide sur un texte sans commande', () => {
    const cfg = parseCliText('# rien\nblabla\n');
    expect(cfg.values).toEqual({});
    expect(cfg.features).toEqual([]);
  });
});

describe('lintConfig sur diff all synthétique', () => {
  const cfg = parseCliText(DIFF_ALL);
  const findings = lintConfig(cfg, PROFILE, null);
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
    const cfg = parseCliText(
      [
        'set motor_pwm_protocol = DSHOT300',
        'set dshot_bidir = OFF',
        'set gyro_lpf1_static_hz = 120',
        'set rpm_filter_harmonics = 3',
      ].join('\n'),
    );
    const found = ids(lintConfig(cfg, PROFILE, null));
    expect(found).toContain('no-bidir');
    expect(found).toContain('gyro-lpf-low');
    expect(found).not.toContain('rpm-filter-off-bidir');
    expect(found).not.toContain('no-notch-no-rpm');
  });

  it('no-bidir aussi quand dshot_bidir est absent', () => {
    const cfg = parseCliText('set motor_pwm_protocol = DSHOT600\n');
    const found = ids(lintConfig(cfg, PROFILE, null));
    expect(found).toContain('no-bidir');
  });

  it('ne signale rien quand les clés sont absentes (config vide)', () => {
    const cfg = parseCliText('');
    expect(lintConfig(cfg, PROFILE, null)).toEqual([]);
  });

  it('dterm-lpf-low ignore la valeur 0 (LPF désactivé volontairement)', () => {
    const cfg = parseCliText('set dterm_lpf1_static_hz = 0\n');
    expect(ids(lintConfig(cfg, PROFILE, null))).not.toContain('dterm-lpf-low');
  });

  it('pas de cells-mismatch dans le lint : la règle vit dans engine.ts (battery-cells-unexpected)', () => {
    const analysis = {
      power: { cells: 4, vbatMax: 16.8, vbatMin: 14.2, perCellMax: 4.2, perCellMin: 3.55, sagV: 1.1, ampAvg: 10, ampMax: 40, mahEstimate: 800 },
    } as unknown as SessionAnalysis;
    expect(ids(lintConfig(parseCliText(''), PROFILE, analysis))).not.toContain('cells-mismatch');
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
    const cfg = configFromHeaders(headers);
    expect(cfg.source).toBe('headers');
    // PID (headers rollPID/pitchPID/yawPID "P,I,D" → p_/i_/d_)
    expect(cfg.values['p_roll']).toBe('45');
    expect(cfg.values['i_roll']).toBe('80');
    expect(cfg.values['d_roll']).toBe('30');
    expect(cfg.values['p_pitch']).toBe('47');
    expect(cfg.values['d_pitch']).toBe('34');
    expect(cfg.values['p_yaw']).toBe('45');
    // filtres
    expect(cfg.values['gyro_lpf1_static_hz']).toBe('250');
    expect(cfg.values['dterm_lpf1_static_hz']).toBe('75');
    expect(cfg.values['dyn_notch_count']).toBe('3');
    expect(cfg.values['dyn_notch_q']).toBe('300');
    expect(cfg.values['rpm_filter_harmonics']).toBe('3');
    // moteurs (normalisation enum + booléen)
    expect(cfg.values['motor_pwm_protocol']).toBe('DSHOT600');
    expect(cfg.values['dshot_bidir']).toBe('ON');
    expect(cfg.values['motor_output_limit']).toBe('100');
    // composites éclatés
    expect(cfg.values['f_roll']).toBe('120');
    expect(cfg.values['f_pitch']).toBe('125');
    expect(cfg.values['d_max_roll']).toBe('40');
    expect(cfg.values['d_max_pitch']).toBe('46');
    expect(cfg.values['vbat_warning_cell_voltage']).toBe('350');
    // divers
    expect(cfg.values['anti_gravity_gain']).toBe('80');
    expect(cfg.values['motor_poles']).toBe('14');
  });

  it('lintConfig tourne sans crash sur la config chimera (config saine → aucun finding)', () => {
    const cfg = configFromHeaders(headers);
    const findings = lintConfig(cfg, PROFILE, null);
    expect(Array.isArray(findings)).toBe(true);
    expect(findings).toEqual([]);
  });
});

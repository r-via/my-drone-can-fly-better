// Parsing + lint de configuration CLI Betaflight.
// Deux sources : un `diff all`/`dump` collé par l'utilisateur, ou le snapshot
// config embarqué dans les headers du .bbl. Le lint applique des règles
// déterministes et retourne des Finding (catégorie 'config') chiffrés.
import { fr } from '../i18n/fr';

import type { Dict } from '../i18n/fr';
import type { CliConfig, DroneProfile, Finding, SessionAnalysis } from '../types';

// Enum Betaflight 4.x pour motor_pwm_protocol (headers = valeur numérique).
const MOTOR_PROTOCOLS = [
  'PWM',
  'ONESHOT125',
  'ONESHOT42',
  'MULTISHOT',
  'BRUSHED',
  'DSHOT150',
  'DSHOT300',
  'DSHOT600',
  'PROSHOT1000',
  'DISABLED',
] as const;

// ---------------------------------------------------------------------------
// parseCliText - diff all / dump collé
// ---------------------------------------------------------------------------

const SET_RE = /^set\s+([A-Za-z0-9_]+)\s*=\s*(.+)$/i;
const FEATURE_RE = /^feature\s+(-?)([A-Za-z0-9_]+)$/i;

/** Parse un texte CLI Betaflight (diff all, dump…). Le dernier `set` gagne. */
export function parseCliText(text: string): CliConfig {
  const values: Record<string, string> = {};
  const features = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const setMatch = SET_RE.exec(line);
    if (setMatch) {
      values[setMatch[1].toLowerCase()] = setMatch[2].trim();
      continue;
    }

    const featMatch = FEATURE_RE.exec(line);
    if (featMatch) {
      const name = featMatch[2].toUpperCase();
      if (featMatch[1] === '-') features.delete(name);
      else features.add(name);
    }
    // Tout le reste (batch, board_name, profile, save…) est ignoré.
  }

  return { values, features: [...features], source: 'paste', raw: text };
}

// ---------------------------------------------------------------------------
// configFromHeaders - snapshot config embarqué dans le .bbl
// ---------------------------------------------------------------------------

/** Headers en minuscules qui ne correspondent PAS à un paramètre CLI utile. */
const HEADER_SKIP = new Set([
  'features', // bitmask brut, pas exploitable tel quel
  'vbatref',
  'gyro_scale',
  'maxthrottle',
  'looptime',
  'vbatcellvoltage', // éclaté en vbat_*_cell_voltage plus bas
]);

function splitTriple(values: Record<string, string>, srcKey: string, names: [string, string, string]): void {
  const raw = values[srcKey];
  if (raw === undefined) return;
  const parts = raw.split(',').map((s) => s.trim());
  delete values[srcKey];
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== undefined && parts[i] !== '') values[names[i]] = parts[i];
  }
}

/** Reconstruit une CliConfig depuis les lignes "H clé:valeur" d'une session .bbl. */
export function configFromHeaders(headers: Record<string, string>): CliConfig {
  const values: Record<string, string> = {};

  // Passe 1 : les headers dont la clé est déjà un nom CLI (minuscules + underscores).
  for (const [key, value] of Object.entries(headers)) {
    if (!/^[a-z][a-z0-9_]*$/.test(key)) continue;
    if (HEADER_SKIP.has(key)) continue;
    values[key] = value.trim();
  }

  // Passe 2 : headers composites → noms CLI.
  const pidAxes: Array<[string, string]> = [
    ['rollPID', 'roll'],
    ['pitchPID', 'pitch'],
    ['yawPID', 'yaw'],
  ];
  for (const [headerKey, axis] of pidAxes) {
    const raw = headers[headerKey];
    if (!raw) continue;
    const [p, i, d] = raw.split(',').map((s) => s.trim());
    if (p) values[`p_${axis}`] = p;
    if (i) values[`i_${axis}`] = i;
    if (d !== undefined && d !== '') values[`d_${axis}`] = d;
  }

  splitTriple(values, 'd_max', ['d_max_roll', 'd_max_pitch', 'd_max_yaw']);
  splitTriple(values, 'd_min', ['d_min_roll', 'd_min_pitch', 'd_min_yaw']);
  splitTriple(values, 'ff_weight', ['f_roll', 'f_pitch', 'f_yaw']);

  const vcell = headers['vbatcellvoltage'];
  if (vcell) {
    const [min, warn, max] = vcell.split(',').map((s) => s.trim());
    if (min) values['vbat_min_cell_voltage'] = min;
    if (warn) values['vbat_warning_cell_voltage'] = warn;
    if (max) values['vbat_max_cell_voltage'] = max;
  }

  // Passe 3 : normalisation vers les valeurs CLI lisibles.
  if (values['dshot_bidir'] === '1') values['dshot_bidir'] = 'ON';
  else if (values['dshot_bidir'] === '0') values['dshot_bidir'] = 'OFF';

  const proto = values['motor_pwm_protocol'];
  if (proto !== undefined && /^\d+$/.test(proto)) {
    values['motor_pwm_protocol'] = MOTOR_PROTOCOLS[Number(proto)] ?? proto;
  }

  return { values, features: [], source: 'headers' };
}

// ---------------------------------------------------------------------------
// lintConfig - règles déterministes
// ---------------------------------------------------------------------------

/** Lit une valeur numérique ; ON/OFF → 1/0 ; listes "a,b,c" → premier élément. */
function parseNum(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const s = raw.trim().toUpperCase();
  if (s === 'ON' || s === 'TRUE') return 1;
  if (s === 'OFF' || s === 'FALSE') return 0;
  const n = Number.parseFloat(s.split(',')[0]);
  return Number.isFinite(n) ? n : null;
}

/** Valeur par défaut Betaflight de dyn_notch_count. */
const DEFAULT_NOTCH_COUNT = 3;

/**
 * Fréquence sous laquelle les notches du filtre RPM ne sont plus à pleine
 * force. Betaflight les estompe linéairement de min_hz + fade_range (pleine
 * puissance) jusqu'à min_hz (éteintes). Une fondamentale moteur située sous
 * ce plafond n'est donc que partiellement filtrée.
 */
function rpmFadeTopHz(minHz: number | null, fadeRangeHz: number | null): number | null {
  if (minHz === null || minHz <= 0) return null;
  return minHz + (fadeRangeHz ?? 0);
}

/** true/false si motor_pwm_protocol est présent, null sinon. */
function isDshotProtocol(raw: string | undefined): boolean | null {
  if (raw === undefined) return null;
  const s = raw.trim().toUpperCase();
  if (s.startsWith('DSHOT')) return true;
  if (/^\d+$/.test(s)) {
    const n = Number.parseInt(s, 10);
    return n >= 5 && n <= 7; // DSHOT150/300/600
  }
  return false;
}

const SEVERITY_RANK = { crit: 3, warn: 2, info: 1, ok: 0 } as const;

/** Applique les règles de lint sur une config. Retourne les findings triés par sévérité. */
export function lintConfig(
  config: CliConfig,
  profile: DroneProfile,
  analysis: SessionAnalysis | null,
  dict: Dict = fr,
): Finding[] {
  const L = dict.lint;
  const v = config.values;
  const findings: Finding[] = [];
  const num = (key: string): number | null => parseNum(v[key]);

  const bidir = num('dshot_bidir');
  const rpmHarmonics = num('rpm_filter_harmonics');
  const notchCount = num('dyn_notch_count');
  const dshot = isDshotProtocol(v['motor_pwm_protocol']);

  // rpm-filter-off-bidir - le retour eRPM est là mais le filtre RPM est coupé.
  if (bidir === 1 && rpmHarmonics === 0) {
    findings.push({
      id: 'rpm-filter-off-bidir',
      severity: 'warn',
      category: 'config',
      title: L.rpmFilterOffBidir.title,
      detail: L.rpmFilterOffBidir.detail,
      evidence: L.rpmFilterOffBidir.evidence,
      fix: {
        text: L.rpmFilterOffBidir.fix,
        cli: ['set rpm_filter_harmonics = 3'],
      },
    });
  }

  // no-bidir - protocole DSHOT mais pas de retour eRPM.
  if (dshot === true && bidir !== 1) {
    findings.push({
      id: 'no-bidir',
      severity: 'info',
      category: 'config',
      title: L.noBidir.title,
      detail: L.noBidir.detail,
      evidence: L.noBidir.evidence(v['motor_pwm_protocol'], bidir === 0),
      fix: {
        text: L.noBidir.fix,
        cli: ['set dshot_bidir = ON', 'set rpm_filter_harmonics = 3'],
      },
    });
  }

  // no-notch-no-rpm - plus aucun filtrage adaptatif.
  if (notchCount === 0 && rpmHarmonics === 0) {
    findings.push({
      id: 'no-notch-no-rpm',
      severity: 'crit',
      category: 'config',
      title: L.noNotchNoRpm.title,
      detail: L.noNotchNoRpm.detail,
      evidence: L.noNotchNoRpm.evidence,
      fix: {
        text: L.noNotchNoRpm.fix,
        cli: ['set dyn_notch_count = 3', 'set rpm_filter_harmonics = 3'],
      },
    });
  }

  // filter-coverage-suspect - couverture de filtrage insuffisante AU REGARD
  // d'un symptôme observé. Ni un dyn_notch_count bas ni des fondamentales dans
  // la zone de fade du filtre RPM ne sont des défauts en soi : count=1 avec le
  // filtre RPM actif est un choix courant, et le fade est le comportement par
  // défaut de Betaflight. Mesurés sur des drones sains du parc, les deux sont
  // présents sans aucune conséquence. Ils ne deviennent une piste que pour
  // EXPLIQUER une oscillation ou un bruit qui atteint déjà la boucle.
  {
    const osc = analysis?.oscillation?.worst ?? null;
    const oscConfirmed =
      osc !== null &&
      osc.ratio >= profile.thresholds.oscRatioWarn &&
      osc.peakAmpPct >= profile.thresholds.oscMinAmpPct;
    const noisy = (analysis?.noise?.axes ?? []).some(
      (a) => a.filtRms >= profile.thresholds.filtNoiseWarn,
    );

    const fadeTop = rpmFadeTopHz(num('rpm_filter_min_hz'), num('rpm_filter_fade_range_hz'));
    const perMotor = analysis?.spectrum?.perMotorHz ?? null;
    const faded =
      fadeTop !== null && perMotor && rpmHarmonics !== 0
        ? perMotor
            .map((m, i) => ({ motor: i + 1, hz: m.median }))
            .filter((m) => m.hz > 0 && m.hz < fadeTop)
        : [];
    const notchLow =
      notchCount !== null && notchCount > 0 && notchCount < DEFAULT_NOTCH_COUNT ? notchCount : null;

    if ((oscConfirmed || noisy) && (faded.length > 0 || notchLow !== null)) {
      const cli: string[] = [];
      if (notchLow !== null) cli.push(`set dyn_notch_count = ${DEFAULT_NOTCH_COUNT}`);
      if (faded.length > 0) {
        const lowest = Math.min(...faded.map((m) => m.hz));
        cli.push(`set rpm_filter_min_hz = ${Math.max(0, Math.floor((lowest - 10) / 10) * 10)}`);
        cli.push('set rpm_filter_fade_range_hz = 20');
      }
      findings.push({
        id: 'filter-coverage-suspect',
        severity: 'warn',
        category: 'config',
        title: L.filterCoverageSuspect.title,
        detail: L.filterCoverageSuspect.detail,
        evidence: L.filterCoverageSuspect.evidence(
          faded.length > 0
            ? faded.map((m) => `M${m.motor} ${m.hz.toFixed(0)} Hz`).join(', ')
            : null,
          fadeTop !== null ? fadeTop.toFixed(0) : null,
          notchLow !== null ? String(notchLow) : null,
          DEFAULT_NOTCH_COUNT,
        ),
        fix: { text: L.filterCoverageSuspect.fix, cli },
      });
    }
  }

  // tpa-never-reached - le vol s'est fait entièrement sous le breakpoint : TPA
  // n'a jamais rien atténué, inutile d'y chercher la cause d'une oscillation.
  {
    const breakpoint = num('tpa_breakpoint');
    const thrMax = analysis?.timeline?.throttleMaxUs ?? null;
    // thrMax === 0 : lien partagé émis avant que la métrique existe, on se tait.
    if (breakpoint !== null && breakpoint > 1000 && thrMax !== null && thrMax > 0 && thrMax < breakpoint) {
      findings.push({
        id: 'tpa-never-reached',
        severity: 'info',
        category: 'config',
        title: L.tpaNeverReached.title,
        detail: L.tpaNeverReached.detail,
        evidence: L.tpaNeverReached.evidence(thrMax.toFixed(0), breakpoint.toFixed(0)),
      });
    }
  }

  // dterm-lpf-low - LPF1 D-term statique très bas = latence D élevée.
  const dtermLpf = num('dterm_lpf1_static_hz');
  if (dtermLpf !== null && dtermLpf > 0 && dtermLpf < 70) {
    findings.push({
      id: 'dterm-lpf-low',
      severity: 'warn',
      category: 'config',
      title: L.dtermLpfLow.title,
      detail: L.dtermLpfLow.detail(String(dtermLpf)),
      evidence: L.dtermLpfLow.evidence(String(dtermLpf)),
      fix: {
        text: L.dtermLpfLow.fix,
        cli: ['set dterm_lpf1_static_hz = 75'],
      },
    });
  }

  // gyro-lpf-low - LPF gyro statique bas alors que le filtre RPM fait déjà le travail.
  const gyroLpfKey = v['gyro_lpf1_static_hz'] !== undefined ? 'gyro_lpf1_static_hz' : 'gyro_lowpass_hz';
  const gyroLpf = num(gyroLpfKey);
  if (gyroLpf !== null && gyroLpf > 0 && gyroLpf < 150 && rpmHarmonics !== null && rpmHarmonics > 0) {
    findings.push({
      id: 'gyro-lpf-low',
      severity: 'info',
      category: 'config',
      title: L.gyroLpfLow.title,
      detail: L.gyroLpfLow.detail(String(rpmHarmonics), String(gyroLpf)),
      evidence: L.gyroLpfLow.evidence(gyroLpfKey, String(gyroLpf), String(rpmHarmonics)),
      fix: {
        text: L.gyroLpfLow.fix,
        cli: [`set ${gyroLpfKey} = 250`],
      },
    });
  }

  // ff-zero - feedforward coupé sur tous les axes renseignés.
  const ffKeys = ['f_roll', 'f_pitch', 'f_yaw', 'ff_weight'];
  const ffPresent = ffKeys.filter((k) => v[k] !== undefined);
  if (ffPresent.length > 0 && ffPresent.every((k) => num(k) === 0)) {
    findings.push({
      id: 'ff-zero',
      severity: 'info',
      category: 'config',
      title: L.ffZero.title,
      detail: L.ffZero.detail,
      evidence: ffPresent.map((k) => `${k} = ${v[k]}`).join(', '),
      fix: { text: L.ffZero.fix },
    });
  }

  // antigravity-off - I-term non boosté sur les coups de gaz.
  if (num('anti_gravity_gain') === 0) {
    findings.push({
      id: 'antigravity-off',
      severity: 'info',
      category: 'config',
      title: L.antigravityOff.title,
      detail: L.antigravityOff.detail,
      evidence: L.antigravityOff.evidence,
      fix: { text: L.antigravityOff.fix, cli: ['set anti_gravity_gain = 80'] },
    });
  }

  // motor-limit - une limite de sortie moteur est active.
  const motorLimit = num('motor_output_limit');
  if (motorLimit !== null && motorLimit < 100) {
    findings.push({
      id: 'motor-limit',
      severity: 'info',
      category: 'config',
      title: L.motorLimit.title,
      detail: L.motorLimit.detail(String(motorLimit)),
      evidence: L.motorLimit.evidence(String(motorLimit)),
    });
  }

  // vbat-warning - seuil d'alerte batterie hors plage usuelle.
  const vbatWarnRaw = num('vbat_warning_cell_voltage');
  if (vbatWarnRaw !== null) {
    const volts = vbatWarnRaw > 10 ? vbatWarnRaw / 100 : vbatWarnRaw; // CLI en centivolts (350 = 3.50 V)
    if (volts < 3.2 || volts > 3.6) {
      findings.push({
        id: 'vbat-warning',
        severity: 'info',
        category: 'config',
        title: L.vbatWarning.title,
        detail: L.vbatWarning.detail(volts.toFixed(2)),
        evidence: L.vbatWarning.evidence(v['vbat_warning_cell_voltage'], volts.toFixed(2)),
        fix: { text: L.vbatWarning.fix, cli: ['set vbat_warning_cell_voltage = 350'] },
      });
    }
  }

  // NB : le contrôle du nombre de cellules vs profil vit dans le moteur de
  // règles (battery-cells-unexpected, engine.ts) - le dupliquer ici produisait
  // deux findings pour la même anomalie dans chaque rapport.

  return findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

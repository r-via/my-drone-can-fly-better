// Parsing + lint de configuration CLI Betaflight.
// Deux sources : un `diff all`/`dump` collé par l'utilisateur, ou le snapshot
// config embarqué dans les headers du .bbl. Le lint applique des règles
// déterministes et retourne des Finding (catégorie 'config') chiffrés.
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
// parseCliText — diff all / dump collé
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
// configFromHeaders — snapshot config embarqué dans le .bbl
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
// lintConfig — règles déterministes
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
): Finding[] {
  const v = config.values;
  const findings: Finding[] = [];
  const num = (key: string): number | null => parseNum(v[key]);

  const bidir = num('dshot_bidir');
  const rpmHarmonics = num('rpm_filter_harmonics');
  const notchCount = num('dyn_notch_count');
  const dshot = isDshotProtocol(v['motor_pwm_protocol']);

  // rpm-filter-off-bidir — le retour eRPM est là mais le filtre RPM est coupé.
  if (bidir === 1 && rpmHarmonics === 0) {
    findings.push({
      id: 'rpm-filter-off-bidir',
      severity: 'warn',
      category: 'config',
      title: 'Filtre RPM désactivé alors que le DShot bidirectionnel est actif',
      detail:
        "Tu as le retour eRPM (dshot_bidir = ON) mais le filtre RPM est coupé. Tu paies le coût du DShot bidir sans profiter du meilleur filtre anti-bruit moteur disponible.",
      evidence: `dshot_bidir = ON, rpm_filter_harmonics = 0`,
      fix: {
        text: 'Réactive le filtre RPM (3 harmoniques = valeur par défaut).',
        cli: ['set rpm_filter_harmonics = 3'],
      },
    });
  }

  // no-bidir — protocole DSHOT mais pas de retour eRPM.
  if (dshot === true && bidir !== 1) {
    findings.push({
      id: 'no-bidir',
      severity: 'info',
      category: 'config',
      title: 'DShot bidirectionnel désactivé',
      detail:
        "Ton protocole moteur est DShot mais sans retour eRPM. Active le bidir pour débloquer le filtre RPM : bruit moteur nettoyé à la source, LPF gyro/D-term plus hauts, moins de latence (firmware ESC BLHeli_32, Bluejay ou AM32 requis).",
      evidence: `motor_pwm_protocol = ${v['motor_pwm_protocol']}, dshot_bidir = ${bidir === 0 ? 'OFF' : 'absent'}`,
      fix: {
        text: 'Active le DShot bidirectionnel puis le filtre RPM.',
        cli: ['set dshot_bidir = ON', 'set rpm_filter_harmonics = 3'],
      },
    });
  }

  // no-notch-no-rpm — plus aucun filtrage adaptatif.
  if (notchCount === 0 && rpmHarmonics === 0) {
    findings.push({
      id: 'no-notch-no-rpm',
      severity: 'crit',
      category: 'config',
      title: 'Aucun filtrage adaptatif actif',
      detail:
        "Dynamic notch ET filtre RPM désactivés : seuls les LPF statiques protègent tes PID du bruit moteur. Risque réel de moteurs chauds, de D-term saturé et d'oscillations à haut régime.",
      evidence: `dyn_notch_count = 0, rpm_filter_harmonics = 0`,
      fix: {
        text: 'Réactive au moins un des deux (filtre RPM si DShot bidir dispo, sinon dynamic notch).',
        cli: ['set dyn_notch_count = 3', 'set rpm_filter_harmonics = 3'],
      },
    });
  }

  // dterm-lpf-low — LPF1 D-term statique très bas = latence D élevée.
  const dtermLpf = num('dterm_lpf1_static_hz');
  if (dtermLpf !== null && dtermLpf > 0 && dtermLpf < 70) {
    findings.push({
      id: 'dterm-lpf-low',
      severity: 'warn',
      category: 'config',
      title: 'LPF1 D-term très bas',
      detail:
        `Un LPF1 D-term à ${dtermLpf} Hz ajoute beaucoup de latence sur le D : amortissement mou et prop wash amplifié. Sous 70 Hz, c'est rarement justifié sur un quad sain.`,
      evidence: `dterm_lpf1_static_hz = ${dtermLpf}`,
      fix: {
        text: 'Remonte le LPF1 D-term vers 75-90 Hz (ou repasse en mode dynamique).',
        cli: ['set dterm_lpf1_static_hz = 75'],
      },
    });
  }

  // gyro-lpf-low — LPF gyro statique bas alors que le filtre RPM fait déjà le travail.
  const gyroLpfKey = v['gyro_lpf1_static_hz'] !== undefined ? 'gyro_lpf1_static_hz' : 'gyro_lowpass_hz';
  const gyroLpf = num(gyroLpfKey);
  if (gyroLpf !== null && gyroLpf > 0 && gyroLpf < 150 && rpmHarmonics !== null && rpmHarmonics > 0) {
    findings.push({
      id: 'gyro-lpf-low',
      severity: 'info',
      category: 'config',
      title: 'LPF gyro conservateur malgré le filtre RPM',
      detail:
        `Avec le filtre RPM actif (${rpmHarmonics} harmoniques), un LPF1 gyro statique à ${gyroLpf} Hz est probablement trop bas : tu ajoutes de la latence pour du bruit déjà traité.`,
      evidence: `${gyroLpfKey} = ${gyroLpf}, rpm_filter_harmonics = ${rpmHarmonics}`,
      fix: {
        text: 'Essaie de remonter le LPF1 gyro (250 Hz par défaut) et vérifie le bruit résiduel au vol suivant.',
        cli: [`set ${gyroLpfKey} = 250`],
      },
    });
  }

  // ff-zero — feedforward coupé sur tous les axes renseignés.
  const ffKeys = ['f_roll', 'f_pitch', 'f_yaw', 'ff_weight'];
  const ffPresent = ffKeys.filter((k) => v[k] !== undefined);
  if (ffPresent.length > 0 && ffPresent.every((k) => num(k) === 0)) {
    findings.push({
      id: 'ff-zero',
      severity: 'info',
      category: 'config',
      title: 'Feedforward à zéro',
      detail:
        "Sans feedforward, le quad ne réagit qu'à l'erreur déjà installée : la réponse stick est retardée. Ok pour du cinématique très lisse, pénalisant en freestyle/race.",
      evidence: ffPresent.map((k) => `${k} = ${v[k]}`).join(', '),
      fix: { text: 'Remets du feedforward (≈100-125 en 4.5) si tu veux une réponse stick directe.' },
    });
  }

  // antigravity-off — I-term non boosté sur les coups de gaz.
  if (num('anti_gravity_gain') === 0) {
    findings.push({
      id: 'antigravity-off',
      severity: 'info',
      category: 'config',
      title: 'Anti-gravity désactivé',
      detail:
        "anti_gravity_gain = 0 : l'I-term n'est pas boosté pendant les variations rapides de gaz, le nez peut plonger ou pomper sur les punchs.",
      evidence: 'anti_gravity_gain = 0',
      fix: { text: 'Remets la valeur par défaut si ce n\'est pas un choix délibéré.', cli: ['set anti_gravity_gain = 80'] },
    });
  }

  // motor-limit — une limite de sortie moteur est active.
  const motorLimit = num('motor_output_limit');
  if (motorLimit !== null && motorLimit < 100) {
    findings.push({
      id: 'motor-limit',
      severity: 'info',
      category: 'config',
      title: 'Limite de sortie moteur active',
      detail:
        `motor_output_limit = ${motorLimit}% : la poussée max est bridée. Simple rappel au cas où ce n'est pas voulu (souvent utilisé pour voler avec une batterie de voltage supérieur).`,
      evidence: `motor_output_limit = ${motorLimit}`,
    });
  }

  // vbat-warning — seuil d'alerte batterie hors plage usuelle.
  const vbatWarnRaw = num('vbat_warning_cell_voltage');
  if (vbatWarnRaw !== null) {
    const volts = vbatWarnRaw > 10 ? vbatWarnRaw / 100 : vbatWarnRaw; // CLI en centivolts (350 = 3.50 V)
    if (volts < 3.2 || volts > 3.6) {
      findings.push({
        id: 'vbat-warning',
        severity: 'info',
        category: 'config',
        title: "Seuil d'alerte batterie inhabituel",
        detail:
          `Alerte batterie réglée à ${volts.toFixed(2)} V/cellule, hors de la plage usuelle 3.2-3.6 V : tu seras prévenu trop tôt ou trop tard.`,
        evidence: `vbat_warning_cell_voltage = ${v['vbat_warning_cell_voltage']} (${volts.toFixed(2)} V/cellule)`,
        fix: { text: 'Vise 3.4-3.5 V/cellule pour un usage LiPo classique.', cli: ['set vbat_warning_cell_voltage = 350'] },
      });
    }
  }

  // cells-mismatch — la batterie branchée ne colle pas au profil.
  if (analysis?.power && profile.expectedCells !== null && analysis.power.cells !== profile.expectedCells) {
    findings.push({
      id: 'cells-mismatch',
      severity: 'warn',
      category: 'config',
      title: 'Nombre de cellules inattendu',
      detail:
        `Le log montre du ${analysis.power.cells}S alors que le profil ${profile.label} attend du ${profile.expectedCells}S. Mauvaise batterie branchée, ou profil mal détecté ?`,
      evidence: `${analysis.power.cells}S détecté (vbat max ${analysis.power.vbatMax.toFixed(2)} V), attendu ${profile.expectedCells}S`,
    });
  }

  return findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

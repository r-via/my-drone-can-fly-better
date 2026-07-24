// Orchestrateur : ParsedFile[] → Report complet.
import { analyzeControlLoss } from './analysis/control';
import { analyzeYoyo, analyzePropwash } from './analysis/flight';
import { analyzeOscillation } from './analysis/oscillation';
import {
  analyzeFailsafe,
  analyzeGps,
  analyzeMotors,
  analyzeNoise,
  analyzePower,
  analyzeTemperature,
  analyzeTimeline,
  analyzeTracking,
} from './analysis/basic';
import { analyzeSpectrum, analyzeFilters } from './analysis/spectrum';
import { analyzeStepResponse } from './analysis/step';
import { configFromHeaders, lintConfig, parseNum } from './cli/config';
import { fr } from './i18n/fr';
import { evaluateSession } from './rules/engine';
import { pickProfile } from './rules/profiles';

import type { Dict } from './i18n/fr';
import type {
  CliConfig,
  DroneProfile,
  FileReport,
  Finding,
  FlightData,
  ParsedFile,
  Report,
  SessionAnalysis,
  SessionReport,
  Severity,
} from './types';

const SEVERITY_ORDER: Record<Severity, number> = { crit: 0, warn: 1, info: 2, ok: 3 };

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.category.localeCompare(b.category),
  );
}

export function analyzeFlightData(fd: FlightData, motorPoles: number): SessionAnalysis {
  return {
    meta: fd.meta,
    power: analyzePower(fd),
    motors: analyzeMotors(fd),
    noise: analyzeNoise(fd),
    spectrum: analyzeSpectrum(fd, motorPoles),
    tracking: analyzeTracking(fd),
    step: analyzeStepResponse(fd),
    yoyo: analyzeYoyo(fd),
    propwash: analyzePropwash(fd),
    oscillation: analyzeOscillation(fd),
    controlLoss: analyzeControlLoss(fd),
    temperature: analyzeTemperature(fd),
    filters: analyzeFilters(fd),
    timeline: analyzeTimeline(fd),
    gps: analyzeGps(fd),
    failsafe: analyzeFailsafe(fd),
  };
}

/**
 * Constat affiché sur toute session INAV : les métriques de vol sont analysées
 * normalement, mais le lint de config et les lignes CLI parlent Betaflight.
 * scoreExempt : c'est une limite de l'outil, pas un défaut du vol.
 */
function inavLimitedFinding(analysis: SessionAnalysis, dict: Dict): Finding {
  return {
    id: 'inav-limited',
    severity: 'info',
    category: 'log',
    title: dict.rules.inavLimited.title,
    detail: dict.rules.inavLimited.detail,
    evidence: dict.rules.inavLimited.evidence(analysis.meta.firmware),
    scoreExempt: true,
  };
}

/**
 * Verdicts d'une session à partir de ses seules métriques. Isolé de
 * buildSessionReport pour que le décodage d'un lien partagé (share/codec.ts)
 * rejoue exactement le même pipeline, sans avoir besoin du FlightData.
 */
export function composeFindings(
  analysis: SessionAnalysis,
  profile: DroneProfile,
  config: CliConfig,
  dict: Dict = fr,
): Finding[] {
  // Session INAV : le snapshot config et les conseils CLI sont du vocabulaire
  // Betaflight. Plutôt que de publier des commandes fausses, on coupe le lint
  // et les lignes CLI (config null) et on l'annonce par un constat dédié.
  const inav = analysis.meta.firmwareFamily === 'inav';
  const findings = sortFindings([
    ...evaluateSession(analysis, profile, dict, inav ? null : config),
    ...(inav ? [inavLimitedFinding(analysis, dict)] : lintConfig(config, profile, analysis, dict)),
  ]);
  // « Tout est propre » (émis par le moteur, qui ne voit pas le lint config)
  // n'a plus sa place si le lint a trouvé des warn/crit dans le même rapport.
  if (findings.some((f) => f.severity === 'warn' || f.severity === 'crit')) {
    return findings.filter((f) => f.id !== 'all-good');
  }
  return findings;
}

export function buildSessionReport(fd: FlightData, dict: Dict = fr): SessionReport {
  const profile = pickProfile(fd.meta.craftName);
  // Nombre de pôles : le header d'abord, le profil en secours. motor_poles est
  // la valeur que le filtre RPM du FC utilise pour convertir l'eRPM, c'est donc
  // LA référence pour retrouver la fondamentale moteur en Hz. Mesuré sur
  // btfl_all2 (craft inconnu → profil generic, 14 pôles supposés, header à 12) :
  // pic dominant 356 Hz attribué à 51 Hz de M3 avec les pôles du profil, à
  // 0.6 Hz avec ceux du header - motor-noise-peak restait muet sur un balourd
  // pourtant nominatif. Le secours profil couvre INAV et les logs sans header.
  const headerPoles = parseNum(fd.meta.headers['motor_poles']);
  const motorPoles = headerPoles !== null && headerPoles >= 4 ? headerPoles : profile.motorPoles;
  const analysis = analyzeFlightData(fd, motorPoles);
  const config = configFromHeaders(fd.meta.headers);
  return { analysis, profile, findings: composeFindings(analysis, profile, config, dict) };
}

export function buildReport(files: ParsedFile[], dict: Dict = fr): Report {
  const fileReports: FileReport[] = files.map((pf) => ({
    fileName: pf.fileName,
    sessionReports: pf.sessions.map((fd) => buildSessionReport(fd, dict)),
    skipped: pf.skipped,
  }));

  return { files: fileReports };
}

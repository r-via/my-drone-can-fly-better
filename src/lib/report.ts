// Orchestrateur : ParsedFile[] + diff CLI éventuel → Report complet.
import { analyzeYoyo, analyzePropwash } from './analysis/flight';
import {
  analyzeFailsafe,
  analyzeGps,
  analyzeMotors,
  analyzeNoise,
  analyzePower,
  analyzeTimeline,
  analyzeTracking,
} from './analysis/basic';
import { analyzeSpectrum, analyzeFilters } from './analysis/spectrum';
import { analyzeStepResponse } from './analysis/step';
import { configFromHeaders, lintConfig, parseCliText } from './cli/config';
import { evaluateSession } from './rules/engine';
import { pickProfile } from './rules/profiles';

import type {
  CliConfig,
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
    filters: analyzeFilters(fd),
    timeline: analyzeTimeline(fd),
    gps: analyzeGps(fd),
    failsafe: analyzeFailsafe(fd),
  };
}

export function buildSessionReport(fd: FlightData, pasteConfig: CliConfig | null): SessionReport {
  const profile = pickProfile(fd.meta.craftName);
  const analysis = analyzeFlightData(fd, profile.motorPoles);
  const config = pasteConfig ?? configFromHeaders(fd.meta.headers);
  const findings = sortFindings([
    ...evaluateSession(analysis, profile),
    ...lintConfig(config, profile, analysis),
  ]);
  return { analysis, profile, findings };
}

export function buildReport(files: ParsedFile[], cliText: string): Report {
  const pasteConfig = cliText.trim().length > 0 ? parseCliText(cliText) : null;

  const fileReports: FileReport[] = files.map((pf) => ({
    fileName: pf.fileName,
    sessionReports: pf.sessions.map((fd) => buildSessionReport(fd, pasteConfig)),
    skipped: pf.skipped,
  }));

  // Lint global du diff collé sans contexte de session (utile si collé sans .bbl,
  // ou pour les règles indépendantes du vol).
  const configFindings =
    pasteConfig && files.every((f) => f.sessions.length === 0)
      ? sortFindings(lintConfig(pasteConfig, pickProfile(undefined), null))
      : [];

  return { files: fileReports, config: pasteConfig, configFindings };
}

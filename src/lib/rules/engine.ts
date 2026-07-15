// Moteur de règles déterministe : transforme une SessionAnalysis en Findings
// selon les seuils du profil drone. Zéro IA : uniquement des comparaisons
// chiffrées, chaque verdict cite ses chiffres dans evidence.
// Toutes les chaînes utilisateur viennent du dictionnaire i18n (dict.rules) ;
// sans dict explicite, la référence française est utilisée (comportement legacy).

import { fr } from '../i18n/fr';
import { AXIS_NAMES } from '../types';
import type { Dict } from '../i18n/fr';
import type {
  Axis,
  DroneProfile,
  Finding,
  SessionAnalysis,
  Severity,
} from '../types';

const f0 = (x: number): string => x.toFixed(0);
const f1 = (x: number): string => x.toFixed(1);
const f2 = (x: number): string => x.toFixed(2);

const SEVERITY_RANK: Record<Severity, number> = { crit: 0, warn: 1, info: 2, ok: 3 };

interface WorstAxis {
  axis: Axis;
  value: number;
}

/** Pire axe (valeur max), en ignorant les null. */
function worstAxis(values: ReadonlyArray<number | null>): WorstAxis | null {
  let best: WorstAxis | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== null && (best === null || v > best.value)) {
      best = { axis: i as Axis, value: v };
    }
  }
  return best;
}

/** warn/crit si la valeur dépasse les seuils, null sinon. */
function sevAbove(value: number, warn: number, crit: number): Severity | null {
  if (value >= crit) return 'crit';
  if (value >= warn) return 'warn';
  return null;
}

/** Atténuation moyenne (dB) dans [lo, hi], pondérée par le recouvrement des bandes. */
function attenuationInBand(
  entries: Array<{ lo: number; hi: number; db: number }>,
  lo: number,
  hi: number,
): number | null {
  let wSum = 0;
  let dbSum = 0;
  for (const e of entries) {
    const overlap = Math.min(hi, e.hi) - Math.max(lo, e.lo);
    if (overlap > 0) {
      wSum += overlap;
      dbSum += e.db * overlap;
    }
  }
  return wSum > 0 ? dbSum / wSum : null;
}

/** Liste "Roll 7.0 / Pitch 12.7 / Yaw 9.6" à partir des 3 axes. */
function perAxisList(values: ReadonlyArray<number | null>, digits = 1): string {
  return values
    .map((v, i) => `${AXIS_NAMES[i]} ${v === null ? 'n/a' : v.toFixed(digits)}`)
    .join(' / ');
}

export function evaluateSession(
  analysis: SessionAnalysis,
  profile: DroneProfile,
  dict: Dict = fr,
): Finding[] {
  const t = profile.thresholds;
  const r = dict.rules;
  const profileLabel = r.profiles[profile.id].label;
  const findings: Finding[] = [];

  const worstUnfilt = worstAxis(analysis.noise.axes.map((a) => a.unfiltRms));
  const worstFilt = worstAxis(analysis.noise.axes.map((a) => a.filtRms));

  // --- noise-mech-high : vibrations mécaniques (gyro brut) ------------------
  if (worstUnfilt) {
    const sev = sevAbove(worstUnfilt.value, t.unfiltNoiseWarn, t.unfiltNoiseCrit);
    if (sev) {
      findings.push({
        id: 'noise-mech-high',
        severity: sev,
        category: 'vibrations',
        title: r.noiseMechHigh.title,
        detail: r.noiseMechHigh.detail(AXIS_NAMES[worstUnfilt.axis]),
        evidence: r.noiseMechHigh.evidence(
          perAxisList(analysis.noise.axes.map((a) => a.unfiltRms)),
          t.unfiltNoiseWarn,
          t.unfiltNoiseCrit,
        ),
        fix: { text: r.noiseMechHigh.fix },
      });
    }
  }

  // --- noise-filtered-leak : le bruit atteint la boucle PID -----------------
  if (worstFilt) {
    const sev = sevAbove(worstFilt.value, t.filtNoiseWarn, t.filtNoiseCrit);
    if (sev) {
      findings.push({
        id: 'noise-filtered-leak',
        severity: sev,
        category: 'filtres',
        title: r.noiseFilteredLeak.title,
        detail: r.noiseFilteredLeak.detail(AXIS_NAMES[worstFilt.axis]),
        evidence: r.noiseFilteredLeak.evidence(
          perAxisList(analysis.noise.axes.map((a) => a.filtRms)),
          t.filtNoiseWarn,
          t.filtNoiseCrit,
        ),
        fix: { text: r.noiseFilteredLeak.fix },
      });
    }
  }

  // --- chassis-resonance : énergie concentrée en 40-120 Hz ------------------
  if (analysis.spectrum) {
    const hits: string[] = [];
    analysis.spectrum.axes.forEach((ax, i) => {
      const resBand = ax.bands.find((b) => b.label.includes('40-120'));
      const motorBand = ax.bands.find((b) => b.label.includes('120-350'));
      if (
        resBand &&
        motorBand &&
        ax.dominantBand.includes('40-120') &&
        resBand.rms > 1.5 * motorBand.rms
      ) {
        hits.push(
          r.chassisResonance.evidenceHit(AXIS_NAMES[i], f0(resBand.rms), f0(motorBand.rms)),
        );
      }
    });
    if (hits.length > 0) {
      const dp = analysis.spectrum.dominantPeak;
      const peakInfo = dp
        ? r.chassisResonance.evidencePeak(
            f0(dp.freqHz),
            AXIS_NAMES[dp.axis],
            `M${dp.nearestMotor + 1}`,
            f0(dp.distanceHz),
          )
        : '';
      findings.push({
        id: 'chassis-resonance',
        severity: 'warn',
        category: 'vibrations',
        title: r.chassisResonance.title,
        detail: r.chassisResonance.detail,
        evidence: hits.join(' ; ') + peakInfo,
        fix: { text: r.chassisResonance.fix },
      });
    }
  }

  // --- motor-noise-peak : pic dominant à la fondamentale d'un moteur --------
  const dp = analysis.spectrum?.dominantPeak;
  if (dp && dp.distanceHz < 30) {
    // nearestMotor est un index 0-based → affichage M1..M4
    const motorLabel = `M${dp.nearestMotor + 1}`;
    let rpmNote = '';
    if (!analysis.motors.erpmAvailable) {
      rpmNote = r.motorNoisePeak.rpmNoteNoErpm;
    } else if (analysis.filters.available && analysis.filters.axes) {
      const attPeakAxis = attenuationInBand(
        analysis.filters.axes[dp.axis].attenuationDb,
        120,
        350,
      );
      if (attPeakAxis !== null && attPeakAxis < 15) {
        rpmNote = r.motorNoisePeak.rpmNoteWeakAttenuation(f1(attPeakAxis));
      }
    }
    const sev: Severity =
      worstUnfilt !== null && worstUnfilt.value >= t.unfiltNoiseWarn ? 'warn' : 'info';
    findings.push({
      id: 'motor-noise-peak',
      severity: sev,
      category: 'vibrations',
      title: r.motorNoisePeak.title(motorLabel),
      detail: r.motorNoisePeak.detail(motorLabel, rpmNote),
      evidence: r.motorNoisePeak.evidence(
        f0(dp.freqHz),
        AXIS_NAMES[dp.axis],
        f0(dp.distanceHz),
        motorLabel,
      ),
      fix: { text: r.motorNoisePeak.fix(motorLabel) },
    });
  }

  // --- filters-weak : atténuation insuffisante dans la plage moteur ---------
  if (analysis.filters.available && analysis.filters.axes) {
    const atts = analysis.filters.axes.map((ax) => attenuationInBand(ax.attenuationDb, 120, 350));
    let weakest: WorstAxis | null = null;
    for (let i = 0; i < atts.length; i++) {
      const a = atts[i];
      if (a !== null && (weakest === null || a < weakest.value)) {
        weakest = { axis: i as Axis, value: a };
      }
    }
    if (weakest && weakest.value < 15) {
      findings.push({
        id: 'filters-weak',
        severity: 'warn',
        category: 'filtres',
        title: r.filtersWeak.title,
        detail: r.filtersWeak.detail(f1(weakest.value), AXIS_NAMES[weakest.axis]),
        evidence: r.filtersWeak.evidence(perAxisList(atts)),
        fix: { text: r.filtersWeak.fix },
      });
    }

    // --- filters-residual-hf : fuite HF vers les moteurs --------------------
    const worstHf = worstAxis(analysis.filters.axes.map((ax) => ax.residualHfRms));
    if (worstHf && worstHf.value > t.residualHfWarn) {
      findings.push({
        id: 'filters-residual-hf',
        severity: 'warn',
        category: 'filtres',
        title: r.filtersResidualHf.title,
        detail: r.filtersResidualHf.detail(AXIS_NAMES[worstHf.axis]),
        evidence: r.filtersResidualHf.evidence(
          perAxisList(analysis.filters.axes.map((ax) => ax.residualHfRms)),
          t.residualHfWarn,
        ),
        fix: { text: r.filtersResidualHf.fix },
      });
    }
  }

  // --- tracking-poor : erreur de suivi ---------------------------------------
  const worstTrack = worstAxis(analysis.tracking.axes.map((a) => a.meanAbsErr));
  if (worstTrack) {
    const sev = sevAbove(worstTrack.value, t.trackingWarn, t.trackingCrit);
    if (sev) {
      const noiseLow = worstFilt === null || worstFilt.value < t.filtNoiseWarn;
      const advice = noiseLow ? r.trackingPoor.adviceCleanGyro : r.trackingPoor.adviceNoisyGyro;
      findings.push({
        id: 'tracking-poor',
        severity: sev,
        category: 'pid',
        title: r.trackingPoor.title,
        detail: r.trackingPoor.detail(AXIS_NAMES[worstTrack.axis], advice),
        evidence: r.trackingPoor.evidence(
          perAxisList(analysis.tracking.axes.map((a) => a.meanAbsErr)),
          t.trackingWarn,
          t.trackingCrit,
        ),
        fix: {
          text: noiseLow
            ? r.trackingPoor.fixCleanGyro(AXIS_NAMES[worstTrack.axis])
            : r.trackingPoor.fixNoisyGyro,
        },
      });
    }
  }

  // --- step-overshoot / step-slow / step-settle-off --------------------------
  if (analysis.step) {
    // En dessous de ~30 % de fenêtres excitées, la déconvolution sort du bruit
    // (mesuré sur lr4 s6 : quality 0.07 → overshoot fantôme de 163 %). On ne
    // juge que les axes fiables, avec mention de confiance entre 30 et 50 %.
    const MIN_STEP_QUALITY = 0.3;
    const stepAxes = analysis.step.axes.map((ax) => (ax && ax.quality >= MIN_STEP_QUALITY ? ax : null));
    const qualityNote = (axis: Axis): string => {
      const q = stepAxes[axis]?.quality ?? 0;
      return q < 0.5 ? r.step.qualityNote(Math.round(q * 100)) : '';
    };
    const overshoots = stepAxes.map((ax) => (ax ? ax.overshootPct : null));
    const worstOver = worstAxis(overshoots);
    if (worstOver && worstOver.value >= t.overshootWarn) {
      findings.push({
        id: 'step-overshoot',
        severity: 'warn',
        category: 'pid',
        title: r.stepOvershoot.title(AXIS_NAMES[worstOver.axis]),
        detail: r.stepOvershoot.detail,
        evidence: r.stepOvershoot.evidence(
          perAxisList(overshoots, 0),
          t.overshootWarn,
          qualityNote(worstOver.axis),
        ),
        fix: { text: r.stepOvershoot.fix(AXIS_NAMES[worstOver.axis]) },
      });
    }

    const rises = stepAxes.map((ax) => (ax ? ax.riseTimeMs : null));
    const worstRise = worstAxis(rises);
    if (worstRise && worstRise.value >= t.riseTimeSlowMs) {
      let filterNote = r.stepSlow.filterNoteGainsLow;
      if (analysis.filters.available && analysis.filters.axes) {
        const att = attenuationInBand(analysis.filters.axes[worstRise.axis].attenuationDb, 120, 350);
        if (att !== null && att > 30) {
          filterNote = r.stepSlow.filterNoteAggressive(f1(att));
        }
      }
      findings.push({
        id: 'step-slow',
        severity: 'warn',
        category: 'pid',
        title: r.stepSlow.title(AXIS_NAMES[worstRise.axis]),
        detail: r.stepSlow.detail(filterNote),
        evidence: r.stepSlow.evidence(
          perAxisList(rises, 0),
          t.riseTimeSlowMs,
          qualityNote(worstRise.axis),
        ),
        fix: { text: r.stepSlow.fix },
      });
    }

    for (let i = 0; i < stepAxes.length; i++) {
      const ax = stepAxes[i];
      if (ax && ax.settleValue !== null && (ax.settleValue < 0.85 || ax.settleValue > 1.15)) {
        findings.push({
          id: 'step-settle-off',
          severity: 'warn',
          category: 'pid',
          title: r.stepSettleOff.title(AXIS_NAMES[i]),
          detail: r.stepSettleOff.detail,
          evidence: r.stepSettleOff.evidence(
            AXIS_NAMES[i],
            f2(ax.settleValue),
            qualityNote(i as Axis),
          ),
          fix: { text: r.stepSettleOff.fix(AXIS_NAMES[i]) },
        });
        break; // un seul finding, sur le premier axe fautif (id stable, pas de doublon)
      }
    }
  }

  // --- motors-saturation ------------------------------------------------------
  {
    const sev = sevAbove(analysis.motors.saturationPct, t.saturationWarn, t.saturationCrit);
    if (sev) {
      findings.push({
        id: 'motors-saturation',
        severity: sev,
        category: 'moteurs',
        title: r.motorsSaturation.title,
        detail: r.motorsSaturation.detail,
        evidence: r.motorsSaturation.evidence(
          f2(analysis.motors.saturationPct),
          t.saturationWarn,
          t.saturationCrit,
        ),
        fix: { text: r.motorsSaturation.fix },
      });
    }
  }

  // --- motors-imbalance -------------------------------------------------------
  if (analysis.motors.imbalancePctPts >= t.imbalanceWarn) {
    const per = analysis.motors.perMotorAvgPct;
    let hi = 0;
    let lo = 0;
    for (let i = 1; i < 4; i++) {
      if (per[i] > per[hi]) hi = i;
      if (per[i] < per[lo]) lo = i;
    }
    findings.push({
      id: 'motors-imbalance',
      severity: 'warn',
      category: 'moteurs',
      title: r.motorsImbalance.title,
      detail: r.motorsImbalance.detail(`M${hi + 1}`, `M${lo + 1}`),
      evidence: r.motorsImbalance.evidence(
        f0(per[0]),
        f0(per[1]),
        f0(per[2]),
        f0(per[3]),
        f1(analysis.motors.imbalancePctPts),
        t.imbalanceWarn,
      ),
      fix: { text: r.motorsImbalance.fix(`M${hi + 1}`) },
    });
  }

  // --- motors-desync : eRPM à zéro en vol = crit -------------------------------
  if (analysis.motors.desyncZeros.some((z) => z > 0)) {
    const zeros = analysis.motors.desyncZeros;
    const guilty = zeros
      .map((z, i) => ({ motor: i + 1, count: z }))
      .filter((m) => m.count > 0);
    const motorList = guilty.map((m) => `M${m.motor}`).join(', ');
    findings.push({
      id: 'motors-desync',
      severity: 'crit',
      category: 'moteurs',
      title: r.motorsDesync.title(motorList),
      detail: r.motorsDesync.detail,
      evidence: r.motorsDesync.evidence(zeros.join(', ')),
      fix: { text: r.motorsDesync.fix(motorList) },
    });
  }

  // --- batterie ----------------------------------------------------------------
  if (analysis.power && analysis.power.cells > 0) {
    const p = analysis.power;
    const sagPerCell = p.sagV / p.cells;
    const sagSev = sevAbove(sagPerCell, t.sagPerCellWarn, t.sagPerCellCrit);
    if (sagSev) {
      findings.push({
        id: 'battery-sag',
        severity: sagSev,
        category: 'batterie',
        title: r.batterySag.title,
        detail: r.batterySag.detail,
        evidence: r.batterySag.evidence(
          f2(p.sagV),
          f2(sagPerCell),
          t.sagPerCellWarn,
          t.sagPerCellCrit,
          f2(p.perCellMin),
        ),
        fix: { text: r.batterySag.fix },
      });
    }
    if (p.perCellMin < t.perCellMinCrit) {
      findings.push({
        id: 'battery-empty',
        severity: 'crit',
        category: 'batterie',
        title: r.batteryEmpty.title,
        detail: r.batteryEmpty.detail(f2(t.perCellMinCrit)),
        evidence: r.batteryEmpty.evidence(f2(p.perCellMin), f2(t.perCellMinCrit)),
        fix: { text: r.batteryEmpty.fix },
      });
    }
    if (profile.expectedCells !== null && p.cells !== profile.expectedCells) {
      findings.push({
        id: 'battery-cells-unexpected',
        severity: 'warn',
        category: 'batterie',
        title: r.batteryCellsUnexpected.title,
        detail: r.batteryCellsUnexpected.detail(p.cells, profileLabel, profile.expectedCells),
        evidence: r.batteryCellsUnexpected.evidence(
          p.cells,
          f2(p.vbatMax),
          profile.expectedCells,
        ),
        fix: { text: r.batteryCellsUnexpected.fix },
      });
    }
  }

  // --- yoyo-detected -------------------------------------------------------------
  // Limite connue : le ratio compare des unités différentes (pas moteur ~1900 vs
  // µs stick ~1000), donc une réponse proportionnelle saine donne déjà ~1.8-2.0.
  // Mesuré sur le parc : 1.47-1.98 sur des vols SANS yoyo confirmé hors Pico.
  // Seul le Pico a une calibration terrain (yoyo réel signalé à ~1.5, seuil 1.3)
  // → warn sur le Pico, info ailleurs, et le seuil vient du profil.
  if (
    analysis.yoyo &&
    analysis.yoyo.applicable &&
    analysis.yoyo.ratio !== null &&
    analysis.yoyo.ratio >= t.yoyoRatioWarn
  ) {
    const peaks = analysis.yoyo.peaks
      .slice(0, 3)
      .map((pk) => r.yoyoDetected.peak(f1(pk.freqHz), f0(pk.mag)))
      .join(', ');
    const isPico = profile.id === 'pico';
    findings.push({
      id: 'yoyo-detected',
      severity: isPico ? 'warn' : 'info',
      category: 'pid',
      title: isPico ? r.yoyoDetected.titleWarn : r.yoyoDetected.titleInfo,
      detail: r.yoyoDetected.detail(isPico ? '' : r.yoyoDetected.confirmNote),
      evidence: r.yoyoDetected.evidence(f1(analysis.yoyo.ratio), t.yoyoRatioWarn, peaks),
      fix: { text: r.yoyoDetected.fix },
    });
  }

  // --- propwash-severe / propwash-untested -----------------------------------------
  if (analysis.propwash) {
    if (!analysis.propwash.applicable) {
      findings.push({
        id: 'propwash-untested',
        severity: 'info',
        category: 'log',
        title: r.propwashUntested.title,
        detail: r.propwashUntested.detail,
        evidence: r.propwashUntested.evidence,
      });
    } else if (
      analysis.propwash.worstSeverity !== null &&
      analysis.propwash.worstSeverity >= t.propwashWarn
    ) {
      findings.push({
        id: 'propwash-severe',
        severity: 'warn',
        category: 'pid',
        title: r.propwashSevere.title,
        detail: r.propwashSevere.detail,
        evidence: r.propwashSevere.evidence(
          f1(analysis.propwash.worstSeverity),
          t.propwashWarn,
          analysis.propwash.events.length,
          analysis.propwash.avgSeverity !== null ? f1(analysis.propwash.avgSeverity) : null,
        ),
        fix: { text: r.propwashSevere.fix },
      });
    }
  }

  // --- gps-low-sats -----------------------------------------------------------------
  if (analysis.gps.available && analysis.gps.numSatMin !== null && analysis.gps.numSatMin < 6) {
    findings.push({
      id: 'gps-low-sats',
      severity: 'warn',
      category: 'gps',
      title: r.gpsLowSats.title,
      detail: r.gpsLowSats.detail,
      evidence: r.gpsLowSats.evidence(
        f0(analysis.gps.numSatMin),
        analysis.gps.numSatMax !== null ? f0(analysis.gps.numSatMax) : null,
      ),
      fix: { text: r.gpsLowSats.fix },
    });
  }

  // --- failsafe-triggered --------------------------------------------------------------
  if (analysis.failsafe.triggered) {
    const phases = Object.entries(analysis.failsafe.phases)
      .map(([k, v]) => `${k || '?'}: ${v}`)
      .join(', ');
    findings.push({
      id: 'failsafe-triggered',
      severity: 'crit',
      category: 'securite',
      title: r.failsafeTriggered.title,
      detail: r.failsafeTriggered.detail,
      evidence: r.failsafeTriggered.evidence(phases),
      fix: { text: r.failsafeTriggered.fix },
    });
  }

  // --- log-quality -----------------------------------------------------------------------
  {
    const issues: string[] = [];
    let lowRate = false;
    if (analysis.meta.durationS < 30) {
      issues.push(r.logQuality.issueShortLog(f0(analysis.meta.durationS)));
    }
    if (analysis.meta.sampleRateHz < 900) {
      lowRate = true;
      issues.push(
        r.logQuality.issueLowSampleRate(
          f0(analysis.meta.sampleRateHz),
          f0(analysis.meta.sampleRateHz / 2),
        ),
      );
    }
    if (issues.length > 0) {
      findings.push({
        id: 'log-quality',
        severity: 'info',
        category: 'log',
        title: r.logQuality.title,
        detail: r.logQuality.detail(issues.join(' ; ')),
        evidence: r.logQuality.evidence(f1(analysis.meta.durationS), f0(analysis.meta.sampleRateHz)),
        fix: lowRate
          ? {
              text: r.logQuality.fixLowRate,
              cli: ['set blackbox_sample_rate = 1/1'],
            }
          : { text: r.logQuality.fixShortLog },
      });
    }
  }

  // --- all-good : rien de warn/crit --------------------------------------------------------
  if (!findings.some((fd) => fd.severity === 'warn' || fd.severity === 'crit')) {
    const strong: string[] = [];
    if (worstUnfilt) strong.push(r.allGood.strongUnfilt(f1(worstUnfilt.value)));
    if (worstFilt) strong.push(r.allGood.strongFilt(f1(worstFilt.value)));
    if (worstTrack) strong.push(r.allGood.strongTracking(f1(worstTrack.value)));
    strong.push(r.allGood.strongSaturation(f2(analysis.motors.saturationPct)));
    if (analysis.power && analysis.power.cells > 0) {
      strong.push(r.allGood.strongSag(f2(analysis.power.sagV / analysis.power.cells)));
    }
    findings.push({
      id: 'all-good',
      severity: 'ok',
      category: 'log',
      title: r.allGood.title,
      detail: r.allGood.detail(profileLabel),
      evidence: strong.join(' | '),
    });
  }

  // Tri : crit d'abord, puis warn, info, ok (tri stable → ordre des règles conservé).
  return findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

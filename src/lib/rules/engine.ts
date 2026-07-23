// Moteur de règles déterministe : transforme une SessionAnalysis en Findings
// selon les seuils du profil drone. Zéro IA : uniquement des comparaisons
// chiffrées, chaque verdict cite ses chiffres dans evidence.
// Toutes les chaînes utilisateur viennent du dictionnaire i18n (dict.rules) ;
// sans dict explicite, la référence française est utilisée (comportement legacy).

import { eventSeverity, qualifyingEvents } from '../analysis/oscillation';
import { MIN_STEP_QUALITY } from '../analysis/step';
import { parseNum, suggestAntiGravity, suggestSliderBump } from '../cli/config';
import { fr } from '../i18n/fr';
import { AXIS_NAMES } from '../types';
import type { Dict } from '../i18n/fr';
import type {
  Axis,
  CliConfig,
  DroneProfile,
  Finding,
  SessionAnalysis,
  Severity,
} from '../types';

const f0 = (x: number): string => x.toFixed(0);
const f1 = (x: number): string => x.toFixed(1);
const f2 = (x: number): string => x.toFixed(2);

const SEVERITY_RANK: Record<Severity, number> = { crit: 0, warn: 1, info: 2, ok: 3 };

export interface WorstAxis {
  axis: Axis;
  value: number;
}

/** Pire axe (valeur max), en ignorant les null. Partagé avec compare.ts. */
export function worstAxis(values: ReadonlyArray<number | null>): WorstAxis | null {
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

/**
 * `config` est optionnel et sert uniquement à rendre les conseils copiables :
 * aucune règle ne se déclenche ni ne change de sévérité selon la config, un
 * verdict reste tiré des seules mesures de vol. Sans elle, les mêmes findings
 * sortent avec leur conseil en prose et sans ligne de commande.
 */
export function evaluateSession(
  analysis: SessionAnalysis,
  profile: DroneProfile,
  dict: Dict = fr,
  config: CliConfig | null = null,
): Finding[] {
  const t = profile.thresholds;
  const r = dict.rules;
  const profileLabel = r.profiles[profile.id].label;
  const findings: Finding[] = [];
  /** Lignes de commande d'un conseil, ou undefined pour n'en afficher aucune. */
  const cliOf = (...lines: (string | null)[]): string[] | undefined => {
    const kept = lines.filter((l): l is string => l !== null);
    return kept.length > 0 ? kept : undefined;
  };
  const bump = (key: string, delta: number): string | null =>
    config === null ? null : suggestSliderBump(config, key, delta);
  // parseNum et pas parseFloat : les headers écrivent les booléens « ON »/« OFF ».
  const cfgNum = (key: string): number | null => parseNum(config?.values[key]);

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
    // nearestMotor est un index 0-based → affichage M1..M8
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
      // Même gate que filters-weak : ne suspecter le filtre RPM que si la bande
      // moteur contient réellement du bruit à atténuer sur cet axe.
      if (
        attPeakAxis !== null &&
        attPeakAxis < 15 &&
        analysis.filters.axes[dp.axis].motorBandUnfiltRms >= t.motorBandRawFloor
      ) {
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
      // Gate sur le bruit BRUT de la bande : un ratio d'atténuation ne juge le
      // filtrage que s'il y a du bruit moteur à retirer. Sur un quad propre le
      // ratio est mécaniquement faible et ce n'est pas un défaut (faux positif
      // mesuré sur un tune final sain : brut 50-77, filtré 17-22, 9.6 dB).
      if (analysis.filters.axes[i].motorBandUnfiltRms < t.motorBandRawFloor) continue;
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
        // Baisser le multiplicateur descend les fréquences de coupure, donc
        // filtre PLUS. On ne le propose que si le filtre RPM tourne déjà : tant
        // qu'il est absent, c'est lui qu'il faut activer (verdict no-bidir), pas
        // compenser à l'aveugle avec des LPF plus agressifs et leur latence.
        fix: {
          text: r.filtersWeak.fix,
          cli:
            cfgNum('dshot_bidir') === 1 && cfgNum('rpm_filter_harmonics') !== 0
              ? cliOf(bump('simplified_gyro_filter_multiplier', -15))
              : undefined,
        },
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
        // Aucune commande dans la branche gyro bruité : le conseil y est
        // justement de NE PAS monter les gains tant que le bruit est là.
        // Fournir la ligne quand même reviendrait à contredire le texte.
        fix: {
          text: noiseLow
            ? r.trackingPoor.fixCleanGyro(AXIS_NAMES[worstTrack.axis])
            : r.trackingPoor.fixNoisyGyro,
          cli: noiseLow
            ? cliOf(bump('simplified_pi_gain', 10), bump('simplified_feedforward_gain', 10))
            : undefined,
        },
      });
    }
  }

  // --- step-overshoot / step-slow / step-settle-off --------------------------
  if (analysis.step) {
    // On ne juge que les axes fiables (seuil partagé avec la comparaison de
    // passes), avec mention de confiance entre 30 et 50 %.
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
        // La commande doit régler l'axe que le titre nomme, sinon le rapport
        // affiche « dépassement sur Yaw » au-dessus d'un slider qui ne touche
        // que roll et pitch. Sur yaw il n'y a rien à monter (d_yaw = 0 sur tout
        // le parc) : pas de commande, et l'evidence montre déjà les 3 axes.
        // simplified_pitch_d_gain ne règle QUE l'équilibre pitch/roll : il n'a
        // de sens que si le pitch dépasse seul, sinon décaler l'équilibre
        // soulagerait un axe en chargeant l'autre.
        fix: {
          text: r.stepOvershoot.fix(AXIS_NAMES[worstOver.axis]),
          cli:
            worstOver.axis === 2
              ? undefined
              : cliOf(
                  worstOver.axis === 1 && (overshoots[0] ?? 0) < t.overshootWarn
                    ? bump('simplified_pitch_d_gain', 10)
                    : bump('simplified_d_gain', 10),
                ),
        },
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
        // Sévérité graduée : rater la borne de peu (0.80-0.85 / 1.15-1.20) est
        // une info, pas le même verdict qu'un vrai décalage - un 0.84 prenait
        // le même warn qu'un 0.60 (effet falaise signalé par un pilote).
        const sev: Severity =
          ax.settleValue < 0.8 || ax.settleValue > 1.2 ? 'warn' : 'info';
        // Sans feedforward sur l'axe, la réponse converge plus lentement : une
        // stabilisation un peu sous la consigne dans la fenêtre 200-500 ms est
        // en partie la signature du choix no-FF, pas forcément un I trop bas.
        const noFf = cfgNum(['f_roll', 'f_pitch', 'f_yaw'][i]) === 0;
        findings.push({
          id: 'step-settle-off',
          severity: sev,
          category: 'pid',
          title: r.stepSettleOff.title(AXIS_NAMES[i]),
          detail: r.stepSettleOff.detail + (noFf ? r.stepSettleOff.noFfNote : ''),
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

  // --- motors-floor-clip : saturation par le bas ------------------------------
  // Symétrique de motors-saturation, mais mesuré uniquement en vol stabilisé :
  // toucher le plancher pendant un flip commandé est normal (airmode), y camper
  // en stationnaire signifie que le mixer n'a plus de réserve vers le bas.
  {
    const sev = sevAbove(analysis.motors.floorClipPct, t.floorClipWarn, t.floorClipCrit);
    if (sev) {
      findings.push({
        id: 'motors-floor-clip',
        severity: sev,
        category: 'moteurs',
        title: r.motorsFloorClip.title,
        detail: r.motorsFloorClip.detail,
        evidence: r.motorsFloorClip.evidence(
          f2(analysis.motors.floorClipPct),
          t.floorClipWarn,
          t.floorClipCrit,
        ),
        fix: { text: r.motorsFloorClip.fix },
      });
    }
  }

  // --- motors-balance-shift : l'équilibre casse EN vol -------------------------
  // Prime sur motors-imbalance : quand la rupture est datée, la moyenne de
  // session est le SYMPTÔME de la rupture, et le conseil « recentre le pack »
  // serait à côté de la cause. Une seule des deux règles parle.
  // Le conseil parle le dialecte du firmware ET tient compte de ce que le log
  // porte déjà : conseiller « active le DSHOT bidirectionnel » quand l'eRPM
  // est dans les trames (ou « branche la télémétrie ESC » quand escRpm y est)
  // serait à côté de la plaque.
  const isInav = analysis.meta.firmwareFamily === 'inav';
  const rpmLogged = isInav ? analysis.motors.escRpmAvailable : analysis.motors.erpmAvailable;

  const shift = analysis.motors.balanceShift;
  const shiftQualifies = shift !== null && shift.deltaPctPts >= t.imbalanceShiftWarn;
  if (shift !== null && shiftQualifies) {
    const motorLabel = `M${shift.motor}`;
    const counterNote =
      shift.counterMotor !== null && shift.counterDeltaPctPts !== null
        ? r.motorsBalanceShift.counterNote(`M${shift.counterMotor}`, f1(shift.counterDeltaPctPts))
        : '';
    findings.push({
      id: 'motors-balance-shift',
      severity: shift.deltaPctPts >= t.imbalanceShiftCrit ? 'crit' : 'warn',
      category: 'moteurs',
      title: r.motorsBalanceShift.title(motorLabel),
      detail: r.motorsBalanceShift.detail(motorLabel),
      evidence: r.motorsBalanceShift.evidence(
        motorLabel,
        f1(shift.beforeDevPts),
        f1(shift.afterDevPts),
        f1(shift.deltaPctPts),
        f1(shift.tChangeS),
        counterNote,
      ),
      fix: rpmLogged
        ? { text: r.motorsBalanceShift.fixRpmLogged(motorLabel) }
        : isInav
          ? { text: r.motorsBalanceShift.fixInav(motorLabel) }
          : { text: r.motorsBalanceShift.fixBetaflight(motorLabel), cli: ['set dshot_bidir = ON'] },
    });
  }

  // --- motors-imbalance -------------------------------------------------------
  if (!shiftQualifies && analysis.motors.imbalancePctPts >= t.imbalanceWarn) {
    const per = analysis.motors.perMotorAvgPct;
    let hi = 0;
    let lo = 0;
    for (let i = 1; i < per.length; i++) {
      if (per[i] > per[hi]) hi = i;
      if (per[i] < per[lo]) lo = i;
    }
    findings.push({
      id: 'motors-imbalance',
      severity: 'warn',
      category: 'moteurs',
      title: r.motorsImbalance.title,
      detail: r.motorsImbalance.detail(`M${hi + 1}`, `M${lo + 1}`),
      // Quad : signature 4-aire historique, pour que les liens partagés restent
      // rendables même par un client pas encore à jour. evidenceN (liste
      // pré-jointe) ne sert qu'au-delà de 4 moteurs, où elle est indispensable.
      evidence:
        per.length === 4
          ? r.motorsImbalance.evidence(
              f0(per[0]),
              f0(per[1]),
              f0(per[2]),
              f0(per[3]),
              f1(analysis.motors.imbalancePctPts),
              t.imbalanceWarn,
            )
          : r.motorsImbalance.evidenceN(
              per.map((v, i) => `M${i + 1} ${f0(v)}`).join(' / '),
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

  // --- control-loss : excursion non commandée, mixer au bout de son autorité ---
  // Seule signature de désync accessible SANS eRPM (APD, INAV…) : le drone
  // tourne plus vite que la consigne (ou à contre-sens) pendant que le mixer
  // demande déjà le différentiel maximal. Couvre aussi hélice perdue et impact.
  {
    const cl = analysis.controlLoss;
    const w = cl !== null && cl.worst !== null ? cl.worst : null;
    if (cl !== null && w !== null) {
      findings.push({
        id: 'control-loss',
        severity: 'crit',
        category: 'securite',
        title: r.controlLoss.title,
        detail: r.controlLoss.detail,
        evidence: r.controlLoss.evidence(
          String(cl.events.length),
          f2(w.tStart),
          f2(w.tEnd),
          f0(w.peakExcessDps),
          AXIS_NAMES[w.axis],
          f0(w.peakSpreadPct),
        ),
        fix: rpmLogged
          ? { text: r.controlLoss.fixRpmLogged }
          : isInav
            ? { text: r.controlLoss.fixInav }
            : { text: r.controlLoss.fixBetaflight, cli: ['set dshot_bidir = ON'] },
      });
    }
  }

  // --- batterie ----------------------------------------------------------------
  if (analysis.power && analysis.power.cells > 0) {
    const p = analysis.power;
    // Canal vbat prouvé incohérent : on ne publie pas un verdict tiré d'une
    // mesure impossible. Sag et tension mini viennent tous les deux du même
    // ADC, ils tombent ensemble.
    const vbatUsable = p.implausibleSamples === 0;
    if (!vbatUsable) {
      // Les deux canaux (tension ET courant) qui décrochent = le sensing
      // d'alimentation de la carte est HS, pas un caprice d'un seul ADC. On
      // passe en critique : tant que c'est cassé, la compensation de sag et
      // les alarmes de tension de Betaflight lisent ces valeurs fausses - le
      // pilote peut vider un pack sans jamais entendre l'alarme.
      const ampBad = p.ampImplausible && p.ampMax !== null && p.ampP99 !== null;
      findings.push({
        id: 'battery-readings-implausible',
        severity: ampBad ? 'crit' : 'warn',
        category: 'batterie',
        title: r.batteryReadingsImplausible.title,
        detail: r.batteryReadingsImplausible.detail(
          ampBad
            ? r.batteryReadingsImplausible.currentNote(f0(p.ampMax!), f0(p.ampP99!))
            : '',
        ),
        evidence: r.batteryReadingsImplausible.evidence(
          p.implausibleSamples,
          f2(p.vbatMax),
          f2(p.vbatMin),
        ),
        // Noms de paramètres CLI, identiques dans toutes les langues. Sur un
        // log INAV le conseil citerait des paramètres Betaflight (ibata_scale
        // n'existe pas côté INAV) : le verdict reste, le fix saute.
        fix:
          analysis.meta.firmwareFamily === 'inav'
            ? undefined
            : {
                text: r.batteryReadingsImplausible.fix(
                  ampBad ? 'vbat_scale / ibata_scale' : 'vbat_scale',
                ),
              },
      });
    }
    const sagPerCell = p.sagV / p.cells;
    const sagSev = vbatUsable ? sevAbove(sagPerCell, t.sagPerCellWarn, t.sagPerCellCrit) : null;
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
    // Tension SOUTENUE, pas l'échantillon isolé le plus bas : un pack n'est pas
    // vide parce que l'ADC a plongé pendant un transitoire de courant.
    if (vbatUsable && p.perCellMinSustained < t.perCellMinCrit) {
      findings.push({
        id: 'battery-empty',
        severity: 'crit',
        category: 'batterie',
        title: r.batteryEmpty.title,
        detail: r.batteryEmpty.detail(f2(t.perCellMinCrit)),
        evidence: r.batteryEmpty.evidence(f2(p.perCellMinSustained), f2(t.perCellMinCrit)),
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

  // --- battery-not-logged : champ BATTERY désactivé dans la config blackbox --
  // Sans lui, « pas de mesure vbat » laisse croire à un capteur muet alors que
  // c'est un réglage. Bit 3 du fields_disabled_mask = FIELD_SELECT_BATTERY
  // (vérifié sur le parc : mask 0 → vbatLatest présent, bit 3 → absent).
  // Compte dans le score (info) : un vol sans données batterie n'est pas
  // entièrement vérifié, un 100/100 serait trompeur.
  if (analysis.power === null) {
    const mask = cfgNum('fields_disabled_mask');
    if (mask !== null && (mask & 8) !== 0) {
      findings.push({
        id: 'battery-not-logged',
        severity: 'info',
        category: 'batterie',
        title: r.batteryNotLogged.title,
        detail: r.batteryNotLogged.detail,
        evidence: r.batteryNotLogged.evidence(String(mask)),
        fix: { text: r.batteryNotLogged.fix, cli: ['set blackbox_disable_bat = OFF'] },
      });
    }
  }

  // --- rpm-not-logged : régime moteur absent → fondamentale non mesurable ------
  // Sans source RPM, la ligne « moteurs ~X Hz » du spectre est impossible : on
  // l'annonce plutôt que de laisser croire à une analyse complète. Chaque
  // famille a SA source et SON vocabulaire, jamais mélangés : eRPM par moteur
  // via DShot bidirectionnel sur Betaflight, escRPM agrégé via télémétrie ESC
  // sur INAV (où dshot_bidir n'existe pas).
  // scoreExempt : l'axe moteurs reste mesuré par ailleurs (sorties moteur,
  // saturation) - un champ de log décoché n'est pas un défaut du vol.
  if (analysis.meta.firmwareFamily === 'inav') {
    // escRpm présent : le régime est loggé sous sa forme INAV, rien à signaler
    // (le per-moteur n'existe simplement pas sur ce firmware).
    if (!analysis.motors.escRpmAvailable) {
      findings.push({
        id: 'rpm-not-logged',
        severity: 'info',
        category: 'moteurs',
        scoreExempt: true,
        title: r.rpmNotLogged.title,
        detail: r.rpmNotLogged.detailInav,
        evidence: r.rpmNotLogged.evidenceInav,
        fix: { text: r.rpmNotLogged.fixInav },
      });
    }
  } else if (!analysis.motors.erpmAvailable) {
    // On ne décode PAS le bit RPM du fields_disabled_mask : sa position dépend
    // du firmware (ATTITUDE inséré en 2025.12 décale RPM de 12 à 13), l'absence
    // des colonnes eRPM dans les trames suffit. dshot_bidir départage les causes.
    const bidir = cfgNum('dshot_bidir');
    const cause =
      bidir === null
        ? r.rpmNotLogged.causeUnknown
        : bidir === 0
          ? r.rpmNotLogged.causeNoBidir
          : r.rpmNotLogged.causeFieldDisabled;
    findings.push({
      id: 'rpm-not-logged',
      severity: 'info',
      category: 'moteurs',
      scoreExempt: true,
      title: r.rpmNotLogged.title,
      detail: r.rpmNotLogged.detail(cause),
      evidence: r.rpmNotLogged.evidence(bidir === null ? 'n/a' : String(bidir)),
      fix:
        bidir === null
          ? { text: r.rpmNotLogged.fixUnknown }
          : bidir === 0
            ? { text: r.rpmNotLogged.fixNoBidir, cli: ['set dshot_bidir = ON'] }
            : { text: r.rpmNotLogged.fixFieldDisabled, cli: ['set blackbox_disable_rpm = OFF'] },
    });
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
      fix: {
        text: r.yoyoDetected.fix,
        cli: config === null ? undefined : cliOf(suggestAntiGravity(config, -20)),
      },
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

  // --- oscillation-event ------------------------------------------------------------
  // Évalué par ÉVÉNEMENT, jamais en moyenne sur le log : un incident de 0,5 s
  // qui sature le mixer garde la même gravité dans un log de 15 s et de 3 min.
  {
    const qualifying = qualifyingEvents(analysis.oscillation, t);
    const w = qualifying[0]; // events est trié par ratio décroissant
    if (w) {
      findings.push({
        id: 'oscillation-event',
        severity: eventSeverity(w, t),
        category: 'pid',
        title: r.oscillationEvent.title(f0(w.freqHz)),
        detail: r.oscillationEvent.detail,
        evidence: r.oscillationEvent.evidence(
          f1(w.tStart),
          f1(w.tEnd - w.tStart),
          f0(w.freqHz),
          f0(w.ratio),
          f0(w.saturationPct),
          w.motorsAtStop.map((m) => `M${m}`).join(', ') || null,
          qualifying.length,
          f0(w.peakGyroDps),
        ),
        fix: { text: r.oscillationEvent.fix },
      });
    }
  }

  // --- règles GPS (accroche, chutes, interférences) --------------------------
  if (analysis.gps.available) {
    const g = analysis.gps;

    // gps-low-sats : plancher de couverture sous le seuil de fiabilité rescue.
    if (g.numSatMin !== null && g.numSatMin < 6) {
      findings.push({
        id: 'gps-low-sats',
        severity: 'warn',
        category: 'gps',
        title: r.gpsLowSats.title,
        detail: r.gpsLowSats.detail,
        evidence: r.gpsLowSats.evidence(
          f0(g.numSatMin),
          g.numSatMax !== null ? f0(g.numSatMax) : null,
        ),
        fix: { text: r.gpsLowSats.fix },
      });
    }

    // gps-acquisition-slow : accroche saine (8+ sats) jamais atteinte ou tardive.
    if (g.numSatMedian !== null) {
      const neverHealthy = g.timeToHealthySatsS === null && analysis.meta.durationS >= 60;
      const lateHealthy = g.timeToHealthySatsS !== null && g.timeToHealthySatsS > 30;
      if (neverHealthy || lateHealthy) {
        findings.push({
          id: 'gps-acquisition-slow',
          severity: neverHealthy ? 'warn' : 'info',
          category: 'gps',
          title: r.gpsAcquisitionSlow.title,
          detail: r.gpsAcquisitionSlow.detail,
          evidence: r.gpsAcquisitionSlow.evidence(
            f0(g.numSatMedian),
            g.timeToHealthySatsS !== null ? f0(g.timeToHealthySatsS) : null,
          ),
          fix: { text: r.gpsAcquisitionSlow.fix },
        });
      }
    }

    // gps-sat-drops : chutes transitoires de sats en vol (masquage, antenne, EMI).
    // Seules les chutes sous 8 sats comptent : perdre 13 → 10 est du churn de
    // constellation normal et ne menace pas un rescue.
    const harmfulDrops = g.satDrops.filter((d) => d.toSats < 8);
    if (harmfulDrops.length > 0) {
      const worst = harmfulDrops.reduce((a, b) => (b.toSats < a.toSats ? b : a));
      findings.push({
        id: 'gps-sat-drops',
        // Sous 5 sats le fix 3D lui-même est perdu : un rescue à cet instant partirait en vrille.
        severity: worst.toSats < 5 ? 'crit' : 'warn',
        category: 'gps',
        title: r.gpsSatDrops.title,
        detail: r.gpsSatDrops.detail,
        evidence: r.gpsSatDrops.evidence(
          f0(harmfulDrops.length),
          f0(worst.fromSats),
          f0(worst.toSats),
          f0(worst.timeS),
        ),
        fix: { text: r.gpsSatDrops.fix },
      });
    }

    // gps-emi-throttle : les sats tombent quand la puissance monte - signature
    // d'interférence électrique (VTX/ESC/câblage) sur le récepteur GPS.
    if (g.satsVsThrottle !== null && g.satsVsThrottle.delta <= -2) {
      findings.push({
        id: 'gps-emi-throttle',
        severity: g.satsVsThrottle.delta <= -4 ? 'crit' : 'warn',
        category: 'gps',
        title: r.gpsEmiThrottle.title,
        detail: r.gpsEmiThrottle.detail,
        evidence: r.gpsEmiThrottle.evidence(
          f0(g.satsVsThrottle.lowMedian),
          f0(g.satsVsThrottle.highMedian),
        ),
        fix: { text: r.gpsEmiThrottle.fix },
      });
    }

    // gps-hdop-high (INAV) : géométrie/qualité de signal médiocre malgré les sats.
    if (g.hdopMedian !== null) {
      const sev = sevAbove(g.hdopMedian, 2.5, 5);
      if (sev) {
        findings.push({
          id: 'gps-hdop-high',
          severity: sev,
          category: 'gps',
          title: r.gpsHdopHigh.title,
          detail: r.gpsHdopHigh.detail,
          evidence: r.gpsHdopHigh.evidence(
            f1(g.hdopMedian),
            g.hdopWorst !== null ? f1(g.hdopWorst) : null,
          ),
          fix: { text: r.gpsHdopHigh.fix },
        });
      }
    }
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

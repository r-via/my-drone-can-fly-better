// Moteur de règles déterministe : transforme une SessionAnalysis en Findings
// selon les seuils du profil drone. Zéro IA : uniquement des comparaisons
// chiffrées, chaque verdict cite ses chiffres dans evidence.

import { AXIS_NAMES } from '../types';
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

export function evaluateSession(analysis: SessionAnalysis, profile: DroneProfile): Finding[] {
  const t = profile.thresholds;
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
        title: 'Vibrations mécaniques élevées',
        detail:
          `Le gyro brut (avant filtrage) est très agité sur ${AXIS_NAMES[worstUnfilt.axis]} : ` +
          "c'est une vibration mécanique réelle, pas un problème de tune. Cause probable : " +
          'hélice abîmée ou déséquilibrée, roulement moteur fatigué, visserie châssis desserrée.',
        evidence:
          `Bruit non filtré : ${perAxisList(analysis.noise.axes.map((a) => a.unfiltRms))} deg/s RMS ` +
          `(warn ${t.unfiltNoiseWarn}, crit ${t.unfiltNoiseCrit})`,
        fix: {
          text:
            'Inspecte les hélices (fissures, équilibrage), fais tourner chaque moteur à la main ' +
            '(point dur = roulement mort), resserre la visserie châssis et le support FC.',
        },
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
        title: 'Bruit résiduel après filtrage',
        detail:
          `Le gyro filtré reste bruité sur ${AXIS_NAMES[worstFilt.axis]} : ce bruit entre ` +
          'directement dans la boucle PID → commandes moteur nerveuses, moteurs chauds, tune impossible. ' +
          'Soit le filtrage est trop léger, soit la source mécanique est trop forte.',
        evidence:
          `Bruit filtré : ${perAxisList(analysis.noise.axes.map((a) => a.filtRms))} deg/s RMS ` +
          `(warn ${t.filtNoiseWarn}, crit ${t.filtNoiseCrit})`,
        fix: {
          text:
            "Traite d'abord la source mécanique (voir bruit brut), puis renforce le filtrage " +
            '(multiplicateur gyro LPF plus bas, filtre RPM actif) si le brut est déjà propre.',
        },
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
          `${AXIS_NAMES[i]} : 40-120 Hz = ${f0(resBand.rms)} vs plage moteur = ${f0(motorBand.rms)}`,
        );
      }
    });
    if (hits.length > 0) {
      const dp = analysis.spectrum.dominantPeak;
      const peakInfo = dp
        ? ` | pic dominant ${f0(dp.freqHz)} Hz (axe ${AXIS_NAMES[dp.axis]}), le plus proche de M${dp.nearestMotor + 1} (écart ${f0(dp.distanceHz)} Hz)`
        : '';
      findings.push({
        id: 'chassis-resonance',
        severity: 'warn',
        category: 'vibrations',
        title: 'Résonance châssis (40-120 Hz)',
        detail:
          "L'énergie vibratoire se concentre dans la bande 40-120 Hz, en dessous de la rotation " +
          'des moteurs : signature d\'une résonance de châssis (bras, caméra, stack) excitée par ' +
          'les moteurs. C\'est la source classique du jello à l\'image.',
        evidence: hits.join(' ; ') + peakInfo,
        fix: {
          text:
            'Soft-mount la FC (silentblocks en bon état), vérifie le serrage des bras et du ' +
            'support caméra, ajoute un amortissement TPU si un élément vibre en sympathie.',
        },
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
      rpmNote =
        ' Pas de télémétrie eRPM dans le log : le filtre RPM ne peut pas fonctionner ' +
        '(il faut dshot_bidir et un ESC compatible).';
    } else if (analysis.filters.available && analysis.filters.axes) {
      const attPeakAxis = attenuationInBand(
        analysis.filters.axes[dp.axis].attenuationDb,
        120,
        350,
      );
      if (attPeakAxis !== null && attPeakAxis < 15) {
        rpmNote =
          ` L'atténuation dans la plage moteur n'est que de ${f1(attPeakAxis)} dB : le filtre ` +
          'RPM semble inactif ou inefficace, vérifie qu\'il est bien configuré.';
      }
    }
    const sev: Severity =
      worstUnfilt !== null && worstUnfilt.value >= t.unfiltNoiseWarn ? 'warn' : 'info';
    findings.push({
      id: 'motor-noise-peak',
      severity: sev,
      category: 'vibrations',
      title: `Pic de bruit à la fondamentale de ${motorLabel}`,
      detail:
        `Le pic dominant du spectre colle à la vitesse de rotation de ${motorLabel} : le bruit ` +
        `vient de ce moteur ou de son hélice (balourd).${rpmNote}`,
      evidence:
        `Pic dominant ${f0(dp.freqHz)} Hz sur ${AXIS_NAMES[dp.axis]}, à ${f0(dp.distanceHz)} Hz ` +
        `de la rotation de ${motorLabel}`,
      fix: {
        text:
          `Équilibre ou remplace l'hélice de ${motorLabel}, vérifie l'axe du moteur (voilé après ` +
          'crash ?) et le serrage de l\'écrou.',
      },
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
        title: 'Filtrage insuffisant dans la plage moteur',
        detail:
          `Entre gyro brut et gyro filtré, la bande 120-350 Hz n'est atténuée que de ` +
          `${f1(weakest.value)} dB sur ${AXIS_NAMES[weakest.axis]} : le bruit moteur passe les ` +
          'filtres. Un filtre RPM actif écrase normalement cette bande de 20 dB ou plus.',
        evidence: `Atténuation 120-350 Hz : ${perAxisList(atts)} dB (attendu ≥ 15 dB)`,
        fix: {
          text:
            'Vérifie que le filtre RPM est actif (dshot_bidir + pôles moteur corrects), sinon ' +
            'baisse le multiplicateur de filtre gyro dans l\'onglet tuning.',
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
        title: 'Fuite haute fréquence vers les moteurs',
        detail:
          `Il reste du bruit au-dessus de 100 Hz dans le gyro filtré (${AXIS_NAMES[worstHf.axis]}). ` +
          'Ces hautes fréquences partent dans la commande moteur : les moteurs chauffent pour rien ' +
          'et les ESC encaissent.',
        evidence:
          `Résiduel >100 Hz : ${perAxisList(analysis.filters.axes.map((ax) => ax.residualHfRms))} ` +
          `(amplitude spectrale, seuil ${t.residualHfWarn})`,
        fix: {
          text:
            'Renforce le filtrage gyro/D-term ou corrige la source mécanique. Touche les moteurs ' +
            'après un vol : tièdes = OK, brûlants = fuite confirmée.',
        },
      });
    }
  }

  // --- tracking-poor : erreur de suivi ---------------------------------------
  const worstTrack = worstAxis(analysis.tracking.axes.map((a) => a.meanAbsErr));
  if (worstTrack) {
    const sev = sevAbove(worstTrack.value, t.trackingWarn, t.trackingCrit);
    if (sev) {
      const noiseLow = worstFilt === null || worstFilt.value < t.filtNoiseWarn;
      const advice = noiseLow
        ? 'Le gyro est propre : tu peux monter P (et le feedforward) sur cet axe pour resserrer le suivi.'
        : "Le gyro est bruité en même temps : corrige d'abord le bruit/filtrage — monter les PID sur un gyro sale amplifierait le bruit.";
      findings.push({
        id: 'tracking-poor',
        severity: sev,
        category: 'pid',
        title: 'Suivi de consigne médiocre',
        detail:
          `Le gyro s'écarte trop de la consigne stick sur ${AXIS_NAMES[worstTrack.axis]} : le quad ` +
          `répond avec du retard ou de l'imprécision. ${advice}`,
        evidence:
          `Erreur moyenne : ${perAxisList(analysis.tracking.axes.map((a) => a.meanAbsErr))} deg/s ` +
          `(warn ${t.trackingWarn}, crit ${t.trackingCrit})`,
        fix: {
          text: noiseLow
            ? `Monte P et FF progressivement sur ${AXIS_NAMES[worstTrack.axis]} (par pas de ~10 %), revole, recompare.`
            : 'Règle le problème de bruit (voir verdicts vibrations/filtres) avant de toucher aux PID.',
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
      return q < 0.5 ? ` — confiance limitée (${Math.round(q * 100)} % des fenêtres exploitables)` : '';
    };
    const overshoots = stepAxes.map((ax) => (ax ? ax.overshootPct : null));
    const worstOver = worstAxis(overshoots);
    if (worstOver && worstOver.value >= t.overshootWarn) {
      findings.push({
        id: 'step-overshoot',
        severity: 'warn',
        category: 'pid',
        title: `Dépassement excessif sur ${AXIS_NAMES[worstOver.axis]}`,
        detail:
          'La réponse indicielle dépasse nettement la consigne avant de se stabiliser : trop de P ' +
          "ou pas assez de D sur cet axe. En vol ça se traduit par des rebonds en fin de mouvement.",
        evidence:
          `Overshoot : ${perAxisList(overshoots, 0)} % (seuil ${t.overshootWarn} %)${qualityNote(worstOver.axis)}`,
        fix: {
          text: `Baisse P d'environ 10 % ou monte D d'environ 10 % sur ${AXIS_NAMES[worstOver.axis]}, un seul changement à la fois.`,
        },
      });
    }

    const rises = stepAxes.map((ax) => (ax ? ax.riseTimeMs : null));
    const worstRise = worstAxis(rises);
    if (worstRise && worstRise.value >= t.riseTimeSlowMs) {
      let filterNote = 'P/FF probablement trop bas.';
      if (analysis.filters.available && analysis.filters.axes) {
        const att = attenuationInBand(analysis.filters.axes[worstRise.axis].attenuationDb, 120, 350);
        if (att !== null && att > 30) {
          filterNote = `Les filtres sont très agressifs (${f1(att)} dB d'atténuation) : la latence gyro qu'ils ajoutent peut expliquer la mollesse — allège le filtrage avant de monter les gains.`;
        }
      }
      findings.push({
        id: 'step-slow',
        severity: 'warn',
        category: 'pid',
        title: `Réponse molle sur ${AXIS_NAMES[worstRise.axis]}`,
        detail:
          `Le temps de montée 10→90 % est long : le quad met du temps à atteindre la vitesse ` +
          `demandée. ${filterNote}`,
        evidence:
          `Temps de montée : ${perAxisList(rises, 0)} ms (seuil ${t.riseTimeSlowMs} ms)${qualityNote(worstRise.axis)}`,
        fix: {
          text: 'Monte FF (réactivité immédiate) puis P si besoin ; si les filtres sont en cause, remonte le multiplicateur gyro LPF d\'un cran.',
        },
      });
    }

    for (let i = 0; i < stepAxes.length; i++) {
      const ax = stepAxes[i];
      if (ax && ax.settleValue !== null && (ax.settleValue < 0.85 || ax.settleValue > 1.15)) {
        findings.push({
          id: 'step-settle-off',
          severity: 'warn',
          category: 'pid',
          title: `Stabilisation décalée sur ${AXIS_NAMES[i]}`,
          detail:
            'Après le transitoire, la réponse ne se stabilise pas à 1 (la consigne) : le taux ' +
            "atteint dérive par rapport à la demande. C'est typiquement l'I-term (trop bas si <1, " +
            'trop haut ou en lutte si >1) ou un feedforward mal calibré.',
          evidence: `Valeur de stabilisation ${AXIS_NAMES[i]} = ${f2(ax.settleValue)} (attendu entre 0.85 et 1.15)${qualityNote(i as Axis)}`,
          fix: {
            text: `Ajuste I sur ${AXIS_NAMES[i]} : monte-le si la réponse plafonne sous la consigne, baisse-le si elle reste au-dessus.`,
          },
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
        title: 'Moteurs en saturation',
        detail:
          'Les moteurs tapent le maximum une partie du vol : la boucle PID perd toute autorité ' +
          'pendant ces instants (oscillations, wobbles en punch). Quad trop chargé, gains trop ' +
          'hauts ou pack trop faible.',
        evidence: `Saturation ${f2(analysis.motors.saturationPct)} % du vol (warn ${t.saturationWarn} %, crit ${t.saturationCrit} %)`,
        fix: {
          text: 'Allège le quad ou baisse le master multiplier ; vérifie aussi que le pack tient la tension sous charge.',
        },
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
      title: 'Déséquilibre entre moteurs',
      detail:
        `M${hi + 1} travaille nettement plus que M${lo + 1} pour tenir le quad à plat : centre de ` +
        'gravité décalé (pack, caméra), hélice voilée ou moteur fatigué de ce côté.',
      evidence:
        `Moyennes moteur : M1 ${f0(per[0])} / M2 ${f0(per[1])} / M3 ${f0(per[2])} / M4 ${f0(per[3])} % ` +
        `— écart ${f1(analysis.motors.imbalancePctPts)} pts (seuil ${t.imbalanceWarn})`,
      fix: {
        text: `Recentre le pack sur le châssis et inspecte l'hélice/le moteur M${hi + 1}.`,
      },
    });
  }

  // --- motors-desync : eRPM à zéro en vol = crit -------------------------------
  if (analysis.motors.desyncZeros.some((z) => z > 0)) {
    const zeros = analysis.motors.desyncZeros;
    const guilty = zeros
      .map((z, i) => ({ motor: i + 1, count: z }))
      .filter((m) => m.count > 0);
    findings.push({
      id: 'motors-desync',
      severity: 'crit',
      category: 'moteurs',
      title: `Desync détecté sur ${guilty.map((m) => `M${m.motor}`).join(', ')}`,
      detail:
        "L'eRPM tombe à zéro en vol : le moteur décroche ou l'ESC perd la synchronisation. " +
        "C'est un crash en attente — problème d'ESC (firmware, timing), de connexion moteur " +
        'ou de roulement grippé.',
      evidence: `eRPM zéros en vol par moteur : [${zeros.join(', ')}]`,
      fix: {
        text:
          `Contrôle les soudures et le connecteur du moteur ${guilty.map((m) => `M${m.motor}`).join(', ')}, ` +
          "fais-le tourner à la main (point dur = roulement), et vérifie le firmware/timing ESC. Ne revole pas avant.",
      },
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
        title: 'Sag batterie important',
        detail:
          'La tension chute fortement sous charge : pack fatigué (résistance interne en hausse) ' +
          'ou connectique résistive (XT30/XT60 oxydé, soudures). Moins de punch et risque de ' +
          'coupure en fin de pack.',
        evidence:
          `Sag ${f2(p.sagV)} V total soit ${f2(sagPerCell)} V/cellule (warn ${t.sagPerCellWarn}, ` +
          `crit ${t.sagPerCellCrit}) — min ${f2(p.perCellMin)} V/cellule sous charge`,
        fix: {
          text: 'Teste avec un pack neuf pour comparer ; si le sag persiste, inspecte connecteur et soudures du fil de puissance.',
        },
      });
    }
    if (p.perCellMin < t.perCellMinCrit) {
      findings.push({
        id: 'battery-empty',
        severity: 'crit',
        category: 'batterie',
        title: 'Batterie tirée trop bas',
        detail:
          `La tension est descendue sous ${f2(t.perCellMinCrit)} V/cellule en vol : à ce niveau on ` +
          'dégrade le pack de façon permanente (perte de capacité, gonflement).',
        evidence: `Minimum ${f2(p.perCellMin)} V/cellule (seuil ${f2(t.perCellMinCrit)} V)`,
        fix: {
          text: 'Atterris plus tôt : règle une alarme vbat/à la radio, et recharge ce pack en mode storage-check pour évaluer les dégâts.',
        },
      });
    }
    if (profile.expectedCells !== null && p.cells !== profile.expectedCells) {
      findings.push({
        id: 'battery-cells-unexpected',
        severity: 'warn',
        category: 'batterie',
        title: 'Nombre de cellules inattendu',
        detail:
          `Le log montre un pack ${p.cells}S alors que le profil ${profile.label} attend du ` +
          `${profile.expectedCells}S : mauvais pack branché, ou profil mal détecté.`,
        evidence: `Détecté ${p.cells}S (vbat max ${f2(p.vbatMax)} V), attendu ${profile.expectedCells}S`,
        fix: {
          text: 'Vérifie le pack utilisé — un surplus de cellules peut griller ESC/moteurs, un déficit écrase les perfs.',
        },
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
      .map((pk) => `${f1(pk.freqHz)} Hz (mag ${f0(pk.mag)})`)
      .join(', ');
    const isPico = profile.id === 'pico';
    findings.push({
      id: 'yoyo-detected',
      severity: isPico ? 'warn' : 'info',
      category: 'pid',
      title: isPico ? 'Yoyo détecté (oscillation de poussée)' : 'Indice de yoyo (à confirmer)',
      detail:
        'La poussée collective oscille plus que ce que commande le stick des gaz : le quad ' +
        '"pompe" verticalement. Causes classiques : I/anti-gravity trop agressifs, vibrations ' +
        'qui polluent la boucle, ou filtrage qui déphase la correction.' +
        (isPico
          ? ''
          : ' Métrique sensible au style de vol sur ce type de machine : confirme visuellement (le quad monte/descend tout seul en palier ?) avant de retoucher quoi que ce soit.'),
      evidence:
        `Ratio sd(poussée)/sd(stick) = ${f1(analysis.yoyo.ratio)} ` +
        `(seuil ${t.yoyoRatioWarn})${peaks ? ` — pics d'oscillation : ${peaks}` : ''}`,
      fix: {
        text: "Baisse anti_gravity_gain d'un cran et vérifie le bruit gyro ; si l'oscillation est lente (<2 Hz), regarde aussi l'I-term.",
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
        title: 'Prop wash non évalué',
        detail:
          'Le vol ne contient pas de descente franche à bas régime : impossible de juger le ' +
          'comportement en prop wash sur ce log.',
        evidence: 'Aucune descente throttle bas détectée dans ce vol',
      });
    } else if (
      analysis.propwash.worstSeverity !== null &&
      analysis.propwash.worstSeverity >= t.propwashWarn
    ) {
      findings.push({
        id: 'propwash-severe',
        severity: 'warn',
        category: 'pid',
        title: 'Prop wash marqué en descente',
        detail:
          'En descente dans ses propres remous, le quad tremble fort : les hélices brassent un ' +
          'air désordonné et la boucle PID peine à suivre. Un peu de prop wash est normal, à ce ' +
          'niveau ça se voit à l\'image.',
        evidence:
          `Sévérité max ${f1(analysis.propwash.worstSeverity)} deg/s RMS ` +
          `(seuil ${t.propwashWarn}) sur ${analysis.propwash.events.length} événement(s)` +
          (analysis.propwash.avgSeverity !== null
            ? `, moyenne ${f1(analysis.propwash.avgSeverity)}`
            : ''),
        fix: {
          text: 'Monte D (ou active/renforce dynamic idle si tu as le RPM filter), et vole avec des hélices en bon état.',
        },
      });
    }
  }

  // --- gps-low-sats -----------------------------------------------------------------
  if (analysis.gps.available && analysis.gps.numSatMin !== null && analysis.gps.numSatMin < 6) {
    findings.push({
      id: 'gps-low-sats',
      severity: 'warn',
      category: 'gps',
      title: 'Couverture GPS faible en vol',
      detail:
        'Le nombre de satellites est descendu sous 6 pendant le vol : le GPS rescue ne serait ' +
        'pas fiable à ce moment-là. Décoller avant le fix complet ou antenne masquée/parasitée.',
      evidence:
        `Satellites : min ${f0(analysis.gps.numSatMin)}` +
        (analysis.gps.numSatMax !== null ? ` / max ${f0(analysis.gps.numSatMax)}` : '') +
        ' (minimum sain : 6+)',
      fix: {
        text: "Attends 8+ sats avant de décoller ; éloigne l'antenne GPS de la VTX et de la caméra (interférences).",
      },
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
      title: 'Failsafe déclenché en vol',
      detail:
        'Le lien radio a été perdu au point de déclencher le failsafe : portée dépassée, antenne ' +
        'RX endommagée/mal orientée, ou interférence. À traiter avant tout le reste.',
      evidence: `failsafePhase : {${phases}}`,
      fix: {
        text: "Vérifie l'antenne RX (soudure, orientation), la config failsafe, et refais un range check avant de revoler loin.",
      },
    });
  }

  // --- log-quality -----------------------------------------------------------------------
  {
    const issues: string[] = [];
    let lowRate = false;
    if (analysis.meta.durationS < 30) {
      issues.push(`log court (${f0(analysis.meta.durationS)} s) : les verdicts sont moins fiables`);
    }
    if (analysis.meta.sampleRateHz < 900) {
      lowRate = true;
      issues.push(
        `échantillonnage ${f0(analysis.meta.sampleRateHz)} Hz : le spectre est limité à ` +
          `${f0(analysis.meta.sampleRateHz / 2)} Hz (fs/2), le bruit moteur haut peut être invisible`,
      );
    }
    if (issues.length > 0) {
      findings.push({
        id: 'log-quality',
        severity: 'info',
        category: 'log',
        title: 'Qualité de log limitée',
        detail:
          "Ce log ne permet pas une analyse complète : " + issues.join(' ; ') + '.',
        evidence: `Durée ${f1(analysis.meta.durationS)} s, échantillonnage ${f0(analysis.meta.sampleRateHz)} Hz`,
        fix: lowRate
          ? {
              text: 'Passe le blackbox en pleine résolution pour les prochains logs de tuning.',
              cli: ['set blackbox_sample_rate = 1/1'],
            }
          : { text: 'Vole au moins 30 s avec des mouvements variés pour un diagnostic fiable.' },
      });
    }
  }

  // --- all-good : rien de warn/crit --------------------------------------------------------
  if (!findings.some((fd) => fd.severity === 'warn' || fd.severity === 'crit')) {
    const strong: string[] = [];
    if (worstUnfilt) strong.push(`bruit brut max ${f1(worstUnfilt.value)} deg/s`);
    if (worstFilt) strong.push(`bruit filtré max ${f1(worstFilt.value)} deg/s`);
    if (worstTrack) strong.push(`erreur de suivi max ${f1(worstTrack.value)} deg/s`);
    strong.push(`saturation ${f2(analysis.motors.saturationPct)} %`);
    if (analysis.power && analysis.power.cells > 0) {
      strong.push(`sag ${f2(analysis.power.sagV / analysis.power.cells)} V/cellule`);
    }
    findings.push({
      id: 'all-good',
      severity: 'ok',
      category: 'log',
      title: 'Tout est propre',
      detail:
        `Aucun seuil warn/crit dépassé pour le profil ${profile.label} : mécanique saine, ` +
        'filtrage efficace et tune cohérent sur ce vol. Continue comme ça.',
      evidence: strong.join(' | '),
    });
  }

  // Tri : crit d'abord, puis warn, info, ok (tri stable → ordre des règles conservé).
  return findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

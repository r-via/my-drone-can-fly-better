// Chaînes du moteur de règles (engine.ts) et des profils drones - référence FR.
// Extraites à l'identique depuis engine.ts/profiles.ts ; les autres langues
// doivent refléter exactement cette structure (le type Dict l'impose).
// Convention : chaîne fixe → propriété string ; chaîne interpolée → fonction
// fléchée. Les valeurs numériques arrivent déjà formatées (string) quand le
// formatage est fait côté moteur (f0/f1/f2), sinon en number brut (seuils).

export const rules = {
  noiseMechHigh: {
    title: 'Vibrations mécaniques élevées',
    detail: (axis: string) =>
      `Le gyro brut (avant filtrage) est très agité sur ${axis} : c'est une vibration mécanique réelle, pas un problème de tune. Cause probable : hélice abîmée ou déséquilibrée, roulement moteur fatigué, visserie châssis desserrée.`,
    evidence: (perAxis: string, warn: number, crit: number) =>
      `Bruit non filtré : ${perAxis} deg/s RMS (warn ${warn}, crit ${crit})`,
    fix: 'Inspecte les hélices (fissures, équilibrage), fais tourner chaque moteur à la main (point dur = roulement mort), resserre la visserie châssis et le support FC.',
  },

  noiseFilteredLeak: {
    title: 'Bruit résiduel après filtrage',
    detail: (axis: string) =>
      `Le gyro filtré reste bruité sur ${axis} : ce bruit entre directement dans la boucle PID → commandes moteur nerveuses, moteurs chauds, tune impossible. Soit le filtrage est trop léger, soit la source mécanique est trop forte.`,
    evidence: (perAxis: string, warn: number, crit: number) =>
      `Bruit filtré : ${perAxis} deg/s RMS (warn ${warn}, crit ${crit})`,
    fix: "Traite d'abord la source mécanique (voir bruit brut), puis renforce le filtrage (multiplicateur gyro LPF plus bas, filtre RPM actif) si le brut est déjà propre.",
  },

  chassisResonance: {
    title: 'Résonance châssis (40-120 Hz)',
    detail:
      "L'énergie vibratoire se concentre dans la bande 40-120 Hz, en dessous de la rotation des moteurs : signature d'une résonance de châssis (bras, caméra, stack) excitée par les moteurs. C'est la source classique du jello à l'image.",
    evidenceHit: (axis: string, resonanceRms: string, motorRms: string) =>
      `${axis} : 40-120 Hz = ${resonanceRms} vs plage moteur = ${motorRms}`,
    evidencePeak: (freqHz: string, axis: string, motor: string, distanceHz: string) =>
      ` | pic dominant ${freqHz} Hz (axe ${axis}), le plus proche de ${motor} (écart ${distanceHz} Hz)`,
    fix: 'Soft-mount la FC (silentblocks en bon état), vérifie le serrage des bras et du support caméra, ajoute un amortissement TPU si un élément vibre en sympathie.',
  },

  motorNoisePeak: {
    title: (motor: string) => `Pic de bruit à la fondamentale de ${motor}`,
    detail: (motor: string, rpmNote: string) =>
      `Le pic dominant du spectre colle à la vitesse de rotation de ${motor} : le bruit vient de ce moteur ou de son hélice (balourd).${rpmNote}`,
    rpmNoteNoErpm:
      ' Pas de télémétrie eRPM dans le log : le filtre RPM ne peut pas fonctionner (il faut dshot_bidir et un ESC compatible).',
    rpmNoteWeakAttenuation: (attenuationDb: string) =>
      ` L'atténuation dans la plage moteur n'est que de ${attenuationDb} dB : le filtre RPM semble inactif ou inefficace, vérifie qu'il est bien configuré.`,
    evidence: (freqHz: string, axis: string, distanceHz: string, motor: string) =>
      `Pic dominant ${freqHz} Hz sur ${axis}, à ${distanceHz} Hz de la rotation de ${motor}`,
    fix: (motor: string) =>
      `Équilibre ou remplace l'hélice de ${motor}, vérifie l'axe du moteur (voilé après crash ?) et le serrage de l'écrou.`,
  },

  filtersWeak: {
    title: 'Filtrage insuffisant dans la plage moteur',
    detail: (attenuationDb: string, axis: string) =>
      `Entre gyro brut et gyro filtré, la bande 120-350 Hz n'est atténuée que de ${attenuationDb} dB sur ${axis} : le bruit moteur passe les filtres. Un filtre RPM actif écrase normalement cette bande de 20 dB ou plus.`,
    evidence: (perAxis: string) => `Atténuation 120-350 Hz : ${perAxis} dB (attendu ≥ 15 dB)`,
    fix: "Vérifie que le filtre RPM est actif (dshot_bidir + pôles moteur corrects), sinon baisse le multiplicateur de filtre gyro dans l'onglet tuning.",
  },

  filtersResidualHf: {
    title: 'Fuite haute fréquence vers les moteurs',
    detail: (axis: string) =>
      `Il reste du bruit au-dessus de 100 Hz dans le gyro filtré (${axis}). Ces hautes fréquences partent dans la commande moteur : les moteurs chauffent pour rien et les ESC encaissent.`,
    evidence: (perAxis: string, warn: number) =>
      `Résiduel >100 Hz : ${perAxis} (amplitude spectrale, seuil ${warn})`,
    fix: 'Renforce le filtrage gyro/D-term ou corrige la source mécanique. Touche les moteurs après un vol : tièdes = OK, brûlants = fuite confirmée.',
  },

  trackingPoor: {
    title: 'Suivi de consigne médiocre',
    detail: (axis: string, advice: string) =>
      `Le gyro s'écarte trop de la consigne stick sur ${axis} : le quad répond avec du retard ou de l'imprécision. ${advice}`,
    adviceCleanGyro:
      'Le gyro est propre : tu peux monter P (et le feedforward) sur cet axe pour resserrer le suivi.',
    adviceNoisyGyro:
      "Le gyro est bruité en même temps : corrige d'abord le bruit/filtrage - monter les PID sur un gyro sale amplifierait le bruit.",
    evidence: (perAxis: string, warn: number, crit: number) =>
      `Erreur moyenne : ${perAxis} deg/s (warn ${warn}, crit ${crit})`,
    fixCleanGyro: (axis: string) =>
      `Monte P et FF progressivement sur ${axis} (par pas de ~10 %), revole, recompare.`,
    fixNoisyGyro:
      'Règle le problème de bruit (voir verdicts vibrations/filtres) avant de toucher aux PID.',
  },

  step: {
    /** Suffixe ajouté aux evidence des règles step quand < 50 % des fenêtres sont exploitables. */
    qualityNote: (pct: number) => ` - confiance limitée (${pct} % des fenêtres exploitables)`,
  },

  stepOvershoot: {
    title: (axis: string) => `Dépassement excessif sur ${axis}`,
    detail:
      "La réponse indicielle dépasse nettement la consigne avant de se stabiliser : trop de P ou pas assez de D sur cet axe. En vol ça se traduit par des rebonds en fin de mouvement.",
    evidence: (perAxis: string, warn: number, qualityNote: string) =>
      `Overshoot : ${perAxis} % (seuil ${warn} %)${qualityNote}`,
    fix: (axis: string) =>
      `Baisse P d'environ 10 % ou monte D d'environ 10 % sur ${axis}, un seul changement à la fois.`,
  },

  stepSlow: {
    title: (axis: string) => `Réponse molle sur ${axis}`,
    detail: (filterNote: string) =>
      `Le temps de montée 10→90 % est long : le quad met du temps à atteindre la vitesse demandée. ${filterNote}`,
    filterNoteGainsLow: 'P/FF probablement trop bas.',
    filterNoteAggressive: (attenuationDb: string) =>
      `Les filtres sont très agressifs (${attenuationDb} dB d'atténuation) : la latence gyro qu'ils ajoutent peut expliquer la mollesse - allège le filtrage avant de monter les gains.`,
    evidence: (perAxis: string, warnMs: number, qualityNote: string) =>
      `Temps de montée : ${perAxis} ms (seuil ${warnMs} ms)${qualityNote}`,
    fix: "Monte FF (réactivité immédiate) puis P si besoin ; si les filtres sont en cause, remonte le multiplicateur gyro LPF d'un cran.",
  },

  stepSettleOff: {
    title: (axis: string) => `Stabilisation décalée sur ${axis}`,
    detail:
      "Après le transitoire, la réponse ne se stabilise pas à 1 (la consigne) : le taux atteint dérive par rapport à la demande. C'est typiquement l'I-term (trop bas si <1, trop haut ou en lutte si >1) ou un feedforward mal calibré.",
    evidence: (axis: string, settleValue: string, qualityNote: string) =>
      `Valeur de stabilisation ${axis} = ${settleValue} (attendu entre 0.85 et 1.15)${qualityNote}`,
    fix: (axis: string) =>
      `Ajuste I sur ${axis} : monte-le si la réponse plafonne sous la consigne, baisse-le si elle reste au-dessus.`,
  },

  motorsSaturation: {
    title: 'Moteurs en saturation',
    detail:
      'Les moteurs tapent le maximum une partie du vol : la boucle PID perd toute autorité pendant ces instants (oscillations, wobbles en punch). Quad trop chargé, gains trop hauts ou pack trop faible.',
    evidence: (pct: string, warn: number, crit: number) =>
      `Saturation ${pct} % du vol (warn ${warn} %, crit ${crit} %)`,
    fix: 'Allège le quad ou baisse le master multiplier ; vérifie aussi que le pack tient la tension sous charge.',
  },

  motorsImbalance: {
    title: 'Déséquilibre entre moteurs',
    detail: (motorHigh: string, motorLow: string) =>
      `${motorHigh} travaille nettement plus que ${motorLow} pour tenir le quad à plat : centre de gravité décalé (pack, caméra), hélice voilée ou moteur fatigué de ce côté.`,
    evidence: (m1: string, m2: string, m3: string, m4: string, spread: string, warn: number) =>
      `Moyennes moteur : M1 ${m1} / M2 ${m2} / M3 ${m3} / M4 ${m4} % - écart ${spread} pts (seuil ${warn})`,
    fix: (motorHigh: string) =>
      `Recentre le pack sur le châssis et inspecte l'hélice/le moteur ${motorHigh}.`,
  },

  motorsDesync: {
    title: (motors: string) => `Desync détecté sur ${motors}`,
    detail:
      "L'eRPM tombe à zéro en vol : le moteur décroche ou l'ESC perd la synchronisation. C'est un crash en attente - problème d'ESC (firmware, timing), de connexion moteur ou de roulement grippé.",
    evidence: (zeros: string) => `eRPM zéros en vol par moteur : [${zeros}]`,
    fix: (motors: string) =>
      `Contrôle les soudures et le connecteur du moteur ${motors}, fais-le tourner à la main (point dur = roulement), et vérifie le firmware/timing ESC. Ne revole pas avant.`,
  },

  batterySag: {
    title: 'Sag batterie important',
    detail:
      'La tension chute fortement sous charge : pack fatigué (résistance interne en hausse) ou connectique résistive (XT30/XT60 oxydé, soudures). Moins de punch et risque de coupure en fin de pack.',
    evidence: (sagTotal: string, perCell: string, warn: number, crit: number, minPerCell: string) =>
      `Sag ${sagTotal} V total soit ${perCell} V/cellule (warn ${warn}, crit ${crit}) - min ${minPerCell} V/cellule sous charge`,
    fix: 'Teste avec un pack neuf pour comparer ; si le sag persiste, inspecte connecteur et soudures du fil de puissance.',
  },

  batteryEmpty: {
    title: 'Batterie tirée trop bas',
    detail: (critPerCell: string) =>
      `La tension est descendue sous ${critPerCell} V/cellule en vol : à ce niveau on dégrade le pack de façon permanente (perte de capacité, gonflement).`,
    evidence: (minPerCell: string, critPerCell: string) =>
      `Minimum ${minPerCell} V/cellule (seuil ${critPerCell} V)`,
    fix: 'Atterris plus tôt : règle une alarme vbat/à la radio, et recharge ce pack en mode storage-check pour évaluer les dégâts.',
  },

  batteryCellsUnexpected: {
    title: 'Nombre de cellules inattendu',
    detail: (cells: number, profileLabel: string, expectedCells: number) =>
      `Le log montre un pack ${cells}S alors que le profil ${profileLabel} attend du ${expectedCells}S : mauvais pack branché, ou profil mal détecté.`,
    evidence: (cells: number, vbatMax: string, expectedCells: number) =>
      `Détecté ${cells}S (vbat max ${vbatMax} V), attendu ${expectedCells}S`,
    fix: 'Vérifie le pack utilisé - un surplus de cellules peut griller ESC/moteurs, un déficit écrase les perfs.',
  },

  yoyoDetected: {
    titleWarn: 'Yoyo détecté (oscillation de poussée)',
    titleInfo: 'Indice de yoyo (à confirmer)',
    detail: (confirmNote: string) =>
      `La poussée collective oscille plus que ce que commande le stick des gaz : le quad "pompe" verticalement. Causes classiques : I/anti-gravity trop agressifs, vibrations qui polluent la boucle, ou filtrage qui déphase la correction.${confirmNote}`,
    confirmNote:
      ' Métrique sensible au style de vol sur ce type de machine : confirme visuellement (le quad monte/descend tout seul en palier ?) avant de retoucher quoi que ce soit.',
    peak: (freqHz: string, mag: string) => `${freqHz} Hz (mag ${mag})`,
    evidence: (ratio: string, warn: number, peaks: string) =>
      `Ratio sd(poussée)/sd(stick) = ${ratio} (seuil ${warn})${peaks ? ` - pics d'oscillation : ${peaks}` : ''}`,
    fix: "Baisse anti_gravity_gain d'un cran et vérifie le bruit gyro ; si l'oscillation est lente (<2 Hz), regarde aussi l'I-term.",
  },

  propwashUntested: {
    title: 'Prop wash non évalué',
    detail:
      'Le vol ne contient pas de descente franche à bas régime : impossible de juger le comportement en prop wash sur ce log.',
    evidence: 'Aucune descente throttle bas détectée dans ce vol',
  },

  propwashSevere: {
    title: 'Prop wash marqué en descente',
    detail:
      "En descente dans ses propres remous, le quad tremble fort : les hélices brassent un air désordonné et la boucle PID peine à suivre. Un peu de prop wash est normal, à ce niveau ça se voit à l'image.",
    evidence: (worst: string, warn: number, eventCount: number, avg: string | null) =>
      `Sévérité max ${worst} deg/s RMS (seuil ${warn}) sur ${eventCount} événement(s)` +
      (avg !== null ? `, moyenne ${avg}` : ''),
    fix: 'Monte D (ou active/renforce dynamic idle si tu as le RPM filter), et vole avec des hélices en bon état.',
  },

  oscillationEvent: {
    title: (freq: string | null) =>
      freq !== null ? `Oscillation ${freq} Hz en vol` : 'Oscillation en vol',
    detail:
      "La boucle PID est partie en oscillation : les moteurs se battent entre eux à une fréquence trop rapide pour venir du pilotage. Ça monte en amplitude tout seul et ça finit en butée, moteur à fond d'un côté et coupé de l'autre. Causes classiques : trop de D (ou de P), du bruit moteur qui fuit dans le D-term par manque de filtrage, ou une notch dynamique qui ne couvre pas les fondamentales.",
    evidence: (
      tStart: string,
      duration: string,
      freq: string | null,
      ratio: string,
      satPct: string,
      motors: string | null,
      others: number,
    ) =>
      `À t=${tStart} s pendant ${duration} s` +
      (freq !== null ? `, ${freq} Hz` : '') +
      `, amplitude ${ratio}x le régime normal, ${satPct} % des échantillons en butée` +
      (motors !== null ? ` (${motors})` : '') +
      (others > 1 ? ` - ${others} épisodes au total` : ''),
    fix: "Refais le vol avec le master PID à 0.7 pour confirmer que ça vient du tune. Vérifie que dyn_notch_count est à 3 et que dyn_notch_min_hz descend sous ta fondamentale moteur la plus basse, sinon le bruit passe dans le D-term.",
  },

  batteryReadingsImplausible: {
    title: 'Mesures batterie incohérentes',
    detail:
      "Le log contient des tensions physiquement impossibles : au-dessus de la tension à vide alors que le drone tire beaucoup de courant. Sous charge une batterie ne peut que descendre. C'est l'ADC vbat qui décroche pendant les transitoires de courant, pas le pack qui remonte. Tant que c'est le cas, ni le sag ni la tension mini ne sont mesurables sur ce vol, et les verdicts batterie ont été retirés plutôt que de t'annoncer un pack mort à tort.",
    evidence: (count: number, vmax: string, vmin: string) =>
      `${count} échantillon(s) au-dessus de la tension de repos sous forte charge ; plage lue ${vmin} à ${vmax} V`,
    fix: "Vérifie le filtrage de la mesure vbat (condensateur sur l'entrée), les soudures du fil de puissance et le réglage vbat_scale. Refais un vol pour confirmer avant de conclure quoi que ce soit sur le pack.",
  },

  gpsLowSats: {
    title: 'Couverture GPS faible en vol',
    detail:
      'Le nombre de satellites est descendu sous 6 pendant le vol : le GPS rescue ne serait pas fiable à ce moment-là. Décoller avant le fix complet ou antenne masquée/parasitée.',
    evidence: (min: string, max: string | null) =>
      `Satellites : min ${min}${max !== null ? ` / max ${max}` : ''} (minimum sain : 6+)`,
    fix: "Attends 8+ sats avant de décoller ; éloigne l'antenne GPS de la VTX et de la caméra (interférences).",
  },

  failsafeTriggered: {
    title: 'Failsafe déclenché en vol',
    detail:
      'Le lien radio a été perdu au point de déclencher le failsafe : portée dépassée, antenne RX endommagée/mal orientée, ou interférence. À traiter avant tout le reste.',
    evidence: (phases: string) => `failsafePhase : {${phases}}`,
    fix: "Vérifie l'antenne RX (soudure, orientation), la config failsafe, et refais un range check avant de revoler loin.",
  },

  logQuality: {
    title: 'Qualité de log limitée',
    detail: (issues: string) => `Ce log ne permet pas une analyse complète : ${issues}.`,
    issueShortLog: (durationS: string) =>
      `log court (${durationS} s) : les verdicts sont moins fiables`,
    issueLowSampleRate: (rateHz: string, nyquistHz: string) =>
      `échantillonnage ${rateHz} Hz : le spectre est limité à ${nyquistHz} Hz (fs/2), le bruit moteur haut peut être invisible`,
    evidence: (durationS: string, rateHz: string) =>
      `Durée ${durationS} s, échantillonnage ${rateHz} Hz`,
    fixLowRate: 'Passe le blackbox en pleine résolution pour les prochains logs de tuning.',
    fixShortLog: 'Vole au moins 30 s avec des mouvements variés pour un diagnostic fiable.',
  },

  allGood: {
    title: 'Tout est propre',
    detail: (profileLabel: string) =>
      `Aucun seuil warn/crit dépassé pour le profil ${profileLabel} : mécanique saine, filtrage efficace et tune cohérent sur ce vol. Continue comme ça.`,
    strongUnfilt: (value: string) => `bruit brut max ${value} deg/s`,
    strongFilt: (value: string) => `bruit filtré max ${value} deg/s`,
    strongTracking: (value: string) => `erreur de suivi max ${value} deg/s`,
    strongSaturation: (pct: string) => `saturation ${pct} %`,
    strongSag: (perCell: string) => `sag ${perCell} V/cellule`,
  },

  // Labels et notes des profils drones (ex-DroneProfile.label/notes) -
  // indexés par DroneProfileId, résolus à l'affichage via dict.rules.profiles[id].
  profiles: {
    pico: {
      label: 'BetaFPV Pavo Pico (cinewhoop 2S)',
      notes: [
        'Cinewhoop 2S ducted : le bruit mécanique est naturellement élevé, seuils relevés en conséquence.',
        "Yoyo historique sur la poussée : seuil ratio abaissé à 1.3 pour l'attraper tôt.",
      ],
    },
    lr4: {
      label: 'Flywoo Explorer LR4 4" (long range 4S GPS)',
      notes: [
        'Long range 4" avec GPS + baro : priorité au suivi propre et à la santé du pack.',
        'Moins de 6 satellites en vol = GPS rescue non fiable, alerte dédiée.',
      ],
    },
    chimera7: {
      label: 'iFlight Chimera7 Pro V2 7" (6S)',
      notes: [
        'Grand châssis 7" : surveille la bande 40-120 Hz (résonance bras/caméra, source de jello).',
        "Équilibrage hélices critique : un pic à la fondamentale moteur se voit direct à l'image.",
      ],
    },
    generic: {
      label: 'Profil générique',
      notes: ['Profil générique : seuils médians 5", nombre de cellules non vérifié.'],
    },
  },
};

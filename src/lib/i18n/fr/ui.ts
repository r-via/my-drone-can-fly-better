// Chaînes de l'interface (layout, page, composants, graphes) - référence FR.
// Pas de `as const` : les chaînes doivent rester typées `string` pour que les
// traductions (const en: Dict = …) puissent porter d'autres textes.

export const ui = {
  // Header / footer / switcher de langue (layout).
  app: {
    logo: 'MY DRONE CAN FLY BETTER',
    headerTagline: 'Analyse 100 % locale - tes logs ne quittent pas ton navigateur.',
    footer:
      "Analyse déterministe - chaque verdict est traçable à une règle explicite. Rien n'est envoyé sans ton accord.",
    languageLabel: 'Langue',
    supportKofi: 'Soutenir sur Ko-fi',
    footerKofi: 'Ce site te fait gagner des packs ? Offre un café :',
    joinDiscord: 'Discord',
    viewSource: 'Le code sur GitHub',

    // src/components/ServiceWorkerRegister.tsx - mise à jour hors ligne.
    updateAvailable: 'Nouvelle version disponible',
    updateReload: 'Recharger',
    updateDismiss: 'Plus tard',
  },

  // Remerciements (page d'accueil) - les pseudos sont dans src/lib/credits.ts.
  credits: {
    title: 'Remerciements',
    intro:
      'Merci aux pilotes qui ont fait avancer le site : tests, logs partagés, bugs remontés et bonnes idées.',
  },

  // Unités dépendantes de la langue (Mo/Ko ↔ MB/KB).
  units: {
    mega: 'Mo',
    kilo: 'Ko',
  },

  // Page d'accueil (hero, étapes, bouton, erreurs de lecture, spinner).
  page: {
    heroTagline: 'Ton vol, décodé.',
    heroIntro:
      "Glisse tes logs blackbox Betaflight : My Drone Can Fly Better les décode et te sort des verdicts chiffrés - vibrations, filtres, PID, moteurs, batterie - avec les commandes CLI prêtes à coller. Pas d'upload : du signal et des règles, tout est traçable.",
    heroAria: 'Présentation',
    steps: [
      {
        title: 'Glisse tes logs',
        text: '.bbl ou .bfl, direct depuis la carte SD ou la GUI. Plusieurs fichiers d’un coup si tu veux.',
      },
      {
        title: 'Analyse locale',
        text: 'Décodage, DSP et règles déterministes - tout tourne dans ton navigateur, rien ne part sur un serveur.',
      },
      {
        title: 'Corrige en 30 s',
        text: 'Verdicts chiffrés, graphes, et commandes CLI prêtes à coller dans Betaflight.',
      },
    ],
    uploadAria: 'Dépôt des logs',
    analyzeButton: (count: number): string =>
      count > 1 ? `Analyser les ${count} logs` : 'Analyser le log',
    workingFallback: 'Analyse en cours…',
    readingFiles: 'Lecture des fichiers…',
    privacyNote: "Ça tourne dans ton navigateur - rien n'est envoyé nulle part.",
    errorTitle: 'Analyse impossible',
    errorUnknown: 'Erreur inconnue.',
    readErrorNotReadable:
      'Fichier illisible - la carte SD a peut-être été éjectée, ou le fichier a changé depuis sa sélection. Re-sélectionne-le.',
    readErrorWithMessage: (message: string): string =>
      `Lecture du fichier impossible : ${message}`,
    readErrorGeneric: 'Lecture du fichier impossible.',
  },

  // UploadZone.
  upload: {
    dropTitle: 'Glisse tes logs blackbox ici',
    dropBrowse: ' - ou clique pour parcourir',
    dropHelp: '.bbl / .bfl · plusieurs fichiers acceptés · rien ne quitte ton navigateur',
    rejected: (names: string): string => `Ignoré (ni .bbl ni .bfl) : ${names}`,
    selectedFilesAria: 'Fichiers sélectionnés',
    removeFile: (name: string): string => `Retirer ${name}`,
  },

  // Sévérités (badges FindingCard) et verdict global de session.
  severity: {
    crit: 'Critique',
    warn: 'Attention',
    info: 'Info',
    ok: 'OK',
  },
  verdict: {
    ok: 'Nickel - rien à signaler',
    info: 'Propre - quelques observations',
    warn: 'À surveiller - des points à corriger',
    crit: 'Critique - corrige avant de revoler',
  },

  // Catégories de findings (clés = FindingCategory).
  categories: {
    securite: 'Sécurité',
    vibrations: 'Vibrations',
    filtres: 'Filtres',
    pid: 'PID',
    moteurs: 'Moteurs',
    batterie: 'Batterie',
    config: 'Config',
    gps: 'GPS',
    log: 'Log',
  },

  // FindingCard.
  finding: {
    evidenceSummary: 'Les chiffres derrière ce verdict',
    fixTitle: 'Correctif',
  },

  // MetricTile - annonce lecteur d'écran du point de tonalité.
  metricTone: {
    ok: 'état : bon',
    warn: 'état : à surveiller',
    crit: 'état : critique',
  },

  // SessionPicker.
  sessionPicker: {
    listAria: 'Sessions du fichier',
  },

  // ReportView.
  report: {
    title: 'Rapport de vol',
    newAnalysis: 'Nouvelle analyse',
    flightsAria: 'Vols analysés',
    fileAria: (fileName: string): string => `Rapport ${fileName}`,
    validSessions: (count: number): string =>
      `${count} ${count > 1 ? 'sessions valides' : 'session valide'}`,
    skippedSessions: (count: number): string =>
      `${count} ${count > 1 ? 'ignorées' : 'ignorée'}`,
    skippedSession: (index: string, error: string, size: string): string =>
      `Session ${index} ignorée - ${error} (${size})`,
    /** Bloc global sous les onglets : fichiers dont aucune session n'est exploitable. */
    skippedOrphanSummary: (count: number): string =>
      count > 1
        ? `${count} sessions ignorées - fichiers sans vol exploitable`
        : `1 session ignorée - fichier sans vol exploitable`,
    /** Bloc du vol affiché : sessions écartées du même fichier. */
    skippedInFileSummary: (count: number): string =>
      count > 1
        ? `${count} autres sessions ignorées dans ce fichier`
        : `1 autre session ignorée dans ce fichier`,
    sessionLabel: (index: string): string => `Session ${index}`,
    sessionSublabel: (duration: string, start: string): string => `${duration} · t+${start}`,
    noUsableSession: 'Aucune session exploitable dans ce fichier - voir les raisons ci-dessus.',
    /** Tranche grise de la jauge et chip grisée : axe sans données dans le log. */
    axisNotEvaluated: (label: string): string => `${label} : non évaluée - données absentes du log`,
    scoreCappedNote: "Score plafonné à 95 : un axe n'est pas mesuré (zone grise).",
    /** Tooltip d'une tranche de la jauge. */
    axisNoData: 'non évaluée - données absentes',
    axisShare: (pct: number): string => `${pct} % du score`,
    axisGoto: 'Clic : voir les verdicts de cet axe',
    axisDetails: {
      securite: 'Failsafe déclenché en vol.',
      vibrations: 'Bruit mécanique du gyro brut, résonance châssis, balourd hélice/moteur.',
      filtres: 'Atténuation du bruit moteur, bruit résiduel après filtrage, fuites hautes fréquences.',
      pid: 'Suivi de consigne, réponse indicielle (dépassement, lenteur, stabilisation), oscillations, prop wash, yoyo.',
      moteurs: 'Saturation, déséquilibre entre moteurs, désynchronisations.',
      batterie: 'Sag sous charge, décharge profonde, cohérence du capteur, nombre de cellules.',
    },
    profileTag: (label: string): string => `profil ${label}`,
    tileDuration: 'Durée de session',
    tileSampleRate: 'Échantillonnage',
    tileBattery: 'Batterie',
    batterySag: (sag: string, perCell: string): string => `sag ${sag} V (${perCell} V/cell)`,
    batteryRange: (min: string, max: string): string => `${min}–${max} V`,
    batteryNoVbat: 'pas de mesure vbat',
    tileMaxCurrent: 'Courant max',
    currentAvg: (avg: string): string => `moyenne ${avg} A`,
    currentUnreliable: 'capteur non fiable, valeur ignorée',
    tileSaturation: 'Saturation moteurs',
    tileFlightTime: 'Temps de vol',
    flightTimeHint: "throttle réellement en l'air",
    timelineCaption: 'Timeline du vol',
    timelineEventLine: (
      tStart: string,
      duration: string,
      freq: string,
      ratio: string,
      satPct: string,
      motors: string | null,
      gyroDps: string,
    ): string =>
      `Oscillation mesurée à ${tStart} s, pendant ${duration} s : ${freq} Hz sur le différentiel moteur, amplitude ${ratio} fois le régime normal du vol, ${satPct} % des échantillons avec au moins un moteur en butée` +
      (motors !== null ? ` (${motors})` : '') +
      `. Crête gyro pendant l'épisode : ${gyroDps} °/s.`,
    timelineEventIntro: 'Ce que la mesure dit, sans interprétation :',
    noFindings: 'Aucune règle déclenchée sur cette session.',
  },

  // CliExport.
  cli: {
    sectionAria: 'Commandes CLI',
    title: 'Commandes CLI',
    countSuffix: (count: number): string => `(${count} + save)`,
    nothingToFix: 'Rien à corriger côté CLI - ta config tient la route.',
    copyAll: 'Copier tout',
    copied: 'Copié !',
    copiedSr: 'Commandes copiées dans le presse-papiers',
    verifyNote: "Vérifie chaque ligne avant de coller - c'est toi qui pilotes, pas le rapport.",
    saveWarnBefore: 'Sauvegarde en tapant ',
    saveWarnCode: 'save',
    saveWarnAfter:
      ' dans le CLI, pas avec le bouton Save de la GUI : sur certaines versions il peut effacer toute ta config (bug connu).',
  },

  // Bouton d'opt-in : partage du .bbl brut avec le dev (bas de ReportView).
  shareLog: {
    title: "Aider à améliorer l'outil",
    description:
      "Envoie le(s) log(s) .bbl brut(s) de cette analyse à Rémi (dev du site) : le fichier est déposé sur le stockage privé du site et un lien de téléchargement est posté sur un salon privé. Ça sert à repérer des cas réels que les règles ratent. Rien n'est envoyé tant que tu n'as pas cliqué sur le bouton.",
    buttonLabel: (count: number): string =>
      count > 1 ? `Partager les ${count} logs` : 'Partager ce log',
    sending: 'Envoi en cours…',
    sendingPart: (done: number, total: number): string => `Envoi ${done}/${total}…`,
    sent: 'Log envoyé - merci !',
    error: "Échec de l'envoi - réessaie plus tard.",
    tooLarge: 'Plus de 100 Mo de logs - trop volumineux pour un envoi automatique.',
  },

  shareLink: {
    title: 'Partager ce rapport',
    description:
      "Le rapport entier tient dans le lien lui-même : rien n'est déposé sur un serveur, et ton .bbl ne quitte pas ta machine. Qui l'ouvre voit ce rapport dans sa propre langue.",
    button: 'Copier le lien',
    copied: 'Lien copié',
    copiedSr: 'Lien de partage copié dans le presse-papiers',
    building: 'Préparation…',
    error: "Impossible de préparer le lien.",
    charCount: (n: number): string => `${n} caractères`,
    trimmed: "Les graphes ne tenaient pas dans le lien : il porte le score, les verdicts et les chiffres, pas les courbes.",
    overBudget:
      "Ce lien dépasse les 2000 caractères d'un message Discord. Il fonctionne, mais il faudra le passer autrement (MP, forum, raccourcisseur).",
    // Bandeau affiché en haut d'un rapport ouvert depuis un lien.
    bannerTitle: 'Rapport reçu par lien',
    bannerText:
      "Ce rapport a été calculé sur la machine de quelqu'un d'autre, puis encodé dans l'adresse. Pour analyser ton propre vol, repars d'un log.",
    bannerCta: 'Analyser mon log',
    decodeErrorMalformed: 'Ce lien de partage est incomplet ou abîmé.',
    decodeErrorVersion: "Ce lien vient d'une version plus récente du site. Recharge la page, puis redemande-le.",
  },

  // ChartHelp - bouton « Comment lire » + panneau latéral pédagogique par graphe.
  chartHelp: {
    buttonLabel: 'Comment lire',
    buttonAria: (chart: string): string => `Comment lire : ${chart}`,
    closeAria: "Fermer l'aide",
    readTitle: 'Comment la lire',
    examplesTitle: 'Exemples',
    goodTag: 'Bien',
    badTag: 'Pas bien',
    timeline: {
      title: 'La timeline du vol',
      intro:
        'Cette frise raconte la session de gauche à droite : ce que faisait le quad (au sol, gaz bas, en vol), la tension batterie en surimpression, et les incidents détectés.',
      points: [
        'Chaque couleur est un état : les blocs verts sont les moments réellement en vol.',
        'La ligne jaune est la tension batterie : elle doit descendre doucement et régulièrement pendant le vol.',
        "Un triangle d'alerte marque un incident détecté : sa position dit quand, son étiquette la fréquence mesurée.",
        "Une chute brutale de la ligne jaune = la batterie s'écroule sous la charge (batterie fatiguée ou trop sollicitée).",
      ],
      examples: {
        good: 'Vol continu, tension en pente douce, aucun marqueur : rien à signaler.',
        bad: "Marqueurs d'alerte en plein vol et tension qui plonge par à-coups : incidents à corriger, batterie qui souffre.",
      },
    },
    spectrum: {
      title: 'Le spectre gyro',
      intro:
        'Un quad vibre toujours un peu. Ce graphe trie ces vibrations par fréquence (en Hz) : à gauche les lentes, à droite les rapides. Plus un pic est haut, plus la vibration est forte.',
      points: [
        "Un pic fin près de la ligne pointillée « moteurs » est normal : c'est la rotation des hélices.",
        "La zone « résonance » doit rester basse : une bosse ici, c'est le châssis qui vibre (le jello à l'image).",
        'Partout ailleurs, la courbe doit rester collée en bas (le « plancher »).',
        'Les trois couleurs sont les trois axes (Roll, Pitch, Yaw) : ils doivent avoir la même allure.',
        "Si les courbes s'arrêtent avant le bord droit (zone hachurée « non mesurable »), le log est enregistré trop lentement : le spectre ne peut rien voir au-delà de la moitié de la cadence d'enregistrement. Logue plus vite (blackbox_sample_rate) pour couvrir toute la plage.",
      ],
      examples: {
        good: 'Plancher bas et plat, un seul pic fin à la fréquence des moteurs : quad sain.',
        bad: 'Grosse bosse dans la zone résonance et plancher chargé : vibrations mécaniques - vérifie hélices, roulements et fixations.',
      },
    },
    step: {
      title: 'La réponse indicielle',
      intro:
        "On simule un coup de stick franc et on regarde comment le quad suit l'ordre. La ligne pointillée « cible 1.0 » est exactement l'ordre demandé : la courbe idéale y monte vite et y reste.",
      points: [
        'La courbe doit grimper vite vers la cible : plus elle monte tôt, plus le quad répond vite.',
        'Un léger dépassement au-dessus de la cible (moins de ~15 %) est acceptable.',
        'Après le pic, la courbe doit se poser sur la ligne cible sans faire de vagues.',
        'Des rebonds répétés = le quad oscille après chaque ordre : tune trop nerveux.',
      ],
      examples: {
        good: 'Montée franche, léger dépassement, puis la courbe se pose sur la cible : tune équilibré.',
        bad: 'Gros dépassement puis rebonds : le quad sur-réagit et oscille (P trop haut ou D trop bas).',
        badSlow:
          "Montée molle qui n'atteint la cible que très tard : le quad traîne derrière les sticks (P faible ou filtrage trop lourd).",
      },
    },
  },

  // Graphes SVG - objets plats passés en prop `labels` (composants purs, sans hook).
  charts: {
    spectrum: {
      title: 'Spectre gyro (0–1 kHz)',
      scaleNote: 'amplitude gyro - échelle √ (les pics dominants restent comparables)',
      ariaLabel: (title: string): string => `${title} - axes Roll, Pitch et Yaw superposés`,
      bandResonance: 'résonance',
      bandMotors: 'moteurs',
      xAxis: 'Fréquence (Hz)',
      motorLine: (hz: string): string => `moteurs ~${hz} Hz`,
      beyondNyquist: (hz: string): string => `non mesurable - log enregistré à ${hz} Hz`,
    },
    step: {
      title: 'Réponse indicielle (0–500 ms)',
      ariaLabel: 'Réponse indicielle Roll, Pitch, Yaw - cible 1.0, fenêtre 0 à 500 ms',
      overshootZone: "zone d'overshoot",
      targetLine: 'cible 1.0',
      xAxis: 'Temps (ms)',
      axisMissing: (axis: string): string => `${axis} (n/a)`,
      noData: "Pas assez d'excitation stick pour estimer la réponse.",
    },
    timeline: {
      ariaLabel: (duration: string, segmentCount: string): string =>
        `Timeline du log : ${duration}, ${segmentCount} segments (au sol / gaz bas / en vol)`,
      stateIdle: 'au sol',
      stateLow: 'gaz bas',
      stateFlight: 'en vol',
      vbat: 'vbat',
      noSegments: 'Aucun segment détecté.',
      eventsAria: (count: string, times: string): string =>
        `${count} événement(s) signalé(s) à ${times}`,
      eventsLegend: 'oscillation détectée',
    },
  },
};

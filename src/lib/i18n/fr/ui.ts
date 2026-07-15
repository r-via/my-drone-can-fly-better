// Chaînes de l'interface (layout, page, composants, graphes) - référence FR.
// Pas de `as const` : les chaînes doivent rester typées `string` pour que les
// traductions (const en: Dict = …) puissent porter d'autres textes.

export const ui = {
  // Header / footer / switcher de langue (layout).
  app: {
    logo: 'MY DRONE CAN FLY BETTER',
    headerTagline: 'Analyse 100 % locale - tes logs ne quittent pas ton navigateur.',
    footer:
      'Analyse déterministe - chaque verdict est traçable à une règle open source. Aucune donnée envoyée.',
    languageLabel: 'Langue',
    supportKofi: 'Soutenir sur Ko-fi',
    footerKofi: 'Ce site te fait gagner des packs ? Offre un café :',
  },

  // Unités dépendantes de la langue (Mo/Ko ↔ MB/KB).
  units: {
    mega: 'Mo',
    kilo: 'Ko',
  },

  // Page d'accueil (hero, étapes, bouton, erreurs de lecture, spinner).
  page: {
    heroTitle: 'My Drone Can Fly Better',
    heroTagline: 'Ton vol, décodé. Sans IA.',
    heroIntro:
      "Glisse tes logs blackbox Betaflight : My Drone Can Fly Better les décode et te sort des verdicts chiffrés - vibrations, filtres, PID, moteurs, batterie - avec les commandes CLI prêtes à coller. Pas d'IA, pas d'upload : du signal et des règles, tout est traçable.",
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
    pasteSummaryBefore: 'Colle ton ',
    pasteSummaryCode: 'diff all',
    pasteSummaryAfter: ' (optionnel - sinon je lis la config depuis le log)',
    pasteLabel: 'Sortie de la commande diff all de Betaflight',
    pastePlaceholder:
      '# diff all\n# version\n# Betaflight / …\nset gyro_lpf1_static_hz = 250\n…',
    pasteNote: "Le diff collé prime sur les headers du log pour l'analyse de config.",
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
    configAria: 'Analyse de la config',
    configTitle: 'Config',
    configSourcePaste: '(diff all collé)',
    configSourceHeaders: '(headers du log)',
    fileAria: (fileName: string): string => `Rapport ${fileName}`,
    validSessions: (count: number): string =>
      `${count} ${count > 1 ? 'sessions valides' : 'session valide'}`,
    skippedSessions: (count: number): string =>
      `${count} ${count > 1 ? 'ignorées' : 'ignorée'}`,
    skippedSession: (index: string, error: string, size: string): string =>
      `Session ${index} ignorée - ${error} (${size})`,
    sessionLabel: (index: string): string => `Session ${index}`,
    sessionSublabel: (duration: string, start: string): string => `${duration} · t+${start}`,
    noUsableSession: 'Aucune session exploitable dans ce fichier - voir les raisons ci-dessus.',
    profileTag: (label: string): string => `profil ${label}`,
    tileDuration: 'Durée de session',
    tileSampleRate: 'Échantillonnage',
    tileBattery: 'Batterie',
    batterySag: (sag: string, perCell: string): string => `sag ${sag} V (${perCell} V/cell)`,
    batteryRange: (min: string, max: string): string => `${min}–${max} V`,
    batteryNoVbat: 'pas de mesure vbat',
    tileMaxCurrent: 'Courant max',
    currentAvg: (avg: string): string => `moyenne ${avg} A`,
    tileSaturation: 'Saturation moteurs',
    tileFlightTime: 'Temps de vol',
    flightTimeHint: "throttle réellement en l'air",
    timelineCaption: 'Timeline du vol',
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
    },
  },
};

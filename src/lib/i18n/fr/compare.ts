// Chaînes de la comparaison de passes (compare.ts) - référence FR.
// Les libellés d'indicateur restent volontairement courts : ils vivent dans une
// table à quatre colonnes (avant / après / delta), pas dans une phrase.

export const compare = {
  title: 'Comparaison de passes',
  /** Libellé court de l'onglet Comparaison dans la barre d'onglets de vol. */
  tabLabel: 'Comparaison',
  tabCount: (n: number): string => `${n} ${n > 1 ? 'paires' : 'paire'}`,
  /** En-tête d'une comparaison : quel vol contre quel vol. */
  heading: (before: string, after: string) => `${before} → ${after}`,
  sessionLabel: (fileName: string, session: string) => `${fileName} session ${session}`,
  noTuneChange:
    "Aucun réglage n'a changé entre ces deux vols : les écarts ci-dessous viennent du vol lui-même, pas du tune.",
  /** Ligne de résumé d'une carte repliée. */
  summaryNoChange: 'aucun réglage changé',
  summaryChanges: (n: number) => `${n} ${n > 1 ? 'réglages changés' : 'réglage changé'}`,
  caveatsCount: (n: number) => `${n} ${n > 1 ? 'réserves' : 'réserve'}`,
  tuneTitle: 'Ce qui a changé',
  metricsTitle: 'Ce que la mesure en dit',
  driverNote:
    'Les curseurs simplifiés sont en tête : ce sont eux qui recalculent les gains listés en dessous, pas l’inverse.',
  /** Colonne delta quand la comparaison n'a pas de sens (pire axe différent). */
  deltaUnavailable: 'axes différents',
  metricUnavailable: 'n/a',

  metrics: {
    filtNoise: 'Bruit filtré (deg/s)',
    unfiltNoise: 'Bruit brut (deg/s)',
    tracking: 'Erreur de suivi (deg/s)',
    overshoot: 'Dépassement (%)',
    riseTime: 'Temps de montée (ms)',
    ms: 'Pic de sensibilité Ms',
    residualHf: 'Résiduel >100 Hz',
    propwash: 'Prop wash (deg/s)',
    saturation: 'Saturation moteurs (%)',
  },

  caveats: {
    inferredCraft: (board: string) =>
      `Vols regroupés par carte (${board}), faute de nom de drone dans les logs : renseigne un craft_name pour lever le doute. Si ces vols viennent de deux machines différentes montées sur la même carte, la comparaison n'a pas de sens.`,
    firmware: (before: string, after: string) =>
      `Firmware différent (${before} → ${after}) : un tune ne se transpose pas d'une version majeure à l'autre, et des paramètres changent de nom ou de sens. La comparaison de réglages n'est pas fiable.`,
    sampleRate: (before: string, after: string) =>
      `Fréquence d'échantillonnage différente (${before} → ${after} Hz) : le bruit résiduel et le spectre ne se comparent pas d'un log à l'autre.`,
    duration: (before: string, after: string) =>
      `Durées très différentes (${before} s → ${after} s) : le vol le plus court a vu moins de situations, ses pires valeurs sont mécaniquement plus basses.`,
    stickRange: (before: string, after: string) =>
      `Sollicitation manche différente (${before} → ${after} deg/s au maximum) : un vol plus calme baisse le dépassement et le prop wash sans qu'aucun réglage n'y soit pour quelque chose.`,
    mechanical: (before: string, after: string) =>
      `Le gyro brut a changé (${before} → ${after} deg/s RMS). Il ne répond pas au tune : quelque chose a bougé mécaniquement entre les deux vols (hélice, roulement, visserie). Les écarts de bruit filtré ne mesurent donc plus le filtrage seul.`,
    battery: (before: string, after: string) =>
      `Sag par cellule très différent (${before} → ${after} V) sans compensation active : à consigne égale, la poussée n'est pas la même. Active vbat_sag_compensation ou revole à un niveau de pack comparable.`,
  },
};

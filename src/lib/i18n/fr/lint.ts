// Chaînes du lint de config CLI (src/lib/cli/config.ts) - référence FR.
// Une entrée par règle : title/detail/evidence/fix. Les entrées interpolées
// sont des fonctions fléchées ; les nombres arrivent déjà formatés (string).
// Pas de `as const` : les chaînes doivent rester typées `string` pour que les
// traductions (const xx: Dict = …) puissent porter d'autres textes.

export const lint = {
  rpmFilterOffBidir: {
    title: 'Filtre RPM désactivé alors que le DShot bidirectionnel est actif',
    detail:
      "Tu as le retour eRPM (dshot_bidir = ON) mais le filtre RPM est coupé. Tu paies le coût du DShot bidir sans profiter du meilleur filtre anti-bruit moteur disponible.",
    evidence: 'dshot_bidir = ON, rpm_filter_harmonics = 0',
    fix: 'Réactive le filtre RPM (3 harmoniques = valeur par défaut).',
  },
  noBidir: {
    title: 'DShot bidirectionnel désactivé',
    detail:
      "Ton protocole moteur est DShot mais sans retour eRPM. Active le bidir pour débloquer le filtre RPM : bruit moteur nettoyé à la source, LPF gyro/D-term plus hauts, moins de latence (firmware ESC BLHeli_32, Bluejay ou AM32 requis).",
    evidence: (protocol: string, bidirOff: boolean) =>
      `motor_pwm_protocol = ${protocol}, dshot_bidir = ${bidirOff ? 'OFF' : 'absent'}`,
    fix: 'Active le DShot bidirectionnel puis le filtre RPM.',
  },
  noNotchNoRpm: {
    title: 'Aucun filtrage adaptatif actif',
    detail:
      "Dynamic notch ET filtre RPM désactivés : seuls les LPF statiques protègent tes PID du bruit moteur. Risque réel de moteurs chauds, de D-term saturé et d'oscillations à haut régime.",
    evidence: 'dyn_notch_count = 0, rpm_filter_harmonics = 0',
    fix: 'Réactive au moins un des deux (filtre RPM si DShot bidir dispo, sinon dynamic notch).',
  },
  tpaNeverReached: {
    title: 'TPA jamais atteint sur ce vol',
    detail:
      "Le throttle n'a jamais dépassé le breakpoint TPA : l'atténuation des gains n'a donc jamais agi de tout le vol, les PID ont tourné à pleine valeur en permanence. Utile à savoir avant de chercher un problème de tune du côté de TPA.",
    evidence: (thrMax: string, bp: string) => `throttle max ${thrMax} µs, tpa_breakpoint ${bp} µs`,
  },
  filterCoverageSuspect: {
    title: 'Couverture de filtrage insuffisante',
    detail:
      "Le vol montre déjà une oscillation ou du bruit qui atteint la boucle, et le filtrage laisse un trou qui peut l'expliquer. Pris isolément, ces réglages sont banals et se rencontrent sur des machines parfaitement saines : ils ne sont signalés ici que parce qu'un symptôme est mesuré dans ce log. Betaflight estompe les notches du filtre RPM sous rpm_filter_min_hz + fade_range, et une seule notch dynamique ne peut pas suivre quatre moteurs qui s'écartent.",
    evidence: (motors: string | null, fadeTop: string | null, notch: string | null, def: number) =>
      [
        motors !== null ? `fondamentales sous le plafond de fade ${fadeTop} Hz : ${motors}` : null,
        notch !== null ? `dyn_notch_count = ${notch} (défaut ${def})` : null,
      ]
        .filter((x) => x !== null)
        .join(' ; '),
    fix: "Élargis la couverture avant de toucher aux PID : descends rpm_filter_min_hz sous ta fondamentale la plus basse, resserre fade_range, et remets 3 notches dynamiques. Refais le même vol pour comparer.",
  },
  dtermLpfLow: {
    title: 'LPF1 D-term très bas',
    detail: (hz: string) =>
      `Un LPF1 D-term à ${hz} Hz ajoute beaucoup de latence sur le D : amortissement mou et prop wash amplifié. Sous 70 Hz, c'est rarement justifié sur un quad sain.`,
    evidence: (hz: string) => `dterm_lpf1_static_hz = ${hz}`,
    fix: 'Remonte le LPF1 D-term vers 75-90 Hz (ou repasse en mode dynamique).',
  },
  gyroLpfLow: {
    title: 'LPF gyro conservateur malgré le filtre RPM',
    detail: (harmonics: string, hz: string) =>
      `Avec le filtre RPM actif (${harmonics} harmoniques), un LPF1 gyro statique à ${hz} Hz est probablement trop bas : tu ajoutes de la latence pour du bruit déjà traité.`,
    evidence: (key: string, hz: string, harmonics: string) =>
      `${key} = ${hz}, rpm_filter_harmonics = ${harmonics}`,
    fix: 'Essaie de remonter le LPF1 gyro (250 Hz par défaut) et vérifie le bruit résiduel au vol suivant.',
  },
  ffZero: {
    title: 'Feedforward à zéro',
    detail:
      "Sans feedforward, le quad ne réagit qu'à l'erreur déjà installée : la réponse stick est retardée. Ok pour du cinématique très lisse, pénalisant en freestyle/race.",
    fix: 'Remets du feedforward (≈100-125 en 4.5) si tu veux une réponse stick directe.',
  },
  antigravityOff: {
    title: 'Anti-gravity désactivé',
    detail:
      "anti_gravity_gain = 0 : l'I-term n'est pas boosté pendant les variations rapides de gaz, le nez peut plonger ou pomper sur les punchs.",
    evidence: 'anti_gravity_gain = 0',
    fix: "Remets la valeur par défaut si ce n'est pas un choix délibéré.",
  },
  motorLimit: {
    title: 'Limite de sortie moteur active',
    detail: (pct: string) =>
      `motor_output_limit = ${pct}% : la poussée max est bridée. Simple rappel au cas où ce n'est pas voulu (souvent utilisé pour voler avec une batterie de voltage supérieur).`,
    evidence: (pct: string) => `motor_output_limit = ${pct}`,
  },
  vbatWarning: {
    title: "Seuil d'alerte batterie inhabituel",
    detail: (volts: string) =>
      `Alerte batterie réglée à ${volts} V/cellule, hors de la plage usuelle 3.2-3.6 V : tu seras prévenu trop tôt ou trop tard.`,
    evidence: (raw: string, volts: string) =>
      `vbat_warning_cell_voltage = ${raw} (${volts} V/cellule)`,
    fix: 'Vise 3.4-3.5 V/cellule pour un usage LiPo classique.',
  },
};

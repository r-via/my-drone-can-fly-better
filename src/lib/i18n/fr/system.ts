// Chaînes système : erreurs du parseur bbl, messages de progression du worker,
// erreurs de lecture côté client - référence FR.
// Pas de `as const` : les chaînes doivent rester typées `string` pour que les
// traductions (const xx: Dict = …) puissent porter d'autres textes.

export const system = {
  // src/lib/bbl/parse.ts - erreurs utilisateur (sessions ignorées / fatales).
  noBlackboxHeader: 'Pas de header blackbox trouvé (fichier non .bbl ?)',
  sessionTooShort: (frames: string) =>
    `Session trop courte (${frames} frames) - probable blip d'armement`,
  flightTooShort: (seconds: string, minimum: string) =>
    `Vol trop court (${seconds} s) - il faut au moins ${minimum} s pour une analyse fiable`,
  // scripts/analyze-node.mjs - libellés du rapport terminal.
  cliSessionSkipped: (n: string, kb: string) => `session ${n} ignorée (${kb} ko)`,
  cliProfile: (label: string) => `profil ${label}`,
  cliVbatUnusable: (cells: string, count: string) =>
    `${cells}S vbat non mesurable (${count} échantillons incohérents)`,
  cliVbatRange: (cells: string, max: string, min: string, sag: string) =>
    `${cells}S ${max}→${min} V (sag ${sag} V)`,
  cliCurrentMax: (amps: string) => `courant max ${amps} A`,
  cliCurrentUnreliable: 'courant : capteur non fiable, valeur écartée',
  cliGpsSummary: (median: string, min: string, hdop: string | null) =>
    `GPS ${median} sats (min ${min}${hdop !== null ? `, HDOP ${hdop}` : ''})`,
  /** probes = liste "ESC 36→49" pré-jointe par le runner CLI. */
  cliTemps: (probes: string) => `Températures ${probes} °C`,
  headersUnreadable: 'Headers illisibles (session corrompue ?)',
  dataVersionUnsupported: 'Version de données inconnue du décodeur (fragment de log corrompu ?)',
  decoderRejected: (raw: string) => `Décodage impossible : ${raw}`,
  noFramesDecoded: 'Aucune frame décodée (données corrompues ?)',
  essentialFieldsMissing: 'Champs essentiels absents (gyroADC/setpoint/motor/rcCommand)',
  firmwareTooOld: (firmware: string, minimum: string) =>
    `Firmware trop ancien (${firmware}) - le décodeur demande ${minimum} au minimum`,
  firmwareNotSupported: (flavour: string) =>
    `Firmware non supporté : ${flavour} - seuls Betaflight et INAV sont décodés de façon fiable`,

  // src/worker/analyze.worker.ts - progression + erreur de chargement WASM.
  wasmLoadFailed: (httpStatus: string) =>
    `Chargement du décodeur WASM impossible (HTTP ${httpStatus})`,
  progressLoadingDecoder: 'Chargement du décodeur…',
  progressDecoding: (fileName: string) => `Décodage de ${fileName}…`,
  progressAnalyzing: 'Analyse (FFT, step response, règles)…',

  // src/lib/analyze-client.ts - pont UI ↔ worker.
  progressPreparing: 'Préparation…',
  workerUnexpectedError: 'Erreur inattendue dans le worker',
};

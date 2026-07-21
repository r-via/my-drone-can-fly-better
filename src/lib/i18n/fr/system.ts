// Chaînes système : erreurs du parseur bbl, messages de progression du worker,
// erreurs de lecture côté client - référence FR.
// Pas de `as const` : les chaînes doivent rester typées `string` pour que les
// traductions (const xx: Dict = …) puissent porter d'autres textes.

export const system = {
  // src/lib/bbl/parse.ts - erreurs utilisateur (sessions ignorées / fatales).
  noBlackboxHeader: 'Pas de header blackbox trouvé (fichier non .bbl ?)',
  sessionTooShort: (frames: string) =>
    `Session trop courte (${frames} frames) - probable blip d'armement`,
  headersUnreadable: 'Headers illisibles (session corrompue ?)',
  noFramesDecoded: 'Aucune frame décodée (données corrompues ?)',
  essentialFieldsMissing: 'Champs essentiels absents (gyroADC/setpoint/motor/rcCommand)',
  dataVersionUnsupported: 'Version de données inconnue du décodeur (fragment de log corrompu ?)',
  decoderRejected: (raw: string) => `Décodage impossible : ${raw}`,
  firmwareTooOld: (version: string, minimum: string) =>
    `Firmware trop ancien (Betaflight ${version}) - le décodeur demande ${minimum} au minimum`,
  firmwareNotSupported: (flavour: string) =>
    `Firmware non supporté : ${flavour} - seul Betaflight est décodé de façon fiable`,

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

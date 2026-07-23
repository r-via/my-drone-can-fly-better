// Adaptateur blackbox-log (WASM) → FlightData.
// Particularités gérées ici :
//  - le wrapper npm 0.2.2 refuse les firmwares hors de sa fenêtre (Betaflight
//    > 4.4, INAV hors 5.0-6.1) : on réécrit la chaîne de version dans les
//    headers (le format de frame est auto-décrit, validé contre orangebox sur
//    les logs des 3 drones et sur un log INAV 9) ;
//  - INAV nomme et échelonne certains champs autrement que Betaflight :
//    parseSession les mappe vers le contrat FlightData ;
//  - un gros log fait détacher l'ArrayBuffer WASM : on ré-instancie un Parser
//    frais par session ;
//  - les sessions tronquées (coupure d'alim) sont signalées, pas fatales.
import { Parser } from 'blackbox-log/slim';

import { fr } from '../i18n/fr';

import type { Dict } from '../i18n/fr';
import type { F32x3, FlightData, ParsedFile, SessionMeta, SkippedSession } from '../types';

const MAGIC = 'H Product:Blackbox flight data recorder';

/**
 * Fenêtres de versions du wrapper WASM, mesurées (pas supposées) :
 *  - Betaflight : rejette explicitement 4.0/4.1, accepte 4.2-4.4 nativement ;
 *  - INAV : accepte 5.0.0 à 6.1.x nativement, rejette tout le reste.
 * `supportedMin` est le plancher réel de décodage : en dessous, les headers
 * diffèrent vraiment et aucun spoof ne rattrape le log. `nativeMax` est la
 * dernière version acceptée sans réécriture : au-delà le format de frame reste
 * lisible, seul le contrôle de version bloque, donc on spoofe vers `spoofTo`.
 */
interface FirmwareFamily {
  flavour: 'Betaflight' | 'INAV';
  marker: string; // préfixe exact de la ligne header, version juste derrière
  supportedMin: [number, number];
  nativeMax: [number, number];
  spoofTo: string;
}
const FAMILIES: FirmwareFamily[] = [
  {
    flavour: 'Betaflight',
    marker: 'Firmware revision:Betaflight ',
    supportedMin: [4, 2],
    nativeMax: [4, 4],
    spoofTo: '4.4.2',
  },
  {
    flavour: 'INAV',
    marker: 'Firmware revision:INAV ',
    supportedMin: [5, 0],
    nativeMax: [6, 1],
    spoofTo: '6.0.0',
  },
];
/** Session sans assez de frames pour être autre chose qu'un blip d'armement. */
const MIN_SESSION_FRAMES = 100;
/**
 * Durée minimale d'un vol analysable. En dessous, les mesures existent mais ne
 * veulent rien dire : la FFT n'a pas assez de fenêtres, la step response pas
 * assez de transitions de stick, le sag vbat pas assez de charge. On refuse la
 * session au lieu de publier des verdicts tirés de 2 secondes de log.
 */
export const MIN_SESSION_S = 10;

let wasmModule: WebAssembly.Module | null = null;

/** À appeler une fois avant parseFile. Accepte bytes ou module précompilé. */
export async function initWasm(source: BufferSource | WebAssembly.Module): Promise<void> {
  wasmModule = source instanceof WebAssembly.Module ? source : await WebAssembly.compile(source);
}

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function indexOfBytes(hay: Uint8Array, needle: Uint8Array, from: number): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** Découpe "4.4.2" / "2025.12.4" en [majeur, mineur]. null si la forme est inattendue. */
function versionParts(ver: string): [number, number] | null {
  const m = /^(\d+)\.(\d+)/.exec(ver);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * Au-delà de nativeMax le wrapper refuse la version, alors que le format de
 * frame reste lisible. En dessous de supportedMin on ne spoofe PAS : le rejet
 * doit rester visible pour qu'unsupportedFirmware sorte « trop ancien » au lieu
 * de décoder de travers un format réellement différent.
 */
function needsSpoof(ver: string, fam: FirmwareFamily): boolean {
  const p = versionParts(ver);
  if (!p) return true; // forme exotique : tenter le spoof plutôt que d'abandonner
  const [major, minor] = p;
  return major > fam.nativeMax[0] || (major === fam.nativeMax[0] && minor > fam.nativeMax[1]);
}

/**
 * Réécrit toute version trop récente pour le wrapper à longueur constante :
 * Betaflight ≥ 4.5 (dont 2025.12…) → 4.4.2, INAV ≥ 6.2 → 6.0.0.
 * `originals` restitue chaque « flavour version » d'avant réécriture avec son
 * offset dans le buffer : un fichier concaténé peut mélanger versions et même
 * familles (flash onboard rejouée après un changement de firmware), chaque
 * session doit retrouver LA sienne, pas celle de la première occurrence.
 * `original` reste le premier marqueur du fichier en ordre d'octets.
 */
export function spoofFirmware(buf: Uint8Array): {
  data: Uint8Array;
  original: string | null;
  originals: Array<{ offset: number; firmware: string }>;
} {
  const data = buf.slice();
  const originals: Array<{ offset: number; firmware: string }> = [];
  for (const fam of FAMILIES) {
    const marker = encode(fam.marker);
    let i = 0;
    while ((i = indexOfBytes(data, marker, i)) !== -1) {
      const vs = i + marker.length;
      let ve = vs;
      while (ve < data.length && data[ve] !== 0x20 && data[ve] !== 0x0a && data[ve] !== 0x0d) ve++;
      const ver = new TextDecoder().decode(data.subarray(vs, ve));
      originals.push({ offset: i, firmware: `${fam.flavour} ${ver}` });
      // Slot plus court que le remplacement (version à 2 segments éditée à la
      // main) : réécrire tronquerait en une version encore plus fausse. On
      // laisse l'original, le décodeur la refusera avec la vraie chaîne.
      if (needsSpoof(ver, fam) && ve - vs >= fam.spoofTo.length) {
        const repl = encode(fam.spoofTo.padEnd(ve - vs, ' '));
        data.set(repl.subarray(0, ve - vs), vs);
      }
      i = ve;
    }
  }
  originals.sort((a, b) => a.offset - b.offset);
  return { data, original: originals[0]?.firmware ?? null, originals };
}

/**
 * Refuse en amont ce que le décodeur ne sait pas lire, pour remplacer ses erreurs
 * brutes ("logs from Betaflight v4.1.0 are not supported", "headers required for
 * parsing are missing") par un message traduit.
 *
 * Sous supportedMin aucun spoof ne rattrape le log : les headers d'un Betaflight
 * 3.x ou d'un vieil INAV sont réellement différents, monter la version déclarée
 * déplace juste l'erreur. Les forks (EmuFlight, Rotorflight) décodent en silence
 * de travers - vbat et compte de cellules faux - donc ils sont refusés aussi.
 *
 * Retourne le message d'erreur, ou null si la session peut être tentée.
 * Reçoit le chunk déjà spoofé : les versions > nativeMax sont donc déjà
 * redescendues dans la fenêtre, seul le plancher reste à contrôler ici.
 */
export function unsupportedFirmware(chunk: Uint8Array, dict: Dict): string | null {
  const rev = extractHeaderText(chunk)['Firmware revision']?.trim() ?? '';
  const m = /^(\S+)\s+(\d+\.\d+(?:\.\d+)?)/.exec(rev);
  if (!m) return null; // forme inconnue : laisser le décodeur trancher
  const [, flavour, ver] = m;
  const fam = FAMILIES.find((f) => f.flavour === flavour);
  if (!fam) return dict.system.firmwareNotSupported(flavour);
  const p = versionParts(ver);
  if (!p) return null;
  const [major, minor] = p;
  if (major < fam.supportedMin[0] || (major === fam.supportedMin[0] && minor < fam.supportedMin[1])) {
    return dict.system.firmwareTooOld(`${flavour} ${ver}`, fam.supportedMin.join('.'));
  }
  return null;
}

/**
 * Traduit les messages bruts du décodeur WASM. Ils remontaient tels quels dans
 * le rapport : un utilisateur en français, espagnol ou chinois lisait
 * "one or more headers required for parsing are missing" au milieu de son
 * rapport traduit. Le message brut est conservé en dernier recours, pour ne pas
 * masquer une erreur inconnue derrière un texte générique.
 */
export function translateDecoderError(e: unknown, dict: Dict): string {
  const raw = e instanceof Error ? e.message : String(e);
  const s = raw.toLowerCase();
  if (s.includes('headers') && (s.includes('missing') || s.includes('required'))) {
    return dict.system.headersUnreadable;
  }
  if (s.includes('data version')) return dict.system.dataVersionUnsupported;
  return dict.system.decoderRejected(raw);
}

/** Découpe un .bbl multi-sessions sur le magic header. */
export function splitSessions(buf: Uint8Array): Array<{ offset: number; bytes: Uint8Array }> {
  const magic = encode(MAGIC);
  const offsets: number[] = [];
  let i = 0;
  while ((i = indexOfBytes(buf, magic, i)) !== -1) {
    offsets.push(i);
    i += magic.length;
  }
  if (offsets.length === 0) return [];
  offsets.push(buf.length);
  const out: Array<{ offset: number; bytes: Uint8Array }> = [];
  for (let k = 0; k < offsets.length - 1; k++) {
    out.push({ offset: offsets[k], bytes: buf.subarray(offsets[k], offsets[k + 1]) });
  }
  return out;
}

/** Lit les lignes "H clé:valeur" contiguës en tête de session. */
export function extractHeaderText(chunk: Uint8Array): Record<string, string> {
  const headers: Record<string, string> = {};
  const decoder = new TextDecoder('latin1');
  let pos = 0;
  while (pos < chunk.length) {
    if (chunk[pos] !== 0x48 /* H */ || chunk[pos + 1] !== 0x20) break;
    let eol = pos;
    while (eol < chunk.length && chunk[eol] !== 0x0a) eol++;
    const line = decoder.decode(chunk.subarray(pos + 2, eol));
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon)] = line.slice(colon + 1);
    pos = eol + 1;
  }
  return headers;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

type Row = number[];

function toF32(rows: Row[], col: number): Float32Array {
  const out = new Float32Array(rows.length);
  for (let i = 0; i < rows.length; i++) out[i] = rows[i][col];
  return out;
}

/**
 * Motif de refus d'une session trop courte, ou null si elle est analysable.
 * Deux cas distincts : le blip d'armement (quasi aucune frame) et le vol trop
 * bref pour que les métriques soient fiables.
 */
export function rejectShortSession(meta: SessionMeta, dict: Dict = fr): string | null {
  if (meta.frameCount < MIN_SESSION_FRAMES) {
    return dict.system.sessionTooShort(String(meta.frameCount));
  }
  if (meta.durationS < MIN_SESSION_S) {
    return dict.system.flightTooShort(meta.durationS.toFixed(1), String(MIN_SESSION_S));
  }
  return null;
}

/** Parse toutes les sessions d'un fichier .bbl. */
export async function parseFile(fileName: string, buf: Uint8Array, dict: Dict = fr): Promise<ParsedFile> {
  if (!wasmModule) throw new Error('initWasm() doit être appelé avant parseFile()');
  const { data: spoofed, originals } = spoofFirmware(buf);
  const chunks = splitSessions(spoofed);
  if (chunks.length === 0) {
    return {
      fileName,
      sessions: [],
      skipped: [{ index: 0, fileName, sizeBytes: buf.length, error: dict.system.noBlackboxHeader }],
    };
  }

  const sessions: FlightData[] = [];
  const skipped: SkippedSession[] = [];

  for (let si = 0; si < chunks.length; si++) {
    const chunk = chunks[si];
    const unsupported = unsupportedFirmware(chunk.bytes, dict);
    if (unsupported) {
      skipped.push({ index: si, fileName, sizeBytes: chunk.bytes.length, error: unsupported });
      continue;
    }
    try {
      // Le firmware d'origine DE CETTE session : celui dont le marqueur tombe
      // dans sa plage d'octets (un fichier concaténé peut en mélanger plusieurs).
      const end = chunk.offset + chunk.bytes.length;
      const own = originals.find((o) => o.offset >= chunk.offset && o.offset < end)?.firmware ?? null;
      const fd = await parseSession(fileName, si, chunk.bytes, own, dict);
      const rejected = rejectShortSession(fd.meta, dict);
      if (rejected) {
        skipped.push({ index: si, fileName, sizeBytes: chunk.bytes.length, error: rejected });
      } else {
        sessions.push(fd);
      }
    } catch (e) {
      skipped.push({
        index: si,
        fileName,
        sizeBytes: chunk.bytes.length,
        error: translateDecoderError(e, dict),
      });
    }
  }

  return { fileName, sessions, skipped };
}

async function parseSession(
  fileName: string,
  index: number,
  chunk: Uint8Array,
  originalFirmware: string | null,
  dict: Dict,
): Promise<FlightData> {
  // Parser frais par session : contourne le bug d'ArrayBuffer détaché du wrapper.
  const parser = await Parser.init(wasmModule!);
  const file = parser.loadFile(chunk);
  const h = file.parseHeaders(0);
  if (!h) throw new Error(dict.system.headersUnreadable);

  // Dialecte INAV : mêmes frames, autres noms. axisRate est la consigne en
  // deg/s (l'équivalent de setpoint), gyroRaw le gyro avant filtrage ; vbat,
  // amperage et BaroAlt gardent les échelles centivolt/centiampère/cm de
  // Betaflight (validé numériquement contre orangebox sur un log INAV 9).
  const isInav = h.firmwareKind === 'INAV';
  const N = isInav
    ? { setpoint: 'axisRate', gyroUnfilt: 'gyroRaw', vbat: 'vbat', amperage: 'amperage', baroAlt: 'BaroAlt' }
    : { setpoint: 'setpoint', gyroUnfilt: 'gyroUnfilt', vbat: 'vbatLatest', amperage: 'amperageLatest', baroAlt: 'baroAlt' };

  const rawHeaders = extractHeaderText(chunk);
  const fieldNames = [...h.mainFrameDef.keys()];
  const col: Record<string, number> = {};
  fieldNames.forEach((n, i) => (col[n] = i));
  const has = (n: string) => n in col;

  const rows: Row[] = [];
  const times: number[] = [];
  // L'horodatage propre aux frames G est souvent corrompu (temps négatifs,
  // sauts) : on ancre chaque frame G sur l'index de la dernière frame main
  // décodée, et on lui donnera son temps monotone reconstruit plus bas.
  const gpsAnchor: number[] = [];
  const gpsSat: number[] = [];
  const gpsSpeed: number[] = [];
  const gpsHdop: number[] = [];
  let gpsHasHdop = false;
  const failsafeCounts: Record<string, number> = {};
  // escRPM des frames S : INAV uniquement (Betaflight n'écrit pas ce champ, et
  // s'il apparaissait dans un log exotique on ne veut PAS le confondre avec
  // l'eRPM par moteur du DShot bidirectionnel). Ancré comme les frames G.
  const escAnchor: number[] = [];
  const escRpmVals: number[] = [];

  const dp = h.getDataParser();
  for (const pe of dp) {
    if (pe.kind === 'main') {
      times.push(pe.data.time);
      rows.push([...pe.data.fields.values()] as number[]);
    } else if (pe.kind === 'gps') {
      const f = pe.data.fields as Map<string, number>;
      gpsAnchor.push(rows.length - 1);
      gpsSat.push(f.get('GPS_numSat') ?? 0);
      gpsSpeed.push(f.get('GPS_speed') ?? 0);
      const hdop = f.get('GPS_hdop'); // INAV seulement, en centièmes
      if (hdop !== undefined) gpsHasHdop = true;
      gpsHdop.push(hdop ?? 0);
    } else if (pe.kind === 'slow') {
      const f = pe.data.fields as Map<string, unknown>;
      const phase = String(f.get('failsafePhase') ?? '?');
      failsafeCounts[phase] = (failsafeCounts[phase] ?? 0) + 1;
      if (isInav) {
        const rpm = Number(f.get('escRPM'));
        if (Number.isFinite(rpm)) {
          escAnchor.push(rows.length - 1);
          escRpmVals.push(rpm);
        }
      }
    }
  }

  if (rows.length === 0) throw new Error(dict.system.noFramesDecoded);

  const dts: number[] = [];
  const step = Math.max(1, Math.floor(times.length / 2000));
  for (let i = step; i < times.length; i += step) {
    const d = (times[i] - times[i - step]) / step;
    if (d > 0 && d < 0.5) dts.push(d);
  }
  const dt = median(dts);
  const sampleRateHz = dt > 0 ? 1 / dt : 2000;
  const nominalDt = dt > 0 ? dt : 1 / 2000;

  // Le temps décodé n'est pas fiable à 100 % : re-base du compteur après un trou
  // d'écriture flash (retombe vers 0), wrap du compteur µs 32 bits (~71 min non
  // géré par le crate), frame corrompue. Sans garde-fou on sort des durées de
  // vol négatives et des intégrales mAh fausses → on reconstruit un temps
  // monotone : tout dt négatif/invalide est remplacé par le dt nominal.
  // Les sauts POSITIFS sont conservés : ce sont des pauses d'enregistrement
  // légitimes (désarmé, flash saturé) que la timeline doit montrer.
  const time = new Float64Array(times.length);
  let timeAnomalies = 0;
  time[0] = 0;
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (Number.isFinite(d) && d > 0) {
      time[i] = time[i - 1] + d;
    } else {
      time[i] = time[i - 1] + nominalDt;
      timeAnomalies++;
    }
  }
  const t0 = times[0];

  // INAV écrit motorOutput:1100,2000 ; s'il manquait, la plage DSHOT Betaflight
  // 48-2047 fausserait les % moteur d'un log INAV (sorties en µs 1000-2000).
  const motorOutputDefault = isInav ? '1000,2000' : '48,2047';
  const motorOutput = (rawHeaders['motorOutput'] ?? motorOutputDefault).split(',').map(Number);

  const meta: SessionMeta = {
    index,
    fileName,
    craftName: h.craftName ?? undefined,
    boardInfo: h.boardInfo ?? undefined,
    firmware: originalFirmware ?? h.firmwareRevision,
    firmwareFamily: isInav ? 'inav' : 'betaflight',
    debugMode: h.debugMode,
    fieldNames,
    sampleRateHz,
    durationS: time[time.length - 1],
    frameCount: rows.length,
    motorOutputLow: motorOutput[0] ?? (isInav ? 1000 : 48),
    motorOutputHigh: motorOutput[1] ?? (isInav ? 2000 : 2047),
    headers: rawHeaders,
    timeAnomalies,
  };

  const triple = (base: string): F32x3 | null =>
    has(`${base}[0]`) && has(`${base}[1]`) && has(`${base}[2]`)
      ? [toF32(rows, col[`${base}[0]`]), toF32(rows, col[`${base}[1]`]), toF32(rows, col[`${base}[2]`])]
      : null;
  // Un canal par moteur, dans l'ordre du mixer : 4 pour un quad, 8 pour un X8.
  // Minimum 4 canaux consécutifs, sinon null (bicoptères/tricoptères hors périmètre).
  const MAX_MOTORS = 8;
  const bank = (base: string): Float32Array[] | null => {
    const out: Float32Array[] = [];
    for (let m = 0; m < MAX_MOTORS && has(`${base}[${m}]`); m++) {
      out.push(toF32(rows, col[`${base}[${m}]`]));
    }
    return out.length >= 4 ? out : null;
  };
  const scaled = (name: string, k: number): Float32Array | null => {
    if (!has(name)) return null;
    const a = toF32(rows, col[name]);
    for (let i = 0; i < a.length; i++) a[i] *= k;
    return a;
  };

  const gyro = triple('gyroADC');
  const setpoint = triple(N.setpoint);
  const motor = bank('motor');
  if (!gyro || !setpoint || !motor || !has('rcCommand[3]')) {
    throw new Error(dict.system.essentialFieldsMissing);
  }

  return {
    meta,
    time,
    gyro,
    gyroUnfilt: triple(N.gyroUnfilt),
    setpoint,
    throttle: toF32(rows, col['rcCommand[3]']),
    motor,
    // Chaque famille garde SA source RPM : eRPM par moteur n'existe que sur
    // Betaflight, escRPM (moyenne flotte des frames S) que sur INAV.
    erpm: isInav ? null : bank('eRPM'),
    escRpm:
      escRpmVals.length > 0
        ? {
            time: Float64Array.from(escAnchor, (a) => (a >= 0 ? time[a] : 0)),
            rpm: Float32Array.from(escRpmVals),
          }
        : null,
    vbat: scaled(N.vbat, 0.01),
    amperage: scaled(N.amperage, 0.01),
    baroAlt: scaled(N.baroAlt, 0.01),
    axisP: triple('axisP'),
    axisI: triple('axisI'),
    axisD: has('axisD[0]')
      ? [
          has('axisD[0]') ? toF32(rows, col['axisD[0]']) : null,
          has('axisD[1]') ? toF32(rows, col['axisD[1]']) : null,
          has('axisD[2]') ? toF32(rows, col['axisD[2]']) : null,
        ]
      : null,
    axisF: triple('axisF'),
    gps:
      gpsAnchor.length > 0
        ? {
            time: Float64Array.from(gpsAnchor, (a) => (a >= 0 ? time[a] : 0)),
            numSat: Float32Array.from(gpsSat),
            speedMps: Float32Array.from(gpsSpeed, (v) => v / 100), // brut en cm/s
            hdop: gpsHasHdop ? Float32Array.from(gpsHdop, (v) => v / 100) : null,
          }
        : null,
    failsafePhaseCounts: failsafeCounts,
  };
}

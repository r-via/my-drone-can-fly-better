// Adaptateur blackbox-log (WASM) → FlightData.
// Particularités gérées ici :
//  - le wrapper npm 0.2.2 refuse les firmwares > 4.4 : on réécrit la chaîne de
//    version dans les headers (le format de frame est auto-décrit, validé
//    contre orangebox sur les logs des 3 drones) ;
//  - un gros log fait détacher l'ArrayBuffer WASM : on ré-instancie un Parser
//    frais par session ;
//  - les sessions tronquées (coupure d'alim) sont signalées, pas fatales.
import { Parser } from 'blackbox-log/slim';

import type { F32x3, F32x4, FlightData, ParsedFile, SessionMeta, SkippedSession } from '../types';

const MAGIC = 'H Product:Blackbox flight data recorder';
const FIRMWARE_MARKER = 'Firmware revision:Betaflight ';

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

/** Réécrit toute version Betaflight non supportée (≥4.5, 2025.12…) en 4.4.2, à longueur constante. */
export function spoofFirmware(buf: Uint8Array): { data: Uint8Array; original: string | null } {
  const data = buf.slice();
  const marker = encode(FIRMWARE_MARKER);
  let original: string | null = null;
  let i = 0;
  while ((i = indexOfBytes(data, marker, i)) !== -1) {
    const vs = i + marker.length;
    let ve = vs;
    while (ve < data.length && data[ve] !== 0x20 && data[ve] !== 0x0a && data[ve] !== 0x0d) ve++;
    const ver = new TextDecoder().decode(data.subarray(vs, ve));
    original ??= ver;
    if (!/^4\.[0-4]\./.test(ver)) {
      const repl = encode('4.4.2'.padEnd(ve - vs, ' '));
      data.set(repl.subarray(0, ve - vs), vs);
    }
    i = ve;
  }
  return { data, original };
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

/** Parse toutes les sessions d'un fichier .bbl. */
export async function parseFile(fileName: string, buf: Uint8Array): Promise<ParsedFile> {
  if (!wasmModule) throw new Error('initWasm() doit être appelé avant parseFile()');
  const { data: spoofed, original } = spoofFirmware(buf);
  const chunks = splitSessions(spoofed);
  if (chunks.length === 0) {
    return {
      fileName,
      sessions: [],
      skipped: [{ index: 0, fileName, sizeBytes: buf.length, error: 'Pas de header blackbox trouvé (fichier non .bbl ?)' }],
    };
  }

  const sessions: FlightData[] = [];
  const skipped: SkippedSession[] = [];

  for (let si = 0; si < chunks.length; si++) {
    const chunk = chunks[si];
    try {
      const fd = await parseSession(fileName, si, chunk.bytes, original);
      if (fd.meta.frameCount < 100) {
        skipped.push({
          index: si,
          fileName,
          sizeBytes: chunk.bytes.length,
          error: `Session trop courte (${fd.meta.frameCount} frames) — probable blip d'armement`,
        });
      } else {
        sessions.push(fd);
      }
    } catch (e) {
      skipped.push({
        index: si,
        fileName,
        sizeBytes: chunk.bytes.length,
        error: e instanceof Error ? e.message : String(e),
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
): Promise<FlightData> {
  // Parser frais par session : contourne le bug d'ArrayBuffer détaché du wrapper.
  const parser = await Parser.init(wasmModule!);
  const file = parser.loadFile(chunk);
  const h = file.parseHeaders(0);
  if (!h) throw new Error('Headers illisibles (session corrompue ?)');

  const rawHeaders = extractHeaderText(chunk);
  const fieldNames = [...h.mainFrameDef.keys()];
  const col: Record<string, number> = {};
  fieldNames.forEach((n, i) => (col[n] = i));
  const has = (n: string) => n in col;

  const rows: Row[] = [];
  const times: number[] = [];
  const gpsTime: number[] = [];
  const gpsSat: number[] = [];
  const gpsSpeed: number[] = [];
  const failsafeCounts: Record<string, number> = {};

  const dp = h.getDataParser();
  for (const pe of dp) {
    if (pe.kind === 'main') {
      times.push(pe.data.time);
      rows.push([...pe.data.fields.values()] as number[]);
    } else if (pe.kind === 'gps') {
      const f = pe.data.fields as Map<string, number>;
      gpsTime.push(pe.data.time ?? 0);
      gpsSat.push(f.get('GPS_numSat') ?? 0);
      gpsSpeed.push(f.get('GPS_speed') ?? 0);
    } else if (pe.kind === 'slow') {
      const f = pe.data.fields as Map<string, unknown>;
      const phase = String(f.get('failsafePhase') ?? '?');
      failsafeCounts[phase] = (failsafeCounts[phase] ?? 0) + 1;
    }
  }

  if (rows.length === 0) throw new Error('Aucune frame décodée (données corrompues ?)');

  const t0 = times[0];
  const time = new Float64Array(times.length);
  for (let i = 0; i < times.length; i++) time[i] = times[i] - t0;

  const dts: number[] = [];
  const step = Math.max(1, Math.floor(times.length / 2000));
  for (let i = step; i < times.length; i += step) dts.push((times[i] - times[i - step]) / step);
  const dt = median(dts);
  const sampleRateHz = dt > 0 ? 1 / dt : 2000;

  const motorOutput = (rawHeaders['motorOutput'] ?? '48,2047').split(',').map(Number);

  const meta: SessionMeta = {
    index,
    fileName,
    craftName: h.craftName ?? undefined,
    boardInfo: h.boardInfo ?? undefined,
    firmware: originalFirmware ? `Betaflight ${originalFirmware}` : h.firmwareRevision,
    debugMode: h.debugMode,
    fieldNames,
    sampleRateHz,
    durationS: time[time.length - 1],
    frameCount: rows.length,
    motorOutputLow: motorOutput[0] ?? 48,
    motorOutputHigh: motorOutput[1] ?? 2047,
    headers: rawHeaders,
  };

  const triple = (base: string): F32x3 | null =>
    has(`${base}[0]`) && has(`${base}[1]`) && has(`${base}[2]`)
      ? [toF32(rows, col[`${base}[0]`]), toF32(rows, col[`${base}[1]`]), toF32(rows, col[`${base}[2]`])]
      : null;
  const quad = (base: string): F32x4 | null =>
    has(`${base}[0]`) && has(`${base}[3]`)
      ? [toF32(rows, col[`${base}[0]`]), toF32(rows, col[`${base}[1]`]), toF32(rows, col[`${base}[2]`]), toF32(rows, col[`${base}[3]`])]
      : null;
  const scaled = (name: string, k: number): Float32Array | null => {
    if (!has(name)) return null;
    const a = toF32(rows, col[name]);
    for (let i = 0; i < a.length; i++) a[i] *= k;
    return a;
  };

  const gyro = triple('gyroADC');
  const setpoint = triple('setpoint');
  const motor = quad('motor');
  if (!gyro || !setpoint || !motor || !has('rcCommand[3]')) {
    throw new Error('Champs essentiels absents (gyroADC/setpoint/motor/rcCommand)');
  }

  return {
    meta,
    time,
    gyro,
    gyroUnfilt: triple('gyroUnfilt'),
    setpoint,
    throttle: toF32(rows, col['rcCommand[3]']),
    motor,
    erpm: quad('eRPM'),
    vbat: scaled('vbatLatest', 0.01),
    amperage: scaled('amperageLatest', 0.01),
    baroAlt: scaled('baroAlt', 0.01),
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
      gpsTime.length > 0
        ? {
            time: Float64Array.from(gpsTime, (v) => v - t0),
            numSat: Float32Array.from(gpsSat),
            speedMps: Float32Array.from(gpsSpeed, (v) => v / 100), // brut en cm/s
          }
        : null,
    failsafePhaseCounts: failsafeCounts,
  };
}

// Sérialisation d'une session vers une chaîne URL-safe, et retour.
//
// On sérialise le RÉSULTAT affiché, pas les entrées du moteur de règles.
// C'est la décision qui rend le lien viable : les métriques complètes (bruit
// par axe, atténuations, bandes de spectre, événements propwash et oscillation)
// n'existaient dans le payload que pour recalculer des verdicts déjà calculés.
// Mesuré sur le vol le plus lourd de la collection de test : 1994 caractères
// pour les métriques SANS aucun graphe, contre ~1400 pour le résultat AVEC
// spectre, réponse indicielle et frise.
//
// Ce qui voyage par finding : id, sévérité, catégorie, et les ARGUMENTS des
// textes, pas les textes. Le dictionnaire du lecteur fait le rendu, donc un
// lien créé en français s'ouvre entièrement en allemand chez un Allemand,
// evidence comprise. Voir recordArgs pour la façon dont les arguments sont
// récupérés sans toucher aux règles.
//
// Deux conséquences assumées :
//   - le verdict est un INSTANTANÉ, il ne se recalcule pas à la lecture. On
//     partage un constat daté, qui ne doit pas se contredire dans le dos de
//     celui qui l'a envoyé.
//   - le rapport reconstruit porte un SessionAnalysis partiel : seuls les
//     champs réellement affichés sont peuplés (voir neutralAnalysis).

import { configFromHeaders } from '../cli/config';
import { composeFindings } from '../report';
import { PROFILES, pickProfile } from '../rules/profiles';

import type { Dict } from '../i18n';
import type {
  AxisSpectrum,
  AxisStepResponse,
  DroneProfileId,
  Finding,
  FindingCategory,
  Report,
  SessionAnalysis,
  SessionReport,
  Severity,
  SpectrumMetrics,
  StepResponseMetrics,
  TimelineSegment,
} from '../types';

/** Incrémenter à chaque changement incompatible de la forme du payload. */
export const SHARE_VERSION = 1;

/**
 * Budget par défaut du contenu encodé. Un message Discord plafonne à 2000
 * caractères AU TOTAL : c'est la contrainte réelle du partage dans cette
 * communauté, bien avant celle des navigateurs. On garde de la marge pour
 * l'origine, le `#r=` et le texte que la personne écrit autour.
 */
export const DEFAULT_MAX_CHARS = 1700;

// Points conservés pour le spectre (max-pooling) et la réponse indicielle.
// 128 points sur ~500 Hz suffisent à un tracé SVG de quelques centaines de
// pixels, et le max-pooling garde les résonances étroites.
const SPECTRUM_POINTS = 128;
const STEP_POINTS = 48;

// ---------------------------------------------------------------------------
// Courbes : décimation, quantification uint8, écarts successifs
// ---------------------------------------------------------------------------

interface PackedCurve {
  /** Bornes de l'axe X, l'axe étant une rampe linéaire reconstruite à la lecture. */
  x0: number;
  x1: number;
  /** Valeur correspondant à 255, pour restaurer l'échelle absolue. */
  scale: number;
  /**
   * Écarts successifs du signal quantifié, en zigzag (donc positifs).
   *
   * Un premier jet stockait les valeurs en base64 : gzip ne descendait pas sous
   * ~1 octet par point et le base64 rajoutait ses 1,33x. Les écarts se
   * comprimant mieux, on les laisse en clair pour que gzip puisse travailler.
   *
   * Un lissage préalable a été tenté puis abandonné : 3 % de gain, en échange
   * d'un pic de réponse indicielle écrasé de 1,686 à 1,153, soit un graphe qui
   * contredisait le chiffre imprimé à côté.
   */
  q: number[];
}

/** Entier signé → non signé, pour que les petits écarts restent de petits nombres. */
function zigzag(v: number): number {
  return v >= 0 ? v * 2 : -v * 2 - 1;
}

function unzigzag(v: number): number {
  return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
}

/**
 * `pool: 'max'` pour un spectre : échantillonner un point sur trois ferait
 * disparaître une résonance étroite, or c'est précisément ce qu'on regarde.
 * `pool: 'sample'` suffit pour une courbe lisse (réponse indicielle).
 */
function packCurve(
  values: ArrayLike<number>,
  x0: number,
  x1: number,
  points: number,
  pool: 'max' | 'sample',
): PackedCurve | null {
  const len = values.length;
  if (len === 0) return null;
  const n = Math.min(points, len);

  let scale = 0;
  for (let i = 0; i < len; i++) if (values[i] > scale) scale = values[i];
  if (!(scale > 0)) scale = 1;

  const q: number[] = [];
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const lo = Math.floor((i * len) / n);
    const hi = Math.max(lo + 1, Math.floor(((i + 1) * len) / n));
    let v = values[lo];
    if (pool === 'max') {
      for (let j = lo + 1; j < hi && j < len; j++) if (values[j] > v) v = values[j];
    }
    const level = Math.max(0, Math.min(255, Math.round((v / scale) * 255)));
    q.push(zigzag(level - prev));
    prev = level;
  }
  return { x0, x1, scale, q };
}

function unpackCurve(c: PackedCurve | null): { x: Float32Array; y: Float32Array } {
  if (!c) return { x: new Float32Array(), y: new Float32Array() };
  const n = c.q.length;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const span = n > 1 ? (c.x1 - c.x0) / (n - 1) : 0;
  let level = 0;
  for (let i = 0; i < n; i++) {
    level += unzigzag(c.q[i]);
    x[i] = c.x0 + i * span;
    y[i] = (level / 255) * c.scale;
  }
  return { x, y };
}

// ---------------------------------------------------------------------------
// Textes de règle : transporter les arguments, pas les phrases
// ---------------------------------------------------------------------------

type Copy = string | ((...args: never[]) => string);

/**
 * Une entrée de dictionnaire n'a pas de champs fixes. `tracking-poor` par
 * exemple n'expose pas `fix` mais `fixCleanGyro` et `fixNoisyGyro`, la règle
 * choisissant selon la propreté du gyro. On ne suppose donc aucun nom : le
 * champ effectivement utilisé est capturé avec les arguments.
 */
type RuleCopy = Record<string, Copy | undefined>;

/**
 * Un texte de finding, décrit comme une suite de morceaux littéraux et
 * d'appels au dictionnaire. Il faut un gabarit et pas un simple appel parce que
 * certaines règles composent : `tracking-poor` concatène son explication avec
 * un conseil choisi selon la propreté du gyro, et `log-quality` assemble une
 * liste de problèmes qu'elle passe ensuite en argument. Un modèle plat laissait
 * ces phrases-là en français dans un rapport par ailleurs traduit.
 */
type Tmpl = Array<string | TmplRef>;

interface TmplRef {
  /** Champ du dictionnaire appelé. Clés sur 3 lettres : voir SharePayload.ver. */
  fld: string;
  /**
   * Entrée du dictionnaire, seulement quand elle n'est PAS celle déduite de
   * l'id du finding. Une règle peut emprunter un texte à une autre entrée :
   * `step-overshoot` compose son evidence avec un suffixe de confiance venu
   * d'ailleurs, et le supposer local le faisait disparaître du rapport.
   */
  key?: string;
  /** Arguments, un argument pouvant être lui-même un gabarit. */
  arg?: Array<unknown | { tpl: Tmpl }>;
}

/**
 * Champ réservé désignant le libellé du profil drone.
 *
 * Plusieurs règles le passent en argument à leurs phrases, et il est lui-même
 * traduit : transporté brut, il laissait « Flywoo Explorer LR4 4" (Long Range
 * 4S GPS) » en français au milieu d'un rapport allemand. Il se redéduit de
 * l'id du profil, qui voyage déjà. Le `@` le garde hors de l'espace des noms
 * de champs réels.
 */
const PROFILE_LABEL_FIELD = '@profile';

/** Entrée de dictionnaire attendue pour un id de finding donné. */
function ruleKey(id: string): string {
  return id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function profileLabelOf(dict: Dict, id: DroneProfileId): string {
  return dict.rules.profiles[id]?.label ?? '';
}

/**
 * Les ids de finding sont en kebab-case (`noise-mech-high`) et les entrées de
 * dictionnaire en camelCase (`noiseMechHigh`), dans `rules` pour le moteur et
 * `lint` pour la config. Vérifié : la convention couvre 100 % des règles
 * actuelles. Si une règle y échappait, ses textes voyageraient rendus au lieu
 * d'être perdus.
 */
function copyByKey(key: string, dict: Dict): RuleCopy | null {
  const rules = dict.rules as unknown as Record<string, RuleCopy | undefined>;
  const lint = dict.lint as unknown as Record<string, RuleCopy | undefined>;
  return rules[key] ?? lint[key] ?? null;
}

function ruleCopy(id: string, dict: Dict): RuleCopy | null {
  return copyByKey(ruleKey(id), dict);
}

/**
 * Sentinelle encadrant les arguments capturés. Deux caractères de contrôle,
 * absents de toute copie rédigée, pour qu'un texte légitime ne soit jamais pris
 * pour un marqueur.
 */
const MARK = '\u0000\u0001';

/**
 * Dictionnaire espion : chaque champ de règle qui est une FONCTION est remplacé
 * par une fonction qui renvoie ses arguments sérialisés au lieu de la phrase.
 *
 * L'encodeur rejoue le pipeline de verdicts avec ce dictionnaire, ce qui lui
 * rend les arguments que l'analyse avait consommés. C'est le même principe que
 * le Proxy sur les clés de config : automatique, donc incapable de dériver
 * quand une règle est ajoutée ou modifiée.
 */
function spyDict(dict: Dict): Dict {
  const wrap = (section: unknown): unknown => {
    if (!section || typeof section !== 'object') return section;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(section as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') {
        out[key] = entry;
        continue;
      }
      const wrapped: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(entry as Record<string, unknown>)) {
        wrapped[field] =
          typeof value === 'function'
            ? (...args: unknown[]) => MARK + JSON.stringify([key, field, args]) + MARK
            : value;
      }
      out[key] = wrapped;
    }
    return out;
  };
  return { ...dict, rules: wrap(dict.rules), lint: wrap(dict.lint) } as Dict;
}

/**
 * Découpe un texte produit par le dictionnaire espion en gabarit.
 *
 * Le balayage est non ambigu : JSON.stringify échappe les caractères de
 * contrôle, donc les octets bruts du marqueur n'apparaissent jamais À
 * L'INTÉRIEUR du JSON capturé. Un marqueur imbriqué se retrouve échappé dans
 * une chaîne d'argument, redevient brut au JSON.parse, et la récursion le
 * traite à son tour.
 */
function parseTemplate(text: string, ownKey: string): Tmpl {
  const out: Tmpl = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf(MARK, i);
    if (start === -1) {
      out.push(text.slice(i));
      break;
    }
    if (start > i) out.push(text.slice(i, start));
    const end = text.indexOf(MARK, start + MARK.length);
    if (end === -1) {
      out.push(text.slice(start));
      break;
    }
    try {
      const [key, fld, args] = JSON.parse(text.slice(start + MARK.length, end)) as [string, string, unknown[]];
      const arg = args.map((a) =>
        typeof a === 'string' && a.includes(MARK) ? { tpl: parseTemplate(a, ownKey) } : a,
      );
      const ref: TmplRef = { fld };
      if (key !== ownKey) ref.key = key;
      if (arg.length > 0) ref.arg = arg;
      out.push(ref);
    } catch {
      // Capture illisible : on garde le fragment tel quel plutôt que le perdre.
      out.push(text.slice(start, end + MARK.length));
    }
    i = end + MARK.length;
  }
  return out;
}

/**
 * Remplace les fragments littéraux qui SONT une phrase du dictionnaire par une
 * référence à leur champ.
 *
 * L'espion n'intercepte que les fonctions : un champ qui est une simple chaîne
 * traverse tel quel et se retrouve concaténé en dur dans le gabarit.
 * `tracking-poor` compose ainsi son explication avec `adviceCleanGyro` ou
 * `adviceNoisyGyro` selon le cas, et sans cette passe ce conseil restait en
 * français au milieu d'un rapport chinois.
 */
function nameLiterals(tmpl: Tmpl, copy: RuleCopy | null, profileLabel: string): Tmpl {
  const byValue = new Map<string, string>();
  if (profileLabel) byValue.set(profileLabel, PROFILE_LABEL_FIELD);
  for (const [field, value] of Object.entries(copy ?? {})) {
    // Seuil de longueur : reconnaître une phrase, jamais un fragment court
    // comme « Roll » qui pourrait coïncider avec un champ par hasard.
    if (typeof value === 'string' && value.length >= 12) byValue.set(value, field);
  }
  const walk = (t: Tmpl): Tmpl =>
    t.map((part) => {
      if (typeof part === 'string') {
        const fld = byValue.get(part);
        return fld ? { fld } : part;
      }
      if (!part.arg) return part;
      return {
        ...part,
        arg: part.arg.map((a) => {
          if (a && typeof a === 'object' && 'tpl' in a) return { tpl: walk((a as { tpl: Tmpl }).tpl) };
          // Un argument peut lui-même être une phrase du dictionnaire :
          // `tracking-poor` passe son conseil à `detail()`. Laissé brut, ce
          // conseil restait en français dans un rapport traduit.
          if (typeof a === 'string') {
            const fld = byValue.get(a);
            if (fld) return { tpl: [{ fld }] };
          }
          return a;
        }),
      };
    });
  return walk(tmpl);
}

function renderTemplate(tmpl: Tmpl, own: RuleCopy | null, dict: Dict, profileId: DroneProfileId): string {
  return tmpl
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part.fld === PROFILE_LABEL_FIELD) return profileLabelOf(dict, profileId);
      const copy = part.key ? copyByKey(part.key, dict) : own;
      const entry = copy?.[part.fld];
      if (typeof entry === 'string') return entry;
      if (typeof entry !== 'function') return '';
      const args = (part.arg ?? []).map((a) =>
        a && typeof a === 'object' && 'tpl' in a ? renderTemplate((a as { tpl: Tmpl }).tpl, own, dict, profileId) : a,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (entry as (...a: any[]) => string)(...args);
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Raccourcissement des clés
// ---------------------------------------------------------------------------
//
// Code en base36 dérivé de la POSITION dans SCHEMA_KEYS. On peut AJOUTER une
// clé en fin de liste sans rien casser, mais en réordonner une invalide tous
// les liens émis - d'où SHARE_VERSION. Une clé absente passe telle quelle.

const SCHEMA_KEYS = [
  // Enveloppe. `configSource` n'est plus émis (la config vient toujours des
  // headers du log) mais sa place reste réservée : la retirer décalerait tous
  // les codes suivants et invaliderait les liens déjà émis.
  'fileName', 'profileId', 'view', 'findings', 'spectrum', 'step', 'timeline', 'configSource',
  // Bandeau et tuiles : exactement ce que la page imprime
  'index', 'craftName', 'boardInfo', 'firmware', 'durationS', 'sampleRateHz',
  'flightTimeS', 'saturationPct', 'hasPower', 'cells', 'sagV', 'vbatMin', 'vbatMax',
  'ampMax', 'ampAvg', 'gpsAvailable',
  // Findings. Les clés du gabarit (`fld`, `arg`, `tpl`) ne sont volontairement
  // PAS raccourcies : sur 3 lettres, elles ne peuvent pas être confondues avec
  // un code base36 d'un ou deux caractères au décodage.
  'id', 'severity', 'category', 'title', 'detail', 'evidence', 'fixText', 'fixCli',
  // Courbes
  'curve', 'x0', 'x1', 'scale', 'q', 'motorFundamentalHz', 'axes',
  'riseTimeMs', 'overshootPct', 'segments',
  // Ajouts ultérieurs : toujours en fin de liste, jamais au milieu.
  'trimmed',
] as const;

const TO_SHORT = new Map<string, string>(SCHEMA_KEYS.map((k, i) => [k, i.toString(36)]));
const TO_LONG = new Map<string, string>(SCHEMA_KEYS.map((k, i) => [i.toString(36), k]));

function remapKeys(value: unknown, table: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((v) => remapKeys(v, table));
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[table.get(key) ?? key] = remapKeys(v, table);
  }
  return out;
}

// ---------------------------------------------------------------------------
// base64url + gzip (CompressionStream : natif navigateur et Node >= 18)
// ---------------------------------------------------------------------------

function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000; // au-delà, String.fromCharCode(...) explose la pile
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  // Recopie dans un ArrayBuffer autonome : une vue Uint8Array peut porter un
  // SharedArrayBuffer, que BlobPart n'accepte pas.
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

interface PackedFinding {
  id: string;
  severity: Severity;
  category: FindingCategory;
  title?: Tmpl;
  detail?: Tmpl;
  evidence?: Tmpl;
  fixText?: Tmpl;
  /** Jamais dans le dictionnaire : les lignes CLI sont codées dans les règles. */
  fixCli?: string[];
}

interface SharePayload {
  /**
   * Volontairement sur 3 caractères : les codes de SCHEMA_KEYS en font 1 ou 2,
   * donc `ver` ne peut pas en être un et traverse le remap intact. Une clé
   * courte serait interceptée - `v` valait déjà le code d'un champ.
   */
  ver: number;
  /** Courbes retirées faute de place : l'affichage doit le dire, pas le taire. */
  trimmed?: true;
  fileName: string;
  profileId: DroneProfileId;
  view: {
    index: number;
    craftName?: string;
    boardInfo?: string;
    firmware: string;
    durationS: number;
    sampleRateHz: number;
    flightTimeS: number;
    saturationPct: number;
    gpsAvailable: boolean;
    /** Faux quand le log n'a pas de vbat : la tuile batterie doit dire n/a. */
    hasPower: boolean;
    cells: number;
    sagV: number;
    vbatMin: number;
    vbatMax: number;
    ampMax: number | null;
    ampAvg: number | null;
  };
  findings: PackedFinding[];
  spectrum: { motorFundamentalHz: number | null; axes: Array<PackedCurve | null> } | null;
  step: Array<{ curve: PackedCurve | null; riseTimeMs: number | null; overshootPct: number | null } | null> | null;
  /** [tStart, code état, vbat] - tEnd déduit du segment suivant. */
  timeline: Array<[number, number, number | null]>;
}

const STATE_CODES: Array<TimelineSegment['state']> = ['idle', 'low', 'flight'];

function round(v: number, digits: number): number {
  if (!Number.isFinite(v)) return v;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

// ---------------------------------------------------------------------------
// Encodage
// ---------------------------------------------------------------------------

export interface EncodeResult {
  encoded: string;
  /** Vrai si les courbes ont dû sauter pour tenir dans le budget. */
  trimmed: boolean;
  /**
   * Vrai si même la version dégradée dépasse le budget. Rien ne garantit qu'un
   * vol tienne : l'UI doit prévenir plutôt que laisser coller un lien que
   * Discord refusera.
   */
  overBudget: boolean;
}

/**
 * Tente la version complète et ne retire les graphes que si le lien déborde.
 * Un vol court garde donc ses courbes, un vol chargé les perd et le rapport
 * l'affiche au lieu de montrer des graphes vides.
 */
export async function encodeSessionAdaptive(
  sessionReport: SessionReport,
  fileName: string,
  dict: Dict,
  maxChars: number = DEFAULT_MAX_CHARS,
): Promise<EncodeResult> {
  const full = await encodeSession(sessionReport, fileName, dict);
  if (full.length <= maxChars) return { encoded: full, trimmed: false, overBudget: false };
  const short = await encodeSession(sessionReport, fileName, dict, true);
  return { encoded: short, trimmed: true, overBudget: short.length > maxChars };
}

export async function encodeSession(
  sessionReport: SessionReport,
  fileName: string,
  dict: Dict,
  dropCurves = false,
): Promise<string> {
  const { analysis, profile, findings } = sessionReport;
  const { meta, power, spectrum, step, timeline } = analysis;

  // Même config que celle ayant servi à produire les findings : sans elle, le
  // rejeu espion ne retomberait pas sur la même liste.
  const config = configFromHeaders(meta.headers);
  const spied = composeFindings(analysis, profile, config, spyDict(dict));

  const payload: SharePayload = {
    ver: SHARE_VERSION,
    ...(dropCurves ? { trimmed: true as const } : {}),
    fileName,
    profileId: profile.id,
    view: {
      index: meta.index,
      craftName: meta.craftName,
      boardInfo: meta.boardInfo,
      firmware: meta.firmware,
      durationS: round(meta.durationS, 2),
      sampleRateHz: round(meta.sampleRateHz, 0),
      flightTimeS: round(timeline.flightTimeS, 2),
      saturationPct: round(analysis.motors.saturationPct, 2),
      gpsAvailable: analysis.gps.available,
      hasPower: power !== null,
      cells: power?.cells ?? 0,
      sagV: round(power?.sagV ?? 0, 3),
      vbatMin: round(power?.vbatMin ?? 0, 3),
      vbatMax: round(power?.vbatMax ?? 0, 3),
      ampMax: power?.ampMax == null ? null : round(power.ampMax, 2),
      ampAvg: power?.ampAvg == null ? null : round(power.ampAvg, 2),
    },
    findings: findings.map((f, i) => packFinding(f, alignSpy(spied, f, i), dict, profile.id)),
    spectrum:
      spectrum && !dropCurves
        ? {
            motorFundamentalHz: spectrum.motorFundamentalHz,
            axes: spectrum.axes.map((ax) =>
              packCurve(ax.mags, ax.freqs[0] ?? 0, ax.freqs[ax.freqs.length - 1] ?? 0, SPECTRUM_POINTS, 'max'),
            ),
          }
        : null,
    step:
      step && !dropCurves
        ? step.axes.map((ax) =>
            ax
              ? {
                  curve: packCurve(ax.y, ax.t[0] ?? 0, ax.t[ax.t.length - 1] ?? 0, STEP_POINTS, 'sample'),
                  riseTimeMs: ax.riseTimeMs,
                  overshootPct: ax.overshootPct,
                }
              : null,
          )
        : null,
    // La frise est un graphe elle aussi : en mode dégradé elle saute avec les
    // autres, et c'est un poste lourd (une trentaine de segments sur un vol de
    // dix minutes). ReportView teste déjà segments.length avant de la rendre.
    timeline: dropCurves
      ? []
      : timeline.segments.map((s) => [
          round(s.tStart, 2),
          Math.max(0, STATE_CODES.indexOf(s.state)),
          s.vbat === null ? null : round(s.vbat, 2),
        ]),
  };

  const json = JSON.stringify(remapKeys(payload, TO_SHORT), (_key, value) =>
    typeof value === 'number' && Number.isFinite(value) ? round(value, 4) : value,
  );
  return bytesToB64url(await gzip(json));
}

/**
 * Le rejeu espion produit la même liste dans le même ordre, mais on ne s'y fie
 * pas aveuglément : on vérifie l'id à la position attendue, et à défaut on
 * cherche par id. Sans correspondance, les textes voyageront rendus.
 */
function alignSpy(spied: Finding[], real: Finding, index: number): Finding | null {
  if (spied[index]?.id === real.id) return spied[index];
  return spied.find((s) => s.id === real.id) ?? null;
}

function packFinding(real: Finding, spy: Finding | null, dict: Dict, profileId: DroneProfileId): PackedFinding {
  const copy = ruleCopy(real.id, dict);
  const packed: PackedFinding = {
    id: real.id,
    severity: real.severity,
    category: real.category,
  };

  const put = (
    key: 'title' | 'detail' | 'evidence' | 'fixText',
    realText: string | undefined,
    spyText: string | undefined,
  ) => {
    if (realText === undefined) return;
    // Sans finding espion correspondant, il reste le texte rendu : nameLiterals
    // saura tout de même le nommer s'il vient tel quel du dictionnaire.
    const source = spyText ?? realText;
    packed[key] = nameLiterals(parseTemplate(source, ruleKey(real.id)), copy, profileLabelOf(dict, profileId));
  };

  put('title', real.title, spy?.title);
  put('detail', real.detail, spy?.detail);
  put('evidence', real.evidence, spy?.evidence);
  if (real.fix) {
    put('fixText', real.fix.text, spy?.fix?.text);
    if (real.fix.cli?.length) packed.fixCli = real.fix.cli;
  }
  return packed;
}

// ---------------------------------------------------------------------------
// Décodage
// ---------------------------------------------------------------------------

export class ShareDecodeError extends Error {
  constructor(readonly reason: 'malformed' | 'version') {
    super(reason);
    this.name = 'ShareDecodeError';
  }
}

export async function decodeSession(encoded: string, dict: Dict): Promise<Report> {
  let payload: SharePayload;
  try {
    const raw: unknown = JSON.parse(await gunzip(b64urlToBytes(encoded)));
    payload = remapKeys(raw, TO_LONG) as SharePayload;
  } catch {
    throw new ShareDecodeError('malformed');
  }
  // Version d'abord : un lien émis par une version plus récente n'a aucune
  // raison d'avoir la forme attendue, et « lien obsolète » est un diagnostic
  // autrement plus utile à l'utilisateur que « lien corrompu ».
  if (!payload || typeof payload !== 'object') throw new ShareDecodeError('malformed');
  if (payload.ver !== SHARE_VERSION) throw new ShareDecodeError('version');
  if (!payload.view || !Array.isArray(payload.findings)) throw new ShareDecodeError('malformed');

  const profile = PROFILES.find((p) => p.id === payload.profileId) ?? pickProfile(payload.view.craftName);

  return {
    files: [
      {
        fileName: payload.fileName,
        sessionReports: [
          {
            analysis: neutralAnalysis(payload),
            profile,
            findings: payload.findings.map((f) => unpackFinding(f, dict, payload.profileId)),
          },
        ],
        skipped: [],
      },
    ],
    shared: { trimmed: payload.trimmed === true },
  };
}

function unpackFinding(f: PackedFinding, dict: Dict, profileId: DroneProfileId): Finding {
  const copy = ruleCopy(f.id, dict);

  const render = (tmpl: Tmpl | undefined): string => (tmpl ? renderTemplate(tmpl, copy, dict, profileId) : '');

  const fixText = render(f.fixText);
  const finding: Finding = {
    id: f.id,
    severity: f.severity,
    category: f.category,
    title: render(f.title),
    detail: render(f.detail),
    evidence: render(f.evidence),
  };
  if (fixText || f.fixCli?.length) {
    finding.fix = { text: fixText, ...(f.fixCli?.length ? { cli: f.fixCli } : {}) };
  }
  return finding;
}

/**
 * SessionAnalysis reconstruit pour l'affichage seul. Les champs qui ne
 * servaient qu'au moteur de règles restent neutres : les verdicts sont déjà
 * calculés et voyagent tels quels, plus personne ne les relit.
 *
 * Le compilateur signale l'ajout d'un champ obligatoire, et c'est voulu : il
 * faut alors décider s'il est affiché (donc à transporter) ou non.
 */
function neutralAnalysis(p: SharePayload): SessionAnalysis {
  const v = p.view;
  const axisNoise = { unfiltRms: null, filtRms: 0, ratio: null, gyroPeak: 0 };
  const axisTracking = { meanAbsErr: 0, maxErr: 0, setpointMax: 0 };

  return {
    meta: {
      index: v.index,
      fileName: p.fileName,
      craftName: v.craftName,
      boardInfo: v.boardInfo,
      firmware: v.firmware,
      fieldNames: [],
      sampleRateHz: v.sampleRateHz,
      durationS: v.durationS,
      frameCount: 0,
      motorOutputLow: 48,
      motorOutputHigh: 2047,
      headers: {},
    },
    power: v.hasPower
      ? {
          cells: v.cells,
          vbatMax: v.vbatMax,
          vbatMin: v.vbatMin,
          perCellMax: v.cells > 0 ? v.vbatMax / v.cells : 0,
          perCellMin: v.cells > 0 ? v.vbatMin / v.cells : 0,
          sagV: v.sagV,
          ampAvg: v.ampAvg,
          ampMax: v.ampMax,
          mahEstimate: null,
          perCellMinSustained: v.cells > 0 ? v.vbatMin / v.cells : 0,
          implausibleSamples: 0,
        }
      : null,
    motors: {
      avgPct: 0,
      perMotorAvgPct: [0, 0, 0, 0],
      imbalancePctPts: 0,
      saturationPct: v.saturationPct,
      desyncZeros: [0, 0, 0, 0],
      erpmAvailable: false,
    },
    noise: { axes: [axisNoise, axisNoise, axisNoise] },
    spectrum: unpackSpectrum(p.spectrum),
    tracking: { axes: [axisTracking, axisTracking, axisTracking] },
    step: unpackStep(p.step),
    yoyo: null,
    propwash: null,
    oscillation: null,
    filters: { available: false, axes: null },
    timeline: {
      segments: p.timeline.map((s, i, all) => ({
        tStart: s[0],
        tEnd: i + 1 < all.length ? all[i + 1][0] : v.durationS,
        state: STATE_CODES[s[1]] ?? 'idle',
        stickAvg: 0,
        thrustPct: 0,
        vbat: s[2],
      })),
      flightTimeS: v.flightTimeS,
      throttleMaxUs: 0,
    },
    gps: { available: v.gpsAvailable, numSatMax: null, numSatMin: null, speedMaxMps: null },
    failsafe: { phases: {}, triggered: false },
  };
}

function unpackSpectrum(packed: SharePayload['spectrum']): SpectrumMetrics | null {
  if (!packed) return null;
  const axes = packed.axes.map((c): AxisSpectrum => {
    const { x, y } = unpackCurve(c);
    return { bands: [], dominantBand: '', peaks: [], freqs: x, mags: y };
  });
  return {
    source: 'unfilt',
    axes: [axes[0], axes[1], axes[2]],
    motorFundamentalHz: packed.motorFundamentalHz,
    perMotorHz: null,
    dominantPeak: null,
    motorPolesAssumed: 0,
  };
}

function unpackStep(packed: SharePayload['step']): StepResponseMetrics | null {
  if (!packed) return null;
  const axes = packed.map((ax): AxisStepResponse | null => {
    if (!ax) return null;
    const { x, y } = unpackCurve(ax.curve);
    return {
      t: x,
      y,
      riseTimeMs: ax.riseTimeMs,
      peakValue: null,
      overshootPct: ax.overshootPct,
      settleValue: null,
      quality: 1,
    };
  });
  return { axes: [axes[0], axes[1], axes[2]] };
}

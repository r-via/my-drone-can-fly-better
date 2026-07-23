// Comparaison de deux vols du même quad : ce que le pilote a changé, et ce que
// la mesure a fait en réponse.
//
// C'est le seul cadre où un indicateur de tune veut vraiment dire quelque chose.
// Un chiffre isolé se lit contre un seuil, ce que le moteur de règles fait déjà ;
// mais « 14 % de dépassement » ne dit pas si le vol précédent était à 11 ou à 22.
// Entre deux passes du MÊME quad, avec la même façon de voler, le delta répond à
// la seule question du tuning : est-ce que mon changement a aidé ?
//
// D'où la règle qui structure ce module : on ne publie un delta que si les deux
// vols sont comparables, et on dit toujours en quoi ils ne le sont pas. Une
// comparaison silencieusement bancale est pire qu'une absence de comparaison -
// elle fait attribuer à un changement de PID ce qui vient d'une batterie plus
// fraîche ou d'un vol plus mou.

import { MIN_STEP_QUALITY } from './analysis/step';
import { configFromHeaders, parseNum } from './cli/config';
import { worstAxis } from './rules/engine';

import type { Axis, SessionAnalysis, SessionReport, StepResponseMetrics } from './types';

// ---------------------------------------------------------------------------
// Diff de tune
// ---------------------------------------------------------------------------

/**
 * Headers qui changent d'un vol à l'autre SANS que personne n'ait rien réglé :
 * ce sont des mesures ou des valeurs calculées que le firmware inscrit dans le
 * snapshot, pas des réglages du pilote. Mesuré sur les logs réels :
 * `rc_smoothing_rx_smoothed` bouge de 250 à 249 entre deux vols, `rx_average`
 * de 6689 à 6687, et surtout `rc_smoothing_active_cutoffs_ff_sp_thr` (les
 * cutoffs FF/setpoint/throttle CALCULÉS en vol) oscillent de 93 à 94 selon le
 * pilotage. Les laisser passer remplit la table de faux changements, juste là
 * où le pilote cherche le vrai.
 *
 * On filtre par FAMILLE plutôt que par nom exact : `rc_smoothing_active_cutoffs*`
 * et `rc_smoothing_rx_*` sont des diagnostics calculés (le pilote règle plutôt
 * `rc_smoothing_setpoint_cutoff`, `_feedforward_cutoff`, `_auto_factor`…, qui,
 * eux, restent visibles). Deviner un nom exact avait justement laissé filer le
 * suffixe `_thr`.
 */
const RUNTIME_KEY_PREFIXES = ['rc_smoothing_active_cutoffs', 'rc_smoothing_rx_'];
const RUNTIME_KEYS = new Set(['vbat_scale', 'vbatref', 'motor_kv', 'debug_mode']);

function isRuntimeKey(key: string): boolean {
  return RUNTIME_KEYS.has(key) || RUNTIME_KEY_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Sliders simplifiés : quand ils pilotent, ce sont eux la CAUSE et les gains
 * qu'ils recalculent l'EFFET. Les afficher en tête évite de lire « i_roll 33 →
 * 67 » comme un réglage manuel alors que le pilote a bougé un seul curseur.
 */
function isDriver(key: string): boolean {
  return key.startsWith('simplified_');
}

export interface TuneChange {
  key: string;
  before: string;
  after: string;
  /** Curseur simplifié : la cause du changement, pas sa conséquence. */
  driver: boolean;
}

/** Paramètres dont la valeur diffère entre les deux snapshots de config. */
export function diffTune(
  before: Record<string, string>,
  after: Record<string, string>,
): TuneChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: TuneChange[] = [];
  for (const key of keys) {
    if (isRuntimeKey(key)) continue;
    const b = before[key];
    const a = after[key];
    // Un paramètre absent d'un seul côté vient d'un changement de version de
    // firmware, pas d'un réglage : le caveat correspondant le dit déjà, et
    // l'afficher comme « - → 42 » sur cinquante lignes noierait le vrai diff.
    if (b === undefined || a === undefined || b === a) continue;
    changes.push({ key, before: b, after: a, driver: isDriver(key) });
  }
  return changes.sort(
    (x, y) => Number(y.driver) - Number(x.driver) || x.key.localeCompare(y.key),
  );
}

// ---------------------------------------------------------------------------
// Deltas d'indicateurs
// ---------------------------------------------------------------------------

/**
 * Sens de lecture. `neutral` est réservé aux témoins : des grandeurs qu'un
 * changement de tune ne pilote pas, et qu'on affiche pour valider la
 * comparaison, pas pour la noter. Les fléchez bien/mal ferait lire une
 * dégradation mécanique comme le résultat d'un réglage.
 */
export type Direction = 'lower' | 'higher' | 'neutral';

export interface MetricDelta {
  /** Clé i18n dans dict.compare.metrics. */
  id: string;
  /** Axe d'où vient chaque valeur (pire axe), null pour une valeur de session. */
  beforeAxis: Axis | null;
  afterAxis: Axis | null;
  before: number | null;
  after: number | null;
  /** after - before, null si l'un des deux manque. */
  delta: number | null;
  digits: number;
  better: Direction;
}

/**
 * Métriques step, filtrées par le MÊME seuil de qualité que le moteur de règles.
 * Un axe dont la déconvolution est trop bruitée pour porter un verdict ne doit
 * pas non plus porter un delta : sinon le rapport refuse de juger un chiffre
 * dans un panneau et le compare dans le suivant.
 */
function stepRead(
  a: SessionAnalysis,
  pick: (ax: NonNullable<StepResponseMetrics['axes'][0]>) => number | null,
): Array<number | null> {
  if (!a.step) return [null, null, null];
  return a.step.axes.map((ax) => (ax && ax.quality >= MIN_STEP_QUALITY ? pick(ax) : null));
}

/**
 * Extracteurs d'indicateurs comparables d'un vol à l'autre. Volontairement
 * restreint : une métrique n'entre ici que si un changement de tune peut la
 * faire bouger ET qu'elle ne dépend pas surtout du vol lui-même. C'est pour ça
 * que la batterie, la durée, le GPS et le compte d'événements n'y sont pas -
 * ils parlent de la sortie du jour, pas du réglage.
 */
const METRICS: Array<{
  id: string;
  digits: number;
  better: Direction;
  perAxis: boolean;
  read: (a: SessionAnalysis) => Array<number | null>;
}> = [
  {
    id: 'filtNoise',
    digits: 1,
    better: 'lower',
    perAxis: true,
    read: (a) => a.noise.axes.map((x) => x.filtRms),
  },
  {
    // Ne devrait PAS bouger avec un changement de tune : c'est le témoin. S'il
    // bouge, l'état mécanique a changé et le reste de la comparaison vacille.
    id: 'unfiltNoise',
    digits: 1,
    better: 'neutral',
    perAxis: true,
    read: (a) => a.noise.axes.map((x) => x.unfiltRms),
  },
  {
    id: 'tracking',
    digits: 1,
    better: 'lower',
    perAxis: true,
    read: (a) => a.tracking.axes.map((x) => x.meanAbsErr),
  },
  {
    id: 'overshoot',
    digits: 0,
    better: 'lower',
    perAxis: true,
    read: (a) => stepRead(a, (x) => x.overshootPct),
  },
  {
    id: 'riseTime',
    digits: 0,
    better: 'lower',
    perAxis: true,
    read: (a) => stepRead(a, (x) => x.riseTimeMs),
  },
  {
    // Sans dimension, donc le seul indicateur de boucle vraiment comparable
    // d'un vol à l'autre. Souvent absent : un manche humain n'excite pas
    // toujours la zone fragile (voir analysis/step.ts).
    id: 'ms',
    digits: 2,
    better: 'lower',
    perAxis: true,
    read: (a) => stepRead(a, (x) => x.ms),
  },
  {
    id: 'residualHf',
    digits: 0,
    better: 'lower',
    perAxis: true,
    read: (a) =>
      a.filters.available && a.filters.axes
        ? a.filters.axes.map((x) => x.residualHfRms)
        : [null, null, null],
  },
  {
    id: 'propwash',
    digits: 1,
    better: 'lower',
    perAxis: false,
    read: (a) => [a.propwash?.applicable ? a.propwash.worstSeverity : null],
  },
  {
    id: 'saturation',
    digits: 1,
    better: 'lower',
    perAxis: false,
    read: (a) => [a.motors.saturationPct],
  },
];

/**
 * Deltas indicateur par indicateur.
 *
 * Pour une métrique par axe, on compare le PIRE axe de chaque vol. « Ta pire
 * erreur de suivi est passée de 4.2 à 2.2 » reste vrai et utile même si le pire
 * axe a changé de roll à pitch - c'est un résumé, pas un appariement d'axes. On
 * publie donc l'axe de CHAQUE côté pour que le lecteur voie ce déplacement au
 * lieu de le subir. Une métrique absente des deux vols n'est pas listée.
 */
export function compareMetrics(before: SessionAnalysis, after: SessionAnalysis): MetricDelta[] {
  const out: MetricDelta[] = [];
  for (const m of METRICS) {
    const wb = m.perAxis ? worstAxis(m.read(before)) : null;
    const wa = m.perAxis ? worstAxis(m.read(after)) : null;
    const bv = m.perAxis ? (wb?.value ?? null) : m.read(before)[0];
    const av = m.perAxis ? (wa?.value ?? null) : m.read(after)[0];

    if (bv === null && av === null) continue;
    out.push({
      id: m.id,
      beforeAxis: wb?.axis ?? null,
      afterAxis: wa?.axis ?? null,
      before: bv,
      after: av,
      delta: bv !== null && av !== null ? av - bv : null,
      digits: m.digits,
      better: m.better,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Caveats : pourquoi la comparaison peut mentir
// ---------------------------------------------------------------------------

/** Clé i18n dans dict.compare.caveats, avec ses arguments déjà formatés. */
export interface Caveat {
  id: string;
  args: string[];
}

/** Écart relatif entre deux valeurs, robuste au zéro. */
function relGap(a: number, b: number): number {
  const ref = Math.max(Math.abs(a), Math.abs(b));
  return ref > 0 ? Math.abs(a - b) / ref : 0;
}

const DURATION_RATIO = 3; // au-delà, un vol de 20 s face à un vol de 3 min
const STICK_GAP = 0.4; // 40 % d'écart sur le manche max = autre style de vol
const UNFILT_GAP = 0.5; // 50 % d'écart sur le gyro brut = autre état mécanique
const SAG_GAP_V = 0.25; // par cellule : pack frais contre pack fatigué

function firmwareBase(firmware: string): string {
  return firmware.split(' (')[0].trim();
}

function collectCaveats(before: SessionReport, after: SessionReport): Caveat[] {
  const bm = before.analysis.meta;
  const am = after.analysis.meta;
  const caveats: Caveat[] = [];

  if (firmwareBase(bm.firmware) !== firmwareBase(am.firmware)) {
    caveats.push({ id: 'firmware', args: [firmwareBase(bm.firmware), firmwareBase(am.firmware)] });
  }
  if (Math.abs(bm.sampleRateHz - am.sampleRateHz) > 1) {
    caveats.push({
      id: 'sampleRate',
      args: [bm.sampleRateHz.toFixed(0), am.sampleRateHz.toFixed(0)],
    });
  }
  const ratio =
    Math.max(bm.durationS, am.durationS) / Math.max(1, Math.min(bm.durationS, am.durationS));
  if (ratio >= DURATION_RATIO) {
    caveats.push({ id: 'duration', args: [bm.durationS.toFixed(0), am.durationS.toFixed(0)] });
  }

  // Style de vol : le manche maximum atteint sur roll/pitch. Un vol calme et un
  // vol agressif ne sollicitent pas la boucle de la même façon, et l'overshoot
  // comme le propwash suivent le pilote avant de suivre le tune.
  const stickOf = (a: SessionAnalysis): number =>
    Math.max(a.tracking.axes[0].setpointMax, a.tracking.axes[1].setpointMax);
  const sb = stickOf(before.analysis);
  const sa = stickOf(after.analysis);
  if (relGap(sb, sa) >= STICK_GAP) {
    caveats.push({ id: 'stickRange', args: [sb.toFixed(0), sa.toFixed(0)] });
  }

  // Témoin mécanique : le gyro brut ne répond pas au tune. S'il a bougé, une
  // hélice ou une vis a bougé avec, et les deltas de bruit filtré ne mesurent
  // plus le filtrage.
  const rawOf = (a: SessionAnalysis): number | null => {
    const vals = a.noise.axes.map((x) => x.unfiltRms).filter((v): v is number => v !== null);
    return vals.length > 0 ? Math.max(...vals) : null;
  };
  const rb = rawOf(before.analysis);
  const ra = rawOf(after.analysis);
  if (rb !== null && ra !== null && relGap(rb, ra) >= UNFILT_GAP) {
    caveats.push({ id: 'mechanical', args: [rb.toFixed(1), ra.toFixed(1)] });
  }

  // Batterie : sans compensation de sag, la même consigne ne donne pas la même
  // poussée à 4.1 V et à 3.6 V par cellule.
  const pb = before.analysis.power;
  const pa = after.analysis.power;
  if (pb && pa && pb.cells > 0 && pa.cells > 0) {
    const sagB = pb.sagV / pb.cells;
    const sagA = pa.sagV / pa.cells;
    // Il faut une compensation EXPLICITEMENT active des deux côtés pour taire
    // l'avertissement. Un paramètre absent des headers ne prouve pas qu'elle
    // tourne : le lire comme un feu vert faisait disparaître le caveat sur tout
    // firmware qui ne l'enregistre pas, c'est-à-dire là où il sert le plus.
    const sagCompensated = (h: Record<string, string>): boolean => {
      const v = parseNum(configFromHeaders(h).values['vbat_sag_compensation']);
      return v !== null && v > 0;
    };
    const compensated = sagCompensated(bm.headers) && sagCompensated(am.headers);
    if (!compensated && Math.abs(sagB - sagA) >= SAG_GAP_V) {
      caveats.push({ id: 'battery', args: [sagB.toFixed(2), sagA.toFixed(2)] });
    }
  }

  return caveats;
}

// ---------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------

export interface SessionRef {
  fileName: string;
  sessionIndex: number; // 0-based dans le fichier
  craftName: string | null;
  /** Horodatage du log, null si le firmware ne l'écrit pas (vieux BF). */
  startedAt: Date | null;
}

export interface SessionComparison {
  before: SessionRef;
  after: SessionRef;
  tuneChanges: TuneChange[];
  metrics: MetricDelta[];
  caveats: Caveat[];
}

/**
 * Horodatage du log. Betaflight écrit "Log start datetime" en ISO 8601, mais
 * une carte sans RTC (ou jamais synchronisée) y met l'époque zéro : traitée
 * comme absente, sinon trois vols du Pico se retrouvent tous « le 1er janvier
 * de l'an zéro » et l'ordre chronologique devient un tirage au sort.
 */
export function sessionStartedAt(headers: Record<string, string>): Date | null {
  const raw = headers['Log start datetime'];
  if (!raw) return null;
  const t = Date.parse(raw.trim());
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return d.getUTCFullYear() < 2000 ? null : d;
}

function refOf(report: SessionReport): SessionRef {
  const m = report.analysis.meta;
  return {
    fileName: m.fileName,
    sessionIndex: m.index,
    craftName: m.craftName ?? null,
    startedAt: sessionStartedAt(m.headers),
  };
}

/**
 * Clé de regroupement d'un vol et sur quoi elle repose.
 *
 * Le craft name est le bon identifiant, mais beaucoup de pilotes ne le règlent
 * jamais : leurs logs sortent tous anonymes. Plutôt que de ne rien comparer, on
 * retombe alors sur la CIBLE DE CARTE (boardInfo) - deux vols anonymes sur la
 * même carte sont très probablement le même drone dans un outil où chacun dépose
 * ses propres logs. C'est une présomption, pas une certitude (deux builds sur la
 * même carte existent), d'où le caveat `inferredCraft` posé sur ces comparaisons.
 * Sans craft NI carte, on ne présume rien.
 */
type GroupBasis = 'craft' | 'board';
interface GroupKey {
  key: string;
  basis: GroupBasis;
  /** Nom de carte, seulement quand basis === 'board' (pour le caveat). */
  board: string | null;
}

function groupKeyOf(report: SessionReport): GroupKey | null {
  const m = report.analysis.meta;
  const craft = m.craftName?.trim();
  if (craft) return { key: `craft:${craft.toLowerCase()}`, basis: 'craft', board: null };
  const board = m.boardInfo?.trim();
  if (board) return { key: `board:${board.toLowerCase()}`, basis: 'board', board };
  return null;
}

/** Compare deux vols déjà choisis. L'appelant garantit que c'est le même quad. */
export function compareSessions(before: SessionReport, after: SessionReport): SessionComparison {
  return {
    before: refOf(before),
    after: refOf(after),
    tuneChanges: diffTune(
      configFromHeaders(before.analysis.meta.headers).values,
      configFromHeaders(after.analysis.meta.headers).values,
    ),
    metrics: compareMetrics(before.analysis, after.analysis),
    caveats: collectCaveats(before, after),
  };
}

/**
 * Chaîne de passes d'un rapport : sessions groupées par quad, ordonnées dans le
 * temps, puis comparées deux à deux consécutivement.
 *
 * L'ordre est l'horodatage quand il existe, et l'ordre de lecture sinon (ordre
 * des fichiers sur la ligne de commande, index de session dans le fichier). Ne
 * jamais mélanger les deux dans un même tri : un vol daté passerait
 * arbitrairement avant ou après un vol non daté. Un groupe partiellement daté
 * est donc trié entièrement à la lecture.
 */
export function buildComparisons(reports: ReadonlyArray<SessionReport>): SessionComparison[] {
  interface Group {
    basis: GroupBasis;
    board: string | null;
    items: Array<{ report: SessionReport; order: number }>;
  }
  const groups = new Map<string, Group>();
  reports.forEach((report, order) => {
    const gk = groupKeyOf(report);
    if (!gk) return; // ni craft ni carte : rien pour regrouper
    const g = groups.get(gk.key) ?? { basis: gk.basis, board: gk.board, items: [] };
    g.items.push({ report, order });
    groups.set(gk.key, g);
  });

  const out: SessionComparison[] = [];
  for (const g of groups.values()) {
    if (g.items.length < 2) continue;
    const dated = g.items.map((x) => sessionStartedAt(x.report.analysis.meta.headers));
    const allDated = dated.every((d) => d !== null);
    const sorted = [...g.items].sort((x, y) =>
      allDated
        ? sessionStartedAt(x.report.analysis.meta.headers)!.getTime() -
          sessionStartedAt(y.report.analysis.meta.headers)!.getTime()
        : x.order - y.order,
    );
    for (let i = 1; i < sorted.length; i++) {
      const cmp = compareSessions(sorted[i - 1].report, sorted[i].report);
      // Regroupement par carte et non par craft name : le dire en tête des
      // caveats, avant tout le reste, car il conditionne la validité même du
      // rapprochement (« est-ce bien le même drone ? »).
      if (g.basis === 'board' && g.board) {
        cmp.caveats.unshift({ id: 'inferredCraft', args: [g.board] });
      }
      out.push(cmp);
    }
  }
  return out;
}

/**
 * Sépare les caveats COMMUNS à toutes les comparaisons de ceux propres à
 * chaque paire. Un avertissement identique (même id, mêmes arguments) répété
 * sur chaque carte est une propriété du groupe - typiquement `inferredCraft`,
 * qui dit une fois pour toutes « ces vols sont regroupés par carte ». L'imprimer
 * huit fois noie les caveats qui, eux, changent d'une paire à l'autre.
 * Ne déduplique qu'à partir de deux comparaisons : sur une seule, il n'y a
 * rien à factoriser.
 */
export function splitCommonCaveats(comparisons: ReadonlyArray<SessionComparison>): {
  common: Caveat[];
  perPair: SessionComparison[];
} {
  if (comparisons.length < 2) return { common: [], perPair: [...comparisons] };
  const keyOf = (c: Caveat): string => `${c.id} ${c.args.join(' ')}`;
  const common = comparisons[0].caveats.filter((c) =>
    comparisons.every((cmp) => cmp.caveats.some((x) => keyOf(x) === keyOf(c))),
  );
  if (common.length === 0) return { common, perPair: [...comparisons] };
  const commonKeys = new Set(common.map(keyOf));
  return {
    common,
    perPair: comparisons.map((cmp) => ({
      ...cmp,
      caveats: cmp.caveats.filter((c) => !commonKeys.has(keyOf(c))),
    })),
  };
}

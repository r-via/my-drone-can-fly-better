// Analyses de base d'une session blackbox - portage fidèle des stats de
// analyze_shimera.py / analyze_pico.py (puissance, moteurs, bruit, suivi,
// timeline, GPS, failsafe). Tout est déterministe, aucune IA.
import { rmsDiff } from '../dsp/dsp';

import type {
  AxisNoise,
  AxisTracking,
  FlightData,
  GpsMetrics,
  MotorMetrics,
  NoiseMetrics,
  PowerMetrics,
  TimelineMetrics,
  TimelineSegment,
  TrackingMetrics,
} from '../types';

/** Garde-fou aberrations : un |gyro| >= 5000 deg/s = frame corrompue (cf. analyze_pico LIM). */
const GYRO_ABERRATION_LIMIT = 5000;
/** Throttle stick au-dessus duquel on considère le drone "en vol" (desync, yoyo…). */
const FLIGHT_THROTTLE_US = 1100;
/** Marge sous motorOutputHigh pour compter une saturation (2047-8 ≈ seuil 2040 des scripts). */
const SATURATION_MARGIN = 8;
/** Marge au-dessus de motorOutputHigh encore plausible (jitter DSHOT observé : 2048-2052). */
const MOTOR_OVER_RANGE_MARGIN = 8;
/** Largeur des tranches de la timeline (s). */
const TIMELINE_SLICE_S = 3;
/** Stick moyen sous lequel une tranche est considérée désarmée/idle. */
const IDLE_STICK_US = 1080;
/** Poussée moyenne (%) au-dessus de laquelle une tranche est un vol. */
const FLIGHT_THRUST_PCT = 5;

function motorPctFn(fd: FlightData): (m: number) => number {
  const lo = fd.meta.motorOutputLow;
  const range = fd.meta.motorOutputHigh - lo;
  const div = range !== 0 ? range : 1;
  return (m: number) => ((m - lo) / div) * 100;
}

/**
 * Garde-fou frames corrompues : une valeur moteur très au-delà de
 * motorOutputHigh (ex. 4294967040 = -256 en unsigned, ou 10890) vient d'une
 * frame mal décodée que le parseur de référence (orangebox) rejetait.
 * On l'exclut des stats moteur. Un léger dépassement (jusqu'à high+8) est en
 * revanche du vrai signal de saturation, observé sur des logs sains.
 */
function isMotorSampleValid(v: number, motorOutputHigh: number): boolean {
  return v >= 0 && v <= motorOutputHigh + MOTOR_OVER_RANGE_MARGIN;
}

/** Courant (A) au-dessus de la médiane à partir duquel on parle de "sous charge". */
const IMPLAUSIBLE_AMP_MARGIN_A = 10;
/** Marge de bruit ADC tolérée au-dessus de la référence locale (V par cellule). */
const IMPLAUSIBLE_MARGIN_V_PER_CELL = 0.05;
/** Largeur de la fenêtre où la tension basse doit tenir pour compter (s). */
const SUSTAINED_WINDOW_S = 1;
/** Pas d'avance de cette fenêtre (s). */
const SUSTAINED_STEP_S = 0.25;
/**
 * Canal courant suspect : ampMax au-delà de ce multiple du pic soutenu (p99).
 * Un vrai punch dure des dizaines de ms et laisse une trace dans le p99 ; une
 * pointe ADC est un échantillon isolé. Mesuré : GEPRC F722 AIO malade à ratio
 * 5.2 (326 A pour un p99 de 63), racer sain à 1.3 (98 A pour 74). Le plancher
 * évite de suspecter un log de whoop où tout le courant tient en dessous de
 * 30 A, bruit compris.
 */
const AMP_SPIKE_RATIO = 2.5;
const AMP_SPIKE_FLOOR_A = 30;

/** Médiane des valeurs retenues par `keep` ; null si aucune. */
function medianOf(x: ArrayLike<number>, keep: (v: number) => boolean): number | null {
  const buf: number[] = [];
  for (let i = 0; i < x.length; i++) if (keep(x[i])) buf.push(x[i]);
  if (buf.length === 0) return null;
  buf.sort((a, b) => a - b);
  const mid = buf.length >> 1;
  return buf.length % 2 ? buf[mid] : (buf[mid - 1] + buf[mid]) / 2;
}

/**
 * Médianes de vbat sur une grille de fenêtres glissantes de SUSTAINED_WINDOW_S,
 * avancées par pas de SUSTAINED_STEP_S. Sert de référence LOCALE : la médiane
 * globale ne convient pas, un pack est légitimement au-dessus d'elle en début
 * de vol et en dessous à la fin.
 */
function windowMedians(vb: Float32Array, time: Float64Array): { at: number[]; med: number[] } {
  const n = vb.length;
  const at: number[] = [];
  const med: number[] = [];
  if (n === 0) return { at, med };
  let lo = 0;
  const tEnd = time[n - 1];
  for (let tw = time[0]; tw <= tEnd; tw += SUSTAINED_STEP_S) {
    while (lo < n && time[lo] < tw - SUSTAINED_WINDOW_S / 2) lo++;
    const buf: number[] = [];
    for (let i = lo; i < n && time[i] <= tw + SUSTAINED_WINDOW_S / 2; i++) {
      if (vb[i] > 0) buf.push(vb[i]);
    }
    if (buf.length === 0) continue;
    buf.sort((a, b) => a - b);
    const mid = buf.length >> 1;
    at.push(tw);
    med.push(buf.length % 2 ? buf[mid] : (buf[mid - 1] + buf[mid]) / 2);
  }
  return { at, med };
}

// ---------------------------------------------------------------------------
// Puissance : batterie + courant
// ---------------------------------------------------------------------------

export function analyzePower(fd: FlightData): PowerMetrics | null {
  const vb = fd.vbat;
  if (!vb) return null;

  let vbatMax = 0;
  let vbatMin = Infinity;
  const positives: number[] = [];
  for (let i = 0; i < vb.length; i++) {
    const v = vb[i];
    if (v <= 0) continue; // échantillons ADC invalides
    if (v > vbatMax) vbatMax = v;
    if (v < vbatMin) vbatMin = v;
    positives.push(v);
  }
  if (vbatMax <= 0 || positives.length === 0) return null; // pas de vbat exploitable

  // Détection du nombre de cellules : plus petit compte qui garde la tension
  // sous 4.35 V/cellule (LiHV). round(v/4.2) se trompait sur un pack entamé :
  // 22.56 V → 5S (4.51 V/cell impossible) au lieu de 6S à 3.76.
  //
  // On divise le PIC ROBUSTE (p99), pas le max absolu : sur une carte au canal
  // vbat bruité, la tension fait des sauts VERS LE HAUT pendant les pointes de
  // courant (mesuré sur GEPRC F722 AIO : +1 V à 57 A, impossible pour une vraie
  // batterie sous charge). Ces pics isolés poussaient vbatMax au-dessus d'un
  // multiple de 4.35 et faisaient détecter 5S sur un pack 4S. Le p99 ignore le
  // 1 % le plus haut : sur un log sain il égale le max (aucun effet), sur un log
  // à pics il retombe sur la vraie tension pack. Le verdict batterie signale les
  // pics par ailleurs (implausibleSamples).
  positives.sort((a, b) => a - b);
  const vbatPeak = positives[Math.floor(0.99 * (positives.length - 1))];
  const cells = Math.max(1, Math.ceil(vbatPeak / 4.35));

  let ampAvg: number | null = null;
  let ampMax: number | null = null;
  let ampP99: number | null = null;
  let mahEstimate: number | null = null;
  const amp = fd.amperage;
  if (amp && amp.length > 0) {
    let sum = 0;
    let max = -Infinity;
    for (let i = 0; i < amp.length; i++) {
      sum += amp[i];
      if (amp[i] > max) max = amp[i];
    }
    ampAvg = sum / amp.length;
    ampMax = max;
    const sorted = [...amp].sort((a, b) => a - b);
    ampP99 = sorted[Math.floor(0.99 * (sorted.length - 1))];
    // Intégrale trapèze du courant (A) sur le temps (s) → A·s, puis /3.6 → mAh.
    // dt clampé à 1 s : une pause d'enregistrement (désarmé) ne doit pas
    // compter comme de la consommation au courant du moment.
    let ampSeconds = 0;
    for (let i = 1; i < amp.length; i++) {
      ampSeconds += ((amp[i] + amp[i - 1]) / 2) * Math.min(fd.time[i] - fd.time[i - 1], 1);
    }
    mahEstimate = ampSeconds / 3.6;
  }

  // Sag = pire chute TRANSITOIRE sous charge : écart max entre la tension et
  // le max glissant des ~3 s précédentes. max-min sur tout le log confondait
  // la décharge normale d'un long vol avec un pack fatigué.
  let sagV = 0;
  {
    const win = 3; // secondes
    let start = 0;
    // deque monotone décroissante d'indices (max glissant en O(n))
    const idx: number[] = [];
    for (let i = 0; i < vb.length; i++) {
      if (vb[i] <= 0) continue;
      while (start < i && fd.time[i] - fd.time[start] > win) start++;
      while (idx.length > 0 && idx[0] < start) idx.shift();
      while (idx.length > 0 && vb[idx[idx.length - 1]] <= vb[i]) idx.pop();
      idx.push(i);
      const localMax = vb[idx[0]];
      const drop = localMax - vb[i];
      if (drop > sagV) sagV = drop;
    }
  }

  // --- Plausibilité du canal vbat ------------------------------------------
  // Sous charge, une batterie ne peut que descendre SOUS son niveau du moment.
  // La comparaison doit donc être LOCALE : un pack plein est normalement
  // au-dessus de sa médiane globale pendant toute la première moitié du vol,
  // et une pointe de courant à ce moment-là n'a rien d'anormal.
  const grid = windowMedians(vb, fd.time);
  let implausibleSamples = 0;
  if (amp && amp.length === vb.length && grid.at.length > 0) {
    const ampMedian = medianOf(amp, () => true);
    if (ampMedian !== null) {
      const ampLimit = ampMedian + IMPLAUSIBLE_AMP_MARGIN_A;
      const margin = IMPLAUSIBLE_MARGIN_V_PER_CELL * cells;
      let g = 0;
      for (let i = 0; i < vb.length; i++) {
        if (vb[i] <= 0 || amp[i] <= ampLimit) continue;
        while (g + 1 < grid.at.length && grid.at[g + 1] <= fd.time[i]) g++;
        if (vb[i] > grid.med[g] + margin) implausibleSamples++;
      }
    }
  }

  // Minimum SOUTENU : plus basse médiane glissante sur SUSTAINED_WINDOW_S.
  // Un pack n'est pas vide parce qu'un échantillon isolé a plongé.
  const perCellMinSustained =
    (grid.med.length > 0 ? Math.min(...grid.med) : (medianOf(vb, (v) => v > 0) ?? 0)) / cells;

  // Canal courant : suspect UNIQUEMENT quand vbat est déjà incohérent (mêmes
  // transitoires, même ADC de carte qui décroche) ET que le max est une pointe
  // isolée sans commune mesure avec le pic soutenu. Une échelle ibata_scale
  // simplement mal réglée (courant faux mais lisse) n'est pas détectable ici.
  const ampImplausible =
    implausibleSamples > 0 &&
    ampMax !== null &&
    ampP99 !== null &&
    ampMax > Math.max(AMP_SPIKE_FLOOR_A, AMP_SPIKE_RATIO * ampP99);

  return {
    cells,
    perCellMinSustained,
    implausibleSamples,
    vbatMax,
    vbatMin,
    perCellMax: vbatMax / cells,
    perCellMin: vbatMin / cells,
    sagV,
    ampAvg,
    ampMax,
    ampP99,
    ampImplausible,
    mahEstimate,
  };
}

// ---------------------------------------------------------------------------
// Moteurs : moyennes, déséquilibre, saturation, desyncs (eRPM)
// ---------------------------------------------------------------------------

export function analyzeMotors(fd: FlightData): MotorMetrics {
  const pct = motorPctFn(fd);
  const satThreshold = fd.meta.motorOutputHigh - SATURATION_MARGIN;

  const hi = fd.meta.motorOutputHigh;
  const nMotors = fd.motor.length;
  const perMotorAvgPct: number[] = [];
  let sumAll = 0;
  let countAll = 0;
  let satCount = 0;
  for (let m = 0; m < nMotors; m++) {
    const arr = fd.motor[m];
    let sum = 0;
    let count = 0;
    for (let i = 0; i < arr.length; i++) {
      if (!isMotorSampleValid(arr[i], hi)) continue;
      sum += arr[i];
      count++;
      if (arr[i] >= satThreshold) satCount++;
    }
    sumAll += sum;
    countAll += count;
    perMotorAvgPct.push(count > 0 ? pct(sum / count) : 0);
  }

  // Une entrée par moteur même sans eRPM : les indices doivent rester alignés sur fd.motor.
  const desyncZeros: number[] = new Array<number>(nMotors).fill(0);
  const erpmAvailable = fd.erpm !== null;
  if (fd.erpm) {
    for (let m = 0; m < Math.min(nMotors, fd.erpm.length); m++) {
      const arr = fd.erpm[m];
      let zeros = 0;
      for (let i = 0; i < arr.length; i++) {
        // eRPM==0 pendant le vol seulement (au sol c'est normal)
        if (arr[i] === 0 && fd.throttle[i] > FLIGHT_THROTTLE_US) zeros++;
      }
      desyncZeros[m] = zeros;
    }
  }

  return {
    avgPct: countAll > 0 ? pct(sumAll / countAll) : 0,
    perMotorAvgPct,
    imbalancePctPts: Math.max(...perMotorAvgPct) - Math.min(...perMotorAvgPct),
    saturationPct: countAll > 0 ? (100 * satCount) / countAll : 0,
    desyncZeros,
    erpmAvailable,
  };
}

// ---------------------------------------------------------------------------
// Bruit gyro : RMS diff par axe, brut vs filtré
// ---------------------------------------------------------------------------

export function analyzeNoise(fd: FlightData): NoiseMetrics {
  const axes = [0, 1, 2].map((a): AxisNoise => {
    const g = fd.gyro[a];
    const gu = fd.gyroUnfilt ? fd.gyroUnfilt[a] : null;
    // On exclut les frames aberrantes (|gyro filtré| >= LIM) des deux signaux.
    const cleanG: number[] = [];
    const cleanU: number[] = [];
    let peak = 0;
    for (let i = 0; i < g.length; i++) {
      const abs = Math.abs(g[i]);
      if (abs >= GYRO_ABERRATION_LIMIT) continue;
      cleanG.push(g[i]);
      if (gu) cleanU.push(gu[i]);
      if (abs > peak) peak = abs;
    }
    const filtRms = rmsDiff(cleanG);
    const unfiltRms = gu ? rmsDiff(cleanU) : null;
    const ratio = unfiltRms !== null && filtRms > 1e-6 ? unfiltRms / filtRms : null;
    return { unfiltRms, filtRms, ratio, gyroPeak: peak };
  });
  return { axes: axes as [AxisNoise, AxisNoise, AxisNoise] };
}

// ---------------------------------------------------------------------------
// Suivi de consigne : |setpoint - gyro| par axe
// ---------------------------------------------------------------------------

export function analyzeTracking(fd: FlightData): TrackingMetrics {
  const axes = [0, 1, 2].map((a): AxisTracking => {
    const g = fd.gyro[a];
    const sp = fd.setpoint[a];
    let errSum = 0;
    let maxErr = 0;
    let setpointMax = 0;
    for (let i = 0; i < g.length; i++) {
      const err = Math.abs(sp[i] - g[i]);
      errSum += err;
      if (err > maxErr) maxErr = err;
      const spAbs = Math.abs(sp[i]);
      if (spAbs > setpointMax) setpointMax = spAbs;
    }
    return {
      meanAbsErr: g.length > 0 ? errSum / g.length : 0,
      maxErr,
      setpointMax,
    };
  });
  return { axes: axes as [AxisTracking, AxisTracking, AxisTracking] };
}

// ---------------------------------------------------------------------------
// Timeline : tranches de 3 s pour repérer les vols dans un log continu
// ---------------------------------------------------------------------------

interface SliceAcc {
  count: number;
  stickSum: number;
  colSum: number; // poussée collective brute (moyenne de tous les moteurs)
  colCount: number; // frames dont tous les moteurs sont valides
  vbSum: number;
  vbCount: number;
}

export function analyzeTimeline(fd: FlightData): TimelineMetrics {
  const pct = motorPctFn(fd);
  const hi = fd.meta.motorOutputHigh;
  const nMotors = fd.motor.length;
  const buckets = new Map<number, SliceAcc>();
  const n = fd.time.length;
  for (let i = 0; i < n; i++) {
    const k = Math.floor(fd.time[i] / TIMELINE_SLICE_S);
    let b = buckets.get(k);
    if (!b) {
      b = { count: 0, stickSum: 0, colSum: 0, colCount: 0, vbSum: 0, vbCount: 0 };
      buckets.set(k, b);
    }
    b.count++;
    b.stickSum += fd.throttle[i];
    let colSum = 0;
    let allValid = true;
    for (let m = 0; m < nMotors; m++) {
      const v = fd.motor[m][i];
      if (!isMotorSampleValid(v, hi)) {
        allValid = false;
        break;
      }
      colSum += v;
    }
    if (allValid) {
      b.colSum += colSum / nMotors;
      b.colCount++;
    }
    if (fd.vbat && fd.vbat[i] > 0) {
      b.vbSum += fd.vbat[i];
      b.vbCount++;
    }
  }

  const segments: TimelineSegment[] = [];
  let flightTimeS = 0;
  for (const k of [...buckets.keys()].sort((a, b) => a - b)) {
    const b = buckets.get(k)!;
    const stickAvg = b.stickSum / b.count;
    const thrustPct = b.colCount > 0 ? pct(b.colSum / b.colCount) : 0;
    const state: TimelineSegment['state'] =
      stickAvg < IDLE_STICK_US ? 'idle' : thrustPct > FLIGHT_THRUST_PCT ? 'flight' : 'low';
    const tStart = k * TIMELINE_SLICE_S;
    const tEnd = Math.min((k + 1) * TIMELINE_SLICE_S, fd.meta.durationS);
    if (state === 'flight') flightTimeS += tEnd - tStart;
    segments.push({
      tStart,
      tEnd,
      state,
      stickAvg,
      thrustPct,
      vbat: b.vbCount > 0 ? b.vbSum / b.vbCount : null,
    });
  }
  let throttleMaxUs = 0;
  for (let i = 0; i < fd.throttle.length; i++) {
    if (fd.throttle[i] > throttleMaxUs) throttleMaxUs = fd.throttle[i];
  }
  return { segments, flightTimeS, throttleMaxUs };
}

// ---------------------------------------------------------------------------
// GPS + failsafe
// ---------------------------------------------------------------------------

/** Au-delà, un compte de sats est une frame corrompue (multi-constellation réel : ~40 max). */
const GPS_MAX_PLAUSIBLE_SATS = 45;
/** Écart à la médiane glissante au-delà duquel une frame G est jetée comme corrompue. */
const GPS_SPIKE_SATS = 3;
/** Demi-fenêtre de la médiane glissante de nettoyage (5 frames au total). */
const GPS_SMOOTH_HALF = 2;
/** Sats requis pour considérer l'accroche saine (aligné sur gps_rescue_min_sats). */
const GPS_HEALTHY_SATS = 8;
/** Chute retenue : au moins ce déficit vs la médiane des 10 frames précédentes. */
const GPS_DROP_SATS = 3;
/** Écart de throttle (µs) minimal entre buckets bas/haut pour oser une corrélation. */
const GPS_THROTTLE_SPREAD_US = 60;
/** Frames minimales par bucket throttle pour la corrélation. */
const GPS_THROTTLE_MIN_FRAMES = 12;

const GPS_EMPTY: GpsMetrics = {
  available: false,
  numSatMax: null,
  numSatMin: null,
  numSatMedian: null,
  speedMaxMps: null,
  corruptFrameRatio: null,
  timeToHealthySatsS: null,
  satDrops: [],
  satsVsThrottle: null,
  hdopMedian: null,
  hdopWorst: null,
};

/** Médiane d'un tableau trié à la volée (copie locale). */
function med(buf: number[]): number {
  const s = [...buf].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Les frames G des logs réels sont truffées de valeurs corrompues (sat=0 isolé,
 * sat=1042, temps négatifs) : décodeur et flash saturée confondus. Tout passe
 * donc par un double filtre - plausibilité brute puis écart à la médiane
 * glissante - avant la moindre statistique. Les indices retenus servent aussi
 * à lire hdop et speed : une frame corrompue l'est sur tous ses champs.
 */
export function analyzeGps(fd: FlightData): GpsMetrics {
  if (!fd.gps || fd.gps.numSat.length === 0) return GPS_EMPTY;
  const { time, numSat, speedMps, hdop } = fd.gps;
  const n = numSat.length;

  // Passe 1 : plausibilité brute.
  const plausible: number[] = [];
  for (let i = 0; i < n; i++) {
    if (numSat[i] >= 0 && numSat[i] <= GPS_MAX_PLAUSIBLE_SATS) plausible.push(i);
  }
  // Passe 2 : rejet des pointes vs médiane glissante sur les frames plausibles.
  const kept: number[] = [];
  const cleanSat: number[] = [];
  for (let k = 0; k < plausible.length; k++) {
    const win: number[] = [];
    for (
      let j = Math.max(0, k - GPS_SMOOTH_HALF);
      j <= Math.min(plausible.length - 1, k + GPS_SMOOTH_HALF);
      j++
    ) {
      win.push(numSat[plausible[j]]);
    }
    const m = med(win);
    if (Math.abs(numSat[plausible[k]] - m) <= GPS_SPIKE_SATS) {
      kept.push(plausible[k]);
      cleanSat.push(numSat[plausible[k]]);
    }
  }
  if (kept.length === 0) return { ...GPS_EMPTY, available: true, corruptFrameRatio: 1 };

  const corruptFrameRatio = 1 - kept.length / n;
  let numSatMax = -Infinity;
  let numSatMin = Infinity;
  let speedMaxMps = 0;
  for (let k = 0; k < kept.length; k++) {
    const s = cleanSat[k];
    if (s > numSatMax) numSatMax = s;
    if (s < numSatMin) numSatMin = s;
    const v = speedMps[kept[k]];
    if (v >= 0 && v < 200 && v > speedMaxMps) speedMaxMps = v;
  }
  const numSatMedian = med(cleanSat);

  // Premier instant d'accroche saine (8+ sats).
  let timeToHealthySatsS: number | null = null;
  for (let k = 0; k < kept.length; k++) {
    if (cleanSat[k] >= GPS_HEALTHY_SATS) {
      timeToHealthySatsS = time[kept[k]];
      break;
    }
  }

  // Chutes transitoires : déficit vs la médiane des 10 frames retenues
  // précédentes, maintenu sur au moins 2 frames.
  const satDrops: GpsMetrics['satDrops'] = [];
  let k = 10;
  while (k < kept.length && satDrops.length < 10) {
    const trail = med(cleanSat.slice(k - 10, k));
    if (cleanSat[k] <= trail - GPS_DROP_SATS) {
      const start = k;
      let floor = cleanSat[k];
      while (k < kept.length && cleanSat[k] <= trail - GPS_DROP_SATS) {
        if (cleanSat[k] < floor) floor = cleanSat[k];
        k++;
      }
      if (k - start >= 2) {
        satDrops.push({
          timeS: time[kept[start]],
          fromSats: trail,
          toSats: floor,
          durationS: Math.max(0, time[kept[Math.min(k, kept.length - 1)]] - time[kept[start]]),
        });
      }
    } else {
      k++;
    }
  }

  // Corrélation sats/throttle : signature d'une interférence liée à la
  // puissance (VTX, ESC, câblage) qui aveugle le récepteur quand ça pousse.
  let satsVsThrottle: GpsMetrics['satsVsThrottle'] = null;
  if (fd.throttle.length > 0 && kept.length >= GPS_THROTTLE_MIN_FRAMES * 2) {
    const thrAt: number[] = [];
    let ti = 0;
    for (let j = 0; j < kept.length; j++) {
      const t = time[kept[j]];
      while (ti < fd.time.length - 1 && fd.time[ti] < t) ti++;
      thrAt.push(fd.throttle[ti]);
    }
    const thrMed = med(thrAt);
    const sorted = [...thrAt].sort((a, b) => a - b);
    const p66 = sorted[Math.floor(sorted.length * 0.66)];
    if (p66 - thrMed >= GPS_THROTTLE_SPREAD_US) {
      const lowSats: number[] = [];
      const highSats: number[] = [];
      for (let j = 0; j < kept.length; j++) {
        if (thrAt[j] <= thrMed) lowSats.push(cleanSat[j]);
        else if (thrAt[j] >= p66) highSats.push(cleanSat[j]);
      }
      if (lowSats.length >= GPS_THROTTLE_MIN_FRAMES && highSats.length >= GPS_THROTTLE_MIN_FRAMES) {
        const lowMedian = med(lowSats);
        const highMedian = med(highSats);
        satsVsThrottle = { lowMedian, highMedian, delta: highMedian - lowMedian };
      }
    }
  }

  // HDOP (INAV) : lu sur les mêmes frames retenues, en écartant les zéros
  // (champ absent ou frame partielle).
  let hdopMedian: number | null = null;
  let hdopWorst: number | null = null;
  if (hdop) {
    const vals: number[] = [];
    for (let j = 0; j < kept.length; j++) {
      const v = hdop[kept[j]];
      if (v > 0.2 && v < 50) vals.push(v);
    }
    if (vals.length >= 5) {
      hdopMedian = med(vals);
      const s = [...vals].sort((a, b) => a - b);
      hdopWorst = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
    }
  }

  return {
    available: true,
    numSatMax,
    numSatMin,
    numSatMedian,
    speedMaxMps,
    corruptFrameRatio,
    timeToHealthySatsS,
    satDrops,
    satsVsThrottle,
    hdopMedian,
    hdopWorst,
  };
}

/** Phases failsafe bénignes : jamais déclenché ou valeur inconnue/vide. */
const BENIGN_FAILSAFE_PHASES = new Set(['0', '', '?', 'IDLE']);

/** L'enum failsafePhase Betaflight tient dans 0..7 - au-delà c'est une slow
 *  frame corrompue du décodeur (ex. 4294967294 = -2 en u32), pas un failsafe. */
function isValidFailsafePhase(phase: string): boolean {
  const n = Number(phase);
  return Number.isNaN(n) ? true : n >= 0 && n <= 7;
}

export function analyzeFailsafe(fd: FlightData): { phases: Record<string, number>; triggered: boolean } {
  const phases = { ...fd.failsafePhaseCounts };
  const triggered = Object.entries(phases).some(
    ([phase, count]) => count > 0 && !BENIGN_FAILSAFE_PHASES.has(phase) && isValidFailsafePhase(phase),
  );
  return { phases, triggered };
}

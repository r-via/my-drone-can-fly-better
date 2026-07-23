// Perte de contrôle en vol, segmentée en ÉVÉNEMENTS DATÉS.
//
// La grandeur surveillée est la ROTATION EXCÉDENTAIRE : ce que le gyro fait
// AU-DELÀ de la consigne (même signe, plus vite qu'elle) ou À CONTRE-SENS
// d'elle. Une figure commandée, où le gyro court APRÈS la consigne, produit
// un excès nul par construction : l'erreur de poursuite (gyro en retard sur
// la consigne) n'est jamais comptée. C'est ce qui sépare cette détection de
// l'erreur de suivi classique, grosse sur tout vol agressif.
//
// Un excès seul ne suffit pas : un lâcher de stick laisse le gyro au-dessus
// d'une consigne revenue à zéro pendant quelques dizaines de ms, sur un quad
// parfaitement sain. L'événement ne qualifie que si le mixer est AU BOUT DE
// SON AUTORITÉ pendant l'excès (différentiel moteurs quasi pleine plage, une
// butée touchée) : la boucle commande le maximum physique et l'attitude
// diverge quand même. C'est la signature d'un moteur qui décroche (désync,
// perte de poussée), d'une hélice perdue ou d'un impact - la seule visible
// sans eRPM dans le log (APD + INAV notamment).
//
// 100 % déterministe, aucune IA.
import { median } from '../dsp/dsp';
import { motorsValidFn } from './shared';

import type { Axis, ControlLossEvent, ControlLossMetrics, FlightData } from '../types';

/** Throttle stick au-dessus duquel on considère le drone "en vol". */
const FLIGHT_THROTTLE_US = 1100;
/** Sous ce nombre d'échantillons, pas d'analyse fiable. */
const MIN_SAMPLES = 500;
/** |gyro| >= 5000 deg/s = frame corrompue (même garde-fou que basic.ts). */
const GYRO_ABERRATION_LIMIT = 5000;
/**
 * Hystérésis sur l'excès de rotation (deg/s) : on entre au-dessus de ENTER,
 * on ne sort qu'en repassant sous EXIT. Calibré sur le corpus : les vols
 * sains (freestyle 5", 7", whoop) plafonnent nettement plus bas, l'événement
 * du log Akira (X8 9" en désync) culmine à plus de 500.
 */
const ENTER_EXCESS_DPS = 300;
const EXIT_EXCESS_DPS = 150;
/** Deux épisodes séparés de moins que ça sont le même incident. */
const MERGE_GAP_S = 0.3;
/** Sous cette durée, l'excès est un transitoire de lâcher de stick, pas une perte de contrôle. */
const MIN_EVENT_S = 0.05;
/**
 * Différentiel mixer mini au pic (max - min moteurs, % de plage) : en dessous,
 * la boucle avait encore de la réserve, l'excursion relève du tune (suivi,
 * oscillation), pas d'une perte d'autorité.
 */
const MIN_SPREAD_PCT = 70;
/** Marge sous/sur les butées moteur pour compter une butée touchée. */
const STOP_MARGIN = 8;
/**
 * Fenêtre en amont de tStart où l'on vérifie que le drone volait. Courte à
 * dessein : l'excès franchit son seuil en quelques dizaines de ms, le pilote
 * n'a pas encore réagi à tStart. Une fenêtre longue relabelliserait en vol un
 * choc d'atterrissage (gaz coupés, le quad se pose et bascule) parce que le
 * drone volait encore une demi-seconde avant - mesuré sur le corpus (Pavo
 * Pico, pose à t-0.12 s du choc).
 */
const ONSET_LOOKBACK_S = 0.15;
const MAX_EVENTS = 5;

export function analyzeControlLoss(fd: FlightData): ControlLossMetrics {
  const n = fd.time.length;
  const empty: ControlLossMetrics = { applicable: false, events: [], worst: null };
  if (n < MIN_SAMPLES) return empty;

  const motorsValid = motorsValidFn(fd, STOP_MARGIN);
  const hi = fd.meta.motorOutputHigh > 0 ? fd.meta.motorOutputHigh : 2047;
  const lo = fd.meta.motorOutputLow;
  const range = hi - lo;
  const nMotors = fd.motor.length;

  // Excès de rotation par échantillon : pire axe. Les frames gyro corrompues
  // (valeurs 2^31…) produiraient des excès fantasmagoriques : exclues.
  const exc = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let worst = 0;
    let corrupt = false;
    for (let a = 0; a < 3; a++) {
      const g = fd.gyro[a][i];
      if (Math.abs(g) >= GYRO_ABERRATION_LIMIT) {
        corrupt = true;
        break;
      }
      const s = fd.setpoint[a][i];
      const e = g * s >= 0 ? Math.abs(g) - Math.abs(s) : Math.abs(g);
      if (e > worst) worst = e;
    }
    exc[i] = corrupt ? 0 : worst;
  }

  // Segmentation par hystérésis, puis fusion des épisodes proches.
  const ranges: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (start < 0) {
      if (exc[i] > ENTER_EXCESS_DPS) start = i;
    } else if (exc[i] < EXIT_EXCESS_DPS) {
      ranges.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) ranges.push([start, n - 1]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && fd.time[r[0]] - fd.time[last[1]] < MERGE_GAP_S) last[1] = r[1];
    else merged.push([r[0], r[1]]);
  }

  const events: ControlLossEvent[] = [];
  for (const [s, e] of merged) {
    const tStart = fd.time[s];
    const tEnd = fd.time[e];
    if (tEnd - tStart < MIN_EVENT_S) continue;

    // Le drone doit voler juste AVANT le déclenchement : on regarde en amont,
    // jamais pendant (couper les gaz pendant l'événement est la bonne réaction
    // du pilote et ne doit pas disqualifier).
    const thr: number[] = [];
    for (let i = s; i >= 0 && fd.time[i] > tStart - ONSET_LOOKBACK_S; i--) thr.push(fd.throttle[i]);
    if (thr.length === 0 || median(thr) <= FLIGHT_THROTTLE_US) continue;

    let peakErr = 0;
    let peakExcess = 0;
    let axis: Axis = 0;
    let peakSpread = 0;
    let floorTouched = false;
    let ceilTouched = false;
    for (let i = s; i <= e; i++) {
      for (let a = 0; a < 3; a++) {
        const g = fd.gyro[a][i];
        if (Math.abs(g) >= GYRO_ABERRATION_LIMIT) continue;
        const err = Math.abs(g - fd.setpoint[a][i]);
        if (err > peakErr) {
          peakErr = err;
          axis = a as Axis;
        }
      }
      if (exc[i] > peakExcess) peakExcess = exc[i];
      if (!motorsValid(i)) continue;
      let minV = Infinity;
      let maxV = -Infinity;
      for (let m = 0; m < nMotors; m++) {
        const v = fd.motor[m][i];
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
      const spread = range > 0 ? (100 * (maxV - minV)) / range : 0;
      if (spread > peakSpread) peakSpread = spread;
      if (minV <= lo + STOP_MARGIN) floorTouched = true;
      if (maxV >= hi - STOP_MARGIN) ceilTouched = true;
    }

    // Qualification autorité : différentiel quasi pleine plage ET une butée
    // touchée. Sans ça, l'excursion est un problème de tune, pas de contrôle.
    if (peakSpread < MIN_SPREAD_PCT) continue;
    if (!floorTouched && !ceilTouched) continue;

    events.push({
      tStart,
      tEnd,
      axis,
      peakErrDps: peakErr,
      peakExcessDps: peakExcess,
      peakSpreadPct: peakSpread,
      floorTouched,
      ceilTouched,
    });
  }

  events.sort((a, b) => b.peakExcessDps - a.peakExcessDps);
  const kept = events.slice(0, MAX_EVENTS);
  return { applicable: true, events: kept, worst: kept[0] ?? null };
}

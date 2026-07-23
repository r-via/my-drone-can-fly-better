// Helpers communs aux analyses (flight, oscillation) : mêmes définitions,
// une seule implémentation.
import type { FlightData } from '../types';

/** Fréquence d'échantillonnage : meta si valide, sinon estimée depuis time. */
export function sampleRate(fd: FlightData): number {
  const fs = fd.meta.sampleRateHz;
  if (Number.isFinite(fs) && fs > 0) return fs;
  const n = fd.time.length;
  const dur = n > 1 ? fd.time[n - 1] - fd.time[0] : 0;
  return dur > 0 ? (n - 1) / dur : 1000;
}

/**
 * Frame moteur saine : toutes les valeurs brutes dans [0, motorOutputHigh + margin].
 * Le parseur WASM laisse passer quelques frames corrompues (valeurs 2^32…)
 * que orangebox droppait - on les exclut, sinon std(poussée) explose.
 * `margin` élargit la borne haute quand un léger dépassement est du vrai
 * signal (butées moteur, cf. STOP_MARGIN d'oscillation.ts).
 */
export function motorsValidFn(fd: FlightData, margin = 0): (i: number) => boolean {
  const hi = (fd.meta.motorOutputHigh > 0 ? fd.meta.motorOutputHigh : 2047) + margin;
  const nMotors = fd.motor.length;
  return (i: number) => {
    for (let m = 0; m < nMotors; m++) {
      const v = fd.motor[m][i];
      if (!(v >= 0 && v <= hi)) return false;
    }
    return true;
  };
}

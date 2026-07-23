// Score de vol /100, façon PageSpeed : chaque axe d'analyse pèse un poids fixe
// dans l'anneau et dans la note. Un axe sans données (ex. batterie non
// enregistrée) est affiché en gris « données absentes » : il ne note ni ne
// pénalise, mais le score total est plafonné - un vol incomplet ne peut pas
// afficher un 100/100 comme s'il avait tout prouvé.
//
// Le chiffre reste traçable : pénalité fixe par sévérité à l'intérieur de
// chaque axe, moyenne pondérée des axes mesurés, puis déductions plates pour
// les catégories hors anneau (gps, log, config). Aucune règle nouvelle ici -
// c'est une visualisation des mêmes verdicts.

import type { FindingCategory, SessionReport, Severity } from './types';

/** Poids des axes de l'anneau (somme 100). Sécurité et PID pèsent plus :
 *  c'est ce qu'on vient chercher dans un rapport de tune. */
export const AXIS_WEIGHTS: ReadonlyArray<{ category: FindingCategory; weight: number }> = [
  { category: 'securite', weight: 20 },
  { category: 'pid', weight: 20 },
  { category: 'vibrations', weight: 15 },
  { category: 'filtres', weight: 15 },
  { category: 'moteurs', weight: 15 },
  { category: 'batterie', weight: 15 },
];

/** Pénalités au sein d'un axe : un crit doit couler SON axe (40/100),
 *  pas diluer 25 points dans la moyenne globale. */
const AXIS_PENALTY: Record<Severity, number> = { crit: 60, warn: 25, info: 8, ok: 0 };

/** Catégories hors anneau (gps, log, config) : déduction plate sur le total. */
const FLAT_PENALTY: Record<Severity, number> = { crit: 25, warn: 12, info: 4, ok: 0 };

/** Plafond du score quand un axe n'est pas mesuré : la renormalisation seule
 *  redonnerait 100/100 sans données batterie (jugé trompeur), une pénalité
 *  pleine punirait un simple choix d'enregistrement. */
export const MISSING_AXIS_CAP = 95;

const SEV_RANK: Record<Severity, number> = { ok: 0, info: 1, warn: 2, crit: 3 };

export interface AxisScore {
  category: FindingCategory;
  weight: number;
  /** Faux quand le log ne porte pas la donnée (batterie non enregistrée). */
  evaluated: boolean;
  /** 0-100. Vaut 100 par convention quand non évalué - jamais compté. */
  score: number;
  worst: Severity;
}

export interface FlightScore {
  score: number;
  axes: AxisScore[];
  /** Déductions par catégorie hors anneau, triées par coût décroissant. */
  flatPenalties: Array<{ category: FindingCategory; penalty: number }>;
  /** Vrai si le plafond « axe manquant » a réellement écrêté le score. */
  capped: boolean;
}

export function computeFlightScore(sessionReport: SessionReport): FlightScore {
  const counted = sessionReport.findings.filter((f) => !f.scoreExempt);

  const axes: AxisScore[] = AXIS_WEIGHTS.map(({ category, weight }) => {
    // Seule la batterie peut manquer : les autres axes sortent toujours des
    // champs obligatoires du log (gyro, setpoint, moteurs).
    const evaluated = category !== 'batterie' || sessionReport.analysis.power !== null;
    let worst: Severity = 'ok';
    let penalty = 0;
    if (evaluated) {
      for (const f of counted) {
        if (f.category !== category) continue;
        if (SEV_RANK[f.severity] > SEV_RANK[worst]) worst = f.severity;
        penalty += AXIS_PENALTY[f.severity];
      }
    }
    return { category, weight, evaluated, score: Math.max(0, 100 - penalty), worst };
  });

  const isAxisCategory = (c: FindingCategory): boolean =>
    AXIS_WEIGHTS.some((a) => a.category === c);
  const flatByCat = new Map<FindingCategory, number>();
  for (const f of counted) {
    if (isAxisCategory(f.category)) continue;
    flatByCat.set(f.category, (flatByCat.get(f.category) ?? 0) + FLAT_PENALTY[f.severity]);
  }
  const flatPenalties = Array.from(flatByCat.entries())
    .map(([category, penalty]) => ({ category, penalty }))
    .filter((p) => p.penalty > 0)
    .sort((a, b) => b.penalty - a.penalty);

  const evaluated = axes.filter((a) => a.evaluated);
  const weightSum = evaluated.reduce((s, a) => s + a.weight, 0);
  const weightedAvg =
    weightSum > 0 ? evaluated.reduce((s, a) => s + a.weight * a.score, 0) / weightSum : 0;
  const flatTotal = flatPenalties.reduce((s, p) => s + p.penalty, 0);

  let score = Math.max(0, Math.round(weightedAvg) - flatTotal);
  const missing = axes.some((a) => !a.evaluated);
  const capped = missing && score > MISSING_AXIS_CAP;
  if (capped) score = MISSING_AXIS_CAP;

  return { score, axes, flatPenalties, capped };
}

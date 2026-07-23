// Score pondéré façon PageSpeed : moyenne des axes mesurés, axe sans données
// en gris (ni note ni pénalité) mais plafond à 95, déductions plates pour les
// catégories hors anneau, findings scoreExempt ignorés.
import { describe, expect, it } from 'vitest';

import { AXIS_WEIGHTS, MISSING_AXIS_CAP, computeFlightScore } from '../src/lib/score';

import type { Finding, SessionReport, Severity } from '../src/lib/types';

function finding(over: Partial<Finding> & { category: Finding['category'] }): Finding {
  return {
    id: over.id ?? 'test-rule',
    severity: over.severity ?? 'warn',
    title: 't',
    detail: 'd',
    evidence: 'e',
    ...over,
  };
}

/** SessionReport minimal : computeFlightScore ne lit que findings et power. */
function report(findings: Finding[], power: unknown = {}): SessionReport {
  return { findings, analysis: { power } } as unknown as SessionReport;
}

describe('computeFlightScore', () => {
  it('les poids somment à 100', () => {
    expect(AXIS_WEIGHTS.reduce((s, a) => s + a.weight, 0)).toBe(100);
  });

  it('aucun finding, tout mesuré → 100, aucun axe absent', () => {
    const r = computeFlightScore(report([]));
    expect(r.score).toBe(100);
    expect(r.capped).toBe(false);
    expect(r.axes.every((a) => a.evaluated)).toBe(true);
  });

  it('batterie sans données → axe gris et plafond à 95 même sur un vol parfait', () => {
    const r = computeFlightScore(report([], null));
    expect(r.score).toBe(MISSING_AXIS_CAP);
    expect(r.capped).toBe(true);
    expect(r.axes.find((a) => a.category === 'batterie')?.evaluated).toBe(false);
  });

  it('un crit coule SON axe : sécurité crit → axe à 40, total pondéré', () => {
    const r = computeFlightScore(report([finding({ category: 'securite', severity: 'crit' })]));
    const axis = r.axes.find((a) => a.category === 'securite');
    expect(axis?.score).toBe(40);
    expect(axis?.worst).toBe('crit');
    // (20×40 + 80×100) / 100 = 88
    expect(r.score).toBe(88);
  });

  it('info dans un axe → petite entaille, pas un warn', () => {
    const r = computeFlightScore(report([finding({ category: 'pid', severity: 'info' })]));
    expect(r.axes.find((a) => a.category === 'pid')?.score).toBe(92);
    // (20×92 + 80×100) / 100 = 98.4 → 98
    expect(r.score).toBe(98);
  });

  it('catégorie hors anneau (log) → déduction plate sur le total', () => {
    const r = computeFlightScore(report([finding({ category: 'log', severity: 'info' })]));
    expect(r.score).toBe(96);
    expect(r.flatPenalties).toEqual([{ category: 'log', penalty: 4 }]);
    expect(r.axes.every((a) => a.score === 100)).toBe(true);
  });

  it('scoreExempt : mentionné mais jamais compté', () => {
    const r = computeFlightScore(
      report([finding({ category: 'config', severity: 'info', scoreExempt: true })]),
    );
    expect(r.score).toBe(100);
    expect(r.flatPenalties).toEqual([]);
  });

  it('batterie absente : ses findings (battery-not-logged) ne comptent nulle part', () => {
    const r = computeFlightScore(
      report([finding({ id: 'battery-not-logged', category: 'batterie', severity: 'info' })], null),
    );
    expect(r.score).toBe(MISSING_AXIS_CAP);
    expect(r.flatPenalties).toEqual([]);
  });

  it('cas JeNo : yaw info + batterie absente → 95 plafonné', () => {
    const r = computeFlightScore(
      report(
        [
          finding({ id: 'step-settle-off', category: 'pid', severity: 'info' }),
          finding({ id: 'battery-not-logged', category: 'batterie', severity: 'info' }),
          finding({ id: 'ff-zero', category: 'config', severity: 'info', scoreExempt: true }),
        ],
        null,
      ),
    );
    // Axes mesurés : (20×100 + 20×92 + 15×3×100) / 85 = 98.1 → 98, plafonné à 95.
    expect(r.score).toBe(MISSING_AXIS_CAP);
    expect(r.capped).toBe(true);
  });

  it('le plancher 0 tient par axe et au total', () => {
    const sev: Severity = 'crit';
    const r = computeFlightScore(
      report([
        finding({ category: 'securite', severity: sev }),
        finding({ id: 'r2', category: 'securite', severity: sev }),
        finding({ category: 'pid', severity: sev }),
        finding({ category: 'vibrations', severity: sev }),
        finding({ category: 'filtres', severity: sev }),
        finding({ category: 'moteurs', severity: sev }),
        finding({ category: 'batterie', severity: sev }),
        finding({ category: 'log', severity: sev }),
        finding({ category: 'gps', severity: sev }),
      ]),
    );
    expect(r.axes.find((a) => a.category === 'securite')?.score).toBe(0);
    expect(r.score).toBe(0);
  });
});

// Vérifie que le stub analyze-client et les helpers UI purs compilent et s'exportent
// correctement (l'UI elle-même n'est pas testée — pas de renderer React ici).

import { describe, expect, it } from 'vitest';
import { useAnalyzer, type AnalyzerState } from '../src/lib/analyze-client';
import { collectCliLines } from '../src/components/CliExport';
import type { Finding } from '../src/lib/types';

describe('analyze-client (stub)', () => {
  it('exporte useAnalyzer', () => {
    expect(typeof useAnalyzer).toBe('function');
  });

  it('AnalyzerState accepte les quatre statuts du contrat', () => {
    const states: AnalyzerState[] = [
      { status: 'idle', report: null },
      { status: 'working', step: 'Décodage du log…', report: null },
      { status: 'ready', report: null },
      { status: 'error', report: null, error: 'moteur pas encore branché' },
    ];
    expect(states).toHaveLength(4);
  });
});

describe('collectCliLines', () => {
  const finding = (id: string, cli?: string[]): Finding => ({
    id,
    severity: 'warn',
    category: 'filtres',
    title: 't',
    detail: 'd',
    evidence: 'e',
    ...(cli ? { fix: { text: 'fix', cli } } : {}),
  });

  it('déduplique en préservant l’ordre et ignore les findings sans fix', () => {
    const lines = collectCliLines([
      finding('a', ['set gyro_lpf1_static_hz = 250', 'set dyn_notch_count = 2']),
      finding('b'),
      finding('c', ['set gyro_lpf1_static_hz = 250', 'set simplified_gyro_filter = ON']),
    ]);
    expect(lines).toEqual([
      'set gyro_lpf1_static_hz = 250',
      'set dyn_notch_count = 2',
      'set simplified_gyro_filter = ON',
    ]);
  });

  it('retourne un tableau vide sans lignes cli', () => {
    expect(collectCliLines([finding('a')])).toEqual([]);
  });
});

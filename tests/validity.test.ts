// Validité des mesures et règles de config croisées avec les données.
// Principe commun aux deux : on ne publie pas un verdict tiré d'une mesure
// impossible, et une règle de config ne vaut que confrontée au vol réel.
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

import { analyzePower, analyzeTimeline } from '../src/lib/analysis/basic';
import { initWasm, parseFile } from '../src/lib/bbl/parse';
import { buildSessionReport } from '../src/lib/report';
import type { FlightData } from '../src/lib/types';

const RACER = '/home/rviau/projects/drones/shared-logs/dake-f722-racer-oscillation.bbl';
const CHIMERA = '/home/rviau/projects/drones/chimera/blackbox/btfl_016.bbl';
const LR4 = '/home/rviau/projects/drones/explorer lr4/btfl_003.bbl';
const PICO = '/home/rviau/projects/drones/pavo pico/btfl_002.bbl';

let racer: FlightData;
let chimera: FlightData;
let lr4: FlightData;
let pico: FlightData;

beforeAll(async () => {
  await initWasm(await readFile(new URL('../public/blackbox-log.wasm', import.meta.url)));
  const load = async (p: string, name: string) =>
    (await parseFile(name, new Uint8Array(await readFile(p)))).sessions[0];
  racer = await load(RACER, 'racer.bbl');
  chimera = await load(CHIMERA, 'btfl_016.bbl');
  lr4 = await load(LR4, 'btfl_003.bbl');
  pico = await load(PICO, 'btfl_002.bbl');
});

const ids = (fd: FlightData): string[] => buildSessionReport(fd, null).findings.map((f) => f.id);

// ---------------------------------------------------------------------------
// Plausibilité vbat
// ---------------------------------------------------------------------------

describe('validité du canal vbat', () => {
  it('repère les lectures impossibles du racer (tension qui monte sous charge)', () => {
    const p = analyzePower(racer)!;
    expect(p.implausibleSamples).toBeGreaterThan(100);
    // Le brut reste disponible pour l'affichage, on ne le réécrit pas.
    expect(p.vbatMax).toBeCloseTo(24.99, 1);
    expect(p.vbatMin).toBeCloseTo(15.96, 1);
    // Le minimum SOUTENU, lui, est celui d'un pack en bonne santé.
    expect(p.perCellMinSustained).toBeGreaterThan(3.3);
  });

  it("retire les verdicts batterie plutôt que d'annoncer un pack mort à tort", () => {
    const got = ids(racer);
    expect(got).toContain('battery-readings-implausible');
    expect(got).not.toContain('battery-sag');
    expect(got).not.toContain('battery-empty');
  });

  it('ne se déclenche sur aucun log sain du parc', () => {
    for (const fd of [chimera, lr4, pico]) {
      const p = analyzePower(fd)!;
      expect(p.implausibleSamples).toBe(0);
      expect(ids(fd)).not.toContain('battery-readings-implausible');
    }
  });

  it('perCellMinSustained reste proche du min brut quand la mesure est saine', () => {
    // Sans glitch, le minimum tenu sur 1 s ne peut pas être très loin du
    // minimum instantané : la différence est la décharge, pas du bruit.
    for (const fd of [chimera, pico]) {
      const p = analyzePower(fd)!;
      // Toujours au-dessus du min instantané (il ignore les creux isolés) mais
      // sous le max : c'est une tension réellement atteinte, pas un plafond.
      expect(p.perCellMinSustained).toBeGreaterThanOrEqual(p.perCellMin);
      expect(p.perCellMinSustained).toBeLessThanOrEqual(p.perCellMax);
    }
  });
});

// ---------------------------------------------------------------------------
// Règles de config lues dans les en-têtes du log
// ---------------------------------------------------------------------------

describe('lint de config depuis les en-têtes du .bbl', () => {
  it('explique le trou de filtrage du racer, parce qu’un symptôme est mesuré', () => {
    // dyn_notch_count = 1, rpm_filter_min_hz = 100, fade_range = 50 → plafond
    // 150 Hz, alors que deux fondamentales mesurées sont à 145 et 147 Hz.
    // Le verdict n'existe QUE parce que l'oscillation est détectée à côté.
    const got = ids(racer);
    expect(got).toContain('filter-coverage-suspect');
    const f = buildSessionReport(racer, null).findings.find(
      (x) => x.id === 'filter-coverage-suspect',
    )!;
    expect(f.evidence).toContain('dyn_notch_count = 1');
    expect(f.evidence).toMatch(/145|147/);
  });

  it('propose un rpm_filter_min_hz sous la fondamentale la plus basse', () => {
    const f = buildSessionReport(racer, null).findings.find(
      (x) => x.id === 'filter-coverage-suspect',
    )!;
    const cli = f.fix?.cli?.join(' ') ?? '';
    const m = /rpm_filter_min_hz = (\d+)/.exec(cli);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThan(145); // sous la plus basse mesurée
    expect(cli).toContain('rpm_filter_fade_range_hz = 20');
  });

  it('signale que TPA n’a jamais agi sur ce vol', () => {
    // throttle max 1203 µs, tpa_breakpoint 1350 µs : les gains sont restés pleins.
    expect(ids(racer)).toContain('tpa-never-reached');
    expect(analyzeTimeline(racer).throttleMaxUs).toBeLessThan(1350);
  });

  it('se tait quand les mêmes réglages existent SANS symptôme', () => {
    // Le Chimera a ses 4 fondamentales (130-142 Hz) sous le plafond de fade,
    // exactement comme le racer, et le Pico tourne sans notch dynamique. Sans
    // oscillation ni bruit mesuré, aucun verdict : c'est toute la différence
    // entre lire une config et la confronter au vol.
    for (const fd of [chimera, pico]) {
      expect(ids(fd)).not.toContain('filter-coverage-suspect');
    }
  });

  it('parle sur le LR4, qui a lui un vrai symptôme de bruit', () => {
    // Bruit filtré Pitch 3.7 deg/s (seuil 3) et atténuation 120-350 Hz à 6 dB
    // au lieu de 15 : le symptôme est là, la couverture l'explique.
    const got = ids(lr4);
    expect(got).toContain('noise-filtered-leak');
    expect(got).toContain('filter-coverage-suspect');
  });

  it('TPA : aucun verdict sur le parc, où le pilote pousse les gaz', () => {
    for (const fd of [chimera, lr4, pico]) {
      expect(ids(fd)).not.toContain('tpa-never-reached');
    }
  });
});

// ---------------------------------------------------------------------------
// Le rapport complet du racer : ce que le pilote aurait dû lire
// ---------------------------------------------------------------------------

describe('rapport complet du racer partagé', () => {
  it('le verdict le plus grave est l’oscillation, pas la batterie', () => {
    const findings = buildSessionReport(racer, null).findings;
    expect(findings[0].id).toBe('oscillation-event');
    expect(findings[0].severity).toBe('crit');
    // Plus aucun critique batterie : c'étaient les deux faux positifs.
    expect(findings.filter((f) => f.severity === 'crit' && f.category === 'batterie')).toHaveLength(
      0,
    );
  });
});

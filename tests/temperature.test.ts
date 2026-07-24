// Températures : extraction (frames lentes INAV, absence Betaflight sans
// debug ESC_SENSOR_TMP), analyse (décimation, NaN) et géométrie du graphe.
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

import { analyzeTemperature } from '../src/lib/analysis/basic';
import { initWasm, parseFile } from '../src/lib/bbl/parse';
import {
  buildTemperaturePaths,
  layoutTemperatureLegend,
  probeColor,
  probeLabel,
} from '../src/components/charts/TemperatureChart';
import type { FlightData, TempProbeCurve } from '../src/lib/types';

const AKIRA_FLYAWAY = '/home/rviau/projects/drones/akira/02 - Acro flyaway.TXT';
const CHIMERA_BF = '/home/rviau/projects/drones/chimera/blackbox/btfl_016.bbl';

let akira: FlightData;
let chimera: FlightData;

beforeAll(async () => {
  await initWasm(await readFile(new URL('../public/blackbox-log.wasm', import.meta.url)));
  akira = (await parseFile('02.TXT', new Uint8Array(await readFile(AKIRA_FLYAWAY)))).sessions[0];
  chimera = (await parseFile('016.bbl', new Uint8Array(await readFile(CHIMERA_BF)))).sessions[0];
});

describe('extraction des températures', () => {
  it('INAV : esc/imu/baro vivantes, les sens0-7 sans capteur sont écartées', () => {
    expect(akira.temps).not.toBeNull();
    const ids = akira.temps!.probes.map((p) => p.id);
    expect(ids).toEqual(['esc', 'imu', 'baro']); // sentinelle -125 °C filtrée
    expect(akira.temps!.time.length).toBeGreaterThan(100);
  });

  it('INAV : valeurs en °C plausibles (esc ~47-51 sur le log Akira)', () => {
    const esc = akira.temps!.probes.find((p) => p.id === 'esc')!;
    const vals = Array.from(esc.celsius).filter((v) => !Number.isNaN(v));
    expect(Math.min(...vals)).toBeGreaterThan(30);
    expect(Math.max(...vals)).toBeLessThan(60);
  });

  it('Betaflight sans debug ESC_SENSOR_TMP : pas de températures, analyse null', () => {
    expect(chimera.meta.firmwareFamily).not.toBe('inav');
    expect(chimera.temps).toBeNull();
    expect(analyzeTemperature(chimera)).toBeNull();
  });
});

describe('analyzeTemperature', () => {
  const mkFd = (probes: FlightData['temps']): FlightData =>
    ({ temps: probes }) as FlightData; // analyzeTemperature ne lit que fd.temps

  it('décime à 600 points max et calcule min/max/début/fin', () => {
    const n = 6000;
    const time = new Float64Array(n);
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      time[i] = i / 100;
      c[i] = 30 + (20 * i) / n; // rampe 30 → 50 °C
    }
    const m = analyzeTemperature(mkFd({ time, probes: [{ id: 'esc', celsius: c }] }))!;
    expect(m.probes).toHaveLength(1);
    const p = m.probes[0];
    expect(p.t.length).toBeLessThanOrEqual(600);
    expect(p.firstC).toBeCloseTo(30, 0);
    expect(p.lastC).toBeCloseTo(50, 0);
    expect(p.minC).toBeLessThanOrEqual(p.maxC);
  });

  it('ignore les NaN (frame lente sans le champ) sans casser la courbe', () => {
    const n = 1000;
    const time = new Float64Array(n);
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      time[i] = i / 100;
      c[i] = i % 3 === 0 ? NaN : 40;
    }
    const m = analyzeTemperature(mkFd({ time, probes: [{ id: 'sens2', celsius: c }] }))!;
    expect(m.probes[0].minC).toBeCloseTo(40, 5);
    expect(m.probes[0].maxC).toBeCloseTo(40, 5);
  });

  it('null sans données', () => {
    expect(analyzeTemperature(mkFd(null))).toBeNull();
    expect(analyzeTemperature(mkFd({ time: new Float64Array(0), probes: [] }))).toBeNull();
  });
});

describe('buildTemperaturePaths', () => {
  const curve = (id: TempProbeCurve['id'], values: number[], dt = 1): TempProbeCurve => {
    const t = Float32Array.from(values.map((_, i) => i * dt));
    const c = Float32Array.from(values);
    return {
      id,
      minC: Math.min(...values),
      maxC: Math.max(...values),
      firstC: values[0],
      lastC: values[values.length - 1],
      t,
      c,
    };
  };

  it('un chemin M... par sonde, borné au cadre', () => {
    const probes = [curve('esc', [40, 45, 50]), curve('imu', [35, 36, 37])];
    const { paths, ends, ticksX, ticksY } = buildTemperaturePaths(probes, 600, 200);
    expect(paths).toHaveLength(2);
    for (const d of paths) expect(d.startsWith('M')).toBe(true);
    for (const e of ends) {
      expect(e.x).toBeGreaterThanOrEqual(0);
      expect(e.x).toBeLessThanOrEqual(600);
      expect(e.y).toBeGreaterThanOrEqual(0);
      expect(e.y).toBeLessThanOrEqual(200);
    }
    expect(ticksX.length).toBeGreaterThan(0);
    expect(ticksY.length).toBeGreaterThan(0);
  });

  it("l'échelle Y couvre toutes les sondes : le cadre ne dépend pas du filtre", () => {
    const probes = [curve('esc', [40, 80]), curve('imu', [20, 25])];
    const { yMin, yMax } = buildTemperaturePaths(probes, 600, 200);
    expect(yMin).toBeLessThan(20);
    expect(yMax).toBeGreaterThan(80);
  });

  it('domaine plat : la marge évite la division par zéro', () => {
    const { paths, yMin, yMax } = buildTemperaturePaths([curve('baro', [25, 25, 25])], 600, 200);
    expect(yMax - yMin).toBeGreaterThan(0);
    expect(paths[0]).toContain('L');
  });

  it('aucune donnée → vide sans erreur', () => {
    const out = buildTemperaturePaths([], 600, 200);
    expect(out.paths).toHaveLength(0);
    expect(out.ticksX).toHaveLength(0);
  });
});

describe('layoutTemperatureLegend', () => {
  it('3 sondes INAV : une seule rangée, entrées calées au bord droit', () => {
    const { rows, items } = layoutTemperatureLegend(
      ['ESC (télémétrie) 49°', 'IMU 46°', 'Baro 50°'],
      418,
      588,
    );
    expect(rows).toBe(1);
    // Décalages négatifs depuis le bord droit ; la dernière entrée le touche.
    for (const it of items) expect(it.x).toBeLessThan(0);
    expect(Math.min(...items.map((i) => i.x))).toBeGreaterThanOrEqual(-418);
  });

  it('8 ESC Betaflight : passe à la ligne sans déborder du cadre', () => {
    const labels = Array.from({ length: 8 }, (_, i) => `ESC ${i + 1} 63°`);
    const { rows, items } = layoutTemperatureLegend(labels, 418, 588);
    expect(rows).toBeGreaterThan(1);
    for (const it of items) {
      const avail = it.row === 0 ? 418 : 588;
      expect(it.x).toBeGreaterThanOrEqual(-avail);
      expect(it.x).toBeLessThan(0);
    }
    // L'ordre des sondes est conservé rangée par rangée.
    const byRow = items.map((i) => i.row);
    expect([...byRow].sort((a, b) => a - b)).toEqual(byRow);
  });
});

describe('identité des sondes (couleur fixe, libellés)', () => {
  const L = {
    title: '',
    ariaLabel: '',
    xAxis: '',
    filterHint: '',
    probeEsc: 'ESC (télémétrie)',
    probeImu: 'IMU',
    probeBaro: 'Baro',
    probeSens: (n: string) => `Sonde ${n}`,
    probeEscN: (n: string) => `ESC ${n}`,
  };

  it('couleur stable par sonde, jamais recalculée selon la sélection', () => {
    expect(probeColor('esc')).toBe(probeColor('esc'));
    expect(probeColor('sens0')).not.toBe(probeColor('sens1'));
    // Betaflight esc0-7 partage les slots sens0-7 : jamais coaffichés (familles exclusives)
    expect(probeColor('esc3')).toBe(probeColor('sens3'));
  });

  it('libellés : sens0-7 en indice brut, esc0-7 numérotés 1-8 (côté pilote)', () => {
    expect(probeLabel('esc', L)).toBe('ESC (télémétrie)');
    expect(probeLabel('sens4', L)).toBe('Sonde 4');
    expect(probeLabel('esc0', L)).toBe('ESC 1');
    expect(probeLabel('esc7', L)).toBe('ESC 8');
  });
});

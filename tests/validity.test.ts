// Validité des mesures et règles de config croisées avec les données.
// Principe commun aux deux : on ne publie pas un verdict tiré d'une mesure
// impossible, et une règle de config ne vaut que confrontée au vol réel.
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

import { analyzePower, analyzeTimeline } from '../src/lib/analysis/basic';
import { initWasm, parseFile } from '../src/lib/bbl/parse';
import {
  configFromHeaders,
  parseNum,
  suggestAntiGravity,
  suggestRpmFade,
  suggestSliderBump,
} from '../src/lib/cli/config';
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

const ids = (fd: FlightData): string[] => buildSessionReport(fd).findings.map((f) => f.id);

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
    const f = buildSessionReport(racer).findings.find(
      (x) => x.id === 'filter-coverage-suspect',
    )!;
    expect(f.evidence).toContain('dyn_notch_count = 1');
    expect(f.evidence).toMatch(/145|147/);
  });

  it('propose un couple min_hz/fade_range dont le PLAFOND dégage les fondamentales', () => {
    // Le piège que ce test existe pour attraper : Betaflight place le plafond
    // de fade à min_hz + fade_range. Proposer min_hz = 130 avec fade = 20
    // redonne le plafond 150 Hz d'origine (100 + 50) et ne corrige donc rien,
    // alors qu'un test sur min_hz seul passerait au vert.
    const r = buildSessionReport(racer);
    const f = r.findings.find((x) => x.id === 'filter-coverage-suspect')!;
    const cli = f.fix?.cli?.join(' ') ?? '';
    const minHz = Number(/rpm_filter_min_hz = (\d+)/.exec(cli)?.[1]);
    const fadeHz = Number(/rpm_filter_fade_range_hz = (\d+)/.exec(cli)?.[1]);
    expect(Number.isFinite(minHz) && Number.isFinite(fadeHz)).toBe(true);

    const fundamentals = (r.analysis.spectrum?.perMotorHz ?? [])
      .map((m) => m.median)
      .filter((h) => h > 0);
    expect(fundamentals.length).toBe(4);
    // La propriété qui compte, exprimée telle quelle.
    expect(minHz + fadeHz).toBeLessThan(Math.min(...fundamentals));
  });

  it('ne propose rien plutôt qu’un min_hz qui morde dans la bande de pilotage', () => {
    expect(suggestRpmFade(145)).toEqual({ minHz: 110, fadeHz: 20 });
    expect(suggestRpmFade(200)!.minHz + suggestRpmFade(200)!.fadeHz).toBeLessThan(200);
    // 85 - 10 - 20 = 55, sous le plancher de 60 Hz : se taire est la bonne réponse.
    expect(suggestRpmFade(85)).toBeNull();
    expect(suggestRpmFade(0)).toBeNull();
    expect(suggestRpmFade(Number.NaN)).toBeNull();
  });

  it('aucune commande proposée n’en contredit une autre', () => {
    // collectCliLines dédoublonne les lignes IDENTIQUES, mais deux règles qui
    // fixeraient la même clé à deux valeurs différentes passeraient toutes les
    // deux : Betaflight garderait la dernière, silencieusement.
    for (const fd of [racer, chimera, lr4, pico]) {
      const seen = new Map<string, string>();
      for (const f of buildSessionReport(fd).findings) {
        for (const line of f.fix?.cli ?? []) {
          const m = /^set\s+([a-z0-9_]+)\s*=\s*(.+)$/i.exec(line.trim());
          if (!m) continue;
          const [, key, val] = m;
          const prev = seen.get(key);
          expect(prev === undefined || prev === val, `${key}: "${prev}" vs "${val}"`).toBe(true);
          seen.set(key, val);
        }
      }
    }
  });

  it('passe par les sliders et jamais par p_roll/d_roll quand ils sont actifs', () => {
    // Les 4 drones du parc ont simplified_pids_mode = 2 : écrire un gain en
    // direct donnerait l'illusion d'un réglage appliqué, jusqu'à ce que les
    // sliders le recalculent. Le piège vaut d'être verrouillé.
    const direct = /^set\s+[pidf]_(roll|pitch|yaw)\b/i;
    for (const fd of [racer, chimera, lr4, pico]) {
      const cfg = configFromHeaders(fd.meta.headers);
      expect(parseNum(cfg.values['simplified_pids_mode'])).not.toBe(0);
      for (const f of buildSessionReport(fd).findings) {
        for (const line of f.fix?.cli ?? []) {
          expect(direct.test(line), `${f.id}: ${line}`).toBe(false);
        }
      }
    }
  });

  it('ne propose un ajustement de slider que s’il est réellement mesurable', () => {
    const cfg = (values: Record<string, string>) => ({ values, features: [], source: 'paste' as const, raw: '' });
    // Sliders désactivés : ce sont les gains directs qui font foi, pas eux.
    expect(suggestSliderBump(cfg({ simplified_pids_mode: '0', simplified_d_gain: '100' }), 'simplified_d_gain', 10)).toBeNull();
    // Firmware sans sliders du tout (log 7 pouces du corpus public).
    expect(suggestSliderBump(cfg({ simplified_d_gain: '100' }), 'simplified_d_gain', 10)).toBeNull();
    // Valeur absente du log : rien à quoi ajouter un delta.
    expect(suggestSliderBump(cfg({ simplified_pids_mode: '2' }), 'simplified_d_gain', 10)).toBeNull();
    expect(suggestSliderBump(cfg({ simplified_pids_mode: '2', simplified_d_gain: '100' }), 'simplified_d_gain', 10)).toBe('set simplified_d_gain = 110');
    // Déjà au plafond : le clamp annule l'ajustement, on se tait.
    expect(suggestSliderBump(cfg({ simplified_pids_mode: '2', simplified_d_gain: '200' }), 'simplified_d_gain', 10)).toBeNull();

    // anti_gravity_gain : l'échelle a changé en 4.2 (1000-30000 avant). Le log
    // 7 pouces du corpus est resté dessus avec 10000 - un pas de -20 n'y aurait
    // aucun sens, mieux vaut ne rien proposer.
    expect(suggestAntiGravity(cfg({ anti_gravity_gain: '10000' }), -20)).toBeNull();
    expect(suggestAntiGravity(cfg({ anti_gravity_gain: '80' }), -20)).toBe('set anti_gravity_gain = 60');
  });

  it('ne conseille pas de monter les gains quand le gyro est bruité', () => {
    // Le Pico déclenche tracking-poor ET noise-mech-high : la prose y dit
    // explicitement de régler le bruit AVANT de toucher aux PID. Fournir la
    // commande quand même contredirait le texte du même verdict.
    const findings = buildSessionReport(pico).findings;
    const tracking = findings.find((f) => f.id === 'tracking-poor');
    expect(tracking).toBeDefined();
    expect(findings.some((f) => f.id === 'noise-mech-high')).toBe(true);
    expect(tracking!.fix?.cli).toBeUndefined();
  });

  it('n’attache jamais une commande à un axe qu’elle ne règle pas', () => {
    // Le Pico titre « dépassement sur Yaw » (118 %) alors que le roll dépasse
    // aussi (110 %). Le slider D ne touche que roll et pitch : proposer
    // simplified_d_gain sous un verdict Yaw serait incohérent, et d_yaw vaut 0
    // sur tout le parc. L'evidence montre déjà les trois axes.
    const f = buildSessionReport(pico).findings.find((x) => x.id === 'step-overshoot')!;
    expect(f.title).toContain('Yaw');
    expect(f.fix?.cli).toBeUndefined();
    // Le Chimera dépasse sur roll/pitch : là, la commande a un sens.
    const c = buildSessionReport(chimera).findings.find((x) => x.id === 'step-overshoot')!;
    expect(c.title).not.toContain('Yaw');
    expect(c.fix?.cli?.join(' ')).toMatch(/simplified_(pitch_)?d_gain/);
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
    const findings = buildSessionReport(racer).findings;
    expect(findings[0].id).toBe('oscillation-event');
    expect(findings[0].severity).toBe('crit');
    // Plus aucun critique batterie : c'étaient les deux faux positifs.
    expect(findings.filter((f) => f.severity === 'crit' && f.category === 'batterie')).toHaveLength(
      0,
    );
  });
});

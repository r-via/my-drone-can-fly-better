import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

import { initWasm, parseFile, spoofFirmware, unsupportedFirmware } from '../src/lib/bbl/parse';
import { configFromHeaders } from '../src/lib/cli/config';
import { getDict } from '../src/lib/i18n';
import { buildSessionReport, composeFindings } from '../src/lib/report';
import { evaluateSession } from '../src/lib/rules/engine';
import type { FlightData } from '../src/lib/types';

// Log INAV 9.0.1 réel (TMOTORF7V2, craft AKIRA) : 3 sessions, la première est
// un blip de 1,6 s. Références chiffrées validées contre orangebox 0.5.0
// (valeurs identiques à ±1 LSB, voir commentaire de spoofFirmware).
const INAV_LOG = '/home/rviau/projects/drones/chimera/blackbox/01 - Hover and wobble.TXT';

const fr = getDict('fr');
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

beforeAll(async () => {
  await initWasm(await readFile(new URL('../public/blackbox-log.wasm', import.meta.url)));
});

// ---------------------------------------------------------------------------
// Spoof et contrôle de version - unités synthétiques
// ---------------------------------------------------------------------------

describe('spoof de version INAV', () => {
  it('réécrit INAV 9.0.1 en 6.0.0 à longueur constante et restitue l original', () => {
    const buf = enc('H Firmware revision:INAV 9.0.1 (d44f2cf6) TMOTORF7V2\n');
    const { data, original } = spoofFirmware(buf);
    expect(original).toBe('INAV 9.0.1');
    expect(data.length).toBe(buf.length);
    expect(dec(data)).toContain('INAV 6.0.0 (d44f2cf6)');
  });

  it('laisse intactes les versions INAV dans la fenêtre native 5.0-6.1', () => {
    for (const ver of ['5.0.0', '6.0.3', '6.1.1']) {
      const buf = enc(`H Firmware revision:INAV ${ver} (abc) BOARD\n`);
      const { data, original } = spoofFirmware(buf);
      expect(original).toBe(`INAV ${ver}`);
      expect(dec(data)).toContain(`INAV ${ver} `);
    }
  });

  it('ne touche pas un INAV trop ancien : le rejet « trop ancien » doit rester visible', () => {
    const buf = enc('H Firmware revision:INAV 4.1.0 (abc) BOARD\n');
    expect(dec(spoofFirmware(buf).data)).toContain('INAV 4.1.0');
  });

  it('spoofe toujours Betaflight comme avant', () => {
    const buf = enc('H Firmware revision:Betaflight 2025.12.4 (79065c96b) STM32F7X2\n');
    const { data, original } = spoofFirmware(buf);
    expect(original).toBe('Betaflight 2025.12.4');
    expect(data.length).toBe(buf.length);
    expect(dec(data)).toContain('Betaflight 4.4.2');
  });
});

describe('contrôle de firmware supporté', () => {
  const chunk = (rev: string) => enc(`H Product:Blackbox flight data recorder\nH Firmware revision:${rev}\n`);

  it('accepte INAV dans la fenêtre et refuse un INAV trop ancien', () => {
    expect(unsupportedFirmware(chunk('INAV 6.0.0 (d44f2cf6) TMOTORF7V2'), fr)).toBeNull();
    expect(unsupportedFirmware(chunk('INAV 4.1.0 (abc) BOARD'), fr)).toBe(
      fr.system.firmwareTooOld('INAV 4.1.0', '5.0'),
    );
  });

  it('refuse toujours les forks non validés', () => {
    expect(unsupportedFirmware(chunk('EmuFlight 0.4.2 (abc) BOARD'), fr)).toBe(
      fr.system.firmwareNotSupported('EmuFlight'),
    );
  });

  it('garde le plancher Betaflight 4.2', () => {
    expect(unsupportedFirmware(chunk('Betaflight 4.1.0 (abc) BOARD'), fr)).toBe(
      fr.system.firmwareTooOld('Betaflight 4.1.0', '4.2'),
    );
  });
});

describe('snapshot config et dialecte INAV', () => {
  it('voit la FF (4e composante des PID) et les clés camelCase dans le diff de tune', () => {
    const cfg = configFromHeaders({
      rollPID: '46,80,32,70',
      dynamicGyroNotchQ: '250',
      motorOutput: '1100,2000',
      currentMeter: '0,250',
    });
    expect(cfg.values['ff_roll']).toBe('70'); // sans elle, un changement de FF sort comme « aucun réglage changé »
    expect(cfg.values['dynamicGyroNotchQ']).toBe('250');
    expect(cfg.values['motorOutput']).toBeUndefined(); // structurel, pas un réglage
    expect(cfg.values['currentMeter']).toBeUndefined(); // calibration capteur
  });

  it('ne fabrique pas de ff_* sur un rollPID Betaflight à 3 composantes', () => {
    const cfg = configFromHeaders({ rollPID: '45,80,40' });
    expect(cfg.values['p_roll']).toBe('45');
    expect(cfg.values['ff_roll']).toBeUndefined();
  });
});

describe('cas limites des fichiers .txt et multi-firmwares', () => {
  it('refuse proprement un .txt qui n est pas un blackbox', async () => {
    const pf = await parseFile('notes.txt', enc('juste du texte, pas un log\n'), fr);
    expect(pf.sessions).toHaveLength(0);
    expect(pf.skipped).toHaveLength(1);
    expect(pf.skipped[0].error).toBe(fr.system.noBlackboxHeader);
  });

  it('retombe sur la plage 1000-2000 quand un log INAV n a pas de header motorOutput', async () => {
    const buf = new Uint8Array(await readFile(INAV_LOG));
    const line = enc('H motorOutput:1100,2000\n');
    const out: number[] = [];
    outer: for (let i = 0; i < buf.length; i++) {
      for (let j = 0; j < line.length; j++) {
        if (buf[i + j] !== line[j]) {
          out.push(buf[i]);
          continue outer;
        }
      }
      i += line.length - 1; // ligne header entière retirée, les frames suivent intactes
    }
    const pf = await parseFile('sans-motorOutput.TXT', Uint8Array.from(out), fr);
    expect(pf.sessions.length).toBeGreaterThan(0);
    expect(pf.sessions[0].meta.motorOutputLow).toBe(1000);
    expect(pf.sessions[0].meta.motorOutputHigh).toBe(2000);
  });

  it('étiquette chaque session avec SON firmware dans un fichier concaténé INAV+Betaflight', async () => {
    const inav = new Uint8Array(await readFile(INAV_LOG));
    const bf = new Uint8Array(await readFile('/home/rviau/projects/drones/chimera/blackbox/btfl_016.bbl'));
    const mixed = new Uint8Array(inav.length + bf.length);
    mixed.set(inav, 0);
    mixed.set(bf, inav.length);
    const pf = await parseFile('mixte.TXT', mixed, fr);
    const inavSessions = pf.sessions.filter((s) => s.meta.firmwareFamily === 'inav');
    const bfSessions = pf.sessions.filter((s) => s.meta.firmwareFamily === 'betaflight');
    expect(inavSessions.length).toBe(2);
    expect(bfSessions.length).toBe(1);
    for (const s of inavSessions) expect(s.meta.firmware).toBe('INAV 9.0.1');
    for (const s of bfSessions) expect(s.meta.firmware).toContain('Betaflight 2025.12.2');
    // Chaque famille garde SA source RPM, même dans un fichier mélangé
    for (const s of inavSessions) {
      expect(s.erpm).toBeNull();
      expect(s.escRpm).not.toBeNull();
    }
    for (const s of bfSessions) {
      expect(s.erpm).not.toBeNull();
      expect(s.escRpm).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Log INAV réel : mapping des champs et rapport complet
// ---------------------------------------------------------------------------

describe('log INAV réel', () => {
  let sessions: FlightData[];
  let skippedErrors: string[];

  beforeAll(async () => {
    const pf = await parseFile('01 - Hover and wobble.TXT', new Uint8Array(await readFile(INAV_LOG)), fr);
    sessions = pf.sessions;
    skippedErrors = pf.skipped.map((s) => s.error);
  });

  it('décode 2 vols et écarte le blip de 1,6 s', () => {
    expect(sessions).toHaveLength(2);
    expect(skippedErrors).toEqual([fr.system.flightTooShort('1.6', '10')]);
  });

  it('mappe le dialecte INAV vers le contrat FlightData', () => {
    const s = sessions[0];
    expect(s.meta.firmware).toBe('INAV 9.0.1');
    expect(s.meta.firmwareFamily).toBe('inav');
    expect(s.meta.craftName).toBe('AKIRA');
    // Header INAV motorOutput:1100,2000 - pas le défaut DSHOT 48/2047
    expect(s.meta.motorOutputLow).toBe(1100);
    expect(s.meta.motorOutputHigh).toBe(2000);
    // P interval 1/2 sur looptime 500 µs : frames à ~950 Hz
    expect(s.meta.sampleRateHz).toBeGreaterThan(900);
    expect(s.meta.sampleRateHz).toBeLessThan(1000);
    expect(s.meta.frameCount).toBe(59940); // validé contre orangebox (59939 + 1re frame corrompue par orangebox)
    // vbat (centivolt INAV) converti en volts : pack 6S plein
    const vmax = Math.max(...Array.from(s.vbat!));
    expect(vmax).toBeCloseTo(25.07, 1);
    // gyroRaw -> gyroUnfilt, axisRate -> setpoint, BaroAlt -> baroAlt (m)
    expect(s.gyroUnfilt).not.toBeNull();
    expect(s.baroAlt).not.toBeNull();
    expect(s.erpm).toBeNull(); // pas d eRPM par moteur dans les frames main INAV
    // La source RPM d INAV est escRpm (frames S) : moyenne mécanique des 8
    // ESCs en tr/min, série dense car INAV réécrit la frame S dès qu elle
    // change - donc quasi à chaque intervalle (~130 Hz sur ce log).
    const esc = s.escRpm!;
    expect(esc).not.toBeNull();
    expect(esc.rpm.length).toBeGreaterThan(5000);
    expect(esc.time[0]).toBeGreaterThanOrEqual(0);
    expect(esc.time[esc.rpm.length - 1]).toBeLessThanOrEqual(s.meta.durationS);
    // Hover 9" X8 : régime max plausible, jamais négatif
    let escMax = 0;
    for (const v of esc.rpm) escMax = Math.max(escMax, v);
    expect(escMax).toBeGreaterThan(6000);
    expect(escMax).toBeLessThan(12000);
    // X8 : les 8 canaux moteurs sont lus (validés réels contre orangebox :
    // plages 1133-1422 dans motorOutput 1100-2000, dynamique corrélée)
    expect(s.motor).toHaveLength(8);
    // Session « wobble » : la consigne dépasse 100 deg/s en crête
    const s2 = sessions[1];
    let peak = 0;
    for (const v of s2.setpoint[0]) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(100);
  });

  it('produit un rapport au profil akira avec le constat INAV et sans lignes CLI Betaflight', () => {
    const sr = buildSessionReport(sessions[0], fr);
    expect(sr.profile.id).toBe('akira'); // craft AKIRA = RRFPV RR Akira 9" X8 6S
    expect(sr.analysis.power?.cells).toBe(6);

    const notice = sr.findings.find((f) => f.id === 'inav-limited');
    expect(notice).toBeDefined();
    expect(notice!.severity).toBe('info');
    expect(notice!.scoreExempt).toBe(true);
    expect(notice!.evidence).toContain('INAV 9.0.1');

    for (const f of sr.findings) {
      expect(f.fix?.cli, `finding ${f.id} ne doit pas porter de CLI Betaflight`).toBeUndefined();
    }
    expect(sr.findings.some((f) => f.category === 'config')).toBe(false);

    // Le constat suit la locale (rejoué à l identique par le codec de partage)
    const en = composeFindings(sr.analysis, sr.profile, { values: {} }, getDict('en'));
    const noticeEn = en.find((f) => f.id === 'inav-limited');
    expect(noticeEn!.title).not.toBe(notice!.title);
  });

  it('analyse les 8 moteurs du X8', () => {
    const sr = buildSessionReport(sessions[0], fr);
    const m = sr.analysis.motors;
    expect(m.perMotorAvgPct).toHaveLength(8);
    expect(m.desyncZeros).toHaveLength(8);
    // Hover 6S : moyennes toutes dans une bande plausible et équilibrées
    // (validé contre orangebox : moyennes brutes 1333-1383 sur 1100-2000)
    for (const pct of m.perMotorAvgPct) {
      expect(pct).toBeGreaterThan(20);
      expect(pct).toBeLessThan(35);
    }
    expect(m.imbalancePctPts).toBeLessThan(12); // pas de faux positif imbalance sur ce vol sain
    expect(sr.findings.some((f) => f.id === 'motors-imbalance')).toBe(false);
  });

  it('tire la fondamentale moteur du spectre depuis escRpm, sans données per-moteur inventées', () => {
    const sr = buildSessionReport(sessions[0], fr);
    const sp = sr.analysis.spectrum!;
    expect(sp).not.toBeNull();
    // Médiane escRpm / 60 : validée physiquement, les pics gyro dominants de
    // ce vol se groupent à 120-130 Hz sur les trois axes.
    expect(sp.motorFundamentalHz).toBeCloseTo(126.25, 1);
    // Une seule valeur agrégée : pas de per-moteur ni d attribution de pic
    // (réservés à l eRPM par moteur Betaflight).
    expect(sp.perMotorHz).toBeNull();
    expect(sp.dominantPeak).toBeNull();
  });

  it('ne réclame jamais le DShot bidirectionnel sur INAV : rpm-not-logged version télémétrie ESC', () => {
    const sr = buildSessionReport(sessions[0], fr);
    // escRpm alimenté : le régime moteur est loggé sous sa forme INAV,
    // aucun constat « RPM absent » ne doit sortir.
    expect(sr.analysis.motors.escRpmAvailable).toBe(true);
    expect(sr.findings.some((f) => f.id === 'rpm-not-logged')).toBe(false);

    // Même vol, télémétrie ESC muette : la variante INAV sort, sans le
    // vocabulaire Betaflight (dshot_bidir, blackbox_disable_rpm) ni CLI.
    const doctored = {
      ...sr.analysis,
      motors: { ...sr.analysis.motors, escRpmAvailable: false },
    };
    const f = evaluateSession(doctored, sr.profile, fr).find((x) => x.id === 'rpm-not-logged');
    expect(f).toBeDefined();
    expect(f!.detail).toContain('escRPM');
    expect(f!.detail).not.toMatch(/dshot/i);
    expect(f!.evidence).not.toContain('dshot_bidir');
    expect(f!.fix?.cli).toBeUndefined();
    expect(f!.fix?.text).toContain('télémétrie');
  });

  it('nomme les moteurs au-delà de M4 dans le verdict de déséquilibre', () => {
    const sr = buildSessionReport(sessions[0], fr);
    // Même vol, moyennes trafiquées : M8 nettement au-dessus, M2 en dessous.
    const doctored = {
      ...sr.analysis,
      motors: {
        ...sr.analysis.motors,
        perMotorAvgPct: [30, 28, 30, 31, 30, 31, 30, 45],
        imbalancePctPts: 17,
      },
    };
    const f = evaluateSession(doctored, sr.profile, fr).find((x) => x.id === 'motors-imbalance');
    expect(f).toBeDefined();
    expect(f!.detail).toContain('M8'); // le moteur qui force
    expect(f!.evidence).toContain('M5'); // la liste couvre bien les 8
    expect(f!.evidence).toContain('M8 45');
  });
});

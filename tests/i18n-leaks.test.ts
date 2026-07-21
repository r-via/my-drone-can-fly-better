// Fuites de langue : un rapport ne doit jamais mélanger la locale demandée
// avec des chaînes codées en dur ou des messages bruts du décodeur WASM.
// Ces quatre cas fuyaient tous vers le français quelle que soit --lang.
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

import { initWasm, parseFile, translateDecoderError } from '../src/lib/bbl/parse';
import { LOCALES, getDict } from '../src/lib/i18n';
import type { Locale } from '../src/lib/i18n';

/** Log dont 4 des 5 sessions sont des fragments corrompus : le cas qui fuyait. */
const PICO = '/home/rviau/projects/drones/pavo pico/btfl_002.bbl';

let bytes: Uint8Array;

beforeAll(async () => {
  await initWasm(await readFile(new URL('../public/blackbox-log.wasm', import.meta.url)));
  bytes = new Uint8Array(await readFile(PICO));
});

describe('translateDecoderError', () => {
  const messages = [
    'one or more headers required for parsing are missing',
    'unsupported or invalid data version',
  ];

  it('traduit les messages connus du décodeur dans les 5 langues', () => {
    for (const { code } of LOCALES) {
      const dict = getDict(code);
      for (const raw of messages) {
        const out = translateDecoderError(new Error(raw), dict);
        expect(out).not.toBe(raw); // plus de fuite brute
        expect(out.length).toBeGreaterThan(0);
      }
      expect(translateDecoderError(new Error(messages[0]), dict)).toBe(
        dict.system.headersUnreadable,
      );
      expect(translateDecoderError(new Error(messages[1]), dict)).toBe(
        dict.system.dataVersionUnsupported,
      );
    }
  });

  it('conserve le message brut pour une erreur inconnue, sans le masquer', () => {
    const out = translateDecoderError(new Error('quelque chose de totalement neuf'), getDict('en'));
    expect(out).toContain('quelque chose de totalement neuf');
  });

  it('accepte une valeur jetée qui n’est pas une Error', () => {
    expect(translateDecoderError('boom', getDict('en'))).toContain('boom');
  });
});

describe('parseFile respecte la locale', () => {
  it('produit des messages de session ignorée différents par langue', async () => {
    const seen = new Map<Locale, string>();
    for (const { code } of LOCALES) {
      const pf = await parseFile('btfl_002.bbl', bytes, getDict(code));
      expect(pf.skipped.length).toBeGreaterThan(0);
      seen.set(code, pf.skipped.map((s) => s.error).join(' | '));
    }
    // Les cinq rendus doivent être distincts deux à deux : si l'un d'eux
    // retombait sur le dictionnaire par défaut, il serait identique au français.
    const values = [...seen.values()];
    expect(new Set(values).size).toBe(values.length);
    expect(seen.get('fr')).toContain('Headers illisibles');
    expect(seen.get('en')).toContain('Unreadable headers');
  });

  it('aucun message brut du décodeur ne survit', async () => {
    for (const { code } of LOCALES) {
      const pf = await parseFile('btfl_002.bbl', bytes, getDict(code));
      for (const s of pf.skipped) {
        expect(s.error).not.toMatch(/headers required for parsing/i);
        expect(s.error).not.toMatch(/unsupported or invalid data version/i);
      }
    }
  });
});

describe('libellés du rapport terminal', () => {
  it('les clés CLI existent et diffèrent entre langues', () => {
    const fr = getDict('fr').system;
    const en = getDict('en').system;
    expect(fr.cliSessionSkipped('2', '14')).not.toBe(en.cliSessionSkipped('2', '14'));
    expect(fr.cliProfile('X')).not.toBe(en.cliProfile('X'));
    expect(fr.cliCurrentMax('10')).not.toBe(en.cliCurrentMax('10'));
    expect(en.cliSessionSkipped('2', '14')).toContain('skipped');
  });

  it('chaque catégorie de finding a un libellé dans les 5 langues', () => {
    const categories = [
      'vibrations',
      'filtres',
      'pid',
      'moteurs',
      'batterie',
      'config',
      'gps',
      'securite',
      'log',
    ] as const;
    for (const { code } of LOCALES) {
      const labels = getDict(code).ui.categories;
      for (const c of categories) {
        expect(labels[c], `${code}/${c}`).toBeTruthy();
      }
    }
    // La clé d'enum est française : en anglais le libellé doit s'en écarter.
    expect(getDict('en').ui.categories.filtres).not.toBe('filtres');
    expect(getDict('en').ui.categories.moteurs).not.toBe('moteurs');
  });
});

describe('phrase déterministe sous la frise', () => {
  it('existe dans les 5 langues et cite toutes les grandeurs mesurées', () => {
    for (const { code } of LOCALES) {
      const r = getDict(code).ui.report;
      expect(r.timelineEventIntro.length).toBeGreaterThan(0);
      const line = r.timelineEventLine('13.7', '0.80', '36', '43', '71', 'M1, M2');
      // Aucun chiffre mesuré ne doit être perdu par une traduction.
      for (const v of ['13.7', '0.80', '36', '43', '71', 'M1, M2']) {
        expect(line, `${code} / ${v}`).toContain(v);
      }
    }
  });

  it('reste correct quand aucun moteur n’a touché de butée', () => {
    const line = getDict('fr').ui.report.timelineEventLine('5.0', '0.30', '52', '9', '0', null);
    expect(line).not.toContain('null');
    expect(line.trim().endsWith('.')).toBe(true);
  });

  it('est bien traduite et pas recopiée du français', () => {
    const fr = getDict('fr').ui.report;
    const en = getDict('en').ui.report;
    expect(en.timelineEventIntro).not.toBe(fr.timelineEventIntro);
    expect(en.timelineEventLine('1', '1', '1', '1', '1', null)).not.toBe(
      fr.timelineEventLine('1', '1', '1', '1', '1', null),
    );
  });
});

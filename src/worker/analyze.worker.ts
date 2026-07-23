// Web Worker : parsing + analyse hors du thread UI.
import { initWasm, parseFile } from '../lib/bbl/parse';
import { getDict } from '../lib/i18n';
import { buildReport } from '../lib/report';

import type { Dict, Locale } from '../lib/i18n';
import type { ParsedFile, Report } from '../lib/types';

export type WorkerRequest = {
  files: Array<{ name: string; bytes: ArrayBuffer }>;
  locale: Locale;
};

export type WorkerResponse =
  | { type: 'progress'; step: string }
  | { type: 'done'; report: Report }
  | { type: 'error'; error: string };

const post = (msg: WorkerResponse) => (self as unknown as Worker).postMessage(msg);

let wasmReady: Promise<void> | null = null;

function ensureWasm(dict: Dict): Promise<void> {
  wasmReady ??= (async () => {
    // Résolu depuis l'URL du chunk worker ({base}/_next/static/chunks/xxx.js)
    // et non depuis la racine : un chemin absolu casserait le site dès qu'il
    // est servi sous un sous-chemin (GitHub Pages project site, basePath).
    const wasmUrl = new URL('../../../blackbox-log.wasm', self.location.href);
    const res = await fetch(wasmUrl);
    if (!res.ok) throw new Error(dict.system.wasmLoadFailed(String(res.status)));
    await initWasm(await res.arrayBuffer());
  })().catch((e: unknown) => {
    // Ne pas mettre l'échec en cache : un fetch transitoirement raté doit
    // pouvoir être retenté au prochain message.
    wasmReady = null;
    throw e;
  });
  return wasmReady;
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const dict = getDict(ev.data.locale);
  try {
    post({ type: 'progress', step: dict.system.progressLoadingDecoder });
    await ensureWasm(dict);

    const parsed: ParsedFile[] = [];
    for (const f of ev.data.files) {
      post({ type: 'progress', step: dict.system.progressDecoding(f.name) });
      parsed.push(await parseFile(f.name, new Uint8Array(f.bytes), dict));
    }

    post({ type: 'progress', step: dict.system.progressAnalyzing });
    const report = buildReport(parsed, dict);
    post({ type: 'done', report });
  } catch (e) {
    post({ type: 'error', error: e instanceof Error ? e.message : String(e) });
  }
};

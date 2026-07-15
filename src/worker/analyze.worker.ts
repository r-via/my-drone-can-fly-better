// Web Worker : parsing + analyse hors du thread UI.
import { initWasm, parseFile } from '../lib/bbl/parse';
import { buildReport } from '../lib/report';

import type { ParsedFile, Report } from '../lib/types';

export type WorkerRequest = {
  files: Array<{ name: string; bytes: ArrayBuffer }>;
  cliText: string;
};

export type WorkerResponse =
  | { type: 'progress'; step: string }
  | { type: 'done'; report: Report }
  | { type: 'error'; error: string };

const post = (msg: WorkerResponse) => (self as unknown as Worker).postMessage(msg);

let wasmReady: Promise<void> | null = null;

function ensureWasm(): Promise<void> {
  wasmReady ??= (async () => {
    const res = await fetch('/blackbox-log.wasm');
    if (!res.ok) throw new Error(`Chargement du décodeur WASM impossible (HTTP ${res.status})`);
    await initWasm(await res.arrayBuffer());
  })();
  return wasmReady;
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  try {
    post({ type: 'progress', step: 'Chargement du décodeur…' });
    await ensureWasm();

    const parsed: ParsedFile[] = [];
    for (const f of ev.data.files) {
      post({ type: 'progress', step: `Décodage de ${f.name}…` });
      parsed.push(await parseFile(f.name, new Uint8Array(f.bytes)));
    }

    post({ type: 'progress', step: 'Analyse (FFT, step response, règles)…' });
    const report = buildReport(parsed, ev.data.cliText);
    post({ type: 'done', report });
  } catch (e) {
    post({ type: 'error', error: e instanceof Error ? e.message : String(e) });
  }
};

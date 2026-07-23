'use client';

// Pont UI ↔ Web Worker : le parsing (WASM) et l'analyse (FFT, déconvolution,
// règles) tournent hors du thread principal.

import { useCallback, useEffect, useRef, useState } from 'react';

import { getDict } from './i18n';

import type { WorkerRequest, WorkerResponse } from '../worker/analyze.worker';
import type { Locale } from './i18n';
import type { Report } from './types';

export type AnalyzerState = {
  status: 'idle' | 'working' | 'ready' | 'error';
  step?: string;
  report: Report | null;
  error?: string;
};

export function useAnalyzer(): AnalyzerState & {
  analyze(files: Array<{ name: string; bytes: Uint8Array }>, locale: Locale): void;
  reset(): void;
} {
  const [state, setState] = useState<AnalyzerState>({ status: 'idle', report: null });
  const workerRef = useRef<Worker | null>(null);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  const analyze = useCallback((files: Array<{ name: string; bytes: Uint8Array }>, locale: Locale) => {
    // Worker frais par analyse : état WASM propre, et un run précédent
    // éventuellement bloqué est tué au lieu de faire la queue.
    workerRef.current?.terminate();
    const worker = new Worker(new URL('../worker/analyze.worker.ts', import.meta.url));
    workerRef.current = worker;

    setState({ status: 'working', step: getDict(locale).system.progressPreparing, report: null });

    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      // Un message déjà en file au moment du terminate() peut encore arriver :
      // il ne doit pas écraser l'état de l'analyse qui l'a remplacé.
      if (workerRef.current !== worker) return;
      const msg = ev.data;
      if (msg.type === 'progress') {
        setState({ status: 'working', step: msg.step, report: null });
      } else if (msg.type === 'done') {
        setState({ status: 'ready', report: msg.report });
        worker.terminate();
        workerRef.current = null;
      } else {
        setState({ status: 'error', report: null, error: msg.error });
        worker.terminate();
        workerRef.current = null;
      }
    };
    worker.onerror = (ev) => {
      if (workerRef.current !== worker) return;
      setState({ status: 'error', report: null, error: ev.message || getDict(locale).system.workerUnexpectedError });
      worker.terminate();
      workerRef.current = null;
    };

    const payload: WorkerRequest = {
      files: files.map((f) => {
        // Copie dans un ArrayBuffer autonome : bytes peut être une vue sur un
        // buffer partagé, et on transfère la propriété au worker.
        const ab = new ArrayBuffer(f.bytes.byteLength);
        new Uint8Array(ab).set(f.bytes);
        return { name: f.name, bytes: ab };
      }),
      locale,
    };
    worker.postMessage(
      payload,
      payload.files.map((f) => f.bytes),
    );
  }, []);

  const reset = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setState({ status: 'idle', report: null });
  }, []);

  return { ...state, analyze, reset };
}

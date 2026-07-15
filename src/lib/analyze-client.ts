'use client';

// Pont UI ↔ Web Worker : le parsing (WASM) et l'analyse (FFT, déconvolution,
// règles) tournent hors du thread principal.

import { useCallback, useEffect, useRef, useState } from 'react';

import type { WorkerRequest, WorkerResponse } from '../worker/analyze.worker';
import type { Report } from './types';

export type AnalyzerState = {
  status: 'idle' | 'working' | 'ready' | 'error';
  step?: string;
  report: Report | null;
  error?: string;
};

export function useAnalyzer(): AnalyzerState & {
  analyze(files: Array<{ name: string; bytes: Uint8Array }>, cliText: string): void;
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

  const analyze = useCallback((files: Array<{ name: string; bytes: Uint8Array }>, cliText: string) => {
    // Worker frais par analyse : état WASM propre, et un run précédent
    // éventuellement bloqué est tué au lieu de faire la queue.
    workerRef.current?.terminate();
    const worker = new Worker(new URL('../worker/analyze.worker.ts', import.meta.url));
    workerRef.current = worker;

    setState({ status: 'working', step: 'Préparation…', report: null });

    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.type === 'progress') {
        setState({ status: 'working', step: msg.step, report: null });
      } else if (msg.type === 'done') {
        setState({ status: 'ready', report: msg.report });
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      } else {
        setState({ status: 'error', report: null, error: msg.error });
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      }
    };
    worker.onerror = (ev) => {
      setState({ status: 'error', report: null, error: ev.message || 'Erreur inattendue dans le worker' });
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };

    const payload: WorkerRequest = {
      files: files.map((f) => {
        // Copie dans un ArrayBuffer autonome : bytes peut être une vue sur un
        // buffer partagé, et on transfère la propriété au worker.
        const ab = new ArrayBuffer(f.bytes.byteLength);
        new Uint8Array(ab).set(f.bytes);
        return { name: f.name, bytes: ab };
      }),
      cliText,
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

'use client';

import { useState } from 'react';
import { useAnalyzer } from '@/lib/analyze-client';
import ReportView from '@/components/ReportView';
import UploadZone from '@/components/UploadZone';

const STEPS: Array<{ title: string; text: string }> = [
  {
    title: 'Glisse tes logs',
    text: '.bbl ou .bfl, direct depuis la carte SD ou la GUI. Plusieurs fichiers d’un coup si tu veux.',
  },
  {
    title: 'Analyse locale',
    text: 'Décodage, DSP et règles déterministes — tout tourne dans ton navigateur, rien ne part sur un serveur.',
  },
  {
    title: 'Corrige en 30 s',
    text: 'Verdicts chiffrés, graphes, et commandes CLI prêtes à coller dans Betaflight.',
  },
];

export default function Page() {
  const analyzer = useAnalyzer();
  const [files, setFiles] = useState<File[]>([]);
  const [cliText, setCliText] = useState('');
  const [reading, setReading] = useState(false);

  const startAnalysis = async () => {
    if (files.length === 0 || reading) return;
    setReading(true);
    try {
      const payload = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          bytes: new Uint8Array(await f.arrayBuffer()),
        })),
      );
      analyzer.analyze(payload, cliText);
    } finally {
      setReading(false);
    }
  };

  if (analyzer.status === 'ready' && analyzer.report) {
    return (
      <ReportView
        report={analyzer.report}
        onReset={() => {
          analyzer.reset();
          setFiles([]);
        }}
      />
    );
  }

  if (analyzer.status === 'working' || reading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-xl border border-line bg-surface p-8 text-center"
      >
        <span
          aria-hidden="true"
          className="size-8 animate-spin rounded-full border-2 border-line border-t-accent"
        />
        <p className="font-mono text-sm text-ink">
          {analyzer.status === 'working' ? (analyzer.step ?? 'Analyse en cours…') : 'Lecture des fichiers…'}
        </p>
        <p className="text-xs text-ink-3">
          Ça tourne dans ton navigateur — rien n&apos;est envoyé nulle part.
        </p>
      </div>
    );
  }

  // idle ou error : hero + zone d'upload
  return (
    <div className="space-y-8">
      <section aria-label="Présentation" className="space-y-5">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Debrief<span className="text-accent">_</span>
          </h1>
          <p className="mt-1 text-lg font-medium text-ink-2">Ton vol, décodé. Sans IA.</p>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-2">
            Glisse tes logs blackbox Betaflight : Debrief les décode et te sort des verdicts
            chiffrés — vibrations, filtres, PID, moteurs, batterie — avec les commandes CLI prêtes
            à coller. Pas d&apos;IA, pas d&apos;upload : du signal et des règles, tout est traçable.
          </p>
        </div>

        <ol className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-lg border border-line bg-surface p-4">
              <p className="font-mono text-xs font-semibold text-accent">0{i + 1}</p>
              <p className="mt-1 text-sm font-semibold text-ink">{step.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {analyzer.status === 'error' ? (
        <div
          role="alert"
          className="rounded-lg border border-crit/40 bg-crit/10 p-4 text-sm text-ink"
        >
          <p className="font-semibold text-crit">
            <span aria-hidden="true">❌</span> Analyse impossible
          </p>
          <p className="mt-1 text-ink-2">{analyzer.error ?? 'Erreur inconnue.'}</p>
        </div>
      ) : null}

      <section aria-label="Dépôt des logs" className="space-y-4">
        <UploadZone
          files={files}
          onFilesChange={setFiles}
          cliText={cliText}
          onCliTextChange={setCliText}
          disabled={reading}
        />
        <button
          type="button"
          onClick={() => void startAnalysis()}
          disabled={files.length === 0 || reading}
          className="w-full rounded-lg bg-accent px-4 py-3 text-base font-semibold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:px-8"
        >
          Analyser {files.length > 1 ? `les ${files.length} logs` : 'le log'}
        </button>
      </section>
    </div>
  );
}

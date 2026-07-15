'use client';

import { useEffect, useRef, useState } from 'react';
import { useAnalyzer } from '@/lib/analyze-client';
import { useLocale } from '@/lib/i18n/locale';
import ReportView from '@/components/ReportView';
import UploadZone from '@/components/UploadZone';

export default function Page() {
  const analyzer = useAnalyzer();
  const { locale, dict } = useLocale();
  const t = dict.ui.page;
  const [files, setFiles] = useState<File[]>([]);
  const [cliText, setCliText] = useState('');
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  const startAnalysis = async () => {
    if (files.length === 0 || reading) return;
    setReading(true);
    setReadError(null);
    try {
      const payload = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          bytes: new Uint8Array(await f.arrayBuffer()),
        })),
      );
      analyzer.analyze(payload, cliText, locale);
    } catch (e) {
      // File.arrayBuffer() peut rejeter (carte SD éjectée, fichier modifié
      // après sélection) : sans ce catch le clic échouait en silence.
      setReadError(
        e instanceof Error && e.name === 'NotReadableError'
          ? t.readErrorNotReadable
          : e instanceof Error
            ? t.readErrorWithMessage(e.message)
            : t.readErrorGeneric,
      );
    } finally {
      setReading(false);
    }
  };

  // Changement de langue avec un rapport affiché : les findings sont générés
  // dans le worker dans la langue demandée → on relance l'analyse avec les
  // File encore sélectionnés (lecture locale, ~2 s).
  const lastReportLocale = useRef(locale);
  useEffect(() => {
    if (analyzer.status !== 'ready') {
      lastReportLocale.current = locale;
      return;
    }
    if (lastReportLocale.current !== locale) {
      lastReportLocale.current = locale;
      if (files.length > 0) void startAnalysis();
      else analyzer.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, analyzer.status]);

  if (analyzer.status === 'ready' && analyzer.report) {
    return (
      <ReportView
        report={analyzer.report}
        onReset={() => {
          analyzer.reset();
          setFiles([]);
          setCliText('');
          setReadError(null);
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
          {analyzer.status === 'working' ? (analyzer.step ?? t.workingFallback) : t.readingFiles}
        </p>
        <p className="text-xs text-ink-3">{t.privacyNote}</p>
      </div>
    );
  }

  // idle ou error : hero + zone d'upload
  return (
    <div className="space-y-8">
      <section aria-label={t.heroAria} className="space-y-5">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            {t.heroTitle}
            <span className="text-accent">_</span>
          </h1>
          <p className="mt-1 text-lg font-medium text-ink-2">{t.heroTagline}</p>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-2">{t.heroIntro}</p>
        </div>

        <ol className="grid gap-3 sm:grid-cols-3">
          {t.steps.map((step, i) => (
            <li key={step.title} className="rounded-lg border border-line bg-surface p-4">
              <p className="font-mono text-xs font-semibold text-accent">0{i + 1}</p>
              <p className="mt-1 text-sm font-semibold text-ink">{step.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {analyzer.status === 'error' || readError ? (
        <div
          role="alert"
          className="rounded-lg border border-crit/40 bg-crit/10 p-4 text-sm text-ink"
        >
          <p className="font-semibold text-crit">
            <span aria-hidden="true">❌</span> {t.errorTitle}
          </p>
          <p className="mt-1 text-ink-2">{readError ?? analyzer.error ?? t.errorUnknown}</p>
        </div>
      ) : null}

      <section aria-label={t.uploadAria} className="space-y-4">
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
          {t.analyzeButton(files.length)}
        </button>
      </section>
    </div>
  );
}

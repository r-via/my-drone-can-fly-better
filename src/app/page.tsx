'use client';

import { useEffect, useRef, useState } from 'react';
import { useAnalyzer } from '@/lib/analyze-client';
import { useLocale } from '@/lib/i18n/locale';
import { ShareDecodeError, decodeSession } from '@/lib/share/codec';
import ReportView from '@/components/ReportView';
import UploadZone from '@/components/UploadZone';
import { AlertIcon } from '@/components/icons';

import type { Report } from '@/lib/types';

export default function Page() {
  const analyzer = useAnalyzer();
  const { locale, dict } = useLocale();
  const t = dict.ui.page;
  const [files, setFiles] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  // Rapport reçu par lien. On conserve la charge encodée en plus du rapport
  // décodé : c'est elle qui permet de re-rendre le rapport dans une autre
  // langue sans rien redemander à personne.
  const [sharedEncoded, setSharedEncoded] = useState<string | null>(null);
  const [sharedReport, setSharedReport] = useState<Report | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  // Le fragment n'est jamais transmis au serveur : le rapport partagé n'apparaît
  // donc dans aucun log d'accès, ce qui vaut aussi pour un site statique.
  //
  // `hashchange` en plus du montage : une navigation qui ne change que le
  // fragment ne recharge pas le document. Sans cet écouteur, coller un lien de
  // partage dans un onglet déjà ouvert sur le site ne produisait rien.
  useEffect(() => {
    const read = () => {
      const match = /^#r=(.+)$/.exec(window.location.hash);
      if (match) setSharedEncoded(match[1]);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  useEffect(() => {
    if (!sharedEncoded) return;
    let cancelled = false;
    void decodeSession(sharedEncoded, dict)
      .then((report) => {
        if (cancelled) return;
        setSharedReport(report);
        setShareError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setSharedReport(null);
        setShareError(
          e instanceof ShareDecodeError && e.reason === 'version'
            ? dict.ui.shareLink.decodeErrorVersion
            : dict.ui.shareLink.decodeErrorMalformed,
        );
      });
    return () => {
      cancelled = true;
    };
    // `dict` en dépendance : changer de langue re-rend le rapport partagé dans
    // la nouvelle langue, sans le perdre et sans relire le moindre fichier.
  }, [sharedEncoded, dict]);

  const dismissShared = () => {
    // Retirer le fragment, sinon un rechargement ramènerait le rapport partagé.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setSharedEncoded(null);
    setSharedReport(null);
    setShareError(null);
  };

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
      analyzer.analyze(payload, locale);
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
        files={files}
        onReset={() => {
          analyzer.reset();
          setFiles([]);
          setReadError(null);
        }}
      />
    );
  }

  // Après l'analyseur : analyser son propre log doit remplacer la vue partagée.
  if (sharedReport) {
    return <ReportView report={sharedReport} files={[]} onReset={dismissShared} />;
  }

  if (analyzer.status === 'working' || reading || (sharedEncoded && !shareError)) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-2xl border border-line bg-surface p-8 text-center"
      >
        <span
          aria-hidden="true"
          className="size-8 animate-spin rounded-full border-2 border-line border-t-accent shadow-[0_0_18px_-4px_var(--accent-glow)]"
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
          <h1 className="font-display text-4xl font-bold tracking-tight text-ink sm:text-[42px]">
            {t.heroTagline}
            <span className="animate-[blink_1.1s_steps(1)_infinite] text-accent motion-reduce:animate-none">
              _
            </span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-2">{t.heroIntro}</p>
        </div>

        <ol className="grid gap-3 sm:grid-cols-3">
          {t.steps.map((step, i) => (
            <li
              key={step.title}
              className="rounded-2xl border border-line bg-surface p-4 transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[0_16px_40px_-24px_rgba(0,0,0,0.7)]"
            >
              <p className="font-display text-xs font-bold text-accent">0{i + 1}</p>
              <p className="mt-1 text-sm font-bold text-ink">{step.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {analyzer.status === 'error' || readError || shareError ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-2xl border border-crit/40 bg-crit/10 p-4 text-sm text-ink"
        >
          <AlertIcon className="mt-0.5 size-4 shrink-0 text-crit" />
          <div>
            <p className="font-bold text-crit">{t.errorTitle}</p>
            <p className="mt-1 text-ink-2">
              {shareError ?? readError ?? analyzer.error ?? t.errorUnknown}
            </p>
          </div>
        </div>
      ) : null}

      <section aria-label={t.uploadAria} className="space-y-4">
        <UploadZone files={files} onFilesChange={setFiles} disabled={reading} />
        <button
          type="button"
          onClick={() => void startAnalysis()}
          disabled={files.length === 0 || reading}
          className="w-full rounded-full bg-cta px-8 py-3.5 font-display text-base font-bold tracking-wide text-cta-ink shadow-[0_14px_34px_-14px_var(--accent-glow)] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-14px_var(--accent-glow)] active:translate-y-0 active:scale-[0.98] disabled:pointer-events-none disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none sm:w-auto"
        >
          {t.analyzeButton(files.length)}
        </button>
      </section>
    </div>
  );
}

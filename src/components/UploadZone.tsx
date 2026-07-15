'use client';

import { useState, type ChangeEvent, type DragEvent } from 'react';

import { useLocale } from '@/lib/i18n/locale';

const ACCEPTED = /\.(bbl|bfl)$/i;

function fmtBytes(n: number, mega: string, kilo: string): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} ${mega}`;
  return `${Math.max(1, Math.round(n / 1000))} ${kilo}`;
}

export interface UploadZoneProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  cliText: string;
  onCliTextChange: (value: string) => void;
  disabled?: boolean;
}

export default function UploadZone({
  files,
  onFilesChange,
  cliText,
  onCliTextChange,
  disabled = false,
}: UploadZoneProps) {
  const { dict } = useLocale();
  const t = dict.ui.upload;
  const [dragOver, setDragOver] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);

  const addFiles = (incoming: File[]) => {
    const accepted = incoming.filter((f) => ACCEPTED.test(f.name));
    setRejected(incoming.filter((f) => !ACCEPTED.test(f.name)).map((f) => f.name));
    if (accepted.length === 0) return;
    const known = new Set(files.map((f) => `${f.name}:${f.size}`));
    const fresh = accepted.filter((f) => !known.has(`${f.name}:${f.size}`));
    if (fresh.length > 0) onFilesChange([...files, ...fresh]);
  };

  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    addFiles(Array.from(e.dataTransfer.files));
  };

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = '';
  };

  return (
    <div className="space-y-3">
      <label
        htmlFor="bbl-input"
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`block cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
          dragOver
            ? 'border-accent bg-accent/10'
            : 'border-line bg-surface hover:border-ink-3'
        } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
      >
        <input
          id="bbl-input"
          type="file"
          multiple
          accept=".bbl,.bfl"
          disabled={disabled}
          onChange={onInputChange}
          className="sr-only"
          aria-describedby="bbl-help"
        />
        <p className="text-base font-medium text-ink">
          {t.dropTitle}
          <span className="text-ink-3">{t.dropBrowse}</span>
        </p>
        <p id="bbl-help" className="mt-1 font-mono text-xs text-ink-3">
          {t.dropHelp}
        </p>
      </label>

      {rejected.length > 0 ? (
        <p role="status" className="text-xs text-warn">
          <span aria-hidden="true">⚠️</span> {t.rejected(rejected.join(', '))}
        </p>
      ) : null}

      {files.length > 0 ? (
        <ul aria-label={t.selectedFilesAria} className="space-y-1.5">
          {files.map((f) => (
            <li
              key={`${f.name}:${f.size}`}
              className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2"
            >
              <span className="min-w-0 truncate font-mono text-sm text-ink">{f.name}</span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="font-mono text-xs text-ink-3">
                  {fmtBytes(f.size, dict.ui.units.mega, dict.ui.units.kilo)}
                </span>
                <button
                  type="button"
                  aria-label={t.removeFile(f.name)}
                  disabled={disabled}
                  onClick={() => onFilesChange(files.filter((x) => x !== f))}
                  className="rounded px-1.5 text-sm text-ink-3 hover:text-crit"
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <details className="rounded-lg border border-line bg-surface">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-2 hover:text-ink">
          {t.pasteSummaryBefore}
          <code className="font-mono">{t.pasteSummaryCode}</code>
          {t.pasteSummaryAfter}
        </summary>
        <div className="border-t border-line p-4">
          <label htmlFor="cli-paste" className="sr-only">
            {t.pasteLabel}
          </label>
          <textarea
            id="cli-paste"
            value={cliText}
            disabled={disabled}
            onChange={(e) => onCliTextChange(e.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={t.pastePlaceholder}
            className="w-full resize-y rounded-md border border-line bg-bg/60 p-3 font-mono text-xs text-ink placeholder:text-ink-3"
          />
          <p className="mt-2 text-xs text-ink-3">{t.pasteNote}</p>
        </div>
      </details>
    </div>
  );
}

'use client';

import { useState, type ChangeEvent, type DragEvent } from 'react';

import { useLocale } from '@/lib/i18n/locale';
import { AlertIcon, DroneIcon } from '@/components/icons';

const ACCEPTED = /\.(bbl|bfl)$/i;

function fmtBytes(n: number, mega: string, kilo: string): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} ${mega}`;
  return `${Math.max(1, Math.round(n / 1000))} ${kilo}`;
}

export interface UploadZoneProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  disabled?: boolean;
}

export default function UploadZone({ files, onFilesChange, disabled = false }: UploadZoneProps) {
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
        className={`group block cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
          dragOver
            ? 'border-accent bg-accent/10'
            : 'border-line-strong bg-surface hover:border-accent hover:bg-accent/[0.06]'
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
        <DroneIcon className="mx-auto mb-3.5 size-14 text-ink-3 transition-transform group-hover:scale-105" />
        <p className="text-base font-medium text-ink">
          {t.dropTitle}
          <span className="text-ink-3">{t.dropBrowse}</span>
        </p>
        <p id="bbl-help" className="mt-1.5 font-mono text-[11.5px] text-ink-3">
          {t.dropHelp}
        </p>
      </label>

      {rejected.length > 0 ? (
        <p role="status" className="flex items-center gap-1.5 text-xs text-warn">
          <AlertIcon className="size-3.5 shrink-0" /> {t.rejected(rejected.join(', '))}
        </p>
      ) : null}

      {files.length > 0 ? (
        <ul aria-label={t.selectedFilesAria} className="space-y-1.5">
          {files.map((f) => (
            <li
              key={`${f.name}:${f.size}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5"
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
                  className="rounded-full px-1.5 text-sm text-ink-3 transition-colors hover:text-crit"
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// Canvas shell — the shared frame for the five organizer tools.
// All user-visible strings come from the canvas/runner messages
// namespaces. The `locale` prop makes the privacy link locale-aware.
"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toLocalePath } from "../../i18n/routing";
import type { CanvasPhase } from "./useOrganizerJob";

interface CanvasShellProps {
  toolName: string;
  description: string;
  fileLabel: string;
  quota: { used: number; limit: number; remaining: number } | null;
  maxFiles: number;
  maxUploadMb: number;
  phase: CanvasPhase;
  busy: boolean;
  uploadPending: boolean;
  totalPages: number;
  summary: string;
  payload: unknown;
  payloadError: string | null;
  processLabel: string;
  canProcess: boolean;
  onProcess: () => void;
  onPick: (files: File[]) => void;
  onReset: () => void;
  onBackToOrganize: () => void;
  onDownload: () => void;
  downloadPct: number | null;
  activityLabel: string;
  error: string | null;
  locale: string;
  children: ReactNode;
}

export function CanvasShell({
  toolName,
  description,
  fileLabel,
  quota,
  maxFiles,
  maxUploadMb,
  phase,
  busy,
  uploadPending,
  totalPages,
  summary,
  payload,
  payloadError,
  processLabel,
  canProcess,
  onProcess,
  onPick,
  onReset,
  onBackToOrganize,
  onDownload,
  downloadPct,
  activityLabel,
  error,
  locale,
  children,
}: CanvasShellProps) {
  const t = useTranslations("canvas");
  const tRunner = useTranslations("runner");
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const showDropzone = phase === "pick" || phase === "uploading";
  const showWorkspace = phase === "organize" || phase === "processing" || phase === "completed" || phase === "failed";

  return (
    <div className="mx-auto max-w-6xl">
      {/* Narrow column (matches ToolRunner's max-w-2xl): header, quota,
          banners and the upload dropzone. The workspace below stays wide. */}
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{toolName}</h1>
            <p className="mt-1 text-sm text-slate-600">{description}</p>
          </div>
          {phase !== "pick" && (
            <button
              onClick={onReset}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:border-brand-600 hover:text-brand-600"
            >
              {t("startOver")}
            </button>
          )}
        </div>
        {quota && (
          <p className="mt-2 text-xs text-slate-500">
            {tRunner("quotaLeft", { remaining: quota.remaining, limit: quota.limit })}
            {uploadPending && <> · {t("uploadingToServer")}</>}
          </p>
        )}

        {error && phase !== "failed" && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {totalPages > 200 && showWorkspace && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {t("largeDoc", { count: totalPages })}
          </div>
        )}
        {totalPages > 50 && totalPages <= 200 && showWorkspace && (
          <p className="mt-3 text-xs text-slate-500">{t("pagesScroll", { count: totalPages })}</p>
        )}

        {showDropzone && (
          <div
            role="button"
            tabIndex={0}
            aria-label={maxFiles > 1 ? t("dropAriaPlural") : t("dropAria")}
            className={`mt-6 cursor-pointer rounded-2xl border-2 border-dashed px-6 py-14 text-center ${
              dragOver || phase === "uploading"
                ? "border-brand-500 bg-brand-50"
                : "border-slate-300 bg-white hover:border-brand-500"
            }`}
            onClick={() => phase === "pick" && inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" && phase === "pick") inputRef.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (phase !== "pick") return;
              const dropped = Array.from(e.dataTransfer.files).filter((f) =>
                f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
              );
              if (dropped.length > 0) onPick(dropped.slice(0, maxFiles));
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple={maxFiles > 1}
              className="hidden"
              onChange={(e) => {
                const list = e.target.files ? Array.from(e.target.files) : [];
                e.target.value = "";
                if (list.length > 0) onPick(list.slice(0, maxFiles));
              }}
            />
            <p className="text-lg font-semibold">
              {phase === "uploading" ? t("dropTitleUploading") : t("dropTitle")}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {t("dropSub", { max: maxFiles, mb: maxUploadMb })}
            </p>
          </div>
        )}
      </div>

      {showWorkspace && (
        <>
          <p className="mt-4 text-sm text-slate-600">
            <span className="font-semibold">
              <bdi>{fileLabel}</bdi>
            </span>
            {totalPages > 0 && <> · {t("fileLabelPages", { count: totalPages })}</>}
          </p>
          {children}
        </>
      )}

      {phase === "organize" && (
        <div className="sticky bottom-0 mt-6 rounded-t-2xl border-t border-slate-200 bg-white/95 px-4 py-4 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
          <p className="text-sm font-semibold text-slate-800">{summary}</p>
          {payloadError && (
            <p className="mt-1 text-sm text-red-700">{payloadError}</p>
          )}
          <details className="mt-2 text-xs text-slate-500">
            <summary className="cursor-pointer font-medium text-slate-600">
              {t("whatWillBeSent")}
            </summary>
            <pre
              data-testid="job-payload"
              className="mt-2 overflow-auto rounded-lg bg-slate-100 p-3 text-[11px] leading-relaxed"
            >
              {JSON.stringify(payload, null, 2)}
            </pre>
          </details>
          <button
            data-testid="process-button"
            disabled={busy || !canProcess || uploadPending}
            onClick={onProcess}
            className="mt-3 w-full rounded-xl bg-brand-600 px-4 py-3 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy
              ? t("starting")
              : uploadPending
                ? t("uploadingToServer")
                : processLabel}
          </button>
        </div>
      )}

      {phase === "processing" && (
        <div className="mx-auto max-w-2xl">
          <div className="mt-6 rounded-2xl bg-white p-8 text-center shadow-sm">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-brand-600" />
            <p className="mt-4 font-semibold">{activityLabel}…</p>
            <p className="mt-1 text-sm text-slate-500">{t("processingSub")}</p>
          </div>
        </div>
      )}

      {phase === "failed" && (
        <div className="mx-auto max-w-2xl">
          <div className="mt-6 rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
            <p className="text-lg font-semibold text-red-700">{t("failedTitle")}</p>
            <p className="mt-2 text-sm text-slate-600">{error || t("failedFallback")}</p>
            <button
              onClick={onBackToOrganize}
              className="mt-4 rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-700"
            >
              {t("backToEditor")}
            </button>
          </div>
        </div>
      )}

      {phase === "completed" && (
        <div className="mx-auto max-w-2xl">
          <div className="mt-6 rounded-2xl bg-white p-6 text-center shadow-sm">
            <p className="text-lg font-semibold text-green-700">{t("completedTitle")}</p>
            <p className="mt-2 text-xs text-slate-500">
              {t("completedNote")}{" "}
              <Link
                href={toLocalePath("/how-we-handle-files", locale)}
                className="font-semibold text-brand-600 hover:text-brand-700"
              >
                {t("completedLink")}
              </Link>
            </p>
            <button
              onClick={onDownload}
              className="mt-4 inline-block rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {downloadPct !== null && downloadPct > 0 ? t("downloadingPct", { pct: downloadPct }) : t("downloadResult")}
            </button>
            <button onClick={onReset} className="mt-4 block w-full text-sm text-slate-500 hover:text-brand-600">
              {t("startOver")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

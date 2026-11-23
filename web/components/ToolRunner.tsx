// Generic tool flow (21 non-canvas tools): pick files -> options ->
// poll job -> download. All user-visible strings come from the
// messages dictionaries. Backend option labels are overridden from the
// toolOptions namespace (keyed by tool + option name); backend job
// failures are translated by stable error code, never by matching the
// English message text.
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, api, ToolSpec, UploadedFile, Job } from "../lib/api";
import { toLocalePath } from "../i18n/routing";

type Phase =
  | "pick"
  | "uploading"
  | "options"
  | "preparing"
  | "active"
  | "finalizing"
  | "completed"
  | "failed"
  | "downloading";

// The server resets quota windows on the clock hour. Render the upcoming
// reset in local 24h time, e.g. "14:00".
function quotaResetTime(): string {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return `${String(d.getHours()).padStart(2, "0")}:00`;
}

export function ToolRunner({ toolKey }: { toolKey: string }) {
  const locale = useLocale();
  const t = useTranslations("runner");
  const tErr = useTranslations("errors");
  const tOpt = useTranslations("toolOptions");
  const tTools = useTranslations("tools");
  const tContent = useTranslations("toolContent");
  const [spec, setSpec] = useState<ToolSpec | null>(null);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [options, setOptions] = useState<Record<string, unknown>>({});
  const [phase, setPhase] = useState<Phase>("pick");
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState<{ used: number; limit: number; remaining: number } | null>(null);
  const [limits, setLimits] = useState<{ max_upload_mb: number; max_download_mb: number } | null>(null);
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Translate an error by stable code. Falls back to the English
  // message only when no code is available (e.g. a network failure).
  function resolveError(e: unknown): string {
    if (e instanceof ApiError) {
      if (e.status === 429) return tErr("quota_exceeded", { time: quotaResetTime() });
      if (e.code && tErr.has(e.code)) return tErr(e.code);
      return e.message;
    }
    return e instanceof Error ? e.message : String(e);
  }

  // Translate a failed job: prefer the backend error code.
  function jobError(j: Job): string {
    if (j.error_code && tErr.has(j.error_code)) return tErr(j.error_code);
    return j.error || tErr("internal_error");
  }

  // Frontend override for a backend option label/help/choice, if the
  // dictionary has one; otherwise the API's English label is used.
  function optLabel(o: { name: string; label: string }): string {
    const key = `${toolKey}.${o.name}.label`;
    return tOpt.has(key) ? tOpt(key) : o.label;
  }
  function optHelp(o: { name: string; help: string }): string {
    const key = `${toolKey}.${o.name}.help`;
    return tOpt.has(key) ? tOpt(key) : o.help;
  }
  function choiceLabel(tool: string, optName: string, value: string): string {
    const key = `${tool}.${optName}.choices.${value}`;
    return tOpt.has(key) ? tOpt(key) : value;
  }

  useEffect(() => {
    api.tool(toolKey).then(setSpec).catch((e) => setError(resolveError(e)));
    api.quota(toolKey).then(setQuota).catch(() => {});
    api.limits().then(setLimits).catch(() => {});
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolKey]);

  const accept = spec
    ? spec.input_kinds.includes("image")
      ? "image/png,image/jpeg,image/webp"
      : spec.input_kinds.includes("html")
        ? "text/html,.html,.htm"
        : "application/pdf,.pdf"
    : "";

  const activityKey =
    spec?.activity === "converting"
      ? "converting"
      : spec?.activity === "optimizing"
        ? "optimizing"
        : "processing";
  const activityLabel = t(`steps.${activityKey}`);

  // Steps relevant to this tool, in order. Only these are ever shown.
  const steps = spec
    ? [
        t("steps.uploading"),
        t("steps.preparing"),
        activityLabel,
        t("steps.finalizing"),
        t("steps.completed"),
      ]
    : [];
  const stepIndex: Record<Phase, number> = {
    pick: -1,
    uploading: 0,
    options: 0,
    preparing: 1,
    active: 2,
    finalizing: 3,
    completed: 4,
    failed: -1,
    downloading: 4,
  };

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function pollJob(jobId: string) {
    stopPolling();
    const tick = async () => {
      try {
        const j = await api.job(jobId);
        setJob(j);
        if (j.status === "queued") {
          setPhase("preparing");
        } else if (j.status === "running") {
          setPhase("active");
        } else if (j.status === "succeeded") {
          stopPolling();
          setPhase("finalizing");
          // Finalizing lasts exactly as long as preparing the result takes.
          api.quota(toolKey).then(setQuota).catch(() => {});
          setPhase("completed");
        } else {
          // failed or cancelled
          stopPolling();
          setError(jobError(j));
          setPhase("failed");
        }
      } catch (e: unknown) {
        stopPolling();
        setError(resolveError(e));
        setPhase("failed");
      }
    };
    await tick();
    pollRef.current = setInterval(tick, 400);
  }

  async function onPick(list: FileList | null) {
    if (!list || !spec) return;
    setError(null);
    const chosen = Array.from(list).slice(0, spec.max_files);
    if (files.length + chosen.length > spec.max_files) {
      setError(t("atMost", { max: spec.max_files }));
      return;
    }
    // Client-side size check against the server's real limit — instant,
    // clear feedback instead of waiting for the upload to be rejected.
    const maxBytes = (limits?.max_upload_mb ?? 50) * 1024 * 1024;
    const tooBig = chosen.find((f) => f.size > maxBytes);
    if (tooBig) {
      setError(
        t("tooBig", { name: tooBig.name, mb: limits?.max_upload_mb ?? 50 }),
      );
      return;
    }
    if (files.length + chosen.length < spec.min_files && chosen.length === 0) return;
    setBusy(true);
    setPhase("uploading");
    try {
      const uploaded: UploadedFile[] = [];
      for (const f of chosen) {
        uploaded.push(await api.upload(f));
      }
      const all = [...files, ...uploaded];
      setFiles(all);
      if (all.length < spec.min_files) {
        setPhase("pick");
        setError(t("atLeast", { min: spec.min_files }));
      } else if (spec.options.length === 0) {
        await startJob(all, options);
      } else {
        setPhase("options");
      }
    } catch (e: unknown) {
      setError(resolveError(e));
      setPhase("pick");
    } finally {
      setBusy(false);
    }
  }

  async function startJob(currentFiles: UploadedFile[], opts: Record<string, unknown>) {
    if (!spec) return;
    setError(null);
    setBusy(true);
    try {
      // 202: job accepted and queued; real progress comes from polling.
      const j = await api.createJob(spec.key, currentFiles.map((f) => f.id), opts);
      setJob(j);
      setPhase("preparing");
      await pollJob(j.id);
    } catch (e: unknown) {
      setError(resolveError(e));
      // A 429 here means the quota is spent — refresh so the reset-time
      // display and the disabled run state show up immediately.
      api.quota(toolKey).then(setQuota).catch(() => {});
      setPhase("options");
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (!job?.output_file_id) return;
    setPhase("downloading");
    setDownloadPct(0);
    setError(null);
    try {
      const res = await fetch(api.downloadUrl(job.output_file_id));
      if (!res.ok || !res.body) throw new Error(tErr("download_failed"));
      const total = Number(res.headers.get("content-length") || 0);
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total > 0) setDownloadPct(Math.round((received / total) * 100));
      }
      const blob = new Blob(chunks as BlobPart[]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${spec?.key || "result"}_output.${spec?.output_ext || "pdf"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setPhase("completed");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tErr("download_failed"));
      setPhase("completed");
    } finally {
      setDownloadPct(null);
    }
  }

  function setOpt(name: string, value: unknown) {
    setOptions((o) => ({ ...o, [name]: value }));
  }

  function reset() {
    stopPolling();
    setFiles([]);
    setOptions({});
    setJob(null);
    setError(null);
    setPhase("pick");
  }

  async function retry() {
    if (!job) return;
    setError(null);
    try {
      const j = await api.retryJob(job.id);
      setJob(j);
      setPhase("preparing");
      await pollJob(j.id);
    } catch (e: unknown) {
      setError(resolveError(e));
    }
  }

  if (error && !spec) {
    return <p className="text-red-600">{t("loadFailed", { error })}</p>;
  }
  if (!spec) return <p className="text-slate-500">{t("loading")}</p>;

  const currentStep = stepIndex[phase];
  const toolName = tTools(`${toolKey}.name`);
  const toolDescription = tContent.has(`${toolKey}.description`)
    ? tContent(`${toolKey}.description`)
    : spec.description;

  return (
    <div className="mx-auto max-w-2xl">
      <p className="mt-2 text-slate-600">{toolDescription}</p>
      {quota && (
        <p className="mt-2 text-xs text-slate-500">
          {t("quotaLeft", { remaining: quota.remaining, limit: quota.limit })}
          {quota.remaining === 0 && <> {t("quotaResets", { time: quotaResetTime() })}</>}
        </p>
      )}

      {/* Progress stepper — only the states relevant to this tool */}
      {currentStep >= 0 && (
        <ol className="mt-6 flex items-center gap-1 sm:gap-2">
          {steps.map((label, i) => {
            const done = i < currentStep;
            const active = i === currentStep;
            return (
              <li key={label} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center gap-1">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                      done
                        ? "bg-green-600 text-white"
                        : active
                          ? "animate-pulse bg-brand-600 text-white"
                          : "bg-slate-200 text-slate-500"
                    }`}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <span
                    className={`text-[11px] sm:text-xs ${
                      active ? "font-semibold text-brand-700" : "text-slate-500"
                    }`}
                  >
                    {label}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <div
                    className={`mx-1 mb-5 h-0.5 flex-1 sm:mx-2 ${
                      done ? "bg-green-600" : "bg-slate-200"
                    }`}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}

      {error && phase !== "failed" && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {(phase === "pick" || phase === "uploading") && (
        <div
          className={`mt-6 rounded-2xl border-2 border-dashed px-6 py-14 text-center ${
            phase === "uploading"
              ? "border-brand-500 bg-brand-50"
              : "cursor-pointer border-slate-300 bg-white hover:border-brand-500"
          }`}
          onClick={() => phase === "pick" && inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            multiple={spec.max_files > 1}
            className="hidden"
            onChange={(e) => onPick(e.target.files)}
          />
          <p className="text-lg font-semibold">
            {phase === "uploading"
              ? t("uploading")
              : spec.input_kinds.includes("image")
                ? t("chooseImage")
                : spec.input_kinds.includes("html")
                  ? t("chooseHtml")
                  : t("choosePdf")}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {t("fileLimit", { max: spec.max_files, mb: limits?.max_upload_mb ?? 50 })}
          </p>
        </div>
      )}

      {files.length > 0 && ["pick", "uploading", "options"].includes(phase) && (
        <ul className="mt-4 space-y-2">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between rounded-lg bg-slate-100 px-4 py-2 text-sm">
              <span className="truncate">
                <bdi>{f.filename}</bdi>
              </span>
              <span className="text-slate-500">{(f.size_bytes / 1024).toFixed(0)} KB</span>
            </li>
          ))}
        </ul>
      )}

      {/* Tools with min_files 0 (e.g. HTML to PDF, which also accepts
          pasted code) show their options right away, so the job can
          start without any file. */}
      {(phase === "options" || (phase === "pick" && spec.min_files === 0)) && (
        <div className="mt-6 space-y-4 rounded-2xl bg-white p-6 shadow-sm">
          {spec.options.map((o) => (
            <div key={o.name}>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {optLabel(o)} {o.required && <span className="text-red-500">*</span>}
              </label>
              {o.kind === "select" && (
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={String(options[o.name] ?? o.default ?? "")}
                  onChange={(e) => setOpt(o.name, e.target.value)}
                >
                  {(o.choices || []).map((c) => (
                    <option key={c} value={c}>
                      {choiceLabel(toolKey, o.name, c)}
                    </option>
                  ))}
                </select>
              )}
              {o.kind === "boolean" && (
                <input
                  type="checkbox"
                  checked={Boolean(options[o.name] ?? o.default ?? false)}
                  onChange={(e) => setOpt(o.name, e.target.checked)}
                  className="h-5 w-5"
                />
              )}
              {(o.kind === "text" || o.kind === "pages") && (
                <input
                  type="text"
                  dir="ltr"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder={String(o.default ?? "")}
                  value={String(options[o.name] ?? "")}
                  onChange={(e) => setOpt(o.name, e.target.value)}
                />
              )}
              {o.kind === "textarea" && (
                <textarea
                  dir="ltr"
                  rows={10}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  placeholder={String(o.default ?? "")}
                  value={String(options[o.name] ?? "")}
                  onChange={(e) => setOpt(o.name, e.target.value)}
                />
              )}
              {o.kind === "number" && (
                <input
                  type="number"
                  dir="ltr"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={String(options[o.name] ?? o.default ?? "")}
                  onChange={(e) => setOpt(o.name, Number(e.target.value))}
                />
              )}
              {optHelp(o) && <p className="mt-1 text-xs text-slate-500">{optHelp(o)}</p>}
            </div>
          ))}
          <button
            disabled={busy || quota?.remaining === 0}
            onClick={() => startJob(files, options)}
            className="w-full rounded-xl bg-brand-600 px-4 py-3 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? t("starting") : t("startButton", { tool: toolName })}
          </button>
        </div>
      )}

      {(phase === "preparing" || phase === "active" || phase === "finalizing") && (
        <div className="mt-6 rounded-2xl bg-white p-8 text-center shadow-sm">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-brand-600" />
          <p className="mt-4 font-semibold">
            {phase === "preparing" && t("preparing")}
            {phase === "active" && `${activityLabel}…`}
            {phase === "finalizing" && t("finalizing")}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {phase === "preparing" && t("preparingSub")}
            {phase === "active" && t("activeSub")}
            {phase === "finalizing" && t("finalizingSub")}
          </p>
        </div>
      )}

      {phase === "failed" && (
        <div className="mt-6 rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <p className="text-lg font-semibold text-red-700">{t("failedTitle")}</p>
          <p className="mt-2 text-sm text-slate-600">{error || t("failedFallback")}</p>
          <div className="mt-4 flex gap-3 justify-center">
            {job && (
              <button
                onClick={retry}
                className="rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-700"
              >
                {t("tryAgain")}
              </button>
            )}
            <button onClick={reset} className="rounded-xl border border-slate-300 px-5 py-2.5 text-slate-600 hover:border-brand-600 hover:text-brand-600">
              {t("startOver")}
            </button>
          </div>
        </div>
      )}

      {(phase === "completed" || phase === "downloading") && (
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
            onClick={download}
            disabled={phase === "downloading"}
            className="mt-4 inline-block rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {phase === "downloading"
              ? downloadPct !== null && downloadPct > 0
                ? t("downloadingPct", { pct: downloadPct })
                : t("downloading")
              : t("downloadResult")}
          </button>
          <button onClick={reset} className="mt-4 block w-full text-sm text-slate-500 hover:text-brand-600">
            {t("startOver")}
          </button>
        </div>
      )}
    </div>
  );
}

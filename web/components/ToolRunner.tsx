"use client";

import { useEffect, useRef, useState } from "react";
import { api, ToolSpec, UploadedFile, Job } from "../lib/api";

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

const ACTIVITY_LABEL: Record<string, string> = {
  processing: "Processing",
  converting: "Converting",
  optimizing: "Optimizing",
};

export function ToolRunner({ toolKey }: { toolKey: string }) {
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

  useEffect(() => {
    api.tool(toolKey).then(setSpec).catch((e) => setError(String(e.message || e)));
    api.quota(toolKey).then(setQuota).catch(() => {});
    api.limits().then(setLimits).catch(() => {});
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [toolKey]);

  const accept = spec
    ? spec.input_kinds.includes("image")
      ? "image/png,image/jpeg,image/webp"
      : "application/pdf,.pdf"
    : "";

  const activityLabel = spec ? ACTIVITY_LABEL[spec.activity] || "Processing" : "Processing";

  // Steps relevant to this tool, in order. Only these are ever shown.
  const steps = spec
    ? ["Uploading", "Preparing", activityLabel, "Finalizing", "Completed"]
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
          setError(j.error || "Processing failed. Please try again.");
          setPhase("failed");
        }
      } catch (e: unknown) {
        stopPolling();
        setError(e instanceof Error ? e.message : "Lost contact with the server.");
        setPhase("failed");
      }
    };
    await tick();
    pollRef.current = setInterval(tick, 800);
  }

  async function onPick(list: FileList | null) {
    if (!list || !spec) return;
    setError(null);
    const chosen = Array.from(list).slice(0, spec.max_files);
    if (files.length + chosen.length > spec.max_files) {
      setError(`This tool accepts at most ${spec.max_files} file(s).`);
      return;
    }
    // Client-side size check against the server's real limit — instant,
    // clear feedback instead of waiting for the upload to be rejected.
    const maxBytes = (limits?.max_upload_mb ?? 50) * 1024 * 1024;
    const tooBig = chosen.find((f) => f.size > maxBytes);
    if (tooBig) {
      setError(
        `"${tooBig.name}" exceeds the ${limits?.max_upload_mb ?? 50} MB upload limit.`
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
        setError(`Select at least ${spec.min_files} file(s).`);
      } else if (spec.options.length === 0) {
        await startJob(all, options);
      } else {
        setPhase("options");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
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
      setError(e instanceof Error ? e.message : String(e));
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
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
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
      setError(e instanceof Error ? e.message : "Download failed.");
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
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (error && !spec) {
    return <p className="text-red-600">Failed to load tool: {error}</p>;
  }
  if (!spec) return <p className="text-slate-500">Loading…</p>;

  const currentStep = stepIndex[phase];

  return (
    <div className="mx-auto max-w-2xl">
      <p className="mt-2 text-slate-600">{spec.description}</p>
      {quota && (
        <p className="mt-2 text-xs text-slate-500">
          {quota.remaining} of {quota.limit} free uses left this hour
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
              ? "Uploading…"
              : `Choose ${spec.input_kinds.includes("image") ? "image" : "PDF"} file(s)`}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Up to {spec.max_files} file(s), {limits?.max_upload_mb ?? 50}&nbsp;MB each. No sign-up needed.
          </p>
        </div>
      )}

      {files.length > 0 && ["pick", "uploading", "options"].includes(phase) && (
        <ul className="mt-4 space-y-2">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between rounded-lg bg-slate-100 px-4 py-2 text-sm">
              <span className="truncate">{f.filename}</span>
              <span className="text-slate-500">{(f.size_bytes / 1024).toFixed(0)} KB</span>
            </li>
          ))}
        </ul>
      )}

      {phase === "options" && (
        <div className="mt-6 space-y-4 rounded-2xl bg-white p-6 shadow-sm">
          {spec.options.map((o) => (
            <div key={o.name}>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {o.label} {o.required && <span className="text-red-500">*</span>}
              </label>
              {o.kind === "select" && (
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={String(options[o.name] ?? o.default ?? "")}
                  onChange={(e) => setOpt(o.name, e.target.value)}
                >
                  {(o.choices || []).map((c) => (
                    <option key={c} value={c}>{c}</option>
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
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder={String(o.default ?? "")}
                  value={String(options[o.name] ?? "")}
                  onChange={(e) => setOpt(o.name, e.target.value)}
                />
              )}
              {o.kind === "number" && (
                <input
                  type="number"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={String(options[o.name] ?? o.default ?? "")}
                  onChange={(e) => setOpt(o.name, Number(e.target.value))}
                />
              )}
              {o.help && <p className="mt-1 text-xs text-slate-500">{o.help}</p>}
            </div>
          ))}
          <button
            disabled={busy}
            onClick={() => startJob(files, options)}
            className="w-full rounded-xl bg-brand-600 px-4 py-3 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "Starting…" : `${spec.name} now`}
          </button>
        </div>
      )}

      {(phase === "preparing" || phase === "active" || phase === "finalizing") && (
        <div className="mt-6 rounded-2xl bg-white p-8 text-center shadow-sm">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-brand-600" />
          <p className="mt-4 font-semibold">
            {phase === "preparing" && "Preparing your files…"}
            {phase === "active" && `${activityLabel}…`}
            {phase === "finalizing" && "Finalizing your file…"}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {phase === "preparing" && "Your job is queued and about to start."}
            {phase === "active" && "This usually takes a few seconds."}
            {phase === "finalizing" && "Almost there."}
          </p>
        </div>
      )}

      {phase === "failed" && (
        <div className="mt-6 rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <p className="text-lg font-semibold text-red-700">Failed</p>
          <p className="mt-2 text-sm text-slate-600">{error || "Something went wrong."}</p>
          <div className="mt-4 flex gap-3 justify-center">
            {job && (
              <button
                onClick={retry}
                className="rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-700"
              >
                Try again
              </button>
            )}
            <button onClick={reset} className="rounded-xl border border-slate-300 px-5 py-2.5 text-slate-600 hover:border-brand-600 hover:text-brand-600">
              Start over
            </button>
          </div>
        </div>
      )}

      {(phase === "completed" || phase === "downloading") && (
        <div className="mt-6 rounded-2xl bg-white p-6 text-center shadow-sm">
          <p className="text-lg font-semibold text-green-700">Completed</p>
          <button
            onClick={download}
            disabled={phase === "downloading"}
            className="mt-4 inline-block rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {phase === "downloading"
              ? downloadPct !== null && downloadPct > 0
                ? `Downloading… ${downloadPct}%`
                : "Downloading…"
              : "Download result"}
          </button>
          <button onClick={reset} className="mt-4 block w-full text-sm text-slate-500 hover:text-brand-600">
            Start over
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { notFound } from "next/navigation";
import FileDropzone from "@/components/FileDropzone";
import { getToolMeta, type ParamField } from "@/lib/tools";
import { filesApi, jobsApi, downloadFile, ApiError, type Job } from "@/lib/api";

type Phase = "idle" | "uploading" | "processing" | "done" | "error";

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: ParamField;
  value: string;
  onChange: (v: string) => void;
}) {
  const base =
    "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">
        {field.label}
        {field.required && <span className="text-red-500"> *</span>}
      </label>
      {field.type === "select" ? (
        <select value={value || field.default || ""} onChange={(e) => onChange(e.target.value)} className={base}>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : field.type === "range" ? (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={field.min}
            max={field.max}
            step={field.step}
            value={value || String(field.default)}
            onChange={(e) => onChange(e.target.value)}
            className="mt-2 flex-1 accent-brand-600"
          />
          <span className="text-sm text-slate-600 w-12 text-right">{value || field.default}</span>
        </div>
      ) : (
        <input
          type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
          value={value}
          min={field.type === "number" ? field.min : undefined}
          max={field.type === "number" ? field.max : undefined}
          placeholder={field.type === "text" || field.type === "password" ? field.placeholder : undefined}
          onChange={(e) => onChange(e.target.value)}
          className={base}
        />
      )}
      {field.hint && <p className="mt-1 text-xs text-slate-400">{field.hint}</p>}
    </div>
  );
}

export function ToolRunner({ toolKey }: { toolKey: string }) {
  const meta = getToolMeta(toolKey);
  const [files, setFiles] = useState<File[]>([]);
  const [params, setParams] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Initialise defaults
  useEffect(() => {
    if (!meta) return;
    const defaults: Record<string, string> = {};
    for (const f of meta.fields) {
      if (f.type === "select" && f.default) defaults[f.name] = f.default;
      if (f.type === "number" && f.default !== undefined) defaults[f.name] = String(f.default);
      if (f.type === "range") defaults[f.name] = String(f.default);
    }
    setParams(defaults);
  }, [meta]);

  const addFiles = useCallback(
    (incoming: File[]) => {
      setFiles((prev) => (meta?.multiple ? [...prev, ...incoming] : incoming.slice(0, 1)));
      setError(null);
    },
    [meta]
  );

  const removeFile = (i: number) => setFiles((prev) => prev.filter((_, idx) => idx !== i));

  const buildParams = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const f of meta!.fields) {
      const raw = params[f.name];
      if (raw === undefined || raw === "") continue;
      if (f.name === "order") {
        out.order = raw.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
      } else if (f.type === "number" || f.type === "range") {
        out[f.name] = parseFloat(raw);
      } else if (f.name === "rotation") {
        out.rotation = parseInt(raw, 10);
      } else if (f.name === "every_n") {
        out.every_n = parseInt(raw, 10);
      } else {
        out[f.name] = raw;
      }
    }
    // split: drop the unused branch param
    if (meta!.key === "split") {
      if (out.mode === "ranges") delete out.every_n;
      if (out.mode === "every_n") delete out.ranges;
    }
    return out;
  };

  const run = async () => {
    if (!meta || files.length === 0) return;
    // Validate required fields
    for (const f of meta.fields) {
      if (f.required && !params[f.name]?.trim()) {
        setError(`"${f.label}" is required.`);
        return;
      }
    }
    setError(null);
    setJob(null);
    // Client-side size guard: 4MB upload limit.
    const MAX_BYTES = 4 * 1024 * 1024;
    for (const f of files) {
      if (f.size > MAX_BYTES) {
        setError(`"${f.name}" is ${(f.size / 1024 / 1024).toFixed(1)}MB — the upload limit is 4MB.`);
        return;
      }
    }
    try {
      setPhase("uploading");
      setStatusText(`Uploading ${files.length} file${files.length > 1 ? "s" : ""}…`);
      const uploadedIds: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const up = await filesApi.upload(files[i], (p) =>
          setProgress(((i + p) / files.length) * 50)
        );
        uploadedIds.push(up.id);
      }
      setProgress(55);
      setPhase("processing");
      setStatusText("Processing…");
      const created = await jobsApi.create(meta.key, uploadedIds, buildParams());
      setJob(created);

      // Poll until terminal
      pollRef.current = setInterval(async () => {
        try {
          const j = await jobsApi.get(created.id);
          setJob(j);
          if (j.status === "completed") {
            if (pollRef.current) clearInterval(pollRef.current);
            setProgress(100);
            setPhase("done");
            setStatusText("Done!");
          } else if (j.status === "failed" || j.status === "cancelled") {
            if (pollRef.current) clearInterval(pollRef.current);
            setPhase("error");
            setError(j.error_code || `Job ${j.status}. Please try again.`);
          } else {
            setProgress(55 + Math.min(40, (Date.now() % 40000) / 1000));
            setStatusText(j.status === "queued" ? "Queued…" : "Processing…");
          }
        } catch (e) {
          // keep polling on transient errors
        }
      }, 2000);
    } catch (e) {
      setPhase("error");
      setError(friendlyErrorMessage(e));
    }
  };

  /** Map API error codes to actionable user messages (spec §61). */
  function friendlyErrorMessage(e: unknown): string {
    if (!(e instanceof ApiError)) {
      return "Something went wrong. Please try again. If it keeps happening, try a different file.";
    }
    switch (e.code) {
      case "FILE_CORRUPT":
      case "PDF_PARSE_FAILED":
        return "This PDF appears to be corrupted and couldn't be processed. Try the Repair PDF tool, or use a different file.";
      case "FILE_TOO_LARGE":
      case "UPLOAD_TOO_LARGE":
        return "This file exceeds the size limit. Try compressing it first, or upgrade for larger files.";
      case "PASSWORD_REQUIRED":
      case "PDF_ENCRYPTED":
        return "This PDF is password-protected. Remove the password first, then try again.";
      case "PAGE_LIMIT_EXCEEDED":
        return "This PDF has more pages than your plan allows. Try splitting it into smaller parts.";
      case "UNSUPPORTED_FILE_TYPE":
        return "This file type isn't supported for this tool. Check the accepted formats and try again.";
      case "OCR_UNAVAILABLE":
        return "OCR is not available right now. Try again later or contact support.";
      case "QUOTA_EXCEEDED":
        return "You've used your free processing quota. Sign in or upgrade to continue.";
      case "AUTH_TOKEN_INVALID":
        return "Your session expired. Please sign in again.";
      case "RATE_LIMITED":
        return "Too many requests. Wait a moment and try again.";
      default:
        return e.message || "Processing failed. Try again with a different file.";
    }
  }

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setFiles([]);
    setJob(null);
    setPhase("idle");
    setProgress(0);
    setError(null);
    setStatusText("");
  };

  const handleDownload = async (fileId: string, index: number) => {
    const ext = meta!.key === "extract_text" ? "txt" : meta!.key === "metadata" ? "json" : "pdf";
    await downloadFile(fileId, `pdfedi-${meta!.key}-${index + 1}.${ext}`);
  };

  if (!meta) notFound();

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <div className="text-center mb-8">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-100 text-2xl text-brand-700">
          {meta.icon}
        </div>
        <h1 className="text-3xl font-bold text-slate-900">{meta.name}</h1>
        <p className="mt-2 text-slate-500">{meta.description}</p>
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {phase !== "done" && (
        <>
          <FileDropzone accept={meta.accept} multiple={meta.multiple} onFiles={addFiles} />

          {files.length > 0 && (
            <div className="mt-4 space-y-2">
              {files.map((f, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-brand-600">📄</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{f.name}</p>
                      <p className="text-xs text-slate-400">{(f.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  </div>
                  {phase === "idle" && (
                    <button onClick={() => removeFile(i)} className="text-sm text-red-500 hover:text-red-700 shrink-0 ml-2">
                      Remove
                    </button>
                  )}
                </div>
              ))}
              {meta.multiple && phase === "idle" && (
                <p className="text-xs text-slate-400">Tip: files are processed in the order listed. Re-add them in the order you want.</p>
              )}
            </div>
          )}

          {meta.fields.length > 0 && (
            <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <h2 className="text-sm font-semibold text-slate-900">Options</h2>
              {meta.fields.map((f) => {
                // Hide ranges/every_n depending on split mode
                if (meta.key === "split" && f.name === "ranges" && params.mode === "every_n") return null;
                if (meta.key === "split" && f.name === "every_n" && params.mode !== "every_n") return null;
                return (
                  <FieldInput
                    key={f.name}
                    field={f}
                    value={params[f.name] || ""}
                    onChange={(v) => setParams((p) => ({ ...p, [f.name]: v }))}
                  />
                );
              })}
            </div>
          )}

          <div className="mt-6">
            {(phase === "uploading" || phase === "processing") && (
              <div className="mb-4">
                <div className="flex justify-between text-sm text-slate-600 mb-1">
                  <span>{statusText}</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}
            <button
              onClick={run}
              disabled={files.length === 0 || phase === "uploading" || phase === "processing"}
              className="w-full rounded-xl bg-brand-600 px-6 py-3.5 text-base font-semibold text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {phase === "uploading" ? "Uploading…" : phase === "processing" ? "Processing…" : `${meta.name} →`}
            </button>
            <p className="mt-3 text-xs text-center text-slate-400">{meta.outputHint}</p>
          </div>
        </>
      )}

      {phase === "done" && (job?.outputs?.length ?? 0) > 0 ? (
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-white text-xl">
            ✓
          </div>
          <h2 className="text-lg font-semibold text-slate-900">Your file is ready</h2>
          <p className="mt-1 text-sm text-slate-500">
            {(job?.outputs?.length ?? 0)} output file{(job?.outputs?.length ?? 0) > 1 ? "s" : ""} produced.
          </p>
          <div className="mt-5 flex flex-col sm:flex-row gap-3 justify-center">
            {(job?.outputs ?? []).map((out, i) => (
              <button
                key={out.file_id}
                onClick={() => handleDownload(out.file_id, i)}
                className="rounded-lg bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Download {(job?.outputs?.length ?? 0) > 1 ? `#${i + 1}` : "file"}
              </button>
            ))}
          </div>
          <button onClick={reset} className="mt-4 text-sm text-brand-700 hover:underline">
            Process another file
          </button>
        </div>
      ) : null}
    </div>
  );
}
// Note: This file exports the client-side ToolRunner component.
// The page wrapper with SEO metadata is in page.tsx.

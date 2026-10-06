"use client";

import { useEffect, useRef, useState } from "react";
import { api, ToolSpec, UploadedFile, Job } from "../lib/api";

type Phase = "pick" | "options" | "working" | "done";

export function ToolRunner({ toolKey }: { toolKey: string }) {
  const [spec, setSpec] = useState<ToolSpec | null>(null);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [options, setOptions] = useState<Record<string, unknown>>({});
  const [phase, setPhase] = useState<Phase>("pick");
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState<{ used: number; limit: number; remaining: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.tool(toolKey).then(setSpec).catch((e) => setError(String(e.message || e)));
    api.quota(toolKey).then(setQuota).catch(() => {});
  }, [toolKey]);

  const accept = spec
    ? spec.input_kinds.includes("image")
      ? "image/png,image/jpeg,image/webp"
      : "application/pdf,.pdf"
    : "";

  async function onPick(list: FileList | null) {
    if (!list || !spec) return;
    setError(null);
    const chosen = Array.from(list).slice(0, spec.max_files);
    if (files.length + chosen.length > spec.max_files) {
      setError(`This tool accepts at most ${spec.max_files} file(s).`);
      return;
    }
    setBusy(true);
    try {
      const uploaded: UploadedFile[] = [];
      for (const f of chosen) {
        const up = await api.upload(f);
        uploaded.push(up);
      }
      const all = [...files, ...uploaded];
      setFiles(all);
      if (spec.options.length === 0) {
        await startJob(all, options);
      } else {
        setPhase("options");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function startJob(currentFiles: UploadedFile[], opts: Record<string, unknown>) {
    if (!spec) return;
    if (currentFiles.length < spec.min_files) {
      setError(`Select at least ${spec.min_files} file(s).`);
      return;
    }
    setError(null);
    setBusy(true);
    setPhase("working");
    try {
      const j = await api.createJob(spec.key, currentFiles.map((f) => f.id), opts);
      setJob(j);
      setPhase("done");
      api.quota(spec.key).then(setQuota).catch(() => {});
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("options");
    } finally {
      setBusy(false);
    }
  }

  function setOpt(name: string, value: unknown) {
    setOptions((o) => ({ ...o, [name]: value }));
  }

  function reset() {
    setFiles([]);
    setOptions({});
    setJob(null);
    setError(null);
    setPhase("pick");
  }

  if (error && !spec) {
    return <p className="text-red-600">Failed to load tool: {error}</p>;
  }
  if (!spec) return <p className="text-slate-500">Loading…</p>;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-extrabold tracking-tight">{spec.name}</h1>
      <p className="mt-2 text-slate-600">{spec.description}</p>
      {quota && (
        <p className="mt-2 text-xs text-slate-500">
          {quota.remaining} of {quota.limit} free uses left this hour
        </p>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {phase === "pick" && (
        <div
          className="mt-6 cursor-pointer rounded-2xl border-2 border-dashed border-slate-300 bg-white px-6 py-14 text-center hover:border-brand-500"
          onClick={() => inputRef.current?.click()}
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
            {busy ? "Uploading…" : `Choose ${spec.input_kinds.includes("image") ? "image" : "PDF"} file(s)`}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Up to {spec.max_files} file(s), 4&nbsp;MB each. No sign-up needed.
          </p>
        </div>
      )}

      {files.length > 0 && (phase === "pick" || phase === "options") && (
        <ul className="mt-4 space-y-2">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between rounded-lg bg-slate-100 px-4 py-2 text-sm">
              <span className="truncate">{f.filename}</span>
              <span className="text-slate-500">{(f.size_bytes / 1024).toFixed(0)} KB</span>
            </li>
          ))}
        </ul>
      )}

      {phase === "options" && spec.options.length > 0 && (
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
            {busy ? "Processing…" : `${spec.name} now`}
          </button>
        </div>
      )}

      {phase === "done" && job && (
        <div className="mt-6 rounded-2xl bg-white p-6 text-center shadow-sm">
          {job.status === "succeeded" && job.output_file_id ? (
            <>
              <p className="text-lg font-semibold text-green-700">Done!</p>
              <a
                href={api.downloadUrl(job.output_file_id)}
                className="mt-4 inline-block rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-700"
              >
                Download result
              </a>
            </>
          ) : (
            <>
              <p className="text-lg font-semibold text-red-700">Processing failed</p>
              <p className="mt-2 text-sm text-slate-600">{job.error || "Unknown error"}</p>
            </>
          )}
          <button onClick={reset} className="mt-4 block w-full text-sm text-slate-500 hover:text-brand-600">
            Start over
          </button>
        </div>
      )}
    </div>
  );
}

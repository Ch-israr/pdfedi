// Job plumbing for canvas tools — upload, create job, poll, download.
// Mirrors ToolRunner's contract (800 ms poll, streamed download with
// %, quota refresh after completion) so canvas jobs behave exactly
// like the existing tools. Preview/render never creates a job, so it
// never consumes quota — quota is charged only on job creation.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Job, type ToolSpec, type UploadedFile } from "../../lib/api";

export type CanvasPhase =
  | "pick"
  | "uploading"
  | "organize"
  | "processing"
  | "completed"
  | "failed";

export type OrganizerJob = ReturnType<typeof useOrganizerJob>;

export function useOrganizerJob(toolKey: string) {
  const [spec, setSpec] = useState<ToolSpec | null>(null);
  const [specError, setSpecError] = useState<string | null>(null);
  const [phase, setPhase] = useState<CanvasPhase>("pick");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  const [quota, setQuota] = useState<{ used: number; limit: number; remaining: number } | null>(null);
  const [limits, setLimits] = useState<{ max_upload_mb: number; max_download_mb: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.tool(toolKey).then(setSpec).catch((e) => setSpecError(String(e.message || e)));
    api.quota(toolKey).then(setQuota).catch(() => {});
    api.limits().then(setLimits).catch(() => {});
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [toolKey]);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  const uploadFiles = useCallback(
    async (list: File[]): Promise<UploadedFile[]> => {
      if (!spec) throw new Error("Tool not loaded yet.");
      const maxBytes = (limits?.max_upload_mb ?? 50) * 1024 * 1024;
      const tooBig = list.find((f) => f.size > maxBytes);
      if (tooBig) {
        throw new Error(
          `"${tooBig.name}" exceeds the ${limits?.max_upload_mb ?? 50} MB upload limit.`,
        );
      }
      setError(null);
      setBusy(true);
      setPhase("uploading");
      try {
        const uploaded: UploadedFile[] = [];
        for (const f of list) uploaded.push(await api.upload(f));
        const all = [...files, ...uploaded];
        setFiles(all);
        // Phase stays "uploading": the caller promotes to "organize"
        // once the local pdf.js documents are ready, so the workspace
        // never renders an empty grid.
        return all;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("pick");
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [spec, limits, files],
  );

  const startJob = useCallback(
    async (orderedFiles: UploadedFile[], config: Record<string, unknown>) => {
      if (!spec) return;
      setError(null);
      setBusy(true);
      try {
        const j = await api.createJob(spec.key, orderedFiles.map((f) => f.id), config);
        setJob(j);
        setPhase("processing");
        const tick = async () => {
          try {
            const cur = await api.job(j.id);
            setJob(cur);
            if (cur.status === "succeeded") {
              stopPolling();
              api.quota(toolKey).then(setQuota).catch(() => {});
              setPhase("completed");
            } else if (cur.status === "failed" || cur.status === "cancelled") {
              stopPolling();
              setError(cur.error || "Processing failed. Please try again.");
              setPhase("failed");
            }
          } catch (e) {
            stopPolling();
            setError(e instanceof Error ? e.message : "Lost contact with the server.");
            setPhase("failed");
          }
        };
        await tick();
        pollRef.current = setInterval(tick, 800);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        api.quota(toolKey).then(setQuota).catch(() => {});
        setPhase("organize");
      } finally {
        setBusy(false);
      }
    },
    [spec, toolKey],
  );

  const download = useCallback(async () => {
    if (!job?.output_file_id || !spec) return;
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
      a.download = `${spec.key}_output.${spec.output_ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setDownloadPct(null);
    }
  }, [job, spec]);

  const reset = useCallback(() => {
    stopPolling();
    setFiles([]);
    setJob(null);
    setError(null);
    setPhase("pick");
  }, []);

  const removeUploaded = useCallback((id: string) => {
    setFiles((fs) => fs.filter((f) => f.id !== id));
  }, []);

  return {
    spec,
    specError,
    phase,
    setPhase,
    files,
    setFiles,
    job,
    error,
    setError,
    busy,
    downloadPct,
    quota,
    limits,
    uploadFiles,
    startJob,
    download,
    reset,
    removeUploaded,
  };
}

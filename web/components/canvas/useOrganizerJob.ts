// Job plumbing for canvas tools — upload, create job, poll, download.
// Mirrors ToolRunner's contract (800 ms poll, streamed download with
// %, quota refresh after completion) so canvas jobs behave exactly
// like the existing tools. Preview/render never creates a job, so it
// never consumes quota — quota is charged only on job creation.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, api, type Job, type ToolSpec, type UploadedFile } from "../../lib/api";
import {
  POLL_BASE_MS,
  POLL_FAIL_WINDOW_MS,
  isQuotaError,
  nextPollDelayMs,
} from "../../lib/polling";

export type CanvasPhase =
  | "pick"
  | "uploading"
  | "organize"
  | "processing"
  | "completed"
  | "failed";

export type OrganizerJob = ReturnType<typeof useOrganizerJob>;

// The server resets quota windows on the clock hour.
function quotaResetTime(): string {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return `${String(d.getHours()).padStart(2, "0")}:00`;
}

export function useOrganizerJob(toolKey: string) {
  const tErr = useTranslations("errors");
  const tRunner = useTranslations("runner");

  // Translate an API failure by stable code; fall back to the English
  // message only when no code is available (e.g. a network failure).
  // Only a 429 carrying the backend's `quota_exceeded` code is a real
  // quota error — a bare 429 (proxy / upstream rate limit, no code)
  // is transient, so it gets the temporary-error message instead of
  // the quota message. See web/lib/polling.ts.
  function resolveError(e: unknown): string {
    if (e instanceof ApiError) {
      if (isQuotaError(e)) return tErr("quota_exceeded", { time: quotaResetTime() });
      if (e.code && tErr.has(e.code)) return tErr(e.code);
      if (e.status === 429) return tErr("temporary_error");
      return e.message;
    }
    return e instanceof Error ? e.message : String(e);
  }

  // Translate a failed job: prefer the backend error code.
  function jobError(j: Job): string {
    if (j.error_code && tErr.has(j.error_code)) return tErr(j.error_code);
    return j.error || tErr("internal_error");
  }
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
  // Transient poll note ("still checking…") shown while the poller
  // rides out a blip; cleared on the next successful poll. Distinct
  // from `error`, which is a terminal failure.
  const [transientNotice, setTransientNotice] = useState<string | null>(null);
  // Milliseconds the current job has spent queued (from job.created_at),
  // shown as a waiting line while the job waits for a free slot.
  const [queueWaitMs, setQueueWaitMs] = useState<number | null>(null);
  // setTimeout chain (not setInterval): the next poll is scheduled
  // after each tick, so the gap can back off after failures.
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Consecutive failed polls + when the current failure streak began.
  const pollFailuresRef = useRef(0);
  const firstFailureAtRef = useRef<number | null>(null);

  useEffect(() => {
    api.tool(toolKey).then(setSpec).catch((e) => setSpecError(String(e.message || e)));
    api.quota(toolKey).then(setQuota).catch(() => {});
    api.limits().then(setLimits).catch(() => {});
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [toolKey]);

  function stopPolling() {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    pollFailuresRef.current = 0;
    firstFailureAtRef.current = null;
  }

  // Mirror of `files` for async upload callbacks. `uploadFiles` must not
  // close over the `files` state: OrganizerTool's pick handler is created
  // before the first upload completes, so a stale closure would drop
  // earlier files when a second batch is added ("Uploading to server…"
  // forever, with job.files shorter than localFiles). The ref is always
  // current, so sequential adds accumulate correctly.
  const filesRef = useRef<UploadedFile[]>([]);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const uploadFiles = useCallback(
    async (list: File[]): Promise<UploadedFile[]> => {
      if (!spec) throw new Error(tErr("not_loaded"));
      const maxBytes = (limits?.max_upload_mb ?? 50) * 1024 * 1024;
      const tooBig = list.find((f) => f.size > maxBytes);
      if (tooBig) {
        throw new Error(
          tRunner("tooBig", { name: tooBig.name, mb: limits?.max_upload_mb ?? 50 }),
        );
      }
      setError(null);
      setBusy(true);
      setPhase("uploading");
      try {
        const uploaded: UploadedFile[] = [];
        for (const f of list) uploaded.push(await api.upload(f));
        const all = [...filesRef.current, ...uploaded];
        filesRef.current = all;
        setFiles(all);
        // Phase stays "uploading": the caller promotes to "organize"
        // once the local pdf.js documents are ready, so the workspace
        // never renders an empty grid.
        return all;
      } catch (e) {
        setError(resolveError(e));
        setPhase("pick");
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [spec, limits],
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
        // Poll with backoff: a failed poll never stops the poller
        // outright. Transient failures (e.g. a bare 429 from the
        // proxy) show a temporary note and retry with exponential
        // backoff; only a sustained failure window
        // (POLL_FAIL_WINDOW_MS) ends the job with a hard error.
        // A coded quota error is terminal — but quota is charged at
        // job creation, so it should not occur while polling.
        stopPolling();
        setTransientNotice(null);
        setQueueWaitMs(null);
        const schedule = (delay: number) => {
          pollRef.current = setTimeout(tick, delay);
        };
        const tick = async () => {
          try {
            const cur = await api.job(j.id);
            // Success resets the failure streak and clears the note.
            pollFailuresRef.current = 0;
            firstFailureAtRef.current = null;
            setTransientNotice(null);
            setJob(cur);
            if (cur.status === "queued") {
              setQueueWaitMs(Date.now() - Date.parse(cur.created_at));
              schedule(POLL_BASE_MS);
            } else if (cur.status === "running") {
              setQueueWaitMs(null);
              schedule(POLL_BASE_MS);
            } else if (cur.status === "succeeded") {
              stopPolling();
              api.quota(toolKey).then(setQuota).catch(() => {});
              setPhase("completed");
            } else if (cur.status === "failed" || cur.status === "cancelled") {
              stopPolling();
              setError(jobError(cur));
              setPhase("failed");
            }
          } catch (e) {
            if (isQuotaError(e)) {
              stopPolling();
              setError(resolveError(e));
              setPhase("failed");
              return;
            }
            pollFailuresRef.current += 1;
            const now = Date.now();
            if (firstFailureAtRef.current === null) firstFailureAtRef.current = now;
            if (now - firstFailureAtRef.current >= POLL_FAIL_WINDOW_MS) {
              stopPolling();
              setTransientNotice(null);
              setError(tErr("connection_lost"));
              setPhase("failed");
              return;
            }
            setTransientNotice(tRunner("stillChecking"));
            schedule(nextPollDelayMs(pollFailuresRef.current));
          }
        };
        await tick();
      } catch (e) {
        setError(resolveError(e));
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
      a.download = `${spec.key}_output.${spec.output_ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : tErr("download_failed"));
    } finally {
      setDownloadPct(null);
    }
  }, [job, spec]);

  const reset = useCallback(() => {
    stopPolling();
    filesRef.current = [];
    setFiles([]);
    setJob(null);
    setError(null);
    setTransientNotice(null);
    setQueueWaitMs(null);
    setPhase("pick");
  }, []);

  const removeUploaded = useCallback((id: string) => {
    filesRef.current = filesRef.current.filter((f) => f.id !== id);
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
    transientNotice,
    queueWaitMs,
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

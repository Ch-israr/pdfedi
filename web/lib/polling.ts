// Shared job-polling helpers for ToolRunner and useOrganizerJob.
//
// The quota-stall bug (2026-11-24, diagnosed 2026-11-25): the page
// showed "You have used all free uses for this hour" on ANY HTTP 429,
// not just a real quota error, and the poller stopped on the first
// failed poll — so a transient 429 during the 400 ms status polling
// stranded the job for 10–13 minutes. Two rules fix it:
//
// 1. Only a 429 that carries the backend's `quota_exceeded` error code
//    is a real quota error. The backend already returns that code
//    (jobs.py raises UploadError with code="quota_exceeded"; the API
//    returns it as structured detail and lib/api parses it into
//    ApiError.code). A 429 without the code is a transient upstream /
//    proxy error: show a temporary note and keep polling.
// 2. A failed poll never stops the poller outright. Polls retry with
//    exponential backoff and only give up after a sustained failure
//    window (POLL_FAIL_WINDOW_MS), so a blip never strands a job.
import { ApiError } from "./api";

/** Base poll interval (ms) while a job is queued or running. */
export const POLL_BASE_MS = 400;
/** Longest gap (ms) between retries after repeated failures. */
export const POLL_MAX_DELAY_MS = 5000;
/** How long consecutive poll failures are tolerated before the poller
 * gives up and reports a hard error (ms). */
export const POLL_FAIL_WINDOW_MS = 30000;

/** True only for a real quota error: HTTP 429 carrying the backend's
 * `quota_exceeded` code. A bare 429 (no code — e.g. a proxy or
 * upstream rate limit) is transient, not a spent quota. */
export function isQuotaError(e: unknown): boolean {
  return e instanceof ApiError && e.code === "quota_exceeded";
}

/** Backoff delay (ms) after `consecutiveFailures` failed polls in a
 * row: 400 → 800 → 1600 → 3200 → 5000 (capped). */
export function nextPollDelayMs(consecutiveFailures: number): number {
  return Math.min(POLL_BASE_MS * 2 ** Math.max(0, consecutiveFailures), POLL_MAX_DELAY_MS);
}

/** Human-readable elapsed wait ("45s", "2m 10s") for the queue-wait
 * line. Kept as one plain string so every locale renders it the same
 * way without ICU plural rules. */
export function formatWait(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

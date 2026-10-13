'use client';

/**
 * Destructive-action confirm shown when downloading with redaction
 * regions present. Redacted text is permanently removed from the file —
 * this cannot be undone after download.
 */
export function RedactConfirmDialog({
  count,
  onCancel,
  onConfirm,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="redact-confirm-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="redact-confirm-title" className="text-base font-semibold text-slate-900">
          Apply {count} redaction{count === 1 ? '' : 's'}?
        </h2>
        <div className="mt-3 space-y-2 text-sm leading-relaxed text-slate-600">
          <p>
            Text under the redaction {count === 1 ? 'region' : 'regions'} will be{' '}
            <strong className="text-slate-900">permanently removed</strong> from the
            downloaded PDF. This cannot be undone after download.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-[13px]">
            <li>Whole text runs touched by a rectangle are removed.</li>
            <li>Images and vector graphics under the rectangle are covered, not removed.</li>
            <li>You can still undo or adjust redactions before downloading.</li>
          </ul>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Apply &amp; Download
          </button>
        </div>
      </div>
    </div>
  );
}

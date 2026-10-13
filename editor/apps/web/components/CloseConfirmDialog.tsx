'use client';

/**
 * Confirm dialog shown when closing the editor with unsaved changes.
 * Never shown when there's nothing to lose (caller checks dirtiness).
 */
export function CloseConfirmDialog({
  onSaveDownload,
  onDiscard,
  onCancel,
}: {
  onSaveDownload: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="close-confirm-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="close-confirm-title" className="text-base font-semibold text-slate-900">
          Unsaved changes
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          You have unsaved changes in this document. Download them as a PDF,
          discard them, or keep editing.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onSaveDownload}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            Save &amp; download
          </button>
        </div>
      </div>
    </div>
  );
}

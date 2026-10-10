'use client';

/**
 * One-time warning shown when the user attempts to edit existing page
 * content that cannot be edited directly (scanned/flattened PDF).
 * Shown at most once per document editing session.
 */
export function NativeEditWarning({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="native-edit-warning-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="native-edit-warning-title"
          className="text-lg font-semibold text-slate-900"
        >
          Existing Text Cannot Be Edited Directly
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          This page appears to contain scanned or flattened content. Its
          existing text cannot be edited directly. You can still add your own
          text, images, signatures, and other supported objects.
        </p>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="rounded-lg bg-brand-500 px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            Understood
          </button>
        </div>
      </div>
    </div>
  );
}

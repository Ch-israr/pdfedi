'use client';

/**
 * DevFooter — temporary placeholder footer for standalone development.
 * Minimal and unobtrusive. Remove entirely when mounting EditorContent
 * inside the real production layout.
 */
export function DevFooter() {
  return (
    <footer className="pdfeditor-dev flex h-10 shrink-0 items-center justify-center border-t border-slate-200 bg-white px-4">
      <p className="text-xs text-slate-400">
        Dev preview footer — placeholder only · Files stay in your browser
      </p>
    </footer>
  );
}

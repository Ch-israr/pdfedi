'use client';

/**
 * DevHeader — temporary placeholder header for standalone development.
 * Simulates a production website header. Remove entirely when mounting
 * EditorContent inside the real production layout.
 */
export function DevHeader() {
  return (
    <header className="pdfeditor-dev flex h-14 shrink-0 items-center gap-6 border-b border-slate-200 bg-white px-4 sm:px-6">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-lg font-bold text-white">
          P
        </div>
        <span className="text-sm font-semibold text-slate-800">PDFEditor <span className="font-normal text-slate-400">· dev</span></span>
      </div>
      <nav className="hidden items-center gap-4 text-sm text-slate-500 md:flex" aria-label="Placeholder navigation">
        <span className="cursor-default rounded px-2 py-1 hover:bg-slate-100">Tools</span>
        <span className="cursor-default rounded px-2 py-1 hover:bg-slate-100">Pricing</span>
        <span className="cursor-default rounded px-2 py-1 hover:bg-slate-100">Help</span>
      </nav>
      <div className="ml-auto hidden items-center gap-2 sm:flex">
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
          Dev preview — header is a placeholder
        </span>
      </div>
    </header>
  );
}

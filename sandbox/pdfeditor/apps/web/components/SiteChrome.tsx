'use client';

/**
 * SiteChrome — the real PDFEDI website header/footer, replicated for the
 * integrated /editor build. Source of truth: web/components/chrome.tsx
 * in the main site. Plain <a> tags (not next/link) so links escape the
 * /editor basePath and land on the real site root.
 */

export function SiteHeader() {
  return (
    <header className="border-b border-slate-200 bg-white shadow-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <a href="/" className="text-xl font-extrabold tracking-tight text-brand-600">
          PDFEDI
        </a>
        <nav className="flex items-center gap-4 text-sm text-slate-600">
          <a href="/" className="hover:text-brand-600">
            All tools
          </a>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-slate-500">
        <p className="font-semibold text-slate-700">PDFEDI — free online PDF tools.</p>
        <p className="mt-1">No sign-up. Files are processed and deleted automatically.</p>
      </div>
    </footer>
  );
}

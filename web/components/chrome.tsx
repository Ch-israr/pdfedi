import Link from "next/link";

export function Header() {
  return (
    <header className="border-b border-slate-200 bg-white shadow-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <img src="/logo.png" alt="PDFEDI logo" className="h-9 w-9 rounded-lg" />
          <span className="text-xl font-extrabold tracking-tight text-brand-600">
            PDFEDI
          </span>
        </Link>
        <nav className="flex items-center gap-4 text-sm text-slate-600">
          <Link href="/" className="hover:text-brand-600">All tools</Link>
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-slate-500">
        <p className="flex items-center gap-2 font-semibold text-slate-700">
          <img src="/logo.png" alt="PDFEDI logo" className="h-8 w-8 rounded-md" />
          PDFEDI — free online PDF tools.
        </p>
        <p className="mt-1">No sign-up. Files are processed and deleted automatically.</p>
      </div>
    </footer>
  );
}

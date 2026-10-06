import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2">
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white font-bold">
                P
              </span>
              <span className="text-lg font-bold text-slate-900">
                PDF<span className="text-brand-600">EDI</span>
              </span>
            </div>
            <p className="text-sm text-slate-500 max-w-xs">
              Professional PDF tools in your browser. Merge, split, compress, convert and more — fast and
              secure.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Product</h3>
            <ul className="space-y-2 text-sm text-slate-500">
              <li><Link href="/pricing" className="hover:text-brand-600">Pricing</Link></li>
              <li><Link href="/dashboard" className="hover:text-brand-600">Dashboard</Link></li>
              <li><Link href="/files" className="hover:text-brand-600">My files</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Account</h3>
            <ul className="space-y-2 text-sm text-slate-500">
              <li><Link href="/tools/merge" className="hover:text-brand-600">Tools</Link></li>
              <li><Link href="/register" className="hover:text-brand-600">Create account</Link></li>
              <li><Link href="/account" className="hover:text-brand-600">Settings</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-10 pt-6 border-t border-slate-200 text-sm text-slate-400">
          © {new Date().getFullYear()} PDFEDI. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

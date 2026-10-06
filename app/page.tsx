import Link from "next/link";
import { TOOLS, TOOL_CATEGORIES } from "@/lib/tools";

export default function LandingPage() {
  return (
    <div>
      {/* Hero */}
      <section className="bg-slate-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-brand-100 px-4 py-1.5 text-sm font-medium text-brand-800 mb-6">
            <span className="h-2 w-2 rounded-full bg-brand-500" />
            14 professional PDF tools — free to start
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900">
            Every PDF tool you need,
            <span className="text-brand-600"> right in your browser</span>
          </h1>
          <p className="mt-6 text-lg text-slate-500 max-w-2xl mx-auto">
            Merge, split, compress, convert, OCR and protect your PDFs. No software to install, no
            watermarks on free files, your documents stay private.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/register"
              className="px-8 py-3 text-base font-semibold text-white bg-brand-600 rounded-xl hover:bg-brand-700 shadow-sm"
            >
              Start for free
            </Link>
            <a
              href="#tools"
              className="px-8 py-3 text-base font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:border-brand-400"
            >
              Browse tools
            </a>
          </div>
        </div>
      </section>

      {/* Tools grid */}
      <section id="tools" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h2 className="text-3xl font-bold text-slate-900 text-center">Popular PDF tools</h2>
        <p className="mt-3 text-slate-500 text-center max-w-xl mx-auto">
          Pick a tool, upload your file, and download the result in seconds.
        </p>
        {TOOL_CATEGORIES.map((cat) => {
          const catTools = TOOLS.filter((t) => t.category === cat);
          if (catTools.length === 0) return null;
          return (
            <div key={cat} className="mt-10">
              <h3 className="text-lg font-semibold text-slate-800 mb-4">{cat}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {catTools.map((t) => (
                  <Link
                    key={t.key}
                    href={`/tools/${t.key}`}
                    className="group rounded-xl border border-slate-200 bg-white p-5 hover:border-brand-400 hover:shadow-md transition-all"
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-100 text-xl text-brand-700 mb-4 group-hover:bg-brand-600 group-hover:text-white transition-colors">
                      {t.icon}
                    </div>
                    <h3 className="font-semibold text-slate-900">{t.name}</h3>
                    <p className="mt-1 text-sm text-slate-500 line-clamp-2">{t.description}</p>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {/* Features */}
      <section className="bg-slate-50 border-y border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h2 className="text-3xl font-bold text-slate-900 text-center">Why PDFEDI?</h2>
          <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { title: "Private by design", text: "Files are processed securely and automatically deleted. Your documents are never shared or used for anything else." },
              { title: "No installs", text: "Everything runs in your browser against our fast cloud API. Works on Windows, Mac, Linux, phones and tablets." },
              { title: "Built for teams", text: "Admin controls, audit logs, usage analytics and role-based access for organisations of any size." },
            ].map((f) => (
              <div key={f.title} className="rounded-xl bg-white border border-slate-200 p-6">
                <h3 className="font-semibold text-slate-900 text-lg">{f.title}</h3>
                <p className="mt-2 text-sm text-slate-500">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h2 className="text-3xl font-bold text-slate-900">Simple, honest pricing</h2>
        <p className="mt-3 text-slate-500 max-w-xl mx-auto">
          Start free with generous limits. Upgrade when you need more power.
        </p>
        <Link
          href="/pricing"
          className="mt-6 inline-block px-8 py-3 text-base font-semibold text-white bg-brand-600 rounded-xl hover:bg-brand-700"
        >
          See plans
        </Link>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <h2 className="text-2xl font-bold text-slate-900 text-center mb-8">Frequently asked questions</h2>
        <div className="space-y-4">
          {[
            { q: "Is PDFEDI free?", a: "Yes — the free plan covers everyday PDF tasks with generous limits. Paid plans add higher limits, priority processing and team features." },
            { q: "Are my files safe?", a: "Files are transferred over encrypted connections, processed in isolated jobs, and deleted automatically after a retention period. We never share your documents." },
            { q: "Do I need to install anything?", a: "No. PDFEDI runs entirely in your browser. Upload a file, pick a tool, download the result." },
            { q: "What is the maximum file size?", a: "The free plan supports files up to 200 MB. Paid plans raise this further." },
          ].map((f) => (
            <details key={f.q} className="rounded-xl border border-slate-200 bg-white p-5 group">
              <summary className="font-medium text-slate-900 cursor-pointer">{f.q}</summary>
              <p className="mt-2 text-sm text-slate-500">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

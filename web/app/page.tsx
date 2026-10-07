import Link from "next/link";
import { CATEGORIES, TOOL_CARDS } from "../lib/tools";

export default function Home() {
  return (
    <div>
      <section className="py-10 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
          Every PDF tool you need.
          <span className="text-brand-600"> Free.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
          Merge, split, compress, convert, protect and more — right in your browser.
          No sign-up, no watermarks.
        </p>
      </section>

      {CATEGORIES.map((cat) => {
        const tools = TOOL_CARDS.filter((t) => t.category === cat.key);
        if (tools.length === 0) return null;
        return (
          <section key={cat.key} className="mt-10 first:mt-4">
            <div className="mb-4 flex items-center gap-3">
              <span className="text-2xl">{cat.icon}</span>
              <div>
                <h2 className="text-xl font-bold tracking-tight">{cat.name}</h2>
                <p className="text-sm text-slate-500">{cat.tagline}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {tools.map((t) => (
                <Link
                  key={t.key}
                  href={`/tools/${t.key}`}
                  className="group rounded-2xl bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="text-3xl">{t.icon}</div>
                  <div className="mt-3 font-semibold group-hover:text-brand-600">{t.name}</div>
                  <div className="mt-1 text-sm text-slate-500">{t.tagline}</div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      <section className="mx-auto mt-16 max-w-3xl text-center text-sm text-slate-500">
        <h2 className="text-xl font-bold text-slate-800">Private by design</h2>
        <p className="mt-2">
          Files are processed on our servers and deleted automatically. We never ask for
          an account — just pick a tool and go.
        </p>
      </section>
    </div>
  );
}

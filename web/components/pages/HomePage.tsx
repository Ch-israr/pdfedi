// Shared homepage — one component, rendered in every locale.
// Display strings come from messages (tools/categories/home namespaces);
// structure (slugs, icons, categories) comes from lib/tools.ts.
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CATEGORIES, TOOL_CARDS } from "../../lib/tools";
import { toLocalePath, type LocaleSegment } from "../../i18n/routing";

export async function HomePage({ locale }: { locale: LocaleSegment }) {
  const tHome = await getTranslations({ locale, namespace: "home" });
  const tTools = await getTranslations({ locale, namespace: "tools" });
  const tCats = await getTranslations({ locale, namespace: "categories" });

  return (
    <div>
      <section className="py-10 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
          {tHome("heroTitle")}
          <span className="text-brand-600"> {tHome("heroAccent")}</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
          {tHome("heroSubtitle")}
        </p>
      </section>

      {CATEGORIES.map((cat) => {
        const tools = TOOL_CARDS.filter((t) => t.category === cat.key);
        if (tools.length === 0) return null;
        const catName = tCats(`${cat.key}.name`);
        const catTag = tCats(`${cat.key}.tagline`);
        return (
          <section key={cat.key} className="mt-10 first:mt-4">
            <div className="mb-4 flex items-center gap-3">
              <span className="text-2xl">{cat.icon}</span>
              <div>
                <h2 className="text-xl font-bold tracking-tight">{catName}</h2>
                <p className="text-sm text-slate-500">{catTag}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {tools.map((t) => (
                <Link
                  key={t.key}
                  href={toLocalePath(`/tools/${t.key}`, locale)}
                  // PERF: no RSC prefetch — each prefetch carries the full
                  // next-intl messages object (~184 KB × 34 cards ≈ 2 MB
                  // on the homepage). Navigation fetches on click instead.
                  prefetch={false}
                  className="group rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <div className="flex items-center gap-3.5">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[20px]">
                      {t.icon}
                    </span>
                    <span className="text-[17px] font-bold tracking-tight text-slate-800 group-hover:text-brand-600">
                      {tTools(`${t.key}.name`)}
                    </span>
                  </div>
                  <p className="mt-3.5 text-sm leading-relaxed text-slate-500">
                    {tTools(`${t.key}.tagline`)}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      <section className="mx-auto mt-16 max-w-3xl text-center text-sm text-slate-500">
        <h2 className="text-xl font-bold text-slate-800">{tHome("privateTitle")}</h2>
        <p className="mt-2">
          {tHome("privateText")}{" "}
          <Link
            href={toLocalePath("/how-we-handle-files", locale)}
            prefetch={false}
            className="font-semibold text-brand-600 hover:text-brand-700"
          >
            {tHome("privateLink")}
          </Link>
        </p>
      </section>

      <section className="mx-auto mt-10 max-w-3xl rounded-2xl bg-white p-6 text-center shadow-sm">
        <h2 className="text-xl font-bold text-slate-800">⚖️ {tHome("lawyersTitle")}</h2>
        <p className="mt-2 text-sm text-slate-500">{tHome("lawyersText")}</p>
        <Link
          href={toLocalePath("/lawyers", locale)}
          prefetch={false}
          className="mt-4 inline-block rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-700"
        >
          {tHome("lawyersCta")}
        </Link>
      </section>
    </div>
  );
}

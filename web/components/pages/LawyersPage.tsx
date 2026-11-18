// Shared "For lawyers" page — one component, rendered in every locale.
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { toLocalePath, type LocaleSegment } from "../../i18n/routing";

export async function LawyersPage({ locale }: { locale: LocaleSegment }) {
  const t = await getTranslations({ locale, namespace: "lawyers" });
  const workflow = t.raw("workflow") as Array<{ step: string; text: string }>;
  const guides = t.raw("guides") as Array<{
    title: string;
    answer: string;
    tool: string;
    toolName: string;
  }>;
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t("title")}</h1>
      <p className="mt-4 text-lg text-slate-600">{t("intro")}</p>

      <section className="mt-10">
        <h2 className="text-xl font-bold">{t("workflowTitle")}</h2>
        <ol className="mt-4 list-decimal space-y-2 ps-6 text-slate-700">
          {workflow.map((w, i) => (
            <li key={i}>
              <strong>{w.step}</strong> {w.text}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-12 space-y-8">
        {guides.map((g) => (
          <article key={g.title}>
            <h2 className="text-xl font-bold tracking-tight">{g.title}</h2>
            <p className="mt-2 leading-relaxed text-slate-600">{g.answer}</p>
            <Link
              href={toLocalePath(g.tool, locale)}
              className="mt-2 inline-block font-semibold text-brand-600 hover:text-brand-700"
            >
              {g.toolName} →
            </Link>
          </article>
        ))}
      </section>

      <section className="mt-12 rounded-2xl bg-slate-100 p-6 text-sm text-slate-600">
        <h2 className="font-bold text-slate-800">{t("limitsTitle")}</h2>
        <p className="mt-2">
          {t.rich("limitsText", {
            link: (chunks) => (
              <Link
                href={toLocalePath("/how-we-handle-files", locale)}
                className="font-semibold text-brand-600 hover:text-brand-700"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      </section>
    </div>
  );
}

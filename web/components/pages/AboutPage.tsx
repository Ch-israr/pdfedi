// Shared About page — one component, rendered in every locale.
// Facts only: 26 free tools, 10 languages, no sign-up; server-side
// processing (files uploaded, processed, removed after processing).
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { toLocalePath, type LocaleSegment } from "../../i18n/routing";

export async function AboutPage({ locale }: { locale: LocaleSegment }) {
  const t = await getTranslations({ locale, namespace: "aboutPage" });
  const whatPoints = t.raw("whatPoints") as string[];
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t("title")}</h1>
      <p className="mt-4 text-lg text-slate-600">{t("intro")}</p>

      <section className="mt-10">
        <h2 className="text-xl font-bold">{t("whatTitle")}</h2>
        <ul className="mt-4 list-disc space-y-2 ps-6 text-slate-700">
          {whatPoints.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold">{t("howTitle")}</h2>
        <p className="mt-2 leading-relaxed text-slate-600">{t("howText")}</p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold">{t("freeTitle")}</h2>
        <p className="mt-2 leading-relaxed text-slate-600">{t("freeText")}</p>
        <p className="mt-6">
          <Link
            href={toLocalePath("/", locale)}
            className="font-semibold text-brand-600 hover:text-brand-700"
          >
            {t("backLink")}
          </Link>
        </p>
      </section>
    </div>
  );
}

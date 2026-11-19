// Shared Terms of Service page — one component, rendered in every locale.
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { toLocalePath, type LocaleSegment } from "../../i18n/routing";

export async function TermsPage({ locale }: { locale: LocaleSegment }) {
  const t = await getTranslations({ locale, namespace: "termsPage" });
  const usePoints = t.raw("usePoints") as string[];
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t("title")}</h1>
      <p className="mt-4 text-lg text-slate-600">{t("intro")}</p>

      <section className="mt-10">
        <h2 className="text-xl font-bold">{t("useTitle")}</h2>
        <ul className="mt-4 list-disc space-y-2 ps-6 text-slate-700">
          {usePoints.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold">{t("serviceTitle")}</h2>
        <p className="mt-2 leading-relaxed text-slate-600">{t("serviceText")}</p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold">{t("filesTitle")}</h2>
        <p className="mt-2 leading-relaxed text-slate-600">{t("filesText")}</p>
        <p className="mt-6">
          <Link
            href={toLocalePath("/", locale)}
            className="font-semibold text-brand-600 hover:text-brand-700"
          >
            {t("backLink")}
          </Link>
        </p>
        <p className="mt-6 text-xs text-slate-400">{t("updated")}</p>
      </section>
    </div>
  );
}

// Shared Privacy Policy page — one component, rendered in every locale.
// Honest copy (verified against backend/pdfedi/jobs.py, tools/base.py and
// storage.py): files are uploaded to the server for processing; each job's
// temporary workdir is deleted after the job (ctx.cleanup()); uploads are
// stored server-side under STORAGE_DIR. No retention TTL was found in the
// code, so no deletion timeframe is claimed anywhere on this page.
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { toLocalePath, type LocaleSegment } from "../../i18n/routing";

export async function PrivacyPolicyPage({ locale }: { locale: LocaleSegment }) {
  const t = await getTranslations({ locale, namespace: "privacyPage" });
  const uploadPoints = t.raw("uploadPoints") as string[];
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t("title")}</h1>
      <p className="mt-4 text-lg text-slate-600">{t("intro")}</p>

      <section className="mt-10">
        <h2 className="text-xl font-bold">{t("uploadTitle")}</h2>
        <p className="mt-2 leading-relaxed text-slate-600">{t("uploadText")}</p>
        <ul className="mt-4 list-disc space-y-2 ps-6 text-slate-700">
          {uploadPoints.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold">{t("dataTitle")}</h2>
        <p className="mt-2 leading-relaxed text-slate-600">{t("dataText")}</p>
      </section>

      <section className="mt-10">
        <p className="leading-relaxed text-slate-600">
          {t.rich("contactText", {
            link: (chunks) => (
              <Link
                href={toLocalePath("/contact", locale)}
                className="font-semibold text-brand-600 hover:text-brand-700"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
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

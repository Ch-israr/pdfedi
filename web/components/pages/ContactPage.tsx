// Shared Contact page — one component, rendered in every locale.
// There is no business email yet: the page says the business email will
// be listed soon (same wording as the TwitterDown contact page) and does
// NOT invent an address.
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { toLocalePath, type LocaleSegment } from "../../i18n/routing";

export async function ContactPage({ locale }: { locale: LocaleSegment }) {
  const t = await getTranslations({ locale, namespace: "contactPage" });
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t("title")}</h1>
      <p className="mt-4 text-lg text-slate-600">{t("intro")}</p>

      <section className="mt-10 rounded-2xl bg-slate-100 p-6">
        <h2 className="font-bold text-slate-800">{t("emailTitle")}</h2>
        <p className="mt-2 text-slate-600">{t("emailText")}</p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold">{t("noteTitle")}</h2>
        <p className="mt-2 leading-relaxed text-slate-600">{t("noteText")}</p>
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

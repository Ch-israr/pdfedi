// Shared "How we handle your files" page — one component, rendered in
// every locale. NOTE: the old copy described an "in-browser PDF editor"
// that does not exist (the /editor route is a 404). That section was
// rewritten here as "Previews in your browser", describing what the
// organizer canvases actually do (thumbnails render locally; processing
// is server-side). The fix is in the English source strings, so it ships
// in all 10 languages instead of translating a false claim.
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { toLocalePath, type LocaleSegment } from "../../i18n/routing";

export async function PrivacyPage({ locale }: { locale: LocaleSegment }) {
  const t = await getTranslations({ locale, namespace: "privacy" });
  const serverPoints = t.raw("serverPoints") as string[];
  const checkPoints = t.raw("checkPoints") as Array<{ title: string; text: string }>;
  const dontPoints = t.raw("dontPoints") as string[];
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t("title")}</h1>
      <p className="mt-4 text-lg text-slate-600">{t("intro")}</p>

      <section className="mt-10">
        <h2 className="text-xl font-bold">{t("serverTitle")}</h2>
        <p className="mt-2 leading-relaxed text-slate-600">{t("serverText")}</p>
        <ul className="mt-4 list-disc space-y-2 ps-6 text-slate-700">
          {serverPoints.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
        <p className="mt-4 leading-relaxed text-slate-600">{t("serverNote")}</p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold">{t("previewTitle")}</h2>
        <p className="mt-2 leading-relaxed text-slate-600">{t("previewText")}</p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold">{t("checkTitle")}</h2>
        <ul className="mt-4 list-disc space-y-2 ps-6 text-slate-700">
          {checkPoints.map((c, i) => (
            <li key={i}>
              <strong>{c.title}</strong> {c.text}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold">{t("dontTitle")}</h2>
        <ul className="mt-4 list-disc space-y-2 ps-6 text-slate-700">
          {dontPoints.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
        <p className="mt-6">
          <Link
            href={toLocalePath("/", locale)}
            className="font-semibold text-brand-600 hover:text-brand-700"
          >
            {t("backLink")}
          </Link>
        </p>
        <p className="mt-6 text-xs text-slate-400">{t("localeNote")}</p>
      </section>
    </div>
  );
}

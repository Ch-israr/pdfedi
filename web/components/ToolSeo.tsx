// SEO content sections rendered below the interactive tool UI.
// Content comes from the toolContent messages namespace; section
// headings come from the seo namespace; links are locale-aware.
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { TOOL_CARDS } from "../lib/tools";
import { BASE_URL, toLocalePath, type LocaleSegment } from "../i18n/routing";

export interface ToolFaqData {
  q: string;
  a: string;
}

export interface ToolContentData {
  title: string;
  description: string;
  h1: string;
  intro: string;
  howTo: string[];
  features: string[];
  useCases: string[];
  faqs: ToolFaqData[];
  related: string[];
}

export async function ToolSeo({
  content,
  locale,
}: {
  content: ToolContentData;
  locale: LocaleSegment;
}) {
  const tSeo = await getTranslations({ locale, namespace: "seo" });
  const tTools = await getTranslations({ locale, namespace: "tools" });
  const cardByKey = Object.fromEntries(TOOL_CARDS.map((t) => [t.key, t]));
  const related = content.related
    .map((k) => cardByKey[k])
    .filter(Boolean)
    .slice(0, 4);

  return (
    <div className="mx-auto mt-14 max-w-3xl">
      <section>
        <h2 className="text-2xl font-bold tracking-tight">
          {tSeo("whatItDoes", { h1: content.h1 })}
        </h2>
        <p className="mt-3 leading-relaxed text-slate-600">{content.intro}</p>
      </section>

      <section className="mt-10">
        <h2 className="text-2xl font-bold tracking-tight">
          {tSeo("howToUse", { h1: content.h1 })}
        </h2>
        <ol className="mt-4 space-y-2.5">
          {content.howTo.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                {i + 1}
              </span>
              <span className="leading-relaxed text-slate-600">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10">
        <h2 className="text-2xl font-bold tracking-tight">{tSeo("keyFeatures")}</h2>
        <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {content.features.map((f, i) => (
            <li
              key={i}
              className="rounded-xl bg-white p-4 text-sm leading-relaxed text-slate-600 shadow-sm"
            >
              <span className="me-2 text-brand-600">✓</span>
              {f}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-2xl font-bold tracking-tight">
          {tSeo("whenToUse", { h1: content.h1 })}
        </h2>
        <ul className="mt-4 list-disc space-y-2 ps-5 leading-relaxed text-slate-600">
          {content.useCases.map((u, i) => (
            <li key={i}>{u}</li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-2xl font-bold tracking-tight">{tSeo("faq")}</h2>
        <div className="mt-4 space-y-3">
          {content.faqs.map((faq, i) => (
            <details key={i} className="group rounded-xl bg-white p-4 shadow-sm">
              <summary className="cursor-pointer font-semibold text-slate-800 marker:text-brand-600">
                {faq.q}
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{faq.a}</p>
            </details>
          ))}
        </div>
      </section>

      {related.length > 0 && (
        <section className="mt-10">
          <h2 className="text-2xl font-bold tracking-tight">{tSeo("relatedTools")}</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {related.map((t) => (
              <Link
                key={t.key}
                href={toLocalePath(`/tools/${t.key}`, locale)}
                className="rounded-xl bg-white p-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="text-2xl">{t.icon}</div>
                <div className="mt-2 text-sm font-semibold">
                  {tTools(`${t.key}.name`)}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-10 rounded-xl bg-slate-100 p-5 text-sm leading-relaxed text-slate-600">
        <h2 className="font-bold text-slate-800">{tSeo("privateByDesign")}</h2>
        <p className="mt-1">{tSeo("privateNote")}</p>
      </section>
    </div>
  );
}

/** JSON-LD structured data: WebApplication + FAQPage + BreadcrumbList. */
export async function ToolJsonLd({
  content,
  locale,
  slug,
}: {
  content: ToolContentData;
  locale: LocaleSegment;
  slug: string;
}) {
  const tSeo = await getTranslations({ locale, namespace: "seo" });
  const url = `${BASE_URL}${toLocalePath(`/tools/${slug}`, locale)}`;
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        name: `PDFEDI ${content.h1}`,
        url,
        applicationCategory: "UtilitiesApplication",
        operatingSystem: "Any",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        description: content.description,
        inLanguage: locale,
      },
      {
        "@type": "FAQPage",
        mainEntity: content.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.q,
          acceptedAnswer: { "@type": "Answer", text: faq.a },
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: tSeo("breadcrumbHome"),
            item: `${BASE_URL}${toLocalePath("/", locale)}`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: content.h1,
            item: url,
          },
        ],
      },
    ],
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

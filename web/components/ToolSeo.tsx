import Link from "next/link";
import { TOOL_CARDS } from "../lib/tools";
import { ToolContent } from "../lib/tool-content";

/** SEO content sections rendered below the interactive tool UI. */
export function ToolSeo({ content }: { content: ToolContent }) {
  const cardByKey = Object.fromEntries(TOOL_CARDS.map((t) => [t.key, t]));
  const related = content.related
    .map((k) => cardByKey[k])
    .filter(Boolean)
    .slice(0, 4);

  return (
    <div className="mx-auto mt-14 max-w-3xl">
      {/* Introduction */}
      <section>
        <h2 className="text-2xl font-bold tracking-tight">
          {content.h1} — what it does
        </h2>
        <p className="mt-3 leading-relaxed text-slate-600">{content.intro}</p>
      </section>

      {/* How to use */}
      <section className="mt-10">
        <h2 className="text-2xl font-bold tracking-tight">
          How to use {content.h1}
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

      {/* Features */}
      <section className="mt-10">
        <h2 className="text-2xl font-bold tracking-tight">Key features</h2>
        <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {content.features.map((f, i) => (
            <li
              key={i}
              className="rounded-xl bg-white p-4 text-sm leading-relaxed text-slate-600 shadow-sm"
            >
              <span className="mr-2 text-brand-600">✓</span>
              {f}
            </li>
          ))}
        </ul>
      </section>

      {/* Use cases */}
      <section className="mt-10">
        <h2 className="text-2xl font-bold tracking-tight">
          When to use {content.h1}
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed text-slate-600">
          {content.useCases.map((u, i) => (
            <li key={i}>{u}</li>
          ))}
        </ul>
      </section>

      {/* FAQ */}
      <section className="mt-10">
        <h2 className="text-2xl font-bold tracking-tight">
          Frequently asked questions
        </h2>
        <div className="mt-4 space-y-3">
          {content.faqs.map((faq, i) => (
            <details
              key={i}
              className="group rounded-xl bg-white p-4 shadow-sm"
            >
              <summary className="cursor-pointer font-semibold text-slate-800 marker:text-brand-600">
                {faq.q}
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {faq.a}
              </p>
            </details>
          ))}
        </div>
      </section>

      {/* Related tools */}
      {related.length > 0 && (
        <section className="mt-10">
          <h2 className="text-2xl font-bold tracking-tight">Related tools</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {related.map((t) => (
              <Link
                key={t.key}
                href={`/tools/${t.key}`}
                className="rounded-xl bg-white p-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="text-2xl">{t.icon}</div>
                <div className="mt-2 text-sm font-semibold">{t.name}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Privacy note */}
      <section className="mt-10 rounded-xl bg-slate-100 p-5 text-sm leading-relaxed text-slate-600">
        <h2 className="font-bold text-slate-800">Private by design</h2>
        <p className="mt-1">
          Files you upload are processed securely and deleted automatically
          afterwards. PDFEDI never asks for an account — pick a tool and go.
          Each file can be up to 50MB, and every tool is free to use up to 5
          times per hour.
        </p>
      </section>
    </div>
  );
}

/** JSON-LD structured data: WebApplication + FAQPage. */
export function ToolJsonLd({ content }: { content: ToolContent }) {
  const base = "https://pdfedi.onrender.com";
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        name: `PDFEDI ${content.h1}`,
        url: `${base}/tools/${content.key}`,
        applicationCategory: "UtilitiesApplication",
        operatingSystem: "Any",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        description: content.description,
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
            name: "Home",
            item: `${base}/`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: content.h1,
            item: `${base}/tools/${content.key}`,
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

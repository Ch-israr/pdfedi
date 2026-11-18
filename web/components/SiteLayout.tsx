// Shared site shell: renders <html>/<body> for a locale (the root layout
// is a passthrough so each route group can set its own lang/dir).
// Used by the (en) layout, the (intl)/[locale] layout and the admin layout.
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { Header, Footer } from "../components/chrome";
import { LanguageSuggest } from "../components/LanguageSuggest";
import { BASE_URL, LOCALES, type LocaleSegment } from "../i18n/routing";

export async function SiteLayout({
  locale,
  children,
  showLanguageUI = true,
}: {
  locale: LocaleSegment;
  children: React.ReactNode;
  /** Admin hides the switcher + suggestion (English-only area). */
  showLanguageUI?: boolean;
}) {
  const messages = await getMessages({ locale });
  const info = LOCALES[locale];
  const t = (messages as Record<string, Record<string, string>>).meta ?? {};
  const siteJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        name: "PDFEDI",
        url: BASE_URL,
        inLanguage: info.bcp47,
        description: t.siteDescription ?? "",
      },
      {
        "@type": "Organization",
        name: "PDFEDI",
        url: BASE_URL,
        logo: `${BASE_URL}/logo.png`,
      },
    ],
  };
  return (
    <html lang={info.bcp47} dir={info.dir}>
      <body className="flex min-h-screen flex-col bg-slate-50 text-slate-900 antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
          />
          <Header locale={locale} showLanguageUI={showLanguageUI} />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">{children}</main>
          <Footer locale={locale} />
          {showLanguageUI && <LanguageSuggest locale={locale} />}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

// Locale route group — the 9 prefixed locales. Unknown locale segments
// are a real 404 (no silent fallback to English or to the homepage).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { SiteLayout } from "../../../components/SiteLayout";
import { PREFIXED_LOCALES, isLocaleSegment, type LocaleSegment } from "../../../i18n/routing";

export const metadata: Metadata = {
  icons: {
    icon: "/icon-v4.png",
    shortcut: "/favicon-v4.ico",
    apple: "/apple-touch-icon-v4.png",
  },
};

export function generateStaticParams() {
  return PREFIXED_LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  if (!isLocaleSegment(params.locale) || params.locale === "en") notFound();
  setRequestLocale(params.locale as LocaleSegment);
  return <SiteLayout locale={params.locale as LocaleSegment}>{children}</SiteLayout>;
}

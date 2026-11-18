// Per-locale metadata helpers. Every localized page gets a
// self-referencing canonical plus the full hreflang set (all 10 locales
// + x-default -> English). Used by generateMetadata in the route files.
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BASE_URL, LOCALES, localeUrl, type LocaleSegment } from "../i18n/routing";

export function hreflangAlternates(path: string): Record<string, string> {
  const langs: Record<string, string> = {};
  for (const [seg, info] of Object.entries(LOCALES)) {
    langs[info.bcp47] = localeUrl(path, seg);
  }
  langs["x-default"] = localeUrl(path, "en");
  return langs;
}

function ogMeta(locale: LocaleSegment, title: string, description: string, path: string) {
  const info = LOCALES[locale];
  return {
    openGraph: {
      title,
      description,
      url: localeUrl(path, locale),
      type: "website" as const,
      siteName: "PDFEDI",
      locale: info.ogLocale,
      alternateLocale: (Object.values(LOCALES) as Array<{ ogLocale: string }>)
        .map((l) => l.ogLocale)
        .filter((l) => l !== info.ogLocale),
      images: [{ url: `${BASE_URL}/logo.png`, width: 512, height: 512, alt: "PDFEDI logo" }],
    },
    twitter: {
      card: "summary" as const,
      title,
      description,
      images: [`${BASE_URL}/logo.png`],
    },
  };
}

export async function homeMetadata(locale: LocaleSegment): Promise<Metadata> {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "meta" });
  const title = t("homeTitle");
  const description = t("homeDescription");
  return {
    title,
    description,
    alternates: { canonical: localeUrl("/", locale), languages: hreflangAlternates("/") },
    verification: { google: "B8JxEkvHXO4JaUEYYhl6W8nD59onzRApzrSQhN9xMlI" },
    icons: {
      icon: "/icon-v4.png",
      shortcut: "/favicon-v4.ico",
      apple: "/apple-touch-icon-v4.png",
    },
    ...ogMeta(locale, title, description, "/"),
  };
}

export async function toolMetadata(locale: LocaleSegment, slug: string): Promise<Metadata> {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "toolContent" });
  let content: { title: string; description: string } | null = null;
  try {
    content = t.raw(slug) as { title: string; description: string };
  } catch {
    content = null;
  }
  if (!content) return {};
  const path = `/tools/${slug}`;
  return {
    title: content.title,
    description: content.description,
    alternates: { canonical: localeUrl(path, locale), languages: hreflangAlternates(path) },
    ...ogMeta(locale, content.title, content.description, path),
  };
}

export async function lawyersMetadata(locale: LocaleSegment): Promise<Metadata> {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "meta" });
  const title = t("lawyersTitle");
  const description = t("lawyersDescription");
  const path = "/lawyers";
  return {
    title,
    description,
    alternates: { canonical: localeUrl(path, locale), languages: hreflangAlternates(path) },
    ...ogMeta(locale, t("lawyersTitle"), t("lawyersOgDescription"), path),
  };
}

export async function privacyMetadata(locale: LocaleSegment): Promise<Metadata> {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "meta" });
  const title = t("privacyTitle");
  const description = t("privacyDescription");
  const path = "/how-we-handle-files";
  return {
    title,
    description,
    alternates: { canonical: localeUrl(path, locale), languages: hreflangAlternates(path) },
    ...ogMeta(locale, title, t("privacyOgDescription"), path),
  };
}

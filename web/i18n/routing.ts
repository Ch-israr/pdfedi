// Locale registry — single source of truth for locales.
// `segment` is the URL segment (lowercase, web convention); `bcp47` is the
// tag used for <html lang>, hreflang and Intl APIs. English is prefix-free:
// its segment is '' so live English URLs (/tools/merge) do not move.
export interface LocaleInfo {
  segment: string; // URL segment, '' for English
  bcp47: string;
  dir: "ltr" | "rtl";
  nativeName: string;
  englishName: string;
  ogLocale: string;
}

export const LOCALES: Record<string, LocaleInfo> = {
  en: { segment: "", bcp47: "en", dir: "ltr", nativeName: "English", englishName: "English", ogLocale: "en_US" },
  "zh-cn": { segment: "zh-cn", bcp47: "zh-CN", dir: "ltr", nativeName: "中文", englishName: "Chinese (Simplified)", ogLocale: "zh_CN" },
  hi: { segment: "hi", bcp47: "hi", dir: "ltr", nativeName: "हिन्दी", englishName: "Hindi", ogLocale: "hi_IN" },
  es: { segment: "es", bcp47: "es", dir: "ltr", nativeName: "Español", englishName: "Spanish", ogLocale: "es_ES" },
  ar: { segment: "ar", bcp47: "ar", dir: "rtl", nativeName: "العربية", englishName: "Arabic", ogLocale: "ar_AR" },
  fr: { segment: "fr", bcp47: "fr", dir: "ltr", nativeName: "Français", englishName: "French", ogLocale: "fr_FR" },
  bn: { segment: "bn", bcp47: "bn", dir: "ltr", nativeName: "বাংলা", englishName: "Bengali", ogLocale: "bn_IN" },
  pt: { segment: "pt", bcp47: "pt", dir: "ltr", nativeName: "Português", englishName: "Portuguese", ogLocale: "pt_BR" },
  id: { segment: "id", bcp47: "id", dir: "ltr", nativeName: "Bahasa Indonesia", englishName: "Indonesian", ogLocale: "id_ID" },
  ur: { segment: "ur", bcp47: "ur", dir: "rtl", nativeName: "اردو", englishName: "Urdu", ogLocale: "ur_PK" },
} as const;

export type LocaleSegment = keyof typeof LOCALES;

/** The 9 prefixed locales (everything except English). */
export const PREFIXED_LOCALES = (Object.keys(LOCALES) as LocaleSegment[]).filter(
  (l) => l !== "en",
);

export const LOCALE_SEGMENTS = Object.keys(LOCALES) as LocaleSegment[];

export function isLocaleSegment(s: string): s is LocaleSegment {
  return s in LOCALES;
}

/** Prefix a root-relative path with the locale segment (no-op for English). */
export function toLocalePath(path: string, locale: string): string {
  const seg = LOCALES[locale as LocaleSegment]?.segment ?? "";
  if (!seg) return path;
  return `/${seg}${path === "/" ? "" : path}`;
}

/** Absolute URL for a path in a locale (for canonicals / hreflang / sitemap). */
export const BASE_URL = "https://pdfedi.onrender.com";

export function localeUrl(path: string, locale: string): string {
  return `${BASE_URL}${toLocalePath(path, locale)}`;
}

/** Match a browser language tag to a supported locale segment.
 * Exact match first, then base-language match. zh-TW/zh-HK deliberately
 * do NOT map to zh-CN (Traditional != Simplified). Returns null when
 * there is no match. */
export function matchBrowserLocale(tag: string | undefined | null): LocaleSegment | null {
  if (!tag) return null;
  const lower = tag.toLowerCase();
  if (lower === "zh-tw" || lower === "zh-hk" || lower.startsWith("zh-tw") || lower.startsWith("zh-hk")) {
    return null;
  }
  if ((LOCALES as Record<string, LocaleInfo>)[lower]) return lower as LocaleSegment;
  const base = lower.split("-")[0];
  if ((LOCALES as Record<string, LocaleInfo>)[base]) return base as LocaleSegment;
  return null;
}

/** First supported locale from navigator.languages, in preference order. */
export function matchBrowserLocales(tags: readonly string[]): LocaleSegment | null {
  for (const tag of tags) {
    const m = matchBrowserLocale(tag);
    if (m) return m;
  }
  return null;
}

import type { MetadataRoute } from "next";
import { TOOL_SLUGS } from "../lib/tools";
import { LOCALES, LOCALE_SEGMENTS, localeUrl } from "../i18n/routing";

// KEEP THIS UP TO DATE (standing rule): tool pages are automatic via
// TOOL_SLUGS, but every new top-level route/page must be
// added here manually — it will NOT appear in sitemap.xml otherwise.
// Do NOT add /admin or any non-public routes.
//
// Multilingual: every public page is emitted once per locale (29 pages
// x 10 locales = 290 URLs), each carrying the full hreflang alternate
// set with x-default pointing at the English URL.
const PAGES: { path: string; changeFrequency: "weekly" | "monthly"; priority: number }[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  ...TOOL_SLUGS.map((slug) => ({
    path: `/tools/${slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.8,
  })),
  { path: "/lawyers", changeFrequency: "monthly", priority: 0.9 },
  { path: "/how-we-handle-files", changeFrequency: "monthly", priority: 0.5 },
];

function alternates(path: string): Record<string, string> {
  const langs: Record<string, string> = { "x-default": localeUrl(path, "en") };
  for (const locale of LOCALE_SEGMENTS) {
    langs[LOCALES[locale].bcp47] = localeUrl(path, locale);
  }
  return langs;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];
  for (const page of PAGES) {
    for (const locale of LOCALE_SEGMENTS) {
      entries.push({
        url: localeUrl(page.path, locale),
        lastModified: now,
        changeFrequency: page.changeFrequency,
        priority: page.priority,
        alternates: { languages: alternates(page.path) },
      });
    }
  }
  return entries;
}

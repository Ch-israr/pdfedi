import type { MetadataRoute } from "next";
import { TOOL_SLUGS } from "../lib/tools";

const BASE_URL = "https://pdfedi.onrender.com";

// KEEP THIS UP TO DATE (standing rule): tool pages are automatic via
// TOOL_SLUGS, but every new top-level route/page (like /editor) must be
// added here manually — it will NOT appear in sitemap.xml otherwise.
// Do NOT add /admin or any non-public routes.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: BASE_URL,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${BASE_URL}/editor`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    ...TOOL_SLUGS.map((slug) => ({
      url: `${BASE_URL}/tools/${slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];
}

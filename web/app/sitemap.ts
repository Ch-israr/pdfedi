import type { MetadataRoute } from "next";
import { TOOL_SLUGS } from "../lib/tools";

const BASE_URL = "https://pdfedi.onrender.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: BASE_URL,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    ...TOOL_SLUGS.map((slug) => ({
      url: `${BASE_URL}/tools/${slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];
}

import { MetadataRoute } from "next";

// Sitemap: public pages only. Admin, dashboard, account, files, and API
// routes are excluded (also disallowed in robots.txt).
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://pdfedi.vercel.app";

  // Tool keys must match lib/tools.tsx registry
  const tools = [
    "merge",
    "split",
    "extract_pages",
    "delete_pages",
    "reorder_pages",
    "rotate_pages",
    "compress",
    "pdf_to_images",
    "images_to_pdf",
    "pdf_to_text",
    "watermark",
    "page_numbers",
    "redact",
    "flatten",
    "edit_metadata",
    "password_protect",
    "remove_password",
  ];

  const routes: MetadataRoute.Sitemap = [
    { url: base, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: `${base}/pricing`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
  ];

  for (const key of tools) {
    routes.push({
      url: `${base}/tools/${key}`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    });
  }

  return routes;
}

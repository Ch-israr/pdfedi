import { Metadata } from "next";
import { notFound } from "next/navigation";
import { ToolRunner } from "./ToolRunner";
import { getToolMeta } from "@/lib/tools";

type Props = { params: { key: string } };

// Per-tool SEO metadata (spec §43). Public tool pages are indexable;
// the runner itself is a client component.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const meta = getToolMeta(params.key);
  if (!meta) return { title: "Tool not found — PDFEDI" };

  const base = process.env.NEXT_PUBLIC_APP_URL || "https://pdfedi.vercel.app";
  const title = `${meta.name} — Free Online PDF Tool | PDFEDI`;
  const description = `${meta.description} Free, fast, and private. No sign-up required.`;

  return {
    title,
    description,
    alternates: { canonical: `${base}/tools/${meta.key}` },
    openGraph: {
      title,
      description,
      url: `${base}/tools/${meta.key}`,
      siteName: "PDFEDI",
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
    robots: { index: true, follow: true },
  };
}

export default function ToolPage({ params }: Props) {
  const meta = getToolMeta(params.key);
  if (!meta) notFound();
  // Guest mode: tools usable without sign-in (backend enforces quotas).
  return <ToolRunner toolKey={params.key} />;
}

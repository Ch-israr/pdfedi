import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ToolRunner } from "../../../components/ToolRunner";
import { ToolSeo, ToolJsonLd } from "../../../components/ToolSeo";
import { TOOL_SLUGS } from "../../../lib/tools";
import { TOOL_CONTENT } from "../../../lib/tool-content";

const BASE_URL = "https://pdfedi.onrender.com";

export function generateStaticParams() {
  return TOOL_SLUGS.map((slug) => ({ slug }));
}

export function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Metadata {
  const content = TOOL_CONTENT[params.slug];
  if (!content) return {};
  const canonical = `${BASE_URL}/tools/${content.key}`;
  return {
    title: content.title,
    description: content.description,
    alternates: { canonical },
    openGraph: {
      title: content.title,
      description: content.description,
      url: canonical,
      type: "website",
      siteName: "PDFEDI",
    },
    twitter: {
      card: "summary",
      title: content.title,
      description: content.description,
    },
  };
}

export default function ToolPage({ params }: { params: { slug: string } }) {
  const content = TOOL_CONTENT[params.slug];
  if (!content) notFound();
  return (
    <>
      <ToolJsonLd content={content} />
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-extrabold tracking-tight">{content.h1}</h1>
      </div>
      <ToolRunner toolKey={params.slug} />
      <ToolSeo content={content} />
    </>
  );
}

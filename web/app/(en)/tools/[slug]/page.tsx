import type { Metadata } from "next";
import { ToolPageBody } from "../../../../components/pages/ToolPageBody";
import { toolMetadata } from "../../../../lib/metadata";
import { TOOL_SLUGS } from "../../../../lib/tools";

export function generateStaticParams() {
  return TOOL_SLUGS.map((slug) => ({ slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  return toolMetadata("en", params.slug);
}

export default function Page({ params }: { params: { slug: string } }) {
  return <ToolPageBody locale="en" slug={params.slug} />;
}

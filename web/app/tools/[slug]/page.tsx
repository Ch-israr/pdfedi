import { ToolRunner } from "../../../components/ToolRunner";
import { TOOL_SLUGS } from "../../../lib/tools";

export function generateStaticParams() {
  return TOOL_SLUGS.map((slug) => ({ slug }));
}

export default function ToolPage({ params }: { params: { slug: string } }) {
  return <ToolRunner toolKey={params.slug} />;
}

import type { Metadata } from "next";
import { ToolPageBody } from "../../../../../components/pages/ToolPageBody";
import { toolMetadata } from "../../../../../lib/metadata";
import { TOOL_SLUGS } from "../../../../../lib/tools";
import { PREFIXED_LOCALES, type LocaleSegment } from "../../../../../i18n/routing";

export function generateStaticParams() {
  return PREFIXED_LOCALES.flatMap((locale) =>
    TOOL_SLUGS.map((slug) => ({ locale, slug })),
  );
}

export function generateMetadata({
  params,
}: {
  params: { locale: string; slug: string };
}): Promise<Metadata> {
  return toolMetadata(params.locale as LocaleSegment, params.slug);
}

export default function Page({ params }: { params: { locale: string; slug: string } }) {
  return <ToolPageBody locale={params.locale as LocaleSegment} slug={params.slug} />;
}

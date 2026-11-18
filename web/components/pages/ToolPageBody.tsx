// Shared tool page body — one component, rendered in every locale.
// SEO content comes from the toolContent messages namespace; the
// interactive UI is ToolRunner (21 tools) or OrganizerTool (5 canvases).
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ToolRunner } from "../ToolRunner";
import { OrganizerTool } from "../canvas/OrganizerTool";
import { ToolSeo, ToolJsonLd, type ToolContentData } from "../ToolSeo";
import { ORGANIZER_TOOL_SLUGS } from "../../lib/tools";
import type { LocaleSegment } from "../../i18n/routing";

export async function ToolPageBody({
  locale,
  slug,
}: {
  locale: LocaleSegment;
  slug: string;
}) {
  const tContent = await getTranslations({ locale, namespace: "toolContent" });
  let content: ToolContentData;
  try {
    content = tContent.raw(slug) as ToolContentData;
  } catch {
    notFound();
  }
  if (!content || typeof content !== "object" || !content.h1) notFound();
  const isCanvas = (ORGANIZER_TOOL_SLUGS as readonly string[]).includes(slug);
  return (
    <>
      <ToolJsonLd content={content} locale={locale} slug={slug} />
      {!isCanvas && (
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-extrabold tracking-tight">{content.h1}</h1>
        </div>
      )}
      {isCanvas ? <OrganizerTool toolKey={slug} /> : <ToolRunner toolKey={slug} />}
      <ToolSeo content={content} locale={locale} />
    </>
  );
}

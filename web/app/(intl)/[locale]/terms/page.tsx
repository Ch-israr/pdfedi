import type { Metadata } from "next";
import { TermsPage } from "../../../../components/pages/TermsPage";
import { termsPageMetadata } from "../../../../lib/metadata";
import { PREFIXED_LOCALES, type LocaleSegment } from "../../../../i18n/routing";

export function generateStaticParams() {
  return PREFIXED_LOCALES.map((locale) => ({ locale }));
}

export function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  return termsPageMetadata(params.locale as LocaleSegment);
}

export default function Page({ params }: { params: { locale: string } }) {
  return <TermsPage locale={params.locale as LocaleSegment} />;
}

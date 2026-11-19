import type { Metadata } from "next";
import { AboutPage } from "../../../../components/pages/AboutPage";
import { aboutPageMetadata } from "../../../../lib/metadata";
import { PREFIXED_LOCALES, type LocaleSegment } from "../../../../i18n/routing";

export function generateStaticParams() {
  return PREFIXED_LOCALES.map((locale) => ({ locale }));
}

export function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  return aboutPageMetadata(params.locale as LocaleSegment);
}

export default function Page({ params }: { params: { locale: string } }) {
  return <AboutPage locale={params.locale as LocaleSegment} />;
}

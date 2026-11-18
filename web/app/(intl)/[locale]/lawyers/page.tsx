import type { Metadata } from "next";
import { LawyersPage } from "../../../../components/pages/LawyersPage";
import { lawyersMetadata } from "../../../../lib/metadata";
import { PREFIXED_LOCALES, type LocaleSegment } from "../../../../i18n/routing";

export function generateStaticParams() {
  return PREFIXED_LOCALES.map((locale) => ({ locale }));
}

export function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  return lawyersMetadata(params.locale as LocaleSegment);
}

export default function Page({ params }: { params: { locale: string } }) {
  return <LawyersPage locale={params.locale as LocaleSegment} />;
}

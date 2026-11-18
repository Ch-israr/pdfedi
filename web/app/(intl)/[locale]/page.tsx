import type { Metadata } from "next";
import { HomePage } from "../../../components/pages/HomePage";
import { homeMetadata } from "../../../lib/metadata";
import { PREFIXED_LOCALES, type LocaleSegment } from "../../../i18n/routing";

export function generateStaticParams() {
  return PREFIXED_LOCALES.map((locale) => ({ locale }));
}

export function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  return homeMetadata(params.locale as LocaleSegment);
}

export default function Page({ params }: { params: { locale: string } }) {
  return <HomePage locale={params.locale as LocaleSegment} />;
}

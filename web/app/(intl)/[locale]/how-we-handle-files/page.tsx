import type { Metadata } from "next";
import { PrivacyPage } from "../../../../components/pages/PrivacyPage";
import { privacyMetadata } from "../../../../lib/metadata";
import { PREFIXED_LOCALES, type LocaleSegment } from "../../../../i18n/routing";

export function generateStaticParams() {
  return PREFIXED_LOCALES.map((locale) => ({ locale }));
}

export function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  return privacyMetadata(params.locale as LocaleSegment);
}

export default function Page({ params }: { params: { locale: string } }) {
  return <PrivacyPage locale={params.locale as LocaleSegment} />;
}

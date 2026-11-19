import type { Metadata } from "next";
import { PrivacyPolicyPage } from "../../../../components/pages/PrivacyPolicyPage";
import { privacyPageMetadata } from "../../../../lib/metadata";
import { PREFIXED_LOCALES, type LocaleSegment } from "../../../../i18n/routing";

export function generateStaticParams() {
  return PREFIXED_LOCALES.map((locale) => ({ locale }));
}

export function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  return privacyPageMetadata(params.locale as LocaleSegment);
}

export default function Page({ params }: { params: { locale: string } }) {
  return <PrivacyPolicyPage locale={params.locale as LocaleSegment} />;
}

import type { Metadata } from "next";
import { PrivacyPolicyPage } from "../../../components/pages/PrivacyPolicyPage";
import { privacyPageMetadata } from "../../../lib/metadata";

export function generateMetadata(): Promise<Metadata> {
  return privacyPageMetadata("en");
}

export default function Page() {
  return <PrivacyPolicyPage locale="en" />;
}

import type { Metadata } from "next";
import { PrivacyPage } from "../../../components/pages/PrivacyPage";
import { privacyMetadata } from "../../../lib/metadata";

export function generateMetadata(): Promise<Metadata> {
  return privacyMetadata("en");
}

export default function Page() {
  return <PrivacyPage locale="en" />;
}

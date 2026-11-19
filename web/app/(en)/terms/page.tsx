import type { Metadata } from "next";
import { TermsPage } from "../../../components/pages/TermsPage";
import { termsPageMetadata } from "../../../lib/metadata";

export function generateMetadata(): Promise<Metadata> {
  return termsPageMetadata("en");
}

export default function Page() {
  return <TermsPage locale="en" />;
}

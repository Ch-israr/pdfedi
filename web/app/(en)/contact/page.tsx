import type { Metadata } from "next";
import { ContactPage } from "../../../components/pages/ContactPage";
import { contactPageMetadata } from "../../../lib/metadata";

export function generateMetadata(): Promise<Metadata> {
  return contactPageMetadata("en");
}

export default function Page() {
  return <ContactPage locale="en" />;
}

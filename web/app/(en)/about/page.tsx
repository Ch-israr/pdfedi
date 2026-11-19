import type { Metadata } from "next";
import { AboutPage } from "../../../components/pages/AboutPage";
import { aboutPageMetadata } from "../../../lib/metadata";

export function generateMetadata(): Promise<Metadata> {
  return aboutPageMetadata("en");
}

export default function Page() {
  return <AboutPage locale="en" />;
}

import type { Metadata } from "next";
import { HomePage } from "../../components/pages/HomePage";
import { homeMetadata } from "../../lib/metadata";

export function generateMetadata(): Promise<Metadata> {
  return homeMetadata("en");
}

export default function Page() {
  return <HomePage locale="en" />;
}

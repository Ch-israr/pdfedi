import type { Metadata } from "next";
import { LawyersPage } from "../../../components/pages/LawyersPage";
import { lawyersMetadata } from "../../../lib/metadata";

export function generateMetadata(): Promise<Metadata> {
  return lawyersMetadata("en");
}

export default function Page() {
  return <LawyersPage locale="en" />;
}

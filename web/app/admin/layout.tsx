import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { SiteLayout } from "../../components/SiteLayout";

// Admin dashboard must never appear in search results.
export const metadata: Metadata = {
  title: "Admin — PDFEDI",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  setRequestLocale("en");
  return (
    <SiteLayout locale="en" showLanguageUI={false}>
      {children}
    </SiteLayout>
  );
}

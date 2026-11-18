// English route group — prefix-free URLs (the live indexed URLs do
// not move). Sets the request locale to 'en' for static rendering.
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { SiteLayout } from "../../components/SiteLayout";

export const metadata: Metadata = {
  icons: {
    icon: "/icon-v4.png",
    shortcut: "/favicon-v4.ico",
    apple: "/apple-touch-icon-v4.png",
  },
};

export default async function EnLayout({ children }: { children: React.ReactNode }) {
  setRequestLocale("en");
  return <SiteLayout locale="en">{children}</SiteLayout>;
}

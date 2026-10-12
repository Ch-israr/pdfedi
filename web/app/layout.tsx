import type { Metadata } from "next";
import "./globals.css";
import { Header, Footer } from "../components/chrome";

export const metadata: Metadata = {
  title: "PDFEDI — Free Online PDF Tools",
  description:
    "Merge, split, compress, convert and protect PDFs online. Free, no sign-up, no watermarks.",
  verification: {
    google: "B8JxEkvHXO4JaUEYYhl6W8nD59onzRApzrSQhN9xMlI",
  },
  icons: {
    icon: "/icon-v4.png",
    shortcut: "/favicon-v4.ico",
    apple: "/apple-touch-icon-v4.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-slate-50 text-slate-900 antialiased">
        <Header />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">{children}</main>
        <Footer />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";
import { Header, Footer } from "../components/chrome";

const BASE_URL = "https://pdfedi.onrender.com";

export const metadata: Metadata = {
  title: "PDFEDI — Free Online PDF Tools: Merge, Split, Compress & Edit",
  description:
    "Merge, split, compress, convert and protect PDFs free online. 19 PDF tools plus a full in-browser PDF editor — no sign-up, no watermarks, private by design.",
  verification: {
    google: "B8JxEkvHXO4JaUEYYhl6W8nD59onzRApzrSQhN9xMlI",
  },
  icons: {
    icon: "/icon-v4.png",
    shortcut: "/favicon-v4.ico",
    apple: "/apple-touch-icon-v4.png",
  },
  alternates: { canonical: BASE_URL },
  openGraph: {
    title: "PDFEDI — Free Online PDF Tools: Merge, Split, Compress & Edit",
    description:
      "Merge, split, compress, convert and protect PDFs free online. 19 PDF tools plus a full in-browser PDF editor — no sign-up, no watermarks, private by design.",
    url: BASE_URL,
    type: "website",
    siteName: "PDFEDI",
    images: [{ url: `${BASE_URL}/logo.png`, width: 512, height: 512, alt: "PDFEDI logo" }],
  },
  twitter: {
    card: "summary",
    title: "PDFEDI — Free Online PDF Tools: Merge, Split, Compress & Edit",
    description:
      "Merge, split, compress, convert and protect PDFs free online. 19 PDF tools plus a full in-browser PDF editor — no sign-up, no watermarks, private by design.",
    images: [`${BASE_URL}/logo.png`],
  },
};

const siteJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      name: "PDFEDI",
      url: BASE_URL,
      description:
        "Free online PDF tools: merge, split, compress, convert, protect PDFs, plus a full in-browser PDF editor.",
    },
    {
      "@type": "Organization",
      name: "PDFEDI",
      url: BASE_URL,
      logo: `${BASE_URL}/logo.png`,
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-slate-50 text-slate-900 antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
        />
        <Header />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">{children}</main>
        <Footer />
      </body>
    </html>
  );
}

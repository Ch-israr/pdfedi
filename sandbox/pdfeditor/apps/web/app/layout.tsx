import type { Metadata } from 'next';
import './globals.css';

const BASE_URL = 'https://pdfedi.onrender.com';
const CANONICAL = `${BASE_URL}/editor`;
const TITLE = 'Free PDF Editor Online — Edit, Sign & Annotate PDFs | PDFEDI';
const DESCRIPTION =
  'Edit PDF text, add images and shapes, sign documents and redact sensitive content — all in your browser. Free online PDF editor, no sign-up required.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: CANONICAL },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: CANONICAL,
    type: 'website',
    siteName: 'PDFEDI',
    images: [{ url: `${BASE_URL}/logo.png`, width: 512, height: 512, alt: 'PDFEDI logo' }],
  },
  twitter: {
    card: 'summary',
    title: TITLE,
    description: DESCRIPTION,
    images: [`${BASE_URL}/logo.png`],
  },
};

const editorJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'PDFEDI PDF Editor',
  url: CANONICAL,
  applicationCategory: 'UtilitiesApplication',
  operatingSystem: 'Any',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  description: DESCRIPTION,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-100 text-slate-900 antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(editorJsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}

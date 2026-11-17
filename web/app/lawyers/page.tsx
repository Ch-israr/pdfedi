import type { Metadata } from "next";
import Link from "next/link";

const BASE_URL = "https://pdfedi.onrender.com";

export const metadata: Metadata = {
  title: "PDF Tools for Lawyers — Redact, File & Combine Exhibits | PDFEDI",
  description:
    "Free PDF tools for lawyers: true redaction, metadata stripping, court-size compression, exhibit combining with Bates numbers. No sign-up, no watermarks.",
  alternates: { canonical: `${BASE_URL}/lawyers` },
  openGraph: {
    title: "PDF Tools for Lawyers | PDFEDI",
    description:
      "Redact, strip metadata, compress to your court's filing limit and combine exhibits with Bates numbers — free, no sign-up.",
    url: `${BASE_URL}/lawyers`,
    type: "website",
    siteName: "PDFEDI",
  },
};

const GUIDES: {
  title: string;
  answer: string;
  tool: string;
  toolName: string;
}[] = [
  {
    title: "Redact a deposition exhibit",
    answer:
      "Redaction here deletes the text from the file, not just covers it with a black box — and the output is re-checked so the redacted words can't be extracted. For maximum certainty, turn on Rasterise pages: every page becomes an image, so no text layer survives at all.",
    tool: "/tools/redact",
    toolName: "Redact PDF",
  },
  {
    title: "Combine exhibits into a filing-ready PDF",
    answer:
      "Upload your exhibits in order and get one document back: a slip sheet before each exhibit (Exhibit A, B, C… with filename and page count) and Bates numbers stamped continuously across every exhibit page.",
    tool: "/tools/exhibit_combine",
    toolName: "Combine Exhibits",
  },
  {
    title: "Compress a brief under your court's limit",
    answer:
      "Pick your court's size limit — 25 MB is the most common CM/ECF limit, but courts vary from about 3 to 200 MB, so check your local rule. The tool shrinks the file to fit and the ZIP includes a report showing the size before and after.",
    tool: "/tools/compress",
    toolName: "Compress PDF",
  },
  {
    title: "Strip metadata before sending a document to the other side",
    answer:
      "A PDF can carry its author's name, creation dates and the software that made it. Strip Metadata removes all of it in one click and gives you a before/after report proving what was removed.",
    tool: "/tools/strip_metadata",
    toolName: "Strip Metadata",
  },
  {
    title: "Remove location data from case photos",
    answer:
      "Photos often carry GPS coordinates and camera details in their EXIF data. Strip Image Metadata lists what each photo carries, removes it, and reports what was taken out. Note: it does not verify removal of C2PA/AI markers — use ClearMark for those.",
    tool: "/tools/strip_image_metadata",
    toolName: "Strip Image Metadata",
  },
  {
    title: "Check what metadata a PDF you received contains",
    answer:
      "Before you rely on a document, see what's hidden in it. View Metadata reads the title, author, dates, creator and producer and gives you the result as JSON.",
    tool: "/tools/metadata",
    toolName: "View Metadata",
  },
  {
    title: "Fix a document's title or author before filing",
    answer:
      "If a PDF's stored title or author is wrong — or names someone it shouldn't — Edit Metadata lets you set or clear the title, author, subject and keywords without touching the pages.",
    tool: "/tools/edit_metadata",
    toolName: "Edit Metadata",
  },
  {
    title: "Number the pages of a filing",
    answer:
      "Add page numbers in any corner, starting from any number, with a prefix or suffix if your court wants one. You can number only selected page ranges and leave the rest alone.",
    tool: "/tools/page_numbers",
    toolName: "Add Page Numbers",
  },
  {
    title: "Merge supporting documents into one bundle",
    answer:
      "Combine 2 to 20 PDFs into a single file in the order you upload them — pleadings, attachments and supporting documents as one bundle instead of many files.",
    tool: "/tools/merge",
    toolName: "Merge PDF",
  },
  {
    title: "Pull one document out of a bundle",
    answer:
      "Split a PDF by page ranges (for example 1–3, 5) or into one file per page, and download the results as a ZIP. Useful when a bundle arrives as one file and you need a single exhibit from it.",
    tool: "/tools/split",
    toolName: "Split PDF",
  },
  {
    title: "Protect a sensitive document with a password",
    answer:
      "Add a password to a PDF before sending it, so only someone with the password can open it. And if you receive a protected file and know the password, Unlock PDF removes the protection.",
    tool: "/tools/password_protect",
    toolName: "Protect PDF",
  },
  {
    title: "Make a scanned document searchable",
    answer:
      "Scanned pages are pictures, not text — you can't search them or copy from them. OCR adds an invisible text layer so the document becomes searchable while looking exactly the same.",
    tool: "/tools/ocr",
    toolName: "OCR",
  },
];

export default function LawyersPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
        PDF tools for lawyers
      </h1>
      <p className="mt-4 text-lg text-slate-600">
        Redact properly, strip hidden metadata, fit your court&apos;s filing
        limit, and combine exhibits with Bates numbers. Free, no sign-up, no
        watermarks.
      </p>

      <section className="mt-10">
        <h2 className="text-xl font-bold">The filing workflow, in order</h2>
        <ol className="mt-4 list-decimal space-y-2 pl-6 text-slate-700">
          <li>
            <strong>Redact</strong> sensitive text — the text is deleted from
            the file and the output is verified, not just blacked out.
          </li>
          <li>
            <strong>Strip metadata</strong> — remove author, dates and
            software details, with a before/after report.
          </li>
          <li>
            <strong>Compress</strong> to your court&apos;s size limit.
          </li>
          <li>
            <strong>Combine exhibits</strong> with slip sheets and Bates
            numbers into one filing-ready PDF.
          </li>
        </ol>
      </section>

      <section className="mt-12 space-y-8">
        {GUIDES.map((g) => (
          <article key={g.title}>
            <h2 className="text-xl font-bold tracking-tight">{g.title}</h2>
            <p className="mt-2 leading-relaxed text-slate-600">{g.answer}</p>
            <Link
              href={g.tool}
              className="mt-2 inline-block font-semibold text-brand-600 hover:text-brand-700"
            >
              {g.toolName} →
            </Link>
          </article>
        ))}
      </section>

      <section className="mt-12 rounded-2xl bg-slate-100 p-6 text-sm text-slate-600">
        <h2 className="font-bold text-slate-800">A note on limits</h2>
        <p className="mt-2">
          PDFEDI is a tool, not a lawyer. Court filing limits, redaction
          duties and disclosure rules vary by court and jurisdiction — check
          your court&apos;s local rules and your professional obligations
          before filing. Redaction here removes the text you name; always
          check the output before you file it. Files uploaded to these tools
          are processed on our server — see{" "}
          <Link href="/how-we-handle-files" className="font-semibold text-brand-600 hover:text-brand-700">
            how we handle your files
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

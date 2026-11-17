import type { Metadata } from "next";
import Link from "next/link";

const BASE_URL = "https://pdfedi.onrender.com";

export const metadata: Metadata = {
  title: "How We Handle Your Files — Privacy | PDFEDI",
  description:
    "What happens to your files on PDFEDI: uploaded to our server to be processed, deleted automatically, no account, no file content kept or shared.",
  alternates: { canonical: `${BASE_URL}/how-we-handle-files` },
  openGraph: {
    title: "How We Handle Your Files | PDFEDI",
    description:
      "Uploaded to our server, processed, deleted automatically. No account, no file content kept.",
    url: `${BASE_URL}/how-we-handle-files`,
    type: "website",
    siteName: "PDFEDI",
  },
};

export default function HowWeHandleFilesPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
        How we handle your files
      </h1>
      <p className="mt-4 text-lg text-slate-600">
        Plainly, without the usual privacy slogans. There are two different
        kinds of tools on PDFEDI, and they handle your files differently.
      </p>

      <section className="mt-10">
        <h2 className="text-xl font-bold">Server tools (most tools on this site)</h2>
        <p className="mt-2 leading-relaxed text-slate-600">
          When you use a tool like Merge, Redact or Compress, your file is
          uploaded to our server, processed there, and the result is sent back
          to you for download. Your file does leave your device — anyone who
          says otherwise about a server-processed tool is not telling you the
          truth. What we do promise:
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-6 text-slate-700">
          <li>No account, no sign-up, no email address asked for.</li>
          <li>Files are processed automatically and deleted automatically.</li>
          <li>
            Your file content is not kept, not shared with anyone, and not
            used to train anything.
          </li>
          <li>
            We count anonymous usage (how many times a tool ran) so we can
            keep the free limits fair — we do not record what your files
            contain.
          </li>
        </ul>
        <p className="mt-4 leading-relaxed text-slate-600">
          Because these tools run on a server, the &ldquo;airplane-mode
          test&rdquo; does not apply to them: if you disconnect from the
          internet, a server tool cannot work at all. The checks that do apply
          here are the ones built into the tools themselves — for example,
          Redact re-checks its output so redacted text can&apos;t be
          extracted, and Strip Metadata gives you a before/after report
          showing exactly what was removed.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold">The in-browser PDF editor</h2>
        <p className="mt-2 leading-relaxed text-slate-600">
          The PDF editor is different: it runs entirely in your browser and
          your files stay on your device. You can verify that yourself — open
          your browser&apos;s Network tab while editing, or turn on airplane
          mode once the editor has loaded, and editing still works because
          nothing is being uploaded.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold">How to check our claims yourself</h2>
        <ul className="mt-4 list-disc space-y-2 pl-6 text-slate-700">
          <li>
            <strong>Redaction:</strong> after redacting, try searching the
            output PDF for the redacted words — they should not be found.
            Turn on &ldquo;Rasterise pages&rdquo; and the output has no text
            layer at all.
          </li>
          <li>
            <strong>Metadata:</strong> open the metadata_report.json that
            comes with Strip Metadata, or use View Metadata on the cleaned
            file, and compare it with the original.
          </li>
          <li>
            <strong>Editor:</strong> use the Network tab or airplane mode as
            described above.
          </li>
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold">What we don&apos;t do</h2>
        <ul className="mt-4 list-disc space-y-2 pl-6 text-slate-700">
          <li>We don&apos;t sell or share your files.</li>
          <li>We don&apos;t ask for an account to use the free tools.</li>
          <li>
            We don&apos;t claim server-processed files &ldquo;never leave your
            device&rdquo; — they do, for processing, and then they&apos;re
            deleted.
          </li>
        </ul>
        <p className="mt-6">
          <Link href="/" className="font-semibold text-brand-600 hover:text-brand-700">
            ← Back to all tools
          </Link>
        </p>
      </section>
    </div>
  );
}

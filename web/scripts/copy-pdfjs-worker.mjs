// Copies the pdf.js runtime files into web/public/ so they are served
// from the static export (and from `next dev`) at stable public URLs.
//
// Why files in public/ instead of bundler imports: pdfjs-dist's ESM
// builds cannot be re-bundled by Next.js's webpack — the bundled
// module throws "Object.defineProperty called on non-object" from
// webpack's __esModule helper at import time (verified live, both the
// default and the legacy build). Loading the self-contained ESM bundle
// at runtime with `webpackIgnore` sidesteps the bundler entirely.
// This mirrors the old /editor, which served pdf.worker.min.mjs from
// the static root. Runs as part of `npm run dev` and `npm run build`,
// so the Docker build gets the files without any Dockerfile change.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Legacy build: the default build/pdf.mjs is a webpack bundle that
// cannot be re-bundled by Next.js (see lib/canvas/pdfjs.ts).
const legacy = join(root, "node_modules", "pdfjs-dist", "legacy", "build");

const FILES = [
  ["pdf.min.mjs", "pdf.min.mjs"],
  ["pdf.worker.min.mjs", "pdf.worker.min.mjs"],
];

for (const [srcName, destName] of FILES) {
  const src = join(legacy, srcName);
  const dest = join(root, "public", destName);
  if (!existsSync(src)) {
    console.error(`[pdfjs-worker] missing: ${src} — run npm install first`);
    process.exit(1);
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(
    `[pdfjs-worker] copied ${destName} (${(statSync(dest).size / 1024).toFixed(0)} KB) -> public/`,
  );
}

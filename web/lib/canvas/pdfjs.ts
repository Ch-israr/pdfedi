// pdf.js loader — single place that configures the worker.
//
// The pdf.js runtime is served from the static export as plain files
// (/pdf.min.mjs + /pdf.worker.min.mjs, copied there by
// web/scripts/copy-pdfjs-worker.mjs during `npm run dev` /
// `npm run build`) and loaded at runtime with `webpackIgnore`, NOT
// through Next.js's bundler: pdfjs-dist's ESM builds cannot be
// re-bundled by webpack — importing them (default or legacy build)
// throws "Object.defineProperty called on non-object" from webpack's
// __esModule helper at import time. The legacy bundle is fully
// self-contained (zero imports), so a runtime import of the public
// file just works. The site has no basePath, so the paths are absolute
// from the site root — the same approach the old /editor used for the
// worker, extended to the main bundle.
//
// Pinned version: pdfjs-dist 5.4.296 (engines: node >=20.16 || >=22.3,
// so it builds under the Docker image's node:20-slim). pdfjs-dist 6.x
// was not attempted: 5.4.x satisfies the requirement and is the
// version the Phase 1 plan sanctions as the Node 20 fallback.
//
// Types come from the package (`import type` only — no runtime code
// is bundled from pdfjs-dist).
import type * as PdfJsTypes from "pdfjs-dist";

export type PdfJsLib = typeof PdfJsTypes;
export type PdfDocument = PdfJsTypes.PDFDocumentProxy;

// Versioned so the backend can serve these immutable for a year
// (backend/main.py _frontend_cache_headers): bump ?v= when pdfjs-dist
// is upgraded — the version is pinned in web/package.json.
const PDFJS_VERSION = "5.4.296";
const PDFJS_URL = `/pdf.min.mjs?v=${PDFJS_VERSION}`;
const WORKER_URL = `/pdf.worker.min.mjs?v=${PDFJS_VERSION}`;

let libPromise: Promise<PdfJsLib> | null = null;

/** Lazily load pdf.js from the static export; point it at the worker. */
export function getPdfjs(): Promise<PdfJsLib> {
  if (!libPromise) {
    libPromise = (async () => {
      // Non-literal specifier + webpackIgnore: webpack leaves this
      // import alone and the browser fetches /pdf.min.mjs directly.
      const lib = (await import(/* webpackIgnore: true */ PDFJS_URL)) as unknown as PdfJsLib;
      lib.GlobalWorkerOptions.workerSrc = WORKER_URL;
      return lib;
    })();
  }
  return libPromise;
}

/** Load a PDF from raw bytes. Caller owns destroy() on the document. */
export async function loadPdfDocument(bytes: ArrayBuffer): Promise<PdfDocument> {
  const lib = await getPdfjs();
  const task = lib.getDocument({ data: new Uint8Array(bytes) });
  return task.promise;
}

/**
 * Render one page to a data URL (PNG). `scale` is in PDF points
 * (1 = 72 DPI). Renders at most `maxDim` px on the long side unless
 * `maxDim` is 0.
 */
export async function renderPageDataUrl(
  doc: PdfDocument,
  pageNum: number,
  scale: number,
  maxDim = 0,
): Promise<string> {
  const page = await doc.getPage(pageNum);
  try {
    let viewport = page.getViewport({ scale });
    if (maxDim > 0) {
      const longSide = Math.max(viewport.width, viewport.height);
      if (longSide > maxDim) {
        const s = (maxDim / longSide) * scale;
        viewport = page.getViewport({ scale: s });
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get a 2D canvas context");
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL("image/png");
  } finally {
    page.cleanup();
  }
}

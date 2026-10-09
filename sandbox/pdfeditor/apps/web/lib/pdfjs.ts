/**
 * PDF.js loader — renders pages to canvas, extracts page dimensions.
 * The worker is served locally from /public (see next.config.js note).
 */
import type { Page } from '@pdfeditor/shared';

let pdfjs: typeof import('pdfjs-dist') | null = null;

async function getPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('pdfjs-dist');
    // Local worker — no CDN dependency, works offline / behind CSP
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  }
  return pdfjs;
}

export interface LoadedPdf {
  pageCount: number;
  pages: Page[];
  /** Keep the pdf.js document for rendering; destroy on close */
  doc: import('pdfjs-dist').PDFDocumentProxy;
}

export async function loadPdfDocument(bytes: Uint8Array): Promise<LoadedPdf> {
  const lib = await getPdfjs();
  const doc = await lib.getDocument({ data: bytes.slice() }).promise;
  const pages: Page[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pdfPage = await doc.getPage(i);
    // Use the page's native rotation for the viewport so width/height reflect
    // the actual displayed dimensions (handles PDFs with /Rotate metadata).
    // Store the native rotation in the model so rendering stays consistent.
    const nativeRotation = pdfPage.rotate ?? 0;
    const viewport = pdfPage.getViewport({ scale: 1 });
    pages.push({
      id: crypto.randomUUID(),
      sourceIndex: i,
      width: viewport.width,
      height: viewport.height,
      rotation: nativeRotation,
    });
    pdfPage.cleanup();
  }
  return { pageCount: doc.numPages, pages, doc };
}

/**
 * Render a page to a canvas. Caller owns the canvas lifecycle.
 * Only render pages in/near the viewport (lazy rendering).
 */
export async function renderPageToCanvas(
  doc: import('pdfjs-dist').PDFDocumentProxy,
  sourceIndex: number,
  canvas: HTMLCanvasElement,
  scale: number,
  rotation: number = 0,
): Promise<void> {
  const pdfPage = await doc.getPage(sourceIndex);
  const viewport = pdfPage.getViewport({ scale, rotation });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const newW = Math.floor(viewport.width * dpr);
  const newH = Math.floor(viewport.height * dpr);
  // Only resize if dimensions changed — setting width/height clears the canvas
  // synchronously, which causes flicker during re-renders. Keep old content
  // visible until the new render is ready.
  if (canvas.width !== newW || canvas.height !== newH) {
    canvas.width = newW;
    canvas.height = newH;
  }
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not supported');
  await pdfPage.render({
    canvasContext: ctx,
    viewport: viewport.clone({ scale: viewport.scale * dpr }),
  } as never).promise;
  pdfPage.cleanup();
}

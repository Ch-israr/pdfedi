/**
 * PDF.js loader — renders pages to canvas, extracts page dimensions.
 * The worker is served locally from /public (see next.config.js note).
 */
import type { Page, NativeTextItem } from '@pdfeditor/shared';

/**
 * Extract native text fragments with their positions (no OCR — this reads
 * the PDF's own text operators via PDF.js).
 *
 * Calibration: for rotation-0 pages, item.transform[4]/[5] are already PDF
 * points with a bottom-left origin — the editor's coordinate system — and
 * item.width is in points. For rotated pages the items are mapped through
 * the same viewport the renderer uses so hit-testing stays aligned.
 *
 * Returns an empty array for pages without extractable text (scanned/flat).
 */
export async function extractNativeText(
  doc: import('pdfjs-dist').PDFDocumentProxy,
  page: Page,
): Promise<NativeTextItem[]> {
  if (page.sourceIndex === 0) return []; // blank inserted page
  const pdfPage = await doc.getPage(page.sourceIndex);
  try {
    const tc = await pdfPage.getTextContent();
    const viewport = pdfPage.getViewport({ scale: 1, rotation: page.rotation });
    const items: NativeTextItem[] = [];
    let n = 0;
    for (const raw of tc.items) {
      if (!('str' in raw) || typeof raw.str !== 'string') continue;
      const str = raw.str;
      if (!str.trim()) continue; // skip whitespace-only fragments
      const t = raw.transform as unknown as number[];
      // Font size from the transform's scale components
      const fontSize = Math.hypot(t[0], t[1]) || Math.hypot(t[2], t[3]) || 12;
      if (!Number.isFinite(fontSize) || fontSize <= 0 || fontSize > 500) continue;
      // Map through the viewport so rotated pages stay aligned with rendering
      const [vx, vy] = viewport.convertToViewportPoint(t[4], t[5]);
      const x = vx;
      const baselineY = page.height - vy; // viewport y-down → PDF y-up
      const width = (raw as { width?: number }).width ?? 0;
      if (!Number.isFinite(width) || width <= 0 || width > page.width * 2) continue;
      // Cover box: a little generous vertically so the opaque export rect
      // fully hides the original glyphs (ascent + descent).
      const padTop = fontSize * 0.25;
      const padBottom = fontSize * 0.3;
      const y = baselineY - padBottom;
      const height = fontSize + padTop + padBottom;
      // Skip items that fall outside the page (extraction artefacts)
      if (x < -width || x > page.width + width || y < -height || y > page.height + height) {
        continue;
      }
      const fontName = ((raw as { fontName?: string }).fontName ?? '').toLowerCase();
      items.push({
        id: `nt-${page.id}-${n++}`,
        x,
        y,
        width,
        height,
        baselineOffset: padBottom,
        text: str,
        fontSize: Math.round(fontSize * 10) / 10,
        fontFamily: 'Helvetica',
        // Bold/italic hints from the embedded font name when available
        bold: /bold|black|heavy|demi/.test(fontName),
        italic: /italic|oblique/.test(fontName),
      });
    }
    return items;
  } finally {
    pdfPage.cleanup();
  }
}

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

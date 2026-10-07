/**
 * Lazy PDF.js loader with virtualized page rendering.
 *
 * - Loads PDF.js from CDN on first use (never in the main bundle)
 * - Renders only visible pages (IntersectionObserver-driven)
 * - Disposes canvases for pages scrolled out of view
 * - Exposes text content for search
 *
 * Depends on global `pdfjsLib` (loaded via script tag).
 */

const PDFJS_VERSION = '3.11.174';
const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;

let _loadPromise = null;

export function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (_loadPromise) return _loadPromise;
  _loadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PDFJS_CDN;
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      resolve(window.pdfjsLib);
    };
    s.onerror = () => reject(new Error('Failed to load PDF.js'));
    document.head.appendChild(s);
  });
  return _loadPromise;
}

export class PdfRenderer {
  constructor() {
    this.pdfDoc = null;
    this.pageCount = 0;
    this.pageDims = [];   // [{ widthPt, heightPt }]
    this.rendered = new Map(); // pageIndex -> { canvas, scale }
    this.observer = null;
    this.onPageVisible = null; // callback(pageIndex)
  }

  async load(arrayBuffer) {
    const pdfjsLib = await loadPdfJs();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
    this.pdfDoc = await loadingTask.promise;
    this.pageCount = this.pdfDoc.numPages;
    this.pageDims = [];
    for (let i = 1; i <= this.pageCount; i++) {
      const page = await this.pdfDoc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      this.pageDims.push({ widthPt: vp.width, heightPt: vp.height });
      page.cleanup();
    }
    return { pageCount: this.pageCount, pageDims: this.pageDims };
  }

  /**
   * Render a page to a canvas at the given scale.
   * Returns the canvas element.
   */
  async renderPage(pageIndex, scale, canvas) {
    const page = await this.pdfDoc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup();
    this.rendered.set(pageIndex, { canvas, scale });
    return canvas;
  }

  /** Release a page's canvas to free memory. */
  disposePage(pageIndex) {
    const entry = this.rendered.get(pageIndex);
    if (entry) {
      entry.canvas.width = 0;
      entry.canvas.height = 0;
      this.rendered.delete(pageIndex);
    }
  }

  /** Get text content for search. Returns array of { str, transform }. */
  async getPageText(pageIndex) {
    const page = await this.pdfDoc.getPage(pageIndex + 1);
    const tc = await page.getTextContent();
    page.cleanup();
    return tc.items.map(it => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
    }));
  }

  destroy() {
    for (const idx of [...this.rendered.keys()]) this.disposePage(idx);
    if (this.pdfDoc) { this.pdfDoc.destroy(); this.pdfDoc = null; }
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
  }
}

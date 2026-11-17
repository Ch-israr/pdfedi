// Imperative PDF loading — the shared core behind usePdfDocument
// (one file) and usePdfFiles (many files). Loads a File's bytes into
// pdf.js, reads page count + sizes, and returns render functions
// backed by the thumbnail LRU cache. Caller must call destroy() when
// done (unmount / file replaced); the hook wrappers own that.
import {
  loadPdfDocument,
  renderPageDataUrl,
  type PdfDocument,
} from "./pdfjs";
import { getThumb, setThumb, thumbKey } from "./thumbnails";

export interface LoadedPdf {
  /** Stable id for cache keys and React keys. */
  fileId: string;
  fileName: string;
  fileSize: number;
  pageCount: number;
  /** Page sizes in PDF points, index 0 = page 1. */
  pageSizes: Array<{ width: number; height: number }>;
  /** Render a page thumbnail (long side ~widthPx) as a data URL. */
  renderThumb: (pageNum: number, widthPx?: number) => Promise<string | null>;
  /** Render a page at an absolute scale (1 = 72 DPI) as a data URL. */
  renderPage: (pageNum: number, scale?: number) => Promise<string | null>;
  /** Release the pdf.js document. Render calls after this return null. */
  destroy: () => Promise<void>;
}

let fileCounter = 0;

export async function loadPdfFile(file: File): Promise<LoadedPdf> {
  const fileId = `f${++fileCounter}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const bytes = await file.arrayBuffer();
  const doc: PdfDocument = await loadPdfDocument(bytes);
  const pageCount = doc.numPages;
  const pageSizes: Array<{ width: number; height: number }> = [];
  for (let n = 1; n <= pageCount; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    pageSizes.push({ width: vp.width, height: vp.height });
    page.cleanup();
  }
  let destroyed = false;
  return {
    fileId,
    fileName: file.name,
    fileSize: file.size,
    pageCount,
    pageSizes,
    renderThumb: async (pageNum, widthPx = 180) => {
      if (destroyed) return null;
      const key = thumbKey(fileId, pageNum, widthPx);
      const hit = getThumb(key);
      if (hit) return hit;
      const size = pageSizes[pageNum - 1];
      if (!size) return null;
      const scale = widthPx / Math.max(size.width, size.height);
      const url = await renderPageDataUrl(doc, pageNum, scale);
      setThumb(key, url);
      return url;
    },
    renderPage: async (pageNum, scale = 1) => {
      if (destroyed) return null;
      return renderPageDataUrl(doc, pageNum, scale);
    },
    destroy: async () => {
      destroyed = true;
      await doc.destroy();
    },
  };
}

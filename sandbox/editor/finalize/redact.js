/**
 * True redaction: rasterize redacted pages and rebuild them from pixels.
 *
 * Why: pdf-lib cannot surgically remove text from content streams.
 * Drawing a black box over text leaves it selectable/extractable (fake).
 * Rebuilding the page from a rendered image guarantees nothing leaks,
 * because nothing is copied from the source objects.
 *
 * Only pages with redact_rects operations are rasterized. All other
 * pages are copied untouched (vector quality preserved).
 *
 * MANDATORY verification: after rebuild, re-parse the output and assert
 * zero extractable text on redacted pages before allowing download.
 */

import { PdfRenderer } from '../render/pdfjs-loader.js';

const REDACT_DPI = 300;
const REDACT_SCALE = REDACT_DPI / 72;

/**
 * Apply redaction to a pdf-lib PDFDocument that has already been through
 * finalizeInBrowser (or to the original). Returns a new PDFDocument with
 * redacted pages replaced by rasterized versions.
 *
 * @param {Uint8Array} originalBytes - the ORIGINAL pdf bytes (for rendering)
 * @param {object} pdfDoc - pdf-lib PDFDocument (post other ops)
 * @param {Array} redactOps - manifest ops of type redact_rects
 * @param {Array} pageDims - [{widthPt, heightPt}] for original pages
 */
export async function applyRedaction(originalBytes, pdfDoc, redactOps, pageDims) {
  const { PDFDocument } = window.PDFLib;
  if (redactOps.length === 0) return pdfDoc;

  // Group rects by page
  const byPage = new Map();
  for (const op of redactOps) {
    if (!byPage.has(op.page)) byPage.set(op.page, []);
    byPage.get(op.page).push(...op.rects);
  }

  // Render each affected page at 300 DPI, paint black boxes
  const renderer = new PdfRenderer();
  await renderer.load(originalBytes.slice(0));

  const newDoc = await PDFDocument.create();
  const srcPages = pdfDoc.getPages();

  for (let i = 0; i < srcPages.length; i++) {
    const rects = byPage.get(i);
    if (!rects || rects.length === 0) {
      // Untouched page: copy as-is (preserves vectors)
      const [copied] = await newDoc.copyPages(pdfDoc, [i]);
      newDoc.addPage(copied);
      continue;
    }

    // Rasterize this page
    const dims = pageDims[i];
    const canvas = document.createElement('canvas');
    await renderer.renderPage(i, REDACT_SCALE, canvas);

    // Paint black boxes (convert PDF rects to canvas pixels)
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000000';
    for (const r of rects) {
      const px = r.x * REDACT_SCALE;
      const py = (dims.heightPt - r.y - r.h) * REDACT_SCALE;
      ctx.fillRect(px, py, r.w * REDACT_SCALE, r.h * REDACT_SCALE);
    }

    // Rebuild page from the image
    const pngBytes = await new Promise(res =>
      canvas.toBlob(b => b.arrayBuffer().then(res), 'image/png'));
    const img = await newDoc.embedPng(pngBytes);
    const page = newDoc.addPage([dims.widthPt, dims.heightPt]);
    page.drawImage(img, {
      x: 0, y: 0, width: dims.widthPt, height: dims.heightPt,
    });

    canvas.width = 0; canvas.height = 0; // free memory
  }

  renderer.destroy();
  return newDoc;
}

/**
 * Verify redaction: re-parse output bytes and assert no text is
 * extractable from the redacted pages. Returns { ok, failures }.
 */
export async function verifyRedaction(outputBytes, redactedPageIndices) {
  const renderer = new PdfRenderer();
  await renderer.load(outputBytes.slice(0));
  const failures = [];

  for (const idx of redactedPageIndices) {
    try {
      const items = await renderer.getPageText(idx);
      const text = items.map(t => t.str).join('').trim();
      if (text.length > 0) {
        failures.push({ page: idx, leakedChars: text.length });
      }
    } catch (e) {
      // If we can't parse the page, treat as failure (fail closed)
      failures.push({ page: idx, error: String(e) });
    }
  }

  renderer.destroy();
  return { ok: failures.length === 0, failures };
}

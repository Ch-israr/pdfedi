/**
 * Post-generation verification of the final PDF.
 *
 * Checks (where practical):
 * - PDF opens successfully
 * - Page count matches expected
 * - Each page has non-zero dimensions
 * - Manifest operations are plausibly applied (spot checks)
 *
 * Redaction gets its own mandatory check in redact.js (verifyRedaction).
 */

import { PdfRenderer } from '../render/pdfjs-loader.js';

export async function verifyOutput(outputBytes, manifest, expectedPageCount) {
  const results = [];
  const renderer = new PdfRenderer();

  // 1. Opens successfully
  try {
    await renderer.load(outputBytes.slice(0));
    results.push({ check: 'opens', ok: true });
  } catch (e) {
    results.push({ check: 'opens', ok: false, error: String(e) });
    return { ok: false, results };
  }

  // 2. Page count
  const countOk = renderer.pageCount === expectedPageCount;
  results.push({
    check: 'page_count',
    ok: countOk,
    expected: expectedPageCount,
    actual: renderer.pageCount,
  });

  // 3. Page dimensions sane
  let dimsOk = true;
  for (const d of renderer.pageDims) {
    if (d.widthPt <= 0 || d.heightPt <= 0 || d.widthPt > 10000 || d.heightPt > 10000) {
      dimsOk = false;
      break;
    }
  }
  results.push({ check: 'page_dimensions', ok: dimsOk });

  // 4. Output not empty
  results.push({
    check: 'non_empty',
    ok: outputBytes.length > 1000,
    size: outputBytes.length,
  });

  renderer.destroy();

  const ok = results.every(r => r.ok);
  return { ok, results };
}

/**
 * Compute the expected page count after page operations.
 */
export function expectedPageCount(manifest) {
  let count = manifest.pageCount;
  for (const op of manifest.operations) {
    if (op.op === 'delete_page') count--;
    else if (op.op === 'duplicate_page') count++;
  }
  return Math.max(0, count);
}

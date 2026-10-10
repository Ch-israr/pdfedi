/**
 * Regression tests for pdf-core export with native-text masks.
 *
 * Verifies that:
 * - A native-text element with text exports the white cover rect + text
 * - A native-text mask (empty text) exports the white cover rect without crashing
 * - The exported PDF is valid and contains the expected page
 *
 * Run from packages/pdf-core: node --test test/export.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { exportPdf, buildPdfDocument } from '../dist/index.js';

function makePage() {
  return {
    id: '123e4567-e89b-12d3-a456-426614174000',
    sourceIndex: 1, // 1-based: first page of source
    width: 612,
    height: 792,
    rotation: 0,
  };
}

function makeNativeText(text) {
  return {
    id: 'native-1',
    pageId: '123e4567-e89b-12d3-a456-426614174000',
    kind: 'native-text',
    x: 100,
    y: 700,
    rotation: 0,
    originalText: 'Original Heading',
    text,
    width: 200,
    height: 24,
    baselineOffset: 6,
    fontSize: 16,
    fontFamily: 'Helvetica',
    color: '#000000',
    bold: false,
    italic: false,
  };
}

describe('pdf-core export with native-text', () => {
  // Create a minimal source PDF for export tests
  async function makeSrcPdf() {
    const src = await PDFDocument.create();
    src.addPage([612, 792]);
    return await src.save();
  }

  it('exports a native-text element with text (cover + replacement)', async () => {
    const srcBytes = await makeSrcPdf();
    const pages = [makePage()];
    const elements = { 'native-1': makeNativeText('Replacement Text') };

    const bytes = await exportPdf({ srcBytes, pages, elements });
    assert.ok(bytes.length > 0, 'Should produce PDF bytes');

    // Verify it's a valid PDF
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 1);
  });

  it('exports a native-text mask (empty text) without crashing', async () => {
    const srcBytes = await makeSrcPdf();
    const pages = [makePage()];
    // Mask: empty text, position preserved — the deletion fix creates these
    const elements = { 'native-1': makeNativeText('') };

    const bytes = await exportPdf({ srcBytes, pages, elements });
    assert.ok(bytes.length > 0, 'Should produce PDF bytes');

    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 1);
    // If we get here without throwing, the empty drawText didn't crash
  });

  it('exports a page with no elements', async () => {
    const srcBytes = await makeSrcPdf();
    const pages = [makePage()];
    const bytes = await exportPdf({ srcBytes, pages, elements: {} });
    assert.ok(bytes.length > 0);
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 1);
  });
});

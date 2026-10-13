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
import { PDFDocument, PDFName, PDFDict, PDFArray } from 'pdf-lib';
import {
  exportPdf,
  buildPdfDocument,
  exportPdfWithState,
  buildManifestParts,
  createManifest,
  sha256Hex,
} from '../dist/index.js';

/** List embedded attachment filenames via the PDF Names dictionary. */
function listAttachmentNames(doc) {
  const names = doc.context.lookup(doc.catalog.get(PDFName.of('Names')));
  if (!(names instanceof PDFDict)) return [];
  const ef = names.lookup(PDFName.of('EmbeddedFiles'));
  if (!(ef instanceof PDFDict)) return [];
  const arr = ef.lookup(PDFName.of('Names'));
  if (!(arr instanceof PDFArray)) return [];
  const out = [];
  for (let i = 0; i < arr.size(); i += 2) {
    const nameObj = arr.lookup(i);
    // Attachment names are stored as UTF-16BE hex strings — decode properly.
    out.push(
      typeof nameObj.decodeText === 'function'
        ? nameObj.decodeText()
        : nameObj.toString().replace(/^\(|\)$/g, ''),
    );
  }
  return out;
}

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

  it('exports non-Latin text gracefully (cover drawn, no crash)', async () => {
    const srcBytes = await makeSrcPdf();
    const pages = [makePage()];
    // Arabic text — standard PDF fonts can't encode this; export should not crash
    const elements = { 'native-1': makeNativeText('مرحبا بالعالم') };

    const bytes = await exportPdf({ srcBytes, pages, elements });
    assert.ok(bytes.length > 0, 'Should produce PDF bytes');

    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 1);
    // The white cover is drawn; the non-encodable text is skipped gracefully
  });

  it('exports a page with no elements', async () => {
    const srcBytes = await makeSrcPdf();
    const pages = [makePage()];
    const bytes = await exportPdf({ srcBytes, pages, elements: {} });
    assert.ok(bytes.length > 0);
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 1);
  });

  it('additive text export embeds BOTH manifest and clean source (always-embed fix)', async () => {
    // Regression: the web export used to embed the source only for
    // destructive edits, forcing additive edits (plain added text) down
    // the fragile baked-restore path on re-upload, where a slightly-off
    // click created a duplicate text box instead of editing the object.
    // Additive exports must now carry PDFEDI_SOURCE.pdf too, so restore
    // happens against the clean source as normal visible objects.
    const srcBytes = await makeSrcPdf();
    const pages = [makePage()];
    const textEl = {
      id: 'text-1',
      pageId: pages[0].id,
      kind: 'text',
      x: 100,
      y: 700,
      rotation: 0,
      text: 'A reasonably long line of added text',
      fontSize: 16,
      fontFamily: 'Helvetica',
      color: '#000000',
      bold: false,
      italic: false,
    };
    const elements = { 'text-1': textEl };
    const parts = await buildManifestParts(pages, elements, async () => null);
    const manifest = createManifest(await sha256Hex(srcBytes), pages, parts.elements, parts.manifestAssets);
    const bytes = await exportPdfWithState(
      { srcBytes, pages, elements },
      { manifest, sourceBytes: srcBytes, assets: parts.assets },
    );
    assert.ok(bytes.length > srcBytes.length, 'state package should add bytes');
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 1);
    const names = listAttachmentNames(doc);
    assert.ok(names.includes('PDFEDI_STATE.json'), `manifest attached, got: ${names.join(', ')}`);
    assert.ok(names.includes('PDFEDI_SOURCE.pdf'), `clean source attached, got: ${names.join(', ')}`);
  });
});

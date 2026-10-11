/**
 * Tests for direct content-stream text editing (no masks):
 * - probeDirectTextEdit locates a fragment's run in the content stream
 * - exportAnnotatedPdf REMOVES the original run and writes the
 *   replacement as real content: changed text, moved text (verbatim
 *   re-emission), and deletions leave nothing behind
 * - added text is written as content too, so it re-probes as an
 *   ordinary directly-editable run after re-upload
 * - no annotations are produced for text edits
 *
 * Run from packages/pdf-core: node --test test/direct-text.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib';
import {
  exportAnnotatedPdf,
  parsePdfediAnnotations,
  probeDirectTextEdit,
  findDirectRun,
} from '../dist/index.js';

const PAGE_ID = '123e4567-e89b-12d3-a456-426614174000';
const NATIVE_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const BASELINE = { x: 100, y: 700 };
const BASELINE_OFFSET = 4.2; // 0.3 * 14

function makePage() {
  return { id: PAGE_ID, sourceIndex: 1, width: 612, height: 792, rotation: 0 };
}

/** A "Word-like" source: real text runs in the content stream. */
async function makeSource(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Hello World', { x: BASELINE.x, y: BASELINE.y, size: 14, font, color: rgb(0.2, 0.3, 0.4) });
  page.drawText('Unrelated line', { x: 100, y: 650, size: 12, font });
  return doc.save();
}

function nativeEl(overrides: Record<string, unknown> = {}) {
  return {
    id: NATIVE_ID,
    pageId: PAGE_ID,
    kind: 'native-text',
    x: BASELINE.x,
    y: BASELINE.y - BASELINE_OFFSET,
    width: 90,
    height: 21.7,
    baselineOffset: BASELINE_OFFSET,
    originalText: 'Hello World',
    text: 'Hello World',
    fontSize: 14,
    fontFamily: 'Helvetica',
    color: '#334D66',
    bold: false,
    italic: false,
    rotation: 0,
    originX: BASELINE.x,
    originY: BASELINE.y - BASELINE_OFFSET,
    ...overrides,
  };
}

async function runsOf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc;
}

describe('probeDirectTextEdit', () => {
  it('finds a decodable run at its baseline', async () => {
    const src = await makeSource();
    const probe = await probeDirectTextEdit(src, 0, { text: 'Hello World', baselineX: 100, baselineY: 700 });
    assert.equal(probe.editable, true);
    assert.equal(probe.fontSize, 14);
  });

  it('rejects a fragment that is not there', async () => {
    const src = await makeSource();
    const probe = await probeDirectTextEdit(src, 0, { text: 'Not Present', baselineX: 100, baselineY: 700 });
    assert.equal(probe.editable, false);
    assert.ok(probe.reason);
  });

  it('rejects a matching text at the wrong position', async () => {
    const src = await makeSource();
    const probe = await probeDirectTextEdit(src, 0, { text: 'Hello World', baselineX: 300, baselineY: 300 });
    assert.equal(probe.editable, false);
  });
});

describe('direct export', () => {
  it('changed text: original run removed, replacement is content, no annotations', async () => {
    const src = await makeSource();
    const out = await exportAnnotatedPdf({
      srcBytes: src,
      pages: [makePage()],
      elements: { [NATIVE_ID]: nativeEl({ text: 'Hello There' }) },
    });
    const doc = await runsOf(out);
    const oldRun = findDirectRun(doc, 0, { text: 'Hello World', baselineX: 100, baselineY: 700 });
    assert.equal(oldRun.status, 'not-editable'); // gone
    const newRun = findDirectRun(doc, 0, { text: 'Hello There', baselineX: 100, baselineY: 700 });
    assert.equal(newRun.status, 'ok'); // real content, directly editable again
    const other = findDirectRun(doc, 0, { text: 'Unrelated line', baselineX: 100, baselineY: 650 });
    assert.equal(other.status, 'ok'); // neighbours untouched
    const parsed = await parsePdfediAnnotations(out);
    assert.equal(parsed.length, 0); // no annotation pair, no mask
  });

  it('moved unchanged text: verbatim run at the new position only', async () => {
    const src = await makeSource();
    const out = await exportAnnotatedPdf({
      srcBytes: src,
      pages: [makePage()],
      elements: {
        [NATIVE_ID]: nativeEl({ x: BASELINE.x + 40, y: BASELINE.y - BASELINE_OFFSET - 30 }),
      },
    });
    const doc = await runsOf(out);
    const atOld = findDirectRun(doc, 0, { text: 'Hello World', baselineX: 100, baselineY: 700 });
    assert.equal(atOld.status, 'not-editable');
    const atNew = findDirectRun(doc, 0, { text: 'Hello World', baselineX: 140, baselineY: 670 });
    assert.equal(atNew.status, 'ok');
    const parsed = await parsePdfediAnnotations(out);
    assert.equal(parsed.length, 0);
  });

  it('deleted text: run removed, nothing drawn, no mask annotation', async () => {
    const src = await makeSource();
    const out = await exportAnnotatedPdf({
      srcBytes: src,
      pages: [makePage()],
      elements: { [NATIVE_ID]: nativeEl({ text: '' }) },
    });
    const doc = await runsOf(out);
    const gone = findDirectRun(doc, 0, { text: 'Hello World', baselineX: 100, baselineY: 700 });
    assert.equal(gone.status, 'not-editable');
    const parsed = await parsePdfediAnnotations(out);
    assert.equal(parsed.length, 0);
  });

  it('multiline added text is drawn as one block per line', async () => {
    const src = await makeSource();
    const TEXT_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
    const out = await exportAnnotatedPdf({
      srcBytes: src,
      pages: [makePage()],
      elements: {
        [TEXT_ID]: {
          id: TEXT_ID,
          pageId: PAGE_ID,
          kind: 'text',
          x: 200,
          y: 500,
          text: 'Alpha\nBeta',
          fontSize: 16,
          fontFamily: 'Helvetica',
          color: '#000000',
          bold: false,
          italic: false,
          rotation: 0,
        },
      },
    });
    const doc = await runsOf(out);
    const line1 = findDirectRun(doc, 0, { text: 'Alpha', baselineX: 200, baselineY: 500 });
    assert.equal(line1.status, 'ok', 'first line is its own directly-editable run');
    const line2 = findDirectRun(doc, 0, { text: 'Beta', baselineX: 200, baselineY: 500 - 16 * 1.25 });
    assert.equal(line2.status, 'ok', 'second line is its own run one line-step lower');
  });

  it('T* advances the text position by the text leading', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('x', { x: 0, y: 0, size: 10, font }); // registers the font resource
    const resources = doc.context.lookup(page.node.get(PDFName.of('Resources')));
    const fonts = doc.context.lookup(resources.get(PDFName.of('Font')));
    const resName = [...fonts.entries()][0][0].toString().slice(1);
    const content =
      `BT /${resName} 14 Tf 24 TL 1 0 0 1 100 700 Tm (One) Tj T* (Two) Tj ET`;
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(content)));
    // Round-trip through save/load so indirect font objects resolve,
    // as in real documents.
    const reloaded = await PDFDocument.load(await doc.save());
    const { collectTextBlocks } = await import('../dist/index.js');
    const parsed = collectTextBlocks(reloaded, 0);
    assert.ok(parsed);
    assert.equal(parsed.blocks.length, 1);
    const [s1, s2] = parsed.blocks[0].shows;
    assert.equal(s1.text, 'One');
    assert.equal(Math.round(s1.originY), 700);
    assert.equal(s2.text, 'Two');
    assert.equal(Math.round(s2.originY), 676, 'T* moved down by the 24pt leading');
  });

  it('added text element is written as content and re-probes as editable', async () => {
    const src = await makeSource();
    const TEXT_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
    const out = await exportAnnotatedPdf({
      srcBytes: src,
      pages: [makePage()],
      elements: {
        [TEXT_ID]: {
          id: TEXT_ID,
          pageId: PAGE_ID,
          kind: 'text',
          x: 200,
          y: 500,
          text: 'Brand New',
          fontSize: 16,
          fontFamily: 'Helvetica',
          color: '#000000',
          bold: false,
          italic: false,
          rotation: 0,
        },
      },
    });
    const probe = await probeDirectTextEdit(out, 0, { text: 'Brand New', baselineX: 200, baselineY: 500 });
    assert.equal(probe.editable, true);
    const parsed = await parsePdfediAnnotations(out);
    assert.equal(parsed.length, 0); // no FreeText annotation anymore
  });
});

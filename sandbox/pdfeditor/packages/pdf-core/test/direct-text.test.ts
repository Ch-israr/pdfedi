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

describe('multi-show run matching (text split across operations)', () => {
  /** Raw page whose heading is split across two show ops, like round-tripped producer output. */
  async function makeSplitSource(): Promise<{ bytes: Uint8Array; resName: string }> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('x', { x: 0, y: 0, size: 10, font }); // registers the font resource
    const resources = doc.context.lookup(page.node.get(PDFName.of('Resources')));
    const fonts = doc.context.lookup(resources.get(PDFName.of('Font')));
    const resName = [...fonts.entries()][0][0].toString().slice(1);
    const content =
      `BT /${resName} 14 Tf 1 0 0 1 100 700 Tm (Hello ) Tj (World) Tj ET\n` +
      `BT /${resName} 12 Tf 1 0 0 1 100 650 Tm (Unrelated line) Tj ET`;
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(content)));
    const bytes = await doc.save();
    return { bytes, resName };
  }

  it('matches a fragment split across two show ops', async () => {
    const { bytes } = await makeSplitSource();
    const doc = await PDFDocument.load(bytes);
    const res = findDirectRun(doc, 0, { text: 'Hello World', baselineX: 100, baselineY: 700 });
    assert.equal(res.status, 'ok');
    assert.equal(res.run.spans.length, 2);
    assert.equal(res.run.movable, false, 'multi-show runs are editable but not movable');
    assert.equal(res.run.decodedText, 'Hello World');
  });

  it('export removes every show op of a split run and draws the replacement as content', async () => {
    const { bytes } = await makeSplitSource();
    const out = await exportAnnotatedPdf({
      srcBytes: bytes,
      pages: [makePage()],
      elements: { [NATIVE_ID]: nativeEl({ text: 'Hi There' }) },
    });
    const doc = await PDFDocument.load(out);
    const oldRun = findDirectRun(doc, 0, { text: 'Hello World', baselineX: 100, baselineY: 700 });
    assert.equal(oldRun.status, 'not-editable', 'both original show ops are gone');
    const partial = findDirectRun(doc, 0, { text: 'Hello ', baselineX: 100, baselineY: 700 });
    assert.equal(partial.status, 'not-editable', 'no leftover fragment remains');
    const newRun = findDirectRun(doc, 0, { text: 'Hi There', baselineX: 100, baselineY: 700 });
    assert.equal(newRun.status, 'ok', 'replacement is real content');
    const other = findDirectRun(doc, 0, { text: 'Unrelated line', baselineX: 100, baselineY: 650 });
    assert.equal(other.status, 'ok', 'neighbouring block untouched');
    const parsed = await parsePdfediAnnotations(out);
    assert.equal(parsed.length, 0, 'no annotation pair, no mask');
  });

  it('merges shows with different fonts when size/colour/baseline match', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const times = await doc.embedFont(StandardFonts.TimesRoman);
    page.drawText('x', { x: 0, y: 0, size: 10, font: helv });
    page.drawText('x', { x: 0, y: 0, size: 10, font: times });
    const resources = doc.context.lookup(page.node.get(PDFName.of('Resources')));
    const fonts = doc.context.lookup(resources.get(PDFName.of('Font')));
    const names = [...fonts.entries()].map(([k]) => k.toString().slice(1));
    const content =
      `BT /${names[0]} 14 Tf 1 0 0 1 100 700 Tm (Hello ) Tj /${names[1]} 14 Tf (World) Tj ET`;
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(content)));
    const reloaded = await PDFDocument.load(await doc.save());
    const res = findDirectRun(reloaded, 0, { text: 'Hello World', baselineX: 100, baselineY: 700 });
    assert.equal(res.status, 'ok', 'font substitution splits no longer block editing');
    assert.equal(res.run.spans.length, 2);
  });

  it('does not merge shows on different baselines', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('x', { x: 0, y: 0, size: 10, font });
    const resources = doc.context.lookup(page.node.get(PDFName.of('Resources')));
    const fonts = doc.context.lookup(resources.get(PDFName.of('Font')));
    const resName = [...fonts.entries()][0][0].toString().slice(1);
    const content =
      `BT /${resName} 14 Tf 1 0 0 1 100 700 Tm (Hello ) Tj 0 -20 Td (World) Tj ET`;
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(content)));
    const reloaded = await PDFDocument.load(await doc.save());
    const res = findDirectRun(reloaded, 0, { text: 'Hello World', baselineX: 100, baselineY: 700 });
    assert.equal(res.status, 'not-editable');
  });

  it('disambiguates two identical split runs by baseline origin', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('x', { x: 0, y: 0, size: 10, font });
    const resources = doc.context.lookup(page.node.get(PDFName.of('Resources')));
    const fonts = doc.context.lookup(resources.get(PDFName.of('Font')));
    const resName = [...fonts.entries()][0][0].toString().slice(1);
    const content =
      `BT /${resName} 14 Tf 1 0 0 1 100 700 Tm (Hello ) Tj (World) Tj ET\n` +
      `BT /${resName} 14 Tf 1 0 0 1 100 600 Tm (Hello ) Tj (World) Tj ET`;
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(content)));
    const reloaded = await PDFDocument.load(await doc.save());
    const near = findDirectRun(reloaded, 0, { text: 'Hello World', baselineX: 100, baselineY: 600 });
    assert.equal(near.status, 'ok');
    assert.equal(Math.round(near.run.originY), 600);
  });
});

describe('match-guard refinements (trailing whitespace, mixed fonts)', () => {
  async function makeCustomSource(content: string): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const times = await doc.embedFont(StandardFonts.TimesRoman);
    page.drawText('x', { x: 0, y: 0, size: 10, font: helv });
    page.drawText('x', { x: 0, y: 0, size: 10, font: times });
    const resources = doc.context.lookup(page.node.get(PDFName.of('Resources')));
    const fonts = doc.context.lookup(resources.get(PDFName.of('Font')));
    const names = [...fonts.entries()].map(([k]) => k.toString().slice(1));
    const filled = content.replaceAll('$F1', names[0]).replaceAll('$F2', names[1]);
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(filled)));
    return doc.save();
  }

  it('matches when the stream has a trailing space PDF.js does not report', async () => {
    const bytes = await makeCustomSource(
      `BT /$F1 14 Tf 1 0 0 1 100 700 Tm (Isra muammed ) Tj ET`,
    );
    const doc = await PDFDocument.load(bytes);
    // PDF.js reports "Isra muammed" (no trailing space) — the old
    // exact-equality match refused this.
    const res = findDirectRun(doc, 0, { text: 'Isra muammed', baselineX: 100, baselineY: 700 });
    assert.equal(res.status, 'ok');
  });

  it('merges shows that differ only by font resource (glyph-substitution split)', async () => {
    const bytes = await makeCustomSource(
      `BT /$F1 18 Tf 1 0 0 1 100 700 Tm (Globe Link Int) Tj /$F2 18 Tf (\x92) Tj /$F1 18 Tf (l) Tj ET`,
    );
    const doc = await PDFDocument.load(bytes);
    const res = findDirectRun(doc, 0, { text: 'Globe Link Int\u2019l', baselineX: 100, baselineY: 700 });
    assert.equal(res.status, 'ok');
    assert.equal(res.run.spans.length, 3, 'all three show ops claimed');
    assert.equal(res.run.movable, false);
  });

  it('export removes every show op of a mixed-font run', async () => {
    const bytes = await makeCustomSource(
      `BT /$F1 18 Tf 1 0 0 1 100 700 Tm (Globe Link Int) Tj /$F2 18 Tf (\x92) Tj /$F1 18 Tf (l) Tj ET`,
    );
    const out = await exportAnnotatedPdf({
      srcBytes: bytes,
      pages: [makePage()],
      elements: {
        [NATIVE_ID]: nativeEl({
          originalText: 'Globe Link Int\u2019l',
          text: 'Globe Link Edited',
          x: 100,
          y: 700 - BASELINE_OFFSET,
          originX: 100,
          originY: 700 - BASELINE_OFFSET,
        }),
      },
    });
    const doc = await PDFDocument.load(out);
    const leftover = findDirectRun(doc, 0, { text: 'Globe Link Int\u2019l', baselineX: 100, baselineY: 700 });
    assert.equal(leftover.status, 'not-editable', 'all original show ops gone');
    const fresh = findDirectRun(doc, 0, { text: 'Globe Link Edited', baselineX: 100, baselineY: 700 });
    assert.equal(fresh.status, 'ok', 'replacement is real content');
  });

  it('still refuses when sizes differ across the split', async () => {
    const bytes = await makeCustomSource(
      `BT /$F1 18 Tf 1 0 0 1 100 700 Tm (Hello ) Tj /$F1 24 Tf (World) Tj ET`,
    );
    const doc = await PDFDocument.load(bytes);
    const res = findDirectRun(doc, 0, { text: 'Hello World', baselineX: 100, baselineY: 700 });
    assert.equal(res.status, 'not-editable', 'size guard still enforced');
  });
});

describe('link annotation export/restore', () => {
  it('writes a /Link annotation with URI action and restores it', async () => {
    const out = await exportAnnotatedPdf({
      srcBytes: await makeSource('hello'),
      pages: [makePage()],
      elements: {
        [NATIVE_ID]: nativeEl({}),
        'aaaaaaaa-1111-4222-8222-222222222222': {
          id: 'aaaaaaaa-1111-4222-8222-222222222222',
          pageId: makePage().id,
          kind: 'link',
          x: 100,
          y: 600,
          rotation: 0,
          width: 120,
          height: 24,
          url: 'https://example.com/page',
        } as never,
      },
    });
    const parsed = await parsePdfediAnnotations(out);
    const link = parsed.find((p) => (p.element as { kind: string }).kind === 'link');
    assert.ok(link, 'link element restored from annotations');
    const el = link!.element as unknown as { url: string; x: number; y: number; width: number; height: number };
    assert.equal(el.url, 'https://example.com/page');
    assert.equal(el.x, 100);
    assert.equal(el.width, 120);
  });
});

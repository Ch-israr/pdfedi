/**
 * Regression tests for the P0 silent-text-loss defect (2026-10-15):
 * editing existing PDF text with characters the standard fonts cannot
 * write (Arabic, Urdu, …) used to remove the original run at export
 * while the replacement silently failed to draw — the exported PDF
 * lost the text with no error anywhere.
 *
 * Contract under test:
 * - findUnencodableChars agrees with pdf-lib's own WinAnsi encoding.
 * - An unwritable replacement is NEVER applied destructively: the
 *   export keeps the original run and reports the failed edit.
 * - Writable replacements (incl. accented Latin) apply normally.
 * - The probe reports the run's real font identity so the editor can
 *   seed the closest standard family + weight + exact size, and the
 *   exported replacement carries them.
 *
 * Run from packages/pdf-core: node --test test/native-edit-safety.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  exportAnnotatedPdf,
  exportAnnotatedPdfWithReport,
  probeDirectTextEdit,
  findDirectRun,
  collectTextBlocks,
  editorFontForPdfFont,
  findUnencodableChars,
} from '../dist/index.js';

const PAGE_ID = '123e4567-e89b-12d3-a456-426614174000';
const NATIVE_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const BASE = { x: 100, y: 700 };
const OFFSET = 4.2; // 0.3 * 14

function makePage() {
  return { id: PAGE_ID, sourceIndex: 1, width: 612, height: 792, rotation: 0 };
}

/** Source with a Latin fragment in Helvetica and one in a serif bold. */
async function makeSource(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const timesBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  page.drawText('Hello World', { x: BASE.x, y: BASE.y, size: 14, font: helv, color: rgb(0.2, 0.3, 0.4) });
  page.drawText('Customer', { x: 60, y: 640, size: 9.96, font: timesBold });
  page.drawText('SELF STORAGE AGREEMENT', {
    x: 100, y: 740, size: 14.04, font: timesBold,
    color: rgb(27 / 255, 54 / 255, 93 / 255),
  });
  return doc.save();
}

function nativeEl(overrides: Record<string, unknown> = {}) {
  return {
    id: NATIVE_ID,
    pageId: PAGE_ID,
    kind: 'native-text',
    x: BASE.x,
    y: BASE.y - OFFSET,
    width: 90,
    height: 21.7,
    baselineOffset: OFFSET,
    originalText: 'Hello World',
    text: 'Hello World',
    fontSize: 14,
    fontFamily: 'Helvetica',
    color: '#334D66',
    bold: false,
    italic: false,
    rotation: 0,
    originX: BASE.x,
    originY: BASE.y - OFFSET,
    ...overrides,
  };
}

async function exportWith(el: Record<string, unknown>, src?: Uint8Array) {
  const bytes = src ?? (await makeSource());
  return exportAnnotatedPdfWithReport({
    srcBytes: bytes,
    pages: [makePage()],
    elements: { [NATIVE_ID]: el },
  } as never);
}

async function runStatus(bytes: Uint8Array, text: string, x: number, y: number) {
  const doc = await PDFDocument.load(bytes);
  return findDirectRun(doc, 0, { text, baselineX: x, baselineY: y });
}

// ---------------------------------------------------------------------------
// findUnencodableChars
// ---------------------------------------------------------------------------

describe('findUnencodableChars', () => {
  it('accepts plain Latin, accented Latin and WinAnsi punctuation', () => {
    assert.deepEqual(findUnencodableChars('Hello World'), []);
    assert.deepEqual(findUnencodableChars('Café naïve façade — “quoted” € … • ™'), []);
    assert.deepEqual(findUnencodableChars('ÀÉÎÕÜ ßœ Ÿ'), []);
    assert.deepEqual(findUnencodableChars('line one\nline two'), []);
  });

  it('flags Arabic, Urdu, CJK, Greek, Cyrillic and emoji, deduped in order', () => {
    assert.deepEqual(findUnencodableChars('Customer عربي'), ['ع', 'ر', 'ب', 'ي']);
    assert.deepEqual(findUnencodableChars('اردو'), ['ا', 'ر', 'د', 'و']);
    assert.deepEqual(findUnencodableChars('中文'), ['中', '文']);
    assert.deepEqual(findUnencodableChars('αβ'), ['α', 'β']);
    assert.deepEqual(findUnencodableChars('Ж'), ['Ж']);
    assert.deepEqual(findUnencodableChars('ok 😀😀'), ['😀']);
  });

  it('agrees with pdf-lib’s own WinAnsi encoding on a broad corpus', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const corpus =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
      'àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞß' +
      '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ ¡¢£¤¥¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿' +
      'ĀāĂăĄąĆćĈĉĊċČčĎďĐđĒēĖėĘęĚěĜĝĞğĠġĢģĤĥĦħĨĩĪīĬĭĮįİı' + // Latin Extended-A: NOT in WinAnsi
      'αβγΩабвЖ€';
    for (const ch of corpus) {
      let libCan = true;
      try {
        font.encodeText(ch);
      } catch {
        libCan = false;
      }
      const mine = findUnencodableChars(ch).length === 0;
      assert.equal(mine, libCan, `disagreement on U+${ch.codePointAt(0)!.toString(16)} (${ch})`);
    }
  });
});

// ---------------------------------------------------------------------------
// The P0 defect: unwritable replacements must not destroy the original
// ---------------------------------------------------------------------------

describe('native edit with unwritable replacement (P0)', () => {
  it('Arabic replacement: original run survives, edit reported, nothing drawn instead', async () => {
    const el = nativeEl({
      originalText: 'Customer',
      text: 'Customer عربي',
      x: 60, y: 640 - 2.99, originX: 60, originY: 640 - 2.99,
      baselineOffset: 2.99, fontSize: 9.96, width: 50, height: 15,
    });
    const { bytes, report } = await exportWith(el);
    assert.equal(report.failedNativeEdits.length, 1);
    assert.equal(report.failedNativeEdits[0].elementId, NATIVE_ID);
    assert.equal(report.failedNativeEdits[0].originalText, 'Customer');
    assert.ok(report.failedNativeEdits[0].unsupportedChars.includes('ع'));
    // The original fragment is still a real, locatable run in the output.
    const orig = await runStatus(bytes, 'Customer', 60, 640);
    assert.equal(orig.status, 'ok');
    // And no replacement text was drawn in its place.
    const parsed = collectTextBlocks((await PDFDocument.load(bytes)) as never, 0);
    const allText = parsed!.blocks.flatMap((b) => b.shows.map((s) => s.text)).join('|');
    assert.ok(!allText.includes('عربي'), 'replacement must not appear');
  });

  it('mixed Latin + Arabic: the whole edit is refused, not partially applied', async () => {
    const el = nativeEl({ text: 'Hello عربي World' });
    const { bytes, report } = await exportWith(el);
    assert.equal(report.failedNativeEdits.length, 1);
    assert.equal((await runStatus(bytes, 'Hello World', BASE.x, BASE.y)).status, 'ok');
  });

  it('Urdu replacement: original survives and is reported', async () => {
    const el = nativeEl({ text: 'Hello اردو' });
    const { bytes, report } = await exportWith(el);
    assert.equal(report.failedNativeEdits.length, 1);
    assert.equal((await runStatus(bytes, 'Hello World', BASE.x, BASE.y)).status, 'ok');
  });

  it('plain exportAnnotatedPdf (no report) also preserves the original', async () => {
    const src = await makeSource();
    const el = nativeEl({ text: 'Hello عربي' });
    const bytes = await exportAnnotatedPdf({
      srcBytes: src,
      pages: [makePage()],
      elements: { [NATIVE_ID]: el },
    } as never);
    assert.equal((await runStatus(bytes, 'Hello World', BASE.x, BASE.y)).status, 'ok');
  });

  it('a deletion (empty text) is NOT a failure and still removes the run', async () => {
    const el = nativeEl({ text: '' });
    const { bytes, report } = await exportWith(el);
    assert.equal(report.failedNativeEdits.length, 0);
    assert.notEqual((await runStatus(bytes, 'Hello World', BASE.x, BASE.y)).status, 'ok');
  });

  it('revert contract: exporting without the failed element leaves the source untouched', async () => {
    const src = await makeSource();
    const { bytes } = await exportAnnotatedPdfWithReport({
      srcBytes: src,
      pages: [makePage()],
      elements: {},
    } as never);
    assert.equal((await runStatus(bytes, 'Hello World', BASE.x, BASE.y)).status, 'ok');
    assert.equal((await runStatus(bytes, 'Customer', 60, 640)).status, 'ok');
  });
});

// ---------------------------------------------------------------------------
// Writable replacements still apply
// ---------------------------------------------------------------------------

describe('native edit with writable replacement', () => {
  it('accented Latin + punctuation replacement is written and the original removed', async () => {
    const el = nativeEl({ text: 'Héllo Wörld — “café” €' });
    const { bytes, report } = await exportWith(el);
    assert.equal(report.failedNativeEdits.length, 0);
    assert.equal((await runStatus(bytes, 'Héllo Wörld — “café” €', BASE.x, BASE.y)).status, 'ok');
    assert.notEqual((await runStatus(bytes, 'Hello World', BASE.x, BASE.y)).status, 'ok');
  });
});

// ---------------------------------------------------------------------------
// Font identity: probe mapping + preservation into the export
// ---------------------------------------------------------------------------

describe('editorFontForPdfFont', () => {
  it('maps embedded font names to the closest editor font with weight/style', () => {
    assert.deepEqual(editorFontForPdfFont('TimesNewRomanPS-BoldMT'), { fontFamily: 'Times New Roman', bold: true, italic: false });
    assert.deepEqual(editorFontForPdfFont('BCDHEE+Cambria-Bold'), { fontFamily: 'Times New Roman', bold: true, italic: false });
    assert.deepEqual(editorFontForPdfFont('BCDFEE+Calibri-Bold'), { fontFamily: 'Arial', bold: true, italic: false });
    assert.deepEqual(editorFontForPdfFont('ArialMT'), { fontFamily: 'Arial', bold: false, italic: false });
    assert.deepEqual(editorFontForPdfFont('CourierNewPS-ItalicMT'), { fontFamily: 'Courier New', bold: false, italic: true });
    assert.deepEqual(editorFontForPdfFont('Georgia-Bold'), { fontFamily: 'Georgia', bold: true, italic: false });
    assert.deepEqual(editorFontForPdfFont('BCDKEE+Algerian'), { fontFamily: 'Arial', bold: false, italic: false });
    assert.deepEqual(editorFontForPdfFont(undefined), { fontFamily: 'Arial', bold: false, italic: false });
  });
});

describe('font preservation through an edit', () => {
  it('probe reports the serif run’s identity, exact size and colour', async () => {
    const src = await makeSource();
    const probe = await probeDirectTextEdit(src, 0, {
      text: 'SELF STORAGE AGREEMENT', baselineX: 100, baselineY: 740,
    });
    assert.equal(probe.editable, true);
    assert.equal(probe.fontSize, 14.04);
    assert.equal(probe.colorHex, '#1B365D');
    assert.equal(probe.fontFamily, 'Times New Roman');
    assert.equal(probe.bold, true);
    assert.equal(probe.italic, false);
  });

  it('the exported replacement keeps family, weight, exact size and colour', async () => {
    const src = await makeSource();
    const probe = await probeDirectTextEdit(src, 0, {
      text: 'SELF STORAGE AGREEMENT', baselineX: 100, baselineY: 740,
    });
    // Seed the element exactly as the editor now does (from the probe).
    const el = nativeEl({
      originalText: 'SELF STORAGE AGREEMENT',
      text: 'SELF STORAGE AGREEMENT 2026',
      x: 100, y: 740 - 4.21, originX: 100, originY: 740 - 4.21,
      baselineOffset: 4.21, width: 260, height: 22,
      fontSize: probe.fontSize, fontFamily: probe.fontFamily,
      bold: probe.bold, italic: probe.italic, color: probe.colorHex,
    });
    const { bytes, report } = await exportWith(el, src);
    assert.equal(report.failedNativeEdits.length, 0);
    const res = await runStatus(bytes, 'SELF STORAGE AGREEMENT 2026', 100, 740);
    assert.equal(res.status, 'ok');
    if (res.status === 'ok') {
      assert.equal(res.run.fontSize, 14.04);
      assert.equal(res.run.colorHex, '#1B365D');
      assert.match(res.run.fontBaseName ?? '', /Times/i);
      assert.match(res.run.fontBaseName ?? '', /Bold/i);
    }
    // The original run is gone (replaced, not duplicated).
    assert.notEqual((await runStatus(bytes, 'SELF STORAGE AGREEMENT', 100, 740)).status, 'ok');
  });
});

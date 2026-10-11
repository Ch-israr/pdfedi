/**
 * Tests for PDF-native annotation persistence (replaces the JSON manifest
 * + embedded source approach):
 * - exportAnnotatedPdf writes elements as standard annotations with NO
 *   file attachments (no PDFEDI_STATE.json, no PDFEDI_SOURCE.pdf)
 * - parsePdfediAnnotations reconstructs the elements from standard entries
 * - a second export cycle neither duplicates annotations nor resurrects
 *   deleted ones, and preserves foreign (non-pdfedi) annotations
 *
 * Run from packages/pdf-core: node --test test/annotations.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, StandardFonts } from 'pdf-lib';
import { exportAnnotatedPdf, parsePdfediAnnotations } from '../dist/index.js';

const PAGE_ID = '123e4567-e89b-12d3-a456-426614174000';
const IDS = {
  text: 'aaaaaaaa-1111-4111-8111-111111111111',
  native: 'bbbbbbbb-2222-4222-8222-222222222222',
  highlight: 'cccccccc-3333-4333-8333-333333333333',
  rect: 'dddddddd-4444-4444-8444-444444444444',
  arrow: 'eeeeeeee-5555-4555-8555-555555555555',
  image: 'ffffffff-6666-4666-8666-666666666666',
};

function makePage() {
  return { id: PAGE_ID, sourceIndex: 1, width: 612, height: 792, rotation: 0 };
}

function tinyPngDataUrl() {
  const crc32 = (buf) => {
    let c, table = crc32.t;
    if (!table) {
      table = crc32.t = [];
      for (let n = 0; n < 256; n++) {
        c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 255, 255]);
  const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function makeSrcPdf() {
  const src = await PDFDocument.create();
  const page = src.addPage([612, 792]);
  const font = await src.embedFont(StandardFonts.Helvetica);
  page.drawText('Original native line', { x: 100, y: 700, size: 16, font });
  // A foreign annotation (no pdfedi name) that must survive exports.
  const link = src.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Link'),
    Rect: [100, 640, 300, 660],
    Border: [0, 0, 0],
    A: { Type: PDFName.of('Action'), S: PDFName.of('URI'), URI: PDFString.of('https://example.com/') },
  });
  page.node.set(PDFName.of('Annots'), src.context.obj([src.context.register(link)]));
  return src.save();
}

function makeElements() {
  return {
    [IDS.text]: {
      id: IDS.text, pageId: PAGE_ID, kind: 'text', x: 100, y: 600, rotation: 0,
      text: 'Hello annotations', fontSize: 14, fontFamily: 'Arial', color: '#FF0000', bold: true, italic: false,
      link: 'https://example.org/link',
    },
    [IDS.native]: {
      id: IDS.native, pageId: PAGE_ID, kind: 'native-text', x: 100, y: 695, rotation: 0,
      originalText: 'Original native line', text: 'Replacement line',
      width: 200, height: 24, baselineOffset: 5,
      fontSize: 16, fontFamily: 'Helvetica', color: '#000000', bold: false, italic: false,
    },
    [IDS.highlight]: {
      id: IDS.highlight, pageId: PAGE_ID, kind: 'highlight', x: 80, y: 550, rotation: 0,
      width: 150, height: 20, color: '#FFFF00', opacity: 0.4,
    },
    [IDS.rect]: {
      id: IDS.rect, pageId: PAGE_ID, kind: 'shape', shape: 'rect', x: 350, y: 500, rotation: 0,
      width: 120, height: 60, stroke: '#0000FF', strokeWidth: 3, fill: '#00FF00',
    },
    [IDS.arrow]: {
      id: IDS.arrow, pageId: PAGE_ID, kind: 'shape', shape: 'arrow', x: 350, y: 650, rotation: 0,
      width: 100, height: 40, stroke: '#000000', strokeWidth: 2, fill: null,
    },
    [IDS.image]: {
      id: IDS.image, pageId: PAGE_ID, kind: 'image', x: 450, y: 300, rotation: 0,
      src: tinyPngDataUrl(), width: 60, height: 60, mime: 'image/png',
    },
  };
}

function attachmentNames(doc) {
  const names = doc.context.lookup(doc.catalog.get(PDFName.of('Names')));
  if (!(names instanceof PDFDict)) return [];
  const ef = names.lookup(PDFName.of('EmbeddedFiles'));
  if (!(ef instanceof PDFDict)) return [];
  const arr = ef.lookup(PDFName.of('Names'));
  if (!(arr instanceof PDFArray)) return [];
  const out = [];
  for (let i = 0; i < arr.size(); i += 2) {
    const o = arr.lookup(i);
    out.push(typeof o.decodeText === 'function' ? o.decodeText() : o.toString());
  }
  return out;
}

function allAnnotNMs(doc) {
  const nms = [];
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const a = doc.context.lookup(annots.get(i));
      const nm = a?.lookup?.(PDFName.of('NM'));
      nms.push(nm && typeof nm.decodeText === 'function' ? nm.decodeText() : null);
    }
  }
  return nms;
}

const near = (a, b, tol = 0.75) => Math.abs(a - b) <= tol;

describe('annotation persistence', () => {
  it('exports elements as annotations with NO manifest/source attachments', async () => {
    const srcBytes = await makeSrcPdf();
    const bytes = await exportAnnotatedPdf({ srcBytes, pages: [makePage()], elements: makeElements() });
    const doc = await PDFDocument.load(bytes);
    assert.deepEqual(attachmentNames(doc), [], 'no embedded files at all');
    const nms = allAnnotNMs(doc);
    // foreign link preserved + pdfedi link also present, so >= 7 annots
    assert.ok(nms.filter((n) => n && n.startsWith('pdfedi-')).length >= 7, `pdfedi annots: ${nms}`);
    assert.ok(nms.includes(null), 'foreign annotation preserved');
    // Reasonable size: source was tiny; 6 elements must stay well under 60KB total
    assert.ok(bytes.length < 60000, `size ${bytes.length}`);
  });

  it('round-trips all element kinds through standard annotation entries', async () => {
    const srcBytes = await makeSrcPdf();
    const bytes = await exportAnnotatedPdf({ srcBytes, pages: [makePage()], elements: makeElements() });
    const parsed = await parsePdfediAnnotations(bytes);
    const byId = new Map(parsed.map((p) => [p.element.id, p]));
    assert.equal(parsed.length, 6, `expected 6 elements, got ${parsed.length}`);

    const text = byId.get(IDS.text).element;
    assert.equal(text.kind, 'text');
    assert.equal(text.text, 'Hello annotations');
    assert.equal(text.fontSize, 14);
    assert.equal(text.bold, true);
    assert.equal(text.italic, false);
    assert.equal(text.color, '#FF0000');
    assert.equal(text.link, 'https://example.org/link');
    assert.ok(near(text.x, 100) && near(text.y, 600), `text pos ${text.x},${text.y}`);

    const native = byId.get(IDS.native).element;
    assert.equal(native.kind, 'native-text');
    assert.equal(native.text, 'Replacement line');
    assert.ok(near(native.x, 100) && near(native.y, 695));
    assert.ok(near(native.width, 200) && near(native.height, 24));
    assert.ok(near(native.baselineOffset, 5), `baselineOffset ${native.baselineOffset}`);

    const hl = byId.get(IDS.highlight).element;
    assert.equal(hl.kind, 'highlight');
    assert.equal(hl.color, '#FFFF00');
    assert.ok(near(hl.opacity, 0.4, 0.01));
    assert.ok(near(hl.width, 150) && near(hl.height, 20));

    const rect = byId.get(IDS.rect).element;
    assert.equal(rect.kind, 'shape');
    assert.equal(rect.shape, 'rect');
    assert.equal(rect.stroke, '#0000FF');
    assert.equal(rect.fill, '#00FF00');
    assert.equal(rect.strokeWidth, 3);

    const arrow = byId.get(IDS.arrow).element;
    assert.equal(arrow.shape, 'arrow');
    assert.ok(near(arrow.width, 100) && near(arrow.height, 40));

    const image = byId.get(IDS.image);
    assert.equal(image.element.kind, 'image');
    assert.ok(image.image?.rawSamples, 'image samples extracted');
    assert.equal(image.image.rawSamples.width, 2);
    assert.equal(image.image.rawSamples.height, 2);
    const pixels = zlib.inflateSync(Buffer.from(image.image.rawSamples.compressed));
    assert.equal(pixels.length, 12, 'decoded RGB samples for 2x2 image');
  });

  it('second cycle: no duplicates, deleted element stays deleted, foreign annot kept', async () => {
    const srcBytes = await makeSrcPdf();
    const elements = makeElements();
    const bytes1 = await exportAnnotatedPdf({ srcBytes, pages: [makePage()], elements });
    const parsed1 = await parsePdfediAnnotations(bytes1);
    // Simulate a session: parsed elements (pageId rebound), text edited, rect deleted
    const session = {};
    for (const p of parsed1) {
      const el = { ...p.element, pageId: PAGE_ID };
      if (el.kind === 'image') el.src = tinyPngDataUrl(); // web layer supplies blob src
      session[el.id] = el;
    }
    session[IDS.text] = { ...session[IDS.text], text: 'Edited in cycle 2' };
    delete session[IDS.rect];
    const bytes2 = await exportAnnotatedPdf({ srcBytes: bytes1, pages: [makePage()], elements: session });
    const doc2 = await PDFDocument.load(bytes2);
    assert.deepEqual(attachmentNames(doc2), [], 'still no attachments in cycle 2');
    const parsed2 = await parsePdfediAnnotations(bytes2);
    const ids2 = parsed2.map((p) => p.element.id).sort();
    assert.deepEqual(ids2, [IDS.arrow, IDS.highlight, IDS.image, IDS.native, IDS.text].sort(), 'exactly the surviving 5, once each');
    const text2 = parsed2.find((p) => p.element.id === IDS.text).element;
    assert.equal(text2.text, 'Edited in cycle 2');
    const nms2 = allAnnotNMs(doc2);
    assert.ok(nms2.includes(null), 'foreign annotation still preserved in cycle 2');
    // Size stability: cycle 2 (one element fewer, edited text) within 20% of cycle 1
    assert.ok(Math.abs(bytes2.length - bytes1.length) / bytes1.length < 0.2, `sizes ${bytes1.length} -> ${bytes2.length}`);
  });
});

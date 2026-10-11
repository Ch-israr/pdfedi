/**
 * @pdfeditor/pdf-core — PDF-native edit persistence via standard annotations.
 *
 * Instead of embedding a custom JSON manifest + a full copy of the source
 * PDF into every download, user edits are written as STANDARD PDF markup
 * annotations (ISO 32000): added text is a /FreeText annotation, native-text
 * masks are /Square annotations, shapes are /Square, /Circle and /Line,
 * highlights are /Square with opacity, and images/signatures are /Stamp.
 *
 * Every annotation carries:
 *   - /AP — a generated appearance stream, so ordinary viewers display the
 *     content even though it is not part of the page content stream.
 *   - /F = 4 — the print flag, so annotations print.
 *   - /NM — the standard annotation-name field, used as the element
 *     identity: "pdfedi-<kind>-<uuid>". This is a standard PDF field used
 *     for its standard purpose (uniquely identifying an annotation), not a
 *     custom state blob: all editing data (text, font, colour, geometry)
 *     lives in the annotation's own standard entries (/Contents, /DA,
 *     /Rect, /L, /C, /IC, /CA, /BS, its appearance stream).
 *
 * On upload, `parsePdfediAnnotations()` reads those standard entries back
 * and reconstructs the editor elements. Added content is therefore
 * distinguishable from original page text by construction: original text
 * lives in the page content layer, added content lives in the annotation
 * layer — the two can never be confused, and nothing is duplicated.
 *
 * Geometry conventions (shared by writer and reader — change both or none):
 *   text box: top = firstBaseline + 1.0*fontSize,
 *             bottom = lastBaseline - 0.3*fontSize,
 *             line step = 1.25*fontSize.
 */
import {
  PDFDocument,
  PDFName,
  PDFString,
  PDFHexString,
  PDFArray,
  PDFDict,
  PDFRef,
  PDFObject,
  PDFNumber,
  PDFRawStream,
  StandardFonts,
  rgb,
  degrees,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import type { EditorElement, Page } from '@pdfeditor/shared';
import { createDrawContext, drawElement, type DrawContext } from './index.js';
import { findDirectRun, rewritePageContent, moveRunRaw, type TextRun } from './direct-text.js';

export const PDFEDI_NM_PREFIX = 'pdfedi-';

const TEXT_ASCENT = 1.0;
const TEXT_DESCENT = 0.3;
const LINE_STEP = 1.25;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

function hexToRgbArr(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function fmt(n: number): string {
  return String(Math.round(n * 10000) / 10000);
}

/** Standard base-font name for a family/bold/italic combo (PDF 14 fonts). */
function standardFontName(family: string, bold: boolean, italic: boolean): StandardFonts {
  const f = family.toLowerCase();
  if (f.includes('times') || f.includes('georgia') || f.includes('serif')) {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
    if (bold) return StandardFonts.TimesRomanBold;
    if (italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (f.includes('courier') || f.includes('mono')) {
    if (bold && italic) return StandardFonts.CourierBoldOblique;
    if (bold) return StandardFonts.CourierBold;
    if (italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (bold && italic) return StandardFonts.HelveticaBoldOblique;
  if (bold) return StandardFonts.HelveticaBold;
  if (italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

/** Inverse of standardFontName: editor family + style flags from a base name. */
function fontFromBaseName(name: string): { fontFamily: string; bold: boolean; italic: boolean } {
  const bold = /bold/i.test(name);
  const italic = /italic|oblique/i.test(name);
  if (/times/i.test(name)) return { fontFamily: 'Times New Roman', bold, italic };
  if (/courier/i.test(name)) return { fontFamily: 'Courier New', bold, italic };
  return { fontFamily: 'Helvetica', bold, italic };
}

function daString(family: string, bold: boolean, italic: boolean, fontSize: number, hexColor: string): string {
  const name = standardFontName(family, bold, italic);
  const [r, g, b] = hexToRgbArr(hexColor);
  return `/${name} ${fmt(fontSize)} Tf ${fmt(r)} ${fmt(g)} ${fmt(b)} rg`;
}

function parseDa(da: string | undefined): {
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  color: string;
} {
  const out = { fontSize: 12, fontFamily: 'Helvetica', bold: false, italic: false, color: '#000000' };
  if (!da) return out;
  const tf = da.match(/\/([A-Za-z0-9-]+)\s+([\d.]+)\s+Tf/);
  if (tf) {
    out.fontSize = parseFloat(tf[2]) || 12;
    Object.assign(out, fontFromBaseName(tf[1]));
  }
  const rgm = da.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/);
  if (rgm) out.color = rgbToHex(parseFloat(rgm[1]), parseFloat(rgm[2]), parseFloat(rgm[3]));
  return out;
}

async function measureFont(doc: PDFDocument, cache: Map<string, PDFFont>, family: string, bold: boolean, italic: boolean): Promise<PDFFont> {
  const name = standardFontName(family, bold, italic);
  const hit = cache.get(name);
  if (hit) return hit;
  const font = await doc.embedFont(name);
  cache.set(name, font);
  return font;
}

/** Build an appearance-stream form XObject by drawing onto a temp page. */
async function appearanceRef(
  out: PDFDocument,
  width: number,
  height: number,
  draw: (ctx: DrawContext, page: PDFPage) => Promise<void>,
) {
  const tmp = await PDFDocument.create();
  const tp = tmp.addPage([Math.max(1, width), Math.max(1, height)]);
  const tctx = createDrawContext(tmp);
  await draw(tctx, tp);
  const tmpBytes = await tmp.save();
  const [embedded] = await out.embedPdf(tmpBytes, [0]);
  return embedded.ref;
}

function pushAnnot(page: PDFPage, ref: PDFRef): void {
  const existing = page.node.Annots();
  if (existing) existing.push(ref);
  else page.node.set(PDFName.of('Annots'), page.doc.context.obj([ref]));
}

/**
 * Remove only pdfedi-* annotations from a copied page (foreign annotations
 * that were in the user's original PDF are preserved). copyPages() carries
 * the source page's annotations into the output, so without this step a
 * deleted element's annotation would resurrect and edited ones duplicate.
 */
function stripPdfediAnnots(page: PDFPage): void {
  const annots = page.node.Annots();
  if (!annots) return;
  const kept: PDFObject[] = [];
  let removed = 0;
  for (let i = 0; i < annots.size(); i++) {
    const entry = annots.get(i);
    let nm: string | undefined;
    try {
      const dict = page.doc.context.lookup(entry) as PDFDict;
      const nmObj = dict.lookup(PDFName.of('NM'));
      if (nmObj && typeof (nmObj as PDFString).decodeText === 'function') {
        nm = (nmObj as PDFString).decodeText();
      }
    } catch {
      nm = undefined;
    }
    if (nm && nm.startsWith(PDFEDI_NM_PREFIX)) removed++;
    else kept.push(entry);
  }
  if (removed === 0) return;
  if (kept.length === 0) page.node.delete(PDFName.of('Annots'));
  else page.node.set(PDFName.of('Annots'), page.doc.context.obj(kept));
}

// ---------------------------------------------------------------------------
// Export: elements → annotations
// ---------------------------------------------------------------------------

export interface AnnotatedExportInput {
  srcBytes: Uint8Array;
  pages: Page[];
  elements: Record<string, EditorElement>;
}

interface TextBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function textBoxFor(x: number, firstBaseline: number, lines: number, width: number, fontSize: number): TextBox {
  const top = firstBaseline + TEXT_ASCENT * fontSize;
  const h = fontSize * (TEXT_ASCENT + TEXT_DESCENT) + Math.max(0, lines - 1) * fontSize * LINE_STEP;
  return { x0: x, y0: top - h, x1: x + Math.max(1, width), y1: top };
}

async function addTextAnnotation(
  out: PDFDocument,
  ctx: DrawContext,
  page: PDFPage,
  el: Extract<EditorElement, { kind: 'text' }>,
  fontCache: Map<string, PDFFont>,
): Promise<void> {
  const font = await measureFont(out, fontCache, el.fontFamily, el.bold, el.italic);
  const lines = el.text.split('\n');
  let width = 0;
  for (const line of lines) {
    try {
      width = Math.max(width, font.widthOfTextAtSize(line, el.fontSize));
    } catch {
      width = Math.max(width, line.length * el.fontSize * 0.55);
    }
  }
  const box = textBoxFor(el.x, el.y, lines.length, width, el.fontSize);
  const boxW = box.x1 - box.x0;
  const boxH = box.y1 - box.y0;
  const ap = await appearanceRef(out, boxW, boxH, async (tctx, tp) => {
    try {
      const tfont = await measureFont(tctx.doc, new Map(), el.fontFamily, el.bold, el.italic);
      tp.drawText(el.text, {
        x: 0,
        y: boxH - TEXT_ASCENT * el.fontSize,
        size: el.fontSize,
        font: tfont,
        color: rgb(...hexToRgbArr(el.color)),
        lineHeight: el.fontSize * LINE_STEP,
        rotate: degrees(el.rotation || 0),
      });
    } catch {
      // Non-WinAnsi text: appearance stays empty (same graceful skip as
      // content drawing); the annotation still carries the full text.
    }
  });
  const annot = out.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('FreeText'),
    Rect: [box.x0, box.y0, box.x1, box.y1],
    Contents: PDFHexString.fromText(el.text),
    DA: PDFString.of(daString(el.fontFamily, el.bold, el.italic, el.fontSize, el.color)),
    Q: 0,
    F: 4,
    Border: [0, 0, 0],
    NM: PDFString.of(`${PDFEDI_NM_PREFIX}text-${el.id}`),
    ...(el.link ? { Subj: PDFHexString.fromText(`link:${el.link}`) } : {}),
    AP: { N: ap },
  });
  pushAnnot(page, out.context.register(annot));
  if (el.link) {
    const linkAnnot = out.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Link'),
      Rect: [box.x0, box.y0, box.x1, box.y1],
      Border: [0, 0, 0],
      NM: PDFString.of(`${PDFEDI_NM_PREFIX}link-${el.id}`),
      A: { Type: PDFName.of('Action'), S: PDFName.of('URI'), URI: PDFString.of(el.link) },
    });
    pushAnnot(page, out.context.register(linkAnnot));
  }
}

/** Link-only annotation for content-drawn text (the text itself is real
 *  page content now; only the hyperlink target needs an annotation). */
async function addTextLinkAnnotation(
  out: PDFDocument,
  page: PDFPage,
  el: Extract<EditorElement, { kind: 'text' }>,
  fontCache: Map<string, PDFFont>,
): Promise<void> {
  if (!el.link) return;
  const font = await measureFont(out, fontCache, el.fontFamily, el.bold, el.italic);
  const lines = el.text.split('\n');
  let width = 0;
  for (const line of lines) {
    try {
      width = Math.max(width, font.widthOfTextAtSize(line, el.fontSize));
    } catch {
      width = Math.max(width, line.length * el.fontSize * 0.55);
    }
  }
  const box = textBoxFor(el.x, el.y, lines.length, width, el.fontSize);
  const linkAnnot = out.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Link'),
    Rect: [box.x0, box.y0, box.x1, box.y1],
    Border: [0, 0, 0],
    NM: PDFString.of(`${PDFEDI_NM_PREFIX}link-${el.id}`),
    A: { Type: PDFName.of('Action'), S: PDFName.of('URI'), URI: PDFString.of(el.link) },
  });
  pushAnnot(page, out.context.register(linkAnnot));
}

async function addNativeTextAnnotations(
  out: PDFDocument,
  ctx: DrawContext,
  page: PDFPage,
  el: Extract<EditorElement, { kind: 'native-text' }>,
): Promise<void> {
  // Mask: white Square over the original text (an annotation, so deleting
  // the pair later fully reveals the original — nothing is baked over it).
  const maskAp = await appearanceRef(out, el.width, el.height, async (_tctx, tp) => {
    tp.drawRectangle({ x: 0, y: 0, width: el.width, height: el.height, color: rgb(1, 1, 1) });
  });
  const mask = out.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Square'),
    Rect: [el.x, el.y, el.x + el.width, el.y + el.height],
    C: [1, 1, 1],
    IC: [1, 1, 1],
    BS: { Type: PDFName.of('Border'), W: 0, S: PDFName.of('S') },
    CA: 1,
    F: 4,
    Border: [0, 0, 0],
    NM: PDFString.of(`${PDFEDI_NM_PREFIX}native-mask-${el.id}`),
    AP: { N: maskAp },
  });
  pushAnnot(page, out.context.register(mask));
  if (!el.text) return; // mask-only element (a deletion that keeps the cover)
  const baseline = el.y + el.baselineOffset;
  const lines = el.text.split('\n');
  const box = textBoxFor(el.x, baseline, lines.length, el.width, el.fontSize);
  const boxW = box.x1 - box.x0;
  const boxH = box.y1 - box.y0;
  const ap = await appearanceRef(out, boxW, boxH, async (tctx, tp) => {
    try {
      const tfont = await measureFont(tctx.doc, new Map(), el.fontFamily, el.bold, el.italic);
      tp.drawText(el.text, {
        x: 0,
        y: boxH - TEXT_ASCENT * el.fontSize,
        size: el.fontSize,
        font: tfont,
        color: rgb(...hexToRgbArr(el.color)),
        lineHeight: el.fontSize * LINE_STEP,
      });
    } catch {
      // Non-WinAnsi: cover remains, replacement omitted (as with content drawing).
    }
  });
  const annot = out.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('FreeText'),
    Rect: [box.x0, box.y0, box.x1, box.y1],
    Contents: PDFHexString.fromText(el.text),
    DA: PDFString.of(daString(el.fontFamily, el.bold, el.italic, el.fontSize, el.color)),
    Q: 0,
    F: 4,
    Border: [0, 0, 0],
    NM: PDFString.of(`${PDFEDI_NM_PREFIX}native-${el.id}`),
    AP: { N: ap },
  });
  pushAnnot(page, out.context.register(annot));
}

async function addHighlightAnnotation(
  out: PDFDocument,
  ctx: DrawContext,
  page: PDFPage,
  el: Extract<EditorElement, { kind: 'highlight' }>,
): Promise<void> {
  const [r, g, b] = hexToRgbArr(el.color);
  const ap = await appearanceRef(out, el.width, el.height, async (tctx, tp) => {
    await drawElement(tctx, tp, { ...el, x: 0, y: 0, rotation: 0 });
  });
  const annot = out.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Square'),
    Rect: [el.x, el.y, el.x + el.width, el.y + el.height],
    IC: [r, g, b],
    CA: el.opacity,
    BS: { Type: PDFName.of('Border'), W: 0, S: PDFName.of('S') },
    F: 4,
    Border: [0, 0, 0],
    NM: PDFString.of(`${PDFEDI_NM_PREFIX}highlight-${el.id}`),
    AP: { N: ap },
  });
  pushAnnot(page, out.context.register(annot));
}

async function addShapeAnnotation(
  out: PDFDocument,
  ctx: DrawContext,
  page: PDFPage,
  el: Extract<EditorElement, { kind: 'shape' }>,
): Promise<void> {
  const stroke = hexToRgbArr(el.stroke);
  if (el.shape === 'line' || el.shape === 'arrow') {
    const pad = el.strokeWidth + 6;
    const bx0 = Math.min(el.x, el.x + el.width) - pad;
    const by0 = Math.min(el.y, el.y + el.height) - pad;
    const bx1 = Math.max(el.x, el.x + el.width) + pad;
    const by1 = Math.max(el.y, el.y + el.height) + pad;
    const ap = await appearanceRef(out, bx1 - bx0, by1 - by0, async (tctx, tp) => {
      await drawElement(tctx, tp, { ...el, x: el.x - bx0, y: el.y - by0, rotation: 0 });
    });
    const annot = out.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Line'),
      Rect: [bx0, by0, bx1, by1],
      L: [el.x, el.y, el.x + el.width, el.y + el.height],
      LE: [PDFName.of('None'), PDFName.of(el.shape === 'arrow' ? 'OpenArrow' : 'None')],
      C: stroke,
      BS: { Type: PDFName.of('Border'), W: el.strokeWidth, S: PDFName.of('S') },
      F: 4,
      Border: [0, 0, 0],
      NM: PDFString.of(`${PDFEDI_NM_PREFIX}shape-${el.id}`),
      AP: { N: ap },
    });
    pushAnnot(page, out.context.register(annot));
    return;
  }
  const subtype = el.shape === 'ellipse' ? 'Circle' : 'Square';
  const ap = await appearanceRef(out, Math.abs(el.width), Math.abs(el.height), async (tctx, tp) => {
    await drawElement(tctx, tp, { ...el, x: 0, y: 0, rotation: 0 });
  });
  const annot = out.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of(subtype),
    Rect: [el.x, el.y, el.x + el.width, el.y + el.height],
    C: stroke,
    ...(el.fill ? { IC: hexToRgbArr(el.fill) } : {}),
    BS: { Type: PDFName.of('Border'), W: el.strokeWidth, S: PDFName.of('S') },
    CA: 1,
    F: 4,
    Border: [0, 0, 0],
    NM: PDFString.of(`${PDFEDI_NM_PREFIX}shape-${el.id}`),
    AP: { N: ap },
  });
  pushAnnot(page, out.context.register(annot));
}

/**
 * Whiteout: a solid white-filled rectangle with NO outline.
 * Written two ways:
 *  1. Painted into the page content stream, so the covering is visible
 *     even in viewers that hide annotations.
 *  2. A /Square annotation (white interior, no border) carrying the
 *     pdfedi-whiteout-<uuid> identity, so the element restores as
 *     editable on re-upload. Previous annotations are stripped from the
 *     source before copying, so re-exports never duplicate.
 * Visual covering only — not secure redaction.
 */
async function addWhiteoutAnnotation(
  out: PDFDocument,
  ctx: DrawContext,
  page: PDFPage,
  el: Extract<EditorElement, { kind: 'whiteout' }>,
): Promise<void> {
  // 1. Content paint: solid white, no border.
  page.drawRectangle({
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    color: rgb(1, 1, 1),
    opacity: 1,
    borderWidth: 0,
  });
  // 2. Identity annotation for restore (no C, no BS → no outline).
  const ap = await appearanceRef(out, el.width, el.height, async (tctx, tp) => {
    tp.drawRectangle({
      x: 0,
      y: 0,
      width: el.width,
      height: el.height,
      color: rgb(1, 1, 1),
      opacity: 1,
      borderWidth: 0,
    });
  });
  const annot = out.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Square'),
    Rect: [el.x, el.y, el.x + el.width, el.y + el.height],
    IC: [PDFNumber.of(1), PDFNumber.of(1), PDFNumber.of(1)],
    Border: [0, 0, 0],
    F: 4,
    NM: PDFString.of(`${PDFEDI_NM_PREFIX}whiteout-${el.id}`),
    AP: { N: ap },
  });
  pushAnnot(page, out.context.register(annot));
}

async function addStampAnnotation(
  out: PDFDocument,
  ctx: DrawContext,
  page: PDFPage,
  el: Extract<EditorElement, { kind: 'image' | 'signature' }>,
  imageCache: Map<string, PDFImage>,
): Promise<void> {
  // Appearance = a form XObject that draws the image once, so the image
  // bytes live in exactly one place and can be extracted back on restore.
  const key = el.src;
  let img = imageCache.get(key);
  if (!img) {
    const bytes = await fetch(el.src).then((r) => r.arrayBuffer());
    img = el.kind === 'image' && el.mime === 'image/jpeg'
      ? await out.embedJpg(bytes)
      : await out.embedPng(bytes);
    imageCache.set(key, img);
  }
  const form = out.context.flateStream(`q ${fmt(el.width)} 0 0 ${fmt(el.height)} 0 0 cm /Im0 Do Q`, {
    Type: PDFName.of('XObject'),
    Subtype: PDFName.of('Form'),
    BBox: [0, 0, el.width, el.height],
    Resources: {
      XObject: { Im0: img.ref },
      ProcSet: [PDFName.of('PDF'), PDFName.of('ImageC'), PDFName.of('ImageB')],
    },
  });
  const formRef = out.context.register(form);
  const tag = el.kind === 'image' ? 'image' : 'signature';
  const annot = out.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Stamp'),
    Rect: [el.x, el.y, el.x + el.width, el.y + el.height],
    F: 4,
    Border: [0, 0, 0],
    NM: PDFString.of(`${PDFEDI_NM_PREFIX}${tag}-${el.id}`),
    AP: { N: formRef },
  });
  pushAnnot(page, out.context.register(annot));
}

/**
 * Build the edited PDF with all elements as standard annotations.
 * No file attachments are added: the output carries no PDFEDI_STATE.json
 * and no embedded source PDF.
 */
export async function buildAnnotatedPdfDocument(input: AnnotatedExportInput): Promise<PDFDocument> {
  const src = await PDFDocument.load(input.srcBytes, { ignoreEncryption: false });
  // Strip our annotations from the SOURCE pages before copying: pdf-lib's
  // copier walks the page's object graph, so annotations still referenced
  // at copy time would be copied into the output and then orphaned when
  // stripped there — dead appearance streams that grow the file on every
  // export/re-upload cycle. Removing them here (the loaded source is a
  // scratch copy) keeps cycles size-stable. Foreign annotations stay.
  for (const srcPage of src.getPages()) stripPdfediAnnots(srcPage);

  // DIRECT TEXT EDITING (no masks): for each native-text element, try to
  // match its original run in the source page's content stream. A match
  // means the original operators are REMOVED here, before copying:
  //   - text emptied        → pure deletion, nothing replaces it
  //   - text unchanged      → the original block is re-emitted verbatim
  //                           at the element's current position (a true
  //                           move: same font, same encoded bytes)
  //   - text changed        → the replacement is drawn into the copied
  //                           page's content by the page loop below
  // Elements whose run cannot be matched exactly (only reachable for
  // legacy/restored edits — the editor probes before creating new ones)
  // keep the annotation-pair fallback so their edit is never lost.
  const directHandled = new Set<string>();
  const directDraw = new Set<string>(); // handled directly, replacement drawn post-copy
  {
    const rewrites = new Map<number, { removals: TextRun[]; appends: string[] }>();
    const claimed = new Map<number, Set<number>>();
    input.pages.forEach((page, modelIdx) => {
      if (page.sourceIndex === 0) return;
      const srcIdx = page.sourceIndex - 1;
      const els = Object.values(input.elements).filter(
        (e) => e.pageId === page.id && e.kind === 'native-text',
      );
      for (const el of els) {
        if (el.kind !== 'native-text') continue;
        const anyEl = el as unknown as { baked?: boolean; bakedBounds?: unknown; deleted?: boolean };
        if (anyEl.deleted || anyEl.baked || anyEl.bakedBounds) continue; // legacy paths unchanged
        const originX = el.originX ?? el.x;
        const originY = el.originY ?? el.y;
        const res = findDirectRun(src, srcIdx, {
          text: el.originalText,
          baselineX: originX,
          baselineY: originY + el.baselineOffset,
        });
        if (res.status !== 'ok') continue;
        const pageClaimed = claimed.get(srcIdx) ?? new Set<number>();
        if (pageClaimed.has(res.run.start)) continue; // two elements, one run — first wins
        pageClaimed.add(res.run.start);
        claimed.set(srcIdx, pageClaimed);
        const acc = rewrites.get(srcIdx) ?? { removals: [], appends: [] };
        acc.removals.push(res.run);
        if (el.text && el.text === el.originalText) {
          const movedRaw = moveRunRaw(res.run, el.x, el.y + el.baselineOffset);
          if (movedRaw) acc.appends.push(movedRaw);
          else directDraw.add(el.id); // matched but not movable verbatim — redraw
        } else if (el.text) {
          directDraw.add(el.id);
        }
        directHandled.add(el.id);
        rewrites.set(srcIdx, acc);
      }
      void modelIdx;
    });
    for (const [srcIdx, acc] of rewrites) {
      rewritePageContent(src, srcIdx, acc.removals, acc.appends.join('\n'));
    }
  }

  const out = await PDFDocument.create();
  const ctx = createDrawContext(out);
  const fontCache = new Map<string, PDFFont>();
  const imageCache = new Map<string, PDFImage>();

  const srcIndices: number[] = [];
  const pageToSrcPos = new Map<number, number>();
  input.pages.forEach((page, modelIdx) => {
    if (page.sourceIndex !== 0) {
      pageToSrcPos.set(modelIdx, srcIndices.length);
      srcIndices.push(page.sourceIndex - 1);
    }
  });
  const copiedPages = srcIndices.length > 0 ? await out.copyPages(src, srcIndices) : [];

  for (let i = 0; i < input.pages.length; i++) {
    const page = input.pages[i];
    let pdfPage: PDFPage;
    if (page.sourceIndex === 0) {
      pdfPage = out.addPage([page.width, page.height]);
    } else {
      const cp = copiedPages[pageToSrcPos.get(i)!];
      if (page.rotation) cp.setRotation(degrees(page.rotation % 360));
      out.addPage(cp);
      pdfPage = cp;
    }
    // Drop our previous annotations (the current element set is re-added
    // below); foreign annotations from the user's PDF are preserved.
    stripPdfediAnnots(pdfPage);

    const els = Object.values(input.elements).filter((e) => e.pageId === page.id);
    for (const el of els) {
      const anyEl = el as unknown as { baked?: boolean; bakedBounds?: unknown; deleted?: boolean };
      if (anyEl.deleted) {
        // Legacy tombstone: mask the baked content in the page content.
        const bb = anyEl.bakedBounds as { x: number; y: number; width: number; height: number } | undefined;
        if (bb && bb.width > 0 && bb.height > 0) {
          pdfPage.drawRectangle({ x: bb.x, y: bb.y, width: bb.width, height: bb.height, color: rgb(1, 1, 1) });
        }
        continue;
      }
      if (anyEl.baked) continue; // legacy unmodified: already in the page content
      if (anyEl.bakedBounds) {
        // Legacy modified element: mask the old baked content in the page
        // content, then give the element a standard annotation so from
        // this export onward it lives in the native annotation system.
        const bb = anyEl.bakedBounds as { x: number; y: number; width: number; height: number };
        if (bb.width > 0 && bb.height > 0) {
          pdfPage.drawRectangle({ x: bb.x, y: bb.y, width: bb.width, height: bb.height, color: rgb(1, 1, 1) });
        }
      }
      switch (el.kind) {
        case 'text':
          // Added text is real page content (drawn into the content
          // stream), so after re-upload it is ordinary document text —
          // selectable, directly editable and movable like any other
          // run. Only an optional hyperlink remains an annotation.
          await drawElement(ctx, pdfPage, el);
          if (el.link) await addTextLinkAnnotation(out, pdfPage, el, fontCache);
          break;
        case 'native-text':
          if (directHandled.has(el.id)) {
            // Original run already removed from the content stream in
            // the planning pass. Draw the replacement into the content
            // only when it changed (unchanged text was re-emitted
            // verbatim; emptied text is a pure deletion).
            if (directDraw.has(el.id)) {
              const asText = {
                id: el.id,
                pageId: el.pageId,
                kind: 'text',
                x: el.x,
                y: el.y + el.baselineOffset,
                text: el.text,
                fontSize: el.fontSize,
                fontFamily: el.fontFamily,
                color: el.color,
                bold: el.bold,
                italic: el.italic,
                rotation: el.rotation,
              } as EditorElement;
              await drawElement(ctx, pdfPage, asText);
            }
            break;
          }
          await addNativeTextAnnotations(out, ctx, pdfPage, el);
          break;
        case 'highlight':
          await addHighlightAnnotation(out, ctx, pdfPage, el);
          break;
        case 'shape':
          await addShapeAnnotation(out, ctx, pdfPage, el);
          break;
        case 'whiteout':
          await addWhiteoutAnnotation(out, ctx, pdfPage, el);
          break;
        case 'image':
        case 'signature':
          await addStampAnnotation(out, ctx, pdfPage, el, imageCache);
          break;
      }
    }
  }
  return out;
}

export async function exportAnnotatedPdf(input: AnnotatedExportInput): Promise<Uint8Array> {
  const doc = await buildAnnotatedPdfDocument(input);
  return doc.save();
}

// ---------------------------------------------------------------------------
// Restore: annotations → elements
// ---------------------------------------------------------------------------

export interface ParsedImageData {
  /** DCTDecode: `bytes` are the original JPEG file bytes. */
  jpegBytes?: Uint8Array;
  /** FlateDecode/raw samples: caller decodes + rasterises (canvas in web). */
  rawSamples?: {
    /** Still Flate-compressed sample data (decode with zlib/DecompressionStream). */
    compressed: Uint8Array;
    width: number;
    height: number;
    colorSpace: string;
    bitsPerComponent: number;
    smaskCompressed?: Uint8Array;
    smaskWidth?: number;
    smaskHeight?: number;
  };
}

export interface ParsedAnnotationElement {
  pageIndex: number;
  element: EditorElement;
  image?: ParsedImageData;
}

function dictOf(doc: PDFDocument, obj: unknown): PDFDict | null {
  try {
    const looked = doc.context.lookup(obj as PDFRef) as PDFDict;
    return looked instanceof PDFDict ? looked : null;
  } catch {
    return null;
  }
}

function streamDictOf(obj: unknown): PDFDict | null {
  const d = (obj as { dict?: PDFDict })?.dict;
  return d instanceof PDFDict ? d : null;
}

function num(dict: PDFDict, name: string): number | undefined {
  const v = dict.lookup(PDFName.of(name)) as { asNumber?: () => number } | undefined;
  return v && typeof v.asNumber === 'function' ? v.asNumber() : undefined;
}

function numArray(dict: PDFDict, name: string): number[] | null {
  const arr = dict.lookup(PDFName.of(name)) as PDFArray | undefined;
  if (!(arr instanceof PDFArray)) return null;
  const out: number[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const v = arr.lookup(i) as { asNumber?: () => number };
    if (typeof v?.asNumber !== 'function') return null;
    out.push(v.asNumber());
  }
  return out;
}

function nameOf(dict: PDFDict, name: string): string | undefined {
  const v = dict.lookup(PDFName.of(name));
  return v ? String(v) : undefined;
}

function textOf(dict: PDFDict, name: string): string | undefined {
  const v = dict.lookup(PDFName.of(name)) as { decodeText?: () => string } | undefined;
  if (v && typeof v.decodeText === 'function') {
    try {
      return v.decodeText();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function extractStampImage(doc: PDFDocument, annot: PDFDict): ParsedImageData | undefined {
  try {
    const ap = dictOf(doc, annot.lookup(PDFName.of('AP')));
    if (!ap) return undefined;
    const formObj = doc.context.lookup(ap.get(PDFName.of('N')));
    const formDict = streamDictOf(formObj) ?? dictOf(doc, ap.get(PDFName.of('N')));
    if (!formDict) return undefined;
    const resources = dictOf(doc, formDict.lookup(PDFName.of('Resources')));
    const xobjects = resources ? dictOf(doc, resources.lookup(PDFName.of('XObject'))) : null;
    if (!xobjects) return undefined;
    for (const [key] of xobjects.entries()) {
      const xoObj = doc.context.lookup(xobjects.get(key));
      const xoDict = streamDictOf(xoObj) ?? dictOf(doc, xobjects.get(key));
      if (!xoDict || nameOf(xoDict, 'Subtype') !== '/Image') continue;
      const raw = xoObj as PDFRawStream;
      const contents = typeof raw?.getContents === 'function' ? raw.getContents() : undefined;
      if (!contents) return undefined;
      const filter = nameOf(xoDict, 'Filter');
      if (filter === '/DCTDecode') return { jpegBytes: new Uint8Array(contents) };
      let smaskCompressed: Uint8Array | undefined;
      let smaskWidth: number | undefined;
      let smaskHeight: number | undefined;
      const smaskObj = doc.context.lookup(xoDict.get(PDFName.of('SMask')));
      const smaskDict = streamDictOf(smaskObj);
      if (smaskDict && typeof (smaskObj as PDFRawStream)?.getContents === 'function') {
        smaskCompressed = new Uint8Array((smaskObj as PDFRawStream).getContents());
        smaskWidth = num(smaskDict, 'Width');
        smaskHeight = num(smaskDict, 'Height');
      }
      return {
        rawSamples: {
          compressed: new Uint8Array(contents),
          width: num(xoDict, 'Width') ?? 0,
          height: num(xoDict, 'Height') ?? 0,
          colorSpace: nameOf(xoDict, 'ColorSpace') ?? '/DeviceRGB',
          bitsPerComponent: num(xoDict, 'BitsPerComponent') ?? 8,
          smaskCompressed,
          smaskWidth,
          smaskHeight,
        },
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

const NM_RE = /^pdfedi-([a-z-]+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Read pdfedi-* annotations from a PDF and reconstruct editor elements.
 * Foreign annotations (no pdfedi- name) are ignored. Returns elements in
 * annotation order per page; pageId is left blank — the caller binds
 * pageIndex to its own page model.
 */
export async function parsePdfediAnnotations(bytes: Uint8Array): Promise<ParsedAnnotationElement[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
  const pages = doc.getPages();
  const results: ParsedAnnotationElement[] = [];
  // Native-text pairs are grouped per page after the scan.
  const nativeMasks = new Map<string, { pageIndex: number; rect: number[] }>();
  const nativeTexts = new Map<string, { pageIndex: number; rect: number[]; text: string; da: ReturnType<typeof parseDa> }>();

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annot = dictOf(doc, annots.get(i));
      if (!annot) continue;
      const nm = textOf(annot, 'NM');
      const m = nm ? NM_RE.exec(nm) : null;
      if (!m) continue;
      const tag = m[1];
      const id = m[2];
      const subtype = nameOf(annot, 'Subtype');
      const rect = numArray(annot, 'Rect');
      if (tag === 'link') continue; // rebuilt from the FreeText's link on export
      if (tag === 'native-mask') {
        if (rect) nativeMasks.set(id, { pageIndex, rect });
        continue;
      }
      if (tag === 'native') {
        if (rect) {
          nativeTexts.set(id, {
            pageIndex,
            rect,
            text: textOf(annot, 'Contents') ?? '',
            da: parseDa(textOf(annot, 'DA')),
          });
        }
        continue;
      }
      if (!rect) continue;
      const [x0, y0, x1, y1] = rect;
      if (tag === 'text' && subtype === '/FreeText') {
        const da = parseDa(textOf(annot, 'DA'));
        const subj = textOf(annot, 'Subj');
        const link = subj && subj.startsWith('link:') ? subj.slice(5) : undefined;
        results.push({
          pageIndex,
          element: {
            id,
            pageId: '',
            kind: 'text',
            x: x0,
            y: y1 - TEXT_ASCENT * da.fontSize,
            rotation: 0,
            text: textOf(annot, 'Contents') ?? '',
            fontSize: da.fontSize,
            fontFamily: da.fontFamily,
            color: da.color,
            bold: da.bold,
            italic: da.italic,
            ...(link ? { link } : {}),
          } as EditorElement,
        });
      } else if (tag === 'highlight' && subtype === '/Square') {
        const ic = numArray(annot, 'IC');
        results.push({
          pageIndex,
          element: {
            id,
            pageId: '',
            kind: 'highlight',
            x: x0,
            y: y0,
            rotation: 0,
            width: x1 - x0,
            height: y1 - y0,
            color: ic && ic.length >= 3 ? rgbToHex(ic[0], ic[1], ic[2]) : '#FFFF00',
            opacity: num(annot, 'CA') ?? 0.4,
          } as EditorElement,
        });
      } else if (tag === 'shape' && subtype === '/Line') {
        const L = numArray(annot, 'L');
        if (!L || L.length < 4) continue;
        const le = annot.lookup(PDFName.of('LE')) as PDFArray | undefined;
        let arrow = false;
        if (le instanceof PDFArray && le.size() >= 2) arrow = String(le.lookup(1)) !== '/None';
        const c = numArray(annot, 'C');
        const bs = dictOf(doc, annot.lookup(PDFName.of('BS')));
        results.push({
          pageIndex,
          element: {
            id,
            pageId: '',
            kind: 'shape',
            shape: arrow ? 'arrow' : 'line',
            x: L[0],
            y: L[1],
            rotation: 0,
            width: L[2] - L[0],
            height: L[3] - L[1],
            stroke: c && c.length >= 3 ? rgbToHex(c[0], c[1], c[2]) : '#000000',
            strokeWidth: (bs && num(bs, 'W')) ?? 2,
            fill: null,
          } as EditorElement,
        });
      } else if (tag === 'shape' && (subtype === '/Square' || subtype === '/Circle')) {
        const c = numArray(annot, 'C');
        const ic = numArray(annot, 'IC');
        const bs = dictOf(doc, annot.lookup(PDFName.of('BS')));
        results.push({
          pageIndex,
          element: {
            id,
            pageId: '',
            kind: 'shape',
            shape: subtype === '/Circle' ? 'ellipse' : 'rect',
            x: x0,
            y: y0,
            rotation: 0,
            width: x1 - x0,
            height: y1 - y0,
            stroke: c && c.length >= 3 ? rgbToHex(c[0], c[1], c[2]) : '#000000',
            strokeWidth: (bs && num(bs, 'W')) ?? 2,
            fill: ic && ic.length >= 3 ? rgbToHex(ic[0], ic[1], ic[2]) : null,
          } as EditorElement,
        });
      } else if (tag === 'whiteout' && subtype === '/Square') {
        results.push({
          pageIndex,
          element: {
            id,
            pageId: '',
            kind: 'whiteout',
            x: x0,
            y: y0,
            rotation: 0,
            width: x1 - x0,
            height: y1 - y0,
          } as EditorElement,
        });
      } else if ((tag === 'image' || tag === 'signature') && subtype === '/Stamp') {
        const image = extractStampImage(doc, annot);
        results.push({
          pageIndex,
          element: {
            id,
            pageId: '',
            kind: tag,
            x: x0,
            y: y0,
            rotation: 0,
            src: '',
            width: x1 - x0,
            height: y1 - y0,
            ...(tag === 'image' ? { mime: 'image/png' } : {}),
          } as EditorElement,
          image,
        });
      }
    }
  }

  // Native-text elements: mask Square + optional FreeText replacement.
  for (const [id, mask] of nativeMasks) {
    const ft = nativeTexts.get(id);
    const [x0, y0, x1, y1] = mask.rect;
    const da = ft?.da ?? { fontSize: 12, fontFamily: 'Helvetica', bold: false, italic: false, color: '#000000' };
    const baseline = ft ? ft.rect[3] - TEXT_ASCENT * da.fontSize : y0;
    results.push({
      pageIndex: mask.pageIndex,
      element: {
        id,
        pageId: '',
        kind: 'native-text',
        x: x0,
        y: y0,
        rotation: 0,
        originalText: '', // filled by the caller from the page text layer
        text: ft?.text ?? '',
        width: x1 - x0,
        height: y1 - y0,
        baselineOffset: Math.max(0, baseline - y0),
        fontSize: da.fontSize,
        fontFamily: da.fontFamily,
        color: da.color,
        bold: da.bold,
        italic: da.italic,
      } as EditorElement,
    });
  }
  return results;
}

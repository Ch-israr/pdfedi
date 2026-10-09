/**
 * @pdfeditor/pdf-core
 *
 * Pure, framework-free PDF helpers. No DOM, no Node APIs — safe to import
 * in the browser (apps/web) and in the Fastify service (apps/api).
 */
import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  PDFString,
  PDFName,
  rgb,
  degrees,
  StandardFonts,
} from 'pdf-lib';
import type { EditorElement, Page } from '@pdfeditor/shared';

// ---------------------------------------------------------------------------
// Page operations (pure — return new arrays, never mutate)
// ---------------------------------------------------------------------------

/** Rotate a page 90 degrees clockwise. */
export function rotatePage(page: Page): Page {
  const rotation = (page.rotation + 90) % 360;
  // Every 90° rotation swaps width/height (0°↔90°↔180°↔270°↔0°)
  return {
    ...page,
    rotation,
    width: page.height,
    height: page.width,
  };
}

/** Remove a page by id. */
export function deletePage(pages: Page[], pageId: string): Page[] {
  return pages.filter((p) => p.id !== pageId);
}

/** Move a page to a new position (by id). */
export function reorderPage(pages: Page[], pageId: string, toIndex: number): Page[] {
  const fromIndex = pages.findIndex((p) => p.id === pageId);
  if (fromIndex === -1) return pages;
  const clamped = Math.max(0, Math.min(toIndex, pages.length - 1));
  const next = [...pages];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(clamped, 0, moved);
  return next;
}

/** Duplicate a page — the copy gets a fresh UUID. */
export function duplicatePage(page: Page): Page {
  return {
    ...page,
    id: crypto.randomUUID(),
  };
}

// ---------------------------------------------------------------------------
// Element → pdf-lib drawing
// ---------------------------------------------------------------------------

export interface DrawContext {
  fontCache: Map<string, PDFFont>;
  imageCache: Map<string, PDFImage>;
  doc: PDFDocument;
}

export function createDrawContext(doc: PDFDocument): DrawContext {
  return { doc, fontCache: new Map(), imageCache: new Map() };
}

async function getFont(
  ctx: DrawContext,
  family: string,
  bold: boolean,
  italic: boolean,
): Promise<PDFFont> {
  const key = `${family}-${bold ? 'b' : ''}${italic ? 'i' : ''}`;
  const cached = ctx.fontCache.get(key);
  if (cached) return cached;
  // Map to the 14 standard PDF fonts (no embedding needed)
  // Arial → Helvetica, Times New Roman → TimesRoman, Courier New → Courier
  const f = family.toLowerCase();
  let name: StandardFonts;
  if (f.includes('times') || f.includes('georgia') || f.includes('serif')) {
    if (bold && italic) name = StandardFonts.TimesRomanBoldItalic;
    else if (bold) name = StandardFonts.TimesRomanBold;
    else if (italic) name = StandardFonts.TimesRomanItalic;
    else name = StandardFonts.TimesRoman;
  } else if (f.includes('courier') || f.includes('mono')) {
    if (bold && italic) name = StandardFonts.CourierBoldOblique;
    else if (bold) name = StandardFonts.CourierBold;
    else if (italic) name = StandardFonts.CourierOblique;
    else name = StandardFonts.Courier;
  } else {
    // Arial, Helvetica, Calibri, sans-serif → Helvetica
    if (bold && italic) name = StandardFonts.HelveticaBoldOblique;
    else if (bold) name = StandardFonts.HelveticaBold;
    else if (italic) name = StandardFonts.HelveticaOblique;
    else name = StandardFonts.Helvetica;
  }
  const font = await ctx.doc.embedFont(name);
  ctx.fontCache.set(key, font);
  return font;
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

async function getImage(ctx: DrawContext, src: string, mime: string): Promise<PDFImage> {
  const cached = ctx.imageCache.get(src);
  if (cached) return cached;
  const bytes = await fetch(src).then((r) => r.arrayBuffer());
  const img = mime === 'image/png'
    ? await ctx.doc.embedPng(bytes)
    : await ctx.doc.embedJpg(bytes);
  ctx.imageCache.set(src, img);
  return img;
}

/**
 * Draw a single editor element onto a pdf-lib page.
 * Coordinates: element x/y are in PDF points, origin bottom-left.
 */
export async function drawElement(
  ctx: DrawContext,
  page: PDFPage,
  el: EditorElement,
): Promise<void> {
  switch (el.kind) {
    case 'text': {
      const font = await getFont(ctx, el.fontFamily, el.bold, el.italic);
      page.drawText(el.text, {
        x: el.x,
        y: el.y,
        size: el.fontSize,
        font,
        color: hexToRgb(el.color),
        rotate: degrees(el.rotation),
      });
      // Add hyperlink annotation if link is present
      if (el.link) {
        const textWidth = font.widthOfTextAtSize(el.text, el.fontSize);
        const textHeight = el.fontSize * 1.2;
        const annot = ctx.doc.context.obj({
          Type: PDFName.of('Annot'),
          Subtype: PDFName.of('Link'),
          Rect: [el.x, el.y, el.x + textWidth, el.y + textHeight],
          Border: [0, 0, 0],
          A: {
            Type: PDFName.of('Action'),
            S: PDFName.of('URI'),
            URI: PDFString.of(el.link),
          },
        });
        const annots = page.node.Annots();
        if (annots) {
          annots.push(annot);
        } else {
          page.node.set(PDFName.of('Annots'), ctx.doc.context.obj([annot]));
        }
      }
      break;
    }
    case 'highlight': {
      page.drawRectangle({
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        color: hexToRgb(el.color),
        opacity: el.opacity,
        rotate: degrees(el.rotation),
      });
      break;
    }
    case 'shape': {
      const color = hexToRgb(el.stroke);
      const fill = el.fill ? hexToRgb(el.fill) : undefined;
      const opts = {
        x: el.x,
        y: el.y,
        color: fill,
        borderColor: color,
        borderWidth: el.strokeWidth,
        opacity: 1,
        rotate: degrees(el.rotation),
      } as const;
      if (el.shape === 'rect') {
        page.drawRectangle({ ...opts, width: el.width, height: el.height });
      } else if (el.shape === 'ellipse') {
        page.drawEllipse({
          ...opts,
          xScale: el.width / 2,
          yScale: el.height / 2,
        });
      } else {
        // line / arrow
        page.drawLine({
          start: { x: el.x, y: el.y },
          end: { x: el.x + el.width, y: el.y + el.height },
          thickness: el.strokeWidth,
          color,
          opacity: 1,
        });
        // arrowhead omitted in MVP — drawn as plain line
      }
      break;
    }
    case 'image':
    case 'signature': {
      const img = await getImage(ctx, el.src, el.kind === 'image' ? el.mime : 'image/png');
      page.drawImage(img, {
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        rotate: degrees(el.rotation),
      });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Export: apply editor state to a PDFDocument
// ---------------------------------------------------------------------------

export interface ExportInput {
  /** Original PDF bytes (never mutated) */
  srcBytes: Uint8Array;
  /** Current page order (UUIDs may differ from source order) */
  pages: Page[];
  /** All elements keyed by id */
  elements: Record<string, EditorElement>;
}

/**
 * Build the edited PDF. Returns fresh bytes — the input is never modified.
 * Pages follow the current `pages` order; deleted pages are dropped.
 */
export async function exportPdf(input: ExportInput): Promise<Uint8Array> {
  const src = await PDFDocument.load(input.srcBytes, { ignoreEncryption: false });
  const out = await PDFDocument.create();
  const ctx = createDrawContext(out);

  for (const page of input.pages) {
    let copied;
    if (page.sourceIndex === 0) {
      // Blank inserted page: create new instead of copying
      copied = out.addPage([page.width, page.height]);
    } else {
      const [cp] = await out.copyPages(src, [page.sourceIndex - 1]);
      // Apply rotation recorded in editor state
      if (page.rotation) {
        const current = cp.getRotation().angle;
        cp.setRotation(degrees((current + page.rotation) % 360));
      }
      out.addPage(cp);
      copied = cp;
    }

    const els = Object.values(input.elements).filter((e) => e.pageId === page.id);
    for (const el of els) {
      await drawElement(ctx, copied, el);
    }
  }

  return out.save();
}

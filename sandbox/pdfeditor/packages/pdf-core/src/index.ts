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
import type { EditorElement, Page, PdfediManifest } from '@pdfeditor/shared';
import {
  buildManifestParts,
  createManifest,
  embedManifestOnly,
  embedStatePackage,
  sha256Hex,
  type ManifestParts,
  type StateAsset,
} from './state-package.js';

export {
  buildManifestParts,
  createManifest,
  embedStatePackage,
  sha256Hex,
  type ManifestParts,
  type StateAsset,
};

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
      // Skip non-WinAnsi text gracefully (standard fonts are Latin-only).
      // Do not fail the entire export for one element.
      try {
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
      } catch {
        // Non-encodable text: skip this element, don't fail the export.
      }
      break;
    }
    case 'native-text': {
      // Cover the original native text with an opaque rect so no remnants
      // show through, then draw the replacement at the original baseline.
      page.drawRectangle({
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        color: rgb(1, 1, 1),
        opacity: 1,
      });
      // Skip text drawing for empty masks or non-WinAnsi text (standard PDF
      // fonts only support Latin; non-Latin would throw on encode). The cover
      // is already drawn, so the original stays hidden.
      if (!el.text) break;
      try {
        const nfont = await getFont(ctx, el.fontFamily, el.bold, el.italic);
        page.drawText(el.text, {
          x: el.x,
          y: el.y + el.baselineOffset,
          size: el.fontSize,
          font: nfont,
          color: hexToRgb(el.color),
          rotate: degrees(el.rotation),
        });
      } catch {
        // Non-encodable text: cover remains, replacement omitted.
        // Do not fail the entire export for one element.
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
        // pdf-lib drawEllipse takes CENTER coordinates (it subtracts
        // xScale/yScale internally), so offset by half size.
        page.drawEllipse({
          ...opts,
          x: el.x + el.width / 2,
          y: el.y + el.height / 2,
          xScale: el.width / 2,
          yScale: el.height / 2,
        });
      } else {
        // line / arrow
        const x2 = el.x + el.width;
        const y2 = el.y + el.height;
        page.drawLine({
          start: { x: el.x, y: el.y },
          end: { x: x2, y: y2 },
          thickness: el.strokeWidth,
          color,
          opacity: 1,
        });
        if (el.shape === 'arrow') {
          // Draw arrowhead: two short lines at ±25° from the line direction
          const angle = Math.atan2(el.height, el.width);
          const headLen = Math.max(8, el.strokeWidth * 4);
          const a1 = angle + Math.PI - 0.44; // ~25°
          const a2 = angle + Math.PI + 0.44;
          page.drawLine({
            start: { x: x2, y: y2 },
            end: { x: x2 + headLen * Math.cos(a1), y: y2 + headLen * Math.sin(a1) },
            thickness: el.strokeWidth,
            color,
            opacity: 1,
          });
          page.drawLine({
            start: { x: x2, y: y2 },
            end: { x: x2 + headLen * Math.cos(a2), y: y2 + headLen * Math.sin(a2) },
            thickness: el.strokeWidth,
            color,
            opacity: 1,
          });
        }
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

/** Optional PDFEDI state package to embed as file attachments. */
export interface StatePackageInput {
  manifest: PdfediManifest;
  /** Clean source PDF bytes — the manifest's sourceHash must match these */
  sourceBytes: Uint8Array;
  assets: StateAsset[];
}

/**
 * Build the edited PDFDocument (visible pages with flattened overlays).
 * The caller owns saving; use `exportPdfWithState` to embed attachments.
 */
export async function buildPdfDocument(input: ExportInput): Promise<PDFDocument> {
  const src = await PDFDocument.load(input.srcBytes, { ignoreEncryption: false });
  const out = await PDFDocument.create();
  const ctx = createDrawContext(out);

  // Batch copy all non-blank pages in a single copyPages() call so pdf-lib's
  // PDFObjectCopier deduplicates shared resources (e.g., image XObjects used
  // by multiple pages) instead of copying them once per page.
  const srcIndices: number[] = [];
  const pageToSrcPos = new Map<number, number>(); // model index -> position in copied array
  input.pages.forEach((page, modelIdx) => {
    if (page.sourceIndex !== 0) {
      pageToSrcPos.set(modelIdx, srcIndices.length);
      srcIndices.push(page.sourceIndex - 1);
    }
  });

  const copiedPages =
    srcIndices.length > 0 ? await out.copyPages(src, srcIndices) : [];

  // Add pages to `out` in model order, applying rotation and drawing elements.
  for (let i = 0; i < input.pages.length; i++) {
    const page = input.pages[i];
    let pdfPage;
    if (page.sourceIndex === 0) {
      // Blank inserted page: create new instead of copying.
      // Dimensions are in PDF points and already reflect the reference page's
      // size and orientation (including any rotation at insertion time).
      pdfPage = out.addPage([page.width, page.height]);
    } else {
      const cp = copiedPages[pageToSrcPos.get(i)!];
      // The model's rotation now includes the PDF's native /Rotate plus any
      // user-applied rotation. Set absolute (don't add) to avoid double-applying
      // the native rotation that's already on the copied page.
      if (page.rotation) {
        cp.setRotation(degrees(page.rotation % 360));
      }
      out.addPage(cp);
      pdfPage = cp;
    }

    const els = Object.values(input.elements).filter(
      (e) => e.pageId === page.id && !(e as any).baked,
    );
    for (const el of els) {
      // If this element was previously baked (restored from a source-less
      // manifest) and has now been modified, mask the old baked content first
      // so it doesn't show through underneath the updated version.
      const bakedBounds = (el as any).bakedBounds;
      if (bakedBounds && bakedBounds.width > 0 && bakedBounds.height > 0) {
        pdfPage.drawRectangle({
          x: bakedBounds.x,
          y: bakedBounds.y,
          width: bakedBounds.width,
          height: bakedBounds.height,
          color: rgb(1, 1, 1),
          opacity: 1,
        });
      }
      await drawElement(ctx, pdfPage, el);
    }
  }

  return out;
}

/**
 * Build the edited PDF. Returns fresh bytes — the input is never modified.
 * Pages follow the current `pages` order; deleted pages are dropped.
 */
export async function exportPdf(input: ExportInput): Promise<Uint8Array> {
  const out = await buildPdfDocument(input);
  return out.save();
}

/**
 * Build the edited PDF and embed the PDFEDI state package (manifest +
 * clean source + assets) as file attachments, making the download
 * re-editable on re-upload. Returns fresh bytes.
 */
export async function exportPdfWithState(
  input: ExportInput,
  statePackage: StatePackageInput,
): Promise<Uint8Array> {
  const out = await buildPdfDocument(input);
  await embedStatePackage(
    out,
    statePackage.manifest,
    statePackage.sourceBytes,
    statePackage.assets,
  );
  return out.save();
}

/**
 * Build the edited PDF and embed only the manifest + assets (no source PDF).
 * Use when all edits are additive (no native-text masks, no page deletions) —
 * the elements are baked into the page content, and re-upload uses the
 * downloaded PDF's pages directly as the base. Returns fresh bytes.
 */
export async function exportPdfWithManifestOnly(
  input: ExportInput,
  manifest: PdfediManifest,
  assets: StateAsset[],
): Promise<Uint8Array> {
  const out = await buildPdfDocument(input);
  await embedManifestOnly(out, manifest, assets);
  return out.save();
}

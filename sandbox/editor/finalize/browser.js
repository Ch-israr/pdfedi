/**
 * Browser-side finalization: manifest + original PDF → final PDF via pdf-lib.
 *
 * Applies each manifest operation to the loaded PDFDocument:
 * - add_text: drawText with StandardFonts (Helvetica/Times/Courier)
 * - add_image/add_signature: embed PNG/JPEG from asset blob
 * - add_shape: drawRectangle/drawEllipse/drawLine
 * - draw: drawSvgPath from polyline points
 * - add_highlight: annotation (highlight)
 * - add_underline/add_strikeout: line in content stream
 * - whiteout: white rectangle in content stream (visual cover only)
 * - page ops: copyPages/reorder/remove/insert
 *
 * Redaction is handled separately (finalize/redact.js) because it requires
 * rasterize-and-rebuild, not content-stream appends.
 *
 * Depends on global `PDFLib` (loaded via script tag).
 */

const FONT_MAP = {
  Helvetica: 'Helvetica',
  'Helvetica-Bold': 'HelveticaBold',
  Times: 'TimesRoman',
  Courier: 'Courier',
};

function hexToRgb(hex, PDFLib) {
  const h = hex.replace('#', '');
  const v = h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h;
  const n = parseInt(v, 16);
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export async function finalizeInBrowser(originalBytes, manifest, assets, onProgress) {
  const { PDFDocument, StandardFonts, rgb, degrees } = window.PDFLib;

  const pdfDoc = await PDFDocument.load(originalBytes.slice(0));
  const fontCache = {};

  async function getFont(name) {
    if (!fontCache[name]) {
      const std = FONT_MAP[name] || 'Helvetica';
      fontCache[name] = await pdfDoc.embedFont(StandardFonts[std]);
    }
    return fontCache[name];
  }

  // ---- Page operations first (they change page indices) ----
  // Build a working page list
  let pages = pdfDoc.getPages(); // PDFPage objects in current order

  // Collect page ops in manifest order
  const pageOps = manifest.operations.filter(o =>
    ['move_page','rotate_page','delete_page','duplicate_page'].includes(o.op));

  // We apply page ops by building a new page array, then a fresh doc.
  // Simpler and safer: apply to a working copy via pdf-lib's copyPages.
  if (pageOps.length > 0) {
    pages = applyPageOps(pdfDoc, pages, pageOps, degrees);
  }

  const total = manifest.operations.length;
  let done = 0;
  const tick = () => { done++; onProgress?.(done / total); };

  for (const op of manifest.operations) {
    // Page ops already applied
    if (['move_page','rotate_page','delete_page','duplicate_page'].includes(op.op)) {
      tick(); continue;
    }
    if (op.op === 'redact_rects') {
      // Handled by redact.js — skip here (caller orchestrates)
      tick(); continue;
    }

    const page = pages[op.page];
    if (!page) { tick(); continue; }
    const { height } = page.getSize();

    switch (op.op) {
      case 'add_text': {
        const font = await getFont(op.font || 'Helvetica');
        page.drawText(op.text, {
          x: op.x,
          y: op.y,
          size: op.size || 12,
          font,
          color: op.color ? hexToRgb(op.color, window.PDFLib) : rgb(0, 0, 0),
          opacity: op.opacity ?? 1,
          rotate: op.rotation ? degrees(op.rotation) : undefined,
        });
        break;
      }
      case 'add_shape': {
        const color = op.stroke ? hexToRgb(op.stroke, window.PDFLib) : rgb(0,0,0);
        const fill = op.fill ? hexToRgb(op.fill, window.PDFLib) : undefined;
        const th = op.thickness || 2;
        if (op.shape === 'ellipse') {
          page.drawEllipse({
            x: op.x + op.w / 2, y: op.y + op.h / 2,
            xScale: op.w / 2, yScale: op.h / 2,
            borderColor: color, borderWidth: th, color: fill,
            opacity: op.opacity ?? 1,
          });
        } else if (op.shape === 'line') {
          page.drawLine({
            start: { x: op.x, y: op.y },
            end: { x: op.x + op.w, y: op.y },
            thickness: th, color, opacity: op.opacity ?? 1,
          });
        } else {
          page.drawRectangle({
            x: op.x, y: op.y, width: op.w, height: op.h,
            borderColor: color, borderWidth: th, color: fill,
            opacity: op.opacity ?? 1,
          });
        }
        break;
      }
      case 'draw': {
        // Build an SVG path from the polyline
        const pts = op.points;
        let d = `M ${pts[0]} ${pts[1]}`;
        for (let i = 2; i < pts.length; i += 2) d += ` L ${pts[i]} ${pts[i+1]}`;
        page.drawSvgPath(d, {
          borderColor: op.color ? hexToRgb(op.color, window.PDFLib) : rgb(0,0,0),
          borderWidth: op.thickness || 2,
          opacity: op.opacity ?? 1,
        });
        break;
      }
      case 'whiteout': {
        page.drawRectangle({
          x: op.x, y: op.y, width: op.w, height: op.h,
          color: rgb(1, 1, 1), borderWidth: 0,
        });
        break;
      }
      case 'add_highlight':
      case 'add_underline':
      case 'add_strikeout': {
        // Text markup annotations (proper PDF annotations, not content)
        const rect = {
          x: op.x, y: op.y,
          width: op.w || 100, height: op.h || 14,
        };
        const color = op.color ? hexToRgb(op.color, window.PDFLib) : rgb(1, 1, 0);
        const subtype = op.op === 'add_highlight' ? 'Highlight'
          : op.op === 'add_underline' ? 'Underline' : 'StrikeOut';
        // pdf-lib annotation API via context
        addTextMarkupAnnotation(pdfDoc, page, subtype, rect, color, op.opacity ?? 0.5);
        break;
      }
      case 'add_image':
      case 'add_signature': {
        const asset = assets[op.assetId];
        if (!asset) break;
        const bytes = await asset.blob.arrayBuffer();
        let img;
        if (asset.mime === 'image/jpeg') img = await pdfDoc.embedJpg(bytes);
        else img = await pdfDoc.embedPng(bytes);
        page.drawImage(img, {
          x: op.x, y: op.y, width: op.w, height: op.h,
          opacity: op.opacity ?? 1,
          rotate: op.rotation ? degrees(op.rotation) : undefined,
        });
        break;
      }
      case 'move_object':
      case 'resize_object':
      case 'rotate_object':
      case 'delete_object':
      case 'set_property': {
        // Object-level ops are resolved at manifest build time:
        // the manifest stores the FINAL state of each added object.
        // These ops are no-ops here (kept for history fidelity).
        break;
      }
    }
    tick();
  }

  // If page ops changed the order, rebuild the document in the new order
  let outDoc = pdfDoc;
  if (pageOps.length > 0) {
    outDoc = await PDFDocument.create();
    const copied = await outDoc.copyPages(pdfDoc,
      pages.map(p => pdfDoc.getPages().indexOf(p)));
    copied.forEach(p => outDoc.addPage(p));
  }

  const bytes = await outDoc.save();
  return bytes;
}

/**
 * Apply page operations to a page array. Returns the new ordered array.
 * rotate_page mutates the PDFPage; others reorder/filter the array.
 */
function applyPageOps(pdfDoc, pages, ops, degrees) {
  let list = [...pages];
  for (const op of ops) {
    if (op.op === 'delete_page') {
      list.splice(op.page, 1);
    } else if (op.op === 'move_page') {
      const [p] = list.splice(op.from, 1);
      list.splice(op.to, 0, p);
    } else if (op.op === 'duplicate_page') {
      list.splice(op.page + 1, 0, list[op.page]);
    } else if (op.op === 'rotate_page') {
      const p = list[op.page];
      if (p) {
        const cur = p.getRotation().angle;
        p.setRotation(degrees((cur + (op.angle || 90)) % 360));
      }
    }
  }
  return list;
}

/**
 * Add a text-markup annotation (Highlight/Underline/StrikeOut) via
 * low-level pdf-lib objects.
 */
function addTextMarkupAnnotation(pdfDoc, page, subtype, rect, color, opacity) {
  const { PDFName, PDFNumber, PDFArray, PDFString } = window.PDFLib;
  const ctx = pdfDoc.context;

  const quad = ctx.obj([
    rect.x, rect.y + rect.height, rect.x + rect.width, rect.y + rect.height,
    rect.x, rect.y, rect.x + rect.width, rect.y,
  ]);
  const annot = ctx.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of(subtype),
    Rect: ctx.obj([rect.x, rect.y, rect.x + rect.width, rect.y + rect.height]),
    QuadPoints: quad,
    C: ctx.obj([color.red, color.green, color.blue]),
    CA: PDFNumber.of(opacity),
    Contents: PDFString.of(''),
  });
  const ref = ctx.register(annot);

  const annots = page.node.Annots();
  if (annots) {
    annots.push(ref);
  } else {
    page.node.set(PDFName.of('Annots'), ctx.obj([ref]));
  }
}

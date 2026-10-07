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
  'Helvetica-Oblique': 'HelveticaOblique',
  'Helvetica-BoldOblique': 'HelveticaBoldOblique',
  Times: 'TimesRoman',
  'Times-Bold': 'TimesRomanBold',
  Courier: 'Courier',
  'Courier-Bold': 'CourierBold',
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
        if (!op.text || !op.text.trim()) break; // skip empty (user cancelled)
        // Bold/italic map to Helvetica-Bold / Helvetica-Oblique variants
        let fontName = op.font || 'Helvetica';
        if (op.bold && op.italic) fontName = 'Helvetica-BoldOblique';
        else if (op.bold) fontName = 'Helvetica-Bold';
        else if (op.italic) fontName = 'Helvetica-Oblique';
        // Fallback: pdf-lib StandardFonts has these variants
        const font = await getFont(fontName);
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
        } else if (op.shape === 'line' || op.shape === 'arrow') {
          page.drawLine({
            start: { x: op.x, y: op.y },
            end: { x: op.x + op.w, y: op.y },
            thickness: th, color, opacity: op.opacity ?? 1,
          });
          if (op.shape === 'arrow') {
            // Arrowhead: two short lines at 30° from the tip
            const len = Math.hypot(op.w, 0) || 1;
            const ahLen = Math.min(14, len * 0.25);
            const angle = Math.atan2(0, op.w); // horizontal in our model
            const tipX = op.x + op.w, tipY = op.y;
            for (const da of [Math.PI - 0.5, Math.PI + 0.5]) {
              const a = angle + da;
              page.drawLine({
                start: { x: tipX, y: tipY },
                end: { x: tipX + ahLen * Math.cos(a), y: tipY + ahLen * Math.sin(a) },
                thickness: th, color, opacity: op.opacity ?? 1,
              });
            }
          }
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
      case 'add_link': {
        // Link annotation (URL or internal page)
        const { PDFName, PDFString, PDFNumber } = window.PDFLib;
        const ctx = pdfDoc.context;
        const linkAnnot = ctx.obj({
          Type: PDFName.of('Annot'),
          Subtype: PDFName.of('Link'),
          Rect: ctx.obj([op.x, op.y, op.x + (op.w || 100), op.y + (op.h || 20)]),
          Border: ctx.obj([PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0)]),
          A: ctx.obj({
            Type: PDFName.of('Action'),
            S: PDFName.of('URI'),
            URI: PDFString.of(op.url || ''),
          }),
        });
        const linkRef = ctx.register(linkAnnot);
        const existing = page.node.Annots();
        if (existing) existing.push(linkRef);
        else page.node.set(PDFName.of('Annots'), ctx.obj([linkRef]));
        break;
      }
      case 'add_stamp': {
        // Stamp: bordered text label burned into the page
        const stampColor = op.color ? hexToRgb(op.color, window.PDFLib) : rgb(0.86, 0.15, 0.15);
        const label = op.text || 'APPROVED';
        const fs = 22;
        const pad = 10;
        const tw = label.length * fs * 0.6;
        const bw = tw + pad * 2, bh = fs + pad * 2;
        page.drawRectangle({
          x: op.x, y: op.y, width: bw, height: bh,
          borderColor: stampColor, borderWidth: 3,
          color: rgb(1, 1, 1), opacity: 0.9,
        });
        const sfont = await getFont('Helvetica-Bold');
        page.drawText(label, {
          x: op.x + pad, y: op.y + pad,
          size: fs, font: sfont, color: stampColor,
        });
        break;
      }
      case 'add_form_field': {
        // Real AcroForm field via pdf-lib
        const form = pdfDoc.getForm();
        const fname = op.name || `field_${op.id || Date.now()}`;
        const fw = op.w || 150, fh = op.h || 24;
        if (op.fieldType === 'text' || op.fieldType === 'multiline') {
          const tf = form.createTextField(fname);
          tf.setText(op.value || '');
          if (op.fieldType === 'multiline') tf.enableMultiline();
          tf.addToPage(page, { x: op.x, y: op.y, width: fw, height: fh });
        } else if (op.fieldType === 'checkbox') {
          const cb = form.createCheckBox(fname);
          if (op.value) cb.check(); else cb.uncheck();
          cb.addToPage(page, { x: op.x, y: op.y, width: Math.min(fw, 24), height: Math.min(fh, 24) });
        } else if (op.fieldType === 'radio') {
          const rg = form.createRadioGroup(fname);
          const opts = op.options || ['Option 1'];
          opts.forEach((o, i) => {
            rg.addOptionToPage(o, page, {
              x: op.x, y: op.y - i * (fh + 6),
              width: Math.min(fw, 20), height: Math.min(fh, 20),
            });
          });
          if (op.value) rg.select(op.value);
        } else if (op.fieldType === 'dropdown') {
          const dd = form.createDropdown(fname);
          dd.setOptions(op.options || ['Option 1', 'Option 2']);
          dd.select(op.value || (op.options || [])[0] || 'Option 1');
          dd.addToPage(page, { x: op.x, y: op.y, width: fw, height: fh });
        }
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

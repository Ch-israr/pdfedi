/**
 * Konva overlay manager — one interactive layer per visible PDF page.
 *
 * Each page gets:
 *   - a PDF.js canvas (non-interactive, the rendered PDF)
 *   - a Konva Stage sized to the page, holding editor objects
 *
 * The overlay renders manifest operations as Konva nodes and stays in
 * sync via the history system. All geometry conversions go through
 * core/coordinates.js (PDF points, bottom-left origin).
 *
 * Depends on global `Konva` (loaded via script tag).
 */

import { pdfRectToScreen, screenRectToPdf } from '../core/coordinates.js';

export class OverlayManager {
  constructor() {
    this.stages = new Map(); // pageIndex -> { stage, layer, container }
    this.scale = 1.5;        // screen px per PDF point
  }

  setScale(scale) {
    this.scale = scale;
    // Rebuild all stages at new scale
    for (const [idx, entry] of this.stages) {
      this._resizeStage(idx, entry);
    }
  }

  /**
   * Create the overlay for a page. container is the div wrapping the
   * PDF.js canvas; pageDims = { widthPt, heightPt }.
   */
  createPage(pageIndex, container, pageDims) {
    this.destroyPage(pageIndex);
    const w = Math.floor(pageDims.widthPt * this.scale);
    const h = Math.floor(pageDims.heightPt * this.scale);

    const stageDiv = document.createElement('div');
    stageDiv.className = 'konva-overlay';
    stageDiv.style.cssText =
      `position:absolute;top:0;left:0;width:${w}px;height:${h}px;`;
    container.style.position = 'relative';
    container.appendChild(stageDiv);

    const stage = new Konva.Stage({
      container: stageDiv, width: w, height: h,
    });
    const layer = new Konva.Layer();
    stage.add(layer);

    const entry = { stage, layer, container, stageDiv, pageDims };
    this.stages.set(pageIndex, entry);
    return entry;
  }

  destroyPage(pageIndex) {
    const entry = this.stages.get(pageIndex);
    if (entry) {
      entry.stage.destroy();
      entry.stageDiv.remove();
      this.stages.delete(pageIndex);
    }
  }

  getLayer(pageIndex) {
    return this.stages.get(pageIndex)?.layer || null;
  }

  _resizeStage(pageIndex, entry) {
    const { pageDims } = entry;
    const w = Math.floor(pageDims.widthPt * this.scale);
    const h = Math.floor(pageDims.heightPt * this.scale);
    entry.stage.width(w);
    entry.stage.height(h);
    entry.stageDiv.style.width = `${w}px`;
    entry.stageDiv.style.height = `${h}px`;
  }

  // ---- Manifest op → Konva node ----

  /**
   * Render a manifest operation as Konva node(s) on the page layer.
   * Returns the created node(s). Each node gets node.setAttr('opId', op.id).
   */
  renderOp(pageIndex, op, assets = {}) {
    const layer = this.getLayer(pageIndex);
    if (!layer) return null;
    const entry = this.stages.get(pageIndex);
    const { heightPt } = entry.pageDims;
    const s = this.scale;
    let node = null;

    const common = { opId: op.id, draggable: true };

    switch (op.op) {
      case 'add_text': {
        const [sx, sy] = pdfToScreenPoint(op.x, op.y, heightPt, s);
        node = new Konva.Text({
          ...common,
          x: sx, y: sy - (op.size || 12) * s, // Konva text y is top
          text: op.text,
          fontSize: (op.size || 12) * s,
          fontFamily: op.font || 'Helvetica',
          fill: op.color || '#000000',
          opacity: op.opacity ?? 1,
        });
        break;
      }
      case 'add_shape': {
        const r = pdfRectToScreen(op, heightPt, s);
        if (op.shape === 'ellipse') {
          node = new Konva.Ellipse({
            ...common,
            x: r.x + r.width / 2, y: r.y + r.height / 2,
            radiusX: r.width / 2, radiusY: r.height / 2,
            fill: op.fill || null,
            stroke: op.stroke || '#000000',
            strokeWidth: (op.thickness || 2) * s,
            opacity: op.opacity ?? 1,
          });
        } else if (op.shape === 'line') {
          const [x1, y1] = pdfToScreenPoint(op.x, op.y, heightPt, s);
          const [x2, y2] = pdfToScreenPoint(op.x + op.w, op.y, heightPt, s);
          node = new Konva.Line({
            ...common,
            points: [x1, y1, x2, y2],
            stroke: op.stroke || '#000000',
            strokeWidth: (op.thickness || 2) * s,
            opacity: op.opacity ?? 1,
          });
        } else { // rect
          node = new Konva.Rect({
            ...common,
            x: r.x, y: r.y, width: r.width, height: r.height,
            fill: op.fill || null,
            stroke: op.stroke || '#000000',
            strokeWidth: (op.thickness || 2) * s,
            opacity: op.opacity ?? 1,
          });
        }
        break;
      }
      case 'add_highlight':
      case 'add_underline':
      case 'add_strikeout': {
        const r = pdfRectToScreen(op, heightPt, s);
        const color = op.color || '#ffff00';
        if (op.op === 'add_highlight') {
          node = new Konva.Rect({
            ...common, draggable: false,
            x: r.x, y: r.y, width: r.width, height: r.height,
            fill: color, opacity: op.opacity ?? 0.4,
          });
        } else {
          const ly = op.op === 'add_underline' ? r.y + r.height : r.y + r.height / 2;
          node = new Konva.Line({
            ...common, draggable: false,
            points: [r.x, ly, r.x + r.width, ly],
            stroke: color, strokeWidth: 2 * s,
            opacity: op.opacity ?? 0.8,
          });
        }
        break;
      }
      case 'whiteout': {
        const r = pdfRectToScreen(op, heightPt, s);
        node = new Konva.Rect({
          ...common, x: r.x, y: r.y, width: r.width, height: r.height,
          fill: '#ffffff', stroke: null,
        });
        break;
      }
      case 'draw': {
        // op.points is flat [x1,y1,x2,y2...] in PDF points
        const pts = [];
        for (let i = 0; i < op.points.length; i += 2) {
          const [sx, sy] = pdfToScreenPoint(op.points[i], op.points[i+1], heightPt, s);
          pts.push(sx, sy);
        }
        node = new Konva.Line({
          ...common,
          points: pts,
          stroke: op.color || '#000000',
          strokeWidth: (op.thickness || 2) * s,
          lineCap: 'round', lineJoin: 'round',
          opacity: op.opacity ?? 1,
        });
        break;
      }
      case 'add_image':
      case 'add_signature': {
        const asset = assets[op.assetId];
        if (!asset || !asset.image) return null;
        const r = pdfRectToScreen(op, heightPt, s);
        node = new Konva.Image({
          ...common,
          x: r.x, y: r.y, width: r.width, height: r.height,
          image: asset.image,
          opacity: op.opacity ?? 1,
        });
        break;
      }
      case 'redact_rects': {
        // Preview as black boxes (final output rasterizes the page)
        const group = new Konva.Group({ ...common, draggable: false });
        for (const rect of op.rects) {
          const r = pdfRectToScreen(rect, heightPt, s);
          group.add(new Konva.Rect({
            x: r.x, y: r.y, width: r.width, height: r.height, fill: '#000000',
          }));
        }
        node = group;
        break;
      }
    }

    if (node) {
      layer.add(node);
      layer.batchDraw();
    }
    return node;
  }

  /** Remove all nodes for an operation id. */
  removeOp(pageIndex, opId) {
    const layer = this.getLayer(pageIndex);
    if (!layer) return;
    layer.find(`[opId="${opId}"]`).forEach(n => n.destroy());
    layer.draw(); // immediate redraw (not batch) to avoid stale ghosts
  }

  /** Clear all editor objects from a page (keeps the stage). */
  clearPage(pageIndex) {
    const layer = this.getLayer(pageIndex);
    if (layer) { layer.destroyChildren(); layer.batchDraw(); }
  }

  destroy() {
    for (const idx of [...this.stages.keys()]) this.destroyPage(idx);
  }
}

function pdfToScreenPoint(x, y, pageHeightPt, scale) {
  return [x * scale, (pageHeightPt - y) * scale];
}

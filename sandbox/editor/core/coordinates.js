/**
 * Coordinate mapping between PDF space and screen space.
 *
 * PDF native: points (1/72 inch), origin at BOTTOM-LEFT, y grows UP.
 * Screen: CSS pixels, origin at TOP-LEFT, y grows DOWN.
 *
 * PDF.js viewport handles scale + rotation. This module provides the
 * pure math so the editor never mixes coordinate systems.
 *
 * Framework-agnostic: no DOM, no PDF.js imports. The caller supplies
 * page dimensions and the viewport transform.
 */

/**
 * Convert a PDF point (bottom-left origin) to screen pixels (top-left origin).
 * @param {number} x - PDF x in points
 * @param {number} y - PDF y in points (bottom-left origin)
 * @param {number} pageHeightPt - page height in points
 * @param {number} scale - viewport scale (screen px per PDF point)
 * @returns {[number, number]} screen [sx, sy] in CSS pixels
 */
export function pdfToScreen(x, y, pageHeightPt, scale) {
  return [x * scale, (pageHeightPt - y) * scale];
}

/**
 * Convert screen pixels (top-left origin) to a PDF point (bottom-left origin).
 */
export function screenToPdf(sx, sy, pageHeightPt, scale) {
  return [sx / scale, pageHeightPt - sy / scale];
}

/**
 * Convert a PDF rect {x, y, w, h} (bottom-left origin) to a screen rect
 * {x, y, w, h} (top-left origin). All values in respective units.
 */
export function pdfRectToScreen(rect, pageHeightPt, scale) {
  const [sx, syTop] = pdfToScreen(rect.x, rect.y + rect.h, pageHeightPt, scale);
  return {
    x: sx,
    y: syTop,
    width: rect.w * scale,
    height: rect.h * scale,
  };
}

/**
 * Convert a screen rect {x, y, width, height} (top-left) to a PDF rect
 * {x, y, w, h} (bottom-left, in points).
 */
export function screenRectToPdf(sr, pageHeightPt, scale) {
  const [px, pyBottom] = screenToPdf(sr.x, sr.y + sr.height, pageHeightPt, scale);
  return {
    x: px,
    y: pyBottom,
    w: sr.width / scale,
    h: sr.height / scale,
  };
}

/**
 * Snap a screen x coordinate to useful guides: page center, edges.
 * Returns { x, guide } where guide describes what was snapped to, or null.
 */
export function snapX(x, pageWidthPx, objects = [], threshold = 6) {
  const guides = [
    { pos: 0, label: 'left edge' },
    { pos: pageWidthPx / 2, label: 'center' },
    { pos: pageWidthPx, label: 'right edge' },
  ];
  for (const o of objects) {
    guides.push({ pos: o.x, label: 'object' });
    guides.push({ pos: o.x + o.width / 2, label: 'object center' });
    guides.push({ pos: o.x + o.width, label: 'object' });
  }
  let best = null;
  for (const g of guides) {
    const d = Math.abs(x - g.pos);
    if (d <= threshold && (!best || d < best.d)) best = { ...g, d };
  }
  return best ? { x: best.pos, guide: best.label } : { x, guide: null };
}

/** Same as snapX but for vertical guides. */
export function snapY(y, pageHeightPx, objects = [], threshold = 6) {
  const guides = [
    { pos: 0, label: 'top edge' },
    { pos: pageHeightPx / 2, label: 'middle' },
    { pos: pageHeightPx, label: 'bottom edge' },
  ];
  for (const o of objects) {
    guides.push({ pos: o.y, label: 'object' });
    guides.push({ pos: o.y + o.height / 2, label: 'object middle' });
    guides.push({ pos: o.y + o.height, label: 'object' });
  }
  let best = null;
  for (const g of guides) {
    const d = Math.abs(y - g.pos);
    if (d <= threshold && (!best || d < best.d)) best = { ...g, d };
  }
  return best ? { y: best.pos, guide: best.label } : { y, guide: null };
}

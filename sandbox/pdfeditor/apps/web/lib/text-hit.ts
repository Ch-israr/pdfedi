/**
 * Logical hit-testing for text-like elements.
 *
 * The DOM overlay for a text element is only as big as its rendered
 * glyphs. A click a few pixels off the glyphs (on the selection halo,
 * on a collapsed trailing line, or just beside a descender) misses the
 * element's DOM node entirely and reaches the page-level click handler.
 * Before the fix, that handler fell through to native-fragment detection
 * or new-text creation and minted a SECOND element next to the existing
 * one — the "editing creates a duplicate" bug.
 *
 * These helpers give every text-like element a logical box (the same
 * geometry the PDF export uses) so the page handler can route such
 * clicks to the existing element instead. Pure functions; text width
 * measurement is injected so this stays testable without a DOM.
 */
import type { EditorElement } from '@pdfeditor/shared';

export interface TextBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Same geometry constants as the annotation writer in @pdfeditor/pdf-core
// (annotations.ts): box top = firstBaseline + 1.0*fontSize, bottom =
// lastBaseline - 0.3*fontSize, line step = 1.25*fontSize.
export const TEXT_ASCENT = 1.0;
export const TEXT_DESCENT = 0.3;
export const TEXT_LINE_STEP = 1.25;

export interface FontSpec {
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
}

export type MeasureFn = (text: string, font: FontSpec) => number;

/** Logical PDF-point box of a text or native-text element, or null. */
export function textElementBox(el: EditorElement, measure: MeasureFn): TextBox | null {
  if (el.kind === 'native-text') {
    return { x0: el.x, y0: el.y, x1: el.x + el.width, y1: el.y + el.height };
  }
  if (el.kind !== 'text') return null;
  const lines = el.text.split('\n');
  let width = 0;
  for (const line of lines) {
    width = Math.max(
      width,
      measure(line, {
        fontSize: el.fontSize,
        fontFamily: el.fontFamily,
        bold: el.bold,
        italic: el.italic,
      }),
    );
  }
  const top = el.y + TEXT_ASCENT * el.fontSize;
  const lastBaseline = el.y - Math.max(0, lines.length - 1) * el.fontSize * TEXT_LINE_STEP;
  const bottom = lastBaseline - TEXT_DESCENT * el.fontSize;
  return { x0: el.x, y0: bottom, x1: el.x + Math.max(1, width), y1: top };
}

export function boxContains(box: TextBox, x: number, y: number, tolerance = 0): boolean {
  return (
    x >= box.x0 - tolerance && x <= box.x1 + tolerance && y >= box.y0 - tolerance && y <= box.y1 + tolerance
  );
}

/** Intersection area of `inner` covered by `outer`, as a ratio of inner's area. */
export function overlapRatio(outer: TextBox, inner: TextBox): number {
  const ix = Math.max(0, Math.min(outer.x1, inner.x1) - Math.max(outer.x0, inner.x0));
  const iy = Math.max(0, Math.min(outer.y1, inner.y1) - Math.max(outer.y0, inner.y0));
  const innerArea = Math.max(0, inner.x1 - inner.x0) * Math.max(0, inner.y1 - inner.y0);
  if (innerArea <= 0) return 0;
  return (ix * iy) / innerArea;
}

/**
 * Topmost text-like element whose logical box contains the point
 * (elements later in the array render on top, so scan in reverse).
 */
export function findTextElementAt(
  elements: EditorElement[],
  x: number,
  y: number,
  measure: MeasureFn,
  tolerance = 3,
): EditorElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.kind !== 'text' && el.kind !== 'native-text') continue;
    const box = textElementBox(el, measure);
    if (box && boxContains(box, x, y, tolerance)) return el;
  }
  return null;
}

/** Largest-overlap native-text element covering a fragment box, if any. */
export function findNativeCovering(
  elements: EditorElement[],
  fragment: TextBox,
  measure: MeasureFn,
  minRatio = 0.4,
): EditorElement | null {
  let best: EditorElement | null = null;
  let bestRatio = minRatio;
  for (const el of elements) {
    if (el.kind !== 'native-text') continue;
    const box = textElementBox(el, measure);
    if (!box) continue;
    const r = overlapRatio(box, fragment);
    if (r > bestRatio) {
      bestRatio = r;
      best = el;
    }
  }
  return best;
}

import type { EditorElement, Page } from '@pdfeditor/shared';

export interface Guide {
  /** 'v' = vertical line (x constant), 'h' = horizontal line (y constant) */
  orientation: 'v' | 'h';
  /** position in PDF points */
  pos: number;
}

interface Box {
  left: number;
  right: number;
  cx: number;
  top: number; // PDF y (bottom-left origin) — top means larger y
  bottom: number;
  cy: number;
}

/** Get bounding box in PDF points for an element. Returns null if size unknown. */
function getBox(el: EditorElement): Box | null {
  // Text elements don't store width/height; estimate from font size and text length.
  // This is only for guide purposes — never affects stored coordinates.
  let w: number;
  let h: number;
  if (el.kind === 'text') {
    const avgCharW = el.fontSize * 0.55;
    const lines = el.text.split('\n');
    const maxLen = Math.max(1, ...lines.map((l) => l.length));
    w = Math.max(20, maxLen * avgCharW);
    h = el.fontSize * 1.2 * Math.max(1, lines.length);
  } else if ('width' in el && 'height' in el) {
    w = Math.abs(el.width);
    h = Math.abs(el.height);
  } else {
    return null;
  }
  // el.x, el.y is the bottom-left origin (per ElementOverlay's translateY(-100%))
  const left = el.x;
  const right = el.x + w;
  const bottom = el.y;
  const top = el.y + h;
  return { left, right, cx: (left + right) / 2, top, bottom, cy: (top + bottom) / 2 };
}

/**
 * Calculate smart alignment guides for a dragged element.
 * Returns guides to display and optional snapped position.
 *
 * Guides are purely visual suggestions — they are never stored and never
 * exported. Snapping only applies when snapEnabled and the user is not
 * holding Alt (bypass).
 */
export function calcGuides(
  draggedId: string,
  newX: number,
  newY: number,
  elements: Record<string, EditorElement>,
  page: Page,
  threshold: number,
  snapEnabled: boolean,
  bypassSnap: boolean,
): { guides: Guide[]; snappedX: number; snappedY: number } {
  const guides: Guide[] = [];
  let snappedX = newX;
  let snappedY = newY;

  const draggedEl = elements[draggedId];
  if (!draggedEl) return { guides, snappedX, snappedY };

  // Build a temp element at the new position for box calculation
  const tempEl = { ...draggedEl, x: newX, y: newY } as EditorElement;
  const dBox = getBox(tempEl);
  if (!dBox) return { guides, snappedX, snappedY };

  // Candidate x positions: other elements' edges/centers + page boundaries
  const candX = new Map<number, string>(); // pos -> description (for dedupe)
  const candY = new Map<number, string>();

  // Page boundaries (PDF points)
  candX.set(0, 'page-left');
  candX.set(page.width / 2, 'page-center');
  candX.set(page.width, 'page-right');
  candY.set(0, 'page-bottom');
  candY.set(page.height / 2, 'page-middle');
  candY.set(page.height, 'page-top');

  for (const el of Object.values(elements)) {
    if (el.id === draggedId || el.pageId !== page.id) continue;
    const b = getBox(el);
    if (!b) continue;
    candX.set(b.left, 'el');
    candX.set(b.cx, 'el');
    candX.set(b.right, 'el');
    candY.set(b.top, 'el');
    candY.set(b.cy, 'el');
    candY.set(b.bottom, 'el');
  }

  // Check dragged edges against candidates
  const dXs = [
    { v: dBox.left, key: 'left' },
    { v: dBox.cx, key: 'cx' },
    { v: dBox.right, key: 'right' },
  ];
  const dYs = [
    { v: dBox.top, key: 'top' },
    { v: dBox.cy, key: 'cy' },
    { v: dBox.bottom, key: 'bottom' },
  ];

  let bestX: { dist: number; cand: number; edge: string } | null = null;
  for (const { v, key } of dXs) {
    for (const cand of candX.keys()) {
      const dist = Math.abs(v - cand);
      if (dist <= threshold && (!bestX || dist < bestX.dist)) {
        bestX = { dist, cand, edge: key };
      }
    }
  }

  let bestY: { dist: number; cand: number; edge: string } | null = null;
  for (const { v, key } of dYs) {
    for (const cand of candY.keys()) {
      const dist = Math.abs(v - cand);
      if (dist <= threshold && (!bestY || dist < bestY.dist)) {
        bestY = { dist, cand, edge: key };
      }
    }
  }

  if (bestX) {
    guides.push({ orientation: 'v', pos: bestX.cand });
    if (snapEnabled && !bypassSnap) {
      const delta = bestX.cand - (bestX.edge === 'left' ? dBox.left : bestX.edge === 'cx' ? dBox.cx : dBox.right);
      snappedX = newX + delta;
    }
  }
  if (bestY) {
    guides.push({ orientation: 'h', pos: bestY.cand });
    if (snapEnabled && !bypassSnap) {
      const delta = bestY.cand - (bestY.edge === 'bottom' ? dBox.bottom : bestY.edge === 'cy' ? dBox.cy : dBox.top);
      snappedY = newY + delta;
    }
  }

  return { guides, snappedX, snappedY };
}

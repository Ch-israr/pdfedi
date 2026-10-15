/**
 * Probe whether a native text fragment can be edited DIRECTLY in the
 * page's content stream (original run removed, replacement written as
 * real text — no mask). Wraps pdf-core's probeDirectTextEdit with a
 * per-fragment result cache so repeated clicks are instant.
 */
// NOTE: pdf-core is imported lazily inside probeDirectEdit (it pulls in
// pdf-lib, ~478 KB); probing only happens when the user clicks a text
// fragment, never at initial page load.
import type { NativeTextItem } from '@pdfeditor/shared';

export interface DirectProbeResult {
  editable: boolean;
  colorHex?: string;
  /** Exact (unrounded) font size of the matched run. */
  fontSize?: number;
  /** The run font's /BaseFont, e.g. "BCDHEE+Cambria-Bold". */
  fontBaseName?: string;
  /** Closest editor font for the run (standard-font fallback mapping). */
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  reason?: string;
}

const cache = new Map<string, Promise<DirectProbeResult>>();

/** Forget cached probe results (call when a new document is loaded). */
export function clearDirectProbeCache(): void {
  cache.clear();
}

/**
 * @param pdfBytes the uploaded document bytes
 * @param pageIndex 0-based page index in the SOURCE document (sourceIndex - 1)
 */
export function probeDirectEdit(
  pdfBytes: Uint8Array | null,
  pageIndex: number,
  item: Pick<NativeTextItem, 'id' | 'text' | 'x' | 'y' | 'baselineOffset'>,
): Promise<DirectProbeResult> {
  if (!pdfBytes || pageIndex < 0) {
    return Promise.resolve({ editable: false, reason: 'The document could not be inspected.' });
  }
  const key = `${pageIndex}:${item.id}:${Math.round(item.x * 10)},${Math.round(item.y * 10)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const baselineX = item.x;
  const baselineY = item.y + item.baselineOffset;
  // Narrowed once for the async closure below (params don't narrow in closures).
  const bytes: Uint8Array = pdfBytes;
  const p = (async (): Promise<DirectProbeResult> => {
    try {
      const { probeDirectTextEdit } = await import('@pdfeditor/pdf-core');
      const r = await probeDirectTextEdit(bytes, pageIndex, {
        text: item.text,
        baselineX,
        baselineY,
      });
      return {
        editable: r.editable,
        colorHex: r.colorHex,
        fontSize: r.fontSize,
        fontBaseName: r.fontBaseName,
        fontFamily: r.fontFamily,
        bold: r.bold,
        italic: r.italic,
        reason: r.reason,
      };
    } catch {
      return {
        editable: false,
        reason: 'The document could not be inspected for direct editing.',
      };
    }
  })();
  cache.set(key, p);
  return p;
}

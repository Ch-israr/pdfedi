/**
 * Sizing for the inline text editor (new-text and edit modes only).
 *
 * The editor box starts wide enough to fit its placeholder/default text
 * and grows horizontally as the user types (clamped to the page
 * boundary), and grows vertically one line step per newline
 * (Shift+Enter). Native-text mode never uses this — it keeps its exact
 * fragment cover so no duplicate text can show.
 *
 * Pure function of its inputs; covered by unit tests.
 */

export interface EditorFontSpec {
  fontSize: number; // PDF points
  fontFamily: string;
  bold: boolean;
  italic: boolean;
}

export type MeasureFn = (
  text: string,
  font: { fontSize: number; fontFamily: string; bold: boolean; italic: boolean },
) => number;

/** Must match the line step used when drawing text into the PDF. */
export const EDITOR_LINE_STEP = 1.25;

const HORIZONTAL_SLACK_PX = 16; // textarea padding + border + caret room
const VERTICAL_SLACK_PX = 12;
const MIN_WIDTH_PX = 60;

export function computeEditorSize(opts: {
  value: string;
  placeholder: string;
  font: EditorFontSpec;
  zoom: number;
  /** Page boundary in screen px — the box never exceeds this width. */
  maxWidthPx: number;
  measure: MeasureFn;
}): { widthPx: number; heightPx: number; lineHeightPx: number } {
  const { value, placeholder, font, zoom, maxWidthPx, measure } = opts;
  const fontPx = font.fontSize * zoom;
  const lineHeightPx = fontPx * EDITOR_LINE_STEP;
  const screenFont = {
    fontSize: fontPx,
    fontFamily: font.fontFamily,
    bold: font.bold,
    italic: font.italic,
  };
  const lines = value.split('\n');
  let contentW = 0;
  for (const line of lines) {
    contentW = Math.max(contentW, measure(line, screenFont));
  }
  if (!value) {
    // Empty box still fits the placeholder text.
    contentW = Math.max(contentW, measure(placeholder, screenFont));
  }
  const widthPx = Math.min(
    Math.max(contentW + HORIZONTAL_SLACK_PX, MIN_WIDTH_PX),
    Math.max(maxWidthPx, MIN_WIDTH_PX),
  );
  const heightPx = Math.max(lines.length, 1) * lineHeightPx + VERTICAL_SLACK_PX;
  return { widthPx, heightPx, lineHeightPx };
}

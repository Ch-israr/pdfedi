'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import type { EditorElement, NativeTextItem, Page } from '@pdfeditor/shared';
import { useEditor, type ToolId } from '@/store/editor';
import { calcGuides, type Guide } from '@/lib/smart-guides';
import { FloatingTextToolbar } from './FloatingTextToolbar';
import { NativeEditWarning } from './NativeEditWarning';
import { FloatingShapeToolbar } from './FloatingShapeToolbar';
import { FloatingImageToolbar } from './FloatingImageToolbar';
import { ResizeHandles } from './ResizeHandles';
import { LineEndpoints } from './LineEndpoints';

/** Screen px per PDF point at current zoom */
function toScreen(v: number, zoom: number) {
  return v * zoom;
}

/**
 * Convert PDF y (bottom-left origin, y up) to screen top (top-left origin, y down).
 * This is the inverse of screenToPdf's y conversion.
 */
function pdfYToScreenTop(pdfY: number, page: Page, zoom: number): number {
  return (page.height - pdfY) * zoom;
}

/** Convert a click on the page (offset px) to PDF points */
export function screenToPdf(
  offsetX: number,
  offsetY: number,
  page: Page,
  zoom: number,
): { x: number; y: number } {
  return {
    x: offsetX / zoom,
    y: page.height - offsetY / zoom, // PDF origin is bottom-left
  };
}

/**
 * Snap a drag vector to 15-degree increments (for Shift-constrained
 * line/arrow drawing). Preserves the drag length, snaps the angle.
 */
export function snapAngle(dx: number, dy: number): { dx: number; dy: number } {
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return { dx, dy };
  const angle = Math.atan2(dy, dx);
  const snap = Math.PI / 12; // 15 degrees
  const snapped = Math.round(angle / snap) * snap;
  return {
    dx: len * Math.cos(snapped),
    dy: len * Math.sin(snapped),
  };
}

/**
 * Screen geometry for a line/arrow element, whose model is a start point
 * (x, y) plus a delta vector (width, height) in PDF points. Returns the
 * endpoint positions in overlay-relative screen px plus the tight bounding
 * box the element div is positioned at.
 */
export function lineScreenGeometry(
  el: Extract<EditorElement, { kind: 'shape' }>,
  page: Page,
  zoom: number,
) {
  const sx1 = toScreen(el.x, zoom);
  const sy1 = pdfYToScreenTop(el.y, page, zoom);
  const sx2 = toScreen(el.x + el.width, zoom);
  const sy2 = pdfYToScreenTop(el.y + el.height, page, zoom);
  const bbLeft = Math.min(sx1, sx2);
  const bbTop = Math.min(sy1, sy2);
  const bbW = Math.max(Math.abs(sx2 - sx1), 2);
  const bbH = Math.max(Math.abs(sy2 - sy1), 2);
  return {
    bbLeft,
    bbTop,
    bbW,
    bbH,
    // Endpoints relative to the bounding box
    lx1: sx1 - bbLeft,
    ly1: sy1 - bbTop,
    lx2: sx2 - bbLeft,
    ly2: sy2 - bbTop,
  };
}

function ElementView({
  el,
  page,
  onGuides,
  onEditText,
  isEditing,
}: {
  el: EditorElement;
  page: Page;
  onGuides: (guides: Guide[]) => void;
  onEditText: (el: EditorElement, screenX: number, screenY: number) => void;
  isEditing: boolean;
}) {
  const zoom = useEditor((s) => s.zoom);
  const selectedId = useEditor((s) => s.selectedId);
  const select = useEditor((s) => s.select);
  const tool = useEditor((s) => s.tool);
  const updateElement = useEditor((s) => s.updateElement);
  const elements = useEditor((s) => s.elements);
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const snapThreshold = useEditor((s) => s.snapThreshold);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    mergeKey: string;
  } | null>(null);
  // Baked elements (restored from a source-less manifest) are already visible
  // in the page content. Render them as invisible hit-areas so the user can
  // click the baked text to edit it, without seeing a duplicate overlay.
  // NOTE: All hooks must be called before this early return (Rules of Hooks).
  if ((el as any).baked) {
    const left = el.x * zoom;
    const width = ((el as any).width ?? 100) * zoom;
    const height = ((el as any).height ?? (el.kind === 'text' ? (el as any).fontSize * 1.2 : 20)) * zoom;
    const top = (page.height - (el.y + height / zoom)) * zoom;
    return (
      <div
        data-el-id={el.id}
        style={{
          position: 'absolute',
          left,
          top,
          width,
          height,
          pointerEvents: 'auto',
          cursor: 'text',
        }}
      />
    );
  }
  const selected = selectedId === el.id;

  const left = toScreen(el.x, zoom);
  // el.y is PDF bottom-left origin → convert to CSS top (screen top-left origin)
  const top = pdfYToScreenTop(el.y, page, zoom);

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    select(el.id);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: el.x,
      origY: el.y,
      // One drag session = one undo step (history entries are merged)
      mergeKey: crypto.randomUUID(),
    };
    // Use currentTarget (the div with the handler), not target (may be a text node)
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / zoom;
    const dy = -(e.clientY - d.startY) / zoom; // screen y down → pdf y up
    let newX = d.origX + dx;
    let newY = d.origY + dy;

    // Smart guides: suggest alignment, never force. Alt bypasses snapping.
    const bypass = e.altKey;
    const { guides, snappedX, snappedY } = calcGuides(
      el.id,
      newX,
      newY,
      elements,
      page,
      snapThreshold,
      snapEnabled,
      bypass,
    );
    onGuides(guides);
    newX = snappedX;
    newY = snappedY;

    updateElement(
      el.id,
      { x: newX, y: newY } as Partial<EditorElement>,
      `Move ${el.kind === 'text' ? 'text' : el.kind === 'shape' ? (el.shape === 'line' ? 'line' : el.shape === 'arrow' ? 'arrow' : el.shape) : el.kind}`,
      { mergeKey: d.mergeKey },
    );
  };

  const onPointerUp = () => {
    dragRef.current = null;
    onGuides([]); // guides are temporary — removed when interaction ends
  };

  const style: React.CSSProperties = {
    position: 'absolute',
    left,
    top,
    transform: `translateY(-100%) rotate(${-el.rotation}deg)`,
    transformOrigin: 'bottom left',
    cursor: 'move',
    outline: selected ? '2px solid #2f6bff' : 'none',
    outlineOffset: 2,
    userSelect: 'none',
    WebkitUserSelect: 'none',
    touchAction: 'none',
  };

  const common = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onClick: (e: React.MouseEvent) => {
      // Fallback selection: ensures the element is selected even if
      // pointerdown was interrupted (e.g., by preventDefault in some browsers).
      // Stop propagation so the page-level click handler doesn't deselect.
      e.stopPropagation();
      select(el.id);
    },
    onDoubleClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      // Double-click on text enters editing mode (distinct from single-click select).
      // Only with the Text tool active — the Select tool must never trigger editing.
      if (tool !== 'text') return;
      if ((el.kind === 'text' || el.kind === 'native-text') && !isEditing) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const overlay = (e.currentTarget as HTMLElement).closest('.element-overlay-root');
        const orect = overlay?.getBoundingClientRect();
        onEditText(
          el,
          rect.left - (orect?.left ?? 0),
          rect.bottom - (orect?.top ?? 0),
        );
      }
    },
    style,
    'data-el-id': el.id,
  };

  switch (el.kind) {
    case 'text': {
      // If this was a baked element that has been modified, add a white
      // background to cover the old baked text underneath in the editor.
      const wasBaked = (el as any).bakedBounds && !(el as any).baked;
      return (
        <div
          {...common}
          style={{
            ...style,
            fontSize: toScreen(el.fontSize, zoom),
            fontFamily: el.fontFamily,
            color: el.color,
            fontWeight: el.bold ? 'bold' : 'normal',
            fontStyle: el.italic ? 'italic' : 'normal',
            whiteSpace: 'pre-wrap',
            minWidth: 20,
            ...(wasBaked ? { backgroundColor: 'white', padding: '2px 4px' } : {}),
          }}
        >
          {el.text}
        </div>
      );
    }
    case 'native-text':
      return (
        <div
          {...common}
          style={{
            ...style,
            // Positioned by cover-box TOP-left: override the baseline-based top.
            // (The shared `style` uses el.y as a baseline; native-text stores
            // the cover-box bottom, so shift up by the box height.)
            top: pdfYToScreenTop(el.y + el.height, page, zoom),
            transform: `rotate(${-el.rotation}deg)`,
            width: toScreen(el.width, zoom),
            height: toScreen(el.height, zoom),
            background: '#ffffff',
            fontSize: toScreen(el.fontSize, zoom),
            fontFamily: el.fontFamily,
            color: el.color,
            fontWeight: el.bold ? 'bold' : 'normal',
            fontStyle: el.italic ? 'italic' : 'normal',
            whiteSpace: 'pre-wrap',
            overflow: 'visible',
            // Align text to the original baseline within the cover box
            paddingBottom: toScreen(el.baselineOffset, zoom),
            display: 'flex',
            alignItems: 'flex-end',
          }}
        >
          {el.text}
        </div>
      );
    case 'highlight':
      return (
        <div
          {...common}
          style={{
            ...style,
            width: toScreen(el.width, zoom),
            height: toScreen(el.height, zoom),
            background: el.color,
            opacity: el.opacity,
          }}
        >
          {selected && <ResizeHandles el={el} zoom={zoom} />}
        </div>
      );
    case 'shape':
      const isLine = el.shape === 'line' || el.shape === 'arrow';
      if (isLine) {
        // Lines/arrows: defined by start (x,y) and delta (width,height).
        // Render in a bounding-box div with SVG; endpoints use dedicated handles.
        const g = lineScreenGeometry(el, page, zoom);
        const { bbLeft, bbTop, bbW, bbH, lx1, ly1, lx2, ly2 } = g;
        const sw = Math.max(1, toScreen(el.strokeWidth, zoom));
        // Arrowhead triangle at end point
        const headLen = Math.max(12, sw * 4);
        const angle = Math.atan2(ly2 - ly1, lx2 - lx1);
        const a1 = angle + Math.PI - 0.44;
        const a2 = angle + Math.PI + 0.44;
        const hx1 = lx2 + headLen * Math.cos(a1);
        const hy1 = ly2 + headLen * Math.sin(a1);
        const hx2 = lx2 + headLen * Math.cos(a2);
        const hy2 = ly2 + headLen * Math.sin(a2);
        // Position div at bbox (override the default bottom-left positioning)
        // No rectangular outline for lines/arrows — selection is shown via
        // the two endpoint handles and a subtle line highlight instead.
        const lineStyle: React.CSSProperties = {
          position: 'absolute',
          left: bbLeft,
          top: bbTop,
          width: bbW,
          height: bbH,
          cursor: 'move',
          outline: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          touchAction: 'none',
        };
        // Wider invisible hit area for easier middle-drag
        const hitSw = Math.max(sw, 12);
        return (
          <div
            {...common}
            style={lineStyle}
            data-el-id={el.id}
          >
            <svg
              width={bbW}
              height={bbH}
              style={{ display: 'block', overflow: 'visible', pointerEvents: 'none' }}
            >
              {/* Invisible wide hit line for middle-drag */}
              <line
                x1={lx1}
                y1={ly1}
                x2={lx2}
                y2={ly2}
                stroke="transparent"
                strokeWidth={hitSw}
                strokeLinecap="round"
                style={{ pointerEvents: 'stroke' }}
              />
              {/* Visible line */}
              <line
                x1={lx1}
                y1={ly1}
                x2={lx2}
                y2={ly2}
                stroke={el.stroke}
                strokeWidth={sw}
                strokeLinecap="round"
              />
              {/* Subtle selection highlight (replaces rectangular box) */}
              {selected && (
                <line
                  x1={lx1}
                  y1={ly1}
                  x2={lx2}
                  y2={ly2}
                  stroke="#2f6bff"
                  strokeWidth={Math.max(1.5, sw * 0.4)}
                  strokeLinecap="round"
                  strokeDasharray={`${4 * zoom} ${3 * zoom}`}
                  opacity={0.9}
                />
              )}
              {el.shape === 'arrow' && (
                <polygon
                  points={`${lx2},${ly2} ${hx1},${hy1} ${hx2},${hy2}`}
                  fill={el.stroke}
                />
              )}
            </svg>
            {selected && (
              <LineEndpoints el={el} page={page} zoom={zoom} />
            )}
          </div>
        );
      }
      // A circle is an ellipse whose width and height match. Resizing it must
      // preserve proportions (aspect-locked corners) so it cannot be
      // unintentionally distorted into an ellipse.
      const isCircle =
        el.shape === 'ellipse' &&
        Math.abs(Math.abs(el.width) - Math.abs(el.height)) < 0.5;
      return (
        <div
          {...common}
          style={{
            ...style,
            width: toScreen(Math.abs(el.width), zoom),
            height: toScreen(Math.abs(el.height), zoom),
            border: `${Math.max(1, toScreen(el.strokeWidth, zoom))}px solid ${el.stroke}`,
            background: el.fill ?? 'transparent',
            borderRadius: el.shape === 'ellipse' ? '50%' : 0,
          }}
        >
          {selected && (
            <ResizeHandles el={el} zoom={zoom} lockAspect={isCircle} cornersOnly={isCircle} />
          )}
        </div>
      );
    case 'image':
    case 'signature':
      return (
        <ResizableImage
          el={el}
          page={page}
          zoom={zoom}
          selected={selected}
          commonProps={common}
        />
      );
  }
}

// Wrapper that adds resize handles to img elements (can't have children)
function ResizableImage({
  el,
  page,
  zoom,
  selected,
  commonProps,
}: {
  el: Extract<EditorElement, { kind: 'image' | 'signature' }>;
  page: Page;
  zoom: number;
  selected: boolean;
  commonProps: Record<string, unknown>;
}) {
  return (
    <div
      {...(commonProps as React.HTMLAttributes<HTMLDivElement>)}
      style={{
        ...(commonProps.style as React.CSSProperties),
        width: toScreen(el.width, zoom),
        height: toScreen(el.height, zoom),
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={el.src}
        alt=""
        draggable={false}
        style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
      />
      {selected && <ResizeHandles el={el} zoom={zoom} lockAspect cornersOnly />}
    </div>
  );
}

/**
 * Overlay for one page: renders elements and handles click-to-place for tools.
 */
export function ElementOverlay({ page }: { page: Page }) {
  const elements = useEditor((s) => s.elements);
  const tool = useEditor((s) => s.tool);
  const zoom = useEditor((s) => s.zoom);
  const addElement = useEditor((s) => s.addElement);
  const select = useEditor((s) => s.select);
  const selectedId = useEditor((s) => s.selectedId);
  // Smart guides are temporary — shown only during drag, never stored/exported
  const [guides, setGuides] = useState<Guide[]>([]);
  const onGuides = useCallback((g: Guide[]) => setGuides(g), []);
  // Inline text editing: new text, editing existing text element,
  // or editing native PDF text (mode 'native')
  const [editingText, setEditingText] = useState<
    | { mode: 'new'; x: number; y: number; screenX: number; screenY: number }
    | { mode: 'edit'; id: string; screenX: number; screenY: number; initialText: string }
    | {
        mode: 'native';
        nativeItem: NativeTextItem;
        existingId: string | null;
        screenX: number;
        screenY: number;
        /** Fragment bounds in screen px — editor covers the original exactly */
        screenW?: number;
        screenH?: number;
        fontSize?: number;
        initialText: string;
      }
    | null
  >(null);
  // Pending formatting for new text (shown in toolbar while typing)
  const [pendingFormat, setPendingFormat] = useState({
    fontSize: 14,
    fontFamily: 'Helvetica',
    color: '#000000',
    bold: false,
    italic: false,
  });
  // Drag-to-draw state for shapes + highlight: press → drag → release
  // (lines/arrows use start/end points; rect/ellipse/highlight use drag rectangle)
  const [drawing, setDrawing] = useState<{
    shape: 'line' | 'arrow' | 'rect' | 'ellipse' | 'highlight';
    startX: number; // PDF points
    startY: number;
    curX: number;
    curY: number;
    shiftKey: boolean; // for circle constraint / angle snap
  } | null>(null);
  // One-time warning when native editing is attempted on flat content
  const [showNativeWarning, setShowNativeWarning] = useState(false);
  const nativeEditWarned = useEditor((s) => s.nativeEditWarned);
  const markNativeEditWarned = useEditor((s) => s.markNativeEditWarned);
  const drawRef = useRef<HTMLDivElement>(null);

  const els = Object.values(elements).filter((e) => e.pageId === page.id);

  const commitText = useCallback(
    (text: string) => {
      if (!editingText) return;
      const et = editingText;
      setEditingText(null);
      if (et.mode === 'edit') {
        // Editing existing: update text, or delete if emptied
        if (!text.trim()) {
          useEditor.getState().deleteElement(et.id);
        } else if (text !== et.initialText) {
          useEditor.getState().updateElement(et.id, { text }, 'Edit text');
        }
        return;
      }
      if (et.mode === 'native') {
        // Editing native PDF text: create (or update) a native-text element
        // that covers the original with an opaque rect on export.
        if (!text.trim()) {
          // Emptied → remove the edit if one existed (original shows again)
          if (et.existingId) useEditor.getState().deleteElement(et.existingId);
          return;
        }
        if (text === et.initialText && et.existingId) return; // unchanged
        const item = et.nativeItem;
        const elId = et.existingId ?? crypto.randomUUID();
        const label = `Edit native text — "${text.length > 30 ? text.slice(0, 30) + '…' : text}"`;
        if (et.existingId) {
          useEditor.getState().updateElement(et.existingId, { text }, label);
        } else {
          addElement(
            {
              id: elId,
              pageId: page.id,
              kind: 'native-text',
              x: item.x,
              y: item.y,
              rotation: 0,
              originalText: item.text,
              text,
              width: item.width,
              height: item.height,
              baselineOffset: item.baselineOffset,
              fontSize: item.fontSize,
              fontFamily: item.fontFamily,
              color: '#000000',
              bold: item.bold,
              italic: item.italic,
            },
            label,
          );
        }
        return;
      }
      // New text
      const { x, y } = et;
      if (!text.trim()) return; // empty → discard, don't create element
      const id = crypto.randomUUID();
      addElement(
        {
          id,
          pageId: page.id,
          kind: 'text',
          x,
          y: y - 12,
          rotation: 0,
          text,
          fontSize: pendingFormat.fontSize,
          fontFamily: pendingFormat.fontFamily,
          color: pendingFormat.color,
          bold: pendingFormat.bold,
          italic: pendingFormat.italic,
        },
        `Text Added — "${text.length > 30 ? text.slice(0, 30) + '…' : text}"`,
      );
      // Reset pending format for next time
      setPendingFormat({
        fontSize: 14,
        fontFamily: 'Helvetica',
        color: '#000000',
        bold: false,
        italic: false,
      });
    },
    [editingText, addElement, page.id, pendingFormat],
  );

  // Start editing an existing text element (double-click)
  const startEditText = useCallback(
    (el: EditorElement, screenX: number, screenY: number) => {
      if (el.kind !== 'text' && el.kind !== 'native-text') return;
      select(el.id);
      if (el.kind === 'native-text') {
        // Re-edit a native-text element: pre-fill with its current text
        setEditingText({
          mode: 'native',
          nativeItem: {
            id: `nt-${el.id}`,
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
            baselineOffset: el.baselineOffset,
            text: el.originalText,
            fontSize: el.fontSize,
            fontFamily: el.fontFamily,
            bold: el.bold,
            italic: el.italic,
          },
          existingId: el.id,
          screenX,
          screenY,
          initialText: el.text,
        });
        return;
      }
      setEditingText({
        mode: 'edit',
        id: el.id,
        screenX,
        screenY,
        initialText: el.text,
      });
    },
    [select],
  );

  // Native text items for this page — read imperatively (not via a reactive
  // selector) to avoid the render-crash seen with useEditor selectors here.
  /** Find the native text fragment under a PDF-point position, if any. */
  const hitNativeText = (x: number, y: number): NativeTextItem | null => {
    const items = useEditor.getState().nativeText?.[page.id] ?? [];
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (x >= it.x && x <= it.x + it.width && y >= it.y && y <= it.y + it.height) {
        return it;
      }
    }
    return null;
  };

  /**
   * Check whether a native text fragment can be safely edited by the current
   * implementation. Returns false for fragments with missing/degenerate
   * geometry or empty text — these must not be treated as directly editable
   * (and must not be auto-classified as "scanned"; the limitation is explicit).
   */
  const isNativeTextEditable = (item: NativeTextItem): boolean => {
    if (!item.text || item.text.trim().length === 0) return false;
    if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) return false;
    if (!Number.isFinite(item.width) || item.width <= 0) return false;
    if (!Number.isFinite(item.height) || item.height <= 0) return false;
    if (!Number.isFinite(item.fontSize) || item.fontSize <= 0) return false;
    return true;
  };

  const onPageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // If clicking on an existing element: with the Text tool, clicking a
    // native-text element opens it for editing (pre-filled). For other tools
    // or element kinds, let the element's own handlers deal with it.
    const elIdAttr = (e.target as HTMLElement).closest('[data-el-id]');
    if (elIdAttr) {
      if (tool === 'text') {
        const clickedId = elIdAttr.getAttribute('data-el-id');
        const clickedEl = clickedId ? els.find((el) => el.id === clickedId) : undefined;
        if (clickedEl && clickedEl.kind === 'native-text') {
          // Open the existing native-text element for editing (pre-filled).
          // Position the editor over the element bounds.
          const elLeft = clickedEl.x * zoom;
          const elTop = (page.height - (clickedEl.y + clickedEl.height)) * zoom;
          const elWidth = clickedEl.width * zoom;
          const elHeight = clickedEl.height * zoom;
          // Select the element so the floating toolbar appears during editing.
          select(clickedEl.id);
          setEditingText({
            mode: 'native',
            nativeItem: {
              id: `nt-${clickedEl.id}`,
              x: clickedEl.x,
              y: clickedEl.y,
              width: clickedEl.width,
              height: clickedEl.height,
              baselineOffset: clickedEl.baselineOffset,
              text: clickedEl.originalText,
              fontSize: clickedEl.fontSize,
              fontFamily: clickedEl.fontFamily,
              bold: clickedEl.bold,
              italic: clickedEl.italic,
            },
            existingId: clickedEl.id,
            screenX: elLeft,
            screenY: elTop,
            screenW: elWidth,
            screenH: elHeight,
            fontSize: clickedEl.fontSize,
            initialText: clickedEl.text,
          });
          return;
        }
        if (clickedEl && clickedEl.kind === 'text') {
          // Open a restored/added text element for editing (pre-filled).
          // This handles the re-upload case: the element was baked into the
          // PDF on export, restored from the manifest, and must be editable
          // without creating a duplicate.
          const elLeft = clickedEl.x * zoom;
          const elHeight = (clickedEl as any).height ?? clickedEl.fontSize * 1.2;
          const elTop = (page.height - (clickedEl.y + elHeight)) * zoom;
          // Select the element so the floating toolbar appears during editing.
          select(clickedEl.id);
          setEditingText({
            mode: 'edit',
            id: clickedEl.id,
            screenX: elLeft,
            screenY: elTop,
            initialText: clickedEl.text,
          });
          return;
        }
      }
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const { x, y } = screenToPdf(e.clientX - rect.left, e.clientY - rect.top, page, zoom);
    const id = crypto.randomUUID();

    // Direct native-text editing: with the Text tool active, clicking an
    // existing PDF text fragment opens the inline editor for it instead of
    // starting a new overlay. (The Select tool performs selection only and
    // must not trigger text editing. Clicks on already-edited text hit the
    // element overlay above and return early.)
    if (tool === 'text') {
      const hit = hitNativeText(x, y);
      if (hit) {
        // Verify the fragment is actually editable before opening the editor
        // (non-empty text, valid dimensions, supported orientation).
        if (isNativeTextEditable(hit)) {
          // Skip if a native-text element already covers this fragment — the
          // element itself handles the click (returned early above), but guard
          // against stale overlap anyway.
          const covered = els.some(
            (el) =>
              el.kind === 'native-text' &&
              Math.abs(el.x - hit.x) < 1 &&
              Math.abs(el.y - hit.y) < 1,
          );
          if (!covered) {
            // Position the editor exactly over the fragment bounds (not the
            // click point) so the opaque textarea covers the original text —
            // no duplicate visual. Convert fragment PDF bounds to screen px.
            const fragLeft = hit.x * zoom;
            const fragTop = (page.height - (hit.y + hit.height)) * zoom;
            const fragWidth = hit.width * zoom;
            const fragHeight = hit.height * zoom;
            setEditingText({
              mode: 'native',
              nativeItem: hit,
              existingId: null,
              screenX: fragLeft,
              screenY: fragTop,
              screenW: fragWidth,
              screenH: fragHeight,
              fontSize: hit.fontSize,
              initialText: hit.text,
            });
            return;
          }
        }
        // Fragment hit but not safely editable: fall through to the
        // one-time warning via double-click (handled separately), or to
        // new-text creation for single click. Do not create a duplicate.
      }
    }

    const place = (el: EditorElement, label: string) => addElement(el, label);

    switch (tool as ToolId) {
      case 'text': {
        // Inline editing: show a textarea at the click position instead of window.prompt
        const rect2 = e.currentTarget.getBoundingClientRect();
        setEditingText({
          mode: 'new',
          x,
          y,
          screenX: e.clientX - rect2.left,
          screenY: e.clientY - rect2.top,
        });
        break;
      }
      case 'highlight':
        // Drag-to-draw: handled by onPagePointerDown/Move/Up. A click without
        // drag is intentionally discarded (no default-size box).
        break;
      case 'shape-rect':
      case 'shape-ellipse':
        // Drag-to-draw: handled by onPagePointerDown/Move/Up. Click without
        // drag is intentionally discarded (no default-size element).
        break;
      case 'shape-line':
      case 'shape-arrow':
        // Drag-to-draw: handled by onPagePointerDown/Move/Up. Click without
        // drag is intentionally discarded (no default-size element).
        break;
      case 'image': {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png,image/jpeg';
        input.onchange = () => {
          const f = input.files?.[0];
          if (!f) return;
          const url = URL.createObjectURL(f);
          const img = new Image();
          img.onload = () => {
            const maxW = 300;
            const scale = Math.min(1, maxW / img.width);
            place(
              {
                id, pageId: page.id, kind: 'image', x, y: y - img.height * scale,
                rotation: 0, src: url, width: img.width * scale,
                height: img.height * scale, mime: f.type,
              },
              'Image Added',
            );
          };
          img.src = url;
        };
        input.click();
        break;
      }
      case 'signature': {
        // Simple signature pad via prompt-free canvas modal would go here;
        // MVP: draw on a small canvas dialog.
        openSignaturePad((dataUrl, w, h) => {
          place(
            {
              id, pageId: page.id, kind: 'signature', x, y: y - h,
              rotation: 0, src: dataUrl, width: w, height: h,
            },
            'Signature Added',
          );
        });
        break;
      }
      default:
        select(null);
    }
  };

  // Drag-to-draw for shapes: press → drag → release defines the geometry.
  // No default-size element is created; a click without drag is discarded.
  const onPagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const drawShape = tool === 'shape-line' ? 'line'
      : tool === 'shape-arrow' ? 'arrow'
      : tool === 'shape-rect' ? 'rect'
      : tool === 'shape-ellipse' ? 'ellipse'
      : tool === 'highlight' ? 'highlight'
      : null;
    if (!drawShape) return;
    // Handles take priority over drawing tools: if the pointer is on a
    // resize/endpoint handle, let the handle's own handler run instead.
    if ((e.target as HTMLElement).closest('[data-handle]')) return;
    if ((e.target as HTMLElement).closest('[data-el-id]')) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const { x, y } = screenToPdf(e.clientX - rect.left, e.clientY - rect.top, page, zoom);
    setDrawing({
      shape: drawShape,
      startX: x,
      startY: y,
      curX: x,
      curY: y,
      shiftKey: e.shiftKey,
    });
  };

  const onPagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawing) return;
    const rect = (drawRef.current ?? e.currentTarget).getBoundingClientRect();
    const { x, y } = screenToPdf(e.clientX - rect.left, e.clientY - rect.top, page, zoom);
    setDrawing((d) => (d ? { ...d, curX: x, curY: y, shiftKey: e.shiftKey } : d));
  };

  const onPagePointerCancel = () => {
    // Pointer cancelled (e.g., gesture interrupted): discard preview, no element.
    setDrawing(null);
  };

  const onPagePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawing) return;
    const d = drawing;
    setDrawing(null);
    const dx = d.curX - d.startX;
    const dy = d.curY - d.startY;
    // Require a minimum drag distance (in PDF points); a simple click is discarded.
    if (d.shape === 'line' || d.shape === 'arrow') {
      if (Math.hypot(dx, dy) < 5) return;
    } else {
      if (Math.abs(dx) < 5 || Math.abs(dy) < 5) return;
    }
    const id = crypto.randomUUID();

    if (d.shape === 'line' || d.shape === 'arrow') {
      // Apply angle snapping if Shift was held
      let fdx = dx, fdy = dy;
      if (d.shiftKey) {
        const snapped = snapAngle(dx, dy);
        fdx = snapped.dx; fdy = snapped.dy;
      }
      addElement(
        {
          id,
          pageId: page.id,
          kind: 'shape',
          x: d.startX,
          y: d.startY,
          rotation: 0,
          shape: d.shape,
          width: fdx,
          height: fdy,
          stroke: '#000000',
          strokeWidth: 2,
          fill: null,
        },
        d.shape === 'arrow' ? 'Arrow Added' : 'Line Added',
      );
    } else {
      // Rect/ellipse: normalize drag rectangle (handles all drag directions).
      // x,y is the bottom-left in PDF coords; width/height are positive.
      let x1 = d.startX, y1 = d.startY, x2 = d.curX, y2 = d.curY;
      if (d.shiftKey && d.shape === 'ellipse') {
        // Shift constrains ellipse to a circle: use max dimension
        const w = Math.abs(x2 - x1);
        const h = Math.abs(y2 - y1);
        const size = Math.max(w, h);
        x2 = x1 + Math.sign(x2 - x1 || 1) * size;
        y2 = y1 + Math.sign(y2 - y1 || 1) * size;
      }
      const x = Math.min(x1, x2);
      const y = Math.min(y1, y2);
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      if (d.shape === 'highlight') {
        // Highlight: commit the dragged rectangle with the standard
        // highlight style (yellow, translucent). Same undo/history path.
        addElement(
          {
            id,
            pageId: page.id,
            kind: 'highlight',
            x,
            y,
            rotation: 0,
            width: w,
            height: h,
            color: '#FFFF00',
            opacity: 0.4,
          },
          'Highlight Added',
        );
      } else {
        addElement(
          {
            id,
            pageId: page.id,
            kind: 'shape',
            x,
            y,
            rotation: 0,
            shape: d.shape,
            width: w,
            height: h,
            stroke: '#000000',
            strokeWidth: 2,
            fill: null,
          },
          d.shape === 'rect' ? 'Rectangle Added' : 'Ellipse Added',
        );
      }
    }
  };

  return (
    <div
      ref={drawRef}
      className={`element-overlay-root absolute inset-0 ${tool === 'move' ? 'cursor-move' : ''}`}
      onClick={onPageClick}
      onDoubleClick={(e) => {
        // One-time warning: double-click with the Text tool is the "edit this"
        // gesture. If it lands on non-editable content (not a native text
        // fragment, not an existing element), the content cannot be edited
        // directly. (Select tool does not trigger editing, so no warning there.)
        if (nativeEditWarned) return;
        if (tool !== 'text') return;
        if ((e.target as HTMLElement).closest('[data-el-id]')) return;
        // Check if the click hit an editable native text fragment at this
        // position (not just whether the page has any text). If it hit one,
        // no warning is needed — the fragment is editable.
        const rect = e.currentTarget.getBoundingClientRect();
        const { x, y } = screenToPdf(e.clientX - rect.left, e.clientY - rect.top, page, zoom);
        const hit = hitNativeText(x, y);
        if (hit && isNativeTextEditable(hit)) return;
        markNativeEditWarned();
        setShowNativeWarning(true);
      }}
      onPointerDown={onPagePointerDown}
      onPointerMove={onPagePointerMove}
      onPointerUp={onPagePointerUp}
      onPointerCancel={onPagePointerCancel}
    >
      {els.map((el) => (
        <ElementView
          key={el.id}
          el={el}
          page={page}
          onGuides={onGuides}
          onEditText={startEditText}
          isEditing={
            (editingText?.mode === 'edit' && editingText.id === el.id) ||
            (editingText?.mode === 'native' && editingText.existingId === el.id)
          }
        />
      ))}
      {/* Drag-to-draw preview for lines/arrows */}
      {drawing && <DrawingPreview drawing={drawing} page={page} zoom={zoom} />}
      {/* Inline text editor — new text or editing existing */}
      {editingText && (
        <InlineTextEditor
          screenX={editingText.screenX}
          screenY={editingText.screenY}
          screenW={editingText.mode === 'native' ? editingText.screenW : undefined}
          screenH={editingText.mode === 'native' ? editingText.screenH : undefined}
          fontSize={editingText.mode === 'native' ? editingText.fontSize : undefined}
          zoom={zoom}
          initialText={
            editingText.mode === 'new' ? '' : editingText.initialText
          }
          onCommit={commitText}
          onCancel={() => setEditingText(null)}
        />
      )}
      {/* Floating toolbar for selected text (shown during selection AND editing) */}
      {(() => {
        // During new-text mode: show toolbar with pending formatting
        if (editingText?.mode === 'new') {
          const syntheticEl = {
            id: '__new__',
            kind: 'text' as const,
            pageId: page.id,
            x: editingText.x,
            y: editingText.y,
            rotation: 0,
            text: '',
            ...pendingFormat,
          };
          const sx = toScreen(editingText.x, zoom);
          const baselineY = pdfYToScreenTop(editingText.y, page, zoom);
          const textH = pendingFormat.fontSize * 1.2 * zoom;
          const textTop = baselineY - textH;
          return (
            <FloatingTextToolbar
              el={syntheticEl}
              screenX={sx}
              screenY={textTop}
              textHeight={textH}
              zoom={zoom}
              editing={true}
              overrideUpdate={(_id, patch) => {
                setPendingFormat((f) => ({ ...f, ...patch }));
              }}
            />
          );
        }
        if (!selectedId) return null;
        const sel = els.find((e) => e.id === selectedId);
        if (!sel) return null;
        const duplicateElement = useEditor.getState().duplicateElement;

        // Helper: compute screen position for shape/image elements
        const elScreen = (e: typeof sel) => {
          const sx = toScreen(e.x, zoom);
          const baselineY = pdfYToScreenTop(e.y, page, zoom);
          // Element height in screen px (for toolbar positioning below if needed)
          const h = 'height' in e ? Math.abs(e.height) * zoom : 0;
          const top = baselineY - h;
          return { sx, top, h };
        };

        if (sel.kind === 'text' || sel.kind === 'native-text') {
          // Position above the element: use correct PDF→screen conversion
          // and account for actual text height so toolbar follows font size changes.
          const sx = toScreen(sel.x, zoom);
          // 'text' stores a baseline y; 'native-text' stores cover-box bottom
          const baseY =
            sel.kind === 'native-text' ? sel.y + sel.baselineOffset : sel.y;
          const baselineY = pdfYToScreenTop(baseY, page, zoom);
          // Estimate text height: fontSize * lineHeight * lines * zoom
          const lineCount = Math.max(1, sel.text.split('\n').length);
          const textH = sel.fontSize * 1.2 * lineCount * zoom;
          const textTop = baselineY - textH;
          const isEditing =
            sel.kind === 'text'
              ? editingText?.mode === 'edit' && editingText.id === selectedId
              : editingText?.mode === 'native' && editingText.existingId === selectedId;
          return (
            <FloatingTextToolbar
              el={sel}
              screenX={sx}
              screenY={textTop}
              textHeight={textH}
              zoom={zoom}
              editing={isEditing}
            />
          );
        }
        if (sel.kind === 'shape') {
          const { sx, top, h } = elScreen(sel);
          return (
            <FloatingShapeToolbar
              el={sel}
              screenX={sx}
              screenTop={top}
              screenHeight={h}
              zoom={zoom}
              duplicateElement={duplicateElement}
            />
          );
        }
        if (sel.kind === 'image') {
          const { sx, top, h } = elScreen(sel);
          return (
            <FloatingImageToolbar
              el={sel}
              screenX={sx}
              screenTop={top}
              screenHeight={h}
              zoom={zoom}
              duplicateElement={duplicateElement}
            />
          );
        }
        return null;
      })()}
      {showNativeWarning && (
        <NativeEditWarning onClose={() => setShowNativeWarning(false)} />
      )}
      {/* Smart alignment guides — visual only, never part of the document */}
      {guides.map((g, i) =>
        g.orientation === 'v' ? (
          <div
            key={i}
            aria-hidden
            className="pointer-events-none absolute inset-y-0"
            style={{
              left: toScreen(g.pos, zoom),
              width: 1,
              background: '#2f6bff',
              opacity: 0.7,
            }}
          />
        ) : (
          <div
            key={i}
            aria-hidden
            className="pointer-events-none absolute inset-x-0"
            style={{
              // PDF y (bottom-left) → CSS top
              top: toScreen(page.height - g.pos, zoom),
              height: 1,
              background: '#2f6bff',
              opacity: 0.7,
            }}
          />
        ),
      )}
    </div>
  );
}

/** Inline text editor: textarea overlay for the text tool (replaces window.prompt). */
/**
 * Drawing preview for drag-to-draw line/arrow.
 */
function DrawingPreview({
  drawing,
  page,
  zoom,
}: {
  drawing: { shape: 'line' | 'arrow' | 'rect' | 'ellipse' | 'highlight'; startX: number; startY: number; curX: number; curY: number; shiftKey: boolean };
  page: Page;
  zoom: number;
}) {
  const sx1 = toScreen(drawing.startX, zoom);
  const sy1 = pdfYToScreenTop(drawing.startY, page, zoom);
  let sx2 = toScreen(drawing.curX, zoom);
  let sy2 = pdfYToScreenTop(drawing.curY, page, zoom);

  const sw = Math.max(1, 2 * zoom);

  // Dimension badge text (in PDF points)
  let badgeText = '';
  // Badge position (screen coords, near cursor)
  let badgeX = sx2, badgeY = sy2;

  if (drawing.shape === 'line' || drawing.shape === 'arrow') {
    // Apply angle snapping for preview if Shift held
    let dx = drawing.curX - drawing.startX;
    let dy = drawing.curY - drawing.startY;
    if (drawing.shiftKey) {
      const s = snapAngle(dx, dy);
      dx = s.dx; dy = s.dy;
      sx2 = toScreen(drawing.startX + dx, zoom);
      sy2 = pdfYToScreenTop(drawing.startY + dy, page, zoom);
    }
    const len = Math.hypot(dx, dy);
    const angleDeg = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
    badgeText = `${len.toFixed(1)} pt · ${angleDeg}°`;
  } else {
    // Rect/ellipse: normalize drag rect for preview
    let x1 = drawing.startX, y1 = drawing.startY, x2 = drawing.curX, y2 = drawing.curY;
    if (drawing.shiftKey && drawing.shape === 'ellipse') {
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      const size = Math.max(w, h);
      x2 = x1 + Math.sign(x2 - x1 || 1) * size;
      y2 = y1 + Math.sign(y2 - y1 || 1) * size;
    }
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    if (drawing.shape === 'ellipse' && drawing.shiftKey) {
      badgeText = `⌀ ${w.toFixed(1)} pt`;
    } else {
      badgeText = `${w.toFixed(1)} × ${h.toFixed(1)} pt`;
    }
    // Update screen coords for circle constraint
    sx2 = toScreen(x2, zoom);
    sy2 = pdfYToScreenTop(y2, page, zoom);
  }

  const headLen = Math.max(12, sw * 4);
  const angle = Math.atan2(sy2 - sy1, sx2 - sx1);
  const a1 = angle + Math.PI - 0.44;
  const a2 = angle + Math.PI + 0.44;
  const hx1 = sx2 + headLen * Math.cos(a1);
  const hy1 = sy2 + headLen * Math.sin(a1);
  const hx2 = sx2 + headLen * Math.cos(a2);
  const hy2 = sy2 + headLen * Math.sin(a2);

  // Rect/ellipse preview bounds (screen)
  const rx = Math.min(sx1, sx2);
  const ry = Math.min(sy1, sy2);
  const rw = Math.abs(sx2 - sx1);
  const rh = Math.abs(sy2 - sy1);

  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0"
        width="100%"
        height="100%"
        style={{ overflow: 'visible', zIndex: 20 }}
      >
        {(drawing.shape === 'line' || drawing.shape === 'arrow') && (
          <>
            <line
              x1={sx1}
              y1={sy1}
              x2={sx2}
              y2={sy2}
              stroke="#2f6bff"
              strokeWidth={sw}
              strokeLinecap="round"
              strokeDasharray={`${6 * zoom} ${3 * zoom}`}
            />
            {drawing.shape === 'arrow' && (
              <polygon
                points={`${sx2},${sy2} ${hx1},${hy1} ${hx2},${hy2}`}
                fill="#2f6bff"
              />
            )}
            <circle cx={sx1} cy={sy1} r={4} fill="#2f6bff" stroke="#fff" strokeWidth={2} />
          </>
        )}
        {(drawing.shape === 'rect' || drawing.shape === 'ellipse' || drawing.shape === 'highlight') && (
          drawing.shape === 'highlight' ? (
            <rect
              x={rx}
              y={ry}
              width={rw}
              height={rh}
              fill="rgba(255,255,0,0.35)"
              stroke="#c9a900"
              strokeWidth={sw}
              strokeDasharray={`${6 * zoom} ${3 * zoom}`}
            />
          ) : drawing.shape === 'rect' ? (
            <rect
              x={rx}
              y={ry}
              width={rw}
              height={rh}
              fill="rgba(47,107,255,0.08)"
              stroke="#2f6bff"
              strokeWidth={sw}
              strokeDasharray={`${6 * zoom} ${3 * zoom}`}
            />
          ) : (
            <ellipse
              cx={rx + rw / 2}
              cy={ry + rh / 2}
              rx={rw / 2}
              ry={rh / 2}
              fill="rgba(47,107,255,0.08)"
              stroke="#2f6bff"
              strokeWidth={sw}
              strokeDasharray={`${6 * zoom} ${3 * zoom}`}
            />
          )
        )}
      </svg>
      {/* Live dimension badge near cursor */}
      {badgeText && (
        <div
          className="pointer-events-none absolute z-30 rounded-md bg-slate-900/90 px-2 py-1 text-[11px] font-medium tabular-nums text-white shadow-lg"
          style={{
            left: badgeX + 12,
            top: badgeY - 28,
            whiteSpace: 'nowrap',
          }}
        >
          {badgeText}
        </div>
      )}
    </>
  );
}

function InlineTextEditor({
  screenX,
  screenY,
  screenW,
  screenH,
  fontSize,
  zoom,
  initialText,
  onCommit,
  onCancel,
}: {
  screenX: number;
  screenY: number;
  /** When set, the editor covers this exact rect (native text — no duplicate visual) */
  screenW?: number;
  screenH?: number;
  fontSize?: number;
  zoom: number;
  initialText: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialText);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  // Native-text mode: cover the original fragment exactly with an opaque
  // background so the user edits "in place" — no duplicate text visible.
  const isNative = screenW !== undefined && screenH !== undefined;

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onCommit(value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      placeholder="Type text… (Enter to place, Esc to cancel)"
      aria-label="Text content"
      className={`absolute z-20 rounded border-2 border-brand-500 shadow-lg focus:outline-none ${
        isNative ? 'bg-white p-0' : 'min-h-[32px] min-w-[120px] bg-white/95 p-1'
      }`}
      style={{
        left: screenX,
        top: isNative ? screenY : screenY - 14 * zoom,
        width: isNative ? screenW : undefined,
        height: isNative ? screenH : undefined,
        fontSize: (fontSize ?? 14) * zoom,
        fontFamily: 'Helvetica, sans-serif',
        lineHeight: isNative ? `${screenH}px` : undefined,
        resize: 'none',
        overflow: 'hidden',
      }}
    />
  );
}

/** Minimal signature pad dialog (MVP). */
function openSignaturePad(onDone: (dataUrl: string, w: number, h: number) => void) {
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100;display:flex;align-items:center;justify-content:center;';
  const box = document.createElement('div');
  box.style.cssText = 'background:white;border-radius:12px;padding:16px;';
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 150;
  canvas.style.cssText = 'border:1px solid #cbd5e1;border-radius:8px;touch-action:none;cursor:crosshair;';
  const ctx = canvas.getContext('2d')!;
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#000';
  let drawing = false;
  const pos = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  canvas.onpointerdown = (e) => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  canvas.onpointermove = (e) => {
    if (!drawing) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  canvas.onpointerup = () => (drawing = false);
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;margin-top:12px;justify-content:flex-end;';
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.style.cssText = 'padding:6px 12px;border:1px solid #cbd5e1;border-radius:6px;';
  clearBtn.onclick = () => ctx.clearRect(0, 0, canvas.width, canvas.height);
  const okBtn = document.createElement('button');
  okBtn.textContent = 'Insert signature';
  okBtn.style.cssText = 'padding:6px 12px;background:#2f6bff;color:white;border-radius:6px;';
  okBtn.onclick = () => {
    onDone(canvas.toDataURL('image/png'), 200, 75);
    overlay.remove();
  };
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'padding:6px 12px;border:1px solid #cbd5e1;border-radius:6px;';
  cancelBtn.onclick = () => overlay.remove();
  row.append(clearBtn, cancelBtn, okBtn);
  box.append(canvas, row);
  overlay.appendChild(box);
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };
  document.body.appendChild(overlay);
}

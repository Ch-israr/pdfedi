'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import type { EditorElement, Page } from '@pdfeditor/shared';
import { useEditor, type ToolId } from '@/store/editor';
import { calcGuides, type Guide } from '@/lib/smart-guides';
import { FloatingTextToolbar } from './FloatingTextToolbar';
import { FloatingShapeToolbar } from './FloatingShapeToolbar';
import { FloatingImageToolbar } from './FloatingImageToolbar';
import { ResizeHandles } from './ResizeHandles';

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
  const updateElement = useEditor((s) => s.updateElement);
  const elements = useEditor((s) => s.elements);
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const snapThreshold = useEditor((s) => s.snapThreshold);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null,
  );
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

    updateElement(el.id, { x: newX, y: newY } as Partial<EditorElement>, 'Move element');
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
    onDoubleClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      // Double-click on text enters editing mode (distinct from single-click select)
      if (el.kind === 'text' && !isEditing) {
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
    case 'text':
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
      // Lines/arrows have zero height — only show corner handles to avoid
      // degenerate edge handles
      const isLine = el.shape === 'line' || el.shape === 'arrow';
      return (
        <div
          {...common}
          style={{
            ...style,
            width: toScreen(Math.abs(el.width), zoom),
            height: toScreen(Math.max(Math.abs(el.height), isLine ? 4 : 1), zoom),
            border: `${Math.max(1, toScreen(el.strokeWidth, zoom))}px solid ${el.stroke}`,
            background: el.fill ?? 'transparent',
            borderRadius: el.shape === 'ellipse' ? '50%' : 0,
          }}
        >
          {selected && <ResizeHandles el={el} zoom={zoom} cornersOnly={isLine} />}
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
  // Inline text editing: new text or editing existing text element
  const [editingText, setEditingText] = useState<
    | { mode: 'new'; x: number; y: number; screenX: number; screenY: number }
    | { mode: 'edit'; id: string; screenX: number; screenY: number; initialText: string }
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
        'Add text',
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
    [editingText, addElement, page.id],
  );

  // Start editing an existing text element (double-click)
  const startEditText = useCallback(
    (el: EditorElement, screenX: number, screenY: number) => {
      if (el.kind !== 'text') return;
      select(el.id);
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

  const onPageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-el-id]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const { x, y } = screenToPdf(e.clientX - rect.left, e.clientY - rect.top, page, zoom);
    const id = crypto.randomUUID();

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
        place(
          {
            id, pageId: page.id, kind: 'highlight', x, y: y - 10, rotation: 0,
            width: 120, height: 16, color: '#FFFF00', opacity: 0.4,
          },
          'Add highlight',
        );
        break;
      case 'shape-rect':
      case 'shape-ellipse':
        place(
          {
            id, pageId: page.id, kind: 'shape', x, y: y - 60, rotation: 0,
            shape: tool === 'shape-rect' ? 'rect' : 'ellipse',
            width: 120, height: 60, stroke: '#000000', strokeWidth: 2, fill: null,
          },
          'Add shape',
        );
        break;
      case 'shape-line':
      case 'shape-arrow':
        place(
          {
            id, pageId: page.id, kind: 'shape', x, y, rotation: 0,
            shape: tool === 'shape-arrow' ? 'arrow' : 'line',
            width: 120, height: 0, stroke: '#000000', strokeWidth: 2, fill: null,
          },
          'Add line',
        );
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
              'Add image',
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
            'Add signature',
          );
        });
        break;
      }
      default:
        select(null);
    }
  };

  return (
    <div className="element-overlay-root absolute inset-0" onClick={onPageClick}>
      {els.map((el) => (
        <ElementView
          key={el.id}
          el={el}
          page={page}
          onGuides={onGuides}
          onEditText={startEditText}
          isEditing={editingText?.mode === 'edit' && editingText.id === el.id}
        />
      ))}
      {/* Inline text editor — new text or editing existing */}
      {editingText && (
        <InlineTextEditor
          screenX={editingText.screenX}
          screenY={editingText.screenY}
          zoom={zoom}
          initialText={editingText.mode === 'edit' ? editingText.initialText : ''}
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

        if (sel.kind === 'text') {
          // Position above the element: use correct PDF→screen conversion
          // and account for actual text height so toolbar follows font size changes.
          const sx = toScreen(sel.x, zoom);
          const baselineY = pdfYToScreenTop(sel.y, page, zoom);
          // Estimate text height: fontSize * lineHeight * lines * zoom
          const lineCount = Math.max(1, sel.text.split('\n').length);
          const textH = sel.fontSize * 1.2 * lineCount * zoom;
          const textTop = baselineY - textH;
          const isEditing = editingText?.mode === 'edit' && editingText.id === selectedId;
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
function InlineTextEditor({
  screenX,
  screenY,
  zoom,
  initialText,
  onCommit,
  onCancel,
}: {
  screenX: number;
  screenY: number;
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
      className="absolute z-20 min-h-[32px] min-w-[120px] rounded border-2 border-brand-500 bg-white/95 p-1 shadow-lg focus:outline-none"
      style={{
        left: screenX,
        top: screenY - 14 * zoom,
        fontSize: 14 * zoom,
        fontFamily: 'Helvetica, sans-serif',
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

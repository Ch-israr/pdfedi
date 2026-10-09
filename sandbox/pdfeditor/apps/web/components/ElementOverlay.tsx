'use client';

import { useRef, useState, useCallback } from 'react';
import type { EditorElement, Page } from '@pdfeditor/shared';
import { useEditor, type ToolId } from '@/store/editor';
import { calcGuides, type Guide } from '@/lib/smart-guides';

/** Screen px per PDF point at current zoom */
function toScreen(v: number, zoom: number) {
  return v * zoom;
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
}: {
  el: EditorElement;
  page: Page;
  onGuides: (guides: Guide[]) => void;
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
  // el.y is bottom-left origin → CSS top
  const top = toScreen(el.y, zoom);

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    select(el.id);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: el.x,
      origY: el.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
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
  };

  const common = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
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
        />
      );
    case 'shape':
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
        />
      );
    case 'image':
    case 'signature':
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          {...common}
          src={el.src}
          alt=""
          draggable={false}
          style={{
            ...style,
            width: toScreen(el.width, zoom),
            height: toScreen(el.height, zoom),
          }}
        />
      );
  }
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
  // Smart guides are temporary — shown only during drag, never stored/exported
  const [guides, setGuides] = useState<Guide[]>([]);
  const onGuides = useCallback((g: Guide[]) => setGuides(g), []);

  const els = Object.values(elements).filter((e) => e.pageId === page.id);

  const onPageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-el-id]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const { x, y } = screenToPdf(e.clientX - rect.left, e.clientY - rect.top, page, zoom);
    const id = crypto.randomUUID();

    const place = (el: EditorElement, label: string) => addElement(el, label);

    switch (tool as ToolId) {
      case 'text': {
        const text = window.prompt('Enter text:', '');
        if (text === null) return;
        place(
          {
            id, pageId: page.id, kind: 'text', x, y: y - 12, rotation: 0,
            text: text || '', fontSize: 14, fontFamily: 'Helvetica',
            color: '#000000', bold: false, italic: false,
          },
          'Add text',
        );
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
    <div className="absolute inset-0" onClick={onPageClick}>
      {els.map((el) => (
        <ElementView key={el.id} el={el} page={page} onGuides={onGuides} />
      ))}
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

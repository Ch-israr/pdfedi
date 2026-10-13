'use client';

import { useRef, useCallback } from 'react';
import { useEditor } from '@/store/editor';
import type { EditorElement, Page } from '@pdfeditor/shared';
import { lineScreenGeometry, screenToPdf } from './ElementOverlay';

type ShapeElement = Extract<EditorElement, { kind: 'shape' }>;

/**
 * Endpoint handles for line/arrow elements.
 *
 * A line/arrow is modeled as a start point (x, y) plus a delta vector
 * (width, height) in PDF points, so dragging either endpoint redefines the
 * line's length, angle, and direction directly. Dragging the line's middle
 * moves the whole element (handled by the parent overlay div).
 *
 * Exactly two handles are shown: Start (or Tail for arrows) and End (or the
 * arrowhead). No bounding-box corner handles are used for lines/arrows.
 */
export function LineEndpoints({
  el,
  page,
  zoom,
}: {
  el: ShapeElement;
  page: Page;
  zoom: number;
}) {
  const updateElement = useEditor((s) => s.updateElement);
  const dragRef = useRef<{
    which: 'start' | 'end';
    mergeKey: string;
  } | null>(null);

  const { lx1, ly1, lx2, ly2 } = lineScreenGeometry(el, page, zoom);
  const isArrow = el.shape === 'arrow';

  /** Pointer position in PDF points, relative to the page overlay. */
  const pointerToPdf = useCallback(
    (e: React.PointerEvent) => {
      const overlay = (e.currentTarget as HTMLElement).closest('.element-overlay-root');
      const rect = overlay?.getBoundingClientRect();
      const ox = e.clientX - (rect?.left ?? 0);
      const oy = e.clientY - (rect?.top ?? 0);
      return screenToPdf(ox, oy, page, zoom);
    },
    [page, zoom],
  );

  const onHandleDown =
    (which: 'start' | 'end') => (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { which, mergeKey: crypto.randomUUID() };
    };

  const onHandleMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const p = pointerToPdf(e);
      const endX = el.x + el.width;
      const endY = el.y + el.height;
      // Shift constrains angle to 15° increments (relative to the fixed endpoint)
      const applySnap = (fromX: number, fromY: number, toX: number, toY: number) => {
        if (!e.shiftKey) return { x: toX, y: toY };
        const dx = toX - fromX;
        const dy = toY - fromY;
        const len = Math.hypot(dx, dy);
        if (len < 0.001) return { x: toX, y: toY };
        const angle = Math.atan2(dy, dx);
        const snap = Math.PI / 12; // 15°
        const snapped = Math.round(angle / snap) * snap;
        return {
          x: fromX + len * Math.cos(snapped),
          y: fromY + len * Math.sin(snapped),
        };
      };
      if (d.which === 'start') {
        // Move the start point; the end stays fixed. The delta vector
        // (width/height) updates so length and angle follow the pointer.
        // Guard against a zero-length line (it would become unselectable).
        const sp = applySnap(endX, endY, p.x, p.y);
        const w = endX - sp.x;
        const h = endY - sp.y;
        if (Math.hypot(w, h) < 1) return;
        updateElement(
          el.id,
          { x: sp.x, y: sp.y, width: w, height: h } as Partial<EditorElement>,
          isArrow ? 'Move arrow tail' : 'Move line start',
          { mergeKey: d.mergeKey },
        );
      } else {
        // Move the end point; the start stays fixed.
        const ep = applySnap(el.x, el.y, p.x, p.y);
        const w = ep.x - el.x;
        const h = ep.y - el.y;
        if (Math.hypot(w, h) < 1) return;
        updateElement(
          el.id,
          { width: w, height: h } as Partial<EditorElement>,
          isArrow ? 'Move arrowhead' : 'Move line end',
          { mergeKey: d.mergeKey },
        );
      }
    },
    [el, isArrow, pointerToPdf, updateElement],
  );

  const onHandleUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handles = [
    {
      which: 'start' as const,
      cx: lx1,
      cy: ly1,
      title: isArrow ? 'Arrow tail — drag to move' : 'Line start — drag to move',
    },
    {
      which: 'end' as const,
      cx: lx2,
      cy: ly2,
      title: isArrow ? 'Arrowhead — drag to move' : 'Line end — drag to move',
    },
  ];
  const size = 12;
  // Larger invisible hit area for easier grabbing (especially on touch)
  const hitSize = 22;

  return (
    <>
      {handles.map(({ which, cx, cy, title }) => (
        <div
          key={which}
          data-handle={`line-endpoint-${which}`}
          title={title}
          onPointerDown={onHandleDown(which)}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            left: cx - hitSize / 2,
            top: cy - hitSize / 2,
            width: hitSize,
            height: hitSize,
            cursor: 'move',
            zIndex: 10,
            touchAction: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: size,
              height: size,
              background: '#fff',
              border: '2px solid #2f6bff',
              borderRadius: '50%',
              boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
              pointerEvents: 'none',
            }}
          />
        </div>
      ))}
    </>
  );
}

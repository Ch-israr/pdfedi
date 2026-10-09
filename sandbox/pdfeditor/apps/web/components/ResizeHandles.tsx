'use client';

import { useRef, useCallback } from 'react';
import { useEditor } from '@/store/editor';
import type { EditorElement } from '@pdfeditor/shared';

type HandlePosition = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLES: { pos: HandlePosition; cursor: string; x: number; y: number }[] = [
  { pos: 'nw', cursor: 'nwse-resize', x: 0, y: 0 },
  { pos: 'n', cursor: 'ns-resize', x: 50, y: 0 },
  { pos: 'ne', cursor: 'nesw-resize', x: 100, y: 0 },
  { pos: 'e', cursor: 'ew-resize', x: 100, y: 50 },
  { pos: 'se', cursor: 'nwse-resize', x: 100, y: 100 },
  { pos: 's', cursor: 'ns-resize', x: 50, y: 100 },
  { pos: 'sw', cursor: 'nesw-resize', x: 0, y: 100 },
  { pos: 'w', cursor: 'ew-resize', x: 0, y: 50 },
];

/**
 * Resize handles for selectable elements.
 * Renders 8 handles around the element's bounding box.
 * Dragging a handle resizes the element in PDF points.
 *
 * @param lockAspect - keep width/height proportional (images, signatures)
 * @param cornersOnly - only show corner handles (for aspect-locked elements)
 */
export function ResizeHandles({
  el,
  zoom,
  lockAspect = false,
  cornersOnly = false,
}: {
  el: Extract<EditorElement, { kind: 'shape' | 'image' | 'signature' | 'highlight' }>;
  zoom: number;
  lockAspect?: boolean;
  cornersOnly?: boolean;
}) {
  const updateElement = useEditor((s) => s.updateElement);
  const resizeRef = useRef<{
    handle: HandlePosition;
    startX: number;
    startY: number;
    origW: number;
    origH: number;
    origX: number;
    origY: number;
  } | null>(null);

  const onHandleDown = useCallback(
    (handle: HandlePosition) => (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      resizeRef.current = {
        handle,
        startX: e.clientX,
        startY: e.clientY,
        origW: Math.abs(el.width),
        origH: Math.abs(el.height),
        origX: el.x,
        origY: el.y,
      };
    },
    [el.width, el.height, el.x, el.y],
  );

  const onHandleMove = useCallback(
    (e: React.PointerEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      // Convert screen delta to PDF points. Note: element uses bottom-left
      // origin, so screen Y is inverted.
      const dx = (e.clientX - r.startX) / zoom;
      const dy = -(e.clientY - r.startY) / zoom;

      let { origW, origH, origX, origY } = r;
      const handle = r.handle;

      // Determine which edges are being dragged
      const left = handle.includes('w');
      const right = handle.includes('e');
      const top = handle.includes('n');
      const bottom = handle.includes('s');

      let newW = origW;
      let newH = origH;
      let newX = origX;
      let newY = origY;

      if (lockAspect) {
        // Aspect-locked: use the dominant axis, scale proportionally.
        // Anchor at the opposite corner.
        const aspect = origW / origH;
        // For corner handles, use max of dx/dy magnitude
        const dw = right ? dx : left ? -dx : 0;
        const dh = top ? dy : bottom ? -dy : 0;
        // Use the larger change to determine scale
        const scaleDw = dw !== 0 ? (origW + dw) / origW : 1;
        const scaleDh = dh !== 0 ? (origH + dh) / origH : 1;
        const scale = Math.max(scaleDw, scaleDh);
        const clampedScale = Math.max(0.1, scale); // min 10% of original
        newW = Math.max(10, origW * clampedScale);
        newH = Math.max(10, origH * clampedScale);
        // Adjust position to keep the opposite corner anchored
        if (left) newX = origX + (origW - newW);
        if (bottom) newY = origY + (origH - newH);
        // top/right don't move x/y (anchor is bottom-left for top/right handles)
        // For 'n' handle (top edge only): anchor bottom, so y moves
        if (handle === 'n') newY = origY + (origH - newH);
        if (handle === 's') newY = origY; // anchor top... actually s = bottom edge
      } else {
        if (right) newW = Math.max(10, origW + dx);
        if (left) {
          newW = Math.max(10, origW - dx);
          newX = origX + (origW - newW);
        }
        if (top) {
          newH = Math.max(10, origH + dy);
          // top edge in screen = higher PDF y; anchor bottom
          // newY stays, height grows upward — but our y is bottom-left,
          // so growing top means y stays same, height increases
        }
        if (bottom) {
          newH = Math.max(10, origH - dy);
          newY = origY + (origH - newH);
        }
        // Handle pure edge cases:
        if (handle === 'n') {
          newH = Math.max(10, origH + dy);
        }
        if (handle === 's') {
          newH = Math.max(10, origH - dy);
          newY = origY + (origH - newH);
        }
        if (handle === 'e') newW = Math.max(10, origW + dx);
        if (handle === 'w') {
          newW = Math.max(10, origW - dx);
          newX = origX + (origW - newW);
        }
      }

      // For shapes, preserve sign of width/height (can be negative for lines)
      const finalW = el.kind === 'shape' && el.width < 0 ? -newW : newW;
      const finalH = el.kind === 'shape' && el.height < 0 ? -newH : newH;

      updateElement(
        el.id,
        { width: finalW, height: finalH, x: newX, y: newY } as Partial<EditorElement>,
        'Resize element',
      );
    },
    [el.id, el.kind, el.width, lockAspect, updateElement, zoom],
  );

  const onHandleUp = useCallback(() => {
    resizeRef.current = null;
  }, []);

  const handles = cornersOnly ? HANDLES.filter((h) => h.pos.length === 2) : HANDLES;
  const size = 12;
  // Larger invisible hit area for easier grabbing (especially on touch)
  const hitSize = 20;

  return (
    <>
      {handles.map(({ pos, cursor, x, y }) => (
        <div
          key={pos}
          data-resize-handle={pos}
          onPointerDown={onHandleDown(pos)}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            left: `calc(${x}% - ${hitSize / 2}px)`,
            top: `calc(${y}% - ${hitSize / 2}px)`,
            width: hitSize,
            height: hitSize,
            cursor,
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
              borderRadius: pos.length === 2 ? '50%' : '2px',
              pointerEvents: 'none',
            }}
          />
        </div>
      ))}
    </>
  );
}

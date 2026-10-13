'use client';

import { useEditor } from '@/store/editor';
import type { EditorElement } from '@pdfeditor/shared';
import {
  useFloatingToolbarPosition,
  useToolbarEvents,
  toolbarBtn,
  toolbarDivider,
} from './FloatingToolbarShared';

const STROKE_WIDTHS = [1, 2, 3, 4, 6, 8];

type ShapeElement = Extract<EditorElement, { kind: 'shape' }>;

/**
 * Floating toolbar for selected shapes.
 * Controls: fill color, stroke color, stroke width, duplicate, delete.
 */
export function FloatingShapeToolbar({
  el,
  screenX,
  screenTop,
  screenHeight,
  zoom,
  duplicateElement,
}: {
  el: ShapeElement;
  screenX: number;
  screenTop: number;
  screenHeight: number;
  zoom: number;
  duplicateElement: (id: string) => void;
}) {
  const updateElement = useEditor((s) => s.updateElement);
  const deleteElement = useEditor((s) => s.deleteElement);
  const { stop, keepFocus } = useToolbarEvents();
  const { top, left } = useFloatingToolbarPosition({
    elementScreenX: screenX,
    elementScreenTop: screenTop,
    elementScreenHeight: screenHeight,
    zoom,
  });

  return (
    <div
      role="toolbar"
      aria-label="Shape formatting"
      className="absolute z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-slate-200 bg-white px-1.5 py-1 shadow-xl"
      style={{ left, top, maxWidth: 'calc(100vw - 2rem)' }}
      onPointerDown={keepFocus}
      onPointerMove={stop}
      onPointerUp={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      {/* Fill color */}
      <label title="Fill color" className={`${toolbarBtn} relative cursor-pointer`} onClick={stop}>
        <span
          aria-hidden
          className="h-5 w-5 rounded border border-slate-300"
          style={{ background: el.fill ?? 'transparent' }}
        />
        <span className="sr-only">Fill color</span>
        <input
          type="color"
          value={el.fill ?? '#ffffff'}
          aria-label="Fill color"
          onChange={(e) => updateElement(el.id, { fill: e.target.value }, 'Change fill color')}
          className="absolute inset-0 cursor-pointer opacity-0"
          onClick={stop}
        />
      </label>
      {/* No fill */}
      <button
        type="button"
        title="No fill"
        aria-label="No fill"
        className={`${toolbarBtn} ${el.fill === null ? 'bg-brand-50 text-brand-600' : ''}`}
        onClick={() => updateElement(el.id, { fill: null }, 'Remove fill')}
      >
        <span aria-hidden className="text-xs">∅</span>
      </button>
      {toolbarDivider}
      {/* Stroke color */}
      <label title="Outline color" className={`${toolbarBtn} relative cursor-pointer`} onClick={stop}>
        <span
          aria-hidden
          className="h-5 w-5 rounded-full border-2"
          style={{ borderColor: el.stroke }}
        />
        <span className="sr-only">Outline color</span>
        <input
          type="color"
          value={el.stroke}
          aria-label="Outline color"
          onChange={(e) => updateElement(el.id, { stroke: e.target.value }, 'Change outline color')}
          className="absolute inset-0 cursor-pointer opacity-0"
          onClick={stop}
        />
      </label>
      {toolbarDivider}
      {/* Stroke width */}
      <div className="flex items-center gap-1" role="group" aria-label="Border thickness">
        {STROKE_WIDTHS.map((w) => (
          <button
            key={w}
            type="button"
            title={`Border ${w}px`}
            aria-label={`Border thickness ${w} pixels`}
            aria-pressed={el.strokeWidth === w}
            onClick={() => updateElement(el.id, { strokeWidth: w }, 'Change border thickness')}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-slate-100 ${
              el.strokeWidth === w ? 'bg-brand-50 ring-1 ring-brand-500' : ''
            }`}
          >
            <span
              aria-hidden
              className="rounded-full bg-slate-700"
              style={{ width: Math.min(16, 4 + w * 1.5), height: Math.min(16, 4 + w * 1.5) }}
            />
          </button>
        ))}
      </div>
      {toolbarDivider}
      {/* Duplicate */}
      <button
        type="button"
        title="Duplicate shape"
        aria-label="Duplicate shape"
        className={toolbarBtn}
        onClick={() => duplicateElement(el.id)}
      >
        ⧉
      </button>
      {/* Delete */}
      <button
        type="button"
        title="Delete shape"
        aria-label="Delete shape"
        className={`${toolbarBtn} text-red-600 hover:bg-red-50`}
        onClick={() => deleteElement(el.id)}
      >
        🗑
      </button>
    </div>
  );
}

'use client';

import { useEditor } from '@/store/editor';
import type { EditorElement } from '@pdfeditor/shared';
import {
  useFloatingToolbarPosition,
  useToolbarEvents,
  toolbarBtn,
  toolbarDivider,
} from './FloatingToolbarShared';

type ImageElement = Extract<EditorElement, { kind: 'image' }>;

/**
 * Floating toolbar for selected images.
 * Controls: rotate left/right, duplicate, delete.
 * Resize is handled via on-object handles (aspect locked).
 */
export function FloatingImageToolbar({
  el,
  screenX,
  screenTop,
  screenHeight,
  zoom,
  duplicateElement,
}: {
  el: ImageElement;
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

  const rotate = (delta: number) => {
    const next = ((el.rotation + delta) % 360 + 360) % 360;
    updateElement(el.id, { rotation: next }, 'Rotate image');
  };

  return (
    <div
      role="toolbar"
      aria-label="Image controls"
      className="absolute z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-slate-200 bg-white px-1.5 py-1 shadow-xl"
      style={{ left, top, maxWidth: 'calc(100vw - 2rem)' }}
      onPointerDown={keepFocus}
      onPointerMove={stop}
      onPointerUp={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      {/* Rotate left */}
      <button
        type="button"
        title="Rotate left 90°"
        aria-label="Rotate image left 90 degrees"
        className={toolbarBtn}
        onClick={() => rotate(-90)}
      >
        <span aria-hidden className="text-base">↺</span>
      </button>
      {/* Rotate right */}
      <button
        type="button"
        title="Rotate right 90°"
        aria-label="Rotate image right 90 degrees"
        className={toolbarBtn}
        onClick={() => rotate(90)}
      >
        <span aria-hidden className="text-base">↻</span>
      </button>
      <span className="min-w-[3rem] text-center text-xs tabular-nums text-slate-500">
        {el.rotation}°
      </span>
      {toolbarDivider}
      {/* Duplicate */}
      <button
        type="button"
        title="Duplicate image"
        aria-label="Duplicate image"
        className={toolbarBtn}
        onClick={() => duplicateElement(el.id)}
      >
        ⧉
      </button>
      {/* Delete */}
      <button
        type="button"
        title="Delete image"
        aria-label="Delete image"
        className={`${toolbarBtn} text-red-600 hover:bg-red-50`}
        onClick={() => deleteElement(el.id)}
      >
        🗑
      </button>
    </div>
  );
}

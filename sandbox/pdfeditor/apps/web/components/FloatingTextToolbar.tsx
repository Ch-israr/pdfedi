'use client';

import type { EditorElement } from '@pdfeditor/shared';
import { useEditor } from '@/store/editor';

/**
 * Floating toolbar for selected text elements.
 * Appears above the selected text; actions affect only that element.
 * All pointer events are stopped so toolbar clicks never create/move/deselect.
 */
export function FloatingTextToolbar({
  el,
  screenX,
  screenY,
  zoom,
}: {
  el: Extract<EditorElement, { kind: 'text' }>;
  screenX: number;
  screenY: number;
  zoom: number;
}) {
  const updateElement = useEditor((s) => s.updateElement);
  const deleteElement = useEditor((s) => s.deleteElement);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const btn =
    'flex h-8 w-8 items-center justify-center rounded-md text-sm transition-colors hover:bg-slate-100';

  // Zoom-aware gap: scales with zoom so spacing stays consistent.
  // screenY is the element's baseline (bottom edge on screen).
  // Place toolbar above with clearance; if near top edge, place below instead.
  const gap = 12 * zoom;
  const toolbarH = 48;
  const placeAbove = screenY - gap - toolbarH > 4;

  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
      className="absolute z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-slate-200 bg-white px-1.5 py-1 shadow-xl"
      style={{
        left: screenX,
        top: placeAbove ? screenY - gap - toolbarH : screenY + gap,
      }}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      <button
        type="button"
        title="Bold"
        aria-label="Bold"
        aria-pressed={el.bold}
        className={`${btn} font-bold ${el.bold ? 'bg-brand-50 text-brand-600' : 'text-slate-700'}`}
        onClick={() => updateElement(el.id, { bold: !el.bold }, 'Toggle bold')}
      >
        B
      </button>
      <button
        type="button"
        title="Italic"
        aria-label="Italic"
        aria-pressed={el.italic}
        className={`${btn} italic ${el.italic ? 'bg-brand-50 text-brand-600' : 'text-slate-700'}`}
        onClick={() => updateElement(el.id, { italic: !el.italic }, 'Toggle italic')}
      >
        I
      </button>
      <div className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden />
      <button
        type="button"
        title="Decrease font size"
        aria-label="Decrease font size"
        className={`${btn} text-slate-700`}
        onClick={() =>
          updateElement(el.id, { fontSize: Math.max(6, el.fontSize - 2) }, 'Decrease font size')
        }
      >
        A−
      </button>
      <span className="min-w-[2.5rem] text-center text-xs tabular-nums text-slate-600" aria-live="polite">
        {el.fontSize}
      </span>
      <button
        type="button"
        title="Increase font size"
        aria-label="Increase font size"
        className={`${btn} text-slate-700`}
        onClick={() =>
          updateElement(el.id, { fontSize: Math.min(144, el.fontSize + 2) }, 'Increase font size')
        }
      >
        A+
      </button>
      <div className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden />
      <label
        title="Text color"
        className={`${btn} relative cursor-pointer text-slate-700`}
        onClick={stop}
      >
        <span
          aria-hidden
          className="flex h-5 w-5 items-center justify-center rounded border border-slate-300 text-xs font-bold"
          style={{ color: el.color }}
        >
          A
        </span>
        <span className="sr-only">Text color</span>
        <input
          type="color"
          value={el.color}
          aria-label="Text color"
          onChange={(e) => updateElement(el.id, { color: e.target.value }, 'Change text color')}
          className="absolute inset-0 cursor-pointer opacity-0"
          onClick={stop}
        />
      </label>
      <div className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden />
      <button
        type="button"
        title="Delete text"
        aria-label="Delete text element"
        className={`${btn} text-red-600 hover:bg-red-50`}
        onClick={() => deleteElement(el.id)}
      >
        🗑
      </button>
    </div>
  );
}

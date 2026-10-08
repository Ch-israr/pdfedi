'use client';

import { useEditor } from '@/store/editor';
import type { EditorElement } from '@pdfeditor/shared';

/**
 * Right sidebar: properties of the selected element.
 */
export function PropertiesPanel() {
  const selectedId = useEditor((s) => s.selectedId);
  const elements = useEditor((s) => s.elements);
  const updateElement = useEditor((s) => s.updateElement);
  const deleteElement = useEditor((s) => s.deleteElement);

  const el: EditorElement | undefined = selectedId ? elements[selectedId] : undefined;

  if (!el) {
    return (
      <aside className="w-64 shrink-0 border-l border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Properties</h2>
        <p className="mt-2 text-xs text-slate-500">
          Select an element on the page to edit its properties.
        </p>
        <div className="mt-6 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
          <p className="font-medium text-slate-700">🔒 Privacy</p>
          <p className="mt-1">
            Your PDF lives only in this tab&apos;s memory. It is never uploaded or stored —
            except transiently if you use a heavy server operation.
          </p>
        </div>
      </aside>
    );
  }

  const num = (label: string, value: number, onChange: (v: number) => void, step = 1) => (
    <label className="block text-xs">
      <span className="text-slate-500">{label}</span>
      <input
        type="number"
        step={step}
        value={Math.round(value * 100) / 100}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1"
      />
    </label>
  );

  return (
    <aside className="thin-scroll w-64 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700 capitalize">{el.kind}</h2>
        <button
          onClick={() => deleteElement(el.id)}
          className="rounded bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100"
        >
          Delete
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {num('X (pt)', el.x, (v) => updateElement(el.id, { x: v } as Partial<EditorElement>))}
        {num('Y (pt)', el.y, (v) => updateElement(el.id, { y: v } as Partial<EditorElement>))}
        {num('Rotation°', el.rotation, (v) => updateElement(el.id, { rotation: v } as Partial<EditorElement>))}
      </div>

      {el.kind === 'text' && (
        <div className="mt-3 space-y-2">
          <label className="block text-xs">
            <span className="text-slate-500">Text</span>
            <textarea
              value={el.text}
              rows={3}
              onChange={(e) => updateElement(el.id, { text: e.target.value })}
              className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            {num('Font size', el.fontSize, (v) => updateElement(el.id, { fontSize: v }))}
            <label className="block text-xs">
              <span className="text-slate-500">Color</span>
              <input
                type="color"
                value={el.color}
                onChange={(e) => updateElement(el.id, { color: e.target.value })}
                className="mt-0.5 h-8 w-full rounded border border-slate-300"
              />
            </label>
          </div>
          <div className="flex gap-2 text-xs">
            <button
              onClick={() => updateElement(el.id, { bold: !el.bold })}
              className={`rounded border px-2 py-1 ${el.bold ? 'bg-brand-500 text-white' : ''}`}
            >
              <b>B</b>
            </button>
            <button
              onClick={() => updateElement(el.id, { italic: !el.italic })}
              className={`rounded border px-2 py-1 ${el.italic ? 'bg-brand-500 text-white' : ''}`}
            >
              <i>I</i>
            </button>
          </div>
        </div>
      )}

      {(el.kind === 'image' || el.kind === 'signature') && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {num('Width', el.width, (v) => updateElement(el.id, { width: v } as Partial<EditorElement>))}
          {num('Height', el.height, (v) => updateElement(el.id, { height: v } as Partial<EditorElement>))}
        </div>
      )}

      {el.kind === 'highlight' && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {num('Width', el.width, (v) => updateElement(el.id, { width: v }))}
            {num('Height', el.height, (v) => updateElement(el.id, { height: v }))}
          </div>
          <label className="block text-xs">
            <span className="text-slate-500">Color</span>
            <input
              type="color"
              value={el.color}
              onChange={(e) => updateElement(el.id, { color: e.target.value })}
              className="mt-0.5 h-8 w-full rounded border border-slate-300"
            />
          </label>
        </div>
      )}

      {el.kind === 'shape' && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {num('Width', el.width, (v) => updateElement(el.id, { width: v }))}
            {num('Height', el.height, (v) => updateElement(el.id, { height: v }))}
            {num('Stroke', el.strokeWidth, (v) => updateElement(el.id, { strokeWidth: v }))}
          </div>
          <label className="block text-xs">
            <span className="text-slate-500">Stroke color</span>
            <input
              type="color"
              value={el.stroke}
              onChange={(e) => updateElement(el.id, { stroke: e.target.value })}
              className="mt-0.5 h-8 w-full rounded border border-slate-300"
            />
          </label>
        </div>
      )}
    </aside>
  );
}

'use client';

import { useEditor } from '@/store/editor';
import type { EditorElement } from '@pdfeditor/shared';

/**
 * Right sidebar: properties of the selected element.
 * Context-aware: shows only controls relevant to the selected kind.
 * Hidden on small screens (element editing via overlay there).
 */
export function PropertiesPanel() {
  const selectedId = useEditor((s) => s.selectedId);
  const elements = useEditor((s) => s.elements);
  const updateElement = useEditor((s) => s.updateElement);
  const deleteElement = useEditor((s) => s.deleteElement);

  const el: EditorElement | undefined = selectedId ? elements[selectedId] : undefined;

  const panelClass =
    'thin-scroll hidden w-64 shrink-0 overflow-y-auto border-l border-slate-200 bg-white lg:block';

  if (!el) {
    return (
      <aside aria-label="Properties" className={`${panelClass} p-4`}>
        <h2 className="text-sm font-semibold text-slate-800">Properties</h2>
        <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center">
          <div className="text-2xl" aria-hidden>👆</div>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Select an element on the page to edit its properties here.
          </p>
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
          <p className="flex items-center gap-1.5 font-medium text-slate-700">
            <span aria-hidden>🔒</span> Privacy
          </p>
          <p className="mt-1.5 leading-relaxed">
            Your PDF lives only in this tab&apos;s memory. It is never uploaded or stored —
            except transiently if you use a heavy server operation.
          </p>
        </div>
      </aside>
    );
  }

  const num = (
    label: string,
    value: number,
    onChange: (v: number) => void,
    step = 1,
  ) => (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <input
        type="number"
        step={step}
        value={Math.round(value * 100) / 100}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm tabular-nums transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
    </label>
  );

  const colorField = (
    label: string,
    value: string,
    onChange: (v: string) => void,
  ) => (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded-lg border border-slate-300 bg-white p-0.5"
        />
        <span className="text-xs uppercase tabular-nums text-slate-400">{value}</span>
      </div>
    </label>
  );

  const sectionTitle = (title: string) => (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
  );

  return (
    <aside aria-label="Element properties" className={`${panelClass} p-4`}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold capitalize text-slate-800">
          {el.kind === 'shape' ? `${el.shape} shape` : el.kind}
        </h2>
        <button
          type="button"
          onClick={() => deleteElement(el.id)}
          className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-100"
        >
          Delete
        </button>
      </div>

      <div className="mt-4 space-y-4">
        <section className="space-y-2">
          {sectionTitle('Position')}
          {num('Rotation (°)', el.rotation, (v) =>
            updateElement(el.id, { rotation: v } as Partial<EditorElement>),
          )}
        </section>

        {el.kind === 'text' && (
          <section className="space-y-2 border-t border-slate-100 pt-4">
            {sectionTitle('Text')}
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Content</span>
              <textarea
                value={el.text}
                rows={3}
                onChange={(e) => updateElement(el.id, { text: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              {num('Font size', el.fontSize, (v) => updateElement(el.id, { fontSize: v }))}
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">Family</span>
                <select
                  value={el.fontFamily}
                  onChange={(e) => updateElement(el.id, { fontFamily: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option>Helvetica</option>
                  <option>Times-Roman</option>
                  <option>Courier</option>
                </select>
              </label>
            </div>
            {colorField('Color', el.color, (v) => updateElement(el.id, { color: v }))}
            <div className="flex gap-2" role="group" aria-label="Text style">
              <button
                type="button"
                title="Bold"
                aria-pressed={el.bold}
                onClick={() => updateElement(el.id, { bold: !el.bold })}
                className={`flex h-9 flex-1 items-center justify-center rounded-lg border text-sm transition-colors ${
                  el.bold
                    ? 'border-brand-500 bg-brand-50 text-brand-600'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <b>B</b>
              </button>
              <button
                type="button"
                title="Italic"
                aria-pressed={el.italic}
                onClick={() => updateElement(el.id, { italic: !el.italic })}
                className={`flex h-9 flex-1 items-center justify-center rounded-lg border text-sm transition-colors ${
                  el.italic
                    ? 'border-brand-500 bg-brand-50 text-brand-600'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <i>I</i>
              </button>
            </div>
          </section>
        )}

        {(el.kind === 'image' || el.kind === 'signature') && (
          <section className="space-y-2 border-t border-slate-100 pt-4">
            {sectionTitle('Size')}
            <div className="grid grid-cols-2 gap-2">
              {num('Width', el.width, (v) => updateElement(el.id, { width: v } as Partial<EditorElement>))}
              {num('Height', el.height, (v) => updateElement(el.id, { height: v } as Partial<EditorElement>))}
            </div>
          </section>
        )}

        {el.kind === 'highlight' && (
          <section className="space-y-2 border-t border-slate-100 pt-4">
            {sectionTitle('Highlight')}
            <div className="grid grid-cols-2 gap-2">
              {num('Width', el.width, (v) => updateElement(el.id, { width: v }))}
              {num('Height', el.height, (v) => updateElement(el.id, { height: v }))}
            </div>
            {colorField('Color', el.color, (v) => updateElement(el.id, { color: v }))}
          </section>
        )}

        {el.kind === 'shape' && (
          <section className="space-y-2 border-t border-slate-100 pt-4">
            {sectionTitle('Shape')}
            <div className="grid grid-cols-2 gap-2">
              {num('Width', el.width, (v) => updateElement(el.id, { width: v }))}
              {num('Height', el.height, (v) => updateElement(el.id, { height: v }))}
            </div>
            {num('Stroke width', el.strokeWidth, (v) => updateElement(el.id, { strokeWidth: v }), 0.5)}
            {colorField('Stroke color', el.stroke, (v) => updateElement(el.id, { stroke: v }))}
          </section>
        )}
      </div>
    </aside>
  );
}

'use client';

import { useState } from 'react';
import { useEditor } from '@/store/editor';
import type { EditorElement } from '@pdfeditor/shared';
import { normalizeUrl } from '@/lib/url';
import { isFieldNameUnique } from '@/lib/form-fields';

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
        {el.kind === 'link' && (
          <section className="space-y-2 border-t border-slate-100 pt-4">
            {sectionTitle('Link')}
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Address</span>
              <input
                type="url"
                defaultValue={el.url}
                key={el.id}
                onBlur={(e) => {
                  const url = normalizeUrl(e.target.value);
                  if (url && url !== el.url) updateElement(el.id, { url }, 'Edit link address');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                placeholder="https://example.com"
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
              />
            </label>
            <p className="text-xs leading-relaxed text-slate-500">
              Clicking this region opens the address. The region is invisible
              in the exported PDF.
            </p>
          </section>
        )}
        {el.kind === 'redact' && (
          <section className="space-y-2 border-t border-slate-100 pt-4">
            {sectionTitle('Redaction')}
            <div className="grid grid-cols-2 gap-2">
              {num('Width', el.width, (v) => updateElement(el.id, { width: v }))}
              {num('Height', el.height, (v) => updateElement(el.id, { height: v }))}
            </div>
            <p className="text-xs leading-relaxed text-slate-500">
              Text under this region is <strong>permanently removed</strong> from
              the downloaded file — not just covered. Whole text runs touched
              by the rectangle are removed. Undo is available until download.
            </p>
          </section>
        )}
        {el.kind === 'whiteout' && (
          <section className="space-y-2 border-t border-slate-100 pt-4">
            {sectionTitle('Whiteout')}
            <div className="grid grid-cols-2 gap-2">
              {num('Width', el.width, (v) => updateElement(el.id, { width: v }))}
              {num('Height', el.height, (v) => updateElement(el.id, { height: v }))}
            </div>
            <p className="text-xs leading-relaxed text-slate-500">
              Solid white cover with no outline. Visual covering only — the
              content underneath is not removed from the file.
            </p>
          </section>
        )}
        {el.kind === 'form-field' && <FormFieldSection />}
      </div>
    </aside>
  );
}

function FormFieldSection() {
  const selectedId = useEditor((s) => s.selectedId);
  const elements = useEditor((s) => s.elements);
  const updateElement = useEditor((s) => s.updateElement);
  const [nameError, setNameError] = useState<string | null>(null);
  const el = selectedId ? elements[selectedId] : undefined;
  if (!el || el.kind !== 'form-field') return null;
  const bound = !!el.boundField;

  const commitName = (raw: string) => {
    const name = raw.trim();
    if (!name) {
      setNameError('Name cannot be empty.');
      return;
    }
    if (name !== el.name && !isFieldNameUnique(elements, name, el.id)) {
      setNameError(`Name "${name}" is already used by another field.`);
      return;
    }
    setNameError(null);
    if (name !== el.name) updateElement(el.id, { name }, 'Rename field');
  };

  const toggle = (
    label: string,
    value: boolean,
    onChange: (v: boolean) => void,
  ) => (
    <label className="flex cursor-pointer items-center justify-between gap-2">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          value ? 'bg-brand-500' : 'bg-slate-300'
        }`}
      >
        <span
          aria-hidden
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            value ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    </label>
  );

  return (
    <section className="space-y-2 border-t border-slate-100 pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Form field
      </h3>
      <p className="text-xs text-slate-500">
        Type: <span className="font-medium capitalize text-slate-700">{el.fieldType}</span>
        {bound && (
          <span className="ml-1 text-slate-400">(bound to the PDF&apos;s own field)</span>
        )}
      </p>
      {bound ? (
        <p className="text-xs text-slate-500">
          Name: <span className="font-mono font-medium text-slate-700">{el.name}</span>
        </p>
      ) : (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Name</span>
          <input
            type="text"
            key={`${el.id}:${el.name}`}
            defaultValue={el.name}
            maxLength={128}
            onBlur={(e) => commitName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            className={`w-full rounded-lg border px-2.5 py-1.5 font-mono text-sm transition-colors focus:outline-none focus:ring-1 ${
              nameError
                ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
                : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500'
            }`}
          />
          {nameError && <span className="mt-1 block text-xs text-red-600">{nameError}</span>}
        </label>
      )}
      {el.fieldType === 'checkbox' ? (
        <div className="rounded-lg border border-slate-200 p-2">
          {toggle('Checked', el.checked, (v) =>
            updateElement(el.id, { checked: v }, v ? 'Check field' : 'Uncheck field'),
          )}
        </div>
      ) : el.fieldType === 'dropdown' ? (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Value</span>
          <select
            value={el.value}
            onChange={(e) => updateElement(el.id, { value: e.target.value }, 'Edit field value')}
            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">—</option>
            {(el.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      ) : el.fieldType === 'radio' ? (
        <p className="text-xs text-slate-500">
          Represents option <span className="font-medium text-slate-700">{el.radioOption || '—'}</span> of
          the radio group <span className="font-mono">{el.boundField ?? el.name}</span>. Click the
          control on the page to select it.
        </p>
      ) : (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Value</span>
          {el.fieldType === 'multiline' ? (
            <textarea
              value={el.value}
              rows={3}
              maxLength={el.maxLength ?? undefined}
              onChange={(e) => updateElement(el.id, { value: e.target.value }, 'Edit field value')}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          ) : (
            <input
              type="text"
              value={el.value}
              maxLength={el.maxLength ?? undefined}
              onChange={(e) => updateElement(el.id, { value: e.target.value }, 'Edit field value')}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          )}
        </label>
      )}
      {!bound && (
        <>
          <div className="rounded-lg border border-slate-200 p-2">
            {toggle('Required', el.required, (v) =>
              updateElement(el.id, { required: v }, 'Toggle field required'),
            )}
          </div>
          {(el.fieldType === 'text' || el.fieldType === 'multiline') && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">Max length</span>
                <input
                  type="number"
                  min={1}
                  placeholder="—"
                  value={el.maxLength ?? ''}
                  onChange={(e) => {
                    const v = e.target.value === '' ? null : Math.max(1, Math.floor(Number(e.target.value)));
                    updateElement(el.id, { maxLength: Number.isNaN(v as number) ? null : v }, 'Edit max length');
                  }}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm tabular-nums transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">Font size</span>
                <input
                  type="number"
                  min={4}
                  max={200}
                  value={Math.round(el.fontSize * 100) / 100}
                  onChange={(e) => updateElement(el.id, { fontSize: Math.max(1, Number(e.target.value)) }, 'Edit field font size')}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm tabular-nums transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>
            </div>
          )}
        </>
      )}
      {bound && (el.fieldType === 'text' || el.fieldType === 'multiline') && (
        <p className="text-xs leading-relaxed text-slate-500">
          {el.required ? 'Required. ' : ''}
          {el.maxLength ? `Max length ${el.maxLength}. ` : ''}Font size {Math.round(el.fontSize * 100) / 100}.
          These come from the PDF&apos;s own field and are read-only here.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Width</span>
          <input
            type="number"
            min={1}
            value={Math.round(el.width * 100) / 100}
            onChange={(e) => updateElement(el.id, { width: Math.max(1, Number(e.target.value)) })}
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm tabular-nums transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Height</span>
          <input
            type="number"
            min={1}
            value={Math.round(el.height * 100) / 100}
            onChange={(e) => updateElement(el.id, { height: Math.max(1, Number(e.target.value)) })}
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm tabular-nums transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </label>
      </div>
    </section>
  );
}

'use client';

import { useState } from 'react';
import type { EditorElement } from '@pdfeditor/shared';
import { useEditor } from '@/store/editor';
import {
  useFloatingToolbarPosition,
  useToolbarEvents,
} from './FloatingToolbarShared';
import {
  parseFontSizeInput,
  parseMaxLengthInput,
  validateFieldName,
} from '@/lib/form-field-props';

type FormFieldEl = Extract<EditorElement, { kind: 'form-field' }>;

/**
 * Floating properties editor for a selected, created form field.
 * Follows the FloatingShapeToolbar pattern (positioning + shell). Shows
 * only the field's own controls: name, required, max length, font size.
 * Bound fields never render this — their name/flags come from the PDF.
 * Pointer events are stopped (not focus-prevented) so the inputs stay
 * editable while clicks never reach the canvas underneath.
 */
export function FloatingFormFieldToolbar({
  el,
  screenX,
  screenTop,
  screenHeight,
  zoom,
}: {
  el: FormFieldEl;
  screenX: number;
  screenTop: number;
  screenHeight: number;
  zoom: number;
}) {
  const updateElement = useEditor((s) => s.updateElement);
  const elements = useEditor((s) => s.elements);
  const { stop } = useToolbarEvents();
  const { top, left } = useFloatingToolbarPosition({
    elementScreenX: screenX,
    elementScreenTop: screenTop,
    elementScreenHeight: screenHeight,
    zoom,
  });
  const [nameError, setNameError] = useState<string | null>(null);

  const commitName = (raw: string) => {
    const v = validateFieldName(elements, raw, el.id);
    if (!v.ok) {
      setNameError(v.error);
      return;
    }
    setNameError(null);
    if (v.name !== el.name) updateElement(el.id, { name: v.name }, 'Rename field');
  };

  const labelCls = 'text-[11px] font-medium text-slate-500';
  const inputCls =
    'rounded-md border border-slate-300 px-1.5 py-1 text-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

  return (
    <div
      role="toolbar"
      aria-label="Form field properties"
      className="absolute z-30 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 shadow-xl"
      style={{ left, top }}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      {/* Name — commits on blur/Enter, validated for emptiness + uniqueness */}
      <label className="flex items-center gap-1.5">
        <span className={labelCls}>Name</span>
        <input
          type="text"
          key={`${el.id}:${el.name}`}
          defaultValue={el.name}
          maxLength={128}
          aria-label="Field name"
          aria-invalid={!!nameError}
          onBlur={(e) => commitName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className={`w-28 font-mono ${inputCls} ${nameError ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : ''}`}
        />
      </label>

      {/* Required — immediate toggle */}
      <label className="flex cursor-pointer items-center gap-1.5">
        <input
          type="checkbox"
          checked={el.required}
          aria-label="Required"
          onChange={(e) =>
            updateElement(el.id, { required: e.target.checked }, 'Toggle field required')
          }
          className="h-4 w-4 accent-[#2f6bff]"
        />
        <span className={labelCls}>Required</span>
      </label>

      {/* Max length + font size — text-like fields only (export ignores
          them for checkboxes, so offering them there would mislead) */}
      {(el.fieldType === 'text' || el.fieldType === 'multiline') && (
        <>
          <label className="flex items-center gap-1.5">
            <span className={labelCls}>Max length</span>
            <input
              type="number"
              min={1}
              placeholder="—"
              value={el.maxLength ?? ''}
              aria-label="Max length"
              onChange={(e) =>
                updateElement(
                  el.id,
                  { maxLength: parseMaxLengthInput(e.target.value) },
                  'Edit max length',
                )
              }
              className={`w-16 tabular-nums ${inputCls}`}
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className={labelCls}>Font size</span>
            <input
              type="number"
              min={4}
              max={200}
              value={Math.round(el.fontSize * 100) / 100}
              aria-label="Font size"
              onChange={(e) => {
                const v = parseFontSizeInput(e.target.value);
                if (v !== null) {
                  updateElement(el.id, { fontSize: v }, 'Edit field font size');
                }
              }}
              className={`w-14 tabular-nums ${inputCls}`}
            />
          </label>
        </>
      )}

      {nameError && (
        <span className="basis-full text-xs text-red-600">{nameError}</span>
      )}
    </div>
  );
}

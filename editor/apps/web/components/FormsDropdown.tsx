'use client';

import { useEffect, useRef, useState } from 'react';
import { useEditor, type ToolId } from '@/store/editor';
import { FORM_TOOL_IDS, FORM_FIELD_DEFAULTS, type FormToolId } from '@/lib/form-fields';
import { ToolIcon } from './ToolIcon';

const FORM_IDS = new Set<ToolId>(FORM_TOOL_IDS as readonly ToolId[]);

/**
 * One compact Forms button in the toolbar pill. Opens a menu listing the
 * creatable field kinds (text field, multiline field, checkbox); selecting
 * one activates its click-to-place workflow on the page.
 */
export function FormsDropdown({ inPill = false }: { inPill?: boolean }) {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const activeForm = FORM_IDS.has(tool) ? (tool as FormToolId) : null;
  const buttonLabel = activeForm ? FORM_FIELD_DEFAULTS[activeForm].label : 'Forms';

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        title="Form fields"
        aria-label="Form fields"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={
          inPill
            ? `flex h-9 items-center justify-center gap-1.5 px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand-500 ${
                activeForm
                  ? 'bg-brand-500 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-sky-50 hover:text-sky-800'
              }`
            : `flex h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500 ${
                activeForm
                  ? 'bg-brand-500 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
              }`
        }
      >
        <ToolIcon id={activeForm ?? 'form-text'} />
        <span aria-hidden>{buttonLabel}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <>
          {/* Click-outside layer (also covers touch) */}
          <button
            type="button"
            aria-label="Close forms menu"
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default bg-transparent"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            aria-label="Form fields"
            className="absolute left-0 top-full z-50 mt-1 min-w-[190px] rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
          >
            {FORM_TOOL_IDS.map((id) => {
              const selected = tool === id;
              const def = FORM_FIELD_DEFAULTS[id];
              return (
                <button
                  key={id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    setTool(id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                    selected
                      ? 'bg-brand-50 font-medium text-brand-700'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span className={selected ? 'text-brand-600' : 'text-slate-500'}>
                    <ToolIcon id={id} />
                  </span>
                  <span className="flex-1">{def.label}</span>
                  {selected && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-brand-600">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
